"""The lamp's dropdowns (select.py) and sliders (number.py), run without
Home Assistant: their ids and names, and how a setting reads and sets the
lamp."""

import ast
import asyncio
import runpy
import sys
import types
import unittest
from unittest.mock import AsyncMock, Mock

from tests.test_native_features import CONSTANTS, ROOT, SELECT_SOURCE
from tests.test_text_modes import LAYOUT


class _Base:
    """SelectEntity / NumberEntity stand-ins."""

    hass = None

    @property
    def options(self):
        return self._attr_options

    async def async_added_to_hass(self):
        pass


def _load_platform(name, source, extra):
    tree = ast.parse(source)
    # Home Assistant and the package's own modules are provided below.
    tree.body = [
        node for node in tree.body
        if not (
            isinstance(node, (ast.Import, ast.ImportFrom))
            and (getattr(node, "level", 0) or (getattr(node, "module", "") or "").startswith("homeassistant"))
        )
    ]
    module = types.ModuleType(f"yeelight_cube_{name}_under_test")
    sys.modules[module.__name__] = module  # dataclasses look their module up
    namespace = module.__dict__
    namespace.update({
        **{name: value for name, value in CONSTANTS.items() if not name.startswith("__")},
        "CubeControlEntity": type("CubeControlEntity", (), {}),
        "ConfigEntry": object,
        "HomeAssistant": object,
        "AddEntitiesCallback": object,
        "HomeAssistantError": RuntimeError,
        "EntityCategory": type("EntityCategory", (), {"CONFIG": "config"}),
        "callback": lambda function: function,
        **extra,
    })
    exec(compile(tree, f"{name}.py", "exec"), namespace)
    return namespace


SELECT = _load_platform("select", SELECT_SOURCE, {
    "SelectEntity": _Base,
    "FONT_MAPS": LAYOUT["FONT_MAPS"],
    "get_builtin_pixel_art_map": lambda: {},
})
LAMP_POWER = runpy.run_path(str(ROOT / "lamp_power.py"))
NUMBER = _load_platform("number", (ROOT / "number.py").read_text(encoding="utf-8"), {
    "NumberEntity": _Base,
    "NumberMode": types.SimpleNamespace(SLIDER="slider"),
    "BASE_W": LAMP_POWER["BASE_W"],
    "NO_LIMIT_W": LAMP_POWER["NO_LIMIT_W"],
})


def make_light(**state):
    light = types.SimpleNamespace(
        _attr_unique_id="cube1", _attr_name="Cube", hass=None,
        _native_effect="Rainbow", _native_effect_direction="Right",
        _extended_effects_enabled=False, _native_clock_style=6, _mode="Solid Color",
        **state,
    )
    return light


