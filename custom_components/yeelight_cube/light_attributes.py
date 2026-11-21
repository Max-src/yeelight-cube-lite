"""What the light publishes to Home Assistant: its state's properties and attributes.

Owns AttributesMixin: the light entity's properties (is_on, brightness,
rgb_color, color modes, available, the text colours and text, the content
mode), the state attributes the cards read (extra_state_attributes: the settings
declared in light_restore.SETTINGS, the key of the native effect catalogue
the cards fetch, native_effect_catalog, and the matrix colours,
_published_matrix_colors), the settings saved apart for a restart
(extra_restore_state_data, _last_settings) and the layout colour helpers.
Used only as a mixin of :class:`YeelightCubeLight` (light.py).
"""
import hashlib
import json
import logging
import functools
from types import SimpleNamespace
from homeassistant.components.light import ColorMode # type: ignore
from .const import LAMP_MODES
from .effect_catalog import (
    DEFAULT_NATIVE_CLOCK_STYLE,
    ALL_NATIVE_EFFECTS,
    NATIVE_CLOCK_STYLES,
    effect_family,
)
from .color_utils import hex_to_rgb, rgb_to_hex
from .light_restore import SavedSettings, published_settings
from .matrix_effects import OWN_VERSIONS as MATRIX_OWN_VERSIONS, SPEEDLESS_MODES
from .lamp_renderers import LAMP_MUSIC_EFFECTS

_LOGGER = logging.getLogger(__name__)


@functools.lru_cache(maxsize=16)
def native_effect_catalog_key(*args) -> str:
    """A short key of _native_effect_catalog(*args): it changes whenever
    the catalogue does (the light publishes it, native_effect_catalog_key;
    the cards fetch the catalogue again when it changes)."""
    listed = json.dumps(_native_effect_catalog(*args), sort_keys=True)
    return hashlib.sha1(listed.encode("utf-8")).hexdigest()[:12]


@functools.lru_cache(maxsize=16)
def _native_effect_catalog(
    playing: str | None, animations: bool = False, hearing: bool = True, matrix: bool = False,
) -> list:
    """The native effects the cards list (11 KB; the websocket command
    yeelight_cube/native_effect_catalog, native_catalog_ws): built once per
    combination. Shared, never modified.
    Every effect is listed; ``extended`` only marks those the Yeelight app
    does not offer (the cards' badge; its music modes are offered). ``animations``: whether the animations
    to upload (LAMP_ANIMATION_EFFECTS) are offered, while a server delivers
    the Yeelight commands. A hidden effect (the stored GIF) is not listed. One
    that plays stays listed (``playing``). ``hearing``: False for a lamp
    without a microphone (Cube Matrix), not offered the effects that listen
    to one (as the effect select). ``matrix``: a Cube Matrix, whose
    effects in matrix_effects.SPEEDLESS_MODES take no speed."""
    return [
        {"name": name, "speed": bool(spec.get("speed")) and not (matrix and spec.get("mode") in SPEEDLESS_MODES),
         "intensity": bool(spec.get("intensity")),
         "directions": list(spec.get("directions", ())),
         "extended": bool(spec.get("extended")),
         "family": effect_family(spec),
         **({"animation": spec["animation"]} if spec.get("animation") else {}),
         "preview": True}
        for name, spec in ALL_NATIVE_EFFECTS.items()
        if name == playing
        or not (spec.get("hidden") or (spec.get("animation") and not animations)
                or (not hearing and name in LAMP_MUSIC_EFFECTS))
    ]



