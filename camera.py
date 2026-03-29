"""Camera platform for Yeelight Cube Lite - live matrix preview on HA device page.

Two camera entities per lamp:
  • **Square** — fast rendering with rectangles, ideal for dashboards.
  • **Round**  — prettier rendering with ellipses (LED-style circles).
"""

import io
import logging
import math
import time as _time

from PIL import Image, ImageDraw  # type: ignore

from homeassistant.components.camera import Camera  # type: ignore
from homeassistant.config_entries import ConfigEntry  # type: ignore
from homeassistant.core import HomeAssistant, callback  # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback  # type: ignore

from .const import DOMAIN, CONF_IP

_LOGGER = logging.getLogger(__name__)

# ── Matrix dimensions ──────────────────────────────────────────────────
COLS = 20
ROWS = 5

# ── Image rendering parameters ────────────────────────────────────────
PIXEL_SIZE = 20
PIXEL_GAP = 4
PADDING = 12
CELL_SIZE = PIXEL_SIZE + PIXEL_GAP               # 24
IMG_WIDTH = PADDING * 2 + COLS * CELL_SIZE - PIXEL_GAP   # 500
IMG_HEIGHT = PADDING * 2 + ROWS * CELL_SIZE - PIXEL_GAP  # 140

# ── Pre-computed pixel coordinates (row, col) → (x0, y0, x1, y1) ─────
# Built once at import time so _render_matrix does zero arithmetic.
_PIXEL_RECTS_NORMAL: list[list[tuple[int, int, int, int]]] = []
_PIXEL_RECTS_FLIPPED: list[list[tuple[int, int, int, int]]] = []
for _r in range(ROWS):
    _row_n: list[tuple[int, int, int, int]] = []
    _row_f: list[tuple[int, int, int, int]] = []
    for _c in range(COLS):
        # Normal orientation: lamp row 0 = physical bottom → image bottom
        _dr_n = ROWS - 1 - _r
        _dc_n = _c
        _x = PADDING + _dc_n * CELL_SIZE
        _y = PADDING + _dr_n * CELL_SIZE
        _row_n.append((_x, _y, _x + PIXEL_SIZE, _y + PIXEL_SIZE))

        # Flipped orientation: 180° rotation
        _dr_f = _r
        _dc_f = COLS - 1 - _c
        _x2 = PADDING + _dc_f * CELL_SIZE
        _y2 = PADDING + _dr_f * CELL_SIZE
        _row_f.append((_x2, _y2, _x2 + PIXEL_SIZE, _y2 + PIXEL_SIZE))
    _PIXEL_RECTS_NORMAL.append(_row_n)
    _PIXEL_RECTS_FLIPPED.append(_row_f)

# Flatten for linear indexing (index = row * COLS + col)
_RECTS_NORMAL = [r for row in _PIXEL_RECTS_NORMAL for r in row]
_RECTS_FLIPPED = [r for row in _PIXEL_RECTS_FLIPPED for r in row]


# ── Perceptual brightness boost (must match JS draw_card_const.js) ─────
# LCD screens look dimmer than real LEDs at the same RGB value.
# The JS lamp-preview card applies a boost curve to compensate.
# We replicate the exact same formula here so both previews match.
_PREVIEW_MIN_BRIGHTNESS_BOOST = 8.0
_PREVIEW_MAX_DARKEN_PERCENT = 94
_PREVIEW_BRIGHTNESS_GAMMA = 1.35
_MIN_FACTOR = 1 - _PREVIEW_MAX_DARKEN_PERCENT / 100       # 0.06
_FLOOR = _PREVIEW_MIN_BRIGHTNESS_BOOST * _MIN_FACTOR       # 0.48


