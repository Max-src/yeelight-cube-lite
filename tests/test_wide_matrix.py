"""A Cube Matrix of 5 to 8 modules (spots and panels anywhere in the chain):
everything the light draws covers every module, on frames 5 columns a module
wide (device_profile.width), and a lamp of up to 4 modules keeps its 20 x 5
frames."""

import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fakes import FakeCube, FakeEntry, make_light, module, run  # noqa: E402

PROFILES = module("device_profile")
CLOCK_FACE = module("clock_face")
POWER = module("lamp_power")
STORAGE = module("pixel_art_storage")
IMAGES = module("image_utils")
RENDER = module("light_render")

# Chains from the base (1 panel, 2 matrix, 3 spot), the owner's filmed one
# (2026-11-21) first.
CHAINS = {
    "matrix,matrix,matrix,spot,panel": "2,2,2,3,1",
    "spot first, 6": "3,2,2,2,2,1",
    "panel, spot in the middle, 7": "1,2,2,3,2,2,1",
    "8 matrix": "2,2,2,2,2,2,2,2",
    "two spots, 8": "2,3,2,2,1,2,3,2",
}


def matrix(topology):
    return PROFILES.cube_matrix_profile(topology=topology)


def light_on(profile, **state):
    async def apply(*args, **kwargs):
        pass

    return make_light(profile=profile, apply=apply, _remember_drawing=lambda: None, **state)


def shown(light):
    """The light's frame as (r, g, b) per pixel."""
    return [tuple(int(module.data[0][i:i + 2], 16) for i in (1, 3, 5)) for module in light._layout.device_layout]


class FrameSizeTests(unittest.TestCase):
    def test_frames_are_five_columns_a_module(self):
        for name, topology in CHAINS.items():
            profile = matrix(topology)
            light = light_on(profile)
            with self.subTest(name):
                self.assertEqual(profile.pixels, len(light._layout.device_layout))
                self.assertEqual(profile.pixels, len(light._standby_pixels()) and profile.pixels)
                self.assertEqual(len(profile.drawing_pixels(profile.to_wire([(0, 0, 0)] * profile.pixels))),
                                 len(light._standby_pixels()))

    def test_up_to_four_modules_keep_100_pixels(self):
        for topology in ("2,2,2,2", "2,3,2", "1,1,1,1,3,3", None):
            light = light_on(matrix(topology))
            self.assertEqual(100, len(light._layout.device_layout))
        self.assertEqual(100, len(make_light()._layout.device_layout))

    def test_the_frame_follows_a_new_module_list(self):
        # A picture kept at its rows and columns when the list grows and
        # shrinks (_matrix_modules_changed rebuilds the profile).
        profile = {"value": matrix("2,2,2,2")}
        light_class = type("Light", (module("light").YeelightCubeLight,), {
            "device_profile": property(lambda self: profile["value"]),
        })
        light = light_class(FakeCube(profile["value"]), "192.0.2.10", FakeEntry())
        light._layout.device_layout[1 * 20 + 19].set_colors(["#FF0000"])
        profile["value"] = matrix("2,2,2,2,3,1")
        self.assertEqual(150, len(light._layout.device_layout))
        self.assertEqual("#FF0000", light._layout.device_layout[1 * 30 + 19].data[0])
        self.assertEqual("#000000", light._layout.device_layout[1 * 30 + 25].data[0])
        profile["value"] = matrix("2,2,2")
        self.assertEqual(100, len(light._layout.device_layout))
        self.assertEqual("#FF0000", light._layout.device_layout[1 * 20 + 19].data[0])

    def test_a_20_wide_frame_is_placed_from_column_0(self):
        frame = [(row, col, 1) for row in range(5) for col in range(20)]
        wide = RENDER.fit_frame(frame, 30)
        self.assertEqual(150, len(wide))
        self.assertEqual((3, 19, 1), wide[3 * 30 + 19])
        self.assertEqual((0, 0, 0), wide[3 * 30 + 20])
        self.assertEqual(frame, RENDER.fit_frame(frame, 20))
        self.assertEqual(frame, RENDER.fit_frame(wide, 20))


