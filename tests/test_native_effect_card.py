import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from tests.test_native_features import ROOT, CONSTANTS, _load_standalone_functions


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