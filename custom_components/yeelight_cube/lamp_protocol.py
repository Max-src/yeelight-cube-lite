"""What every connection to a lamp shares, Cube Lite and Cube Matrix alike.

Owns the pieces of the LAN protocol that hold no connection state: the
errors a command raises (CubeConnectionError, CubeFxModeLost, LAMP_ERRORS and
the is_*_error checks), the update_leds frame encoding and the frame trace
(the ``frames`` logger), the one-shot connections used before a lamp is set
up (check_tcp, send_once) and the reading of a checked command's answer
(_raw_reply_error), plus the reconnection timings the lamp client's parts
(lamp_client*.py) and the light share. No Home Assistant import.
"""
import asyncio
import base64
import json
import logging
import re
import socket
import struct
import time
import zlib
from yeelight import BulbException # type: ignore

# A trace of what is sent to the lamps over UDP, at debug level, on its own
# logger so it can be turned on alone (logger.set_level
# custom_components.yeelight_cube.frames: debug): every command, every frame
# with a fingerprint (frame_id), and where the frame came from (a display
# update, the re-send after a burst).
FRAMES = logging.getLogger(__name__.rpartition(".")[0] + ".frames")


def frame_id(rgb_data: str) -> str:
    """A short fingerprint of an update_leds frame (the frame trace)."""
    return f"{zlib.crc32(rgb_data.encode('ascii')):08x}"


def trace_frame(ip: str, what: str, rgb_data: str) -> None:
    """Log a frame on the trace (``[ip] <what> <fingerprint>``); nothing is
    computed while the trace is off."""
    if FRAMES.isEnabledFor(logging.DEBUG):
        FRAMES.debug("[%s] %s %s", ip, what, frame_id(rgb_data))

RECONNECT_COOLDOWN_INITIAL = 5.0  # Starting cooldown — Cube needs time to recover its TCP stack
RECONNECT_COOLDOWN_MAX = 10.0    # Maximum cooldown — caps backoff for faster recovery after transient outages
QUOTA_BACKOFF_MULTIPLIER = 2.0  # Multiplier for backoff on quota errors
SOCKET_ERROR_WAIT = 0.5         # Seconds to wait after socket errors
MAX_CONSECUTIVE_FAILURES = 2    # Circuit breaker: double cooldown after just 2 failures (was 5)
CONNECT_TIMEOUT = 0.5           # TCP connect timeout — LAN connects take <10ms, 0.5s catches failures fast
RECOVERY_CONNECT_TIMEOUT = 1.5  # Longer timeout when recovering — LAN still connects in <50ms after reboot

_RST_LINGER = struct.pack("ii", 1, 0)  # SO_LINGER value for an abortive close (RST)

# Returned by LampClient._udp_request: send this command over TCP instead.
_USE_TCP = object()


async def check_tcp(ip: str, port: int, timeout: float) -> None:
    """Raise OSError unless the lamp accepts a TCP connection within
    ``timeout`` (a reachability probe: setup, recovery). The socket is
    RST-closed so it leaves no TIME_WAIT behind."""

    def _connect() -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.settimeout(timeout)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER)
            sock.connect((ip, port))
        finally:
            sock.close()

    await asyncio.to_thread(_connect)


async def send_once(ip: str, port: int, method: str, params: list, timeout: float) -> dict:
    """Send one LAN command to a lamp not set up yet (the setup's Fire
    check, the model probe) and wait for its answer, which it returns.
    Raises OSError (no answer, refused)."""
    payload = json.dumps({"id": 1, "method": method, "params": params}, separators=(",", ":"))

    def _send() -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.settimeout(timeout)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER)
            sock.connect((ip, port))
            sock.sendall(payload.encode() + b"\r\n")
            pending = b""
            while True:
                chunk = sock.recv(1024)  # socket.timeout (an OSError) ends it
                if not chunk:
                    raise OSError(f"the lamp did not answer {method}")
                pending += chunk
                *lines, pending = pending.split(b"\n")
                for line in lines:
                    try:
                        answer = json.loads(line)
                    except ValueError:
                        continue
                    # Notifications ("props") may come first: only its answer.
                    if isinstance(answer, dict) and answer.get("id") == 1:
                        if "error" in answer:
                            raise OSError(f"the lamp refused {method}: {answer['error']}")
                        return answer
        finally:
            sock.close()

    return await asyncio.to_thread(_send)


