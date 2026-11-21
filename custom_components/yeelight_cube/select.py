"""Select platform for Yeelight Cube Lite: the lamp's dropdowns (palette,
pixel art, content and display modes, clock, native effects and settings)."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from homeassistant.components.select import SelectEntity # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.core import HomeAssistant, callback # type: ignore
from homeassistant.helpers.entity import EntityCategory  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore

from .errors import invalid
from .pixel_art_storage import pixel_art_width
from .light_matrix import MatrixSettingUnavailable
from .const import (
    CONF_IP,
    CONTENT_MODES,
    DOMAIN,
    MATRIX_DISPLAY_MODES,
    DEFAULT_POWER_ON_STATE,
    POWER_ON_STATES,
)
from .effect_catalog import (
    ALL_NATIVE_EFFECTS,
    DEFAULT_MUSIC_FLOW_EFFECT,
    DEFAULT_NATIVE_CLOCK_CONTENT,
    canonical_clock_style_name,
    canonical_effect_name,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_CONTENT_LABELS,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTIONS,
    ANIMATION_LAYOUTS,
    DEFAULT_ANIMATION_LAYOUT,
)
from .runtime_data import lamp_of
from .entity import CubeControlEntity, remove_retired_entities
from .builtin_pixel_art import find_pixel_art, get_builtin_pixel_art_map
from .layout import FONT_MAPS
from .lamp_renderers import LAMP_MUSIC_EFFECTS

_LOGGER = logging.getLogger(__name__)

# No limit per platform: every command to the lamp already waits for the
# previous one (the device lock, light_connection._execute_hardware_op).
PARALLEL_UPDATES = 0


class CubeSelect(CubeControlEntity, SelectEntity):
    """A dropdown of one lamp. It listens to the light's ``_topic`` (light_state):
    every change made elsewhere comes through async_update_from_light, so it never
    polls. Named by its translation key, after the lamp's name."""

    _attr_should_poll = False
    _topic = None

    def __init__(self, light_entity, config_entry: ConfigEntry, unique_suffix: str, translation_key: str | None = None):
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_unique_id = f"{light_entity.unique_id}_{unique_suffix}"
        if translation_key:
            self._attr_translation_key = translation_key

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
        if self._topic:
            self._listen_to_light(self._topic)
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
    attr: str
    labels: dict
    default: str
    setter: str | None
    topic: str
    translation_key: str | None = None
    category: EntityCategory | None = None


# Settings only a Cube Lite has (device_profile): its microphone's Music
# Flow and its power-on behaviour (set_ps), the layout of its stored GIF.
CUBE_LITE_ONLY_SELECTS = frozenset({"music_flow_effect", "power_on_state", "animation_layout"})

SETTING_SELECTS = (
    SettingSelect(
        "clock_content_select", "_native_clock_content",
        {key: NATIVE_CLOCK_CONTENT_LABELS[key] for key in NATIVE_CLOCK_CONTENT_OPTIONS},
        DEFAULT_NATIVE_CLOCK_CONTENT, "async_set_native_clock_content",
        "clock_content", translation_key="clock_content",
    ),
    SettingSelect(
        "music_flow_effect", "_music_flow_effect",
        {effect: effect for effect in MUSIC_FLOW_EFFECTS},
        DEFAULT_MUSIC_FLOW_EFFECT, "async_set_music_flow_effect",
        "music_flow_effect", translation_key="music_flow_effect",
    ),
    SettingSelect(
        "power_on_state", "_power_on_state",
        {state: state for state in POWER_ON_STATES}, DEFAULT_POWER_ON_STATE,
        "async_set_power_on_state", "power_on_state",
        translation_key="power_on_state", category=EntityCategory.CONFIG,
    ),
    SettingSelect(
        "alignment_select", "_alignment",
        {"left": "left", "center": "center", "right": "right"}, "center",
        "set_alignment", "alignment", translation_key="text_alignment",
    ),
    SettingSelect(
        "font_select", "_font",
        {key: key.capitalize() for key in FONT_MAPS}, "basic",
        "set_font", "font", translation_key="font",
    ),
    # How the four animations are laid out in the GIF the lamp stores:
    # upright, or as the Yeelight app sends its own (effect_catalog.ANIMATION_LAYOUTS).
    SettingSelect(
        "animation_layout", "_animation_layout", dict(ANIMATION_LAYOUTS),
        DEFAULT_ANIMATION_LAYOUT, "async_set_animation_layout",
        "animation_layout", translation_key="animation_layout",
        category=EntityCategory.CONFIG,
    ),
    # The 4-way physical mount (the official app's picker and the lamp
    # preview card's rotation); it replaced the "Flip Orientation" switch.
    SettingSelect(
        "device_orientation_select", "_device_orientation",
        {"right": "Right", "down": "Down", "left": "Left", "up": "Up"}, "right",
        "set_device_orientation", "device_orientation",
        translation_key="device_orientation",
    ),
)


