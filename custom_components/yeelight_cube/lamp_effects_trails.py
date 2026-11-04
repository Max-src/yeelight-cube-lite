"""Renderers of the lamp's trails and blocks, with the sine plotter
and its stacking blocks and fading dots.
Mirrors www/lamp-effects-trails.js exactly; lamp_effects_core.py tells how
to add one."""

from __future__ import annotations

import math

try:
    from .lamp_core import (
        LENGTH,
        RENDER_MS,
        SIN8,
        U32,
        beat,
        blend_grid,
        blur_columns,
        bpm88,
        convert_colour,
        effect_colours,
        effect_geometry,
        effective_direction,
        f32,
        fade_grid,
        fade_towards,
        new_grid,
        palette_span,
        place_strip,
        row_blur_grid,
        random_source,
        source_word,
    )
    from .lamp_effects_core import SLOTS as CORE_SLOTS
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_core import (
        LENGTH,
        RENDER_MS,
        SIN8,
        U32,
        beat,
        blend_grid,
        blur_columns,
        bpm88,
        convert_colour,
        effect_colours,
        effect_geometry,
        effective_direction,
        f32,
        fade_grid,
        fade_towards,
        new_grid,
        palette_span,
        place_strip,
        row_blur_grid,
        random_source,
        source_word,
    )
    from lamp_effects_core import SLOTS as CORE_SLOTS


