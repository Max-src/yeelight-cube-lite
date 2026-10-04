import base64
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import CONSTANTS, NATIVE_PREVIEW, ROOT, _load_standalone_functions

# light_native.py without the function-local import of the light module
SOURCE = (ROOT / "light_native.py").read_text(encoding="utf-8").replace(
    "        from .light import _DEVICE_ORIENTATION_TO_EFFECT_DIR\n", ""
)


def encode(frame):
    return base64.b64encode(bytes(c for rgb in frame for c in rgb)).decode("ascii")


class DirectModeExitTests(unittest.IsolatedAsyncioTestCase):
    """Leaving direct mode blanks the lamp's frame, so re-entering it later
    shows black, not the previous drawing."""

    def setUp(self):
        self.calls = []
        fns = _load_standalone_functions(
            SOURCE, {"_leave_direct_mode", "_activate_native_effect"}, {
                **CONSTANTS,
                "encode_rgb_frame": encode,
                "_LOGGER": Mock(),
                "asyncio": SimpleNamespace(sleep=AsyncMock()),
                "effect_supports_color_mode": NATIVE_PREVIEW["effect_supports_color_mode"],
                "effect_supports_color_override": NATIVE_PREVIEW["effect_supports_color_override"],
                "_DEVICE_ORIENTATION_TO_EFFECT_DIR": {"right": "Right"},
            },
        )
        record = lambda name: (lambda *args, **kwargs: self.calls.append((name, args)))

        async def draw(data):
            self.calls.append(("update_leds", data))

        async def raw(command, params, **kwargs):
            self.calls.append((command, params))

        self.light = SimpleNamespace(
            _ip="test", _fx_mode_is_direct=True, _last_sent_colors=[(255, 0, 0)] * 100,
            _layout=SimpleNamespace(device_layout=[None] * 100),
            _cube_matrix=SimpleNamespace(
                draw_matrices_fast=draw, close_fast_socket=record("close"),
                send_raw_command=raw,
            ),
            _native_effect="Rainbow", _native_effect_speed=50,
            _native_effect_direction="Right", _device_orientation="right",
            _native_effect_direction_select_entity=None,
            _native_effect_color_mode="normal", _native_effect_color=None, hass=None,
            _set_native_mode_brightness=AsyncMock(), _notify_camera_preview=Mock(),
        )
        for name in ("_leave_direct_mode", "_activate_native_effect"):
            setattr(self.light, name, fns[name].__get__(self.light))

    async def test_a_drawing_is_blanked_before_the_effect_starts(self):
        await self.light._activate_native_effect()
        names = [name for name, _ in self.calls]
        self.assertEqual(["update_leds", "close", "set_fx_effect"], names)
        self.assertEqual(encode([(0, 0, 0)] * 100), self.calls[0][1])
        # a later transition starts from what the lamp will show: black
        self.assertEqual([(0, 0, 0)] * 100, self.light._last_sent_colors)

    async def test_switching_between_firmware_modes_sends_nothing_extra(self):
        self.light._fx_mode_is_direct = False
        await self.light._activate_native_effect()
        self.assertEqual(["close", "set_fx_effect"], [name for name, _ in self.calls])
        self.assertEqual([(255, 0, 0)] * 100, self.light._last_sent_colors)

    async def test_a_failed_blank_does_not_stop_the_switch(self):
        async def broken(data):
            raise OSError("socket closed")

        self.light._cube_matrix.draw_matrices_fast = broken
        await self.light._activate_native_effect()
        self.assertEqual(["close", "set_fx_effect"], [name for name, _ in self.calls])


if __name__ == "__main__":
    unittest.main()
