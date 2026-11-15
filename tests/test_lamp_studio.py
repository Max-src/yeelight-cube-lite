"""The palette color mode beyond what the lamp takes: every effect in the
whole palette, on the lamp itself when it takes it (lamp_renderers.palette_fits),
else drawn by the integration (lamp_studio.py, www/lamp-studio.js) and
streamed to the lamp (light_studio.py), a clock over such an effect too; an
animation's GIF recolored; the microphone's effects left to the lamp."""

import asyncio
import sys
import json
import random
from datetime import datetime
import runpy
import shutil
import subprocess
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_activation_timing import _table as activation_timing
from tests.test_native_features import (
    CONSTANTS, LAMP_RENDERERS, NATIVE_PREVIEW, ROOT, _load_standalone_functions,
    import_pure_module,
)
from fakes import FakeHass, instant_sleeps, light_state, make_light, module, run

# The stream draws its frames inside lamp_core.full_replay (the real one).
LAMP_CORE_FULL = sys.modules[LAMP_RENDERERS["replays_in_full"].__module__].drawn_in_full

STUDIO = runpy.run_path(ROOT / "lamp_studio.py")
ANIMATION_MODULE = runpy.run_path(ROOT / "lamp_animations.py")
studio_frame = STUDIO["studio_frame"]
studio_frame_at = STUDIO["studio_frame_at"]
studio_drive = STUDIO["studio_drive"]
track_step = STUDIO["track_step"]
LOOKS = STUDIO["STUDIO_LOOKS"]
EFFECTS = CONSTANTS["ALL_NATIVE_EFFECTS"]
DRAWN = LAMP_RENDERERS["LAMP_RENDERED_EFFECTS"]
MUSIC = LAMP_RENDERERS["LAMP_MUSIC_EFFECTS"]
ANIMATIONS = {name for name, spec in EFFECTS.items() if spec.get("animation")}
LISTED = {name for name, spec in EFFECTS.items() if not spec.get("hidden")}
RED, GREEN, BLUE, YELLOW = (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)
PALETTE = [RED, GREEN, BLUE]


def nearest_entry(pixel, palette):
    """The palette entry a pixel shows (None: dim, or no entry near)."""
    high = max(pixel)
    if high < 8:
        return None
    scaled = [channel * 255 / high for channel in pixel]
    distances = [sum((a - b) ** 2 for a, b in zip(scaled, colour)) for colour in palette]
    nearest = min(range(len(palette)), key=distances.__getitem__)
    return nearest if distances[nearest] < 80 ** 2 else None


def lit_colours(effect, palette, seconds=17.0, step=0.12):
    """The palette entries an effect shows within ``seconds``."""
    seen = set()
    entries = {}  # each colour once: frames repeat them
    for render in range(int(seconds / step)):
        for pixel in studio_frame(effect, render * step, "Right", 128, None, None, palette):
            if (entry := entries.get(pixel, -1)) == -1:
                entry = entries[pixel] = nearest_entry(pixel, palette)
            if entry is not None:
                seen.add(entry)
        if len(seen) == len(palette):
            break  # every entry seen: nothing more to find
    return seen


