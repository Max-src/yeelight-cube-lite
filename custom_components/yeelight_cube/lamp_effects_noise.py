"""Renderers of the lamp's noise fields: Bonfire, Ocean Waves,
slots 54 to 59, Neon, Wonderland and Kaleidoscope. All of them are functions of
the clock or the render count, so none has a warmup.
Mirrors www/lamp-effects-noise.js exactly; lamp_effects_core.py tells how
to add one."""

from __future__ import annotations

try:
    from .lamp_core import (
        LENGTH,
        SIN8,
        U32,
        blur_columns,
        convert_colour,
        effect_colours,
        effect_geometry,
        f32,
        hue_drive,
        inoise8_raw,
        inoise8_raw_2d,
        native_palette,
        noise_heat,
        palette_span,
        palette_table,
        place_strip,
    )
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_core import (
        LENGTH,
        SIN8,
        U32,
        blur_columns,
        convert_colour,
        effect_colours,
        effect_geometry,
        f32,
        hue_drive,
        inoise8_raw,
        inoise8_raw_2d,
        native_palette,
        noise_heat,
        palette_span,
        palette_table,
        place_strip,
    )

# The gradients of slots 55, 56, 57 and 59 and slot 58's two buffer
# gradients: (index, r, g, b), ending at index 255.
_GRADIENTS = {
    55: ((0, 255, 255, 255), (128, 255, 0, 81), (255, 169, 0, 255)),
    56: ((0, 30, 0, 60), (128, 0, 0, 255), (180, 128, 0, 128), (255, 255, 0, 255)),
    57: (
        (0, 25, 25, 112), (70, 0, 0, 128), (100, 0, 0, 255), (130, 173, 166, 230),
        (150, 255, 235, 92), (200, 255, 183, 0), (255, 255, 183, 0),
    ),
    58: ((0, 255, 255, 255), (255, 0, 0, 255)),
    "58navy": ((0, 0, 0, 128), (255, 0, 0, 0)),
    59: (
        (0, 25, 25, 112), (70, 0, 0, 128), (120, 0, 0, 255), (160, 173, 216, 230),
        (180, 255, 255, 224), (255, 255, 223, 255),
    ),
}
_SATURATE = bytes(min(value, 255) for value in range(511))


def _s16(value: int) -> int:
    return ((value + 0x8000) & 0xFFFF) - 0x8000


def gradient_palette(stops) -> list:
    """FastLED's loadDynamicGradientPalette and fill_gradient_RGB in one pass,
    each stop through the converter. Slots are index >> 4; below 16 stops a used slot moves to last + 1."""
    palette = [None] * 16
    last, position, start_index = -1, 0, 0
    start_colour = convert_colour(stops[0][1:])
    while start_index < 255:
        position += 1
        end_index, end_colour = stops[position][0], convert_colour(stops[position][1:])
        first, final = start_index >> 4, end_index >> 4
        if len(stops) < 16:
            if first <= last < 15:
                first, final = last + 1, max(final, last + 1)
            last = final
        low, high, low_colour, high_colour = first, final, start_colour, end_colour
        if high < low:
            low, high, low_colour, high_colour = high, low, end_colour, start_colour
        divisor = (high - low) or 1
        deltas = [
            _s16(int(((other - begin) << 7) / divisor) * 2)
            for begin, other in zip(low_colour, high_colour)
        ]
        accumulators = [value << 8 for value in low_colour]
        for slot in range(low, high + 1):
            palette[slot] = tuple(value >> 8 for value in accumulators)
            accumulators = [(value + delta) & 0xFFFF for value, delta in zip(accumulators, deltas)]
        start_index, start_colour = end_index, end_colour
    return palette


def _gradient_table(key) -> bytes:
    return palette_table(gradient_palette(_GRADIENTS[key]))


def _gain_table(table: bytes, gain: int) -> bytes:
    """The sampler's gain on a sampled table, gain neither 0 nor 255."""
    return table.translate(bytes((((gain + 1) & 255) * value) >> 8 for value in range(256)))


def _cells(table: bytes) -> list:
    """A sampled table by index, three bytes each, to join a strip from."""
    return [table[at:at + 3] for at in range(0, 768, 3)]


