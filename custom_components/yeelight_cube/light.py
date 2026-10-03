import logging
import asyncio
import base64
import time
from collections import deque
from datetime import timedelta
import voluptuous as vol # type: ignore
from homeassistant.components.light import LightEntity, ColorMode # type: ignore
from homeassistant.helpers.restore_state import RestoreEntity # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.event import async_track_time_interval # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from yeelight import BulbException # type: ignore
from .const import (
    DEFAULT_DEVICE_ORIENTATION,
    DEVICE_ORIENTATIONS,
    DEVICE_ORIENTATION_TO_FLIP,
    FIRMWARE_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    ROTATION_KIND_MODES,
    CONF_DEVICE_ID,
    CONF_IP,
    clock_style_default_color,
    DEFAULT_MATRIX_DISPLAY_MODE,
    DEFAULT_MUSIC_FLOW_EFFECT,
    DEFAULT_NATIVE_CLOCK_CONTENT,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
    DEVICE_ORIENTATION_TO_EFFECT_DIR,
    DOMAIN,
    ALL_NATIVE_EFFECTS,
    MUSIC_FLOW_EFFECT_IDS,
    NATIVE_CLOCK_CONTENT_BYTE,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECTS,
    ORIENTATION_FLIPPED,
    ORIENTATION_NORMAL,
    POWER_ON_STATES,
)
from .lamp_power import BASE_W, NO_LIMIT_W, estimated_power
from .cube_matrix import (
    CubeConnectionError,
    CubeFxModeLost,
    CubeMatrix,
    encode_rgb_frame,
    is_connection_error,
    is_quota_error,
)
from .entity import cube_device_info
from .layout import Layout, Module, FONT_MAPS

from .color_utils import hex_to_rgb, rgb_to_hex
from .light_color import ColorPipelineMixin
from .light_transitions import TransitionMixin
from .light_native import NativeModesMixin, _parse_music_flow_config
from .light_render import MatrixRenderMixin
from .light_connection import ConnectionMixin, APPLY_HARD_TIMEOUT, _DEVICE_LOCKS, _DEVICE_LOCK_HOLDERS, _get_device_lock
from .light_restore import StateRestoreMixin
from .light_rotation import RotationMixin

_LOGGER = logging.getLogger(__name__)
_LOGGER.debug("Yeelight Cube Lite light.py module loaded")

# Timing constants
APPLY_POST_DELAY = 0.0        # No post-delay needed -- send_command_fast doesn't wait for responses
# Estimated power in firmware modes (clock, native effects, Music Flow): the
# simulated frame is sampled every FIRMWARE_POWER_INTERVAL seconds and the
# sensor shows the average of the last FIRMWARE_POWER_SAMPLES (30 s).
FIRMWARE_POWER_INTERVAL = 5
FIRMWARE_POWER_SAMPLES = 6
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

# Native effects and the native clock's mixer follow the physical mount; the
# orientation -> direction map is the shared source of truth in const.py.
_DEVICE_ORIENTATION_TO_EFFECT_DIR = DEVICE_ORIENTATION_TO_EFFECT_DIR


