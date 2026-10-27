"""Built-in Cube Lite pixel art extracted from the official Yeelight app."""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path


_PRESET_DIR = Path(__file__).parent / "presets"


def _argb_to_rgb(value: int) -> list[int]:
    """Convert the app's unsigned ARGB integer to an RGB triplet."""
    return [(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]


_COLS = 20
_ROWS = 5

# The app's two collections of each gallery (groups "0" and "1" of its
# recommendation files). The app's own labels are translated strings not in
# the extracted assets: these names follow the pictures (objects, plants and
# animals; stripes, zigzags and fills).
COLLECTIONS = {"0": "Nature", "1": "Geometry"}


def _official_pos_to_lamp_pos(position: int) -> int:
    """Convert an official-app pixel index to a lamp position.

    The official Yeelight app serialises its recommended pixel art
    COLUMN-MAJOR on the 20x5 display: index 0 is the top-left pixel, then it
    walks DOWN each column (5 pixels) before moving to the next column. So the
    official index encodes ``i = col * ROWS + row``.

    The component's matrix is addressed ROW-MAJOR (``pos = row * COLS + col``).
    Converting between the two is a transpose:

        row = i % ROWS
        col = i // ROWS
        pos = row * COLS + col = (i % 5) * 20 + (i // 5)

    Verified against known-good hardware captures (e.g. "Magic Lamp": official
    index 47 -> position 49, 57 -> 51; "Bat": 43 -> 68, 58 -> 71).
    """
    row = position % _ROWS
    col = position // _ROWS
    return row * _COLS + col


# The Yeelight app's custom id for a built-in pixel art it shows on the lamp:
# APP_PIXEL_ART_BASE + (group + 1) * 100 + item, the group and item keys of
# its gallery file (the horizontal one for a lamp set Left or Right in the
# app, else the vertical one). Read in the app's decompile
# (pixel_art_preset_model.dart).
APP_PIXEL_ART_BASE = 0x40000000


@lru_cache(maxsize=2)
def _load_gallery(filename: str) -> dict:
    """An official gallery file: {group: {item: JSON list of 100 ARGB}}."""
    with (_PRESET_DIR / filename).open(encoding="utf-8") as preset_file:
        return json.load(preset_file)


def app_pixel_art_argb(custom_id: int, vertical: bool) -> list[int] | None:
    """The 100 ARGB pixels, in the app's order, of the built-in pixel art the
    Yeelight app shows under ``custom_id``; None when it is none."""
    group, item = divmod(custom_id - APP_PIXEL_ART_BASE, 100)
    if group < 1:
        return None
    gallery = _load_gallery("vertical.json" if vertical else "horizontal.json")
    picture = gallery.get(str(group - 1), {}).get(str(item))
    return json.loads(picture) if picture is not None else None


@lru_cache(maxsize=1)
def get_builtin_pixel_arts() -> tuple[dict, ...]:
    """Load the official horizontal and vertical recommendation galleries:
    ``name`` (read-only), ``collection`` (COLLECTIONS), ``orientation``
    ("horizontal", or "vertical": drawn for a lamp stood on its end) and flat
    ``pixels``."""
    result = []
    for orientation, filename in (
        ("Horizontal", "horizontal.json"),
        ("Vertical", "vertical.json"),
    ):
        groups = _load_gallery(filename)

        index = 1
        for group_key in sorted(groups, key=int):
            for item_key in sorted(groups[group_key], key=int):
                argb_pixels = json.loads(groups[group_key][item_key])
                pixels = [
                    {
                        "position": _official_pos_to_lamp_pos(position),
                        "color": _argb_to_rgb(argb),
                    }
                    for position, argb in enumerate(argb_pixels)
                    if argb
                ]
                result.append(
                    {
                        "name": f"Built-in: {orientation} {index:02d}",
                        "collection": COLLECTIONS.get(group_key, "Official"),
                        "orientation": orientation.lower(),
                        "pixels": pixels,
                    }
                )
                index += 1
    return tuple(result)


@lru_cache(maxsize=1)
def get_builtin_pixel_art_map() -> dict[str, dict]:
    """Return built-in drawings keyed by their read-only display name."""
    return {art["name"]: art for art in get_builtin_pixel_arts()}


def find_pixel_art(saved: list, name: str) -> dict | None:
    """The pixel art called ``name``: a saved one (``saved``, the user's
    collection) first, else a built-in one; None when there is none."""
    for index, art in enumerate(saved):
        if isinstance(art, dict) and art.get("name", f"Pixel Art {index + 1}") == name:
            return art
    return get_builtin_pixel_art_map().get(name)
