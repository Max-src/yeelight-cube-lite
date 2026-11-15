"""The light's public API for its built-in modes: the clock and native effects.

Owns NativeActionsMixin: what the clock style, native effect, direction,
speed, intensity and clock option controls do (select.py, number.py,
switch.py), and the built-in modes' actions (light_services_native:
set_native_effect, recorded at once and sent after, put back when the lamp
refuses it; set_clock_style).
Part of light_actions.ActionsMixin, the light's public API; used only as a
mixin of :class:`YeelightCubeLight` (light.py).
"""
from __future__ import annotations

import logging
import time
from .command_errors import note_command_result
from .const import MODE_CLOCK, MODE_NATIVE_EFFECT
from .effect_catalog import ALL_NATIVE_EFFECTS

_LOGGER = logging.getLogger(__name__)


# The light's settings set_native_effect changes (and puts back when the lamp
# refuses them).
NATIVE_EFFECT_SETTINGS = (
    "_native_effect",
    "_native_effect_speed",
    "_native_effect_intensity",
    "_native_effect_direction",
    "_native_effect_color_mode",
    "_native_effect_color",
    "_mode",
    "_custom_draw_active",
)


class NativeActionsMixin:
    """The light's built-in modes' actions (light_actions_native.py)."""

    def _init_native_actions_state(self) -> None:
        """set_native_effect's pending change. Called by YeelightCubeLight.__init__."""
        # What the lamp last accepted, while a set_native_effect call is not
        # confirmed yet (request_native_effect), and the calls' count.
        self._native_effect_baseline = None
        self._native_effect_generation = 0

    # ── Built-in modes' controls (select.py, number.py, switch.py) ──────
    async def async_select_clock_style(self, style_id: int) -> None:
        self._native_clock_style = style_id
        # Speed and intensity follow the style's background.
        self.write_effect_settings()
        if self._mode == MODE_CLOCK:
            await self.async_apply_display_mode(update_type="color_change")

    async def async_select_native_effect(self, name: str) -> None:
        self._native_effect = name
        self._notify("native_effect_direction")
        self.write_effect_settings()
        if self._mode == MODE_NATIVE_EFFECT and self._is_on:
            await self.async_apply_display_mode(update_type="color_change")

    async def async_select_native_effect_direction(self, direction: str) -> None:
        self._native_effect_direction = direction
        spec = ALL_NATIVE_EFFECTS[self._native_effect]
        if spec.get("directions") and self._mode == MODE_NATIVE_EFFECT and self._is_on:
            await self.async_apply_display_mode(update_type="color_change")

    async def async_set_effect_setting(self, attr: str, value: int, setting: str) -> None:
        """A setting shared by the built-in animations (speed, intensity),
        sent at once while what the lamp shows reads it."""
        setattr(self, attr, value)
        if (
            self._is_on
            and self._mode in (MODE_CLOCK, MODE_NATIVE_EFFECT)
            and self.effect_setting_applies(setting)
        ):
            await self.async_apply_display_mode(update_type="color_change")

    async def async_set_clock_option(self, attr: str, enabled: bool) -> None:
        """A clock option (12-hour time, colon blink), sent at once while the
        clock shows."""
        setattr(self, attr, enabled)
        if self._is_on and self._mode == MODE_CLOCK:
            await self.async_apply_display_mode(update_type="color_change")

    # ── Built-in modes' actions (light_services_native) ─────────────────
    def request_native_effect(
        self, *, effect=None, speed=None, intensity=None, direction=None,
        color_mode=None, has_color=False, color=None, activate=True,
    ) -> tuple:
        """set_native_effect's settings, recorded and published at once.

        Returns what is needed to undo them if the lamp rejects the change:
        the previous values and this call's generation."""
        # The rollback target is what the lamp last accepted. While an
        # earlier call is still unconfirmed (in flight, or skipped because
        # this one replaced it) its values never reached the lamp, so this
        # call inherits that call's baseline instead of snapshotting them.
        snapshot = self._native_effect_baseline or {
            attr: getattr(self, attr, None) for attr in NATIVE_EFFECT_SETTINGS
        }
        self._native_effect_baseline = snapshot
        generation = self._native_effect_generation + 1
        self._native_effect_generation = generation
        if effect is not None:
            self._native_effect = effect
        if speed is not None:
            self._native_effect_speed = speed
        if intensity is not None:
            self._native_effect_intensity = intensity
        if direction is not None:
            self._native_effect_direction = direction
        if color_mode is not None:
            self._native_effect_color_mode = color_mode
        if has_color:
            self._native_effect_color = None if color is None else list(color)
            if color_mode is None:
                self._native_effect_color_mode = "normal"
        if activate:
            self._enter_mode(MODE_NATIVE_EFFECT, custom_draw=False)
        self._refresh_linked_entities()
        self.async_write_ha_state()
        applied = {attr: getattr(self, attr, None) for attr in snapshot}
        return snapshot, applied, generation

    async def async_send_native_effect(self, snapshot, applied, generation) -> None:
        """Send set_native_effect's settings to the lamp (runs after the
        action returned): a change the lamp refused is put back."""
        if self._mode != MODE_NATIVE_EFFECT:
            # Nothing to send (e.g. a speed change while the clock runs):
            # the settings stand as published.
            if self._native_effect_generation == generation:
                self._native_effect_baseline = None
            return
        # A newer set_native_effect call already replaced these settings and
        # will apply the latest ones itself: skip this redundant update.
        if self._native_effect_generation != generation:
            return
        started = time.time()
        try:
            # The hardware wrapper reports failures by returning False
            # (timeouts, offline lamp, circuit breaker) rather than raising.
            ok = await self.async_apply_display_mode(update_type="color_change")
        except Exception as err:  # noqa: BLE001 -- background task, nobody awaits it
            _LOGGER.exception(
                "[SET_NATIVE_EFFECT] Failed to apply %s on %s", self._native_effect, self.entity_id,
            )
            note_command_result(self, "SET_NATIVE_EFFECT", err)  # for the cards
            ok = False
        # Refused (the lamp answered with an error, or applying it failed:
        # named in last_command_error since this call started) or not
        # reached. Not reached, the settings stand, like every other
        # service's: the lamp shows them once it is back (its whole
        # requested state is redrawn on reconnecting).
        failed = self._last_command_error
        refused = ok is False and bool(failed) and failed.get("at", 0) >= started
        if refused:
            _LOGGER.warning(
                "[SET_NATIVE_EFFECT] Lamp did not accept %s on %s", self._native_effect, self.entity_id,
            )
        elif ok is False:
            _LOGGER.debug(
                "[SET_NATIVE_EFFECT] %s kept for %s, not reached (shown once it is back)",
                self._native_effect, self.entity_id,
            )
        latest = self._native_effect_generation == generation
        if refused and latest:
            # The lamp did not take the change: publish what it last
            # accepted (an older call may have succeeded since this one
            # started). Only fields still holding this call's values are
            # restored, so a newer change from another path (rotation,
            # set_mode, the select entities) is never overwritten.
            baseline = self._native_effect_baseline or snapshot
            for attr, value in baseline.items():
                if getattr(self, attr, None) == applied[attr]:
                    if attr == "_mode":
                        self._enter_mode(value)
                    elif attr == "_custom_draw_active":
                        self._enter_mode(custom_draw=value)
                    else:
                        setattr(self, attr, value)
            self._refresh_linked_entities()
            if self.studio_streaming() and self._studio_task is None:
                # Back to an effect the integration streams: the change had
                # already stopped its stream and blanked the lamp, so it is
                # started again rather than leaving the lamp dark.
                self._create_tracked_task(
                    self.async_apply_display_mode(update_type="color_change"),
                    name=f"yeelight_cube_restream_{self._ip}",
                )
        if latest:
            self._native_effect_baseline = None
        elif ok is not False and self._native_effect_baseline:
            # The lamp now shows this call's values: the baseline for the
            # newer call that is still pending. If that call already
            # finished (it cleared the baseline), the lamp shows its values
            # instead and there is nothing to record.
            self._native_effect_baseline = applied
        self.async_write_ha_state()

    async def async_set_clock_settings(
        self, *, style_id=None, has_color=False, clock_color=None, content=None,
        twelve_hour=None, colon_blink=None, color_mode=None, speed=None,
        intensity=None, activate=True,
    ) -> None:
        """set_clock_style: the given clock settings (``clock_color`` None with
        ``has_color``: the style's own), shown when the clock is."""
        if style_id is not None:
            self._native_clock_style = style_id
        if has_color:
            self._native_clock_color = clock_color
        if content is not None:
            self._native_clock_content = content
            self._native_clock_show_date = content == "time_date"
        if twelve_hour is not None:
            self._native_clock_12_hour = bool(twelve_hour)
        if colon_blink is not None:
            self._native_clock_colon_blink = bool(colon_blink)
        if color_mode is not None:
            self._native_clock_color_mode = color_mode
        if speed is not None:
            self._native_effect_speed = max(1, min(255, int(speed)))
        # Shared with the effects; the background takes it if it reads it.
        if intensity is not None:
            self._native_effect_intensity = intensity
        if activate:
            self._enter_mode(MODE_CLOCK, custom_draw=False)
        if self._mode == MODE_CLOCK:
            # Drawn now, or when an off lamp is turned on.
            await self.async_apply_display_mode(update_type="color_change")
        self._refresh_linked_entities()
        self.async_write_ha_state()
