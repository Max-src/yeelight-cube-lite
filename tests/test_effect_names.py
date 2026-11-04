"""The native effects' names: the lamp's own, one per slot, and
every name an effect or clock style had before read as today's wherever a name
comes in (actions, dropdowns, saved state, stored favourites and rotations, the
cards: www/effect-names.js keeps the same tables)."""

import asyncio
import json
import shutil
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import (
    CONSTANTS,
    LIGHT_SOURCE,
    NATIVE_PREVIEW,
    ROOT,
    SERVICES_SOURCE,
    _function_source,
    _load_standalone_functions,
)

ALL = CONSTANTS["ALL_NATIVE_EFFECTS"]
ALIASES = CONSTANTS["NATIVE_EFFECT_ALIASES"]
STYLES = CONSTANTS["NATIVE_CLOCK_STYLES"]
NUMBERED = CONSTANTS["FORMERLY_NUMBERED_SLOTS"]
canonical_effect_name = CONSTANTS["canonical_effect_name"]
canonical_clock_style_name = CONSTANTS["canonical_clock_style_name"]
canonical_button_effect_name = CONSTANTS["canonical_button_effect_name"]

# Every slot of the lamp offered, with the lamp's name: its preset name for an
# effect the app sends as a preset, else its slot name.
LAMP_NAMES = {
    1: "Two-colour alternation", 2: "Breathing", 3: "Ribbon", 4: "Moving palette",
    5: "Starry Sky", 6: "Particle path", 7: "Dual scan", 8: "Rotating colour bands",
    9: "Triangular palette pulses", 10: "Fireworks", 11: "Sine wave",
    14: "Palette trails", 15: "Aurora", 16: "Drop and bounce", 17: "Spectrum",
    18: "Sunrise and sunset", 19: "Heat fire", 20: "Music level glow",
    21: "Stacking blocks", 22: "Mirrored comets", 23: "Aqua-lime trails",
    24: "Palette sparks", 25: "Music bars from both ends",
    26: "Music bars from the centre", 27: "Music bass-mid-treble colour",
    28: "Scrolling bands", 30: "Music bar from one end", 31: "Palette cross-fade",
    32: "Waterfall", 33: "Rising wisps", 34: "Fire", 35: "Tide (slot 35)",
    37: "Bouncing Ball", 38: "Sine plotter", 39: "Rainbow", 41: "Music Spectrum",
    42: "Waves", 43: "Music Gather", 44: "Music Breathing", 45: "Music Blossom",
    46: "Hacking", 47: "Meteor", 48: "Tide", 49: "Building Blocks",
    51: "Music noise equalizer", 52: "Solid red", 54: "Rainbow noise",
    55: "Flower Sea", 56: "Violet interference", 57: "Night-amber waves",
    58: "Navy-white noise", 59: "Night-sky waves", 60: "Flicker sweep",
    61: "Particle glows", 62: "Dot with fading trail", 63: "Centre bursts",
    65: "Rainbow fill-in (one-shot)", 66: "Rainbow wipe-out (one-shot)",
    68: "White fill-in (one-shot)", 69: "White wipe-out (one-shot)",
    70: "Palette stripes", 71: "Stored GIF", 72: "Random scatter", 73: "Music Note",
    74: "Music Impact", 75: "Neon sine bands", 76: "Magic", 77: "Wonderland",
    79: "Violet twinkles", 80: "Kaleidoscope", 81: "Palette",
}
# The names until 1.4.0 (and older ones) -> today's.
FORMER_NAMES = {
    "Streamer": "Ribbon", "Starry sky": "Starry Sky", "Ocean Waves": "Waves",
    "Bonfire": "Fire", "Pinball": "Bouncing Ball", "Shooting Star": "Meteor",
    "Building block": "Building Blocks", "Rainbow Flow": "Moving palette",
    "Spectrum Chase": "Particle path", "Pastel Pulse": "Triangular palette pulses",
    "Monochrome Waves": "Sine wave", "Pulse": "Sunrise and sunset",
    "Solar Flare": "Heat fire", "Prism": "Mirrored comets", "Ember": "Palette sparks",
    "Color Trails": "Tide (slot 35)", "Sunset": "Rainbow noise",
    "Carousel": "Violet interference", "Blue Yellow": "Night-amber waves",
    "Ice Blue": "Navy-white noise", "Blue White": "Night-sky waves",
    "Spectrum Crumble": "Flicker sweep", "Drift": "Particle glows",
    "Spectrum Bands": "Palette stripes", "Neon": "Neon sine bands",
    "Twinkle": "Violet twinkles",
    "1": "Two-colour alternation", "2": "Breathing", "7": "Dual scan",
    "8": "Rotating colour bands", "14": "Palette trails", "16": "Drop and bounce",
    "20": "Music level glow", "21": "Stacking blocks", "23": "Aqua-lime trails",
    "25": "Music bars from both ends", "26": "Music bars from the centre",
    "27": "Music bass-mid-treble colour", "28": "Scrolling bands",
    "30": "Music bar from one end", "31": "Palette cross-fade", "33": "Rising wisps",
    "38": "Sine plotter", "41": "Music Spectrum", "43": "Music Gather",
    "44": "Music Breathing", "45": "Music Blossom", "51": "Music noise equalizer",
    "52": "Solid red", "62": "Dot with fading trail", "63": "Centre bursts",
    "65": "Rainbow fill-in (one-shot)", "66": "Rainbow wipe-out (one-shot)",
    "68": "White fill-in (one-shot)", "69": "White wipe-out (one-shot)",
    "71": "Stored GIF", "72": "Random scatter", "73": "Music Note",
    "74": "Music Impact",
    # Older still.
    "Color Snakes": "Tide (slot 35)", "76": "Magic",
}
# The clock styles 1-15, by id: their mixer never changed, their name follows
# the effect behind it (the colors keep theirs).
BASE_STYLES = {
    1: ("Rainbow", 39), 2: ("Waves", 42), 3: ("Spectrum", 17), 4: ("White", 0),
    5: ("Mint", 0), 6: ("Yellow", 0), 7: ("Pink", 0), 8: ("Red", 0), 9: ("Cyan", 0),
    10: ("Purple", 0), 11: ("Rainbow noise", 54), 12: ("Night-amber waves", 57),
    13: ("Night-sky waves", 59), 14: ("Navy-white noise", 58),
    15: ("Violet interference", 56),
}
FORMER_STYLE_NAMES = {
    "Ocean Waves": "Waves", "Sunset": "Rainbow noise", "Blue Yellow": "Night-amber waves",
    "Blue White": "Night-sky waves", "Ice Blue": "Navy-white noise",
    "Carousel": "Violet interference", "Streamer": "Ribbon", "Ember": "Palette sparks",
    "Twinkle": "Violet twinkles", "7": "Dual scan",
}
STYLE_ID = {style["name"]: style_id for style_id, style in STYLES.items()}


