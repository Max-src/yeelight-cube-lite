"""Shared device grouping and availability for the entities of one lamp."""
from __future__ import annotations

from homeassistant.core import HomeAssistant, callback  # type: ignore
from homeassistant.helpers import entity_registry as er  # type: ignore

from .const import DOMAIN


def remove_retired_entities(hass: HomeAssistant, platform: str, unique_ids) -> None:
    """Remove the entities an earlier version created and this one no longer
    does, so they do not stay behind as unavailable."""
    registry = er.async_get(hass)
    for unique_id in unique_ids:
        entity_id = registry.async_get_entity_id(platform, DOMAIN, unique_id)
        if entity_id is not None:
            registry.async_remove(entity_id)


def cube_device_info(light_entity) -> dict:
    """Device info for a lamp. Every entity of the lamp returns this same
    dict, so the device registry does not change depending on which entity
    wrote it last."""
    lamp_client = light_entity.lamp_client
    info = {
        "identifiers": {(DOMAIN, light_entity.entry_id)},
        "name": light_entity.lamp_name,
        "manufacturer": "Yeelight",
        "model": lamp_client.device_model or "Cube Lite",
    }
    if lamp_client.software_version:
        info["sw_version"] = firmware_version(lamp_client.device_model, lamp_client.software_version)
    return info


def firmware_version(model, version) -> str:
    """The firmware version as the Yeelight app shows it. A Cube Matrix's
    SSDP fw_ver is only its build number ("92"): its releases are 1.11.46 to
    1.11.57, then 1.12.69 on, so "92" is 1.12.92."""
    version = str(version)
    if str(model or "").lower() == "cubematrix" and version.isdigit():
        build = int(version)
        return f"1.{11 if build < 69 else 12}.{build}"
    return version


class CubeDeviceEntity:
    """An entity grouped under its lamp's device. Stays available while the
    lamp is unreachable (integration settings, the reconnect button, the
    preview). Subclasses set ``self._light_entity``.

    Named after the device: Home Assistant shows the lamp's name, then the
    entity's own, from its translation key (strings.json)."""

    _attr_has_entity_name = True

    @property
    def device_info(self) -> dict:
        return cube_device_info(self._light_entity)

    def _listen_to_light(self, topic: str, listener=None) -> None:
        """Have the light tell this entity its changes on ``topic``
        (light_state.TOPICS) until the entity is removed (disabled, or its
        lamp unloaded). ``listener`` is called with what the light tells;
        by default the entity's async_update_from_light, else its
        async_write_ha_state. Never called while the entity is not in Home
        Assistant."""
        if listener is None:
            listener = getattr(self, "async_update_from_light", None) or self.async_write_ha_state

        def tell(*args) -> None:
            if getattr(self, "hass", None) is not None:
                listener(*args)

        self.async_on_remove(self._light_entity.add_listener(topic, tell))


class CubeControlEntity(CubeDeviceEntity):
    """A control that acts on the lamp: unavailable while it is unreachable.

    Registers with the light, which rewrites its controls' state whenever the
    lamp's availability changes."""

    @property
    def available(self) -> bool:
        return self._light_entity.available

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._light_entity.add_control(self)

    async def async_will_remove_from_hass(self) -> None:
        self._light_entity.remove_control(self)
        await super().async_will_remove_from_hass()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)
