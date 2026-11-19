"""The ``yeelight_cube/native_effect_catalog`` websocket command: a light's
native effect catalogue, the effects the cards list (light_attributes.
_native_effect_catalog), sent once instead of in every state write.

Request: ``{"type": "yeelight_cube/native_effect_catalog", "entity_id":
<a yeelight_cube light>}``. Result: ``{"key": <str>, "catalog": [<effect>,
...]}``, ``key`` being the light's ``native_effect_catalog_key`` attribute:
the cards fetch the catalogue again when that attribute changes.
"""
from __future__ import annotations

import voluptuous as vol  # type: ignore
from homeassistant.components import websocket_api  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore

from .stream_preview_ws import _light_for


@websocket_api.websocket_command({
    vol.Required("type"): "yeelight_cube/native_effect_catalog",
    vol.Required("entity_id"): str,
})
@callback
def ws_native_effect_catalog(hass: HomeAssistant, connection, msg) -> None:
    """Send a light's native effect catalogue and its key."""
    light = _light_for(hass, msg["entity_id"])
    if light is None:
        connection.send_error(msg["id"], "not_found", f"No Yeelight Cube light {msg['entity_id']}")
        return
    connection.send_result(msg["id"], light.native_effect_catalog())


def async_register_native_catalog(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_native_effect_catalog)
