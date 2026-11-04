"""Renderers of the lamp's gradients, waves and simple cycles:
Alternation, Breathing, Streamer, Rainbow Flow, Dual Scan, Inline Bands, Pastel
Pulse, Monochrome Waves, Spectrum, Pulse, Scrolling Bands, Palette Fade, the raw
red, the one-shot wipes and Spectrum Bands. Mirrors www/lamp-effects-waves.js
exactly; lamp_effects_core.py tells how to add one.

All pure functions of the clock or the render: every warmup is 0. The counters
of slots 1, 8 and 31 follow from the render alone, so they are worked out from
it. A 5-colour palette reads an unknown entry at index 255 (an undefined value); the
sampled table keeps black there.
"""

from __future__ import annotations

try:
    from .lamp_core import (
        LENGTH,
        RENDER_MS,
        SIN8,
        U32,
        effect_colours,
        effect_geometry,
        envelope_gain,
        f32,
        new_grid,
        palette_span,
        pixel_map,
        place_strip,
        strip_blur,
        triangle16,
    )
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_core import (
        LENGTH,
        RENDER_MS,
        SIN8,
        U32,
        effect_colours,
        effect_geometry,
        envelope_gain,
        f32,
        new_grid,
        palette_span,
        pixel_map,
        place_strip,
        strip_blur,
        triangle16,
    )


def _colour_cells(table) -> list:
    """A sampled table as 256 colours, each 3 bytes."""
    return [table[at:at + 3] for at in range(0, 768, 3)]


def _band_strip(palette) -> bytes:
    """Solid bands of the inline colors, unshifted."""
    count = len(palette)
    width = LENGTH // count
    return b"".join([bytes(palette[min(pixel // width, count - 1)]) for pixel in range(LENGTH)])


def _rotated(strip, shift: int) -> bytes:
    """``strip`` with pixel i moved to (i + shift) mod N."""
    return strip[-3 * shift:] + strip[:-3 * shift]


# ── Slot 1: Alternation ─────────────────────────────────────────────────
# Swaps colors when the time since its last swap passes the threshold, one swap
# at a time. The Apply's clock is past every threshold (<= 2580 ms), so the
# first render swaps and the swaps fall every ``turn`` renders from it.
def alternate_init(settings) -> dict:
    colours = effect_colours(settings)
    threshold = (255 - settings["rate"]) * 10 + 30
    return {
        "colours": (colours["primary"], colours["secondary"]),
        "threshold": threshold,
        "turn": threshold // RENDER_MS + 1,
    }


def alternate_weight(elapsed: int, threshold: int) -> int:
    """The signed low 32 bits of elapsed * 255 / threshold, truncated, as a byte."""
    product = (elapsed * 255) & U32
    negative = product >> 31
    quotient = ((1 << 32) - product if negative else product) // threshold
    return (-quotient if negative else quotient) & 255


def alternate_step(state, settings, clock_ms, render) -> bytes:
    turn = state["turn"]
    swaps, since = divmod(render, turn)
    phase = (swaps + 1) & 1
    selected = state["colours"][phase]
    if settings["intensity"] < 128:
        return bytes(selected) * LENGTH
    # The time before this render's swap: the whole clock on the first.
    elapsed = (since or turn) * RENDER_MS if render else clock_ms
    weight = alternate_weight(elapsed, state["threshold"])
    opposite = state["colours"][phase ^ 1]
    if weight == 0:
        return bytes(selected) * LENGTH
    if weight == 255:
        return bytes(opposite) * LENGTH
    rest = 255 - weight
    return bytes([(far * weight + near * rest) >> 8 for far, near in zip(opposite, selected)]) * LENGTH


# ── Slot 2: Breathing ───────────────────────────────────────────────────
def breath_init(settings) -> dict:
    return {"primary": effect_colours(settings)["primary"]}


def breath_step(state, settings, clock_ms, render) -> bytes:
    gain = envelope_gain(clock_ms, settings["rate"])
    return bytes([(channel * gain) >> 8 for channel in state["primary"]]) * LENGTH


# ── Slot 3: Ribbon ──────────────────────────────────────────────────────
def _clock_phase(clock: int, multiplier: int) -> int:
    return ((clock & U32) * multiplier >> 8) & 255


def streamer_wheel(phase: int, intensity: int) -> bytes:
    """The colour wheel below intensity 128."""
    if phase < 86:
        colour = (255 - 3 * phase, 3 * phase, 0)
    elif phase < 171:
        colour = (0, 3 * (170 - phase), 255 - 3 * (170 - phase))
    else:
        colour = (255 - 3 * (255 - phase), 0, 3 * (255 - phase))
    weight = 128 - intensity
    return bytes((
        (colour[0] * (255 - weight)) >> 8,
        (colour[1] * (255 - weight)) >> 8,
        (colour[2] * (255 - weight) + 3 * weight) >> 8,
    ))


def streamer_init(settings) -> dict:
    return {"table": effect_colours(settings)["table"]}


def streamer_step(state, settings, clock_ms, render) -> bytes:
    phase = _clock_phase(clock_ms, (settings["rate"] >> 2) + 2)
    if settings["intensity"] < 128:
        return streamer_wheel(phase, settings["intensity"]) * LENGTH
    table = state["table"]
    return table[3 * phase:3 * phase + 3] * LENGTH


# ── Slot 4: Moving palette ──────────────────────────────────────────────
def flow_init(settings) -> dict:
    scale = 16 << (settings["intensity"] // 29)
    return {
        "direction": settings["direction"],
        "cells": _colour_cells(effect_colours(settings)["table"]),
        # By logical pixel: the renderer draws them in reverse.
        "offsets": [(LENGTH - 1 - pixel) * scale // LENGTH for pixel in range(LENGTH)],
    }


def flow_step(state, settings, clock_ms, render) -> bytes:
    phase = _clock_phase(clock_ms, (settings["rate"] >> 2) + 10)
    cells = state["cells"]
    strip = b"".join([cells[(offset + phase) & 255] for offset in state["offsets"]])
    return place_strip(strip, state["direction"])


# ── Slot 7: Dual Scan ───────────────────────────────────────────────────
# Two blocks over black, a block and its mirror, showing the gradient they cover.
def scan_init(settings) -> dict:
    colours = effect_colours(settings)
    cells = _colour_cells(colours["table"])
    span = palette_span(len(colours["palette"]))
    return {
        "direction": settings["direction"],
        "gradient": b"".join(
            [cells[((pixel * 255 // (LENGTH - 1)) * span) >> 8] for pixel in range(LENGTH)]
        ),
        "period": (settings["rate"] ^ 255) * 150 + 250,
        "size": ((settings["intensity"] * LENGTH) >> 9) + 1,
    }


def scan_step(state, settings, clock_ms, render) -> bytes:
    period, size, gradient = state["period"], state["size"], state["gradient"]
    progress = (clock_ms % period) * 65535 // period
    room = LENGTH - size
    offset = abs((((progress << 1) & 0x1FFFE) * room >> 16) - room)
    strip = bytearray(3 * LENGTH)
    for first in (room - offset, offset):
        strip[3 * first:3 * (first + size)] = gradient[3 * first:3 * (first + size)]
    return place_strip(strip, state["direction"])


# ── Slot 8: Inline Bands ────────────────────────────────────────────────
def inline_shift(render: int, rate: int) -> int:
    """The shift a render draws with. It steps after each render where clock /
    (290 - rate) changed: the first (the quotient starts at 0, the Apply's clock
    is a multiple past it), and never at rate 0, where the quotient stays 0."""
    if rate == 0 or render == 0:
        return 0
    bucket = 290 - rate
    steps = render - 1 if bucket <= RENDER_MS else (render - 1) * RENDER_MS // bucket
    return (steps + 1) % LENGTH


def inline_init(settings) -> dict:
    return {
        "direction": settings["direction"],
        "bands": _band_strip(effect_colours(settings)["palette"]),
    }


def inline_step(state, settings, clock_ms, render) -> bytes:
    shift = inline_shift(render, settings["rate"])
    return place_strip(_rotated(state["bands"], shift), state["direction"])


# ── Slot 9: Triangular palette pulses ───────────────────────────────────
# Triangular cells over the second colour. Each cell's levels repeat, so the
# weights are worked out once per render, by position in the cell.
def pulse_init(settings) -> dict:
    colours = effect_colours(settings)
    table = colours["table"]
    cells = ((settings["intensity"] * (LENGTH >> 2)) >> 8) + 1
    width = LENGTH // cells
    margin = (LENGTH - cells * width) >> 1
    span = palette_span(len(colours["palette"]))
    lit = []
    for pixel in range(margin, margin + cells * width):
        index = 3 * (((pixel * 255 // (LENGTH - 1)) * span) >> 8)
        lit.append((3 * pixel, (pixel - margin) % width, table[index:index + 3]))
    return {
        "direction": settings["direction"],
        "levels": [triangle16(place * 65535 // width) for place in range(width)],
        "lit": lit,
        "secondary": colours["secondary"],
        "blank": bytes(colours["secondary"]) * LENGTH,
    }


def pulse_step(state, settings, clock_ms, render) -> bytes:
    phase = triangle16(clock_ms * ((settings["rate"] >> 2) + 8))
    threshold = (phase >> 1) + (phase >> 2)
    room = 65535 - threshold
    weights = [
        0 if level <= threshold else (level - threshold) * 255 // room
        for level in state["levels"]
    ]
    red, green, blue = state["secondary"]
    strip = bytearray(state["blank"])
    for at, place, colour in state["lit"]:
        weight = weights[place]
        if weight == 255:
            strip[at:at + 3] = colour
        elif weight:
            rest = 255 - weight
            strip[at] = (colour[0] * weight + red * rest) >> 8
            strip[at + 1] = (colour[1] * weight + green * rest) >> 8
            strip[at + 2] = (colour[2] * weight + blue * rest) >> 8
    return place_strip(strip, state["direction"])


# ── Slot 11: Sine wave ──────────────────────────────────────────────────
# Its phase counts the renders since the Apply.
def wave_init(settings) -> dict:
    primary = effect_colours(settings)["primary"]
    step = settings["intensity"] >> 4
    return {
        "direction": settings["direction"],
        "cells": [
            bytes(primary) if value == 0 else bytes((c * (255 - value)) >> 8 for c in primary)
            for value in range(256)
        ],
        "thetas": [(LENGTH - 1 - pixel) * step for pixel in range(LENGTH)],
        "advance": (settings["rate"] + 48) // 24,
    }


def wave_step(state, settings, clock_ms, render) -> bytes:
    phase = (render + 1) * state["advance"]
    cells = state["cells"]
    strip = bytearray(b"".join([cells[SIN8[(phase + theta) & 255]] for theta in state["thetas"]]))
    strip_blur(strip, settings["intensity"])
    return place_strip(strip, state["direction"])


# ── Slot 17: Spectrum ───────────────────────────────────────────────────
# A static gradient.
def spectrum_init(settings) -> dict:
    colours = effect_colours(settings)
    cells = _colour_cells(colours["table"])
    span = palette_span(len(colours["palette"]))
    strip = b"".join([cells[((pixel * 255 // LENGTH) * span) >> 8] for pixel in range(LENGTH)])
    return {"panel": place_strip(strip, settings["direction"])}


def spectrum_step(state, settings, clock_ms, render) -> bytes:
    return state["panel"]


# ── Slot 18: Pulse ──────────────────────────────────────────────────────
# Drawn from both ends: the middle index, written last, covers both centre pixels.
_SUNRISE_INDICES = (*range((LENGTH >> 1) - 1), LENGTH >> 1)


def pulse_spread(render: int, clock: int, rate: int) -> int:
    """Rate 1-60 ramps up over rate minutes, 61-120 down over rate - 60, and
    from 121 it cycles on the lamp's clock."""
    if rate == 0:
        return 65535
    if rate < 121:
        period = (rate if rate <= 60 else rate - 60) * 600
        ramp = min(render * RENDER_MS // 100, period) * 65535 // period
        return ramp if rate <= 60 else ramp ^ 65535
    return triangle16((clock >> 1) * (((rate - 120) >> 1) + 1))


def sunrise_init(settings) -> dict:
    return {
        "direction": settings["direction"],
        "cells": _colour_cells(effect_colours(settings)["table"]),
    }


def sunrise_step(state, settings, clock_ms, render) -> bytes:
    spread = pulse_spread(render, clock_ms, settings["rate"])
    intensity, cells = settings["intensity"], state["cells"]
    half = []
    for index in _SUNRISE_INDICES:
        value = triangle16(index * spread // LENGTH)
        half.append(cells[min(240, (value >> 8) + ((value * intensity) >> 15))])
    strip = b"".join(half) + b"".join(half[::-1])
    return place_strip(strip, state["direction"])


# ── Slot 28: Scrolling Bands ────────────────────────────────────────────
# Rate 255 gives a period of 0 and what the lamp shows is undefined: left black.
def scrolling_period(rate: int) -> int:
    step = 12800 // LENGTH + 1
    step -= step >> 4
    return step - rate * step // 255


def scrolling_init(settings) -> dict:
    return {
        "direction": settings["direction"],
        "bands": _band_strip(effect_colours(settings)["palette"]),
        "period": scrolling_period(settings["rate"]),
    }


def scrolling_step(state, settings, clock_ms, render) -> bytes:
    period = state["period"]
    if not period:
        return bytes(3 * LENGTH)
    strip = bytearray(_rotated(state["bands"], clock_ms // period % LENGTH))
    strip_blur(strip, settings["intensity"])
    return place_strip(strip, state["direction"])


# ── Slot 31: Palette Fade ───────────────────────────────────────────────
# The whole strip fades from entry to entry. Only green and blue are kept from
# the entry before (16 bits of it): red rises from 0 each time.
def fade_position(render: int, duration: int) -> tuple:
    """(entry, phase) of a render. The first entry runs phases 0..duration, the
    others 1..duration."""
    if render <= duration:
        return 0, render
    turns, phase = divmod(render - duration - 1, duration)
    return turns + 1, phase + 1


def fade_init(settings) -> dict:
    palette = effect_colours(settings)["palette"]
    return {
        "entries": [palette[pixel % len(palette)] for pixel in range(LENGTH)],
        "duration": int(f32(f32(f32((255 - settings["rate"]) / 255) * 80) + 1)),
    }


def fade_step(state, settings, clock_ms, render) -> bytes:
    entries, duration = state["entries"], state["duration"]
    entry, phase = fade_position(render, duration)
    red, green, blue = entries[entry % LENGTH]
    before = entries[(entry - 1) % LENGTH] if entry else (0, 0, 0)
    alpha = int(f32(f32(phase * 255) / duration))
    if alpha == 255:
        return bytes((red, green, blue)) * LENGTH
    rest = 255 - alpha
    return bytes((
        (red * alpha) >> 8,
        (before[1] * rest + green * alpha) >> 8,
        (before[2] * rest + blue * alpha) >> 8,
    )) * LENGTH


# ── Slot 52: Raw Red ────────────────────────────────────────────────────
def red_init(settings) -> dict:
    return {"panel": bytes((255, 0, 0)) * LENGTH}


# ── Slots 65, 66, 68, 69: Wipes ────────────────────────────────────────────────
# One-shot, raw colors: a frame every 20 ms from the Apply changes one pixel, so
# two a render, then the picture holds. 65 draws the wheel and 68 white from
# pixel 0 over black; 66 and 69 start from the wheel and white and go black from
# pixel N - 1.
_WIPE_FRAME_MS = 20


def wipe_wheel(value: int) -> tuple:
    """The wipes' colour wheel."""
    if value >= 171:
        rest = 255 - value
        return (255 - 3 * rest, 0, 3 * rest)
    if value >= 86:
        rest = 170 - value
        return (0, 3 * rest, 255 - 3 * rest)
    rest = 85 - value
    return (3 * rest, 255 - 3 * rest, 0)


def wipe_init(settings) -> dict:
    mode = settings["mode"]
    if mode in (65, 66):
        picture = b"".join(
            [bytes(wipe_wheel(pixel * 255 // (LENGTH - 1))) for pixel in range(LENGTH)]
        )
    else:
        picture = bytes((255, 255, 255)) * LENGTH
    return {"direction": settings["direction"], "picture": picture, "growing": mode in (65, 68)}


def wipe_step(state, settings, clock_ms, render) -> bytes:
    done = min(render * RENDER_MS // _WIPE_FRAME_MS + 1, LENGTH)
    kept = done if state["growing"] else LENGTH - done
    strip = state["picture"][:3 * kept] + bytes(3 * (LENGTH - kept))
    return place_strip(strip, state["direction"])


# ── Slot 70: Palette stripes ────────────────────────────────────────────
# Static. The renderer maps each cell itself, then the pixel writer maps it again.
# Intensity 0 divides by zero and what the lamp shows is undefined: left black.
def bands_init(settings) -> dict:
    direction, intensity = settings["direction"], settings["intensity"]
    strip = new_grid(*effect_geometry(settings))
    if intensity:
        width, height = effect_geometry(settings)
        colours = effect_colours(settings)
        table, span = colours["table"], palette_span(len(colours["palette"]))
        scale, cell_map = f32(128 / intensity), pixel_map(direction)
        for row in range(height):
            level = (int(f32(scale * row)) * 255 // height) & 255
            at = 3 * ((span * level) >> 8)
            for column in range(width):
                pixel = 3 * cell_map[row * width + column]
                strip[pixel:pixel + 3] = table[at:at + 3]
    return {"panel": place_strip(strip, direction)}


def bands_step(state, settings, clock_ms, render) -> bytes:
    return state["panel"]


SLOTS = (
    {"mode": 1, "init": alternate_init, "step": alternate_step, "warmup": 0},
    {"mode": 2, "init": breath_init, "step": breath_step, "warmup": 0},
    {"mode": 3, "init": streamer_init, "step": streamer_step, "warmup": 0},
    {"mode": 4, "init": flow_init, "step": flow_step, "warmup": 0},
    {"mode": 7, "init": scan_init, "step": scan_step, "warmup": 0},
    {"mode": 8, "init": inline_init, "step": inline_step, "warmup": 0},
    {"mode": 9, "init": pulse_init, "step": pulse_step, "warmup": 0},
    {"mode": 11, "init": wave_init, "step": wave_step, "warmup": 0},
    {"mode": 17, "init": spectrum_init, "step": spectrum_step, "warmup": 0},
    {"mode": 18, "init": sunrise_init, "step": sunrise_step, "warmup": 0},
    {"mode": 28, "init": scrolling_init, "step": scrolling_step, "warmup": 0},
    {"mode": 31, "init": fade_init, "step": fade_step, "warmup": 0},
    {"mode": 52, "init": red_init, "step": spectrum_step, "warmup": 0},
    {"mode": 65, "init": wipe_init, "step": wipe_step, "warmup": 0},
    {"mode": 66, "init": wipe_init, "step": wipe_step, "warmup": 0},
    {"mode": 68, "init": wipe_init, "step": wipe_step, "warmup": 0},
    {"mode": 69, "init": wipe_init, "step": wipe_step, "warmup": 0},
    {"mode": 70, "init": bands_init, "step": bands_step, "warmup": 0},
)
