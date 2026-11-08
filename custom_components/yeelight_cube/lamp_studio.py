"""The palette color mode beyond what the lamp takes: an effect drawn here
in the lamp's whole palette and streamed to the lamp frame by frame
(light_studio), or an animation recolored into its GIF.

The Palette color mode ("palette") shows every effect in the whole palette.
How depends on what the lamp itself can take (lamp_renderers.palette_fits):

- the lamp takes it (a music mode's 16 colors; an effect drawing as many
  colors as the palette has, one with a one-color palette): the lamp's own
  command, as always;
- an effect that draws what the microphone hears (lamp_renderers
  LAMP_MUSIC_EFFECTS) stays the lamp's, whatever it takes: nothing here can
  hear the room;
- an animation: its frames recolored into the GIF the lamp stores and plays
  itself, in its layout (lamp_animations; uploaded over Matter, as every
  animation);
- any other effect the lamp renderers draw (studio_runs): each frame,
  rendered exactly as the lamp would run it with its own colors, is recolored
  and streamed over the LAN (UDP; no Matter needed). The same for a clock
  over such an effect (clock_studio_runs): the background recolored, shown
  through the digits as the lamp's clock does.

A recolored pixel keeps the effect's brightness (its brightest channel) and
takes a palette color by the effect's look (STUDIO_LOOKS), so the colors move
with the effect itself:

- "wheel": the effect's colors go round the whole hue wheel (Rainbow,
  Magic...): the wheel goes round the palette (lamp_core.sample_palette);
- "hue": its picture is in a range of hues (Wonderland, Particle path...):
  that range is spread over the palette, each color for as many of the
  effect's pixels (its hue quartiles);
- "level": a field of light (Waves, Aurora, Fire...): its brightness picks
  the color, the brightest the palette's first (its main color, as in
  Palette), dimmer ones the next, each color for as many of the effect's
  pixels (its brightness quartiles). The brightness around the pixel (5 x 3),
  followed slowly (level_step), picks it, so the colors follow the field's
  shapes while its fine noise only changes the brightness: a pixel does not
  flicker between colors;
- "object": separate dots or shapes (Starry Sky, Building Blocks, Hacking...):
  each keeps one palette color, the next for each that appears (from the
  second), for as long as it is lit (StudioTrack follows them from frame to
  frame); what is dimmer than the look's floor (Hacking's background) takes
  the first color;
- "first": the palette's first color (White fill-in and wipe-out, which the
  whole palette would make into Rainbow fill-in and wipe-out).

A streamed frame holds the colors sent (what update_leds gets, like a drawing):
the lamp converts them as it converts a drawing. Previews of a lamp-drawn
effect show it through the same converter (studio_drive), LED drive like every
effect preview; an animation's preview shows its recolored GIF frames.
Mirrored in www/lamp-studio.js (tests/test_lamp_studio.py).
"""

from __future__ import annotations

import threading

try:
    from .const import ALL_NATIVE_EFFECTS, PALETTE_COLOR_MODE
    from .lamp_core import COLS, LENGTH, RENDER_SECONDS, ROWS, convert_colour, palette_span, palette_table
    from .lamp_renderers import (
        FIREWORKS_MODE,
        LAMP_MUSIC_EFFECTS,
        LAMP_RENDERED_EFFECTS,
        effect_supports_color_mode,
        lamp_clock_settings,
        lamp_effect_frame,
        lamp_settings,
        palette_fits,
        renderer_frame,
    )
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from const import ALL_NATIVE_EFFECTS, PALETTE_COLOR_MODE
    from lamp_core import COLS, LENGTH, RENDER_SECONDS, ROWS, convert_colour, palette_span, palette_table
    from lamp_renderers import (
        FIREWORKS_MODE,
        LAMP_MUSIC_EFFECTS,
        LAMP_RENDERED_EFFECTS,
        effect_supports_color_mode,
        lamp_clock_settings,
        lamp_effect_frame,
        lamp_settings,
        palette_fits,
        renderer_frame,
    )

# Frames a second the lamp is sent (light_studio): one per render of the
# lamp's own renderers, which draw every 40 ms.
STUDIO_FPS = 25
# At most this many palette colors are used (the first ones).
STUDIO_PALETTE_LIMIT = 32
# tools/generate_studio_looks.py: the narrowest hue range mapped (narrower, a
# fading pixel's rounding would make its color jump).
MIN_HUE_SPAN = 64
# A pixel is grey (no hue to map) when its channels differ by less than a
# quarter of its brightest; a pixel dimmer than this has no reliable hue.
_GREY_RATIO = 4
_HUE_FLOOR = 16