class AttributesMixin:
    """What the light publishes (light_attributes.py)."""

    @property
    def text_colors(self):
        return self._text_colors


    @property
    def supported_color_modes(self):
        if self.lamp_draws_matrix:
            return {ColorMode.BRIGHTNESS}
        return {ColorMode.RGB}

    @property
    def color_mode(self):
        # Current active color mode
        if self.lamp_draws_matrix:
            return ColorMode.BRIGHTNESS
        return ColorMode.RGB

    @property
    def brightness(self):
        # Home Assistant expects 1-255 for lights that are ON
        # We return None when OFF (standard HA behavior)
        # When ON, return stored brightness, ensuring it's at least 1
        if not self._is_on:
            return None
        # Ensure brightness is at least 1 (minimum valid brightness for ON lights)
        return max(1, self._brightness)

    @property
    def rgb_color(self):
        # Home Assistant expects RGB tuple for color picker
        # Always return the first text color to stay in sync with the actual lamp state
        if self._text_colors and len(self._text_colors) > 0:
            return self._text_colors[0]
        return self._rgb_color  # Fallback to stored rgb_color if no text colors


    @property
    def custom_text(self):
        return self._custom_text

    @property
    def content_mode(self):
        if self._music_flow_enabled:
            return "Music Flow"
        return self._mode if self._mode in LAMP_MODES else "Matrix"
    
    # The name is the device's (_lamp_name) and the unique id is set in __init__.

    @property
    def is_on(self):
        return self._is_on

    @property
    def available(self):
        return not self._lamp_client.is_unreachable

    @property
    def extra_restore_state_data(self) -> SavedSettings:
        """The settings, saved for a restart apart from the state: a lamp
        unreachable (stuck, switched off at the wall) is "unavailable", and
        Home Assistant then saves its state without attributes, so they would
        be lost (2026-11-14: both Cube Lites came back on Ribbon in default
        colours after a restart while they were stuck)."""
        return SavedSettings({
            **self.extra_state_attributes, "brightness": self._brightness, "is_on": self._is_on,
        })

    async def _last_settings(self):
        """The last state to restore the settings from: the saved state, or
        the settings saved apart (extra_restore_state_data) when it has none."""
        old_state = await self.async_get_last_state()
        extra = await self.async_get_last_extra_data()
        saved = extra.as_dict() if extra is not None else None
        if old_state is not None and "mode" in old_state.attributes:
            # A light that is off publishes no brightness: the one saved
            # apart, for when it is turned on.
            if old_state.attributes.get("brightness") is None and isinstance(saved, dict) \
                    and saved.get("brightness") is not None:
                return SimpleNamespace(state=old_state.state, attributes={
                    **old_state.attributes, "brightness": saved["brightness"],
                })
            return old_state
        if not isinstance(saved, dict) or "mode" not in saved:
            return old_state
        _LOGGER.info("[RESTORE] [%s] The lamp was unreachable at the restart: its saved settings are restored", self._ip)
        return SimpleNamespace(state=getattr(old_state, "state", None), attributes=saved)

    @property
    def extra_state_attributes(self):
        attrs = {
            # Internal component identifier - DO NOT MODIFY
            "_yeelight_cube_component": "yeelight-cube-component-v1.0",
            # Entity identification - useful for service calls and automations
            "light_entity_id": self.entity_id if hasattr(self, 'entity_id') else "not_yet_initialized",
            "ip_address": self._ip,
            # Display configuration
            "mode": self._mode,
            "content_mode": self.content_mode,
            "matrix_mode": self._matrix_mode,
            "custom_draw_active": self._custom_draw_active,
            # True while the panel is frozen (freeze_display); JS previews hold
            # the background animation on the frozen frame while the clock
            # digits keep updating.
            "display_frozen": bool(self._display_frozen),
            # Shared favourites per kind, e.g. {"clock": [{"name", "color_mode",
            # "color"}, ...]} (set_favourites). Rotation plays them in order.
            "favourites": {
                kind: [dict(item) for item in items]
                for kind, items in self._favourites.items()
            },
            # Shared rotation interval per kind (seconds), once set.
            "rotation_intervals": dict(self._rotation_intervals),
            # Server-side effect/clock rotation status (start/stop_effect_rotation).
            "effect_rotation": {
                "active": bool(self._rotation_active),
                "kind": self._rotation_kind,
                "interval": self._rotation_interval,
                "items": list(self._rotation_items),
                "index": self._rotation_index,
                "error": self._rotation_error,
                "waiting_for_reconnect": self._rotation_waiting_for_reconnect,
                "retry_attempt": self._rotation_retry_attempt,
                "retry_at": self._rotation_retry_at,
            },
            # {"service", "message", "at"} of the last change this lamp failed
            # to apply, until one succeeds (light_services_common
            # note_command_result); the cards name it.
            "last_command_error": self._last_command_error,
            "text_colors": self._text_colors,
            "clock_style": NATIVE_CLOCK_STYLES.get(
                self._native_clock_style,
                NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
            )["name"],
            "clock_content": self._native_clock_content,
            "effect_direction_own": True,
            # A Cube Matrix: the effects it draws its own way (matrix_effects).
            **({"matrix_own_versions": dict(MATRIX_OWN_VERSIONS)} if self.is_cube_matrix else {}),
            # A Cube Matrix's modules from its base (device_profile.layout,
            # every one, up to TOPOLOGY_SLOTS): blocks with the frame's first
            # column each shows, spots with the 5 columns whose colour they
            # show; and how many columns it shows (more than 20 for one of 5
            # to 8 modules: the cards draw max(20, matrix_columns) columns,
            # matrix_colors that wide). The lamp preview card draws them. matrix_module_list: every module
            # by name, as set_matrix_modules takes it (the Modules card).
            **({"matrix_modules": self.device_profile.layout,
                "matrix_module_list": self.device_profile.module_names,
                "matrix_columns": self.device_profile.columns} if self.is_cube_matrix else {}),
            # The native effect catalogue's key: the cards fetch the
            # catalogue (yeelight_cube/native_effect_catalog) when it changes.
            "native_effect_catalog_key": native_effect_catalog_key(*self._native_effect_catalog_args()),
            # How commands reach the lamp: "udp" (its UDP session) or "tcp".
            "connection": self._lamp_client.transport,
            "orientation": self._orientation,
            "device_orientation": self._device_orientation,
            # The lamp's Matter node and what it reports (light_matter.py);
            # None without one.
            "matter": self._matrix_published_summary(self._matter_summary()),
            # The lamp shows a button's or another app's content (Matter,
            # light_matter._accept_external_display): kept across a restart.
            "external_display": self._external_display,
            # The lamp's saved mount profile (light_mount_profile.py): 0-3 or
            # None, and its source ("matter", "user", "unknown").
            "mount_profile": self._mount_profile_summary(),
            "rgb_color": self._rgb_color,
            # The settings kept across a restart (light_restore.SETTINGS):
            # text, clock, native effect, colour adjustments, scroll, power
            # limit, a Cube Lite's stream frame rate...
            **published_settings(self),
        }
        attrs["matrix_colors"] = self._published_matrix_colors()
        return attrs

    def _native_effect_catalog_args(self) -> tuple:
        """What this light's native effect catalogue depends on
        (_native_effect_catalog's arguments)."""
        return (
            # An animation, or a hidden effect, still listed while it plays.
            self._native_effect
            if ALL_NATIVE_EFFECTS.get(self._native_effect, {}).get("animation")
            or ALL_NATIVE_EFFECTS.get(self._native_effect, {}).get("hidden")
            else None,
            self.animations_available,
            self.device_profile.microphone,
            self.is_cube_matrix,
        )

    def native_effect_catalog(self) -> dict:
        """The native effect catalogue the cards list and its key, as the
        websocket command yeelight_cube/native_effect_catalog answers."""
        args = self._native_effect_catalog_args()
        return {"key": native_effect_catalog_key(*args), "catalog": _native_effect_catalog(*args)}

    def _published_matrix_colors(self) -> list:
        """What the lamp shows right now, as RGB tuples in lamp order
        (matrix_colors): device_profile.pixels of them (100, or 5 a column of
        a Cube Matrix of more than 4 modules).

        Not simply the last frame the plugin drew: _base_matrix_colors is only
        refreshed when the plugin draws, so it still holds old content (e.g.
        the last pixel art) while the lamp is off or draws the
        matrix. The colors are not scaled by the brightness: the lamp dims in
        hardware, and the cards scale them by the published brightness
        themselves (set_brightness() writes the state first, so they preview
        a brightness drag at once, before the lamp round trip).
        _base_matrix_colors has the color effects but not the lamp-only
        stages (low-brightness correction, per-channel accuracy).
        """
        try:
            count = len(self._layout.device_layout)
            if not self._is_on:
                # Off: the matrix is dark, whatever content is kept for turn-on.
                return [(0, 0, 0)] * count
            if self.lamp_draws_matrix:
                # Frames the lamp draws itself cannot be read back: no pixels.
                # Cards and the preview camera render these modes themselves.
                return []
            base_colors = self._base_matrix_colors
            if base_colors and len(base_colors) == count:
                return list(base_colors)
            # Fallback: read directly from module data
            return self._layout_colors()
        except Exception:  # noqa: BLE001 -- attributes must always build
            return []

    @property
    def lamp_draws_matrix(self) -> bool:
        """Whether the lamp draws the matrix itself (clock, native effect,
        music flow) rather than the plugin, so its frames cannot be read back."""
        return bool(self._music_flow_enabled) or self._mode in LAMP_MODES

    @property
    def _has_color_effects(self) -> bool:
        """Whether any color adjustment (hue, saturation, tint, ...) is active."""
        return (
            self._preview_hue_shift != 0 or self._preview_saturation != 100 or
            self._preview_temperature != 0 or self._preview_contrast != 100 or
            self._preview_vibrance != 100 or self._preview_glow != 0 or
            self._preview_grayscale != 0 or self._preview_invert != 0 or
            self._preview_tint_strength != 0
        )

    def _layout_colors(self) -> list:
        """The layout's current pixel colors, one RGB tuple per module
        (black where a module holds no data). Every render sets each 1x1
        module to exactly one color. Raises ValueError or TypeError on a
        malformed color."""
        return [
            hex_to_rgb(module.data[0]) if getattr(module, "data", None) else (0, 0, 0)
            for module in self._layout.device_layout
        ]

    def _write_layout_colors(self, frame: list) -> None:
        """Store a processed frame (one RGB per module) back in the layout."""
        for module, rgb in zip(self._layout.device_layout, frame):
            module.data = [rgb_to_hex(rgb)]
