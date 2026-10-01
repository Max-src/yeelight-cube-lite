"""Stored pixel-art format.

Pixel arts are stored grouped by colour, black (background) pixels omitted:
``[{"color": [R, G, B], "position": [int, ...]}, ...]``. The renderer and the
cards work with the flat form ``[{"position": int, "color": [R, G, B]}, ...]``.

Older storage used the flat form, or a grouped form keyed ``"positions"``
(plural); both are still accepted wherever pixels are read.
"""


def group_pixels(pixels: list) -> list:
    """Group non-black pixels by colour, one entry per distinct colour.

    Accepts the flat form (``position`` scalar or list) and the legacy
    ``positions`` key. The first colour given for a position wins; positions
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
