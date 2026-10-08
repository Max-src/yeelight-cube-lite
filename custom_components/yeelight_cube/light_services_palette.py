"""Color palette actions: load, save, rename, move, remove and bulk set/add.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio
import logging

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from . import async_save_data
from .color_utils import rgb_to_hex
from .const import DOMAIN
from .name_utils import normalize_display_name
from .light import _ENTITY_REGISTRY, _entity_id_or_list
from .light_services_common import (
    MAX_PALETTES,
    COLOR_LIST_SCHEMA,
    NAME_SCHEMA,
    PALETTE_LIST_SCHEMA,
    _check_collection_size,
    _resolve_entity,
    _resolve_entities,
    _locate_item,
    _move_item,
    make_fire_and_forget,
)

_LOGGER = logging.getLogger(__name__)


def async_register_palette_services(hass: HomeAssistant) -> None:
    """Register the palette actions."""
    _fire_and_forget = make_fire_and_forget(hass)
    # The last palette saved, so a save repeated for every target of a
    # multi-lamp card is only stored once.
    _deletion_tracker = {"last_palette_save": None}

    async def handle_load_palette(service_call):
        try:
            if service_call is None:
                _LOGGER.error("[LOAD_PALETTE] service_call is None!")
                return
            
            if not hasattr(service_call, 'data'):
                _LOGGER.error("[LOAD_PALETTE] service_call has no 'data' attribute! Type: %s", type(service_call))
                return
            
            idx = service_call.data.get("idx")
            entity_id = service_call.data.get("entity_id")
            
            _LOGGER.debug("[LOAD_PALETTE] Called: idx=%s, entity_id=%s", idx, entity_id)
        except Exception as e:
            _LOGGER.error("[LOAD_PALETTE] Error at start: %s", e, exc_info=True)
            return
        
        # Access palettes from global storage (not entity property) to avoid hass.data issues
        if DOMAIN not in hass.data or "palettes_v2" not in hass.data[DOMAIN]:
            _LOGGER.error("[LOAD_PALETTE] No palettes storage found in hass.data")
            return
        
        palettes = hass.data[DOMAIN]["palettes_v2"]
        palette = _locate_item(
            palettes, idx, service_call.data.get("expected_name"), "Palette"
        )

        if not (isinstance(palette, dict) and "colors" in palette and isinstance(palette["colors"], list)):
            _LOGGER.error("[LOAD_PALETTE] No valid colors for idx %s", idx)
            return

        targets = _resolve_entities(service_call, "LOAD_PALETTE")
        if not targets:
            return

        async def _apply_one(target_entity):
            # Copy as tuples (like every other color setter): sharing the
            # stored list would let later color edits change the saved palette.
            target_entity._text_colors = [tuple(c) for c in palette["colors"]]
            if target_entity._text_colors:
                target_entity._rgb_color = target_entity._text_colors[0]
            if target_entity._mode == "Panel Color Sequence":
                colors = target_entity._text_colors
                for i, module in enumerate(target_entity._layout.device_layout):
                    color = colors[i % len(colors)]
                    hex_color = rgb_to_hex(tuple(color))
                    module.set_colors([hex_color])
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            # Push the updated state so consumers watching the `text_colors`
            # attribute (e.g. the gradient card's live preview) refresh
            # immediately.  Without this the new colors are only exposed on the
            # next unrelated state write (e.g. an angle change), which is why the
            # preview appeared stale until the user moved the angle wheel.
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            _LOGGER.debug("[palette-backend] Applied palette idx %s to %s", idx, target_entity._ip)

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "load_palette",
        handle_load_palette,
        schema=vol.Schema({
            vol.Required("idx"): cv.positive_int,
            vol.Optional("expected_name"): vol.Any(None, cv.string),
            vol.Required("entity_id"): _entity_id_or_list
        })
    )

    # Note: handle_remove_palette is defined later in the file (after handle_set_full_panel)
    # to avoid duplicate service registration
    
    def _clean_palettes(palettes, offset=0):
        """Keep well-formed palettes, normalising names (``Palette N`` fallback)."""
        valid_palettes = []
        for pal in palettes:
            if (
                isinstance(pal, dict)
                and "colors" in pal
                and isinstance(pal["colors"], list)
                and all(isinstance(c, (list, tuple)) and len(c) == 3 for c in pal["colors"])
            ):
                valid_palettes.append({
                    "name": normalize_display_name(
                        pal.get("name") or "",
                        f"Palette {offset + len(valid_palettes) + 1}",
                    ),
                    "colors": [tuple(c) for c in pal["colors"]],
                })
        return valid_palettes

    async def handle_add_palettes(service_call):
        """Append palettes without resending (and so overwriting) the whole list."""
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        palettes = hass.data[DOMAIN].setdefault("palettes_v2", [])
        _check_collection_size(
            len(palettes), len(service_call.data["palettes"]), MAX_PALETTES, "palette"
        )
        added = _clean_palettes(service_call.data["palettes"], len(palettes))
        if not added:
            return
        palettes.extend(added)
        for entity_obj in _ENTITY_REGISTRY.values():
            if getattr(entity_obj, "hass", None) is not None:
                entity_obj.async_schedule_update_ha_state()
        hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
        await async_save_data(hass)

    async def handle_set_palettes(service_call):
        palettes = service_call.data.get("palettes_v2") or service_call.data.get("palettes")
        if palettes and isinstance(palettes, list):
            valid_palettes = _clean_palettes(palettes)
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
            vol.Required("palettes"): PALETTE_LIST_SCHEMA,
        })
    )

    hass.services.async_register(
        DOMAIN,
        "add_palettes",
        handle_add_palettes,
        schema=vol.Schema({
            vol.Required("palettes"): PALETTE_LIST_SCHEMA,
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
        _check_collection_size(len(palettes), 1, MAX_PALETTES, "palette")

        # Generate default name if not provided
        if not name:
            name = f"Palette {len(palettes)+1}"
        name = normalize_display_name(name, f"Palette {len(palettes) + 1}")
        
        # Create a deduplication key based on palette colors and name
        palette_key = f"save_{name}_{len(palette) if palette else 0}"
        if _deletion_tracker["last_palette_save"] == palette_key:
            _LOGGER.debug("[SAVE_PALETTE] DUPLICATE CALL DETECTED - skipping save of '%s' (already saved)", name)
            return
        
        _LOGGER.debug("[SAVE_PALETTE] Received entity_id: %s, palette length: %s, name: %s", entity_id, len(palette) if palette else 0, name)
        
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
            _LOGGER.debug("[SAVE_PALETTE] Palette appended to storage. New count: %s", len(palettes))
            _LOGGER.debug("[SAVE_PALETTE] Last 3 palette names in storage: %s", [p.get('name', 'unnamed') for p in palettes[-3:]])
            
            # Trigger state update for all entities that are ready
            for ip, entity in _ENTITY_REGISTRY.items():
                if entity.hass is not None:  # Only update entities that are fully initialized
                    entity.async_write_ha_state()
            
            # Fire event for sensor updates
            _LOGGER.debug("[SAVE_PALETTE] Firing palettes_updated event with count=%s", len(palettes))
            hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
            
            # Save to persistent storage
            await async_save_data(hass)
            _LOGGER.debug("[SAVE_PALETTE] Palette '%s' saved. Total palettes: %s", name, len(palettes))

    hass.services.async_register(
        DOMAIN,
        "save_palette",
        handle_save_palette,
        schema=vol.Schema({
            vol.Required("palette"): COLOR_LIST_SCHEMA,
            vol.Optional("name"): NAME_SCHEMA,
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_rename_palette(service_call):
        idx = service_call.data.get("idx")
        new_name = service_call.data.get("name")
        # Access global palette storage directly
        palettes = hass.data.get(DOMAIN, {}).get("palettes_v2", [])
        _locate_item(
            palettes, idx, service_call.data.get("expected_name"), "Palette"
        )
        if isinstance(new_name, str):
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
            vol.Required("name"): NAME_SCHEMA,
            vol.Optional("expected_name"): vol.Any(None, cv.string),
        })
    )

    async def handle_move_palette(service_call):
        """Move one saved palette, keeping palettes other clients added meanwhile."""
        palettes = hass.data.get(DOMAIN, {}).get("palettes_v2", [])
        if not _move_item(
            palettes,
            service_call.data["from_idx"],
            service_call.data["to_idx"],
            service_call.data.get("expected_name"),
            "Palette",
        ):
            return
        # The same refresh as a removal: lamp states, the palette sensor
        # and the palette select follow the new order.
        for entity in _ENTITY_REGISTRY.values():
            if entity.hass is not None:
                entity.async_write_ha_state()
        hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
        await async_save_data(hass)

    hass.services.async_register(
        DOMAIN,
        "move_palette",
        handle_move_palette,
        schema=vol.Schema({
            vol.Required("from_idx"): vol.All(int, vol.Range(min=0)),
            vol.Required("to_idx"): vol.All(int, vol.Range(min=0)),
            vol.Optional("expected_name"): vol.Any(None, cv.string),
        }),
    )

    async def handle_remove_palette(service_call):
        try:
            if service_call is None:
                _LOGGER.error("[PALETTE-DELETE] service_call is None!")
                return
            
            if not hasattr(service_call, 'data'):
                _LOGGER.error("[PALETTE-DELETE] service_call has no 'data' attribute! Type: %s", type(service_call))
                return
            
            idx = service_call.data.get("idx")
        except Exception as e:
            _LOGGER.error("[PALETTE-DELETE] Error accessing service_call data: %s", e, exc_info=True)
            return
        
        # Access palettes from global storage directly (not through entity property)
        if DOMAIN not in hass.data or "palettes_v2" not in hass.data[DOMAIN]:
            _LOGGER.error("[PALETTE-DELETE] No palettes storage found in hass.data")
            return
        
        palettes = hass.data[DOMAIN]["palettes_v2"]
        _LOGGER.debug("[PALETTE-DELETE] idx=%s (type: %s), palette count=%s", idx, type(idx), len(palettes))
        
        # No duplicate detection - rapid successive deletions are valid
        # (indices shift after each deletion, so same idx can refer to different palettes)
        
        _locate_item(
            palettes, idx, service_call.data.get("expected_name"), "Palette"
        )
        removed = palettes.pop(idx)
        _LOGGER.debug("[PALETTE-DELETE] Removed palette at idx %s: '%s'", idx, removed.get('name', 'Unnamed'))
        
        # Trigger state update for all entities that are ready
        for entity_id, entity in _ENTITY_REGISTRY.items():
            if entity.hass is not None:
                entity.async_write_ha_state()
        
        # Fire event for sensor updates
        hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
        
        # Save to persistent storage
        await async_save_data(hass)
        _LOGGER.debug("[PALETTE-DELETE] Palette '%s' deleted. Remaining: %s", removed.get('name', 'Unnamed'), len(palettes))

    hass.services.async_register(
        DOMAIN,
        "remove_palette",
        handle_remove_palette,
        schema=vol.Schema({
            vol.Required("idx"): cv.positive_int,
            vol.Optional("expected_name"): vol.Any(None, cv.string),
        })
    )
