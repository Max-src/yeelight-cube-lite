"""A lamp's optional Matter link: the same Cube Lite, commissioned in Home
Assistant's own Matter integration, read through its connection.

LAN stays the lamp's control path. When the lamp is also a Matter node, the
lamp pushes over Matter what LAN never reports: its buttons (the playlist
and the microphone music modes), changes made in the Yeelight app and its
direction setting. This module finds that node and forwards the reports to
the light (light_matter.py); it never writes to it (Home Assistant's Matter
server refuses Yeelight's vendor clusters for writes and commands).

A Cube Matrix (device_profile) shared to Home Assistant's Matter server is
linked the same way (its product id, CUBE_MATRIX_PRODUCT), with its own set of
reports (MATRIX_REPORTED): it has no buttons or microphone to report, and the
effect it actually runs is its FC03 attribute (RUNNING_EFFECT; FC05's only
echoes the last request).

A node is the lamp's when it is a Yeelight Cube Lite whose Wi-Fi interface
has the lamp's IP address, or the MAC address remembered from an earlier
link (the IP may change), and that its server reaches now: a node left
behind when the lamp was factory reset (which erases its Matter pairing)
keeps its old attributes, but is unavailable. Re-checked every minute
(light._async_check_problems), so Matter set up before or after the lamp, or
a re-commissioned node, links on its own; without the Matter integration
nothing happens. Other servers (the development one, matter_commands.py) are
read the same way when Home Assistant's own has no live node for the lamp.

A lamp paired again (a factory reset erases its pairing) is a new node, while
the old one can stay listed, even as available. The newest node (the highest
id) is linked; the older ones with the same Wi-Fi MAC on that server are the
lamp's stale nodes (stale_node_ids), removed from the server once the new
node is known to answer (light_matter._check_matter_commands): a lamp is
never paired twice on one server, so they can only be leftovers.
"""
from __future__ import annotations

import base64
import logging
from collections.abc import Callable
from typing import Any

_LOGGER = logging.getLogger(__name__)

MATTER_DOMAIN = "matter"
YEELIGHT_VENDOR_ID = 0x1312
CUBE_LITE_PRODUCT = 4  # Yeelight's product id (vendor cluster FC00)
# The Cube Matrix (the original Yeelight Cube, "Cube Smart Lamp").
CUBE_MATRIX_PRODUCT = 16787457
CUBE_PRODUCTS = (CUBE_LITE_PRODUCT, CUBE_MATRIX_PRODUCT)


def _vendor(cluster_or_attribute: int) -> int:
    """A Yeelight vendor-specific id: the vendor id in the upper 16 bits."""
    return (YEELIGHT_VENDOR_ID << 16) | cluster_or_attribute


def _path(endpoint: int, cluster: int, attribute: int) -> str:
    return f"{endpoint}/{cluster}/{attribute}"


# The Cube's vendor endpoint and what it reports (verified on a Cube
# Lite).
VENDOR_ENDPOINT = 2
PRODUCT = _path(VENDOR_ENDPOINT, _vendor(0xFC00), _vendor(0))
LAN_CONTROL = _path(VENDOR_ENDPOINT, _vendor(0xFC01), _vendor(1))
MIC_MUSIC_ON = _path(VENDOR_ENDPOINT, _vendor(0xFC01), _vendor(2))
MIC_MUSIC_MODE = _path(VENDOR_ENDPOINT, _vendor(0xFC01), _vendor(3))
ROTATION = _path(VENDOR_ENDPOINT, _vendor(0xFC02), _vendor(1))
# The modules the Yeelight app saves with the orientation (its Save writes
# [2, 2, 2, 2] first): a mark that the orientation was saved (mount_profile).
TOPOLOGY = _path(VENDOR_ENDPOINT, _vendor(0xFC02), _vendor(0))
EFFECT = _path(VENDOR_ENDPOINT, _vendor(0xFC05), _vendor(0))
EFFECT_SUB = _path(VENDOR_ENDPOINT, _vendor(0xFC05), _vendor(1))
# The renderer a Cube Matrix runs now (FC03 attribute 0): FC05's effect only
# echoes the last request, and stays 0 while the lamp's demo loop changes this
# every 30 s.
RUNNING_EFFECT = _path(VENDOR_ENDPOINT, _vendor(0xFC03), _vendor(0))
# Standard Matter clusters of the light endpoint: on/off, its level, and the
# plain colour the Yeelight app sets (Color Control: hue and saturation,
# 0-254).
ON_OFF = _path(1, 6, 0)
# OnOff's StartUpOnOff: what the lamp does at power-on (0 off, 1 on; a Cube
# Matrix takes any other value, null included, as on).
START_UP_ON_OFF = _path(1, 6, 0x4003)
LEVEL = _path(1, 8, 0)
HUE = _path(1, 768, 0)
SATURATION = _path(1, 768, 1)
BASIC_VENDOR_ID = _path(0, 40, 2)
NETWORK_INTERFACES = _path(0, 51, 0)
# General Diagnostics RebootCount: one more each time the lamp starts (a
# power cut too short for the LAN probe to see, 2026-11-11).
REBOOT_COUNT = _path(0, 51, 1)
# What the light follows, by name (light_matter.py MATTER_REPORTS).
REPORTED = {
    "on_off": ON_OFF,
    "level": LEVEL,
    "lan_control": LAN_CONTROL,
    "mic_music_on": MIC_MUSIC_ON,
    "mic_music_mode": MIC_MUSIC_MODE,
    "rotation": ROTATION,
    "topology": TOPOLOGY,
    "effect": EFFECT,
    "effect_sub": EFFECT_SUB,
    "hue": HUE,
    "saturation": SATURATION,
}

