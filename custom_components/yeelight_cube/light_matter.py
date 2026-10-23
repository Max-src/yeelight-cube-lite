"""What the lamp reports over Matter, applied to the light (matter_link.py).

Only changes made on the lamp itself or in the Yeelight app move the
light's state: a playlist effect (the right button, the app), the
microphone music modes (the left button, its long press) and the app's
direction setting. An effect the lamp reports within MATTER_ECHO_WINDOW of
a command this integration sent, that is what the command shows or what the
lamp showed before it, is that command's own echo and changes nothing; any
other report is followed, even right after a command (the app resets the
lamp when leaving its Direction page). Effects the integration does not know
(a GIF, an app drawing) are only published (the `matter` attribute), but
tell it the lamp left its drawing mode. Nothing is sent to the lamp in return, except a
direction change, which redraws the content for the new orientation like
the Device Orientation select. Mixed into YeelightCubeLight.
"""
from __future__ import annotations

import asyncio
import logging
import time

from homeassistant.core import callback  # type: ignore

from .const import (
    CONF_MATTER_MAC,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    MUSIC_FLOW_EFFECT_IDS,
    MUSIC_FLOW_EFFECTS,
    NATIVE_EFFECTS,
)
from .matter_commands import MatterCommands, MatterCommandsUnavailable
from .matter_discovery import async_offer_matter_lamps
from .matter_link import ROTATION, ROTATION_ORIENTATIONS, MatterLink
from .matrix_view import is_upside_down_mount

_LOGGER = logging.getLogger(__name__)

# Seconds after a command to the lamp (light_connection._execute_hardware_op)
# during which a report of what it shows, or of what was shown before, is that
# command's echo.
MATTER_ECHO_WINDOW = 5.0
# The effect the lamp reports while this integration draws on it (its direct
# mode: text, gradients, drawings), seen on a Cube Lite (firmware 1.12.32).
DRAWING_EFFECT = 50

# The effect the lamp reports (the Yeelight app's effect id: its button
# playlist and effect list) -> the official native effect it is. The
# experimental effects are firmware modes started under a generic id, and
# ids such as the GIF player's (71) are no native effect: not followed.
NATIVE_EFFECT_IDS: dict[int, str] = {
    spec["effect_id"]: name for name, spec in NATIVE_EFFECTS.items()
}

# Seconds a direction write may take before the orientation change goes on
# without it (the lamp keeps its direction).
ROTATION_WRITE_TIMEOUT = 10.0

# The lamp's own direction setting for a Device Orientation (same arrows).
ORIENTATION_ROTATIONS: dict[str, int] = {
    orientation: rotation for rotation, orientation in ROTATION_ORIENTATIONS.items()
}


