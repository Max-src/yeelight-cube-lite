"""A stuck Cube Lite brought back over the LAN (link_recovery.realign).

When the problem check finds a Cube Lite that accepts connections but answers
nothing (issues: lamp_not_responding), the light tries link_recovery's sweep:
the lamp, once it answered, re-opens its internal link and restarts about
20 s later; its content is then drawn again. A few tries per stuck episode;
when none answers, the Power cycle sensor and its Repair stay as they are.
"""
from __future__ import annotations

import asyncio
import logging
import time

from .const import LAN_PORT
from .lamp_protocol import LAMP_ERRORS
from .light_connection import _get_device_lock
from .link_recovery import realign

_LOGGER = logging.getLogger(__name__)

# Tries per stuck episode, and the wait between two (s).
LINK_RECOVERY_TRIES = 3
LINK_RECOVERY_RETRY = 600.0
# The wait after a try that could not even connect (s): the lamp was off the
# network (seen 2026-11-16 18:27), which no try can mend.
LINK_RECOVERY_UNREACHABLE_RETRY = 60.0
# Such tries given back per stuck episode; after that one counts as a try: a
# lamp that stays off the network was swept every minute until it was power
# cycled (2026-11-20 13:19-13:26, "try 1 of 3" each time).
LINK_RECOVERY_UNREACHABLE_FREE = 3
# Seconds after the lamp answered the sweep before its content is drawn
# again: its restart comes about 18 s after the answer.
LINK_RECOVERY_RESTART_WAIT = 25.0
# A sweep started at once by the stream's Matter check (_link_recovery_now)
# comes at least this long after the one before: a lamp the sweep could not
# bring back is left to the problem check's tries.
LINK_RECOVERY_NOW_SPACING = 300.0


class LinkRecoveryMixin:
    """Bringing a stuck Cube Lite back without a power cycle."""

    def _link_recovery_due(self, problems: set[str]) -> None:
        """The problem check's verdict (light_lifecycle._async_check_problems):
        a stuck Cube Lite gets a sweep (one at a time, LINK_RECOVERY_TRIES per
        episode, LINK_RECOVERY_RETRY apart); a lamp that answers again ends
        the episode."""
        if "lamp_not_responding" not in problems:
            self._link_recovery_tries = 0
            self._link_recovery_misses = 0
            return
        if getattr(self, "is_cube_matrix", False) or self.hass is None:
            return
        task = getattr(self, "_link_recovery_task", None)
        if task is not None and not task.done():
            return
        tries = getattr(self, "_link_recovery_tries", 0)
        last = getattr(self, "_link_recovery_at", float("-inf"))
        if tries >= LINK_RECOVERY_TRIES or time.monotonic() - last < LINK_RECOVERY_RETRY:
            return
        self._link_recovery_tries = tries + 1
        self._link_recovery_at = time.monotonic()
        self._link_recovery_task = self._create_tracked_task(
            self._async_recover_link(), name=f"yeelight_cube_link_recovery_{self._ip}",
        )

    def _link_recovery_now(self) -> bool:
        """A sweep at once, without waiting for the problem check to report
        the lamp stuck (a minute of silence): the stream's Matter check found
        its LED part silent (light_studio._stream_recover_now), and the sweep
        works only before the lamp's network part restarts, 1.5 to 2.5
        minutes after (2026-11-16 and 20). Not while one runs, nor within
        LINK_RECOVERY_NOW_SPACING of the one before. Whether it started."""
        if getattr(self, "is_cube_matrix", False) or self.hass is None:
            return False
        task = getattr(self, "_link_recovery_task", None)
        if task is not None and not task.done():
            return False
        last = getattr(self, "_link_recovery_at", float("-inf"))
        if time.monotonic() - last < LINK_RECOVERY_NOW_SPACING:
            return False
        self._link_recovery_tries = getattr(self, "_link_recovery_tries", 0) + 1
        self._link_recovery_at = time.monotonic()
        self._link_recovery_task = self._create_tracked_task(
            self._async_recover_link(), name=f"yeelight_cube_link_recovery_{self._ip}",
        )
        return True

    async def _async_recover_link(self) -> bool:
        """One sweep (link_recovery.realign) under the lamp's lock, so nothing
        else reaches the lamp meanwhile; answered: the lamp's content again
        once it restarted. Whether it answered. While the sweep runs,
        operations on the lamp fail at once instead of waiting for it
        (_link_recovery_running, light_connection._execute_hardware_op)."""
        # Once per try: again after a try given back (unreachable) at INFO.
        _LOGGER.log(
            logging.INFO if getattr(self, "_link_recovery_misses", 0) else logging.WARNING,
            "[RECOVERY] [%s] The lamp is stuck: trying to bring it back over the LAN (try %s of %s)",
            self._ip, self._link_recovery_tries, LINK_RECOVERY_TRIES,
        )
        if cancel := getattr(self._lamp_client, "_cancel_frame_settle", None):
            cancel()  # no frame sent again during the sweep
        self._link_recovery_running = True
        try:
            async with _get_device_lock(self._ip):
                size = await realign(self._ip, LAN_PORT)
        except (asyncio.TimeoutError, *LAMP_ERRORS) as err:
            # Off the network (it accepts no connection): no try spent, tried
            # again once LINK_RECOVERY_UNREACHABLE_RETRY has passed, up to
            # LINK_RECOVERY_UNREACHABLE_FREE times an episode.
            misses = getattr(self, "_link_recovery_misses", 0) + 1
            self._link_recovery_misses = misses
            if misses > LINK_RECOVERY_UNREACHABLE_FREE:
                _LOGGER.info(
                    "[RECOVERY] [%s] Could not reach the lamp (%s): tried again in %.0f s",
                    self._ip, type(err).__name__, LINK_RECOVERY_RETRY,
                )
                return False
            _LOGGER.info(
                "[RECOVERY] [%s] Could not reach the lamp (%s): tried again in %.0f s",
                self._ip, type(err).__name__, LINK_RECOVERY_UNREACHABLE_RETRY,
            )
            self._link_recovery_tries -= 1
            self._link_recovery_at = time.monotonic() - LINK_RECOVERY_RETRY + LINK_RECOVERY_UNREACHABLE_RETRY
            return False
        finally:
            self._link_recovery_running = False
        if size is None:
            _LOGGER.warning(
                "[RECOVERY] [%s] The lamp did not answer: it needs a power cycle", self._ip,
            )
            return False
        _LOGGER.warning(
            "[RECOVERY] [%s] The lamp answered (link offset %s bytes): it restarts, its content "
            "follows in %.0f s", self._ip, size, LINK_RECOVERY_RESTART_WAIT,
        )
        await asyncio.sleep(LINK_RECOVERY_RESTART_WAIT)
        if not await self._lamp_client.probe(answering=True):
            _LOGGER.warning("[RECOVERY] [%s] The lamp answered, then went silent again", self._ip)
            return False
        # As the health check's own recovery (light_connection): a fresh
        # connection, UDP again, direct mode and brightness sent again.
        self._lamp_client.mark_recovered()
        self._outage_since = None
        self._silence_logged = False
        self._direct_mode_lost()
        self._forget_hardware_brightness()
        if self.hass is not None:
            self.async_write_ha_state()
        _LOGGER.warning("[RECOVERY] [%s] The lamp is back: drawing its content again", self._ip)
        await self.async_apply_display_mode(update_type="turn_on")
        self._async_check_problems()
        return True
