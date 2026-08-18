"""Software previews for Cube Lite firmware-native effects."""

from __future__ import annotations

import colorsys
import math

COLS = 20
ROWS = 5
BLACK = (0, 0, 0)
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
    return max(0, min(255, round(value)))


def _rgb(red: float, green: float, blue: float, level: float = 1.0):
    return (
        _clamp(red * level),
        _clamp(green * level),
        _clamp(blue * level),
    )


def _hsv(hue: float, saturation: float = 1.0, value: float = 1.0):
    red, green, blue = colorsys.hsv_to_rgb(hue % 1.0, saturation, value)
    return _rgb(red * 255, green * 255, blue * 255)


def _noise(col: int, row: int, frame: int) -> float:
    value = (col * 374761393 + row * 668265263 + frame * 2246822519) & 0xFFFFFFFF
    value = (value ^ (value >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((value ^ (value >> 16)) & 0xFF) / 255.0


def _flow_coordinates(col: int, row: int, direction: str) -> tuple[float, float]:
    x = col / (COLS - 1)
    y = row / (ROWS - 1)
    if direction == "Down":
        return 1.0 - y, x
    if direction == "Left":
        return 1.0 - x, y
    if direction == "Right":
        return x, y
    return y, x


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


def render_native_effect(
    effect: str,
    phase: float,
    direction: str = "Up",
) -> list[tuple[int, int, int]]:
    """Return one animated 20x5 approximation of a firmware effect."""
    frame = int(phase * 5)
    pixels: list[tuple[int, int, int]] = []

    for row in range(ROWS):
        for col in range(COLS):
            x = col / (COLS - 1)
            y = row / (ROWS - 1)
            u, v = _flow_coordinates(col, row, direction)
            wave = (math.sin((u * 2.0 - phase) * math.tau) + 1.0) / 2.0
            noise = _noise(col, row, frame)

            if effect == "Streamer":
                # The whole panel is one uniform color that slowly morphs
                # through the spectrum as phase advances -- no spatial
                # variation across pixels.
                color = _hsv(phase * 0.08 % 1.0, 0.9, 0.88)
            elif effect == "Starry sky":
                # Sparse blue stars that pop on and slowly fade to black. Each
                # pixel runs its own cycle (stable random phase + rate) so stars
                # appear and fade independently instead of the whole panel
                # jumping between states. ``phase`` already scales with the
                # effect speed, so a higher speed shortens the fade -- matching
                # the real firmware, where speed controls the fade rate rather
                # than a spawn rate.
                seed = _noise(col, row, 0)
                seed2 = _noise(col, row, 999)
                cycle_rate = 0.25 + 0.3 * seed2
                local = (phase * cycle_rate + seed) % 1.0
                rise = 0.04
                fade = 0.34
                if local < rise:
                    level = local / rise
                elif local < rise + fade:
                    level = 1.0 - (local - rise) / fade
                else:
                    level = 0.0
                color = _rgb(30, 140, 255, level)
            elif effect == "Spectrum":
                # A full rainbow gradient painted pixel-by-pixel, red -> magenta.
                # "Right" scans line-by-line (bottom-left red, top-right magenta);
                # "Down" scans column-by-column (bottom-left red, top-right magenta);
                # "Left"/"Up" are the 180-degree rotations of "Right"/"Down".
                last = COLS * ROWS - 1
                if direction in ("Down", "Up"):
                    index = col * ROWS + row
                    if direction == "Up":
                        index = last - index
                else:
                    index = (ROWS - 1 - row) * COLS + col
                    if direction == "Left":
                        index = last - index
                t = index / last
                color = _hsv(t * 0.83, 1.0, 0.82 + 0.18 * math.sin((t + phase * 0.08) * math.tau))
            elif effect == "Ocean Waves":
                # Right/Left reuse Up/Down coordinates so device-orientation rotation renders correctly.
                if direction == "Right":
                    ow_u, ow_v = y, x
                elif direction == "Left":
                    ow_u, ow_v = 1.0 - y, x
                else:
                    ow_u, ow_v = u, v
                # Source offset matches physical lamp: Down/Right shift left, Up/Left shift right.
                v_center = 0.5 - 2.0 / 19.0 if direction in ("Down", "Right") else 0.5 + 2.0 / 19.0
                du = ow_u
                dv = (ow_v - v_center) * 2.2
                dist = math.hypot(du, dv)
                ripple = (math.sin((dist * 1.0 - phase) * math.tau) + 1.0) / 2.0
                color = _hsv(0.64 - 0.07 * ripple, 0.97, 0.12 + 0.88 * ripple)
            elif effect == "Rainbow":
                color = _hsv(u - phase * 0.18, 0.95, 0.95)
            elif effect == "Waterfall":
                trail = max(0.0, math.sin((u * 3.0 - phase * 1.4 + noise * 0.3) * math.tau)) ** 3
                color = _rgb(20, 125 + 110 * trail, 255, 0.18 + 0.82 * trail)
            elif effect == "Aurora":
                # Curtains hang perpendicular to the flow (v) and shift along it (u).
                curtain = (math.sin((v * 1.6 + phase * 0.22) * math.tau + u * 2.0) + 1.0) / 2.0
                color = _palette(((18, 255, 143), (20, 126, 255), (192, 55, 255)), curtain)
                color = _rgb(*color, 0.3 + 0.7 * wave)
            elif effect == "Bonfire":
                # Flames rise along the flow axis (u); flicker varies across it (v).
                heat = max(0.0, 1.0 - u + noise * 0.45 - 0.2 * math.sin((v * 3 + phase) * math.tau))
                color = _palette(((70, 0, 0), (255, 35, 0), (255, 200, 0), (255, 255, 180)), min(1.0, heat))
            elif effect == "Pinball":
                center_x = (math.sin(phase * 1.7) + 1.0) * 0.5
                center_y = abs(math.sin(phase * 2.3))
                distance = math.hypot((x - center_x) * 1.8, y - center_y)
                level = max(0.03, 1.0 - distance * 3.6)
                color = _rgb(255, 65, 190, level)
            elif effect == "Shooting Star":
                position = (u - phase * 0.7) % 1.0
                trail = max(0.0, 1.0 - position * 5.0)
                color = _rgb(130 + 125 * trail, 170 + 85 * trail, 255, 0.08 + 0.92 * trail)
            elif effect == "Tide":
                # Water rises along the flow axis (u); ripples run across it (v).
                height = 0.46 + 0.25 * math.sin((v * 1.5 - phase * 0.35) * math.tau)
                level = 0.15 if u > height else 0.55 + 0.45 * wave
                color = _rgb(0, 145, 255, level)
            elif effect == "Building block":
                block = (int((u * 8 - phase * 2.0)) + int(v * 4)) % 6
                color = ((255, 58, 52), (255, 190, 24), (46, 224, 95), (35, 155, 255), (164, 64, 255), (255, 67, 190))[block]
            elif effect == "Hacking":
                head = (phase * 0.8 + _noise(col, 0, 0)) % 1.0
                distance = (head - u) % 1.0
                level = 1.0 if distance < 0.08 else max(0.04, 0.65 - distance * 1.8)
                color = _rgb(25, 255, 85, level)
            elif effect == "Flower Sea":
                petal = abs(math.sin((x * 3.5 + y * 2.0 + phase * 0.25) * math.tau))
                color = _hsv(0.82 + 0.22 * x + phase * 0.03, 0.75, 0.25 + 0.75 * petal)
            elif effect == "Magic":
                angle = math.atan2(y - 0.5, x - 0.5) / math.tau
                radius = math.hypot((x - 0.5) * 1.6, y - 0.5)
                color = _hsv(angle + radius - phase * 0.2, 0.85, 0.35 + 0.65 * wave)
            elif effect == "Wonderland":
                color = _hsv(0.48 + x * 0.36 + phase * 0.025, 0.48, 0.55 + 0.45 * wave)
            elif effect == "Kaleidoscope":
                sx = abs(x - 0.5) * 2.0
                sy = abs(y - 0.5) * 2.0
                pattern = (math.sin((sx + sy - phase * 0.35) * math.tau * 2.0) + 1.0) / 2.0
                color = _hsv(sx * 0.35 + sy * 0.4 + phase * 0.05, 0.9, 0.22 + 0.78 * pattern)
            elif effect == "Palette":
                index = (int(x * 8) + int(y * 3) + int(phase * 0.7)) % 8
                color = _hsv(index / 8.0, 0.72, 0.95)
            else:
                color = _hsv(x + phase * 0.05, 0.8, 0.35 + 0.65 * wave)

            pixels.append(color)

    return pixels
