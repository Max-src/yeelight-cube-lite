import runpy
import unittest
from pathlib import Path
import asyncio
import json
import logging
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from tests.test_native_features import _load_standalone_functions, ROOT, CONSTANTS

MODULE = runpy.run_path(str(Path(__file__).parents[1] / "custom_components/yeelight_cube/clock_presets.py"))
save = MODULE["save_clock_preset"]
delete = MODULE["delete_clock_preset"]


class ClockPresetTests(unittest.TestCase):
    def test_save_rename_and_delete(self):
        presets = save([], "  Warm   Amber  ", [255, 120, 0], ["White"])
        self.assertEqual(presets[0]["name"], "Warm Amber")
        original_id = presets[0]["id"]
        edited = save(presets, "Sunlight", [255, 130, 0], ["White"], original_id)
        self.assertEqual(edited[0]["id"], original_id)
        self.assertEqual(presets[0]["name"], "Warm Amber")
        self.assertEqual(delete(edited, original_id), [])

    def test_reject_conflicts_and_invalid_values(self):
        presets = save([], "Amber", [255, 120, 0], ["White"])
        for name, color, preset_id in [
            ("white", [1, 2, 3], None), ("AMBER", [1, 2, 3], None),
            ("Duplicate", [255, 120, 0], None), ("", [1, 2, 3], None),
            ("Bad", [True, 2, 3], None), ("Bad", [256, 2, 3], None),
            ("Bad", [1, 2], None), ("Bad", [1, 2, 3], "missing"),
        ]:
            with self.subTest(name=name, color=color), self.assertRaises(ValueError):
                save(presets, name, color, ["White"], preset_id)
        with self.assertRaises(ValueError):
            delete(presets, "missing")


class ClockPresetServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = SimpleNamespace(async_save=AsyncMock())
        self.data = {"storage": self.store, "clock_presets": [], "palettes_v2": [{"name": "Existing"}]}
        self.hass = SimpleNamespace(data={"yeelight_cube": self.data}, bus=SimpleNamespace(async_fire=Mock()))
        namespace = {"DOMAIN": "yeelight_cube", "_LOGGER": logging.getLogger(__name__)}
        save_data = _load_standalone_functions((ROOT / "__init__.py").read_text(encoding="utf-8"), {"async_save_data"}, namespace)["async_save_data"]
        module = ModuleType("_clock_preset_test")
        module.async_save_data = save_data
        self.modules = patch.dict(sys.modules, {module.__name__: module})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        namespace.update({
            "__package__": module.__name__, "hass": self.hass,
            "preset_lock": asyncio.Lock(), "HomeAssistantError": ValueError,
            "save_clock_preset": save, "delete_clock_preset": delete,
            "NATIVE_CLOCK_STYLES": CONSTANTS["NATIVE_CLOCK_STYLES"],
        })
        self.update = _load_standalone_functions((ROOT / "services.py").read_text(encoding="utf-8"), {"update_clock_presets"}, namespace)["update_clock_presets"]

    async def test_save_update_delete_persist_and_publish(self):
        await self.update(SimpleNamespace(service="save_clock_preset", data={"name": "Amber", "color": [255, 120, 0]}))
        snapshot = json.loads(json.dumps(self.store.async_save.call_args.args[0]))
        self.assertEqual(snapshot["palettes_v2"], [{"name": "Existing"}])
        preset_id = snapshot["clock_presets"][0]["id"]
        self.data["clock_presets"] = snapshot["clock_presets"]
        await self.update(SimpleNamespace(service="save_clock_preset", data={"preset_id": preset_id, "name": "Sunlight", "color": [255, 130, 0]}))
        self.assertEqual(self.data["clock_presets"][0]["id"], preset_id)
        await self.update(SimpleNamespace(service="delete_clock_preset", data={"preset_id": preset_id}))
        self.assertEqual(self.store.async_save.call_args.args[0]["clock_presets"], [])
        self.assertEqual(self.hass.bus.async_fire.call_count, 3)
        self.hass.bus.async_fire.assert_called_with("yeelight_cube_clock_presets_updated")

    async def test_failed_storage_rolls_back_without_event(self):
        self.store.async_save.side_effect = OSError("Disk unavailable")
        with self.assertRaises(OSError):
            await self.update(SimpleNamespace(service="save_clock_preset", data={"name": "Amber", "color": [255, 120, 0]}))
        self.assertEqual(self.data["clock_presets"], [])
        self.hass.bus.async_fire.assert_not_called()
        self.data["storage_init_error"] = "Failed"
        with self.assertRaisesRegex(ValueError, "not ready"):
            await self.update(SimpleNamespace(service="save_clock_preset", data={"name": "Amber", "color": [255, 120, 0]}))

    async def test_concurrent_edits_wait_for_persistence(self):
        entered = asyncio.Event()
        release = asyncio.Event()

        async def hold_save(payload):
            entered.set()
            await release.wait()

        self.store.async_save.side_effect = hold_save
        first = asyncio.create_task(self.update(SimpleNamespace(service="save_clock_preset", data={"name": "Amber", "color": [255, 120, 0]})))
        await entered.wait()
        second = asyncio.create_task(self.update(SimpleNamespace(service="save_clock_preset", data={"name": "Rose", "color": [255, 40, 120]})))
        release.set()
        await asyncio.gather(first, second)
        self.assertEqual([preset["name"] for preset in self.data["clock_presets"]], ["Amber", "Rose"])