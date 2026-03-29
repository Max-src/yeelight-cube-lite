"""Select platform for Yeelight Cube - provides dropdown controls for palette and pixel art selection."""

import logging
from homeassistant.components.select import SelectEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .const import DOMAIN, CONF_IP
from .layout import FONT_MAPS

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube select entities from a config entry."""
    
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
    mode_select = YeelightCubeDisplayModeSelect(light_entity, entry)
    alignment_select = YeelightCubeAlignmentSelect(light_entity, entry)
    font_select = YeelightCubeFontSelect(light_entity, entry)
    transition_select = YeelightCubeTransitionSelect(light_entity, entry)
    async_add_entities([palette_select, pixel_art_select, mode_select, alignment_select, font_select, transition_select])
    
    return True


class YeelightCubePaletteSelect(SelectEntity):
    """Select entity for choosing a palette to apply to the Yeelight Cube."""
    
    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the palette selector entity."""
        self._light_entity = light_entity
        self._ip = ip
        self._config_entry = config_entry
        self._hass = hass
        self._attr_name = f"{light_entity._attr_name} Palette"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_palette_select"
        self._attr_icon = "mdi:palette"
        self._attr_current_option = None
        
        # Initialize options from current palettes
        self._update_options()
    
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
        """Return if entity is available."""
        return True
    
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
        _LOGGER.debug(f"[PALETTE SELECT] Updated options: {len(palette_names)} palettes")
    
    async def async_select_option(self, option: str) -> None:
        """Handle palette selection."""
        _LOGGER.debug(f"[PALETTE SELECT] User selected: '{option}' for entity {self.entity_id}")
        
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
            _LOGGER.error(f"[PALETTE SELECT] Palette '{option}' not found in storage")
            return
        
        # Apply the palette to the light entity
        palette = palettes[palette_idx]
        if "colors" not in palette or not isinstance(palette["colors"], list):
            _LOGGER.error(f"[PALETTE SELECT] Invalid palette format")
            return
        
        # Set the palette colors as the active color list for gradients/text modes
        self._light_entity._text_colors = palette["colors"]
        _LOGGER.debug(f"[PALETTE SELECT] Applied {len(palette['colors'])} colors to light entity")
        
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
        
        # If the current mode uses colors, apply the changes to the lamp
        if self._light_entity._mode == "Panel Color Sequence":
            colors = palette["colors"]
            for i, module in enumerate(self._light_entity._layout.device_layout):
                color = colors[i % len(colors)]
                hex_color = '#%02x%02x%02x' % tuple(color)
                module.set_colors([hex_color])
            await self._light_entity.apply()
            _LOGGER.debug(f"[PALETTE SELECT] Applied palette to Panel Color Sequence mode")
        else:
            # For other modes, just update the display
            await self._light_entity.async_apply_display_mode()
        
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
            _LOGGER.debug(f"[PALETTE SELECT] Options updated: {len(old_options)} -> {len(self._attr_options)}")
            
            # If current selection is no longer valid, clear it
            if self._attr_current_option and self._attr_current_option not in self._attr_options:
                self._attr_current_option = None
                _LOGGER.debug(f"[PALETTE SELECT] Cleared invalid selection")
            
            if self.hass is not None:
                self.async_write_ha_state()
    
    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()
        
        # Listen for palette update events
        self.hass.bus.async_listen(f"{DOMAIN}_palettes_updated", self._handle_palette_update)
        _LOGGER.debug(f"[PALETTE SELECT] Registered for palette update events")
    
    async def _handle_palette_update(self, event):
        """Handle palette update events."""
        _LOGGER.debug(f"[PALETTE SELECT] Received palette update event")
        self.async_update_from_palette_sensor()


