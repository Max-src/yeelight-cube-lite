"""Renderers of the lamp's particles and sparks.
Mirrors www/lamp-effects-sparks.js exactly; lamp_effects_core.py tells how
to add one.

Each draws from the random source in the order of its first run, so what it
keeps depends on all the history (warmup None), except Spectrum Chase and Random
scatter. Also here: the palette and aqua-lime trails, the drop-and-bounce dot, the
rising wisps and the centre bursts.
"""

from __future__ import annotations

from array import array
import math

try:
    from .lamp_core import (
        DIRECTION_TABLE,
        LENGTH,
        REFERENCE_PROFILE,
        SIN8,
        U32,
        convert_colour,
        effect_colours,
        effect_geometry,
        f32,
        fade_towards,
        flagged_targets,
        palette_span,
        place_strip,
        read_back_flags,
        sin16_unsigned,
        source_word,
        strip_blur,
    )
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_core import (
        DIRECTION_TABLE,
        LENGTH,
        REFERENCE_PROFILE,
        SIN8,
        U32,
        convert_colour,
        effect_colours,
        effect_geometry,
        f32,
        fade_towards,
        flagged_targets,
        palette_span,
        place_strip,
        read_back_flags,
        sin16_unsigned,
        source_word,
        strip_blur,
    )


def _read(state) -> int:
    """The random source's next word: one draw per read."""
    draw = state["reads"]
    state["reads"] = draw + 1
    return source_word(draw)


def _scan_colour(state, pixels: int = LENGTH, mask: int = U32) -> bytes:
    """The seed scan: from the cursor, the first palette entry that is not
    black, or black after ``pixels`` attempts."""
    palette, cursor = state["palette"], state["cursor"]
    colour, attempt = bytes(3), 0
    while attempt < pixels:
        colour = palette[((attempt + cursor) % pixels) % len(palette)]
        attempt += 1
        if any(colour):
            break
    state["cursor"] = (cursor + attempt) & mask
    return colour


