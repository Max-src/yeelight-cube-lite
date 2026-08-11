

import logging
import asyncio
import base64
import copy
import json
import math
import random
import time
import traceback
import colorsys
from typing import Tuple
import voluptuous as vol # type: ignore
from homeassistant.components import websocket_api # type: ignore
from homeassistant.components.light import LightEntity, ColorMode # type: ignore
from homeassistant.helpers.entity import Entity # type: ignore
from homeassistant.components.sensor import SensorEntity # type: ignore
from homeassistant.helpers.restore_state import RestoreEntity # type: ignore
from homeassistant.core import HomeAssistant, SupportsResponse, callback # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.helpers.event import async_track_state_change_event # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.helpers import entity_registry as er # type: ignore
from homeassistant.exceptions import HomeAssistantError # type: ignore
from homeassistant.util import dt as dt_util # type: ignore
from yeelight import BulbException # type: ignore
from .const import (
    CONF_DEVICE_ID,
    CONF_IP,
    DEFAULT_MATRIX_DISPLAY_MODE,
    DEFAULT_MUSIC_FLOW_EFFECT,
    DEFAULT_NATIVE_CLOCK_CONTENT,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
    DOMAIN,
    MATRIX_DISPLAY_MODES,
    MUSIC_FLOW_EFFECT_IDS,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_CONTENT_BYTE,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_APPLY,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECT_RENAMES,
    NATIVE_EFFECTS,
    ORIENTATION_FLIPPED,
    ORIENTATION_NORMAL,
    PANEL_FULL_CHAR,
    POWER_ON_STATES,
    TEXT_RENDER_MODES,
)
from .cube_matrix import CubeMatrix, RECONNECT_COOLDOWN_INITIAL, CONNECT_TIMEOUT, RECOVERY_CONNECT_TIMEOUT
from .layout import Layout, Module, FONT_MAPS, FONT_METRICS, char_advance, TOTAL_COLUMNS, TOTAL_ROWS
from . import async_save_data

from .color_utils import hex_to_rgb, rgb_to_hex
from .image_utils import image_to_matrix
from .light_color import ColorPipelineMixin
from .light_transitions import TransitionMixin
from .light_native import NativeModesMixin, _parse_music_flow_config
from .light_render import MatrixRenderMixin

_LOGGER = logging.getLogger(__name__)
_LOGGER.debug("Yeelight Cube Lite light.py module loaded")

LIGHT_SERVICE_NAMES = (
    "preview_gradient_modes",
    "load_palette",
    "get_pixel_art",
    "save_pixel_art",
    "remove_pixel_art",
    "rename_pixel_art",
    "apply_pixel_art",
    "apply_custom_pixels",
    "update_pixel_arts",
    "set_brightness",
    "set_orientation",
    "set_device_orientation",
    "set_font",
    "set_alignment",
    "set_palettes",
    "save_palette",
    "rename_palette",
    "set_custom_text",
    "set_angle",
    "set_text_colors",
    "display_image",
    "set_mode",
    "set_solid_color",
    "set_full_panel",
    "remove_palette",
    "test_display",
    "set_preview_adjustments",
    "force_refresh",
    "set_color_accuracy",
    "set_color_calibration",
    "set_calibration_lock",
    "save_state",
    "restore_state",
    "set_button_effects",
    # Registered further below alongside the diagnostic/native-effect handlers;
    # listed here so async_remove_light_services() tears them down on unload too.
    "send_fx_effect",
    "query_raw",
    "set_default",
)

# Timing constants
APPLY_POST_DELAY = 0.0        # No post-delay needed -- send_command_fast doesn't wait for responses
APPLY_HARD_TIMEOUT = 12.0      # Seconds -- absolute safety timeout for a single apply() call under
                               # the device lock. Raised from 5 s to give activate_fx_mode +
                               # draw_matrices time to complete on slow Wi-Fi without triggering
                               # the hard-timeout flash (lamp shows default ribbon between the
                               # two commands if the lock is released prematurely).
                              # the global lock.  If an apply() exceeds this (e.g., socket hangs
                              # beyond the per-op 0.5s timeout), asyncio.wait_for cancels it and
                              # releases the lock so other entities can proceed.
                              # Reduced from 8s to 5s -- inner timeouts are now tighter:
                              #   probe 0.5s + raw_cmd 1.5sx2 + draw 0.5s = 4s worst case.
CIRCUIT_BREAKER_WINDOW = 30.0 # Seconds -- if 2+ hard timeouts occur within this window,
                              # reject new operations immediately instead of queueing them
                              # behind the lock for another 8s timeout each.
