"""Stored pixel-art format.

Pixel arts are stored grouped by color, black (background) pixels omitted:
``[{"color": [R, G, B], "position": [int, ...]}, ...]``. The renderer and the
cards work with the flat form ``[{"position": int, "color": [R, G, B]}, ...]``.

Older storage used the flat form, or a grouped form keyed ``"positions"``
(plural); both are still accepted wherever pixels are read.

A pixel art may carry an ``orientation`` (PIXEL_ART_ORIENTATIONS): vertical
ones are drawn for a lamp standing on its end (the cards show them so);
absent means horizontal.

A pixel art's positions are ``row * width + column`` (row 0 at the bottom,
column 0 at the lamp's base side). Its ``width`` is stored with it when it is
not PIXEL_ART_WIDTH (20, every art made before longer Cube Matrix lamps, the
built-in ones too): one drawn on a Cube Matrix of more than 4 modules can be
as wide as that lamp (5 columns a module). Shown on a lamp (pixels_at_width),
an art is placed from column 0, the columns past it black, and cropped to the
lamp's frame when it is wider.
"""

# The width of a pixel art that names none (every one made before longer
# Cube Matrix lamps, the built-in ones).
PIXEL_ART_WIDTH = 20

PIXEL_ART_HORIZONTAL = "horizontal"
PIXEL_ART_VERTICAL = "vertical"
PIXEL_ART_ORIENTATIONS = (PIXEL_ART_HORIZONTAL, PIXEL_ART_VERTICAL)


def stored_pixel_art(
    name: str, pixels: list, orientation: str | None = None, width: int | None = None,
) -> dict:
    """A pixel art as the collection stores it: its name, its pixels grouped
    by color (group_pixels), its orientation (a vertical one only, so
    every older horizontal art reads the same) and its width (one other
    than PIXEL_ART_WIDTH only, likewise)."""
    art = {"name": name, "pixels": group_pixels(pixels)}
    if orientation and orientation != PIXEL_ART_HORIZONTAL:
        art["orientation"] = orientation
    if width and int(width) != PIXEL_ART_WIDTH:
        art["width"] = int(width)
    return art


def pixel_art_width(art) -> int:
    """A stored pixel art's width (PIXEL_ART_WIDTH when it names none)."""
    try:
        width = int((art or {}).get("width") or PIXEL_ART_WIDTH)
    except (TypeError, ValueError, AttributeError):
        return PIXEL_ART_WIDTH
    return width if width > 0 else PIXEL_ART_WIDTH


def pixels_at_width(pixels: list, width: int | None, frame_width: int, rows: int = 5) -> list:
    """Flat pixels (``row * width + column``) placed on a frame
    ``frame_width`` columns wide: from column 0, cropped to the frame (a
    column past it, or a row past ``rows``, is left out). Unchanged when
    both widths are the same (the renderer then checks each position)."""
    width = int(width or PIXEL_ART_WIDTH)
    if width == frame_width:
        return pixels
    placed = []
    for pixel in pixels:
        position = pixel.get("position") if isinstance(pixel, dict) else None
        if not isinstance(position, int) or position < 0:
            continue
        row, col = divmod(position, width)
        if row < rows and col < frame_width:
            placed.append({**pixel, "position": row * frame_width + col})
    return placed


def group_pixels(pixels: list) -> list:
    """Group non-black pixels by color, one entry per distinct color.

    Accepts the flat form (``position`` scalar or list) and the legacy
    ``positions`` key. The first color given for a position wins; positions
    are sorted within each group.
    """
    seen_positions: dict = {}  # position -> color (first definition wins)
    for px in pixels:
        if not isinstance(px, dict):
            continue
        color = list(px.get("color", []))
        if color == [0, 0, 0]:
            continue  # black = background; omit to save space
        if "position" in px:
            raw_pos = px.get("position")
            pos_list = raw_pos if isinstance(raw_pos, list) else [raw_pos]
        elif "positions" in px:
            pos_list = px.get("positions", [])
        else:
            continue
        for pos in pos_list:
            if pos is not None and pos not in seen_positions:
                seen_positions[pos] = color
    color_groups: dict = {}
    for pos, color in seen_positions.items():
        color_groups.setdefault(tuple(color), []).append(pos)
    return [
        {"color": list(color), "position": sorted(positions)}
        for color, positions in color_groups.items()
    ]


def expand_pixels(pixels: list) -> list:
    """Expand stored (grouped) pixels to the flat ``[{position, color}]`` form.

    Flat entries (scalar ``position``) and the legacy ``positions`` key are
    passed through / expanded too.
    """
    result = []
    for entry in pixels:
        if not isinstance(entry, dict):
            continue
        color = entry.get("color", [])
        if "position" in entry:
            pos = entry.get("position")
            for p in pos if isinstance(pos, list) else [pos]:
                result.append({"position": p, "color": color})
        elif "positions" in entry:
            for p in entry.get("positions", []):
                result.append({"position": p, "color": color})
    return result


def is_grouped(pixels: list) -> bool:
    """Whether pixels are already in the current grouped storage form (an
    empty list needs no conversion)."""
    if not pixels:
        return True
    first = pixels[0]
    return isinstance(first, dict) and isinstance(first.get("position"), list)
