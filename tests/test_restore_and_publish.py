"""What the light publishes and what comes back after a restart: the
settings declared once (light_restore.SETTINGS), on or off as it was, the
text length, the colour adjustments an action leaves out, the native effect
catalogue sent apart (native_catalog_ws), and a scroll's frames published at
a bounded rate (light_display._publish_frame)."""
import ast
import asyncio
import sys
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

from tests.fakes import ROOT, FakeEntry, FakeHass, make_light, module, run

RESTORE = module("light_restore")
ATTRIBUTES = module("light_attributes")
DISPLAY = module("light_display")
LIFECYCLE = module("light_lifecycle")
PROFILES = module("device_profile")


def state(power, attributes):
    return types.SimpleNamespace(state=power, attributes=attributes)


def matrix_light(**overrides):
    return make_light(profile=PROFILES.profile_for("CubeMatrix"), **overrides)


class PublishedSettingsTests(unittest.TestCase):
    def test_every_published_attribute_is_restored_or_said_not_to_be(self):
        # A new published setting cannot silently miss the restore: each key
        # is a setting (SETTINGS), restored apart, or listed as not restored.
        known = {key for key, _attr, _convert in RESTORE._RESTORED_ATTRIBUTES}
        known |= RESTORE.RESTORED_APART | RESTORE.NOT_RESTORED
        for light in (make_light(), matrix_light()):
            self.assertEqual(set(), set(light.extra_state_attributes) - known)
        # Each list is the one place of its keys.
        settings = {setting.key for setting in RESTORE.SETTINGS}
        self.assertEqual(set(), RESTORE.RESTORED_APART & RESTORE.NOT_RESTORED)
        self.assertEqual(set(), settings & (RESTORE.RESTORED_APART | RESTORE.NOT_RESTORED))

    def test_a_published_setting_comes_back(self):
        lamp = make_light(_full_panel=True, _native_effect_intensity=0, _custom_text="HI")
        saved = lamp.extra_state_attributes
        fresh = make_light()
        fresh._restore_state(state("on", saved))
        self.assertIs(True, fresh._full_panel)  # B8: published, now restored
        self.assertEqual(0, fresh._native_effect_intensity)  # B10: 0 is in its range
        self.assertEqual("HI", fresh._custom_text)

    def test_the_debug_values_are_no_longer_published(self):
        attributes = make_light().extra_state_attributes
        for key in ("color_accuracy_enabled", "last_hardware_brightness", "calib_gamma_r", "calib_gain_b"):
            self.assertNotIn(key, attributes)

    def test_the_effect_ranges_are_the_catalogs(self):
        convert = {key: c for key, _attr, c in RESTORE._RESTORED_ATTRIBUTES}
        catalog = module("effect_catalog")
        self.assertEqual(catalog.INTENSITY_RANGE[0], convert["native_effect_intensity"](-5))
        self.assertEqual(catalog.SPEED_RANGE[1], convert["native_effect_speed"](999))


class MalformedSavedStateTests(unittest.TestCase):
    def test_a_malformed_value_keeps_the_default_instead_of_failing(self):
        lamp = make_light()
        colors, background = list(lamp._text_colors), lamp._background_color
        lamp._restore_state(state("on", {
            "brightness": "bright", "text_colors": [[1, 2], "red", None],
            "background_color": [1, 2, 300], "native_effect_speed": float("inf"),
        }))
        self.assertEqual(255, lamp._brightness)
        self.assertEqual(colors, lamp._text_colors)
        self.assertEqual(background, lamp._background_color)
        # The valid colours are kept, as tuples.
        lamp._restore_state(state("on", {"text_colors": [[1, 2, 3], [4, 5]], "background_color": [9, 8, 7]}))
        self.assertEqual([(1, 2, 3)], lamp._text_colors)
        self.assertEqual((9, 8, 7), lamp._background_color)


