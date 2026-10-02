import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import (
    SERVICES_SOURCE,
    CONSTANTS,
    LIGHT_SOURCE,
    ROOT,
    _load_standalone_functions,
)

DOMAIN = "yeelight_cube"


def lamp_class():
    fns = _load_standalone_functions(
        LIGHT_SOURCE,
        {
            "_normalize_rotation_items",
            "_normalize_favourites",
            "_favourites_store",
            "_device_store",
            "_restore_favourites",
            "async_set_favourites",
            "_music_flow_runtime_storage_key",
        },
        {
            "DOMAIN": DOMAIN,
            "CLOCK_COLOR_MODES": CONSTANTS["CLOCK_COLOR_MODES"],
            "FAVOURITE_KINDS": ("native", "clock"),
            "MAX_FAVOURITES": 100,
            "MAX_FAVOURITE_NAME": 100,
            "HomeAssistantError": ValueError,
        },
    )

    class Lamp:
        pass

    for name, fn in fns.items():
        if callable(fn) and not name.startswith("__"):
            setattr(Lamp, name, fn)
    return Lamp


def make_lamp(hass_data, entry_id="entry-1"):
    lamp = lamp_class()()
    lamp.hass = SimpleNamespace(data=hass_data)
    lamp._config_entry = SimpleNamespace(entry_id=entry_id)
    lamp._ip = "192.168.4.104"
    lamp._favourites = {}
    lamp.async_write_ha_state = Mock()
    lamp._schedule_integration_save = Mock()
    return lamp


class FavouritesTests(unittest.IsolatedAsyncioTestCase):
    async def test_saved_favourites_are_published_persisted_and_restored(self):
        data = {DOMAIN: {}}
        lamp = make_lamp(data)
        await lamp.async_set_favourites(
            "clock",
            [
                {"name": "Rainbow", "color_mode": "normal"},
                {"name": "custom:abc", "color_mode": "custom", "color": (1, 2, 3)},
                {"name": "Rainbow", "color_mode": "normal"},  # duplicate
                {"name": "12", "color_mode": "normal"},  # never created by cards
            ],
        )
        expected = [
            {"name": "Rainbow", "color_mode": "normal", "color": None},
            {"name": "custom:abc", "color_mode": "custom", "color": [1, 2, 3]},
        ]
        self.assertEqual({"clock": expected}, lamp._favourites)
        lamp.async_write_ha_state.assert_called_once()
        lamp._schedule_integration_save.assert_called_once()
        self.assertEqual({"entry-1": {"clock": expected}}, data[DOMAIN]["favourites"])
        # Another kind is kept separately; a restart restores both.
        await lamp.async_set_favourites("native", [{"name": "Aurora"}])
        restored = make_lamp(data)
        restored._restore_favourites()
        self.assertEqual(expected, restored._favourites["clock"])
        self.assertEqual("Aurora", restored._favourites["native"][0]["name"])
        # Each lamp has its own list.
        other = make_lamp(data, "entry-2")
        other._restore_favourites()
        self.assertEqual({}, other._favourites)

    async def test_an_empty_list_is_kept_and_unknown_kinds_are_refused(self):
        data = {DOMAIN: {}}
        lamp = make_lamp(data)
        await lamp.async_set_favourites("native", [])
        # Present but empty: cards know the list was set and do not migrate
        # an old browser-stored list over it.
        self.assertEqual({"native": []}, lamp._favourites)
        with self.assertRaises(ValueError):
            await lamp.async_set_favourites("gradient", [])

    async def test_the_list_is_capped(self):
        lamp = make_lamp({DOMAIN: {}})
        await lamp.async_set_favourites(
            "native", [{"name": f"Effect {i}"} for i in range(150)]
        )
        self.assertEqual(100, len(lamp._favourites["native"]))

    async def test_the_service_updates_every_target(self):
        targets = [SimpleNamespace(async_set_favourites=AsyncMock()) for _ in range(2)]
        handler = _load_standalone_functions(
            SERVICES_SOURCE,
            {"handle_set_favourites"},
            {
                "HomeAssistantError": ValueError,
                "_resolve_entities": lambda *args: targets,
            },
        )["handle_set_favourites"]
        items = [{"name": "Rainbow", "color_mode": "normal"}]
        await handler(SimpleNamespace(data={"kind": "clock", "favourites": items}))
        for target in targets:
            target.async_set_favourites.assert_awaited_once_with("clock", items)

    async def test_the_interval_service_updates_every_target(self):
        targets = [SimpleNamespace(set_rotation_interval=Mock()) for _ in range(2)]
        handler = _load_standalone_functions(
            SERVICES_SOURCE,
            {"handle_set_rotation_interval"},
            {
                "HomeAssistantError": ValueError,
                "_resolve_entities": lambda *args: targets,
            },
        )["handle_set_rotation_interval"]
        await handler(SimpleNamespace(data={"kind": "clock", "interval": 120}))
        for target in targets:
            target.set_rotation_interval.assert_called_once_with("clock", 120)

    def test_state_attribute_and_storage_are_wired(self):
        source = LIGHT_SOURCE
        self.assertIn('"favourites": {', source)
        self.assertIn("self._restore_favourites()", source)
        init = (ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertIn('"favourites": stored_data.get("favourites", {})', init)
        self.assertIn('"favourites": data.get("favourites", {})', init)
        # Rotation (running state + shared intervals) is saved and restored too.
        self.assertIn('"rotation_intervals": dict(self._rotation_intervals)', source)
        self.assertIn('"rotation": stored_data.get("rotation", {})', init)
        self.assertIn('"rotation": data.get("rotation", {})', init)
        # Saves are batched (one write per burst, flushed on shutdown).
        self.assertIn("store.async_delay_save(lambda: _storage_data(hass), delay)", init)
        self.assertIn('for key in ("favourites", "rotation", "device_runtime_state", "drawing")', init)
        self.assertIn("self.stop_effect_rotation(persist=False)", source)


if __name__ == "__main__":
    unittest.main()
