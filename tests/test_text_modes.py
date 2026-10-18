"""The text modes: the gallery previews (preview_gradient_modes) draw every
mode exactly as the lamp shows it (_apply_display_mode_internal)."""

import asyncio
import itertools
import math
import random
import traceback
import types
import unittest
from unittest.mock import Mock

from tests.test_native_features import (
    COLOR_UTILS,
    CONSTANTS,
    LIGHT_SOURCE,
    ROOT,
    SERVICES_SOURCE,
    _load_standalone_functions,
)

# layout.py without its one relative import (only the encoder uses it).
LAYOUT = {}
exec(
    compile(
        (ROOT / "layout.py").read_text(encoding="utf-8").replace(
            "from .cube_matrix import CubeMatrix\n", ""
        ),
        "layout.py",
        "exec",
    ),
    LAYOUT,
)

MODES = [
    "Solid Color",
    "Letter Gradient",
    "Column Gradient",
    "Row Gradient",
    "Angle Gradient",
    "Radial Gradient",
    "Letter Angle Gradient",
    "Letter Vertical Gradient",
    "Text Color Sequence",
]

NAMESPACE = {
    **{
        name: CONSTANTS[name]
        for name in (
            "MODE_CLOCK", "MODE_NATIVE_EFFECT", "ORIENTATION_NORMAL",
            "PANEL_FULL_CHAR", "TEXT_RENDER_MODES",
        )
    },
    **{name: LAYOUT[name] for name in ("FONT_MAPS", "Module", "TOTAL_COLUMNS", "TOTAL_ROWS", "char_advance")},
    "rgb_to_hex": COLOR_UTILS["rgb_to_hex"],
    "math": math,
    "random": random,
    "traceback": traceback,
    "_LOGGER": Mock(),
    "is_connection_error": lambda error: False,
    "is_quota_error": lambda error: False,
    "_MISSING_GLYPHS": set(),
}
METHODS = {
    "_apply_display_mode_internal", "_text_mode_frame", "_place_frame",
    "_panel_sequence_frame", "place_pixels", "letter_size", "_char_advance", "get_positions_for_letter",
    "calculate_multi_gradient_color", "calculate_text_offset",
    "_flip_position", "_flip_positions",
}
FUNCTIONS = _load_standalone_functions(
    LIGHT_SOURCE, METHODS, dict(NAMESPACE)
)
PREVIEW = _load_standalone_functions(
    SERVICES_SOURCE, {"generate_preview_for_mode"}, dict(NAMESPACE)
)["generate_preview_for_mode"]


class Lamp:
    """The renderer's state and methods, without Home Assistant."""

    def __init__(self, **state):
        self._mode = "Solid Color"
        self._matrix_mode = "Solid Color"
        self._custom_text = "HI"
        self._text_colors = [(255, 0, 0)]
        self._angle = 0
        self._font = "basic"
        self._alignment = "center"
        self._scroll_offset = 0
        self._max_scroll_offset = 0
        self._scroll_enabled = False
        self._is_scrolling = False
        self._full_panel = False
        self._background_color = (0, 0, 0)
        self._custom_draw_active = False
        self._custom_pixels = None
        self._orientation = CONSTANTS["ORIENTATION_NORMAL"]
        self._ip = "test"
        self._layout = types.SimpleNamespace(
            device_layout=[LAYOUT["Module"]("1x1", ["#000000"]) for _ in range(100)]
        )
        self.__dict__.update(state)

    async def apply(self):
        pass

    def stop_scroll_timer(self):
        pass

    def start_scroll_timer(self):
        pass


for _name in METHODS & FUNCTIONS.keys():
    setattr(Lamp, _name, FUNCTIONS[_name])


def lamp_frame(**state):
    """What the lamp shows: the hex color of each of its 100 pixels."""
    lamp = Lamp(**state)
    random.seed(7)
    asyncio.run(lamp._apply_display_mode_internal())
    return [module.data[0] for module in lamp._layout.device_layout]


def preview_frame(**state):
    """The gallery preview of the lamp's mode, as hex colors."""
    lamp = Lamp(**state)
    random.seed(7)
    colors = PREVIEW(lamp, lamp._mode)
    return [COLOR_UTILS["rgb_to_hex"](tuple(color)) for color in colors]


CASES = [
    {"_custom_text": text, "_font": font, "_alignment": alignment, "_text_colors": colors, "_angle": angle}
    for text, font, alignment, colors, angle in itertools.product(
        ["HI", "A B", "1:2", "W"],
        ["basic", "fat", "italic", "native"],
        ["left", "center", "right"],
        [[(255, 0, 0)], [(255, 0, 0), (0, 128, 255), (250, 220, 10)]],
        [0, 37, 200],
    )
] + [
    # Scrolling text (wider than the panel), at its start and further on.
    {"_custom_text": "HELLO WORLD", "_text_colors": [(10, 200, 30), (200, 10, 90)], "_angle": 120, "_scroll_offset": offset}
    for offset in (0, 7)
] + [
    {"_full_panel": True, "_custom_text": "", "_text_colors": [(255, 0, 0), (0, 0, 255)], "_angle": 45},
    {"_custom_text": "", "_text_colors": [(255, 0, 0)]},
]


