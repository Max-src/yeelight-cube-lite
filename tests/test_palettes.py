"""The palette actions (light_services_palette.py) and the collection sensors
(sensor.py): what is saved, the event every change fires (the palette
sensor and the palette selects follow it), and the content hash the cards
compare, computed once per change."""
import ast
import hashlib
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import CONSTANTS, ROOT, _load_standalone_functions

PALETTE_SOURCE = (ROOT / "light_services_palette.py").read_text(encoding="utf-8")
DOMAIN = CONSTANTS["DOMAIN"]


class Clock:
    def __init__(self):
        self.now = 100.0

    def monotonic(self):
        return self.now


class PaletteActionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.palettes = [{"name": "Old", "colors": [(1, 2, 3)]}]
        self.clock = Clock()
        self.hass = SimpleNamespace(
            data={DOMAIN: {"palettes_v2": self.palettes}},
            bus=SimpleNamespace(async_fire=Mock()),
        )
        self.save = AsyncMock()
        common = _load_standalone_functions(
            (ROOT / "light_services_common.py").read_text(encoding="utf-8"),
            {"_check_collection_size", "_locate_item", "_move_item"},
            {"DOMAIN": DOMAIN, "normalize_display_name": lambda name, default: name.strip() or default},
        )
        # The shared collection helpers (storage.py), writing to a fake save.
        storage = _load_standalone_functions(
            (ROOT / "storage.py").read_text(encoding="utf-8"),
            {"collection", "async_collection_changed"},
            {"DOMAIN": DOMAIN, "async_save_data": self.save, "COLLECTION_EVENTS": {"palettes_v2": "palettes_updated", "pixel_arts": "pixel_arts_updated"}},
        )
        self.fns = _load_standalone_functions(
            PALETTE_SOURCE,
            {"handle_save_palette", "handle_rename_palette", "handle_set_palettes",
             "handle_move_palette", "_clean_palettes"},
            {
                **common, "collection": storage["collection"],
                "async_collection_changed": storage["async_collection_changed"],
                "hass": self.hass, "DOMAIN": DOMAIN, "MAX_PALETTES": 500,
                "DUPLICATE_SAVE_WINDOW": 2.0, "time": self.clock,
                "last_save": {"key": None, "at": 0.0},
                "normalize_display_name": lambda name, default: (name or "").strip() or default,
                "_resolve_entity": lambda call, label: object(),
                "_LOGGER": Mock(),
            },
        )

    def call(self, **data):
        return SimpleNamespace(data={"entity_id": "light.a", **data})

    def events(self):
        return [c.args[0] for c in self.hass.bus.async_fire.call_args_list]

    async def test_a_double_click_saves_once_another_palette_always(self):
        save = self.fns["handle_save_palette"]
        await save(self.call(palette=[[255, 0, 0]], name="Drawing Colors"))
        await save(self.call(palette=[[255, 0, 0]], name="Drawing Colors"))  # the same, at once
        self.assertEqual(2, len(self.palettes))
        # Same name and number of colors, other colors: saved (it used to be
        # dropped silently).
        await save(self.call(palette=[[0, 255, 0]], name="Drawing Colors"))
        # The same palette again, later: saved.
        self.clock.now += 3
        await save(self.call(palette=[[0, 255, 0]], name="Drawing Colors"))
        self.assertEqual(
            [[(1, 2, 3)], [(255, 0, 0)], [(0, 255, 0)], [(0, 255, 0)]],
            [p["colors"] for p in self.palettes],
        )
        self.assertEqual([f"{DOMAIN}_palettes_updated"] * 3, self.events())
        self.assertEqual(3, self.save.await_count)

    async def test_a_save_before_the_storage_loads_is_refused_not_lost(self):
        # It used to go into a list the storage then replaced.
        del self.hass.data[DOMAIN]["palettes_v2"]
        with self.assertRaisesRegex(ValueError, "not loaded yet"):
            await self.fns["handle_save_palette"](self.call(palette=[[1, 1, 1]]))
        self.assertNotIn("palettes_v2", self.hass.data[DOMAIN])

    async def test_a_default_name(self):
        await self.fns["handle_save_palette"](self.call(palette=[[1, 1, 1]]))
        self.assertEqual("Palette 2", self.palettes[-1]["name"])

    async def test_every_change_fires_the_event(self):
        # A rename (the palette selects show the names) and a replace (an
        # import) used to fire nothing.
        await self.fns["handle_rename_palette"](SimpleNamespace(data={"idx": 0, "name": "New"}))
        await self.fns["handle_set_palettes"](SimpleNamespace(data={"palettes": [
            {"name": "A", "colors": [[1, 1, 1]]}, {"name": "B", "colors": [[2, 2, 2]]},
        ]}))
        self.assertEqual([f"{DOMAIN}_palettes_updated"] * 2, self.events())
        # Replaced in place: the list the storage and the sensor hold.
        self.assertIs(self.palettes, self.hass.data[DOMAIN]["palettes_v2"])
        self.assertEqual(["A", "B"], [p["name"] for p in self.palettes])

    def test_no_lamp_state_is_rewritten_for_a_palette_change(self):
        # The lamps publish no palettes: the sensor and the selects follow
        # the event.
        self.assertNotIn("_ENTITY_REGISTRY", PALETTE_SOURCE)


