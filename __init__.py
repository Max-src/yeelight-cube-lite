import logging
import os
import asyncio
import socket as _socket_module
from homeassistant.core import HomeAssistant, callback as ha_callback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.exceptions import ConfigEntryNotReady # type: ignore
from homeassistant.helpers.typing import ConfigType # type: ignore
from homeassistant.helpers.storage import Store # type: ignore
from homeassistant.helpers.event import async_call_later # type: ignore
from homeassistant.helpers import entity_registry as er # type: ignore
from .const import DOMAIN, CONF_IP, CONF_DEVICE_ID
from .conflict_prevention import get_conflict_prevention
from .services import async_setup_services, async_remove_services

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.storage"

# Frontend card JS files to auto-register as Lovelace resources
FRONTEND_CARD_FILES = [
    "yeelight-cube-lamp-preview-card.js",
    "yeelight-cube-gradient-card.js",
    "yeelight-cube-draw-card.js",
    "yeelight-cube-palette-card.js",
    "yeelight-cube-color-list-editor-card.js",
    "yeelight-cube-calibration-card.js",  # DEBUG: color correction tuning
]

FRONTEND_URL_BASE = f"/{DOMAIN}"

# Unique prefix to tag resources we manage so we can update/identify them
_RESOURCE_TAG = "yeelight_cube_auto"


async def _async_register_lovelace_resources(
    hass: HomeAssistant, card_files: list, url_base: str, version: str
) -> None:
    """Register card JS files as Lovelace dashboard resources.

    This uses the same mechanism as HACS for registering frontend plugins,
    ensuring cards load the same way as Mushroom, card-mod, and other
    well-known custom cards (via the lovelace_resources storage collection).
    """
    try:
        # The Lovelace resource collection is stored here by HA core
        resource_collection = hass.data.get("lovelace_resources")
        if resource_collection is None:
            _LOGGER.debug(
                "Lovelace resources collection not available yet – "
                "cards may need to be added manually or will load via add_extra_js_url"
            )
            return

        # Build a lookup of existing resources by their base URL (without query params)
        existing_items = resource_collection.async_items()
        existing_by_base = {}
        for item in existing_items:
            base = item["url"].split("?")[0]
            existing_by_base[base] = item

        for card_file in card_files:
            card_url_base = f"{url_base}/{card_file}"
            card_url = f"{card_url_base}?v={version}"

            if card_url_base in existing_by_base:
                existing = existing_by_base[card_url_base]
                if existing["url"] != card_url:
                    # Version changed – update the URL to bust cache
                    await resource_collection.async_update_item(
                        existing["id"], {"url": card_url}
                    )
                    _LOGGER.debug("Updated Lovelace resource: %s", card_url)
            else:
                # Register new resource as JS module
                await resource_collection.async_create_item(
                    {"url": card_url, "res_type": "module"}
                )
                _LOGGER.debug("Added Lovelace resource: %s", card_url)

    except Exception:
        _LOGGER.warning(
            "Could not register Lovelace resources automatically. "
            "You may need to add them manually: Settings → Dashboards → Resources",
            exc_info=True,
        )


