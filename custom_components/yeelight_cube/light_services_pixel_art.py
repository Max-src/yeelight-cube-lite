"""Pixel-art actions: get, save, rename, move, remove, apply, bulk update and
the ``yeelight_cube/ws_get_pixel_art_v2`` websocket command.

Registered by :func:`light_services.async_setup_light_services`.
"""
import logging

import voluptuous as vol  # type: ignore
from homeassistant.components import websocket_api  # type: ignore
from homeassistant.core import HomeAssistant, SupportsResponse  # type: ignore
from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from . import async_save_data
from .const import DOMAIN
from .name_utils import normalize_display_name
from .pixel_art_storage import expand_pixels, group_pixels
from .light import _entity_id_or_list
from .light_services_common import (
    MAX_PIXEL_ARTS,
    NAME_SCHEMA,
    PIXEL_LIST_SCHEMA,
    PIXEL_ART_LIST_SCHEMA,
    _check_collection_size,
    _resolve_entities,
    _locate_item,
    make_fire_and_forget,
)

_LOGGER = logging.getLogger(__name__)


def async_register_pixel_art_services(hass: HomeAssistant) -> None:
    """Register the pixel art actions."""
    _fire_and_forget = make_fire_and_forget(hass)

    async def handle_update_pixel_arts(service_call):
        """Update the pixel art collection — append (default) or fully replace."""
        pixel_arts = service_call.data.get("pixel_arts")
        replace = service_call.data.get("replace", False)
        if not isinstance(pixel_arts, list):
            _LOGGER.error("update_pixel_arts expects a list of pixel art dicts")
            return
        
        # The schema has already validated every art, pixel and colour.
        existing_count = len(hass.data.get(DOMAIN, {}).get("pixel_arts", []))
        if not replace:
            _check_collection_size(
                existing_count, len(pixel_arts), MAX_PIXEL_ARTS, "pixel art"
            )
        offset = 0 if replace else existing_count
        valid_pixel_arts = [
            {
                "name": normalize_display_name(
                    art.get("name") or "", f"Pixel Art {offset + index + 1}"
                ),
                "pixels": group_pixels(art["pixels"]),
            }
            for index, art in enumerate(pixel_arts)
        ]

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
        pixels = group_pixels(pixels)
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        if "pixel_arts" not in hass.data[DOMAIN]:
            hass.data[DOMAIN]["pixel_arts"] = []
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        _check_collection_size(len(pixel_arts), 1, MAX_PIXEL_ARTS, "pixel art")
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
        _locate_item(
            pixel_arts, idx, service_call.data.get("expected_name"), "Pixel art"
        )
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

    async def handle_move_pixel_art(service_call):
        """Move one saved pixel art, keeping items other clients added meanwhile."""
        pixel_arts = hass.data.get(DOMAIN, {}).get("pixel_arts", [])
        from_idx = service_call.data["from_idx"]
        to_idx = service_call.data["to_idx"]
        _locate_item(
            pixel_arts, from_idx, service_call.data.get("expected_name"), "Pixel art"
        )
        if not 0 <= to_idx < len(pixel_arts):
            raise HomeAssistantError(
                f"Pixel art position {to_idx} is out of range. Refresh and try again."
            )
        if from_idx == to_idx:
            return
        pixel_arts.insert(to_idx, pixel_arts.pop(from_idx))
        hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(pixel_arts)})
        await async_save_data(hass)

    async def handle_rename_pixel_art(service_call):
        idx = service_call.data.get("idx")
        new_name = service_call.data.get("name")
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data or "pixel_arts" not in hass.data[DOMAIN]:
            _LOGGER.error("[pixelart-backend] No pixel arts to rename")
            return
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        _locate_item(
            pixel_arts, idx, service_call.data.get("expected_name"), "Pixel art"
        )
        if isinstance(new_name, str):
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
        _locate_item(
            hass.data.get(DOMAIN, {}).get("pixel_arts", []),
            idx,
            service_call.data.get("expected_name"),
            "Pixel art",
        )

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
            target_entity._custom_pixels = expand_pixels(art["pixels"])
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
            target_entity._custom_pixels = expand_pixels(pixels)
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
            expand_pixels(art.get("pixels", [])),
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
            vol.Required("pixels"): PIXEL_LIST_SCHEMA,
            vol.Optional("name"): NAME_SCHEMA,
        }, extra=vol.ALLOW_EXTRA)
    )

    hass.services.async_register(
        DOMAIN,
        "remove_pixel_art",
        handle_remove_pixel_art,
        schema=vol.Schema({
            vol.Required("idx"): vol.All(int, vol.Range(min=0)),
            vol.Optional("expected_name"): vol.Any(None, cv.string),
        }, extra=vol.ALLOW_EXTRA)
    )

    hass.services.async_register(
        DOMAIN,
        "rename_pixel_art",
        handle_rename_pixel_art,
        schema=vol.Schema({
            vol.Required("idx"): vol.All(int, vol.Range(min=0)),
            vol.Required("name"): NAME_SCHEMA,
            vol.Optional("expected_name"): vol.Any(None, cv.string),
        }, extra=vol.ALLOW_EXTRA)
    )

    hass.services.async_register(
        DOMAIN,
        "apply_pixel_art",
        handle_apply_pixel_art,
        schema=vol.Schema({
            vol.Required("idx"): vol.All(int, vol.Range(min=0)),
            vol.Optional("expected_name"): vol.Any(None, cv.string),
            vol.Required("entity_id"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )

    hass.services.async_register(
        DOMAIN,
        "apply_custom_pixels",
        handle_apply_custom_pixels,
        schema=vol.Schema({
            vol.Required("pixels", description="Array of {position, color} entries for the 20x5 matrix (position 0-99 or a list of positions, color [R, G, B]); missing positions stay black"): PIXEL_LIST_SCHEMA,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )

    hass.services.async_register(
        DOMAIN,
        "move_pixel_art",
        handle_move_pixel_art,
        schema=vol.Schema({
            vol.Required("from_idx"): vol.All(int, vol.Range(min=0)),
            vol.Required("to_idx"): vol.All(int, vol.Range(min=0)),
            vol.Optional("expected_name"): vol.Any(None, cv.string),
        }),
    )

    hass.services.async_register(
        DOMAIN,
        "update_pixel_arts",
        handle_update_pixel_arts,
        schema=vol.Schema({
            vol.Required("pixel_arts"): PIXEL_ART_LIST_SCHEMA,
            vol.Optional("replace", default=False): bool,
        }, extra=vol.ALLOW_EXTRA)
    )
