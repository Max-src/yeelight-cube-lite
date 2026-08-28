"""Component-level services for the Yeelight Cube Lite.

Extracted from light.py.  Registers every ``handle_*`` action (pixel art,
palettes, text, gradients, native effects, calibration, state save/restore, ...)
against the ``yeelight_cube`` domain and tears them down on unload.  Kept out of
the entity module so light.py stays focused on entity behaviour.

light.py re-exports :func:`async_setup_light_services` /
:func:`async_remove_light_services` from the bottom of that module, so existing
``from .light import async_setup_light_services`` imports keep working without a
circular-import problem (this module imports names back from a fully-loaded
light.py at that point).
"""
import asyncio
import base64
import json
import logging
import math
import random
import time

import voluptuous as vol  # type: ignore
from homeassistant.components import websocket_api  # type: ignore
from homeassistant.core import HomeAssistant, SupportsResponse  # type: ignore
from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore
from homeassistant.util import dt as dt_util  # type: ignore

from . import async_save_data
from .color_utils import hex_to_rgb, rgb_to_hex
from .const import (
    DOMAIN,
    MATRIX_DISPLAY_MODES,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECTS,
    PANEL_FULL_CHAR,
    TEXT_RENDER_MODES,
)
from .image_utils import image_to_matrix
from .layout import FONT_MAPS, TOTAL_COLUMNS, TOTAL_ROWS
from .name_utils import normalize_display_name
from .light import (
    DEVICE_ORIENTATIONS,
    LIGHT_SERVICE_NAMES,
    YeelightCubeLight,
    _ENTITY_REGISTRY,
    _entity_id_or_list,
)

_LOGGER = logging.getLogger(__name__)


