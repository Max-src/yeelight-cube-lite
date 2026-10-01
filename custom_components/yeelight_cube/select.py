"""Select platform for Yeelight Cube Lite - provides dropdown controls for palette and pixel art selection."""

import logging
from homeassistant.components.select import SelectEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .const import (
    TRANSITION_TYPES,
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
    POWER_ON_STATES,
)
from .entity import CubeControlEntity
from .builtin_pixel_art import get_builtin_pixel_art_map
from .layout import FONT_MAPS

_LOGGER = logging.getLogger(__name__)


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
    
    # Create all select entities
    palette_select = YeelightCubePaletteSelect(light_entity, ip, entry, hass)
    pixel_art_select = YeelightCubePixelArtSelect(light_entity, ip, entry, hass)
    content_mode_select = YeelightCubeContentModeSelect(light_entity, entry)
    mode_select = YeelightCubeDisplayModeSelect(light_entity, entry)
    clock_style_select = YeelightCubeClockStyleSelect(light_entity, entry)
    clock_content_select = YeelightCubeClockContentSelect(light_entity, entry)
    native_effect_select = YeelightCubeNativeEffectSelect(light_entity, entry)
    native_effect_direction_select = YeelightCubeNativeEffectDirectionSelect(
        light_entity, entry
    )
    music_flow_effect_select = YeelightCubeMusicFlowEffectSelect(
        light_entity, entry
    )
    power_on_state_select = YeelightCubePowerOnStateSelect(light_entity, entry)
    alignment_select = YeelightCubeAlignmentSelect(light_entity, entry)
    font_select = YeelightCubeFontSelect(light_entity, entry)
    transition_select = YeelightCubeTransitionSelect(light_entity, entry)
    device_orientation_select = YeelightCubeDeviceOrientationSelect(
        light_entity, entry
    )
    async_add_entities([
        palette_select,
        pixel_art_select,
        content_mode_select,
        mode_select,
        clock_style_select,
        clock_content_select,
        native_effect_select,
        native_effect_direction_select,
        music_flow_effect_select,
        power_on_state_select,
        alignment_select,
        font_select,
        transition_select,
        device_orientation_select,
    ])
    
    return True