def node_json(script: str):
    result = subprocess.run(
        [shutil.which("node"), "--input-type=module", "-e", script],
        text=True, capture_output=True, check=True,
    )
    return json.loads(result.stdout)


class EffectNameTableTests(unittest.TestCase):
    def test_every_slot_has_the_lamps_name_once(self):
        self.assertEqual(LAMP_NAMES, {spec["mode"]: name for name, spec in ALL.items()})
        self.assertEqual(len(LAMP_NAMES), len(set(LAMP_NAMES.values())))
        self.assertEqual("Ribbon", CONSTANTS["DEFAULT_NATIVE_EFFECT"])

    def test_the_formerly_numbered_slots_are_the_ones_named_by_number(self):
        numbered = {int(name) for name in FORMER_NAMES if name.isdigit()} - {76}
        self.assertEqual(numbered, set(NUMBERED))
        self.assertLessEqual(set(NUMBERED), {s["mode"] for s in CONSTANTS["EXTENDED_NATIVE_EFFECTS"].values()})

    def test_the_aliases_are_every_former_name_flattened(self):
        self.assertEqual(FORMER_NAMES, ALIASES)
        for alias, name in ALIASES.items():
            self.assertIn(name, ALL, alias)  # today's name
            self.assertNotIn(alias, ALL, alias)  # no current name is an alias
            self.assertNotIn(name, ALIASES, alias)  # no chain
        # The Music Flow effects are another list: untouched.
        self.assertEqual(
            {"Gather": 83, "Breathing": 84, "Blossom": 85, "Spectrum": 86,
             "Music Note": 87, "Impact": 88},
            CONSTANTS["MUSIC_FLOW_EFFECTS"],
        )

    def test_canonical_names(self):
        for alias, name in FORMER_NAMES.items():
            self.assertEqual(name, canonical_effect_name(alias))
        for name in ALL:
            self.assertEqual(name, canonical_effect_name(name))
        for value in ("unknown", "", None, 3):
            self.assertEqual(value, canonical_effect_name(value))
        self.assertEqual("Clock: Night-sky waves", canonical_button_effect_name("Clock: Blue White"))
        self.assertEqual("Clock: Yellow", canonical_button_effect_name("Clock: Yellow"))
        self.assertEqual("Clock: Dual scan", canonical_button_effect_name("Clock: 7"))
        self.assertEqual("Waves", canonical_button_effect_name("Ocean Waves"))

    def test_clock_styles_keep_their_ids_and_take_their_effect_names(self):
        self.assertEqual(BASE_STYLES, {i: (STYLES[i]["name"], STYLES[i]["mixer"]) for i in BASE_STYLES})
        names = [style["name"] for style in STYLES.values()]
        self.assertEqual(len(names), len(set(names)))
        # The ids of the others: the sequence that counts every slot from 1
        # that is not a base mixer, the clock or a slot that cannot back it.
        base_mixers = {mixer for _, mixer in BASE_STYLES.values()}
        expected, style_id = {}, 16
        for mode in range(1, 82):
            if mode in base_mixers or mode == 40 or mode in {60, 46, 47, 49, 81}:
                continue
            if mode not in CONSTANTS["LAMP_DEAD_END_SLOTS"]:
                expected[style_id] = (LAMP_NAMES[mode], mode)
            style_id += 1
        self.assertEqual(expected, {
            i: (s["name"], s["mixer"]) for i, s in STYLES.items() if i > 15
        })

    def test_former_clock_style_names(self):
        for alias, name in FORMER_STYLE_NAMES.items():
            self.assertEqual(name, canonical_clock_style_name(alias))
        aliases = CONSTANTS["CLOCK_STYLE_ALIASES"]
        for alias, name in aliases.items():
            self.assertIn(name, STYLE_ID, alias)
            self.assertNotIn(alias, STYLE_ID, alias)
            self.assertEqual(ALIASES[alias], name)
        # An effect no style is named after has no style alias.
        self.assertNotIn("Shooting Star", aliases)
        for name in STYLE_ID:
            self.assertEqual(name, canonical_clock_style_name(name))

    def test_a_formerly_numbered_slot_is_an_effect_like_the_others(self):
        # It backs a clock (and its preview) but the stored GIF, which no
        # preview can draw; a clock over one takes the palette like any other.
        mixers = CONSTANTS["CLOCK_MIXER_EFFECTS"]
        self.assertEqual(set(NUMBERED) - {CONSTANTS["LAMP_STORED_GIF_SLOT"]}, set(NUMBERED) & set(mixers))
        renderers = __import__("runpy").run_path(str(ROOT / "lamp_renderers.py"))
        clock = renderers["lamp_clock_settings"]
        for slot in sorted(NUMBERED - {71} - set(CONSTANTS["_EXTENDED_EFFECT_COLORS"])):
            name = LAMP_NAMES[slot]
            # Vivid's row (command id 64), as for Rainbow.
            self.assertEqual(12, clock(name, 128, None, "red_blue")["selector"], name)
        # The cards list every one of them but the stored GIF, for now.
        light = (ROOT / "light.py").read_text(encoding="utf-8")
        self.assertIn('if spec["mode"] != LAMP_STORED_GIF_SLOT', light)


