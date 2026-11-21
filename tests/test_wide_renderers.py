"""Effects, previews and animations on a Cube Matrix of 5 to 8 modules.

A Cube Matrix of more than 4 modules shows more than 20 columns (5 a
module, spots included: device_profile.columns, up to MAX_COLS = 40). Its
effects are drawn on a segment of 5 pixels a column, and its frames are as
wide as it: lamp order with a stride of max(20, columns)
(lamp_core.frame_width, device_profile.DeviceProfile.width). A lamp of 20
columns or fewer keeps its 20-wide frames, bit for bit (test_lamp_effects,
test_segment_length). Animations, 20 x 5 by nature, are placed from column 0,
the rest black.

The frames of every renderer on 25 to 40 columns, Python against JS, are
tests/test_segment_length.py's; here the stride, the reach and the rest.
"""
import json
import runpy
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parent / "custom_components" / "yeelight_cube"
WWW = ROOT / "www"
LAMP = runpy.run_path(str(ROOT / "lamp_renderers.py"))
CORE = vars(sys.modules[LAMP["segment_length_for"].__module__])
CONST = runpy.run_path(str(ROOT / "effect_catalog.py"))
STUDIO = runpy.run_path(str(ROOT / "lamp_studio.py"))
ANIMATIONS = runpy.run_path(str(ROOT / "lamp_animations.py"))
PREVIEW = runpy.run_path(str(ROOT / "native_effect_preview.py"))

WIDE = (25, 30, 35, 40)
PALETTE = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]


def settings_for(name, columns, direction=None):
    spec = CONST["ALL_NATIVE_EFFECTS"][name]
    direction = direction or (spec.get("directions") or ["Right"])[0]
    return LAMP["lamp_settings"](name, direction, 128, None, "normal", "right", None, None, columns)


def lit_columns(frame, width) -> set:
    """The columns a lamp-order frame (pixels or flat bytes) lights."""
    if isinstance(frame, (bytes, bytearray)):
        frame = list(zip(frame[0::3], frame[1::3], frame[2::3]))
    return {index % width for index, pixel in enumerate(frame) if any(pixel)}


def node(script: str):
    """What a JS module script prints, as JSON."""
    result = subprocess.run(
        [shutil.which("node"), "--input-type=module", "-e", script],
        text=True, capture_output=True, check=True, cwd=TESTS.parent,
    )
    return json.loads(result.stdout)


def module(name: str) -> str:
    return json.dumps((WWW / name).as_uri())


