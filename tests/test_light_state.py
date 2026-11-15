"""The light's display and hardware state (light_state), its listeners, and
the public API its controls and actions use (light_actions)."""

import ast
import asyncio
import unittest
from unittest.mock import AsyncMock

from fakes import ROOT, make_light

# The state light_state owns: written there only, read everywhere.
OWNED = {
    "_mode", "_matrix_mode", "_custom_draw_active", "_is_scrolling", "_display_frozen",
    "_fx_mode_is_direct", "_in_native_fw_mode", "_last_hardware_brightness",
}
PLATFORMS = (
    "select", "switch", "number", "text", "sensor", "binary_sensor", "event", "camera",
    "button", "diagnostics", "entity",
)


def _foreign_private(name: str) -> list:
    """The private attributes ``name``.py reaches on objects other than self."""
    tree = ast.parse((ROOT / f"{name}.py").read_text(encoding="utf-8"))
    return [
        (node.lineno, node.attr) for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr.startswith("_")
        and not node.attr.startswith("__")
        and not (isinstance(node.value, ast.Name) and (node.value.id == "self" or node.value.id[0].isupper()))
    ]


class OwnershipTests(unittest.TestCase):
    def test_only_light_state_writes_the_display_and_hardware_state(self):
        writers = {}
        for path in ROOT.glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store) and node.attr in OWNED:
                    writers.setdefault(path.name, set()).add(node.attr)
        self.assertEqual({"light_state.py": OWNED}, writers)

    def test_the_controls_and_actions_use_the_light_s_public_api(self):
        for name in PLATFORMS:
            self.assertEqual([], _foreign_private(name), name)
        for path in ROOT.glob("light_services*.py"):
            self.assertEqual([], _foreign_private(path.stem), path.name)

    def test_no_control_reads_the_light_s_private_state_by_name(self):
        # getattr(light, "_x") hides from the check above: the cameras read a
        # snapshot (light_actions.preview_state) instead.
        for name in PLATFORMS:
            tree = ast.parse((ROOT / f"{name}.py").read_text(encoding="utf-8"))
            reads = [
                (node.lineno, node.args[1].value) for node in ast.walk(tree)
                if isinstance(node, ast.Call) and getattr(node.func, "id", None) in ("getattr", "hasattr")
                and len(node.args) > 1 and isinstance(node.args[1], ast.Constant)
                and str(node.args[1].value).startswith("_")
                # its own (self, super()): not the light's
                and not (isinstance(node.args[0], ast.Name) and node.args[0].id == "self")
                and not (isinstance(node.args[0], ast.Call) and getattr(node.args[0].func, "id", None) == "super")
            ]
            self.assertEqual([], reads, name)

    def test_the_preview_state_is_the_light_s_state_at_once(self):
        light = make_light(_mode="Clock", _native_clock_style=3, _native_effect="Fire",
                           _native_effect_speed=200, _device_orientation="up", _brightness=40)
        state = light.preview_state()
        self.assertEqual(
            ("Clock", 3, "Fire", 200, "up", 40, light.device_profile.columns),
            (state.mode, state.clock_style, state.native_effect, state.native_effect_speed,
             state.orientation, state.brightness, state.columns),
        )
        # A snapshot: later changes to the light leave it as it was.
        light._native_effect_speed = 10
        self.assertEqual(200, state.native_effect_speed)
        with self.assertRaises(AttributeError):
            state.mode = "Matrix"

    def test_the_light_keeps_no_reference_to_its_controls(self):
        light = make_light()
        self.assertFalse([name for name in vars(light) if name.endswith(("_entity", "_sensor", "_switch"))])


class TransitionTests(unittest.TestCase):
    def test_a_transition_changes_only_what_it_is_given(self):
        light = make_light()
        light._enter_mode("Clock")
        self.assertEqual(("Clock", "Solid Color"), (light.mode, light.matrix_mode))
        light._enter_mode(matrix_mode="Row Gradient", custom_draw=1)
        self.assertEqual(("Clock", "Row Gradient", True), (light.mode, light.matrix_mode, light.custom_draw_active))

    def test_the_lamp_s_modes(self):
        light = make_light()
        light._entered_direct_mode()
        self.assertEqual((True, False), (light._fx_mode_is_direct, light._in_native_fw_mode))
        light._entered_builtin_mode()
        self.assertEqual((False, True), (light._fx_mode_is_direct, light._in_native_fw_mode))
        light._left_builtin_mode()
        light._note_hardware_brightness(40)
        self.assertEqual((False, 40), (light._in_native_fw_mode, light._last_hardware_brightness))
        light.note_raw_builtin_command()
        self.assertEqual((True, None, 0.0), (light._in_native_fw_mode, light._last_hardware_brightness, light._last_fx_mode_time))


class ContentModeTests(unittest.TestCase):
    def test_matrix_comes_back_to_the_last_render_mode_and_tells_the_controls(self):
        light = make_light(_mode="Row Gradient", async_apply_display_mode=AsyncMock())
        told = []
        for topic in ("content_mode", "display_mode", "pixel_art", "native_effect"):
            light.add_listener(topic, lambda topic=topic: told.append(topic))
        asyncio.run(light.async_select_content_mode("Clock"))
        self.assertEqual(("Clock", "Row Gradient", False), (light.mode, light.matrix_mode, light.custom_draw_active))
        self.assertEqual(["content_mode", "display_mode", "pixel_art"], told)
        # A drawing that is gone: back to the default render mode.
        light._enter_mode(matrix_mode="Custom Draw")
        asyncio.run(light.async_select_content_mode("Matrix"))
        self.assertEqual(("Solid Color", "Solid Color", False), (light.mode, light.matrix_mode, light.custom_draw_active))
        light.async_apply_display_mode.assert_awaited_with(update_type="color_change")

    def test_a_display_mode_leaves_the_drawing(self):
        light = make_light(
            _mode="Custom Draw", _custom_pixels=[{"position": 0, "color": [1, 2, 3]}],
            _active_pixel_art_name="Cat", async_apply_display_mode=AsyncMock(),
        )
        light._enter_mode(custom_draw=True)
        asyncio.run(light.async_select_display_mode("Letter Gradient"))
        self.assertEqual(("Letter Gradient", False, None, None), (
            light.mode, light.custom_draw_active, light._custom_pixels, light.active_pixel_art_name,
        ))


if __name__ == "__main__":
    unittest.main()
