import logging
import asyncio
import base64
import copy
import random
import time
import voluptuous as vol # type: ignore
from homeassistant.components.light import LightEntity, ColorMode # type: ignore
from homeassistant.helpers.restore_state import RestoreEntity # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.exceptions import HomeAssistantError # type: ignore
from yeelight import BulbException # type: ignore
from .const import (
    TRANSITION_TYPES,
    FIRMWARE_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    ROTATION_KIND_MODES,
    CONF_DEVICE_ID,
    CONF_IP,
    CLOCK_COLOR_MODES,
    clock_style_default_color,
    DEFAULT_MATRIX_DISPLAY_MODE,
    DEFAULT_MUSIC_FLOW_EFFECT,
    DEFAULT_NATIVE_CLOCK_CONTENT,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
    DEVICE_ORIENTATION_TO_EFFECT_DIR,
    DOMAIN,
    ALL_NATIVE_EFFECTS,
    MATRIX_DISPLAY_MODES,
    MUSIC_FLOW_EFFECT_IDS,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_CONTENT_BYTE,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECT_RENAMES,
    NATIVE_EFFECTS,
    ORIENTATION_FLIPPED,
    ORIENTATION_NORMAL,
    POWER_ON_STATES,
)
from .cube_matrix import (
    CubeConnectionError,
    CubeFxModeLost,
    CubeMatrix,
    encode_rgb_frame,
    RECONNECT_COOLDOWN_INITIAL,
    RECOVERY_CONNECT_TIMEOUT,
    is_connection_error,
    is_quota_error,
)
from .entity import cube_device_info
from .layout import Layout, Module, FONT_MAPS

from .color_utils import argb_to_rgb, hex_to_rgb, rgb_to_argb, rgb_to_hex
from .light_color import ColorPipelineMixin
from .light_transitions import TransitionMixin
from .light_native import NativeModesMixin, _parse_music_flow_config
from .light_render import MatrixRenderMixin

_LOGGER = logging.getLogger(__name__)
_LOGGER.debug("Yeelight Cube Lite light.py module loaded")

# Timing constants
APPLY_POST_DELAY = 0.0        # No post-delay needed -- send_command_fast doesn't wait for responses
APPLY_HARD_TIMEOUT = 12.0      # Seconds -- safety timeout for one hardware operation under the
                               # device lock. When exceeded, asyncio.wait_for cancels it and
                               # releases the lock so queued operations can proceed. Long enough
                               # for activate_fx_mode + draw_matrices on slow Wi-Fi: releasing the
                               # lock between the two shows the default ribbon on the lamp.
                               # Transitions add their duration on top (async_apply_display_mode).
FAVOURITE_KINDS = ("native", "clock")
# Rotation interval bounds (seconds). A step that takes longer to apply than
# the interval lands on the next boundary of the shared time grid.
MIN_ROTATION_INTERVAL = 1
MAX_ROTATION_INTERVAL = 604800  # 7 days
MAX_FAVOURITES = 100          # per lamp and kind
MAX_FAVOURITE_NAME = 100
LOCK_WAIT_WARNING_MS = 3000   # Waiting for the lamp longer than this is logged as a
                              # warning (commands piling up); shorter waits are normal
                              # queueing behind a redraw/transition and logged at debug.
CIRCUIT_BREAKER_WINDOW = 30.0 # Seconds -- if 2+ hard timeouts occur within this window,
                              # reject new operations immediately instead of queueing them
                              # behind the lock for another APPLY_HARD_TIMEOUT each.
FX_MODE_STALENESS_TIMEOUT = 90.0  # Seconds -- re-send activate_fx_mode when _last_fx_mode_time
                                  # (set by activate_fx_mode and by every full frame drawn in
                                  # apply()) is older than this. An idle Cube can leave direct
                                  # FX mode silently: it keeps the TCP connection open and ignores
                                  # update_leds without an error.
MUSIC_FLOW_EXIT_UPDATE_TYPES = {
    "turn_off",
    "brightness_change",
    "text_change",
    "color_change",
    "pixel_art",
}

# NOTE: Per-entity and global pixel art throttle REMOVED.
# The gradient card sends identical update_leds commands rapidly without
# any throttle and works perfectly.  The throttle was actually causing
# sticking: multi-second delays let sockets go stale -> RST + reconnect
# timeout -> retry storm -> lamp stuck for 20-30s.
# JS 300ms debounce provides sufficient rate limiting.

# Global registry to store entity instances for service calls
_ENTITY_REGISTRY = {}


def _entity_id_or_list(value):
    """Voluptuous validator: accept a single entity_id string OR a list of entity_ids.
    
    This allows the JS frontend to send all target entity_ids in ONE service
    call so the backend can dispatch them in parallel via asyncio.gather,
    avoiding the HA WebSocket serialisation that otherwise forces sequential
    execution when multiple callService messages are sent.
    """
    if isinstance(value, str):
        return cv.entity_id(value)
    if isinstance(value, list):
        return [cv.entity_id(v) for v in value]
    raise vol.Invalid(f"Expected entity_id string or list, got {type(value)}")


# Per-device locks to serialize hardware commands to the SAME physical lamp.
# Each IP gets its own asyncio.Lock, so operations to different lamps run
# concurrently without cross-device cascade.  When one lamp is unreachable,
# only that lamp's operations block -- the other lamp continues normally.
# Within a single lamp, the lock ensures command chains (activate_fx_mode  -> 
# set_bright -> update_leds) complete atomically without interleaving.
_DEVICE_LOCKS: dict[str, asyncio.Lock] = {}
# Name of the operation holding each device lock, for the lock-wait log.
_DEVICE_LOCK_HOLDERS: dict[str, str] = {}
# Shared schedules for lamps resuming the same multi-lamp rotation after a
# restart: the first lamp creates it, the others join, so the group shows the
# same item at each step again. Keyed by the group, kind and interval.
_ROTATION_RESUME_TIMELINES: dict = {}
ROTATION_RESUME_TIMELINE_TTL = 300.0  # seconds a late lamp can still join

def _get_device_lock(ip: str) -> asyncio.Lock:
    """Get or create the per-device lock for a given IP."""
    if ip not in _DEVICE_LOCKS:
        _DEVICE_LOCKS[ip] = asyncio.Lock()
    return _DEVICE_LOCKS[ip]


def cleanup_module_state(ip: str) -> None:
    """Remove module-level state for a device being unloaded.

    Called from __init__.async_unload_entry to prevent stale references
    from persisting across integration reloads.
    """
    # Remove IP-keyed entry (set during initial setup)
    _ENTITY_REGISTRY.pop(ip, None)
    # Remove entity_id-keyed entries whose entity references this IP
    stale_keys = [
        key for key, entity in _ENTITY_REGISTRY.items()
        if hasattr(entity, "_ip") and entity._ip == ip
    ]
    for key in stale_keys:
        del _ENTITY_REGISTRY[key]
    # Remove per-device lock
    _DEVICE_LOCKS.pop(ip, None)
    _DEVICE_LOCK_HOLDERS.pop(ip, None)

# 4-way physical device orientation (matches the official app's mount picker).
# The lamp has no single firmware command for this, so we translate it to the
# mechanisms that actually work:
#   - matrix / text / pixel art: normal vs flipped (180 deg) pixel flip
#   - native effects: the effect's own `direction` field
#   - clock: no reorientation available (firmware-fixed)
DEVICE_ORIENTATIONS = ("right", "down", "left", "up")
DEFAULT_DEVICE_ORIENTATION = "right"
# Physical mount -> matrix/text/pixel flip. right/down keep content upright;
# left/up are 180 deg from them (verified against hardware for custom pixel art).
_DEVICE_ORIENTATION_TO_FLIP = {
    "right": ORIENTATION_NORMAL,
    "down": ORIENTATION_NORMAL,
    "left": ORIENTATION_FLIPPED,
    "up": ORIENTATION_FLIPPED,
}
# Native effects and the native clock's mixer follow the physical mount; the
# orientation -> direction map is the shared source of truth in const.py.
_DEVICE_ORIENTATION_TO_EFFECT_DIR = DEVICE_ORIENTATION_TO_EFFECT_DIR

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


# ─────────────────────────────────────────────────────────────────────────────
# MODULE MAP — YeelightCubeLight
# The entity is composed from mixins so each concern lives in its own file. The
# concrete class below inherits them all; every mixin operates purely on ``self``
# (state initialised in __init__ here), so behaviour is identical to one class.
#
#   light.py (this file) — core entity:
#     __init__, HA lifecycle (async_added_to_hass restore /
#     async_will_remove_from_hass cleanup / async_update), connection-health &
#     hardware-op plumbing (_execute_hardware_op, ensure_fx_ready,
#     _periodic_health_check, retry + calibration-lock helpers), public
#     properties + control setters (brightness, orientation, alignment, font…),
#     turn_on/off, the apply queue (async_apply_display_mode) and frame builder
#     (apply()), scroll timer, and state snapshot / linked-entity sync.
#
#   light_color.py      (ColorPipelineMixin)  — color adjustment/correction/
#                        accuracy maths + the brightness curve.
#   light_transitions.py(TransitionMixin)     — frame-by-frame transition anims.
#   light_native.py     (NativeModesMixin)    — firmware Clock + native-effect
#                        activation (set_fx_effect payloads).
#   light_render.py     (MatrixRenderMixin)   — mode router
#                        (_apply_display_mode_internal), letter/pixel placement,
#                        gradient/offset maths and orientation flips.
#   light_services.py                          — component `handle_*` services
#                        (registered by async_setup_light_services, re-exported
#                        from the bottom of this file).
#
# async_setup_entry (below the class) is the HA light-platform setup and stays
# here by convention.
# ─────────────────────────────────────────────────────────────────────────────

