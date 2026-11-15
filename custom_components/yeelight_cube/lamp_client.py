"""The network client of one lamp, Cube Lite or Cube Matrix: LampClient.

Owns LampClient, what the light (light.py) drives a lamp through: its
state's start (__init__), the lamp's model, profile and capabilities
(fetch_capabilities, set_model, probe_model), the commands a model refuses
(_check_supported) and the closing of every connection (close). The rest of
the client is in its mixins, by concern: the fast channel, UDP session or
music connection (lamp_client_udp.py), its own TCP sockets
(lamp_client_tcp.py), the commands through python-yeelight
(lamp_client_bulb.py) and the connection's health and state
(lamp_client_health.py); what every connection shares is in
lamp_protocol.py. No Home Assistant import.
"""
import logging
import asyncio
from yeelight import BulbException # type: ignore

from .device_profile import CUBE_LITE_PROFILE, CUBEMATRIX, model_key, profile_for
from .lamp_client_bulb import BulbCommandsMixin, _GuardedBulb
from .lamp_client_health import ConnectionHealthMixin
from .lamp_client_tcp import TcpSocketMixin
from .lamp_client_udp import UdpChannelMixin
from .lamp_protocol import (
    MAX_CONSECUTIVE_FAILURES,
    RECONNECT_COOLDOWN_INITIAL,
    RECONNECT_COOLDOWN_MAX,
    CONNECT_TIMEOUT,
    LAMP_ERRORS,
)
from .music_channel import MusicChannel
from .udp_session import UdpSession

_LOGGER = logging.getLogger(__name__)
# How long a Cube Matrix's get_prop of its layout or model is waited for
# (LampClient._read_props): it answers 7-20 s after a power-on, and can be
# slow while busy.
MATRIX_READ_TIMEOUT = 2.0


