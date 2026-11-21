"""What the light's controls and actions do to it: its public API.

The select, switch, number and text entities (select.py, ...) and the
actions (light_services_*.py) change the light through these methods and
read it through these properties, never through its private state: each
method changes the state, applies it (async_apply_display_mode) and tells
the controls that show it (light_state._notify), in that order.

Owns ActionsMixin, that API: what the controls read (this module, with
the preview cameras' snapshot, PreviewState and preview_state), and, by
kind of action, what they do: the display (light_actions_display.py), the
built-in modes (light_actions_native.py) and the diagnostics actions
(light_actions_diagnostics.py). Used only as a mixin of
:class:`YeelightCubeLight`.
"""
from __future__ import annotations

from dataclasses import dataclass
from .clock_face import clock_content, clock_geometry
from .const import MATRIX_DISPLAY_MODES
from .light_actions_diagnostics import DiagnosticActionsMixin
from .light_actions_display import DisplayActionsMixin
from .light_actions_native import NativeActionsMixin


@dataclass(frozen=True, slots=True)
class PreviewState:
    """The light's state a preview camera draws a frame from
    (ActionsMixin.preview_state)."""

    is_on: bool
    brightness: int
    mode: str
    base_matrix_colors: list | None
    music_flow_enabled: bool
    music_flow_effect: str
    orientation: str
    display_frozen: bool
    display_frozen_at: float | None
    text_colors: list | None
    native_effect: str
    native_effect_direction: str
    native_effect_speed: int
    native_effect_intensity: int
    native_effect_color_mode: str
    native_effect_color: int | None
    stored_gif: object
    animation_layout: object
    clock_style: int
    clock_content: str
    clock_12_hour: bool
    clock_colon_blink: bool
    clock_color: int | None
    clock_color_mode: str
    lamp_turns_clock: bool
    columns: int | None
    # The frame's stride (device_profile.width: 20, or 5 a module of a Cube
    # Matrix of more than 4 modules): frames are width x 5.
    width: int = 20
    # Where the clock's digits go (clock_face.clock_geometry: columns, width
    # and the blocks' columns, a Spot's left out): clock_digit_pixels'
    # keyword arguments.
    clock_geometry: dict | None = None


