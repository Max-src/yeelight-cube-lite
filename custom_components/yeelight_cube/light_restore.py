"""Display state persistence for the Yeelight Cube Lite light entity.

Restoring the settings saved in the last state after a Home Assistant restart
(table-driven, see _RESTORED_ATTRIBUTES), and the in-memory snapshot used by
the save_state / restore_state actions. Mixed into YeelightCubeLight.
"""
import logging
import copy

from .const import (
    ALL_NATIVE_EFFECTS,
    CLOCK_COLOR_MODES,
    DEVICE_ORIENTATIONS,
    DEVICE_ORIENTATION_TO_FLIP,
    FIRMWARE_MODES,
    MATRIX_DISPLAY_MODES,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECTS,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECT_RENAMES,
    ORIENTATION_FLIPPED,
    ORIENTATION_NORMAL,
    POWER_ON_STATES,
    TRANSITION_TYPES,
)
from .layout import FONT_MAPS

_LOGGER = logging.getLogger(__name__)


# ── State restore after a Home Assistant restart ────────────────────────────
# A converter returns the value to restore, or _INVALID to keep the default.
_INVALID = object()


def _member_of(options):
    return lambda value: value if value in options else _INVALID


def _clamped(convert, low, high):
    return lambda value: max(low, min(high, convert(value)))


def _int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _rgb_list(value):
    if (
        isinstance(value, (list, tuple)) and len(value) == 3
        and all(type(channel) is int and 0 <= channel <= 255 for channel in value)
    ):
        return list(value)
    return _INVALID


def _native_effect_name(value):
    # Migrate legacy names (e.g. "Ribbon") to current app names.
    name = NATIVE_EFFECT_RENAMES.get(value, value)
    return name if name in ALL_NATIVE_EFFECTS else _INVALID


def _button_effect_names(value):
    if not isinstance(value, list):
        return _INVALID
    return [
        NATIVE_EFFECT_RENAMES.get(name, name)
        for name in value
        if NATIVE_EFFECT_RENAMES.get(name, name) in NATIVE_EFFECTS
        or name.startswith("Clock: ")
    ][:8]


def _bool_only(value):
    return value if isinstance(value, bool) else _INVALID


# State attribute -> (entity attribute, converter), restored in this order.
# Missing or None attributes are skipped, and so is a value the converter
# rejects. Values that depend on each other (brightness, text colors, mode,
# clock content, orientation) are restored in YeelightCubeLight._restore_state.
_RESTORED_ATTRIBUTES = (
    # Preview adjustments (preview_darken is derived from brightness instead)
    ("preview_brighten", "_preview_brighten", int),
    ("preview_hue_shift", "_preview_hue_shift", int),
    ("preview_temperature", "_preview_temperature", int),
    ("preview_saturation", "_preview_saturation", int),
    ("preview_vibrance", "_preview_vibrance", int),
    ("preview_contrast", "_preview_contrast", int),
    ("preview_glow", "_preview_glow", int),
    ("preview_grayscale", "_preview_grayscale", int),
    ("preview_invert", "_preview_invert", int),
    ("preview_tint_hue", "_preview_tint_hue", int),
    ("preview_tint_strength", "_preview_tint_strength", int),
    # Native clock
    ("clock_style_id", "_native_clock_style", lambda v: int(v) if int(v) in NATIVE_CLOCK_STYLES else _INVALID),
    ("clock_show_date", "_native_clock_show_date", bool),
    ("clock_12_hour", "_native_clock_12_hour", bool),
    ("clock_colon_blink", "_native_clock_colon_blink", bool),
    ("clock_color", "_native_clock_color", _int_or_none),
    ("clock_color_mode", "_native_clock_color_mode", _member_of(CLOCK_COLOR_MODES)),
    # Native effects and Music Flow
    ("native_effect_color", "_native_effect_color", _rgb_list),
    ("native_effect_color_mode", "_native_effect_color_mode", _member_of(CLOCK_COLOR_MODES)),
    ("native_effect", "_native_effect", _native_effect_name),
    ("native_effect_speed", "_native_effect_speed", _clamped(int, 1, 255)),
    ("native_effect_direction", "_native_effect_direction", _member_of(NATIVE_EFFECT_DIRECTION_VALUES)),
    ("music_flow_enabled", "_music_flow_enabled", bool),
    ("music_flow_effect", "_music_flow_effect", _member_of(MUSIC_FLOW_EFFECTS)),
    ("music_flow_restore_power", "_music_flow_restore_power", _bool_only),
    ("power_on_state", "_power_on_state", _member_of(POWER_ON_STATES)),
    ("button_effects", "_button_effects", _button_effect_names),
    # Text and layout
    ("custom_text", "_custom_text", lambda v: v),
    ("background_color", "_background_color", tuple),
    ("alignment", "_alignment", _member_of(("left", "center", "right"))),
    ("font", "_font", _member_of(FONT_MAPS)),
    ("angle", "_angle", float),
    # Transitions and scrolling
    ("transition_type", "_transition_type", _member_of(TRANSITION_TYPES)),
    ("transition_steps", "_transition_steps", _clamped(int, 1, 10)),
    ("transition_duration", "_transition_duration", _clamped(float, 0.2, 10.0)),
    ("scroll_speed", "_scroll_speed", float),
    ("scroll_enabled", "_scroll_enabled", bool),
)