# ─────────────────────────────────────────────────────────────────────────────
# MODULE MAP — YeelightCubeLight
# The entity is composed from mixins so each concern lives in its own file. The
# concrete class below inherits them all; every mixin operates purely on ``self``
# (state initialised in __init__ here), so behaviour is identical to one class.
#
#   light.py (this file) — core entity:
#     __init__, HA lifecycle (async_added_to_hass / async_will_remove_from_hass
#     / async_update), public properties + control setters (brightness,
#     orientation, alignment, font…), extra_state_attributes, ensure_fx_ready,
#     turn_on/off and brightness, the display queue (async_apply_display_mode),
#     the frame sender (apply()) and its brightness fast path, scroll timer,
#     physical-button presets and linked-entity sync.
#
#   light_color.py      (ColorPipelineMixin)  — colour adjustment/correction/
#                        accuracy maths + the brightness curve.
#   light_transitions.py(TransitionMixin)     — frame-by-frame transition anims.
#   light_native.py     (NativeModesMixin)    — firmware Clock + native-effect
#                        activation (set_fx_effect payloads), Music Flow.
#   light_render.py     (MatrixRenderMixin)   — mode router
#                        (_apply_display_mode_internal), letter/pixel placement,
#                        gradient/offset maths and orientation flips.
#   light_connection.py (ConnectionMixin)     — _execute_hardware_op (per-lamp
#                        lock, hard timeout, circuit breaker), display retries,
#                        health check / rediscovery, brightness retry,
#                        calibration lock.
#   light_restore.py    (StateRestoreMixin)   — restore after a restart
#                        (_RESTORED_ATTRIBUTES) and the save/restore_state snapshot.
#   light_rotation.py   (RotationMixin)       — effect / clock rotation loop,
#                        favourites and their persistence.
#   light_services*.py                         — entity-facing actions
#                        (registered by async_setup_light_services, re-exported
#                        from the bottom of this file).
#
# async_setup_entry (below the class) is the HA light-platform setup and stays
# here by convention.
# ─────────────────────────────────────────────────────────────────────────────

