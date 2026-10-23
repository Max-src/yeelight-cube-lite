"""Camera platform for Yeelight Cube Lite - live matrix preview on HA device page.

Two camera entities per lamp:
  • **Square** — fast rendering with rectangles, ideal for dashboards.
  • **Round**  — prettier rendering with ellipses (LED-style circles).
"""

import io
import logging
import math
import time as _time

from PIL import Image, ImageDraw, ImageFilter  # type: ignore

from homeassistant.components.camera import Camera  # type: ignore
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback  # type: ignore
from homeassistant.util import dt as dt_util  # type: ignore

from .const import (
    CONF_CAMERA_FOLLOWS_ORIENTATION,
    DEFAULT_DEVICE_ORIENTATION,
    FIRMWARE_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    CLOCK_MIXER_EFFECTS,
    CLOCK_MIXER_EFFECT_SPEED,
    DEFAULT_NATIVE_CLOCK_STYLE,
    NATIVE_CLOCK_STYLES,
)
from .runtime_data import lamp_of
from .entity import CubeDeviceEntity
from .effect_orientation import clock_effect_direction
from .layout import FONT_MAPS, char_advance
from .matrix_view import display_cell, is_vertical_mount, view_size, viewer_frame
from .native_effect_preview import (
    effect_supports_color_override,
    render_music_flow_effect,
    render_native_effect_oriented,
)

_LOGGER = logging.getLogger(__name__)

# No limit per platform: every command to the lamp already waits for the
# previous one (the device lock, light_connection._execute_hardware_op).
PARALLEL_UPDATES = 0

# ── Matrix dimensions ──────────────────────────────────────────────────
COLS = 20
ROWS = 5

# ── Image rendering parameters ────────────────────────────────────────
# The lamp drawn like the Lamp Preview card: a black frame with rounded
# corners and a soft shadow, on a transparent background (a dashboard's
# picture card shows its own background around it, whatever the fit). The
# design is a 16 px pixel, 3 px gap, 10 px padding, 14 px corners and a 6 px
# margin for the shadow, rendered RENDER_SCALE times larger so it stays sharp
# full width: 1227 x 372 px (372 x 1227 vertical). The frame, its shadow and
# the round dots' edges are anti-aliased once at import (_VIEWS, _DOT_MASK);
# a frame copies its view's base and stamps the dots: about 9 ms and 30 KB
# (round), 4 ms and 6 KB (square), encoded in an executor thread.
RENDER_SCALE = 3
PIXEL_SIZE = 16 * RENDER_SCALE
PIXEL_GAP = 3 * RENDER_SCALE
PADDING = 10 * RENDER_SCALE
FRAME_RADIUS = 14 * RENDER_SCALE
MARGIN = 6 * RENDER_SCALE
CELL_SIZE = PIXEL_SIZE + PIXEL_GAP
# Edges are drawn this many times larger, then reduced (anti-aliasing).
_SUPERSAMPLE = 4


def _smooth_mask(size: tuple[int, int], draw_shape) -> Image.Image:
    """An anti-aliased coverage mask of `size`: `draw_shape(draw, box)` draws
    the shape _SUPERSAMPLE times larger, then it is reduced."""
    big = Image.new("L", (size[0] * _SUPERSAMPLE, size[1] * _SUPERSAMPLE), 0)
    draw_shape(ImageDraw.Draw(big), (0, 0, big.width - 1, big.height - 1))
    return big.resize(size, Image.LANCZOS)


# A round dot's coverage, pasted with each lit pixel's color.
_DOT_MASK = _smooth_mask(
    (PIXEL_SIZE, PIXEL_SIZE), lambda draw, box: draw.ellipse(box, fill=255)
)


def _frame_size(cols: int, rows: int) -> tuple[int, int]:
    return (
        PADDING * 2 + cols * CELL_SIZE - PIXEL_GAP,
        PADDING * 2 + rows * CELL_SIZE - PIXEL_GAP,
    )