class YeelightCubePaletteSelect(CubeControlEntity, SelectEntity):
    """Select entity for choosing a palette to apply to the Yeelight Cube Lite."""
    
    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the palette selector entity."""
        self._light_entity = light_entity
        self._ip = ip
        self._config_entry = config_entry
        self._hass = hass
        self._attr_name = f"{light_entity._attr_name} Matrix: Palette"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_palette_select"
        self._attr_icon = "mdi:palette"
        self._attr_current_option = None
        
        # Initialize options from current palettes
        self._update_options()
    
    @property
    def options(self) -> list[str]:
        """Return the list of available palette names."""
        return self._attr_options
    
    @property
    def current_option(self) -> str | None:
        """Return the currently selected palette (None if none selected)."""
        return self._attr_current_option
    
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
        
        # Notify Home Assistant of the state change
        if self.hass is not None:
            self.async_write_ha_state()
        
        # Also trigger light entity state update
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()
    
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
    
    async def _handle_palette_update(self, event):
        """Handle palette update events."""
        _LOGGER.debug("[PALETTE SELECT] Received palette update event")
        self.async_update_from_palette_sensor()


class YeelightCubePixelArtSelect(CubeControlEntity, SelectEntity):
    """Select entity for choosing a saved pixel art to display on the Yeelight Cube Lite."""

    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the pixel art selector entity."""
        self._light_entity = light_entity
        self._ip = ip
        self._config_entry = config_entry
        self._hass = hass
        self._attr_name = f"{light_entity._attr_name} Matrix: Pixel Art"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_pixel_art_select"
        self._attr_icon = "mdi:image"
        self._attr_current_option = None

        # Initialize options from current pixel arts
        self._update_options()

    @property
    def options(self) -> list[str]:
        """Return the list of available pixel art names."""
        return self._attr_options

    @property
    def current_option(self) -> str | None:
        """Return the currently selected pixel art (None if none selected)."""
        return self._attr_current_option

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

        pixel_arts = self._hass.data.get(DOMAIN, {}).get("pixel_arts", [])

        # Find the pixel art by name
        art_idx = None
        for idx, art in enumerate(pixel_arts):
            if art.get("name", f"Pixel Art {idx + 1}") == option:
                art_idx = idx
                break

        if art_idx is None:
            art = get_builtin_pixel_art_map().get(option)
            if art is None:
                _LOGGER.error("[PIXEL ART SELECT] Pixel art '%s' not found", option)
                return
        else:
            art = pixel_arts[art_idx]
        if "pixels" not in art or not isinstance(art["pixels"], list) or len(art["pixels"]) == 0:
            _LOGGER.error("[PIXEL ART SELECT] Invalid pixel art format for '%s'", option)
            return

        # Check auto-turn-on setting
        if not self._light_entity._is_on and not self._light_entity._should_auto_turn_on():
            _LOGGER.debug("[PIXEL ART SELECT] Lamp is off and auto-turn-on is disabled, ignoring")
            return

        # Apply pixel art to the light entity (same logic as handle_apply_pixel_art)
        self._light_entity._custom_pixels = art["pixels"]
        self._light_entity._mode = "Custom Draw"
        self._light_entity._matrix_mode = "Custom Draw"
        self._light_entity._custom_draw_active = True
        self._light_entity._active_pixel_art_name = option
        # Stop scroll timer — pixel art mode doesn't scroll
        self._light_entity.stop_scroll_timer()
        self._light_entity._is_scrolling = False

        # Clear palette selection since we're switching to pixel art mode
        if hasattr(self._light_entity, '_palette_select_entity') and self._light_entity._palette_select_entity:
            pass  # Palette entity doesn't need clearing — it just keeps its last selection

        await self._light_entity.async_apply_display_mode(update_type='pixel_art')
        _LOGGER.debug("[PIXEL ART SELECT] Applied pixel art '%s' to %s", option, self._ip)

        # Update the current selection
        self._attr_current_option = option

        # Notify Home Assistant of the state change
        if self.hass is not None:
            self.async_write_ha_state()

        # Also trigger light entity state update
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()
        if self._light_entity._mode_select_entity:
            self._light_entity._mode_select_entity.async_update_from_light()
        if self._light_entity._content_mode_select_entity:
            self._light_entity._content_mode_select_entity.async_update_from_light()

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
        """Run when entity is added to hass."""
        await super().async_added_to_hass()

        # Register ourselves with the light entity so it can notify us
        self._light_entity._pixel_art_select_entity = self

        # Listen for pixel art update events (unsubscribed automatically on removal)
        self.async_on_remove(
            self.hass.bus.async_listen(f"{DOMAIN}_pixel_arts_updated", self._handle_pixel_arts_update)
        )
        _LOGGER.debug("[PIXEL ART SELECT] Registered for pixel art update events, linked to %s", self._ip)

        # Sync initial state from light entity
        self.async_update_from_light()

    async def _handle_pixel_arts_update(self, event):
        """Handle pixel art update events (fired when arts are saved/deleted/imported)."""
        _LOGGER.debug("[PIXEL ART SELECT] Received pixel arts update event")
        self.async_update_from_pixel_art_sensor()


ALIGNMENT_OPTIONS = ["left", "center", "right"]