# ── Platform setup ─────────────────────────────────────────────────────
async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up both matrix preview camera entities (square + round)."""
    data = hass.data[DOMAIN].get(entry.entry_id, {})
    light_entity = data.get("light")
    if not light_entity:
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
        light_entity._attr_name,
    )


# ── Base camera ────────────────────────────────────────────────────────
class _YeelightCubeMatrixCameraBase(Camera):
    """Abstract base for the 20×5 LED matrix live-preview cameras.

    Subclasses override ``_draw_pixel()`` to choose rectangle vs ellipse.
    """

    # Subclass MUST set these in __init__
    _SUFFIX: str          # e.g. " (Square)"
    _UID_SUFFIX: str      # e.g. "_matrix_preview_square"

    def __init__(self, light_entity, config_entry: ConfigEntry) -> None:
        super().__init__()
        self._light_entity = light_entity
        self._config_entry = config_entry
        self._attr_name = f"{light_entity._attr_name} Matrix Preview{self._SUFFIX}"
        self._attr_unique_id = f"{light_entity._attr_unique_id}{self._UID_SUFFIX}"
        self._attr_icon = "mdi:led-strip-variant"
        self._attr_is_streaming = False
        self._attr_frame_interval = 1
        self._attr_content_type = "image/png"
        self._cached_image: bytes | None = None

    # ── Device grouping ────────────────────────────────────────────────
    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._light_entity._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }

    # ── Lifecycle ──────────────────────────────────────────────────────
    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._pre_render()

    # ── Direct push (called by light entity) ───────────────────────────
    @callback
    def async_refresh_preview(self) -> None:
        _t0 = _time.time()
        self._pre_render()
        _t1 = _time.time()
        self.async_update_token()
        self.async_write_ha_state()
        _LOGGER.warning(
            f"[TIMING] camera{self._SUFFIX} async_refresh_preview: "
            f"render={(_t1 - _t0)*1000:.1f}ms "
            f"total={(_time.time() - _t0)*1000:.1f}ms"
        )

    # ── Image serving ──────────────────────────────────────────────────
    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return the full-size PNG.  Browser handles display scaling."""
        if self._cached_image is None:
            self._pre_render()
        return self._cached_image

    def camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        if self._cached_image is None:
            self._pre_render()
        return self._cached_image

    # ── Internal helpers ───────────────────────────────────────────────
    def _pre_render(self) -> None:
        colors = self._get_matrix_colors()
        self._cached_image = self._render_matrix(colors)

    def _get_matrix_colors(self) -> list[tuple]:
        """Get brightness-corrected matrix colours with perceptual boost.

        The JS lamp-preview card receives *darkened* pixel values (via
        ``matrix_colors`` in state attributes) and applies:

            boost = effective / darkenFactor

        This effectively cancels the darken and replaces it with the
        perceptual curve, so the net result on the *original* base color is:

            final = base_pixel × effective

        Since we read ``_base_matrix_colors`` directly (NOT darkened), we
        skip the ``/ darkenFactor`` and just multiply by ``effective``.

            effective = FLOOR + (1 - FLOOR) × (brightness/255)^GAMMA
            pixel     = min(255, round(v × effective))
        """
        le = self._light_entity
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

    # Subclass must implement
    def _draw_pixel(self, draw: ImageDraw.Draw, rect: tuple, fill: tuple) -> None:
        raise NotImplementedError

    def _render_matrix(self, colors: list[tuple]) -> bytes:
        """Render the 20×5 matrix and return lossless PNG bytes (~4 KB)."""
        img = Image.new("RGB", (IMG_WIDTH, IMG_HEIGHT), (0, 0, 0))
        draw = ImageDraw.Draw(img)

        flipped = getattr(self._light_entity, "_orientation", None) == "flipped"
        rects = _RECTS_FLIPPED if flipped else _RECTS_NORMAL

        for i, rgb in enumerate(colors):
            if isinstance(rgb, (tuple, list)) and len(rgb) >= 3:
                r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
                if r == 0 and g == 0 and b == 0:
                    continue
            else:
                continue
            self._draw_pixel(draw, rects[i], (r, g, b))

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


# ── Square-pixel camera ───────────────────────────────────────────────
class YeelightCubeMatrixCameraSquare(_YeelightCubeMatrixCameraBase):
    """Fast preview using square (rectangle) pixels."""

    _SUFFIX = " (Square)"
    _UID_SUFFIX = "_matrix_preview_square"

    def _draw_pixel(self, draw, rect, fill):
        draw.rectangle(rect, fill=fill)


# ── Round-pixel camera ────────────────────────────────────────────────
class YeelightCubeMatrixCameraRound(_YeelightCubeMatrixCameraBase):
    """Prettier preview using round (ellipse) pixels resembling LEDs."""

    _SUFFIX = " (Round)"
    _UID_SUFFIX = "_matrix_preview_round"

    def _draw_pixel(self, draw, rect, fill):
        draw.ellipse(rect, fill=fill)
