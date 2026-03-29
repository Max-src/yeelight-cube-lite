"""Button platform for Yeelight Cube - provides action buttons."""

import logging
from homeassistant.components.button import ButtonEntity  # type: ignore
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback  # type: ignore

from .const import DOMAIN, CONF_IP

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube button entities from a config entry."""
    if DOMAIN not in hass.data or entry.entry_id not in hass.data[DOMAIN]:
        return False

    light_entity = hass.data[DOMAIN][entry.entry_id].get("light")
    if not light_entity:
        return False

    entities = [
        YeelightCubeForceRefreshButton(light_entity, entry),
    ]
    async_add_entities(entities)
    return True


class YeelightCubeForceRefreshButton(ButtonEntity):
    """Button entity that triggers a force refresh via raw TCP on the Yeelight Cube.

    This bypasses the persistent socket, re-activates FX mode, and re-sends
    the current pixel data — recovering stuck lamps without a full power cycle.
    """

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the force refresh button entity."""
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Force Refresh"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_force_refresh"
        self._attr_icon = "mdi:refresh"
        self._attr_entity_category = EntityCategory.DIAGNOSTIC

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
        return True

    async def async_press(self) -> None:
        """Handle the button press — trigger a force refresh."""
        _LOGGER.warning(
            f"[FORCE REFRESH BUTTON] Pressed for {self._light_entity._ip} — "
            f"triggering raw TCP reconnect"
        )
        await self._light_entity.async_force_refresh()