class YeelightCubePixelArtSelect(SelectEntity):
    """Select entity for choosing a saved pixel art to display on the Yeelight Cube."""

    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the pixel art selector entity."""
        self._light_entity = light_entity
        self._ip = ip
        self._config_entry = config_entry
        self._hass = hass
        self._attr_name = f"{light_entity._attr_name} Pixel Art"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_pixel_art_select"
        self._attr_icon = "mdi:image"
        self._attr_current_option = None

        # Initialize options from current pixel arts
        self._update_options()

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
        """Return if entity is available."""
        return True

    @property
    def options(self) -> list[str]:
        """Return the list of available pixel art names."""
        return self._attr_options

    @property
    def current_option(self) -> str | None:
        """Return the currently selected pixel art (None if none selected)."""
        return self._attr_current_option

    def _update_options(self):
        """Update the options list from pixel art storage."""
        if DOMAIN not in self._hass.data:
            self._attr_options = ["No pixel arts available"]
            return

        pixel_arts = self._hass.data[DOMAIN].get("pixel_arts", [])

        if not pixel_arts:
            self._attr_options = ["No pixel arts available"]
            return

        art_names = []
        for idx, art in enumerate(pixel_arts):
            name = art.get("name", f"Pixel Art {idx + 1}")
            art_names.append(name)

        self._attr_options = art_names
        _LOGGER.debug(f"[PIXEL ART SELECT] Updated options: {len(art_names)} pixel arts")

    async def async_select_option(self, option: str) -> None:
        """Handle pixel art selection — apply the chosen pixel art to the lamp."""
        _LOGGER.debug(f"[PIXEL ART SELECT] User selected: '{option}' for entity {self.entity_id}")

        if DOMAIN not in self._hass.data:
            _LOGGER.error("[PIXEL ART SELECT] No pixel art data in hass.data")
            return

        pixel_arts = self._hass.data[DOMAIN].get("pixel_arts", [])

        if option == "No pixel arts available":
            _LOGGER.warning("[PIXEL ART SELECT] No pixel arts to apply")
            return

        # Find the pixel art by name
        art_idx = None
        for idx, art in enumerate(pixel_arts):
            if art.get("name", f"Pixel Art {idx + 1}") == option:
                art_idx = idx
                break

        if art_idx is None:
            _LOGGER.error(f"[PIXEL ART SELECT] Pixel art '{option}' not found in storage")
            return

        art = pixel_arts[art_idx]
        if "pixels" not in art or not isinstance(art["pixels"], list) or len(art["pixels"]) == 0:
            _LOGGER.error(f"[PIXEL ART SELECT] Invalid pixel art format for '{option}'")
            return

        # Check auto-turn-on setting
        if not self._light_entity._is_on and not self._light_entity._should_auto_turn_on():
            _LOGGER.debug("[PIXEL ART SELECT] Lamp is off and auto-turn-on is disabled, ignoring")
            return

        # Apply pixel art to the light entity (same logic as handle_apply_pixel_art)
        self._light_entity._custom_pixels = art["pixels"]
        self._light_entity._custom_draw_active = True
        self._light_entity._active_pixel_art_name = option
        # Stop scroll timer — pixel art mode doesn't scroll
        self._light_entity.stop_scroll_timer()
        self._light_entity._is_scrolling = False

        # Clear palette selection since we're switching to pixel art mode
        if hasattr(self._light_entity, '_palette_select_entity') and self._light_entity._palette_select_entity:
            pass  # Palette entity doesn't need clearing — it just keeps its last selection

        await self._light_entity.async_apply_display_mode(update_type='pixel_art')
        _LOGGER.debug(f"[PIXEL ART SELECT] Applied pixel art '{option}' to {self._ip}")

        # Update the current selection
        self._attr_current_option = option

        # Notify Home Assistant of the state change
        if self.hass is not None:
            self.async_write_ha_state()

        # Also trigger light entity state update
        if self._light_entity.hass is not None:
            self._light_entity.async_write_ha_state()

    @callback
    def async_update_from_light(self):
        """Called by external code (light entity, text entity, palette select) to sync the dropdown.

        Reads _active_pixel_art_name from the light entity.
        If the light is displaying a named pixel art that's in our options, select it.
        Otherwise, clear the selection.
        """
        name = getattr(self._light_entity, '_active_pixel_art_name', None)
        if name and name in self._attr_options:
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
            _LOGGER.debug(f"[PIXEL ART SELECT] Options updated: {len(old_options)} -> {len(self._attr_options)}")

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

        # Listen for pixel art update events
        self.hass.bus.async_listen(f"{DOMAIN}_pixel_arts_updated", self._handle_pixel_arts_update)
        _LOGGER.debug(f"[PIXEL ART SELECT] Registered for pixel art update events, linked to {self._ip}")

        # Sync initial state from light entity
        self.async_update_from_light()

    async def _handle_pixel_arts_update(self, event):
        """Handle pixel art update events (fired when arts are saved/deleted/imported)."""
        _LOGGER.debug(f"[PIXEL ART SELECT] Received pixel arts update event")
        self.async_update_from_pixel_art_sensor()


# --- Valid display mode values (must match light.py handle_set_mode) ---
DISPLAY_MODES = [
    "Solid Color",
    "Letter Gradient",
    "Column Gradient",
    "Row Gradient",
    "Angle Gradient",
    "Radial Gradient",
    "Letter Vertical Gradient",
    "Letter Angle Gradient",
    "Text Color Sequence",
    "Panel Color Sequence",
    "Custom Draw",
]

ALIGNMENT_OPTIONS = ["left", "center", "right"]


class YeelightCubeDisplayModeSelect(SelectEntity):
    """Select entity for choosing the display mode on the Yeelight Cube."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the display mode selector entity."""
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Display Mode"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_display_mode_select"
        self._attr_icon = "mdi:view-dashboard-variant"
        self._attr_options = DISPLAY_MODES
        self._attr_current_option = getattr(light_entity, '_mode', 'Solid Color')

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
    def options(self) -> list[str]:
        return self._attr_options

    @property
    def current_option(self) -> str | None:
        """Return the current mode from the light entity."""
        # If custom draw is active, report "Custom Draw"
        if getattr(self._light_entity, '_custom_draw_active', False):
            return "Custom Draw"
        return getattr(self._light_entity, '_mode', 'Solid Color')

    async def async_select_option(self, option: str) -> None:
        """Handle display mode selection — apply the chosen mode to the lamp."""
        _LOGGER.debug(f"[MODE SELECT] User selected: '{option}' for {self._light_entity._ip}")

        if option not in DISPLAY_MODES:
            _LOGGER.error(f"[MODE SELECT] Invalid mode: '{option}'")
            return

        # Check auto-turn-on setting
        if not self._light_entity._is_on and not self._light_entity._should_auto_turn_on():
            _LOGGER.debug("[MODE SELECT] Lamp is off and auto-turn-on is disabled, ignoring")
            return

        if option == "Custom Draw":
            self._light_entity._custom_draw_active = True
        else:
            self._light_entity._mode = option
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

    @callback
    def async_update_from_light(self):
        """Called by external code to sync the dropdown with the light entity's mode."""
        if getattr(self._light_entity, '_custom_draw_active', False):
            self._attr_current_option = "Custom Draw"
        else:
            self._attr_current_option = getattr(self._light_entity, '_mode', 'Solid Color')
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        """Run when entity is added to hass."""
        await super().async_added_to_hass()
        self._light_entity._mode_select_entity = self
        _LOGGER.debug(f"[MODE SELECT] Registered for {self._light_entity._ip}, current mode={self._light_entity._mode}")


