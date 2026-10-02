"""Display actions: text, colors, gradient mode and angle, brightness,
orientation, font, image, preview adjustments, freeze and save/restore of
the display state.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio
import base64
import logging
import math
import random
import time

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from . import async_save_data
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
from .image_utils import MAX_IMAGE_B64_LENGTH, image_to_matrix
from .layout import FONT_MAPS, TOTAL_COLUMNS, TOTAL_ROWS
from .light import _entity_id_or_list
from .light_services_common import (
    COLOR_LIST_SCHEMA,
    _resolve_entity,
    _resolve_entities,
    make_fire_and_forget,
)

_LOGGER = logging.getLogger(__name__)


def async_register_display_services(hass: HomeAssistant) -> None:
    """Register the display actions."""
    _fire_and_forget = make_fire_and_forget(hass)

    def generate_preview_for_mode(light_entity, mode: str, apply_brightness: bool = True):
        """
        Generate a full 5x20 preview matrix for a given gradient mode.
        Uses the entity's ACTUAL current state (text, colors, angle, background)
        and renders EXACTLY as it would appear on the lamp.
        
        Args:
            light_entity: The YeelightCubeLight entity instance
            mode: Gradient mode name to preview
            apply_brightness: If True, apply _apply_final_brightness (darken).
                              If False, return raw full-brightness colors.
        
        Returns:
            List of 100 RGB tuples (5 rows x 20 cols = 100 pixels)
        """
        # Create a 100-element array initialized with background color
        preview_matrix = [light_entity._background_color] * 100
        
        # Get entity's current state
        # When full_panel is on, use the virtual full-panel character just like
        # the actual rendering code does -- so the preview fills all 100 LEDs.
        if light_entity._full_panel:
            text = PANEL_FULL_CHAR
        else:
            text = light_entity._custom_text or ""
        colors = light_entity._text_colors or [(255, 0, 0)]
        angle = light_entity._angle

        if not text:
            # No text - just show background
            if apply_brightness:
                return [light_entity._apply_final_brightness(color) for color in preview_matrix]
            return list(preview_matrix)
        
        # Calculate text layout (same as actual rendering)
        total_columns = TOTAL_COLUMNS
        if light_entity._full_panel:
            total_text_width = TOTAL_COLUMNS
            current_offset = 0
        else:
            total_text_width = sum(light_entity._char_advance(letter) for letter in text) - 1
            current_offset = light_entity.calculate_text_offset(total_text_width, total_columns)
        
        # Render based on mode (simplified version of _apply_display_mode_internal)
        if mode == "Solid Color":
            color = colors[0]
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            preview_matrix[adjusted_pos] = color
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Letter Gradient":
            for i, letter in enumerate(text):
                gradient_color = light_entity.calculate_multi_gradient_color(colors, i, len(text))
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            preview_matrix[adjusted_pos] = gradient_color
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Column Gradient":
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                letter_width = light_entity.letter_size(letter_positions)
                for col_index in range(letter_width):
                    overall_col = col_index + current_offset
                    col_color = light_entity.calculate_multi_gradient_color(colors, overall_col, total_text_width)
                    for pos in letter_positions:
                        adjusted_pos = pos + current_offset
                        if 0 <= adjusted_pos < 100:
                            orig_col = pos % TOTAL_COLUMNS
                            virtual_col = orig_col + current_offset
                            if 0 <= virtual_col < TOTAL_COLUMNS and (pos % TOTAL_COLUMNS) == col_index:
                                preview_matrix[adjusted_pos] = col_color
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Row Gradient":
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for row_index in range(TOTAL_ROWS):
                    row_color = light_entity.calculate_multi_gradient_color(colors, row_index, TOTAL_ROWS)
                    for pos in letter_positions:
                        if pos // TOTAL_COLUMNS == row_index:
                            adjusted_pos = pos + current_offset
                            if 0 <= adjusted_pos < 100:
                                orig_col = pos % TOTAL_COLUMNS
                                virtual_col = orig_col + current_offset
                                if 0 <= virtual_col < TOTAL_COLUMNS:
                                    preview_matrix[adjusted_pos] = row_color
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Angle Gradient":
            angle_radians = math.radians(angle)
            dx = math.cos(angle_radians)
            dy = math.sin(angle_radians)
            center_col = (total_columns - 1) / 2
            center_row = (TOTAL_ROWS - 1) / 2
            corners = [(-(center_col), -(center_row)), (center_col, -(center_row)), (-(center_col), center_row), (center_col, center_row)]
            projections = [col * dx + row * dy for col, row in corners]
            min_proj = min(projections)
            max_proj = max(projections)
            proj_range = max_proj - min_proj if max_proj != min_proj else 1
            
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            row, col = divmod(adjusted_pos, total_columns)
                            centered_col = col - center_col
                            centered_row = row - center_row
                            projection = centered_col * dx + centered_row * dy
                            normalized_projection = (projection - min_proj) / proj_range
                            gradient_color = light_entity.calculate_multi_gradient_color(colors, normalized_projection * (len(colors) - 1), len(colors))
                            preview_matrix[adjusted_pos] = tuple(min(255, max(0, v)) for v in gradient_color)
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Radial Gradient":
            center_col = (total_columns - 1) / 2
            center_row = (TOTAL_ROWS - 1) / 2
            max_dist = math.sqrt(center_col ** 2 + center_row ** 2)
            
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            row, col = divmod(adjusted_pos, total_columns)
                            dx_ = col - center_col
                            dy_ = row - center_row
                            dist = math.sqrt(dx_ ** 2 + dy_ ** 2)
                            norm = dist / max_dist if max_dist > 0 else 0
                            gradient_color = light_entity.calculate_multi_gradient_color(colors, norm * (len(colors) - 1), len(colors))
                            preview_matrix[adjusted_pos] = tuple(min(255, max(0, v)) for v in gradient_color)
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Letter Angle Gradient":
            angle_radians = math.radians(angle)
            dx = math.cos(angle_radians)
            dy = math.sin(angle_radians)
            
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                if not letter_positions:
                    current_offset += light_entity._char_advance(letter)
                    continue
                
                # Calculate letter bounding box
                rows = []
                cols = []
                for pos in letter_positions:
                    row, col = divmod(pos + current_offset, total_columns)
                    rows.append(row)
                    cols.append(col)
                
                if len(set(cols)) == 1:
                    col = cols[0]
                    min_row, max_row = 0, TOTAL_ROWS - 1
                    min_col = max(0, col - 1)
                    max_col = min(TOTAL_COLUMNS - 1, col + 1)
                    center_row = (min_row + max_row) / 2
                    center_col = (min_col + max_col) / 2
                else:
                    min_row, max_row = min(rows), max(rows)
                    min_col, max_col = min(cols), max(cols)
                    center_row = (min_row + max_row) / 2
                    center_col = (min_col + max_col) / 2
                
                corners = [(min_col, min_row), (max_col, min_row), (min_col, max_row), (max_col, max_row)]
                projections = [(col_ - center_col) * dx + (row_ - center_row) * dy for col_, row_ in corners]
                min_proj = min(projections)
                max_proj = max(projections)
                proj_range = max_proj - min_proj if max_proj != min_proj else 1
                
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            row, col = divmod(adjusted_pos, total_columns)
                            centered_col = col - center_col
                            centered_row = row - center_row
                            projection = centered_col * dx + centered_row * dy
                            normalized_projection = (projection - min_proj) / proj_range
                            gradient_color = light_entity.calculate_multi_gradient_color(colors, normalized_projection * (len(colors) - 1), len(colors))
                            preview_matrix[adjusted_pos] = tuple(min(255, max(0, v)) for v in gradient_color)
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Letter Vertical Gradient":
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                letter_width = light_entity.letter_size(letter_positions)
                if letter_width <= 0:
                    continue
                
                if letter_width == 1:
                    center_index = (len(colors) - 1) / 2
                    gradient_color = light_entity.calculate_multi_gradient_color(colors, center_index, len(colors))
                    for pos in letter_positions:
                        adjusted_pos = pos + current_offset
                        if 0 <= adjusted_pos < 100:
                            orig_col = pos % TOTAL_COLUMNS
                            virtual_col = orig_col + current_offset
                            if 0 <= virtual_col < TOTAL_COLUMNS:
                                preview_matrix[adjusted_pos] = tuple(min(255, max(0, val)) for val in gradient_color)
                else:
                    for col_index in range(letter_width):
                        gradient_color = light_entity.calculate_multi_gradient_color(colors, col_index, letter_width)
                        for pos in letter_positions:
                            if (pos % total_columns) == col_index:
                                adjusted_pos = pos + current_offset
                                if 0 <= adjusted_pos < 100:
                                    orig_col = pos % TOTAL_COLUMNS
                                    virtual_col = orig_col + current_offset
                                    if 0 <= virtual_col < TOTAL_COLUMNS:
                                        preview_matrix[adjusted_pos] = tuple(min(255, max(0, val)) for val in gradient_color)
                current_offset += light_entity._char_advance(letter)
        
        elif mode == "Text Color Sequence":
            # Random color sequence
            shuffled_colors = colors[:]
            random.shuffle(shuffled_colors)
            pixel_index = 0
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                positions = letter_positions[:]
                random.shuffle(positions)
                for pos in positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            color = shuffled_colors[pixel_index % len(shuffled_colors)]
                            preview_matrix[adjusted_pos] = color
                    pixel_index += 1
                current_offset += light_entity._char_advance(letter)
        
        # Apply final brightness/darkness adjustments (same as matrix_colors in extra_state_attributes)
        if apply_brightness:
            return [light_entity._apply_final_brightness(color) for color in preview_matrix]
        return list(preview_matrix)

    async def handle_preview_gradient_modes(service_call):
        """Generate full 5x20 preview matrices for all gradient modes using entity's current state."""
        apply_brightness = service_call.data.get("apply_brightness", False)
        
        target_entity = _resolve_entity(service_call, "PREVIEW_GRADIENT_MODES")
        if not target_entity:
            return {}
        
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
            "Text Color Sequence"
        ]
        
        previews = {}
        for mode in modes:
            preview_colors = generate_preview_for_mode(target_entity, mode, apply_brightness)
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
                "darken_percent": target_entity._preview_darken,
                "apply_brightness": apply_brightness,
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
            vol.Optional("apply_brightness"): bool
        })
    )

    async def handle_set_brightness(service_call):
        """Set brightness using Home Assistant's light.turn_on service (1-100%)."""
        brightness_pct = service_call.data.get("brightness", 100)
        bypass_lock = bool(service_call.data.get("bypass_lock", False))
        
        # Clamp to 1-100 range
        brightness_pct = max(1, min(100, brightness_pct))
        
        target_entity = _resolve_entity(service_call, "SET_BRIGHTNESS")
        if not target_entity:
            return
        
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
        except Exception as e:
            _LOGGER.error("[SET_BRIGHTNESS] Failed to set brightness: %s", e)

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
        entity_id = service_call.data.get("entity_id")
        
        target_entity = _resolve_entity(service_call, "SET_ORIENTATION")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug("[AUTO-TURN-ON] set_orientation command ignored - lamp is off and auto-turn-on is disabled")
            return
        
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
                raise HomeAssistantError("Lamp is off and auto-turn-on is disabled.")
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
        entity_id = service_call.data.get("entity_id")
        from .layout import FONT_MAPS
        if font not in FONT_MAPS:
            _LOGGER.error("Invalid font for set_font: %s", font)
            return
        
        target_entity = _resolve_entity(service_call, "SET_FONT")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug("[AUTO-TURN-ON] set_font command ignored - lamp is off and auto-turn-on is disabled")
            return
        
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
        entity_id = service_call.data.get("entity_id")
        if alignment not in ("left", "center", "right"):
            _LOGGER.error("Invalid alignment value for set_alignment: %s", alignment)
            return
        
        target_entity = _resolve_entity(service_call, "SET_ALIGNMENT")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug("[AUTO-TURN-ON] set_alignment command ignored - lamp is off and auto-turn-on is disabled")
            return
        
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
        
        if not isinstance(text, str):
            _LOGGER.error("set_custom_text received non-string: %s", text)
            return
        
        # Prevent empty text -- the Yeelight firmware misbehaves when given
        # an empty string.  Use a single space instead (renders as blank).
        if text == "":
            text = " "

        targets = _resolve_entities(service_call, "SET_CUSTOM_TEXT")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug("[AUTO-TURN-ON] set_custom_text command ignored - lamp is off and auto-turn-on is disabled")
                return
            _LOGGER.debug("[SET_TEXT] Setting custom text to: '%s' for entity %s", text, target_entity.entity_id)
            target_entity._custom_text = text
            target_entity._custom_pixels = None
            target_entity._custom_draw_active = False
            target_entity._active_pixel_art_name = None
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

        _fire_and_forget(*[_apply_one(t) for t in targets])

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
        
        try:
            angle = float(angle)
        except (TypeError, ValueError):
            _LOGGER.error("Invalid angle value for set_angle: %s", angle)
            return

        targets = _resolve_entities(service_call, "SET_ANGLE")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug("[AUTO-TURN-ON] set_angle command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._angle = angle
            # Push angle to HA state immediately so the frontend card's set hass()
            # detects the change and can reload previews without waiting for the
            # next polling cycle (~30s).  Must happen BEFORE the slow hardware
            # command so the JS card sees the new angle right away.
            target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='color_change')
            if target_entity._angle_number_entity:
                target_entity._angle_number_entity.async_update_from_light()

        _fire_and_forget(*[_apply_one(t) for t in targets])

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

        if not text_colors or not isinstance(text_colors, list):
            return

        converted_colors = [tuple(c) for c in text_colors]

        targets = _resolve_entities(service_call, "SET_TEXT_COLORS")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug("[AUTO-TURN-ON] Command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._text_colors = converted_colors
            if target_entity._text_colors:
                target_entity._rgb_color = target_entity._text_colors[0]
            await target_entity.async_apply_display_mode(update_type='color_change')
            target_entity.async_schedule_update_ha_state()

        async def _apply_all():
            await asyncio.gather(*[_apply_one(t) for t in targets])
            await async_save_data(hass)
        hass.async_create_task(_apply_all())

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
        if not image_b64:
            raise HomeAssistantError("image_b64 is required")
        # Resolved before decoding: no work for a call that targets no lamp.
        targets = _resolve_entities(service_call, "DISPLAY_IMAGE")
        if not targets:
            raise HomeAssistantError("No matching Yeelight Cube lamps")

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
        except ValueError as err:
            # Too large, not base64 or not an image: tell the caller.
            raise HomeAssistantError(str(err)) from err
        except Exception as err:  # noqa: BLE001 -- unexpected decoder failure
            _LOGGER.exception("Error processing image")
            raise HomeAssistantError(f"The image could not be processed: {err}") from err

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug("[AUTO-TURN-ON] display_image command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._custom_pixels = custom_pixels
            target_entity._mode = "Custom Draw"
            target_entity._matrix_mode = "Custom Draw"
            target_entity._custom_draw_active = True
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            if target_entity._mode_select_entity:
                target_entity._mode_select_entity.async_update_from_light()
            if target_entity._content_mode_select_entity:
                target_entity._content_mode_select_entity.async_update_from_light()

        _fire_and_forget(*[_apply_one(t) for t in targets])

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
        
        text_modes = [
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
        ]

        if mode not in text_modes + ["Custom Draw"]:
            _LOGGER.error("[set_mode] Invalid mode: %s", mode)
            return

        targets = _resolve_entities(service_call, "SET_MODE")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug("[AUTO-TURN-ON] set_mode command ignored - lamp is off and auto-turn-on is disabled")
                return
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

        _fire_and_forget(*[_apply_one(t) for t in targets])

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
        if not targets:
            return

        async def _apply_one(target_entity):
            # Rendering reads colors from _text_colors, not _rgb_color — set
            # both so the new color is actually visible on the lamp.
            target_entity._text_colors = [rgb_color]
            target_entity._rgb_color = rgb_color
            await target_entity.async_apply_display_mode(update_type='color_change')
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()

        _fire_and_forget(*[_apply_one(t) for t in targets])

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

        targets = _resolve_entities(service_call, "set_full_panel")
        if not targets:
            return

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

        _fire_and_forget(*[_apply_one(t) for t in targets])

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
        if not targets:
            return

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

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_preview_adjustments",
        handle_set_preview_adjustments,
        schema=vol.Schema({
            vol.Optional("darken", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("brighten", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
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
        if not targets:
            return

        _fire_and_forget(*[t.async_force_refresh() for t in targets])

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
        if not targets:
            return

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

        _fire_and_forget(*[_freeze_one(t) for t in targets])

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
        if not targets:
            return

        async def _apply_one(target_entity):
            target_entity._save_display_state()
            _LOGGER.debug("[SAVE_STATE] Saved display state for %s", target_entity.entity_id)

        _fire_and_forget(*[_apply_one(t) for t in targets])

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
        if not targets:
            return

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
            _LOGGER.debug("[RESTORE_STATE] Restored display state for %s", target_entity.entity_id)

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "restore_state",
        handle_restore_state,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )
