"""Direct mode and the lamp's hardware brightness (light.ensure_fx_ready,
light_display.apply / _draw_direct): in direct mode a set_bright after frames
can make the lamp show an older picture again, so activating direct mode
again never sends it, and apply() sends it only when it changes, before any
frame of the update."""
import ast
import asyncio
import logging
import time
import types
import unittest
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import ROOT, _load_standalone_functions


class CubeFxModeLost(Exception):
    pass


FNS = {
    **_load_standalone_functions(
        (ROOT / "light.py").read_text(encoding="utf-8"),
        {"ensure_fx_ready"},
        {"asyncio": asyncio, "time": time, "_LOGGER": logging.getLogger("t")},
    ),
    **_load_standalone_functions(
        (ROOT / "light_display.py").read_text(encoding="utf-8"),
        {"_draw_direct"},
        {"_LOGGER": logging.getLogger("t"), "CubeFxModeLost": CubeFxModeLost},
    ),
}


class Lamp:
    ensure_fx_ready = FNS["ensure_fx_ready"]
    _draw_direct = FNS["_draw_direct"]


def make_lamp(reconnects=()):
    """A lamp whose connection reports a reconnection at the given draws."""
    lamp = Lamp()
    lamp._ip = "192.168.4.149"
    lamp._fx_mode_is_direct = False
    lamp._in_native_fw_mode = False
    lamp._last_fx_mode_time = 0.0
    lamp._last_hardware_brightness = 60
    lamp.sent = []
    flags = iter(reconnects)
    state = {"flag": False}

    async def raw(method, params):
        lamp.sent.append(method)

    async def draw(data):
        lamp.sent.append("update_leds")
        state["flag"] = next(flags, False)

    def consume():
        flag, state["flag"] = state["flag"], False
        return flag

    lamp._cube_matrix = types.SimpleNamespace(
        summary="", close_fast_socket=Mock(), send_raw_command=raw,
        draw_matrices_fast=draw, consume_reconnected_flag=consume,
    )
    return lamp


class DirectModeTests(unittest.IsolatedAsyncioTestCase):
    async def test_activating_direct_mode_keeps_the_known_brightness(self):
        lamp = make_lamp()
        await lamp.ensure_fx_ready()
        self.assertTrue(lamp._fx_mode_is_direct)
        self.assertEqual(60, lamp._last_hardware_brightness)  # not sent again
        self.assertEqual(["activate_fx_mode"], lamp.sent)

    async def test_a_frame_is_drawn_once(self):
        lamp = make_lamp()
        lamp._fx_mode_is_direct = True
        await lamp._draw_direct("AAAA")
        self.assertEqual(["update_leds"], lamp.sent)

    async def test_a_changed_connection_gets_direct_mode_and_the_frame_again(self):
        # No error, no retry: direct mode on the new connection, the frame
        # again, and no set_bright.
        lamp = make_lamp(reconnects=[True])
        lamp._fx_mode_is_direct = True
        await lamp._draw_direct("AAAA")
        self.assertEqual(["update_leds", "activate_fx_mode", "update_leds"], lamp.sent)
        self.assertTrue(lamp._fx_mode_is_direct)
        self.assertEqual(60, lamp._last_hardware_brightness)

    async def test_a_connection_that_changes_again_is_reported(self):
        lamp = make_lamp(reconnects=[True, True])
        lamp._fx_mode_is_direct = True
        with self.assertRaises(CubeFxModeLost):
            await lamp._draw_direct("AAAA")
        self.assertFalse(lamp._fx_mode_is_direct)