class OnOffRestoreTests(unittest.TestCase):
    def test_on_or_off_as_it_was(self):
        for power, expected in (("off", False), ("on", True)):
            lamp = make_light()
            lamp._restore_state(state(power, {"mode": "Solid Color"}))
            self.assertIs(expected, lamp._is_on, power)
        # Unreachable at the restart: the settings saved apart say it.
        lamp = make_light()
        off = make_light(_is_on=False).extra_restore_state_data.as_dict()
        self.assertIs(False, off["is_on"])
        lamp._restore_state(state("unavailable", off))
        self.assertFalse(lamp._is_on)

    def test_a_lamp_turned_off_is_not_drawn_on_at_the_start(self):
        lamp = make_light(hass=FakeHass())
        lamp.async_get_last_state = AsyncMock(return_value=state("off", {"mode": "Solid Color"}))
        lamp.async_apply_display_mode = AsyncMock()
        with patch.object(LIFECYCLE, "async_track_time_change"), \
                patch.object(LIFECYCLE, "async_track_time_interval"), \
                patch.object(lamp, "_start_matter_link"):
            run(lamp.async_added_to_hass())
            run(asyncio.sleep(0))
            run(lamp.async_will_remove_from_hass())
        self.assertFalse(lamp._is_on)
        lamp.async_apply_display_mode.assert_not_called()

    def test_an_off_lamp_keeps_its_brightness(self):
        # A light that is off publishes no brightness: the one saved apart.
        lamp = make_light()
        lamp.async_get_last_state = AsyncMock(return_value=state("off", {"mode": "Solid Color", "brightness": None}))
        lamp.async_get_last_extra_data = AsyncMock(return_value=RESTORE.SavedSettings({"mode": "Solid Color", "brightness": 40}))
        restored = run(lamp._last_settings())
        self.assertEqual("off", restored.state)
        lamp._restore_state(restored)
        self.assertEqual(40, lamp._brightness)
        self.assertFalse(lamp._is_on)


class TextLengthTests(unittest.TestCase):
    def test_one_limit_for_the_action_the_control_and_the_restore(self):
        limit = DISPLAY.MAX_TEXT_LENGTH
        self.assertEqual(255, limit)
        text = module("text").YeelightCubeCustomTextInput(make_light(), "192.0.2.10", FakeEntry())
        self.assertEqual(limit, text._attr_native_max)
        convert = {key: c for key, _attr, c in RESTORE._RESTORED_ATTRIBUTES}["custom_text"]
        self.assertEqual(limit, len(convert("x" * 400)))
        self.assertIs(RESTORE._INVALID, convert(12))
        source = (ROOT / "light_services_display.py").read_text(encoding="utf-8")
        schema = source[source.index('"set_custom_text",'):source.index("async def handle_set_angle")]
        self.assertIn("vol.Length(max=MAX_TEXT_LENGTH)", schema)


class PreviewAdjustmentTests(unittest.TestCase):
    def test_only_the_adjustments_given_change(self):
        source = (ROOT / "light_services_display.py").read_text(encoding="utf-8")
        schema = source[source.index('"set_preview_adjustments",'):source.index("async def handle_force_refresh")]
        self.assertNotIn("default=", schema)
        lamp = make_light(_preview_saturation=150, _preview_tint_strength=30)
        lamp.redraw_in_background = Mock()
        lamp.set_preview_adjustments({"hue_shift": 20})
        self.assertEqual((20, 150, 30), (lamp._preview_hue_shift, lamp._preview_saturation, lamp._preview_tint_strength))


class SettingsShownBeforeTheRedrawTests(unittest.TestCase):
    def test_a_failed_redraw_still_shows_the_choice(self):
        for setter, value, topic in (("set_font", "5x5", "font"), ("set_alignment", "right", "alignment")):
            lamp = make_light(hass=FakeHass())
            told = []
            lamp.add_listener(topic, lambda: told.append(1))
            lamp.async_apply_display_mode = AsyncMock(side_effect=RuntimeError("unreachable"))
            if setter == "set_font":
                value = next(iter(module("layout").FONT_MAPS))
            with self.assertRaises(RuntimeError):
                run(getattr(lamp, setter)(value))
            self.assertEqual([1], told, setter)
            self.assertGreaterEqual(lamp.state_writes, 1, setter)


class NativeEffectCatalogTests(unittest.TestCase):
    def test_the_catalog_is_fetched_apart_with_its_key(self):
        lamp = make_light()
        attributes = lamp.extra_state_attributes
        self.assertNotIn("native_effect_catalog", attributes)
        self.assertNotIn("native_effect_catalog", lamp.extra_restore_state_data.as_dict())
        key = attributes["native_effect_catalog_key"]
        self.assertIsInstance(key, str)
        answer = lamp.native_effect_catalog()
        self.assertEqual({"key", "catalog"}, set(answer))
        self.assertEqual(key, answer["key"])
        self.assertTrue(answer["catalog"])
        self.assertIn("name", answer["catalog"][0])
        # Another catalogue (a Cube Matrix: no microphone), another key.
        self.assertNotEqual(key, matrix_light().extra_state_attributes["native_effect_catalog_key"])

    def test_the_websocket_command(self):
        ws = module("native_catalog_ws")
        lamp = make_light()
        lamp.entity_id = "light.cube"
        connection = types.SimpleNamespace(send_result=Mock(), send_error=Mock())
        with patch.object(ws, "_light_for", lambda hass, entity_id: lamp if entity_id == "light.cube" else None):
            ws.ws_native_effect_catalog(None, connection, {"id": 3, "entity_id": "light.cube"})
            ws.ws_native_effect_catalog(None, connection, {"id": 4, "entity_id": "light.other"})
        connection.send_result.assert_called_once_with(3, lamp.native_effect_catalog())
        self.assertEqual(4, connection.send_error.call_args.args[0])
        source = (ROOT / "native_catalog_ws.py").read_text(encoding="utf-8")
        self.assertIn('"yeelight_cube/native_effect_catalog"', source)
        self.assertIn('vol.Required("entity_id")', source)


