"""The palette color mode's stream (lamp_studio draws the frames).

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

Over TCP the lamp takes about one command a second (cube_matrix
TCP_COMMAND_INTERVAL): no stream. The lamp keeps the last frame meanwhile,
and the stream goes on once UDP answers again.
"""

from __future__ import annotations

import asyncio
import logging
import time

from homeassistant.util import dt as dt_util  # type: ignore

from .clock_face import clock_content, clock_digit_pixels, clock_text
from .const import (
    CLOCK_MIXER_EFFECTS,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT_INTENSITY,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    NATIVE_CLOCK_STYLES,
    clock_style_direct,
)
from .cube_matrix import encode_rgb_frame, trace_frame
from .lamp_renderers import clock_digit_flags
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


def studio_clock_frame(
    effect, render, speed, intensity, palette, direct, now, content, twelve_hour,
    colon_blink, digit_flags, turned,
) -> list:
    """A streamed clock's frame: its background ``effect`` in the palette
    (lamp_studio.studio_clock_background_at, from its first render) through
    the digits the clock shows at ``now`` (clock_face); dark elsewhere."""
    background = studio_clock_background_at(effect, render, speed, intensity, palette, direct, True)
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
        # What the stream's clock belongs to (effect, direction, mount), when
        # its render 0 was due (the event loop's clock) and the last render
        # sent (a stream started again, after a Freeze, goes on from it).
        self._studio_key: tuple | None = None
        self._studio_origin = 0.0
        self._studio_last_render = -1

    # ── What runs ──────────────────────────────────────────────────────
    def _clock_style(self) -> dict:
        return NATIVE_CLOCK_STYLES.get(
            int(getattr(self, "_native_clock_style", DEFAULT_NATIVE_CLOCK_STYLE)),
            NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
        )

    def studio_selected(self) -> bool:
        """Whether what is selected is streamed (lamp_studio.studio_runs,
        clock_studio_runs): the lamp then gets a stream, not its own
        effect or clock."""
        palette = getattr(self, "_text_colors", None)
        if self._mode == MODE_NATIVE_EFFECT:
            return studio_runs(self._native_effect, self._native_effect_color_mode, palette)
        if self._mode == MODE_CLOCK:
            return clock_studio_runs(
                CLOCK_MIXER_EFFECTS.get(self._clock_style().get("mixer", 0)),
                getattr(self, "_native_clock_color_mode", None), palette,
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
            and not getattr(self, "_external_display", False)
            and not self._display_frozen
            and not self._in_native_fw_mode
        )

    def _studio_render_at(self, due: float) -> int:
        """The render a frame due at ``due`` (the event loop's clock) shows:
        one more for each frame, whatever the moment it is drawn or sent, so
        no render is shown twice or skipped. It starts again from 0 when the
        effect (or clock style), its direction or the mount changes."""
        key = (
            ("clock", getattr(self, "_native_clock_style", None)) if self._mode == MODE_CLOCK
            else ("effect", self._native_effect, self._native_effect_direction),
            self._device_orientation,
        )
        if key != self._studio_key:
            self._studio_key = key
            self._studio_origin = due
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
        palette = [list(colour) for colour in getattr(self, "_text_colors", None) or ()]
        if self._mode == MODE_CLOCK:
            style = self._clock_style()
            mixer = style.get("mixer", 0)
            direct = clock_style_direct(style)
            frame = await self.hass.async_add_executor_job(
                studio_clock_frame, CLOCK_MIXER_EFFECTS.get(mixer), render,
                self._native_effect_speed, self._chosen_effect_intensity(), palette, direct,
                dt_util.now(), clock_content(self),
                bool(getattr(self, "_native_clock_12_hour", False)),
                bool(getattr(self, "_native_clock_colon_blink", False)),
                clock_digit_flags(mixer, direct), bool(getattr(self, "lamp_turns_clock", False)),
            )
            return encode_rgb_frame(self._lamp_frame(self._brightness_stages(frame)))
        # From the effect's very first render, as the lamp starts its own
        # (Building Blocks on an empty panel), not where a preview starts.
        frame = await self.hass.async_add_executor_job(
            studio_frame_at, self._native_effect, render,
            self._native_effect_direction, self._native_effect_speed,
            self._device_orientation, self._chosen_effect_intensity(), palette, True,
        )
        return encode_rgb_frame(self._lamp_frame(self._brightness_stages(frame)))

    def _chosen_effect_intensity(self) -> int:
        """The intensity chosen for the effects, which lamp_settings gives
        only to those that read it (as the camera's preview does)."""
        return int(getattr(self, "_native_effect_intensity", DEFAULT_NATIVE_EFFECT_INTENSITY))

    # ── Start ──────────────────────────────────────────────────────────
    async def _start_studio_stream(self) -> None:
        """Stream the selected effect or clock (light_native._activate_native_effect
        and _activate_native_clock, under the lamp's lock): direct mode, the brightness, the first frame,
        then the stream. While a stream already runs, it already shows what
        is selected (each frame reads the settings): nothing to do."""
        if claim := getattr(self, "_claim_display", None):
            claim()
        if self._studio_task is not None and not self._studio_task.done() and self._fx_mode_is_direct:
            self._native_effect_streamed()
            return
        leaving_native = self._in_native_fw_mode
        if note_power := getattr(self, "_expect_lamp_power", None):
            note_power(True)
        # Activated each time a stream starts: the lamp may have been powered
        # off (turn_off in an effect) or have run its own effect since.
        await self.ensure_fx_ready()
        level = hardware_brightness_for(self._brightness)
        if level != self._last_hardware_brightness:
            await self._cube_matrix.send_command_fast("set_bright", [level])
            self._last_hardware_brightness = level
        loop = asyncio.get_running_loop()
        # Where it was (after a Freeze, or back from another display): on
        # from the next render.
        self._studio_origin = loop.time() - (self._studio_last_render + 1) * STUDIO_FRAME_SECONDS
        payload = await self._studio_payload(self._studio_render_at(loop.time()))
        trace_frame(self._ip, "studio: first frame", payload)
        await self._draw_direct(payload)
        if leaving_native:
            # The first frame can be dropped while the lamp leaves its own
            # renderer (light_display.apply does the same).
            await asyncio.sleep(ACTIVATION_TIMING[self._cube_matrix.transport]["native_exit_resend"])
            await self._draw_direct(payload)
        self._last_fx_mode_time = time.time()
        self._native_effect_streamed()
        if self._studio_task is None or self._studio_task.done():
            self._studio_task = self._create_tracked_task(
                self._studio_loop(), name=f"yeelight_cube_studio_{self._ip}"
            )
            _LOGGER.debug("[STUDIO] [%s] Streaming %s", self._ip, self._native_effect)

    def _native_effect_streamed(self) -> None:
        """The lamp shows the selected effect through the stream: on, in
        direct mode, not running a renderer of its own."""
        self._is_on = True
        self._fx_mode_is_direct = True
        self._in_native_fw_mode = False
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
        try:
            while self.studio_streaming():
                due += STUDIO_FRAME_SECONDS
                if loop.time() - due > STUDIO_FRAME_SECONDS:
                    due = loop.time()  # late (a busy host): no catching up
                payload = await self._studio_payload(self._studio_render_at(due))
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
                    if self._cube_matrix.transport != "udp" or not self._cube_matrix.is_connected():
                        held = True
                        continue
                    try:
                        if held or not self._direct_mode_trusted():
                            await self.ensure_fx_ready()
                            held = False
                        await self._cube_matrix.send_command_fast("update_leds", [payload])
                    except Exception as err:  # noqa: BLE001 -- tried again shortly
                        _LOGGER.debug("[STUDIO] [%s] Frame not sent (%s)", self._ip, err)
                        held = True
                        self._fx_mode_is_direct = False
                        due = loop.time() + STUDIO_RETRY_SECONDS
        finally:
            _LOGGER.debug("[STUDIO] [%s] Stream stopped", self._ip)
            if asyncio.current_task() is self._studio_task:
                self._studio_task = None

    def stop_studio_stream(self) -> None:
        """Stop the stream now (entity removal); otherwise it stops by
        itself at its next frame (studio_streaming)."""
        task, self._studio_task = self._studio_task, None
        if task is not None and not task.done():
            task.cancel()
