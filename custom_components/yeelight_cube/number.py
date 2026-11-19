"""Number platform for Yeelight Cube Lite - provides numeric slider controls."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Awaitable, Callable

from homeassistant.components.number import NumberEntity, NumberMode  # type: ignore
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback  # type: ignore

from .const import MODE_NATIVE_EFFECT
from .effect_catalog import INTENSITY_RANGE, LAMP_ANIMATION_EFFECTS, SPEED_RANGE
from .runtime_data import lamp_of
from .entity import CubeControlEntity, remove_retired_entities
from .lamp_power import BASE_W, NO_LIMIT_W

_LOGGER = logging.getLogger(__name__)

# No limit per platform: every command to the lamp already waits for the
# previous one (the device lock, light_connection._execute_hardware_op).
PARALLEL_UPDATES = 0


class CubeNumber(CubeControlEntity, NumberEntity):
    """A slider of one lamp. It listens to the light's ``_topic`` (light_state):
    every change made elsewhere comes through async_update_from_light, so it never
    polls. Named by its translation key, after the lamp's name."""

    _attr_should_poll = False
    _attr_mode = NumberMode.SLIDER
    _topic = None

    def __init__(
        self, light_entity, config_entry: ConfigEntry, unique_suffix: str,
        low: float, high: float, step: float,
        unit: str | None = None, translation_key: str | None = None,
    ):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = f"{light_entity.unique_id}_{unique_suffix}"
        self._attr_native_min_value = float(low)
        self._attr_native_max_value = float(high)
        self._attr_native_step = float(step)
        self._attr_native_unit_of_measurement = unit
        if translation_key:
            self._attr_translation_key = translation_key

    @callback
    def async_update_from_light(self):
        if self.hass is not None:
            self.async_write_ha_state()

    def _write_states(self):
        """Publish this slider and the lamp."""
        if self.hass is not None:
            self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        if self._topic:
            self._listen_to_light(self._topic)
        self.async_update_from_light()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


async def _restart_scroll(light) -> None:
    """A new interval takes effect at once while the text scrolls."""
    await light.async_restart_scroll()


async def _redraw_with_power_limit(light) -> None:
    """Redraw so the new limit shows at once. Only frames the integration
    draws are limited: built-in modes (clock, native effects, Music Flow)
    are left running. A user change, unlike a background "display_update":
    never suppressed, and not animated."""
    if light.is_on and not light.lamp_draws_matrix:
        await light.async_apply_display_mode(update_type="power_limit")


async def _redraw_in_background(light) -> None:
    """Re-render (the lamp's adjustments) without holding up the slider.
    Not while the lamp runs its own effect, clock or music, or a streamed
    effect: none takes the adjustments, and sending it again would restart
    it at each step. An animation does (its GIF is uploaded again)."""
    if light.lamp_draws_matrix and not (
        light.mode == MODE_NATIVE_EFFECT and light.native_effect in LAMP_ANIMATION_EFFECTS
        and not light.music_flow_enabled
    ):
        return
    light.redraw_in_background("yeelight_cube_adjustments")


@dataclass(frozen=True)
class SettingNumber:
    """One lamp setting as a slider: the light's ``attr``, kept within
    ``low``..``high``, rounded to ``digits`` (None: whole numbers); ``after``
    (light) runs once it changed."""

    unique_suffix: str
    attr: str
    low: float
    high: float
    step: float
    default: float
    unit: str | None = None
    digits: int | None = None
    translation_key: str | None = None
    category: EntityCategory | None = None
    topic: str | None = None
    after: Callable[[object], Awaitable[None]] | None = None


SETTING_NUMBERS = (
    SettingNumber(
        "scroll_speed", "_scroll_speed", 0.05, 2.0, 0.05, 0.2,
        unit="s", digits=2, translation_key="scroll_speed", category=EntityCategory.CONFIG,
        topic="scroll_speed", after=_restart_scroll,
    ),
    # Frames the integration draws are dimmed so the lamp's estimated draw
    # stays under this many watts (7 W = no limit; the lamp never draws more
    # than about 6.3 W). The minimum is the electronics' own 0.4 W, where
    # every frame is black. For lamps on a weak or shared power supply; see
    # "Power Supply" in the README.
    SettingNumber(
        "power_limit", "_power_limit", BASE_W, NO_LIMIT_W, 0.1, NO_LIMIT_W,
        unit="W", digits=1, translation_key="power_limit", category=EntityCategory.CONFIG,
        after=_redraw_with_power_limit,
    ),
)


def _preview_adjustment(key, low, high, default, unit):
    """One of the lamp's color adjustments (light._preview_<key>); ``key`` is
    also its translation key."""
    return SettingNumber(
        key, f"_preview_{key}", low, high, 1, default, unit=unit, translation_key=key,
        category=EntityCategory.CONFIG, after=_redraw_in_background,
    )


# The lamp's color adjustments (their keys are also the unique id suffixes).
PREVIEW_ADJUSTMENTS = (
    _preview_adjustment("hue_shift", -180, 180, 0, "°"),
    _preview_adjustment("temperature", -100, 100, 0, None),
    _preview_adjustment("saturation", 0, 200, 100, "%"),
    _preview_adjustment("vibrance", 0, 200, 100, "%"),
    _preview_adjustment("contrast", 0, 200, 100, "%"),
    _preview_adjustment("glow", 0, 100, 0, "%"),
    _preview_adjustment("grayscale", 0, 100, 0, "%"),
    _preview_adjustment("invert", 0, 100, 0, "%"),
    _preview_adjustment("tint_hue", 0, 360, 0, "°"),
    _preview_adjustment("tint_strength", 0, 100, 0, "%"),
)


