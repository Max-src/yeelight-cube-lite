"""The light's public API for what it displays: content, render modes, text, freeze.

Owns DisplayActionsMixin: what the content mode, display mode, text and
palette controls do (select.py, text.py), the scroll and gradient angle
controls, and the display actions (light_services_display: the gradient
previews, custom text, text colours, drawings, the display mode, solid
colour, full panel, preview adjustments, freeze_display, and
save_state / restore_state).
Part of light_actions.ActionsMixin, the light's public API; used only as a
mixin of :class:`YeelightCubeLight` (light.py).
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from .const import (
    LAMP_MODES,
    MATRIX_DISPLAY_MODES,
    DEFAULT_MATRIX_DISPLAY_MODE,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    PANEL_FULL_CHAR,
    TEXT_RENDER_MODES,
)
from .effect_catalog import NATIVE_CLOCK_APPLY, NATIVE_CLOCK_EFFECT_ID
from .errors import invalid
from .layout import TOTAL_ROWS

_LOGGER = logging.getLogger(__name__)


# The text modes preview_gradient_modes draws.
GRADIENT_PREVIEW_MODES = (
    "Solid Color",
    "Letter Gradient",
    "Column Gradient",
    "Row Gradient",
    "Angle Gradient",
    "Radial Gradient",
    "Letter Angle Gradient",
    "Letter Vertical Gradient",
    "Text Color Sequence",
    "Panel Color Sequence",
)


class DisplayActionsMixin:
    """The light's display actions (light_actions_display.py)."""

    # ── Content and display mode (select.py, text.py) ───────────────────
    async def async_select_content_mode(self, option: str) -> None:
        """The content mode select: Matrix (its last render mode), a lamp
        mode, or Music Flow."""
        if self._mode in MATRIX_DISPLAY_MODES:
            self._enter_mode(matrix_mode=self._mode)
        if option == "Music Flow":
            # Music Flow is the device's built-in microphone renderer, not a
            # matrix mode. Turning it on suppresses matrix content until another
            # content mode is selected (which exits it via async_apply_display_mode).
            # It is sent to the lamp directly, outside the display queue's
            # off-lamp rule: refused like the native-effect action.
            if not self.can_take_commands():
                raise invalid("lamp_off")
            await self.async_set_music_flow(True)
            self._notify("content_mode", "music_flow_effect")
            if self.hass is not None:
                self.async_write_ha_state()
            return
        if option == "Matrix":
            matrix_mode = self._matrix_mode
            if matrix_mode not in MATRIX_DISPLAY_MODES or (
                matrix_mode == "Custom Draw" and not self._custom_pixels
            ):
                matrix_mode = DEFAULT_MATRIX_DISPLAY_MODE
            self._enter_mode(
                matrix_mode, matrix_mode=matrix_mode,
                custom_draw=matrix_mode == "Custom Draw" and bool(self._custom_pixels),
            )
        else:
            self._enter_mode(option, custom_draw=False)
        await self.async_apply_display_mode(update_type="color_change")
        self._notify("content_mode", "display_mode", "pixel_art")
        # Speed and intensity follow the mode (what the lamp shows reads them or not).
        self.write_effect_settings()
        # Keep native-effect helper entities in sync so their UI reflects the
        # current selection when switching into Native Effect content mode.
        if option == MODE_NATIVE_EFFECT:
            self._notify("native_effect", "native_effect_direction")
        if self.hass is not None:
            self.async_write_ha_state()

    async def async_select_display_mode(self, option: str) -> None:
        """The display mode select: a Matrix render mode (Custom Draw shows
        the drawing, if there is one; another mode leaves it)."""
        self._enter_mode(option, matrix_mode=option)
        if option == "Custom Draw":
            self._enter_mode(custom_draw=bool(self._custom_pixels))
        else:
            self._enter_mode(custom_draw=False)
            self._custom_pixels = None
            # Switching to a text mode clears pixel art selection
            self._active_pixel_art_name = None
            self._notify("pixel_art")
        await self.async_apply_display_mode(update_type="color_change")
        self._notify("content_mode")

    async def async_set_text_input(self, value: str) -> None:
        """The display text control: the text replaces the drawing."""
        await self.set_custom_text(value)
        # Disable pixel art mode — text takes priority
        self._custom_pixels = None
        self._enter_mode(custom_draw=False)
        self._active_pixel_art_name = None
        # Leaving pixel-art (Custom Draw) for text: restore a valid text render
        # mode so the renderer doesn't fall through all branches and blank the
        # panel, and the mode-select entity stays consistent.
        if self._mode == "Custom Draw":
            self._enter_mode("Solid Color", matrix_mode="Solid Color")
            self._notify("display_mode")
        # The pixel art select deselects.
        self._notify("pixel_art")
        await self.async_apply_display_mode()

    async def async_apply_palette_colors(self, colors) -> None:
        """The palette select: its colors for the text modes, which leave the
        drawing."""
        self._text_colors = colors
        if self._text_colors:
            self._rgb_color = self._text_colors[0]
        self._custom_pixels = None
        self._enter_mode(custom_draw=False)
        self._active_pixel_art_name = None
        self._notify("pixel_art")
        # Route every palette change through the display state machine. This
        # lets Music Flow exit cleanly before Panel Color Sequence activates
        # direct matrix mode and keeps the switch/device state synchronized.
        await self.async_apply_display_mode(update_type="color_change")

    def set_scroll_enabled(self, enabled: bool) -> None:
        """The scroll switch: a text wider than the matrix scrolls (now, when
        it is)."""
        self._scroll_enabled = enabled
        if enabled:
            if self._max_scroll_offset > 0:
                self._set_scrolling(True)
                self.start_scroll_timer()
        else:
            self._set_scrolling(False)
            self.stop_scroll_timer()

    async def async_restart_scroll(self) -> None:
        """A new scroll interval takes effect at once while the text scrolls."""
        if self._is_scrolling:
            self.start_scroll_timer()

    async def async_set_gradient_angle_value(self, value: float) -> None:
        """The gradient angle slider."""
        self._angle = value
        await self.async_apply_display_mode(update_type="color_change")

    def redraw_in_background(self, name: str) -> None:
        """Re-render (the lamp's adjustments) without holding up the caller."""
        self._create_tracked_task(self.async_apply_display_mode(), name=f"{name}_{self._ip}")

    # ── Display actions (light_services_display) ────────────────────────
    def gradient_preview(self, mode: str) -> list:
        """The lamp's frame (device_profile.pixels colors) in ``mode`` from its current text, colors,
        angle and background: the lamp's own text-mode frame
        (_text_mode_frame), without the orientation flip (the cards apply
        it)."""
        # The full panel: one virtual character covering every pixel, as on
        # the lamp. Within the columns the lamp shows (a Cube Matrix with
        # fewer blocks).
        columns = self._shown_columns()
        if self._full_panel:
            text, width, offset = PANEL_FULL_CHAR, columns, 0
        else:
            text = self._custom_text or ""
            width = sum(self._char_advance(letter) for letter in text) - 1
            offset = self.calculate_text_offset(width, columns) if text else 0
        if mode == "Panel Color Sequence":
            # The whole panel, whatever the text (as on the lamp).
            frame = self._panel_sequence_frame(self._text_colors)
        elif text:
            frame = self._text_mode_frame(
                mode, text, self._text_colors, self._angle, offset, width
            )
        else:
            frame = [None] * (self._panel_width() * TOTAL_ROWS)
        background = self._background_color
        return [background if color is None else color for color in frame]

    def gradient_previews(self) -> dict:
        """preview_gradient_modes's event: every text mode's preview."""
        return {
            mode: [list(color) for color in self.gradient_preview(mode)]
            for mode in GRADIENT_PREVIEW_MODES
        }

    def preview_details(self) -> dict:
        """What preview_gradient_modes's event tells besides the previews."""
        return {
            "text": self._custom_text,
            "angle": self._angle,
            "brightness": self._brightness,
            "full_panel": self._full_panel,
        }

    async def async_show_custom_text(self, text: str) -> None:
        """set_custom_text: the text replaces the drawing (kept for later
        while the lamp shows its clock or an effect)."""
        _LOGGER.debug("[SET_TEXT] Setting custom text to: '%s' for entity %s", text, self.entity_id)
        self._custom_text = text
        self._custom_pixels = None
        self._enter_mode(custom_draw=False)
        self._active_pixel_art_name = None
        if self._text_waits_for_matrix():
            # The lamp shows its built-in clock / native effect: the text
            # is kept for when it shows text again (call save_state first
            # to show it over the clock, restore_state to come back).
            self._notify("text_input")
            if self.hass is not None:
                self.async_schedule_update_ha_state()
            _LOGGER.debug(
                "[SET_TEXT] %s shows %s: text kept for later", self.entity_id, self._mode,
            )
            return
        # Leaving pixel-art (Custom Draw) for text: restore a valid text
        # render mode so the mode-select entity and renderer stay consistent
        # -- otherwise _mode lingers as "Custom Draw" and the text render
        # would blank the panel (see TEXT_RENDER_MODES safety net).
        if self._mode not in TEXT_RENDER_MODES:
            self._enter_mode("Solid Color", matrix_mode="Solid Color")
            self._notify("display_mode")
        self._notify("text_input", "pixel_art")
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        self._scroll_offset = 0
        self._scroll_direction = 1
        self.stop_scroll_timer()
        await self.async_apply_display_mode(update_type="text_change")
        _LOGGER.debug("[SET_TEXT] Display mode applied successfully for entity %s", self.entity_id)

    async def async_set_gradient_angle(self, angle: float) -> None:
        """set_angle."""
        self._angle = angle
        # Push angle to HA state immediately so the frontend card's set hass()
        # detects the change and can reload previews without waiting for the
        # next polling cycle (~30s).  Must happen BEFORE the slow hardware
        # command so the JS card sees the new angle right away.
        self.async_schedule_update_ha_state()
        await self.async_apply_display_mode(update_type="color_change")
        self._notify("angle")

    async def async_set_text_colors(self, colors: list, update_type: str = "color_change") -> None:
        """set_text_colors and load_palette (``update_type`` pixel_art)."""
        self._text_colors = colors
        if self._text_colors:
            self._rgb_color = self._text_colors[0]
        # Published at once: the previews that draw the colors (effects and
        # clock in the Palette color mode) follow them without waiting for
        # the lamp, which may take a while (queued commands, a music mode
        # starting) or refuse.
        if self.hass is not None:
            self.async_write_ha_state()
        # (Panel Color Sequence included: the display render colors it.)
        await self.async_apply_display_mode(update_type=update_type)
        # Push the updated state so consumers watching the `text_colors`
        # attribute (e.g. the gradient card's live preview) refresh
        # immediately.
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    async def async_show_drawing(self, custom_pixels: list) -> None:
        """display_image: the image as the lamp's drawing."""
        self._custom_pixels = custom_pixels
        self._enter_mode("Custom Draw", matrix_mode="Custom Draw", custom_draw=True)
        await self.async_apply_display_mode(update_type="pixel_art")
        self._notify("display_mode", "content_mode")

    async def async_set_display_mode(self, mode: str, full_panel=None) -> None:
        """set_mode: a Matrix render mode or a lamp mode (and full_panel when
        given)."""
        if full_panel is not None:
            self._full_panel = full_panel
            _LOGGER.debug("[set_mode] Also setting full_panel to %s", full_panel)
        if mode in MATRIX_DISPLAY_MODES:
            self._enter_mode(mode, matrix_mode=mode)
        if mode == "Custom Draw":
            self._enter_mode(custom_draw=True)
        elif mode in LAMP_MODES:
            self._enter_mode(mode, custom_draw=False)
        else:
            self._enter_mode(custom_draw=False)
            self._custom_pixels = None
        await self.async_apply_display_mode(update_type="color_change")
        self._notify("display_mode", "content_mode")
        # Speed and intensity follow the mode (what the lamp shows reads them or not).
        self.write_effect_settings()
        # Keep native-effect helper entities in sync.
        if mode == MODE_NATIVE_EFFECT:
            self._notify("native_effect", "native_effect_direction")

    async def async_set_solid_color(self, rgb_color: tuple) -> None:
        """set_solid_color."""
        # Rendering reads colors from _text_colors, not _rgb_color — set
        # both so the new color is actually visible on the lamp.
        self._text_colors = [rgb_color]
        self._rgb_color = rgb_color
        await self.async_apply_display_mode(update_type="color_change")
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    async def async_set_full_panel(self, full_panel: bool) -> None:
        """set_full_panel."""
        _LOGGER.debug(
            "[PANEL] [%s] Setting full_panel=%s (was %s)", self._ip, full_panel, self._full_panel
        )
        self._full_panel = full_panel
        # When enabling panel mode, deactivate custom draw so the display
        # switches back to the text/gradient rendering path.  The pixel art
        # branch in _apply_display_mode_internal would otherwise take
        # priority and ignore full_panel entirely.
        if full_panel:
            self._enter_mode(custom_draw=False)
            self._custom_pixels = None
        self.async_schedule_update_ha_state()
        await self.async_apply_display_mode(update_type="color_change")

    def set_preview_adjustments(self, data) -> None:
        """set_preview_adjustments: the given color adjustments (the others
        as they are), within their ranges; redrawn in the background."""
        limits = {
            "hue_shift": (-180, 180), "temperature": (-100, 100),
            "saturation": (0, 200), "vibrance": (0, 200), "contrast": (0, 200),
            "glow": (0, 100), "grayscale": (0, 100), "invert": (0, 100),
            "tint_hue": (0, 360), "tint_strength": (0, 100),
        }
        values = {
            key: max(low, min(high, int(data.get(key, getattr(self, f"_preview_{key}")))))
            for key, (low, high) in limits.items()
        }
        for key, value in values.items():
            setattr(self, f"_preview_{key}", value)
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        self._notify("preview_adjustments")
        self.redraw_in_background("yeelight_cube_apply_preview_adjustments")

    def _freeze_params(self) -> list:
        """The command freezing what the lamp shows itself (freeze_display)."""
        if self._mode == MODE_CLOCK:
            data = base64.b64encode(self._native_clock_data_bytes()).decode("ascii")
            return [
                NATIVE_CLOCK_EFFECT_ID,
                self._native_clock_style,
                NATIVE_CLOCK_APPLY,
                {"mode": NATIVE_CLOCK_EFFECT_ID, "mixer": 64, "data": data},
            ]
        return [64, 0, 4, {"mode": 64}]

    async def async_freeze_display(self) -> None:
        """freeze_display: the panel holds its current frame.

        Native effects freeze via the renderer's freeze-frame command
        ([64, 0, 4, {mode: 64}]). The lamp's clock instead re-sends its
        current command with the freeze mixer (64) -- sending mode 64 to the
        clock shows a full-panel effect, not the frozen clock face. A Cube
        Matrix has neither: what it shows itself over Matter is replaced by a
        still drawing of the held frame (light_matrix.async_matrix_freeze),
        and a streamed effect stops being sent. Resume is client-driven: the
        cards re-apply the current effect / clock mode (i.e. resend the last
        command)."""
        params = self._freeze_params()
        is_clock = self._mode == MODE_CLOCK
        # Capture the background phase at freeze time so the preview holds
        # that exact frame; sampling later would freeze on a stale frame.
        self._display_frozen_at = time.time()

        # Studio: the stream pauses (light_studio) and the lamp holds the
        # frame it was last sent; no command.
        if self.studio_streaming():
            self._set_display_frozen(True)
            self.async_write_ha_state()
            self._notify_camera_preview()
            return

        # A Cube Matrix showing its own effect or clock over Matter: the
        # held frame as its drawing (light_matrix).
        if self.matrix_freezes():
            if await self._execute_hardware_op(self.async_matrix_freeze, "freeze_display") is False:
                return
            self.async_write_ha_state()
            self._notify_camera_preview()
            return

        async def _do_send():
            self._lamp_client.close_fast_socket()
            # The clock activation is socket-timing sensitive; give the
            # fresh socket the same brief settle it uses in _activate_native_clock.
            if is_clock:
                await asyncio.sleep(0.1)
            await self._lamp_client.send_raw_command("set_fx_effect", params)

        await self._execute_hardware_op(_do_send, "freeze_display")
        # Track the freeze so the fake camera holds the background frame
        # (clock digits keep rendering live). Cleared by the next re-apply.
        self._set_display_frozen(True)
        self.async_write_ha_state()
        self._notify_camera_preview()

    def save_display_state(self) -> None:
        """save_state."""
        self._save_display_state()

    async def async_restore_saved_state(self) -> bool:
        """restore_state: the state save_state kept, shown again (False when
        none was saved)."""
        if not self._restore_display_state():
            return False
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        await self.async_apply_display_mode(update_type="color_change")
        # The rotation that ran when the state was saved runs again.
        await self._async_resume_display_rotation()
        return True
