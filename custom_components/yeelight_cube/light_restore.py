"""Display state persistence for the Yeelight Cube Lite light entity.

Restoring the settings saved in the last state after a Home Assistant restart
(each declared once, in SETTINGS: published and restored from it), and the in-memory snapshot used by
the save_state / restore_state actions. Mixed into YeelightCubeLight.
"""
import logging
import copy
from collections.abc import Callable
from typing import NamedTuple

from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers.restore_state import ExtraStoredData  # type: ignore

from .const import (
    DEVICE_ORIENTATIONS,
    DEVICE_ORIENTATION_TO_FLIP,
    LAMP_MODES,
    MATRIX_DISPLAY_MODES,
    ORIENTATION_FLIPPED,
    ORIENTATION_NORMAL,
    LEGACY_POWER_ON_STATES,
    POWER_ON_STATES,
)
from .effect_catalog import (
    ALL_NATIVE_EFFECTS,
    ANIMATION_LAYOUTS,
    LAMP_ANIMATION_EFFECTS,
    NATIVE_COLOR_MODES,
    DEFAULT_NATIVE_EFFECT_DIRECTION,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECTS,
    NATIVE_EFFECT_DIRECTION_VALUES,
    BUTTON_CLOCK_PREFIX,
    canonical_button_effect_name,
    clock_style_name_saved_by_1_4,
    canonical_effect_name,
    INTENSITY_RANGE,
    SPEED_RANGE,
)
from .color_adjustments import active_adjustments
from .layout import FONT_MAPS
from .light_display import MAX_TEXT_LENGTH
from .pixel_art_storage import expand_pixels, group_pixels, pixels_at_width
from .storage import async_schedule_save

_LOGGER = logging.getLogger(__name__)


# ── State restore after a Home Assistant restart ────────────────────────────
# A converter returns the value to restore, or _INVALID to keep the default.
_INVALID = object()


def _member_of(options):
    return lambda value: value if value in options else _INVALID


def _power_on_state(value):
    """A saved power-on behavior; an older version's label is read by the
    value it sent (const.LEGACY_POWER_ON_STATES)."""
    value = LEGACY_POWER_ON_STATES.get(value, value)
    return value if value in POWER_ON_STATES else _INVALID


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
    # Any former name (e.g. "Streamer", "Ocean Waves") is today's.
    name = canonical_effect_name(value)
    return name if name in ALL_NATIVE_EFFECTS else _INVALID


def _button_effect_names(value):
    if not isinstance(value, list):
        return _INVALID
    names = [
        canonical_button_effect_name(name) for name in value if isinstance(name, str)
    ]
    return [
        name
        for name in names
        if name in NATIVE_EFFECTS or name.startswith(BUTTON_CLOCK_PREFIX)
    ][:8]


def _stored_gif(value):
    """The stored_gif attribute (light._stored_gif): an animation of
    LAMP_ANIMATION_EFFECTS or none, its mount, an interrupted upload."""
    if not isinstance(value, dict):
        return _INVALID
    keys = {spec["animation"] for spec in LAMP_ANIMATION_EFFECTS.values()}
    animation = value.get("animation")
    stored = {
        "animation": animation if animation in keys else None,
        "upside_down": value.get("upside_down") is True,
        "interrupted": value.get("interrupted") is True,
    }
    # Its layout (effect_catalog.ANIMATION_LAYOUTS); none before layouts existed: upright.
    if value.get("layout") in ANIMATION_LAYOUTS:
        stored["layout"] = value["layout"]
    # Its speed and color adjustments; none before they were in it: the
    # default speed, no adjustment.
    speed = value.get("speed")
    if isinstance(speed, int) and not isinstance(speed, bool) and (
        SPEED_RANGE[0] <= speed <= SPEED_RANGE[1]
    ):
        stored["speed"] = speed
    adjustments = value.get("adjustments")
    if isinstance(adjustments, dict) and all(
        isinstance(number, int) and not isinstance(number, bool)
        for number in adjustments.values()
    ):
        stored["adjustments"] = active_adjustments(adjustments)
    # The Studio palette its frames were recolored in (none: its own colors).
    palette = value.get("palette")
    if isinstance(palette, list) and palette and all(
        isinstance(colour, list) and len(colour) == 3
        and all(isinstance(channel, int) and not isinstance(channel, bool) and 0 <= channel <= 255
                for channel in colour)
        for colour in palette
    ):
        stored["palette"] = palette
    return stored


def _bool_only(value):
    return value if isinstance(value, bool) else _INVALID