def async_setup_light_services(hass: HomeAssistant) -> bool:
    """Register entity-facing actions once at component setup."""

    # Services should only be registered ONCE (not per device)
    # Skip ALL service registration if already registered to avoid duplicate handlers.
    # The sentinel MUST be the most recently ADDED service so that reloading the
    # integration (without a full HA restart) re-registers everything and picks
    # up newly added services. Re-registering existing services just overwrites
    # their handlers, which is harmless.
    if hass.services.has_service(DOMAIN, "set_default"):
        _LOGGER.debug("[SERVICES] Light services already registered")
        return True
    
    _LOGGER.debug("[SERVICES] Registering Yeelight Cube Lite light services")
    
    # Deduplication tracker for palette/pixel art deletions
    # Since cards can have multiple target entities, the same deletion service can be called multiple times
    # Track recent deletions to prevent double-deletion errors
    _deletion_tracker = {"last_palette_deletion": None, "last_pixelart_deletion": None, "last_palette_save": None}
    
    def _resolve_entity(service_call, service_name: str):
        """Resolve the target entity from a service call's entity_id.
        
        Looks up entity_id in _ENTITY_REGISTRY (keyed by entity_id after
        async_added_to_hass runs).  Falls back to searching by entity_id
        attribute if the direct lookup fails.
        
        Returns None and logs an error if entity_id is not provided or
        not found -- callers must handle the None case and abort.
        Never silently falls back to light_entity.
        """
        entity_id = service_call.data.get("entity_id")
        if not entity_id:
            _LOGGER.warning(f"[{service_name}] No entity_id provided -- cannot determine target")
            return None
        
        # If a list was provided, return only the first one (legacy compat)
        if isinstance(entity_id, list):
            entity_id = entity_id[0] if entity_id else None
            if not entity_id:
                return None
        
        # Direct lookup (fast path -- registry is keyed by entity_id)
        target = _ENTITY_REGISTRY.get(entity_id)
        if target:
            return target
        
        # Fallback: search by entity_id attribute (handles edge cases)
        for key, entity_obj in _ENTITY_REGISTRY.items():
            if hasattr(entity_obj, 'entity_id') and entity_obj.entity_id == entity_id:
                return entity_obj
        
        _LOGGER.warning(f"[{service_name}] Entity {entity_id} not found in registry (keys: {list(_ENTITY_REGISTRY.keys())})")
        return None

    def _resolve_entities(service_call, service_name: str):
        """Resolve ALL target entities from a service call's entity_id.
        
        Handles both a single entity_id string and a list of entity_ids.
        Returns a list of resolved entity objects (may be empty).
        Used by handlers that support parallel multi-entity dispatch.
        """
        entity_id = service_call.data.get("entity_id")
        if not entity_id:
            _LOGGER.warning(f"[{service_name}] No entity_id provided -- cannot determine target")
            return []
        
        ids = entity_id if isinstance(entity_id, list) else [entity_id]
        results = []
        for eid in ids:
            target = _ENTITY_REGISTRY.get(eid)
            if not target:
                # Fallback: search by entity_id attribute
                for key, entity_obj in _ENTITY_REGISTRY.items():
                    if hasattr(entity_obj, 'entity_id') and entity_obj.entity_id == eid:
                        target = entity_obj
                        break
            if target:
                results.append(target)
            else:
                _LOGGER.warning(f"[{service_name}] Entity {eid} not found in registry")
        return results

    def _fire_and_forget(*coros):
        """Schedule coroutines to run concurrently in the background.

        hass.async_create_task requires a coroutine, but asyncio.gather
        returns a Future.  This helper wraps the gather in a coroutine so
        the service handler can return immediately while the heavy work
        (transitions, TCP commands) runs in the background.
        """
        async def _run():
            await asyncio.gather(*coros)
        hass.async_create_task(_run())

    async def handle_load_palette(service_call):
        try:
            if service_call is None:
                _LOGGER.error("[LOAD_PALETTE] service_call is None!")
                return
            
            if not hasattr(service_call, 'data'):
                _LOGGER.error(f"[LOAD_PALETTE] service_call has no 'data' attribute! Type: {type(service_call)}")
                return
            
            idx = service_call.data.get("idx")
            entity_id = service_call.data.get("entity_id")
            
            _LOGGER.debug(f"[LOAD_PALETTE] Called: idx={idx}, entity_id={entity_id}")
        except Exception as e:
            _LOGGER.error(f"[LOAD_PALETTE] Error at start: {e}", exc_info=True)
            return
        
        # Access palettes from global storage (not entity property) to avoid hass.data issues
        if DOMAIN not in hass.data or "palettes_v2" not in hass.data[DOMAIN]:
            _LOGGER.error("[LOAD_PALETTE] No palettes storage found in hass.data")
            return
        
        palettes = hass.data[DOMAIN]["palettes_v2"]
        
        if not (isinstance(idx, int) and 0 <= idx < len(palettes)):
            _LOGGER.error(f"[LOAD_PALETTE] Invalid idx {idx} (valid range: 0-{len(palettes)-1})")
            return
            
        palette = palettes[idx]
        
        if not (isinstance(palette, dict) and "colors" in palette and isinstance(palette["colors"], list)):
            _LOGGER.error(f"[LOAD_PALETTE] No valid colors for idx {idx}")
            return

        targets = _resolve_entities(service_call, "LOAD_PALETTE")
        if not targets:
            return

        async def _apply_one(target_entity):
            target_entity._text_colors = palette["colors"]
            if target_entity._text_colors:
                target_entity._rgb_color = target_entity._text_colors[0]
            if getattr(target_entity, '_mode', None) == "Panel Color Sequence":
                colors = palette["colors"]
                for i, module in enumerate(target_entity._layout.device_layout):
                    color = colors[i % len(colors)]
                    hex_color = rgb_to_hex(tuple(color))
                    module.set_colors([hex_color])
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            # Push the updated state so consumers watching the `text_colors`
            # attribute (e.g. the gradient card's live preview) refresh
            # immediately.  Without this the new colours are only exposed on the
            # next unrelated state write (e.g. an angle change), which is why the
            # preview appeared stale until the user moved the angle wheel.
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            _LOGGER.debug(f"[palette-backend] Applied palette idx {idx} to {target_entity._ip}")

        _fire_and_forget(*[_apply_one(t) for t in targets])

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

    hass.services.async_register(
        DOMAIN,
        "load_palette",
        handle_load_palette,
        schema=vol.Schema({
            vol.Required("idx"): cv.positive_int,
            vol.Required("entity_id"): _entity_id_or_list
        })
    )

    def _normalize_pixels(pixels):
        """Group non-black pixels by color — one entry per distinct color per art.

        Accepts flat [{position, color}] (position scalar or list) input.
        Also accepts the legacy grouped [{color, positions}] key for backward compat
        when reading old stored data.

        Output format: [{"color": [R, G, B], "position": [int, ...]}, ...]

        First definition of a position wins (duplicates ignored).
        """
        seen_positions: dict = {}  # position -> color (first definition wins)
        for px in pixels:
            color = list(px.get("color", []))
            if color == [0, 0, 0]:
                continue  # black = background; omit to save space
            if "position" in px:
                raw_pos = px.get("position")
                pos_list = raw_pos if isinstance(raw_pos, list) else [raw_pos]
            elif "positions" in px:
                # Backward-compat: old storage/round-trip used "positions" (plural)
                pos_list = px.get("positions", [])
            else:
                continue
            for pos in pos_list:
                if pos is not None and pos not in seen_positions:
                    seen_positions[pos] = color
        # Group by color
        color_groups: dict = {}
        for pos, color in seen_positions.items():
            key = tuple(color)
            color_groups.setdefault(key, []).append(pos)
        return [
            {"color": list(color), "position": sorted(positions)}
            for color, positions in color_groups.items()
        ]

    def _expand_pixels(pixels):
        """Expand grouped [{color, position: [...]}] storage back to flat [{position, color}] list.

        position may be a scalar (flat) or a list (grouped internal storage).
        Also handles legacy "positions" (plural) key for backward compat with old stored data.
        """
        result = []
        for entry in pixels:
            if not isinstance(entry, dict):
                continue
            color = entry.get("color", [])
            if "position" in entry:
                pos = entry.get("position")
                if isinstance(pos, list):
                    for p in pos:
                        result.append({"position": p, "color": color})
                else:
                    result.append({"position": pos, "color": color})
            elif "positions" in entry:
                # Backward-compat: old stored data used "positions" (plural)
                for pos in entry.get("positions", []):
                    result.append({"position": pos, "color": color})
        return result

    async def handle_update_pixel_arts(service_call):
        """Update the pixel art collection — append (default) or fully replace."""
        pixel_arts = service_call.data.get("pixel_arts")
        replace = service_call.data.get("replace", False)
        if not isinstance(pixel_arts, list):
            _LOGGER.error("update_pixel_arts expects a list of pixel art dicts")
            return
        
        # Validate structure: each item should be a dict with 'name' and 'pixels' (list)
        valid_pixel_arts = []
        for art in pixel_arts:
            if (
                isinstance(art, dict)
                and "name" in art
                and "pixels" in art
                and isinstance(art["pixels"], list)
            ):
                valid_pixel_arts.append({
                    "name": normalize_display_name(
                        art["name"], f"Pixel Art {len(valid_pixel_arts) + 1}"
                    ),
                    "pixels": _normalize_pixels(art["pixels"]),
                })
        
        # Update global storage
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        if replace:
            hass.data[DOMAIN]["pixel_arts"] = valid_pixel_arts
        else:
            existing = hass.data[DOMAIN].get("pixel_arts", [])
            hass.data[DOMAIN]["pixel_arts"] = existing + valid_pixel_arts
        
        # Force sensor update by firing event
        hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(valid_pixel_arts)})
        
        # Save to persistent storage
        await async_save_data(hass)
        
        mode = "replace" if replace else "append"
        total = len(hass.data[DOMAIN]["pixel_arts"])
        _LOGGER.debug(f"[pixelart-backend] update_pixel_arts ({mode}): {len(valid_pixel_arts)} items provided, {total} total in collection.")

    # Register the pixel-art websocket command ONCE at setup time.
    # (This was previously nested inside handle_update_pixel_arts by mistake:
    # the command only existed after that service was first called, and every
    # subsequent call re-registered it.)
    ws_schema_v2 = vol.Schema({vol.Optional("idx"): object}, extra=vol.ALLOW_EXTRA)

    @websocket_api.websocket_command({
        "type": "yeelight_cube/ws_get_pixel_art_v2",
        "schema": ws_schema_v2,
    })
    @websocket_api.async_response
    async def ws_get_pixel_art_v2(hass, connection, msg):
        try:
            idx = msg.get("idx")
            pixel_arts = hass.data.get(DOMAIN, {}).get("pixel_arts", [])
            if not (isinstance(idx, int) and 0 <= idx < len(pixel_arts)):
                connection.send_error(msg["id"], "invalid_index", f"Invalid idx {idx}")
                return
            art = pixel_arts[idx]
            if not (isinstance(art, dict) and "pixels" in art and isinstance(art["pixels"], list) and len(art["pixels"]) > 0):
                connection.send_error(msg["id"], "no_pixels", f"No valid pixels for idx {idx}")
                return
            connection.send_result(msg["id"], {"name": art.get("name", "Unnamed"), "pixels": art.get("pixels", [])})
        except Exception as e:
            _LOGGER.error(f"[pixelart-debug] Exception in ws_get_pixel_art_v2: {e}")

    websocket_api.async_register_command(hass, ws_get_pixel_art_v2)
    
    # NOTE: Entity is already created and registered at the top of this function.
    # Do NOT create a second CubeMatrix/YeelightCubeLight here.

    # --- Pixel Art Service Handlers ---
    async def handle_save_pixel_art(service_call):
        import datetime
        name = service_call.data.get("name")
        pixels = service_call.data.get("pixels")
        if not isinstance(pixels, list):
            _LOGGER.error("save_pixel_art expects a list of pixels")
            return
        
        # Expand multi-position entries and strip black pixels before storing
        pixels = _normalize_pixels(pixels)
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        if "pixel_arts" not in hass.data[DOMAIN]:
            hass.data[DOMAIN]["pixel_arts"] = []
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        if not name:
            name = f"Pixel Art {len(pixel_arts) + 1}"
        name = normalize_display_name(name, f"Pixel Art {len(pixel_arts) + 1}")
        
        # Add to global storage
        pixel_arts.append({"name": name, "pixels": pixels})
        
        # Pixel arts are global - just fire event for sensor and save
        hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(pixel_arts)})
        
        # Save to persistent storage
        await async_save_data(hass)
        
        _LOGGER.debug(f"[PIXELART-SAVE] Saved '{name}' with {len(pixels)} pixels, new count: {len(pixel_arts)}")

    async def handle_remove_pixel_art(service_call):
        idx = service_call.data.get("idx")
        _LOGGER.debug(f"[PIXELART-DELETE] Service called with idx={idx}")
        
        # No duplicate detection - rapid successive deletions are valid
        # (indices shift after each deletion, so same idx can refer to different pixel arts)
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data or "pixel_arts" not in hass.data[DOMAIN]:
            _LOGGER.error("[PIXELART-DELETE] No pixel arts storage found in hass.data")
            return
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        _LOGGER.debug(f"[PIXELART-DELETE] Current pixel art count={len(pixel_arts)}")
        
        if isinstance(idx, int) and 0 <= idx < len(pixel_arts):
            removed = pixel_arts.pop(idx)
            _LOGGER.debug(f"[PIXELART-DELETE] Deleted pixel art at idx {idx}: {removed.get('name', 'Unnamed')}")
            
            # Pixel arts are global (not per-light), only need to:
            # 1. Fire event for sensor to pick up
            # 2. Save to persistent storage
            # No need to update light entities - pixel arts are independent
            
            hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(pixel_arts)})
            _LOGGER.debug(f"[PIXELART-DELETE] Fired event, new count: {len(pixel_arts)}")
            
            # Save to persistent storage
            await async_save_data(hass)
            _LOGGER.debug(f"[PIXELART-DELETE] Saved to storage. New pixel art count: {len(pixel_arts)}")
        else:
            _LOGGER.error(f"[PIXELART-DELETE] Invalid idx {idx} (pixel art count: {len(pixel_arts)})")

    async def handle_rename_pixel_art(service_call):
        idx = service_call.data.get("idx")
        new_name = service_call.data.get("name")
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data or "pixel_arts" not in hass.data[DOMAIN]:
            _LOGGER.error("[pixelart-backend] No pixel arts to rename")
            return
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        if (
            isinstance(idx, int)
            and 0 <= idx < len(pixel_arts)
            and isinstance(new_name, str)
        ):
            new_name = normalize_display_name(new_name, f"Pixel Art {idx + 1}")
            pixel_arts[idx]["name"] = new_name
            
            # Pixel arts are global - just fire event for sensor and save
            hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(pixel_arts)})
            
            # Save to persistent storage
            await async_save_data(hass)
            
            _LOGGER.debug(f"[PIXELART-RENAME] Renamed idx {idx} to '{new_name}'")




    async def handle_apply_pixel_art(service_call):
        # Only accept idx, apply saved pixel art -- supports multi-entity parallel dispatch
        idx = service_call.data.get("idx")
        targets = _resolve_entities(service_call, "APPLY_PIXEL_ART")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not (isinstance(idx, int) and 0 <= idx < len(target_entity._pixel_arts)):
                _LOGGER.error(f"[pixelart-backend] apply_pixel_art: Invalid idx {idx}.")
                return
            art = target_entity._pixel_arts[idx]
            if not (isinstance(art, dict) and "pixels" in art and isinstance(art["pixels"], list) and len(art["pixels"]) > 0):
                _LOGGER.error(f"[pixelart-backend] apply_pixel_art: No valid pixels for idx {idx}.")
                return
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] apply_pixel_art command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._custom_pixels = _expand_pixels(art["pixels"])
            target_entity._mode = "Custom Draw"
            target_entity._matrix_mode = "Custom Draw"
            target_entity._custom_draw_active = True
            target_entity._active_pixel_art_name = art.get("name", f"Pixel Art {idx + 1}")
            if not target_entity._custom_text:
                target_entity._custom_text = "HELLO"
            target_entity._scroll_offset = 0
            target_entity._scroll_direction = 1
            target_entity.stop_scroll_timer()
            target_entity._is_scrolling = False
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            if target_entity._pixel_art_select_entity:
                target_entity._pixel_art_select_entity.async_update_from_light()
            if target_entity._mode_select_entity:
                target_entity._mode_select_entity.async_update_from_light()
            if target_entity._content_mode_select_entity:
                target_entity._content_mode_select_entity.async_update_from_light()
            _LOGGER.debug(f"[pixelart-backend] Applied pixel art idx {idx} to {target_entity._ip}.")

        _fire_and_forget(*[_apply_one(t) for t in targets])

    async def handle_apply_custom_pixels(service_call):
        pixels = service_call.data.get("pixels")
        bypass_lock = bool(service_call.data.get("bypass_lock", False))
        _LOGGER.debug(f"[pixelart-backend] apply_custom_pixels: pixels={len(pixels) if pixels else 0}")
        if not pixels or not isinstance(pixels, list):
            _LOGGER.error(f"[pixelart-backend] apply_custom_pixels: No valid pixels provided.")
            return

        targets = _resolve_entities(service_call, "APPLY_CUSTOM_PIXELS")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] apply_custom_pixels command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._custom_pixels = _expand_pixels(pixels)
            target_entity._mode = "Custom Draw"
            target_entity._matrix_mode = "Custom Draw"
            target_entity._custom_draw_active = True
            if not target_entity._custom_text:
                target_entity._custom_text = "HELLO"
            target_entity._scroll_offset = 0
            target_entity._scroll_direction = 1
            target_entity.stop_scroll_timer()
            target_entity._is_scrolling = False
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='pixel_art', bypass_lock=bypass_lock)
            if target_entity._mode_select_entity:
                target_entity._mode_select_entity.async_update_from_light()
            if target_entity._content_mode_select_entity:
                target_entity._content_mode_select_entity.async_update_from_light()

        _fire_and_forget(*[_apply_one(t) for t in targets])

    async def handle_send_fx_effect(service_call):
        """DEBUG: send a raw LAN command (default ``set_fx_effect``).

        Local exploration/reverse-engineering tool used by the FX Explorer
        card. NOT part of the stable API -- do not rely on it in automations.

        Either supply ``params`` directly (a raw JSON array sent verbatim), or
        supply the structured fields (mode/style_id/apply/mixer/color/data*)
        and this handler assembles the standard 4-element params list:
            [mode, style_id, apply, {mode, mixer, [color], [data]}]
        """
        method = service_call.data.get("method") or "set_fx_effect"
        raw_params = service_call.data.get("params")
        close_socket = bool(service_call.data.get("close_socket", True))
        persist = bool(service_call.data.get("persist", False))

        target = _resolve_entity(service_call, "SEND_FX_EFFECT")
        if target is None:
            return {"ok": False, "error": "entity not found"}

        if raw_params is not None:
            params = raw_params
        else:
            mode = int(service_call.data.get("mode", NATIVE_CLOCK_EFFECT_ID))
            style_id = int(service_call.data.get("style_id", 0))
            apply = int(service_call.data.get("apply", NATIVE_CLOCK_APPLY))
            mixer = int(service_call.data.get("mixer", 0))
            config = {"mode": mode, "mixer": mixer}
            data_b64 = service_call.data.get("data")
            data_bytes = service_call.data.get("data_bytes")
            if data_b64 is not None:
                config["data"] = data_b64
            elif data_bytes is not None:
                config["data"] = base64.b64encode(
                    bytes(int(b) & 0xFF for b in data_bytes)
                ).decode("ascii")
            # The firmware clock effect (mode 40) REQUIRES a data payload
            # (date/timezone/12h/colon). If none was supplied explicitly, build
            # it from the lamp's current clock settings -- exactly like
            # _activate_native_clock -- otherwise the clock renders blank.
            if mode == NATIVE_CLOCK_EFFECT_ID and "data" not in config:
                config["data"] = base64.b64encode(
                    target._native_clock_data_bytes()
                ).decode("ascii")
            color = service_call.data.get("color")
            if color is not None:
                config["color"] = color if isinstance(color, list) else [int(color)]
            # Optional animation speed. The firmware clock effect (mode 40)
            # accepts a `rate` field just like native effects.
            rate = service_call.data.get("rate")
            if rate is not None:
                try:
                    config["rate"] = int(rate)
                except (TypeError, ValueError):
                    pass
            params = [mode, style_id, apply, config]

        # Derive effect mode/style for optional persistence (from whichever
        # branch built params). params = [mode, style_id, apply, config].
        effect_mode = None
        effect_style = None
        effect_config = None
        try:
            if isinstance(params, list) and len(params) >= 2:
                effect_mode = int(params[0])
                effect_style = int(params[1])
            if isinstance(params, list) and len(params) >= 4 and isinstance(
                params[3], dict
            ):
                effect_config = params[3]
        except (TypeError, ValueError):
            pass

        # Is this a firmware fx command (clock or native effect)? Both need the
        # set_bright prelude + settle, otherwise the raw command often doesn't
        # render until a Force Refresh replays it.
        is_fx = method == "set_fx_effect"
        # Map a native-effect id -> name for persistence, if it matches.
        native_effect_name = None
        for _name, _spec in NATIVE_EFFECTS.items():
            if _spec.get("effect_id") == effect_mode and effect_mode is not None:
                native_effect_name = _name
                break

        try:
            async def _do_send():
                if close_socket:
                    target._cube_matrix._close_fast_socket()
                # The firmware clock (mode 40) is order-sensitive: sending
                # set_bright BEFORE set_fx_effect can CANCEL the clock
                # activation (see _activate_native_clock). So for clock we send
                # the fx command first, then brightness. Native effects are the
                # opposite -- they want the set_bright prelude first so they
                # render immediately.
                is_clock = effect_mode == NATIVE_CLOCK_EFFECT_ID
                if is_fx and is_clock:
                    await asyncio.sleep(0.1)
                    await target._cube_matrix.send_raw_command(
                        method, params, abortive_close=False
                    )
                    await asyncio.sleep(0.1)
                    await target._set_native_mode_brightness()
                    return
                if is_fx:
                    await target._set_native_mode_brightness()
                    await asyncio.sleep(0.1)
                # Color flow (start_cf) renders only while the panel is powered
                # on, and runs entirely in firmware afterwards. Power on first so
                # the flow is visible even if the panel was off/idle.
                if method == "start_cf":
                    await target._cube_matrix.send_raw_command("set_power", ["on"])
                    await asyncio.sleep(0.1)
                await target._cube_matrix.send_raw_command(method, params)

            # Run under the device hardware lock so the send is serialized with
            # the persistent socket / background loop (prevents the command from
            # being clobbered mid-flight).
            await target._execute_hardware_op(_do_send, "fx_explorer_send")
            _LOGGER.warning(
                "[FX-EXPLORER] %s -> %s params=%s", target.entity_id, method, params
            )

            # Keep entity bookkeeping consistent with a native activation so the
            # camera preview and later refreshes behave correctly.
            if is_fx:
                target._is_on = True
                target._fx_mode_is_direct = False
                target._in_native_fw_mode = True   # Lamp in firmware-native mode (FX Explorer)
                target._last_fx_mode_time = 0.0
                notify = getattr(target, "_notify_camera_preview", None)
                if notify:
                    notify()
                # Always reflect the current firmware command in the entity
                # state so the lamp-preview card matches exactly what selecting
                # the same clock style / effect from the device settings page
                # would show -- not just the mode, but the specific style,
                # colour and options (so clock_style_id, and thus the masked
                # effect / colour the card renders, are correct even when
                # persist is unchecked).
                if effect_mode == NATIVE_CLOCK_EFFECT_ID:
                    target._mode = "Clock"
                    if effect_style in NATIVE_CLOCK_STYLES:
                        target._native_clock_style = effect_style
                    if isinstance(effect_config, dict):
                        if "color" in effect_config:
                            _color = effect_config["color"]
                            target._native_clock_color = (
                                int(_color[0])
                                if isinstance(_color, list) and _color
                                else int(_color)
                            )
                        else:
                            target._native_clock_color = None
                        if "data" in effect_config:
                            try:
                                _cb = base64.b64decode(effect_config["data"])
                                if len(_cb) >= 1:
                                    target._native_clock_content = {
                                        1: "time",
                                        2: "time_date",
                                        3: "date",
                                    }.get(_cb[0], target._native_clock_content)
                                    target._native_clock_show_date = _cb[0] == 2
                                if len(_cb) >= 3:
                                    target._native_clock_12_hour = _cb[2] == 1
                                if len(_cb) >= 4:
                                    # Firmware byte is inverted: 0 blinks, 1 steady.
                                    target._native_clock_colon_blink = _cb[3] == 0
                            except Exception:
                                pass
                elif native_effect_name is not None:
                    target._mode = "Native Effect"
                    target._native_effect = native_effect_name
                    if isinstance(effect_config, dict):
                        if "rate" in effect_config:
                            try:
                                target._native_effect_speed = max(
                                    1, min(255, int(effect_config["rate"]))
                                )
                            except (TypeError, ValueError):
                                pass
                        if "direction" in effect_config:
                            for _dn, _dv in NATIVE_EFFECT_DIRECTION_VALUES.items():
                                if _dv == effect_config["direction"]:
                                    target._native_effect_direction = _dn
                                    break
                if target.hass is not None:
                    if (
                        effect_mode == NATIVE_CLOCK_EFFECT_ID
                        or native_effect_name is not None
                    ):
                        target._refresh_linked_entities()
                    target.async_write_ha_state()
            elif method == "start_cf":
                # Color flow leaves the panel on but not in direct FX mode.
                # It is live-only (not persistable through the state model).
                target._is_on = True
                target._fx_mode_is_direct = False
                target._in_native_fw_mode = True   # Lamp in color-flow mode (FX Explorer)
                target._last_fx_mode_time = 0.0

            persisted = False
            # Persist for the native clock effect (known style ID) OR a native
            # animation effect, so a Force Refresh / state update re-applies it
            # instead of reverting. Arbitrary/unknown raw values can't be
            # persisted through the state model and are left as live-only.
            if (
                persist
                and effect_mode == NATIVE_CLOCK_EFFECT_ID
                and effect_style in NATIVE_CLOCK_STYLES
            ):
                target._native_clock_style = effect_style
                target._mode = "Clock"
                target._is_on = True
                # Persist the color if the raw call supplied one, so subsequent
                # activations keep the same custom color.
                if isinstance(effect_config, dict) and "color" in effect_config:
                    color_value = effect_config["color"]
                    if isinstance(color_value, list) and color_value:
                        target._native_clock_color = int(color_value[0])
                    else:
                        target._native_clock_color = int(color_value)
                elif isinstance(effect_config, dict) and "color" not in effect_config:
                    target._native_clock_color = None
                # Decode the 4-byte data payload to persist clock settings so
                # subsequent activations (brightness change, refresh, etc.) use
                # the values the caller explicitly sent rather than reverting to
                # the old entity state.  Format (matches _native_clock_data_bytes):
                #   [show_date(1/2), tz_offset, 12h(0/1), colon_steady(0=blink)]
                if isinstance(effect_config, dict) and "data" in effect_config:
                    try:
                        clock_bytes = base64.b64decode(effect_config["data"])
                        if len(clock_bytes) >= 1:
                            target._native_clock_show_date = clock_bytes[0] == 2
                        if len(clock_bytes) >= 3:
                            target._native_clock_12_hour = clock_bytes[2] == 1
                        if len(clock_bytes) >= 4:
                            # Firmware byte is inverted: 0 = blink, 1 = steady
                            target._native_clock_colon_blink = clock_bytes[3] == 0
                    except Exception:
                        pass
                # Record the current UTC offset so the periodic ``async_update``
                # timezone check does not immediately fire a SECOND clock
                # activation (which races this one for the hardware lock and
                # visibly resets the panel). ``_activate_native_clock`` sets this
                # on the normal path; the raw FX path must do the same.
                target._native_clock_timezone_offset = (
                    target._native_clock_timezone_hours()
                )
                if target.hass is not None:
                    target.async_schedule_update_ha_state()
                    target._refresh_linked_entities()
                persisted = True
                _LOGGER.warning(
                    "[FX-EXPLORER] persisted clock style=%s on %s",
                    effect_style,
                    target.entity_id,
                )
            elif persist and native_effect_name is not None:
                target._native_effect = native_effect_name
                target._mode = "Native Effect"
                target._is_on = True
                if isinstance(effect_config, dict):
                    if "rate" in effect_config:
                        try:
                            target._native_effect_speed = max(
                                1, min(255, int(effect_config["rate"]))
                            )
                        except (TypeError, ValueError):
                            pass
                    if "direction" in effect_config:
                        # Reverse-map the numeric direction to its name.
                        for _dname, _dval in NATIVE_EFFECT_DIRECTION_VALUES.items():
                            if _dval == effect_config["direction"]:
                                target._native_effect_direction = _dname
                                break
                if target.hass is not None:
                    target.async_schedule_update_ha_state()
                    target._refresh_linked_entities()
                persisted = True
                _LOGGER.warning(
                    "[FX-EXPLORER] persisted native effect=%s on %s",
                    native_effect_name,
                    target.entity_id,
                )
            return {
                "ok": True,
                "method": method,
                "params": params,
                "persisted": persisted,
            }
        except Exception as e:  # noqa: BLE001 -- debug tool, surface any error
            _LOGGER.error("[FX-EXPLORER] send failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e), "method": method, "params": params}

    async def handle_query_raw(service_call):
        """DEBUG: send a raw command and RETURN the lamp's reply.

        Companion to send_fx_effect for the decoder/capture card. Lets you
        probe the device (e.g. get_prop) and observe how it responds to
        experimental commands. Not a stable API.
        """
        method = service_call.data.get("method") or "get_prop"
        params = service_call.data.get("params")
        if params is None:
            params = []
        target = _resolve_entity(service_call, "QUERY_RAW")
        if target is None:
            return {"ok": False, "error": "entity not found"}
        try:
            reply = await target._cube_matrix.query_raw_command(method, params)
            _LOGGER.warning(
                "[FX-QUERY] %s -> %s params=%s reply=%r",
                target.entity_id,
                method,
                params,
                reply,
            )
            parsed = None
            try:
                parsed = json.loads(reply) if reply else None
            except (ValueError, TypeError):
                parsed = None
            return {
                "ok": True,
                "method": method,
                "params": params,
                "reply": reply,
                "parsed": parsed,
            }
        except Exception as e:  # noqa: BLE001 -- debug tool
            _LOGGER.error("[FX-QUERY] query failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e), "method": method, "params": params}

    async def handle_set_default(service_call):
        """DEBUG: Snapshot the lamp's CURRENT state as its power-on default.

        Sends the documented ``set_default`` command so that after a power cut
        the Cube restores whatever it is showing right now. Not a stable API.
        """
        target = _resolve_entity(service_call, "SET_DEFAULT")
        if target is None:
            return {"ok": False, "error": "entity not found"}
        try:
            target._cube_matrix._close_fast_socket()
            await target._cube_matrix.send_raw_command("set_default", [])
            _LOGGER.warning("[SET-DEFAULT] %s saved current state as default", target.entity_id)
            return {"ok": True}
        except Exception as e:  # noqa: BLE001 -- debug tool
            _LOGGER.error("[SET-DEFAULT] failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e)}

    async def handle_get_pixel_art(service_call):
        idx = service_call.data.get("idx")
        group_by_color = service_call.data.get("group_by_color", False)
        pixel_arts = hass.data.get(DOMAIN, {}).get("pixel_arts", [])
        if not (isinstance(idx, int) and 0 <= idx < len(pixel_arts)):
            _LOGGER.error(f"[pixelart-backend] get_pixel_art: Invalid idx {idx}")
            return {"error": "Invalid index"}
        art = pixel_arts[idx]
        if group_by_color:
            # Internal storage is already in grouped {color, positions} format
            return {"name": art.get("name", "Unnamed"), "pixels": art.get("pixels", [])}
        # Expand to flat [{position, color}] sorted by position
        flat_pixels = sorted(
            _expand_pixels(art.get("pixels", [])),
            key=lambda px: px["position"],
        )
        return {"name": art.get("name", "Unnamed"), "pixels": flat_pixels}

    hass.services.async_register(
    DOMAIN,
    "get_pixel_art",
    handle_get_pixel_art,
    schema=vol.Schema({
        vol.Required("idx", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("group_by_color", default=False): bool,
    }),
    supports_response=SupportsResponse.ONLY,
    )

    hass.services.async_register(
        DOMAIN,
        "save_pixel_art",
        handle_save_pixel_art,
        schema=vol.Schema({
            vol.Required("pixels"): [
                {
                    vol.Required("position"): vol.Any(
                        cv.positive_int,
                        [cv.positive_int],
                    ),
                    vol.Required("color"): vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple)),
                }
            ],
            vol.Optional("name"): cv.string,
        }, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "remove_pixel_art",
        handle_remove_pixel_art,
        schema=vol.Schema({vol.Required("idx"): vol.All(int, vol.Range(min=0))}, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "rename_pixel_art",
        handle_rename_pixel_art,
        schema=vol.Schema({
            vol.Required("idx"): vol.All(int, vol.Range(min=0)),
            vol.Required("name"): cv.string,
        }, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "apply_pixel_art",
        handle_apply_pixel_art,
        schema=vol.Schema({
            vol.Required("idx"): vol.All(int, vol.Range(min=0)),
            vol.Required("entity_id"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "apply_custom_pixels",
        handle_apply_custom_pixels,
        schema=vol.Schema({
            vol.Required("pixels", description="Array of 100 RGB color arrays representing the 10x10 matrix pixels, e.g. [[255,0,0], [0,255,0], ...]"): list,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )

    # DEBUG: raw firmware command explorer (used by the FX Explorer card).
    # Local reverse-engineering tool -- not a stable API.
    hass.services.async_register(
        DOMAIN,
        "send_fx_effect",
        handle_send_fx_effect,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Optional("method"): cv.string,
            vol.Optional("params"): list,
            vol.Optional("mode"): int,
            vol.Optional("style_id"): int,
            vol.Optional("apply"): int,
            vol.Optional("mixer"): int,
            vol.Optional("rate"): int,
            vol.Optional("data"): cv.string,
            vol.Optional("data_bytes"): list,
            vol.Optional("color"): vol.Any(int, [int]),
            vol.Optional("close_socket"): bool,
            vol.Optional("persist"): bool,
        }, extra=vol.ALLOW_EXTRA),        supports_response=SupportsResponse.OPTIONAL,
    )
    
    # DEBUG: raw query (send + capture the lamp's reply) for the decoder card.
    hass.services.async_register(
        DOMAIN,
        "query_raw",
        handle_query_raw,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Optional("method"): cv.string,
            vol.Optional("params"): list,
        }, extra=vol.ALLOW_EXTRA),
        supports_response=SupportsResponse.OPTIONAL,
    )

    # DEBUG: spec-lab experiments (music mode benchmark, set_default, notify).
    hass.services.async_register(
        DOMAIN,
        "set_default",
        handle_set_default,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA),
        supports_response=SupportsResponse.OPTIONAL,
    )

    hass.services.async_register(
        DOMAIN,
        "update_pixel_arts",
        handle_update_pixel_arts,
        schema=vol.Schema({
            vol.Required("pixel_arts"): list,
            vol.Optional("replace", default=False): bool,
        }, extra=vol.ALLOW_EXTRA)
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
        
        _LOGGER.debug(f"[SET_BRIGHTNESS] Setting brightness to {brightness_pct}% (HA value: {ha_brightness}) for {target_entity.entity_id}")
        
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
            _LOGGER.debug(f"[SET_BRIGHTNESS] Successfully set brightness to {brightness_pct}%")
        except Exception as e:
            _LOGGER.error(f"[SET_BRIGHTNESS] Failed to set brightness: {e}")
    
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
            _LOGGER.debug(f"[AUTO-TURN-ON] set_orientation command ignored - lamp is off and auto-turn-on is disabled")
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

        target_entity = _resolve_entity(service_call, "SET_DEVICE_ORIENTATION")
        if not target_entity:
            return

        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug("[AUTO-TURN-ON] set_device_orientation ignored - lamp is off and auto-turn-on is disabled")
            return

        await target_entity.set_device_orientation(orientation)

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
            _LOGGER.error(f"Invalid font for set_font: {font}")
            return
        
        target_entity = _resolve_entity(service_call, "SET_FONT")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug(f"[AUTO-TURN-ON] set_font command ignored - lamp is off and auto-turn-on is disabled")
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
            _LOGGER.error(f"Invalid alignment value for set_alignment: {alignment}")
            return
        
        target_entity = _resolve_entity(service_call, "SET_ALIGNMENT")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug(f"[AUTO-TURN-ON] set_alignment command ignored - lamp is off and auto-turn-on is disabled")
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
    # Note: handle_remove_palette is defined later in the file (after handle_set_full_panel)
    # to avoid duplicate service registration
    
    async def handle_set_palettes(service_call):
        palettes = service_call.data.get("palettes_v2") or service_call.data.get("palettes")
        if palettes and isinstance(palettes, list):
            # Validate palettes: list of dicts with name and colors
            valid_palettes = []
            for pal in palettes:
                if (
                    isinstance(pal, dict)
                    and "name" in pal
                    and "colors" in pal
                    and isinstance(pal["colors"], list)
                    and all(isinstance(c, (list, tuple)) and len(c) == 3 for c in pal["colors"])
                ):
                    valid_palettes.append({
                        "name": normalize_display_name(
                            pal["name"], f"Palette {len(valid_palettes) + 1}"
                        ),
                        "colors": [tuple(c) for c in pal["colors"]],
                    })
            # Store palettes globally
            if DOMAIN not in hass.data:
                hass.data[DOMAIN] = {}
            hass.data[DOMAIN]["palettes_v2"] = valid_palettes
            # Trigger state update on ALL entities (palettes are exposed as state attributes)
            for entity_obj in _ENTITY_REGISTRY.values():
                if hasattr(entity_obj, 'hass') and entity_obj.hass is not None:
                    entity_obj.async_schedule_update_ha_state()
            # Save to persistent storage
            await async_save_data(hass)

    hass.services.async_register(
        DOMAIN,
        "set_palettes",
        handle_set_palettes,
        schema=vol.Schema({
            vol.Required("palettes"): [
                {"name": cv.string, "colors": [vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple))]}
            ],
        })
    )
    async def handle_save_palette(service_call):
        palette = service_call.data.get("palette")
        entity_id = service_call.data.get("entity_id")
        name = service_call.data.get("name")
        
        # Access palettes from global storage directly (not through entity property)
        # to avoid issues if entity.hass is not yet initialized
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        if "palettes_v2" not in hass.data[DOMAIN]:
            hass.data[DOMAIN]["palettes_v2"] = []
        palettes = hass.data[DOMAIN]["palettes_v2"]
        
        # Generate default name if not provided
        if not name:
            name = f"Palette {len(palettes)+1}"
        name = normalize_display_name(name, f"Palette {len(palettes) + 1}")
        
        # Create a deduplication key based on palette colors and name
        palette_key = f"save_{name}_{len(palette) if palette else 0}"
        if _deletion_tracker["last_palette_save"] == palette_key:
            _LOGGER.debug(f"[SAVE_PALETTE] DUPLICATE CALL DETECTED - skipping save of '{name}' (already saved)")
            return
        
        _LOGGER.debug(f"[SAVE_PALETTE] Received entity_id: {entity_id}, palette length: {len(palette) if palette else 0}, name: {name}")
        
        target_entity = _resolve_entity(service_call, "SAVE_PALETTE")
        if not target_entity:
            return
            
        if palette and isinstance(palette, list):
            # Track this save to prevent duplicates
            _deletion_tracker["last_palette_save"] = palette_key
            
            # Clear tracker after 2 seconds to allow future operations with same name
            async def clear_tracker():
                await asyncio.sleep(2)
                if _deletion_tracker["last_palette_save"] == palette_key:
                    _deletion_tracker["last_palette_save"] = None
            hass.async_create_task(clear_tracker())
            
            # Allow saving palettes with duplicate color lists (different names)
            palettes.append({"name": name, "colors": [tuple(c) for c in palette]})
            _LOGGER.debug(f"[SAVE_PALETTE] Palette appended to storage. New count: {len(palettes)}")
            _LOGGER.debug(f"[SAVE_PALETTE] Last 3 palette names in storage: {[p.get('name', 'unnamed') for p in palettes[-3:]]}")
            
            # Trigger state update for all entities that are ready
            for ip, entity in _ENTITY_REGISTRY.items():
                if entity.hass is not None:  # Only update entities that are fully initialized
                    entity.async_write_ha_state()
            
            # Fire event for sensor updates
            _LOGGER.debug(f"[SAVE_PALETTE] Firing palettes_updated event with count={len(palettes)}")
            hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
            
            # Save to persistent storage
            await async_save_data(hass)
            _LOGGER.debug(f"[SAVE_PALETTE] Palette '{name}' saved. Total palettes: {len(palettes)}")

    hass.services.async_register(
        DOMAIN,
        "save_palette",
        handle_save_palette,
        schema=vol.Schema({
            vol.Required("palette"): vol.All(
                [vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple))]
            ),
            vol.Optional("name"): cv.string,
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )
    async def handle_rename_palette(service_call):
        idx = service_call.data.get("idx")
        new_name = service_call.data.get("name")
        # Access global palette storage directly
        palettes = hass.data.get(DOMAIN, {}).get("palettes_v2", [])
        if (
            isinstance(idx, int)
            and 0 <= idx < len(palettes)
            and isinstance(new_name, str)
        ):
            new_name = normalize_display_name(new_name, f"Palette {idx + 1}")
            palettes[idx]["name"] = new_name
            # Update ALL entities' HA state (palettes are exposed as state attributes)
            for entity_obj in _ENTITY_REGISTRY.values():
                if hasattr(entity_obj, 'hass') and entity_obj.hass is not None:
                    entity_obj.async_schedule_update_ha_state()
            # Note: No need to update hass.data - palettes list is already a shared reference
            # Save to persistent storage
            await async_save_data(hass)
            # Force PaletteSensor to update its state for instant frontend refresh
            palette_sensor = hass.data.get(DOMAIN, {}).get("palette_sensor_entity")
            if palette_sensor:
                write_state = getattr(palette_sensor, "async_write_ha_state", None)
                if write_state:
                    result = write_state()
                    if asyncio.iscoroutine(result):
                        await result

    hass.services.async_register(
        DOMAIN,
        "rename_palette",
        handle_rename_palette,
        schema=vol.Schema({
            vol.Required("idx"): cv.positive_int,
            vol.Required("name"): cv.string,
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
                _LOGGER.debug(f"[AUTO-TURN-ON] set_custom_text command ignored - lamp is off and auto-turn-on is disabled")
                return
            _LOGGER.debug(f"[SET_TEXT] Setting custom text to: '{text}' for entity {target_entity.entity_id}")
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
            _LOGGER.debug(f"[SET_TEXT] Display mode applied successfully for entity {target_entity.entity_id}")

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
                _LOGGER.debug(f"[AUTO-TURN-ON] set_angle command ignored - lamp is off and auto-turn-on is disabled")
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
                _LOGGER.debug(f"[AUTO-TURN-ON] Command ignored - lamp is off and auto-turn-on is disabled")
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
            vol.Required("text_colors", description="Array of RGB color arrays, e.g. [[255,0,0], [0,255,0]] for red to green gradient"): vol.All(list, [vol.All(list, [cv.positive_int])]),
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
            _LOGGER.error("No image_b64 provided to display_image service.")
            return

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
        except Exception as e:
            _LOGGER.error(f"Error processing image: {e}")
            return

        targets = _resolve_entities(service_call, "DISPLAY_IMAGE")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] display_image command ignored - lamp is off and auto-turn-on is disabled")
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
            vol.Required("image_b64"): cv.string,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )
    async def handle_set_mode(service_call):
        # Supports multi-entity parallel dispatch
        mode = service_call.data.get("mode")
        full_panel = service_call.data.get("full_panel")
        
        text_modes = [
            "Clock",
            "Native Effect",
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
            _LOGGER.error(f"[set_mode] Invalid mode: {mode}")
            return

        targets = _resolve_entities(service_call, "SET_MODE")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] set_mode command ignored - lamp is off and auto-turn-on is disabled")
                return
            if full_panel is not None:
                target_entity._full_panel = full_panel
                _LOGGER.debug(f"[set_mode] Also setting full_panel to {full_panel}")
            if mode in MATRIX_DISPLAY_MODES:
                target_entity._matrix_mode = mode
                target_entity._mode = mode
            if mode == "Custom Draw":
                target_entity._custom_draw_active = True
            elif mode in ("Clock", "Native Effect"):
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
            if mode == "Native Effect":
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
                "Clock",
                "Native Effect",
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
                f"[PANEL] [{getattr(target_entity, '_ip', '?')}] "
                f"Setting full_panel={full_panel} (was {target_entity._full_panel})"
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

    async def handle_remove_palette(service_call):
        try:
            if service_call is None:
                _LOGGER.error("[PALETTE-DELETE] service_call is None!")
                return
            
            if not hasattr(service_call, 'data'):
                _LOGGER.error(f"[PALETTE-DELETE] service_call has no 'data' attribute! Type: {type(service_call)}")
                return
            
            idx = service_call.data.get("idx")
        except Exception as e:
            _LOGGER.error(f"[PALETTE-DELETE] Error accessing service_call data: {e}", exc_info=True)
            return
        
        # Access palettes from global storage directly (not through entity property)
        if DOMAIN not in hass.data or "palettes_v2" not in hass.data[DOMAIN]:
            _LOGGER.error("[PALETTE-DELETE] No palettes storage found in hass.data")
            return
        
        palettes = hass.data[DOMAIN]["palettes_v2"]
        _LOGGER.debug(f"[PALETTE-DELETE] idx={idx} (type: {type(idx)}), palette count={len(palettes)}")
        
        # No duplicate detection - rapid successive deletions are valid
        # (indices shift after each deletion, so same idx can refer to different palettes)
        
        if isinstance(idx, int) and 0 <= idx < len(palettes):
            removed = palettes.pop(idx)
            _LOGGER.debug(f"[PALETTE-DELETE] Removed palette at idx {idx}: '{removed.get('name', 'Unnamed')}'")
            
            # Trigger state update for all entities that are ready
            for entity_id, entity in _ENTITY_REGISTRY.items():
                if entity.hass is not None:
                    entity.async_write_ha_state()
            
            # Fire event for sensor updates
            hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
            
            # Save to persistent storage
            await async_save_data(hass)
            _LOGGER.debug(f"[PALETTE-DELETE] Palette '{removed.get('name', 'Unnamed')}' deleted. Remaining: {len(palettes)}")
        else:
            _LOGGER.error(f"[PALETTE-DELETE] Invalid idx {idx} (palette count: {len(palettes)}, valid range: 0-{len(palettes)-1})")

    hass.services.async_register(
        DOMAIN,
        "remove_palette",
        handle_remove_palette,
        schema=vol.Schema({vol.Required("idx"): cv.positive_int})
    )
    
    async def handle_test_display(service_call):
        """Test service to manually trigger display mode application for debugging."""
        target_entity = _resolve_entity(service_call, "TEST_DISPLAY")
        if not target_entity:
            return
        
        _LOGGER.debug("[TEST] handle_test_display called")
        _LOGGER.debug(f"[TEST] Testing entity: {target_entity._attr_name}")
        _LOGGER.debug(f"[TEST] Current state - text: '{target_entity._custom_text}', mode: '{target_entity._mode}', is_on: {target_entity._is_on}")
        _LOGGER.debug(f"[TEST] Text colors: {target_entity._text_colors}")
        _LOGGER.debug(f"[TEST] Background color: {target_entity._background_color}")
        _LOGGER.debug(f"[TEST] Brightness: {target_entity._brightness}")
        _LOGGER.debug(f"[TEST] Alignment: {target_entity._alignment}")
        _LOGGER.debug(f"[TEST] Font: {target_entity._font}")
        _LOGGER.debug(f"[TEST] Connection status - has_error: {getattr(target_entity, '_connection_error', False)}, last_error: {getattr(target_entity, '_last_connection_error', 'None')}")
        
        # Force the light to be on and apply display mode.
        # Reset _fx_mode_is_direct so _apply_impl calls ensure_fx_ready()
        # to re-establish FX mode via raw TCP.
        target_entity._is_on = True
        target_entity._fx_mode_is_direct = False
        _LOGGER.debug("[TEST] About to call async_apply_display_mode...")
        await target_entity.async_apply_display_mode(update_type='color_change')
        _LOGGER.debug("[TEST] Display mode applied")
        
        # Report final connection status
        _LOGGER.debug(f"[TEST] After apply - connection_error: {getattr(target_entity, '_connection_error', False)}")

    hass.services.async_register(
        DOMAIN,
        "test_display",
        handle_test_display,
        schema=vol.Schema({
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        }),
        supports_response=False
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

    async def handle_set_color_accuracy(service_call):
        """Toggle hardware colour accuracy correction (per-channel gain).
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SET_COLOR_ACCURACY")
        if not targets:
            return

        enabled = bool(service_call.data.get("enabled", False))

        async def _apply_one(target_entity):
            target_entity._color_accuracy_enabled = enabled
            _LOGGER.debug(
                f"[COLOR_ACCURACY] [{target_entity._ip}] "
                f"Color accuracy {'enabled' if enabled else 'disabled'}"
            )
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            # Re-render the display with correction applied/removed
            target_entity._create_tracked_task(
                target_entity.async_apply_display_mode(),
                name=f"yeelight_cube_apply_color_accuracy_{target_entity._ip}"
            )

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_color_accuracy",
        handle_set_color_accuracy,
        schema=vol.Schema({
            vol.Required("enabled"): vol.Coerce(bool),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    # DEBUG: Color calibration service
    async def handle_set_color_calibration(service_call):
        """Set color correction / accuracy calibration values at runtime.
        All fields are optional -- only provided values are updated."""
        targets = _resolve_entities(service_call, "SET_COLOR_CALIBRATION")
        if not targets:
            return

        data = service_call.data
        mapping = {
            "gamma_r": "_calib_gamma_r",
            "gamma_g": "_calib_gamma_g",
            "gamma_b": "_calib_gamma_b",
            "hw_threshold": "_calib_hw_threshold",
            "hw_full": "_calib_hw_full",
            "channel_balance": "_calib_channel_balance",
            "gain_r": "_calib_gain_r",
            "gain_g": "_calib_gain_g",
            "gain_b": "_calib_gain_b",
            # System 3: Unified brightness curve
            "hw_floor": "_calib_hw_floor",
            "darken_floor": "_calib_darken_floor",
            "hw_curve": "_calib_hw_curve",
            "darken_curve": "_calib_darken_curve",
            "floor_r": "_calib_floor_r",
            "floor_g": "_calib_floor_g",
            "floor_b": "_calib_floor_b",
        }

        async def _apply_one(target_entity):
            changed = []
            for key, attr in mapping.items():
                if key in data:
                    old_val = getattr(target_entity, attr)
                    new_val = data[key]
                    setattr(target_entity, attr, new_val)
                    changed.append(f"{key}: {old_val} -> {new_val}")
            if changed:
                _LOGGER.info(
                    f"[CALIBRATION] [{target_entity._ip}] Updated: {', '.join(changed)}"
                )
                if target_entity.hass is not None:
                    target_entity.async_schedule_update_ha_state()
                # Re-render so new calibration takes effect immediately
                target_entity._create_tracked_task(
                    target_entity.async_apply_display_mode(),
                    name=f"yeelight_cube_apply_calibration_{target_entity._ip}"
                )

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_color_calibration",
        handle_set_color_calibration,
        schema=vol.Schema({
            vol.Optional("gamma_r"): vol.Coerce(float),
            vol.Optional("gamma_g"): vol.Coerce(float),
            vol.Optional("gamma_b"): vol.Coerce(float),
            vol.Optional("hw_threshold"): vol.Coerce(int),
            vol.Optional("hw_full"): vol.Coerce(int),
            vol.Optional("channel_balance"): vol.Coerce(float),
            vol.Optional("gain_r"): vol.Coerce(float),
            vol.Optional("gain_g"): vol.Coerce(float),
            vol.Optional("gain_b"): vol.Coerce(float),
            # System 3: Unified brightness curve
            vol.Optional("hw_floor"): vol.Coerce(int),
            vol.Optional("darken_floor"): vol.Coerce(int),
            vol.Optional("hw_curve"): vol.Coerce(float),
            vol.Optional("darken_curve"): vol.Coerce(float),
            vol.Optional("floor_r"): vol.Coerce(int),
            vol.Optional("floor_g"): vol.Coerce(int),
            vol.Optional("floor_b"): vol.Coerce(int),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_set_calibration_lock(service_call):
        """Take/release exclusive control of the lamp for the calibration wizard.
        While locked, the lamp ignores display/brightness/turn_on commands that
        don't carry bypass_lock=True (i.e. everything except the wizard itself),
        so automations can't disturb the calibration session."""
        targets = _resolve_entities(service_call, "SET_CALIBRATION_LOCK")
        if not targets:
            return
        enabled = bool(service_call.data.get("enabled", False))

        async def _apply_one(target_entity):
            target_entity._set_calibration_lock(enabled)

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_calibration_lock",
        handle_set_calibration_lock,
        schema=vol.Schema({
            vol.Required("enabled"): vol.Coerce(bool),
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
            _LOGGER.debug(f"[SAVE_STATE] Saved display state for {target_entity.entity_id}")

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
                    f"[RESTORE_STATE] No saved state for {target_entity.entity_id} -- "
                    f"call save_state first"
                )
                return
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='color_change')
            _LOGGER.debug(f"[RESTORE_STATE] Restored display state for {target_entity.entity_id}")

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "restore_state",
        handle_restore_state,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_set_button_effects(service_call):
        """Set the ordered native-effect list cycled by the physical button."""
        targets = _resolve_entities(service_call, "SET_BUTTON_EFFECTS")
        if not targets:
            return
        effect_names = service_call.data["effects"]
        results = await asyncio.gather(
            *(
                target._execute_hardware_op(
                    lambda target=target: target.async_set_button_effects(
                        effect_names
                    ),
                    "set_button_effects",
                )
                for target in targets
            )
        )
        if not all(results):
            raise HomeAssistantError(
                "One or more Cube Lite devices did not accept the button presets"
            )

    button_effect_options = list(NATIVE_EFFECTS) + [
        f"Clock: {style['name']}" for style in NATIVE_CLOCK_STYLES.values()
    ]
    hass.services.async_register(
        DOMAIN,
        "set_button_effects",
        handle_set_button_effects,
        schema=vol.Schema({
            vol.Required("effects"): vol.All(
                [vol.In(button_effect_options)],
                vol.Length(min=1, max=8),
            ),
            vol.Required("entity_id"): _entity_id_or_list,
        }),
    )
    return True


def async_remove_light_services(hass: HomeAssistant) -> None:
    """Remove component-level entity-facing actions."""
    for service_name in LIGHT_SERVICE_NAMES:
        if hass.services.has_service(DOMAIN, service_name):
            hass.services.async_remove(DOMAIN, service_name)
