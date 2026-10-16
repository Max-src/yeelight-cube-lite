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

from .const import DOMAIN, ALL_NATIVE_EFFECTS, MODE_CLOCK, MODE_NATIVE_EFFECT
from .entity import CubeControlEntity, remove_retired_entities
from .lamp_power import BASE_W, NO_LIMIT_W

_LOGGER = logging.getLogger(__name__)


class CubeNumber(CubeControlEntity, NumberEntity):
    """A slider of one lamp. The light keeps it in ``_slot`` and pushes every
    change made elsewhere through async_update_from_light, so it never
    polls. ``name`` (the older entities) is shown after the lamp's name; the
    others name themselves with a translation key."""

    _attr_should_poll = False
    _attr_mode = NumberMode.SLIDER
    _slot = None

    def __init__(
        self, light_entity, config_entry: ConfigEntry, unique_suffix: str,
        icon: str, low: float, high: float, step: float,
        unit: str | None = None, name: str | None = None,
    ):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = f"{light_entity._attr_unique_id}_{unique_suffix}"
        self._attr_icon = icon
        self._attr_native_min_value = float(low)
        self._attr_native_max_value = float(high)
        self._attr_native_step = float(step)
        self._attr_native_unit_of_measurement = unit
        if name:
            self._attr_name = f"{light_entity._attr_name} {name}"

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
        if self._slot:
            setattr(self._light_entity, self._slot, self)
        self.async_update_from_light()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


async def _restart_scroll(light) -> None:
    """A new interval takes effect at once while the text scrolls."""
    if light._is_scrolling:
        light.start_scroll_timer()


async def _redraw_with_power_limit(light) -> None:
    """Redraw so the new limit shows at once. Only frames the integration
    draws are limited: firmware modes (clock, native effects, Music Flow)
    are left running. A user change, unlike a background "display_update":
    never suppressed, and not animated."""
    if light._is_on and not light.firmware_draws_matrix:
        await light.async_apply_display_mode(update_type="power_limit")


async def _redraw_in_background(light) -> None:
    """Re-render (the lamp's adjustments) without holding up the slider."""
    light.hass.async_create_task(light.async_apply_display_mode())


@dataclass(frozen=True)
class SettingNumber:
    """One lamp setting as a slider: the light's ``attr``, kept within
    ``low``..``high``, rounded to ``digits`` (None: whole numbers); ``after``
    (light) runs once it changed."""

    unique_suffix: str
    icon: str
    attr: str
    low: float
    high: float
    step: float
    default: float
    unit: str | None = None
    digits: int | None = None
    name: str | None = None
    translation_key: str | None = None
    category: EntityCategory | None = None
    slot: str | None = None
    after: Callable[[object], Awaitable[None]] | None = None


SETTING_NUMBERS = (
    SettingNumber(
        "scroll_speed", "mdi:timer-play-outline", "_scroll_speed", 0.05, 2.0, 0.05, 0.2,
        unit="s", digits=2, translation_key="scroll_speed", category=EntityCategory.CONFIG,
        slot="_scroll_speed_entity", after=_restart_scroll,
    ),
    # Frames the integration draws are dimmed so the lamp's estimated draw
    # stays under this many watts (7 W = no limit; the lamp never draws more
    # than about 6.3 W). The minimum is the electronics' own 0.4 W, where
    # every frame is black. For lamps on a weak or shared power supply; see
    # "Power Supply" in the README.
    SettingNumber(
        "power_limit", "mdi:flash-alert-outline", "_power_limit", BASE_W, NO_LIMIT_W, 0.1, NO_LIMIT_W,
        unit="W", digits=1, translation_key="power_limit", category=EntityCategory.CONFIG,
        after=_redraw_with_power_limit,
    ),
)


def _preview_adjustment(key, name, icon, low, high, default, unit):
    """One of the lamp's color adjustments (light._preview_<key>)."""
    return SettingNumber(
        key, icon, f"_preview_{key}", low, high, 1, default, unit=unit, name=name,
        category=EntityCategory.CONFIG, after=_redraw_in_background,
    )


# The lamp's color adjustments (their keys are also the unique id suffixes).
PREVIEW_ADJUSTMENTS = (
    _preview_adjustment("hue_shift", "Color: Hue Shift", "mdi:palette-outline", -180, 180, 0, "°"),
    _preview_adjustment("temperature", "Color: Temperature", "mdi:thermometer", -100, 100, 0, None),
    _preview_adjustment("saturation", "Intensity: Saturation", "mdi:invert-colors", 0, 200, 100, "%"),
    _preview_adjustment("vibrance", "Intensity: Vibrance", "mdi:auto-fix", 0, 200, 100, "%"),
    _preview_adjustment("contrast", "Tone: Contrast", "mdi:contrast-circle", 0, 200, 100, "%"),
    _preview_adjustment("glow", "Tone: Glow", "mdi:white-balance-sunny", 0, 100, 0, "%"),
    _preview_adjustment("grayscale", "Effects: Grayscale", "mdi:image-filter-black-white", 0, 100, 0, "%"),
    _preview_adjustment("invert", "Effects: Invert", "mdi:invert-colors-off", 0, 100, 0, "%"),
    _preview_adjustment("tint_hue", "Effects: Tint Hue", "mdi:format-color-fill", 0, 360, 0, "°"),
    _preview_adjustment("tint_strength", "Effects: Tint Strength", "mdi:opacity", 0, 100, 0, "%"),
)


