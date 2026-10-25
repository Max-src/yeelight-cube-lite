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
    trace_frame,
    CubeConnectionError,
    CubeFxModeLost,
    encode_rgb_frame,
    is_connection_error,
)
from .lamp_power import estimated_power
from .light_color import hardware_brightness_for

_LOGGER = logging.getLogger(__name__)

# The waits around direct mode, in seconds, by the connection in use
# (cube_matrix.transport), read where each one happens:
# - native_exit_settle: leaving a firmware mode (clock, effect), before
#   activate_fx_mode, so the native renderer settles (light.ensure_fx_ready);
# - direct_mode_settle: after activate_fx_mode, before the first frame;
# - native_exit_resend: leaving a firmware mode, before the first frame is
#   sent once more (it can be dropped while the firmware switches; apply());
# - staleness: direct mode is activated again before a frame when none was
#   drawn for this long (an idle Cube could leave it silently, ignoring
#   update_leds without an error); None: never;
# - blank_repeat: leaving a drawing for a firmware mode, the black frame is
#   sent again this long after the first (None: once). Over UDP a frame is
#   not acknowledged: a dropped one left the drawing in the lamp, shown again
#   for a moment when the drawing came back (seen twice in 22 effect exits,
#   18 Oct 2026). Over TCP it arrives (and a second one would wait ~1 s).
# UDP: tested on both lamps with them watched (18 Oct 2026): clock and effect
# to a drawing at these waits, 3 rounds, no flash and no lost first frame
# (0.3 / 0.15 / 0.12 too); a drawing shown after 150 s without a frame, at
# once (a session the lamp dropped while idle is put in direct mode again
# when it opens: cube_matrix _udp_request). TCP: the waits tuned in the TCP
# days, kept (not tested again).
ACTIVATION_TIMING = {
    "udp": {"native_exit_settle": 0.0, "direct_mode_settle": 0.05, "native_exit_resend": 0.03,
            "staleness": None, "blank_repeat": 0.05},
    "tcp": {"native_exit_settle": 0.3, "direct_mode_settle": 0.15, "native_exit_resend": 0.12,
            "staleness": 90.0, "blank_repeat": None},
}
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
        if getattr(self, "_external_display", False) and update_type in {
            "display_update", "display_retry",
        }:
            return
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
            and not getattr(self, "_external_display", False)
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
        # drawing or fast slider changes). Redraws queued for the lamp are
        # coalesced instead (_execute_hardware_op, coalesce="display": only
        # the newest waiting one runs, and it draws the latest state).
        # Dropping here caused lost pixel art frames and missed state changes.
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
        
        async def apply_requested_display():
            # External control can arrive while this operation waits for the
            # device lock. Recheck before a queued retry/remote restore draws.
            if getattr(self, "_external_display", False) and (
                getattr(self, "_restoring_after_lamp", False)
                or update_type in {"display_update", "display_retry"}
            ):
                return
            await self._apply_display_mode_internal()

        # Execute the display update under the global lock with error handling
        return await self._execute_hardware_op(
            apply_requested_display,
            f"display:{update_type}",
            coalesce="display",
        )

    async def apply(self):
        try:
            if claim := getattr(self, "_claim_display", None):
                claim()
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
            
            # Direct mode is activated again below when it can no longer be
            # trusted (a reconnection, or idle too long).
            # Even an all-black frame used for logical "off" powers the lamp.
            if note_power := getattr(self, "_expect_lamp_power", None):
                note_power(True)
            self._direct_mode_trusted()

            # Ensure lamp is in direct FX mode before sending pixel data
            # (ensure_fx_ready: in the UDP session, else on a fresh TCP
            # connection -- the Cube sometimes ignores activate_fx_mode on a
            # reused persistent TCP socket).
            hardware_brightness = hardware_brightness_for(self._brightness)
            # Capture whether this apply is LEAVING a firmware-native renderer
            # (clock / native animation / color flow) BEFORE ensure_fx_ready()
            # clears the flag.  The firmware needs time to tear down the native
            # renderer after activate_fx_mode, and the FIRST update_leds can be
            # silently dropped during that window (accepted at TCP level, zero
            # visual effect) -- which is why a single send left the panel stuck
            # and a manual second send fixed it.  We re-send one frame below to
            # make the switch deterministic.
            leaving_native_fw_mode = self._in_native_fw_mode and not self._fx_mode_is_direct
            if not self._fx_mode_is_direct:
                await self.ensure_fx_ready()
            # The lamp's hardware brightness, before any frame of this update
            # and only when it differs (or is unknown): in direct mode a
            # set_bright after frames can make the lamp show an older picture
            # again (cube_matrix.FRAME_SETTLE_DELAY). Over TCP it goes on the
            # persistent socket, with the frames.
            if hardware_brightness != self._last_hardware_brightness:
                _LOGGER.debug(
                    "[BRIGHTNESS_DIAG] [%s] APPLY -- sending set_bright: "
                    "user=%s/255, hardware=%s%%, prev_hw=%s, mode='%s'",
                    self._ip, self._brightness, hardware_brightness,
                    self._last_hardware_brightness, self._mode
                )
                try:
                    await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                    self._last_hardware_brightness = hardware_brightness
                except Exception as e:
                    if is_connection_error(e):
                        raise
                    _LOGGER.debug(
                        "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright FAILED: %s", self._ip, e
                    )
            else:
                _LOGGER.debug(
                    "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright SKIPPED "
                    "(unchanged at %s%%)",
                    self._ip, hardware_brightness
                )

            # SNAPSHOT for _apply_brightness_only (fast path) and the published
            # colors (cards, camera): the frame with its color effects, but
            # without the brightness-dependent stages (low-brightness
            # correction, per-channel accuracy). The fast path therefore must
            # NOT apply the color effects again. The frame is read from the
            # layout once, processed as RGB tuples, written back once.
            frame = self._layout_colors()
            effects = self._has_color_effects
            if effects:
                frame = [self.apply_color_adjustments(rgb) for rgb in frame]
            self._base_matrix_colors = frame
            staged = self._brightness_stages(frame)
            if effects or staged is not frame:
                self._write_layout_colors(staged)
            frame = staged

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
                "bright=%s/255 hw=%s%%",
                self._ip, lit, 100 - lit,
                # estimated draw of the frame sent (see lamp_power.py)
                self._last_frame_power,
                "" if lamp_frame is frame else
                f" (limited from {estimated_power(frame, hardware_brightness or 100):.1f}W)",
                (self._custom_text or '')[:10], self._mode,
                idle_since_last_cmd, time.time() - self._last_fx_mode_time,
                self._brightness, hardware_brightness
            )
            
            _t_before_send = time.time()
            trace_frame(self._ip, "frame", raw_rgb_data)
            await self._draw_direct(raw_rgb_data)
            _t_after_send = time.time()
            # Refresh the FX mode timestamp on every successful draw.  Without
            # this the staleness clock keeps running from the last
            # activate_fx_mode call, so any periodic trigger (e.g. a 60 s
            # sensor update) exceeds the threshold and forces an unnecessary
            # full re-activation which briefly shows the default Yeelight ribbon
            # before the pixel data arrives.
            self._last_fx_mode_time = _t_after_send
            _LOGGER.debug(
                "[TIMING] [%s] draw_matrices_fast: %.1fms", self._ip, (_t_after_send - _t_before_send)*1000)

            # NATIVE-EXIT RE-SEND: When leaving a firmware-native renderer, the
            # first update_leds above can be dropped while the firmware finishes
            # switching into direct mode.  The lamp is now in direct mode
            # (_draw_direct made sure of it), so re-send the same frame once --
            # this is the deterministic equivalent of the manual second send
            # that was previously needed.
            if leaving_native_fw_mode:
                await asyncio.sleep(ACTIVATION_TIMING[self._cube_matrix.transport]["native_exit_resend"])
                _LOGGER.debug(
                    "[APPLY] [%s] Native-exit re-send of first frame "
                    "(firmware just left clock/native mode)",
                    self._ip
                )
                trace_frame(self._ip, "native-exit re-send: frame", raw_rgb_data)
                await self._draw_direct(raw_rgb_data)
                self._last_fx_mode_time = time.time()

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

    def _direct_mode_trusted(self) -> bool:
        """Whether the lamp can still be trusted to be in direct mode; when
        not, _fx_mode_is_direct is cleared so it is activated again: the
        connection changed (TCP took over, a new TCP socket) or it was idle
        longer than its connection's staleness (ACTIVATION_TIMING; an idle Cube can leave direct
        mode silently)."""
        if self._cube_matrix.consume_reconnected_flag():
            _LOGGER.info(
                "[APPLY] [%s] Reconnection detected -- activating direct mode again "
                "(fx_direct was %s)", self._ip, self._fx_mode_is_direct,
            )
            self._fx_mode_is_direct = False
        elif self._fx_mode_is_direct and self._last_fx_mode_time > 0:
            fx_age = time.time() - self._last_fx_mode_time
            staleness = ACTIVATION_TIMING[self._cube_matrix.transport]["staleness"]
            if staleness is not None and fx_age > staleness:
                _LOGGER.debug(
                    "[APPLY] [%s] Direct mode stale -- fx_age=%.0fs > %.0fs: activating it again",
                    self._ip, fx_age, staleness,
                )
                self._fx_mode_is_direct = False
        return self._fx_mode_is_direct

    async def _draw_direct(self, raw_rgb_data: str) -> None:
        """Draw a frame in direct mode. When the connection changed under it
        (TCP took over from UDP, or a new TCP socket), the frame went where
        direct mode is not on: it is activated there and the frame drawn
        again, at once -- without a retry, and without sending the
        brightness again (unchanged; a set_bright after frames can bring an
        older picture back). Raises CubeFxModeLost if it changes again."""
        await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
        if not self._cube_matrix.consume_reconnected_flag():
            return
        _LOGGER.debug(
            "[APPLY] [%s] Connection changed during update_leds -- "
            "direct mode again, frame again", self._ip,
        )
        await self.ensure_fx_ready()
        await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
        if self._cube_matrix.consume_reconnected_flag():
            self._fx_mode_is_direct = False
            raise CubeFxModeLost("Connection changed again during update_leds -- FX re-activation needed")

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
