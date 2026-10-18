"""Diagnostics: the "Download diagnostics" file of a lamp (its integration
entry or its device page), what a bug report needs about it.

Its configuration, the lamp's model and firmware, the connection (transport,
failures, the last errors) and the entity's state (its attributes, as the
cards read them). The lamp's address and identifiers are redacted everywhere,
also inside texts (the entry title, entity ids, error messages); so is the
text it shows."""
from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import REDACTED, async_redact_data  # type: ignore
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.helpers.device_registry import DeviceEntry  # type: ignore

from .const import CONF_DEVICE_ID, CONF_IP, DOMAIN
from .runtime_data import lamp_of

# Keys whose values identify the lamp or what it displays, in the entry's
# data and options and the entity's attributes.
TO_REDACT = {CONF_IP, CONF_DEVICE_ID, "ip_address", "custom_text"}
# The same in the lamp's capabilities (its own answer): its id and the name
# set in the Yeelight app.
CAPABILITIES_TO_REDACT = {"id", "name"}
# Attributes left out: the frame (100 colors; its lit pixel count instead)
# and the effect catalog (the same for every lamp).
LEFT_OUT = {"matrix_colors", "native_effect_catalog"}
# The shared collections: their sizes only.
COLLECTIONS = ("palettes_v2", "pixel_arts", "clock_presets")


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """The lamp's diagnostics (one lamp per entry)."""
    domain_data = hass.data.get(DOMAIN, {})
    light = lamp_of(entry)
    secrets = _secrets(entry, light)
    return _scrub(
        {
            "entry": {
                "title": entry.title,
                "data": async_redact_data(dict(entry.data), TO_REDACT),
                "options": async_redact_data(dict(entry.options), TO_REDACT),
            },
            # None until the lamp is set up (it did not answer yet).
            "lamp": None if light is None else lamp_diagnostics(light),
            "collections": {
                name: len(domain_data.get(name) or []) for name in COLLECTIONS
            },
        },
        secrets,
    )


async def async_get_device_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry, device: DeviceEntry
) -> dict[str, Any]:
    """The same from the lamp's device page."""
    return await async_get_config_entry_diagnostics(hass, entry)


def lamp_diagnostics(light) -> dict[str, Any]:
    """A set-up lamp: the device, its connection and its entity's state."""
    cube_matrix = light._cube_matrix
    attributes = dict(light.extra_state_attributes)
    frame = attributes.get("matrix_colors") or []
    state = {key: value for key, value in attributes.items() if key not in LEFT_OUT}
    state["matrix_lit_pixels"] = sum(1 for rgb in frame if tuple(rgb) != (0, 0, 0))
    return {
        "device": {
            "model": cube_matrix.device_model,
            "firmware": cube_matrix.firmware_version,
            "capabilities": async_redact_data(
                dict(cube_matrix.capabilities), CAPABILITIES_TO_REDACT
            ),
        },
        "available": light.available,
        "is_on": light._is_on,
        "brightness": light._brightness,
        "connection": {
            **cube_matrix.connection_state(),
            "last_connection_error": light._last_connection_error,
            "display_retries": light._display_retry_count,
            "recent_hard_timeouts": len(light._hard_timeout_times),
            "operation": light._hardware_operation_phase,
        },
        "state": async_redact_data(state, TO_REDACT),
    }


def _secrets(entry, light) -> set[str]:
    """The lamp's address (its current one and the entry's) and identifier,
    also as written in entity ids (dots as underscores)."""
    values = {
        entry.data.get(CONF_IP),
        entry.data.get(CONF_DEVICE_ID),
        entry.unique_id,
        getattr(getattr(entry, "runtime_data", None), "active_ip", None),
    }
    if light is not None:
        values |= {light._ip, light._cube_matrix.device_id}
    found = {str(value) for value in values if value}
    return found | {value.replace(".", "_") for value in found}


def _scrub(value, secrets: set[str]):
    """``value`` with every secret replaced inside its texts, longest first
    (an address is not left half-replaced by a shorter one it contains)."""
    if isinstance(value, str):
        for secret in sorted(secrets, key=len, reverse=True):
            value = value.replace(secret, REDACTED)
        return value
    if isinstance(value, dict):
        return {key: _scrub(item, secrets) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub(item, secrets) for item in value]
    return value
