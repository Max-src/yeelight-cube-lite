"""The ``yeelight_cube/stream_frames`` websocket subscription: every frame a
light's stream sends (light_studio.add_stream_preview_listener), for the
cards' live previews, so they show exactly what the lamp was sent rather
than their own drawing of the effect (its own start and random seeds).

Each event is ``{"frame": <base64 of 100 R, G, B bytes>}``: lamp order (row 0
at the bottom), in the colours a preview shows (light_studio.
_publish_stream_frame), before the preview's brightness boost.
"""
from __future__ import annotations

import base64

import voluptuous as vol  # type: ignore
from homeassistant.components import websocket_api  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore

from .const import DOMAIN
from .runtime_data import lamp_of


def encode_preview_frame(frame) -> str:
    """A frame as the event carries it."""
    return base64.b64encode(
        bytes(max(0, min(255, int(channel))) for rgb in frame for channel in tuple(rgb)[:3])
    ).decode("ascii")


def _light_for(hass: HomeAssistant, entity_id: str):
    for entry in hass.config_entries.async_entries(DOMAIN):
        light = lamp_of(entry)
        if light is not None and light.entity_id == entity_id:
            return light
    return None


@websocket_api.websocket_command({
    vol.Required("type"): "yeelight_cube/stream_frames",
    vol.Required("entity_id"): str,
})
@callback
def ws_stream_frames(hass: HomeAssistant, connection, msg) -> None:
    """Subscribe to a light's streamed frames."""
    light = _light_for(hass, msg["entity_id"])
    if light is None:
        connection.send_error(msg["id"], "not_found", f"No Yeelight Cube light {msg['entity_id']}")
        return

    @callback
    def send(frame) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"frame": encode_preview_frame(frame)}))

    connection.subscriptions[msg["id"]] = light.add_stream_preview_listener(send)
    connection.send_result(msg["id"])


def async_register_stream_preview(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_stream_frames)
