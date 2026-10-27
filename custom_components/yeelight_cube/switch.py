"""Switch platform for Yeelight Cube Lite Matrix."""
import logging

from homeassistant.components.switch import SwitchEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .const import (
    CONF_BUTTONS_AS_REMOTE,
    CONF_BUTTONS_WAKE_LAMP,
    CONF_CAMERA_FOLLOWS_ORIENTATION,
    CONF_RESTORE_MUSIC_CHANGES,
    MODE_CLOCK,
)
from .runtime_data import lamp_of
from .entity import CubeControlEntity, CubeDeviceEntity, remove_retired_entities

_LOGGER = logging.getLogger(__name__)

# No limit per platform: every command to the lamp already waits for the
# previous one (the device lock, light_connection._execute_hardware_op).
PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Yeelight Cube Lite switch entities from a config entry."""
    light_entity = lamp_of(config_entry)
    if light_entity is None:
        _LOGGER.error("No light entity found for config entry")
        return
    
    # Create the switches
    switches = [
        YeelightCubeAutoTurnOnSwitch(config_entry, light_entity),
        YeelightCubeCameraOrientationSwitch(config_entry, light_entity),
        YeelightCubeButtonsAsRemoteSwitch(config_entry, light_entity),
        YeelightCubeRestoreMusicChangesSwitch(config_entry, light_entity),
        YeelightCubeButtonsWakeLampSwitch(config_entry, light_entity),
        YeelightCubeClockShowDateSwitch(config_entry, light_entity),
        YeelightCubeClock12HourSwitch(config_entry, light_entity),
        YeelightCubeClockColonBlinkSwitch(config_entry, light_entity),
        YeelightCubeScrollSwitch(config_entry, light_entity),
        YeelightCubeExtendedEffectsSwitch(config_entry, light_entity),
    ]
    
    async_add_entities(switches)

    # The UDP Connection switch of an earlier version: UDP is always used now
    # (TCP is the fallback).
    remove_retired_entities(hass, "switch", [f"{config_entry.entry_id}_udp_connection"])
    _LOGGER.debug("Added %s switch entities for Yeelight Cube Lite", len(switches))


class _YeelightCubeOptionSwitch(CubeDeviceEntity, SwitchEntity):
    """A switch stored in the config entry's options (``option_key``, its
    translation key too; ``default`` until first set)."""

    _attr_should_poll = False
    option_key = ""
    default = False

    def __init__(self, config_entry: ConfigEntry, light_entity):
        """Initialize the switch."""
        self._config_entry = config_entry
        self._attr_translation_key = self.option_key
        self._attr_unique_id = f"{config_entry.entry_id}_{self.option_key}"
        self._light_entity = light_entity
        self._attr_is_on = config_entry.options.get(self.option_key, self.default)

    async def async_turn_on(self, **kwargs):
        self._set(True)

    async def async_turn_off(self, **kwargs):
        self._set(False)

    def _set(self, enabled: bool) -> None:
        self._attr_is_on = enabled
        self.hass.config_entries.async_update_entry(
            self._config_entry,
            options={**self._config_entry.options, self.option_key: enabled},
        )
        self.async_write_ha_state()
        _LOGGER.debug("%s %s", self.option_key, "enabled" if enabled else "disabled")
        self._changed()

    def _changed(self) -> None:
        """React to a new value (the option is already stored)."""


class YeelightCubeAutoTurnOnSwitch(_YeelightCubeOptionSwitch):
    """Whether a command sent while the lamp is off turns it on
    (light._should_auto_turn_on reads it)."""

    option_key = "auto_turn_on"
    default = True  # the behaviour before the option existed


class YeelightCubeCameraOrientationSwitch(_YeelightCubeOptionSwitch):
    """Whether the preview cameras draw a lamp standing on one end (Down /
    Up orientation) vertical, like the cards; off: always landscape."""

    option_key = CONF_CAMERA_FOLLOWS_ORIENTATION
    _attr_entity_category = EntityCategory.CONFIG

    def _changed(self) -> None:
        self._light_entity._notify_camera_preview()


class YeelightCubeButtonsAsRemoteSwitch(_YeelightCubeOptionSwitch):
    """Restore after tagged right-button playlist selections (needs Matter)."""

    option_key = CONF_BUTTONS_AS_REMOTE
    _attr_entity_category = EntityCategory.CONFIG

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._register_on_light("_buttons_as_remote_switch")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        super().async_entity_id_changed(old_entity_id)

    @property
    def extra_state_attributes(self):
        return {"remote_status": self._light_entity.buttons_remote_status}

    def _changed(self) -> None:
        # With Matter settings: the lamp's playlist made black, or put back.
        self._light_entity._sync_remote_playlist()
        self.async_write_ha_state()


class YeelightCubeRestoreMusicChangesSwitch(_YeelightCubeOptionSwitch):
    """Opt in to restoring music changes from both the left button and apps."""

    option_key = CONF_RESTORE_MUSIC_CHANGES
    _attr_entity_category = EntityCategory.CONFIG


class YeelightCubeButtonsWakeLampSwitch(_YeelightCubeOptionSwitch):
    """With Right or Left as Remote: a press on a lamp that is off turns it
    on (off: presses only fire events, light_matter.buttons_wake_lamp)."""

    option_key = CONF_BUTTONS_WAKE_LAMP
    default = True  # what a lamp's button is expected to do
    _attr_entity_category = EntityCategory.CONFIG


class YeelightCubeExtendedEffectsSwitch(CubeDeviceEntity, SwitchEntity):
    """Reveal firmware native effects the official Yeelight app never exposed.

    When on, the native effect and clock style dropdowns also offer discovered
    firmware modes. Off by default.
    """

    _attr_should_poll = False

    def __init__(self, config_entry: ConfigEntry, light_entity):
        self._config_entry = config_entry
        self._light_entity = light_entity
        self._attr_translation_key = "extended_effects"
        self._attr_unique_id = (
            f"{self._light_entity._attr_unique_id}_extended_effects"
        )

    @property
    def is_on(self) -> bool:
        return bool(getattr(self._light_entity, "_extended_effects_enabled", False))

    async def async_turn_on(self, **kwargs):
        await self._set_enabled(True)

    async def async_turn_off(self, **kwargs):
        await self._set_enabled(False)

    async def _set_enabled(self, value: bool) -> None:
        self._light_entity.set_extended_effects_enabled(value)
        # Refresh the effect dropdown so the extended options appear/disappear.
        select = getattr(self._light_entity, "_native_effect_select_entity", None)
        if select is not None and getattr(select, "hass", None) is not None:
            select.async_write_ha_state()
        clock_select = getattr(self._light_entity, "_clock_style_select_entity", None)
        if clock_select is not None and getattr(clock_select, "hass", None) is not None:
            clock_select.async_write_ha_state()
        self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    def async_update_from_light(self):
        # is_on reads _extended_effects_enabled live, so rewriting state is
        # enough to reflect the light's restored value after a reload (e.g. a
        # DHCP IP change) where this switch was added before the light restored.
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._register_on_light("_extended_effects_switch_entity")
        self.async_update_from_light()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


class _YeelightCubeClockOptionSwitch(CubeControlEntity, SwitchEntity):
    """Base switch for a native clock option."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_should_poll = False
    option_attr = ""
    option_key = ""

    def __init__(self, config_entry: ConfigEntry, light_entity):
        self._config_entry = config_entry
        self._light_entity = light_entity
        self._attr_translation_key = self.option_key
        self._attr_unique_id = (
            f"{self._light_entity._attr_unique_id}_{self.option_key}"
        )
        self._attr_is_on = bool(getattr(self._light_entity, self.option_attr))

    async def _set_option(self, enabled: bool) -> None:
        setattr(self._light_entity, self.option_attr, enabled)
        self._attr_is_on = enabled

        if self._light_entity._is_on and self._light_entity._mode == MODE_CLOCK:
            await self._light_entity.async_apply_display_mode(
                update_type="color_change"
            )

        self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    async def async_turn_on(self, **kwargs):
        await self._set_option(True)

    async def async_turn_off(self, **kwargs):
        await self._set_option(False)

    def async_update_from_light(self):
        self._attr_is_on = bool(getattr(self._light_entity, self.option_attr))
        if self.hass is not None:
            self.async_write_ha_state()


