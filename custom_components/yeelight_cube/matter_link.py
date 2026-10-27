"""A lamp's optional Matter link: the same Cube Lite, commissioned in Home
Assistant's own Matter integration, read through its connection.

LAN stays the lamp's control path. When the lamp is also a Matter node, the
lamp pushes over Matter what LAN never reports: its buttons (the playlist
and the microphone music modes), changes made in the Yeelight app and its
direction setting. This module finds that node and forwards the reports to
the light (light_matter.py); it never writes to it (Home Assistant's Matter
server refuses Yeelight's vendor clusters for writes and commands).

A node is the lamp's when it is a Yeelight Cube Lite whose Wi-Fi interface
has the lamp's IP address, or the MAC address remembered from an earlier
link (the IP may change). Re-checked every minute (light._async_check_problems),
so Matter set up before or after the lamp, or a re-commissioned node, links
on its own; without the Matter integration nothing happens.
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


def _vendor(cluster_or_attribute: int) -> int:
    """A Yeelight vendor-specific id: the vendor id in the upper 16 bits."""
    return (YEELIGHT_VENDOR_ID << 16) | cluster_or_attribute


def _path(endpoint: int, cluster: int, attribute: int) -> str:
    return f"{endpoint}/{cluster}/{attribute}"


# The Cube's vendor endpoint and what it reports (verified on a Cube Lite,
# firmware 1.12.32 / LED chip 34).
VENDOR_ENDPOINT = 2
PRODUCT = _path(VENDOR_ENDPOINT, _vendor(0xFC00), _vendor(0))
LAN_CONTROL = _path(VENDOR_ENDPOINT, _vendor(0xFC01), _vendor(1))
MIC_MUSIC_ON = _path(VENDOR_ENDPOINT, _vendor(0xFC01), _vendor(2))
MIC_MUSIC_MODE = _path(VENDOR_ENDPOINT, _vendor(0xFC01), _vendor(3))
ROTATION = _path(VENDOR_ENDPOINT, _vendor(0xFC02), _vendor(1))
EFFECT = _path(VENDOR_ENDPOINT, _vendor(0xFC05), _vendor(0))
EFFECT_SUB = _path(VENDOR_ENDPOINT, _vendor(0xFC05), _vendor(1))
# Standard Matter clusters of the light endpoint: on/off, its level, and the
# plain colour the Yeelight app sets (Color Control: hue and saturation,
# 0-254).
ON_OFF = _path(1, 6, 0)
LEVEL = _path(1, 8, 0)
HUE = _path(1, 768, 0)
SATURATION = _path(1, 768, 1)
BASIC_VENDOR_ID = _path(0, 40, 2)
NETWORK_INTERFACES = _path(0, 51, 0)
# What the light follows, by name (light_matter.py MATTER_REPORTS).
REPORTED = {
    "on_off": ON_OFF,
    "level": LEVEL,
    "lan_control": LAN_CONTROL,
    "mic_music_on": MIC_MUSIC_ON,
    "mic_music_mode": MIC_MUSIC_MODE,
    "rotation": ROTATION,
    "effect": EFFECT,
    "effect_sub": EFFECT_SUB,
    "hue": HUE,
    "saturation": SATURATION,
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


def node_interfaces(attributes: dict) -> list[tuple[str | None, list[str]]]:
    """A node's network interfaces (General Diagnostics): (MAC "aa:bb:...",
    IPv4 addresses) each."""
    interfaces = []
    for interface in attributes.get(NETWORK_INTERFACES) or []:
        if not isinstance(interface, dict):
            continue
        get = lambda field: interface.get(field, interface.get(str(field)))  # noqa: E731
        mac = _octets(get(4))
        addresses = [
            ".".join(str(byte) for byte in octets)
            for octets in (_octets(value) for value in get(5) or [])
            if octets and len(octets) == 4
        ]
        interfaces.append(
            (":".join(f"{byte:02x}" for byte in mac) if mac and any(mac) else None, addresses)
        )
    return interfaces


def is_cube_lite(attributes: dict) -> bool:
    """Whether a node is a Yeelight Cube Lite."""
    return (
        attributes.get(BASIC_VENDOR_ID) == YEELIGHT_VENDOR_ID
        and attributes.get(PRODUCT) == CUBE_LITE_PRODUCT
    )


def node_matches(attributes: dict, ip: str | None, mac: str | None) -> str | None:
    """The MAC of the node's interface with the lamp's IP (or remembered
    MAC), or None when the node is not this lamp."""
    if not is_cube_lite(attributes):
        return None
    for interface_mac, addresses in node_interfaces(attributes):
        if (mac and interface_mac == mac) or (ip and ip in addresses):
            return interface_mac or mac or ""
    return None


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

    def __init__(self, hass, on_report: Callable[[str, Any, bool], None]) -> None:
        self._hass = hass
        self._on_report = on_report
        self._client = None
        self.node_id: int | None = None
        self.mac: str | None = None
        self.values: dict[str, Any] = {}
        self._unsubscribe: list[Callable[[], None]] = []

    @property
    def linked(self) -> bool:
        return self.node_id is not None

    @property
    def client(self):
        """Home Assistant's Matter client the link reads through, or None."""
        return self._client

    def refresh(self, ip: str | None, mac: str | None) -> bool:
        """Link (or keep, or drop) the lamp's node; True when that changed."""
        client = matter_client(self._hass)
        found = None
        if client is not None:
            try:
                nodes = client.get_nodes()
            except Exception as err:  # noqa: BLE001 -- the client is not ours
                _LOGGER.debug("Matter nodes unavailable: %s", err)
                nodes = []
            for node in nodes:
                node_mac = node_matches(_attributes(node), ip, mac)
                if node_mac is not None:
                    found = (node, node_mac)
                    break
        if found is None:
            if not self.linked:
                return False
            _LOGGER.info("Matter link released (node %s)", self.node_id)
            self.release()
            return True
        node, node_mac = found
        if client is self._client and node.node_id == self.node_id:
            return False
        self.release()
        self._client = client
        self.node_id = node.node_id
        self.mac = node_mac or mac
        attributes = _attributes(node)
        for name, path in REPORTED.items():
            self.values[name] = attributes.get(path)
            self._unsubscribe.append(
                client.subscribe_events(
                    self._report_callback(name),
                    node_filter=node.node_id,
                    attr_path_filter=path,
                )
            )
        _LOGGER.info("Linked to Matter node %s", node.node_id)
        for name in REPORTED:
            self._on_report(name, self.values[name], True)
        return True

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
