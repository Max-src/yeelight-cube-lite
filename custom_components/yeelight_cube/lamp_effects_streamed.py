"""Renderers of the integration's own effects (effect_catalog.STREAMED_EFFECTS): no
lamp has them, so they are drawn here and streamed to it frame by frame
(light_studio), a Cube Lite over the LAN, a Cube Matrix over Matter or the
LAN. Their slots are past the lamps' own (effect_catalog.STREAMED_EFFECT_FIRST_SLOT):
only these renderers read them, no command ever sends them.
Mirrors www/lamp-effects-streamed.js exactly.

They follow lamp_effects_core.py's rules for a renderer, but draw what they
are designed to, not what a lamp draws: nothing to match frame for frame,
so they are a pure function of the render (the time since the effect
started) or, when they simulate something (Lava Lamp), of the renders before
it, the same in both languages (tests/test_streamed_effects.py).
"""

from __future__ import annotations

try:
    from .lamp_core import (
        PALETTE_SOURCES, RENDER_MS, U32, convert_colour, effect_geometry, native_palette, place_strip,
    )
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_core import (
        PALETTE_SOURCES, RENDER_MS, U32, convert_colour, effect_geometry, native_palette, place_strip,
    )


# ── Slot 100: Knight Rider ─────────────────────────────────────────────
# A light runs along the direction's line, back and forth, leaving a trail
# that fades as it goes out. The speed sets one sweep's time, the intensity
# the trail's length. Its colour is the one sent (red by default); with
# several (the palette color mode) each sweep takes the next, the trail
# keeping the colour of the sweep that lit it. A lamp preset (Vivid, Retro
# Orange, Tropical, Violet & Gold) gives it colours spread along its
# gradient (preset_colours); B&W, as no colour at all, white.
KNIGHT_RIDER_MODE = 100
_SWEEP_SLOWEST_MS = 2600
_SWEEP_FASTEST_MS = 400
# A preset's colours: up to this many, evenly along its gradient.
_PRESET_COLOURS = 4


