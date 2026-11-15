"""The light's life in Home Assistant: added, updated, checked and removed.

Owns LifecycleMixin: what happens when Home Assistant adds the light
(async_added_to_hass: its timers, the restore, the Matter link, the first
display drawn in the background), the hourly update of the clock's UTC
offset (async_update), the minute check of the lamp's Repairs and
connection (_async_check_problems, _async_publish_transport), a rename in
place (async_entity_id_changed) and the cleanup on removal
(async_will_remove_from_hass).
Used only as a mixin of :class:`YeelightCubeLight` (light.py).
"""
import logging
import asyncio
import time
from datetime import timedelta
from homeassistant.core import callback # type: ignore
from homeassistant.helpers.event import (
    async_track_time_change,
    async_track_time_interval,
)
from .const import MODE_CLOCK
from .issues import lamp_problems, power_cycle_reason, report_problems
from .mount_profile import SOURCE_UNKNOWN
from .light_power import LAMP_POWER_INTERVAL

_LOGGER = logging.getLogger(__name__)


class LifecycleMixin:
    """The light's life in Home Assistant (light_lifecycle.py)."""

    async def async_added_to_hass(self):
        _LOGGER.debug("[INIT] async_added_to_hass called for %s", self._lamp_name)
        await super().async_added_to_hass()
        # The clock's UTC offset changes on the hour (daylight saving time):
        # async_update checks it then, a few seconds past, instead of a poll
        # every 30 s.
        self.async_on_remove(async_track_time_change(
            self.hass, self._async_hourly_update, minute=0, second=5
        ))
        # Repairs for problems a user can fix (issues.py), every minute.
        self._added_at = time.monotonic()
        self._reported_problems = None
        self.async_on_remove(async_track_time_interval(
            self.hass, self._async_check_problems, timedelta(minutes=1)
        ))
        self._lamp_client.on_transport_change = self._async_publish_transport
        self.async_on_remove(lambda: setattr(self._lamp_client, "on_transport_change", None))
        self._lamp_client.on_stream_change = self._streams_changed
        self.async_on_remove(lambda: setattr(self._lamp_client, "on_stream_change", None))

        # Start periodic health check to detect devices coming back online
        self._health_check_task = self._create_tracked_task(
            self._periodic_health_check(), name=f"yeelight_cube_health_check_{self._ip}"
        )
        # Estimated power in the lamp's own modes: a cheap periodic sample of the
        # simulated preview frame (one 100-pixel estimate per interval).
        self._lamp_power_unsub = async_track_time_interval(
            self.hass, self._sample_lamp_power,
            timedelta(seconds=LAMP_POWER_INTERVAL),
        )
        
        _LOGGER.debug("[INIT] Initial state - custom_text: '%s', mode: '%s', is_on: %s, brightness: %s", self._custom_text, self._mode, self._is_on, self._brightness)
        old_state = await self._last_settings()
        self._drop_extended_effects_option()
        _LOGGER.debug("[RESTORE] old_state exists: %s", old_state is not None)
        if old_state:
            self._restore_state(old_state)
            # A button's or another app's content when Home Assistant stopped:
            # the lamp keeps it, not redrawn below.
            self._external_display = bool(old_state.attributes.get("external_display"))
        self._restore_music_flow_runtime_state()
        self._restore_favourites()
        self._restore_rotation_settings()
        self._restore_drawing()
        # Palettes and pixel arts are shared: __init__.py loads them into
        # hass.data[DOMAIN] (the palette and pixel art sensors publish them).
        self.async_schedule_update_ha_state()
        # Push freshly restored values to every linked helper entity. On a
        # reload (e.g. a DHCP IP change) a helper may have been added before
        # this restore ran; without this its control shows the default.
        self._refresh_linked_entities()
        # The lamp's Matter node, when it has one (light_matter.py): after the
        # restore, so the lamp's reports apply to the restored state.
        self._start_matter_link()
        # A Cube Matrix is mounted as its rotation_angle says (read at setup;
        # Matter reports follow, light_matrix).
        if self.is_cube_matrix:
            self._matrix_rotated(self._lamp_client.profile.rotation, start=True)
        
        _LOGGER.debug("[INIT] After state restoration - custom_text: '%s', mode: '%s', is_on: %s", self._custom_text, self._mode, self._is_on)
        _LOGGER.debug("[INIT] Calling initial async_apply_display_mode to display HELLO...")
        
        # Apply initial display mode to show HELLO
        # Use 'turn_on' type so this isn't blocked by the retry limit after HA restart
        if self._is_on and self._music_flow_enabled:
            _LOGGER.debug(
                "[INIT] Music flow was active before restart; preserving renderer"
            )
        elif self._external_display:
            _LOGGER.debug("[INIT] The lamp shows another app's content: not redrawn")
        elif not self._is_on:
            _LOGGER.debug("[INIT] Light is off, not applying display mode")
        draw = self._is_on and not self._music_flow_enabled and not self._external_display
        if draw or self._rotation_restore:
            # In the background: adding the light never waits for the lamp. A
            # lamp that accepts connections but answers nothing would hold the
            # setup of its whole entry past Home Assistant's limit (60 s), and
            # the entry would not load at all.
            self._create_tracked_task(
                self._async_start_display(draw),
                name=f"yeelight_cube_start_display_{self._ip}",
            )

    async def _async_start_display(self, draw: bool) -> None:
        """What the lamp showed before Home Assistant started, drawn again
        (``draw``), then the saved rotation resumed, in that order
        (async_added_to_hass)."""
        if draw:
            try:
                await self.async_apply_display_mode(update_type='turn_on')
            except Exception as err:  # noqa: BLE001 -- the health check follows the lamp
                _LOGGER.warning("[INIT] [%s] Could not draw the restored display: %s", self._ip, err)
        if self._rotation_restore:
            await self._async_resume_saved_rotation()

    async def async_will_remove_from_hass(self):
        """Clean up when entity is removed"""
        self.stop_scroll_timer()
        self.stop_studio_stream()
        if self._lamp_power_unsub is not None:
            self._lamp_power_unsub()
            self._lamp_power_unsub = None

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
        self._lamp_client.close()
        _LOGGER.debug("[CLEANUP] Stopped scroll timer and background tasks on entity removal")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): the lamp keeps running
        # as it is (display, rotation, timers); the services find it by its
        # live entity id (light_services_common._lamp_for), so nothing is
        # re-keyed here.
        super().async_entity_id_changed(old_entity_id)


    async def _async_hourly_update(self, _now) -> None:
        await self.async_update()

    @callback
    def _async_publish_transport(self) -> None:
        """Write the state when its "connection" attribute is out of date:
        commands switched between UDP and TCP without a state change (UDP
        failed or answers again: LampClient.on_transport_change; the TCP
        fallback or force_tcp ran out: the minute check)."""
        if self.hass is not None and self._lamp_client.transport != self._published_transport:
            self.async_write_ha_state()

    @callback
    def _async_check_problems(self, _now=None) -> None:
        """Show or clear the lamp's Repairs (issues.py), and publish a
        connection that changed with time (_async_publish_transport)."""
        self._async_publish_transport()
        self._refresh_matter_link()
        self._check_matrix_demo()
        # Matter failed a while ago (light_matrix): tried again.
        self._retry_matrix_native()
        problems = lamp_problems(
            self._lamp_client.connection_state(), self.available,
            time.monotonic() - self._added_at,
            lan_control_off=self.matter_lan_control_off,
            # A Cube Matrix's orientation is its rotation_angle, read over the
            # LAN: never unknown.
            orientation_unknown=self.mount_profile[1] == SOURCE_UNKNOWN and not self.is_cube_matrix,
            demo_mode=self.matrix_demo_mode,
            factory_modules=self.matrix_factory_modules,
            firmware_too_old=self.device_profile.firmware_too_old,
        )
        self._reported_problems = report_problems(
            self.hass, self, problems, self._reported_problems
        )
        reason = power_cycle_reason(problems)
        if reason != self.power_cycle_reason:
            self.power_cycle_reason = reason
            self._notify("power_cycle")

    async def async_update(self, *args, **kwargs):
        """Refresh the clock's UTC offset (daylight saving time): once when
        the light is added, then on the hour (_async_hourly_update)."""
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
