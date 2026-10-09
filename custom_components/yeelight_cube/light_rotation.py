"""Effect / clock rotation and favourites for the Yeelight Cube Lite light entity.

A server-side loop advances the lamp through a list of native effects or clock
styles on a time grid shared by every lamp started together, independently of
any dashboard, and resumes after a restart or reconnection. Favourites and the
rotation interval are stored per lamp with the integration data, so every
dashboard shows the same. Mixed into YeelightCubeLight.
"""
import logging
import asyncio
import time

from homeassistant.exceptions import HomeAssistantError  # type: ignore

from .color_utils import argb_to_rgb, rgb_to_argb
from .const import (
    ALL_NATIVE_EFFECTS,
    CLOCK_COLOR_MODES,
    DOMAIN,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    NATIVE_CLOCK_STYLES,
    ROTATION_KIND_MODES,
)
from .cube_matrix import CubeConnectionError
from .light_connection import CIRCUIT_BREAKER_WINDOW

_LOGGER = logging.getLogger(__name__)

FAVOURITE_KINDS = ("native", "clock")
# Rotation interval bounds (seconds). A step that takes longer to apply than
# the interval lands on the next boundary of the shared time grid.
MIN_ROTATION_INTERVAL = 1
MAX_ROTATION_INTERVAL = 604800  # 7 days
MAX_FAVOURITES = 100          # per lamp and kind
MAX_FAVOURITE_NAME = 100


# Shared schedules for lamps resuming the same multi-lamp rotation after a
# restart: the first lamp creates it, the others join, so the group shows the
# same item at each step again. Keyed by the group, kind and interval.
_ROTATION_RESUME_TIMELINES: dict = {}


ROTATION_RESUME_TIMELINE_TTL = 300.0  # seconds a late lamp can still join

# Lamps whose rotation loop runs: a lamp starting the same rotation alone
# (the card's Retry, a manual start) joins their schedule.
_ROTATING_LAMPS: dict = {}  # id(lamp) -> lamp

# Seconds before a lamp that answers but failed a step (a refusal, e.g. its
# rate limit) tries again: growing, then every 5 minutes. A lamp that was
# unreachable resumes as soon as it answers.
ROTATION_RESUME_BACKOFF = (30.0, 60.0, 120.0, 300.0)


def _hold_rotation_for_resume(light) -> bool:
    """Keep a failed rotation due on ``light`` instead of dropping it.

    The health check resumes it (``_resume_rotation_after_reconnect``) once
    the lamp answers, after a growing delay while it answers but refuses,
    and it then shows the group's current item. False when the lamp should
    not rotate any more (off, calibrating, stopped).
    """
    if not (light._rotation_active and light._is_on and not light._calibration_lock):
        return False
    failures = getattr(light, "_rotation_resume_failures", 0)
    light._rotation_resume_pending = True
    light._rotation_waiting_for_reconnect = True
    light._rotation_retry_at = (
        None if light._cube_matrix.is_unreachable
        else time.time() + ROTATION_RESUME_BACKOFF[min(failures, len(ROTATION_RESUME_BACKOFF) - 1)]
    )
    light._rotation_resume_failures = failures + 1
    return True


def _rotation_peer(light, kind, interval, items):
    """A lamp already running this rotation (same kind, interval and modes),
    whose schedule ``light`` can join; None if there is none."""
    names = [item["name"] for item in items]
    for other in list(_ROTATING_LAMPS.values()):
        if (
            other is not light
            and other._rotation_active
            and other._rotation_timeline is not None
            and other._rotation_kind == kind
            and other._rotation_interval == interval
            and [item["name"] for item in other._rotation_items] == names
        ):
            return other
    return None