def _view_base(vertical: bool) -> Image.Image:
    """A view's empty image: the rounded black frame and its shadow (2 px
    down, 8 px blur, half opaque, as the Lamp Preview's) on transparency."""
    frame = _frame_size(*view_size(vertical))
    size = (frame[0] + 2 * MARGIN, frame[1] + 2 * MARGIN)
    radius = FRAME_RADIUS * _SUPERSAMPLE
    mask = _smooth_mask(
        frame,
        lambda draw, box: draw.rounded_rectangle(box, radius=radius, fill=255),
    )
    shadow = Image.new("L", size, 0)
    shadow.paste(mask, (MARGIN, MARGIN + 2 * RENDER_SCALE))
    shadow = shadow.filter(ImageFilter.GaussianBlur(4 * RENDER_SCALE))
    base = Image.new("RGBA", size, (0, 0, 0, 0))
    base.putalpha(shadow.point(lambda value: value // 2))
    base.paste((0, 0, 0, 255), (MARGIN, MARGIN), mask)
    return base


def _view_rects(vertical: bool) -> list[tuple[int, int, int, int]]:
    """Each top-first pixel's rectangle in a landscape or vertical image
    (matrix_view.display_cell), built once at import time so _render_matrix
    does no arithmetic."""
    rects = []
    for index in range(COLS * ROWS):
        row, col = display_cell(index, vertical)
        x = MARGIN + PADDING + col * CELL_SIZE
        y = MARGIN + PADDING + row * CELL_SIZE
        rects.append((x, y, x + PIXEL_SIZE, y + PIXEL_SIZE))
    return rects


# vertical -> (empty image, rectangles): 1227 x 372 landscape, 372 x 1227
# vertical.
_VIEWS = {vertical: (_view_base(vertical), _view_rects(vertical)) for vertical in (False, True)}


# ── Perceptual brightness boost (must match JS matrix-const.js) ─────
# LCD screens look dimmer than real LEDs at the same RGB value.
# The JS lamp-preview card applies a boost curve to compensate.
# We replicate the exact same formula here so both previews match.
_FLOOR = 0.48  # boost at 0% brightness (PREVIEW_BRIGHTNESS_FLOOR)
_PREVIEW_BRIGHTNESS_GAMMA = 1.35


# ── Platform setup ─────────────────────────────────────────────────────
async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up both matrix preview camera entities (square + round)."""
    light_entity = lamp_of(entry)
    if light_entity is None:
        _LOGGER.warning(
            "Camera setup: no light entity found for entry %s", entry.entry_id
        )
        return

    cam_square = YeelightCubeMatrixCameraSquare(light_entity, entry)
    cam_round = YeelightCubeMatrixCameraRound(light_entity, entry)
    light_entity._camera_entities = [cam_square, cam_round]
    async_add_entities([cam_square, cam_round])
    _LOGGER.debug(
        "Matrix preview cameras (square + round) created for %s",
        light_entity._lamp_name,
    )


# ── Base camera ────────────────────────────────────────────────────────
class _YeelightCubeMatrixCameraBase(CubeDeviceEntity, Camera):
    """Abstract base for the 20×5 LED matrix live-preview cameras.

    Subclasses override ``_draw_pixel()`` to choose rectangle vs ellipse.
    """

    # Subclass MUST set these in __init__
    _TRANSLATION_KEY: str  # e.g. "matrix_preview_square"
    _UID_SUFFIX: str      # e.g. "_matrix_preview_square"

    def __init__(self, light_entity, config_entry: ConfigEntry) -> None:
        super().__init__()
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_translation_key = self._TRANSLATION_KEY
        self._attr_unique_id = f"{light_entity._attr_unique_id}{self._UID_SUFFIX}"
        self._attr_is_streaming = False
        # MJPEG poll interval for the HA camera proxy -> ~3 fps preview refresh.
        self._attr_frame_interval = 0.3
        self._attr_content_type = "image/png"
        # The last image rendered (None: render on the next request) and the
        # frame count it must match (async_refresh_preview).
        self._cached_image: bytes | None = None
        self._image_generation = 0
        self._native_preview_key: tuple[str, str] | None = None
        self._native_preview_started_at: float | None = None
        # Background animation phase held while the panel is frozen. Cleared on
        # resume so the animation continues seamlessly from the frozen frame.
        self._frozen_background_phase: float | None = None
        # Seamless-resume offset for the clock's absolute-phase background.
        self._clock_phase_offset: float = 0.0

    # ── Lifecycle ──────────────────────────────────────────────────────
    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # The light tells its cameras of new frames (light._camera_entities,
        # set up with them) until this one is removed.
        cameras = self._light_entity._camera_entities
        self.async_on_remove(lambda: self in cameras and cameras.remove(self))

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    # ── New frame (called by the light entity) ─────────────────────────
    @callback
    def async_refresh_preview(self) -> None:
        """The lamp shows something new: drop the image and give the frontend
        a new token, so a viewer fetches it. Rendered on demand only
        (async_camera_image): nobody watching costs nothing, and a fetch
        always draws the lamp's latest frame."""
        self._cached_image = None
        self._image_generation += 1
        self.async_update_token()
        self.async_write_ha_state()

    # ── Image serving ──────────────────────────────────────────────────
    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return the full-size PNG.  Browser handles display scaling."""
        if self._cached_image is not None and not self._is_native_preview_mode():
            return self._cached_image
        return await self._async_render()

    def camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        if self._cached_image is None or self._is_native_preview_mode():
            self._cached_image = self._render_matrix(*self._view_frame())
        return self._cached_image

    # ── Internal helpers ───────────────────────────────────────────────
    async def _async_render(self) -> bytes:
        """Compute the frame on the loop, encode the PNG in an executor thread,
        and keep it unless a newer frame arrived meanwhile."""
        generation = self._image_generation
        started = _time.monotonic()
        image = await self.hass.async_add_executor_job(
            self._render_matrix, *self._view_frame()
        )
        if generation == self._image_generation:
            self._cached_image = image
        _LOGGER.debug(
            "[TIMING] camera %s render: %.1fms",
            self._TRANSLATION_KEY, (_time.monotonic() - started) * 1000,
        )
        return image

    def _view_frame(self) -> tuple[list[tuple], bool]:
        """What the image shows: the lamp's frame as the viewer sees it
        (matrix_view.viewer_frame, the rule of every card preview), and
        whether it is drawn vertical: the lamp stands on one end and the
        "Camera follows orientation" option is on."""
        orientation = getattr(
            self._light_entity, "_device_orientation", DEFAULT_DEVICE_ORIENTATION
        )
        vertical = is_vertical_mount(orientation) and bool(
            self._config_entry.options.get(CONF_CAMERA_FOLLOWS_ORIENTATION, False)
        )
        return viewer_frame(self._get_matrix_colors(), orientation), vertical

    def _is_native_preview_mode(self) -> bool:
        """Return whether the preview changes without an HA state update."""
        return getattr(self._light_entity, "_mode", None) in FIRMWARE_MODES

    def _get_matrix_colors(self) -> list[tuple]:
        """The matrix colors scaled by a perceptual brightness curve, like
        the JS lamp-preview card does with ``matrix_colors`` (the lamp dims
        in hardware, so the published colors are never darkened):

            effective = FLOOR + (1 - FLOOR) × (brightness/255)^GAMMA
            pixel     = min(255, round(v × effective))
        """
        le = self._light_entity
        if not getattr(le, "_is_on", False):
            return [(0, 0, 0)] * 100

        mode = getattr(le, "_mode", None)
        if getattr(le, "_music_flow_enabled", False):
            base = self._get_music_flow_preview()
        elif mode == MODE_CLOCK:
            base = self._firmware_lamp_frame(self._get_clock_preview())
        elif mode == MODE_NATIVE_EFFECT:
            base = self._firmware_lamp_frame(self._get_native_effect_preview())
        else:
            base = getattr(le, "_base_matrix_colors", None)
        if not base or len(base) != 100:
            return [(0, 0, 0)] * 100

        # --- Compute the effective multiplier (same net result as JS) ---
        brightness = getattr(le, "_brightness", 255) or 255
        t = brightness / 255.0                                  # 0..1
        effective = _FLOOR + (1 - _FLOOR) * math.pow(t, _PREVIEW_BRIGHTNESS_GAMMA)

        # --- Apply effective per pixel ---
        result: list[tuple] = []
        for rgb in base:
            try:
                r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
            except Exception:
                result.append((0, 0, 0))
                continue

            if r == 0 and g == 0 and b == 0:
                result.append((0, 0, 0))
                continue

            r = min(255, round(r * effective))
            g = min(255, round(g * effective))
            b = min(255, round(b * effective))
            result.append((r, g, b))
        return result

    def simulated_firmware_frame(self) -> list[tuple[int, int, int]] | None:
        """The simulated frame the lamp's firmware is drawing right now
        (Music Flow, clock, native effect), at full intensity, before the
        preview's brightness boost; None outside those modes. Used for the
        Estimated power sensor."""
        le = self._light_entity
        if getattr(le, "_music_flow_enabled", False):
            return self._get_music_flow_preview()
        mode = getattr(le, "_mode", None)
        if mode == MODE_CLOCK:
            return self._get_clock_preview()
        if mode == MODE_NATIVE_EFFECT:
            return self._get_native_effect_preview()
        return None

    def _firmware_lamp_frame(self, frame: list) -> list:
        """Firmware content (clock, native effect; lamp order) as the lamp
        draws it: its own direction setting (followed over Matter) may turn
        it a half turn (light_matter.lamp_turns_content)."""
        if getattr(self._light_entity, "lamp_turns_content", False):
            return frame[::-1]
        return frame

    def _get_native_effect_preview(self) -> list[tuple[int, int, int]]:
        """Render a local approximation of the active firmware animation."""
        le = self._light_entity
        speed = max(1, min(100, int(getattr(le, "_native_effect_speed", 50))))
        effect = getattr(le, "_native_effect", "Streamer")
        direction = getattr(le, "_native_effect_direction", "Up")
        now = _time.monotonic()
        animation_key = (effect, direction)
        if animation_key != self._native_preview_key:
            self._native_preview_key = animation_key
            self._native_preview_started_at = now
            self._frozen_background_phase = None
        rate = 0.25 + speed / 55.0
        # While frozen, hold the frame the lamp is holding; resume seamlessly.
        if getattr(le, "_display_frozen", False):
            if self._frozen_background_phase is None:
                self._frozen_background_phase = (now - self._native_preview_started_at) * rate
            phase = self._frozen_background_phase
        else:
            if self._frozen_background_phase is not None:
                self._native_preview_started_at = now - self._frozen_background_phase / rate
                self._frozen_background_phase = None
            phase = (now - self._native_preview_started_at) * rate
        frame = render_native_effect_oriented(
            effect,
            phase,
            direction,
            color_mode=getattr(le, "_native_effect_color_mode", "normal"),
            color_override=getattr(le, "_native_effect_color", None),
        )
        # Lamp order (row 0 = physical bottom), like every frame: _view_frame
        # turns it the way the viewer sees it, once.
        return frame

    def _get_music_flow_preview(self) -> list[tuple[int, int, int]]:
        """Render a fixed illustration of the active Music Flow effect."""
        return render_music_flow_effect(
            getattr(self._light_entity, "_music_flow_effect", "Breathing")
        )

    def _get_clock_preview(self) -> list[tuple[int, int, int]]:
        """Render the active firmware clock face into a 20x5 matrix."""
        le = self._light_entity
        now = dt_util.now()
        # 3-way clock content (byte 0): time | time_date (alternate) | date.
        # Fall back to the legacy show_date boolean for older state.
        content = getattr(le, "_native_clock_content", None)
        if content not in ("time", "time_date", "date"):
            content = "time_date" if getattr(le, "_native_clock_show_date", False) else "time"
        if content == "date":
            date_phase = True
        elif content == "time_date":
            date_phase = int(now.timestamp() // 5) % 2 == 1
        else:
            date_phase = False
        if date_phase:
            text = now.strftime("%m.%d")
        else:
            clock_format = (
                "%I:%M"
                if bool(getattr(le, "_native_clock_12_hour", False))
                else "%H:%M"
            )
            text = now.strftime(clock_format)
        colon_visible = not (
            not date_phase
            and bool(getattr(le, "_native_clock_colon_blink", False))
            and now.second % 2 == 1
        )

        # The firmware clock uses the bundled "native" font (monospace: every
        # digit occupies a fixed cell, colon/period are narrow) so the preview
        # matches the hardware exactly.
        font_key = "native"
        font = FONT_MAPS[font_key]
        glyphs = [font.get(char, []) for char in text]
        advances = [
            char_advance(font_key, char, glyph)
            for char, glyph in zip(text, glyphs)
        ]
        total_width = (sum(advances) - 1) if advances else 0
        offset = max(0, (COLS - total_width) // 2)
        style_id = int(getattr(le, "_native_clock_style", 6))
        matrix = [(0, 0, 0)] * 100

        # Styles whose mixer is a native effect show that effect through the lit
        # glyph pixels; render it once and mask it below. Others use the
        # solid/gradient color.
        style = NATIVE_CLOCK_STYLES.get(
            style_id, NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE]
        )
        # A color override (ARGB int) recolors compatible mixer effects (dark
        # stays dark); incompatible styles fall back to the flat override color.
        override_int = getattr(le, "_native_clock_color", None)
        override_rgb = (
            (
                (override_int >> 16) & 255,
                (override_int >> 8) & 255,
                override_int & 255,
            )
            if override_int is not None
            else None
        )
        effect_name = CLOCK_MIXER_EFFECTS.get(style.get("mixer", 0))
        # A palette color mode (e.g. B&W) takes precedence over the override.
        color_mode = getattr(le, "_native_clock_color_mode", "normal") or "normal"
        mode_active = color_mode != "normal"
        override_compatible = (
            not mode_active
            and override_rgb is not None
            and effect_name is not None
            and effect_supports_color_override(effect_name)
        )
        # Compatible effects recolor toward the override; incompatible effects
        # render normally (ignore it); styles with no effect fall back to the
        # flat override color in the mask loop below.
        effect_frame = None
        if effect_name is not None:
            # While frozen, hold the background effect on the frame the lamp is
            # holding; the clock digits/colon (rendered from real time below)
            # still advance. Anchor the held phase to the freeze instant so the
            # frozen frame is exact; resume seamlessly from the held phase.
            rate = 0.25 + CLOCK_MIXER_EFFECT_SPEED / 55.0
            if getattr(le, "_display_frozen", False):
                if self._frozen_background_phase is None:
                    frozen_at = getattr(le, "_display_frozen_at", None)
                    reference = (
                        _time.time() - frozen_at
                        if isinstance(frozen_at, (int, float))
                        else 0.0
                    )
                    self._frozen_background_phase = (
                        (_time.monotonic() - reference) * rate
                    )
                phase = self._frozen_background_phase
            else:
                if self._frozen_background_phase is not None:
                    self._clock_phase_offset = (
                        self._frozen_background_phase - _time.monotonic() * rate
                    )
                    self._frozen_background_phase = None
                phase = _time.monotonic() * rate + self._clock_phase_offset
            direction = clock_effect_direction(effect_name)
            effect_frame = render_native_effect_oriented(
                effect_name,
                phase,
                direction,
                override_rgb if override_compatible else None,
                color_mode if mode_active else None,
            )
        # A palette mode overrides the custom color, so don't flat-fill with it.
        flat_override = None if mode_active else override_rgb
        # Solid styles (no mixer effect) have no animated renderer to remap for
        # B&W; the backend achieves it by omitting their color, which the
        # firmware renders as plain white.
        solo_bw_fallback = effect_frame is None and color_mode == "bw"

        for char_index, (char, glyph, advance) in enumerate(
            zip(text, glyphs, advances)
        ):
            if char == ":" and not colon_visible:
                offset += advance
                continue
            for position in glyph:
                col = position % COLS + offset
                row = position // COLS
                if 0 <= col < COLS and 0 <= row < ROWS:
                    if effect_frame is not None:
                        matrix[row * COLS + col] = effect_frame[row * COLS + col]
                    elif solo_bw_fallback:
                        matrix[row * COLS + col] = (255, 255, 255)
                    elif flat_override is not None:
                        matrix[row * COLS + col] = flat_override
                    else:
                        matrix[row * COLS + col] = self._clock_pixel_color(
                            style_id,
                            char_index,
                            col,
                        )
            offset += advance

        # Lamp order, like every frame: the firmware clock cannot turn, so on
        # an upside-down mount the viewer sees it upside down (_view_frame).
        return matrix

    @staticmethod
    def _gradient_color(
        palette: list[tuple[int, int, int]], factor: float
    ) -> tuple[int, int, int]:
        """Interpolate across a multi-stop RGB palette."""
        factor = max(0.0, min(1.0, factor))
        if len(palette) == 1:
            return palette[0]
        scaled = factor * (len(palette) - 1)
        index = min(len(palette) - 2, int(scaled))
        local = scaled - index
        start, end = palette[index], palette[index + 1]
        return tuple(
            round(start[channel] + (end[channel] - start[channel]) * local)
            for channel in range(3)
        )

    def _clock_pixel_color(
        self,
        style_id: int,
        char_index: int,
        col: int,
    ) -> tuple[int, int, int]:
        """Approximate the official clock preview palette for one LED."""
        fixed = {
            2: (0, 221, 255),
            4: (255, 255, 255),
            5: (34, 238, 178),
            6: (255, 238, 0),
            7: (255, 44, 222),
            8: (255, 45, 40),
            9: (0, 222, 255),
            10: (132, 24, 238),
        }
        if style_id in fixed:
            return fixed[style_id]
        if style_id == 3:
            return [(243, 38, 229), (43, 120, 255), (21, 223, 131), (125, 255, 23)][
                char_index % 4
            ]
        if style_id == 12:
            return [(70, 132, 255), (255, 230, 39)][char_index % 2]

        palettes = {
            1: [
                (255, 55, 20),
                (255, 201, 30),
                (44, 238, 88),
                (38, 157, 255),
                (230, 31, 224),
            ],
            11: [(255, 93, 19), (235, 64, 91), (124, 25, 242)],
            13: [(35, 92, 230), (73, 143, 255), (229, 246, 255)],
            14: [(25, 143, 255), (56, 183, 255), (230, 248, 255)],
        }
        return self._gradient_color(
            palettes.get(style_id, [(255, 238, 0)]),
            col / (COLS - 1),
        )

    # Subclass must implement
    def _draw_pixel(self, img: Image.Image, draw: ImageDraw.Draw, rect: tuple, fill: tuple) -> None:
        raise NotImplementedError

    def _render_matrix(self, colors: list[tuple], vertical: bool = False) -> bytes:
        """Render a top-first frame (_view_frame) landscape or vertical and
        return lossless PNG bytes (RGBA: transparent around the frame)."""
        base, rects = _VIEWS[bool(vertical)]
        img = base.copy()
        draw = ImageDraw.Draw(img)

        for i, rgb in enumerate(colors):
            if isinstance(rgb, (tuple, list)) and len(rgb) >= 3:
                r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
                if r == 0 and g == 0 and b == 0:
                    continue
            else:
                continue
            self._draw_pixel(img, draw, rects[i], (r, g, b, 255))

        buf = io.BytesIO()
        # compress_level=6 (zlib's default): about 2 ms more than the fastest
        # level for half the bytes on the anti-aliased round dots.
        img.save(buf, format="PNG", compress_level=6)
        return buf.getvalue()


# ── Square-pixel camera ───────────────────────────────────────────────
class YeelightCubeMatrixCameraSquare(_YeelightCubeMatrixCameraBase):
    """Fast preview using square (rectangle) pixels."""

    _TRANSLATION_KEY = "matrix_preview_square"
    _UID_SUFFIX = "_matrix_preview_square"

    def _draw_pixel(self, img, draw, rect, fill):
        # The last row and column inside the pixel (PIL boxes are inclusive).
        draw.rectangle((rect[0], rect[1], rect[2] - 1, rect[3] - 1), fill=fill)


# ── Round-pixel camera ────────────────────────────────────────────────
class YeelightCubeMatrixCameraRound(_YeelightCubeMatrixCameraBase):
    """Prettier preview using round (ellipse) pixels resembling LEDs."""

    _TRANSLATION_KEY = "matrix_preview_round"
    _UID_SUFFIX = "_matrix_preview_round"

    def _draw_pixel(self, img, draw, rect, fill):
        img.paste(fill, rect[:2], _DOT_MASK)
