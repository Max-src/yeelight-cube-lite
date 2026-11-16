"""The lamp's buttons as Home Assistant sees them, over Matter: Wake Lamp
When Off, and Right as Remote (the right button's playlist of black
drawings, written to the lamp and told apart from the Yeelight app's).
"""
from __future__ import annotations

import logging
import time

from .const import (
    CONF_BUTTONS_AS_REMOTE,
    CONF_BUTTONS_WAKE_LAMP,
    CONF_REMOTE_SAVED_PLAYLIST,
    CONF_REMOTE_PLAYLIST_INSTALLED,
)
from .matter_commands import (
    EFFECTS_CLUSTER,
    MatterCommandsUnavailable,
)
from .light_matter import (
    REMOTE_BLACK,
    REMOTE_DRAWING_EFFECT,
    REMOTE_SLOTS,
    REMOTE_SLOT_BASE,
    REMOTE_WRITE_SETTLE,
)

_LOGGER = logging.getLogger(__name__)


class RemoteButtonsMixin:
    """The lamp's buttons (light_matter's reports tell the presses)."""

    @property
    def buttons_wake_lamp(self) -> bool:
        """Buttons: Wake Lamp When Off (on by default)."""
        entry = self._config_entry
        return entry is None or bool(entry.options.get(CONF_BUTTONS_WAKE_LAMP, True))

    @property
    def remote_keeps_lamp_powered(self) -> bool:
        """"Off" keeps the lamp powered, black (light._internal_turn_off):
        a remote button must not wake it, and a powered-down lamp's click
        only powers it on, unreported as a press."""
        return not self.buttons_wake_lamp and (
            self.remote_playlist_active or self.restore_after_music_changes
        )

    @property
    def buttons_as_remote(self) -> bool:
        """Whether tagged remote playlist selections restore our display."""
        entry = self._config_entry
        return bool(entry is not None and entry.options.get(CONF_BUTTONS_AS_REMOTE, False))

    @property
    def remote_playlist_active(self) -> bool:
        """A saved playlist means black slots may be on the lamp, even after
        an interrupted write. Keep recognizing them until restoration succeeds."""
        entry = self._config_entry
        return bool(entry is not None and entry.options.get(CONF_REMOTE_SAVED_PLAYLIST))

    @property
    def buttons_remote_status(self) -> str:
        """Actual operation, independent of the user's saved switch preference."""
        if not self.buttons_as_remote:
            return "restoration_pending" if self.remote_playlist_active else "disabled"
        if self.matter_link_state == "not_linked":
            return "matter_unavailable"
        if self._external_display:
            return "external_display"
        if self._remote_playlist_busy:
            return "setup_pending"
        if self._remote_setup_problem:
            return self._remote_setup_problem
        installed = self._config_entry.options.get(CONF_REMOTE_PLAYLIST_INSTALLED, False)
        if self.remote_playlist_active:
            return "active" if installed else "setup_pending"
        return "setup_pending" if self.matter_link_state == "settings_available" else "settings_unavailable"

    def _remote_playlist_settling(self) -> bool:
        return self._remote_playlist_busy or time.monotonic() - self._remote_playlist_written_at < REMOTE_WRITE_SETTLE

    def sync_remote_playlist(self) -> None:
        """Right as Remote on: save the lamp's playlist and make every slot
        black (needs Matter settings; until then ordinary changes are
        followed without restoration). Off: write the saved playlist back. From the switch and
        the minute check, so a step that could not run is tried again."""
        channel, entry = self._matter_commands, self._config_entry
        if channel is None or entry is None or self._remote_playlist_busy:
            return
        installed = entry.options.get(CONF_REMOTE_PLAYLIST_INSTALLED, False)
        if self.buttons_as_remote and self.remote_playlist_active and installed:
            return
        if not self.buttons_as_remote and not self.remote_playlist_active:
            return
        if self._matter is None or not self._matter.linked:
            return

        # Reserve before scheduling: multiple reports in one event-loop turn
        # must not start competing writes (or overwrite the original backup).
        self._remote_playlist_busy = True
        self._matter_status_changed()

        async def sync() -> None:
            requested = self.buttons_as_remote
            attempted = False
            try:
                if not await channel.async_available():
                    return
                attempted = True
                if self.buttons_as_remote:
                    await self._write_remote_playlist(channel, entry, keep_saved=self.remote_playlist_active)
                else:
                    await self._write_saved_playlist(channel, entry)
            except MatterCommandsUnavailable:
                pass
            except Exception as err:  # noqa: BLE001 -- tried again next minute
                _LOGGER.warning("[MATTER] [%s] Could not write the lamp's playlist: %s", self._ip, err)
            finally:
                if attempted:
                    # Partial writes can report their slots late, too.
                    self._remote_playlist_written_at = time.monotonic()
                self._remote_playlist_busy = False
                self._matter_status_changed()
                if requested != self.buttons_as_remote:
                    self.sync_remote_playlist()

        self._create_tracked_task(sync(), name=f"yeelight_cube_remote_playlist_{self._ip}")

    async def _write_remote_playlist(self, channel, entry, keep_saved: bool = False) -> None:
        """Save the lamp's playlist, then make every slot black. With
        ``keep_saved`` (written again), the playlist saved first is kept."""
        self.hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_REMOTE_PLAYLIST_INSTALLED: False}
        )
        reply = await channel.async_command(EFFECTS_CLUSTER, "getPersistEffectList") or {}
        slots = reply.get("effectList") or reply.get("effects") or []
        saved = [
            [int(slot.get("effectId", slot.get("effectID"))), int(slot.get("customId", slot.get("customID")))]
            for slot in slots
        ]
        # The read is tried again every minute: a playlist fixed in the
        # Yeelight app is picked up then.
        if not saved:
            self._set_remote_setup_problem("no_playlist")
            return
        if not keep_saved and any(custom_id in REMOTE_SLOTS for _effect_id, custom_id in saved):
            # Black slots from an earlier install whose backup is gone (the
            # integration removed without turning the switch off): saving them
            # as the backup would lose the lamp's own playlist for good.
            self._set_remote_setup_problem("backup_missing")
            return
        self._set_remote_setup_problem(None)
        if not keep_saved:
            # Saved before anything is written, so a partial write is undone.
            self.hass.config_entries.async_update_entry(
                entry, options={**entry.options, CONF_REMOTE_SAVED_PLAYLIST: saved}
            )
        for index in range(len(saved)):
            await channel.async_command(EFFECTS_CLUSTER, "updatePersistEffectList", {
                "index": index,
                "effect": {
                    "effectId": REMOTE_DRAWING_EFFECT,
                    "customId": REMOTE_SLOT_BASE + index,
                    "effectParams": [{"onoff": 1, "mode": REMOTE_DRAWING_EFFECT, "data": REMOTE_BLACK}],
                },
            })
        self._remote_playlist_written_at = time.monotonic()
        self.hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_REMOTE_PLAYLIST_INSTALLED: True}
        )
        _LOGGER.info("[MATTER] [%s] Right as Remote: the lamp's playlist is black (%s slots)", self._ip, len(saved))
        # The lamp may have switched to a written slot: show the content again.
        if self._is_on:
            await self._async_put_content_back()

    def _set_remote_setup_problem(self, problem: str | None) -> None:
        """Why the black playlist cannot be installed (remote_status), logged
        once when it changes."""
        if problem == self._remote_setup_problem:
            return
        self._remote_setup_problem = problem
        if problem == "no_playlist":
            _LOGGER.warning("[MATTER] [%s] Right as Remote: the lamp's playlist is empty", self._ip)
        elif problem == "backup_missing":
            _LOGGER.warning(
                "[MATTER] [%s] Right as Remote: the lamp's playlist already holds black slots "
                "and their backup is gone; reset the playlist in the Yeelight app", self._ip,
            )

    async def _write_saved_playlist(self, channel, entry) -> None:
        """Write the saved playlist back (Right as Remote turned off)."""
        saved = entry.options.get(CONF_REMOTE_SAVED_PLAYLIST) or []
        # A partial restoration also invalidates the black-playlist marker:
        # turning remote mode back on must finish installing it again.
        self.hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_REMOTE_PLAYLIST_INSTALLED: False}
        )
        for index, (effect_id, custom_id) in enumerate(saved):
            await channel.async_command(EFFECTS_CLUSTER, "updatePersistEffectList", {
                "index": index,
                "effect": {"effectId": effect_id, "customId": custom_id, "effectParams": [{"onoff": 1, "mode": effect_id}]},
            })
        self._remote_playlist_written_at = time.monotonic()
        options = {key: value for key, value in entry.options.items() if key not in (
            CONF_REMOTE_SAVED_PLAYLIST, CONF_REMOTE_PLAYLIST_INSTALLED,
        )}
        self.hass.config_entries.async_update_entry(entry, options=options)
        _LOGGER.info("[MATTER] [%s] Right as Remote off: the lamp's playlist is back", self._ip)

    async def _write_button_playlist(self, items: list[dict]) -> bool:
        """set_button_effects over Matter: the lamp refuses this write over
        LAN (`invalid params`, not on its LAN allow-list). ``items`` are
        light._effect_persist_item's. True when written; False when no
        server delivers Yeelight's commands (LAN is tried then)."""
        channel = self._matter_commands
        if channel is None:
            return False
        try:
            if not await channel.async_available():
                return False
            for index, item in enumerate(items):
                params = []
                for config in item["effect_params"]:
                    # The playlist keeps no speed; colours are copied into a
                    # buffer of 4 (MATTER_COMMANDS.md: send exactly 4).
                    config = {key: value for key, value in config.items() if key != "rate"}
                    if "color" in config:
                        config["color"] = (list(config["color"]) + [0, 0, 0, 0])[:4]
                    params.append(config)
                await channel.async_command(EFFECTS_CLUSTER, "updatePersistEffectList", {
                    "index": index,
                    "effect": {
                        "effectId": item["effect_id"],
                        "customId": item["custom_id"],
                        "effectParams": params,
                    },
                })
        except MatterCommandsUnavailable:
            return False
        _LOGGER.info("[MATTER] [%s] Button playlist written (%s slots)", self._ip, len(items))
        return True
