"""The lamp's buttons as an event entity (needs Matter: light_matter.py).

The lamp reports over Matter what its buttons change: an effect (the right
button's playlist), its power (the right button's long press), a microphone
music mode (the left button) and its end (the left button's long press). The
Yeelight app changes the same values, so its changes fire the same events;
recognized echoes of integration commands are filtered. With Right button as
remote and Matter settings, tagged black playlist selections fire
"right_button". Another app replaying those tags is indistinguishable.
Unavailable while the lamp is not linked to Home Assistant's Matter
integration: without Matter it never fires.
"""
from __future__ import annotations

from homeassistant.components.event import EventDeviceClass, EventEntity  # type: ignore
from homeassistant.core import callback  # type: ignore

from .entity import CubeDeviceEntity
from .runtime_data import lamp_of

# No limit per platform: the entity only reports.
PARALLEL_UPDATES = 0

LAMP_EVENT_TYPES = [
    "right_button",
    "effect_changed",
    "music_mode_changed",
    "music_off",
    "turned_on",
    "turned_off",
]


class YeelightCubeLampButtonsEvent(CubeDeviceEntity, EventEntity):
    """What the lamp's buttons (or the Yeelight app) changed, as events."""

    _attr_should_poll = False
    _attr_translation_key = "lamp_buttons"
    _attr_device_class = EventDeviceClass.BUTTON
    _attr_event_types = LAMP_EVENT_TYPES

    def __init__(self, light_entity):
        self._light_entity = light_entity
        self._attr_unique_id = f"{light_entity._attr_unique_id}_lamp_buttons"

    @property
    def available(self) -> bool:
        return self._light_entity.matter_link_state != "not_linked"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._register_on_light("_lamp_buttons_event")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    @callback
    def lamp_event(self, event_type: str, data: dict) -> None:
        """Fire one event (light_matter._lamp_event)."""
        self._trigger_event(event_type, data)
        self.async_write_ha_state()


async def async_setup_entry(hass, entry, async_add_entities):
    light_entity = lamp_of(entry)
    if light_entity is not None:
        async_add_entities([YeelightCubeLampButtonsEvent(light_entity)])
