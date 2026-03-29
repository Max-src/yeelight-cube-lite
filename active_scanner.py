"""Active discovery scanner for Yeelight Cube devices."""
import asyncio
import logging
from typing import Set
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.discovery_flow import async_create_flow # type: ignore
from homeassistant.helpers.event import async_track_time_interval # type: ignore
from homeassistant.util import dt as dt_util # type: ignore
from datetime import timedelta
from .const import DOMAIN, CONF_IP
from .discovery import is_cube_device
from .conflict_prevention import get_conflict_prevention

_LOGGER = logging.getLogger(__name__)

class YeelightCubeScanner:
    """Scanner that actively looks for Yeelight Cube devices."""
    
    def __init__(self, hass: HomeAssistant):
        """Initialize the scanner."""
        self.hass = hass
        self._seen_devices: Set[str] = set()
        self._running = False
        self._cancel_timer = None
        
    async def start_scanning(self):
        """Start the periodic scanning."""
        if self._running:
            return
            
        self._running = True
        _LOGGER.info("Starting Yeelight Cube active scanner")
        
        # Scan immediately
        await self._scan_for_devices()
        
        # Then scan every 5 minutes
        self._cancel_timer = async_track_time_interval(
            self.hass,
            self._scan_for_devices,
            timedelta(minutes=5)
        )
    
    def stop_scanning(self):
        """Stop the periodic scanning."""
        if self._cancel_timer:
            self._cancel_timer()
            self._cancel_timer = None
        self._running = False
        _LOGGER.info("Stopped Yeelight Cube active scanner")
    
    async def _scan_for_devices(self, now=None):
        """Scan for Yeelight devices and create discovery flows for cube devices."""
        try:
            # Get all current zeroconf services
            from homeassistant.components import zeroconf # type: ignore
            
            zeroconf_instance = await zeroconf.async_get_async_instance(self.hass)
            
            # Look for both _miio._tcp.local. and _yeelight._tcp.local. services
            services_to_check = ["_miio._tcp.local.", "_yeelight._tcp.local."]
            
            for service_type in services_to_check:
                try:
                    # Browse for services of this type
                    services = zeroconf_instance.zeroconf.cache.entries_with_name(service_type)
                    
                    for service in services:
                        await self._check_service(service, service_type)
                        
                except Exception as e:
                    _LOGGER.debug(f"Error scanning {service_type}: {e}")
                    
        except Exception as e:
            _LOGGER.error(f"Error during device scan: {e}")
    
    async def _check_service(self, service, service_type):
        """Check a discovered service to see if it's a cube device."""
        try:
            # Extract service information
            if not hasattr(service, 'server') or not hasattr(service, 'port'):
                return
                
            host = str(service.server).rstrip('.')
            port = service.port
            
            # Skip if we've already seen this device
            device_key = f"{host}:{port}"
            if device_key in self._seen_devices:
                return
                
            # Get additional info from TXT records if available
            properties = {}
            if hasattr(service, 'text') and service.text:
                for txt_record in service.text:
                    if b'=' in txt_record:
                        key, value = txt_record.split(b'=', 1)
                        properties[key.decode('utf-8', errors='ignore')] = value.decode('utf-8', errors='ignore')
            
            device_model = properties.get("md", "")
            device_name = properties.get("fn", f"Device {host}")
            device_id = properties.get("id", "")
            
            # Check if this is a cube device
            if is_cube_device(device_model, device_name, device_id):
                _LOGGER.info(f"Found Yeelight Cube device via active scan: {device_name} ({device_model}) at {host}")
                
                # Add to seen devices to avoid duplicates
                self._seen_devices.add(device_key)
                
                # Check if already configured
                conflict_prevention = get_conflict_prevention(self.hass)
                if conflict_prevention.is_device_managed(host):
                    _LOGGER.debug(f"Cube device at {host} already managed, skipping")
                    return
                
                # Check if already in config entries
                existing_entries = self.hass.config_entries.async_entries(DOMAIN)
                for entry in existing_entries:
                    if entry.data.get(CONF_IP) == host:
                        _LOGGER.debug(f"Cube device at {host} already configured, skipping")
                        return
                
                # Create discovery flow for our component
                await async_create_flow(
                    self.hass,
                    DOMAIN,
                    context={"source": "active_scan"},
                    data={
                        "host": host,
                        "name": device_name,
                        "model": device_model,
                        "device_id": device_id,
                        "discovered": True,
                        "port": port,
                        "service_type": service_type
                    }
                )
                
                _LOGGER.info(f"Created discovery flow for Yeelight Cube at {host}")
                
        except Exception as e:
            _LOGGER.debug(f"Error checking service: {e}")

# Global scanner instance
_scanner = None

async def start_active_scanner(hass: HomeAssistant):
    """Start the active scanner."""
    global _scanner
    if _scanner is None:
        _scanner = YeelightCubeScanner(hass)
    
    await _scanner.start_scanning()

def stop_active_scanner():
    """Stop the active scanner."""
    global _scanner
    if _scanner:
        _scanner.stop_scanning()
        _scanner = None