import logging
import voluptuous as vol # type: ignore
from homeassistant import config_entries # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.core import callback # type: ignore
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo # type: ignore
from .const import DOMAIN, CONF_IP, CONF_DEVICE_ID
from .discovery import is_cube_device, parse_service_name, normalize_device_id

_LOGGER = logging.getLogger(__name__)

class YeelightCubeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Yeelight Cube Lite."""

    VERSION = 1

    _discovered_ip: str = ""
    _discovered_name: str = ""
    _discovered_device_id: str = ""

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        errors = {}
        
        if user_input is not None:
            ip_address = user_input[CONF_IP]
            self._async_abort_entries_match({CONF_IP: ip_address})
            
            # For manual setup, use IP as unique_id (no device_id available yet).
            # When the device is later discovered via zeroconf, the unique_id will
            # be migrated to the hardware device_id automatically.
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

    async def async_step_discovery(self, discovery_data: dict):
        """Handle discovery from our own SSDP scan (initiated by __init__.py).

        This is triggered when ``__init__.py`` calls
        ``hass.config_entries.flow.async_init(DOMAIN, context={"source": "discovery"}, data=...)``
        for CubeLite devices found via the yeelight library's SSDP scan.
        """
        ip = discovery_data.get("ip", "")
        model = discovery_data.get("model", "")
        device_id = normalize_device_id(discovery_data.get("device_id", ""))
        device_name = discovery_data.get("name", model or "Yeelight Cube Lite")

        _LOGGER.debug(
            "[DISCOVERY] CubeLite discovered via SSDP: ip=%s model=%s id=%s",
            ip, model, device_id,
        )

        self._discovered_ip = ip
        self._discovered_name = device_name
        self._discovered_device_id = device_id

        # Use device_id as unique_id if available, else IP
        unique_id = device_id if device_id else ip
        await self.async_set_unique_id(unique_id)
        self._abort_if_unique_id_configured(updates={CONF_IP: ip}, reload_on_update=False)

        # Match by stored hardware device_id: entries added manually have a
        # legacy IP-based unique_id, so the check above misses them.  Without
        # this, a DHCP change makes the SAME lamp show up as a new discovered
        # device instead of remapping the existing entry.
        if device_id:
            for entry in self._async_current_entries():
                stored = entry.data.get(CONF_DEVICE_ID) or entry.unique_id
                if not stored or normalize_device_id(stored) != normalize_device_id(device_id):
                    continue
                if entry.data.get(CONF_IP) != ip or entry.unique_id != unique_id:
                    _LOGGER.info(
                        "Remapping Yeelight Cube entry %s to new IP %s "
                        "(was %s, device_id=%s)",
                        entry.entry_id, ip, entry.data.get(CONF_IP), device_id,
                    )
                    self.hass.config_entries.async_update_entry(
                        entry,
                        unique_id=unique_id,
                        data={**entry.data, CONF_IP: ip, CONF_DEVICE_ID: device_id},
                    )
                return self.async_abort(reason="already_configured")

        # Check if this IP is already configured under any entry
        for entry in self._async_current_entries():
            if entry.data.get(CONF_IP) == ip:
                stored = entry.data.get(CONF_DEVICE_ID)
                if device_id and stored and normalize_device_id(stored) != device_id:
                    continue
                if device_id and not entry.data.get(CONF_DEVICE_ID):
                    # Same IP, entry predates device_id storage — adopt it.
                    self.hass.config_entries.async_update_entry(
                        entry,
                        unique_id=unique_id,
                        data={**entry.data, CONF_DEVICE_ID: device_id},
                    )
                return self.async_abort(reason="already_configured")

        # Format title like the built-in Yeelight: "CubeLite 0xABCD (192.168.4.144)"
        id_display = f"0x{device_id}" if device_id and not device_id.startswith("0x") else (device_id or "")
        display_title = f"CubeLite {id_display} ({ip})" if id_display else f"CubeLite ({ip})"

        self.context["title_placeholders"] = {
            "name": display_title,
            "host": ip,
        }

        return await self.async_step_discovery_confirm()

    async def async_step_zeroconf(self, discovery_info: ZeroconfServiceInfo):
        """Handle zeroconf discovery of Yeelight devices."""
        name = discovery_info.name or ""
        properties = discovery_info.properties or {}
        parsed = parse_service_name(name)
        model = properties.get("md") or properties.get("model") or parsed.get("model", "")
        device_name = properties.get("fn") or properties.get("name", "")
        device_id = (properties.get("id") or properties.get("did")
                     or properties.get("mac") or parsed.get("devid", ""))
        if not is_cube_device(model, device_name or model or name.lower(), device_id):
            return self.async_abort(reason="not_cube_device")
        return await self.async_step_discovery({
            "ip": discovery_info.host,
            "model": model,
            "name": device_name or model or "Yeelight Cube Lite",
            "device_id": device_id,
        })

    async def async_step_discovery_confirm(self, user_input=None):
        """Handle the discovery confirmation step."""
        if user_input is not None:
            data = {CONF_IP: self._discovered_ip}
            if self._discovered_device_id:
                data[CONF_DEVICE_ID] = self._discovered_device_id
            return self.async_create_entry(
                title=f"Yeelight Cube ({self._discovered_ip})",
                data=data,
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
        return YeelightCubeOptionsFlow()


class YeelightCubeOptionsFlow(config_entries.OptionsFlow):
    """Handle Yeelight Cube Lite options."""

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data={**self.config_entry.options, **user_input})

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                # Add any options here in the future
            })
        )