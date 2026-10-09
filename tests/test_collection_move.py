import re
import unittest

from tests.test_native_features import ROOT, _load_standalone_functions


class _Error(Exception):
    pass


COMMON = _load_standalone_functions(
    (ROOT / "light_services_common.py").read_text(encoding="utf-8"),
    {"_locate_item", "_move_item"},
    {
        "HomeAssistantError": _Error,
        "normalize_display_name": lambda name, default: (name or default).strip(),
    },
)
move = COMMON["_move_item"]


class CollectionMoveTests(unittest.TestCase):
    """The one reorder of the user collections (move_palette, move_pixel_art)."""

    def items(self):
        return [{"name": name} for name in ("A", "B", "C", "D")]

    def names(self, items):
        return [item["name"] for item in items]

    def test_moves_one_item_both_ways(self):
        items = self.items()
        self.assertTrue(move(items, 3, 0, "D", "Palette"))
        self.assertEqual(self.names(items), ["D", "A", "B", "C"])
        self.assertTrue(move(items, 0, 2, "D", "Palette"))
        self.assertEqual(self.names(items), ["A", "B", "D", "C"])

    def test_same_position_changes_nothing(self):
        items = self.items()
        self.assertFalse(move(items, 1, 1, "B", "Palette"))
        self.assertEqual(self.names(items), ["A", "B", "C", "D"])

    def test_stale_or_out_of_range_moves_are_refused(self):
        items = self.items()
        for args in ((1, 0, "C"), (9, 0, None), (0, 4, "A"), (0, -1, "A")):
            with self.subTest(args=args), self.assertRaises(_Error):
                move(items, *args, "Palette")
        self.assertEqual(self.names(items), ["A", "B", "C", "D"])

    def test_both_collections_use_it(self):
        for module, service in (
            ("light_services_palette.py", "move_palette"),
            ("light_services_pixel_art.py", "move_pixel_art"),
        ):
            source = (ROOT / module).read_text(encoding="utf-8")
            with self.subTest(service=service):
                self.assertIn(f'"{service}"', source)
                self.assertRegex(source, re.compile(r"if not _move_item\("))


if __name__ == "__main__":
    unittest.main()


class SaveAsPaletteTests(unittest.IsolatedAsyncioTestCase):
    """set_text_colors' documented save_as_palette option saves the colors."""

    async def run_set_text_colors(self, data):
        import asyncio
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, Mock

        hass = SimpleNamespace(
            services=SimpleNamespace(async_call=AsyncMock()),
            async_create_task=lambda coro: coro.close(),
        )
        lamp = SimpleNamespace(entity_id="light.a")
        handler = _load_standalone_functions(
            (ROOT / "light_services_display.py").read_text(encoding="utf-8"),
            {"handle_set_text_colors"},
            {
                "hass": hass,
                "DOMAIN": "yeelight_cube",
                "asyncio": asyncio,
                "_LOGGER": Mock(),
                "_resolve_entities": lambda call, name: [lamp],
                "async_save_data": AsyncMock(),
            },
        )["handle_set_text_colors"]
        await handler(SimpleNamespace(data=data))
        return hass.services.async_call

    async def test_saves_the_colors_as_a_palette_when_asked(self):
        call = await self.run_set_text_colors(
            {"text_colors": [[255, 0, 0], [0, 0, 255]], "save_as_palette": True}
        )
        call.assert_awaited_once_with(
            "yeelight_cube",
            "save_palette",
            {"palette": [[255, 0, 0], [0, 0, 255]], "entity_id": "light.a"},
            blocking=True,
        )

    async def test_saves_nothing_by_default(self):
        call = await self.run_set_text_colors({"text_colors": [[255, 0, 0]]})
        call.assert_not_awaited()
