"""Shared helpers, limits and schemas for the entity-facing actions.

Used by the ``light_services_<area>`` modules, which register the actions
(see :func:`light_services.async_setup_light_services`).
"""
import asyncio
import functools
import logging

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import (  # type: ignore
    HomeAssistantError,
    Unauthorized,
    UnknownUser,
)
from homeassistant.helpers import config_validation as cv  # type: ignore

from .name_utils import normalize_display_name
from .light import _ENTITY_REGISTRY
from .light_rotation import MAX_FAVOURITE_NAME, MAX_FAVOURITES

_LOGGER = logging.getLogger(__name__)

# Limits for user-supplied collections. Every client (cards, automations,
# imported files) goes through these schemas, so bad or oversized data is
# rejected up front instead of being stored and breaking a later render.
MAX_COLORS = 100
MAX_PALETTES = 500
MAX_PIXEL_ARTS = 500
MAX_PIXEL_ENTRIES = 1000
MAX_NAME_LENGTH = 100

RGB_SCHEMA = vol.All(
    vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple)
)
COLOR_LIST_SCHEMA = vol.All([RGB_SCHEMA], vol.Length(min=1, max=MAX_COLORS))
NAME_SCHEMA = vol.All(cv.string, vol.Length(max=MAX_NAME_LENGTH))
# Stored/exported names may be missing or null; they fall back to "Palette N"
# / "Pixel Art N".
OPTIONAL_NAME_SCHEMA = vol.Any(None, NAME_SCHEMA)
_POSITION_LIST = vol.All([cv.positive_int], vol.Length(max=MAX_PIXEL_ENTRIES))
PIXEL_ENTRY_SCHEMA = vol.Any(
    vol.Schema(
        {
            vol.Required("position"): vol.Any(cv.positive_int, _POSITION_LIST),
            vol.Required("color"): RGB_SCHEMA,
        },
        extra=vol.REMOVE_EXTRA,
    ),
    # Legacy stored/exported format used "positions" (plural).
    vol.Schema(
        {
            vol.Required("positions"): _POSITION_LIST,
            vol.Required("color"): RGB_SCHEMA,
        },
        extra=vol.REMOVE_EXTRA,
    ),
)
PIXEL_LIST_SCHEMA = vol.All([PIXEL_ENTRY_SCHEMA], vol.Length(max=MAX_PIXEL_ENTRIES))
PALETTE_SCHEMA = vol.Schema(
    {
        vol.Optional("name"): OPTIONAL_NAME_SCHEMA,
        vol.Required("colors"): COLOR_LIST_SCHEMA,
    },
    extra=vol.REMOVE_EXTRA,
)
PALETTE_LIST_SCHEMA = vol.All([PALETTE_SCHEMA], vol.Length(max=MAX_PALETTES))
FAVOURITE_SCHEMA = vol.Schema(
    {
        vol.Required("name"): vol.All(
            cv.string, vol.Length(min=1, max=MAX_FAVOURITE_NAME)
        ),
        vol.Optional("color_mode", default="normal"): vol.All(
            cv.string, vol.Length(max=40)
        ),
        vol.Optional("color"): vol.Any(None, RGB_SCHEMA),
    },
    extra=vol.REMOVE_EXTRA,
)
FAVOURITE_LIST_SCHEMA = vol.All(
    [FAVOURITE_SCHEMA], vol.Length(max=MAX_FAVOURITES)
)
PIXEL_ART_SCHEMA = vol.Schema(
    {
        vol.Optional("name"): OPTIONAL_NAME_SCHEMA,
        vol.Required("pixels"): PIXEL_LIST_SCHEMA,
    },
    extra=vol.REMOVE_EXTRA,
)
PIXEL_ART_LIST_SCHEMA = vol.All([PIXEL_ART_SCHEMA], vol.Length(max=MAX_PIXEL_ARTS))


def _check_collection_size(current, added, limit, label):
    """Refuse an append that would grow a shared collection past ``limit``."""
    if current + added > limit:
        raise HomeAssistantError(
            f"The {label} collection is limited to {limit} items "
            f"({current} saved, {added} to add)."
        )


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
        _LOGGER.warning("[%s] No entity_id provided -- cannot determine target", service_name)
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

    _LOGGER.warning("[%s] Entity %s not found in registry (keys: %s)", service_name, entity_id, list(_ENTITY_REGISTRY.keys()))
    return None


def _resolve_entities(service_call, service_name: str):
    """Resolve ALL target entities from a service call's entity_id.

    Handles both a single entity_id string and a list of entity_ids.
    Returns a list of resolved entity objects (may be empty).
    Used by handlers that support parallel multi-entity dispatch.
    """
    entity_id = service_call.data.get("entity_id")
    if not entity_id:
        _LOGGER.warning("[%s] No entity_id provided -- cannot determine target", service_name)
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
            _LOGGER.warning("[%s] Entity %s not found in registry", service_name, eid)
    return results


def _locate_item(items, idx, expected_name, label):
    """Return ``items[idx]``, refusing an index that no longer matches.

    Collections are shared by every browser, so an index sent by a card may
    point at a different item once another client deleted or reordered
    entries. When the caller passes ``expected_name`` (the name it saw at
    that index), a mismatch is rejected instead of acting on the wrong item.
    """
    if not (isinstance(idx, int) and 0 <= idx < len(items)):
        raise HomeAssistantError(
            f"{label} {idx} no longer exists. Refresh and try again."
        )
    item = items[idx]
    # Compare as stored: names are normalised on save (e.g. "<"/">" are
    # stripped), while a card may still hold the raw name it just sent.
    if expected_name is not None and (
        not isinstance(item, dict)
        or normalize_display_name(item.get("name"), "")
        != normalize_display_name(expected_name, "")
    ):
        raise HomeAssistantError(
            f"The {label.lower()} list changed: '{expected_name}' is no "
            f"longer at position {idx}. Refresh and try again."
        )
    return item


def _move_item(items, from_idx, to_idx, expected_name, label):
    """Move ``items[from_idx]`` to ``to_idx`` in place; False when already there.

    The one reorder of the user collections (palettes, pixel arts): a card
    moves a single item, so items other clients added meanwhile are kept,
    and ``expected_name`` refuses a move whose index went stale.
    """
    _locate_item(items, from_idx, expected_name, label)
    if not (isinstance(to_idx, int) and 0 <= to_idx < len(items)):
        raise HomeAssistantError(
            f"{label} position {to_idx} is out of range. Refresh and try again."
        )
    if from_idx == to_idx:
        return False
    items.insert(to_idx, items.pop(from_idx))
    return True


def make_admin_only(hass: HomeAssistant):
    """Build the ``_admin_only`` handler decorator for ``hass``."""

    def _admin_only(handler):
        """Restrict a raw/diagnostic service to Home Assistant administrators.

        These services send arbitrary firmware commands or take exclusive
        control of a lamp, so a non-admin user must not be able to call them.
        Calls without a user (automations, scripts, the system) are allowed,
        matching Home Assistant's own admin services.
        """

        @functools.wraps(handler)
        async def wrapper(service_call):
            user_id = service_call.context.user_id
            if user_id:
                user = await hass.auth.async_get_user(user_id)
                if user is None:
                    raise UnknownUser(context=service_call.context)
                if not user.is_admin:
                    raise Unauthorized(context=service_call.context)
            return await handler(service_call)

        return wrapper

    return _admin_only


def make_fire_and_forget(hass: HomeAssistant):
    """Build the ``_fire_and_forget`` helper for ``hass``."""

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

    return _fire_and_forget
