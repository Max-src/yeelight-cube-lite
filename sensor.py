from homeassistant.helpers.entity import Entity # type: ignore
from .layout import FONT_MAPS
from .const import DOMAIN

class YeelightCubeBaseSensor(Entity):
    """Base class for Yeelight Cube sensors."""
    def __init__(self, hass):
        self.hass = hass
        self._attr_should_poll = False

    @property
    def device_info(self):
        # Return None for integration-level entities
        return None

class PaletteSensor(YeelightCubeBaseSensor):
    """Sensor exposing the current palettes_v2 list for the Yeelight Cube."""
    
    def __init__(self, hass):
        super().__init__(hass)
        self._attr_unique_id = "yeelight_cube_color_palettes"
        self._attr_name = "Color Palettes"
        self._attr_icon = "mdi:palette"
    
    async def async_added_to_hass(self):
        """Register event listener when added to hass."""
        await super().async_added_to_hass()
        # Listen for palette update events
        self.hass.bus.async_listen(f"{DOMAIN}_palettes_updated", self._handle_update)
    
    async def _handle_update(self, event):
        """Force state update when palettes change."""
        import logging
        _LOGGER = logging.getLogger(__name__)
        event_count = event.data.get('count', 'unknown') if hasattr(event, 'data') else 'no-data'
        _LOGGER.debug(f"[PALETTE-SENSOR] Event received! Count from event: {event_count}")
        
        # Get palette data BEFORE state update
        palettes_before = self.hass.data.get(DOMAIN, {}).get("palettes_v2", [])
        _LOGGER.debug(f"[PALETTE-SENSOR] Before state update - palette count: {len(palettes_before)}")
        
        # Clear any attribute cache (if exists)
        if hasattr(self, '_attr_extra_state_attributes'):
            delattr(self, '_attr_extra_state_attributes')
        
        # Force state update using schedule (which properly triggers websocket updates)
        self.async_schedule_update_ha_state(force_refresh=True)
        
        # Force immediate write to ensure websocket gets it
        self.async_write_ha_state()
        
        # Get actual count from storage AFTER
        palettes_after = self.hass.data.get(DOMAIN, {}).get("palettes_v2", [])
        
        # Calculate new hash
        import json, hashlib
        palettes_json = json.dumps(palettes_after, sort_keys=True)
        new_hash = hashlib.md5(palettes_json.encode('utf-8')).hexdigest()
        
        _LOGGER.debug(f"[PALETTE-SENSOR] After schedule - count: {len(palettes_after)}, hash: {new_hash[:8]}...")
        if len(palettes_after) > 0:
            _LOGGER.debug(f"[PALETTE-SENSOR] Last 3 palette names: {[p.get('name', 'unnamed') for p in palettes_after[-3:]]}")

    @property
    def extra_state_attributes(self):
        """Expose palettes_v2 from hass.data[DOMAIN]['palettes_v2'] if available."""
        try:
            palettes = self.hass.data[DOMAIN].get("palettes_v2", [])
        except Exception:
            palettes = []
        
        # Calculate MD5 hash for cards to detect changes
        # Include timestamp to ensure hash changes even if palette content is identical
        import json, hashlib, logging, time
        _LOGGER = logging.getLogger(__name__)
        
        # Create hash from palette content + count (timestamp in separate field)
        hash_data = {
            "palettes": palettes,
            "count": len(palettes)
        }
        palettes_json = json.dumps(hash_data, sort_keys=True)
        content_hash = hashlib.md5(palettes_json.encode('utf-8')).hexdigest()
        
        _LOGGER.debug(f"[PALETTE-SENSOR-ATTR] Returning attributes - count: {len(palettes)}, hash: {content_hash[:8]}...")
        
        return {
            "palettes_v2": palettes,
            "content_hash": content_hash,
            "count": len(palettes),
            "last_updated": time.time()  # Force attribute change
        }

class LetterMapSensor(YeelightCubeBaseSensor):
    """Sensor exposing the static letter map for the Yeelight Cube."""
    
    def __init__(self, hass):
        super().__init__(hass)
        self._attr_unique_id = "yeelight_cube_font_letter_map"
        self._attr_name = "Font Characters"
        self._attr_icon = "mdi:alphabetical-variant"

    @property
    def state(self):
        return "ready"

    @property
    def extra_state_attributes(self):
        # Expose all available fonts and their letter maps
        return {"font_maps": FONT_MAPS}

