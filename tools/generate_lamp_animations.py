"""Makes www/lamp-animations.js: the animations this integration uploads to a
lamp as its stored GIF (lamp_animations.py), drawn here from scratch.

Each is 48 frames of the 20 x 5 panel, as someone facing a lamp mounted the
default way sees it (top row first), looping without a seam. Every frame is a
function of its index only (and fixed seeds), so the output is the same on
every run. Pillow reduces the colours to one shared table of at most 256, the
GIF limit, here once, so the integration encodes the frames as they are.

    python tools/generate_lamp_animations.py
"""
from __future__ import annotations

import base64
import colorsys
import functools
import json
import math
import random
from pathlib import Path

from PIL import Image

COLS, ROWS = 20, 5
FRAMES = 48
# 12 and 13 hundredths of a second in turn: 8 frames a second, 6 s a loop.
DELAYS = [120 if index % 2 else 130 for index in range(FRAMES)]
OUT = Path(__file__).resolve().parents[1] / "custom_components" / "yeelight_cube" / "www" / "lamp-animations.js"


def clamp(value: float) -> int:
    return max(0, min(255, round(value)))


def mix(a, b, weight: float):
    return tuple(clamp(x + (y - x) * weight) for x, y in zip(a, b))


def scale(colour, factor: float):
    return tuple(clamp(channel * factor) for channel in colour)


def wave(t: float) -> float:
    """0-1, one period per 1.0 of ``t``."""
    return 0.5 + 0.5 * math.sin(2 * math.pi * t)


# ── Snowfall ───────────────────────────────────────────────────────────────
# White flakes fall a row a frame, now and then drifting a column, each
# leaving a short grey trail, onto a white snow line whose gaps open as it
# melts and close where a flake lands. The fall pauses a frame every six, so
# the loop has 40 steps.
SNOW_STEPS = 40
SNOW_TRAIL = (56, 28, 16)


def _snow_tick(frame: int) -> int:
    return frame - (frame + 4) // 6


@functools.lru_cache(maxsize=1)
def _snow_flakes() -> tuple:
    """(column, start step, drift row, drift) per flake, in waves."""
    rng = random.Random(23)
    flakes = []
    for step in range(SNOW_STEPS):
        # Two waves a loop: from none or one flake a step to three.
        count = round(0.2 + 1.4 * wave(step / SNOW_STEPS * 2 + 0.1) + rng.random() * 0.5)
        for _ in range(count):
            drift = rng.choice((0, 0, 0, -1, 1))
            flakes.append((rng.randrange(COLS), step, rng.randrange(1, 4), drift))
    return tuple(flakes)


def _flake_path(flake) -> list:
    """The columns of a flake's rows 0-3, then the snow line's."""
    column, _, drift_row, drift = flake
    return [(column + (drift if row >= drift_row else 0)) % COLS for row in range(ROWS)]


@functools.lru_cache(maxsize=1)
def _snow_gaps() -> tuple:
    """Per column, the steps its snow line is melted (open): a gap opens
    between two landings and closes at the next."""
    rng = random.Random(41)
    landings = {column: [] for column in range(COLS)}
    for flake in _snow_flakes():
        landings[_flake_path(flake)[ROWS - 1]].append((flake[1] + ROWS - 1) % SNOW_STEPS)
    gaps = []
    for column in range(COLS):
        times = sorted(set(landings[column]))
        melted = set()
        for index, land in enumerate(times):
            following = times[(index + 1) % len(times)] + (SNOW_STEPS if index + 1 == len(times) else 0)
            interval = following - land
            if interval > 6 and rng.random() < 0.6:
                opens = land + rng.randrange(2, interval - 2)
                # A short melt: the line changes often, a gap never lasts.
                melted.update(step % SNOW_STEPS for step in range(opens, min(following, opens + 9)))
        if not times and rng.random() < 0.3:
            opens = rng.randrange(SNOW_STEPS)
            melted.update(step % SNOW_STEPS for step in range(opens, opens + 8))
        gaps.append(frozenset(melted))
    return tuple(gaps)


def snowfall(frame: int) -> list:
    tick = _snow_tick(frame)
    grey = [[0] * COLS for _ in range(ROWS - 1)]
    for flake in _snow_flakes():
        path = _flake_path(flake)
        age = (tick - flake[1]) % SNOW_STEPS
        for row in range(ROWS - 1):
            since = age - row  # steps since the flake was on this row
            if since == 0:
                grey[row][path[row]] = 255
            elif 0 < since <= len(SNOW_TRAIL):
                grey[row][path[row]] = max(grey[row][path[row]], SNOW_TRAIL[since - 1])
    gaps = _snow_gaps()
    line = [0 if tick % SNOW_STEPS in gaps[column] else 255 for column in range(COLS)]
    return [(value, value, value) for row in grey for value in row] + [(value, value, value) for value in line]


# ── Daydream ───────────────────────────────────────────────────────────────
# A large soft cloud of colour sways from side to side over black, holding a
# colour for a while (blue, red, green), with quick flashes of other colours
# in between; its core is bright, its edge fades over half the panel.
DREAM_SCENES = (
    # (first frame, hue in degrees, centre from, centre to)
    (0, 235, 14.5, 12.5), (5, 355, 12.5, 10.0), (9, 355, 10.0, 13.5),
    (12, 10, 14.5, 16.5), (13, 270, 16.5, 18.0), (14, 40, 4.0, 3.0), (15, 8, 2.5, 6.0),
    (16, 355, 6.0, 15.5), (19, 115, 2.5, 3.0), (20, 95, 3.0, 4.0), (21, 15, 4.5, 9.5),
    (23, 355, 10.5, 14.0), (26, 355, 14.0, 13.5), (27, 115, 13.0, 10.0), (34, 115, 10.0, 16.0),
    (39, 75, 13.5, 13.5), (40, 245, 1.0, 3.5), (42, 100, 10.5, 15.0), (43, 115, 15.5, 18.0),
    (45, 290, 4.0, 3.5), (46, 245, 3.0, 4.5), (47, 235, 5.0, 14.5),
)


def daydream(frame: int) -> list:
    index = max(i for i, scene in enumerate(DREAM_SCENES) if scene[0] <= frame)
    first, hue, start, stop = DREAM_SCENES[index]
    last = DREAM_SCENES[index + 1][0] if index + 1 < len(DREAM_SCENES) else FRAMES
    t = (frame - first + 0.5) / (last - first)
    centre = start + (stop - start) * t
    # A short scene is a flash: smaller and dimmer.
    flash = last - first <= 2
    width = 4.0 if flash else 5.6
    peak = 0.74 if flash else 0.88
    pixels = []
    for row in range(ROWS):
        for column in range(COLS):
            # Tilted: the cloud leans from top left to bottom right.
            dx = (column - centre - (row - 2) * 2.2) / width
            dy = (row - 2.2) / 4.2
            # A broad bright core with a quick edge to black.
            level = peak * math.exp(-((dx * dx + dy * dy) ** 1.6))
            # A faint second glow trails the cloud on the other side.
            far = (column - centre + 10 - (row - 2) * 2.2) / width
            level = max(level, 0.18 * peak * math.exp(-((far * far + dy * dy) ** 1.6)))
            shade = (hue + (column - centre) * 5.0) / 360 % 1.0
            r, g, b = colorsys.hsv_to_rgb(shade, 0.92, 1.0)
            pixels.append(scale((r * 255, g * 255, b * 255), level if level > 0.08 else 0.0))
    return pixels


# ── Halloween glow ─────────────────────────────────────────────────────────
# A dusk gradient: red fading across each row, deeper toward the top; green
# rising row by row; blue fading from the violet left to the amber right. In
# steps two pixels wide, its green and blue shimmering gently.
HALLOWEEN_RED = (
    (110, 88, 68, 52), (158, 138, 118, 102), (214, 193, 171, 153),
    (254, 250, 228, 208), (254, 254, 254, 254),
)
HALLOWEEN_GREEN = (27, 49, 76, 103, 131)
HALLOWEEN_BLUE = (104, 71, 40, 18)
HALLOWEEN_BLUE_FLOOR = (0, 0, 0, 4, 16)


def _profile(points, x: float) -> float:
    """``points`` spread evenly over 0-1, linear between them."""
    position = max(0.0, min(1.0, x)) * (len(points) - 1)
    low = min(int(position), len(points) - 2)
    return points[low] + (points[low + 1] - points[low]) * (position - low)


def halloween_glow(frame: int) -> list:
    rng = random.Random(31)
    phases = [[(rng.random(), rng.random()) for _ in range(COLS // 2)] for _ in range(ROWS)]
    pixels = []
    for row in range(ROWS):
        for column in range(COLS):
            pair = column // 2
            # The profiles' points are the middles of four runs of five.
            x = (pair * 2 + 0.5 - 2) / 15
            green_phase, blue_phase = phases[row][pair]
            red = _profile(HALLOWEEN_RED[row], x) * (1 + 0.04 * (wave(green_phase + 4 * frame / FRAMES) - 0.5))
            green = HALLOWEEN_GREEN[row] * (1 + 0.3 * (wave(green_phase + 8 * frame / FRAMES) - 0.5))
            blue = (_profile(HALLOWEEN_BLUE, x) + HALLOWEEN_BLUE_FLOOR[row] * x) * (
                1 + 0.4 * (wave(blue_phase + 6 * frame / FRAMES) - 0.5))
            pixels.append((clamp(red), clamp(green), clamp(blue)))
    return pixels


# ── Moonlit clouds ─────────────────────────────────────────────────────────
# Deep blue moonlight, brightest on the left, with bright patches drifting
# slowly over darker ones; the brightest parts are full blue.
def moonlit_clouds(frame: int) -> list:
    t = frame / FRAMES
    pixels = []
    for row in range(ROWS):
        for column in range(COLS):
            x = column / COLS
            light = (
                0.9 - 0.62 * x
                + 0.3 * math.sin(2 * math.pi * (1.4 * x - 3 * t) + row * 0.15)
                + 0.2 * math.sin(2 * math.pi * (2.3 * x + 4 * t) - row * 0.25 + 1.3)
                + 0.12 * math.sin(2 * math.pi * (4.1 * x - 6 * t) + row * 0.9)
                + 0.12 * math.sin(2 * math.pi * (0.7 * x + t + row / 5))
            )
            blue = clamp(55 + 200 * max(0.0, min(1.0, light)))
            pixels.append((round(blue * 6 / 170), 0, blue))
    return pixels


ANIMATIONS = {
    "snowfall": ("Snowfall", snowfall),
    "daydream": ("Daydream", daydream),
    "halloween_glow": ("Halloween glow", halloween_glow),
    "moonlit_clouds": ("Moonlit clouds", moonlit_clouds),
}


def shared_palette(frames: list) -> list:
    """The frames with their colours reduced to one table of at most 256."""
    strip = Image.new("RGB", (COLS, ROWS * len(frames)))
    strip.putdata([pixel for frame in frames for pixel in frame])
    if len({pixel for frame in frames for pixel in frame}) <= 256:
        return frames
    reduced = strip.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    raw = reduced.tobytes()
    flat = [tuple(raw[index:index + 3]) for index in range(0, len(raw), 3)]
    return [flat[index * COLS * ROWS:(index + 1) * COLS * ROWS] for index in range(len(frames))]


def render() -> str:
    """The text of www/lamp-animations.js."""
    data = {}
    for key, (name, draw) in ANIMATIONS.items():
        frames = shared_palette([draw(index) for index in range(FRAMES)])
        raw = bytes(channel for frame in frames for pixel in frame for channel in pixel)
        data[key] = {
            "name": name,
            "delays": DELAYS,
            "frames": base64.b64encode(raw).decode("ascii"),
        }
    body = json.dumps(data, indent=1)
    return (
        "// Generated by tools/generate_lamp_animations.py: do not edit.\n"
        "// The animations a lamp can store and play (lamp_animations.py reads this\n"
        "// file too): 48 frames of the 20 x 5 panel as the viewer sees it, top row\n"
        "// first, 3 bytes a pixel, base64; delays in milliseconds.\n"
        f"export const LAMP_ANIMATIONS = {body};\n"
    )


def main() -> None:
    OUT.write_text(render(), encoding="utf-8", newline="\n")
    print(f"{OUT.name}: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
