"""How the 20x5 matrix looks to someone facing the lamp (the preview cameras).

Mirrors www/matrix-view.js, used by every card preview; see it for the
conventions. In short: a lamp-order frame (row 0 = the lamp's bottom row, as
the plugin and matrix_colors hold it) is shown top-first, turned a half turn
for the upside-down mounts (left / up), and a vertical view (down / up) is
that landscape picture turned a quarter turn clockwise, its left end on top.
"""
from __future__ import annotations

from .const import (
    DEVICE_ORIENTATION_TO_FLIP,
    ORIENTATION_FLIPPED,
    VERTICAL_DEVICE_ORIENTATIONS,
)

COLS = 20
ROWS = 5


def is_vertical_mount(orientation: str | None) -> bool:
    """Whether the lamp stands on one end (down / up)."""
    return orientation in VERTICAL_DEVICE_ORIENTATIONS


def is_upside_down_mount(orientation: str | None) -> bool:
    """Whether the lamp is turned a half turn from its default (left / up)."""
    return DEVICE_ORIENTATION_TO_FLIP.get(orientation) == ORIENTATION_FLIPPED


def viewer_frame(frame: list, orientation: str | None) -> list:
    """A lamp-order frame as the viewer sees it: top-first and landscape,
    turned a half turn for upside-down mounts."""
    top_first = [
        pixel
        for row in range(ROWS - 1, -1, -1)
        for pixel in frame[row * COLS:(row + 1) * COLS]
    ]
    return top_first[::-1] if is_upside_down_mount(orientation) else top_first


def view_size(vertical: bool) -> tuple[int, int]:
    """(columns, rows) of a landscape or vertical view."""
    return (ROWS, COLS) if vertical else (COLS, ROWS)


def display_cell(index: int, vertical: bool) -> tuple[int, int]:
    """(row, column) where a view shows the top-first pixel ``index``."""
    row, col = divmod(index, COLS)
    if vertical:
        # Matrix column -> display row; the bottom row on the left.
        return col, ROWS - 1 - row
    return row, col