class TextTests(unittest.TestCase):
    def test_text_is_centred_across_every_column(self):
        for name, topology in CHAINS.items():
            profile = matrix(topology)
            light = light_on(profile, _custom_text="HI", _mode="Solid Color", _text_colors=[(255, 0, 0)])
            run(light._apply_display_mode_internal())
            frame = shown(light)
            lit = sorted({index % profile.width for index, rgb in enumerate(frame) if rgb != (0, 0, 0)})
            with self.subTest(name):
                self.assertEqual(profile.pixels, len(frame))
                # Centred in the columns (the same space on both sides, or
                # one more on the right).
                before, after = lit[0], profile.columns - 1 - lit[-1]
                self.assertIn(after - before, (0, 1))

    def test_a_full_panel_gradient_spans_every_column(self):
        profile = matrix("2,2,2,3,1,2")
        light = light_on(
            profile, _full_panel=True, _custom_text="", _mode="Angle Gradient",
            _text_colors=[(255, 0, 0), (0, 0, 255)], _angle=0,
        )
        run(light._apply_display_mode_internal())
        frame = shown(light)
        self.assertEqual((255, 0, 0), frame[0])
        self.assertEqual((0, 0, 255), frame[29])
        self.assertEqual(frame, [tuple(c) for c in light.gradient_preview("Angle Gradient")])

    def test_long_text_scrolls_over_the_columns_shown(self):
        light = light_on(matrix("2,2,2,2,2,2"), _custom_text="HELLO WORLD 1234", _mode="Solid Color")
        width = sum(light._char_advance(letter) for letter in light._custom_text) - 1
        light.calculate_text_offset(width, light._shown_columns())
        self.assertEqual(width - 30, light._max_scroll_offset)

    def test_a_flipped_lamp_turns_the_text_within_its_columns(self):
        state = {"_custom_text": "AB", "_mode": "Letter Gradient", "_text_colors": [(255, 0, 0), (0, 0, 255)]}
        profile = matrix("2,3,2,2,1,2,2")
        normal = light_on(profile, **state)
        run(normal._apply_display_mode_internal())
        flipped = light_on(profile, _orientation="flipped", **state)
        run(flipped._apply_display_mode_internal())
        self.assertEqual(shown(normal)[::-1], shown(flipped))

    def test_panel_color_sequence_fills_the_whole_frame(self):
        light = light_on(matrix("2,2,2,2,3"), _mode="Panel Color Sequence",
                         _text_colors=[(255, 0, 0), (0, 0, 255)])
        run(light._apply_display_mode_internal())
        frame = shown(light)
        self.assertEqual(125, len(frame))
        self.assertEqual([(255, 0, 0), (0, 0, 255)][124 % 2], frame[124])


class ClockFaceTests(unittest.TestCase):
    def digits(self, profile, text="20:08", turned=False):
        return CLOCK_FACE.clock_digit_pixels(text, True, 0, turned, **CLOCK_FACE.clock_geometry(profile))

    def test_without_a_spot_and_up_to_4_modules_as_before(self):
        for topology in ("2,2,2,2", "2,2,2", "1,2,1", None):
            profile = matrix(topology)
            for turned in (False, True):
                self.assertEqual(
                    CLOCK_FACE.clock_digit_pixels("12:34", True, 0, turned, profile.columns),
                    self.digits(profile, "12:34", turned=turned),
                )
        self.assertEqual(CLOCK_FACE.clock_digit_pixels("21:05", True, 0, False),
                         self.digits(PROFILES.CUBE_LITE_PROFILE, "21:05"))

    def test_digits_never_on_a_spot_and_centred_across_the_blocks(self):
        for name, topology in CHAINS.items():
            profile = matrix(topology)
            spots = {module["column"] + step for module in profile.layout if module["type"] == "spot"
                     for step in range(5)}
            blocks = [col for col in range(profile.columns) if col not in spots]
            for turned in (False, True):
                pixels = self.digits(profile, turned=turned)
                columns = {index % profile.width for index, _char, _col in pixels}
                with self.subTest(name, turned=turned):
                    self.assertTrue(pixels)
                    self.assertFalse(columns & spots)
                    self.assertTrue(all(index < profile.pixels for index, *_ in pixels))
                    # Centred across the blocks' columns in chain order: the
                    # same space before the first digit and after the last.
                    lanes = sorted(blocks.index(col) for col in columns)
                    before, after = lanes[0], len(blocks) - 1 - lanes[-1]
                    self.assertLessEqual(abs(before - after), 1)

    def test_a_spot_between_blocks_splits_the_time(self):
        profile = matrix("2,2,3,2,2")  # columns 10-14 are the spot
        columns = {index % profile.width for index, *_ in self.digits(profile)}
        self.assertTrue(any(col < 10 for col in columns) and any(col >= 15 for col in columns))

    def test_the_streamed_clock_fallback_draws_on_the_blocks(self):
        profile = matrix("2,2,2,3,1")
        light = light_on(profile, _mode="Clock", _camera_entities=[])
        frame = light._own_effect_frame_drawn(0)
        self.assertEqual(profile.pixels, len(frame))
        lit = {index % profile.width for index, rgb in enumerate(frame) if rgb != (0, 0, 0)}
        self.assertTrue(lit)
        self.assertFalse(lit & set(range(15, 20)))  # the spot

    def test_the_lamps_own_clock_needs_4_matrix_modules(self):
        light = light_on(matrix("2,2,2,3,1"))
        light._matrix_native_refused = False
        self.assertEqual(3, sum(1 for kind in light.device_profile.module_types if kind == 2))
        self.assertIsNone(light._matrix_clock_command())


