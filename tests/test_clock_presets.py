import runpy
import threading
import unittest
import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from datetime import datetime
from tests.test_native_features import _load_standalone_functions, ROOT, CONSTANTS, NATIVE_PREVIEW, import_pure_module

LAMP = runpy.run_path(str(ROOT / "lamp_renderers.py"))
MODULE = vars(import_pure_module("clock_presets"))
save = MODULE["save_clock_preset"]
delete = MODULE["delete_clock_preset"]


class ClockPreviewTests(unittest.TestCase):
    def setUp(self):
        self.font = {char: [0, 1, 20, 41, 60, 81] for char in "0123456789"}
        self.font.update({":": [20, 60], ".": [0]})
        self.clock = SimpleNamespace(
            _native_clock_style=6, _device_orientation="right", _native_effect_speed=50,
        )
        self.timer = SimpleNamespace(monotonic=lambda: 0.75)
        namespace = {
            **CONSTANTS, **NATIVE_PREVIEW, **LAMP,
            "dt_util": SimpleNamespace(now=lambda: datetime(2026, 9, 17, 21, 53)),
            "_time": self.timer, "COLS": 20, "ROWS": 5,
            "FONT_MAPS": {"native": self.font},
            "char_advance": lambda font, char, glyph: 2 if char in ":." else 4,
        }
        methods = _load_standalone_functions(
            (ROOT / "camera.py").read_text(encoding="utf-8"),
            {"_get_clock_preview", "_clock_background_seconds", "_preview_speed", "_chosen_intensity"}, namespace,
        )
        self.render = methods["_get_clock_preview"]
        self.camera = SimpleNamespace(
            _light_entity=self.clock,
            _clock_pixel_color=lambda *args: (255, 255, 255),
            # freeze_display state, as set by the camera's constructor
            _frozen_background_seconds=None,
            _clock_preview_started_at=0.0,
            _preview_lock=threading.Lock(),
        )
        self.camera._clock_background_seconds = lambda: methods["_clock_background_seconds"](self.camera)
        self.camera._preview_speed = lambda: methods["_preview_speed"](self.camera)

    def test_all_clock_backgrounds_are_the_lamps_whatever_the_native_direction(self):
        mask = self.render(self.camera)
        for elapsed in (0, 0.75, 2.5):
            self.timer.monotonic = lambda: elapsed
            for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items():
                effect = CONSTANTS["CLOCK_MIXER_EFFECTS"].get(style["mixer"])
                if effect is None:
                    continue
                self.clock._native_clock_style = style_id
                for mode, override in (("normal", None), ("normal", 0x01B4143C), ("bw", None), ("red_blue", None)):
                    self.clock._native_clock_color_mode = mode
                    self.clock._native_clock_color = override
                    settings = LAMP["lamp_clock_settings"](
                        effect, 50, (180, 20, 60) if override else None, mode,
                    )
                    # Computed ahead: a replay's time limit would show a frame earlier.
                    if LAMP["has_renderer"](settings["mode"]):
                        timeline = LAMP["timeline_for"](settings)
                        timeline.frame_at(timeline.first_shown() + int(elapsed / 0.04), True)
                    background = LAMP["lamp_effect_frame"](settings, elapsed)
                    expected = [background[index] if any(pixel) else (0, 0, 0) for index, pixel in enumerate(mask)]
                    for direction in (None, "Up", "Down", "Left", "Right"):
                        self.clock._native_effect_direction = direction
                        with self.subTest(style=style_id, mode=mode, override=override, direction=direction, elapsed=elapsed):
                            self.assertEqual(self.render(self.camera), expected)

    def test_a_clock_background_runs_at_the_lamps_speed(self):
        self.clock._native_clock_style = 1
        self.clock._native_clock_color_mode, self.clock._native_clock_color = "normal", None
        mask = self.render(self.camera)
        self.timer.monotonic = lambda: 2.0
        for speed in (1, 50, 255):
            self.clock._native_effect_speed = speed
            with self.subTest(speed=speed):
                self.assertEqual(speed, LAMP["lamp_clock_settings"]("Rainbow", speed)["rate"])
                background = LAMP["lamp_effect_frame"](
                    LAMP["lamp_clock_settings"]("Rainbow", speed), 2.0
                )
                frame = self.render(self.camera)
                self.assertEqual(
                    [background[index] if any(pixel) else (0, 0, 0) for index, pixel in enumerate(mask)],
                    frame,
                )

    def test_a_clock_is_not_empty_for_having_just_started(self):
        # A frozen lamp at a restart: its background stays on the first moment.
        self.clock._native_clock_color_mode, self.clock._native_clock_color = "normal", None
        self.clock._display_frozen = True
        self.timer.time = lambda: 100.0
        for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items():
            if CONSTANTS["CLOCK_MIXER_EFFECTS"].get(style["mixer"]) in ("Particle glows", "Mirrored comets", "Sunrise and sunset"):
                self.clock._native_clock_style = style_id
                self.camera._frozen_background_seconds = None
                self.assertGreater(sum(map(any, self.render(self.camera))), 5, style["name"])

    def test_a_frozen_clock_holds_its_background_and_resumes_there(self):
        seconds = lambda: self.camera._clock_background_seconds()
        self.timer.time = lambda: 100.0
        self.timer.monotonic = lambda: 10.0
        self.assertEqual(10.0, seconds())
        self.clock._display_frozen, self.clock._display_frozen_at = True, 99.0  # a second ago
        self.assertEqual(9.0, seconds())
        self.timer.monotonic = lambda: 50.0
        self.assertEqual(9.0, seconds())
        self.clock._display_frozen = False
        self.assertEqual(9.0, seconds())
        self.timer.monotonic = lambda: 51.0
        self.assertEqual(10.0, seconds())


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

    def test_a_name_a_style_took_later_stays_editable(self):
        # Saved before a style was renamed to it ("Fire"): recolouring keeps it.
        presets = save([], "Fire", [255, 60, 0], ["White"])
        edited = save(presets, "fire", [200, 40, 0], ["White", "Fire"], presets[0]["id"])
        self.assertEqual([200, 40, 0], edited[0]["color"])
        # Still not a new one, nor another preset renamed to it.
        other = save(presets, "Amber", [255, 120, 0], ["White"])
        for preset_id in (None, other[1]["id"]):
            with self.subTest(preset_id=preset_id), self.assertRaises(ValueError):
                save(other, "Fire", [1, 2, 3], ["White", "Fire"], preset_id)


    def test_repeated_colors_can_be_saved_and_edited(self):
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
        namespace = {"DOMAIN": "yeelight_cube", "_LOGGER": logging.getLogger(__name__), "NAMES_VERSION": 2}
        save_data = _load_standalone_functions((ROOT / "storage.py").read_text(encoding="utf-8"), {"async_save_data", "storage_data"}, namespace)["async_save_data"]
        namespace.update({
            "async_save_data": save_data, "hass": self.hass,
            "preset_lock": asyncio.Lock(), "HomeAssistantError": ValueError,
            "save_clock_preset": save, "delete_clock_preset": delete,
            "NATIVE_CLOCK_STYLES": CONSTANTS["NATIVE_CLOCK_STYLES"],
            "CLOCK_STYLE_ALIASES": CONSTANTS["CLOCK_STYLE_ALIASES"],
        })
        self.update = _load_standalone_functions((ROOT / "light_services_clock_presets.py").read_text(encoding="utf-8"), {"update_clock_presets"}, namespace)["update_clock_presets"]

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
        with self.assertRaisesRegex(ValueError, "not loaded yet"):
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