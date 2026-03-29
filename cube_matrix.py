import logging
import asyncio
import base64
import json
import socket
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



class CubeMatrix:
    """Handles communication with the Yeelight Cube device."""
    def __init__(self, ip: str, port: int):
        _LOGGER.info(f"Connecting to Yeelight Cube at {ip}:{port}")
        self.device = Bulb(ip, port)
        self._ip = ip
        self._port = port
        self.device_name = "Yeelight Cube"
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

        self._failed_commands_window = []  # Track recent failures for health monitoring

        try:
            properties = self.device.get_capabilities()
            if properties and isinstance(properties, dict):
                self.device_name = properties.get("name", self.device_name)
            else:
                _LOGGER.debug("get_capabilities returned no data (device may not support it)")
        except Exception as e:
            _LOGGER.debug(f"Could not retrieve capabilities (expected for some devices): {e}")
        
        _LOGGER.info(
            f"[INIT] CubeMatrix initialized: ip={ip}, port={port}, timeout={self.device._timeout}s, "
            f"cooldown={self._reconnect_cooldown}s, cooldown_max={RECONNECT_COOLDOWN_MAX}s, "
            f"max_failures={MAX_CONSECUTIVE_FAILURES}, id={id(self)}"
        )

    def get_bulb(self):
        return self.device

    def consume_reconnected_flag(self) -> bool:
        """
        Check and clear the reconnection flag.
        
        Returns True if a reconnection just happened, then clears the flag.
        Called by light.py after successful commands to know when to
        re-send FX mode and brightness.
        """
        if self._just_reconnected:
            self._just_reconnected = False
            _LOGGER.info("[FLAG] consume_reconnected_flag → True (will restore FX mode + brightness)")
            return True
        return False

    def _state_summary(self) -> str:
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
            _LOGGER.warning(f"Connection degraded - {len(self._failed_commands_window)} failures in last minute")
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
            _LOGGER.debug(f"[RECONNECT] Already in progress, waiting... [{self._state_summary()}]")
            async with self._reconnect_lock:
                return self._connection_healthy
        
        async with self._reconnect_lock:
            # Double-check: maybe connection recovered while we waited for the lock
            if self.device._Bulb__socket is not None and self._connection_healthy:
                _LOGGER.debug(f"[RECONNECT] Connection already recovered, skipping [{self._state_summary()}]")
                return True
            
            _LOGGER.warning(f"[RECONNECT] [{self._ip}] Starting socket reset [{self._state_summary()}]")
            self._last_reconnect_attempt = time.time()
            
            # Close existing sockets cleanly (both library and fast socket)
            self._close_fast_socket()
            try:
                if self.device._Bulb__socket is not None:
                    # Abortive close to avoid TIME_WAIT
                    import struct
                    try:
                        self.device._Bulb__socket.setsockopt(
                            socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0)
                        )
                    except Exception:
                        pass
                    self.device._Bulb__socket.close()
            except Exception:
                pass
            self.device._Bulb__socket = None
            
            # PROBE: Quick TCP connect test to verify device is actually reachable
            # before claiming "Complete".  Without this, the reconnect always
            # "succeeds" and the subsequent send_command wastes 3s on a connect
            # timeout when the device is genuinely offline.
            import socket
            import struct as _struct
            probe_timeout = CONNECT_TIMEOUT  # Same timeout as normal commands
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(probe_timeout)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, _struct.pack('ii', 1, 0))
                await asyncio.to_thread(sock.connect, (self._ip, self._port))
                sock.close()
                _LOGGER.info(
                    f"[RECONNECT] [{self._ip}] TCP probe succeeded — device is reachable"
                )
            except (socket.timeout, OSError, ConnectionRefusedError) as e:
                _LOGGER.warning(
                    f"[RECONNECT] [{self._ip}] TCP probe FAILED ({type(e).__name__}) — "
                    f"device is NOT reachable, skipping reconnect"
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
            
            _LOGGER.warning(f"[RECONNECT] [{self._ip}] Complete — fresh connection on next command [{self._state_summary()}]")
            return True

    def is_connected(self) -> bool:
        """
        Fast connection check - returns True if commands can be sent.
        
        Returns:
            True if socket is available and we can attempt commands
            False if socket is None and in reconnection cooldown
        """
        if self.device._Bulb__socket is None:
            current_time = time.time()
            time_since = current_time - self._last_reconnect_attempt
            if time_since < self._reconnect_cooldown:
                _LOGGER.debug(
                    f"[CONNECTED?] [{self._ip}] No — socket=None, "
                    f"cooldown={self._reconnect_cooldown:.0f}s, "
                    f"elapsed={time_since:.1f}s, "
                    f"remaining={self._reconnect_cooldown - time_since:.1f}s, "
                    f"failures={self._consecutive_failures}"
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
                f"[CONNECTED?] [{self._ip}] Yes — socket=None but cooldown expired "
                f"(elapsed={time_since:.1f}s > cooldown={self._reconnect_cooldown:.0f}s, "
                f"failures={self._consecutive_failures}, "
                f"unreachable={self._device_unreachable})"
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
                _LOGGER.info(f"Successfully connected to {self.device_name}!")
                return
            except BulbException as e:
                error_msg = str(e)
                if "closed the connection" in error_msg.lower():
                    # recv() failed after send() succeeded — command was sent
                    _LOGGER.info(f"Connected to {self.device_name} (device closed connection after command — expected)")
                    return
                _LOGGER.warning(f"Connection attempt {attempt + 1} failed: {e}")
                await asyncio.sleep(2)
            except Exception as e:
                _LOGGER.warning(f"Connection attempt {attempt + 1} failed: {e}")
                await asyncio.sleep(2)
        _LOGGER.error(f"Could not connect to Yeelight Cube after retries.")

    def draw_matrices_async(self, rgb_data: str):
        """Queue matrix draw operation (fire-and-forget, legacy).
        
        WARNING: This creates an untracked asyncio task. Prefer draw_matrices()
        which is awaitable and serialized through the command lock.
        """
        _LOGGER.debug(f"Queueing matrix draw operation (fire-and-forget)")
        asyncio.create_task(self._draw_with_recovery_silent(rgb_data))

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

    async def _draw_with_recovery_silent(self, rgb_data: str):
        """Fire-and-forget variant that catches and logs errors silently."""
        try:
            await self.send_command_with_recovery("update_leds", [rgb_data])
        except Exception as e:
            error_msg = str(e)
            error_type = type(e).__name__
            is_expected = (
                "closed" in error_msg.lower() or 
                "connection" in error_msg.lower() or
                "socket" in error_msg.lower() or
                (error_type == "AttributeError" and "NoneType" in error_msg)
            )
            if is_expected:
                _LOGGER.debug(f"Draw command failed with expected error ({error_type}): {error_msg}")
            else:
                _LOGGER.warning(f"Draw command failed: {e}")


    async def enable_music_mode_recovery(self):
        """Enable music mode as a recovery mechanism when getting 'illegal request' errors"""
        try:
            _LOGGER.info("Attempting to enable music mode for recovery...")
            # Try to enable music mode - this typically requires the device IP and a local port
            await asyncio.to_thread(self.device.start_music, port=54321)
            _LOGGER.info("Music mode enabled successfully for recovery")
            return True
        except Exception as e:
            _LOGGER.error(f"Failed to enable music mode: {e}")
            return False

    def _close_fast_socket(self):
        """Close the persistent fast socket if open.
        
        Uses SO_LINGER with zero timeout for an abortive close (RST).
        This avoids TIME_WAIT state which would prevent opening new
        connections when the lamp's TCP stack fills up.
        """
        if self._fast_socket is not None:
            try:
                # Abortive close: send RST instead of FIN → avoids TIME_WAIT
                import struct
                self._fast_socket.setsockopt(
                    socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0)
                )
                self._fast_socket.close()
            except Exception:
                pass
            self._fast_socket = None
            self._fast_socket_time = 0.0
            self._fx_activated_on_socket = False

    async def send_raw_command(self, command: str, params: list = None, timeout: float = 1.5):
        """Send a single command on a FRESH TCP connection (bypasses send_command_fast).
        
        Opens a new socket, sends the command, closes with RST.
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
            import struct
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            try:
                sock.connect((self._ip, self._port))
                sock.sendall(request)
                _LOGGER.info(
                    f"[RAW] [{self._ip}] Sent {command} on fresh TCP "
                    f"({len(request)} bytes)"
                )
            finally:
                try:
                    sock.setsockopt(
                        socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0)
                    )
                    sock.close()
                except Exception:
                    pass

        await asyncio.to_thread(_send)

    async def send_command_fast(self, command: str, params: list = None):
        """
        Send command to Yeelight Cube using a PERSISTENT socket (send-only).
        
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
                import select
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
                                _LOGGER.warning(
                                    f"[FAST] Drained {len(all_data)} bytes then got EOF "
                                    f"(peer closed): {all_data[:200]}"
                                )
                            return True
                        all_data += data
                    
                    if all_data:
                        if b'"error"' in all_data:
                            _LOGGER.warning(
                                f"[FAST] [{self._ip}] Drained ERROR response from Cube "
                                f"({len(all_data)} bytes, last_cmd={self._last_fast_command}): "
                                f"{all_data[:300]}"
                            )
                            return True  # Signal: FX mode likely lost
                        else:
                            # Log drained OK responses at DEBUG level for brightness diagnostics
                            _LOGGER.debug(
                                f"[BRIGHTNESS_DIAG] [{self._ip}] Drained response "
                                f"({len(all_data)} bytes, last_cmd={self._last_fast_command}, "
                                f"fx_on_sock={self._fx_activated_on_socket}): "
                                f"{all_data[:300]}"
                            )
                except Exception:
                    return True  # Error — socket is dead
                return False
            
            def _send_on_existing(sock):
                """Blocking: check peer is alive, then send.  Raises on failure."""
                if _check_peer_closed(sock):
                    raise ConnectionResetError("Peer closed the connection")
                sock.sendall(request)
            
            def _open_and_send():
                """Blocking: open a new socket, send, return the socket."""
                import struct
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
                    socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0)
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
                        _LOGGER.warning(
                            f"[FAST #{cmd_id}] Closing FX-active socket before activate_fx_mode "
                            f"(socket already in FX data mode, socket_age={age:.0f}s, "
                            f"total_cmds={self._total_commands_sent})"
                        )
                        self._close_fast_socket()
                        # The Cube needs time to process the RST (abortive close)
                        # before accepting a new TCP connection.  300ms gives
                        # reliable headroom on LAN.
                        await asyncio.sleep(0.3)
                    else:
                        # Socket exists but NOT in FX data mode — try to reuse
                        # it directly for FX activation (avoids costly close→reconnect).
                        _LOGGER.warning(
                            f"[FAST #{cmd_id}] Reusing existing socket for activate_fx_mode "
                            f"(fx_on_sock=False, socket_age="
                            f"{time.time() - self._fast_socket_time:.1f}s)"
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
                        _LOGGER.warning(
                            f"[FAST #{cmd_id}] Existing socket broken ({type(sock_err).__name__}: {sock_err}) "
                            f"— waiting 100ms then reconnecting "
                            f"(connect_timeout={connect_timeout}s, total_cmds={self._total_commands_sent})"
                        )
                        self._close_fast_socket()
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
                                f"[FAST #{cmd_id}] Socket recovery after activate_fx_mode — "
                                f"expected Cube TCP close, NOT setting reconnected flag"
                            )
                else:
                    # No socket yet — open a fresh one and keep it
                    connect_timeout = RECOVERY_CONNECT_TIMEOUT if (self._device_unreachable or self._consecutive_failures > 0) else CONNECT_TIMEOUT
                    _LOGGER.warning(
                        f"[FAST #{cmd_id}] Opening new socket for {command} "
                        f"(connect_timeout={connect_timeout}s, failures={self._consecutive_failures}, "
                        f"total_cmds={self._total_commands_sent})"
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
                    _LOGGER.info(
                        f"[FAST #{cmd_id}] ✓ RECONNECTED ({command}) after {prev_failures} failures!"
                    )
                    self._device_unreachable = False
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                elif self._reconnect_cooldown != RECONNECT_COOLDOWN_INITIAL:
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                
                self._connection_healthy = True
                self._last_reconnect_attempt = 0
                
                # Invalidate the library's socket — we bypassed it.
                try:
                    lib_sock = self.device._Bulb__socket
                    if lib_sock is not None:
                        lib_sock.close()
                        self.device._Bulb__socket = None
                except Exception:
                    self.device._Bulb__socket = None
                
                self._total_commands_sent += 1
                _LOGGER.debug(
                    f"[FAST #{cmd_id}] ✓ {command} sent (total={self._total_commands_sent})"
                )
                return True
                
            except (socket.error, socket.timeout, OSError, ConnectionRefusedError, TimeoutError) as e:
                # Connection failed entirely — close the socket so next attempt opens fresh
                self._close_fast_socket()
                
                self._consecutive_failures += 1
                self._failed_commands_window.append(time.time())
                self._last_reconnect_attempt = time.time()
                connect_timeout_used = RECOVERY_CONNECT_TIMEOUT if (self._device_unreachable or self._consecutive_failures > 1) else CONNECT_TIMEOUT
                _LOGGER.warning(
                    f"[FAST #{cmd_id}] ✗ {command} failed: {type(e).__name__}: {e} "
                    f"(connect_timeout={connect_timeout_used}s, failures={self._consecutive_failures}, "
                    f"total_cmds_sent={self._total_commands_sent})"
                )
                
                # Smarter initial cooldown: if the device was working recently
                # (within 60s), this is likely a transient glitch — use a shorter
                # initial cooldown (2s) for faster recovery.  For devices that
                # have been down a while, keep the normal 5s initial cooldown.
                time_since_success = time.time() - self._last_success_time if self._last_success_time > 0 else 999
                if self._consecutive_failures == 1 and time_since_success < 60:
                    # First failure after recent success → transient-friendly cooldown
                    self._reconnect_cooldown = 2.0
                    _LOGGER.info(
                        f"[FAST #{cmd_id}] Using short cooldown (2s) — device was online "
                        f"{time_since_success:.0f}s ago"
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
                
                raise BulbException({"code": 0, "message": "A socket error occurred when sending the command."})
            except Exception as e:
                self._close_fast_socket()
                _LOGGER.error(f"[FAST #{cmd_id}] ✗ Unexpected: {type(e).__name__}: {e}")
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
            f"[DRAW_FAST] [{self._ip}] update_leds: "
            f"rgb_data={len(rgb_data)} chars, json={request_bytes} bytes"
        )
        await self.send_command_fast("update_leds", [rgb_data])

    async def send_command_with_recovery(self, command: str, params: list = None):
        """
        Send command to Yeelight lamp with automatic error recovery.
        
        All commands are serialized through _command_lock to prevent concurrent
        TCP connections which overwhelm the Yeelight Cube (error 6).
        
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
        _LOGGER.debug(f"[COMMAND #{cmd_id}] Queued: {command} [{self._state_summary()}]")
        
        # Serialize all commands through the lock — the Yeelight Cube cannot
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
                _LOGGER.debug(f"[COMMAND #{cmd_id}] Rate limiting: waiting {wait_time:.3f}s")
                await asyncio.sleep(wait_time)
            
            try:
                # Check if socket is None — need to reconnect first
                if self.device._Bulb__socket is None:
                    current_time = time.time()
                    time_since_last = current_time - self._last_reconnect_attempt
                    
                    if time_since_last < self._reconnect_cooldown:
                        # Still in cooldown — don't attempt, just skip.
                        # DON'T increment _consecutive_failures for this — it's not
                        # a real connection attempt, just a "too soon" skip.
                        _LOGGER.debug(
                            f"[COMMAND #{cmd_id}] SKIP {command}: cooldown active "
                            f"({self._reconnect_cooldown - time_since_last:.1f}s remaining, "
                            f"failures={self._consecutive_failures})"
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
                            f"[COMMAND #{cmd_id}] [{self._ip}] Socket=None, cooldown expired — "
                            f"attempting reconnect (was {time_since_last:.1f}s ago, "
                            f"cooldown={self._reconnect_cooldown:.0f}s, "
                            f"failures={self._consecutive_failures})"
                        )
                        reconnect_success = await self._graceful_reconnect()
                        if not reconnect_success:
                            # TCP probe failed — device is genuinely unreachable.
                            # Raise as a socket error so the queue processor handles
                            # it like any other connection failure (retry scheduling,
                            # backoff, etc.) instead of silently returning None which
                            # the queue treats as "success" and resets the retry counter.
                            _LOGGER.warning(
                                f"[COMMAND #{cmd_id}] [{self._ip}] Reconnect failed — "
                                f"device unreachable (TCP probe failed)"
                            )
                            # Don't increment _consecutive_failures here — the socket
                            # error handler below will do that when it catches this.
                            # Use code=0 (not -1!) because -1 matches the quota handler.
                            raise BulbException({"code": 0, "message": "A socket error occurred when sending the command."})
                    else:
                        # Normal flow: socket=None after a successful "closed" response.
                        # The library creates a fresh socket on send_command() — no
                        # wait needed, no reconnect flag (FX mode is still active).
                        _LOGGER.debug(
                            f"[COMMAND #{cmd_id}] Socket=None (normal close) — "
                            f"library will create fresh socket for {command}"
                        )
                
                if params is None:
                    params = []
                
                _LOGGER.debug(f"[COMMAND #{cmd_id}] Executing: {command} with {len(params)} params")
                result = await asyncio.to_thread(self.device.send_command, command, params)
                self._last_command_time = time.time()
                
                # Connection succeeded — reset exponential backoff
                prev_failures = self._consecutive_failures
                prev_cooldown = self._reconnect_cooldown
                self._consecutive_failures = 0
                if self._device_unreachable:
                    _LOGGER.info(
                        f"[COMMAND #{cmd_id}] ✓ RECONNECTED after {prev_failures} failures! "
                        f"Resetting backoff {prev_cooldown:.0f}s → {RECONNECT_COOLDOWN_INITIAL}s"
                    )
                    self._device_unreachable = False
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                elif self._reconnect_cooldown != RECONNECT_COOLDOWN_INITIAL:
                    _LOGGER.info(
                        f"[COMMAND #{cmd_id}] ✓ SUCCESS — resetting cooldown {prev_cooldown:.0f}s → {RECONNECT_COOLDOWN_INITIAL}s"
                    )
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                else:
                    _LOGGER.debug(f"[COMMAND #{cmd_id}] ✓ SUCCESS ({command})")
                
                return result
                
            except BulbException as e:
                error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
                error_code = error_dict.get('code', 0)
                error_message = error_dict.get('message', str(e))
                
                if error_code == -1:  # Quota exceeded
                    self._consecutive_failures += 1
                    self._failed_commands_window.append(time.time())
                    backoff_time = self._reconnect_cooldown * QUOTA_BACKOFF_MULTIPLIER
                    _LOGGER.warning(f"[COMMAND #{cmd_id}] QUOTA EXCEEDED - backing off {backoff_time:.1f}s")
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
                        _LOGGER.info(
                            f"[COMMAND #{cmd_id}] ✓ RECONNECTED (closed conn) after {prev_failures} failures! "
                            f"Resetting backoff {prev_cooldown:.0f}s → {RECONNECT_COOLDOWN_INITIAL}s"
                        )
                        self._device_unreachable = False
                    elif prev_failures > 0:
                        _LOGGER.info(
                            f"[COMMAND #{cmd_id}] ✓ OK (closed conn, {command} was sent) — "
                            f"cleared {prev_failures} failure(s)"
                        )
                    else:
                        _LOGGER.debug(f"[COMMAND #{cmd_id}] ✓ OK (closed conn, {command} was sent)")
                    self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                    # CRITICAL: Reset _last_reconnect_attempt so subsequent commands
                    # in the same apply() call aren't blocked by the cooldown.
                    # The Cube closes TCP after EVERY command in direct mode — this is
                    # normal behavior, not an error. Without this reset, set_bright and
                    # update_leds would be SKIPPED because they'd see socket=None +
                    # _last_reconnect_attempt only 0.5s ago < 2s cooldown.
                    self._last_reconnect_attempt = 0
                    try:
                        self.device._Bulb__socket = None
                    except:
                        pass
                    return {"result": "ok"}
                    
                elif "socket error" in error_message.lower():
                    # "A socket error occurred when sending the command" = connect() or
                    # send() failed. The command was NOT sent. The library already set
                    # __socket = None, so the next command will retry with a fresh socket.
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
                                f"[COMMAND #{cmd_id}] ✗ SOCKET ERROR ({command}) [{self._ip}] — "
                                f"backoff increased: {old_cooldown:.0f}s → {self._reconnect_cooldown:.0f}s "
                                f"(failures={self._consecutive_failures}, unreachable=True)"
                            )
                        else:
                            _LOGGER.warning(
                                f"[COMMAND #{cmd_id}] ✗ SOCKET ERROR ({command}) [{self._ip}] — "
                                f"backoff CAPPED at {self._reconnect_cooldown:.0f}s "
                                f"(failures={self._consecutive_failures}, unreachable=True)"
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
                            f"[COMMAND #{cmd_id}] ✗ SOCKET ERROR ({command}) [{self._ip}] — "
                            f"failure {self._consecutive_failures}/{next_escalation} "
                            f"(cooldown={self._reconnect_cooldown:.0f}s, "
                            f"unreachable={self._device_unreachable})"
                        )
                    raise e
                    
                elif error_code == 6:  # Illegal request — device is busy/overwhelmed
                    self._consecutive_failures += 1
                    self._failed_commands_window.append(time.time())
                    _LOGGER.warning(
                        f"[COMMAND #{cmd_id}] ✗ ILLEGAL REQUEST ({command}) — "
                        f"error code 6, backing off {RECONNECT_COOLDOWN_INITIAL}s "
                        f"[{self._state_summary()}]"
                    )
                    await asyncio.sleep(RECONNECT_COOLDOWN_INITIAL)
                    raise e
                    
                else:
                    self._consecutive_failures += 1
                    self._failed_commands_window.append(time.time())
                    _LOGGER.warning(
                        f"[COMMAND #{cmd_id}] ✗ BULB ERROR ({command}): code={error_code}, "
                        f"msg='{error_message}' [{self._state_summary()}]"
                    )
                    raise e
                    
            except AttributeError as e:
                error_msg = str(e)
                self._consecutive_failures += 1
                self._failed_commands_window.append(time.time())
                if "'NoneType' object has no attribute" in error_msg:
                    _LOGGER.info(
                        f"[COMMAND #{cmd_id}] ✗ SOCKET GONE ({command}) — "
                        f"NoneType AttributeError [{self._state_summary()}]"
                    )
                    await asyncio.sleep(SOCKET_ERROR_WAIT)
                else:
                    _LOGGER.error(
                        f"[COMMAND #{cmd_id}] ✗ ATTR ERROR ({command}): {e} [{self._state_summary()}]"
                    )
                raise e
                
            except Exception as e:
                error_msg = str(e)
                self._consecutive_failures += 1
                self._failed_commands_window.append(time.time())
                _LOGGER.error(
                    f"[COMMAND #{cmd_id}] ✗ UNEXPECTED ({command}): {type(e).__name__}: {e} "
                    f"[{self._state_summary()}]"
                )
                raise e


    @staticmethod
    def encode_hex_color(hex_color: str) -> str:
        hex_color = hex_color.lstrip("#")
        rgb = tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
        rgb_bytes = bytes(rgb)
        return base64.b64encode(rgb_bytes).decode("ascii")