class YeelightCubeClockShowDateSwitch(_YeelightCubeClockOptionSwitch):
    """Show the date in the native clock rotation.

    Backward-compatible shortcut for the 3-way Clock Content select:
    ON  -> "time_date" (alternate time + date)
    OFF -> "time" (time only)
    When the content is "date" (date only), this switch reads as OFF.
    """

    option_attr = "_native_clock_show_date"
    option_key = "clock_show_date"

    async def _set_option(self, enabled: bool) -> None:
        # Route through the 3-way content setter so the Clock Content select
        # and this switch stay consistent.
        await self._light_entity.async_set_native_clock_content(
            "time_date" if enabled else "time"
        )
        self._attr_is_on = enabled
        self.async_write_ha_state()

    def async_update_from_light(self):
        self._attr_is_on = (
            getattr(self._light_entity, "_native_clock_content", "time")
            == "time_date"
        )
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._register_on_light("_clock_show_date_switch_entity")
        self.async_update_from_light()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


class YeelightCubeClock12HourSwitch(_YeelightCubeClockOptionSwitch):
    """Use 12-hour time in the native clock."""

    option_attr = "_native_clock_12_hour"
    option_key = "clock_12_hour"

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._register_on_light("_clock_12_hour_switch_entity")
        self.async_update_from_light()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


class YeelightCubeClockColonBlinkSwitch(_YeelightCubeClockOptionSwitch):
    """Blink the separator in the native clock."""

    option_attr = "_native_clock_colon_blink"
    option_key = "clock_colon_blink"

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._register_on_light("_clock_colon_blink_switch_entity")
        self.async_update_from_light()

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)


class YeelightCubeScrollSwitch(CubeControlEntity, SwitchEntity):
    """Enable automatic ping-pong scrolling for text wider than the matrix."""

    _attr_should_poll = False
    _attr_translation_key = "scroll_enabled"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, config_entry: ConfigEntry, light_entity):
        self._config_entry = config_entry
        self._light_entity = light_entity
        self._attr_unique_id = f"{self._light_entity._attr_unique_id}_scroll_enabled"
        self._attr_is_on = self._light_entity._scroll_enabled

    async def async_turn_on(self, **kwargs):
        self._light_entity._scroll_enabled = True
        self._attr_is_on = True
        if self._light_entity._max_scroll_offset > 0:
            self._light_entity._is_scrolling = True
            self._light_entity.start_scroll_timer()
        self.async_write_ha_state()
        self._light_entity.async_write_ha_state()

    async def async_turn_off(self, **kwargs):
        self._light_entity._scroll_enabled = False
        self._light_entity._is_scrolling = False
        self._light_entity.stop_scroll_timer()
        self._attr_is_on = False
        self.async_write_ha_state()
        self._light_entity.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._register_on_light("_scroll_enabled_switch_entity")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    def async_update_from_light(self):
        self._attr_is_on = self._light_entity._scroll_enabled
        if self.hass is not None:
            self.async_write_ha_state()
