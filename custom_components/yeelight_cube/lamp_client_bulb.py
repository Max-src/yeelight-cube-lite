"""python-yeelight's Bulb: the commands a lamp is sent through the library.

Owns everything that touches python-yeelight's Bulb beyond its import: the
guarded Bulb (_GuardedBulb: a connection the lamp closed read as an error),
the only access to the library's private request socket (library_socket and
set_library_socket), and BulbCommandsMixin, the lamp client's commands sent
through the library with their reconnection, cooldown and backoff
(send_command_with_recovery, is_connected, _graceful_reconnect). Part of
lamp_client.LampClient. No Home Assistant import.
"""
import logging
import asyncio
import socket
import time
from yeelight import Bulb, BulbException # type: ignore

from .lamp_protocol import (
    MAX_CONSECUTIVE_FAILURES,
    QUOTA_BACKOFF_MULTIPLIER,
    RECONNECT_COOLDOWN_INITIAL,
    SOCKET_ERROR_WAIT,
    CONNECT_TIMEOUT,
    _RST_LINGER,
    _USE_TCP,
    CubeConnectionError,
)
from .music_channel import MusicChannel

_LOGGER = logging.getLogger(__name__)

# python-yeelight keeps its request socket in the private, name-mangled
# attribute ``Bulb.__socket`` and has no API to inspect or replace it. These
# two functions are the only access to it, so a library change only needs
# fixing here.
_LIBRARY_SOCKET_ATTRIBUTE = "_Bulb__socket"


def library_socket(bulb):
    """The library's request socket of ``bulb`` (a python-yeelight Bulb),
    None while it has none (its next command opens one)."""
    return getattr(bulb, _LIBRARY_SOCKET_ATTRIBUTE, None)


def set_library_socket(bulb, sock) -> None:
    """Replace the library's request socket of ``bulb``: None makes its next
    command open a fresh connection."""
    setattr(bulb, _LIBRARY_SOCKET_ATTRIBUTE, sock)


class _ClosedIsAnError:
    """The library's request socket, with a connection the lamp closed read
    as an error. python-yeelight reads its answer until one comes, taking
    only an error for the end: on a connection closed cleanly every read
    returns nothing at once, and it read forever, a thread spinning and the
    lamp's commands waiting on it for good (a Cube Matrix whose LAN is stuck
    accepts every connection and closes it, issues matrix_lan_stuck; on
    2026-11-14 its setup never finished)."""

    __slots__ = ("_sock",)

    def __init__(self, sock) -> None:
        self._sock = sock

    def recv(self, size: int, *flags):
        data = self._sock.recv(size, *flags)
        if not data:
            raise ConnectionResetError("the lamp closed the connection")
        return data

    def __getattr__(self, name):
        return getattr(self._sock, name)


_LIBRARY_SOCKET = getattr(Bulb, "_socket", None)
if isinstance(_LIBRARY_SOCKET, property):

    class _GuardedBulb(Bulb):
        """python-yeelight's Bulb, its socket guarded (_ClosedIsAnError)."""

        @property
        def _socket(self):
            sock = _LIBRARY_SOCKET.fget(self)
            if not isinstance(sock, _ClosedIsAnError):
                # The answer is waited for as long as the component asks
                # (_timeout: LampClient._read_props), not the library's 5 s.
                sock.settimeout(getattr(self, "_timeout", None) or 5)
                sock = _ClosedIsAnError(sock)
                set_library_socket(self, sock)
            return sock

else:  # a stand-in library (the tests'): nothing to guard
    _GuardedBulb = Bulb