class YeelightCubeAlignmentSelect(SelectEntity):
    """Select entity for choosing text alignment (left/center/right) on the Yeelight Cube."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the text alignment selector entity."""
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Text Alignment"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_alignment_select"
        self._attr_icon = "mdi:format-align-center"
        self._attr_options = ALIGNMENT_OPTIONS
        self._attr_current_option = getattr(light_entity, '_alignment', 'center')

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
    def options(self) -> list[str]:
        return self._attr_options

    @property
    def current_option(self) -> str | None:
        """Return the current alignment from the light entity."""
        return getattr(self._light_entity, '_alignment', 'center')

    async def async_select_option(self, option: str) -> None:
        """Handle alignment selection — apply to the lamp."""
        _LOGGER.debug(f"[ALIGNMENT SELECT] User selected: '{option}' for {self._light_entity._ip}")

        if option not in ALIGNMENT_OPTIONS:
            _LOGGER.error(f"[ALIGNMENT SELECT] Invalid alignment: '{option}'")
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
        _LOGGER.debug(f"[ALIGNMENT SELECT] Registered for {self._light_entity._ip}, current alignment={self._light_entity._alignment}")


# ── Font selector ──────────────────────────────────────────────────────
# Display-friendly labels for each font key
_FONT_LABELS = {k: k.capitalize() for k in FONT_MAPS}   # basic→Basic, fat→Fat, …
_FONT_OPTIONS = list(_FONT_LABELS.values())               # ["Basic", "Fat", "Italic"]
_LABEL_TO_KEY = {v: k for k, v in _FONT_LABELS.items()}   # reverse lookup


