"""Device registry integration for Yeelight Cube."""
import logging
from typing import Any, Dict
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers import device_registry as dr # type: ignore
from homeassistant.helpers.entity import DeviceInfo # type: ignore
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class YeelightCubeDeviceManager:
    """Manage Yeelight Cube devices in the device registry."""
    
    def __init__(self, hass: HomeAssistant):
        """Initialize the device manager."""
        self.hass = hass
        self._device_registry = dr.async_get(hass)
    
    @callback
    def register_device(self, ip_address: str, device_info: Dict[str, Any]) -> dr.DeviceEntry:
        """Register a Yeelight Cube device in the device registry."""
        
        # Create unique identifiers for the device
        identifiers = {(DOMAIN, ip_address)}
        
        # Extract device information
        name = device_info.get("name", f"Yeelight Cube {ip_address}")
        model = device_info.get("model", "Cube Lite")
        manufacturer = device_info.get("manufacturer", "Yeelight")
        sw_version = device_info.get("sw_version")
        hw_version = device_info.get("hw_version")
        
        # Register the device
        device = self._device_registry.async_get_or_create(
            config_entry_id=device_info.get("config_entry_id"),
            identifiers=identifiers,
            manufacturer=manufacturer,
            model=model,
            name=name,
            sw_version=sw_version,
            hw_version=hw_version,
            suggested_area=device_info.get("area"),
        )
        
        # Add connection information for network discovery prevention
        connections = {(dr.CONNECTION_NETWORK_MAC, device_info.get("mac_address"))} if device_info.get("mac_address") else set()
        if connections:
            self._device_registry.async_update_device(
                device.id,
                new_connections=connections
            )
        
        _LOGGER.info(f"Registered Yeelight Cube device: {name} ({ip_address})")
        return device
    
    @callback
    def is_device_managed(self, ip_address: str) -> bool:
        """Check if a device with the given IP is already managed by this component."""
        devices = dr.async_entries_for_config_entry(
            self._device_registry,
            None  # We'll check all config entries for this domain
        )
        
        for device in devices:
            # Check if any identifier matches our domain and IP
            for identifier_domain, identifier in device.identifiers:
                if identifier_domain == DOMAIN and identifier == ip_address:
                    return True
        
        return False
    
    @callback
    def get_device_info(self, ip_address: str, config_entry_id: str) -> DeviceInfo:
        """Get device info dict for entity registration."""
        return DeviceInfo(
            identifiers={(DOMAIN, ip_address)},
            manufacturer="Yeelight",
            model="Cube Lite",
            name=f"Yeelight Cube {ip_address}",
            configuration_url=f"http://{ip_address}",
            entry_type=dr.DeviceEntryType.SERVICE,
        )

@callback
def async_get_device_manager(hass: HomeAssistant) -> YeelightCubeDeviceManager:
    """Get the device manager for Yeelight Cube."""
    if "device_manager" not in hass.data.get(DOMAIN, {}):
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        hass.data[DOMAIN]["device_manager"] = YeelightCubeDeviceManager(hass)
    
    return hass.data[DOMAIN]["device_manager"]