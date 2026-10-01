"""Entity-facing actions of the Yeelight Cube Lite (``yeelight_cube.*``).

The actions are registered by area, one module each:

- ``light_services_display``     text, colors, gradients, brightness, orientation,
                                 image, freeze and save/restore of the display
- ``light_services_palette``     color palettes
- ``light_services_clock_presets`` saved solid-color clock presets
- ``light_services_pixel_art``   pixel arts (+ the pixel-art websocket command)
- ``light_services_native``      native effects, clock styles, physical button,
                                 rotation and favourites
- ``light_services_diagnostics`` raw firmware commands and calibration
- ``light_services_common``      shared helpers, limits and schemas

Device discovery and management actions are in ``discovery_services``.

light.py re-exports :func:`async_setup_light_services` from the bottom of that
module, so ``from .light import async_setup_light_services`` keeps working
without a circular-import problem (these modules import names back from a
fully-loaded light.py at that point).
"""
import logging

from homeassistant.core import HomeAssistant  # type: ignore

from .light_services_clock_presets import async_register_clock_preset_services
from .light_services_diagnostics import async_register_diagnostics_services
from .light_services_display import async_register_display_services
from .light_services_native import async_register_native_services
from .light_services_palette import async_register_palette_services
from .light_services_pixel_art import async_register_pixel_art_services

_LOGGER = logging.getLogger(__name__)


def async_setup_light_services(hass: HomeAssistant) -> bool:
    """Register the entity-facing actions. They stay registered for the
    whole Home Assistant session.

    Setup and entry setup both call this function; re-registration replaces
    the existing handlers. It does not reimport modified Python modules:
    restart Home Assistant to load backend code changes.
    """
    _LOGGER.debug("[SERVICES] Registering Yeelight Cube Lite light services")
    async_register_display_services(hass)
    async_register_palette_services(hass)
    async_register_clock_preset_services(hass)
    async_register_pixel_art_services(hass)
    async_register_native_services(hass)
    async_register_diagnostics_services(hass)
    return True
