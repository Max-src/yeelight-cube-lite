"""A light's settings survive a restart while its lamp is unreachable.

Home Assistant saves an unavailable entity's state without attributes, so a
stuck lamp came back on the default effect and colours (2026-11-14). The
settings are also saved apart (extra_restore_state_data), and restored from
there when the state has none."""
from types import SimpleNamespace

from homeassistant.core import State
from homeassistant.helpers.json import json_dumps
from homeassistant.helpers.restore_state import RestoredExtraData

from custom_components.yeelight_cube.light import YeelightCubeLight
from custom_components.yeelight_cube.light_restore import SavedSettings

SETTINGS = {"mode": "Native Effect", "native_effect": "Falling Blocks", "text_colors": [[1, 2, 3]], "brightness": 80}


def _light(state, extra):
    async def last_state():
        return state

    async def last_extra():
        return extra

    return SimpleNamespace(_ip="192.0.2.1", async_get_last_state=last_state, async_get_last_extra_data=last_extra)


async def test_an_unavailable_state_restores_the_settings_saved_apart(hass):
    unavailable = State("light.cube", "unavailable", {"friendly_name": "Cube"})
    restored = await YeelightCubeLight._last_settings(_light(unavailable, RestoredExtraData(SETTINGS)))
    assert restored.attributes == SETTINGS
    assert restored.state == "unavailable"


async def test_a_state_with_its_settings_is_used_as_before(hass):
    state = State("light.cube", "on", {"mode": "Text", "custom_text": "HI", "brightness": 120})
    restored = await YeelightCubeLight._last_settings(_light(state, RestoredExtraData(SETTINGS)))
    assert restored is state


async def test_a_light_that_was_off_keeps_the_brightness_saved_apart(hass):
    # An off light publishes no brightness: the one saved apart is used.
    state = State("light.cube", "off", {"mode": "Text", "custom_text": "HI"})
    restored = await YeelightCubeLight._last_settings(_light(state, RestoredExtraData(SETTINGS)))
    assert restored.state == "off"
    assert restored.attributes == {"mode": "Text", "custom_text": "HI", "brightness": 80}
    # Nothing saved apart (an older version): the state, whatever it holds.
    assert await YeelightCubeLight._last_settings(_light(None, None)) is None
    empty = State("light.cube", "unavailable", {})
    assert await YeelightCubeLight._last_settings(_light(empty, RestoredExtraData({}))) is empty


def test_the_saved_settings_are_json_as_home_assistant_stores_them():
    saved = SavedSettings({**SETTINGS, "favourites": {"native": [{"name": "Waves"}]}, "angle": 0.0})
    assert '"native_effect":"Falling Blocks"' in json_dumps(saved.as_dict())
    light = SimpleNamespace(extra_state_attributes={"mode": "Clock"}, _brightness=42, _is_on=False)
    data = YeelightCubeLight.extra_restore_state_data.fget(light).as_dict()
    assert data == {"mode": "Clock", "brightness": 42, "is_on": False}
