"""An effect's direction and the lamp's mount are two settings: a direction is what
the viewer sees, on any mount (effect_catalog.MOUNT_DIRECTION_VALUES). Checked on the
lamp's own pixel placement, in both languages, end to end down to the value
sent."""
import json
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace

from ha_stubs import import_pure_module

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "yeelight_cube"
CONST = import_pure_module("const")
CATALOG = import_pure_module("effect_catalog")
CORE = import_pure_module("lamp_core")
LAMP = import_pure_module("lamp_renderers")
PROFILE = import_pure_module("mount_profile")

EFFECTS = CATALOG.ALL_NATIVE_EFFECTS
DIRECTED = {name: spec for name, spec in EFFECTS.items() if spec.get("directions")}
MOUNTS = CONST.DEVICE_ORIENTATIONS
value_of = CATALOG.effect_direction_value


def _position(value: int, logical: int) -> tuple:
    """Where a logical pixel lands on the panel: (x, y), y up."""
    strip = bytearray(3 * CORE.LENGTH)
    strip[3 * logical] = 255
    frame = CORE.place_strip(strip, value, CORE.REFERENCE_PROFILE)
    index = CORE.frame_index(frame.index(255) // 3)
    return index % CORE.COLS, index // CORE.COLS


def panel_flow(value: int) -> tuple:
    """The way the logical rows run on the panel for a lamp direction."""
    width, _ = CORE.segment_geometry(
        CORE.LENGTH, CORE.DIRECTION_TABLE[CORE.REFERENCE_PROFILE][value]
    )
    x0, y0 = _position(value, 0)
    x1, y1 = _position(value, width)
    return (x1 > x0) - (x1 < x0), (y1 > y0) - (y1 < y0)


def viewer_flow(value: int, mount: str) -> tuple:
    """That flow for a viewer of a lamp mounted so (MOUNT_QUARTER_TURNS clockwise)."""
    x, y = panel_flow(value)
    for _ in range(PROFILE.MOUNT_QUARTER_TURNS[mount]):
        x, y = y, -x
    return x, y


class MountTurnTests(unittest.TestCase):
    def test_every_mount_keeps_the_flow_the_default_mount_shows(self):
        for mount, values in CATALOG.MOUNT_DIRECTION_VALUES.items():
            self.assertEqual([0, 1, 2, 3], sorted(values), mount)
            for value, sent in enumerate(values):
                self.assertEqual(viewer_flow(value, "right"), viewer_flow(sent, mount), (mount, value))

    def test_the_default_mount_sends_each_effects_calibrated_value(self):
        values = CATALOG.NATIVE_EFFECT_DIRECTION_VALUES
        for name, spec in DIRECTED.items():
            remap = spec.get("direction_remap", {})
            for label in spec["directions"]:
                expected = values[remap.get(label, label)]
                self.assertEqual(expected, value_of(spec, label, "right"), name)
                self.assertEqual(expected, value_of(spec, label), name)

    def test_what_a_lamp_ran_before_and_what_the_split_corrected(self):
        # While the mount chose the direction, a lamp sent the mount's label. On
        # effects with the swap that was the turn itself: nothing changes.
        for name, spec in DIRECTED.items():
            if len(spec["directions"]) < 4:
                continue
            before = {mount: value_of(spec, mount.capitalize()) for mount in MOUNTS}
            after = {mount: value_of(spec, "Right", mount) for mount in MOUNTS}
            changed = {mount for mount in MOUNTS if before[mount] != after[mount]}
            if spec.get("direction_remap") == CATALOG._SWAP_UP_DOWN:
                self.assertEqual(set(), changed, name)
            else:
                # The others ran backwards on a lamp on its end: only those change.
                self.assertEqual({"down", "up"}, changed, name)

    def test_every_effect_flows_the_same_for_the_viewer_on_every_mount(self):
        for name, spec in DIRECTED.items():
            if len(spec["directions"]) < 4:
                continue
            for label in spec["directions"]:
                seen = viewer_flow(value_of(spec, label), "right")
                for mount in MOUNTS:
                    self.assertEqual(seen, viewer_flow(value_of(spec, label, mount), mount), (name, label, mount))

    def test_an_effect_on_one_axis_keeps_to_it(self):
        spec = EFFECTS["Hacking"]
        for label in spec["directions"]:
            for mount in MOUNTS:
                self.assertIn(value_of(spec, label, mount), (0, 1), (label, mount))
        # A half turn stays on the axis, so it still turns.
        self.assertEqual(value_of(spec, "Down"), value_of(spec, "Up", "left"))
        # A quarter turn does not: its own direction.
        self.assertEqual(value_of(spec, "Up"), value_of(spec, "Up", "down"))


def _restored(attributes):
    """The direction a lamp comes back with, from its saved attributes."""
    source = (ROOT / "light_restore.py").read_text(encoding="utf-8")
    start = source.index("        # Saved when an effect's direction was the mount's")
    block = source[start:source.index("        # The 4-way physical device orientation", start)]
    lamp = SimpleNamespace(
        _native_effect_direction=attributes.get("native_effect_direction"), _button_effects=[],
    )
    exec("def run(self, attributes):\n" + block, namespace := {**vars(CONST), **vars(CATALOG)})
    namespace["run"](lamp, attributes)
    return lamp._native_effect_direction


def _sent(direction, mount, effect="Rainbow", profile=2):
    native = _native_functions()
    light = SimpleNamespace(
        _native_effect_direction=direction, _device_orientation=mount, effect_profile=profile,
    )
    return native["effect_direction_sent"](light, EFFECTS[effect]), light


_NATIVE = None


def _native_functions():
    global _NATIVE
    if _NATIVE is None:
        from test_native_features import _load_standalone_functions

        _NATIVE = _load_standalone_functions(
            (ROOT / "light_native.py").read_text(encoding="utf-8"),
            {"effect_direction_sent", "lamp_direction", "label_direction"},
            {
                "effect_direction_value": value_of,
                "UNDIRECTED_EFFECT_DIRECTION": CATALOG.UNDIRECTED_EFFECT_DIRECTION,
                "compensate_direction": PROFILE.compensate_direction,
                "one_axis_direction": PROFILE.one_axis_direction,
                "HIGH_PAIR": PROFILE.HIGH_PAIR,
                "LOW_PAIR": PROFILE.LOW_PAIR,
            },
        )
    return _NATIVE


class SentTests(unittest.TestCase):
    def test_the_value_sent_is_turned_then_compensated(self):
        spec = EFFECTS["Rainbow"]
        for direction in spec["directions"]:
            for mount in MOUNTS:
                for profile in range(4):
                    self.assertEqual(
                        PROFILE.compensate_direction(value_of(spec, direction, mount), profile),
                        _sent(direction, mount, profile=profile)[0],
                    )

    def test_a_direction_an_effect_lacks_stays_chosen_for_the_next(self):
        sent, light = _sent("Right", "right", "Hacking")
        self.assertEqual(_sent("Up", "right", "Hacking")[0], sent)
        self.assertEqual("Right", light._native_effect_direction)

    def test_an_effect_with_no_direction_ignores_both(self):
        self.assertEqual(
            _sent("Up", "right", "Bouncing Ball")[0], _sent("Left", "down", "Bouncing Ball")[0]
        )

    def test_nothing_writes_the_mount_from_a_direction(self):
        select = (ROOT / "select.py").read_text(encoding="utf-8")
        start = select.index("class YeelightCubeNativeEffectDirectionSelect")
        self.assertNotIn("_orientation", select[start:])

    def test_a_mount_does_not_write_the_direction(self):
        light = (ROOT / "light_settings.py").read_text(encoding="utf-8")
        start = light.index("async def set_device_orientation")
        self.assertNotIn(
            "_native_effect_direction", light[start:light.index("def alignment", start)]
        )

    def test_a_saved_direction_from_when_it_was_the_mount_means_the_default(self):
        self.assertEqual("Right", CATALOG.DEFAULT_NATIVE_EFFECT_DIRECTION)
        self.assertEqual("Right", _restored({"native_effect_direction": "Down"}))
        self.assertEqual("Right", _restored({}))
        self.assertEqual(
            "Down", _restored({"native_effect_direction": "Down", "effect_direction_own": True})
        )
        self.assertIn(
            '"effect_direction_own": True', (ROOT / "light_attributes.py").read_text(encoding="utf-8")
        )

    def test_the_action_takes_a_direction(self):
        source = (ROOT / "light_services_native.py").read_text(encoding="utf-8")
        self.assertIn('vol.Optional("direction"): vol.In(list(NATIVE_EFFECT_DIRECTIONS))', source)
        self.assertIn("no_direction", (ROOT / "strings.json").read_text(encoding="utf-8"))


class PreviewTests(unittest.TestCase):
    def test_a_preview_draws_the_value_sent(self):
        for name, spec in DIRECTED.items():
            if spec["mode"] == CATALOG.LAMP_STORED_GIF_SLOT:
                continue
            for label in spec["directions"]:
                for mount in MOUNTS:
                    settings = LAMP.lamp_settings(name, label, 128, None, None, mount)
                    sent = _sent(label, mount, name)[0]  # on the calibration's profile
                    self.assertEqual(sent, settings["direction"], (name, label, mount))

    def test_a_clock_background_is_not_turned(self):
        self.assertEqual(
            LAMP.CLOCK_BACKGROUND_DIRECTION,
            LAMP.lamp_clock_settings("Rainbow", 128)["direction"],
        )

    def test_the_cards_turn_it_the_same_way(self):
        cases = [
            [name, label, mount]
            for name, spec in DIRECTED.items()
            if spec["mode"] != CATALOG.LAMP_STORED_GIF_SLOT
            for label in (*spec["directions"], "Left")
            for mount in (*MOUNTS, None)
        ]
        module = (ROOT / "www" / "lamp-renderers.js").as_uri()
        script = (
            f"import {{lampSettings}} from {json.dumps(module)};"
            "import {readFileSync} from 'node:fs';"
            "const cases = JSON.parse(readFileSync(0, 'utf8'));"
            "process.stdout.write(JSON.stringify(cases.map(([name, label, mount]) =>"
            " lampSettings(name, label, 128, null, null, mount).direction)));"
        )
        run = subprocess.run(
            ["node", "--input-type=module", "-e", script], input=json.dumps(cases),
            capture_output=True, text=True, check=True,
        )
        expected = [
            LAMP.lamp_settings(name, label, 128, None, None, mount)["direction"]
            for name, label, mount in cases
        ]
        self.assertEqual(expected, json.loads(run.stdout))


class ColorTests(unittest.TestCase):
    def test_the_effects_the_app_lets_you_color(self):
        for name in ("Meteor", "Building Blocks"):
            self.assertTrue(LAMP.effect_supports_color_override(name))
            settings = LAMP.lamp_settings(name, "Right", 128, [255, 64, 0])
            self.assertTrue(settings["coloured"])
            self.assertEqual([255, 64, 0], settings["primary"])
            # What it draws: every lit pixel of the color, red above green, next
            # to no blue (the lamp's own color correction leaves a trace).
            timeline = LAMP.timeline_for(settings)
            lit = [
                pixel
                for render in range(0, 200, 5)
                for pixel in CORE.frame_pixels(timeline.frame_at(render, True))
                if any(pixel)
            ]
            self.assertTrue(lit, name)
            self.assertTrue(all(g <= r and b <= 2 for r, g, b in lit), name)

    def test_both_languages_offer_the_same(self):
        source = (ROOT / "www" / "lamp-renderers.js").read_text(encoding="utf-8")
        block = source[source.index("COLOR_OVERRIDE_EFFECTS = new Set(["):]
        block = block[:block.index("]);")]
        self.assertEqual(sorted(LAMP._COLOR_OVERRIDE_EFFECTS), sorted(json.loads(
            "[" + block[block.index("[") + 1:].strip().rstrip(",") + "]"
        )))


class FilmedSweepTests(unittest.TestCase):
    """Filmed 2026-11-11: the Cube Lite standing, the Device Orientation set to
    each mount and the lamp's rotation written for it (left 0, up 1, right 2,
    down 3). On the lamp, each value runs the same way at every rotation (the
    lamp turns it); per effect, the way each value ran on a standing lamp
    set Up."""

    ROTATIONS = {"left": 0, "up": 1, "right": 2, "down": 3}
    RAN = {
        ("Rainbow", "Waterfall", "Meteor"): {0: "Down", 1: "Up", 2: "Right", 3: "Left"},
        ("Fire", "Building Blocks"): {0: "Up", 1: "Down", 2: "Left", 3: "Right"},
        ("Particle path", "Rotating colour bands", "Palette trails", "Aqua-lime trails", "Scrolling bands"):
            {0: "Right", 1: "Left", 2: "Up", 3: "Down"},
        ("Stacking blocks", "Kaleidoscope"): {0: "Left", 1: "Right", 2: "Down", 3: "Up"},
    }
    # rotation -> value -> the way Moving palette, Sine wave and Flicker sweep
    # ran on the standing lamp (along its long side only).
    ONE_AXIS_FILMED = {
        1: {0: "Down", 1: "Up", 2: "Up", 3: "Down"},
        2: {0: "Up", 1: "Down", 2: "Up", 3: "Down"},
        3: {0: "Up", 1: "Down", 2: "Down", 3: "Up"},
        0: {0: "Down", 1: "Up", 2: "Down", 3: "Up"},
    }

    def test_each_effect_runs_the_way_chosen_on_every_mount(self):
        for names, ran in self.RAN.items():
            for name in names:
                for mount, rotation in self.ROTATIONS.items():
                    for label in ("Up", "Down", "Left", "Right"):
                        sent, _ = _sent(label, mount, name, profile=rotation)
                        self.assertEqual(label, ran[sent], (name, mount, label))

    def test_flicker_sweep_draws_the_cube_matrix_s_sweep(self):
        # 2026-11-12, both models side by side (mounted right): the same
        # renderer, so the Cube Lite is sent the value that draws the Cube
        # Matrix's sweep for the app's arrows (Left and Right along the lamp,
        # Up and Down across), the same at every mount, as the other 2-D
        # effects. It ran as one along the lamp: row by row, its colours
        # across the lamp.
        spec = EFFECTS["Flicker sweep"]
        self.assertFalse(spec.get("one_axis"))
        for mount in MOUNTS:
            self.assertEqual(
                {"Up": 1, "Down": 0, "Left": 3, "Right": 2},
                {label: _sent(label, mount, "Flicker sweep", profile=PROFILE.PROFILES[("left", "up", "right", "down").index(mount)])[0]
                 for label in spec["directions"]},
                mount,
            )

    def test_a_one_axis_effect_runs_along_the_lamp_for_its_rotation(self):
        for name in ("Moving palette", "Sine wave"):
            self.assertTrue(EFFECTS[name].get("one_axis"), name)
            for rotation, ran in self.ONE_AXIS_FILMED.items():
                for label in ("Up", "Down"):
                    sent, _ = _sent(label, "up", name, profile=rotation)
                    self.assertEqual(label, ran[sent], (name, rotation, label))
                    # The pair sent (2026-11-12): Moving palette and Sine wave
                    # on 0 and 1, bands across the lamp travelling along it at
                    # any intensity (on 3 and 2 they can seem to roll across).
                    pair = (0, 1)
                    self.assertIn(PROFILE.DIRECTION_TABLE[rotation][sent], pair, (name, rotation, label))
                # Across the line: along it (Left as Up, Right as Down).
                self.assertEqual(_sent("Up", "up", name, profile=rotation)[0], _sent("Left", "up", name, profile=rotation)[0])
                self.assertEqual(_sent("Down", "up", name, profile=rotation)[0], _sent("Right", "up", name, profile=rotation)[0])

    def test_hacking_falls_along_the_lamp_on_0_and_1(self):
        # Filmed 2026-11-12, rotation 1, raw values: 0 ran Down, 1, 2 and 3 Up
        # (2 and 3 run as 0). Standing (`up`): Up forward, Down back.
        spec = EFFECTS["Hacking"]
        self.assertTrue(spec.get("one_axis") and spec.get("one_axis_low_pair"))
        ran = {0: "Down", 1: "Up", 2: "Up", 3: "Up"}
        for label in ("Up", "Down"):
            sent, _ = _sent(label, "up", "Hacking", profile=1)
            self.assertEqual(label, ran[sent])
        for rotation in range(4):
            for label in ("Up", "Down"):
                sent, _ = _sent(label, "up", "Hacking", profile=rotation)
                self.assertIn(PROFILE.DIRECTION_TABLE[rotation][sent], (0, 1))

    def test_a_lying_lamp_runs_a_one_axis_effect_left_and_right(self):
        # Mounted Right (its top to the right): its long side lies across.
        one_axis = PROFILE.one_axis_direction
        for rotation in range(4):
            table = PROFILE.DIRECTION_TABLE[rotation]
            # Right on the screen is the lamp's Up: a value drawn as 0 or 3.
            self.assertIn(table[one_axis("Right", "right", rotation, "Up")], (0, 3))
            self.assertIn(table[one_axis("Left", "right", rotation, "Up")], (1, 2))


if __name__ == "__main__":
    unittest.main()
