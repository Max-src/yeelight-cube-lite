import hashlib
import json
import logging
import time
from datetime import timedelta

from homeassistant.components.sensor import (  # type: ignore
    RestoreSensor,
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import EntityCategory, UnitOfEnergy, UnitOfPower  # type: ignore
from homeassistant.core import callback  # type: ignore
from homeassistant.helpers.event import async_track_time_interval  # type: ignore
from homeassistant.helpers.entity import Entity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from .layout import FONT_MAPS, FONT_METRICS
from .const import DOMAIN, CONF_IP, CONF_DEVICE_ID
from .runtime_data import lamp_of
from .entity import CubeDeviceEntity
from .lamp_power import EnergyMeter
from .storage import COLLECTION_EVENTS

_LOGGER = logging.getLogger(__name__)

# No limit per platform: every command to the lamp already waits for the
# previous one (the device lock, light_connection._execute_hardware_op).
PARALLEL_UPDATES = 0

class YeelightCubeBaseSensor(Entity):
    """Base class for Yeelight Cube Lite sensors (of the integration, not of a
    lamp: no device; named by their translation key alone)."""

    _attr_has_entity_name = True
    def __init__(self, hass):
        self.hass = hass
        self._attr_should_poll = False

    @property
    def device_info(self):
        # Return None for integration-level entities
        return None

class ClockPresetSensor(YeelightCubeBaseSensor):
    """Shared named solid-color clocks, excluded from recorder history."""

    _unrecorded_attributes = frozenset({"clock_presets"})

    def __init__(self, hass):
        super().__init__(hass)
        self._attr_unique_id = "yeelight_cube_clock_presets"
        self._attr_translation_key = "clock_presets"

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(self.hass.bus.async_listen(
            f"{DOMAIN}_clock_presets_updated", self._handle_update,
        ))

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    async def _handle_update(self, event):
        self.async_write_ha_state()

    @property
    def state(self):
        return len(self.hass.data[DOMAIN].get("clock_presets", []))

    @property
    def extra_state_attributes(self):
        return {"clock_presets": self.hass.data[DOMAIN].get("clock_presets", [])}


class _CollectionSensor(YeelightCubeBaseSensor):
    """A shared collection for the cards (palettes, pixel arts): the list,
    its count and a hash of its content, which the cards compare to notice a
    change (www/user-collections.js). Rewritten on the collection's event;
    the hash is computed once per change, not on every state write."""

    # Subclasses: the hass.data[DOMAIN] key and attribute, the event, the
    # key the hash is computed under (as the cards have always received it)
    # and what the state counts ("50 drawings").
    _collection_key: str
    _event: str
    _hash_key: str
    _counted: str

    def __init__(self, hass):
        super().__init__(hass)
        self._content_hash = None

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        # (Unsubscribed on removal.)
        self.async_on_remove(
            self.hass.bus.async_listen(f"{DOMAIN}_{self._event}", self._handle_update)
        )

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    @callback
    def _handle_update(self, _event=None):
        self._content_hash = None
        self.async_write_ha_state()

    def _items(self) -> list:
        return self.hass.data.get(DOMAIN, {}).get(self._collection_key, [])

    @property
    def state(self):
        return f"{len(self._items())} {self._counted}"

    @property
    def extra_state_attributes(self):
        items = self._items()
        if self._content_hash is None:
            content = json.dumps({self._hash_key: items, "count": len(items)}, sort_keys=True)
            self._content_hash = hashlib.md5(content.encode("utf-8")).hexdigest()
        return {
            # A copy: Home Assistant compares it with the previous state's.
            self._collection_key: list(items),
            "content_hash": self._content_hash,
            "count": len(items),
        }


class PaletteSensor(_CollectionSensor):
    """The saved palettes (palettes_v2), excluded from the recorder (cards
    read them live; their history is of no use)."""

    _unrecorded_attributes = frozenset({"palettes_v2"})
    _collection_key = "palettes_v2"
    _event = COLLECTION_EVENTS["palettes_v2"]
    _hash_key = "palettes"
    _counted = "palettes"

    def __init__(self, hass):
        super().__init__(hass)
        self._attr_unique_id = "yeelight_cube_color_palettes"
        self._attr_translation_key = "palettes"

class LetterMapSensor(YeelightCubeBaseSensor):
    """Sensor exposing the static letter map for the Yeelight Cube Lite."""
    
    # Static font data is large and never changes — keep it out of the recorder.
    _unrecorded_attributes = frozenset({"font_maps", "font_metrics"})
    
    def __init__(self, hass):
        super().__init__(hass)
        self._attr_unique_id = "yeelight_cube_font_letter_map"
        self._attr_translation_key = "font_characters"

    @property
    def state(self):
        return "ready"

    @property
    def extra_state_attributes(self):
        # Expose all available fonts, their letter maps, and per-font spacing
        # metrics (monospace advances) so frontend cards render text/clock with
        # the exact same layout the lamp uses.
        return {"font_maps": FONT_MAPS, "font_metrics": FONT_METRICS}

class PixelArtSensor(_CollectionSensor):
    """The saved pixel arts, excluded from the recorder (over 16 KB)."""

    _unrecorded_attributes = frozenset({"pixel_arts"})
    _collection_key = "pixel_arts"
    _event = COLLECTION_EVENTS["pixel_arts"]
    _hash_key = "pixel_arts"
    _counted = "drawings"

    def __init__(self, hass):
        super().__init__(hass)
        self._attr_unique_id = "yeelight_cube_saved_pixel_arts"
        self._attr_translation_key = "pixel_arts"
        self._attr_force_update = False

class YeelightCubeIPSensor(Entity):
    """Per-device sensor exposing the current IP address.

    This is a diagnostic sensor — read-only, updated automatically whenever
    the config entry is reloaded (e.g. after DHCP IP change + rediscovery).
    """

    def __init__(self, hass, config_entry: ConfigEntry):
        self.hass = hass
        self._config_entry = config_entry
        self._attr_should_poll = False
        self._attr_unique_id = f"{config_entry.entry_id}_ip_address"
        # Named after its lamp's device.
        self._attr_has_entity_name = True
        self._attr_translation_key = "ip_address"

    @property
    def device_info(self):
        """Link this sensor to the same device as the light entity."""
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
        }

    @property
    def state(self):
        """Return the current IP address from the config entry."""
        return self._config_entry.data.get(CONF_IP, "unknown")

    @property
    def extra_state_attributes(self):
        return {
            "device_id": self._config_entry.data.get(CONF_DEVICE_ID, ""),
            "entry_id": self._config_entry.entry_id,
        }

    @property
    def entity_category(self):
        """Mark as diagnostic so it doesn't clutter the main UI."""
        from homeassistant.const import EntityCategory  # type: ignore
        return EntityCategory.DIAGNOSTIC


