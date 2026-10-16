"""The lamp's UDP command session (port 55444).

The Cube Lite takes the same JSON commands as over TCP (port 55443) inside a
UDP *command session*, without TCP's per-connection quota (30 commands per
connection, 54 shared, per minute) and without opening a connection per
command. Measured on the lamp (research notes, PROTOCOL.md §3-4, X13):

- ``udp_sess_new`` answers ``{"method": "udp_sess_token", "params":
  {"token": "<32 hex>"}}``; every later datagram carries that token, and the
  token only works from the socket that opened the session;
- every command is answered by its ``id`` (``{"result": ["ok"]}`` or an
  ``error``), except ``update_leds`` (pixel frames), which never is: frames are
  sent without waiting, and a lost one is simply replaced by the next;
- a refused token answers ``-1 invalid parameter`` (the lamp restarted, or the
  session expired): a new session is opened and the command sent again;
- up to 30 datagrams/s are all answered; datagrams over ~768 bytes are dropped.

One session per lamp carries everything (commands and frames): ``activate_fx_mode
direct`` only applies to the session it was sent in, and mixing a command and a
stream session on one lamp can freeze it. When the lamp drops a session and a
new one is opened, what must hold in every session (``session_setup``: direct
mode, while it is on) is sent in it first, so the caller never sees the change.

No Home Assistant or yeelight import: the caller (cube_matrix.CubeMatrix) turns
an error reply into its exception and falls back to TCP on UdpUnavailable.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import time

_LOGGER = logging.getLogger(__name__)

UDP_PORT = 55444
# The lamp drops larger datagrams (a ~768-byte receive buffer): a full
# update_leds frame is ~480 bytes, a native drawing ~650.
MAX_DATAGRAM = 760
# At most 30 datagrams a second: all answered (40/s lost about half).
MIN_SEND_INTERVAL = 1 / 30
# One attempt's wait for the answer: the median is ~3 ms, Wi-Fi spikes up to
# ~180 ms. A command is sent up to ATTEMPTS times (commands are absolute, so a
# resend is harmless).
REPLY_TIMEOUT = 0.3
ATTEMPTS = 3
HANDSHAKE_TIMEOUT = 0.6
# A frame is sent unanswered: after this long without any answer from the
# lamp, the session is confirmed (keep-alive) before the next frame.
CONFIRM_AFTER = 20.0
# The keep-alive's own setting (the misspelling is the lamp's).
KEEP_ALIVE = ["keeplive_interval", 10]
# What answers a refused token (also a command sent without a session).
_TOKEN_REFUSED = -1
# Commands the lamp never answers: sent without waiting.
_UNANSWERED = frozenset({"update_leds"})


class UdpUnavailable(Exception):
    """The session could not be opened, or the lamp stopped answering in it:
    the command was not confirmed, and the caller should use TCP."""


class UdpTooLarge(UdpUnavailable):
    """The datagram would exceed MAX_DATAGRAM: send it over TCP instead."""


class _Protocol(asyncio.DatagramProtocol):
    def __init__(self, session: "UdpSession") -> None:
        self._session = session

    def datagram_received(self, data: bytes, addr) -> None:
        self._session._received(data)

    def error_received(self, exc: Exception) -> None:
        # E.g. "port unreachable": nothing listens on 55444 there.
        self._session._fail_waiting()

    def connection_lost(self, exc) -> None:
        self._session._lost()


class UdpSession:
    """One UDP command session with one lamp, opened on first use.

    ``request()`` sends a command and returns the lamp's answer (a dict with
    ``result`` or ``error``), or None for a frame (never answered). It raises
    UdpUnavailable when the session cannot be opened or the lamp does not
    answer. Requests are sent one at a time, in order, and paced.
    """

    def __init__(self, ip: str, port: int = UDP_PORT) -> None:
        self._ip = ip
        self._port = port
        self._transport = None
        self._token: str | None = None
        self._ids = itertools.count(1)
        self._waiting: dict[int, asyncio.Future] = {}
        self._handshake: asyncio.Future | None = None
        self._lock = asyncio.Lock()
        self._last_send = 0.0
        self._last_answer = 0.0
        # Sessions opened so far (a new one after the first: the lamp lost the
        # previous one, so what it was told in it, e.g. direct mode, is gone).
        self.sessions_opened = 0
        # Commands (method, params) every new session is sent first, before
        # the command that needed it: what must hold in whichever session
        # the lamp is in (set by the caller: direct mode, while it is on).
        self.session_setup: list[tuple[str, list]] = []

    @property
    def is_open(self) -> bool:
        return self._token is not None

    # -- datagrams in ------------------------------------------------------
    def _received(self, data: bytes) -> None:
        for line in data.split(b"\n"):
            if not line.strip():
                continue
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            self._last_answer = time.monotonic()
            if message.get("method") == "udp_sess_token":
                token = (message.get("params") or {}).get("token")
                if self._handshake is not None and not self._handshake.done() and token:
                    self._handshake.set_result(token)
                continue
            future = self._waiting.get(message.get("id"))
            if future is not None and not future.done():
                future.set_result(message)

    def _fail_waiting(self) -> None:
        for future in (*self._waiting.values(), self._handshake):
            if future is not None and not future.done():
                future.set_result(None)

    def _lost(self) -> None:
        self._transport = None
        self._token = None
        self._fail_waiting()

    # -- datagrams out -----------------------------------------------------
    async def _send(self, message: dict) -> None:
        data = json.dumps(message, separators=(",", ":")).encode("utf8") + b"\r\n"
        if len(data) > MAX_DATAGRAM:
            raise UdpTooLarge(f"{message.get('method')}: {len(data)} bytes")
        wait = self._last_send + MIN_SEND_INTERVAL - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        if self._transport is None:
            raise UdpUnavailable("session closed")
        self._transport.sendto(data)
        self._last_send = time.monotonic()

    async def _answer(
        self, message: dict, timeout: float = REPLY_TIMEOUT, attempts: int = ATTEMPTS
    ) -> dict | None:
        """Send ``message`` (up to ``attempts`` times) and return its answer,
        or None when none came."""
        future = asyncio.get_running_loop().create_future()
        self._waiting[message["id"]] = future
        try:
            for _ in range(attempts):
                await self._send(message)
                try:
                    answer = await asyncio.wait_for(asyncio.shield(future), timeout)
                except asyncio.TimeoutError:
                    continue
                return answer
            return None
        finally:
            self._waiting.pop(message["id"], None)

    # -- the session -------------------------------------------------------
    async def _open(self) -> None:
        if self._transport is None:
            loop = asyncio.get_running_loop()
            try:
                self._transport, _ = await loop.create_datagram_endpoint(
                    lambda: _Protocol(self), remote_addr=(self._ip, self._port)
                )
            except OSError as err:
                raise UdpUnavailable(f"cannot open a UDP socket: {err}") from err
        self._token = None
        for _ in range(2):
            self._handshake = asyncio.get_running_loop().create_future()
            try:
                await self._send({"id": next(self._ids), "method": "udp_sess_new", "params": []})
                token = await asyncio.wait_for(asyncio.shield(self._handshake), HANDSHAKE_TIMEOUT)
            except asyncio.TimeoutError:
                continue
            finally:
                self._handshake = None
            if token:
                self._token = token
                self.sessions_opened += 1
                _LOGGER.debug("[UDP] [%s] Session opened (#%s)", self._ip, self.sessions_opened)
                await self._set_up()
                return
        raise UdpUnavailable("no session token")

    async def _set_up(self) -> None:
        """Send session_setup in the session just opened; a command it does
        not take makes the session unusable (the caller falls back to TCP)."""
        for method, params in list(self.session_setup):
            answer = await self._answer(
                {"id": next(self._ids), "method": method, "params": params, "token": self._token}
            )
            if answer is None or "error" in answer:
                self.close()
                raise UdpUnavailable(f"{method} not taken by the new session")
            _LOGGER.debug("[UDP] [%s] %s sent again in the new session", self._ip, method)

    async def _call(self, method: str, params: list) -> dict | None:
        """One command in the session; a refused token opens a new session
        and sends it again (once)."""
        for renewed in (False, True):
            if self._token is None:
                await self._open()
            message = {"id": next(self._ids), "method": method, "params": params, "token": self._token}
            if method in _UNANSWERED:
                if time.monotonic() - self._last_answer > CONFIRM_AFTER:
                    await self._confirm()
                    message["token"] = self._token
                await self._send(message)
                return None
            answer = await self._answer(message)
            if answer is None:
                self.close()
                raise UdpUnavailable(f"no answer to {method}")
            error = answer.get("error")
            if isinstance(error, dict) and error.get("code") == _TOKEN_REFUSED and not renewed:
                _LOGGER.debug("[UDP] [%s] Session refused for %s: opening a new one", self._ip, method)
                self._token = None
                continue
            return answer
        self.close()
        raise UdpUnavailable(f"session refused for {method}")

    async def _confirm(self) -> None:
        """The session still works (keep-alive), else a new one is opened."""
        answer = await self._answer(
            {"id": next(self._ids), "method": "udp_sess_keep_alive", "params": KEEP_ALIVE, "token": self._token}
        )
        if answer is None:
            self.close()
            raise UdpUnavailable("no answer to the keep-alive")
        if "error" in answer:
            _LOGGER.debug("[UDP] [%s] Keep-alive refused: opening a new session", self._ip)
            await self._open()

    async def request(self, method: str, params: list | None = None) -> dict | None:
        """Send ``method`` in the session: the lamp's answer, or None for a
        frame (never answered). Raises UdpUnavailable (UdpTooLarge for a
        datagram the lamp would drop)."""
        async with self._lock:
            return await self._call(method, list(params or []))

    async def ping(self) -> bool:
        """Whether the lamp answers in the session (opening one if needed)."""
        async with self._lock:
            try:
                if self._token is None:
                    await self._open()
                else:
                    await self._confirm()
            except UdpUnavailable:
                return False
            return True

    def close(self) -> None:
        """Close the socket (the lamp drops the session on its own)."""
        transport, self._transport = self._transport, None
        self._token = None
        self._fail_waiting()
        if transport is not None:
            transport.close()
