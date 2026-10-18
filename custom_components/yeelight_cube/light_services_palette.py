"""Color palette actions: load, save, rename, move, remove and bulk set/add.

Registered by :func:`light_services.async_setup_light_services`.
"""
import logging
import time

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .const import DOMAIN
from .name_utils import normalize_display_name
from .storage import async_collection_changed, collection
from .light import _entity_id_or_list
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
    make_lamp_runner,
)

_LOGGER = logging.getLogger(__name__)

# Seconds within which the same palette saved again is a repeated click.
DUPLICATE_SAVE_WINDOW = 2.0


def async_register_palette_services(hass: HomeAssistant) -> None:
    """Register the palette actions."""
    run_on_lamps = make_lamp_runner(hass)
    # The last palette saved (its name and colors) and when: the same save
    # again within DUPLICATE_SAVE_WINDOW (a double click on a card's Save) is
    # not stored twice. Another palette, or the same one later, always is.
    last_save = {"key": None, "at": 0.0}

    async def handle_load_palette(service_call):
        idx = service_call.data.get("idx")
        _LOGGER.debug("[LOAD_PALETTE] Called: idx=%s, entity_id=%s", idx, service_call.data.get("entity_id"))
        palette = _locate_item(
            collection(hass, "palettes_v2"), idx, service_call.data.get("expected_name"), "palette"
        )

        targets = _resolve_entities(service_call, "LOAD_PALETTE")

        async def _apply_one(target_entity):
            # Copy as tuples (like every other color setter): sharing the
            # stored list would let later color edits change the saved palette.
            target_entity._text_colors = [tuple(c) for c in palette["colors"]]
            if target_entity._text_colors:
                target_entity._rgb_color = target_entity._text_colors[0]
            # (Panel Color Sequence included: the display render colors it.)
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            # Push the updated state so consumers watching the `text_colors`
            # attribute (e.g. the gradient card's live preview) refresh
            # immediately.  Without this the new colors are only exposed on the
            # next unrelated state write (e.g. an angle change), which is why the
            # preview appeared stale until the user moved the angle wheel.
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            _LOGGER.debug("[palette-backend] Applied palette idx %s to %s", idx, target_entity._ip)

        run_on_lamps("LOAD_PALETTE", targets, _apply_one)

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
        palettes = collection(hass, "palettes_v2")
        _check_collection_size(
            len(palettes), len(service_call.data["palettes"]), MAX_PALETTES, "palette"
        )
        added = _clean_palettes(service_call.data["palettes"], len(palettes))
        if not added:
            return
        palettes.extend(added)
        await async_collection_changed(hass, "palettes_v2")

    async def handle_set_palettes(service_call):
        """Replace the whole palette list (an import). Replaced in place: the
        list stays the one the storage and sensors hold."""
        palettes = collection(hass, "palettes_v2")
        palettes[:] = _clean_palettes(service_call.data["palettes"])
        await async_collection_changed(hass, "palettes_v2")

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
        # Saved for a lamp's call only (refused otherwise).
        _resolve_entity(service_call, "SAVE_PALETTE")
        palettes = collection(hass, "palettes_v2")
        _check_collection_size(len(palettes), 1, MAX_PALETTES, "palette")
        name = normalize_display_name(
            service_call.data.get("name") or "", f"Palette {len(palettes) + 1}"
        )
        colors = [tuple(c) for c in service_call.data["palette"]]
        key, now = (name, tuple(colors)), time.monotonic()
        if last_save["key"] == key and now - last_save["at"] < DUPLICATE_SAVE_WINDOW:
            _LOGGER.debug("[SAVE_PALETTE] '%s' just saved: not stored twice", name)
            return
        last_save.update(key=key, at=now)
        # Duplicate colors under another name are allowed.
        palettes.append({"name": name, "colors": colors})
        await async_collection_changed(hass, "palettes_v2")
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
        palettes = collection(hass, "palettes_v2")
        _locate_item(
            palettes, idx, service_call.data.get("expected_name"), "palette"
        )
        palettes[idx]["name"] = normalize_display_name(new_name, f"Palette {idx + 1}")
        # The sensor and the palette selects (which show the names) follow.
        await async_collection_changed(hass, "palettes_v2")

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
        palettes = collection(hass, "palettes_v2")
        if not _move_item(
            palettes,
            service_call.data["from_idx"],
            service_call.data["to_idx"],
            service_call.data.get("expected_name"),
            "palette",
        ):
            return
        # The palette sensor and the palette selects follow the new order.
        await async_collection_changed(hass, "palettes_v2")

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
        idx = service_call.data.get("idx")
        palettes = collection(hass, "palettes_v2")
        _LOGGER.debug("[PALETTE-DELETE] idx=%s (type: %s), palette count=%s", idx, type(idx), len(palettes))
        
        # No duplicate detection - rapid successive deletions are valid
        # (indices shift after each deletion, so same idx can refer to different palettes)
        
        _locate_item(
            palettes, idx, service_call.data.get("expected_name"), "palette"
        )
        removed = palettes.pop(idx)
        _LOGGER.debug("[PALETTE-DELETE] Removed palette at idx %s: '%s'", idx, removed.get('name', 'Unnamed'))
        
        await async_collection_changed(hass, "palettes_v2")
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
