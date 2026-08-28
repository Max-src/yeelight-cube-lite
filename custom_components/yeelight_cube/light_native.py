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
import time

from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.util import dt as dt_util  # type: ignore

from .const import (
    ALL_NATIVE_EFFECTS,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
    DOMAIN,
    MUSIC_FLOW_DEFAULT_PALETTE,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_CONTENT_BYTE,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_APPLY,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECTS,
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


def _parse_music_flow_config(value) -> tuple[bool | None, int | None]:
    """Parse a ``mic_music_mode`` property returned by Cube Lite firmware."""
    if isinstance(value, str):
        if not value.strip():
            return None, None
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None, None
    if not isinstance(value, dict):
        return None, None

    raw_enabled = value.get("on")
    if isinstance(raw_enabled, str):
        normalized = raw_enabled.strip().lower()
        if normalized in ("1", "on", "true"):
            enabled = True
        elif normalized in ("0", "off", "false"):
            enabled = False
        else:
            enabled = None
    elif isinstance(raw_enabled, (bool, int)):
        enabled = bool(raw_enabled)
    else:
        enabled = None

    try:
        effect_id = int(value["effect_id"]) if "effect_id" in value else None
    except (TypeError, ValueError):
        effect_id = None
    return enabled, effect_id


class NativeModesMixin:
    """Activate and configure the firmware Clock and native animations."""

    async def _set_native_mode_brightness(self) -> None:
        """Apply HA brightness directly while a firmware-native mode is active."""
        hardware_brightness = max(1, min(100, round(self._brightness * 100 / 255)))
        await self._cube_matrix.send_raw_command(
            "set_bright",
            [hardware_brightness],
        )
        self._last_hardware_brightness = hardware_brightness
        self._preview_darken = 0
        self._last_applied_darken = 0

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
        if self._is_on and self._mode == "Clock":
            await self.async_apply_display_mode(update_type="color_change")
        if self._clock_content_select_entity:
            self._clock_content_select_entity.async_update_from_light()
        if self._clock_show_date_switch_entity:
            self._clock_show_date_switch_entity.async_update_from_light()
        if self.hass is not None:
            self.async_write_ha_state()

    def _resolve_native_clock_color(self, style: dict) -> int | None:
        """Return the ARGB color integer to send for the current clock style.

        Priority: user override (``_native_clock_color`` attribute) > style default.
        """
        override = getattr(self, "_native_clock_color", None)
        if override is not None:
            return override
        return style.get("color")

    async def _activate_native_clock(self) -> None:
        """Activate the Cube Lite firmware clock through Yeelight LAN control."""
        timezone_hours = self._native_clock_timezone_hours()
        style_id = self._native_clock_style
        style = NATIVE_CLOCK_STYLES.get(
            style_id,
            NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
        )
        clock_data = self._native_clock_data_bytes()
        effect_config = {
            "mode": NATIVE_CLOCK_EFFECT_ID,
            "mixer": style["mixer"],
            "data": base64.b64encode(clock_data).decode("ascii"),
        }
        clock_color = self._resolve_native_clock_color(style)
        if clock_color is not None:
            effect_config["color"] = [int(clock_color)]

        params = [
            NATIVE_CLOCK_EFFECT_ID,
            style_id,
            NATIVE_CLOCK_APPLY,
            effect_config,
        ]

        self._cube_matrix._close_fast_socket()
        # Keep this as the first fresh-socket command. Cube Lite can drop the
        # clock activation when set_bright opens and resets a socket just before
        # set_fx_effect; brightness remains adjustable after activation.
        await asyncio.sleep(0.1)
        await self._cube_matrix.send_raw_command(
            "set_fx_effect", params, abortive_close=False
        )
        # Applying brightness before set_fx_effect can cancel clock activation,
        # but the firmware accepts it once the native renderer is running.
        await asyncio.sleep(0.1)
        await self._set_native_mode_brightness()
        self._is_on = True
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True   # Lamp is now in firmware-native clock mode
        self._last_fx_mode_time = 0.0
        self._native_clock_timezone_offset = timezone_hours
        self._notify_camera_preview()
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug(
            "[CLOCK] [%s] Activated native clock style=%s timezone=%+d",
            self._ip,
            style_id,
            timezone_hours,
        )

    async def _activate_native_effect(self) -> None:
        """Activate one of the Cube Lite firmware's built-in animations."""
        # Imported lazily to avoid a circular import at module load: light.py
        # imports this mixin, and this map lives in light.py's module scope.
        from .light import _DEVICE_ORIENTATION_TO_EFFECT_DIR
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
            desired = _DEVICE_ORIENTATION_TO_EFFECT_DIR.get(self._device_orientation)
            if desired in directions and desired != self._native_effect_direction:
                self._native_effect_direction = desired
                if self._native_effect_direction_select_entity:
                    self._native_effect_direction_select_entity.async_update_from_light()
            if self._native_effect_direction not in directions:
                self._native_effect_direction = directions[0]
            # Some effects render a direction differently than the firmware's
            # nominal value; remap the selected label to the value that makes
            # the physical animation match the on-screen arrow (verified on HW).
            sent_direction = self._native_effect_direction
            remap = spec.get("direction_remap")
            if remap:
                sent_direction = remap.get(sent_direction, sent_direction)
            effect_config["direction"] = NATIVE_EFFECT_DIRECTION_VALUES[
                sent_direction
            ]
        elif spec.get("direction_fixed") is not None:
            effect_config["direction"] = spec["direction_fixed"]
        # Apply the spec's default color if one is defined.
        if spec.get("color") is not None:
            effect_config["color"] = [int(spec["color"])]

        params = [
            spec["effect_id"],
            0,
            NATIVE_EFFECT_APPLY,
            effect_config,
        ]
        self._cube_matrix._close_fast_socket()
        await self._set_native_mode_brightness()
        await asyncio.sleep(0.1)
        await self._cube_matrix.send_raw_command("set_fx_effect", params)
        self._is_on = True
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True   # Lamp is now in firmware-native animation mode
        self._last_fx_mode_time = 0.0
        self._notify_camera_preview()
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    async def async_set_music_flow(
        self,
        enabled: bool,
        restore_display: bool = True,
    ) -> None:
        """Start or stop device-microphone music flow through private LAN control."""

        async def _write_music_flow() -> None:
            was_music_flow_enabled = self._music_flow_enabled
            previous_power = self._is_on
            payload = _build_music_flow_payload(enabled, self._music_flow_effect)

            self._cube_matrix._close_fast_socket()
            try:
                result = await self._cube_matrix.send_command_with_recovery(
                    "set_ps",
                    ["mic_music_mode", payload],
                )
                if result is None:
                    raise RuntimeError(
                        "Music flow command was skipped during connection cooldown"
                    )
            finally:
                self._cube_matrix.close_command_socket()

            self._music_flow_enabled = enabled
            self._last_native_state_poll = time.monotonic()
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
                        self._cube_matrix._close_fast_socket()
                        await self._cube_matrix.send_raw_command(
                            "set_power",
                            ["off"],
                        )
                        self._is_on = False
                    else:
                        self._is_on = True
                        await self._apply_display_mode_internal(
                            skip_post_delay=True
                        )
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
            raise HomeAssistantError(
                "Cube Lite could not complete the music flow operation"
            )

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
            from . import async_save_data

            await async_save_data(self.hass)
        except Exception as err:
            _LOGGER.warning(
                "[MUSIC FLOW] [%s] Could not persist runtime state: %s",
                self._ip,
                err,
            )
