"""Advanced discovery blocking for Yeelight Cube devices."""
import logging
from typing import Any, Dict
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers import discovery_flow # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from .const import DOMAIN, CONF_IP
from .discovery import is_cube_device

_LOGGER = logging.getLogger(__name__)

class YeelightCubeDiscoveryManager:
    """Manage discovery to prevent conflicts with built-in Yeelight integration."""
    
    def __init__(self, hass: HomeAssistant):
        """Initialize the discovery manager."""
        self.hass = hass
        self._original_create_flow = None
        self._setup_discovery_interception()
    
    def _setup_discovery_interception(self):
        """Set up interception of discovery flows."""
        try:
            # Store the original create_flow function
            self._original_create_flow = discovery_flow.async_create_flow
            
            # Replace with our intercepting version
            discovery_flow.async_create_flow = self._intercept_discovery_flow
            
            _LOGGER.debug("Discovery interception set up successfully")
        except Exception as e:
            _LOGGER.error(f"Failed to set up discovery interception: {e}")
    
    async def _intercept_discovery_flow(
        self,
        hass: HomeAssistant,
        domain: str,
        context: Dict[str, Any],
        data: Dict[str, Any]
    ):
        """Intercept discovery flows and redirect cube devices."""
        
        # Check if this is a yeelight discovery
        if domain == "yeelight" and context.get("source") == "zeroconf":
            # Extract device information
            host = data.get("host", "")
            name = data.get("name", "")
            properties = data.get("properties", {})
            
            device_model = properties.get("md", "")
            device_name = properties.get("fn", name)
            device_id = properties.get("id", "")
            
            # Check if this should be handled by our cube component
            if is_cube_device(device_model, device_name, device_id):
                _LOGGER.debug(f"Intercepting Yeelight discovery for cube device at {host}")
                
                # Check if already configured in our component
                existing_entries = hass.config_entries.async_entries(DOMAIN)
                for entry in existing_entries:
                    if entry.data.get(CONF_IP) == host:
                        _LOGGER.debug(f"Cube device at {host} already configured, ignoring")
                        return None
                
                # Create discovery flow for our component instead
                return await self._original_create_flow(
                    hass,
                    DOMAIN,
                    context={"source": "zeroconf"},
                    data={
                        "host": host,
                        "name": device_name,
                        "model": device_model,
                        "device_id": device_id,
                        "discovered": True,
                        "intercepted_from": "yeelight"
                    }
                )
            else:
                _LOGGER.debug(f"Allowing Yeelight discovery for non-cube device: {device_name} ({device_model})")
        
        # For all other cases, use the original function
        return await self._original_create_flow(hass, domain, context, data)
    
    def cleanup(self):
        """Restore original discovery flow function."""
        if self._original_create_flow:
            discovery_flow.async_create_flow = self._original_create_flow
            _LOGGER.debug("Discovery interception cleaned up")

# Global instance
_discovery_manager = None

@callback
def setup_discovery_manager(hass: HomeAssistant) -> YeelightCubeDiscoveryManager:
    """Set up the global discovery manager."""
    global _discovery_manager
    if _discovery_manager is None:
        _discovery_manager = YeelightCubeDiscoveryManager(hass)
    return _discovery_manager

@callback
def cleanup_discovery_manager():
    """Clean up the global discovery manager."""
    global _discovery_manager
    if _discovery_manager:
        _discovery_manager.cleanup()
        _discovery_manager = None