"""Yeelight writes and commands to a lamp over Matter (optional).

Home Assistant's Matter server reads the lamp's Yeelight clusters
(matter_link.py) but refuses writes and commands until it knows them
(proposed upstream: matter-js/matterjs-server#1199). This module finds a
server that can deliver them to the lamp, in this order:

1. Home Assistant's own Matter server, once it knows the Yeelight clusters:
   checked with a read-only command (getCurrentEffect), again after the
   server changes;
2. a local development server, only on a development install (its module,
   matter_dev_server.py, is not committed);
3. none: MatterCommandsUnavailable, which callers catch to fall back to LAN
   or to hide what needs it. Lamps without Matter, or with the official
   server only, stay as they are.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any

from .matter_link import (
    VENDOR_ENDPOINT,
    MatterLink,
    _attributes,
    _vendor,
    node_matches,
)

_LOGGER = logging.getLogger(__name__)

BASIC_CONFIG_CLUSTER = _vendor(0xFC01)
CUBE_CONTROL_CLUSTER = _vendor(0xFC02)
EFFECTS_CLUSTER = _vendor(0xFC05)

# Seconds the server check (getCurrentEffect) may take; a check that cannot
# tell (no answer, an unknown error) is tried again after CHECK_RETRY.
CHECK_TIMEOUT = 5.0
CHECK_RETRY = 600.0

# How a server without the Yeelight clusters refuses a command or a write.
_UNKNOWN_CLUSTER_MARKERS = ("unknown", "does not exist")


class MatterCommandsUnavailable(Exception):
    """No Matter server can deliver Yeelight commands to the lamp."""


def refuses_yeelight(error: Exception) -> bool:
    """Whether a server's error means it does not know the Yeelight clusters."""
    text = str(error).lower()
    return any(marker in text for marker in _UNKNOWN_CLUSTER_MARKERS)


def _server_key(client) -> tuple[int, Any]:
    """A server as reached through a client: the client, and the server's
    version (a server update is checked again)."""
    info = getattr(client, "server_info", None)
    return id(client), getattr(info, "sdk_version", None)


def _dev_server(hass):
    """The local development server when its module is present (it is not
    committed: matter_dev_server.py); None without it (every user)."""
    try:
        from .matter_dev_server import dev_server
    except ImportError:
        return None
    return dev_server(hass)


async def async_close_dev_connections(hass) -> None:
    """Close the development server's connection, if any (the last lamp
    unloads)."""
    try:
        from .matter_dev_server import async_close_dev_servers
    except ImportError:
        return
    await async_close_dev_servers(hass)


class MatterCommands:
    """Yeelight writes and commands to one lamp, through the first server
    that delivers them (see the module docstring).

    ``backend``: "matter" (Home Assistant's server), "dev" (a local
    development server) or None (none found yet); ``reason``: why none
    delivers (each server's), None when one does.
    """

    def __init__(
        self,
        hass,
        link: MatterLink | None,
        ip: Callable[[], str | None],
        dev: Callable[[Any], Any] = _dev_server,
    ) -> None:
        self._hass = hass
        self._link = link
        self._ip = ip
        self._dev = dev
        # Servers checked: their key (_server_key) -> whether they deliver.
        self._checked: dict[tuple[int, Any], bool] = {}
        # Servers whose check could not tell: when to check them again.
        self._check_again_at: dict[tuple[int, Any], float] = {}
        self.backend: str | None = None
        self.reason: str | None = None
        self._check_error: str | None = None

    async def _route(self) -> tuple[str, Any, int]:
        """(backend, client, node id) of the first server that delivers."""
        reasons: list[str] = []
        link = self._link
        if link is not None and link.linked and link.client is not None:
            key = _server_key(link.client)
            if key not in self._checked and time.monotonic() >= self._check_again_at.get(key, 0.0):
                delivers = await self._delivers(link.client, link.node_id)
                if delivers is None:  # could not tell: checked again later
                    self._check_again_at[key] = time.monotonic() + CHECK_RETRY
                else:
                    self._checked[key] = delivers
            if self._checked.get(key):
                self.reason = None
                return "matter", link.client, link.node_id
            reasons.append(
                "Home Assistant's Matter server does not know the Yeelight clusters"
                if key in self._checked
                else f"Home Assistant's Matter server could not be checked ({self._check_error})"
            )
        else:
            reasons.append("the lamp is not linked to Home Assistant's Matter integration")
        dev = self._dev(self._hass)
        if dev is not None:
            client = await dev.async_client()
            if client is None:
                error = getattr(dev, "last_error", None)
                reasons.append(
                    "the development server cannot be reached" + (f" ({error})" if error else "")
                )
            else:
                node_id = self._node_on(client)
                if node_id is not None:
                    self.reason = None
                    return "dev", client, node_id
                reasons.append("the lamp is not shared to the development server")
        self.backend = None
        self.reason = "; ".join(reasons)
        raise MatterCommandsUnavailable(
            f"No Matter server can send Yeelight commands to this lamp: {self.reason}"
        )

    def _node_on(self, client) -> int | None:
        """The lamp's node on a server, by its IP or its remembered MAC."""
        mac = self._link.mac if self._link is not None else None
        try:
            nodes = client.get_nodes()
        except Exception:  # noqa: BLE001
            return None
        for node in nodes:
            if node_matches(_attributes(node), self._ip(), mac) is not None:
                return node.node_id
        return None

    async def _delivers(self, client, node_id: int) -> bool | None:
        """Whether a server knows the Yeelight clusters (a read-only
        command); None when it could not tell (the lamp did not answer)."""
        try:
            await asyncio.wait_for(
                self._send(client, node_id, EFFECTS_CLUSTER, "getCurrentEffect", {}),
                CHECK_TIMEOUT,
            )
        except Exception as err:  # noqa: BLE001 -- refused, no answer, timeout
            if refuses_yeelight(err):
                return False
            _LOGGER.debug("Yeelight Matter check failed: %s", err)
            self._check_error = str(err) or type(err).__name__
            return None
        return True

    @staticmethod
    async def _send(client, node_id: int, cluster_id: int, name: str, payload: dict):
        return await client.send_command(
            "device_command",
            node_id=node_id,
            endpoint_id=VENDOR_ENDPOINT,
            cluster_id=cluster_id,
            command_name=name,
            payload=payload,
        )

    async def async_available(self) -> bool:
        """Whether some server delivers Yeelight commands to the lamp now."""
        try:
            self.backend = (await self._route())[0]
        except MatterCommandsUnavailable:
            return False
        return True

    async def async_command(self, cluster_id: int, name: str, payload: dict | None = None):
        """Send a Yeelight command (field names as in the cluster definition);
        returns its response, if any. MatterCommandsUnavailable: no server."""
        backend, client, node_id = await self._route()
        self.backend = backend
        return await self._send(client, node_id, cluster_id, name, payload or {})

    async def async_write(self, path: str, value) -> Any:
        """Write a Yeelight attribute ("endpoint/cluster/attribute", as
        matter_link's paths). MatterCommandsUnavailable: no server."""
        backend, client, node_id = await self._route()
        self.backend = backend
        return await client.write_attribute(node_id, path, value)
