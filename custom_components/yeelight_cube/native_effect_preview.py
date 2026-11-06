"""Software previews for Cube Lite built-in effects.

An effect's frame comes from the lamp's own renderer, for the command the
lamp gets (lamp_renderers): the entry points below only read it. What is
left here has no renderer: the Music Flow illustrations, and a plain gradient for
slot 71, whose picture is the GIF stored on the lamp.
"""

from __future__ import annotations

import colorsys
import math

try:
    from .lamp_renderers import (
        DEFAULT_NATIVE_EFFECT_SPEED,
        LAMP_RENDERED_EFFECTS,
        effect_supports_color_mode,
        effect_supports_color_override,
        lamp_effect_frame,
        lamp_settings,
    )
    from .lamp_animations import animation_frame
    from .const import ALL_NATIVE_EFFECTS, STORED_GIF_EFFECT
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_renderers import (
        DEFAULT_NATIVE_EFFECT_SPEED,
        LAMP_RENDERED_EFFECTS,
        effect_supports_color_mode,
        effect_supports_color_override,
        lamp_effect_frame,
        lamp_settings,
    )
    from lamp_animations import animation_frame
    from const import ALL_NATIVE_EFFECTS, STORED_GIF_EFFECT

COLS = 20
ROWS = 5
BLACK = (0, 0, 0)

# ── Row orientation convention ───────────────────────────────────────────
# Every frame here has ROW 0 = the panel's PHYSICAL BOTTOM: camera.py maps
# preview row 0 to the image bottom and the lamp-preview card does the same.

_MUSIC_FLOW_FLOWERS = (
    (4, 2, (255, 55, 160)),
    (10, 1, (255, 126, 40)),
    (16, 3, (63, 210, 255)),
)
_MUSIC_FLOW_SPECTRUM_HEIGHTS = (
    1, 2, 3, 5, 4, 2, 3, 4, 5, 3, 2, 4, 5, 4, 2, 3, 5, 4, 2, 1
)
_MUSIC_FLOW_NOTE_PIXELS = frozenset(
    {
        (4, 0),
        (5, 0),
        (4, 1),
        (5, 1),
        (6, 1),
        (6, 2),
        (6, 3),
        (6, 4),
        (7, 4),
        (8, 4),
        (9, 4),
        (10, 4),
        (11, 4),
        (12, 4),
        (13, 1),
        (14, 1),
        (13, 2),
        (14, 2),
        (14, 3),
        (14, 4),
    }
)
def _clamp(value: float) -> int:
    # Round half up to match JS Math.round (channel values are always >= 0).
    return max(0, min(255, math.floor(value + 0.5)))


def _rgb(red: float, green: float, blue: float, level: float = 1.0):
    return (
        _clamp(red * level),
        _clamp(green * level),
        _clamp(blue * level),
    )


def _hsv(hue: float, saturation: float = 1.0, value: float = 1.0):
    red, green, blue = colorsys.hsv_to_rgb(hue % 1.0, saturation, value)
    return _rgb(red * 255, green * 255, blue * 255)


def _palette(stops: tuple[tuple[int, int, int], ...], position: float):
    position = max(0.0, min(1.0, position))
    scaled = position * (len(stops) - 1)
    index = min(len(stops) - 2, int(scaled))
    local = scaled - index
    start, end = stops[index], stops[index + 1]
    return tuple(
        _clamp(start[channel] + (end[channel] - start[channel]) * local)
        for channel in range(3)
    )


