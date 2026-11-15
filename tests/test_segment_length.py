"""Effects drawn on a shorter segment: a Cube Matrix with fewer than 4 blocks.

A Cube Matrix with 3 blocks shows 15 columns (device_profile.columns). Its
effects were drawn 20 columns wide and the last 5 cut off, so what moves
finished its way out of sight (Falling Blocks landing past the last block,
2026-11-15). The renderers now draw on the segment the lamp shows
(lamp_settings' ``columns``: 5 pixels a column), as the lamp's own
renderers do on a shorter segment; lamp_settings records it in the settings.

Every renderer is checked on 5, 10 and 15 columns: nothing lit past them,
and the same frames in Python and JS (tests/segment_length_check.mjs).
"""
import json
import os
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parent / "custom_components" / "yeelight_cube"
CHECK = TESTS / "segment_length_check.mjs"
LAMP = runpy.run_path(str(ROOT / "lamp_renderers.py"))
CONST = runpy.run_path(str(ROOT / "effect_catalog.py"))
# The renderers' own lamp_core (imported standalone by lamp_renderers).
CORE = vars(sys.modules[LAMP["segment_length_for"].__module__])

RENDERS = 80
COLUMNS = (5, 10, 15)
EXEMPT = {"Fireworks"}  # its own timeline (checked below)


def effects():
    """Every effect a renderer draws, but Fireworks. SEGMENT_FAMILY=waves (a
    lamp_effects_<family> module, comma separated) checks those only."""
    families = {f"lamp_effects_{name.strip()}" for name in os.environ.get("SEGMENT_FAMILY", "").split(",") if name.strip()}
    for name, spec in CONST["ALL_NATIVE_EFFECTS"].items():
        if name in EXEMPT or name not in LAMP["LAMP_RENDERED_EFFECTS"]:
            continue
        if not LAMP["has_renderer"](spec["mode"]):
            continue
        if families and LAMP["REGISTRY"][spec["mode"]]["step"].__module__.rpartition(".")[2] not in families:
            continue
        yield name, spec


def settings_for(name, columns, direction=None):
    spec = CONST["ALL_NATIVE_EFFECTS"][name]
    direction = direction or (spec.get("directions") or ["Right"])[0]
    return LAMP["lamp_settings"](name, direction, 128, None, "normal", "right", None, None, columns)


def cases():
    """(key, settings): each effect on 5, 10 and 15 columns in its first
    direction, and on 15 in every other it offers."""
    out = []
    for name, spec in effects():
        for columns in COLUMNS:
            out.append((f"{name}|{columns}", settings_for(name, columns)))
        for direction in (spec.get("directions") or [])[1:]:
            out.append((f"{name}|15|{direction}", settings_for(name, 15, direction)))
    return out


def python_crcs(settings, renders=RENDERS):
    return [zlib.crc32(frame) for frame in LAMP["exact_frames"](settings, 0, renders)]


def lit_columns(frame) -> set:
    """The columns a lamp-order frame (300 bytes, row-major) lights."""
    return {pixel % 20 for pixel in range(100) if any(frame[3 * pixel:3 * pixel + 3])}


class SegmentLengthTests(unittest.TestCase):
    def test_the_settings_carry_the_segment(self):
        self.assertNotIn("length", settings_for("Rainbow", 20))  # the full panel: as before
        self.assertNotIn("length", settings_for("Rainbow", None))
        self.assertEqual(75, settings_for("Rainbow", 15)["length"])
        self.assertEqual([5, 15], sorted(CORE["effect_geometry"](settings_for("Rainbow", 15))))

    def test_nothing_is_lit_past_the_columns_shown(self):
        for key, settings in cases():
            columns = int(key.split("|")[1])
            with self.subTest(key):
                for render, frame in enumerate(LAMP["exact_frames"](settings, 0, RENDERS)):
                    shown = lit_columns(frame)
                    self.assertTrue(shown <= set(range(columns)), f"render {render}: {sorted(shown)}")

    def test_python_and_js_draw_the_same(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node not installed")
        every = cases()
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as file:
            json.dump([{"key": key, "settings": settings, "renders": RENDERS} for key, settings in every], file)
        try:
            result = subprocess.run([node, str(CHECK), file.name], text=True, capture_output=True, cwd=TESTS.parent)
        finally:
            os.unlink(file.name)
        self.assertTrue(result.stdout.strip(), result.stderr)
        js = json.loads(result.stdout)
        failures = []
        for key, settings in every:
            python = python_crcs(settings)
            if js[key] != python:
                first = next((i for i, (a, b) in enumerate(zip(python, js[key])) if a != b), None)
                failures.append(f"{key}: render {first} ({js[key][first] if first is not None else js[key][:1]})")
        self.assertEqual([], failures)

    def test_falling_blocks_land_on_the_last_column_shown(self):
        # 2026-11-15: the owner's Cube Matrix, 3 blocks (15 columns), Falling
        # Blocks falling right: the pieces landed in columns 15-19, unseen.
        settings = settings_for("Falling Blocks", 15, "Right")
        settings["seed"] = 1
        lit = set()
        for frame in LAMP["exact_frames"](settings, 0, 1500):
            lit |= lit_columns(frame)
        self.assertIn(14, lit)
        self.assertTrue(lit <= set(range(15)))

    def test_fireworks_flies_within_the_columns_shown(self):
        settings = LAMP["lamp_settings"]("Fireworks", "Up", 128, None, "normal", "right", None, None, 10)
        lit = set()
        for step in range(400):
            frame = LAMP["lamp_effect_frame"](settings, step * 0.04)
            lit |= {pixel % 20 for pixel, colour in enumerate(frame) if any(colour)}
        self.assertTrue(lit)
        self.assertTrue(lit <= set(range(10)), sorted(lit))


    def test_the_clock_digits_stay_in_the_columns_shown(self):
        # The digits are centred in the columns shown; a background that
        # turns or mirrors them does so within those columns, never into the
        # hidden ones (lamp_core.clock_digit_targets on the segment).
        from tests.ha_stubs import import_pure_module

        face = import_pure_module("clock_face")
        flags = {LAMP["clock_digit_flags"](mixer, True) for mixer in range(80)} | {LAMP["HANDOVER_FLAGS"]}
        for columns, digit_flags, turned in [(c, f, t) for c in (10, 15) for f in flags for t in (False, True)]:
            with self.subTest(columns=columns, flags=hex(digit_flags), turned=turned):
                pixels = face.clock_digit_pixels("12:45", True, digit_flags, turned, columns)
                self.assertTrue(pixels)
                self.assertTrue({index % 20 for index, _char, _col in pixels} <= set(range(columns)))


if __name__ == "__main__":
    unittest.main()
