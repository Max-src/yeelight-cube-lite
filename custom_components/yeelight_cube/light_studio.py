"""The palette color mode's stream (lamp_studio draws the frames).

The same stream shows what a Cube Lite can't run itself in any color mode
(effect_catalog.LITE_STREAMED_EFFECTS): a Cube Matrix's own version of a slot, and the
integration's own effects (effect_catalog.STREAMED_EFFECTS), which no lamp has. Those
are drawn by their renderer in the colours chosen (a clock over one, in the
clock's colour or palette).

In the palette color mode, an effect the lamp cannot show in the whole
palette itself (lamp_studio.studio_runs), or a clock over one
(clock_studio_runs), is drawn by the integration and sent in direct mode,
like a drawing, STUDIO_FPS frames a second, over the LAN (no Matter needed).
The light stays in the Native Effect or Clock mode (cards, rotation,
favourites, restore see an effect or a clock); only how it reaches the lamp
differs. A streamed clock is its background recolored, shown through its
digits for the current time (clock_face), as the lamp's own clock does.

One rule keeps the stream out of everything else's way: before each frame it
checks it should still run (studio_streaming) and takes the lamp's lock only
when it is free. Anything that shows something else (a drawing, the clock,
another color mode, Music Flow, turn_off, an app or button taking the lamp,
Freeze) changes what that check reads, and the stream stops by itself;
another command waiting for the lamp goes first, the frame is skipped.

Over TCP the lamp takes about one command a second (lamp_client_tcp
TCP_COMMAND_INTERVAL): no stream. The lamp keeps the last frame meanwhile,
and the stream goes on once UDP answers again.

A Cube Matrix (device_profile) has no effect, clock or GIF command on the
LAN: every effect, animation and clock is streamed, whatever the color mode,
as the Cube Lite would show it, but in raw colours (lamp_core.raw_colours:
the Cube Matrix converts each pixel itself) and from the effect's first
render. Effects that listen to a microphone are not: the Cube Matrix has
none. What it can show itself over Matter, while that is available
(light_matrix: its own effects and clock, the demo loop off), is not
streamed either.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time

from homeassistant.util import dt as dt_util  # type: ignore

from .clock_face import clock_content, clock_digit_pixels, clock_text
from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
)
from .effect_catalog import (
    ALL_NATIVE_EFFECTS,
    DEFAULT_NATIVE_CLOCK_STYLE,
    LITE_STREAMED_EFFECTS,
    NATIVE_CLOCK_STYLES,
    clock_style_direct,
    clock_style_effect,
)
from .lamp_protocol import encode_rgb_frame, trace_frame
from .lamp_protocol import LAMP_ERRORS
from .lamp_core import drawn_in_full, raw_colours
from .lamp_renderers import (
    FIREWORKS_MODE,
    LAMP_MUSIC_EFFECTS,
    LAMP_RENDERED_EFFECTS,
    clock_digit_flags,
    lamp_settings,
    renderer_frame,
)
from .lamp_studio import (
    STUDIO_FPS,
    clock_studio_runs,
    studio_clock_background_at,
    studio_frame_at,
    studio_runs,
)
from .light_color import hardware_brightness_for
from .light_connection import _get_device_lock
from .light_display import ACTIVATION_TIMING

_LOGGER = logging.getLogger(__name__)

# One frame per render of the lamp's renderers: the lamp draws every 40 ms,
# so a faster stream would only have frames it never shows.
STUDIO_FRAME_SECONDS = 1 / STUDIO_FPS
# After a frame could not be sent, the stream waits this long before the
# next try (a lamp that went away is not asked 25 times a second).
STUDIO_RETRY_SECONDS = 2.0
# A stream that ended on an error starts again after STUDIO_RETRY_SECONDS,
# twice as long after each crash in a row, up to this long (s).
STUDIO_RESTART_MOST = 60.0
# Every render is sent, the same as the last one or not: a steady stream of
# STUDIO_FPS frames a second, never a pause (the owner's rule: streams stay at
# 25 a second or more). The lab tied the Cube Lite's hang to its traffic
# stopping and starting (pauses, ends: phases 7-13), never to a steady
# stream; sending only the frames that changed made a still moment a pause.
# A streamed Cube Lite is asked every this long (s) for an answer of its own
# (LampClient.probe, set_scene keep): frames are never answered, so a lamp
# that stopped answering mid-stream (its LAN part stuck, only a power cycle
# helps) was not seen: 2026-11-14, one stayed "on" in Home Assistant for
# minutes. Unanswered: frames pause, the problem check runs (the Repair and
# the Power cycle sensor, issues.py), and the stream goes on once it answers.
STUDIO_PROBE_SECONDS = 30.0
# While it is silent, it is asked again this often: an answer lost on Wi-Fi
# must not leave a working lamp without frames for STUDIO_PROBE_SECONDS.
STUDIO_SILENT_PROBE_SECONDS = 5.0
# Frames pause only after this many checks in a row went unanswered (about
# STUDIO_PROBE_SECONDS + 2 x STUDIO_SILENT_PROBE_SECONDS); the frames go on
# through a lost answer or two. A pause is the end of a stream, and lamp runs
# showed stream ends are when a Cube Lite hangs (2026-11-15, phases 19-21:
# every hang found at a stream's end, 10 of 57 ends; none during a stream,
# 120 checks of this kind included): on the far lamp one answer in ~30 is
# lost, and each lost one used to pause the stream and so risk a hang. A
# lamp that really hangs gets frames meanwhile, which is harmless, and is
# reported ~10 s later than with 1. (The morning's withdrawn change also had
# this; its hang came at a drain of the lamp's commands, removed since.)
# firmware/H41_STREAM_PLAN_2026-11-15.md in the lab repo.
STUDIO_SILENT_AFTER = 3


def studio_stride(max_fps) -> int:
    """Renders per frame sent: 1, or enough that a lamp showing ``max_fps``
    frames a second gets no more."""
    if not max_fps:
        return 1
    return max(1, -(-STUDIO_FPS // int(max_fps)))


def studio_clock_frame(
    effect, render, speed, intensity, palette, direct, now, content, twelve_hour,
    colon_blink, digit_flags, turned, colours=None, seed=None,
) -> list:
    """A streamed clock's frame: its background ``effect`` in the palette
    (lamp_studio.studio_clock_background_at, from its first render; without
    a palette in its own colours, raw: a background a Cube Lite can't run
    itself, or in ``colours``, the clock's, for one of the integration's own
    effects) through the digits the clock shows at ``now`` (clock_face);
    dark elsewhere. ``seed``: the run of a background that simulates
    (Lava Lamp), a new one each time the stream starts it again."""
    if palette:
        background = studio_clock_background_at(
            effect, render, speed, intensity, palette, direct, True, seed=seed,
        )
    else:
        with raw_colours():
            background = studio_clock_background_at(
                effect, render, speed, intensity, None, direct, True, colours, seed,
            )
    frame = [(0, 0, 0)] * len(background)
    text, colon_visible = clock_text(now, content, twelve_hour, colon_blink)
    for index, _char, _col in clock_digit_pixels(text, colon_visible, digit_flags, turned):
        frame[index] = background[index]
    return frame


class StudioStreamMixin:
    """Start, run and stop the palette stream of the selected effect or clock."""

    def _init_studio_state(self) -> None:
        """Called by YeelightCubeLight.__init__."""
        self._studio_task: asyncio.Task | None = None
        # The check that a Cube Lite still answers while something streams
        # to it (_streams_changed); the stream's crashes in a row, when it
        # started (stream_report) and whether the lamp's silence was logged.
        self._stream_watchdog_task: asyncio.Task | None = None
        self._studio_crashes = 0
        self._studio_started_at = None
        self._stream_silence_logged = False
        # What the stream's clock belongs to (effect, direction, mount), when
        # its render 0 was due (the event loop's clock) and the last render
        # sent (a stream started again, after a Freeze, goes on from it).
        self._studio_key: tuple | None = None
        self._studio_origin = 0.0
        self._studio_last_render = -1
        # The run of an effect that simulates (Lava Lamp, effect_catalog.STREAMED_EFFECTS):
        # a new seed whenever the stream's render 0 starts again, so each run
        # is its own (lamp_effects_streamed).
        self._studio_seed = 0

    # ── What runs ──────────────────────────────────────────────────────
    def _clock_style(self) -> dict:
        return NATIVE_CLOCK_STYLES.get(
            int(self._native_clock_style),
            NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
        )

    def studio_selected(self) -> bool:
        """Whether what is selected is streamed (lamp_studio.studio_runs,
        clock_studio_runs): the lamp then gets a stream, not its own
        effect or clock."""
        palette = self._text_colors
        if self.device_profile.streams_effects:
            # A lamp without effects of its own on the LAN (Cube Matrix): all
            # streamed, but a microphone effect (it has no microphone), and
            # what it shows itself over Matter (light_matrix).
            if self._mode == MODE_NATIVE_EFFECT:
                if self._native_effect in LAMP_MUSIC_EFFECTS:
                    return False
            elif self._mode != MODE_CLOCK:
                return False
            native = getattr(self, "matrix_native_command", None)
            return native is None or native() is None
        # A Cube Lite streams an effect it can't run itself (a Cube Matrix's
        # own version of a slot, effect_catalog.LITE_STREAMED_EFFECTS), or one in a
        # palette it can't show.
        if self._mode == MODE_NATIVE_EFFECT:
            return self._native_effect in LITE_STREAMED_EFFECTS or studio_runs(
                self._native_effect, self._native_effect_color_mode, palette,
            )
        if self._mode == MODE_CLOCK:
            effect = clock_style_effect(self._clock_style())
            return effect in LITE_STREAMED_EFFECTS or clock_studio_runs(
                effect, self._native_clock_color_mode, palette,
            )
        return False

    def studio_streaming(self) -> bool:
        """Whether the stream should be sending frames now."""
        return (
            self.hass is not None
            and self._is_on
            and self.studio_selected()
            and not self._music_flow_enabled
            and not self._calibration_lock
            and not self._external_display
            and not self._display_frozen
            and not self._in_native_fw_mode
        )

    def _studio_render_at(self, due: float) -> int:
        """The render a frame due at ``due`` (the event loop's clock) shows:
        one more for each frame, whatever the moment it is drawn or sent, so
        no render is shown twice or skipped. It starts again from 0 when the
        effect (or clock style), its direction or the mount changes."""
        key = (
            ("clock", self._native_clock_style) if self._mode == MODE_CLOCK
            else ("effect", self._native_effect, self._native_effect_direction),
            self._device_orientation,
        )
        if key != self._studio_key:
            self._studio_key = key
            self._studio_origin = due
            self._studio_seed = random.getrandbits(32)
        render = max(0, round((due - self._studio_origin) / STUDIO_FRAME_SECONDS))
        self._studio_last_render = render
        return render

    async def _studio_payload(self, render: int) -> str:
        """Frame ``render``, as update_leds takes it: the effect in the
        palette, drawn in an executor (a renderer's first frame can replay
        its history, a tenth of a second or more on a slow host), then the
        stages every drawing gets last (the low-brightness correction, the
        color accuracy, the power limit). Like the lamp's own effects it
        takes no color adjustment."""
        if self.device_profile.streams_effects:
            frame = await self.hass.async_add_executor_job(drawn_in_full, self._own_effect_frame, render)
            return encode_rgb_frame(self._lamp_frame(self._brightness_stages(frame)))
        palette = [list(colour) for colour in self._text_colors or ()]
        if self._mode == MODE_CLOCK:
            style = self._clock_style()
            mixer = style.get("mixer", 0)
            direct = clock_style_direct(style)
            effect = clock_style_effect(style)
            colour_mode = self._native_clock_color_mode
            colours = None
            if effect is not None and ALL_NATIVE_EFFECTS[effect].get("streamed"):
                # One of the integration's own effects: its renderer takes
                # the clock's color, or its palette, as the camera's preview.
                colour = self._native_clock_color
                colours = (
                    None if colour is None else (colour >> 16 & 255, colour >> 8 & 255, colour & 255),
                    colour_mode, palette,
                )
            if not clock_studio_runs(effect, colour_mode, palette):
                palette = []  # streamed in its own colours (LITE_STREAMED_EFFECTS)
            frame = await self.hass.async_add_executor_job(
                drawn_in_full, studio_clock_frame, effect, render,
                self._native_effect_speed, self._chosen_effect_intensity(), palette, direct,
                dt_util.now(), clock_content(self),
                bool(self._native_clock_12_hour),
                bool(self._native_clock_colon_blink),
                clock_digit_flags(mixer, direct), bool(getattr(self, "lamp_turns_clock", False)),
                colours, self._studio_seed,
            )
            return encode_rgb_frame(self._lamp_frame(self._brightness_stages(frame)))
        if not studio_runs(self._native_effect, self._native_effect_color_mode, palette):
            # An effect the Cube Lite can't run itself, in its own colours
            # (raw: the lamp converts a stream's pixels).
            frame = await self.hass.async_add_executor_job(drawn_in_full, self._own_effect_frame_raw, render)
            return encode_rgb_frame(self._lamp_frame(self._brightness_stages(frame)))
        # From the effect's very first render, as the lamp starts its own
        # (Building Blocks on an empty panel), not where a preview starts.
        frame = await self.hass.async_add_executor_job(
            drawn_in_full, studio_frame_at, self._native_effect, render,
            self._native_effect_direction, self._native_effect_speed,
            self._device_orientation, self._chosen_effect_intensity(), palette, True,
        )
        return encode_rgb_frame(self._lamp_frame(self._brightness_stages(frame)))

    def _own_effect_frame(self, render: int) -> list:
        """What a Cube Lite would show now for the selected effect or clock,
        for a lamp that has no effects of its own on the LAN (Cube Matrix),
        in raw colours when it converts them itself (device_profile), on the
        columns it shows (device_profile.columns)."""
        if self.device_profile.raw_colours:
            with raw_colours():
                return self._own_effect_frame_drawn(render)
        return self._own_effect_frame_drawn(render)

    def _own_effect_frame_raw(self, render: int) -> list:
        """_own_effect_frame_drawn in raw colours (a stream's pixels)."""
        with raw_colours():
            return self._own_effect_frame_drawn(render)

    def _own_effect_frame_drawn(self, render: int) -> list:
        """_own_effect_frame's frame. An effect the renderers draw: its frame
        at ``render`` from its first (lamp_settings: its color, color mode
        and palette; studio_frame_at when the palette color mode streams
        it). Anything else (an animation, Fireworks, a clock): the preview
        camera's simulated_lamp_frame. Without one, a clock shows nothing but
        its digits in the style's first color."""
        # Drawn on the columns the lamp shows (a Cube Matrix with fewer than
        # 4 blocks shows fewer than 20): what moves stops at its last column.
        columns = self.device_profile.columns
        if self._mode == MODE_NATIVE_EFFECT and self._native_effect in LAMP_RENDERED_EFFECTS:
            effect = self._native_effect
            mode = self._native_effect_color_mode
            palette = self._text_colors
            if studio_runs(effect, mode, palette):
                return studio_frame_at(
                    effect, render, self._native_effect_direction,
                    self._native_effect_speed, self._device_orientation,
                    self._chosen_effect_intensity(), palette, True, columns,
                )
            colour = self._native_effect_color
            settings = lamp_settings(
                effect, self._native_effect_direction, self._native_effect_speed,
                list(colour) if colour is not None else None, mode,
                self._device_orientation, self._chosen_effect_intensity(),
                [list(c) for c in palette] if palette else None, columns,
            )
            if ALL_NATIVE_EFFECTS[effect].get("streamed"):
                settings["seed"] = self._studio_seed  # this run's
            if settings["mode"] != FIREWORKS_MODE:
                return renderer_frame(settings, render)
        for camera in self._camera_entities or ():
            frame = camera.simulated_lamp_frame()
            if frame is not None:
                return list(frame)
        frame = [(0, 0, 0)] * 100
        if self._mode != MODE_CLOCK:
            return frame
        text, colon_visible = clock_text(dt_util.now(), clock_content(self),
                                         bool(self._native_clock_12_hour),
                                         bool(self._native_clock_colon_blink))
        colour = self._resolve_native_clock_color(self._clock_style()) or 0xFFFFFF
        rgb = ((colour >> 16) & 255, (colour >> 8) & 255, colour & 255)
        for index, _char, _col in clock_digit_pixels(
            text, colon_visible, 0, False, columns,
        ):
            frame[index] = rgb
        return frame

    def _chosen_effect_intensity(self) -> int:
        """The intensity chosen for the effects, which lamp_settings gives
        only to those that read it (as the camera's preview does)."""
        return int(self._native_effect_intensity)

    # ── Start ──────────────────────────────────────────────────────────
    async def _start_studio_stream(self) -> None:
        """Stream the selected effect or clock (light_native._activate_native_effect
        and _activate_native_clock, under the lamp's lock): direct mode, the brightness, the first frame,
        then the stream. While a stream already runs, it already shows what
        is selected (each frame reads the settings): nothing to do."""
        if claim := getattr(self, "_claim_display", None):
            claim()
        over_matter = getattr(self, "matrix_streams_over_matter", None)
        matter = over_matter is not None and over_matter()
        running = self._studio_task is not None and not self._studio_task.done()
        if running and (matter or self._fx_mode_is_direct):
            # Over Matter, the next frame also sends the drawing again when
            # the lamp does not show it (light_matrix).
            self._native_effect_streamed(direct=not matter)
            return
        leaving_native = self._in_native_fw_mode
        if note_power := getattr(self, "_expect_lamp_power", None):
            note_power(True)
        if matter and await self._start_matrix_stream():
            return
        # Activated each time a stream starts: the lamp may have been powered
        # off (turn_off in an effect) or have run its own effect since.
        await self.ensure_fx_ready()
        level = hardware_brightness_for(self._brightness)
        if level != self._last_hardware_brightness:
            await self._lamp_client.send_command_fast("set_bright", [level])
            self._note_hardware_brightness(level)
        loop = asyncio.get_running_loop()
        # Where it was (after a Freeze, or back from another display): on
        # from the next render.
        self._studio_origin = loop.time() - (self._studio_last_render + 1) * STUDIO_FRAME_SECONDS
        try:
            payload = await self._studio_payload(self._studio_render_at(loop.time()))
        except Exception:  # noqa: BLE001 -- the stream tries again
            # A renderer's bug must not leave the lamp in direct mode with no
            # stream: the stream starts anyway and draws again.
            _LOGGER.exception("[STUDIO] [%s] The first frame could not be drawn: the stream tries again", self._ip)
            payload = None
        if payload is not None:
            trace_frame(self._ip, "studio: first frame", payload)
            await self._draw_direct(payload)
            if leaving_native:
                # The first frame can be dropped while the lamp leaves its own
                # renderer (light_display.apply does the same).
                await asyncio.sleep(ACTIVATION_TIMING[self._lamp_client.transport]["native_exit_resend"])
                await self._draw_direct(payload)
        self._last_fx_mode_time = time.time()
        self._native_effect_streamed()
        self._run_studio_loop("LAN")

    async def _start_matrix_stream(self) -> bool:
        """A Cube Matrix's stream over Matter (light_matrix): its first
        frame as the lamp's drawing, then the stream. False when Matter
        failed: the caller streams over the LAN."""
        loop = asyncio.get_running_loop()
        self._studio_origin = loop.time() - (self._studio_last_render + 1) * STUDIO_FRAME_SECONDS
        try:
            pixels = await self._matrix_stream_pixels(self._studio_render_at(loop.time()))
            await self._send_matrix_stream_frame(pixels)
        except Exception as err:  # noqa: BLE001 -- streamed over the LAN instead
            _LOGGER.warning(
                "[STUDIO] [%s] First frame over Matter failed (%s): streamed over the LAN", self._ip, err,
            )
            self._refuse_matrix_native()
            return False
        self._native_effect_streamed(direct=False)
        self._run_studio_loop("Matter")
        return True

    def _run_studio_loop(self, over: str) -> None:
        if self._studio_task is None or self._studio_task.done():
            self._studio_task = self._create_tracked_task(
                self._studio_loop(), name=f"yeelight_cube_studio_{self._ip}"
            )
            _LOGGER.debug(
                "[STUDIO] [%s] Streaming %s over %s", self._ip,
                f"clock style {self._native_clock_style}" if self._mode == MODE_CLOCK else self._native_effect,
                over,
            )

    def _native_effect_streamed(self, direct: bool = True) -> None:
        """The lamp shows the selected effect through the stream: on, in
        direct mode (``direct``; not over Matter: as the lamp's drawing),
        not running a renderer of its own."""
        self._is_on = True
        self._entered_direct_mode(direct)
        self._notify_camera_preview()
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    # ── The stream ─────────────────────────────────────────────────────
    async def _studio_loop(self) -> None:
        """A frame every STUDIO_FRAME_SECONDS while studio_streaming, never
        while another command holds the lamp, and only over UDP. Each frame
        is drawn before it is due, then sent when it is: the frames leave
        evenly, each the next render."""
        loop = asyncio.get_running_loop()
        lock = _get_device_lock(self._ip)
        # From the first frame's moment (_start_studio_stream): the next is
        # the next render.
        due = self._studio_origin + self._studio_last_render * STUDIO_FRAME_SECONDS
        held = False  # frames were not sent (TCP, an error): direct mode again
        # A lamp that shows fewer frames a second over the LAN
        # (device_profile.max_fps, the Cube Matrix) is sent every n-th render
        # there: the effect keeps its speed. Over Matter (a Cube Matrix's
        # drawing, light_matrix) it takes every render.
        lan_step = STUDIO_FRAME_SECONDS * studio_stride(getattr(self.device_profile, "max_fps", None))
        over_matter = getattr(self, "matrix_streams_over_matter", None)
        # While it runs, the transport keeps every pause in its frames busy
        # (LampClient.stream_running): a slow or failed render never leaves
        # a Cube Lite silent mid-stream.
        self._lamp_client.stream_running("studio", True)
        render_failed = False  # logged once per stream
        crashed = False
        self._studio_started_at = time.time()  # stream_report
        try:
            while self.studio_streaming():
                matter = over_matter is not None and over_matter()
                step = STUDIO_FRAME_SECONDS if matter else lan_step
                due += step
                if loop.time() - due > step:
                    due = loop.time()  # late (a busy host): no catching up
                render = self._studio_render_at(due)
                try:
                    if matter:
                        payload = await self._matrix_stream_pixels(render)
                    else:
                        payload = await self._studio_payload(render)
                except Exception:  # noqa: BLE001 -- a renderer's bug must not end the stream
                    if not render_failed:
                        render_failed = True
                        _LOGGER.exception(
                            "[STUDIO] [%s] Frame %d could not be drawn: the lamp keeps the last "
                            "one, drawing is tried again", self._ip, render,
                        )
                    due = loop.time() + STUDIO_RETRY_SECONDS
                    await asyncio.sleep(STUDIO_RETRY_SECONDS)
                    continue
                wait = due - loop.time()
                if wait > 0:
                    await asyncio.sleep(wait)
                if not self.studio_streaming():
                    break
                if lock.locked():
                    continue  # another command goes first
                async with lock:
                    if not self.studio_streaming():
                        break
                    if matter:
                        try:
                            await self._send_matrix_stream_frame(payload)
                        except Exception as err:  # noqa: BLE001 -- tried again shortly
                            _LOGGER.debug("[STUDIO] [%s] Frame over Matter not sent (%s)", self._ip, err)
                            held = True  # over the LAN, if it goes on there
                            due = loop.time() + STUDIO_RETRY_SECONDS
                        continue
                    if self._lamp_client.transport != "udp" or not self._lamp_client.is_connected():
                        held = True
                        continue
                    if getattr(self._lamp_client, "stream_silent", False):
                        # The lamp left its last check unanswered
                        # (_stream_watchdog): no frames until it answers, then
                        # direct mode again.
                        held = True
                        self._direct_mode_lost()
                        continue
                    try:
                        if held or not self._direct_mode_trusted():
                            await self.ensure_fx_ready()
                            held = False
                        await self._lamp_client.send_command_fast("update_leds", [payload])
                    except LAMP_ERRORS as err:  # tried again shortly
                        _LOGGER.debug("[STUDIO] [%s] Frame not sent (%s)", self._ip, err)
                        held = True
                        self._direct_mode_lost()
                        due = loop.time() + STUDIO_RETRY_SECONDS
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- restarted below
            crashed = True
            _LOGGER.exception("[STUDIO] [%s] The stream stopped on an error: started again", self._ip)
        finally:
            self._lamp_client.stream_running("studio", False)
            _LOGGER.debug("[STUDIO] [%s] Stream stopped", self._ip)
            if asyncio.current_task() is self._studio_task:
                self._studio_task = None
        if crashed:
            # Still selected: the stream goes on after STUDIO_RETRY_SECONDS
            # (a frame's error, not the selection, ended it), twice as long
            # after each crash in a row, up to STUDIO_RESTART_MOST: a bug that
            # ends every stream at once never restarts it in a tight loop.
            crashes = self._studio_crashes
            self._studio_crashes = crashes + 1
            await asyncio.sleep(min(STUDIO_RESTART_MOST, STUDIO_RETRY_SECONDS * 2 ** crashes))
            if self.studio_streaming() and self._studio_task is None:
                self._run_studio_loop("LAN, after an error")
        else:
            self._studio_crashes = 0

    def _streams_changed(self) -> None:
        """LampClient.on_stream_change: something streams to the lamp (this
        effect stream, the text scroll), or stopped. While it does, a Cube
        Lite is checked (_stream_watchdog). A Cube Matrix has its own LAN
        check (LampClient._recover_udp)."""
        if self.hass is None or getattr(self, "is_cube_matrix", False):
            return
        if not self._lamp_client.streams_running:
            return
        task = self._stream_watchdog_task
        if task is None or task.done():
            self._stream_watchdog_task = self._create_tracked_task(
                self._stream_watchdog(), name=f"yeelight_cube_stream_watchdog_{self._ip}",
            )

    async def _stream_watchdog(self) -> None:
        """While anything streams to a Cube Lite, ask it every
        STUDIO_PROBE_SECONDS for an answer of its own (frames are never
        answered: a lamp stuck mid-stream was not seen), every
        STUDIO_SILENT_PROBE_SECONDS while it is silent. Under the lamp's lock,
        so no frame goes with the check. Silent: stream_silent (the effect
        stream pauses), the problem check runs (_stream_probe)."""
        matrix = self._lamp_client
        lock = _get_device_lock(self._ip)
        wait = STUDIO_PROBE_SECONDS
        misses = 0  # checks unanswered in a row
        try:
            while self.hass is not None and matrix.streams_running:
                await asyncio.sleep(wait)
                if not matrix.streams_running:
                    break
                wait = STUDIO_PROBE_SECONDS
                if matrix.transport != "udp" or not matrix.is_connected():
                    continue  # the connection's own checks (light_connection)
                async with lock:
                    answered = await self._stream_probe(misses)
                misses = 0 if answered else misses + 1
                # Frames go on through a lost answer or two (STUDIO_SILENT_AFTER).
                matrix.stream_silent = misses >= STUDIO_SILENT_AFTER
                if not answered:
                    wait = STUDIO_SILENT_PROBE_SECONDS
        finally:
            matrix.stream_silent = False
            if asyncio.current_task() is self._stream_watchdog_task:
                self._stream_watchdog_task = None

    def stream_report(self) -> str:
        """What streams and how it went, for the logs of a lamp that stopped
        answering: the effect or clock style, how long it streamed, and the
        transport's stream_stats (frames, gaps)."""
        try:
            if self._mode == MODE_CLOCK:
                what = f"clock style {getattr(self, '_native_clock_style', None)}"
            else:
                what = f"effect {getattr(self, '_native_effect', None)}"
            started = self._studio_started_at
            task = self._studio_task
            if started is not None and task is not None and not task.done():
                what += f", streamed {time.time() - started:.0f} s"
            stats = getattr(self._lamp_client, "stream_stats", None)
            if callable(stats):
                what += ", " + ", ".join(f"{key} {value}" for key, value in stats().items())
            return what
        except Exception:  # noqa: BLE001 -- only for a log line
            return "(no stream report)"

    async def _stream_probe(self, misses: int = 0) -> bool:
        """Whether the streamed lamp itself still answers (STUDIO_PROBE_SECONDS),
        after ``misses`` checks unanswered in a row. Unanswered: logged (INFO
        while frames go on, a WARNING once when they pause:
        STUDIO_SILENT_AFTER), and the problem check runs now (a lamp that
        accepts connections but answers nothing for a minute is reported
        stuck: issues.lamp_problems)."""
        try:
            answered = await self._lamp_client.probe(answering=True)
        except LAMP_ERRORS as err:  # taken as unanswered
            _LOGGER.debug("[STUDIO] [%s] Probe failed: %s", self._ip, err)
            answered = False
        if answered:
            if misses:
                _LOGGER.info(
                    "[STUDIO] [%s] The streamed lamp answers again (after %d unanswered check%s)",
                    self._ip, misses, "" if misses == 1 else "s",
                )
            self._stream_silence_logged = False
            return True
        if misses + 1 < STUDIO_SILENT_AFTER:
            _LOGGER.info(
                "[STUDIO] [%s] A check of the streamed lamp went unanswered (%d of %d before frames "
                "pause): %s", self._ip, misses + 1, STUDIO_SILENT_AFTER, self.stream_report(),
            )
        elif not self._stream_silence_logged:
            self._stream_silence_logged = True
            _LOGGER.warning(
                "[STUDIO] [%s] The streamed lamp stopped answering: frames paused until it does "
                "(a lamp that stays silent needs a power cycle). %s", self._ip, self.stream_report(),
            )
        if self.hass is not None and (check := getattr(self, "_async_check_problems", None)):
            check()
        return False

    def stop_studio_stream(self) -> None:
        """Stop the stream now (entity removal); otherwise it stops by
        itself at its next frame (studio_streaming)."""
        task, self._studio_task = self._studio_task, None
        if task is not None and not task.done():
            task.cancel()
