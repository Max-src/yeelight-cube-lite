"""Every registered renderer against the reference frames of what the lamp
draws (tests/fixtures/lamp_effects.json.gz): every config, all 240 renders, in
Python and in JS, and the timeline every preview reads.

A slot registered in lamp_renderers is picked up here by itself. JS always
checks every config (tests/lamp_effects_check.mjs). Python checks them all
too while they fit a run; past _ALL_CONFIGS it checks _QUICK_CONFIGS of each
effect, and leaves out the slow replays of a late start with no warmup.
LAMP_EFFECTS_FULL=1 verifies every config in Python whatever the size:

    LAMP_EFFECTS_FULL=1 python -m unittest tests.test_lamp_effects
"""

import glob
import gzip
import json
import os
import random
import runpy
import shutil
import statistics
import subprocess
import threading
import time
import unittest
import zlib
from pathlib import Path

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parent / "custom_components" / "yeelight_cube"
FIXTURE = TESTS / "fixtures" / "lamp_effects.json.gz"
CHECK = TESTS / "lamp_effects_check.mjs"
LAMP = runpy.run_path(str(ROOT / "lamp_renderers.py"))
CORE = runpy.run_path(str(ROOT / "lamp_core.py"))
CONST = runpy.run_path(str(ROOT / "const.py"))
PREVIEW = runpy.run_path(str(ROOT / "native_effect_preview.py"))
# The slots named by number until 1.4.0 (const.py FORMERLY_NUMBERED_SLOTS), and
# every slot's name.
NUMBERED = CONST["FORMERLY_NUMBERED_SLOTS"]
SLOT_NAME = {spec["mode"]: name for name, spec in CONST["ALL_NATIVE_EFFECTS"].items()}
EXEMPT = {"Fireworks"}  # its own older fixtures, its shots seeded per shot
RENDERS = 240
_ALL_CONFIGS = 100
_QUICK_CONFIGS = ("default", "rate255-left")
# Generous: a loaded machine must not fail a build. Reported as measured.
_PYTHON_MEDIAN_MS = 8.0
_JS_MEDIAN_MS = 3.0
_PYTHON_COLD_MS = 150.0
_JS_COLD_MS = 30.0
_IMPORT_MS = 50.0

_fixture = None
_node = None


def fixture():
    global _fixture
    if _fixture is None:
        _fixture = json.loads(gzip.decompress(FIXTURE.read_bytes()))
    return _fixture


def registered():
    """(effect name, key, config, slot) of every config of every slot."""
    for name, effect in fixture()["effects"].items():
        if name not in EXEMPT and effect["mode"] in LAMP["REGISTRY"]:
            for key, config in effect["configs"].items():
                yield name, key, config, LAMP["REGISTRY"][effect["mode"]]


def selected():
    every = list(registered())
    if os.environ.get("LAMP_EFFECTS_FULL"):
        return every
    every = [case for case in every if not (case[2]["firstRender"] and case[3]["warmup"] is None)]
    if len(every) <= _ALL_CONFIGS:
        return every
    return [case for case in every if case[1] in _QUICK_CONFIGS]


def node():
    """What tests/lamp_effects_check.mjs reports."""
    global _node
    if _node is None:
        result = subprocess.run(
            [shutil.which("node"), str(CHECK)], text=True, capture_output=True, cwd=TESTS.parent,
        )
        if not result.stdout.strip():
            raise AssertionError(result.stderr)
        _node = json.loads(result.stdout)
    return _node


def mismatch(name, key, config, render, frame):
    """The first failing render, and the first differing pixel where the
    fixture keeps a frame (renders 0, 1, 2, 50 and 239): the next one kept
    when it does not keep this one."""
    label = f"{name} / {key}: render {render} of {RENDERS}"
    for kept in sorted(int(k) for k in config["frames"]):
        if kept == render:
            wanted = bytes.fromhex(config["frames"][str(kept)])
            for at in range(0, 300, 3):
                if frame[at:at + 3] != wanted[at:at + 3]:
                    return f"{label}, pixel {at // 3}: {tuple(frame[at:at + 3])} != {tuple(wanted[at:at + 3])}"
    return f"{label}: crc {zlib.crc32(frame):08x} != {config['crc'][render]:08x} (no stored frame there)"


def first_failure(name, key, config):
    frames = LAMP["exact_frames"](config["settings"], config["firstRender"], RENDERS)
    for render, frame in enumerate(frames):
        if zlib.crc32(frame) != config["crc"][render]:
            return mismatch(name, key, config, render, frame)
    return None


def tide():
    """A renderer with a warmup: its default and late configs."""
    return fixture()["effects"]["Tide"]["configs"]


class _Counted:
    """A slot that counts its renders."""

    def __init__(self, slot):
        self.calls = 0
        self.slot = {**slot, "step": self.step}
        self.inner = slot["step"]

    def step(self, state, settings, clock_ms, render):
        self.calls += 1
        return self.inner(state, settings, clock_ms, render)


