"""The config flow (config_flow.py) through Home Assistant: every step and
branch (quality scale: config-flow-test-coverage, 100% of the module)."""
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.yeelight_cube.const import CONF_DEVICE_ID, CONF_IP, CONF_MATTER_MAC, DOMAIN

DISCOVERY = config_entries.SOURCE_DISCOVERY


async def start(hass, source=config_entries.SOURCE_USER, data=None):
    return await hass.config_entries.flow.async_init(DOMAIN, context={"source": source}, data=data)


def entry(hass, **kwargs):
    item = MockConfigEntry(domain=DOMAIN, **kwargs)
    item.add_to_hass(hass)
    return item


# ── Manual setup ────────────────────────────────────────────────────────────

async def test_manual_setup_adds_a_lamp_that_answers(hass, lamp_answers):
    result = await start(hass)
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "user")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_IP: " 192.168.4.139 "})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Yeelight Cube (192.168.4.139)"
    assert result["data"] == {CONF_IP: "192.168.4.139"}
    assert result["result"].unique_id == "192.168.4.139"
    lamp_answers.assert_awaited_once_with("192.168.4.139", 55443, 3.0)


async def test_manual_setup_refuses_an_invalid_address(hass, lamp_answers):
    result = await start(hass)
    for bad in ("abc", "224.0.0.1", "::"):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_IP: bad})
        assert (result["type"], result["errors"]) == (FlowResultType.FORM, {CONF_IP: "invalid_ip"})
    lamp_answers.assert_not_awaited()


async def test_manual_setup_keeps_the_form_while_no_lamp_answers(hass, lamp_answers):
    lamp_answers.side_effect = OSError("timed out")
    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_IP: "192.168.4.139"})
    assert (result["type"], result["errors"]) == (FlowResultType.FORM, {"base": "cannot_connect"})
    lamp_answers.side_effect = None  # switched on: the same form adds it
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_IP: "192.168.4.139"})
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_manual_setup_of_a_lamp_already_set_up(hass, lamp_answers):
    # By its address, or by its unique id (an older entry at another IP).
    entry(hass, unique_id="0xabc", data={CONF_IP: "192.168.4.139"})
    entry(hass, unique_id="192.168.4.140", data={CONF_IP: "192.168.4.99"})
    for ip in ("192.168.4.139", "192.168.4.140"):
        result = await start(hass)
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_IP: ip})
        assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "already_configured")
    lamp_answers.assert_not_awaited()


# ── Discovery (our own scan) and its confirmation ───────────────────────────

async def test_a_discovered_lamp_is_added_once_confirmed(hass):
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.150", "model": "CubeLite",
                                           "device_id": "0x00000000001234ab", "name": "Desk"})
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "discovery_confirm")
    assert result["description_placeholders"] == {"name": "Desk", "host": "192.168.4.150"}
    flow = hass.config_entries.flow.async_get(result["flow_id"])
    assert flow["context"]["title_placeholders"]["name"] == "CubeLite 0x1234ab (192.168.4.150)"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_IP: "192.168.4.150", CONF_DEVICE_ID: "1234ab"}
    assert result["result"].unique_id == "1234ab"


async def test_a_discovered_lamp_without_an_id(hass):
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.151"})
    flow = hass.config_entries.flow.async_get(result["flow_id"])
    assert flow["context"]["title_placeholders"]["name"] == "CubeLite (192.168.4.151)"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["data"] == {CONF_IP: "192.168.4.151"}
    assert result["result"].unique_id == "192.168.4.151"


async def test_a_known_lamp_at_a_new_address_is_updated(hass):
    known = entry(hass, unique_id="1234ab", data={CONF_IP: "192.168.4.10", CONF_DEVICE_ID: "1234ab"})
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.11", "device_id": "0x1234ab"})
    assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "already_configured")
    assert known.data[CONF_IP] == "192.168.4.11"


async def test_a_manually_added_lamp_is_remapped_by_its_hardware_id(hass):
    # Added by IP (its unique id is the IP), with its id stored since: a
    # discovery at a new IP moves it instead of offering a new lamp.
    manual = entry(hass, unique_id="192.168.4.20", data={CONF_IP: "192.168.4.20", CONF_DEVICE_ID: "0x0000beef"})
    entry(hass, unique_id=None, data={CONF_IP: "192.168.4.99"})  # no id to compare: skipped
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.21", "device_id": "0xbeef"})
    assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "already_configured")
    assert manual.data[CONF_IP] == "192.168.4.21"
    assert manual.unique_id == "beef"
    # Discovered again where it now is: nothing to change.
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.21", "device_id": "beef"})
    assert result["reason"] == "already_configured"
    assert manual.data[CONF_IP] == "192.168.4.21"


async def test_a_lamp_at_an_address_already_set_up(hass):
    # The entry at that IP has no id yet: it adopts the discovered one.
    old = entry(hass, unique_id="192.168.4.30", data={CONF_IP: "192.168.4.30"})
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.30", "device_id": "0xcafe"})
    assert result["reason"] == "already_configured"
    assert (old.data[CONF_DEVICE_ID], old.unique_id) == ("cafe", "cafe")
    # Discovered without an id at an address already set up: nothing new.
    entry(hass, unique_id="lamp-31", data={CONF_IP: "192.168.4.31"})
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.31"})
    assert result["reason"] == "already_configured"


