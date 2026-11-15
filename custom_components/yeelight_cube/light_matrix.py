"""A Cube Matrix's own effects, clock and drawings over Matter, and what its
Matter link reports (device_profile, matrix_effects).

A Cube Matrix shared to Home Assistant's Matter server (its node linked,
matter_link, and the server delivering Yeelight commands, matter_commands)
shows these itself, smoothly, instead of a 5-frames-a-second LAN stream:

- the 13 effects the Yeelight app offers for it, in their own colours or
  one colour (the effect's custom colour, or a one-colour palette);
- its 35 other built-in effects the integration has too (Fireworks, Sunrise
  and sunset, Rainbow noise...: matrix_effects.ENGINE_MODES), in their own
  colours, the custom colour, or a palette of no more colours than they draw;
- the clock styles over a background it has (styles 1 to 14), in the
  Default color mode (or a one-colour palette on a plain style);
- drawings (pixel art, text, anything this integration draws), as its
  drawing effect, the pixels changed in place.

Everything else is still streamed (light_studio): over Matter too, as the
drawing's pixels changed for every frame (filmed 2026-11-11: about 45 setData
a second answered and nearly all shown, where the LAN shows at most ~6
frames a second), so an effect in a color mode the lamp lacks runs as
smoothly as its own. Everything is streamed over the LAN while Matter is not
available, or after a command was refused. Before anything over Matter the
LAN music connection is closed: while it is open the lamp answers Matter
commands but does not show them.

The demo loop (matrix_effects.DemoLoopWatch) replaces anything the lamp shows
itself within 30 s and is only left by a factory reset: while it is on,
nothing is sent over Matter (a LAN stream is not interrupted by it), and a
Repair says how to leave it. It is read over the LAN (get_prop
show_off_mode) and seen in the Matter reports.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import time

from .color_utils import argb_to_rgb
from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
)
from .effect_catalog import (
    ALL_NATIVE_EFFECTS,
    LITE_VERSIONS,
    NATIVE_CLOCK_CONTENT_BYTE,
    PALETTE_COLOR_MODE,
    effect_direction_value,
)
from .device_profile import CUBEMATRIX, TOPOLOGY_NAMES, TOPOLOGY_SLOTS, profile_for
from .input_error import InputError
from .lamp_core import drawn_in_full, raw_colours
from .lamp_renderers import palette_fits, palette_words
from .lamp_studio import studio_render
from .native_effect_preview import effect_supports_color_override
from .light_color import hardware_brightness_for
from .matrix_effects import (
    APPLY_PRIORITY,
    APPLY_SAVE,
    APPLY_SHOW,
    APP_DIRECTION_MODES,
    CLOCK_BACKGROUNDS,
    CLOCK_STYLE_COLOURS,
    DEFAULT_SPEED,
    CLOCK_EFFECT,
    DRAWING_EFFECT,
    DRAWING_MIXERS,
    ENGINE_MODES,
    MATRIX_EFFECTS,
    ONE_AXIS_APP_EFFECTS,
    ONE_AXIS_MODES,
    RESEND_AFTER,
    RESEND_MODES,
    DemoLoopWatch,
    clock_payload,
    colour_word,
    drawing_payload,
    engine_payload,
    live_change,
    matrix_direction,
    preset_payload,
    set_data_payload,
)
from .matter_commands import CUBE_CONTROL_CLUSTER, EFFECTS_CLUSTER
from .matter_link import START_UP_ON_OFF
from .mount_profile import LOW_PAIR, compensate_direction, effective_profile, one_axis_direction
from .music_channel import tcp_request

_LOGGER = logging.getLogger(__name__)

# After the music connection is closed, before a Matter effect (the lamp
# leaves music mode).
MUSIC_CLOSE_SETTLE = 0.3
# Reports this long after a command are its echo.
MATRIX_ECHO_WINDOW = 5.0
# A restart and the effect the lamp starts with are reported together, in
# either order (2026-11-11: both ~110 s after power-on, when Home Assistant's
# Matter server reached the lamp again): within this, that effect is the
# lamp's start-up, not its button.
MATRIX_RESTART_WINDOW = 15.0
# Back after an outage, content shown over Matter is redrawn when the lamp's
# restart is reported; without that report (a Wi-Fi drop: the lamp still
# shows it, or no report) it is redrawn after this long anyway (s).
MATRIX_RESTART_FALLBACK = 240.0
# A frozen clock's frame is drawn again (when it changed) on these seconds:
# even ones, the colon lit when it blinks (s).
FROZEN_CLOCK_TICK = 2.0
# Frames of a stream over Matter that failed one after the other before the
# stream goes over the LAN (until Matter is tried again).
MATTER_STREAM_FAILURES = 3
# After Matter failed (a command, or the stream's frames), what is selected is
# streamed over the LAN, and Matter tried again (_retry_matrix_native) after
# this long (s), twice as long after each failure in a row, up to the most;
# at once when the Matter link comes back, but not sooner than the least.
# A Matter server restarting with Home Assistant, or the network going down
# for a while, must not leave the lamp streamed for good.
MATTER_RETRY_FIRST = 60.0
MATTER_RETRY_MOST = 30 * 60.0
MATTER_RETRY_LEAST = 10.0
# How often the demo mode is read again over the LAN (s).
DEMO_READ_INTERVAL = 30 * 60
# The clock needs this many Matrix modules (topology type 2).
CLOCK_MODULES = 4
MATRIX_MODULE = 2


def _sent_effect_id(name: str, payload: dict) -> int | None:
    """The effect id a command has the lamp run (what it then reports)."""
    if name == "setPresetsEffect":
        return payload.get("effectId")
    params = ((payload.get("effect") or {}).get("effectParams") or [{}])[0]
    return params.get("mode")


def matrix_effect_name(running: int) -> str | None:
    """The integration's name of an effect the lamp reports running (its
    FC03 attribute): one of the app's 13, else a built-in it starts by id."""
    for name, spec in MATRIX_EFFECTS.items():
        if spec[0] == running:
            return name
    if running not in ENGINE_MODES:
        return None
    for name, spec in ALL_NATIVE_EFFECTS.items():
        if spec.get("mode") == running and not spec.get("animation") and not spec.get("hidden"):
            # What it draws for that slot: its own version, where it has one.
            return LITE_VERSIONS.get(name, name)
    return None



# The lamp's brightness over Matter: Level Control on its light's endpoint
# (matter_link.LEVEL), 1-254 for set_bright's 1-100 %.
LEVEL_CONTROL_CLUSTER = 0x0008
LEVEL_ENDPOINT = 1


def matter_level(percent: int) -> int:
    """Matter's level (1-254) for set_bright's ``percent`` (1-100)."""
    return max(1, min(254, round(int(percent) * 254 / 100)))

