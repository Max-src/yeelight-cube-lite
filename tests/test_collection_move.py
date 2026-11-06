import re
import unittest

from tests.test_native_features import ROOT, TranslatedError, _load_standalone_functions


COMMON = _load_standalone_functions(
    (ROOT / "light_services_common.py").read_text(encoding="utf-8"),
    {"_locate_item", "_move_item"},
    {
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
        self.assertTrue(move(items, 3, 0, "D", "palette"))
        self.assertEqual(self.names(items), ["D", "A", "B", "C"])
        self.assertTrue(move(items, 0, 2, "D", "palette"))
        self.assertEqual(self.names(items), ["A", "B", "D", "C"])

    def test_same_position_changes_nothing(self):
        items = self.items()
        self.assertFalse(move(items, 1, 1, "B", "palette"))
        self.assertEqual(self.names(items), ["A", "B", "C", "D"])

    def test_stale_or_out_of_range_moves_are_refused(self):
        items = self.items()
        for args in ((1, 0, "C"), (9, 0, None), (0, 4, "A"), (0, -1, "A")):
            with self.subTest(args=args), self.assertRaises(TranslatedError):
                move(items, *args, "palette")
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


async def published_before_drawn(test, apply, colors):
    """``apply`` (a service's run for one lamp) writes the lamp's state
    with ``colors`` before the lamp is drawn, which may take a while or
    fail: the previews drawing the palette follow at once."""
    from types import SimpleNamespace

    seen = []
    lamp = SimpleNamespace(entity_id="light.a", hass=object(), _text_colors=None)
    lamp.async_write_ha_state = lambda: seen.append(("state", list(lamp._text_colors)))
    lamp.async_schedule_update_ha_state = lambda: None

    async def draw(update_type):
        seen.append(("draw", None))
        raise RuntimeError("the lamp refused")

    lamp.async_apply_display_mode = draw
    with test.assertRaises(RuntimeError):
        await apply(lamp)
    test.assertEqual([("state", colors), ("draw", None)], seen)


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
        self.runs = []
        self.applies = []
        handler = _load_standalone_functions(
            (ROOT / "light_services_display.py").read_text(encoding="utf-8"),
            {"handle_set_text_colors"},
            {
                "hass": hass,
                "DOMAIN": "yeelight_cube",
                "asyncio": asyncio,
                "_LOGGER": Mock(),
                "_resolve_entities": lambda call, name: [lamp],
                # The shared multi-lamp runner (light_services_common).
                "run_on_lamps": lambda label, lamps, apply: (
                    self.runs.append((label, lamps)), self.applies.append(apply),
                ),
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

    async def test_the_colors_are_published_before_the_lamp_is_drawn(self):
        await self.run_set_text_colors({"text_colors": [[255, 0, 0], [0, 0, 255]]})
        (_, lamps), = self.runs
        await published_before_drawn(self, self.applies[0], [(255, 0, 0), (0, 0, 255)])

    async def test_a_loaded_palette_is_published_before_the_lamp_is_drawn(self):
        import asyncio
        from types import SimpleNamespace
        from unittest.mock import Mock

        applies = []
        handler = _load_standalone_functions(
            (ROOT / "light_services_palette.py").read_text(encoding="utf-8"),
            {"handle_load_palette"},
            {
                "hass": SimpleNamespace(),
                "asyncio": asyncio,
                "_LOGGER": Mock(),
                "collection": lambda hass, key: [],
                "_locate_item": lambda items, idx, name, kind: {"colors": [[0, 255, 0], [9, 9, 9]]},
                "_resolve_entities": lambda call, name: [SimpleNamespace(entity_id="light.a")],
                "run_on_lamps": lambda label, lamps, apply: applies.append(apply),
            },
        )["handle_load_palette"]
        await handler(SimpleNamespace(data={"idx": 0}))
        await published_before_drawn(self, applies[0], [(0, 255, 0), (9, 9, 9)])

    async def test_the_lamps_are_updated_like_every_multi_lamp_action(self):
        # Through run_on_lamps: a lamp's failure is logged and shown on the
        # cards, like every other action that updates several lamps.
        await self.run_set_text_colors({"text_colors": [[255, 0, 0]]})
        self.assertEqual(
            [("SET_TEXT_COLORS", ["light.a"])],
            [(label, [lamp.entity_id for lamp in lamps]) for label, lamps in self.runs],
        )
