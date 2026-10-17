"""Select platform for Yeelight Cube Lite: the lamp's dropdowns (palette,
pixel art, content and display modes, clock, native effects and settings)."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from homeassistant.components.select import SelectEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.exceptions import HomeAssistantError # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .const import (
    FIRMWARE_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    ALL_NATIVE_EFFECTS,
    CONF_IP,
    CONTENT_MODES,
    DEFAULT_MATRIX_DISPLAY_MODE,
    DEFAULT_MUSIC_FLOW_EFFECT,
    DEFAULT_NATIVE_CLOCK_CONTENT,
    DEFAULT_NATIVE_CLOCK_STYLE,
    EXPERIMENTAL_CLOCK_STYLE_IDS,
    DEFAULT_NATIVE_EFFECT,
    DOMAIN,
    EXTENDED_NATIVE_EFFECTS,
    MATRIX_DISPLAY_MODES,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_CONTENT_LABELS,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTIONS,
    NATIVE_EFFECTS,
    DEFAULT_POWER_ON_STATE,
    POWER_ON_STATES,
)
from .entity import CubeControlEntity, remove_retired_entities
from .builtin_pixel_art import find_pixel_art, get_builtin_pixel_art_map
from .layout import FONT_MAPS

_LOGGER = logging.getLogger(__name__)


class CubeSelect(CubeControlEntity, SelectEntity):
    """A dropdown of one lamp. The light keeps it in ``_slot`` and pushes
    every change made elsewhere through async_update_from_light, so it never
    polls. ``name`` (the older entities) is shown after the lamp's name; the
    others name themselves with a translation key."""

    _attr_should_poll = False
    _slot = None

    def __init__(self, light_entity, config_entry: ConfigEntry, unique_suffix: str, icon: str, name: str | None = None):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = f"{light_entity._attr_unique_id}_{unique_suffix}"
        self._attr_icon = icon
        if name:
            self._attr_name = f"{light_entity._attr_name} {name}"

    @callback
    def async_update_from_light(self):
        if self.hass is not None:
            self.async_write_ha_state()

    def _write_states(self):
        """Publish this dropdown and the lamp."""
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


@dataclass(frozen=True)
class SettingSelect:
    """One lamp setting as a dropdown: the light's ``attr``, shown as
    ``labels`` (value → label), set through the light's ``setter`` coroutine
    (stored directly when there is none)."""

    unique_suffix: str
    icon: str
    attr: str
    labels: dict
    default: str
    setter: str | None
    slot: str
    name: str | None = None
    translation_key: str | None = None
    category: EntityCategory | None = None


SETTING_SELECTS = (
    SettingSelect(
        "clock_content_select", "mdi:calendar-clock", "_native_clock_content",
        {key: NATIVE_CLOCK_CONTENT_LABELS[key] for key in NATIVE_CLOCK_CONTENT_OPTIONS},
        DEFAULT_NATIVE_CLOCK_CONTENT, "async_set_native_clock_content",
        "_clock_content_select_entity", translation_key="clock_content",
    ),
    SettingSelect(
        "music_flow_effect", "mdi:waveform", "_music_flow_effect",
        {effect: effect for effect in MUSIC_FLOW_EFFECTS},
        DEFAULT_MUSIC_FLOW_EFFECT, "async_set_music_flow_effect",
        "_music_flow_effect_select_entity", translation_key="music_flow_effect",
    ),
    SettingSelect(
        "power_on_state", "mdi:power-settings", "_power_on_state",
        {state: state for state in POWER_ON_STATES}, DEFAULT_POWER_ON_STATE,
        "async_set_power_on_state", "_power_on_state_select_entity",
        translation_key="power_on_state", category=EntityCategory.CONFIG,
    ),
    SettingSelect(
        "alignment_select", "mdi:format-align-center", "_alignment",
        {"left": "left", "center": "center", "right": "right"}, "center",
        "set_alignment", "_alignment_select_entity", name="Matrix: Text Alignment",
    ),
    SettingSelect(
        "font_select", "mdi:format-font", "_font",
        {key: key.capitalize() for key in FONT_MAPS}, "basic",
        "set_font", "_font_select_entity", name="Matrix: Font",
    ),
    # The 4-way physical mount (the official app's picker and the lamp
    # preview card's rotation); it replaced the "Flip Orientation" switch.
    SettingSelect(
        "device_orientation_select", "mdi:screen-rotation", "_device_orientation",
        {"right": "Right", "down": "Down", "left": "Left", "up": "Up"}, "right",
        "set_device_orientation", "_device_orientation_select_entity",
        name="Device Orientation",
    ),
)


class CubeSettingSelect(CubeSelect):
    """A dropdown of one lamp setting (SETTING_SELECTS)."""

    def __init__(self, light_entity, config_entry: ConfigEntry, spec: SettingSelect):
        super().__init__(light_entity, config_entry, spec.unique_suffix, spec.icon, spec.name)
        self._spec = spec
        self._slot = spec.slot
        self._attr_options = list(spec.labels.values())
        self._values = {label: value for value, label in spec.labels.items()}
        if spec.translation_key:
            self._attr_has_entity_name = True
            self._attr_translation_key = spec.translation_key
        if spec.category:
            self._attr_entity_category = spec.category

    @property
    def current_option(self) -> str:
        spec = self._spec
        value = getattr(self._light_entity, spec.attr, spec.default)
        return spec.labels.get(value, spec.labels[spec.default])

    async def async_select_option(self, option: str) -> None:
        value = self._values.get(option)
        if value is None:
            raise ValueError(f"Unknown option: {option}")
        if self._spec.setter:
            await getattr(self._light_entity, self._spec.setter)(value)
        else:
            setattr(self._light_entity, self._spec.attr, value)
        self._write_states()


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube Lite select entities from a config entry."""
    # Prime the read-only app gallery outside Home Assistant's event loop.
    await hass.async_add_executor_job(get_builtin_pixel_art_map)

    ip = entry.data[CONF_IP]

    # Get the light entity that was set up earlier
    if DOMAIN not in hass.data or entry.entry_id not in hass.data[DOMAIN]:
        return False

    light_entity = hass.data[DOMAIN][entry.entry_id].get("light")
    if not light_entity:
        return False

    # The matrix transition effect of an earlier version (transitions removed).
    remove_retired_entities(hass, "select", [f"{light_entity._attr_unique_id}_transition_select"])
    async_add_entities([
        YeelightCubePaletteSelect(light_entity, ip, entry, hass),
        YeelightCubePixelArtSelect(light_entity, ip, entry, hass),
        YeelightCubeContentModeSelect(light_entity, entry),
        YeelightCubeDisplayModeSelect(light_entity, entry),
        YeelightCubeClockStyleSelect(light_entity, entry),
        YeelightCubeNativeEffectSelect(light_entity, entry),
        YeelightCubeNativeEffectDirectionSelect(light_entity, entry),
        *(CubeSettingSelect(light_entity, entry, spec) for spec in SETTING_SELECTS),
    ])

    return True


