"""A lamp's Power cycle sensor: on while it has a Repairs issue that
only turning its power off and on fixes (issues.POWER_CYCLE_ISSUES), so an
automation can switch the plug it is on off and on."""
from __future__ import annotations

from homeassistant.components.binary_sensor import (  # type: ignore
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.const import EntityCategory  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback  # type: ignore

from .entity import CubeDeviceEntity
from .runtime_data import lamp_of

# Its state only changes with the light's problem check.
PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    light_entity = lamp_of(config_entry)
    if light_entity is None:
        return
    async_add_entities([YeelightCubeNeedsPowerCycleSensor(light_entity)])


class YeelightCubeNeedsPowerCycleSensor(CubeDeviceEntity, BinarySensorEntity):
    """On while the lamp needs its power turned off and on: it accepts
    connections but answers no command (stuck), or answers no command over
    UDP. Set by the light's check every minute (light._async_check_problems),
    so it turns on about two minutes after the lamp stops answering, and off
    once the lamp answers again. Stays available while the lamp is not
    reachable: that is when it matters."""

    _attr_should_poll = False
    _attr_translation_key = "needs_power_cycle"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, light_entity):
        self._light_entity = light_entity
        self._attr_unique_id = f"{light_entity.unique_id}_needs_power_cycle"

    @property
    def is_on(self) -> bool:
        return self._light_entity.power_cycle_reason is not None

    @property
    def extra_state_attributes(self):
        # The Repairs issue behind it: lamp_not_responding, matrix_lan_stuck
        # or udp_unanswered (None while off).
        return {"reason": self._light_entity.power_cycle_reason}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._listen_to_light("power_cycle")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)