class PixelArtSensor(YeelightCubeBaseSensor):
    """Sensor exposing the current pixel art list for the Yeelight Cube."""
    
    def __init__(self, hass):
        super().__init__(hass)
        self._attr_unique_id = "yeelight_cube_saved_pixel_arts"
        self._attr_name = "Saved Drawings"
        self._attr_icon = "mdi:image-multiple"
        # Exclude from recorder - data is too large (>16KB) for database
        self._attr_force_update = False
        
    @property
    def should_poll(self):
        """Disable polling."""
        return False
    
    @property
    def entity_registry_enabled_default(self):
        """Keep entity enabled by default."""
        return True
    
    @property
    def capability_attributes(self):
        """Return capability attributes - used to prevent recorder storage."""
        # By returning None, we signal this entity shouldn't be stored in recorder
        # The data is too large (>16KB) and would cause database issues
        return None
        
    async def async_added_to_hass(self):
        """Register event listener when added to hass."""
        await super().async_added_to_hass()
        # Listen for pixel arts update events
        self.hass.bus.async_listen(f"{DOMAIN}_pixel_arts_updated", self._handle_update)
    
    async def _handle_update(self, event):
        """Force state update when pixel arts change."""
        import logging
        _LOGGER = logging.getLogger(__name__)
        _LOGGER.debug(f"[PIXELART-SENSOR] Event received, forcing state update")
        
        # Clear any attribute cache
        if hasattr(self, '_attr_extra_state_attributes'):
            delattr(self, '_attr_extra_state_attributes')
        
        self.async_schedule_update_ha_state(force_refresh=True)
        self.async_write_ha_state()
        _LOGGER.debug(f"[PIXELART-SENSOR] State update completed")

    @property
    def state(self):
        pixel_arts = self.extra_state_attributes.get("pixel_arts", [])
        return f"{len(pixel_arts)} drawings"

    @property
    def extra_state_attributes(self):
        """
        Expose pixel_arts from hass.data[DOMAIN]['pixel_arts']
        
        CRITICAL: Also expose 'count' attribute separately because Home Assistant's
        websocket may not send the full pixel_arts array in state updates (only scalars).
        The count attribute ensures frontends can detect changes even when array is stale.
        """
        try:
            pixel_arts = self.hass.data[DOMAIN].get("pixel_arts", [])
        except Exception:
            pixel_arts = []
        
        # Calculate MD5 hash for cards to detect changes
        import json, hashlib, time
        hash_data = {
            "pixel_arts": pixel_arts,
            "count": len(pixel_arts)
        }
        pixel_arts_json = json.dumps(hash_data, sort_keys=True)
        content_hash = hashlib.md5(pixel_arts_json.encode('utf-8')).hexdigest()
        
        # Return a COPY of pixel_arts to avoid Home Assistant caching issues
        return {
            "pixel_arts": list(pixel_arts),
            "content_hash": content_hash,
            "count": len(pixel_arts),
            "last_updated": time.time()
        }

async def async_setup_entry(hass, entry, async_add_entities):
    """Set up sensors for Yeelight Cube."""
    import logging
    _LOGGER = logging.getLogger(__name__)
    
    # Initialize domain data if needed
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}
    
    # Only create sensors once (they're global, not per-device)
    if "sensors_created" in hass.data[DOMAIN]:
        _LOGGER.debug("Sensors already created, skipping duplicate creation")
        return
    
    # Mark sensors as created
    hass.data[DOMAIN]["sensors_created"] = True
    
    # Create global sensors
    sensors = [
        LetterMapSensor(hass),
        PaletteSensor(hass),
        PixelArtSensor(hass)
    ]
    
    # Add them
    async_add_entities(sensors, update_before_add=True)
    
    # Store references for the backend
    for sensor in sensors:
        if isinstance(sensor, PaletteSensor):
            hass.data[DOMAIN]["palette_sensor_entity"] = sensor
        elif isinstance(sensor, PixelArtSensor):
            hass.data[DOMAIN]["pixelart_sensor_entity"] = sensor
    
    _LOGGER.debug(f"✅ Created Yeelight Cube sensors: {[s.name for s in sensors]}")