class YeelightCubeLight(ColorPipelineMixin, TransitionMixin, NativeModesMixin, MatrixRenderMixin, LightEntity, RestoreEntity):
    """Home Assistant LightEntity for the Yeelight Cube Lite."""

    # Published for the cards but not stored in the recorder's history: large
    # (the 100 matrix colors, the effect catalogue), frequently changing
    # (rotation status), or configuration with no use as history (calibration).
    _unrecorded_attributes = frozenset({
        "matrix_colors",
        "native_effect_catalog",
        "favourites",
        "rotation_intervals",
        "effect_rotation",
        "button_effects",
        "last_hardware_brightness",
        "calib_gamma_r", "calib_gamma_g", "calib_gamma_b",
        "calib_hw_threshold", "calib_hw_full", "calib_channel_balance",
        "calib_gain_r", "calib_gain_g", "calib_gain_b",
        "calib_hw_floor", "calib_darken_floor", "calib_hw_curve", "calib_darken_curve",
        "calib_floor_r", "calib_floor_g", "calib_floor_b",
    })

    @property
    def font(self):
        return self._font

    async def set_font(self, font: str):
        from .layout import FONT_MAPS
        if font not in FONT_MAPS:
            _LOGGER.error("Invalid font: %s. Available: %s", font, list(FONT_MAPS.keys()))
            return
        self._font = font
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()
    @property
    def device_info(self):
        return cube_device_info(self)

    # UNIFIED BRIGHTNESS CONTROL CONFIGURATION
    # ----------------------------------------
    # The single user brightness slider (1-100%) drives BOTH mechanisms together
    # across the WHOLE range -- there is no mode switch / breaking point:
    #
    #   perceived = hardware_keep(p) * rgb_keep(p)        where p = user% / 100
    #
    #   hardware_keep(p) = hw_floor + (1 - hw_floor) * p ** hw_curve   (LED dimming)
    #   rgb_keep(p)      = (1 - darken_floor) + darken_floor * p ** darken_curve
    #                      (per-pixel math; reported as darken% = 100*(1-rgb_keep))
    #
    # Both curves rise smoothly from their floor (at p=0) to 1.0 (at p=100%), so:
    #   - p=0   : hardware=hw_floor%, darken=darken_floor%  -> very dim night level
    #   - p=100 : hardware=100%,      darken=0%             -> full color output
    # The product of two monotonic curves is itself smooth and monotonic, which
    # removes the irregularity that the old hard transition point produced.
    #
    # Tuning knobs (all runtime-tunable via set_color_calibration / wizard):
    #   HW_FLOOR_PERCENT  - hardware brightness % at slider 0 (sets dimmest LED drive)
    #   DARKEN_FLOOR_PERCENT - darken % at slider 0 (sets dimmest per-pixel math)
    #   HW_CURVE_EXPONENT - <1 makes hardware rise fast then flatten near 100%
    #                       (keeps the bright end smooth as hardware barely moves)
    #   DARKEN_CURVE_EXPONENT - >1 makes darken do most of its work in the upper
    #                       range (so colors stay rich until you dim well down)
    HW_FLOOR_PERCENT = 1        # Hardware brightness % at 0% user brightness (1-100)
    DARKEN_FLOOR_PERCENT = 97   # Darken % at 0% user brightness (0-100, safe <=97)
    HW_CURVE_EXPONENT = 0.5     # Shaping exponent for the hardware curve (0.1-3.0)
    DARKEN_CURVE_EXPONENT = 2.0 # Shaping exponent for the darken curve (0.1-4.0)

    def __init__(self, cube_matrix: CubeMatrix, ip: str, config_entry: ConfigEntry):
        # _palettes and _pixel_arts are now @property methods accessing global storage
        self._cube_matrix = cube_matrix
        self._ip = ip
        self._config_entry = config_entry  # Always set during initialization

        # --- Stable entity naming (IP-independent) ---
        # Use a short device identifier for display names so they stay consistent
        # across DHCP IP changes.  Prefer the hardware device_id (last 4 hex chars),
        # fall back to a short hash of the entry_id.
        device_id = config_entry.data.get(CONF_DEVICE_ID, "")
        if device_id:
            short_id = device_id[-4:]  # e.g. "9bc6" from "0x00000000172b9bc6"
        else:
            short_id = config_entry.entry_id[:6]
        self._attr_name = f"{cube_matrix.device_name} {short_id}"

        # --- Stable unique_id (entry_id-based, never changes across IP changes) ---
        # The config entry's entry_id is assigned once and stays constant even when
        # the stored IP is updated by rediscovery / zeroconf.
        self._attr_unique_id = f'yeelight_cube_{config_entry.entry_id}'
        self._is_on = True
        self._layout = Layout("vertical", "bottom", [Module("1x1") for _ in range(100)])
        self._custom_text = "HELLO"
        self._brightness = 255  # Store brightness as 0-255 internally
        self._text_colors = [(255, 0, 0), (0, 0, 255)]  # [solid/gradient start, gradient end]
        self._mode = DEFAULT_MATRIX_DISPLAY_MODE
        self._matrix_mode = DEFAULT_MATRIX_DISPLAY_MODE
        # Custom Draw mode: pixel data and whether it is the active content.
        self._custom_pixels = None
        self._custom_draw_active = False
        self._full_panel = False  # Whether to apply gradients to whole panel instead of just text
        self._angle = 0.0
        self._background_color = (0, 0, 0)
        self._alignment = "center"  # Default alignment is center
        self._font = "basic"  # Font key for FONT_MAPS (use "basic" as default)
        self._orientation = ORIENTATION_NORMAL  # "normal" or "flipped"
        self._device_orientation = DEFAULT_DEVICE_ORIENTATION  # right/down/left/up
        self._rgb_color = (255, 0, 0)  # Default red color for Home Assistant color picker
        self._native_clock_style = DEFAULT_NATIVE_CLOCK_STYLE
        self._native_clock_show_date = False
        # 3-way clock content: "time" | "time_date" | "date".  Source of truth
        # for data byte 0.  _native_clock_show_date is kept in sync (== the
        # "time_date" alternate mode) for backward compatibility.
        self._native_clock_content = DEFAULT_NATIVE_CLOCK_CONTENT
        self._native_clock_12_hour = False
        self._native_clock_colon_blink = True
        self._native_clock_timezone_offset = None
        self._native_clock_color = None  # ARGB int override, None = use style color
        self._native_clock_color_mode = "normal"  # palette preset (CLOCK_COLOR_MODES key)
        self._native_effect = DEFAULT_NATIVE_EFFECT
        self._native_effect_speed = 50
        self._native_effect_color_mode = "normal"
        self._native_effect_color = None
        self._native_effect_direction = "Up"
        # Reveal firmware effects that the official app never exposed.
        self._extended_effects_enabled = bool(config_entry.options.get("extended_effects_enabled", False))
        self._music_flow_enabled = False
        self._music_flow_effect = DEFAULT_MUSIC_FLOW_EFFECT
        self._music_flow_restore_power = None
        self._power_on_state = "On"
        self._button_effects = []
        # Skip property polling during entity construction. Startup already
        # restores the display and several helper entities at once; delaying the
        # first read avoids adding another TCP connection to that burst.
        self._last_native_state_poll = time.monotonic()
        
        # Text scrolling functionality
        self._scroll_speed = 0.2  # Scroll speed in seconds per step
        self._scroll_enabled = True  # Whether to enable auto-scroll for long text
        self._scroll_offset = 0  # Current scroll position
        self._scroll_direction = 1  # 1 for right, -1 for left
        self._scroll_timer = None  # Timer for auto-scrolling
        self._max_scroll_offset = 0  # Maximum scroll offset for current text
        self._is_scrolling = False  # Flag to indicate if currently in scroll animation
        
        # Connection error tracking for reconnect button
        self._connection_error = False
        self._last_connection_error = None
        
        # FX mode tracking to avoid redundant mode changes
        self._fx_mode_is_direct = False  # Track if we're already in direct/music mode
        self._last_fx_mode_time = 0.0    # When activate_fx_mode last succeeded
        # True when the lamp is physically in a firmware-native mode (clock,
        # native animation, or start_cf color flow). When True, ensure_fx_ready()
        # must use a longer settle + graceful FIN to avoid the lamp resetting to
        # the ribbon (default loading state) during the mode transition.
        self._in_native_fw_mode = False
        # True while the panel is frozen on its current frame (freeze_display).
        # Cleared by the next display re-apply. The camera preview reads this to
        # hold the background animation on the frozen frame.
        self._display_frozen = False
        # Wall-clock instant the freeze began; the camera freezes the clock's
        # background phase at exactly this moment, not at the next render.
        self._display_frozen_at = None

        # -- Favourites -----------------------------------------------------
        # Favourite native effects / clock styles per kind ("native", "clock"),
        # stored with the integration data (not in a browser) and published in
        # the `favourites` attribute so every dashboard shows the same list.
        # A kind is absent until it is first saved (cards then migrate the
        # list they kept in browser storage before this existed).
        self._favourites: dict = {}

        # -- Effect / clock mode rotation -----------------------------------
        # A server-side timed loop that advances the lamp through a list of
        # native effect or clock style names on its own timer, independently of
        # any dashboard client (so it survives a page refresh). Started and
        # stopped via the start/stop/skip_effect_rotation services.
        self._rotation_active = False
        self._rotation_kind = "native"       # "native" | "clock"
        self._rotation_items: list = []
        self._rotation_interval = 60          # whole seconds between steps
        # The interval every dashboard uses per kind, once set (by a Start or
        # set_rotation_interval); published in `rotation_intervals`.
        self._rotation_intervals: dict = {}
        # A rotation saved before a restart, resumed once the lamp is set up.
        self._rotation_restore = None
        # Set when the interval changed while the loop sleeps: re-time the
        # wait instead of advancing to the next item.
        self._rotation_retime = False
        self._rotation_index = -1
        self._rotation_task = None
        self._rotation_wake = None
        self._rotation_started = None
        self._rotation_error = None
        self._rotation_resume_pending = False
        self._rotation_waiting_for_reconnect = False
        # Shared time grid {"tick", "index"} the loop advances on.
        self._rotation_timeline = None
        # Lamps started together, saved so a restart resumes them together.
        self._rotation_group = None
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None

        # Apply timing (for queue processor stats, not cooldown-gating)
        self._last_apply_time = 0
        
        # Hardware brightness tracking to avoid redundant brightness commands
        self._last_hardware_brightness = None  # Track last hardware brightness sent to lamp
        self._last_applied_darken = None       # Track last darken% actually rendered to lamp pixels
        
        # Color effect settings (organized by category)
        # Note: _preview_darken and _preview_brighten kept internally for brightness control logic
        # but removed from UI - use light brightness slider instead
        self._preview_darken = 0        # 0-100: used internally by brightness control
        self._preview_brighten = 0      # 0-100: reserved for future use
        # Color Adjustments
        self._preview_hue_shift = 0     # -180 to +180: rotate hue
        self._preview_temperature = 0   # -100 to +100: cool to warm
        # Saturation & Intensity
        self._preview_saturation = 100  # 0-200: 0=gray, 100=normal, 200=hyper
        self._preview_vibrance = 100    # 0-200: smart saturation
        # Tone & Contrast
        self._preview_contrast = 100    # 0-200: 0=flat, 100=normal, 200=high
        self._preview_glow = 0          # 0-100: boost bright pixels
        # Special Effects
        self._preview_grayscale = 0     # 0-100: convert to black & white
        self._preview_invert = 0        # 0-100: blend with inverted
        self._preview_tint_hue = 0      # 0-360: tint color hue
        self._preview_tint_strength = 0 # 0-100: tint blend amount
        # Hardware color correction is always active (see _apply_color_correction)
        # Hardware color accuracy -- always-on by default (see _apply_color_accuracy).
        # Compensates for LED color rendering differences vs. a computer monitor
        # by applying per-channel gain that fades with brightness.  The service
        # set_color_accuracy still exists to toggle at runtime but the default is ON.
        self._color_accuracy_enabled = True  # Per-channel gain to match monitor colors
        
        # Calibration lock: when True the lamp ignores display/brightness commands
        # from automations so the calibration wizard can drive it exclusively.
        # Wizard calls carry bypass_lock=True to override this. A safety timer
        # auto-releases the lock if the wizard is abandoned (browser closed).
        self._calibration_lock = False
        self._calibration_lock_unsub = None
        
        # Calibration overrides (runtime-tunable via set_color_calibration)
        # System 1: Low-brightness gamma correction
        self._calib_gamma_r = 0.85
        self._calib_gamma_g = 0.75
        self._calib_gamma_b = 0.62
        self._calib_hw_threshold = 50  # hw% above which correction is OFF
        self._calib_hw_full = 10       # hw% at/below which correction is 100%
        self._calib_channel_balance = 0.7  # 0=pure uniform (hue-safe), 1=per-channel (blue fix)
        # System 2: Monitor-matching per-channel gain
        self._calib_gain_r = 1.00
        self._calib_gain_g = 1.00
        self._calib_gain_b = 1.00
        # System 3: Unified brightness curve parameters (override class constants)
        self._calib_hw_floor = self.HW_FLOOR_PERCENT
        self._calib_darken_floor = self.DARKEN_FLOOR_PERCENT
        self._calib_hw_curve = self.HW_CURVE_EXPONENT
        self._calib_darken_curve = self.DARKEN_CURVE_EXPONENT
        # Per-channel minimum lit value (lowest value a channel renders cleanly).
        # 1 = LED can go fully low (e.g. red); raise for channels that need more.
        self._calib_floor_r = 1
        self._calib_floor_g = 1
        self._calib_floor_b = 1
        
        # Retry task: schedules a display retry after connection errors
        # so the lamp eventually recovers when the device becomes reachable.
        self._retry_display_task = None
        self._display_retry_count = 0  # Track consecutive retries for logging
        
        # Circuit breaker: tracks recent hard timeouts to reject new ops early
        # instead of queueing them behind the lock for APPLY_HARD_TIMEOUT each.
        self._hard_timeout_times = []  # List of timestamps of recent hard timeouts
        # Set by _execute_hardware_op: whether the last failure was a
        # connection problem worth retrying, and the operation holding the lock.
        self._hardware_failure_retryable = False
        self._hardware_operation_phase = None
        
        # Track background tasks (fire-and-forget brightness commands)
        self._background_tasks = set()
        
        # Track last successful brightness change (timestamp, user_brightness)
        # Used to prevent retry queue from overwriting newer brightness values
        # This is CRITICAL for unified brightness system (hardware + darkness)
        self._last_successful_brightness = None  # (timestamp, user_brightness_0_255)
        
        # Brightness retry queue - stores failed brightness values to retry when connection recovers
        # Unlike generic retry queue, this stores COMPLETE user brightness (not hardware commands)
        self._pending_brightness = None  # (user_brightness_0_255, timestamp) or None
        self._brightness_retry_task = None  # Background task for brightness retries
        
        # Reference to text input entity for bidirectional updates
        self._text_input_entity = None
        
        # Reference to pixel art select entity for bidirectional updates
        self._pixel_art_select_entity = None
        
        # Reference to display mode select entity for bidirectional updates
        self._mode_select_entity = None

        # Reference to top-level Matrix/Clock selector
        self._content_mode_select_entity = None

        # Reference to native clock style select entity
        self._clock_style_select_entity = None

        # References to native clock option switches
        self._clock_show_date_switch_entity = None
        self._clock_12_hour_switch_entity = None
        self._clock_colon_blink_switch_entity = None
        self._clock_content_select_entity = None
        
        # Reference to alignment select entity for bidirectional updates
        self._alignment_select_entity = None
        
        # Reference to font select entity for bidirectional updates
        self._font_select_entity = None
        
        # Reference to gradient angle number entity for bidirectional updates
        self._angle_number_entity = None
        
        # Dict of preview adjustment number entities keyed by spec key (e.g. "hue_shift")
        self._preview_number_entities = {}
        
        # Track the name of the currently active pixel art (for dropdown preselection)
        self._active_pixel_art_name = None
        
        # Periodic health check: detects when an unreachable device comes back online.
        # Runs in parallel with the retry system, probing at 10s intervals during
        # active failures.  After MAX_DISPLAY_RETRIES, retries stop but the
        # health check continues probing until the device recovers.
        self._health_check_task = None
        # Health check interval is adaptive (computed dynamically):
        # 10s during active failures, 15s when recently online, 60s when long-dead
        # Throttle runtime SSDP rediscovery (lamp may have changed IP via DHCP).
        self._last_rediscovery_attempt = 0.0
        
        # Base (un-darkened) matrix colors for immediate brightness preview.
        # Snapshotted in apply() right before brightness darkening.  Used by
        # extra_state_attributes to return correctly brightness-adjusted colors
        # without double-darkening (module.data may already be darkened after apply).
        self._base_matrix_colors = None
        
        # -- Transition settings ------------------------------------------
        self._transition_type = "none"           # Transition effect key (see const.TRANSITION_TYPES)
        self._transition_steps = 5               # Number of intermediate frames (1-10)
        self._transition_duration = 1.0          # Total transition time in seconds (0.2-10.0)
        self._transition_active = False          # Re-entrancy guard

        # -- Saved display state (save_state / restore_state services) ----
        # Holds a single snapshot of the full display state so an automation
        # can save what the lamp is showing, display something else briefly,
        # then restore the original.  Overwritten each time save_state runs.
        # In-memory only -- does not survive a Home Assistant restart.
        self._saved_display_state = None
        self._last_sent_colors = None            # List of 100 RGB tuples last sent to lamp
        self._current_update_type = 'display_update'  # Tracks current operation type for transition logic
        
        # Entity references for transition controls
        self._transition_select_entity = None
        self._transition_steps_entity = None
        self._transition_duration_entity = None

        # Entity references for native firmware controls.
        self._native_effect_select_entity = None
        self._native_effect_direction_select_entity = None
        self._native_effect_speed_entity = None
        self._extended_effects_switch_entity = None
        self._music_flow_effect_select_entity = None
        self._power_on_state_select_entity = None
        self._device_orientation_select_entity = None
        self._scroll_enabled_switch_entity = None
        self._scroll_speed_entity = None
        
        # Camera entity references -- set by camera.py async_setup_entry.
        # Used for direct push notifications (bypass state-change-event delay).
        self._camera_entities: list = []

        # Helper entities that control the lamp (entity.CubeControlEntity).
        # Their availability follows the lamp's, so they are rewritten when
        # the published availability changes.
        self._control_entities: set = set()
        self._published_available = None

    @callback
    def async_write_ha_state(self) -> None:
        super().async_write_ha_state()
        available = self.available
        if available != self._published_available:
            self._published_available = available
            for entity in self._control_entities:
                if entity.hass is not None:
                    entity.async_write_ha_state()

    def _notify_camera_preview(self) -> None:
        """Schedule every camera entity to re-render its preview.

        Each camera renders in the background (PNG encoding runs in an
        executor) and only then bumps its access token and writes its state,
        so the frontend never fetches a stale frame for the new token.
        """
        for cam in self._camera_entities:
            try:
                cam.async_refresh_preview()
            except Exception as exc:
                _LOGGER.debug(
                    "[%s] Camera preview notification failed: %s",
                    self._ip, exc
                )

    def _create_tracked_task(self, coro, *, name=None):
        """Create a background task and track it for cleanup on entity removal.

        All fire-and-forget work that belongs to this entity should be created
        through this helper so it is cancelled in async_will_remove_from_hass().
        """
        task = asyncio.create_task(coro, name=name)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    @property
    def _palettes(self):
        """Access global palette storage - all lights share the same palette list"""
        if DOMAIN not in self.hass.data:
            self.hass.data[DOMAIN] = {}
        if "palettes_v2" not in self.hass.data[DOMAIN]:
            self.hass.data[DOMAIN]["palettes_v2"] = []
        return self.hass.data[DOMAIN]["palettes_v2"]
    
    @property
    def _pixel_arts(self):
        """Access global pixel art storage - all lights share the same pixel art list"""
        if DOMAIN not in self.hass.data:
            self.hass.data[DOMAIN] = {}
        if "pixel_arts" not in self.hass.data[DOMAIN]:
            self.hass.data[DOMAIN]["pixel_arts"] = []
        return self.hass.data[DOMAIN]["pixel_arts"]
    
    def _sync_rgb_color(self):
        """Synchronize _rgb_color with the first color in _text_colors"""
        if self._text_colors and len(self._text_colors) > 0:
            self._rgb_color = self._text_colors[0]
            _LOGGER.debug("[SYNC] Synchronized _rgb_color to %s from text_colors", self._rgb_color)
    
    async def _execute_hardware_op(self, func, op_name: str, timeout_override: float = None):
        """Execute a hardware operation under the global lock with timeout and error handling.
        
        Replaces the old queue processor.  Operations are serialized across all
        entity instances via per-device locks.  A hard timeout prevents hung
        socket operations from blocking the lock indefinitely.
        
        Args:
            timeout_override: Optional custom timeout (seconds).  Used when a
                              display transition needs more time than the default
                              APPLY_HARD_TIMEOUT.
        """
        op_id = int(time.time() * 1000) % 100000
        effective_timeout = timeout_override or APPLY_HARD_TIMEOUT
        self._hardware_failure_retryable = False
        
        # CIRCUIT BREAKER: If 2+ hard timeouts occurred in the last N seconds,
        # reject immediately instead of queueing behind the lock for
        # APPLY_HARD_TIMEOUT each. This prevents the cascade where 5+ operations
        # pile up, each waiting for its own timeout, leaving the lamp stuck.
        now = time.time()
        self._hard_timeout_times = [t for t in self._hard_timeout_times if now - t < CIRCUIT_BREAKER_WINDOW]
        if len(self._hard_timeout_times) >= 2:
            self._hardware_failure_retryable = True
            _LOGGER.warning(
                "[OP #%s] [%s] [!] CIRCUIT BREAKER -- rejecting %s "
                "(%s timeouts in last %.0fs). "
                "Device appears unreachable, will recover via health check.",
                op_id, self._ip, op_name, len(self._hard_timeout_times),
                CIRCUIT_BREAKER_WINDOW
            )
            self._connection_error = True
            # Only schedule display retries for display operations
            if op_name.startswith('display:'):
                self._maybe_schedule_retry()
            return False
        
        _LOGGER.debug(
            "[OP #%s] [%s] > %s "
            "(is_on=%s, fx_direct=%s) "
            "[%s]",
            op_id, self._ip, op_name, self._is_on, self._fx_mode_is_direct,
            self._cube_matrix.summary
        )
        is_display_op = op_name.startswith('display:')
        try:
            lock_wait_start = time.time()
            device_lock = _get_device_lock(self._ip)
            # The operation this one queues behind, named in the log below.
            waited_behind = (
                _DEVICE_LOCK_HOLDERS.get(self._ip) if device_lock.locked() else None
            )
            async with device_lock:
                _DEVICE_LOCK_HOLDERS[self._ip] = op_name
                self._hardware_operation_phase = op_name
                lock_wait_ms = (time.time() - lock_wait_start) * 1000
                if lock_wait_ms > 5:
                    # Waiting for the lamp to finish its previous operation (a
                    # redraw with a transition takes 1-2 s) is normal. Only a
                    # long wait suggests commands are piling up.
                    log = (
                        _LOGGER.warning
                        if lock_wait_ms >= LOCK_WAIT_WARNING_MS
                        else _LOGGER.debug
                    )
                    log(
                        "[OP #%s] [%s] %s waited %.0fms for the lamp%s",
                        op_id,
                        self._ip,
                        op_name,
                        lock_wait_ms,
                        f" (queued behind {waited_behind})" if waited_behind else "",
                    )
                try:
                    await asyncio.wait_for(func(), timeout=effective_timeout)
                except asyncio.TimeoutError:
                    self._hardware_failure_retryable = True
                    _LOGGER.error(
                        "[OP #%s] [%s] [!] HARD TIMEOUT -- "
                        "%s exceeded %.0fs, releasing lock "
                        "(phase=%s)",
                        op_id, self._ip, op_name, effective_timeout,
                        self._hardware_operation_phase
                    )
                    self._fx_mode_is_direct = False
                    self._cube_matrix.close_fast_socket()
                    self._connection_error = True
                    self._last_connection_error = f"Hard timeout: {op_name}"
                    self._hard_timeout_times.append(time.time())
                    self._cube_matrix.record_failure()
                    # Only schedule display retries for display operations
                    if is_display_op:
                        self._maybe_schedule_retry()
                    return False
                finally:
                    _DEVICE_LOCK_HOLDERS.pop(self._ip, None)
            # Success
            _LOGGER.debug("[OP #%s] [%s] [OK] %s complete", op_id, self._ip, op_name)
            # Only reset display retry state on display op success
            if is_display_op:
                self._display_retry_count = 0
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
            self._connection_error = False
            self._cube_matrix.record_success()
            # Clear circuit breaker on any success
            self._hard_timeout_times.clear()
            return True
        except CubeConnectionError as e:
            # The command did not reach the lamp (unreachable, cooldown, dead
            # socket, FX mode lost while sending): retry once it answers.
            self._hardware_failure_retryable = True
            self._connection_error = True
            self._last_connection_error = e.message
            _LOGGER.warning(
                "[OP #%s] [%s] Connection error: %s", op_id, self._ip, e.message
            )
            if is_display_op:
                self._maybe_schedule_retry()
        except TimeoutError:
            self._hardware_failure_retryable = True
            _LOGGER.debug(
                "[OP #%s] [%s] Timeout -- device unreachable", op_id, self._ip
            )
            self._connection_error = True
            self._last_connection_error = "Device timeout"
            self._cube_matrix.record_failure()
            if is_display_op:
                self._maybe_schedule_retry()
        except OSError as e:
            # A raw socket failure (fresh-connection commands, probes).
            self._hardware_failure_retryable = True
            self._connection_error = True
            self._last_connection_error = str(e)
            _LOGGER.warning(
                "[OP #%s] [%s] Connection error: %s", op_id, self._ip, e
            )
            self._cube_matrix.record_failure()
            if is_display_op:
                self._maybe_schedule_retry()
        except BulbException as e:
            # The lamp answered but refused the command (rate limit, illegal
            # request, ...): not a connection problem.
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_message = error_dict.get('message', str(e))
            self._connection_error = True
            self._last_connection_error = f"BulbException: {error_message}"
            _LOGGER.warning(
                "[OP #%s] [%s] BulbException: %s", op_id, self._ip, error_message
            )
        except Exception as e:
            _LOGGER.error(
                "[OP #%s] [%s] Unexpected error in %s: %s", op_id, self._ip, op_name, e
            )
        return False

    MAX_DISPLAY_RETRIES = 3  # 3 retries ~= 20s total, then health check takes over

    # Calibration lock auto-release: if the wizard is abandoned (browser closed
    # without exiting), the lamp would stay frozen forever. The lock auto-releases
    # after this many seconds. The wizard sends periodic re-locks (heartbeat) that
    # reset this timer, so it only fires once the wizard truly stops talking.
    CALIBRATION_LOCK_TIMEOUT = 900  # 15 minutes

    @callback
    def _set_calibration_lock(self, enabled: bool):
        """Enable/disable the exclusive calibration lock and (re)arm the safety
        auto-release timer. Re-enabling acts as a heartbeat that pushes back the
        auto-release."""
        if self._calibration_lock_unsub is not None:
            self._calibration_lock_unsub.cancel()
            self._calibration_lock_unsub = None
        self._calibration_lock = bool(enabled)
        if enabled:
            self.stop_effect_rotation()
            self._calibration_lock_unsub = self.hass.loop.call_later(
                self.CALIBRATION_LOCK_TIMEOUT, self._auto_release_calibration_lock
            )
            _LOGGER.info(
                "[CALIB_LOCK] [%s] Calibration lock ENABLED -- automation "
                "display/brightness commands will be ignored (auto-release in "
                "%ss)",
                self._ip, self.CALIBRATION_LOCK_TIMEOUT
            )
        else:
            _LOGGER.info(
                "[CALIB_LOCK] [%s] Calibration lock DISABLED -- lamp resumes "
                "normal command handling",
                self._ip
            )
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @callback
    def _auto_release_calibration_lock(self):
        """Safety net: release the lock if the wizard heartbeat stops."""
        self._calibration_lock_unsub = None
        if self._calibration_lock:
            self._calibration_lock = False
            _LOGGER.warning(
                "[CALIB_LOCK] [%s] Calibration lock auto-released after "
                "%ss of inactivity (wizard abandoned?)",
                self._ip, self.CALIBRATION_LOCK_TIMEOUT
            )
            if self.hass is not None:
                self.async_schedule_update_ha_state()

    def _maybe_schedule_retry(self):
        """Schedule a display retry if the retry limit hasn't been reached.
        
        Thin wrapper that avoids log-spam: only logs 'stopping' ONCE when the
        limit is first hit, then stays silent on subsequent calls.
        """
        if self._display_retry_count >= self.MAX_DISPLAY_RETRIES:
            _LOGGER.debug(
                "[RETRY] [%s] Skipping retry -- already at limit "
                "(%s/%s)",
                self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES
            )
            return
        self._schedule_display_retry()

    def _schedule_display_retry(self):
        """Schedule a delayed retry of the display update after a connection error.
        
        This is the critical piece that prevents the lamp from staying dark forever
        after a boot failure. When the queue processor fails (e.g., device unreachable
        after HA reboot), this schedules a future async_apply_display_mode() call
        that respects the exponential backoff:
        
          boot -> apply fails -> retry in 2s -> fails -> retry in 2s -> fails -> backoff -> 4s -> ...
        
        Only ONE retry task runs at a time. A successful display update clears the retry.
        User-initiated actions (turn_on, set_color, etc.) also naturally re-queue,
        so this retry only matters when nothing else is driving updates.
        
        After MAX_DISPLAY_RETRIES, stops retrying -- the health check (probing
        every 10s while there are failures) takes over for longer outages. User actions will still
        trigger a fresh display update, resetting the counter.
        """
        self._display_retry_count += 1
        
        if self._display_retry_count > self.MAX_DISPLAY_RETRIES:
            _LOGGER.warning(
                "[RETRY] [%s] Stopping auto-retry after %s consecutive failures. "
                "The lamp appears to be offline. Display will resume on next user action or HA restart. "
                "[%s]",
                self._ip, self.MAX_DISPLAY_RETRIES, self._cube_matrix.summary
            )
            return
        
        # Cancel any existing retry task (avoid stacking retries)
        if self._retry_display_task and not self._retry_display_task.done():
            _LOGGER.debug("[RETRY] [%s] Cancelling existing display retry task", self._ip)
            self._retry_display_task.cancel()
        
        # Calculate delay: the first retry is quick to catch transient network
        # hiccups before engaging exponential backoff.  Subsequent retries use
        # the device's current cooldown + buffer.
        QUICK_RETRY_DELAY = 1.5  # seconds -- fast enough to recover from a 1-2s WiFi hiccup
        cooldown = self._cube_matrix.reconnect_cooldown
        if self._display_retry_count == 1:
            delay = QUICK_RETRY_DELAY
        else:
            delay = cooldown + 0.5
        
        # Add random jitter (0-1.5s) to desynchronize retries across lamps.
        # When two lamps fail at the same moment, they get identical cooldown
        # schedules and retry simultaneously -- each round has both lamps
        # hitting the network at once, prolonging the failure.  Jitter breaks
        # this synchronization so they stagger naturally.
        delay += random.uniform(0, 1.5)
        
        async def _delayed_retry():
            try:
                _LOGGER.debug(
                    "[RETRY] [%s] Attempt %s/%s -- "
                    "waiting %.1fs before retry "
                    "[%s]",
                    self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                    delay, self._cube_matrix.summary
                )
                await asyncio.sleep(delay)
                
                _LOGGER.debug(
                    "[RETRY] [%s] Retrying display update now (attempt %s) "
                    "[%s]",
                    self._ip, self._display_retry_count, self._cube_matrix.summary
                )
                await self.async_apply_display_mode(update_type='display_retry')
                _LOGGER.debug("[RETRY] [%s] Display retry sent", self._ip)
            except asyncio.CancelledError:
                _LOGGER.debug("[RETRY] [%s] Display retry CANCELLED", self._ip)
            except Exception as e:
                _LOGGER.warning("[RETRY] [%s] Unexpected error in display retry: %s", self._ip, e)
        
        self._retry_display_task = self._create_tracked_task(
            _delayed_retry(), name=f"yeelight_cube_display_retry_{self._ip}"
        )
        _LOGGER.debug(
            "[RETRY] [%s] Scheduled retry %s/%s "
            "in %.1fs (cooldown=%.0fs, failures=%s)",
            self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES, delay,
            cooldown, self._cube_matrix.consecutive_failures
        )

    async def _periodic_health_check(self):
        """Periodically probe devices with active issues and reconnect when they come back.
        
        This runs in parallel with the retry system, providing a secondary
        recovery path.  It probes whenever there are ANY active issues:
        - consecutive failures > 0 (early detection, before retry exhaustion)
        - device marked unreachable (exponential backoff triggered)
        - display retries in progress (parallel recovery alongside retries)
        - retry limit reached (sole recovery mechanism after retries exhausted)
        
        Uses adaptive intervals: 10s during active failures (matches max retry
        backoff), 15s monitor mode, 60s when long-dead.
        
        Flow:
          1. Sleep for adaptive interval (10s during failures, 15s when recently online, 60s when long-dead)
          2. If device has no active issues -> skip
          3. TCP probe the device (RECOVERY_CONNECT_TIMEOUT timeout)
          4. If reachable -> reset all failure counters and trigger a fresh display update
          5. If still unreachable -> log at debug level, try again next cycle
        """
        _LOGGER.debug("[HEALTH] [%s] Health check started (adaptive interval)", self._ip)
        while True:
            try:
                # ADAPTIVE INTERVAL:
                #  - 10s when there are active failures (fastest recovery)
                #  - 15s when device was online recently (monitor mode)
                #  - 60s when device has been down a while (reduce noise)
                has_active_issues = (
                    self._cube_matrix.is_unreachable or
                    self._cube_matrix.consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                # "Silent" firmware modes (Clock / Native Effect / Music Flow)
                # pause get_prop polling and push no frames, so a mains power cut
                # is never noticed: the lamp reboots to a firmware default while
                # HA still believes the mode is active. Probe these on a SHORT
                # fixed cadence so we reliably catch the brief unreachable window
                # and re-assert the mode on return -- exactly the re-apply that a
                # Home Assistant restart performs (which the user confirmed works).
                silent_mode = self._is_on and (
                    self._mode in FIRMWARE_MODES
                    or self._music_flow_enabled
                )
                last_success = self._cube_matrix.last_success_time
                time_since_success = time.time() - last_success if last_success > 0 else 999
                if has_active_issues:
                    interval = 10  # Aggressive probing during failures
                elif silent_mode:
                    interval = 10  # Catch power-cut outages while in a native mode
                elif time_since_success < 300:  # online within last 5 minutes
                    interval = 15
                else:
                    interval = 60
                
                # PERIODIC BRIGHTNESS STATE SNAPSHOT -- logs every cycle so we can
                # see the stored brightness values even when nothing is changing.
                _LOGGER.debug(
                    "[BRIGHTNESS_DIAG] [%s] SNAPSHOT -- "
                    "user=%s/255, "
                    "last_hw=%s, "
                    "darken=%s%%, "
                    "last_applied_darken=%s, "
                    "is_on=%s, fx_direct=%s, "
                    "unreachable=%s, "
                    "failures=%s, "
                    "interval=%ss",
                    self._ip, self._brightness, self._last_hardware_brightness,
                    self._preview_darken, self._last_applied_darken, self._is_on,
                    self._fx_mode_is_direct, self._cube_matrix.is_unreachable,
                    self._cube_matrix.consecutive_failures, interval
                )
                await asyncio.sleep(interval)
                
                # Probe when the device has ANY active issue:
                # - unreachable flag is set (exponential backoff triggered)
                # - retry counter hit the limit (retries exhausted)
                # - consecutive failures > 0 (early detection before unreachable)
                # - display retries in progress (parallel recovery path)
                is_stuck = (
                    self._cube_matrix.is_unreachable or
                    self._rotation_waiting_for_reconnect or
                    self._display_retry_count >= self.MAX_DISPLAY_RETRIES or
                    self._cube_matrix.consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                if not is_stuck and not silent_mode:
                    continue
                # Only re-apply the mode when we are actually RECOVERING from a
                # detected outage. A healthy proactive probe in silent mode must
                # leave the running renderer untouched (re-applying every cycle
                # would restart the clock/effect repeatedly).
                recovering = is_stuck
                
                _LOGGER.debug(
                    "[HEALTH] [%s] Probing device (unreachable=%s, "
                    "retries=%s/%s, "
                    "failures=%s, "
                    "interval=%ss)",
                    self._ip, self._cube_matrix.is_unreachable,
                    self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                    self._cube_matrix.consecutive_failures, interval
                )
                
                # Quick TCP probe -- use longer timeout for recovery.
                # Normal commands use 0.5s, but a lamp rebooting may have
                # slow TCP handshakes (RECOVERY_CONNECT_TIMEOUT).
                probe_timeout = RECOVERY_CONNECT_TIMEOUT
                if not await self._cube_matrix.probe(probe_timeout):
                    # The lamp is not answering -- record it so the next
                    # successful probe knows to re-assert the mode. This is what
                    # lets a mains power cut, detected proactively in a silent
                    # mode, recover on return.
                    became_unreachable = self._cube_matrix.mark_unreachable()
                    if self._rotation_resume_pending:
                        self._rotation_waiting_for_reconnect = True
                    if self.hass is not None and (
                        became_unreachable or self._rotation_waiting_for_reconnect
                    ):
                        # Publishes the light and its controls as unavailable.
                        self.async_write_ha_state()
                    # Log at WARNING so the user can see probes are happening
                    _LOGGER.warning(
                        "[HEALTH] [%s] Probe failed -- still unreachable "
                        "(retries=%s/%s, "
                        "failures=%s, "
                        "timeout=%ss)",
                        self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                        self._cube_matrix.consecutive_failures, probe_timeout
                    )
                    # The lamp may have moved to a new DHCP address: scan for
                    # it by hardware id and remap the config entry (throttled).
                    await self._async_maybe_rediscover()
                    continue
                
                # Proactive healthy probe (silent mode, nothing was wrong): the
                # lamp answered, so leave the running renderer untouched.
                if not recovering:
                    continue
                
                # Device is back! Reset everything and trigger a fresh display.
                _LOGGER.warning(
                    "[HEALTH] [%s] [OK] Device is BACK ONLINE! "
                    "Resetting failures (%s -> 0), "
                    "retries (%s -> 0), "
                    "cooldown (%.0fs -> %ss)",
                    self._ip, self._cube_matrix.consecutive_failures,
                    self._display_retry_count, self._cube_matrix.reconnect_cooldown,
                    RECONNECT_COOLDOWN_INITIAL
                )
                self._cube_matrix.mark_recovered()  # Fresh socket, backoff reset
                self._display_retry_count = 0
                self._fx_mode_is_direct = False  # Force FX mode re-send
                self._connection_error = False
                self._hard_timeout_times.clear()  # Clear circuit breaker
                if self.hass is not None:
                    # Publishes the light and its controls as available again.
                    self.async_write_ha_state()

                if self._resume_rotation_after_reconnect():
                    continue
                if self._rotation_active:
                    continue

                if self._music_flow_enabled:
                    _LOGGER.debug(
                        "[MUSIC FLOW] [%s] HEALTH RECOVERY -- restarting "
                        "the requested Music Flow renderer",
                        self._ip,
                    )
                    await self.async_set_music_flow(True)
                else:
                    # Trigger a full display update (turn_on type so it isn't blocked)
                    _LOGGER.debug(
                        "[BRIGHTNESS_DIAG] [%s] HEALTH RECOVERY -- will apply display mode. "
                        "user=%s/255, last_hw=%s, "
                        "darken=%s%%, fx_direct=%s",
                        self._ip, self._brightness, self._last_hardware_brightness,
                        self._preview_darken, self._fx_mode_is_direct
                    )
                    await self.async_apply_display_mode(update_type='turn_on')
                
            except asyncio.CancelledError:
                _LOGGER.debug("[HEALTH] [%s] Health check cancelled", self._ip)
                break
            except Exception as e:
                _LOGGER.debug("[HEALTH] [%s] Health check error: %s", self._ip, e)
        
        _LOGGER.debug("[HEALTH] [%s] Health check stopped", self._ip)

    async def _async_maybe_rediscover(self):
        """Scan for this lamp at a new IP after failed probes (throttled).

        DHCP can move the lamp while the entry is loaded; probing the stale IP
        forever can never recover. Rediscovery matches by hardware device_id
        and updates the config entry, whose update listener reloads the entry
        with the new address.
        """
        now = time.time()
        if now - self._last_rediscovery_attempt < 60:
            return
        self._last_rediscovery_attempt = now
        if self._config_entry is None or self.hass is None:
            return
        try:
            from . import _async_try_rediscover

            new_ip = await _async_try_rediscover(
                self.hass, self._config_entry, self._ip
            )
            if new_ip and new_ip != self._ip:
                _LOGGER.warning(
                    "[HEALTH] [%s] Lamp found at new IP %s -- config entry "
                    "updated, reloading with the new address",
                    self._ip, new_ip,
                )
        except Exception as exc:
            _LOGGER.debug(
                "[HEALTH] [%s] Runtime rediscovery failed: %s", self._ip, exc
            )

    # Removed duplicate/empty __init__ definition
    @property
    def orientation(self):
        return self._orientation

    async def set_orientation(self, orientation: str):
        if orientation not in (ORIENTATION_NORMAL, ORIENTATION_FLIPPED):
            _LOGGER.error("Invalid orientation value: %s", orientation)
            return
        self._orientation = orientation
        # Keep the 4-way device orientation consistent (normal->right,
        # flipped->left) so the Device Orientation select reflects legacy calls.
        self._device_orientation = "left" if orientation == ORIENTATION_FLIPPED else "right"
        if self._device_orientation_select_entity:
            self._device_orientation_select_entity.async_update_from_light()
        self._notify_camera_preview()
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @property
    def device_orientation(self):
        return self._device_orientation

    async def set_device_orientation(self, orientation: str):
        """Set the 4-way physical device orientation (right/down/left/up).

        There is no single firmware command for this, so we translate it to the
        mechanisms that actually work and apply immediately for the current mode:
          - matrix / text / pixel art: normal vs flipped (180 deg) pixel flip
          - native effects: the effect's own `direction` field (if supported)
          - clock: no reorientation available (left as-is)
        The 90 deg visual rotation for up/down is handled by the preview card.
        """
        if orientation not in DEVICE_ORIENTATIONS:
            _LOGGER.error("Invalid device orientation value: %s", orientation)
            return
        self._device_orientation = orientation
        # Drive the matrix/text/pixel flip (normal vs 180 deg).
        self._orientation = _DEVICE_ORIENTATION_TO_FLIP[orientation]

        # Whether we need to re-render/re-send to the lamp for this mode.
        reapply = True

        # For native effects, steer the effect's flow to match the mounting,
        # but only if the current effect supports that direction.
        if self._mode == MODE_NATIVE_EFFECT:
            spec = ALL_NATIVE_EFFECTS.get(self._native_effect, {})
            directions = spec.get("directions")
            desired = _DEVICE_ORIENTATION_TO_EFFECT_DIR.get(orientation)
            if directions and desired in directions:
                self._native_effect_direction = desired
                if self._native_effect_direction_select_entity:
                    self._native_effect_direction_select_entity.async_update_from_light()
        elif self._mode == MODE_CLOCK:
            # The firmware clock has NO orientation control, and re-activating it
            # here disrupts the running clock (it briefly drops / reverts). Since
            # we can't reorient it anyway, just update state so the preview
            # rotates and leave the live clock untouched.
            reapply = False

        self._notify_camera_preview()
        if reapply:
            await self.async_apply_display_mode(update_type='text_change')
        if self._device_orientation_select_entity:
            self._device_orientation_select_entity.async_update_from_light()
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @property
    def alignment(self):
        return self._alignment

    async def set_alignment(self, alignment: str):
        if alignment not in ("left", "center", "right"):
            _LOGGER.error("Invalid alignment value: %s", alignment)
            return
        self._alignment = alignment
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @property
    def text_colors(self):
        return self._text_colors


    @property
    def supported_color_modes(self):
        if self.firmware_draws_matrix:
            return {ColorMode.BRIGHTNESS}
        return {ColorMode.RGB}

    @property
    def color_mode(self):
        # Current active color mode
        if self.firmware_draws_matrix:
            return ColorMode.BRIGHTNESS
        return ColorMode.RGB

    @property
    def brightness(self):
        # Home Assistant expects 1-255 for lights that are ON
        # We return None when OFF (standard HA behavior)
        # When ON, return stored brightness, ensuring it's at least 1
        if not self._is_on:
            return None
        # Ensure brightness is at least 1 (minimum valid brightness for ON lights)
        return max(1, self._brightness)

    @property
    def rgb_color(self):
        # Home Assistant expects RGB tuple for color picker
        # Always return the first text color to stay in sync with the actual lamp state
        if self._text_colors and len(self._text_colors) > 0:
            return self._text_colors[0]
        return self._rgb_color  # Fallback to stored rgb_color if no text colors

    @property 
    def rgb_color_list(self):
        # Extended property that could be used by custom cards for gradient display
        # Returns all text colors for gradient representation
        return self._text_colors if self._text_colors else [self._rgb_color]

    @property
    def custom_text(self):
        return self._custom_text

    @property
    def content_mode(self):
        if self._music_flow_enabled:
            return "Music Flow"
        return self._mode if self._mode in FIRMWARE_MODES else "Matrix"
    
    def _should_auto_turn_on(self) -> bool:
        """Check if lamp should auto-turn-on when receiving commands while off."""
        if not self._config_entry:
            # Default to True (current behavior) if no config entry
            return True
        # Get from options, default to True
        return self._config_entry.options.get("auto_turn_on", True)

    # Use self._attr_name and self._attr_unique_id (set in __init__) for Home Assistant entity name and unique_id

    @property
    def is_on(self):
        return self._is_on

    @property
    def available(self):
        return not self._cube_matrix.is_unreachable

    @property
    def extra_state_attributes(self):
        attrs = {
            # Internal component identifier - DO NOT MODIFY
            "_yeelight_cube_component": "yeelight-cube-component-v1.0",
            # Entity identification - useful for service calls and automations
            "light_entity_id": self.entity_id if hasattr(self, 'entity_id') else "not_yet_initialized",
            "ip_address": self._ip,
            # Display configuration
            "mode": self._mode,
            "content_mode": self.content_mode,
            "matrix_mode": self._matrix_mode,
            "custom_draw_active": self._custom_draw_active,
            # True while the panel is frozen (freeze_display); JS previews hold
            # the background animation on the frozen frame while the clock
            # digits keep updating.
            "display_frozen": bool(self._display_frozen),
            # Shared favourites per kind, e.g. {"clock": [{"name", "color_mode",
            # "color"}, ...]} (set_favourites). Rotation plays them in order.
            "favourites": {
                kind: [dict(item) for item in items]
                for kind, items in self._favourites.items()
            },
            # Shared rotation interval per kind (seconds), once set.
            "rotation_intervals": dict(self._rotation_intervals),
            # Server-side effect/clock rotation status (start/stop_effect_rotation).
            "effect_rotation": {
                "active": bool(self._rotation_active),
                "kind": self._rotation_kind,
                "interval": self._rotation_interval,
                "items": list(self._rotation_items),
                "index": self._rotation_index,
                "error": self._rotation_error,
                "waiting_for_reconnect": self._rotation_waiting_for_reconnect,
                "retry_attempt": self._rotation_retry_attempt,
                "retry_at": self._rotation_retry_at,
            },
            "text_colors": self._text_colors,
            "custom_text": self._custom_text,
            "clock_style": NATIVE_CLOCK_STYLES.get(
                self._native_clock_style,
                NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
            )["name"],
            "clock_style_id": self._native_clock_style,
            "clock_show_date": self._native_clock_show_date,
            "clock_content": self._native_clock_content,
            "clock_12_hour": self._native_clock_12_hour,
            "clock_colon_blink": self._native_clock_colon_blink,
            "clock_color": self._native_clock_color,
            "clock_color_mode": self._native_clock_color_mode,
            "native_effect": self._native_effect,
            "native_effect_speed": self._native_effect_speed,
            "native_effect_color_mode": self._native_effect_color_mode,
            "native_effect_color": self._native_effect_color,
            "native_effect_direction": self._native_effect_direction,
            "native_effect_catalog": [
                {"name": name, "speed": bool(spec.get("speed")),
                 "directions": list(spec.get("directions", ())),
                 "extended": bool(spec.get("extended")),
                 "preview": not name.isdecimal()}
                for name, spec in ALL_NATIVE_EFFECTS.items()
                if not spec.get("extended") or self._extended_effects_enabled or name == self._native_effect
            ],
            "extended_effects_enabled": self._extended_effects_enabled,
            "music_flow_enabled": self._music_flow_enabled,
            "music_flow_effect": self._music_flow_effect,
            "music_flow_restore_power": self._music_flow_restore_power,
            "power_on_state": self._power_on_state,
            "button_effects": list(self._button_effects),
            "background_color": self._background_color,
            "alignment": self._alignment,
            "angle": self._angle,
            "font": self._font,
            "orientation": self._orientation,
            "device_orientation": self._device_orientation,
            "rgb_color": self._rgb_color,
            "full_panel": self._full_panel,
            # Color effects (used by lamp preview card)
            "preview_hue_shift": self._preview_hue_shift,
            "preview_temperature": self._preview_temperature,
            "preview_saturation": self._preview_saturation,
            "preview_vibrance": self._preview_vibrance,
            "preview_contrast": self._preview_contrast,
            "preview_glow": self._preview_glow,
            "preview_grayscale": self._preview_grayscale,
            "preview_invert": self._preview_invert,
            "preview_tint_hue": self._preview_tint_hue,
            "preview_tint_strength": self._preview_tint_strength,
            "preview_darken": self._preview_darken,
            "color_accuracy_enabled": self._color_accuracy_enabled,
            # Calibration values (for debug calibration card)
            "calib_gamma_r": self._calib_gamma_r,
            "calib_gamma_g": self._calib_gamma_g,
            "calib_gamma_b": self._calib_gamma_b,
            "calib_hw_threshold": self._calib_hw_threshold,
            "calib_hw_full": self._calib_hw_full,
            "calib_channel_balance": self._calib_channel_balance,
            "calib_gain_r": self._calib_gain_r,
            "calib_gain_g": self._calib_gain_g,
            "calib_gain_b": self._calib_gain_b,
            # Brightness curve calibration (unified model)
            "calib_hw_floor": self._calib_hw_floor,
            "calib_darken_floor": self._calib_darken_floor,
            "calib_hw_curve": self._calib_hw_curve,
            "calib_darken_curve": self._calib_darken_curve,
            "calib_floor_r": self._calib_floor_r,
            "calib_floor_g": self._calib_floor_g,
            "calib_floor_b": self._calib_floor_b,
            "last_hardware_brightness": self._last_hardware_brightness,
            # Transition settings
            "transition_type": self._transition_type,
            "transition_steps": self._transition_steps,
            "transition_duration": self._transition_duration,
            "scroll_speed": self._scroll_speed,
            "scroll_enabled": self._scroll_enabled,
        }
        attrs["matrix_colors"] = self._published_matrix_colors()
        return attrs

    def _published_matrix_colors(self) -> list:
        """What the lamp shows right now, as 100 RGB tuples (matrix_colors).

        Not simply the last frame the plugin drew: _base_matrix_colors is only
        refreshed when the plugin draws, so it still holds old content (e.g.
        the last pixel art) while the lamp is off or the firmware draws the
        matrix. Published colors are brightness-adjusted so the cards preview
        a brightness drag at once, before the lamp round trip:
        set_brightness() updates _preview_darken and writes the state first.
        _base_matrix_colors is un-darkened (module.data may already be
        darkened after apply()), so _apply_final_brightness() (the full
        two-range darken/brighten system) is applied here exactly once.
        """
        try:
            count = len(self._layout.device_layout)
            if not self._is_on:
                # Off: the matrix is dark, whatever content is kept for turn-on.
                return [(0, 0, 0)] * count
            if self.firmware_draws_matrix:
                # Frames drawn by the firmware cannot be read back: no pixels.
                # Cards and the preview camera render these modes themselves.
                return []
            base_colors = self._base_matrix_colors
            if base_colors and len(base_colors) == count:
                return [self._apply_final_brightness(rgb) for rgb in base_colors]
            # Fallback: read directly from module data (may be darkened or not)
            return self._layout_colors()
        except Exception:  # noqa: BLE001 -- attributes must always build
            return []

    @property
    def firmware_draws_matrix(self) -> bool:
        """Whether the lamp's firmware draws the matrix (clock, native effect,
        music flow) rather than the plugin, so its frames cannot be read back."""
        return bool(self._music_flow_enabled) or self._mode in FIRMWARE_MODES

    @property
    def _has_color_effects(self) -> bool:
        """Whether any color adjustment (hue, saturation, tint, ...) is active."""
        return (
            self._preview_hue_shift != 0 or self._preview_saturation != 100 or
            self._preview_temperature != 0 or self._preview_contrast != 100 or
            self._preview_vibrance != 100 or self._preview_glow != 0 or
            self._preview_grayscale != 0 or self._preview_invert != 0 or
            self._preview_tint_strength != 0
        )

    def _layout_colors(self) -> list:
        """The layout's current pixel colors, one RGB tuple per module
        (black where a module holds no data). Every render sets each 1x1
        module to exactly one color. Raises ValueError or TypeError on a
        malformed color."""
        return [
            hex_to_rgb(module.data[0]) if getattr(module, "data", None) else (0, 0, 0)
            for module in self._layout.device_layout
        ]

    def _write_layout_colors(self, frame: list) -> None:
        """Store a processed frame (one RGB per module) back in the layout."""
        for module, rgb in zip(self._layout.device_layout, frame):
            module.data = [rgb_to_hex(rgb)]

    def set_extended_effects_enabled(self, enabled: bool) -> None:
        self._extended_effects_enabled = enabled
        if self._config_entry.options.get("extended_effects_enabled") is not enabled:
            self.hass.config_entries.async_update_entry(
                self._config_entry,
                options={**self._config_entry.options, "extended_effects_enabled": enabled},
            )

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
            self._orientation = _DEVICE_ORIENTATION_TO_FLIP[device_orientation_val]
        elif attributes.get("orientation") in (ORIENTATION_NORMAL, ORIENTATION_FLIPPED):
            # Legacy state that only stored normal/flipped.
            self._orientation = attributes["orientation"]
            self._device_orientation = (
                "left" if self._orientation == ORIENTATION_FLIPPED else "right"
            )

    async def async_added_to_hass(self):
        _LOGGER.debug("[INIT] async_added_to_hass called for %s", self._attr_name)
        await super().async_added_to_hass()
        # async_update (clock time-zone refresh, native property polling) runs
        # on Home Assistant's regular light polling interval.

        # Start periodic health check to detect devices coming back online
        self._health_check_task = self._create_tracked_task(
            self._periodic_health_check(), name=f"yeelight_cube_health_check_{self._ip}"
        )
        
        # Register entity by entity_id now that it's available
        # Remove the temporary IP-based registration first to avoid duplicates
        if self._ip in _ENTITY_REGISTRY:
            del _ENTITY_REGISTRY[self._ip]
        _ENTITY_REGISTRY[self.entity_id] = self
        _LOGGER.debug("[SETUP] Registered entity %s in registry. Registry now contains: %s", self.entity_id, list(_ENTITY_REGISTRY.keys()))
        
        _LOGGER.debug("[INIT] Initial state - custom_text: '%s', mode: '%s', is_on: %s, brightness: %s", self._custom_text, self._mode, self._is_on, self._brightness)
        old_state = await self.async_get_last_state()
        self._restore_extended_effects(old_state)
        _LOGGER.debug("[RESTORE] old_state exists: %s", old_state is not None)
        if old_state:
            self._restore_state(old_state)
        self._restore_music_flow_runtime_state()
        self._restore_favourites()
        self._restore_rotation_settings()
        # Palettes and pixel arts are accessed via @property from global storage
        # No restoration needed - __init__.py loads from Store into hass.data[DOMAIN]
        _LOGGER.debug("[RESTORE] Entity initialized. Palettes: %s, Pixel Arts: %s", len(self._palettes), len(self._pixel_arts))
            # Note: No need to copy back to hass.data - we're using shared references now
        self.async_schedule_update_ha_state()
        # Push freshly restored values to every linked helper entity. On a
        # reload (e.g. a DHCP IP change) a helper may have been added before
        # this restore ran; without this its control shows the default — the
        # cause of the Experimental Features switch reverting to off.
        self._refresh_linked_entities()
        
        _LOGGER.debug("[INIT] After state restoration - custom_text: '%s', mode: '%s', is_on: %s", self._custom_text, self._mode, self._is_on)
        _LOGGER.debug("[INIT] Calling initial async_apply_display_mode to display HELLO...")
        
        # Apply initial display mode to show HELLO
        # Use 'turn_on' type so this isn't blocked by the retry limit after HA restart
        if self._is_on and self._music_flow_enabled:
            _LOGGER.debug(
                "[INIT] Music flow was active before restart; preserving renderer"
            )
        elif self._is_on:
            await self.async_apply_display_mode(update_type='turn_on')
        else:
            _LOGGER.debug("[INIT] Light is off, not applying display mode")
        if self._rotation_restore:
            self._create_tracked_task(
                self._async_resume_saved_rotation(),
                name=f"yeelight_cube_rotation_resume_{self._ip}",
            )

    async def async_will_remove_from_hass(self):
        """Clean up when entity is removed"""
        self.stop_scroll_timer()

        # Stop any server-side rotation loop owned by this entity. Its saved
        # state is kept: a restart or reload resumes it.
        self.stop_effect_rotation(persist=False)
        
        # Cancel display retry task
        if self._retry_display_task and not self._retry_display_task.done():
            self._retry_display_task.cancel()
        
        # Cancel health check task
        if self._health_check_task and not self._health_check_task.done():
            self._health_check_task.cancel()
        
        # Cancel calibration-lock auto-release timer
        if self._calibration_lock_unsub is not None:
            self._calibration_lock_unsub.cancel()
            self._calibration_lock_unsub = None
        
        # Cancel all background tasks (fire-and-forget brightness commands)
        if self._background_tasks:
            _LOGGER.debug("[CLEANUP] Cancelling %s background tasks", len(self._background_tasks))
            for task in self._background_tasks:
                if not task.done():
                    task.cancel()
            # Wait for cancellation with timeout
            try:
                await asyncio.wait(self._background_tasks, timeout=1.0)
            except asyncio.TimeoutError:
                pass
            self._background_tasks.clear()
        
        _LOGGER.debug("[CLEANUP] Stopped scroll timer and background tasks on entity removal")

    # Entity-facing service handlers are registered once from component setup.

    async def ensure_fx_ready(self):
        """Ensure FX mode is active using raw TCP (one fresh connection for activate_fx_mode).

        Steps:
          1. Close any existing persistent socket (clean slate)
          2. Optional 300ms settle when leaving a firmware-native mode
          3. Send activate_fx_mode on a fresh TCP connection (RST-closed)
          4. Sleep 150ms -- firmware settle time before opening the persistent socket
          5. Reset state flags (_last_hardware_brightness = 0 forces brightness
             re-send on the next apply call)

        The caller is responsible for sending set_bright AFTER this returns.
        In apply(), set_bright is sent on the persistent socket (via
        send_command_fast) immediately after ensure_fx_ready, so both
        set_bright and update_leds travel on the same TCP connection.  This
        avoids the extra RST connection that was causing the firmware to exit
        direct mode before update_leds arrived ("illegal request" errors).

        Why no TCP probe:
        A probe RST before activate_fx_mode was a third rapid RST connection
        that could confuse the Cube firmware. Dead devices are handled by the
        APPLY_HARD_TIMEOUT / circuit-breaker mechanism instead.
        """
        cm = self._cube_matrix

        _LOGGER.debug(
            "[ENSURE_FX] [%s] Activating FX mode via raw TCP "
            "[%s]",
            self._ip, cm.summary
        )

        # Step 1: Kill persistent socket
        cm.close_fast_socket()

        # Step 2 (optional): When leaving a firmware-native mode (clock, native
        # animation, color flow), give the renderer + TCP stack time to settle
        # before we open a new connection.  This shortens the ribbon flash.
        #
        # activate_fx_mode is always RST-closed (abortive_close=True, the
        # default).  A graceful FIN here caused the firmware to silently ignore
        # the mode change, leaving the lamp stuck on the ribbon indefinitely.
        coming_from_native = self._in_native_fw_mode
        if coming_from_native:
            _LOGGER.debug(
                "[ENSURE_FX] [%s] Coming from native mode -- settling before "
                "activate_fx_mode",
                self._ip,
            )
            await asyncio.sleep(0.3)  # Let native renderer + Cube TCP stack settle

        # Step 3: activate_fx_mode on a SINGLE fresh TCP (RST close)
        await cm.send_raw_command("activate_fx_mode", [{"mode": "direct"}])

        # Step 4: Let the firmware fully enter direct mode before anything else
        # connects.  50ms was too tight -- the subsequent set_bright RST was
        # arriving while the lamp was still transitioning, causing it to exit
        # direct mode before update_leds arrived.  150ms is reliable on LAN.
        await asyncio.sleep(0.15)

        # Step 5: Update state.
        # _last_hardware_brightness is reset to 0 (sentinel) so apply()
        # unconditionally re-sends set_bright on the persistent socket -- both
        # the direct path (if not _fx_mode_is_direct) and the indirect path
        # (force_refresh → _apply_display_mode_internal → apply() else-branch
        # sees hardware_brightness != 0 and sends set_bright).
        self._fx_mode_is_direct = True
        self._in_native_fw_mode = False
        self._last_fx_mode_time = time.time()
        self._last_hardware_brightness = 0  # Sentinel: force brightness re-confirm

        _LOGGER.debug(
            "[ENSURE_FX] [%s] [OK] FX activated -- set_bright will follow on persistent socket", self._ip
        )

    async def _force_refresh_impl(self):
        """Force refresh implementation - runs inside _execute_hardware_op lock.
        
        Reconnects the active renderer and re-renders its current display.
        
        IMPORTANT: We must NOT read raw pixel data from self._layout and
        send it directly, because apply() applies software brightness
        darkening IN PLACE to module.data.  Sending those already-darkened
        pixels while also setting hardware brightness via set_bright would
        result in double-darkening (dimmer than intended).
        
        Instead, we re-render through _apply_display_mode_internal() which:
          1. Fills the layout with fresh un-darkened colors (text/drawing)
          2. Calls apply() which applies color effects + brightness
             darkening correctly, then sends the final pixel data.
        Since ensure_fx_ready() already set _fx_mode_is_direct=True,
        apply() will skip redundant FX activation.
        """
        if not self._is_on or self._music_flow_enabled:
            return
        if self._mode in FIRMWARE_MODES:
            self._cube_matrix.close_fast_socket()
        else:
            await self.ensure_fx_ready()
        
        # Step 4: Re-render through the full display pipeline so brightness
        # darkening is applied once (not double-applied on stale pixel data).
        await self._apply_display_mode_internal(skip_post_delay=True)
        _LOGGER.info(
            "[FORCE REFRESH] [%s] Complete - "
            "mode=%s, brightness=%s%%, "
            "display re-rendered",
            self._ip, self._mode, self._last_hardware_brightness
        )

    async def async_force_refresh(self):
        """Force refresh via _execute_hardware_op (properly serialized with device lock)."""
        if not self._is_on:
            return
        if self._music_flow_enabled:
            await self.async_set_music_flow(True)
            return
        _LOGGER.info(
            "[FORCE REFRESH] [%s] Starting -- "
            "closing persistent socket and using raw TCP",
            self._ip
        )
        await self._execute_hardware_op(
            lambda: self._force_refresh_impl(),
            "force_refresh"
        )

    async def async_turn_on(self, **kwargs):
        """Turn on the light."""
        _LOGGER.debug("[TURN_ON] async_turn_on called with kwargs: %s", kwargs)
        
        # Calibration lock: ignore automation turn_on (incl. light.turn_on with
        # brightness/color/text) while the wizard owns the lamp.
        if self._calibration_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] turn_on ignored -- calibration lock active", self._ip
            )
            return

        # Remember whether the lamp was already on: a brightness-only turn_on on
        # an already-running native effect must not re-activate it (that restarts
        # the animation from frame zero), it should only push the new brightness.
        was_on = self._is_on

        if any(key in kwargs for key in ("rgb_color", "text_colors")) and (
            self._rotation_active
            or self._rotation_resume_pending
        ):
            self.stop_effect_rotation()

        # Brightness remains adjustable while Music Flow owns the display.
        # Explicit color content must first release the firmware renderer so
        # the requested RGB/text colors are not silently ignored.
        if self._music_flow_enabled and any(
            key in kwargs for key in ("rgb_color", "text_colors")
        ):
            await self.async_set_music_flow(False, restore_display=False)
        
        # Update HA state IMMEDIATELY for responsive UI
        self._is_on = True
        if "brightness" in kwargs:
            self._brightness = max(1, min(255, kwargs["brightness"]))
        if "rgb_color" in kwargs:
            self._rgb_color = tuple(kwargs["rgb_color"])
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_turn_on(_was_on=was_on, **kwargs),
            "turn_on"
        )
    
    async def _internal_turn_on(self, **kwargs):
        """Internal turn_on implementation -- runs under the global lock."""
        was_on = kwargs.pop("_was_on", False)
        _LOGGER.debug("[TURN_ON] Executing - is_on: %s, custom_text: '%s', mode: '%s'", self._is_on, self._custom_text, self._mode)

        if self._music_flow_enabled:
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
                await self._set_native_mode_brightness()
            self._is_on = True
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return

        if self._mode == MODE_CLOCK:
            self._is_on = True
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
            # Brightness-only change on the already-running clock: just push the
            # brightness so the clock is not torn down and rebuilt.
            if was_on and set(kwargs) <= {"brightness"}:
                await self._set_native_mode_brightness()
            else:
                await self._activate_native_clock()
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return
        if self._mode == MODE_NATIVE_EFFECT:
            self._is_on = True
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
            # Brightness-only change on an already-running effect: push the new
            # brightness only. Re-activating here would restart the animation
            # from the first frame (mirrors _internal_set_brightness).
            if was_on and set(kwargs) <= {"brightness"}:
                await self._set_native_mode_brightness()
            else:
                await self._activate_native_effect()
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return
        
        # Ensure FX mode is active using raw TCP (proven reliable).
        # ensure_fx_ready() handles activate_fx_mode + set_bright atomically.
        if not self._fx_mode_is_direct:
            _LOGGER.debug("[TURN_ON] Activating FX mode via raw TCP")
            await self.ensure_fx_ready()
        
        self._is_on = True
        
        # Handle colors from kwargs
        if "text_colors" in kwargs:
            _LOGGER.debug("[TURN_ON] Setting text_colors from kwargs: %s", kwargs['text_colors'])
            self._text_colors = [tuple(c) for c in kwargs["text_colors"]]
            self._sync_rgb_color()
        
        if "rgb_color" in kwargs:
            rgb_color = kwargs["rgb_color"]
            _LOGGER.debug("[TURN_ON] RGB color selected: %s", rgb_color)
            self._text_colors = [tuple(rgb_color)]
            self._sync_rgb_color()
        
        _LOGGER.debug("[TURN_ON] Current state - text_colors: %s, background: %s", self._text_colors, self._background_color)
        
        try:
            if "brightness" in kwargs:
                new_brightness = kwargs["brightness"]
                _LOGGER.debug("[TURN_ON] Setting brightness to %s", new_brightness)
                # Call internal directly -- we're already under the global lock
                call_id = int(time.time() * 1000) % 100000
                await self._internal_set_brightness(new_brightness, call_id)
            else:
                # Ensure brightness is at least 1
                if self._brightness < 1:
                    self._brightness = 1
                
                # Apply display with current brightness
                # _apply_display_mode_internal handles FX staleness, set_bright if needed,
                # and sends pixel data all in one pass.
                await self._apply_display_mode_internal()
        except Exception as e:
            if is_quota_error(e):
                _LOGGER.debug("Rate limit exceeded during turn_on")
            elif isinstance(e, TimeoutError):
                _LOGGER.warning("Timeout during turn_on - device may be unreachable")
            else:
                _LOGGER.error("Unexpected error during turn_on: %s", e)
        
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug("[TURN_ON] Turn on complete")

    async def async_turn_off(self, **kwargs):
        """Turn off the light."""
        _LOGGER.debug("[TURN_OFF] async_turn_off called")
        
        # Calibration lock: ignore automation turn_off while the wizard runs.
        if self._calibration_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] turn_off ignored -- calibration lock active", self._ip
            )
            return
        
        # Update HA state IMMEDIATELY for responsive UI
        self._is_on = False
        self.stop_effect_rotation()
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_turn_off(**kwargs),
            "turn_off"
        )
    
    async def _internal_turn_off(self, **kwargs):
        """Internal turn_off implementation that executes in the queue."""
        _LOGGER.debug("[TURN_OFF] Executing turn_off")
        was_music_flow_enabled = self._music_flow_enabled
        if was_music_flow_enabled or self._mode in FIRMWARE_MODES:
            self._cube_matrix.close_fast_socket()
            await self._cube_matrix.send_raw_command("set_power", ["off"])
        else:
            await self.erase_all()
            await self.apply()
        self._is_on = False
        self._music_flow_enabled = False
        self._music_flow_restore_power = None
        if was_music_flow_enabled:
            await self._persist_music_flow_runtime_state()
            self._refresh_music_flow_entities()
        self._notify_camera_preview()
        # NOTE: Do NOT reset _fx_mode_is_direct here!
        # The FX socket is still alive after sending blank pixel data.
        # On turn_on we just reuse the existing socket -- no activate_fx_mode
        # needed.  If the socket dies while off (Cube idle timeout), the
        # natural error-detection in send_command_fast / apply() will detect
        # it and re-activate FX mode automatically.
        # Previously this was set to False, which forced EVERY turn_on to
        # close the socket, wait 300ms, and open a new one for
        # activate_fx_mode -- a cycle that timed out ~50% of the time.
        self._last_hardware_brightness = None  # Reset hardware brightness tracking
        self._last_applied_darken = None        # Reset darken tracking
        self._last_apply_time = 0  # Reset cooldown timer to ensure turn_on will work immediately
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug("[TURN_OFF] Turn off complete")

    async def set_brightness(self, brightness: int, **kwargs):
        """
        Unified brightness control using BOTH hardware brightness and RGB darkening.

        One slider (1-255) drives both mechanisms together across the whole
        range, with no switch-over point (see the UNIFIED BRIGHTNESS CONTROL
        notes on the class and _calculate_brightness_values):
        - 1:   hardware at the hardware floor, darkening at the darken floor
        - 255: hardware at 100%, no darkening

        The new value is published at once so cards preview it, then the
        hardware command runs under the device lock. set_bright is sent
        without waiting for a reply, and only the parts that changed (hardware
        level, pixel darkening) are re-sent.
        """
        # Calibration lock: ignore automation brightness changes while the wizard
        # drives the lamp. Wizard calls pass bypass_lock=True.
        bypass_lock = kwargs.pop("bypass_lock", False)
        if self._calibration_lock and not bypass_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] set_brightness(%s) ignored "
                "-- calibration lock active",
                self._ip, brightness
            )
            return
        call_id = int(time.time() * 1000) % 100000
        _LOGGER.debug(
            "[BRIGHTNESS_DIAG] [%s] SET_BRIGHTNESS called: "
            "requested=%s, current=%s, is_on=%s",
            self._ip, brightness, self._brightness, self._is_on
        )
        
        # Update internal state and HA IMMEDIATELY so the UI reflects the
        # user's intent without waiting for the lamp command to complete.
        # The actual hardware command still goes through the queue.
        if self._is_on:
            old_brightness = self._brightness
            self._brightness = max(1, min(255, brightness))
            # CRITICAL: Calculate and apply _preview_darken BEFORE the state push.
            # extra_state_attributes uses _preview_darken to compute brightness-
            # adjusted matrix_colors.  Without this, the JS card would get the
            # updated brightness but STALE matrix_colors (old darken level),
            # making the preview lag behind the slider by the full lamp roundtrip.
            _, darken_percent = self._calculate_brightness_values(self._brightness)
            self._preview_darken = darken_percent
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] SET_BRIGHTNESS state update: "
                "%s -> %s, darken=%s%%",
                self._ip, old_brightness, self._brightness, darken_percent
            )
            if self.hass is not None:
                _LOGGER.debug(
                    "[TIMING] [%s] brightness state_push epoch=%.3f", self._ip, time.time())
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_set_brightness(brightness, call_id, **kwargs),
            f"brightness:{brightness}"
        )
    
    async def _internal_set_brightness(self, brightness: int, call_id: int, **kwargs):
        """Internal brightness implementation -- runs under the global lock."""
        _LOGGER.debug(
            "[BRIGHTNESS_DIAG] [%s] INTERNAL_SET #%s -- "
            "requested=%s, current=%s, "
            "last_hw=%s, last_darken=%s",
            self._ip, call_id, brightness, self._brightness,
            self._last_hardware_brightness, self._last_applied_darken
        )
        
        if self._is_on:
            # Store the raw HA brightness value (1-255 for ON lights, 0 means OFF)
            old_brightness = self._brightness
            self._brightness = max(1, min(255, brightness))  # Clamp to 1-255 for ON state
            _LOGGER.debug("[BRIGHTNESS #%s] Brightness changed: %s -> %s", call_id, old_brightness, self._brightness)

            if self.firmware_draws_matrix:
                await self._set_native_mode_brightness()
                if self.hass is not None:
                    self.async_schedule_update_ha_state()
                return
            
            # Calculate BOTH hardware brightness and darkness percentage
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            
            _LOGGER.debug(
                "[BRIGHTNESS #%s] User brightness %s (1-255) -> "
                "hardware=%s%%, darkness=%s%%",
                call_id, self._brightness, hardware_brightness, darken_percent
            )
            
            try:
                # BRIGHTNESS UPDATE OPTIMIZATION:
                # 1. Hardware brightness command is FIRE-AND-FORGET (lamp doesn't respond)
                # 2. Display update requires re-rendering all 100 LEDs with new darkness
                # 3. When BOTH change: Execute in parallel for maximum speed
                # 4. When only ONE changes: Execute only that operation
                
                # Track what changed to avoid redundant updates
                # CRITICAL: Compare darken against _last_applied_darken (what was actually
                # rendered to the lamp), NOT _preview_darken.  set_brightness() updates
                # _preview_darken early for the JS card preview, so by the time this
                # queued function runs, _preview_darken already equals darken_percent
                # and the comparison would ALWAYS be False -- skipping the display
                # update that bakes RGB darkening into the actual lamp pixels.
                darken_changed = (self._last_applied_darken != darken_percent)
                hardware_changed = (self._last_hardware_brightness != hardware_brightness)
                
                # Update the darken value (affects next display render)
                old_darken = self._last_applied_darken
                old_hardware = self._last_hardware_brightness
                self._preview_darken = darken_percent
                
                # CRITICAL: Update _last_hardware_brightness BEFORE any branch
                # that calls _apply_brightness_only() or _apply_color_correction().
                # _apply_color_correction() reads this to determine correction
                # strength -- if updated AFTER _apply_brightness_only(), the
                # correction uses the OLD hardware brightness -> wrong colors.
                # (In non-hardware_changed branches, this is a no-op since the
                # value hasn't changed.)
                self._last_hardware_brightness = hardware_brightness
                
                # OPTIMIZATION: Execute hardware and display updates optimally
                if hardware_changed and darken_changed:
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] BOTH changed - "
                        "hardware: %s%% -> %s%%, "
                        "darkness: %s%% -> %s%% - sequential hw then display",
                        call_id, old_hardware, hardware_brightness, old_darken,
                        darken_percent
                    )
                    # IMPORTANT: Send hardware brightness FIRST, then update display.
                    # If we fire-and-forget the hardware command while sending the display
                    # update, the lamp may receive the new darkened RGB values while still
                    # at the OLD hardware brightness, causing a brief brightness dip.
                    # By awaiting the hardware command first, we ensure the lamp's hardware
                    # brightness is updated BEFORE it receives the new RGB pixel data.
                    
                    await self._send_hardware_brightness(hardware_brightness)
                    
                    # PERFORMANCE: Use _apply_brightness_only() which re-darkens
                    # the existing _base_matrix_colors and sends draw_matrices_fast
                    # (fire-and-forget).  This avoids the full re-render of text/
                    # pixels in _apply_display_mode_internal() and the recv() wait.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change for anti-overwrite protection
                    # CRITICAL: Track AFTER both hardware and display complete
                    # This prevents retry queue from applying stale brightness (hardware + darkness)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Tracked successful brightness: "
                        "%s (hardware=%s%%, darkness=%s%%)",
                        call_id, self._brightness, hardware_brightness, darken_percent
                    )
                    
                    # _last_hardware_brightness already set above (before branches)
                    self._last_applied_darken = darken_percent
                    
                elif hardware_changed:
                    # Only hardware changed - send command and await it
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Hardware brightness changed: "
                        "%s%% -> %s%%, sending...",
                        call_id, old_hardware, hardware_brightness
                    )
                    await self._send_hardware_brightness(hardware_brightness)
                    
                    # _last_hardware_brightness already set above (before branches)
                    
                    # IMPORTANT: Re-render pixels with updated color correction.
                    # _apply_color_correction() uses _last_hardware_brightness which
                    # just changed -- existing pixels have stale correction baked in.
                    # Without this, low-brightness color correction would be wrong
                    # until the next full re-render.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change (hardware only, darkness unchanged)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    
                elif darken_changed:
                    # Only darkness changed - use FAST PATH (no full re-render)
                    _LOGGER.debug(
                        "[BRIGHTNESS #%s] Darkness changed: %s%% -> %s%%, "
                        "using fast brightness path...",
                        call_id, old_darken, darken_percent
                    )
                    # PERFORMANCE: _apply_brightness_only() re-darkens existing
                    # _base_matrix_colors and sends fire-and-forget draw_matrices.
                    # Skips the full text/pixel re-render + recv() wait.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change (darkness only, hardware unchanged)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    self._last_applied_darken = darken_percent
                    
                else:
                    # Nothing changed numerically.  But if color effects are active,
                    # we STILL need to re-render: _apply_display_mode_internal
                    # re-places pixels from scratch and then apply() bakes in the
                    # effects.  Without this display update the lamp would show the
                    # raw (un-effected) pixels from the last _internal_turn_on.
                    if self._has_color_effects:
                        _LOGGER.debug(
                            "[BRIGHTNESS #%s] Values unchanged but effects active "
                            " -- forcing display update to preserve effects",
                            call_id
                        )
                        # PERFORMANCE: Direct call -- see comment in 'both changed' branch.
                        await self._apply_display_mode_internal(skip_post_delay=True)
                    else:
                        _LOGGER.debug("[BRIGHTNESS #%s] No changes needed, brightness already at target", call_id)
                    
            except Exception as e:
                # Most errors are already handled gracefully in cube_matrix.send_command_with_recovery
                # Only truly unexpected errors reach here
                if is_quota_error(e):
                    _LOGGER.warning("[BRIGHTNESS #%s] Rate limit exceeded - backing off", call_id)
                elif isinstance(e, TimeoutError):
                    _LOGGER.warning("[BRIGHTNESS #%s] Timeout - device may be unreachable", call_id)
                else:
                    _LOGGER.error("[BRIGHTNESS #%s] Unexpected error: %s", call_id, e)
        else:
            _LOGGER.debug("[BRIGHTNESS #%s] Light is off, not applying brightness", call_id)

    async def _send_hardware_brightness(self, hardware_brightness: int) -> None:
        """Send set_bright on the persistent socket (fire-and-forget, no reply
        awaited: the Cube closes TCP after each command). While the
        connection is down the user's brightness is queued for retry instead.

        _fx_mode_is_direct is NOT reset here: set_bright does not knock the
        Cube out of direct mode, and resetting it would make apply() re-send
        activate_fx_mode + set_bright (~300ms) on every brightness change. The
        FX_MODE_STALENESS_TIMEOUT check in apply() is the safety net if the
        Cube silently leaves direct mode after an idle period.
        """
        if not self._cube_matrix.is_connected():
            _LOGGER.debug(
                "[BRIGHTNESS] Connection down -- queued brightness %s for retry",
                self._brightness,
            )
            self._pending_brightness = (self._brightness, time.time())
            self._start_brightness_retry_task()
            return
        try:
            await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
        except Exception as e:
            if not (is_connection_error(e) or is_quota_error(e)):
                _LOGGER.warning(
                    "[BRIGHTNESS] Unexpected error sending hardware brightness: %s", e
                )

    def _start_brightness_retry_task(self):
        """Start background task to retry failed brightness when connection recovers"""
        if self._brightness_retry_task is None or self._brightness_retry_task.done():
            self._brightness_retry_task = self._create_tracked_task(
                self._process_brightness_retries(), name=f"yeelight_cube_brightness_retry_{self._ip}"
            )
    
    async def _process_brightness_retries(self):
        """
        Background task to retry failed brightness when connection recovers.
        
        ANTI-OVERWRITE PROTECTION:
        - Only retries if no newer brightness has been successfully applied
        - Drops stale queued brightness if user changed brightness since failure
        - Example: Brightness 20% queued -> User sets 60% successfully -> Drop queued 20%
        """
        _LOGGER.debug("[BRIGHTNESS RETRY] Retry processor started")
        
        while self._pending_brightness is not None:
            # Wait for connection to be available
            if not self._cube_matrix.is_connected():
                await asyncio.sleep(0.5)  # Check every 500ms
                continue
            
            # Get pending brightness
            pending_value, queued_timestamp = self._pending_brightness
            
            # Check if brightness expired (30s TTL)
            if time.time() - queued_timestamp > 30.0:
                _LOGGER.debug("[BRIGHTNESS RETRY] Dropping expired brightness: %s", pending_value)
                self._pending_brightness = None
                continue
            
            # ANTI-OVERWRITE CHECK: Has a newer brightness already succeeded?
            if self._last_successful_brightness is not None:
                last_success_time, last_success_value = self._last_successful_brightness
                
                # If a newer brightness succeeded AFTER this one was queued, drop it
                if last_success_time > queued_timestamp:
                    _LOGGER.debug(
                        "[BRIGHTNESS RETRY] Dropping stale brightness %s - "
                        "newer brightness %s already applied "
                        "(queued at %.2f, superseded at %.2f)",
                        pending_value, last_success_value, queued_timestamp,
                        last_success_time
                    )
                    self._pending_brightness = None
                    continue
            
            # Try to re-apply the complete brightness through the queue
            try:
                _LOGGER.debug("[BRIGHTNESS RETRY] Retrying brightness %s via queue", pending_value)
                # Queue through the proper channel so it's serialized with other operations
                await self.set_brightness(pending_value)
                # Success - clear pending
                self._pending_brightness = None
                _LOGGER.debug("[BRIGHTNESS RETRY] Successfully queued brightness retry %s", pending_value)
            except Exception as e:
                # Failed again - will retry later
                _LOGGER.debug("[BRIGHTNESS RETRY] Retry failed for brightness %s: %s", pending_value, e)
                # If connection is down again, wait longer
                if not self._cube_matrix.is_connected():
                    await asyncio.sleep(1)
                else:
                    # Other error - clear pending to avoid infinite retry
                    _LOGGER.warning("[BRIGHTNESS RETRY] Clearing pending brightness due to error: %s", e)
                    self._pending_brightness = None
            
            # Small delay between retry attempts
            await asyncio.sleep(0.1)
        
        _LOGGER.debug("[BRIGHTNESS RETRY] Retry processor finished (no pending brightness)")

    async def async_update(self, *args, **kwargs):
        """Refresh timezone and best-effort native device properties."""
        # Opening a standard LAN-control connection can stop the Cube's
        # microphone renderer. Preserve Music Flow until a user command exits it.
        if self._music_flow_enabled:
            return

        if self._mode == MODE_CLOCK and self._is_on:
            timezone_hours = self._native_clock_timezone_hours()
            if self._native_clock_timezone_offset is None:
                # First poll after startup / integration reload: the lamp is
                # already showing the clock, and _native_clock_timezone_offset
                # is not restored from state (starts as None).  Re-activating
                # here would tear down and rebuild the clock "by itself" -- and
                # if it races an in-flight manual send it can drop the panel to
                # the ribbon.  Just record the baseline silently; a real
                # timezone change (e.g. DST) will re-activate on a later poll.
                self._native_clock_timezone_offset = timezone_hours
            elif timezone_hours != self._native_clock_timezone_offset:
                _LOGGER.info(
                    "[CLOCK] [%s] Refreshing clock UTC offset from %s to %+d",
                    self._ip,
                    self._native_clock_timezone_offset,
                    timezone_hours,
                )
                await self.async_apply_display_mode(update_type="display_update")

        # Cube Lite does not answer get_prop while a firmware-native renderer
        # is active. Opening that standard LAN-control connection can also make
        # the firmware leave the clock/effect and restore an older mode.
        if self._mode in FIRMWARE_MODES:
            return

        now = time.monotonic()
        if now - self._last_native_state_poll < 60:
            return
        # Matrix rendering owns a persistent direct-FX socket. A second polling
        # connection can make the Cube's small TCP stack drop animation frames.
        if self._fx_mode_is_direct:
            return
        self._last_native_state_poll = now
        try:
            props = await self._cube_matrix.read_properties(
                ["power", "bright", "init_power_opt", "mic_music_mode"]
            )
            music_state_changed = False
            power = str(props.get("power", "")).lower()
            if power in ("on", "off"):
                self._is_on = power == "on"
                if power == "off" and self._music_flow_enabled:
                    self._music_flow_enabled = False
                    self._music_flow_restore_power = None
                    music_state_changed = True
            brightness = props.get("bright")
            if brightness not in (None, ""):
                self._brightness = max(
                    1, min(255, round(int(brightness) * 255 / 100))
                )
            power_value = props.get("init_power_opt")
            for label, value in POWER_ON_STATES.items():
                if str(power_value) == str(value):
                    self._power_on_state = label
                    break
            music_enabled, music_effect_id = _parse_music_flow_config(
                props.get("mic_music_mode")
            )
            if music_enabled is not None:
                music_state_changed = (
                    music_state_changed
                    or music_enabled != self._music_flow_enabled
                )
                self._music_flow_enabled = music_enabled
                if music_enabled:
                    self._is_on = True
                    self._fx_mode_is_direct = False
                    self._in_native_fw_mode = True
            music_effect = MUSIC_FLOW_EFFECT_IDS.get(music_effect_id)
            if music_effect is not None:
                music_state_changed = (
                    music_state_changed
                    or music_effect != self._music_flow_effect
                )
                self._music_flow_effect = music_effect
            if music_state_changed:
                await self._persist_music_flow_runtime_state()
                self._refresh_music_flow_entities()
                self._notify_camera_preview()
                if self.hass is not None:
                    self.async_write_ha_state()
        except Exception as err:
            _LOGGER.debug("[%s] Native property polling unavailable: %s", self._ip, err)

    async def erase_all(self):
        background_color_hex = rgb_to_hex(self._background_color)
        for module in self._layout.device_layout:
            module.set_colors([background_color_hex])

    async def set_custom_text(self, text_chars: str):
        if not isinstance(text_chars, str):
            _LOGGER.error("set_custom_text received non-string character: %s", text_chars)
            return
        # Prevent empty text -- the Yeelight firmware misbehaves when given
        # an empty string.  Use a single space instead (renders as blank).
        if text_chars == "":
            text_chars = " "
        self._custom_text = text_chars
        
        # Notify text input entity of the change (only if it's been added to hass)
        if self._text_input_entity and hasattr(self._text_input_entity, 'hass') and self._text_input_entity.hass is not None:
            self._text_input_entity.async_update_from_light()
        
        # Push HA state eagerly so automations see the new custom_text
        # immediately (see handle_set_custom_text for detailed rationale).
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        if self._is_on:
            await self.async_apply_display_mode(update_type='text_change')

    async def async_apply_display_mode(self, update_type: str = 'display_update', bypass_lock: bool = False):
        """Queue a display mode update to be processed sequentially"""
        if update_type in {"color_change", "pixel_art", "text_change"} and (
            self._rotation_resume_pending
            or (
                self._rotation_active
                and self._mode != (ROTATION_KIND_MODES.get(self._rotation_kind, MODE_NATIVE_EFFECT))
            )
        ):
            self.stop_effect_rotation()
        # Calibration lock: while the wizard owns the lamp, drop every display
        # update that doesn't explicitly bypass the lock (i.e. anything not coming
        # from the wizard). This freezes the panel on the wizard's test pattern so
        # automations (custom text, pixel art, clock, sensors...) can't disturb it.
        if self._calibration_lock and not bypass_lock:
            _LOGGER.debug(
                "[CALIB_LOCK] [%s] Display update '%s' ignored "
                "-- calibration lock active",
                self._ip, update_type
            )
            return

        if self._music_flow_enabled:
            if update_type not in MUSIC_FLOW_EXIT_UPDATE_TYPES:
                _LOGGER.debug(
                    "[MUSIC FLOW] [%s] Ignoring background display update '%s'",
                    self._ip,
                    update_type,
                )
                return
            await self.async_set_music_flow(False, restore_display=False)

        # FIRMWARE-NATIVE MODE OWNERSHIP: while the lamp is physically showing a
        # firmware clock / native animation / color flow, suppress *incidental*
        # matrix re-renders that would clobber it -- e.g. a sensor/template-driven
        # set_custom_text (text_change), a periodic refresh (display_update), or a
        # stale retry (display_retry).  This is the common "one lamp shows a clock,
        # an automation keeps pushing text to it" conflict.
        #
        # DELIBERATE switches to matrix content (pixel_art, color_change from the
        # content-mode select, turn_on, brightness_change) are NOT in this set, so
        # they pass through; when they render, apply() -> ensure_fx_ready()
        # clears _in_native_fw_mode, so subsequent updates flow normally again.
        #
        # Persisted Clock / Native Effect modes (_mode in those values) route to
        # their own activation path in _apply_display_mode_internal and must NOT
        # be suppressed, so they are excluded by the _mode check.
        _NATIVE_COMPETING_UPDATE_TYPES = {
            "text_change", "display_update", "display_retry",
        }
        if (
            self._in_native_fw_mode
            and self._mode not in FIRMWARE_MODES
            and update_type in _NATIVE_COMPETING_UPDATE_TYPES
            and not bypass_lock
        ):
            _LOGGER.debug(
                "[DISPLAY] [%s] Update '%s' suppressed -- lamp is in a firmware-native "
                "mode. Switch the content mode or apply a drawing to leave it.",
                self._ip, update_type,
            )
            return
        # NOTE: _apply_cooldown removed. It was silently DROPPING updates
        # when they arrived within 100ms of each other (e.g., rapid pixel
        # drawing or fast slider changes). The queue's coalescing logic
        # already handles deduplication properly -- if two identical updates
        # are queued, the queue processor coalesces them. Dropping here
        # caused lost pixel art frames and missed state changes.
        is_retry = update_type == 'display_retry'
        
        # Only reset the retry counter when it has actually HIT the limit
        # AND the caller is a genuine user action (not a periodic display_update).
        #
        # User actions: turn_on, brightness_change, text_change, color_change,
        #               pixel_art (used by service calls)
        # Periodic:     display_update (from HA state polling, clock, sensors)
        #
        # Previously ANY non-retry call reset the counter.  This meant periodic
        # display_update calls arriving every ~30s would restart the retry
        # cycle for a device that's genuinely offline -- retrying forever.
        # Now only explicit user actions restart retries.
        user_action_types = {
            'turn_on', 'turn_off', 'brightness_change', 'text_change',
            'color_change', 'pixel_art',
        }
        is_user_action = update_type in user_action_types
        if not is_retry and self._display_retry_count >= self.MAX_DISPLAY_RETRIES:
            if is_user_action:
                _LOGGER.debug(
                    "[DISPLAY] [%s] User action '%s' reset retry counter "
                    "(%s -> 0) -- retries will resume",
                    self._ip, update_type, self._display_retry_count
                )
                self._display_retry_count = 0
                # Cancel any pending retry task -- without this, the old
                # retry fires immediately and pushes the counter back to the limit
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
                    _LOGGER.debug("[DISPLAY] [%s] Cancelled stale retry task", self._ip)
            else:
                _LOGGER.debug(
                    "[DISPLAY] [%s] Periodic '%s' skipped -- device offline, "
                    "retry limit reached (%s/%s). "
                    "A user action will restart retries.",
                    self._ip, update_type, self._display_retry_count,
                    self.MAX_DISPLAY_RETRIES
                )
                return  # Don't queue -- device is offline and no user is actively requesting
        
        log_level = _LOGGER.info if is_retry else _LOGGER.debug
        log_level(f"[DISPLAY] async_apply_display_mode called - mode: '{self._mode}', text: '{self._custom_text}', type: '{update_type}', is_on: {self._is_on}")
        
        # Track which type of update is running so the transition block in
        # apply() can skip animations on retries / recovery / periodic
        # refreshes.  Only genuine user-initiated content changes animate.
        self._current_update_type = update_type

        # Compute dynamic timeout: when a transition is enabled, the operation
        # needs transition_duration + overhead for FX activation + final send.
        # Without transition, use the default APPLY_HARD_TIMEOUT.
        op_timeout = None
        if (self._transition_type != "none"
                and self._last_sent_colors is not None
                and not self._transition_active):
            op_timeout = self._transition_duration + APPLY_HARD_TIMEOUT
        
        # Execute the display update under the global lock with error handling
        return await self._execute_hardware_op(
            lambda: self._apply_display_mode_internal(),
            f"display:{update_type}",
            timeout_override=op_timeout
        )

    async def _apply_brightness_only(self):
        """
        FAST PATH for brightness-only changes.
        
        Instead of the full _apply_display_mode_internal() which:
        1. Clears all modules to background color
        2. Re-places all text/pixels from scratch  (CPU work)
        3. Calls apply() which may re-send FX mode + set_bright  (2 TCP commands)
        4. Loops over 100 modules for effects + darkening  (CPU work)
        5. Sends draw_matrices  (1 TCP command)
        
        This method:
        1. Takes the existing _base_matrix_colors snapshot (already computed)
        2. Re-applies color effects + new brightness darkening to each pixel
        3. Encodes and sends draw_matrices_fast  (1 TCP command, fire-and-forget)
        
        Savings: ~200-400ms of TCP round-trips + full re-render avoided.
        Only valid when the underlying pixel art/text hasn't changed -- just the
        brightness level (darken_percent).
        """
        try:
            if not self._cube_matrix.is_connected():
                _LOGGER.warning("[BRIGHTNESS_FAST] [%s] SKIP -- cooldown active", self._ip)
                raise CubeConnectionError("Cooldown active -- device not yet reachable")
            
            # If we don't have base colors yet, fall back to the full path
            base_colors = self._base_matrix_colors
            if not base_colors or len(base_colors) != len(self._layout.device_layout):
                _LOGGER.debug("[BRIGHTNESS_FAST] No base colors -- falling back to full apply")
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # STALENESS CHECK: Same as in apply() -- check fx_age, not idle.
            # Falls through to full apply path which uses ensure_fx_ready() (raw TCP).
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    _LOGGER.warning(
                        "[BRIGHTNESS_FAST] [%s] FX mode stale -- fx_age=%.0fs > "
                        "%.0fs, falling back to full apply (raw TCP recovery)",
                        self._ip, fx_age, FX_MODE_STALENESS_TIMEOUT
                    )
                    self._fx_mode_is_direct = False

            # If FX mode isn't set, fall back to the full path which handles activation
            if not self._fx_mode_is_direct:
                _LOGGER.debug("[BRIGHTNESS_FAST] FX mode not set -- falling back to full apply")
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Check if reconnection happened
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.debug("[BRIGHTNESS_FAST] Reconnection detected -- falling back to full apply")
                self._fx_mode_is_direct = False
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Re-apply brightness + accuracy to the base colors.
            #
            # IMPORTANT: _base_matrix_colors already has color effects baked in
            # (hue_shift, saturation, contrast, temperature, vibrance, glow,
            #  grayscale, invert, tint).  They were applied during the full
            # render in apply() and snapshotted AFTER apply_color_adjustments.
            # Do NOT call apply_color_adjustments() again here -- that would
            # double-apply every color effect (e.g., hue shift applied twice).
            #
            # What we DO re-apply each time brightness changes:
            #   1. _apply_final_brightness -- RGB darkening for brightness
            #   2. _apply_color_correction -- low-brightness gamma correction
            #   3. _apply_color_accuracy -- per-channel gain (fades with brightness)
            
            # Write darkened colors directly into modules
            _LOGGER.debug(
                "[BRIGHTNESS_DIAG] [%s] BRIGHTNESS_FAST -- "
                "user=%s/255, darken=%s%%, "
                "brighten=%s%%, "
                "last_hw=%s, last_darken=%s, "
                "base_colors_count=%s",
                self._ip, self._brightness, self._preview_darken,
                self._preview_brighten, self._last_hardware_brightness,
                self._last_applied_darken, len(base_colors)
            )
            # base_colors already includes color effects -- only apply the
            # brightness pipeline (darkening, gamma, accuracy)
            frame = [
                self._apply_color_accuracy(
                    self._apply_color_correction(self._apply_final_brightness(rgb))
                )
                for rgb in base_colors
            ]
            self._write_layout_colors(frame)

            # Send pixel data using fire-and-forget (no recv wait)
            await self._cube_matrix.draw_matrices_fast(encode_rgb_frame(frame))
            
            # POST-SEND RECONNECTION CHECK: Same as in apply() -- if the
            # socket reconnected during send, pixels were silently ignored.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.warning(
                    "[BRIGHTNESS_FAST] [%s] Socket reconnected during update_leds -- "
                    "falling back to full apply for FX re-activation",
                    self._ip
                )
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Track successful rendering
            self._last_applied_darken = self._preview_darken
            self._connection_error = False
            
            # Update _last_sent_colors for future transitions
            self._last_sent_colors = frame
            
            if self.hass is not None:
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
                
            _LOGGER.debug("[BRIGHTNESS_FAST] [OK] Done (darken=%s%%)", self._preview_darken)
            
        except Exception as e:
            if is_connection_error(e):
                self._fx_mode_is_direct = False
                self._connection_error = True
                self._last_connection_error = str(e)
                _LOGGER.debug("[BRIGHTNESS_FAST] Connection issue: %s -- re-raising for retry", e)
            else:
                _LOGGER.warning("[BRIGHTNESS_FAST] Error: %s", e)
            raise

    async def async_set_power_on_state(self, option: str) -> None:
        """Set the Cube Lite's power recovery behavior."""
        if option not in POWER_ON_STATES:
            raise ValueError(f"Unsupported power-on state: {option}")
        self._cube_matrix.close_fast_socket()
        try:
            result = await self._cube_matrix.send_command_with_recovery(
                "set_ps", ["cfg_init_power", POWER_ON_STATES[option]]
            )
            if result is None:
                raise CubeConnectionError(
                    "Power-on behavior command was skipped during connection cooldown"
                )
        finally:
            self._cube_matrix.close_command_socket()
        self._power_on_state = option
        if self.hass is not None:
            self.async_write_ha_state()

    def _effect_persist_item(self, name: str) -> dict:
        """Build one official-app compatible physical-button effect entry."""
        if name.startswith("Clock: "):
            style_name = name.removeprefix("Clock: ")
            for style_id, style in NATIVE_CLOCK_STYLES.items():
                if style["name"] == style_name:
                    config = {"mode": NATIVE_CLOCK_EFFECT_ID, "mixer": style["mixer"]}
                    color = clock_style_default_color(style)
                    if color is not None:
                        config["color"] = [int(color)]
                    clock_data = bytes(
                        (
                            NATIVE_CLOCK_CONTENT_BYTE.get(self._native_clock_content, 1),
                            self._native_clock_timezone_hours() & 0xFF,
                            1 if self._native_clock_12_hour else 0,
                            0 if self._native_clock_colon_blink else 1,
                        )
                    )
                    config["data"] = base64.b64encode(clock_data).decode("ascii")
                    return {
                        "effect_id": NATIVE_CLOCK_EFFECT_ID,
                        "custom_id": style_id,
                        "effect_params": [config],
                    }
        spec = NATIVE_EFFECTS.get(name)
        if spec:
            config = {"mode": spec["mode"], "onoff": 1}
            if spec.get("speed"):
                config["rate"] = self._native_effect_speed
            directions = spec.get("directions")
            if directions:
                direction = self._native_effect_direction
                if direction not in directions:
                    direction = directions[0]
                config["direction"] = NATIVE_EFFECT_DIRECTION_VALUES[
                    direction
                ]
            return {
                "effect_id": spec["effect_id"],
                "custom_id": 0,
                "effect_params": [config],
            }
        raise ValueError(f"Unknown native effect: {name}")

    async def async_set_button_effects(self, effect_names: list[str]) -> None:
        """Write up to eight ordered presets used by the physical button."""
        if not 1 <= len(effect_names) <= 8:
            raise ValueError("The physical button list must contain 1 to 8 effects")
        self._cube_matrix.close_fast_socket()
        try:
            for index, name in enumerate(effect_names):
                result = await self._cube_matrix.send_command_with_recovery(
                    "update_persist_effect_list",
                    [index, self._effect_persist_item(name)],
                )
                if result is None:
                    raise CubeConnectionError(
                        f"Physical-button preset slot {index + 1} was skipped "
                        "during connection cooldown"
                    )
        finally:
            self._cube_matrix.close_command_socket()
        self._button_effects = list(effect_names)
        if self.hass is not None:
            self.async_write_ha_state()

    async def apply(self, skip_post_delay: bool = False):
        try:
            # Fast-fail: if we're in cooldown after a failed connection attempt,
            # RAISE so the queue processor sees this as a failure and schedules
            # a retry. Previously this returned silently, which the queue processor
            # treated as success -- cancelling the retry chain and leaving the lamp
            # dark forever.
            if not self._cube_matrix.is_connected():
                _LOGGER.warning(
                    "[APPLY] [%s] SKIP -- cooldown active, raising to trigger retry "
                    "(fx_direct=%s, is_on=%s, "
                    "retry_count=%s/%s) "
                    "[%s]",
                    self._ip, self._fx_mode_is_direct, self._is_on,
                    self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                    self._cube_matrix.summary
                )
                raise CubeConnectionError("Cooldown active -- device not yet reachable")
            
            # Check if the lamp just reconnected (socket was reset).
            # If so, we need to re-send FX mode and brightness before pixel data.
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.warning(
                    "[APPLY] [%s] Reconnection detected -- will restore FX mode + brightness "
                    "(fx_direct was %s, forcing to False)",
                    self._ip, self._fx_mode_is_direct
                )
                self._fx_mode_is_direct = False  # Force re-send
            
            # STALENESS CHECK: an idle Cube can silently leave direct FX mode
            # (see FX_MODE_STALENESS_TIMEOUT).  Check fx_age.
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    idle_seconds = time.time() - self._cube_matrix.last_command_time if self._cube_matrix.last_command_time > 0 else 999
                    _LOGGER.warning(
                        "[APPLY] [%s] FX mode stale -- fx_age=%.0fs > "
                        "%.0fs threshold (idle=%.1fs), "
                        "forcing re-activation via raw TCP",
                        self._ip, fx_age, FX_MODE_STALENESS_TIMEOUT, idle_seconds
                    )
                    self._fx_mode_is_direct = False

            # Ensure lamp is in direct FX mode before sending pixel data.
            # Uses raw TCP (fresh connection per command) -- the proven-reliable
            # approach.  The Cube always processes activate_fx_mode correctly
            # on a fresh TCP connection but sometimes silently ignores it on
            # a reused persistent socket.
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            # Capture whether this apply is LEAVING a firmware-native renderer
            # (clock / native animation / color flow) BEFORE ensure_fx_ready()
            # clears the flag.  The firmware needs time to tear down the native
            # renderer after activate_fx_mode, and the FIRST update_leds can be
            # silently dropped during that window (accepted at TCP level, zero
            # visual effect) -- which is why a single send left the panel stuck
            # and a manual second send fixed it.  We re-send one frame below to
            # make the transition deterministic.
            leaving_native_fw_mode = self._in_native_fw_mode and not self._fx_mode_is_direct
            if not self._fx_mode_is_direct:
                await self.ensure_fx_ready()
                # Send set_bright on the PERSISTENT socket right after activation.
                # This avoids the extra RST connection that was disrupting direct
                # mode when set_bright was sent on a second fresh TCP in
                # ensure_fx_ready.  set_bright and the subsequent update_leds
                # now travel on the same persistent TCP connection.
                await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                self._last_hardware_brightness = hardware_brightness
            else:
                # FX mode already active -- only send set_bright when value changed.
                # _last_hardware_brightness == 0 (sentinel from ensure_fx_ready called
                # indirectly, e.g. force_refresh path) will also trigger this branch.
                if hardware_brightness != self._last_hardware_brightness:
                    _LOGGER.debug(
                        "[BRIGHTNESS_DIAG] [%s] APPLY -- sending set_bright: "
                        "user=%s/255, hardware=%s%%, "
                        "darken=%s%%, prev_hw=%s, "
                        "fx_direct=%s, mode='%s'",
                        self._ip, self._brightness, hardware_brightness,
                        darken_percent, self._last_hardware_brightness,
                        self._fx_mode_is_direct, self._mode
                    )
                    try:
                        await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                        self._last_hardware_brightness = hardware_brightness
                        _LOGGER.debug(
                            "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright SUCCESS: "
                            "hardware=%s%%",
                            self._ip, hardware_brightness
                        )
                    except Exception as e:
                        _LOGGER.debug(
                            "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright FAILED: %s", self._ip, e
                        )
                else:
                    _LOGGER.debug(
                        "[BRIGHTNESS_DIAG] [%s] APPLY -- set_bright SKIPPED "
                        "(unchanged at %s%%)",
                        self._ip, hardware_brightness
                    )

            # SINGLE-PASS: Apply color effects + brightness in one loop
            # Previously this was two separate loops (color then brightness), each
            # doing hex -> RGB -> process -> RGB -> hex. Now merged into one pass to halve
            # the conversion overhead (100 pixels x 2 conversions saved per frame).
            
            # CRITICAL: Sync _preview_darken from the authoritative _brightness value.
            # _preview_darken can become stale (e.g., stuck at 94% while user=255/255)
            # when certain code paths (health recovery, reconnection) update _brightness
            # but don't recalculate _preview_darken.  By always deriving it here from
            # _brightness, we guarantee the rendered pixels match the user's intent.
            old_darken = self._preview_darken
            self._preview_darken = darken_percent
            self._last_applied_darken = darken_percent
            if old_darken != darken_percent:
                _LOGGER.warning(
                    "[BRIGHTNESS_DIAG] [%s] APPLY -- fixed stale _preview_darken: "
                    "%s%% -> %s%% (user=%s/255)",
                    self._ip, old_darken, darken_percent, self._brightness
                )

            has_color_effect = self._has_color_effects
            has_brightness_effect = (self._preview_darken != 0 or self._preview_brighten != 0)
            
            # SNAPSHOT: Capture base colors for _apply_brightness_only (fast path).
            # The JS card also uses these (with _preview_darken applied on-the-fly)
            # for instant brightness preview without lamp roundtrip.
            #
            # The snapshot is taken AFTER color effects but BEFORE brightness
            # darkening, so _base_matrix_colors always contains:
            #   [OK] Original pixel colors (text/drawing)
            #   [OK] Color adjustments (hue_shift, saturation, etc.) already baked in
            #   [X] No brightness darkening
            #   [X] No color correction (gamma)
            #   [X] No color accuracy (per-channel gain)
            #
            # The brightness fast path (_apply_brightness_only) therefore
            # must NOT re-apply color adjustments -- only brightness pipeline.
            # The frame is read from the layout once and processed as RGB
            # tuples; it is written back and encoded for the lamp only once.
            frame = self._layout_colors()
            if has_color_effect:
                frame = [self.apply_color_adjustments(rgb) for rgb in frame]
            self._base_matrix_colors = frame
            if has_brightness_effect or has_color_effect or self._color_accuracy_enabled:
                if has_brightness_effect:
                    frame = [
                        self._apply_color_correction(self._apply_final_brightness(rgb))
                        for rgb in frame
                    ]
                # Color accuracy is applied ALWAYS (independent of brightness);
                # it returns the color unchanged while disabled.
                frame = [self._apply_color_accuracy(rgb) for rgb in frame]
                self._write_layout_colors(frame)
            
            # TRANSITION ANIMATION: If enabled, animate from previous -> new state
            # before sending the final frame.  Runs intermediate frames through
            # draw_matrices_fast directly (FX mode already active above).
            # Only animate transitions for user-initiated content changes.
            # Retries, periodic refreshes, and health-recovery turn_on calls
            # skip the animation to avoid re-triggering long transitions that
            # previously caused hard-timeout cascades.
            _TRANSITION_ANIMATE_TYPES = {
                'text_change', 'color_change', 'pixel_art',
            }
            if (self._transition_type != "none"
                    and self._last_sent_colors is not None
                    and not self._transition_active
                    and self._current_update_type in _TRANSITION_ANIMATE_TYPES):
                target_colors = frame
                # Only animate when content actually changed
                if target_colors != self._last_sent_colors:
                    try:
                        await self._run_transition(self._last_sent_colors, target_colors)
                    except Exception as e:
                        _LOGGER.warning("[TRANSITION] [%s] Transition aborted: %s", self._ip, e)
                    # The transition drew its frames into the layout: put the
                    # target frame back.
                    self._write_layout_colors(frame)
                    # Clean TCP for final frame: close the persistent socket used
                    # for transition frames and re-activate FX on fresh TCP so the
                    # final authoritative frame goes on a pristine connection.
                    try:
                        await self.ensure_fx_ready()
                    except Exception as e:
                        _LOGGER.warning(
                            "[TRANSITION] [%s] Post-transition FX re-activation failed: %s", self._ip, e
                        )
            
            raw_rgb_data = encode_rgb_frame(frame)

            _apply_t0 = time.time()

            # Count lit pixels for diagnostic logging
            lit = sum(1 for rgb in frame if tuple(rgb) != (0, 0, 0))
            idle_since_last_cmd = time.time() - self._cube_matrix.last_command_time if self._cube_matrix.last_command_time > 0 else -1
            
            _LOGGER.debug(
                "[APPLY] [%s] Sending update_leds: "
                "%s lit / %s dark pixels, "
                "text='%s' mode='%s' "
                "idle=%.1fs fx_age=%.0fs "
                "bright=%s/255 hw=%s%% darken=%s%%",
                self._ip, lit, 100 - lit, (self._custom_text or '')[:10], self._mode,
                idle_since_last_cmd, time.time() - self._last_fx_mode_time,
                self._brightness, hardware_brightness, darken_percent
            )
            
            _t_before_send = time.time()
            await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
            _t_after_send = time.time()
            # Refresh the FX mode timestamp on every successful draw.  Without
            # this the staleness clock keeps running from the last
            # activate_fx_mode call, so any periodic trigger (e.g. a 60 s
            # sensor update) exceeds the threshold and forces an unnecessary
            # full re-activation which briefly shows the default Yeelight ribbon
            # before the pixel data arrives.
            self._last_fx_mode_time = _t_after_send
            _LOGGER.debug(
                "[TIMING] [%s] TCP draw_matrices_fast: %.1fms", self._ip, (_t_after_send - _t_before_send)*1000)
            
            # POST-SEND RECONNECTION CHECK: If the socket reconnected during
            # draw_matrices, pixels were sent on a non-FX socket -- silently
            # ignored.  Mark FX as not active so the next update re-activates.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.warning(
                    "[APPLY] [%s] Socket reconnected during update_leds -- "
                    "FX mode lost, will re-activate on next update",
                    self._ip
                )
                raise CubeFxModeLost("Socket reconnected during pixel send -- FX re-activation needed")

            # NATIVE-EXIT RE-SEND: When leaving a firmware-native renderer, the
            # first update_leds above can be dropped while the firmware finishes
            # switching into direct mode.  The socket is now healthy and in
            # direct mode (the reconnect check above passed), so re-send the same
            # frame once -- this is the deterministic equivalent of the manual
            # second send that was previously needed.
            if leaving_native_fw_mode:
                await asyncio.sleep(0.12)
                _LOGGER.debug(
                    "[APPLY] [%s] Native-exit re-send of first frame "
                    "(firmware just left clock/native mode)",
                    self._ip
                )
                await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
                self._last_fx_mode_time = time.time()
                if self._cube_matrix.consume_reconnected_flag():
                    self._fx_mode_is_direct = False
                    _LOGGER.warning(
                        "[APPLY] [%s] Socket reconnected during native-exit "
                        "re-send -- FX mode lost, will re-activate on next update",
                        self._ip
                    )
                    raise CubeFxModeLost("Socket reconnected during native-exit re-send")
            
            # Track that this darken% was successfully rendered to lamp pixels.
            # This keeps _last_applied_darken accurate even when apply() is called
            # by display-mode changes (draw pixel, text update, etc.) rather than
            # by _internal_set_brightness.  Without this, the next brightness
            # slider drag could see a stale _last_applied_darken and trigger a
            # redundant display update for a darken that was already rendered.
            self._last_applied_darken = self._preview_darken
            
            # Store the final colors that were sent to the lamp for future transitions
            self._last_sent_colors = list(frame)
            
            # Skip post-delay for scroll animations to maintain smooth timing
            if not skip_post_delay:
                await asyncio.sleep(APPLY_POST_DELAY)
            
            # IMPORTANT: When we send pixel data, the lamp automatically turns on
            # So we must update our internal state to match the hardware state
            if not self._is_on:
                _LOGGER.debug("[APPLY] Lamp auto-turned on by pixel data, updating state")
                self._is_on = True
            
            # Render camera images + push camera state FIRST so the image
            # is already cached when the light state change triggers the
            # frontend's HTTP fetch.  This eliminates the double-request.
            if self.hass is not None:
                _t_state_push = time.time()
                self._notify_camera_preview()
                _t_after_cam = time.time()
                self.async_schedule_update_ha_state()
                _t_done = time.time()
                _LOGGER.debug(
                    "[TIMING] [%s] apply pipeline: "
                    "send=%.1fms "
                    "post_delay=%.1fms "
                    "camera_render=%.1fms "
                    "state_push=%.1fms "
                    "total=%.1fms "
                    "epoch=%.3f",
                    self._ip, (_t_after_send - _t_before_send)*1000,
                    (_t_state_push - _t_after_send)*1000,
                    (_t_after_cam - _t_state_push)*1000, (_t_done - _t_after_cam)*1000,
                    (_t_done - _apply_t0)*1000, _t_done
                )
            
            # Clear any previous connection error flag
            self._connection_error = False
        except BulbException as e:
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_code = error_dict.get('code', 0)
            error_message = error_dict.get('message', str(e))
            
            self._connection_error = True
            self._last_connection_error = f"BulbException: {error_message}"
            connection_lost = isinstance(e, CubeConnectionError)
            if connection_lost:
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if connection_lost:
                _LOGGER.debug(
                    "[APPLY] [%s] BulbException (connection): code=%s, "
                    "msg='%s' -- re-raising for retry",
                    self._ip, error_code, error_message
                )
            else:
                _LOGGER.warning(
                    "[APPLY] [%s] BulbException: code=%s, "
                    "msg='%s' -- re-raising for retry",
                    self._ip, error_code, error_message
                )
            raise
            
        except Exception as e:
            msg = str(e)
            self._connection_error = True
            self._last_connection_error = msg
            connection_lost = is_connection_error(e)
            if connection_lost:
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if connection_lost:
                _LOGGER.debug(
                    "[APPLY] [%s] Connection issue: %s: %s -- re-raising for retry", self._ip, type(e).__name__, msg
                )
            else:
                _LOGGER.error("[APPLY] [%s] Unexpected error: %s: %s", self._ip, type(e).__name__, e)
            raise
        finally:
                if self.hass is not None:
                    self.async_schedule_update_ha_state()

    # Text scrolling functionality
    def start_scroll_timer(self, delay=None):
        """Start the auto-scroll timer for long text"""
        if self._scroll_timer is not None:
            self._scroll_timer.cancel()
        
        if self._max_scroll_offset <= 0:
            return
            
        # Use custom delay or default scroll speed
        scroll_delay = delay if delay is not None else self._scroll_speed
            
        # Schedule the next scroll step
        self._scroll_timer = self.hass.loop.call_later(
            scroll_delay,
            self._handle_scroll_step
        )
        _LOGGER.debug("[SCROLL] Timer started, next step in %ss", scroll_delay)

    def _handle_scroll_step(self):
        """Handle a single scroll step"""
        _LOGGER.debug("[SCROLL_DEBUG] _handle_scroll_step called - text: '%s'", self._custom_text)
        if self._max_scroll_offset <= 0:
            return
            
        # Update scroll position
        self._scroll_offset += self._scroll_direction
        
        # Check for direction change at boundaries
        if self._scroll_offset >= self._max_scroll_offset:
            self._scroll_offset = self._max_scroll_offset
            self._scroll_direction = -1  # Start scrolling back
        elif self._scroll_offset <= 0:
            self._scroll_offset = 0
            self._scroll_direction = 1  # Start scrolling forward
        
        _LOGGER.debug("[SCROLL_DEBUG] Scroll step: offset=%s, direction=%s, max=%s", self._scroll_offset, self._scroll_direction, self._max_scroll_offset)
        
        # Update display and continue scrolling (fire-and-forget to avoid blocking scroll timer)
        # Don't await here - let the queue handle it asynchronously
        # This prevents queue processing delays from slowing down the scroll animation
        self._create_tracked_task(
            self.async_apply_display_mode(),
            name=f"yeelight_cube_scroll_step_{self._ip}"
        )
        
        # Determine timer delay - first and last positions pause longer
        if self._scroll_offset == 0 or self._scroll_offset == self._max_scroll_offset:
            # First or last position: pause for twice the scroll speed
            delay = self._scroll_speed * 2
            _LOGGER.debug("[SCROLL_DEBUG] Pausing at boundary position for %ss", delay)
        else:
            # Normal position: use the scroll speed
            delay = self._scroll_speed
        
        self.start_scroll_timer(delay)

    def stop_scroll_timer(self):
        """Stop the auto-scroll timer"""
        if self._scroll_timer is not None:
            self._scroll_timer.cancel()
            self._scroll_timer = None
        _LOGGER.debug("[SCROLL] Timer stopped")

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

    def _refresh_linked_entities(self):
        """Push the current state out to the linked text/select/number helper
        entities so the UI controls reflect the restored values."""
        for ref in (
            self._text_input_entity,
            self._pixel_art_select_entity,
            self._content_mode_select_entity,
            self._mode_select_entity,
            self._clock_style_select_entity,
            self._clock_show_date_switch_entity,
            self._clock_content_select_entity,
            self._clock_12_hour_switch_entity,
            self._clock_colon_blink_switch_entity,
            self._native_effect_select_entity,
            self._native_effect_direction_select_entity,
            self._native_effect_speed_entity,
            self._music_flow_effect_select_entity,
            self._power_on_state_select_entity,
            self._scroll_enabled_switch_entity,
            self._scroll_speed_entity,
            self._alignment_select_entity,
            self._font_select_entity,
            self._angle_number_entity,
            self._extended_effects_switch_entity,
            self._device_orientation_select_entity,
        ):
            if ref is not None and getattr(ref, "hass", None) is not None:
                update = getattr(ref, "async_update_from_light", None)
                if update:
                    update()
                else:
                    ref.async_write_ha_state()
        for entity in self._preview_number_entities.values():
            if getattr(entity, "hass", None) is not None:
                entity.async_update_from_light()

    # ------------------------------------------------------------------ #
    #  Effect / clock mode rotation (server-side, survives client reload) #
    # ------------------------------------------------------------------ #

    def _rotation_current_name(self) -> str | None:
        """Return the key of the mode the lamp is currently showing.

        For native effects this is the effect name.  For the clock it is the
        built-in style name, or ``custom:<id>`` when a saved solid-color
        preset is active (mirrors the card's ``clockPresetKey`` mapping).
        """
        if self._rotation_kind != "clock":
            return self._native_effect
        color = self._native_clock_color
        if color is not None:
            r, g, b = argb_to_rgb(color)
            for preset in self.hass.data.get(DOMAIN, {}).get("clock_presets", []):
                if preset.get("kind", "style") == "style" and list(
                    preset.get("color", ())
                ) == [r, g, b]:
                    return f"custom:{preset['id']}"
        style = NATIVE_CLOCK_STYLES.get(self._native_clock_style)
        return style["name"] if style else None

    def _normalize_rotation_items(self, items) -> list:
        """Normalize rotation entries to ``{"name", "color_mode", "color"}`` dicts.

        Accepts legacy plain strings (color mode defaults to "normal") and
        dicts of the form ``{"name": ..., "color_mode": ..., "color": [r,g,b]}``
        produced by the cards' favourites system.
        """
        result = []
        seen = set()
        for entry in items or []:
            if isinstance(entry, str):
                name, color_mode, color = entry.strip(), "normal", None
            elif isinstance(entry, dict):
                name = str(entry.get("name", "")).strip()
                color_mode = entry.get("color_mode") or "normal"
                color = entry.get("color")
            else:
                continue
            if not name:
                continue
            if color_mode not in CLOCK_COLOR_MODES and color_mode != "custom":
                color_mode = "normal"
            if color_mode == "custom":
                if (
                    isinstance(color, (list, tuple))
                    and len(color) == 3
                    and all(isinstance(c, int) and 0 <= c <= 255 for c in color)
                ):
                    color = list(color)
                else:
                    # A custom mode without a valid color falls back to normal.
                    color_mode, color = "normal", None
            else:
                color = None
            # Uniqueness is per (name, color mode): the same style may appear
            # twice when favourited under two different color modes.
            color_key = (name, color_mode, tuple(color) if color else None)
            if color_key in seen:
                continue
            seen.add(color_key)
            result.append(
                {"name": name, "color_mode": color_mode, "color": color}
            )
        return result

    def _normalize_favourites(self, items) -> list:
        """Normalize a favourites list the way rotation items are normalized
        (same entries, de-duplicated per name + color mode), dropping names
        the cards never create (numeric) and capping its length."""
        return [
            item
            for item in self._normalize_rotation_items(items)
            if not item["name"].isdigit() and len(item["name"]) <= MAX_FAVOURITE_NAME
        ][:MAX_FAVOURITES]

    def _device_store(self, name: str) -> dict | None:
        """A persisted per-lamp collection (``favourites``, ``rotation``) in
        hass.data[DOMAIN], keyed like the music-flow runtime state (config
        entry id, else IP)."""
        if self.hass is None:
            return None
        domain_data = self.hass.data.get(DOMAIN)
        if not isinstance(domain_data, dict):
            return None
        store = domain_data.setdefault(name, {})
        if not isinstance(store, dict):
            store = domain_data[name] = {}
        return store

    def _favourites_store(self) -> dict | None:
        return self._device_store("favourites")

    def _restore_favourites(self) -> None:
        store = self._favourites_store()
        saved = store.get(self._music_flow_runtime_storage_key()) if store else None
        if not isinstance(saved, dict):
            return
        self._favourites = {
            kind: self._normalize_favourites(items)
            for kind, items in saved.items()
            if kind in FAVOURITE_KINDS and isinstance(items, list)
        }

    async def async_set_favourites(self, kind: str, items) -> None:
        """Replace the favourites of ``kind``, publish them, then persist."""
        if kind not in FAVOURITE_KINDS:
            raise HomeAssistantError(f"Unknown favourites kind: {kind}")
        self._favourites = {**self._favourites, kind: self._normalize_favourites(items)}
        # Publish first: every open dashboard updates without waiting for disk.
        if self.hass is not None:
            self.async_write_ha_state()
        store = self._favourites_store()
        if store is None:
            return
        store[self._music_flow_runtime_storage_key()] = {
            key: [dict(item) for item in value]
            for key, value in self._favourites.items()
        }
        self._schedule_integration_save()

    def _schedule_integration_save(self) -> None:
        """Save hass.data[DOMAIN] (palettes, favourites, rotation, ...) to
        disk shortly: a burst of changes becomes one write."""
        from . import async_schedule_save

        async_schedule_save(self.hass)

    # -- Rotation settings and restart recovery ------------------------------

    def _restore_rotation_settings(self) -> None:
        store = self._device_store("rotation")
        saved = store.get(self._music_flow_runtime_storage_key()) if store else None
        if not isinstance(saved, dict):
            return
        intervals = saved.get("intervals")
        if isinstance(intervals, dict):
            self._rotation_intervals = {
                kind: max(MIN_ROTATION_INTERVAL, min(MAX_ROTATION_INTERVAL, int(value)))
                for kind, value in intervals.items()
                if kind in FAVOURITE_KINDS and isinstance(value, (int, float))
            }
        active = saved.get("active")
        if isinstance(active, dict) and active.get("kind") in FAVOURITE_KINDS:
            self._rotation_restore = active

    def _save_rotation_state(self) -> None:
        """Persist the shared intervals and the running rotation (if any), so
        a Home Assistant restart or integration reload resumes it."""
        store = self._device_store("rotation")
        if store is None:
            return
        running = None
        if self._rotation_active or self._rotation_resume_pending:
            running = {
                "kind": self._rotation_kind,
                "items": [dict(item) for item in self._rotation_items],
                "interval": self._rotation_interval,
                "group": list(self._rotation_group or []),
            }
        record = {"intervals": dict(self._rotation_intervals), "active": running}
        key = self._music_flow_runtime_storage_key()
        # Most stops happen with no rotation running (e.g. every turn-off):
        # nothing changed, nothing to write.
        if store.get(key) == record:
            return
        store[key] = record
        if self.hass is not None:
            self._schedule_integration_save()

    async def _async_resume_saved_rotation(self) -> None:
        """Resume the rotation that ran before the restart, if the lamp is
        still on and in that mode (turning it off or switching mode stops a
        rotation, so neither is overridden here)."""
        saved, self._rotation_restore = self._rotation_restore, None
        if not saved:
            return
        kind = saved.get("kind")
        expected_mode = ROTATION_KIND_MODES.get(kind, MODE_NATIVE_EFFECT)
        if (
            not self._is_on
            or self._music_flow_enabled
            or self._calibration_lock
            or self._mode != expected_mode
        ):
            _LOGGER.info(
                "[ROTATION] [%s] Not resuming the %s rotation after restart "
                "(lamp off or no longer in %s mode)", self._ip, kind, expected_mode,
            )
            self._save_rotation_state()
            return
        interval = saved.get("interval", 60)
        group = sorted(saved.get("group") or [])
        timeline = None
        if len(group) > 1:
            # Lamps started together share one schedule again.
            now = asyncio.get_running_loop().time()
            key = (tuple(group), kind, interval)
            shared = _ROTATION_RESUME_TIMELINES.get(key)
            if shared is None or now - shared["created"] > ROTATION_RESUME_TIMELINE_TTL:
                shared = _ROTATION_RESUME_TIMELINES[key] = {"created": now, "timeline": {}}
            timeline = shared["timeline"]
        try:
            await self.start_effect_rotation(
                saved.get("items") or [], interval, kind,
                timeline=timeline, group=group or None,
            )
            _LOGGER.info("[ROTATION] [%s] Resumed the %s rotation after restart", self._ip, kind)
        except HomeAssistantError as err:
            # An unreachable lamp keeps the rotation pending: the health check
            # resumes it once the lamp answers again.
            _LOGGER.warning(
                "[ROTATION] [%s] Could not resume the %s rotation yet: %s",
                self._ip, kind, err,
            )

    def set_rotation_interval(self, kind: str, interval) -> None:
        """Set the interval every dashboard uses for ``kind``. A running
        rotation of that kind switches to it at once, keeping its current item
        until the next step on the new time grid."""
        if kind not in FAVOURITE_KINDS:
            raise HomeAssistantError(f"Unknown rotation kind: {kind}")
        interval = max(MIN_ROTATION_INTERVAL, min(MAX_ROTATION_INTERVAL, int(interval)))
        self._rotation_intervals = {**self._rotation_intervals, kind: interval}
        if (
            self._rotation_kind == kind
            and (self._rotation_active or self._rotation_resume_pending)
            and interval != self._rotation_interval
        ):
            self._retime_rotation(interval)
        if self.hass is not None:
            self.async_write_ha_state()
        self._save_rotation_state()

    def _retime_rotation(self, interval: int) -> None:
        loop = asyncio.get_running_loop()
        self._rotation_interval = interval
        # The next boundary of the new grid shows the item after the current one.
        self._rotation_timeline = {
            "tick": int(loop.time() // interval) + 1,
            "index": self._rotation_index + 1,
        }
        # A sleeping loop re-times its wait; a rotation waiting to reconnect
        # simply resumes on the new grid.
        task = self._rotation_task
        if task is not None and not task.done():
            self._rotation_retime = True
            if self._rotation_wake is not None:
                self._rotation_wake.set()

    async def start_effect_rotation(
        self, items, interval, kind="native", *, timeline=None, group=None
    ) -> None:
        """Start an entity-owned loop, acknowledging only its first display result.

        Returning before that result hides hardware failures from the calling
        service. Subsequent steps belong to the entity, not the service/client.
        """
        items = self._normalize_rotation_items(items)
        if len(items) < 2:
            raise HomeAssistantError("Provide at least two different rotation modes")
        # Replacing a running loop: its saved state is rewritten below.
        self.stop_effect_rotation(persist=False)
        self._rotation_error = None
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        self._rotation_kind = kind if kind in ("native", "clock") else "native"
        self._rotation_items = items
        # The lamps started together (one service call), saved so a restart
        # resumes them on one schedule.
        self._rotation_group = sorted(group) if group else None
        self._rotation_interval = max(
            MIN_ROTATION_INTERVAL, min(MAX_ROTATION_INTERVAL, int(interval))
        )
        current = self._rotation_current_name()
        names = [item["name"] for item in items]
        self._rotation_index = names.index(current) if current in names else -1
        if timeline is None:
            timeline = {}
        timeline.setdefault("tick", int(asyncio.get_running_loop().time() // self._rotation_interval))
        timeline.setdefault("index", self._rotation_index + 1)
        self._rotation_timeline = dict(timeline)
        self._rotation_retime = False
        self._rotation_active = True
        # Starting sets the interval every dashboard uses for this kind, and
        # saves the rotation so a restart resumes it.
        self._rotation_intervals = {
            **self._rotation_intervals,
            self._rotation_kind: self._rotation_interval,
        }
        self._save_rotation_state()
        self._rotation_wake = asyncio.Event()
        started = asyncio.get_running_loop().create_future()
        self._rotation_started = started
        self._rotation_task = self._create_tracked_task(
            self._rotation_loop(), name=f"yeelight_cube_rotation_{self._ip}"
        )
        if not await asyncio.shield(started):
            raise HomeAssistantError(
                self._rotation_error or "Rotation stopped before its first display update"
            )

    def stop_effect_rotation(self, persist: bool = True) -> None:
        """Stop the server-side rotation loop.

        ``persist=False`` keeps the saved rotation (entity removal on a
        shutdown/reload, or a Start replacing the loop); every other stop (the
        Stop button, a manual pick, lamp off, ...) also forgets it, so it is
        not resumed after a restart.
        """
        self._rotation_active = False
        self._rotation_resume_pending = False
        self._rotation_waiting_for_reconnect = False
        self._rotation_error = None
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        if self._rotation_task and not self._rotation_task.done():
            self._rotation_task.cancel()
        self._rotation_task = None
        self._rotation_wake = None
        if self._rotation_started is not None and not self._rotation_started.done():
            self._rotation_started.set_result(False)
        if persist:
            self._save_rotation_state()
        if self.hass is not None:
            self.async_write_ha_state()

    def _resume_rotation_after_reconnect(self) -> bool:
        if not self._rotation_waiting_for_reconnect:
            return False
        expected_mode = ROTATION_KIND_MODES.get(self._rotation_kind, MODE_NATIVE_EFFECT)
        if (
            not self._is_on or self._calibration_lock or self._music_flow_enabled
            or self._mode != expected_mode or len(self._rotation_items) < 2
        ):
            self.stop_effect_rotation()
            return False
        if self._rotation_active:
            return True
        self._rotation_resume_pending = False
        self._rotation_waiting_for_reconnect = False
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        self._rotation_index -= 1
        self._rotation_retime = False
        self._rotation_active = True
        self._rotation_wake = asyncio.Event()
        self._rotation_started = asyncio.get_running_loop().create_future()
        self._rotation_task = self._create_tracked_task(
            self._rotation_loop(), name=f"yeelight_cube_rotation_{self._ip}"
        )
        if self.hass is not None:
            self.async_write_ha_state()
        return True

    def _rotation_scheduled_index(self) -> int:
        timeline = self._rotation_timeline
        if timeline is None:
            return (self._rotation_index + 1) % len(self._rotation_items)
        tick = int(asyncio.get_running_loop().time() // self._rotation_interval)
        return (timeline["index"] + tick - timeline["tick"]) % len(self._rotation_items)

    def skip_effect_rotation(self) -> None:
        """Advance to the next mode immediately instead of waiting."""
        wake = self._rotation_wake
        if self._rotation_active or self._rotation_resume_pending:
            if self._rotation_timeline is not None:
                self._rotation_timeline["index"] += 1
        if self._rotation_active and wake is not None:
            wake.set()

    async def _rotation_loop(self) -> None:
        """Advance through the rotation list on a shared time grid.

        Each step is applied, then the loop sleeps until the next interval
        boundary on the event loop's monotonic clock.  Every lamp in this Home
        Assistant process shares that clock, so they advance at the same
        absolute instants even though each apply takes a different amount of
        time.  A slow apply that overruns a boundary realigns to the following
        one instead of accumulating drift.
        """
        task = asyncio.current_task()
        started = self._rotation_started
        loop = asyncio.get_running_loop()
        cancelled = False
        try:
            while self._rotation_active:
                interval = self._rotation_interval
                self._rotation_index = self._rotation_scheduled_index()
                item = self._rotation_items[self._rotation_index]
                name = item["name"]
                try:
                    ok = await self._apply_rotation_step(item)
                except Exception as exc:  # noqa: BLE001 — keep rotation isolated
                    _LOGGER.warning(
                        "[ROTATION] [%s] Failed to apply %s: %s",
                        self._ip, name, exc,
                    )
                    self._rotation_error = str(exc)
                    ok = False
                if not ok or not self._rotation_active:
                    self._rotation_error = self._rotation_error or (
                        "Lamp is off" if not self._is_on else
                        "Calibration lock is active" if self._calibration_lock else
                        self._last_connection_error or
                        f"Display update failed for {name}"
                    )
                    _LOGGER.warning("[ROTATION] [%s] Stopped: %s", self._ip, self._rotation_error)
                    break
                if not started.done():
                    started.set_result(True)
                if self.hass is not None:
                    self.async_write_ha_state()
                if (
                    self._rotation_timeline is not None
                    and self._rotation_index != self._rotation_scheduled_index()
                ):
                    continue
                # Sleep until the next boundary on the shared monotonic clock
                # (or a manual skip).
                next_tick = (int(loop.time() // interval) + 1) * interval
                while self._rotation_wake is not None:
                    delay = next_tick - loop.time()
                    if delay <= 0:
                        # A slow apply overran the boundary — realign to the next.
                        next_tick = (int(loop.time() // interval) + 1) * interval
                        continue
                    try:
                        await asyncio.wait_for(
                            self._rotation_wake.wait(), timeout=delay
                        )
                    except asyncio.TimeoutError:
                        pass
                    if self._rotation_wake is not None:
                        self._rotation_wake.clear()
                    if self._rotation_retime:
                        # The interval changed: keep the current item and wait
                        # for the next boundary of the new grid.
                        self._rotation_retime = False
                        interval = self._rotation_interval
                        next_tick = (int(loop.time() // interval) + 1) * interval
                        continue
                    break
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            if not started.done():
                started.set_result(False)
            # A replaced loop must not clear the new loop's state.
            if self._rotation_task is task:
                self._rotation_active = False
                self._rotation_task = None
                self._rotation_retry_at = None
                # Ended by itself (failure, lamp off): forget it unless it is
                # waiting to resume. Cancelled (shutdown): keep it saved.
                if not cancelled:
                    self._save_rotation_state()
                if self.hass is not None:
                    self.async_write_ha_state()

    async def _wait_rotation_retry(self, delay: float) -> bool:
        deadline = asyncio.get_running_loop().time() + delay
        while self._rotation_active and self._is_on and not self._calibration_lock:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return True
            await asyncio.sleep(min(remaining, 1.0))
        return False

    async def _apply_rotation_step(self, item) -> bool:
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        for attempt in range(3):
            if not self._rotation_active or not self._is_on or self._calibration_lock:
                if not self._is_on:
                    self._rotation_error = "Lamp is off"
                elif self._calibration_lock:
                    self._rotation_error = "Calibration lock is active"
                return False
            self._hardware_failure_retryable = False
            try:
                success = await self._apply_rotation_item(item)
            except (CubeConnectionError, OSError, asyncio.TimeoutError) as error:
                self._last_connection_error = str(error) or "Device timeout"
                self._hardware_failure_retryable = True
                success = False
            if success:
                if attempt:
                    _LOGGER.info("[ROTATION] [%s] Recovered %s after %s retries", self._ip, item["name"], attempt)
                self._rotation_error = None
                self._rotation_resume_pending = False
                self._rotation_waiting_for_reconnect = False
                self._rotation_retry_attempt = 0
                self._rotation_retry_at = None
                return True
            self._rotation_error = self._last_connection_error or f"Display update failed for {item['name']}"
            if not self._hardware_failure_retryable or attempt == 2:
                self._rotation_resume_pending = bool(
                    self._hardware_failure_retryable and self._rotation_active
                    and self._is_on and not self._calibration_lock
                )
                self._rotation_waiting_for_reconnect = bool(
                    self._rotation_resume_pending
                    and self._cube_matrix.is_unreachable
                )
                return False
            delay = (5.0, 15.0)[attempt]
            recent = [stamp for stamp in self._hard_timeout_times if time.time() - stamp < CIRCUIT_BREAKER_WINDOW]
            if len(recent) >= 2:
                delay = max(delay, max(recent) + CIRCUIT_BREAKER_WINDOW - time.time() + 0.1)
            self._rotation_retry_attempt = attempt + 1
            self._rotation_retry_at = time.time() + delay
            _LOGGER.warning(
                "[ROTATION] [%s] %s step=%s retry=%s/2 in %.1fs: %s",
                self._ip, self._rotation_kind, item["name"], attempt + 1, delay, self._rotation_error,
            )
            if self.hass is not None:
                self.async_write_ha_state()
            if not await self._wait_rotation_retry(delay):
                self._rotation_retry_at = None
                if not self._is_on:
                    self._rotation_error = "Lamp is off"
                elif self._calibration_lock:
                    self._rotation_error = "Calibration lock is active"
                return False
            self._rotation_retry_at = None
        return False

    async def _apply_rotation_item(self, item) -> bool:
        """Apply one rotation item; return False to stop the loop."""
        if not self._is_on:
            _LOGGER.debug("[ROTATION] [%s] Lamp off -- stopping rotation", self._ip)
            return False
        if self._rotation_kind == "clock":
            return await self._apply_rotation_clock(item)
        return await self._apply_rotation_native(item)

    async def _start_rotation_apply(self) -> bool:
        """Run the guards + reset the full display pipeline performs before a
        firmware mode switch, without its retry bookkeeping or queue overhead.

        Returns False when the lamp cannot take a rotation step right now.
        """
        if self._calibration_lock:
            _LOGGER.debug(
                "[ROTATION] [%s] Calibration lock active -- stopping rotation",
                self._ip,
            )
            return False
        if self._music_flow_enabled:
            await self.async_set_music_flow(False, restore_display=False)
        # Applying a new clock/effect clears any frozen frame, exactly like the
        # full _apply_display_mode_internal path does.
        self._display_frozen = False
        self._display_frozen_at = None
        self._is_scrolling = False
        self.stop_scroll_timer()
        return True

    async def _apply_rotation_native(self, item) -> bool:
        name = item["name"]
        color_mode = item.get("color_mode", "normal")
        color = item.get("color")
        spec = ALL_NATIVE_EFFECTS.get(name)
        if spec is None:
            _LOGGER.debug("[ROTATION] [%s] Unknown native effect %s -- skipped", self._ip, name)
            return True
        if spec.get("extended") and not self._extended_effects_enabled:
            _LOGGER.debug(
                "[ROTATION] [%s] Experimental effect %s skipped (Experimental Features off)",
                self._ip, name,
            )
            return True
        self._native_effect = name
        self._mode = MODE_NATIVE_EFFECT
        self._custom_draw_active = False
        # Reapply the color mode recorded with the favourite. The firmware
        # represents a free custom color as mode "normal" plus an RGB override.
        self._native_effect_color_mode = (
            "normal" if color_mode == "custom" else color_mode
        )
        self._native_effect_color = (
            list(color) if color_mode == "custom" and color else None
        )
        if not await self._start_rotation_apply():
            return False
        if not await self._execute_hardware_op(
            lambda: self._activate_native_effect(), "rotation:native"
        ):
            return False
        self._refresh_linked_entities()
        if self.hass is not None:
            self.async_write_ha_state()
        return True

    async def _apply_rotation_clock(self, item) -> bool:
        name = item["name"]
        color_mode = item.get("color_mode", "normal")
        color = item.get("color")
        if name.startswith("custom:"):
            preset_id = name[len("custom:"):]
            preset = next(
                (
                    item for item in self.hass.data.get(DOMAIN, {}).get("clock_presets", [])
                    if item.get("id") == preset_id and item.get("kind", "style") == "style"
                ),
                None,
            )
            if preset is None:
                _LOGGER.debug("[ROTATION] [%s] Unknown clock preset %s -- skipped", self._ip, name)
                return True
            self._native_clock_style = next(
                (
                    sid for sid, style in NATIVE_CLOCK_STYLES.items()
                    if style["name"] == "White"
                ),
                4,
            )
            # A recorded color mode overrides the preset's own solid color
            # exactly like the card's preview: custom keeps the recorded color,
            # a palette remaps it, normal uses the preset color.
            if color_mode == "custom" and color:
                self._native_clock_color = rgb_to_argb(color)
                self._native_clock_color_mode = "normal"
            elif color_mode in CLOCK_COLOR_MODES and color_mode != "normal":
                self._native_clock_color = None
                self._native_clock_color_mode = color_mode
            else:
                self._native_clock_color = rgb_to_argb(preset["color"])
                self._native_clock_color_mode = "normal"
        else:
            style_id = next(
                (
                    sid for sid, style in NATIVE_CLOCK_STYLES.items()
                    if style["name"] == name
                ),
                None,
            )
            if style_id is None:
                _LOGGER.debug("[ROTATION] [%s] Unknown clock style %s -- skipped", self._ip, name)
                return True
            self._native_clock_style = style_id
            if color_mode == "custom" and color:
                self._native_clock_color = rgb_to_argb(color)
                self._native_clock_color_mode = "normal"
            else:
                self._native_clock_color = None
                self._native_clock_color_mode = (
                    color_mode if color_mode in CLOCK_COLOR_MODES else "normal"
                )
        self._mode = MODE_CLOCK
        self._custom_draw_active = False
        if not await self._start_rotation_apply():
            return False
        if not await self._execute_hardware_op(
            lambda: self._activate_native_clock(), "rotation:clock"
        ):
            return False
        self._refresh_linked_entities()
        if self.hass is not None:
            self.async_write_ha_state()
        return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> bool:
    # Create and register the light entity FIRST (this happens for EVERY device)
    ip = entry.data[CONF_IP]
    port = entry.data.get('port', 55443)
    
    # Diagnostic: log all config entries to detect duplicates
    all_entries = hass.config_entries.async_entries(DOMAIN)
    same_ip_entries = [e for e in all_entries if e.data.get(CONF_IP) == ip]
    _LOGGER.debug(
        "[SETUP] Setting up entry %s for IP %s "
        "(total entries: %s, entries for this IP: %s)",
        entry.entry_id, ip, len(all_entries), len(same_ip_entries)
    )
    if len(same_ip_entries) > 1:
        _LOGGER.warning(
            "[SETUP] [!] DUPLICATE CONFIG ENTRIES for IP %s! "
            "Entry IDs: %s. "
            "This causes two CubeMatrix instances fighting each other -- "
            "remove the duplicate in Settings -> Integrations.",
            ip, [e.entry_id for e in same_ip_entries]
        )
    
    # TCP reachability has already been verified in __init__.py's
    # async_setup_entry (which is where ConfigEntryNotReady is effective).
    _LOGGER.debug("[SETUP] Creating CubeMatrix for %s:%s", ip, port)
    cube_matrix = CubeMatrix(ip, port)
    
    # Fetch capabilities in executor to avoid blocking the event loop
    _LOGGER.debug("[SETUP] Fetching capabilities for %s in executor", ip)
    await hass.async_add_executor_job(cube_matrix.fetch_capabilities)
    _LOGGER.debug("[SETUP] Capabilities fetched for %s, creating light entity", ip)
    
    light_entity = YeelightCubeLight(cube_matrix, ip, entry)
    
    # Register the entity in our global registry using IP as key
    _ENTITY_REGISTRY[ip] = light_entity
    _LOGGER.debug("[SETUP] Registered entity by IP %s in registry. Registry now contains: %s", ip, list(_ENTITY_REGISTRY.keys()))
    
    async_add_entities([light_entity], update_before_add=True)
    
    # Store reference for instant update and for switch platform
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}
    
    # Store light entity reference for the switch platform to access
    if entry.entry_id not in hass.data[DOMAIN]:
        hass.data[DOMAIN][entry.entry_id] = {}
    
    hass.data[DOMAIN][entry.entry_id]["light"] = light_entity
    return True


# Service registration lives in light_services.py; re-exported here so
# `from .light import async_setup_light_services` keeps working. Imported at
# the very bottom so light_services can import back from a fully-defined light.
from .light_services import async_setup_light_services  # noqa: E402
