"""Server-side effect/clock rotation: entity loop and service wiring."""
import asyncio
import base64
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from tests.test_native_features import ROOT, CONSTANTS, NATIVE_PREVIEW, _load_standalone_functions

NATIVE_CLOCK_STYLES = CONSTANTS["NATIVE_CLOCK_STYLES"]
ALL_NATIVE_EFFECTS = CONSTANTS["ALL_NATIVE_EFFECTS"]
DOMAIN = CONSTANTS["DOMAIN"]


def _rotation_helpers():
    source = (ROOT / "light.py").read_text(encoding="utf-8")
    return _load_standalone_functions(
        source,
        {
            "start_effect_rotation",
            "stop_effect_rotation",
            "skip_effect_rotation",
            "_rotation_loop",
            "_apply_rotation_item",
            "_apply_rotation_native",
            "_apply_rotation_clock",
            "_rotation_current_name",
            "async_apply_display_mode",
        },
        {
            "asyncio": asyncio,
            "DOMAIN": DOMAIN,
            "NATIVE_CLOCK_STYLES": NATIVE_CLOCK_STYLES,
            "ALL_NATIVE_EFFECTS": ALL_NATIVE_EFFECTS,
            "_LOGGER": Mock(),
            "APPLY_HARD_TIMEOUT": 8,
            "HomeAssistantError": ValueError,
        },
    )


def _bind(light, helpers, *names):
    for name in names:
        fn = helpers[name]
        setattr(light, name, lambda *args, _f=fn, _s=light, **kwargs: _f(_s, *args, **kwargs))


def make_light(helpers, kind="native", is_on=True, extended=False):
    light = SimpleNamespace(
        _ip="192.168.4.102",
        hass=SimpleNamespace(data={DOMAIN: {"clock_presets": [
            {"id": "abc123", "name": "My Solid", "kind": "style", "color": [12, 34, 56]},
        ]}}),
        _is_on=is_on,
        _extended_effects_enabled=extended,
        _rotation_kind=kind,
        _native_effect="Rainbow",
        _native_clock_style=1,
        _native_clock_color=None,
        _mode="Native Effect",
        _custom_draw_active=False,
        _rotation_active=False,
        _rotation_items=[],
        _rotation_interval=60,
        _rotation_index=-1,
        _rotation_task=None,
        _rotation_wake=None,
        _rotation_started=None,
        _rotation_error=None,
        async_apply_display_mode=AsyncMock(return_value=True),
        _refresh_linked_entities=Mock(),
        async_write_ha_state=Mock(),
        _create_tracked_task=Mock(side_effect=lambda coro, name=None: asyncio.create_task(coro)),
    )
    _bind(light, helpers, "start_effect_rotation", "stop_effect_rotation",
          "skip_effect_rotation", "_rotation_loop", "_apply_rotation_item",
          "_apply_rotation_native", "_apply_rotation_clock", "_rotation_current_name")
    return light


class EffectRotationEntityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.helpers = _rotation_helpers()

    async def test_display_dispatch_preserves_hardware_failure(self):
        light = make_light(self.helpers)
        light._calibration_lock = False
        light._music_flow_enabled = False
        light._in_native_fw_mode = True
        light._display_retry_count = 0
        light.MAX_DISPLAY_RETRIES = 3
        light._custom_text = ""
        light._transition_type = "none"
        light._execute_hardware_op = AsyncMock(return_value=False)
        result = await self.helpers["async_apply_display_mode"](
            light, update_type="color_change"
        )
        self.assertIs(result, False)

    async def test_rotation_does_not_report_failed_display_as_success(self):
        light = make_light(self.helpers)
        light.async_apply_display_mode.return_value = False
        self.assertFalse(await light._apply_rotation_native("Rainbow"))
        self.assertFalse(await light._apply_rotation_clock("Rainbow"))

    async def test_native_apply_sets_mode_and_applies(self):
        light = make_light(self.helpers, kind="native")
        self.assertTrue(await light._apply_rotation_native("Rainbow"))
        self.assertEqual(light._native_effect, "Rainbow")
        self.assertEqual(light._mode, "Native Effect")
        light.async_apply_display_mode.assert_awaited_once_with(update_type="color_change")
        light._refresh_linked_entities.assert_called_once()

    async def test_native_unknown_and_experimental_are_skipped(self):
        light = make_light(self.helpers, kind="native", extended=False)
        self.assertTrue(await light._apply_rotation_native("No Such Effect"))
        light.async_apply_display_mode.assert_not_awaited()
        experimental = next(
            name for name, spec in ALL_NATIVE_EFFECTS.items() if spec.get("extended")
        )
        self.assertTrue(await light._apply_rotation_native(experimental))
        light.async_apply_display_mode.assert_not_awaited()

    async def test_off_lamp_stops_rotation(self):
        light = make_light(self.helpers, kind="native", is_on=False)
        self.assertFalse(await light._apply_rotation_item("Rainbow"))

    async def test_clock_builtin_and_preset_apply(self):
        light = make_light(self.helpers, kind="clock")
        rainbow_id = next(
            sid for sid, style in NATIVE_CLOCK_STYLES.items() if style["name"] == "Rainbow"
        )
        self.assertTrue(await light._apply_rotation_clock("Rainbow"))
        self.assertEqual(light._native_clock_style, rainbow_id)
        self.assertIsNone(light._native_clock_color)
        self.assertEqual(light._mode, "Clock")
        # Saved preset -> White base + packed 0x01RRGGBB colour.
        self.assertTrue(await light._apply_rotation_clock("custom:abc123"))
        white_id = next(
            sid for sid, style in NATIVE_CLOCK_STYLES.items() if style["name"] == "White"
        )
        self.assertEqual(light._native_clock_style, white_id)
        self.assertEqual(light._native_clock_color, 0x010C2238)
        # Unknown names are skipped without applying.
        light.async_apply_display_mode.reset_mock()
        self.assertTrue(await light._apply_rotation_clock("No Such Style"))
        light.async_apply_display_mode.assert_not_awaited()

    async def test_start_schedules_loop_and_stop_cancels(self):
        light = make_light(self.helpers, kind="native")
        await light.start_effect_rotation(["Rainbow", "Streamer"], 30)
        self.assertTrue(light._rotation_active)
        self.assertEqual(light._rotation_items, ["Rainbow", "Streamer"])
        self.assertEqual(light._rotation_interval, 30)
        self.assertEqual(light._rotation_index, 1)
        self.assertIsNotNone(light._rotation_task)
        light.stop_effect_rotation()
        self.assertFalse(light._rotation_active)
        self.assertIsNone(light._rotation_task)

    async def test_start_waits_for_first_apply_and_propagates_failure(self):
        light = make_light(self.helpers)
        light.async_apply_display_mode.return_value = False
        light._last_connection_error = "Device timeout"
        with self.assertRaisesRegex(ValueError, "Device timeout"):
            await light.start_effect_rotation(["Rainbow", "Streamer"], 10)
        self.assertFalse(light._rotation_active)
        self.assertIn("Device timeout", light._rotation_error)

    async def test_restart_cancels_old_loop_without_stopping_new_loop(self):
        light = make_light(self.helpers)
        await light.start_effect_rotation(["Rainbow", "Streamer"], 10)
        previous = light._rotation_task
        await light.start_effect_rotation(["Rainbow", "Streamer"], 20)
        self.assertTrue(previous.done())
        self.assertTrue(light._rotation_active)
        self.assertIsNot(previous, light._rotation_task)
        light.stop_effect_rotation()

    async def test_skip_sets_wake_only_when_active(self):
        light = make_light(self.helpers, kind="native")
        light._rotation_wake = SimpleNamespace(set=Mock())
        light.skip_effect_rotation()
        light._rotation_wake.set.assert_not_called()  # inactive
        light._rotation_active = True
        light.skip_effect_rotation()
        light._rotation_wake.set.assert_called_once()


class EffectRotationServiceTests(unittest.IsolatedAsyncioTestCase):
    def _handlers(self, resolve, fire):
        source = (ROOT / "light_services.py").read_text(encoding="utf-8")
        return _load_standalone_functions(
            source,
            {
                "handle_start_effect_rotation",
                "handle_stop_effect_rotation",
                "handle_skip_effect_rotation",
            },
            {
                "asyncio": asyncio,
                "HomeAssistantError": ValueError,
                "_LOGGER": Mock(),
                "_resolve_entities": resolve,
                "_fire_and_forget": fire,
            },
        )

    async def test_start_dispatches_list_and_interval(self):
        target = SimpleNamespace(start_effect_rotation=AsyncMock())
        queued = []
        fire = lambda *coros: queued.extend(coros)
        handlers = self._handlers(lambda *args: [target], fire)
        await handlers["handle_start_effect_rotation"](
            SimpleNamespace(data={"items": ["A", "B"], "interval": 45, "kind": "clock"})
        )
        for coro in queued:
            await coro
        target.start_effect_rotation.assert_awaited_once_with(["A", "B"], 45, "clock")

    async def test_start_requires_two_items(self):
        handlers = self._handlers(lambda *args: [SimpleNamespace()], lambda *c: None)
        with self.assertRaisesRegex(ValueError, "at least two"):
            await handlers["handle_start_effect_rotation"](
                SimpleNamespace(data={"items": ["A"]})
            )

    async def test_start_surfaces_failure_and_stops_all_targets(self):
        targets = [
            SimpleNamespace(entity_id="light.a", start_effect_rotation=AsyncMock(), stop_effect_rotation=Mock()),
            SimpleNamespace(entity_id="light.b", start_effect_rotation=AsyncMock(side_effect=ValueError("Device timeout")), stop_effect_rotation=Mock()),
        ]
        handlers = self._handlers(lambda *args: targets, Mock())
        with self.assertRaisesRegex(ValueError, "light.b: Device timeout"):
            await handlers["handle_start_effect_rotation"](
                SimpleNamespace(data={"items": ["A", "B"]})
            )
        for target in targets:
            target.stop_effect_rotation.assert_called_once()

    async def test_stop_and_skip_dispatch(self):
        target = SimpleNamespace(stop_effect_rotation=Mock(), skip_effect_rotation=Mock())
        handlers = self._handlers(lambda *args: [target], lambda *c: None)
        await handlers["handle_stop_effect_rotation"](SimpleNamespace(data={}))
        target.stop_effect_rotation.assert_called_once()
        await handlers["handle_skip_effect_rotation"](SimpleNamespace(data={}))
        target.skip_effect_rotation.assert_called_once()