class ActionsMixin(DisplayActionsMixin, NativeActionsMixin, DiagnosticActionsMixin):
    """The light's public API for its controls and actions."""

    # ── What the controls read ──────────────────────────────────────────
    @property
    def unique_id(self) -> str:
        return self._attr_unique_id

    @property
    def ip(self) -> str:
        return self._ip

    @property
    def lamp_name(self) -> str:
        return self._lamp_name

    @property
    def lamp_client(self):
        """The lamp's connection (lamp_client.LampClient)."""
        return self._lamp_client

    @property
    def entry_id(self) -> str:
        """The lamp's config entry."""
        return self._config_entry.entry_id

    def connection_diagnostics(self) -> dict:
        """The connection's recent trouble, for the diagnostics."""
        return {
            "last_connection_error": self._last_connection_error,
            "display_retries": self._display_retry_count,
            "recent_hard_timeouts": len(self._hard_timeout_times),
            "operation": self._hardware_operation_phase,
        }

    def attach_cameras(self, cameras: list) -> None:
        """The preview cameras, told of every new frame (camera.py)."""
        self._camera_entities = list(cameras)

    def detach_camera(self, camera) -> None:
        """A camera removed is no longer told of frames."""
        if camera in self._camera_entities:
            self._camera_entities.remove(camera)

    def add_control(self, entity) -> None:
        """A control rewritten when the lamp's availability changes
        (entity.CubeControlEntity), until remove_control."""
        self._control_entities.add(entity)

    def remove_control(self, entity) -> None:
        self._control_entities.discard(entity)

    @property
    def mode(self) -> str:
        """What the light shows: a lamp mode (const.LAMP_MODES) or a Matrix
        render mode."""
        return self._mode

    @property
    def matrix_mode(self) -> str:
        """The Matrix render mode the light comes back to."""
        return self._matrix_mode

    @property
    def custom_draw_active(self) -> bool:
        return self._custom_draw_active

    @property
    def active_pixel_art_name(self):
        return self._active_pixel_art_name

    @property
    def native_effect(self) -> str:
        return self._native_effect

    @property
    def native_effect_direction(self) -> str:
        return self._native_effect_direction

    @property
    def native_clock_style(self) -> int:
        return self._native_clock_style

    @property
    def native_clock_content(self) -> str:
        return self._native_clock_content

    @property
    def music_flow_enabled(self) -> bool:
        return self._music_flow_enabled

    @property
    def scroll_enabled(self) -> bool:
        return self._scroll_enabled

    @property
    def rotation_active(self) -> bool:
        """Whether an effect rotation runs (light_rotation)."""
        return bool(self._rotation_active)

    @property
    def angle(self) -> float:
        return self._angle

    @property
    def frame_width(self) -> int:
        """The columns of the lamp's frames (device_profile.width: 20, or 5
        a module of a Cube Matrix of more than 4 modules)."""
        return self._panel_width()

    def preview_state(self) -> PreviewState:
        """What the preview cameras draw from (camera.py), read at once: one
        frame never mixes two states of the light."""
        return PreviewState(
            is_on=self._is_on,
            brightness=self._brightness,
            mode=self._mode,
            base_matrix_colors=self._base_matrix_colors,
            music_flow_enabled=self._music_flow_enabled,
            music_flow_effect=self._music_flow_effect,
            orientation=self._device_orientation,
            display_frozen=self._display_frozen,
            display_frozen_at=self._display_frozen_at,
            text_colors=self._text_colors,
            native_effect=self._native_effect,
            native_effect_direction=self._native_effect_direction,
            native_effect_speed=self._native_effect_speed,
            native_effect_intensity=self._native_effect_intensity,
            native_effect_color_mode=self._native_effect_color_mode,
            native_effect_color=self._native_effect_color,
            stored_gif=self._stored_gif,
            animation_layout=self._animation_layout,
            clock_style=self._native_clock_style,
            clock_content=clock_content(self),
            clock_12_hour=self._native_clock_12_hour,
            clock_colon_blink=self._native_clock_colon_blink,
            clock_color=self._native_clock_color,
            clock_color_mode=self._native_clock_color_mode,
            lamp_turns_clock=self.lamp_turns_clock,
            columns=self.device_profile.columns,
            width=self.device_profile.width,
            clock_geometry=clock_geometry(self.device_profile),
        )

    def setting(self, attr: str, default=None):
        """A setting a control shows by its attribute name (select.py's
        SETTING_SELECTS, number.py's SETTING_NUMBERS, the clock switches)."""
        return getattr(self, attr, default)

    def set_setting(self, attr: str, value) -> None:
        """Store a setting a control sets by its attribute name, without
        applying it (the control does what follows)."""
        setattr(self, attr, value)

    def can_take_commands(self) -> bool:
        """Whether a command may reach the lamp now: on, or turned on by it
        (the auto-turn-on option)."""
        return self._is_on or self._should_auto_turn_on()

    def write_effect_settings(self) -> None:
        """Publish the shared effect settings' controls (speed, intensity):
        their value or availability follows the effect and the mode."""
        self._notify("native_effect_speed", "native_effect_intensity")

    def remember_matrix_mode(self) -> None:
        """The Matrix render mode shown, if one is, is the one to come back to
        (the display mode select, as it is updated)."""
        if self._mode in MATRIX_DISPLAY_MODES:
            self._enter_mode(matrix_mode=self._mode)

    def notify_camera_preview(self) -> None:
        """The preview cameras draw the lamp again (_notify_camera_preview)."""
        self._notify_camera_preview()

    def refresh_controls(self) -> None:
        """Every control shows the light's state again."""
        self._refresh_linked_entities()
