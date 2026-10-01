import logging
import asyncio
import base64
import json
import select
import socket
import struct
import time
from yeelight import Bulb, BulbException # type: ignore

_LOGGER = logging.getLogger(__name__)

# Rate limit constants based on validated testing (0.90 FPS = safe sustained rate)
SAFE_SUSTAINED_INTERVAL = 0.1  # 100 milliseconds between commands
FAST_SEQUENTIAL_INTERVAL = 0.02 # 20ms between commands within a single apply() burst
BURST_MODE_INTERVAL = 0.4       # 2.5 FPS for short animation bursts (5-10 frames)
MAX_BURST_COMMANDS = 30         # Maximum burst capacity before cooldown required
RECONNECT_COOLDOWN_INITIAL = 5.0  # Starting cooldown — Cube needs time to recover its TCP stack
RECONNECT_COOLDOWN_MAX = 10.0    # Maximum cooldown — caps backoff for faster recovery after transient outages
QUOTA_BACKOFF_MULTIPLIER = 2.0  # Multiplier for backoff on quota errors
SOCKET_ERROR_WAIT = 0.5         # Seconds to wait after socket errors
MAX_CONSECUTIVE_FAILURES = 2    # Circuit breaker: double cooldown after just 2 failures (was 5)
CONNECT_TIMEOUT = 0.5           # TCP connect timeout — LAN connects take <10ms, 0.5s catches failures fast
RECOVERY_CONNECT_TIMEOUT = 1.5  # Longer timeout when recovering — LAN still connects in <50ms after reboot

