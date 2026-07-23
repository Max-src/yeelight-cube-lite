"""Switch platform for Yeelight Cube Lite Matrix."""
import logging

from homeassistant.components.switch import SwitchEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Yeelight Cube Lite switch entities from a config entry."""
    # Get the light entity data
    light_data = hass.data[DOMAIN].get(config_entry.entry_id)
    
    if not light_data:
        _LOGGER.error("No light data found for config entry")
        return
    
    # Create the switches
    switches = [
        YeelightCubeAutoTurnOnSwitch(config_entry, light_data),
        YeelightCubeClockShowDateSwitch(config_entry, light_data),
        YeelightCubeClock12HourSwitch(config_entry, light_data),
        YeelightCubeClockColonBlinkSwitch(config_entry, light_data),
        YeelightCubeScrollSwitch(config_entry, light_data),
    ]
    
    async_add_entities(switches)
    _LOGGER.debug(f"Added {len(switches)} switch entities for Yeelight Cube Lite")


class YeelightCubeAutoTurnOnSwitch(SwitchEntity):
    """Switch to control auto-turn-on behavior for Yeelight Cube Lite."""

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
            "name": self._config_entry.data.get("name", "Yeelight Cube Lite"),
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


class _YeelightCubeClockOptionSwitch(SwitchEntity):
    """Base switch for a native clock option."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_has_entity_name = True
    _attr_should_poll = False
    option_attr = ""
    option_key = ""
    option_icon = "mdi:clock-digital"

    def __init__(self, config_entry: ConfigEntry, light_data):
        self._config_entry = config_entry
        self._light_entity = light_data.get("light")
        self._attr_translation_key = self.option_key
        self._attr_unique_id = (
            f"{self._light_entity._attr_unique_id}_{self.option_key}"
        )
        self._attr_icon = self.option_icon
        self._attr_is_on = bool(getattr(self._light_entity, self.option_attr))

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    @property
    def available(self) -> bool:
        return self._light_entity is not None

    async def _set_option(self, enabled: bool) -> None:
        setattr(self._light_entity, self.option_attr, enabled)
        self._attr_is_on = enabled

        if self._light_entity._is_on and self._light_entity._mode == "Clock":
            await self._light_entity.async_apply_display_mode(
                update_type="color_change"
            )

        self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    async def async_turn_on(self, **kwargs):
        await self._set_option(True)

    async def async_turn_off(self, **kwargs):
        await self._set_option(False)

    def async_update_from_light(self):
        self._attr_is_on = bool(getattr(self._light_entity, self.option_attr))
        if self.hass is not None:
            self.async_write_ha_state()


class YeelightCubeClockShowDateSwitch(_YeelightCubeClockOptionSwitch):
    """Show the date in the native clock rotation.

    Backward-compatible shortcut for the 3-way Clock Content select:
    ON  -> "time_date" (alternate time + date)
    OFF -> "time" (time only)
    When the content is "date" (date only), this switch reads as OFF.
    """

    option_attr = "_native_clock_show_date"
    option_key = "clock_show_date"
    option_icon = "mdi:calendar-clock"

    async def _set_option(self, enabled: bool) -> None:
        # Route through the 3-way content setter so the Clock Content select
        # and this switch stay consistent.
        await self._light_entity.async_set_native_clock_content(
            "time_date" if enabled else "time"
        )
        self._attr_is_on = enabled
        self.async_write_ha_state()

    def async_update_from_light(self):
        self._attr_is_on = (
            getattr(self._light_entity, "_native_clock_content", "time")
            == "time_date"
        )
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._clock_show_date_switch_entity = self
        self.async_update_from_light()


class YeelightCubeClock12HourSwitch(_YeelightCubeClockOptionSwitch):
    """Use 12-hour time in the native clock."""

    option_attr = "_native_clock_12_hour"
    option_key = "clock_12_hour"
    option_icon = "mdi:clock-outline"

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._clock_12_hour_switch_entity = self
        self.async_update_from_light()


class YeelightCubeClockColonBlinkSwitch(_YeelightCubeClockOptionSwitch):
    """Blink the separator in the native clock."""

    option_attr = "_native_clock_colon_blink"
    option_key = "clock_colon_blink"
    option_icon = "mdi:dots-vertical"

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._clock_colon_blink_switch_entity = self
        self.async_update_from_light()


class YeelightCubeScrollSwitch(SwitchEntity):
    """Enable automatic ping-pong scrolling for text wider than the matrix."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "scroll_enabled"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, config_entry: ConfigEntry, light_data):
        self._config_entry = config_entry
        self._light_entity = light_data.get("light")
        self._attr_unique_id = f"{self._light_entity._attr_unique_id}_scroll_enabled"
        self._attr_icon = "mdi:format-text-rotation-none"
        self._attr_is_on = self._light_entity._scroll_enabled

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Lite",
        }

    @property
    def available(self) -> bool:
        return self._light_entity.available

    async def async_turn_on(self, **kwargs):
        self._light_entity._scroll_enabled = True
        self._attr_is_on = True
        if self._light_entity._max_scroll_offset > 0:
            self._light_entity._is_scrolling = True
            self._light_entity.start_scroll_timer()
        self.async_write_ha_state()
        self._light_entity.async_write_ha_state()

    async def async_turn_off(self, **kwargs):
        self._light_entity._scroll_enabled = False
        self._light_entity._is_scrolling = False
        self._light_entity.stop_scroll_timer()
        self._attr_is_on = False
        self.async_write_ha_state()
        self._light_entity.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._scroll_enabled_switch_entity = self

    def async_update_from_light(self):
        self._attr_is_on = self._light_entity._scroll_enabled
        if self.hass is not None:
            self.async_write_ha_state()
