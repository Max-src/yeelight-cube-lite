"""The lamp's saved mount profile for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin. The profile (mount_profile.py) turns every
native effect the lamp draws; it is resolved here from what the entry keeps
(the user's choice in the options, or the last value Matter confirmed) and,
once confirmed, the lamp's Matter attribute (light_matter.py writes it before
trusting it). light_native.py compensates the directions it sends with it.
Reads/writes state via ``self``; used only as a mixin.
"""
from __future__ import annotations

import logging

from .const import (
    CONF_MOUNT_PROFILE,
    CONF_MOUNT_PROFILE_NODE,
    CONF_MOUNT_PROFILE_SOURCE,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
)
from .mount_profile import (
    FIRE_CHECK_PARAMS,
    SOURCE_MATTER,
    SOURCE_USER,
    clock_turned,
    effective_profile,
    resolve_profile,
    valid_profile,
)

_LOGGER = logging.getLogger(__name__)


class MountProfileMixin:
    """Resolve, store and apply the lamp's mount profile."""

    @property
    def mount_profile(self) -> tuple[int | None, str]:
        """(profile 0-3 or None, source "matter" / "user" / "unknown")."""
        entry = getattr(self, "_config_entry", None)
        options = entry.options if entry is not None else {}
        link = getattr(self, "_matter", None)
        linked = link is not None and link.linked
        return resolve_profile(
            options.get(CONF_MOUNT_PROFILE),
            options.get(CONF_MOUNT_PROFILE_SOURCE),
            options.get(CONF_MOUNT_PROFILE_NODE),
            link.node_id if linked else None,
            link.values.get("rotation") if linked else None,
            link.values.get("topology") if linked else None,
        )

    @property
    def effect_profile(self) -> int:
        """The profile native effect directions are compensated for (an
        unknown one is the firmware's default, 3: a lamp never saved)."""
        return effective_profile(self.mount_profile[0])

    @property
    def lamp_turns_clock(self) -> bool:
        """Whether the lamp's firmware draws its clock a half turn from the
        calibration's (profiles 0 and 1): the previews turn it too. Native
        effects are compensated (light_native), so they never are."""
        return clock_turned(self.effect_profile)

    def _mount_profile_summary(self) -> dict:
        """The light's `mount_profile` attribute: the known profile (or
        None), its source, and the one in use (the default when unknown)."""
        profile, source = self.mount_profile
        return {"profile": profile, "source": source, "in_use": effective_profile(profile)}

    def _store_mount_profile(self, profile: int, source: str, node: int | None = None) -> bool:
        """Keep the profile with the entry (and, from Matter, the node it was
        confirmed on); True when that changed what is kept."""
        entry = getattr(self, "_config_entry", None)
        if entry is None or self.hass is None:
            return False
        options = {
            **entry.options,
            CONF_MOUNT_PROFILE: profile,
            CONF_MOUNT_PROFILE_SOURCE: source,
        }
        if source == SOURCE_MATTER:
            options[CONF_MOUNT_PROFILE_NODE] = node
        if options == dict(entry.options):
            return False
        self.hass.config_entries.async_update_entry(entry, options=options)
        return True

    async def async_set_user_mount_profile(self, profile: int, *, after_check: bool = False) -> None:
        """The user's answer (options: the app's orientation, or the Fire
        check): kept, and what the lamp shows follows it. After the check,
        its content (or its off state) comes back."""
        profile = valid_profile(profile)
        if profile is None:
            raise ValueError("The mount profile is 0, 1, 2 or 3")
        before = self.effect_profile
        self._store_mount_profile(profile, SOURCE_USER)
        _LOGGER.info("[MOUNT] [%s] Mount profile %s set by the user", self._ip, profile)
        if after_check:
            await self._async_end_mount_check()
        elif self.effect_profile != before:
            await self._async_reapply_for_mount_profile(lamp_changed=False)

    async def async_show_mount_check(self) -> bool:
        """Play Fire at direction 0 as is (not compensated): where its bright
        flame base shows tells the lamp's profile (FIRE_BASE_PROFILES). False
        when the lamp did not take it."""
        if getattr(self, "_mount_check_was_on", None) is None:
            self._mount_check_was_on = self._is_on

        async def show() -> None:
            if claim := getattr(self, "_claim_display", None):
                claim()
            await self._leave_direct_mode()
            await self._cube_matrix.send_raw_command(
                "set_fx_effect", list(FIRE_CHECK_PARAMS), check_reply=True
            )
            # What runs is not the light's effect: the next one is sent in full.
            self._cube_matrix.forget_running_effect()
            self._fx_mode_is_direct = False
            self._in_native_fw_mode = True

        return bool(await self._execute_hardware_op(show, "mount_check"))

    async def _async_end_mount_check(self) -> None:
        """Put back what the lamp showed before the Fire check."""
        was_on = getattr(self, "_mount_check_was_on", None)
        self._mount_check_was_on = None
        if was_on is None:
            await self._async_reapply_for_mount_profile(lamp_changed=False)
            return
        self._cube_matrix.forget_running_effect()
        self._notify_camera_preview()
        if was_on:
            await self.async_apply_display_mode(update_type="text_change")
        else:
            await self.async_turn_off()

    async def _async_reapply_for_mount_profile(self, *, lamp_changed: bool) -> None:
        """The profile in use changed: a native effect is sent again with its
        directions compensated anew; the clock only when the lamp's own
        setting changed (the lamp turns it when it starts, light_matter),
        otherwise only its preview turns."""
        self._notify_camera_preview()
        if self.hass is not None:
            self.async_write_ha_state()
        if not self._is_on or getattr(self, "_external_display", False) or self._music_flow_enabled:
            return
        if self._mode == MODE_NATIVE_EFFECT or (lamp_changed and self._mode == MODE_CLOCK):
            self._cube_matrix.forget_running_effect()
            await self.async_apply_display_mode(update_type="text_change")
