"""A Cube Matrix's settings over Matter: power-on behaviour, drawing
animation, its modules, its demo loop, and its own content refused or
tried again.
"""
from __future__ import annotations

import asyncio
import logging
import time

from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
)
from .device_profile import TOPOLOGY_NAMES, TOPOLOGY_SLOTS, profile_for
from .input_error import InputError
from .matrix_effects import (
    DRAWING_EFFECT,
    DRAWING_MIXERS,
)
from .matter_commands import CUBE_CONTROL_CLUSTER, EFFECTS_CLUSTER
from .matter_link import START_UP_ON_OFF
from .music_channel import tcp_request
from .light_matrix import (
    DEMO_READ_INTERVAL,
    MATTER_RETRY_LEAST,
    MATTER_RETRY_MOST,
    MUSIC_CLOSE_SETTLE,
    MatrixSettingUnavailable,
)

_LOGGER = logging.getLogger(__name__)


class MatrixSettingsMixin:
    """A Cube Matrix's settings over Matter."""

    # ── Settings over Matter ────────────────────────────────────────────
    async def async_set_matrix_power_on(self, value: str) -> None:
        """The Power-on behavior select: "on" or "off" at power-on, written
        to the lamp's Matter StartUpOnOff (the Yeelight app's On/Off; the
        lamp has no "restore"). Measured: 0 boots the lamp off."""
        if value not in ("on", "off"):
            raise ValueError(f"Unsupported power-on behavior: {value}")
        if not self.matrix_matter_ready():
            raise MatrixSettingUnavailable("power_on_needs_matter")
        await self._matter_commands.async_write(START_UP_ON_OFF, 1 if value == "on" else 0)
        self._matrix_power_on = value
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_set_matrix_drawing_animation(self, mixer: int) -> None:
        """The Drawing animation select (DRAWING_MIXERS): what the lamp does
        with a drawing it shows (static, scroll, breathe, flash, reveal);
        changed live on the one it shows, else used for the next."""
        if mixer not in DRAWING_MIXERS:
            raise ValueError(f"Unsupported drawing animation: {mixer}")
        self._matrix_drawing_mixer = mixer
        await self.async_matrix_drawing_changed()

    async def async_matrix_drawing_changed(self) -> None:
        """The drawing animation or its speed changed: sent live to a drawing
        the lamp shows, in the Yeelight app's order (setMixer, then the
        direction and the speed). Every FC05 command restarts the animation."""
        shown = self._matrix_shown
        if shown is None or (shown[1].get("effect") or {}).get("effectId") != DRAWING_EFFECT:
            return
        if not self.matrix_draws_over_matter():
            return
        channel = self._matter_commands
        self._matrix_command_at = time.monotonic()
        await channel.async_command(EFFECTS_CLUSTER, "setMixer", {"mixer": int(self._matrix_drawing_mixer)})
        if self._matrix_drawing_mixer in (2, 5):
            await channel.async_command(
                EFFECTS_CLUSTER, "setDirection", {"direction": int(self._matrix_drawing_direction)},
            )
        await channel.async_command(EFFECTS_CLUSTER, "setRate", {"rate": int(self._matrix_drawing_speed)})
        self._matrix_command_at = time.monotonic()
        params = dict(shown[1]["effect"]["effectParams"][0])
        params.update(mixer=int(self._matrix_drawing_mixer), speed=int(self._matrix_drawing_speed))
        self._matrix_shown = (shown[0], {**shown[1], "effect": {**shown[1]["effect"], "effectParams": [params]}})

    def _matrix_modules_changed(self, topology) -> None:
        """The lamp's module list changed (set in the Yeelight app, reported
        over Matter): the layout is built again (the pixels each module
        takes, the clock's Matrix modules, the drawings' length), and what
        is shown is shown again for it."""
        if not isinstance(topology, (list, tuple)):
            return
        profile = self._lamp_client.profile
        rebuilt = profile_for(
            "CubeMatrix", profile.support, ",".join(str(kind) for kind in topology), None, profile.rotation,
        )
        if tuple(rebuilt.module_types) == tuple(profile.module_types):
            return
        _LOGGER.info(
            "[MATRIX] [%s] Modules changed: %s -> %s", self._ip, profile.module_types, rebuilt.module_types,
        )
        self._lamp_client.profile = rebuilt
        self._matrix_shown = None
        self._matrix_rotated(rebuilt.rotation, start=True)
        if self._is_on and self.hass is not None:
            self._async_check_problems()
            self._create_tracked_task(
                self.async_apply_display_mode(update_type="text_change"),
                name=f"yeelight_cube_matrix_modules_{self._ip}",
            )

    async def async_set_matrix_modules(self, modules: list[str]) -> None:
        """Write the lamp's module list (the Yeelight app's module splicing:
        FC02 UpdateTopology over Matter), in chain order from the base:
        "matrix", "spot" or "panel", 1 to TOPOLOGY_SLOTS of them. The lamp
        cannot tell which modules are fitted: the list must name them as they
        are. It keeps the list (a power cut too), lays its own effects and
        clock out for it, and reports it back (_matrix_modules_changed)."""
        if not self.is_cube_matrix:
            raise InputError("matrix_modules_not_matrix")
        codes = {name: code for code, name in TOPOLOGY_NAMES.items()}
        if not 1 <= len(modules) <= TOPOLOGY_SLOTS or any(name not in codes for name in modules):
            raise InputError("matrix_modules_invalid", count=str(TOPOLOGY_SLOTS))
        if not self.matrix_matter_ready():
            raise InputError("matrix_modules_need_matter")
        topology = [codes[name] for name in modules]
        # Our music connection open, the lamp skips saving some settings
        # (the rotation, 2026-11-12): closed first.
        if self._lamp_client.close_music_session():
            await asyncio.sleep(MUSIC_CLOSE_SETTLE)
        self._matrix_command_at = time.monotonic()
        await self._matter_commands.async_command(CUBE_CONTROL_CLUSTER, "updateTopology", {"topology": topology})
        _LOGGER.info("[MATRIX] [%s] Modules set: %s", self._ip, modules)
        self._matrix_modules_changed(topology)
        if self.hass is not None:
            self.async_write_ha_state()

    def _set_matrix_demo(self, *, lan: bool | None = None, matter: bool | None = None) -> None:
        before = self.matrix_demo_mode
        if lan is not None:
            self._matrix_demo_lan = lan
            if not lan:
                # A lamp read out of the loop (a factory reset) is not in it.
                self._matrix_demo_matter = False
                self._matrix_demo_watch.reset()
        if matter is not None:
            self._matrix_demo_matter = matter
        if self.matrix_demo_mode == before:
            return
        _LOGGER.warning(
            "[MATRIX] [%s] Demo mode %s: %s", self._ip, "on" if self.matrix_demo_mode else "off",
            "streamed over the LAN" if self.matrix_demo_mode else "the lamp's own effects over Matter again",
        )
        if self.hass is not None:
            self._async_check_problems()
            self._matrix_matter_changed()

    def _check_matrix_demo(self) -> None:
        """Read show_off_mode over the LAN, at most every DEMO_READ_INTERVAL
        (from the minute check)."""
        if not self.is_cube_matrix or self._matrix_demo_task is not None:
            return
        now = time.monotonic()
        if self._matrix_demo_read_at is not None and now - self._matrix_demo_read_at < DEMO_READ_INTERVAL:
            return
        self._matrix_demo_read_at = now

        async def read() -> None:
            try:
                answer = await tcp_request(self._ip, "get_prop", ["show_off_mode"])
                values = (answer or {}).get("result") or []
                if values and str(values[0]) in ("0", "1"):
                    self._set_matrix_demo(lan=str(values[0]) == "1")
            finally:
                self._matrix_demo_task = None

        self._matrix_demo_task = self._create_tracked_task(
            read(), name=f"yeelight_cube_matrix_demo_{self._ip}",
        )

    def _refuse_matrix_native(self) -> None:
        """Matter failed: what is selected is streamed over the LAN until
        Matter is tried again (_retry_matrix_native)."""
        if not self._matrix_native_refused:
            self._matrix_refused_at = time.monotonic()
        self._matrix_native_refused = True

    def _retry_matrix_native(self, link_back: bool = False) -> bool:
        """Try Matter again for a lamp streamed since Matter failed: from the
        minute check once MATTER_RETRY_FIRST (then twice as long, up to
        MATTER_RETRY_MOST) has passed, or when the Matter link comes back
        (``link_back``, after MATTER_RETRY_LEAST). What is selected is then
        shown again the way it now can be (_matrix_matter_changed): by the
        lamp itself, or streamed over Matter. Whether it did."""
        if not self._matrix_native_refused:
            return False
        if self.is_cube_matrix and not self.matrix_matter_ready():
            return False
        if not self.is_cube_matrix:
            # A Cube Lite's stream over Matter (light_matrix): its own check,
            # the refusal aside.
            self._matrix_native_refused = False
            ready = self.lite_streams_over_matter()
            self._matrix_native_refused = True
            if not ready:
                return False
        waited = time.monotonic() - self._matrix_refused_at
        if waited < (MATTER_RETRY_LEAST if link_back else self._matrix_retry_after):
            return False
        self._matrix_native_refused = False
        self._matrix_stream_failures = 0
        # Failing again waits twice as long; a success resets it.
        self._matrix_retry_after = min(MATTER_RETRY_MOST, self._matrix_retry_after * 2)
        _LOGGER.info("[MATRIX] [%s] Trying Matter again after it failed %.0f s ago", self._ip, waited)
        self._matrix_matter_changed()
        return True

    def _matrix_matter_changed(self) -> None:
        """Matter became available or not (the link, the server, the demo
        loop): what is selected is shown again the way it now can be."""
        if not self.is_cube_matrix or not self._is_on or self.hass is None:
            return
        native = self.matrix_native_command() is not None
        if self._mode in (MODE_NATIVE_EFFECT, MODE_CLOCK):
            if native == (self._matrix_shown is not None):
                return
        elif self.matrix_draws_over_matter() == (self._matrix_shown is not None):
            return
        self._matrix_shown = None
        self._create_tracked_task(
            self.async_apply_display_mode(update_type="text_change"),
            name=f"yeelight_cube_matrix_matter_{self._ip}",
        )
