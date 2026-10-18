"""The integration's storage (.storage/yeelight_cube.storage): the shared
collections (palettes, pixel arts, clock presets), favourites, rotation,
drawings and runtime state, kept in hass.data[DOMAIN] while Home Assistant
runs. Loaded by the first lamp's setup (async_load_storage), written at once
(async_save_data) or shortly after a burst of changes (async_schedule_save).

collection() and async_collection_changed() are how the actions read and
change the shared palettes and pixel arts: the same "not loaded yet" refusal,
the same event for their sensor and selects, then the write."""
from __future__ import annotations

import asyncio
import logging

from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import ConfigEntryNotReady  # type: ignore
from homeassistant.helpers.storage import Store  # type: ignore

from .const import DOMAIN
from .errors import failed
from .name_utils import normalize_display_name
from .pixel_art_storage import group_pixels, is_grouped

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.storage"
# The shared collections, and the event (yeelight_cube_<event>) their sensor
# and selects follow (sensor.py, select.py).
COLLECTION_EVENTS = {"palettes_v2": "palettes_updated", "pixel_arts": "pixel_arts_updated"}


def collection(hass: HomeAssistant, key: str) -> list:
    """A shared collection (``palettes_v2``, ``pixel_arts``); raises while
    the storage is not loaded yet (the actions are registered before)."""
    items = hass.data.get(DOMAIN, {}).get(key)
    if items is None:
        raise failed("storage_not_ready")
    return items


async def async_collection_changed(hass: HomeAssistant, key: str) -> None:
    """Publish a change of a shared collection (its sensor and selects follow
    the event), then write it."""
    hass.bus.async_fire(f"{DOMAIN}_{COLLECTION_EVENTS[key]}", {"count": len(collection(hass, key))})
    await async_save_data(hass)


def storage_data(hass: HomeAssistant) -> dict:
    """Everything the integration persists, read from hass.data[DOMAIN]."""
    data = hass.data[DOMAIN]
    return {
        "clock_presets": data.get("clock_presets", []),
        "palettes_v2": data.get("palettes_v2", []),
        "pixel_arts": data.get("pixel_arts", []),
        "device_runtime_state": data.get("device_runtime_state", {}),
        "favourites": data.get("favourites", {}),
        "rotation": data.get("rotation", {}),
        "drawing": data.get("drawing", {}),
    }


def async_schedule_save(hass: HomeAssistant, delay: float = 1.0) -> None:
    """Save the integration data after ``delay`` seconds.

    Changes made within that window (favourite edits, rotation start/stop,
    interval changes) become one write, and Home Assistant flushes a pending
    save when it stops. The data is read at write time, so it is the latest.
    """
    store = hass.data.get(DOMAIN, {}).get("storage")
    if store is None:
        return
    store.async_delay_save(lambda: storage_data(hass), delay)


async def async_save_data(hass: HomeAssistant):
    """Save current data to persistent storage."""
    if DOMAIN not in hass.data:
        _LOGGER.warning("[STORAGE-SAVE] DOMAIN not in hass.data, cannot save!")
        return
    
    store = hass.data[DOMAIN].get("storage")
    if store is None:
        _LOGGER.warning("[STORAGE-SAVE] No storage object found!")
        return
    
    data_to_save = storage_data(hass)
    _LOGGER.debug(
        "[STORAGE-SAVE] About to save: %s palettes, %s pixel arts",
        len(data_to_save["palettes_v2"]),
        len(data_to_save["pixel_arts"]),
    )

    await store.async_save(data_to_save)
    _LOGGER.debug("[STORAGE-SAVE] COMPLETE: Saved %s palettes, %s pixel arts", len(data_to_save['palettes_v2']), len(data_to_save['pixel_arts']))


def migrate_pixel_arts(raw_pixel_arts: list) -> tuple[list, bool]:
    """Bring stored pixel arts to the grouped storage form with safe names.

    Returns the pixel arts and whether anything changed (needs saving).
    """
    migrated = []
    changed = False
    for idx, art in enumerate(raw_pixel_arts):
        if isinstance(art, dict) and isinstance(art.get("pixels"), list):
            safe_name = normalize_display_name(
                art.get("name", "Unnamed"), f"Pixel Art {idx + 1}"
            )
            if safe_name != art.get("name"):
                changed = True
            if is_grouped(art["pixels"]):
                art = {**art, "name": safe_name}
            else:
                # Flat or legacy "positions" form: drop black pixels and
                # duplicate positions, group the rest by color.
                art = {"name": safe_name, "pixels": group_pixels(art["pixels"])}
                changed = True
        migrated.append(art)
    return migrated, changed


