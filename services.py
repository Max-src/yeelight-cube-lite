"""Service definitions for Yeelight Cube component."""
import logging
import voluptuous as vol # type: ignore
from homeassistant.core import HomeAssistant, ServiceCall, callback # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.helpers.discovery_flow import async_create_flow # type: ignore
from .const import DOMAIN
from .conflict_prevention import get_conflict_prevention
from .discovery import is_cube_device
from .rediscovery_utils import force_rediscovery, trigger_manual_discovery

_LOGGER = logging.getLogger(__name__)

# Service schemas
SERVICE_ADD_MANAGED_DEVICE = "add_managed_device"
SERVICE_REMOVE_MANAGED_DEVICE = "remove_managed_device"
SERVICE_IS_DEVICE_MANAGED = "is_device_managed"
SERVICE_LIST_MANAGED_DEVICES = "list_managed_devices"
SERVICE_TEST_DEVICE_DETECTION = "test_device_detection"
SERVICE_IGNORE_YEELIGHT_DISCOVERY = "ignore_yeelight_discovery"
SERVICE_FORCE_REDISCOVERY = "force_rediscovery"
SERVICE_TRIGGER_MANUAL_DISCOVERY = "trigger_manual_discovery"
SERVICE_CREATE_CUBE_DISCOVERY = "create_cube_discovery"
SERVICE_IGNORE_SPECIFIC_YEELIGHT = "ignore_specific_yeelight"

ATTR_IP_ADDRESS = "ip_address"
ATTR_DEVICE_MODEL = "device_model"
ATTR_DEVICE_NAME = "device_name"
ATTR_DEVICE_ID = "device_id"

SERVICE_ADD_MANAGED_DEVICE_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
})

SERVICE_REMOVE_MANAGED_DEVICE_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
})

SERVICE_IS_DEVICE_MANAGED_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
})

SERVICE_TEST_DEVICE_DETECTION_SCHEMA = vol.Schema({
    vol.Optional(ATTR_DEVICE_MODEL, default=""): cv.string,
    vol.Optional(ATTR_DEVICE_NAME, default=""): cv.string,
    vol.Optional(ATTR_DEVICE_ID, default=""): cv.string,
})

SERVICE_IGNORE_YEELIGHT_DISCOVERY_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
})

SERVICE_FORCE_REDISCOVERY_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
})

SERVICE_TRIGGER_MANUAL_DISCOVERY_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
    vol.Optional(ATTR_DEVICE_NAME, default=""): cv.string,
    vol.Optional(ATTR_DEVICE_MODEL, default="cubelite"): cv.string,
    vol.Optional(ATTR_DEVICE_ID, default=""): cv.string,
})

SERVICE_CREATE_CUBE_DISCOVERY_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
    vol.Optional(ATTR_DEVICE_NAME, default=""): cv.string,
})

SERVICE_IGNORE_SPECIFIC_YEELIGHT_SCHEMA = vol.Schema({
    vol.Required(ATTR_IP_ADDRESS): cv.string,
})

