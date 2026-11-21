"""The palette stream's two routes to the lamp, its pacing and its log lines
(light_studio._studio_loop).

The stream picks its route again before every frame:

- MatterStreamRoute: a Cube Matrix's drawing over Matter (light_matrix),
  every render, the same as the last one or not.
- LanStreamRoute: direct mode over the LAN (update_leds in the lamp's UDP
  session). A Cube Lite's frames are paced (LanPacer: its Stream frame rate
  limit, the last picture again so direct mode is never left quiet, Skip
  Unchanged Stream Frames); a Cube Matrix gets every n-th render here while
  Matter is not available (device_profile.max_fps).

StreamDiag counts what happened to the frames, for the `[STREAM DIAG]` log
lines (DEBUG) and the warning when frames fail.

No Home Assistant import.
"""
from __future__ import annotations

import logging


class LanPacer:
    """When a Cube Lite gets its next LAN frame. New pictures follow a
    schedule ``gap`` apart (the Stream frame rate limit), so over time the
    lamp gets exactly that many a second although frames only leave on a
    render (``step``): at 12 a second they go 80 or 120 ms apart, never
    rounded down to every third render (8.3 a second). A frame later than
    a render (a hold, the lock, unchanged pictures) moves the schedule, so
    there is no burst to catch up: two frames are never more than one render
    closer than the gap.
    At a limit of ``resend`` or slower (5 a second and under), every frame
    goes one gap after the one before, the new picture, else the last one
    again (unless unchanged frames are skipped): the lamp gets one steady
    rhythm of exactly the limit, never two frames closer together, so a
    limit of 1 is one frame a second, skipped or not. (The last picture
    again every 0.2 s between new ones made any limit 5 frames a second on
    the lamp: a Cube Lite at "1 a second" hung three times on 2026-11-20,
    none in 19 lamp-hours at a true 1 a second.) A new picture right after
    a repeat (120 ms apart at 3 a second) hung a Cube Lite within minutes,
    four times in a row (2026-11-19)."""

    # Render timing jitter: a frame due ``resend`` after the last one still
    # goes at the render that comes a few milliseconds early.
    SLACK = 0.01

    SEND = "send"
    REPEAT = "repeat"
    WAIT = "wait"

    def __init__(self, resend: float, step: float = 0.0) -> None:
        self.resend = resend
        self.step = step  # the time between renders
        # The last LAN frame (a repeat too), and when the next new picture
        # may go (the stream's clock: the event loop's).
        self.sent_at = float("-inf")  # nothing sent yet
        self.next_at = 0.0
        self.gap = 0.0

    def decide(self, now: float, changed: bool, gap: float, changes_only: bool, can_repeat: bool) -> str:
        """SEND the frame now, REPEAT the last one (sent over the LAN:
        ``can_repeat``), or WAIT for a later render. ``changed``: the frame
        differs from the last one sent; ``changes_only``: Skip Unchanged
        Stream Frames, no repeat."""
        self.gap = gap
        since = now - self.sent_at
        if self._steady(gap):
            # One frame per beat (``next_at``): the new picture, else the
            # same one again (none when unchanged frames are skipped: the
            # route stops those first). Never closer than ``resend``.
            if since < self.resend - self.SLACK or now < self.next_at - self.SLACK:
                return self.WAIT
            return self.SEND
        if changed:
            early = now < self.next_at
        else:
            early = since < self.resend
        if not early:
            return self.SEND
        # The newest picture goes at the next render it may.
        return self.WAIT

    def _steady(self, gap: float) -> bool:
        """Frames on a steady rhythm, one gap apart (a limit of 5 a second
        or under)."""
        return self.resend > 0 and gap >= self.resend - self.SLACK

    def sent(self, now: float) -> None:
        # The next one a gap after the time this one was due, so the rate is
        # exact over time; a picture later than a render (a hold, the lock)
        # counts from one render before now, so nothing bursts to catch up.
        self.next_at = max(self.next_at, now - self.step) + self.gap
        self.sent_at = now

    def repeated(self, now: float) -> None:
        self.sent_at = now


