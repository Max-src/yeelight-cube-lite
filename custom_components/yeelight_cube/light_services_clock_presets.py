"""Clock preset actions: save and delete the shared solid-color clock presets.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .clock_presets import delete_clock_preset, save_clock_preset
from .const import DOMAIN, NATIVE_CLOCK_STYLES


def async_register_clock_preset_services(hass: HomeAssistant) -> None:
    """Register the clock preset actions."""
    preset_lock = asyncio.Lock()

    async def update_clock_presets(call):
        from . import async_save_data

        async with preset_lock:
            domain_data = hass.data.get(DOMAIN, {})
            ready = domain_data.get("storage_ready")
            if ready is not None:
                await ready.wait()
            if not domain_data.get("storage") or domain_data.get("storage_init_error"):
                raise HomeAssistantError("Clock preset storage is not ready")
            previous = domain_data.get("clock_presets", [])
            try:
                if call.service == "delete_clock_preset":
                    updated = delete_clock_preset(previous, call.data["preset_id"])
                else:
                    updated = save_clock_preset(
                        previous, call.data["name"], call.data["color"],
                        [style["name"] for style in NATIVE_CLOCK_STYLES.values()],
                        call.data.get("preset_id"),
                        kind=call.data.get("kind"),
                    )
            except ValueError as error:
                raise HomeAssistantError(str(error)) from error
            domain_data["clock_presets"] = updated
            try:
                await async_save_data(hass)
            except Exception:
                domain_data["clock_presets"] = previous
                raise
            hass.bus.async_fire(f"{DOMAIN}_clock_presets_updated")

    hass.services.async_register(
        DOMAIN, "save_clock_preset", update_clock_presets,
        schema=vol.Schema({
            vol.Required("name"): cv.string,
            vol.Required("color"): vol.All(cv.ensure_list, [vol.All(int, vol.Range(min=0, max=255))], vol.Length(min=3, max=3)),
            vol.Optional("preset_id"): cv.string,
            vol.Optional("kind"): vol.In(["style", "color_mode"]),
        }),
    )
    hass.services.async_register(
        DOMAIN, "delete_clock_preset", update_clock_presets,
        schema=vol.Schema({vol.Required("preset_id"): cv.string}),
    )
