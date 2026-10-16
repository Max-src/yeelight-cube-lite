import logging
import asyncio
import base64
import functools
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
from .const import (
    DEFAULT_DEVICE_ORIENTATION,
    DEVICE_ORIENTATIONS,
    DEVICE_ORIENTATION_TO_FLIP,
    FIRMWARE_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
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
    NATIVE_CLOCK_CONTENT_BYTE,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECTS,
    ORIENTATION_FLIPPED,
    ORIENTATION_NORMAL,
    DEFAULT_POWER_ON_STATE,
    POWER_ON_STATES,
)
from .lamp_power import BASE_W, NO_LIMIT_W, estimated_power
from .cube_matrix import (
    CubeConnectionError,
    CubeMatrix,
    is_quota_error,
)
from .entity import cube_device_info
from .layout import Layout, Module, FONT_MAPS

from .color_utils import hex_to_rgb, rgb_to_hex
from .light_color import ColorPipelineMixin
from .light_native import NativeModesMixin
from .light_render import MatrixRenderMixin
from .light_connection import ConnectionMixin, _DEVICE_LOCKS, _DEVICE_LOCK_HOLDERS
from .light_restore import StateRestoreMixin
from .light_rotation import RotationMixin
from .light_brightness import BrightnessMixin
from .light_display import DisplayMixin

_LOGGER = logging.getLogger(__name__)
_LOGGER.debug("Yeelight Cube Lite light.py module loaded")

# Estimated power in firmware modes (clock, native effects, Music Flow): the
# simulated frame is sampled every FIRMWARE_POWER_INTERVAL seconds and the
# sensor shows the average of the last FIRMWARE_POWER_SAMPLES (30 s).
FIRMWARE_POWER_INTERVAL = 5
FIRMWARE_POWER_SAMPLES = 6

# NOTE: Per-entity and global pixel art throttle REMOVED.
# The gradient card sends identical update_leds commands rapidly without
# any throttle and works perfectly.  The throttle was actually causing
# sticking: multi-second delays let sockets go stale -> RST + reconnect
# timeout -> retry storm -> lamp stuck for 20-30s.
# JS 300ms debounce provides sufficient rate limiting.

# The lamps, for the services: keyed by IP (fixed for a lamp's lifetime: an
# IP change reloads its entry). A service finds a lamp by its *live*
# entity_id (light_services_common._lamp_for), never by a stored id, so a
# renamed lamp (in place from Home Assistant 2026.11) is found under its new
# id only, and its old id can never reach it -- even once another lamp takes
# that id (two lamps' names swapped). Rules: docs/ENTITY_IDS.md.
_ENTITY_REGISTRY = {}


@functools.lru_cache(maxsize=8)
def _native_effect_catalog(extended_enabled: bool, playing_extended: str | None) -> list:
    """The native effects the cards list (11 KB): built once per
    combination instead of on every state write. Shared, never modified."""
    return [
        {"name": name, "speed": bool(spec.get("speed")),
         "directions": list(spec.get("directions", ())),
         "extended": bool(spec.get("extended")),
         "preview": not name.isdecimal()}
        for name, spec in ALL_NATIVE_EFFECTS.items()
        if not spec.get("extended") or extended_enabled or name == playing_extended
    ]


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
    _ENTITY_REGISTRY.pop(ip, None)
    # Remove per-device lock
    _DEVICE_LOCKS.pop(ip, None)
    _DEVICE_LOCK_HOLDERS.pop(ip, None)