def _is_cubelite_model(model: str) -> bool:
    """Check if a SSDP model string represents a CubeLite device."""
    m = model.lower()
    return "cubelite" in m or "cube_lite" in m or "cube-lite" in m or "clt" in m


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the Yeelight Cube Lite component."""
    _LOGGER.debug("Yeelight Cube Lite async_setup() called")

    # Schedule an SSDP scan for CubeLite devices after HA is fully started.
    # This creates discovery flows so CubeLite devices show up in the
    # "Discovered" section of the Integrations page under our integration.
    # The scan also re-runs every 10 minutes to detect devices that changed
    # IP via DHCP while HA was running.
    @ha_callback
    def _discover_cubelite_devices(_event=None):
        """Fired once after HA startup — kick off SSDP scan."""
        hass.async_create_task(_async_ssdp_discover_cubelite(hass))

    hass.bus.async_listen_once("homeassistant_started", _discover_cubelite_devices)

    # Periodic SSDP scan (every 10 min) — catches IP changes at runtime.
    # The discovery flow's config_flow logic handles dedup and IP migration.
    from homeassistant.helpers.event import async_track_time_interval  # type: ignore
    from datetime import timedelta

    async def _periodic_ssdp_scan(_now=None):
        await _async_ssdp_discover_cubelite(hass)

    async_track_time_interval(hass, _periodic_ssdp_scan, timedelta(minutes=10))

    return True


# --------------------------------------------------------------------------- #
#  Entity unique_id migration  (IP-based → entry_id-based)                     #
# --------------------------------------------------------------------------- #

# Every entity suffix by HA platform.  The empty string is the light entity itself.
_ENTITY_SUFFIXES_BY_PLATFORM: list[tuple[str, str]] = [
    ("light", ""),
    ("button", "_force_refresh"),
    ("number", "_gradient_angle"),
    ("number", "_transition_steps"),
    ("number", "_transition_duration"),
    # Preview adjustment numbers (keys from PREVIEW_ADJUSTMENT_SPECS)
    ("number", "_hue_shift"),
    ("number", "_temperature"),
    ("number", "_saturation"),
    ("number", "_vibrance"),
    ("number", "_contrast"),
    ("number", "_glow"),
    ("number", "_grayscale"),
    ("number", "_invert"),
    ("number", "_tint_hue"),
    ("number", "_tint_strength"),
    # Selects
    ("select", "_palette_select"),
    ("select", "_pixel_art_select"),
    ("select", "_display_mode_select"),
    ("select", "_alignment_select"),
    ("select", "_font_select"),
    ("select", "_transition_select"),
    # Text
    ("text", "_display_text"),
    # Camera
    ("camera", "_matrix_preview_square"),
    ("camera", "_matrix_preview_round"),
]


async def _async_migrate_entity_unique_ids(
    hass: HomeAssistant, entry: ConfigEntry, ip_address: str
) -> None:
    """Migrate entity unique_ids from the old IP-based scheme to entry_id-based.

    Old format:  yeelight_cube_192_168_4_139{suffix}
    New format:  yeelight_cube_{entry_id}{suffix}

    This is idempotent — if no old entities are found, it's a no-op.
    """
    old_base = f"yeelight_cube_{ip_address.replace('.', '_')}"
    new_base = f"yeelight_cube_{entry.entry_id}"

    if old_base == new_base:
        return  # Should never happen, but be safe

    ent_reg = er.async_get(hass)
    migrated = 0

    for platform, suffix in _ENTITY_SUFFIXES_BY_PLATFORM:
        old_uid = f"{old_base}{suffix}"
        new_uid = f"{new_base}{suffix}"

        # Check if an entity with the old unique_id exists
        entity_id = ent_reg.async_get_entity_id(platform, DOMAIN, old_uid)
        if entity_id is None:
            continue

        # Make sure the new unique_id isn't already taken
        if ent_reg.async_get_entity_id(platform, DOMAIN, new_uid) is not None:
            _LOGGER.debug(
                "[MIGRATE] Skipping %s — new unique_id already exists: %s",
                entity_id, new_uid,
            )
            continue

        try:
            ent_reg.async_update_entity(entity_id, new_unique_id=new_uid)
            migrated += 1
            _LOGGER.debug("[MIGRATE] %s: %s → %s", entity_id, old_uid, new_uid)
        except Exception as exc:
            _LOGGER.warning(
                "[MIGRATE] Failed to migrate %s (%s → %s): %s",
                entity_id, old_uid, new_uid, exc,
            )

    if migrated:
        _LOGGER.info(
            "[MIGRATE] Migrated %d entity unique_ids for entry %s (IP %s → entry_id %s)",
            migrated, entry.entry_id, ip_address, entry.entry_id,
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Yeelight Cube Lite from a config entry."""
    _LOGGER.debug("[SETUP-ENTRY] async_setup_entry() called for entry: %s", entry.entry_id)
    
    # Initialize domain data dict immediately (synchronous, no yield point)
    # This prevents the race condition where two entries both pass the guard
    # before either finishes the async storage load.
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}
    
    # Initialize storage on FIRST config entry only.
    # Set the "storage" sentinel BEFORE the await to prevent the second entry
    # from also entering this block while the first is loading.
    if "storage" not in hass.data[DOMAIN]:
        _LOGGER.debug("[STORAGE-INIT] First config entry - initializing storage")
        store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        
        # Set sentinel immediately (before await) to block other entries
        hass.data[DOMAIN]["storage"] = store
        
        # Load persisted data
        stored_data = await store.async_load()
        if stored_data is None:
            stored_data = {}
            _LOGGER.debug("[STORAGE-LOAD] No stored data found, starting fresh")
        else:
            _LOGGER.debug(
                "[STORAGE-LOAD] Loaded: %d palettes, %d pixel arts",
                len(stored_data.get('palettes_v2', [])),
                len(stored_data.get('pixel_arts', []))
            )
        
        hass.data[DOMAIN].update({
            "palettes_v2": stored_data.get("palettes_v2", []),
            "pixel_arts": stored_data.get("pixel_arts", []),
        })
        
        # Initialize conflict prevention and services (only once)
        get_conflict_prevention(hass)
        async_setup_services(hass)
        
        # Register static path to serve frontend JS card files
        www_path = os.path.join(os.path.dirname(__file__), "www")
        if os.path.isdir(www_path):
            try:
                # HA 2024.7+ uses async_register_static_paths
                # cache_headers=False: we handle cache busting via ?v= query params
                # Setting True can cause stale 404s in HA's CachingStaticResource
                from homeassistant.components.http import StaticPathConfig  # type: ignore
                await hass.http.async_register_static_paths(
                    [StaticPathConfig(FRONTEND_URL_BASE, www_path, False)]
                )
            except (ImportError, AttributeError):
                # Fallback for older HA versions
                hass.http.register_static_path(FRONTEND_URL_BASE, www_path, False)
            _LOGGER.debug("Yeelight Cube Lite: Registered frontend at %s", FRONTEND_URL_BASE)
            
            # Read version from manifest.json for cache-busting query params
            try:
                import json as _json
                _manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")
                with open(_manifest_path, encoding="utf-8") as _mf:
                    _version = _json.load(_mf).get("version", "0")
            except Exception:
                _version = "0"
            
            # Register cards as Lovelace resources (same mechanism as HACS plugins).
            # This is more reliable than add_extra_js_url because HA loads these
            # resources the same way as Mushroom, card-mod, and other HACS cards.
            await _async_register_lovelace_resources(
                hass, FRONTEND_CARD_FILES, FRONTEND_URL_BASE, _version
            )
            
            # Also register via add_extra_js_url as a fallback
            try:
                from homeassistant.components.frontend import add_extra_js_url  # type: ignore
                for card_file in FRONTEND_CARD_FILES:
                    card_url = f"{FRONTEND_URL_BASE}/{card_file}?v={_version}"
                    add_extra_js_url(hass, card_url)
            except (ImportError, Exception):
                pass
        
        _LOGGER.debug("Yeelight Cube Lite: Storage, conflict prevention, and services initialized")
    
    # Register this device as managed by our component (for all entries)
    ip_address = entry.data[CONF_IP]
    port = entry.data.get('port', 55443)
    conflict_prevention = get_conflict_prevention(hass)
    conflict_prevention.add_managed_device(ip_address)
    
    # Listen for config entry updates (e.g. IP change from zeroconf rediscovery)
    entry.async_on_unload(entry.add_update_listener(_async_entry_updated))
    
    # Initialize entry data storage for sharing between platforms
    if entry.entry_id not in hass.data[DOMAIN]:
        hass.data[DOMAIN][entry.entry_id] = {}
    
    # Quick TCP probe to verify the device is reachable before proceeding.
    # ConfigEntryNotReady MUST be raised here (component-level setup) for
    # HA's automatic retry with exponential back-off to work.
    probe_timeout = 3.0  # Generous timeout — device may still be booting

    def _tcp_probe(host, p, timeout):
        """Synchronous TCP probe — runs in executor thread."""
        s = _socket_module.socket(_socket_module.AF_INET, _socket_module.SOCK_STREAM)
        try:
            s.settimeout(timeout)
            s.connect((host, p))
        finally:
            s.close()

    try:
        _LOGGER.debug("[SETUP] Probing %s:%s (timeout=%ss)", ip_address, port, probe_timeout)
        await hass.async_add_executor_job(_tcp_probe, ip_address, port, probe_timeout)
        _LOGGER.debug("[SETUP] Probe OK — %s:%s is reachable", ip_address, port)
    except (OSError, ConnectionRefusedError, TimeoutError) as err:
        _LOGGER.warning(
            "[SETUP] Device at %s:%s is not reachable: %s. "
            "Scanning network for CubeLite devices...",
            ip_address, port, err,
        )
        # Device unreachable — try to find it at a new IP via Yeelight SSDP
        new_ip = await _async_try_rediscover(hass, entry, ip_address)
        if new_ip:
            # Entry data already updated inside _async_try_rediscover.
            # Raise ConfigEntryNotReady so HA retries immediately with the new IP.
            raise ConfigEntryNotReady(
                f"Yeelight Cube Lite moved from {ip_address} to {new_ip} — retrying"
            ) from err
        raise ConfigEntryNotReady(
            f"Yeelight Cube Lite at {ip_address} is not reachable — will retry automatically"
        ) from err

    # --- Acquire device_id if not stored yet (manual setup entries) ---
    # The device_id is the hardware serial from SSDP capabilities.  We need it
    # for stable entity naming and precise rediscovery with multiple lamps.
    if not entry.data.get(CONF_DEVICE_ID):
        try:
            from yeelight import Bulb  # type: ignore
            _LOGGER.debug("[SETUP] No device_id stored — fetching capabilities for %s", ip_address)
            bulb = Bulb(ip_address, port)
            caps = await hass.async_add_executor_job(bulb.get_capabilities)
            if caps and isinstance(caps, dict):
                new_device_id = str(caps.get("id", ""))
                if new_device_id:
                    _LOGGER.info(
                        "[SETUP] Acquired device_id '%s' for %s — storing in entry",
                        new_device_id, ip_address,
                    )
                    hass.config_entries.async_update_entry(
                        entry,
                        data={**entry.data, CONF_DEVICE_ID: new_device_id},
                    )
        except Exception as exc:
            _LOGGER.debug("[SETUP] Could not fetch device_id for %s: %s", ip_address, exc)

    # --- Migrate entity unique_ids from IP-based to entry_id-based ---
    # Old format: yeelight_cube_192_168_4_139{suffix}
    # New format: yeelight_cube_{entry_id}{suffix}
    # This migration runs once; after that the old entities no longer exist.
    await _async_migrate_entity_unique_ids(hass, entry, ip_address)

    # Set up light platform FIRST — it creates the CubeMatrix and stores the
    # light entity in hass.data[DOMAIN][entry.entry_id]["light"], which the
    # other platforms (switch, camera, …) depend on.
    # Wrap in try/except: if ANY platform raises an unhandled exception,
    # convert it to ConfigEntryNotReady so HA auto-retries instead of
    # permanently failing the entry.
    try:
        await hass.config_entries.async_forward_entry_setups(entry, ["light"])
    except ConfigEntryNotReady:
        raise  # Already a retry — let it through
    except Exception as exc:
        _LOGGER.warning(
            "[SETUP] Light platform setup failed for %s — will retry: %s",
            ip_address, exc, exc_info=True,
        )
        raise ConfigEntryNotReady(
            f"Light platform setup failed for {ip_address}: {exc}"
        ) from exc
    
    # Now set up all dependent platforms (they can safely read the light entity)
    await hass.config_entries.async_forward_entry_setups(entry, ["switch", "text", "select", "sensor", "number", "button", "camera"])
    
    # Auto-dismiss built-in Yeelight discovery flows for this device.
    # The built-in Yeelight integration discovers CubeLite devices via zeroconf/DHCP
    # but cannot properly control them. Dismiss those flows so users aren't confused.
    _schedule_dismiss_yeelight_discoveries(hass)
    
    _LOGGER.debug(f"Set up Yeelight Cube Lite at {ip_address}")
    return True


