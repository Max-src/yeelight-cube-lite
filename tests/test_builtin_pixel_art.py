"""The official app's pixel arts (builtin_pixel_art.py): their collections
and orientation for the cards' tabs, found by name like a saved one, and
shown on a lamp the same way (light.show_pixel_art)."""
import asyncio
import runpy
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import LIGHT_SOURCE, ROOT, _load_standalone_functions

BUILTIN = runpy.run_path(str(ROOT / "builtin_pixel_art.py"))
STORAGE = runpy.run_path(str(ROOT / "pixel_art_storage.py"))


class BuiltinPixelArtTests(unittest.TestCase):
    def test_every_drawing_has_its_collection_and_orientation(self):
        arts = BUILTIN["get_builtin_pixel_arts"]()
        self.assertEqual(68, len(arts))
        self.assertEqual(
            {("horizontal", "Nature"): 23, ("horizontal", "Geometry"): 12,
             ("vertical", "Nature"): 21, ("vertical", "Geometry"): 12},
            {key: sum(1 for art in arts if (art["orientation"], art["collection"]) == key)
             for key in {(art["orientation"], art["collection"]) for art in arts}},
        )
        # Names unchanged (the select's options, automations).
        self.assertEqual("Built-in: Horizontal 01", arts[0]["name"])
        for art in arts:
            self.assertTrue(art["pixels"])
            for pixel in art["pixels"]:
                self.assertIn(pixel["position"], range(100))

    def test_a_name_finds_a_saved_drawing_first_then_an_official_one(self):
        find = BUILTIN["find_pixel_art"]
        saved = [{"name": "Cat", "pixels": [1]}, {"name": "Built-in: Horizontal 01", "pixels": [2]}]
        self.assertEqual([1], find(saved, "Cat")["pixels"])
        self.assertEqual([2], find(saved, "Built-in: Horizontal 01")["pixels"])  # saved wins
        self.assertEqual("Nature", find([], "Built-in: Horizontal 01")["collection"])
        self.assertIsNone(find(saved, "Nothing"))


class ShowPixelArtTests(unittest.TestCase):
    """One way to show a pixel art: the apply_pixel_art action and the Pixel
    Art select both use it (they used to differ: the select left a saved
    drawing's stored, grouped pixels unexpanded)."""

    @staticmethod
    def _lamp(**attrs):
        show = _load_standalone_functions(
            LIGHT_SOURCE, {"show_pixel_art"}, {"expand_pixels": STORAGE["expand_pixels"]}
        )["show_pixel_art"]
        selects = [Mock(), Mock(), Mock()]
        lamp = SimpleNamespace(**{
            "hass": None, "_custom_text": "", "stop_scroll_timer": Mock(),
            "async_apply_display_mode": AsyncMock(), "async_schedule_update_ha_state": Mock(),
            "_pixel_art_select_entity": selects[0], "_mode_select_entity": selects[1],
            "_content_mode_select_entity": selects[2], **attrs,
        })
        return show, lamp, selects

    def test_a_saved_or_official_drawing_is_shown_the_same_way(self):
        show, lamp, selects = self._lamp()
        grouped = [{"color": [255, 0, 0], "position": [1, 2]}]
        asyncio.run(show(lamp, "Cat", grouped))
        self.assertEqual(
            [{"position": 1, "color": [255, 0, 0]}, {"position": 2, "color": [255, 0, 0]}],
            lamp._custom_pixels,
        )
        self.assertEqual(("Custom Draw", True, "Cat"), (lamp._mode, lamp._custom_draw_active, lamp._active_pixel_art_name))
        self.assertFalse(lamp._is_scrolling)
        lamp.async_apply_display_mode.assert_awaited_once_with(update_type="pixel_art", bypass_lock=False)
        for select in selects:
            select.async_update_from_light.assert_called_once()

    def test_an_unnamed_drawing_clears_the_previous_name(self):
        # apply_custom_pixels without a name (a drawing of the user's own,
        # e.g. after the Pixel Art select showed "Bat"): no stale name for
        # the select or for save_state / restore_state.
        show, lamp, selects = self._lamp(hass=object(), _active_pixel_art_name="Bat")
        asyncio.run(show(lamp, None, [{"position": 3, "color": [0, 0, 255]}], bypass_lock=True))
        self.assertIsNone(lamp._active_pixel_art_name)
        selects[0].async_update_from_light.assert_called_once()
        # Written even when the lamp is off (nothing drawn, no state written).
        lamp.async_schedule_update_ha_state.assert_called_once()
        lamp.async_apply_display_mode.assert_awaited_once_with(update_type="pixel_art", bypass_lock=True)

    def test_the_action_and_the_select_use_it(self):
        services = (ROOT / "light_services_pixel_art.py").read_text(encoding="utf-8")
        select = (ROOT / "select.py").read_text(encoding="utf-8")
        self.assertIn("await target_entity.show_pixel_art(name, pixels)", services)
        # apply_custom_pixels too, with the optional name the Draw card sends.
        self.assertIn("await target_entity.show_pixel_art(name, pixels, bypass_lock=bypass_lock)", services)
        self.assertIn('vol.Optional("name"): vol.Any(None, cv.string)', services)
        self.assertIn("find_pixel_art(saved, name)", services)
        self.assertIn("await self._light_entity.show_pixel_art(option, art[\"pixels\"])", select)
        self.assertIn('"type": "yeelight_cube/builtin_pixel_arts"', services)


if __name__ == "__main__":
    unittest.main()