class YeelightCubePaletteSelect(CubeSelect):
    """Select entity for choosing a palette to apply to the Yeelight Cube Lite."""

    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the palette selector entity."""
        super().__init__(light_entity, config_entry, "palette_select", "mdi:palette", "Matrix: Palette")
        self._ip = ip
        self._hass = hass
        self._attr_current_option = None

        # Initialize options from current palettes
        self._update_options()

    def _update_options(self):
        """Update the options list from the palette sensor."""
        if DOMAIN not in self._hass.data:
            self._attr_options = ["No palettes available"]
            return

        palettes = self._hass.data[DOMAIN].get("palettes_v2", [])

        if not palettes:
            self._attr_options = ["No palettes available"]
            return

        # Extract palette names
        palette_names = []
        for idx, palette in enumerate(palettes):
            name = palette.get("name", f"Palette {idx + 1}")
            palette_names.append(name)

        self._attr_options = palette_names
        _LOGGER.debug("[PALETTE SELECT] Updated options: %s palettes", len(palette_names))

    async def async_select_option(self, option: str) -> None:
        """Handle palette selection."""
        _LOGGER.debug("[PALETTE SELECT] User selected: '%s' for entity %s", option, self.entity_id)

        # Get palettes from storage
        if DOMAIN not in self._hass.data:
            _LOGGER.error("[PALETTE SELECT] No palette data in hass.data")
            return

        palettes = self._hass.data[DOMAIN].get("palettes_v2", [])

        if option == "No palettes available":
            _LOGGER.warning("[PALETTE SELECT] No palettes to apply")
            return

        # Find the palette index by name
        palette_idx = None
        for idx, palette in enumerate(palettes):
            if palette.get("name", f"Palette {idx + 1}") == option:
                palette_idx = idx
                break

        if palette_idx is None:
            _LOGGER.error("[PALETTE SELECT] Palette '%s' not found in storage", option)
            return

        # Apply the palette to the light entity
        palette = palettes[palette_idx]
        if "colors" not in palette or not isinstance(palette["colors"], list):
            _LOGGER.error("[PALETTE SELECT] Invalid palette format")
            return

        # Set the palette colors as the active color list for gradients/text modes
        self._light_entity._text_colors = palette["colors"]
        _LOGGER.debug("[PALETTE SELECT] Applied %s colors to light entity", len(palette['colors']))

        # Update rgb_color to stay in sync with Home Assistant color picker
        if self._light_entity._text_colors:
            self._light_entity._rgb_color = self._light_entity._text_colors[0]

        # Palette applies to text modes — disable pixel art mode
        self._light_entity._custom_pixels = None
        self._light_entity._custom_draw_active = False
        self._light_entity._active_pixel_art_name = None

        # Notify pixel art select entity (deselect)
        if self._light_entity._pixel_art_select_entity:
            self._light_entity._pixel_art_select_entity.async_update_from_light()

        # Route every palette change through the display state machine. This
        # lets Music Flow exit cleanly before Panel Color Sequence activates
        # direct matrix mode and keeps the switch/device state synchronized.
        await self._light_entity.async_apply_display_mode(
            update_type="color_change"
        )

        # Update the current selection
        self._attr_current_option = option
        self._write_states()

    @callback
    def async_update_from_palette_sensor(self):
        """Update options when palettes change."""
        old_options = self._attr_options.copy() if hasattr(self, '_attr_options') else []
        self._update_options()

        # If options changed, update state
        if old_options != self._attr_options:
            _LOGGER.debug("[PALETTE SELECT] Options updated: %s -> %s", len(old_options), len(self._attr_options))

            # If current selection is no longer valid, clear it
            if self._attr_current_option and self._attr_current_option not in self._attr_options:
                self._attr_current_option = None
                _LOGGER.debug("[PALETTE SELECT] Cleared invalid selection")

            if self.hass is not None:
                self.async_write_ha_state()

    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()

        # Listen for palette update events (unsubscribed automatically on removal)
        self.async_on_remove(
            self.hass.bus.async_listen(f"{DOMAIN}_palettes_updated", self._handle_palette_update)
        )
        _LOGGER.debug("[PALETTE SELECT] Registered for palette update events")

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    async def _handle_palette_update(self, event):
        """Handle palette update events."""
        _LOGGER.debug("[PALETTE SELECT] Received palette update event")
        self.async_update_from_palette_sensor()


class YeelightCubePixelArtSelect(CubeSelect):
    """Select entity for choosing a saved pixel art to display on the Yeelight Cube Lite."""

    _slot = "_pixel_art_select_entity"

    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the pixel art selector entity."""
        super().__init__(light_entity, config_entry, "pixel_art_select", "mdi:image", "Matrix: Pixel Art")
        self._ip = ip
        self._hass = hass
        self._attr_current_option = None

        # Initialize options from current pixel arts
        self._update_options()

    def _update_options(self):
        """Update options from user storage and the read-only app gallery."""
        pixel_arts = self._hass.data.get(DOMAIN, {}).get("pixel_arts", [])

        art_names = []
        for idx, art in enumerate(pixel_arts):
            name = art.get("name", f"Pixel Art {idx + 1}")
            art_names.append(name)

        self._attr_options = art_names + list(get_builtin_pixel_art_map())
        _LOGGER.debug("[PIXEL ART SELECT] Updated options: %s pixel arts", len(art_names))

    async def async_select_option(self, option: str) -> None:
        """Handle pixel art selection — apply the chosen pixel art to the lamp."""
        _LOGGER.debug("[PIXEL ART SELECT] User selected: '%s' for entity %s", option, self.entity_id)

        art = find_pixel_art(self._hass.data.get(DOMAIN, {}).get("pixel_arts", []), option)
        if not art or not isinstance(art.get("pixels"), list) or not art["pixels"]:
            _LOGGER.error("[PIXEL ART SELECT] Pixel art '%s' not found or empty", option)
            return
        await self._light_entity.show_pixel_art(option, art["pixels"])
        _LOGGER.debug("[PIXEL ART SELECT] Applied pixel art '%s' to %s", option, self._ip)

    @callback
    def async_update_from_light(self):
        """Called by external code (light entity, text entity, palette select) to sync the dropdown.

        Reads _active_pixel_art_name from the light entity.
        If the light is displaying a named pixel art that's in our options, select it.
        Otherwise, clear the selection.
        """
        name = getattr(self._light_entity, '_active_pixel_art_name', None)
        is_active = (
            getattr(self._light_entity, "_mode", None) == "Custom Draw"
            and getattr(self._light_entity, "_custom_draw_active", False)
        )
        if is_active and name and name in self._attr_options:
            self._attr_current_option = name
        else:
            self._attr_current_option = None

        if self.hass is not None:
            self.async_write_ha_state()

    @callback
    def async_update_from_pixel_art_sensor(self):
        """Update options when pixel arts change (add/delete/rename)."""
        old_options = self._attr_options.copy() if hasattr(self, '_attr_options') else []
        self._update_options()

        if old_options != self._attr_options:
            _LOGGER.debug("[PIXEL ART SELECT] Options updated: %s -> %s", len(old_options), len(self._attr_options))

            # If current selection is no longer valid, clear it
            if self._attr_current_option and self._attr_current_option not in self._attr_options:
                self._attr_current_option = None
                _LOGGER.debug("[PIXEL ART SELECT] Cleared invalid selection")

            if self.hass is not None:
                self.async_write_ha_state()

    async def async_added_to_hass(self):
        """Run when entity is added to hass (registered with the light and
        synced by the base)."""
        await super().async_added_to_hass()

        # Listen for pixel art update events (unsubscribed automatically on removal)
        self.async_on_remove(
            self.hass.bus.async_listen(f"{DOMAIN}_pixel_arts_updated", self._handle_pixel_arts_update)
        )
        _LOGGER.debug("[PIXEL ART SELECT] Registered for pixel art update events, linked to %s", self._ip)

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    async def _handle_pixel_arts_update(self, event):
        """Handle pixel art update events (fired when arts are saved/deleted/imported)."""
        _LOGGER.debug("[PIXEL ART SELECT] Received pixel arts update event")
        self.async_update_from_pixel_art_sensor()