class PixelArtTests(unittest.TestCase):
    ART = [{"position": row * 20 + col, "color": [10 + col, row, 5]} for row in range(5) for col in range(20)]

    def test_a_20_wide_art_is_placed_from_column_0(self):
        placed = STORAGE.pixels_at_width(self.ART, 20, 35)
        self.assertEqual(100, len(placed))
        self.assertIn({"position": 3 * 35 + 19, "color": [29, 3, 5]}, placed)
        self.assertIs(self.ART, STORAGE.pixels_at_width(self.ART, None, 20))

    def test_a_wider_art_is_cropped_to_the_frame(self):
        wide = [{"position": row * 40 + col, "color": [col, row, 1]} for row in range(5) for col in range(40)]
        placed = STORAGE.pixels_at_width(wide, 40, 25)
        self.assertEqual(125, len(placed))
        self.assertEqual({p["position"] for p in placed}, set(range(125)))
        self.assertEqual(100, len(STORAGE.pixels_at_width(wide, 40, 20)))

    def test_its_width_is_stored_and_read(self):
        art = STORAGE.stored_pixel_art("Wide", self.ART, None, 30)
        self.assertEqual(30, STORAGE.pixel_art_width(art))
        old = STORAGE.stored_pixel_art("Old", self.ART)
        self.assertNotIn("width", old)
        self.assertEqual(20, STORAGE.pixel_art_width(old))
        self.assertNotIn("width", STORAGE.stored_pixel_art("Twenty", self.ART, None, 20))

    def test_shown_on_a_wide_lamp(self):
        profile = matrix("2,1,2,3,2,2,2")
        light = light_on(profile)
        run(light.show_pixel_art("Built-in", self.ART))
        run(light._apply_display_mode_internal())
        frame = shown(light)
        self.assertEqual((10 + 19, 2, 5), frame[2 * 35 + 19])
        self.assertEqual((0, 0, 0), frame[2 * 35 + 20])
        wide = [{"position": 4 * 35 + 34, "color": [1, 2, 3]}]
        run(light.show_pixel_art(None, wide, width=35))
        run(light._apply_display_mode_internal())
        self.assertEqual((1, 2, 3), shown(light)[4 * 35 + 34])

    def test_an_image_fills_the_frame(self):
        rows = [[(row, col, 0) for col in range(30)] for row in range(5)]
        pixels = IMAGES.image_pixels([color for row in rows for color in row], 30)
        self.assertEqual(150, len(pixels))
        # The image's top row is the lamp's row 4.
        self.assertEqual((0, 29, 0), pixels[4 * 30 + 29]["color"])
        self.assertEqual((4, 0, 0), pixels[0]["color"])


class TurnedPictureTests(unittest.TestCase):
    turn = staticmethod(module("light_settings").SettingsMixin._turn_published_picture)

    def check(self, profile):
        frame = [(index, 0, 0) for index in range(profile.pixels)]
        light = types.SimpleNamespace(
            _orientation="normal", lamp_draws_matrix=False, _base_matrix_colors=list(frame), device_profile=profile,
        )
        self.turn(light, "flipped")
        shown_columns = min(profile.width, profile.columns)
        for index, color in enumerate(frame):
            row, col = divmod(index, profile.width)
            turned_col = shown_columns - 1 - col if col < shown_columns else col
            self.assertEqual(color, light._base_matrix_colors[(4 - row) * profile.width + turned_col])

    def test_turned_within_the_columns_shown(self):
        for topology in ("2,2,2", "2,2,2,2", "2,2,3,2,1,2"):
            with self.subTest(topology):
                self.check(matrix(topology))
        self.check(PROFILES.CUBE_LITE_PROFILE)


