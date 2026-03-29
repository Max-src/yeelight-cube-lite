import logging
import voluptuous as vol # type: ignore
from homeassistant import config_entries # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.core import callback # type: ignore
from .const import DOMAIN, CONF_IP

_LOGGER = logging.getLogger(__name__)

class YeelightCubeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Yeelight Cube Lite."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        errors = {}
        
        if user_input is not None:
            ip_address = user_input[CONF_IP]
            
            # Check if this IP is already configured
            await self.async_set_unique_id(ip_address)
            self._abort_if_unique_id_configured()
            
            # Simple validation - check if IP format is reasonable
            if not ip_address or not ip_address.replace(".", "").replace(":", "").isdigit():
                errors[CONF_IP] = "invalid_ip"
            else:
                return self.async_create_entry(
                    title=f"Yeelight Cube Lite ({ip_address})", 
                    data={CONF_IP: ip_address}
                )

        return self.async_show_form(
            step_id="user", 
            data_schema=self._get_schema(),
            errors=errors,
            description_placeholders={
                "example_ip": "192.168.4.139"
            }
        )

    @staticmethod
    def _get_schema():
        return vol.Schema({
            vol.Required(CONF_IP): str,
        })

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Get the options flow for this handler."""
        return YeelightCubeOptionsFlow(config_entry)


class YeelightCubeOptionsFlow(config_entries.OptionsFlow):
    """Handle Yeelight Cube Lite options."""

    def __init__(self, config_entry):
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                # Add any options here in the future
            })
        )