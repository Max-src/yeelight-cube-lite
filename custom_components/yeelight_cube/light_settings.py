"""The light's own settings: font, orientation, alignment, animations, power-on, buttons.

Owns SettingsMixin: the settings its controls and actions set on the light
and apply at once: the font, the orientation (normal or flipped) and the
4-way device orientation with the lamp's own rotation following it
(_follow_lamp_rotation), the text alignment, the animations' layout, the
lamp's power-on state (set_ps) and the physical button's presets
(async_set_button_effects, _effect_persist_item).
Used only as a mixin of :class:`YeelightCubeLight` (light.py).
"""
import logging
import asyncio
import base64
from .const import (
    DEVICE_ORIENTATIONS,
    DEVICE_ORIENTATION_TO_FLIP,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    ORIENTATION_FLIPPED,
    ORIENTATION_NORMAL,
    POWER_ON_STATES,
)
from .effect_catalog import (
    clock_style_colors,
    ANIMATION_LAYOUTS,
    ALL_NATIVE_EFFECTS,
    NATIVE_CLOCK_EFFECT_ID,
    LITE_STREAMED_EFFECTS,
    NATIVE_CLOCK_STYLES,
    clock_segment_modes,
    clock_style_direct,
    NATIVE_EFFECTS,
    BUTTON_CLOCK_PREFIX,
    canonical_button_effect_name,
)
from .lamp_protocol import CubeConnectionError
from .layout import FONT_MAPS
from .light_native import effect_direction_sent

_LOGGER = logging.getLogger(__name__)


