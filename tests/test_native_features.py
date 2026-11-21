"""Tests for Cube Lite native protocol definitions and bundled presets."""

import sys as _sys

# Other test files import this one as tests.test_native_features, test discovery as
# test_native_features: one module under both names, so its setup runs once and a patch
# of it is seen by all.
for _name in ("test_native_features", "tests.test_native_features"):
    _sys.modules.setdefault(_name, _sys.modules[__name__])

import ast
import importlib
import sys
import asyncio
import base64
import colorsys
import datetime
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
from fakes import (  # noqa: E402
    FakeCube, FakeHass, HomeAssistantError, NodeRun, functions, instant_asyncio, instant_sleeps, make_light, module, parsed,
    run as run_on_loop, slow,
)

# The lamp's pacing waits (0.1 s around an activation) do not wait in the tests.
INSTANT_ASYNCIO = instant_asyncio()


ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"
# The constants the light's code sees: const.py's and the effect catalogue's.
CONSTANTS = {**runpy.run_path(ROOT / "const.py"), **runpy.run_path(ROOT / "effect_catalog.py")}
PIXEL_ART = runpy.run_path(ROOT / "builtin_pixel_art.py")
NATIVE_PREVIEW = runpy.run_path(ROOT / "native_effect_preview.py")
LAMP_RENDERERS = runpy.run_path(ROOT / "lamp_renderers.py")
LAMP_ANIMATIONS_MODULE = runpy.run_path(ROOT / "lamp_animations.py")
COLOR_ADJUSTMENTS = runpy.run_path(ROOT / "color_adjustments.py")
# The built-in effect / clock activation (light_native.py) as tests load it on
# its own: the activations and the helpers they call. live_effect_changes is a
# module function; the others are methods (NATIVE_ACTIVATION_METHODS).
NATIVE_ACTIVATION = frozenset({
    "effect_direction_sent", "lamp_direction", "label_direction",
    "_activate_native_effect", "_native_effect_params",
    "_activate_native_clock", "_native_clock_params",
    "_send_native", "_update_running_effect", "_native_renderer_shown",
    "_native_brightness_due", "live_effect_changes",
    "runs_lamp_music", "_clear_fx_mode_flag", "intensity_config",
    "palette_music", "_send_palette_music", "_build_music_flow_payload",
    "_store_animation", "_send_music_direction", "_music_direction_due", "stored_gif_tile",
    "animation_look", "names_streamed_slot",
})
NATIVE_ACTIVATION_METHODS = NATIVE_ACTIVATION - {
    "live_effect_changes", "effect_direction_sent", "lamp_direction", "label_direction", "stored_gif_tile",
    "animation_look", "runs_lamp_music", "intensity_config", "palette_music",
    "_build_music_flow_payload", "names_streamed_slot",
}
COLOR_UTILS = runpy.run_path(ROOT / "color_utils.py")
MOUNT_PROFILE = runpy.run_path(ROOT / "mount_profile.py")
# Shared module-level names every loaded helper may reference.
def import_pure_module(name: str) -> types.ModuleType:
    """One of the integration's modules that imports no Home Assistant, with
    its own relative imports working (the package is registered without
    running its __init__)."""
    if "yeelight_cube" not in sys.modules:
        package = types.ModuleType("yeelight_cube")
        package.__path__ = [str(ROOT)]
        sys.modules["yeelight_cube"] = package
    return importlib.import_module(f"yeelight_cube.{name}")


MATTER_COMMANDS = import_pure_module("matter_commands")
# The real modules, for the tests that run the light itself (fakes.make_light).
CONST = module("const")
CUBE = module("lamp_client")
PROTOCOL = module("lamp_protocol")
HEALTH = module("lamp_client_health")
DISPLAY = module("light_display")
LIGHT_MODULE = module("light")
# The light's life in Home Assistant (its timers): light_lifecycle.py.
LIFECYCLE_MODULE = module("light_lifecycle")
# The effect ids the Yeelight app shows as one of its effects when the lamp
# reports them: its 18 effect tiles, the clock, a drawing, a plain colour and
# the ids it shows as Music Flow. (71, its GIFs, it tells by the custom id.)
APP_EFFECT_IDS = frozenset((
    3, 5, 15, 17, 32, 34, 37, 39, 42, 46, 47, 48, 49, 91, 92, 94, 95, 96,
    40, 36, 0, 41, 43, 44, 45, 50, 51,
))
STRINGS = json.loads((ROOT / "strings.json").read_text(encoding="utf-8"))


class TranslatedError(ValueError, RuntimeError):
    """Home Assistant's ServiceValidationError and HomeAssistantError, as
    errors.invalid() / failed() raise them, in the tests: with the message
    Home Assistant shows (strings.json "exceptions")."""

    def __init__(self, key: str, **placeholders):
        self.translation_key = key
        self.translation_placeholders = placeholders
        super().__init__(STRINGS["exceptions"][key]["message"].format(**placeholders))


# errors.py's helpers, for the functions the tests load on their own.
ERRORS = {
    "invalid": TranslatedError,
    "failed": TranslatedError,
    "invalid_input": lambda err: TranslatedError(err.key, **err.placeholders),
    "InputError": import_pure_module("input_error").InputError,
}

_DEFAULT_NAMESPACE = {
    **{name: CONSTANTS[name] for name in (
        "MODE_CLOCK", "MODE_NATIVE_EFFECT", "LAMP_MODES", "ROTATION_KIND_MODES",
        "lamp_rate", "lamp_intensity", "DEFAULT_NATIVE_EFFECT_INTENSITY",
        "PALETTE_COLOR_MODE", "MUSIC_FLOW_EFFECTS", "MUSIC_FLOW_DEFAULT_PALETTE",
        "DEFAULT_NATIVE_EFFECT_SPEED", "streamed_slot",
    )},
    # What an animation's GIF is drawn with (light_native.animation_look).
    **{name: COLOR_ADJUSTMENTS[name] for name in ("ADJUSTMENT_DEFAULTS", "active_adjustments")},
    # The palette color mode's rule (light_native imports it).
    **{name: LAMP_RENDERERS[name] for name in (
        "palette_music_flow", "palette_words", "music_palette", "clock_palette_words",
    )},
    # The animations' upload (light_native._store_animation).
    **{name: LAMP_ANIMATIONS_MODULE[name] for name in ("gif_packets", "lamp_gif")},
    "EFFECTS_CLUSTER": MATTER_COMMANDS.EFFECTS_CLUSTER,
    "MatterCommandsUnavailable": MATTER_COMMANDS.MatterCommandsUnavailable,
    "GIF_PACKET_ACK": 6,
    "base64": __import__("base64"),
    **{name: COLOR_UTILS[name] for name in ("rgb_to_argb", "argb_to_rgb")},
    "compensate_direction": MOUNT_PROFILE["compensate_direction"],
    "one_axis_direction": MOUNT_PROFILE["one_axis_direction"],
    "HIGH_PAIR": MOUNT_PROFILE["HIGH_PAIR"],
    "LOW_PAIR": MOUNT_PROFILE["LOW_PAIR"],
    **ERRORS,
}
# The light entity is split across light.py and its light_*.py mixins. Join them
# so source-level invariant checks below still find methods wherever they live.
LIGHT_SOURCE = "\n\n".join(
    p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light*.py"))
)
# The entity-facing actions are split across light_services*.py modules.
SERVICES_SOURCE = "\n\n".join(
    p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light_services*.py"))
)
INIT_SOURCE = (ROOT / "__init__.py").read_text(encoding="utf-8")
CAMERA_SOURCE = (ROOT / "camera.py").read_text(encoding="utf-8")
SELECT_SOURCE = (ROOT / "select.py").read_text(encoding="utf-8")
SWITCH_SOURCE = (ROOT / "switch.py").read_text(encoding="utf-8")
# The JS that renders clock previews: the shared clock-preview module and the
# cards that use it.
CLOCK_CARD_SOURCE = "\n\n".join(
    (ROOT / "www" / name).read_text(encoding="utf-8")
    for name in (
        "clock-preview-utils.js",
        "yeelight-cube-lamp-preview-card.js",
        "yeelight-cube-clock-card.js",
    )
)


_CARDS = None


def cards() -> dict:
    """What the cards' modules hold and resolve (www/clock-preview-utils.js,
    lamp-renderers.js, effect-families.js), for the names of effect_catalog.py: one
    Node run, on first use."""
    global _CARDS
    if _CARDS is None:
        www = ROOT / "www"
        clock, lamp, families = (
            json.dumps((www / name).as_uri())
            for name in ("clock-preview-utils.js", "lamp-renderers.js", "effect-families.js")
        )
        _CARDS = NodeRun(
            f"import * as clock from {clock}; import * as lamp from {lamp}; import * as families from {families};"
            "import {readFileSync} from 'node:fs';"
            "const asked = JSON.parse(readFileSync(0, 'utf8'));"
            "const each = (keys, value) => Object.fromEntries(keys.map((key) => [key, value(key)]));"
            "process.stdout.write(JSON.stringify({"
            " mixerEffects: clock.CLOCK_MIXER_EFFECTS, styleMixer: clock.CLOCK_STYLE_MIXER,"
            " mixerByName: each(asked.names, (name) => clock.clockStyleMixer({clock_style: name})),"
            " mixerById: each(asked.ids, (id) => clock.clockStyleMixer({clock_style_id: Number(id)})),"
            " clockDirection: each(asked.clockEffects, (effect) => lamp.lampClockSettings(effect, 50).direction),"
            " defaultSpeed: lamp.DEFAULT_EFFECT_SPEED, undirected: lamp.UNDIRECTED_EFFECT_DIRECTION,"
            " familyNames: families.EFFECT_FAMILY_NAMES,"
            "}));",
            {
                "names": sorted(set(CONSTANTS["CLOCK_MIXER_EFFECTS"].values())),
                "ids": [str(style_id) for style_id in CONSTANTS["NATIVE_CLOCK_STYLES"]],
                "clockEffects": sorted(set(CONSTANTS["CLOCK_MIXER_EFFECTS"].values())),
            },
        )
    return _CARDS.result()