class ApplyOrderTests(unittest.TestCase):
    """apply() (too entangled to run here): one set_bright, sent only when
    the brightness changed, before the frame."""

    def setUp(self):
        source = (ROOT / "light_display.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        node = next(
            n for n in ast.walk(tree)
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "apply"
        )
        self.apply = ast.get_source_segment(source, node)

    def test_one_set_bright_before_any_frame(self):
        self.assertEqual(1, self.apply.count('"set_bright"'))
        bright = self.apply.index('"set_bright"')
        self.assertLess(bright, self.apply.index("self._draw_direct(raw_rgb_data)"))
        self.assertIn(
            "if hardware_brightness != self._last_hardware_brightness:", self.apply
        )
        self.assertNotIn("_cube_matrix.draw_matrices_fast", self.apply)  # always _draw_direct


class BrightnessRetryTests(unittest.IsolatedAsyncioTestCase):
    """A brightness that could not be sent (lamp unreachable) is queued, and
    the retry does send it: it is recorded as the lamp's only once sent."""

    def setUp(self):
        fns = _load_standalone_functions(
            (ROOT / "light_brightness.py").read_text(encoding="utf-8"),
            {"_internal_set_brightness", "_send_hardware_brightness"},
            {
                "_LOGGER": logging.getLogger("t"), "time": time,
                "hardware_brightness_for": lambda b: max(1, min(100, round(b * 100 / 255))),
                "is_connection_error": lambda e: isinstance(e, ConnectionError),
                "is_quota_error": lambda e: False,
            },
        )
        self.sent = []
        self.connected = False

        async def send(method, params):
            self.sent.append((method, params))

        lamp = types.SimpleNamespace(
            _ip="t", _is_on=True, _brightness=255, firmware_draws_matrix=False,
            _last_hardware_brightness=100, _has_color_effects=False, hass=None,
            _pending_brightness=None, _last_successful_brightness=None,
            _start_brightness_retry_task=Mock(), _apply_brightness_only=AsyncMock(),
            _cube_matrix=types.SimpleNamespace(
                is_connected=lambda: self.connected, send_command_fast=send,
            ),
        )
        for name in ("_internal_set_brightness", "_send_hardware_brightness"):
            setattr(lamp, name, fns[name].__get__(lamp))
        self.lamp = lamp

    async def test_a_queued_brightness_is_sent_by_the_retry(self):
        await self.lamp._internal_set_brightness(128, 1)
        self.assertEqual([], self.sent)
        self.assertEqual(128, self.lamp._pending_brightness[0])
        self.lamp._start_brightness_retry_task.assert_called_once()
        self.assertEqual(100, self.lamp._last_hardware_brightness)  # not sent
        # The lamp is back: the retry calls it again with the queued value.
        self.connected = True
        await self.lamp._internal_set_brightness(128, 2)
        self.assertEqual([("set_bright", [50])], self.sent)
        self.assertEqual(50, self.lamp._last_hardware_brightness)
        self.lamp._apply_brightness_only.assert_awaited_once()
        self.assertEqual(128, self.lamp._last_successful_brightness[1])

    async def test_an_unchanged_brightness_sends_nothing(self):
        self.connected = True
        self.lamp._brightness = 255
        await self.lamp._internal_set_brightness(255, 1)
        self.assertEqual([], self.sent)
        self.lamp._apply_brightness_only.assert_not_awaited()


class HardwareBrightnessTests(unittest.TestCase):
    """Brightness is the lamp's hardware brightness in every mode, as for
    its native modes; pixels are never darkened for it."""

    def test_the_slider_maps_proportionally_to_set_bright(self):
        level = _load_standalone_functions(
            (ROOT / "light_color.py").read_text(encoding="utf-8"), {"hardware_brightness_for"}
        )["hardware_brightness_for"]
        self.assertEqual([1, 1, 50, 100, 100], [level(b) for b in (0, 1, 128, 255, 300)])

    def test_every_mode_uses_the_one_mapping(self):
        for name in ("light_display.py", "light_brightness.py", "light_native.py"):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn("hardware_brightness_for(self._brightness)", source, name)
            self.assertNotIn("darken", source, name)


if __name__ == "__main__":
    unittest.main()
