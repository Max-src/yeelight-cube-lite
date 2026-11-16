"""Follow optional Matter state reports and restore tagged remote selections.

Reports describe content, not command origin. Ordinary external changes yield
control to the sender. Tagged right-button playlist selections can restore
integration content; ambiguous music restoration is an independent opt-in.
Expected command echoes are filtered without requiring Matter on LAN-only lamps.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time

from homeassistant.core import callback  # type: ignore

from .const import (
    CONF_RESTORE_MUSIC_CHANGES,
    CONF_IP,
    LAN_PORT,
    PROBE_TIMEOUT,
    CONF_MATTER_MAC,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
)
from .effect_catalog import (
    MUSIC_FLOW_EFFECT_IDS,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_APPLY,
    NATIVE_EFFECTS,
    clock_style_colors,
)
from .builtin_pixel_art import app_pixel_art_argb
from .matter_commands import (
    MatterCommands,
)
from .matter_discovery import async_offer_matter_lamps
from .matrix_effects import OWN_DRAWING_ID
from .matter_link import MATRIX_REPORTED, ROTATION_ORIENTATIONS, MatterLink

_LOGGER = logging.getLogger(__name__)


async def lamp_answers(ip: str) -> bool:
    """Whether a lamp's LAN port answers at ``ip`` (a connection, nothing
    sent)."""
    from .lamp_protocol import check_tcp  # the transport (the yeelight library)

    try:
        await check_tcp(ip, LAN_PORT, PROBE_TIMEOUT)
    except OSError:
        return False
    return True

# Seconds after a command to the lamp (light_connection._execute_hardware_op)
# during which a report of what it shows, or of what was shown before, is that
# command's echo.
MATTER_ECHO_WINDOW = 5.0
# The effect the lamp reports while this integration draws on it (its direct
# mode: text, gradients, drawings), seen on a Cube Lite.
DRAWING_EFFECT = 50

# The effect the lamp reports (the Yeelight app's effect id: its button
# playlist and effect list) -> the official native effect it is. The
# experimental effects are the lamp's modes started under a generic id, and
# ids such as the GIF player's (71) are no native effect: not followed.
NATIVE_EFFECT_IDS: dict[int, str] = {
    spec["effect_id"]: name for name, spec in NATIVE_EFFECTS.items()
}

# Right as Remote, with Matter settings: every slot of the lamp's playlist
# (the right button steps through it) is an all-black drawing, custom ids
# REMOTE_SLOT_BASE + slot, so a press shows black, not an effect, and is told
# apart from the Yeelight app by its custom id (verified on a Cube Lite:
# the lamp reports the slot's custom id on every press).
REMOTE_DRAWING_EFFECT = 36
REMOTE_SLOT_BASE = 1000
REMOTE_SLOTS = range(REMOTE_SLOT_BASE, REMOTE_SLOT_BASE + 8)
# 100 black pixels (0xff, 0, 0, 0): a drawing's 400 bytes, base64.
REMOTE_BLACK = base64.b64encode(bytes((0xFF, 0, 0, 0)) * 100).decode("ascii")
# Seconds after the playlist is written during which the lamp's reports are
# that write's, not presses (the lamp may switch to a written slot).
REMOTE_WRITE_SETTLE = 5.0
# Seconds a report of effect 0, 36, 40 or 71 waits for the values that tell
# what it shows (a Cube Lite reports them within a millisecond, in either
# order) before it is read.
EXTERNAL_DRAWING_WAIT = 0.25
# The Yeelight app's content a remote press can show again
# (_app_content_command), told by its custom id or its
# colour: its clock (the style, the integration's styles
# 1-14), its animations (the app's tile; the lamp plays the GIF it stores),
# its built-in pixel art, and its plain colour (effect 0, live test
# 2026-10-27: the colour is Color Control's hue and saturation). Its own
# drawings carry a Yeelight cloud id: their pixels cannot be read back.
APP_COLOUR_EFFECT = 0
APP_GIF_EFFECT = 71
APP_GIF_TILES = frozenset((72, 77, 79, 93))
APP_CLOCK_STYLES = range(1, 15)
APP_CONTENT_EFFECTS = frozenset(
    (APP_COLOUR_EFFECT, REMOTE_DRAWING_EFFECT, NATIVE_CLOCK_EFFECT_ID, APP_GIF_EFFECT)
)
# What the orientation check's stars change on the lamp, reported over
# Matter: not followed while it runs (light_mount_profile).
MOUNT_CHECK_REPORTS = frozenset({
    "effect", "effect_sub", "hue", "saturation", "on_off", "mic_music_on", "mic_music_mode",
})

# Seconds after a black slot's press during which a microphone-off report is
# that press's (the black drawing stops the music, reported about 0.8 s
# later on a Cube Lite), not the left button's long press.
REMOTE_PRESS_MUSIC_OFF = 2.0

# Seconds after the lamp's network chip started again (RebootCount up)
# during which what it reports is its start-up state, not a change by a
# button or an app: seen 2026-11-16, a Cube Lite's chip restarting mid-stream
# reported effect 0 and colour 0/0, taken for the Yeelight app's colour.
LAMP_START_DEFAULTS_SECONDS = 10.0

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
        # When the lamp's network chip last started again (_lamp_restarted).
        self._lamp_started_at = float("-inf")
        # The check that Matter delivers the Yeelight commands, while it runs.
        self._matter_commands_check = None
        # Yeelight writes and commands over Matter (matter_commands.py).
        self._matter_commands: MatterCommands | None = None
        self._external_display = False
        # The check that the lamp answers at its node's new address
        # (_follow_matter_address): one at a time, cancelled on removal.
        self._address_check: asyncio.Task | None = None
        # The command (method, params) that shows the Yeelight app's content
        # again while it is the external display (_app_content_command), or
        # None.
        self._app_content: tuple[str, list] | None = None
        # When effect and effect_sub were last reported (a drawing's custom
        # id is trusted only when it came with it, _app_content_command).
        self._effect_reported_at = 0.0
        self._effect_sub_reported_at = 0.0
        # When a press, or the echo of a command, was last reported: a
        # content check scheduled before it is moot (_check_lamp_content).
        self._content_reports_ignored_at = -1.0
        self._lamp_content_check = None
        # The Music Flow shown was started on the lamp (a button, an app), on
        # top of the integration's content, not by the integration.
        self._music_from_lamp = False
        # The integration's own Music Flow mode, while the lamp shows
        # another one (the left button): what a remote press brings back.
        self._own_music_effect: str | None = None
        # Right as Remote: a restore of what the lamp changed is scheduled
        # or running, and another pass (with music) is wanted.
        self._restoring_after_lamp = False
        self._lamp_restore_pending = False
        self._lamp_restore_music = False
        # Right as Remote: the black playlist is being written or put back,
        # and when it was last written (REMOTE_WRITE_SETTLE).
        self._remote_playlist_busy = False
        self._remote_playlist_written_at = -REMOTE_WRITE_SETTLE
        # When a black slot was last pressed (REMOTE_PRESS_MUSIC_OFF).
        self._remote_press_at = -REMOTE_PRESS_MUSIC_OFF
        # Why the black playlist cannot be installed ("no_playlist",
        # "backup_missing"), shown as remote_status; None when it can.
        self._remote_setup_problem: str | None = None
        # When a command to the lamp last started or ended (monotonic), and
        # the effect the lamp showed when it started (_note_lamp_command).
        self._lamp_command_at = 0.0
        self._effect_before_command: int | None = None
        self._expected_lamp_power: bool | None = None
        self._lamp_power_command_at = -MATTER_ECHO_WINDOW
        self._expected_lamp_music: bool | None = None
        self._lamp_music_command_at = -MATTER_ECHO_WINDOW
        # Set by the next microphone-on report (_await_lamp_music_on).
        self._lamp_music_on_event: asyncio.Event | None = None
        # When deactivate_fx_mode last made the lamp put back its saved effect
        # (_note_fx_restore).
        self._fx_restore_at = -MATTER_ECHO_WINDOW
        # The lamp's rotationAngle as last seen (read when linked, reported,
        # or written here): a report of the same value is no change.
        self._lamp_rotation_seen = None
        # The write that confirms the lamp's profile on a node not confirmed
        # yet (_check_mount_profile), and the (node, server) it was tried with.
        self._mount_profile_write = None
        self._mount_profile_tried: tuple | None = None

    # ── The link ────────────────────────────────────────────────────────
    def _start_matter_link(self) -> None:
        """From async_added_to_hass: follow the lamp's Matter node, if any
        (a Cube Matrix's: its own product id and reports, light_matrix)."""
        if getattr(self, "is_cube_matrix", False):
            self._matter = MatterLink(
                self.hass, self._on_matrix_report,
                products=(self.device_profile.matter_product,), reported=MATRIX_REPORTED,
            )
        else:
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
        self._follow_matter_address(entry, remembered)
        self._check_matter_commands()
        # The buttons' playlist and the orientation check are a Cube Lite's.
        if self.device_profile.matter:
            self.sync_remote_playlist()
            self._check_mount_profile()
        if not changed:
            return
        if entry is not None and self._matter.mac and self._matter.mac != remembered:
            self.hass.config_entries.async_update_entry(
                entry, data={**entry.data, CONF_MATTER_MAC: self._matter.mac}
            )
        if self.hass is not None:
            self.async_write_ha_state()
        self._matter_status_changed()

    def _follow_matter_address(self, entry, remembered: str | None) -> bool:
        """The lamp may have a new address (DHCP, no reservation: seen on a
        Cube Matrix overnight): its node, found by the remembered MAC,
        reports another usable one (matter_link.usable_address). The entry
        takes it only once checked (_async_follow_address): a server's cached
        address can be stale, and a node reports 0.0.0.0 after a power-on.
        True when a check was started."""
        if entry is None or not remembered or self._matter.mac != remembered:
            return False
        address = self._matter.address()
        if not address or address == self._ip or address == entry.data.get(CONF_IP):
            return False
        if self._address_check is not None or self.hass is None:
            return False
        self._address_check = self._create_tracked_task(
            self._async_follow_address(entry, address), name=f"yeelight_cube_address_{self._ip}",
        )
        return True

    async def _async_follow_address(self, entry, address: str) -> bool:
        """Move the entry to ``address`` only when the lamp no longer
        answers at its own and does at that one (its LAN port): never on a
        stale or wrong report, so it cannot go back and forth with
        discovery. True when moved (the entry's update reloads it)."""
        try:
            if await lamp_answers(self._ip) or not await lamp_answers(address):
                return False
            _LOGGER.info(
                "[MATTER] [%s] The lamp answers at %s now (its Matter node's address): the entry follows it",
                self._ip, address,
            )
            self.hass.config_entries.async_update_entry(entry, data={**entry.data, CONF_IP: address})
            return True
        finally:
            self._address_check = None

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
        """Show a new link or commands state on the Matter link sensor, and
        the Lamp buttons entity's availability."""
        self._notify("matter_link", "lamp_buttons", "buttons_as_remote")
        # A Cube Matrix shows its own effects once Matter delivers them, also
        # when Matter had failed meanwhile (the link came back: tried again).
        retry = getattr(self, "_retry_matrix_native", None)
        if retry is not None and retry(link_back=True):
            return
        if changed := getattr(self, "_matrix_matter_changed", None):
            changed()

    def _check_matter_commands(self) -> None:
        """Find which server delivers Yeelight commands now (with the link's
        minute check), for the `matter` attribute: "commands", or
        "commands_unavailable" with each server's reason."""
        channel = self._matter_commands
        if channel is None or self._matter is None or not self._matter.linked:
            return
        if self._matter_commands_check is not None:
            return

        async def check() -> None:
            before = (channel.backend, channel.reason)
            try:
                await channel.async_available()
                # The lamp's new node answers: its earlier pairings' nodes go.
                if channel.backend and self._matter is not None and self._matter.stale_node_ids:
                    await self._matter.remove_stale_nodes()
            finally:
                self._matter_commands_check = None
            if (channel.backend, channel.reason) != before and self.hass is not None:
                self.async_write_ha_state()
                self._matter_status_changed()
                # A server now delivers the write that confirms the profile.
                if self.device_profile.matter:
                    self._check_mount_profile()

        self._matter_commands_check = self._create_tracked_task(
            check(), name=f"yeelight_cube_matter_commands_{self._ip}"
        )

    @property
    def animations_available(self) -> bool:
        """Whether an animation can be shown: streamed on a lamp without
        effects of its own (Cube Matrix, device_profile); on a Cube Lite, a
        server delivers the Yeelight commands now, so it can be uploaded
        (the `matter` attribute's "commands")."""
        if self.device_profile.streams_effects:
            return True
        channel = self._matter_commands
        return channel is not None and channel.backend is not None

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
        which server delivers Yeelight commands ("commands": "matter" or
        None), and the Yeelight app's content a remote press shows again
        ("app_content": the command's method, effect and custom id, or
        hue and saturation, _app_content); None without a node."""
        if not self._matter:
            return None
        summary = self._matter.summary()
        if summary is not None and self._matter_commands is not None:
            summary["commands"] = self._matter_commands.backend
            if self._matter_commands.reason:
                summary["commands_unavailable"] = self._matter_commands.reason
        if summary is not None and self._app_content is not None:
            method, params = self._app_content
            summary["app_content"] = [method, *params[:2]]
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
        the native effect's, the clock command's outer id, or DRAWING_EFFECT
        when this integration draws (a streamed palette effect or clock too); the Yeelight app's content's when it is
        shown again (_replay_app_content); while off, DRAWING_EFFECT (the
        black picture that keeps a lamp powered, light._internal_turn_off);
        None when unknown."""
        if not self._is_on:
            return DRAWING_EFFECT
        if self._external_display:
            return self._app_content_effect()
        if self._music_flow_enabled:
            return MUSIC_FLOW_EFFECTS.get(self._music_flow_effect)
        # A streamed palette effect or clock: direct mode (light_studio), or
        # the lamp's drawing when streamed over Matter (light_matrix).
        studio = getattr(self, "studio_selected", None)
        if studio is not None and studio():
            if self._streams_over_matter():
                return REMOTE_DRAWING_EFFECT
            return DRAWING_EFFECT
        if self._mode == MODE_NATIVE_EFFECT:
            # A music effect in the palette color mode runs as its music mode.
            palette_music = getattr(self, "_palette_music", None)  # light_native
            if flow := (palette_music and palette_music()):
                return MUSIC_FLOW_EFFECTS.get(flow)
            return (NATIVE_EFFECTS.get(self._native_effect) or {}).get("effect_id")
        if self._mode == MODE_CLOCK:
            # Mixers and palette modes can override the clock's outer id.
            # Use the same builder as activation: treating its report as a
            # button press would rewrite the remote playlist while restoring.
            return self._native_clock_params()[0]
        return DRAWING_EFFECT

    def _matter_echo(self) -> bool:
        """Whether a command started or ended within MATTER_ECHO_WINDOW."""
        return time.monotonic() - self._lamp_command_at < MATTER_ECHO_WINDOW

    def _expect_lamp_power(self, on: bool) -> None:
        """Record physical power expected from a command, including black frames."""
        self._expected_lamp_power = on
        self._lamp_power_command_at = time.monotonic()

    def _power_echo(self, on: bool) -> bool:
        if (
            on == self._expected_lamp_power
            and time.monotonic() - self._lamp_power_command_at < MATTER_ECHO_WINDOW
        ):
            return True
        # An opposing report is a real change; don't swallow its reversal.
        self._expected_lamp_power = None
        return False

    def _expect_lamp_music(self, on: bool) -> None:
        """Only music commands can explain a microphone on/off report."""
        self._expected_lamp_music = on
        self._lamp_music_command_at = time.monotonic()

    def _expect_lamp_music_on(self) -> None:
        """A music mode is started: _await_lamp_music_on returns at its
        microphone-on report."""
        self._lamp_music_on_event = asyncio.Event()

    async def _await_lamp_music_on(self, timeout: float) -> bool:
        """Wait for the microphone-on report _expect_lamp_music_on waits
        for, at most ``timeout`` s (none comes when the microphone already
        ran): whether it came."""
        event = self._lamp_music_on_event
        try:
            if event is None:
                await asyncio.sleep(timeout)
                return False
            await asyncio.wait_for(event.wait(), timeout)
            return True
        except TimeoutError:
            return False
        finally:
            self._lamp_music_on_event = None

    def _music_echo(self, on: bool) -> bool:
        if (
            on == self._expected_lamp_music
            and time.monotonic() - self._lamp_music_command_at < MATTER_ECHO_WINDOW
        ):
            return True
        self._expected_lamp_music = None
        return False

    def _note_fx_restore(self) -> None:
        """deactivate_fx_mode was sent (light_native._clear_fx_mode_flag):
        the lamp briefly puts back its saved effect, whatever it is, before
        the next command replaces it."""
        self._fx_restore_at = time.monotonic()

    def _effect_echo(self, effect_id: int) -> bool:
        """Whether a reported effect is a recent command's echo: what it
        shows, what the lamp showed before it (a late report), or anything
        just after deactivate_fx_mode (the lamp's saved effect)."""
        if time.monotonic() - self._fx_restore_at < MATTER_ECHO_WINDOW:
            return True
        return self._matter_echo() and effect_id in (
            self._expected_effect(), self._effect_before_command,
        )

    def _shows_own_drawing_report(self, effect_id: int) -> bool:
        """Whether a reported effect is the drawing this integration keeps
        the lamp in (DRAWING_EFFECT: a stream, a picture, the black picture
        of an "off"), whenever it is reported: frames are no commands, so a
        stream opens no echo window, and the Matter server reports every
        value again when it subscribes anew (a lamp it lost for a while).
        Such a report is the lamp still showing it, never another app."""
        if effect_id == DRAWING_EFFECT:
            return self._expected_effect() == DRAWING_EFFECT
        return self._own_stream_drawing_report(effect_id)

    def _streams_over_matter(self) -> bool:
        """The stream goes as the lamp's drawing over Matter (light_matrix)."""
        over_matter = getattr(self, "matrix_streams_over_matter", None)
        return bool(over_matter is not None and over_matter())

    def _own_stream_drawing_report(self, effect_id: int) -> bool:
        """Whether a reported drawing (effect 36) is this integration's
        stream over Matter: its custom id (OWN_DRAWING_ID, reported as
        effect_sub, in either order with the effect: then within a command's
        echo window), not a Right-as-Remote slot nor the Yeelight app's
        drawing."""
        if effect_id != REMOTE_DRAWING_EFFECT or self._expected_effect() != REMOTE_DRAWING_EFFECT:
            return False
        sub = (self._matter.values if self._matter else {}).get("effect_sub")
        return sub == OWN_DRAWING_ID or (sub not in REMOTE_SLOTS and self._matter_echo())

    def _lamp_restarted(self) -> None:
        """The lamp's network chip started again (Matter RebootCount up): a
        power cut, or the chip alone restarting while the panel kept its
        picture. What it reports next is its start-up state."""
        self._lamp_started_at = time.monotonic()
        _LOGGER.info("[MATTER] [%s] The lamp's network part started again", self._ip)

    def _reports_start_up_state(self) -> bool:
        """Whether the lamp's reports are its start-up state
        (LAMP_START_DEFAULTS_SECONDS after _lamp_restarted), not a change by
        a button or an app."""
        return time.monotonic() - self._lamp_started_at < LAMP_START_DEFAULTS_SECONDS

    def _lamp_music_echo(self, on: bool) -> bool:
        """Whether a microphone report comes from the integration's music
        effect (or clock over one), not from Music Flow or the left button:
        the lamp reports the microphone on while it shows one, and off when
        the next command replaces it."""
        if self._music_flow_enabled:
            return False
        if on:
            shows_music = getattr(self, "_shows_lamp_music", None)  # light_native
            return bool(shows_music and shows_music())
        return self._matter_echo()

    # ── Reports ─────────────────────────────────────────────────────────
    @callback
    def _on_matter_report(self, name: str, value, initial: bool) -> None:
        """A value the lamp reports (matter_link.REPORTED). The values read
        when the link is made are its state then: published, not applied."""
        if not initial and name in MOUNT_CHECK_REPORTS and getattr(self, "_mount_check_active", False):
            # The orientation check's stars (light_mount_profile): the lamp
            # did not change on its own; what it showed comes back after.
            if self.hass is not None:
                self.async_write_ha_state()
            return
        if name == "rotation":
            seen, self._lamp_rotation_seen = self._lamp_rotation_seen, value
            if not initial and value != seen:
                self._lamp_turned(value)
        elif not initial:
            if name == "reboot_count":
                self._lamp_restarted()
            if name in ("effect", "effect_sub"):
                self._note_app_gif()
            if name == "effect" and isinstance(value, int) and not self._own_stream_drawing_report(value):
                # The lamp left a drawing streamed over Matter: the stream
                # starts it again before any setData (light_matrix).
                self._matrix_shown = None
            if name == "effect_sub" and value != OWN_DRAWING_ID:
                self._matrix_shown = None
            if name == "effect" and isinstance(value, int):
                self._effect_reported_at = time.monotonic()
                if self._own_stream_drawing_report(value):
                    self._content_reports_ignored_at = time.monotonic()
                elif self.remote_playlist_active and value == REMOTE_DRAWING_EFFECT:
                    # A black slot: the press is its custom id (effect_sub).
                    self._direct_mode_lost()
                    self._check_lamp_content()
                elif (
                    self._effect_echo(value) or self._shows_own_drawing_report(value)
                    or self._reports_start_up_state()
                ):
                    self._content_reports_ignored_at = time.monotonic()
                elif value in APP_CONTENT_EFFECTS:
                    # The app's colour, drawing, clock or animation: told by
                    # its colour or id.
                    self._direct_mode_lost()
                    self._check_lamp_content()
                else:
                    self._lamp_changed_effect(value)
            elif name == "effect_sub" and value == OWN_DRAWING_ID:
                # The stream's own drawing over Matter (light_matrix).
                self._effect_sub_reported_at = time.monotonic()
                self._content_reports_ignored_at = time.monotonic()
            elif name == "effect_sub" and value not in REMOTE_SLOTS:
                self._effect_sub_reported_at = time.monotonic()
                # The app's next clock style or picture: only the id changes.
                values = self._matter.values if self._matter else {}
                if self._matter_echo():
                    self._content_reports_ignored_at = time.monotonic()
                elif values.get("effect") in APP_CONTENT_EFFECTS:
                    self._check_lamp_content()
            elif name in ("hue", "saturation"):
                # The app's next colour: only the colour changes.
                values = self._matter.values if self._matter else {}
                if self._matter_echo():
                    self._content_reports_ignored_at = time.monotonic()
                elif values.get("effect") == APP_COLOUR_EFFECT:
                    self._check_lamp_content()
            elif name == "effect_sub":
                self._effect_sub_reported_at = time.monotonic()
                # Also while the saved playlist waits to be written back
                # (switch off): the lamp shows black, so put the content back.
                if self.remote_playlist_active and not self._remote_playlist_settling():
                    # The slot alone proves the lamp left direct mode. Its
                    # effect=36 report may arrive later, or not change at all.
                    self._direct_mode_lost()
                    self._remote_press_at = time.monotonic()
                    self._content_reports_ignored_at = self._remote_press_at
                    self._lamp_event("right_button", {"slot": value - REMOTE_SLOT_BASE})
                    self._wake_for_press()
                    self._restore_after_lamp_change(music=self._take_back_display())
            elif name == "mic_music_on" and value is True:
                if self._lamp_music_on_event is not None:
                    self._lamp_music_on_event.set()
                # The left button started a microphone music mode: with Left
                # as Remote, put back at once (its mode, the event, may be
                # reported a moment later).
                if not self._music_echo(True) and not self._lamp_music_echo(True):
                    if self.restore_after_music_changes:
                        self._take_back_from_music()
                    else:
                        self._accept_external_display(stale=False)
            elif name == "mic_music_on" and value is False:
                if self._music_stopped_by_remote_press():
                    # The black slot stopped it; the press's restore shows
                    # the content (the music too, when it was the integration's).
                    pass
                elif not self._music_echo(False) and not self._lamp_music_echo(False):
                    self._lamp_event("music_off", {})
                    if not self.restore_after_music_changes:
                        self._lamp_stopped_music_flow()
            elif name == "on_off" and isinstance(value, bool):
                # The power button is followed, Right as Remote or not.
                if not self._power_echo(value):
                    self._lamp_event("turned_on" if value else "turned_off", {})
                    self._lamp_switched(value)
            elif name == "level" and isinstance(value, int):
                if not self._matter_echo() and not self._reports_start_up_state():
                    self._lamp_dimmed(value)
            elif name == "lan_control":
                self._async_check_problems()
        if self.hass is not None:
            self.async_write_ha_state()

    def _check_lamp_content(self) -> None:
        """Effects 0 (a plain colour), 36 (a drawing), 40 (the clock) and 71
        (an animation) are told by their colour or custom id: let it arrive,
        then read them.

        Tagged slots restore immediately in effect_sub; only these reports
        wait, so this doesn't delay remote-button handling. A black slot
        (effect 36, a REMOTE_SLOTS id) is the press's, not another app's,
        and so is what the lamp reports once the press's restore showed
        the content again: a press or an echo since then ends the check.
        """
        if self._lamp_content_check is not None:
            return
        scheduled_at = time.monotonic()

        async def check() -> None:
            try:
                await asyncio.sleep(EXTERNAL_DRAWING_WAIT)
                if self._content_reports_ignored_at >= scheduled_at or self._reports_start_up_state():
                    return
                values = self._matter.values if self._matter else {}
                effect = values.get("effect")
                if effect in APP_CONTENT_EFFECTS and not (
                    effect == REMOTE_DRAWING_EFFECT
                    and values.get("effect_sub") in REMOTE_SLOTS
                ):
                    self._lamp_changed_effect(effect)
                    if self.hass is not None:
                        self.async_write_ha_state()  # its `matter` attribute
            finally:
                self._lamp_content_check = None

        self._lamp_content_check = self._create_tracked_task(
            check(), name=f"yeelight_cube_lamp_content_{self._ip}",
        )

    def _note_app_gif(self) -> None:
        """The Yeelight app plays one of its GIFs (effect 71, a GIF tile's
        id): it uploaded it first, over the animation this integration stored
        (light._stored_gif), which the next activation uploads again."""
        values = self._matter.values if self._matter else {}
        stored = self._stored_gif
        if (
            stored and stored.get("animation")
            and values.get("effect") == APP_GIF_EFFECT
            and values.get("effect_sub") in APP_GIF_TILES
            and not self._matter_echo()
        ):
            _LOGGER.debug("[MATTER] [%s] The app replaced the stored GIF", self._ip)
            self._stored_gif = {**stored, "animation": None}

    def _lamp_changed_effect(self, effect_id: int) -> None:
        """The lamp switched to effect ``effect_id`` by itself (a button, the
        app): an event, then followed, or put back (Right as Remote)."""
        music = MUSIC_FLOW_EFFECT_IDS.get(effect_id)
        if effect_id != DRAWING_EFFECT:
            if music is not None:
                self._lamp_event("music_mode_changed", {"mode": music})
            else:
                self._lamp_event(
                    "effect_changed",
                    {"effect": NATIVE_EFFECT_IDS.get(effect_id), "effect_id": effect_id},
                )
            if music is not None and self.restore_after_music_changes:
                self._direct_mode_lost()
                self._take_back_from_music()
                return
        if music is None:
            content = self._app_content_command(effect_id)
            self._accept_external_display()
            self._app_content = content
        else:
            self._accept_external_display(stale=False)
        self._lamp_showed_effect(effect_id)

    def _app_content_command(self, effect_id: int) -> tuple[str, list] | None:
        """The command (method, params) that shows the Yeelight app's content
        the lamp reports (effect ``effect_id`` and its custom id or colour)
        again, as the app sent it; None when it cannot be rebuilt (its own
        drawings).

        - Plain colour (0): its hue and saturation (set_hsv); its brightness
          is the lamp's, followed on its own.
        - Official effect: as the app starts it. Settings saved in the app
          are not reported.
        - Animation (71): the app's tile; the lamp plays the GIF it stores.
        - Clock (40): the app's style is the integration's style of the same
          id. The time or date, colon and 12-hour settings are not reported:
          the integration's are used.
        - Built-in pixel art (36): the id is trusted only when it was
          reported with the drawing (the app also sends drawings without
          one, and the lamp may keep the previous id); the gallery follows
          the lamp's direction, as in the app.
        """
        if effect_id in NATIVE_EFFECT_IDS:
            # As the app starts it (no settings: the effect's own speed,
            # colour and direction), not with Home Assistant's direction
            # for the mount.
            return "set_fx_effect", [effect_id, 0, NATIVE_EFFECT_APPLY]
        values = self._matter.values if self._matter else {}
        if effect_id == APP_COLOUR_EFFECT:
            hue, saturation = values.get("hue"), values.get("saturation")
            if not isinstance(hue, int) or not isinstance(saturation, int):
                return None
            # Matter's 0-254 as degrees and percent.
            return "set_hsv", [
                min(359, round(hue * 360 / 254)), min(100, round(saturation * 100 / 254)),
                "sudden", 30,
            ]
        sub = values.get("effect_sub")
        if not isinstance(sub, int):
            return None
        if effect_id == APP_GIF_EFFECT and sub in APP_GIF_TILES:
            return "set_fx_effect", [APP_GIF_EFFECT, sub, NATIVE_EFFECT_APPLY, {"onoff": 1}]
        if effect_id == NATIVE_CLOCK_EFFECT_ID and sub in APP_CLOCK_STYLES:
            style = NATIVE_CLOCK_STYLES[sub]
            config = {
                "mode": NATIVE_CLOCK_EFFECT_ID,
                "mixer": style["mixer"],
                "data": base64.b64encode(self._native_clock_data_bytes()).decode("ascii"),
            }
            # The app's styles 1-14 send one color or none; the same helper
            # as every clock command (clock_style_colors).
            colors = clock_style_colors(style)
            if colors:
                config["color"] = colors
            return "set_fx_effect", [NATIVE_CLOCK_EFFECT_ID, sub, NATIVE_CLOCK_APPLY, config]
        if (
            effect_id == REMOTE_DRAWING_EFFECT
            and self._effect_sub_reported_at >= self._effect_reported_at - EXTERNAL_DRAWING_WAIT
        ):
            pixels = app_pixel_art_argb(sub, vertical=values.get("rotation") in (1, 3))
            if pixels is not None:
                data = b"".join(int(argb).to_bytes(4, "big") for argb in pixels)
                return "set_fx_effect", [REMOTE_DRAWING_EFFECT, sub, NATIVE_EFFECT_APPLY, {
                    "onoff": 1, "mode": REMOTE_DRAWING_EFFECT, "mixer": 0,
                    "data": base64.b64encode(data).decode("ascii"),
                }]
        return None

    def _app_content_effect(self) -> int | None:
        """The effect the lamp reports for _app_content (its echo)."""
        if self._app_content is None:
            return None
        method, params = self._app_content
        return params[0] if method == "set_fx_effect" else APP_COLOUR_EFFECT

    def _take_back_from_music(self) -> None:
        """Left as Remote: a left press's music is undone, back to what was
        shown before it (the Yeelight app's content too, when it can be
        shown again)."""
        self._wake_for_press()
        if self._app_content is None:
            self._claim_display()
        self._restore_after_lamp_change(music=True)

    def _wake_for_press(self) -> None:
        """A remote button's press on a lamp that is off (its black picture,
        light._internal_turn_off): with Wake Lamp When Off, it comes on with
        its content; without, the restore shows the black picture again."""
        if not self._is_on and self.buttons_wake_lamp:
            _LOGGER.info("[MATTER] [%s] Button as remote: waking the lamp", self._ip)
            self._is_on = True
            self._followed_lamp()

    def _take_back_display(self) -> bool:
        """A remote button's press: the integration's content comes back,
        even after another app's (black, or music nobody chose, is never
        better), or that app's content when it can be shown again
        (_app_content). Music the lamp started gives way to what was shown
        before it; the integration's own Music Flow comes back with its own
        mode. True when the music must be set again."""
        music = False
        if self._music_flow_enabled:
            if self._music_from_lamp:
                self._drop_music_flow()
                music = True
            elif self._own_music_effect is not None:
                self._music_flow_effect = self._own_music_effect
                self._create_tracked_task(
                    self._persist_music_flow_runtime_state(),
                    name=f"yeelight_cube_music_flow_persist_{self._ip}",
                )
                self._followed_lamp()
                music = True
        if self._app_content is None:
            self._claim_display()
        return music

    def _music_stopped_by_remote_press(self) -> bool:
        """A microphone-off report just after a black slot's press: the
        press stopped the music, not the left button."""
        return (
            self.remote_playlist_active
            and time.monotonic() - self._remote_press_at < REMOTE_PRESS_MUSIC_OFF
        )

    def _accept_external_display(self, *, stale: bool = True) -> None:
        """The lamp shows what a button or an app started. ``stale``: the
        reports cannot rebuild its settings (an app's effect or drawing), so
        background redraws and pending restores stop until the integration
        shows something again, or a remote button's press brings its content
        back (_take_back_display). A music mode is followed on top of the
        content (_music_from_lamp) and doesn't change that. Either way the
        lamp shows something: it is on (also after the black picture of an
        "off" that kept it powered)."""
        if stale:
            self._external_display = True
            self._lamp_restore_pending = False
        self._is_on = True
        self._stop_own_animations()
        self._entered_builtin_mode()
        matrix = self._lamp_client
        if matrix is not None:
            matrix.forget_running_effect()
        retry = self._retry_display_task
        if retry is not None and not retry.done():
            retry.cancel()
        self._matter_status_changed()

    def _claim_display(self) -> None:
        """A new integration display command makes its settings restorable
        again (its own Music Flow included), not another app's."""
        self._music_from_lamp = False
        self._own_music_effect = None
        self._app_content = None
        if self._external_display:
            self._external_display = False
            self._matter_status_changed()

    @property
    def restore_after_music_changes(self) -> bool:
        """Independent opt-in: music reports cannot identify a physical press."""
        entry = self._config_entry
        return bool(entry is not None and entry.options.get(CONF_RESTORE_MUSIC_CHANGES, False))

    # ── Helpers ─────────────────────────────────────────────────────────
    def _stop_own_animations(self) -> None:
        """What this integration animated on the lamp gave way to the lamp."""
        if self._rotation_active or self._rotation_resume_pending:
            self.stop_effect_rotation()
        self._set_scrolling(False)
        self.stop_scroll_timer()

    def _drop_music_flow(self) -> None:
        """Music Flow is off (the lamp left it, or a right press undoes the
        lamp's): off here too, and saved."""
        self._music_from_lamp = False
        self._own_music_effect = None
        self._music_flow_enabled = False
        self._music_flow_restore_power = None
        self._create_tracked_task(
            self._persist_music_flow_runtime_state(),
            name=f"yeelight_cube_music_flow_persist_{self._ip}",
        )

    def _mark_lamp_drawing(self) -> None:
        """The lamp draws itself (as after this integration starts an
        effect, light_native._activate_native_effect)."""
        self._is_on = True
        self._entered_builtin_mode()
        self._last_fx_mode_time = 0.0

    def _followed_lamp(self) -> None:
        """Show the followed state everywhere (controls, previews)."""
        self._refresh_linked_entities()
        self._notify_camera_preview()
