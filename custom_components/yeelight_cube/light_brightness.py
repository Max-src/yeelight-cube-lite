"""Brightness of the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin: the brightness service (set_brightness),
the unified brightness curve sent to the lamp (hardware dimming plus
per-pixel darkening, see the notes on YeelightCubeLight) and the fast path
that re-sends the current frame at a new brightness. Reads/writes state via
``self`` (the concrete :class:`YeelightCubeLight`); used only as a mixin.
"""
import logging
import time

from .cube_matrix import (
    CubeConnectionError,
    encode_rgb_frame,
    is_connection_error,
    is_quota_error,
)
from .light_display import FX_MODE_STALENESS_TIMEOUT

_LOGGER = logging.getLogger(__name__)


class BrightnessMixin:
    """The brightness service, its hardware / per-pixel split and fast path."""

    def _init_brightness_state(self):
        """What the brightness path last sent, and its retry. Called by YeelightCubeLight.__init__."""
        # Hardware brightness tracking to avoid redundant brightness commands
        self._last_hardware_brightness = None  # Track last hardware brightness sent to lamp
        self._last_applied_darken = None       # Track last darken% actually rendered to lamp pixels

        # Track last successful brightness change (timestamp, user_brightness)
        # Used to prevent retry queue from overwriting newer brightness values
        # This is CRITICAL for unified brightness system (hardware + darkness)
        self._last_successful_brightness = None  # (timestamp, user_brightness_0_255)
        
        # Brightness retry queue - stores failed brightness values to retry when connection recovers
        # Unlike generic retry queue, this stores COMPLETE user brightness (not hardware commands)
        self._pending_brightness = None  # (user_brightness_0_255, timestamp) or None
        self._brightness_retry_task = None  # Background task for brightness retries

    async def set_brightness(self, brightness: int, **kwargs):
        """
        Unified brightness control using BOTH hardware brightness and RGB darkening.

        One slider (1-255) drives both mechanisms together across the whole
        range, with no switch-over point (see the UNIFIED BRIGHTNESS CONTROL
        notes on the class and _calculate_brightness_values):
        - 1:   hardware at the hardware floor, darkening at the darken floor
        - 255: hardware at 100%, no darkening

        The new value is published at once so cards preview it, then the
        hardware command runs under the device lock. set_bright is sent
        without waiting for a reply, and only the parts that changed (hardware
        level, pixel darkening) are re-sent.
        """
        # Calibration lock: ignore automation brightness changes while the wizard
        # drives the lamp. Wizard calls pass bypass_lock=True.
        bypass_lock = kwargs.pop("bypass_lock", False)
        if self._calibration_lock and not bypass_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] set_brightness(%s) ignored "
                "-- calibration lock active",
                self._ip, brightness
            )
            return
        call_id = int(time.time() * 1000) % 100000
        _LOGGER.debug(
            "[BRIGHTNESS_DIAG] [%s] SET_BRIGHTNESS called: "
            "requested=%s, current=%s, is_on=%s",
            self._ip, brightness, self._brightness, self._is_on
        )
        
        # Update internal state and HA IMMEDIATELY so the UI reflects the
        # user's intent without waiting for the lamp command to complete.
        # The actual hardware command still goes through the queue.
        if self._is_on:
            old_brightness = self._brightness
            self._brightness = max(1, min(255, brightness))
            # CRITICAL: Calculate and apply _preview_darken BEFORE the state push.
            # extra_state_attributes uses _preview_darken to compute brightness-
            # adjusted matrix_colors.  Without this, the JS card would get the
            # updated brightness but STALE matrix_colors (old darken level),
            # making the preview lag behind the slider by the full lamp roundtrip.
            _, darken_percent = self._calculate_brightness_values(self._brightness)
            self._preview_darken = darken_percent
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] SET_BRIGHTNESS state update: "
                "%s -> %s, darken=%s%%",
                self._ip, old_brightness, self._brightness, darken_percent
            )
            if self.hass is not None:
                _LOGGER.debug(
                    "[TIMING] [%s] brightness state_push epoch=%.3f", self._ip, time.time())
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_set_brightness(brightness, call_id, **kwargs),
            f"brightness:{brightness}"
        )
    
    async def _internal_set_brightness(self, brightness: int, call_id: int, **kwargs):
        """Internal brightness implementation -- runs under the global lock."""
        _LOGGER.debug(
            "[BRIGHTNESS_DIAG] [%s] INTERNAL_SET #%s -- "
            "requested=%s, current=%s, "
            "last_hw=%s, last_darken=%s",
            self._ip, call_id, brightness, self._brightness,
            self._last_hardware_brightness, self._last_applied_darken
        )
        
        if self._is_on:
            # Store the raw HA brightness value (1-255 for ON lights, 0 means OFF)
            old_brightness = self._brightness
            self._brightness = max(1, min(255, brightness))  # Clamp to 1-255 for ON state
            _LOGGER.debug("[BRIGHTNESS #%s] Brightness changed: %s -> %s", call_id, old_brightness, self._brightness)

            if self.firmware_draws_matrix:
                await self._set_native_mode_brightness()
                if self.hass is not None:
                    self.async_schedule_update_ha_state()
                return
            
            # Calculate BOTH hardware brightness and darkness percentage
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            
            _LOGGER.debug(
                "[BRIGHTNESS #%s] User brightness %s (1-255) -> "
                "hardware=%s%%, darkness=%s%%",
                call_id, self._brightness, hardware_brightness, darken_percent
            )
            
            try:
                # BRIGHTNESS UPDATE OPTIMIZATION:
                # 1. Hardware brightness command is FIRE-AND-FORGET (lamp doesn't respond)
                # 2. Display update requires re-rendering all 100 LEDs with new darkness
                # 3. When BOTH change: Execute in parallel for maximum speed
                # 4. When only ONE changes: Execute only that operation
                
                # Track what changed to avoid redundant updates
                # CRITICAL: Compare darken against _last_applied_darken (what was actually
                # rendered to the lamp), NOT _preview_darken.  set_brightness() updates
                # _preview_darken early for the JS card preview, so by the time this
                # queued function runs, _preview_darken already equals darken_percent
                # and the comparison would ALWAYS be False -- skipping the display
                # update that bakes RGB darkening into the actual lamp pixels.
                darken_changed = (self._last_applied_darken != darken_percent)
                hardware_changed = (self._last_hardware_brightness != hardware_brightness)
                
                # Update the darken value (affects next display render)
                old_darken = self._last_applied_darken
                old_hardware = self._last_hardware_brightness
                self._preview_darken = darken_percent
                
                # CRITICAL: Update _last_hardware_brightness BEFORE any branch
                # that calls _apply_brightness_only() or _apply_color_correction().
                # _apply_color_correction() reads this to determine correction
                # strength -- if updated AFTER _apply_brightness_only(), the
                # correction uses the OLD hardware brightness -> wrong colors.
                # (In non-hardware_changed branches, this is a no-op since the
                # value hasn't changed.)
                self._last_hardware_brightness = hardware_brightness
                
                # OPTIMIZATION: Execute hardware and display updates optimally
                if hardware_changed and darken_changed:
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] BOTH changed - "
                        "hardware: %s%% -> %s%%, "
                        "darkness: %s%% -> %s%% - sequential hw then display",
                        call_id, old_hardware, hardware_brightness, old_darken,
                        darken_percent
                    )
                    # IMPORTANT: Send hardware brightness FIRST, then update display.
                    # If we fire-and-forget the hardware command while sending the display
                    # update, the lamp may receive the new darkened RGB values while still
                    # at the OLD hardware brightness, causing a brief brightness dip.
                    # By awaiting the hardware command first, we ensure the lamp's hardware
                    # brightness is updated BEFORE it receives the new RGB pixel data.
                    
                    await self._send_hardware_brightness(hardware_brightness)
                    
                    # PERFORMANCE: Use _apply_brightness_only() which re-darkens
                    # the existing _base_matrix_colors and sends draw_matrices_fast
                    # (fire-and-forget).  This avoids the full re-render of text/
                    # pixels in _apply_display_mode_internal() and the recv() wait.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change for anti-overwrite protection
                    # CRITICAL: Track AFTER both hardware and display complete
                    # This prevents retry queue from applying stale brightness (hardware + darkness)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Tracked successful brightness: "
                        "%s (hardware=%s%%, darkness=%s%%)",
                        call_id, self._brightness, hardware_brightness, darken_percent
                    )
                    
                    # _last_hardware_brightness already set above (before branches)
                    self._last_applied_darken = darken_percent
                    
                elif hardware_changed:
                    # Only hardware changed - send command and await it
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Hardware brightness changed: "
                        "%s%% -> %s%%, sending...",
                        call_id, old_hardware, hardware_brightness
                    )
                    await self._send_hardware_brightness(hardware_brightness)
                    
                    # _last_hardware_brightness already set above (before branches)
                    
                    # IMPORTANT: Re-render pixels with updated color correction.
                    # _apply_color_correction() uses _last_hardware_brightness which
                    # just changed -- existing pixels have stale correction baked in.
                    # Without this, low-brightness color correction would be wrong
                    # until the next full re-render.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change (hardware only, darkness unchanged)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    
                elif darken_changed:
                    # Only darkness changed - use FAST PATH (no full re-render)
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Darkness changed: %s%% -> %s%%, "
                        "using fast brightness path...",
                        call_id, old_darken, darken_percent
                    )
                    # PERFORMANCE: _apply_brightness_only() re-darkens existing
                    # _base_matrix_colors and sends fire-and-forget draw_matrices.
                    # Skips the full text/pixel re-render + recv() wait.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change (darkness only, hardware unchanged)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    self._last_applied_darken = darken_percent
                    
                else:
                    # Nothing changed numerically.  But if color effects are active,
                    # we STILL need to re-render: _apply_display_mode_internal
                    # re-places pixels from scratch and then apply() bakes in the
                    # effects.  Without this display update the lamp would show the
                    # raw (un-effected) pixels from the last _internal_turn_on.
                    if self._has_color_effects:
                        _LOGGER.debug(
                            "[BRIGHTNESS #%s] Values unchanged but effects active "
                            " -- forcing display update to preserve effects",
                            call_id
                        )
                        # PERFORMANCE: Direct call -- see comment in 'both changed' branch.
                        await self._apply_display_mode_internal()
                    else:
                        _LOGGER.debug("[BRIGHTNESS #%s] No changes needed, brightness already at target", call_id)
                    
            except Exception as e:
                # Most errors are already handled gracefully in cube_matrix.send_command_with_recovery
                # Only truly unexpected errors reach here
                if is_quota_error(e):
                    _LOGGER.warning("[BRIGHTNESS #%s] Rate limit exceeded - backing off", call_id)
                elif isinstance(e, TimeoutError):
                    _LOGGER.warning("[BRIGHTNESS #%s] Timeout - device may be unreachable", call_id)
                else:
                    _LOGGER.error("[BRIGHTNESS #%s] Unexpected error: %s", call_id, e)
        else:
            _LOGGER.debug("[BRIGHTNESS #%s] Light is off, not applying brightness", call_id)

    async def _send_hardware_brightness(self, hardware_brightness: int) -> None:
        """Send set_bright on the persistent socket (fire-and-forget, no reply
        awaited: the Cube closes TCP after each command). While the
        connection is down the user's brightness is queued for retry instead.

        _fx_mode_is_direct is NOT reset here: set_bright does not knock the
        Cube out of direct mode, and resetting it would make apply() re-send
        activate_fx_mode + set_bright (~300ms) on every brightness change. The
        FX_MODE_STALENESS_TIMEOUT check in apply() is the safety net if the
        Cube silently leaves direct mode after an idle period.
        """
        if not self._cube_matrix.is_connected():
            _LOGGER.debug(
                "[BRIGHTNESS] Connection down -- queued brightness %s for retry",
                self._brightness,
            )
            self._pending_brightness = (self._brightness, time.time())
            self._start_brightness_retry_task()
            return
        try:
            await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
        except Exception as e:
            if not (is_connection_error(e) or is_quota_error(e)):
                _LOGGER.warning(
                    "[BRIGHTNESS] Unexpected error sending hardware brightness: %s", e
                )

    async def _apply_brightness_only(self):
        """
        FAST PATH for brightness-only changes.
        
        Instead of the full _apply_display_mode_internal() which:
        1. Clears all modules to background color
        2. Re-places all text/pixels from scratch  (CPU work)
        3. Calls apply() which may re-send FX mode + set_bright  (2 TCP commands)
        4. Loops over 100 modules for effects + darkening  (CPU work)
        5. Sends draw_matrices  (1 TCP command)
        
        This method:
        1. Takes the existing _base_matrix_colors snapshot (already computed)
        2. Re-applies color effects + new brightness darkening to each pixel
        3. Encodes and sends draw_matrices_fast  (1 TCP command, fire-and-forget)
        
        Savings: ~200-400ms of TCP round-trips + full re-render avoided.
        Only valid when the underlying pixel art/text hasn't changed -- just the
        brightness level (darken_percent).
        """
        try:
            if not self._cube_matrix.is_connected():
                _LOGGER.log(
                    self._cube_matrix.outage_log_level(),
                    "[BRIGHTNESS_FAST] [%s] SKIP -- cooldown active", self._ip,
                )
                raise CubeConnectionError("Cooldown active -- device not yet reachable")
            
            # If we don't have base colors yet, fall back to the full path
            base_colors = self._base_matrix_colors
            if not base_colors or len(base_colors) != len(self._layout.device_layout):
                _LOGGER.debug("[BRIGHTNESS_FAST] No base colors -- falling back to full apply")
                await self._apply_display_mode_internal()
                return
            
            # STALENESS CHECK: Same as in apply() -- check fx_age, not idle.
            # Falls through to full apply path which uses ensure_fx_ready() (raw TCP).
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    _LOGGER.debug(
                        "[BRIGHTNESS_FAST] [%s] FX mode stale -- fx_age=%.0fs > "
                        "%.0fs, falling back to full apply (raw TCP recovery)",
                        self._ip, fx_age, FX_MODE_STALENESS_TIMEOUT
                    )
                    self._fx_mode_is_direct = False

            # If FX mode isn't set, fall back to the full path which handles activation
            if not self._fx_mode_is_direct:
                _LOGGER.debug("[BRIGHTNESS_FAST] FX mode not set -- falling back to full apply")
                await self._apply_display_mode_internal()
                return
            
            # Check if reconnection happened
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.debug("[BRIGHTNESS_FAST] Reconnection detected -- falling back to full apply")
                self._fx_mode_is_direct = False
                await self._apply_display_mode_internal()
                return
            
            # Re-apply brightness + accuracy to the base colors.
            #
            # IMPORTANT: _base_matrix_colors already has color effects baked in
            # (hue_shift, saturation, contrast, temperature, vibrance, glow,
            #  grayscale, invert, tint).  They were applied during the full
            # render in apply() and snapshotted AFTER apply_color_adjustments.
            # Do NOT call apply_color_adjustments() again here -- that would
            # double-apply every color effect (e.g., hue shift applied twice).
            #
            # What we DO re-apply each time brightness changes:
            #   1. _apply_final_brightness -- RGB darkening for brightness
            #   2. _apply_color_correction -- low-brightness gamma correction
            #   3. _apply_color_accuracy -- per-channel gain (fades with brightness)
            
            # Write darkened colors directly into modules
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] BRIGHTNESS_FAST -- "
                "user=%s/255, darken=%s%%, "
                "brighten=%s%%, "
                "last_hw=%s, last_darken=%s, "
                "base_colors_count=%s",
                self._ip, self._brightness, self._preview_darken,
                self._preview_brighten, self._last_hardware_brightness,
                self._last_applied_darken, len(base_colors)
            )
            # base_colors already includes color effects -- only apply the
            # brightness pipeline (darkening, gamma, accuracy)
            frame = [
                self._apply_color_accuracy(
                    self._apply_color_correction(self._apply_final_brightness(rgb))
                )
                for rgb in base_colors
            ]
            self._write_layout_colors(frame)

            # Send pixel data using fire-and-forget (no recv wait)
            await self._cube_matrix.draw_matrices_fast(
                encode_rgb_frame(self._lamp_frame(frame))
            )
            
            # POST-SEND RECONNECTION CHECK: Same as in apply() -- if the
            # socket reconnected during send, pixels were silently ignored.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.debug(
                    "[BRIGHTNESS_FAST] [%s] Socket reconnected during update_leds -- "
                    "falling back to full apply for FX re-activation",
                    self._ip
                )
                await self._apply_display_mode_internal()
                return
            
            # Track successful rendering
            self._last_applied_darken = self._preview_darken
            
            # Update _last_sent_colors for future transitions
            self._last_sent_colors = frame
            
            if self.hass is not None:
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
                
            _LOGGER.debug("[BRIGHTNESS_FAST] [OK] Done (darken=%s%%)", self._preview_darken)
            
        except Exception as e:
            if is_connection_error(e):
                self._fx_mode_is_direct = False
                self._last_connection_error = str(e)
                _LOGGER.debug("[BRIGHTNESS_FAST] Connection issue: %s -- re-raising for retry", e)
            else:
                _LOGGER.warning("[BRIGHTNESS_FAST] Error: %s", e)
            raise