class YeelightCubeContentModeSelect(CubeControlEntity, SelectEntity):
    """Select the active content source: matrix or clock."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "content_mode"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = (
            f"{light_entity._attr_unique_id}_content_mode_select"
        )
        self._attr_icon = "mdi:layers-triple"
        self._attr_options = list(CONTENT_MODES)
        self._attr_current_option = self._content_mode()

    def _content_mode(self) -> str:
        if getattr(self._light_entity, "_music_flow_enabled", False):
            return "Music Flow"
        mode = getattr(self._light_entity, "_mode", DEFAULT_MATRIX_DISPLAY_MODE)
        return mode if mode in FIRMWARE_MODES else "Matrix"

    @property
    def current_option(self) -> str | None:
        return self._content_mode()

    async def async_select_option(self, option: str) -> None:
        if option not in CONTENT_MODES:
            _LOGGER.error("[CONTENT MODE] Invalid mode: %s", option)
            return
        if (
            not self._light_entity._is_on
            and not self._light_entity._should_auto_turn_on()
        ):
            _LOGGER.debug(
                "[CONTENT MODE] Lamp is off and auto-turn-on is disabled, ignoring"
            )
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

    @callback
    def async_update_from_light(self):
        self._attr_current_option = self._content_mode()
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._content_mode_select_entity = self
        self.async_update_from_light()


class YeelightCubeDisplayModeSelect(CubeControlEntity, SelectEntity):
    """Select the render mode used by Matrix content."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the display mode selector entity."""
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Matrix: Display Mode"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_display_mode_select"
        self._attr_icon = "mdi:view-dashboard-variant"
        self._attr_options = list(MATRIX_DISPLAY_MODES)
        self._attr_current_option = getattr(
            light_entity, "_matrix_mode", DEFAULT_MATRIX_DISPLAY_MODE
        )

    @property
    def options(self) -> list[str]:
        return self._attr_options

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

        # Check auto-turn-on setting
        if not self._light_entity._is_on and not self._light_entity._should_auto_turn_on():
            _LOGGER.debug("[MODE SELECT] Lamp is off and auto-turn-on is disabled, ignoring")
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

        # Update state
        self._attr_current_option = option
        if self.hass is not None:
            self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()
        if self._light_entity._content_mode_select_entity:
            self._light_entity._content_mode_select_entity.async_update_from_light()

    @callback
    def async_update_from_light(self):
        """Called by external code to sync the dropdown with the light entity's mode."""
        mode = getattr(self._light_entity, "_mode", DEFAULT_MATRIX_DISPLAY_MODE)
        if mode in MATRIX_DISPLAY_MODES:
            self._light_entity._matrix_mode = mode
        self._attr_current_option = getattr(
            self._light_entity, "_matrix_mode", DEFAULT_MATRIX_DISPLAY_MODE
        )
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()
        self._light_entity._mode_select_entity = self
        _LOGGER.debug("[MODE SELECT] Registered for %s, current mode=%s", self._light_entity._ip, self._light_entity._mode)


def _clock_style_label(style_id: int) -> str:
    """Return the descriptive name for a native clock style."""
    style = NATIVE_CLOCK_STYLES.get(style_id, {})
    return style.get("name", "Unknown")


_CLOCK_STYLE_TO_ID = {
    _clock_style_label(style_id): style_id for style_id in NATIVE_CLOCK_STYLES
}


