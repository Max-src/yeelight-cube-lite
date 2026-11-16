"""The Yeelight Cube light entity: YeelightCubeLight and its platform setup.

Owns YeelightCubeLight, the light entity composed of the light_*.py mixins
(the MODULE MAP below says which concern each holds), with what is the
entity's core: its construction (__init__, calling every mixin's
_init_*_state), the state write that keeps its controls and power estimate
in step (async_write_ha_state), its device info and profile, its background
tasks, the pixel art it shows, and the light platform's setup
(async_setup_entry), with the lamps the services find (_ENTITY_REGISTRY).
"""
import logging
import asyncio
import time
import voluptuous as vol # type: ignore
from homeassistant.components.light import LightEntity # type: ignore
from homeassistant.helpers.restore_state import RestoreEntity # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from .device_profile import CUBE_LITE_PROFILE, model_key
from .const import (
    CONF_MODEL,
    CONF_MODEL_PROBE_MISSES,
    MODEL_PROBE_STARTS,
    CONF_DEVICE_ID,
    CONF_IP,
    LAN_PORT,
    DOMAIN,
)
from .lamp_client import LampClient
from .entity import cube_device_info
from .pixel_art_storage import expand_pixels
from .light_color import ColorPipelineMixin
from .light_native import NativeModesMixin
from .light_music_flow import MusicFlowMixin
from .light_studio import StudioStreamMixin
from .light_render import MatrixRenderMixin
from .light_connection import ConnectionMixin, _DEVICE_LOCKS, _DEVICE_LOCK_HOLDERS
from .light_link_recovery import LinkRecoveryMixin
from .light_restore import StateRestoreMixin
from .light_rotation import RotationMixin
from .light_matter import MatterMixin
from .light_matter_remote import RemoteButtonsMixin
from .light_matter_restore import LampRestoreMixin
from .light_matter_rotation import MatterRotationMixin
from .light_matrix import MatrixMixin
from .light_matrix_follow import MatrixFollowMixin
from .light_matrix_settings import MatrixSettingsMixin
from .light_mount_profile import MountProfileMixin
from .light_brightness import BrightnessMixin
from .light_display import DisplayMixin
from .light_state import LightStateMixin
from .light_actions import ActionsMixin
from .light_attributes import AttributesMixin
from .light_lifecycle import LifecycleMixin
from .light_onoff import OnOffMixin
from .light_power import PowerEstimateMixin
from .light_settings import SettingsMixin

_LOGGER = logging.getLogger(__name__)
# A setup read (async_setup_entry) this slow (s) is warned about, naming it.
SETUP_STEP_SLOW = 10.0

# No limit per platform: every command to the lamp already waits for the
# previous one (the device lock, light_connection._execute_hardware_op).
PARALLEL_UPDATES = 0
_LOGGER.debug("Yeelight Cube Lite light.py module loaded")

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
#     __init__, the state write (async_write_ha_state), device info and
#     profile, background tasks, the pixel art shown, linked-entity sync, and
#     the platform setup (async_setup_entry).
#
#   light_attributes.py (AttributesMixin)    — the entity's properties and
#                        extra_state_attributes (what the cards read), the
#                        settings saved apart for a restart.
#   light_lifecycle.py  (LifecycleMixin)      — HA lifecycle: added
#                        (timers, restore, first display), hourly update,
#                        the minute Repairs check, removal.
#   light_onoff.py      (OnOffMixin)          — turn_on/off, direct mode
#                        (ensure_fx_ready), the forced refresh.
#   light_power.py      (PowerEstimateMixin)  — the estimated power and
#                        energy the sensors show.
#   light_settings.py   (SettingsMixin)       — font, orientation and device
#                        orientation, alignment, animation layout, power-on
#                        state, physical-button presets.
#   light_state.py      (LightStateMixin)     — what the light shows and
#                        what the lamp is in (their only writer: named
#                        transitions), and the controls listening to it.
#   light_actions.py    (ActionsMixin)        — the public API the controls
#                        (select.py, ...) and actions (light_services_*) use;
#                        by kind of action in light_actions_display.py,
#                        light_actions_native.py and light_actions_diagnostics.py.
#   light_display.py    (DisplayMixin)        — the display queue
#                        (async_apply_display_mode and its central rules), the
#                        frame sender (apply()) and the text scroll timer.
#   light_brightness.py (BrightnessMixin)     — set_brightness (the lamp's
#                        hardware brightness) and the brightness fast path.
#   light_color.py      (ColorPipelineMixin)  — color adjustment/correction/
#                        accuracy maths + the brightness mapping.
#   light_native.py     (NativeModesMixin)    — built-in Clock + native-effect
#                        activation (set_fx_effect payloads), Music Flow.
#   light_studio.py     (StudioStreamMixin)   — the Studio color mode's
#                        stream (an effect drawn here, sent frame by frame).
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
#   light_mount_profile.py (MountProfileMixin) — the lamp's saved mount
#                        profile (options, Matter), the Fire check.
#   light_services*.py                        — entity-facing actions
#                        (registered by async_setup_light_services, re-exported
#                        from the bottom of this file).
#
# async_setup_entry (below the class) is the HA light-platform setup and stays
# here by convention.
# ─────────────────────────────────────────────────────────────────────────────