# How each effect takes the palette (see above), as
# tools/generate_studio_looks.py measures it: ("wheel", start) on a 0-255
# hue wheel; ("hue", start, q0, q1, q2, q3, q4) the hue (past start) and
# ("level", q0, q1, q2, q3, q4) the followed brightness (level_step) at 5,
# 27.5, 50, 72.5 and 95 % of the effect's lit pixels; ("object", floor);
# ("first",).
STUDIO_LOOKS: dict[str, tuple] = {
    "Two-colour alternation": ('hue', 171, 2, 24, 62, 81, 90),
    "Breathing": ('level', 44, 78, 124, 164, 192),
    "Ribbon": ('wheel', 20),
    "Moving palette": ('wheel', 20),
    "Starry Sky": ('object', 16),
    "Particle path": ('hue', 37, 15, 48, 63, 120, 134),
    "Dual scan": ('wheel', 4),
    "Rotating colour bands": ('hue', 170, 0, 92, 100, 114, 158),
    "Triangular palette pulses": ('hue', 134, 47, 153, 161, 169, 201),
    "Fireworks": ('wheel', 46),
    "Sine wave": ('level', 87, 105, 119, 133, 148),
    "Palette trails": ('hue', 0, 0, 8, 26, 51, 66),
    "Aurora": ('level', 2, 6, 17, 25, 45),
    "Drop and bounce": ('hue', 0, 0, 9, 24, 51, 71),
    "Spectrum": ('wheel', 0),
    "Sunrise and sunset": ('level', 70, 154, 218, 247, 253),
    "Heat fire": ('level', 15, 15, 15, 21, 120),
    "Stacking blocks": ('object', 16),
    "Mirrored comets": ('wheel', 51),
    "Aqua-lime trails": ('hue', 65, 0, 8, 16, 24, 64),
    "Palette sparks": ('level', 45, 75, 89, 103, 127),
    "Scrolling bands": ('hue', 158, 12, 104, 120, 128, 170),
    "Palette cross-fade": ('hue', 0, 0, 69, 86, 132, 172),
    "Waterfall": ('level', 19, 41, 53, 67, 86),
    "Rising wisps": ('level', 5, 17, 28, 39, 58),
    "Fire": ('level', 8, 36, 59, 74, 94),
    "Tide (slot 35)": ('wheel', 56),
    "Bouncing Ball": ('hue', 128, 5, 34, 58, 118, 128),
    "Sine plotter": ('object', 16),
    "Rainbow": ('wheel', 0),
    "Waves": ('level', 100, 146, 184, 197, 214),
    "Hacking": ('object', 128),
    "Meteor": ('wheel', 225),
    "Tide": ('hue', 160, 0, 38, 96, 152, 191),
    "Building Blocks": ('object', 16),
    "Solid red": ('first',),
    "Rainbow noise": ('hue', 70, 7, 36, 66, 86, 117),
    "Flower Sea": ('level', 183, 194, 208, 221, 233),
    "Violet interference": ('level', 100, 133, 156, 162, 176),
    "Night-amber waves": ('hue', 171, 0, 8, 29, 108, 116),
    "Navy-white noise": ('level', 186, 199, 208, 215, 229),
    "Night-sky waves": ('hue', 162, 8, 16, 24, 119, 143),
    "Flicker sweep": ('wheel', 0),
    "Particle glows": ('level', 1, 33, 74, 119, 214),
    "Dot with fading trail": ('object', 16),
    "Centre bursts": ('object', 32),
    "Rainbow fill-in (one-shot)": ('wheel', 40),
    "Rainbow wipe-out (one-shot)": ('wheel', 0),
    "White fill-in (one-shot)": ('first',),
    "White wipe-out (one-shot)": ('first',),
    "Palette stripes": ('wheel', 0),
    "Snowfall": ('object', 16),
    "Daydream": ('wheel', 118),
    "Halloween glow": ('hue', 209, 12, 41, 54, 62, 70),
    "Moonlit clouds": ('level', 118, 146, 172, 197, 224),
    "Random scatter": ('hue', 176, 0, 83, 106, 114, 148),
    "Neon sine bands": ('hue', 63, 6, 108, 121, 179, 196),
    "Magic": ('wheel', 126),
    "Wonderland": ('hue', 171, 7, 19, 36, 51, 66),
    "Violet twinkles": ('level', 40, 52, 59, 65, 78),
    "Kaleidoscope": ('wheel', 0),
    "Palette": ('wheel', 128),
}


