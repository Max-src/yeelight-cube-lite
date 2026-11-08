"""Measure how each effect takes the palette in the Studio color mode.

lamp_studio.STUDIO_LOOKS (and its mirror in www/lamp-studio.js) gives each
effect Studio draws its look, from 20 seconds of the effect as Studio starts
from it (its own colors, the default speed, direction Right):

- "wheel" (start): its frames go round the whole hue wheel (all but less
  than 32 of its 256 hues), their colors carry the picture;
- "hue" (start, q0 ... q4): they use a range of hues at least MIN_HUE_SPAN
  wide: each palette quarter between two of its hue quartiles (past start);
- "object" (floor): otherwise, when less than half the panel is lit (at
  least OBJECT_FLOOR bright) on average (dots, blocks, trails on black): each
  keeps one color while it is at least the floor bright (OBJECTS: chosen);
- "level" (q0 ... q4): otherwise, a field of light: its brightness picks the
  color, each palette quarter between two of its brightness quartiles (the
  5th, 27.5th, 50th, 72.5th and 95th percentiles of its lit pixels);
- "first": a field too even to spread (or one of FIRST).

Run it again after a renderer changes, and paste its output over both tables:

    python tools/generate_studio_looks.py
"""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "custom_components", "yeelight_cube"))

from const import ALL_NATIVE_EFFECTS, DEFAULT_NATIVE_EFFECT_SPEED  # noqa: E402
from lamp_animations import animation_frames  # noqa: E402
from lamp_studio import MIN_HUE_SPAN, _Source, hue_byte, level_step, studio_recolors  # noqa: E402

RENDERS = 500
# A hue seen on fewer of the effect's coloured pixels than this is noise
# (rounding in a fading tail), not part of its range.
NOISE_SHARE = 0.002
# Brightness percentiles a "level" look spreads the palette between, and
# the narrowest spread worth it.
LEVEL_PERCENTILES = (0.05, 0.275, 0.5, 0.725, 0.95)
# The closest two hue quartiles are kept (a palette quarter between them).
MIN_HUE_STEP = 8
MIN_LEVEL_SPREAD = 24
# The White fill-in and wipe-out: in the whole palette they would be Rainbow
# fill-in and wipe-out again.
FIRST = {"White fill-in (one-shot)", "White wipe-out (one-shot)"}
OBJECT_FLOOR = 16
# Objects over a lit background: Hacking's digits over its dim panel (about
# 50, the digits over 200).
# Centre bursts' dim glow (under 32) stays the first color, each burst its own.
OBJECTS = {"Hacking": 128, "Centre bursts": 32}
# Fields of heat, though mostly dark: their brightness is their heat.
FIELDS = {"Fire", "Heat fire"}


def measure(effect: str):
    """((start, span, hue percentiles) or None, lit share, level
    percentiles) of an effect."""
    animation = ALL_NATIVE_EFFECTS[effect].get("animation")
    if animation:
        # Its GIF's frames, each once.
        frames = list(animation_frames(animation))
    else:
        source = _Source(effect, "Right", DEFAULT_NATIVE_EFFECT_SPEED, None, None)
        frames = [source.frame(render) for render in range(RENDERS)]
    counts = [0] * 256
    levels = []
    bright = 0
    followed = None
    for frame in frames:
        # A field's color follows its brightness around each pixel (level_step).
        followed = level_step(followed, frame)
        for index, pixel in enumerate(frame):
            level = max(pixel)
            if level:
                levels.append(followed[index])
            if level >= OBJECT_FLOOR:
                bright += 1
            hue = hue_byte(pixel)
            if hue is not None:
                counts[hue] += 1
    lit = bright / (len(frames) * 100)
    levels.sort()
    spread = (
        tuple(levels[int(share * (len(levels) - 1))] for share in LEVEL_PERCENTILES)
        if levels else (0,) * len(LEVEL_PERCENTILES)
    )
    total = sum(counts)
    if not total:
        return None, lit, spread
    unused = [count < total * NOISE_SHARE for count in counts]
    gap, gap_start = 0, 0
    for start in range(256):
        if not unused[start] or unused[(start - 1) % 256]:
            continue
        length = 0
        while length < 256 and unused[(start + length) % 256]:
            length += 1
        if length > gap:
            gap, gap_start = length, start
    start = (gap_start + gap) % 256
    offsets = sorted(
        offset for hue, count in enumerate(counts) if count
        for offset in [(hue - start) & 255] * count
    )
    hue_knots = [offsets[int(share * (len(offsets) - 1))] for share in LEVEL_PERCENTILES]
    # Quartiles closer than MIN_HUE_STEP: a fading pixel's hue rounding would
    # jump a whole palette quarter.
    for index in range(1, len(hue_knots)):
        hue_knots[index] = max(hue_knots[index], hue_knots[index - 1] + MIN_HUE_STEP)
    hue_knots = tuple(hue_knots)
    return (start, 256 - gap, hue_knots), lit, spread


def look(effect: str) -> tuple:
    if effect in FIRST:
        return ("first",)
    if effect in OBJECTS:
        return ("object", OBJECTS[effect])
    hues, lit, knots = measure(effect)
    if hues is not None and hues[1] >= 256 - 32:
        return ("wheel", hues[0])
    if hues is not None and hues[1] >= MIN_HUE_SPAN:
        return ("hue", hues[0], *hues[2])
    if lit < 0.5 and effect not in FIELDS:
        return ("object", OBJECT_FLOOR)
    if knots[-1] - knots[0] < MIN_LEVEL_SPREAD:
        return ("first",)
    return ("level", *knots)


def main() -> None:
    effects = sorted(
        (name for name in ALL_NATIVE_EFFECTS if studio_recolors(name)),
        key=lambda name: ALL_NATIVE_EFFECTS[name]["mode"],
    )
    looks = [(name, look(name)) for name in effects]
    print("Python:")
    for name, value in looks:
        print(f'    "{name}": {value!r},'.replace("',)", "',)"))
    print("JS:")
    for name, value in looks:
        items = ", ".join(f'"{item}"' if isinstance(item, str) else str(item) for item in value)
        print(f'  "{name}": [{items}],')


if __name__ == "__main__":
    main()
