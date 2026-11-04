"""Renderers of the lamp's music slots, on the demo beat
(lamp_core.py): Breathing (20, 44), the bars (25, 26, 30), Music (27),
Spectrum (41), Gather (43), Blossom (45), the noise equalizer (51), Note (73)
and Impact (74). Mirrors www/lamp-effects-music.js exactly;
lamp_effects_core.py tells how to add one.

Nothing here hears the lamp: each step reads its render's packet from
demo_sound on its first line, the one place a real source would go.
"""

from __future__ import annotations

import math

try:
    from .lamp_core import (
        LENGTH,
        blend_grid,
        blur_columns,
        demo_sound,
        effect_colours,
        effect_geometry,
        f32,
        fade_grid,
        fade_towards,
        inoise8_raw,
        lround,
        new_grid,
        noise_heat,
        palette_span,
        pixel_map,
        place_strip,
        row_blur_grid,
        source_word,
        sx8,
    )
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_core import (
        LENGTH,
        blend_grid,
        blur_columns,
        demo_sound,
        effect_colours,
        effect_geometry,
        f32,
        fade_grid,
        fade_towards,
        inoise8_raw,
        lround,
        new_grid,
        noise_heat,
        palette_span,
        pixel_map,
        place_strip,
        row_blur_grid,
        source_word,
        sx8,
    )


# A warmup here is the worst start over the demo loop (and the rates and
# intensities that matter, swept against a full replay): the smoothers forget
# because the beat is periodic. A real source would void these counts.


def _grid_state(settings) -> dict:
    """What the grid renderers share: the box, its colours, a black grid."""
    width, height = effect_geometry(settings)
    colours = effect_colours(settings)
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "table": colours["table"],
        "span": palette_span(len(colours["palette"])),
        "work": new_grid(width, height),
    }


# ── Slots 20 and 44: Breathing ──────────────────────────────────────────
_BREATHING_20_WARMUP = 35
_BREATHING_44_WARMUP = 11


def _breathing_init(settings, weight: int) -> dict:
    return {
        "table": effect_colours(settings)["table"],
        "weight": weight,
        "level": 0,  # the smoothed level, shared across slots
    }


def breathing_20_init(settings) -> dict:
    return _breathing_init(settings, 4)


def breathing_44_init(settings) -> dict:
    return _breathing_init(settings, 1)


def breathing_step(state, settings, clock_ms, render) -> bytes:
    level, _, tick, _ = demo_sound(render)
    weight = state["weight"]
    smoothed = state["level"] = (weight * state["level"] + level) // (weight + 1)
    bright = smoothed & 255
    at = 3 * (0 if tick == 255 else tick)
    red, green, blue = state["table"][at:at + 3]
    if bright != 255:  # the sampler's gain
        gain = bright + 1
        red, green, blue = (red * gain) >> 8, (green * gain) >> 8, (blue * gain) >> 8
    return bytes((red, green, blue)) * LENGTH  # one colour: no placement


# ── Slots 30, 26 and 25: the bars ───────────────────────────────────────
# Selector 0 draws pixels 0.., 1 from the centre outwards, 2 from both ends
# inwards. The lamp's 16-bit wrap never shows: bars <= N >> (selector != 0).
_WHITE = b"\xff\xff\xff"
_BARS_WARMUP = 36  # the level, then the peak's next catch


def _bars_init(settings, selector: int) -> dict:
    colours = effect_colours(settings)
    return {
        "direction": settings["direction"],
        "table": colours["table"],
        "span": palette_span(len(colours["palette"])),
        "selector": selector,
        "width": f32(LENGTH >> (1 if selector else 0)),
        "limit": 8 - (settings["rate"] >> 5),
        "strip": bytearray(3 * LENGTH),
        "level": 0,
        "index": 0,
        "peak": 0,
    }


def bars_30_init(settings) -> dict:
    return _bars_init(settings, 0)


def bars_26_init(settings) -> dict:
    return _bars_init(settings, 1)


def bars_25_init(settings) -> dict:
    return _bars_init(settings, 2)