class EffectRotationTransportTests(unittest.IsolatedAsyncioTestCase):
    def make_transport_light(self):
        light = make_light(_rotation_helpers(), kind="clock")
        lock = asyncio.Lock()
        names = {
            "async_apply_display_mode", "_execute_hardware_op",
            "_apply_display_mode_internal", "_activate_native_clock",
            "_resolve_native_clock_color", "_set_native_mode_brightness",
            "_native_clock_data_bytes", "stop_scroll_timer",
            "_activate_native_effect",
        }
        source = "\n".join(
            (ROOT / filename).read_text(encoding="utf-8")
            for filename in ("light.py", "light_render.py", "light_native.py")
        )
        helpers = _load_standalone_functions(source, names, {
            **CONSTANTS, "asyncio": asyncio, "time": time, "base64": base64,
            "_LOGGER": Mock(), "_get_device_lock": lambda ip: lock,
            "APPLY_HARD_TIMEOUT": 8, "CIRCUIT_BREAKER_WINDOW": 30,
            "BulbException": type("BulbException", (Exception,), {}),
            "__package__": "rotation_test",
            "effect_supports_color_mode": NATIVE_PREVIEW["effect_supports_color_mode"],
            "effect_supports_color_override": NATIVE_PREVIEW["effect_supports_color_override"],
        })
        module = SimpleNamespace(
            _DEVICE_ORIENTATION_TO_EFFECT_DIR=CONSTANTS["DEVICE_ORIENTATION_TO_EFFECT_DIR"]
        )
        self.enterContext(patch.dict("sys.modules", {"rotation_test.light": module}))
        _bind(light, helpers, *names)
        light._calibration_lock = False
        light._music_flow_enabled = False
        light._in_native_fw_mode = True
        light._fx_mode_is_direct = False
        light._display_retry_count = 0
        light.MAX_DISPLAY_RETRIES = 3
        light._retry_display_task = None
        light._hard_timeout_times = []
        light._custom_text = ""
        light._transition_type = "none"
        light._scroll_timer = None
        light._native_clock_timezone_hours = lambda: 0
        light._native_clock_content = "time"
        light._native_clock_12_hour = False
        light._native_clock_colon_blink = True
        light._native_effect_speed = 50
        light._native_effect_direction = "Up"
        light._device_orientation = "right"
        light._native_effect_direction_select_entity = None
        light._brightness = 255
        light._notify_camera_preview = Mock()
        light.async_schedule_update_ha_state = Mock()
        light._maybe_schedule_retry = Mock()
        light._cube_matrix = SimpleNamespace(
            _state_summary=lambda: "test transport", _close_fast_socket=Mock(),
            _consecutive_failures=0, send_raw_command=AsyncMock(),
        )
        self.addCleanup(light.stop_effect_rotation)
        return light

    async def test_clock_start_skip_and_timer_reach_protocol_transport(self):
        light = self.make_transport_light()
        commands = asyncio.Queue()

        async def send(command, params, **kwargs):
            if command == "set_fx_effect":
                commands.put_nowait((params, kwargs))

        light._cube_matrix.send_raw_command.side_effect = send
        await light.start_effect_rotation(["Rainbow", "White"], 10, "clock")
        first, options = commands.get_nowait()
        self.assertEqual(first[1], light._native_clock_style)
        self.assertEqual(options, {"abortive_close": False})
        self.assertTrue(light._rotation_active)
        light._rotation_interval = 0.01
        light.skip_effect_rotation()
        second, _ = await asyncio.wait_for(commands.get(), 2)
        third, _ = await asyncio.wait_for(commands.get(), 2)
        self.assertNotEqual(first[1], second[1])
        self.assertEqual(first[1], third[1])

    async def test_transport_failure_reaches_start_caller(self):
        light = self.make_transport_light()
        light._cube_matrix.send_raw_command.side_effect = OSError("connection refused")
        with self.assertRaisesRegex(ValueError, "connection refused"):
            await light.start_effect_rotation(["Rainbow", "White"], 10, "clock")
        self.assertFalse(light._rotation_active)
        self.assertEqual(light._rotation_error, "connection refused")

    async def test_native_start_reaches_protocol_transport(self):
        light = self.make_transport_light()
        await light.start_effect_rotation(["Rainbow", "Streamer"], 10, "native")
        commands = light._cube_matrix.send_raw_command.await_args_list
        self.assertEqual([call.args[0] for call in commands], ["set_bright", "set_fx_effect"])
        self.assertEqual(commands[-1].args[1][0], ALL_NATIVE_EFFECTS["Streamer"]["effect_id"])
        self.assertTrue(light._rotation_active)


if __name__ == "__main__":
    unittest.main()
