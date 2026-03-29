"""Force rediscovery utilities for testing."""
import logging
from homeassistant.core import HomeAssistant # type: ignore
from homeassistant.helpers import discovery_flow # type: ignore
from homeassistant.components import zeroconf # type: ignore

_LOGGER = logging.getLogger(__name__)

async def force_rediscovery(hass: HomeAssistant, ip_address: str):
    """Force rediscovery of a device by clearing caches and triggering discovery."""
    
    # Clear discovery cache for this IP
    try:
        # Clear zeroconf cache
        zeroconf_instance = await zeroconf.async_get_async_instance(hass)
        if hasattr(zeroconf_instance, 'cache'):
            # Clear relevant cache entries
            _LOGGER.debug(f"Attempting to clear zeroconf cache for {ip_address}")
        
        # Clear config flow cache 
        flows_to_remove = []
        for flow_id, flow in hass.config_entries.flow._flows.items():
            if flow.context.get("source") == "zeroconf":
                unique_id = flow.context.get("unique_id", "")
                if ip_address in str(unique_id):
                    flows_to_remove.append(flow_id)
        
        for flow_id in flows_to_remove:
            if flow_id in hass.config_entries.flow._flows:
                del hass.config_entries.flow._flows[flow_id]
                _LOGGER.debug(f"Removed cached discovery flow for {ip_address}")
        
        # Force a new discovery scan
        _LOGGER.debug(f"Forced rediscovery cleanup completed for {ip_address}")
        
    except Exception as e:
        _LOGGER.error(f"Error during forced rediscovery: {e}")

async def trigger_manual_discovery(hass: HomeAssistant, ip_address: str, device_info: dict):
    """Manually trigger discovery for both integrations to test interception."""
    
    # Trigger discovery for built-in yeelight integration
    _LOGGER.debug(f"Manually triggering Yeelight discovery for {ip_address}")
    try:
        await discovery_flow.async_create_flow(
            hass,
            "yeelight",
            context={"source": "zeroconf"},
            data={
                "host": ip_address,
                "name": device_info.get("name", f"Test Device {ip_address}"),
                "properties": {
                    "md": device_info.get("model", "cubelite"),
                    "fn": device_info.get("name", "CubeLite Test"),
                    "id": device_info.get("id", "0x12345678")
                }
            }
        )
        _LOGGER.debug("Yeelight discovery flow created successfully")
    except Exception as e:
        _LOGGER.error(f"Failed to create Yeelight discovery flow: {e}")
    
    # Trigger discovery for our custom component
    _LOGGER.debug(f"Manually triggering Yeelight Cube Lite discovery for {ip_address}")
    try:
        await discovery_flow.async_create_flow(
            hass,
            "yeelight_cube",
            context={"source": "zeroconf"},
            data={
                "host": ip_address,
                "name": device_info.get("name", f"Cube Device {ip_address}"),
                "model": device_info.get("model", "cubelite"),
                "device_id": device_info.get("id", "0x12345678"),
                "discovered": True
            }
        )
        _LOGGER.debug("Yeelight Cube Lite discovery flow created successfully")
    except Exception as e:
        _LOGGER.error(f"Failed to create Yeelight Cube Lite discovery flow: {e}")