# ─────────────────────────────────────────────────────────────────────────────
# MODULE MAP — YeelightCubeLight
# The entity is composed from mixins so each concern lives in its own file. The
# concrete class below inherits them all; every mixin operates purely on ``self``
# (state initialised in __init__ here), so behaviour is identical to one class.
#
#   light.py (this file) — core entity:
#     __init__, HA lifecycle (async_added_to_hass / async_will_remove_from_hass
#     / async_update), public properties + control setters (orientation,
#     alignment, font…), extra_state_attributes, ensure_fx_ready,
#     turn_on/off, physical-button presets and linked-entity sync.
#
#   light_display.py    (DisplayMixin)        — the display queue
#                        (async_apply_display_mode and its central rules), the
#                        frame sender (apply()) and the text scroll timer.
#   light_brightness.py (BrightnessMixin)     — set_brightness (the lamp's
#                        hardware brightness) and the brightness fast path.
#   light_color.py      (ColorPipelineMixin)  — color adjustment/correction/
#                        accuracy maths + the brightness mapping.
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
    DisplayMixin,
    BrightnessMixin,
    ColorPipelineMixin,
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
    })

    @property
    def font(self):
        return self._font

    async def set_font(self, font: str):
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
        self._power_on_state = DEFAULT_POWER_ON_STATE
        self._button_effects = []
        
        # Each mixin's own state (light_*.py, _init_*_state). __init__ reads
        # no instance attribute, so their order changes nothing.
        self._init_scroll_state()
        self._init_connection_state()
        self._init_rotation_state()
        self._init_brightness_state()
        self._init_color_state()
        self._init_saved_state()

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

        # Apply timing (for queue processor stats, not cooldown-gating)
        self._last_apply_time = 0
        
        # Track background tasks (fire-and-forget brightness commands)
        self._background_tasks = set()
        
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
        
        # The frame with its color effects, before the lamp-only stages
        # (low-brightness correction, per-channel accuracy): snapshotted in
        # apply(), published as matrix_colors and re-sent by the brightness
        # fast path.
        self._base_matrix_colors = None
        
        # Power limit in W (NO_LIMIT_W = off): frames sent to the lamp are
        # dimmed so its estimated draw stays under it, for weak or shared
        # power supplies (lamp_power.py).
        self._power_limit = NO_LIMIT_W
        # Estimated draw of the last frame sent (None until one is sent).
        self._last_frame_power = None
        self._power_sensor = None
        # Estimated energy (kWh): told every power change (_publish_power).
        self._energy_sensor = None
        self._published_power = None
        # Firmware modes (clock, native effect, Music Flow): estimates of the
        # simulated preview frame, sampled every FIRMWARE_POWER_INTERVAL and
        # averaged; cleared when what the firmware draws changes.
        self._firmware_power_samples = deque(maxlen=FIRMWARE_POWER_SAMPLES)
        self._firmware_power_key = None
        self._firmware_power_unsub = None


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
        """Write the Estimated power sensor when its value changed, and
        let the Estimated energy sensor count the energy until then."""
        power = self.estimated_power
        if power != self._published_power:
            self._published_power = power
            sensor = self._power_sensor
            if sensor is not None and sensor.hass is not None:
                sensor.async_write_ha_state()
            if self._energy_sensor is not None:
                self._energy_sensor.power_changed(power)

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
            desired = DEVICE_ORIENTATION_TO_EFFECT_DIR.get(orientation)
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
            # {"service", "message", "at"} of the last change this lamp failed
            # to apply, until one succeeds (light_services_common
            # note_command_result); the cards name it.
            "last_command_error": self._last_command_error,
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
            "native_effect_catalog": _native_effect_catalog(
                self._extended_effects_enabled,
                # An experimental effect still listed while it plays.
                self._native_effect
                if ALL_NATIVE_EFFECTS.get(self._native_effect, {}).get("extended")
                else None,
            ),
            "extended_effects_enabled": self._extended_effects_enabled,
            "music_flow_enabled": self._music_flow_enabled,
            "music_flow_effect": self._music_flow_effect,
            "music_flow_restore_power": self._music_flow_restore_power,
            "power_on_state": self._power_on_state,
            # How commands reach the lamp: "udp" (its UDP session) or "tcp".
            "connection": self._cube_matrix.transport,
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
            "last_hardware_brightness": self._last_hardware_brightness,
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
        matrix. The colors are not scaled by the brightness: the lamp dims in
        hardware, and the cards scale them by the published brightness
        themselves (set_brightness() writes the state first, so they preview
        a brightness drag at once, before the lamp round trip).
        _base_matrix_colors has the color effects but not the lamp-only
        stages (low-brightness correction, per-channel accuracy).
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
                return list(base_colors)
            # Fallback: read directly from module data
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

        # Every socket to the lamp, the UDP session's too.
        self._cube_matrix.close()
        _LOGGER.debug("[CLEANUP] Stopped scroll timer and background tasks on entity removal")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): the lamp keeps running
        # as it is (display, rotation, timers); the services find it by its
        # live entity id (light_services_common._lamp_for), so nothing is
        # re-keyed here.
        super().async_entity_id_changed(old_entity_id)

    # Entity-facing service handlers are registered once from component setup.

    async def ensure_fx_ready(self):
        """Ensure FX mode is active: activate_fx_mode in the lamp's UDP session
        (where the frames then go too: direct mode applies to the session it
        was activated in), else on one fresh TCP connection.

        Steps:
          1. Close any existing persistent TCP socket (clean slate)
          2. Optional 300ms settle when leaving a firmware-native mode
          3. Send activate_fx_mode (UDP session, else a fresh TCP connection, RST-closed)
          4. Sleep 150ms -- firmware settle time before opening the persistent socket
          5. Update state flags

        The lamp's hardware brightness is left as it is (and as known):
        apply() sends set_bright before its frames only when it differs (or
        is unknown). A set_bright after frames in direct mode can make the
        lamp show an older picture again (see cube_matrix.FRAME_SETTLE_DELAY),
        so activating direct mode again never forces one. Over TCP, apply()
        sends it on the persistent socket, with the frames: an extra RST
        connection made the firmware exit direct mode before update_leds
        arrived ("illegal request" errors).

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

        # Step 5: Update state (the hardware brightness is unchanged).
        self._fx_mode_is_direct = True
        self._in_native_fw_mode = False
        self._last_fx_mode_time = time.time()
        # Direct mode is active again on the transport in use: a reconnection
        # noticed before this (e.g. UDP falling back to TCP) is settled, and
        # must not make the next frame report direct mode as lost.
        cm.consume_reconnected_flag()

        _LOGGER.debug(
            "[ENSURE_FX] [%s] [OK] FX activated", self._ip
        )

    async def _force_refresh_impl(self):
        """Force refresh implementation - runs inside _execute_hardware_op lock.
        
        Reconnects the active renderer and re-renders its current display.
        
        It re-renders through _apply_display_mode_internal() rather than
        re-sending self._layout: apply() writes the lamp-only stages (color
        effects, low-brightness correction) into the layout, so they would
        be applied twice. Since ensure_fx_ready() already set
        _fx_mode_is_direct=True, apply() skips a second activation.
        """
        if not self._is_on or self._music_flow_enabled:
            return
        if self._mode in FIRMWARE_MODES:
            self._cube_matrix.close_fast_socket()
        else:
            # Its brightness is confirmed too (sent right after direct mode,
            # before any frame): something else may have changed it.
            self._last_hardware_brightness = None
            await self.ensure_fx_ready()
        
        # Re-render through the full display pipeline (see the docstring).
        await self._apply_display_mode_internal()
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
        
        # Direct mode first (apply() then sends the brightness, if it differs,
        # before the frames).
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
                _LOGGER.debug("[TURN_ON] Setting brightness to %s", kwargs["brightness"])
                self._brightness = kwargs["brightness"]
            self._brightness = max(1, min(255, self._brightness))
            # The full display in one pass: direct mode if needed, the
            # brightness if it changed (before any frame), then the frame --
            # also when only the brightness is new (the lamp was showing black).
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
            # Powered off: its brightness is set again on the way back.
            self._last_hardware_brightness = None
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
        # In direct mode "off" is a black picture: the lamp's hardware
        # brightness is unchanged, so it is not sent again when it comes back
        # on (a set_bright after frames can bring an older picture back).
        self._last_apply_time = 0  # Reset cooldown timer to ensure turn_on will work immediately
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug("[TURN_OFF] Turn off complete")

    async def async_update(self, *args, **kwargs):
        """Refresh the clock's UTC offset (daylight saving time)."""
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

        # The lamp's state is never read back: Cube Lite answers no get_prop,
        # over TCP or UDP, for any property. The component's own state is the
        # only source of truth.

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

    def _refresh_linked_entities(self):
        """Push the current state out to the lamp's controls (every
        CubeControlEntity registers in _control_entities) and the
        Experimental Features switch, so they reflect restored values."""
        for ref in (*self._control_entities, self._extended_effects_switch_entity):
            if ref is not None and getattr(ref, "hass", None) is not None:
                update = getattr(ref, "async_update_from_light", None)
                if update:
                    update()
                else:
                    ref.async_write_ha_state()


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
    
    # Register the lamp for the services (by IP: see _ENTITY_REGISTRY).
    _ENTITY_REGISTRY[ip] = light_entity
    _LOGGER.debug("[SETUP] Registered lamp %s for the services (lamps: %s)", ip, list(_ENTITY_REGISTRY))
    
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
from .light_services import async_setup_light_services  # noqa: E402,F401 -- re-export used by __init__.py
