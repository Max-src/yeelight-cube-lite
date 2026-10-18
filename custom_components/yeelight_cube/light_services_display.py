"""Display actions: text, colors, gradient mode and angle, brightness,
orientation, font, image, preview adjustments, freeze and save/restore of
the display state.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio
import base64
import logging
import time

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .color_utils import hex_to_rgb
from .const import (
    DEVICE_ORIENTATIONS,
    FIRMWARE_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    DOMAIN,
    MATRIX_DISPLAY_MODES,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_EFFECT_ID,
    PANEL_FULL_CHAR,
    TEXT_RENDER_MODES,
)
from .errors import failed, invalid, invalid_input
from .image_utils import MAX_IMAGE_B64_LENGTH, image_to_matrix
from .input_error import InputError
from .layout import FONT_MAPS, TOTAL_COLUMNS, TOTAL_ROWS
from .light import _entity_id_or_list
from .light_services_common import (
    COLOR_LIST_SCHEMA,
    _resolve_entity,
    _resolve_entities,
    make_lamp_runner,
)

_LOGGER = logging.getLogger(__name__)


def async_register_display_services(hass: HomeAssistant) -> None:
    """Register the display actions."""
    run_on_lamps = make_lamp_runner(hass)

    def generate_preview_for_mode(light_entity, mode: str):
        """The lamp's 100 colors in ``mode`` from its current text, colors,
        angle and background: the lamp's own text-mode frame
        (_text_mode_frame), without the orientation flip (the cards apply
        it)."""
        # The full panel: one virtual character covering every pixel, as on
        # the lamp.
        if light_entity._full_panel:
            text, width, offset = PANEL_FULL_CHAR, TOTAL_COLUMNS, 0
        else:
            text = light_entity._custom_text or ""
            width = sum(light_entity._char_advance(letter) for letter in text) - 1
            offset = light_entity.calculate_text_offset(width, TOTAL_COLUMNS) if text else 0
        if mode == "Panel Color Sequence":
            # The whole panel, whatever the text (as on the lamp).
            frame = light_entity._panel_sequence_frame(light_entity._text_colors)
        elif text:
            frame = light_entity._text_mode_frame(
                mode, text, light_entity._text_colors, light_entity._angle, offset, width
            )
        else:
            frame = [None] * (TOTAL_COLUMNS * TOTAL_ROWS)
        background = light_entity._background_color
        return [background if color is None else color for color in frame]

    async def handle_preview_gradient_modes(service_call):
        """Generate full 5x20 preview matrices for all gradient modes using entity's current state."""

        target_entity = _resolve_entity(service_call, "PREVIEW_GRADIENT_MODES")
        
        # Generate previews for all modes using entity's actual state
        modes = [
            "Solid Color",
            "Letter Gradient",
            "Column Gradient",
            "Row Gradient",
            "Angle Gradient",
            "Radial Gradient",
            "Letter Angle Gradient",
            "Letter Vertical Gradient",
            "Text Color Sequence",
            "Panel Color Sequence",
        ]
        
        previews = {}
        for mode in modes:
            preview_colors = generate_preview_for_mode(target_entity, mode)
            # Convert to list of lists for JSON serialization
            previews[mode] = [list(color) for color in preview_colors]
        
        # Fire event with preview data
        hass.bus.async_fire(
            f"{DOMAIN}_gradient_preview_response",
            {
                "entity_id": target_entity.entity_id,
                "previews": previews,
                "rows": 5,
                "cols": 20,
                "text": target_entity._custom_text,
                "angle": target_entity._angle,
                "brightness": target_entity._brightness,
                "full_panel": target_entity._full_panel,
            }
        )
        
        return previews

    hass.services.async_register(
        DOMAIN,
        "preview_gradient_modes",
        handle_preview_gradient_modes,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_set_brightness(service_call):
        """Set brightness using Home Assistant's light.turn_on service (1-100%)."""
        brightness_pct = service_call.data.get("brightness", 100)
        bypass_lock = bool(service_call.data.get("bypass_lock", False))
        
        # Clamp to 1-100 range
        brightness_pct = max(1, min(100, brightness_pct))
        
        target_entity = _resolve_entity(service_call, "SET_BRIGHTNESS")
        
        # Map 1-100 slider to Home Assistant brightness (1-255)
        # Formula: map 1-100 to 3-255 (same as lamp preview card)
        ha_brightness = round(3 + ((brightness_pct - 1) * 252) / 99)
        ha_brightness = max(3, min(255, ha_brightness))
        
        _LOGGER.debug("[SET_BRIGHTNESS] Setting brightness to %s%% (HA value: %s) for %s", brightness_pct, ha_brightness, target_entity.entity_id)
        
        try:
            if bypass_lock:
                # Wizard path: call the entity method directly so it bypasses the
                # calibration lock (light.turn_on is blocked while locked).
                await target_entity.set_brightness(ha_brightness, bypass_lock=True)
            else:
                # Use standard Home Assistant light.turn_on service
                await hass.services.async_call(
                    "light",
                    "turn_on",
                    {
                        "entity_id": target_entity.entity_id,
                        "brightness": ha_brightness,
                    },
                    blocking=True
                )
            _LOGGER.debug("[SET_BRIGHTNESS] Successfully set brightness to %s%%", brightness_pct)
        except HomeAssistantError:
            raise
        except Exception as err:  # noqa: BLE001 -- the lamp's own errors, told to the caller
            raise failed("command_failed", error=err) from err

    hass.services.async_register(
        DOMAIN,
        "set_brightness",
        handle_set_brightness,
        schema=vol.Schema({
            vol.Required("brightness", description="Brightness percentage (1-100)"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )

    # The rest of the service handlers (palette, etc.) should also be registered after light_entity is created
    async def handle_set_orientation(service_call):
        orientation = service_call.data.get("orientation")
        
        target_entity = _resolve_entity(service_call, "SET_ORIENTATION")

        await target_entity.set_orientation(orientation)

    hass.services.async_register(
        DOMAIN,
        "set_orientation",
        handle_set_orientation,
        schema=vol.Schema({
            vol.Required("orientation"): vol.In(["normal", "flipped"]),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_device_orientation(service_call):
        orientation = service_call.data.get("orientation")

        targets = _resolve_entities(service_call, "SET_DEVICE_ORIENTATION")
        for target in targets:
            if not target._is_on and not target._should_auto_turn_on():
                raise invalid("lamp_off")
        await asyncio.gather(*(target.set_device_orientation(orientation) for target in targets))

    hass.services.async_register(
        DOMAIN,
        "set_device_orientation",
        handle_set_device_orientation,
        schema=vol.Schema({
            vol.Required("orientation"): vol.In(list(DEVICE_ORIENTATIONS)),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_font(service_call):
        font = service_call.data.get("font")
        target_entity = _resolve_entity(service_call, "SET_FONT")

        await target_entity.set_font(font)
        if target_entity._font_select_entity:
            target_entity._font_select_entity.async_update_from_light()

    hass.services.async_register(
        DOMAIN,
        "set_font",
        handle_set_font,
        schema=vol.Schema({
            vol.Required("font"): vol.In(list(FONT_MAPS.keys())),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_alignment(service_call):
        alignment = service_call.data.get("alignment")
        target_entity = _resolve_entity(service_call, "SET_ALIGNMENT")

        await target_entity.set_alignment(alignment)
        # Notify alignment select entity of the change
        if target_entity._alignment_select_entity:
            target_entity._alignment_select_entity.async_update_from_light()

    hass.services.async_register(
        DOMAIN,
        "set_alignment",
        handle_set_alignment,
        schema=vol.Schema({
            vol.Required("alignment"): vol.In(["left", "center", "right"]),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_custom_text(service_call):
        # Supports multi-entity parallel dispatch
        text = service_call.data.get("text")
        # Prevent empty text -- the Yeelight firmware misbehaves when given
        # an empty string.  Use a single space instead (renders as blank).
        if text == "":
            text = " "

        targets = _resolve_entities(service_call, "SET_CUSTOM_TEXT")

        async def _apply_one(target_entity):
            _LOGGER.debug("[SET_TEXT] Setting custom text to: '%s' for entity %s", text, target_entity.entity_id)
            target_entity._custom_text = text
            target_entity._custom_pixels = None
            target_entity._custom_draw_active = False
            target_entity._active_pixel_art_name = None
            if target_entity._text_waits_for_matrix():
                # The lamp shows its firmware clock / native effect: the text
                # is kept for when it shows text again (call save_state first
                # to show it over the clock, restore_state to come back).
                if target_entity._text_input_entity and getattr(target_entity._text_input_entity, 'hass', None) is not None:
                    target_entity._text_input_entity.async_update_from_light()
                if target_entity.hass is not None:
                    target_entity.async_schedule_update_ha_state()
                _LOGGER.debug(
                    "[SET_TEXT] %s shows %s: text kept for later",
                    target_entity.entity_id, target_entity._mode,
                )
                return
            # Leaving pixel-art (Custom Draw) for text: restore a valid text
            # render mode so the mode-select entity and renderer stay consistent
            # -- otherwise _mode lingers as "Custom Draw" and the text render
            # would blank the panel (see TEXT_RENDER_MODES safety net).
            if target_entity._mode not in TEXT_RENDER_MODES:
                target_entity._mode = "Solid Color"
                target_entity._matrix_mode = "Solid Color"
                if target_entity._mode_select_entity:
                    target_entity._mode_select_entity.async_update_from_light()
            if target_entity._text_input_entity and hasattr(target_entity._text_input_entity, 'hass') and target_entity._text_input_entity.hass is not None:
                target_entity._text_input_entity.async_update_from_light()
            if target_entity._pixel_art_select_entity:
                target_entity._pixel_art_select_entity.async_update_from_light()
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            target_entity._scroll_offset = 0
            target_entity._scroll_direction = 1
            target_entity.stop_scroll_timer()
            await target_entity.async_apply_display_mode(update_type='text_change')
            _LOGGER.debug("[SET_TEXT] Display mode applied successfully for entity %s", target_entity.entity_id)

        run_on_lamps("SET_CUSTOM_TEXT", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_custom_text",
        handle_set_custom_text,
        schema=vol.Schema({
            vol.Required("text", description="Text to display on the cube matrix"): cv.string,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_angle(service_call):
        # Supports multi-entity parallel dispatch
        angle = service_call.data.get("angle")

        targets = _resolve_entities(service_call, "SET_ANGLE")

        async def _apply_one(target_entity):
            target_entity._angle = angle
            # Push angle to HA state immediately so the frontend card's set hass()
            # detects the change and can reload previews without waiting for the
            # next polling cycle (~30s).  Must happen BEFORE the slow hardware
            # command so the JS card sees the new angle right away.
            target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='color_change')
            if target_entity._angle_number_entity:
                target_entity._angle_number_entity.async_update_from_light()

        run_on_lamps("SET_ANGLE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_angle",
        handle_set_angle,
        schema=vol.Schema({
            vol.Required("angle", description="Gradient angle in degrees (0-360). Used for angle-based gradient modes."): vol.Coerce(float),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_text_colors(service_call):
        # Supports multi-entity parallel dispatch
        text_colors = service_call.data.get("text_colors")
        save_as_palette = service_call.data.get("save_as_palette", False)

        converted_colors = [tuple(c) for c in text_colors]

        targets = _resolve_entities(service_call, "SET_TEXT_COLORS")

        if save_as_palette:
            # The documented option: also keep these colors as a saved
            # palette, through save_palette (its limit and naming apply).
            await hass.services.async_call(
                DOMAIN,
                "save_palette",
                {
                    "palette": [list(color) for color in converted_colors],
                    "entity_id": targets[0].entity_id,
                },
                blocking=True,
            )

        async def _apply_one(target_entity):
            target_entity._text_colors = converted_colors
            if target_entity._text_colors:
                target_entity._rgb_color = target_entity._text_colors[0]
            await target_entity.async_apply_display_mode(update_type='color_change')
            target_entity.async_schedule_update_ha_state()

        # The colors are kept with the lamp's state (restored by Home
        # Assistant), not in the integration's storage.
        run_on_lamps("SET_TEXT_COLORS", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_text_colors",
        handle_set_text_colors,
        schema=vol.Schema({
            vol.Required("text_colors", description="Array of RGB color arrays, e.g. [[255,0,0], [0,255,0]] for red to green gradient"): COLOR_LIST_SCHEMA,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
            vol.Optional("save_as_palette", default=False, description="Save these colors as a palette for later use"): bool,
        })
    )

    # Note: rename_pixel_art and apply_pixel_art services are already registered above in the main service registration block
    # Note: set_brightness service is registered above in the main service registration block
    
    async def handle_display_image(service_call):
        """Accepts a base64-encoded image, resizes/crops to 20x5, and displays it on the lamp(s).
        Supports multi-entity parallel dispatch."""
        image_b64 = service_call.data.get("image_b64")
        # Resolved before decoding: no work for a call that targets no lamp.
        targets = _resolve_entities(service_call, "DISPLAY_IMAGE")

        # Process image once (shared across all targets). PIL decode/resize is
        # CPU-bound, so run it off the event loop.
        try:
            matrix = await hass.async_add_executor_job(
                image_to_matrix, image_b64, 20, 5
            )
            flipped_matrix = []
            for row in range(5):
                start = row * 20
                end = start + 20
                flipped_matrix[0:0] = matrix[start:end]
            custom_pixels = [
                {"position": pos, "color": color}
                for pos, color in enumerate(flipped_matrix)
            ]
        except InputError as err:
            # Too large, not base64 or not an image: tell the caller.
            raise invalid_input(err) from err
        except Exception as err:  # noqa: BLE001 -- unexpected decoder failure
            _LOGGER.exception("Error processing image")
            raise failed("image_failed", error=err) from err

        async def _apply_one(target_entity):
            target_entity._custom_pixels = custom_pixels
            target_entity._mode = "Custom Draw"
            target_entity._matrix_mode = "Custom Draw"
            target_entity._custom_draw_active = True
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            if target_entity._mode_select_entity:
                target_entity._mode_select_entity.async_update_from_light()
            if target_entity._content_mode_select_entity:
                target_entity._content_mode_select_entity.async_update_from_light()

        run_on_lamps("DISPLAY_IMAGE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "display_image",
        handle_display_image,
        schema=vol.Schema({
            vol.Required("image_b64"): vol.All(
                cv.string, vol.Length(min=1, max=MAX_IMAGE_B64_LENGTH)
            ),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_mode(service_call):
        # Supports multi-entity parallel dispatch
        mode = service_call.data.get("mode")
        full_panel = service_call.data.get("full_panel")
        

        targets = _resolve_entities(service_call, "SET_MODE")

        async def _apply_one(target_entity):
            if full_panel is not None:
                target_entity._full_panel = full_panel
                _LOGGER.debug("[set_mode] Also setting full_panel to %s", full_panel)
            if mode in MATRIX_DISPLAY_MODES:
                target_entity._matrix_mode = mode
                target_entity._mode = mode
            if mode == "Custom Draw":
                target_entity._custom_draw_active = True
            elif mode in FIRMWARE_MODES:
                target_entity._mode = mode
                target_entity._custom_draw_active = False
            else:
                target_entity._custom_draw_active = False
                target_entity._custom_pixels = None
            await target_entity.async_apply_display_mode(update_type='color_change')
            if target_entity._mode_select_entity:
                target_entity._mode_select_entity.async_update_from_light()
            if target_entity._content_mode_select_entity:
                target_entity._content_mode_select_entity.async_update_from_light()
            # Keep native-effect helper entities in sync.
            if mode == MODE_NATIVE_EFFECT:
                if target_entity._native_effect_select_entity:
                    target_entity._native_effect_select_entity.async_write_ha_state()
                if target_entity._native_effect_direction_select_entity:
                    target_entity._native_effect_direction_select_entity.async_update_from_light()
                if target_entity._native_effect_speed_entity:
                    target_entity._native_effect_speed_entity.async_write_ha_state()

        run_on_lamps("SET_MODE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_mode",
        handle_set_mode,
        schema=vol.Schema({
            vol.Required("mode", description="Display mode for text/gradients"): vol.In([
                MODE_CLOCK,
                MODE_NATIVE_EFFECT,
                "Solid Color",
                "Letter Gradient", 
                "Column Gradient",
                "Row Gradient",
                "Angle Gradient",
                "Radial Gradient",
                "Letter Vertical Gradient",
                "Letter Angle Gradient",
                "Text Color Sequence",
                "Panel Color Sequence",
                "Custom Draw",
            ]),
            vol.Optional("full_panel", description="Whether to apply gradients to entire panel (true) or just text areas (false). If provided, sets full_panel and mode in one call."): cv.boolean,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_solid_color(service_call):
        # Supports multi-entity parallel dispatch
        rgb_color = service_call.data.get("rgb_color")
        if isinstance(rgb_color, str):
            rgb_color = hex_to_rgb(rgb_color)
        rgb_color = tuple(rgb_color)

        targets = _resolve_entities(service_call, "SET_SOLID_COLOR")

        async def _apply_one(target_entity):
            # Rendering reads colors from _text_colors, not _rgb_color — set
            # both so the new color is actually visible on the lamp.
            target_entity._text_colors = [rgb_color]
            target_entity._rgb_color = rgb_color
            await target_entity.async_apply_display_mode(update_type='color_change')
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()

        run_on_lamps("SET_SOLID_COLOR", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_solid_color",
        handle_set_solid_color,
        schema=vol.Schema({
            vol.Required("rgb_color"): vol.Any(
                vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple)),
                cv.string
            ),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_full_panel(service_call):
        # Supports multi-entity parallel dispatch
        full_panel = service_call.data.get("full_panel", False)

        targets = _resolve_entities(service_call, "SET_FULL_PANEL")

        async def _apply_one(target_entity):
            _LOGGER.debug(
                "[PANEL] [%s] "
                "Setting full_panel=%s (was %s)",
                getattr(target_entity, '_ip', '?'), full_panel,
                target_entity._full_panel
            )
            target_entity._full_panel = full_panel
            # When enabling panel mode, deactivate custom draw so the display
            # switches back to the text/gradient rendering path.  The pixel art
            # branch in _apply_display_mode_internal would otherwise take
            # priority and ignore full_panel entirely.
            if full_panel:
                target_entity._custom_draw_active = False
                target_entity._custom_pixels = None
            target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='color_change')

        run_on_lamps("SET_FULL_PANEL", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_full_panel",
        handle_set_full_panel,
        schema=vol.Schema({
            vol.Required("full_panel", description="Whether to apply gradients to entire panel (true) or just text areas (false)"): cv.boolean,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_preview_adjustments(service_call):
        """Set color adjustment values for the lamp (all effects). Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SET_PREVIEW_ADJUSTMENTS")

        # Extract raw data once (defaults are per-entity, applied inside _apply_one)
        data = service_call.data

        async def _apply_one(target_entity):
            hue_shift = data.get("hue_shift", target_entity._preview_hue_shift)
            temperature = data.get("temperature", target_entity._preview_temperature)
            saturation = data.get("saturation", target_entity._preview_saturation)
            vibrance = data.get("vibrance", target_entity._preview_vibrance)
            contrast = data.get("contrast", target_entity._preview_contrast)
            glow = data.get("glow", target_entity._preview_glow)
            grayscale = data.get("grayscale", target_entity._preview_grayscale)
            invert = data.get("invert", target_entity._preview_invert)
            tint_hue = data.get("tint_hue", target_entity._preview_tint_hue)
            tint_strength = data.get("tint_strength", target_entity._preview_tint_strength)
            # Validate ranges
            hue_shift = max(-180, min(180, int(hue_shift)))
            temperature = max(-100, min(100, int(temperature)))
            saturation = max(0, min(200, int(saturation)))
            vibrance = max(0, min(200, int(vibrance)))
            contrast = max(0, min(200, int(contrast)))
            glow = max(0, min(100, int(glow)))
            grayscale = max(0, min(100, int(grayscale)))
            invert = max(0, min(100, int(invert)))
            tint_hue = max(0, min(360, int(tint_hue)))
            tint_strength = max(0, min(100, int(tint_strength)))
            # Update entity values
            target_entity._preview_hue_shift = hue_shift
            target_entity._preview_temperature = temperature
            target_entity._preview_saturation = saturation
            target_entity._preview_vibrance = vibrance
            target_entity._preview_contrast = contrast
            target_entity._preview_glow = glow
            target_entity._preview_grayscale = grayscale
            target_entity._preview_invert = invert
            target_entity._preview_tint_hue = tint_hue
            target_entity._preview_tint_strength = tint_strength
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            for entity in target_entity._preview_number_entities.values():
                entity.async_update_from_light()
            target_entity._create_tracked_task(
                target_entity.async_apply_display_mode(),
                name=f"yeelight_cube_apply_preview_adjustments_{target_entity._ip}"
            )

        run_on_lamps("SET_PREVIEW_ADJUSTMENTS", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_preview_adjustments",
        handle_set_preview_adjustments,
        schema=vol.Schema({
            vol.Optional("saturation", default=100): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("hue_shift", default=0): vol.All(vol.Coerce(int), vol.Range(min=-180, max=180)),
            vol.Optional("contrast", default=100): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("temperature", default=0): vol.All(vol.Coerce(int), vol.Range(min=-100, max=100)),
            vol.Optional("vibrance", default=100): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("grayscale", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("invert", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("glow", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("tint_hue", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=360)),
            vol.Optional("tint_strength", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_force_refresh(service_call):
        """Force refresh using raw TCP connections (bypasses persistent socket).
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "FORCE_REFRESH")

        run_on_lamps("FORCE_REFRESH", targets, lambda lamp: lamp.async_force_refresh())

    hass.services.async_register(
        DOMAIN,
        "force_refresh",
        handle_force_refresh,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_freeze_display(service_call):
        """Freeze the panel on its current frame so it holds what is shown.

        Native effects freeze via the renderer's freeze-frame command
        ([64, 0, 4, {mode: 64}]). The firmware clock instead re-sends its
        current command with the freeze mixer (64) -- sending mode 64 to the
        clock shows a full-panel effect, not the frozen clock face. Resume is
        client-driven: the cards re-apply the current effect / clock mode (i.e.
        resend the last command). Supports multi-entity parallel dispatch.
        """
        targets = _resolve_entities(service_call, "FREEZE_DISPLAY")

        def _freeze_params(target):
            if getattr(target, "_mode", None) == MODE_CLOCK:
                data = base64.b64encode(
                    target._native_clock_data_bytes()
                ).decode("ascii")
                return [
                    NATIVE_CLOCK_EFFECT_ID,
                    target._native_clock_style,
                    NATIVE_CLOCK_APPLY,
                    {"mode": NATIVE_CLOCK_EFFECT_ID, "mixer": 64, "data": data},
                ]
            return [64, 0, 4, {"mode": 64}]

        async def _freeze_one(target):
            params = _freeze_params(target)
            is_clock = getattr(target, "_mode", None) == MODE_CLOCK
            # Capture the background phase at freeze time so the preview holds
            # that exact frame; sampling later would freeze on a stale frame.
            target._display_frozen_at = time.time()

            async def _do_send():
                target._cube_matrix.close_fast_socket()
                # The clock activation is socket-timing sensitive; give the
                # fresh socket the same brief settle it uses in _activate_native_clock.
                if is_clock:
                    await asyncio.sleep(0.1)
                await target._cube_matrix.send_raw_command(
                    "set_fx_effect", params
                )

            await target._execute_hardware_op(_do_send, "freeze_display")
            # Track the freeze so the fake camera holds the background frame
            # (clock digits keep rendering live). Cleared by the next re-apply.
            target._display_frozen = True
            target.async_write_ha_state()
            notify = getattr(target, "_notify_camera_preview", None)
            if notify:
                notify()

        run_on_lamps("FREEZE_DISPLAY", targets, _freeze_one)

    hass.services.async_register(
        DOMAIN,
        "freeze_display",
        handle_freeze_display,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_save_state(service_call):
        """Snapshot the current display state (text/colors/mode/gradient/drawing/
        effects/brightness) so it can be restored later with restore_state.
        Only ONE snapshot is kept per entity -- calling again overwrites it.
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SAVE_STATE")

        async def _apply_one(target_entity):
            target_entity._save_display_state()
            _LOGGER.debug("[SAVE_STATE] Saved display state for %s", target_entity.entity_id)

        run_on_lamps("SAVE_STATE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "save_state",
        handle_save_state,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_restore_state(service_call):
        """Restore the display state previously captured by save_state and
        re-render it on the lamp.  Does nothing (logs a warning) if no state
        was saved.  Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "RESTORE_STATE")

        async def _apply_one(target_entity):
            if not target_entity._restore_display_state():
                _LOGGER.warning(
                    "[RESTORE_STATE] No saved state for %s -- "
                    "call save_state first",
                    target_entity.entity_id
                )
                return
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='color_change')
            # The rotation that ran when the state was saved runs again.
            await target_entity._async_resume_display_rotation()
            _LOGGER.debug("[RESTORE_STATE] Restored display state for %s", target_entity.entity_id)

        run_on_lamps("RESTORE_STATE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "restore_state",
        handle_restore_state,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )
