"""Software previews for Cube Lite firmware-native effects."""

from __future__ import annotations

import colorsys
import math

COLS = 20
ROWS = 5
BLACK = (0, 0, 0)


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

            if effect == "Ribbon":
                # The whole panel is one uniform color that slowly morphs
                # through the spectrum as phase advances -- no spatial
                # variation across pixels.
                color = _hsv(phase * 0.08 % 1.0, 0.9, 0.88)
            elif effect == "Starry Sky":
                twinkle = max(0.0, math.sin((noise * 3.0 + phase) * math.tau)) ** 7
                color = _rgb(110, 165, 255, 0.08 + 0.92 * twinkle)
            elif effect == "Spectrum":
                color = _hsv(x * 0.9, 1.0, 0.82 + 0.18 * math.sin((x + phase * 0.08) * math.tau))
            elif effect == "Waves":
                # Concentric ripples radiating from a source point at the
                # "bottom" centre (along the flow axis), matching the real
                # firmware effect: deep-blue troughs, cyan crests, wide bands.
                du = u  # 0 at the source edge (u=0), grows toward u=1
                dv = (v - 0.5) * 2.2  # perpendicular spread, aspect-weighted
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
            elif effect == "Fire":
                # Flames rise along the flow axis (u); flicker varies across it (v).
                heat = max(0.0, 1.0 - u + noise * 0.45 - 0.2 * math.sin((v * 3 + phase) * math.tau))
                color = _palette(((70, 0, 0), (255, 35, 0), (255, 200, 0), (255, 255, 180)), min(1.0, heat))
            elif effect == "Bouncing Ball":
                center_x = (math.sin(phase * 1.7) + 1.0) * 0.5
                center_y = abs(math.sin(phase * 2.3))
                distance = math.hypot((x - center_x) * 1.8, y - center_y)
                level = max(0.03, 1.0 - distance * 3.6)
                color = _rgb(255, 65, 190, level)
            elif effect == "Meteor":
                position = (u - phase * 0.7) % 1.0
                trail = max(0.0, 1.0 - position * 5.0)
                color = _rgb(130 + 125 * trail, 170 + 85 * trail, 255, 0.08 + 0.92 * trail)
            elif effect == "Tide":
                # Water rises along the flow axis (u); ripples run across it (v).
                height = 0.46 + 0.25 * math.sin((v * 1.5 - phase * 0.35) * math.tau)
                level = 0.15 if u > height else 0.55 + 0.45 * wave
                color = _rgb(0, 145, 255, level)
            elif effect == "Building Blocks":
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