@unittest.skipUnless(shutil.which("node"), "Node is required for the cards' tables")
class CardTableTests(unittest.TestCase):
    """www/effect-names.js and the cards' name tables: the same as const.py."""

    @classmethod
    def setUpClass(cls):
        www = ROOT / "www"
        uri = lambda name: json.dumps((www / name).as_uri())
        cls.js = node_json(
            f"const n = await import({uri('effect-names.js')});"
            f"const f = await import({uri('lamp-renderers.js')});"
            f"const c = await import({uri('clock-preview-utils.js')});"
            f"const fam = await import({uri('effect-families.js')});"
            f"const u = await import({uri('native-effect-card-utils.js')});"
            "process.stdout.write(JSON.stringify({"
            " aliases: n.NATIVE_EFFECT_ALIASES, styleAliases: n.CLOCK_STYLE_ALIASES,"
            " numbered: n.FORMERLY_NUMBERED_EFFECT_NAMES,"
            " effects: Object.fromEntries(Object.entries(f.LAMP_EFFECTS).map(([k, v]) => [v.mode, k])),"
            " styles: c.CLOCK_STYLES.map((s) => [s.id, s.name, s.mixer]),"
            " mixers: c.CLOCK_MIXER_EFFECTS,"
            " families: fam.EFFECT_FAMILY_NAMES,"
            " offline: u.nativePreviewCatalogue.map((item) => item.name),"
            " cardStyles: c.getClockStyles(true).map((s) => [s.name, s.solid]),"
            "}));"
        )

    def test_the_alias_tables_are_const_py(self):
        self.assertEqual(ALIASES, self.js["aliases"])
        self.assertEqual(CONSTANTS["CLOCK_STYLE_ALIASES"], self.js["styleAliases"])
        self.assertEqual(
            {str(slot): LAMP_NAMES[slot] for slot in NUMBERED}, self.js["numbered"]
        )

    def test_both_cards_list_effects_in_the_lamps_order(self):
        # The lamp's catalogue (light._native_effect_catalog) is the effect
        # card's order; without a lamp, the card's own list is the same.
        catalogue = [name for name, spec in ALL.items() if spec["mode"] != 71]
        self.assertEqual(catalogue, self.js["offline"])
        # The clock card: its styles over an effect in the same order
        # (Kaleidoscope is the 17th effect on both), then the plain colours.
        styles = self.js["cardStyles"]
        solid = [solid for _, solid in styles]
        self.assertEqual(sorted(solid), solid)
        over_effects = [name for name, solid in styles if not solid]
        self.assertEqual([name for name in catalogue if name in over_effects], over_effects)

    def test_the_cards_use_todays_names(self):
        self.assertEqual(
            {str(slot): name for slot, name in LAMP_NAMES.items() if slot != 71},
            self.js["effects"],
        )
        for style_id, name, mixer in self.js["styles"]:
            self.assertEqual((STYLES[style_id]["name"], STYLES[style_id]["mixer"]), (name, mixer))
        # The card offers every style, the formerly numbered slots' too, but
        # the one over the stored GIF, for now.
        self.assertEqual(
            {i for i, style in STYLES.items() if style["mixer"] != 71},
            {style_id for style_id, _, _ in self.js["styles"]},
        )
        self.assertEqual(
            {str(k): v for k, v in CONSTANTS["CLOCK_MIXER_EFFECTS"].items()}, self.js["mixers"]
        )
        for family, names in self.js["families"].items():
            for name in names:
                self.assertEqual(family, CONSTANTS["EFFECT_FAMILY_OF_SLOT"][ALL[name]["mode"]], name)
        # Every effect has its family there, for the clock styles over it too.
        self.assertEqual(set(ALL), {name for names in self.js["families"].values() for name in names})


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    """Every former name, through each action that takes one."""

    async def test_set_native_effect_takes_a_former_name(self):
        target = SimpleNamespace(
            _native_effect="Ribbon", _native_effect_speed=128, _native_effect_direction="Right",
            _extended_effects_enabled=True, _is_on=True, _mode="Clock",
            _custom_draw_active=False, _native_effect_speed_entity=None,
            _should_auto_turn_on=lambda: False, async_apply_display_mode=AsyncMock(),
            _refresh_linked_entities=Mock(), async_write_ha_state=Mock(),
        )
        scheduled = []
        handle = _load_standalone_functions(
            SERVICES_SOURCE, {"handle_set_native_effect"},
            {"asyncio": asyncio, "ALL_NATIVE_EFFECTS": ALL,
             "canonical_effect_name": canonical_effect_name,
             "CLOCK_COLOR_MODES": CONSTANTS["CLOCK_COLOR_MODES"],
             "effect_supports_color_mode": NATIVE_PREVIEW["effect_supports_color_mode"],
             "effect_supports_color_override": NATIVE_PREVIEW["effect_supports_color_override"],
             "HomeAssistantError": ValueError, "_resolve_entities": lambda *args: [target],
             "run_on_lamps": lambda label, lamps, apply: scheduled.extend(apply(lamp) for lamp in lamps),
             "time": __import__("time"), "note_command_result": Mock(), "_LOGGER": Mock()},
        )["handle_set_native_effect"]
        for alias, name in FORMER_NAMES.items():
            await handle(SimpleNamespace(data={"effect": alias}))
            await asyncio.gather(*scheduled)
            scheduled.clear()
            with self.subTest(alias=alias):
                self.assertEqual(name, target._native_effect)

    async def test_set_clock_style_takes_a_former_name_and_a_number_is_an_id(self):
        light = SimpleNamespace(
            _is_on=True, _mode="Clock", _extended_effects_enabled=True,
            _native_clock_style=6, _refresh_linked_entities=Mock(),
            async_write_ha_state=Mock(), async_apply_display_mode=AsyncMock(),
            _should_auto_turn_on=lambda: True,
        )
        pending = []
        handler = _load_standalone_functions(
            SERVICES_SOURCE, {"handle_set_clock_style"},
            {**CONSTANTS, "_resolve_entities": lambda *args: [light],
             "HomeAssistantError": ValueError,
             "run_on_lamps": lambda label, lamps, apply: pending.extend(apply(lamp) for lamp in lamps)},
        )["handle_set_clock_style"]
        for alias, name in [*FORMER_STYLE_NAMES.items(), ("Waves", "Waves")]:
            if alias.isdigit():
                continue
            await handler(SimpleNamespace(data={"style": alias}))
            await asyncio.gather(*pending)
            pending.clear()
            with self.subTest(alias=alias):
                self.assertEqual(STYLE_ID[name], light._native_clock_style)
        # A number is a style id, never a former name: 7 is Pink.
        await handler(SimpleNamespace(data={"style": "7"}))
        await asyncio.gather(*pending)
        self.assertEqual(7, light._native_clock_style)
        self.assertEqual("Pink", STYLES[7]["name"])

    async def test_set_button_effects_takes_former_names(self):
        # The action's validator reads a former name as today's first.
        source = (ROOT / "light_services_native.py").read_text(encoding="utf-8")
        self.assertIn(
            "vol.All(cv.string, canonical_button_effect_name, vol.In(button_effect_options))",
            source,
        )
        methods = _load_standalone_functions(
            LIGHT_SOURCE, {"_effect_persist_item", "async_set_button_effects", "effect_direction_sent", "lamp_direction"},
            {**CONSTANTS, "base64": __import__("base64"), "CubeConnectionError": RuntimeError},
        )
        sent = []
        light = SimpleNamespace(
            _native_effect_speed=128, _native_effect_direction="Right",
            _device_orientation="right", effect_profile=None, hass=None,
            _native_clock_data_bytes=lambda: b"\x01\x00\x00\x01",
            _cube_matrix=SimpleNamespace(
                close_fast_socket=Mock(), close_command_socket=Mock(),
                send_command_with_recovery=AsyncMock(side_effect=lambda *args: sent.append(args) or ["ok"]),
            ),
        )
        light._effect_persist_item = lambda name: methods["_effect_persist_item"](light, name)
        await methods["async_set_button_effects"](
            light, ["Streamer", "Ocean Waves", "Clock: Blue White", "Clock: Yellow"]
        )
        self.assertEqual(
            ["Ribbon", "Waves", "Clock: Night-sky waves", "Clock: Yellow"], light._button_effects
        )
        self.assertEqual([3, 42, 40, 40], [args[1][1]["effect_id"] for args in sent])
        self.assertEqual(13, sent[2][1][1]["custom_id"])
        # A clock over a background that draws its colour words carries them
        # all (const.clock_style_colors): white without them.
        bands = methods["_effect_persist_item"](light, "Clock: Rotating colour bands")
        self.assertEqual(
            list(CONSTANTS["_EXTENDED_EFFECT_COLORS"][8]), bands["effect_params"][0]["color"]
        )
        self.assertEqual((40, 8), (bands["effect_params"][0]["mode"], bands["effect_params"][0]["mixer"]))


