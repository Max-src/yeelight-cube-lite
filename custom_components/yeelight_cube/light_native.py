"""Firmware-native mode activation for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin.  Covers the two firmware-rendered modes the
plugin cannot draw pixel-by-pixel: the built-in Clock and the built-in native
animations.  These build the ``set_fx_effect`` payloads and hand them to the
device.  Reads/writes state via ``self``; used only as a mixin.
"""
import asyncio
import base64
import json
import logging
from .native_effect_preview import effect_supports_color_mode, effect_supports_color_override
from .color_utils import rgb_to_argb
from .light_color import hardware_brightness_for
from .cube_matrix import CubeConnectionError, encode_rgb_frame
from .light_display import ACTIVATION_TIMING

from homeassistant.util import dt as dt_util  # type: ignore

from .errors import failed
from .storage import async_save_data
from .const import (
    MODE_CLOCK,
    ALL_NATIVE_EFFECTS,
    CLOCK_COLOR_MODES,
    CLOCK_MIXER_COMMAND_IDS,
    CLOCK_MIXER_EFFECTS,
    clock_style_default_color,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
    DEVICE_ORIENTATION_TO_EFFECT_DIR,
    DOMAIN,
    MUSIC_FLOW_DEFAULT_PALETTE,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_CONTENT_BYTE,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_APPLY,
    LIVE_EFFECT_KEYS,
    effect_direction_value,
    resolve_clock_mixer_direction,
)

_LOGGER = logging.getLogger(__name__)
MUSIC_FLOW_HARD_TIMEOUT = 12.0

# Physical device orientation -> native effect flow direction. Imported lazily
# from light.py at call time to avoid a circular import at module load.


def _build_music_flow_payload(enabled: bool, effect_name: str) -> str:
    """Build the private-protocol JSON used by device-microphone music flow."""
    payload = {"on": 1 if enabled else 0}
    if enabled:
        if effect_name not in MUSIC_FLOW_EFFECTS:
            raise ValueError(f"Unsupported music flow effect: {effect_name}")
        payload["effect_id"] = MUSIC_FLOW_EFFECTS[effect_name]
        # The misspelling is part of the device's private protocol.
        payload["palatte"] = list(MUSIC_FLOW_DEFAULT_PALETTE)
    return json.dumps(payload, separators=(",", ":"))


def live_effect_changes(running: list | None, params: list) -> dict | None:
    """The update_fx_effect settings (LIVE_EFFECT_KEYS) that turn the running
    effect (``running``, its set_fx_effect params) into ``params``. None when
    that takes a full set_fx_effect: a color set (see LIVE_EFFECT_KEYS),
    another effect, palette or setting, a live setting added or removed, or
    nothing changed (a full activation then re-asserts it, as before)."""
    if not running or len(running) != len(params):
        return None
    *old_head, old = running
    *new_head, new = params
    if old_head != new_head or not isinstance(old, dict) or not isinstance(new, dict):
        return None
    if set(old) != set(new) or "color" in new:
        return None
    if any(old[key] != new[key] for key in new if key not in LIVE_EFFECT_KEYS):
        return None
    changes = {
        key: new[key] for key in LIVE_EFFECT_KEYS if key in new and old[key] != new[key]
    }
    return changes or None