async def _async_ssdp_discover_cubelite(hass: HomeAssistant) -> None:
    """Scan the LAN for CubeLite devices and create discovery flows.

    CubeLite devices do NOT advertise via _miio._udp.local. mDNS, so HA's
    built-in zeroconf never triggers our config flow for them.  Instead we
    use the yeelight library's SSDP scan (same mechanism as the built-in
    Yeelight integration) and initiate discovery flows ourselves.
    """
    try:
        from yeelight import discover_bulbs  # type: ignore

        _LOGGER.warning("[SSDP-SCAN] Scanning for CubeLite devices...")
        bulbs = await hass.async_add_executor_job(discover_bulbs, 5)
        _LOGGER.warning("[SSDP-SCAN] Found %d Yeelight devices total", len(bulbs))

        for bulb in bulbs:
            capabilities = bulb.get("capabilities", {})
            model = (capabilities.get("model") or "").lower()
            bulb_ip = bulb.get("ip", "")
            device_id = str(capabilities.get("id", ""))
            device_name = capabilities.get("name", "") or model

            _LOGGER.warning(
                "[SSDP-SCAN]   Device: ip=%s model=%s id=%s name=%s",
                bulb_ip, model, device_id, device_name,
            )

            if not _is_cubelite_model(model):
                continue  # Not a CubeLite

            _LOGGER.warning(
                "[SSDP-SCAN] Found CubeLite: ip=%s model=%s id=%s — creating discovery flow",
                bulb_ip, model, device_id,
            )
            try:
                await hass.config_entries.flow.async_init(
                    DOMAIN,
                    context={"source": "discovery"},
                    data={
                        "ip": bulb_ip,
                        "model": model,
                        "device_id": device_id,
                        "name": device_name or f"CubeLite ({bulb_ip})",
                    },
                )
            except Exception as exc:
                # Flow may abort if already configured — that's fine
                _LOGGER.debug("[SSDP-SCAN] Flow init result: %s", exc)

        # After creating our discovery flows, dismiss the built-in Yeelight
        # integration's discovery flows for the same CubeLite devices so
        # users see them only under our integration.
        await _async_dismiss_yeelight_cubelite_discoveries(hass)

    except Exception as exc:
        _LOGGER.warning("[SSDP-SCAN] Scan failed: %s", exc)


