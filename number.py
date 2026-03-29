"""Number platform for Yeelight Cube Lite - provides numeric slider controls."""

import logging
from homeassistant.components.number import NumberEntity, NumberMode  # type: ignore
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback  # type: ignore

from .const import DOMAIN, CONF_IP

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube Lite number entities from a config entry."""
    if DOMAIN not in hass.data or entry.entry_id not in hass.data[DOMAIN]:
        return False

    light_entity = hass.data[DOMAIN][entry.entry_id].get("light")
    if not light_entity:
        return False

    entities = [
        YeelightCubeGradientAngleNumber(light_entity, entry),
        YeelightCubeTransitionStepsNumber(light_entity, entry),
        YeelightCubeTransitionDurationNumber(light_entity, entry),
    ]

    # Add all preview adjustment sliders
    for spec in PREVIEW_ADJUSTMENT_SPECS:
        entities.append(YeelightCubePreviewAdjustmentNumber(light_entity, entry, spec))

    async_add_entities(entities)
    return True


# --- Preview adjustment slider specifications ---
# Each tuple: (key, name_suffix, icon, min, max, step, default, unit, attr_name)
PREVIEW_ADJUSTMENT_SPECS = [
    {
        "key": "hue_shift",
        "name": "Color: Hue Shift",
        "icon": "mdi:palette-outline",
        "min": -180, "max": 180, "step": 1, "default": 0,
        "unit": "°",
        "attr": "_preview_hue_shift",
    },
    {
        "key": "temperature",
        "name": "Color: Temperature",
        "icon": "mdi:thermometer",
        "min": -100, "max": 100, "step": 1, "default": 0,
        "unit": None,
        "attr": "_preview_temperature",
    },
    {
        "key": "saturation",
        "name": "Intensity: Saturation",
        "icon": "mdi:invert-colors",
        "min": 0, "max": 200, "step": 1, "default": 100,
        "unit": "%",
        "attr": "_preview_saturation",
    },
    {
        "key": "vibrance",
        "name": "Intensity: Vibrance",
        "icon": "mdi:auto-fix",
        "min": 0, "max": 200, "step": 1, "default": 100,
        "unit": "%",
        "attr": "_preview_vibrance",
    },
    {
        "key": "contrast",
        "name": "Tone: Contrast",
        "icon": "mdi:contrast-circle",
        "min": 0, "max": 200, "step": 1, "default": 100,
        "unit": "%",
        "attr": "_preview_contrast",
    },
    {
        "key": "glow",
        "name": "Tone: Glow",
        "icon": "mdi:white-balance-sunny",
        "min": 0, "max": 100, "step": 1, "default": 0,
        "unit": "%",
        "attr": "_preview_glow",
    },
    {
        "key": "grayscale",
        "name": "Effects: Grayscale",
        "icon": "mdi:image-filter-black-white",
        "min": 0, "max": 100, "step": 1, "default": 0,
        "unit": "%",
        "attr": "_preview_grayscale",
    },
    {
        "key": "invert",
        "name": "Effects: Invert",
        "icon": "mdi:invert-colors-off",
        "min": 0, "max": 100, "step": 1, "default": 0,
        "unit": "%",
        "attr": "_preview_invert",
    },
    {
        "key": "tint_hue",
        "name": "Effects: Tint Hue",
        "icon": "mdi:format-color-fill",
        "min": 0, "max": 360, "step": 1, "default": 0,
        "unit": "°",
        "attr": "_preview_tint_hue",
    },
    {
        "key": "tint_strength",
        "name": "Effects: Tint Strength",
        "icon": "mdi:opacity",
        "min": 0, "max": 100, "step": 1, "default": 0,
        "unit": "%",
        "attr": "_preview_tint_strength",
    },
]


class YeelightCubeGradientAngleNumber(NumberEntity):
    """Number entity for controlling the gradient angle (0-360°) on the Yeelight Cube Lite."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the gradient angle number entity."""
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Gradient Angle"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_gradient_angle"
        self._attr_icon = "mdi:angle-acute"
        self._attr_native_min_value = 0.0
        self._attr_native_max_value = 360.0
        self._attr_native_step = 1.0
        self._attr_native_unit_of_measurement = "°"
        self._attr_mode = NumberMode.SLIDER

    @property
    def device_info(self):
        """Return device info to group with the light entity."""
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    @property
    def available(self) -> bool:
        return True

    @property
    def native_value(self) -> float:
        """Return the current angle from the light entity."""
        return getattr(self._light_entity, '_angle', 0.0)

    async def async_set_native_value(self, value: float) -> None:
        """Set the gradient angle and apply to the lamp."""
        _LOGGER.debug(f"[ANGLE NUMBER] User set angle to {value}° for {self._light_entity._ip}")

        # Check auto-turn-on setting
        if not self._light_entity._is_on and not self._light_entity._should_auto_turn_on():
            _LOGGER.debug("[ANGLE NUMBER] Lamp is off and auto-turn-on is disabled, ignoring")
            return

        self._light_entity._angle = value
        await self._light_entity.async_apply_display_mode(update_type='color_change')

        # Notify Home Assistant of the state change
        if self.hass is not None:
            self.async_write_ha_state()

        # Also trigger light entity state update
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        """Called by external code (service handler) to sync the slider value."""
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()

        # Register ourselves with the light entity so it can notify us
        self._light_entity._angle_number_entity = self
        _LOGGER.debug(f"[ANGLE NUMBER] Registered for {self._light_entity._ip}, current angle={self._light_entity._angle}")