class YeelightCubeClockStyleSelect(CubeControlEntity, SelectEntity):
    """Select a native firmware clock face."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "clock_style"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = f"{light_entity._attr_unique_id}_clock_style_select"
        self._attr_icon = "mdi:clock-digital"
        self._attr_current_option = self._style_label()

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

    def _style_label(self) -> str:
        style_id = getattr(
            self._light_entity,
            "_native_clock_style",
            DEFAULT_NATIVE_CLOCK_STYLE,
        )
        return _clock_style_label(style_id)

    @property
    def current_option(self) -> str | None:
        return self._style_label()

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
        self._attr_current_option = option

        if (
            self._light_entity._mode == MODE_CLOCK
            and (
                self._light_entity._is_on
                or self._light_entity._should_auto_turn_on()
            )
        ):
            await self._light_entity.async_apply_display_mode(
                update_type="color_change"
            )

        if self.hass is not None:
            self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        self._attr_current_option = self._style_label()
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._clock_style_select_entity = self
        self.async_update_from_light()
        _LOGGER.debug(
            "[CLOCK STYLE] Registered for %s, "
            "current style=%s",
            self._light_entity._ip, self._light_entity._native_clock_style
        )


_CLOCK_CONTENT_LABEL_TO_KEY = {v: k for k, v in NATIVE_CLOCK_CONTENT_LABELS.items()}
_CLOCK_CONTENT_OPTIONS = [
    NATIVE_CLOCK_CONTENT_LABELS[k] for k in NATIVE_CLOCK_CONTENT_OPTIONS
]


class YeelightCubeClockContentSelect(CubeControlEntity, SelectEntity):
    """Select what the native clock shows: Time, Time & Date, or Date only.

    Drives data byte 0 of the firmware clock payload (1 = time, 2 = alternate
    time+date, 3 = date only).  The legacy "Show Date" switch is a shortcut
    that maps to Time <-> Time & Date and stays in sync with this select.
    """

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "clock_content"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = (
            f"{light_entity._attr_unique_id}_clock_content_select"
        )
        self._attr_icon = "mdi:calendar-clock"
        self._attr_options = _CLOCK_CONTENT_OPTIONS
        self._attr_current_option = self._content_label()

    def _content_label(self) -> str:
        key = getattr(
            self._light_entity,
            "_native_clock_content",
            DEFAULT_NATIVE_CLOCK_CONTENT,
        )
        return NATIVE_CLOCK_CONTENT_LABELS.get(
            key, NATIVE_CLOCK_CONTENT_LABELS[DEFAULT_NATIVE_CLOCK_CONTENT]
        )

    @property
    def current_option(self) -> str | None:
        return self._content_label()

    async def async_select_option(self, option: str) -> None:
        key = _CLOCK_CONTENT_LABEL_TO_KEY.get(option)
        if key is None:
            _LOGGER.error("[CLOCK CONTENT] Unknown option: '%s'", option)
            return
        self._attr_current_option = option
        await self._light_entity.async_set_native_clock_content(key)

    @callback
    def async_update_from_light(self):
        self._attr_current_option = self._content_label()
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._clock_content_select_entity = self
        self.async_update_from_light()


class YeelightCubeNativeEffectSelect(CubeControlEntity, SelectEntity):
    """Select one of the firmware-native Cube Lite animations."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "native_effect"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = f"{light_entity._attr_unique_id}_native_effect"
        self._attr_icon = "mdi:creation"

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
        self.async_write_ha_state()
        self._light_entity.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._native_effect_select_entity = self


class YeelightCubeNativeEffectDirectionSelect(CubeControlEntity, SelectEntity):
    """Select the direction used by directional native animations."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "native_effect_direction"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = (
            f"{light_entity._attr_unique_id}_native_effect_direction"
        )
        self._attr_icon = "mdi:arrow-all"
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
        self.async_write_ha_state()
        self._light_entity.async_write_ha_state()

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

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._native_effect_direction_select_entity = self
        self.async_update_from_light()


class YeelightCubeMusicFlowEffectSelect(CubeControlEntity, SelectEntity):
    """Select the firmware effect used by device-microphone Music Flow."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "music_flow_effect"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = (
            f"{light_entity._attr_unique_id}_music_flow_effect"
        )
        self._attr_icon = "mdi:waveform"
        self._attr_options = list(MUSIC_FLOW_EFFECTS)

    @property
    def current_option(self) -> str:
        return getattr(
            self._light_entity,
            "_music_flow_effect",
            DEFAULT_MUSIC_FLOW_EFFECT,
        )

    async def async_select_option(self, option: str) -> None:
        await self._light_entity.async_set_music_flow_effect(option)
        self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._music_flow_effect_select_entity = self
        self.async_update_from_light()

    def async_update_from_light(self):
        if self.hass is not None:
            self.async_write_ha_state()