class CubeConnectionError(BulbException):
    """A command did not reach the lamp: it is unreachable, the connection is
    in its reconnect cooldown, or the socket died. Worth retrying once the
    lamp answers again.

    Subclasses BulbException (same ``{"code", "message"}`` argument) so code
    that catches the library's exception keeps working.
    """

    def __init__(self, message: str) -> None:
        super().__init__({"code": 0, "message": message})

    @property
    def message(self) -> str:
        return self.args[0]["message"]

    def __str__(self) -> str:
        return self.message


class CubeFxModeLost(CubeConnectionError):
    """The connection was re-opened while pixel data was being sent, so the
    lamp may have ignored it: direct FX mode must be activated again."""


class _LazyText:
    """A log argument whose text is computed only if the record is emitted."""

    __slots__ = ("_build",)

    def __init__(self, build) -> None:
        self._build = build

    def __str__(self) -> str:
        return str(self._build())


def encode_rgb_frame(colors) -> str:
    """update_leds payload for a frame of RGB colors: base64 of the R, G, B
    bytes."""
    return base64.b64encode(
        bytes(channel for rgb in colors for channel in rgb)
    ).decode("ascii")


# What a command to the lamp raises: a socket failure or timeout (OSError,
# TimeoutError included), or the lamp's refusal or the connection's
# (BulbException, CubeConnectionError included).
LAMP_ERRORS = (OSError, BulbException)


def is_connection_error(err: BaseException) -> bool:
    """Whether a command failed because it did not reach the lamp: a
    CubeConnectionError, or a raw socket failure (OSError, which includes
    timeouts) from a fresh-connection command."""
    return isinstance(err, (CubeConnectionError, OSError))


def is_quota_error(err: BaseException) -> bool:
    """Whether the lamp refused a command because of its rate limit (a Cube
    Lite: code -1; a Cube Matrix: code 5 "client quota exceeded", 5 also
    being its "hardware fault": told apart by the message)."""
    if not (isinstance(err, BulbException) and err.args and isinstance(err.args[0], dict)):
        return False
    return err.args[0].get("code") == -1 or "quota" in str(err.args[0].get("message", ""))


_ERROR_CODE = re.compile(rb'"code"\s*:\s*(-?\d+)')
_ERROR_MESSAGE = re.compile(rb'"message"\s*:\s*"?([^"}]*)')


def malformed_error(line: bytes) -> dict | None:
    """A Cube Matrix's error answer to command id 1 that is not JSON
    ({"id":1,"error":{"code":1, "message":invalid params}}), as {"code",
    "message"}; None for another line."""
    compact = line.replace(b" ", b"")
    if b'"id":1,' not in compact or b'"error"' not in compact:
        return None
    code = _ERROR_CODE.search(line)
    message = _ERROR_MESSAGE.search(line)
    return {
        "code": int(code.group(1)) if code else -1,
        "message": message.group(1).decode("utf8", "replace").strip() if message else line.decode(errors="replace"),
    }


RAW_REPLY_TIMEOUT = 0.5  # seconds to wait for the answer to a checked command


def _raw_reply_error(sock: socket.socket) -> dict | None:
    """The error the lamp answered to command id 1 on ``sock``, if any.

    Reads until the reply line arrives, the lamp closes the connection or
    RAW_REPLY_TIMEOUT passes. Notifications ("props" pushes) are skipped.
    No answer is not an error: the Cube often closes without replying.
    """
    sock.settimeout(RAW_REPLY_TIMEOUT)
    buffer = b""
    deadline = time.monotonic() + RAW_REPLY_TIMEOUT
    while time.monotonic() < deadline:
        try:
            data = sock.recv(4096)
        except (socket.timeout, OSError):
            return None
        if not data:
            return None
        buffer += data
        *lines, buffer = buffer.split(b"\n")
        for line in lines:
            try:
                message = json.loads(line.decode("utf8", "replace"))
            except ValueError:
                # A Cube Matrix writes its error message unquoted
                # ("message":invalid params): not JSON, still its answer.
                if (error := malformed_error(line)) is not None:
                    return error
                continue
            if not isinstance(message, dict) or message.get("id") != 1:
                continue
            error = message.get("error")
            if error is None:
                return None
            return error if isinstance(error, dict) else {"message": str(error)}
    return None