# ── Slot 34: Fire ───────────────────────────────────────────────────────
def fire_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "speed": settings["rate"] + 32,
        "cells": _cells(effect_colours(settings)["table"]),
        "xs": [(column << 7) & 0xFFFF for column in range(width)],
        "fades": [((height - row) * 255 // height) & 255 for row in range(height)],
    }


def fire_step(state, settings, clock_ms, render) -> bytes:
    width, height, cells, xs = state["width"], state["height"], state["cells"], state["xs"]
    base = ((clock_ms & 0xFFFF) * state["speed"]) // 160
    depth = (base & 0xFFFF) // 20
    strip = []
    for row, fade in enumerate(state["fades"]):
        y = (base + 128 * row) & 0xFFFF
        for x in xs:
            heat = noise_heat(inoise8_raw(x, y, depth)) - fade
            strip.append(cells[(heat * 240) >> 8 if heat > 0 else 0])
    work = bytearray(b"".join(strip))
    blur_columns(work, 128, width, height)
    return place_strip(work, state["direction"])


# ── Slot 42: Waves ──────────────────────────────────────────────────────
def ocean_init(settings) -> dict:
    width, height = effect_geometry(settings)
    scale = settings["intensity"]
    return {
        "direction": settings["direction"],
        "speed": settings["rate"] + 32,
        "cells": _cells(effect_colours(settings)["table"]),
        "angles": [
            (SIN8[(scale * row // 16) & 255] + SIN8[(scale * column // 16) & 255] - 256) & 255
            for row in range(height)
            for column in range(width)
        ],
    }


def ocean_step(state, settings, clock_ms, render) -> bytes:
    drift = (((clock_ms >> 4) * state["speed"]) & U32) >> 7
    cells = state["cells"]
    strip = b"".join([cells[SIN8[(angle + drift) & 255]] for angle in state["angles"]])
    return place_strip(strip, state["direction"])


# ── Slot 54: Rainbow noise ──────────────────────────────────────────────
def sunset_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {
        "direction": settings["direction"],
        "cells": _cells(palette_table(native_palette(0, 54))),  # the lamp's raw wheel
        "xs": [(16 // width) * column for column in range(width)],
        "ys": [(32 // height) * row & 0xFFFF for row in range(height)],
    }


def sunset_step(state, settings, clock_ms, render) -> bytes:
    moved, cells, xs = clock_ms >> 3, state["cells"], state["xs"]
    strip = []
    for y in state["ys"]:
        for x in xs:
            strip.append(cells[noise_heat(inoise8_raw_2d((moved + x) & 0xFFFF, y))])
    return place_strip(b"".join(strip), state["direction"])


# ── Slot 55: Flower Sea ─────────────────────────────────────────────────
def flower_init(settings) -> dict:
    width, height = effect_geometry(settings)
    speed = settings["rate"] * (1 / 64)
    table = _gradient_table(55)
    return {
        "direction": settings["direction"],
        "speed": 1 if speed < 1 else 4 if speed > 4 else f32(speed),
        "rows": [
            (
                [abs((column - width) * row) & 0xFFFF for column in range(width)],
                _cells(_gain_table(table, (192 + row * (63 // height)) & 255)),
            )
            for row in range(height)
        ],
    }


def flower_step(state, settings, clock_ms, render) -> bytes:
    time = f32(clock_ms * state["speed"])
    hundredth, depth = f32(time / 100), int(f32(time / 10)) & 0xFFFF
    strip = []
    for row, (xs, cells) in enumerate(state["rows"]):
        y = int(f32(hundredth + 50 * row)) & 0xFFFF
        for x in xs:
            strip.append(cells[noise_heat(inoise8_raw(x, y, depth))])
    return place_strip(b"".join(strip), state["direction"])


# ── Slot 56: Violet interference ────────────────────────────────────────
def carousel_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {
        "direction": settings["direction"],
        "cells": _cells(_gradient_table(56)),
        "angles": [
            int(SIN8[144 + 4 * row] * (column - 8) / 4) & 255
            for row in range(height)
            for column in range(width)
        ],
    }


def carousel_step(state, settings, clock_ms, render) -> bytes:
    moved, cells = clock_ms >> 3, state["cells"]
    strip = b"".join([cells[SIN8[(angle + moved) & 255]] for angle in state["angles"]])
    return place_strip(strip, state["direction"])


# ── Slots 57 and 59: Night-amber waves and Night-sky waves ────────────────────────────
# Pattern index i is stored at the buffer's cell i and the last pass reads it
# back through the mapper, so the pattern sits on the panel at any direction.
def _distances(centre: float) -> list:
    return [int(f32(f32(abs(f32(pixel - centre)) / centre) * 20)) for pixel in range(LENGTH)]


def yellow_init(settings) -> dict:
    return {"cells": _cells(_gradient_table(57)), "distances": _distances(f32(LENGTH / 15))}


def yellow_step(state, settings, clock_ms, render) -> bytes:
    period = clock_ms // (100 - settings["rate"] // 3)
    eighth, double, cells = period // 8, period * 2, state["cells"]
    return b"".join(
        [cells[(SIN8[(distance + eighth) & 255] + double) % 255] for distance in state["distances"]]
    )


def white_init(settings) -> dict:
    return {"cells": _cells(_gradient_table(59)), "distances": _distances(f32(LENGTH >> 4))}


def white_step(state, settings, clock_ms, render) -> bytes:
    moved, double, cells = clock_ms >> 7, (clock_ms >> 4) * 2, state["cells"]
    return b"".join(
        [cells[(SIN8[(distance + moved) & 255] + double) % 255] for distance in state["distances"]]
    )


# ── Slot 58: Navy-white noise ───────────────────────────────────────────
def ice_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {
        "direction": settings["direction"],
        "height": height,
        "light": _gradient_table(58),
        "shade": _gain_table(_gradient_table("58navy"), 128),
        "shades": [255 * column // width for column in range(width)],
    }


def ice_step(state, settings, clock_ms, render) -> bytes:
    light, shade, saturate = state["light"], state["shade"], _SATURATE
    across, up = clock_ms >> 4, clock_ms >> 2
    strip = bytearray(3 * LENGTH)
    at = 0
    for row in range(state["height"]):
        y = (up + 70 * row) & 0xFFFF
        for column, offset in enumerate(state["shades"]):
            heat = 3 * noise_heat(inoise8_raw_2d((across + 70 * column) & 0xFFFF, y))
            dark = 3 * ((render + offset) & 255)
            strip[at] = saturate[light[heat] + shade[dark]]
            strip[at + 1] = saturate[light[heat + 1] + shade[dark + 1]]
            strip[at + 2] = saturate[light[heat + 2] + shade[dark + 2]]
            at += 3
    return place_strip(strip, state["direction"])


# ── Slot 75: Neon sine bands ────────────────────────────────────────────
def neon_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "period": settings["rate"] * -0.5 + 250,
    }


def neon_step(state, settings, clock_ms, render) -> bytes:
    time = f32(clock_ms / state["period"])
    slow, fast = f32(time * 6), f32(time * 7)
    across = [
        SIN8[(SIN8[int(f32(slow + 2 * column)) & 255] + 8 * column) & 255] >> 1
        for column in range(state["width"])
    ]
    strip = bytearray()
    for row in range(state["height"]):
        along = SIN8[(8 * row + (SIN8[int(f32(fast + 2 * row)) & 255] >> 1)) & 255]
        for part in across:
            hue = along + part
            strip += bytes(hue_drive(hue - 360 if hue > 359 else hue))
    return place_strip(strip, state["direction"])


# ── Slot 77: Wonderland ─────────────────────────────────────────────────
# The global counters step on timers read at each 40 ms render: both on the
# first render (the clock is past their thresholds and they start at 0), the
# depth on every one, x every ceil((1000 - rate) / 40) renders. So both are
# functions of the render. The lamp keeps them over an Apply; here they
# start at 0.
def wonderland_init(settings) -> dict:
    width, height = effect_geometry(settings)
    rate = settings["rate"]
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "period": -(-(1000 - rate) // 40),
        "depth": rate // 20,
    }


def wonderland_step(state, settings, clock_ms, render) -> bytes:
    offset = 1 + render // state["period"]
    depth = (state["depth"] * (render + 1)) & 0xFFFF
    width = state["width"]
    strip = bytearray()
    for row in range(state["height"]):
        y = 25 * row
        for column in range(width):
            heat = noise_heat(inoise8_raw((offset + 25 * column) & 0xFFFF, y, depth))
            strip += bytes(hue_drive((heat >> 1) + 220))
    return place_strip(strip, state["direction"])


# ── Slot 80: Kaleidoscope ───────────────────────────────────────────────
def kaleidoscope_init(settings) -> dict:
    centre = f32(LENGTH / 1.3)
    colours = effect_colours(settings)
    halves = []
    for pixel in range(LENGTH):
        distance = abs(int(f32(f32(pixel) - centre)))
        halves.append(f32(SIN8[int(f32(f32(f32(distance) / centre) * 127)) & 255] * 0.5))
    return {
        "direction": settings["direction"],
        "cells": _cells(colours["table"]),
        "span": palette_span(len(colours["palette"])),
        "period": (255 - settings["rate"]) * 40 // 255 + 20,
        "every": settings["rate"] // 85 + 1,
        "halves": halves,
    }


def kaleidoscope_step(state, settings, clock_ms, render) -> bytes:
    step = clock_ms // state["period"]
    offset, drift = step // 8 + 128, f32(step)
    phase = (1 + render // state["every"]) & 0xFFFF
    cells, span = state["cells"], state["span"]
    strip = []
    for half in state["halves"]:
        second = SIN8[int(f32(drift + half)) & 255] - 128
        third = SIN8[(offset + second) & 255] - 128
        strip.append(cells[(((third + phase + 128) & 255) * span) >> 8])
    return place_strip(b"".join(strip), state["direction"])


SLOTS = (
    {"mode": 34, "init": fire_init, "step": fire_step, "warmup": 0},
    {"mode": 42, "init": ocean_init, "step": ocean_step, "warmup": 0},
    {"mode": 54, "init": sunset_init, "step": sunset_step, "warmup": 0},
    {"mode": 55, "init": flower_init, "step": flower_step, "warmup": 0},
    {"mode": 56, "init": carousel_init, "step": carousel_step, "warmup": 0},
    {"mode": 57, "init": yellow_init, "step": yellow_step, "warmup": 0},
    {"mode": 58, "init": ice_init, "step": ice_step, "warmup": 0},
    {"mode": 59, "init": white_init, "step": white_step, "warmup": 0},
    {"mode": 75, "init": neon_init, "step": neon_step, "warmup": 0},
    {"mode": 77, "init": wonderland_init, "step": wonderland_step, "warmup": 0},
    {"mode": 80, "init": kaleidoscope_init, "step": kaleidoscope_step, "warmup": 0},
)