def _bars_draw(strip, selector: int, first: int, last: int, colour: bytes) -> None:
    """Steps first..last - 1 of a bar, in one colour."""
    run = colour * (last - first)
    if selector == 1:
        mid = LENGTH >> 1
        strip[3 * (mid + first):3 * (mid + last)] = run
        strip[3 * (mid - last):3 * (mid - first)] = run
    else:
        strip[3 * first:3 * last] = run
        if selector == 2:
            strip[3 * (LENGTH - last):3 * (LENGTH - first)] = run


def bars_step(state, settings, clock_ms, render) -> bytes:
    level, _, _, spectrum = demo_sound(render)
    strip, selector, width = state["strip"], state["selector"], state["width"]
    smoothed = state["level"] = (2 * state["level"] + level) // 3
    fade_towards(strip, 254)
    gain = f32(f32(f32(f32(smoothed) * f32(settings["intensity"])) / 255.0) * 0.125)
    span = f32(width * (gain + gain) * 0.03125)
    bars = 1 if span < 1 else int(span if span <= width else width)
    if render & 3 == 0:  # the strictly loudest band; band 15 only wins alone
        best, index = spectrum[0], state["index"]
        if best:
            index = 0
        for band in range(1, 15):
            if best < spectrum[band]:
                index, best = band, spectrum[band]
        state["index"] = (index * 17) & 0xFFFF if best >= spectrum[15] else 255
    at = 3 * ((state["span"] * (state["index"] & 255)) >> 8)
    _bars_draw(strip, selector, 0, bars, state["table"][at:at + 3])
    peak = state["peak"]
    if bars >= peak:
        peak = bars - 1
    elif render % state["limit"] == 0:  # the hold counter, from 0 at the Apply
        peak -= 1
    state["peak"] = peak
    if peak >= 0:
        _bars_draw(strip, selector, peak, peak + 1, _WHITE)
    return place_strip(strip, state["direction"])


# ── Slot 27: Music ──────────────────────────────────────────────────────
_MUSIC_WARMUP = 11  # a re-sum, then the fade; ties on the beat hold it


def music_init(settings) -> dict:
    return {"colour": bytearray(3), "sums": (0, 0, 0)}


def music_step(state, settings, clock_ms, render) -> bytes:
    level, _, _, spectrum = demo_sound(render)
    if render % 5 == 0:
        state["sums"] = (
            spectrum[3] + spectrum[4] + spectrum[5],
            spectrum[8] + spectrum[9] + spectrum[10],
            spectrum[12] + spectrum[13] + spectrum[14],
        )
    low, mid, high = state["sums"]
    if level == 0:
        target = 0xFFFFFF
    elif low > mid and low > high:
        target = 0xFF0000
    elif mid > low and mid > high:
        target = 0xFF00
    elif high > low and high > mid:
        target = 0xFF
    else:
        target = None  # a tie writes nothing
    colour = state["colour"]
    if target is not None:
        fade_towards(colour, 255, target, 1)  # the strip is one colour
    return bytes(colour) * LENGTH


# ── Slot 41: Spectrum ───────────────────────────────────────────────────
# The lamp keeps peaks but never draws them: not here. The
# warmup is the rate 0 fade's: at rate 6 and more it is shorter.
_SPECTRUM_WARMUP = 104