class SettingsMixin:
    """The light's own settings (light_settings.py)."""

    @property
    def font(self):
        return self._font

    async def set_font(self, font: str):
        if font not in FONT_MAPS:
            _LOGGER.error("Invalid font: %s. Available: %s", font, list(FONT_MAPS.keys()))
            return
        self._font = font
        # Published before the redraw: a redraw that fails (an unreachable
        # lamp) still leaves the choice shown.
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        self._notify("font")
        await self.async_apply_display_mode(update_type='text_change')


    @property
    def orientation(self):
        return self._orientation

    async def set_orientation(self, orientation: str):
        if orientation not in (ORIENTATION_NORMAL, ORIENTATION_FLIPPED):
            _LOGGER.error("Invalid orientation value: %s", orientation)
            return
        self._turn_published_picture(orientation)
        self._orientation = orientation
        # Keep the 4-way device orientation consistent (normal->right,
        # flipped->left) so the Device Orientation select reflects legacy calls.
        self._device_orientation = "left" if orientation == ORIENTATION_FLIPPED else "right"
        self._notify("device_orientation")
        self._notify_camera_preview()
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    def _turn_published_picture(self, flip: str) -> None:
        """Publish the picture the integration draws (matrix_colors) as the
        redraw for the ``flip`` about to be set will draw it: a half turn,
        the reverse of the frame (light_render._flip_position). The state is
        written before that redraw (the lamp's rotation report over Matter):
        the new orientation with the old picture showed it a moment in the
        wrong place on the cards and the camera."""
        if flip == self._orientation or self.lamp_draws_matrix:
            return
        if self._base_matrix_colors:
            self._base_matrix_colors = self._base_matrix_colors[::-1]

    @property
    def device_orientation(self):
        return self._device_orientation

    async def set_device_orientation(self, orientation: str):
        """Set the 4-way physical device orientation (right/down/left/up).

        There is no single lamp command for this, so we translate it to the
        mechanisms that actually work and apply immediately for the current mode:
          - matrix / text / pixel art: normal vs flipped (180 deg) pixel flip
          - native effects: the effect's own `direction` field (if supported)
            is turned so the direction chosen stays what the viewer sees, and
            compensated for the lamp's saved mount profile (light_native)
          - the clock, over Matter: the lamp's own direction setting, which
            the lamp applies when the clock starts
            (light_matter._sync_lamp_rotation); without Matter the clock
            stays as it is
        The 90 deg visual rotation for up/down is handled by the preview card.
        """
        if orientation not in DEVICE_ORIENTATIONS:
            _LOGGER.error("Invalid device orientation value: %s", orientation)
            return
        self._turn_published_picture(DEVICE_ORIENTATION_TO_FLIP[orientation])
        self._device_orientation = orientation
        # Drive the matrix/text/pixel flip (normal vs 180 deg).
        self._orientation = DEVICE_ORIENTATION_TO_FLIP[orientation]
        # The profile the lamp is about to run, published with it: previews
        # never show the new orientation on the old profile.
        self._expect_lamp_rotation(orientation)
        self._notify_camera_preview()
        # Everything but the clock follows at once (a native effect is
        # compensated for the profile the lamp runs now). The clock stays as
        # it is until the lamp's own direction is set (_follow_lamp_rotation):
        # re-activating it briefly drops it.
        if self._mode != MODE_CLOCK:
            await self.async_apply_display_mode(update_type='text_change')
        self._notify("device_orientation")
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        # Over Matter, the lamp's own direction setting turns its own content
        # (clock, native effects) for the mount. Written in the background, so
        # the choice never waits for the lamp or a server that is not there
        # (a write may take its whole timeout).
        self._create_tracked_task(
            self._follow_lamp_rotation(orientation),
            name=f"yeelight_cube_lamp_rotation_{self._ip}",
        )

    async def _follow_lamp_rotation(self, orientation: str) -> None:
        """Set the lamp's own direction for ``orientation``
        (light_matter._sync_lamp_rotation), one write at a time; once set, the
        clock or effect it shows starts again so the lamp applies it. A later
        choice wins: an earlier one that ends after it changes nothing."""
        lock = self.__dict__.setdefault("_rotation_write_lock", asyncio.Lock())
        async with lock:
            if orientation != self._device_orientation:
                return  # another choice came since (it set its own profile)
            if not await self._sync_lamp_rotation(orientation):
                self._mount_profile_pending = None  # not written: the old one stays
                if self.hass is not None:
                    self.async_schedule_update_ha_state()
                return
        self._lamp_client.forget_running_effect()
        if getattr(self, "is_cube_matrix", False):
            # A Cube Matrix turns an effect or its clock for its new rotation
            # when it starts it, not while it runs (filmed 2026-11-11): sent
            # again in full, not as a live change with nothing to change.
            self._matrix_shown = None
        if orientation == self._device_orientation and self._mode in (MODE_CLOCK, MODE_NATIVE_EFFECT):
            await self.async_apply_display_mode(update_type='text_change')
        self._notify_camera_preview()
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @property
    def alignment(self):
        return self._alignment

    async def set_alignment(self, alignment: str):
        if alignment not in ("left", "center", "right"):
            _LOGGER.error("Invalid alignment value: %s", alignment)
            return
        self._alignment = alignment
        # Published before the redraw: a redraw that fails (an unreachable
        # lamp) still leaves the choice shown.
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        self._notify("alignment")
        await self.async_apply_display_mode(update_type='text_change')


    async def async_set_animation_layout(self, layout: str) -> None:
        """Lay the animations out upright or as the Yeelight app sends its
        GIFs (effect_catalog.ANIMATION_LAYOUTS). An animation playing is uploaded
        again in the new layout."""
        if layout not in ANIMATION_LAYOUTS:
            raise ValueError(f"Unsupported animation layout: {layout}")
        if layout == self._animation_layout:
            return
        self._animation_layout = layout
        if self.hass is not None:
            self.async_write_ha_state()
        if (
            self._mode == MODE_NATIVE_EFFECT
            and ALL_NATIVE_EFFECTS.get(self._native_effect, {}).get("animation")
        ):
            await self.async_apply_display_mode(update_type="color_change")
            if self.hass is not None:
                self.async_write_ha_state()

    async def async_set_power_on_state(self, option: str) -> None:
        """Set the Cube Lite's power recovery behavior."""
        if option not in POWER_ON_STATES:
            raise ValueError(f"Unsupported power-on state: {option}")
        self._lamp_client.close_fast_socket()
        try:
            result = await self._lamp_client.send_command_with_recovery(
                "set_ps", ["cfg_init_power", POWER_ON_STATES[option]]
            )
            if result is None:
                raise CubeConnectionError(
                    "Power-on behavior command was skipped during connection cooldown"
                )
        finally:
            self._lamp_client.close_command_socket()
        self._power_on_state = option
        if self.hass is not None:
            self.async_write_ha_state()

    def _effect_persist_item(self, name: str) -> dict:
        """Build one official-app compatible physical-button effect entry."""
        name = canonical_button_effect_name(name)
        if name.startswith(BUTTON_CLOCK_PREFIX):
            style_name = name.removeprefix(BUTTON_CLOCK_PREFIX)
            for style_id, style in NATIVE_CLOCK_STYLES.items():
                if style["name"] == style_name:
                    if style.get("background") in LITE_STREAMED_EFFECTS:
                        # Drawn by the integration: the lamp has no such background.
                        raise ValueError(f"The lamp can't run {style_name} itself")
                    config = clock_segment_modes(style["mixer"], clock_style_direct(style))
                    # The style's default color (clock_style_default_color),
                    # or every colour its background draws.
                    colors = clock_style_colors(style)
                    if colors:
                        config["color"] = colors
                    config["data"] = base64.b64encode(
                        self._native_clock_data_bytes()
                    ).decode("ascii")
                    return {
                        "effect_id": NATIVE_CLOCK_EFFECT_ID,
                        "custom_id": style_id,
                        "effect_params": [config],
                    }
        spec = NATIVE_EFFECTS.get(name)
        if spec:
            config = {"mode": spec["mode"], "onoff": 1}
            if spec.get("speed"):
                config["rate"] = self._native_effect_speed
            config["direction"] = effect_direction_sent(self, spec)
            return {
                "effect_id": spec["effect_id"],
                "custom_id": 0,
                "effect_params": [config],
            }
        raise ValueError(f"Unknown native effect: {name}")

    async def async_set_button_effects(self, effect_names: list[str]) -> None:
        """Write up to eight ordered presets used by the physical button:
        over Matter when a server delivers Yeelight's commands (the lamp
        refuses this write over LAN), else over LAN (light_matter). Not on a
        Cube Matrix: its playlist takes other items (its own effects,
        drawings and clock), and a wrong one is kept in its flash."""
        if self.is_cube_matrix:
            raise ValueError(
                "The physical button list of a Cube Matrix is set in the Yeelight app"
            )
        if not 1 <= len(effect_names) <= 8:
            raise ValueError("The physical button list must contain 1 to 8 effects")
        effect_names = [canonical_button_effect_name(name) for name in effect_names]
        items = [self._effect_persist_item(name) for name in effect_names]
        write_over_matter = getattr(self, "_write_button_playlist", None)
        if write_over_matter is None or not await write_over_matter(items):
            self._lamp_client.close_fast_socket()
            try:
                for index, item in enumerate(items):
                    result = await self._lamp_client.send_command_with_recovery(
                        "update_persist_effect_list", [index, item],
                    )
                    if result is None:
                        raise CubeConnectionError(
                            f"Physical-button preset slot {index + 1} was skipped "
                            "during connection cooldown"
                        )
            finally:
                self._lamp_client.close_command_socket()
        self._button_effects = list(effect_names)
        if self.hass is not None:
            self.async_write_ha_state()