async def _async_try_rediscover(
    hass: HomeAssistant, entry: ConfigEntry, old_ip: str
) -> str | None:
    """Scan the LAN for CubeLite devices that may have changed IP.

    Uses the ``yeelight`` library's SSDP discovery (multicast to
    239.255.255.250:1982) which is the same mechanism the built-in
    Yeelight integration uses.  CubeLite devices do NOT advertise
    via ``_miio._udp.local.`` mDNS, so zeroconf never sees them —
    this is the reliable alternative.

    When device_id is stored in the config entry, we match by device_id
    (hardware serial) so that with multiple lamps on the network, each
    entry reconnects to the correct physical device.  Without a stored
    device_id, falls back to the first unmapped CubeLite (legacy).

    Returns the new IP if a matching device was found and the config
    entry was updated, otherwise ``None``.
    """
    try:
        from yeelight import discover_bulbs  # type: ignore

        _LOGGER.warning("[REDISCOVER] Scanning for CubeLite devices via SSDP...")
        bulbs = await hass.async_add_executor_job(discover_bulbs, 5)
        _LOGGER.warning("[REDISCOVER] Found %d Yeelight devices on the network", len(bulbs))

        stored_device_id = entry.data.get(CONF_DEVICE_ID, "")

        # Collect all IPs already configured in our integration
        configured_ips: set[str] = set()
        for e in hass.config_entries.async_entries(DOMAIN):
            ip = e.data.get(CONF_IP)
            if ip:
                configured_ips.add(ip)

        # --- Pass 1: match by device_id (precise, handles multiple lamps) ---
        cubelites = []
        for bulb in bulbs:
            capabilities = bulb.get("capabilities", {})
            model = (capabilities.get("model") or "").lower()
            bulb_ip = bulb.get("ip", "")
            device_id = str(capabilities.get("id", ""))

            _LOGGER.warning(
                "[REDISCOVER]   Device: ip=%s model=%s id=%s is_cubelite=%s",
                bulb_ip, model, device_id, _is_cubelite_model(model),
            )

            if not _is_cubelite_model(model):
                continue

            cubelites.append((bulb_ip, device_id, model))

            if stored_device_id and device_id and device_id == stored_device_id:
                _LOGGER.warning(
                    "[REDISCOVER] Matched by device_id '%s': %s -> %s. "
                    "Updating entry %s",
                    device_id, old_ip, bulb_ip, entry.entry_id,
                )
                new_data = {**entry.data, CONF_IP: bulb_ip, CONF_DEVICE_ID: device_id}
                hass.config_entries.async_update_entry(
                    entry, data=new_data,
                    title=f"Yeelight Cube ({bulb_ip})",
                )
                return bulb_ip

        # --- Pass 2 (legacy fallback): first unmapped CubeLite ---
        for bulb_ip, device_id, model in cubelites:
            if bulb_ip in configured_ips:
                continue  # Already assigned to another entry

            _LOGGER.warning(
                "[REDISCOVER] CubeLite found at %s (was %s, no device_id match). "
                "Updating entry %s (device_id=%s, model=%s)",
                bulb_ip, old_ip, entry.entry_id, device_id, model,
            )
            new_data = {**entry.data, CONF_IP: bulb_ip}
            if device_id:
                new_data[CONF_DEVICE_ID] = device_id
            hass.config_entries.async_update_entry(
                entry, data=new_data,
                title=f"Yeelight Cube ({bulb_ip})",
            )
            return bulb_ip

        _LOGGER.warning("[REDISCOVER] No unmapped CubeLite devices found on the network")
        return None

    except Exception as exc:
        _LOGGER.warning("[REDISCOVER] Scan failed: %s", exc)
        return None