class YeelightCubeContentModeSelect(CubeSelect):
    """Select the active content source: matrix or clock."""

    _attr_has_entity_name = True
    _attr_translation_key = "content_mode"
    _slot = "_content_mode_select_entity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "content_mode_select", "mdi:layers-triple")
        self._attr_options = list(CONTENT_MODES)

    @property
    def current_option(self) -> str | None:
        if getattr(self._light_entity, "_music_flow_enabled", False):
            return "Music Flow"
        mode = getattr(self._light_entity, "_mode", DEFAULT_MATRIX_DISPLAY_MODE)
        return mode if mode in FIRMWARE_MODES else "Matrix"

    async def async_select_option(self, option: str) -> None:
        if option not in CONTENT_MODES:
            _LOGGER.error("[CONTENT MODE] Invalid mode: %s", option)
            return
        current_mode = getattr(
            self._light_entity, "_mode", DEFAULT_MATRIX_DISPLAY_MODE
        )
        if current_mode in MATRIX_DISPLAY_MODES:
            self._light_entity._matrix_mode = current_mode

        if option == "Music Flow":
            # Music Flow is the device's built-in microphone renderer, not a
            # matrix mode. Turning it on suppresses matrix content until another
            # content mode is selected (which exits it via async_apply_display_mode).
            # It is sent to the firmware directly, outside the display queue's
            # off-lamp rule: refused like the native-effect action.
            if (
                not self._light_entity._is_on
                and not self._light_entity._should_auto_turn_on()
            ):
                raise HomeAssistantError("Lamp is off and auto-turn-on is disabled")
            await self._light_entity.async_set_music_flow(True)
            self.async_update_from_light()
            if self._light_entity._music_flow_effect_select_entity:
                self._light_entity._music_flow_effect_select_entity.async_update_from_light()
            if self._light_entity.hass is not None:
                self._light_entity.async_write_ha_state()
            return

        if option == "Matrix":
            matrix_mode = getattr(
                self._light_entity,
                "_matrix_mode",
                DEFAULT_MATRIX_DISPLAY_MODE,
            )
            if matrix_mode not in MATRIX_DISPLAY_MODES:
                matrix_mode = DEFAULT_MATRIX_DISPLAY_MODE
                self._light_entity._matrix_mode = matrix_mode
            if matrix_mode == "Custom Draw" and not self._light_entity._custom_pixels:
                matrix_mode = DEFAULT_MATRIX_DISPLAY_MODE
                self._light_entity._matrix_mode = matrix_mode
            self._light_entity._mode = matrix_mode
            self._light_entity._custom_draw_active = (
                matrix_mode == "Custom Draw"
                and bool(self._light_entity._custom_pixels)
            )
        else:
            self._light_entity._mode = option
            self._light_entity._custom_draw_active = False

        await self._light_entity.async_apply_display_mode(
            update_type="color_change"
        )
        self.async_update_from_light()
        if self._light_entity._mode_select_entity:
            self._light_entity._mode_select_entity.async_update_from_light()
        if self._light_entity._pixel_art_select_entity:
            self._light_entity._pixel_art_select_entity.async_update_from_light()
        # Keep native-effect helper entities in sync so their UI reflects the
        # current selection when switching into Native Effect content mode.
        if option == MODE_NATIVE_EFFECT:
            if self._light_entity._native_effect_select_entity:
                self._light_entity._native_effect_select_entity.async_write_ha_state()
            if self._light_entity._native_effect_direction_select_entity:
                self._light_entity._native_effect_direction_select_entity.async_update_from_light()
            if self._light_entity._native_effect_speed_entity:
                self._light_entity._native_effect_speed_entity.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()


