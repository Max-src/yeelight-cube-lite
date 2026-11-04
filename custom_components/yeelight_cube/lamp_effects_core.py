"""Renderers of the lamp's core family: Rainbow, Tide and Magic.
Mirrors www/lamp-effects-core.js exactly.

Adding a renderer:

- Start from what the lamp keeps between renders, how it draws a frame, and
  the palette and the geometry it gets.
- Put it in the family's lamp_effects_<family>.py and its .js mirror: an
  init, a step and a slot, the slot in the module's SLOTS. A new family is
  added once, at the end of lamp_renderers.py and of its .js mirror.
- init(settings) returns everything the renderer keeps, plain data, starting
  as on a fresh Apply. What only depends on the settings goes there too.
- step(state, settings, clock_ms, render) returns the render's panel, 300
  bytes of LED drive in panel order (place_strip puts a logical strip there; JS
  may return a buffer it reuses). clock_ms is the lamp's clock (clock_at); the
  time since the Apply is render * RENDER_MS.
- warmup in the slot: 0 for a pure function of the clock or the render, the
  fewest renders that rebuild the same frame from a fresh state at any clock,
  or None when the state depends on all the history. Never round it up for
  comfort, never down to look fast: the late fixture proves it.
- Colours come from effect_colours(settings) (primary, secondary, words, the
  palette and its sampled table); geometry from effect_geometry; random numbers
  from source_word, counting draws from 0 in state, in the lamp's order; its
  low byte is random_source.
- What several renderers share belongs in lamp_core, not in a family.
- Keep every f32 step, wrap and truncation; keep per-pixel allocations out
  of the step. Budget, median per render: 4 ms in Python, 1.5 ms in JS.
- tests/test_lamp_effects.py picks every added slot up by itself: every
  config of the fixture must match on all 240 renders, in both languages.
"""

from __future__ import annotations

try:
    from .lamp_core import (
        COLS,
        ROWS,
        SIN8,
        U32,
        effect_colours,
        effect_geometry,
        fade_grid,
        hue_colour,
        hue_drive,
        inoise8_raw,
        new_grid,
        noise_heat,
        palette_span,
        place_strip,
    )
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lamp_core import (
        COLS,
        ROWS,
        SIN8,
        U32,
        effect_colours,
        effect_geometry,
        fade_grid,
        hue_colour,
        hue_drive,
        inoise8_raw,
        new_grid,
        noise_heat,
        palette_span,
        place_strip,
    )


# ── Slot 39: Rainbow ────────────────────────────────────────────────────
def rainbow_phase(clock: int, rate: int) -> int:
    """((clock * (m << 8)) * 280 >> 24) & 255, m = (30 rate + 960) / 160."""
    multiplier = (rate * 30 + 960) // 160
    return ((clock & U32) * (multiplier << 8) * 280 >> 24) & 255


def rainbow_init(settings) -> dict:
    width, height = effect_geometry(settings)
    colours = effect_colours(settings)
    return {
        "direction": settings["direction"],
        "width": width,
        "table": colours["table"],
        "span": palette_span(len(colours["palette"])),
        "rows": [(255 - 255 // height) * row // height for row in range(height)],
    }


def rainbow_step(state, settings, clock_ms, render) -> bytes:
    phase = rainbow_phase(clock_ms, settings["rate"])
    table, span, width = state["table"], state["span"], state["width"]
    cells = []
    for level in state["rows"]:  # the same for every column of a row
        at = 3 * ((span * ((level - phase) & 255)) >> 8)
        cells.append(table[at:at + 3] * width)
    return place_strip(b"".join(cells), state["direction"])


# ── Slots 35 and 48: Tide ───────────────────────────────────────────────
# Slot 35 draws the same way: its slot only needs these two functions. Fade
# by 8, then one dot per row. Nothing but the grid carries over, and the
# fade takes the brightest cell to 0 in 79 renders (visited once a render; 255
# -> 0 under c * 247 >> 8), so 78 renders behind any clock the grid forgets.
_TIDE_WARMUP = 78


def tide_init(settings) -> dict:
    width, height = effect_geometry(settings)
    table = effect_colours(settings)["table"]
    dots = []
    for dot in range(height):
        at = 3 * ((255 * dot // height) & 255)
        dots.append((128 * dot // (height - 1), table[at:at + 3]))
    return {
        "direction": settings["direction"],
        "width": width,
        "height": height,
        "speed": settings["rate"] * 191 // 255 + 32,
        "dots": dots,
        "work": new_grid(width, height),
    }


def tide_step(state, settings, clock_ms, render) -> bytes:
    width, height, work = state["width"], state["height"], state["work"]
    fade_grid(work, 8, width, height)
    product = (clock_ms * state["speed"]) & U32
    fast, slow = product >> 10, product // 2560
    for spread, colour in state["dots"]:
        x = (SIN8[(spread + fast) % 255] * width // 255) & 255
        y = (SIN8[(spread + slow) % 255] * height // 255) & 255
        at = 3 * (width * (y if y < height else 0) + (x if x < width else 0))
        work[at:at + 3] = colour
    return place_strip(work, state["direction"])


# ── Slot 76: Magic ──────────────────────────────────────────────────────
def magic_hues(render: int, rate: int, width: int, height: int) -> list:
    """The hues of mode 76 at ``render`` (0 = the first after the Apply), by
    logical cell: noise over the box, its hue moving with the frame count at
    a speed set by the rate. A pure function of the render."""
    phase, depth = (render // 50 + 1) & 0xFFFF, (render + 1) & 0xFFFF
    multiplier = (int((rate * 9 - 9) / 254) + 1) & 255
    moved = multiplier * depth
    z = (depth * 5) & 0xFFFF
    hues = [0] * (width * height)
    for column in range(width):
        x = (20 * column + phase) & 0xFFFF
        for row in range(height):
            hues[row * width + column] = (noise_heat(inoise8_raw(x, 20 * row, z)) + moved) % 360
    return hues


def magic_cells(render: int, rate: int) -> list:
    """The converter's input at ``render``, on the 20 x 5 box, by logical
    cell (row x 20 + column)."""
    return [hue_colour(hue) for hue in magic_hues(render, rate, COLS, ROWS)]


def magic_init(settings) -> dict:
    width, height = effect_geometry(settings)
    return {"direction": settings["direction"], "width": width, "height": height}


def magic_step(state, settings, clock_ms, render) -> bytes:
    hues = magic_hues(render, settings["rate"], state["width"], state["height"])
    strip = bytearray()
    for hue in hues:
        strip += bytes(hue_drive(hue))
    return place_strip(strip, state["direction"])


SLOTS = (
    {"mode": 39, "init": rainbow_init, "step": rainbow_step, "warmup": 0},
    {"mode": 48, "init": tide_init, "step": tide_step, "warmup": _TIDE_WARMUP},
    {"mode": 76, "init": magic_init, "step": magic_step, "warmup": 0},
)
