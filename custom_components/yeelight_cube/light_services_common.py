"""Shared helpers, limits and schemas for the entity-facing actions.

Used by the ``light_services_<area>`` modules, which register the actions
(see :func:`light_services.async_setup_light_services`).
"""
import asyncio
import functools
import logging
import time

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import Unauthorized, UnknownUser  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .command_errors import note_command_result
from .pixel_art_storage import PIXEL_ART_ORIENTATIONS
from .errors import invalid
from .cube_matrix import is_connection_error
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
PIXEL_ART_ORIENTATION_SCHEMA = vol.In(PIXEL_ART_ORIENTATIONS)
PIXEL_ART_SCHEMA = vol.Schema(
    {
        vol.Optional("name"): OPTIONAL_NAME_SCHEMA,
        vol.Required("pixels"): PIXEL_LIST_SCHEMA,
        vol.Optional("orientation"): PIXEL_ART_ORIENTATION_SCHEMA,
    },
    extra=vol.REMOVE_EXTRA,
)
PIXEL_ART_LIST_SCHEMA = vol.All([PIXEL_ART_SCHEMA], vol.Length(max=MAX_PIXEL_ARTS))


def _check_collection_size(current, added, limit, kind):
    """Refuse an append that would grow a shared collection (``kind``:
    "palette" or "pixel_art") past ``limit``."""
    if current + added > limit:
        raise invalid(f"{kind}s_full", limit=limit, current=current, added=added)


def _lamp_for(entity_id):
    """The lamp whose current entity_id is ``entity_id``, or None. Matched
    on the live id (never a stored one): a renamed lamp answers to its new
    id only (see light._ENTITY_REGISTRY)."""
    for lamp in _ENTITY_REGISTRY.values():
        if getattr(lamp, "entity_id", None) == entity_id:
            return lamp
    return None


def _target_ids(service_call) -> list:
    """The entity ids a service call targets; raises when it names none."""
    entity_id = service_call.data.get("entity_id")
    ids = [eid for eid in (entity_id if isinstance(entity_id, list) else [entity_id]) if eid]
    if not ids:
        raise invalid("no_target")
    return ids


def _resolve_entity(service_call, service_name: str):
    """The lamp a service call targets (its entity_id; the first one of a
    list). Raises a clear error when it names no lamp that is set up: the
    call is refused, never sent to another lamp."""
    entity_id = _target_ids(service_call)[0]
    target = _lamp_for(entity_id)
    if target is None:
        raise invalid("lamp_not_found", entity_id=entity_id)
    return target


def _resolve_entities(service_call, service_name: str):
    """Every lamp a service call targets (one entity_id or a list), for the
    handlers that update them in parallel. One that is not set up (still
    starting, or removed) is skipped and logged; the call is refused when
    none is."""
    ids = _target_ids(service_call)
    results = []
    for eid in ids:
        target = _lamp_for(eid)
        if target is not None:
            results.append(target)
        else:
            _LOGGER.warning("[%s] Entity %s not found among the lamps", service_name, eid)
    if not results:
        raise invalid("lamp_not_found", entity_id=", ".join(map(str, ids)))
    return results


def _locate_item(items, idx, expected_name, kind):
    """Return ``items[idx]``, refusing an index that no longer matches.

    Collections are shared by every browser, so an index sent by a card may
    point at a different item once another client deleted or reordered
    entries. When the caller passes ``expected_name`` (the name it saw at
    that index), a mismatch is rejected instead of acting on the wrong item.
    ``kind``: "palette" or "pixel_art" (its messages).
    """
    if not (isinstance(idx, int) and 0 <= idx < len(items)):
        raise invalid(f"{kind}_gone", index=idx)
    item = items[idx]
    # Compare as stored: names are normalised on save (e.g. "<"/">" are
    # stripped), while a card may still hold the raw name it just sent.
    if expected_name is not None and (
        not isinstance(item, dict)
        or normalize_display_name(item.get("name"), "")
        != normalize_display_name(expected_name, "")
    ):
        raise invalid(f"{kind}_list_changed", name=expected_name, index=idx)
    return item


def _move_item(items, from_idx, to_idx, expected_name, kind):
    """Move ``items[from_idx]`` to ``to_idx`` in place; False when already there.

    The one reorder of the user collections (palettes, pixel arts): a card
    moves a single item, so items other clients added meanwhile are kept,
    and ``expected_name`` refuses a move whose index went stale.
    """
    _locate_item(items, from_idx, expected_name, kind)
    if not (isinstance(to_idx, int) and 0 <= to_idx < len(items)):
        raise invalid(f"{kind}_position", index=to_idx)
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


def make_lamp_runner(hass: HomeAssistant):
    """Build ``run_on_lamps(label, lamps, apply)`` for ``hass``: the services'
    way to do their per-lamp work (lamp commands) in the
    background, so the service returns at once and every lamp is updated in
    parallel.

    A lamp's failure never stops the others and is logged with the service
    and the lamp: "not reached" as a warning for the first failure of an
    outage (then at debug level, like the connection layer), anything else
    as an error with its traceback, and published on the lamp for the
    cards (command_errors.note_command_result).
    """

    def run_on_lamps(label, lamps, apply):
        async def _one(lamp):
            started = time.time()
            try:
                await apply(lamp)
            except Exception as err:  # noqa: BLE001 -- one lamp never stops the others
                name = getattr(lamp, "entity_id", None) or getattr(lamp, "_ip", lamp)
                if is_connection_error(err):
                    cube = getattr(lamp, "_cube_matrix", None)
                    level = (
                        cube.outage_log_level()
                        if hasattr(cube, "outage_log_level")
                        else logging.WARNING
                    )
                    _LOGGER.log(level, "[%s] [%s] Lamp not reached: %s", label, name, err)
                else:
                    _LOGGER.exception("[%s] [%s] Failed: %s", label, name, err)
                    note_command_result(lamp, label, err)
            else:
                # Not an error its own redraw recorded meanwhile (refused).
                note_command_result(lamp, label, since=started)

        async def _run():
            await asyncio.gather(*(_one(lamp) for lamp in lamps))

        hass.async_create_task(_run(), name=f"yeelight_cube {label}")

    return run_on_lamps