class YeelightCubeDisplayModeSelect(CubeSelect):
    """Select the render mode used by Matrix content."""

    _slot = "_mode_select_entity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the display mode selector entity."""
        super().__init__(
            light_entity, config_entry, "display_mode_select",
            "mdi:view-dashboard-variant", "Matrix: Display Mode",
        )
        self._attr_options = list(MATRIX_DISPLAY_MODES)

    @property
    def current_option(self) -> str | None:
        """Return the current or last-used Matrix render mode."""
        mode = getattr(self._light_entity, "_mode", DEFAULT_MATRIX_DISPLAY_MODE)
        if mode in MATRIX_DISPLAY_MODES:
            return mode
        return getattr(
            self._light_entity, "_matrix_mode", DEFAULT_MATRIX_DISPLAY_MODE
        )

    async def async_select_option(self, option: str) -> None:
        """Handle display mode selection — apply the chosen mode to the lamp."""
        _LOGGER.debug("[MODE SELECT] User selected: '%s' for %s", option, self._light_entity._ip)

        if option not in MATRIX_DISPLAY_MODES:
            _LOGGER.error("[MODE SELECT] Invalid mode: '%s'", option)
            return

        self._light_entity._matrix_mode = option
        self._light_entity._mode = option
        if option == "Custom Draw":
            self._light_entity._custom_draw_active = bool(
                self._light_entity._custom_pixels
            )
        else:
            self._light_entity._custom_draw_active = False
            self._light_entity._custom_pixels = None
            # Switching to a text mode clears pixel art selection
            self._light_entity._active_pixel_art_name = None
            if self._light_entity._pixel_art_select_entity:
                self._light_entity._pixel_art_select_entity.async_update_from_light()

        await self._light_entity.async_apply_display_mode(update_type='color_change')

        self._write_states()
        if self._light_entity._content_mode_select_entity:
            self._light_entity._content_mode_select_entity.async_update_from_light()

    @callback
    def async_update_from_light(self):
        """Called by external code to sync the dropdown with the light entity's
        mode (and remember the last Matrix render mode)."""
        mode = getattr(self._light_entity, "_mode", DEFAULT_MATRIX_DISPLAY_MODE)
        if mode in MATRIX_DISPLAY_MODES:
            self._light_entity._matrix_mode = mode
        if self.hass is not None:
            self.async_write_ha_state()