def render_music_flow_effect(effect: str) -> list[tuple[int, int, int]]:
    """Return a deterministic 20x5 illustration of a Music Flow effect."""
    pixels: list[tuple[int, int, int]] = []

    for row in range(ROWS):
        for col in range(COLS):
            x = col / (COLS - 1)
            y = row / (ROWS - 1)

            if effect == "Gather":
                distance = math.hypot((x - 0.5) * 1.35, (y - 0.5) * 0.8)
                funnel = abs(y - 0.5) < 0.12 + abs(x - 0.5) * 0.55
                level = max(0.08, 1.0 - distance)
                if funnel:
                    level = min(1.0, level + 0.38)
                color = _hsv(0.78 - x * 0.65, 0.92, level)
            elif effect == "Breathing":
                distance = math.hypot((x - 0.5) * 1.15, (y - 0.5) * 1.7)
                level = max(0.04, 1.0 - distance)
                color = _palette(
                    (
                        (18, 13, 72),
                        (82, 38, 214),
                        (255, 64, 181),
                        (255, 225, 247),
                    ),
                    level,
                )
                color = _rgb(*color, 0.22 + level * 0.78)
            elif effect == "Blossom":
                color = (7, 2, 18)
                for center_col, center_row, petal_color in _MUSIC_FLOW_FLOWERS:
                    dx = col - center_col
                    dy = row - center_row
                    if dx == 0 and dy == 0:
                        color = (255, 244, 115)
                        break
                    if (abs(dx), abs(dy)) in ((1, 0), (0, 1), (1, 1)):
                        color = petal_color
                        break
            elif effect == "Spectrum":
                if row < _MUSIC_FLOW_SPECTRUM_HEIGHTS[col]:
                    color = _hsv(x * 0.86, 0.95, 0.58 + row * 0.1)
                else:
                    color = BLACK
            elif effect == "Music Note":
                if (col, row) in _MUSIC_FLOW_NOTE_PIXELS:
                    color = _hsv(0.82 + x * 0.48, 0.8, 1.0)
                else:
                    color = (2, 5, 22)
            elif effect == "Impact":
                dx = col - (COLS - 1) / 2
                dy = row - (ROWS - 1) / 2
                distance = math.hypot(dx / 9.5, dy / 2.0)
                ray = (
                    row == 2
                    or col in (9, 10)
                    or abs(abs(dx) - abs(dy) * 2.8) < 0.75
                )
                if distance < 0.18:
                    color = (255, 255, 235)
                elif ray:
                    color = _palette(
                        ((255, 28, 86), (255, 117, 25), (255, 235, 83)),
                        max(0.0, 1.0 - distance),
                    )
                else:
                    color = _rgb(96, 8, 112, max(0.08, 0.38 - distance * 0.2))
            else:
                color = _hsv(x * 0.86, 0.9, 0.35 + 0.65 * y)

            pixels.append(color)

    return pixels


# The preview speed: phase advances 0.25 + speed / 55 per second (camera.py,
# the cards); the lamp's default when none is given.
DEFAULT_PREVIEW_SPEED = DEFAULT_NATIVE_EFFECT_SPEED


def render_native_effect(
    effect: str,
    phase: float,
    direction: str = "Up",
    color_override=None,
    color_mode=None,
    speed: int | None = None,
    orientation: str | None = None,
    intensity: int | None = None,
    palette=None,
    stored=None,
    layout: str | None = None,
) -> list[tuple[int, int, int]]:
    """One frame of a native effect, lamp order: what the lamp's renderer
    draws for the command sent, LED drive
    (lamp_renderers). ``speed``: the one the phase was computed with, and
    the rate the lamp gets (DEFAULT_PREVIEW_SPEED when omitted). ``orientation``:
    how the lamp is mounted, which the direction sent is turned for.
    ``intensity``: the one chosen (None: the effect's own). ``palette``: the
    lamp's, for the palette color mode. ``stored``: what the lamp stores
    (light._stored_gif, or the animation's key), which the stored GIF shows,
    in its layout. ``layout``: the one an animation is sent in
    (const.ANIMATION_LAYOUTS; upright when None)."""
    speed = DEFAULT_PREVIEW_SPEED if speed is None else speed
    animation = ALL_NATIVE_EFFECTS.get(effect, {}).get("animation")
    if effect == STORED_GIF_EFFECT:
        animation = stored.get("animation") if isinstance(stored, dict) else stored
        layout = stored.get("layout") if isinstance(stored, dict) else None
    if animation:
        # Its frames as drawn, at their own pace (no speed), laid out as sent.
        return animation_frame(animation, phase / (0.25 + speed / 55.0), orientation, layout)
    if effect not in LAMP_RENDERED_EFFECTS:
        return _render_gradient(phase, direction)
    settings = lamp_settings(
        effect, direction, speed, color_override, color_mode, orientation, intensity,
        palette,
    )
    return lamp_effect_frame(settings, phase / (0.25 + speed / 55.0))


# Kept for the code that imports it: the lamp's renderers place every direction as the
# lamp does, nothing is left to correct.
render_native_effect_oriented = render_native_effect


def _render_gradient(phase: float, direction: str) -> list[tuple[int, int, int]]:
    """A moving gradient for slot 71: its picture cannot be read from the lamp."""
    pixels = []
    for row in range(ROWS):
        for col in range(COLS):
            x = col / (COLS - 1)
            y = row / (ROWS - 1)
            along = {"Down": 1.0 - y, "Left": 1.0 - x, "Right": x}.get(direction, y)
            wave = (math.sin((along * 2.0 - phase) * math.tau) + 1.0) / 2.0
            pixels.append(_hsv(x + phase * 0.05, 0.8, 0.35 + 0.65 * wave))
    return pixels