class GeometryTests(unittest.TestCase):
    def test_the_segment_and_the_frame_width(self):
        for columns in range(1, 41):
            self.assertEqual(5 * columns, CORE["segment_length_for"](columns))
            self.assertEqual(max(20, columns), CORE["frame_width_for"](columns))
            self.assertEqual(max(20, columns), CORE["frame_width"](5 * columns))
        for columns in (None, 0, 41, "x"):
            self.assertEqual(100, CORE["segment_length_for"](columns))
            self.assertEqual(20, CORE["frame_width_for"](columns))
        self.assertEqual(200, settings_for("Rainbow", 40)["length"])
        self.assertEqual([5, 40], sorted(CORE["effect_geometry"](settings_for("Rainbow", 40))))

    def test_a_panel_becomes_a_frame_of_its_width(self):
        # Panel pixel p (column-major, 5 a column) is frame pixel
        # row * width + column; a shorter segment stays 20 wide.
        for columns in (3, 15, 20, *WIDE):
            length = 5 * columns
            width = max(20, columns)
            panel = bytes(value for pixel in range(length) for value in (pixel % 251 + 1, pixel // 251, 7))
            frame = CORE["panel_to_frame"](panel)
            self.assertEqual(3 * 5 * width, len(frame))
            for pixel in range(length):
                column, row = divmod(pixel, 5)
                at = 3 * (row * width + column)
                self.assertEqual(panel[3 * pixel:3 * pixel + 3], frame[at:at + 3])
            self.assertTrue(lit_columns(frame, width) <= set(range(columns)))

    def test_strip_frame_and_frame_index_take_the_width(self):
        self.assertEqual(3 * 40 + 39, CORE["frame_index"](39 * 5 + 3, 40))
        self.assertEqual(3 * 20 + 19, CORE["frame_index"](19 * 5 + 3))
        frame = CORE["strip_frame"]([(199, 1, 2, 3)], 3, length=200)
        self.assertEqual(200, len(frame))
        self.assertEqual(1, sum(1 for pixel in frame if any(pixel)))

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_the_js_core_is_the_same(self):
        panels = {columns: list(range(15 * columns)) for columns in WIDE}
        out = node(
            f"const c = await import({module('lamp-core.js')});"
            f"const panels = {json.dumps(panels)};"
            "process.stdout.write(JSON.stringify({"
            " widths: Array.from({length: 45}, (_, k) => c.frameWidthFor(k)),"
            " lengths: Array.from({length: 45}, (_, k) => c.segmentLengthFor(k)),"
            " frames: Object.fromEntries(Object.entries(panels).map(([k, p]) =>"
            "   [k, Array.from(c.panelToFrame(Uint8Array.from(p, (v) => v & 255)))])),"
            " strip: c.stripFrame([[199, 1, 2, 3], [7, 4, 5, 6]], 3, 2, 200),"
            "}));"
        )
        self.assertEqual([CORE["frame_width_for"](k) for k in range(45)], out["widths"])
        self.assertEqual([CORE["segment_length_for"](k) for k in range(45)], out["lengths"])
        for columns, panel in panels.items():
            self.assertEqual(
                list(CORE["panel_to_frame"](bytes(v & 255 for v in panel))), out["frames"][str(columns)],
            )
        self.assertEqual(
            [list(p) for p in CORE["strip_frame"]([(199, 1, 2, 3), (7, 4, 5, 6)], 3, 2, 200)], out["strip"],
        )


class ReachTests(unittest.TestCase):
    """What moves goes on to the last column, and never past it."""

    def reach(self, name, columns, renders, direction=None, seed=None):
        settings = settings_for(name, columns, direction)
        if seed is not None:
            settings["seed"] = seed
        width = max(20, columns)
        lit = set()
        for frame in LAMP["exact_frames"](settings, 0, renders):
            self.assertEqual(15 * width, len(frame))
            lit |= lit_columns(frame, width)
        return lit

    def test_moving_effects_reach_the_last_column(self):
        for name, renders in (("Knight Rider", 400), ("Rainbow", 5), ("Bouncing Ball", 400),
                              ("Meteor", 400), ("Lava Lamp", 400)):
            for columns in WIDE:
                with self.subTest(name=name, columns=columns):
                    lit = self.reach(name, columns, renders)
                    self.assertIn(columns - 1, lit)
                    self.assertTrue(lit <= set(range(columns)))

    def test_falling_blocks_land_on_the_last_column(self):
        lit = self.reach("Falling Blocks", 40, 1500, "Right", seed=1)
        self.assertIn(39, lit)
        self.assertTrue(lit <= set(range(40)))

    def test_fireworks_fly_past_the_twentieth_column(self):
        for columns in (30, 40):
            settings = LAMP["lamp_settings"]("Fireworks", "Up", 128, None, "normal", "right", None, None, columns)
            lit = set()
            for step in range(600):
                frame = LAMP["lamp_effect_frame"](settings, step * 0.04)
                self.assertEqual(5 * columns, len(frame))
                lit |= lit_columns(frame, columns)
            self.assertTrue(lit <= set(range(columns)), sorted(lit))
            self.assertTrue(max(lit) >= 20, sorted(lit))

    def test_centre_bursts_keep_their_picture_and_run_their_tail_on(self):
        # The bursts' pixels are fixed (lamp_effects_sparks): a longer segment
        # shows the same first 20 columns, its tail colour on to the last.
        short = list(LAMP["exact_frames"](settings_for("Centre bursts", 20), 0, 300))
        long = list(LAMP["exact_frames"](settings_for("Centre bursts", 40), 0, 300))
        tail = set()
        for small, wide in zip(short, long):
            for row in range(5):
                self.assertEqual(small[60 * row:60 * row + 60], wide[120 * row:120 * row + 60])
            tail |= lit_columns(wide, 40)
        self.assertIn(39, tail)

    def test_magic_cells_on_a_wider_box(self):
        cells = LAMP["magic_cells"](42, 90, 40)
        self.assertEqual(200, len(cells))
        self.assertEqual(LAMP["magic_cells"](42, 90), LAMP["magic_cells"](42, 90, 20))


class ClockDigitTests(unittest.TestCase):
    FLAGS = (0x05, 0x0D, 0x07, 0x47, 0x45, 0x15, 0x17, 0x57)

    def test_the_digits_stay_on_the_columns_shown(self):
        targets = CORE["clock_digit_targets"]
        for columns in WIDE:
            for flags in self.FLAGS:
                for index in range(5 * columns):
                    row, column = divmod(index, columns)
                    if column >= columns:
                        continue
                    for target in targets(index, flags, 5 * columns, columns):
                        self.assertTrue(0 <= target < 5 * columns)
                        self.assertLess(target % columns, columns)

    def test_a_20_wide_frame_is_as_before(self):
        targets = CORE["clock_digit_targets"]
        for flags in self.FLAGS:
            for length in (50, 75, 100):
                for index in range(100):
                    self.assertEqual(targets(index, flags, length), targets(index, flags, length, 20))

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_the_js_targets_are_the_same(self):
        out = node(
            f"const c = await import({module('lamp-core.js')});"
            f"const flags = {json.dumps(self.FLAGS)}; const wide = {json.dumps(WIDE)};"
            "process.stdout.write(JSON.stringify(wide.map((w) => flags.map((f) =>"
            " Array.from({length: 5 * w}, (_, i) => c.clockDigitTargets(i, f, 5 * w, w))))));"
        )
        expected = [
            [[CORE["clock_digit_targets"](i, f, 5 * w, w) for i in range(5 * w)] for f in self.FLAGS]
            for w in WIDE
        ]
        self.assertEqual(expected, out)


class AnimationTests(unittest.TestCase):
    def test_an_animation_covers_every_column(self):
        # Snowfall (scattered flakes) repeats every 20 columns; the glows and
        # waves are stretched: the first and last columns are the picture's,
        # and every column lies between its two nearest.
        narrow_args = ("left", None, 128)
        for key in ANIMATIONS["animation_names"]():
            narrow = ANIMATIONS["animation_frame"](key, 1.3, *narrow_args)
            self.assertEqual(narrow, ANIMATIONS["animation_frame"](key, 1.3, *narrow_args, None, None, 15))
            for columns in WIDE:
                for layout in (None, "app"):
                    base = [tuple(p) for p in ANIMATIONS["animation_frame"](key, 1.3, "left", layout, 128)]
                    wide = [tuple(p) for p in ANIMATIONS["animation_frame"](key, 1.3, "left", layout, 128, None, None, columns)]
                    self.assertEqual(5 * columns, len(wide))
                    for row in range(5):
                        line, out = base[20 * row:20 * row + 20], wide[columns * row:columns * (row + 1)]
                        with self.subTest(key=key, columns=columns, layout=layout, row=row):
                            if key in ANIMATIONS["REPEATED_ANIMATIONS"]:
                                self.assertEqual([line[c % 20] for c in range(columns)], out)
                                continue
                            self.assertEqual((line[0], line[-1]), (out[0], out[-1]))
                            for column, pixel in enumerate(out):
                                left = column * 19 // (columns - 1)
                                near, far = line[left], line[min(left + 1, 19)]
                                for channel in range(3):
                                    self.assertLessEqual(min(near[channel], far[channel]), pixel[channel])
                                    self.assertLessEqual(pixel[channel], max(near[channel], far[channel]))

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_the_js_frames_are_the_same(self):
        keys = list(ANIMATIONS["animation_names"]())
        out = node(
            f"const a = await import({module('lamp-animation-frames.js')});"
            f"const keys = {json.dumps(keys)}; const wide = {json.dumps([None, 15, *WIDE])};"
            "process.stdout.write(JSON.stringify(keys.map((k) => [null, 'app'].map((layout) =>"
            " wide.map((w) => a.animationFrame(k, 2.7, 'up', layout, 150, null, null, w))))));"
        )
        expected = [
            [[[list(p) for p in ANIMATIONS["animation_frame"](k, 2.7, "up", layout, 150, None, None, w)]
              for w in (None, 15, *WIDE)] for layout in (None, "app")]
            for k in keys
        ]
        self.assertEqual(expected, out)


class PreviewTests(unittest.TestCase):
    """render_native_effect and the palette stream on a wider lamp."""

    NAMES = ("Rainbow", "Knight Rider", "Stored GIF")

    def test_every_preview_is_as_wide_as_the_lamp(self):
        animation = next(name for name, spec in CONST["ALL_NATIVE_EFFECTS"].items() if spec.get("animation"))
        for name in (*self.NAMES, animation):
            for columns in (None, 15, *WIDE):
                width = max(20, columns or 20)
                with self.subTest(name=name, columns=columns):
                    frame = PREVIEW["render_native_effect"](name, 1.7, "Right", columns=columns)
                    self.assertEqual(5 * width, len(frame))

    def test_a_streamed_palette_effect_is_as_wide_as_the_lamp(self):
        for name in ("Starry Sky", "Waves", "Rainbow", "Building Blocks"):
            for columns in WIDE:
                with self.subTest(name=name, columns=columns):
                    lit = set()
                    for render in range(0, 200, 7):
                        frame = STUDIO["studio_frame_at"](name, render, "Right", 128, None, None, PALETTE, True, columns)
                        self.assertEqual(5 * columns, len(frame))
                        lit |= lit_columns(frame, columns)
                    self.assertTrue(lit <= set(range(columns)))
                    background = STUDIO["studio_clock_background_at"](name, 40, 128, None, PALETTE, None, True, None, None, columns)
                    self.assertEqual(5 * columns, len(background))

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_the_js_previews_are_the_same(self):
        studio = ("Starry Sky", "Waves", "Rainbow", "Hacking")
        out = node(
            f"const p = await import({module('native-effect-preview.js')});"
            f"const s = await import({module('lamp-studio.js')});"
            f"const names = {json.dumps(self.NAMES)}; const studio = {json.dumps(studio)};"
            f"const wide = {json.dumps(WIDE)}; const palette = {json.dumps(PALETTE)};"
            "process.stdout.write(JSON.stringify({"
            " previews: names.map((n) => wide.map((w) =>"
            "   p.renderNativeEffect(n, 1.7, 'Right', null, null, null, null, null, null, null, null, null, w))),"
            " studio: studio.map((n) => wide.map((w) => [3, 60, 61].map((r) =>"
            "   s.studioFrameAt(n, r, 'Right', 128, null, null, palette, true, w)))),"
            "}));"
        )
        self.assertEqual(
            [[[list(px) for px in PREVIEW["render_native_effect"](n, 1.7, "Right", columns=w)] for w in WIDE]
             for n in self.NAMES],
            out["previews"],
        )
        self.assertEqual(
            [[[[list(px) for px in STUDIO["studio_frame_at"](n, r, "Right", 128, None, None, PALETTE, True, w)]
               for r in (3, 60, 61)] for w in WIDE] for n in studio],
            out["studio"],
        )


if __name__ == "__main__":
    unittest.main()