def effect_supports_studio(effect: str) -> bool:
    """Whether ``effect`` can be streamed in a palette: an effect the lamp
    renderers draw that does not listen to the microphone (an animation is
    recolored into its GIF instead, lamp_animations)."""
    return effect in LAMP_RENDERED_EFFECTS and effect not in LAMP_MUSIC_EFFECTS


def studio_recolors(effect: str) -> bool:
    """Whether ``effect`` is ever recolored here (it has a look): one that can
    be streamed, or an animation."""
    return effect_supports_studio(effect) or bool(ALL_NATIVE_EFFECTS.get(effect, {}).get("animation"))


def effect_offers_color_mode(effect: str, mode) -> bool:
    """Whether the cards and set_native_effect offer ``effect`` in ``mode``:
    what the lamp takes (lamp_renderers.effect_supports_color_mode), and in
    the palette color mode also what is streamed or recolored here."""
    if mode == PALETTE_COLOR_MODE and studio_recolors(effect):
        return True
    return effect_supports_color_mode(effect, mode)


def studio_palette(palette) -> list[tuple[int, int, int]]:
    """The colors a stream uses: the palette's [r, g, b] entries, at most
    STUDIO_PALETTE_LIMIT."""
    colours = [
        (int(colour[0]) & 255, int(colour[1]) & 255, int(colour[2]) & 255)
        for colour in palette or ()
        if isinstance(colour, (list, tuple)) and len(colour) >= 3
    ]
    return colours[:STUDIO_PALETTE_LIMIT]


def studio_runs(effect: str, color_mode, palette) -> bool:
    """Whether ``effect`` in ``color_mode`` is streamed: the palette color
    mode, with a palette the lamp cannot show the effect in itself
    (lamp_renderers.palette_fits), on an effect that can be streamed."""
    return (
        color_mode == PALETTE_COLOR_MODE
        and effect_supports_studio(effect)
        and bool(studio_palette(palette))
        and not palette_fits(effect, palette)
    )


def clock_studio_runs(effect, color_mode, palette) -> bool:
    """Whether a clock whose background is ``effect`` (None: a plain style,
    which the lamp shows in the palette's first color) is streamed in
    ``color_mode`` (studio_runs's rule for its background)."""
    return effect is not None and studio_runs(effect, color_mode, palette)


def hue_byte(pixel) -> int | None:
    """A pixel's hue on a 0-255 wheel (red 0, green 85, blue 171); None for
    a pixel too dim or too grey to have one."""
    red, green, blue = pixel[0], pixel[1], pixel[2]
    high = max(red, green, blue)
    spread = high - min(red, green, blue)
    if high < _HUE_FLOOR or spread * _GREY_RATIO < high:
        return None
    if high == red:
        hue = (43 * (green - blue)) // spread
    elif high == green:
        hue = 85 + (43 * (blue - red)) // spread
    else:
        hue = 171 + (43 * (red - green)) // spread
    return hue & 255


def studio_render(seconds: float) -> int:
    """The render (one every RENDER_SECONDS from the effect's start) shown
    ``seconds`` in."""
    return int(seconds / RENDER_SECONDS + 1e-6)


# ── What is recolored ───────────────────────────────────────────────────
class _Source:
    """An effect's own frames by render, and what identifies them (the
    tracks' key). A preview starts where it is first worth showing
    (Timeline.first_shown: never a blank tile); the lamp, ``from_start``,
    at the effect's first render, as the lamp starts its own (Building
    Blocks on an empty panel)."""

    __slots__ = ("key", "frame")

    def __init__(self, effect, direction, speed, orientation, intensity, from_start=False):
        settings = lamp_settings(effect, direction, speed, None, None, orientation, intensity)
        self.key = ("effect", effect, direction, speed, orientation, intensity, from_start)
        if from_start and settings["mode"] != FIREWORKS_MODE:
            self.frame = lambda render: renderer_frame(settings, render)
        else:
            self.frame = lambda render: lamp_effect_frame(settings, (render + 0.5) * RENDER_SECONDS)


