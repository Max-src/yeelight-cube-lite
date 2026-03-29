"""Prevention mechanism for Yeelight integration conflicts."""
import logging
from typing import Set
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from .const import DOMAIN, CONF_IP

_LOGGER = logging.getLogger(__name__)

class YeelightConflictPrevention:
    """Prevent conflicts between Yeelight Cube and built-in Yeelight integration."""
    
    def __init__(self, hass: HomeAssistant):
        """Initialize the conflict prevention manager."""
        self.hass = hass
        self._managed_ips: Set[str] = set()
        self._load_managed_devices()
    
    def _load_managed_devices(self):
        """Load managed devices from config entries."""
        entries = self.hass.config_entries.async_entries(DOMAIN)
        for entry in entries:
            ip_address = entry.data.get(CONF_IP)
            if ip_address:
                self._managed_ips.add(ip_address)
                _LOGGER.debug(f"Loaded managed device: {ip_address}")
    
    @callback
    def add_managed_device(self, ip_address: str):
        """Add a device to the managed list."""
        self._managed_ips.add(ip_address)
        _LOGGER.info(f"Added {ip_address} to managed Yeelight Cube devices")
    
    @callback
    def remove_managed_device(self, ip_address: str):
        """Remove a device from the managed list."""
        self._managed_ips.discard(ip_address)
        _LOGGER.info(f"Removed {ip_address} from managed Yeelight Cube devices")
    
    @callback
    def is_device_managed(self, ip_address: str) -> bool:
        """Check if a device is managed by the Yeelight Cube component."""
        return ip_address in self._managed_ips
    
    @callback
    def get_managed_devices(self) -> Set[str]:
        """Get all managed device IP addresses."""
        return self._managed_ips.copy()

# Global instance
_conflict_prevention = None

@callback
def get_conflict_prevention(hass: HomeAssistant) -> YeelightConflictPrevention:
    """Get the global conflict prevention instance."""
    global _conflict_prevention
    if _conflict_prevention is None:
        _conflict_prevention = YeelightConflictPrevention(hass)
    return _conflict_prevention

@callback 
def is_yeelight_cube_managed(hass: HomeAssistant, ip_address: str) -> bool:
    """Check if an IP address is managed by Yeelight Cube component.
    
    This function can be called by other integrations to check if they
    should skip discovering a device.
    """
    conflict_prevention = get_conflict_prevention(hass)
    return conflict_prevention.is_device_managed(ip_address)