class YeelightCubeLight(
    AttributesMixin,
    LifecycleMixin,
    OnOffMixin,
    PowerEstimateMixin,
    SettingsMixin,
    LightStateMixin,
    ActionsMixin,
    DisplayMixin,
    BrightnessMixin,
    ColorPipelineMixin,
    NativeModesMixin,
    MusicFlowMixin,
    StudioStreamMixin,
    MatrixRenderMixin,
    ConnectionMixin,
    LinkRecoveryMixin,
    StateRestoreMixin,
    RotationMixin,
    MatterMixin,
    RemoteButtonsMixin,
    LampRestoreMixin,
    MatterRotationMixin,
    MatrixMixin,
    MatrixFollowMixin,
    MatrixSettingsMixin,
    MountProfileMixin,
    LightEntity,
    RestoreEntity,
):
    """Home Assistant LightEntity for the Yeelight Cube Lite."""

    # Never polled: the lamp's state cannot be read back (async_update), and
    # the clock's UTC offset is checked on the hour (async_added_to_hass).
    _attr_should_poll = False

    # Published for the cards but not stored in the recorder's history: large
    # (the 100 matrix colors, the effect catalogue), frequently changing
    # (rotation status), or configuration with no use as history (calibration).
    _unrecorded_attributes = frozenset({
        "matrix_colors",
        "native_effect_catalog",
        "favourites",
        "rotation_intervals",
        "effect_rotation",
        "matter",
        "external_display",
        "mount_profile",
        "button_effects",
        "last_hardware_brightness",
        "calib_gamma_r", "calib_gamma_g", "calib_gamma_b",
        "calib_hw_threshold", "calib_hw_full", "calib_channel_balance",
        "calib_gain_r", "calib_gain_g", "calib_gain_b",
    })

    @property
    def device_info(self):
        return cube_device_info(self)

    @property
    def device_profile(self):
        """The lamp model's geometry and commands (device_profile): a Cube
        Matrix streams what a Cube Lite draws itself."""
        return getattr(self._lamp_client, "profile", None) or CUBE_LITE_PROFILE

    def __init__(self, lamp_client: LampClient, ip: str, config_entry: ConfigEntry):
        # _palettes and _pixel_arts are now @property methods accessing global storage
        self._lamp_client = lamp_client
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
        # The lamp's name, its device's (entity.cube_device_info): the light
        # is the device's main entity, so it has no name of its own and Home
        # Assistant shows the device's; the other entities add theirs to it.
        self._lamp_name = f"{lamp_client.device_name} {short_id}"
        self._attr_has_entity_name = True
        self._attr_name = None

        # --- Stable unique_id (entry_id-based, never changes across IP changes) ---
        # The config entry's entry_id is assigned once and stays constant even when
        # the stored IP is updated by rediscovery / zeroconf.
        self._attr_unique_id = f'yeelight_cube_{config_entry.entry_id}'
        self._is_on = True
        self._brightness = 255  # Store brightness as 0-255 internally
        
        # Each mixin's own state (light_*.py, _init_*_state). __init__ reads
        # no instance attribute, so their order changes nothing.
        self._init_light_state()
        self._init_native_actions_state()
        self._init_diagnostic_actions_state()
        self._init_display_state()
        self._init_render_state()
        self._init_native_state()
        self._init_mount_profile_state()
        self._init_connection_state()
        self._init_rotation_state()
        self._init_matter_state()
        self._init_matrix_state()
        self._init_brightness_state()
        self._init_color_state()
        self._init_saved_state()
        self._init_studio_state()
        self._init_power_state()

        # Track background tasks (fire-and-forget brightness commands)
        self._background_tasks = set()
        
        # The Power cycle sensor (binary_sensor.py) and what it shows:
        # the Repairs issue a power cycle fixes, set by _async_check_problems.
        self.power_cycle_reason = None

        # Camera entity references -- set by camera.py async_setup_entry.
        # Used for direct push notifications (bypass state-change-event delay).
        self._camera_entities: list = []

        # Helper entities that control the lamp (entity.CubeControlEntity).
        # Their availability follows the lamp's, so they are rewritten when
        # the published availability changes.
        self._control_entities: set = set()
        self._published_available = None
        # The connection in the published state (its "connection" attribute).
        self._published_transport = None
        # When Home Assistant added the light (async_added_to_hass), and the
        # Repairs issues it reported last (_async_check_problems).
        self._added_at = None
        self._reported_problems = None

    @callback
    def async_write_ha_state(self) -> None:
        self._published_transport = self._lamp_client.transport
        super().async_write_ha_state()
        available = self.available
        if available != self._published_available:
            self._published_available = available
            for entity in self._control_entities:
                if entity.hass is not None:
                    entity.async_write_ha_state()
        if (
            self.lamp_draws_matrix
            and self._lamp_power_state() != self._lamp_power_key
        ):
            self._sample_lamp_power()  # what the lamp draws changed
        self._publish_power()

    def _notify_camera_preview(self) -> None:
        """Tell every camera entity the lamp shows a new frame: it drops its
        image and bumps its access token, and renders the new one only when a
        viewer fetches it (camera.py async_refresh_preview)."""
        for cam in self._camera_entities:
            try:
                cam.async_refresh_preview()
            except Exception:  # noqa: BLE001 -- a camera's failure never stops the lamp's frames
                _LOGGER.warning(
                    "[%s] Camera preview notification failed", self._ip, exc_info=True,
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

    async def show_pixel_art(self, name: str | None, pixels: list, bypass_lock: bool = False) -> None:
        """Show a pixel art (saved, stored grouped, or built-in, flat) as the
        lamp's drawing, named ``name`` (None: a drawing that is not one of
        the pixel arts); the pixel art and mode selects follow. Used by the
        apply_pixel_art and apply_custom_pixels actions and the Pixel Art
        select."""
        self._custom_pixels = expand_pixels(pixels)
        self._enter_mode("Custom Draw", matrix_mode="Custom Draw", custom_draw=True)
        self._active_pixel_art_name = name
        if not self._custom_text:
            self._custom_text = "HELLO"
        # A drawing does not scroll.
        self._scroll_offset = 0
        self._scroll_direction = 1
        self.stop_scroll_timer()
        self._set_scrolling(False)
        # Written now: a lamp that is off keeps the drawing for when it is
        # turned on, without drawing (so without writing its state).
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        await self.async_apply_display_mode(update_type="pixel_art", bypass_lock=bypass_lock)
        self._notify("pixel_art", "display_mode", "content_mode")
    
    def _sync_rgb_color(self):
        """Synchronize _rgb_color with the first color in _text_colors"""
        if self._text_colors and len(self._text_colors) > 0:
            self._rgb_color = self._text_colors[0]
            _LOGGER.debug("[SYNC] Synchronized _rgb_color to %s from text_colors", self._rgb_color)

    def _should_auto_turn_on(self) -> bool:
        """Check if lamp should auto-turn-on when receiving commands while off."""
        if not self._config_entry:
            # Default to True (current behavior) if no config entry
            return True
        # Get from options, default to True
        return self._config_entry.options.get("auto_turn_on", True)

    # Entity-facing service handlers are registered once from component setup.

    def _refresh_linked_entities(self):
        """Push the current state out to the lamp's controls (every
        CubeControlEntity registers in _control_entities), so they reflect
        restored values."""
        for ref in self._control_entities:
            if ref is not None and getattr(ref, "hass", None) is not None:
                update = getattr(ref, "async_update_from_light", None)
                if update:
                    update()
                else:
                    ref.async_write_ha_state()


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> bool:
    # Create and register the light entity FIRST (this happens for EVERY device)
    ip = entry.data[CONF_IP]
    port = entry.data.get('port', LAN_PORT)
    
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
            "This causes two LampClient instances fighting each other -- "
            "remove the duplicate in Settings -> Integrations.",
            ip, [e.entry_id for e in same_ip_entries]
        )
    
    # TCP reachability has already been verified in __init__.py's
    # async_setup_entry (which is where ConfigEntryNotReady is effective).
    _LOGGER.debug("[SETUP] Creating LampClient for %s:%s", ip, port)
    lamp_client = LampClient(ip, port)
    
    async def timed(step: str, func, *args):
        """A blocking setup read (an executor), warned about when slow: Home
        Assistant gives up on a platform after 60 s (2026-11-14: a Cube
        Matrix whose LAN was stuck never finished its setup)."""
        started = time.monotonic()
        try:
            return await hass.async_add_executor_job(func, *args)
        finally:
            took = time.monotonic() - started
            if took >= SETUP_STEP_SLOW:
                _LOGGER.warning("[SETUP] [%s] %s took %.1f s", ip, step, took)

    # Fetch capabilities in executor to avoid blocking the event loop
    _LOGGER.debug("[SETUP] Fetching capabilities for %s in executor", ip)
    await timed("Reading its capabilities", lamp_client.fetch_capabilities)
    # The model (device_profile): SSDP's, else the one the entry was added
    # with (SSDP can be unavailable, e.g. in a container without multicast);
    # an entry made before models were told apart learns it here: from SSDP,
    # else from the lamp itself (probe_model: a Cube Matrix answers get_prop).
    stored_model = entry.data.get(CONF_MODEL)
    if model_key(lamp_client.device_model) != model_key(stored_model):
        if not lamp_client.capabilities.get("model") and model_key(stored_model) is not None:
            await timed("Reading its layout", lamp_client.set_model, stored_model)
        elif lamp_client.capabilities.get("model"):
            hass.config_entries.async_update_entry(
                entry, data={**entry.data, CONF_MODEL: lamp_client.capabilities["model"]}
            )
        else:
            model = await timed("Asking its model", lamp_client.probe_model)
            # No answer is stored as a Cube Lite only after MODEL_PROBE_STARTS
            # starts (a Cube Matrix can answer late; a Cube Lite never answers,
            # and is not asked at every start forever).
            misses = 0 if model else int(entry.data.get(CONF_MODEL_PROBE_MISSES, 0)) + 1
            if not model and misses >= MODEL_PROBE_STARTS:
                model = "CubeLite"
            data = {key: value for key, value in entry.data.items() if key != CONF_MODEL_PROBE_MISSES}
            if model:
                hass.config_entries.async_update_entry(entry, data={**data, CONF_MODEL: model})
            else:
                hass.config_entries.async_update_entry(entry, data={**data, CONF_MODEL_PROBE_MISSES: misses})
    _LOGGER.debug(
        "[SETUP] %s is a %s (%s modules), creating light entity",
        ip, lamp_client.profile.name, lamp_client.profile.modules,
    )
    
    light_entity = YeelightCubeLight(lamp_client, ip, entry)
    
    # Register the lamp for the services (by IP: see _ENTITY_REGISTRY).
    _ENTITY_REGISTRY[ip] = light_entity
    _LOGGER.debug("[SETUP] Registered lamp %s for the services (lamps: %s)", ip, list(_ENTITY_REGISTRY))
    
    async_add_entities([light_entity], update_before_add=True)
    
    # For the other platforms, set up after this one (runtime_data.lamp_of).
    entry.runtime_data.light = light_entity
    return True


# Service registration lives in light_services.py; re-exported here so
# `from .light import async_setup_light_services` keeps working. Imported at
# the very bottom so light_services can import back from a fully-defined light.
from .light_services import async_setup_light_services  # noqa: E402,F401 -- re-export used by __init__.py