def _clock_style_label(style_id: int) -> str:
    """Return the descriptive name for a native clock style."""
    style = NATIVE_CLOCK_STYLES.get(style_id, {})
    return style.get("name", "Unknown")


_CLOCK_STYLE_TO_ID = {
    _clock_style_label(style_id): style_id for style_id in NATIVE_CLOCK_STYLES
}


class YeelightCubeClockStyleSelect(CubeSelect):
    """Select a native firmware clock face."""

    _attr_has_entity_name = True
    _attr_translation_key = "clock_style"
    _slot = "_clock_style_select_entity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "clock_style_select", "mdi:clock-digital")

    @property
    def options(self) -> list[str]:
        if getattr(self._light_entity, "_extended_effects_enabled", False):
            # Show every style sorted by firmware mixer (the background mode).
            style_ids = sorted(
                NATIVE_CLOCK_STYLES,
                key=lambda style_id: NATIVE_CLOCK_STYLES[style_id]["mixer"],
            )
        else:
            style_ids = [
                style_id
                for style_id in NATIVE_CLOCK_STYLES
                if style_id not in EXPERIMENTAL_CLOCK_STYLE_IDS
            ]
        current = getattr(
            self._light_entity,
            "_native_clock_style",
            DEFAULT_NATIVE_CLOCK_STYLE,
        )
        if current not in style_ids:
            style_ids.append(current)
        return [_clock_style_label(style_id) for style_id in style_ids]

    @property
    def current_option(self) -> str | None:
        return _clock_style_label(
            getattr(self._light_entity, "_native_clock_style", DEFAULT_NATIVE_CLOCK_STYLE)
        )

    async def async_select_option(self, option: str) -> None:
        style_id = _CLOCK_STYLE_TO_ID.get(option)
        if style_id is None:
            _LOGGER.error("[CLOCK STYLE] Unknown option: '%s'", option)
            return
        if (
            style_id in EXPERIMENTAL_CLOCK_STYLE_IDS
            and not getattr(self._light_entity, "_extended_effects_enabled", False)
        ):
            raise ValueError(
                f"Clock style '{option}' requires the Experimental Features switch"
            )

        self._light_entity._native_clock_style = style_id

        if self._light_entity._mode == MODE_CLOCK:
            await self._light_entity.async_apply_display_mode(
                update_type="color_change"
            )

        self._write_states()


