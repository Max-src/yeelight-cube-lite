import ipaddress
import logging
import voluptuous as vol # type: ignore
from homeassistant import config_entries # type: ignore
from homeassistant.core import callback # type: ignore
from homeassistant.helpers.selector import ( # type: ignore
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo # type: ignore
from .const import (
    DOMAIN,
    CONF_IP,
    CONF_DEVICE_ID,
    CONF_MATTER_MAC,
    CONF_MOUNT_PROFILE,
    CONF_MOUNT_PROFILE_SOURCE,
    LAN_PORT,
    PROBE_TIMEOUT,
)
from .cube_matrix import check_tcp, send_once
from .discovery import is_cube_device, parse_service_name, normalize_device_id
from .mount_profile import (
    STAR_CHECK_PARAMS,
    FIRMWARE_DEFAULT_PROFILE,
    PROFILE_DEGREES,
    PROFILES,
    SOURCE_USER,
    arrow_text,
    star_check_profile,
    valid_profile,
)
from .runtime_data import lamp_of

_LOGGER = logging.getLogger(__name__)


def _parse_ip(raw: str) -> str | None:
    """A typed IP address in its canonical form (spaces stripped, IPv6
    compressed), so the same lamp always gets the same unique_id; None when
    it cannot be a lamp's."""
    try:
        address = ipaddress.ip_address(raw.strip())
    except ValueError:
        return None
    if address.is_unspecified or address.is_multicast:
        return None
    return str(address)


async def _lamp_answers(ip_address: str) -> bool:
    """Whether a lamp answers at this address (its LAN Control port): checked
    before one is added or moved, as an address with a typo would otherwise
    be set up and retried forever."""
    try:
        await check_tcp(ip_address, LAN_PORT, PROBE_TIMEOUT)
    except OSError:
        return False
    return True


class YeelightCubeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Yeelight Cube Lite."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """The lamp's options: how it is mounted (its saved mount profile)."""
        return YeelightCubeOptionsFlow()

    _discovered_ip: str = ""
    _discovered_name: str = ""
    _discovered_device_id: str = ""
    _discovered_mac: str | None = None

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        errors = {}
        
        if user_input is not None:
            ip_address = _parse_ip(user_input[CONF_IP])
            if ip_address is None:
                errors[CONF_IP] = "invalid_ip"
            else:
                self._async_abort_entries_match({CONF_IP: ip_address})
                # For manual setup, use IP as unique_id (no device_id available
                # yet). When the device is later discovered, the unique_id is
                # migrated to the hardware device_id automatically.
                await self.async_set_unique_id(ip_address)
                self._abort_if_unique_id_configured()
                if not await _lamp_answers(ip_address):
                    errors["base"] = "cannot_connect"
                else:
                    return await self._async_add_lamp(
                        f"Yeelight Cube ({ip_address})", {CONF_IP: ip_address}
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

    async def async_step_integration_discovery(self, discovery_info):
        """A Cube Lite in Home Assistant's Matter integration that no entry
        has (matter_discovery.py): its IP address and MAC."""
        ip = discovery_info[CONF_IP]
        mac = discovery_info.get(CONF_MATTER_MAC)
        await self.async_set_unique_id(ip)
        self._abort_if_unique_id_configured()
        for entry in self._async_current_entries():
            if entry.data.get(CONF_IP) == ip or (mac and entry.data.get(CONF_MATTER_MAC) == mac):
                return self.async_abort(reason="already_configured")
        self._discovered_ip = ip
        self._discovered_mac = mac
        self.context["title_placeholders"] = {"name": f"CubeLite ({ip})", "host": ip}
        return await self.async_step_matter_confirm()

    async def async_step_matter_confirm(self, user_input=None):
        """Add a lamp found in Matter once it answers over LAN (LAN Control on
        in the Yeelight app)."""
        errors = {}
        if user_input is not None:
            if await _lamp_answers(self._discovered_ip):
                data = {CONF_IP: self._discovered_ip}
                if self._discovered_mac:
                    data[CONF_MATTER_MAC] = self._discovered_mac
                return await self._async_add_lamp(f"Yeelight Cube ({self._discovered_ip})", data)
            errors["base"] = "lan_control_needed"
        return self.async_show_form(
            step_id="matter_confirm",
            errors=errors,
            description_placeholders={"host": self._discovered_ip},
        )

    async def async_step_discovery_confirm(self, user_input=None):
        """Handle the discovery confirmation step."""
        if user_input is not None:
            data = {CONF_IP: self._discovered_ip}
            if self._discovered_device_id:
                data[CONF_DEVICE_ID] = self._discovered_device_id
            return await self._async_add_lamp(f"Yeelight Cube ({self._discovered_ip})", data)

        self._set_confirm_only()
        return self.async_show_form(
            step_id="discovery_confirm",
            description_placeholders={
                "name": self._discovered_name,
                "host": self._discovered_ip,
            }
        )

    async def _async_add_lamp(self, title: str, data: dict):
        """The lamp answers: ask how it is mounted (its saved orientation)
        before it is added."""
        self._new_title, self._new_data = title, data
        return await self.async_step_orientation()

    async def async_step_orientation(self, user_input=None):
        """How is the lamp mounted? The orientation saved in the Yeelight app
        (it turns the lamp's effects; nothing reads it over LAN), a lamp never
        set (the firmware's 270°), a check on the lamp, or read over Matter."""
        errors = {}
        if user_input is not None:
            choice = user_input[CONF_MOUNT_PROFILE]
            if choice == MOUNT_CHECK:
                try:
                    await send_once(
                        self._new_data[CONF_IP], LAN_PORT, "set_fx_effect",
                        list(STAR_CHECK_PARAMS), PROBE_TIMEOUT,
                    )
                except OSError:
                    errors["base"] = "mount_check_failed"
                else:
                    return await self.async_step_orientation_check()
            elif choice == MOUNT_FROM_MATTER:
                return self.async_create_entry(title=self._new_title, data=self._new_data)
            else:
                return self._create_with_profile(valid_profile(choice))
        return self.async_show_form(
            step_id="orientation",
            data_schema=vol.Schema({vol.Required(CONF_MOUNT_PROFILE): SelectSelector(SelectSelectorConfig(
                options=[*(str(profile) for profile in PROFILES), MOUNT_CHECK, MOUNT_FROM_MATTER],
                translation_key="initial_orientation",
                mode=SelectSelectorMode.LIST,
            ))}),
            errors=errors,
        )

    async def async_step_orientation_check(self, user_input=None):
        """The lamp plays shooting stars: which way do they fly? (a lamp
        being added lies as by default, Device Orientation Right)"""
        if user_input is not None:
            self._checked_profile = star_check_profile(user_input[STARS])
            if self._checked_profile is None:  # can't tell: asked again
                return await self.async_step_orientation()
            return await self.async_step_orientation_result()
        return self.async_show_form(step_id="orientation_check", data_schema=_stars_schema())

    async def async_step_orientation_result(self, user_input=None):
        """The answer as the app's arrow, saved on Submit."""
        if user_input is not None:
            return self._create_with_profile(self._checked_profile)
        return self.async_show_form(
            step_id="orientation_result",
            description_placeholders={"arrow": arrow_text(self._checked_profile)},
        )

    def _create_with_profile(self, profile: int):
        return self.async_create_entry(
            title=self._new_title,
            data=self._new_data,
            options={CONF_MOUNT_PROFILE: profile, CONF_MOUNT_PROFILE_SOURCE: SOURCE_USER},
        )

    async def async_step_reconfigure(self, user_input=None):
        """Change a lamp's IP address (Reconfigure, in its entry's menu),
        with the same checks as adding it. The entry's update reloads it once
        (__init__._async_entry_updated); a discovered lamp also follows a new
        IP on its own."""
        entry = self._get_reconfigure_entry()
        errors = {}
        if user_input is not None:
            ip_address = _parse_ip(user_input[CONF_IP])
            if ip_address is None:
                errors[CONF_IP] = "invalid_ip"
            elif any(
                other.entry_id != entry.entry_id and other.data.get(CONF_IP) == ip_address
                for other in self._async_current_entries(include_ignore=False)
            ):
                return self.async_abort(reason="already_configured")
            elif not await _lamp_answers(ip_address):
                errors["base"] = "cannot_connect"
            else:
                # A manually added lamp is identified by its IP until it is
                # discovered: its unique_id follows the new one.
                unique_id = (
                    ip_address if entry.unique_id == entry.data.get(CONF_IP) else entry.unique_id
                )
                self.hass.config_entries.async_update_entry(
                    entry, unique_id=unique_id, data={**entry.data, CONF_IP: ip_address}
                )
                return self.async_abort(reason="reconfigure_successful")
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self._get_schema(user_input[CONF_IP] if user_input else entry.data.get(CONF_IP)),
            errors=errors,
        )

    @staticmethod
    def _get_schema(ip_address: str | None = None):
        """The IP address form, filled in with ``ip_address`` when given."""
        if ip_address:
            return vol.Schema({vol.Required(CONF_IP, default=ip_address): str})
        return vol.Schema({
            vol.Required(CONF_IP): str,
        })


# The orientation step's answers besides the four arrows (270° is also a lamp
# never set, the firmware's default): "check it on the lamp", "read it over
# Matter" (setup only).
MOUNT_CHECK = "check"
MOUNT_FROM_MATTER = "matter"
# How the options say where the orientation in use comes from.
MOUNT_SOURCE_TEXT = {"matter": "read from the lamp over Matter", "user": "set here"}
# The check's question: which way the stars fly ("unclear": can't tell).
STARS = "stars"
STARS_UNCLEAR = "unclear"


def _stars_schema():
    return vol.Schema({vol.Required(STARS): SelectSelector(SelectSelectorConfig(
        options=["left", "up", "right", "down", STARS_UNCLEAR],
        translation_key="star_motion",
        mode=SelectSelectorMode.LIST,
    ))})


class YeelightCubeOptionsFlow(config_entries.OptionsFlow):
    """How is the lamp mounted? The orientation saved on the lamp (the
    Yeelight app's orientation page: 0°, 90°, 180°, 270°) turns its built-in
    effects, and nothing reads it over LAN: the user says which it is, or
    checks it on the lamp (shooting stars, mount_profile.star_check_profile)."""

    _checking = False

    async def async_step_init(self, user_input=None):
        errors = {}
        lamp = lamp_of(self.config_entry)
        if user_input is not None:
            choice = user_input[CONF_MOUNT_PROFILE]
            if choice == MOUNT_CHECK:
                if lamp is None:
                    errors["base"] = "lamp_not_loaded"
                elif not await lamp.async_show_mount_check():
                    errors["base"] = "mount_check_failed"
                else:
                    self._checking = True
                    return await self.async_step_mount_check()
            elif (profile := valid_profile(choice)) is not None:
                return await self._async_save(lamp, profile)
        current, source = lamp.mount_profile if lamp is not None else (
            valid_profile(self.config_entry.options.get(CONF_MOUNT_PROFILE)), SOURCE_USER
        )
        options = [str(profile) for profile in PROFILES] + [MOUNT_CHECK]
        key = vol.Required(CONF_MOUNT_PROFILE)
        if current is not None:
            key = vol.Required(CONF_MOUNT_PROFILE, default=str(current))
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({key: SelectSelector(SelectSelectorConfig(
                options=options, translation_key="mount_profile", mode=SelectSelectorMode.LIST,
            ))}),
            errors=errors,
            description_placeholders={
                "now": (
                    f"not set ({PROFILE_DEGREES[FIRMWARE_DEFAULT_PROFILE]}° in use)"
                    if current is None
                    else f"{PROFILE_DEGREES[current]}°, {MOUNT_SOURCE_TEXT.get(source, source)}"
                ),
            },
        )

    async def async_step_mount_check(self, user_input=None):
        """The lamp plays shooting stars: which way do they fly, as it is
        mounted (its Device Orientation)?"""
        lamp = lamp_of(self.config_entry)
        if user_input is not None:
            mounted = getattr(lamp, "device_orientation", None)
            self._checked_profile = star_check_profile(user_input[STARS], mounted)
            if self._checked_profile is not None:
                return await self.async_step_mount_result()
            # Unclear: the content comes back, and the choice is asked again.
            self._checking = False
            if lamp is not None:
                await lamp._async_end_mount_check()
            return await self.async_step_init()
        return self.async_show_form(step_id="mount_check", data_schema=_stars_schema())

    async def async_step_mount_result(self, user_input=None):
        """The answer as the app's arrow, saved on Submit (the lamp's
        content comes back)."""
        if user_input is not None:
            self._checking = False
            return await self._async_save(
                lamp_of(self.config_entry), self._checked_profile, after_check=True
            )
        return self.async_show_form(
            step_id="mount_result",
            description_placeholders={"arrow": arrow_text(self._checked_profile)},
        )

    async def _async_save(self, lamp, profile: int, *, after_check: bool = False):
        """Keep the answer: through the lamp when it is loaded (what it shows
        follows), else in the options alone."""
        if lamp is not None:
            await lamp.async_set_user_mount_profile(profile, after_check=after_check)
            return self.async_create_entry(data=dict(self.config_entry.options))
        return self.async_create_entry(data={
            **self.config_entry.options,
            CONF_MOUNT_PROFILE: profile,
            CONF_MOUNT_PROFILE_SOURCE: SOURCE_USER,
        })

    @callback
    def async_remove(self) -> None:
        """Closed during the check: the lamp's content comes back."""
        lamp = lamp_of(self.config_entry) if self._checking else None
        self._checking = False
        if lamp is not None:
            self.hass.async_create_task(lamp._async_end_mount_check())
