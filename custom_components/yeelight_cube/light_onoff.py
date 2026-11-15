"""Turning the light on and off, direct mode, and the forced refresh.

Owns OnOffMixin: Home Assistant's turn_on and turn_off (async_turn_on,
async_turn_off, run under the lamp's lock by _internal_turn_on and
_internal_turn_off: a lamp mode is powered, a Matrix render is drawn or
blanked), the activation of the lamp's direct mode before frames
(ensure_fx_ready), and the Force refresh button's re-render
(async_force_refresh).
Used only as a mixin of :class:`YeelightCubeLight` (light.py).
"""
import logging
import asyncio
import time
from .matter_commands import MatterCommandsUnavailable
from .const import LAMP_MODES, MODE_CLOCK, MODE_NATIVE_EFFECT
from .lamp_protocol import LAMP_ERRORS, is_quota_error
from .light_display import ACTIVATION_TIMING

_LOGGER = logging.getLogger(__name__)


class OnOffMixin:
    """Turning the light on and off (light_onoff.py)."""

    async def ensure_fx_ready(self):
        """Ensure FX mode is active: activate_fx_mode in the lamp's UDP session
        (where the frames then go too: direct mode applies to the session it
        was activated in), else on one fresh TCP connection.

        Steps:
          1. Close any existing persistent TCP socket (clean slate)
          2. Optional 300ms settle when leaving a built-in mode
          3. Send activate_fx_mode (UDP session, else a fresh TCP connection, RST-closed)
          4. Sleep 150ms -- the lamp's settle time before opening the persistent socket
          5. Update state flags

        The lamp's hardware brightness is left as it is (and as known):
        apply() sends set_bright before its frames only when it differs (or
        is unknown). A set_bright after frames in direct mode can make the
        lamp show an older picture again (see lamp_client_udp.FRAME_SETTLE_DELAY),
        so activating direct mode again never forces one. Over TCP, apply()
        sends it on the persistent socket, with the frames: an extra RST
        connection made the lamp exit direct mode before update_leds
        arrived ("illegal request" errors).

        Why no TCP probe:
        A probe RST before activate_fx_mode was a third rapid RST connection
        that could confuse the Cube. Dead devices are handled by the
        APPLY_HARD_TIMEOUT / circuit-breaker mechanism instead.
        """
        cm = self._lamp_client

        _LOGGER.debug(
            "[ENSURE_FX] [%s] Activating FX mode via raw TCP "
            "[%s]",
            self._ip, cm.summary
        )

        # Step 1: Kill persistent socket
        cm.close_fast_socket()

        # Step 2 (optional): When leaving a built-in mode (clock, native
        # animation, color flow), give the lamp time to settle
        # before we open a new connection.  This shortens the Ribbon flicker.
        #
        # activate_fx_mode is always RST-closed (abortive_close=True, the
        # default).  A graceful FIN here caused the lamp to silently ignore
        # the mode change, leaving the lamp stuck on the ribbon indefinitely.
        coming_from_native = self._in_native_fw_mode
        if coming_from_native:
            _LOGGER.debug(
                "[ENSURE_FX] [%s] Coming from native mode -- settling before "
                "activate_fx_mode",
                self._ip,
            )
            await asyncio.sleep(ACTIVATION_TIMING[cm.transport]["native_exit_settle"])

        # Step 3: activate_fx_mode on a SINGLE fresh TCP (RST close)
        await cm.send_raw_command("activate_fx_mode", [{"mode": "direct"}])

        # Step 4: Let the lamp fully enter direct mode before the first
        # frame (ACTIVATION_TIMING, by connection: 50ms was too tight over TCP,
        # where the lamp left direct mode before update_leds arrived).
        await asyncio.sleep(ACTIVATION_TIMING[cm.transport]["direct_mode_settle"])

        # Step 5: Update state (the hardware brightness is unchanged).
        self._entered_direct_mode()
        self._last_fx_mode_time = time.time()
        # Direct mode is active again on the transport in use: a reconnection
        # noticed before this (e.g. UDP falling back to TCP) is settled, and
        # must not make the next frame report direct mode as lost.
        cm.consume_reconnected_flag()

        _LOGGER.debug(
            "[ENSURE_FX] [%s] [OK] FX activated", self._ip
        )

    async def _force_refresh_impl(self):
        """Force refresh implementation - runs inside _execute_hardware_op lock.
        
        Reconnects the active renderer and re-renders its current display.
        
        It re-renders through _apply_display_mode_internal() rather than
        re-sending self._layout: apply() writes the lamp-only stages (color
        effects, low-brightness correction) into the layout, so they would
        be applied twice. Since ensure_fx_ready() already set
        _fx_mode_is_direct=True, apply() skips a second activation.
        """
        if not self._is_on or self._music_flow_enabled:
            return
        if getattr(self, "is_cube_matrix", False):
            # Sent again in full: unchanged, a Cube Matrix's effect or clock
            # would be an empty live change (light_matrix).
            self._matrix_shown = None
        if self._mode in LAMP_MODES:
            self._lamp_client.close_fast_socket()
        else:
            # Its brightness is confirmed too (sent right after direct mode,
            # before any frame): something else may have changed it.
            self._forget_hardware_brightness()
            await self.ensure_fx_ready()
        
        # Re-render through the full display pipeline (see the docstring).
        await self._apply_display_mode_internal()
        _LOGGER.info(
            "[FORCE REFRESH] [%s] Complete - "
            "mode=%s, brightness=%s%%, "
            "display re-rendered",
            self._ip, self._mode, self._last_hardware_brightness
        )

    async def async_force_refresh(self):
        """Force refresh via _execute_hardware_op (properly serialized with device lock)."""
        if not self._is_on:
            return
        if self._music_flow_enabled:
            await self.async_set_music_flow(True)
            return
        _LOGGER.info(
            "[FORCE REFRESH] [%s] Starting -- "
            "closing persistent socket and using raw TCP",
            self._ip
        )
        await self._execute_hardware_op(
            lambda: self._force_refresh_impl(),
            "force_refresh"
        )

    async def async_turn_on(self, **kwargs):
        """Turn on the light."""
        _LOGGER.debug("[TURN_ON] async_turn_on called with kwargs: %s", kwargs)
        
        # Calibration lock: ignore automation turn_on (incl. light.turn_on with
        # brightness/color/text) while the wizard owns the lamp.
        if self._calibration_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] turn_on ignored -- calibration lock active", self._ip
            )
            return

        # Remember whether the lamp was already on: a brightness-only turn_on on
        # an already-running native effect must not re-activate it (that restarts
        # the animation from frame zero), it should only push the new brightness.
        was_on = self._is_on

        if any(key in kwargs for key in ("rgb_color", "text_colors")) and (
            self._rotation_active
            or self._rotation_resume_pending
        ):
            self.stop_effect_rotation()

        # Brightness remains adjustable while Music Flow owns the display.
        # Explicit color content must first release the lamp's own renderer so
        # the requested RGB/text colors are not silently ignored.
        if self._music_flow_enabled and any(
            key in kwargs for key in ("rgb_color", "text_colors")
        ):
            await self.async_set_music_flow(False, restore_display=False)
        
        # Update HA state IMMEDIATELY for responsive UI
        self._is_on = True
        if "brightness" in kwargs:
            self._brightness = max(1, min(255, kwargs["brightness"]))
        if "rgb_color" in kwargs:
            self._rgb_color = tuple(kwargs["rgb_color"])
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        # A brightness change on a lamp that is on (a slider drag): only the
        # newest waiting one runs, like set_brightness's. One that turns the
        # lamp on, or changes anything else, always runs.
        brightness_only = was_on and set(kwargs) == {"brightness"}
        await self._execute_hardware_op(
            lambda: self._internal_turn_on(_was_on=was_on, **kwargs),
            "turn_on",
            coalesce="brightness" if brightness_only else None,
        )
    
    async def _internal_turn_on(self, **kwargs):
        """Internal turn_on implementation -- runs under the global lock."""
        was_on = kwargs.pop("_was_on", False)
        _LOGGER.debug("[TURN_ON] Executing - is_on: %s, custom_text: '%s', mode: '%s'", self._is_on, self._custom_text, self._mode)

        if self._music_flow_enabled:
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
                await self._set_native_mode_brightness()
            self._is_on = True
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return

        if self._mode == MODE_CLOCK:
            self._is_on = True
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
            # Brightness-only change on the already-running clock: just push the
            # brightness so the clock is not torn down and rebuilt.
            if was_on and set(kwargs) <= {"brightness"}:
                await self._set_native_mode_brightness()
            else:
                await self._activate_native_clock()
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return
        if self._mode == MODE_NATIVE_EFFECT:
            self._is_on = True
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
            # Brightness-only change on an already-running effect: push the new
            # brightness only. Re-activating here would restart the animation
            # from the first frame (mirrors _internal_set_brightness).
            if was_on and set(kwargs) <= {"brightness"}:
                await self._set_native_mode_brightness()
            else:
                await self._activate_native_effect()
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return
        
        # Direct mode first (apply() then sends the brightness, if it differs,
        # before the frames).
        if not self._fx_mode_is_direct:
            _LOGGER.debug("[TURN_ON] Activating FX mode via raw TCP")
            await self.ensure_fx_ready()
        
        self._is_on = True
        
        # Handle colors from kwargs
        if "text_colors" in kwargs:
            _LOGGER.debug("[TURN_ON] Setting text_colors from kwargs: %s", kwargs['text_colors'])
            self._text_colors = [tuple(c) for c in kwargs["text_colors"]]
            self._sync_rgb_color()
        
        if "rgb_color" in kwargs:
            rgb_color = kwargs["rgb_color"]
            _LOGGER.debug("[TURN_ON] RGB color selected: %s", rgb_color)
            self._text_colors = [tuple(rgb_color)]
            self._sync_rgb_color()
        
        _LOGGER.debug("[TURN_ON] Current state - text_colors: %s, background: %s", self._text_colors, self._background_color)
        
        try:
            if "brightness" in kwargs:
                _LOGGER.debug("[TURN_ON] Setting brightness to %s", kwargs["brightness"])
                self._brightness = kwargs["brightness"]
            self._brightness = max(1, min(255, self._brightness))
            # The full display in one pass: direct mode if needed, the
            # brightness if it changed (before any frame), then the frame --
            # also when only the brightness is new (the lamp was showing black).
            await self._apply_display_mode_internal()
        except (*LAMP_ERRORS, MatterCommandsUnavailable) as e:
            if is_quota_error(e):
                _LOGGER.debug("Rate limit exceeded during turn_on")
            elif isinstance(e, TimeoutError):
                _LOGGER.warning("Timeout during turn_on - device may be unreachable")
            else:
                _LOGGER.error("Unexpected error during turn_on: %s", e)
        
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug("[TURN_ON] Turn on complete")

    async def async_turn_off(self, **kwargs):
        """Turn off the light."""
        _LOGGER.debug("[TURN_OFF] async_turn_off called")
        
        # Calibration lock: ignore automation turn_off while the wizard runs.
        if self._calibration_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] turn_off ignored -- calibration lock active", self._ip
            )
            return
        
        # Update HA state IMMEDIATELY for responsive UI
        self._is_on = False
        self.stop_effect_rotation()
        # A scrolling text stops with the lamp: its next step would draw the
        # text again (and turn the lamp back on with auto-turn-on). Turning on
        # draws the text, which starts it again.
        self._set_scrolling(False)
        self.stop_scroll_timer()
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_turn_off(**kwargs),
            "turn_off"
        )
    
    async def _internal_turn_off(self, **kwargs):
        """Internal turn_off implementation that executes in the queue."""
        _LOGGER.debug("[TURN_OFF] Executing turn_off")
        was_music_flow_enabled = self._music_flow_enabled
        # Buttons: Wake Lamp When Off turned off: "off" is a black picture on
        # a powered lamp, as for a drawing, so a remote button's press still
        # reaches the integration (a powered-down lamp's click only powers
        # it on).
        keep_powered = getattr(self, "remote_keeps_lamp_powered", False)
        if (was_music_flow_enabled or self._mode in LAMP_MODES) and not keep_powered:
            self._lamp_client.close_fast_socket()
            if note_power := getattr(self, "_expect_lamp_power", None):
                note_power(False)
            await self._lamp_client.send_raw_command("set_power", ["off"])
            # Powered off: its brightness is set again on the way back.
            self._forget_hardware_brightness()
            # A Cube Matrix: its effect is sent in full on the way back (a
            # Matter effect powers it on; a live change would not, filmed
            # 2026-11-10).
            self._matrix_shown = None
        else:
            if was_music_flow_enabled:
                await self._send_music_off()
            await self.erase_all()
            await self.apply(off_frame=True)
        self._is_on = False
        self._music_flow_enabled = False
        self._music_flow_restore_power = None
        if was_music_flow_enabled:
            await self._persist_music_flow_runtime_state()
            self._refresh_music_flow_entities()
        self._notify_camera_preview()
        # NOTE: Do NOT reset _fx_mode_is_direct here!
        # The FX socket is still alive after sending blank pixel data.
        # On turn_on we just reuse the existing socket -- no activate_fx_mode
        # needed.  If the socket dies while off (Cube idle timeout), the
        # natural error-detection in send_command_fast / apply() will detect
        # it and re-activate FX mode automatically.
        # Previously this was set to False, which forced EVERY turn_on to
        # close the socket, wait 300ms, and open a new one for
        # activate_fx_mode -- a cycle that timed out ~50% of the time.
        # In direct mode "off" is a black picture: the lamp's hardware
        # brightness is unchanged, so it is not sent again when it comes back
        # on (a set_bright after frames can bring an older picture back).
        self._last_apply_time = 0  # Reset cooldown timer to ensure turn_on will work immediately
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug("[TURN_OFF] Turn off complete")