def preset_colours(selector: int, mode: int) -> list:
    """The colours a preset's palette selector gives an effect of the
    integration's own: its gradient's, dark ones left out, all of a short
    one, else _PRESET_COLOURS of them from end to end. Converted (LED drive)
    as native_palette gives them."""
    colours = [colour for colour in native_palette(selector, mode) if max(colour) >= 32]
    if len(colours) <= _PRESET_COLOURS + 1:
        return colours
    last = len(colours) - 1
    return [colours[index * last // (_PRESET_COLOURS - 1)] for index in range(_PRESET_COLOURS)]


def knight_trail_ms(sweep: int, intensity: int) -> int:
    """How long the trail takes to fade out: 1/8 of a sweep at intensity 0,
    about half at 128, 1.5 sweeps at 255 (rising with its square)."""
    return max(1, sweep * (32 * 65025 + 352 * intensity * intensity) // (256 * 65025))


def knight_sweep_ms(rate: int) -> int:
    """One sweep's time (ms): 2.6 s at rate 0 to 0.4 s at 255."""
    return _SWEEP_SLOWEST_MS - rate * (_SWEEP_SLOWEST_MS - _SWEEP_FASTEST_MS) // 255


def knight_init(settings) -> dict:
    width, height = effect_geometry(settings)
    sweep = knight_sweep_ms(settings["rate"])
    if settings["coloured"]:
        colours = [convert_colour(tuple(colour)) for colour in settings.get("colours") or (settings["primary"],)]
    elif settings["selector"] in PALETTE_SOURCES:
        colours = preset_colours(settings["selector"], settings["mode"])
    else:  # no colour sent (B&W): white
        colours = [convert_colour(tuple(settings["primary"]))]
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "sweep": sweep,
        "trail": knight_trail_ms(sweep, settings["intensity"]),
        "colours": colours,
    }


def knight_step(state, settings, clock_ms, render) -> bytes:
    width, height, sweep, trail = state["width"], state["height"], state["sweep"], state["trail"]
    colours = state["colours"]
    count = len(colours)
    full = (height - 1) * 256  # the line's length, in 1/256 of a cell
    sweeps, into = divmod(render * RENDER_MS, sweep)
    forward = sweeps % 2 == 0
    head = into * full // sweep
    position = head if forward else full - head
    strip = bytearray(3 * width * height)
    for cell in range(height):
        at = cell * 256
        behind = position - at if forward else at - position
        if behind >= 0:  # passed this sweep
            elapsed = behind * sweep // full
            colour = colours[sweeps % count]
        else:  # passed the sweep before, on its way to the end this one left
            elapsed = into + (at if forward else full - at) * sweep // full
            colour = colours[(sweeps - 1) % count]
        level = 0
        if elapsed < trail:
            left = trail - elapsed
            level = 255 * left * left // (trail * trail)
        if 0 < -behind < 256:  # the head's front, between two cells
            front = 255 * (256 + behind) // 256
            if front > level:
                level, colour = front, colours[sweeps % count]
        if level:
            red, green, blue = colour
            pixel = bytes((red * level // 255, green * level // 255, blue * level // 255))
            strip[3 * width * cell:3 * width * (cell + 1)] = pixel * width
    return place_strip(bytes(strip), state["direction"])


# ── Slot 101: Lava Lamp ────────────────────────────────────────────────
# Wax heated in a pool at the bottom (the direction's start) swells into
# blobs that rise, cool as they go up, slow down and sink back to melt into
# the pool again. A simulation, not a loop: each blob has its own size,
# heating and cooling, nudged at every render by the random source, so it
# never repeats; a seed (settings "seed": a new one each time a lamp is
# streamed it, light_studio) starts every run differently. Blobs that meet
# merge (their fields add up, as metaballs) and come apart again. The speed
# sets how fast it all goes, the intensity how much wax there is
# (lava_blob_count). Colours: one colour lights the wax and, dimly, the
# liquid; with several (a palette, a lamp preset) the blobs take the first
# ones in turn and the liquid glows in the last.
LAVA_LAMP_MODE = 101
# Positions in 1/64 of a cell (drawn), kept in 1/256 of that (moved, so slow
# moves do not round one way); temperatures 0..4095, rising above the middle.
_LAVA_CELL = 64
_LAVA_FINE = 256
_LAVA_NEUTRAL = 2048
_LAVA_HOT = 4095
# How much faster a blob cools in the top two cells.
_LAVA_TOP_COOL = 8
# The field is 256 at a blob's edge (lava_step): wax shows from _LAVA_SHOW
# on, full from _LAVA_SHOW + _LAVA_RAMP.
_LAVA_SHOW = 150
_LAVA_RAMP = 180
# Past this (q, 16 times the edge's) a blob adds nothing to a cell.
_LAVA_REACH = 4096
# The liquid's glow, out of 255: at the top, and more at the heated bottom.
_LAVA_LIQUID_TOP = 10
_LAVA_LIQUID_BOTTOM = 34


def lava_blob_count(intensity: int) -> int:
    """Blobs of wax besides the pool: 2 at intensity 0 to 7 at 255."""
    return 2 + intensity * 5 // 255


def lava_tempo(rate: int) -> int:
    """How fast the lamp runs, in 1/256: 0.5 at rate 0 to 2.25 at 255 (a
    blob's round trip along the long side: about 80 s to 18 s)."""
    return 128 + rate * 448 // 255


def _lava_draw(state) -> int:
    """The run's next random word (mulberry32, from the seed). Not the lamp's
    source_word: nothing here imitates a lamp, and a simulation drawing
    several numbers per blob needs one with no pattern in its strides."""
    value = state["random"] = (state["random"] + 0x6D2B79F5) & U32
    value = ((value ^ (value >> 15)) * (value | 1)) & U32
    value ^= (value + ((value ^ (value >> 7)) * (value | 61) & U32)) & U32
    return (value ^ (value >> 14)) & U32


def _lava_radius(state) -> int:
    """A blob's size: 0.8 to 1.6 cells along a long line, smaller along a
    short one (lava_init's size)."""
    return state["size"] * (51 + _lava_draw(state) % 52) // 64


def lava_init(settings) -> dict:
    width, height = effect_geometry(settings)
    if settings["coloured"]:
        colours = [convert_colour(tuple(colour)) for colour in settings.get("colours") or (settings["primary"],)]
    elif settings["selector"] in PALETTE_SOURCES:
        colours = preset_colours(settings["selector"], settings["mode"])
    else:  # no colour sent (B&W): white
        colours = [convert_colour(tuple(settings["primary"]))]
    wax = colours[:-1] if len(colours) > 1 else colours
    state = {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "tempo": lava_tempo(settings["rate"]),
        "wax": wax,
        "liquid": colours[-1],
        "random": int(settings.get("seed") or 0) & U32,
        # A short line (the 5 rows) gets smaller blobs. The pool covers the
        # first cell's middle, so its surface's swell never makes it blink.
        "size": 64 if height >= 10 else 40,
        "pool": 40,
        # The pool's surface, by cell across: its swell (in 1/64 cell), eased
        # towards a target that wanders at random (smooth, never jittering).
        "pool_wave": [0] * width,
        "pool_target": [0] * width,
        "strip": bytearray(3 * width * height),
    }
    top = height * _LAVA_CELL
    across = width * _LAVA_CELL
    blobs = []
    # A wide line (10 cells across or more) holds two more.
    for index in range(lava_blob_count(settings["intensity"]) + (2 if width >= 10 else 0)):
        radius = _lava_radius(state)
        x = (across // 8 + _lava_draw(state) % (across * 3 // 4 + 1)) * _LAVA_FINE
        blobs.append({
            "x": x,
            "y": (_lava_draw(state) % top) * _LAVA_FINE,
            "vx": 0,
            "vy": 0,
            "t": 600 + _lava_draw(state) % 2800,
            "r": radius,
            "target": radius,
            "heat": 8 + _lava_draw(state) % 9,
            "cool": 1 + _lava_draw(state) % 2,
            "release": _lava_release(state),
            "drift": x,
            "colour": wax[index % len(wax)],
        })
    state["blobs"] = blobs
    return state


def _lava_release(state) -> int:
    """How hot a blob gets in the pool before it comes away: wax heats well
    past floating before it lets go."""
    return 3000 + _lava_draw(state) % 801


def _lava_move(state) -> None:
    """One render of the simulation: heat, buoyancy, drag, random nudges."""
    tempo = state["tempo"]
    top = state["height"] * _LAVA_CELL * _LAVA_FINE
    across = state["width"] * _LAVA_CELL * _LAVA_FINE
    floor = state["pool"] * _LAVA_FINE
    cool_zone = top - 2 * _LAVA_CELL * _LAVA_FINE
    # The pool's surface swells and settles: each cell's target wanders, the
    # surface eases towards it, pulled towards its neighbours'.
    targets = state["pool_target"] = [
        target + _lava_draw(state) % 7 - 3 - target // 16 for target in state["pool_target"]
    ]
    waves = state["pool_wave"]
    last = len(waves) - 1
    state["pool_wave"] = [
        wave + (targets[cell] - wave) // 4
        + (waves[max(0, cell - 1)] + waves[min(last, cell + 1)] - 2 * wave) // 8
        for cell, wave in enumerate(waves)
    ]
    for blob in state["blobs"]:
        y = blob["y"]
        word = _lava_draw(state)
        if y <= floor:  # in the pool: heated, held until it lets go
            blob["t"] = min(_LAVA_HOT, blob["t"] + blob["heat"] * tempo // 256)
            if blob["t"] < blob["release"]:
                blob["vy"] = 0
            # Melted in, it flows along the pool to where it rises next.
            blob["vx"] += (blob["drift"] - blob["x"]) // (24 * _LAVA_FINE)
        else:  # cooling as it goes, fast against the cold top
            cool = blob["cool"] + (_LAVA_TOP_COOL if y > cool_zone else 0)
            blob["t"] = max(0, blob["t"] - cool * tempo // 256)
        vy = blob["vy"]
        if y > floor or blob["t"] >= blob["release"]:
            vy += (blob["t"] - _LAVA_NEUTRAL) // 32 + (word & 31) - 15
            vy -= vy // 32
        vx = blob["vx"] + ((word >> 8) & 63) - 31
        vx -= vx // 8
        # Drawn back to the middle, gently: more gently across a wide line.
        vx += (across // 2 - blob["x"]) // (4 * _LAVA_FINE * state["width"])
        y += vy * tempo // 256
        x = blob["x"] + vx * tempo // 256
        if y < floor:  # back in the pool, melting into it
            if blob["y"] > floor:
                blob["release"] = _lava_release(state)
                blob["drift"] = (across // 8 + _lava_draw(state) % (across * 3 // 4 // _LAVA_FINE + 1) * _LAVA_FINE)
            y, vy = floor, 0
        if y > top - blob["r"] * _LAVA_FINE // 2:  # held against the top while it cools
            y, vy = top - blob["r"] * _LAVA_FINE // 2, min(vy, 0)
        edge = blob["r"] * _LAVA_FINE // 2
        if x < edge:
            x, vx = edge, abs(vx)
        elif x > across - edge:
            x, vx = across - edge, -abs(vx)
        blob["x"], blob["y"], blob["vx"], blob["vy"] = x, y, vx, vy
        # Its size drifts: a new one now and then, eased towards.
        if (word >> 16) & 127 == 0:
            blob["target"] = _lava_radius(state)
        if blob["r"] < blob["target"]:
            blob["r"] += 1
        elif blob["r"] > blob["target"]:
            blob["r"] -= 1


def lava_step(state, settings, clock_ms, render) -> bytes:
    _lava_move(state)
    width, height = state["width"], state["height"]
    top = height * _LAVA_CELL
    liquid, first = state["liquid"], state["wax"][0]
    strip = state["strip"]
    shapes = []
    for blob in state["blobs"]:
        # Stretched along its way as it moves, thinner across.
        stretch = min(abs(blob["vy"]), 1600) * blob["r"] // 6400
        along = blob["r"] + stretch
        side = max(16, blob["r"] - stretch // 2)
        shapes.append((blob["x"] // _LAVA_FINE, blob["y"] // _LAVA_FINE, side * side, along * along, blob["colour"]))
    for row in range(height):
        centre_y = row * _LAVA_CELL + _LAVA_CELL // 2
        glow = _LAVA_LIQUID_TOP + (_LAVA_LIQUID_BOTTOM - _LAVA_LIQUID_TOP) * (top - centre_y) // top
        # A blob whose reach along stops short of the row adds nothing to it.
        near = []
        for x, y, side2, along2, colour in shapes:
            dy = centre_y - y
            down = dy * dy * 256 // along2
            if down < _LAVA_REACH:
                near.append((x, down, side2, colour))
        for column in range(width):
            centre_x = column * _LAVA_CELL + _LAVA_CELL // 2
            # The pool: its edge (256) at the surface, rising smoothly below it
            # to full, falling off over it as a blob's does.
            above = centre_y - state["pool"] - state["pool_wave"][column]
            if above <= 0:
                pool = min(4096, 256 - above * 64)
            else:
                pool = 65536 // (256 + above * above * 256 // 576)
            field = weight = pool
            red, green, blue = first[0] * pool, first[1] * pool, first[2] * pool
            for x, down, side2, colour in near:
                dx = centre_x - x
                q = dx * dx * 256 // side2 + down
                if q >= _LAVA_REACH:
                    continue
                part = 65536 // (q if q > 16 else 16)
                field += part
                weight += part
                red += colour[0] * part
                green += colour[1] * part
                blue += colour[2] * part
            weight = max(1, weight)
            level = min(255, max(0, (field - _LAVA_SHOW) * 255 // _LAVA_RAMP))
            dark = (255 - level) * glow
            index = 3 * (row * width + column)
            strip[index] = (red // weight * level + liquid[0] * dark // 255) // 255
            strip[index + 1] = (green // weight * level + liquid[1] * dark // 255) // 255
            strip[index + 2] = (blue // weight * level + liquid[2] * dark // 255) // 255
    return place_strip(bytes(strip), state["direction"])


# ── Slot 102: Falling Blocks ───────────────────────────────────────────
# A falling-block puzzle played by itself: pieces of four cells enter at the
# far end of the direction's line, and a player (blocks_plan: every rotation
# and place scored for the lines it completes, the holes it leaves, the
# height and the bumpiness of the stack) turns them and slides them sideways
# as they fall, every piece at the same pace all the way down. A full line flashes and goes, the stack
# above it coming down; when a piece can no longer come in, the stack is
# wiped away row by row from the top, and a new game starts. Pieces come in shuffled sets of the
# seven shapes, from the run's seed (a new one each time a lamp is streamed
# it, as Lava Lamp's), so no two games are the same. The speed sets how fast
# pieces fall, the intensity how well the player plays (lower: more
# mistakes, shorter games). Colours: its own seven, one per shape; the colour
# chosen in seven shades; a palette's or a preset's colours by shape; B&W,
# shades of white.
BLOCKS_MODE = 102
# Each shape's cells (x, y), y towards the line's start (where the stack
# grows).
_BLOCK_SHAPES = (
    ((0, 0), (1, 0), (2, 0), (3, 0)),
    ((0, 0), (1, 0), (0, 1), (1, 1)),
    ((0, 0), (1, 0), (2, 0), (1, 1)),
    ((0, 0), (1, 0), (1, 1), (2, 1)),
    ((1, 0), (2, 0), (0, 1), (1, 1)),
    ((0, 0), (1, 0), (2, 0), (0, 1)),
    ((0, 0), (1, 0), (2, 0), (2, 1)),
)
# Its own colours, one per shape (not converted: convert_colour does it).
_BLOCK_COLOURS = (
    (0, 200, 220), (255, 200, 0), (170, 60, 255), (60, 220, 60),
    (255, 40, 60), (40, 90, 255), (255, 120, 0),
)
# A single colour's seven shades (out of 255).
_BLOCK_SHADES = (255, 205, 160, 230, 185, 140, 215)
# Renders a full line flashes before it goes; the full well's, row by row.
_BLOCK_CLEAR_RENDERS = 8
# The game-over wipe takes about this many renders whatever the well's depth
# (2 a row on the long well, 8 on the 5-row one).
_BLOCK_OVER_RENDERS = 40
_BLOCK_OVER_HOLD = 12
# The player's scores (blocks_plan): per line completed, per cell of stack
# height, per hole, per step between neighbouring columns.
# The share of a piece's fall (out of 5) its turns and moves are spread over:
# the player takes its time, so they are seen; the piece keeps falling at its
# pace (never dropped faster).
_BLOCK_MOVE_SHARE = 4
# Tuned on 10-minute runs: holes weigh most, so a shallow well (the 5 rows)
# still clears lines.
_BLOCK_LINES = 760
_BLOCK_HEIGHT = 200
_BLOCK_HOLES = 1200
_BLOCK_BUMPS = 300


def _block_rotations(cells) -> list:
    """A shape's distinct rotations, each its cells moved to (0, 0) and
    sorted by row then column."""
    out = []
    current = list(cells)
    for _ in range(4):
        low_x = min(x for x, _y in current)
        low_y = min(y for _x, y in current)
        placed = tuple(sorted(((x - low_x, y - low_y) for x, y in current), key=lambda cell: (cell[1], cell[0])))
        if placed not in out:
            out.append(placed)
        current = [(y, -x) for x, y in current]
    return out


_BLOCK_ROTATIONS = tuple(_block_rotations(cells) for cells in _BLOCK_SHAPES)


def blocks_fall_renders(rate: int) -> int:
    """Renders for a piece to fall one cell: 680 ms at rate 0 to 80 ms at 255."""
    return max(2, (700 - rate * 600 // 255) // RENDER_MS)


def _blocks_draw(state) -> int:
    """The run's next random word (mulberry32, from the seed), as Lava Lamp's."""
    value = state["random"] = (state["random"] + 0x6D2B79F5) & U32
    value = ((value ^ (value >> 15)) * (value | 1)) & U32
    value ^= (value + ((value ^ (value >> 7)) * (value | 61) & U32)) & U32
    return (value ^ (value >> 14)) & U32


def blocks_init(settings) -> dict:
    width, height = effect_geometry(settings)
    if settings["coloured"]:
        chosen = [convert_colour(tuple(colour)) for colour in settings.get("colours") or (settings["primary"],)]
        if len(chosen) == 1:
            red, green, blue = chosen[0]
            chosen = [(red * shade // 255, green * shade // 255, blue * shade // 255) for shade in _BLOCK_SHADES]
    elif settings["selector"] == 0:  # no colour chosen: its own
        chosen = [convert_colour(colour) for colour in _BLOCK_COLOURS]
    elif settings["selector"] in PALETTE_SOURCES:
        chosen = preset_colours(settings["selector"], settings["mode"])
    else:  # B&W: shades of white
        red, green, blue = convert_colour(tuple(settings["primary"]))
        chosen = [(red * shade // 255, green * shade // 255, blue * shade // 255) for shade in _BLOCK_SHADES]
    white = convert_colour((255, 255, 255))
    fall = blocks_fall_renders(settings["rate"])
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "colours": chosen,
        "white": white,
        "fall": fall,
        "wipe": max(2, _BLOCK_OVER_RENDERS // height),
        # Sideways steps: quicker across a wide well.
        "move": max(1, fall // max(3, width // 2)),
        "skill": settings["intensity"],
        "random": int(settings.get("seed") or 0) & U32,
        # The stack: a colour index per cell, -1 empty; row 0 the bottom.
        "grid": [[-1] * width for _ in range(height)],
        "bag": [],
        "piece": None,
        "phase": "play",
        "timer": 0,
        "tick": 0,
        "last_fall": 0,
        "clearing": [],
        "strip": bytearray(3 * width * height),
    }


def _blocks_fits(state, cells, x, y) -> bool:
    width, height, grid = state["width"], state["height"], state["grid"]
    for cell_x, cell_y in cells:
        column, row = x + cell_x, y + cell_y
        if column < 0 or column >= width or row < 0:
            return False
        if row < height and grid[row][column] >= 0:
            return False
    return True


def _blocks_next_shape(state) -> int:
    """From a shuffled set of the seven shapes, refilled when empty."""
    if not state["bag"]:
        bag = list(range(len(_BLOCK_SHAPES)))
        for index in range(len(bag) - 1, 0, -1):
            other = _blocks_draw(state) % (index + 1)
            bag[index], bag[other] = bag[other], bag[index]
        state["bag"] = bag
    return state["bag"].pop()


def _blocks_score(state, cells, x, y) -> int:
    """The player's score of the stack with ``cells`` placed at (x, y)."""
    width, height = state["width"], state["height"]
    rows = [[cell >= 0 for cell in row] for row in state["grid"]]
    for cell_x, cell_y in cells:
        if y + cell_y < height:
            rows[y + cell_y][x + cell_x] = True
    kept = [row for row in rows if not all(row)]
    lines = height - len(kept)
    heights = []
    holes = 0
    for column in range(width):
        top = 0
        for row in range(len(kept)):
            if kept[row][column]:
                top = row + 1
        heights.append(top)
        holes += sum(1 for row in range(top) if not kept[row][column])
    bumps = sum(abs(heights[column] - heights[column + 1]) for column in range(width - 1))
    return (_BLOCK_LINES * lines - _BLOCK_HEIGHT * sum(heights)
            - _BLOCK_HOLES * holes - _BLOCK_BUMPS * bumps)


def blocks_plan(state, shape, spawn_y) -> tuple:
    """Where the player puts a piece: (rotation, x), the best scored, with a
    random nudge and now and then a random choice, more of both the lower
    its skill. (0, None) when it fits nowhere."""
    width = state["width"]
    mistakes = 255 - state["skill"]
    options = []
    for rotation, cells in enumerate(_BLOCK_ROTATIONS[shape]):
        span = max(cell_x for cell_x, _y in cells) + 1
        for x in range(width - span + 1):
            if not _blocks_fits(state, cells, x, spawn_y):
                continue
            y = spawn_y
            while _blocks_fits(state, cells, x, y - 1):
                y -= 1
            score = _blocks_score(state, cells, x, y) + _blocks_draw(state) % (mistakes * 20 + 1)
            options.append((score, rotation, x))
    if not options:
        return 0, None
    if _blocks_draw(state) % 1024 < mistakes:  # a slip: anywhere it fits
        _score, rotation, x = options[_blocks_draw(state) % len(options)]
        return rotation, x
    best = options[0]
    for option in options[1:]:
        if option[0] > best[0]:
            best = option
    return best[1], best[2]


def _blocks_spawn(state) -> None:
    """A new piece at the far end: in the middle of a deep well, above the
    player's place in a wide, shallow one (it could not slide that far before
    landing); else where it fits nearest to that, else turned as the player
    wants it, above its place. Nowhere: the game is over."""
    shape = _blocks_next_shape(state)
    rotations = _BLOCK_ROTATIONS[shape]
    cells = rotations[0]
    span = max(cell_x for cell_x, _y in cells) + 1
    rise = max(cell_y for _x, cell_y in cells) + 1
    y = state["height"] - rise
    rotation, target = blocks_plan(state, shape, y)
    middle = (state["width"] - span) // 2
    if state["width"] > state["height"] and target is not None:
        middle = min(target, state["width"] - span)
    start = None
    for offset in range(state["width"]):
        for x in (middle - offset, middle + offset):
            if start is None and 0 <= x <= state["width"] - span and _blocks_fits(state, cells, x, y):
                start = (0, x)
    if start is None and target is not None:
        start = (rotation, target)
    if start is None:
        state["phase"], state["timer"], state["piece"] = "over", 0, None
        return
    goal_x = start[1] if target is None else target
    state["piece"] = {
        "shape": shape, "rotation": start[0], "x": start[1], "y": y,
        "goal_rotation": rotation, "goal_x": goal_x,
        "every": _blocks_move_every(state, rotations, start, rotation, goal_x, y),
    }
    state["piece"]["next_move"] = state["tick"] + state["piece"]["every"]
    state["last_fall"] = state["tick"]


def _blocks_move_every(state, rotations, start, rotation, goal_x, y) -> int:
    """Renders between a piece's turns and moves: spread evenly over the first
    _BLOCK_MOVE_SHARE fifths of its fall to where the player puts it (none
    needed, or no room to fall: the usual pace)."""
    turns = (rotation - start[0]) % len(rotations)
    moves = turns + abs(goal_x - start[1])
    cells = rotations[rotation]
    landing = y
    while _blocks_fits(state, cells, goal_x, landing - 1):
        landing -= 1
    budget = (y - landing) * state["fall"] * _BLOCK_MOVE_SHARE // 5
    if not moves or budget <= 0:
        return state["move"]
    return max(state["move"], budget // (moves + 1))


def _blocks_lock(state) -> None:
    piece = state["piece"]
    grid = state["grid"]
    colour = piece["shape"] % len(state["colours"])
    for cell_x, cell_y in _BLOCK_ROTATIONS[piece["shape"]][piece["rotation"]]:
        row = piece["y"] + cell_y
        if row < state["height"]:
            grid[row][piece["x"] + cell_x] = colour
    state["piece"] = None
    full = [row for row in range(state["height"]) if all(cell >= 0 for cell in grid[row])]
    if full:
        state["phase"], state["timer"], state["clearing"] = "clear", 0, full


def _blocks_play(state) -> None:
    piece = state["piece"]
    if piece is None:
        _blocks_spawn(state)
        return
    rotations = _BLOCK_ROTATIONS[piece["shape"]]
    placed = piece["rotation"] == piece["goal_rotation"] and piece["x"] == piece["goal_x"]
    if not placed and state["tick"] >= piece["next_move"]:
        piece["next_move"] = state["tick"] + piece["every"]
        if piece["rotation"] != piece["goal_rotation"]:
            rotation = (piece["rotation"] + 1) % len(rotations)
            span = max(cell_x for cell_x, _y in rotations[rotation]) + 1
            x = min(piece["x"], state["width"] - span)
            if _blocks_fits(state, rotations[rotation], x, piece["y"]):
                piece["rotation"], piece["x"] = rotation, x
            else:  # blocked: it stays as it is
                piece["goal_rotation"] = piece["rotation"]
        else:
            step = 1 if piece["goal_x"] > piece["x"] else -1
            if _blocks_fits(state, rotations[piece["rotation"]], piece["x"] + step, piece["y"]):
                piece["x"] += step
            else:
                piece["goal_x"] = piece["x"]
    # The same pace all the way down, in place or not (the owner,
    # 2026-11-14: no sudden drop).
    if state["tick"] - state["last_fall"] >= state["fall"]:
        state["last_fall"] = state["tick"]
        cells = rotations[piece["rotation"]]
        if _blocks_fits(state, cells, piece["x"], piece["y"] - 1):
            piece["y"] -= 1
        else:
            _blocks_lock(state)


def _blocks_move(state) -> None:
    state["tick"] += 1
    phase = state["phase"]
    if phase == "play":
        _blocks_play(state)
    elif phase == "clear":
        state["timer"] += 1
        if state["timer"] >= _BLOCK_CLEAR_RENDERS:
            gone = set(state["clearing"])
            kept = [row for index, row in enumerate(state["grid"]) if index not in gone]
            state["grid"] = kept + [[-1] * state["width"] for _ in gone]
            state["phase"], state["clearing"] = "play", []
    else:  # over: the stack is wiped away (blocks_step), then a new game
        state["timer"] += 1
        if state["timer"] >= state["height"] * state["wipe"] + _BLOCK_OVER_HOLD:
            state["grid"] = [[-1] * state["width"] for _ in range(state["height"])]
            state["phase"], state["timer"] = "play", 0


def blocks_step(state, settings, clock_ms, render) -> bytes:
    _blocks_move(state)
    width, height = state["width"], state["height"]
    colours, strip, grid = state["colours"], state["strip"], state["grid"]
    phase = state["phase"]
    flash = phase == "clear" and (state["timer"] // 2) % 2 == 0
    clearing = state["clearing"]
    # Game over: the stack is wiped away row by row, from the far end (where
    # no piece could come in) down to the bottom, then the well stays empty a
    # moment before the next game.
    wiped = height - state["timer"] // state["wipe"] if phase == "over" else height
    for row in range(height):
        for column in range(width):
            cell = grid[row][column]
            if row >= wiped:
                colour = (0, 0, 0)
            elif flash and row in clearing:
                colour = state["white"]
            elif cell >= 0:
                colour = colours[cell]
            else:
                colour = (0, 0, 0)
            index = 3 * (row * width + column)
            strip[index:index + 3] = bytes(colour)
    piece = state["piece"]
    if piece is not None and phase == "play":
        colour = bytes(colours[piece["shape"] % len(colours)])
        for cell_x, cell_y in _BLOCK_ROTATIONS[piece["shape"]][piece["rotation"]]:
            row = piece["y"] + cell_y
            if row < height:
                index = 3 * (row * width + piece["x"] + cell_x)
                strip[index:index + 3] = colour
    return place_strip(bytes(strip), state["direction"])


SLOTS = (
    {"mode": KNIGHT_RIDER_MODE, "init": knight_init, "step": knight_step, "warmup": 0},
    # A simulation: each frame depends on every render before it. Live: a
    # preview or a stream that jumps (a new intensity, a late start) starts a
    # new run there instead of replaying this one's history
    # (lamp_renderers.Timeline).
    {"mode": LAVA_LAMP_MODE, "init": lava_init, "step": lava_step, "warmup": None, "live": True},
    # A game played out render by render: live too.
    {"mode": BLOCKS_MODE, "init": blocks_init, "step": blocks_step, "warmup": None, "live": True},
)
