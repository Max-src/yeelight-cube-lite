"""Tests for Cube Lite native protocol definitions and bundled presets."""

import ast
from pathlib import Path
import runpy
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


def _function_source(source: str, name: str) -> str:
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            lines = source.splitlines()
            start = node.lineno - 1
            end = len(lines)
            for index in range(start + 1, len(lines)):
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
