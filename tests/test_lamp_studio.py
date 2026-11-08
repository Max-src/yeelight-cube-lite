"""The palette color mode beyond what the lamp takes: every effect in the
whole palette, on the lamp itself when it takes it (lamp_renderers.palette_fits),
else drawn by the integration (lamp_studio.py, www/lamp-studio.js) and
streamed to the lamp (light_studio.py), a clock over such an effect too; an
animation's GIF recolored; the microphone's effects left to the lamp."""

import asyncio
import json
from datetime import datetime
import runpy
import shutil
import subprocess
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from tests.test_activation_timing import _table as activation_timing
from tests.test_native_features import (
    CONSTANTS, LAMP_RENDERERS, NATIVE_PREVIEW, ROOT, _load_standalone_functions,
    import_pure_module,
)

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
    for render in range(int(seconds / step)):
        for pixel in studio_frame(effect, render * step, "Right", 128, None, None, palette):
            entry = nearest_entry(pixel, palette)
            if entry is not None:
                seen.add(entry)
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
        self.assertEqual(streamed, set(DRAWN) - MUSIC)
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
        native = (ROOT / "light_native.py").read_text(encoding="utf-8")
        self.assertIn('and stored.get("palette") == look["palette"]', native)
        self.assertIn('"palette": palette,', native)
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
        services = (ROOT / "light_services_native.py").read_text(encoding="utf-8")
        self.assertIn('vol.Optional("color_mode"): vol.In(list(NATIVE_COLOR_MODES))', services)
        self.assertIn("not effect_offers_color_mode(name, color_mode)", services)
        restore = (ROOT / "light_restore.py").read_text(encoding="utf-8")
        self.assertIn('"_native_effect_color_mode", _member_of(NATIVE_COLOR_MODES)', restore)
        for name in ("services.yaml", "light_native.py", "light_rotation.py", "light_restore.py"):
            # No "studio" mode value left (light_studio's names are the stream's).
            self.assertNotIn('"studio"', (ROOT / name).read_text(encoding="utf-8"), name)
            self.assertNotIn("value: studio", (ROOT / name).read_text(encoding="utf-8"), name)

    def test_a_streamed_clock_starts_like_a_streamed_effect(self):
        native = (ROOT / "light_native.py").read_text(encoding="utf-8")
        clock = native[native.index("async def _activate_native_clock"):native.index("def _native_clock_params")]
        self.assertIn("await self._start_studio_stream()", clock)

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
}
CLOCK_FACE = import_pure_module("clock_face")
# A clock style over Fire.
FIRE_CLOCK = next(
    style_id for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items()
    if CONSTANTS["CLOCK_MIXER_EFFECTS"].get(style["mixer"]) == "Fire"
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
                "asyncio": asyncio, "time": time, "_LOGGER": Mock(),
                "MODE_NATIVE_EFFECT": CONSTANTS["MODE_NATIVE_EFFECT"],
                "DEFAULT_NATIVE_EFFECT_INTENSITY": CONSTANTS["DEFAULT_NATIVE_EFFECT_INTENSITY"],
                "studio_frame_at": frame_at, "studio_runs": STUDIO["studio_runs"],
                "encode_rgb_frame": lambda frame: tuple(map(tuple, frame)),
                "trace_frame": Mock(), "hardware_brightness_for": lambda value: 100,
                "_get_device_lock": lambda ip: self.lock,
                "ACTIVATION_TIMING": activation_timing(),
                "STUDIO_FRAME_SECONDS": 0.005, "STUDIO_RETRY_SECONDS": 0.05,
                # The clock.
                **{name: CONSTANTS[name] for name in (
                    "MODE_CLOCK", "CLOCK_MIXER_EFFECTS", "NATIVE_CLOCK_STYLES",
                    "DEFAULT_NATIVE_CLOCK_STYLE", "clock_style_direct",
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

        light = SimpleNamespace(
            _ip="test", hass=SimpleNamespace(async_add_executor_job=executor),
            _is_on=True, _mode=CONSTANTS["MODE_NATIVE_EFFECT"], _native_effect="Rainbow",
            _native_effect_color_mode="palette", _text_colors=[[255, 0, 0], [0, 0, 255]],
            _native_effect_direction="Right", _native_effect_speed=128,
            _native_effect_intensity=128, _device_orientation="right",
            _music_flow_enabled=False, _calibration_lock=False, _external_display=False,
            _display_frozen=False, _in_native_fw_mode=True, _fx_mode_is_direct=False,
            _brightness=255, _last_hardware_brightness=None, _last_fx_mode_time=0.0,
            _studio_task=None, _studio_key=None, _studio_origin=0.0, _studio_last_render=-1,
            _cube_matrix=SimpleNamespace(transport="udp", is_connected=lambda: True,
                                         send_command_fast=send),
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

    def frames(self):
        return [entry for entry in self.sent if entry[0] == "update_leds"]

    async def run_for(self, seconds):
        await asyncio.sleep(seconds)

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
        self.light._cube_matrix.transport = "tcp"
        await self.run_for(0.02)
        count = len(self.frames())
        await self.run_for(0.05)
        self.assertEqual(len(self.frames()), count)
        self.light._cube_matrix.transport = "udp"
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

        self.light._cube_matrix.send_command_fast = fail
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
        source = (ROOT / "light_services_display.py").read_text(encoding="utf-8")
        freeze = source[source.index("async def _freeze_one"):source.index("async def _do_send")]
        self.assertIn('getattr(target, "studio_streaming", None)', freeze)
        self.assertIn("return", freeze)


if __name__ == "__main__":
    unittest.main()
