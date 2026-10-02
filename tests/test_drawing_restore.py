import importlib.util
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tests.test_native_features import LIGHT_SOURCE, ROOT, _load_standalone_functions

_spec = importlib.util.spec_from_file_location("pixel_art_storage", ROOT / "pixel_art_storage.py")
pixel_art_storage = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pixel_art_storage)

PIGLET = [
    {"position": p, "color": [255, 178, 176] if p % 3 else [255, 107, 107]}
    for p in range(94)
] + [{"position": p, "color": [0, 0, 0]} for p in range(94, 100)]


class DrawingRestoreTests(unittest.TestCase):
    def setUp(self):
        self.save = Mock()
        self.enterContext(patch.dict(
            "sys.modules", {"drawing_test": SimpleNamespace(async_schedule_save=self.save)},
        ))
        self.fns = _load_standalone_functions(
            LIGHT_SOURCE, {"_remember_drawing", "_restore_drawing"}, {
                "group_pixels": pixel_art_storage.group_pixels,
                "expand_pixels": pixel_art_storage.expand_pixels,
                "_LOGGER": Mock(), "__package__": "drawing_test",
            },
        )
        # hass.data[DOMAIN], as saved to and loaded from the storage file
        self.domain_data = {}

    def light(self, **state):
        light = SimpleNamespace(**{
            "hass": object(), "_ip": "192.168.4.105", "_custom_pixels": None,
            "_custom_draw_active": False, "_active_pixel_art_name": None,
            "_device_store": lambda name: self.domain_data.setdefault(name, {}),
            "_music_flow_runtime_storage_key": lambda: "entry-1",
            **state,
        })
        for name in ("_remember_drawing", "_restore_drawing"):
            setattr(light, name, self.fns[name].__get__(light))
        return light

    def test_a_restart_brings_back_the_drawing(self):
        before = self.light(_custom_pixels=PIGLET, _custom_draw_active=True,
                            _active_pixel_art_name="Piglet")
        before._remember_drawing()
        before._remember_drawing()  # same drawing redrawn: nothing new to save
        self.save.assert_called_once()

        # the storage file round trip
        self.domain_data = json.loads(json.dumps(self.domain_data))
        after = self.light(_custom_draw_active=True)
        after._restore_drawing()
        lit = lambda pixels: {p["position"]: list(p["color"]) for p in pixels if any(p["color"])}
        self.assertEqual(lit(PIGLET), lit(after._custom_pixels))
        self.assertEqual("Piglet", after._active_pixel_art_name)

        # restored and redrawn after the restart: no extra write
        after._remember_drawing()
        self.save.assert_called_once()

    def test_text_mode_does_not_bring_a_drawing_back(self):
        self.light(_custom_pixels=PIGLET, _custom_draw_active=True)._remember_drawing()
        text = self.light(_custom_draw_active=False)
        text._restore_drawing()
        self.assertIsNone(text._custom_pixels)

    def test_nothing_saved_keeps_the_previous_behaviour(self):
        light = self.light(_custom_draw_active=True)
        light._restore_drawing()
        self.assertIsNone(light._custom_pixels)
        light._remember_drawing()  # no pixels: nothing to save
        self.save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
