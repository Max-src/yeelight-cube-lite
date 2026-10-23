"""Lamps in Home Assistant's Matter integration that this integration does
not have yet, offered as discovered (Settings > Devices & services >
Discovered) so they can be added over LAN too
(config_flow.async_step_integration_discovery).

Scanned from the lamps' minute check (light_matter._refresh_matter_link),
at most every SCAN_INTERVAL: it runs only while at least one lamp is set up.
A first lamp is found by the integration's own LAN discovery.
"""
from __future__ import annotations

import time
from collections.abc import Iterable

from .const import CONF_IP, CONF_MATTER_MAC, DOMAIN
from .matter_link import _attributes, is_cube_lite, matter_client, node_interfaces

SCAN_INTERVAL = 600.0
_SCANNED_AT = "yeelight_cube_matter_scanned_at"


def matter_only_lamps(nodes: Iterable[dict], entries: Iterable[dict]) -> list[tuple[str, str]]:
    """(IP address, MAC) of each Cube Lite node (its attributes) that matches
    no entry (their data) by IP address or remembered MAC."""
    entries = list(entries)
    known_ips = {data.get(CONF_IP) for data in entries}
    known_macs = {data.get(CONF_MATTER_MAC) for data in entries} - {None}
    found = []
    for attributes in nodes:
        if not is_cube_lite(attributes):
            continue
        # Its Wi-Fi interface (the access point one has no MAC).
        interfaces = [(mac, addresses) for mac, addresses in node_interfaces(attributes) if mac and addresses]
        if not interfaces or any(
            mac in known_macs or known_ips.intersection(addresses) for mac, addresses in interfaces
        ):
            continue
        mac, addresses = interfaces[0]
        found.append((addresses[0], mac))
    return found


def async_offer_matter_lamps(hass) -> None:
    """Offer the Matter-only lamps as discovered (at most every
    SCAN_INTERVAL; a lamp already offered or ignored is not offered again)."""
    now = time.monotonic()
    if now - hass.data.get(_SCANNED_AT, -SCAN_INTERVAL) < SCAN_INTERVAL:
        return
    hass.data[_SCANNED_AT] = now
    client = matter_client(hass)
    if client is None:
        return
    try:
        nodes = [_attributes(node) for node in client.get_nodes()]
    except Exception:  # noqa: BLE001 -- the client is not ours
        return
    lamps = matter_only_lamps(nodes, (entry.data for entry in hass.config_entries.async_entries(DOMAIN)))
    if not lamps:
        return
    from homeassistant.config_entries import SOURCE_INTEGRATION_DISCOVERY  # type: ignore
    from homeassistant.helpers import discovery_flow  # type: ignore

    for ip, mac in lamps:
        discovery_flow.async_create_flow(
            hass,
            DOMAIN,
            context={"source": SOURCE_INTEGRATION_DISCOVERY},
            data={CONF_IP: ip, CONF_MATTER_MAC: mac},
        )
