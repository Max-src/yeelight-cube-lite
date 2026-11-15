"""A Cube Matrix's fast channel: the classic Yeelight "music mode".

The Cube Matrix (device_profile) answers the classic Yeelight LAN protocol.
Over TCP it takes about 60 commands a minute; its UDP sessions answer
commands but, filmed on 2026-11-08, showed a stream of frames late (tens of
seconds behind) or not at all. Its music mode does not: ``set_music [1, host,
port]`` makes the lamp connect back to ``host:port``, and every command sent
on that connection is taken at once, unanswered and without quota. Filmed:
frames shown in real time; up to 6 frames a second all shown, beyond that the
lamp skips some but never falls behind. The connection stays up idle (2 min
tested), ordinary TCP commands still work meanwhile (``get_prop`` answered,
``music_on`` 1), and the lamp leaves music mode when it is closed.

MusicChannel has UdpSession's interface (request, ping, close, is_open,
sessions_opened, session_setup), so lamp_client.LampClient uses it in its
place for a Cube Matrix: everything else (falling back to TCP on
UdpUnavailable, trying again later) stays as it is. Nothing comes back on the
connection: a command is taken as accepted ({"result": ["ok"]}); the commands
that read something (get_prop...) go over a short TCP connection instead.

Opening the connection puts the lamp in music mode, which shows the last
frame over whatever it ran (2026-11-09: its own effect, started over
Matter, froze a few seconds later, when a connection check opened it). So it
is opened only for frames: direct mode, a frame, or any command while direct
mode is on (session_setup). Anything else, and a connection check, goes over
TCP while it is closed (NotOpen).

Direct mode is sent again at least every DIRECT_REFRESH seconds while frames
go (before the frame that is due): sent once, a stream froze on its last
frame after 10 to 20 s (filmed 2026-11-09, on some ticks of the lamp's demo
loop); every 2 s kept 5 to 6 frames a second shown, a 15-minute stream
without a freeze. Before every frame also works, but halves the frames shown.

No Home Assistant import.
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket
import time

from .udp_session import UdpTooLarge, UdpUnavailable

_LOGGER = logging.getLogger(__name__)

LAN_PORT = 55443
# How long the lamp has to connect back after set_music.
CONNECT_BACK_TIMEOUT = 5.0
# The port Home Assistant listens on for the lamp's music connection (any
# free one when taken, e.g. by a second Cube Matrix): a fixed one, so a
# firewall can let the lamp in (TCP from the lamp to Home Assistant).
MUSIC_PORT = 55450
# A write the lamp does not take within this (it stopped reading): the
# connection is given up, rather than every frame and command waiting.
WRITE_TIMEOUT = 2.0
# A command over the short TCP connection: its answer within this.
TCP_ANSWER_TIMEOUT = 2.0
# Commands whose answer is wanted (sent over TCP, not on the music connection).
_READS = frozenset({"get_prop", "get_supported_fx_mode", "cron_get"})
# Never sent on the music connection (it is the music connection's own).
_OWN = frozenset({"set_music", "udp_sess_new", "udp_sess_keep_alive", "udp_chroma_sess_new"})
_ACCEPTED = {"result": ["ok"]}
# What opens the connection when it is closed (with anything while direct
# mode is on).
_OPENS = frozenset({"activate_fx_mode", "update_leds"})


class NotOpen(UdpTooLarge):
    """The music connection is closed and the command does not need it:
    sent over TCP instead (opening it would end what the lamp shows)."""


# Direct mode, and how often it is sent again while frames go (seconds).
DIRECT_MODE = ("activate_fx_mode", [{"mode": "direct"}])
DIRECT_REFRESH = 2.0


def local_address_for(ip: str) -> str:
    """This host's address on the route to ``ip`` (the one the lamp can
    reach): no packet is sent."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect((ip, LAN_PORT))
        return probe.getsockname()[0]
    finally:
        probe.close()


async def tcp_request(ip: str, method: str, params: list, port: int = LAN_PORT,
                      timeout: float = TCP_ANSWER_TIMEOUT) -> dict | None:
    """One command over a short TCP connection, with its answer (None: none
    in time). The lamp's error answers are not always JSON
    (``"message":invalid params``, unquoted): such a line counts as an
    error."""
    reader = writer = None
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout)
        payload = json.dumps({"id": 1, "method": method, "params": params}, separators=(",", ":"))
        writer.write(payload.encode() + b"\r\n")
        await writer.drain()
        deadline = time.monotonic() + timeout
        while (left := deadline - time.monotonic()) > 0:
            line = await asyncio.wait_for(reader.readline(), left)
            if not line:
                return None
            try:
                answer = json.loads(line)
            except ValueError:
                if b'"id":1' in line.replace(b" ", b""):
                    return {"error": {"code": -1, "message": line.decode(errors="replace").strip()}}
                continue
            if isinstance(answer, dict) and answer.get("id") == 1:
                return answer
        return None
    except (OSError, asyncio.TimeoutError):
        return None
    finally:
        if writer is not None:
            writer.close()