def spectrum_init(settings) -> dict:
    state = _grid_state(settings)
    width, height, table = state["width"], state["height"], state["table"]
    columns = []
    for column in range(width):
        # H, not W, in the colour's step, as the lamp does.
        at = 3 * (((column * 255 // (height - 1)) & 255) * state["span"] >> 8)
        colour = table[at:at + 3]
        columns.append((lround(column * 14 / (width - 1) + 1), colour if any(colour) else None))
    state["columns"] = columns
    state["bands"] = [0] * 16
    return state


def spectrum_step(state, settings, clock_ms, render) -> bytes:
    spectrum = demo_sound(render)[3]
    width, height, work, bands = state["width"], state["height"], state["work"], state["bands"]
    fade_grid(work, settings["rate"], width, height)
    for band, new in enumerate(spectrum):
        old = bands[band]
        bands[band] = (4 * new + 2 * old) // 6 if new > old else new
    for column, (band, colour) in enumerate(state["columns"]):
        bar = lround(bands[band] * height / 255)
        if colour is None:  # written only when not black
            continue
        for cell in range(min(bar, height)):
            at = 3 * ((height - 1 - cell) * width + column)
            work[at:at + 3] = colour
    return place_strip(work, state["direction"])


# ── Slots 43 and 45: Gather and Blossom ─────────────────────────────────
# Warmup None: the noise runs on the lamp's clock, so no loop can be swept, and
# blurs over a saturating add have no bound to forget by (sampled starts merged
# after up to 111 and 190 renders at rate 0).
def _add(work, cell: int, table, at: int) -> None:
    """A palette colour added, saturating."""
    at_cell = 3 * cell
    for channel in range(3):
        value = work[at_cell + channel] + table[at + channel]
        work[at_cell + channel] = value if value < 255 else 255


def gather_init(settings) -> dict:
    state = _grid_state(settings)
    # A bar longer than the grid gives negative mirrored rows: the 16-bit index
    # clamps to the last pixel after the mapper, the cell the mapper sends there.
    state["last"] = pixel_map(settings["direction"]).index(LENGTH - 1)
    return state


def gather_step(state, settings, clock_ms, render) -> bytes:
    level = demo_sound(render)[0]
    width, height, work = state["width"], state["height"], state["work"]
    table, span, last = state["table"], state["span"], state["last"]
    blend_grid(work, settings["rate"], width, height)
    time = (clock_ms >> 1) & 65535
    gain = (settings["intensity"] * level) >> 6
    for column in range(width):
        value = noise_heat(inoise8_raw(column * 45, time, time))
        bar = ((((value * gain) >> 6) * height) >> 10) & 65535
        far = width - 1 - column
        for step in range(1, bar + 1):
            at = 3 * ((span * ((250 - 250 * (step - 1) // bar) & 255)) >> 8)
            _add(work, (step - 1 if step <= height else 0) * width + column, table, at)
            _add(work, last if step > height else (height - step) * width + far, table, at)
    row_blur_grid(work, width, height)
    blur_columns(work, 16, width, height)
    return place_strip(work, state["direction"])


def blossom_step(state, settings, clock_ms, render) -> bytes:
    level = demo_sound(render)[0]
    width, height, work = state["width"], state["height"], state["work"]
    table, span = state["table"], state["span"]
    blend_grid(work, settings["rate"], width, height)
    time = (clock_ms >> 2) & 65535
    gain = (settings["intensity"] * level) >> 6
    middle = height >> 1
    for column in range(width):
        value = noise_heat(inoise8_raw(column * 45, time, time))
        bar = ((((value * gain) >> 6) * height) >> 11) & 65535
        far = width - 1 - column
        for step in range(min(bar, middle + 1)):
            at = 3 * ((span * ((step * 250 // bar) & 255)) >> 8)
            _add(work, (middle - step) * width + column, table, at)
            below = middle + step
            _add(work, (below if below < height else 0) * width + far, table, at)
    row_blur_grid(work, width, height)
    blur_columns(work, 16, width, height)
    return place_strip(work, state["direction"])


# ── Slot 51: noise equalizer ────────────────────────────────────────────
# The mapper on the flags 51 runs with (0x47, 0x57) is a permutation and the
# read-back undoes it: the buffer by logical cell is the same picture.
# noise51 only ever reads x < 384, so three hashes of Perlin's table.
# The warmup is over the 768 renders of the beat and the noise's step together.
_EQUALIZER_WARMUP = 218  # at low intensity a peak waits for the next tall bar
_NOISE51_HASHES = (36, 86, 227)


def _grad51(number: int, x: int) -> int:
    """grad8's operands, then ((u + v) >> 1) + (u & 1) on 32 bits."""
    u, v = x, x
    if not number & 8:
        if number & 4:
            u = 1
        else:
            v = 1
    u = sx8(-u if number & 1 else u)
    v = sx8(-v if number & 2 else v)
    return (((v + u) & 0xFFFFFFFF) >> 1) + (u & 1)


def _noise51(x: int) -> int:
    """FastLED's 1-D inoise8 as the lamp computes it: ease = j * j >> 7
    with j folded at 128, plain (a * b) >> 8 lerp."""
    low, high = x & 255, x >> 8
    fold = low if low < 128 else 255 - low
    square = (fold * fold) >> 7
    ease = (square & 0x1FE if low < 128 else (square | 1) ^ 0xFFFFFFFE) & 255
    half = (x >> 1) & 0x7F
    one = _grad51(_NOISE51_HASHES[high], half)
    two = _grad51(_NOISE51_HASHES[high + 1], half - 128)
    if sx8(two) > sx8(one):
        answer = ((ease * ((two - one) & 255)) >> 8) + one
    else:
        answer = one - ((ease * ((one - two) & 255)) >> 8)
    noise = ((answer << 1) + 0x80) & 0x1FE
    return min(noise, 255)


# f32(f32(n + 256) / 384) by x.
_NOISE51_SCALES = tuple(f32(f32(_noise51(x) + 256) / 384) for x in range(384))


def equalizer_init(settings) -> dict:
    state = _grid_state(settings)
    width, palette = state["width"], effect_colours(settings)["palette"]
    state["first"] = bytes(palette[0])
    state["offsets"] = [column * 128 // width for column in range(width)]
    state["k"] = (8 - lround(f32(settings["rate"] * 0.03125))) & 255  # rate < 240
    state["peaks"] = [0.0] * width
    state["falls"] = [0.0] * width
    state["smooth"] = 0
    return state


def equalizer_step(state, settings, clock_ms, render) -> bytes:
    level = demo_sound(render)[0]
    width, height, work = state["width"], state["height"], state["work"]
    table, span, first = state["table"], state["span"], state["first"]
    peaks, falls, k = state["peaks"], state["falls"], state["k"]
    fade_grid(work, (settings["rate"] >> 1) + 64, width, height)
    smooth = state["smooth"] = ((state["smooth"] + level) >> 1) & 0xFFFF
    scale = f32(height * f32(f32(smooth * settings["intensity"]) * 0.0078125) / 255.0)
    scale = 0.0 if scale < 0 else scale if scale <= height else f32(height)
    falling = render % k == 0  # the record's count, the same in every column
    fall_by = f32(k + 6)
    position = render & 255  # the step, from 0 at the Apply
    for column, offset in enumerate(state["offsets"]):
        bar = lround(f32(scale * _NOISE51_SCALES[position + offset]))
        bar = (bar if bar <= height else height) & 0xFFFF
        for row in range(bar):
            at = 3 * ((span * ((row * 255 // bar) & 255)) >> 8)
            cell = 3 * (row * width + column)
            work[cell:cell + 3] = table[at:at + 3]
        tall, peak = f32(bar), peaks[column]
        if tall >= peak:
            falls[column] = 0.0
            peak = tall
        else:
            if falling:
                falls[column] = f32(f32(peak - tall) / fall_by)
            peak = f32(peak - falls[column])
        peaks[column] = peak
        if peak > 0:
            row = lround(peak)
            cell = 3 * ((0 if height <= row else row) * width + column)
            work[cell:cell + 3] = first
    return place_strip(work, state["direction"])


# ── Slot 73: Note ───────────────────────────────────────────────────────
# The fade takes 255 to 0 in 16 renders, the 16th's glyph reads the level
# before. The demo beat never skips a frame: no clock changes that.
_NOTE_WARMUP = 16
_NOTE_GLYPH = "".join((  # the 19 x 13 bitmap
    ".........#####.....",
    ".........######....",
    ".........##..##....",
    ".........##...#....",
    ".........##...#....",
    ".........##........",
    ".........##........",
    ".........##........",
    ".......####........",
    "......#####........",
    ".....######........",
    ".....######........",
    "......####.........",
))


def note_init(settings) -> dict:
    state = _grid_state(settings)
    width, height = state["width"], state["height"]
    low = f32(f32(width) * 0.8 / 19)
    state["low"] = low
    state["stride"] = f32(f32(f32(f32(width) * 1.5 / 19) - low) / 255)
    state["centre"] = (int(f32(width * 0.5) + 0.49), int(f32(height * 0.5) + 0.49))
    state["previous"] = 0  # the last render's level
    return state


def note_step(state, settings, clock_ms, render) -> bytes:
    level, onset, _, _ = demo_sound(render)
    width, height, work = state["width"], state["height"], state["work"]
    table, span = state["table"], state["span"]
    size = f32(state["stride"] * (level + onset + state["previous"]))
    size = f32(state["low"] + f32(size / 3))
    state["previous"] = level
    glyph_w, glyph_h = int(f32(size * 19) + 0.49), int(f32(size * 13) + 0.49)
    if ((glyph_w * glyph_h) & 65535) > ((width * width * 10) & 65535):
        return place_strip(work, state["direction"])  # a skipped frame
    fade_grid(work, 64, width, height)
    time = clock_ms >> 1
    gain = (settings["intensity"] * level) >> 6
    sixth = height // 6
    for column in range(width):
        value = noise_heat(inoise8_raw(column * 45, time & 65535, (time * column) & 65535))
        bar = ((((value * gain) >> 6) * sixth) >> 10) & 65535
        for step in range(bar):
            at = 3 * ((span * ((step * 240 // bar) & 255)) >> 8)
            cell = 3 * ((step if step < height else 0) * width + column)
            work[cell:cell + 3] = table[at:at + 3]
            # A row above the grid wraps through the 16-bit index and the clamp.
            row = height - 1 - step
            cell = 3 * (row * width + width - 1 - column if row >= 0 else width * height - 1)
            work[cell:cell + 3] = table[at:at + 3]
    at = 3 * ((span * (level ^ 255)) >> 8)
    colour = table[at:at + 3]
    centre_x, centre_y = state["centre"]
    top = int(centre_y - (f32(glyph_h * 0.5) + 0.49) + 1)
    left = int(centre_x - (f32(glyph_w * 0.5) + 0.49))
    for row in range(max(top, 0), min(top + glyph_h, height)):
        source = int(f32(f32((row - top) * 13) / glyph_h)) * 19
        for offset in range(max(-left, 0), min(width - left, glyph_w)):
            if _NOTE_GLYPH[source + int(f32(f32(offset * 19) / glyph_w))] == "#":
                cell = 3 * (row * width + left + offset)
                work[cell:cell + 3] = colour
    return place_strip(work, state["direction"])


# ── Slot 74: Impact ─────────────────────────────────────────────────────
_IMPACT_FALL = -0.0004000000189989805
_IMPACT_LAUNCH = -2.200000047683716


def impact_init(settings) -> dict:
    state = _grid_state(settings)
    state["gravity"] = f32(state["height"] * f32(f32(settings["rate"] / -10000) + _IMPACT_FALL))
    state["particles"] = [
        {"y": 0.0, "x": 0.0, "vy": 0.0, "vx": 0.0, "alive": False, "level": 0, "radius": 0}
        for _ in range(LENGTH >> 4)
    ]
    state["active"] = 0  # the live particles
    state["stored"] = 0  # the level the last render kept
    state["draw"] = 0
    return state


def _impact_spawn(state, particle, level: int, colour) -> None:
    """Four source reads: side, height, drift, one unused. Then the 4r x 2r
    ellipse at the bottom row."""
    width, height, work, draw = state["width"], state["height"], state["work"], state["draw"]
    state["draw"] = draw + 4
    side, rise, drift = source_word(draw) & 255, source_word(draw + 1), source_word(draw + 2) & 255
    particle["y"], particle["x"] = 0.0, width - 3 if side <= 128 else 2
    lift = ((height - 1) * (((level // 2) + ((rise >> 1) & 127)) & 65535) >> 8) & 65535
    particle["vy"] = f32(math.sqrt(f32(f32(state["gravity"] * _IMPACT_LAUNCH) * lift)))
    particle["vx"] = f32(
        f32(width * f32(f32(((drift * 13) >> 8) - 6) * 0.0078125))
        * f32(f32(320 - level) * 0.0078125)
    )
    particle["alive"], particle["level"] = True, level & 255
    radius = particle["radius"] = (level // 128 + 1) & 255
    state["active"] = (state["active"] + 1) & 255
    column0, limit = particle["x"], (8 * radius * radius) ** 2
    for dy in range(-2 * radius, 2 * radius + 1):
        row = height - 1 + dy
        if row < 0 or row >= height:
            continue
        for dx in range(-4 * radius, 4 * radius + 1):
            column = column0 + dx
            if (
                0 <= column < width
                and (2 * radius * dx) ** 2 + (4 * radius * dy) ** 2 <= limit
            ):
                cell = 3 * (row * width + column)
                work[cell:cell + 3] = colour


def impact_step(state, settings, clock_ms, render) -> bytes:
    level, onset, _, _ = demo_sound(render)
    width, height, work = state["width"], state["height"], state["work"]
    table, span, gravity = state["table"], state["span"], state["gravity"]
    particles = state["particles"]
    fade_grid(work, 64, width, height)
    stored = state["stored"]
    spawns = abs(stored - level) // 64 if level - stored >= 17 else 0
    state["stored"] = level
    if onset:
        spawns = (onset >> 5) + 1
    spawns &= 255
    if spawns and spawns + state["active"] < len(particles):
        at = 3 * ((span * (level & 255)) >> 8)
        colour = table[at:at + 3]
        for particle in particles:
            if particle["alive"]:
                continue
            _impact_spawn(state, particle, level, colour)
            spawns -= 1
            if not spawns:
                break
        blur_columns(work, 128, width, height)
    start, processed = state["active"], 0
    for particle in particles:
        if not particle["alive"]:
            continue
        radius = particle["radius"]
        at = 3 * ((span * particle["level"]) >> 8)
        colour = table[at:at + 3]
        row0, column0 = height - 1 - int(particle["y"]), int(particle["x"])
        for dy in range(-radius, radius + 1):
            row = row0 + dy
            if row < 0 or row >= height:
                continue
            for dx in range(-radius, radius + 1):
                column = column0 + dx
                if 0 <= column < width and dx * dx + dy * dy <= radius * radius:
                    cell = 3 * (row * width + column)
                    work[cell:cell + 3] = colour
        x, y = f32(particle["vx"] + particle["x"]), f32(particle["vy"] + particle["y"])
        right = width + radius - 1
        if f32(y + radius) <= 0 or f32(radius + x) <= 0 or not x <= right:
            particle["alive"] = False
            state["active"] = (state["active"] - 1) & 255
        particle["x"] = -radius if x < -radius else min(x, right)
        particle["y"] = -radius if y < -radius else min(y, height + radius - 1)
        particle["vy"] = f32(gravity + particle["vy"])
        processed += 1
        if (processed & 255) >= start:
            break
    return place_strip(work, state["direction"])


SLOTS = (
    {"mode": 20, "init": breathing_20_init, "step": breathing_step, "warmup": _BREATHING_20_WARMUP},
    {"mode": 25, "init": bars_25_init, "step": bars_step, "warmup": _BARS_WARMUP},
    {"mode": 26, "init": bars_26_init, "step": bars_step, "warmup": _BARS_WARMUP},
    {"mode": 27, "init": music_init, "step": music_step, "warmup": _MUSIC_WARMUP},
    {"mode": 30, "init": bars_30_init, "step": bars_step, "warmup": _BARS_WARMUP},
    {"mode": 41, "init": spectrum_init, "step": spectrum_step, "warmup": _SPECTRUM_WARMUP},
    {"mode": 43, "init": gather_init, "step": gather_step, "warmup": None},
    {"mode": 44, "init": breathing_44_init, "step": breathing_step, "warmup": _BREATHING_44_WARMUP},
    {"mode": 45, "init": _grid_state, "step": blossom_step, "warmup": None},
    {"mode": 51, "init": equalizer_init, "step": equalizer_step, "warmup": _EQUALIZER_WARMUP},
    {"mode": 73, "init": note_init, "step": note_step, "warmup": _NOTE_WARMUP},
    {"mode": 74, "init": impact_init, "step": impact_step, "warmup": None},
)
