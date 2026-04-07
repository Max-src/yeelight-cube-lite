import logging
import voluptuous as vol # type: ignore
from homeassistant import config_entries # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.core import callback # type: ignore
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo # type: ignore
from .const import DOMAIN, CONF_IP, CONF_DEVICE_ID
from .discovery import is_cube_device, parse_service_name

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
        device_id = discovery_data.get("device_id", "")
        device_name = discovery_data.get("name", model or "Yeelight Cube Lite")

        _LOGGER.warning(
            "[DISCOVERY] CubeLite discovered via SSDP: ip=%s model=%s id=%s",
            ip, model, device_id,
        )

        self._discovered_ip = ip
        self._discovered_name = device_name
        self._discovered_device_id = device_id

        # Use device_id as unique_id if available, else IP
        unique_id = device_id if device_id else ip
        await self.async_set_unique_id(unique_id)
        self._abort_if_unique_id_configured(updates={CONF_IP: ip})

        # Check if this IP is already configured under any entry
        for entry in self._async_current_entries():
            if entry.data.get(CONF_IP) == ip:
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
        # Log everything at WARNING level so it's always visible in HA logs
        _LOGGER.warning(
            "[ZEROCONF] Discovery received: name=%s host=%s properties=%s",
            discovery_info.name, discovery_info.host, discovery_info.properties,
        )

        # Extract device info from zeroconf properties
        name = discovery_info.name or ""
        properties = discovery_info.properties or {}

        # Try multiple property key variants (miio uses different keys)
        model = (
            properties.get("md", "")
            or properties.get("model", "")
        )
        device_name = (
            properties.get("fn", "")
            or properties.get("name", "")
        )
        device_id = (
            properties.get("id", "")
            or properties.get("did", "")
            or properties.get("mac", "")
        )

        # Parse the service name as fallback (format: yeelink-light-<model>-<id>._miio._udp.local.)
        parsed = parse_service_name(name)
        if parsed:
            if not model:
                model = parsed.get("model", "")
            if not device_id:
                device_id = parsed.get("devid", "")
            _LOGGER.warning(
                "[ZEROCONF] Parsed service name: %s", parsed,
            )

        # Use the full service name for matching too
        name_lower = name.lower()

        # Build a combined name for matching: prefer fn, then model, then service name
        match_name = device_name or model or name_lower

        _LOGGER.warning(
            "[ZEROCONF] Extracted: model=%s device_name=%s device_id=%s match_name=%s",
            model, device_name, device_id, match_name,
        )

        # Filter: only handle CubeLite devices, abort for all other Yeelight devices
        if not is_cube_device(model, match_name, device_id):
            _LOGGER.warning(
                "[ZEROCONF] NOT a cube device, aborting: model=%s match_name=%s id=%s",
                model, match_name, device_id,
            )
            return self.async_abort(reason="not_cube_device")

        self._discovered_ip = discovery_info.host
        self._discovered_name = device_name or model or "Yeelight Cube Lite"
        self._discovered_device_id = device_id

        _LOGGER.warning(
            "[ZEROCONF] Cube device confirmed: name=%s ip=%s device_id=%s",
            self._discovered_name, self._discovered_ip, device_id,
        )

        # Log existing entries for debugging
        for entry in self._async_current_entries():
            _LOGGER.warning(
                "[ZEROCONF]   Existing entry: unique_id=%s ip=%s device_id=%s state=%s",
                entry.unique_id, entry.data.get(CONF_IP),
                entry.data.get(CONF_DEVICE_ID), entry.state,
            )

        # Use hardware device_id as unique_id (stable across IP changes).
        # If no device_id available, fall back to IP.
        unique_id = device_id if device_id else self._discovered_ip
        await self.async_set_unique_id(unique_id)

        # If this device_id is already configured, update the stored IP
        # (handles DHCP lease changes) and abort the discovery flow.
        self._abort_if_unique_id_configured(
            updates={CONF_IP: self._discovered_ip}
        )

        # Also check if this IP is already configured under an old IP-based unique_id.
        # This handles migration: if a device was added manually (unique_id=IP) and is
        # now discovered via zeroconf (unique_id=device_id), migrate the existing entry.
        for entry in self._async_current_entries():
            if entry.data.get(CONF_IP) == self._discovered_ip:
                if entry.unique_id != unique_id and device_id:
                    # Migrate: update the existing entry's unique_id to device_id
                    # and store the device_id in entry data
                    _LOGGER.info(
                        "Migrating Yeelight Cube entry %s from IP-based unique_id '%s' "
                        "to device_id '%s'",
                        entry.entry_id, entry.unique_id, device_id,
                    )
                    self.hass.config_entries.async_update_entry(
                        entry,
                        unique_id=unique_id,
                        data={**entry.data, CONF_DEVICE_ID: device_id},
                    )
                return self.async_abort(reason="already_configured")

        # --- IP-change migration for legacy entries ---
        # If we reach here, no entry matched by device_id OR by current IP.
        # Look for legacy entries (no device_id stored) that are failing setup —
        # these are likely devices whose IP changed via DHCP.
        if device_id:
            for entry in self._async_current_entries():
                if entry.data.get(CONF_DEVICE_ID):
                    continue  # Already has a device_id, skip
                if entry.state not in (
                    config_entries.ConfigEntryState.SETUP_ERROR,
                    config_entries.ConfigEntryState.SETUP_RETRY,
                ):
                    continue  # Entry is working fine, don't touch it
                old_ip = entry.data.get(CONF_IP, "?")
                _LOGGER.info(
                    "Migrating orphaned Yeelight Cube entry %s "
                    "(old IP %s -> new IP %s, device_id=%s)",
                    entry.entry_id, old_ip, self._discovered_ip, device_id,
                )
                self.hass.config_entries.async_update_entry(
                    entry,
                    unique_id=unique_id,
                    data={
                        **entry.data,
                        CONF_IP: self._discovered_ip,
                        CONF_DEVICE_ID: device_id,
                    },
                )
                return self.async_abort(reason="already_configured")

        # --- Fallback: legacy entries without device_id, any state ---
        # Catches entries that haven't been set up yet (e.g. during startup)
        # whose stored IP differs from the discovered one.
        if device_id:
            for entry in self._async_current_entries():
                if entry.data.get(CONF_DEVICE_ID):
                    continue
                if entry.data.get(CONF_IP) == self._discovered_ip:
                    continue  # Same IP — already handled above
                old_ip = entry.data.get(CONF_IP, "?")
                _LOGGER.info(
                    "Migrating legacy Yeelight Cube entry %s "
                    "(old IP %s -> new IP %s, device_id=%s)",
                    entry.entry_id, old_ip, self._discovered_ip, device_id,
                )
                self.hass.config_entries.async_update_entry(
                    entry,
                    unique_id=unique_id,
                    data={
                        **entry.data,
                        CONF_IP: self._discovered_ip,
                        CONF_DEVICE_ID: device_id,
                    },
                )
                return self.async_abort(reason="already_configured")

        self.context["title_placeholders"] = {
            "name": self._discovered_name,
            "host": self._discovered_ip,
        }

        return await self.async_step_discovery_confirm()

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