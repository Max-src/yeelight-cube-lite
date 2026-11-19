"""A lamp connection's health: failures, backoff, reachability and its state.

Owns ConnectionHealthMixin, the part of lamp_client.LampClient that counts
failed commands, runs the reconnection cooldown and its backoff, flags a
lamp unreachable and recovered, probes whether the lamp answers (probe,
silent_for: a lamp whose LAN is stuck), and reports the connection's state
for the logs and the diagnostics (connection_state, state_summary,
outage_log_level). No Home Assistant import.
"""
import logging
import time

from .lamp_protocol import (
    MAX_CONSECUTIVE_FAILURES,
    RECONNECT_COOLDOWN_INITIAL,
    RECONNECT_COOLDOWN_MAX,
    CONNECT_TIMEOUT,
    RECOVERY_CONNECT_TIMEOUT,
    _LazyText,
    check_tcp,
    send_once,
)
from .music_channel import MusicChannel
from .udp_session import UdpUnavailable

_LOGGER = logging.getLogger(__name__)

# The command a recovering lamp is probed with (LampClient.probe): one the
# lamp itself answers and that changes nothing (set_scene "keep").
PROBE_COMMAND = ("set_scene", ["keep"])
# A Cube Matrix's: it answers get_prop.
MATRIX_PROBE_COMMAND = ("get_prop", ["power"])


