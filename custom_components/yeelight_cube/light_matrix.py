"""A Cube Matrix's own effects, clock and drawings over Matter, and what its
Matter link reports (device_profile, matrix_effects); a Cube Lite's stream
over Matter.

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

A Cube Lite shared to the Matter server streams the same way (2026-11-16):
its drawing effect (36, OWN_DRAWING_ID as its custom id) started with
setEffect, then each frame's pixels with setData, at 25 a second, each
acknowledged before the next. Filmed: 1,499 frames of 1,499 acknowledged in
60 s, 24.9 picture changes a second, no older picture flashing back (the
LAN stream's UDP frames, never acknowledged, arrive in bursts and showed
older frames). Its frames are the LAN stream's own (light_studio.
_studio_payload: the same renderers, colours, brightness stages and power
limit), only reordered for the drawing (device_profile.drawing_pixels).
Everything else of the Cube Lite (its own effects, clock, pictures, text)
stays on the LAN. Over the LAN (UDP, then TCP) when Matter is not available
or failed, tried again as above. A Matter acknowledgement comes from the
lamp's network part: the stream's check (light_studio._stream_watchdog)
still asks the lamp itself whether it answers.
"""

from __future__ import annotations

import asyncio
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
from .device_profile import CUBEMATRIX
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
    ENGINE_MODES,
    OWN_DRAWING_ID,
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
from .lamp_protocol import decode_rgb_frame
from .matter_commands import EFFECTS_CLUSTER
from .mount_profile import LOW_PAIR, compensate_direction, effective_profile, one_axis_direction

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
# A Cube Lite's stream goes over Matter when it can (lite_streams_over_matter).
LITE_STREAMS_OVER_MATTER = True
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
        """The brightness, when due (matrix_send_brightness; a Cube Lite's in
        its UDP session, which takes it with any effect or drawing)."""
        if not self._native_brightness_due():
            return
        level = hardware_brightness_for(self._brightness)
        await self.matrix_send_brightness(level, udp=not self.is_cube_matrix)
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
        # The lamp runs its drawing effect, showing Home Assistant's picture.
        self._entered_builtin_mode(own_drawing=True)

    # ── The stream over Matter ──────────────────────────────────────────
    def matrix_streams_over_matter(self) -> bool:
        """light_studio's stream goes as the lamp's drawing over Matter
        (_send_matrix_stream_frame), not over the LAN: a Cube Matrix's
        (matrix_draws_over_matter), a Cube Lite's (lite_streams_over_matter)."""
        if self.is_cube_matrix:
            return self.matrix_draws_over_matter()
        return self.lite_streams_over_matter()

    def lite_streams_over_matter(self) -> bool:
        """A Cube Lite whose Matter node is linked and whose Yeelight
        commands a server delivers, Matter not refused lately: its stream goes
        over Matter (module docstring)."""
        if self.is_cube_matrix or not LITE_STREAMS_OVER_MATTER or self._matrix_native_refused:
            return False
        if not self.device_profile.matter or getattr(self, "_music_flow_enabled", False):
            return False
        link, channel = getattr(self, "_matter", None), getattr(self, "_matter_commands", None)
        return bool(getattr(link, "linked", False) and getattr(channel, "backend", None))

    async def _matrix_stream_pixels(self, render: int) -> list:
        """Frame ``render`` of the stream as a drawing's pixels: the same
        frame the LAN stream sends (light_studio._studio_payload; a Cube
        Lite's is that very frame, reordered)."""
        if not self.is_cube_matrix:
            return self.device_profile.drawing_pixels(decode_rgb_frame(await self._studio_payload(render)))
        frame = await self.hass.async_add_executor_job(drawn_in_full, self._own_effect_frame, render)
        # For the previews (light_studio._publish_stream_frame).
        self._studio_rendered = (frame, not self.device_profile.raw_colours)
        return self.device_profile.drawing_pixels(self._lamp_frame(self._brightness_stages(frame)))

    def _standby_pixels(self) -> list:
        """A black frame as the drawing's pixels (the standby stream)."""
        return self.device_profile.drawing_pixels(self._lamp_frame([(0, 0, 0)] * 100))

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
        lite = not self.is_cube_matrix
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
                    custom_id=OWN_DRAWING_ID if lite else 0,
                )
                if lite:
                    # The drawing replaces direct mode: a new UDP session must
                    # not put the lamp back in it (it would leave the drawing).
                    self._lamp_client.end_direct_mode()
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