def _text(value):
    """A saved text, cut to the longest shown (an older version took any)."""
    return value[:MAX_TEXT_LENGTH] if isinstance(value, str) else _INVALID


def _rgb_tuple(value):
    rgb = _rgb_list(value)
    return rgb if rgb is _INVALID else tuple(rgb)


class Setting(NamedTuple):
    """A setting kept across a restart, declared once: published as ``key``
    (extra_state_attributes, saved apart too: extra_restore_state_data) from
    the light's ``attr``, and restored from it through ``convert``, which
    returns the value or _INVALID to keep the light's default (its
    _init_*_state). ``published``: whether a light publishes it (default:
    every light); ``copy``: what is published from the value (default: the
    value)."""
    key: str
    attr: str
    convert: Callable
    published: Callable | None = None
    copy: Callable | None = None


# The settings, restored in this order. Missing or None attributes are
# skipped, and so is a value the converter rejects. Values that depend on
# each other (RESTORED_APART) are restored in _restore_state.
SETTINGS = (
    # Preview adjustments
    Setting("preview_hue_shift", "_preview_hue_shift", int),
    Setting("preview_temperature", "_preview_temperature", int),
    Setting("preview_saturation", "_preview_saturation", int),
    Setting("preview_vibrance", "_preview_vibrance", int),
    Setting("preview_contrast", "_preview_contrast", int),
    Setting("preview_glow", "_preview_glow", int),
    Setting("preview_grayscale", "_preview_grayscale", int),
    Setting("preview_invert", "_preview_invert", int),
    Setting("preview_tint_hue", "_preview_tint_hue", int),
    Setting("preview_tint_strength", "_preview_tint_strength", int),
    # Native clock
    Setting("clock_style_id", "_native_clock_style", lambda v: int(v) if int(v) in NATIVE_CLOCK_STYLES else _INVALID),
    Setting("clock_show_date", "_native_clock_show_date", bool),
    Setting("clock_12_hour", "_native_clock_12_hour", bool),
    Setting("clock_colon_blink", "_native_clock_colon_blink", bool),
    Setting("clock_color", "_native_clock_color", _int_or_none),
    Setting("clock_color_mode", "_native_clock_color_mode", _member_of(NATIVE_COLOR_MODES)),
    # Native effects and Music Flow
    Setting("native_effect_color", "_native_effect_color", _rgb_list),
    Setting("native_effect_color_mode", "_native_effect_color_mode", _member_of(NATIVE_COLOR_MODES)),
    Setting("native_effect", "_native_effect", _native_effect_name),
    Setting("native_effect_speed", "_native_effect_speed", _clamped(int, *SPEED_RANGE)),
    Setting("native_effect_intensity", "_native_effect_intensity", _clamped(int, *INTENSITY_RANGE)),
    Setting("native_effect_direction", "_native_effect_direction", _member_of(NATIVE_EFFECT_DIRECTION_VALUES)),
    Setting("music_flow_enabled", "_music_flow_enabled", bool),
    Setting("music_flow_effect", "_music_flow_effect", _member_of(MUSIC_FLOW_EFFECTS)),
    Setting("music_flow_restore_power", "_music_flow_restore_power", _bool_only),
    Setting("stored_gif", "_stored_gif", _stored_gif),
    Setting("animation_layout", "_animation_layout", _member_of(ANIMATION_LAYOUTS)),
    Setting("power_on_state", "_power_on_state", _power_on_state),
    Setting("button_effects", "_button_effects", _button_effect_names, copy=list),
    # Text and layout
    Setting("custom_text", "_custom_text", _text),
    Setting("background_color", "_background_color", _rgb_tuple),
    Setting("alignment", "_alignment", _member_of(("left", "center", "right"))),
    Setting("font", "_font", _member_of(FONT_MAPS)),
    Setting("angle", "_angle", float),
    Setting("full_panel", "_full_panel", _bool_only),
    # Scrolling
    Setting("scroll_speed", "_scroll_speed", float),
    Setting("scroll_enabled", "_scroll_enabled", bool),
    # Power
    Setting("power_limit", "_power_limit", _clamped(float, 0.4, 7.0)),
    # Streams: a Cube Lite's stream frame rate limit (a Cube Matrix has none).
    Setting("lite_stream_fps", "_lite_stream_fps", _clamped(int, 1, 25),
            published=lambda light: not light.is_cube_matrix),
)

# (published key, entity attribute, converter), as _restore_state reads them.
_RESTORED_ATTRIBUTES = tuple((s.key, s.attr, s.convert) for s in SETTINGS)

