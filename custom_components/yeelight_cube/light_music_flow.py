"""Music Flow: the lamp's music modes turned on and off, their effect, and
the state kept across restarts.
"""
from __future__ import annotations

import asyncio
import logging
from .lamp_protocol import CubeConnectionError
from homeassistant.exceptions import HomeAssistantError  # type: ignore

from .errors import failed
from .storage import async_save_data
from .const import (
    DOMAIN,
)
from .effect_catalog import (
    MUSIC_FLOW_EFFECTS,
)
from .light_native import (
    MUSIC_FLOW_HARD_TIMEOUT,
    _build_music_flow_payload,
)

_LOGGER = logging.getLogger(__name__)


class MusicFlowMixin:
    """Music Flow on the lamp."""

    async def async_set_music_flow(
        self,
        enabled: bool,
        restore_display: bool = True,
        *,
        persist_state: bool = True,
    ) -> None:
        """Start or stop device-microphone music flow through private LAN control.

        Remote-button restoration reapplies an unchanged desired state with
        persist_state=False, so disk I/O does not delay the following redraw.
        Normal user changes still persist immediately for restart recovery.
        """
        if enabled and (
            self._rotation_active
            or self._rotation_resume_pending
        ):
            self.stop_effect_rotation()

        async def _write_music_flow() -> None:
            if enabled and (claim := getattr(self, "_claim_display", None)):
                claim()
            was_music_flow_enabled = self._music_flow_enabled
            previous_power = self._is_on
            payload = _build_music_flow_payload(enabled, self._music_flow_effect)

            await self._leave_direct_mode()
            # Music Flow runs music slots: the microphone starts only once the
            # fx-mode flag is clear (the Yeelight app sends deactivate_fx_mode
            # first too).
            if enabled:
                await self._clear_fx_mode_flag()
            try:
                if note_music := getattr(self, "_expect_lamp_music", None):
                    note_music(enabled)
                if enabled and (note_power := getattr(self, "_expect_lamp_power", None)):
                    note_power(True)
                result = await self._lamp_client.send_command_with_recovery(
                    "set_ps",
                    ["mic_music_mode", payload],
                )
                if result is None:
                    raise CubeConnectionError(
                        "Music flow command was skipped during connection cooldown"
                    )
            finally:
                self._lamp_client.close_command_socket()

            self._music_flow_enabled = enabled
            try:
                if enabled:
                    if not was_music_flow_enabled:
                        self._music_flow_restore_power = previous_power
                    self._is_on = True
                    self._entered_builtin_mode()
                    self._last_fx_mode_time = 0.0
                    self._set_scrolling(False)
                    self.stop_scroll_timer()
                elif not was_music_flow_enabled:
                    self._is_on = previous_power
                    self._music_flow_restore_power = None
                    self._left_builtin_mode()
                elif restore_display:
                    restore_power = self._music_flow_restore_power
                    # The device has already accepted mic_music_mode=off. Clear
                    # the marker even if restoring the prior display fails.
                    self._music_flow_restore_power = None
                    self._left_builtin_mode()
                    await asyncio.sleep(0.1)
                    if restore_power is False:
                        self._lamp_client.close_fast_socket()
                        if note_power := getattr(self, "_expect_lamp_power", None):
                            note_power(False)
                        await self._lamp_client.send_raw_command(
                            "set_power",
                            ["off"],
                        )
                        self._is_on = False
                    else:
                        self._is_on = True
                        await self._apply_display_mode_internal()
                else:
                    self._music_flow_restore_power = None
                    self._left_builtin_mode()
            finally:
                # Keep HA and restart recovery aligned with the command that
                # the device already accepted if the follow-up redraw fails.
                self._refresh_music_flow_entities()
                self._notify_camera_preview()
                if self.hass is not None:
                    self.async_write_ha_state()
                if persist_state:
                    await self._persist_music_flow_runtime_state()

        success = await self._execute_hardware_op(
            _write_music_flow,
            "music_flow:on" if enabled else "music_flow:off",
            timeout_override=MUSIC_FLOW_HARD_TIMEOUT,
        )
        if not success:
            raise failed("music_flow_failed")

    async def _send_music_off(self) -> None:
        """Stop the lamp's microphone music, inside a hardware operation
        (light._internal_turn_off keeping the lamp powered)."""
        if note_music := getattr(self, "_expect_lamp_music", None):
            note_music(False)
        try:
            await self._lamp_client.send_command_with_recovery(
                "set_ps", ["mic_music_mode", _build_music_flow_payload(False, self._music_flow_effect)],
            )
        finally:
            self._lamp_client.close_command_socket()

    async def async_set_music_flow_effect(self, option: str) -> None:
        """Select a device-microphone music flow effect."""
        if option not in MUSIC_FLOW_EFFECTS:
            raise ValueError(f"Unsupported music flow effect: {option}")
        previous_effect = self._music_flow_effect
        self._music_flow_effect = option
        try:
            if self._music_flow_enabled:
                await self.async_set_music_flow(True)
            else:
                self._refresh_music_flow_entities()
                if self.hass is not None:
                    self.async_write_ha_state()
        except Exception:
            self._music_flow_effect = previous_effect
            self._refresh_music_flow_entities()
            raise

    def _refresh_music_flow_entities(self) -> None:
        """Synchronize the content-mode and effect controls with light state."""
        self._notify("content_mode", "music_flow_effect")

    def _music_flow_runtime_storage_key(self) -> str:
        """Return a stable per-device key for runtime state."""
        if self._config_entry is not None:
            return self._config_entry.entry_id
        return self._ip

    def _restore_music_flow_runtime_state(self) -> None:
        """Restore immediately persisted music-flow state after HA restart."""
        if self.hass is None:
            return
        runtime_states = self.hass.data.get(DOMAIN, {}).get(
            "device_runtime_state", {}
        )
        if not isinstance(runtime_states, dict):
            return
        runtime_state = runtime_states.get(
            self._music_flow_runtime_storage_key()
        )
        if not isinstance(runtime_state, dict):
            return
        if runtime_state.get("music_flow_enabled") is not True:
            return

        effect = runtime_state.get("music_flow_effect")
        if effect in MUSIC_FLOW_EFFECTS:
            self._music_flow_effect = effect
        restore_power = runtime_state.get("music_flow_restore_power")
        self._music_flow_restore_power = (
            restore_power if isinstance(restore_power, bool) else None
        )
        self._music_flow_enabled = True
        self._is_on = True
        self._entered_builtin_mode()
        _LOGGER.debug(
            "[MUSIC FLOW] [%s] Restored active runtime state from storage",
            self._ip,
        )

    async def _persist_music_flow_runtime_state(self) -> None:
        """Immediately persist active music-flow state for restart recovery."""
        if self.hass is None:
            return
        domain_data = self.hass.data.get(DOMAIN)
        if not isinstance(domain_data, dict):
            return
        runtime_states = domain_data.setdefault("device_runtime_state", {})
        if not isinstance(runtime_states, dict):
            runtime_states = {}
            domain_data["device_runtime_state"] = runtime_states

        key = self._music_flow_runtime_storage_key()
        if self._music_flow_enabled:
            runtime_states[key] = {
                "music_flow_enabled": True,
                "music_flow_effect": self._music_flow_effect,
                "music_flow_restore_power": self._music_flow_restore_power,
            }
        else:
            runtime_states.pop(key, None)
        try:
            await async_save_data(self.hass)
        except (OSError, HomeAssistantError) as err:
            _LOGGER.warning(
                "[MUSIC FLOW] [%s] Could not persist runtime state: %s",
                self._ip,
                err,
            )