# ── Objects: each keeps its color while it is lit ───────────────────────
# A lit pixel keeps the object it belonged to. A pixel that lights up joins
# the object that left a pixel next to it (gone dark or dimmer since the
# previous frame: it moved here), the brightest of them; a group of pixels
# lighting up with none moving in joins a pixel of the group that did, or is
# a new object, the next color (one lighting up beside a resting one, a new
# block on the stack, stays new). Neighbours: the 8 around, then 2 away along
# a row or column.
_NEIGHBOURS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1),
               (-2, 0), (2, 0), (0, -2), (0, 2))
_SIDES = ((-1, 0), (1, 0), (0, -1), (0, 1))


def _around(index: int, offsets):
    row, col = divmod(index, COLS)
    for d_row, d_col in offsets:
        r, c = row + d_row, col + d_col
        if 0 <= r < ROWS and 0 <= c < COLS:
            yield r * COLS + c


def track_step(state, frame, floor: int):
    """The objects of ``frame`` after ``state`` (labels, levels, count: the
    previous frame's object per pixel, -1 for none, its brightness, and how
    many objects appeared so far). A pixel belongs to an object while it is
    at least ``floor`` bright."""
    labels_before, levels_before, count = state
    levels = [max(pixel[0], pixel[1], pixel[2]) for pixel in frame]
    lit = [level >= floor for level in levels]
    labels = [-1] * LENGTH
    for index in range(LENGTH):
        if lit[index] and labels_before[index] >= 0:
            labels[index] = labels_before[index]
    moved = [False] * LENGTH
    for index in range(LENGTH):
        if not lit[index] or labels[index] >= 0:
            continue
        best, brightest = -1, -1
        for near in _around(index, _NEIGHBOURS):
            if (
                labels_before[near] >= 0
                and levels[near] < levels_before[near]
                and levels_before[near] > brightest
            ):
                best, brightest = near, levels_before[near]
        if best >= 0:
            labels[index] = labels_before[best]
            moved[index] = True
    for index in range(LENGTH):
        if not lit[index] or labels[index] >= 0:
            continue
        group, waiting = [], [index]
        labels[index] = -2
        while waiting:
            pixel = waiting.pop()
            group.append(pixel)
            for near in _around(pixel, _SIDES):
                if lit[near] and labels[near] == -1:
                    labels[near] = -2
                    waiting.append(near)
        group.sort()
        joined = next(
            (labels[near] for pixel in group for near in _around(pixel, _SIDES) if moved[near]),
            -1,
        )
        if joined < 0:
            joined, count = count, count + 1
        for pixel in group:
            labels[pixel] = joined
    return labels, levels, count


_EMPTY = ([-1] * LENGTH, [0] * LENGTH, 0)
_TRACK_STATES = 64


# ── Fields: the brightness around each pixel, followed slowly ───────────
# Around a pixel: 2 columns and 1 row each side. Each frame moves a pixel's
# followed brightness 1 / 2**_LEVEL_SMOOTHING of the way to its new one.
_LEVEL_AROUND = (2, 1)
_LEVEL_SMOOTHING = 3


