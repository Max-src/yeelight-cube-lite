"""Pixel-art actions: get, save, rename, move, remove, apply, bulk update and
the ``yeelight_cube/ws_get_pixel_art_v2`` and ``yeelight_cube/builtin_pixel_arts``
websocket commands.

Registered by :func:`light_services.async_setup_light_services`.
"""
import logging

import voluptuous as vol  # type: ignore
from homeassistant.components import websocket_api  # type: ignore
from homeassistant.core import HomeAssistant, SupportsResponse, callback  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .builtin_pixel_art import find_pixel_art, get_builtin_pixel_arts
from .const import DOMAIN
from .name_utils import normalize_display_name
from .pixel_art_storage import PIXEL_ART_HORIZONTAL, expand_pixels, stored_pixel_art
from .light import _entity_id_or_list
from .errors import invalid
from .storage import async_collection_changed, collection
from .light_services_common import (
    MAX_PIXEL_ARTS,
    NAME_SCHEMA,
    PIXEL_LIST_SCHEMA,
    PIXEL_ART_LIST_SCHEMA,
    PIXEL_ART_ORIENTATION_SCHEMA,
    _check_collection_size,
    _resolve_entities,
    _locate_item,
    _move_item,
    make_lamp_runner,
)

_LOGGER = logging.getLogger(__name__)