class YeelightCubePowerSensor(CubeDeviceEntity, SensorEntity):
    """Estimated power draw of the lamp (lamp_power.py), from the frames the
    integration sends, or from the simulated preview while the firmware draws
    the matrix (clock, native effects, Music Flow). Stays available while the lamp is not
    reachable and reads 0 W then, so an energy total keeps counting."""

    _attr_should_poll = False
    _attr_translation_key = "estimated_power"
    _attr_device_class = SensorDeviceClass.POWER
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_suggested_display_precision = 1

    def __init__(self, light_entity):
        self._light_entity = light_entity
        self._attr_unique_id = f"{light_entity._attr_unique_id}_estimated_power"

    @property
    def native_value(self):
        return self._light_entity.estimated_power

    @property
    def extra_state_attributes(self):
        # "frames sent", "simulated preview" (clock, native effects, Music
        # Flow: averaged over 30 s), "off" or "unreachable"
        return {"source": self._light_entity.power_estimate_source}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._register_on_light("_power_sensor")
        await super().async_will_remove_from_hass()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


class YeelightCubeMatterLinkSensor(CubeDeviceEntity, SensorEntity):
    """Whether the lamp is linked to Home Assistant's Matter integration
    (light_matter.py, matter_link.py): not linked, linked (read only), or
    settings available (a Matter server also delivers Yeelight commands).
    The link is made on its own, whichever was set up first."""

    _attr_should_poll = False
    _attr_translation_key = "matter_link"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = ["not_linked", "linked", "settings_available"]
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, light_entity):
        self._light_entity = light_entity
        self._attr_unique_id = f"{light_entity._attr_unique_id}_matter_link"

    @property
    def native_value(self):
        return self._light_entity.matter_link_state

    @property
    def extra_state_attributes(self):
        return self._light_entity.matter_link_details

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._register_on_light("_matter_link_sensor")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


