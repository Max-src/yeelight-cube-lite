"""The display pipeline of the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin: the display queue
(async_apply_display_mode and its central rules: the off-lamp rule, the
firmware-mode guard and the phone overlay), the frame sender (apply()) and
the text scroll timer. Reads/writes state via ``self`` (the concrete
:class:`YeelightCubeLight`); used only as a mixin.
"""
import asyncio
import logging
import time

from yeelight import BulbException  # type: ignore

from .color_utils import rgb_to_hex
from .const import FIRMWARE_MODES, MODE_NATIVE_EFFECT, ROTATION_KIND_MODES
from .cube_matrix import (
    CubeConnectionError,
    CubeFxModeLost,
    encode_rgb_frame,
    is_connection_error,
)
from .lamp_power import estimated_power
from .light_connection import APPLY_HARD_TIMEOUT

_LOGGER = logging.getLogger(__name__)

FX_MODE_STALENESS_TIMEOUT = 90.0  # Seconds -- re-send activate_fx_mode when _last_fx_mode_time
                                  # (set by activate_fx_mode and by every full frame drawn in
                                  # apply()) is older than this. An idle Cube can leave direct
                                  # FX mode silently: it keeps the TCP connection open and ignores
                                  # update_leds without an error.
MUSIC_FLOW_EXIT_UPDATE_TYPES = {
    "turn_off",
    "brightness_change",
    "text_change",
    "color_change",
    "pixel_art",
}


