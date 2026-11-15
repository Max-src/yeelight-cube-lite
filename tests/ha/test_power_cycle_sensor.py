"""The Power cycle sensor (binary_sensor.py) inside Home Assistant: on
with the Repairs issue a power cycle fixes, written by the light's check."""
from types import SimpleNamespace

from homeassistant.components.binary_sensor import BinarySensorDeviceClass

from custom_components.yeelight_cube.binary_sensor import YeelightCubeNeedsPowerCycleSensor
from custom_components.yeelight_cube.issues import POWER_CYCLE_ISSUES, power_cycle_reason


def _light():
    """The light's side the sensor uses: its id, its reason, its listeners
    (light_state.add_listener)."""
    listeners = {}

    def add_listener(topic, listener):
        listeners.setdefault(topic, []).append(listener)
        return lambda: listeners[topic].remove(listener)

    return SimpleNamespace(
        unique_id="yeelight_cube_entry", power_cycle_reason=None,
        add_listener=add_listener, listeners=listeners,
    )


def test_the_sensor_follows_the_light_s_reason():
    light = _light()
    sensor = YeelightCubeNeedsPowerCycleSensor(light)
    assert sensor.unique_id == "yeelight_cube_entry_needs_power_cycle"
    assert sensor.device_class == BinarySensorDeviceClass.PROBLEM
    assert sensor.is_on is False
    assert sensor.extra_state_attributes == {"reason": None}
    light.power_cycle_reason = "lamp_not_responding"
    assert sensor.is_on is True
    assert sensor.extra_state_attributes == {"reason": "lamp_not_responding"}


def test_only_the_issues_a_power_cycle_fixes_turn_it_on():
    assert power_cycle_reason(set()) is None
    assert power_cycle_reason({"udp_blocked", "lamp_unreachable", "orientation_unknown"}) is None
    for key in POWER_CYCLE_ISSUES:
        assert power_cycle_reason({key, "orientation_unknown"}) == key
    # The most serious one first.
    assert power_cycle_reason({"udp_unanswered", "lamp_not_responding"}) == "lamp_not_responding"


async def test_it_registers_on_its_light(hass):
    light = _light()
    sensor = YeelightCubeNeedsPowerCycleSensor(light)
    sensor.hass = hass
    sensor.entity_id = "binary_sensor.cube_needs_power_cycle"
    written = []
    sensor.async_write_ha_state = lambda: written.append(sensor.is_on)
    await sensor.async_added_to_hass()
    # The light tells it when its reason changes: it writes its state.
    assert len(light.listeners["power_cycle"]) == 1
    light.power_cycle_reason = "lamp_not_responding"
    light.listeners["power_cycle"][0]()
    assert written == [True]