# ── Slots 5 and 79: the twinkle pass ────────────────────────────────────
def _twinkle_init(settings, keep_base: int) -> dict:
    rate = settings["rate"]
    grow, keep = (rate >> 2) + 8, (keep_base - rate // 7) & 255
    return {
        "direction": settings["direction"],
        "reads": 0,
        "stars": bytearray(3 * LENGTH),
        "growing": bytearray(LENGTH),
        "sums": [value + ((value * grow >> 8) + 1 if value else 0) for value in range(256)],
        "keep": bytes((value * keep) >> 8 for value in range(256)),
    }


def _twinkle_pass(state) -> None:
    """Growing: s = c + (c * k >> 8) + 1; a channel at 255 ends the growth, and
    a channel that did not change doubles the sums. Else c * keep >> 8."""
    stars, growing, sums, keep = state["stars"], state["growing"], state["sums"], state["keep"]
    for pixel in range(LENGTH):
        at = 3 * pixel
        red, green, blue = stars[at], stars[at + 1], stars[at + 2]
        if growing[pixel]:
            first, second, third = sums[red], sums[green], sums[blue]
            new_red, new_green, new_blue = min(255, first), min(255, second), min(255, third)
            if new_red == 255 or new_green == 255 or new_blue == 255:
                growing[pixel] = 0
            if new_red == red or new_green == green or new_blue == blue:
                new_red, new_green, new_blue = min(255, 2 * first), min(255, 2 * second), min(255, 2 * third)
            stars[at], stars[at + 1], stars[at + 2] = new_red, new_green, new_blue
        elif red or green or blue:
            stars[at], stars[at + 1], stars[at + 2] = keep[red], keep[green], keep[blue]


def _occupied(stars, target: int) -> bool:
    at = 3 * target
    return bool(stars[at] or stars[at + 1] or stars[at + 2])


# ── Slot 5: Starry Sky ──────────────────────────────────────────────────
def starry_seed(primary, shift: int) -> bytes:
    """The seed colour: the primary to HSV, the hue moved by ``shift`` (the
    jitter's high nibble) - 8, S and V cut to hundredths, and back through the
    six-way switch."""
    red, green, blue = (f32(channel / 255) for channel in primary)
    top = max(red, green, blue)
    low = min(red, green, blue)
    saturation = f32(f32(top - low) / top) if top > 1e-4 else 0
    hue = 0
    if not saturation < 1e-4:
        spread = f32(top - low)
        blue_part, green_part = f32(f32(top - blue) / spread), f32(f32(top - green) / spread)
        if red == top:
            sector = f32(blue_part - green_part)
        else:
            red_part = f32(f32(top - red) / spread)
            sector = f32(red_part + 2 - blue_part) if green == top else f32(green_part + 4 - red_part)
        degrees = f32(sector * 60)
        if degrees < 0:
            degrees = f32(degrees + 360)
        hue = int(degrees)
    shifted = hue + shift - 8
    if shifted < 0:
        shifted += 360
    saturation = f32(int(f32(saturation * 100)) / 100)
    value = f32(int(f32(top * 100)) / 100)
    channels = (value, value, value)
    if not saturation < 1e-4:
        angle = f32(f32(shifted) - 360) if shifted > 359 else f32(shifted)
        position = f32(angle / 60)
        index = math.floor(position)
        fraction = f32(position - index)
        rising = f32(value * (1 - saturation * (1 - fraction)))
        floor = f32(value * (1 - saturation))
        falling = f32(value * (1 - f32(saturation * fraction)))
        channels = (
            (value, rising, floor), (falling, value, floor), (floor, value, rising),
            (floor, falling, value), (rising, floor, value), (value, floor, falling),
        )[index]
    return bytes(int(f32(channel * 255)) for channel in channels)


def starry_init(settings) -> dict:
    primary = effect_colours(settings)["primary"]
    return {**_twinkle_init(settings, 250), "seeds": [starry_seed(primary, shift) for shift in range(16)]}


def starry_step(state, settings, clock_ms, render) -> bytes:
    _twinkle_pass(state)
    stars, intensity = state["stars"], settings["intensity"]
    for _chance in range(LENGTH // 50 + 1):
        if (_read(state) & 255) > intensity:
            continue
        _read(state)  # unused
        attempt = 1
        while True:
            target = ((_read(state) & 0xFFFF) * LENGTH) >> 16
            if _occupied(stars, target):
                if attempt < ((_read(state) >> 7) & 1) + 1:
                    attempt += 1
                    continue
                break
            stars[3 * target:3 * target + 3] = state["seeds"][(_read(state) >> 4) & 15]
            state["growing"][target] = 1
            break
    return place_strip(stars, state["direction"])


# ── Slot 6: Particle path ───────────────────────────────────────────────
# Four dots, one pixel a step, 101 steps around (the last out of sight), a step
# on each render where clock / (256 - rate) changes: all a pure function of the
# render. Only the trails carry over, and the fade towards black is slowest at
# amount 0: 255 takes 191 renders to go, so 190 rebuild any frame.
_CHASE_WARMUP = 190


def _wheel(byte: int) -> bytes:
    """The wipe renderers' colour wheel."""
    if byte >= 171:
        rest = 255 - byte
        return bytes(((255 - 3 * rest) & 255, 0, 3 * rest))
    if byte >= 86:
        rest = 170 - byte
        return bytes((0, 3 * rest, 255 - 3 * rest))
    rest = 85 - byte
    return bytes((3 * rest, 255 - 3 * rest, 0))


def chase_init(settings) -> dict:
    return {
        "direction": settings["direction"],
        "divisor": 256 - settings["rate"],
        "strip": bytearray(3 * LENGTH),
    }


def chase_step(state, settings, clock_ms, render) -> bytes:
    strip, divisor = state["strip"], state["divisor"]
    fade_towards(strip, settings["intensity"])
    quotient = clock_ms // divisor
    if not render or quotient != (clock_ms - 40) // divisor:  # the first render always steps
        steps = render if divisor <= 40 else quotient - (clock_ms - 40 * render) // divisor
        colour = _wheel(quotient & 255)
        for start in range(0, LENGTH, LENGTH // 4):
            position = (start + steps) % (LENGTH + 1)
            if position < LENGTH:
                strip[3 * position:3 * position + 3] = colour
    return place_strip(strip, state["direction"])


# ── Slot 22: Mirrored comets ────────────────────────────────────────────
# Its first render draws nothing and sets the mirror and reverse flags: from
# there it runs on 50 pixels, 9 comets, every write mirrored. Those 50 black
# writes and their mirrors are the whole panel, which it keeps by panel index.
_PRISM_PIXELS = 50
_PRISM_COMETS = _PRISM_PIXELS // 6 + 1
_PRISM_SCALE = float.fromhex("0x1.4af4f0d844d01p-7")  # the lamp's 1/99


def _prism_timing(x: int) -> tuple[float, float]:
    speed = f32(x * _PRISM_SCALE)
    return speed, f32(f32(_PRISM_PIXELS / speed) / _PRISM_COMETS)


def prism_init(settings) -> dict:
    mapped = DIRECTION_TABLE[REFERENCE_PROFILE][settings["direction"]]
    flags = read_back_flags(22, mapped) | 0x0A
    rate = settings["rate"]
    return {
        "reads": 0,
        "timer": 0,
        "cursor": 0,
        "palette": [bytes(colour) for colour in effect_colours(settings)["palette"]],
        # A comet's two pixels reach past the 50.
        "targets": [
            [3 * index for index in flagged_targets(pixel, LENGTH, mapped, flags)]
            for pixel in range(_PRISM_PIXELS + 2)
        ],
        "timing": _prism_timing((rate >> 2) + 1) if rate else None,
        "comets": [[False, 0.0, 0.0, b""] for _ in range(_PRISM_COMETS)],
    }


def prism_step(state, settings, clock_ms, render) -> bytes:
    timing = state["timing"]
    if timing is None:
        timing = _prism_timing(((_read(state) & 255) * 58 >> 8) + 6)
    if not render:
        state["timer"] = 1
        return bytes(3 * LENGTH)
    panel = bytearray(3 * LENGTH)
    speed, interval = timing
    comets, targets = state["comets"], state["targets"]
    if not state["timer"] <= interval:
        state["timer"] = 0
        for comet in comets:
            if not comet[0]:
                comet[0], comet[1], comet[2], comet[3] = True, 0.0, speed, _scan_colour(state, _PRISM_PIXELS)
                break
    for comet in comets:
        if not comet[0]:
            continue
        position = comet[1]
        if position <= _PRISM_PIXELS:
            at, colour = int(position), comet[3]
            for target in targets[at]:
                panel[target:target + 3] = colour
            for target in targets[at + 1]:
                panel[target:target + 3] = colour
        else:
            comet[0] = False
        comet[1] = f32(comet[2] + position)
    state["timer"] = (state["timer"] + 1) & 0xFFFF
    return panel


# ── Slot 24: Palette sparks ─────────────────────────────────────────────
_EMBER_SPARKS = LENGTH >> 1
_EMBER_TRIES = 14  # trunc((N + 8) / 8 + 0.5)


def ember_init(settings) -> dict:
    table = effect_colours(settings)["table"]
    colours = bytearray(3 * 256)
    for level in range(256):
        index, gain = 3 * (level // 2 + 32), level * 239 // 255 + 16
        for channel in range(3):
            value = table[index + channel]
            colours[3 * level + channel] = value if gain == 255 else value * (gain + 1) >> 8
    return {
        "direction": settings["direction"],
        "reads": 0,
        "colours": bytes(colours),
        "active": 0,
        "status": bytearray(_EMBER_SPARKS),
        "levels": [0] * _EMBER_SPARKS,
        "positions": [0] * _EMBER_SPARKS,
        "ups": [0] * _EMBER_SPARKS,
        "downs": [0] * _EMBER_SPARKS,
        "strip": bytearray(3 * LENGTH),
    }


def _ember_draw(state) -> None:
    status, levels, positions, colours, strip = (
        state["status"], state["levels"], state["positions"], state["colours"], state["strip"],
    )
    for spark in range(_EMBER_SPARKS):
        if status[spark]:
            at, level = 3 * positions[spark], 3 * levels[spark]
            strip[at], strip[at + 1], strip[at + 2] = colours[level], colours[level + 1], colours[level + 2]


def ember_step(state, settings, clock_ms, render) -> bytes:
    status, levels, ups, downs, strip = (
        state["status"], state["levels"], state["ups"], state["downs"], state["strip"],
    )
    _read(state)  # discarded before the spawn calculation
    attempts = 0
    while state["active"] < _EMBER_SPARKS:
        spark = status.index(0)
        levels[spark] = (_read(state) >> 4) & 15
        state["positions"][spark] = ((_read(state) & 255) * LENGTH) >> 8
        downs[spark] = ((_read(state) & 255) * 15 >> 8) + 1
        ups[spark] = ((_read(state) & 255) * 15 >> 8) + 1
        status[spark] = 1
        state["active"] += 1
        attempts += 1
        if attempts > ((_read(state) & 255) * _EMBER_TRIES >> 8):
            break
    _ember_draw(state)
    strip_blur(strip, 64)
    _ember_draw(state)
    for spark in range(_EMBER_SPARKS):
        phase = status[spark]
        if phase == 1:
            levels[spark] += ups[spark]
            if levels[spark] >= 255:
                levels[spark] = 255
                status[spark] = 2
        elif phase == 2:
            levels[spark] -= downs[spark]
            if levels[spark] <= 0:
                levels[spark] = 0
                status[spark] = 0
                state["active"] -= 1
    return place_strip(strip, state["direction"])


# ── Slots 14 and 23: the trail pass ─────────────────────────────────────
# Slots 14 and 23 only differ by their seed.
_TRAIL_POINTS = 4  # whatever the intensity
_TRAIL_COLOURS = (b"\x65\xfa\xff", b"\x7e\xff\x32")  # slot 23's, by bit 7: never converted


def trail_init(settings) -> dict:
    intensity = settings["intensity"]
    return {
        "direction": settings["direction"],
        "reads": 0,
        "cursor": 0,
        "palette": [bytes(colour) for colour in effect_colours(settings)["palette"]],
        "amount": (intensity + int((1 - LENGTH // 40) * (intensity ^ 255) / 2)) & 255,
        "period": (settings["rate"] ^ 255) * (LENGTH + 40) * 4 // 200 + 1,
        "bucket": 0,
        "points": None,
        "strip": bytearray(3 * LENGTH),
    }


def _trail_step(state, clock_ms: int, seed) -> bytes:
    strip = state["strip"]
    fade_towards(strip, state["amount"])
    bucket = (clock_ms // state["period"]) & U32
    if bucket != state["bucket"]:
        state["bucket"] = bucket
        points = state["points"]
        if points is None:
            points = state["points"] = [
                [((_read(state) & 0xFFFF) * LENGTH) >> 16, seed(state)] for _ in range(_TRAIL_POINTS)
            ]
        for point in points:
            position = point[0]
            if position < LENGTH:
                strip[3 * position:3 * position + 3] = point[1]
                point[0] = position + 1
            elif ((_read(state) & 0xFFFF) * (LENGTH + 4)) & 0x7FFF0000 == 0:
                point[0], point[1] = 0, seed(state)
    return place_strip(strip, state["direction"])


def trail_step(state, settings, clock_ms, render) -> bytes:
    return _trail_step(state, clock_ms, lambda held: _scan_colour(held, mask=0xFFFF))


def aqua_lime_step(state, settings, clock_ms, render) -> bytes:
    return _trail_step(state, clock_ms, lambda held: _TRAIL_COLOURS[(_read(held) >> 7) & 1])


# ── Slot 16: Drop and bounce ────────────────────────────────────────────
def drop_init(settings) -> dict:
    rate = settings["rate"]
    return {
        "direction": settings["direction"],
        "reads": 0,
        "cursor": 0,
        "palette": [bytes(colour) for colour in effect_colours(settings)["palette"]],
        "gain": rate // 51 + 1,
        "pull": f32(f32(LENGTH) * f32(rate / -100000 + -0.001)),
        "phase": 0,  # 0 new, 1 waiting, 2 falling, 5 bounced
        "position": 0.0,
        "speed": 0.0,
        "counter": 0,
        "colour": bytes(3),
        "strip": bytearray(3 * LENGTH),
    }


def drop_step(state, settings, clock_ms, render) -> bytes:
    strip = state["strip"]
    fade_towards(strip, 251)
    phase = state["phase"]
    moving = phase >= 2
    if phase == 0:
        state["position"], state["speed"], state["counter"] = f32(LENGTH - 1), 0.0, 12
        state["colour"] = _scan_colour(state)
        phase = state["phase"] = 1
    elif phase == 1 and state["counter"] >= 256:
        state["counter"] = 255
    colour = state["colour"]
    if not moving:
        at = 3 * int(state["position"])
        strip[at:at + 3] = colour
        state["counter"] = (state["counter"] + state["gain"]) & 0xFFFF
        if (_read(state) & 255) < state["counter"] // 10:
            phase = state["phase"] = 2
            state["counter"] = 255
            moving = True
    if moving:
        position, speed = state["position"], state["speed"]
        if not position > 0:
            if phase < 3:  # not drawn on this render
                speed = f32(speed * -0.5)
                state["position"], state["speed"] = f32(speed + position), speed
                state["counter"], state["phase"] = 24, 5
            else:
                state["counter"], state["phase"] = 12, 0
        else:
            position = max(f32(position + speed), 0.0)
            state["position"], state["speed"] = position, f32(state["pull"] + speed)
            at = 3 * int(position)
            strip[at:at + 3] = colour
    return place_strip(strip, state["direction"])


# ── Slot 33: Rising wisps ───────────────────────────────────────────────
# Rate, intensity and the palette are never read. The cells take the two colour
# words: every cell is written, so nothing shows of the buffer before it.
_WISPS = 20
_WISP_GAINS = 65025 // 257 + 1  # sin8 x sin8 / 257


def wisps_init(settings) -> dict:
    width, height = effect_geometry(settings)
    colours = effect_colours(settings)
    first, second = colours["primary"], colours["secondary"]
    blends = bytearray()
    for level in range(256):
        if level == 0:
            blends += bytes(second)
        elif level == 255:
            blends += bytes(first)
        else:
            blends += bytes((low * (255 - level) + high * level) >> 8 for low, high in zip(second, first))
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "reads": 0,
        "blends": bytes(blends),
        "wisps": [None] * _WISPS,
    }


def _wisp_spawn(state) -> dict:
    """The seven reads of a spawn; the last one's byte is unused."""
    width = state["width"]
    speed = f32(f32(((_read(state) & 0xFFFF) * 27 >> 16) + 3) / 40)
    pull = f32(f32(((_read(state) >> 13) & 7) | 8) / 10000)
    size = f32(f32(((_read(state) & 0xFFFF) * 500 >> 16) + 300) / 100)
    stretch = f32(f32(((_read(state) & 0xFFFF) * 800 >> 16) + 400) / 100)
    gain = f32(f32(((_read(state) & 0xFFFF) * 50 >> 16) + 50) / 100)
    phase = _read(state) & 255
    _read(state)
    span = f32(f32(width / stretch) * 255)
    return {
        "position": 0.0,
        "speed": speed,
        "pull": pull,
        "half": f32(size * 0.5),
        "phase": phase,
        "age": 0,
        "turns": [int(column * span / (width - 1)) - 64 for column in range(width)],
        "gains": [int(f32(gain * value)) for value in range(_WISP_GAINS)],
    }


def wisps_step(state, settings, clock_ms, render) -> bytes:
    wisps, width, height = state["wisps"], state["width"], state["height"]
    if ((_read(state) & 255) * 6) & 0x700 == 0 and None in wisps:
        wisps[wisps.index(None)] = _wisp_spawn(state)
    # By wisp, not by cell: the sums do not care for the order.
    sums, counts = [0] * LENGTH, [0] * LENGTH
    for wisp in wisps:
        if wisp is None:
            continue
        position, half, phase = wisp["position"], wisp["half"], wisp["phase"]
        low, high = f32(position - half), f32(position + half)
        spread = high - low
        rest, gains = 255 - wisp["age"], wisp["gains"]
        waves = [SIN8[(turn + phase) & 255] for turn in wisp["turns"]]
        for row in range(max(0, math.floor(low) - 1), min(height, math.ceil(high) + 2)):
            offset = f32(row - position)
            if abs(offset) > half:
                continue
            swell = SIN8[(int((f32(position + offset) - low) * 255 / spread) - 64) & 255]
            cell = row * width
            for wave in waves:
                value = (gains[wave * swell // 257] * rest) >> 8
                if value:
                    sums[cell] += value
                    counts[cell] += 1
                cell += 1
    # A dead record runs on unread: a spawn sets all it holds, and by the time its
    # age wraps it is far below the box.
    for index, wisp in enumerate(wisps):
        if wisp is None:
            continue
        position = wisp["position"] = f32(wisp["position"] + wisp["speed"])
        wisp["speed"] = f32(wisp["speed"] - wisp["pull"])
        wisp["phase"] = (wisp["phase"] + 1) & 255
        wisp["age"] += 1
        if f32(position + wisp["half"]) < 0 or wisp["age"] >= 256:
            wisps[index] = None
    blends = state["blends"]
    strip = b"".join(
        [
            blends[3 * (total // count):3 * (total // count) + 3] if count else blends[:3]
            for total, count in zip(sums, counts)
        ]
    )
    return place_strip(strip, state["direction"])


# ── Slot 60: Flicker sweep ──────────────────────────────────────────────
_CRUMBLE_SPAN = 5 * LENGTH  # the spark run sweeps a virtual length of 5N
_CRUMBLE_RUN = LENGTH // 10 + 1


def crumble_init(settings) -> dict:
    colours = effect_colours(settings)
    table, span = colours["table"], palette_span(len(colours["palette"]))
    bases = bytearray(3 * LENGTH)
    for pixel in range(LENGTH):
        index = 3 * (((pixel * 255 // (LENGTH - 1)) & 255) * span >> 8)
        bases[3 * pixel:3 * pixel + 3] = table[index:index + 3]
    return {
        "direction": settings["direction"],
        "reads": 0,
        "bases": bytes(bases),
        "heat": bytearray(LENGTH),
        "sweep": 0,
        "step": settings["rate"] * 180 // 255 + 50,
        "strip": bytearray(3 * LENGTH),
    }


def crumble_step(state, settings, clock_ms, render) -> bytes:
    heat, bases, strip = state["heat"], state["bases"], state["strip"]
    limit = 255 - settings["intensity"]
    for pixel in range(LENGTH):
        value = heat[pixel]
        if value == 0 or (_read(state) & 255) > limit:
            continue
        stored = (value + 3 - ((_read(state) & 255) * 24 >> 8)) & 255
        stored = 0 if stored > 235 else min(stored, 230)
        heat[pixel] = stored
        gain = stored + 1 if stored else 0
        at = 3 * pixel
        strip[at] = bases[at] * gain >> 8
        strip[at + 1] = bases[at + 1] * gain >> 8
        strip[at + 2] = bases[at + 2] * gain >> 8
    sweep = state["sweep"]
    position = (_CRUMBLE_SPAN - 1) * ((sweep >> 6) & 255) // 255
    for offset in range(position, position + _CRUMBLE_RUN):
        pixel = offset - _CRUMBLE_SPAN if offset >= _CRUMBLE_SPAN else offset
        if pixel < LENGTH:
            strip[3 * pixel:3 * pixel + 3] = bases[3 * pixel:3 * pixel + 3]
            heat[pixel] = 230
    state["sweep"] = (sweep + state["step"]) & U32
    return place_strip(strip, state["direction"])


# ── Slot 61: Particle glows ─────────────────────────────────────────────
_DRIFT_WIDTH = float(LENGTH // 4 - 2)
_DRIFT_RIGHT = float(LENGTH)


def _f32s(values) -> list:
    """Every value rounded to a 32-bit float, in one go."""
    return array("f", values).tolist()


def drift_init(settings) -> dict:
    colours = effect_colours(settings)
    return {
        "direction": settings["direction"],
        "reads": 0,
        "words": (colours["primary"], colours["secondary"]),
        "speed": f32(settings["rate"] * 205 // 255 + 50),
        "particles": None,
        "strip": bytearray(3 * LENGTH),
    }


def _drift_spawn(state, particle: dict) -> dict:
    """A particle's spawn: the colour's read, then its five, in this order."""
    particle["colour"] = state["words"][(_read(state) >> 7) & 1]
    particle["life"] = (((_read(state) & 0xFFFF) * 1000) >> 16) + 500
    particle["scale"] = f32(f32(((_read(state) & 0xFFFF) * 41 >> 16) + 60) / 100)
    particle["age"] = 0
    particle["position"] = f32(f32(LENGTH) * f32(f32(((_read(state) & 0xFFFF) * 101) >> 16) / 100))
    particle["back"] = not (_read(state) >> 15) & 1
    particle["speed"] = f32(f32(f32(f32(((_read(state) >> 12) & 15) + 15) / 100) * 4) / 255)
    return particle


def drift_step(state, settings, clock_ms, render) -> bytes:
    intensity = settings["intensity"]
    particles = state["particles"]
    if particles is None:
        count = int(intensity * 8 / 255 + 2)
        particles = state["particles"] = [_drift_spawn(state, {}) for _ in range(count)]
    width = _DRIFT_WIDTH
    for particle in particles:
        move = f32(state["speed"] * particle["speed"])
        position = particle["position"] = f32(particle["position"] + (-move if particle["back"] else move))
        particle["age"] = (particle["age"] + 1) & 0xFFFF
        if particle["age"] > particle["life"]:
            _drift_spawn(state, particle)
        elif particle["back"]:
            if not f32(position + width) >= 0:
                particle["back"] = False
        elif not f32(position - width) <= _DRIFT_RIGHT:
            particle["back"] = True
    # By particle, not by pixel: the adds are >= 0, so the cap can wait.
    mixed = [0] * (3 * LENGTH)
    for particle in particles:
        position, life, age = particle["position"], particle["life"], particle["age"]
        first = max(0, math.ceil(f32(position - width)))
        last = min(LENGTH - 1, math.floor(f32(position + width)))
        if first > last or not age:
            continue
        envelope = f32((life - age if f32(age / life) >= 0.5 else age) / (life * 0.5))
        shares = _f32s([abs(share) / width for share in _f32s([cell - position for cell in range(first, last + 1)])])
        shares = _f32s([share * envelope for share in _f32s([1 - share for share in shares])])
        scale = particle["scale"]
        shares = _f32s([scale * share for share in shares])
        for channel, value in enumerate(particle["colour"]):
            if value:
                at = 3 * first + channel
                for add in _f32s([value * share for share in shares]):
                    mixed[at] += int(add)
                    at += 3
    strip = state["strip"]
    strip[:] = bytes([value if value < 255 else 255 for value in mixed])
    strip_blur(strip, intensity)
    return place_strip(strip, state["direction"])


# ── Slot 63: Centre bursts ──────────────────────────────────────────────
# Pixels 0..36 run towards 0, 37..56 away from it, each step; what is past them
# takes one tail colour, fed by the bright pixels reaching pixel 0. The working
# buffer goes out by panel index, unmapped: the direction is not read.
_BURST_ROUTE = bytes((value * 255) >> 8 for value in range(256))  # brightness 255


def burst_init(settings) -> dict:
    return {
        "reads": 0,
        "period": int(settings["rate"] * -3.0 / 255.0 + 4.0),
        "colour": bytes(effect_colours(settings)["primary"]),
        "work": bytearray(3 * LENGTH),
        "panel": bytes(3 * LENGTH),
    }


def burst_step(state, settings, clock_ms, render) -> bytes:
    step = (render + 1) & 0xFFFF
    period = state["period"]
    if step % period:
        return state["panel"]
    work, colour = state["work"], state["colour"]
    work[:108] = work[3:111]
    work[114:171] = work[111:168]
    work[108:114] = bytes(6)
    if step % (10 * period) == 0:
        left = ((_read(state) & 255) * 7) >> 8
        work[3 * (37 - left):111] = colour * left
        right = ((_read(state) & 255) * 3) >> 8
        work[111:111 + 3 * right] = colour * right
    if work[:3] == colour:
        tail = bytes((work[291 + channel] * 250 + work[channel] * 5) >> 8 for channel in range(3))
    else:
        tail = bytes((work[291 + channel] * 235) >> 8 for channel in range(3))
    work[171:] = tail * (LENGTH - 57)
    state["panel"] = work.translate(_BURST_ROUTE)
    return state["panel"]


# ── Slot 72: Random scatter ─────────────────────────────────────────────
# One colour word per pixel on the first render, then held: the same panel whatever
# the render.
def scatter_init(settings) -> dict:
    words = [bytes(word) for word in effect_colours(settings)["words"]]
    strip = b"".join([words[source_word(draw) & 3] for draw in range(LENGTH)])
    return {"panel": place_strip(strip, settings["direction"])}


def scatter_step(state, settings, clock_ms, render) -> bytes:
    return state["panel"]


# ── Slot 79: Violet twinkles ────────────────────────────────────────────
_TWINKLE_COLOURS = ((0x5C, 0x07, 0xFF), (0x83, 0x07, 0xFF), (0xDA, 0x07, 0xFF), (0xFF, 0x83, 0xF0))
_TWINKLE_ENTRIES = (0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3)  # by the word's low nibble


def twinkle_init(settings) -> dict:
    return {
        **_twinkle_init(settings, 243),
        "seeds": [bytes(convert_colour(colour)) for colour in _TWINKLE_COLOURS],
    }


def twinkle_step(state, settings, clock_ms, render) -> bytes:
    _twinkle_pass(state)
    stars = state["stars"]
    for _chance in range(LENGTH // 25 + 1):
        _read(state)  # unused
        attempt = 0
        while True:
            target = ((_read(state) & 0xFFFF) * LENGTH) >> 16
            if not _occupied(stars, target):
                stars[3 * target:3 * target + 3] = state["seeds"][_TWINKLE_ENTRIES[_read(state) & 15]]
                state["growing"][target] = 1
                break
            attempt += 1
            if attempt >= ((_read(state) >> 6) & 3) + 6:
                break
    return place_strip(stars, state["direction"])


# ── Slot 81: Palette ────────────────────────────────────────────────────
# The lamp's 2.8 gamma table.
_GAMMA = tuple(math.floor((index / 255) ** 2.8 * 255 + 0.5) for index in range(256))


def _disc_cells() -> tuple:
    """(distance squared, its f32 root, the offsets at it), nearest first: a
    radius stays below 7 on the 20-high box."""
    cells: dict[int, list] = {}
    for dy in range(-7, 8):
        for dx in range(-7, 8):
            cells.setdefault(dy * dy + dx * dx, []).append((dy, dx))
    return tuple((distance, f32(math.sqrt(distance)), tuple(cells[distance])) for distance in sorted(cells))


_DISC = _disc_cells()


def palette_init(settings) -> dict:
    width, height = effect_geometry(settings)
    colours = effect_colours(settings)
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "limit": height * 300 + 1000,
        "table": colours["table"],
        "span": palette_span(len(colours["palette"])),
        "reads": 0,
        "blobs": None,
    }


def _blob_place(state, blob: dict) -> dict:
    blob["x"] = ((_read(state) & 0xFFFF) * state["width"]) >> 16
    blob["y"] = ((_read(state) & 0xFFFF) * state["height"]) >> 16
    blob["hue"] = _read(state) & 255
    return blob


def _blob_spawn(state, speed_gain: int) -> dict:
    blob = _blob_place(state, {"radius": f32(0.1), "previous": 0})
    blob["phase"] = ((_read(state) & 0xFFFF) * 0xFFFF) >> 16
    blob["speed"] = (_read(state) & 255) * speed_gain >> 8
    return blob


def palette_step(state, settings, clock_ms, render) -> bytes:
    blobs = state["blobs"]
    if blobs is None:
        blobs = state["blobs"] = [_blob_spawn(state, settings["rate"] >> 2) for _ in range(10)]
    width, height, limit = state["width"], state["height"], state["limit"]
    table, span = state["table"], state["span"]
    mixed = [0] * (3 * LENGTH)
    for blob in blobs:
        phase = blob["phase"]
        # Theta: only the low 32 bits of the lamp's 64-bit product count.
        turn = (((clock_ms - phase) * ((blob["speed"] + 16) << 8) * 280) & U32) >> 16
        radius = limit * sin16_unsigned((turn + phase) & 0xFFFF) >> 16
        before, older = blob["radius"], blob["previous"]
        blob["previous"], blob["radius"] = before, radius
        if not radius < before and before <= older:  # at a minimum: moved, not drawn
            _blob_place(state, blob)
            continue
        gain = radius * 239 // limit + 17
        index = 3 * (blob["hue"] * span >> 8)
        red, green, blue = table[index] * gain >> 8, table[index + 1] * gain >> 8, table[index + 2] * gain >> 8
        size = f32(radius / 1000)
        square = f32(size * size)
        x, y = blob["x"], blob["y"]
        for distance, root, cells in _DISC:
            if distance > square:
                break
            alpha = 255 if root <= 1 else int(f32(f32(1 - f32(root / size)) * 255))
            weight = _GAMMA[alpha]
            add_red, add_green, add_blue = red * weight >> 8, green * weight >> 8, blue * weight >> 8
            for dy, dx in cells:
                column, row = x + dx, y + dy
                if 0 <= column < width and 0 <= row < height:
                    at = 3 * (row * width + column)
                    mixed[at] += add_red
                    mixed[at + 1] += add_green
                    mixed[at + 2] += add_blue
    return place_strip([value if value < 255 else 255 for value in mixed], state["direction"])


SLOTS = (
    {"mode": 5, "init": starry_init, "step": starry_step, "warmup": None},
    {"mode": 6, "init": chase_init, "step": chase_step, "warmup": _CHASE_WARMUP},
    {"mode": 14, "init": trail_init, "step": trail_step, "warmup": None},
    {"mode": 16, "init": drop_init, "step": drop_step, "warmup": None, "lit": 1},
    {"mode": 22, "init": prism_init, "step": prism_step, "warmup": None},
    {"mode": 23, "init": trail_init, "step": aqua_lime_step, "warmup": None},
    {"mode": 24, "init": ember_init, "step": ember_step, "warmup": None},
    {"mode": 33, "init": wisps_init, "step": wisps_step, "warmup": None},
    {"mode": 60, "init": crumble_init, "step": crumble_step, "warmup": None},
    {"mode": 61, "init": drift_init, "step": drift_step, "warmup": None},
    {"mode": 63, "init": burst_init, "step": burst_step, "warmup": None, "lit": 1},
    {"mode": 72, "init": scatter_init, "step": scatter_step, "warmup": 0},
    {"mode": 79, "init": twinkle_init, "step": twinkle_step, "warmup": None},
    {"mode": 81, "init": palette_init, "step": palette_step, "warmup": None},
)
