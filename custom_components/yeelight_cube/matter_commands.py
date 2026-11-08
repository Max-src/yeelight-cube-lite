"""Yeelight writes and commands to a lamp over Matter (optional).

Home Assistant's Matter server reads the lamp's Yeelight clusters
(matter_link.py); it writes them and sends their commands from
matterjs-server 1.5.4 (matter-js/matterjs-server#1203), and refuses them
before. Whether it delivers them to the lamp is checked with a read-only
command (getCurrentEffect), again after the server changes; when it does
not (an older server, no Matter), MatterCommandsUnavailable is caught to
fall back to LAN or to hide what needs it. Lamps without Matter stay as
they are.
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
    _vendor,
)

_LOGGER = logging.getLogger(__name__)

BASIC_CONFIG_CLUSTER = _vendor(0xFC01)
CUBE_CONTROL_CLUSTER = _vendor(0xFC02)
EFFECTS_CLUSTER = _vendor(0xFC05)

# Seconds the server check (getCurrentEffect) may take; a check that cannot
# tell (no answer, an unknown error) is tried again after CHECK_RETRY. It is
# usually the lamp, not the server: rebooting after a power cycle (its Matter
# session takes a few minutes to come back), or busy.
CHECK_TIMEOUT = 5.0
CHECK_RETRY = 60.0

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


class MatterCommands:
    """Yeelight writes and commands to one lamp, through Home Assistant's
    Matter server when it delivers them (see the module docstring).

    ``backend``: "matter" (Home Assistant's server) or None (it does not
    deliver them yet); ``reason``: why not, None when it does.
    """

    def __init__(
        self,
        hass,
        link: MatterLink | None,
        ip: Callable[[], str | None],
    ) -> None:
        self._hass = hass
        self._link = link
        self._ip = ip
        # Servers checked: their key (_server_key) -> whether they deliver.
        self._checked: dict[tuple[int, Any], bool] = {}
        # Servers whose check could not tell: when to check them again.
        self._check_again_at: dict[tuple[int, Any], float] = {}
        self.backend: str | None = None
        self.reason: str | None = None
        self._check_error: str | None = None

    async def _route(self) -> tuple[str, Any, int]:
        """(backend, client, node id) of the server that delivers."""
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
        self.backend = None
        self.reason = "; ".join(reasons)
        raise MatterCommandsUnavailable(
            f"No Matter server can send Yeelight commands to this lamp: {self.reason}"
        )

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
