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

from PIL import Image, ImageChops, ImageDraw, ImageFilter  # type: ignore

from homeassistant.components.camera import Camera  # type: ignore
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback  # type: ignore
from homeassistant.util import dt as dt_util  # type: ignore

from .const import (
    CONF_CAMERA_FOLLOWS_ORIENTATION,
    LAMP_MODES,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
)
from .effect_catalog import (
    clock_style_effect,
    DEFAULT_NATIVE_CLOCK_STYLE,
    NATIVE_CLOCK_STYLES,
    clock_style_direct,
    PALETTE_COLOR_MODE,
)
from .runtime_data import lamp_of
from .entity import CubeDeviceEntity
from .lamp_renderers import (
    LAMP_RENDERED_EFFECTS,
    RENDER_SECONDS,
    clock_digit_flags,
    clock_palette_words,
    lamp_clock_settings,
    lamp_effect_frame,
    led_appearance,
)
from .clock_face import clock_digit_pixels, clock_geometry, clock_text
from .device_profile import _spot_colour
from .lamp_studio import clock_studio_runs, studio_clock_background_at, studio_drive, studio_render
from .matrix_view import (
    display_cell,
    fit_frame,
    frame_width,
    is_upside_down_mount,
    is_vertical_mount,
    view_size,
    viewer_frame,
)
from .native_effect_preview import (
    render_music_flow_effect,
    render_native_effect,
)

_LOGGER = logging.getLogger(__name__)

# No limit per platform: every command to the lamp already waits for the
# previous one (the device lock, light_connection._execute_hardware_op).
PARALLEL_UPDATES = 0

# ── Matrix dimensions ──────────────────────────────────────────────────
# A frame is COLS x ROWS, or a Cube Matrix of more than 4 modules' width
# (5 columns a module: device_profile.width) x ROWS; the image shows them all.
COLS = 20
ROWS = 5
MODULE_SIZE = 5

# ── Image rendering parameters ────────────────────────────────────────
# The lamp drawn like the Lamp Preview card: a black frame with rounded
# corners and a soft shadow, on a transparent background (a dashboard's
# picture card shows its own background around it, whatever the fit). The
# design is a 16 px pixel, 3 px gap, 10 px padding, 14 px corners and a 6 px
# margin for the shadow, rendered RENDER_SCALE times larger so it stays sharp
# full width: 1227 x 372 px (372 x 1227 vertical) for 20 columns, 57 px more
# a column for a longer Cube Matrix (2367 x 372 for 8 modules). The frame, its shadow and
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


def _view_base(vertical: bool, width: int = COLS) -> Image.Image:
    """A view's empty image: the rounded black frame and its shadow (2 px
    down, 8 px blur, half opaque, as the Lamp Preview's) on transparency."""
    frame = _frame_size(*view_size(vertical, width))
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


def _view_rects(vertical: bool, width: int = COLS) -> list[tuple[int, int, int, int]]:
    """Each top-first pixel's rectangle in a landscape or vertical image
    (matrix_view.display_cell), built once (at import time for 20 columns) so
    _render_matrix does no arithmetic."""
    rects = []
    for index in range(width * ROWS):
        row, col = display_cell(index, vertical, width)
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

# The same for a longer Cube Matrix, by (live, vertical, width): built the
# first time one is drawn.
_WIDE_VIEWS: dict[tuple[bool, bool, int], tuple[Image.Image, list]] = {}
_WIDE_VIEWS_LOCK = threading.Lock()