async def _async_entry_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle config entry updates (e.g. IP changed via zeroconf rediscovery).
    
    When a device gets a new IP via DHCP, zeroconf rediscovery calls
    _abort_if_unique_id_configured(updates={CONF_IP: new_ip}) which updates
    entry.data. HA then calls this listener, and we reload the entry so the
    CubeMatrix reconnects to the new IP.
    """
    _LOGGER.info(
        "Config entry updated for %s — reloading (new IP: %s)",
        entry.title, entry.data.get(CONF_IP),
    )
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    ip_address = entry.data[CONF_IP]

    # Clean up module-level state in light.py (entity registry + device locks)
    # so stale references don't persist across integration reloads.
    # Import lazily to avoid circular import (light.py imports from __init__).
    from .light import cleanup_module_state  # noqa: E402
    cleanup_module_state(ip_address)

    # Remove device from managed list
    conflict_prevention = get_conflict_prevention(hass)
    conflict_prevention.remove_managed_device(ip_address)
    
    # Unload platforms (removes entities tied to this entry, including sensors
    # if this entry was the one that created them).
    unload_ok = await hass.config_entries.async_unload_platforms(entry, ["light", "switch", "text", "select", "sensor", "number", "button", "camera"])
    
    # Clean up entry-specific data
    if DOMAIN in hass.data and entry.entry_id in hass.data[DOMAIN]:
        del hass.data[DOMAIN][entry.entry_id]
    
    # --- Global sensor lifecycle ------------------------------------------------
    # Sensors are global (shared across all lamps) but HA ties entities to the
    # config entry whose async_setup_entry created them.  When that entry is
    # removed the sensors vanish.  We detect this and re-create them under a
    # surviving entry's platform callback so they stay available.
    # ---------------------------------------------------------------------------
    sensor_callbacks = hass.data.get(DOMAIN, {}).get("_sensor_callbacks", {})
    sensor_callbacks.pop(entry.entry_id, None)  # this entry is going away

    sensor_owner = hass.data.get(DOMAIN, {}).get("_sensor_owner_entry")
    this_owned_sensors = (
        sensor_owner == entry.entry_id
        or (sensor_owner is None and hass.data.get(DOMAIN, {}).get("sensors_created"))
    )

    if this_owned_sensors and DOMAIN in hass.data:
        # Clear stale sensor state
        hass.data[DOMAIN].pop("sensors_created", None)
        hass.data[DOMAIN].pop("palette_sensor_entity", None)
        hass.data[DOMAIN].pop("pixelart_sensor_entity", None)
        hass.data[DOMAIN].pop("_sensor_owner_entry", None)

        # Re-create under a remaining entry's callback (if any)
        if sensor_callbacks:
            from .sensor import _create_and_register_sensors  # noqa: E402
            new_owner_id, callback = next(iter(sensor_callbacks.items()))
            try:
                _create_and_register_sensors(hass, callback, new_owner_id)
                _LOGGER.debug(
                    "Global sensors transferred to entry %s", new_owner_id
                )
            except Exception as exc:
                _LOGGER.warning(
                    "Failed to recreate sensors after entry removal: %s", exc
                )
        else:
            _LOGGER.debug("Last entry unloaded — sensors will be recreated on next add")
    elif not sensor_callbacks:
        # Last entry and it didn't own sensors (edge case) — clean up anyway
        if DOMAIN in hass.data:
            hass.data[DOMAIN].pop("sensors_created", None)
            hass.data[DOMAIN].pop("palette_sensor_entity", None)
            hass.data[DOMAIN].pop("pixelart_sensor_entity", None)
            hass.data[DOMAIN].pop("_sensor_owner_entry", None)
    
    _LOGGER.debug("Unloaded Yeelight Cube Lite at %s", ip_address)
    return unload_ok

async def async_save_data(hass: HomeAssistant):
    """Save current data to persistent storage."""
    if DOMAIN not in hass.data:
        _LOGGER.warning("[STORAGE-SAVE] DOMAIN not in hass.data, cannot save!")
        return
    
    store = hass.data[DOMAIN].get("storage")
    if store is None:
        _LOGGER.warning("[STORAGE-SAVE] No storage object found!")
        return
    
    palettes_v2 = hass.data[DOMAIN].get("palettes_v2", [])
    pixel_arts = hass.data[DOMAIN].get("pixel_arts", [])
    
    _LOGGER.debug(f"[STORAGE-SAVE] About to save: {len(palettes_v2)} palettes, {len(pixel_arts)} pixel arts")
    _LOGGER.debug(f"[STORAGE-SAVE] Palette names: {[p.get('name', 'Unnamed') for p in palettes_v2[:5]]}...")
    
    data_to_save = {
        "palettes_v2": palettes_v2,
        "pixel_arts": pixel_arts
    }
    
    await store.async_save(data_to_save)
    _LOGGER.debug(f"[STORAGE-SAVE] COMPLETE: Saved {len(data_to_save['palettes_v2'])} palettes, {len(data_to_save['pixel_arts'])} pixel arts")

async def async_remove(hass: HomeAssistant) -> None:
    """Remove the component."""
    # Remove services
    async_remove_services(hass)
    # Cancel any pending dismiss timers
    cancel = hass.data.get(DOMAIN, {}).pop("_dismiss_unsub", None)
    if cancel:
        cancel()
    _LOGGER.debug("Removed Yeelight Cube Lite component services")


# ---------------------------------------------------------------------------
#  Auto-dismiss built-in Yeelight discovery flows for managed CubeLite devices
# ---------------------------------------------------------------------------

def _get_managed_ips(hass: HomeAssistant) -> set:
    """Get all IP addresses managed by this component."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return {e.data.get(CONF_IP) for e in entries if e.data.get(CONF_IP)}