@callback
def async_setup_services(hass: HomeAssistant):
    """Set up services for Yeelight Cube component."""
    
    async def add_managed_device(call: ServiceCall):
        """Add a device to the managed list."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        conflict_prevention = get_conflict_prevention(hass)
        conflict_prevention.add_managed_device(ip_address)
    
    async def remove_managed_device(call: ServiceCall):
        """Remove a device from the managed list."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        conflict_prevention = get_conflict_prevention(hass)
        conflict_prevention.remove_managed_device(ip_address)
    
    async def is_device_managed(call: ServiceCall):
        """Check if a device is managed."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        conflict_prevention = get_conflict_prevention(hass)
        is_managed = conflict_prevention.is_device_managed(ip_address)
        
        # Return result via event
        hass.bus.async_fire(f"{DOMAIN}_device_check_result", {
            "ip_address": ip_address,
            "is_managed": is_managed
        })
    
    async def list_managed_devices(call: ServiceCall):
        """List all managed devices."""
        conflict_prevention = get_conflict_prevention(hass)
        managed_devices = list(conflict_prevention.get_managed_devices())
        
        # Return result via event
        hass.bus.async_fire(f"{DOMAIN}_managed_devices_list", {
            "devices": managed_devices
        })
    
    async def test_device_detection(call: ServiceCall):
        """Test device detection logic with provided parameters."""
        device_model = call.data.get(ATTR_DEVICE_MODEL, "")
        device_name = call.data.get(ATTR_DEVICE_NAME, "")
        device_id = call.data.get(ATTR_DEVICE_ID, "")
        
        # Test the detection logic
        would_be_detected = is_cube_device(device_model, device_name, device_id)
        
        # Return result via event
        hass.bus.async_fire(f"{DOMAIN}_detection_test_result", {
            "device_model": device_model,
            "device_name": device_name,
            "device_id": device_id,
            "would_be_detected": would_be_detected
        })
    
    async def ignore_yeelight_discovery(call: ServiceCall):
        """Force ignore a specific IP in Yeelight integration discovered devices."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        
        # Add to our managed devices list
        conflict_prevention = get_conflict_prevention(hass)
        conflict_prevention.add_managed_device(ip_address)
        
        # Try to remove from Yeelight integration discovered devices
        try:
            # Get all discovery flows
            flows = hass.config_entries.flow.async_progress_by_domain("yeelight")
            
            # Find and abort flows for this IP
            for flow in flows:
                flow_data = flow.get("context", {})
                if flow_data.get("source") == "zeroconf":
                    # Check if this flow is for our IP
                    host = flow.get("context", {}).get("unique_id", "")
                    if ip_address in host or host == ip_address:
                        await hass.config_entries.flow.async_abort(flow["flow_id"])
                        _LOGGER.debug(f"Aborted Yeelight discovery flow for {ip_address}")
            
            # Fire success event
            hass.bus.async_fire(f"{DOMAIN}_yeelight_discovery_ignored", {
                "ip_address": ip_address,
                "success": True
            })
            
        except Exception as e:
            _LOGGER.error(f"Failed to ignore Yeelight discovery for {ip_address}: {e}")
            hass.bus.async_fire(f"{DOMAIN}_yeelight_discovery_ignored", {
                "ip_address": ip_address,
                "success": False,
                "error": str(e)
            })
    
    async def force_rediscovery_service(call: ServiceCall):
        """Force rediscovery by clearing caches."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        await force_rediscovery(hass, ip_address)
        
        hass.bus.async_fire(f"{DOMAIN}_rediscovery_forced", {
            "ip_address": ip_address
        })
    
    async def trigger_manual_discovery_service(call: ServiceCall):
        """Manually trigger discovery for testing."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        device_info = {
            "name": call.data.get(ATTR_DEVICE_NAME) or f"Test Device {ip_address}",
            "model": call.data.get(ATTR_DEVICE_MODEL, "cubelite"),
            "id": call.data.get(ATTR_DEVICE_ID) or "0x12345678"
        }
        
        await trigger_manual_discovery(hass, ip_address, device_info)
        
        hass.bus.async_fire(f"{DOMAIN}_manual_discovery_triggered", {
            "ip_address": ip_address,
            "device_info": device_info
        })
    
    async def create_cube_discovery(call: ServiceCall):
        """Create a discovery flow specifically for our Yeelight Cube component."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        device_name = call.data.get(ATTR_DEVICE_NAME) or f"Yeelight Cube {ip_address}"
        
        try:
            # Create discovery flow directly for our component
            await async_create_flow(
                hass,
                DOMAIN,
                context={"source": "service_discovery"},
                data={
                    "host": ip_address,
                    "name": device_name,
                    "model": "cubelite",
                    "device_id": "manual",
                    "discovered": True,
                    "manual": True
                }
            )
            
            _LOGGER.debug(f"Created discovery flow for Yeelight Cube component at {ip_address}")
            
            hass.bus.async_fire(f"{DOMAIN}_cube_discovery_created", {
                "ip_address": ip_address,
                "device_name": device_name,
                "success": True
            })
            
        except Exception as e:
            _LOGGER.error(f"Failed to create cube discovery flow: {e}")
            hass.bus.async_fire(f"{DOMAIN}_cube_discovery_created", {
                "ip_address": ip_address,
                "success": False,
                "error": str(e)
            })
    
    async def ignore_specific_yeelight(call: ServiceCall):
        """Ignore a specific IP address in the Yeelight integration without affecting others."""
        ip_address = call.data[ATTR_IP_ADDRESS]
        
        try:
            # Use Home Assistant's built-in ignore functionality
            await hass.services.async_call(
                "homeassistant",
                "ignore_discovered_device",
                {
                    "domain": "yeelight",
                    "unique_id": ip_address
                }
            )
            
            # Also add to our managed devices list
            conflict_prevention = get_conflict_prevention(hass)
            conflict_prevention.add_managed_device(ip_address)
            
            _LOGGER.debug(f"Ignored {ip_address} in Yeelight integration and added to managed devices")
            
            hass.bus.async_fire(f"{DOMAIN}_yeelight_device_ignored", {
                "ip_address": ip_address,
                "success": True
            })
            
        except Exception as e:
            _LOGGER.error(f"Failed to ignore Yeelight device {ip_address}: {e}")
            hass.bus.async_fire(f"{DOMAIN}_yeelight_device_ignored", {
                "ip_address": ip_address,
                "success": False,
                "error": str(e)
            })
    
    # Register services
    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_MANAGED_DEVICE,
        add_managed_device,
        schema=SERVICE_ADD_MANAGED_DEVICE_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_REMOVE_MANAGED_DEVICE,
        remove_managed_device,
        schema=SERVICE_REMOVE_MANAGED_DEVICE_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_IS_DEVICE_MANAGED,
        is_device_managed,
        schema=SERVICE_IS_DEVICE_MANAGED_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_LIST_MANAGED_DEVICES,
        list_managed_devices,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_TEST_DEVICE_DETECTION,
        test_device_detection,
        schema=SERVICE_TEST_DEVICE_DETECTION_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_IGNORE_YEELIGHT_DISCOVERY,
        ignore_yeelight_discovery,
        schema=SERVICE_IGNORE_YEELIGHT_DISCOVERY_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_FORCE_REDISCOVERY,
        force_rediscovery_service,
        schema=SERVICE_FORCE_REDISCOVERY_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_TRIGGER_MANUAL_DISCOVERY,
        trigger_manual_discovery_service,
        schema=SERVICE_TRIGGER_MANUAL_DISCOVERY_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_CREATE_CUBE_DISCOVERY,
        create_cube_discovery,
        schema=SERVICE_CREATE_CUBE_DISCOVERY_SCHEMA,
    )
    
    hass.services.async_register(
        DOMAIN,
        SERVICE_IGNORE_SPECIFIC_YEELIGHT,
        ignore_specific_yeelight,
        schema=SERVICE_IGNORE_SPECIFIC_YEELIGHT_SCHEMA,
    )

@callback
def async_remove_services(hass: HomeAssistant):
    """Remove services for Yeelight Cube component."""
    hass.services.async_remove(DOMAIN, SERVICE_ADD_MANAGED_DEVICE)
    hass.services.async_remove(DOMAIN, SERVICE_REMOVE_MANAGED_DEVICE)
    hass.services.async_remove(DOMAIN, SERVICE_IS_DEVICE_MANAGED)
    hass.services.async_remove(DOMAIN, SERVICE_LIST_MANAGED_DEVICES)
    hass.services.async_remove(DOMAIN, SERVICE_TEST_DEVICE_DETECTION)
    hass.services.async_remove(DOMAIN, SERVICE_IGNORE_YEELIGHT_DISCOVERY)
    hass.services.async_remove(DOMAIN, SERVICE_FORCE_REDISCOVERY)
    hass.services.async_remove(DOMAIN, SERVICE_TRIGGER_MANUAL_DISCOVERY)
    hass.services.async_remove(DOMAIN, SERVICE_CREATE_CUBE_DISCOVERY)
    hass.services.async_remove(DOMAIN, SERVICE_IGNORE_SPECIFIC_YEELIGHT)