class ConnectionHealthMixin:
    """LampClient's connection health and state (lamp_client.py)."""

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
        """Count a failed operation (e.g. a hard timeout detected elsewhere)."""
        self._consecutive_failures += 1

    def record_success(self) -> None:
        """Clear the failure count after an operation completed."""
        self._consecutive_failures = 0

    def mark_unreachable(self) -> bool:
        """Flag the lamp as unreachable. Returns True if it was reachable."""
        was_reachable = not self._device_unreachable
        self._device_unreachable = True
        self._running_effect = None
        return was_reachable

    def mark_recovered(self) -> None:
        """The lamp answers again: drop the persistent socket, reset the
        failure count, backoff and unreachable flag, and try UDP again."""
        self.close_fast_socket()
        self._udp_retry_at = 0.0
        self._running_effect = None
        self._reset_backoff()
        self._connection_healthy = True
        self._last_reconnect_attempt = 0

    def _connect_timeout(self) -> float:
        """TCP connect timeout: longer while recovering from failures, as the
        Cube can need 1-3s to accept a connection after a failed attempt."""
        if self._device_unreachable or self._consecutive_failures > 0:
            return RECOVERY_CONNECT_TIMEOUT
        return CONNECT_TIMEOUT

    def _count_failure(self) -> None:
        """Count a failed command (also for the 60s health window)."""
        self._consecutive_failures += 1
        self._failed_commands_window.append(time.time())

    def _connection_failed(self, first_cooldown: float | None = None) -> float | None:
        """A connect or send failed: count it and start the reconnect cooldown
        now. ``first_cooldown`` replaces the cooldown on a first failure.

        Every MAX_CONSECUTIVE_FAILURES failures the cooldown doubles (up to
        RECONNECT_COOLDOWN_MAX) and the lamp is flagged unreachable; the
        cooldown it had before is then returned, otherwise None.
        """
        self._count_failure()
        self._last_reconnect_attempt = time.time()
        if first_cooldown is not None and self._consecutive_failures == 1:
            self._reconnect_cooldown = first_cooldown
        if self._consecutive_failures % MAX_CONSECUTIVE_FAILURES:
            return None
        previous = self._reconnect_cooldown
        self._reconnect_cooldown = min(previous * 2, RECONNECT_COOLDOWN_MAX)
        self._device_unreachable = True
        # Count again from 1, so the next escalation takes another
        # MAX_CONSECUTIVE_FAILURES failures (one "capped" log per tier, not
        # one per failure).
        self._consecutive_failures = 1
        return previous

    def _reset_backoff(self) -> tuple[int, float, bool]:
        """A command got through: clear the failure count, the backoff and the
        unreachable flag. Returns the (failures, cooldown, unreachable) it
        had, for logging."""
        previous = (self._consecutive_failures, self._reconnect_cooldown, self._device_unreachable)
        self._consecutive_failures = 0
        self._device_unreachable = False
        self._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
        return previous

    async def probe(self, timeout: float = CONNECT_TIMEOUT, *, answering: bool = False) -> bool:
        """Whether the lamp answers: in its UDP session, else by accepting a
        TCP connection within ``timeout``. ``answering`` (a lamp recovering
        from failed commands): whether the lamp itself answers a command
        (PROBE_COMMAND), not only its network part. That part, a chip of its
        own, accepts connections and answers keep-alives even while the
        lamp's command handling has stalled for good (seen after a stream of
        frames), which only a power cycle fixes: such a lamp is stuck
        (silent_for), not back."""
        if not answering:
            if self._udp_usable() and await self._udp.ping():
                return True
            try:
                await check_tcp(self._ip, self._port, timeout)
            except OSError:
                return False
            return True
        if await self.probe_session():
            return True
        return await self.probe_tcp(timeout)

    async def probe_session(self) -> bool:
        """The answering probe's first step: whether the lamp itself answers
        PROBE_COMMAND in its UDP session. False when it does not, or there
        is no session to ask (UDP failed, a Cube Matrix): probe_tcp asks."""
        # A Cube Matrix's music connection answers nothing (and opening it
        # ends the lamp's own effect): it is asked over TCP, a read it
        # answers (get_prop).
        if not self._udp_usable() or isinstance(self._udp, MusicChannel):
            return False
        try:
            answer = await self._udp.request(*PROBE_COMMAND)
        except UdpUnavailable:
            answer = None
        # Only a result is the lamp's answer: an error can come from its
        # network chip alone (a quota), the lamp itself stuck. Taken as an
        # answer, a stuck lamp passed for working again for a minute (its
        # Power cycle sensor off, frames sent again). Asked over TCP then,
        # where an error is no answer either (send_once).
        if isinstance(answer, dict) and "result" in answer:
            self._silent_since = 0.0
            return True
        return False

    async def probe_tcp(self, timeout: float = CONNECT_TIMEOUT) -> bool:
        """The answering probe over TCP (after probe_session): whether the
        lamp accepts a connection within ``timeout`` and answers a command
        on it."""
        matrix = isinstance(self._udp, MusicChannel)
        # Over TCP from here: the pending re-send of the last frame is
        # dropped (the next frame starts its own).
        self._cancel_frame_settle()
        try:
            await check_tcp(self._ip, self._port, timeout)
        except OSError:
            return False  # unreachable (off, or away from the network)
        try:
            await send_once(self._ip, self._port, *(MATRIX_PROBE_COMMAND if matrix else PROBE_COMMAND), timeout)
        except OSError:
            if not self._silent_since:
                self._silent_since = time.time()
            return False
        self._silent_since = 0.0
        return True

    @property
    def silent_for(self) -> float:
        """Seconds the lamp has accepted connections without answering
        (probe), 0 when it answers or is simply unreachable."""
        return time.time() - self._silent_since if self._silent_since else 0.0

    def consume_reconnected_flag(self) -> bool:
        """
        Check and clear the reconnection flag.
        
        Returns True if a reconnection just happened, then clears the flag.
        Called by light.py after successful commands to know when to
        activate direct mode again.
        """
        if self._just_reconnected:
            self._just_reconnected = False
            _LOGGER.debug("[FLAG] consume_reconnected_flag → True (direct mode again)")
            return True
        return False

    @property
    def summary(self) -> "_LazyText":
        """state_summary() for a log argument: only built when the record is
        actually emitted (debug logging is usually off)."""
        return _LazyText(self.state_summary)

    def connection_state(self) -> dict:
        """The connection's state (the logs' state_summary, the downloadable
        diagnostics). Ages in seconds, None when it never happened; the
        TCP socket's age while one is open (commands go over UDP otherwise)."""
        now = time.time()

        def age(since: float) -> float | None:
            return round(now - since, 1) if since > 0 else None

        return {
            "transport": self.transport,
            "udp_sessions_opened": self._udp.sessions_opened,
            "tcp_socket_age": age(self._fast_socket_time) if self._fast_socket is not None else None,
            "consecutive_failures": self._consecutive_failures,
            "reconnect_cooldown": round(self._reconnect_cooldown, 1),
            "unreachable": self._device_unreachable,
            "healthy": self._connection_healthy,
            "reconnected_flag": self._just_reconnected,
            "since_reconnect_attempt": age(self._last_reconnect_attempt),
            "since_success": age(self._last_success_time),
            "commands_sent": self._total_commands_sent,
            "udp_failing_for": age(self._udp_failing_since),
            # Sessions the lamp opened while UDP failed: it answers over UDP,
            # but not the commands sent in them.
            "udp_sessions_while_failing": (
                self._udp.sessions_opened - self._udp_sessions_at_failure
                if self._udp_failing_since else 0
            ),
            "silent_for": age(getattr(self, "_silent_since", 0.0)),
            # A Cube Matrix's fast channel is its music connection (the
            # transport's "udp" then means it; its sessions are connections).
            "channel": "music" if hasattr(self._udp, "connect_back_failed") else "udp_session",
            "music_failures": getattr(self, "_music_failures", 0),
            "music_connect_back_failed": bool(getattr(self._udp, "connect_back_failed", False)),
            "show_off_mode": (getattr(self, "capabilities", None) or {}).get("show_off_mode"),
            "tcp_forced_for": (
                round(self._tcp_forced_until - time.monotonic(), 1)
                if self._tcp_forced_until > time.monotonic() else None
            ),
        }

    def state_summary(self) -> str:
        """Return a compact summary of connection state for diagnostics."""
        state = self.connection_state()
        return f"ip={self._ip}, " + ", ".join(
            f"{key}={value}" for key, value in state.items()
        )

    def outage_log_level(self) -> int:
        """WARNING for a lamp's first connection failure, DEBUG while it is
        already known to be unreachable: an outage (a lamp switched off) is
        logged once, not on every retry (the health check logs its end)."""
        return logging.DEBUG if self._device_unreachable else logging.WARNING