class CubeSettingNumber(CubeNumber):
    """A slider of one lamp setting (SETTING_NUMBERS, PREVIEW_ADJUSTMENTS)."""

    def __init__(self, light_entity, config_entry: ConfigEntry, spec: SettingNumber):
        super().__init__(
            light_entity, config_entry, spec.unique_suffix, spec.icon,
            spec.low, spec.high, spec.step, spec.unit, spec.name,
        )
        self._spec = spec
        self._slot = spec.slot
        if spec.translation_key:
            self._attr_has_entity_name = True
            self._attr_translation_key = spec.translation_key
        if spec.category:
            self._attr_entity_category = spec.category

    @property
    def native_value(self) -> float:
        spec = self._spec
        return float(getattr(self._light_entity, spec.attr, spec.default))

    async def async_set_native_value(self, value: float) -> None:
        spec = self._spec
        value = int(value) if spec.digits is None else round(value, spec.digits)
        setattr(self._light_entity, spec.attr, max(spec.low, min(spec.high, value)))
        self._write_states()
        if spec.after:
            await spec.after(self._light_entity)

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        if self._spec in PREVIEW_ADJUSTMENTS:
            # The adjustments service updates them all at once.
            self._light_entity._preview_number_entities[self._spec.unique_suffix] = self

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube Lite number entities from a config entry."""
    if DOMAIN not in hass.data or entry.entry_id not in hass.data[DOMAIN]:
        return False

    light_entity = hass.data[DOMAIN][entry.entry_id].get("light")
    if not light_entity:
        return False

    # The matrix transition settings of an earlier version (transitions removed).
    remove_retired_entities(hass, "number", [
        f"{light_entity._attr_unique_id}_{key}" for key in ("transition_steps", "transition_duration")
    ])
    async_add_entities([
        YeelightCubeGradientAngleNumber(light_entity, entry),
        YeelightCubeNativeEffectSpeedNumber(light_entity, entry),
        *(
            CubeSettingNumber(light_entity, entry, spec)
            for spec in (*SETTING_NUMBERS, *PREVIEW_ADJUSTMENTS)
        ),
    ])
    return True


class YeelightCubeGradientAngleNumber(CubeNumber):
    """Number entity for controlling the gradient angle (0-360°) on the Yeelight Cube Lite."""

    _slot = "_angle_number_entity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the gradient angle number entity."""
        super().__init__(
            light_entity, config_entry, "gradient_angle", "mdi:angle-acute",
            0, 360, 1, "°", "Matrix: Gradient Angle",
        )

    @property
    def native_value(self) -> float:
        """Return the current angle from the light entity.

        Rounded to 1 decimal for display only; the light entity keeps the
        full-precision ``_angle`` used for rendering.
        """
        try:
            return round(float(getattr(self._light_entity, '_angle', 0.0)), 1)
        except (TypeError, ValueError):
            return 0.0

    async def async_set_native_value(self, value: float) -> None:
        """Set the gradient angle and apply to the lamp."""
        _LOGGER.debug("[ANGLE NUMBER] User set angle to %s° for %s", value, self._light_entity._ip)

        self._light_entity._angle = value
        await self._light_entity.async_apply_display_mode(update_type='color_change')
        self._write_states()


class YeelightCubeNativeEffectSpeedNumber(CubeNumber):
    """Control the rate used by firmware-native animations."""

    _attr_has_entity_name = True
    _attr_translation_key = "native_effect_speed"
    _slot = "_native_effect_speed_entity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "native_effect_speed", "mdi:speedometer", 1, 255, 1)

    @property
    def available(self) -> bool:
        light = self._light_entity
        if not light.available:
            return False
        # The firmware clock accepts the same rate byte, so the slider applies
        # to clock mode too; otherwise it depends on the selected effect.
        if light._mode == MODE_CLOCK:
            return True
        spec = ALL_NATIVE_EFFECTS[light._native_effect]
        return bool(spec.get("speed"))

    @property
    def native_value(self) -> float:
        return float(self._light_entity._native_effect_speed)

    async def async_set_native_value(self, value: float) -> None:
        light = self._light_entity
        light._native_effect_speed = max(1, min(255, int(value)))
        if light._mode == MODE_CLOCK:
            reapply = light._is_on
        else:
            spec = ALL_NATIVE_EFFECTS[light._native_effect]
            reapply = (
                bool(spec.get("speed"))
                and light._mode == MODE_NATIVE_EFFECT
                and light._is_on
            )
        if reapply:
            await light.async_apply_display_mode(update_type="color_change")
        self._write_states()
