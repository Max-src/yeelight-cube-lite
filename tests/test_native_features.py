"""Tests for Cube Lite native protocol definitions and bundled presets."""

import __future__
import ast
import importlib
import sys
import asyncio
import base64
import colorsys
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import time
import types
import unittest
from unittest.mock import Mock


ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"
CONSTANTS = runpy.run_path(ROOT / "const.py")
PIXEL_ART = runpy.run_path(ROOT / "builtin_pixel_art.py")
NATIVE_PREVIEW = runpy.run_path(ROOT / "native_effect_preview.py")
# The built-in effect / clock activation (light_native.py) as tests load it on
# its own: the activations and the helpers they call. live_effect_changes is a
# module function; the others are methods (NATIVE_ACTIVATION_METHODS).
NATIVE_ACTIVATION = frozenset({
    "effect_direction_sent", "lamp_direction",
    "_activate_native_effect", "_native_effect_params",
    "_activate_native_clock", "_native_clock_params",
    "_send_native", "_update_running_effect", "_native_renderer_shown",
    "_native_brightness_due", "live_effect_changes",
    "runs_lamp_music", "_clear_fx_mode_flag", "intensity_config",
})
NATIVE_ACTIVATION_METHODS = NATIVE_ACTIVATION - {
    "live_effect_changes", "effect_direction_sent", "lamp_direction",
    "runs_lamp_music", "intensity_config",
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
    )},
    **{name: COLOR_UTILS[name] for name in ("rgb_to_argb", "argb_to_rgb")},
    "compensate_direction": MOUNT_PROFILE["compensate_direction"],
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