class YeelightCubeFontSelect(SelectEntity):
    """Select entity for choosing the matrix font on the Yeelight Cube."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Font"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_font_select"
        self._attr_icon = "mdi:format-font"
        self._attr_options = _FONT_OPTIONS
        self._attr_current_option = _FONT_LABELS.get(
            getattr(light_entity, '_font', 'basic'), "Basic"
        )

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
    def current_option(self) -> str | None:
        key = getattr(self._light_entity, '_font', 'basic')
        return _FONT_LABELS.get(key, "Basic")

    async def async_select_option(self, option: str) -> None:
        font_key = _LABEL_TO_KEY.get(option)
        if not font_key:
            _LOGGER.error(f"[FONT SELECT] Unknown font label: '{option}'")
            return

        _LOGGER.debug(f"[FONT SELECT] User selected: '{option}' (key={font_key}) for {self._light_entity._ip}")

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
            f"[FONT SELECT] Registered for {self._light_entity._ip}, "
            f"current font={self._light_entity._font}"
        )


# ── Transition selector ───────────────────────────────────────────────
_TRANSITION_TYPES = {
    "none": "None",
    "fade_through_black": "Fade Through Black",
    "direct_crossfade": "Direct Crossfade",
    "random_dissolve": "Random Dissolve",
    "wipe_right": "Wipe Right",
    "wipe_left": "Wipe Left",
    "wipe_down": "Wipe Down",
    "wipe_up": "Wipe Up",
    "slide_left": "Slide Left",
    "slide_right": "Slide Right",
    "slide_up": "Slide Up",
    "slide_down": "Slide Down",
    "card_from_right": "Card From Right",
    "card_from_left": "Card From Left",
    "card_from_top": "Card From Top",
    "card_from_bottom": "Card From Bottom",
    "explode_reform": "Explode & Reform",
    "snake": "Snake",
    "wave_wipe": "Wave Wipe",
    "iris": "Iris (Circle Wipe)",
    "vertical_flip": "Vertical Flip",
    "curtain": "Curtain",
    "gravity_drop": "Gravity Drop",
    "pixel_migration": "Pixel Migration",
}
_TRANSITION_OPTIONS = list(_TRANSITION_TYPES.values())
_TRANSITION_LABEL_TO_KEY = {v: k for k, v in _TRANSITION_TYPES.items()}


class YeelightCubeTransitionSelect(SelectEntity):
    """Select entity for choosing the display transition effect on the Yeelight Cube."""

    def __init__(self, light_entity, config_entry: ConfigEntry):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Transition Effect"
        self._attr_unique_id = f"{light_entity._attr_unique_id}_transition_select"
        self._attr_icon = "mdi:animation-play"
        self._attr_options = _TRANSITION_OPTIONS
        self._attr_entity_category = EntityCategory.CONFIG
        self._attr_current_option = _TRANSITION_TYPES.get(
            getattr(light_entity, '_transition_type', 'none'), "None"
        )

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
    def current_option(self) -> str | None:
        key = getattr(self._light_entity, '_transition_type', 'none')
        return _TRANSITION_TYPES.get(key, "None")

    async def async_select_option(self, option: str) -> None:
        key = _TRANSITION_LABEL_TO_KEY.get(option)
        if key is None:
            _LOGGER.error(f"[TRANSITION SELECT] Unknown option: '{option}'")
            return

        _LOGGER.debug(
            f"[TRANSITION SELECT] User selected: '{option}' (key={key}) "
            f"for {self._light_entity._ip}"
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
        self._attr_current_option = _TRANSITION_TYPES.get(key, "None")
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self._light_entity._transition_select_entity = self
        _LOGGER.debug(
            f"[TRANSITION SELECT] Registered for {self._light_entity._ip}, "
            f"current type={self._light_entity._transition_type}"
        )