class AttributesTests(unittest.TestCase):
    def test_every_module_and_its_columns(self):
        profile = matrix("2,2,2,3,1,2,2,3")
        light = light_on(profile, _mode="Solid Color", _custom_text="HI")
        run(light._apply_display_mode_internal())
        light._base_matrix_colors = None
        attrs = light.extra_state_attributes
        self.assertEqual(8, len(attrs["matrix_modules"]))
        self.assertEqual(40, attrs["matrix_columns"])
        self.assertEqual(200, len(attrs["matrix_colors"]))

    def test_the_matter_snapshot_has_the_module_list_now(self):
        light = light_on(matrix("2,2,3,1,2"))
        summary = light._matrix_published_summary({"node_id": 7, "topology": [2, 1, 3, 0, 0, 0, 0, 0]})
        self.assertEqual([2, 2, 3, 1, 2, 0, 0, 0], summary["topology"])
        self.assertIsNone(light._matrix_published_summary(None))
        lite = light_on(PROFILES.CUBE_LITE_PROFILE)
        self.assertEqual({"node_id": 1}, lite._matrix_published_summary({"node_id": 1}))


class PowerTests(unittest.TestCase):
    def test_a_cube_lite_frame_is_estimated_as_before(self):
        white = [(255, 255, 255)] * 100
        self.assertAlmostEqual(
            POWER.BASE_W + POWER.SPAN_W * (1 - __import__("math").exp(-POWER.panel_drive(white) / POWER.SPAN_W)),
            POWER.estimated_power(white),
        )

    def test_a_longer_frame_levels_off_higher(self):
        white100, white200 = [(255, 255, 255)] * 100, [(255, 255, 255)] * 200
        lite, long = POWER.estimated_power(white100), POWER.estimated_power(white200)
        self.assertAlmostEqual(2 * (lite - POWER.BASE_W), long - POWER.BASE_W, places=6)
        # The same picture with black columns added draws the same less the
        # levelling (it is never estimated lower).
        half = [(255, 255, 255)] * 100 + [(0, 0, 0)] * 100
        self.assertGreaterEqual(POWER.estimated_power(half), lite)

    def test_its_limit_holds_and_the_top_value_is_no_limit(self):
        frame = [(255, 255, 255)] * 200
        self.assertIs(frame, POWER.limit_frame_power(frame, POWER.NO_LIMIT_W))
        limited, watts = POWER.limited_frame(frame, 5.0)
        self.assertLessEqual(watts, 5.0)
        self.assertGreater(watts, 4.5)
        self.assertEqual(200, len(limited))


if __name__ == "__main__":
    unittest.main()


class ModuleChangeTests(unittest.TestCase):
    def test_a_drawing_keeps_its_place_when_the_frame_widens(self):
        # 4 modules (20 wide) to 5 (25 wide): a drawing shown is placed again
        # (positions are row * width + column), and the Matter link's copy of
        # the list follows (the rotation check reads it).
        light = light_on(matrix("2,2,2,2"))
        light._custom_pixels = [{"position": 2 * 20 + 19, "color": [255, 0, 0]}]
        light._matter = types.SimpleNamespace(values={"topology": [2, 2, 2, 2, 0, 0, 0, 0]})
        light._is_on = False
        light._matrix_modules_changed([2, 2, 2, 3, 1])
        self.assertEqual(25, light.frame_width)
        self.assertEqual([{"position": 2 * 25 + 19, "color": [255, 0, 0]}], light._custom_pixels)
        self.assertEqual([2, 2, 2, 3, 1, 0, 0, 0], light._matter.values["topology"])

    def test_a_stored_art_keeps_its_width_when_migrated(self):
        migrate = module("storage").migrate_pixel_arts
        arts, _changed = migrate([{"name": "Wide", "width": 25,
                                   "pixels": [{"position": 24, "color": [1, 2, 3]}]}])
        self.assertEqual(25, STORAGE.pixel_art_width(arts[0]))
