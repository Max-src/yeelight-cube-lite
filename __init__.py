import logging
import os
import asyncio
from homeassistant.core import HomeAssistant, callback as ha_callback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.helpers.typing import ConfigType # type: ignore
from homeassistant.helpers.storage import Store # type: ignore
from homeassistant.helpers.event import async_call_later # type: ignore
from .const import DOMAIN, CONF_IP
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
    "yeelight-cube-angle-gradient-card.js",
]

FRONTEND_URL_BASE = f"/{DOMAIN}"

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the Yeelight Cube Lite component."""
    _LOGGER.debug("Yeelight Cube Lite async_setup() called")
    return True

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
            hass.http.register_static_path(FRONTEND_URL_BASE, www_path, True)
            _LOGGER.debug("Yeelight Cube Lite: Registered frontend at %s", FRONTEND_URL_BASE)
            
            # Auto-register Lovelace resources so cards work without manual config
            try:
                from homeassistant.components.frontend import add_extra_js_url  # type: ignore
                for card_file in FRONTEND_CARD_FILES:
                    card_url = f"{FRONTEND_URL_BASE}/{card_file}"
                    add_extra_js_url(hass, card_url)
                    _LOGGER.debug("Yeelight Cube Lite: Registered card resource %s", card_url)
            except ImportError:
                _LOGGER.warning(
                    "Could not auto-register Lovelace resources. "
                    "Add them manually as /yeelight_cube/<card-name>.js"
                )
        
        _LOGGER.debug("Yeelight Cube Lite: Storage, conflict prevention, and services initialized")
    
    # Register this device as managed by our component (for all entries)
    ip_address = entry.data[CONF_IP]
    conflict_prevention = get_conflict_prevention(hass)
    conflict_prevention.add_managed_device(ip_address)
    
    # Initialize entry data storage for sharing between platforms
    if entry.entry_id not in hass.data[DOMAIN]:
        hass.data[DOMAIN][entry.entry_id] = {}
    
    # Set up platforms
    await hass.config_entries.async_forward_entry_setups(entry, ["light", "switch", "text", "select", "sensor", "number", "button", "camera"])
    
    # Auto-dismiss built-in Yeelight discovery flows for this device.
    # The built-in Yeelight integration discovers CubeLite devices via zeroconf/DHCP
    # but cannot properly control them. Dismiss those flows so users aren't confused.
    _schedule_dismiss_yeelight_discoveries(hass)
    
    _LOGGER.debug(f"Set up Yeelight Cube Lite at {ip_address}")
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    ip_address = entry.data[CONF_IP]
    
    # Remove device from managed list
    conflict_prevention = get_conflict_prevention(hass)
    conflict_prevention.remove_managed_device(ip_address)
    
    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, ["light", "switch", "text", "select", "sensor", "number", "button", "camera"])
    
    # Clean up entry-specific data
    if DOMAIN in hass.data and entry.entry_id in hass.data[DOMAIN]:
        del hass.data[DOMAIN][entry.entry_id]
    
    # If no more entries remain, clean up global state so sensors get recreated on re-add
    remaining_entries = hass.config_entries.async_entries(DOMAIN)
    if not remaining_entries or (len(remaining_entries) == 1 and remaining_entries[0].entry_id == entry.entry_id):
        _LOGGER.debug("Last Yeelight Cube Lite entry unloaded - clearing global state")
        if DOMAIN in hass.data:
            hass.data[DOMAIN].pop("sensors_created", None)
            hass.data[DOMAIN].pop("palette_sensor_entity", None)
            hass.data[DOMAIN].pop("pixelart_sensor_entity", None)
    
    _LOGGER.debug(f"Unloaded Yeelight Cube Lite at {ip_address}")
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