class MusicChannel:
    """The Cube Matrix's music-mode connection (see the module docstring)."""

    def __init__(self, ip: str, port: int = LAN_PORT) -> None:
        self._ip = ip
        self._port = port
        self._lock = asyncio.Lock()
        self._server: asyncio.AbstractServer | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._connected: asyncio.Future | None = None
        self._last_send = 0.0
        # When direct mode was last sent on the connection (monotonic).
        self._direct_at: float | None = None
        # As UdpSession: connections opened so far, and what each new one is
        # sent first (direct mode, while it is on).
        self.sessions_opened = 0
        self.session_setup: list[tuple[str, list]] = []
        # The last opening failed because the lamp never connected back (a
        # firewall, a container network): the music_blocked repair.
        self.connect_back_failed = False

    @property
    def is_open(self) -> bool:
        return self._writer is not None and not self._writer.is_closing()

    async def _accepted(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if self._connected is None or self._connected.done():
            writer.close()  # not asked for (or already connected)
            return
        self._connected.set_result(writer)
        # Nothing is answered on it; reading notices the lamp closing it.
        try:
            while await reader.read(1024):
                pass
        except OSError:
            pass
        if self._writer is writer:
            _LOGGER.debug("[MUSIC] [%s] The lamp closed the music connection", self._ip)
            self._writer = None

    async def _open(self) -> None:
        self.close()
        loop = asyncio.get_running_loop()
        try:
            host = await loop.run_in_executor(None, local_address_for, self._ip)
            self._connected = loop.create_future()
            try:
                self._server = await asyncio.start_server(self._accepted, host=host, port=MUSIC_PORT)
            except OSError:
                self._server = await asyncio.start_server(self._accepted, host=host, port=0)
            port = self._server.sockets[0].getsockname()[1]
        except OSError as err:
            self.close()
            raise UdpUnavailable(f"no music connection: {err}") from err
        answer = await tcp_request(self._ip, "set_music", [1, host, port], self._port)
        if answer is None or "error" in answer:
            self.close()
            raise UdpUnavailable(f"set_music refused: {answer}")
        try:
            writer = await asyncio.wait_for(self._connected, CONNECT_BACK_TIMEOUT)
        except asyncio.TimeoutError as err:
            self.close()
            self.connect_back_failed = True
            raise UdpUnavailable(
                f"the lamp did not connect back to {host}:{port} (firewall?)"
            ) from err
        except BaseException:
            # This task was cancelled: stop listening, so a late connect-back
            # does not leave a connection nobody uses on one of its TCP slots.
            self.close()
            raise
        if writer is None:
            # Closed meanwhile (close_music_session): a failure to send, not
            # a cancellation of the caller (the stream would end for good).
            raise UdpUnavailable("the music connection was closed while opening")
        self.connect_back_failed = False
        self._writer = writer
        self.sessions_opened += 1
        _LOGGER.debug("[MUSIC] [%s] Music connection open (%s:%s)", self._ip, host, port)
        self._direct_at = None
        for method, params in self.session_setup:
            await self._write(method, params)

    async def _write(self, method: str, params: list) -> None:
        payload = json.dumps({"id": 1, "method": method, "params": params}, separators=(",", ":"))
        try:
            self._writer.write(payload.encode() + b"\r\n")
            await asyncio.wait_for(self._writer.drain(), WRITE_TIMEOUT)
        except asyncio.TimeoutError as err:
            self.close()
            raise UdpUnavailable(f"the lamp stopped reading the music connection ({WRITE_TIMEOUT:.0f} s)") from err
        except (OSError, AttributeError) as err:
            self.close()
            raise UdpUnavailable(f"music connection lost: {err}") from err
        self._last_send = time.monotonic()
        if (method, params) == DIRECT_MODE:
            self._direct_at = self._last_send

    def _direct_due(self) -> bool:
        """Direct mode is on (session_setup) and was last sent at least
        DIRECT_REFRESH seconds ago."""
        if DIRECT_MODE not in self.session_setup:
            return False
        return self._direct_at is None or time.monotonic() - self._direct_at >= DIRECT_REFRESH

    async def request(self, method: str, params: list | None = None) -> dict | None:
        """Send ``method``: None for a frame, {"result": ["ok"]} for another
        command on the music connection, the lamp's answer for a read (over
        TCP). Raises UdpUnavailable when the connection cannot be had."""
        params = list(params or [])
        if method in _READS:
            answer = await tcp_request(self._ip, method, params, self._port)
            if answer is None:
                # A connection just closed may still count on the lamp: once more.
                await asyncio.sleep(0.5)
                answer = await tcp_request(self._ip, method, params, self._port)
            if answer is None:
                raise UdpUnavailable(f"no answer to {method}")
            return answer
        if method in _OWN:
            return dict(_ACCEPTED)
        async with self._lock:
            if not self.is_open:
                if method not in _OPENS and not self.session_setup:
                    raise NotOpen(f"{method}: no music connection needed")
                await self._open()
            if method == "update_leds" and self._direct_due():
                await self._write(*DIRECT_MODE)
            await self._write(method, params)
        return None if method == "update_leds" else dict(_ACCEPTED)

    async def ping(self) -> bool:
        """Whether the music connection is (or can be) open: opened only
        while direct mode is on (session_setup); else False, the caller
        checks the lamp over TCP."""
        async with self._lock:
            if self.is_open:
                return True
            if not self.session_setup:
                return False
            try:
                await self._open()
            except UdpUnavailable:
                return False
            return True

    def close(self) -> None:
        """Close the connection (the lamp leaves music mode) and stop listening."""
        writer, self._writer = self._writer, None
        if writer is not None:
            writer.close()
        server, self._server = self._server, None
        if server is not None:
            server.close()
        if self._connected is not None and not self._connected.done():
            self._connected.set_result(None)  # the opening task fails (UdpUnavailable)
        self._connected = None