# What a Cube Matrix's light follows (light_matrix.py).
MATRIX_REPORTED = {
    "on_off": ON_OFF,
    "level": LEVEL,
    "lan_control": LAN_CONTROL,
    "rotation": ROTATION,
    "topology": TOPOLOGY,
    "effect": EFFECT,
    "effect_sub": EFFECT_SUB,
    "running_effect": RUNNING_EFFECT,
    "start_up_on_off": START_UP_ON_OFF,
    "reboot_count": REBOOT_COUNT,
}

# The app's direction arrows (CubeControl rotation angle), verified with the
# Yeelight app: each step clockwise adds 90 degrees.
ROTATION_ORIENTATIONS = {0: "left", 1: "up", 2: "right", 3: "down"}


def _octets(value: Any) -> bytes | None:
    """An octet string as the Matter client keeps it (bytes, or base64)."""
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if isinstance(value, str):
        try:
            return base64.b64decode(value, validate=True)
        except (ValueError, TypeError):
            return None
    return None


def usable_address(address: str) -> bool:
    """An IPv4 address a lamp can be reached at: not 0.0.0.0 (a Cube Matrix's
    node reports its Wi-Fi interface so after a power-on: an entry moved
    there lost its lamp, 2026-11-10), nor link-local, loopback, multicast or
    broadcast."""
    try:
        octets = [int(part) for part in address.split(".")]
    except (AttributeError, ValueError):
        return False
    if len(octets) != 4 or not all(0 <= octet <= 255 for octet in octets):
        return False
    first = octets[0]
    return not (
        first in (0, 127) or first >= 224 or octets[:2] == [169, 254] or address == "255.255.255.255"
    )


def node_interfaces(attributes: dict) -> list[tuple[str | None, list[str]]]:
    """A node's network interfaces (General Diagnostics): (MAC "aa:bb:...",
    IPv4 addresses) each; only addresses a lamp can be reached at
    (usable_address)."""
    interfaces = []
    for interface in attributes.get(NETWORK_INTERFACES) or []:
        if not isinstance(interface, dict):
            continue
        get = lambda field: interface.get(field, interface.get(str(field)))  # noqa: E731
        mac = _octets(get(4))
        addresses = [
            address for address in (
                ".".join(str(byte) for byte in octets)
                for octets in (_octets(value) for value in get(5) or [])
                if octets and len(octets) == 4
            )
            if usable_address(address)
        ]
        interfaces.append(
            (":".join(f"{byte:02x}" for byte in mac) if mac and any(mac) else None, addresses)
        )
    return interfaces


def yeelight_product(attributes: dict) -> int | None:
    """A Yeelight node's product id (FC00), None for another vendor's."""
    if attributes.get(BASIC_VENDOR_ID) != YEELIGHT_VENDOR_ID:
        return None
    return attributes.get(PRODUCT)


def product_model(product) -> str | None:
    """The model an entry stores (const.CONF_MODEL) for a product id."""
    return {CUBE_LITE_PRODUCT: "CubeLite", CUBE_MATRIX_PRODUCT: "CubeMatrix"}.get(product)


def node_matches(
    attributes: dict, ip: str | None, mac: str | None, products=(CUBE_LITE_PRODUCT,),
) -> str | None:
    """The MAC of the node's interface with the lamp's IP (or remembered
    MAC), or None when the node is not this lamp (or not one of
    ``products``)."""
    if yeelight_product(attributes) not in products:
        return None
    for interface_mac, addresses in node_interfaces(attributes):
        if (mac and interface_mac == mac) or (ip and ip in addresses):
            return interface_mac or mac or ""
    return None


def node_available(node) -> bool:
    """Whether the node's server reaches it now (a node whose lamp was
    factory reset stays listed, unavailable)."""
    return getattr(node, "available", True) is not False


def _attributes(node) -> dict:
    data = getattr(node, "node_data", None)
    attributes = getattr(data, "attributes", None)
    return attributes if isinstance(attributes, dict) else {}


def matter_client(hass):
    """Home Assistant's Matter client, or None (no Matter integration, not
    loaded yet)."""
    for entry in hass.config_entries.async_loaded_entries(MATTER_DOMAIN):
        adapter = getattr(getattr(entry, "runtime_data", None), "adapter", None)
        client = getattr(adapter, "matter_client", None)
        if client is not None:
            return client
    return None