class YeelightCubeLight(
    ColorPipelineMixin,
    TransitionMixin,
    NativeModesMixin,
    MatrixRenderMixin,
    ConnectionMixin,
    StateRestoreMixin,
    RotationMixin,
    LightEntity,
    RestoreEntity,
):
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
        # Power limit in W (NO_LIMIT_W = off): frames sent to the lamp are
        # dimmed so its estimated draw stays under it, for weak or shared
        # power supplies (lamp_power.py).
        self._power_limit = NO_LIMIT_W
        # Estimated draw of the last frame sent (None until one is sent).
        self._last_frame_power = None
        self._power_sensor = None
        self._published_power = None
        # Firmware modes (clock, native effect, Music Flow): estimates of the
        # simulated preview frame, sampled every FIRMWARE_POWER_INTERVAL and
        # averaged; cleared when what the firmware draws changes.
        self._firmware_power_samples = deque(maxlen=FIRMWARE_POWER_SAMPLES)
        self._firmware_power_key = None
        self._firmware_power_unsub = None
        # Bumped by each queued redraw; an older one still waiting for the
        # lamp is skipped (_execute_hardware_op, coalesce=True).
        self._coalesced_op_generation = 0

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
        if (
            self.firmware_draws_matrix
            and self._firmware_power_state() != self._firmware_power_key
        ):
            self._sample_firmware_power()  # what the firmware draws changed
        self._publish_power()

    @property
    def estimated_power(self) -> float | None:
        """Estimated draw in W (lamp_power.py): 0 while the lamp is not
        reachable (most often unplugged); the electronics alone while off;
        unknown while the firmware draws the matrix (clock, native effect,
        Music Flow), whose frames Home Assistant cannot see."""
        if not self.available:
            return 0.0
        if not self._is_on:
            return BASE_W
        if self.firmware_draws_matrix:
            samples = self._firmware_power_samples
            return round(sum(samples) / len(samples), 1) if samples else None
        if self._last_frame_power is None:
            return None
        return round(self._last_frame_power, 1)

    @property
    def power_estimate_source(self) -> str:
        """What the Estimated power sensor is based on right now."""
        if not self.available:
            return "unreachable"
        if not self._is_on:
            return "off"
        if self.firmware_draws_matrix:
            return "simulated preview"
        return "frames sent"

    def _firmware_power_state(self) -> tuple:
        """What the firmware draws: a change starts a new average."""
        return (
            self._mode, self._music_flow_enabled, self._music_flow_effect,
            self._native_effect, self._native_effect_color_mode,
            str(self._native_effect_color), self._native_effect_speed,
            self._native_clock_style, self._native_clock_color_mode,
            self._native_clock_color, self._brightness, self._display_frozen,
        )

    @callback
    def _sample_firmware_power(self, _now=None) -> None:
        """While the firmware draws the matrix, estimate the draw of the
        simulated frame its camera preview shows (lamp_power.py), averaged
        over the last samples. Runs every FIRMWARE_POWER_INTERVAL, and at
        once when what the firmware draws changes."""
        if not (self.available and self._is_on and self.firmware_draws_matrix):
            self._firmware_power_samples.clear()
            self._firmware_power_key = None
            return
        state = self._firmware_power_state()
        if state != self._firmware_power_key:
            self._firmware_power_samples.clear()
            self._firmware_power_key = state
        camera = next(
            (cam for cam in self._camera_entities if getattr(cam, "hass", None)), None
        )
        frame = camera.simulated_firmware_frame() if camera is not None else None
        if not frame:
            return
        # The firmware modes send the brightness as is (_set_native_mode_brightness).
        hardware = max(1, min(100, round(self._brightness * 100 / 255)))
        self._firmware_power_samples.append(estimated_power(frame, hardware))
        self._publish_power()

    @callback
    def _publish_power(self) -> None:
        """Write the Estimated power sensor when its value changed."""
        power = self.estimated_power
        if power != self._published_power:
            self._published_power = power
            sensor = self._power_sensor
            if sensor is not None and sensor.hass is not None:
                sensor.async_write_ha_state()

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
        self._orientation = DEVICE_ORIENTATION_TO_FLIP[orientation]

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
            "power_limit": self._power_limit,
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


    async def async_added_to_hass(self):
        _LOGGER.debug("[INIT] async_added_to_hass called for %s", self._attr_name)
        await super().async_added_to_hass()
        # async_update (clock time-zone refresh, native property polling) runs
        # on Home Assistant's regular light polling interval.

        # Start periodic health check to detect devices coming back online
        self._health_check_task = self._create_tracked_task(
            self._periodic_health_check(), name=f"yeelight_cube_health_check_{self._ip}"
        )
        # Estimated power in firmware modes: a cheap periodic sample of the
        # simulated preview frame (one 100-pixel estimate per interval).
        self._firmware_power_unsub = async_track_time_interval(
            self.hass, self._sample_firmware_power,
            timedelta(seconds=FIRMWARE_POWER_INTERVAL),
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
        self._restore_drawing()
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
        if self._firmware_power_unsub is not None:
            self._firmware_power_unsub()
            self._firmware_power_unsub = None

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
        # Never open the polling connection while a command is talking to the
        # lamp: the Cube copes badly with two connections at once. Poll on the
        # next update instead.
        if _get_device_lock(self._ip).locked():
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
            'color_change', 'pixel_art', 'power_limit',
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
            timeout_override=op_timeout,
            coalesce=True,
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
            await self._cube_matrix.draw_matrices_fast(
                encode_rgb_frame(self._lamp_frame(frame))
            )
            
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
            
            lamp_frame = self._lamp_frame(frame)
            raw_rgb_data = encode_rgb_frame(lamp_frame)

            _apply_t0 = time.time()

            # Count lit pixels for diagnostic logging
            lit = sum(1 for rgb in frame if tuple(rgb) != (0, 0, 0))
            idle_since_last_cmd = time.time() - self._cube_matrix.last_command_time if self._cube_matrix.last_command_time > 0 else -1
            
            _LOGGER.debug(
                "[APPLY] [%s] Sending update_leds: "
                "%s lit / %s dark pixels, power=%.1fW%s "
                "text='%s' mode='%s' "
                "idle=%.1fs fx_age=%.0fs "
                "bright=%s/255 hw=%s%% darken=%s%%",
                self._ip, lit, 100 - lit,
                # estimated draw of the frame sent (see lamp_power.py)
                self._last_frame_power,
                "" if lamp_frame is frame else
                f" (limited from {estimated_power(frame, hardware_brightness or 100):.1f}W)",
                (self._custom_text or '')[:10], self._mode,
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


    # -- Rotation settings and restart recovery ------------------------------


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