class TextModeTests(unittest.TestCase):
    def test_previews_draw_each_mode_as_the_lamp(self):
        for mode, case in itertools.product(MODES, CASES):
            state = {**case, "_mode": mode}
            with self.subTest(mode=mode, **{k.lstrip("_"): v for k, v in case.items()}):
                self.assertEqual(lamp_frame(**state), preview_frame(**state))

    def test_a_flipped_lamp_shows_the_preview_turned_round(self):
        for mode in MODES:
            state = {"_mode": mode, "_custom_text": "AB", "_text_colors": [(255, 0, 0), (0, 0, 255)], "_angle": 30}
            flipped = lamp_frame(**state, _orientation=CONSTANTS["ORIENTATION_FLIPPED"])
            with self.subTest(mode=mode):
                self.assertEqual(flipped, preview_frame(**state)[::-1])

    def test_every_mode_lights_the_pixels_of_solid_color(self):
        # Only the colors differ between the modes: a space keeps its width
        # (Letter Vertical once ran the words together) and glyphs drawn off
        # their cell's first column (the native "1", '"') keep every pixel
        # (Column Gradient once dropped them).
        for text, font in itertools.product(["A B", '1"1', "HI 7"], ["basic", "native"]):
            lit = {
                mode: [color != "#000000" for color in lamp_frame(
                    _mode=mode, _custom_text=text, _font=font, _alignment="left",
                    _text_colors=[(255, 0, 0), (0, 0, 255)],
                )]
                for mode in MODES
            }
            for mode in MODES:
                with self.subTest(mode=mode, text=text, font=font):
                    self.assertEqual(lit[mode], lit["Solid Color"])


class PanelColorSequenceTests(unittest.TestCase):
    """Panel Color Sequence: the colors one module after another over the
    whole panel, whatever the text or full-panel setting (the panel once went
    black with text), and its gallery preview the same (it was black)."""

    COLORS = [(255, 0, 0), (0, 0, 255), (0, 255, 0)]
    SEQUENCE = ["#FF0000", "#0000FF", "#00FF00"]

    def test_the_whole_panel_in_sequence_whatever_the_text(self):
        expected = [self.SEQUENCE[pos % 3] for pos in range(100)]
        for text, full_panel in itertools.product(["", "HI", "HELLO WORLD"], [False, True]):
            state = {
                "_mode": "Panel Color Sequence",
                "_custom_text": text,
                "_full_panel": full_panel,
                "_text_colors": self.COLORS,
                "_is_scrolling": True,
            }
            with self.subTest(text=text, full_panel=full_panel):
                self.assertEqual(lamp_frame(**state), expected)
                self.assertEqual(preview_frame(**state), expected)
        # Turned round on a flipped lamp, like every other mode.
        flipped = lamp_frame(
            _mode="Panel Color Sequence", _text_colors=self.COLORS,
            _orientation=CONSTANTS["ORIENTATION_FLIPPED"],
        )
        self.assertEqual(flipped, expected[::-1])

    def test_red_without_colors_or_for_an_invalid_one(self):
        self.assertEqual(set(lamp_frame(_mode="Panel Color Sequence", _text_colors=[])), {"#FF0000"})
        self.assertEqual(
            lamp_frame(_mode="Panel Color Sequence", _text_colors=[(0, 0, 255), "bad"])[:2],
            ["#0000FF", "#FF0000"],
        )



class GlyphTests(unittest.TestCase):
    def test_a_space_is_drawn_as_nothing_without_a_warning(self):
        # A space is an empty glyph in every font: it used to log a warning
        # at every redraw (about 400 a minute for a scrolling text).
        logger = Mock()
        functions = _load_standalone_functions(
            LIGHT_SOURCE, {"get_positions_for_letter"},
            {**NAMESPACE, "_LOGGER": logger, "_MISSING_GLYPHS": set()},
        )
        lamp = types.SimpleNamespace(_font="basic")
        positions = functions["get_positions_for_letter"]
        self.assertEqual([], positions(lamp, " "))
        logger.warning.assert_not_called()
        self.assertTrue(positions(lamp, "A"))
        # A character the font lacks: reported once, not at every redraw.
        for _ in range(3):
            self.assertEqual([], positions(lamp, "☃"))
        self.assertEqual(1, logger.warning.call_count)


if __name__ == "__main__":
    unittest.main()
