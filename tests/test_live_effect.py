"""A running native effect changed live (light_native: live_effect_changes,
_send_native): its speed and direction go out as update_fx_effect, so the
animation goes on instead of restarting -- only as verified on the lamp (an
effect without a color). The clock, an effect with a color and anything
else are set in full with set_fx_effect, as before: live updates left the
clock dark."""
import base64
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import (
    CONSTANTS, NATIVE_ACTIVATION, NATIVE_ACTIVATION_METHODS, NATIVE_PREVIEW, ROOT,
    _load_standalone_functions,
)

HARDWARE_BRIGHTNESS_FOR = _load_standalone_functions(
    (ROOT / "light_color.py").read_text(encoding="utf-8"), {"hardware_brightness_for"}
)["hardware_brightness_for"]
FNS = _load_standalone_functions(
    (ROOT / "light_native.py").read_text(encoding="utf-8"),
    NATIVE_ACTIVATION | {"_set_native_mode_brightness"},
    {
        **CONSTANTS,
        "hardware_brightness_for": HARDWARE_BRIGHTNESS_FOR,
        "base64": base64,
        "_LOGGER": Mock(),
        "asyncio": SimpleNamespace(sleep=AsyncMock()),
        "effect_supports_color_mode": NATIVE_PREVIEW["effect_supports_color_mode"],
        "effect_supports_color_override": NATIVE_PREVIEW["effect_supports_color_override"],
        "DEVICE_ORIENTATION_TO_EFFECT_DIR": {},
        "rgb_to_argb": lambda rgb: 0xFF000000 | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2],
    },
)
changes = FNS["live_effect_changes"]


class LiveEffectChangesTests(unittest.TestCase):
    RUNNING = [39, 0, 4, {"mode": 39, "onoff": 1, "rate": 50, "direction": 0}]

    def with_config(self, **config):
        return [39, 0, 4, {**self.RUNNING[3], **config}]

    def test_speed_and_direction_are_live(self):
        self.assertEqual({"rate": 80}, changes(self.RUNNING, self.with_config(rate=80)))
        self.assertEqual(
            {"rate": 80, "direction": 2},
            changes(self.RUNNING, self.with_config(rate=80, direction=2)),
        )

    def test_a_changed_color_takes_a_full_activation(self):
        # A custom color sent live left the clock dark: never live.
        running = [5, 0, 4, {"mode": 5, "onoff": 1, "rate": 50, "color": [0x01FF0000]}]
        new = [5, 0, 4, {"mode": 5, "onoff": 1, "rate": 50, "color": [0x010000FF]}]
        self.assertIsNone(changes(running, new))
        # With a speed change too: in full as well.
        new[3]["rate"] = 90
        self.assertIsNone(changes(running, new))

    def test_an_effect_with_a_color_takes_a_full_activation(self):
        # The lamp re-parses the whole segment on an update, and a custom
        # color sent live left the clock dark: an effect with a color is
        # never updated live, its speed included.
        running = [5, 0, 4, {"mode": 5, "onoff": 1, "rate": 50, "color": [0x01AA0000]}]
        new = [5, 0, 4, {"mode": 5, "onoff": 1, "rate": 90, "color": [0x01AA0000]}]
        self.assertIsNone(changes(running, new))

    def test_anything_else_takes_a_full_activation(self):
        self.assertIsNone(changes(None, self.RUNNING))  # nothing known running
        self.assertIsNone(changes(self.RUNNING, list(self.RUNNING)))  # nothing changed
        # Another effect, palette (outer id) or apply value.
        self.assertIsNone(changes(self.RUNNING, [42, 0, 4, {**self.RUNNING[3], "mode": 42}]))
        self.assertIsNone(changes(self.RUNNING, [64, 0, 4, dict(self.RUNNING[3])]))
        self.assertIsNone(changes(self.RUNNING, [39, 0, 1, dict(self.RUNNING[3])]))
        # A live setting added or removed (a color cannot be "unset" live).
        self.assertIsNone(changes(self.RUNNING, self.with_config(color=[255])))
        config = dict(self.RUNNING[3])
        del config["direction"]
        self.assertIsNone(changes(self.RUNNING, [39, 0, 4, config]))


class ActivationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sent = []
        self.refuse = set()

        async def send(command, params, **kwargs):
            self.sent.append((command, params))
            if command in self.refuse:
                raise RuntimeError("refused")

        cube = SimpleNamespace(running_effect=None, send_raw_command=send)
        cube.note_running_effect = lambda params: setattr(cube, "running_effect", params)
        self.lamp = SimpleNamespace(
            _ip="t", _is_on=True, _in_native_fw_mode=False, _fx_mode_is_direct=True,
            _native_effect="Rainbow", _native_effect_speed=50,
            _native_effect_direction="Up", _device_orientation="none",
            _native_effect_direction_select_entity=None,
            _native_effect_color_mode="normal", _native_effect_color=None,
            hass=None, _last_fx_mode_time=1.0, _cube_matrix=cube,
            _leave_direct_mode=AsyncMock(), _notify_camera_preview=Mock(),
            # Its brightness: not known yet (sent with the first activation).
            _brightness=255, _last_hardware_brightness=None,
            # The clock's settings (Rainbow clock: mixer 39, a direction).
            _native_clock_style=next(
                key for key, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items()
                if style["mixer"] == 39
            ),
            _native_clock_color_mode="normal", _native_clock_timezone_offset=0,
            _native_clock_timezone_hours=lambda: 2,
            _native_clock_data_bytes=lambda: bytes((1, 2, 0, 0)),
            _resolve_native_clock_color=lambda style: None,
        )
        for name in NATIVE_ACTIVATION_METHODS | {"_set_native_mode_brightness"}:
            setattr(self.lamp, name, FNS[name].__get__(self.lamp))

    def commands(self, brightness=False):
        """The commands sent, the brightness too when asked (its order)."""
        return [
            command for command, _ in self.sent
            if brightness or command != "set_bright"
        ]

    async def test_a_speed_change_goes_on_live(self):
        await self.lamp._activate_native_effect()  # first: in full
        self.assertEqual(["set_fx_effect"], self.commands())
        self.assertTrue(self.lamp._in_native_fw_mode)
        self.lamp._leave_direct_mode.reset_mock()
        self.lamp._native_effect_speed = 90
        await self.lamp._activate_native_effect()
        self.assertEqual(("update_fx_effect", [{"rate": 90}]), self.sent[-1])
        # Nothing else around it: no blank frame, no brightness.
        self.lamp._leave_direct_mode.assert_not_awaited()
        self.assertEqual(
            ["set_bright", "set_fx_effect", "update_fx_effect"], self.commands(brightness=True)
        )
        self.assertEqual(90, self.lamp._cube_matrix.running_effect[3]["rate"])

    async def test_a_refused_update_activates_in_full(self):
        await self.lamp._activate_native_effect()
        self.refuse = {"update_fx_effect"}
        self.lamp._native_effect_speed = 90
        await self.lamp._activate_native_effect()
        self.assertEqual(["set_fx_effect", "update_fx_effect", "set_fx_effect"], self.commands())
        self.assertEqual(90, self.sent[-1][1][3]["rate"])

    async def test_another_effect_or_a_reassertion_activates_in_full(self):
        await self.lamp._activate_native_effect()
        await self.lamp._activate_native_effect()  # unchanged: re-asserted in full
        self.lamp._native_effect = "Ocean Waves"
        await self.lamp._activate_native_effect()
        self.assertEqual(["set_fx_effect"] * 3, self.commands())

    async def test_an_unknown_running_effect_activates_in_full(self):
        await self.lamp._activate_native_effect()
        self.lamp._cube_matrix.running_effect = None  # another command since
        self.lamp._native_effect_speed = 90
        await self.lamp._activate_native_effect()
        self.assertEqual(["set_fx_effect", "set_fx_effect"], self.commands())

    async def test_a_lamp_turned_off_activates_in_full(self):
        await self.lamp._activate_native_effect()
        self.lamp._is_on = False
        self.lamp._native_effect_speed = 90
        await self.lamp._activate_native_effect()
        self.assertEqual(["set_fx_effect", "set_fx_effect"], self.commands())

    async def test_the_clock_is_always_set_in_full(self):
        # A live speed update left the clock dark on the lamp: every clock
        # change restarts it in full; its brightness after set_fx_effect, and
        # only while it differs.
        await self.lamp._activate_native_clock()
        self.assertEqual(2, self.lamp._native_clock_timezone_offset)
        self.lamp._native_effect_speed = 90
        await self.lamp._activate_native_clock()
        self.assertEqual(
            ["set_fx_effect", "set_bright", "set_fx_effect"], self.commands(brightness=True)
        )
        self.assertEqual(90, self.sent[-1][1][3]["rate"])
        self.assertNotIn("update_fx_effect", self.commands())

    async def test_other_clock_changes_set_it_in_full(self):
        await self.lamp._activate_native_clock()
        # Its setting bytes (content, timezone, 12 h, colon): not live.
        self.lamp._native_clock_data_bytes = lambda: bytes((2, 2, 0, 0))
        await self.lamp._activate_native_clock()
        # Another style.
        self.lamp._native_clock_style = next(
            key for key, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items()
            if style["mixer"] == 42
        )
        await self.lamp._activate_native_clock()
        self.assertEqual(
            ["set_fx_effect", "set_bright", "set_fx_effect", "set_fx_effect"],
            self.commands(brightness=True),
        )

    async def test_the_brightness_goes_only_when_it_changes(self):
        # Switching effects keeps the lamp's brightness (an effect's settings
        # carry none): set_bright with the first one, not again until it
        # changes, then before set_fx_effect (an effect's order).
        await self.lamp._activate_native_effect()
        self.lamp._native_effect = "Ocean Waves"
        await self.lamp._activate_native_effect()
        self.lamp._brightness = 128
        self.lamp._native_effect = "Aurora"
        await self.lamp._activate_native_effect()
        self.assertEqual(
            ["set_bright", "set_fx_effect", "set_fx_effect", "set_bright", "set_fx_effect"],
            self.commands(brightness=True),
        )
        self.assertEqual(("set_bright", [50]), self.sent[3])

    async def test_a_clock_color_change_sets_it_in_full(self):
        # The case that left the clock dark: a saved custom color picked
        # while another custom color runs.
        self.lamp._resolve_native_clock_color = lambda style: 0x01AA0000
        await self.lamp._activate_native_clock()
        self.lamp._resolve_native_clock_color = lambda style: 0x01330000
        await self.lamp._activate_native_clock()
        self.assertEqual(
            ["set_fx_effect", "set_bright", "set_fx_effect"], self.commands(brightness=True)
        )
        self.assertEqual([0x01330000], self.sent[-1][1][3]["color"])


if __name__ == "__main__":
    unittest.main()