class StreamDiag:
    """A stream's counts (frames rendered, sent, skipped, held, failed), its
    slowest render and send, and its log lines: its status at DEBUG when it
    changes and every REPORT_SECONDS; a failed frame as a WARNING once per
    outage (DEBUG after that), its end at INFO once frames go through again."""

    REPORT_SECONDS = 30.0

    def __init__(self, ip: str, logger, report) -> None:
        self.counts = dict(rendered=0, submitted=0, unchanged=0, paced=0, locked=0, unavailable=0, errors=0)
        self.max_render_ms = 0.0
        self.max_send_ms = 0.0
        self._ip = ip
        self._log = logger
        self._report = report  # light_studio.stream_report
        self._status = None
        self._report_at = 0.0
        self._failures = 0  # frames failed in a row (an outage)

    def count(self, key: str) -> None:
        self.counts[key] = self.counts.get(key, 0) + 1

    def rendered(self, seconds: float) -> None:
        self.counts["rendered"] += 1
        self.max_render_ms = max(self.max_render_ms, seconds * 1000)

    def submitted(self, seconds: float) -> None:
        self.counts["submitted"] += 1
        self.max_send_ms = max(self.max_send_ms, seconds * 1000)
        if self._failures:
            self._log.info(
                "[STREAM DIAG] [%s] Frames go through again (after %d failed)", self._ip, self._failures,
            )
            self._failures = 0

    def failed(self, route: str, transport: str, err) -> None:
        """A frame over ``route`` failed: a WARNING for the first of an
        outage, DEBUG for the rest."""
        self.counts["errors"] += 1
        log = self._log.debug if self._failures else self._log.warning
        self._failures += 1
        log("[STREAM DIAG] [%s] %s frame failed (%s): %s; %s", self._ip, route, transport, err, self._report())

    def status(self, now: float, status: tuple) -> None:
        """``status`` (route, transport, connected, silent, changes only,
        what streams) logged when it changed, or REPORT_SECONDS after the
        last line."""
        if status == self._status and now < self._report_at:
            return
        self._log.debug(
            "[STREAM DIAG] [%s] route=%s transport=%s connected=%s silent=%s "
            "changes_only=%s counts=%s max_render_ms=%.1f max_send_ms=%.1f; %s",
            self._ip, *status[:5], self.counts, self.max_render_ms, self.max_send_ms, self._report(),
        )
        self._status = status
        self._report_at = now + self.REPORT_SECONDS

    def stopped(self, crashed: bool) -> None:
        self._log.log(
            logging.INFO if crashed else logging.DEBUG,
            "[STREAM DIAG] [%s] Stopped crashed=%s counts=%s max_render_ms=%.1f max_send_ms=%.1f; %s",
            self._ip, crashed, self.counts, self.max_render_ms, self.max_send_ms, self._report(),
        )


class MatterStreamRoute:
    """A Cube Matrix's stream as its drawing over Matter (light_matrix): every
    render, every frame sent, the same as the last one or not (a steady
    cadence: the lamp fades its drawing in again at each new data, so a
    pause between frames made the picture pulse). A failed frame is tried
    again shortly; after a few the stream goes over the LAN."""

    name = "Matter"
    paced = False
    errors = (Exception,)

    def __init__(self, light, step: float) -> None:
        self.light = light
        self.step = step  # seconds between frames

    def unavailable(self) -> bool:
        return False

    def standby(self):
        return self.light._standby_pixels()

    async def draw(self, render: int):
        return await self.light._matrix_stream_pixels(render)

    async def pace(self, candidate, last_sent, held: bool, changes_only: bool) -> str | None:
        return None  # every frame goes

    async def send(self, payload, held: bool) -> None:
        await self.light._send_matrix_stream_frame(payload)

    def failed(self) -> None:
        pass


class LanStreamRoute:
    """The stream in direct mode over the LAN (update_leds in the lamp's UDP
    session; none over the paced TCP). Held while there is no UDP session,
    or while the lamp left its last checks unanswered (light_studio.
    _stream_watchdog): then direct mode again before the next frame. A Cube
    Lite's frames are paced (``pacer``)."""

    name = "LAN"

    def __init__(self, light, step: float, errors: tuple, clock, pacer: LanPacer | None = None) -> None:
        self.light = light
        self.step = step  # seconds between frames
        self.errors = errors  # what a failed frame raises (lamp_protocol.LAMP_ERRORS)
        self._clock = clock  # the event loop's time
        self.pacer = pacer

    @property
    def paced(self) -> bool:
        return self.pacer is not None

    def unavailable(self) -> bool:
        client = self.light._lamp_client
        if client.transport != "udp" or not client.is_connected():
            return True
        if getattr(client, "stream_silent", False):
            # No frames until the lamp answers, then direct mode again.
            self.light._direct_mode_lost()
            return True
        return False

    def standby(self):
        return self.light._standby_payload()

    async def draw(self, render: int):
        return await self.light._studio_payload(render)

    async def pace(self, candidate, last_sent, held: bool, changes_only: bool) -> str | None:
        """None: ``candidate`` goes now. Else what happened instead, as
        StreamDiag counts it: "unchanged" (the same as the last frame sent,
        with Skip Unchanged Stream Frames), "paced" (not due yet under the
        Stream frame rate limit) or "repeated" (the last frame sent again). Only while the lamp is known
        to be in direct mode (a frame after a hold always goes)."""
        light = self.light
        if held or not light._direct_mode_trusted():
            return None
        if changes_only and candidate == last_sent:
            return "unchanged"
        if self.pacer is None:
            return None
        decision = self.pacer.decide(
            self._clock(), candidate != last_sent, light._lite_lan_gap(), changes_only,
            bool(last_sent) and last_sent[0] == self.name,
        )
        if decision == LanPacer.REPEAT:
            await light._lamp_client.send_command_fast("update_leds", [last_sent[2]])
            self.pacer.repeated(self._clock())
            return "repeated"
        if decision == LanPacer.WAIT:
            return "paced"
        return None

    async def send(self, payload, held: bool) -> None:
        light = self.light
        if held or not light._direct_mode_trusted():
            await light.ensure_fx_ready()
        await light._lamp_client.send_command_fast("update_leds", [payload])
        if self.pacer is not None:
            self.pacer.sent(self._clock())

    def failed(self) -> None:
        self.light._direct_mode_lost()
