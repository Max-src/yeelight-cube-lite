"""A lamp's own TCP connections: the paced gate, the kept socket and one-shot commands.

Owns TcpSocketMixin, the part of lamp_client.LampClient that sends commands
over TCP on sockets of its own (not python-yeelight's): the TCP gate that
paces them for the lamp's quota (_tcp_turn), the persistent socket for
frames and brightness (send_command_fast, draw_matrices_fast,
close_fast_socket), a command on a fresh connection (send_raw_command,
query_raw_command), and the clearing of the lamp's fx-mode flag
(clear_fx_mode_flag). No Home Assistant import.
"""
import logging
import asyncio
import json
import select
import socket
import time
from yeelight import BulbException # type: ignore

from .lamp_protocol import (
    _RST_LINGER,
    _USE_TCP,
    CubeConnectionError,
    _raw_reply_error,
)
from .music_channel import MusicChannel

_LOGGER = logging.getLogger(__name__)

# Rate limit constants based on validated testing (0.90 FPS = safe sustained rate)
# Over TCP the lamp takes about one command a second from a client, and
# refuses more ("client quota exceeded"): in watched tests (18 Oct 2026) a
# scrolling text over TCP froze both lamps, then the clock and an effect were
# refused. Every TCP command waits its turn (_tcp_turn); a frame still
# waiting when a newer one comes is dropped (only the latest picture counts).
# UDP has no such limit.
TCP_COMMAND_INTERVAL = 1.0
# The extra pause after the lamp still refused a command for its quota.
TCP_QUOTA_PAUSE = 3.0
# A Cube Matrix: every command on its own connection, so only its shared
# allowance counts (54 a minute, refilled every 60 s): one command every
# 1.2 s at most (50 a minute), and a longer pause once refused.
MATRIX_TCP_INTERVAL = 1.2
MATRIX_QUOTA_PAUSE = 30.0
# About 10 ms after deactivate_fx_mode, the lamp puts back its last app
# effect. An effect sent before it fires would be taken
# down by it, so it is sent after this pause.
FX_MODE_RESTORE_SETTLE = 0.15


