"""A lamp's fast channel: its UDP command session, or a Cube Matrix's music connection.

Owns UdpChannelMixin, the part of lamp_client.LampClient that sends every
command over the lamp's UDP session when it works (udp_session.py), or over
a Cube Matrix's music connection in its place (music_channel.py: the same
interface), and falls back to TCP otherwise (_udp_request returns _USE_TCP):
the switch between them and the background recovery (_recover_udp), the
re-send of the last frame and the keeping of a stream busy (_settle_frame,
stream_running), the native effect the lamp runs (running_effect), and what
a Cube Matrix takes over its music connection only (_matrix_tcp). No Home
Assistant import.
"""
import logging
import asyncio
import time

from .lamp_protocol import (
    FRAMES,
    _USE_TCP,
    CubeConnectionError,
    frame_id,
    trace_frame,
)
from .music_channel import MusicChannel
from .udp_session import UdpSession, UdpTooLarge, UdpUnavailable

_LOGGER = logging.getLogger(__name__)

# A lamp whose UDP session failed (none on that lamp or network, or it
# stopped answering) is sent TCP; UDP is tried again after this long, or as
# soon as the lamp is back online.
UDP_RETRY_AFTER = 300.0
# Meanwhile the lamp's session is pinged this often in the background, and
# UDP is used again as soon as it answers (_recover_udp): a lamp silent for a
# moment (seen on 18 Oct 2026: switching clock styles quickly) is back on UDP
# within seconds, not after UDP_RETRY_AFTER on the slower, paced TCP. Commands
# never wait for it; they go over TCP until it answers.
UDP_RECOVERY_PING = 15.0
# The first ping comes this soon: a stream whose session failed sends nothing
# until UDP answers again (no frames over the paced TCP), and silence right
# after a busy stream is what hangs a Cube Lite. The ping is the network
# chip's keep-alive, not a command the lamp handles.
UDP_RECOVERY_FIRST_PING = 1.0
# A Cube Matrix's music connection (music_channel) that failed is tried again
# this soon: it is the lamp's only fast path, and without it a stream stops.
MUSIC_RETRY_AFTER = 30.0
# Then, while it keeps failing, later and later: each try that the lamp
# cannot connect back to stalls its LAN handling (its connect-back blocks
# it), so a blocked network is not hit every 30 s forever.
MUSIC_RETRY_STEPS = (MUSIC_RETRY_AFTER, 5 * 60.0, 30 * 60.0)
# While it fails, the lamp is asked a command over TCP this often (s): one it
# does not answer means its LAN is stuck, not the network blocking it.
MUSIC_LAN_CHECK = 60.0
# What a Cube Matrix takes over its music connection only (LampClient._matrix_tcp).
_MATRIX_MUSIC_ONLY = frozenset({"update_leds", "activate_fx_mode"})
# Frames are never answered, so a lost one cannot be noticed: the last frame of
# a burst is sent again this long after it, once. Any other command but
# brightness cancels that. Nothing else is sent with it: in direct mode a
# set_bright after a series of frames sometimes makes the lamp show an older
# picture again (watched tests, 6 times out of 13; frames alone never did, 0
# of 6), so it must never be used as a no-op there.
FRAME_SETTLE_DELAY = 0.3
# A Cube Lite saves its state about 0.8 s after its last command (a debounce
# that every command restarts). During a stream of frames that save hangs the
# lamp for good, until a power cycle, about once in 6 pauses (lab, 2026-11-13:
# 45 s streams with 3 s silent pauses hung both lamps 4 times in 22 pauses;
# with the last frame sent again every 0.4 s through the same pauses, never in
# 22; continuous streams never in hours). So while frames keep coming
# (the previous one less than STREAM_HOLD before), the last frame is sent
# again every STREAM_KEEP_BUSY: a stream stays a steady 25 frames a second
# (the owner's rule), a still moment or a slow producer (the text scroll's
# steps) included. A single frame (a picture, the clock) gets no repeats:
# the save after it is the lamp's usual one. Not a Cube Matrix (its music
# connection).
STREAM_KEEP_BUSY = 0.04
STREAM_HOLD = 3.0
# While a producer of frames says it runs (stream_running: the effect and
# clock stream, the text scroll), every pause in its frames is kept busy the
# same way, however long (a slow render, the scroll's pause at each end, a
# stalled renderer), up to STREAM_STALL_LIMIT without a new frame: then the
# re-sends stop and the stall is logged (re-sending through a long stall did
# not keep the lamps from hanging in the lab, 2026-11-14, and would hide it).
STREAM_STALL_LIMIT = 60.0
# Commands that leave the picture as it is (the re-send still applies) and
# direct mode on: any other may end it, so a new UDP session is no longer
# put in direct mode (UdpSession.session_setup).
_KEEPS_FRAME = frozenset({"update_leds", "set_bright"})
# Commands that leave a running native effect as it is (running_effect): any
# other may replace or stop it.
_KEEPS_EFFECT = frozenset({"set_bright", "update_fx_effect"})
_DIRECT_MODE = [{"mode": "direct"}]


