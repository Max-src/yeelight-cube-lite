import logging
import os
import re
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tests.test_native_features import INIT_SOURCE, ROOT, _load_standalone_functions

CARD_FILES = ["yeelight-cube-draw-card.js", "yeelight-cube-clock-card.js"]


class FakeStorageCollection:
    """Home Assistant's ResourceStorageCollection: loads lazily, so its items
    look empty until something loads it."""

    def __init__(self, stored):
        self._stored = stored
        self.items = []
        self.loaded = False

    async def async_get_info(self):
        if not self.loaded:
            self.items = list(self._stored)
            self.loaded = True
        return {"resources": len(self.items)}

    def async_items(self):
        return self.items

    async def async_create_item(self, data):
        self.items.append({"id": str(len(self.items)), **data})

    async def async_update_item(self, item_id, data):
        for item in self.items:
            if item["id"] == item_id:
                item.update(data)


class CardResourceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        fns = _load_standalone_functions(
            INIT_SOURCE,
            {"_lovelace_resource_collection", "_async_register_lovelace_resources",
             "_async_register_frontend_cards"},
            {"os": os, "_LOGGER": logging.getLogger("test"), "HomeAssistant": object,
             "FRONTEND_CARD_FILES": CARD_FILES, "FRONTEND_URL_BASE": "/yeelight_cube",
             "__file__": str(ROOT / "__init__.py")},
        )
        self.register = fns["_async_register_frontend_cards"]
        self.extra_js = Mock()
        frontend = SimpleNamespace(add_extra_js_url=self.extra_js)
        self.enterContext(patch.dict(
            "sys.modules", {"homeassistant.components.frontend": frontend},
        ))

    async def test_current_home_assistant_stores_the_cards_as_resources(self):
        resources = FakeStorageCollection([
            {"id": "a", "url": "/yeelight_cube/yeelight-cube-draw-card.js", "res_type": "module"},
            {"id": "b", "url": "/local/my-card.js", "res_type": "module"},
        ])
        hass = SimpleNamespace(data={"lovelace": SimpleNamespace(resources=resources)})
        await self.register(hass)
        urls = [item["url"] for item in resources.items]
        # the existing entry is kept once, the missing card added, others untouched
        self.assertEqual(1, urls.count("/yeelight_cube/yeelight-cube-draw-card.js"))
        self.assertIn("/yeelight_cube/yeelight-cube-clock-card.js", urls)
        self.assertIn("/local/my-card.js", urls)
        self.extra_js.assert_not_called()

    async def test_older_home_assistant_key_still_works(self):
        resources = FakeStorageCollection([])
        hass = SimpleNamespace(data={"lovelace_resources": resources})
        await self.register(hass)
        self.assertEqual(2, len(resources.items))
        self.extra_js.assert_not_called()

    async def test_old_versioned_urls_are_migrated(self):
        resources = FakeStorageCollection([
            {"id": "a", "url": "/yeelight_cube/yeelight-cube-draw-card.js?v=1.3.0", "res_type": "module"},
        ])
        hass = SimpleNamespace(data={"lovelace": SimpleNamespace(resources=resources)})
        await self.register(hass)
        self.assertIn("/yeelight_cube/yeelight-cube-draw-card.js", [i["url"] for i in resources.items])
        self.assertEqual(2, len(resources.items))

    async def test_yaml_mode_injects_the_cards_instead(self):
        yaml_resources = SimpleNamespace(async_items=lambda: [])  # read-only
        hass = SimpleNamespace(data={"lovelace": SimpleNamespace(resources=yaml_resources)})
        await self.register(hass)
        self.assertEqual(
            ["/yeelight_cube/yeelight-cube-draw-card.js", "/yeelight_cube/yeelight-cube-clock-card.js"],
            [call.args[1] for call in self.extra_js.call_args_list],
        )

    def test_cards_are_registered_at_startup_not_per_lamp(self):
        setup = INIT_SOURCE[INIT_SOURCE.index("async def async_setup("):INIT_SOURCE.index("async def _async_migrate_entity_unique_ids(")]
        entry = INIT_SOURCE[INIT_SOURCE.index("async def async_setup_entry("):]
        self.assertIn("await _async_register_frontend_cards(hass)", setup)
        self.assertNotRegex(entry, re.compile(r"_async_register_(frontend_cards|lovelace_resources)\("))


if __name__ == "__main__":
    unittest.main()