class BulbCommandsMixin:
    """LampClient's commands through python-yeelight (lamp_client.py)."""

    # ── python-yeelight request socket ─────────────────────────────────
    # The library keeps its request socket in the private, name-mangled
    # attribute ``Bulb.__socket`` and has no API to inspect or drop it. All
    # access goes through library_socket and set_library_socket (above), so
    # a library change only needs fixing there.
    def _library_socket(self):
        return library_socket(self.device)

    def _drop_library_socket(self, abortive: bool = False) -> None:
        """Close the library's request socket (RST when ``abortive``) so its
        next command opens a fresh connection."""
        sock = self._library_socket()
        if sock is not None:
            try:
                if abortive:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, _RST_LINGER)
                sock.close()
            except OSError as exc:
                _LOGGER.debug("[%s] Failed to close library socket: %s", self._ip, exc)
        set_library_socket(self.device, None)

    def close_command_socket(self) -> None:
        """Close the python-yeelight request socket without touching direct FX."""
        self._drop_library_socket()

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

            _LOGGER.log(self.outage_log_level(), "[RECONNECT] [%s] Starting socket reset [%s]", self._ip, self.summary)
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
                _LOGGER.log(
                    self.outage_log_level(),
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
            # Instead, we set a flag and let light.py handle it
            # after the lock is released.
            self._just_reconnected = True
            
            _LOGGER.info("[RECONNECT] [%s] Complete — fresh connection on next command [%s]", self._ip, self.summary)
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

        Over the UDP session: the lamp's answer; a refusal raises
        BulbException, like the library does.
        """
        self._check_supported(command, params)
        answer = await self._udp_request(command, list(params or []))
        if answer is not _USE_TCP:
            if answer and "error" in answer:
                raise BulbException(answer["error"])
            return answer
        if self._matrix_tcp(command):
            # A Cube Matrix: a one-shot connection (none kept in its 3
            # slots), its refusal read even when not JSON, raised as the
            # library does.
            await self.send_raw_command(command, list(params or []), udp=False, check_reply=True)
            return {"result": ["ok"]}
        await self._tcp_turn(command)
        cmd_id = int(time.time() * 1000) % 100000
        _LOGGER.debug("[COMMAND #%s] Queued: %s [%s]", cmd_id, command, self.summary)
        
        # Serialize all commands through the lock — the Yeelight Cube Lite cannot
        # handle concurrent TCP connections and returns error 6 ("illegal request")
        # or drops connections when overwhelmed.
        async with self._command_lock:
            # Check connection health before sending
            if not self._connection_healthy:
                await self._check_connection_health()
            
            
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
                        _LOGGER.log(
                            self.outage_log_level(),
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
                            _LOGGER.log(
                                self.outage_log_level(),
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
                if isinstance(self._udp, MusicChannel):
                    # A Cube Matrix: no library connection kept open (its 3
                    # client slots, _free_tcp_slots).
                    self._drop_library_socket()
                
                # Connection succeeded — reset exponential backoff
                prev_failures, prev_cooldown, was_unreachable = self._reset_backoff()
                if was_unreachable:
                    _LOGGER.debug(
                        "[COMMAND #%s] ✓ RECONNECTED after %s failures! "
                        "Resetting backoff %.0fs → %ss",
                        cmd_id, prev_failures, prev_cooldown,
                        RECONNECT_COOLDOWN_INITIAL
                    )
                elif prev_cooldown != RECONNECT_COOLDOWN_INITIAL:
                    _LOGGER.debug(
                        "[COMMAND #%s] ✓ SUCCESS — resetting cooldown %.0fs → %ss", cmd_id, prev_cooldown, RECONNECT_COOLDOWN_INITIAL
                    )
                else:
                    _LOGGER.debug("[COMMAND #%s] ✓ SUCCESS (%s)", cmd_id, command)
                
                return result
                
            except BulbException as e:
                error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
                error_code = error_dict.get('code', 0)
                error_message = error_dict.get('message', str(e))
                
                if error_code == -1:  # Quota exceeded
                    self._tcp_quota_hit = True
                    self._count_failure()
                    backoff_time = self._reconnect_cooldown * QUOTA_BACKOFF_MULTIPLIER
                    _LOGGER.warning("[COMMAND #%s] QUOTA EXCEEDED - backing off %.1fs", cmd_id, backoff_time)
                    await asyncio.sleep(backoff_time)
                    raise e
                    
                elif "closed the connection" in error_message.lower():
                    # "Bulb closed the connection" = recv() failed AFTER send() succeeded.
                    # The command WAS sent and processed, the Cube just doesn't keep
                    # the TCP connection open. This is EXPECTED and counts as success.
                    self._last_command_time = time.time()
                    # Reset backoff — device is alive
                    prev_failures, prev_cooldown, was_unreachable = self._reset_backoff()
                    if was_unreachable:
                        _LOGGER.debug(
                            "[COMMAND #%s] ✓ RECONNECTED (closed conn) after %s failures! "
                            "Resetting backoff %.0fs → %ss",
                            cmd_id, prev_failures, prev_cooldown,
                            RECONNECT_COOLDOWN_INITIAL
                        )
                    elif prev_failures > 0:
                        _LOGGER.debug(
                            "[COMMAND #%s] ✓ OK (closed conn, %s was sent) — "
                            "cleared %s failure(s)",
                            cmd_id, command, prev_failures
                        )
                    else:
                        _LOGGER.debug("[COMMAND #%s] ✓ OK (closed conn, %s was sent)", cmd_id, command)
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
                    # CubeConnectionError here so it can be handled by type.
                    if not isinstance(e, CubeConnectionError):
                        e = CubeConnectionError(error_message)
                    failures = self._consecutive_failures + 1
                    level = self.outage_log_level()
                    # Starts the cooldown from now; doubles it every
                    # MAX_CONSECUTIVE_FAILURES failures.
                    old_cooldown = self._connection_failed()
                    if old_cooldown is not None:
                        if self._reconnect_cooldown != old_cooldown:
                            _LOGGER.log(
                                level,
                                "[COMMAND #%s] ✗ SOCKET ERROR (%s) [%s] — "
                                "backoff increased: %.0fs → %.0fs "
                                "(failures=%s, unreachable=True)",
                                cmd_id, command, self._ip, old_cooldown,
                                self._reconnect_cooldown, failures
                            )
                        else:
                            _LOGGER.log(
                                level,
                                "[COMMAND #%s] ✗ SOCKET ERROR (%s) [%s] — "
                                "backoff CAPPED at %.0fs "
                                "(failures=%s, unreachable=True)",
                                cmd_id, command, self._ip, self._reconnect_cooldown,
                                failures
                            )
                    else:
                        next_escalation = (
                            (self._consecutive_failures // MAX_CONSECUTIVE_FAILURES + 1)
                            * MAX_CONSECUTIVE_FAILURES
                        )
                        _LOGGER.log(
                            level,
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
                    self._count_failure()
                    _LOGGER.warning(
                        "[COMMAND #%s] ✗ ILLEGAL REQUEST (%s) — "
                        "error code 6, backing off %ss "
                        "[%s]",
                        cmd_id, command, RECONNECT_COOLDOWN_INITIAL, self.summary
                    )
                    await asyncio.sleep(RECONNECT_COOLDOWN_INITIAL)
                    raise e
                    
                else:
                    self._count_failure()
                    _LOGGER.warning(
                        "[COMMAND #%s] ✗ BULB ERROR (%s): code=%s, "
                        "msg='%s' [%s]",
                        cmd_id, command, error_code, error_message, self.summary
                    )
                    raise e
                    
            except AttributeError as e:
                error_msg = str(e)
                self._count_failure()
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
                self._count_failure()
                _LOGGER.error(
                    "[COMMAND #%s] ✗ UNEXPECTED (%s): %s: %s "
                    "[%s]",
                    cmd_id, command, type(e).__name__, e, self.summary
                )
                raise e
