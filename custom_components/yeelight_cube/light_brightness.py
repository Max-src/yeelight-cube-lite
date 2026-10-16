"""Brightness of the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin: the brightness service (set_brightness),
which sets the lamp's hardware brightness like its native modes do
(light_color.hardware_brightness_for), and the fast path that re-sends the current
frame (its color correction depends on that brightness). Reads/writes state via
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
from .light_color import hardware_brightness_for
from .light_display import FX_MODE_STALENESS_TIMEOUT

_LOGGER = logging.getLogger(__name__)


class BrightnessMixin:
    """The brightness service and its fast path."""

    def _init_brightness_state(self):
        """What the brightness path last sent, and its retry. Called by YeelightCubeLight.__init__."""
        # Hardware brightness tracking to avoid redundant brightness commands
        self._last_hardware_brightness = None  # Track last hardware brightness sent to lamp

        # Track last successful brightness change (timestamp, user_brightness)
        # Used to prevent retry queue from overwriting newer brightness values
        self._last_successful_brightness = None  # (timestamp, user_brightness_0_255)
        
        # Brightness retry queue - stores failed brightness values to retry when connection recovers
        # Unlike generic retry queue, this stores COMPLETE user brightness (not hardware commands)
        self._pending_brightness = None  # (user_brightness_0_255, timestamp) or None
        self._brightness_retry_task = None  # Background task for brightness retries

    async def set_brightness(self, brightness: int, **kwargs):
        """
        Brightness (1-255) as the lamp's hardware brightness (1-100 %, as in
        its native modes; light_color.hardware_brightness_for).

        The new value is published at once so cards preview it, then the
        hardware command runs under the device lock; the frame is re-sent
        when its color correction changes with it.
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
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] SET_BRIGHTNESS state update: %s -> %s",
                self._ip, old_brightness, self._brightness
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
            "requested=%s, current=%s, last_hw=%s",
            self._ip, call_id, brightness, self._brightness,
            self._last_hardware_brightness
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
            
            level = hardware_brightness_for(self._brightness)
            try:
                if level != self._last_hardware_brightness:
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Hardware brightness %s%% -> %s%%",
                        call_id, self._last_hardware_brightness, level
                    )
                    # The lamp's brightness first, then the frame: its color
                    # correction (low brightness) and accuracy depend on it,
                    # so it is re-sent with them (fast path, no full render).
                    if not await self._send_hardware_brightness(level):
                        return  # queued: the retry sends it all again
                    self._last_hardware_brightness = level
                    await self._apply_brightness_only()
                    # Guards the retry queue against applying an older value.
                    self._last_successful_brightness = (time.time(), self._brightness)
                elif self._has_color_effects:
                    # Unchanged, but the frame on the lamp may lack its color
                    # effects (drawn by the last _internal_turn_on): drawn
                    # again in full.
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Unchanged but effects active -- full display update",
                        call_id
                    )
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

    async def _send_hardware_brightness(self, hardware_brightness: int) -> bool:
        """Send set_bright on the persistent socket (fire-and-forget, no reply
        awaited: the Cube closes TCP after each command). Returns whether it
        was sent: while the connection is down, or when it fails, the user's
        brightness is queued for retry instead (not recorded as sent, so the
        retry does send it).

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
            return False
        try:
            await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
        except Exception as e:
            if is_connection_error(e) or is_quota_error(e):
                self._pending_brightness = (self._brightness, time.time())
                self._start_brightness_retry_task()
            else:
                _LOGGER.warning(
                    "[BRIGHTNESS] Unexpected error sending hardware brightness: %s", e
                )
            return False
        return True

    async def _apply_brightness_only(self):
        """
        FAST PATH after a hardware brightness change: the current frame again,
        with the color correction and accuracy for the new brightness.

        Takes the _base_matrix_colors snapshot apply() keeps (color effects
        already applied), runs only the brightness-dependent stages and sends
        it -- no full re-render of the text or pixels. Falls back to the full
        path when there is no snapshot or direct mode needs activating.
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
            
            # _base_matrix_colors already has the color effects (applied in
            # apply() before the snapshot): applying them again would double
            # them. Only the brightness-dependent stages run again.
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] BRIGHTNESS_FAST -- user=%s/255, hw=%s%%",
                self._ip, self._brightness, self._last_hardware_brightness
            )
            frame = self._brightness_stages(base_colors)
            self._write_layout_colors(frame)

            # Send pixel data using fire-and-forget (no recv wait); direct
            # mode again at once if the connection changed under it.
            await self._draw_direct(encode_rgb_frame(self._lamp_frame(frame)))

            if self.hass is not None:
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
                
            _LOGGER.debug("[BRIGHTNESS_FAST] [OK] Done (hw=%s%%)", self._last_hardware_brightness)
            
        except Exception as e:
            if is_connection_error(e):
                self._fx_mode_is_direct = False
                self._last_connection_error = str(e)
                _LOGGER.debug("[BRIGHTNESS_FAST] Connection issue: %s -- re-raising for retry", e)
            else:
                _LOGGER.warning("[BRIGHTNESS_FAST] Error: %s", e)
            raise