class MatterLink:
    """The lamp's link to its Matter node: found, followed, released.

    ``on_report(name, value, initial)``: a value the lamp reports (REPORTED
    names); ``initial`` for the values read when the link is made (the lamp's
    state then, not a change).
    """

    def __init__(
        self,
        hass,
        on_report: Callable[[str, Any, bool], None],
        other_clients: Callable[[], list] = lambda: [],
        products=(CUBE_LITE_PRODUCT,),
        reported: dict[str, str] | None = None,
    ) -> None:
        self._hass = hass
        self._on_report = on_report
        # The lamp's model (its product ids) and what it reports.
        self._products = tuple(products)
        self._reported = dict(REPORTED if reported is None else reported)
        # Other Matter servers' connected clients, read when Home Assistant's
        # own has no live node for the lamp.
        self._other_clients = other_clients
        self._client = None
        self.node_id: int | None = None
        self.mac: str | None = None
        self.values: dict[str, Any] = {}
        self._unsubscribe: list[Callable[[], None]] = []
        # Older nodes of the same lamp on the linked node's server.
        self.stale_node_ids: list[int] = []

    @property
    def linked(self) -> bool:
        return self.node_id is not None

    @property
    def client(self):
        """Home Assistant's Matter client the link reads through, or None."""
        return self._client

    def refresh(self, ip: str | None, mac: str | None) -> bool:
        """Link (or keep, or drop) the lamp's node; True when that changed."""
        found = None
        for client in [matter_client(self._hass), *self._other_clients()]:
            if client is None:
                continue
            try:
                nodes = client.get_nodes()
            except Exception as err:  # noqa: BLE001 -- the client is not ours
                _LOGGER.debug("Matter nodes unavailable: %s", err)
                nodes = []
            matches = []
            for node in nodes:
                node_mac = node_matches(_attributes(node), ip, mac, self._products)
                if node_mac is not None:
                    matches.append((node, node_mac))
            # Several nodes for the lamp: it was paired again (a factory
            # reset erases its pairing, and the old node can stay listed as
            # available): the newest, the highest node id.
            live = [match for match in matches if node_available(match[0])]
            if live:
                newest, newest_mac = max(live, key=lambda match: match[0].node_id)
                found = (client, newest, newest_mac)
                self.stale_node_ids = sorted(
                    node.node_id for node, node_mac in matches
                    if node.node_id < newest.node_id and newest_mac and node_mac == newest_mac
                )
                break
        if found is None:
            self.stale_node_ids = []
            if not self.linked:
                return False
            _LOGGER.info("Matter link released (node %s)", self.node_id)
            self.release()
            return True
        client, node, node_mac = found
        if client is self._client and node.node_id == self.node_id:
            return False
        self.release()
        self._client = client
        self.node_id = node.node_id
        self.mac = node_mac or mac
        attributes = _attributes(node)
        for name, path in self._reported.items():
            self.values[name] = attributes.get(path)
            self._unsubscribe.append(
                client.subscribe_events(
                    self._report_callback(name),
                    node_filter=node.node_id,
                    attr_path_filter=path,
                )
            )
        _LOGGER.info("Linked to Matter node %s", node.node_id)
        for name in self._reported:
            self._on_report(name, self.values[name], True)
        return True

    def address(self) -> str | None:
        """The linked node's IPv4 address on the lamp's interface (its MAC),
        as its server reports it now; None when not known."""
        if self._client is None or self.node_id is None or not self.mac:
            return None
        try:
            node = next(
                (node for node in self._client.get_nodes() if node.node_id == self.node_id), None
            )
        except Exception:  # noqa: BLE001 -- the client is not ours
            return None
        if node is None or not node_available(node):
            return None
        for interface_mac, addresses in node_interfaces(_attributes(node)):
            if interface_mac == self.mac and addresses:
                return addresses[0]
        return None

    async def remove_stale_nodes(self) -> list[int]:
        """Remove the lamp's stale nodes from the linked node's server (see
        the module docstring); the ids removed."""
        removed = []
        for node_id in list(self.stale_node_ids):
            try:
                await self._client.remove_node(node_id)
            except Exception as err:  # noqa: BLE001 -- tried again at the next check
                _LOGGER.debug("Stale Matter node %s not removed: %s", node_id, err)
                continue
            _LOGGER.warning(
                "Removed Matter node %s: an earlier pairing of the lamp now paired as node %s",
                node_id, self.node_id,
            )
            removed.append(node_id)
        self.stale_node_ids = [node_id for node_id in self.stale_node_ids if node_id not in removed]
        return removed

    def _report_callback(self, name: str):
        def report(event, value) -> None:
            if getattr(event, "value", event) != "attribute_updated":
                return
            self.values[name] = value
            self._on_report(name, value, False)

        return report

    def release(self) -> None:
        for unsubscribe in self._unsubscribe:
            try:
                unsubscribe()
            except Exception:  # noqa: BLE001 -- the client may be gone
                pass
        self._unsubscribe = []
        self._client = None
        self.node_id = None
        self.values = {}

    def summary(self) -> dict | None:
        """What the light publishes (its `matter` attribute), None unlinked."""
        if not self.linked:
            return None
        return {"node_id": self.node_id, **self.values}