class TcpSocketMixin:
    """LampClient's own TCP sockets (lamp_client.py)."""

    async def _tcp_turn(self, command: str) -> bool:
        """Wait for this TCP command's turn: TCP_COMMAND_INTERVAL after the
        previous one (TCP_QUOTA_PAUSE more after a quota refusal). False for
        a frame a newer frame replaced while it waited: not sent, the newer
        one draws the latest picture. Every TCP send goes through it."""
        frame = command == "update_leds"
        if frame:
            self._tcp_frames += 1
            mine = self._tcp_frames
        async with self._tcp_turn_lock:
            matrix = isinstance(self._udp, MusicChannel)
            if self._tcp_quota_hit:
                self._tcp_quota_hit = False
                pause = MATRIX_QUOTA_PAUSE if matrix else TCP_QUOTA_PAUSE
                self._tcp_next_at = max(self._tcp_next_at, time.monotonic()) + pause
            wait = self._tcp_next_at - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            if frame and mine != self._tcp_frames:
                return False
            self._tcp_next_at = time.monotonic() + (MATRIX_TCP_INTERVAL if matrix else TCP_COMMAND_INTERVAL)
            return True

    def _note_quota_refusal(self, message) -> None:
        """A TCP command was refused for the lamp's quota: the gate pauses."""
        if "quota" in str(message):
            self._tcp_quota_hit = True

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
            except OSError as exc:
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
        check_reply: bool = False,
        udp: bool = True,
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

        ``check_reply`` waits briefly (RAW_REPLY_TIMEOUT) for the lamp's answer
        on the same connection and raises BulbException when the lamp refused
        the command (e.g. its rate limit: "client quota exceeded"). Without
        it a refused command looks sent and the lamp is believed to have
        changed. No answer or a closed connection still counts as sent: the
        Cube often closes without replying.

        Over the UDP session every command is answered, so ``check_reply``
        always has the lamp's answer there. ``udp=False`` sends over TCP
        whatever the session: for a command the lamp may leave unanswered,
        which the session would take for a lost lamp.
        """
        if params is None:
            params = []
        self._check_supported(command, params)
        if command == "activate_fx_mode":
            self.fx_mode_flag_maybe_set = True
        answer = await self._udp_request(command, params) if udp else _USE_TCP
        if answer is not _USE_TCP:
            error = answer.get("error") if answer else None
            if error is not None:
                if check_reply:
                    raise BulbException(error)
                _LOGGER.debug("[UDP] [%s] %s answered %s", self._ip, command, error)
            return
        self._matrix_tcp(command)
        if not await self._tcp_turn(command):
            return
        command_dict = {"id": 1, "method": command, "params": params}
        request = (json.dumps(command_dict, separators=(",", ":")) + "\r\n").encode("utf8")
        # A Cube Matrix drops a command whose connection is reset before it
        # read it (2026-11-11: 2 of 6 set_bright lost, 6 of 6 taken when its
        # answer, ~7 ms later, was waited for): its answer is waited for.
        wait_reply = check_reply or isinstance(self._udp, MusicChannel)

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
                if wait_reply:
                    error = _raw_reply_error(sock)
                    if error is not None:
                        self._note_quota_refusal(error)
                        if check_reply:
                            raise BulbException(error)
                        _LOGGER.debug("[RAW] [%s] %s answered %s", self._ip, command, error)
            finally:
                try:
                    if abortive_close:
                        sock.setsockopt(
                            socket.SOL_SOCKET,
                            socket.SO_LINGER,
                            _RST_LINGER,
                        )
                    sock.close()
                except OSError as exc:
                    _LOGGER.debug("[%s] Failed to close raw command socket: %s", self._ip, exc)

        await asyncio.to_thread(_send)

    async def clear_fx_mode_flag(self) -> bool:
        """Clear the lamp's fx-mode flag before a music effect, when it may
        be set (fx_mode_flag_maybe_set). While it is set (any activate_fx_mode
        sets it: direct mode for drawings, text and pictures), a music
        effect's first frame stops the lamp's microphone instead of starting
        it, so the effect does not react to sound. deactivate_fx_mode clears it, as the
        Yeelight app sends before its microphone music. With the flag already
        clear the lamp does not answer it: sent over TCP, not waited for. The
        lamp then puts back the lamp's last app effect; the pause
        lets that happen before the next effect. Returns whether it was
        sent (the running effect is then no longer known)."""
        if not self.fx_mode_flag_maybe_set:
            return False
        # Direct mode ends: a new UDP session must not be put back in it, and
        # the restore replaces whatever ran.
        self._settle_frame("deactivate_fx_mode", [])
        self._udp.session_setup = []
        self._running_effect = None
        await self.send_raw_command("deactivate_fx_mode", [], udp=False)
        self.fx_mode_flag_maybe_set = False
        await asyncio.sleep(FX_MODE_RESTORE_SETTLE)
        return True

    async def query_raw_command(
        self, command: str, params: list = None, timeout: float = 2.0
    ) -> str:
        """DEBUG: send a command on a fresh TCP connection and RETURN the reply.

        Unlike send_raw_command (send-only), this reads whatever the lamp
        sends back and returns it as a decoded string. Used by the raw
        query debug action to read replies (e.g. get_prop) and to see
        how the device replies to experimental commands. Not for hot paths.

        IMPORTANT: While a built-in renderer (clock/effect) is active,
        the Cube can reset its mode when a SECOND TCP connection is opened.
        We therefore close the persistent fast socket before probing so the
        lamp only sees one connection at a time.
        """
        if params is None:
            params = []
        if refusal := self.profile.refusal(command, params):
            raise BulbException({"code": -1, "message": refusal})
        command_dict = {"id": 1, "method": command, "params": params}
        request = (
            json.dumps(command_dict, separators=(",", ":")) + "\r\n"
        ).encode("utf8")

        await self._tcp_turn(command)
        # Close the persistent fast socket first. The Cube is
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
                except OSError as exc:
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
        
        Paced by the TCP gate (_tcp_turn: the lamp's quota); a frame a newer
        one replaced while it waited is not sent (True: the newer one draws).
        
        Args:
            command: Yeelight command name (e.g., 'set_bright', 'update_leds')
            params: Command parameters list
            
        Returns:
            True if send() succeeded, False otherwise

        Over the UDP session: the same command there (frames unanswered).
        """
        self._check_supported(command, params)
        answer = await self._udp_request(command, list(params or []))
        if answer is not _USE_TCP:
            if answer and "error" in answer:
                # Like an error drained from the TCP socket: direct mode is
                # most likely lost, the next frame activates it again.
                _LOGGER.warning(
                    "[UDP] [%s] %s refused: %s", self._ip, command, answer["error"]
                )
                self._just_reconnected = True
            return True
        if self._matrix_tcp(command):
            # A Cube Matrix: a one-shot connection, none kept open.
            await self.send_raw_command(command, list(params or []), udp=False)
            return True
        if not await self._tcp_turn(command):
            return True
        cmd_id = int(time.time() * 1000) % 100000

        async with self._command_lock:
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
                  2. Detect errors so FX mode loss is known
                
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
                        if b'"error"' in all_data and b"quota" in all_data:
                            # Refused for the lamp's quota: the connection
                            # and direct mode are fine; the gate pauses.
                            _LOGGER.warning(
                                "[FAST] [%s] The lamp refused a command for its quota "
                                "(last_cmd=%s): pausing the TCP commands",
                                self._ip, self._last_fast_command,
                            )
                            self._tcp_quota_hit = True
                        elif b'"error"' in all_data:
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
                except (OSError, ValueError) as exc:
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
                sock.settimeout(self._connect_timeout())
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
                # TCP level but zero effect on the lamp's state).
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
                        connect_timeout = self._connect_timeout()
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
                        # sender (apply) already knows it just sent FX mode.
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
                    connect_timeout = self._connect_timeout()
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
                prev_failures, _, was_unreachable = self._reset_backoff()
                self._last_success_time = time.time()
                if was_unreachable:
                    _LOGGER.debug(
                        "[FAST #%s] ✓ RECONNECTED (%s) after %s failures!", cmd_id, command, prev_failures
                    )

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
                connect_timeout_used = self._connect_timeout()
                failures = self._consecutive_failures + 1
                _LOGGER.warning(
                    "[FAST #%s] ✗ %s failed: %s: %s "
                    "(connect_timeout=%ss, failures=%s, "
                    "total_cmds_sent=%s)",
                    cmd_id, command, type(e).__name__, e, connect_timeout_used,
                    failures, self._total_commands_sent
                )

                # Smarter initial cooldown: if the device was working recently
                # (within 60s), this is likely a transient glitch — use a shorter
                # initial cooldown (2s) for faster recovery.  For devices that
                # have been down a while, keep the normal 5s initial cooldown.
                time_since_success = time.time() - self._last_success_time if self._last_success_time > 0 else 999
                recently_online = time_since_success < 60
                if failures == 1 and recently_online:
                    _LOGGER.debug(
                        "[FAST #%s] Using short cooldown (2s) — device was online "
                        "%.0fs ago",
                        cmd_id, time_since_success
                    )
                self._connection_failed(first_cooldown=2.0 if recently_online else None)

                raise CubeConnectionError(
                    f"Could not send {command}: {type(e).__name__}: {e}"
                ) from e
            except Exception as e:
                self.close_fast_socket()
                _LOGGER.error("[FAST #%s] ✗ Unexpected: %s: %s", cmd_id, type(e).__name__, e)
                raise

    async def draw_matrices_fast(self, rgb_data: str):
        """Send pixel data using fire-and-forget (no recv).
        
        Fire-and-forget: it doesn't wait for the Cube's response (which is
        always "Bulb closed the connection" anyway).
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