class YeelightCubeNativeEffectSelect(CubeSelect):
    """Select one of the firmware-native Cube Lite animations."""

    _attr_has_entity_name = True
    _attr_translation_key = "native_effect"
    _slot = "_native_effect_select_entity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "native_effect", "mdi:creation")

    @property
    def options(self) -> list:
        # Extended ("discovered") effects only appear when the switch is on; the
        # currently-selected effect is always kept so HA never warns about an
        # out-of-list value if the switch is toggled off while one is active.
        if getattr(self._light_entity, "_extended_effects_enabled", False):
            # Show the full catalogue sorted by firmware mode number.
            names = sorted(
                ALL_NATIVE_EFFECTS,
                key=lambda name: ALL_NATIVE_EFFECTS[name]["mode"],
            )
        else:
            names = list(NATIVE_EFFECTS)
        current = getattr(self._light_entity, "_native_effect", DEFAULT_NATIVE_EFFECT)
        if current not in names:
            names.append(current)
        return names

    @property
    def current_option(self) -> str:
        return getattr(self._light_entity, "_native_effect", DEFAULT_NATIVE_EFFECT)

    async def async_select_option(self, option: str) -> None:
        if option not in ALL_NATIVE_EFFECTS:
            raise ValueError(f"Unknown native effect: {option}")
        if (
            option in EXTENDED_NATIVE_EFFECTS
            and not getattr(self._light_entity, "_extended_effects_enabled", False)
        ):
            raise ValueError(
                f"Extended effect '{option}' requires the Experimental Features switch"
            )
        self._light_entity._native_effect = option
        if self._light_entity._native_effect_direction_select_entity:
            self._light_entity._native_effect_direction_select_entity.async_update_from_light()
        if self._light_entity._native_effect_speed_entity:
            self._light_entity._native_effect_speed_entity.async_write_ha_state()
        if self._light_entity._mode == MODE_NATIVE_EFFECT and self._light_entity._is_on:
            await self._light_entity.async_apply_display_mode(
                update_type="color_change"
            )
        self._write_states()


