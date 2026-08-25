"""Tests for Cube Lite native protocol definitions and bundled presets."""

import __future__
import ast
import asyncio
import colorsys
import json
from pathlib import Path
import runpy
import time
import types
import unittest


ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"
CONSTANTS = runpy.run_path(ROOT / "const.py")
PIXEL_ART = runpy.run_path(ROOT / "builtin_pixel_art.py")
NATIVE_PREVIEW = runpy.run_path(ROOT / "native_effect_preview.py")
# The light entity is split across light.py and its light_*.py mixins. Join them
# so source-level invariant checks below still find methods wherever they live.
LIGHT_SOURCE = "\n\n".join(
    p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light*.py"))
)
INIT_SOURCE = (ROOT / "__init__.py").read_text(encoding="utf-8")
CAMERA_SOURCE = (ROOT / "camera.py").read_text(encoding="utf-8")
SELECT_SOURCE = (ROOT / "select.py").read_text(encoding="utf-8")


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


def _load_standalone_functions(source: str, names: set, extra_namespace=None) -> dict:
    """Load selected helpers without importing Home Assistant."""
    tree = ast.parse(source)
    functions = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name in names
    ]
    namespace = {"json": json}
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
    def test_clock_uses_firmware_clock_apply_mode(self):
        self.assertEqual(40, CONSTANTS["NATIVE_CLOCK_EFFECT_ID"])
        self.assertEqual(2, CONSTANTS["NATIVE_CLOCK_APPLY"])

    def test_clock_applies_brightness_after_activation(self):
        function = _function_source(LIGHT_SOURCE, "_activate_native_clock")
        self.assertLess(
            function.index('"set_fx_effect"'),
            function.index("await self._set_native_mode_brightness()"),
        )

    def test_native_settings_reject_skipped_commands(self):
        power = _function_source(LIGHT_SOURCE, "async_set_power_on_state")
        buttons = _function_source(LIGHT_SOURCE, "async_set_button_effects")
        self.assertIn("if result is None", power)
        self.assertIn("if result is None", buttons)

    def test_light_services_are_registered_at_component_setup(self):
        component_setup = _function_source(INIT_SOURCE, "async_setup")
        platform_setup = _function_source(LIGHT_SOURCE, "async_setup_entry")
        self.assertIn("async_setup_light_services(hass)", component_setup)
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
        self.assertEqual(
            {"Off": 0, "On": 1, "Toggle": 2},
            CONSTANTS["POWER_ON_STATES"],
        )

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

    def test_music_flow_property_parser_handles_device_values(self):
        parse = _load_standalone_functions(
            LIGHT_SOURCE,
            {"_parse_music_flow_config"},
        )["_parse_music_flow_config"]
        self.assertEqual((True, 84), parse('{"on":1,"effect_id":84}'))
        self.assertEqual((False, 88), parse({"on": "0", "effect_id": "88"}))
        self.assertEqual((None, None), parse("not-json"))

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

        async def execute(func, op_name):
            events.append(("execute", op_name))
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
        self.assertEqual(("execute", "turn_on"), events[1])
        self.assertEqual(
            ("turn_on", {"rgb_color": (12, 34, 56), "brightness": 128}),
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
            _is_on=True,
            _brightness=255,
            _rgb_color=(255, 255, 255),
            hass=None,
        )

        async def set_music_flow(enabled, restore_display=True):
            events.append(("music_flow", enabled, restore_display))

        async def internal_turn_on(**kwargs):
            events.append(("turn_on", kwargs))

        async def execute(func, op_name):
            await func()
            return True

        device.async_set_music_flow = set_music_flow
        device._internal_turn_on = internal_turn_on
        device._execute_hardware_op = execute
        turn_on = types.MethodType(async_turn_on, device)

        asyncio.run(turn_on(brightness=96))

        self.assertFalse(any(event[0] == "music_flow" for event in events))
        self.assertEqual([("turn_on", {"brightness": 96})], events)

    def test_palette_selection_uses_guarded_display_state_machine(self):
        function = _function_source(SELECT_SOURCE, "async_select_option")
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
            {"_build_music_flow_payload", "async_set_music_flow"},
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

            def _close_fast_socket(self):
                return None

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
            _last_native_state_poll=0.0,
            _in_native_fw_mode=True,
            hass=None,
            _refresh_music_flow_entities=lambda: None,
            _notify_camera_preview=lambda: None,
        )

        async def execute(func, op_name, timeout_override=None):
            await func()
            return True

        async def apply_display(skip_post_delay=False):
            applied.append(skip_post_delay)

        async def persist_music_flow():
            return None

        device._execute_hardware_op = execute
        device._apply_display_mode_internal = apply_display
        device._persist_music_flow_runtime_state = persist_music_flow
        set_music_flow = types.MethodType(helpers["async_set_music_flow"], device)

        asyncio.run(set_music_flow(False))
        self.assertFalse(device._music_flow_enabled)
        self.assertEqual([True], applied)
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

    def test_music_flow_stop_finalizes_state_when_display_restore_fails(self):
        helpers = _load_standalone_functions(
            LIGHT_SOURCE,
            {"_build_music_flow_payload", "async_set_music_flow"},
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
            def _close_fast_socket(self):
                return None

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
            _last_native_state_poll=0.0,
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

        async def apply_display(skip_post_delay=False):
            raise RuntimeError("restore failed")

        async def persist_music_flow():
            calls["persist"] += 1

        device._execute_hardware_op = execute
        device._apply_display_mode_internal = apply_display
        device._persist_music_flow_runtime_state = persist_music_flow
        set_music_flow = types.MethodType(helpers["async_set_music_flow"], device)

        with self.assertRaisesRegex(RuntimeError, "could not complete"):
            asyncio.run(set_music_flow(False))

        self.assertFalse(device._music_flow_enabled)
        self.assertIsNone(device._music_flow_restore_power)
        self.assertEqual({"persist": 1, "entities": 1, "preview": 1}, calls)

    def test_music_flow_runtime_state_is_persisted_after_storage_ready(self):
        attributes = _function_source(LIGHT_SOURCE, "extra_state_attributes")
        restore = _function_source(LIGHT_SOURCE, "async_added_to_hass")
        save = _function_source(INIT_SOURCE, "async_save_data")
        setup = _function_source(INIT_SOURCE, "async_setup_entry")
        self.assertIn('"music_flow_restore_power"', attributes)
        self.assertIn("_restore_music_flow_runtime_state()", restore)
        self.assertIn('"device_runtime_state"', save)
        self.assertIn('"device_runtime_state"', setup)
        self.assertIn("await storage_ready.wait()", setup)
        self.assertIn("storage_ready.set()", setup)

    def test_music_flow_skips_property_polling_while_active(self):
        update = _function_source(LIGHT_SOURCE, "async_update")
        self.assertLess(
            update.index("if self._music_flow_enabled:"),
            update.index("read_properties("),
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

    def test_flower_sea_uses_four_directions_and_pink_purple_palette(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        directions = ("Right", "Down", "Left", "Up")
        for phase in (0.37, 7.5, 18.8):
            frames = [tuple(render("Flower Sea", phase, direction)) for direction in directions]
            self.assertEqual(4, len(set(frames)))

        pixels = [
            pixel
            for phase in range(30)
            for pixel in render("Flower Sea", phase, "Right")
        ]
        self.assertTrue(any(red > 100 and blue > red + 12 and blue > green + 25 for red, green, blue in pixels))

        def is_near_white(pixel):
            maximum = max(pixel)
            return maximum > 184 and maximum - min(pixel) < maximum * 0.28

        for direction in directions:
            for step in range(20):
                startup = render("Flower Sea", step * 0.05, direction)
                self.assertFalse(any(map(is_near_white, startup)))
            for phase in range(60):
                frame = render("Flower Sea", phase, direction)
                self.assertLessEqual(sum(map(is_near_white, frame)), 15)

        # Whole rows (Right/Left) or whole columns (Up/Down) must be uniform so
        # a region can never colour only part of a line.
        for direction, vertical in (("Right", False), ("Left", False), ("Up", True), ("Down", True)):
            for phase in range(40):
                frame = render("Flower Sea", phase / 2, direction)
                if vertical:
                    lines = [[frame[r * 20 + c] for r in range(5)] for c in range(20)]
                else:
                    lines = [frame[r * 20:(r + 1) * 20] for r in range(5)]
                for line in lines:
                    self.assertEqual(1, len(set(line)), direction)

    def test_kaleidoscope_rows_form_one_continuous_folded_rainbow(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        directions = ("Right", "Down", "Left", "Up")
        frames = {
            direction: render("Kaleidoscope", 3.0, direction)
            for direction in directions
        }
        self.assertEqual(4, len({tuple(frame) for frame in frames.values()}))
        for frame in frames.values():
            self.assertEqual(100, len(frame))
            for pixel in frame:
                self.assertEqual(3, len(pixel))
                self.assertTrue(all(channel in range(256) for channel in pixel))
        self.assertTrue(any(max(pixel) == 255 for pixel in frames["Right"]))

        def pixel_distance(first, second):
            return sum(abs(a - b) for a, b in zip(first, second))

        # Consecutive rows meet at alternating physical edges. Those joins are
        # ordinary neighboring points on one path, not independently offset
        # lanes, so no row boundary may produce a color discontinuity.
        for step in range(300):
            frame = render("Kaleidoscope", step * 0.1, "Right")
            for row in range(4):
                fold_col = 19 if row % 2 == 0 else 0
                self.assertLessEqual(
                    pixel_distance(
                        frame[row * 20 + fold_col],
                        frame[(row + 1) * 20 + fold_col],
                    ),
                    75,
                )

        def net_shift(direction, row):
            total = 0
            for step in range(60):
                start = 2.0 + step * 0.5
                first = render("Kaleidoscope", start, direction)
                second = render("Kaleidoscope", start + 0.4, direction)
                first_row = first[row * 20:(row + 1) * 20]
                second_row = second[row * 20:(row + 1) * 20]
                best = (1e9, 0)
                for shift in range(-4, 5):
                    total_dist = count = 0
                    for col in range(max(0, -shift), min(20, 20 - shift)):
                        total_dist += pixel_distance(
                            first_row[col], second_row[col + shift]
                        )
                        count += 1
                    if total_dist / count < best[0]:
                        best = (total_dist / count, shift)
                total += best[1]
            return total

        # Neighbouring rows scroll in opposite directions (odd/even fold) so the
        # rainbow's two halves slide apart across each row pair.
        right = [net_shift("Right", row) for row in range(5)]
        self.assertTrue(all(right), right)
        for row in range(1, 5):
            self.assertNotEqual(right[row - 1] > 0, right[row] > 0, right)

        # Left is the mirror of Right: every lane slides the opposite way.
        left = [net_shift("Left", row) for row in range(5)]
        for right_dir, left_dir in zip(right, left):
            self.assertNotEqual(right_dir > 0, left_dir > 0, (right, left))

        # Rows never collapse to a single repeated line; the panel shows five
        # distinct lanes as the folded rainbow slides across.
        distinct = max(
            len({
                tuple(render("Kaleidoscope", step * 0.3, "Right")[row * 20:(row + 1) * 20])
                for row in range(5)
            })
            for step in range(60)
        )
        self.assertEqual(5, distinct)

        # Rows alternate between broad low-diversity fields and narrower rich
        # rainbow passages. Two consecutive folded rows reveal substantially
        # more of the spectrum than a typical single row.
        single = []
        pair_together = []
        for step in range(300):
            frame = render("Kaleidoscope", step * 0.2, "Right")
            row_buckets = []
            for row in range(5):
                buckets = {
                    round(
                        colorsys.rgb_to_hsv(
                            *(channel / 255 for channel in frame[row * 20 + col])
                        )[0]
                        * 12
                    )
                    for col in range(20)
                }
                single.append(len(buckets))
                row_buckets.append(buckets)
            for pair in (0, 2):
                pair_together.append(len(row_buckets[pair] | row_buckets[pair + 1]))
        single.sort()
        median_single = single[len(single) // 2]
        self.assertGreaterEqual(single[len(single) // 10], 2)
        self.assertLessEqual(single[len(single) // 10], 3)
        self.assertLessEqual(median_single, 6)
        self.assertGreaterEqual(single[len(single) * 9 // 10], 8)
        self.assertGreater(
            sum(pair_together) / len(pair_together), median_single + 1
        )

    def test_kaleidoscope_updown_uses_moving_snakes(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        snake_events = NATIVE_PREVIEW["_kaleidoscope_snake_events"]
        snake_emit = NATIVE_PREVIEW["_kaleidoscope_snake_emit"]
        mirror_column = NATIVE_PREVIEW["_kaleidoscope_mirror_column"]

        # A rainbow snake winds column-by-column, so columns are NOT flat: its
        # bright head reads as a moving point and the trail gives vertical
        # variation within columns most of the time.
        nonuniform_frames = 0
        red_head_frames = 0
        varied_frames = 0
        blue_dominant_frames = 0
        for step in range(200):
            phase = step * 0.25
            frame = render("Kaleidoscope", phase, "Down")
            columns_varying = sum(
                1
                for col in range(20)
                if len({frame[row * 20 + col] for row in range(5)}) > 1
            )
            if columns_varying >= 3:
                nonuniform_frames += 1
            if any(pixel[0] > 180 and max(pixel[1:]) < 80 for pixel in frame):
                red_head_frames += 1
            hues = [
                colorsys.rgb_to_hsv(*(channel / 255 for channel in pixel))[0]
                for pixel in frame
            ]
            if max(hues) - min(hues) > 0.5:
                varied_frames += 1
            if sum(0.55 <= hue < 0.75 for hue in hues) > 50:
                blue_dominant_frames += 1
        self.assertGreater(nonuniform_frames, 150)
        self.assertGreater(red_head_frames, 120)
        self.assertGreater(varied_frames, 150)
        self.assertLess(blue_dominant_frames, 10)

        # Fronts repeatedly expand from one-based column 8. The 16-column fold
        # reaches the left edge and meets its next reflection at column 16.
        self.assertEqual(
            [7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4],
            [mirror_column(col) for col in range(20)],
        )

        # Two to four independently timed parent fronts overlap continuously,
        # so the panel never pauses or collapses to one active zone.
        for step in range(-1000, 1001):
            events = snake_events(step * 0.05)
            active = len(events)
            self.assertGreaterEqual(active, 2)
            self.assertLessEqual(active, 4)
            for radius, velocity, trail, hue_span, _event in events:
                self.assertGreaterEqual(radius, 0.0)
                self.assertGreater(velocity, 0.0)
                self.assertGreaterEqual(trail, 18.0)
                self.assertLessEqual(trail, 30.0)
                self.assertGreaterEqual(hue_span, 0.65)
                self.assertLessEqual(hue_span, 0.98)

        # Every spawn has its own deterministic lifetime and therefore a
        # different launch speed. Quartic ease-out moves quickly at ignition,
        # then continuously decelerates until the snake nearly stops at death.
        launch_speeds = []
        trail_lengths = []
        hue_spans = []
        emission_gaps = [
            snake_emit(event + 1) - snake_emit(event)
            for event in range(-100, 100)
        ]
        self.assertLess(min(emission_gaps), 1.5)
        self.assertGreater(max(emission_gaps), 5.0)
        for event in range(-20, 21):
            emit = snake_emit(event)
            radius, launch_speed, trail, hue_span, event_id = next(
                item for item in snake_events(emit) if item[4] == float(event)
            )
            self.assertEqual(0.0, radius)
            self.assertEqual(float(event), event_id)
            launch_speeds.append(round(launch_speed, 6))
            trail_lengths.append(round(trail, 6))
            hue_spans.append(round(hue_span, 6))

            travel = 8 * 5 + (5 - 1) + trail
            lifetime = 4.0 * travel / launch_speed
            samples = [
                next(
                    item
                    for item in snake_events(emit + lifetime * fraction)
                    if item[4] == float(event)
                )
                for fraction in (0.25, 0.5, 0.75, 0.95)
            ]
            radii = [item[0] for item in samples]
            velocities = [item[1] for item in samples]
            self.assertEqual(radii, sorted(radii))
            self.assertEqual(velocities, sorted(velocities, reverse=True))
            self.assertLess(velocities[-1], launch_speed * 0.01)
        self.assertGreater(len(set(launch_speeds)), 20)
        self.assertGreater(max(launch_speeds) - min(launch_speeds), 5.0)
        self.assertGreater(len(set(trail_lengths)), 20)
        self.assertGreater(max(trail_lengths) - min(trail_lengths), 8.0)
        self.assertGreater(len(set(hue_spans)), 20)
        self.assertGreater(max(hue_spans) - min(hue_spans), 0.2)

        # Every Down frame has exact reflected columns around index 7 and a
        # period of 16, matching the symmetry visible in the recording.
        mirror_pairs = (
            (0, 14), (1, 13), (2, 12), (3, 11), (4, 10), (5, 9), (6, 8),
            (0, 16), (1, 17), (2, 18), (3, 19),
        )
        for step in range(200):
            down = render("Kaleidoscope", step * 0.2, "Down")
            for row in range(5):
                for first, second in mirror_pairs:
                    self.assertEqual(
                        down[row * 20 + first], down[row * 20 + second]
                    )

        # Up is the same physical animation with the display rotated 180°.
        for step in range(100):
            down = render("Kaleidoscope", step * 0.3, "Down")
            up = render("Kaleidoscope", step * 0.3, "Up")
            self.assertEqual(list(reversed(down)), up)

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
        generated = _function_source(CAMERA_SOURCE, "_uses_generated_preview")
        self.assertIn('"_music_flow_enabled"', colors)
        self.assertIn("self._get_music_flow_preview()", colors)
        self.assertIn("render_music_flow_effect(", preview)
        self.assertIn('("left", "up")', preview)
        self.assertNotIn('"_music_flow_enabled"', animated)
        self.assertIn('"_music_flow_enabled"', generated)

    def test_official_gallery_contains_68_valid_drawings(self):
        drawings = PIXEL_ART["get_builtin_pixel_arts"]()
        self.assertEqual(68, len(drawings))
        self.assertEqual(68, len({drawing["name"] for drawing in drawings}))
        for drawing in drawings:
            for pixel in drawing["pixels"]:
                self.assertIn(pixel["position"], range(100))
                self.assertEqual(3, len(pixel["color"]))
                self.assertTrue(all(channel in range(256) for channel in pixel["color"]))


if __name__ == "__main__":
    unittest.main()
