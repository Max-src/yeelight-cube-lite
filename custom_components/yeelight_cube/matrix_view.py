"""How the matrix looks to someone facing the lamp (the preview cameras).

Mirrors www/matrix-view.js, used by every card preview; see it for the
conventions. In short: a lamp-order frame (row 0 = the lamp's bottom row, as
the plugin and matrix_colors hold it) is shown top-first, turned a half turn
for the upside-down mounts (left / up), and a vertical view (down / up) is
that landscape picture turned a quarter turn clockwise, its left end on top.

A frame is ``width`` columns wide and 5 high: 20, or a Cube Matrix of more
than 4 modules' columns (5 a module, up to MAX_COLS: device_profile.width);
its width follows its length (frame_width).
"""
from __future__ import annotations

from .const import (
    DEVICE_ORIENTATION_TO_FLIP,
    ORIENTATION_FLIPPED,
    VERTICAL_DEVICE_ORIENTATIONS,
)

COLS = 20
ROWS = 5
# The widest frame: 8 modules of 5 columns (device_profile.MAX_COLS).
MAX_COLS = 40


def frame_width(length: int) -> int:
    """The columns of a frame of ``length`` pixels: 20, or width x 5 for a
    longer Cube Matrix (21 to MAX_COLS columns)."""
    width, rest = divmod(int(length or 0), ROWS)
    return width if not rest and COLS < width <= MAX_COLS else COLS


def fit_frame(frame: list, width: int, blank=(0, 0, 0)) -> list:
    """A lamp-order frame on a panel ``width`` columns wide: one of another
    width (20-column content on a longer Cube Matrix) placed from column 0,
    the rest ``blank``; a wider one cropped. The frame itself when it fits."""
    source = frame_width(len(frame))
    if source == width:
        return frame
    out = []
    for row in range(ROWS):
        for column in range(width):
            index = row * source + column
            out.append(frame[index] if column < source and index < len(frame) else blank)
    return out


def is_vertical_mount(orientation: str | None) -> bool:
    """Whether the lamp stands on one end (down / up)."""
    return orientation in VERTICAL_DEVICE_ORIENTATIONS


def is_upside_down_mount(orientation: str | None) -> bool:
    """Whether the lamp is turned a half turn from its default (left / up)."""
    return DEVICE_ORIENTATION_TO_FLIP.get(orientation) == ORIENTATION_FLIPPED


def viewer_frame(frame: list, orientation: str | None) -> list:
    """A lamp-order frame as the viewer sees it: top-first and landscape,
    turned a half turn for upside-down mounts (its width: frame_width)."""
    width = frame_width(len(frame))
    top_first = [
        pixel
        for row in range(ROWS - 1, -1, -1)
        for pixel in frame[row * width:(row + 1) * width]
    ]
    return top_first[::-1] if is_upside_down_mount(orientation) else top_first


def view_size(vertical: bool, width: int = COLS) -> tuple[int, int]:
    """(columns, rows) of a landscape or vertical view of a frame ``width``
    columns wide."""
    return (ROWS, width) if vertical else (width, ROWS)


def display_cell(index: int, vertical: bool, width: int = COLS) -> tuple[int, int]:
    """(row, column) where a view shows the top-first pixel ``index`` of a
    frame ``width`` columns wide."""
    row, col = divmod(index, width)
    if vertical:
        # Matrix column -> display row; the bottom row on the left.
        return col, ROWS - 1 - row
    return row, col
