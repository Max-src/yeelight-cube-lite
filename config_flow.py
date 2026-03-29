import logging
import voluptuous as vol # type: ignore
from homeassistant import config_entries # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.core import callback # type: ignore
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo # type: ignore
from .const import DOMAIN, CONF_IP
from .discovery import is_cube_device

_LOGGER = logging.getLogger(__name__)

class YeelightCubeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Yeelight Cube Lite."""

    VERSION = 1

    _discovered_ip: str = ""
    _discovered_name: str = ""

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
                    title=f"Yeelight Cube ({ip_address})", 
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

    async def async_step_zeroconf(self, discovery_info: ZeroconfServiceInfo):
        """Handle zeroconf discovery of Yeelight devices."""
        _LOGGER.debug("Zeroconf discovery received: name=%s host=%s", discovery_info.name, discovery_info.host)

        # Extract device info from zeroconf service name and properties
        name = discovery_info.name or ""
        properties = discovery_info.properties or {}
        model = properties.get("md", "")
        device_name = properties.get("fn", "")
        device_id = properties.get("id", "")

        # Also check the service name itself (format: yeelink-light-<model>-<id>._miio._udp.local.)
        name_lower = name.lower()

        # Filter: only handle CubeLite devices, abort for all other Yeelight devices
        if not is_cube_device(model, device_name or name_lower, device_id):
            return self.async_abort(reason="not_cube_device")

        self._discovered_ip = discovery_info.host
        self._discovered_name = device_name or model or "Yeelight Cube Lite"

        # Use IP as unique_id (consistent with manual setup)
        await self.async_set_unique_id(self._discovered_ip)
        self._abort_if_unique_id_configured()

        # Also check if IP is already configured under a different unique_id
        for entry in self._async_current_entries():
            if entry.data.get(CONF_IP) == self._discovered_ip:
                return self.async_abort(reason="already_configured")

        self.context["title_placeholders"] = {
            "name": self._discovered_name,
            "host": self._discovered_ip,
        }

        return await self.async_step_discovery_confirm()

    async def async_step_discovery_confirm(self, user_input=None):
        """Handle the discovery confirmation step."""
        if user_input is not None:
            return self.async_create_entry(
                title=f"Yeelight Cube ({self._discovered_ip})",
                data={CONF_IP: self._discovered_ip}
            )

        self._set_confirm_only()
        return self.async_show_form(
            step_id="discovery_confirm",
            description_placeholders={
                "name": self._discovered_name,
                "host": self._discovered_ip,
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