class YeelightCubeEnergySensor(CubeDeviceEntity, RestoreSensor):
    """Estimated energy used by the lamp, in kWh: the Estimated power sensor
    integrated over time (lamp_power.EnergyMeter). Add it to Home Assistant's
    Energy dashboard as an individual device. The total survives restarts;
    like the power estimate, it is an estimate, not a measurement."""

    _attr_should_poll = False
    _attr_translation_key = "estimated_energy"
    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = UnitOfEnergy.KILO_WATT_HOUR
    _attr_suggested_display_precision = 3

    # The total also advances while the power stays the same.
    UPDATE_INTERVAL = timedelta(minutes=1)

    def __init__(self, light_entity):
        self._light_entity = light_entity
        self._attr_unique_id = f"{light_entity._attr_unique_id}_estimated_energy"
        self._meter = EnergyMeter()
        self._unsub_interval = None

    @property
    def native_value(self):
        return round(self._meter.total_kwh, 6)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_sensor_data()
        if last is not None and isinstance(last.native_value, (int, float)):
            self._meter.total_kwh = float(last.native_value)
        self._meter.update(time.monotonic(), self._light_entity.estimated_power)
        self._register_on_light("_energy_sensor")
        self._unsub_interval = async_track_time_interval(
            self.hass, self._tick, self.UPDATE_INTERVAL
        )

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub_interval is not None:
            self._unsub_interval()
            self._unsub_interval = None
        await super().async_will_remove_from_hass()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    @callback
    def power_changed(self, power) -> None:
        """The estimated power changed: count the energy at the old one."""
        self._meter.update(time.monotonic(), power)
        if self.hass is not None:
            self.async_write_ha_state()

    # Without @callback, HA runs a plain timer function in a worker thread.
    @callback
    def _tick(self, _now=None) -> None:
        self.power_changed(self._light_entity.estimated_power)


def _create_and_register_sensors(hass, async_add_entities, owner_entry_id):
    """Create global sensors and register them under the given entry's platform.

    Called during initial setup AND when the owning entry is removed so sensors
    can be re-created under a remaining entry's platform.
    """
    import logging
    _LOGGER = logging.getLogger(__name__)

    sensors = [
        ClockPresetSensor(hass),
        LetterMapSensor(hass),
        PaletteSensor(hass),
        PixelArtSensor(hass),
    ]

    async_add_entities(sensors, update_before_add=True)

    hass.data[DOMAIN]["sensors_created"] = True
    hass.data[DOMAIN]["_sensor_owner_entry"] = owner_entry_id

    _LOGGER.debug(
        "Created Yeelight Cube Lite sensors (owner entry: %s): %s",
        owner_entry_id,
        [s.name for s in sensors],
    )


async def async_setup_entry(hass, entry, async_add_entities):
    """Set up sensors for Yeelight Cube Lite."""
    import logging
    _LOGGER = logging.getLogger(__name__)

    # Initialize domain data if needed
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}

    # Store this entry's async_add_entities callback so sensors can be
    # re-created under a surviving entry when the owning entry is removed.
    hass.data[DOMAIN].setdefault("_sensor_callbacks", {})[entry.entry_id] = async_add_entities

    # --- Per-device IP sensor (always created for every entry) ---
    ip_sensor = YeelightCubeIPSensor(hass, entry)
    async_add_entities([ip_sensor], update_before_add=True)

    # --- Per-device estimated power and energy ---
    light_entity = lamp_of(entry)
    if light_entity is not None:
        async_add_entities(
            [
                YeelightCubePowerSensor(light_entity),
                YeelightCubeEnergySensor(light_entity),
                YeelightCubeMatterLinkSensor(light_entity),
            ]
        )
    _LOGGER.debug("Created IP address sensor for entry %s", entry.entry_id)

    # --- Global sensors (created only once, shared across all devices) ---
    if "sensors_created" in hass.data[DOMAIN]:
        _LOGGER.debug("Global sensors already created, skipping for entry %s", entry.entry_id)
        return

    _create_and_register_sensors(hass, async_add_entities, entry.entry_id)