FX_MODE_STALENESS_TIMEOUT = 90.0  # Seconds -- re-send activate_fx_mode when fx_age exceeds this
                                  # The Cube silently exits direct FX mode ~25s after ACTIVATION
                                  # (not after last command!).  It keeps the TCP connection open
                                  # and silently ignores update_leds -- no error, no socket close.
                                  # 20s gives ~5s safety margin.  Must check time since
                                  # activate_fx_mode was sent, NOT time since last command.
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
# Map device orientation -> native effect direction name (for effects that
# support directions), so an effect's flow follows the physical mounting.
_DEVICE_ORIENTATION_TO_EFFECT_DIR = {
    "up": "Up",
    "down": "Down",
    "left": "Left",
    "right": "Right",
}

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
#     (_apply_impl), scroll timer, and state snapshot / linked-entity sync.
#
#   light_color.py      (ColorPipelineMixin)  — colour adjustment/correction/
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

    @property
    def font(self):
        return self._font

    async def set_font(self, font: str):
        from .layout import FONT_MAPS
        if font not in FONT_MAPS:
            _LOGGER.error(f"Invalid font: {font}. Available: {list(FONT_MAPS.keys())}")
            return
        self._font = font
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()
    def _safeguard_entity_id(self, entity_id):
    # Allow any entity name for palettes
        return entity_id
    @property
    def device_info(self):
        # Use config_entry.entry_id as the unique identifier for grouping (matches switch)
        info = {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._attr_name,
            "manufacturer": "Yeelight",
            "model": self._cube_matrix.device_model or "Cube Lite",
        }
        if self._cube_matrix.firmware_version:
            info["sw_version"] = self._cube_matrix.firmware_version
        return info
    # Store custom pixel data for Custom Draw mode
    _custom_pixels = None

    
    
    
    
    
    
    
    
    
    



    """Home Assistant LightEntity for the Yeelight Cube Lite."""
    
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
        # Safeguard: check that the generated name does not end with _palettes (without _v2)
        self._safeguard_entity_id(self._attr_name.lower().replace(' ', '_'))
        self._is_on = True
        self._layout = Layout("vertical", "bottom", [Module("1x1") for _ in range(100)])
        self._custom_text = "HELLO"
        self._brightness = 255  # Store brightness as 0-255 internally
        self._text_colors = [(255, 0, 0), (0, 0, 255)]  # [solid/gradient start, gradient end]
        self._mode = DEFAULT_MATRIX_DISPLAY_MODE
        self._matrix_mode = DEFAULT_MATRIX_DISPLAY_MODE
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
        self._native_effect = DEFAULT_NATIVE_EFFECT
        self._native_effect_speed = 50
        self._native_effect_direction = "Up"
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
        # Compensates for LED colour rendering differences vs. a computer monitor
        # by applying per-channel gain that fades with brightness.  The service
        # set_color_accuracy still exists to toggle at runtime but the default is ON.
        self._color_accuracy_enabled = True  # Per-channel gain to match monitor colours
        
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
        # instead of queueing them behind the lock for 8s each.
        self._hard_timeout_times = []  # List of timestamps of recent hard timeouts
        
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
        # active failures.  After MAX_DISPLAY_RETRIES (6), retries stop but the
        # health check continues probing until the device recovers.
        self._health_check_task = None
        # Health check interval is adaptive (computed dynamically):
        # 10s during active failures, 15s when recently online, 60s when long-dead
        
        # Base (un-darkened) matrix colors for immediate brightness preview.
        # Snapshotted in apply() right before brightness darkening.  Used by
        # extra_state_attributes to return correctly brightness-adjusted colors
        # without double-darkening (module.data may already be darkened after apply).
        self._base_matrix_colors = None
        
        # -- Transition settings ------------------------------------------
        self._transition_type = "none"           # Transition effect key (see select.py _TRANSITION_TYPES)
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
        self._music_flow_effect_select_entity = None
        self._power_on_state_select_entity = None
        self._device_orientation_select_entity = None
        self._scroll_enabled_switch_entity = None
        self._scroll_speed_entity = None
        
        # Camera entity references -- set by camera.py async_setup_entry.
        # Used for direct push notifications (bypass state-change-event delay).
        self._camera_entities: list = []
    
    def _notify_camera_preview(self) -> None:
        """Re-render all camera entities and push their state SYNCHRONOUSLY.

        Must be called BEFORE ``async_schedule_update_ha_state()`` on the
        light entity so the camera image is already cached when the frontend
        makes the HTTP fetch triggered by the light state change.
        This avoids the double-request problem (stale image -> re-fetch).
        """
        cams = getattr(self, '_camera_entities', None)
        if cams:
            for cam in cams:
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
            _LOGGER.debug(f"[SYNC] Synchronized _rgb_color to {self._rgb_color} from text_colors")
    
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
        
        # CIRCUIT BREAKER: If 2+ hard timeouts occurred in the last N seconds,
        # reject immediately instead of queueing behind the lock for 8s each.
        # This prevents the cascade where 5+ operations pile up, each waiting
        # 8s to timeout, creating 40s+ of stuck state.
        now = time.time()
        self._hard_timeout_times = [t for t in self._hard_timeout_times if now - t < CIRCUIT_BREAKER_WINDOW]
        if len(self._hard_timeout_times) >= 2:
            _LOGGER.warning(
                f"[OP #{op_id}] [{self._ip}] [!] CIRCUIT BREAKER -- rejecting {op_name} "
                f"({len(self._hard_timeout_times)} timeouts in last {CIRCUIT_BREAKER_WINDOW:.0f}s). "
                f"Device appears unreachable, will recover via health check."
            )
            self._connection_error = True
            # Only schedule display retries for display operations
            if op_name.startswith('display:'):
                self._maybe_schedule_retry()
            return False
        
        _LOGGER.debug(
            f"[OP #{op_id}] [{self._ip}] > {op_name} "
            f"(is_on={self._is_on}, fx_direct={self._fx_mode_is_direct}) "
            f"[{self._cube_matrix._state_summary()}]"
        )
        is_display_op = op_name.startswith('display:')
        try:
            lock_wait_start = time.time()
            async with _get_device_lock(self._ip):
                lock_wait_ms = (time.time() - lock_wait_start) * 1000
                if lock_wait_ms > 5:
                    _LOGGER.warning(
                        f"[OP #{op_id}] [{self._ip}] Lock waited {lock_wait_ms:.0f}ms"
                    )
                try:
                    await asyncio.wait_for(func(), timeout=effective_timeout)
                except asyncio.TimeoutError:
                    _LOGGER.error(
                        f"[OP #{op_id}] [{self._ip}] [!] HARD TIMEOUT -- "
                        f"{op_name} exceeded {effective_timeout:.0f}s, releasing lock"
                    )
                    self._fx_mode_is_direct = False
                    self._cube_matrix._close_fast_socket()
                    self._connection_error = True
                    self._last_connection_error = f"Hard timeout: {op_name}"
                    self._hard_timeout_times.append(time.time())
                    self._cube_matrix._consecutive_failures += 1
                    # Only schedule display retries for display operations
                    if is_display_op:
                        self._maybe_schedule_retry()
                    return False
            # Success
            _LOGGER.debug(f"[OP #{op_id}] [{self._ip}] [OK] {op_name} complete")
            # Only reset display retry state on display op success
            if is_display_op:
                self._display_retry_count = 0
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
            self._connection_error = False
            self._cube_matrix._consecutive_failures = 0
            # Clear circuit breaker on any success
            self._hard_timeout_times.clear()
            return True
        except AttributeError as e:
            if "'NoneType'" in str(e):
                _LOGGER.debug(
                    f"[OP #{op_id}] [{self._ip}] Socket gone -- resetting FX mode"
                )
                self._connection_error = True
                self._last_connection_error = "Connection lost"
                self._fx_mode_is_direct = False
                if is_display_op:
                    self._maybe_schedule_retry()
            else:
                _LOGGER.error(f"[OP #{op_id}] [{self._ip}] AttributeError: {e}")
        except BulbException as e:
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_message = error_dict.get('message', str(e))
            self._connection_error = True
            self._last_connection_error = f"BulbException: {error_message}"
            if any(kw in error_message.lower() for kw in ['socket', 'closed', 'connection']):
                _LOGGER.warning(
                    f"[OP #{op_id}] [{self._ip}] Connection error: {error_message}"
                )
                if is_display_op:
                    self._maybe_schedule_retry()
            else:
                _LOGGER.warning(
                    f"[OP #{op_id}] [{self._ip}] BulbException: {error_message}"
                )
        except TimeoutError:
            _LOGGER.debug(
                f"[OP #{op_id}] [{self._ip}] Timeout -- device unreachable"
            )
            self._connection_error = True
            self._last_connection_error = "Device timeout"
            self._cube_matrix._consecutive_failures += 1
            if is_display_op:
                self._maybe_schedule_retry()
        except Exception as e:
            error_msg = str(e).lower()
            if any(kw in error_msg for kw in ['socket', 'connection', 'cooldown', 'closed', 'timeout', 'unreachable']):
                self._connection_error = True
                self._last_connection_error = str(e)
                _LOGGER.warning(
                    f"[OP #{op_id}] [{self._ip}] Connection error: {e}"
                )
                self._cube_matrix._consecutive_failures += 1
                if is_display_op:
                    self._maybe_schedule_retry()
            else:
                _LOGGER.error(
                    f"[OP #{op_id}] [{self._ip}] Unexpected error in {op_name}: {e}"
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
            self._calibration_lock_unsub = self.hass.loop.call_later(
                self.CALIBRATION_LOCK_TIMEOUT, self._auto_release_calibration_lock
            )
            _LOGGER.info(
                f"[CALIB_LOCK] [{self._ip}] Calibration lock ENABLED -- automation "
                f"display/brightness commands will be ignored (auto-release in "
                f"{self.CALIBRATION_LOCK_TIMEOUT}s)"
            )
        else:
            _LOGGER.info(
                f"[CALIB_LOCK] [{self._ip}] Calibration lock DISABLED -- lamp resumes "
                f"normal command handling"
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
                f"[CALIB_LOCK] [{self._ip}] Calibration lock auto-released after "
                f"{self.CALIBRATION_LOCK_TIMEOUT}s of inactivity (wizard abandoned?)"
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
                f"[RETRY] [{self._ip}] Skipping retry -- already at limit "
                f"({self._display_retry_count}/{self.MAX_DISPLAY_RETRIES})"
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
        
        After MAX_DISPLAY_RETRIES (6 retries ~= 50s), stops retrying -- health check
        at 10s intervals takes over for longer outages. User actions will still
        trigger a fresh display update, resetting the counter.
        """
        self._display_retry_count += 1
        
        if self._display_retry_count > self.MAX_DISPLAY_RETRIES:
            _LOGGER.warning(
                f"[RETRY] [{self._ip}] Stopping auto-retry after {self.MAX_DISPLAY_RETRIES} consecutive failures. "
                f"The lamp appears to be offline. Display will resume on next user action or HA restart. "
                f"[{self._cube_matrix._state_summary()}]"
            )
            return
        
        # Cancel any existing retry task (avoid stacking retries)
        if self._retry_display_task and not self._retry_display_task.done():
            _LOGGER.debug(f"[RETRY] [{self._ip}] Cancelling existing display retry task")
            self._retry_display_task.cancel()
        
        # Calculate delay: first retry is quick (2.5s) to catch transient network
        # hiccups before engaging exponential backoff.  Subsequent retries use
        # the device's current cooldown + buffer.
        QUICK_RETRY_DELAY = 1.5  # seconds -- fast enough to recover from a 1-2s WiFi hiccup
                                 # Reduced from 2.5s since inner timeouts are now tighter
        cooldown = self._cube_matrix._reconnect_cooldown
        if self._display_retry_count == 1:
            delay = QUICK_RETRY_DELAY
        else:
            delay = cooldown + 0.5
        
        # Add random jitter (0-1.5s) to desynchronize retries across lamps.
        # When two lamps fail at the same moment, they get identical cooldown
        # schedules and retry simultaneously -- each round has both lamps
        # hitting the network at once, prolonging the failure.  Jitter breaks
        # this synchronization so they stagger naturally.
        import random as _rng
        delay += _rng.uniform(0, 1.5)
        
        async def _delayed_retry():
            try:
                _LOGGER.debug(
                    f"[RETRY] [{self._ip}] Attempt {self._display_retry_count}/{self.MAX_DISPLAY_RETRIES} -- "
                    f"waiting {delay:.1f}s before retry "
                    f"[{self._cube_matrix._state_summary()}]"
                )
                await asyncio.sleep(delay)
                
                _LOGGER.debug(
                    f"[RETRY] [{self._ip}] Retrying display update now (attempt {self._display_retry_count}) "
                    f"[{self._cube_matrix._state_summary()}]"
                )
                await self.async_apply_display_mode(update_type='display_retry')
                _LOGGER.debug(f"[RETRY] [{self._ip}] Display retry sent")
            except asyncio.CancelledError:
                _LOGGER.debug(f"[RETRY] [{self._ip}] Display retry CANCELLED")
            except Exception as e:
                _LOGGER.warning(f"[RETRY] [{self._ip}] Unexpected error in display retry: {e}")
        
        self._retry_display_task = self._create_tracked_task(
            _delayed_retry(), name=f"yeelight_cube_display_retry_{self._ip}"
        )
        _LOGGER.debug(
            f"[RETRY] [{self._ip}] Scheduled retry {self._display_retry_count}/{self.MAX_DISPLAY_RETRIES} "
            f"in {delay:.1f}s (cooldown={cooldown:.0f}s, failures={self._cube_matrix._consecutive_failures})"
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
          3. TCP probe the device (CONNECT_TIMEOUT timeout)
          4. If reachable -> reset all failure counters and trigger a fresh display update
          5. If still unreachable -> log at debug level, try again next cycle
        """
        _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check started (adaptive interval)")
        while True:
            try:
                # ADAPTIVE INTERVAL:
                #  - 10s when there are active failures (fastest recovery)
                #  - 15s when device was online recently (monitor mode)
                #  - 60s when device has been down a while (reduce noise)
                has_active_issues = (
                    self._cube_matrix._device_unreachable or
                    self._cube_matrix._consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                last_success = self._cube_matrix._last_success_time
                time_since_success = time.time() - last_success if last_success > 0 else 999
                if has_active_issues:
                    interval = 10  # Aggressive probing during failures
                elif time_since_success < 300:  # online within last 5 minutes
                    interval = 15
                else:
                    interval = 60
                
                # PERIODIC BRIGHTNESS STATE SNAPSHOT -- logs every cycle so we can
                # see the stored brightness values even when nothing is changing.
                _LOGGER.debug(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] SNAPSHOT -- "
                    f"user={self._brightness}/255, "
                    f"last_hw={self._last_hardware_brightness}, "
                    f"darken={self._preview_darken}%, "
                    f"last_applied_darken={self._last_applied_darken}, "
                    f"is_on={self._is_on}, fx_direct={self._fx_mode_is_direct}, "
                    f"unreachable={self._cube_matrix._device_unreachable}, "
                    f"failures={self._cube_matrix._consecutive_failures}, "
                    f"interval={interval}s"
                )
                await asyncio.sleep(interval)
                
                # Probe when the device has ANY active issue:
                # - unreachable flag is set (exponential backoff triggered)
                # - retry counter hit the limit (retries exhausted)
                # - consecutive failures > 0 (early detection before unreachable)
                # - display retries in progress (parallel recovery path)
                is_stuck = (
                    self._cube_matrix._device_unreachable or
                    self._display_retry_count >= self.MAX_DISPLAY_RETRIES or
                    self._cube_matrix._consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                if not is_stuck:
                    continue
                
                _LOGGER.debug(
                    f"[HEALTH] [{self._ip}] Probing device (unreachable={self._cube_matrix._device_unreachable}, "
                    f"retries={self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}, "
                    f"failures={self._cube_matrix._consecutive_failures}, "
                    f"interval={interval}s)"
                )
                
                # Quick TCP probe -- use longer timeout for recovery.
                # Normal commands use 0.5s, but a lamp rebooting may have
                # slow TCP handshakes.  3s gives reliable detection.
                import socket as _socket
                probe_timeout = RECOVERY_CONNECT_TIMEOUT
                sock = None
                try:
                    sock = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
                    sock.settimeout(probe_timeout)
                    # SO_LINGER RST close -- avoids TIME_WAIT on probe sockets
                    import struct as _struct
                    sock.setsockopt(_socket.SOL_SOCKET, _socket.SO_LINGER, _struct.pack('ii', 1, 0))
                    await asyncio.to_thread(sock.connect, (self._ip, self._cube_matrix._port))
                    sock.close()
                    sock = None
                except (OSError, ConnectionRefusedError, TimeoutError):
                    # Log at WARNING so the user can see probes are happening
                    _LOGGER.warning(
                        f"[HEALTH] [{self._ip}] Probe failed -- still unreachable "
                        f"(retries={self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}, "
                        f"failures={self._cube_matrix._consecutive_failures}, "
                        f"timeout={probe_timeout}s)"
                    )
                    if sock is not None:
                        try:
                            sock.close()
                        except Exception:
                            pass
                    continue
                
                # Device is back! Reset everything and trigger a fresh display.
                _LOGGER.warning(
                    f"[HEALTH] [{self._ip}] [OK] Device is BACK ONLINE! "
                    f"Resetting failures ({self._cube_matrix._consecutive_failures} -> 0), "
                    f"retries ({self._display_retry_count} -> 0), "
                    f"cooldown ({self._cube_matrix._reconnect_cooldown:.0f}s -> {RECONNECT_COOLDOWN_INITIAL}s)"
                )
                self._cube_matrix._close_fast_socket()  # Ensure fresh socket after recovery
                self._cube_matrix._consecutive_failures = 0
                self._cube_matrix._device_unreachable = False
                self._cube_matrix._connection_healthy = True
                self._cube_matrix._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                self._cube_matrix._last_reconnect_attempt = 0
                self._display_retry_count = 0
                self._fx_mode_is_direct = False  # Force FX mode re-send
                self._connection_error = False
                self._hard_timeout_times.clear()  # Clear circuit breaker
                
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
                        f"[BRIGHTNESS_DIAG] [{self._ip}] HEALTH RECOVERY -- will apply display mode. "
                        f"user={self._brightness}/255, last_hw={self._last_hardware_brightness}, "
                        f"darken={self._preview_darken}%, fx_direct={self._fx_mode_is_direct}"
                    )
                    await self.async_apply_display_mode(update_type='turn_on')
                
            except asyncio.CancelledError:
                _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check cancelled")
                break
            except Exception as e:
                _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check error: {e}")
        
        _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check stopped")

        
    # Removed duplicate/empty __init__ definition
    @property
    def orientation(self):
        return self._orientation

    async def set_orientation(self, orientation: str):
        if orientation not in (ORIENTATION_NORMAL, ORIENTATION_FLIPPED):
            _LOGGER.error(f"Invalid orientation value: {orientation}")
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
            _LOGGER.error(f"Invalid device orientation value: {orientation}")
            return
        self._device_orientation = orientation
        # Drive the matrix/text/pixel flip (normal vs 180 deg).
        self._orientation = _DEVICE_ORIENTATION_TO_FLIP[orientation]

        # Whether we need to re-render/re-send to the lamp for this mode.
        reapply = True

        # For native effects, steer the effect's flow to match the mounting,
        # but only if the current effect supports that direction.
        if self._mode == "Native Effect":
            spec = NATIVE_EFFECTS.get(self._native_effect, {})
            directions = spec.get("directions")
            desired = _DEVICE_ORIENTATION_TO_EFFECT_DIR.get(orientation)
            if directions and desired in directions:
                self._native_effect_direction = desired
                if self._native_effect_direction_select_entity:
                    self._native_effect_direction_select_entity.async_update_from_light()
        elif self._mode == "Clock":
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
            _LOGGER.error(f"Invalid alignment value: {alignment}")
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
        if self._music_flow_enabled or self._mode in ("Clock", "Native Effect"):
            return {ColorMode.BRIGHTNESS}
        return {ColorMode.RGB}

    @property
    def color_mode(self):
        # Current active color mode
        if self._music_flow_enabled or self._mode in ("Clock", "Native Effect"):
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
        return self._mode if self._mode in ("Clock", "Native Effect") else "Matrix"
    
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
        return not self._cube_matrix._device_unreachable

    @property
    def extra_state_attributes(self):
        attrs = {
            # Internal component identifier - DO NOT MODIFY
            "_yeelight_cube_component": "yeelight-cube-component-v1.0",
            # Entity identification - useful for service calls and automations
            "light_entity_id": self.entity_id if hasattr(self, 'entity_id') else "not_yet_initialized",
            "ip_address": self._ip,
            # Epoch timestamp for end-to-end latency measurement
            # JS card reads this and compares to Date.now() to detect pipeline delays
            "_update_epoch": time.time(),
            # Display configuration
            "mode": self._mode,
            "content_mode": self.content_mode,
            "matrix_mode": self._matrix_mode,
            "custom_draw_active": self._custom_draw_active,
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
            "native_effect": self._native_effect,
            "native_effect_speed": self._native_effect_speed,
            "native_effect_direction": self._native_effect_direction,
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
        # Add current matrix state: list of 100 RGB tuples (or hex), and brightness.
        # CRITICAL: Apply _apply_final_brightness here so the JS card gets
        # brightness-adjusted colors IMMEDIATELY when the user drags the slider,
        # without waiting for the lamp roundtrip.  set_brightness() updates
        # _preview_darken and calls async_schedule_update_ha_state() before
        # queuing the actual lamp command -- so this property is read with the
        # new darken value and the card preview updates instantly.
        #
        # We read from _base_matrix_colors (snapshot of un-darkened layout colors
        # taken right before apply()) and apply _apply_final_brightness() which
        # uses the full two-range brightness system (darken + brighten, floor()
        # math, channel preservation).  This avoids double-darkening: module.data
        # may already be darkened after apply(), but _base_matrix_colors is always
        # un-darkened.
        try:
            base_colors = getattr(self, '_base_matrix_colors', None)
            if base_colors and len(base_colors) == len(self._layout.device_layout):
                matrix_colors = [self._apply_final_brightness(rgb) for rgb in base_colors]
                attrs["matrix_colors"] = matrix_colors
            else:
                # Fallback: read directly from module data (may be darkened or not)
                matrix_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        hex_color = module.data[0].lstrip('#')
                        rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                        matrix_colors.append(rgb)
                    else:
                        matrix_colors.append((0, 0, 0))
                attrs["matrix_colors"] = matrix_colors
        except Exception as e:
            attrs["matrix_colors"] = []
        return attrs

    async def async_added_to_hass(self):
        _LOGGER.debug(f"[INIT] async_added_to_hass called for {self._attr_name}")
        await super().async_added_to_hass()
        self.async_on_remove(async_track_state_change_event(self.hass, self.entity_id, self.async_update))
        
        # Store config entry reference for accessing options
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if entry.data.get(CONF_IP) == self._ip:
                self._config_entry = entry
                break
        
        # Start periodic health check to detect devices coming back online
        self._health_check_task = self._create_tracked_task(
            self._periodic_health_check(), name=f"yeelight_cube_health_check_{self._ip}"
        )
        
        # Register entity by entity_id now that it's available
        # Remove the temporary IP-based registration first to avoid duplicates
        if self._ip in _ENTITY_REGISTRY:
            del _ENTITY_REGISTRY[self._ip]
        _ENTITY_REGISTRY[self.entity_id] = self
        _LOGGER.debug(f"[SETUP] Registered entity {self.entity_id} in registry. Registry now contains: {list(_ENTITY_REGISTRY.keys())}")
        
        _LOGGER.debug(f"[INIT] Initial state - custom_text: '{self._custom_text}', mode: '{self._mode}', is_on: {self._is_on}, brightness: {self._brightness}")
        old_state = await self.async_get_last_state()
        _LOGGER.debug(f"[RESTORE] old_state exists: {old_state is not None}")
        if old_state:
            _LOGGER.debug(f"[RESTORE] old_state.state: {old_state.state}")
            _LOGGER.debug(f"[RESTORE] old_state.attributes keys: {list(old_state.attributes.keys())}")
            _LOGGER.debug(f"[RESTORE] Brightness in attributes: {old_state.attributes.get('brightness')}")
            _LOGGER.debug(f"[RESTORE] Full attributes: {old_state.attributes}")
            
            # Restore effect values (preview adjustments)
            # Note: preview_darken is no longer saved in state attributes (removed from UI)
            # We'll recalculate it from brightness below
            if old_state.attributes.get("preview_brighten") is not None:
                self._preview_brighten = int(old_state.attributes["preview_brighten"])
            # Color Adjustments
            if old_state.attributes.get("preview_hue_shift") is not None:
                self._preview_hue_shift = int(old_state.attributes["preview_hue_shift"])
            if old_state.attributes.get("preview_temperature") is not None:
                self._preview_temperature = int(old_state.attributes["preview_temperature"])
            # Saturation & Intensity
            if old_state.attributes.get("preview_saturation") is not None:
                self._preview_saturation = int(old_state.attributes["preview_saturation"])
            if old_state.attributes.get("preview_vibrance") is not None:
                self._preview_vibrance = int(old_state.attributes["preview_vibrance"])
            # Tone & Contrast
            if old_state.attributes.get("preview_contrast") is not None:
                self._preview_contrast = int(old_state.attributes["preview_contrast"])
            if old_state.attributes.get("preview_glow") is not None:
                self._preview_glow = int(old_state.attributes["preview_glow"])
            # Special Effects
            if old_state.attributes.get("preview_grayscale") is not None:
                self._preview_grayscale = int(old_state.attributes["preview_grayscale"])
            if old_state.attributes.get("preview_invert") is not None:
                self._preview_invert = int(old_state.attributes["preview_invert"])
            if old_state.attributes.get("preview_tint_hue") is not None:
                self._preview_tint_hue = int(old_state.attributes["preview_tint_hue"])
            if old_state.attributes.get("preview_tint_strength") is not None:
                self._preview_tint_strength = int(old_state.attributes["preview_tint_strength"])
            # color_accuracy_enabled: no longer restored from old state.
            # It defaults to True and there's no UI toggle anymore.
            # The set_color_accuracy service still exists for advanced/automation use.
            _LOGGER.debug(f"[RESTORE] Restored effect values - hue_shift={self._preview_hue_shift}, temperature={self._preview_temperature}, saturation={self._preview_saturation}")
            
            if old_state.attributes.get("brightness") is not None:
                restored_brightness = int(old_state.attributes["brightness"])
                # Ensure brightness is at least 1 (Home Assistant minimum for ON lights)
                self._brightness = max(1, min(255, restored_brightness))
                _LOGGER.debug(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] RESTORE -- raw={restored_brightness}, "
                    f"clamped={self._brightness}, was_on={old_state.state}"
                )
                
                # CRITICAL: Recalculate hardware brightness and darken from user brightness
                hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
                self._preview_darken = darken_percent
                self._last_hardware_brightness = hardware_brightness
                self._last_applied_darken = darken_percent
                _LOGGER.debug(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] RESTORE CALC -- user={self._brightness}/255 -> "
                    f"hardware={hardware_brightness}%, darken={darken_percent}%, "
                    f"preview_darken={self._preview_darken}, last_hw={self._last_hardware_brightness}"
                )
            if old_state.attributes.get("text_colors") is not None:
                self._text_colors = [tuple(c) for c in old_state.attributes["text_colors"]]
                _LOGGER.debug(f"[RESTORE] Restored text_colors: {self._text_colors}")
                # Synchronize _rgb_color with the first text color
                self._sync_rgb_color()
            else:
                _LOGGER.warning(f"[RESTORE] No text_colors found, checking fallback...")
                rgb = old_state.attributes.get("rgb_color")
                grad_start = old_state.attributes.get("gradient_start")
                grad_end = old_state.attributes.get("gradient_end")
                _LOGGER.debug(f"[RESTORE] Fallback values - rgb: {rgb}, grad_start: {grad_start}, grad_end: {grad_end}")
                if rgb and grad_start and grad_end:
                    self._text_colors = [tuple(rgb), tuple(grad_end)]
                    self._sync_rgb_color()
                    _LOGGER.debug(f"[RESTORE] Used gradient fallback: {self._text_colors}")
                elif rgb:
                    self._text_colors = [tuple(rgb)]
                    self._sync_rgb_color()
                    _LOGGER.debug(f"[RESTORE] Used rgb fallback: {self._text_colors}")
                else:
                    _LOGGER.warning(f"[RESTORE] No fallback values available, keeping defaults: {self._text_colors}")
            # Restore mode and custom_draw_active
            if old_state.attributes.get("custom_draw_active") is not None:
                self._custom_draw_active = bool(old_state.attributes["custom_draw_active"])
            else:
                # Fallback for old state: if mode == 'Custom Draw', treat as custom_draw_active
                self._custom_draw_active = old_state.attributes.get("mode") == "Custom Draw"
            restored_mode = old_state.attributes.get("mode")
            if restored_mode in MATRIX_DISPLAY_MODES or restored_mode in (
                "Clock",
                "Native Effect",
            ):
                self._mode = restored_mode
            matrix_mode = old_state.attributes.get("matrix_mode")
            if matrix_mode in MATRIX_DISPLAY_MODES:
                self._matrix_mode = matrix_mode
            elif self._mode in MATRIX_DISPLAY_MODES:
                self._matrix_mode = self._mode
            if old_state.attributes.get("clock_style_id") is not None:
                clock_style = int(old_state.attributes["clock_style_id"])
                if clock_style in NATIVE_CLOCK_STYLES:
                    self._native_clock_style = clock_style
            if old_state.attributes.get("clock_show_date") is not None:
                self._native_clock_show_date = bool(
                    old_state.attributes["clock_show_date"]
                )
            # Clock content (3-way): restore directly if present, otherwise
            # migrate from the legacy boolean show_date flag.
            restored_content = old_state.attributes.get("clock_content")
            if restored_content in NATIVE_CLOCK_CONTENT_OPTIONS:
                self._native_clock_content = restored_content
            else:
                self._native_clock_content = (
                    "time_date" if self._native_clock_show_date else "time"
                )
            # Keep the compat boolean consistent with the 3-way content.
            self._native_clock_show_date = self._native_clock_content == "time_date"
            if old_state.attributes.get("clock_12_hour") is not None:
                self._native_clock_12_hour = bool(
                    old_state.attributes["clock_12_hour"]
                )
            if old_state.attributes.get("clock_colon_blink") is not None:
                self._native_clock_colon_blink = bool(
                    old_state.attributes["clock_colon_blink"]
                )
            if old_state.attributes.get("clock_color") is not None:
                try:
                    self._native_clock_color = int(old_state.attributes["clock_color"])
                except (TypeError, ValueError):
                    self._native_clock_color = None
            native_effect = old_state.attributes.get("native_effect")
            # Migrate legacy names (e.g. "Ribbon") to current app names.
            native_effect = NATIVE_EFFECT_RENAMES.get(native_effect, native_effect)
            if native_effect in NATIVE_EFFECTS:
                self._native_effect = native_effect
            if old_state.attributes.get("native_effect_speed") is not None:
                self._native_effect_speed = max(
                    1, min(255, int(old_state.attributes["native_effect_speed"]))
                )
            native_direction = old_state.attributes.get("native_effect_direction")
            if native_direction in NATIVE_EFFECT_DIRECTION_VALUES:
                self._native_effect_direction = native_direction
            if old_state.attributes.get("music_flow_enabled") is not None:
                self._music_flow_enabled = bool(
                    old_state.attributes["music_flow_enabled"]
                )
            music_flow_effect = old_state.attributes.get("music_flow_effect")
            if music_flow_effect in MUSIC_FLOW_EFFECTS:
                self._music_flow_effect = music_flow_effect
            music_flow_restore_power = old_state.attributes.get(
                "music_flow_restore_power"
            )
            if isinstance(music_flow_restore_power, bool):
                self._music_flow_restore_power = music_flow_restore_power
            power_on_state = old_state.attributes.get("power_on_state")
            if power_on_state in POWER_ON_STATES:
                self._power_on_state = power_on_state
            button_effects = old_state.attributes.get("button_effects")
            if isinstance(button_effects, list):
                self._button_effects = [
                    NATIVE_EFFECT_RENAMES.get(name, name)
                    for name in button_effects
                    if NATIVE_EFFECT_RENAMES.get(name, name) in NATIVE_EFFECTS
                    or name.startswith("Clock: ")
                ][:8]
            if old_state.attributes.get("custom_text") is not None:
                self._custom_text = old_state.attributes["custom_text"]
            if old_state.attributes.get("background_color") is not None:
                self._background_color = tuple(old_state.attributes["background_color"])
            if old_state.attributes.get("alignment") is not None:
                alignment_val = old_state.attributes["alignment"]
                if alignment_val in ("left", "center", "right"):
                    self._alignment = alignment_val
            if old_state.attributes.get("font") is not None:
                from .layout import FONT_MAPS
                font_val = old_state.attributes["font"]
                if font_val in FONT_MAPS:
                    self._font = font_val
            # Restore the 4-way physical device orientation (right/down/left/up).
            # This is the persistent source of truth for native-effect flow and
            # matrix/pixel flip, so it must survive a HA restart. Keep the legacy
            # normal/flipped flag consistent with it.
            device_orientation_val = old_state.attributes.get("device_orientation")
            if device_orientation_val in DEVICE_ORIENTATIONS:
                self._device_orientation = device_orientation_val
                self._orientation = _DEVICE_ORIENTATION_TO_FLIP[device_orientation_val]
            elif old_state.attributes.get("orientation") in (
                ORIENTATION_NORMAL,
                ORIENTATION_FLIPPED,
            ):
                # Legacy state that only stored normal/flipped.
                self._orientation = old_state.attributes["orientation"]
                self._device_orientation = (
                    "left" if self._orientation == ORIENTATION_FLIPPED else "right"
                )
            if old_state.attributes.get("angle") is not None:
                self._angle = float(old_state.attributes["angle"])
            # Restore transition settings
            if old_state.attributes.get("transition_type") is not None:
                t_type = old_state.attributes["transition_type"]
                _VALID_TRANSITIONS = {
                    "none", "fade_through_black", "direct_crossfade",
                    "random_dissolve", "pixel_migration",
                    "wipe_right", "wipe_left", "wipe_down", "wipe_up",
                    "slide_left", "slide_right", "slide_up", "slide_down",
                    "card_from_right", "card_from_left", "card_from_top", "card_from_bottom",
                    "explode_reform", "snake", "wave_wipe", "iris",
                    "vertical_flip", "curtain", "gravity_drop",
                }
                if t_type in _VALID_TRANSITIONS:
                    self._transition_type = t_type
            if old_state.attributes.get("transition_steps") is not None:
                self._transition_steps = max(1, min(10, int(old_state.attributes["transition_steps"])))
            if old_state.attributes.get("transition_duration") is not None:
                self._transition_duration = max(0.2, min(10.0, float(old_state.attributes["transition_duration"])))
            # Restore scroll settings
            if old_state.attributes.get("scroll_speed") is not None:
                self._scroll_speed = float(old_state.attributes["scroll_speed"])
            if old_state.attributes.get("scroll_enabled") is not None:
                self._scroll_enabled = bool(old_state.attributes["scroll_enabled"])
        self._restore_music_flow_runtime_state()
        # Palettes and pixel arts are accessed via @property from global storage
        # No restoration needed - __init__.py loads from Store into hass.data[DOMAIN]
        _LOGGER.debug(f"[RESTORE] Entity initialized. Palettes: {len(self._palettes)}, Pixel Arts: {len(self._pixel_arts)}")
            # Note: No need to copy back to hass.data - we're using shared references now
        self.async_schedule_update_ha_state()
        
        _LOGGER.debug(f"[INIT] After state restoration - custom_text: '{self._custom_text}', mode: '{self._mode}', is_on: {self._is_on}")
        _LOGGER.debug(f"[INIT] Calling initial async_apply_display_mode to display HELLO...")
        
        # Apply initial display mode to show HELLO
        # Use 'turn_on' type so this isn't blocked by the retry limit after HA restart
        if self._is_on and self._music_flow_enabled:
            _LOGGER.debug(
                "[INIT] Music flow was active before restart; preserving renderer"
            )
        elif self._is_on:
            await self.async_apply_display_mode(update_type='turn_on')
        else:
            _LOGGER.debug(f"[INIT] Light is off, not applying display mode")

    async def async_will_remove_from_hass(self):
        """Clean up when entity is removed"""
        self.stop_scroll_timer()
        
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
            _LOGGER.debug(f"[CLEANUP] Cancelling {len(self._background_tasks)} background tasks")
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
        In _apply_impl, set_bright is sent on the persistent socket (via
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
            f"[ENSURE_FX] [{self._ip}] Activating FX mode via raw TCP "
            f"[{cm._state_summary()}]"
        )

        # Step 1: Kill persistent socket
        cm._close_fast_socket()

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
        # _last_hardware_brightness is reset to 0 (sentinel) so _apply_impl
        # unconditionally re-sends set_bright on the persistent socket -- both
        # the direct path (if not _fx_mode_is_direct) and the indirect path
        # (force_refresh → _apply_display_mode_internal → _apply_impl else-branch
        # sees hardware_brightness != 0 and sends set_bright).
        self._fx_mode_is_direct = True
        self._in_native_fw_mode = False
        self._last_fx_mode_time = time.time()
        self._last_hardware_brightness = 0  # Sentinel: force brightness re-confirm

        _LOGGER.debug(
            f"[ENSURE_FX] [{self._ip}] [OK] FX activated -- set_bright will follow on persistent socket"
        )

    async def _force_refresh_impl(self):
        """Force refresh implementation - runs inside _execute_hardware_op lock.
        
        Closes persistent socket, re-activates FX mode via raw TCP,
        and re-renders the display through the full pipeline.
        
        IMPORTANT: We must NOT read raw pixel data from self._layout and
        send it directly, because _apply_impl() applies software brightness
        darkening IN PLACE to module.data.  Sending those already-darkened
        pixels while also setting hardware brightness via set_bright would
        result in double-darkening (dimmer than intended).
        
        Instead, we re-render through _apply_display_mode_internal() which:
          1. Fills the layout with fresh un-darkened colours (text/drawing)
          2. Calls _apply_impl() which applies colour effects + brightness
             darkening correctly, then sends the final pixel data.
        Since ensure_fx_ready() already set _fx_mode_is_direct=True,
        _apply_impl() will skip redundant FX activation.
        """
        # Steps 1-3: Close persistent socket, activate FX via raw TCP, set brightness
        await self.ensure_fx_ready()
        _LOGGER.info(f"[FORCE REFRESH] [{self._ip}] ensure_fx_ready complete")
        
        # Step 4: Re-render through the full display pipeline so brightness
        # darkening is applied once (not double-applied on stale pixel data).
        await self._apply_display_mode_internal(skip_post_delay=True)
        _LOGGER.info(
            f"[FORCE REFRESH] [{self._ip}] Complete - "
            f"FX mode active, brightness={self._last_hardware_brightness}%, "
            f"display re-rendered"
        )

    async def async_force_refresh(self):
        """Force refresh via _execute_hardware_op (properly serialized with device lock)."""
        _LOGGER.info(
            f"[FORCE REFRESH] [{self._ip}] Starting -- "
            f"closing persistent socket and using raw TCP"
        )
        await self._execute_hardware_op(
            lambda: self._force_refresh_impl(),
            "force_refresh"
        )

    async def async_turn_on(self, **kwargs):
        """Turn on the light."""
        _LOGGER.debug(f"[TURN_ON] async_turn_on called with kwargs: {kwargs}")
        
        # Calibration lock: ignore automation turn_on (incl. light.turn_on with
        # brightness/colour/text) while the wizard owns the lamp.
        if self._calibration_lock:
            _LOGGER.debug(
                f"[CALIB_LOCK] [{self._ip}] turn_on ignored -- calibration lock active"
            )
            return

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
            lambda: self._internal_turn_on(**kwargs),
            "turn_on"
        )
    
    async def _internal_turn_on(self, **kwargs):
        """Internal turn_on implementation -- runs under the global lock."""
        _LOGGER.debug(f"[TURN_ON] Executing - is_on: {self._is_on}, custom_text: '{self._custom_text}', mode: '{self._mode}'")

        if self._music_flow_enabled:
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
                await self._set_native_mode_brightness()
            self._is_on = True
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return

        if self._mode == "Clock":
            self._is_on = True
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
            await self._activate_native_clock()
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return
        if self._mode == "Native Effect":
            self._is_on = True
            if "brightness" in kwargs:
                self._brightness = max(1, min(255, kwargs["brightness"]))
            await self._activate_native_effect()
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            return
        
        # Ensure FX mode is active using raw TCP (proven reliable).
        # ensure_fx_ready() handles activate_fx_mode + set_bright atomically.
        if not self._fx_mode_is_direct:
            _LOGGER.debug(f"[TURN_ON] Activating FX mode via raw TCP")
            await self.ensure_fx_ready()
        
        self._is_on = True
        
        # Handle colors from kwargs
        if "text_colors" in kwargs:
            _LOGGER.debug(f"[TURN_ON] Setting text_colors from kwargs: {kwargs['text_colors']}")
            self._text_colors = [tuple(c) for c in kwargs["text_colors"]]
            self._sync_rgb_color()
        
        if "rgb_color" in kwargs:
            rgb_color = kwargs["rgb_color"]
            _LOGGER.debug(f"[TURN_ON] RGB color selected: {rgb_color}")
            self._text_colors = [tuple(rgb_color)]
            self._sync_rgb_color()
        
        _LOGGER.debug(f"[TURN_ON] Current state - text_colors: {self._text_colors}, background: {self._background_color}")
        
        try:
            if "brightness" in kwargs:
                new_brightness = kwargs["brightness"]
                _LOGGER.debug(f"[TURN_ON] Setting brightness to {new_brightness}")
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
            msg = str(e)
            if "quota exceeded" in msg.lower():
                _LOGGER.debug("Rate limit exceeded during turn_on")
            elif isinstance(e, TimeoutError):
                _LOGGER.warning("Timeout during turn_on - device may be unreachable")
            else:
                _LOGGER.error(f"Unexpected error during turn_on: {e}")
        
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug(f"[TURN_ON] Turn on complete")
        
        _LOGGER.debug(f"[TURN_ON] Turn on complete")

    async def async_turn_off(self, **kwargs):
        """Turn off the light."""
        _LOGGER.debug(f"[TURN_OFF] async_turn_off called")
        
        # Calibration lock: ignore automation turn_off while the wizard runs.
        if self._calibration_lock:
            _LOGGER.debug(
                f"[CALIB_LOCK] [{self._ip}] turn_off ignored -- calibration lock active"
            )
            return
        
        # Update HA state IMMEDIATELY for responsive UI
        self._is_on = False
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_turn_off(**kwargs),
            "turn_off"
        )
    
    async def _internal_turn_off(self, **kwargs):
        """Internal turn_off implementation that executes in the queue."""
        _LOGGER.debug(f"[TURN_OFF] Executing turn_off")
        was_music_flow_enabled = self._music_flow_enabled
        if was_music_flow_enabled or self._mode in ("Clock", "Native Effect"):
            self._cube_matrix._close_fast_socket()
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
        _LOGGER.debug(f"[TURN_OFF] Turn off complete")

    async def set_brightness(self, brightness: int, **kwargs):
        """
        Unified brightness control using BOTH hardware brightness and RGB darkening.
        
        The system automatically chooses the best mechanism based on brightness level:
        
        LOW RANGE (e.g., 0-30%):
        - Uses hardware dimming (25-100%) + maximum RGB darkening (94%)
        - Allows VERY low brightness for night/ambient use
        
        HIGH RANGE (e.g., 30-100%):
        - Uses maximum hardware (100%) + variable RGB darkening (94-0%)
        - Preserves color accuracy at higher brightness levels
        
        HA Brightness Range:
        - 0: Light OFF (handled by turn_off, not brightness adjustment)
        - 1 (0.4%): Minimum brightness - hardware at MIN, darkness at MAX
        - 255 (100%): Maximum brightness - hardware at 100%, darkness at 0%
        
        User sees ONE smooth slider controlling both mechanisms automatically.
        
        PERFORMANCE OPTIMIZATIONS:
        - Fire-and-forget hardware brightness (no waiting for lamp response)
        - Queue dropping: obsolete brightness calls are automatically dropped
        - Parallel execution: hardware + display updates run simultaneously when both change
        """
        # Calibration lock: ignore automation brightness changes while the wizard
        # drives the lamp. Wizard calls pass bypass_lock=True.
        bypass_lock = kwargs.pop("bypass_lock", False)
        if self._calibration_lock and not bypass_lock:
            _LOGGER.debug(
                f"[CALIB_LOCK] [{self._ip}] set_brightness({brightness}) ignored "
                f"-- calibration lock active"
            )
            return
        call_id = int(time.time() * 1000) % 100000
        _LOGGER.debug(
            f"[BRIGHTNESS_DIAG] [{self._ip}] SET_BRIGHTNESS called: "
            f"requested={brightness}, current={self._brightness}, is_on={self._is_on}"
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
                f"[BRIGHTNESS_DIAG] [{self._ip}] SET_BRIGHTNESS state update: "
                f"{old_brightness} -> {self._brightness}, darken={darken_percent}%"
            )
            if self.hass is not None:
                _LOGGER.debug(
                    f"[TIMING] [{self._ip}] brightness state_push epoch={time.time():.3f}")
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_set_brightness(brightness, call_id, **kwargs),
            f"brightness:{brightness}"
        )
    
    async def _internal_set_brightness(self, brightness: int, call_id: int, **kwargs):
        """Internal brightness implementation -- runs under the global lock."""
        _LOGGER.debug(
            f"[BRIGHTNESS_DIAG] [{self._ip}] INTERNAL_SET #{call_id} -- "
            f"requested={brightness}, current={self._brightness}, "
            f"last_hw={self._last_hardware_brightness}, last_darken={self._last_applied_darken}"
        )
        
        if self._is_on:
            # Store the raw HA brightness value (1-255 for ON lights, 0 means OFF)
            old_brightness = self._brightness
            self._brightness = max(1, min(255, brightness))  # Clamp to 1-255 for ON state
            _LOGGER.debug(f"[BRIGHTNESS #{call_id}] Brightness changed: {old_brightness} -> {self._brightness}")

            if self._music_flow_enabled or self._mode in ("Clock", "Native Effect"):
                await self._set_native_mode_brightness()
                if self.hass is not None:
                    self.async_schedule_update_ha_state()
                return
            
            # Calculate BOTH hardware brightness and darkness percentage
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            
            _LOGGER.debug(
                f"[BRIGHTNESS #{call_id}] User brightness {self._brightness} (1-255) -> "
                f"hardware={hardware_brightness}%, darkness={darken_percent}%"
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
                        f"[BRIGHTNESS #{call_id}] BOTH changed - "
                        f"hardware: {old_hardware}% -> {hardware_brightness}%, "
                        f"darkness: {old_darken}% -> {darken_percent}% - sequential hw then display"
                    )
                    # IMPORTANT: Send hardware brightness FIRST, then update display.
                    # If we fire-and-forget the hardware command while sending the display
                    # update, the lamp may receive the new darkened RGB values while still
                    # at the OLD hardware brightness, causing a brief brightness dip.
                    # By awaiting the hardware command first, we ensure the lamp's hardware
                    # brightness is updated BEFORE it receives the new RGB pixel data.
                    
                    # Pre-flight check: skip if connection is down
                    if not self._cube_matrix.is_connected():
                        _LOGGER.debug(f"[BRIGHTNESS] Skipping hardware command - connection down")
                        self._pending_brightness = (self._brightness, time.time())
                        _LOGGER.debug(f"[BRIGHTNESS] Queued brightness {self._brightness} for retry")
                        self._start_brightness_retry_task()
                    else:
                        try:
                            # Fire-and-forget: send-only, no recv() wait.
                            # The Cube always closes TCP after each command  --
                            # waiting for the response just wastes time on a
                            # "Bulb closed the connection" exception.
                            await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                            # NOTE: We do NOT reset _fx_mode_is_direct here.
                            # Testing shows set_bright does not knock the Cube out of
                            # direct mode, and resetting this flag would force apply()
                            # to re-send activate_fx_mode + set_bright AGAIN -- adding
                            # ~300ms of unnecessary TCP commands on every brightness
                            # change.  The FX_MODE_STALENESS_TIMEOUT check in
                            # _apply_impl() is the safety net if the Cube does
                            # silently exit direct mode after an idle period.
                        except Exception as e:
                            error_msg = str(e).lower()
                            is_known_error = (
                                "quota" in error_msg or 
                                "timeout" in error_msg or 
                                "socket" in error_msg or 
                                "nonetype" in error_msg or
                                isinstance(e, AttributeError)
                            )
                            if not is_known_error:
                                _LOGGER.warning(f"[BRIGHTNESS] Unexpected error sending hardware brightness: {e}")
                    
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
                        f"[BRIGHTNESS #{call_id}] Tracked successful brightness: "
                        f"{self._brightness} (hardware={hardware_brightness}%, darkness={darken_percent}%)"
                    )
                    
                    # _last_hardware_brightness already set above (before branches)
                    self._last_applied_darken = darken_percent
                    
                elif hardware_changed:
                    # Only hardware changed - send command and await it
                    _LOGGER.debug(
                        f"[BRIGHTNESS #{call_id}] Hardware brightness changed: "
                        f"{old_hardware}% -> {hardware_brightness}%, sending..."
                    )
                    # Pre-flight check: skip if connection is down
                    if not self._cube_matrix.is_connected():
                        _LOGGER.debug(f"[BRIGHTNESS] Skipping hardware command - connection down")
                        self._pending_brightness = (self._brightness, time.time())
                        _LOGGER.debug(f"[BRIGHTNESS] Queued brightness {self._brightness} for retry")
                        self._start_brightness_retry_task()
                    else:
                        try:
                            # Fire-and-forget: send-only, no recv() wait.
                            await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                            # NOTE: Do NOT reset _fx_mode_is_direct here -- see
                            # comment in 'both changed' branch above.
                        except Exception as e:
                            error_msg = str(e).lower()
                            is_known_error = (
                                "quota" in error_msg or 
                                "timeout" in error_msg or 
                                "socket" in error_msg or 
                                "nonetype" in error_msg or
                                isinstance(e, AttributeError)
                            )
                            if not is_known_error:
                                _LOGGER.warning(f"[BRIGHTNESS] Unexpected error sending hardware brightness: {e}")
                    
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
                        f"[BRIGHTNESS #{call_id}] Darkness changed: {old_darken}% -> {darken_percent}%, "
                        f"using fast brightness path..."
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
                    has_active_effects = (
                        self._preview_hue_shift != 0 or self._preview_saturation != 100 or
                        self._preview_temperature != 0 or self._preview_contrast != 100 or
                        self._preview_vibrance != 100 or self._preview_glow != 0 or
                        self._preview_grayscale != 0 or self._preview_invert != 0 or
                        self._preview_tint_strength != 0
                    )
                    if has_active_effects:
                        _LOGGER.debug(
                            f"[BRIGHTNESS #{call_id}] Values unchanged but effects active "
                            f" -- forcing display update to preserve effects"
                        )
                        # PERFORMANCE: Direct call -- see comment in 'both changed' branch.
                        await self._apply_display_mode_internal(skip_post_delay=True)
                    else:
                        _LOGGER.debug(f"[BRIGHTNESS #{call_id}] No changes needed, brightness already at target")
                    
            except Exception as e:
                # Most errors are already handled gracefully in cube_matrix.send_command_with_recovery
                # Only truly unexpected errors reach here
                msg = str(e)
                if "quota exceeded" in msg.lower():
                    _LOGGER.warning(f"[BRIGHTNESS #{call_id}] Rate limit exceeded - backing off")
                elif isinstance(e, TimeoutError):
                    _LOGGER.warning(f"[BRIGHTNESS #{call_id}] Timeout - device may be unreachable")
                else:
                    _LOGGER.error(f"[BRIGHTNESS #{call_id}] Unexpected error: {e}")
        else:
            _LOGGER.debug(f"[BRIGHTNESS #{call_id}] Light is off, not applying brightness")

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
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Dropping expired brightness: {pending_value}")
                self._pending_brightness = None
                continue
            
            # ANTI-OVERWRITE CHECK: Has a newer brightness already succeeded?
            if self._last_successful_brightness is not None:
                last_success_time, last_success_value = self._last_successful_brightness
                
                # If a newer brightness succeeded AFTER this one was queued, drop it
                if last_success_time > queued_timestamp:
                    _LOGGER.debug(
                        f"[BRIGHTNESS RETRY] Dropping stale brightness {pending_value} - "
                        f"newer brightness {last_success_value} already applied "
                        f"(queued at {queued_timestamp:.2f}, superseded at {last_success_time:.2f})"
                    )
                    self._pending_brightness = None
                    continue
            
            # Try to re-apply the complete brightness through the queue
            try:
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Retrying brightness {pending_value} via queue")
                # Queue through the proper channel so it's serialized with other operations
                await self.set_brightness(pending_value)
                # Success - clear pending
                self._pending_brightness = None
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Successfully queued brightness retry {pending_value}")
            except Exception as e:
                # Failed again - will retry later
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Retry failed for brightness {pending_value}: {e}")
                # If connection is down again, wait longer
                if not self._cube_matrix.is_connected():
                    await asyncio.sleep(1)
                else:
                    # Other error - clear pending to avoid infinite retry
                    _LOGGER.warning(f"[BRIGHTNESS RETRY] Clearing pending brightness due to error: {e}")
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

        if self._mode == "Clock" and self._is_on:
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
        if self._mode in ("Clock", "Native Effect"):
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
        # Calibration lock: while the wizard owns the lamp, drop every display
        # update that doesn't explicitly bypass the lock (i.e. anything not coming
        # from the wizard). This freezes the panel on the wizard's test pattern so
        # automations (custom text, pixel art, clock, sensors...) can't disturb it.
        if self._calibration_lock and not bypass_lock:
            _LOGGER.debug(
                f"[CALIB_LOCK] [{self._ip}] Display update '{update_type}' ignored "
                f"-- calibration lock active"
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
        # they pass through; when they render, _apply_impl -> ensure_fx_ready()
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
            and self._mode not in ("Clock", "Native Effect")
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
        # display_update calls arriving every ~30s would restart the 20-retry
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
                    f"[DISPLAY] [{self._ip}] User action '{update_type}' reset retry counter "
                    f"({self._display_retry_count} -> 0) -- retries will resume"
                )
                self._display_retry_count = 0
                # Cancel any pending retry task -- without this, the old
                # retry fires immediately and pushes the counter back to 6
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
                    _LOGGER.debug(f"[DISPLAY] [{self._ip}] Cancelled stale retry task")
            else:
                _LOGGER.debug(
                    f"[DISPLAY] [{self._ip}] Periodic '{update_type}' skipped -- device offline, "
                    f"retry limit reached ({self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}). "
                    f"A user action will restart retries."
                )
                return  # Don't queue -- device is offline and no user is actively requesting
        
        log_level = _LOGGER.info if is_retry else _LOGGER.debug
        log_level(f"[DISPLAY] async_apply_display_mode called - mode: '{self._mode}', text: '{self._custom_text}', type: '{update_type}', is_on: {self._is_on}")
        
        # Track which type of update is running so the transition block in
        # _apply_impl() can skip animations on retries / recovery / periodic
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
        await self._execute_hardware_op(
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
        await self._apply_brightness_only_impl()

    async def _apply_brightness_only_impl(self):
        try:
            if not self._cube_matrix.is_connected():
                _LOGGER.warning(f"[BRIGHTNESS_FAST] [{self._ip}] SKIP -- cooldown active")
                raise Exception("Cooldown active -- device not yet reachable")
            
            # If we don't have base colors yet, fall back to the full path
            base_colors = getattr(self, '_base_matrix_colors', None)
            if not base_colors or len(base_colors) != len(self._layout.device_layout):
                _LOGGER.debug(f"[BRIGHTNESS_FAST] No base colors -- falling back to full apply")
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # STALENESS CHECK: Same as in _apply_impl -- check fx_age, not idle.
            # Falls through to full apply path which uses ensure_fx_ready() (raw TCP).
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    _LOGGER.warning(
                        f"[BRIGHTNESS_FAST] [{self._ip}] FX mode stale -- fx_age={fx_age:.0f}s > "
                        f"{FX_MODE_STALENESS_TIMEOUT:.0f}s, falling back to full apply (raw TCP recovery)"
                    )
                    self._fx_mode_is_direct = False

            # If FX mode isn't set, fall back to the full path which handles activation
            if not self._fx_mode_is_direct:
                _LOGGER.debug(f"[BRIGHTNESS_FAST] FX mode not set -- falling back to full apply")
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Check if reconnection happened
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.debug(f"[BRIGHTNESS_FAST] Reconnection detected -- falling back to full apply")
                self._fx_mode_is_direct = False
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Re-apply brightness + accuracy to the base colors.
            #
            # IMPORTANT: _base_matrix_colors already has color effects baked in
            # (hue_shift, saturation, contrast, temperature, vibrance, glow,
            #  grayscale, invert, tint).  They were applied during the full
            # render in _apply_impl and snapshotted AFTER apply_color_adjustments.
            # Do NOT call apply_color_adjustments() again here -- that would
            # double-apply every color effect (e.g., hue shift applied twice).
            #
            # What we DO re-apply each time brightness changes:
            #   1. _apply_final_brightness -- RGB darkening for brightness
            #   2. _apply_color_correction -- low-brightness gamma correction
            #   3. _apply_color_accuracy -- per-channel gain (fades with brightness)
            
            # Write darkened colors directly into modules
            _LOGGER.debug(
                f"[BRIGHTNESS_DIAG] [{self._ip}] BRIGHTNESS_FAST -- "
                f"user={self._brightness}/255, darken={self._preview_darken}%, "
                f"brighten={self._preview_brighten}%, "
                f"last_hw={self._last_hardware_brightness}, last_darken={self._last_applied_darken}, "
                f"base_colors_count={len(base_colors)}"
            )
            for i, module in enumerate(self._layout.device_layout):
                if i < len(base_colors):
                    rgb = base_colors[i]
                    # base_colors already includes color effects -- only apply
                    # brightness pipeline (darkening, gamma, accuracy)
                    rgb = self._apply_final_brightness(rgb)
                    rgb = self._apply_color_correction(rgb)
                    rgb = self._apply_color_accuracy(rgb)
                    module.data = [rgb_to_hex(rgb)]
            
            # Send pixel data using fire-and-forget (no recv wait)
            raw_rgb_data = self._layout.get_raw_rgb_data()
            await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
            
            # POST-SEND RECONNECTION CHECK: Same as in _apply_impl -- if the
            # socket reconnected during send, pixels were silently ignored.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.warning(
                    f"[BRIGHTNESS_FAST] [{self._ip}] Socket reconnected during update_leds -- "
                    f"falling back to full apply for FX re-activation"
                )
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Track successful rendering
            self._last_applied_darken = self._preview_darken
            self._connection_error = False
            
            # Update _last_sent_colors for future transitions
            try:
                self._last_sent_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        self._last_sent_colors.append(hex_to_rgb(module.data[0]))
                    else:
                        self._last_sent_colors.append((0, 0, 0))
            except Exception:
                self._last_sent_colors = None
            
            if self.hass is not None:
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
                
            _LOGGER.debug(f"[BRIGHTNESS_FAST] [OK] Done (darken={self._preview_darken}%)")
            
        except Exception as e:
            msg = str(e)
            if any(kw in msg.lower() for kw in ['socket', 'closed', 'connection', 'cooldown', 'timeout']):
                self._fx_mode_is_direct = False
                self._connection_error = True
                self._last_connection_error = msg
                _LOGGER.debug(f"[BRIGHTNESS_FAST] Connection issue: {e} -- re-raising for retry")
            else:
                _LOGGER.warning(f"[BRIGHTNESS_FAST] Error: {e}")
            raise











    async def async_set_power_on_state(self, option: str) -> None:
        """Set the Cube Lite's power recovery behavior."""
        if option not in POWER_ON_STATES:
            raise ValueError(f"Unsupported power-on state: {option}")
        self._cube_matrix._close_fast_socket()
        try:
            result = await self._cube_matrix.send_command_with_recovery(
                "set_ps", ["cfg_init_power", POWER_ON_STATES[option]]
            )
            if result is None:
                raise RuntimeError(
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
                    if "color" in style:
                        config["color"] = [style["color"]]
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
        self._cube_matrix._close_fast_socket()
        try:
            for index, name in enumerate(effect_names):
                result = await self._cube_matrix.send_command_with_recovery(
                    "update_persist_effect_list",
                    [index, self._effect_persist_item(name)],
                )
                if result is None:
                    raise RuntimeError(
                        f"Physical-button preset slot {index + 1} was skipped "
                        "during connection cooldown"
                    )
        finally:
            self._cube_matrix.close_command_socket()
        self._button_effects = list(effect_names)
        if self.hass is not None:
            self.async_write_ha_state()









    async def apply(self, skip_post_delay: bool = False):
        await self._apply_impl(skip_post_delay)

    async def _apply_impl(self, skip_post_delay: bool = False):
        try:
            # Fast-fail: if we're in cooldown after a failed connection attempt,
            # RAISE so the queue processor sees this as a failure and schedules
            # a retry. Previously this returned silently, which the queue processor
            # treated as success -- cancelling the retry chain and leaving the lamp
            # dark forever.
            if not self._cube_matrix.is_connected():
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] SKIP -- cooldown active, raising to trigger retry "
                    f"(fx_direct={self._fx_mode_is_direct}, is_on={self._is_on}, "
                    f"retry_count={self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}) "
                    f"[{self._cube_matrix._state_summary()}]"
                )
                raise Exception("Cooldown active -- device not yet reachable")
            
            # Check if the lamp just reconnected (socket was reset).
            # If so, we need to re-send FX mode and brightness before pixel data.
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] Reconnection detected -- will restore FX mode + brightness "
                    f"(fx_direct was {self._fx_mode_is_direct}, forcing to False)"
                )
                self._fx_mode_is_direct = False  # Force re-send
            
            # STALENESS CHECK: The Cube silently exits direct FX mode ~25s
            # after ACTIVATION (not after last command!).  Check fx_age.
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    idle_seconds = time.time() - self._cube_matrix._last_command_time if self._cube_matrix._last_command_time > 0 else 999
                    _LOGGER.warning(
                        f"[APPLY] [{self._ip}] FX mode stale -- fx_age={fx_age:.0f}s > "
                        f"{FX_MODE_STALENESS_TIMEOUT:.0f}s threshold (idle={idle_seconds:.1f}s), "
                        f"forcing re-activation via raw TCP"
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
                        f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY -- sending set_bright: "
                        f"user={self._brightness}/255, hardware={hardware_brightness}%, "
                        f"darken={darken_percent}%, prev_hw={self._last_hardware_brightness}, "
                        f"fx_direct={self._fx_mode_is_direct}, mode='{self._mode}'"
                    )
                    try:
                        await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                        self._last_hardware_brightness = hardware_brightness
                        _LOGGER.debug(
                            f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY -- set_bright SUCCESS: "
                            f"hardware={hardware_brightness}%"
                        )
                    except Exception as e:
                        _LOGGER.debug(
                            f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY -- set_bright FAILED: {e}"
                        )
                else:
                    _LOGGER.debug(
                        f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY -- set_bright SKIPPED "
                        f"(unchanged at {hardware_brightness}%)"
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
                    f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY -- fixed stale _preview_darken: "
                    f"{old_darken}% -> {darken_percent}% (user={self._brightness}/255)"
                )

            has_color_effect = (
                self._preview_saturation != 100 or self._preview_hue_shift != 0 or
                self._preview_contrast != 100 or self._preview_temperature != 0 or
                self._preview_vibrance != 100 or self._preview_glow != 0 or
                self._preview_grayscale != 0 or self._preview_invert != 0 or
                self._preview_tint_strength != 0
            )
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
            # The brightness fast path (_apply_brightness_only_impl) therefore
            # must NOT re-apply color adjustments -- only brightness pipeline.
            snapshot_in_loop = has_color_effect or has_brightness_effect
            if not snapshot_in_loop:
                try:
                    self._base_matrix_colors = []
                    for module in self._layout.device_layout:
                        if hasattr(module, 'data') and module.data:
                            hex_color = module.data[0].lstrip('#')
                            rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                            self._base_matrix_colors.append(rgb)
                        else:
                            self._base_matrix_colors.append((0, 0, 0))
                except Exception:
                    pass
            
            has_color_accuracy = self._color_accuracy_enabled
            needs_pixel_processing = has_color_effect or has_brightness_effect or has_color_accuracy
            if needs_pixel_processing:
                if snapshot_in_loop:
                    self._base_matrix_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        final_colors = []
                        for hex_color in module.data:
                            rgb = hex_to_rgb(hex_color)
                            if has_color_effect:
                                rgb = self.apply_color_adjustments(rgb)
                            # Snapshot AFTER color effects, BEFORE brightness darkening.
                            # Each module has exactly 1 pixel (1x1 grid = 100 modules).
                            if snapshot_in_loop:
                                self._base_matrix_colors.append(rgb)
                            if has_brightness_effect:
                                rgb = self._apply_final_brightness(rgb)
                                rgb = self._apply_color_correction(rgb)
                            # Color accuracy is applied ALWAYS (independent of brightness)
                            rgb = self._apply_color_accuracy(rgb)
                            final_colors.append(rgb_to_hex(rgb))
                        module.data = final_colors
                    elif snapshot_in_loop:
                        self._base_matrix_colors.append((0, 0, 0))
            
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
                # Extract target colors from current (post-effects) module data
                target_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        target_colors.append(hex_to_rgb(module.data[0]))
                    else:
                        target_colors.append((0, 0, 0))
                # Only animate when content actually changed
                if target_colors != self._last_sent_colors:
                    try:
                        await self._run_transition(self._last_sent_colors, target_colors)
                    except Exception as e:
                        _LOGGER.warning(f"[TRANSITION] [{self._ip}] Transition aborted: {e}")
                    # Restore target colors to modules for the final send below
                    for i, module in enumerate(self._layout.device_layout):
                        if i < len(target_colors):
                            module.data = [rgb_to_hex(target_colors[i])]
                    # Clean TCP for final frame: close the persistent socket used
                    # for transition frames and re-activate FX on fresh TCP so the
                    # final authoritative frame goes on a pristine connection.
                    try:
                        await self.ensure_fx_ready()
                    except Exception as e:
                        _LOGGER.warning(
                            f"[TRANSITION] [{self._ip}] Post-transition FX re-activation failed: {e}"
                        )
            
            raw_rgb_data = self._layout.get_raw_rgb_data()
            
            _apply_t0 = time.time()
            
            # Count lit pixels for diagnostic logging
            lit = sum(1 for m in self._layout.device_layout
                      if hasattr(m, 'data') and m.data and m.data[0] != '#000000')
            idle_since_last_cmd = time.time() - self._cube_matrix._last_command_time if self._cube_matrix._last_command_time > 0 else -1
            
            _LOGGER.debug(
                f"[APPLY] [{self._ip}] Sending update_leds: "
                f"{lit} lit / {100 - lit} dark pixels, "
                f"text='{(self._custom_text or '')[:10]}' mode='{self._mode}' "
                f"idle={idle_since_last_cmd:.1f}s fx_age={time.time() - self._last_fx_mode_time:.0f}s "
                f"bright={self._brightness}/255 hw={hardware_brightness}% darken={darken_percent}%"
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
                f"[TIMING] [{self._ip}] TCP draw_matrices_fast: {(_t_after_send - _t_before_send)*1000:.1f}ms")
            
            # POST-SEND RECONNECTION CHECK: If the socket reconnected during
            # draw_matrices, pixels were sent on a non-FX socket -- silently
            # ignored.  Mark FX as not active so the next update re-activates.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] Socket reconnected during update_leds -- "
                    f"FX mode lost, will re-activate on next update"
                )
                raise Exception("Socket reconnected during pixel send -- FX re-activation needed")

            # NATIVE-EXIT RE-SEND: When leaving a firmware-native renderer, the
            # first update_leds above can be dropped while the firmware finishes
            # switching into direct mode.  The socket is now healthy and in
            # direct mode (the reconnect check above passed), so re-send the same
            # frame once -- this is the deterministic equivalent of the manual
            # second send that was previously needed.
            if leaving_native_fw_mode:
                await asyncio.sleep(0.12)
                _LOGGER.debug(
                    f"[APPLY] [{self._ip}] Native-exit re-send of first frame "
                    f"(firmware just left clock/native mode)"
                )
                await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
                self._last_fx_mode_time = time.time()
                if self._cube_matrix.consume_reconnected_flag():
                    self._fx_mode_is_direct = False
                    _LOGGER.warning(
                        f"[APPLY] [{self._ip}] Socket reconnected during native-exit "
                        f"re-send -- FX mode lost, will re-activate on next update"
                    )
                    raise Exception("Socket reconnected during native-exit re-send")
            
            # Track that this darken% was successfully rendered to lamp pixels.
            # This keeps _last_applied_darken accurate even when apply() is called
            # by display-mode changes (draw pixel, text update, etc.) rather than
            # by _internal_set_brightness.  Without this, the next brightness
            # slider drag could see a stale _last_applied_darken and trigger a
            # redundant display update for a darken that was already rendered.
            self._last_applied_darken = self._preview_darken
            
            # Store the final colors that were sent to the lamp for future transitions
            try:
                self._last_sent_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        self._last_sent_colors.append(hex_to_rgb(module.data[0]))
                    else:
                        self._last_sent_colors.append((0, 0, 0))
            except Exception:
                self._last_sent_colors = None
            
            # Skip post-delay for scroll animations to maintain smooth timing
            if not skip_post_delay:
                await asyncio.sleep(APPLY_POST_DELAY)
            
            # IMPORTANT: When we send pixel data, the lamp automatically turns on
            # So we must update our internal state to match the hardware state
            if not self._is_on:
                _LOGGER.debug(f"[APPLY] Lamp auto-turned on by pixel data, updating state")
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
                    f"[TIMING] [{self._ip}] apply pipeline: "
                    f"send={(_t_after_send - _t_before_send)*1000:.1f}ms "
                    f"post_delay={(_t_state_push - _t_after_send)*1000:.1f}ms "
                    f"camera_render={(_t_after_cam - _t_state_push)*1000:.1f}ms "
                    f"state_push={(_t_done - _t_after_cam)*1000:.1f}ms "
                    f"total={(_t_done - _apply_t0)*1000:.1f}ms "
                    f"epoch={_t_done:.3f}"
                )
            
            # Clear any previous connection error flag
            self._connection_error = False
        except BulbException as e:
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_code = error_dict.get('code', 0)
            error_message = error_dict.get('message', str(e))
            
            self._connection_error = True
            self._last_connection_error = f"BulbException: {error_message}"
            if "socket error" in error_message.lower() or "closed" in error_message.lower():
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if "socket error" in error_message.lower() or "closed" in error_message.lower():
                _LOGGER.debug(
                    f"[APPLY] [{self._ip}] BulbException (connection): code={error_code}, "
                    f"msg='{error_message}' -- re-raising for retry"
                )
            else:
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] BulbException: code={error_code}, "
                    f"msg='{error_message}' -- re-raising for retry"
                )
            raise
            
        except Exception as e:
            msg = str(e)
            self._connection_error = True
            self._last_connection_error = msg
            if any(kw in msg.lower() for kw in ['socket', 'closed', 'connection', 'cooldown', 'timeout']):
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if any(kw in msg.lower() for kw in ['socket', 'closed', 'connection', 'cooldown', 'none', 'quota', 'timeout']):
                _LOGGER.debug(
                    f"[APPLY] [{self._ip}] Connection issue: {type(e).__name__}: {msg} -- re-raising for retry"
                )
            else:
                _LOGGER.error(f"[APPLY] [{self._ip}] Unexpected error: {type(e).__name__}: {e}")
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
        _LOGGER.debug(f"[SCROLL] Timer started, next step in {scroll_delay}s")

    def _handle_scroll_step(self):
        """Handle a single scroll step"""
        _LOGGER.debug(f"[SCROLL_DEBUG] _handle_scroll_step called - text: '{self._custom_text}'")
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
        
        _LOGGER.debug(f"[SCROLL_DEBUG] Scroll step: offset={self._scroll_offset}, direction={self._scroll_direction}, max={self._max_scroll_offset}")
        
        # Update display and continue scrolling (fire-and-forget to avoid blocking scroll timer)
        # Don't await here - let the queue handle it asynchronously
        # This prevents queue processing delays from slowing down the scroll animation
        self._create_tracked_task(
            self.async_apply_display_mode(),
            name=f"yeelight_cube_scroll_step_{self._ip}"
        )
        
        # Determine timer delay - first and last positions pause longer
        if self._scroll_offset == 0 or self._scroll_offset == self._max_scroll_offset:
            # First or last position: pause for double time (3.0s)
            delay = self._scroll_speed * 2
            _LOGGER.debug(f"[SCROLL_DEBUG] Pausing at boundary position for {delay}s")
        else:
            # Normal position: use standard speed (1.5s)
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
    # mode, colors, layout, brightness and all colour effects.
    _DISPLAY_STATE_ATTRS = (
        "_custom_text", "_text_colors", "_mode", "_matrix_mode", "_native_clock_style",
        "_native_clock_show_date", "_native_clock_content", "_native_clock_12_hour",
        "_native_clock_colon_blink", "_native_clock_color", "_full_panel",
        "_native_effect", "_native_effect_speed", "_native_effect_direction",
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
        if getattr(self, "_orientation", ORIENTATION_NORMAL) == ORIENTATION_FLIPPED \
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

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> bool:
    # Create and register the light entity FIRST (this happens for EVERY device)
    ip = entry.data[CONF_IP]
    port = entry.data.get('port', 55443)
    
    # Diagnostic: log all config entries to detect duplicates
    all_entries = hass.config_entries.async_entries(DOMAIN)
    same_ip_entries = [e for e in all_entries if e.data.get(CONF_IP) == ip]
    _LOGGER.debug(
        f"[SETUP] Setting up entry {entry.entry_id} for IP {ip} "
        f"(total entries: {len(all_entries)}, entries for this IP: {len(same_ip_entries)})"
    )
    if len(same_ip_entries) > 1:
        _LOGGER.warning(
            f"[SETUP] [!] DUPLICATE CONFIG ENTRIES for IP {ip}! "
            f"Entry IDs: {[e.entry_id for e in same_ip_entries]}. "
            f"This causes two CubeMatrix instances fighting each other -- "
            f"remove the duplicate in Settings -> Integrations."
        )
    
    # TCP reachability has already been verified in __init__.py's
    # async_setup_entry (which is where ConfigEntryNotReady is effective).
    _LOGGER.debug(f"[SETUP] Creating CubeMatrix for {ip}:{port}")
    cube_matrix = CubeMatrix(ip, port)
    
    # Fetch capabilities in executor to avoid blocking the event loop
    _LOGGER.debug(f"[SETUP] Fetching capabilities for {ip} in executor")
    await hass.async_add_executor_job(cube_matrix.fetch_capabilities)
    _LOGGER.debug(f"[SETUP] Capabilities fetched for {ip}, creating light entity")
    
    light_entity = YeelightCubeLight(cube_matrix, ip, entry)
    
    # Register the entity in our global registry using IP as key
    _ENTITY_REGISTRY[ip] = light_entity
    _LOGGER.debug(f"[SETUP] Registered entity by IP {ip} in registry. Registry now contains: {list(_ENTITY_REGISTRY.keys())}")
    
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
from .light_services import (  # noqa: E402
    async_setup_light_services,
    async_remove_light_services,
)