def async_register_pixel_art_services(hass: HomeAssistant) -> None:
    """Register the pixel art actions."""
    run_on_lamps = make_lamp_runner(hass)

    async def handle_update_pixel_arts(service_call):
        """Update the pixel art collection — append (default) or fully replace."""
        pixel_arts = service_call.data.get("pixel_arts")
        replace = service_call.data.get("replace", False)
        
        # The schema has already validated every art, pixel and color.
        pixel_arts_saved = collection(hass, "pixel_arts")
        existing_count = len(pixel_arts_saved)
        if not replace:
            _check_collection_size(
                existing_count, len(pixel_arts), MAX_PIXEL_ARTS, "pixel_art"
            )
        offset = 0 if replace else existing_count
        valid_pixel_arts = [
            stored_pixel_art(
                normalize_display_name(
                    art.get("name") or "", f"Pixel Art {offset + index + 1}"
                ),
                art["pixels"],
                art.get("orientation"),
            )
            for index, art in enumerate(pixel_arts)
        ]

        # In place: the list the storage and the sensor hold.
        if replace:
            pixel_arts_saved[:] = valid_pixel_arts
        else:
            pixel_arts_saved.extend(valid_pixel_arts)
        await async_collection_changed(hass, "pixel_arts")

        mode = "replace" if replace else "append"
        total = len(pixel_arts_saved)
        _LOGGER.debug("[pixelart-backend] update_pixel_arts (%s): %s items provided, %s total in collection.", mode, len(valid_pixel_arts), total)

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
            _LOGGER.error("[pixelart-debug] Exception in ws_get_pixel_art_v2: %s", e)

    websocket_api.async_register_command(hass, ws_get_pixel_art_v2)

    @websocket_api.websocket_command({"type": "yeelight_cube/builtin_pixel_arts"})
    @callback
    def ws_builtin_pixel_arts(hass, connection, msg):
        """The official app's pixel arts (read-only, never change while the
        integration runs): fetched once by the cards, not carried by a state."""
        connection.send_result(msg["id"], {"pixel_arts": list(get_builtin_pixel_arts())})

    websocket_api.async_register_command(hass, ws_builtin_pixel_arts)

    # NOTE: Entity is already created and registered at the top of this function.
    # Do NOT create a second CubeMatrix/YeelightCubeLight here.

    # --- Pixel Art Service Handlers ---
    async def handle_save_pixel_art(service_call):
        pixel_arts = collection(hass, "pixel_arts")
        _check_collection_size(len(pixel_arts), 1, MAX_PIXEL_ARTS, "pixel_art")
        default_name = f"Pixel Art {len(pixel_arts) + 1}"
        # Grouped by color, black pixels left out (stored_pixel_art).
        art = stored_pixel_art(
            normalize_display_name(service_call.data.get("name") or default_name, default_name),
            service_call.data.get("pixels"),
            service_call.data.get("orientation"),
        )
        pixel_arts.append(art)
        await async_collection_changed(hass, "pixel_arts")

        _LOGGER.debug("[PIXELART-SAVE] Saved '%s' with %s colors, new count: %s", art["name"], len(art["pixels"]), len(pixel_arts))

    async def handle_remove_pixel_art(service_call):
        idx = service_call.data.get("idx")
        _LOGGER.debug("[PIXELART-DELETE] Service called with idx=%s", idx)
        
        # No duplicate detection - rapid successive deletions are valid
        # (indices shift after each deletion, so same idx can refer to different pixel arts)
        
        pixel_arts = collection(hass, "pixel_arts")
        _LOGGER.debug("[PIXELART-DELETE] Current pixel art count=%s", len(pixel_arts))
        _locate_item(
            pixel_arts, idx, service_call.data.get("expected_name"), "pixel_art"
        )
        removed = pixel_arts.pop(idx)
        _LOGGER.debug("[PIXELART-DELETE] Deleted pixel art at idx %s: %s", idx, removed.get('name', 'Unnamed'))
        
        await async_collection_changed(hass, "pixel_arts")
        _LOGGER.debug("[PIXELART-DELETE] Saved. New pixel art count: %s", len(pixel_arts))

    async def handle_move_pixel_art(service_call):
        """Move one saved pixel art, keeping items other clients added meanwhile."""
        pixel_arts = collection(hass, "pixel_arts")
        if not _move_item(
            pixel_arts,
            service_call.data["from_idx"],
            service_call.data["to_idx"],
            service_call.data.get("expected_name"),
            "pixel_art",
        ):
            return
        await async_collection_changed(hass, "pixel_arts")

    async def handle_rename_pixel_art(service_call):
        idx = service_call.data.get("idx")
        new_name = service_call.data.get("name")
        
        pixel_arts = collection(hass, "pixel_arts")
        _locate_item(
            pixel_arts, idx, service_call.data.get("expected_name"), "pixel_art"
        )
        if isinstance(new_name, str):
            new_name = normalize_display_name(new_name, f"Pixel Art {idx + 1}")
            pixel_arts[idx]["name"] = new_name
            
            await async_collection_changed(hass, "pixel_arts")
            
            _LOGGER.debug("[PIXELART-RENAME] Renamed idx %s to '%s'", idx, new_name)

    async def handle_apply_pixel_art(service_call):
        """Show a pixel art on the lamps: a saved one by ``idx`` (with its
        ``expected_name`` check), or a saved or built-in one by ``name``."""
        idx = service_call.data.get("idx")
        name = service_call.data.get("name")
        if (idx is None) == (name is None):
            raise invalid("pixel_art_idx_or_name")
        targets = _resolve_entities(service_call, "APPLY_PIXEL_ART")
        saved = hass.data.get(DOMAIN, {}).get("pixel_arts", [])
        if name is None:
            art = _locate_item(saved, idx, service_call.data.get("expected_name"), "pixel_art")
            name = art.get("name", f"Pixel Art {idx + 1}")
        else:
            art = find_pixel_art(saved, name)
            if art is None:
                raise invalid("pixel_art_not_found", name=name)
        if not (isinstance(art, dict) and isinstance(art.get("pixels"), list) and art["pixels"]):
            raise invalid("pixel_art_empty", name=name)
        pixels = art["pixels"]

        async def _apply_one(target_entity):
            await target_entity.show_pixel_art(name, pixels)
            _LOGGER.debug("[pixelart-backend] Applied pixel art '%s' to %s.", name, target_entity._ip)

        run_on_lamps("APPLY_PIXEL_ART", targets, _apply_one)

    async def handle_apply_custom_pixels(service_call):
        pixels = service_call.data.get("pixels")
        bypass_lock = bool(service_call.data.get("bypass_lock", False))
        _LOGGER.debug("[pixelart-backend] apply_custom_pixels: pixels=%s", len(pixels) if pixels else 0)
        if not pixels:
            raise invalid("pixels_required")

        targets = _resolve_entities(service_call, "APPLY_CUSTOM_PIXELS")

        # The pixel art these pixels are (the Draw card names the one picked
        # in its gallery), so the Pixel Art select and save/restore_state
        # follow; none: a drawing of its own, the select is cleared.
        name = service_call.data.get("name") or None

        async def _apply_one(target_entity):
            await target_entity.show_pixel_art(name, pixels, bypass_lock=bypass_lock)

        run_on_lamps("APPLY_CUSTOM_PIXELS", targets, _apply_one)

    async def handle_get_pixel_art(service_call):
        idx = service_call.data.get("idx")
        group_by_color = service_call.data.get("group_by_color", False)
        art = _locate_item(collection(hass, "pixel_arts"), idx, None, "pixel_art")
        # Internal storage is already in grouped {color, positions} format;
        # else flat [{position, color}] sorted by position.
        pixels = (
            art.get("pixels", [])
            if group_by_color
            else sorted(expand_pixels(art.get("pixels", [])), key=lambda px: px["position"])
        )
        return {
            "name": art.get("name", "Unnamed"),
            "orientation": art.get("orientation", PIXEL_ART_HORIZONTAL),
            "pixels": pixels,
        }

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
            vol.Optional("orientation"): PIXEL_ART_ORIENTATION_SCHEMA,
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
            vol.Optional("idx"): vol.All(int, vol.Range(min=0)),
            vol.Optional("name"): cv.string,
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
            vol.Optional("name"): vol.Any(None, cv.string),
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
