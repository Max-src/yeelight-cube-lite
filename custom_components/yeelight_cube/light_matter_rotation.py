"""The lamp's own direction setting (its rotation) over Matter: written for
the Device Orientation, read back, and the saved orientation it confirms.
"""
from __future__ import annotations

import asyncio
import logging

from homeassistant.core import callback  # type: ignore

from .const import (
    CONF_MOUNT_PROFILE_NODE,
)
from .matter_commands import (
    MatterCommandsUnavailable,
)
from .device_profile import CUBEMATRIX, MATRIX_ROTATION_ORIENTATIONS
from .matter_link import ROTATION, ROTATION_ORIENTATIONS
from .mount_profile import SOURCE_MATTER, saved_on_lamp, valid_profile
from .light_matter import (
    ORIENTATION_ROTATIONS,
    ROTATION_WRITE_TIMEOUT,
)

_LOGGER = logging.getLogger(__name__)


class MatterRotationMixin:
    """The lamp's direction setting and the Device Orientation."""

    def _rotation_for(self, orientation: str) -> int | None:
        """The lamp's direction setting for a Device Orientation: the Cube
        Lite's arrows (ROTATION_ORIENTATIONS), or the mounting each Cube
        Matrix rotation is for (device_profile.MATRIX_ROTATION_ORIENTATIONS):
        the two lamps number them differently."""
        if getattr(getattr(self, "device_profile", None), "key", None) == CUBEMATRIX:
            return {name: value for value, name in MATRIX_ROTATION_ORIENTATIONS.items()}.get(orientation)
        return ORIENTATION_ROTATIONS.get(orientation)

    def _expect_lamp_rotation(self, orientation: str) -> None:
        """Before ``orientation`` is published: the profile the lamp is about
        to run (_mount_profile_pending), when a server known to deliver will
        write it (_sync_lamp_rotation clears it). A lamp no server delivers to
        gets none, so its previews never turn for a write that fails."""
        rotation = self._rotation_for(orientation)
        link, channel = self._matter, self._matter_commands
        if (
            rotation is not None and channel is not None and channel.backend is not None
            and link is not None and link.linked and link.values.get("rotation") != rotation
        ):
            self._mount_profile_pending = rotation

    async def _sync_lamp_rotation(self, orientation: str, *, force: bool = False) -> bool:
        """Set the lamp's own direction setting (its mount profile,
        mount_profile.py) to the Device Orientation over Matter
        (matter_commands.py), as the Yeelight app's orientation page does:
        the lamp turns the clock for the mount (native effects are
        compensated for any profile, light_native). True when it was written
        now (the lamp applies it to the next clock or effect it starts);
        False when it already matched (unless ``force``: a value read on a
        node not confirmed yet may not be the lamp's) or no server delivers
        it (as before). A write confirms the profile on this node."""
        rotation = self._rotation_for(orientation)
        link, channel = self._matter, self._matter_commands
        if rotation is None or channel is None or link is None or not link.linked:
            return False
        if link.values.get("rotation") == rotation and not force:
            return False
        node = link.node_id
        cube = self._lamp_client
        if getattr(self, "is_cube_matrix", False) and cube is not None:
            # A Cube Matrix saves the rotation only with a later request, and
            # never while its music mode is on (tested 2026-11-12: written
            # with a music connection open, gone after a power cut): ours is
            # closed first (the next frame opens it again).
            cube.close_music_session()
        # While it is written, the previews follow the profile the lamp is
        # about to run (light_mount_profile.lamp_turns_clock), not the old one.
        self._mount_profile_pending = rotation
        try:
            await asyncio.wait_for(channel.async_write(ROTATION, rotation), ROTATION_WRITE_TIMEOUT)
        except MatterCommandsUnavailable:
            return False
        except Exception as err:  # noqa: BLE001 -- the lamp keeps its direction
            _LOGGER.warning("[MATTER] [%s] Could not set the lamp's direction: %s", self._ip, err)
            return False
        finally:
            self._mount_profile_pending = None
        _LOGGER.info("[MATTER] [%s] Lamp direction set to %s", self._ip, orientation)
        # As the lamp will report it: previews turn now, its echo is no change.
        link.values["rotation"] = rotation
        self._lamp_rotation_seen = rotation
        if note := getattr(self, "matrix_note_rotation", None):
            note(rotation)
        if link.node_id == node:
            self._store_mount_profile(rotation, SOURCE_MATTER, node)
        return True

    def _mount_profile_confirmed(self) -> bool:
        """Whether the linked node's rotationAngle is the lamp's profile: it
        was written here, or changed in the Yeelight app, since this node was
        linked. A lamp re-added after a factory reset is a new node (it reads
        0 while it runs 3), so it is not."""
        link, entry = self._matter, self._config_entry
        return bool(
            link is not None and link.linked and entry is not None
            and entry.options.get(CONF_MOUNT_PROFILE_NODE) == link.node_id
        )

    @callback
    def _check_mount_profile(self) -> None:
        """A node not confirmed yet. A value only a save gives (set in the
        Yeelight app, mount_profile.saved_on_lamp) is the lamp's: kept as it
        is, never overwritten. The Wi-Fi chip's default (0 with no saved
        topology: a lamp never saved, or reset, running 3): the Device
        Orientation is written once (per node and server that delivers
        commands), then trusted."""
        link = self._matter
        if link is None or not link.linked or self._mount_profile_confirmed():
            return
        rotation = link.values.get("rotation")
        if saved_on_lamp(rotation, link.values.get("topology")):
            _LOGGER.info(
                "[MATTER] [%s] Lamp direction %s saved on the lamp: followed",
                self._ip, rotation,
            )
            if self._store_mount_profile(rotation, SOURCE_MATTER, link.node_id):
                self._create_tracked_task(
                    self._async_reapply_for_mount_profile(lamp_changed=False),
                    name=f"yeelight_cube_mount_profile_{self._ip}",
                )
            return
        if self._mount_profile_write is not None:
            return
        channel = self._matter_commands
        tried = (link.node_id, channel.backend if channel is not None else None)
        if tried == self._mount_profile_tried:
            return
        self._mount_profile_tried = tried
        self._mount_profile_write = self._create_tracked_task(
            self._async_confirm_mount_profile(),
            name=f"yeelight_cube_mount_profile_{self._ip}",
        )

    async def _async_confirm_mount_profile(self) -> None:
        try:
            if not await self._sync_lamp_rotation(self._device_orientation, force=True):
                _LOGGER.debug(
                    "[MATTER] [%s] Lamp direction not confirmed (no server delivers "
                    "the write): its Matter value is not used", self._ip,
                )
                return
            _LOGGER.info(
                "[MATTER] [%s] Lamp direction confirmed on node %s",
                self._ip, self._matter.node_id if self._matter else None,
            )
            await self._async_reapply_for_mount_profile(lamp_changed=True)
        finally:
            self._mount_profile_write = None

    def _lamp_turned(self, rotation) -> None:
        """The Yeelight app's direction changed: the lamp saved it (the
        app's Save writes the lamp and this attribute alike), so this node's
        value is its profile from now on; and the same Device Orientation
        here (its arrows are the app's)."""
        link = self._matter
        if valid_profile(rotation) is not None and link is not None and link.linked:
            self._store_mount_profile(rotation, SOURCE_MATTER, link.node_id)
        orientation = ROTATION_ORIENTATIONS.get(rotation)
        if orientation is None or orientation == self._device_orientation:
            # Only the profile changed: effects are compensated anew.
            self._create_tracked_task(
                self._async_reapply_for_mount_profile(lamp_changed=False),
                name=f"yeelight_cube_mount_profile_{self._ip}",
            )
            return
        _LOGGER.info("[MATTER] [%s] Direction set to %s in the Yeelight app", self._ip, orientation)
        self._create_tracked_task(
            self.set_device_orientation(orientation),
            name=f"yeelight_cube_matter_orientation_{self._ip}",
        )