def _history_slot(pause=0.0):
    """No warmup: the frame is the number of renders the state has seen."""

    def step(state, settings, clock_ms, render):
        if pause:
            time.sleep(pause)
        state["seen"] += 1
        return state["seen"].to_bytes(3, "big") * 100

    return {"mode": 1000, "init": lambda settings: {"seen": 0}, "step": step, "warmup": None}


def _seen(frame):
    """_history_slot's number, out of a lamp frame."""
    return int.from_bytes(frame[:3], "big")


class EffectFrameTests(unittest.TestCase):
    def test_something_is_registered(self):
        self.assertGreaterEqual(len(list(registered())), 30)

    def test_every_config_in_python(self):
        for name, key, config, _slot in selected():
            with self.subTest(effect=name, config=key):
                self.assertIsNone(first_failure(name, key, config))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_every_config_in_js(self):
        report = node()
        self.assertEqual([], report["failures"])
        self.assertEqual(len(list(registered())), report["configs"])

    def test_the_entry_point_gives_lamp_order_pixels(self):
        config = tide()["default"]
        pixels = LAMP["renderer_frame"](config["settings"], 50)
        self.assertEqual(100, len(pixels))
        self.assertEqual(config["frames"]["50"], bytes(v for p in pixels for v in p).hex())
        self.assertFalse(LAMP["has_renderer"](10))

    def test_every_family_module_is_registered(self):
        modes = set()
        for path in glob.glob(str(ROOT / "lamp_effects_*.py")):
            module = runpy.run_path(path)
            modes |= {slot["mode"] for slot in module["SLOTS"]}
        self.assertEqual(modes, set(LAMP["REGISTRY"]))

    def test_a_mode_is_registered_once(self):
        slot = next(iter(LAMP["REGISTRY"].values()))
        with self.assertRaises(ValueError):
            LAMP["register_slot"]({**slot})


def describe(settings):
    colours = CORE["effect_colours"](settings)
    return {
        "lampClock": CORE["assumed_apply_clock"](settings["rate"]),
        "clock": CORE["clock_at"](settings["rate"], 1000),
        "direction": CORE["effective_direction"](settings),
        "geometry": list(CORE["effect_geometry"](settings)),
        "words": [list(word) for word in colours["words"]],
        "primary": list(colours["primary"]),
        "secondary": list(colours["secondary"]),
        "count": len(colours["palette"]),
        "table": zlib.crc32(colours["table"]),
    }


def noise_bytes(count, seed):
    """Repeatable bytes, the JS check draws the same."""
    out = bytearray(count)
    for at in range(count):
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        out[at] = (seed >> 16) & 255
    return out


def primitives():
    """A checksum of each primitive over a sweep, against the same in JS."""
    core = CORE
    sums = {}

    def crc(key, values):
        sums[key] = zlib.crc32(bytes(v & 255 for v in values))

    crc("sin8", (core["sin8"](t) for t in range(256)))
    crc("sin16", (v for t in range(0, 65536, 97) for v in (core["sin16_unsigned"](t), core["sin16_unsigned"](t) >> 8)))
    crc("beat", (core["beat"](1000 + 123 * c, core["bpm88"](c % 300 - 20)) for c in range(2000)))
    crc("envelope", (core["envelope_gain"](40 * t, t % 256) for t in range(3000)))
    crc("noise3", (core["inoise8_raw"]((x * 907) & 65535, (x * 311) & 65535, (x * 53) & 65535) for x in range(4000)))
    crc("noise2", (core["inoise8_raw_2d"]((x * 907) & 65535, (x * 311) & 65535) for x in range(4000)))
    crc("source", (v for d in range(1000) for v in core["source_word"](d * 7).to_bytes(4, "big")))
    crc("random", (core["random_source"](d) for d in range(1000)))
    crc("maths", (v for x in range(-300, 300) for v in (core["sx8"](x), core["triangle16"](x * 211), core["lround"](x / 2))))
    crc("convert", (v for r in range(0, 256, 17) for g in range(0, 256, 17) for b in range(0, 256, 17)
                    for v in core["convert_colour"]((r, g, b))))
    crc("hue", (v for h in range(360) for v in core["hue_drive"](h)))
    crc("palettes", (v for s in (0, 8, 12, 13, 14, 32) for m in (39, 34, 15, 41, 45, 42)
                     for v in core["palette_table"](core["native_palette"](s, m))))
    crc("span", (core["palette_span"](c) for c in (2, 4, 5, 8, 16, 18)))
    crc("demo", (
        v for render in range(400)
        for level, onset, tick, bands in (core["demo_sound"](render),)
        for v in (level, onset, tick, *bands)
    ))
    for width, height in ((5, 20), (20, 5)):
        tag = f"{width}x{height}"
        for amount in (8, 64, 128, 200):
            crc(f"fade{tag}{amount}", core["fade_grid"](noise_bytes(300, amount), amount, width, height))
            crc(f"blend{tag}{amount}", core["blend_grid"](noise_bytes(300, amount), amount, width, height, (0, 2, 1)))
            crc(f"blur{tag}{amount}", core["blur_columns"](noise_bytes(300, amount), amount, width, height))
        crc(f"blend255{tag}", core["blend_grid"](noise_bytes(300, 7), 255, width, height, (9, 8, 7)))
        crc(f"rowblur{tag}", core["row_blur_grid"](noise_bytes(300, 9), width, height))
    turned = [(cell * 37) % 100 for cell in range(100)]
    crc("fadeindex", core["fade_grid"](noise_bytes(300, 3), 64, 5, 20, turned))
    crc("blendindex", core["blend_grid"](noise_bytes(300, 3), 128, 5, 20, (0, 2, 1), turned))
    crc("blurindex", core["blur_columns"](noise_bytes(300, 3), 16, 5, 20, turned))
    crc("rowblurindex", core["row_blur_grid"](noise_bytes(300, 3), 5, 20, turned))
    for amount in (0, 64, 212, 251, 254, 255):
        crc(f"towards{amount}", core["fade_towards"](noise_bytes(300, 5), amount, 0x204060))
        crc(f"stripblur{amount}", core["strip_blur"](noise_bytes(300, 5), amount))
    for direction in range(4):
        crc(f"place{direction}", core["place_strip"](noise_bytes(300, 11), direction))
        crc(f"readback{direction}", core["read_back"](noise_bytes(300, 11), direction))
        crc(f"frame{direction}", core["panel_to_frame"](noise_bytes(300, 13 + direction)))
    crc("flags", (core["read_back_flags"](m, d, x) for m in (0, 46, 51) for d in range(4) for x in (0, 1)))
    crc("flagsindex", (core["flags_index"](p, 100, f) for f in (0x05, 0x45, 0x55, 0x15, 0x47, 0x57) for p in range(100)))
    crc("targets", (v for m in range(4) for f in (0x05, 0x0d, 0x07, 0x47, 0x45, 0x15, 0x17, 0x57)
                    for p in range(100) for v in [len(core["flagged_targets"](p, 100, m, f))]
                    + core["flagged_targets"](p, 100, m, f)))
    return sums


@unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
class MirrorTests(unittest.TestCase):
    def test_registered_settings_agree(self):
        # The slots, then what the core gives every command the fixture has,
        # registered or not: the next renderers stand on it.
        self.assertEqual(
            sorted(([mode, slot["warmup"]] for mode, slot in LAMP["REGISTRY"].items())),
            node()["registry"],
        )
        expected = {
            f"{name}/{key}": describe(config["settings"])
            for name, effect in fixture()["effects"].items()
            for key, config in effect["configs"].items()
        }
        self.assertEqual(expected, node()["settings"])

    def test_the_primitives_agree(self):
        self.assertEqual(primitives(), node()["primitives"])

    def test_the_js_families_are_the_python_ones(self):
        names = {Path(path).stem[len("lamp_effects_"):] for path in glob.glob(str(ROOT / "lamp_effects_*.py"))}
        scripts = {
            Path(path).stem[len("lamp-effects-"):]
            for path in glob.glob(str(ROOT / "www" / "lamp-effects-*.js"))
        }
        self.assertEqual(names, scripts)

    def test_the_js_timeline(self):
        self.assertEqual([], node()["timelineFailures"])


class TimelineTests(unittest.TestCase):
    def timeline(self, config, slot=None):
        settings = config["settings"]
        return LAMP["Timeline"](slot or LAMP["REGISTRY"][settings["mode"]], settings)

    def crcs(self, timeline, renders):
        return [zlib.crc32(timeline.frame_at(render)) for render in renders]

    def test_seek_back(self):
        config = tide()["default"]
        timeline = self.timeline(config)
        self.assertEqual(config["crc"], self.crcs(timeline, range(RENDERS)))
        for render in (5, 239, 0, 120):  # in the ring
            self.assertEqual(config["crc"][render], zlib.crc32(timeline.frame_at(render)))
        beyond = [timeline.frame_at(render) for render in range(RENDERS, 700)]
        self.assertIsNotNone(beyond[-1])
        for render in (239, 10, 200):  # out of it: rebuilt
            self.assertEqual(config["crc"][render], zlib.crc32(timeline.frame_at(render)))

    def test_a_warmup_stays_out_of_the_ring(self):
        config = tide()["default"]
        timeline = self.timeline(config)
        timeline.frame_at(230)  # warmed up from render 152
        self.assertEqual([230], list(timeline.frames))
        self.assertEqual(config["crc"][231], zlib.crc32(timeline.frame_at(231)))
        for render in (229, 100, 60):  # behind it, not its warmup's frames
            self.assertEqual(config["crc"][render], zlib.crc32(timeline.frame_at(render)))

    def test_seek_far_ahead(self):
        for effect in ("Rainbow", "Tide", "Magic"):
            config = fixture()["effects"][effect]["configs"]["late"]
            timeline = self.timeline(config)
            first = config["firstRender"]
            self.assertEqual(
                config["crc"], self.crcs(timeline, range(first, first + RENDERS)), effect,
            )

    def test_every_slot_seeks_far_ahead_to_the_same_frames(self):
        for name, key, config, slot in registered():
            if key == "late" and slot["warmup"] is not None:
                render = config["firstRender"] + 100
                timeline = self.timeline(config)
                self.assertEqual(config["crc"][100], zlib.crc32(timeline.frame_at(render, exact=True)), name)

    def test_two_clocks_alternating_do_not_replay(self):
        config = tide()["default"]
        counted = _Counted(LAMP["REGISTRY"][config["settings"]["mode"]])
        timeline = self.timeline(config, counted.slot)
        for render in range(20, 220):
            self.assertEqual(config["crc"][render + 19], zlib.crc32(timeline.frame_at(render + 19)))
            self.assertEqual(config["crc"][render], zlib.crc32(timeline.frame_at(render)))
        self.assertEqual(238, max(timeline.frames))
        self.assertLessEqual(counted.calls, 239)

    def test_three_clocks_alternating(self):
        config = tide()["default"]
        settings = config["settings"]
        wanted = {
            start: [zlib.crc32(f) for f in LAMP["exact_frames"](settings, start, 60)]
            for start in (300, 1300, 2300)
        }
        counted = _Counted(LAMP["REGISTRY"][settings["mode"]])
        timeline = self.timeline(config, counted.slot)
        for offset in range(60):
            for start in wanted:
                self.assertEqual(wanted[start][offset], zlib.crc32(timeline.frame_at(start + offset)))
        self.assertEqual(3, len(timeline.cursors))
        self.assertLessEqual(counted.calls, 3 * (60 + LAMP["REGISTRY"][settings["mode"]]["warmup"]))

    def test_the_ring_and_the_cursors_are_bound(self):
        config = tide()["default"]
        timeline = self.timeline(config)
        for jump in range(40):
            timeline.frame_at(jump * 1000)
            self.assertLessEqual(len(timeline.cursors), 6)
            self.assertLessEqual(len(timeline.frames), 256)
        for render in range(40000, 40600):
            timeline.frame_at(render)
        self.assertEqual(256, len(timeline.frames))

    def test_the_timelines_are_bound(self):
        base = tide()["default"]["settings"]
        for rate in range(1, 30):
            LAMP["renderer_frame"]({**base, "rate": rate}, 0)
        self.assertLessEqual(len(LAMP["_EFFECT_TIMELINES"]), 8)

    def test_no_warmup_replays_near_and_jumps_far(self):
        config = tide()["default"]
        slot = _history_slot()
        timeline = self.timeline(config, slot)
        self.assertEqual(1501, _seen(timeline.frame_at(1500, exact=True)))  # from 0
        self.assertEqual(1901, _seen(timeline.frame_at(1900, exact=True)))  # a cursor goes on
        far = self.timeline(config, slot)
        self.assertEqual(2001, _seen(far.frame_at(9000, exact=True)))  # fresh, 2000 back
        self.assertEqual(3001, _seen(far.frame_at(10000, exact=True)))  # the run goes on from there

    def test_a_replay_never_stalls(self):
        config = tide()["default"]
        timeline = self.timeline(config, _history_slot(pause=0.002))
        began = time.perf_counter()
        frame = timeline.frame_at(1900)
        self.assertLess(time.perf_counter() - began, 0.5)
        reached = _seen(frame)
        self.assertLess(reached, 1901)
        self.assertGreater(_seen(timeline.frame_at(1900)), reached)  # it catches up

    def test_threads_read_one_timeline(self):
        config = tide()["default"]
        timeline = self.timeline(config)
        errors = []

        def reader(seed):
            pick = random.Random(seed)
            for _ in range(400):
                render = pick.randrange(RENDERS)
                if zlib.crc32(timeline.frame_at(render, exact=True)) != config["crc"][render]:
                    errors.append(render)

        threads = [threading.Thread(target=reader, args=(seed,)) for seed in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual([], errors)

    def test_cold_start(self):
        worst = {}
        seen = set()
        for name, _key, config, _slot in registered():
            if name in seen:
                continue
            seen.add(name)
            times = []
            for target in (0, 1000, 5000, 7600, 90000):
                # Best of three fresh timelines: a GC pause or a descheduled
                # CI runner stalls one call, a slow renderer all of them.
                attempts = []
                for _ in range(3):
                    timeline = self.timeline(config)
                    began = time.perf_counter()
                    timeline.frame_at(target)
                    attempts.append((time.perf_counter() - began) * 1000)
                times.append(min(attempts))
            worst[name] = max(times)
        print("\nPython cold frame_at, worst ms:", {k: round(v, 1) for k, v in worst.items()})
        self.assertLess(max(worst.values()), 2 * _PYTHON_COLD_MS, worst)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_js_cold_start(self):
        worst = node()["cold"]
        print("\nJS cold frameAt, worst ms:", {k: round(v, 1) for k, v in worst.items()})
        self.assertLess(max(worst.values()), 2 * _JS_COLD_MS, worst)


class PerformanceTests(unittest.TestCase):
    def test_python_budget(self):
        medians = {}
        for name, key, config, slot in registered():
            if key != "default":
                continue
            frames = LAMP["exact_frames"](config["settings"], 0, RENDERS)
            times = []
            while True:
                began = time.perf_counter()
                if next(frames, None) is None:
                    break
                times.append((time.perf_counter() - began) * 1000)
            medians[name] = statistics.median(times)
        print("\nPython median ms per render:", {k: round(v, 3) for k, v in medians.items()})
        self.assertLess(max(medians.values()), _PYTHON_MEDIAN_MS, medians)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_js_budget(self):
        medians = node()["medians"]
        print("\nJS median ms per render:", {k: round(v, 3) for k, v in medians.items()})
        self.assertLess(max(medians.values()), _JS_MEDIAN_MS, medians)

    def test_import_time(self):
        script = (
            "import sys, time; sys.path.insert(0, sys.argv[1]);"
            "t = time.perf_counter(); import lamp_renderers;"
            "print((time.perf_counter() - t) * 1000)"
        )
        times = []
        for _ in range(3):
            result = subprocess.run(
                [shutil.which("python") or "python", "-c", script, str(ROOT)],
                text=True, capture_output=True, check=True,
            )
            times.append(float(result.stdout))
        print(f"\nPython import: {min(times):.1f} ms")
        self.assertLess(min(times), _IMPORT_MS)


class SlotInterfaceTests(unittest.TestCase):
    def test_a_slot_has_the_interface(self):
        for slot in LAMP["REGISTRY"].values():
            self.assertEqual({"mode", "init", "step", "warmup"}, set(slot) - {"lit"})
            self.assertGreaterEqual(slot.get("lit", 1), 1)
            warmup = slot["warmup"]
            self.assertTrue(warmup is None or (isinstance(warmup, int) and warmup >= 0))


# A config's choices: label, speed, color.
_COMMANDS = {
    "default": ("Right", 50),
    "rate128-up": ("Up", 128),
    "rate255-left": ("Left", 255),
    "rate1-down": ("Down", 1),
    "late": ("Right", 50),
    "clock": ("Right", 50),
    "override": ("Right", 50, [255, 80, 20]),
}
_CLOCK_COMMANDS = {
    "rainbow": ("Rainbow", 50),
    "rainbow-fast": ("Rainbow", 200),
    "ocean": ("Waves", 50),
    "aurora": ("Aurora", 50),
    "waterfall": ("Waterfall", 128),
    "rainbow-color": ("Rainbow", 50, (255, 80, 20)),
    "rainbow-vivid": ("Rainbow", 50, None, "red_blue"),
    "tide-bw": ("Tide", 50, None, "bw"),
    "spectrum": ("Spectrum", 50),
    "spectrum-fast": ("Spectrum", 200),
    "bands": ("Palette stripes", 200),
    # The formerly numbered slots: as they are, under B&W and Vivid.
    **{
        f"bare-{spec['mode']}{suffix}": (name, 128, *command)
        for name, spec in CONST["ALL_NATIVE_EFFECTS"].items()
        if spec["mode"] in NUMBERED and spec["mode"] != CONST["LAMP_STORED_GIF_SLOT"]
        for suffix, command in (("", ()), ("-bw", (None, "bw")), ("-vivid", (None, "red_blue")))
    },
    # A slot that draws its colour words: the clock's color replaces the first.
    **{
        f"colours-{mode}-custom": (SLOT_NAME[mode], 128, (255, 80, 20))
        for mode in CONST["_EXTENDED_EFFECT_COLORS"]
    },
}


# Slot 27 fades what the display holds, and the colon's blink blacks these two
# pixels: on the lamp they come back one fade behind. A preview draws the
# background apart from the overlay, so it can't see that.
_CLOCK_READ_BACK = {
    (f"bare-27{suffix}", pixel) for suffix in ("", "-bw", "-vivid") for pixel in (29, 69)
}


def command_of(key):
    command = _COMMANDS.get(key)
    return command if command else ("Right", 50, None, key.removeprefix("palette-"))


class WhatTheLampRunsTests(unittest.TestCase):
    """lamp_settings against the commands of the fixture, the previews on
    it and, for a clock, the lamp's mode 40."""

    def test_settings_are_every_config_of_the_fixture(self):
        for name, effect in fixture()["effects"].items():
            for key, config in effect["configs"].items():
                with self.subTest(effect=name, config=key):
                    settings = LAMP["lamp_settings"](name, *command_of(key))
                    if key == "clock":  # the fixture's only change: the direction
                        settings["direction"] = LAMP["CLOCK_BACKGROUND_DIRECTION"]
                    self.assertEqual(config["settings"], settings)

    def test_the_js_settings_are_too(self):
        self.assertEqual([], node()["settingsFailures"][:5])

    def test_a_palette_or_color_the_lamp_ignores_changes_nothing(self):
        plain = LAMP["lamp_settings"]("Waves", "Up", 50)
        self.assertEqual(plain, LAMP["lamp_settings"]("Waves", "Up", 50, None, "red_blue"))
        magic = LAMP["lamp_settings"]("Magic", "Up", 50)
        self.assertEqual(magic, LAMP["lamp_settings"]("Magic", "Up", 50, [1, 2, 3]))
        self.assertEqual(magic, LAMP["lamp_settings"]("Magic", "Left", 50))

    def test_rates_are_the_lamps(self):
        settings = LAMP["lamp_settings"]
        self.assertEqual(255, settings("Rainbow", "Up", 255)["rate"])
        # Spectrum and Palette stripes are sent none: their row's, whatever the slider.
        for name in ("Spectrum", "Palette stripes"):
            self.assertEqual(settings(name, "Up", 1), settings(name, "Up", 255))

    def test_the_js_table_is_const_py(self):
        tables = node()["tables"]
        const = LAMP["ALL_NATIVE_EFFECTS"]
        expected = {}
        for name, spec in const.items():
            if spec["mode"] == CONST["LAMP_STORED_GIF_SLOT"]:
                continue
            row = {"mode": spec["mode"], "effectId": spec["effect_id"]}
            if spec.get("speed"):
                row["speed"] = True
            if spec.get("intensity"):
                row["intensity"] = True
            if spec.get("directions"):
                row["directions"] = list(spec["directions"])
            if spec.get("direction_remap"):
                row["remap"] = spec["direction_remap"]
            if spec.get("color") is not None:
                row["color"] = spec["color"]
            if spec.get("colors"):
                row["colors"] = list(spec["colors"])
            expected[name] = row
        self.assertEqual(expected, tables["effects"])
        self.assertEqual(
            {str(key): list(value) for key, value in LAMP["PRESET_ROWS"].items()},
            tables["rows"],
        )
        self.assertEqual(
            {key: value for key, value in LAMP["CLOCK_COLOR_MODES"].items() if value},
            tables["colorModes"],
        )
        self.assertEqual(
            {str(key): value for key, value in LAMP["CLOCK_MIXER_COMMAND_IDS"].items()},
            tables["clockCommands"],
        )
        self.assertEqual(LAMP["NATIVE_CLOCK_EFFECT_ID"], tables["clockId"])
        self.assertEqual(
            {str(key): value for key, value in CONST["LAMP_RATE_LIMITS"].items()},
            tables["rateLimits"],
        )
        self.assertEqual(CONST["NATIVE_EFFECT_DIRECTION_VALUES"], tables["directions"])
        self.assertEqual(sorted(CONST["LAMP_INTENSITY_SLOTS"]), tables["intensitySlots"])
        self.assertEqual(
            {str(key): value for key, value in CONST["LAMP_INTENSITY_MINIMUMS"].items()},
            tables["intensityMinimums"],
        )
        self.assertEqual(CONST["DEFAULT_NATIVE_EFFECT_INTENSITY"], tables["intensityDefault"])
        self.assertEqual(
            dict(zip(("min", "max"), CONST["INTENSITY_RANGE"])), tables["intensityRange"]
        )
        for name, drawn in tables["intensities"].items():
            intensities = [
                [
                    LAMP["lamp_settings"](name, "Right", 50, None, None, None, chosen)["intensity"],
                    LAMP["lamp_clock_settings"](name, 50, None, None, chosen)["intensity"],
                ]
                for chosen in (1, 5, 200, 255)
            ]
            self.assertEqual(intensities, drawn, name)
        self.assertEqual(sorted(LAMP["_COLOR_OVERRIDE_EFFECTS"]), tables["override"])
        self.assertEqual(sorted(LAMP["_COLOR_MODE_BW_EFFECTS"]), tables["bw"])
        modes = ("bw", "red_blue", "white_orange", "blue_yellow", "purple_orange", "normal")
        self.assertEqual(
            {
                name: [mode for mode in modes if LAMP["effect_supports_color_mode"](name, mode)]
                for name in expected
            },
            tables["supports"],
        )

    def test_every_effect_but_the_stored_gif_is_lamp_rendered(self):
        drawn = {
            name for name, spec in LAMP["ALL_NATIVE_EFFECTS"].items()
            if spec["mode"] != CONST["LAMP_STORED_GIF_SLOT"]
        }
        self.assertEqual(70, len(drawn))
        self.assertEqual(drawn, set(LAMP["LAMP_RENDERED_EFFECTS"]))
        self.assertEqual(drawn - EXEMPT, {
            name for name, effect in fixture()["effects"].items() if name not in EXEMPT
        })
        self.assertEqual(
            sorted(LAMP["LAMP_RENDERED_EFFECTS"]), sorted(node()["tables"]["effects"])
        )

    def test_a_preview_is_the_fixtures_frame(self):
        preview = PREVIEW["render_native_effect"]
        timelines = preview.__globals__["lamp_settings"].__globals__  # the preview's timelines
        for name, effect in fixture()["effects"].items():
            if name in EXEMPT:
                continue
            for key, config in effect["configs"].items():
                if key == "clock" or config["firstRender"]:
                    continue
                label, speed, *rest = command_of(key)
                override = rest[0] if rest else None
                mode = rest[1] if len(rest) > 1 else None
                settings = timelines["lamp_settings"](name, label, speed, override, mode)
                first = timelines["timeline_for"](settings).first_shown()
                for render in sorted(config["frames"], key=int):
                    if int(render) < first:
                        continue
                    # Computed ahead: a replay's time limit is the timeline's test.
                    timelines["timeline_for"](settings).frame_at(int(render), True)
                    phase = (int(render) - first + 0.5) * 0.04 * (0.25 + speed / 55.0)
                    frame = preview(name, phase, label, override, mode, speed)
                    with self.subTest(effect=name, config=key, render=render):
                        self.assertEqual(
                            config["frames"][render], bytes(sum(frame, ())).hex()
                        )

    def test_a_preview_never_starts_blank_and_a_lit_one_never_starts_late(self):
        for speed in (1, 50, 128, 255):
            for name in LAMP["LAMP_RENDERED_EFFECTS"] - EXEMPT:
                settings = LAMP["lamp_settings"](name, "Right", speed)
                timeline = LAMP["timeline_for"](settings)
                first = timeline.first_shown()
                with self.subTest(effect=name, speed=speed):
                    if any(timeline.frame_at(0, True)):
                        self.assertEqual(0, first)
                    else:
                        self.assertIn(
                            name, {"Building Blocks", "Particle glows", "Mirrored comets", "Sunrise and sunset"} | {SLOT_NAME[slot] for slot in (21, 31, 62, 63)}
                        )
                    self.assertTrue(any(map(any, LAMP["lamp_effect_frame"](settings, 0.0))))
                    # A sparse slot's "lit": finding the start must not replay for long.
                    if CONST["ALL_NATIVE_EFFECTS"][name]["mode"] in NUMBERED:
                        self.assertLess(first, 300)
        # In the JS port the same.
        self.assertEqual(
            {
                f"{name}/{speed}": LAMP["timeline_for"](
                    LAMP["lamp_settings"](name, "Right", speed)
                ).first_shown()
                for speed in (1, 50, 128, 255)
                for name in LAMP["LAMP_RENDERED_EFFECTS"] - EXEMPT
            },
            node()["firstShown"],
        )

    def test_no_color_key_leaves_all_four_words_white(self):
        white = CORE["convert_colour"]((255, 255, 255))
        for mode in (2, 7, 14):
            settings = LAMP["lamp_settings"](SLOT_NAME[mode], "Up", 128)
            self.assertEqual([white] * 4, list(CORE["effect_colours"](settings)["words"]))

    def test_the_slots_that_draw_their_words_get_them(self):
        # The lamp's defaults (const._EXTENDED_EFFECT_COLORS), the rest black.
        convert, black = CORE["convert_colour"], (0, 0, 0)
        for mode, colors in CONST["_EXTENDED_EFFECT_COLORS"].items():
            rgb = [(w >> 16 & 255, w >> 8 & 255, w & 255) for w in colors]
            words = list(CORE["effect_colours"](
                LAMP["lamp_settings"](SLOT_NAME[mode], "Up", 128))["words"])
            self.assertEqual([convert(c) for c in rgb] + [black] * (4 - len(rgb)), words, mode)
            # A picked colour replaces the first only.
            words = list(CORE["effect_colours"](
                LAMP["lamp_settings"](SLOT_NAME[mode], "Up", 128, [9, 200, 30]))["words"])
            self.assertEqual(
                [convert((9, 200, 30))] + [convert(c) for c in rgb[1:]] + [black] * (4 - len(rgb)),
                words, mode,
            )

    def test_the_stored_gif_is_not_drawn_as_if_it_were_known(self):
        self.assertNotIn("Stored GIF", LAMP["LAMP_RENDERED_EFFECTS"])
        self.assertEqual(100, len(PREVIEW["render_native_effect"]("Stored GIF", 1.0)))

    def test_a_clock_on_a_formerly_numbered_slot_takes_the_palette_as_any(self):
        settings = LAMP["lamp_clock_settings"]
        for name in (SLOT_NAME[14], "Rainbow"):
            plain = settings(name, 128)
            self.assertNotEqual(plain, settings(name, 128, None, "red_blue"), name)
            self.assertNotEqual(plain, settings(name, 128, None, "bw"), name)
            self.assertFalse(settings(name, 128, (9, 8, 7), "red_blue")["coloured"], name)
            self.assertTrue(settings(name, 128, (9, 8, 7))["coloured"], name)

    def test_a_cursor_reaches_as_far_as_a_warmup_starts_behind(self):
        slot = LAMP["REGISTRY"][51]
        self.assertGreater(slot["warmup"], LAMP["_CURSOR_REACH"])
        timeline = LAMP["Timeline"](slot, LAMP["lamp_settings"](SLOT_NAME[51], "Up", 128))
        cursor = timeline._cursor_for(5000)
        self.assertIs(cursor, timeline._cursor_for(5000))

    def test_a_clock_preview_draws_every_background_but_the_stored_gif(self):
        mixers = CONST["CLOCK_MIXER_EFFECTS"]
        self.assertEqual(32, len(set(mixers) & NUMBERED))
        self.assertNotIn(CONST["LAMP_STORED_GIF_SLOT"], mixers)
        self.assertLessEqual(set(mixers.values()) - EXEMPT, LAMP["LAMP_RENDERED_EFFECTS"])

    def test_a_card_preview_is_too(self):
        self.assertEqual([], node()["previewFailures"][:5])

    def test_a_clock_background_is_the_lamps_mode_40(self):
        for key, clock in fixture()["clock"].items():
            settings = LAMP["lamp_clock_settings"](*_CLOCK_COMMANDS[key])
            self.assertEqual(LAMP["ALL_NATIVE_EFFECTS"][_CLOCK_COMMANDS[key][0]]["mode"], clock["mixer"])
            frames = list(LAMP["exact_frames"](settings, 0, 61))
            lit = 0
            for render, text in clock["frames"].items():
                reference = bytes.fromhex(text)
                ours = frames[int(render)]
                for at in range(0, 300, 3):
                    if any(reference[at:at + 3]) and (key, at // 3) not in _CLOCK_READ_BACK:
                        lit += 1
                        with self.subTest(clock=key, render=render, pixel=at // 3):
                            self.assertEqual(reference[at:at + 3], ours[at:at + 3])
            # A slot with no name may be sparse: the digits can miss its dots.
            if not key.startswith("bare-"):
                self.assertGreater(lit, 50, key)

    def test_a_clock_over_a_colour_word_slot_is_checked_coloured(self):
        # Slots 1, 8, 28, 33 and 72 draw their colour words: the clock sends
        # them all (const.clock_style_colors), with the clock's color first,
        # none under B&W; each form is a fixture run the previews must match.
        clocks = fixture()["clock"]
        settings = LAMP["lamp_clock_settings"]
        for mode, words in CONST["_EXTENDED_EFFECT_COLORS"].items():
            name = SLOT_NAME[mode]
            for key in (f"bare-{mode}", f"colours-{mode}-custom", f"bare-{mode}-bw", f"bare-{mode}-vivid"):
                self.assertIn(key, clocks)
            rgb = [[w >> 16 & 255, w >> 8 & 255, w & 255] for w in words]
            plain = settings(name, 128)
            self.assertTrue(plain["coloured"], name)
            self.assertEqual(rgb[0], plain["primary"])
            self.assertEqual(rgb if len(rgb) > 1 else None, plain.get("colours"))
            custom = settings(name, 128, (255, 80, 20))
            self.assertEqual([255, 80, 20], custom["primary"])
            if len(rgb) > 1:
                self.assertEqual([[255, 80, 20], *rgb[1:]], custom["colours"])
            # A palette is not sent to these slots: it would only drop their
            # colors.
            self.assertEqual(custom, settings(name, 128, (255, 80, 20), "red_blue"))
            self.assertFalse(settings(name, 128, (255, 80, 20), "bw")["coloured"])

    def test_the_js_clock_background_is_too(self):
        self.assertEqual([], node()["clockFailures"][:5])

    def test_a_clock_takes_what_light_native_sends(self):
        settings = LAMP["lamp_clock_settings"]
        # The row of the command id: 40, 71 for Fireworks, a palette's.
        self.assertEqual(0, settings("Rainbow", 50)["selector"])
        self.assertEqual(14, settings("Fireworks", 50)["selector"])
        self.assertEqual(0, settings("Fireworks", 50)["intensity"])
        self.assertEqual(12, settings("Rainbow", 50, None, "red_blue")["selector"])
        self.assertEqual(8, settings("Rainbow", 50, None, "bw")["selector"])
        # The default color, unless a palette drops it, or a color replaces it.
        self.assertEqual([0, 255, 0], settings("Aurora", 50)["primary"])
        self.assertFalse(settings("Aurora", 50, None, "bw")["coloured"])
        self.assertEqual([9, 8, 7], settings("Aurora", 50, (9, 8, 7))["primary"])
        # Sent to every mixer, unlike a native effect's.
        self.assertTrue(settings("Magic", 50, (9, 8, 7))["coloured"])
        self.assertEqual(200, settings("Rainbow", 200)["rate"])

    def test_a_full_dashboard_does_not_thrash_the_timelines(self):
        kept, total = node()["keptTimelines"]
        self.assertEqual(total, kept)


if __name__ == "__main__":
    unittest.main()