class UdpChannelMixin:
    """LampClient's fast channel (lamp_client.py)."""

    def end_direct_mode(self) -> None:
        """The lamp left direct mode for something else (a Cube Lite's
        stream drawn over Matter, light_matrix): no new UDP session is put
        back in it, and no frame is sent again."""
        self._cancel_frame_settle()
        self._udp.session_setup = []

    def close_music_session(self) -> bool:
        """End a Cube Matrix's music-mode connection (music_channel), and with
        it direct mode: while it is open the lamp drops its Matter effects
        (answered, not shown). Whether one was open. The next frame opens it
        again."""
        channel = self._udp
        if not isinstance(channel, MusicChannel):
            return False
        was_open = channel.is_open
        channel.session_setup = []
        channel.close()
        return was_open

    # ── UDP command session (udp_session.py) ───────────────────────────
    # Every command goes over the lamp's UDP session when it works: no TCP
    # connection per command, no per-connection quota, an answer to every
    # command. TCP (below) stays the fallback: UDP turned off, no session on
    # this lamp or network, a datagram too large for the lamp, or the session
    # stopped answering (UDP is tried again after UDP_RETRY_AFTER, or once
    # the lamp is back online).
    @property
    def transport(self) -> str:
        """"tcp" while UDP has failed and waits to be tried again
        (UDP_RETRY_AFTER), else "udp": an idle session closed by the lamp
        opens again with the next command, it is not a fallback to TCP."""
        return "udp" if self._udp_usable() else "tcp"

    async def _recover_udp(self) -> None:
        """While UDP waits to be tried again after a failure, ping the lamp's
        session every UDP_RECOVERY_PING; as soon as it answers, UDP is used
        again (the next command goes over it; a new session is put in direct
        mode again before the next frame, as after any new session), UDP no
        longer counts as failing (issues.py, the diagnostics), even on a lamp
        that gets no command, the TCP connection used meanwhile is closed,
        and the light publishes its connection (on_transport_change)."""
        last_check = 0.0
        # A Cube Matrix's music connection keeps its own pace (opening it
        # makes the lamp connect back, which stalls its LAN when blocked).
        wait = UDP_RECOVERY_PING if isinstance(self._udp, MusicChannel) else UDP_RECOVERY_FIRST_PING
        while self._udp_retry_at > time.monotonic():
            await asyncio.sleep(wait)
            wait = UDP_RECOVERY_PING
            if self._udp_retry_at <= time.monotonic():
                return  # tried again meanwhile (the lamp came back online)
            if isinstance(self._udp, MusicChannel) and time.monotonic() - last_check >= MUSIC_LAN_CHECK:
                # A Cube Matrix that does not connect back may be blocked by
                # the network, or its LAN may be stuck: it accepts every
                # connection and closes it at once (seen 2026-11-11 and 12,
                # Matter still working; only a power cycle fixed it). A
                # command over TCP tells them apart (silent_for: issues.py).
                last_check = time.monotonic()
                if not await self.probe(answering=True) and self.silent_for and not self._lan_stuck_logged:
                    self._lan_stuck_logged = True
                    _LOGGER.warning(
                        "[HEALTH] [%s] The Cube Matrix accepts connections but answers no "
                        "command over the LAN (its effects over Matter still work): its "
                        "network part is stuck and needs a power cycle", self._ip,
                    )
                elif not self.silent_for:
                    self._lan_stuck_logged = False
            if await self._udp.ping():
                _LOGGER.info("[UDP] [%s] The lamp answers over UDP again", self._ip)
                self._udp_retry_at = 0.0
                self._udp_failing_since = 0.0
                self._udp_failure_logged = False
                self.close_fast_socket()
                # The lamp answers: no TCP reconnection cooldown holds the
                # next frame back (is_connected).
                self._last_reconnect_attempt = 0
                self._transport_changed()
                return

    def _transport_changed(self) -> None:
        if self.on_transport_change is not None:
            self.on_transport_change()

    def _udp_usable(self) -> bool:
        now = time.monotonic()
        return now >= self._udp_retry_at and now >= self._tcp_forced_until

    def force_tcp(self, seconds: float) -> None:
        """Send every command over TCP for ``seconds`` (0: UDP again at
        once), to test the TCP fallback on demand (diagnostics force_tcp).
        As when UDP fails: direct mode, activated in the UDP session, is
        activated again over TCP before the next frame; afterwards a new
        UDP session is opened (and put in direct mode) as after a failure."""
        if seconds > 0:
            self._tcp_forced_until = time.monotonic() + seconds
            self._udp.close()
            self._just_reconnected = True
        else:
            self._tcp_forced_until = 0.0

    def _cancel_frame_settle(self) -> None:
        if self._frame_settle is not None:
            if not self._frame_settle.done():
                FRAMES.debug("[%s] re-send cancelled", self._ip)
            self._frame_settle.cancel()
            self._frame_settle = None

    def stream_running(self, owner: str, running: bool) -> None:
        """A producer of frames (``owner``) runs, or stopped: while one runs,
        any pause in its frames is kept busy (STREAM_KEEP_BUSY, up to
        STREAM_STALL_LIMIT), not only the first STREAM_HOLD."""
        before = bool(self._stream_owners)
        if running:
            self._stream_owners.add(owner)
        else:
            self._stream_owners.discard(owner)
        if bool(self._stream_owners) != before and self.on_stream_change is not None:
            self.on_stream_change()

    @property
    def streams_running(self) -> bool:
        return bool(self._stream_owners)

    def stream_stats(self) -> dict:
        """The UDP session's stream_stats, for the logs ({} without one)."""
        return self._udp.stream_stats() if isinstance(self._udp, UdpSession) else {}

    def _settle_frame(self, command: str, params: list) -> None:
        """After a frame: make sure the lamp ends on it once the burst is over
        (FRAME_SETTLE_DELAY), and on a Cube Lite keep a stream busy
        (STREAM_KEEP_BUSY, while frames keep coming). Any other command
        (brightness aside) cancels it, also while it runs, so it never
        overwrites what came next."""
        if command not in _KEEPS_FRAME:
            self._cancel_frame_settle()
        if command != "update_leds" or not self._udp_usable():
            return
        self._cancel_frame_settle()
        if getattr(self, "stream_changes_only", False):
            return  # Falling Blocks experiment: no automatic duplicate frames.
        now = time.monotonic()
        streaming = (
            (now - self._last_frame_at < STREAM_HOLD or bool(self._stream_owners))
            and not isinstance(self._udp, MusicChannel)
        )
        self._last_frame_at = now
        self._stall_logged = False

        async def _settle():
            try:
                # Mid-stream the next frame's moment; a lone frame's re-send
                # once the burst is over.
                await asyncio.sleep(STREAM_KEEP_BUSY if streaming else FRAME_SETTLE_DELAY)
                if not self._udp_usable():
                    return  # UDP failed meanwhile: TCP took over
                await self._udp.request("update_leds", params)
                trace_frame(self._ip, "re-sent frame", params[0])
                while streaming:
                    await asyncio.sleep(STREAM_KEEP_BUSY)
                    paused = time.monotonic() - now
                    if paused >= STREAM_HOLD and not self._stream_owners:
                        break  # the stream ended: the lamp's usual save follows
                    if paused >= STREAM_STALL_LIMIT:
                        if not self._stall_logged:
                            self._stall_logged = True
                            _LOGGER.warning(
                                "[STREAM] [%s] No new frame for %.0f s while streaming (%s): "
                                "the last one is no longer sent again",
                                self._ip, paused, ", ".join(sorted(self._stream_owners)),
                            )
                        break
                    if not self._udp_usable():
                        return
                    await self._udp.request("update_leds", params)
            except UdpUnavailable:
                pass  # the next command finds out and falls back
            finally:
                if self._frame_settle is task:
                    self._frame_settle = None

        task = asyncio.get_running_loop().create_task(_settle())
        self._frame_settle = task

    async def _udp_request(self, command: str, params: list):
        """The lamp's answer over the UDP session (a dict, None for a frame),
        or _USE_TCP: send over TCP instead."""
        # First, whatever the transport: a command cancels a pending re-send,
        # and one that may end direct mode stops new sessions from getting
        # it (activating it sets it again below, once the session took it).
        self._settle_frame(command, params)
        if command not in _KEEPS_FRAME:
            self._udp.session_setup = []
        if command not in _KEEPS_EFFECT:
            self._running_effect = None
        if not self._udp_usable():
            return _USE_TCP
        music = isinstance(self._udp, MusicChannel)
        if music and not self._udp.is_open:
            # A Cube Matrix has 3 TCP client slots and its music connection,
            # which it opens back to us, needs one: when they are full it
            # drops it at once (seen 2026-11-09). Free ours first.
            self._free_tcp_slots()
        try:
            answer = await self._udp.request(command, params)
        except UdpTooLarge:
            return _USE_TCP
        except UdpUnavailable as err:
            if music:
                retry = MUSIC_RETRY_STEPS[min(self._music_failures, len(MUSIC_RETRY_STEPS) - 1)]
                self._music_failures += 1
            else:
                retry = UDP_RETRY_AFTER
            self._udp_retry_at = time.monotonic() + retry
            if self._udp_recovery is None or self._udp_recovery.done():
                self._udp_recovery = asyncio.get_running_loop().create_task(
                    self._recover_udp(), name=f"yeelight_cube udp recovery {self._ip}"
                )
            _LOGGER.log(
                logging.DEBUG if self._udp_failure_logged else logging.INFO,
                "[UDP] [%s] %s: sending over TCP (%s tried again in %.1f min, "
                "or once the lamp is back online)",
                self._ip, err, "the music connection" if music else "UDP", retry / 60,
            )
            self._udp_failure_logged = True
            if not self._udp_failing_since:
                self._udp_failing_since = time.time()
                self._udp_sessions_at_failure = self._udp.sessions_opened
            # Direct mode activated in the session does not carry to TCP.
            self._just_reconnected = True
            self._transport_changed()
            return _USE_TCP
        if FRAMES.isEnabledFor(logging.DEBUG):
            FRAMES.debug(
                "[%s] sent %s", self._ip,
                f"frame {frame_id(params[0])}" if command == "update_leds" and params
                else f"{command} {str(params)[:80]}",
            )
        if command == "activate_fx_mode" and list(params) == _DIRECT_MODE and not (answer or {}).get("error"):
            # Direct mode only applies to the session it was sent in: every
            # new session (the lamp dropped this one) is put in it first, so
            # the frames carry on as if nothing happened -- no reconnection
            # to recover from (which re-activated and re-sent the brightness
            # after frames: an older picture came back, see FRAME_SETTLE_DELAY).
            self._udp.session_setup = [(command, list(params))]
        if self._udp.sessions_opened != self._udp_sessions_seen:
            # A new session (the first, after TCP, or after the lamp lost the
            # previous one): direct mode activated elsewhere (over TCP) is not
            # in it, unless the session was put in it (session_setup).
            self._udp_sessions_seen = self._udp.sessions_opened
            if command != "activate_fx_mode" and not self._udp.session_setup:
                self._just_reconnected = True
            # The lamp may have restarted: its effect is not known any more.
            self._running_effect = None
        if self._udp_failure_logged:
            _LOGGER.info("[UDP] [%s] UDP session working again", self._ip)
            self._udp_failure_logged = False
            # The TCP connection opened meanwhile is no longer used: closed,
            # so it does not hold one of the lamp's connections.
            self.close_fast_socket()
        self._udp_failing_since = 0.0
        if music and self._udp.is_open:
            self._music_failures = 0
        prev_failures, _, was_unreachable = self._reset_backoff()
        if was_unreachable:
            _LOGGER.debug("[UDP] [%s] ✓ answering again after %s failures", self._ip, prev_failures)
        self._last_success_time = self._last_command_time = time.time()
        self._connection_healthy = True
        self._last_reconnect_attempt = 0
        self._total_commands_sent += 1
        return answer

    @property
    def running_effect(self) -> list | None:
        """The set_fx_effect params of the native effect the lamp runs, or
        None when not known: any command but brightness or an effect update
        (_KEEPS_EFFECT), a new UDP session (the lamp may have restarted) or
        an outage forgets it."""
        return self._running_effect

    def forget_running_effect(self) -> None:
        """The next native effect is set in full, not updated live (the
        lamp's own direction applies only when an effect starts)."""
        self._running_effect = None

    def note_running_effect(self, params: list) -> None:
        """The lamp took this set_fx_effect (or update_fx_effect to it)."""
        self._running_effect = [dict(p) if isinstance(p, dict) else p for p in params]

    def _matrix_tcp(self, command: str) -> bool:
        """A Cube Matrix with no music connection (its TCP fallback): frames
        and direct mode cannot go over TCP there (its direct mode belongs to
        one connection, and a kept connection takes one of its 3 slots, so
        the music connection could never come back: seen 2026-11-09, frames
        refused "illegal request", every effect dark). Raises for those (the
        stream waits, the music connection is tried again after
        MUSIC_RETRY_AFTER); True for another command, which then goes over a
        one-shot connection (send_raw_command). False: not a Cube Matrix."""
        if not isinstance(self._udp, MusicChannel):
            return False
        if command in _MATRIX_MUSIC_ONLY:
            self.close_fast_socket()
            raise CubeConnectionError(
                f"{command}: the Cube Matrix takes frames over its music connection only "
                f"(tried again within {MUSIC_RETRY_AFTER:.0f} s)"
            )
        return True

    def _free_tcp_slots(self) -> None:
        """Close this integration's TCP connections to a Cube Matrix (the
        fallback socket and the library's): its 3 client slots must leave
        one for the music connection."""
        self.close_fast_socket()
        self._drop_library_socket()
