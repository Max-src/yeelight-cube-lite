import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from tests.test_native_features import ROOT, CONSTANTS, NATIVE_PREVIEW, _load_standalone_functions


class NativeEffectCardTests(unittest.IsolatedAsyncioTestCase):
    async def test_direction_updates_every_target_and_propagates_errors(self):
        targets = [SimpleNamespace(_is_on=True, set_device_orientation=AsyncMock()) for _ in range(2)]
        handler = _load_standalone_functions(
            (ROOT / "light_services.py").read_text(encoding="utf-8"),
            {"handle_set_device_orientation"},
            {"asyncio": asyncio, "HomeAssistantError": ValueError,
             "_resolve_entities": lambda *args: targets},
        )["handle_set_device_orientation"]
        call = SimpleNamespace(data={"entity_id": ["light.first", "light.second"], "orientation": "left"})
        await handler(call)
        for target in targets:
            target.set_device_orientation.assert_awaited_once_with("left")
            target.set_device_orientation.reset_mock()
        targets[1]._is_on = False
        targets[1]._should_auto_turn_on = lambda: False
        with self.assertRaisesRegex(ValueError, "auto-turn-on"):
            await handler(call)
        targets[0].set_device_orientation.assert_not_awaited()
        targets[1]._is_on = True
        targets[1].set_device_orientation.side_effect = RuntimeError("Offline")
        with self.assertRaisesRegex(RuntimeError, "Offline"):
            await handler(call)

    def setUp(self):
        self.target = SimpleNamespace(
            _native_effect="Streamer", _native_effect_speed=50,
            _extended_effects_enabled=False, _is_on=True, _mode="Clock",
            _custom_draw_active=True, _native_effect_speed_entity=None,
            _should_auto_turn_on=lambda: False,
            async_apply_display_mode=AsyncMock(), _refresh_linked_entities=Mock(),
            async_write_ha_state=Mock(),
        )
        self.targets = [self.target]
        self.handle = _load_standalone_functions(
            (ROOT / "light_services.py").read_text(encoding="utf-8"),
            {"handle_set_native_effect"},
            {"asyncio": asyncio, "ALL_NATIVE_EFFECTS": CONSTANTS["ALL_NATIVE_EFFECTS"],
             "CLOCK_COLOR_MODES": CONSTANTS["CLOCK_COLOR_MODES"],
             "effect_supports_color_mode": NATIVE_PREVIEW["effect_supports_color_mode"],
             "effect_supports_color_override": NATIVE_PREVIEW["effect_supports_color_override"],
             "HomeAssistantError": ValueError, "_resolve_entities": lambda *args: self.targets},
        )["handle_set_native_effect"]

    async def test_apply_selects_and_activates_through_existing_display_path(self):
        await self.handle(SimpleNamespace(data={"effect": "Rainbow", "speed": 120}))
        self.assertEqual(self.target._native_effect, "Rainbow")
        self.assertEqual(self.target._native_effect_speed, 120)
        self.assertEqual(self.target._mode, "Native Effect")
        self.assertFalse(self.target._custom_draw_active)
        self.target.async_apply_display_mode.assert_awaited_once_with(update_type="color_change")
        self.target._refresh_linked_entities.assert_called_once()

    async def test_native_palettes_are_validated_and_independent_of_clock(self):
        self.target._native_clock_color_mode = "bw"
        await self.handle(SimpleNamespace(data={"effect": "Rainbow", "color_mode": "red_blue"}))
        self.assertEqual(self.target._native_effect_color_mode, "red_blue")
        self.assertEqual(self.target._native_clock_color_mode, "bw")
        for color_mode in ("missing", "purple_orange"):
            with self.assertRaisesRegex(ValueError, "colour mode"):
                await self.handle(SimpleNamespace(data={"effect": "Ocean Waves", "color_mode": color_mode}))
        self.assertEqual(self.target._native_effect, "Rainbow")
        await self.handle(SimpleNamespace(data={"effect": "Rainbow", "color_mode": "normal"}))
        self.assertEqual(self.target._native_effect_color_mode, "normal")

    async def test_native_palette_payload_preserves_effect_and_omits_default_colour(self):
        source = (ROOT / "light_native.py").read_text(encoding="utf-8").replace(
            "        from .light import _DEVICE_ORIENTATION_TO_EFFECT_DIR\n", ""
        )
        activate = _load_standalone_functions(source, {"_activate_native_effect"}, {
            **CONSTANTS,
            "asyncio": SimpleNamespace(sleep=AsyncMock()),
            "effect_supports_color_mode": NATIVE_PREVIEW["effect_supports_color_mode"],
            "effect_supports_color_override": NATIVE_PREVIEW["effect_supports_color_override"],
            "_DEVICE_ORIENTATION_TO_EFFECT_DIR": {"right": "Right"},
        })["_activate_native_effect"]
        target = SimpleNamespace(
            _native_effect="Starry sky", _native_effect_speed=50,
            _native_effect_direction="Right", _device_orientation="right",
            _native_effect_direction_select_entity=None,
            _native_effect_color_mode="bw", hass=None,
            _cube_matrix=SimpleNamespace(_close_fast_socket=Mock(), send_raw_command=AsyncMock()),
            _set_native_mode_brightness=AsyncMock(), _notify_camera_preview=Mock(),
        )
        for effect, mode in (("Starry sky", "bw"), ("Rainbow", "red_blue"), ("Ocean Waves", "red_blue"), ("Starry sky", "normal")):
            target._native_effect = effect
            target._native_effect_color_mode = mode
            await activate(target)
            command, payload = target._cube_matrix.send_raw_command.call_args.args
            spec = CONSTANTS["ALL_NATIVE_EFFECTS"][effect]
            supported = NATIVE_PREVIEW["effect_supports_color_mode"](effect, mode)
            self.assertEqual(command, "set_fx_effect")
            self.assertEqual(payload[0], CONSTANTS["CLOCK_COLOR_MODES"][mode] if supported else spec["effect_id"])
            self.assertEqual(payload[3]["mode"], spec["mode"])
            if supported:
                self.assertNotIn("color", payload[3])
            elif spec.get("color") is not None:
                self.assertEqual(payload[3]["color"], [spec["color"]])
        target._native_effect = "Rainbow"
        target._native_effect_color = [12, 34, 56]
        target._native_effect_color_mode = "normal"
        await activate(target)
        self.assertEqual(target._cube_matrix.send_raw_command.call_args.args[1][3]["color"], [0x010C2238])
        target._native_effect_color_mode = "bw"
        await activate(target)
        self.assertNotIn("color", target._cube_matrix.send_raw_command.call_args.args[1][3])

    async def test_custom_colour_validation_preflight_and_clear(self):
        self.target._native_clock_color = 123
        await self.handle(SimpleNamespace(data={"effect": "Rainbow", "color": [12, 34, 56]}))
        self.assertEqual(self.target._native_effect_color, [12, 34, 56])
        self.assertEqual(self.target._native_effect_color_mode, "normal")
        self.assertEqual(self.target._native_clock_color, 123)
        for color in ([0, 1], [-1, 0, 1], [0, 0, 256], "red", [True, 2, 3]):
            with self.assertRaisesRegex(ValueError, "color must"):
                await self.handle(SimpleNamespace(data={"color": color}))
        unsupported = next(name for name, spec in CONSTANTS["ALL_NATIVE_EFFECTS"].items()
                           if not spec.get("extended") and not NATIVE_PREVIEW["effect_supports_color_override"](name))
        second = SimpleNamespace(_native_effect=unsupported, _extended_effects_enabled=False, _is_on=True)
        self.targets.append(second)
        with self.assertRaisesRegex(ValueError, "custom colours"):
            await self.handle(SimpleNamespace(data={"color": [1, 2, 3]}))
        self.assertEqual(self.target._native_effect_color, [12, 34, 56])
        self.targets.pop()
        await self.handle(SimpleNamespace(data={"color": "clear"}))
        self.assertIsNone(self.target._native_effect_color)

    async def test_rejects_unknown_experimental_and_off_without_mutating(self):
        for effect in ("missing", "Prism"):
            with self.subTest(effect=effect), self.assertRaises(ValueError):
                await self.handle(SimpleNamespace(data={"effect": effect}))
        self.target._is_on = False
        with self.assertRaisesRegex(ValueError, "auto-turn-on"):
            await self.handle(SimpleNamespace(data={"effect": "Rainbow"}))
        self.assertEqual(self.target._native_effect, "Streamer")
        self.target.async_apply_display_mode.assert_not_awaited()

    async def test_speed_only_does_not_switch_modes_and_errors_propagate(self):
        await self.handle(SimpleNamespace(data={"speed": 80, "activate": False}))
        self.assertEqual(self.target._mode, "Clock")
        self.target.async_apply_display_mode.assert_not_awaited()
        self.target.async_apply_display_mode.side_effect = RuntimeError("Offline")
        with self.assertRaisesRegex(RuntimeError, "Offline"):
            await self.handle(SimpleNamespace(data={"effect": "Rainbow"}))

    async def test_unsupported_speed_and_multi_target_preflight(self):
        self.target._extended_effects_enabled = True
        with self.assertRaisesRegex(ValueError, "speed"):
            await self.handle(SimpleNamespace(data={"effect": "Spectrum Bands", "speed": 80}))
        self.targets.append(SimpleNamespace(_extended_effects_enabled=False))
        with self.assertRaisesRegex(ValueError, "Experimental"):
            await self.handle(SimpleNamespace(data={"effect": "Prism"}))
        self.target.async_apply_display_mode.assert_not_awaited()

    async def test_freeze_display_sends_mode_64_to_every_target(self):
        def make_target(mode="Native Effect"):
            async def _exec(op, _name):
                await op()
            return SimpleNamespace(
                _mode=mode,
                _display_frozen=False,
                _notify_camera_preview=Mock(),
                async_write_ha_state=Mock(),
                _native_clock_style=12,
                _native_clock_data_bytes=lambda: bytes([1, 8, 0, 0]),
                _cube_matrix=SimpleNamespace(
                    _close_fast_socket=Mock(), send_raw_command=AsyncMock()
                ),
                _execute_hardware_op=_exec,
            )

        native, clock = make_target("Native Effect"), make_target("Clock")
        scheduled = []
        handler = _load_standalone_functions(
            (ROOT / "light_services.py").read_text(encoding="utf-8"),
            {"handle_freeze_display"},
            {"asyncio": asyncio, "base64": __import__("base64"),
             "time": __import__("time"),
             "NATIVE_CLOCK_EFFECT_ID": 40, "NATIVE_CLOCK_APPLY": 2,
             "_resolve_entities": lambda call, _name: (
                 [native, clock] if call.data.get("entity_id") else []
             ),
             "_fire_and_forget": lambda *coros: scheduled.extend(coros)},
        )["handle_freeze_display"]

        await handler(SimpleNamespace(data={"entity_id": ["light.a", "light.b"]}))
        await asyncio.gather(*scheduled)
        # Native effects use the renderer freeze-frame command and flag the
        # frozen state so the camera preview holds the background frame.
        native._cube_matrix._close_fast_socket.assert_called_once()
        native._cube_matrix.send_raw_command.assert_awaited_once_with(
            "set_fx_effect", [64, 0, 4, {"mode": 64}]
        )
        for target in (native, clock):
            self.assertTrue(target._display_frozen)
            target._notify_camera_preview.assert_called_once()
        # The clock re-sends its current command with the freeze mixer (64).
        clock._cube_matrix.send_raw_command.assert_awaited_once_with(
            "set_fx_effect",
            [40, 12, 2, {"mode": 40, "mixer": 64, "data": "AQgAAA=="}],
        )

        # No resolved targets -> nothing scheduled.
        scheduled.clear()
        await handler(SimpleNamespace(data={"entity_id": []}))
        self.assertEqual(scheduled, [])

    def test_camera_holds_frozen_frame_and_resumes_seamlessly(self):
        """The fake camera holds the background phase while _display_frozen."""
        clock_ticks = [1000.0]

        class FakeTime:
            @staticmethod
            def monotonic():
                return clock_ticks[0]

        preview = _load_standalone_functions(
            (ROOT / "camera.py").read_text(encoding="utf-8"),
            {"_get_native_effect_preview"},
            {"_time": FakeTime,
             "render_native_effect_oriented": NATIVE_PREVIEW["render_native_effect_oriented"]},
        )["_get_native_effect_preview"]
        camera = SimpleNamespace(
            _light_entity=SimpleNamespace(
                _native_effect="Rainbow", _native_effect_speed=50,
                _native_effect_direction="Up", _native_effect_color_mode="normal",
                _native_effect_color=None, _display_frozen=False,
            ),
            _native_preview_key=None, _native_preview_started_at=None,
            _frozen_background_phase=None,
        )
        phases = []
        original = NATIVE_PREVIEW["render_native_effect_oriented"]

        def capture(effect, phase, *args, **kwargs):
            phases.append(phase)
            return original(effect, phase, *args, **kwargs)

        preview.__globals__["render_native_effect_oriented"] = capture
        preview(camera)
        clock_ticks[0] += 5.0
        preview(camera)
        animating = phases[-1] > phases[0]
        # Freeze: the phase must stop advancing across renders.
        camera._light_entity._display_frozen = True
        clock_ticks[0] += 5.0
        preview(camera)
        held = phases[-1]
        clock_ticks[0] += 5.0
        preview(camera)
        held_stable = phases[-1] == held
        # Unfreeze: resumes from the held phase, not from zero or a jump.
        camera._light_entity._display_frozen = False
        clock_ticks[0] += 5.0
        preview(camera)
        resumes_at_held = phases[-1] == held
        clock_ticks[0] += 5.0
        preview(camera)
        resumed_advancing = held < phases[-1] <= held + 10.0

        self.assertTrue(animating, "preview animates when not frozen")
        self.assertTrue(held_stable, "frozen preview holds one frame")
        self.assertTrue(resumes_at_held, "unfreeze continues from the held frame")
        self.assertTrue(resumed_advancing, "unfrozen preview advances again")