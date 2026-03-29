"""Switch platform for Yeelight Cube Matrix."""
import logging

from homeassistant.components.switch import SwitchEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Yeelight Cube switch entities from a config entry."""
    # Get the light entity data
    light_data = hass.data[DOMAIN].get(config_entry.entry_id)
    
    if not light_data:
        _LOGGER.error("No light data found for config entry")
        return
    
    # Create the switches
    switches = [
        YeelightCubeAutoTurnOnSwitch(config_entry, light_data),
        YeelightCubeFlipOrientationSwitch(config_entry, light_data)
    ]
    
    async_add_entities(switches)
    _LOGGER.debug(f"Added {len(switches)} switch entities for Yeelight Cube")


class YeelightCubeAutoTurnOnSwitch(SwitchEntity):
    """Switch to control auto-turn-on behavior for Yeelight Cube."""

    def __init__(self, config_entry: ConfigEntry, light_data):
        """Initialize the switch."""
        self._config_entry = config_entry
        self._light_data = light_data
        self._attr_name = "Auto Turn On"
        self._attr_unique_id = f"{config_entry.entry_id}_auto_turn_on"
        self._attr_icon = "mdi:lightbulb-auto"
        
        # Get the light entity to access its state
        self._light_entity = light_data.get("light")
        
        # Load saved state or default to True (current behavior)
        self._attr_is_on = config_entry.options.get("auto_turn_on", True)

    @property
    def device_info(self):
        """Return device info to group with the light entity."""
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._config_entry.data.get("name", "Yeelight Cube"),
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    async def async_turn_on(self, **kwargs):
        """Turn on auto-turn-on (enable automatic lamp activation on commands)."""
        self._attr_is_on = True
        
        # Save to config entry options
        new_options = dict(self._config_entry.options)
        new_options["auto_turn_on"] = True
        self.hass.config_entries.async_update_entry(
            self._config_entry, options=new_options
        )
        
        self.async_write_ha_state()
        _LOGGER.debug("Auto-turn-on enabled: Lamp will turn on automatically when receiving commands while off")

    async def async_turn_off(self, **kwargs):
        """Turn off auto-turn-on (disable automatic lamp activation on commands)."""
        self._attr_is_on = False
        
        # Save to config entry options
        new_options = dict(self._config_entry.options)
        new_options["auto_turn_on"] = False
        self.hass.config_entries.async_update_entry(
            self._config_entry, options=new_options
        )
        
        self.async_write_ha_state()
        _LOGGER.debug("Auto-turn-on disabled: Commands will be ignored when lamp is off")

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        return self._light_entity is not None


class YeelightCubeFlipOrientationSwitch(SwitchEntity):
    """Switch to control flip orientation (180° rotation) for Yeelight Cube."""

    def __init__(self, config_entry: ConfigEntry, light_data):
        """Initialize the switch."""
        self._config_entry = config_entry
        self._light_data = light_data
        self._attr_name = "Flip Orientation"
        self._attr_unique_id = f"{config_entry.entry_id}_flip_orientation"
        self._attr_icon = "mdi:flip-vertical"
        
        # Get the light entity to access and modify its orientation
        self._light_entity = light_data.get("light")
        
        # Load saved state from config entry options or default to False (normal)
        self._attr_is_on = config_entry.options.get("flip_orientation", False)

    @property
    def device_info(self):
        """Return device info to group with the light entity."""
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._config_entry.data.get("name", "Yeelight Cube"),
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    async def async_turn_on(self, **kwargs):
        """Turn on flip orientation (rotate display 180°)."""
        if self._light_entity:
            await self._light_entity.set_orientation("flipped")
            self._attr_is_on = True
            
            # Save to config entry options
            new_options = dict(self._config_entry.options)
            new_options["flip_orientation"] = True
            self.hass.config_entries.async_update_entry(
                self._config_entry, options=new_options
            )
            
            self.async_write_ha_state()
            _LOGGER.debug("Flip orientation enabled: Display rotated 180°")

    async def async_turn_off(self, **kwargs):
        """Turn off flip orientation (normal display orientation)."""
        if self._light_entity:
            await self._light_entity.set_orientation("normal")
            self._attr_is_on = False
            
            # Save to config entry options
            new_options = dict(self._config_entry.options)
            new_options["flip_orientation"] = False
            self.hass.config_entries.async_update_entry(
                self._config_entry, options=new_options
            )
            
            self.async_write_ha_state()
            _LOGGER.debug("Flip orientation disabled: Display in normal orientation")

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        return self._light_entity is not None

    async def async_update(self):
        """Update switch state from light entity."""
        if self._light_entity:
            self._attr_is_on = self._light_entity.orientation == "flipped"
    
    async def async_added_to_hass(self):
        """Run when entity is added to Home Assistant."""
        await super().async_added_to_hass()
        
        # Apply saved orientation state to the light entity
        if self._light_entity:
            orientation = "flipped" if self._attr_is_on else "normal"
            await self._light_entity.set_orientation(orientation)
            _LOGGER.debug(f"Restored flip orientation from saved state: {orientation}")
