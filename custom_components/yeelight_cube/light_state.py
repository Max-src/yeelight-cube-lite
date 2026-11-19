"""What the light shows and what the lamp is in, and who is told when it
changes.

The light's display state (what it shows: _mode, the Matrix render mode it
comes back to, whether its drawing is the content, whether a text scrolls,
whether the picture is frozen) and the lamp's hardware state (direct mode,
a built-in mode, the hardware brightness last sent) are written here only,
through named transitions, so every writer changes them together and the
same way. Everything else reads them as attributes.

The light's controls (select, switch, number, text, sensor and event
entities) listen to it (add_listener) instead of the light keeping a
reference to each: the light tells a topic (_notify) and every entity
listening to it updates its own state (async_update_from_light or
async_write_ha_state, from the entity). Used only as a mixin of
:class:`YeelightCubeLight`.
"""
from __future__ import annotations

import logging
from collections.abc import Callable

from .const import DEFAULT_MATRIX_DISPLAY_MODE

_LOGGER = logging.getLogger(__name__)

# An argument a transition leaves as it is.
KEEP = object()

# What the light's controls listen to (add_listener), by the control told.
TOPICS = frozenset({
    # Display controls.
    "text_input", "pixel_art", "display_mode", "content_mode", "clock_style",
    "clock_show_date", "clock_12_hour", "clock_colon_blink", "clock_content",
    "alignment", "font", "angle", "animation_layout", "device_orientation",
    "scroll_enabled", "scroll_speed", "preview_adjustments",
    # Built-in mode controls.
    "native_effect", "native_effect_direction", "native_effect_speed",
    "native_effect_intensity", "music_flow_effect", "power_on_state",
    "matrix_power_on",
    # Sensors, events and Matter-dependent controls.
    "power", "power_cycle", "energy", "matter_link", "lamp_buttons",
    "lamp_button_event", "buttons_as_remote",
})


class LightStateMixin:
    """The display and hardware state's transitions, and the listeners."""

    def _init_light_state(self) -> None:
        """What the light shows and what the lamp is in. Called by
        YeelightCubeLight.__init__."""
        # What the light shows (const.LAMP_MODES or a Matrix render mode),
        # and the Matrix render mode it comes back to from a lamp mode.
        self._mode = DEFAULT_MATRIX_DISPLAY_MODE
        self._matrix_mode = DEFAULT_MATRIX_DISPLAY_MODE
        # Whether the drawing (_custom_pixels) is the content shown.
        self._custom_draw_active = False
        # Whether a text is scrolling (scroll_text's timer runs).
        self._is_scrolling = False
        # True while the panel is frozen on its current frame (freeze_display).
        # Cleared by the next display re-apply. The camera preview reads this to
        # hold the background animation on the frozen frame.
        self._display_frozen = False
        # Wall-clock instant the freeze began; the camera freezes the clock's
        # background phase at exactly this moment, not at the next render.
        self._display_frozen_at = None
        # Whether the lamp is in direct mode (frames over update_leds), so a
        # frame needs no activate_fx_mode first.
        self._fx_mode_is_direct = False
        # When activate_fx_mode last succeeded (its staleness: _direct_mode_trusted).
        self._last_fx_mode_time = 0.0
        # True when the lamp is physically in a built-in mode (clock,
        # native animation, or start_cf color flow). When True, ensure_fx_ready()
        # must use a longer settle + graceful FIN to avoid the lamp resetting to
        # the ribbon (default loading state) during the mode transition.
        self._in_native_fw_mode = False
        # True when that built-in mode is Home Assistant's own picture (a Cube
        # Matrix's drawing over Matter, light_matrix): updates of the
        # picture (a new text, a scroll step) are not the lamp's own content
        # competing with it (light_display's guard).
        self._shows_own_drawing = False
        # The hardware brightness last sent to the lamp (None: unknown, sent
        # again with the next frame or mode).
        self._last_hardware_brightness = None
        # The light's controls, by topic (add_listener).
        self._listeners: dict[str, list[Callable]] = {}

    # ── What the light shows ────────────────────────────────────────────
    def _enter_mode(self, mode=KEEP, *, matrix_mode=KEEP, custom_draw=KEEP) -> None:
        """Show ``mode`` (the Matrix render mode to come back to and whether
        the drawing is the content, each when given). Only the state: the
        caller applies it (async_apply_display_mode)."""
        if mode is not KEEP:
            self._mode = mode
        if matrix_mode is not KEEP:
            self._matrix_mode = matrix_mode
        if custom_draw is not KEEP:
            self._custom_draw_active = bool(custom_draw)

    def _set_scrolling(self, scrolling: bool) -> None:
        """Whether a text scrolls now (scroll_text's timer)."""
        self._is_scrolling = scrolling

    def _set_display_frozen(self, frozen: bool, at=KEEP) -> None:
        """Whether the panel holds its frame (freeze_display), and since when
        (wall clock) when given."""
        self._display_frozen = frozen
        if at is not KEEP:
            self._display_frozen_at = at

    # ── What the lamp is in ─────────────────────────────────────────────
    def _entered_direct_mode(self, direct: bool = True) -> None:
        """The lamp left its built-in modes for frames: in direct mode, or
        (``direct`` False) streamed where direct mode is set per session."""
        self._fx_mode_is_direct = direct
        self._in_native_fw_mode = False
        self._shows_own_drawing = False
        if direct:
            # Frames over the LAN replace a drawing shown over Matter
            # (light_matrix): it is started again before any setData.
            self._matrix_shown = None

    def _direct_mode_lost(self) -> None:
        """The lamp may no longer be in direct mode (a lost connection, a
        command that changes what it shows): the next frame activates it
        again."""
        self._fx_mode_is_direct = False

    def _entered_builtin_mode(self, *, own_drawing: bool = False) -> None:
        """The lamp shows one of its own modes (clock, effect, color flow): no
        longer in direct mode, and leaving it takes the longer settle.
        ``own_drawing``: the mode shows Home Assistant's picture (a Cube
        Matrix's drawing over Matter), which its next updates replace."""
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True
        self._shows_own_drawing = own_drawing

    def _left_builtin_mode(self) -> None:
        """The lamp no longer shows one of its own modes."""
        self._in_native_fw_mode = False
        self._shows_own_drawing = False

    def _note_hardware_brightness(self, level) -> None:
        """The lamp's hardware brightness is ``level`` (sent, or None: unknown,
        sent again with the next frame or mode)."""
        self._last_hardware_brightness = level

    def _forget_hardware_brightness(self) -> None:
        """The lamp's hardware brightness is unknown: sent again."""
        self._last_hardware_brightness = None

    # ── Listeners ───────────────────────────────────────────────────────
    def add_listener(self, topic: str, listener: Callable) -> Callable[[], None]:
        """Call ``listener`` whenever the light tells ``topic`` (TOPICS), with
        the arguments it tells; returns what stops it."""
        if topic not in TOPICS:
            raise ValueError(f"Unknown light topic: {topic}")
        listeners = self._listeners.setdefault(topic, [])
        listeners.append(listener)

        def remove() -> None:
            if listener in listeners:
                listeners.remove(listener)

        return remove

    def _notify(self, *topics: str, args: tuple = ()) -> None:
        """Tell every listener of each topic, in order (each with ``args``)."""
        for topic in topics:
            for listener in tuple(self._listeners.get(topic, ())):
                listener(*args)
