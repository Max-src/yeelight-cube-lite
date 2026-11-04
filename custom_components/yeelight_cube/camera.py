"""Camera platform for Yeelight Cube Lite - live matrix preview on HA device page.

Two camera entities per lamp:
  • **Square** — fast rendering with rectangles, ideal for dashboards.
  • **Round**  — prettier rendering with ellipses (LED-style circles).
"""

import io
import logging
import math
import threading
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
    LAMP_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    CLOCK_MIXER_EFFECTS,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
    DEFAULT_NATIVE_EFFECT_DIRECTION,
    DEFAULT_NATIVE_EFFECT_SPEED,
    NATIVE_CLOCK_STYLES,
)
from .runtime_data import lamp_of
from .entity import CubeDeviceEntity
from .lamp_renderers import (
    LAMP_RENDERED_EFFECTS,
    RENDER_SECONDS,
    lamp_clock_settings,
    lamp_effect_frame,
    led_appearance,
)
from .layout import FONT_MAPS, char_advance
from .matrix_view import display_cell, is_vertical_mount, view_size, viewer_frame
from .native_effect_preview import (
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

# The same at the design size (409 x 124, every measure above divides exactly),
# for a live stream of an effect the lamp renders itself. Encoding follows the image's
# size, not the frame's content: about 85 ms per full-size frame on a real host
# (4 fps at most, whatever the compression), about an eighth of that
# here. A still picture stays full size.
_LIVE_VIEWS = {
    vertical: (
        base.reduce(RENDER_SCALE),
        [tuple(edge // RENDER_SCALE for edge in rect) for rect in rects],
    )
    for vertical, (base, rects) in _VIEWS.items()
}
_LIVE_DOT_MASK = _DOT_MASK.reduce(RENDER_SCALE)


# An animation is followed at the lamp's own rate (RENDER_SECONDS) and only the
# renders that change a pixel are encoded, but the whole job, frame and image,
# never takes more than a third of a core (ENCODE_TIME_FACTOR): a slower host
# shows fewer frames, not a busy core.
ENCODE_TIME_FACTOR = 2


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
        # MJPEG poll interval of the HA camera proxy (a live view): the lamp's
        # render, the fastest a frame can change. async_camera_image answers
        # with the same bytes unless it did, and the stream skips those.
        self._attr_frame_interval = RENDER_SECONDS
        self._attr_content_type = "image/png"
        # The last image rendered (None: render on the next request) and the
        # frame count it must match (async_refresh_preview).
        self._cached_image: bytes | None = None
        self._image_generation = 0
        # What the cached image shows (_view_frame), and when an animation's
        # next image may be drawn.
        self._cached_frame: tuple[list[tuple], bool, bool] | None = None
        self._next_frame_at = 0.0
        # Live streams open right now (handle_async_mjpeg_stream).
        self._live_streams = 0
        self._native_preview_key: tuple[str, str] | None = None
        self._native_preview_started_at: float | None = None
        self._clock_preview_started_at: float | None = None
        # Seconds into the background animation held while the panel is frozen.
        # Cleared on resume so it continues seamlessly from the frozen frame.
        self._frozen_background_seconds: float | None = None
        # Those four: the image's job and the power estimate each run in an
        # executor.
        self._preview_lock = threading.Lock()

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
    async def handle_async_mjpeg_stream(self, request):
        """A live view: counted while open (_view_frame), so a still picture
        is drawn full size."""
        self._live_streams += 1
        try:
            return await super().handle_async_mjpeg_stream(request)
        finally:
            self._live_streams -= 1

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return the full-size PNG.  Browser handles display scaling."""
        if self._cached_image is not None and (
            not self._is_native_preview_mode()
            or _time.monotonic() < self._next_frame_at
        ):
            return self._cached_image
        return await self._async_render()

    def camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        if self._cached_image is None or self._is_native_preview_mode():
            self._cached_frame = self._view_frame()
            self._cached_image = self._render_matrix(*self._cached_frame)
        return self._cached_image

    # ── Internal helpers ───────────────────────────────────────────────
    def _render_job(self) -> tuple[tuple, bytes | None]:
        """The frame to show and its PNG (None: the cached image shows it). In
        an executor: followed 25 times a second, a frame is real work on a
        slow host, and the timelines take their own lock."""
        frame = self._view_frame()
        if self._cached_image is not None and frame == self._cached_frame:
            return frame, None
        return frame, self._render_matrix(*frame)

    async def _async_render(self) -> bytes:
        """Compute the frame and encode the PNG in an executor thread, and
        keep it unless a newer frame arrived meanwhile."""
        generation = self._image_generation
        started = _time.monotonic()
        frame, image = await self.hass.async_add_executor_job(self._render_job)
        spent = _time.monotonic() - started
        self._next_frame_at = started + spent * ENCODE_TIME_FACTOR
        if image is None:
            # Dropped meanwhile by a new frame: that one is drawn now.
            return self._cached_image or await self._async_render()
        if generation == self._image_generation:
            self._cached_image = image
            self._cached_frame = frame
        _LOGGER.debug(
            "[TIMING] camera %s render: %.1fms", self._TRANSLATION_KEY, spent * 1000,
        )
        return image

    def _view_frame(self) -> tuple[list[tuple], bool, bool]:
        """What the image shows: the lamp's frame as the viewer sees it
        (matrix_view.viewer_frame, the rule of every card preview), whether
        it is drawn vertical (the lamp stands on one end and the "Camera
        follows orientation" option is on), and whether it is drawn small for
        a live stream of an effect the lamp renders itself (_LIVE_VIEWS)."""
        orientation = getattr(
            self._light_entity, "_device_orientation", DEFAULT_DEVICE_ORIENTATION
        )
        vertical = is_vertical_mount(orientation) and bool(
            self._config_entry.options.get(CONF_CAMERA_FOLLOWS_ORIENTATION, False)
        )
        live = self._live_streams > 0 and self._shows_lamp_renderer()
        return viewer_frame(self._get_matrix_colors(), orientation), vertical, live

    def _is_native_preview_mode(self) -> bool:
        """Return whether the preview changes without an HA state update."""
        return getattr(self._light_entity, "_mode", None) in LAMP_MODES

    def _shows_lamp_renderer(self) -> bool:
        """Whether the lamp shows an effect drawn by its own renderer (as the
        preview reproduces it), alone or behind the clock."""
        le = self._light_entity
        if getattr(le, "_music_flow_enabled", False):
            return False
        mode = getattr(le, "_mode", None)
        if mode == MODE_NATIVE_EFFECT:
            effect = getattr(le, "_native_effect", DEFAULT_NATIVE_EFFECT)
        elif mode == MODE_CLOCK:
            style = NATIVE_CLOCK_STYLES.get(
                int(getattr(le, "_native_clock_style", 6)),
                NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
            )
            effect = CLOCK_MIXER_EFFECTS.get(style.get("mixer", 0))
        else:
            return False
        return effect in LAMP_RENDERED_EFFECTS

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
            base = self._lamp_clock_frame(self._get_clock_preview())
        elif mode == MODE_NATIVE_EFFECT:
            # Compensated for the lamp's mount profile (light_native): drawn
            # as calibrated, whatever the lamp's own direction setting.
            base = self._get_native_effect_preview()
        else:
            base = getattr(le, "_base_matrix_colors", None)
        if not base or len(base) != 100:
            return [(0, 0, 0)] * 100
        # The lamp renderer's frame is LED drive: shown as those LEDs look.
        # Display only (simulated_lamp_frame keeps the lamp's values).
        if self._shows_lamp_renderer():
            base = [led_appearance(rgb) for rgb in base]

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

    def simulated_lamp_frame(self) -> list[tuple[int, int, int]] | None:
        """The simulated frame the lamp is drawing right now
        (Music Flow, clock, native effect), at full intensity, before the
        preview's brightness boost; None outside those modes. Used for the
        Estimated power sensor.

        Deliberately not the frame on screen (_get_matrix_colors), and what
        its values are depends on what shows (lamp_renderers.py):
        - an effect the lamp renders, all but the stored GIF
          (_shows_lamp_renderer): the lamp's own LED drive, never
          led_appearance's screen colors, which are about twice as bright and
          would about double the estimate. A music slot's runs on the demo beat
          (lamp_core), not the room's sound, so its estimate is rougher;
        - Music Flow, the stored GIF or a solid clock: a fixed illustration or
          an approximation in screen colors, not the lamp's real values, so
          its estimate is rougher.
        In an executor (light.py): it may replay a renderer's history.
        """
        le = self._light_entity
        if getattr(le, "_music_flow_enabled", False):
            return self._get_music_flow_preview()
        mode = getattr(le, "_mode", None)
        if mode == MODE_CLOCK:
            return self._get_clock_preview()
        if mode == MODE_NATIVE_EFFECT:
            return self._get_native_effect_preview()
        return None

    def _lamp_clock_frame(self, frame: list) -> list:
        """The lamp's clock (lamp order) as the lamp draws it: its saved
        mount profile turns it a half turn on 0 and 1
        (light_mount_profile.lamp_turns_clock)."""
        if getattr(self._light_entity, "lamp_turns_clock", False):
            return frame[::-1]
        return frame

    def _preview_speed(self) -> int:
        """The rate the lamp gets (1-255), which previews take as it is."""
        return max(1, min(255, int(getattr(self._light_entity, "_native_effect_speed", DEFAULT_NATIVE_EFFECT_SPEED))))

    def _get_native_effect_preview(self) -> list[tuple[int, int, int]]:
        """The active built-in animation as the lamp draws it: LED drive for an
        effect the lamp renders (render_native_effect)."""
        le = self._light_entity
        speed = self._preview_speed()
        effect = getattr(le, "_native_effect", DEFAULT_NATIVE_EFFECT)
        direction = getattr(le, "_native_effect_direction", DEFAULT_NATIVE_EFFECT_DIRECTION)
        orientation = getattr(le, "_device_orientation", DEFAULT_DEVICE_ORIENTATION)
        with self._preview_lock:
            now = _time.monotonic()
            animation_key = (effect, direction, orientation)
            if animation_key != self._native_preview_key:
                self._native_preview_key = animation_key
                self._native_preview_started_at = now
                self._frozen_background_seconds = None
            # While frozen, hold the frame the lamp is holding; resume seamlessly.
            if getattr(le, "_display_frozen", False):
                if self._frozen_background_seconds is None:
                    self._frozen_background_seconds = now - self._native_preview_started_at
                seconds = self._frozen_background_seconds
            else:
                if self._frozen_background_seconds is not None:
                    self._native_preview_started_at = now - self._frozen_background_seconds
                    self._frozen_background_seconds = None
                seconds = now - self._native_preview_started_at
        frame = render_native_effect_oriented(
            effect,
            seconds * (0.25 + speed / 55.0),
            direction,
            color_mode=getattr(le, "_native_effect_color_mode", "normal"),
            color_override=getattr(le, "_native_effect_color", None),
            speed=speed,
            orientation=orientation,
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
        """Render the active built-in clock face into a 20x5 matrix."""
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

        # The lamp's clock uses the bundled "native" font (monospace: every
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
        # A color override (ARGB int): sent to the mixer's renderer, which takes
        # it or not as on the lamp; a style with no effect shows it flat.
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
        effect_frame = None
        if effect_name is not None:
            # The mixer's renderer behind the clock overlay, on the command
            # light_native sends: the user's speed, the mode 40 direction.
            effect_frame = lamp_effect_frame(
                lamp_clock_settings(
                    effect_name, self._preview_speed(), override_rgb, color_mode
                ),
                self._clock_background_seconds(),
            )
        # A palette mode overrides the custom color, so don't flat-fill with it.
        flat_override = None if mode_active else override_rgb
        # Solid styles (no mixer effect) have no animated renderer to remap for
        # B&W; the backend achieves it by omitting their color, which the
        # lamp renders as plain white.
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

        # Lamp order, like every frame: the lamp's clock cannot turn, so on
        # an upside-down mount the viewer sees it upside down (_view_frame).
        return matrix

    def _clock_background_seconds(self) -> float:
        """Seconds into the clock's background animation. While frozen it holds
        the frame the lamp is holding; the clock digits/colon (rendered from
        real time) still advance. Anchored to the freeze instant so the frozen
        frame is exact; resumes seamlessly from it."""
        le = self._light_entity
        with self._preview_lock:
            now = _time.monotonic()
            if self._clock_preview_started_at is None:
                self._clock_preview_started_at = now
            if getattr(le, "_display_frozen", False):
                if self._frozen_background_seconds is None:
                    frozen_at = getattr(le, "_display_frozen_at", None)
                    reference = (
                        _time.time() - frozen_at
                        if isinstance(frozen_at, (int, float))
                        else 0.0
                    )
                    self._frozen_background_seconds = max(
                        0.0, now - reference - self._clock_preview_started_at
                    )
                return self._frozen_background_seconds
            if self._frozen_background_seconds is not None:
                self._clock_preview_started_at = now - self._frozen_background_seconds
                self._frozen_background_seconds = None
            return now - self._clock_preview_started_at

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

    def _render_matrix(
        self, colors: list[tuple], vertical: bool = False, live: bool = False
    ) -> bytes:
        """Render a top-first frame (_view_frame) landscape or vertical,
        full size or small for a live stream, and return lossless PNG bytes
        (RGBA: transparent around the frame)."""
        base, rects = (_LIVE_VIEWS if live else _VIEWS)[bool(vertical)]
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
        if rect[2] - rect[0] < PIXEL_SIZE:
            img.paste(fill, rect[:2], _LIVE_DOT_MASK)
            return
        img.paste(fill, rect[:2], _DOT_MASK)