class LampClient(UdpChannelMixin, TcpSocketMixin, BulbCommandsMixin, ConnectionHealthMixin):
    """Handles communication with a Yeelight Cube Lite or Cube Matrix lamp.

    Commands and frames go over the lamp's UDP command session when it works
    (udp_session.py), else over TCP as before: a fresh connection per
    command, a persistent socket for frames and brightness, with their
    cooldown and backoff.
    """
    def __init__(self, ip: str, port: int):
        _LOGGER.debug("Connecting to Yeelight Cube Lite at %s:%s", ip, port)
        self.device = _GuardedBulb(ip, port)
        self._ip = ip
        self._port = port
        self.device_name = "Yeelight Cube Lite"
        self.capabilities = {}
        self.device_model = "Cube Lite"
        self.software_version = None
        # The lamp model's geometry and commands (device_profile): the Cube
        # Lite until fetch_capabilities reads the model.
        self.profile = CUBE_LITE_PROFILE
        self.device._timeout = CONNECT_TIMEOUT  # Keep low — LAN connects take <10ms, 0.5s is plenty
        self._last_command_time = 0
        # The TCP gate (_tcp_turn): when the next TCP command may go
        # (time.monotonic()), the frames counted (a waiting frame a newer one
        # replaced is dropped), and whether the lamp refused one for its quota.
        self._tcp_turn_lock = asyncio.Lock()
        self._tcp_next_at = 0.0
        self._tcp_frames = 0
        self._tcp_quota_hit = False
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
        # Since when the lamp accepts connections but answers nothing (probe).
        self._silent_since = 0.0
        self._lan_stuck_logged = False
        
        # Persistent socket for send_command_fast — reused across commands.
        # The Cube accepts multiple commands on the same TCP connection in direct
        # FX mode.  Reusing avoids TIME_WAIT socket exhaustion which causes the
        # lamp to reject new connections after rapid-fire pixel art switches.
        self._fast_socket = None  # type: socket.socket | None
        self._fast_socket_time = 0.0  # When the socket was opened (for diagnostics)
        self._last_fast_command = None  # Last command sent via send_command_fast
        self._fx_activated_on_socket = False  # True if activate_fx_mode was sent on current socket
        # Whether the lamp's fx-mode flag may be set: every activate_fx_mode
        # (direct mode) sets it, only deactivate_fx_mode clears it, and while it
        # is set a music effect's first frame stops the microphone instead of
        # starting it (clear_fx_mode_flag). Unknown after a start: it may be.
        self.fx_mode_flag_maybe_set = True
        
        # Flag set by _graceful_reconnect when socket was reset.
        # Checked by light.py after commands to trigger FX mode / brightness restore.
        self._just_reconnected = False
        
        # Total commands successfully sent — diagnostic counter for tracking
        # command volume that may overwhelm the Cube.
        self._total_commands_sent = 0

        self.device_id = None  # Yeelight device ID (hex) — used for discovery suppression

        # The UDP command session, and when UDP may be tried again after it
        # failed (time.monotonic()).
        self._udp = UdpSession(ip)
        self._udp_retry_at = 0.0
        # A Cube Matrix's music connection: failed tries in a row
        # (MUSIC_RETRY_STEPS).
        self._music_failures = 0
        # Sessions already seen: a new one does not carry direct mode.
        self._udp_sessions_seen = 0
        # Whether a UDP failure was logged since UDP last worked: a network
        # that blocks it is reported once, not at every retry.
        self._udp_failure_logged = False
        # Since when UDP has been failing (time.time()), 0 while it works,
        # and how many sessions had been opened then: the lamp answers a
        # session's opening itself, so sessions opened since show UDP passes
        # (connection_state, issues.py udp_unanswered).
        self._udp_failing_since = 0.0
        self._udp_sessions_at_failure = 0
        # Until when commands go over TCP on request (force_tcp,
        # time.monotonic()); 0: not forced.
        self._tcp_forced_until = 0.0
        # The background ping that brings UDP back after a failure.
        self._udp_recovery = None
        # Called when commands switch between UDP and TCP on their own (UDP
        # failed, or answers again): the light publishes its connection.
        self.on_transport_change = None
        # Called when the first producer of frames starts, or the last one
        # stops (stream_running): the light checks the lamp while it streams
        # (light_studio._stream_watchdog), whatever streams it.
        self.on_stream_change = None
        # The lamp left a stream's last check unanswered: the effect stream
        # sends no new frame until it answers again.
        self.stream_silent = False
        # The pending re-send of the last frame (FRAME_SETTLE_DELAY, then
        # STREAM_KEEP_BUSY while frames keep coming), and when the last frame
        # was sent (time.monotonic(); 0: none yet).
        self._frame_settle = None
        self._last_frame_at = 0.0
        # The producers of frames running now (stream_running), and whether
        # the stall of the current one was logged.
        self._stream_owners: set[str] = set()
        self._stall_logged = False
        # The set_fx_effect params of the native effect the lamp runs, while
        # nothing else was sent since (running_effect).
        self._running_effect = None
        
        _LOGGER.debug(
            "[INIT] LampClient initialized: ip=%s, port=%s, timeout=%ss, "
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
                self.software_version = properties.get(
                    "fw_ver", properties.get("fw_version")
                )
            else:
                _LOGGER.debug("get_capabilities returned no data (device may not support it)")
        except (*LAMP_ERRORS, ValueError) as e:
            _LOGGER.debug("Could not retrieve capabilities (expected for some devices): %s", e)
        self.set_model(self.device_model, (self.capabilities or {}).get("support"))

    def set_model(self, model, support=None) -> None:
        """Take the lamp's model (SSDP / the entry): its profile, and for a
        Cube Matrix its module layout (get_prop; blocking: an executor)."""
        if model:
            self.device_model = model
        if model_key(self.device_model) != CUBEMATRIX:
            self.profile = profile_for(self.device_model)
            return
        support_list = str(support or "").split() or sorted(self.profile.support)
        topology = strip_length = None
        try:
            answer = self._read_props(["cube_topology", "rotation_angle", "strip_lenth", "show_off_mode"])
            values = (answer or {}).get("result") or []
            if len(values) >= 3:
                topology, rotation, strip_length = values[0], values[1], values[2]
                self.capabilities["cube_topology"] = topology
                self.capabilities["rotation_angle"] = rotation
                self.capabilities["strip_lenth"] = strip_length
            if len(values) >= 4 and str(values[3]) in ("0", "1"):
                # The demo loop (light_matrix): "1" on, "" not known.
                self.capabilities["show_off_mode"] = str(values[3])
        except Exception as error:  # noqa: BLE001 -- the defaults (4 modules) still work
            _LOGGER.debug("[%s] Cube Matrix layout not read: %s", self._ip, error)
        self.profile = profile_for(
            self.device_model, support_list, topology, strip_length,
            self.capabilities.get("rotation_angle"),
        )
        # Its fast channel is music mode, not the UDP session (music_channel):
        # same interface, so the TCP fallback and recovery stay as they are.
        if not isinstance(self._udp, MusicChannel):
            self._udp.close()
            self._udp = MusicChannel(self._ip, self._port)
        _LOGGER.debug(
            "[%s] Cube Matrix: topology=%s strip=%s rotation=%s (mounted %s) -> %s modules",
            self._ip, topology, strip_length, self.profile.rotation,
            self.profile.orientation, self.profile.modules,
        )

    def _read_props(self, names: list) -> dict | None:
        """get_prop for a Cube Matrix's layout or model (blocking: an
        executor): a longer wait than a command's, tried twice, as the lamp
        can take seconds to answer (after a power-on, or busy). Raises when
        no answer came."""
        timeout = getattr(self.device, "_timeout", CONNECT_TIMEOUT)
        self.device._timeout = MATRIX_READ_TIMEOUT
        try:
            for attempt in (1, 2):
                try:
                    return self.device.send_command("get_prop", names)
                except Exception:  # noqa: BLE001 -- the library's errors
                    if attempt == 2:
                        raise
                finally:
                    self._drop_library_socket()
        finally:
            self.device._timeout = timeout

    def probe_model(self) -> str | None:
        """The model of a lamp neither SSDP nor its entry names (an entry made
        before models were told apart, without multicast): a Cube Matrix
        answers get_prop with its modules, a Cube Lite never answers it
        (blocking: an executor). "CubeMatrix" (taken: set_model), else None:
        no answer is not proof of a Cube Lite (a Cube Matrix busy or just
        powered on answers late), so nothing is stored and it is asked again
        at the next start."""
        try:
            answer = self._read_props(["cube_topology"])
        except Exception as error:  # noqa: BLE001 -- a Cube Lite, or no answer yet
            _LOGGER.debug("[%s] No get_prop answer (a Cube Lite?): %s", self._ip, error)
            answer = None
        values = (answer or {}).get("result") or []
        if not (values and str(values[0]).strip(", 0")):
            _LOGGER.info("[%s] Lamp model not known: driven as a Cube Lite for now", self._ip)
            return None
        self.set_model("CubeMatrix")
        _LOGGER.info("[%s] Lamp model found by asking it: CubeMatrix", self._ip)
        return "CubeMatrix"

    def _check_supported(self, command: str, params=None) -> None:
        """Refuse here a command this lamp does not list (a Cube Matrix has
        no set_fx_effect, set_ps...): it would only wait for an error. Also
        one it lists but must never get (DeviceProfile.refusal)."""
        if not self.profile.accepts(command):
            raise BulbException({
                "code": -1,
                "message": f"{command} is not supported by the {self.profile.name}",
            })
        if refusal := self.profile.refusal(command, params):
            raise BulbException({"code": -1, "message": refusal})


    def close(self) -> None:
        """Close every socket to the lamp (the light is being removed)."""
        if self._udp_recovery is not None:
            self._udp_recovery.cancel()
            self._udp_recovery = None
        self._cancel_frame_settle()
        self.close_fast_socket()
        self._drop_library_socket(abortive=True)
        self._udp.close()
