"""Text platform for Yeelight Cube - provides text input control for custom text display."""

import logging
from homeassistant.components.text import TextEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .const import DOMAIN, CONF_IP

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube text entity from a config entry."""
    
    ip = entry.data[CONF_IP]
    
    # Get the light entity that was set up earlier
    if DOMAIN not in hass.data or entry.entry_id not in hass.data[DOMAIN]:
        return False
    
    light_entity = hass.data[DOMAIN][entry.entry_id].get("light")
    if not light_entity:
        return False
    
    # Create text input entity
    text_entity = YeelightCubeCustomTextInput(light_entity, ip, entry)
    async_add_entities([text_entity])
    
    return True


class YeelightCubeCustomTextInput(TextEntity):
    """Text input entity for controlling custom text displayed on the Yeelight Cube."""
    
    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry):
        """Initialize the text input entity."""
        self._light_entity = light_entity
        self._ip = ip
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Display Text"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_display_text"
        self._attr_native_value = light_entity._custom_text
        self._attr_icon = "mdi:format-text"
        
        # Text input constraints
        self._attr_native_min = 0
        self._attr_native_max = 100  # Reasonable max length for scrolling text
        self._attr_pattern = None  # Allow any characters
        self._attr_mode = "text"  # Use text input mode
    
    @property
    def device_info(self):
        """Return device info to group with the light entity."""
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }
    
    @property
    def available(self) -> bool:
        """Return if entity is available."""
        return True
    
    @property
    def native_value(self) -> str:
        """Return the current text value."""
        # Always get fresh value from light entity
        return self._light_entity._custom_text
    
    async def async_set_value(self, value: str) -> None:
        """Update the text and apply to the lamp."""
        _LOGGER.info(f"[TEXT INPUT] Setting custom text to: '{value}'")
        
        # Check if light entity is ready
        if not self._light_entity.hass:
            _LOGGER.debug("[TEXT INPUT] Light entity not ready yet, skipping update")
            return
        
        # Update the light entity's custom text
        await self._light_entity.set_custom_text(value)
        
        # Disable pixel art mode — text takes priority
        self._light_entity._custom_pixels = None
        self._light_entity._custom_draw_active = False
        self._light_entity._active_pixel_art_name = None
        
        # Notify pixel art select entity (deselect)
        if self._light_entity._pixel_art_select_entity:
            self._light_entity._pixel_art_select_entity.async_update_from_light()
        
        # Apply the changes to the lamp
        await self._light_entity.async_apply_display_mode()
        
        # Update our local value
        self._attr_native_value = value
        
        # Notify Home Assistant of the state change
        if self.hass is not None:
            self.async_write_ha_state()
    
    @callback
    def async_update_from_light(self):
        """Update the text input when light entity's text changes."""
        new_value = self._light_entity._custom_text
        _LOGGER.debug(f"[TEXT INPUT] async_update_from_light called: current='{self._attr_native_value}', new='{new_value}'")
        if self._attr_native_value != new_value:
            _LOGGER.debug(f"[TEXT INPUT] Updating value from '{self._attr_native_value}' to '{new_value}'")
            self._attr_native_value = new_value
            # Only update state if we're added to hass
            if self.hass is not None:
                self.async_write_ha_state()
                _LOGGER.debug(f"[TEXT INPUT] State written to HA")
            else:
                _LOGGER.debug(f"[TEXT INPUT] Not added to hass yet, skipping state write")
        else:
            _LOGGER.debug(f"[TEXT INPUT] Value unchanged, skipping update")
    
    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()
        
        # Register this text entity with the light so it can notify us of changes
        self._light_entity._text_input_entity = self