class MatrixSettingUnavailable(Exception):
    """A Cube Matrix setting that needs its Matter link (the translation key
    of the error the service raises: strings.json "exceptions")."""


class MatrixMixin:
    """A Cube Matrix's Matter features (see the module docstring)."""

    def _init_matrix_state(self) -> None:
        """Called by YeelightCubeLight.__init__."""
        # A Matter command was refused since the selection was activated:
        # streamed instead until the next activation, or until Matter is
        # tried again (_retry_matrix_native: when, how long it waits next).
        self._matrix_native_refused = False
        self._matrix_refused_at = 0.0
        self._matrix_retry_after = MATTER_RETRY_FIRST
        # What the lamp shows itself (the Matter command and its payload),
        # None when it shows a stream, a LAN frame or something of its own.
        self._matrix_shown: tuple[str, dict] | None = None
        self._matrix_command_at = -MATRIX_ECHO_WINDOW
        # The effect id Home Assistant last had the lamp run (its reports of
        # it, which can come late, are not someone else's change).
        self._matrix_sent_id: int | None = None
        # The demo loop: read over the LAN (None: not read; first when the
        # lamp was set up, LampClient.set_model), seen over Matter.
        demo = (getattr(self._lamp_client, "capabilities", None) or {}).get("show_off_mode")
        self._matrix_demo_lan: bool | None = demo == "1" if demo in ("0", "1") else None
        self._matrix_demo_matter = False
        self._matrix_demo_watch = DemoLoopWatch()
        self._matrix_demo_read_at: float | None = (
            time.monotonic() if self._matrix_demo_lan is not None else None
        )
        self._matrix_demo_task = None
        # A drawing's animation on the lamp (matrix_effects.DRAWING_MIXERS:
        # the Drawing animation select and speed number).
        self._matrix_drawing_mixer = 0
        self._matrix_drawing_speed = DEFAULT_SPEED
        self._matrix_drawing_direction = 0
        # Frames of the stream over Matter that failed in a row.
        self._matrix_stream_failures = 0
        # What the lamp does at power-on (Matter StartUpOnOff: "on" or "off";
        # the Power-on behavior select), as it reports it.
        self._matrix_power_on = "on"
        # The lamp's reboot count (Matter): a change is a restart, however
        # short the power cut. When it was seen, and the light's content
        # before the last effect followed (undone when that was the lamp's
        # start-up effect).
        self._matrix_reboots: int | None = None
        self._matrix_restarted_at = -MATRIX_RESTART_WINDOW
        self._matrix_followed_from: tuple[float, str, str | None] | None = None
        # The Device Orientation before the lamp's rotation was last followed
        # (when, and which): one it reported just before its restart was its
        # saved one coming back, not the app's (_matrix_lamp_restarted).
        self._matrix_turned_from: tuple[float, str] | None = None
        # The health check left the redraw to the restart report (or the
        # fallback task), after an outage.
        self._matrix_redraw_due = False
        self._matrix_fallback_task = None
        self._matrix_restart_seen = False
        # While a clock is frozen: its digits drawn again as they change.
        self._matrix_freeze_task = None

    # ── What the lamp can show itself ───────────────────────────────────
    @property
    def is_cube_matrix(self) -> bool:
        return self.device_profile.key == CUBEMATRIX

    @property
    def matrix_factory_modules(self) -> bool:
        """The lamp still has its factory module list: its clock cannot
        show and its rotation says nothing of how it is mounted (the
        factory_modules repair)."""
        return self.is_cube_matrix and self.device_profile.factory_modules

    @property
    def matrix_demo_mode(self) -> bool:
        """The lamp's demo loop is on (read over the LAN, or seen)."""
        return self.is_cube_matrix and bool(self._matrix_demo_lan or self._matrix_demo_matter)

    def matrix_matter_ready(self) -> bool:
        """A Cube Matrix whose Matter node is linked, a server delivers its
        Yeelight commands, and the demo loop is off."""
        if not self.is_cube_matrix or self.matrix_demo_mode:
            return False
        link, channel = self._matter, self._matter_commands
        return bool(link is not None and link.linked and channel is not None and channel.backend)

    def matrix_native_command(self) -> tuple[str, dict] | None:
        """The Matter command (name, payload) that shows the selected effect
        or clock on the lamp itself, None when it is streamed."""
        if self._matrix_native_refused or not self.matrix_matter_ready():
            return None
        if self._music_flow_enabled:
            return None
        if self._mode == MODE_NATIVE_EFFECT:
            return self._matrix_effect_command()
        if self._mode == MODE_CLOCK:
            return self._matrix_clock_command()
        return None

    def _matrix_effect_command(self) -> tuple[str, dict] | None:
        effect = self._native_effect
        if effect in LITE_VERSIONS:
            return None  # the Cube Lite's look of a slot it draws its own way: streamed
        if (ALL_NATIVE_EFFECTS.get(effect) or {}).get("streamed"):
            return None  # the integration's own (effect_catalog.STREAMED_EFFECTS): streamed
        if effect not in MATRIX_EFFECTS:
            return self._matrix_engine_command(effect)
        mode = self._native_effect_color_mode or "normal"
        rgb = None
        if mode == "normal":
            rgb = self._native_effect_color
        elif mode == PALETTE_COLOR_MODE:
            palette = list(self._text_colors or ())
            if len(palette) > 1:
                return None  # the whole palette: streamed
            rgb = palette[0] if palette else None
        else:
            return None  # a color mode the lamp does not have: streamed
        intensity = self._native_effect_intensity
        takes_intensity = (ALL_NATIVE_EFFECTS.get(effect) or {}).get("intensity")
        return "setPresetsEffect", preset_payload(
            effect, self._native_effect_speed, rgb, self._matrix_direction(effect), APPLY_SAVE,
            intensity if takes_intensity else None,
        )

    def _matrix_direction(self, effect: str) -> int | None:
        """The direction value an effect is sent: the chosen one (or the
        effect's first). Not turned for the mounting: the Device Orientation
        follows the lamp's rotation, and the lamp turns its own effects for
        it. The Yeelight app's effects take the values filmed for them
        (matrix_effects.matrix_direction). The other built-in effects run a
        Cube Lite's renderers on the same panel layout: they are sent the
        value that draws what a Cube Lite draws for the same Device
        Orientation (and the preview shows), at the lamp's rotation (filmed
        2026-11-12: every effect confirmed on both lamps draws the same value
        on both). The effects that run along one line of the lamp whatever
        its rotation (ONE_AXIS_MODES, ONE_AXIS_APP_EFFECTS) get that line's
        value, as on a Cube Lite. None: the effect takes none."""
        spec = ALL_NATIVE_EFFECTS.get(effect) or {}
        directions = spec.get("directions") or ()
        if not directions:
            return None
        chosen = self._native_effect_direction
        label = chosen if chosen in directions else directions[0]
        rotation = self._lamp_client.profile.rotation
        mode = spec.get("mode")
        if effect in ONE_AXIS_APP_EFFECTS or (effect not in MATRIX_EFFECTS and mode in ONE_AXIS_MODES):
            return one_axis_direction(label, self._device_orientation, rotation, "Up", LOW_PAIR)
        if effect in MATRIX_EFFECTS or mode in APP_DIRECTION_MODES:
            return matrix_direction(effect, mode, label)
        return compensate_direction(
            effect_direction_value(spec, label, self._device_orientation), effective_profile(rotation),
        )

    def _matrix_engine_command(self, effect: str) -> tuple[str, dict] | None:
        """One of the lamp's other built-in effects (ENGINE_MODES), with the
        settings the integration sends a Cube Lite for it."""
        spec = ALL_NATIVE_EFFECTS.get(effect) or {}
        mode = spec.get("mode")
        if mode not in ENGINE_MODES or spec.get("animation") or spec.get("hidden"):
            return None
        own = [int(spec["color"])] if spec.get("color") is not None else [int(word) for word in spec.get("colors", ())]
        color_mode = self._native_effect_color_mode or "normal"
        chosen: list[int] = []
        if color_mode == "normal":
            colour = self._native_effect_color
            if colour is not None and effect_supports_color_override(effect):
                chosen = [colour_word(colour), *own[1:]]
        elif color_mode == PALETTE_COLOR_MODE:
            palette = list(self._text_colors or ())
            if palette and not palette_fits(effect, palette):
                return None  # the whole palette: streamed
            chosen = palette_words(effect, palette) if palette else []
        else:
            return None  # a color mode the lamp does not have: streamed
        if len(chosen) > 4 or len(own) > 4:
            return None
        intensity = self._native_effect_intensity
        return "setEffect", engine_payload(
            mode,
            self._native_effect_speed if spec.get("speed") else None,
            intensity if spec.get("intensity") and intensity is not None else None,
            chosen,
            self._matrix_direction(effect),
            APPLY_SAVE,
            own=own,
        )

    def _matrix_clock_command(self) -> tuple[str, dict] | None:
        types = self.device_profile.module_types
        if sum(1 for kind in types if kind == MATRIX_MODULE) < CLOCK_MODULES:
            return None  # the lamp draws its digits on Matrix modules only
        style_id = int(self._native_clock_style)
        style = self._clock_style()
        background = style.get("mixer", 0)
        if background not in CLOCK_BACKGROUNDS:
            return None
        if not self._matrix_clock_whole_hours():
            return None  # the lamp's clock takes whole hours only: streamed
        if self.lamp_turns_clock:
            # Its own clock would read upside down (mounted left) or from the
            # bottom up (mounted up): streamed, turned as a Cube Lite's.
            return None
        mode = self._native_clock_color_mode or "normal"
        palette = list(self._text_colors or ())
        if self._native_clock_color is not None:
            rgb = argb_to_rgb(self._native_clock_color)
        elif background:
            rgb = None  # the background's own palette (the app sends none)
        else:
            rgb = CLOCK_STYLE_COLOURS.get(style_id, (0xFF, 0xFF, 0xFF))
        if mode == PALETTE_COLOR_MODE and palette:
            if background != 0:
                return None  # a background in the palette: streamed
            rgb = tuple(palette[0])
        elif mode not in ("normal", PALETTE_COLOR_MODE):
            return None
        return "setEffect", clock_payload(
            rgb, background, NATIVE_CLOCK_CONTENT_BYTE.get(self._native_clock_content, 1),
            self._native_clock_timezone_hours(), bool(self._native_clock_12_hour),
            bool(self._native_clock_colon_blink), APPLY_PRIORITY, style_id,
        )

    def _matrix_clock_whole_hours(self) -> bool:
        """The local UTC offset is whole hours (the lamp's clock takes no
        other: in India, Newfoundland or parts of Australia it would be 30
        or 45 minutes off, so Home Assistant's clock is streamed)."""
        seconds = getattr(self, "_native_clock_utc_offset_seconds", None)
        return seconds is None or seconds() % 3600 == 0

    # ── Showing it ──────────────────────────────────────────────────────
    async def _activate_matrix_content(self) -> bool:
        """The selected effect or clock on a Cube Matrix: its own over
        Matter when it can, else streamed. False when neither applies (a
        microphone effect: the caller goes on as for a Cube Lite)."""
        self._matrix_native_refused = False
        self._matrix_stream_failures = 0
        command = self.matrix_native_command()
        if command is not None and await self._send_matrix_command(*command):
            if self._mode == MODE_CLOCK:
                self._native_clock_timezone_offset = self._native_clock_timezone_hours()
            return True
        if self.studio_selected():
            if self._matrix_clock_saved() and self.matrix_matter_ready():
                try:
                    await self._leave_matrix_clock("stream", {"apply": APPLY_SHOW})
                except Exception as err:  # noqa: BLE001 -- the stream still starts
                    _LOGGER.debug("[MATRIX] [%s] resetEffect failed: %s", self._ip, err)
            self._matrix_shown = None
            await self._start_studio_stream()
            return True
        return False

    async def _release_lan_display(self) -> None:
        """Before a Matter effect: the stream stopped and the music
        connection closed (the lamp ignores Matter effects while it is
        open), direct mode over."""
        self.stop_studio_stream()
        if self._lamp_client.close_music_session():
            await asyncio.sleep(MUSIC_CLOSE_SETTLE)
        self._direct_mode_lost()

    async def _set_matrix_brightness(self) -> None:
        """The brightness, when due (matrix_send_brightness)."""
        if not self._native_brightness_due():
            return
        level = hardware_brightness_for(self._brightness)
        await self.matrix_send_brightness(level, udp=False)
        self._note_hardware_brightness(level)

    def matrix_brightness_over_matter(self) -> bool:
        """Whether a Cube Matrix's brightness goes over Matter (a server
        delivers its commands; matrix_send_brightness)."""
        channel = self._matter_commands
        return bool(getattr(self, "is_cube_matrix", False)) and getattr(channel, "backend", None) is not None

    async def matrix_send_brightness(self, level: int, *, udp: bool = False) -> None:
        """A Cube Matrix's brightness (``level``: set_bright's 1-100 %): over
        Matter when a server delivers its commands (Level Control, as the
        Yeelight app's slider: the lamp's own effects, clock and drawings
        dim alike, filmed 2026-11-12), so it never depends on the lamp's LAN,
        which can stop reading commands while Matter goes on (2026-11-11 and
        12: every TCP connection reset, the slider did nothing). Else, or
        when that fails, set_bright over the LAN (TCP, ``udp`` False: on the
        music connection it would open it again)."""
        channel = self._matter_commands
        if self.matrix_brightness_over_matter():
            try:
                # Its own report of the new level is not a change on the lamp.
                self._matrix_command_at = time.monotonic()
                await channel.async_command(
                    LEVEL_CONTROL_CLUSTER, "MoveToLevel",
                    {"level": matter_level(level), "transitionTime": 0, "optionsMask": 0, "optionsOverride": 0},
                    endpoint_id=LEVEL_ENDPOINT,
                )
                self._matrix_command_at = time.monotonic()
                return
            except Exception as err:  # noqa: BLE001 -- the LAN is tried next
                _LOGGER.debug("[MATRIX] [%s] Brightness over Matter failed: %s", self._ip, err)
        await self._lamp_client.send_raw_command("set_bright", [level], udp=udp)

    async def _send_matrix_command(self, name: str, payload: dict) -> bool:
        """Show ``payload`` over Matter; False (and streamed from now on,
        until the next activation) when it could not be sent. Only the speed
        or direction of what the lamp shows changed: changed live (setRate,
        setDirection: the effect goes on, nothing saved; the Yeelight app's
        sliders do the same), not started again and saved."""
        channel = self._matter_commands
        try:
            live = live_change(self._matrix_shown, (name, payload))
            if live is not None:
                await self._set_matrix_brightness()
                self._matrix_command_at = time.monotonic()
                for live_name, live_payload in live:
                    await channel.async_command(EFFECTS_CLUSTER, live_name, live_payload)
                self._matrix_command_at = time.monotonic()
                self._matrix_shown = (name, payload)
                _LOGGER.debug("[MATRIX] [%s] Changed live: %s", self._ip, live)
                return True
            await self._release_lan_display()
            await self._set_matrix_brightness()
            if note_power := getattr(self, "_expect_lamp_power", None):
                note_power(True)
            self._matrix_command_at = time.monotonic()
            self._matrix_sent_id = _sent_effect_id(name, payload)
            await self._leave_matrix_clock(name, payload)
            if self._matrix_resend(name, payload):
                # Shown first, then again once the lamp's colour transition
                # is over (RESEND_MODES), saved by the second only.
                await channel.async_command(EFFECTS_CLUSTER, name, {**payload, "apply": APPLY_SHOW})
                await asyncio.sleep(RESEND_AFTER)
            await channel.async_command(EFFECTS_CLUSTER, name, payload)
        except Exception as err:  # noqa: BLE001 -- the stream takes over
            _LOGGER.warning(
                "[MATRIX] [%s] %s over Matter failed (%s): streamed instead", self._ip, name, err,
            )
            self._refuse_matrix_native()
            self._matrix_shown = None
            return False
        self._matrix_command_at = time.monotonic()
        self._matrix_retry_after = MATTER_RETRY_FIRST  # Matter works again
        self._matrix_shown = (name, payload)
        _LOGGER.debug("[MATRIX] [%s] Shown by the lamp: %s %s", self._ip, name, payload)
        self._native_renderer_shown()
        return True

    @staticmethod
    def _matrix_resend(name: str, payload: dict) -> bool:
        if name != "setEffect":
            return False
        params = (payload.get("effect") or {}).get("effectParams") or [{}]
        return params[0].get("mode") in RESEND_MODES

    def _matrix_clock_saved(self) -> bool:
        """The lamp's clock is saved as its priority effect (apply 2: what it
        shows at power-on, over its default)."""
        shown = self._matrix_shown
        return bool(
            shown is not None and shown[0] == "setEffect"
            and (shown[1].get("effect") or {}).get("effectId") == CLOCK_EFFECT
            and shown[1].get("apply") == APPLY_PRIORITY
        )

    async def _leave_matrix_clock(self, name: str, payload: dict) -> None:
        """Before what is not saved with apply 1 or 2 (a drawing, a stream):
        the clock is no longer the lamp's priority effect (resetEffect, as
        the app's "clock off"), so a power cut does not bring it back."""
        if not self._matrix_clock_saved() or payload.get("apply") in (APPLY_SAVE, APPLY_PRIORITY):
            return
        await self._matter_commands.async_command(EFFECTS_CLUSTER, "resetEffect", {})

    def matrix_draws_over_matter(self) -> bool:
        """light_display.apply sends its frame as the lamp's drawing."""
        return not self._matrix_native_refused and self.matrix_matter_ready()

    def _matrix_drawing_shown(self, mixer: int | None = None) -> bool:
        """The lamp shows a drawing (with ``mixer``, when given)."""
        shown = self._matrix_shown
        if shown is None:
            return False
        params = shown[1].get("effect", {})
        if params.get("effectId") != DRAWING_EFFECT:
            return False
        return mixer is None or (params.get("effectParams") or [{}])[0].get("mixer") == mixer

    async def _draw_matrix_frame(self, wire_frame, mixer: int | None = None) -> None:
        """A drawing (in the lamp's wire order) shown by the lamp: its new
        pixels when its drawing already runs (setData), else the drawing
        effect with the chosen animation (``mixer``: this one instead).
        Raises when Matter refuses (the caller falls back to LAN)."""
        pixels = self.device_profile.drawing_pixels(wire_frame)
        if self._matrix_drawing_shown(mixer):
            name, payload = "setData", set_data_payload(pixels)
        else:
            name, payload = "setEffect", drawing_payload(
                pixels, self._matrix_drawing_mixer if mixer is None else mixer,
                self._matrix_drawing_speed, self._matrix_drawing_direction, APPLY_SHOW,
            )
            await self._release_lan_display()
            await self._leave_matrix_clock(name, payload)
        await self._set_matrix_brightness()
        self._matrix_command_at = time.monotonic()
        self._matrix_sent_id = DRAWING_EFFECT
        try:
            await self._matter_commands.async_command(EFFECTS_CLUSTER, name, payload)
        except Exception:
            self._refuse_matrix_native()
            self._matrix_shown = None
            raise
        self._matrix_command_at = time.monotonic()
        if name == "setEffect":
            self._matrix_shown = (name, payload)
        self._entered_builtin_mode()

    # ── The stream over Matter ──────────────────────────────────────────
    def matrix_streams_over_matter(self) -> bool:
        """light_studio's stream goes as the lamp's drawing over Matter
        (_send_matrix_stream_frame), not over the LAN."""
        return self.is_cube_matrix and self.matrix_draws_over_matter()

    async def _matrix_stream_pixels(self, render: int) -> list:
        """Frame ``render`` of the stream as a drawing's pixels: the same
        frame the LAN stream sends (light_studio._studio_payload)."""
        frame = await self.hass.async_add_executor_job(drawn_in_full, self._own_effect_frame, render)
        return self.device_profile.drawing_pixels(self._lamp_frame(self._brightness_stages(frame)))

    async def _send_matrix_stream_frame(self, pixels) -> None:
        """A frame of the stream (under the lamp's lock): the drawing's new
        pixels (setData: shown, not saved), or the drawing itself when the
        lamp does not show it (the first frame, or after a restart or a
        failed frame). Never a setData onto something else: it would
        overwrite that effect's data. Raises when Matter fails."""
        # A LAN command (the brightness, a probe) may have opened the music
        # connection again: the lamp would drop the frames.
        if self._lamp_client.close_music_session():
            await asyncio.sleep(MUSIC_CLOSE_SETTLE)
        self._direct_mode_lost()
        try:
            if self._matrix_drawing_shown(0):
                # Not a new command for the echo window: the lamp's button
                # pressed during the stream is still followed.
                await self._matter_commands.async_command(
                    EFFECTS_CLUSTER, "setData", set_data_payload(pixels),
                )
            else:
                payload = drawing_payload(
                    pixels, 0, self._matrix_drawing_speed, self._matrix_drawing_direction, APPLY_SHOW,
                )
                await self._leave_matrix_clock("setEffect", payload)
                await self._set_matrix_brightness()
                self._matrix_sent_id = DRAWING_EFFECT
                self._matrix_command_at = time.monotonic()
                await self._matter_commands.async_command(EFFECTS_CLUSTER, "setEffect", payload)
                self._matrix_command_at = time.monotonic()
                self._matrix_shown = ("setEffect", payload)
        except Exception:
            self._matrix_shown = None
            self._matrix_stream_failures += 1
            if self._matrix_stream_failures >= MATTER_STREAM_FAILURES:
                # Streamed over the LAN until Matter is tried again.
                self._refuse_matrix_native()
                _LOGGER.warning(
                    "[MATRIX] [%s] Frames over Matter failed %d times: streamed over the LAN",
                    self._ip, self._matrix_stream_failures,
                )
            raise
        self._matrix_stream_failures = 0

    async def _apply_matrix_drawing(self, off_frame: bool) -> bool:
        """light_display.apply's frame (_prepared_frame, then the power
        limit), shown as the lamp's drawing. False when Matter refused it:
        apply goes on over the LAN."""
        try:
            await self._draw_matrix_frame(self._lamp_frame(self._prepared_frame()))
        except Exception as err:  # noqa: BLE001 -- drawn over the LAN instead
            _LOGGER.warning(
                "[MATRIX] [%s] Drawing over Matter failed (%s): sent over the LAN", self._ip, err,
            )
            return False
        if not self._is_on and not off_frame:
            self._is_on = True
        if self.hass is not None:
            self._notify_camera_preview()
            self.async_schedule_update_ha_state()
        return True

    # ── Freeze ──────────────────────────────────────────────────────────
    def matrix_freezes(self) -> bool:
        """Freeze (light_services_display) shows the held frame as the
        lamp's drawing: the lamp has no freeze of its own (the Cube Lite's
        set_fx_effect is not on its LAN, and its mode 64 is unsafe), so what
        it shows itself over Matter is replaced by a still picture of it."""
        return (
            self.is_cube_matrix
            and self._mode in (MODE_NATIVE_EFFECT, MODE_CLOCK)
            and self.matrix_native_command() is not None
        )

    def _matrix_held_frame(self) -> list:
        """The frame the light holds while frozen (lamp order), the one its
        preview camera holds: the effect, or the clock's background with
        the current time. In an executor (a renderer may replay its
        history)."""
        with raw_colours():
            for camera in self._camera_entities or ():
                frame = camera.simulated_lamp_frame()
                if frame is not None:
                    return list(frame)
        seconds = max(0.0, time.monotonic() - self._matrix_command_at)
        return self._own_effect_frame(studio_render(seconds))

    async def _draw_matrix_held_frame(self) -> list:
        frame = await self.hass.async_add_executor_job(self._matrix_held_frame)
        await self._draw_matrix_frame(self._lamp_frame(self._brightness_stages(frame)), mixer=0)
        return frame

    async def async_matrix_freeze(self) -> None:
        """Under the lamp's lock: the held frame shown as a still drawing
        (not saved: a power cut brings back the effect). A clock keeps its
        time: its digits are drawn again as they change. Re-applying the
        effect or clock (the cards' resume) sends it again in full."""
        self._set_display_frozen(True)
        try:
            frame = await self._draw_matrix_held_frame()
        except Exception:
            self._set_display_frozen(False)
            raise
        if self._mode == MODE_CLOCK and (
            self._matrix_freeze_task is None or self._matrix_freeze_task.done()
        ):
            self._matrix_freeze_task = self._create_tracked_task(
                self._matrix_frozen_clock(frame),
                name=f"yeelight_cube_matrix_frozen_clock_{self._ip}",
            )

    def _matrix_clock_frozen(self) -> bool:
        return (
            self._display_frozen and self._is_on and self._mode == MODE_CLOCK
            and self._matrix_drawing_shown(0)
        )

    async def _matrix_frozen_clock(self, sent: list | None = None) -> None:
        """While a clock is frozen: its frame again on even seconds (its
        colon lit), sent only when it changed from ``sent`` (the minute, or
        time and date taking turns)."""
        while True:
            await asyncio.sleep(FROZEN_CLOCK_TICK - time.time() % FROZEN_CLOCK_TICK + 0.05)
            if not self._matrix_clock_frozen():
                return
            frame = await self.hass.async_add_executor_job(self._matrix_held_frame)
            if frame == sent:
                continue
            sent = frame

            async def draw(frame=frame) -> None:
                if self._matrix_clock_frozen():
                    await self._draw_matrix_frame(
                        self._lamp_frame(self._brightness_stages(frame)), mixer=0,
                    )

            try:
                await self._execute_hardware_op(draw, "frozen_clock")
            except Exception as err:  # noqa: BLE001 -- tried again at the next change
                _LOGGER.debug("[MATRIX] [%s] Frozen clock not redrawn: %s", self._ip, err)
                sent = None

    # ── Following the lamp ──────────────────────────────────────────────
    def _matrix_echo(self) -> bool:
        return time.monotonic() - self._matrix_command_at < MATRIX_ECHO_WINDOW

    def _on_matrix_report(self, name: str, value, initial: bool) -> None:
        """A value a Cube Matrix reports (matter_link.MATRIX_REPORTED)."""
        if name == "reboot_count":
            # Also when the link is made again (initial): the node can be
            # linked anew after the lamp was away.
            if isinstance(value, int) and not isinstance(value, bool):
                previous, self._matrix_reboots = self._matrix_reboots, value
                if previous is not None and value != previous:
                    self._matrix_lamp_restarted()
            return
        if not initial:
            if name == "running_effect":
                values = self._matter.values if self._matter else {}
                if value == self._matrix_sent_id:
                    # What Home Assistant started (a report can come late:
                    # seen 31 s after the command, 2026-11-10).
                    pass
                elif self._matrix_just_restarted():
                    # The effect the lamp starts with (its saved one), not
                    # its button: Home Assistant's content is shown again.
                    pass
                elif not self._matrix_echo():
                    # Someone else (the button, the app, the demo loop).
                    self._matrix_shown = None
                    if self._matrix_demo_watch.running_changed(time.monotonic(), values.get("effect")):
                        self._set_matrix_demo(matter=True)
                    else:
                        self._matrix_followed(value)
            elif name == "effect" and value not in (0, None) and not self._matrix_echo():
                self._matrix_demo_watch.reset()
            elif name == "on_off" and isinstance(value, bool):
                if not self._power_echo(value):
                    self._lamp_switched(value)
            elif name == "level" and isinstance(value, int):
                if not self._matrix_echo() and not self._matter_echo():
                    self._lamp_dimmed(value)
            elif name == "rotation":
                self._matrix_rotated(value)
            elif name == "topology":
                self._matrix_modules_changed(value)
            elif name == "start_up_on_off":
                self._matrix_power_on = "off" if value == 0 else "on"
            elif name == "lan_control":
                self._async_check_problems()
        elif name == "rotation":
            lan = self._matrix_lan_rotation()
            if lan is not None and lan != value:
                # Home Assistant's Matter client keeps the value last reported
                # to it; a write is not reported back, so after a restart it
                # read 0 while the lamp ran 3 (2026-11-11): the lamp's own
                # answer (read over the LAN at setup, kept up to date) wins.
                _LOGGER.debug(
                    "[MATRIX] [%s] Rotation %s from Matter, %s from the lamp: the lamp's kept",
                    self._ip, value, lan,
                )
                if self._matter is not None:
                    self._matter.values["rotation"] = lan
                value = lan
            self._matrix_rotated(value, start=True)
        elif name == "topology":
            # The lamp's own answer over the LAN (read at setup) wins; when
            # its LAN could not be read (stuck, 2026-11-14), Matter's module
            # list is the layout: else the default 4 Matrix modules stayed.
            if "cube_topology" not in (getattr(self._lamp_client, "capabilities", None) or {}):
                self._matrix_modules_changed(value)
        elif name == "start_up_on_off":
            self._matrix_power_on = "off" if value == 0 else "on"
        if self.hass is not None:
            self.async_write_ha_state()

    def _matrix_followed(self, running) -> None:
        """The lamp started something itself (its button steps its playlist,
        or the Yeelight app): the light shows it as its effect or clock
        (nothing is sent). An effect it has no name for, a drawing or a
        colour (0) leaves the light as it is."""
        if self.matrix_demo_mode or not isinstance(running, int):
            return
        name = None
        if running == CLOCK_EFFECT:
            if self._mode == MODE_CLOCK:
                return
        else:
            name = matrix_effect_name(running)
            if name is None or (self._mode == MODE_NATIVE_EFFECT and self._native_effect == name):
                return
        self._matrix_followed_from = (time.monotonic(), self._mode, self._native_effect)
        if running == CLOCK_EFFECT:
            self._enter_mode(MODE_CLOCK)
        else:
            self._enter_mode(MODE_NATIVE_EFFECT)
            self._native_effect = name
        _LOGGER.info("[MATRIX] [%s] The lamp shows %s (its button or the app)", self._ip, running)
        if refresh := getattr(self, "_refresh_linked_entities", None):
            refresh()

    def matrix_redraw_waits_for_restart(self) -> bool:
        """Back after an outage, what the light shows goes over Matter,
        which reaches a restarted lamp only ~90 s after power-on (2026-11-11:
        the health check's redraws each waited 12 s and failed until then):
        the redraw is left to the lamp's restart report (or the fallback)."""
        if not self.is_cube_matrix or self._music_flow_enabled:
            return False
        if self._mode in (MODE_NATIVE_EFFECT, MODE_CLOCK):
            return self.matrix_native_command() is not None
        return self.matrix_draws_over_matter()

    def matrix_await_restart(self) -> None:
        """Called by the health check instead of its redraw: the restart
        report redraws (_matrix_lamp_restarted); without one within
        MATRIX_RESTART_FALLBACK, the content is sent again anyway."""
        if self._matrix_restart_seen:
            # Reported while the lamp was still away: Matter is back.
            self._matrix_restart_seen = False
            self._matrix_shown = None
            self._create_tracked_task(
                self.async_apply_display_mode(update_type="turn_on"),
                name=f"yeelight_cube_matrix_restarted_{self._ip}",
            )
            return
        self._matrix_redraw_due = True
        if self._matrix_fallback_task is not None and not self._matrix_fallback_task.done():
            return

        async def fallback() -> None:
            await asyncio.sleep(MATRIX_RESTART_FALLBACK)
            if not self._matrix_redraw_due:
                return
            self._matrix_redraw_due = False
            if not self._is_on:
                return
            _LOGGER.info("[MATRIX] [%s] No restart reported: Home Assistant's content sent again", self._ip)
            self._matrix_shown = None
            await self.async_apply_display_mode(update_type="turn_on")

        self._matrix_fallback_task = self._create_tracked_task(
            fallback(), name=f"yeelight_cube_matrix_restart_fallback_{self._ip}",
        )

    def _matrix_just_restarted(self) -> bool:
        return time.monotonic() - self._matrix_restarted_at < MATRIX_RESTART_WINDOW

    def _matrix_lamp_restarted(self) -> None:
        """The lamp started again (its reboot count changed): a power cut,
        however short (one between two LAN probes went unseen, 2026-11-11).
        It shows its saved effect or stays off (its Power-on behavior):
        Home Assistant's content is shown again, as after a longer outage
        (light_connection's health check)."""
        now = time.monotonic()
        self._matrix_restarted_at = now
        self._matrix_redraw_due = False   # redrawn here, not by the fallback
        self._matrix_shown = None
        self._matrix_sent_id = None
        followed = self._matrix_followed_from
        self._matrix_followed_from = None
        if followed is not None and now - followed[0] < MATRIX_RESTART_WINDOW:
            # Its start-up effect, reported first, was taken for its button.
            self._enter_mode(followed[1])
            self._native_effect = followed[2]
            if refresh := getattr(self, "_refresh_linked_entities", None):
                refresh()
        turned = self._matrix_turned_from
        self._matrix_turned_from = None
        if self.hass is None:
            return
        # Its rotation, reported first, was taken for the app's.
        self._matrix_restore_orientation(
            turned[1] if turned is not None and now - turned[0] < MATRIX_RESTART_WINDOW else self._device_orientation
        )
        if self._outage_since is not None:
            # The health check saw it away: it redraws when the lamp answers
            # (at once: Matter, which reported this, is back).
            _LOGGER.info("[MATRIX] [%s] The lamp restarted (redrawn by the health check)", self._ip)
            self._matrix_restart_seen = True
            return
        if self._external_display:
            _LOGGER.info("[MATRIX] [%s] The lamp restarted: it shows another app's content", self._ip)
            return
        if self._matrix_power_on == "off":
            _LOGGER.info("[MATRIX] [%s] The lamp restarted, set to stay off at power-on", self._ip)
            self._is_on = False
            self.async_write_ha_state()
            return
        if not self._is_on:
            _LOGGER.info("[MATRIX] [%s] The lamp restarted (the light is off)", self._ip)
            return
        _LOGGER.info("[MATRIX] [%s] The lamp restarted: Home Assistant's content shown again", self._ip)
        self._create_tracked_task(
            self.async_apply_display_mode(update_type="turn_on"),
            name=f"yeelight_cube_matrix_restarted_{self._ip}",
        )

    def _matrix_lan_rotation(self) -> int | None:
        """The rotation the lamp answered over the LAN (rotation_angle, read
        at setup), kept up to date with what it reports and is written."""
        capabilities = getattr(self._lamp_client, "capabilities", None) or {}
        try:
            rotation = int(capabilities.get("rotation_angle"))
        except (TypeError, ValueError):
            return None
        return rotation if 0 <= rotation <= 3 else None

    def matrix_note_rotation(self, rotation: int) -> None:
        """The lamp's rotation as it now is (reported, or written here)."""
        if not self.is_cube_matrix:
            return
        capabilities = getattr(self._lamp_client, "capabilities", None)
        if isinstance(capabilities, dict):
            capabilities["rotation_angle"] = str(rotation)

    def _matrix_rotated(self, rotation, *, start: bool = False) -> None:
        """The lamp's rotation_angle (the Yeelight app's direction), reported
        or read at setup (``start``): the mounting it names is the light's
        Device Orientation (device_profile.MATRIX_ROTATION_ORIENTATIONS), so
        pictures, text and the previews are laid out for it as the lamp's own
        effects are."""
        profile = self._lamp_client.profile
        if not isinstance(rotation, int) or not 0 <= rotation <= 3:
            return
        self.matrix_note_rotation(rotation)
        if rotation == profile.rotation and not start:
            return
        self._lamp_client.profile = dataclasses.replace(profile, rotation=rotation)
        if not start and self.hass is not None and self._matrix_just_restarted():
            # Reported as the lamp starts: the rotation it had saved, not a
            # change made in the app (_matrix_restore_orientation).
            self._matrix_restore_orientation(self._device_orientation)
            return
        if self._lamp_client.profile.factory_modules:
            # Never set in the app: the factory's rotation, not the mounting
            # (the user's Device Orientation is kept; the factory_modules repair).
            return
        orientation = self._lamp_client.profile.orientation
        if orientation is None or orientation == self._device_orientation or self.hass is None:
            return
        _LOGGER.info("[MATRIX] [%s] Rotation %s: mounted %s", self._ip, rotation, orientation)
        if not start:
            self._matrix_turned_from = (time.monotonic(), self._device_orientation)
        self._create_tracked_task(
            self.set_device_orientation(orientation),
            name=f"yeelight_cube_matrix_rotation_{self._ip}",
        )

    def _matrix_restore_orientation(self, orientation: str | None) -> None:
        """After a restart: the lamp runs the rotation it last saved. It
        saves a written one only after a later request, and not while its
        music mode is on (its LAN stuck, or a connection left open), so it
        can come back with an older one (seen 2026-11-11 and 12: the one
        written two minutes before). Written again when it differs from the
        Device Orientation (``orientation``), never followed."""
        rotation = self._rotation_for(orientation) if orientation else None
        if rotation is None:
            return
        running = self._lamp_client.profile.rotation
        if running == rotation:
            return
        _LOGGER.warning(
            "[MATRIX] [%s] The lamp restarted with rotation %s, not %s (%s): it had not saved the "
            "last one written; written again", self._ip, running, rotation, orientation,
        )

        async def restore() -> None:
            if orientation != self._device_orientation:
                await self.set_device_orientation(orientation)
            elif await self._sync_lamp_rotation(orientation, force=True):
                self._lamp_client.profile = dataclasses.replace(self._lamp_client.profile, rotation=rotation)

        self._create_tracked_task(restore(), name=f"yeelight_cube_matrix_rotation_restore_{self._ip}")

    # ── Settings over Matter ────────────────────────────────────────────
    async def async_set_matrix_power_on(self, value: str) -> None:
        """The Power-on behavior select: "on" or "off" at power-on, written
        to the lamp's Matter StartUpOnOff (the Yeelight app's On/Off; the
        lamp has no "restore"). Measured: 0 boots the lamp off."""
        if value not in ("on", "off"):
            raise ValueError(f"Unsupported power-on behavior: {value}")
        if not self.matrix_matter_ready():
            raise MatrixSettingUnavailable("power_on_needs_matter")
        await self._matter_commands.async_write(START_UP_ON_OFF, 1 if value == "on" else 0)
        self._matrix_power_on = value
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_set_matrix_drawing_animation(self, mixer: int) -> None:
        """The Drawing animation select (DRAWING_MIXERS): what the lamp does
        with a drawing it shows (static, scroll, breathe, flash, reveal);
        changed live on the one it shows, else used for the next."""
        if mixer not in DRAWING_MIXERS:
            raise ValueError(f"Unsupported drawing animation: {mixer}")
        self._matrix_drawing_mixer = mixer
        await self.async_matrix_drawing_changed()

    async def async_matrix_drawing_changed(self) -> None:
        """The drawing animation or its speed changed: sent live to a drawing
        the lamp shows, in the Yeelight app's order (setMixer, then the
        direction and the speed). Every FC05 command restarts the animation."""
        shown = self._matrix_shown
        if shown is None or (shown[1].get("effect") or {}).get("effectId") != DRAWING_EFFECT:
            return
        if not self.matrix_draws_over_matter():
            return
        channel = self._matter_commands
        self._matrix_command_at = time.monotonic()
        await channel.async_command(EFFECTS_CLUSTER, "setMixer", {"mixer": int(self._matrix_drawing_mixer)})
        if self._matrix_drawing_mixer in (2, 5):
            await channel.async_command(
                EFFECTS_CLUSTER, "setDirection", {"direction": int(self._matrix_drawing_direction)},
            )
        await channel.async_command(EFFECTS_CLUSTER, "setRate", {"rate": int(self._matrix_drawing_speed)})
        self._matrix_command_at = time.monotonic()
        params = dict(shown[1]["effect"]["effectParams"][0])
        params.update(mixer=int(self._matrix_drawing_mixer), speed=int(self._matrix_drawing_speed))
        self._matrix_shown = (shown[0], {**shown[1], "effect": {**shown[1]["effect"], "effectParams": [params]}})

    def _matrix_modules_changed(self, topology) -> None:
        """The lamp's module list changed (set in the Yeelight app, reported
        over Matter): the layout is built again (the pixels each module
        takes, the clock's Matrix modules, the drawings' length), and what
        is shown is shown again for it."""
        if not isinstance(topology, (list, tuple)):
            return
        profile = self._lamp_client.profile
        rebuilt = profile_for(
            "CubeMatrix", profile.support, ",".join(str(kind) for kind in topology), None, profile.rotation,
        )
        if tuple(rebuilt.module_types) == tuple(profile.module_types):
            return
        _LOGGER.info(
            "[MATRIX] [%s] Modules changed: %s -> %s", self._ip, profile.module_types, rebuilt.module_types,
        )
        self._lamp_client.profile = rebuilt
        self._matrix_shown = None
        self._matrix_rotated(rebuilt.rotation, start=True)
        if self._is_on and self.hass is not None:
            self._async_check_problems()
            self._create_tracked_task(
                self.async_apply_display_mode(update_type="text_change"),
                name=f"yeelight_cube_matrix_modules_{self._ip}",
            )

    async def async_set_matrix_modules(self, modules: list[str]) -> None:
        """Write the lamp's module list (the Yeelight app's module splicing:
        FC02 UpdateTopology over Matter), in chain order from the base:
        "matrix", "spot" or "panel", 1 to TOPOLOGY_SLOTS of them. The lamp
        cannot tell which modules are fitted: the list must name them as they
        are. It keeps the list (a power cut too), lays its own effects and
        clock out for it, and reports it back (_matrix_modules_changed)."""
        if not self.is_cube_matrix:
            raise InputError("matrix_modules_not_matrix")
        codes = {name: code for code, name in TOPOLOGY_NAMES.items()}
        if not 1 <= len(modules) <= TOPOLOGY_SLOTS or any(name not in codes for name in modules):
            raise InputError("matrix_modules_invalid", count=str(TOPOLOGY_SLOTS))
        if not self.matrix_matter_ready():
            raise InputError("matrix_modules_need_matter")
        topology = [codes[name] for name in modules]
        # Our music connection open, the lamp skips saving some settings
        # (the rotation, 2026-11-12): closed first.
        if self._lamp_client.close_music_session():
            await asyncio.sleep(MUSIC_CLOSE_SETTLE)
        self._matrix_command_at = time.monotonic()
        await self._matter_commands.async_command(CUBE_CONTROL_CLUSTER, "updateTopology", {"topology": topology})
        _LOGGER.info("[MATRIX] [%s] Modules set: %s", self._ip, modules)
        self._matrix_modules_changed(topology)
        if self.hass is not None:
            self.async_write_ha_state()

    def _set_matrix_demo(self, *, lan: bool | None = None, matter: bool | None = None) -> None:
        before = self.matrix_demo_mode
        if lan is not None:
            self._matrix_demo_lan = lan
            if not lan:
                # A lamp read out of the loop (a factory reset) is not in it.
                self._matrix_demo_matter = False
                self._matrix_demo_watch.reset()
        if matter is not None:
            self._matrix_demo_matter = matter
        if self.matrix_demo_mode == before:
            return
        _LOGGER.warning(
            "[MATRIX] [%s] Demo mode %s: %s", self._ip, "on" if self.matrix_demo_mode else "off",
            "streamed over the LAN" if self.matrix_demo_mode else "the lamp's own effects over Matter again",
        )
        if self.hass is not None:
            self._async_check_problems()
            self._matrix_matter_changed()

    def _check_matrix_demo(self) -> None:
        """Read show_off_mode over the LAN, at most every DEMO_READ_INTERVAL
        (from the minute check)."""
        if not self.is_cube_matrix or self._matrix_demo_task is not None:
            return
        now = time.monotonic()
        if self._matrix_demo_read_at is not None and now - self._matrix_demo_read_at < DEMO_READ_INTERVAL:
            return
        self._matrix_demo_read_at = now

        async def read() -> None:
            try:
                answer = await tcp_request(self._ip, "get_prop", ["show_off_mode"])
                values = (answer or {}).get("result") or []
                if values and str(values[0]) in ("0", "1"):
                    self._set_matrix_demo(lan=str(values[0]) == "1")
            finally:
                self._matrix_demo_task = None

        self._matrix_demo_task = self._create_tracked_task(
            read(), name=f"yeelight_cube_matrix_demo_{self._ip}",
        )

    def _refuse_matrix_native(self) -> None:
        """Matter failed: what is selected is streamed over the LAN until
        Matter is tried again (_retry_matrix_native)."""
        if not self._matrix_native_refused:
            self._matrix_refused_at = time.monotonic()
        self._matrix_native_refused = True

    def _retry_matrix_native(self, link_back: bool = False) -> bool:
        """Try Matter again for a lamp streamed since Matter failed: from the
        minute check once MATTER_RETRY_FIRST (then twice as long, up to
        MATTER_RETRY_MOST) has passed, or when the Matter link comes back
        (``link_back``, after MATTER_RETRY_LEAST). What is selected is then
        shown again the way it now can be (_matrix_matter_changed): by the
        lamp itself, or streamed over Matter. Whether it did."""
        if not self.is_cube_matrix or not self._matrix_native_refused or not self.matrix_matter_ready():
            return False
        waited = time.monotonic() - self._matrix_refused_at
        if waited < (MATTER_RETRY_LEAST if link_back else self._matrix_retry_after):
            return False
        self._matrix_native_refused = False
        self._matrix_stream_failures = 0
        # Failing again waits twice as long; a success resets it.
        self._matrix_retry_after = min(MATTER_RETRY_MOST, self._matrix_retry_after * 2)
        _LOGGER.info("[MATRIX] [%s] Trying Matter again after it failed %.0f s ago", self._ip, waited)
        self._matrix_matter_changed()
        return True

    def _matrix_matter_changed(self) -> None:
        """Matter became available or not (the link, the server, the demo
        loop): what is selected is shown again the way it now can be."""
        if not self.is_cube_matrix or not self._is_on or self.hass is None:
            return
        native = self.matrix_native_command() is not None
        if self._mode in (MODE_NATIVE_EFFECT, MODE_CLOCK):
            if native == (self._matrix_shown is not None):
                return
        elif self.matrix_draws_over_matter() == (self._matrix_shown is not None):
            return
        self._matrix_shown = None
        self._create_tracked_task(
            self.async_apply_display_mode(update_type="text_change"),
            name=f"yeelight_cube_matrix_matter_{self._ip}",
        )