def level_step(state, frame):
    """The followed brightness of ``frame`` after ``state`` (None: the first
    frame's own): per pixel, the mean brightness around it (_LEVEL_AROUND),
    moved part of the way from the previous (_LEVEL_SMOOTHING)."""
    levels = [max(pixel[0], pixel[1], pixel[2]) for pixel in frame]
    across, down = _LEVEL_AROUND
    around = []
    for index in range(LENGTH):
        row, col = divmod(index, COLS)
        total = count = 0
        for r in range(max(0, row - down), min(ROWS, row + down + 1)):
            for c in range(max(0, col - across), min(COLS, col + across + 1)):
                total += levels[r * COLS + c]
                count += 1
        around.append(total // count)
    if state is None:
        return around
    return [before + ((now - before) >> _LEVEL_SMOOTHING) for before, now in zip(state, around)]


def _stepper(look):
    """How a look follows its frames (step, first state), None when it
    does not: the objects, or the fields."""
    if look[0] == "object":
        floor = look[1]
        return (lambda state, frame: track_step(state, frame, floor)), _EMPTY
    if look[0] == "level":
        return level_step, None
    return None


def _followed(look, state):
    """What a look's state gives each pixel: an object, or a brightness."""
    return state[0] if look[0] == "object" else state


class StudioTrack:
    """A followed look of one source (objects, fields), render by render
    from its first: the latest states worked out are kept (the oldest dropped
    first), so each preview, the camera and the stream go on from where they
    were, each on its own clock."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.states: dict[int, tuple] = {}

    def state_at(self, render: int, frame_of, step, empty):
        with self.lock:
            if render in self.states:
                state = self.states.pop(render)
            else:
                start = max((known for known in self.states if known < render), default=-1)
                state = self.states[start] if start >= 0 else empty
                for at in range(start + 1, render):
                    state = step(state, frame_of(at))
                    self._keep(at, state)
                state = step(state, frame_of(render))
            self._keep(render, state)
            return state

    def _keep(self, render: int, state) -> None:
        self.states[render] = state
        if len(self.states) > _TRACK_STATES:
            del self.states[next(iter(self.states))]


_TRACKS: dict[tuple, StudioTrack] = {}
_TRACKS_LOCK = threading.Lock()
_TRACKS_LIMIT = 16


def _track(key) -> StudioTrack:
    with _TRACKS_LOCK:
        track = _TRACKS.pop(key, None) or StudioTrack()
        _TRACKS[key] = track
        while len(_TRACKS) > _TRACKS_LIMIT:
            del _TRACKS[next(iter(_TRACKS))]
        return track


# ── Colors ──────────────────────────────────────────────────────────────
class _Palette:
    """A palette ready to sample: its colors, its 256 samples
    (palette_table), the part of them the cycle uses, and the last color's
    position."""

    __slots__ = ("colours", "table", "cycle", "last")

    def __init__(self, colours):
        count = len(colours)
        self.colours = colours
        self.table = palette_table(colours, tail=())
        # 256 // count positions a color: past count of them, nothing.
        self.cycle = count * (256 // count)
        self.last = palette_span(count)

    def at(self, position: int) -> tuple:
        table = self.table
        return table[3 * position], table[3 * position + 1], table[3 * position + 2]


_PALETTES: dict[tuple, _Palette] = {}
_PALETTES_LIMIT = 32


def _prepared(colours) -> _Palette:
    key = tuple(colours)
    prepared = _PALETTES.get(key)
    if prepared is None:
        if len(_PALETTES) >= _PALETTES_LIMIT:
            _PALETTES.clear()
        prepared = _PALETTES[key] = _Palette(colours)
    return prepared


def _along(value: int, knots, last: int) -> int:
    """Where ``value`` falls between 0 and ``last``: each quarter of the way
    between two of the effect's quartiles ``knots``."""
    if value <= knots[0]:
        return 0
    if value >= knots[-1]:
        return last
    quarters = len(knots) - 1
    for segment in range(quarters):
        low, high = knots[segment], knots[segment + 1]
        if value < high:
            return (segment * last + (value - low) * last // (high - low)) // quarters
    return last


def _hue_offset(hue: int, start: int, knots) -> int:
    """A hue past the effect's ``start``; one outside its range (``knots``)
    as its nearer end."""
    offset = (hue - start) & 255
    if offset > knots[-1] and offset - knots[-1] >= 256 - offset + knots[0]:
        return knots[0]
    return offset


def recolour(frame, look, palette, followed=None) -> list[tuple[int, int, int]]:
    """``frame`` (100 pixels, lamp order, the effect's own) in the palette's
    colors by ``look`` (STUDIO_LOOKS); ``followed``: what its look followed
    (StudioTrack): each pixel's object for "object", its followed brightness
    for "level". An empty palette leaves it black."""
    colours = studio_palette(palette)
    if not colours:
        return [(0, 0, 0)] * len(frame)
    prepared = _prepared(colours)
    kind = look[0]
    out = []
    for index, pixel in enumerate(frame):
        level = max(pixel[0], pixel[1], pixel[2])
        if not level:
            out.append((0, 0, 0))
            continue
        if kind == "object":
            label = followed[index] if followed is not None else -1
            red, green, blue = colours[(label + 1) % len(colours)] if label >= 0 else colours[0]
        elif kind == "level":
            # The brightest the first color.
            key = followed[index] if followed is not None else level
            red, green, blue = prepared.at(prepared.last - _along(key, look[1:], prepared.last))
        elif kind == "wheel":
            hue = hue_byte(pixel)
            position = 0 if hue is None else ((hue - look[1]) & 255) * prepared.cycle >> 8
            red, green, blue = prepared.at(position)
        elif kind == "hue":
            hue = hue_byte(pixel)
            position = 0 if hue is None else _along(
                _hue_offset(hue, look[1], look[2:]), look[2:], prepared.last,
            )
            red, green, blue = prepared.at(position)
        else:  # "first"
            red, green, blue = colours[0]
        high = max(red, green, blue)
        if not high:
            out.append((0, 0, 0))
            continue
        out.append((red * level // high, green * level // high, blue * level // high))
    return out


def studio_look(effect: str) -> tuple:
    """The effect's look (STUDIO_LOOKS; the first color when unknown)."""
    return STUDIO_LOOKS.get(effect, ("first",))


def studio_frame_at(
    effect: str, render: int, direction: str, speed: int, orientation=None,
    intensity=None, palette=None, from_start: bool = False,
) -> list[tuple[int, int, int]]:
    """What the stream sends at ``render`` of ``effect``: its own frame (its own
    colors, the user's direction, speed, mount and intensity) in the
    palette's colors. Lamp order, the colors sent. ``from_start``: render 0
    is the effect's very first (the stream), else its first shown (_Source)."""
    source = _Source(effect, direction, speed, orientation, intensity, from_start)
    look = studio_look(effect)
    followed = None
    stepper = _stepper(look)
    if stepper is not None:
        state = _track((*source.key, *look)).state_at(render, source.frame, *stepper)
        followed = _followed(look, state)
    return recolour(source.frame(render), look, palette, followed)


def studio_frame(
    effect: str, seconds: float, direction: str, speed: int, orientation=None,
    intensity=None, palette=None,
) -> list[tuple[int, int, int]]:
    """studio_frame_at for the render shown ``seconds`` in."""
    return studio_frame_at(
        effect, studio_render(seconds), direction, speed, orientation, intensity, palette,
    )


def studio_animation_frames(frames, look, palette) -> tuple:
    """An animation's frames (a loop, top-first) in the palette's colors by
    ``look``. What its look follows goes through the loop twice and the
    second time round colors it, so it goes on where the loop starts again."""
    followed = [None] * len(frames)
    stepper = _stepper(look)
    if stepper is not None:
        step, state = stepper
        for _ in range(2):
            for index, frame in enumerate(frames):
                state = step(state, frame)
                followed[index] = _followed(look, state)
    return tuple(
        tuple(recolour(frame, look, palette, followed[index])) for index, frame in enumerate(frames)
    )


class _ClockSource:
    """A clock background's own frames by render: the effect as the lamp
    runs it behind its clock (lamp_clock_settings; ``direct``: the style's
    form), its colors as in the normal mode."""

    __slots__ = ("key", "frame")

    def __init__(self, effect, speed, intensity, direct, from_start=False):
        settings = lamp_clock_settings(effect, speed, None, None, intensity, None, direct)
        self.key = ("clock", effect, speed, intensity, direct, from_start)
        if from_start and settings["mode"] != FIREWORKS_MODE:
            self.frame = lambda render: renderer_frame(settings, render)
        else:
            self.frame = lambda render: lamp_effect_frame(settings, (render + 0.5) * RENDER_SECONDS)


def studio_clock_background_at(
    effect: str, render: int, speed: int, intensity=None, palette=None, direct=None,
    from_start: bool = False,
) -> list[tuple[int, int, int]]:
    """A clock's background ``effect`` at ``render``, in the palette's colors
    (its look, as studio_frame_at): lamp order, the colors sent. The clock
    shows it through its digits (camera / light_studio mask it)."""
    source = _ClockSource(effect, speed, intensity, direct, from_start)
    look = studio_look(effect)
    followed = None
    stepper = _stepper(look)
    if stepper is not None:
        state = _track((*source.key, *look)).state_at(render, source.frame, *stepper)
        followed = _followed(look, state)
    return recolour(source.frame(render), look, palette, followed)


def studio_drive(frame) -> list[tuple[int, int, int]]:
    """A streamed frame as the lamp shows it: each color through the lamp's
    converter (LED drive, like every effect preview and the power estimate)."""
    return [convert_colour(pixel) for pixel in frame]
