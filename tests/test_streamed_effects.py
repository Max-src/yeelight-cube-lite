"""The integration's own effects (effect_catalog.STREAMED_EFFECTS): what they draw,
the same in Python and JS, and that no lamp is ever sent their slot."""

import json
import runpy
import shutil
import unittest

from tests.test_native_features import (
    CONSTANTS,
    LAMP_RENDERERS,
    ROOT,
    import_pure_module,
)
from unittest.mock import patch

from fakes import FakeHass, NodeRun, instant_sleeps, make_light, module, run, slow

STREAMED = runpy.run_path(str(ROOT / "lamp_effects_streamed.py"))
STUDIO = runpy.run_path(str(ROOT / "lamp_studio.py"))
lamp_settings = LAMP_RENDERERS["lamp_settings"]
lamp_clock_settings = LAMP_RENDERERS["lamp_clock_settings"]
frame_bytes = LAMP_RENDERERS["lamp_frame_bytes"]
KNIGHT = "Knight Rider"
LAVA = "Lava Lamp"
BLOCKS = "Falling Blocks"
RED, GREEN, BLUE = [255, 0, 0], [0, 255, 0], [0, 0, 255]
# (direction, speed, colour, color mode, mount, intensity, palette)
CONFIGS = {
    "default": ("Right", 128, None, "normal", None, 128, None),
    "left-fast": ("Left", 255, None, "normal", None, 0, None),
    "up-slow": ("Up", 0, None, "normal", None, 255, None),
    "down-mounted": ("Down", 90, None, "normal", "up", 128, None),
    "coloured": ("Right", 128, [255, 80, 20], "normal", None, 128, None),
    "palette": ("Right", 200, None, "palette", None, 128, [RED, GREEN, BLUE]),
    "one-colour": ("Left", 128, None, "palette", None, 64, [[0, 200, 255]]),
    "longest-trail": ("Right", 30, None, "normal", None, 255, None),
    **{mode: ("Right", 128, None, mode, None, 200, None)
       for mode in ("bw", "red_blue", "white_orange", "blue_yellow", "purple_orange")},
}
RENDERS = range(0, 400, 7)


def frame_rows(frame: bytes):
    """Lamp order (row 0 the bottom): each column's brightest channel, by
    column, the 20 along the long side."""
    return [max(frame[3 * (row * 20 + column):3 * (row * 20 + column) + 3]) for row in range(5)
            for column in range(20)]


def lit_columns(frame: bytes) -> list[int]:
    """Each column's brightness (the brightest channel of its first row)."""
    return [max(frame[3 * column:3 * column + 3]) for column in range(20)]


def python_frames():
    out = {}
    for key, (direction, speed, colour, mode, mount, intensity, palette) in CONFIGS.items():
        settings = lamp_settings(KNIGHT, direction, speed, colour, mode, mount, intensity, palette)
        out[key] = [frame_bytes(settings, render).hex() for render in RENDERS]
    return out


def knight_js():
    """The JS of the Knight Rider frames (js_results()["knight"])."""
    return (
        f"{{ const configs = {json.dumps(CONFIGS)}; const renders = {json.dumps(list(RENDERS))};"
        "const out = {};"
        "for (const [key, [direction, speed, colour, mode, mount, intensity, palette]] of Object.entries(configs)) {"
        f"  const settings = lampSettings({json.dumps(KNIGHT)}, direction, speed, colour, mode, mount, intensity, palette);"
        "  out[key] = renders.map((render) => hex(lampFrameBytes(settings, render)));"
        "}"
        "results.knight = out; }"
    )