class DisplayMixin:
    """The display queue, the frame sender and the text scroll timer."""

    def _init_scroll_state(self):
        """The text scroll timer's state (scroll_text). Called by YeelightCubeLight.__init__."""
        # Text scrolling functionality
        self._scroll_speed = 0.2  # Scroll speed in seconds per step
        self._scroll_enabled = True  # Whether to enable auto-scroll for long text
        self._scroll_offset = 0  # Current scroll position
        self._scroll_direction = 1  # 1 for right, -1 for left
        self._scroll_timer = None  # Timer for auto-scrolling
        self._max_scroll_offset = 0  # Maximum scroll offset for current text
        self._is_scrolling = False  # Flag to indicate if currently in scroll animation

    async def erase_all(self):
        background_color_hex = rgb_to_hex(self._background_color)
        for module in self._layout.device_layout:
            module.set_colors([background_color_hex])

    async def set_custom_text(self, text_chars: str):
        if not isinstance(text_chars, str):
            _LOGGER.error("set_custom_text received non-string character: %s", text_chars)
            return
        # Prevent empty text -- the Yeelight firmware misbehaves when given
        # an empty string.  Use a single space instead (renders as blank).
        if text_chars == "":
            text_chars = " "
        self._custom_text = text_chars
        
        # Notify text input entity of the change (only if it's been added to hass)
        if self._text_input_entity and hasattr(self._text_input_entity, 'hass') and self._text_input_entity.hass is not None:
            self._text_input_entity.async_update_from_light()
        
        # Push HA state eagerly so automations see the new custom_text
        # immediately (see handle_set_custom_text for detailed rationale).
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        if self._is_on and not self._text_waits_for_matrix():
            await self.async_apply_display_mode(update_type='text_change')

    async def async_apply_display_mode(self, update_type: str = 'display_update', bypass_lock: bool = False):
        """Queue a display mode update to be processed sequentially"""
        # A lamp that is off is never drawn on (pixel data turns it on) unless
        # commands may turn it on (the "auto-turn-on" option): every action
        # keeps its new content, shown when the lamp is turned on.
        if not self._is_on and not self._should_auto_turn_on():
            _LOGGER.debug(
                "[AUTO-TURN-ON] [%s] '%s' kept for when the lamp is turned on",
                self._ip, update_type,
            )
            return
        if update_type in {"color_change", "pixel_art", "text_change"} and (
            self._rotation_resume_pending
            or (
                self._rotation_active
                and self._mode != (ROTATION_KIND_MODES.get(self._rotation_kind, MODE_NATIVE_EFFECT))
            )
        ):
            self.stop_effect_rotation()
        # Calibration lock: while the wizard owns the lamp, drop every display
        # update that doesn't explicitly bypass the lock (i.e. anything not coming
        # from the wizard). This freezes the panel on the wizard's test pattern so
        # automations (custom text, pixel art, clock, sensors...) can't disturb it.
        if self._calibration_lock and not bypass_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] Display update '%s' ignored "
                "-- calibration lock active",
                self._ip, update_type
            )
            return

        if self._music_flow_enabled:
            if update_type not in MUSIC_FLOW_EXIT_UPDATE_TYPES:
                _LOGGER.debug(
                    "[MUSIC FLOW] [%s] Ignoring background display update '%s'",
                    self._ip,
                    update_type,
                )
                return
            await self.async_set_music_flow(False, restore_display=False)

        # FIRMWARE-NATIVE MODE OWNERSHIP: while the lamp is physically showing a
        # firmware clock / native animation / color flow, suppress *incidental*
        # matrix re-renders that would clobber it -- e.g. a sensor/template-driven
        # set_custom_text (text_change), a periodic refresh (display_update), or a
        # stale retry (display_retry).  This is the common "one lamp shows a clock,
        # an automation keeps pushing text to it" conflict.
        #
        # DELIBERATE switches to matrix content (pixel_art, color_change from the
        # content-mode select, turn_on, brightness_change) are NOT in this set, so
        # they pass through; when they render, apply() -> ensure_fx_ready()
        # clears _in_native_fw_mode, so subsequent updates flow normally again.
        #
        # Persisted Clock / Native Effect modes (_mode in those values) route to
        # their own activation path in _apply_display_mode_internal and must NOT
        # be suppressed, so they are excluded by the _mode check.
        _NATIVE_COMPETING_UPDATE_TYPES = {
            "text_change", "display_update", "display_retry",
        }
        if (
            self._in_native_fw_mode
            and self._mode not in FIRMWARE_MODES
            and update_type in _NATIVE_COMPETING_UPDATE_TYPES
            and not bypass_lock
        ):
            if self._display_overlay:
                # save_state ... restore_state: shown on purpose, once.
                self._display_overlay = False
            else:
                _LOGGER.debug(
                    "[DISPLAY] [%s] Update '%s' suppressed -- lamp is in a firmware-native "
                    "mode. Switch the content mode or apply a drawing to leave it.",
                    self._ip, update_type,
                )
                return
        # NOTE: _apply_cooldown removed. It was silently DROPPING updates
        # when they arrived within 100ms of each other (e.g., rapid pixel
        # drawing or fast slider changes). The queue's coalescing logic
        # already handles deduplication properly -- if two identical updates
        # are queued, the queue processor coalesces them. Dropping here
        # caused lost pixel art frames and missed state changes.
        is_retry = update_type == 'display_retry'
        
        # Only reset the retry counter when it has actually HIT the limit
        # AND the caller is a genuine user action (not a periodic display_update).
        #
        # User actions: turn_on, brightness_change, text_change, color_change,
        #               pixel_art (used by service calls)
        # Periodic:     display_update (from HA state polling, clock, sensors)
        #
        # Previously ANY non-retry call reset the counter.  This meant periodic
        # display_update calls arriving every ~30s would restart the retry
        # cycle for a device that's genuinely offline -- retrying forever.
        # Now only explicit user actions restart retries.
        user_action_types = {
            'turn_on', 'turn_off', 'brightness_change', 'text_change',
            'color_change', 'pixel_art', 'power_limit',
        }
        is_user_action = update_type in user_action_types
        if not is_retry and self._display_retry_count >= self.MAX_DISPLAY_RETRIES:
            if is_user_action:
                _LOGGER.debug(
                    "[DISPLAY] [%s] User action '%s' reset retry counter "
                    "(%s -> 0) -- retries will resume",
                    self._ip, update_type, self._display_retry_count
                )
                self._display_retry_count = 0
                # Cancel any pending retry task -- without this, the old
                # retry fires immediately and pushes the counter back to the limit
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
                    _LOGGER.debug("[DISPLAY] [%s] Cancelled stale retry task", self._ip)
            else:
                _LOGGER.debug(
                    "[DISPLAY] [%s] Periodic '%s' skipped -- device offline, "
                    "retry limit reached (%s/%s). "
                    "A user action will restart retries.",
                    self._ip, update_type, self._display_retry_count,
                    self.MAX_DISPLAY_RETRIES
                )
                return  # Don't queue -- device is offline and no user is actively requesting
        
        log_level = _LOGGER.info if is_retry else _LOGGER.debug
        log_level(f"[DISPLAY] async_apply_display_mode called - mode: '{self._mode}', text: '{self._custom_text}', type: '{update_type}', is_on: {self._is_on}")
        
        # Track which type of update is running so the transition block in
        # apply() can skip animations on retries / recovery / periodic
        # refreshes.  Only genuine user-initiated content changes animate.
        self._current_update_type = update_type

        # Compute dynamic timeout: when a transition is enabled, the operation
        # needs transition_duration + overhead for FX activation + final send.
        # Without transition, use the default APPLY_HARD_TIMEOUT.
        op_timeout = None
        if (self._transition_type != "none"
                and self._last_sent_colors is not None
                and not self._transition_active):
            op_timeout = self._transition_duration + APPLY_HARD_TIMEOUT
        
        # Execute the display update under the global lock with error handling
        return await self._execute_hardware_op(
            lambda: self._apply_display_mode_internal(),
            f"display:{update_type}",
            timeout_override=op_timeout,
            coalesce=True,
        )

    async def apply(self):
        try:
            # Fast-fail: if we're in cooldown after a failed connection attempt,
            # RAISE so the queue processor sees this as a failure and schedules
            # a retry. Previously this returned silently, which the queue processor
            # treated as success -- cancelling the retry chain and leaving the lamp
            # dark forever.
            if not self._cube_matrix.is_connected():
                _LOGGER.log(
                    self._cube_matrix.outage_log_level(),
                    "[APPLY] [%s] SKIP -- cooldown active, raising to trigger retry "
                    "(fx_direct=%s, is_on=%s, "
                    "retry_count=%s/%s) "
                    "[%s]",
                    self._ip, self._fx_mode_is_direct, self._is_on,
                    self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                    self._cube_matrix.summary
                )
                raise CubeConnectionError("Cooldown active -- device not yet reachable")
            
            # Check if the lamp just reconnected (socket was reset).
            # If so, we need to re-send FX mode and brightness before pixel data.
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.info(
                    "[APPLY] [%s] Reconnection detected -- will restore FX mode + brightness "
                    "(fx_direct was %s, forcing to False)",
                    self._ip, self._fx_mode_is_direct
                )
                self._fx_mode_is_direct = False  # Force re-send
            
            # STALENESS CHECK: an idle Cube can silently leave direct FX mode
            # (see FX_MODE_STALENESS_TIMEOUT).  Check fx_age.
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    idle_seconds = time.time() - self._cube_matrix.last_command_time if self._cube_matrix.last_command_time > 0 else 999
                    _LOGGER.debug(
                        "[APPLY] [%s] FX mode stale -- fx_age=%.0fs > "
                        "%.0fs threshold (idle=%.1fs), "
                        "forcing re-activation via raw TCP",
                        self._ip, fx_age, FX_MODE_STALENESS_TIMEOUT, idle_seconds
                    )
                    self._fx_mode_is_direct = False

            # Ensure lamp is in direct FX mode before sending pixel data.
            # Uses raw TCP (fresh connection per command) -- the proven-reliable
            # approach.  The Cube always processes activate_fx_mode correctly
            # on a fresh TCP connection but sometimes silently ignores it on
            # a reused persistent socket.
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            # Capture whether this apply is LEAVING a firmware-native renderer
            # (clock / native animation / color flow) BEFORE ensure_fx_ready()
            # clears the flag.  The firmware needs time to tear down the native
            # renderer after activate_fx_mode, and the FIRST update_leds can be
            # silently dropped during that window (accepted at TCP level, zero
            # visual effect) -- which is why a single send left the panel stuck
            # and a manual second send fixed it.  We re-send one frame below to
            # make the transition deterministic.
            leaving_native_fw_mode = self._in_native_fw_mode and not self._fx_mode_is_direct
            if not self._fx_mode_is_direct:
                await self.ensure_fx_ready()
                # Send set_bright on the PERSISTENT socket right after activation.
                # This avoids the extra RST connection that was disrupting direct
                # mode when set_bright was sent on a second fresh TCP in
                # ensure_fx_ready.  set_bright and the subsequent update_leds
                # now travel on the same persistent TCP connection.
                await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                self._last_hardware_brightness = hardware_brightness
            else:
                # FX mode already active -- only send set_bright when value changed.
                # _last_hardware_brightness == 0 (sentinel from ensure_fx_ready called
                # indirectly, e.g. force_refresh path) will also trigger this branch.
                if hardware_brightness != self._last_hardware_brightness:
                    _LOGGER.debug(
                        "[BRIGHTNESS_DIAG] [%s] APPLY -- sending set_bright: "
                        "user=%s/255, hardware=%s%%, "
                        "darken=%s%%, prev_hw=%s, "
                        "fx_direct=%s, mode='%s'",
                        self._ip, self._brightness, hardware_brightness,
                        darken_percent, self._last_hardware_brightness,
                        self._fx_mode_is_direct, self._mode
                    )
                    try:
                        await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                        self._last_hardware_brightness = hardware_brightness
                        _LOGGER.debug(
                            "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright SUCCESS: "
                            "hardware=%s%%",
                            self._ip, hardware_brightness
                        )
                    except Exception as e:
                        _LOGGER.debug(
                            "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright FAILED: %s", self._ip, e
                        )
                else:
                    _LOGGER.debug(
                        "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright SKIPPED "
                        "(unchanged at %s%%)",
                        self._ip, hardware_brightness
                    )

            # SINGLE-PASS: Apply color effects + brightness in one loop
            # Previously this was two separate loops (color then brightness), each
            # doing hex -> RGB -> process -> RGB -> hex. Now merged into one pass to halve
            # the conversion overhead (100 pixels x 2 conversions saved per frame).
            
            # CRITICAL: Sync _preview_darken from the authoritative _brightness value.
            # _preview_darken can become stale (e.g., stuck at 94% while user=255/255)
            # when certain code paths (health recovery, reconnection) update _brightness
            # but don't recalculate _preview_darken.  By always deriving it here from
            # _brightness, we guarantee the rendered pixels match the user's intent.
            old_darken = self._preview_darken
            self._preview_darken = darken_percent
            self._last_applied_darken = darken_percent
            if old_darken != darken_percent:
                _LOGGER.warning(
                    "[BRIGHTNESS_DIAG] [%s] APPLY -- fixed stale _preview_darken: "
                    "%s%% -> %s%% (user=%s/255)",
                    self._ip, old_darken, darken_percent, self._brightness
                )

            has_color_effect = self._has_color_effects
            has_brightness_effect = (self._preview_darken != 0 or self._preview_brighten != 0)
            
            # SNAPSHOT: Capture base colors for _apply_brightness_only (fast path).
            # The JS card also uses these (with _preview_darken applied on-the-fly)
            # for instant brightness preview without lamp roundtrip.
            #
            # The snapshot is taken AFTER color effects but BEFORE brightness
            # darkening, so _base_matrix_colors always contains:
            #   [OK] Original pixel colors (text/drawing)
            #   [OK] Color adjustments (hue_shift, saturation, etc.) already baked in
            #   [X] No brightness darkening
            #   [X] No color correction (gamma)
            #   [X] No color accuracy (per-channel gain)
            #
            # The brightness fast path (_apply_brightness_only) therefore
            # must NOT re-apply color adjustments -- only brightness pipeline.
            # The frame is read from the layout once and processed as RGB
            # tuples; it is written back and encoded for the lamp only once.
            frame = self._layout_colors()
            if has_color_effect:
                frame = [self.apply_color_adjustments(rgb) for rgb in frame]
            self._base_matrix_colors = frame
            if has_brightness_effect or has_color_effect or self._color_accuracy_enabled:
                if has_brightness_effect:
                    frame = [
                        self._apply_color_correction(self._apply_final_brightness(rgb))
                        for rgb in frame
                    ]
                # Color accuracy is applied ALWAYS (independent of brightness);
                # it returns the color unchanged while disabled.
                frame = [self._apply_color_accuracy(rgb) for rgb in frame]
                self._write_layout_colors(frame)
            
            # TRANSITION ANIMATION: If enabled, animate from previous -> new state
            # before sending the final frame.  Runs intermediate frames through
            # draw_matrices_fast directly (FX mode already active above).
            # Only animate transitions for user-initiated content changes.
            # Retries, periodic refreshes, and health-recovery turn_on calls
            # skip the animation to avoid re-triggering long transitions that
            # previously caused hard-timeout cascades.
            _TRANSITION_ANIMATE_TYPES = {
                'text_change', 'color_change', 'pixel_art',
            }
            # _last_sent_colors is whatever direct-mode frame was on the panel
            # BEFORE it last left for a firmware renderer (clock / native
            # effect / Music Flow) -- the firmware draws those itself, so it
            # was never updated in the meantime and does NOT reflect what the
            # lamp is actually showing now.  Animating from it would morph
            # from that stale, no-longer-true frame instead of cutting
            # straight to the new one -- visible as the previous direct-mode
            # content (e.g. an old pixel art) briefly reappearing.
            if (self._transition_type != "none"
                    and self._last_sent_colors is not None
                    and not self._transition_active
                    and not leaving_native_fw_mode
                    and self._current_update_type in _TRANSITION_ANIMATE_TYPES):
                target_colors = frame
                # Only animate when content actually changed
                if target_colors != self._last_sent_colors:
                    try:
                        await self._run_transition(self._last_sent_colors, target_colors)
                    except Exception as e:
                        _LOGGER.warning("[TRANSITION] [%s] Transition aborted: %s", self._ip, e)
                    # The transition drew its frames into the layout: put the
                    # target frame back.
                    self._write_layout_colors(frame)
                    # Clean TCP for final frame: close the persistent socket used
                    # for transition frames and re-activate FX on fresh TCP so the
                    # final authoritative frame goes on a pristine connection.
                    try:
                        await self.ensure_fx_ready()
                    except Exception as e:
                        _LOGGER.warning(
                            "[TRANSITION] [%s] Post-transition FX re-activation failed: %s", self._ip, e
                        )
            
            lamp_frame = self._lamp_frame(frame)
            raw_rgb_data = encode_rgb_frame(lamp_frame)

            _apply_t0 = time.time()

            # Count lit pixels for diagnostic logging
            lit = sum(1 for rgb in frame if tuple(rgb) != (0, 0, 0))
            idle_since_last_cmd = time.time() - self._cube_matrix.last_command_time if self._cube_matrix.last_command_time > 0 else -1
            
            _LOGGER.debug(
                "[APPLY] [%s] Sending update_leds: "
                "%s lit / %s dark pixels, power=%.1fW%s "
                "text='%s' mode='%s' "
                "idle=%.1fs fx_age=%.0fs "
                "bright=%s/255 hw=%s%% darken=%s%%",
                self._ip, lit, 100 - lit,
                # estimated draw of the frame sent (see lamp_power.py)
                self._last_frame_power,
                "" if lamp_frame is frame else
                f" (limited from {estimated_power(frame, hardware_brightness or 100):.1f}W)",
                (self._custom_text or '')[:10], self._mode,
                idle_since_last_cmd, time.time() - self._last_fx_mode_time,
                self._brightness, hardware_brightness, darken_percent
            )
            
            _t_before_send = time.time()
            await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
            _t_after_send = time.time()
            # Refresh the FX mode timestamp on every successful draw.  Without
            # this the staleness clock keeps running from the last
            # activate_fx_mode call, so any periodic trigger (e.g. a 60 s
            # sensor update) exceeds the threshold and forces an unnecessary
            # full re-activation which briefly shows the default Yeelight ribbon
            # before the pixel data arrives.
            self._last_fx_mode_time = _t_after_send
            _LOGGER.debug(
                "[TIMING] [%s] TCP draw_matrices_fast: %.1fms", self._ip, (_t_after_send - _t_before_send)*1000)
            
            # POST-SEND RECONNECTION CHECK: If the socket reconnected during
            # draw_matrices, pixels were sent on a non-FX socket -- silently
            # ignored.  Mark FX as not active so the next update re-activates.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.debug(
                    "[APPLY] [%s] Socket reconnected during update_leds -- "
                    "FX mode lost, will re-activate on next update",
                    self._ip
                )
                raise CubeFxModeLost("Socket reconnected during pixel send -- FX re-activation needed")

            # NATIVE-EXIT RE-SEND: When leaving a firmware-native renderer, the
            # first update_leds above can be dropped while the firmware finishes
            # switching into direct mode.  The socket is now healthy and in
            # direct mode (the reconnect check above passed), so re-send the same
            # frame once -- this is the deterministic equivalent of the manual
            # second send that was previously needed.
            if leaving_native_fw_mode:
                await asyncio.sleep(0.12)
                _LOGGER.debug(
                    "[APPLY] [%s] Native-exit re-send of first frame "
                    "(firmware just left clock/native mode)",
                    self._ip
                )
                await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
                self._last_fx_mode_time = time.time()
                if self._cube_matrix.consume_reconnected_flag():
                    self._fx_mode_is_direct = False
                    _LOGGER.debug(
                        "[APPLY] [%s] Socket reconnected during native-exit "
                        "re-send -- FX mode lost, will re-activate on next update",
                        self._ip
                    )
                    raise CubeFxModeLost("Socket reconnected during native-exit re-send")
            
            # Track that this darken% was successfully rendered to lamp pixels.
            # This keeps _last_applied_darken accurate even when apply() is called
            # by display-mode changes (draw pixel, text update, etc.) rather than
            # by _internal_set_brightness.  Without this, the next brightness
            # slider drag could see a stale _last_applied_darken and trigger a
            # redundant display update for a darken that was already rendered.
            self._last_applied_darken = self._preview_darken
            
            # Store the final colors that were sent to the lamp for future transitions
            self._last_sent_colors = list(frame)
            
            # IMPORTANT: When we send pixel data, the lamp automatically turns on
            # So we must update our internal state to match the hardware state
            if not self._is_on:
                _LOGGER.debug("[APPLY] Lamp auto-turned on by pixel data, updating state")
                self._is_on = True
            
            # Render camera images + push camera state FIRST so the image
            # is already cached when the light state change triggers the
            # frontend's HTTP fetch.  This eliminates the double-request.
            if self.hass is not None:
                _t_state_push = time.time()
                self._notify_camera_preview()
                _t_after_cam = time.time()
                self.async_schedule_update_ha_state()
                _t_done = time.time()
                _LOGGER.debug(
                    "[TIMING] [%s] apply pipeline: "
                    "send=%.1fms "
                    "post_delay=%.1fms "
                    "camera_render=%.1fms "
                    "state_push=%.1fms "
                    "total=%.1fms "
                    "epoch=%.3f",
                    self._ip, (_t_after_send - _t_before_send)*1000,
                    (_t_state_push - _t_after_send)*1000,
                    (_t_after_cam - _t_state_push)*1000, (_t_done - _t_after_cam)*1000,
                    (_t_done - _apply_t0)*1000, _t_done
                )
            
        except BulbException as e:
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_code = error_dict.get('code', 0)
            error_message = error_dict.get('message', str(e))
            
            self._last_connection_error = f"BulbException: {error_message}"
            connection_lost = isinstance(e, CubeConnectionError)
            if connection_lost:
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if connection_lost:
                _LOGGER.debug(
                    "[APPLY] [%s] BulbException (connection): code=%s, "
                    "msg='%s' -- re-raising for retry",
                    self._ip, error_code, error_message
                )
            else:
                _LOGGER.warning(
                    "[APPLY] [%s] BulbException: code=%s, "
                    "msg='%s' -- re-raising for retry",
                    self._ip, error_code, error_message
                )
            raise
            
        except Exception as e:
            msg = str(e)
            self._last_connection_error = msg
            connection_lost = is_connection_error(e)
            if connection_lost:
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if connection_lost:
                _LOGGER.debug(
                    "[APPLY] [%s] Connection issue: %s: %s -- re-raising for retry", self._ip, type(e).__name__, msg
                )
            else:
                _LOGGER.error("[APPLY] [%s] Unexpected error: %s: %s", self._ip, type(e).__name__, e)
            raise
        finally:
                if self.hass is not None:
                    self.async_schedule_update_ha_state()

    # Text scrolling functionality
    def start_scroll_timer(self, delay=None):
        """Start the auto-scroll timer for long text"""
        if self._scroll_timer is not None:
            self._scroll_timer.cancel()
        
        if self._max_scroll_offset <= 0:
            return
            
        # Use custom delay or default scroll speed
        scroll_delay = delay if delay is not None else self._scroll_speed
            
        # Schedule the next scroll step
        self._scroll_timer = self.hass.loop.call_later(
            scroll_delay,
            self._handle_scroll_step
        )
        _LOGGER.debug("[SCROLL] Timer started, next step in %ss", scroll_delay)

    def _handle_scroll_step(self):
        """Handle a single scroll step"""
        _LOGGER.debug("[SCROLL_DEBUG] _handle_scroll_step called - text: '%s'", self._custom_text)
        if self._max_scroll_offset <= 0:
            return
            
        # Update scroll position
        self._scroll_offset += self._scroll_direction
        
        # Check for direction change at boundaries
        if self._scroll_offset >= self._max_scroll_offset:
            self._scroll_offset = self._max_scroll_offset
            self._scroll_direction = -1  # Start scrolling back
        elif self._scroll_offset <= 0:
            self._scroll_offset = 0
            self._scroll_direction = 1  # Start scrolling forward
        
        _LOGGER.debug("[SCROLL_DEBUG] Scroll step: offset=%s, direction=%s, max=%s", self._scroll_offset, self._scroll_direction, self._max_scroll_offset)
        
        # Update display and continue scrolling (fire-and-forget to avoid blocking scroll timer)
        # Don't await here - let the queue handle it asynchronously
        # This prevents queue processing delays from slowing down the scroll animation
        self._create_tracked_task(
            self.async_apply_display_mode(),
            name=f"yeelight_cube_scroll_step_{self._ip}"
        )
        
        # Determine timer delay - first and last positions pause longer
        if self._scroll_offset == 0 or self._scroll_offset == self._max_scroll_offset:
            # First or last position: pause for twice the scroll speed
            delay = self._scroll_speed * 2
            _LOGGER.debug("[SCROLL_DEBUG] Pausing at boundary position for %ss", delay)
        else:
            # Normal position: use the scroll speed
            delay = self._scroll_speed
        
        self.start_scroll_timer(delay)

    def stop_scroll_timer(self):
        """Stop the auto-scroll timer"""
        if self._scroll_timer is not None:
            self._scroll_timer.cancel()
            self._scroll_timer = None
        _LOGGER.debug("[SCROLL] Timer stopped")