class StateRestoreMixin:
    """Restore after a restart, and the save_state / restore_state snapshot."""

    def _restore_extended_effects(self, old_state) -> None:
        saved = self._config_entry.options.get("extended_effects_enabled")
        if isinstance(saved, bool):
            self._extended_effects_enabled = saved
        elif old_state is not None:
            legacy = old_state.attributes.get("extended_effects_enabled")
            if isinstance(legacy, bool):
                self.set_extended_effects_enabled(legacy)

    def _restore_state(self, old_state) -> None:
        """Restore the display settings saved in the last state before a
        Home Assistant restart (see _RESTORED_ATTRIBUTES)."""
        attributes = old_state.attributes
        _LOGGER.debug("[RESTORE] old_state=%s, attributes=%s", old_state.state, list(attributes))
        for key, attr, convert in _RESTORED_ATTRIBUTES:
            raw = attributes.get(key)
            if raw is None:
                continue
            try:
                value = convert(raw)
            except (TypeError, ValueError):
                _LOGGER.debug("[RESTORE] [%s] Ignoring invalid %s=%r", self._ip, key, raw)
                continue
            if value is not _INVALID:
                setattr(self, attr, value)

        if attributes.get("brightness") is not None:
            restored_brightness = int(attributes["brightness"])
            # Ensure brightness is at least 1 (Home Assistant minimum for ON lights)
            self._brightness = max(1, min(255, restored_brightness))
            # Recalculate hardware brightness and darken from user brightness
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            self._preview_darken = darken_percent
            self._last_hardware_brightness = hardware_brightness
            self._last_applied_darken = darken_percent
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] RESTORE -- raw=%s -> user=%s/255, hardware=%s%%, darken=%s%%",
                self._ip, restored_brightness, self._brightness, hardware_brightness, darken_percent,
            )

        if attributes.get("text_colors") is not None:
            self._text_colors = [tuple(c) for c in attributes["text_colors"]]
            self._sync_rgb_color()
        else:
            # Older states kept rgb_color (+ gradient_start / gradient_end)
            rgb = attributes.get("rgb_color")
            grad_start = attributes.get("gradient_start")
            grad_end = attributes.get("gradient_end")
            if rgb and grad_start and grad_end:
                self._text_colors = [tuple(rgb), tuple(grad_end)]
                self._sync_rgb_color()
            elif rgb:
                self._text_colors = [tuple(rgb)]
                self._sync_rgb_color()
            else:
                _LOGGER.warning(
                    "[RESTORE] No text_colors found, keeping defaults: %s", self._text_colors
                )

        # Mode and custom_draw_active (old states: mode 'Custom Draw')
        if attributes.get("custom_draw_active") is not None:
            self._custom_draw_active = bool(attributes["custom_draw_active"])
        else:
            self._custom_draw_active = attributes.get("mode") == "Custom Draw"
        restored_mode = attributes.get("mode")
        if restored_mode in MATRIX_DISPLAY_MODES or restored_mode in FIRMWARE_MODES:
            self._mode = restored_mode
        matrix_mode = attributes.get("matrix_mode")
        if matrix_mode in MATRIX_DISPLAY_MODES:
            self._matrix_mode = matrix_mode
        elif self._mode in MATRIX_DISPLAY_MODES:
            self._matrix_mode = self._mode

        # Clock content (3-way): restore directly if present, otherwise
        # migrate from the legacy boolean show_date flag, then keep the compat
        # boolean consistent with it.
        restored_content = attributes.get("clock_content")
        if restored_content in NATIVE_CLOCK_CONTENT_OPTIONS:
            self._native_clock_content = restored_content
        else:
            self._native_clock_content = (
                "time_date" if self._native_clock_show_date else "time"
            )
        self._native_clock_show_date = self._native_clock_content == "time_date"

        # The 4-way physical device orientation (right/down/left/up) is the
        # source of truth for native-effect flow and matrix/pixel flip; keep
        # the legacy normal/flipped flag consistent with it.
        device_orientation_val = attributes.get("device_orientation")
        if device_orientation_val in DEVICE_ORIENTATIONS:
            self._device_orientation = device_orientation_val
            self._orientation = DEVICE_ORIENTATION_TO_FLIP[device_orientation_val]
        elif attributes.get("orientation") in (ORIENTATION_NORMAL, ORIENTATION_FLIPPED):
            # Legacy state that only stored normal/flipped.
            self._orientation = attributes["orientation"]
            self._device_orientation = (
                "left" if self._orientation == ORIENTATION_FLIPPED else "right"
            )

    # Display-state attributes captured by save_state / restore_state.
    # Together these fully determine what the panel is showing: content,
    # mode, colors, layout, brightness and all color effects.
    _DISPLAY_STATE_ATTRS = (
        "_custom_text", "_text_colors", "_mode", "_matrix_mode", "_native_clock_style",
        "_native_clock_show_date", "_native_clock_content", "_native_clock_12_hour",
        "_native_clock_colon_blink", "_native_clock_color", "_full_panel",
        "_native_effect", "_native_effect_speed", "_native_effect_direction", "_native_effect_color_mode", "_native_effect_color",
        "_music_flow_effect",
        "_angle",
        "_background_color", "_alignment", "_font", "_orientation",
        "_device_orientation", "_rgb_color",
        "_brightness", "_custom_pixels", "_custom_draw_active",
        "_active_pixel_art_name", "_scroll_enabled", "_scroll_speed",
        "_preview_hue_shift", "_preview_temperature", "_preview_saturation",
        "_preview_vibrance", "_preview_contrast", "_preview_glow",
        "_preview_grayscale", "_preview_invert", "_preview_tint_hue",
        "_preview_tint_strength", "_preview_darken", "_preview_brighten",
        "_is_on",
    )

    def _save_display_state(self):
        """Snapshot the current display state into self._saved_display_state.

        Overwrites any previously saved snapshot -- only one is kept per
        entity.  Values are deep-copied so later mutations to lists like
        _custom_pixels / _text_colors don't corrupt the snapshot."""
        self._saved_display_state = {
            attr: copy.deepcopy(getattr(self, attr, None))
            for attr in self._DISPLAY_STATE_ATTRS
        }

    def _restore_display_state(self):
        """Restore attributes from the saved snapshot and refresh linked
        helper entities.  Returns True if a snapshot existed, False otherwise.
        The caller is responsible for triggering the hardware re-render."""
        snapshot = self._saved_display_state
        if not snapshot:
            return False
        for attr, value in snapshot.items():
            setattr(self, attr, copy.deepcopy(value))
        # Migration: pre-4-way states saved only _orientation. If the device
        # orientation wasn't restored but the legacy flip is on, treat it as
        # "left" (the flipped equivalent) so the new select stays consistent.
        if self._orientation == ORIENTATION_FLIPPED \
                and self._device_orientation == "right":
            self._device_orientation = "left"
        # Reset scroll so restored text starts cleanly from the beginning.
        self._scroll_offset = 0
        self._scroll_direction = 1
        self.stop_scroll_timer()
        self._refresh_linked_entities()
        return True