class StoredNameTests(unittest.TestCase):
    """Names saved by an older version: the state restored after a restart."""

    def setUp(self):
        self.restore = _load_standalone_functions(
            (ROOT / "light_restore.py").read_text(encoding="utf-8"),
            {"_native_effect_name", "_button_effect_names"},
            {**CONSTANTS, "_INVALID": "invalid"},
        )

    def test_a_saved_effect(self):
        for alias, name in FORMER_NAMES.items():
            self.assertEqual(name, self.restore["_native_effect_name"](alias))
        self.assertEqual("invalid", self.restore["_native_effect_name"]("Impact"))

    def test_a_saved_button_list(self):
        self.assertEqual(
            ["Ribbon", "Fire", "Clock: Waves", "Clock: Pink"],
            self.restore["_button_effect_names"](
                ["Streamer", "Bonfire", "Clock: Ocean Waves", "Clock: Pink", "Prism"]
            ),
        )


class MagicClockSavedBy14Tests(unittest.TestCase):
    """In 1.4.0 "Magic" was the clock style over slot 75 (style 77), Neon sine
    bands today: what was saved under that name keeps its picture, once."""

    def setUp(self):
        self.storage = _load_standalone_functions(
            (ROOT / "storage.py").read_text(encoding="utf-8"),
            {"_clock_entries", "_saved_by_1_4", "migrate_clock_names"},
            {"NAMES_VERSION": 2, "_NAMES_SINCE_1_4": 2, **CONSTANTS},
        )

    def test_the_style_was_slot_75(self):
        self.assertEqual(75, STYLES[77]["mixer"])
        self.assertEqual("Neon sine bands", STYLES[77]["name"])
        self.assertEqual("Neon sine bands", CONSTANTS["clock_style_name_saved_by_1_4"]("Magic"))
        self.assertEqual("Waves", CONSTANTS["clock_style_name_saved_by_1_4"]("Ocean Waves"))
        # "76" was the style over slot 76 then: today's Magic, not Neon.
        self.assertEqual(76, STYLES[78]["mixer"])
        self.assertEqual("Magic", CONSTANTS["clock_style_name_saved_by_1_4"]("76"))

    def test_favourites_and_a_clock_rotation(self):
        stored = {
            "favourites": {"a": {
                "clock": [{"name": "Magic"}, "Magic", "Pink", "custom:Magic"],
                # An effect named Magic is Magic: its fix was the point.
                "native": [{"name": "Magic"}],
            }},
            "rotation": {
                "a": {"active": {"kind": "clock", "items": [
                    {"name": "Magic", "color": [1, 2, 3]}, {"name": "76"}]}},
                "b": {"active": {"kind": "native", "items": [{"name": "Magic"}]}},
                "c": {"active": None},
            },
        }
        self.assertTrue(self.storage["migrate_clock_names"](stored))
        self.assertEqual(
            [{"name": "Neon sine bands"}, "Neon sine bands", "Pink", "custom:Magic"],
            stored["favourites"]["a"]["clock"],
        )
        self.assertEqual([{"name": "Magic"}], stored["favourites"]["a"]["native"])
        self.assertEqual(
            [{"name": "Neon sine bands", "color": [1, 2, 3]}, {"name": "Magic"}],
            stored["rotation"]["a"]["active"]["items"],
        )
        self.assertEqual([{"name": "Magic"}], stored["rotation"]["b"]["active"]["items"])

    def test_data_saved_since_is_todays(self):
        for version in (2, 3):  # a later marker too
            stored = {"names_version": version, "favourites": {"a": {"clock": ["Magic"]}}}
            self.assertFalse(self.storage["migrate_clock_names"](stored))
            self.assertEqual(["Magic"], stored["favourites"]["a"]["clock"])
        storage = (ROOT / "storage.py").read_text(encoding="utf-8")
        self.assertIn('"names_version": NAMES_VERSION', storage)

    def test_a_button_list_saved_by_1_4(self):
        source = (ROOT / "light_restore.py").read_text(encoding="utf-8")
        start = source.index("        # Saved when an effect's direction was the mount's")
        block = source[start:source.index("        # The 4-way physical device orientation", start)]
        restore = _load_standalone_functions(
            source, {"_button_effect_names"}, {**CONSTANTS, "_INVALID": "invalid"},
        )
        namespace = {**restore}
        exec("def run(self, attributes):\n" + block, namespace)
        saved = ["Magic", "Clock: Magic", "Clock: 76", "Clock: Ocean Waves", "Clock: Pink"]
        for attributes, expected in (
            ({"button_effects": saved},
             ["Magic", "Clock: Neon sine bands", "Clock: Magic", "Clock: Waves", "Clock: Pink"]),
            ({"button_effects": saved, "effect_direction_own": True}, None),
        ):
            # What the attribute table restored: the names in today's.
            today = restore["_button_effect_names"](saved)
            lamp = SimpleNamespace(_native_effect_direction="Up", _button_effects=today)
            namespace["run"](lamp, attributes)
            self.assertEqual(expected or today, lamp._button_effects, attributes)