class MatterMixin:
    """The lamp's Matter link and the reports it applies."""

    def _init_matter_state(self) -> None:
        """Called by YeelightCubeLight.__init__."""
        self._matter: MatterLink | None = None
        # Yeelight writes and commands over Matter (matter_commands.py).
        self._matter_commands: MatterCommands | None = None
        # The Matter link sensor (sensor.py), told when the link changes.
        self._matter_link_sensor = None
        # When a command to the lamp last started or ended (monotonic), and
        # the effect the lamp showed when it started (_note_lamp_command).
        self._lamp_command_at = 0.0
        self._effect_before_command: int | None = None

    # ── The link ────────────────────────────────────────────────────────
    def _start_matter_link(self) -> None:
        """From async_added_to_hass: follow the lamp's Matter node, if any."""
        self._matter = MatterLink(self.hass, self._on_matter_report)
        self.async_on_remove(self._matter.release)
        self._matter_commands = MatterCommands(self.hass, self._matter, lambda: self._ip)
        self._refresh_matter_link()

    @callback
    def _refresh_matter_link(self) -> None:
        """Link, keep or drop the node (every minute: _async_check_problems),
        remembering its MAC so a new IP address still finds it."""
        if self._matter is None:
            return
        # Lamps only in Matter: offered as discovered (matter_discovery.py).
        async_offer_matter_lamps(self.hass)
        entry = self._config_entry
        remembered = entry.data.get(CONF_MATTER_MAC) if entry is not None else None
        changed = self._matter.refresh(self._ip, remembered)
        self._check_matter_commands()
        if not changed:
            return
        if entry is not None and self._matter.mac and self._matter.mac != remembered:
            self.hass.config_entries.async_update_entry(
                entry, data={**entry.data, CONF_MATTER_MAC: self._matter.mac}
            )
        if self.hass is not None:
            self.async_write_ha_state()
        self._matter_status_changed()

    @property
    def matter_link_state(self) -> str:
        """The Matter link sensor's state: "not_linked" (no Matter node, or
        no Matter integration), "linked" (read only), or "settings_available"
        (a Matter server also delivers Yeelight commands)."""
        if self._matter is None or not self._matter.linked:
            return "not_linked"
        if self._matter_commands is not None and self._matter_commands.backend:
            return "settings_available"
        return "linked"

    @property
    def matter_link_details(self) -> dict:
        """The Matter link sensor's attributes: the node, and which server
        delivers Yeelight commands or why none does."""
        if self._matter is None or not self._matter.linked:
            return {}
        channel = self._matter_commands
        return {
            "node_id": self._matter.node_id,
            "settings_server": channel.backend if channel else None,
            "settings_unavailable": channel.reason if channel else None,
        }

    def _matter_status_changed(self) -> None:
        """Show a new link or commands state on the Matter link sensor."""
        sensor = self._matter_link_sensor
        if sensor is not None and getattr(sensor, "hass", None) is not None:
            sensor.async_write_ha_state()

    def _check_matter_commands(self) -> None:
        """Find which server delivers Yeelight commands now (with the link's
        minute check), for the `matter` attribute: "commands", or
        "commands_unavailable" with each server's reason."""
        channel = self._matter_commands
        if channel is None or self._matter is None or not self._matter.linked:
            return
        if getattr(self, "_matter_commands_check", None) is not None:
            return

        async def check() -> None:
            before = (channel.backend, channel.reason)
            try:
                await channel.async_available()
            finally:
                self._matter_commands_check = None
            if (channel.backend, channel.reason) != before and self.hass is not None:
                self.async_write_ha_state()
                self._matter_status_changed()

        self._matter_commands_check = self._create_tracked_task(
            check(), name=f"yeelight_cube_matter_commands_{self._ip}"
        )

    @property
    def matter_commands(self) -> MatterCommands | None:
        """Yeelight writes and commands over Matter, for features that use
        them: check ``await matter_commands.async_available()`` (or catch
        MatterCommandsUnavailable) and fall back to LAN, or hide what needs
        them, when no server delivers them (no Matter, the official server
        before it knows the Yeelight clusters)."""
        return self._matter_commands

    def _matter_summary(self) -> dict | None:
        """The light's `matter` attribute: the node and what it reports, and
        which server delivers Yeelight commands ("commands": "matter", "dev"
        or None); None without a node."""
        if not self._matter:
            return None
        summary = self._matter.summary()
        if summary is not None and self._matter_commands is not None:
            summary["commands"] = self._matter_commands.backend
            if self._matter_commands.reason:
                summary["commands_unavailable"] = self._matter_commands.reason
        return summary

    @property
    def matter_lan_control_off(self) -> bool:
        """The lamp reports LAN control off (issues.py lan_control_off)."""
        return bool(self._matter and self._matter.linked and self._matter.values.get("lan_control") is False)

    def _note_lamp_command(self) -> None:
        """A command to the lamp starts (light_connection._execute_hardware_op):
        remember what the lamp showed until now (_effect_echo)."""
        self._lamp_command_at = time.monotonic()
        self._effect_before_command = self._expected_effect()

    def _expected_effect(self) -> int | None:
        """The effect the lamp reports for the light's state: Music Flow's,
        the native effect's, DRAWING_EFFECT when this integration draws;
        None when unknown (the clock, an experimental effect) or off."""
        if not self._is_on:
            return None
        if self._music_flow_enabled:
            return MUSIC_FLOW_EFFECTS.get(self._music_flow_effect)
        if self._mode == MODE_NATIVE_EFFECT:
            return (NATIVE_EFFECTS.get(self._native_effect) or {}).get("effect_id")
        if self._mode == MODE_CLOCK:
            return None
        return DRAWING_EFFECT

    def _matter_echo(self) -> bool:
        """Whether a command started or ended within MATTER_ECHO_WINDOW."""
        return time.monotonic() - self._lamp_command_at < MATTER_ECHO_WINDOW

    def _effect_echo(self, effect_id: int) -> bool:
        """Whether a reported effect is a recent command's echo: what it
        shows, or what the lamp showed before it (a late report)."""
        return self._matter_echo() and effect_id in (
            self._expected_effect(), self._effect_before_command,
        )

    # ── Reports ─────────────────────────────────────────────────────────
    @callback
    def _on_matter_report(self, name: str, value, initial: bool) -> None:
        """A value the lamp reports (matter_link.REPORTED). The values read
        when the link is made are its state then: published, not applied."""
        if not initial:
            if name == "effect" and isinstance(value, int):
                if not self._effect_echo(value):
                    self._lamp_showed_effect(value)
            elif name == "mic_music_on" and value is False:
                if not self._matter_echo():
                    self._lamp_stopped_music_flow()
            elif name == "on_off" and isinstance(value, bool):
                if not self._matter_echo():
                    self._lamp_switched(value)
            elif name == "level" and isinstance(value, int):
                if not self._matter_echo():
                    self._lamp_dimmed(value)
            elif name == "rotation":  # never written here: no echo
                self._lamp_turned(value)
            elif name == "lan_control":
                self._async_check_problems()
        if self.hass is not None:
            self.async_write_ha_state()

    def _lamp_showed_effect(self, effect_id: int) -> None:
        """The lamp switched to effect ``effect_id`` by itself (a button, the
        app): follow it when it is a Music Flow or native effect. Anything
        but DRAWING_EFFECT means the lamp left this integration's drawing
        mode: the next frame enters it again."""
        if effect_id != DRAWING_EFFECT:
            self._fx_mode_is_direct = False
        music = MUSIC_FLOW_EFFECT_IDS.get(effect_id)
        if music is not None:
            self._follow_music_flow(music)
            return
        name = NATIVE_EFFECT_IDS.get(effect_id)
        if name is None:
            _LOGGER.debug("[MATTER] [%s] Lamp shows effect %s (not followed)", self._ip, effect_id)
            return
        if (
            self._is_on and not self._music_flow_enabled
            and self._mode == MODE_NATIVE_EFFECT and self._native_effect == name
        ):
            return
        _LOGGER.info("[MATTER] [%s] Lamp switched to %s on its own", self._ip, name)
        self._stop_own_animations()
        if self._music_flow_enabled:
            self._music_flow_enabled = False
            self._music_flow_restore_power = None
            self._create_tracked_task(
                self._persist_music_flow_runtime_state(),
                name=f"yeelight_cube_music_flow_persist_{self._ip}",
            )
        self._mode = MODE_NATIVE_EFFECT
        self._native_effect = name
        self._mark_firmware_drawing()
        self._followed_lamp()

    def _follow_music_flow(self, effect: str) -> None:
        """The lamp's microphone music started, or changed mode (the left
        button)."""
        if self._music_flow_enabled and self._music_flow_effect == effect and self._is_on:
            return
        _LOGGER.info("[MATTER] [%s] Lamp started Music Flow %s on its own", self._ip, effect)
        self._stop_own_animations()
        if not self._music_flow_enabled:
            self._music_flow_restore_power = True
        self._music_flow_enabled = True
        self._music_flow_effect = effect
        self._mark_firmware_drawing()
        self._create_tracked_task(
            self._persist_music_flow_runtime_state(),
            name=f"yeelight_cube_music_flow_persist_{self._ip}",
        )
        self._followed_lamp()

    def _lamp_stopped_music_flow(self) -> None:
        """The lamp's microphone music stopped (a long press): the lamp shows
        its previous effect again, reported on its own."""
        if not self._music_flow_enabled:
            return
        _LOGGER.info("[MATTER] [%s] Lamp stopped Music Flow on its own", self._ip)
        self._music_flow_enabled = False
        self._music_flow_restore_power = None
        self._create_tracked_task(
            self._persist_music_flow_runtime_state(),
            name=f"yeelight_cube_music_flow_persist_{self._ip}",
        )
        self._followed_lamp()

    def _lamp_switched(self, on: bool) -> None:
        """The lamp was switched on or off by itself (its right button's long
        press, the app). This integration's own off may keep it powered (it
        blanks a drawing): only the lamp's real power is followed."""
        if on == self._is_on:
            return
        _LOGGER.info("[MATTER] [%s] Lamp switched %s on its own", self._ip, "on" if on else "off")
        if not on:
            self._stop_own_animations()
            if self._music_flow_enabled:
                self._music_flow_enabled = False
                self._music_flow_restore_power = None
                self._create_tracked_task(
                    self._persist_music_flow_runtime_state(),
                    name=f"yeelight_cube_music_flow_persist_{self._ip}",
                )
        self._is_on = on
        # Its brightness and drawing mode are set again by the next command.
        self._fx_mode_is_direct = False
        self._last_hardware_brightness = None
        self._followed_lamp()

    def _lamp_dimmed(self, level: int) -> None:
        """The lamp's brightness was changed by itself (the app): Matter's
        level 1-254 as the light's 1-255. Small differences are rounding."""
        brightness = max(1, min(255, round(level * 255 / 254)))
        if abs(brightness - (self._brightness or 0)) <= 2:
            return
        _LOGGER.info("[MATTER] [%s] Lamp brightness set to %s on its own", self._ip, brightness)
        self._brightness = brightness
        # Unknown to this integration: the next brightness change is sent.
        self._last_hardware_brightness = None
        self._followed_lamp()

    @property
    def lamp_turns_content(self) -> bool:
        """Whether the lamp's firmware draws its own content (clock, native
        effects) turned a half turn: its own direction setting (the Yeelight
        app's, followed over Matter) is an upside-down one (Left / Up),
        verified live for the clock on all four and for an effect."""
        rotation = self._matter.values.get("rotation") if self._matter and self._matter.linked else None
        return is_upside_down_mount(ROTATION_ORIENTATIONS.get(rotation))

    async def _sync_lamp_rotation(self, orientation: str) -> bool:
        """Set the lamp's own direction setting to the Device Orientation
        over Matter (matter_commands.py), so its firmware turns the clock and
        native effects for the mount, as the Yeelight app does. True when it
        was written now (the lamp applies it to the next clock or effect it
        starts); False when it already matched or no server delivers it (as
        before: the firmware's content is not turned)."""
        rotation = ORIENTATION_ROTATIONS.get(orientation)
        link, channel = self._matter, self._matter_commands
        if rotation is None or channel is None or link is None or not link.linked:
            return False
        if link.values.get("rotation") == rotation:
            return False
        try:
            await asyncio.wait_for(channel.async_write(ROTATION, rotation), ROTATION_WRITE_TIMEOUT)
        except MatterCommandsUnavailable:
            return False
        except Exception as err:  # noqa: BLE001 -- the lamp keeps its direction
            _LOGGER.warning("[MATTER] [%s] Could not set the lamp's direction: %s", self._ip, err)
            return False
        _LOGGER.info("[MATTER] [%s] Lamp direction set to %s", self._ip, orientation)
        # As the lamp will report it: previews turn now.
        link.values["rotation"] = rotation
        return True

    def _lamp_turned(self, rotation) -> None:
        """The Yeelight app's direction changed: the same Device Orientation
        here (its arrows are the app's)."""
        orientation = ROTATION_ORIENTATIONS.get(rotation)
        if orientation is None or orientation == self._device_orientation:
            return
        _LOGGER.info("[MATTER] [%s] Direction set to %s in the Yeelight app", self._ip, orientation)
        self._create_tracked_task(
            self.set_device_orientation(orientation),
            name=f"yeelight_cube_matter_orientation_{self._ip}",
        )

    # ── Helpers ─────────────────────────────────────────────────────────
    def _stop_own_animations(self) -> None:
        """What this integration animated on the lamp gave way to the lamp."""
        if self._rotation_active or self._rotation_resume_pending:
            self.stop_effect_rotation()
        self._is_scrolling = False
        self.stop_scroll_timer()

    def _mark_firmware_drawing(self) -> None:
        """The lamp's firmware draws (as after this integration starts an
        effect, light_native._activate_native_effect)."""
        self._is_on = True
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True
        self._last_fx_mode_time = 0.0

    def _followed_lamp(self) -> None:
        """Show the followed state everywhere (controls, previews)."""
        self._refresh_linked_entities()
        self._notify_camera_preview()