class ScrollPublishTests(unittest.TestCase):
    def test_a_scroll_is_published_at_most_once_a_second_and_its_last_frame_always(self):
        async def scenario():
            lamp = make_light(hass=FakeHass())
            cameras = []
            lamp._notify_camera_preview = lambda: cameras.append(1)
            previews = []
            lamp.add_stream_preview_listener(previews.append)
            lamp._set_scrolling(True)
            for _ in range(5):
                lamp._publish_frame()
            self.assertEqual((1, 1), (lamp.state_writes, len(cameras)))
            self.assertEqual(5, len(previews))  # every step to the live previews
            self.assertIsNotNone(lamp._frame_publish_timer)
            # The interval ends: the last frame is published.
            lamp._frame_publish_timer._run()
            self.assertEqual((2, 2), (lamp.state_writes, len(cameras)))
            # Not scrolling: at once.
            lamp._set_scrolling(False)
            lamp._publish_frame()
            self.assertEqual((3, 3), (lamp.state_writes, len(cameras)))
            self.assertIsNone(lamp._frame_publish_timer)

        run(scenario())

    def test_apply_writes_the_state_once(self):
        source = (ROOT / "light_display.py").read_text(encoding="utf-8")
        apply = source[source.index("    async def apply("):source.index("    def _publish_frame(")]
        self.assertEqual(0, apply.count("async_schedule_update_ha_state"))
        self.assertEqual(1, apply.count("self._publish_frame("))


class CameraTokenTests(unittest.TestCase):
    def test_a_new_frame_is_a_new_address_with_the_same_token(self):
        camera_module = module("camera")
        camera = object.__new__(camera_module.YeelightCubeMatrixCameraRound)
        camera._cached_image = b"old"
        camera._image_generation = 0
        camera.async_update_token = Mock()
        camera.async_write_ha_state = Mock()
        base = sys.modules["homeassistant.components.camera"].Camera
        with patch.object(base, "entity_picture", property(lambda self: "/api/camera_proxy/camera.x?token=t"), create=True):
            before = camera.entity_picture
            camera.async_refresh_preview()
            after = camera.entity_picture
        self.assertIsNone(camera._cached_image)
        camera.async_update_token.assert_not_called()
        self.assertNotEqual(before, after)
        self.assertTrue(after.startswith("/api/camera_proxy/camera.x?token=t&"))


class SourceFixTests(unittest.TestCase):
    def test_the_power_sensor_is_not_removed_when_added(self):
        tree = ast.parse((ROOT / "sensor.py").read_text(encoding="utf-8"))
        sensor = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "YeelightCubePowerSensor")
        added = next(node for node in sensor.body if getattr(node, "name", None) == "async_added_to_hass")
        self.assertNotIn("async_will_remove_from_hass", ast.unparse(added))

    def test_a_failed_unload_keeps_the_lamp(self):
        init = module("__init__")
        hass = FakeHass({"yeelight_cube": {}})
        hass.config_entries.async_unload_platforms = AsyncMock(return_value=False)
        entry = FakeEntry("e1")
        entry.runtime_data = types.SimpleNamespace(active_ip="192.0.2.10")
        cleanup = Mock()
        prevention = Mock()
        with patch.object(module("light"), "cleanup_module_state", cleanup), \
                patch.object(init, "get_conflict_prevention", return_value=prevention):
            self.assertFalse(run(init.async_unload_entry(hass, entry)))
            cleanup.assert_not_called()
            prevention.remove_managed_device.assert_not_called()
            hass.config_entries.async_unload_platforms = AsyncMock(return_value=True)
            self.assertTrue(run(init.async_unload_entry(hass, entry)))
            cleanup.assert_called_once_with("192.0.2.10")


if __name__ == "__main__":
    unittest.main()