class SelectTests(unittest.TestCase):
    """The dropdowns take a former name (an automation's select_option)."""

    def setUp(self):
        from tests import test_control_entities as entities

        self.select = entities.SELECT

        def check(entity, option):
            if option not in entity.options:
                raise ValueError(option)

        # Home Assistant checks an option against the list first.
        entities._Base._valid_option_or_raise = check
        self.addCleanup(delattr, entities._Base, "_valid_option_or_raise")
        self.light = entities.make_light(
            _native_effect_direction_select_entity=None,
            _native_effect_speed_entity=None, _is_on=True,
        )
        self.light._extended_effects_enabled = True

    def test_the_effect_dropdown(self):
        select = self.select["YeelightCubeNativeEffectSelect"](self.light, None)
        self.assertEqual(sorted(ALL, key=lambda n: ALL[n]["mode"]), select.options)
        for alias, name in FORMER_NAMES.items():
            select._valid_option_or_raise(alias)
            asyncio.run(select.async_select_option(alias))
            self.assertEqual(name, self.light._native_effect)
        with self.assertRaises(ValueError):
            select._valid_option_or_raise("Impact")

    def test_the_clock_style_dropdown(self):
        select = self.select["YeelightCubeClockStyleSelect"](self.light, None)
        self.assertEqual(set(STYLE_ID), set(select.options))
        for alias, name in FORMER_STYLE_NAMES.items():
            select._valid_option_or_raise(alias)
            asyncio.run(select.async_select_option(alias))
            self.assertEqual(STYLE_ID[name], self.light._native_clock_style)


