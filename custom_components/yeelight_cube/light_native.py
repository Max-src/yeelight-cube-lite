"""Firmware-native mode activation for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin.  Covers the two firmware-rendered modes the
plugin cannot draw pixel-by-pixel: the built-in Clock and the built-in native
animations.  These build the ``set_fx_effect`` payloads and hand them to the
device.  Reads/writes state via ``self``; used only as a mixin.
"""
import asyncio
import base64
import logging

from homeassistant.util import dt as dt_util  # type: ignore

from .const import (
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
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

# Physical device orientation -> native effect flow direction. Imported lazily
# from light.py at call time to avoid a circular import at module load.


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
        spec = NATIVE_EFFECTS.get(
            self._native_effect, NATIVE_EFFECTS[DEFAULT_NATIVE_EFFECT]
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