# ── Slot 15: Aurora ─────────────────────────────────────────────────────
def _aurora_spawn(state) -> dict:
    """Seven source reads: colour, ttl, alpha, width, centre, direction, speed."""
    draw = state["draw"]
    state["draw"] = draw + 7
    index = (source_word(draw) & 255) * LENGTH >> 8
    index = (index * 255 // (LENGTH - 1)) & 255
    at = 3 * ((index * state["span"]) >> 8)
    tenth = LENGTH // 10
    width = (((source_word(draw + 3) & 65535) * (((LENGTH >> 2) - tenth) & 65535)) >> 16) + tenth
    width &= 65535
    return {
        "colour": state["table"][at:at + 3],
        "ttl": (((source_word(draw + 1) & 65535) * 1001) >> 16) + 500,
        "alpha": f32(f32(((source_word(draw + 2) & 65535) * 31 >> 16) + 70) / 100),
        "width": width or 1,
        "centre": f32(LENGTH * f32(((source_word(draw + 4) & 65535) * 101 >> 16) / 100)),
        "left": ((source_word(draw + 5) >> 15) & 1) ^ 1,
        "speed": f32(f32(f32(f32(((source_word(draw + 6) >> 12) & 15) + 15) / 100) * 4) / 255),
        "age": 0,
    }


def aurora_init(settings) -> dict:
    colours = effect_colours(settings)
    return {
        "direction": settings["direction"],
        "table": colours["table"],
        "span": palette_span(len(colours["palette"])),
        "backlight": 1 + sum(1 for word in colours["words"][:3] if any(word)),
        "count": int(f32(f32(settings["intensity"] / 255) * 20)),
        "move": f32(settings["rate"] * 205 // 255 + 50),
        "draw": 0,
        "waves": None,
    }


def aurora_step(state, settings, clock_ms, render) -> bytes:
    waves = state["waves"]
    if waves is None:
        waves = state["waves"] = [_aurora_spawn(state) for _ in range(state["count"])]
    move = state["move"]
    for index, wave in enumerate(waves):
        moved = f32(wave["speed"] * move)
        centre = wave["centre"] = f32(wave["centre"] + (-moved if wave["left"] else moved))
        wave["age"] = (wave["age"] + 1) & 65535
        reach = wave["width"]
        if wave["age"] > wave["ttl"] or (
            f32(centre + reach) < 0 if wave["left"] else f32(centre - reach) > LENGTH
        ):
            waves[index] = _aurora_spawn(state)
    # Adds never go negative: the channel's sum saturates whatever the order.
    light = [state["backlight"]] * (3 * LENGTH)
    for wave in waves:
        centre, reach, age, ttl = wave["centre"], wave["width"], wave["age"], wave["ttl"]
        first = max(0, math.ceil(f32(centre - reach)))
        last = min(LENGTH - 1, math.floor(f32(centre + reach)))
        if first > last:
            continue
        height = f32((age if f32(age / ttl) < 0.5 else f32(ttl - age)) / (ttl * 0.5))
        alpha = wave["alpha"]
        red, green, blue = wave["colour"]
        for pixel in range(first, last + 1):
            factor = f32(alpha * f32(f32(1 - f32(abs(f32(pixel - centre)) / reach)) * height))
            at = 3 * pixel
            light[at] += int(f32(red * factor))
            light[at + 1] += int(f32(green * factor))
            light[at + 2] += int(f32(blue * factor))
    return place_strip([value if value < 255 else 255 for value in light], state["direction"])


# ── Slot 19: Heat fire ──────────────────────────────────────────────────
def solar_flare_init(settings) -> dict:
    rate = settings["rate"]
    return {
        "direction": settings["direction"],
        "table": effect_colours(settings)["table"],
        "cooling": ((100 + 5 * (rate // 3)) // LENGTH) & 255,
        "spark": 30 + 20 * rate // 255,
        "heat": [0] * LENGTH,
        "bucket": 0,
        "draw": 0,
    }


def solar_flare_step(state, settings, clock_ms, render) -> bytes:
    heat, cooling, draw = state["heat"], state["cooling"], state["draw"]
    for pixel in range(LENGTH):
        left = heat[pixel] - ((((source_word(draw) & 255) * cooling >> 8) + 2) & 255)
        heat[pixel] = left if left > 8 else 8
        draw += 1
    bucket = (clock_ms // 32) & U32
    if bucket != state["bucket"]:
        state["bucket"] = bucket
        for pixel in range(LENGTH - 1, 1, -1):
            heat[pixel] = (heat[pixel - 1] + 2 * heat[pixel - 2]) // 3
        draw += 1
        if random_source(draw - 1) <= state["spark"]:
            pixel = (random_source(draw) * (LENGTH // 3)) >> 8
            spark = heat[pixel] + 64 + ((random_source(draw + 1) * 134) >> 8)
            heat[pixel] = spark if spark < 255 else 255
            draw += 2
    state["draw"] = draw
    table = state["table"]
    return place_strip(b"".join([table[3 * value:3 * value + 3] for value in heat]), state["direction"])


# ── Slot 21: Stacking blocks ────────────────────────────────────────────
# One block at a time, one pixel high, falling on the pile. Each step asks for
# its next run: 25 ms, 250 after a clear, 1000 once the pile is full. The lamp
# runs it at the first tick of its 20 ms grid strictly after that, so the renders
# before it show the same frame and count for nothing.
_STACK_SCALE = float.fromhex("0x1.85f06f6944674p-6")  # the lamp's 1/42


def stack_init(settings) -> dict:
    return {
        "direction": settings["direction"],
        "draw": 0,
        "palette": [bytes(colour) for colour in effect_colours(settings)["palette"]],
        "due": None,  # ms after the Apply; None before the first run
        "phase": 0,  # 0 new block, 1 waiting, 2 falling
        "pile": 0,
        "cursor": 0,
        "position": 0.0,
        "speed": 0.0,
        "colour": bytes(3),
        "strip": bytearray(3 * LENGTH),
        "panel": b"",
    }


def _stack_clear(state) -> int:
    state["cursor"], state["pile"], state["phase"] = 0, 0, 0
    state["strip"][:] = bytes(3 * LENGTH)
    return 250


def _stack_run(state, rate: int) -> int:
    """One step: what it asks to wait, in ms."""
    if state["pile"] >= LENGTH:
        return _stack_clear(state)
    if state["phase"] == 0:
        if rate:
            pace = (rate >> 2) + 1
        else:
            pace = ((random_source(state["draw"]) * 58) >> 8) + 6
            state["draw"] += 1
        state["speed"], state["position"] = f32(pace * _STACK_SCALE), f32(LENGTH)
        palette = state["palette"]
        state["colour"] = palette[(state["cursor"] % LENGTH) % len(palette)]  # black is not skipped
        state["cursor"] = (state["cursor"] + 1) & U32
        state["phase"] = 1
    if state["phase"] == 1:
        state["draw"] += 1
        if random_source(state["draw"] - 1) < 64:
            return 25
        state["phase"] = 2
    pile = f32(state["pile"])
    if not state["position"] > pile:
        state["phase"] = 0
        state["pile"] += 1
        return 1000 if state["pile"] >= LENGTH else 25
    position = state["position"] = max(f32(state["position"] - state["speed"]), pile)
    first = int(position)
    if first < LENGTH:
        strip = state["strip"]
        end = min(LENGTH, math.ceil(f32(position + 1)))
        strip[3 * first:3 * end] = state["colour"] * (end - first)
        strip[3 * end:] = bytes(3 * (LENGTH - end))
    return 25


def stack_step(state, settings, clock_ms, render) -> bytes:
    now = render * RENDER_MS
    if state["due"] is not None and now < state["due"]:
        return state["panel"]
    wait = _stack_clear(state) if state["due"] is None else _stack_run(state, settings["rate"])
    state["due"] = now + (wait // 20 + 1) * 20
    state["panel"] = place_strip(state["strip"], state["direction"])
    return state["panel"]


# ── Slot 32: Waterfall ──────────────────────────────────────────────────
# Reads by render: gate source 2 * render, column 2 * render + 1. The step gate
# passes on every multiple of ceil(((256 - rate) >> 1) / 40) renders (from
# render 0, the clock already past the gate), 4 at worst. A drop leaves the grid
# after 34 steps at most; the source's longest spawn gap can empty one grid before
# the other and spawn on it alone. Empirical, not derived: 39 steps meet the run
# from every render around every long gap of the first 2^26 renders (15 days),
# on both geometries and all four periods, at the preset's intensity of 128.
_WATERFALL_WARMUP = 39 * 4 - 1
_WATERFALL_FADE = bytes((value * 192) >> 8 for value in range(256))


def waterfall_init(settings) -> dict:
    width, height = effect_geometry(settings)
    primary = bytes(effect_colours(settings)["primary"])
    return {
        "direction": settings["direction"],
        "width": width,
        "primary": primary,
        "half": bytes(channel >> 1 for channel in primary),
        "period": max(1, (((256 - settings["rate"]) >> 1) + 39) // 40),
        "work": new_grid(width, height),
    }


def waterfall_step(state, settings, clock_ms, render) -> bytes:
    work = state["work"]
    if render % state["period"] == 0:
        primary, half, width = state["primary"], state["half"], state["width"]
        stride = 3 * width
        size = len(work)
        held = [at for at in range(size - 3, -1, -3) if work[at:at + 3] == primary]
        moved = []
        for at in held:
            work[at:at + 3] = half
            if at + stride < size:
                work[at + stride:at + stride + 3] = primary
                moved.append(at + stride)
        work[:] = work.translate(_WATERFALL_FADE)
        for at in moved:
            work[at:at + 3] = primary
        if not any(work) or random_source(2 * render) < settings["intensity"]:
            column = (random_source(2 * render + 1) * width) >> 8
            at = 3 * (0 if width <= column else column)
            work[at:at + 3] = primary
    return place_strip(work, state["direction"])


# ── Slot 35: Tide (slot 35) ─────────────────────────────────────────────
# The same renderer as Tide.
_TIDE = next(slot for slot in CORE_SLOTS if slot["mode"] == 48)


# ── Slot 37: Bouncing Ball ──────────────────────────────────────────────
# Nothing but the grid carries over, and it halves every render, yet a slow dot
# holds a 1 back for a while. Empirical, not derived: 32 renders meet the run from
# every render of the 2^18 of a clock cycle, at every rate, on both geometries,
# on 10 palettes (the default, the fixture's and full primaries).
_PINBALL_WARMUP = 32


def pinball_init(settings) -> dict:
    width, height = effect_geometry(settings)
    rate, intensity = settings["rate"], settings["intensity"]
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "table": effect_colours(settings)["table"],
        "speeds": [
            (bpm88((rate >> 3) + 8 - dot), bpm88((intensity >> 3) + dot - 8)) for dot in range(8)
        ],
        "work": new_grid(width, height),
    }


def pinball_step(state, settings, clock_ms, render) -> bytes:
    width, height, work = state["width"], state["height"], state["work"]
    fade_grid(work, 128, width, height)
    index = (beat(clock_ms, 12 << 8) * 255 >> 9) | 128
    red, green, blue = state["table"][3 * index:3 * index + 3]
    for across, down in state["speeds"]:
        across, down = beat(clock_ms, across), beat(clock_ms, down)
        x, y = (across * width) >> 8, (down * height) >> 8
        first = 3 * ((y if y < height else 0) * width + (x if x < width else 0))
        x, y = (across * (width - 1)) >> 8, (down * (height - 1)) >> 8
        second = 3 * ((y if y < height else 0) * width + (x if x < width else 0))
        work[first] = min(255, work[second] + red)
        work[first + 1] = min(255, work[second + 1] + green)
        work[first + 2] = min(255, work[second + 2] + blue)
    row_blur_grid(work, width, height)
    blur_columns(work, 16, width, height)
    return place_strip(work, state["direction"])


# ── Slot 38: Sine plotter ───────────────────────────────────────────────
# Every 10th render plots one cell in raw white, nothing converted, on a sine of
# the global phase; nothing is ever erased. The phase starts at 0 here (as after
# the lamp powers on), and 256 phases are all the cells there are: a pure function
# of the render.
_PLOTTER_RENDERS = 10
_PLOTTER_WHITE = bytes((255, 255, 255))


def plotter_init(settings) -> dict:
    width, height = effect_geometry(settings)
    plotted: dict[int, int] = {}
    for phase in range(256):
        column = int((width + 5) * (0 if phase == 255 else phase) / 255 + 0 + 0.5)
        row = int(SIN8[phase] * 3 / 255 + 0 + 3)
        cell = (row if row < height else 0) * width + (column if column < width else 0)
        plotted.setdefault(cell, phase)
    return {
        "direction": settings["direction"],
        "cells": list(plotted.items()),  # by first phase
        "phases": -1,
        "panel": b"",
    }


def plotter_step(state, settings, clock_ms, render) -> bytes:
    phases = min(render // _PLOTTER_RENDERS, 255)
    if phases != state["phases"]:
        state["phases"] = phases
        strip = bytearray(3 * LENGTH)
        for cell, phase in state["cells"]:
            if phase > phases:
                break
            strip[3 * cell:3 * cell + 3] = _PLOTTER_WHITE
        state["panel"] = place_strip(strip, state["direction"])
    return state["panel"]


# ── Slot 46: Hacking ────────────────────────────────────────────────────
# A record's row only depends on the render: 5 k, plus one on the first render
# and on every period. The blend takes any cell to its floor in 8 visits, one a
# render at least: a fresh grid is the run's 7 renders later.
_HACKING_WARMUP = 7
_HACKING_GLYPHS = (1, 0, 1, 0, 0, 1, 1, 0, 0, 0)  # each record's digit
_HACKING_SOURCES = ((0x06, 0x3E, 0x29), (0x76, 0xFF, 0xCE), (0x00, 0xD4, 0x88))  # the three greens
_HACKING_BITMAPS = (0xF6F, 0xE93)  # digits 0 and 1


def _hacking_cells(bitmap: int, y: int, width: int, height: int) -> tuple:
    """Where a 3 x 4 digit lands on rows y - 5 .. y - 2."""
    cells = []
    for row in range(y - 5, y - 1):
        if row >= 0:
            for bit in range(3):
                if bitmap & (1 << bit):
                    x = bit + 1 if bit + 1 < width else 0
                    cells.append(3 * ((row if row < height else 0) * width + x))
        bitmap = (bitmap >> 3) & 0x1FFF
    return tuple(cells)


def hacking_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {
        "direction": effective_direction(settings),
        "width": width,
        "height": height,
        "period": ((settings["rate"] ^ 0xF0) >> 4) + 1,
        "colours": [bytes(convert_colour(_HACKING_SOURCES[k % 3])) for k in range(10)],
        "digits": [
            [_hacking_cells(bitmap, y, width, height) for y in range(height + 5)]
            for bitmap in _HACKING_BITMAPS
        ],
        "work": new_grid(width, height),
    }


def hacking_step(state, settings, clock_ms, render) -> bytes:
    width, height, work = state["width"], state["height"], state["work"]
    blend_grid(work, 128, width, height, (0, 2, 1))
    moved, top = render // state["period"] + 1, height + 5
    for record, colour in enumerate(state["colours"]):
        y = (5 * record + moved) % 50
        if y < top:
            for at in state["digits"][_HACKING_GLYPHS[record]][y]:
                work[at:at + 3] = colour
    return place_strip(work, state["direction"])


# ── Slot 47: Meteor ─────────────────────────────────────────────────────
def _meteor_spawn(state, meteor, clock_ms) -> None:
    """A meteor's spawn: speed, start, colour, column."""
    draw = state["draw"]
    state["draw"] = draw + 4
    meteor["speed"] = f32(((random_source(draw) * 3) >> 8) + 1)
    meteor["start"] = f32(-50 - ((random_source(draw + 1) * 50) >> 8))
    at = 3 * ((random_source(draw + 2) * 255 // (LENGTH - 1)) & 255)
    meteor["colour"] = state["table"][at:at + 3]
    meteor["column"] = (state["width"] * random_source(draw + 3)) >> 8
    meteor["time"] = clock_ms


def meteor_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "table": effect_colours(settings)["table"],
        "count": ((settings["intensity"] >> 3) + 10) & 255,
        "pace": (settings["rate"] + 32) >> 4,
        "draw": 0,
        "meteors": None,
    }


def meteor_step(state, settings, clock_ms, render) -> bytes:
    width, height, pace = state["width"], state["height"], state["pace"]
    meteors = state["meteors"]
    if meteors is None:
        meteors = state["meteors"] = [{} for _ in range(state["count"])]
        for meteor in meteors:
            _meteor_spawn(state, meteor, clock_ms)
            value = random_source(state["draw"])
            state["draw"] += 1
            meteor["start"] = f32(((value * ((2 * height) & 255)) >> 8) - height)
    work = bytearray(3 * width * height)

    def put(row, column, colour, scale):
        at = 3 * (row * width + column)
        work[at] = (colour[0] * scale) >> 8
        work[at + 1] = (colour[1] * scale) >> 8
        work[at + 2] = (colour[2] * scale) >> 8

    for meteor in meteors:
        elapsed = clock_ms - meteor["time"]
        if elapsed < 0:
            elapsed += 1 << 64
        position = f32(meteor["start"] + f32(meteor["speed"] * pace) * (elapsed / 1000))
        trail = f32(meteor["speed"] * 2.5 + 1)
        if not position <= f32(height + f32(trail + trail)):
            draw = state["draw"]
            state["draw"] = draw + 1
            if random_source(draw) < 128:
                _meteor_spawn(state, meteor, clock_ms)
                position = meteor["start"]
        speed, colour, column = meteor["speed"], meteor["colour"], meteor["column"]
        # Off the grid a draw lands 3 bytes before the buffer, which nothing reads.
        first = int(f32(position - 2))
        last = math.ceil(position) + 10
        fade = f32(f32(speed - 1) * 0.2 + 0.4)
        bright = int(fade * 255)
        for row in range(max(first, 0), min(last, height - 1) + 1):
            e = f32((abs(f32(row - position)) - 0.5) * 0.5)
            if e < 0:
                put(row, column, colour, bright)
            elif e <= 1:
                put(row, column, colour, int(f32(fade * f32(255 - e * 255))))
        length = int(f32(speed * 2.5 + 1))
        limit = f32(position - length)
        row = min(int(position), height - 1)
        while row >= limit and row >= 0:
            e = f32((abs(f32(row - position)) - 0.5) / length)
            if e < 0:
                put(row, column, colour, bright)
            elif e <= 1:
                put(row, column, colour, int(f32(fade * f32(255 - f32(e * e) * 255))))
            row -= 1
    return place_strip(work, state["direction"])


# ── Slot 49: Building Blocks ────────────────────────────────────────────
# Records by row * W + column; a block's colour is always the primary. The
# random stand-in's draws start at 1 here.
def blocks_init(settings) -> dict:
    width, height = effect_geometry(settings)
    rate, intensity = settings["rate"], settings["intensity"]
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "primary": bytes(effect_colours(settings)["primary"]),
        "gate": ((rate * 104 // 255 + 64) >> 3) + 1,
        "landing": ((rate ^ 255) + 16) >> 4,
        "falling": ((rate ^ 255) + 16) >> 5,
        "fade": ((intensity >> 1) | 128) & 255,
        "kinds": [0] * LENGTH,  # 0 empty, 1 falling, 2 settled
        "due": [0] * LENGTH,
        "draw": 1,
        "work": new_grid(width, height),
    }


def blocks_step(state, settings, clock_ms, render) -> bytes:
    width, height, work = state["width"], state["height"], state["work"]
    kinds, due, draw = state["kinds"], state["due"], state["draw"]
    source = random_source(draw)
    draw += 1
    if ((state["gate"] * source) >> 8) & 255 == 0:
        for _ in range(width + 1):
            column = random_source(draw)
            draw += 1
            slot = (height - 1) * width + ((column * width) >> 8)
            if kinds[slot] == 0:
                kinds[slot] = 1
                due[slot] = render + state["landing"]
                break
    state["draw"] = draw
    for column in range(width):
        for here in range(column, width * height, width):
            if kinds[here] != 1 or due[here] > render:
                continue
            if here >= width and kinds[here - width] == 0:
                kinds[here - width] = 1
                due[here - width] = render + state["falling"]
                kinds[here], due[here] = 0, 0
            else:
                kinds[here] = 2
    fade_grid(work, state["fade"], width, height)
    primary = state["primary"]
    painted = 0
    for here, kind in enumerate(kinds):
        if kind:
            work[3 * here:3 * here + 3] = primary
            painted += 1
    if painted >= LENGTH:
        state["kinds"] = [0] * LENGTH
        state["due"] = [0] * LENGTH
    return place_strip(work, state["direction"])


# ── Slot 62: Dot trail ──────────────────────────────────────────────────
# A dot on every other period, two pixels further: all a pure function of the
# render. Only the strip carries over, and its fade is slowest at rate 0 (amount
# 210), where a dot's 251 takes 68 renders to go, so 67 rebuild any frame.
_DOT_TRAIL_WARMUP = 67
_DOT_TRAIL_LEVEL = (LENGTH - 1) * 255 // LENGTH  # the last of the N writes wins


def dot_trail_init(settings) -> dict:
    rate = settings["rate"]
    return {
        "direction": settings["direction"],
        "period": 20 + int(-10 * rate / 255),
        "amount": (rate * 30 // 255 + 210) & 255,
        "colour": bytes((channel * _DOT_TRAIL_LEVEL) >> 8 for channel in effect_colours(settings)["primary"]),
        "strip": bytearray(3 * LENGTH),
    }


def dot_trail_step(state, settings, clock_ms, render) -> bytes:
    strip = state["strip"]
    fade_towards(strip, state["amount"])
    turn, rest = divmod(render, state["period"])
    if turn & 1 and not rest:
        at = 3 * ((turn - 1) % LENGTH)
        strip[at:at + 3] = state["colour"]
    return place_strip(strip, state["direction"])


SLOTS = (
    {"mode": 15, "init": aurora_init, "step": aurora_step, "warmup": None},
    {"mode": 19, "init": solar_flare_init, "step": solar_flare_step, "warmup": None},
    {"mode": 21, "init": stack_init, "step": stack_step, "warmup": None, "lit": 1},
    {"mode": 32, "init": waterfall_init, "step": waterfall_step, "warmup": _WATERFALL_WARMUP},
    {**_TIDE, "mode": 35},
    {"mode": 37, "init": pinball_init, "step": pinball_step, "warmup": _PINBALL_WARMUP},
    {"mode": 38, "init": plotter_init, "step": plotter_step, "warmup": 0, "lit": 1},
    {"mode": 46, "init": hacking_init, "step": hacking_step, "warmup": _HACKING_WARMUP},
    {"mode": 47, "init": meteor_init, "step": meteor_step, "warmup": None},
    {"mode": 49, "init": blocks_init, "step": blocks_step, "warmup": None},
    {"mode": 62, "init": dot_trail_init, "step": dot_trail_step, "warmup": _DOT_TRAIL_WARMUP, "lit": 1},
)
