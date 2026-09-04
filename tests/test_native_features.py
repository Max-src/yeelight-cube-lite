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
SWITCH_SOURCE = (ROOT / "switch.py").read_text(encoding="utf-8")
CLOCK_CARD_SOURCE = (
    ROOT / "www" / "yeelight-cube-lamp-preview-card.js"
).read_text(encoding="utf-8")


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

    def test_palette_uses_sparse_horizontal_daubs_and_broad_vertical_fields(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        def active_mask(frame):
            return [max(pixel) > 40 for pixel in frame]

        def component_count(mask):
            remaining = {index for index, active in enumerate(mask) if active}
            count = 0
            while remaining:
                count += 1
                pending = [remaining.pop()]
                while pending:
                    index = pending.pop()
                    row, col = divmod(index, 20)
                    for neighbor in (
                        index - 20 if row else -1,
                        index + 20 if row < 4 else -1,
                        index - 1 if col else -1,
                        index + 1 if col < 19 else -1,
                    ):
                        if neighbor in remaining:
                            remaining.remove(neighbor)
                            pending.append(neighbor)
            return count

        horizontal_counts = []
        vertical_counts = []
        horizontal_components = []
        vertical_components = []
        cool_pixels = 0
        warm_pixels = 0
        purple_pixels = 0
        active_pixels = 0
        right_frames = []
        down_frames = []
        for step in range(400):
            phase = step * 0.2
            right = render("Palette", phase, "Right")
            down = render("Palette", phase, "Down")
            right_frames.append(tuple(right))
            down_frames.append(tuple(down))
            horizontal = active_mask(right)
            vertical = active_mask(down)
            horizontal_counts.append(sum(horizontal))
            vertical_counts.append(sum(vertical))
            horizontal_components.append(component_count(horizontal))
            vertical_components.append(component_count(vertical))
            for frame, mask in ((right, horizontal), (down, vertical)):
                for pixel, active in zip(frame, mask):
                    if not active:
                        continue
                    active_pixels += 1
                    hue = colorsys.rgb_to_hsv(*(channel / 255 for channel in pixel))[0]
                    if 0.48 <= hue < 0.75:
                        cool_pixels += 1
                    elif hue < 0.20:
                        warm_pixels += 1
                    elif hue >= 0.75:
                        purple_pixels += 1

        def frame_changes(frames):
            changes = [
                sum(
                    abs(first_channel - second_channel)
                    for first_pixel, second_pixel in zip(first, second)
                    for first_channel, second_channel in zip(
                        first_pixel, second_pixel
                    )
                )
                / 300
                for first, second in zip(frames, frames[1:])
            ]
            changes.sort()
            return changes

        horizontal_counts.sort()
        vertical_counts.sort()
        horizontal_components.sort()
        vertical_components.sort()
        self.assertGreaterEqual(horizontal_counts[40], 8)
        self.assertLessEqual(horizontal_counts[360], 32)
        self.assertGreaterEqual(vertical_counts[360], 80)
        self.assertLess(vertical_counts[40], 30)
        self.assertGreater(
            vertical_counts[200], horizontal_counts[200] * 2
        )
        self.assertGreaterEqual(horizontal_components[200], 3)
        self.assertLessEqual(vertical_components[200], 2)
        self.assertGreater(cool_pixels / active_pixels, 0.5)
        self.assertGreater(warm_pixels / active_pixels, 0.14)
        self.assertGreater(purple_pixels / active_pixels, 0.10)
        self.assertGreater(len(set(right_frames)), 350)
        self.assertGreater(frame_changes(right_frames)[200], 2.0)
        self.assertGreater(frame_changes(down_frames)[200], 5.0)

        for phase in (0.37, 8.6, 23.4, 51.9):
            self.assertEqual(
                render("Palette", phase, "Left"),
                list(reversed(render("Palette", phase, "Right"))),
            )
            self.assertEqual(
                render("Palette", phase, "Up"),
                list(reversed(render("Palette", phase, "Down"))),
            )

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
        # After the on-screen direction relabel, the folded-rainbow rows family
        # is shown for the Down (and Up) arrows.
        self.assertTrue(any(max(pixel) == 255 for pixel in frames["Down"]))

        def pixel_distance(first, second):
            return sum(abs(a - b) for a, b in zip(first, second))

        # Consecutive rows meet at alternating physical edges. Those joins are
        # ordinary neighboring points on one path, not independently offset
        # lanes, so no row boundary may produce a color discontinuity.
        for step in range(300):
            frame = render("Kaleidoscope", step * 0.1, "Down")
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
        down = [net_shift("Down", row) for row in range(5)]
        self.assertTrue(all(down), down)
        for row in range(1, 5):
            self.assertNotEqual(down[row - 1] > 0, down[row] > 0, down)

        # Up is the mirror of Down: every lane slides the opposite way.
        up = [net_shift("Up", row) for row in range(5)]
        for down_dir, up_dir in zip(down, up):
            self.assertNotEqual(down_dir > 0, up_dir > 0, (down, up))

        # Rows never collapse to a single repeated line; the panel shows five
        # distinct lanes as the folded rainbow slides across.
        distinct = max(
            len({
                tuple(render("Kaleidoscope", step * 0.3, "Down")[row * 20:(row + 1) * 20])
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
            frame = render("Kaleidoscope", step * 0.2, "Down")
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
        # variation within columns most of the time. After the direction
        # relabel, the snake family is shown for the Left (and Right) arrows.
        nonuniform_frames = 0
        red_head_frames = 0
        varied_frames = 0
        blue_dominant_frames = 0
        for step in range(200):
            phase = step * 0.25
            frame = render("Kaleidoscope", phase, "Left")
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
            down = render("Kaleidoscope", step * 0.2, "Left")
            for row in range(5):
                for first, second in mirror_pairs:
                    self.assertEqual(
                        down[row * 20 + first], down[row * 20 + second]
                    )

        # Right is the same physical animation with the display rotated 180.
        for step in range(100):
            down = render("Kaleidoscope", step * 0.3, "Left")
            up = render("Kaleidoscope", step * 0.3, "Right")
            self.assertEqual(list(reversed(down)), up)

    def test_blue_white_uses_wandering_reflected_ridges(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        origin = NATIVE_PREVIEW["_blue_pulse_origin"]

        self.assertEqual("Blue White", CONSTANTS["CLOCK_MIXER_EFFECTS"][59])
        self.assertIn('59: "Blue White"', CLOCK_CARD_SOURCE)

        frames = [render("Blue White", step * 0.2, "Right") for step in range(300)]
        self.assertGreater(len({tuple(frame) for frame in frames}), 290)
        self.assertGreater(max(origin(step * 0.2) for step in range(800)), 15.0)
        self.assertLess(min(origin(step * 0.2) for step in range(800)), 5.0)

        white_pixels = blue_pixels = 0
        for frame in frames:
            for red, green, blue in frame:
                self.assertEqual(255, blue)
                self.assertLessEqual(red, green)
                if red > 180 and green > 200:
                    white_pixels += 1
                if red < 45 and 80 < green < 150:
                    blue_pixels += 1
        self.assertGreater(white_pixels, 1000)
        self.assertGreater(blue_pixels, 10000)

        # The travelling front must light up fully white where it meets its
        # mirror at the fold (origin + 8), never reading blue at the meeting.
        fold_peak = 0
        for step in range(700):
            phase = step * 0.1
            antipode = round((origin(phase) + 8) % 20)
            frame = render("Blue White", phase, "Right")
            for col in (antipode - 1, antipode, (antipode + 1) % 20):
                fold_peak = max(fold_peak, frame[2 * 20 + col][1])
        self.assertGreater(fold_peak, 220)

        # The lamp plays Blue White identically for every arrow, so all four
        # directions match the horizontal "right" form.
        for phase in (0.37, 8.6, 23.4, 51.9):
            right = render("Blue White", phase, "Right")
            for direction in ("Up", "Down", "Left"):
                self.assertEqual(right, render("Blue White", phase, direction))

        # Recorded horizontal frames are nearly column-uniform, but the lower
        # rows trail by about one column instead of being exact copies.
        frame = render("Blue White", 8.6, "Right")
        distinct_rows = {
            tuple(frame[row * 20:(row + 1) * 20]) for row in range(5)
        }
        self.assertGreaterEqual(len(distinct_rows), 4)

    def test_blue_yellow_uses_distinct_color_zones_and_clock_mixer(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        self.assertEqual("Blue Yellow", CONSTANTS["CLOCK_MIXER_EFFECTS"][57])
        self.assertIn('57: "Blue Yellow"', CLOCK_CARD_SOURCE)

        for phase in (0.37, 8.6, 23.4, 51.9):
            yellow = render("Blue Yellow", phase, "Right")
            white = render("Blue White", phase, "Right")
            for direction in ("Up", "Down", "Left"):
                self.assertEqual(yellow, render("Blue Yellow", phase, direction))
            self.assertNotEqual(yellow, white)

        # The pattern scrolls continuously: no frame-to-frame jump anywhere
        # (a bouncing/reset front would spike this), so the loop is seamless.
        previous = render("Blue Yellow", 0.0, "Right")
        max_delta = 0
        for step in range(1, 4000):
            current = render("Blue Yellow", step * 0.05, "Right")
            max_delta = max(
                max_delta,
                max(
                    abs(left - right)
                    for before_pixel, after_pixel in zip(previous, current)
                    for left, right in zip(before_pixel, after_pixel)
                ),
            )
            previous = current
        self.assertLess(max_delta, 60)

        # The effect is mirror-symmetric with multiple sections, not a single
        # blob: at some frame the top row shows two or more separate yellow runs.
        def _yellow_runs(frame):
            row = frame[0:20]
            runs = 0
            inside = False
            for red, _, blue in row:
                is_yellow = red - blue > 40
                if is_yellow and not inside:
                    runs += 1
                inside = is_yellow
            return runs

        max_runs = max(
            _yellow_runs(render("Blue Yellow", step * 0.2, "Right"))
            for step in range(300)
        )
        self.assertGreaterEqual(max_runs, 2)

        pixels = [
            pixel
            for step in range(300)
            for pixel in render("Blue Yellow", step * 0.2, "Right")
        ]
        self.assertTrue(
            any(red > 230 and green > 220 and blue < 80 for red, green, blue in pixels)
        )
        self.assertTrue(
            any(red < 90 and green < 150 and blue > 240 for red, green, blue in pixels)
        )
        self.assertTrue(
            any(red > 150 and green > 190 and blue > 180 for red, green, blue in pixels)
        )

        # Clear frames contain yellow, then a white separator, then vivid blue.
        ordered_boundary = False
        for step in range(300):
            frame = render("Blue Yellow", step * 0.2, "Right")
            for row in range(5):
                line = frame[row * 20:(row + 1) * 20]
                for col in range(15):
                    red, green, blue = line[col]
                    if not (red > 230 and green > 220 and blue < 80):
                        continue
                    following = line[col + 1:col + 6]
                    white_index = next(
                        (
                            index
                            for index, pixel in enumerate(following)
                            if min(pixel) > 180
                        ),
                        None,
                    )
                    if white_index is None:
                        continue
                    ordered_boundary = any(
                        pixel[0] < 60 and pixel[1] > 145 and pixel[2] > 240
                        for pixel in following[white_index + 1:]
                    )
                    if ordered_boundary:
                        break
                if ordered_boundary:
                    break
            if ordered_boundary:
                break
        self.assertTrue(ordered_boundary)

    def test_ice_blue_matches_cloud_palette_speed_and_clock_mixer(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        self.assertEqual("Ice Blue", CONSTANTS["CLOCK_MIXER_EFFECTS"][58])
        self.assertIn('58: "Ice Blue"', CLOCK_CARD_SOURCE)

        for phase in (0.37, 8.6, 23.4, 51.9):
            frame = render("Ice Blue", phase, "Right")
            for direction in ("Up", "Down", "Left"):
                self.assertEqual(frame, render("Ice Blue", phase, direction))
            self.assertTrue(all(blue == 255 for _, _, blue in frame))
            self.assertTrue(all(8 <= red <= 145 for red, _, _ in frame))
            self.assertTrue(all(165 <= green <= 211 for _, green, _ in frame))

        frame = render("Ice Blue", 8.6, "Right")
        self.assertGreater(max(red for red, _, _ in frame) - min(red for red, _, _ in frame), 60)
        distinct_rows = {
            tuple(frame[row * 20:(row + 1) * 20]) for row in range(5)
        }
        self.assertEqual(5, len(distinct_rows))

        phase_per_second = 0.25 + 50 / 55.0

        def _correlation(first, second):
            first_values = [pixel[0] for pixel in first]
            second_values = [pixel[0] for pixel in second]
            first_mean = sum(first_values) / len(first_values)
            second_mean = sum(second_values) / len(second_values)
            numerator = sum(
                (left - first_mean) * (right - second_mean)
                for left, right in zip(first_values, second_values)
            )
            denominator = (
                sum((value - first_mean) ** 2 for value in first_values)
                * sum((value - second_mean) ** 2 for value in second_values)
            ) ** 0.5
            return numerator / denominator

        correlations = []
        for seconds in (0.1, 0.5, 1.0):
            samples = []
            for step in range(100):
                phase = step * 0.37
                samples.append(
                    _correlation(
                        render("Ice Blue", phase, "Right"),
                        render(
                            "Ice Blue",
                            phase + seconds * phase_per_second,
                            "Right",
                        ),
                    )
                )
            correlations.append(sum(samples) / len(samples))

        self.assertGreater(correlations[0], 0.9)
        self.assertTrue(0.15 < correlations[1] < 0.55)
        self.assertLess(abs(correlations[2]), 0.2)

    def test_sunset_matches_row_sweeps_palette_cadence_and_clock_mixer(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        self.assertEqual("Sunset", CONSTANTS["CLOCK_MIXER_EFFECTS"][54])
        self.assertIn('54: "Sunset"', CLOCK_CARD_SOURCE)

        for phase in (0.37, 8.6, 23.4, 51.9):
            frame = render("Sunset", phase, "Right")
            for row in range(5):
                self.assertEqual(1, len(set(frame[row * 20 : (row + 1) * 20])))
            for direction in ("Up", "Down", "Left"):
                self.assertEqual(frame, render("Sunset", phase, direction))

        top_first = render("Sunset", 1.98, "Right")
        bottom_first = render("Sunset", 3.96, "Right")
        self.assertNotEqual(top_first[:20], top_first[-20:])
        self.assertEqual(top_first[40:60], top_first[-20:])
        self.assertNotEqual(bottom_first[:20], bottom_first[-20:])
        self.assertEqual(bottom_first[:20], bottom_first[40:60])

        held_colors = [
            render("Sunset", (event + 0.6) * 0.99, "Right")[0]
            for event in range(56)
        ]
        green_count = sum(
            red < 10 and green > 245 and blue < 40
            for red, green, blue in held_colors
        )
        pale_count = sum(red > 120 for red, _green, _blue in held_colors)
        self.assertTrue(1 <= green_count <= 4)
        self.assertGreater(pale_count, 30)
        self.assertTrue(
            any(red < 50 and green > 185 and blue > 245 for red, green, blue in held_colors)
        )
        self.assertFalse(
            any(green < 150 and blue > 245 for _red, green, blue in held_colors)
        )

        for event in range(-10, 20):
            held = render("Sunset", (event + 0.55) * 0.99, "Right")
            self.assertEqual(
                held,
                render("Sunset", (event + 0.75) * 0.99, "Right"),
            )

        phase_per_second = 0.25 + 50 / 55.0

        def _correlation(first, second):
            first_values = [pixel[1] - pixel[2] for pixel in first]
            second_values = [pixel[1] - pixel[2] for pixel in second]
            first_mean = sum(first_values) / len(first_values)
            second_mean = sum(second_values) / len(second_values)
            numerator = sum(
                (left - first_mean) * (right - second_mean)
                for left, right in zip(first_values, second_values)
            )
            denominator = (
                sum((value - first_mean) ** 2 for value in first_values)
                * sum((value - second_mean) ** 2 for value in second_values)
            ) ** 0.5
            return numerator / denominator if denominator else 1.0

        def _color_correlation(seconds):
            first = []
            second = []
            for step in range(400):
                phase = step * 0.19
                first.extend(render("Sunset", phase, "Right"))
                second.extend(
                    render(
                        "Sunset", phase + seconds * phase_per_second, "Right"
                    )
                )
            return _correlation(first, second)

        self.assertGreater(_color_correlation(0.1), 0.9)
        self.assertTrue(0.3 < _color_correlation(0.5) < 0.6)
        self.assertLess(abs(_color_correlation(0.85)), 0.15)

    def test_carousel_matches_pivoting_bands_and_clock_mixer(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        self.assertEqual("Carousel", CONSTANTS["CLOCK_MIXER_EFFECTS"][56])
        self.assertEqual(
            {"name": "Carousel", "mixer": 56},
            CONSTANTS["NATIVE_CLOCK_STYLES"][15],
        )
        self.assertIn('56: "Carousel"', CLOCK_CARD_SOURCE)
        self.assertIn('15: 56', CLOCK_CARD_SOURCE)

        directions = ("Right", "Down", "Left", "Up")
        peak_red = {direction: 0 for direction in directions}
        for phase in (0.0, 0.37, 1.0, 2.1):
            frames = {
                direction: render("Carousel", phase, direction)
                for direction in directions
            }
            self.assertEqual(4, len({tuple(frame) for frame in frames.values()}))
            for direction, frame in frames.items():
                self.assertEqual(100, len(frame))
                self.assertEqual(
                    frame,
                    render("Carousel", phase + 2.366, direction),
                )
                self.assertTrue(
                    all(blue == 255 for _red, _green, blue in frame)
                )
                peak_red[direction] = max(
                    peak_red[direction],
                    max(red for red, _green, _blue in frame),
                )
                self.assertEqual(0, min(red for red, _green, _blue in frame))
        self.assertTrue(all(red > 200 for red in peak_red.values()))

        self.assertEqual(
            render("Carousel", 0.5, "Up"),
            render("Carousel", 0.5, "unknown"),
        )

        frame = render("Carousel", 0.0, "Right")
        pivot = [frame[row * 20 + 8] for row in range(5)]
        edge = [frame[row * 20] for row in range(5)]
        self.assertLessEqual(
            max(
                max(pixel[channel] for pixel in pivot)
                - min(pixel[channel] for pixel in pivot)
                for channel in range(3)
            ),
            1,
        )
        self.assertGreater(len(set(edge)), 3)

        # Arrow -> field mapping (corrected 90 deg vs the recordings): Right has
        # a tight vertical pivot at column 8 while Left flows strongly along the
        # rows there. This guards against the directions silently re-rotating.
        left_col8 = [render("Carousel", 0.0, "Left")[row * 20 + 8] for row in range(5)]
        self.assertGreater(
            max(
                max(pixel[channel] for pixel in left_col8)
                - min(pixel[channel] for pixel in left_col8)
                for channel in range(3)
            ),
            15,
        )

        phase_per_second = 0.25 + 50 / 55.0
        self.assertAlmostEqual(2.041, 2.366 / phase_per_second, places=3)

    def test_spectrum_crumble_matches_directional_flow_and_excludes_clock(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        phase_per_second = 0.25 + 50 / 55.0

        # Mode 60 is a selectable native effect but must NOT be a clock option:
        # it goes fully dark for most of its cycle, so masked characters vanish.
        self.assertNotIn(60, CONSTANTS["CLOCK_MIXER_EFFECTS"])
        self.assertNotIn('60: "Spectrum', CLOCK_CARD_SOURCE)
        style_mixers = {
            style["mixer"] for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
        }
        self.assertNotIn(60, style_mixers)

        lit_counts = []
        for seconds in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 4.5, 6.0):
            frame = render("Spectrum Crumble", seconds * phase_per_second, "Up")
            self.assertEqual(100, len(frame))
            lit_counts.append(sum(max(pixel) > 25 for pixel in frame))
        self.assertEqual([0, 28, 57, 86, 100, 58, 10, 0, 0], lit_counts)

        full = render("Spectrum Crumble", 2.0 * phase_per_second, "Up")
        self.assertGreater(full[0][0], full[0][1])
        self.assertGreater(full[-1][0], full[-1][1])
        self.assertGreater(full[-1][2], full[-1][0])

        frames = {
            tuple(render("Spectrum Crumble", 1.2, direction))
            for direction in ("Up", "Down", "Left", "Right")
        }
        self.assertEqual(4, len(frames))
        cycle_seconds = 8.954 / phase_per_second
        self.assertAlmostEqual(7.725, cycle_seconds, places=3)

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
        activate = _function_source(LIGHT_SOURCE, "_activate_native_clock")
        self.assertIn("CLOCK_MIXER_COMMAND_IDS", activate)
        style = next(
            style
            for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
            if style["mixer"] == 10
        )
        self.assertEqual("Fireworks", style["name"])

        # Direction 1 / Down begins at the physical bottom-right with a white
        # rocket; the other directions rotate that same launch corner.
        down = render("Fireworks", 0.0, "Down")
        up = render("Fireworks", 0.0, "Up")
        right = render("Fireworks", 0.0, "Right")
        left = render("Fireworks", 0.0, "Left")
        self.assertGreater(min(down[19]), 200)
        self.assertGreater(min(up[80]), 200)
        self.assertGreater(min(right[0]), 200)
        self.assertGreater(min(left[99]), 200)

        burst = render("Fireworks", 2.2, "Down")
        burst_pixels = [pixel for pixel in burst if pixel != (0, 0, 0)]
        self.assertGreaterEqual(len(burst_pixels), 12)
        self.assertGreaterEqual(
            len({pixel for pixel in burst_pixels if max(pixel) - min(pixel) > 60}),
            8,
        )
        self.assertTrue(all(pixel == (0, 0, 0) for pixel in render("Fireworks", 2.8)))

    def test_spectrum_chase_matches_repeating_color_waves_and_clock_mixer(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        phase_per_second = 0.25 + 50 / 55.0
        wave_period = 6.04

        self.assertEqual("Spectrum Chase", CONSTANTS["CLOCK_MIXER_EFFECTS"][6])
        self.assertIn('6: "Spectrum Chase"', CLOCK_CARD_SOURCE)
        self.assertIn('typeof nested === "string"', CLOCK_CARD_SOURCE)
        self.assertIn('effectName === nested', CLOCK_CARD_SOURCE)
        style = next(
            style
            for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
            if style["mixer"] == 6
        )
        self.assertEqual("Spectrum Chase", style["name"])

        for direction in ("Right", "Up", "Left", "Down"):
            frame = render("Spectrum Chase", 2.13, direction)
            next_color = render("Spectrum Chase", 2.13 + wave_period, direction)
            self.assertEqual(100, len(frame))
            self.assertEqual(
                [max(pixel) for pixel in frame],
                [max(pixel) for pixel in next_color],
            )
            self.assertNotEqual(frame, next_color)

            # All simultaneous waves share one hue; only their brightness is
            # spatially shifted. A new wave never introduces a different color.
            chromaticities = {
                tuple(round(channel / max(pixel), 2) for channel in pixel)
                for pixel in frame
                if max(pixel) > 50
            }
            self.assertLessEqual(len(chromaticities), 2)

        right = render("Spectrum Chase", 1.7, "Right")
        up = render("Spectrum Chase", 1.7, "Up")
        self.assertEqual(right[5], right[20])
        self.assertEqual(up[1], up[20])
        self.assertEqual(
            render("Spectrum Chase", 1.7, "Left")[0],
            right[0],
        )
        self.assertEqual(
            render("Spectrum Chase", 1.7, "Down")[0],
            up[0],
        )
        self.assertEqual(
            4,
            len(
                {
                    tuple(render("Spectrum Chase", 1.7, direction))
                    for direction in ("Right", "Up", "Left", "Down")
                }
            ),
        )
        self.assertAlmostEqual(5.211, wave_period / phase_per_second, places=3)
        self.assertAlmostEqual(
            52.110,
            wave_period * 10 / phase_per_second,
            places=3,
        )

    def test_pastel_pulse_matches_measured_colour_maps_and_clock_mixer(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        self.assertEqual("Pastel Pulse", CONSTANTS["CLOCK_MIXER_EFFECTS"][9])
        self.assertIn('9: "Pastel Pulse"', CLOCK_CARD_SOURCE)
        style = next(
            style
            for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
            if style["mixer"] == 9
        )
        self.assertEqual("Pastel Pulse", style["name"])
        self.assertEqual(
            "Up",
            CONSTANTS["CLOCK_MIXER_FIXED_DIRECTION"]["Pastel Pulse"],
        )

        # At the neutral phase the breath is zero. Right/Left use the 3-diagonal
        # map (Right as captured); Up/Down use the finer map (Up as captured).
        right = render("Pastel Pulse", 0.0, "Right")
        self.assertEqual(100, len(right))
        self.assertEqual((201, 156, 255), right[0 * 20 + 11])  # violet, bottom
        self.assertEqual((239, 183, 155), right[4 * 20 + 7])   # warm, top row
        self.assertEqual((255, 255, 255), right[0])            # grey -> white

        up = render("Pastel Pulse", 0.0, "Up")
        self.assertEqual((14, 234, 147), up[0 * 20 + 7])       # vivid green
        self.assertEqual((239, 174, 155), up[2 * 20 + 1])      # warm/tan island

        # Down = Up rotated 180 deg; Left = Right rotated 180 deg.
        down = render("Pastel Pulse", 0.0, "Down")
        left = render("Pastel Pulse", 0.0, "Left")
        self.assertEqual((255, 255, 255), down[0])             # grey -> white
        for row in range(5):
            for col in range(20):
                self.assertEqual(down[row * 20 + col], up[(4 - row) * 20 + (19 - col)])
                self.assertEqual(left[row * 20 + col], right[(4 - row) * 20 + (19 - col)])

        # The field breathes subtly: a non-neutral phase shifts brightness a
        # little without recolouring cells.
        breathed = render("Pastel Pulse", 0.8, "Right")
        self.assertNotEqual(right, breathed)
        drift = sum(
            abs(a - b) for pa, pb in zip(right, breathed) for a, b in zip(pa, pb)
        ) / (100 * 3)
        self.assertGreater(drift, 0.0)
        self.assertLess(drift, 14.0)

    def test_ember_matches_measured_heat_field_and_clock_mixer(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        self.assertEqual("Ember", CONSTANTS["CLOCK_MIXER_EFFECTS"][24])
        self.assertIn('24: "Ember"', CLOCK_CARD_SOURCE)
        style = next(
            style
            for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
            if style["mixer"] == 24
        )
        self.assertEqual("Ember", style["name"])
        self.assertNotIn("Ember", CONSTANTS["CLOCK_MIXER_FIXED_DIRECTION"])

        phase = 2.3
        right = render("Ember", phase, "Right")
        left = render("Ember", phase, "Left")
        up = render("Ember", phase, "Up")
        down = render("Ember", phase, "Down")
        self.assertEqual(100, len(right))
        for row in range(5):
            for col in range(20):
                self.assertEqual(left[row * 20 + col], right[row * 20 + 19 - col])
                self.assertEqual(down[row * 20 + col], up[(4 - row) * 20 + col])

        # Hardware footage shows strong coherence perpendicular to the selected
        # direction and nearly independent values along it.
        def mean_difference(frame, row_step, col_step):
            differences = []
            for row in range(5 - row_step):
                for col in range(20 - col_step):
                    first = frame[row * 20 + col]
                    second = frame[(row + row_step) * 20 + col + col_step]
                    differences.append(
                        sum(abs(a - b) for a, b in zip(first, second)) / 3
                    )
            return sum(differences) / len(differences)

        self.assertLess(mean_difference(right, 1, 0), mean_difference(right, 0, 1))
        self.assertLess(mean_difference(up, 0, 1), mean_difference(up, 1, 0))

        # Across sampled phases, most cells glow but only a minority reach the
        # cream-hot end of the palette, as measured in both recordings.
        sampled = [
            pixel
            for sample_phase in (0.0, 1.0, 2.0, 3.0, 4.0, 5.0)
            for pixel in render("Ember", sample_phase, "Right")
        ]
        lit = sum(max(pixel) > 25 for pixel in sampled) / len(sampled)
        hot = sum(max(pixel) > 200 for pixel in sampled) / len(sampled)
        self.assertGreater(lit, 0.75)
        self.assertLess(hot, 0.45)

    def test_solar_flare_matches_measured_drifting_plasma_clusters(self):
        render = NATIVE_PREVIEW["render_native_effect"]
        palette = NATIVE_PREVIEW["_SOLAR_FLARE_PALETTE"]
        spawn_cols = set(NATIVE_PREVIEW["_SOLAR_FLARE_SPAWN_COLS"])
        darkest = palette[0]

        self.assertEqual("Solar Flare", CONSTANTS["CLOCK_MIXER_EFFECTS"][19])
        self.assertIn('19: "Solar Flare"', CLOCK_CARD_SOURCE)
        style = next(
            style
            for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
            if style["mixer"] == 19
        )
        self.assertEqual("Solar Flare", style["name"])

        phase = 1.0
        right = render("Solar Flare", phase, "Right")
        left = render("Solar Flare", phase, "Left")
        up = render("Solar Flare", phase, "Up")
        down = render("Solar Flare", phase, "Down")
        self.assertEqual(100, len(right))
        for row in range(5):
            for col in range(20):
                # Left is Right rotated 180 degrees.
                self.assertEqual(
                    left[row * 20 + col], right[(4 - row) * 20 + (19 - col)]
                )
                # Up is Down rotated 180 degrees.
                self.assertEqual(
                    up[row * 20 + col], down[(4 - row) * 20 + (19 - col)]
                )

        frames = [render("Solar Flare", k * 0.1, "Right") for k in range(120)]

        # Every pixel lies on the smooth gradient between two adjacent palette
        # colours (fades now interpolate instead of snapping to a palette step).
        def level_of(color):
            best_level = 0.0
            best_dist = None
            for lo in range(len(palette) - 1):
                c0 = palette[lo]
                c1 = palette[lo + 1]
                dx = (c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2])
                denom = dx[0] ** 2 + dx[1] ** 2 + dx[2] ** 2
                if denom == 0:
                    t = 0.0
                else:
                    t = (
                        (color[0] - c0[0]) * dx[0]
                        + (color[1] - c0[1]) * dx[1]
                        + (color[2] - c0[2]) * dx[2]
                    ) / denom
                    t = max(0.0, min(1.0, t))
                proj = (c0[0] + dx[0] * t, c0[1] + dx[1] * t, c0[2] + dx[2] * t)
                dist = (
                    (proj[0] - color[0]) ** 2
                    + (proj[1] - color[1]) ** 2
                    + (proj[2] - color[2]) ** 2
                )
                if best_dist is None or dist < best_dist:
                    best_dist = dist
                    best_level = lo + t
            return best_level, best_dist

        for frame in frames:
            for pixel in frame:
                # Rounding leaves each channel within 0.5 of the ideal gradient.
                self.assertLessEqual(level_of(pixel)[1], 1.0)

        # The panel starts entirely at the darkest colour.
        self.assertTrue(all(pixel == darkest for pixel in frames[0]))

        # Animation is alive.
        self.assertNotEqual(frames[0], render("Solar Flare", 0.8, "Right"))

        def level(color):
            return int(round(level_of(color)[0]))

        # A flare is a bright head with a fading tail BEHIND it and a short
        # ramp-up gradient AHEAD of it (both sides lit, head is the local peak).
        def has_front_ramp(frame):
            for row in range(5):
                base = row * 20
                for col in range(1, 18):
                    here = level(frame[base + col])
                    ahead = level(frame[base + col + 1])
                    behind = level(frame[base + col - 1])
                    if here > ahead > 0 and behind > 0:
                        return True
            return False

        self.assertTrue(any(has_front_ramp(frame) for frame in frames))

        # Flares ignite on the ignition row, shown at the top of the panel
        # (array row 4 after the Y flip).
        self.assertTrue(
            any(level(frame[4 * 20 + col]) > 0 for frame in frames for col in range(20))
        )

        # Wrapping: flares only ignite on one row, so any lit cell on the other
        # rows proves the streak wrapped to the next row's left edge.
        self.assertTrue(
            any(
                level(frame[row * 20 + col]) > 0
                for frame in frames
                for row in range(0, 4)
                for col in range(20)
            )
        )

        # Reach distribution: 80% of flares stay within the top 3 rows, 95%
        # within 4, and any that reach the bottom row start at col 0/1/2.
        events_fn = NATIVE_PREVIEW["_solar_flare_events"]
        flares = {}
        for sample in range(4, 200):
            for ts, col, dist, trail in events_fn(sample * 0.5):
                flares[round(ts, 4)] = (col, col + dist, trail)
        reaches = list(flares.values())
        total = len(reaches)
        self.assertGreater(total, 60)
        within3 = sum(1 for _, reach, _ in reaches if reach <= 59) / total
        within4 = sum(1 for _, reach, _ in reaches if reach <= 79) / total
        self.assertGreaterEqual(within3, 0.72)
        self.assertLessEqual(within3, 0.88)
        self.assertGreaterEqual(within4, 0.90)
        # Only columns 0/1/2 may reach rows 3-4 (reach >= 60).
        self.assertTrue(all(col in (0, 1, 2) for col, reach, _ in reaches if reach >= 60))
        # Flares only ever ignite at the allowed spawn columns.
        self.assertTrue(all(col in spawn_cols for col, _, _ in reaches))
        # Common near-row dots carry a short trail; the rare far-reaching flares
        # are long streaks that fill their whole path until they fade.
        near = [trail for _, reach, trail in reaches if reach < 60]
        far = [trail for _, reach, trail in reaches if reach >= 60]
        self.assertTrue(near and far)
        self.assertTrue(all(t <= 22 for t in near))
        self.assertTrue(all(t >= 40 for t in far))
        near.sort()
        self.assertLess(near[len(near) // 2], 14)  # median near-row trail is short
        self.assertGreater(len({round(t, 1) for t in near}), len(near) // 2)  # trails vary

        # Every dot shares one horizontal speed (only fade distance varies).
        self.assertIsInstance(NATIVE_PREVIEW["_SOLAR_FLARE_SPEED"], float)

        # Bright dots stay visible reaching the bottom display row (canonical
        # row 4 -> array row 0 after the Y flip) — not just a dark remnant.
        self.assertTrue(
            any(
                level(render("Solar Flare", k * 0.05, "Right")[col]) >= 2
                for k in range(400)
                for col in range(20)
            )
        )

    def test_twinkle_matches_measured_independent_fade_pulses(self):
        render = NATIVE_PREVIEW["render_native_effect"]

        self.assertEqual("Twinkle", CONSTANTS["CLOCK_MIXER_EFFECTS"][79])
        self.assertIn('79: "Twinkle"', CLOCK_CARD_SOURCE)
        style = next(
            style
            for style in CONSTANTS["NATIVE_CLOCK_STYLES"].values()
            if style["mixer"] == 79
        )
        self.assertEqual("Twinkle", style["name"])

        phase = 1.7
        right = render("Twinkle", phase, "Right")
        left = render("Twinkle", phase, "Left")
        up = render("Twinkle", phase, "Up")
        down = render("Twinkle", phase, "Down")
        self.assertEqual(100, len(right))
        for row in range(5):
            for col in range(20):
                self.assertEqual(left[row * 20 + col], right[row * 20 + 19 - col])
                self.assertEqual(down[row * 20 + col], up[(4 - row) * 20 + col])

        # At rate 50, the recording shows independent resets mainly every
        # 54-63 frames and only about 13% of samples below value 70.
        phase_rate = 0.25 + 50 / 55.0
        frames = [
            render("Twinkle", frame / 30.0 * phase_rate, "Right")
            for frame in range(817)
        ]
        values = [[max(pixel) for pixel in frame] for frame in frames]
        dark = sum(value < 70 for frame in values for value in frame)
        self.assertGreater(dark / (817 * 100), 0.09)
        self.assertLess(dark / (817 * 100), 0.16)
        reset_gaps = []
        for cell in range(100):
            resets = [
                frame
                for frame in range(1, len(values))
                if values[frame][cell] - values[frame - 1][cell] > 80
            ]
            reset_gaps.extend(
                later - earlier for earlier, later in zip(resets, resets[1:])
            )
        reset_gaps.sort()
        self.assertGreaterEqual(reset_gaps[len(reset_gaps) // 10], 52)
        self.assertLessEqual(reset_gaps[9 * len(reset_gaps) // 10], 62)
        self.assertTrue(all(blue >= red and blue >= green for red, green, blue in right))

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
        # mixer must resolve to the same effect that shares its firmware id.
        self.assertEqual("Rainbow", mixer_effects[clock_styles[1]["mixer"]])
        self.assertEqual("Ocean Waves", mixer_effects[clock_styles[2]["mixer"]])
        self.assertEqual("Spectrum", mixer_effects[clock_styles[3]["mixer"]])
        for mixer, effect_name in mixer_effects.items():
            self.assertEqual(mixer, native_effects[effect_name]["mode"])
        # The direction must produce colour variation across columns so the
        # masked clock characters sweep horizontally rather than banding by row.
        frame = render("Rainbow", 0.0, CONSTANTS["CLOCK_MIXER_EFFECT_DIRECTION"])
        columns = {tuple(frame[c]) for c in range(20)}
        self.assertGreater(len(columns), 10)

    def test_clock_preview_masks_native_effect_and_keeps_colon_blink(self):
        clock = _function_source(CAMERA_SOURCE, "_get_clock_preview")
        # Mixer-effect styles render the effect and mask it to the glyph pixels.
        self.assertIn("CLOCK_MIXER_EFFECTS", clock)
        self.assertIn("render_native_effect(", clock)
        self.assertIn("effect_frame[row * COLS + col]", clock)
        # Colon blink, date/12h/offset handling stay intact.
        self.assertIn('char == ":"', clock)
        self.assertIn("colon_visible", clock)
        self.assertIn("_native_clock_12_hour", clock)
        # The JS card mirrors the same masking and colon-blink behaviour.
        self.assertIn("CLOCK_MIXER_EFFECTS", CLOCK_CARD_SOURCE)
        self.assertIn("renderNativeEffect(effectName", CLOCK_CARD_SOURCE)
        self.assertIn("effectFrame[row * COLS + col]", CLOCK_CARD_SOURCE)
        self.assertIn("colonVisible", CLOCK_CARD_SOURCE)

    def test_clock_style_sends_and_previews_mixer_direction(self):
        resolve = CONSTANTS["resolve_clock_mixer_direction"]
        mixer_effects = CONSTANTS["CLOCK_MIXER_EFFECTS"]
        fixed = CONSTANTS["CLOCK_MIXER_FIXED_DIRECTION"]

        # Every clock mixer effect is direction-capable and flows in the
        # selected native-effect direction, except effects pinned to a fixed
        # clock orientation by the firmware.
        for label in ("Right", "Down", "Left", "Up"):
            for effect_name in mixer_effects.values():
                expected = fixed.get(effect_name, label)
                self.assertEqual(expected, resolve(label, effect_name))
        # Spectrum Chase's clock background always renders Up on the hardware.
        self.assertEqual("Up", fixed["Spectrum Chase"])
        for label in ("Right", "Down", "Left", "Up"):
            self.assertEqual("Up", resolve(label, "Spectrum Chase"))
        self.assertIn('CLOCK_MIXER_FIXED_DIRECTION[effectName]', CLOCK_CARD_SOURCE)
        # A direction-less effect or unknown mixer yields no direction byte.
        self.assertIsNone(resolve("Up", "Magic"))
        self.assertIsNone(resolve("Up", None))

        # The clock activation command carries a firmware direction byte taken
        # from the selected native-effect direction, remapped per effect.
        activate = _function_source(LIGHT_SOURCE, "_activate_native_clock")
        self.assertIn("resolve_clock_mixer_direction(", activate)
        self.assertIn("self._native_effect_direction", activate)
        self.assertIn('effect_config["direction"]', activate)
        self.assertIn("direction_remap", activate)

        # The fx-explorer reflects a clock command's direction byte so the
        # preview tracks whatever direction was applied on the lamp.
        reflect = _function_source(LIGHT_SOURCE, "handle_send_fx_effect")
        self.assertIn("target._native_effect_direction = _dn", reflect)

        # Both previews resolve the mixer direction from the native-effect
        # direction (never the mount, so the clock face is not flipped).
        clock_preview = _function_source(CAMERA_SOURCE, "_get_clock_preview")
        self.assertIn("resolve_clock_mixer_direction(", clock_preview)
        self.assertIn("_native_effect_direction", clock_preview)
        self.assertIn("native_effect_direction", CLOCK_CARD_SOURCE)
        self.assertIn(
            "renderNativeEffect(effectName, phase, direction)", CLOCK_CARD_SOURCE
        )

    def test_fx_explorer_reflects_clock_style_for_live_preview(self):
        handler = _function_source(LIGHT_SOURCE, "handle_send_fx_effect")
        # Everything before the persist blocks is the always-reflect path that
        # runs even when persist is unchecked (the fx-explorer card default).
        reflect = handler.split("persisted = False")[0]
        # Selecting a clock style must update the style itself (not just the
        # mode) so the preview card renders the correct masked effect / colour,
        # and must refresh the linked settings controls -- matching a normal
        # clock-style selection from the device page.
        self.assertIn('target._mode = "Clock"', reflect)
        self.assertIn("target._native_clock_style = effect_style", reflect)
        self.assertIn("target._refresh_linked_entities()", reflect)
        # The card derives the effect from clock_style_id, so it must be the
        # attribute that gets updated.
        self.assertIn("clock_style_id", CLOCK_CARD_SOURCE)
        self.assertIn("_clockStyleMixer", CLOCK_CARD_SOURCE)

    def test_extended_native_effects_are_hidden_gradient_modes(self):
        official = CONSTANTS["NATIVE_EFFECTS"]
        extended = CONSTANTS["EXTENDED_NATIVE_EFFECTS"]
        merged = CONSTANTS["ALL_NATIVE_EFFECTS"]
        official_modes = {spec["mode"] for spec in official.values()}
        clock_mode = CONSTANTS["NATIVE_CLOCK_EFFECT_ID"]
        # Every firmware mode in 1..99 that isn't already an official effect (or
        # the clock renderer) is exposed as an extended effect.
        expected_modes = {
            m for m in range(1, 100)
            if m not in official_modes and m != clock_mode
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
            "Spectrum Chase": 6,
            "Pastel Pulse": 9,
            "Fireworks": 10,
            "Solar Flare": 19,
            "Ember": 24,
            "Sunset": 54,
            "Carousel": 56,
            "Blue Yellow": 57,
            "Ice Blue": 58,
            "Blue White": 59,
            "Spectrum Crumble": 60,
            "Twinkle": 79,
        }
        for effect_name, mode in named.items():
            self.assertIn(effect_name, extended)
            self.assertEqual(mode, extended[effect_name]["mode"])
        for name, spec in extended.items():
            self.assertEqual(71 if name == "Fireworks" else 3, spec["effect_id"])
            self.assertTrue(spec.get("extended"))
            self.assertTrue(spec.get("speed"))
            self.assertNotIn(spec["mode"], official_modes)
            # Unnamed slots keep the mode number as a placeholder name.
            if name not in named:
                self.assertEqual(name, str(spec["mode"]))
        # Official list is untouched; merged is the exact union.
        self.assertEqual(18, len(official))
        self.assertEqual({**official, **extended}, merged)

    def test_extended_effects_are_gated_behind_the_switch(self):
        # The effect dropdown only offers the extended effects when enabled, and
        # refuses to select one while the switch is off.
        self.assertIn("EXTENDED_NATIVE_EFFECTS", SELECT_SOURCE)
        self.assertIn("_extended_effects_enabled", SELECT_SOURCE)
        self.assertIn("requires the Experimental Features switch", SELECT_SOURCE)
        # A dedicated switch toggles the feature and refreshes the dropdown.
        self.assertIn("class YeelightCubeExtendedEffectsSwitch", SWITCH_SOURCE)
        self.assertIn(
            "YeelightCubeExtendedEffectsSwitch(config_entry, light_data)",
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
        # modes explicitly excluded because they read poorly as a clock.
        style_mixers = {style["mixer"] for style in clock_styles.values()}
        non_clock_modes = {60}
        for spec in all_effects.values():
            if spec["mode"] in non_clock_modes:
                self.assertNotIn(spec["mode"], style_mixers)
            else:
                self.assertIn(spec["mode"], style_mixers)
        # The clock renderer is never offered as its own background.
        self.assertNotIn(clock_mode, style_mixers)

        # Styles beyond the 10 firmware built-ins are experimental, each maps to
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
        # Native effects sort by firmware mode and clock styles by mixer, but
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


if __name__ == "__main__":
    unittest.main()
