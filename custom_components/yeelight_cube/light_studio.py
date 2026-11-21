"""The palette color mode's stream (lamp_studio draws the frames).

The same stream shows what a Cube Lite can't run itself in any color mode
(effect_catalog.LITE_STREAMED_EFFECTS): a Cube Matrix's own version of a slot, and the
integration's own effects (effect_catalog.STREAMED_EFFECTS), which no lamp has. Those
are drawn by their renderer in the colours chosen (a clock over one, in the
clock's colour or palette).

In the palette color mode, an effect the lamp cannot show in the whole
palette itself (lamp_studio.studio_runs), or a clock over one
(clock_studio_runs), is drawn by the integration and streamed, like a
drawing. The light stays in the Native Effect or Clock mode (cards,
rotation, favourites, restore see an effect or a clock); only how it
reaches the lamp differs. A streamed clock is its background recolored,
shown through its digits for the current time (clock_face), as the lamp's
own clock does.

Two routes (stream_routes), picked again before every frame:

- a Cube Lite: direct mode over the LAN, paced (LITE_LAN_GAP, scaled by its
  Stream frame rate limit; the last picture again after LITE_LAN_RESEND;
  Skip Unchanged Stream Frames leaves the repeats out);
- a Cube Matrix: its drawing over Matter (light_matrix), every render; over
  the LAN while Matter is not available.

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

from .clock_face import clock_content, clock_digit_pixels, clock_geometry, clock_text
from .const import (
    CONF_KEEP_STREAMING_WHEN_OFF,
    CONF_SKIP_UNCHANGED_FRAMES,
    LITE_STREAM_FPS_DEFAULT,
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
from .lamp_protocol import LAMP_ERRORS, encode_rgb_frame, trace_frame
from .lamp_core import drawn_in_full, led_appearance, raw_colours
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
from .light_render import fit_frame
from .stream_routes import LanPacer, LanStreamRoute, MatterStreamRoute, StreamDiag

_LOGGER = logging.getLogger(__name__)

# One frame per render of the lamp's renderers: the lamp draws every 40 ms,
# so a faster stream would only have frames it never shows.
STUDIO_FRAME_SECONDS = 1 / STUDIO_FPS
# A Cube Lite's LAN stream gets a frame when the picture changed, never
# sooner than LITE_LAN_GAP after the last one, and the last one again after
# LITE_LAN_RESEND without a change (direct mode is never left silent).
# Measured 2026-11-17 on two Cube Lites, streams ended abruptly: frames 40 ms
# apart left a lamp stuck about 1 time in 5 (two frames reaching its LED part
# back to back cross the 1,024 bytes its serial link takes at once); 200 ms
# apart, 0 times in 50. Every LAN frame is shown at once and in full. The
# repeat stays under the 300 ms after which the lamp's network part sends
# again, in one block, every frame its LED part has not confirmed (old
# frames shown again; two or more cross the 1,024 bytes): with frames
# 0.2-0.24 s apart that never happens mid-stream, only at a stream's end.
LITE_LAN_GAP = 0.2
LITE_LAN_RESEND = 0.2
# The rate LITE_LAN_GAP is the gap of (frames a second).
LITE_LAN_GAP_FPS = 5
# The user's limit, per lamp (number "Stream frame rate limit", the light's
# _lite_stream_fps, LITE_STREAM_FPS_DEFAULT when not set): new pictures
# this many times a second over time (stream_routes.LanPacer). At 5 and under
# every frame goes one gap after the one before, the new picture, else the
# last one again: one steady rhythm of exactly the limit (a 0.2 s repeat
# between new pictures made every limit 5 frames a second on the lamp, which
# hung Cube Lites set to 1 a second on 2026-11-20). Never a new picture right
# after a repeat: 120 ms apart (3 a second, 2026-11-19) hung a Cube Lite
# within minutes, four times in a row. Above 5 frames come closer
# than the 0.2 s measured safe (the user's experiment; the top Lite hung
# every 10-20 min at 8-12 a second; 2026-11-20 night, 5 a second hung both
# Cube Lites within 100 min, 2 and 3 a second never in 12 lamp-hours).
LITE_STREAM_FPS_MIN = 1
LITE_STREAM_FPS_MAX = 25
# After a frame could not be sent, the stream waits this long before the
# next try (a lamp that went away is not asked 25 times a second).
STUDIO_RETRY_SECONDS = 2.0
# While the lamp cannot take frames (no UDP connection, or it left its last
# check unanswered), the stream looks again this often (s), not every frame:
# a frame resumes within this long once it can.
STUDIO_HOLD_SECONDS = 1.0
# A stream that ended on an error starts again after STUDIO_RETRY_SECONDS,
# twice as long after each crash in a row, up to this long (s).
STUDIO_RESTART_MOST = 60.0
# The previews (the cameras, the cards: streamed_preview_frame) show the
# stream's last frame sent while it is this recent (s); else their own
# drawing of the effect.
STREAM_PREVIEW_FRESH = 1.0
# A streamed Cube Lite is asked every this long (s) for an answer of its own
# (LampClient.probe, set_scene keep): frames are never answered, so a lamp
# that stopped answering mid-stream (its LAN part stuck, only a power cycle
# helps) was not seen: 2026-11-14, one stayed "on" in Home Assistant for
# minutes. Unanswered: frames pause, the problem check runs (the Repair and
# the Power cycle sensor, issues.py), and the stream goes on once it answers.
# Every 5 minutes, not 30 s: each check holds the frames 0.2 s and has the
# lamp's LED part answer mid-stream, and checks during a stream are what hung
# the far Cube Lite in tests (2026-11-15: every 15 s, 4 hangs in 14 min; rare
# checks, none in 20 min). 2026-11-19 it still hung after 44 min of frames an
# even 0.2 s apart with a check every 30 s. A lamp that stops answering is
# reported up to 5 minutes later.
STUDIO_PROBE_SECONDS = 300.0
# While it is silent, it is asked again this often: an answer lost on Wi-Fi
# must not leave a working lamp without frames for STUDIO_PROBE_SECONDS.
STUDIO_SILENT_PROBE_SECONDS = 5.0
# Frames pause only after this many checks in a row went unanswered (about
# STUDIO_PROBE_SECONDS + 2 x STUDIO_SILENT_PROBE_SECONDS); the frames go on
# through a lost answer or two. A pause is the end of a stream, and stream
# ends are when a Cube Lite has hung (2026-11-15: every hang found at a
# stream's end, 10 of 57 ends; none during a stream): on the far lamp one
# answer in ~30 is lost, and each lost one used to pause the stream and so
# risk a hang. A lamp that really hangs gets frames meanwhile, which is
# harmless, and is reported ~10 s later than with 1.
STUDIO_SILENT_AFTER = 3
# A Cube Lite's LED part can stop taking frames mid-stream while its network
# part still answers everything it answers itself (filmed 2026-11-20: the
# picture froze 1.5 to 2.5 minutes before the network part restarted, and
# only then were frames refused). Over Matter the network part asks the LED
# part (light_matrix.matter_controller_check): "stuck" within a second. So
# while streaming it is asked this often, and a lamp found stuck twice in a
# row (STREAM_LED_CONFIRM_SECONDS apart) gets no more frames and is brought
# back over the LAN at once (light_link_recovery), inside the window where
# that works (2026-11-16: brought back before its network part restarted;
# never after). Lamps without Matter: the LAN check above only.
STREAM_LED_CHECK_SECONDS = 10.0
STREAM_LED_CONFIRM_SECONDS = 2.0
# Seconds without frames before the recovery starts: the network part's
# own re-sends of unconfirmed frames (3, 300 ms apart) are over by then, and
# each of them could move the offset the recovery looks for.
STREAM_RECOVERY_QUIET = 2.0


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
        # Off, but still streaming, black (Keep Streaming When Off,
        # light_onoff): the effect's place is kept for when it is turned on.
        self._studio_standby = False
        # A Cube Lite's stream frame rate limit (number "Stream frame rate limit").
        self._lite_stream_fps = LITE_STREAM_FPS_DEFAULT

    def _lite_lan_gap(self) -> float:
        """The least time between two new pictures on a Cube Lite's LAN
        stream: LITE_LAN_GAP at LITE_LAN_GAP_FPS, scaled by its frame rate
        limit."""
        fps = getattr(self, "_lite_stream_fps", None) or LITE_STREAM_FPS_DEFAULT
        fps = max(LITE_STREAM_FPS_MIN, min(LITE_STREAM_FPS_MAX, float(fps)))
        return LITE_LAN_GAP * LITE_LAN_GAP_FPS / fps

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
            and (self._is_on or self._studio_standby)
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
        color accuracy, the power limit), in the same executor job
        (_drawn_payload). Like the lamp's own effects it takes no color
        adjustment."""
        run = self.hass.async_add_executor_job
        if self.device_profile.streams_effects:
            frame, payload = await run(self._drawn_payload, self._own_effect_frame, render)
            self._studio_rendered = (frame, not self.device_profile.raw_colours)
            return payload
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
            frame, payload = await run(
                self._drawn_payload, studio_clock_frame, effect, render,
                self._native_effect_speed, self._chosen_effect_intensity(), palette, direct,
                dt_util.now(), clock_content(self),
                bool(self._native_clock_12_hour),
                bool(self._native_clock_colon_blink),
                clock_digit_flags(mixer, direct), bool(getattr(self, "lamp_turns_clock", False)),
                colours, self._studio_seed,
            )
            self._studio_rendered = (frame, True)
            return payload
        if not studio_runs(self._native_effect, self._native_effect_color_mode, palette):
            # An effect the Cube Lite can't run itself, in its own colours
            # (raw: the lamp converts a stream's pixels).
            frame, payload = await run(self._drawn_payload, self._own_effect_frame_raw, render)
            self._studio_rendered = (frame, False)
            return payload
        # From the effect's very first render, as the lamp starts its own
        # (Building Blocks on an empty panel), not where a preview starts.
        frame, payload = await run(
            self._drawn_payload, studio_frame_at, self._native_effect, render,
            self._native_effect_direction, self._native_effect_speed,
            self._device_orientation, self._chosen_effect_intensity(), palette, True,
        )
        self._studio_rendered = (frame, True)
        return payload

    def _drawn_payload(self, draw, *args) -> tuple[list, str]:
        """In the executor: the frame ``draw(*args)`` draws (lamp order,
        lamp_core.drawn_in_full), and that frame as update_leds takes it,
        after the brightness stages and the power limit."""
        frame = drawn_in_full(draw, *args)
        return frame, encode_rgb_frame(self._lamp_frame(self._brightness_stages(frame)))

    def _own_effect_frame(self, render: int) -> list:
        """What a Cube Lite would show now for the selected effect or clock,
        for a lamp that has no effects of its own on the LAN (Cube Matrix),
        in raw colours when it converts them itself (device_profile), on the
        columns it shows (device_profile.columns)."""
        width = self._panel_width()
        if self.device_profile.raw_colours:
            with raw_colours():
                return fit_frame(self._own_effect_frame_drawn(render), width)
        return fit_frame(self._own_effect_frame_drawn(render), width)

    def _own_effect_frame_raw(self, render: int) -> list:
        """_own_effect_frame_drawn in raw colours (a stream's pixels)."""
        with raw_colours():
            return fit_frame(self._own_effect_frame_drawn(render), self._panel_width())

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
        # The lamp's frame (device_profile.pixels: its width x 5).
        frame = [(0, 0, 0)] * self.device_profile.pixels
        if self._mode != MODE_CLOCK:
            return frame
        text, colon_visible = clock_text(dt_util.now(), clock_content(self),
                                         bool(self._native_clock_12_hour),
                                         bool(self._native_clock_colon_blink))
        colour = self._resolve_native_clock_color(self._clock_style()) or 0xFFFFFF
        rgb = ((colour >> 16) & 255, (colour >> 8) & 255, colour & 255)
        # On the lamp's blocks only (a Spot shows the background:
        # clock_face.clock_geometry), centred across them.
        for index, _char, _col in clock_digit_pixels(
            text, colon_visible, 0, False, **clock_geometry(self.device_profile),
        ):
            if index < len(frame):
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
        self._lamp_client.stream_changes_only = self._skips_unchanged_frames()
        self._studio_last_sent = None
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
        self._studio_resume_origin(loop.time())
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
        if payload is not None:
            self._studio_last_sent = ("LAN", self._studio_key, payload)
            self._publish_stream_frame()
        self._last_fx_mode_time = time.time()
        self._native_effect_streamed()
        self._run_studio_loop("LAN")

    def _studio_resume_origin(self, now: float) -> None:
        """The stream's clock set so that a frame due at ``now`` (the event
        loop's clock) shows the render after the last one shown."""
        self._studio_origin = now - (self._studio_last_render + 1) * STUDIO_FRAME_SECONDS

    async def _start_matrix_stream(self) -> bool:
        """A Cube Matrix's stream over Matter (light_matrix): its first
        frame as the lamp's drawing, then the stream. False when Matter
        failed: the caller streams over the LAN."""
        loop = asyncio.get_running_loop()
        self._studio_resume_origin(loop.time())
        try:
            pixels = await self._matrix_stream_pixels(self._studio_render_at(loop.time()))
            await self._send_matrix_stream_frame(pixels)
        except Exception as err:  # noqa: BLE001 -- streamed over the LAN instead
            _LOGGER.warning(
                "[STUDIO] [%s] First frame over Matter failed (%s): streamed over the LAN", self._ip, err,
            )
            self._refuse_matrix_native()
            return False
        self._studio_last_sent = ("Matter", self._studio_key, pixels)
        self._publish_stream_frame()
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
    def _studio_routes(self, loop) -> tuple:
        """The stream's routes (stream_routes): over Matter (a Cube Matrix's
        drawing, light_matrix: every render) and over the LAN. A lamp that
        shows fewer frames a second over the LAN (device_profile.max_fps,
        the Cube Matrix) is sent every n-th render there: the effect keeps
        its speed. A Cube Lite's LAN frames are paced (LanPacer)."""
        lan_step = STUDIO_FRAME_SECONDS * studio_stride(getattr(self.device_profile, "max_fps", None))
        pacer = None if getattr(self, "is_cube_matrix", False) else LanPacer(LITE_LAN_RESEND, STUDIO_FRAME_SECONDS)
        return (
            MatterStreamRoute(self, STUDIO_FRAME_SECONDS),
            LanStreamRoute(self, lan_step, LAMP_ERRORS, loop.time, pacer),
        )

    async def _studio_loop(self) -> None:
        """A frame every route step while studio_streaming, never while
        another command holds the lamp, and only over UDP or Matter. Each
        frame is drawn before it is due, then sent when it is: the frames
        leave evenly, each the next render."""
        loop = asyncio.get_running_loop()
        lock = _get_device_lock(self._ip)
        # From the first frame's moment (_start_studio_stream): the next is
        # the next render.
        due = self._studio_origin + self._studio_last_render * STUDIO_FRAME_SECONDS
        held = False  # frames were not sent (TCP, an error): direct mode again
        over_matter = getattr(self, "matrix_streams_over_matter", None)
        matter_route, lan_route = self._studio_routes(loop)
        diag = StreamDiag(self._ip, _LOGGER, self.stream_report)
        # The transport keeps pauses in frames busy while the stream runs
        # (LampClient.stream_running): a slow or failed render never leaves
        # a Cube Lite silent mid-stream.
        self._lamp_client.stream_running("studio", True)
        render_failed = False  # logged once per stream
        crashed = False
        self._studio_started_at = time.time()  # stream_report
        standing_by = False
        last_sent = getattr(self, "_studio_last_sent", None)
        try:
            while self.studio_streaming():
                route = matter_route if over_matter is not None and over_matter() else lan_route
                client = self._lamp_client
                # Skip Unchanged Stream Frames: changed frames only, none sent
                # again between them (not the black standby frames).
                changes_only = self._skips_unchanged_frames() and self._is_on
                # A Cube Lite paced over the LAN: the stream sends again itself
                # (LITE_LAN_RESEND), not the transport every 40 ms.
                client.stream_changes_only = changes_only or route.paced
                diag.status(loop.time(), (
                    route.name, client.transport, client.is_connected(),
                    getattr(client, "stream_silent", False), changes_only, self._studio_key,
                ))
                due += route.step
                if loop.time() - due > route.step:
                    due = loop.time()  # late (a busy host): no catching up
                on = self._is_on
                if not on:
                    # Off on standby: black frames, the effect held where it was.
                    standing_by = True
                    payload = route.standby()
                    render = self._studio_last_render
                else:
                    if standing_by:
                        # On again: from the frame after the last one shown.
                        standing_by = False
                        self._studio_resume_origin(due)
                    render = self._studio_render_at(due)
                draw_started = loop.time()
                if on:
                    try:
                        payload = await route.draw(render)
                    except Exception:  # noqa: BLE001 -- a renderer's bug must not end the stream
                        diag.count("errors")
                        if not render_failed:
                            render_failed = True
                            _LOGGER.exception(
                                "[STUDIO] [%s] Frame %d could not be drawn: the lamp keeps the last "
                                "one, drawing is tried again", self._ip, render,
                            )
                        due = loop.time() + STUDIO_RETRY_SECONDS
                        await asyncio.sleep(STUDIO_RETRY_SECONDS)
                        continue
                diag.rendered(loop.time() - draw_started)
                wait = due - loop.time()
                if wait > 0:
                    await asyncio.sleep(wait)
                if not self.studio_streaming():
                    break
                if lock.locked():
                    diag.count("locked")
                    continue  # another command goes first
                # Free: taken at once (nothing runs in between).
                async with lock:
                    if route.unavailable():
                        diag.count("unavailable")
                        held = True
                        due = loop.time() + STUDIO_HOLD_SECONDS
                        continue
                    candidate = (route.name, self._studio_key, payload)
                    try:
                        skipped = await route.pace(candidate, last_sent, held, changes_only)
                        if skipped is not None:
                            diag.count(skipped)
                            continue
                        send_started = loop.time()
                        await route.send(payload, held)
                    except route.errors as err:  # tried again shortly
                        diag.failed(route.name, client.transport, err)
                        held = True
                        route.failed()
                        due = loop.time() + STUDIO_RETRY_SECONDS
                        continue
                    held = False
                    diag.submitted(loop.time() - send_started)
                    last_sent = candidate
                    if on:
                        self._publish_stream_frame()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- restarted below
            crashed = True
            _LOGGER.exception("[STUDIO] [%s] The stream stopped on an error: started again", self._ip)
        finally:
            self._lamp_client.stream_changes_only = False
            self._studio_last_sent = None
            diag.stopped(crashed)
            self._lamp_client.stream_running("studio", False)
            _LOGGER.debug("[STUDIO] [%s] Stream stopped", self._ip)
            if not crashed:
                self._studio_stream_ended()
        if crashed:
            await self._restart_studio_loop()
        else:
            self._studio_crashes = 0

    def _studio_stream_ended(self) -> None:
        """The stream is over: standby off, and no task when it was this one."""
        self._studio_standby = False
        if asyncio.current_task() is self._studio_task:
            self._studio_task = None

    async def _restart_studio_loop(self) -> None:
        """After a crash, while still selected: the stream goes on after
        STUDIO_RETRY_SECONDS (a frame's error, not the selection, ended it),
        twice as long after each crash in a row, up to STUDIO_RESTART_MOST:
        a bug that ends every stream at once never restarts it in a tight
        loop. Meanwhile this task stays the stream's (stop_studio_stream
        cancels it, Keep Streaming When Off still holds: the standby stream
        comes back black), and the stream goes on from the render after the
        last one shown, not as far on as the wait."""
        crashes = self._studio_crashes
        self._studio_crashes = crashes + 1
        restarted = False
        try:
            await asyncio.sleep(min(STUDIO_RESTART_MOST, STUDIO_RETRY_SECONDS * 2 ** crashes))
            if asyncio.current_task() is self._studio_task:
                self._studio_task = None
            if self._studio_task is None and self.studio_streaming():
                self._studio_resume_origin(asyncio.get_running_loop().time())
                self._run_studio_loop("its route, after an error")
                restarted = True
        finally:
            if not restarted:
                if asyncio.current_task() is self._studio_task:
                    self._studio_task = None
                if self._studio_task is None:
                    self._studio_standby = False

    # ── The stream's frames for the previews ───────────────────────────
    def _publish_stream_frame(self) -> None:
        """The frame just sent (_studio_rendered: lamp order, before the
        brightness stages and the power limit) for the previews, in the
        colours they show: an effect the lamp's renderers draw is LED drive,
        shown as those LEDs look (led_appearance, as the camera shows its own
        drawing of it). Previews then show exactly what the lamp was sent,
        not their own drawing of the effect (its own start and seeds)."""
        rendered = getattr(self, "_studio_rendered", None)
        if rendered is None:
            return
        frame, drive = rendered
        if drive and self._preview_shows_drive():
            frame = [led_appearance(rgb) for rgb in frame]
        else:
            frame = [tuple(rgb[:3]) for rgb in frame]
        self._stream_preview = (time.monotonic(), frame)
        for listener in tuple(getattr(self, "_stream_preview_listeners", ())):
            try:
                listener(frame)
            except Exception:  # noqa: BLE001 -- a preview never stops the stream
                _LOGGER.debug("[STUDIO] [%s] A preview listener failed", self._ip, exc_info=True)

    def _preview_shows_drive(self) -> bool:
        """Whether the selected effect (or clock background) is one the
        lamp's renderers draw (as camera._shows_lamp_renderer)."""
        if getattr(self, "_music_flow_enabled", False):
            return False
        if self._mode == MODE_NATIVE_EFFECT:
            effect = self._native_effect
        elif self._mode == MODE_CLOCK:
            effect = clock_style_effect(self._clock_style())
        else:
            return False
        return effect in LAMP_RENDERED_EFFECTS

    def streamed_preview_frame(self) -> list | None:
        """The stream's last frame sent, as previews show it (lamp order,
        before their brightness boost), while it streams and the frame is
        recent (STREAM_PREVIEW_FRESH); None: previews draw the effect."""
        latest = getattr(self, "_stream_preview", None)
        if latest is None or not self._is_on or not self.studio_streaming():
            return None
        at, frame = latest
        if time.monotonic() - at > STREAM_PREVIEW_FRESH:
            return None
        return frame

    def add_stream_preview_listener(self, listener):
        """Call ``listener(frame)`` with every frame the stream sends (as
        streamed_preview_frame gives it); returns what stops it."""
        listeners = self.__dict__.setdefault("_stream_preview_listeners", set())
        listeners.add(listener)
        return lambda: listeners.discard(listener)

    def _standby_payload(self) -> str:
        """A black frame, as update_leds takes it (the standby stream)."""
        return encode_rgb_frame(self._lamp_frame([(0, 0, 0)] * self.device_profile.pixels))

    def keeps_streaming_when_off(self) -> bool:
        """Whether turning off now keeps the stream going, black (Keep
        Streaming When Off, on a Cube Lite streaming over the LAN)."""
        entry = self._config_entry
        task = self._studio_task
        return (
            entry is not None
            and bool(entry.options.get(CONF_KEEP_STREAMING_WHEN_OFF, False))
            and not getattr(self, "is_cube_matrix", False)
            and task is not None and not task.done()
        )

    def _skips_unchanged_frames(self) -> bool:
        """Skip Unchanged Stream Frames (a Cube Lite's switch): a frame the
        same as the last one sent is not sent, not even as the keep-alive
        repeat (one frame every 1/limit s). The lamp is then left without frames while
        the picture holds still: a Cube Lite left so for more than about
        0.8 s saves what it shows, and a stream's pauses are when Cube Lites
        have hung (docs/STREAMING.md). Off by default."""
        entry = getattr(self, "_config_entry", None)
        return (
            entry is not None
            and bool(entry.options.get(CONF_SKIP_UNCHANGED_FRAMES, False))
            and not getattr(self, "is_cube_matrix", False)
        )

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
        STUDIO_SILENT_PROBE_SECONDS while it is silent. Silent:
        stream_silent (the effect stream pauses), the problem check runs
        (_stream_probe). Every STREAM_LED_CHECK_SECONDS, its LED part is
        asked over Matter (_stream_led_stuck): stuck, the frames stop and the
        lamp is brought back over the LAN at once (_stream_recover_now). Not
        while the lamp is being brought back over the LAN
        (light_link_recovery: that sweep asks it)."""
        matrix = self._lamp_client
        lock = _get_device_lock(self._ip)
        loop = asyncio.get_running_loop()
        misses = 0  # checks unanswered in a row
        probe_at = loop.time() + STUDIO_PROBE_SECONDS
        led_check_at = loop.time() + STREAM_LED_CHECK_SECONDS
        try:
            while self.hass is not None and matrix.streams_running:
                await asyncio.sleep(max(0.0, min(probe_at, led_check_at) - loop.time()))
                if not matrix.streams_running:
                    break
                if loop.time() >= probe_at:
                    # A lamp that missed a check is asked again soon, also
                    # once the LAN recovery that skips this turn is over:
                    # else a lamp power-cycled meanwhile goes without frames
                    # for minutes.
                    probe_at = loop.time() + (STUDIO_SILENT_PROBE_SECONDS if misses else STUDIO_PROBE_SECONDS)
                    if not getattr(self, "_link_recovery_running", False):
                        # Whatever the transport: a stuck lamp's UDP session
                        # fails and the stream falls back to TCP, holding its
                        # frames, while the lamp still accepts connections --
                        # the connection's own check, which only connects,
                        # does not see it (2026-11-16). The probe asks the
                        # lamp itself, over TCP too (one command per check,
                        # far within its TCP quota).
                        answered = await self._stream_probe(misses, lock)
                        misses = 0 if answered else misses + 1
                        # Frames go on through a lost answer or two (STUDIO_SILENT_AFTER).
                        matrix.stream_silent = misses >= STUDIO_SILENT_AFTER
                        probe_at = loop.time() + (STUDIO_SILENT_PROBE_SECONDS if misses else STUDIO_PROBE_SECONDS)
                if loop.time() >= led_check_at:
                    led_check_at = loop.time() + STREAM_LED_CHECK_SECONDS
                    if (
                        not getattr(self, "_link_recovery_running", False)
                        and not matrix.stream_silent
                        and await self._stream_led_stuck()
                        and matrix.streams_running
                    ):
                        # As after STUDIO_SILENT_AFTER unanswered checks: no
                        # frames until the lamp answers on the LAN again.
                        misses = max(misses, STUDIO_SILENT_AFTER)
                        matrix.stream_silent = True
                        await self._stream_recover_now()
                        probe_at = loop.time() + STUDIO_SILENT_PROBE_SECONDS
        finally:
            matrix.stream_silent = False
            if asyncio.current_task() is self._stream_watchdog_task:
                self._stream_watchdog_task = None

    async def _stream_led_stuck(self) -> bool:
        """Whether the streamed lamp's LED part is stuck, asked over Matter
        (light_matrix.matter_controller_check) twice, STREAM_LED_CONFIRM_SECONDS
        apart: "stuck" both times. False without Matter, or for any other
        answer (a network part that does not answer may be restarting: the
        LAN check covers it)."""
        check = getattr(self, "matter_controller_check", None)
        if check is None:
            return False
        for attempt in range(2):
            if attempt:
                await asyncio.sleep(STREAM_LED_CONFIRM_SECONDS)
            asked = time.monotonic()
            try:
                verdict = await check()
            except Exception as err:  # noqa: BLE001 -- a check never ends the stream
                _LOGGER.debug("[STUDIO] [%s] Matter check failed: %s", self._ip, err)
                return False
            _LOGGER.debug(
                "[STREAM DIAG] [%s] Matter check of the LED part: %s in %.0f ms", self._ip, verdict,
                (time.monotonic() - asked) * 1000,
            )
            if verdict != "stuck":
                return False
        return True

    async def _stream_recover_now(self) -> None:
        """The streamed lamp's LED part stopped answering (_stream_led_stuck):
        the frames have stopped (stream_silent); after STREAM_RECOVERY_QUIET
        the lamp is brought back over the LAN at once
        (light_link_recovery._link_recovery_now), before its network part
        restarts."""
        _LOGGER.warning(
            "[STUDIO] [%s] Over Matter, the streamed lamp's LED part stopped answering: frames "
            "stopped, bringing it back over the LAN now. %s", self._ip, self.stream_report(),
        )
        if cancel := getattr(self._lamp_client, "_cancel_frame_settle", None):
            cancel()
        await asyncio.sleep(STREAM_RECOVERY_QUIET)
        if start := getattr(self, "_link_recovery_now", None):
            start()

    def stream_report(self) -> str:
        """What streams and how it went, for the logs of a lamp that stopped
        answering: the effect or clock style, how long it streamed, and the
        transport's stream_stats (frames, gaps)."""
        try:
            if self._mode == MODE_CLOCK:
                what = f"clock style {getattr(self, '_native_clock_style', None)}"
            else:
                what = f"effect {getattr(self, '_native_effect', None)}"
            channel = getattr(self._lamp_client, "_udp", None)
            if channel is not None:
                # The public 'udp' transport also names the Cube Matrix's
                # TCP music channel: make the actual channel explicit.
                what += f", channel {type(channel).__name__}"
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

    async def _probe_streamed_lamp(self, lock=None) -> bool:
        """Whether the lamp itself answers (LampClient.probe, answering):
        asked in its UDP session under the lamp's ``lock`` (no frame goes
        with the question), then, unanswered, over TCP without the lock, so
        the frames go on meanwhile."""
        client = self._lamp_client
        session = getattr(client, "probe_session", None)
        tcp = getattr(client, "probe_tcp", None)
        if session is None or tcp is None:
            # A transport that asks in one step.
            if lock is None:
                return await client.probe(answering=True)
            async with lock:
                return await client.probe(answering=True)
        if lock is None:
            answered = await session()
        else:
            async with lock:
                answered = await session()
        return answered or await tcp()

    async def _stream_probe(self, misses: int = 0, lock=None) -> bool:
        """Whether the streamed lamp itself still answers (STUDIO_PROBE_SECONDS),
        after ``misses`` checks unanswered in a row (_probe_streamed_lamp:
        only its UDP question holds ``lock``). Unanswered: logged (INFO
        while frames go on, a WARNING once when they pause:
        STUDIO_SILENT_AFTER), and the problem check runs now (a lamp that
        accepts connections but answers nothing for a minute is reported
        stuck: issues.lamp_problems)."""
        probe_started = time.monotonic()
        try:
            answered = await self._probe_streamed_lamp(lock)
        except LAMP_ERRORS as err:  # taken as unanswered
            _LOGGER.debug("[STUDIO] [%s] Probe failed: %s", self._ip, err)
            answered = False
        verdict = None
        if not answered and (check := getattr(self, "matter_controller_check", None)):
            # Asked over Matter too (light_matrix): whether the lamp's LED
            # part answers there, for the log below.
            verdict = await check()
        _LOGGER.debug(
            "[STREAM DIAG] [%s] Probe answered=%s transport=%s elapsed_ms=%.1f misses_before=%d; %s",
            self._ip, answered, self._lamp_client.transport,
            (time.monotonic() - probe_started) * 1000, misses, self.stream_report(),
        )
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
                "(a lamp that stays silent needs a power cycle)%s. %s", self._ip,
                {
                    "stuck": "; over Matter its network part says the LED part does not answer",
                    "no answer": "; its network part does not answer over Matter either (restarting?)",
                }.get(verdict, ""),
                self.stream_report(),
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