class StudioRuleTests(unittest.TestCase):
    def test_one_color_mode_for_the_palette(self):
        # No mode of its own: Palette shows every effect it can in the
        # whole palette (the lamp's own when it takes it, else streamed).
        self.assertNotIn("EFFECT_COLOR_MODES", CONSTANTS)
        self.assertNotIn("STUDIO_COLOR_MODE", CONSTANTS)
        self.assertNotIn("studio", CONSTANTS["NATIVE_COLOR_MODES"])

    def test_palette_offers_every_effect_it_can_color(self):
        offers = NATIVE_PREVIEW["effect_offers_color_mode"]
        supports = NATIVE_PREVIEW["effect_supports_color_mode"]
        offered = {name for name in LISTED if offers(name, "palette")}
        # All but the microphone's effects that take no color on the lamp.
        self.assertEqual(
            offered,
            {name for name in LISTED if name not in MUSIC or supports(name, "palette")},
        )
        self.assertIn("Hacking", offered)  # takes none on the lamp: streamed
        self.assertIn("Snowfall", offered)  # its GIF recolored
        streamed = {name for name in EFFECTS if STUDIO["effect_supports_studio"](name)}
        # The integration's own effects take the palette in their renderer.
        own = set(CONSTANTS["STREAMED_EFFECTS"])
        self.assertEqual(streamed, set(DRAWN) - MUSIC - own)
        self.assertTrue(own <= offered)
        self.assertEqual(set(LOOKS), streamed | ANIMATIONS)
        self.assertEqual(len(MUSIC), 12)
        # The other modes offer what the lamp takes, as before.
        self.assertEqual(offers("Hacking", "bw"), supports("Hacking", "bw"))

    def test_the_lamp_s_own_palette_when_it_takes_it_else_the_stream(self):
        runs = STUDIO["studio_runs"]
        fits = LAMP_RENDERERS["palette_fits"]
        # One color: every effect that takes a color shows it on the lamp.
        self.assertTrue(fits("Rainbow", [RED]))
        self.assertFalse(runs("Rainbow", "palette", [RED]))
        # More colors than it draws: streamed.
        self.assertFalse(fits("Rainbow", PALETTE))
        self.assertTrue(runs("Rainbow", "palette", PALETTE))
        # An effect drawing four colors takes four palette colors itself.
        self.assertTrue(fits("Rotating colour bands", [RED, GREEN, BLUE, YELLOW]))
        self.assertFalse(runs("Rotating colour bands", "palette", [RED, GREEN, BLUE, YELLOW]))
        self.assertTrue(runs("Rotating colour bands", "palette", [RED, GREEN, BLUE, YELLOW, (9, 9, 9)]))
        # Takes no color on the lamp: streamed whatever the palette.
        self.assertTrue(runs("Hacking", "palette", [RED]))
        # Only in the palette color mode.
        self.assertFalse(runs("Rainbow", "normal", PALETTE))
        self.assertFalse(runs("Rainbow", "red_blue", PALETTE))

    def test_the_microphone_s_effects_stay_the_lamp_s(self):
        settings = LAMP_RENDERERS["lamp_settings"]
        for effect in sorted(MUSIC):
            self.assertFalse(STUDIO["studio_runs"](effect, "palette", PALETTE), effect)
        # The six music modes: the lamp's microphone mode, the whole palette.
        flow = LAMP_RENDERERS["palette_music_flow"]
        self.assertEqual(flow("Music Spectrum", "palette", PALETTE), "Spectrum")
        self.assertIsNone(flow("Rainbow", "palette", PALETTE))
        self.assertIn("palette", settings("Music Impact", "Up", 128, None, "palette", None, None, PALETTE))

    def test_a_clock_streams_its_background_only_when_the_lamp_cannot_color_it(self):
        clock_runs = STUDIO["clock_studio_runs"]
        self.assertTrue(clock_runs("Fire", "palette", PALETTE))
        self.assertFalse(clock_runs("Fire", "palette", [RED]))
        # A plain style: the lamp's first color; a microphone's background: the lamp's.
        self.assertFalse(clock_runs(None, "palette", PALETTE))
        self.assertFalse(clock_runs("Music Spectrum", "palette", PALETTE))
        self.assertFalse(clock_runs("Fire", "normal", PALETTE))
        # The background as the lamp runs it behind its clock, recolored.
        background = STUDIO["studio_clock_background_at"]("Fire", 40, 128, 128, PALETTE, False)
        self.assertEqual(len(background), 100)
        self.assertTrue(any(max(pixel) for pixel in background))

    def test_a_pixel_keeps_the_effect_s_brightness(self):
        for effect in ("Rainbow", "Fire", "Starry Sky", "Magic", "Building Blocks", "Wonderland"):
            settings = LAMP_RENDERERS["lamp_settings"](effect, "Right", 128)
            for render in (10, 50, 130):
                drawn = LAMP_RENDERERS["lamp_effect_frame"](settings, (render + 0.5) * 0.04)
                sent = studio_frame_at(effect, render, "Right", 128, None, None, [RED, BLUE, YELLOW])
                self.assertEqual([max(pixel) for pixel in drawn], [max(pixel) for pixel in sent], effect)

    def test_every_effect_shows_the_palette(self):
        for effect in sorted(set(LOOKS) - ANIMATIONS):
            seen = lit_colours(effect, PALETTE)
            if LOOKS[effect][0] == "first":
                self.assertLessEqual(seen, {0}, effect)
            elif effect.endswith("(one-shot)") or effect in ("Sine plotter", "Dot with fading trail"):
                # Over at once, or one dot at a time.
                self.assertTrue(seen, effect)
            else:
                self.assertGreaterEqual(len(seen), 2, effect)

    def test_the_looks_are_well_formed(self):
        for effect, look in LOOKS.items():
            kind, values = look[0], look[1:]
            self.assertIn(kind, ("wheel", "hue", "level", "object", "first"), effect)
            if kind in ("hue", "level"):
                knots = values[1:] if kind == "hue" else values
                self.assertEqual(len(knots), 5, effect)
                self.assertEqual(list(knots), sorted(knots), effect)
        # The effects called out by name.
        for effect in ("Starry Sky", "Building Blocks", "Hacking", "Snowfall"):
            self.assertEqual(LOOKS[effect][0], "object", effect)
        for effect in ("Waves", "Aurora", "Sunrise and sunset", "Rising wisps",
                       "Violet interference", "Fire", "Particle glows"):
            self.assertEqual(LOOKS[effect][0], "level", effect)
        for effect in ("White fill-in (one-shot)", "White wipe-out (one-shot)"):
            self.assertEqual(LOOKS[effect], ("first",), effect)

    def test_white_fill_in_takes_the_first_color_only(self):
        for render in (5, 20, 40):
            for pixel in studio_frame_at("White fill-in (one-shot)", render, "Right", 128, None, None, PALETTE):
                if max(pixel):
                    self.assertEqual((pixel[1], pixel[2]), (0, 0))

    def test_without_a_palette_the_effect_runs_as_in_the_normal_mode(self):
        self.assertFalse(STUDIO["studio_runs"]("Rainbow", "palette", []))
        render = NATIVE_PREVIEW["render_native_effect"]
        self.assertEqual(
            render("Rainbow", 2.0, "Right", None, "palette", 128, None, None, []),
            render("Rainbow", 2.0, "Right", None, "normal", 128),
        )

    def test_previews_show_what_the_lamp_shows_of_the_stream(self):
        speed, seconds = 128, 3.5
        phase = seconds * (0.25 + speed / 55.0)
        render = NATIVE_PREVIEW["render_native_effect"]
        shown = render("Fire", phase, "Right", None, "palette", speed, None, None, PALETTE)
        sent = studio_frame("Fire", seconds, "Right", speed, None, None, PALETTE)
        # LED drive, like every effect preview (the lamp converts what it gets).
        self.assertEqual(shown, studio_drive(sent))
        # An animation: its GIF recolored, in its layout.
        for layout in (None, "app"):
            self.assertEqual(
                render("Snowfall", phase, "Right", None, "palette", speed, None, None, PALETTE,
                       None, layout),
                ANIMATION_MODULE["animation_frame"]("snowfall", seconds, None, layout, speed, None, PALETTE),
            )
        self.assertNotEqual(
            render("Snowfall", phase, "Right", None, "palette", speed, None, None, PALETTE),
            render("Snowfall", phase, "Right", None, "normal", speed),
        )

    def test_a_long_palette_uses_its_first_colors(self):
        long = [(index, 255 - index, 128) for index in range(40)]
        self.assertEqual(STUDIO["studio_palette"](long), long[:STUDIO["STUDIO_PALETTE_LIMIT"]])
        self.assertEqual(STUDIO["studio_palette"]([[1, 2], "x", [1, 2, 3, 4]]), [(1, 2, 3)])

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_js_port_is_the_same(self):
        module = (ROOT / "www" / "lamp-studio.js").as_uri()
        palettes = [PALETTE, [(255, 40, 0), (255, 200, 0), (0, 200, 120), (60, 60, 255)], [(9, 99, 199)]]
        cases = [
            [effect, seconds, direction, speed, orientation, intensity, index]
            for effect in ("Rainbow", "Fire", "Magic", "Wonderland", "Rotating colour bands",
                           "Starry Sky", "Building Blocks", "Hacking", "Violet interference",
                           "White fill-in (one-shot)", "Waves", "Centre bursts")
            for seconds, direction, speed, orientation, intensity, index in (
                (0.5, "Right", 128, None, None, 0),
                (3.21, "Left", 200, "left", 90, 1),
                (7.0, "Up", 40, "up", 255, 2),
                (7.04, "Up", 40, "up", 255, 2),
            )
        ]
        script = (
            f"const s = await import({json.dumps(module)});"
            f"const palettes = {json.dumps(palettes)};"
            f"const cases = {json.dumps(cases)};"
            "process.stdout.write(JSON.stringify({"
            " frames: cases.map(([e, t, d, v, o, i, p]) => s.studioFrame(e, t, d, v, o, i, palettes[p])),"
            " start: [0, 1, 40].map((r) => s.studioFrameAt('Building Blocks', r, 'Right', 128, null, null, palettes[1], true)),"
            " looks: s.STUDIO_LOOKS }));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        out = json.loads(result.stdout)
        expected = [
            [list(pixel) for pixel in studio_frame(e, t, d, v, o, i, palettes[p])]
            for e, t, d, v, o, i, p in cases
        ]
        self.assertEqual(expected, out["frames"])
        self.assertEqual(
            [[list(pixel) for pixel in studio_frame_at("Building Blocks", r, "Right", 128, None, None, palettes[1], True)]
             for r in (0, 1, 40)],
            out["start"],
        )
        self.assertEqual({name: list(look) for name, look in LOOKS.items()}, out["looks"])


class PaletteRuleParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_js_rules_and_clock_backgrounds_are_the_same(self):
        module = (ROOT / "www" / "lamp-studio.js").as_uri()
        renderers = (ROOT / "www" / "lamp-renderers.js").as_uri()
        names = sorted(LISTED)
        palettes = [[RED], PALETTE, [RED, GREEN, BLUE, YELLOW], [RED, GREEN, BLUE, YELLOW, (9, 9, 9)]]
        script = (
            f"const s = await import({json.dumps(module)});"
            f"const r = await import({json.dumps(renderers)});"
            f"const names = {json.dumps(names)}; const palettes = {json.dumps(palettes)};"
            "process.stdout.write(JSON.stringify({"
            " offers: names.map((n) => s.effectOffersColorMode(n, 'palette')),"
            " runs: names.map((n) => palettes.map((p) => s.studioRuns(n, 'palette', p))),"
            " fits: names.map((n) => palettes.map((p) => r.paletteFits(n, p))),"
            " clock: [0, 7, 90].map((at) => s.studioClockBackgroundAt('Fire', at, 128, 128, palettes[1], false)),"
            "}));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        out = json.loads(result.stdout)
        self.assertEqual([NATIVE_PREVIEW["effect_offers_color_mode"](n, "palette") for n in names], out["offers"])
        self.assertEqual(
            [[STUDIO["studio_runs"](n, "palette", p) for p in palettes] for n in names], out["runs"],
        )
        self.assertEqual(
            [[LAMP_RENDERERS["palette_fits"](n, p) for p in palettes] for n in names], out["fits"],
        )
        self.assertEqual(
            [[list(pixel) for pixel in STUDIO["studio_clock_background_at"]("Fire", at, 128, 128, PALETTE, False)]
             for at in (0, 7, 90)],
            out["clock"],
        )


class AnimationTests(unittest.TestCase):
    """An animation in Studio: its GIF recolored, played by the lamp."""

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_js_frames_are_the_same(self):
        module = (ROOT / "www" / "lamp-animation-frames.js").as_uri()
        keys = list(ANIMATION_MODULE["animation_names"]())
        script = (
            f"const a = await import({json.dumps(module)});"
            f"const keys = {json.dumps(keys)};"
            f"const palette = {json.dumps(PALETTE)};"
            "process.stdout.write(JSON.stringify(keys.map((k) => [null, 'app'].map((layout) =>"
            " [0.3, 2.7, 5.1].map((t) => a.animationFrame(k, t, 'left', layout, 150, null, palette))))));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        frame = ANIMATION_MODULE["animation_frame"]
        expected = [
            [[[list(pixel) for pixel in frame(key, t, "left", layout, 150, None, PALETTE)]
              for t in (0.3, 2.7, 5.1)] for layout in (None, "app")]
            for key in keys
        ]
        self.assertEqual(expected, json.loads(result.stdout))

    def test_the_gif_is_recolored_and_fits_256_colors(self):
        many = [((index * 37) % 256, (index * 91) % 256, (index * 53) % 256) for index in range(16)]
        for key in ANIMATION_MODULE["animation_names"]():
            own = ANIMATION_MODULE["lamp_gif"](key, None, None, 128)
            recolored = ANIMATION_MODULE["lamp_gif"](key, None, None, 128, None, many)
            self.assertNotEqual(own, recolored, key)
            for layout in (None, "app"):
                ANIMATION_MODULE["lamp_gif"](key, "left", layout, 200, None, many)

    def test_the_lamp_gets_its_gif_again_when_the_palette_changes(self):
        class Channel:
            """The lamp's Matter commands, acknowledging every GIF packet."""

            def __init__(self):
                self.ends = 0  # uploads finished (their end marker)

            async def async_available(self):
                return True

            async def async_command(self, cluster, name, payload):
                self.ends += payload["data"] == "BA=="
                return {"status": 6}

        channel = Channel()
        light = make_light(matter_commands=channel, _native_effect="Snowfall",
                           _native_effect_color_mode="palette", _text_colors=[RED, GREEN])
        run(light._store_animation("snowfall"))
        self.assertEqual(1, channel.ends)
        self.assertEqual([list(RED), list(GREEN)], light._stored_gif["palette"])
        run(light._store_animation("snowfall"))  # the same palette: there already
        self.assertEqual(1, channel.ends)
        light._text_colors = [BLUE, GREEN]
        run(light._store_animation("snowfall"))
        self.assertEqual(2, channel.ends)
        self.assertEqual([list(BLUE), list(GREEN)], light._stored_gif["palette"])
        # Out of the palette color mode: its own colors again.
        light._native_effect_color_mode = "normal"
        run(light._store_animation("snowfall"))
        self.assertEqual(3, channel.ends)
        self.assertIsNone(light._stored_gif["palette"])
        # Played by the lamp, not streamed: smooth, in the chosen layout.
        self.assertFalse(STUDIO["studio_runs"]("Snowfall", "palette", PALETTE))


class StartTests(unittest.TestCase):
    def test_the_stream_starts_the_effect_from_its_first_render(self):
        lit = lambda frame: sum(1 for pixel in frame if max(pixel))  # noqa: E731
        stream = studio_frame_at("Building Blocks", 0, "Right", 128, None, None, PALETTE, True)
        preview = studio_frame_at("Building Blocks", 0, "Right", 128, None, None, PALETTE)
        # The lamp from an empty panel; a preview where it is worth a look.
        self.assertLess(lit(stream), lit(preview))
        self.assertLessEqual(lit(stream), 4)


class FieldTests(unittest.TestCase):
    """A field's colors follow its shapes, not each pixel's noise."""

    def test_pixels_do_not_flicker_between_colors(self):
        palette = [(255, 0, 0), (255, 128, 0), (255, 255, 0), (0, 255, 0),
                   (0, 255, 255), (0, 0, 255), (128, 0, 255), (255, 0, 255)]
        for effect, most in (("Waves", 0.02), ("Navy-white noise", 0.02), ("Violet interference", 0.12)):
            frames = [studio_frame_at(effect, render, "Right", 128, None, None, palette) for render in range(200)]
            jumps = checked = 0
            for before, after in zip(frames, frames[1:]):
                for pixel_before, pixel_after in zip(before, after):
                    a, b = nearest_entry(pixel_before, palette), nearest_entry(pixel_after, palette)
                    if a is not None and b is not None:
                        checked += 1
                        jumps += abs(a - b) > 1
            self.assertLess(jumps / checked, most, effect)


class ObjectTests(unittest.TestCase):
    """Each dot, block or digit keeps one color while it is lit."""

    @staticmethod
    def frame(lit, level=200):
        return [(level, 0, 0) if index in lit else (0, 0, 0) for index in range(100)]

    def run_frames(self, frames, floor=16):
        state = ([-1] * 100, [0] * 100, 0)
        out = []
        for frame in frames:
            state = track_step(state, frame, floor)
            out.append(state[0])
        return out

    def test_a_moving_dot_keeps_its_object(self):
        labels = self.run_frames([self.frame({20 + step}) for step in range(10)])
        self.assertEqual({row[20 + step] for step, row in enumerate(labels)}, {0})

    def test_a_falling_block_keeps_its_object_beside_a_resting_one(self):
        rest = {0, 1}
        frames = [self.frame(rest | {82}), self.frame(rest | {62}), self.frame(rest | {42}),
                  self.frame(rest | {22}), self.frame(rest | {2})]
        labels = self.run_frames(frames)
        resting, falling = labels[0][0], labels[0][82]
        self.assertNotEqual(resting, falling)
        # Landed next to the resting block, still its own.
        self.assertEqual(labels[-1][2], falling)
        self.assertEqual(labels[-1][0], resting)

    def test_a_block_appearing_beside_a_resting_one_is_new(self):
        labels = self.run_frames([self.frame({0}), self.frame({0, 1})])
        self.assertNotEqual(labels[1][0], labels[1][1])

    def test_a_shape_appearing_at_once_is_one_object(self):
        labels = self.run_frames([self.frame({40, 41, 60, 61})])
        self.assertEqual(len({labels[0][index] for index in (40, 41, 60, 61)}), 1)

    def test_what_is_dimmer_than_the_floor_takes_the_first_color(self):
        background = [(0, 50, 0)] * 100
        background[45] = (0, 220, 0)
        labels = self.run_frames([background], floor=128)
        self.assertEqual(labels[0].count(-1), 99)
        out = STUDIO["recolour"](background, ("object", 128), PALETTE, labels[0])
        self.assertEqual(out[0], (50, 0, 0))  # first color, its brightness
        self.assertEqual(out[45], (0, 220, 0))  # the first object: the second color

    def test_hacking_digits_keep_their_colors_as_they_scroll(self):
        frames = [
            studio_frame_at("Hacking", render, "Right", 128, None, None, PALETTE)
            for render in range(200, 260)
        ]
        # A bright digit pixel keeps its color from frame to frame while lit.
        changed = 0
        for before, after in zip(frames, frames[1:]):
            for pixel_before, pixel_after in zip(before, after):
                if max(pixel_before) > 128 and max(pixel_after) > 128:
                    changed += nearest_entry(pixel_before, PALETTE) != nearest_entry(pixel_after, PALETTE)
        self.assertEqual(changed, 0)

    def test_the_objects_do_not_depend_on_the_order_asked(self):
        late = studio_frame_at("Starry Sky", 300, "Right", 128, None, None, PALETTE)
        for render in range(0, 300, 7):
            studio_frame_at("Starry Sky", render, "Right", 128, None, None, PALETTE)
        self.assertEqual(studio_frame_at("Starry Sky", 300, "Right", 128, None, None, PALETTE), late)


class PaletteAcceptedTests(unittest.TestCase):
    """The palette color mode is the one mode wherever one is read."""

    def test_the_action_offers_what_palette_can_color(self):
        modes = CONSTANTS["NATIVE_COLOR_MODES"]
        self.assertIn("palette", modes)
        self.assertNotIn("studio", modes)
        # The action takes the color modes (voluptuous here records what
        # each validator was built with), and refuses one the effect lacks.
        hass = FakeHass({CONSTANTS["DOMAIN"]: {}})
        schemas = {}

        def register(domain, name, handler, schema=None, **kwargs):
            hass.registered[(domain, name)] = handler
            schemas[name] = schema

        hass.services.async_register = register
        module("light_services_native").async_register_native_services(hass)
        for name in ("set_native_effect", "set_clock_style"):
            fields = schemas[name]._stub_args[0]
            chosen, = [value for key, value in fields.items()
                       if type(key).__name__ == "Optional" and key._stub_args == ("color_mode",)]
            self.assertEqual((list(modes),), chosen._stub_args, name)
        handler = hass.registered[(CONSTANTS["DOMAIN"], "set_native_effect")]
        light = make_light(hass=hass, entity_id="light.cube", _is_on=True,
                           request_native_effect=Mock(return_value=()), async_send_native_effect=Mock())
        registry = module("light")._ENTITY_REGISTRY
        self.addCleanup(registry.pop, "test-color-mode", None)
        registry["test-color-mode"] = light
        call = lambda **data: SimpleNamespace(  # noqa: E731
            data={"entity_id": "light.cube", "activate": False, **data}, hass=hass,
            context=SimpleNamespace(user_id=None))
        for effect, mode in (("Meteor", "bw"), ("Rainbow", "studio")):
            with self.assertRaises(module("errors").ServiceValidationError, msg=(effect, mode)):
                run(handler(call(effect=effect, color_mode=mode)))
        light.request_native_effect.assert_not_called()
        for effect, mode in (("Meteor", "palette"), ("Rainbow", "bw")):
            run(handler(call(effect=effect, color_mode=mode)))
            self.assertEqual(mode, light.request_native_effect.call_args.kwargs["color_mode"])
        # A saved color mode comes back after a restart, an older "studio"
        # does not; a rotation's entry takes it, or the effect's own colors.
        restored = {name: convert for name, _attr, convert in module("light_restore")._RESTORED_ATTRIBUTES}
        for name in ("native_effect_color_mode", "clock_color_mode"):
            self.assertEqual("palette", restored[name]("palette"))
            self.assertIs(module("light_restore")._INVALID, restored[name]("studio"))  # the default kept
        normalized = make_light()._normalize_rotation_items([
            {"name": "Rainbow", "color_mode": "palette"}, {"name": "Rainbow", "color_mode": "studio"},
        ])
        self.assertEqual(["palette", "normal"], [item["color_mode"] for item in normalized])
        # The UI's choices are the same modes.
        import yaml

        actions = yaml.safe_load((ROOT / "services.yaml").read_text(encoding="utf-8"))
        for name in ("set_native_effect", "set_clock_style"):
            options = actions[name]["fields"]["color_mode"]["selector"]["select"]["options"]
            self.assertEqual(list(modes), [option["value"] if isinstance(option, dict) else option for option in options], name)

    def test_a_streamed_clock_starts_like_a_streamed_effect(self):
        for streamed in (True, False):
            light = make_light(_mode=CONSTANTS["MODE_CLOCK"], studio_selected=lambda streamed=streamed: streamed,
                               _start_studio_stream=AsyncMock())
            with instant_sleeps():
                run(light._activate_native_clock())
            self.assertEqual(streamed, light._start_studio_stream.await_count == 1)
            self.assertEqual(not streamed, "set_fx_effect" in light._lamp_client.methods(), streamed)

    def test_the_lamp_reports_its_drawing_mode_while_streaming(self):
        from tests.test_matter_link import MATTER, FakeLight

        light = FakeLight()
        light._mode = "Native Effect"
        light.studio_selected = lambda: True
        self.assertEqual(light._expected_effect(), MATTER.DRAWING_EFFECT)
        light._note_lamp_command()
        self.assertTrue(light._effect_echo(MATTER.DRAWING_EFFECT))
        light.studio_selected = lambda: False
        self.assertEqual(light._expected_effect(), EFFECTS["Rainbow"]["effect_id"])
        # A streamed clock too.
        light._mode = "Clock"
        light.studio_selected = lambda: True
        self.assertEqual(light._expected_effect(), MATTER.DRAWING_EFFECT)


class FakeLock:
    """The lamp's lock: ``busy`` makes it look held by another command."""

    def __init__(self):
        self.busy = False

    def locked(self):
        return self.busy

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


STREAM_NAMES = {
    "studio_selected", "studio_streaming", "_studio_render_at", "_studio_payload",
    "_chosen_effect_intensity", "_start_studio_stream", "_native_effect_streamed",
    "_studio_loop", "stop_studio_stream", "_clock_style", "studio_clock_frame",
    "_run_studio_loop", "_start_matrix_stream", "_stream_probe",
    "_streams_changed", "_stream_watchdog", "stream_report",
}
CLOCK_FACE = import_pure_module("clock_face")
# A clock style over Fire.
FIRE_CLOCK = next(
    style_id for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items()
    if CONSTANTS["clock_style_effect"](style) == "Fire"
)


class StreamTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sent = []
        self.renders = []
        self.lock = FakeLock()

        def frame_at(effect, render, *args):
            self.renders.append(render)
            return studio_frame_at(effect, render, *args)

        fns = _load_standalone_functions(
            (ROOT / "light_studio.py").read_text(encoding="utf-8"), STREAM_NAMES, {
                "asyncio": asyncio, "time": time, "random": random, "_LOGGER": Mock(),
                "MODE_NATIVE_EFFECT": CONSTANTS["MODE_NATIVE_EFFECT"],
                "DEFAULT_NATIVE_EFFECT_INTENSITY": CONSTANTS["DEFAULT_NATIVE_EFFECT_INTENSITY"],
                "studio_frame_at": frame_at, "studio_runs": STUDIO["studio_runs"],
                "encode_rgb_frame": lambda frame: tuple(map(tuple, frame)),
                "trace_frame": Mock(), "hardware_brightness_for": lambda value: 100,
                "drawn_in_full": LAMP_CORE_FULL,
                "_get_device_lock": lambda ip: self.lock,
                "ACTIVATION_TIMING": activation_timing(),
                "STUDIO_FRAME_SECONDS": 0.005, "STUDIO_RETRY_SECONDS": 0.05,
                "STUDIO_PROBE_SECONDS": 0.05, "STUDIO_SILENT_PROBE_SECONDS": 0.05, "STUDIO_RESTART_MOST": 0.2,
                "STUDIO_SILENT_AFTER": 3,
                # A Cube Lite: every render is sent (device_profile.max_fps None).
                "studio_stride": lambda max_fps: 1,
                # The clock.
                **{name: CONSTANTS[name] for name in (
                    "MODE_CLOCK", "CLOCK_MIXER_EFFECTS", "NATIVE_CLOCK_STYLES",
                    "DEFAULT_NATIVE_CLOCK_STYLE", "clock_style_direct", "clock_style_effect",
                    "LITE_STREAMED_EFFECTS", "ALL_NATIVE_EFFECTS",
                )},
                "clock_studio_runs": STUDIO["clock_studio_runs"],
                "studio_clock_background_at": STUDIO["studio_clock_background_at"],
                "clock_digit_flags": LAMP_RENDERERS["clock_digit_flags"],
                "clock_text": CLOCK_FACE.clock_text, "clock_content": CLOCK_FACE.clock_content,
                "clock_digit_pixels": CLOCK_FACE.clock_digit_pixels,
                "dt_util": SimpleNamespace(now=lambda: datetime(2026, 11, 8, 12, 34, 56)),
            },
        )

        async def executor(func, *args):
            return func(*args)

        async def send(command, params):
            self.sent.append((command, params))

        light = light_state(
            _ip="test", hass=SimpleNamespace(async_add_executor_job=executor),
            _is_on=True, _mode=CONSTANTS["MODE_NATIVE_EFFECT"], _native_effect="Rainbow",
            _native_effect_color_mode="palette", _text_colors=[[255, 0, 0], [0, 0, 255]],
            _native_effect_direction="Right", _native_effect_speed=128,
            _native_effect_intensity=128, _device_orientation="right",
            _music_flow_enabled=False, _calibration_lock=False, _external_display=False,
            _display_frozen=False, _in_native_fw_mode=True, _fx_mode_is_direct=False,
            _brightness=255, _last_hardware_brightness=None, _last_fx_mode_time=0.0,
            _studio_task=None, _studio_key=None, _studio_origin=0.0, _studio_last_render=-1,
            _lamp_client=SimpleNamespace(transport="udp", is_connected=lambda: True,
                                         send_command_fast=send, owners=set(),
                                         stream_running=self.stream_running,
                                         streams_running=False, stream_silent=False,
                                         probe=self.probe, answers=True,
                                         # A Cube Lite: its own effects (device_profile).
                                         profile=SimpleNamespace(streams_effects=False)),
            _brightness_stages=lambda frame: frame, _lamp_frame=lambda frame: frame,
            _notify_camera_preview=Mock(), async_schedule_update_ha_state=Mock(),
            _direct_mode_trusted=lambda: light._fx_mode_is_direct,
            _create_tracked_task=lambda coro, name=None: asyncio.get_running_loop().create_task(coro),
        )

        async def ensure_fx_ready():
            self.sent.append(("activate_fx_mode", None))
            light._fx_mode_is_direct = True
            light._in_native_fw_mode = False

        async def draw(payload):
            self.sent.append(("first", payload))

        light.ensure_fx_ready = ensure_fx_ready
        light._draw_direct = draw
        for name in STREAM_NAMES:
            setattr(light, name, fns[name].__get__(light))
        self.light = light

    async def probe(self, answering=False):
        """The fake transport's answered probe (LampClient.probe)."""
        self.sent.append(("probe", answering))
        return self.light._lamp_client.answers

    def stream_running(self, owner, running):
        """The fake transport's lease (LampClient.stream_running)."""
        matrix = self.light._lamp_client
        before = bool(matrix.owners)
        (matrix.owners.add if running else matrix.owners.discard)(owner)
        matrix.streams_running = bool(matrix.owners)
        if matrix.streams_running != before:
            self.light._streams_changed()  # LampClient.on_stream_change

    def frames(self):
        return [entry for entry in self.sent if entry[0] == "update_leds"]

    async def run_for(self, seconds):
        await asyncio.sleep(seconds)

    async def test_the_transport_keeps_its_pauses_busy_only_while_it_streams(self):
        # LampClient.stream_running: a slow or failed render never leaves a
        # Cube Lite silent mid-stream; once stopped, the stream's end is
        # the lamp's usual one.
        await self.light._start_studio_stream()
        await self.run_for(0.03)
        self.assertEqual({"studio"}, self.light._lamp_client.owners)
        self.light._is_on = False  # stops at its next frame
        await self.run_for(0.05)
        self.assertEqual(set(), self.light._lamp_client.owners)
        self.assertIsNone(self.light._studio_task)

    async def test_a_lamp_that_stops_answering_mid_stream_is_seen_and_reported(self):
        # 2026-11-14: frames are never answered, so a Cube Lite stuck while
        # streamed stayed "on" for minutes. Every STUDIO_PROBE_SECONDS it is
        # asked for an answer of its own; silent: frames pause, the problem
        # check runs, logged once; answering again: the stream goes on, in
        # direct mode again.
        checks = []
        self.light.hass = SimpleNamespace(async_add_executor_job=self.light.hass.async_add_executor_job)
        self.light._async_check_problems = lambda: checks.append(1)
        logger = self.light._studio_loop.__func__.__globals__["_LOGGER"]
        logger.reset_mock()
        await self.light._start_studio_stream()
        await self.run_for(0.12)
        self.assertIn(("probe", True), self.sent)
        self.assertEqual([], checks)
        self.light._lamp_client.answers = False
        # One or two lost answers (a weak link): the frames go on
        # (STUDIO_SILENT_AFTER: a pause is a stream end, when lamps hang),
        # logged at INFO.
        await self.run_for(0.06)
        going = len(self.frames())
        await self.run_for(0.03)
        self.assertGreater(len(self.frames()), going)
        self.assertEqual(0, logger.warning.call_count)
        self.assertTrue(logger.info.called)
        # The third in a row: frames pause, logged once.
        await self.run_for(0.2)
        stopped = len(self.frames())
        await self.run_for(0.15)
        self.assertEqual(stopped, len(self.frames()))  # paused
        self.assertGreaterEqual(len(checks), 3)
        self.assertEqual(1, logger.warning.call_count)
        self.assertIn("effect", logger.warning.call_args[0][-1])  # stream_report
        self.light._lamp_client.answers = True
        activations = self.sent.count(("activate_fx_mode", None))
        await self.run_for(0.2)
        self.assertGreater(len(self.frames()), stopped)  # going on
        self.assertGreater(self.sent.count(("activate_fx_mode", None)), activations)
        self.light.stop_studio_stream()

    async def test_a_scrolling_text_is_checked_too(self):
        # The check belongs to whatever streams to the lamp (the transport's
        # leases), not to the effect stream: a Cube Lite stuck while a text
        # scrolls is reported as well.
        checks = []
        self.light._async_check_problems = lambda: checks.append(1)
        self.stream_running("scroll", True)
        await self.run_for(0.12)
        self.assertIn(("probe", True), self.sent)
        self.light._lamp_client.answers = False
        await self.run_for(0.25)  # STUDIO_SILENT_AFTER checks
        self.assertTrue(checks)
        self.assertTrue(self.light._lamp_client.stream_silent)
        self.stream_running("scroll", False)
        await self.run_for(0.12)
        self.assertFalse(self.light._lamp_client.stream_silent)  # the check ended
        self.assertIsNone(getattr(self.light, "_stream_watchdog_task", None))
        probes = self.sent.count(("probe", True))
        await self.run_for(0.12)
        self.assertEqual(probes, self.sent.count(("probe", True)))

    async def test_a_cube_matrix_has_its_own_lan_check(self):
        self.light.is_cube_matrix = True
        self.stream_running("scroll", True)
        await self.run_for(0.12)
        self.assertNotIn(("probe", True), self.sent)
        self.stream_running("scroll", False)

    async def test_a_frame_that_cannot_be_drawn_does_not_end_the_stream(self):
        # A renderer's bug: logged once, the frame skipped, drawing tried
        # again; the stream (and its lease) goes on.
        draw, failures = self.light._studio_payload, [3]  # the first frame's too

        async def flaky(render):
            if failures[0]:
                failures[0] -= 1
                raise ZeroDivisionError("a renderer's bug")
            return await draw(render)

        self.light._studio_payload = flaky
        logger = self.light._studio_loop.__func__.__globals__["_LOGGER"]
        logger.reset_mock()
        await self.light._start_studio_stream()
        await self.run_for(0.4)
        self.assertEqual(0, failures[0])
        self.assertTrue(self.frames())  # drawn again once it could be
        self.assertFalse(self.light._studio_task.done())
        self.assertEqual({"studio"}, self.light._lamp_client.owners)
        self.assertEqual(2, logger.exception.call_count)  # the first frame, then once in the loop
        self.light.stop_studio_stream()

    async def test_a_stream_that_stopped_on_an_error_starts_again(self):
        # Anything else failing in the loop: it stops, then starts again
        # while the stream is still wanted.
        render_at, calls, failures = self.light._studio_render_at, [0], [1]

        def broken(due):
            calls[0] += 1
            if calls[0] == 3 and failures[0]:  # in the loop, past the first frame
                failures[0] -= 1
                raise RuntimeError("unexpected")
            return render_at(due)

        self.light._studio_render_at = broken
        await self.light._start_studio_stream()
        first = self.light._studio_task
        await self.run_for(0.3)
        self.assertEqual(0, failures[0])
        self.assertIsNotNone(self.light._studio_task)
        self.assertIsNot(first, self.light._studio_task)
        self.assertFalse(self.light._studio_task.done())
        before = len(self.frames())
        await self.run_for(0.05)
        self.assertGreater(len(self.frames()), before)  # streaming again
        self.assertEqual({"studio"}, self.light._lamp_client.owners)
        self.light.stop_studio_stream()

    async def test_a_stream_that_keeps_crashing_is_restarted_ever_more_slowly(self):
        # A bug that ends every stream at once (2026-11-14: a missing
        # constant) must not restart it in a tight loop.
        starts = []
        render_at = self.light._studio_render_at
        calls = [0]

        def broken(due):
            calls[0] += 1
            if calls[0] > 1:  # the first frame draws; the loop always fails
                starts.append(asyncio.get_running_loop().time())
                raise RuntimeError("always")
            return render_at(due)

        self.light._studio_render_at = broken
        await self.light._start_studio_stream()
        await self.run_for(0.9)
        self.light._is_on = False
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        self.assertGreaterEqual(len(gaps), 3)
        self.assertLess(gaps[0], gaps[1])  # 0.05, then 0.1, ...
        self.assertLessEqual(max(gaps), 0.2 + 0.1)  # never past the most
        await self.run_for(0.3)

    async def test_a_start_enters_direct_mode_then_streams(self):
        await self.light._start_studio_stream()
        self.assertEqual(self.sent[0], ("activate_fx_mode", None))
        self.assertEqual(self.sent[1], ("set_bright", [100]))
        # The first frame twice: the lamp left its own renderer.
        self.assertEqual([entry[0] for entry in self.sent[2:4]], ["first", "first"])
        self.assertTrue(self.light._fx_mode_is_direct)
        self.assertFalse(self.light._in_native_fw_mode)
        await self.run_for(0.1)
        self.assertGreater(len(self.frames()), 3)
        self.light.stop_studio_stream()

    async def test_a_still_frame_is_sent_at_the_stream_s_steady_rate(self):
        """A still moment is not a pause: the stream sends every render, the
        same frame or not (the owner's rule: a steady 25 a second)."""
        timing = self.light._studio_payload.__func__.__globals__
        drawn = timing["studio_frame_at"]
        timing["studio_frame_at"] = lambda *args: [(10, 20, 30)] * 100
        try:
            await self.light._start_studio_stream()
            await self.run_for(0.2)  # ~40 renders
            self.light.stop_studio_stream()
        finally:
            timing["studio_frame_at"] = drawn
        self.assertGreater(len(self.frames()), 20)  # ~40 renders, all sent
        # A changing effect too.
        self.sent.clear()
        await self.light._start_studio_stream()
        await self.run_for(0.1)
        self.light.stop_studio_stream()
        self.assertGreater(len(self.frames()), 5)

    async def test_the_stream_starts_the_effect_from_scratch(self):
        calls = []
        timing = self.light._studio_payload.__func__.__globals__
        drawn = timing["studio_frame_at"]

        def frame_at(*args):
            calls.append(args)
            return drawn(*args)

        timing["studio_frame_at"] = frame_at
        try:
            await self.light._start_studio_stream()
            self.light.stop_studio_stream()
        finally:
            timing["studio_frame_at"] = drawn
        self.assertIs(calls[0][-1], True)

    async def test_each_frame_is_the_next_render(self):
        # At the real pace (a test's 5 ms is below some systems' timer).
        timing = self.light._studio_loop.__func__.__globals__
        timing["STUDIO_FRAME_SECONDS"] = 0.04
        await self.light._start_studio_stream()
        await self.run_for(0.5)
        self.light.stop_studio_stream()
        timing["STUDIO_FRAME_SECONDS"] = 0.005
        # No render shown twice or skipped (the frames' times, not the
        # moments they are drawn, pick them).
        self.assertEqual(self.renders[0], 0)
        steps = {after - before for before, after in zip(self.renders, self.renders[1:])}
        self.assertEqual(steps, {1})

    async def test_a_stream_started_again_goes_on_from_its_render(self):
        await self.light._start_studio_stream()
        await self.run_for(0.03)
        self.light._display_frozen = True
        await self.run_for(0.02)
        last = self.light._studio_last_render
        self.light._display_frozen = False
        self.renders.clear()
        await self.light._start_studio_stream()
        self.assertEqual(self.renders[0], last + 1)
        # Another effect starts from its first render.
        self.light._native_effect = "Fire"
        await self.run_for(0.02)
        self.assertIn(0, self.renders)
        self.light.stop_studio_stream()

    def over_matter(self, fail=0):
        """A Cube Matrix whose Matter drawing takes the stream (light_matrix):
        its frames recorded as ("matter", render); ``fail`` frames refused."""
        light, failures = self.light, [fail]
        light.is_cube_matrix = True  # its own LAN check, no stream check
        light.matrix_streams_over_matter = lambda: not light._matrix_native_refused
        light._matrix_native_refused = False

        async def pixels(render):
            self.renders.append(render)
            return render

        async def send(render):
            if failures[0]:
                failures[0] -= 1
                raise RuntimeError("refused")
            self.sent.append(("matter", render))

        light._matrix_stream_pixels, light._send_matrix_stream_frame = pixels, send
        light._refuse_matrix_native = lambda: setattr(light, "_matrix_native_refused", True)

    def matter_frames(self):
        return [entry[1] for entry in self.sent if entry[0] == "matter"]

    async def test_over_matter_every_render_is_sent_and_nothing_over_the_lan(self):
        """2026-11-11 on the Cube Matrix: Retro Orange looked choppy, the
        LAN stream showing ~5 frames a second (its limit ~6) against ~30 for
        the lamp's own effects; its drawing over Matter took ~45 a second.
        Every render goes there, whatever the LAN's stride."""
        self.over_matter()
        timing = self.light._studio_loop.__func__.__globals__
        # At the real pace (a test's 5 ms is below some systems' timer).
        timing["studio_stride"], timing["STUDIO_FRAME_SECONDS"] = lambda max_fps: 5, 0.04
        try:
            await self.light._start_studio_stream()
            await self.run_for(0.5)
            self.light.stop_studio_stream()
        finally:
            timing["studio_stride"], timing["STUDIO_FRAME_SECONDS"] = lambda max_fps: 1, 0.005
        frames = self.matter_frames()
        self.assertEqual(0, frames[0])
        self.assertGreater(len(frames), 5)
        self.assertEqual({1}, {after - before for before, after in zip(frames, frames[1:])})
        self.assertEqual([], [entry for entry in self.sent if entry[0] != "matter"])
        self.assertFalse(self.light._fx_mode_is_direct)    # the drawing, not direct mode
        self.assertFalse(self.light._in_native_fw_mode)

    async def test_a_running_stream_over_matter_is_kept(self):
        self.over_matter()
        await self.light._start_studio_stream()
        task = self.light._studio_task
        await self.light._start_studio_stream()
        self.assertIs(self.light._studio_task, task)
        self.assertEqual([], [entry for entry in self.sent if entry[0] != "matter"])
        self.light.stop_studio_stream()

    async def test_a_first_frame_refused_over_matter_streams_over_the_lan(self):
        self.over_matter(fail=1)
        await self.light._start_studio_stream()
        self.assertTrue(self.light._matrix_native_refused)
        self.assertEqual(("activate_fx_mode", None), self.sent[0])
        await self.run_for(0.05)
        self.assertTrue(self.frames())
        self.assertEqual([], self.matter_frames())
        self.light.stop_studio_stream()

    async def test_a_stream_over_matter_goes_to_the_lan_when_matter_goes(self):
        self.over_matter()
        await self.light._start_studio_stream()
        await self.run_for(0.03)
        self.light._matrix_native_refused = True           # light_matrix: frames failed
        await self.run_for(0.05)
        self.light.stop_studio_stream()
        self.assertIn(("activate_fx_mode", None), self.sent)  # direct mode first
        self.assertTrue(self.frames())

    async def test_a_running_stream_is_kept(self):
        await self.light._start_studio_stream()
        task = self.light._studio_task
        before = len(self.sent)
        await self.light._start_studio_stream()
        self.assertIs(self.light._studio_task, task)
        self.assertFalse([entry for entry in self.sent[before:] if entry[0] != "update_leds"])
        self.light.stop_studio_stream()

    async def test_anything_else_shown_stops_it(self):
        for change in (
            {"_native_effect_color_mode": "normal"}, {"_mode": "Clock"}, {"_is_on": False},
            # One color: the lamp shows Rainbow in it itself.
            {"_text_colors": [[255, 0, 0]]},
            {"_external_display": True}, {"_display_frozen": True}, {"_music_flow_enabled": True},
            {"_in_native_fw_mode": True}, {"_text_colors": []},
            # A microphone effect: the lamp runs it (as Palette).
            {"_native_effect": "Music Spectrum"},
        ):
            with self.subTest(change):
                self.setUp()
                await self.light._start_studio_stream()
                task = self.light._studio_task
                for key, value in change.items():
                    setattr(self.light, key, value)
                await self.run_for(0.05)
                self.assertTrue(task.done())
                count = len(self.frames())
                await self.run_for(0.05)
                self.assertEqual(len(self.frames()), count)

    async def test_another_command_goes_first(self):
        await self.light._start_studio_stream()
        self.lock.busy = True
        await self.run_for(0.02)
        count = len(self.frames())
        await self.run_for(0.05)
        self.assertEqual(len(self.frames()), count)
        self.lock.busy = False
        await self.run_for(0.05)
        self.assertGreater(len(self.frames()), count)
        self.light.stop_studio_stream()

    async def test_over_tcp_it_holds_then_enters_direct_mode_again(self):
        await self.light._start_studio_stream()
        self.light._lamp_client.transport = "tcp"
        await self.run_for(0.02)
        count = len(self.frames())
        await self.run_for(0.05)
        self.assertEqual(len(self.frames()), count)
        self.light._lamp_client.transport = "udp"
        activations = self.sent.count(("activate_fx_mode", None))
        await self.run_for(0.05)
        self.assertEqual(self.sent.count(("activate_fx_mode", None)), activations + 1)
        self.assertGreater(len(self.frames()), count)
        self.light.stop_studio_stream()

    async def test_a_failed_frame_waits_before_the_next_try(self):
        await self.light._start_studio_stream()
        failures = []

        async def fail(command, params):
            failures.append(time.monotonic())
            raise OSError("unreachable")

        self.light._lamp_client.send_command_fast = fail
        await self.run_for(0.12)
        self.assertLessEqual(len(failures), 3)
        self.light.stop_studio_stream()

    async def test_a_palette_clock_streams_its_background_through_its_digits(self):
        light = self.light
        light._mode = CONSTANTS["MODE_CLOCK"]
        light._native_clock_style = FIRE_CLOCK
        light._native_clock_color_mode = "palette"
        light._text_colors = [list(RED), list(GREEN), list(BLUE)]
        light._native_clock_content = "time"
        self.assertTrue(light.studio_selected())
        await light._start_studio_stream()
        await self.run_for(0.05)
        light.stop_studio_stream()
        frames = [entry[1][0] for entry in self.sent if entry[0] == "update_leds"]
        self.assertTrue(frames)
        # Only the digits of 12:34 are ever lit.
        digits = {
            index for index, _char, _col in CLOCK_FACE.clock_digit_pixels(
                "12:34", True, LAMP_RENDERERS["clock_digit_flags"](
                    CONSTANTS["NATIVE_CLOCK_STYLES"][FIRE_CLOCK]["mixer"],
                    CONSTANTS["clock_style_direct"](CONSTANTS["NATIVE_CLOCK_STYLES"][FIRE_CLOCK]),
                ), False,
            )
        }
        for frame in frames:
            lit = {index for index, pixel in enumerate(frame) if max(pixel)}
            self.assertLessEqual(lit, digits)
        # The lamp takes one color itself: its own clock, no stream.
        light._text_colors = [list(RED)]
        self.assertFalse(light.studio_selected())

    async def test_the_frames_follow_the_settings_live(self):
        await self.light._start_studio_stream()
        await self.run_for(0.03)
        # Two greens: still more colors than Rainbow takes on the lamp.
        self.light._text_colors = [[0, 255, 0], [0, 128, 0]]
        await self.run_for(0.03)
        last = self.frames()[-1][1][0]
        self.assertTrue(all(pixel[0] == 0 and pixel[2] == 0 for pixel in last))
        self.light.stop_studio_stream()


class StudioFreezeTests(unittest.TestCase):
    def test_freeze_pauses_the_stream_without_a_lamp_command(self):
        # freeze_display (light_actions_display.async_freeze_display) while streaming:
        # the stream pauses on the frame the lamp holds, nothing is sent.
        light = make_light(studio_streaming=lambda: True, async_write_ha_state=Mock())
        run(light.async_freeze_display())
        self.assertTrue(light._display_frozen)
        self.assertIsNotNone(light._display_frozen_at)
        self.assertEqual([], light._lamp_client.methods())


class MatrixSegmentTests(unittest.TestCase):
    """A Cube Matrix showing fewer columns has its effects drawn on them
    (device_profile.columns), not 20 columns cut short: Falling Blocks
    landed in its hidden columns (2026-11-15, 3 blocks: 15 columns)."""

    def setUp(self):
        self.light = make_light(
            _mode=CONSTANTS["MODE_NATIVE_EFFECT"], _native_effect="Falling Blocks",
            _native_effect_speed=200, _native_effect_intensity=128, _studio_seed=3,
            device_profile=SimpleNamespace(columns=15, raw_colours=True),
        )

    def lit_columns(self, effect, renders):
        self.light._native_effect = effect
        lit = set()
        for render in range(0, renders, 3):
            frame = self.light._own_effect_frame(render)
            lit |= {index % 20 for index, colour in enumerate(frame) if any(colour)}
        return lit

    def test_effects_run_on_the_columns_shown(self):
        # Falling Blocks reaches the last column shown, never past it.
        blocks = self.lit_columns("Falling Blocks", 1500)
        self.assertIn(14, blocks)
        self.assertTrue(blocks <= set(range(15)), sorted(blocks))
        for effect in ("Meteor", "Building Blocks", "Rainbow"):
            with self.subTest(effect):
                lit = self.lit_columns(effect, 300)
                self.assertTrue(lit and lit <= set(range(15)), sorted(lit))

    def test_a_cube_lite_keeps_its_20_columns(self):
        self.light = make_light(
            _mode=CONSTANTS["MODE_NATIVE_EFFECT"], _native_effect_speed=200, _studio_seed=3,
        )
        self.assertEqual(20, self.light.device_profile.columns)
        self.assertIn(19, self.lit_columns("Rainbow", 30))


if __name__ == "__main__":
    unittest.main()