def _views_for(vertical: bool, width: int, live: bool) -> tuple[Image.Image, list]:
    """The empty image and the pixels' rectangles of a view of a frame
    ``width`` columns wide (_VIEWS, _LIVE_VIEWS for 20)."""
    if width == COLS:
        return (_LIVE_VIEWS if live else _VIEWS)[bool(vertical)]
    key = (bool(live), bool(vertical), width)
    with _WIDE_VIEWS_LOCK:
        view = _WIDE_VIEWS.get(key)
        if view is None:
            base, rects = _view_base(bool(vertical), width), _view_rects(bool(vertical), width)
            if live:
                base = base.reduce(RENDER_SCALE)
                rects = [tuple(edge // RENDER_SCALE for edge in rect) for rect in rects]
            view = _WIDE_VIEWS[key] = (base, rects)
    return view


# ── A spot's and a panel's face ───────────────────────────────────────
# As the cards draw them (www/matrix-modules.js moduleLook), as filmed on the
# owner's lamp (2026-11-21): a spot is a square face with a recessed round
# bezel (about 87% of its width) and in it a round lens (60%) glowing in its
# colour, nearly white at the centre when bright, its colour at the rim, a
# soft halo on the bezel; unlit, a dark disc in the ring. A panel is one
# diffusing face, its 25 colours melted into each other edge to edge over a
# haze of their average; unlit, one dark face. Each covers its 5 x 5 area,
# square-cornered on the square camera, rounded on the round one.
_FACE = (30, 30, 33)
_PANEL_FACE = (17, 17, 19)
_RECESS = (17, 17, 19)
_LIT = 8
# Each module's masks by (size, rounded), built the first time one is drawn.
_FACE_MASKS: dict[tuple[int, bool], dict] = {}


def _ramp(points):
    """A piecewise linear profile of the distance from the centre (in half
    widths): ``points`` [(distance, value 0-1)], flat beyond the ends."""
    def profile(distance):
        if distance <= points[0][0]:
            return points[0][1]
        for (start, low), (end, high) in zip(points, points[1:]):
            if distance <= end:
                return low + (high - low) * (distance - start) / (end - start)
        return points[-1][1]
    return profile


def _radial_mask(size: int, profile) -> Image.Image:
    """A square coverage mask of ``size`` whose value follows ``profile`` of
    the distance from the centre in half widths (PIL's radial gradient: its
    value is that distance x 255 / sqrt 2), drawn twice as large and
    reduced (smooth edges)."""
    table = [round(255 * profile(value * math.sqrt(2) / 255)) for value in range(256)]
    distance = Image.radial_gradient("L").resize((size * 2, size * 2), Image.BILINEAR)
    return distance.point(table).resize((size, size), Image.LANCZOS)


def _face_masks(size: int, rounded: bool) -> dict:
    """The masks a spot and a panel of ``size`` are drawn with."""
    key = (size, rounded)
    with _WIDE_VIEWS_LOCK:
        masks = _FACE_MASKS.get(key)
    if masks is not None:
        return masks
    radius = round(size * 0.12 * _SUPERSAMPLE) if rounded else 0
    face = _smooth_mask(
        (size, size), lambda draw, box: draw.rounded_rectangle(box, radius=radius, fill=255)
    )
    line = max(1, size // 90)
    inner = _smooth_mask(
        (size, size),
        lambda draw, box: draw.rounded_rectangle(
            (box[0] + line * _SUPERSAMPLE, box[1] + line * _SUPERSAMPLE,
             box[2] - line * _SUPERSAMPLE, box[3] - line * _SUPERSAMPLE),
            radius=max(0, radius - line * _SUPERSAMPLE), fill=255,
        ),
    )
    masks = {
        "face": face,
        # The thin frame lining the face.
        "frame": ImageChops.subtract(face, inner),
        "recess": _radial_mask(size, _ramp([(0.795, 1), (0.81, 0)])),
        "ring_dark": _radial_mask(size, _ramp([(0.80, 0), (0.815, 1), (0.88, 1), (0.895, 0)])),
        "ring_light": _radial_mask(size, _ramp([(0.815, 0), (0.85, 1), (0.88, 0)])),
        "halo": _radial_mask(size, _ramp([(0.58, 0.75), (0.68, 0.3), (0.84, 0)])),
        "lens": _radial_mask(size, _ramp([(0.59, 1), (0.615, 0)])),
        # How much whiter than its colour the lens is: most at the centre.
        "hot": _radial_mask(size, _ramp([(0, 1), (0.30, 0.47), (0.52, 0)])),
        "dark_lens": _radial_mask(size, _ramp([(0.57, 1), (0.62, 0)])),
        "dark_rim": _radial_mask(size, _ramp([(0.57, 0), (0.60, 1), (0.62, 0)])),
    }
    with _WIDE_VIEWS_LOCK:
        _FACE_MASKS[key] = masks
    return masks


def _scaled(masks: dict, name: str, amount: float) -> Image.Image:
    """The mask ``name`` of ``masks`` at ``amount`` (0-1) of its coverage,
    in steps of 1/32, each made once (a frame is drawn in a few ms)."""
    step = max(0, min(32, round(amount * 32)))
    key = (name, step)
    scaled = masks.get(key)
    if scaled is None:
        scaled = masks[key] = masks[name].point(lambda value: round(value * step / 32))
    return scaled


def _mix(start: tuple, end: tuple, amount: float) -> tuple:
    return tuple(round(a + (b - a) * amount) for a, b in zip(start, end))


def _draw_spot(img: Image.Image, left: int, top: int, size: int, rgb: tuple, rounded: bool) -> None:
    """A spot's face at (left, top), ``size`` wide, lit in ``rgb``."""
    masks = _face_masks(size, rounded)
    at = (left, top)
    peak = max(rgb) / 255
    lit = max(rgb) > _LIT
    img.paste((*(_mix(_FACE, rgb, 0.12 * peak) if lit else _FACE), 255), at, masks["face"])
    img.paste((*(_mix(_RECESS, rgb, 0.18 * peak) if lit else _RECESS), 255), at, masks["recess"])
    img.paste((13, 13, 15, 255), at, masks["ring_dark"])
    img.paste((74, 74, 80, 255), at, masks["ring_light"])
    if not lit:
        img.paste((9, 9, 10, 255), at, masks["dark_lens"])
        img.paste((46, 46, 51, 255), at, masks["dark_rim"])
    else:
        img.paste((*rgb, 255), at, _scaled(masks, "halo", peak))
        img.paste((*rgb, 255), at, masks["lens"])
        img.paste((255, 255, 255, 255), at, _scaled(masks, "hot", 0.85 * peak * peak))
    img.paste((255, 255, 255, 255), at, _scaled(masks, "frame", 0.08))


# A panel is drawn on a small square, then scaled up smoothly: each lit
# pixel a soft blotch at its place (1.5 pixels in radius, full for its first
# quarter), lightened over the others and over the haze, as the cards draw
# it (www/matrix-modules.js panelBackground). The blotches' masks, once.
_PANEL_SIZE = 60
_BLOTCHES: list[Image.Image] = []


def _blotch(at: int) -> Image.Image:
    """The mask of pixel ``at``'s blotch (row by row) on the small square."""
    with _WIDE_VIEWS_LOCK:
        if not _BLOTCHES:
            profile = _ramp([(0.25, 1), (1, 0)])
            # A blotch of 30% of the panel's width in radius, on its cell.
            blotch = _radial_mask(_PANEL_SIZE * 3 // 5, profile)
            reach = blotch.width // 2
            for index in range(MODULE_SIZE * MODULE_SIZE):
                x = round((index % MODULE_SIZE + 0.5) * _PANEL_SIZE / MODULE_SIZE)
                y = round((index // MODULE_SIZE + 0.5) * _PANEL_SIZE / MODULE_SIZE)
                mask = Image.new("L", (_PANEL_SIZE, _PANEL_SIZE), 0)
                mask.paste(blotch, (x - reach, y - reach))
                _BLOTCHES.append(mask)
        return _BLOTCHES[at]


def _draw_panel(img: Image.Image, left: int, top: int, size: int, colours: list, rounded: bool) -> None:
    """A panel's face at (left, top), ``size`` wide: its 25 colours (row by
    row as shown) melted together over a haze of their average."""
    masks = _face_masks(size, rounded)
    at = (left, top)
    lit = [rgb for rgb in colours if max(rgb) > _LIT]
    if not lit:
        img.paste((*_PANEL_FACE, 255), at, masks["face"])
    else:
        # Their average at 3/4 (www/matrix-modules.js HAZE).
        haze = tuple(round(sum(rgb[channel] for rgb in colours) / len(colours) * 0.75) for channel in range(3))
        if max(haze) < max(_PANEL_FACE):
            haze = _PANEL_FACE
        small = Image.new("RGB", (_PANEL_SIZE, _PANEL_SIZE), haze)
        for index, rgb in enumerate(colours):
            if max(rgb) <= _LIT:
                continue
            colour = Image.new("RGB", small.size, tuple(rgb))
            small = Image.composite(ImageChops.lighter(small, colour), small, _blotch(index))
        img.paste(small.resize((size, size), Image.BILINEAR), at, masks["face"])
    img.paste((255, 255, 255, 255), at, _scaled(masks, "frame", 0.14))


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
    light_entity.attach_cameras([cam_square, cam_round])
    async_add_entities([cam_square, cam_round])
    _LOGGER.debug(
        "Matrix preview cameras (square + round) created for %s",
        light_entity.lamp_name,
    )


# ── Base camera ────────────────────────────────────────────────────────

def _chosen_intensity(state) -> int:
    """The intensity chosen for the effects (1-255): lamp_settings gives it
    only to those that read it, as light_native sends it."""
    return int(state.native_effect_intensity)

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
        self._attr_unique_id = f"{light_entity.unique_id}{self._UID_SUFFIX}"
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
        # The light tells its cameras of new frames (light.attach_cameras,
        # set up with them) until this one is removed.
        self.async_on_remove(lambda: self._light_entity.detach_camera(self))

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        # Renamed in place (Home Assistant 2026.11+): nothing here is keyed on
        # the entity id, so it keeps running as it is.
        super().async_entity_id_changed(old_entity_id)

    # ── New frame (called by the light entity) ─────────────────────────
    @callback
    def async_refresh_preview(self) -> None:
        """The lamp shows something new: drop the image and give the frontend
        a new address (entity_picture), so a viewer fetches it. Rendered on
        demand only (async_camera_image): nobody watching costs nothing, and
        a fetch always draws the lamp's latest frame."""
        self._cached_image = None
        self._image_generation += 1
        self.async_write_ha_state()

    @property
    def entity_picture(self) -> str:
        """The image's address with the frame it shows: each new frame is a
        new address. The access token is not replaced per frame: Home
        Assistant accepts only its last two, so during a fast scroll a viewer
        fetching with the one before was refused (403); Home Assistant
        renews it itself every few minutes."""
        return f"{super().entity_picture}&frame={self._image_generation}"

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
        orientation = self._state().orientation
        vertical = is_vertical_mount(orientation) and bool(
            self._config_entry.options.get(CONF_CAMERA_FOLLOWS_ORIENTATION, False)
        )
        live = self._live_streams > 0 and self._shows_lamp_renderer()
        colors = self._get_matrix_colors()
        return viewer_frame(colors, orientation), vertical, live

    def _state(self, state=None):
        """The light's state a frame is drawn from (light_actions.
        preview_state), read once per frame: the one given, or read now."""
        return state if state is not None else self._light_entity.preview_state()

    def _columns(self, state=None) -> int | None:
        """The columns the lamp shows, which its effects are drawn on, as it
        draws them (device_profile.columns; None: all 20)."""
        return self._state(state).columns

    def _width(self, state=None) -> int:
        """The columns of the lamp's frames (device_profile.width): 20, or
        a Cube Matrix of more than 4 modules' (5 a module)."""
        try:
            columns = int(self._columns(state) or COLS)
        except (TypeError, ValueError):
            columns = COLS
        return max(COLS, columns)

    def _face_columns(self) -> list[tuple[str, int]]:
        """Each spot and panel the lamp shows (device_profile.layout), as
        (type, its first lamp column): one face each over its 5 columns (a
        spot one light), none for a Cube Lite."""
        profile = getattr(self._light_entity, "device_profile", None)
        layout = getattr(profile, "layout", None)
        if not isinstance(layout, list):
            return []
        return [
            (module["type"], module["column"]) for module in layout
            if isinstance(module, dict) and module.get("type") in ("spot", "panel")
            and isinstance(module.get("column"), int)
        ]

    def _is_native_preview_mode(self) -> bool:
        """Return whether the preview changes without an HA state update."""
        return self._light_entity.mode in LAMP_MODES

    def _shows_lamp_renderer(self, state=None) -> bool:
        """Whether the lamp shows an effect drawn by its own renderer (as the
        preview reproduces it), alone or behind the clock."""
        state = self._state(state)
        if state.music_flow_enabled:
            return False
        mode = state.mode
        if mode == MODE_NATIVE_EFFECT:
            effect = state.native_effect
        elif mode == MODE_CLOCK:
            style = NATIVE_CLOCK_STYLES.get(
                int(state.clock_style),
                NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
            )
            effect = clock_style_effect(style)
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
        state = self._state()
        width = self._width(state)
        pixels = width * ROWS
        if not state.is_on:
            return [(0, 0, 0)] * pixels

        mode = state.mode
        # A streamed effect or clock: the very frame the lamp was last sent
        # (light_studio.streamed_preview_frame, already in screen colours),
        # not this camera's own drawing of it (its own start and seeds).
        streamed = getattr(self._light_entity, "streamed_preview_frame", None)
        streamed = streamed() if callable(streamed) else None
        if streamed is not None and len(streamed) == pixels:
            base = streamed
        elif state.music_flow_enabled:
            base = self._get_music_flow_preview(state)
        elif mode == MODE_CLOCK:
            base = self._get_clock_preview(state)
        elif mode == MODE_NATIVE_EFFECT:
            # Compensated for the lamp's mount profile (light_native): drawn
            # as calibrated, whatever the lamp's own direction setting.
            base = self._get_native_effect_preview(state)
        else:
            base = state.base_matrix_colors
        if base and len(base) != pixels and frame_width(len(base)) * ROWS == len(base):
            # Drawn for another width (20-column content on a longer Cube
            # Matrix): from column 0, the rest dark.
            base = fit_frame(list(base), width)
        if not base or len(base) != pixels:
            return [(0, 0, 0)] * pixels
        # The lamp renderer's frame is LED drive: shown as those LEDs look.
        # Display only (simulated_lamp_frame keeps the lamp's values).
        if streamed is None and self._shows_lamp_renderer(state):
            base = [led_appearance(rgb) for rgb in base]

        # --- Compute the effective multiplier (same net result as JS) ---
        brightness = state.brightness or 255
        t = brightness / 255.0                                  # 0..1
        effective = _FLOOR + (1 - _FLOOR) * math.pow(t, _PREVIEW_BRIGHTNESS_GAMMA)

        # --- Apply effective per pixel ---
        result: list[tuple] = []
        for rgb in base:
            try:
                r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
            except (TypeError, ValueError, IndexError):  # not a colour
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
        state = self._state()
        if state.music_flow_enabled:
            return self._get_music_flow_preview(state)
        mode = state.mode
        if mode == MODE_CLOCK:
            return self._get_clock_preview(state)
        if mode == MODE_NATIVE_EFFECT:
            return self._get_native_effect_preview(state)
        return None

    def _preview_speed(self, state=None) -> int:
        """The rate the lamp gets (1-255), which previews take as it is."""
        return max(0, min(255, int(self._state(state).native_effect_speed)))

    def _get_native_effect_preview(self, state=None) -> list[tuple[int, int, int]]:
        """The active built-in animation as the lamp draws it: LED drive for an
        effect the lamp renders (render_native_effect)."""
        le = self._light_entity
        state = self._state(state)
        speed = self._preview_speed(state)
        effect = state.native_effect
        direction = state.native_effect_direction
        orientation = state.orientation
        with self._preview_lock:
            now = _time.monotonic()
            animation_key = (effect, direction, orientation)
            if animation_key != self._native_preview_key:
                self._native_preview_key = animation_key
                self._native_preview_started_at = now
                self._frozen_background_seconds = None
            # While frozen, hold the frame the lamp is holding; resume seamlessly.
            if state.display_frozen:
                if self._frozen_background_seconds is None:
                    self._frozen_background_seconds = now - self._native_preview_started_at
                seconds = self._frozen_background_seconds
            else:
                if self._frozen_background_seconds is not None:
                    self._native_preview_started_at = now - self._frozen_background_seconds
                    self._frozen_background_seconds = None
                seconds = now - self._native_preview_started_at
        frame = render_native_effect(
            effect,
            seconds * (0.25 + speed / 55.0),
            direction,
            color_mode=state.native_effect_color_mode,
            color_override=state.native_effect_color,
            speed=speed,
            orientation=orientation,
            intensity=_chosen_intensity(state),
            palette=state.text_colors,
            stored=state.stored_gif,
            layout=state.animation_layout,
            # An animation is uploaded with them (light_native._store_animation).
            adjustments=le.color_adjustments() if hasattr(le, "color_adjustments") else None,
            columns=self._columns(state),
        )
        # Lamp order (row 0 = physical bottom), like every frame: _view_frame
        # turns it the way the viewer sees it, once.
        return frame

    def _get_music_flow_preview(self, state=None) -> list[tuple[int, int, int]]:
        """Render a fixed illustration of the active Music Flow effect."""
        return render_music_flow_effect(self._state(state).music_flow_effect)

    def _get_clock_preview(self, state=None) -> list[tuple[int, int, int]]:
        """Render the active built-in clock face into the lamp's frame (20 x
        5, or a longer Cube Matrix's width x 5): its digits (clock_face, as
        the lamp lays them out: on its 5 x 5 blocks, never a spot) showing the
        style's color, or its background effect through them."""
        state = self._state(state)
        text, colon_visible = clock_text(
            dt_util.now(), state.clock_content,
            bool(state.clock_12_hour),
            bool(state.clock_colon_blink),
        )
        style_id = int(state.clock_style)
        width = self._width(state)
        matrix = [(0, 0, 0)] * (width * ROWS)

        # Styles whose mixer is a native effect show that effect through the lit
        # glyph pixels; render it once and mask it below. Others use the
        # solid/gradient color.
        style = NATIVE_CLOCK_STYLES.get(
            style_id, NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE]
        )
        # A color override (ARGB int): sent to the mixer's renderer, which takes
        # it or not as on the lamp; a style with no effect shows it flat.
        override_int = state.clock_color
        override_rgb = (
            (
                (override_int >> 16) & 255,
                (override_int >> 8) & 255,
                override_int & 255,
            )
            if override_int is not None
            else None
        )
        effect_name = clock_style_effect(style)
        # A palette color mode (e.g. B&W) takes precedence over the override.
        color_mode = state.clock_color_mode or "normal"
        palette = state.text_colors
        # Palette with more colors than the background takes on the lamp:
        # streamed, the background recolored in the whole palette (light_studio).
        streamed = clock_studio_runs(effect_name, color_mode, palette)
        if color_mode == PALETTE_COLOR_MODE and not streamed:
            # The palette's first color on a plain style; its colors on a
            # background that takes them (lamp_clock_settings); else normal.
            words = clock_palette_words(effect_name, palette)
            if effect_name is None and words:
                override_rgb = (words[0] >> 16 & 255, words[0] >> 8 & 255, words[0] & 255)
            if not words:
                color_mode = "normal"
        mode_active = color_mode not in ("normal", PALETTE_COLOR_MODE)
        effect_frame = None
        if streamed:
            effect_frame = studio_drive(studio_clock_background_at(
                effect_name, studio_render(self._clock_background_seconds(state)),
                self._preview_speed(state), _chosen_intensity(state), palette,
                clock_style_direct(style), columns=self._columns(state),
            ))
        elif effect_name is not None:
            # The mixer's renderer behind the clock overlay, on the command
            # light_native sends: the user's speed, the mode 40 direction.
            effect_frame = lamp_effect_frame(
                lamp_clock_settings(
                    effect_name, self._preview_speed(state), override_rgb, color_mode,
                    _chosen_intensity(state), palette,
                    # Handed over or direct: the style's form, as light_native sends it.
                    clock_style_direct(style), self._columns(state),
                ),
                self._clock_background_seconds(state),
            )
        # A palette mode overrides the custom color, so don't flat-fill with it.
        flat_override = None if mode_active else override_rgb
        # Solid styles (no mixer effect) have no animated renderer to remap for
        # B&W; the backend achieves it by omitting their color, which the
        # lamp renders as plain white.
        solo_bw_fallback = effect_frame is None and color_mode == "bw"
        # Where the lamp draws each digit pixel: a background started directly
        # may turn or mirror them (lamp_renderers.clock_digit_flags); on a
        # mount profile that turns the clock (light_mount_profile.
        # lamp_turns_clock), the lamp lays the text out a half turn round; the
        # background stays where it is on the panel.
        digit_flags = clock_digit_flags(style.get("mixer", 0), clock_style_direct(style))
        turned = bool(state.lamp_turns_clock)
        # Within the columns the lamp shows (a Cube Matrix with fewer than 4
        # blocks streams this frame: device_profile.columns), on its blocks
        # (a spot's columns left to the background: clock_geometry).
        geometry = self._clock_geometry(state)
        for index, char_index, col in clock_digit_pixels(text, colon_visible, digit_flags, turned, **geometry):
            if not 0 <= index < len(matrix):
                continue
            if effect_frame is not None:
                matrix[index] = effect_frame[index] if index < len(effect_frame) else (0, 0, 0)
            elif solo_bw_fallback:
                matrix[index] = (255, 255, 255)
            elif flat_override is not None:
                matrix[index] = flat_override
            else:
                matrix[index] = self._clock_pixel_color(style_id, char_index, col, width)

        # Lamp order, like every frame (_view_frame turns it for the viewer).
        return matrix

    def _clock_geometry(self, state=None) -> dict:
        """Where the lamp shows the clock (clock_face.clock_geometry: its
        columns, its frame's width, its blocks' columns)."""
        profile = getattr(self._light_entity, "device_profile", None)
        columns = self._columns(state) or COLS
        if profile is not None and getattr(profile, "columns", None) == columns:
            return clock_geometry(profile)
        return {"columns": columns, "width": max(COLS, columns), "blocks": None}

    def _clock_background_seconds(self, state=None) -> float:
        """Seconds into the clock's background animation. While frozen it holds
        the frame the lamp is holding; the clock digits/colon (rendered from
        real time) still advance. Anchored to the freeze instant so the frozen
        frame is exact; resumes seamlessly from it."""
        state = self._state(state)
        with self._preview_lock:
            now = _time.monotonic()
            if self._clock_preview_started_at is None:
                self._clock_preview_started_at = now
            if state.display_frozen:
                if self._frozen_background_seconds is None:
                    frozen_at = state.display_frozen_at
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
        width: int = COLS,
    ) -> tuple[int, int, int]:
        """Approximate the official clock preview palette for one LED (its
        frame column ``col`` of ``width``: the palette runs along the frame)."""
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
            col / (max(COLS, width) - 1),
        )

    def _face_view_columns(self, width: int) -> list[tuple[str, int]]:
        """Each spot's and panel's type and first column in the viewer's
        frame (_view_frame: turned a half turn for an upside-down mount),
        those within the frame."""
        faces = self._face_columns()
        if not faces:
            return []
        upside_down = is_upside_down_mount(self._state().orientation)
        starts = [
            (kind, width - MODULE_SIZE - column if upside_down else column) for kind, column in faces
        ]
        return [(kind, start) for kind, start in starts if 0 <= start and start + MODULE_SIZE <= width]

    # Square corners for a spot's and a panel's face (the round camera's
    # are rounded).
    _ROUNDED_FACES = False

    # Subclass must implement
    def _draw_pixel(self, img: Image.Image, draw: ImageDraw.Draw, rect: tuple, fill: tuple) -> None:
        raise NotImplementedError

    def _render_matrix(
        self, colors: list[tuple], vertical: bool = False, live: bool = False
    ) -> bytes:
        """Render a top-first frame (_view_frame) landscape or vertical,
        full size or small for a live stream, and return lossless PNG bytes
        (RGBA: transparent around the frame). As wide as the frame (20
        columns, or a longer Cube Matrix's); each spot and panel one face
        over its 5 x 5 area (_draw_spot in its colour, device_profile.
        _spot_colour; _draw_panel), as the cards draw them."""
        width = frame_width(len(colors))
        base, rects = _views_for(bool(vertical), width, live)
        img = base.copy()
        draw = ImageDraw.Draw(img)

        face_cells: set[int] = set()
        faces = self._face_view_columns(width)
        pixels = [
            tuple(int(channel) for channel in pixel[:3])
            if isinstance(pixel, (tuple, list)) and len(pixel) >= 3 else (0, 0, 0)
            for pixel in colors
        ] if faces else []
        for kind, start in faces:
            area = [row * width + start + step for row in range(ROWS) for step in range(MODULE_SIZE)]
            if area[-1] >= len(rects):
                continue
            face_cells.update(area)
            boxes = [rects[index] for index in area]
            left, top = min(box[0] for box in boxes), min(box[1] for box in boxes)
            right, bottom = max(box[2] for box in boxes), max(box[3] for box in boxes)
            size = min(right - left, bottom - top)
            if kind == "spot":
                _draw_spot(img, left, top, size, _spot_colour(pixels, start, width), self._ROUNDED_FACES)
                continue
            # The panel's colours row by row as the view shows them (a
            # vertical one turned): its pixels by their place in the image.
            cells = sorted(area, key=lambda index: (rects[index][1], rects[index][0]))
            _draw_panel(
                img, left, top, size, [pixels[index] if index < len(pixels) else (0, 0, 0) for index in cells],
                self._ROUNDED_FACES,
            )

        for i, rgb in enumerate(colors):
            if i >= len(rects) or i in face_cells:
                continue
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
    _ROUNDED_FACES = True

    def _draw_pixel(self, img, draw, rect, fill):
        if rect[2] - rect[0] < PIXEL_SIZE:
            img.paste(fill, rect[:2], _LIVE_DOT_MASK)
            return
        img.paste(fill, rect[:2], _DOT_MASK)