class YeelightCubePowerOnStateSelect(CubeControlEntity, SelectEntity):
    """Configure the device's behavior after mains power is restored."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "power_on_state"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = f"{light_entity._attr_unique_id}_power_on_state"
        self._attr_icon = "mdi:power-settings"
        self._attr_options = list(POWER_ON_STATES)

    @property
    def current_option(self) -> str:
        return self._light_entity._power_on_state

    async def async_select_option(self, option: str) -> None:
        await self._light_entity.async_set_power_on_state(option)
        self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._power_on_state_select_entity = self


class YeelightCubeAlignmentSelect(CubeControlEntity, SelectEntity):
    """Select entity for choosing text alignment (left/center/right) on the Yeelight Cube Lite."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the text alignment selector entity."""
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Matrix: Text Alignment"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_alignment_select"
        self._attr_icon = "mdi:format-align-center"
        self._attr_options = ALIGNMENT_OPTIONS
        self._attr_current_option = getattr(light_entity, '_alignment', 'center')

    @property
    def options(self) -> list[str]:
        return self._attr_options

    @property
    def current_option(self) -> str | None:
        """Return the current alignment from the light entity."""
        return getattr(self._light_entity, '_alignment', 'center')

    async def async_select_option(self, option: str) -> None:
        """Handle alignment selection — apply to the lamp."""
        _LOGGER.debug("[ALIGNMENT SELECT] User selected: '%s' for %s", option, self._light_entity._ip)

        if option not in ALIGNMENT_OPTIONS:
            _LOGGER.error("[ALIGNMENT SELECT] Invalid alignment: '%s'", option)
            return

        # Check auto-turn-on setting
        if not self._light_entity._is_on and not self._light_entity._should_auto_turn_on():
            _LOGGER.debug("[ALIGNMENT SELECT] Lamp is off and auto-turn-on is disabled, ignoring")
            return

        # Use the entity's own set_alignment method which does apply + state update
        await self._light_entity.set_alignment(option)

        # Update our state
        self._attr_current_option = option
        if self.hass is not None:
            self.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        """Called by external code to sync the dropdown with the light entity's alignment."""
        self._attr_current_option = getattr(self._light_entity, '_alignment', 'center')
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()
        self._light_entity._alignment_select_entity = self
        _LOGGER.debug("[ALIGNMENT SELECT] Registered for %s, current alignment=%s", self._light_entity._ip, self._light_entity._alignment)


# ── Device orientation selector ────────────────────────────────────────
# 4-way physical mount orientation (matches the official app + preview card).
# Display labels map to the lowercase keys used by set_device_orientation.
_DEVICE_ORIENTATION_LABELS = {
    "right": "Right",
    "down": "Down",
    "left": "Left",
    "up": "Up",
}
_DEVICE_ORIENTATION_OPTIONS = list(_DEVICE_ORIENTATION_LABELS.values())
_DEVICE_ORIENTATION_LABEL_TO_KEY = {
    v: k for k, v in _DEVICE_ORIENTATION_LABELS.items()
}


class YeelightCubeDeviceOrientationSelect(CubeControlEntity, SelectEntity):
    """Select the 4-way physical device orientation (right/down/left/up).

    Replaces the old on/off "Flip Orientation" switch. Applies to the lamp
    immediately for all modes and drives the lamp preview card's rotation.
    """

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Device Orientation"
        self._attr_unique_id = (
            f"{light_entity._attr_unique_id}_device_orientation_select"
        )
        self._attr_icon = "mdi:screen-rotation"
        self._attr_options = _DEVICE_ORIENTATION_OPTIONS

    @property
    def options(self) -> list[str]:
        return self._attr_options

    @property
    def current_option(self) -> str | None:
        key = getattr(self._light_entity, "_device_orientation", "right")
        return _DEVICE_ORIENTATION_LABELS.get(key, "Right")

    async def async_select_option(self, option: str) -> None:
        key = _DEVICE_ORIENTATION_LABEL_TO_KEY.get(option)
        if key is None:
            _LOGGER.error("[DEVICE ORIENTATION] Invalid option: '%s'", option)
            return
        await self._light_entity.set_device_orientation(key)
        if self.hass is not None:
            self.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        """Sync the dropdown with the light entity's device orientation."""
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._device_orientation_select_entity = self