class CubeSettingSelect(CubeSelect):
    """A dropdown of one lamp setting (SETTING_SELECTS)."""

    def __init__(self, light_entity, config_entry: ConfigEntry, spec: SettingSelect):
        super().__init__(light_entity, config_entry, spec.unique_suffix, spec.translation_key)
        self._spec = spec
        self._topic = spec.topic
        self._attr_options = list(spec.labels.values())
        self._values = {label: value for value, label in spec.labels.items()}
        if spec.category:
            self._attr_entity_category = spec.category

    @property
    def current_option(self) -> str:
        spec = self._spec
        value = self._light_entity.setting(spec.attr, spec.default)
        return spec.labels.get(value, spec.labels[spec.default])

    async def async_select_option(self, option: str) -> None:
        value = self._values.get(option)
        if value is None:
            raise ValueError(f"Unknown option: {option}")
        if self._spec.setter:
            await getattr(self._light_entity, self._spec.setter)(value)
        else:
            self._light_entity.set_setting(self._spec.attr, value)
        self._write_states()


class MatrixSettingSelect(CubeSettingSelect):
    """A Cube Matrix setting over Matter: refused with a translated error
    when its Matter link is not there."""

    async def async_select_option(self, option: str) -> None:
        try:
            await super().async_select_option(option)
        except MatrixSettingUnavailable as err:
            raise invalid(str(err)) from err