class RotationMixin:
    """Server-side effect / clock rotation, favourites and their persistence."""

    def _rotation_current_name(self) -> str | None:
        """Return the key of the mode the lamp is currently showing.

        For native effects this is the effect name.  For the clock it is the
        built-in style name, or ``custom:<id>`` when a saved solid-color
        preset is active (mirrors the card's ``clockPresetKey`` mapping).
        """
        if self._rotation_kind != "clock":
            return self._native_effect
        color = self._native_clock_color
        if color is not None:
            r, g, b = argb_to_rgb(color)
            for preset in self.hass.data.get(DOMAIN, {}).get("clock_presets", []):
                if preset.get("kind", "style") == "style" and list(
                    preset.get("color", ())
                ) == [r, g, b]:
                    return f"custom:{preset['id']}"
        style = NATIVE_CLOCK_STYLES.get(self._native_clock_style)
        return style["name"] if style else None

    def _normalize_rotation_items(self, items) -> list:
        """Normalize rotation entries to ``{"name", "color_mode", "color"}`` dicts.

        Accepts legacy plain strings (color mode defaults to "normal") and
        dicts of the form ``{"name": ..., "color_mode": ..., "color": [r,g,b]}``
        produced by the cards' favourites system.
        """
        result = []
        seen = set()
        for entry in items or []:
            if isinstance(entry, str):
                name, color_mode, color = entry.strip(), "normal", None
            elif isinstance(entry, dict):
                name = str(entry.get("name", "")).strip()
                color_mode = entry.get("color_mode") or "normal"
                color = entry.get("color")
            else:
                continue
            if not name:
                continue
            if color_mode not in CLOCK_COLOR_MODES and color_mode != "custom":
                color_mode = "normal"
            if color_mode == "custom":
                if (
                    isinstance(color, (list, tuple))
                    and len(color) == 3
                    and all(isinstance(c, int) and 0 <= c <= 255 for c in color)
                ):
                    color = list(color)
                else:
                    # A custom mode without a valid color falls back to normal.
                    color_mode, color = "normal", None
            else:
                color = None
            # Uniqueness is per (name, color mode): the same style may appear
            # twice when favourited under two different color modes.
            color_key = (name, color_mode, tuple(color) if color else None)
            if color_key in seen:
                continue
            seen.add(color_key)
            result.append(
                {"name": name, "color_mode": color_mode, "color": color}
            )
        return result

    def _normalize_favourites(self, items) -> list:
        """Normalize a favourites list the way rotation items are normalized
        (same entries, de-duplicated per name + color mode), dropping names
        the cards never create (numeric) and capping its length."""
        return [
            item
            for item in self._normalize_rotation_items(items)
            if not item["name"].isdigit() and len(item["name"]) <= MAX_FAVOURITE_NAME
        ][:MAX_FAVOURITES]

    def _device_store(self, name: str) -> dict | None:
        """A persisted per-lamp collection (``favourites``, ``rotation``) in
        hass.data[DOMAIN], keyed like the music-flow runtime state (config
        entry id, else IP)."""
        if self.hass is None:
            return None
        domain_data = self.hass.data.get(DOMAIN)
        if not isinstance(domain_data, dict):
            return None
        store = domain_data.setdefault(name, {})
        if not isinstance(store, dict):
            store = domain_data[name] = {}
        return store

    def _favourites_store(self) -> dict | None:
        return self._device_store("favourites")

    def _restore_favourites(self) -> None:
        store = self._favourites_store()
        saved = store.get(self._music_flow_runtime_storage_key()) if store else None
        if not isinstance(saved, dict):
            return
        self._favourites = {
            kind: self._normalize_favourites(items)
            for kind, items in saved.items()
            if kind in FAVOURITE_KINDS and isinstance(items, list)
        }

    async def async_set_favourites(self, kind: str, items) -> None:
        """Replace the favourites of ``kind``, publish them, then persist."""
        if kind not in FAVOURITE_KINDS:
            raise HomeAssistantError(f"Unknown favourites kind: {kind}")
        self._favourites = {**self._favourites, kind: self._normalize_favourites(items)}
        # Publish first: every open dashboard updates without waiting for disk.
        if self.hass is not None:
            self.async_write_ha_state()
        store = self._favourites_store()
        if store is None:
            return
        store[self._music_flow_runtime_storage_key()] = {
            key: [dict(item) for item in value]
            for key, value in self._favourites.items()
        }
        self._schedule_integration_save()

    def _schedule_integration_save(self) -> None:
        """Save hass.data[DOMAIN] (palettes, favourites, rotation, ...) to
        disk shortly: a burst of changes becomes one write."""
        from . import async_schedule_save

        async_schedule_save(self.hass)

    def _restore_rotation_settings(self) -> None:
        store = self._device_store("rotation")
        saved = store.get(self._music_flow_runtime_storage_key()) if store else None
        if not isinstance(saved, dict):
            return
        intervals = saved.get("intervals")
        if isinstance(intervals, dict):
            self._rotation_intervals = {
                kind: max(MIN_ROTATION_INTERVAL, min(MAX_ROTATION_INTERVAL, int(value)))
                for kind, value in intervals.items()
                if kind in FAVOURITE_KINDS and isinstance(value, (int, float))
            }
        active = saved.get("active")
        if isinstance(active, dict) and active.get("kind") in FAVOURITE_KINDS:
            self._rotation_restore = active

    def _save_rotation_state(self) -> None:
        """Persist the shared intervals and the running rotation (if any), so
        a Home Assistant restart or integration reload resumes it."""
        store = self._device_store("rotation")
        if store is None:
            return
        running = None
        if self._rotation_active or self._rotation_resume_pending:
            running = {
                "kind": self._rotation_kind,
                "items": [dict(item) for item in self._rotation_items],
                "interval": self._rotation_interval,
                "group": list(self._rotation_group or []),
            }
        record = {"intervals": dict(self._rotation_intervals), "active": running}
        key = self._music_flow_runtime_storage_key()
        # Most stops happen with no rotation running (e.g. every turn-off):
        # nothing changed, nothing to write.
        if store.get(key) == record:
            return
        store[key] = record
        if self.hass is not None:
            self._schedule_integration_save()

    async def _async_resume_saved_rotation(self) -> None:
        """Resume the rotation that ran before the restart, if the lamp is
        still on and in that mode (turning it off or switching mode stops a
        rotation, so neither is overridden here)."""
        saved, self._rotation_restore = self._rotation_restore, None
        if not saved:
            return
        kind = saved.get("kind")
        expected_mode = ROTATION_KIND_MODES.get(kind, MODE_NATIVE_EFFECT)
        if (
            not self._is_on
            or self._music_flow_enabled
            or self._calibration_lock
            or self._mode != expected_mode
        ):
            _LOGGER.info(
                "[ROTATION] [%s] Not resuming the %s rotation after restart "
                "(lamp off or no longer in %s mode)", self._ip, kind, expected_mode,
            )
            self._save_rotation_state()
            return
        interval = saved.get("interval", 60)
        group = sorted(saved.get("group") or [])
        timeline = None
        if len(group) > 1:
            # Lamps started together share one schedule again.
            now = asyncio.get_running_loop().time()
            key = (tuple(group), kind, interval)
            shared = _ROTATION_RESUME_TIMELINES.get(key)
            if shared is None or now - shared["created"] > ROTATION_RESUME_TIMELINE_TTL:
                shared = _ROTATION_RESUME_TIMELINES[key] = {"created": now, "timeline": {}}
            timeline = shared["timeline"]
        try:
            await self.start_effect_rotation(
                saved.get("items") or [], interval, kind,
                timeline=timeline, group=group or None,
            )
            _LOGGER.info("[ROTATION] [%s] Resumed the %s rotation after restart", self._ip, kind)
        except HomeAssistantError as err:
            # An unreachable lamp keeps the rotation pending: the health check
            # resumes it once the lamp answers again.
            _LOGGER.warning(
                "[ROTATION] [%s] Could not resume the %s rotation yet: %s",
                self._ip, kind, err,
            )

    def set_rotation_interval(self, kind: str, interval) -> None:
        """Set the interval every dashboard uses for ``kind``. A running
        rotation of that kind switches to it at once, keeping its current item
        until the next step on the new time grid."""
        if kind not in FAVOURITE_KINDS:
            raise HomeAssistantError(f"Unknown rotation kind: {kind}")
        interval = max(MIN_ROTATION_INTERVAL, min(MAX_ROTATION_INTERVAL, int(interval)))
        self._rotation_intervals = {**self._rotation_intervals, kind: interval}
        if (
            self._rotation_kind == kind
            and (self._rotation_active or self._rotation_resume_pending)
            and interval != self._rotation_interval
        ):
            self._retime_rotation(interval)
        if self.hass is not None:
            self.async_write_ha_state()
        self._save_rotation_state()

    def _retime_rotation(self, interval: int) -> None:
        loop = asyncio.get_running_loop()
        self._rotation_interval = interval
        # The next boundary of the new grid shows the item after the current one.
        self._rotation_timeline = {
            "tick": int(loop.time() // interval) + 1,
            "index": self._rotation_index + 1,
        }
        # A sleeping loop re-times its wait; a rotation waiting to reconnect
        # simply resumes on the new grid.
        task = self._rotation_task
        if task is not None and not task.done():
            self._rotation_retime = True
            if self._rotation_wake is not None:
                self._rotation_wake.set()

    async def start_effect_rotation(
        self, items, interval, kind="native", *, timeline=None, group=None
    ) -> None:
        """Start an entity-owned loop, acknowledging only its first display result.

        Returning before that result hides hardware failures from the calling
        service. Subsequent steps belong to the entity, not the service/client.
        """
        items = self._normalize_rotation_items(items)
        if len(items) < 2:
            raise HomeAssistantError("Provide at least two different rotation modes")
        # Replacing a running loop: its saved state is rewritten below.
        self.stop_effect_rotation(persist=False)
        self._rotation_error = None
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        self._rotation_kind = kind if kind in ("native", "clock") else "native"
        self._rotation_items = items
        # The lamps started together (one service call), saved so a restart
        # resumes them on one schedule.
        self._rotation_group = sorted(group) if group else None
        self._rotation_interval = max(
            MIN_ROTATION_INTERVAL, min(MAX_ROTATION_INTERVAL, int(interval))
        )
        current = self._rotation_current_name()
        names = [item["name"] for item in items]
        self._rotation_index = names.index(current) if current in names else -1
        if timeline is None:
            # Started alone (the card's Retry, a manual start) while other
            # lamps run this rotation: show what they show, on their grid.
            peer = _rotation_peer(self, self._rotation_kind, self._rotation_interval, items)
            if peer is not None:
                timeline = dict(peer._rotation_timeline)
                me = getattr(self, "entity_id", None)
                joined = sorted(
                    (set(peer._rotation_group or [getattr(peer, "entity_id", None)]) | {me})
                    - {None}
                )
                if len(joined) > 1:
                    self._rotation_group = joined
                    peer._rotation_group = joined
                    peer._save_rotation_state()
            else:
                timeline = {}
        timeline.setdefault("tick", int(asyncio.get_running_loop().time() // self._rotation_interval))
        timeline.setdefault("index", self._rotation_index + 1)
        self._rotation_timeline = dict(timeline)
        self._rotation_retime = False
        self._rotation_active = True
        self._rotation_resume_failures = 0
        _ROTATING_LAMPS[id(self)] = self
        # Starting sets the interval every dashboard uses for this kind, and
        # saves the rotation so a restart resumes it.
        self._rotation_intervals = {
            **self._rotation_intervals,
            self._rotation_kind: self._rotation_interval,
        }
        self._save_rotation_state()
        self._rotation_wake = asyncio.Event()
        started = asyncio.get_running_loop().create_future()
        self._rotation_started = started
        self._rotation_task = self._create_tracked_task(
            self._rotation_loop(), name=f"yeelight_cube_rotation_{self._ip}"
        )
        if not await asyncio.shield(started):
            raise HomeAssistantError(
                self._rotation_error or "Rotation stopped before its first display update"
            )

    def stop_effect_rotation(self, persist: bool = True) -> None:
        """Stop the server-side rotation loop.

        ``persist=False`` keeps the saved rotation (entity removal on a
        shutdown/reload, or a Start replacing the loop); every other stop (the
        Stop button, a manual pick, lamp off, ...) also forgets it, so it is
        not resumed after a restart.
        """
        self._rotation_active = False
        self._rotation_resume_pending = False
        self._rotation_waiting_for_reconnect = False
        self._rotation_error = None
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        self._rotation_resume_failures = 0
        _ROTATING_LAMPS.pop(id(self), None)
        if self._rotation_task and not self._rotation_task.done():
            self._rotation_task.cancel()
        self._rotation_task = None
        self._rotation_wake = None
        if self._rotation_started is not None and not self._rotation_started.done():
            self._rotation_started.set_result(False)
        if persist:
            self._save_rotation_state()
        if self.hass is not None:
            self.async_write_ha_state()

    def _resume_rotation_after_reconnect(self) -> bool:
        if not self._rotation_waiting_for_reconnect:
            return False
        expected_mode = ROTATION_KIND_MODES.get(self._rotation_kind, MODE_NATIVE_EFFECT)
        if (
            not self._is_on or self._calibration_lock or self._music_flow_enabled
            or self._mode != expected_mode or len(self._rotation_items) < 2
        ):
            self.stop_effect_rotation()
            return False
        if self._rotation_active:
            return True
        if self._rotation_retry_at is not None and time.time() < self._rotation_retry_at:
            # Still backing off after a refused step: resumed later.
            return True
        self._rotation_resume_pending = False
        self._rotation_waiting_for_reconnect = False
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        self._rotation_index -= 1
        self._rotation_retime = False
        self._rotation_active = True
        _ROTATING_LAMPS[id(self)] = self
        self._rotation_wake = asyncio.Event()
        self._rotation_started = asyncio.get_running_loop().create_future()
        self._rotation_task = self._create_tracked_task(
            self._rotation_loop(), name=f"yeelight_cube_rotation_{self._ip}"
        )
        if self.hass is not None:
            self.async_write_ha_state()
        return True

    def _rotation_scheduled_index(self) -> int:
        timeline = self._rotation_timeline
        if timeline is None:
            return (self._rotation_index + 1) % len(self._rotation_items)
        tick = int(asyncio.get_running_loop().time() // self._rotation_interval)
        return (timeline["index"] + tick - timeline["tick"]) % len(self._rotation_items)

    def skip_effect_rotation(self) -> None:
        """Advance to the next mode immediately instead of waiting."""
        wake = self._rotation_wake
        if self._rotation_active or self._rotation_resume_pending:
            if self._rotation_timeline is not None:
                self._rotation_timeline["index"] += 1
        if self._rotation_active and wake is not None:
            wake.set()

    async def _rotation_loop(self) -> None:
        """Advance through the rotation list on a shared time grid.

        Each step is applied, then the loop sleeps until the next interval
        boundary on the event loop's monotonic clock.  Every lamp in this Home
        Assistant process shares that clock, so they advance at the same
        absolute instants even though each apply takes a different amount of
        time.  A slow apply that overruns a boundary realigns to the following
        one instead of accumulating drift.
        """
        task = asyncio.current_task()
        started = self._rotation_started
        loop = asyncio.get_running_loop()
        cancelled = False
        try:
            while self._rotation_active:
                interval = self._rotation_interval
                self._rotation_index = self._rotation_scheduled_index()
                item = self._rotation_items[self._rotation_index]
                name = item["name"]
                try:
                    ok = await self._apply_rotation_step(item)
                except Exception as exc:  # noqa: BLE001 — keep rotation isolated
                    _LOGGER.warning(
                        "[ROTATION] [%s] Failed to apply %s: %s",
                        self._ip, name, exc,
                    )
                    self._rotation_error = str(exc)
                    ok = False
                if not ok or not self._rotation_active:
                    self._rotation_error = self._rotation_error or (
                        "Lamp is off" if not self._is_on else
                        "Calibration lock is active" if self._calibration_lock else
                        self._last_connection_error or
                        f"Display update failed for {name}"
                    )
                    # Once running (a step shown, or resumed after a pause),
                    # any failed step keeps the lamp in its rotation; a new
                    # start's first failure is reported to the starter.
                    if (
                        not ok
                        and (started.done() or getattr(self, "_rotation_resume_failures", 0))
                        and not self._rotation_resume_pending
                    ):
                        _hold_rotation_for_resume(self)
                    if self._rotation_resume_pending:
                        _LOGGER.warning(
                            "[ROTATION] [%s] Paused: %s -- resuming on the shared schedule %s",
                            self._ip, self._rotation_error,
                            "when the lamp answers" if self._rotation_retry_at is None
                            else f"in {self._rotation_retry_at - time.time():.0f}s",
                        )
                    else:
                        _LOGGER.warning("[ROTATION] [%s] Stopped: %s", self._ip, self._rotation_error)
                    break
                if not started.done():
                    started.set_result(True)
                self._rotation_resume_failures = 0
                if self.hass is not None:
                    self.async_write_ha_state()
                if (
                    self._rotation_timeline is not None
                    and self._rotation_index != self._rotation_scheduled_index()
                ):
                    continue
                # Sleep until the next boundary on the shared monotonic clock
                # (or a manual skip).
                next_tick = (int(loop.time() // interval) + 1) * interval
                while self._rotation_wake is not None:
                    delay = next_tick - loop.time()
                    if delay <= 0:
                        # A slow apply overran the boundary — realign to the next.
                        next_tick = (int(loop.time() // interval) + 1) * interval
                        continue
                    try:
                        await asyncio.wait_for(
                            self._rotation_wake.wait(), timeout=delay
                        )
                    except asyncio.TimeoutError:
                        pass
                    if self._rotation_wake is not None:
                        self._rotation_wake.clear()
                    if self._rotation_retime:
                        # The interval changed: keep the current item and wait
                        # for the next boundary of the new grid.
                        self._rotation_retime = False
                        interval = self._rotation_interval
                        next_tick = (int(loop.time() // interval) + 1) * interval
                        continue
                    break
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            if not started.done():
                started.set_result(False)
            # A replaced loop must not clear the new loop's state.
            if self._rotation_task is task:
                self._rotation_active = False
                self._rotation_task = None
                _ROTATING_LAMPS.pop(id(self), None)
                # A paused rotation keeps the time it resumes at.
                if not self._rotation_resume_pending:
                    self._rotation_retry_at = None
                # Ended by itself (failure, lamp off): forget it unless it is
                # waiting to resume. Cancelled (shutdown): keep it saved.
                if not cancelled:
                    self._save_rotation_state()
                if self.hass is not None:
                    self.async_write_ha_state()

    async def _wait_rotation_retry(self, delay: float) -> bool:
        deadline = asyncio.get_running_loop().time() + delay
        while self._rotation_active and self._is_on and not self._calibration_lock:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return True
            await asyncio.sleep(min(remaining, 1.0))
        return False

    async def _apply_rotation_step(self, item) -> bool:
        self._rotation_retry_attempt = 0
        self._rotation_retry_at = None
        for attempt in range(3):
            if not self._rotation_active or not self._is_on or self._calibration_lock:
                if not self._is_on:
                    self._rotation_error = "Lamp is off"
                elif self._calibration_lock:
                    self._rotation_error = "Calibration lock is active"
                return False
            self._hardware_failure_retryable = False
            try:
                success = await self._apply_rotation_item(item)
            except (CubeConnectionError, OSError, asyncio.TimeoutError) as error:
                self._last_connection_error = str(error) or "Device timeout"
                self._hardware_failure_retryable = True
                success = False
            if success:
                if attempt:
                    _LOGGER.info("[ROTATION] [%s] Recovered %s after %s retries", self._ip, item["name"], attempt)
                self._rotation_error = None
                self._rotation_resume_pending = False
                self._rotation_waiting_for_reconnect = False
                self._rotation_retry_attempt = 0
                self._rotation_retry_at = None
                return True
            self._rotation_error = self._last_connection_error or f"Display update failed for {item['name']}"
            if not self._hardware_failure_retryable or attempt == 2:
                self._rotation_resume_pending = False
                self._rotation_waiting_for_reconnect = False
                if self._hardware_failure_retryable:
                    # The lamp may answer later: resumed by the health check
                    # (at once after an outage, after a back-off otherwise).
                    _hold_rotation_for_resume(self)
                return False
            delay = (5.0, 15.0)[attempt]
            recent = [stamp for stamp in self._hard_timeout_times if time.time() - stamp < CIRCUIT_BREAKER_WINDOW]
            if len(recent) >= 2:
                delay = max(delay, max(recent) + CIRCUIT_BREAKER_WINDOW - time.time() + 0.1)
            self._rotation_retry_attempt = attempt + 1
            self._rotation_retry_at = time.time() + delay
            _LOGGER.warning(
                "[ROTATION] [%s] %s step=%s retry=%s/2 in %.1fs: %s",
                self._ip, self._rotation_kind, item["name"], attempt + 1, delay, self._rotation_error,
            )
            if self.hass is not None:
                self.async_write_ha_state()
            if not await self._wait_rotation_retry(delay):
                self._rotation_retry_at = None
                if not self._is_on:
                    self._rotation_error = "Lamp is off"
                elif self._calibration_lock:
                    self._rotation_error = "Calibration lock is active"
                return False
            self._rotation_retry_at = None
        return False

    async def _apply_rotation_item(self, item) -> bool:
        """Apply one rotation item; return False to stop the loop."""
        if not self._is_on:
            _LOGGER.debug("[ROTATION] [%s] Lamp off -- stopping rotation", self._ip)
            return False
        if self._rotation_kind == "clock":
            return await self._apply_rotation_clock(item)
        return await self._apply_rotation_native(item)

    async def _start_rotation_apply(self) -> bool:
        """Run the guards + reset the full display pipeline performs before a
        firmware mode switch, without its retry bookkeeping or queue overhead.

        Returns False when the lamp cannot take a rotation step right now.
        """
        if self._calibration_lock:
            _LOGGER.debug(
                "[ROTATION] [%s] Calibration lock active -- stopping rotation",
                self._ip,
            )
            return False
        if self._music_flow_enabled:
            await self.async_set_music_flow(False, restore_display=False)
        # Applying a new clock/effect clears any frozen frame, exactly like the
        # full _apply_display_mode_internal path does.
        self._display_frozen = False
        self._display_frozen_at = None
        self._is_scrolling = False
        self.stop_scroll_timer()
        return True

    async def _apply_rotation_native(self, item) -> bool:
        name = item["name"]
        color_mode = item.get("color_mode", "normal")
        color = item.get("color")
        spec = ALL_NATIVE_EFFECTS.get(name)
        if spec is None:
            _LOGGER.debug("[ROTATION] [%s] Unknown native effect %s -- skipped", self._ip, name)
            return True
        if spec.get("extended") and not self._extended_effects_enabled:
            _LOGGER.debug(
                "[ROTATION] [%s] Experimental effect %s skipped (Experimental Features off)",
                self._ip, name,
            )
            return True
        self._native_effect = name
        self._mode = MODE_NATIVE_EFFECT
        self._custom_draw_active = False
        # Reapply the color mode recorded with the favourite. The firmware
        # represents a free custom color as mode "normal" plus an RGB override.
        self._native_effect_color_mode = (
            "normal" if color_mode == "custom" else color_mode
        )
        self._native_effect_color = (
            list(color) if color_mode == "custom" and color else None
        )
        if not await self._start_rotation_apply():
            return False
        if not await self._execute_hardware_op(
            lambda: self._activate_native_effect(), "rotation:native"
        ):
            return False
        self._refresh_linked_entities()
        if self.hass is not None:
            self.async_write_ha_state()
        return True

    async def _apply_rotation_clock(self, item) -> bool:
        name = item["name"]
        color_mode = item.get("color_mode", "normal")
        color = item.get("color")
        if name.startswith("custom:"):
            preset_id = name[len("custom:"):]
            preset = next(
                (
                    item for item in self.hass.data.get(DOMAIN, {}).get("clock_presets", [])
                    if item.get("id") == preset_id and item.get("kind", "style") == "style"
                ),
                None,
            )
            if preset is None:
                _LOGGER.debug("[ROTATION] [%s] Unknown clock preset %s -- skipped", self._ip, name)
                return True
            self._native_clock_style = next(
                (
                    sid for sid, style in NATIVE_CLOCK_STYLES.items()
                    if style["name"] == "White"
                ),
                4,
            )
            # A recorded color mode overrides the preset's own solid color
            # exactly like the card's preview: custom keeps the recorded color,
            # a palette remaps it, normal uses the preset color.
            if color_mode == "custom" and color:
                self._native_clock_color = rgb_to_argb(color)
                self._native_clock_color_mode = "normal"
            elif color_mode in CLOCK_COLOR_MODES and color_mode != "normal":
                self._native_clock_color = None
                self._native_clock_color_mode = color_mode
            else:
                self._native_clock_color = rgb_to_argb(preset["color"])
                self._native_clock_color_mode = "normal"
        else:
            style_id = next(
                (
                    sid for sid, style in NATIVE_CLOCK_STYLES.items()
                    if style["name"] == name
                ),
                None,
            )
            if style_id is None:
                _LOGGER.debug("[ROTATION] [%s] Unknown clock style %s -- skipped", self._ip, name)
                return True
            self._native_clock_style = style_id
            if color_mode == "custom" and color:
                self._native_clock_color = rgb_to_argb(color)
                self._native_clock_color_mode = "normal"
            else:
                self._native_clock_color = None
                self._native_clock_color_mode = (
                    color_mode if color_mode in CLOCK_COLOR_MODES else "normal"
                )
        self._mode = MODE_CLOCK
        self._custom_draw_active = False
        if not await self._start_rotation_apply():
            return False
        if not await self._execute_hardware_op(
            lambda: self._activate_native_clock(), "rotation:clock"
        ):
            return False
        self._refresh_linked_entities()
        if self.hass is not None:
            self.async_write_ha_state()
        return True