class YeelightCubePreviewAdjustmentNumber(NumberEntity):
    """Generic number entity for a single preview color-adjustment slider."""

    def __init__(self, light_entity, config_entry: ConfigEntry, spec: dict):
        """Initialize from a spec dict."""
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._spec = spec
        self._attr_key = spec["attr"]  # e.g. "_preview_hue_shift"

        self._attr_name = f"{light_entity._attr_name} {spec['name']}"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_{spec['key']}"
        self._attr_icon = spec["icon"]
        self._attr_native_min_value = float(spec["min"])
        self._attr_native_max_value = float(spec["max"])
        self._attr_native_step = float(spec["step"])
        self._attr_native_unit_of_measurement = spec.get("unit")
        self._attr_mode = NumberMode.SLIDER
        self._attr_entity_category = EntityCategory.CONFIG

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    @property
    def available(self) -> bool:
        return True

    @property
    def native_value(self) -> float:
        """Return the current value from the light entity."""
        return float(getattr(self._light_entity, self._attr_key, self._spec["default"]))

    async def async_set_native_value(self, value: float) -> None:
        """Set the adjustment value and re-render the lamp display."""
        int_val = max(self._spec["min"], min(self._spec["max"], int(value)))
        _LOGGER.debug(f"[{self._spec['key'].upper()}] Set to {int_val} for {self._light_entity._ip}")

        setattr(self._light_entity, self._attr_key, int_val)

        # Send HA state update immediately for fast UI feedback
        if self.hass is not None:
            self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_schedule_update_ha_state()

        # Re-render display asynchronously (same pattern as the bulk service)
        self.hass.async_create_task(self._light_entity.async_apply_display_mode())

    @callback
    def async_update_from_light(self):
        """Called by external code (service handler) to sync after bulk update."""
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()

        # Register ourselves in the light entity's dict so the service handler can notify us
        if not hasattr(self._light_entity, '_preview_number_entities'):
            self._light_entity._preview_number_entities = {}
        self._light_entity._preview_number_entities[self._spec["key"]] = self
        _LOGGER.debug(f"[{self._spec['key'].upper()}] Registered for {self._light_entity._ip}")


# ── Transition Step Count ──────────────────────────────────────────────

class YeelightCubeTransitionStepsNumber(NumberEntity):
    """Number entity for controlling the number of transition animation steps."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Transition Steps"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_transition_steps"
        self._attr_icon = "mdi:animation"
        self._attr_native_min_value = 1.0
        self._attr_native_max_value = 10.0
        self._attr_native_step = 1.0
        self._attr_native_unit_of_measurement = "steps"
        self._attr_mode = NumberMode.SLIDER
        self._attr_entity_category = EntityCategory.CONFIG

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    @property
    def available(self) -> bool:
        return True

    @property
    def native_value(self) -> float:
        return float(getattr(self._light_entity, '_transition_steps', 5))

    async def async_set_native_value(self, value: float) -> None:
        int_val = max(1, min(10, int(value)))
        _LOGGER.debug(f"[TRANSITION STEPS] Set to {int_val} for {self._light_entity._ip}")
        self._light_entity._transition_steps = int_val

        if self.hass is not None:
            self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._transition_steps_entity = self
        _LOGGER.debug(
            f"[TRANSITION STEPS] Registered for {self._light_entity._ip}, "
            f"current steps={self._light_entity._transition_steps}"
        )


# ── Transition Duration ────────────────────────────────────────────────

class YeelightCubeTransitionDurationNumber(NumberEntity):
    """Number entity for controlling the total transition animation time."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Transition Duration"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_transition_duration"
        self._attr_icon = "mdi:timer-outline"
        self._attr_native_min_value = 0.2
        self._attr_native_max_value = 10.0
        self._attr_native_step = 0.1
        self._attr_native_unit_of_measurement = "s"
        self._attr_mode = NumberMode.SLIDER
        self._attr_entity_category = EntityCategory.CONFIG

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    @property
    def available(self) -> bool:
        return True

    @property
    def native_value(self) -> float:
        return float(getattr(self._light_entity, '_transition_duration', 1.0))

    async def async_set_native_value(self, value: float) -> None:
        clamped = max(0.2, min(10.0, round(value, 1)))
        _LOGGER.debug(f"[TRANSITION DURATION] Set to {clamped}s for {self._light_entity._ip}")
        self._light_entity._transition_duration = clamped

        if self.hass is not None:
            self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._transition_duration_entity = self
        _LOGGER.debug(
            f"[TRANSITION DURATION] Registered for {self._light_entity._ip}, "
            f"current duration={self._light_entity._transition_duration}s"
        )