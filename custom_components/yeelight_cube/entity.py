"""Shared device grouping and availability for the entities of one lamp."""
from __future__ import annotations

from .const import DOMAIN


def cube_device_info(light_entity) -> dict:
    """Device info for a lamp. Every entity of the lamp returns this same
    dict, so the device registry does not change depending on which entity
    wrote it last."""
    cube_matrix = light_entity._cube_matrix
    info = {
        "identifiers": {(DOMAIN, light_entity._config_entry.entry_id)},
        "name": light_entity._attr_name,
        "manufacturer": "Yeelight",
        "model": cube_matrix.device_model or "Cube Lite",
    }
    if cube_matrix.firmware_version:
        info["sw_version"] = cube_matrix.firmware_version
    return info


class CubeDeviceEntity:
    """An entity grouped under its lamp's device. Stays available while the
    lamp is unreachable (integration settings, the reconnect button, the
    preview). Subclasses set ``self._light_entity``."""

    @property
    def device_info(self) -> dict:
        return cube_device_info(self._light_entity)


class CubeControlEntity(CubeDeviceEntity):
    """A control that acts on the lamp: unavailable while it is unreachable.

    Registers with the light, which rewrites its controls' state whenever the
    lamp's availability changes."""

    @property
    def available(self) -> bool:
        return self._light_entity.available

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._light_entity._control_entities.add(self)

    async def async_will_remove_from_hass(self) -> None:
        self._light_entity._control_entities.discard(self)
        await super().async_will_remove_from_hass()
