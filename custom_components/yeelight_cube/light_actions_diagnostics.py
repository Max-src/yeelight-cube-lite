"""The light's public API for its diagnostics actions: raw commands and their record.

Owns DiagnosticActionsMixin: what the diagnostics actions
(light_services_diagnostics) read and change on the light around a raw
lamp command: the effect a raw command left running (raw_fx_effect), the
lamp's modes and brightness it changed, the clock data it carried, and the
light's state set from it (reflect_lamp_command), as the device page would
set it.
Part of light_actions.ActionsMixin, the light's public API; used only as a
mixin of :class:`YeelightCubeLight` (light.py).
"""
from __future__ import annotations

import base64
import logging
from .const import MODE_CLOCK, MODE_NATIVE_EFFECT
from .effect_catalog import NATIVE_CLOCK_STYLES, NATIVE_EFFECTS
from .light_native import label_direction

_LOGGER = logging.getLogger(__name__)


class DiagnosticActionsMixin:
    """The light's diagnostics actions (light_actions_diagnostics.py)."""

    def _init_diagnostic_actions_state(self) -> None:
        """The raw commands' record. Called by YeelightCubeLight.__init__."""
        # The effect a raw command (send_fx_effect) left running (raw_fx_effect).
        self._raw_fx_effect = None

    # ── Diagnostics actions (light_services_diagnostics) ────────────────
    @property
    def raw_fx_effect(self):
        """The effect a raw command left running (the guard's record:
        fx_guard.running_after), never the lamp's own running_effect."""
        return self._raw_fx_effect

    @raw_fx_effect.setter
    def raw_fx_effect(self, value) -> None:
        self._raw_fx_effect = value

    def note_lamp_on(self) -> None:
        """A command turned the lamp on (it lights what it was sent)."""
        self._is_on = True

    def forget_direct_mode(self) -> None:
        """The next frame activates direct mode again (test_display)."""
        self._direct_mode_lost()

    def note_raw_builtin_command(self) -> None:
        """A raw command put the lamp in a built-in mode (an effect, the
        clock, a color flow): on, out of direct mode, its brightness unknown
        (sent again with direct mode, before any frame)."""
        self._is_on = True
        self._entered_builtin_mode()
        self._forget_hardware_brightness()
        self._last_fx_mode_time = 0.0

    def note_clock_timezone(self) -> None:
        """The clock shows the current UTC offset (the hourly check then
        does not activate it again)."""
        self._native_clock_timezone_offset = self._native_clock_timezone_hours()

    def native_clock_data_bytes(self) -> bytes:
        """The clock's data payload (content, UTC offset, 12-hour, colon)."""
        return self._native_clock_data_bytes()

    async def async_leave_direct_mode(self) -> None:
        await self._leave_direct_mode()

    async def async_send_native_mode_brightness(self) -> None:
        await self._set_native_mode_brightness()

    async def async_run_exclusive(self, operation, name: str):
        """``operation`` under the lamp's lock (_execute_hardware_op): False
        when it did not run or failed."""
        return await self._execute_hardware_op(operation, name)

    def _apply_clock_data(self, encoded) -> None:
        """The clock options of a built-in clock data payload (base64 of
        [content, tz_offset, 12h, colon_steady]; the colon byte is inverted:
        0 blinks, 1 is steady)."""
        try:
            data = base64.b64decode(encoded)
        except (TypeError, ValueError) as err:  # not base64
            _LOGGER.debug("[SEND_FX] Could not decode clock data bytes: %s", err)
            return
        if len(data) >= 1:
            self._native_clock_content = {
                1: "time", 2: "time_date", 3: "date",
            }.get(data[0], self._native_clock_content)
            self._native_clock_show_date = data[0] == 2
        if len(data) >= 3:
            self._native_clock_12_hour = data[2] == 1
        if len(data) >= 4:
            self._native_clock_colon_blink = data[3] == 0

    def reflect_lamp_command(self, is_clock, style, config, native_effect_name) -> None:
        """The lamp's state for a raw lamp command, as selecting the same
        clock style (style, color, options) or native effect (speed, direction)
        from the device page would set it: the cards and the camera
        preview then show what the lamp shows."""
        config = config if isinstance(config, dict) else None
        if is_clock:
            self._enter_mode(MODE_CLOCK)
            if style in NATIVE_CLOCK_STYLES:
                self._native_clock_style = style
            if config is None:
                return
            if "color" in config:
                color = config["color"]
                self._native_clock_color = (
                    int(color[0]) if isinstance(color, list) and color else int(color)
                )
            else:
                self._native_clock_color = None
            if "data" in config:
                self._apply_clock_data(config["data"])
        elif native_effect_name is not None:
            self._enter_mode(MODE_NATIVE_EFFECT)
            self._native_effect = native_effect_name
            if config is None:
                return
            if "rate" in config:
                try:
                    self._native_effect_speed = max(1, min(255, int(config["rate"])))
                except (TypeError, ValueError):
                    pass
            if "intensity" in config:
                try:
                    self._native_effect_intensity = max(1, min(255, int(config["intensity"])))
                except (TypeError, ValueError):
                    pass
            if "direction" in config:
                spec = NATIVE_EFFECTS[native_effect_name]
                for name in spec.get("directions", ()):
                    if config["direction"] == label_direction(self, spec, name):
                        self._native_effect_direction = name
                        break