class NativeModesMixin:
    """Activate and configure the firmware Clock and native animations."""

    async def _leave_direct_mode(self) -> None:
        """Prepare to hand the panel to the firmware (clock, native effect,
        Music Flow): blank the direct-mode frame and close the drawing socket.

        The lamp keeps the last direct-mode frame and shows it again the
        moment direct mode is re-activated, about 200 ms before the next frame
        can arrive (activate_fx_mode needs its settle time). Without this,
        going back from a clock or effect to a drawing briefly shows the
        previous drawing. A black frame makes that moment dark instead; over
        UDP it is sent twice (ACTIVATION_TIMING blank_repeat), as a frame
        there is not acknowledged.
        """
        if self._fx_mode_is_direct:
            blank = encode_rgb_frame([(0, 0, 0)] * len(self._layout.device_layout))
            repeat = ACTIVATION_TIMING[self._cube_matrix.transport]["blank_repeat"]
            try:
                await self._cube_matrix.draw_matrices_fast(blank)
                if repeat is not None:
                    await asyncio.sleep(repeat)
                    await self._cube_matrix.draw_matrices_fast(blank)
            except Exception as err:  # noqa: BLE001 -- best effort, the switch goes on
                _LOGGER.debug("[%s] Could not blank the direct-mode frame: %s", self._ip, err)
        self._cube_matrix.close_fast_socket()

    def _native_brightness_due(self) -> bool:
        """Whether the lamp's brightness differs from the one set (or is not
        known): only then is it sent. Switching effects or clock styles keeps
        it (an effect's settings carry no brightness), so it is not sent
        again with each one."""
        return hardware_brightness_for(self._brightness) != self._last_hardware_brightness

    async def _set_native_mode_brightness(self) -> bool:
        """Send the brightness while a firmware mode is active, when it is
        due (_native_brightness_due). Returns whether it was sent."""
        if not self._native_brightness_due():
            return False
        level = hardware_brightness_for(self._brightness)
        await self._cube_matrix.send_raw_command("set_bright", [level])
        self._last_hardware_brightness = level
        return True

    @staticmethod
    def _native_clock_timezone_hours() -> int:
        """Return the current local UTC offset in whole hours."""
        offset = dt_util.now().utcoffset()
        return int(offset.total_seconds() / 3600) if offset else 0

    def _native_clock_data_bytes(self) -> bytes:
        """Build the 4-byte clock payload sent inside the set_fx_effect data field.

        Byte 0: 1 = time only, 2 = alternate time/date, 3 = date only
        Byte 1: timezone offset in whole hours (signed, wrapped to u8)
        Byte 2: 0 = 24-hour, 1 = 12-hour
        Byte 3: 0 = blink colon, 1 = steady colon
        """
        timezone_hours = self._native_clock_timezone_hours()
        return bytes(
            (
                NATIVE_CLOCK_CONTENT_BYTE.get(self._native_clock_content, 1),
                timezone_hours & 0xFF,
                1 if self._native_clock_12_hour else 0,
                # Firmware flag is inverted: 0 blinks, 1 keeps the colon steady.
                0 if self._native_clock_colon_blink else 1,
            )
        )

    async def async_set_native_clock_content(self, content: str) -> None:
        """Set the 3-way clock content and re-render if the clock is showing.

        ``content`` is one of "time", "time_date" (alternate) or "date".  Keeps
        the legacy ``_native_clock_show_date`` boolean and the linked switch /
        select helper entities in sync.
        """
        if content not in NATIVE_CLOCK_CONTENT_OPTIONS:
            _LOGGER.error("Invalid clock content: %s", content)
            return
        self._native_clock_content = content
        self._native_clock_show_date = content == "time_date"
        if self._is_on and self._mode == MODE_CLOCK:
            await self.async_apply_display_mode(update_type="color_change")
        if self._clock_content_select_entity:
            self._clock_content_select_entity.async_update_from_light()
        if self._clock_show_date_switch_entity:
            self._clock_show_date_switch_entity.async_update_from_light()
        if self.hass is not None:
            self.async_write_ha_state()

    def _resolve_native_clock_color(self, style: dict) -> int | None:
        """Return the ARGB color integer to send for the current clock style.

        Priority: user override (``_native_clock_color`` attribute) > style
        default (its own color, else its mixer effect's default color).
        """
        override = self._native_clock_color
        if override is not None:
            return override
        return clock_style_default_color(style)

    async def _activate_native_clock(self) -> None:
        """Activate the Cube Lite firmware clock through Yeelight LAN control,
        always in full (no live update: it left the clock dark)."""
        timezone_hours = self._native_clock_timezone_hours()
        await self._send_native(self._native_clock_params(), clock=True)
        self._native_clock_timezone_offset = timezone_hours
        _LOGGER.debug(
            "[CLOCK] [%s] Native clock style=%s timezone=%+d",
            self._ip,
            self._native_clock_style,
            timezone_hours,
        )

    def _native_clock_params(self) -> list:
        """The set_fx_effect params of the selected clock style (mixer,
        speed, setting bytes, color or palette, mixer direction)."""
        style_id = self._native_clock_style
        style = NATIVE_CLOCK_STYLES.get(
            style_id,
            NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
        )
        clock_data = self._native_clock_data_bytes()
        effect_config = {
            "mode": NATIVE_CLOCK_EFFECT_ID,
            "mixer": style["mixer"],
            "rate": self._native_effect_speed,
            "data": base64.b64encode(clock_data).decode("ascii"),
        }
        clock_color = self._resolve_native_clock_color(style)
        # A palette color mode (B&W, Vivid, Retro Orange, ...) remaps an
        # animated effect's colors via the outer command id below; an
        # additionally injected color would conflict with that remap, so
        # clear it for any active mode - mirrors camera.py's preview and the
        # card's renderClockFrame(), which both drop the override whenever a
        # mode is active. Solid styles (no mixer effect) have no remap to
        # protect except B&W, which the firmware renders as plain white when
        # no color is sent.
        effect_name = CLOCK_MIXER_EFFECTS.get(style["mixer"])
        clock_color_mode = self._native_clock_color_mode
        if clock_color_mode == "bw" or (
            clock_color_mode != "normal" and effect_name is not None
        ):
            clock_color = None
        if clock_color is not None:
            effect_config["color"] = [int(clock_color)]

        # When the style's mixer is a direction-capable native effect, flow it
        # in the selected native-effect direction just like a native effect
        # (some firmware honours a direction byte on the clock payload).
        direction = resolve_clock_mixer_direction(
            self._native_effect_direction, effect_name
        )
        if direction is not None:
            effect_config["direction"] = effect_direction_value(
                ALL_NATIVE_EFFECTS[effect_name], direction
            )

        # A few mixers only render in full color when the outer command id
        # (first array element) is overridden; otherwise the default clock id is
        # used. The config still carries mode 40 so the clock face renders.
        command_id = CLOCK_MIXER_COMMAND_IDS.get(style["mixer"], NATIVE_CLOCK_EFFECT_ID)
        # A color-mode preset remaps the palette by forcing the outer command
        # id (B&W, Red-Blue, ...); it wins over the mixer's default command id.
        # Solid styles (mixer 0, e.g. White/Mint/Yellow/Pink/Red/Cyan/Purple)
        # have no animated renderer to remap - they already go B&W from the
        # color skip above, so leave their command id untouched.
        mode_override = CLOCK_COLOR_MODES.get(clock_color_mode)
        if mode_override is not None and effect_name is not None:
            command_id = mode_override
        return [
            command_id,
            style_id,
            NATIVE_CLOCK_APPLY,
            effect_config,
        ]

    async def _activate_native_effect(self) -> None:
        """Activate one of the Cube Lite firmware's built-in animations (live
        when only its speed or direction changed: _send_native)."""
        await self._send_native(self._native_effect_params())

    async def _send_native(self, params: list, *, clock: bool = False) -> None:
        """Show a firmware renderer: a native effect, or the clock.

        When the lamp still runs the same effect and only its speed or
        direction changed, those are updated live (update_fx_effect,
        LIVE_EFFECT_KEYS): the animation goes on instead of restarting from
        its first frame. The clock, and anything else (or a refused update),
        is set in full, as before, with the brightness when it changed
        (_set_native_mode_brightness): before set_fx_effect for an effect,
        after it for the clock (Cube Lite can drop the clock activation when
        set_bright resets a socket just before it; it takes the brightness
        once the clock runs). Each brightness has its pause (0.1 s) between
        it and set_fx_effect, and the clock its pause before it."""
        if not clock and await self._update_running_effect(params):
            return
        await self._leave_direct_mode()
        if clock:
            self._hardware_operation_phase = "clock:set_fx_effect"
            await asyncio.sleep(0.1)
        elif await self._set_native_mode_brightness():
            await asyncio.sleep(0.1)
        # The lamp's answer is checked: a refused activation (rate limit)
        # fails here instead of leaving HA believing it changed.
        await self._cube_matrix.send_raw_command(
            "set_fx_effect", params, abortive_close=not clock, check_reply=True
        )
        self._cube_matrix.note_running_effect(params)
        if clock and self._native_brightness_due():
            self._hardware_operation_phase = "clock:brightness"
            await asyncio.sleep(0.1)
            await self._set_native_mode_brightness()
        self._native_renderer_shown()

    async def _update_running_effect(self, params: list) -> bool:
        """Change the running effect live (live_effect_changes); False when
        that does not apply or the lamp refused it (then it is set in full)."""
        changes = live_effect_changes(self._cube_matrix.running_effect, params)
        if changes is None or not self._is_on or not self._in_native_fw_mode:
            return False
        try:
            await self._cube_matrix.send_raw_command(
                "update_fx_effect", [changes], check_reply=True
            )
        except Exception as err:  # noqa: BLE001 -- a full activation follows
            _LOGGER.debug(
                "[NATIVE] [%s] Live update %s refused (%s): activating in full",
                self._ip, changes, err,
            )
            return False
        self._cube_matrix.note_running_effect(params)
        _LOGGER.debug("[NATIVE] [%s] Running effect updated live: %s", self._ip, changes)
        self._native_renderer_shown()
        return True

    def _native_renderer_shown(self) -> None:
        """The lamp shows a firmware renderer (effect or clock): state and
        previews follow."""
        self._is_on = True
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True
        self._last_fx_mode_time = 0.0
        self._notify_camera_preview()
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    def _native_effect_params(self) -> list:
        """The set_fx_effect params of the selected native effect (speed,
        direction from the mount, palette, color)."""
        spec = ALL_NATIVE_EFFECTS.get(
            self._native_effect, ALL_NATIVE_EFFECTS[DEFAULT_NATIVE_EFFECT]
        )
        effect_config = {"mode": spec["mode"], "onoff": 1}
        if spec.get("speed"):
            effect_config["rate"] = self._native_effect_speed
        elif spec.get("rate") is not None:
            effect_config["rate"] = spec["rate"]
        directions = spec.get("directions")
        if directions:
            # The persistent device orientation is the source of truth for an
            # effect's flow direction. Derive the direction from the physical
            # mount at activation time so applying/selecting an effect (or a
            # reboot/restore) always honors the orientation arrows -- instead of
            # using a stale _native_effect_direction that only got synced when
            # the orientation was changed while already in Native Effect mode.
            desired = DEVICE_ORIENTATION_TO_EFFECT_DIR.get(self._device_orientation)
            if desired in directions and desired != self._native_effect_direction:
                self._native_effect_direction = desired
                if self._native_effect_direction_select_entity:
                    self._native_effect_direction_select_entity.async_update_from_light()
            if self._native_effect_direction not in directions:
                self._native_effect_direction = directions[0]
            effect_config["direction"] = effect_direction_value(
                spec, self._native_effect_direction
            )
        elif spec.get("direction_fixed") is not None:
            effect_config["direction"] = spec["direction_fixed"]
        color_mode = self._native_effect_color_mode
        palette_id = CLOCK_COLOR_MODES.get(color_mode)
        if not effect_supports_color_mode(self._native_effect, color_mode):
            palette_id = None
        if spec.get("color") is not None and palette_id is None:
            effect_config["color"] = [int(spec["color"])]
        color = self._native_effect_color
        if color is not None and color_mode == "normal" and effect_supports_color_override(self._native_effect):
            effect_config["color"] = [rgb_to_argb(color)]

        return [
            spec["effect_id"] if palette_id is None else palette_id,
            0,
            NATIVE_EFFECT_APPLY,
            effect_config,
        ]

    async def async_set_music_flow(
        self,
        enabled: bool,
        restore_display: bool = True,
    ) -> None:
        """Start or stop device-microphone music flow through private LAN control."""
        if enabled and (
            self._rotation_active
            or self._rotation_resume_pending
        ):
            self.stop_effect_rotation()

        async def _write_music_flow() -> None:
            was_music_flow_enabled = self._music_flow_enabled
            previous_power = self._is_on
            payload = _build_music_flow_payload(enabled, self._music_flow_effect)

            await self._leave_direct_mode()
            try:
                result = await self._cube_matrix.send_command_with_recovery(
                    "set_ps",
                    ["mic_music_mode", payload],
                )
                if result is None:
                    raise CubeConnectionError(
                        "Music flow command was skipped during connection cooldown"
                    )
            finally:
                self._cube_matrix.close_command_socket()

            self._music_flow_enabled = enabled
            try:
                if enabled:
                    if not was_music_flow_enabled:
                        self._music_flow_restore_power = previous_power
                    self._is_on = True
                    self._fx_mode_is_direct = False
                    self._in_native_fw_mode = True
                    self._last_fx_mode_time = 0.0
                    self._is_scrolling = False
                    self.stop_scroll_timer()
                elif not was_music_flow_enabled:
                    self._is_on = previous_power
                    self._music_flow_restore_power = None
                    self._in_native_fw_mode = False
                elif restore_display:
                    restore_power = self._music_flow_restore_power
                    # The device has already accepted mic_music_mode=off. Clear
                    # the marker even if restoring the prior display fails.
                    self._music_flow_restore_power = None
                    self._in_native_fw_mode = False
                    await asyncio.sleep(0.1)
                    if restore_power is False:
                        self._cube_matrix.close_fast_socket()
                        await self._cube_matrix.send_raw_command(
                            "set_power",
                            ["off"],
                        )
                        self._is_on = False
                    else:
                        self._is_on = True
                        await self._apply_display_mode_internal()
                else:
                    self._music_flow_restore_power = None
                    self._in_native_fw_mode = False
            finally:
                # Keep HA and restart recovery aligned with the command that
                # the device already accepted if the follow-up redraw fails.
                self._refresh_music_flow_entities()
                self._notify_camera_preview()
                if self.hass is not None:
                    self.async_write_ha_state()
                await self._persist_music_flow_runtime_state()

        success = await self._execute_hardware_op(
            _write_music_flow,
            "music_flow:on" if enabled else "music_flow:off",
            timeout_override=MUSIC_FLOW_HARD_TIMEOUT,
        )
        if not success:
            raise failed("music_flow_failed")

    async def async_set_music_flow_effect(self, option: str) -> None:
        """Select a device-microphone music flow effect."""
        if option not in MUSIC_FLOW_EFFECTS:
            raise ValueError(f"Unsupported music flow effect: {option}")
        previous_effect = self._music_flow_effect
        self._music_flow_effect = option
        try:
            if self._music_flow_enabled:
                await self.async_set_music_flow(True)
            else:
                self._refresh_music_flow_entities()
                if self.hass is not None:
                    self.async_write_ha_state()
        except Exception:
            self._music_flow_effect = previous_effect
            self._refresh_music_flow_entities()
            raise

    def _refresh_music_flow_entities(self) -> None:
        """Synchronize the content-mode and effect controls with light state."""
        for ref in (
            self._content_mode_select_entity,
            self._music_flow_effect_select_entity,
        ):
            if ref is not None and getattr(ref, "hass", None) is not None:
                ref.async_update_from_light()

    def _music_flow_runtime_storage_key(self) -> str:
        """Return a stable per-device key for runtime state."""
        if self._config_entry is not None:
            return self._config_entry.entry_id
        return self._ip

    def _restore_music_flow_runtime_state(self) -> None:
        """Restore immediately persisted music-flow state after HA restart."""
        if self.hass is None:
            return
        runtime_states = self.hass.data.get(DOMAIN, {}).get(
            "device_runtime_state", {}
        )
        if not isinstance(runtime_states, dict):
            return
        runtime_state = runtime_states.get(
            self._music_flow_runtime_storage_key()
        )
        if not isinstance(runtime_state, dict):
            return
        if runtime_state.get("music_flow_enabled") is not True:
            return

        effect = runtime_state.get("music_flow_effect")
        if effect in MUSIC_FLOW_EFFECTS:
            self._music_flow_effect = effect
        restore_power = runtime_state.get("music_flow_restore_power")
        self._music_flow_restore_power = (
            restore_power if isinstance(restore_power, bool) else None
        )
        self._music_flow_enabled = True
        self._is_on = True
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True
        _LOGGER.debug(
            "[MUSIC FLOW] [%s] Restored active runtime state from storage",
            self._ip,
        )

    async def _persist_music_flow_runtime_state(self) -> None:
        """Immediately persist active music-flow state for restart recovery."""
        if self.hass is None:
            return
        domain_data = self.hass.data.get(DOMAIN)
        if not isinstance(domain_data, dict):
            return
        runtime_states = domain_data.setdefault("device_runtime_state", {})
        if not isinstance(runtime_states, dict):
            runtime_states = {}
            domain_data["device_runtime_state"] = runtime_states

        key = self._music_flow_runtime_storage_key()
        if self._music_flow_enabled:
            runtime_states[key] = {
                "music_flow_enabled": True,
                "music_flow_effect": self._music_flow_effect,
                "music_flow_restore_power": self._music_flow_restore_power,
            }
        else:
            runtime_states.pop(key, None)
        try:
            await async_save_data(self.hass)
        except Exception as err:
            _LOGGER.warning(
                "[MUSIC FLOW] [%s] Could not persist runtime state: %s",
                self._ip,
                err,
            )