async def test_another_lamp_now_at_a_known_address_is_offered(hass):
    # The entry at that IP belongs to another lamp (another id): the new lamp
    # is offered, the entry is left alone (its lamp moved elsewhere).
    entry(hass, unique_id="aaaa", data={CONF_IP: "192.168.4.40", CONF_DEVICE_ID: "aaaa"})
    result = await start(hass, DISCOVERY, {"ip": "192.168.4.40", "device_id": "bbbb"})
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "discovery_confirm")


# ── Zeroconf ────────────────────────────────────────────────────────────────

def zeroconf(name, properties):
    return ZeroconfServiceInfo(
        ip_address=__import__("ipaddress").ip_address("192.168.4.60"),
        ip_addresses=[__import__("ipaddress").ip_address("192.168.4.60")],
        hostname="lamp.local.", name=name, port=54321, properties=properties, type="_miio._udp.local.",
    )


# ── A lamp found in Home Assistant's Matter integration ──────────────────────

MATTER = config_entries.SOURCE_INTEGRATION_DISCOVERY
MATTER_LAMP = {CONF_IP: "192.168.4.139", CONF_MATTER_MAC: "cc:ba:97:44:38:98"}


async def test_a_lamp_found_in_matter_is_added_once_it_answers_over_lan(hass, lamp_answers):
    result = await start(hass, MATTER, dict(MATTER_LAMP))
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "matter_confirm")
    assert result["description_placeholders"] == {"host": "192.168.4.139"}
    flow = hass.config_entries.flow.async_get(result["flow_id"])
    assert flow["context"]["title_placeholders"]["name"] == "CubeLite (192.168.4.139)"
    # LAN Control off in the Yeelight app: the form says so and stays.
    lamp_answers.side_effect = OSError("refused")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert (result["type"], result["errors"]) == (FlowResultType.FORM, {"base": "lan_control_needed"})
    lamp_answers.side_effect = None
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Yeelight Cube (192.168.4.139)"
    assert result["data"] == MATTER_LAMP
    assert result["result"].unique_id == "192.168.4.139"


async def test_a_lamp_found_in_matter_without_a_mac(hass, lamp_answers):
    result = await start(hass, MATTER, {CONF_IP: "192.168.4.139"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["data"] == {CONF_IP: "192.168.4.139"}


async def test_a_lamp_found_in_matter_that_is_already_set_up(hass, lamp_answers):
    # By its unique id, its address, or its remembered MAC.
    for data in (
        {"unique_id": "192.168.4.139", "data": {CONF_IP: "192.168.4.10"}},
        {"unique_id": "1234ab", "data": {CONF_IP: "192.168.4.139"}},
        {"unique_id": "5678cd", "data": {CONF_IP: "192.168.4.20", CONF_MATTER_MAC: "cc:ba:97:44:38:98"}},
    ):
        known = entry(hass, **data)
        result = await start(hass, MATTER, dict(MATTER_LAMP))
        assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "already_configured")
        await hass.config_entries.async_remove(known.entry_id)
    lamp_answers.assert_not_awaited()


async def test_zeroconf_offers_a_cube_and_ignores_other_lamps(hass):
    result = await start(hass, config_entries.SOURCE_ZEROCONF,
                         zeroconf("yeelink-light-cubelite-0x1a2b._miio._udp.local.", {}))
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "discovery_confirm")
    result = await start(hass, config_entries.SOURCE_ZEROCONF,
                         zeroconf("yeelink-light-color1-0x9999._miio._udp.local.", {"md": "color1"}))
    assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "not_cube_device")


# ── Reconfigure ─────────────────────────────────────────────────────────────

async def test_reconfigure_moves_a_lamp_to_an_address_that_answers(hass, lamp_answers):
    manual = entry(hass, unique_id="192.168.4.70", data={CONF_IP: "192.168.4.70"})
    entry(hass, unique_id="other", data={CONF_IP: "192.168.4.71"})
    result = await manual.start_reconfigure_flow(hass)
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "reconfigure")
    configure = hass.config_entries.flow.async_configure
    result = await configure(result["flow_id"], {CONF_IP: "nope"})
    assert result["errors"] == {CONF_IP: "invalid_ip"}
    lamp_answers.side_effect = OSError("timed out")
    result = await configure(result["flow_id"], {CONF_IP: "192.168.4.72"})
    assert result["errors"] == {"base": "cannot_connect"}
    lamp_answers.side_effect = None
    result = await configure(result["flow_id"], {CONF_IP: "192.168.4.72"})
    assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "reconfigure_successful")
    # Identified by its IP until discovered: the unique id follows.
    assert (manual.data[CONF_IP], manual.unique_id) == ("192.168.4.72", "192.168.4.72")


async def test_reconfigure_refuses_another_lamp_s_address_and_keeps_a_hardware_id(hass, lamp_answers):
    discovered = entry(hass, unique_id="d00d", data={CONF_IP: "192.168.4.80", CONF_DEVICE_ID: "d00d"})
    entry(hass, unique_id="other", data={CONF_IP: "192.168.4.81"})
    result = await discovered.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_IP: "192.168.4.81"})
    assert (result["type"], result["reason"]) == (FlowResultType.ABORT, "already_configured")
    result = await discovered.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_IP: "192.168.4.82"})
    assert result["reason"] == "reconfigure_successful"
    assert (discovered.data[CONF_IP], discovered.unique_id) == ("192.168.4.82", "d00d")