# A Cube Matrix's own settings (light_matrix): its power-on behaviour
# (Matter StartUpOnOff).
MATRIX_SELECTS = (
    SettingSelect(
        "matrix_power_on", "_matrix_power_on", {"on": "Always on", "off": "Always off"}, "on",
        "async_set_matrix_power_on", "matrix_power_on",
        translation_key="power_on_state", category=EntityCategory.CONFIG,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> bool:
    """Set up Yeelight Cube Lite select entities from a config entry."""
    # Prime the read-only app gallery outside Home Assistant's event loop.
    await hass.async_add_executor_job(get_builtin_pixel_art_map)

    ip = entry.data[CONF_IP]

    # Get the light entity that was set up earlier
    light_entity = lamp_of(entry)
    if light_entity is None:
        return False

    # Retired selects: the matrix transition effect of an earlier version, and
    # a Cube Matrix's drawing animation (drawings are always still).
    remove_retired_entities(hass, "select", [
        f"{light_entity.unique_id}_{suffix}" for suffix in ("transition_select", "drawing_animation")
    ])
    if not light_entity.device_profile.native_effects:
        # A Cube Matrix entry made before models were told apart had them.
        remove_retired_entities(hass, "select", [
            f"{light_entity.unique_id}_{suffix}" for suffix in sorted(CUBE_LITE_ONLY_SELECTS)
        ])
    async_add_entities([
        YeelightCubePaletteSelect(light_entity, ip, entry, hass),
        YeelightCubePixelArtSelect(light_entity, ip, entry, hass),
        YeelightCubeContentModeSelect(light_entity, entry),
        YeelightCubeDisplayModeSelect(light_entity, entry),
        YeelightCubeClockStyleSelect(light_entity, entry),
        YeelightCubeNativeEffectSelect(light_entity, entry),
        YeelightCubeNativeEffectDirectionSelect(light_entity, entry),
        *(
            CubeSettingSelect(light_entity, entry, spec) for spec in SETTING_SELECTS
            if light_entity.device_profile.native_effects
            or spec.unique_suffix not in CUBE_LITE_ONLY_SELECTS
        ),
        *(
            MatrixSettingSelect(light_entity, entry, spec) for spec in MATRIX_SELECTS
            if light_entity.is_cube_matrix
        ),
    ])

    return True


class YeelightCubePaletteSelect(CubeSelect):
    """Select entity for choosing a palette to apply to the Yeelight Cube Lite."""

    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the palette selector entity."""
        super().__init__(light_entity, config_entry, "palette_select", "palette")
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

        # The palette's colors for the text modes (the drawing is left).
        await self._light_entity.async_apply_palette_colors(palette["colors"])
        _LOGGER.debug("[PALETTE SELECT] Applied %s colors to light entity", len(palette['colors']))

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

    _topic = "pixel_art"

    def __init__(self, light_entity, ip: str, config_entry: ConfigEntry, hass: HomeAssistant):
        """Initialize the pixel art selector entity."""
        super().__init__(light_entity, config_entry, "pixel_art_select", "pixel_art")
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
        await self._light_entity.show_pixel_art(option, art["pixels"], width=pixel_art_width(art))
        _LOGGER.debug("[PIXEL ART SELECT] Applied pixel art '%s' to %s", option, self._ip)

    @callback
    def async_update_from_light(self):
        """Called by external code (light entity, text entity, palette select) to sync the dropdown.

        Reads _active_pixel_art_name from the light entity.
        If the light is displaying a named pixel art that's in our options, select it.
        Otherwise, clear the selection.
        """
        light = self._light_entity
        name = light.active_pixel_art_name
        is_active = light.mode == "Custom Draw" and light.custom_draw_active
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

    _attr_translation_key = "content_mode"
    _topic = "content_mode"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "content_mode_select")
        self._attr_options = list(CONTENT_MODES)

    @property
    def current_option(self) -> str | None:
        return self._light_entity.content_mode

    async def async_select_option(self, option: str) -> None:
        if option not in CONTENT_MODES:
            _LOGGER.error("[CONTENT MODE] Invalid mode: %s", option)
            return
        await self._light_entity.async_select_content_mode(option)


class YeelightCubeDisplayModeSelect(CubeSelect):
    """Select the render mode used by Matrix content."""

    _topic = "display_mode"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        """Initialize the display mode selector entity."""
        super().__init__(
            light_entity, config_entry, "display_mode_select", "display_mode",
        )
        self._attr_options = list(MATRIX_DISPLAY_MODES)

    @property
    def current_option(self) -> str | None:
        """Return the current or last-used Matrix render mode."""
        light = self._light_entity
        return light.mode if light.mode in MATRIX_DISPLAY_MODES else light.matrix_mode

    async def async_select_option(self, option: str) -> None:
        """Handle display mode selection — apply the chosen mode to the lamp."""
        _LOGGER.debug("[MODE SELECT] User selected: '%s' for %s", option, self._light_entity.ip)

        if option not in MATRIX_DISPLAY_MODES:
            _LOGGER.error("[MODE SELECT] Invalid mode: '%s'", option)
            return
        await self._light_entity.async_select_display_mode(option)
        self._write_states()

    @callback
    def async_update_from_light(self):
        """Called by external code to sync the dropdown with the light entity's
        mode (and remember the last Matrix render mode)."""
        self._light_entity.remember_matrix_mode()
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
    """Select a built-in clock face."""

    _attr_translation_key = "clock_style"
    _topic = "clock_style"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "clock_style_select")

    @property
    def options(self) -> list[str]:
        # Every style, sorted by mixer (the background mode).
        style_ids = sorted(
            NATIVE_CLOCK_STYLES,
            key=lambda style_id: NATIVE_CLOCK_STYLES[style_id]["mixer"],
        )
        current = self._light_entity.native_clock_style
        if current not in style_ids:
            style_ids.append(current)
        return [_clock_style_label(style_id) for style_id in style_ids]

    @property
    def current_option(self) -> str | None:
        return _clock_style_label(self._light_entity.native_clock_style)

    def _valid_option_or_raise(self, option: str) -> None:
        # Home Assistant checks the option against the list before
        # async_select_option: a former name is checked as today's.
        check = getattr(super(), "_valid_option_or_raise", None)
        if check is not None:
            check(canonical_clock_style_name(option))

    async def async_select_option(self, option: str) -> None:
        # A former name (e.g. "Blue White") is today's.
        option = canonical_clock_style_name(option)
        style_id = _CLOCK_STYLE_TO_ID.get(option)
        if style_id is None:
            _LOGGER.error("[CLOCK STYLE] Unknown option: '%s'", option)
            return

        await self._light_entity.async_select_clock_style(style_id)
        self._write_states()


class YeelightCubeNativeEffectSelect(CubeSelect):
    """Select one of the built-in Cube Lite animations."""

    _attr_translation_key = "native_effect"
    _topic = "native_effect"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "native_effect")

    @property
    def options(self) -> list:
        # Every effect, sorted by built-in mode number. The animations to
        # upload only while a server delivers the Yeelight commands; not the
        # stored GIF (hidden: the animations are chosen instead). The current
        # effect is always kept so HA never warns about an out-of-list value.
        animations = getattr(self._light_entity, "animations_available", False)
        # A lamp without a microphone (Cube Matrix) is not offered the
        # effects that listen to one.
        hearing = getattr(self._light_entity, "device_profile", None)
        hearing = hearing is None or hearing.microphone
        names = sorted(
            (name for name, spec in ALL_NATIVE_EFFECTS.items()
             if not spec.get("hidden") and (animations or not spec.get("animation"))
             and (hearing or name not in LAMP_MUSIC_EFFECTS)),
            key=lambda name: ALL_NATIVE_EFFECTS[name]["mode"],
        )
        current = self._light_entity.native_effect
        if current not in names:
            names.append(current)
        return names

    @property
    def current_option(self) -> str:
        return self._light_entity.native_effect

    def _valid_option_or_raise(self, option: str) -> None:
        # Home Assistant checks the option against the list before
        # async_select_option: a former name is checked as today's. A hidden
        # effect (the stored GIF) is not listed but still taken by name.
        option = canonical_effect_name(option)
        if ALL_NATIVE_EFFECTS.get(option, {}).get("hidden"):
            return
        check = getattr(super(), "_valid_option_or_raise", None)
        if check is not None:
            check(option)

    async def async_select_option(self, option: str) -> None:
        # A former name (e.g. "Ocean Waves") is today's.
        option = canonical_effect_name(option)
        if option not in ALL_NATIVE_EFFECTS:
            raise ValueError(f"Unknown native effect: {option}")
        if ALL_NATIVE_EFFECTS[option].get("animation") and not getattr(
            self._light_entity, "animations_available", False
        ):
            raise invalid("animation_needs_matter")
        await self._light_entity.async_select_native_effect(option)
        self._write_states()


class YeelightCubeNativeEffectDirectionSelect(CubeSelect):
    """Select the direction used by directional native animations."""

    _attr_translation_key = "native_effect_direction"
    _attr_entity_category = EntityCategory.CONFIG
    _topic = "native_effect_direction"

    def __init__(self, light_entity, config_entry: ConfigEntry):
        super().__init__(light_entity, config_entry, "native_effect_direction")
        self._attr_options = list(NATIVE_EFFECT_DIRECTIONS)

    @property
    def available(self) -> bool:
        spec = ALL_NATIVE_EFFECTS[self._light_entity.native_effect]
        return self._light_entity.available and bool(spec.get("directions"))

    @property
    def current_option(self) -> str:
        directions = ALL_NATIVE_EFFECTS[self._light_entity.native_effect].get(
            "directions", NATIVE_EFFECT_DIRECTIONS
        )
        current = self._light_entity.native_effect_direction
        return current if current in directions else directions[0]

    async def async_select_option(self, option: str) -> None:
        if option not in NATIVE_EFFECT_DIRECTIONS:
            raise ValueError(f"Unknown native effect direction: {option}")
        await self._light_entity.async_select_native_effect_direction(option)
        self._write_states()

    @callback
    def async_update_from_light(self):
        directions = ALL_NATIVE_EFFECTS[self._light_entity.native_effect].get(
            "directions", NATIVE_EFFECT_DIRECTIONS
        )
        self._attr_options = list(directions)
        if self.hass is not None:
            self.async_write_ha_state()