class YeelightCubeNativeEffectDirectionSelect(CubeSelect):
    """Select the direction used by directional native animations."""

    _attr_has_entity_name = True
    _attr_translation_key = "native_effect_direction"
    _attr_entity_category = EntityCategory.CONFIG
    _slot = "_native_effect_direction_select_entity"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "native_effect_direction", "mdi:arrow-all")
        self._attr_options = list(NATIVE_EFFECT_DIRECTIONS)

    @property
    def available(self) -> bool:
        spec = ALL_NATIVE_EFFECTS[self._light_entity._native_effect]
        return self._light_entity.available and bool(spec.get("directions"))

    @property
    def current_option(self) -> str:
        directions = ALL_NATIVE_EFFECTS[self._light_entity._native_effect].get(
            "directions", NATIVE_EFFECT_DIRECTIONS
        )
        current = self._light_entity._native_effect_direction
        return current if current in directions else directions[0]

    async def async_select_option(self, option: str) -> None:
        if option not in NATIVE_EFFECT_DIRECTIONS:
            raise ValueError(f"Unknown native effect direction: {option}")
        self._light_entity._native_effect_direction = option
        # Device orientation is the persistent source of truth that the effect
        # activation reads back. Mirror this choice into it so the direction
        # survives reboots and is re-applied on the next activation instead of
        # being overridden by a diverged orientation value.
        key = option.lower()
        self._light_entity._device_orientation = key
        self._light_entity._orientation = (
            "flipped" if key in ("left", "up") else "normal"
        )
        if self._light_entity._device_orientation_select_entity:
            self._light_entity._device_orientation_select_entity.async_update_from_light()
        spec = ALL_NATIVE_EFFECTS[self._light_entity._native_effect]
        if (
            spec.get("directions")
            and self._light_entity._mode == MODE_NATIVE_EFFECT
            and self._light_entity._is_on
        ):
            await self._light_entity.async_apply_display_mode(
                update_type="color_change"
            )
        self._write_states()

    @callback
    def async_update_from_light(self):
        directions = ALL_NATIVE_EFFECTS[self._light_entity._native_effect].get(
            "directions", NATIVE_EFFECT_DIRECTIONS
        )
        self._attr_options = list(directions)
        if self._light_entity._native_effect_direction not in directions:
            self._light_entity._native_effect_direction = directions[0]
        if self.hass is not None:
            self.async_write_ha_state()