_RST_LINGER = struct.pack("ii", 1, 0)  # SO_LINGER value for an abortive close (RST)


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
    bytes. Each 3-byte pixel maps to exactly 4 base64 characters, so this
    equals concatenating CubeMatrix.encode_hex_color() per pixel."""
    return base64.b64encode(
        bytes(channel for rgb in colors for channel in rgb)
    ).decode("ascii")


def is_connection_error(err: BaseException) -> bool:
    """Whether a command failed because it did not reach the lamp: a
    CubeConnectionError, or a raw socket failure (OSError, which includes
    timeouts) from a fresh-connection command."""
    return isinstance(err, (CubeConnectionError, OSError))


def is_quota_error(err: BaseException) -> bool:
    """Whether the lamp refused a command because of its rate limit."""
    return (
        isinstance(err, BulbException)
        and bool(err.args)
        and isinstance(err.args[0], dict)
        and err.args[0].get("code") == -1
    )


class CubeMatrix:
    """Handles communication with the Yeelight Cube Lite device."""
    def __init__(self, ip: str, port: int):
        _LOGGER.debug("Connecting to Yeelight Cube Lite at %s:%s", ip, port)
        self.device = Bulb(ip, port)
        self._ip = ip
        self._port = port
        self.device_name = "Yeelight Cube Lite"
        self.capabilities = {}
        self.device_model = "Cube Lite"
        self.firmware_version = None
        self.device._timeout = CONNECT_TIMEOUT  # Keep low — LAN connects take <10ms, 0.5s is plenty
        self._last_command_time = 0
        self._min_command_interval = SAFE_SUSTAINED_INTERVAL
        self._consecutive_failures = 0
        self._last_reconnect_attempt = 0
        self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
        self._connection_healthy = True
        self._device_unreachable = False  # True when device repeatedly fails to connect
        self._failed_commands_window = []  # Track recent failures for health monitoring
        self._reconnect_lock = asyncio.Lock()  # Prevent concurrent reconnection storms
        self._command_lock = asyncio.Lock()  # Serialize all commands — no concurrent TCP connections
        
        # Track when the last command succeeded — used for smarter cooldown after
        # transient failures.  When the device was JUST working, a shorter initial
        # cooldown gives faster recovery (2s instead of 5s).
        self._last_success_time = 0.0
        
        # Persistent socket for send_command_fast — reused across commands.
        # The Cube accepts multiple commands on the same TCP connection in direct
        # FX mode.  Reusing avoids TIME_WAIT socket exhaustion which causes the
        # lamp to reject new connections after rapid-fire pixel art switches.
        self._fast_socket = None  # type: socket.socket | None
        self._fast_socket_time = 0.0  # When the socket was opened (for diagnostics)
        self._last_fast_command = None  # Last command sent via send_command_fast
        self._fx_activated_on_socket = False  # True if activate_fx_mode was sent on current socket
        
        # Flag set by _graceful_reconnect when socket was reset.
        # Checked by light.py after commands to trigger FX mode / brightness restore.
        self._just_reconnected = False
        
        # Total commands successfully sent — diagnostic counter for tracking
        # command volume that may overwhelm the Cube firmware.
        self._total_commands_sent = 0

        self.device_id = None  # Yeelight device ID (hex) — used for discovery suppression
        
        _LOGGER.debug(
            "[INIT] CubeMatrix initialized: ip=%s, port=%s, timeout=%ss, "
            "cooldown=%ss, cooldown_max=%ss, "
            "max_failures=%s, id=%s",
            ip, port, self.device._timeout, self._reconnect_cooldown,
            RECONNECT_COOLDOWN_MAX, MAX_CONSECUTIVE_FAILURES, id(self)
        )

    def fetch_capabilities(self):
        """Fetch device capabilities (blocking network call).
        
        Must be called from an executor or at a point where blocking is acceptable.
        This is separated from __init__ to avoid blocking the HA event loop.
        """
        try:
            properties = self.device.get_capabilities()
            if properties and isinstance(properties, dict):
                self.capabilities = dict(properties)
                self.device_name = properties.get("name", self.device_name)
                self.device_id = properties.get("id")
                self.device_model = properties.get(
                    "model", properties.get("md", self.device_model)
                )
                self.firmware_version = properties.get(
                    "fw_ver", properties.get("fw_version")
                )
            else:
                _LOGGER.debug("get_capabilities returned no data (device may not support it)")
        except Exception as e:
            _LOGGER.debug("Could not retrieve capabilities (expected for some devices): %s", e)

    def get_bulb(self):
        return self.device

    # ── python-yeelight request socket ─────────────────────────────────
    # The library keeps its request socket in the private, name-mangled
    # attribute ``Bulb.__socket`` and has no API to inspect or drop it. All
    # access goes through these two helpers, so a library change only needs
    # fixing here.
    def _library_socket(self):
        return getattr(self.device, "_Bulb__socket", None)

    def _drop_library_socket(self, abortive: bool = False) -> None:
        """Close the library's request socket (RST when ``abortive``) so its
        next command opens a fresh connection."""
        sock = self._library_socket()
        if sock is not None:
            try:
                if abortive:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER)
                sock.close()
            except Exception as exc:
                _LOGGER.debug("[%s] Failed to close library socket: %s", self._ip, exc)
        self.device._Bulb__socket = None

    def close_command_socket(self) -> None:
        """Close the python-yeelight request socket without touching direct FX."""
        self._drop_library_socket()

    # ── Connection state (read and updated by the light entity) ────────
    @property
    def port(self) -> int:
        return self._port

    @property
    def is_unreachable(self) -> bool:
        """True after repeated failed connections, until a command succeeds."""
        return self._device_unreachable

    @property
    def consecutive_failures(self) -> int:
        return self._consecutive_failures

    @property
    def reconnect_cooldown(self) -> float:
        return self._reconnect_cooldown

    @property
    def last_success_time(self) -> float:
        """time.time() of the last successful command, 0 if none yet."""
        return self._last_success_time

    @property
    def last_command_time(self) -> float:
        """time.time() of the last command sent, 0 if none yet."""
        return self._last_command_time

    def record_failure(self) -> None:
        """Count a failed operation (e.g. a hard timeout detected by the caller)."""
        self._consecutive_failures += 1

    def record_success(self) -> None:
        """Clear the failure count after an operation completed."""
        self._consecutive_failures = 0

    def mark_unreachable(self) -> bool:
        """Flag the lamp as unreachable. Returns True if it was reachable."""
        was_reachable = not self._device_unreachable
        self._device_unreachable = True
        return was_reachable

    def mark_recovered(self) -> None:
        """The lamp answers again: drop the persistent socket and reset the
        failure count, backoff and unreachable flag."""
        self.close_fast_socket()
        self._consecutive_failures = 0
        self._device_unreachable = False
        self._connection_healthy = True
        self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
        self._last_reconnect_attempt = 0

    async def probe(self, timeout: float = CONNECT_TIMEOUT) -> bool:
        """Whether the lamp accepts a TCP connection within ``timeout``.
        The probe socket is RST-closed so it leaves no TIME_WAIT behind."""

        def _connect() -> None:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.settimeout(timeout)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER)
                sock.connect((self._ip, self._port))
            finally:
                sock.close()

        try:
            await asyncio.to_thread(_connect)
        except OSError:
            return False
        return True

    async def read_properties(self, properties: list[str]) -> dict[str, object]:
        """Read Yeelight properties and normalize the library response."""
        try:
            result = await self.send_command_with_recovery("get_prop", properties)
        finally:
            self.close_command_socket()
        if not result:
            return {}
        if isinstance(result, dict):
            values = result.get("result")
        else:
            values = result
        if not isinstance(values, list):
            return {}
        return dict(zip(properties, values))

    async def read_effect(self):
        """Return the firmware-native effect payload when supported."""
        try:
            result = await self.send_command_with_recovery("get_fx_effect", [])
        finally:
            self.close_command_socket()
        if isinstance(result, dict):
            return result.get("result")
        return result

    def consume_reconnected_flag(self) -> bool:
        """
        Check and clear the reconnection flag.
        
        Returns True if a reconnection just happened, then clears the flag.
        Called by light.py after successful commands to know when to
        re-send FX mode and brightness.
        """
        if self._just_reconnected:
            self._just_reconnected = False
            _LOGGER.debug("[FLAG] consume_reconnected_flag → True (will restore FX mode + brightness)")
            return True
        return False

    @property
    def summary(self) -> "_LazyText":
        """state_summary() for a log argument: only built when the record is
        actually emitted (debug logging is usually off)."""
        return _LazyText(self.state_summary)

    def state_summary(self) -> str:
        """Return a compact summary of connection state for diagnostics."""
        # Show fast socket status (the persistent socket actually used for commands)
        if self._fast_socket is not None:
            age = time.time() - self._fast_socket_time
            fast_status = f"open({age:.0f}s)"
        else:
            fast_status = "None"
        time_since_attempt = time.time() - self._last_reconnect_attempt if self._last_reconnect_attempt > 0 else -1
        time_since_success = time.time() - self._last_success_time if self._last_success_time > 0 else -1
        return (
            f"ip={self._ip}, fast_sock={fast_status}, failures={self._consecutive_failures}, "
            f"cooldown={self._reconnect_cooldown:.0f}s, unreachable={self._device_unreachable}, "
            f"healthy={self._connection_healthy}, reconnected_flag={self._just_reconnected}, "
            f"time_since_attempt={time_since_attempt:.1f}s, "
            f"time_since_success={time_since_success:.1f}s, "
            f"total_cmds={self._total_commands_sent}"
        )

    async def _check_connection_health(self):
        """Monitor connection health based on error patterns.
        
        Only logs degradation status and resets error counters.
        Does NOT trigger preemptive reconnect — the yeelight library
        self-heals by creating a fresh socket on the next command.
        Triggering reconnects here caused cascading reconnection storms.
        """
        current_time = time.time()
        # Keep only failures from last 60 seconds
        self._failed_commands_window = [t for t in self._failed_commands_window 
                                        if current_time - t < 60]
        
        if len(self._failed_commands_window) > 5:
            _LOGGER.warning("Connection degraded - %s failures in last minute", len(self._failed_commands_window))
            # Just mark unhealthy — the normal command flow will handle reconnection
            # via _graceful_reconnect when socket is None.
            # Do NOT call _graceful_reconnect() here — it causes cascading storms
            # when multiple commands are in-flight.
            self._connection_healthy = False
            
    async def _graceful_reconnect(self):
        """Prepare for reconnection by resetting state and verifying reachability.
        
        The yeelight library handles socket reconnection lazily — when
        __socket is None, the next send_command() creates a fresh TCP
        connection automatically. We don't need to create new Bulb
        instances or send test commands.
        
        This method:
        1. Ensures the old socket is closed and set to None
        2. Probes the device with a quick TCP connect to verify reachability
        3. If the probe fails, marks the device as unreachable immediately
           (avoids the 3s timeout in the subsequent send_command)
        4. Resets health flag so the next command can proceed
        
        Uses a lock to prevent concurrent reconnection storms.
        """
        if self._reconnect_lock.locked():
            _LOGGER.debug("[RECONNECT] Already in progress, waiting... [%s]", self.summary)
            async with self._reconnect_lock:
                return self._connection_healthy
        
        async with self._reconnect_lock:
            # Double-check: maybe connection recovered while we waited for the lock
            if self._library_socket() is not None and self._connection_healthy:
                _LOGGER.debug("[RECONNECT] Connection already recovered, skipping [%s]", self.summary)
                return True

            _LOGGER.warning("[RECONNECT] [%s] Starting socket reset [%s]", self._ip, self.summary)
            self._last_reconnect_attempt = time.time()

            # Close existing sockets (both library and fast socket); abortive
            # close to avoid TIME_WAIT.
            self.close_fast_socket()
            self._drop_library_socket(abortive=True)

            # PROBE: Quick TCP connect test to verify device is actually reachable
            # before claiming "Complete".  Without this, the reconnect always
            # "succeeds" and the subsequent send_command wastes 3s on a connect
            # timeout when the device is genuinely offline.
            if await self.probe(CONNECT_TIMEOUT):
                _LOGGER.debug(
                    "[RECONNECT] [%s] TCP probe succeeded — device is reachable", self._ip
                )
            else:
                _LOGGER.warning(
                    "[RECONNECT] [%s] TCP probe FAILED — "
                    "device is NOT reachable, skipping reconnect",
                    self._ip
                )
                self._device_unreachable = True
                self._connection_healthy = False
                return False
            
            # Probe succeeded — device is reachable
            # Reset health flag but NOT _consecutive_failures!
            # Failures must accumulate across reconnect attempts so the
            # circuit breaker and exponential backoff can actually trigger.
            # _consecutive_failures is only reset on actual command success.
            self._connection_healthy = True
            self._failed_commands_window.clear()
            
            # NOTE: Do NOT invoke reconnection callback here!
            # We are called from send_command_with_recovery which holds _command_lock.
            # The callback would call send_command_with_recovery again → deadlock.
            # Instead, we set a flag and let the caller (light.py) handle it
            # after the lock is released.
            self._just_reconnected = True
            
            _LOGGER.warning("[RECONNECT] [%s] Complete — fresh connection on next command [%s]", self._ip, self.summary)
            return True

    def is_connected(self) -> bool:
        """
        Fast connection check - returns True if commands can be sent.
        
        Returns:
            True if socket is available and we can attempt commands
            False if socket is None and in reconnection cooldown
        """
        if self._library_socket() is None:
            current_time = time.time()
            time_since = current_time - self._last_reconnect_attempt
            if time_since < self._reconnect_cooldown:
                _LOGGER.debug(
                    "[CONNECTED?] [%s] No — socket=None, "
                    "cooldown=%.0fs, "
                    "elapsed=%.1fs, "
                    "remaining=%.1fs, "
                    "failures=%s",
                    self._ip, self._reconnect_cooldown, time_since,
                    self._reconnect_cooldown - time_since, self._consecutive_failures
                )
                return False  # In cooldown, skip command
            
            # Cooldown expired — allow the next command attempt through.
            # Do NOT clear _device_unreachable here — it should only be cleared
            # on actual command success.  Other code (drain logic) relies on this
            # flag to know the device has been failing.  Do NOT touch
            # _consecutive_failures or _reconnect_cooldown either — they only
            # reset on actual command SUCCESS.  This way backoff properly
            # accumulates (2→4→8→15s) and stays at the elevated level until
            # the device actually responds.
            _LOGGER.debug(
                "[CONNECTED?] [%s] Yes — socket=None but cooldown expired "
                "(elapsed=%.1fs > cooldown=%.0fs, "
                "failures=%s, "
                "unreachable=%s)",
                self._ip, time_since, self._reconnect_cooldown,
                self._consecutive_failures, self._device_unreachable
            )
        return True

    async def test_connection(self):
        """Test connection by sending turn_on command.
        
        'closed the connection' from the yeelight library means recv() failed
        after send() succeeded — the command was sent, which counts as connected.
        'socket error' means connect/send failed — the device is unreachable.
        """
        for attempt in range(3):
            try:
                await asyncio.to_thread(self.device.turn_on)
                _LOGGER.debug("Successfully connected to %s!", self.device_name)
                return
            except BulbException as e:
                error_msg = str(e)
                if "closed the connection" in error_msg.lower():
                    # recv() failed after send() succeeded — command was sent
                    _LOGGER.debug("Connected to %s (device closed connection after command — expected)", self.device_name)
                    return
                _LOGGER.warning("Connection attempt %s failed: %s", attempt + 1, e)
                await asyncio.sleep(2)
            except Exception as e:
                _LOGGER.warning("Connection attempt %s failed: %s", attempt + 1, e)
                await asyncio.sleep(2)
        _LOGGER.error("Could not connect to Yeelight Cube Lite after retries.")

    async def draw_matrices(self, rgb_data: str):
        """Send matrix draw command (awaitable, serialized).
        
        This is the preferred method — it waits for the command to complete
        so the caller (display queue) doesn't pile up concurrent commands.
        """
        await self._draw_with_recovery(rgb_data)

    async def _draw_with_recovery(self, rgb_data: str):
        """Internal method to draw with recovery handling.
        
        Lets errors propagate to the caller. The queue processor in light.py
        has its own error handling for BulbException, AttributeError, etc.
        """
        await self.send_command_with_recovery("update_leds", [rgb_data])

    def close_fast_socket(self):
        """Close the persistent fast socket if open.
        
        Uses SO_LINGER with zero timeout for an abortive close (RST).
        This avoids TIME_WAIT state which would prevent opening new
        connections when the lamp's TCP stack fills up.
        """
        if self._fast_socket is not None:
            try:
                # Abortive close: send RST instead of FIN → avoids TIME_WAIT
                self._fast_socket.setsockopt(
                    socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER
                )
                self._fast_socket.close()
            except Exception as exc:
                _LOGGER.debug("[%s] Failed to close fast socket: %s", self._ip, exc)
            self._fast_socket = None
            self._fast_socket_time = 0.0
            self._fx_activated_on_socket = False

    async def send_raw_command(
        self,
        command: str,
        params: list = None,
        timeout: float = 1.5,
        abortive_close: bool = True,
    ):
        """Send a single command on a FRESH TCP connection (bypasses send_command_fast).
        
        Opens a new socket, sends the command, and normally closes with RST.
        One-shot mode changes can request a graceful FIN so the device has a
        chance to consume the command before the connection is discarded.
        No rate limiting, no persistent socket, no recovery logic.
        Used by force_refresh to mirror the working yeelight_matrix library
        approach: fresh TCP per command.
        
        Default timeout is 1.5s — LAN connects take <10ms, so 1.5s is
        generous while avoiding 3s+ waits on unreachable devices.
        """
        if params is None:
            params = []
        command_dict = {"id": 1, "method": command, "params": params}
        request = (json.dumps(command_dict, separators=(",", ":")) + "\r\n").encode("utf8")

        def _send():
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            try:
                sock.connect((self._ip, self._port))
                sock.sendall(request)
                _LOGGER.debug(
                    "[RAW] [%s] Sent %s on fresh TCP "
                    "(%s bytes)",
                    self._ip, command, len(request)
                )
            finally:
                try:
                    if abortive_close:
                        sock.setsockopt(
                            socket.SOL_SOCKET,
                            socket.SO_LINGER,
                            _RST_LINGER,
                        )
                    sock.close()
                except Exception as exc:
                    _LOGGER.debug("[%s] Failed to close raw command socket: %s", self._ip, exc)

        await asyncio.to_thread(_send)

    async def query_raw_command(
        self, command: str, params: list = None, timeout: float = 2.0
    ) -> str:
        """DEBUG: send a command on a fresh TCP connection and RETURN the reply.

        Unlike send_raw_command (send-only), this reads whatever the lamp
        sends back and returns it as a decoded string. Used by the FX
        decoder/capture card to probe responses (e.g. get_prop) and to see
        how the device replies to experimental commands. Not for hot paths.

        IMPORTANT: While a firmware-native renderer (clock/effect) is active,
        the Cube can reset its mode when a SECOND TCP connection is opened.
        We therefore close the persistent fast socket before probing so the
        lamp only sees one connection at a time.
        """
        if params is None:
            params = []
        command_dict = {"id": 1, "method": command, "params": params}
        request = (
            json.dumps(command_dict, separators=(",", ":")) + "\r\n"
        ).encode("utf8")

        # Close the persistent fast socket first. The Cube's firmware is
        # sensitive to concurrent TCP connections while native renderers are
        # running; leaving it open causes the lamp to drop the active effect
        # when the probe connection arrives.
        self.close_fast_socket()
        # Give the Cube TCP stack a moment to clean up the closed socket.
        await asyncio.sleep(0.1)

        def _send() -> str:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            reply = ""
            try:
                sock.connect((self._ip, self._port))
                sock.sendall(request)
                chunks = []
                try:
                    # Read whatever arrives within the timeout window. The lamp
                    # may push notify messages too; grab a couple of reads.
                    for _ in range(4):
                        data = sock.recv(4096)
                        if not data:
                            break
                        chunks.append(data)
                        if b"\r\n" in data:
                            break
                except socket.timeout:
                    pass
                reply = b"".join(chunks).decode("utf8", "replace").strip()
                _LOGGER.debug(
                    "[QUERY] [%s] %s -> %r", self._ip, command, reply
                )
            finally:
                try:
                    sock.setsockopt(
                        socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER
                    )
                    sock.close()
                except Exception as exc:
                    _LOGGER.debug("[%s] Failed to close query socket: %s", self._ip, exc)
            return reply

        return await asyncio.to_thread(_send)

    async def send_command_fast(self, command: str, params: list = None):
        """
        Send command to Yeelight Cube Lite using a PERSISTENT socket (send-only).
        
        The Cube accepts multiple commands on the same TCP connection in direct
        FX mode.  Reusing a single socket avoids TIME_WAIT exhaustion: when we
        opened a new socket for every command, rapid pixel art switches (~5 in
        5 seconds) caused the lamp to reject connections as its TCP stack filled
        up with TIME_WAIT entries.
        
        Socket lifecycle:
          - Opened lazily on first command
          - Reused for subsequent commands (just sendall on existing socket)
          - Peer-close detection: before reuse, checks if the Cube has closed
            its end (select() with 0 timeout + recv peek).  The Cube's idle
            timeout resets on each received command, so the socket stays alive
            as long as commands flow.  When idle long enough, the Cube sends
            FIN which _check_peer_closed detects reliably on LAN.
          - Closed + reopened if send fails (broken pipe / connection reset),
            with 100ms settle for Cube TCP stack cleanup
          - NO proactive age-based close: previous versions RST-closed sockets
            after 8-28s, but this killed working sockets (the Cube's idle
            timeout counts from last received data, not connection open) and
            the immediate reconnect after RST often timed out.
          - Abortive close (SO_LINGER RST) — avoids TIME_WAIT socket exhaustion
        
        Uses FAST_SEQUENTIAL_INTERVAL (20ms) instead of SAFE_SUSTAINED_INTERVAL
        (100ms) for minimal delay between commands within a burst.
        
        Args:
            command: Yeelight command name (e.g., 'set_bright', 'update_leds')
            params: Command parameters list
            
        Returns:
            True if send() succeeded, False otherwise
        """
        cmd_id = int(time.time() * 1000) % 100000
        
        async with self._command_lock:
            # Fast rate limiting — just 20ms between burst commands
            current_time = time.time()
            time_since_last = current_time - self._last_command_time
            if time_since_last < FAST_SEQUENTIAL_INTERVAL:
                wait_time = FAST_SEQUENTIAL_INTERVAL - time_since_last
                await asyncio.sleep(wait_time)
            
            if params is None:
                params = []
            
            # Build the JSON command exactly like the yeelight library does
            command_dict = {"id": 1, "method": command, "params": params}
            request = (json.dumps(command_dict, separators=(",", ":")) + "\r\n").encode("utf8")
            
            def _check_peer_closed(sock):
                """Check if the remote end has closed the connection.
                Also drains any pending response data from the Cube.
                
                Since send_command_fast is fire-and-forget (no recv), the Cube's
                responses accumulate in the recv buffer.  If the Cube sent error
                responses (e.g., error 6 = 'not in FX mode'), we need to:
                  1. Drain them so the buffer doesn't fill up (causing RST)
                  2. Detect errors so callers know FX mode was lost
                
                IMPORTANT: Drains ALL available data in a loop (not just one recv).
                Previously a single recv(4096) could return buffered "ok" responses
                while hiding an EOF or error that was queued RIGHT BEHIND them.
                The loop ensures we see the EOF/error on the same check.
                
                Returns True if peer has closed OR error responses detected.
                """
                all_data = b""
                try:
                    for _ in range(20):  # Safety bound — max 20 iterations
                        readable, _, _ = select.select([sock], [], [], 0)
                        if not readable:
                            break  # No more data available
                        data = sock.recv(4096)
                        if not data:
                            # EOF — peer closed the connection
                            if all_data:
                                _LOGGER.debug(
                                    "[FAST] Drained %s bytes then got EOF "
                                    "(peer closed): %s",
                                    len(all_data), all_data[:200]
                                )
                            return True
                        all_data += data
                    
                    if all_data:
                        if b'"error"' in all_data:
                            _LOGGER.warning(
                                "[FAST] [%s] Drained ERROR response from Cube "
                                "(%s bytes, last_cmd=%s): "
                                "%s",
                                self._ip, len(all_data), self._last_fast_command,
                                all_data[:300]
                            )
                            return True  # Signal: FX mode likely lost
                        else:
                            # Log drained OK responses at DEBUG level for brightness diagnostics
                            _LOGGER.debug(
                                "[BRIGHTNESS_DIAG] [%s] Drained response "
                                "(%s bytes, last_cmd=%s, "
                                "fx_on_sock=%s): "
                                "%s",
                                self._ip, len(all_data), self._last_fast_command,
                                self._fx_activated_on_socket, all_data[:300]
                            )
                except Exception as exc:
                    _LOGGER.debug(
                        "[%s] _check_peer_closed caught exception (%s) — treating socket as dead",
                        self._ip, exc
                    )
                    return True  # Error — socket is dead
                return False
            
            def _send_on_existing(sock):
                """Blocking: check peer is alive, then send.  Raises on failure."""
                if _check_peer_closed(sock):
                    raise ConnectionResetError("Peer closed the connection")
                sock.sendall(request)
            
            def _open_and_send():
                """Blocking: open a new socket, send, return the socket."""
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                # Use longer timeout when recovering from failure — lamp may be
                # slow to accept TCP after reboot.  Normal ops stay at 0.5s.
                # Use longer timeout after ANY failure — not just when device is
                # marked unreachable.  The Cube sometimes needs 1-3s to accept
                # a new TCP connection after a failed attempt (its TCP stack is
                # still cleaning up).  0.5s is fine for normal operation but
                # causes cascading failures when recovering.
                connect_timeout = RECOVERY_CONNECT_TIMEOUT if (self._device_unreachable or self._consecutive_failures > 0) else CONNECT_TIMEOUT
                sock.settimeout(connect_timeout)  # 0.5s normal, 3s recovery
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                # SO_LINGER with 0 timeout: on close(), send RST instead of
                # going through FIN → TIME_WAIT.  Prevents TIME_WAIT exhaustion
                # on the Cube when we do need to open a fresh socket.
                sock.setsockopt(
                    socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER
                )
                sock.connect((self._ip, self._port))
                sock.sendall(request)
                return sock
            
            try:
                # activate_fx_mode REQUIRES a fresh TCP connection IF the
                # socket is already in FX data mode — the Cube silently
                # ignores FX activation on such a socket (JSON accepted at
                # TCP level but zero effect on firmware state).
                #
                # However, if the socket was just opened (reconnect / initial
                # connect) and has NOT had FX activated on it yet, we can
                # reuse it directly — no costly close→300ms→reopen needed.
                if command == 'activate_fx_mode' and self._fast_socket is not None:
                    if self._fx_activated_on_socket:
                        # Socket is in FX data mode — must close and reopen
                        age = time.time() - self._fast_socket_time
                        _LOGGER.debug(
                            "[FAST #%s] Closing FX-active socket before activate_fx_mode "
                            "(socket already in FX data mode, socket_age=%.0fs, "
                            "total_cmds=%s)",
                            cmd_id, age, self._total_commands_sent
                        )
                        self.close_fast_socket()
                        # The Cube needs time to process the RST (abortive close)
                        # before accepting a new TCP connection.  300ms gives
                        # reliable headroom on LAN.
                        await asyncio.sleep(0.3)
                    else:
                        # Socket exists but NOT in FX data mode — try to reuse
                        # it directly for FX activation (avoids costly close→reconnect).
                        _LOGGER.debug(
                            "[FAST #%s] Reusing existing socket for activate_fx_mode "
                            "(fx_on_sock=False, socket_age="
                            "%.1fs)",
                            cmd_id, time.time() - self._fast_socket_time
                        )
                
                if self._fast_socket is not None:
                    # Try sending on the existing persistent socket
                    try:
                        await asyncio.to_thread(_send_on_existing, self._fast_socket)
                    except (socket.error, socket.timeout, OSError, BrokenPipeError, ConnectionResetError) as sock_err:
                        # Socket is dead — close it and open a fresh one.
                        # Brief delay before reconnecting: the Cube's embedded TCP
                        # stack needs time to clean up the closed socket.  Without
                        # this, the immediate reconnect hits a Cube that's still
                        # processing the old connection's close and times out.
                        connect_timeout = RECOVERY_CONNECT_TIMEOUT if (self._device_unreachable or self._consecutive_failures > 0) else CONNECT_TIMEOUT
                        _LOGGER.debug(
                            "[FAST #%s] Existing socket broken (%s: %s) "
                            "— waiting 100ms then reconnecting "
                            "(connect_timeout=%ss, total_cmds=%s)",
                            cmd_id, type(sock_err).__name__, sock_err, connect_timeout,
                            self._total_commands_sent
                        )
                        self.close_fast_socket()
                        await asyncio.sleep(0.1)  # Brief settle — Cube TCP stack cleanup
                        new_sock = await asyncio.to_thread(_open_and_send)
                        self._fast_socket = new_sock
                        self._fast_socket_time = time.time()
                        # Signal that a new TCP connection was opened — but ONLY
                        # if the close was unexpected.  activate_fx_mode ALWAYS
                        # causes the Cube to close TCP; that's normal and the
                        # caller (apply) already knows it just sent FX mode.
                        # Setting the flag after an expected close would make
                        # the next apply() re-send activate_fx_mode in a loop.
                        if self._last_fast_command != 'activate_fx_mode':
                            self._just_reconnected = True
                        else:
                            _LOGGER.debug(
                                "[FAST #%s] Socket recovery after activate_fx_mode — "
                                "expected Cube TCP close, NOT setting reconnected flag",
                                cmd_id
                            )
                else:
                    # No socket yet — open a fresh one and keep it
                    connect_timeout = RECOVERY_CONNECT_TIMEOUT if (self._device_unreachable or self._consecutive_failures > 0) else CONNECT_TIMEOUT
                    _LOGGER.debug(
                        "[FAST #%s] Opening new socket for %s "
                        "(connect_timeout=%ss, failures=%s, "
                        "total_cmds=%s)",
                        cmd_id, command, connect_timeout, self._consecutive_failures,
                        self._total_commands_sent
                    )
                    new_sock = await asyncio.to_thread(_open_and_send)
                    self._fast_socket = new_sock
                    self._fast_socket_time = time.time()
                
                self._last_command_time = time.time()
                self._last_fast_command = command  # Track for expected-close detection
                if command == 'activate_fx_mode':
                    self._fx_activated_on_socket = True
                
                # Reset failure tracking — device is alive
                prev_failures = self._consecutive_failures
                self._consecutive_failures = 0
                self._last_success_time = time.time()
                if self._device_unreachable:
                    _LOGGER.debug(
                        "[FAST #%s] ✓ RECONNECTED (%s) after %s failures!", cmd_id, command, prev_failures
                    )
                    self._device_unreachable = False
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                elif self._reconnect_cooldown != RECONNECT_COOLDOWN_INITIAL:
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                
                self._connection_healthy = True
                self._last_reconnect_attempt = 0
                
                # Invalidate the library's socket — we bypassed it.
                self._drop_library_socket()
                
                self._total_commands_sent += 1
                _LOGGER.debug(
                    "[FAST #%s] ✓ %s sent (total=%s)", cmd_id, command, self._total_commands_sent
                )
                return True
                
            except (socket.error, socket.timeout, OSError, ConnectionRefusedError, TimeoutError) as e:
                # Connection failed entirely — close the socket so next attempt opens fresh
                self.close_fast_socket()
                
                self._consecutive_failures += 1
                self._failed_commands_window.append(time.time())
                self._last_reconnect_attempt = time.time()
                connect_timeout_used = RECOVERY_CONNECT_TIMEOUT if (self._device_unreachable or self._consecutive_failures > 1) else CONNECT_TIMEOUT
                _LOGGER.warning(
                    "[FAST #%s] ✗ %s failed: %s: %s "
                    "(connect_timeout=%ss, failures=%s, "
                    "total_cmds_sent=%s)",
                    cmd_id, command, type(e).__name__, e, connect_timeout_used,
                    self._consecutive_failures, self._total_commands_sent
                )
                
                # Smarter initial cooldown: if the device was working recently
                # (within 60s), this is likely a transient glitch — use a shorter
                # initial cooldown (2s) for faster recovery.  For devices that
                # have been down a while, keep the normal 5s initial cooldown.
                time_since_success = time.time() - self._last_success_time if self._last_success_time > 0 else 999
                if self._consecutive_failures == 1 and time_since_success < 60:
                    # First failure after recent success → transient-friendly cooldown
                    self._reconnect_cooldown = 2.0
                    _LOGGER.debug(
                        "[FAST #%s] Using short cooldown (2s) — device was online "
                        "%.0fs ago",
                        cmd_id, time_since_success
                    )
                
                # Exponential backoff
                if self._consecutive_failures >= MAX_CONSECUTIVE_FAILURES and \
                   self._consecutive_failures % MAX_CONSECUTIVE_FAILURES == 0:
                    old_cooldown = self._reconnect_cooldown
                    self._reconnect_cooldown = min(
                        self._reconnect_cooldown * 2,
                        RECONNECT_COOLDOWN_MAX
                    )
                    self._device_unreachable = True
                    self._consecutive_failures = 1

                raise CubeConnectionError(
                    f"Could not send {command}: {type(e).__name__}: {e}"
                ) from e
            except Exception as e:
                self.close_fast_socket()
                _LOGGER.error("[FAST #%s] ✗ Unexpected: %s: %s", cmd_id, type(e).__name__, e)
                raise

    async def draw_matrices_fast(self, rgb_data: str):
        """Send pixel data using fire-and-forget (no recv).
        
        Much faster than draw_matrices() because it doesn't wait for the
        Cube's response (which is always "Bulb closed the connection" anyway).
        """
        # Build JSON to log exact byte count sent to Cube
        cmd_dict = {"id": 1, "method": "update_leds", "params": [rgb_data]}
        request_bytes = len((json.dumps(cmd_dict, separators=(',', ':')) + '\r\n').encode('utf8'))
        _LOGGER.debug(
            "[DRAW_FAST] [%s] update_leds: "
            "rgb_data=%s chars, json=%s bytes",
            self._ip, len(rgb_data), request_bytes
        )
        await self.send_command_fast("update_leds", [rgb_data])

    async def send_command_with_recovery(self, command: str, params: list = None):
        """
        Send command to Yeelight lamp with automatic error recovery.
        
        All commands are serialized through _command_lock to prevent concurrent
        TCP connections which overwhelm the Yeelight Cube Lite (error 6).
        
        Features:
        - Command serialization: Only one TCP command at a time
        - Rate limiting: Enforces minimum interval between commands
        - Circuit breaker: Backs off after consecutive failures
        - Quota handling: Detects and backs off from rate limit errors
        - Auto-reconnection: Resets socket on errors, library reconnects lazily
        
        Args:
            command: Yeelight command name (e.g., 'set_bright', 'update_leds')
            params: Command parameters list
            
        Returns:
            Command result dict (or {'result': 'ok'} for closed connections)
        """
        cmd_id = int(time.time() * 1000) % 100000
        _LOGGER.debug("[COMMAND #%s] Queued: %s [%s]", cmd_id, command, self.summary)
        
        # Serialize all commands through the lock — the Yeelight Cube Lite cannot
        # handle concurrent TCP connections and returns error 6 ("illegal request")
        # or drops connections when overwhelmed.
        async with self._command_lock:
            # Check connection health before sending
            if not self._connection_healthy:
                await self._check_connection_health()
            
            # Rate limiting: ensure minimum interval between commands
            current_time = time.time()
            time_since_last = current_time - self._last_command_time
            if time_since_last < self._min_command_interval:
                wait_time = self._min_command_interval - time_since_last
                _LOGGER.debug("[COMMAND #%s] Rate limiting: waiting %.3fs", cmd_id, wait_time)
                await asyncio.sleep(wait_time)
            
            try:
                # Check if socket is None — need to reconnect first
                if self._library_socket() is None:
                    current_time = time.time()
                    time_since_last = current_time - self._last_reconnect_attempt
                    
                    if time_since_last < self._reconnect_cooldown:
                        # Still in cooldown — don't attempt, just skip.
                        # DON'T increment _consecutive_failures for this — it's not
                        # a real connection attempt, just a "too soon" skip.
                        _LOGGER.debug(
                            "[COMMAND #%s] SKIP %s: cooldown active "
                            "(%.1fs remaining, "
                            "failures=%s)",
                            cmd_id, command,
                            self._reconnect_cooldown - time_since_last,
                            self._consecutive_failures
                        )
                        return None  # Skip silently — not a failure
                    
                    # Distinguish between error recovery and normal "closed" flow.
                    # The Cube closes TCP after EVERY command in direct mode — that's
                    # normal. In that case _consecutive_failures==0 and the library
                    # just needs to open a fresh socket (it does this automatically).
                    # Only do the full _graceful_reconnect (with its 0.5s wait) when
                    # there were actual errors.
                    if self._consecutive_failures > 0 or not self._connection_healthy:
                        _LOGGER.warning(
                            "[COMMAND #%s] [%s] Socket=None, cooldown expired — "
                            "attempting reconnect (was %.1fs ago, "
                            "cooldown=%.0fs, "
                            "failures=%s)",
                            cmd_id, self._ip, time_since_last,
                            self._reconnect_cooldown, self._consecutive_failures
                        )
                        reconnect_success = await self._graceful_reconnect()
                        if not reconnect_success:
                            # TCP probe failed — device is genuinely unreachable.
                            # Raise as a socket error so the queue processor handles
                            # it like any other connection failure (retry scheduling,
                            # backoff, etc.) instead of silently returning None which
                            # the queue treats as "success" and resets the retry counter.
                            _LOGGER.warning(
                                "[COMMAND #%s] [%s] Reconnect failed — "
                                "device unreachable (TCP probe failed)",
                                cmd_id, self._ip
                            )
                            # Don't increment _consecutive_failures here — the socket
                            # error handler below will do that when it catches this.
                            raise CubeConnectionError(
                                "Lamp unreachable (TCP probe failed)"
                            )
                    else:
                        # Normal flow: socket=None after a successful "closed" response.
                        # The library creates a fresh socket on send_command() — no
                        # wait needed, no reconnect flag (FX mode is still active).
                        _LOGGER.debug(
                            "[COMMAND #%s] Socket=None (normal close) — "
                            "library will create fresh socket for %s",
                            cmd_id, command
                        )
                
                if params is None:
                    params = []
                
                _LOGGER.debug("[COMMAND #%s] Executing: %s with %s params", cmd_id, command, len(params))
                result = await asyncio.to_thread(self.device.send_command, command, params)
                self._last_command_time = time.time()
                
                # Connection succeeded — reset exponential backoff
                prev_failures = self._consecutive_failures
                prev_cooldown = self._reconnect_cooldown
                self._consecutive_failures = 0
                if self._device_unreachable:
                    _LOGGER.debug(
                        "[COMMAND #%s] ✓ RECONNECTED after %s failures! "
                        "Resetting backoff %.0fs → %ss",
                        cmd_id, prev_failures, prev_cooldown,
                        RECONNECT_COOLDOWN_INITIAL
                    )
                    self._device_unreachable = False
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                elif self._reconnect_cooldown != RECONNECT_COOLDOWN_INITIAL:
                    _LOGGER.debug(
                        "[COMMAND #%s] ✓ SUCCESS — resetting cooldown %.0fs → %ss", cmd_id, prev_cooldown, RECONNECT_COOLDOWN_INITIAL
                    )
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                else:
                    _LOGGER.debug("[COMMAND #%s] ✓ SUCCESS (%s)", cmd_id, command)
                
                return result
                
            except BulbException as e:
                error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
                error_code = error_dict.get('code', 0)
                error_message = error_dict.get('message', str(e))
                
                if error_code == -1:  # Quota exceeded
                    self._consecutive_failures += 1
                    self._failed_commands_window.append(time.time())
                    backoff_time = self._reconnect_cooldown * QUOTA_BACKOFF_MULTIPLIER
                    _LOGGER.warning("[COMMAND #%s] QUOTA EXCEEDED - backing off %.1fs", cmd_id, backoff_time)
                    await asyncio.sleep(backoff_time)
                    raise e
                    
                elif "closed the connection" in error_message.lower():
                    # "Bulb closed the connection" = recv() failed AFTER send() succeeded.
                    # The command WAS sent and processed, the Cube just doesn't keep
                    # the TCP connection open. This is EXPECTED and counts as success.
                    prev_failures = self._consecutive_failures
                    prev_cooldown = self._reconnect_cooldown
                    self._last_command_time = time.time()
                    self._consecutive_failures = 0
                    # Reset backoff — device is alive
                    if self._device_unreachable:
                        _LOGGER.debug(
                            "[COMMAND #%s] ✓ RECONNECTED (closed conn) after %s failures! "
                            "Resetting backoff %.0fs → %ss",
                            cmd_id, prev_failures, prev_cooldown,
                            RECONNECT_COOLDOWN_INITIAL
                        )
                        self._device_unreachable = False
                    elif prev_failures > 0:
                        _LOGGER.debug(
                            "[COMMAND #%s] ✓ OK (closed conn, %s was sent) — "
                            "cleared %s failure(s)",
                            cmd_id, command, prev_failures
                        )
                    else:
                        _LOGGER.debug("[COMMAND #%s] ✓ OK (closed conn, %s was sent)", cmd_id, command)
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                    # CRITICAL: Reset _last_reconnect_attempt so subsequent commands
                    # in the same apply() call aren't blocked by the cooldown.
                    # The Cube closes TCP after EVERY command in direct mode — this is
                    # normal behavior, not an error. Without this reset, set_bright and
                    # update_leds would be SKIPPED because they'd see socket=None +
                    # _last_reconnect_attempt only 0.5s ago < 2s cooldown.
                    self._last_reconnect_attempt = 0
                    self._drop_library_socket()
                    return {"result": "ok"}
                    
                elif isinstance(e, CubeConnectionError) or "socket error" in error_message.lower():
                    # Our failed reconnect probe, or the library's "A socket error
                    # occurred when sending the command" = connect() or send()
                    # failed. The command was NOT sent. The library already set
                    # __socket = None, so the next command will retry with a fresh socket.
                    # The library only reports this as message text; it becomes a
                    # CubeConnectionError here so callers can handle it by type.
                    if not isinstance(e, CubeConnectionError):
                        e = CubeConnectionError(error_message)
                    self._consecutive_failures += 1
                    self._failed_commands_window.append(time.time())
                    self._last_reconnect_attempt = time.time()  # Start cooldown from NOW
                    
                    # Exponential backoff: double cooldown every MAX_CONSECUTIVE_FAILURES
                    if self._consecutive_failures >= MAX_CONSECUTIVE_FAILURES and \
                       self._consecutive_failures % MAX_CONSECUTIVE_FAILURES == 0:
                        old_cooldown = self._reconnect_cooldown
                        self._reconnect_cooldown = min(
                            self._reconnect_cooldown * 2,
                            RECONNECT_COOLDOWN_MAX
                        )
                        self._device_unreachable = True
                        if self._reconnect_cooldown != old_cooldown:
                            _LOGGER.warning(
                                "[COMMAND #%s] ✗ SOCKET ERROR (%s) [%s] — "
                                "backoff increased: %.0fs → %.0fs "
                                "(failures=%s, unreachable=True)",
                                cmd_id, command, self._ip, old_cooldown,
                                self._reconnect_cooldown, self._consecutive_failures
                            )
                        else:
                            _LOGGER.warning(
                                "[COMMAND #%s] ✗ SOCKET ERROR (%s) [%s] — "
                                "backoff CAPPED at %.0fs "
                                "(failures=%s, unreachable=True)",
                                cmd_id, command, self._ip, self._reconnect_cooldown,
                                self._consecutive_failures
                            )
                        # Reset counter to 1 so the next backoff check only triggers
                        # after MAX_CONSECUTIVE_FAILURES more failures (not immediately).
                        # This keeps logs clean: at the 15s tier we get 4 normal failures
                        # then 1 "CAPPED" instead of "CAPPED" on every attempt.
                        self._consecutive_failures = 1
                    else:
                        next_escalation = (
                            (self._consecutive_failures // MAX_CONSECUTIVE_FAILURES + 1)
                            * MAX_CONSECUTIVE_FAILURES
                        )
                        _LOGGER.warning(
                            "[COMMAND #%s] ✗ SOCKET ERROR (%s) [%s] — "
                            "failure %s/%s "
                            "(cooldown=%.0fs, "
                            "unreachable=%s)",
                            cmd_id, command, self._ip, self._consecutive_failures,
                            next_escalation, self._reconnect_cooldown,
                            self._device_unreachable
                        )
                    raise e
                    
                elif error_code == 6:  # Illegal request — device is busy/overwhelmed
                    self._consecutive_failures += 1
                    self._failed_commands_window.append(time.time())
                    _LOGGER.warning(
                        "[COMMAND #%s] ✗ ILLEGAL REQUEST (%s) — "
                        "error code 6, backing off %ss "
                        "[%s]",
                        cmd_id, command, RECONNECT_COOLDOWN_INITIAL, self.summary
                    )
                    await asyncio.sleep(RECONNECT_COOLDOWN_INITIAL)
                    raise e
                    
                else:
                    self._consecutive_failures += 1
                    self._failed_commands_window.append(time.time())
                    _LOGGER.warning(
                        "[COMMAND #%s] ✗ BULB ERROR (%s): code=%s, "
                        "msg='%s' [%s]",
                        cmd_id, command, error_code, error_message, self.summary
                    )
                    raise e
                    
            except AttributeError as e:
                error_msg = str(e)
                self._consecutive_failures += 1
                self._failed_commands_window.append(time.time())
                if "'NoneType' object has no attribute" in error_msg:
                    # The library's socket vanished mid-command.
                    _LOGGER.debug(
                        "[COMMAND #%s] ✗ SOCKET GONE (%s) — "
                        "NoneType AttributeError [%s]",
                        cmd_id, command, self.summary
                    )
                    await asyncio.sleep(SOCKET_ERROR_WAIT)
                    raise CubeConnectionError("Connection lost") from e
                else:
                    _LOGGER.error(
                        "[COMMAND #%s] ✗ ATTR ERROR (%s): %s [%s]", cmd_id, command, e, self.summary
                    )
                raise e
                
            except Exception as e:
                error_msg = str(e)
                self._consecutive_failures += 1
                self._failed_commands_window.append(time.time())
                _LOGGER.error(
                    "[COMMAND #%s] ✗ UNEXPECTED (%s): %s: %s "
                    "[%s]",
                    cmd_id, command, type(e).__name__, e, self.summary
                )
                raise e


    @staticmethod
    def encode_hex_color(hex_color: str) -> str:
        hex_color = hex_color.lstrip("#")
        rgb = tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
        rgb_bytes = bytes(rgb)
        return base64.b64encode(rgb_bytes).decode("ascii")