def _favourites_lamp(data):
    from tests.test_favourites import make_lamp

    return make_lamp(data)


class StoredListTests(unittest.IsolatedAsyncioTestCase):
    """Favourites and a rotation stored under former names."""

    async def test_favourites_are_read_and_saved_back_in_todays_names(self):
        domain = CONSTANTS["DOMAIN"]
        data = {domain: {"favourites": {"entry-1": {
            "native": [{"name": "Ocean Waves", "color_mode": "normal", "color": None},
                       {"name": "Waves", "color_mode": "normal", "color": None},
                       {"name": "7", "color_mode": "normal", "color": None},
                       {"name": "Ember", "color_mode": "bw", "color": None}],
            "clock": [{"name": "Blue White", "color_mode": "normal", "color": None},
                      {"name": "custom:abc", "color_mode": "normal", "color": None}],
        }}}}
        lamp = _favourites_lamp(data)
        lamp._restore_favourites()
        # "7" was Dual scan's name until 1.4.0.
        self.assertEqual(
            ["Waves", "Dual scan", "Palette sparks"],
            [item["name"] for item in lamp._favourites["native"]],
        )
        self.assertEqual(
            ["Night-sky waves", "custom:abc"], [item["name"] for item in lamp._favourites["clock"]]
        )
        stored = data[domain]["favourites"]["entry-1"]
        self.assertEqual(
            ["Waves", "Dual scan", "Palette sparks"], [item["name"] for item in stored["native"]]
        )
        lamp._schedule_integration_save.assert_called_once()
        # Today's names: nothing to save back.
        lamp = _favourites_lamp(data)
        lamp._restore_favourites()
        lamp._schedule_integration_save.assert_not_called()
        # Set by the action under former names: today's.
        await lamp.async_set_favourites("native", ["Streamer", {"name": "Twinkle"}, "Dual scan"])
        self.assertEqual(
            ["Ribbon", "Violet twinkles", "Dual scan"], [i["name"] for i in lamp._favourites["native"]]
        )

    async def test_a_rotation_takes_and_resumes_former_names(self):
        from tests.test_effect_rotation import _rotation_helpers, make_light

        helpers = _rotation_helpers()
        domain = CONSTANTS["DOMAIN"]
        light = make_light(helpers, kind="clock")
        await light.start_effect_rotation(["Blue White", "Sunset", "custom:abc123"], 604800, "clock")
        self.assertEqual(
            ["Night-sky waves", "Rainbow noise", "custom:abc123"],
            [item["name"] for item in light._rotation_items],
        )
        light.stop_effect_rotation()
        native = make_light(helpers, kind="native", extended=True)
        await native.start_effect_rotation(["Streamer", "Pulse", "7"], 604800)
        self.assertEqual(
            ["Ribbon", "Sunrise and sunset", "Dual scan"],
            [item["name"] for item in native._rotation_items],
        )
        native.stop_effect_rotation()
        # A rotation saved by an older version: resumed, saved back in today's names.
        restarted = make_light(helpers, kind="native")
        restarted.hass.data[domain]["rotation"] = {"entry-1": {
            "intervals": {"native": 60},
            "active": {"kind": "native", "interval": 60, "group": [],
                       "items": [{"name": "Bonfire"}, "Shooting Star"]},
        }}
        restarted._restore_rotation_settings()
        saved = restarted.hass.data[domain]["rotation"]["entry-1"]["active"]
        self.assertEqual(["Fire", "Meteor"], [item["name"] for item in saved["items"]])
        self.assertEqual(saved, restarted._rotation_restore)
        restarted._schedule_integration_save.assert_called()