# What _restore_state restores itself: values that depend on each other or
# on older versions' names ("brightness" and "is_on" are saved apart only,
# extra_restore_state_data), and "external_display"
# (light_lifecycle.async_added_to_hass).
RESTORED_APART = frozenset({
    "brightness", "is_on", "text_colors", "rgb_color", "mode", "matrix_mode",
    "custom_draw_active", "clock_content", "effect_direction_own",
    "device_orientation", "orientation", "external_display",
})

# Published attributes that are not restored from the state: what the light
# or its lamp is (identity, model, connection, Matter), what follows from the
# settings or shows now, and what is kept elsewhere (favourites and the
# rotation in the integration's storage, the mount profile in the entry's
# options).
NOT_RESTORED = frozenset({
    "_yeelight_cube_component", "light_entity_id", "ip_address",
    "content_mode", "display_frozen", "clock_style", "last_command_error",
    "matrix_own_versions", "matrix_modules", "matrix_module_list",
    "matrix_columns", "native_effect_catalog_key", "connection", "matter",
    "matrix_colors",
    # Kept elsewhere.
    "favourites", "rotation_intervals", "effect_rotation", "mount_profile",
})


def published_settings(light) -> dict:
    """The settings (SETTINGS) as the light publishes them
    (extra_state_attributes)."""
    published = {}
    for setting in SETTINGS:
        if setting.published is not None and not setting.published(light):
            continue
        value = getattr(light, setting.attr)
        published[setting.key] = setting.copy(value) if setting.copy else value
    return published