def _function_source(source: str, name: str) -> str:
    tree = ast.parse(source)
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
    """Load selected helpers without importing Home Assistant."""
    tree = ast.parse(source)
    functions = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name in names
    ]
    namespace = {"json": json, **_DEFAULT_NAMESPACE}
    if extra_namespace:
        namespace.update(extra_namespace)
    exec(
        compile(
            ast.Module(body=functions, type_ignores=[]),
            "<helpers>",
            "exec",
            flags=__future__.annotations.compiler_flag,
        ),
        namespace,
    )
    return namespace


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
            _in_native_fw_mode=True, _mode="Solid Color", _display_overlay=False,
            _display_retry_count=0, MAX_DISPLAY_RETRIES=3, _ip="test", _custom_text="text",
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
    def test_every_native_effect_matches_between_camera_and_card(self):
        # The camera entity (Python) and the Lamp Preview / Native Effects
        # cards (JavaScript) draw the same frames: every effect of the
        # catalogue, in every direction, oriented like the lamp, with a
        # custom color and each palette mode it supports.
        supports = NATIVE_PREVIEW["effect_supports_color_mode"]
        modes = ("bw", "red_blue", "white_orange", "blue_yellow", "purple_orange")
        cases = [
            [effect, phase, direction, override, mode]
            for effect in sorted(CONSTANTS["ALL_NATIVE_EFFECTS"])
            for phase in (0, 0.37, 1, 2.5, 7.25)
            for direction in ("Up", "Down", "Left", "Right")
            for override, mode in (
                (None, None),
                ([180, 20, 60], None),
                *((None, mode) for mode in modes if supports(effect, mode)),
            )
        ]
        module_uri = (ROOT / "www" / "native-effect-preview.js").as_uri()
        timelines = NATIVE_PREVIEW["lamp_settings"].__globals__  # its own timelines
        lamp_uri = (ROOT / "www" / "lamp-renderers.js").as_uri()
        # A replay gives up at a time limit that differs between the languages:
        # the frames are computed ahead, in full.
        script = (
            f"import {{renderNativeEffectOriented}} from {json.dumps(module_uri)};"
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
            " ahead(args); return renderNativeEffectOriented(...args); })));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            input=json.dumps(cases), text=True, capture_output=True, check=True,
        )
        render = NATIVE_PREVIEW["render_native_effect_oriented"]
        mismatched = []
        for case, actual in zip(cases, json.loads(result.stdout), strict=True):
            effect, phase, direction, override, mode = case
            if effect in timelines["LAMP_RENDERED_EFFECTS"]:
                settings = timelines["lamp_settings"](effect, direction, 50, override, mode)
                if timelines["has_renderer"](settings["mode"]):
                    timeline = timelines["timeline_for"](settings)
                    timeline.frame_at(
                        timeline.first_shown() + int(phase / (0.25 + 50 / 55.0) / 0.04), True
                    )
            expected = [list(pixel) for pixel in render(*case)]
            if expected != actual:
                mismatched.append(case)
        self.assertEqual([], mismatched[:20], f"{len(mismatched)} of {len(cases)} frames differ")

    def test_clock_uses_lamp_clock_apply_mode(self):
        self.assertEqual(40, CONSTANTS["NATIVE_CLOCK_EFFECT_ID"])
        self.assertEqual(2, CONSTANTS["NATIVE_CLOCK_APPLY"])

    def test_clock_applies_brightness_after_activation(self):
        # The shared send path sets the brightness after set_fx_effect for
        # the clock only (it can drop the activation otherwise).
        function = _function_source(LIGHT_SOURCE, "_send_native")
        after = function[function.index('"set_fx_effect", params'):]
        self.assertIn('"clock:brightness"', after)
        self.assertIn("await self._set_native_mode_brightness()", after)

    def test_clock_color_override_cleared_for_any_active_palette_mode(self):
        # A custom color override must not linger once a palette mode (B&W,
        # Vivid, Retro Orange, ...) is active on an animated style - it would
        # otherwise re-tint the lamp's own palette remap. Solid styles
        # have no mixer effect to protect and stay unaffected (except B&W).
        helpers = _load_standalone_functions(
            LIGHT_SOURCE,
            {"_resolve_native_clock_color", "_leave_direct_mode", *NATIVE_ACTIVATION},
            {
                "LIVE_EFFECT_KEYS": CONSTANTS["LIVE_EFFECT_KEYS"],
                "hardware_brightness_for": lambda brightness: max(1, min(100, round(brightness * 100 / 255))),
                "effect_direction_value": CONSTANTS["effect_direction_value"],
                "asyncio": asyncio,
                "base64": base64,
                "NATIVE_CLOCK_STYLES": CONSTANTS["NATIVE_CLOCK_STYLES"],
                "DEFAULT_NATIVE_CLOCK_STYLE": CONSTANTS["DEFAULT_NATIVE_CLOCK_STYLE"],
                "NATIVE_CLOCK_EFFECT_ID": CONSTANTS["NATIVE_CLOCK_EFFECT_ID"],
                "NATIVE_CLOCK_APPLY": CONSTANTS["NATIVE_CLOCK_APPLY"],
                "CLOCK_MIXER_COMMAND_IDS": CONSTANTS["CLOCK_MIXER_COMMAND_IDS"],
                "CLOCK_MIXER_EFFECTS": CONSTANTS["CLOCK_MIXER_EFFECTS"],
                "LAMP_MUSIC_SLOTS": CONSTANTS["LAMP_MUSIC_SLOTS"],
                "clock_segment_modes": CONSTANTS["clock_segment_modes"],
                "CLOCK_COLOR_MODES": CONSTANTS["CLOCK_COLOR_MODES"],
                "clock_style_default_color": CONSTANTS["clock_style_default_color"],
                "clock_style_colors": CONSTANTS["clock_style_colors"],
                "resolve_clock_mixer_direction": CONSTANTS["resolve_clock_mixer_direction"],
                "ALL_NATIVE_EFFECTS": CONSTANTS["ALL_NATIVE_EFFECTS"],
                "NATIVE_EFFECT_DIRECTION_VALUES": CONSTANTS["NATIVE_EFFECT_DIRECTION_VALUES"],
                "_LOGGER": __import__("logging").getLogger(__name__),
            },
        )

        class FakeCube:
            def __init__(self):
                self.params = None
                self.running_effect = None

            def close_fast_socket(self):
                return None

            async def clear_fx_mode_flag(self):
                return False

            def note_running_effect(self, params):
                self.running_effect = params

            async def send_raw_command(
                self, command, params, abortive_close=False, check_reply=False
            ):
                self.params = params

        def make_device(style_id, color_mode):
            device = types.SimpleNamespace(
                _native_clock_timezone_hours=lambda: 0,
                _native_clock_style=style_id,
                _native_clock_data_bytes=lambda: b"",
                _native_effect_speed=50,
                _native_clock_color=0x01FFEE00,
                _native_clock_color_mode=color_mode,
                _native_effect_direction="Up",
                _cube_matrix=FakeCube(),
                _set_native_mode_brightness=lambda: asyncio.sleep(0),
                _brightness=255,
                _last_hardware_brightness=100,
                _is_on=False,
                _fx_mode_is_direct=False,
                _in_native_fw_mode=False,
                _last_fx_mode_time=0.0,
                _native_clock_timezone_offset=0,
                _notify_camera_preview=lambda: None,
                hass=None,
                _ip="test",
            )
            for name in ("_leave_direct_mode", *NATIVE_ACTIVATION_METHODS):
                setattr(device, name, types.MethodType(helpers[name], device))
            return device

        activate = helpers["_activate_native_clock"]

        async def run(style_id, color_mode):
            device = make_device(style_id, color_mode)
            device._resolve_native_clock_color = types.MethodType(
                helpers["_resolve_native_clock_color"], device
            )
            await types.MethodType(activate, device)()
            return device._cube_matrix.params

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
                expected = (
                    (style["mixer"], 1)
                    if style["mixer"] in CONSTANTS["CLOCK_DIRECT_BACKGROUNDS"]
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
                device._resolve_native_clock_color = types.MethodType(
                    helpers["_resolve_native_clock_color"], device
                )
                params = device._native_clock_params()
                self.assertEqual(list(words), params[3]["color"])
                self.assertNotIn("color", asyncio.run(run(style_id, "bw"))[3])

    def test_native_settings_reject_skipped_commands(self):
        power = _function_source(LIGHT_SOURCE, "async_set_power_on_state")
        buttons = _function_source(LIGHT_SOURCE, "async_set_button_effects")
        self.assertIn("if result is None", power)
        self.assertIn("if result is None", buttons)

    def test_light_services_are_registered_at_component_setup(self):
        # Once, for the whole session: registering them again at each lamp
        # setup replaced their handlers and their state (locks, trackers).
        component_setup = _function_source(INIT_SOURCE, "async_setup")
        entry_setup = _function_source(INIT_SOURCE, "async_setup_entry")
        platform_setup = _function_source(LIGHT_SOURCE, "async_setup_entry")
        self.assertIn("async_setup_light_services(hass)", component_setup)
        self.assertNotIn("async_setup_light_services", entry_setup)
        self.assertNotIn("services.async_register", platform_setup)

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
        function = _function_source(LIGHT_SOURCE, "async_set_music_flow")
        self.assertIn('"set_ps"', function)
        self.assertIn('"mic_music_mode"', function)
        self.assertIn("_music_flow_restore_power", function)
        self.assertIn("_apply_display_mode_internal", function)
        self.assertIn("_persist_music_flow_runtime_state", function)

    def test_content_change_exits_music_flow_without_double_restore(self):
        function = _function_source(LIGHT_SOURCE, "async_apply_display_mode")
        self.assertIn(
            "self.async_set_music_flow(False, restore_display=False)",
            function,
        )

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
        palette_class = SELECT_SOURCE[
            SELECT_SOURCE.index("class YeelightCubePaletteSelect") :
        ]
        palette_class = palette_class[: palette_class.index("\nclass ", 1)]
        function = _function_source(palette_class, "async_select_option")
        palette_branch = function[
            function.index("[PALETTE SELECT]") :
        ]
        self.assertIn(
            'async_apply_display_mode(\n            update_type="color_change"',
            palette_branch,
        )
        self.assertNotIn("._light_entity.apply()", palette_branch)

    def test_health_recovery_restarts_active_music_flow(self):
        health_check = _function_source(LIGHT_SOURCE, "_periodic_health_check")
        self.assertIn("if self._music_flow_enabled:", health_check)
        self.assertIn("await self.async_set_music_flow(True)", health_check)
        self.assertLess(
            health_check.index("await self.async_set_music_flow(True)"),
            health_check.index(
                "await self.async_apply_display_mode(update_type='turn_on')"
            ),
        )
        exit_types = LIGHT_SOURCE[
            LIGHT_SOURCE.index("MUSIC_FLOW_EXIT_UPDATE_TYPES") :
            LIGHT_SOURCE.index(
                "MUSIC_FLOW_EXIT_UPDATE_TYPES"
            ) + 250
        ]
        self.assertNotIn('"turn_on"', exit_types)

    def test_turning_music_flow_off_restores_display_and_prior_power(self):
        helpers = _load_standalone_functions(
            LIGHT_SOURCE,
            {"_build_music_flow_payload", "async_set_music_flow", "_leave_direct_mode"},
            {
                "asyncio": asyncio,
                "time": time,
                "MUSIC_FLOW_EFFECTS": CONSTANTS["MUSIC_FLOW_EFFECTS"],
                "MUSIC_FLOW_DEFAULT_PALETTE": CONSTANTS[
                    "MUSIC_FLOW_DEFAULT_PALETTE"
                ],
                "MUSIC_FLOW_HARD_TIMEOUT": 12.0,
                "HomeAssistantError": RuntimeError,
            },
        )

        class FakeCube:
            def __init__(self):
                self.commands = []
                self.raw_commands = []

            def close_fast_socket(self):
                return None

            async def clear_fx_mode_flag(self):
                return False

            def close_command_socket(self):
                return None

            async def send_command_with_recovery(self, command, params):
                self.commands.append((command, params))
                return {"result": ["ok"]}

            async def send_raw_command(self, command, params):
                self.raw_commands.append((command, params))

        applied = []
        device = types.SimpleNamespace(
            _music_flow_enabled=True,
            _music_flow_effect="Breathing",
            _music_flow_restore_power=True,
            _is_on=True,
            _cube_matrix=FakeCube(),
            _in_native_fw_mode=True,
            hass=None,
            _refresh_music_flow_entities=lambda: None,
            _notify_camera_preview=lambda: None,
        )

        async def execute(func, op_name, timeout_override=None):
            await func()
            return True

        async def apply_display():
            applied.append("display")

        persisted = []

        async def persist_music_flow():
            persisted.append(True)

        device._execute_hardware_op = execute
        device._apply_display_mode_internal = apply_display
        device._persist_music_flow_runtime_state = persist_music_flow
        device._fx_mode_is_direct = getattr(device, "_fx_mode_is_direct", False)
        device._leave_direct_mode = types.MethodType(helpers["_leave_direct_mode"], device)
        set_music_flow = types.MethodType(helpers["async_set_music_flow"], device)

        asyncio.run(set_music_flow(False))
        self.assertFalse(device._music_flow_enabled)
        self.assertEqual(["display"], applied)
        self.assertEqual("set_ps", device._cube_matrix.commands[0][0])
        self.assertEqual(
            {"on": 0},
            json.loads(device._cube_matrix.commands[0][1][1]),
        )

        device._music_flow_enabled = True
        device._music_flow_restore_power = False
        device._is_on = True
        applied.clear()
        asyncio.run(set_music_flow(False))
        self.assertFalse(device._is_on)
        self.assertEqual([], applied)
        self.assertEqual(
            [("set_power", ["off"])],
            device._cube_matrix.raw_commands,
        )
        self.assertEqual(2, len(persisted))
        # A remote press did not change the desired Music Flow state. Stop
        # its physical music mode without a storage write before the redraw.
        device._is_on = True
        applied.clear()
        asyncio.run(set_music_flow(False, restore_display=False, persist_state=False))
        self.assertEqual(3, len(device._cube_matrix.commands))
        self.assertEqual({"on": 0}, json.loads(device._cube_matrix.commands[-1][1][1]))
        self.assertEqual([], applied)
        self.assertEqual(2, len(persisted))

    def test_music_flow_stop_finalizes_state_when_display_restore_fails(self):
        helpers = _load_standalone_functions(
            LIGHT_SOURCE,
            {"_build_music_flow_payload", "async_set_music_flow", "_leave_direct_mode"},
            {
                "asyncio": asyncio,
                "time": time,
                "MUSIC_FLOW_EFFECTS": CONSTANTS["MUSIC_FLOW_EFFECTS"],
                "MUSIC_FLOW_DEFAULT_PALETTE": CONSTANTS[
                    "MUSIC_FLOW_DEFAULT_PALETTE"
                ],
                "MUSIC_FLOW_HARD_TIMEOUT": 12.0,
                "HomeAssistantError": RuntimeError,
            },
        )

        class FakeCube:
            def close_fast_socket(self):
                return None

            async def clear_fx_mode_flag(self):
                return False

            def close_command_socket(self):
                return None

            async def send_command_with_recovery(self, command, params):
                return {"result": ["ok"]}

        calls = {"persist": 0, "entities": 0, "preview": 0}
        device = types.SimpleNamespace(
            _music_flow_enabled=True,
            _music_flow_effect="Breathing",
            _music_flow_restore_power=True,
            _is_on=True,
            _cube_matrix=FakeCube(),
            _in_native_fw_mode=True,
            hass=None,
            _refresh_music_flow_entities=lambda: calls.__setitem__(
                "entities", calls["entities"] + 1
            ),
            _notify_camera_preview=lambda: calls.__setitem__(
                "preview", calls["preview"] + 1
            ),
        )

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

        device._execute_hardware_op = execute
        device._apply_display_mode_internal = apply_display
        device._persist_music_flow_runtime_state = persist_music_flow
        device._fx_mode_is_direct = getattr(device, "_fx_mode_is_direct", False)
        device._leave_direct_mode = types.MethodType(helpers["_leave_direct_mode"], device)
        set_music_flow = types.MethodType(helpers["async_set_music_flow"], device)

        with self.assertRaisesRegex(RuntimeError, "could not complete"):
            asyncio.run(set_music_flow(False))

        self.assertFalse(device._music_flow_enabled)
        self.assertIsNone(device._music_flow_restore_power)
        self.assertEqual({"persist": 1, "entities": 1, "preview": 1}, calls)

    def test_music_flow_runtime_state_is_persisted_after_storage_ready(self):
        attributes = _function_source(LIGHT_SOURCE, "extra_state_attributes")
        restore = _function_source(LIGHT_SOURCE, "async_added_to_hass")
        storage = (ROOT / "storage.py").read_text(encoding="utf-8")
        # Everything saved (immediate or batched) comes from storage_data.
        save = _function_source(storage, "storage_data")
        # Every entry's setup loads (or waits for) the shared storage first.
        self.assertIn(
            "await async_load_storage(hass)",
            _function_source(INIT_SOURCE, "async_setup_entry"),
        )
        setup = _function_source(storage, "async_load_storage")
        self.assertIn('"music_flow_restore_power"', attributes)
        self.assertIn("_restore_music_flow_runtime_state()", restore)
        self.assertIn('"device_runtime_state"', save)
        self.assertIn('"device_runtime_state"', setup)
        self.assertIn("await storage_ready.wait()", setup)
        self.assertIn("storage_ready.set()", setup)

    def test_the_lamp_state_is_never_polled(self):
        # Cube Lite answers no get_prop (TCP or UDP): HA's update only
        # refreshes the clock's UTC offset, and never while Music Flow runs.
        # It runs when the light is added, then on the hour (daylight saving
        # changes happen on the hour), not on a 30 s poll.
        self.assertIn("_attr_should_poll = False", LIGHT_SOURCE)
        self.assertIn(
            "self.hass, self._async_hourly_update, minute=0, second=5",
            LIGHT_SOURCE,
        )
        self.assertIn("await self.async_update()", _function_source(LIGHT_SOURCE, "_async_hourly_update"))
        update = _function_source(LIGHT_SOURCE, "async_update")
        # Never sent by the lamp or its transport (the diagnostics query
        # service still lets a user try it).
        for name in ("light.py", "cube_matrix.py"):
            self.assertNotIn('"get_prop"', (ROOT / name).read_text(encoding="utf-8"), name)
        self.assertNotIn("read_properties", update)
        self.assertLess(
            update.index("if self._music_flow_enabled:"),
            update.index("_native_clock_timezone_hours()"),
        )

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

    def test_fireworks_matches_rocket_burst_and_special_effect_id(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        spec = CONSTANTS["ALL_NATIVE_EFFECTS"]["Fireworks"]

        self.assertEqual(71, spec["effect_id"])
        self.assertEqual(10, spec["mode"])
        self.assertEqual("Fireworks", CONSTANTS["CLOCK_MIXER_EFFECTS"][10])
        self.assertIn('10: "Fireworks"', CLOCK_CARD_SOURCE)
        # The colored confetti only unlocks when the clock command id (1st array
        # element) is overridden to 71; the clock config still uses mode 40.
        self.assertEqual(71, CONSTANTS["CLOCK_MIXER_COMMAND_IDS"][10])
        activate = _function_source(LIGHT_SOURCE, "_native_clock_params")
        self.assertIn("CLOCK_MIXER_COMMAND_IDS", activate)
        style = next(
            style
            for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
            if style["mixer"] == 10
        )
        self.assertEqual("Fireworks", style["name"])

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
        self.assertEqual(3, CONSTANTS["ALL_NATIVE_EFFECTS"]["Moving palette"]["effect_id"])
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

    def test_named_effects_back_the_clock(self):
        # What the old per-effect tests said of the tables: the reference
        # frames of what the lamp draws now check it (test_lamp_effects).
        mixers = {
            4: "Moving palette", 6: "Particle path", 9: "Triangular palette pulses", 11: "Sine wave",
            18: "Sunrise and sunset", 19: "Heat fire", 22: "Mirrored comets", 24: "Palette sparks", 35: "Tide (slot 35)",
            54: "Rainbow noise", 56: "Violet interference", 57: "Night-amber waves", 58: "Navy-white noise", 59: "Night-sky waves",
            61: "Particle glows", 70: "Palette stripes", 79: "Violet twinkles",
        }
        for mixer, name in mixers.items():
            with self.subTest(name=name):
                self.assertEqual(name, CONSTANTS["CLOCK_MIXER_EFFECTS"][mixer])
                self.assertIn(f'{mixer}: "{name}"', CLOCK_CARD_SOURCE)
                self.assertEqual(mixer, CONSTANTS["ALL_NATIVE_EFFECTS"][name]["mode"])
                style = next(
                    style for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
                    if style["mixer"] == mixer
                )
                self.assertEqual(name, style["name"])
        self.assertEqual(
            {"name": "Violet interference", "mixer": 56}, CONSTANTS["NATIVE_CLOCK_STYLES"][15],
        )
        self.assertIn("15: 56", CLOCK_CARD_SOURCE)
        self.assertIn('typeof nested === "string"', CLOCK_CARD_SOURCE)
        self.assertIn("effectName === effect", CLOCK_CARD_SOURCE)
        # Mode 60 goes dark for long stretches: it never backs the clock.
        self.assertNotIn(60, CONSTANTS["CLOCK_MIXER_EFFECTS"])
        self.assertNotIn("60:", _js_object(CLOCK_CARD_SOURCE, "CLOCK_MIXER_EFFECTS"))
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
        colors = _function_source(CAMERA_SOURCE, "_get_matrix_colors")
        preview = _function_source(CAMERA_SOURCE, "_get_music_flow_preview")
        animated = _function_source(CAMERA_SOURCE, "_is_native_preview_mode")
        view = _function_source(CAMERA_SOURCE, "_view_frame")
        self.assertIn('"_music_flow_enabled"', colors)
        self.assertIn("self._get_music_flow_preview()", colors)
        self.assertIn("render_music_flow_effect(", preview)
        self.assertNotIn('"_music_flow_enabled"', animated)
        # Every mode's frame is turned for the mount once, the cards' rule.
        self.assertIn("viewer_frame(self._get_matrix_colors(), orientation)", view)

    def test_matrix_colors_publish_what_the_lamp_shows(self):
        """matrix_colors never republishes a stale plugin frame: black when
        off, empty while the lamp draws on its own (clock, native effect, music flow)."""
        fns = _load_standalone_functions(
            LIGHT_SOURCE, {"_published_matrix_colors", "lamp_draws_matrix"}
        )

        class Lamp:
            lamp_draws_matrix = fns["lamp_draws_matrix"]
            _published_matrix_colors = fns["_published_matrix_colors"]

        lamp = Lamp()
        lamp._layout = types.SimpleNamespace(device_layout=[object()] * 100)
        # The last pixel art the plugin drew, kept after switching away.
        lamp._base_matrix_colors = [(200, 100, 50)] * 100
        lamp._music_flow_enabled = False
        lamp._is_on, lamp._mode = True, "Custom Draw"
        # Never darkened: the lamp dims in hardware (the cards scale them).
        self.assertEqual([(200, 100, 50)] * 100, lamp._published_matrix_colors())
        for mode in ("Clock", "Native Effect"):
            lamp._mode = mode
            self.assertEqual([], lamp._published_matrix_colors(), mode)
        lamp._mode, lamp._music_flow_enabled = "Custom Draw", True
        self.assertEqual([], lamp._published_matrix_colors())
        for mode in ("Clock", "Custom Draw"):
            lamp._is_on, lamp._mode = False, mode
            self.assertEqual([(0, 0, 0)] * 100, lamp._published_matrix_colors())
        attributes = _function_source(LIGHT_SOURCE, "extra_state_attributes")
        self.assertIn('attrs["matrix_colors"] = self._published_matrix_colors()', attributes)

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

    def test_named_renderable_effects_back_the_clock(self):
        mixer_effects = CONSTANTS["CLOCK_MIXER_EFFECTS"]
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        dirs = CONSTANTS["NATIVE_EFFECT_DIRECTIONS"]
        # Named effects must show through the clock (previously only a curated
        # subset did) -- including four-direction effects and direction-less
        # ones like Starry sky (whose blue color previously fell back to the
        # default yellow gradient).
        for name in (
            "Waterfall",
            "Aurora",
            "Fire",
            "Flower Sea",
            "Kaleidoscope",
            "Starry Sky",
            "Ribbon",
            "Bouncing Ball",
            "Tide",
            "Magic",
            "Wonderland",
        ):
            self.assertEqual(name, mixer_effects[effects[name]["mode"]])
            self.assertIn(f'{effects[name]["mode"]}: "{name}"', CLOCK_CARD_SOURCE)
        # Every effect with a full/absent direction set (except mostly-black
        # modes) qualifies; partial-direction Hacking and the stored GIF do not.
        for name, spec in effects.items():
            eligible = (
                spec["mode"] != CONSTANTS["LAMP_STORED_GIF_SLOT"]
                and spec.get("directions") in (None, dirs)
                and spec["mode"] not in CONSTANTS["_NON_CLOCK_EFFECT_MODES"]
            )
            self.assertEqual(eligible, spec["mode"] in mixer_effects)
        # Hacking, Meteor, Building Blocks, and Palette are excluded: the
        # lamp rejects these clock/mixer combinations.
        for name in ("Hacking", "Meteor", "Building Blocks", "Palette"):
            self.assertNotIn(name, mixer_effects.values())
            self.assertNotIn(effects[name]["mode"], mixer_effects)
            style = next(
                (
                    s
                    for s in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
                    if s.get("mixer") == effects[name]["mode"]
                ),
                None,
            )
            self.assertIsNone(style, f"{name} must not have a clock style")

    def test_brightness_only_turn_on_keeps_native_mode_running(self):
        starter = _function_source(LIGHT_SOURCE, "async_turn_on")
        turn_on = _function_source(LIGHT_SOURCE, "_internal_turn_on")
        # async_turn_on forwards the prior on-state so the internal handler can
        # tell a brightness-only change from a genuine (re)activation.
        self.assertIn("was_on = self._is_on", starter)
        self.assertIn("_was_on=was_on", starter)
        self.assertIn('was_on = kwargs.pop("_was_on", False)', turn_on)
        # Both the clock and native-effect branches only push brightness for a
        # brightness-only change on an already-running mode -- re-activating
        # would restart the lamp's animation from the first frame.
        self.assertEqual(
            2, turn_on.count('if was_on and set(kwargs) <= {"brightness"}:')
        )
        self.assertIn("await self._set_native_mode_brightness()", turn_on)



    def test_clock_style_inherits_mixer_effect_default_color(self):
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        styles = CONSTANTS["NATIVE_CLOCK_STYLES"]
        default_color = CONSTANTS["clock_style_default_color"]
        # Every effect that carries a default color (e.g. Waterfall = 255) must
        # be reachable as a clock style whose mixer equals that effect's mode
        # (unless the effect is excluded from the clock entirely), and the
        # shared helper must resolve that color from the style.
        colored = {
            name: spec
            for name, spec in effects.items()
            if spec.get("color") is not None
        }
        self.assertIn("Waterfall", colored)
        non_clock = CONSTANTS["_NON_CLOCK_EFFECT_MODES"]
        for name, spec in colored.items():
            style = next(
                (s for s in styles.values() if s.get("mixer") == spec["mode"]),
                None,
            )
            if spec["mode"] in non_clock:
                self.assertIsNone(style, f"{name} must not have a clock style")
                continue
            self.assertIsNotNone(style, f"no clock style backs {name}")
            self.assertEqual(spec["color"], default_color(style))
        # A solid-color style keeps its own color; a mixer effect without a
        # default color resolves to None.
        self.assertEqual(styles[6]["color"], default_color(styles[6]))
        self.assertIsNone(default_color({"mixer": 39}))
        # Both clock payload builders resolve the color through the shared
        # helper so none of them can silently drop the mixer effect's color.
        resolve = _function_source(LIGHT_SOURCE, "_resolve_native_clock_color")
        self.assertIn("clock_style_default_color", resolve)
        activate = _function_source(LIGHT_SOURCE, "_native_clock_params")
        self.assertIn("_resolve_native_clock_color", activate)
        self.assertIn("clock_style_colors(", activate)
        persist = _function_source(LIGHT_SOURCE, "_effect_persist_item")
        self.assertIn("clock_style_colors(style)", persist)
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
        clock = _function_source(CAMERA_SOURCE, "_get_clock_preview")
        # Mixer-effect styles render the effect and mask it to the glyph pixels.
        self.assertIn("CLOCK_MIXER_EFFECTS", clock)
        self.assertIn("lamp_clock_settings(", clock)
        self.assertIn("effect_frame[row * COLS + col]", clock)
        # Colon blink, date/12h/offset handling stay intact.
        self.assertIn('char == ":"', clock)
        self.assertIn("colon_visible", clock)
        self.assertIn("_native_clock_12_hour", clock)
        # The JS card mirrors the same masking and colon-blink behaviour.
        self.assertIn("CLOCK_MIXER_EFFECTS", CLOCK_CARD_SOURCE)
        self.assertIn("lampClockSettings(", CLOCK_CARD_SOURCE)
        self.assertIn("effectFrame[row * COLS + col]", CLOCK_CARD_SOURCE)
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

        # The clock activation command carries a lamp direction byte taken
        # from the selected native-effect direction, remapped per effect.
        activate = _function_source(LIGHT_SOURCE, "_native_clock_params")
        self.assertIn("resolve_clock_mixer_direction(", activate)
        self.assertIn("self._native_effect_direction", activate)
        self.assertIn('effect_config["direction"] = lamp_direction(self, effect_direction_value(', activate)

        # The lamp ignores a clock's direction: a raw clock leaves the effects' one.
        lamp = _reflected_fx_lamp(
            True, 2, {"mode": 40, "direction": CONSTANTS["NATIVE_EFFECT_DIRECTION_VALUES"]["Down"]}
        )
        self.assertIsNone(lamp._native_effect_direction)

        # The lamp keeps the direction that maps to 0 whatever is sent (mode 40),
        # and both previews draw the background so, whatever the lamp's
        # native-effect direction (lamp_clock_settings, on the fixture).
        renderers = runpy.run_path(ROOT / "lamp_renderers.py")
        for effect_name in mixer_effects.values():
            self.assertEqual(2, renderers["lamp_clock_settings"](effect_name, 50)["direction"])
        clock_preview = _function_source(CAMERA_SOURCE, "_get_clock_preview")
        self.assertIn("lamp_clock_settings(", clock_preview)
        self.assertIn("lampClockSettings(", CLOCK_CARD_SOURCE)

    def test_native_effect_send_keeps_lamp_direction_remap(self):
        # REGRESSION GUARD: the lamp's `direction_remap` on the SEND path is the
        # ground truth that makes the lamp's physical flow match the arrow.
        # Removing it silently flips the lamp's up/down for _SWAP_UP_DOWN effects
        # (Ocean Waves, Rainbow, ...). Previews follow it (lamp_settings).
        activate = _function_source(LIGHT_SOURCE, "_native_effect_params")
        self.assertIn("effect_direction_sent(self, spec)", activate)
        self.assertIn("effect_direction_value(", _function_source(LIGHT_SOURCE, "effect_direction_sent"))
        # The shared helper applies the remap: Rainbow's "Up" is sent as the
        # lamp's down value; an effect without a remap sends the label.
        direction = CONSTANTS["effect_direction_value"]
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        values = CONSTANTS["NATIVE_EFFECT_DIRECTION_VALUES"]
        self.assertEqual(values["Down"], direction(effects["Rainbow"], "Up"))
        self.assertEqual(values["Up"], direction(effects["Aurora"], "Up"))

    def test_a_raw_send_reflects_clock_style_for_live_preview(self):
        handler = _function_source(LIGHT_SOURCE, "handle_send_fx_effect")
        # Everything before the persist blocks is the always-reflect path that
        # runs even when persist is unchecked (the default),
        # and refreshes the linked settings controls.
        reflect = handler.split("persisted = False")[0]
        self.assertIn("_reflect_fx_effect(", reflect)
        self.assertIn("target._refresh_linked_entities()", reflect)
        # Selecting a clock style updates the style itself (not just the
        # mode), its color and options, so the preview card renders the
        # correct masked effect / color -- as a normal clock-style selection
        # from the device page.
        style = next(iter(CONSTANTS["NATIVE_CLOCK_STYLES"]))
        data = base64.b64encode(bytes([3, 8, 1, 1])).decode("ascii")
        lamp = _reflected_fx_lamp(True, style, {"mode": 40, "color": [0x123456], "data": data})
        self.assertEqual(lamp._mode, CONSTANTS["MODE_CLOCK"])
        self.assertEqual(lamp._native_clock_style, style)
        self.assertEqual(lamp._native_clock_color, 0x123456)
        self.assertEqual(lamp._native_clock_content, "date")
        self.assertTrue(lamp._native_clock_12_hour)
        self.assertFalse(lamp._native_clock_colon_blink)
        # A native effect: its speed (clamped) and direction.
        lamp = _reflected_fx_lamp(False, 0, {"rate": 999, "direction": 0}, "Rainbow")
        self.assertEqual((lamp._mode, lamp._native_effect), (CONSTANTS["MODE_NATIVE_EFFECT"], "Rainbow"))
        self.assertEqual(lamp._native_effect_speed, 255)
        # The card derives the effect from clock_style_id, so it must be the
        # attribute that gets updated.
        self.assertIn("clock_style_id", CLOCK_CARD_SOURCE)
        self.assertIn("clockStyleMixer(", CLOCK_CARD_SOURCE)

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
            self.assertEqual(71 if name == "Fireworks" else 3, spec["effect_id"])
            self.assertTrue(spec.get("extended"))
            self.assertEqual(
                spec["mode"] not in CONSTANTS["_EXTENDED_EFFECT_NO_SPEED"], spec.get("speed")
            )
            self.assertNotIn(spec["mode"], official_modes)
            # The other slots are the ones named by number until 1.4.0.
            if name not in named:
                self.assertIn(spec["mode"], CONSTANTS["FORMERLY_NUMBERED_SLOTS"])
        # Official list is untouched; merged is the exact union.
        self.assertEqual(18, len(official))
        self.assertEqual({**official, **extended}, merged)

    def test_nothing_offered_is_outside_the_lamp_tables(self):
        # The lamp has no mode above 81: one sent runs something undefined.
        for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values():
            self.assertLess(spec["mode"], 82)
        for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values():
            self.assertLess(style["mixer"], 82)
        # The empty slots draw nothing.
        modes = {spec["mode"] for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values()}
        self.assertFalse(modes & {12, 13, 29, 78})

    def test_a_button_playlist_sends_the_direction_activation_does(self):
        persist = _function_source(LIGHT_SOURCE, "_effect_persist_item")
        self.assertIn("effect_direction_sent(self, spec)", persist)

    def test_a_clock_rotation_follows_a_renamed_style(self):
        rotation = (ROOT / "light_rotation.py").read_text(encoding="utf-8")
        clock = _function_source(rotation, "_apply_rotation_clock")
        self.assertIn('canonical_item_name("clock", item["name"])', clock)

    def test_every_effect_has_one_family(self):
        families = CONSTANTS["EFFECT_FAMILIES"]
        slots = [mode for modes in families.values() for mode in modes]
        self.assertEqual(len(slots), len(set(slots)))
        self.assertEqual(
            {spec["mode"] for spec in CONSTANTS["ALL_NATIVE_EFFECTS"].values()}, set(slots)
        )

    def test_the_cards_family_names_match_the_slots(self):
        import re

        families = (ROOT / "www" / "effect-families.js").read_text(encoding="utf-8")
        table = families[families.index("EFFECT_FAMILY_NAMES = {"):families.index("const FAMILY_OF_NAME")]
        rows = re.findall(r"(\w+): \[(.*?)\]", table, re.DOTALL)
        offline = {
            name: family for family, names in rows for name in re.findall(r'"([^"]+)"', names)
        }
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        self.assertEqual(
            offline,
            {
                name: CONSTANTS["EFFECT_FAMILY_OF_SLOT"][spec["mode"]]
                for name, spec in effects.items()
                if name in offline
            },
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
        display = (ROOT / "light_services_display.py").read_text(encoding="utf-8")
        self.assertIn('return [64, 0, 4, {"mode": 64}]', display)

    def test_the_lamps_default_speed_is_the_presets(self):
        self.assertEqual(128, CONSTANTS["DEFAULT_NATIVE_EFFECT_SPEED"])
        self.assertIn(
            "self._native_effect_speed = DEFAULT_NATIVE_EFFECT_SPEED", LIGHT_SOURCE
        )
        renderers = (ROOT / "www" / "lamp-renderers.js").read_text(encoding="utf-8")
        self.assertIn("export const DEFAULT_EFFECT_SPEED = 128;", renderers)
        self.assertIn("export const UNDIRECTED_EFFECT_DIRECTION = 0;", renderers)

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
        self.assertEqual(82, max(styles))
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
        self.assertIn('lamp_rate(style["mixer"], self._native_effect_speed)', LIGHT_SOURCE)
        self.assertIn('lamp_rate(spec["mode"], self._native_effect_speed)', LIGHT_SOURCE)

    def test_magic_and_neon_are_their_own_slots(self):
        effects = CONSTANTS["ALL_NATIVE_EFFECTS"]
        self.assertEqual((92, 76), (effects["Magic"]["effect_id"], effects["Magic"]["mode"]))
        self.assertEqual((3, 75), (effects["Neon sine bands"]["effect_id"], effects["Neon sine bands"]["mode"]))
        self.assertTrue(effects["Neon sine bands"]["extended"])
        self.assertNotIn("76", effects)
        # Neon keeps what it was sent as Magic: no direction, on effects or clocks.
        self.assertNotIn("directions", effects["Neon sine bands"])
        self.assertIsNone(CONSTANTS["resolve_clock_mixer_direction"]("Right", "Neon sine bands"))
        self.assertEqual("Neon sine bands", CONSTANTS["CLOCK_MIXER_EFFECTS"][75])
        self.assertIn('canonical_item_name("native", item["name"])', LIGHT_SOURCE)
        self.assertEqual("Magic", CONSTANTS["NATIVE_EFFECT_ALIASES"]["76"])

    def test_spectrum_has_no_speed(self):
        # Slot 17 reads no rate (the lamp; the app hides it too), and does not move.
        self.assertFalse(CONSTANTS["ALL_NATIVE_EFFECTS"]["Spectrum"].get("speed"))
        render = NATIVE_PREVIEW["render_native_effect_oriented"]
        self.assertEqual(render("Spectrum", 0.0, "Up"), render("Spectrum", 40.0, "Up"))

    def test_tide_has_directions_and_keeps_its_picture(self):
        spec = CONSTANTS["ALL_NATIVE_EFFECTS"]["Tide"]
        value = lambda label: CONSTANTS["effect_direction_value"](spec, label)
        self.assertEqual(list(CONSTANTS["NATIVE_EFFECT_DIRECTIONS"]), list(spec["directions"]))
        # Right, the default mount, is the lamp direction it always ran.
        self.assertEqual({"Right": 0, "Left": 1, "Up": 2, "Down": 3}, {d: value(d) for d in spec["directions"]})
        self.assertEqual("Right", CONSTANTS["resolve_clock_mixer_direction"]("Up", "Tide"))
        render = NATIVE_PREVIEW["render_native_effect_oriented"]
        phase = 3.7
        right, left = render("Tide", phase, "Right"), render("Tide", phase, "Left")
        up, down = render("Tide", phase, "Up"), render("Tide", phase, "Down")
        self.assertEqual(right[::-1], left)
        self.assertEqual(up[::-1], down)
        self.assertNotEqual(right, up)
        self.assertTrue(any(any(pixel) for pixel in up))

    def test_extended_effects_are_gated_behind_the_switch(self):
        # The effect dropdown only offers the extended effects when enabled, and
        # refuses to select one while the switch is off.
        self.assertIn("EXTENDED_NATIVE_EFFECTS", SELECT_SOURCE)
        self.assertIn("_extended_effects_enabled", SELECT_SOURCE)
        self.assertIn('invalid("experimental_required", name=option)', SELECT_SOURCE)
        # A dedicated switch toggles the feature and refreshes the dropdown.
        self.assertIn("class YeelightCubeExtendedEffectsSwitch", SWITCH_SOURCE)
        self.assertIn(
            "YeelightCubeExtendedEffectsSwitch(config_entry, light_entity)",
            SWITCH_SOURCE,
        )
        self.assertIn("_native_effect_select_entity", SWITCH_SOURCE)
        # Discovered clock styles follow the same gate and refresh immediately.
        self.assertIn("EXPERIMENTAL_CLOCK_STYLE_IDS", SELECT_SOURCE)
        self.assertIn("_clock_style_select_entity", SWITCH_SOURCE)
        self.assertIn(
            15,
            CONSTANTS["EXPERIMENTAL_CLOCK_STYLE_IDS"],
        )
        # The toggle is persisted on the light for restore, and spec lookups use
        # the merged dict so a selected extended effect still activates.
        self.assertIn('"extended_effects_enabled"', LIGHT_SOURCE)
        self.assertIn("ALL_NATIVE_EFFECTS", LIGHT_SOURCE)

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
        # a distinct mixer, and named modes never appear as a bare number.
        mode_to_name = {spec["mode"]: name for name, spec in all_effects.items()}
        seen_mixers = set()
        for style_id, style in clock_styles.items():
            if style_id <= 10:
                continue
            self.assertIn(style_id, experimental)
            mixer = style["mixer"]
            self.assertNotIn(mixer, seen_mixers)
            seen_mixers.add(mixer)
            if style_id > 15 and mixer in mode_to_name:
                self.assertEqual(mode_to_name[mixer], style["name"])
        # Labels stay unique so the reverse label -> id map never collapses.
        labels = [style["name"] for style in clock_styles.values()]
        self.assertEqual(len(labels), len(set(labels)))

    def test_experimental_dropdowns_sort_by_mode_and_mixer(self):
        # Native effects sort by lamp mode and clock styles by mixer, but
        # only when Experimental Features is enabled.
        self.assertIn(
            'key=lambda name: ALL_NATIVE_EFFECTS[name]["mode"]', SELECT_SOURCE
        )
        self.assertIn(
            'key=lambda style_id: NATIVE_CLOCK_STYLES[style_id]["mixer"]',
            SELECT_SOURCE,
        )

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
    (light_services_diagnostics._reflect_fx_effect)."""
    import base64 as _base64
    names = {"_reflect_fx_effect", "_apply_clock_data"}
    reflect = _load_standalone_functions(
        LIGHT_SOURCE, names,
        {**CONSTANTS, "base64": _base64, "_LOGGER": Mock(),
         "lamp_direction": lambda light, value: value},
    )["_reflect_fx_effect"]
    lamp = types.SimpleNamespace(
        _mode=None, _native_clock_style=None, _native_clock_color=None,
        _native_clock_content="time", _native_clock_show_date=False,
        _native_clock_12_hour=False, _native_clock_colon_blink=True,
        _native_effect=None, _native_effect_speed=50, _native_effect_direction=None,
        _device_orientation="right",
    )
    reflect(lamp, is_clock, style, config, native_effect_name)
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
             "EFFECT_FAMILY_OF_SLOT": CONSTANTS["EFFECT_FAMILY_OF_SLOT"],
             "LAMP_STORED_GIF_SLOT": CONSTANTS["LAMP_STORED_GIF_SLOT"]},
        )["_native_effect_catalog"]
        extended = [
            name for name, spec in effects.items()
            if spec.get("extended") and name != "Stored GIF"
        ]
        self.assertTrue(extended)
        names = lambda items: [item["name"] for item in items]
        self.assertFalse(set(extended) & set(names(catalog(False, None))))
        self.assertTrue(set(extended) <= set(names(catalog(True, None))))
        # An experimental effect playing while they are hidden stays listed.
        self.assertIn(extended[0], names(catalog(False, extended[0])))
        self.assertIs(catalog(False, None), catalog(False, None))
        # Every effect is listed with a preview, but the stored GIF, not
        # listed for now.
        self.assertNotIn("Stored GIF", names(catalog(True, None)))
        self.assertNotIn("Stored GIF", names(catalog(False, "Stored GIF")))
        self.assertTrue(all(item["preview"] for item in catalog(True, None)))

if __name__ == "__main__":
    unittest.main()
