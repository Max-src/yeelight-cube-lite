import runpy
import unittest
from pathlib import Path
import asyncio
import json
import logging
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from datetime import datetime
from tests.test_native_features import _load_standalone_functions, ROOT, CONSTANTS, NATIVE_PREVIEW

MODULE = runpy.run_path(str(Path(__file__).parents[1] / "custom_components/yeelight_cube/clock_presets.py"))
save = MODULE["save_clock_preset"]
delete = MODULE["delete_clock_preset"]


class ClockPreviewTests(unittest.TestCase):
    def setUp(self):
        self.orientation = runpy.run_path(str(ROOT / "effect_orientation.py"))
        self.font = {char: [0, 1, 20, 41, 60, 81] for char in "0123456789"}
        self.font.update({":": [20, 60], ".": [0]})
        self.clock = SimpleNamespace(_native_clock_style=6, _device_orientation="right")
        self.camera = SimpleNamespace(
            _light_entity=self.clock,
            _clock_pixel_color=lambda *args: (255, 255, 255),
        )
        self.timer = SimpleNamespace(monotonic=lambda: 0.75)
        namespace = {
            **CONSTANTS, **NATIVE_PREVIEW,
            "clock_effect_direction": self.orientation["clock_effect_direction"],
            "dt_util": SimpleNamespace(now=lambda: datetime(2026, 9, 17, 21, 53)),
            "_time": self.timer, "COLS": 20, "ROWS": 5,
            "FONT_MAPS": {"native": self.font},
            "char_advance": lambda font, char, glyph: 2 if char in ":." else 4,
        }
        self.render = _load_standalone_functions(
            (ROOT / "camera.py").read_text(encoding="utf-8"),
            {"_get_clock_preview"}, namespace,
        )["_get_clock_preview"]

    def test_all_clock_backgrounds_use_calibration_independent_of_native_direction(self):
        mask = self.render(self.camera)
        for elapsed in (0, 0.75, 2.5):
            self.timer.monotonic = lambda: elapsed
            phase = elapsed * (0.25 + CONSTANTS["CLOCK_MIXER_EFFECT_SPEED"] / 55.0)
            for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items():
                effect = CONSTANTS["CLOCK_MIXER_EFFECTS"].get(style["mixer"])
                if effect is None:
                    continue
                self.clock._native_clock_style = style_id
                for mode, override in (("normal", None), ("normal", 0x01B4143C), ("bw", None), ("red_blue", None)):
                    self.clock._native_clock_color_mode = mode
                    self.clock._native_clock_color = override
                    compatible = NATIVE_PREVIEW["effect_supports_color_override"](effect)
                    background = NATIVE_PREVIEW["render_native_effect_oriented"](
                        effect, phase, self.orientation["clock_effect_direction"](effect),
                        (180, 20, 60) if override and compatible else None,
                        None if mode == "normal" else mode,
                    )
                    expected = [background[index] if any(pixel) else (0, 0, 0) for index, pixel in enumerate(mask)]
                    for direction in (None, "Up", "Down", "Left", "Right"):
                        self.clock._native_effect_direction = direction
                        with self.subTest(style=style_id, mode=mode, override=override, direction=direction, elapsed=elapsed):
                            self.assertEqual(self.render(self.camera), expected)

    def test_rainbow_clock_matches_literal_down_without_transforming_digits(self):
        mask = self.render(self.camera)
        self.clock._native_clock_style = 1
        phase = 0.75 * (0.25 + CONSTANTS["CLOCK_MIXER_EFFECT_SPEED"] / 55.0)
        background = NATIVE_PREVIEW["render_native_effect"]("Rainbow", phase, "Down")
        expected = [background[index] if any(pixel) else (0, 0, 0) for index, pixel in enumerate(mask)]
        for direction in ("Up", "Down", "Left", "Right"):
            self.clock._native_effect_direction = direction
            with self.subTest(direction=direction):
                self.assertEqual(self.render(self.camera), expected)


class ClockPresetTests(unittest.TestCase):
    def test_reject_markup_names_for_both_kinds(self):
        for kind in ["style", "color_mode"]:
            for name in ['<script>alert(1)</script>', '\"><img src=x onerror=alert(1)>', '<svg onload=alert(1)>']:
                with self.subTest(kind=kind, name=name), self.assertRaises(ValueError):
                    save([], name, [255, 100, 180], [], kind=kind)

    def test_color_modes_are_separate_and_legacy_styles_stay_styles(self):
        legacy = [{"id": "old", "name": "Amber", "color": [255, 120, 0]}]
        presets = save(legacy, "Amber", [255, 120, 0], ["White"], kind="color_mode")
        self.assertEqual(len(presets), 2)
        self.assertNotIn("kind", legacy[0])
        self.assertEqual(presets[1]["kind"], "color_mode")
        edited = save(presets, "Gold", [240, 160, 10], ["White"], presets[1]["id"])
        self.assertEqual(edited[1]["kind"], "color_mode")
        self.assertEqual(edited[1]["id"], presets[1]["id"])
        for kind in ["style", "color_mode", "invalid"]:
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                save(presets, "Amber", [255, 120, 0], ["White"], kind=kind)
        self.assertEqual(save(legacy, "White", [1, 2, 3], ["White"], kind="color_mode")[-1]["kind"], "color_mode")

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
            ("", [1, 2, 3], None),
            ("Bad", [True, 2, 3], None), ("Bad", [256, 2, 3], None),
            ("Bad", [1, 2], None), ("Bad", [1, 2, 3], "missing"),
        ]:
            with self.subTest(name=name, color=color), self.assertRaises(ValueError):
                save(presets, name, color, ["White"], preset_id)
        with self.assertRaises(ValueError):
            delete(presets, "missing")


    def test_repeated_colours_can_be_saved_and_edited(self):
        for kind in ["style", "color_mode"]:
            with self.subTest(kind=kind):
                presets = save([], "Amber", [255, 120, 0], ["White"], kind=kind)
                presets = save(presets, "Sunlight", [255, 120, 0], ["White"], kind=kind)
                self.assertEqual(len(presets), 2)
                self.assertNotEqual(presets[0]["id"], presets[1]["id"])
                edited = save(presets, "Warm", [255, 120, 0], ["White"], presets[1]["id"])
                self.assertEqual(edited[1]["name"], "Warm")


class ClockPresetServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_color_mode_kind_persists_through_service_and_reload(self):
        await self.update(SimpleNamespace(service="save_clock_preset", data={"name": "Amber", "color": [255, 120, 0], "kind": "color_mode"}))
        snapshot = json.loads(json.dumps(self.store.async_save.call_args.args[0]))
        self.assertEqual(snapshot["clock_presets"][0]["kind"], "color_mode")
        self.data["clock_presets"] = snapshot["clock_presets"]
        preset_id = self.data["clock_presets"][0]["id"]
        await self.update(SimpleNamespace(service="save_clock_preset", data={"preset_id": preset_id, "name": "Gold", "color": [240, 150, 0]}))
        self.assertEqual(self.data["clock_presets"][0]["kind"], "color_mode")

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