def _function_source(source: str, name: str) -> str:
    tree = parsed(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            lines = source.splitlines()
            start = min(
                [node.lineno, *(decorator.lineno for decorator in node.decorator_list)]
            ) - 1
            definition_index = next(
                index
                for index in range(start, len(lines))
                if lines[index].lstrip().startswith(("def ", "async def "))
                and len(lines[index]) - len(lines[index].lstrip()) == node.col_offset
            )
            end = len(lines)
            for index in range(definition_index + 1, len(lines)):
                line = lines[index]
                if not line.strip():
                    continue
                indentation = len(line) - len(line.lstrip())
                if indentation <= node.col_offset and line.lstrip().startswith(
                    ("def ", "async def ", "class ", "@")
                ):
                    end = index
                    break
            return "\n".join(lines[start:end])
    raise AssertionError(f"Function {name} was not found")


def _js_object(source: str, name: str) -> str:
    """Source text of the JS object literal assigned to `name`."""
    start = source.index(f"{name} = {{")
    return source[start: source.index("\n};", start) + 3]


def _load_standalone_functions(source: str, names: set, extra_namespace=None) -> dict:
    """Load selected helpers without importing Home Assistant (fakes.functions,
    with the names every loaded helper may reference)."""
    return functions(source, names, {**_DEFAULT_NAMESPACE, **(extra_namespace or {})})


class NativeFeatureTests(unittest.TestCase):
    def test_external_display_blocks_background_and_queued_restore_but_allows_user_content(self):
        apply_mode = _load_standalone_functions(
            LIGHT_SOURCE, {"async_apply_display_mode"},
            {"_LOGGER": Mock(), "MUSIC_FLOW_EXIT_UPDATE_TYPES": set()},
        )["async_apply_display_mode"]
        calls = []
        device = types.SimpleNamespace(
            _external_display=True, _is_on=True, _rotation_resume_pending=False,
            _rotation_active=False, _calibration_lock=False, _music_flow_enabled=False,
            _in_native_fw_mode=True, _shows_own_drawing=False, _mode="Solid Color", _display_overlay=False,
            _display_retry_count=0, MAX_DISPLAY_RETRIES=3, _ip="test", _custom_text="text",
            _restoring_after_lamp=False,
        )

        async def draw():
            calls.append("draw")

        async def execute(func, name, **kwargs):
            await func()

        device._execute_hardware_op = execute
        device._apply_display_mode_internal = draw
        asyncio.run(apply_mode(device, "display_update"))
        asyncio.run(apply_mode(device, "display_retry"))
        self.assertEqual([], calls)
        asyncio.run(apply_mode(device, "text_change"))
        self.assertEqual(["draw"], calls)
        calls.clear()
        device._external_display = False
        device._in_native_fw_mode = False
        device._restoring_after_lamp = True

        async def queued(func, name, **kwargs):
            device._external_display = True  # the external display wins while waiting for device lock
            await func()

        device._execute_hardware_op = queued
        asyncio.run(apply_mode(device, "text_change"))
        self.assertEqual([], calls)

    @unittest.skipUnless(shutil.which("node"), "Node is required for catalogue parity")
    def test_offline_native_catalogue_matches_backend(self):
        module_uri = (ROOT / "www" / "native-effect-card-utils.js").as_uri()
        script = (
            f"import {{nativePreviewCatalogue}} from {json.dumps(module_uri)};"
            "process.stdout.write(JSON.stringify(nativePreviewCatalogue));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        actual = {item["name"]: item for item in json.loads(result.stdout)}
        expected = {
            name: {
                "name": name,
                "speed": bool(spec.get("speed")),
                "intensity": bool(spec.get("intensity")),
                "directions": list(spec.get("directions", ())),
                "extended": bool(spec.get("extended")),
                "family": CONSTANTS["EFFECT_FAMILY_OF_SLOT"][spec["mode"]],
                "preview": True,
            }
            for name, spec in CONSTANTS["ALL_NATIVE_EFFECTS"].items()
            if spec["mode"] != CONSTANTS["LAMP_STORED_GIF_SLOT"]
        }
        self.assertEqual(expected, actual)

    def test_clock_palette_supported_styles(self):
        supported = {
            "Rainbow", "Spectrum", "Ribbon", "Moving palette",
            "Triangular palette pulses", "Mirrored comets", "Tide (slot 35)", "Tide", "Palette stripes", "Kaleidoscope",
        }
        supports = NATIVE_PREVIEW["effect_supports_color_mode"]
        render = NATIVE_PREVIEW["render_native_effect"]
        for effect in set(CONSTANTS["NATIVE_EFFECTS"]) | supported:
            for mode in ("red_blue", "white_orange", "blue_yellow", "purple_orange"):
                with self.subTest(effect=effect, mode=mode):
                    self.assertEqual(effect in supported, supports(effect, mode))
                    normal = render(effect, 4.75, "Down")
                    pixels = render(effect, 4.75, "Down", color_mode=mode)
                    if effect in supported:
                        self.assertNotEqual(normal, pixels)
                        self.assertEqual(pixels, render(effect, 4.75, "Down", [255, 0, 0], mode))
                    else:
                        self.assertEqual(normal, pixels)

    @unittest.skipUnless(shutil.which("node"), "Node is required for renderer parity")
    def test_clock_palette_parity(self):
        cases = [
            [effect, phase, direction, override, mode]
            for effect in ("Rainbow", "Spectrum", "Ribbon", "Moving palette",
                           "Triangular palette pulses", "Mirrored comets", "Tide (slot 35)", "Tide", "Palette stripes", "Kaleidoscope")
            for phase in (-2.5, -0.01, 0, 0.001, 0.125, 0.5, 1, 2.75, 5.555, 13.37)
            for direction in ("Up", "Down", "Left", "Right")
            for override in (None, [180, 20, 60])
            for mode in (None, "normal", "bw", "red_blue", "white_orange", "blue_yellow", "purple_orange", "unknown")
            if effect == "Rainbow" or mode in ("red_blue", "white_orange", "blue_yellow", "purple_orange")
        ]
        module_uri = (ROOT / "www" / "native-effect-preview.js").as_uri()
        script = (
            f"import {{renderNativeEffect}} from {json.dumps(module_uri)};"
            "import {readFileSync} from 'node:fs';"
            "const cases = JSON.parse(readFileSync(0, 'utf8'));"
            "process.stdout.write(JSON.stringify(cases.map(args => renderNativeEffect(...args))));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            input=json.dumps(cases), text=True, capture_output=True, check=True,
        )
        for case, actual in zip(cases, json.loads(result.stdout), strict=True):
            expected = [list(pixel) for pixel in NATIVE_PREVIEW["render_native_effect"](*case)]
            with self.subTest(case=case):
                self.assertEqual(expected, actual)

    @unittest.skipUnless(shutil.which("node"), "Node is required for renderer parity")
    @slow
    def test_every_native_effect_matches_between_camera_and_card(self):
        # The camera entity (Python) and the Lamp Preview / Native Effects
        # cards (JavaScript) draw the same frames: every effect of the
        # catalogue, in every direction, oriented like the lamp, with a
        # custom color and each palette mode it supports.
        supports = NATIVE_PREVIEW["effect_supports_color_mode"]
        modes = ("bw", "red_blue", "white_orange", "blue_yellow", "purple_orange")
        # A live simulation (Lava Lamp) starts a new run wherever it is first
        # asked, so two previews match only when asked in the same order: its
        # Python and JS runs from the same start are compared in
        # test_streamed_effects instead.
        registry = NATIVE_PREVIEW["lamp_settings"].__globals__["REGISTRY"]
        live = {
            name for name, spec in CONSTANTS["ALL_NATIVE_EFFECTS"].items()
            if registry.get(spec["mode"], {}).get("live")
        }
        self.assertEqual({"Lava Lamp", "Falling Blocks"}, live)
        # The moments innermost: each timeline then runs on from the last
        # one instead of being replayed (the timelines kept are few).
        cases = [
            [effect, phase, direction, override, mode]
            for effect in sorted(set(CONSTANTS["ALL_NATIVE_EFFECTS"]) - live)
            for direction in ("Up", "Down", "Left", "Right")
            for override, mode in (
                (None, None),
                ([180, 20, 60], None),
                *((None, mode) for mode in modes if supports(effect, mode)),
            )
            for phase in (0, 0.37, 1, 2.5, 7.25)
        ]
        module_uri = (ROOT / "www" / "native-effect-preview.js").as_uri()
        timelines = NATIVE_PREVIEW["lamp_settings"].__globals__  # its own timelines
        lamp_uri = (ROOT / "www" / "lamp-renderers.js").as_uri()
        # A replay gives up at a time limit that differs between the languages:
        # the frames are computed ahead, in full.
        script = (
            f"import {{renderNativeEffect}} from {json.dumps(module_uri)};"
            f"import {{lampSettings, hasRenderer, isLampRendered, timelineFor}} from {json.dumps(lamp_uri)};"
            "import {readFileSync} from 'node:fs';"
            "const cases = JSON.parse(readFileSync(0, 'utf8'));"
            "const ahead = ([effect, phase, direction, override, mode]) => {"
            " if (!isLampRendered(effect)) return;"
            " const settings = lampSettings(effect, direction, 50, override, mode);"
            " if (hasRenderer(settings.mode))"
            "  timelineFor(settings).frameAt("
            "   timelineFor(settings).firstShown() + phase / (0.25 + 50 / 55) / 0.04, true); };"
            "process.stdout.write(JSON.stringify(cases.map(args => {"
            " ahead(args); return renderNativeEffect(...args); })));"
        )
        # The cards draw theirs meanwhile.
        node = NodeRun(script, cases)
        render = NATIVE_PREVIEW["render_native_effect"]
        expected_frames = []
        for case in cases:
            effect, phase, direction, override, mode = case
            if effect in timelines["LAMP_RENDERED_EFFECTS"]:
                settings = timelines["lamp_settings"](effect, direction, 50, override, mode)
                if timelines["has_renderer"](settings["mode"]):
                    timeline = timelines["timeline_for"](settings)
                    timeline.frame_at(
                        timeline.first_shown() + int(phase / (0.25 + 50 / 55.0) / 0.04), True
                    )
            expected_frames.append([list(pixel) for pixel in render(*case)])
        mismatched = [
            case for case, expected, actual in zip(cases, expected_frames, node.result(), strict=True)
            if expected != actual
        ]
        self.assertEqual([], mismatched[:20], f"{len(mismatched)} of {len(cases)} frames differ")

    def test_clock_uses_lamp_clock_apply_mode(self):
        self.assertEqual(40, CONSTANTS["NATIVE_CLOCK_EFFECT_ID"])
        self.assertEqual(2, CONSTANTS["NATIVE_CLOCK_APPLY"])

    def test_clock_applies_brightness_after_activation(self):
        # The shared send path sets the brightness after set_fx_effect for
        # the clock only (it can drop the activation otherwise); an effect
        # has it set first.
        phases = []

        class Lamp(FakeCube):
            async def send_raw_command(self, method, params, *args, **kwargs):
                phases.append((method, getattr(light, "_hardware_operation_phase", None)))
                await super().send_raw_command(method, params)

        with instant_sleeps():
            light = make_light(cube=Lamp(), _mode=CONST.MODE_CLOCK, _brightness=128,
                               _last_hardware_brightness=None)
            run_on_loop(light._activate_native_clock())
            self.assertEqual([("set_fx_effect", "clock:set_fx_effect"), ("set_bright", "clock:brightness")], phases)
            light = make_light(_mode=CONST.MODE_NATIVE_EFFECT, _native_effect="Rainbow", _brightness=128,
                               _last_hardware_brightness=None)
            run_on_loop(light._activate_native_effect())
            self.assertEqual(["set_bright", "set_fx_effect"], light._lamp_client.methods())

    def test_clock_color_override_cleared_for_any_active_palette_mode(self):
        # A custom color override must not linger once a palette mode (B&W,
        # Vivid, Retro Orange, ...) is active on an animated style - it would
        # otherwise re-tint the lamp's own palette remap. Solid styles
        # have no mixer effect to protect and stay unaffected (except B&W).
        def make_device(style_id, color_mode):
            return make_light(
                hass=FakeHass(), _mode=CONST.MODE_CLOCK, _native_clock_style=style_id,
                _native_effect_speed=50, _native_clock_color=0x01FFEE00,
                _native_clock_color_mode=color_mode, _native_effect_direction="Up", _is_on=False,
                _native_clock_timezone_offset=0,
            )

        async def run(style_id, color_mode):
            """What the activation sends (None: nothing, the clock is streamed)."""
            device = make_device(style_id, color_mode)
            with instant_sleeps():
                await device._activate_native_clock()
                device.stop_studio_stream()
            sent = [params for _, method, params in device._lamp_client.sent if method == "set_fx_effect"]
            return sent[-1] if sent else None

        # Ember goes as itself under mixer 1, so its first frame runs: under a
        # mode 40 hand-over it comes back with no sparks after the first time.
        ember = next(
            style_id for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items()
            if style["mixer"] == 24
        )
        params = asyncio.run(run(ember, "normal"))
        self.assertEqual((24, 1), (params[3]["mode"], params[3]["mixer"]))
        self.assertEqual(CONSTANTS["NATIVE_CLOCK_EFFECT_ID"], params[0])
        self.assertIn("data", params[3])
        self.assertNotIn("direction", params[3])

        # Every style: the direct backgrounds go as mode + mixer 1, the rest as
        # the mode 40 hand-over, and the raw-command guard lets each through.
        guard = import_pure_module("fx_guard")
        for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items():
            with self.subTest(style=style["name"]):
                params = asyncio.run(run(style_id, "normal"))
                if style.get("background") in CONSTANTS["LITE_STREAMED_EFFECTS"]:
                    # An effect a Cube Lite does not have (the integration's
                    # own, a Cube Matrix's version): streamed, never sent.
                    self.assertIsNone(params)
                    continue
                expected = (
                    (style["mixer"], 1)
                    if CONSTANTS["clock_style_direct"](style)
                    else (CONSTANTS["NATIVE_CLOCK_EFFECT_ID"], style["mixer"])
                )
                self.assertEqual(expected, (params[3]["mode"], params[3]["mixer"]))
                self.assertIn("data", params[3])
                self.assertIsNone(guard.fx_refusal(params[3], preset=params[0]))

        # Animated style (Spectrum, mixer 17): normal keeps the override;
        # any active palette mode (bw included) clears it and remaps the id.
        params = asyncio.run(run(3, "normal"))
        self.assertEqual([0x01FFEE00], params[3]["color"])
        self.assertEqual(CONSTANTS["NATIVE_CLOCK_EFFECT_ID"], params[0])
        for mode in ("bw", "red_blue", "white_orange", "blue_yellow", "purple_orange"):
            with self.subTest(mode=mode):
                params = asyncio.run(run(3, mode))
                self.assertNotIn("color", params[3])
                self.assertEqual(CONSTANTS["CLOCK_COLOR_MODES"][mode], params[0])

        # Solid style (mixer 0): palette modes other than B&W leave the
        # override and command id untouched; B&W still clears the color.
        for mode in ("red_blue", "white_orange", "blue_yellow", "purple_orange"):
            with self.subTest(mode=mode):
                params = asyncio.run(run(6, mode))
                self.assertEqual([0x01FFEE00], params[3]["color"])
                self.assertEqual(CONSTANTS["NATIVE_CLOCK_EFFECT_ID"], params[0])
        params = asyncio.run(run(6, "bw"))
        self.assertNotIn("color", params[3])

        # A background that draws its colour words (1, 8, 28, 33, 72) is sent
        # all of them, as its effect is, the custom color first (word 0);
        # without one its own first word. No palette reaches these slots, so
        # every mode but B&W keeps them; B&W sends none (white, as before).
        for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items():
            words = CONSTANTS["_EXTENDED_EFFECT_COLORS"].get(style["mixer"])
            if words is None:
                continue
            with self.subTest(style=style["name"]):
                for mode in ("normal", "red_blue", "white_orange", "blue_yellow", "purple_orange"):
                    params = asyncio.run(run(style_id, mode))
                    self.assertEqual([0x01FFEE00, *words[1:]], params[3]["color"])
                    self.assertEqual(CONSTANTS["NATIVE_CLOCK_EFFECT_ID"], params[0])
                    self.assertIsNone(guard.fx_refusal(params[3], preset=params[0]))
                device = make_device(style_id, "normal")
                device._native_clock_color = None
                params = device._native_clock_params()
                self.assertEqual(list(words), params[3]["color"])
                self.assertNotIn("color", asyncio.run(run(style_id, "bw"))[3])

    def test_native_settings_reject_skipped_commands(self):
        # A command the connection skipped (cooldown: no answer at all) is an
        # error, and the setting is not taken as the lamp's.
        light = make_light()
        light._lamp_client.reply = None
        before = light._power_on_state
        other = next(state for state in CONST.POWER_ON_STATES if state != before)
        with self.assertRaises(PROTOCOL.CubeConnectionError):
            run_on_loop(light.async_set_power_on_state(other))
        self.assertEqual(before, light._power_on_state)
        with self.assertRaises(PROTOCOL.CubeConnectionError):
            run_on_loop(light.async_set_button_effects(["Rainbow"]))
        self.assertEqual([], light._button_effects)
        # Answered: both are taken.
        light._lamp_client.reply = {"id": 1, "result": ["ok"]}
        run_on_loop(light.async_set_power_on_state(other))
        self.assertEqual(other, light._power_on_state)

    def test_light_services_are_registered_at_component_setup(self):
        # Once, for the whole session: registering them again at each lamp
        # setup replaced their handlers and their state (locks, trackers).
        init = module("__init__")
        hass = FakeHass()
        with patch.object(LIGHT_MODULE, "async_setup_light_services") as services, \
                patch.object(init, "get_conflict_prevention"), \
                patch.object(init, "_schedule_dismiss_yeelight_discoveries"), \
                patch.object(init, "async_setup_services"), \
                patch.object(init, "_async_serve_card_files", AsyncMock()), \
                patch.object(init, "_async_register_frontend_cards", AsyncMock()):
            run_on_loop(init.async_setup(hass, {}))
        services.assert_called_once_with(hass)
        # What it registers: the entity actions, each once.
        LIGHT_MODULE.async_setup_light_services(hass)
        self.assertIn((CONST.DOMAIN, "send_fx_effect"), hass.registered)
        # The entry and platform setups (Home Assistant's, too entangled to run
        # here) register none.
        self.assertNotIn("async_setup_light_services", _function_source(INIT_SOURCE, "async_setup_entry"))
        self.assertNotIn("services.async_register", _function_source(LIGHT_SOURCE, "async_setup_entry"))

    def test_all_lan_supported_native_effects_are_defined(self):
        effects = CONSTANTS["NATIVE_EFFECTS"]
        self.assertEqual(18, len(effects))
        for name in ("Winter", "Dream", "Halloween", "Moonlight"):
            self.assertNotIn(name, effects)
        self.assertEqual(("Up", "Down"), effects["Hacking"]["directions"])
        for effect in effects.values():
            self.assertIsInstance(effect["effect_id"], int)
            self.assertIsInstance(effect["mode"], int)

    def test_power_on_values_match_private_protocol(self):
        # cfg_init_power: 0 restores the previous state, 1 always on, 2
        # always off (verified on the lamp after a power cut).
        self.assertEqual(
            {"Restore": 0, "Always on": 1, "Always off": 2},
            CONSTANTS["POWER_ON_STATES"],
        )
        # A label saved by an older version keeps the value it sent.
        for old, new in CONSTANTS["LEGACY_POWER_ON_STATES"].items():
            self.assertEqual(
                {"Off": 0, "On": 1, "Toggle": 2}[old], CONSTANTS["POWER_ON_STATES"][new]
            )

    def test_a_saved_power_on_behavior_keeps_what_the_lamp_does(self):
        invalid = object()
        convert = _load_standalone_functions(
            (ROOT / "light_restore.py").read_text(encoding="utf-8"),
            {"_power_on_state"},
            {
                "LEGACY_POWER_ON_STATES": CONSTANTS["LEGACY_POWER_ON_STATES"],
                "POWER_ON_STATES": CONSTANTS["POWER_ON_STATES"],
                "_INVALID": invalid,
            },
        )["_power_on_state"]
        # Saved by 1.3.5 and earlier: read by the value the lamp received.
        self.assertEqual("Restore", convert("Off"))
        self.assertEqual("Always on", convert("On"))
        self.assertEqual("Always off", convert("Toggle"))
        # Today's labels as they are; anything else is ignored.
        for label in CONSTANTS["POWER_ON_STATES"]:
            self.assertEqual(label, convert(label))
        self.assertIs(invalid, convert("Sometimes"))

    def test_music_flow_effect_ids_match_official_app(self):
        self.assertEqual(
            {
                "Gather": 83,
                "Breathing": 84,
                "Blossom": 85,
                "Spectrum": 86,
                "Music Note": 87,
                "Impact": 88,
            },
            CONSTANTS["MUSIC_FLOW_EFFECTS"],
        )

    def test_music_flow_payload_uses_private_protocol_schema(self):
        helpers = _load_standalone_functions(
            LIGHT_SOURCE,
            {"_build_music_flow_payload"},
            {
                "MUSIC_FLOW_EFFECTS": CONSTANTS["MUSIC_FLOW_EFFECTS"],
                "MUSIC_FLOW_DEFAULT_PALETTE": CONSTANTS[
                    "MUSIC_FLOW_DEFAULT_PALETTE"
                ],
            },
        )
        build = helpers["_build_music_flow_payload"]
        enabled = json.loads(build(True, "Blossom"))
        self.assertEqual(1, enabled["on"])
        self.assertEqual(85, enabled["effect_id"])
        self.assertEqual(16, len(enabled["palatte"]))
        self.assertNotIn("palette", enabled)
        self.assertEqual({"on": 0}, json.loads(build(False, "Blossom")))

    def test_music_flow_command_uses_private_property_and_restores_content(self):
        # On: set_ps mic_music_mode with the effect. Off: set_ps {"on": 0},
        # then the content shown before is drawn again (direct mode, frame),
        # and the state is saved both times.
        with instant_sleeps():
            light = make_light(_music_flow_enabled=False)
            light._persist_music_flow_runtime_state = AsyncMock()
            run_on_loop(light.async_set_music_flow(True))
            method, params = light._lamp_client.sent[0][1:]
            self.assertEqual(("set_ps", "mic_music_mode"), (method, params[0]))
            self.assertEqual(1, json.loads(params[1])["on"])
            self.assertTrue(light._music_flow_enabled)
            run_on_loop(light.async_set_music_flow(False))
            self.assertEqual({"on": 0}, json.loads(light._lamp_client.params("set_ps")[1]))
            self.assertEqual(["set_ps", "set_ps", "activate_fx_mode", "set_bright", "update_leds"],
                             light._lamp_client.methods())
            self.assertFalse(light._music_flow_enabled)
            self.assertIsNone(light._music_flow_restore_power)
            self.assertEqual(2, light._persist_music_flow_runtime_state.await_count)

    def test_content_change_exits_music_flow_without_double_restore(self):
        # The new content is drawn by the change itself: leaving Music Flow
        # does not draw the old one first.
        light = make_light(_music_flow_enabled=True)
        light.async_set_music_flow = AsyncMock()
        run_on_loop(light.async_apply_display_mode(update_type="text_change"))
        light.async_set_music_flow.assert_awaited_once_with(False, restore_display=False)

    def test_rgb_turn_on_exits_music_flow_before_applying_color(self):
        async_turn_on = _load_standalone_functions(
            LIGHT_SOURCE,
            {"async_turn_on"},
            {
                "_LOGGER": types.SimpleNamespace(debug=lambda *args: None),
            },
        )["async_turn_on"]
        events = []
        device = types.SimpleNamespace(
            _calibration_lock=False,
            _music_flow_enabled=True,
            _rotation_active=False,
            _rotation_resume_pending=False,
            _is_on=True,
            _brightness=255,
            _rgb_color=(255, 255, 255),
            hass=None,
        )

        async def set_music_flow(enabled, restore_display=True):
            events.append(("music_flow", enabled, restore_display))
            device._music_flow_enabled = enabled

        async def internal_turn_on(**kwargs):
            events.append(("turn_on", kwargs))

        async def execute(func, op_name, coalesce=None):
            events.append(("execute", op_name, coalesce))
            await func()
            return True

        device.async_set_music_flow = set_music_flow
        device._internal_turn_on = internal_turn_on
        device._execute_hardware_op = execute
        turn_on = types.MethodType(async_turn_on, device)

        asyncio.run(turn_on(rgb_color=(12, 34, 56), brightness=128))

        self.assertEqual(
            ("music_flow", False, False),
            events[0],
        )
        # Not only a brightness: never skipped for a newer one.
        self.assertEqual(("execute", "turn_on", None), events[1])
        self.assertEqual(
            ("turn_on", {"rgb_color": (12, 34, 56), "brightness": 128, "_was_on": True}),
            events[2],
        )
        self.assertEqual((12, 34, 56), device._rgb_color)
        self.assertEqual(128, device._brightness)

    def test_brightness_only_turn_on_preserves_music_flow(self):
        async_turn_on = _load_standalone_functions(
            LIGHT_SOURCE,
            {"async_turn_on"},
            {
                "_LOGGER": types.SimpleNamespace(debug=lambda *args: None),
            },
        )["async_turn_on"]
        events = []
        device = types.SimpleNamespace(
            _calibration_lock=False,
            _music_flow_enabled=True,
            _rotation_active=False,
            _rotation_resume_pending=False,
            _is_on=True,
            _brightness=255,
            _rgb_color=(255, 255, 255),
            hass=None,
        )

        async def set_music_flow(enabled, restore_display=True):
            events.append(("music_flow", enabled, restore_display))

        async def internal_turn_on(**kwargs):
            events.append(("turn_on", kwargs))

        async def execute(func, op_name, coalesce=None):
            events.append(("execute", coalesce))
            await func()
            return True

        device.async_set_music_flow = set_music_flow
        device._internal_turn_on = internal_turn_on
        device._execute_hardware_op = execute
        turn_on = types.MethodType(async_turn_on, device)

        asyncio.run(turn_on(brightness=96))

        self.assertFalse(any(event[0] == "music_flow" for event in events))
        # A brightness on a lamp that is on: a newer one queued replaces it.
        self.assertEqual(
            [("execute", "brightness"), ("turn_on", {"brightness": 96, "_was_on": True})],
            events,
        )
        # One that turns the lamp on always runs.
        events.clear()
        device._is_on = False
        asyncio.run(turn_on(brightness=96))
        self.assertEqual(("execute", None), events[0])

    def test_palette_selection_uses_guarded_display_state_machine(self):
        # A palette chosen in the dropdown goes through the guarded display
        # queue as a color change (never a bare apply()).
        select = module("select")
        palette = {"name": "Sunset", "colors": [[255, 80, 0], [120, 0, 200]]}
        hass = FakeHass({CONST.DOMAIN: {"palettes_v2": [palette]}})
        light = make_light(hass=hass, async_apply_display_mode=AsyncMock(return_value=True), apply=AsyncMock())
        entity = select.YeelightCubePaletteSelect(light, "192.0.2.10", None, hass)
        run_on_loop(entity.async_select_option("Sunset"))
        light.async_apply_display_mode.assert_awaited_once_with(update_type="color_change")
        light.apply.assert_not_awaited()
        self.assertEqual(palette["colors"], light._text_colors)

    def test_health_recovery_restarts_active_music_flow(self):
        # A turn_on redraw does not leave Music Flow (the recovery restarts
        # it instead of drawing over it).
        self.assertNotIn("turn_on", DISPLAY.MUSIC_FLOW_EXIT_UPDATE_TYPES)
        light = make_light(_music_flow_enabled=True)
        light.async_set_music_flow = AsyncMock()
        light._apply_display_mode_internal = AsyncMock()
        run_on_loop(light.async_apply_display_mode(update_type="turn_on"))
        light.async_set_music_flow.assert_not_awaited()
        # The recovery branch itself (light_connection._periodic_health_check,
        # an endless loop): Music Flow restarted before any redraw.
        health_check = _function_source(LIGHT_SOURCE, "_periodic_health_check")
        self.assertIn("if self._music_flow_enabled:", health_check)
        self.assertLess(
            health_check.index("await self.async_set_music_flow(True)"),
            health_check.index("await self.async_apply_display_mode(update_type='turn_on')"),
        )

    def test_turning_music_flow_off_restores_display_and_prior_power(self):
        applied, persisted = [], []

        async def execute(func, op_name, timeout_override=None):
            await func()
            return True

        async def apply_display():
            applied.append("display")

        async def persist_music_flow():
            persisted.append(True)

        device = make_light(
            _music_flow_enabled=True, _music_flow_effect="Breathing", _music_flow_restore_power=True,
            _is_on=True, _in_native_fw_mode=True, _execute_hardware_op=execute,
            _apply_display_mode_internal=apply_display, _persist_music_flow_runtime_state=persist_music_flow,
        )
        cube = device._lamp_client
        set_music_flow = device.async_set_music_flow
        commands = lambda: [(method, params) for how, method, params in cube.sent if how == "recovery"]
        raw_commands = lambda: [(method, params) for how, method, params in cube.sent if how == "raw"]

        run_on_loop(set_music_flow(False))
        self.assertFalse(device._music_flow_enabled)
        self.assertEqual(["display"], applied)
        self.assertEqual("set_ps", commands()[0][0])
        self.assertEqual(
            {"on": 0},
            json.loads(commands()[0][1][1]),
        )

        device._music_flow_enabled = True
        device._music_flow_restore_power = False
        device._is_on = True
        applied.clear()
        run_on_loop(set_music_flow(False))
        self.assertFalse(device._is_on)
        self.assertEqual([], applied)
        self.assertEqual(
            [("set_power", ["off"])],
            raw_commands(),
        )
        self.assertEqual(2, len(persisted))
        # A remote press did not change the desired Music Flow state. Stop
        # its physical music mode without a storage write before the redraw.
        device._is_on = True
        applied.clear()
        run_on_loop(set_music_flow(False, restore_display=False, persist_state=False))
        self.assertEqual(3, len(commands()))
        self.assertEqual({"on": 0}, json.loads(commands()[-1][1][1]))
        self.assertEqual([], applied)
        self.assertEqual(2, len(persisted))

    def test_music_flow_stop_finalizes_state_when_display_restore_fails(self):
        calls = {"persist": 0, "entities": 0, "preview": 0}

        def count(name):
            return lambda: calls.__setitem__(name, calls[name] + 1)

        async def execute(func, op_name, timeout_override=None):
            try:
                await func()
            except RuntimeError:
                return False
            return True

        async def apply_display():
            raise RuntimeError("restore failed")

        async def persist_music_flow():
            calls["persist"] += 1

        device = make_light(
            _music_flow_enabled=True, _music_flow_effect="Breathing", _music_flow_restore_power=True,
            _is_on=True, _in_native_fw_mode=True, _execute_hardware_op=execute,
            _apply_display_mode_internal=apply_display, _persist_music_flow_runtime_state=persist_music_flow,
            _refresh_music_flow_entities=count("entities"), _notify_camera_preview=count("preview"),
        )
        with self.assertRaises(HomeAssistantError) as failed:
            run_on_loop(device.async_set_music_flow(False))
        self.assertIn("could not complete", STRINGS["exceptions"][failed.exception.translation_key]["message"])

        self.assertFalse(device._music_flow_enabled)
        self.assertIsNone(device._music_flow_restore_power)
        self.assertEqual({"persist": 1, "entities": 1, "preview": 1}, calls)

    def test_every_restored_setting_is_saved(self):
        # Each setting restored after a restart or a reload is one the light
        # publishes (and saves apart while unreachable); its value comes back.
        restore = module("light_restore")
        profiles = module("device_profile")
        lite = make_light(_lite_stream_fps=12)
        matrix = make_light(profile=profiles.profile_for("CubeMatrix"))
        keys = {key for key, _attr, _convert in restore._RESTORED_ATTRIBUTES}
        for light, expected in ((lite, keys), (matrix, keys - {"lite_stream_fps"})):
            saved = light.extra_restore_state_data.as_dict()
            self.assertLessEqual(expected, set(light.extra_state_attributes))
            self.assertLessEqual(expected, set(saved))
        state = types.SimpleNamespace(state="on", attributes=lite.extra_state_attributes)
        fresh = make_light()
        fresh._restore_state(state)
        self.assertEqual(12, fresh._lite_stream_fps)

    def test_music_flow_runtime_state_is_persisted_after_storage_ready(self):
        # Published, saved and restored: Music Flow and the power to go back
        # to after it, read once the shared storage is loaded.
        light = make_light(_music_flow_enabled=True, _music_flow_restore_power=True)
        self.assertIs(True, light.extra_state_attributes["music_flow_restore_power"])
        storage = module("storage")
        gate = asyncio.Event()
        saved = {"device_runtime_state": {"entry-1": {
            "music_flow_enabled": True, "music_flow_effect": "Blossom", "music_flow_restore_power": False,
        }}}

        class Store:
            written = []

            def __init__(self, *args):
                pass

            async def async_load(self):
                await gate.wait()
                return saved

            async def async_save(self, data):
                Store.written.append(data)

        async def two_entries(hass):
            first = asyncio.create_task(storage.async_load_storage(hass))
            second = asyncio.create_task(storage.async_load_storage(hass))
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            self.assertFalse(second.done())  # it waits for the first's load
            gate.set()
            await asyncio.gather(first, second)

        hass = FakeHass({CONST.DOMAIN: {}})
        with patch.object(storage, "Store", Store):
            run_on_loop(two_entries(hass))
        restored = make_light(hass=hass)
        restored._restore_music_flow_runtime_state()
        self.assertTrue(restored._music_flow_enabled)
        self.assertEqual("Blossom", restored._music_flow_effect)
        self.assertIs(False, restored._music_flow_restore_power)
        # Turned off: saved at once, in what is written.
        restored._music_flow_enabled = False
        run_on_loop(restored._persist_music_flow_runtime_state())
        self.assertEqual({}, Store.written[-1]["device_runtime_state"])
        # Every entry's setup loads (or waits for) the shared storage first.
        self.assertIn("await async_load_storage(hass)", _function_source(INIT_SOURCE, "async_setup_entry"))

    def test_the_lamp_state_is_never_polled(self):
        # Cube Lite answers no get_prop (TCP or UDP): HA's update only
        # refreshes the clock's UTC offset, and never while Music Flow runs.
        # It runs when the light is added, then on the hour (daylight saving
        # changes happen on the hour), not on a 30 s poll.
        light_class = LIGHT_MODULE.YeelightCubeLight
        self.assertFalse(light_class._attr_should_poll)
        light = make_light(hass=FakeHass())
        with patch.object(LIFECYCLE_MODULE, "async_track_time_change") as hourly, \
                patch.object(LIFECYCLE_MODULE, "async_track_time_interval"), \
                patch.object(light, "async_update", AsyncMock()):
            run_on_loop(light.async_added_to_hass())
            run_on_loop(light.async_will_remove_from_hass())
            hourly.assert_called_once_with(light.hass, light._async_hourly_update, minute=0, second=5)
            run_on_loop(light._async_hourly_update(None))
            light.async_update.assert_awaited()
        # The update itself sends nothing, in any mode; with Music Flow on it
        # does not even look at the clock's offset.
        for mode in (CONST.MODE_CLOCK, CONST.MODE_NATIVE_EFFECT, "Solid Color"):
            light = make_light(_mode=mode, _native_clock_timezone_offset=None)
            run_on_loop(light.async_update())
            self.assertEqual([], light._lamp_client.sent, mode)
        light = make_light(_mode=CONST.MODE_CLOCK, _music_flow_enabled=True, _native_clock_timezone_offset=None)
        light._native_clock_timezone_hours = Mock(return_value=2)
        run_on_loop(light.async_update())
        light._native_clock_timezone_hours.assert_not_called()
        self.assertIsNone(light._native_clock_timezone_offset)
        # The transport asks a Cube Lite nothing when told its model; a Cube
        # Matrix its layout, once (the one get_prop besides probe_model's and
        # its health check, MATRIX_PROBE_COMMAND).
        self.assertEqual(("get_prop", ["power"]), HEALTH.MATRIX_PROBE_COMMAND)
        for model, asked in (("Cube Lite", False), ("CubeMatrix", True)):
            connection = CUBE.LampClient("192.0.2.10", 55443)
            with patch.object(connection, "_read_props", return_value=None) as read:
                connection.set_model(model)
            self.assertEqual(asked, read.called, model)
        # A Cube Lite's demo loop is never read (only a Cube Matrix has one).
        light = make_light()
        with patch.object(module("light_matrix_settings"), "tcp_request", AsyncMock()) as request:
            light._check_matrix_demo()
        self.assertIsNone(light._matrix_demo_task)
        request.assert_not_called()
        # An entry with no model asks it once at setup and stores it
        # (light.async_setup_entry: Home Assistant's platform setup).
        self.assertIn("model = await timed(\"Asking its model\", lamp_client.probe_model)\n", LIGHT_SOURCE)
        self.assertIn("            if model:\n"
                      "                hass.config_entries.async_update_entry(entry, data={**data, CONF_MODEL: model})",
                      LIGHT_SOURCE)

    def test_all_native_effect_previews_are_valid_and_animated(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        for name in CONSTANTS["NATIVE_EFFECTS"]:
            first = render(name, 1.0, "Up")
            second = render(name, 1.7, "Right")
            self.assertEqual(100, len(first), name)
            self.assertTrue(any(pixel != (0, 0, 0) for pixel in first), name)
            self.assertNotEqual(first, second, name)
            for pixel in first:
                self.assertEqual(3, len(pixel))
                self.assertTrue(all(channel in range(256) for channel in pixel))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards' tables")
    def test_fireworks_matches_rocket_burst_and_special_effect_id(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        spec = CONSTANTS["ALL_NATIVE_EFFECTS"]["Fireworks"]

        self.assertEqual(71, spec["effect_id"])
        self.assertEqual(10, spec["mode"])
        self.assertEqual("Fireworks", CONSTANTS["CLOCK_MIXER_EFFECTS"][10])
        self.assertEqual("Fireworks", cards()["mixerEffects"]["10"])
        # The colored confetti only unlocks when the clock command id (1st array
        # element) is overridden to 71; the clock config still uses mode 40.
        self.assertEqual(71, CONSTANTS["CLOCK_MIXER_COMMAND_IDS"][10])
        style_id, style = next(
            (style_id, style) for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items()
            if style["mixer"] == 10
        )
        self.assertEqual("Fireworks", style["name"])
        with instant_sleeps():
            light = make_light(_mode=CONST.MODE_CLOCK, _native_clock_style=style_id)
            run_on_loop(light._activate_native_clock())
        params = light._lamp_client.params("set_fx_effect")
        self.assertEqual(71, params[0])
        self.assertEqual(40, params[3]["mode"])

        # The preview is the lamp's renderer (test_lamp_renderers):
        # a white flare starts where the strip starts for the direction, Down
        # at the physical bottom-right, Up at the top-left.
        starts = {
            direction: render("Fireworks", 0.0, direction).index((255, 255, 255))
            for direction in ("Up", "Down", "Left", "Right")
        }
        self.assertEqual({"Up": 80, "Down": 19, "Left": 0, "Right": 99}, starts)

    def test_rainbow_flow_matches_dot_by_dot_rainbow_ribbon(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        # Mode 4 (Rainbow Flow) is a full rainbow that advances hue per-pixel in
        # reading order (diagonal bands) and is available as a clock mixer.
        self.assertEqual(4, CONSTANTS["ALL_NATIVE_EFFECTS"]["Moving palette"]["mode"])
        self.assertEqual(63, CONSTANTS["ALL_NATIVE_EFFECTS"]["Moving palette"]["effect_id"])
        self.assertEqual("Moving palette", CONSTANTS["CLOCK_MIXER_EFFECTS"][4])

        frame = render("Moving palette", 0.0, "Right")
        self.assertEqual(100, len(frame))

        # Dot-by-dot: adjacent columns within a row differ (a continuous
        # gradient), unlike Rainbow which paints each row a single color.
        top_row = [frame[(4 - 0) * 20 + col] for col in range(20)]
        self.assertGreater(len({tuple(p) for p in top_row}), 12)

        # The whole panel spans a full spectrum (hues cover all six sectors).
        hues = set()
        for pixel in frame:
            red, green, blue = (channel / 255 for channel in pixel)
            hue, sat, val = colorsys.rgb_to_hsv(red, green, blue)
            if sat > 0.2 and val > 0.2:
                hues.add(int(hue * 6) % 6)
        self.assertGreaterEqual(len(hues), 5)

        # It animates (scrolls) over time.
        self.assertNotEqual(frame, render("Moving palette", 1.5, "Right"))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards' tables")
    def test_named_effects_back_the_clock(self):
        # What the old per-effect tests said of the tables: the reference
        # frames of what the lamp draws now check it (test_lamp_effects).
        tables = cards()
        mixers = {
            4: "Moving palette", 6: "Particle path", 9: "Triangular palette pulses", 11: "Sine wave",
            18: "Sunrise and sunset", 19: "Heat fire", 22: "Mirrored comets", 24: "Palette sparks", 35: "Tide (slot 35)",
            54: "Rainbow noise", 56: "Violet interference", 57: "Night-amber waves", 58: "Navy-white noise", 59: "Night-sky waves",
            61: "Particle glows", 70: "Palette stripes", 79: "Violet twinkles",
        }
        for mixer, name in mixers.items():
            with self.subTest(name=name):
                self.assertEqual(name, CONSTANTS["CLOCK_MIXER_EFFECTS"][mixer])
                self.assertEqual(name, tables["mixerEffects"][str(mixer)])
                self.assertEqual(mixer, CONSTANTS["ALL_NATIVE_EFFECTS"][name]["mode"])
                # The style named like the effect (over the direct form for a
                # background with a style in each form, CLOCK_FORM_TWINS).
                styles = [
                    style for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
                    if style["mixer"] == mixer
                ]
                self.assertIn(name, [style["name"] for style in styles])
        self.assertEqual(
            {"name": "Violet interference", "mixer": 56}, CONSTANTS["NATIVE_CLOCK_STYLES"][15],
        )
        self.assertEqual(56, tables["styleMixer"]["15"])
        # The cards find a style's mixer by the style's name, or by the name
        # of the effect behind it.
        styles_by_name = {style["name"]: style["mixer"] for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()}
        for mixer, name in CONSTANTS["CLOCK_MIXER_EFFECTS"].items():
            with self.subTest(by_name=name):
                self.assertEqual(styles_by_name.get(name, mixer), tables["mixerByName"][name])
        # Mode 60 goes dark for long stretches: it never backs the clock.
        self.assertNotIn(60, CONSTANTS["CLOCK_MIXER_EFFECTS"])
        self.assertNotIn("60", tables["mixerEffects"])
        self.assertNotIn(60, {
            style["mixer"] for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
        })
        fixed = CONSTANTS["CLOCK_MIXER_FIXED_DIRECTION"]
        self.assertEqual("Left", fixed["Sine wave"])
        self.assertEqual("Right", fixed["Mirrored comets"])
        self.assertEqual("Right", fixed["Particle glows"])
        self.assertEqual("Up", fixed["Triangular palette pulses"])
        self.assertNotIn("Palette sparks", fixed)
        for direction in ("Right", "Down", "Left", "Up"):
            self.assertEqual(
                "Right", CONSTANTS["resolve_clock_mixer_direction"](direction, "Tide (slot 35)"),
            )

    def test_music_flow_previews_are_static_valid_and_distinct(self):
        render = NATIVE_PREVIEW["render_music_flow_effect"]
        previews = {}
        for name in CONSTANTS["MUSIC_FLOW_EFFECTS"]:
            first = render(name)
            self.assertEqual(first, render(name), name)
            self.assertEqual(100, len(first), name)
            self.assertTrue(any(pixel != (0, 0, 0) for pixel in first), name)
            for pixel in first:
                self.assertEqual(3, len(pixel))
                self.assertTrue(all(channel in range(256) for channel in pixel))
            previews[name] = tuple(first)
        self.assertEqual(len(previews), len(set(previews.values())))

    def test_matrix_cameras_use_static_music_flow_previews(self):
        # While Music Flow runs, the cameras show its fixed illustration
        # whatever the mode, and the picture does not animate for it; every
        # mode's frame is turned for the mount once (matrix_view.viewer_frame).
        camera_module = module("camera")
        render = NATIVE_PREVIEW["render_music_flow_effect"]
        view = module("matrix_view")
        for mode in (CONST.MODE_CLOCK, "Solid Color"):
            light = make_light(_mode=mode, _music_flow_enabled=True, _music_flow_effect="Blossom",
                               _device_orientation="up")
            camera = camera_module.YeelightCubeMatrixCameraSquare(light, light._config_entry)
            with patch.object(camera, "_get_music_flow_preview", wraps=camera._get_music_flow_preview) as preview:
                colors = camera._get_matrix_colors()
            preview.assert_called_once()
            self.assertEqual(render("Blossom"), camera._get_music_flow_preview())
            self.assertEqual(mode == CONST.MODE_CLOCK, camera._is_native_preview_mode())
            frame = camera._view_frame()[0]
            self.assertEqual(view.viewer_frame(colors, "up"), frame)

    def test_matrix_colors_publish_what_the_lamp_shows(self):
        """matrix_colors never republishes a stale plugin frame: black when
        off, empty while the lamp draws on its own (clock, native effect, music flow)."""
        lamp = make_light(_mode="Custom Draw", _is_on=True)
        # The last pixel art the plugin drew, kept after switching away.
        lamp._base_matrix_colors = [(200, 100, 50)] * 100
        # Never darkened: the lamp dims in hardware (the cards scale them).
        self.assertEqual([(200, 100, 50)] * 100, lamp._published_matrix_colors())
        self.assertEqual(lamp._published_matrix_colors(), lamp.extra_state_attributes["matrix_colors"])
        for mode in ("Clock", "Native Effect"):
            lamp._mode = mode
            self.assertEqual([], lamp._published_matrix_colors(), mode)
            self.assertEqual([], lamp.extra_state_attributes["matrix_colors"], mode)
        lamp._mode, lamp._music_flow_enabled = "Custom Draw", True
        self.assertEqual([], lamp._published_matrix_colors())
        for mode in ("Clock", "Custom Draw"):
            lamp._is_on, lamp._mode = False, mode
            self.assertEqual([(0, 0, 0)] * 100, lamp._published_matrix_colors())
            self.assertEqual([(0, 0, 0)] * 100, lamp.extra_state_attributes["matrix_colors"])

    def test_clock_mixer_effects_map_to_supported_native_effects(self):
        mixer_effects = CONSTANTS["CLOCK_MIXER_EFFECTS"]
        native_effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        clock_styles = CONSTANTS["NATIVE_CLOCK_STYLES"]
        render = NATIVE_PREVIEW["render_native_effect"]
        # Every mapped effect must be a real, renderable native effect.
        for mixer, effect_name in mixer_effects.items():
            self.assertIn(effect_name, native_effects)
            frame = render(effect_name, 3.0, CONSTANTS["CLOCK_MIXER_EFFECT_DIRECTION"])
            self.assertEqual(100, len(frame))
        # The mixer ids must match the corresponding clock styles' mixers, and a
        # mixer must resolve to the same effect that shares its lamp id.
        self.assertEqual("Rainbow", mixer_effects[clock_styles[1]["mixer"]])
        self.assertEqual("Waves", mixer_effects[clock_styles[2]["mixer"]])
        self.assertEqual("Spectrum", mixer_effects[clock_styles[3]["mixer"]])
        for mixer, effect_name in mixer_effects.items():
            self.assertEqual(mixer, native_effects[effect_name]["mode"])

    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards' tables")
    def test_named_renderable_effects_back_the_clock(self):
        mixer_effects = CONSTANTS["CLOCK_MIXER_EFFECTS"]
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        dirs = CONSTANTS["NATIVE_EFFECT_DIRECTIONS"]
        tables = cards()
        # Named effects must show through the clock (previously only a curated
        # subset did) -- including four-direction effects and direction-less
        # ones like Starry sky (whose blue color previously fell back to the
        # default yellow gradient).
        for name in (
            "Waterfall", "Aurora", "Fire", "Flower Sea", "Kaleidoscope", "Starry Sky",
            "Ribbon", "Bouncing Ball", "Tide", "Magic", "Wonderland",
        ):
            self.assertEqual(name, mixer_effects[effects[name]["mode"]])
            self.assertEqual(name, tables["mixerEffects"][str(effects[name]["mode"])])
        # The cards' table is effect_catalog.py's.
        self.assertEqual({str(mixer): name for mixer, name in mixer_effects.items()}, tables["mixerEffects"])
        # Every effect with a full/absent direction set (except mostly-black
        # modes) qualifies; partial-direction Hacking and the stored GIF do not.
        for name, spec in effects.items():
            eligible = (
                spec["mode"] != CONSTANTS["LAMP_STORED_GIF_SLOT"]
                and spec.get("directions") in (None, dirs)
                and spec["mode"] not in CONSTANTS["_NON_CLOCK_EFFECT_MODES"]
            )
            if spec.get("streamed"):
                # The integration's own effect: a clock style over it by name
                # (its ``background``), no lamp mixer.
                self.assertNotIn(spec["mode"], mixer_effects)
                continue
            self.assertEqual(eligible, spec["mode"] in mixer_effects)
        # Hacking, Meteor, Building Blocks, and Palette are excluded: the
        # lamp rejects these clock/mixer combinations.
        for name in ("Hacking", "Meteor", "Building Blocks", "Palette"):
            self.assertNotIn(name, mixer_effects.values())
            self.assertNotIn(effects[name]["mode"], mixer_effects)
            style = next(
                (s for s in CONSTANTS["NATIVE_CLOCK_STYLES"].values() if s.get("mixer") == effects[name]["mode"]),
                None,
            )
            self.assertIsNone(style, f"{name} must not have a clock style")

    def test_brightness_only_turn_on_keeps_native_mode_running(self):
        # A brightness change on a running clock or effect only sets the
        # brightness: activating again would restart the lamp's animation
        # from its first frame. Turned on from off, the mode is activated.
        with instant_sleeps():
            for mode in (CONST.MODE_CLOCK, CONST.MODE_NATIVE_EFFECT):
                with self.subTest(mode=mode):
                    light = make_light(_mode=mode, _native_effect="Rainbow", _is_on=True,
                                       _last_hardware_brightness=100)
                    run_on_loop(light.async_turn_on(brightness=100))
                    self.assertEqual(["set_bright"], light._lamp_client.methods())
                    light = make_light(_mode=mode, _native_effect="Rainbow", _is_on=False)
                    run_on_loop(light.async_turn_on(brightness=100))
                    self.assertIn("set_fx_effect", light._lamp_client.methods())
                    # Already on, a turn_on with more than the brightness activates again.
                    light = make_light(_mode=mode, _native_effect="Rainbow", _is_on=True,
                                       _last_hardware_brightness=100)
                    run_on_loop(light.async_turn_on(brightness=100, rgb_color=(255, 0, 0)))
                    self.assertNotEqual(["set_bright"], light._lamp_client.methods())



    def test_clock_style_inherits_mixer_effect_default_color(self):
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        styles = CONSTANTS["NATIVE_CLOCK_STYLES"]
        default_color = CONSTANTS["clock_style_default_color"]
        # Every effect that carries a default color (e.g. Waterfall = 255) must
        # be reachable as a clock style whose mixer equals that effect's mode
        # (unless the effect is excluded from the clock entirely), and the
        # shared helper must resolve that color from the style.
        colored = {name: spec for name, spec in effects.items() if spec.get("color") is not None}
        self.assertIn("Waterfall", colored)
        non_clock = CONSTANTS["_NON_CLOCK_EFFECT_MODES"]
        backing = {}
        for name, spec in colored.items():
            style_id, style = next(
                ((i, s) for i, s in styles.items() if s.get("mixer") == spec["mode"]), (None, None),
            )
            if spec["mode"] in non_clock:
                self.assertIsNone(style, f"{name} must not have a clock style")
                continue
            self.assertIsNotNone(style, f"no clock style backs {name}")
            self.assertEqual(spec["color"], default_color(style))
            backing[style_id] = style
        # A solid-color style keeps its own color; a mixer effect without a
        # default color resolves to None.
        self.assertEqual(styles[6]["color"], default_color(styles[6]))
        self.assertIsNone(default_color({"mixer": 39}))
        # What is sent with no color chosen, by the activation and by a
        # button playlist entry: the style's colors (clock_style_colors),
        # the effect's default color among them.
        light = make_light(_native_clock_color=None, _native_clock_color_mode="normal")
        for style_id, style in backing.items():
            with self.subTest(style=style["name"]):
                light._native_clock_style = style_id
                params = light._native_clock_params()
                self.assertEqual(CONSTANTS["clock_style_colors"](style), params[3]["color"])
                self.assertEqual(default_color(style), params[3]["color"][0])
                if style.get("background") not in CONSTANTS["LITE_STREAMED_EFFECTS"]:
                    item = light._effect_persist_item(CONSTANTS["BUTTON_CLOCK_PREFIX"] + style["name"])
                    self.assertEqual(CONSTANTS["clock_style_colors"](style), item["effect_params"][0]["color"])
        # clock_style_colors: the one color, or every colour word of a
        # background that draws them (the clock's color first), or none.
        colors = CONSTANTS["clock_style_colors"]
        self.assertEqual([styles[6]["color"]], colors(styles[6]))
        self.assertEqual([0x01123456], colors(styles[6], 0x01123456))
        self.assertEqual([], colors({"mixer": 39}))
        self.assertEqual([0x01123456], colors({"mixer": 39}, 0x01123456))
        for mode, words in CONSTANTS["_EXTENDED_EFFECT_COLORS"].items():
            self.assertEqual(list(words), colors({"mixer": mode}))
            self.assertEqual([0x01123456, *words[1:]], colors({"mixer": mode}, 0x01123456))
            self.assertLessEqual(len(words), 4)

    def test_clock_preview_masks_native_effect_and_keeps_colon_blink(self):
        # The camera's clock (masking every style's background to its digits)
        # is drawn and compared frame by frame in test_clock_presets
        # (ClockPreviewTests); here the face it masks with (clock_face.py,
        # shared with the palette clock streamed to the lamp): the colon
        # blinks, 12-hour time shows 21:05 as 09:05.
        face = module("clock_face")
        evening = datetime.datetime(2026, 11, 15, 21, 5, 7)
        light = make_light(_native_clock_content="time", _native_clock_12_hour=False)
        self.assertEqual("21:05", face.clock_text(evening, face.clock_content(light), False, True)[0])
        self.assertEqual("09:05", face.clock_text(evening, face.clock_content(light), True, True)[0])
        shown = {face.clock_text(evening.replace(second=second), "time", False, True)[1] for second in (6, 7)}
        self.assertEqual({True, False}, shown)
        self.assertEqual({True}, {face.clock_text(evening.replace(second=s), "time", False, False)[1] for s in (6, 7)})
        # The digits turned a half turn on a turned mount are the upright
        # ones mirrored through the centre (columns shown: 20).
        upright = {pixel for pixel, *_ in face.clock_digit_pixels("21:05", True, 0, False, 20)}
        turned = {pixel for pixel, *_ in face.clock_digit_pixels("21:05", True, 0, True, 20)}
        self.assertEqual({99 - index for index in upright}, turned)
        # The JS card mirrors the same masking and colon-blink behaviour.
        self.assertIn("CLOCK_MIXER_EFFECTS", CLOCK_CARD_SOURCE)
        self.assertIn("lampClockSettings(", CLOCK_CARD_SOURCE)
        self.assertIn("effectFrame[index]", CLOCK_CARD_SOURCE)
        # Turned: a half turn across the blocks' columns (clockColumns), on
        # the frame's stride (20, or a longer Cube Matrix's width).
        self.assertIn("const column = strip[turned ? stripWidth - 1 - col : col];", CLOCK_CARD_SOURCE)
        self.assertIn("const at = (turned ? 4 - row : row) * width + column;", CLOCK_CARD_SOURCE)
        self.assertIn("clockDigitTargets(at, digitFlags, columns * 5, width)", CLOCK_CARD_SOURCE)
        self.assertIn("colonVisible", CLOCK_CARD_SOURCE)

    def test_clock_style_sends_and_previews_mixer_direction(self):
        resolve = CONSTANTS["resolve_clock_mixer_direction"]
        mixer_effects = CONSTANTS["CLOCK_MIXER_EFFECTS"]
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        fixed = CONSTANTS["CLOCK_MIXER_FIXED_DIRECTION"]

        # Four-direction clock mixer effects flow in the selected native-effect
        # direction (unless pinned to a fixed orientation); direction-less
        # effects resolve to None so the clock omits the direction byte.
        for label in ("Right", "Down", "Left", "Up"):
            for effect_name in mixer_effects.values():
                if effect_name in fixed:
                    expected = fixed[effect_name]
                elif effects[effect_name].get("directions"):
                    expected = label
                else:
                    expected = None
                self.assertEqual(expected, resolve(label, effect_name))
        # Spectrum Chase's clock background always renders Up on the hardware.
        self.assertEqual("Up", fixed["Particle path"])
        for label in ("Right", "Down", "Left", "Up"):
            self.assertEqual("Up", resolve(label, "Particle path"))
        # Pulse's clock background always renders Up too, regardless of the
        # selected native-effect direction.
        self.assertEqual("Up", fixed["Sunrise and sunset"])
        for label in ("Right", "Down", "Left", "Up"):
            self.assertEqual("Up", resolve(label, "Sunrise and sunset"))
        # Spectrum Bands is the exception that renders Right, not Up.
        self.assertEqual("Right", fixed["Palette stripes"])
        for label in ("Right", "Down", "Left", "Up"):
            self.assertEqual("Right", resolve(label, "Palette stripes"))
        # A direction-less effect or unknown mixer yields no direction byte.
        self.assertIsNone(resolve("Up", "Magic"))
        self.assertIsNone(resolve("Up", None))

        # What the clock activation sends, style by style (the handed-over
        # form): no direction byte for a direction-less background, the same
        # one whatever is selected for a pinned one, else the selected
        # direction, sent as its background effect is on this mount (the
        # one-axis effects are chosen for the profile instead).
        for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items():
            effect = CONSTANTS["clock_style_effect"](style)
            if not effect or CONSTANTS["clock_style_direct"](style) or style.get("background"):
                continue
            with self.subTest(style=style["name"]):
                sent = {}
                for label in ("Up", "Down", "Left", "Right"):
                    light = make_light(_mode=CONST.MODE_CLOCK, _native_clock_style=style_id,
                                       _native_effect_direction=label, _device_orientation="right")
                    sent[label] = light._native_clock_params()[3].get("direction")
                    resolved = resolve(label, effect)
                    if resolved is not None and not effects[effect].get("one_axis") and effect not in fixed:
                        alone = make_light(_mode=CONST.MODE_NATIVE_EFFECT, _native_effect=effect,
                                           _native_effect_direction=resolved, _device_orientation="right")
                        self.assertEqual(alone._native_effect_params()[3]["direction"], sent[label], label)
                if resolve("Up", effect) is None:
                    self.assertEqual({None}, set(sent.values()))
                elif effect in fixed:
                    self.assertEqual(1, len(set(sent.values())))
                elif not effects[effect].get("one_axis"):
                    self.assertEqual(4, len(set(sent.values())))

        # The lamp ignores a clock's direction: a raw clock leaves the effects' one.
        lamp = _reflected_fx_lamp(
            True, 2, {"mode": 40, "direction": CONSTANTS["NATIVE_EFFECT_DIRECTION_VALUES"]["Down"]}
        )
        self.assertIsNone(lamp._native_effect_direction)

        # The lamp keeps the direction that maps to 0 whatever is sent (mode 40),
        # and both previews draw the background so, whatever the lamp's
        # native-effect direction (lamp_clock_settings, on the fixture; the
        # camera's clock is compared with it in test_clock_presets).
        renderers = runpy.run_path(ROOT / "lamp_renderers.py")
        for effect_name in mixer_effects.values():
            self.assertEqual(2, renderers["lamp_clock_settings"](effect_name, 50)["direction"])
        if shutil.which("node"):
            self.assertEqual({name: 2 for name in mixer_effects.values()}, cards()["clockDirection"])

    def test_native_effect_send_keeps_lamp_direction_remap(self):
        # REGRESSION GUARD: the lamp's `direction_remap` on the SEND path is the
        # ground truth that makes the lamp's physical flow match the arrow.
        # Removing it silently flips the lamp's up/down for _SWAP_UP_DOWN effects
        # (Ocean Waves, Rainbow, ...). Previews follow it (lamp_settings).
        direction = CONSTANTS["effect_direction_value"]
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        values = CONSTANTS["NATIVE_EFFECT_DIRECTION_VALUES"]
        self.assertEqual(values["Down"], direction(effects["Rainbow"], "Up"))
        self.assertEqual(values["Up"], direction(effects["Fire"], "Up"))
        # What is sent, on a lamp at the profile directions are calibrated on
        # (2: not compensated): Rainbow's "Up" as the lamp's down value, Fire's as up.
        with instant_sleeps():
            for effect, wanted in (("Rainbow", "Down"), ("Fire", "Up")):
                light = make_light(_mode=CONST.MODE_NATIVE_EFFECT, _native_effect=effect,
                                   _native_effect_direction="Up", _device_orientation="right",
                                   effect_profile=2)
                run_on_loop(light._activate_native_effect())
                self.assertEqual(values[wanted], light._lamp_client.params("set_fx_effect")[3]["direction"], effect)

    def test_a_raw_send_reflects_clock_style_for_live_preview(self):
        # The send_fx_effect action shows what it sent on the light, persisted
        # or not (the default): the clock style itself (not just the mode),
        # its color and options, so the preview card renders the correct
        # masked effect / color, as a normal clock-style selection would; the
        # linked settings controls are refreshed.
        services = module("light_services_diagnostics")
        hass = FakeHass({CONST.DOMAIN: {}})
        LIGHT_MODULE.async_setup_light_services(hass)
        handler = hass.registered[(CONST.DOMAIN, "send_fx_effect")]
        style = next(iter(CONSTANTS["NATIVE_CLOCK_STYLES"]))
        data = base64.b64encode(bytes([3, 8, 1, 1])).decode("ascii")
        light = make_light(hass=hass, entity_id="light.cube", _refresh_linked_entities=Mock(),
                           async_write_ha_state=Mock(), _mode="Solid Color")
        self.addCleanup(LIGHT_MODULE._ENTITY_REGISTRY.pop, "test-raw-send", None)
        LIGHT_MODULE._ENTITY_REGISTRY["test-raw-send"] = light
        params = [CONSTANTS["NATIVE_CLOCK_EFFECT_ID"], style, 2, {"mode": 40, "color": [0x123456], "data": data}]
        call = types.SimpleNamespace(data={"entity_id": "light.cube", "params": params}, hass=hass,
                                     context=types.SimpleNamespace(user_id=None))
        with instant_sleeps("light_services_diagnostics", "light_native", "light_display", "light"):
            self.assertIs(services, sys.modules[handler.__module__])
            run_on_loop(handler(call))
        self.assertEqual(["set_fx_effect"], [m for m in light._lamp_client.methods() if m == "set_fx_effect"])
        self.assertEqual(light._mode, CONSTANTS["MODE_CLOCK"])
        self.assertEqual(light._native_clock_style, style)
        self.assertEqual(light._native_clock_color, 0x123456)
        self.assertEqual(light._native_clock_content, "date")
        self.assertTrue(light._native_clock_12_hour)
        self.assertFalse(light._native_clock_colon_blink)
        light._refresh_linked_entities.assert_called()
        # A native effect: its speed (clamped) and direction.
        lamp = _reflected_fx_lamp(False, 0, {"rate": 999, "direction": 0}, "Rainbow")
        self.assertEqual((lamp._mode, lamp._native_effect), (CONSTANTS["MODE_NATIVE_EFFECT"], "Rainbow"))
        self.assertEqual(lamp._native_effect_speed, 255)
        # The card derives the effect from clock_style_id, so it must be the
        # attribute that gets updated: it resolves every style's mixer, but
        # the style over the stored GIF, which the cards do not know yet
        # (clock-preview-utils.js leaves slot 71 out; they draw it as mixer 0).
        self.assertEqual(style, light.extra_state_attributes["clock_style_id"])
        if shutil.which("node"):
            gif = CONSTANTS["LAMP_STORED_GIF_SLOT"]
            mixers = cards()["mixerById"]
            self.assertEqual(
                {str(i): s["mixer"] for i, s in CONSTANTS["NATIVE_CLOCK_STYLES"].items() if s["mixer"] != gif},
                {i: mixer for i, mixer in mixers.items() if CONSTANTS["NATIVE_CLOCK_STYLES"][int(i)]["mixer"] != gif},
            )

    def test_the_outer_id_of_the_other_effects_installs_what_3_did(self):
        # A command sends its mode, rate, direction and colours: of the preset
        # row it starts from it keeps the colour selector and, unless sent,
        # the intensity (lamp_renderers.PRESET_ROWS). 63's are 3's.
        rows = LAMP_RENDERERS["PRESET_ROWS"]
        self.assertEqual(rows[3], rows[CONSTANTS["EXTENDED_EFFECT_COMMAND_ID"]])

    def test_extended_native_effects_are_hidden_gradient_modes(self):
        official = CONSTANTS["NATIVE_EFFECTS"]
        extended = CONSTANTS["EXTENDED_NATIVE_EFFECTS"]
        merged = CONSTANTS["ALL_NATIVE_EFFECTS"]
        official_modes = {spec["mode"] for spec in official.values()}
        clock_mode = CONSTANTS["NATIVE_CLOCK_EFFECT_ID"]
        # Every slot of the lamp that isn't a dead end, already an official effect
        # or the clock renderer is exposed as an extended effect.
        expected_modes = {
            m for m in range(1, 82)
            if m not in official_modes and m != clock_mode
            and m not in (12, 13, 29, 36, 50, 53, 64, 67, 78)
        }
        self.assertEqual(
            expected_modes, {spec["mode"] for spec in extended.values()}
        )
        # Official effect modes and the clock mode must be skipped.
        for skipped in (3, 5, 42, 46, 47, 48, 49, 55, 80, 81):
            self.assertNotIn(str(skipped), extended)
        self.assertNotIn(str(clock_mode), extended)
        # Named clock-mixer effects use their given names + modes.
        named = {
            "Neon sine bands": 75,
            "Moving palette": 4,
            "Particle path": 6,
            "Triangular palette pulses": 9,
            "Fireworks": 10,
            "Sine wave": 11,
            "Sunrise and sunset": 18,
            "Heat fire": 19,
            "Mirrored comets": 22,
            "Palette sparks": 24,
            "Tide (slot 35)": 35,
            "Rainbow noise": 54,
            "Violet interference": 56,
            "Night-amber waves": 57,
            "Navy-white noise": 58,
            "Night-sky waves": 59,
            "Flicker sweep": 60,
            "Particle glows": 61,
            "Palette stripes": 70,
            "Violet twinkles": 79,
        }
        for effect_name, mode in named.items():
            self.assertIn(effect_name, extended)
            self.assertEqual(mode, extended[effect_name]["mode"])
        for name, spec in extended.items():
            # Fireworks' preset row, and the stored GIF played as the app
            # plays it (the app reads its GIF tile only with effect 71). The
            # others: 63, no effect of the app's (3 showed Ribbon there).
            self.assertEqual(71 if name in ("Fireworks", "Stored GIF") else 63, spec["effect_id"])
            self.assertNotIn(spec["effect_id"], APP_EFFECT_IDS)
            # The stored GIF and the Yeelight app's music modes are offered
            # like the official effects.
            self.assertEqual(
                name != "Stored GIF" and spec["mode"] not in CONSTANTS["APP_MUSIC_SLOTS"],
                spec.get("extended"),
            )
            self.assertEqual(
                spec["mode"] not in CONSTANTS["_EXTENDED_EFFECT_NO_SPEED"], spec.get("speed")
            )
            self.assertNotIn(spec["mode"], official_modes)
            # The other slots are the ones named by number until 1.4.0.
            if name not in named:
                self.assertIn(spec["mode"], CONSTANTS["FORMERLY_NUMBERED_SLOTS"])
        # Official list is untouched; merged is the exact union.
        self.assertEqual(18, len(official))
        self.assertEqual(
            {**official, **extended, **CONSTANTS["LAMP_ANIMATION_EFFECTS"], **CONSTANTS["MATRIX_VERSION_EFFECTS"],
             **CONSTANTS["STREAMED_EFFECTS"]},
            merged,
        )

    def test_nothing_offered_is_outside_the_lamp_tables(self):
        # The lamp has no mode above 81: one sent runs something undefined.
        # The integration's own effects have slots past it, and are only
        # ever streamed (light_native.names_streamed_slot).
        for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values():
            if spec.get("streamed"):
                self.assertTrue(CONSTANTS["streamed_slot"](spec["mode"]))
            else:
                self.assertLess(spec["mode"], 82)
        for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values():
            if style.get("background") in CONSTANTS["STREAMED_EFFECTS"]:
                self.assertTrue(CONSTANTS["streamed_slot"](style["mixer"]))
            else:
                self.assertLess(style["mixer"], 82)
        self.assertFalse(any(CONSTANTS["streamed_slot"](mode) for mode in range(82)))
        # The empty slots draw nothing.
        modes = {spec["mode"] for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values()}
        self.assertFalse(modes & {12, 13, 29, 78})

    def test_a_button_playlist_sends_the_direction_activation_does(self):
        # A button entry runs the effect as an activation would send it.
        with instant_sleeps():
            for effect in ("Rainbow", "Fire", "Waves"):
                for label in ("Up", "Left"):
                    light = make_light(_mode=CONST.MODE_NATIVE_EFFECT, _native_effect=effect,
                                       _native_effect_direction=label, _device_orientation="down")
                    run_on_loop(light._activate_native_effect())
                    sent = light._lamp_client.params("set_fx_effect")[3].get("direction")
                    item = light._effect_persist_item(effect)
                    self.assertEqual(sent, item["effect_params"][0].get("direction"), (effect, label))

    def test_a_clock_rotation_follows_a_renamed_style(self):
        # A rotation saved with a style's former name shows the style.
        old, new = next(
            (old, new) for old, new in CONSTANTS["CLOCK_STYLE_ALIASES"].items()
            if not old.isdigit() and new != old
        )
        light = make_light(_native_clock_style=None, _execute_hardware_op=AsyncMock(return_value=True))
        with instant_sleeps():
            run_on_loop(light._apply_rotation_clock({"name": old, "color_mode": "normal"}))
        self.assertEqual(new, CONSTANTS["NATIVE_CLOCK_STYLES"][light._native_clock_style]["name"])

    def test_every_effect_has_one_family(self):
        families = CONSTANTS["EFFECT_FAMILIES"]
        slots = [mode for modes in families.values() for mode in modes]
        self.assertEqual(len(slots), len(set(slots)))
        self.assertEqual(
            {spec["mode"] for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values()}, set(slots)
        )

    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards' tables")
    def test_the_cards_family_names_match_the_slots(self):
        offline = {
            name: family for family, names in cards()["familyNames"].items() for name in names
        }
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        self.assertEqual(
            offline,
            {name: CONSTANTS["effect_family"](spec) for name, spec in effects.items() if name in offline},
        )
        self.assertTrue(set(offline) <= set(effects))

    def test_a_dead_end_slot_is_neither_an_effect_nor_a_clock_style(self):
        dead_ends = {12, 13, 29, 36, 50, 53, 64, 67, 78}
        self.assertEqual(dead_ends, set(CONSTANTS["LAMP_DEAD_END_SLOTS"]))
        self.assertFalse(
            dead_ends & {spec["mode"] for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values()}
        )
        self.assertFalse(
            dead_ends & {style["mixer"] for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()}
        )
        # Not the same thing as freezing: that command keeps using slot 64.
        display = (ROOT / "light_actions_display.py").read_text(encoding="utf-8")
        self.assertIn('return [64, 0, 4, {"mode": 64}]', display)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards' tables")
    def test_the_lamps_default_speed_is_the_presets(self):
        self.assertEqual(128, CONSTANTS["DEFAULT_NATIVE_EFFECT_SPEED"])
        self.assertEqual(128, make_light()._native_effect_speed)
        self.assertEqual(128, cards()["defaultSpeed"])
        self.assertEqual(CONSTANTS["UNDIRECTED_EFFECT_DIRECTION"], cards()["undirected"])
        self.assertEqual(0, cards()["undirected"])

    def test_an_undirected_effect_has_its_preset_rows_direction(self):
        import tests.test_lamp_effects as lamp_effects

        rows = lamp_effects.LAMP["PRESET_ROWS"]
        fixed = CONSTANTS["UNDIRECTED_EFFECT_DIRECTION"]
        for name, spec in CONSTANTS["ALL_NATIVE_EFFECTS"].items():
            if not spec.get("directions"):
                self.assertEqual(fixed, rows[spec["effect_id"]][3], name)

    def test_a_clock_style_keeps_its_id(self):
        # Saved clock styles are ids: the styles left must not move.
        styles = CONSTANTS["NATIVE_CLOCK_STYLES"]
        # The two styles over the direct form come next (CLOCK_FORM_TWINS),
        # then a style over each of the Cube Matrix's own versions, then over
        # each of the integration's own effects.
        self.assertEqual(90, max(styles))
        self.assertEqual(
            {85: "Northern Lights", 86: "Rose Sea", 87: "Dark palette pulses", 88: "Knight Rider",
             89: "Lava Lamp", 90: "Falling Blocks"},
            {i: styles[i]["name"] for i in (85, 86, 87, 88, 89, 90)},
        )
        self.assertEqual(
            {36: ("Comet stream", 22, False), 59: ("Music flipped equalizer", 51, False),
             83: ("Mirrored comets", 22, True), 84: ("Music noise equalizer", 51, True)},
            {i: (s["name"], s["mixer"], CONSTANTS["clock_style_direct"](s))
             for i, s in styles.items() if s["mixer"] in (22, 51)},
        )
        self.assertEqual(
            {70: 72, 71: 73, 72: 74, 79: 81, 80: 82},
            {s["mixer"]: i for i, s in styles.items() if s["mixer"] in (79, 80, 72, 71, 70)},
        )
        self.assertEqual("Neon sine bands", next(s["name"] for s in styles.values() if s["mixer"] == 75))
        self.assertEqual("Magic", next(s["name"] for s in styles.values() if s["mixer"] == 76))
        self.assertEqual(
            {75: 77, 76: 78},
            {s["mixer"]: i for i, s in styles.items() if s["mixer"] in (75, 76)},
        )

    def test_the_rate_stays_under_the_lamp_limits(self):
        rate = CONSTANTS["lamp_rate"]
        self.assertEqual(254, rate(28, 255))
        self.assertEqual(254, rate(28, 254))
        self.assertEqual(239, rate(51, 255))
        self.assertEqual(239, rate(51, 240))
        self.assertEqual(238, rate(51, 238))
        self.assertEqual(255, rate(39, 255))
        # What is sent at the top speed: the lamp's limit, for a clock style
        # and for an effect.
        clock = next(i for i, s in CONSTANTS["NATIVE_CLOCK_STYLES"].items() if s["mixer"] == 28)
        effect = next(n for n, s in CONSTANTS["ALL_NATIVE_EFFECTS"].items() if s["mode"] == 51)
        with instant_sleeps():
            light = make_light(_mode=CONST.MODE_CLOCK, _native_clock_style=clock, _native_effect_speed=255)
            run_on_loop(light._activate_native_clock())
            self.assertEqual(254, light._lamp_client.params("set_fx_effect")[3]["rate"])
            light = make_light(_mode=CONST.MODE_NATIVE_EFFECT, _native_effect=effect, _native_effect_speed=255)
            run_on_loop(light._activate_native_effect())
            self.assertEqual(239, light._lamp_client.params("set_fx_effect")[3]["rate"])

    def test_magic_and_neon_are_their_own_slots(self):
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        self.assertEqual((92, 76), (effects["Magic"]["effect_id"], effects["Magic"]["mode"]))
        self.assertEqual((63, 75), (effects["Neon sine bands"]["effect_id"], effects["Neon sine bands"]["mode"]))
        self.assertTrue(effects["Neon sine bands"]["extended"])
        self.assertNotIn("76", effects)
        # Neon keeps what it was sent as Magic: no direction, on effects or clocks.
        self.assertNotIn("directions", effects["Neon sine bands"])
        self.assertIsNone(CONSTANTS["resolve_clock_mixer_direction"]("Right", "Neon sine bands"))
        self.assertEqual("Neon sine bands", CONSTANTS["CLOCK_MIXER_EFFECTS"][75])
        self.assertEqual("Magic", CONSTANTS["NATIVE_EFFECT_ALIASES"]["76"])
        # A rotation saved as "76" (Magic's former name) shows Magic.
        light = make_light(_native_effect="Rainbow", _execute_hardware_op=AsyncMock(return_value=True))
        with instant_sleeps():
            run_on_loop(light._apply_rotation_native({"name": "76", "color_mode": "normal"}))
        self.assertEqual("Magic", light._native_effect)

    def test_spectrum_has_no_speed(self):
        # Slot 17 reads no rate (the lamp; the app hides it too), and does not move.
        self.assertFalse(CONSTANTS["ALL_NATIVE_EFFECTS"]["Spectrum"].get("speed"))
        render = NATIVE_PREVIEW["render_native_effect"]
        self.assertEqual(render("Spectrum", 0.0, "Up"), render("Spectrum", 40.0, "Up"))

    def test_tide_has_directions_and_keeps_its_picture(self):
        spec = CONSTANTS["ALL_NATIVE_EFFECTS"]["Tide"]
        value = lambda label: CONSTANTS["effect_direction_value"](spec, label)
        self.assertEqual(list(CONSTANTS["NATIVE_EFFECT_DIRECTIONS"]), list(spec["directions"]))
        # Right, the default mount, is the lamp direction it always ran.
        self.assertEqual({"Right": 0, "Left": 1, "Up": 2, "Down": 3}, {d: value(d) for d in spec["directions"]})
        self.assertEqual("Right", CONSTANTS["resolve_clock_mixer_direction"]("Up", "Tide"))
        render = NATIVE_PREVIEW["render_native_effect"]
        phase = 3.7
        right, left = render("Tide", phase, "Right"), render("Tide", phase, "Left")
        up, down = render("Tide", phase, "Up"), render("Tide", phase, "Down")
        self.assertEqual(right[::-1], left)
        self.assertEqual(up[::-1], down)
        self.assertNotEqual(right, up)
        self.assertTrue(any(any(pixel) for pixel in up))

    def test_every_effect_and_clock_style_is_offered_without_a_setting(self):
        # No Experimental Features setting any more: the dropdowns offer
        # everything (the animations only while a server delivers the
        # Yeelight commands).
        select = module("select")
        light = make_light()
        self.assertFalse(hasattr(light, "_extended_effects_enabled"))
        self.assertFalse(hasattr(module("switch"), "ExtendedEffectsSwitch"))
        offered = set(select.YeelightCubeNativeEffectSelect(light, None).options)
        listed = {
            name for name, spec in CONSTANTS["ALL_NATIVE_EFFECTS"].items()
            if not spec.get("hidden") and not spec.get("animation") and name != "Stored GIF"
            and not spec.get("matrix_version_of")
        }
        self.assertLessEqual(listed, offered)
        self.assertTrue({name for name in offered if CONSTANTS["ALL_NATIVE_EFFECTS"][name].get("extended")})
        styles = select.YeelightCubeClockStyleSelect(light, None).options
        self.assertIn(CONSTANTS["NATIVE_CLOCK_STYLES"][15]["name"], styles)
        self.assertIn(15, CONSTANTS["EXPERIMENTAL_CLOCK_STYLE_IDS"])
        self.assertFalse(any("experimental_required" in spec for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values()))
        # An animation without the Yeelight commands is refused, with its reason.
        animation = next(iter(CONSTANTS["LAMP_ANIMATION_EFFECTS"]))
        effect_select = select.YeelightCubeNativeEffectSelect(make_light(animations_available=False), None)
        with self.assertRaises(HomeAssistantError) as refused:
            run_on_loop(effect_select.async_select_option(animation))
        self.assertEqual("animation_needs_matter", refused.exception.translation_key)

    def test_experimental_clock_styles_mirror_native_effect_modes(self):
        clock_styles = CONSTANTS["NATIVE_CLOCK_STYLES"]
        all_effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        experimental = CONSTANTS["EXPERIMENTAL_CLOCK_STYLE_IDS"]
        clock_mode = CONSTANTS["NATIVE_CLOCK_EFFECT_ID"]

        # Every native-effect mode is available as a clock background, except
        # modes explicitly excluded because they read poorly as a clock or the
        # lamp rejects the clock/mixer combination.
        style_mixers = {style["mixer"] for style in clock_styles.values()}
        non_clock_modes = CONSTANTS["_NON_CLOCK_EFFECT_MODES"]
        for spec in all_effects.values():
            if spec["mode"] in non_clock_modes:
                self.assertNotIn(spec["mode"], style_mixers)
            else:
                self.assertIn(spec["mode"], style_mixers)
        # The clock renderer is never offered as its own background.
        self.assertNotIn(clock_mode, style_mixers)

        # Styles beyond the lamp's 10 built-ins are experimental, each maps to
        # a distinct mixer (but a background with a style in each form,
        # CLOCK_FORM_TWINS: its handed-over style is named for its look), and
        # named modes never appear as a bare number.
        twins = CONSTANTS["CLOCK_FORM_TWINS"]
        mode_to_name = {
            spec["mode"]: name for name, spec in all_effects.items()
            if not spec.get("animation") and not spec.get("matrix_version_of")
        }
        seen_mixers = set()
        for style_id, style in clock_styles.items():
            if style_id <= 10:
                continue
            self.assertIn(style_id, experimental)
            mixer = style["mixer"]
            direct = style.get("direct", False)
            self.assertNotIn((mixer, direct, style.get("background")), seen_mixers)
            seen_mixers.add((mixer, direct, style.get("background")))
            if style.get("background"):
                # Over a Cube Matrix's own version (effect_catalog.MATRIX_VERSION_EFFECTS).
                self.assertEqual(style["background"], style["name"])
            elif mixer in twins:
                self.assertEqual(twins[mixer][1 if direct else 0], style["name"])
            elif style_id > 15 and mixer in mode_to_name:
                self.assertEqual(mode_to_name[mixer], style["name"])
        # Labels stay unique so the reverse label -> id map never collapses.
        labels = [style["name"] for style in clock_styles.values()]
        self.assertEqual(len(labels), len(set(labels)))

    def test_dropdowns_sort_by_mode_and_mixer(self):
        # Native effects sort by lamp mode and clock styles by mixer.
        select = module("select")
        light = make_light()
        effects = select.YeelightCubeNativeEffectSelect(light, None).options
        modes = [CONSTANTS["ALL_NATIVE_EFFECTS"][name]["mode"] for name in effects]
        self.assertEqual(sorted(modes), modes)
        style_ids = {style["name"]: style_id for style_id, style in CONSTANTS["NATIVE_CLOCK_STYLES"].items()}
        mixers = [
            CONSTANTS["NATIVE_CLOCK_STYLES"][style_ids[name]]["mixer"]
            for name in select.YeelightCubeClockStyleSelect(light, None).options if name in style_ids
        ]
        self.assertEqual(sorted(mixers), mixers)

    def test_official_gallery_contains_68_valid_drawings(self):
        drawings = PIXEL_ART["get_builtin_pixel_arts"]()
        self.assertEqual(68, len(drawings))
        self.assertEqual(68, len({drawing["name"] for drawing in drawings}))
        for drawing in drawings:
            for pixel in drawing["pixels"]:
                self.assertIn(pixel["position"], range(100))
                self.assertEqual(3, len(pixel["color"]))
                self.assertTrue(all(channel in range(256) for channel in pixel["color"]))



def _reflected_fx_lamp(is_clock, style, config, native_effect_name=None):
    """A lamp after send_fx_effect reflected a raw command on it
    (light_actions_diagnostics.reflect_lamp_command)."""
    from tests.fakes import light_state

    lamp = light_state(
        _mode=None, _native_clock_style=None, _native_clock_color=None,
        _native_clock_content="time", _native_clock_show_date=False,
        _native_clock_12_hour=False, _native_clock_colon_blink=True,
        _native_effect=None, _native_effect_speed=50, _native_effect_direction=None,
        _device_orientation="right", effect_profile=None, is_cube_matrix=False,
    )
    lamp.reflect_lamp_command(is_clock, style, config, native_effect_name)
    return lamp


class NativeEffectCatalogTests(unittest.TestCase):
    """The light's native_effect_catalog attribute: built once per
    combination (it is published on every state write)."""

    def test_the_catalog_lists_the_same_effects_and_is_reused(self):
        import functools

        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        catalog = _load_standalone_functions(
            LIGHT_SOURCE, {"_native_effect_catalog"},
            {"functools": functools, "ALL_NATIVE_EFFECTS": effects,
             "effect_family": CONSTANTS["effect_family"],
             "LAMP_STORED_GIF_SLOT": CONSTANTS["LAMP_STORED_GIF_SLOT"]},
        )["_native_effect_catalog"]
        animations = set(CONSTANTS["LAMP_ANIMATION_EFFECTS"])
        names = lambda items: [item["name"] for item in items]
        # Every effect, experimental ones too (marked for the cards' badge),
        # with a preview; not the stored GIF (the animations are chosen
        # instead), but while it plays.
        stored = {"Stored GIF"}
        self.assertEqual(set(effects) - animations - stored, set(names(catalog(None))))
        self.assertIn("Stored GIF", names(catalog("Stored GIF")))
        self.assertTrue(any(item["extended"] for item in catalog(None)))
        self.assertTrue(all(item["preview"] for item in catalog(None)))
        self.assertIs(catalog(None), catalog(None))
        # The animations to upload only while a server delivers the Yeelight
        # commands, or while one plays.
        self.assertEqual(set(effects) - stored, set(names(catalog(None, True))))
        self.assertIn("Snowfall", names(catalog("Snowfall")))
        snowfall = next(item for item in catalog(None, True) if item["name"] == "Snowfall")
        self.assertEqual((snowfall["animation"], snowfall["family"], snowfall["speed"]), ("snowfall", "sparkles", True))

if __name__ == "__main__":
    unittest.main()