@ha_callback
def _schedule_dismiss_yeelight_discoveries(hass: HomeAssistant) -> None:
    """Schedule multiple dismiss attempts to catch late-arriving discovery flows."""
    if "_dismiss_unsub" in hass.data.get(DOMAIN, {}):
        return  # already scheduled

    cancel_handles = []

    @ha_callback
    def _run_dismiss(_now=None):
        hass.async_create_task(_async_dismiss_yeelight_discoveries(hass))
        hass.async_create_task(_async_dismiss_yeelight_cubelite_discoveries(hass))

    # Run at 10s, 30s, 60s, and 120s after setup to catch flows that arrive later
    for delay in (10, 30, 60, 120):
        cancel_handles.append(async_call_later(hass, delay, _run_dismiss))

    @ha_callback
    def _cancel_all():
        for cancel in cancel_handles:
            cancel()

    hass.data.setdefault(DOMAIN, {})["_dismiss_unsub"] = _cancel_all


async def _async_dismiss_yeelight_discoveries(hass: HomeAssistant) -> None:
    """Dismiss pending built-in Yeelight discovery flows for devices we manage."""
    managed_ips = _get_managed_ips(hass)
    if not managed_ips:
        return

    try:
        flows = hass.config_entries.flow.async_progress_by_handler("yeelight")
    except Exception:
        return

    for flow in flows:
        context = flow.get("context", {})
        placeholders = context.get("title_placeholders", {})
        flow_host = placeholders.get("host", "")

        if flow_host in managed_ips:
            try:
                hass.config_entries.flow.async_abort(flow["flow_id"])
                _LOGGER.debug(
                    "Auto-dismissed built-in Yeelight discovery for %s (managed by Yeelight Cube Lite)",
                    flow_host,
                )
            except Exception as exc:
                _LOGGER.debug("Could not abort Yeelight discovery flow: %s", exc)


async def _async_dismiss_yeelight_cubelite_discoveries(hass: HomeAssistant) -> None:
    """Dismiss built-in Yeelight discovery flows for ANY CubeLite device.

    Unlike _async_dismiss_yeelight_discoveries (which only dismisses for
    configured IPs), this dismisses flows whose name contains 'cubelite'
    or 'clt' — i.e. any CubeLite on the network, whether or not it's
    already configured in our integration.
    """
    try:
        flows = hass.config_entries.flow.async_progress_by_handler("yeelight")
    except Exception:
        return

    for flow in flows:
        context = flow.get("context", {})
        placeholders = context.get("title_placeholders", {})
        flow_name = (placeholders.get("name", "") or "").lower()
        flow_host = placeholders.get("host", "")

        if "cubelite" in flow_name or "clt" in flow_name or "cube_lite" in flow_name:
            try:
                hass.config_entries.flow.async_abort(flow["flow_id"])
                _LOGGER.warning(
                    "[DISMISS] Dismissed built-in Yeelight discovery for CubeLite at %s",
                    flow_host,
                )
            except Exception as exc:
                _LOGGER.debug("Could not abort Yeelight discovery flow: %s", exc)