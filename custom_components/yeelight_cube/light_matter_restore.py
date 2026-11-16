"""What Home Assistant does when the lamp changes on its own (a button, the
Yeelight app), reported over Matter: following it, or putting its own
content back.
"""
from __future__ import annotations

import asyncio
import logging

from .const import (
    MODE_NATIVE_EFFECT,
)
from .effect_catalog import (
    MUSIC_FLOW_EFFECT_IDS,
    NATIVE_CLOCK_EFFECT_ID,
)
from .light_matter import (
    DRAWING_EFFECT,
    NATIVE_EFFECT_IDS,
)

_LOGGER = logging.getLogger(__name__)


class LampRestoreMixin:
    """Following the lamp's own changes, or restoring Home Assistant's content."""

    def _lamp_event(self, event_type: str, data: dict) -> None:
        """Fire a Lamp buttons event (event.py), if the entity is there."""
        self._notify("lamp_button_event", args=(event_type, data))

    def _request_lamp_restore(self, music: bool) -> bool:
        """Ask for a restore pass; True when none is scheduled or running, so
        _run_lamp_restore is started (one at a time). None while
        another app shows content that cannot be shown again: the
        integration's would be stale."""
        if self._restore_blocked():
            return False
        self._lamp_restore_pending = True
        self._lamp_restore_music |= music
        if self._restoring_after_lamp:
            return False
        self._restoring_after_lamp = True
        return True

    def _restore_after_lamp_change(self, *, music: bool = False) -> None:
        """Right as Remote: put back what the integration showed (its state
        did not follow the lamp). Its own commands' reports are their echoes."""
        if self._request_lamp_restore(music):
            _LOGGER.info("[MATTER] [%s] Button as remote: putting the content back", self._ip)
            self._create_tracked_task(
                self._run_lamp_restore(), name=f"yeelight_cube_lamp_restore_{self._ip}",
            )

    async def _async_put_content_back(self, *, music: bool = False) -> None:
        """Show the integration's content again now (or in the restore
        already running)."""
        if self._request_lamp_restore(music):
            await self._run_lamp_restore()

    async def _run_lamp_restore(self) -> None:
        """Show the integration's content again, as its state says: its
        music mode or none, its power, its picture, text or effect; or the
        Yeelight app's content that can be shown again (_app_content).
        Passes repeat while new requests arrive; another app's display
        stops them."""
        try:
            while self._lamp_restore_pending and not self._restore_blocked():
                self._lamp_restore_pending = False
                restore_music = self._lamp_restore_music
                self._lamp_restore_music = False
                # Every pass follows the latest desired state, including a
                # power change or automation received during the previous pass.
                self._direct_mode_lost()
                if restore_music or self._music_flow_enabled:
                    await self.async_set_music_flow(
                        self._music_flow_enabled, restore_display=False, persist_state=False,
                    )
                if self._restore_blocked():
                    break
                if self._music_flow_enabled:
                    continue
                if not self._is_on:
                    await self.async_turn_off()
                    continue
                if self._app_content is not None:
                    await self._replay_app_content(self._app_content)
                    continue
                self._lamp_client.forget_running_effect()
                # Not suppressed while the lamp runs its own renderer (the
                # black slot, an app's drawing): putting it back is the point.
                await self.async_apply_display_mode(update_type="remote_restore")
        except Exception as err:  # noqa: BLE001 -- the lamp keeps what it shows
            _LOGGER.warning("[MATTER] [%s] Could not put back the lamp's content: %s", self._ip, err)
        finally:
            self._restoring_after_lamp = False
            self._lamp_restore_pending = False
            self._lamp_restore_music = False

    def _restore_blocked(self) -> bool:
        """Another app shows content that cannot be shown again."""
        return self._external_display and self._app_content is None

    async def _replay_app_content(self, content: tuple[str, list]) -> None:
        """Show the Yeelight app's content again, as the app sent it
        (_app_content_command). It stays another app's display: the
        integration's state is left as it was."""
        _LOGGER.info("[MATTER] [%s] Button as remote: showing the Yeelight app's content again", self._ip)
        method, params = content
        effect = method == "set_fx_effect"
        clock = effect and params[0] == NATIVE_CLOCK_EFFECT_ID

        async def send() -> None:
            await self._leave_direct_mode()
            if clock:
                await asyncio.sleep(0.1)  # as light_native._send_native
            self._expect_lamp_power(True)
            await self._lamp_client.send_raw_command(
                method, params, abortive_close=not clock, check_reply=True
            )
            if effect:
                self._lamp_client.note_running_effect(params)
            else:
                self._lamp_client.forget_running_effect()
            self._entered_builtin_mode()

        await self._execute_hardware_op(send, "matter:app_content")

    def _lamp_showed_effect(self, effect_id: int) -> None:
        """The lamp switched to effect ``effect_id`` by itself (a button, the
        app): follow it when it is a Music Flow or native effect. Anything
        but DRAWING_EFFECT means the lamp left this integration's drawing
        mode: the next frame enters it again."""
        if effect_id != DRAWING_EFFECT:
            self._direct_mode_lost()
        music = MUSIC_FLOW_EFFECT_IDS.get(effect_id)
        if music is not None:
            self._follow_music_flow(music)
            return
        if self._music_flow_enabled:
            self._drop_music_flow()
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
        self._enter_mode(MODE_NATIVE_EFFECT)
        self._native_effect = name
        self._mark_lamp_drawing()
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
            self._music_from_lamp = True
        elif not self._music_from_lamp and self._own_music_effect is None:
            self._own_music_effect = self._music_flow_effect
        self._music_flow_enabled = True
        self._music_flow_effect = effect
        self._mark_lamp_drawing()
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
        self._drop_music_flow()
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
            # A Cube Matrix: its effect is sent in full when it is on again.
            self._matrix_shown = None
            if self._music_flow_enabled:
                self._drop_music_flow()
        self._is_on = on
        # Its brightness and drawing mode are set again by the next command.
        self._direct_mode_lost()
        self._forget_hardware_brightness()
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
        self._forget_hardware_brightness()
        self._followed_lamp()