class StateRestoreMixin:
    """Restore after a restart, and the save_state / restore_state snapshot."""

    def _init_saved_state(self):
        """The save_state / restore_state snapshot. Called by YeelightCubeLight.__init__."""
        # -- Saved display state (save_state / restore_state services) ----
        # Holds a single snapshot of the full display state so an automation
        # can save what the lamp is showing, display something else briefly,
        # then restore the original.  Overwritten each time save_state runs.
        # In-memory only -- does not survive a Home Assistant restart.
        self._saved_display_state = None
        # The rotation running when it was saved (restarted by restore_state).
        self._saved_display_rotation = None
        # Between save_state and restore_state: what an automation shows is
        # deliberate (a text is shown even over the lamp's clock).
        self._display_overlay = False

    # -- The drawing shown in Custom Draw (pixel art, draw card) -------------
    # Kept per lamp in the integration's storage ("drawing") rather than in the
    # state attributes: without it a restart finds Custom Draw with no pixels
    # and falls back to the text.

    def _remember_drawing(self) -> None:
        """Save the Custom Draw pixels about to be shown, if they changed.
        Quick successive changes become one write."""
        store = self._device_store("drawing")
        if store is None or not self._custom_pixels:
            return
        entry = {
            "pixels": group_pixels(self._custom_pixels),
            "name": self._active_pixel_art_name,
            # Positions are row * width + column of the lamp's frame then.
            "width": self.frame_width,
        }
        key = self._music_flow_runtime_storage_key()
        if store.get(key) == entry:
            return
        store[key] = entry
        async_schedule_save(self.hass, 2.0)

    def _restore_drawing(self) -> None:
        """After a restart, show the saved drawing again if the lamp was in
        Custom Draw."""
        if not self._custom_draw_active or self._custom_pixels:
            return
        store = self._device_store("drawing")
        saved = store.get(self._music_flow_runtime_storage_key()) if store else None
        if not isinstance(saved, dict) or not isinstance(saved.get("pixels"), list):
            return
        # Saved at another frame width (a Cube Matrix's modules changed;
        # none saved: 20): placed again from column 0.
        self._custom_pixels = pixels_at_width(expand_pixels(saved["pixels"]), saved.get("width"), self.frame_width)
        if isinstance(saved.get("name"), str):
            self._active_pixel_art_name = saved["name"]
        _LOGGER.debug(
            "[RESTORE] [%s] Restored the Custom Draw drawing (%s pixels, %r)",
            self._ip, len(self._custom_pixels), self._active_pixel_art_name,
        )

    def _drop_extended_effects_option(self) -> None:
        """The Experimental Features option of earlier versions: every effect
        and clock style is offered now, so it is no longer stored."""
        options = self._config_entry.options
        if "extended_effects_enabled" in options:
            self.hass.config_entries.async_update_entry(
                self._config_entry,
                options={
                    key: value for key, value in options.items()
                    if key != "extended_effects_enabled"
                },
            )

    def _restore_state(self, old_state) -> None:
        """Restore the display settings saved in the last state before a
        Home Assistant restart (SETTINGS, then RESTORED_APART)."""
        attributes = old_state.attributes
        _LOGGER.debug("[RESTORE] old_state=%s, attributes=%s", getattr(old_state, "state", None), list(attributes))
        for key, attr, convert in _RESTORED_ATTRIBUTES:
            raw = attributes.get(key)
            if raw is None:
                continue
            try:
                value = convert(raw)
            except (TypeError, ValueError, OverflowError):
                _LOGGER.debug("[RESTORE] [%s] Ignoring invalid %s=%r", self._ip, key, raw)
                continue
            if value is not _INVALID:
                setattr(self, attr, value)

        # On or off as it was: the state, else (the lamp was unreachable at
        # the restart) the settings saved apart. A lamp turned off is not
        # drawn on (pixel data turns it on); its Matter reports correct it.
        power = getattr(old_state, "state", None)
        if power in ("on", "off"):
            self._is_on = power == "on"
        elif isinstance(attributes.get("is_on"), bool):
            self._is_on = attributes["is_on"]

        restored_brightness = _int_or_none(attributes.get("brightness"))
        if restored_brightness is not None:
            # Ensure brightness is at least 1 (Home Assistant minimum for ON lights)
            self._brightness = max(1, min(255, restored_brightness))
            # The lamp's own brightness is not known after a restart: the
            # first update sends it (right after direct mode, before frames).
            self._forget_hardware_brightness()
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] RESTORE -- raw=%s -> user=%s/255",
                self._ip, restored_brightness, self._brightness,
            )

        # A malformed color is left out (one bad value must not stop the
        # light from being added); none left: the default colors.
        saved_colors = attributes.get("text_colors")
        text_colors = [
            rgb for rgb in map(_rgb_tuple, saved_colors) if rgb is not _INVALID
        ] if isinstance(saved_colors, list) else []
        if text_colors:
            self._text_colors = text_colors
            self._sync_rgb_color()
        else:
            # Older states kept rgb_color (+ gradient_start / gradient_end)
            rgb = _rgb_tuple(attributes.get("rgb_color"))
            grad_start = _rgb_tuple(attributes.get("gradient_start"))
            grad_end = _rgb_tuple(attributes.get("gradient_end"))
            if _INVALID not in (rgb, grad_start, grad_end):
                self._text_colors = [rgb, grad_end]
                self._sync_rgb_color()
            elif rgb is not _INVALID:
                self._text_colors = [rgb]
                self._sync_rgb_color()
            else:
                _LOGGER.warning(
                    "[RESTORE] No text_colors found, keeping defaults: %s", self._text_colors
                )

        # Mode and custom_draw_active (old states: mode 'Custom Draw')
        if attributes.get("custom_draw_active") is not None:
            self._enter_mode(custom_draw=bool(attributes["custom_draw_active"]))
        else:
            self._enter_mode(custom_draw=attributes.get("mode") == "Custom Draw")
        restored_mode = attributes.get("mode")
        if restored_mode in MATRIX_DISPLAY_MODES or restored_mode in LAMP_MODES:
            self._enter_mode(restored_mode)
        matrix_mode = attributes.get("matrix_mode")
        if matrix_mode in MATRIX_DISPLAY_MODES:
            self._enter_mode(matrix_mode=matrix_mode)
        elif self._mode in MATRIX_DISPLAY_MODES:
            self._enter_mode(matrix_mode=self._mode)

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

        # Saved when an effect's direction was the mount's: that is what the
        # default now means, on every mount.
        if not attributes.get("effect_direction_own"):
            self._native_effect_direction = DEFAULT_NATIVE_EFFECT_DIRECTION
            # Saved by 1.4.0 or earlier too: a button's clock style as it
            # meant then (the lamp's own list still runs that one), from the
            # names as saved.
            saved = attributes.get("button_effects")
            if isinstance(saved, list):
                names = _button_effect_names([
                    BUTTON_CLOCK_PREFIX + clock_style_name_saved_by_1_4(
                        name.removeprefix(BUTTON_CLOCK_PREFIX)
                    ) if isinstance(name, str) and name.startswith(BUTTON_CLOCK_PREFIX) else name
                    for name in saved
                ])
                if names is not _INVALID:
                    self._button_effects = names

        # The 4-way physical device orientation (right/down/left/up) is the
        # source of truth for the matrix/pixel flip; keep the legacy
        # normal/flipped flag consistent with it.
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
    # mode, colors, layout, brightness and all color effects. Not the power:
    # restoring never turns the lamp on or off (no power command is sent).
    _DISPLAY_STATE_ATTRS = (
        "_custom_text", "_text_colors", "_mode", "_matrix_mode", "_native_clock_style",
        "_native_clock_show_date", "_native_clock_content", "_native_clock_12_hour",
        "_native_clock_colon_blink", "_native_clock_color", "_full_panel",
        "_native_effect", "_native_effect_speed", "_native_effect_intensity", "_native_effect_direction", "_native_effect_color_mode", "_native_effect_color",
        "_music_flow_effect",
        "_angle",
        "_background_color", "_alignment", "_font", "_orientation",
        "_device_orientation", "_rgb_color",
        "_brightness", "_custom_pixels", "_custom_draw_active",
        "_active_pixel_art_name", "_scroll_enabled", "_scroll_speed",
        "_preview_hue_shift", "_preview_temperature", "_preview_saturation",
        "_preview_vibrance", "_preview_contrast", "_preview_glow",
        "_preview_grayscale", "_preview_invert", "_preview_tint_hue",
        "_preview_tint_strength",
    )

    def _display_attributes(self) -> dict:
        """The display state now (_DISPLAY_STATE_ATTRS), deep-copied so later
        mutations to lists like _custom_pixels / _text_colors don't corrupt
        it (save_state, the orientation check)."""
        return {
            attr: copy.deepcopy(getattr(self, attr, None))
            for attr in self._DISPLAY_STATE_ATTRS
        }

    def _running_rotation(self) -> dict | None:
        """The rotation running now (kind, items, interval), or None: what
        is shown in between stops it, so it is started again after."""
        if not (self._rotation_active or self._rotation_resume_pending):
            return None
        return {
            "kind": self._rotation_kind,
            "items": [dict(item) for item in self._rotation_items],
            "interval": self._rotation_interval,
        }

    def _save_display_state(self):
        """Snapshot the current display state into self._saved_display_state.

        Overwrites any previously saved snapshot -- only one is kept per
        entity."""
        self._saved_display_state = self._display_attributes()
        # Over the lamp's clock / native effect, the next text is a
        # deliberate overlay (see _text_waits_for_matrix): shown once.
        self._display_overlay = self._mode in LAMP_MODES
        # The rotation running now: what is shown in between (a text, a
        # pixel art...) stops it, so restore_state starts it again.
        self._saved_display_rotation = self._running_rotation()

    def _restore_display_state(self):
        """Restore attributes from the saved snapshot and refresh linked
        helper entities.  Returns True if a snapshot existed, False otherwise.
        Triggering the hardware re-render is left to the code that calls it."""
        snapshot = self._saved_display_state
        self._display_overlay = False
        if not snapshot:
            return False
        self._apply_display_attributes(snapshot)
        return True

    def _apply_display_attributes(self, snapshot: dict) -> None:
        """Set the display state back (_display_attributes), its linked
        helper entities too; it is re-rendered afterwards."""
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

    def _text_waits_for_matrix(self) -> bool:
        """A text sent while the lamp shows its built-in clock / native effect
        is kept for when it shows text again, without leaving that mode (an
        automation pushing a sensor value must not take the clock over, stop
        its rotation, or report a mode the panel does not show). Between
        save_state and restore_state it is a deliberate overlay: shown, once
        (the text leaves the built-in mode, so the automation's next texts
        show anyway; back on the clock without restore_state, sensor texts
        wait again)."""
        return self._mode in LAMP_MODES and not self._display_overlay

    async def _async_resume_display_rotation(self, saved: dict | None = None) -> bool:
        """After restore_state (or the orientation check, its own ``saved``):
        start again the rotation that ran when the state was saved, if it no
        longer runs and the lamp is on. Started alone, it joins the lamps
        still running it (same item, same steps). True when it started."""
        if saved is None:
            saved = self._saved_display_rotation
        if (
            not saved
            or self._rotation_active
            or self._rotation_resume_pending
            or not self._is_on
        ):
            return False
        try:
            await self.start_effect_rotation(
                saved["items"], saved["interval"], saved["kind"]
            )
            _LOGGER.info(
                "[RESTORE_STATE] [%s] Resumed the %s rotation", self._ip, saved["kind"]
            )
            return True
        except HomeAssistantError as err:
            # An unreachable lamp: the health check resumes a rotation it holds.
            _LOGGER.warning(
                "[RESTORE_STATE] [%s] Could not resume the %s rotation: %s",
                self._ip, saved["kind"], err,
            )


class SavedSettings(ExtraStoredData):
    """A light's settings as saved for a restart apart from its state
    (light.extra_restore_state_data): kept while the lamp is unreachable."""

    def __init__(self, settings: dict) -> None:
        self._settings = settings

    def as_dict(self) -> dict:
        return self._settings