class ControlEntityTests(unittest.TestCase):
    def test_every_dropdown_keeps_its_id_and_name(self):
        light = make_light()
        hass = types.SimpleNamespace(data={})
        entities = [
            SELECT["YeelightCubePaletteSelect"](light, "1.2.3.4", None, hass),
            SELECT["YeelightCubePixelArtSelect"](light, "1.2.3.4", None, hass),
            SELECT["YeelightCubeContentModeSelect"](light, None),
            SELECT["YeelightCubeDisplayModeSelect"](light, None),
            SELECT["YeelightCubeClockStyleSelect"](light, None),
            SELECT["YeelightCubeNativeEffectSelect"](light, None),
            SELECT["YeelightCubeNativeEffectDirectionSelect"](light, None),
            *(SELECT["CubeSettingSelect"](light, None, spec) for spec in SELECT["SETTING_SELECTS"]),
        ]
        named = {
            entity._attr_unique_id: getattr(entity, "_attr_name", None)
            or entity._attr_translation_key
            for entity in entities
        }
        self.assertEqual(named, {
            "cube1_palette_select": "Cube Matrix: Palette",
            "cube1_pixel_art_select": "Cube Matrix: Pixel Art",
            "cube1_content_mode_select": "content_mode",
            "cube1_display_mode_select": "Cube Matrix: Display Mode",
            "cube1_clock_style_select": "clock_style",
            "cube1_native_effect": "native_effect",
            "cube1_native_effect_direction": "native_effect_direction",
            "cube1_clock_content_select": "clock_content",
            "cube1_music_flow_effect": "music_flow_effect",
            "cube1_power_on_state": "power_on_state",
            "cube1_alignment_select": "Cube Matrix: Text Alignment",
            "cube1_font_select": "Cube Matrix: Font",
            "cube1_transition_select": "Cube Matrix: Transition Effect",
            "cube1_device_orientation_select": "Cube Device Orientation",
        })
        # Translated names only where a translation key is set.
        for entity in entities:
            self.assertEqual(
                getattr(entity, "_attr_has_entity_name", False),
                hasattr(entity, "_attr_translation_key"),
                entity._attr_unique_id,
            )

    def test_a_setting_dropdown_reads_and_sets_the_lamp(self):
        spec = {s.unique_suffix: s for s in SELECT["SETTING_SELECTS"]}
        light = make_light(_font="fat", set_font=AsyncMock(), _transition_type="none")
        font = SELECT["CubeSettingSelect"](light, None, spec["font_select"])
        self.assertEqual(font.options, ["Basic", "Fat", "Italic", "Native"])
        self.assertEqual(font.current_option, "Fat")
        asyncio.run(font.async_select_option("Italic"))
        light.set_font.assert_awaited_once_with("italic")
        # No setter: the value is stored on the lamp.
        transition = SELECT["CubeSettingSelect"](light, None, spec["transition_select"])
        asyncio.run(transition.async_select_option("Wipe Left"))
        self.assertEqual(light._transition_type, "wipe_left")
        # An unknown value shows the default; an unknown option is refused.
        light._font = "gone"
        self.assertEqual(font.current_option, "Basic")
        with self.assertRaises(ValueError):
            asyncio.run(font.async_select_option("Comic"))

    def test_a_dropdown_never_drops_a_change_because_the_lamp_is_off(self):
        # The display queue's off-lamp rule decides what to show; only Music
        # Flow (sent to the firmware directly) checks here, and refuses.
        number_source = (ROOT / "number.py").read_text(encoding="utf-8")
        self.assertNotIn("_should_auto_turn_on", number_source)
        self.assertEqual(SELECT_SOURCE.count("_should_auto_turn_on"), 1)
        light = make_light(_is_on=False, _should_auto_turn_on=lambda: False, _music_flow_enabled=False)
        light.async_set_music_flow = AsyncMock()
        content = SELECT["YeelightCubeContentModeSelect"](light, None)
        with self.assertRaises(RuntimeError):
            asyncio.run(content.async_select_option("Music Flow"))
        light.async_set_music_flow.assert_not_awaited()


    def test_every_slider_keeps_its_id_and_name(self):
        light = make_light()
        entities = [
            NUMBER["YeelightCubeGradientAngleNumber"](light, None),
            NUMBER["YeelightCubeNativeEffectSpeedNumber"](light, None),
            *(
                NUMBER["CubeSettingNumber"](light, None, spec)
                for spec in (*NUMBER["SETTING_NUMBERS"], *NUMBER["PREVIEW_ADJUSTMENTS"])
            ),
        ]
        named = {
            entity._attr_unique_id: getattr(entity, "_attr_name", None)
            or entity._attr_translation_key
            for entity in entities
        }
        self.assertEqual(named, {
            "cube1_gradient_angle": "Cube Matrix: Gradient Angle",
            "cube1_native_effect_speed": "native_effect_speed",
            "cube1_transition_steps": "Cube Transition Steps",
            "cube1_transition_duration": "Cube Transition Duration",
            "cube1_scroll_speed": "scroll_speed",
            "cube1_power_limit": "power_limit",
            "cube1_hue_shift": "Cube Color: Hue Shift",
            "cube1_temperature": "Cube Color: Temperature",
            "cube1_saturation": "Cube Intensity: Saturation",
            "cube1_vibrance": "Cube Intensity: Vibrance",
            "cube1_contrast": "Cube Tone: Contrast",
            "cube1_glow": "Cube Tone: Glow",
            "cube1_grayscale": "Cube Effects: Grayscale",
            "cube1_invert": "Cube Effects: Invert",
            "cube1_tint_hue": "Cube Effects: Tint Hue",
            "cube1_tint_strength": "Cube Effects: Tint Strength",
        })
        for entity in entities:
            self.assertEqual(
                getattr(entity, "_attr_has_entity_name", False),
                hasattr(entity, "_attr_translation_key"),
                entity._attr_unique_id,
            )

    def test_a_setting_slider_keeps_its_range_and_reacts(self):
        spec = {s.unique_suffix: s for s in (*NUMBER["SETTING_NUMBERS"], *NUMBER["PREVIEW_ADJUSTMENTS"])}
        light = make_light(
            _transition_steps=5, _scroll_speed=0.2, _is_scrolling=True,
            start_scroll_timer=Mock(), _preview_contrast=100,
            async_apply_display_mode=AsyncMock(),
        )
        light.hass = types.SimpleNamespace(async_create_task=lambda coroutine: asyncio.ensure_future(coroutine))
        light.async_write_ha_state = Mock()
        steps = NUMBER["CubeSettingNumber"](light, None, spec["transition_steps"])
        asyncio.run(steps.async_set_native_value(42.9))
        self.assertEqual(light._transition_steps, 10)  # whole, within 1..10
        scroll = NUMBER["CubeSettingNumber"](light, None, spec["scroll_speed"])
        asyncio.run(scroll.async_set_native_value(0.333))
        self.assertEqual(light._scroll_speed, 0.33)
        light.start_scroll_timer.assert_called_once()  # restarted while scrolling

        async def contrast_change():
            contrast = NUMBER["CubeSettingNumber"](light, None, spec["contrast"])
            await contrast.async_set_native_value(-5)
            await asyncio.sleep(0)  # the redraw runs in the background

        asyncio.run(contrast_change())
        self.assertEqual(light._preview_contrast, 0)
        light.async_apply_display_mode.assert_awaited_once_with()
        self.assertEqual(light.async_write_ha_state.call_count, 3)


if __name__ == "__main__":
    unittest.main()
