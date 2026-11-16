"""A Cube Matrix's reports followed: what it shows, its restarts and its
rotation.
"""
from __future__ import annotations

import asyncio
import dataclasses
import logging
import time

from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
)
from .matrix_effects import (
    CLOCK_EFFECT,
)
from .light_matrix import (
    MATRIX_ECHO_WINDOW,
    MATRIX_RESTART_FALLBACK,
    MATRIX_RESTART_WINDOW,
    matrix_effect_name,
)

_LOGGER = logging.getLogger(__name__)


class MatrixFollowMixin:
    """Following a Cube Matrix (its reports, restarts and rotation)."""

    # ── Following the lamp ──────────────────────────────────────────────
    def _matrix_echo(self) -> bool:
        return time.monotonic() - self._matrix_command_at < MATRIX_ECHO_WINDOW

    def _on_matrix_report(self, name: str, value, initial: bool) -> None:
        """A value a Cube Matrix reports (matter_link.MATRIX_REPORTED)."""
        if name == "reboot_count":
            # Also when the link is made again (initial): the node can be
            # linked anew after the lamp was away.
            if isinstance(value, int) and not isinstance(value, bool):
                previous, self._matrix_reboots = self._matrix_reboots, value
                if previous is not None and value != previous:
                    self._matrix_lamp_restarted()
            return
        if not initial:
            if name == "running_effect":
                values = self._matter.values if self._matter else {}
                if value == self._matrix_sent_id:
                    # What Home Assistant started (a report can come late:
                    # seen 31 s after the command, 2026-11-10).
                    pass
                elif self._matrix_just_restarted():
                    # The effect the lamp starts with (its saved one), not
                    # its button: Home Assistant's content is shown again.
                    pass
                elif not self._matrix_echo():
                    # Someone else (the button, the app, the demo loop).
                    self._matrix_shown = None
                    if self._matrix_demo_watch.running_changed(time.monotonic(), values.get("effect")):
                        self._set_matrix_demo(matter=True)
                    else:
                        self._matrix_followed(value)
            elif name == "effect" and value not in (0, None) and not self._matrix_echo():
                self._matrix_demo_watch.reset()
            elif name == "on_off" and isinstance(value, bool):
                if not self._power_echo(value):
                    self._lamp_switched(value)
            elif name == "level" and isinstance(value, int):
                if not self._matrix_echo() and not self._matter_echo():
                    self._lamp_dimmed(value)
            elif name == "rotation":
                self._matrix_rotated(value)
            elif name == "topology":
                self._matrix_modules_changed(value)
            elif name == "start_up_on_off":
                self._matrix_power_on = "off" if value == 0 else "on"
            elif name == "lan_control":
                self._async_check_problems()
        elif name == "rotation":
            lan = self._matrix_lan_rotation()
            if lan is not None and lan != value:
                # Home Assistant's Matter client keeps the value last reported
                # to it; a write is not reported back, so after a restart it
                # read 0 while the lamp ran 3 (2026-11-11): the lamp's own
                # answer (read over the LAN at setup, kept up to date) wins.
                _LOGGER.debug(
                    "[MATRIX] [%s] Rotation %s from Matter, %s from the lamp: the lamp's kept",
                    self._ip, value, lan,
                )
                if self._matter is not None:
                    self._matter.values["rotation"] = lan
                value = lan
            self._matrix_rotated(value, start=True)
        elif name == "topology":
            # The lamp's own answer over the LAN (read at setup) wins; when
            # its LAN could not be read (stuck, 2026-11-14), Matter's module
            # list is the layout: else the default 4 Matrix modules stayed.
            if "cube_topology" not in (getattr(self._lamp_client, "capabilities", None) or {}):
                self._matrix_modules_changed(value)
        elif name == "start_up_on_off":
            self._matrix_power_on = "off" if value == 0 else "on"
        if self.hass is not None:
            self.async_write_ha_state()

    def _matrix_followed(self, running) -> None:
        """The lamp started something itself (its button steps its playlist,
        or the Yeelight app): the light shows it as its effect or clock
        (nothing is sent). An effect it has no name for, a drawing or a
        colour (0) leaves the light as it is."""
        if self.matrix_demo_mode or not isinstance(running, int):
            return
        name = None
        if running == CLOCK_EFFECT:
            if self._mode == MODE_CLOCK:
                return
        else:
            name = matrix_effect_name(running)
            if name is None or (self._mode == MODE_NATIVE_EFFECT and self._native_effect == name):
                return
        self._matrix_followed_from = (time.monotonic(), self._mode, self._native_effect)
        if running == CLOCK_EFFECT:
            self._enter_mode(MODE_CLOCK)
        else:
            self._enter_mode(MODE_NATIVE_EFFECT)
            self._native_effect = name
        _LOGGER.info("[MATRIX] [%s] The lamp shows %s (its button or the app)", self._ip, running)
        if refresh := getattr(self, "_refresh_linked_entities", None):
            refresh()

    def matrix_redraw_waits_for_restart(self) -> bool:
        """Back after an outage, what the light shows goes over Matter,
        which reaches a restarted lamp only ~90 s after power-on (2026-11-11:
        the health check's redraws each waited 12 s and failed until then):
        the redraw is left to the lamp's restart report (or the fallback)."""
        if not self.is_cube_matrix or self._music_flow_enabled:
            return False
        if self._mode in (MODE_NATIVE_EFFECT, MODE_CLOCK):
            return self.matrix_native_command() is not None
        return self.matrix_draws_over_matter()

    def matrix_await_restart(self) -> None:
        """Called by the health check instead of its redraw: the restart
        report redraws (_matrix_lamp_restarted); without one within
        MATRIX_RESTART_FALLBACK, the content is sent again anyway."""
        if self._matrix_restart_seen:
            # Reported while the lamp was still away: Matter is back.
            self._matrix_restart_seen = False
            self._matrix_shown = None
            self._create_tracked_task(
                self.async_apply_display_mode(update_type="turn_on"),
                name=f"yeelight_cube_matrix_restarted_{self._ip}",
            )
            return
        self._matrix_redraw_due = True
        if self._matrix_fallback_task is not None and not self._matrix_fallback_task.done():
            return

        async def fallback() -> None:
            await asyncio.sleep(MATRIX_RESTART_FALLBACK)
            if not self._matrix_redraw_due:
                return
            self._matrix_redraw_due = False
            if not self._is_on:
                return
            _LOGGER.info("[MATRIX] [%s] No restart reported: Home Assistant's content sent again", self._ip)
            self._matrix_shown = None
            await self.async_apply_display_mode(update_type="turn_on")

        self._matrix_fallback_task = self._create_tracked_task(
            fallback(), name=f"yeelight_cube_matrix_restart_fallback_{self._ip}",
        )

    def _matrix_just_restarted(self) -> bool:
        return time.monotonic() - self._matrix_restarted_at < MATRIX_RESTART_WINDOW

    def _matrix_lamp_restarted(self) -> None:
        """The lamp started again (its reboot count changed): a power cut,
        however short (one between two LAN probes went unseen, 2026-11-11).
        It shows its saved effect or stays off (its Power-on behavior):
        Home Assistant's content is shown again, as after a longer outage
        (light_connection's health check)."""
        now = time.monotonic()
        self._matrix_restarted_at = now
        self._matrix_redraw_due = False   # redrawn here, not by the fallback
        self._matrix_shown = None
        self._matrix_sent_id = None
        followed = self._matrix_followed_from
        self._matrix_followed_from = None
        if followed is not None and now - followed[0] < MATRIX_RESTART_WINDOW:
            # Its start-up effect, reported first, was taken for its button.
            self._enter_mode(followed[1])
            self._native_effect = followed[2]
            if refresh := getattr(self, "_refresh_linked_entities", None):
                refresh()
        turned = self._matrix_turned_from
        self._matrix_turned_from = None
        if self.hass is None:
            return
        # Its rotation, reported first, was taken for the app's.
        self._matrix_restore_orientation(
            turned[1] if turned is not None and now - turned[0] < MATRIX_RESTART_WINDOW else self._device_orientation
        )
        if self._outage_since is not None:
            # The health check saw it away: it redraws when the lamp answers
            # (at once: Matter, which reported this, is back).
            _LOGGER.info("[MATRIX] [%s] The lamp restarted (redrawn by the health check)", self._ip)
            self._matrix_restart_seen = True
            return
        if self._external_display:
            _LOGGER.info("[MATRIX] [%s] The lamp restarted: it shows another app's content", self._ip)
            return
        if self._matrix_power_on == "off":
            _LOGGER.info("[MATRIX] [%s] The lamp restarted, set to stay off at power-on", self._ip)
            self._is_on = False
            self.async_write_ha_state()
            return
        if not self._is_on:
            _LOGGER.info("[MATRIX] [%s] The lamp restarted (the light is off)", self._ip)
            return
        _LOGGER.info("[MATRIX] [%s] The lamp restarted: Home Assistant's content shown again", self._ip)
        self._create_tracked_task(
            self.async_apply_display_mode(update_type="turn_on"),
            name=f"yeelight_cube_matrix_restarted_{self._ip}",
        )

    def _matrix_lan_rotation(self) -> int | None:
        """The rotation the lamp answered over the LAN (rotation_angle, read
        at setup), kept up to date with what it reports and is written."""
        capabilities = getattr(self._lamp_client, "capabilities", None) or {}
        try:
            rotation = int(capabilities.get("rotation_angle"))
        except (TypeError, ValueError):
            return None
        return rotation if 0 <= rotation <= 3 else None

    def matrix_note_rotation(self, rotation: int) -> None:
        """The lamp's rotation as it now is (reported, or written here)."""
        if not self.is_cube_matrix:
            return
        capabilities = getattr(self._lamp_client, "capabilities", None)
        if isinstance(capabilities, dict):
            capabilities["rotation_angle"] = str(rotation)

    def _matrix_rotated(self, rotation, *, start: bool = False) -> None:
        """The lamp's rotation_angle (the Yeelight app's direction), reported
        or read at setup (``start``): the mounting it names is the light's
        Device Orientation (device_profile.MATRIX_ROTATION_ORIENTATIONS), so
        pictures, text and the previews are laid out for it as the lamp's own
        effects are."""
        profile = self._lamp_client.profile
        if not isinstance(rotation, int) or not 0 <= rotation <= 3:
            return
        self.matrix_note_rotation(rotation)
        if rotation == profile.rotation and not start:
            return
        self._lamp_client.profile = dataclasses.replace(profile, rotation=rotation)
        if not start and self.hass is not None and self._matrix_just_restarted():
            # Reported as the lamp starts: the rotation it had saved, not a
            # change made in the app (_matrix_restore_orientation).
            self._matrix_restore_orientation(self._device_orientation)
            return
        if self._lamp_client.profile.factory_modules:
            # Never set in the app: the factory's rotation, not the mounting
            # (the user's Device Orientation is kept; the factory_modules repair).
            return
        orientation = self._lamp_client.profile.orientation
        if orientation is None or orientation == self._device_orientation or self.hass is None:
            return
        _LOGGER.info("[MATRIX] [%s] Rotation %s: mounted %s", self._ip, rotation, orientation)
        if not start:
            self._matrix_turned_from = (time.monotonic(), self._device_orientation)
        self._create_tracked_task(
            self.set_device_orientation(orientation),
            name=f"yeelight_cube_matrix_rotation_{self._ip}",
        )

    def _matrix_restore_orientation(self, orientation: str | None) -> None:
        """After a restart: the lamp runs the rotation it last saved. It
        saves a written one only after a later request, and not while its
        music mode is on (its LAN stuck, or a connection left open), so it
        can come back with an older one (seen 2026-11-11 and 12: the one
        written two minutes before). Written again when it differs from the
        Device Orientation (``orientation``), never followed."""
        rotation = self._rotation_for(orientation) if orientation else None
        if rotation is None:
            return
        running = self._lamp_client.profile.rotation
        if running == rotation:
            return
        _LOGGER.warning(
            "[MATRIX] [%s] The lamp restarted with rotation %s, not %s (%s): it had not saved the "
            "last one written; written again", self._ip, running, rotation, orientation,
        )

        async def restore() -> None:
            if orientation != self._device_orientation:
                await self.set_device_orientation(orientation)
            elif await self._sync_lamp_rotation(orientation, force=True):
                self._lamp_client.profile = dataclasses.replace(self._lamp_client.profile, rotation=rotation)

        self._create_tracked_task(restore(), name=f"yeelight_cube_matrix_rotation_restore_{self._ip}")