class KnightRiderTests(unittest.TestCase):
    def settings(self, direction="Right", speed=128, intensity=128, colour=None, mode="normal", palette=None):
        return lamp_settings(KNIGHT, direction, speed, colour, mode, None, intensity, palette)

    def head(self, settings, render) -> int:
        """The brightest column."""
        columns = lit_columns(frame_bytes(settings, render))
        return columns.index(max(columns))

    def test_it_is_streamed_and_listed_last(self):
        spec = CONSTANTS["ALL_NATIVE_EFFECTS"][KNIGHT]
        self.assertTrue(spec["streamed"])
        self.assertTrue(CONSTANTS["streamed_slot"](spec["mode"]))
        self.assertEqual([KNIGHT, LAVA, BLOCKS], list(CONSTANTS["ALL_NATIVE_EFFECTS"])[-3:])
        self.assertIn(KNIGHT, CONSTANTS["LITE_STREAMED_EFFECTS"])
        self.assertIn(KNIGHT, LAMP_RENDERERS["LAMP_RENDERED_EFFECTS"])
        self.assertEqual("motion", CONSTANTS["effect_family"](spec))
        style = next(s for s in CONSTANTS["NATIVE_CLOCK_STYLES"].values() if s["name"] == KNIGHT)
        self.assertEqual(KNIGHT, CONSTANTS["clock_style_effect"](style))

    def test_the_head_runs_along_and_back(self):
        settings = self.settings()
        sweep = STREAMED["knight_sweep_ms"](settings["rate"]) // 40  # renders
        heads = [self.head(settings, render) for render in range(0, 2 * sweep, 2)]
        turn = heads.index(max(heads))
        self.assertEqual(0, heads[0])
        self.assertEqual(19, max(heads))
        self.assertEqual(heads[:turn + 1], sorted(heads[:turn + 1]))  # out
        self.assertEqual(heads[turn:], sorted(heads[turn:], reverse=True))  # and back
        # Left starts from the other end.
        self.assertEqual(19, self.head(self.settings("Left"), 0))

    def test_the_speed_sets_a_sweep_s_time(self):
        sweep = STREAMED["knight_sweep_ms"]
        self.assertEqual((2600, 400), (sweep(0), sweep(255)))
        slow, fast = self.settings(speed=0), self.settings(speed=255)
        self.assertGreater(self.head(fast, 5), self.head(slow, 5))

    def test_the_intensity_sets_the_trail_s_length(self):
        def trail(intensity):
            settings = self.settings(intensity=intensity)
            return sum(1 for level in lit_columns(frame_bytes(settings, 30)) if level)

        self.assertLess(trail(0), trail(128))
        self.assertLess(trail(128), trail(255))
        # At the most it outlasts a sweep: the whole line still glows.
        trail_ms = STREAMED["knight_trail_ms"]
        self.assertEqual(1.5, trail_ms(2000, 255) / 2000)
        self.assertEqual(0.125, trail_ms(2000, 0) / 2000)
        self.assertGreaterEqual(trail(255), 15)
        ramp = [trail_ms(2000, intensity) for intensity in range(256)]
        self.assertEqual(ramp, sorted(ramp))

    def test_the_trail_fades_behind_the_head(self):
        columns = lit_columns(frame_bytes(self.settings(), 30))
        head = columns.index(max(columns))
        behind = columns[:head + 1]
        self.assertEqual(behind, sorted(behind))
        self.assertEqual(0, columns[min(19, head + 3)])

    def test_a_whole_column_lights(self):
        frame = frame_bytes(self.settings(), 30)
        levels = frame_rows(frame)
        for column in range(20):
            self.assertEqual(1, len({levels[row * 20 + column] for row in range(5)}))

    def test_red_or_the_colour_chosen(self):
        red = frame_bytes(self.settings(), 0)
        self.assertGreater(red[0], 0)
        self.assertEqual((0, 0), (red[1], red[2]))
        orange = frame_bytes(self.settings(colour=[255, 80, 20]), 0)
        self.assertNotEqual(red[:3], orange[:3])
        self.assertGreater(orange[1], 0)

    def test_in_a_palette_each_sweep_takes_the_next_colour(self):
        palette = [RED, GREEN, BLUE]
        settings = self.settings(mode="palette", palette=palette)
        self.assertEqual([RED, GREEN, BLUE], settings["colours"])
        sweep = STREAMED["knight_sweep_ms"](settings["rate"]) // 40
        for index in range(3):
            frame = frame_bytes(settings, index * sweep + sweep // 2)
            columns = lit_columns(frame)
            at = 3 * columns.index(max(columns))
            pixel = frame[at:at + 3]
            self.assertEqual(index, pixel.index(max(pixel)), index)

    def test_every_color_mode_is_offered(self):
        offers = runpy.run_path(str(ROOT / "native_effect_preview.py"))["effect_offers_color_mode"]
        for mode in CONSTANTS["NATIVE_COLOR_MODES"]:
            self.assertTrue(offers(KNIGHT, mode) or mode == "normal", mode)

    def test_a_preset_gives_colours_along_its_gradient(self):
        def sweep_colours(mode):
            settings = self.settings(mode=mode)
            sweep = STREAMED["knight_sweep_ms"](settings["rate"]) // 40
            out = []
            for index in range(4):
                frame = frame_bytes(settings, index * sweep + sweep // 2)
                columns = lit_columns(frame)
                at = 3 * columns.index(max(columns))
                out.append(tuple(frame[at:at + 3]))
            return out

        # White (LED drive: the lamp's converter's white), at the head's brightness.
        white = runpy.run_path(str(ROOT / "lamp_core.py"))["convert_colour"]((255, 255, 255))
        for pixel in sweep_colours("bw"):
            for channel in range(3):
                self.assertAlmostEqual(pixel[channel] / pixel[0], white[channel] / white[0], delta=0.03)
        for mode in ("red_blue", "white_orange", "blue_yellow", "purple_orange"):
            with self.subTest(mode=mode):
                colours = sweep_colours(mode)
                self.assertEqual(4, len(set(colours)), colours)
        # Vivid runs from red to blue.
        vivid = STREAMED["preset_colours"](12, 100)
        self.assertEqual(4, len(vivid))
        self.assertEqual(0, vivid[0][1] + vivid[0][2])  # red, as the lamp drives it
        self.assertGreater(vivid[-1][2], 200)
        # Violet & Gold is short: all five.
        self.assertEqual(5, len(STREAMED["preset_colours"](32, 100)))

    def test_the_lamp_takes_the_whole_palette_itself(self):
        palette = [RED, GREEN, BLUE, [255, 255, 0]]
        self.assertTrue(LAMP_RENDERERS["palette_fits"](KNIGHT, palette))
        self.assertFalse(STUDIO["studio_runs"](KNIGHT, "palette", palette))
        self.assertEqual(4, len(LAMP_RENDERERS["palette_words"](KNIGHT, palette)))
        limit = CONSTANTS["STREAMED_EFFECT_PALETTE_LIMIT"]
        self.assertEqual(limit, len(LAMP_RENDERERS["palette_words"](KNIGHT, [RED] * 40)))

    def test_a_clock_over_it_takes_the_clock_s_colour_or_palette(self):
        coloured = lamp_clock_settings(KNIGHT, 128, [0, 200, 255], "normal", 128, None, True)
        self.assertEqual([0, 200, 255], coloured["primary"])
        palette = lamp_clock_settings(KNIGHT, 128, None, "palette", 128, [RED, GREEN], True)
        self.assertEqual([RED, GREEN], palette["colours"])
        plain = lamp_clock_settings(KNIGHT, 128, None, "normal", 128, None, True)
        self.assertEqual(RED, plain["primary"])

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    @slow
    def test_js_draws_the_same(self):
        self.assertEqual(python_frames(), js_results()["knight"])


LAVA_CONFIGS = {
    # (direction, speed, colour, color mode, mount, intensity, palette, seed)
    "default": ("Up", 128, None, "normal", None, 128, None, 0),
    "right-fast": ("Right", 255, None, "normal", None, 255, None, 7),
    "left-slow-little": ("Left", 0, None, "normal", None, 0, None, 123456),
    "down-mounted": ("Down", 90, None, "normal", "up", 128, None, 99),
    "coloured": ("Right", 128, [20, 200, 255], "normal", None, 128, None, 5),
    "palette": ("Right", 200, None, "palette", None, 128, [RED, GREEN, BLUE], 2 ** 32 - 1),
    **{mode: ("Up", 128, None, mode, None, 200, None, 3)
       for mode in ("bw", "red_blue", "purple_orange")},
}
LAVA_RENDERS = 1500
LAVA_PICKED = range(0, LAVA_RENDERS, 37)


def lava_settings(direction="Right", speed=128, colour=None, mode="normal", mount=None, intensity=128,
                  palette=None, seed=0):
    settings = lamp_settings(LAVA, direction, speed, colour, mode, mount, intensity, palette)
    return {**settings, "seed": seed}


def lava_run(settings, count=LAVA_RENDERS) -> list[bytes]:
    return list(LAMP_RENDERERS["exact_frames"](settings, 0, count))


def lava_python_frames():
    out = {}
    for key, config in LAVA_CONFIGS.items():
        frames = lava_run(lava_settings(*config))
        out[key] = [frames[render].hex() for render in LAVA_PICKED]
    return out


def lava_js():
    """The JS of the Lava Lamp frames (js_results()["lava"])."""
    return (
        f"{{ const configs = {json.dumps(LAVA_CONFIGS)}; const picked = {json.dumps(list(LAVA_PICKED))};"
        "const out = {};"
        "for (const [key, [direction, speed, colour, mode, mount, intensity, palette, seed]] of Object.entries(configs)) {"
        f"  const settings = {{...lampSettings({json.dumps(LAVA)}, direction, speed, colour, mode, mount, intensity, palette), seed}};"
        f"  const frames = [...exactFrames(settings, 0, {LAVA_RENDERS})];"
        "  out[key] = picked.map((render) => hex(frames[render]));"
        "}"
        "results.lava = out; }"
    )


def wax_rows(frame: bytes) -> list[int]:
    """Lamp order, the 5 rows (row 0 the bottom): how much wax each holds
    (cells brighter than the liquid's glow)."""
    return [sum(1 for column in range(20) if max(frame[3 * (row * 20 + column):3 * (row * 20 + column) + 3]) > 60)
            for row in range(5)]


def wax_columns(frame: bytes) -> list[int]:
    """The 20 columns' wax (cells brighter than the liquid's glow)."""
    return [sum(1 for row in range(5) if max(frame[3 * (row * 20 + column):3 * (row * 20 + column) + 3]) > 60)
            for column in range(20)]


class LavaLampTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.default = lava_run(lava_settings())

    def test_it_is_streamed_and_simulated(self):
        spec = CONSTANTS["ALL_NATIVE_EFFECTS"][LAVA]
        self.assertTrue(spec["streamed"])
        self.assertTrue(CONSTANTS["streamed_slot"](spec["mode"]))
        self.assertIn(LAVA, CONSTANTS["LITE_STREAMED_EFFECTS"])
        self.assertIn(LAVA, LAMP_RENDERERS["LAMP_RENDERED_EFFECTS"])
        self.assertEqual("glow", CONSTANTS["effect_family"](spec))
        self.assertIn(spec["mode"], CONSTANTS["LAMP_INTENSITY_SLOTS"])
        style = next(s for s in CONSTANTS["NATIVE_CLOCK_STYLES"].values() if s["name"] == LAVA)
        self.assertEqual(LAVA, CONSTANTS["clock_style_effect"](style))
        # Its frames depend on the whole run: no warmup.
        slot = next(slot for slot in STREAMED["SLOTS"] if slot["mode"] == spec["mode"])
        self.assertIsNone(slot["warmup"])

    def test_it_never_loops(self):
        # A minute of frames: no run of them comes back (a loop would bring a
        # whole sequence back; a still moment may match another, frame for
        # frame), and it keeps moving.
        seen = {}
        for render in range(len(self.default) - 10):
            run = tuple(self.default[render:render + 10])
            if len(set(run)) == 1:
                continue  # still
            self.assertNotIn(run, seen, f"renders from {render} repeat those from {seen.get(run)}")
            seen[run] = render
        still = sum(1 for before, after in zip(self.default, self.default[1:]) if before == after)
        self.assertLess(still, len(self.default) // 20)

    def test_each_seed_is_its_own_run(self):
        runs = [lava_run(lava_settings(seed=seed), 200) for seed in (0, 1, 2)]
        for render in (0, 199):
            self.assertEqual(3, len({run[render] for run in runs}), render)
        # The same seed, the same run (the preview and the lamp agree).
        self.assertEqual(runs[1], lava_run(lava_settings(seed=1), 200))

    def test_wax_rises_from_the_pool_and_sinks_back(self):
        # Right: the long line, the pool at its start (column 0).
        frames = lava_run(lava_settings("Right", seed=11), 3000)
        pool = [wax_columns(frame)[0] for frame in frames]
        self.assertGreaterEqual(min(pool), 3)  # the pool is always there
        # Wax reaches the far end at times, and is gone from it at others.
        far = [sum(wax_columns(frame)[15:]) for frame in frames]
        self.assertGreater(max(far), 3)
        self.assertIn(0, far)
        # Up: the wax rises to the top row and leaves it again.
        top = [wax_rows(frame)[4] for frame in lava_run(lava_settings("Up", seed=11), 3000)]
        self.assertGreater(max(top), 0)
        self.assertIn(0, top)

    def test_the_direction_is_the_way_it_rises(self):
        def heaviest_column(direction):
            totals = [0] * 20
            for frame in lava_run(lava_settings(direction, seed=4), 600):
                for column, wax in enumerate(wax_columns(frame)):
                    totals[column] += wax
            return totals.index(max(totals))  # the pool's end

        self.assertEqual(0, heaviest_column("Right"))
        self.assertEqual(19, heaviest_column("Left"))

    def test_the_intensity_sets_how_much_wax(self):
        def wax(intensity):
            frames = lava_run(lava_settings(intensity=intensity, seed=8), 800)
            return sum(sum(wax_rows(frame)) for frame in frames)

        self.assertLess(wax(0), wax(128))
        self.assertLess(wax(128), wax(255))
        count = STREAMED["lava_blob_count"]
        self.assertEqual((2, 4, 7), (count(0), count(128), count(255)))

    def test_the_speed_sets_its_pace(self):
        def moved(speed):
            frames = lava_run(lava_settings("Right", speed=speed, seed=6), 400)
            return sum(1 for before, after in zip(frames, frames[1:])
                       if wax_columns(before) != wax_columns(after))

        self.assertLess(moved(0), moved(255))
        tempo = STREAMED["lava_tempo"]
        self.assertEqual((128, 576), (tempo(0), tempo(255)))

    def test_orange_wax_in_a_dim_liquid_or_the_colour_chosen(self):
        frame = self.default[300]
        brightest = max(range(100), key=lambda pixel: max(frame[3 * pixel:3 * pixel + 3]))
        red, green, blue = frame[3 * brightest:3 * brightest + 3]
        self.assertGreater(red, green)
        self.assertGreater(green, blue)
        # The liquid glows dimly, never dark, never as bright as the wax.
        darkest = min(max(frame[3 * pixel:3 * pixel + 3]) for pixel in range(100))
        self.assertTrue(0 < darkest < 60, darkest)
        coloured = lava_run(lava_settings(colour=[0, 0, 255], seed=3), 60)[-1]
        self.assertTrue(all(coloured[at] == coloured[at + 1] == 0 for at in range(0, 300, 3)))

    def test_with_several_colours_the_liquid_glows_in_the_last(self):
        frames = lava_run(lava_settings(mode="palette", palette=[RED, GREEN, BLUE], seed=9), 900)
        wax, liquid = set(), set()
        for frame in frames[::10]:
            for pixel in range(100):
                red, green, blue = frame[3 * pixel:3 * pixel + 3]
                if max(red, green, blue) > 200:
                    wax.add((red > green, green > red))
                elif 0 < max(red, green, blue) < 40 and red == green == 0:
                    liquid.add("blue")
        self.assertEqual({(True, False), (False, True)}, wax & {(True, False), (False, True)})
        self.assertEqual({"blue"}, liquid)
        self.assertTrue(LAMP_RENDERERS["palette_fits"](LAVA, [RED, GREEN, BLUE]))

    def test_every_color_mode_is_offered(self):
        offers = runpy.run_path(str(ROOT / "native_effect_preview.py"))["effect_offers_color_mode"]
        for mode in CONSTANTS["NATIVE_COLOR_MODES"]:
            self.assertTrue(offers(LAVA, mode) or mode == "normal", mode)

    def test_a_render_is_quick(self):
        import time

        settings = lava_settings("Up", intensity=255, seed=1)
        began = time.perf_counter()
        lava_run(settings, 500)
        self.assertLess((time.perf_counter() - began) / 500, 0.004)  # lamp_effects_core's budget

    def test_a_new_stream_starts_a_new_run(self):
        # A new seed whenever the stream's render 0 starts again (another
        # effect, direction or mount), the same while it goes on.
        studio = module("light_studio")
        light = make_light(hass=FakeHass(), _mode="Native Effect", _native_effect=LAVA)
        seeds = iter([11, 22, 33])
        with patch.object(studio.random, "getrandbits", lambda bits: next(seeds)):
            self.assertEqual(0, light._studio_render_at(0.0))
            self.assertEqual(11, light._studio_seed)
            self.assertGreater(light._studio_render_at(1.0), 0)
            self.assertEqual(11, light._studio_seed)
            light._native_effect_direction = "Left"
            self.assertEqual(0, light._studio_render_at(2.0))
            self.assertEqual(22, light._studio_seed)
        # This run's seed is what the effect is drawn with, alone or behind
        # a streamed clock.
        drawn, real = [], studio.renderer_frame
        with patch.object(studio, "renderer_frame",
                          lambda settings, render: drawn.append(settings["seed"]) or real(settings, render)):
            light._own_effect_frame_drawn(5)
        self.assertEqual([22], drawn)
        clocks = []
        light._mode = CONSTANTS["MODE_CLOCK"]
        with patch.object(studio, "studio_clock_frame", lambda *args: clocks.append(args[-1]) or [(0, 0, 0)] * 100):
            run(light._studio_payload(3))
        self.assertEqual([22], clocks)
        # The seed keys the run: each its own timeline.
        key = LAMP_RENDERERS["timeline_for"]
        first, second = lava_settings(seed=1), lava_settings(seed=2)
        self.assertIsNot(key(first), key(second))
        self.assertIs(key(first), key(dict(first)))

    def test_a_late_start_starts_a_new_run_instead_of_fast_forwarding(self):
        # A new intensity (a new run) mid-stream, or a preview opened late:
        # replaying the history showed it racing ahead before slowing down.
        settings = lava_settings(intensity=77, seed=21)
        timeline = LAMP_RENDERERS["timeline_for"](settings)
        steps = []
        slot = dict(timeline.slot)
        step = slot["step"]
        slot["step"] = lambda *args: steps.append(1) or step(*args)
        timeline.slot = slot
        timeline.frame_at(5000)
        self.assertEqual(1, len(steps))  # started there: one render, no replay
        for render in (5001, 5002, 5010):  # then goes on, through a late frame's gap
            timeline.frame_at(render)
        self.assertEqual(11, len(steps))
        self.assertTrue(STREAMED["SLOTS"][1]["live"])
        self.assertIsNone(STREAMED["SLOTS"][1]["warmup"])

    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards")
    def test_the_cards_start_each_run_the_same_way(self):
        # Each slot's warmup and late start (live) in the cards' renderers.
        self.assertEqual(
            [{"mode": slot["mode"], "warmup": slot["warmup"], "live": slot.get("live", False)}
             for slot in STREAMED["SLOTS"]],
            js_results()["slots"],
        )

    def test_the_pool_does_not_flicker(self):
        # Up / Down (the 5 rows): the pool's row blinked as its surface jittered.
        for direction, cells in (("Up", range(20)), ("Right", range(0, 100, 20))):
            frames = lava_run(lava_settings(direction, speed=0, intensity=15, seed=3), 1000)
            jumps = [abs(max(a[3 * p:3 * p + 3]) - max(b[3 * p:3 * p + 3]))
                     for a, b in zip(frames, frames[1:]) for p in cells]
            self.assertLess(sum(1 for jump in jumps if jump > 40), len(jumps) // 1000, direction)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    @slow
    def test_js_draws_the_same(self):
        self.assertEqual(lava_python_frames(), js_results()["lava"])


BLOCKS_CONFIGS = {
    # (direction, speed, colour, color mode, mount, intensity, palette, seed)
    "right": ("Right", 128, None, "normal", None, 128, None, 0),
    "down-fast": ("Down", 255, None, "normal", None, 255, None, 7),
    "left-clumsy": ("Left", 60, None, "normal", None, 0, None, 123456),
    "up-mounted": ("Up", 200, None, "normal", "up", 200, None, 99),
    "custom": ("Right", 128, [20, 200, 255], "normal", None, 128, None, 5),
    "palette": ("Right", 200, None, "palette", None, 128, [RED, GREEN, BLUE], 2 ** 32 - 1),
    **{mode: ("Down", 128, None, mode, None, 128, None, 3) for mode in ("bw", "red_blue")},
}
BLOCKS_RENDERS = 2000
BLOCKS_PICKED = range(0, BLOCKS_RENDERS, 23)


def blocks_settings(direction="Right", speed=128, colour=None, mode="normal", mount=None, intensity=128,
                    palette=None, seed=0):
    return {**lamp_settings(BLOCKS, direction, speed, colour, mode, mount, intensity, palette), "seed": seed}


def blocks_game(settings, renders):
    """The game's own state render by render: (lines cleared, games over)."""
    state = STREAMED["blocks_init"](settings)
    lines = games = 0
    phase = "play"
    for render in range(renders):
        STREAMED["blocks_step"](state, settings, 0, render)
        if state["phase"] != phase:
            lines += len(state["clearing"]) if state["phase"] == "clear" else 0
            games += state["phase"] == "over"
            phase = state["phase"]
    return lines, games, state


class FallingBlocksTests(unittest.TestCase):
    def test_it_is_streamed_and_played_live(self):
        spec = CONSTANTS["ALL_NATIVE_EFFECTS"][BLOCKS]
        self.assertTrue(spec["streamed"])
        self.assertTrue(CONSTANTS["streamed_slot"](spec["mode"]))
        self.assertNotIn("color", spec)  # its own colours by shape
        self.assertIn(BLOCKS, CONSTANTS["LITE_STREAMED_EFFECTS"])
        self.assertIn(BLOCKS, LAMP_RENDERERS["LAMP_RENDERED_EFFECTS"])
        self.assertEqual("motion", CONSTANTS["effect_family"](spec))
        self.assertIn(spec["mode"], CONSTANTS["LAMP_INTENSITY_SLOTS"])
        style = next(s for s in CONSTANTS["NATIVE_CLOCK_STYLES"].values() if s["name"] == BLOCKS)
        self.assertEqual(BLOCKS, CONSTANTS["clock_style_effect"](style))
        slot = next(slot for slot in STREAMED["SLOTS"] if slot["mode"] == spec["mode"])
        self.assertIsNone(slot["warmup"])
        self.assertTrue(slot["live"])

    def test_the_seven_shapes_and_their_turns(self):
        rotations = STREAMED["_BLOCK_ROTATIONS"]
        self.assertEqual([2, 1, 4, 2, 2, 4, 4], [len(turns) for turns in rotations])
        for turns in rotations:
            for cells in turns:
                self.assertEqual(4, len(set(cells)))
                self.assertEqual(0, min(x for x, _y in cells))
                self.assertEqual(0, min(y for _x, y in cells))

    def test_it_plays_clears_lines_and_starts_again(self):
        # Ten minutes on the long side (a well 5 wide, 20 deep) and on the
        # short one (20 wide, 5 deep): lines are cleared, games end and start
        # again (on the short side a line takes five pieces, each falling at
        # the same pace to the bottom: about 20 lines in ten minutes).
        for direction, least in (("Right", 50), ("Down", 15)):
            lines, games, _state = blocks_game(blocks_settings(direction, intensity=128, seed=9), 25 * 600)
            with self.subTest(direction):
                self.assertGreater(lines, least)
                self.assertGreater(games, 0)

    def test_turns_and_moves_are_spread_over_the_fall(self):
        # The owner (2026-11-14): pieces were turned and placed straight
        # away; the player now takes its time, so the moves are seen: on the
        # long well a piece reaches its place about halfway down.
        settings = blocks_settings(intensity=128, seed=9)
        state = STREAMED["blocks_init"](settings)
        shares, current, reached, top = [], None, None, 0
        for render in range(25 * 300):
            STREAMED["blocks_step"](state, settings, 0, render)
            piece = state["piece"]
            if piece is not None and piece is not current:
                current, reached, top = piece, None, piece["y"]
            if piece is None or reached is not None:
                continue
            if piece["rotation"] == piece["goal_rotation"] and piece["x"] == piece["goal_x"]:
                reached = piece["y"]
                cells = STREAMED["_BLOCK_ROTATIONS"][piece["shape"]][piece["rotation"]]
                landing = reached
                while STREAMED["_blocks_fits"](state, cells, piece["x"], landing - 1):
                    landing -= 1
                if top > landing:
                    shares.append((top - reached) / (top - landing))
        shares.sort()
        self.assertGreater(len(shares), 50)
        self.assertGreater(shares[len(shares) // 2], 0.35)
        self.assertLess(shares[len(shares) // 2], 0.75)  # and keeps falling after

    def test_a_piece_falls_at_the_same_pace_all_the_way_down(self):
        # The owner (2026-11-14): no sudden drop once a piece is in place.
        for intensity in (0, 128, 255):
            for speed in (0, 128, 255):
                settings = blocks_settings(intensity=intensity, seed=5, speed=speed)
                state = STREAMED["blocks_init"](settings)
                gaps, current, last = set(), None, None
                for render in range(25 * 120):
                    STREAMED["blocks_step"](state, settings, 0, render)
                    piece = state["piece"]
                    if piece is None or state["phase"] != "play":
                        current = None
                        continue
                    if piece is not current:
                        current, last = piece, (piece["y"], render)
                    elif piece["y"] != last[0]:
                        gaps.add(render - last[1])
                        last = (piece["y"], render)
                with self.subTest(intensity=intensity, speed=speed):
                    self.assertEqual(1, len(gaps), gaps)
                    self.assertEqual({state["fall"]}, gaps)

    def test_the_intensity_sets_how_well_it_plays(self):
        clumsy = blocks_game(blocks_settings(intensity=0, seed=9), 25 * 600)
        sharp = blocks_game(blocks_settings(intensity=255, seed=9), 25 * 600)
        self.assertGreater(sharp[0], clumsy[0])  # more lines
        self.assertLess(sharp[1], clumsy[1])  # fewer games lost
        self.assertEqual((2, 17), (STREAMED["blocks_fall_renders"](255), STREAMED["blocks_fall_renders"](0)))

    def test_pieces_are_turned_and_moved_as_they_fall(self):
        settings = blocks_settings(seed=4)
        state = STREAMED["blocks_init"](settings)
        turned = moved = 0
        last = None
        for render in range(25 * 120):
            STREAMED["blocks_step"](state, settings, 0, render)
            piece = state["piece"]
            if piece is not None and last is not None and piece["shape"] == last[0] and piece["y"] <= last[3]:
                turned += piece["rotation"] != last[1]
                moved += piece["x"] != last[2]
            last = None if piece is None else (piece["shape"], piece["rotation"], piece["x"], piece["y"])
        self.assertGreater(turned, 10)
        self.assertGreater(moved, 10)

    def test_a_full_line_flashes_then_goes(self):
        settings = blocks_settings(seed=11)
        state = STREAMED["blocks_init"](settings)
        width, height = state["width"], state["height"]
        # A line all but one cell full, and a piece above the gap.
        state["grid"][0] = [0] * (width - 1) + [-1]
        state["grid"][1] = [3] + [-1] * (width - 1)
        state["bag"] = [0]  # the straight piece next, upright fits the gap
        state["piece"] = {"shape": 0, "rotation": 1, "x": width - 1, "y": 0,
                          "goal_rotation": 1, "goal_x": width - 1}
        state["last_fall"] = -100
        STREAMED["blocks_step"](state, settings, 0, 0)
        self.assertEqual("clear", state["phase"])
        self.assertEqual([0], state["clearing"])
        white = bytes(state["white"])
        flashed = STREAMED["blocks_step"](state, settings, 0, 1)
        self.assertIn(white, {flashed[at:at + 3] for at in range(0, 300, 3)})
        for render in range(2, 12):
            STREAMED["blocks_step"](state, settings, 0, render)
        self.assertEqual("play", state["phase"])
        # The line went; what was above it came down.
        self.assertEqual(3, state["grid"][0][0])
        self.assertEqual(height, len(state["grid"]))

    def test_a_lost_game_is_wiped_away_in_black_from_the_top(self):
        # The owner (2026-11-14): the grey fill looked out of place; the
        # stack is erased row by row from the far end instead, only black and
        # the blocks' own colours, about the same time on either well.
        for direction in ("Right", "Down"):
            settings = blocks_settings(direction, speed=255, intensity=0, seed=9)
            state = STREAMED["blocks_init"](settings)
            for render in range(25 * 300):
                STREAMED["blocks_step"](state, settings, 0, render)
                if state["phase"] == "over":
                    break
            with self.subTest(direction):
                self.assertEqual("over", state["phase"])
                self.assertEqual(40, state["height"] * state["wipe"])
                colours = {tuple(colour) for colour in state["colours"]} | {(0, 0, 0)}
                rows_left = []
                while state["phase"] == "over":
                    STREAMED["blocks_step"](state, settings, 0, 0)
                    strip = state["strip"]
                    pixels = {tuple(strip[at:at + 3]) for at in range(0, len(strip), 3)}
                    self.assertLessEqual(pixels, colours)  # nothing grey
                    width = state["width"]
                    lit = [row for row in range(state["height"])
                           if any(strip[3 * (row * width):3 * (row + 1) * width])]
                    rows_left.append(max(lit) if lit else -1)
                self.assertEqual(rows_left, sorted(rows_left, reverse=True))  # from the top down
                self.assertEqual(-1, rows_left[-1])

    def test_its_own_colours_or_the_colour_chosen_in_shades(self):
        own = STREAMED["blocks_init"](blocks_settings())["colours"]
        self.assertEqual(7, len(set(own)))
        chosen = STREAMED["blocks_init"](blocks_settings(colour=[0, 0, 255]))["colours"]
        self.assertEqual(7, len(chosen))
        self.assertTrue(all(red == green == 0 and blue > 0 for red, green, blue in chosen))
        # B&W: shades of the lamp's white (LED drive: warm, as it drives white).
        greys = STREAMED["blocks_init"](blocks_settings(mode="bw"))["colours"]
        white = runpy.run_path(str(ROOT / "lamp_core.py"))["convert_colour"]((255, 255, 255))
        self.assertEqual(7, len(set(greys)))
        for grey in greys:
            for channel in range(3):
                self.assertAlmostEqual(grey[channel] / grey[0], white[channel] / white[0], delta=0.03)
        palette = STREAMED["blocks_init"](blocks_settings(mode="palette", palette=[RED, GREEN, BLUE]))["colours"]
        self.assertEqual(3, len(palette))
        self.assertTrue(LAMP_RENDERERS["palette_fits"](BLOCKS, [RED, GREEN, BLUE]))

    def test_each_seed_is_its_own_game(self):
        runs = [lava_run(blocks_settings(seed=seed), 400) for seed in (0, 1, 2)]
        self.assertEqual(3, len({run[399] for run in runs}))
        self.assertEqual(runs[1], lava_run(blocks_settings(seed=1), 400))

    def test_every_color_mode_is_offered(self):
        offers = runpy.run_path(str(ROOT / "native_effect_preview.py"))["effect_offers_color_mode"]
        for mode in CONSTANTS["NATIVE_COLOR_MODES"]:
            self.assertTrue(offers(BLOCKS, mode) or mode == "normal", mode)

    def test_a_render_is_quick(self):
        import time

        settings = blocks_settings("Down", intensity=255, seed=1)
        began = time.perf_counter()
        lava_run(settings, 1500)
        self.assertLess((time.perf_counter() - began) / 1500, 0.004)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    @slow
    def test_js_draws_the_same(self):
        js = js_results()["blocks"]
        for key, config in BLOCKS_CONFIGS.items():
            frames = lava_run(blocks_settings(*config), BLOCKS_RENDERS)
            self.assertEqual([frames[render].hex() for render in BLOCKS_PICKED], js[key], key)


def blocks_js():
    """The JS of the Falling Blocks frames (js_results()["blocks"])."""
    return (
        f"{{ const configs = {json.dumps(BLOCKS_CONFIGS)}; const picked = {json.dumps(list(BLOCKS_PICKED))};"
        "const out = {};"
        "for (const [key, [direction, speed, colour, mode, mount, intensity, palette, seed]] of Object.entries(configs)) {"
        f"  const settings = {{...lampSettings({json.dumps(BLOCKS)}, direction, speed, colour, mode, mount, intensity, palette), seed}};"
        f"  const frames = [...exactFrames(settings, 0, {BLOCKS_RENDERS})];"
        "  out[key] = picked.map((render) => hex(frames[render]));"
        "}"
        "results.blocks = out; }"
    )


_JS = None


def setUpModule():
    """The cards' frames of the three effects, in one Node run started now:
    it draws them while the tests before the comparisons run."""
    global _JS
    if shutil.which("node"):
        module = (ROOT / "www" / "lamp-renderers.js").as_uri()
        streamed = (ROOT / "www" / "lamp-effects-streamed.js").as_uri()
        _JS = NodeRun(
            f"import {{lampSettings, lampFrameBytes, exactFrames}} from {json.dumps(module)};"
            f"import {{SLOTS}} from {json.dumps(streamed)};"
            "const hex = (bytes) => Buffer.from(bytes).toString('hex'); const results = {};"
            "results.slots = SLOTS.map(({mode, warmup, live}) => ({mode, warmup, live: Boolean(live)}));"
            + knight_js() + lava_js() + blocks_js()
            + "process.stdout.write(JSON.stringify(results));"
        )


def tearDownModule():
    if _JS is not None:
        _JS.result()  # not left running


def js_results():
    return _JS.result()


class NeverSentTests(unittest.TestCase):
    def test_a_command_naming_its_slot_is_refused(self):
        names = module("light_native").names_streamed_slot
        self.assertTrue(names([63, 0, 4, {"mode": 100, "onoff": 1}]))
        self.assertTrue(names([63, 0, 4, {"mode": 101, "onoff": 1}]))
        self.assertTrue(names([63, 0, 4, {"mode": 102, "onoff": 1}]))
        self.assertTrue(names([40, 88, 2, {"mode": 40, "mixer": 100}]))
        self.assertFalse(names([63, 0, 4, {"mode": 81, "onoff": 1}]))
        self.assertFalse(names([40, 6, 2, {"mode": 40, "mixer": 0}]))
        # Never reaches the lamp: sending one is refused before anything goes.
        for params, clock in (([63, 0, 4, {"mode": 101, "onoff": 1}], False),
                              ([40, 88, 2, {"mode": 40, "mixer": 102}], True)):
            light = make_light()
            with self.assertRaises(ValueError):
                run(light._send_native(params, clock=clock))
            self.assertEqual([], light._lamp_client.sent, params)
        # Any other is sent.
        light = make_light()
        with instant_sleeps():
            run(light._send_native([63, 0, 4, {"mode": 81, "onoff": 1}]))
        self.assertIn("set_fx_effect", light._lamp_client.methods())

    def test_a_cube_matrix_streams_it(self):
        # No command for it (None: streamed), even were its slot one of the
        # lamp's built-in effects.
        matrix = module("light_matrix")
        for name in (KNIGHT, LAVA, BLOCKS):
            light = make_light(profile=module("device_profile").profile_for("CubeMatrix"),
                               _native_effect=name)
            self.assertIsNone(light._matrix_effect_command(), name)
            with patch.object(matrix, "ENGINE_MODES", matrix.ENGINE_MODES | {100, 101, 102}):
                self.assertIsNone(light._matrix_effect_command(), name)
        light = make_light(profile=module("device_profile").profile_for("CubeMatrix"), _native_effect="Rainbow")
        self.assertIsNotNone(light._matrix_effect_command())
        self.assertNotIn(100, import_pure_module("matrix_effects").ENGINE_MODES)
        self.assertNotIn(101, import_pure_module("matrix_effects").ENGINE_MODES)
        self.assertNotIn(102, import_pure_module("matrix_effects").ENGINE_MODES)

    def test_the_lamp_button_list_does_not_take_it(self):
        self.assertNotIn(KNIGHT, CONSTANTS["NATIVE_EFFECTS"])
        self.assertNotIn(LAVA, CONSTANTS["NATIVE_EFFECTS"])
        self.assertNotIn(BLOCKS, CONSTANTS["NATIVE_EFFECTS"])


if __name__ == "__main__":
    unittest.main()