async def async_load_storage(hass: HomeAssistant) -> None:
    """Load the shared storage (palettes, pixel arts, presets, runtime
    state) on the first config entry; other entries wait for it."""
    # Initialize storage on the first config entry. Other entries must wait for
    # shared data before their entities restore runtime state.
    is_storage_initializer = "storage" not in hass.data[DOMAIN]
    if not is_storage_initializer:
        storage_ready = hass.data[DOMAIN].get("storage_ready")
        if storage_ready is not None:
            await storage_ready.wait()
        storage_error = hass.data[DOMAIN].get("storage_init_error")
        if storage_error:
            # Remove the failed sentinel so a later config-entry retry can
            # attempt a clean storage load.
            hass.data[DOMAIN].pop("storage", None)
            hass.data[DOMAIN].pop("storage_ready", None)
            raise ConfigEntryNotReady(
                "Shared Yeelight Cube storage initialization failed: "
                f"{storage_error}"
            )

    if is_storage_initializer:
        _LOGGER.debug("[STORAGE-INIT] First config entry - initializing storage")
        store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        storage_ready = asyncio.Event()
        
        # Set sentinel immediately (before await) to block other entries
        hass.data[DOMAIN]["storage"] = store
        hass.data[DOMAIN]["storage_ready"] = storage_ready
        hass.data[DOMAIN].pop("storage_init_error", None)

        # Release waiters even if migration fails before storage_ready is set.
        setup_task = asyncio.current_task()
        if setup_task is not None:
            def _release_storage_waiters(task) -> None:
                if storage_ready.is_set():
                    return
                if task.cancelled():
                    error = "storage initialization was cancelled"
                else:
                    error = task.exception()
                    error = (
                        str(error)
                        if error is not None
                        else "storage initialization ended before completion"
                    )
                hass.data[DOMAIN]["storage_init_error"] = error
                storage_ready.set()

            setup_task.add_done_callback(_release_storage_waiters)
        
        # Load persisted data
        try:
            stored_data = await store.async_load()
        except Exception as err:
            hass.data[DOMAIN]["storage_init_error"] = str(err)
            storage_ready.set()
            raise
        if stored_data is None:
            stored_data = {}
            _LOGGER.debug("[STORAGE-LOAD] No stored data found, starting fresh")
        else:
            _LOGGER.debug(
                "[STORAGE-LOAD] Loaded: %d palettes, %d pixel arts",
                len(stored_data.get('palettes_v2', [])),
                len(stored_data.get('pixel_arts', []))
            )
        
        # Migrate stored pixel arts to the grouped storage form (see
        # pixel_art_storage) and clean up names. Only a change is written back.
        _migrated_pixel_arts, _needs_save = migrate_pixel_arts(
            stored_data.get("pixel_arts", [])
        )

        hass.data[DOMAIN].update({
            "clock_presets": stored_data.get("clock_presets", []),
            "palettes_v2": stored_data.get("palettes_v2", []),
            "pixel_arts": _migrated_pixel_arts,
            "device_runtime_state": stored_data.get("device_runtime_state", {}),
            "favourites": stored_data.get("favourites", {}),
            "rotation": stored_data.get("rotation", {}),
            "drawing": stored_data.get("drawing", {}),
        })
        hass.data[DOMAIN].pop("storage_init_error", None)
        storage_ready.set()

        # Persist migrated data immediately so the grouped format survives the next reboot
        # without needing to re-migrate from the flat on-disk format.
        if _needs_save:
            _LOGGER.info("[pixelart-migration] Migrating %s pixel arts to grouped format — saving to disk.", len(_migrated_pixel_arts))
            await async_save_data(hass)
        
        _LOGGER.debug("Yeelight Cube Lite: Storage, conflict prevention, and services initialized")