# ── Font selector ──────────────────────────────────────────────────────
# Display-friendly labels for each font key
_FONT_LABELS = {k: k.capitalize() for k in FONT_MAPS}   # basic→Basic, fat→Fat, …
_FONT_OPTIONS = list(_FONT_LABELS.values())               # ["Basic", "Fat", "Italic"]
_LABEL_TO_KEY = {v: k for k, v in _FONT_LABELS.items()}   # reverse lookup


class YeelightCubeFontSelect(CubeControlEntity, SelectEntity):
    """Select entity for choosing the matrix font on the Yeelight Cube Lite."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Matrix: Font"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_font_select"
        self._attr_icon = "mdi:format-font"
        self._attr_options = _FONT_OPTIONS
        self._attr_current_option = _FONT_LABELS.get(
            getattr(light_entity, '_font', 'basic'), "Basic"
        )

    @property
    def current_option(self) -> str | None:
        key = getattr(self._light_entity, '_font', 'basic')
        return _FONT_LABELS.get(key, "Basic")

    async def async_select_option(self, option: str) -> None:
        font_key = _LABEL_TO_KEY.get(option)
        if not font_key:
            _LOGGER.error("[FONT SELECT] Unknown font label: '%s'", option)
            return

        _LOGGER.debug("[FONT SELECT] User selected: '%s' (key=%s) for %s", option, font_key, self._light_entity._ip)

        if not self._light_entity._is_on and not self._light_entity._should_auto_turn_on():
            _LOGGER.debug("[FONT SELECT] Lamp is off and auto-turn-on is disabled, ignoring")
            return

        await self._light_entity.set_font(font_key)

        self._attr_current_option = option
        if self.hass is not None:
            self.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        """Sync the dropdown with the light entity's current font."""
        key = getattr(self._light_entity, '_font', 'basic')
        self._attr_current_option = _FONT_LABELS.get(key, "Basic")
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._font_select_entity = self
        _LOGGER.debug(
            "[FONT SELECT] Registered for %s, "
            "current font=%s",
            self._light_entity._ip, self._light_entity._font
        )


# ── Transition selector ───────────────────────────────────────────────
_TRANSITION_OPTIONS = list(TRANSITION_TYPES.values())
_TRANSITION_LABEL_TO_KEY = {v: k for k, v in TRANSITION_TYPES.items()}


class YeelightCubeTransitionSelect(CubeControlEntity, SelectEntity):
    """Select entity for choosing the display transition effect on the Yeelight Cube Lite."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Matrix: Transition Effect"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_transition_select"
        self._attr_icon = "mdi:animation-play"
        self._attr_options = _TRANSITION_OPTIONS
        self._attr_entity_category = EntityCategory.CONFIG
        self._attr_current_option = TRANSITION_TYPES.get(
            getattr(light_entity, '_transition_type', 'none'), "None"
        )

    @property
    def current_option(self) -> str | None:
        key = getattr(self._light_entity, '_transition_type', 'none')
        return TRANSITION_TYPES.get(key, "None")

    async def async_select_option(self, option: str) -> None:
        key = _TRANSITION_LABEL_TO_KEY.get(option)
        if key is None:
            _LOGGER.error("[TRANSITION SELECT] Unknown option: '%s'", option)
            return

        _LOGGER.debug(
            "[TRANSITION SELECT] User selected: '%s' (key=%s) "
            "for %s",
            option, key, self._light_entity._ip
        )

        self._light_entity._transition_type = key

        self._attr_current_option = option
        if self.hass is not None:
            self.async_write_ha_state()
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        """Sync the dropdown with the light entity's current transition type."""
        key = getattr(self._light_entity, '_transition_type', 'none')
        self._attr_current_option = TRANSITION_TYPES.get(key, "None")
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._transition_select_entity = self
        _LOGGER.debug(
            "[TRANSITION SELECT] Registered for %s, "
            "current type=%s",
            self._light_entity._ip, self._light_entity._transition_type
        )