def _sensor_classes():
    """sensor.py's collection sensors, on a stand-in base entity."""
    tree = ast.parse((ROOT / "sensor.py").read_text(encoding="utf-8"))
    body = [n for n in tree.body if isinstance(n, ast.ClassDef)
            and n.name in ("_CollectionSensor", "PaletteSensor", "PixelArtSensor")]

    class Base:
        def __init__(self, hass):
            self.hass = hass
            self.writes = 0

        def async_write_ha_state(self):
            self.writes += 1
            self.extra_state_attributes  # as Home Assistant builds the state

    namespace = {"YeelightCubeBaseSensor": Base, "callback": lambda f: f, "DOMAIN": DOMAIN,
                 "json": json, "hashlib": hashlib, "COLLECTION_EVENTS": {"palettes_v2": "palettes_updated", "pixel_arts": "pixel_arts_updated"}}
    exec(compile(ast.Module(body=body, type_ignores=[]), "sensor.py", "exec"), namespace)
    return namespace


class CollectionSensorTests(unittest.TestCase):
    def test_the_hash_is_computed_once_per_change_and_unchanged(self):
        classes = _sensor_classes()
        arts = [{"name": "Heart", "pixels": [1]}]
        hass = SimpleNamespace(data={DOMAIN: {"pixel_arts": arts, "palettes_v2": []}})
        sensor = classes["PixelArtSensor"](hass)
        original = hashlib.md5(json.dumps({"pixel_arts": arts, "count": 1}, sort_keys=True).encode()).hexdigest()
        calls = []
        real = json.dumps
        classes["json"] = SimpleNamespace(dumps=lambda *a, **k: calls.append(1) or real(*a, **k))
        attributes = sensor.extra_state_attributes
        # The hash the cards have always received for this content.
        self.assertEqual({"pixel_arts": arts, "content_hash": original, "count": 1}, attributes)
        self.assertEqual("1 drawings", sensor.state)
        sensor.extra_state_attributes
        self.assertEqual(1, len(calls))  # not again for the same content
        arts.append({"name": "Star", "pixels": [2]})
        sensor._handle_update()  # the collection's event
        self.assertEqual(2, sensor.extra_state_attributes["count"])
        self.assertEqual(2, len(calls))
        self.assertNotEqual(original, sensor.extra_state_attributes["content_hash"])
        palette = classes["PaletteSensor"](hass)
        self.assertEqual("palettes_updated", palette._event)
        # Its state counts them, like the pixel art sensor's (it was unknown).
        self.assertEqual("0 palettes", palette.state)
        self.assertEqual({"palettes_v2": [], "count": 0}, {
            k: v for k, v in palette.extra_state_attributes.items() if k != "content_hash"
        })


if __name__ == "__main__":
    unittest.main()