# A Cube Lite's stream frame rate limit (light_studio._lite_lan_gap): new
# pictures at most this many times a second over the LAN. Applies at the next
# render; not on a Cube Matrix (its streams go over Matter).
LITE_NUMBERS = (
    SettingNumber(
        "stream_fps_limit", "_lite_stream_fps", 1, 25, 1, 5,
        unit="fps", translation_key="stream_fps_limit", category=EntityCategory.CONFIG,
    ),
)


class CubeSettingNumber(CubeNumber):
    """A slider of one lamp setting (SETTING_NUMBERS, PREVIEW_ADJUSTMENTS)."""

    def __init__(self, light_entity, config_entry: ConfigEntry, spec: SettingNumber):
        super().__init__(
            light_entity, config_entry, spec.unique_suffix,
            spec.low, spec.high, spec.step, spec.unit, spec.translation_key,
        )
        self._spec = spec
        self._topic = spec.topic
        if spec.category:
            self._attr_entity_category = spec.category

    @property
    def native_value(self) -> float:
        spec = self._spec
        return float(self._light_entity.setting(spec.attr, spec.default))

    async def async_set_native_value(self, value: float) -> None:
        spec = self._spec
        value = int(value) if spec.digits is None else round(value, spec.digits)
        self._light_entity.set_setting(spec.attr, max(spec.low, min(spec.high, value)))
        self._write_states()
        if spec.after:
            await spec.after(self._light_entity)

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        if self._spec in PREVIEW_ADJUSTMENTS:
            # The adjustments service updates them all at once (until removed).
            self._listen_to_light("preview_adjustments")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube Lite number entities from a config entry."""
    light_entity = lamp_of(entry)
    if light_entity is None:
        return False

    # Retired settings: the matrix transitions of an earlier version, and a
    # Cube Matrix's drawing animation speed (drawings are always still).
    remove_retired_entities(hass, "number", [
        f"{light_entity.unique_id}_{key}"
        for key in ("transition_steps", "transition_duration", "drawing_animation_speed")
    ])
    async_add_entities([
        YeelightCubeGradientAngleNumber(light_entity, entry),
        YeelightCubeNativeEffectSpeedNumber(light_entity, entry),
        YeelightCubeNativeEffectIntensityNumber(light_entity, entry),
        *(
            CubeSettingNumber(light_entity, entry, spec)
            for spec in (*SETTING_NUMBERS, *PREVIEW_ADJUSTMENTS)
        ),
        *(
            CubeSettingNumber(light_entity, entry, spec) for spec in LITE_NUMBERS
            if not light_entity.is_cube_matrix
        ),
    ])
    return True


class YeelightCubeGradientAngleNumber(CubeNumber):
    """Number entity for controlling the gradient angle (0-360°) on the Yeelight Cube Lite."""

    _topic = "angle"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the gradient angle number entity."""
        super().__init__(
            light_entity, config_entry, "gradient_angle",
            0, 360, 1, "°", "gradient_angle",
        )

    @property
    def native_value(self) -> float:
        """Return the current angle from the light entity.

        Rounded to 1 decimal for display only; the light entity keeps the
        full-precision ``_angle`` used for rendering.
        """
        try:
            return round(float(self._light_entity.angle), 1)
        except (TypeError, ValueError):
            return 0.0

    async def async_set_native_value(self, value: float) -> None:
        """Set the gradient angle and apply to the lamp."""
        _LOGGER.debug("[ANGLE NUMBER] User set angle to %s° for %s", value, self._light_entity.ip)
        await self._light_entity.async_set_gradient_angle_value(value)
        self._write_states()


class _EffectSettingNumber(CubeNumber):
    """A setting shared by every built-in animation (speed, intensity), kept
    in the light's ``_attr``: available while the lamp shows an effect or a
    clock background that reads it (light.effect_setting_applies), and sent
    at once when it does."""

    _setting = None  # "speed" / "intensity": the effect spec's flag
    _attr = None

    @property
    def available(self) -> bool:
        light = self._light_entity
        return light.available and light.effect_setting_applies(self._setting)

    @property
    def native_value(self) -> float:
        return float(self._light_entity.setting(self._attr))

    async def async_set_native_value(self, value: float) -> None:
        light = self._light_entity
        low, high = int(self._attr_native_min_value), int(self._attr_native_max_value)
        await light.async_set_effect_setting(self._attr, max(low, min(high, int(value))), self._setting)
        self._write_states()


class YeelightCubeNativeEffectSpeedNumber(_EffectSettingNumber):
    """Control the rate used by built-in animations."""

    _attr_translation_key = "native_effect_speed"
    _topic = "native_effect_speed"
    _setting = "speed"
    _attr = "_native_effect_speed"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "native_effect_speed", *SPEED_RANGE, 1)


class YeelightCubeNativeEffectIntensityNumber(_EffectSettingNumber):
    """Control the intensity of built-in animations (what it sets depends on
    the effect: effect_catalog.LAMP_INTENSITY_SLOTS)."""

    _attr_translation_key = "native_effect_intensity"
    _topic = "native_effect_intensity"
    _setting = "intensity"
    _attr = "_native_effect_intensity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(
            light_entity, config_entry, "native_effect_intensity", *INTENSITY_RANGE, 1
        )