class MusicFlowTests(unittest.TestCase):
    """Music Flow has its own names: a native name never selects one, and the
    effects' former names never apply to it."""

    def test_music_flow_names_stay_in_their_own_list(self):
        native = (ROOT / "light_native.py").read_text(encoding="utf-8")
        for function in ("_build_music_flow_payload", "async_set_music_flow_effect"):
            self.assertNotIn("canonical", _function_source(native, function))
        restore = (ROOT / "light_restore.py").read_text(encoding="utf-8")
        self.assertIn(
            '("music_flow_effect", "_music_flow_effect", _member_of(MUSIC_FLOW_EFFECTS))', restore
        )
        # Breathing and Music Note are a native effect and a Music Flow effect:
        # each list keeps its own.
        self.assertEqual(2, ALL["Breathing"]["mode"])
        self.assertEqual(73, ALL["Music Note"]["mode"])
        self.assertEqual(84, CONSTANTS["MUSIC_FLOW_EFFECTS"]["Breathing"])
        self.assertEqual(87, CONSTANTS["MUSIC_FLOW_EFFECTS"]["Music Note"])
        for name in CONSTANTS["MUSIC_FLOW_EFFECTS"]:
            self.assertNotIn(name, ALIASES)


if __name__ == "__main__":
    unittest.main()
