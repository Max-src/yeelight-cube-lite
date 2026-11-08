"""Native effects as the lamp draws them.

These renderers match what the lamp draws, frame for frame (the fixtures
check it). They compute what the lamp computes: every effect's preview, the
camera, the clock's backgrounds and the estimated power follow the lamp itself.
Mirrors www/lamp-renderers.js exactly.

Three layers: lamp_core.py holds what the renderers share, the
lamp_effects_<family>.py modules the renderers (lamp_effects_core.py
tells how to add one), and this module the registry, the timeline every preview
reads (renderer_frame), what a command installs (lamp_settings) and
Fireworks, with its own older timeline.

What a renderer here shares with the lamp, and what it cannot:

- The renderer draws a strip of N = 100 logical pixels. The lamp's pixel
  mapper places them on the panel by the mapped direction,
  DIRECTION_TABLE[profile][sent] (mount_profile.py). The integration sends
  directions compensated to profile 2 (light_native.lamp_direction), so a
  preview always maps as on profile 2.
- The panel's buffer is column-major (5 cells per column, bottom first); the
  integration's frames are row-major, row 0 = the bottom (lamp order).
- The lamp renders every 40 ms.
- The lamp's random numbers come from a hardware source whose values
  are not known (never seeded): a stand-in hash takes its place
  (source_word). Shots look like the lamp's, not the same shots at the same
  moment.

Two kinds of frame, not to be mixed up:

- LED drive, what these renderers return: the lamp's own values, linear
  power per LED channel, as written to the panel. Use them to compute anything
  about the lamp (the estimated power, camera.simulated_lamp_frame).
- Screen colors, led_appearance's result: the same frame as a screen must show
  it to look like those LEDs. Use them only to display a frame.

Every effect but one is drawn by the lamp's own renderer (LAMP_RENDERED_EFFECTS): what the
preview functions return for one is LED drive, and a display goes through
led_appearance once, a clock's animated background too. The music slots hear the
demo beat (lamp_core), not the room. Three things are not rendered: Music
Flow, a fixed illustration (native_effect_preview.render_music_flow_effect), slot
71, which plays the GIF stored in the lamp that nothing can read back, and the
solid clock styles (camera._clock_pixel_color). Their values are already screen
colors: never converted, and whatever power is estimated from them is rough.
"""

from __future__ import annotations

import math
import struct
import threading
import time

try:
    from .const import (
        ALL_NATIVE_EFFECTS,
        CLOCK_COLOR_MODES,
        CLOCK_DIRECT_BACKGROUNDS,
        CLOCK_SETUP_FLAGS,
        CLOCK_MIXER_COMMAND_IDS,
        DEFAULT_NATIVE_EFFECT_SPEED,
        MUSIC_PALETTE_SIZE,
        PALETTE_COLOR_MODE,
        PALETTE_MUSIC_FLOWS,
        UNDIRECTED_EFFECT_DIRECTION,
        NATIVE_CLOCK_EFFECT_ID,
        effect_direction_value,
        lamp_intensity,
        lamp_rate,
    )
    from . import lamp_effects_core
    from . import lamp_effects_waves
    from . import lamp_effects_noise
    from . import lamp_effects_sparks
    from . import lamp_effects_trails
    from . import lamp_effects_music
    from .lamp_core import (
        COLS,
        DIRECTION_TABLE,
        HANDOVER_FLAGS,
        LENGTH,
        REFERENCE_PROFILE,
        RENDER_SECONDS,
        ROWS,
        U32 as _U32,
        clock_at,
        f32 as _f32,
        f32_bits as _f32_bits,
        f32_from_bits as _f32_from_bits,
        frame_index,
        frame_pixels,
        hue_colour,
        inoise8_raw,
        led_appearance,
        panel_index,
        panel_to_frame,
        segment_geometry,
        source_word,
        strip_frame,
        trunc_u16 as _trunc_u16,
    )
    from .lamp_effects_core import magic_cells
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from const import (
        ALL_NATIVE_EFFECTS,
        CLOCK_COLOR_MODES,
        CLOCK_DIRECT_BACKGROUNDS,
        CLOCK_SETUP_FLAGS,
        CLOCK_MIXER_COMMAND_IDS,
        DEFAULT_NATIVE_EFFECT_SPEED,
        MUSIC_PALETTE_SIZE,
        PALETTE_COLOR_MODE,
        PALETTE_MUSIC_FLOWS,
        UNDIRECTED_EFFECT_DIRECTION,
        NATIVE_CLOCK_EFFECT_ID,
        effect_direction_value,
        lamp_intensity,
        lamp_rate,
    )
    import lamp_effects_core
    import lamp_effects_waves
    import lamp_effects_noise
    import lamp_effects_sparks
    import lamp_effects_trails
    import lamp_effects_music
    from lamp_core import (
        COLS,
        DIRECTION_TABLE,
        HANDOVER_FLAGS,
        LENGTH,
        REFERENCE_PROFILE,
        RENDER_SECONDS,
        ROWS,
        U32 as _U32,
        clock_at,
        f32 as _f32,
        f32_bits as _f32_bits,
        f32_from_bits as _f32_from_bits,
        frame_index,
        frame_pixels,
        hue_colour,
        inoise8_raw,
        led_appearance,
        panel_index,
        panel_to_frame,
        segment_geometry,
        source_word,
        strip_frame,
        trunc_u16 as _trunc_u16,
    )
    from lamp_effects_core import magic_cells

# ── Registry ────────────────────────────────────────────────────────────
# A slot: {"mode", "init", "step", "warmup"} (lamp_effects_core.py).
REGISTRY: dict[int, dict] = {}


def register_slot(slot: dict) -> None:
    held = REGISTRY.get(slot["mode"])
    if held is not None and held is not slot:
        raise ValueError(f"mode {slot['mode']} is registered twice")
    REGISTRY[slot["mode"]] = slot


def register_family(module) -> None:
    """Every slot of a lamp_effects_<family> module."""
    for slot in module.SLOTS:
        register_slot(slot)


# ── Timeline ────────────────────────────────────────────────────────────
# A preview asks for the frame at a moment, not for the next render, and many
# previews on their own clocks read one run. So a run of settings keeps the last
# frames computed and a few cursors (a renderer's state at a render) to go on from.
_RING = 256
_CURSORS = 6
# How far behind the target a cursor is advanced.
_CURSOR_REACH = 64
# A renderer with no warmup replays its history, up to this many renders.
_REPLAY_LIMIT = 2000
# Replaying stops at this time: the preview shows the last frame reached and
# catches up on the next call. It never stalls, whatever the host's speed.
_REPLAY_SECONDS = 0.100
_TIMELINE_LIMIT_EFFECTS = 8
# A preview's clock is its own, not the lamp's: nothing tells when the lamp was
# applied, and a frozen card never leaves its first moment. So a run black at its
# first render is shown from the first with this many pixels lit (Sunrise and
# sunset, Mirrored comets, Building Blocks and Particle glows), or the fullest of the first _DARK_LIMIT. A slot that
# never lights that many gives its own "lit": it would replay them all otherwise.
_LIT_PIXELS = 25
_DARK_LIMIT = 2000


class _Cursor:
    """A renderer's state after ``render``. Before ``settled`` it is still
    warming up: those frames are not the run's, and stay out of the ring."""

    __slots__ = ("render", "state", "frame", "used", "settled")

    def __init__(self, render: int, state, settled: int) -> None:
        self.render, self.state, self.settled = render, state, settled
        self.frame = None
        self.used = 0


class Timeline:
    """The frames of one settings tuple, by render, in lamp order."""

    def __init__(self, slot: dict, settings) -> None:
        self.slot = slot
        self.settings = {**settings, "primary": tuple(settings["primary"])}
        self.frames: dict[int, bytes] = {}
        self.cursors: list[_Cursor] = []
        self.uses = 0
        self.lock = threading.Lock()
        self._first_shown = None

    def first_shown(self) -> int:
        """The render a preview starts from (_LIT_PIXELS)."""
        if self._first_shown is None:
            self._first_shown = self._find_first_shown()
        return self._first_shown

    def _find_first_shown(self) -> int:
        if any(self.frame_at(0, True)):
            return 0
        enough = self.slot.get("lit", _LIT_PIXELS)
        best, most = 0, 0
        for render in range(1, _DARK_LIMIT):
            frame = self.frame_at(render, True)
            lit = sum(
                1 for red, green, blue in zip(frame[0::3], frame[1::3], frame[2::3])
                if red or green or blue
            )
            if lit >= enough:
                return render
            if lit > most:
                best, most = render, lit
        return best

    def frame_at(self, render: int, exact: bool = False) -> bytes:
        """The 300 bytes of ``render``. Replaying stops at _REPLAY_SECONDS,
        with an earlier frame, unless ``exact``."""
        render = max(0, int(render))
        with self.lock:
            frame = self.frames.get(render)
            if frame is not None:
                return frame
            return self._advance(self._cursor_for(render), render, exact)

    def _cursor_for(self, target: int) -> _Cursor:
        warmup = self.slot["warmup"]
        # A fresh cursor starts a warmup behind: one that can't reach as far
        # would be given up before it arrives, again and again.
        reach = _REPLAY_LIMIT if warmup is None else max(_CURSOR_REACH, warmup + 1)
        best = None
        for cursor in self.cursors:
            if (
                target >= cursor.settled
                and 0 <= target - cursor.render <= reach
                and (best is None or cursor.render > best.render)
            ):
                best = cursor
        if best is not None:
            return best
        if warmup is None:
            start = max(0, target - _REPLAY_LIMIT) if target > _REPLAY_LIMIT else 0
        else:
            start = max(0, target - warmup)
        if len(self.cursors) >= _CURSORS:
            self.cursors.remove(min(self.cursors, key=lambda cursor: cursor.used))
        cursor = _Cursor(start - 1, self.slot["init"](self.settings), target if start else 0)
        self.cursors.append(cursor)
        return cursor

    def _advance(self, cursor: _Cursor, target: int, exact: bool) -> bytes:
        step, settings = self.slot["step"], self.settings
        rate = settings["rate"]
        stop = None if exact else time.perf_counter() + _REPLAY_SECONDS
        if self.slot["warmup"] == 0:  # a pure function of the render: no way there
            cursor.render = target - 1
        while cursor.render < target:
            render = cursor.render + 1
            frame = panel_to_frame(step(cursor.state, settings, clock_at(rate, render), render))
            cursor.render, cursor.frame = render, frame
            if render >= cursor.settled:
                self.frames[render] = frame
                if len(self.frames) > _RING:
                    del self.frames[next(iter(self.frames))]
            if stop is not None and time.perf_counter() > stop:
                break
        self.uses += 1
        cursor.used = self.uses
        return cursor.frame


_EFFECT_TIMELINES: dict[tuple, Timeline] = {}
_EFFECT_TIMELINES_LOCK = threading.Lock()


def has_renderer(mode: int) -> bool:
    return mode in REGISTRY


def timeline_for(settings) -> Timeline:
    """The run of ``settings``, the most recently used last."""
    key = (
        settings["mode"], settings["selector"], settings["intensity"], settings["rate"],
        settings["direction"], tuple(settings["primary"]), bool(settings["coloured"]),
        tuple(map(tuple, settings.get("colours", ()))), bool(settings.get("handover")),
    )
    with _EFFECT_TIMELINES_LOCK:
        timeline = _EFFECT_TIMELINES.pop(key, None)
        if timeline is None:
            timeline = Timeline(REGISTRY[settings["mode"]], settings)
        _EFFECT_TIMELINES[key] = timeline
        if len(_EFFECT_TIMELINES) > _TIMELINE_LIMIT_EFFECTS:
            del _EFFECT_TIMELINES[next(iter(_EFFECT_TIMELINES))]
    return timeline


def lamp_frame_bytes(settings, render: int) -> bytes:
    """Render ``render`` of a command, LED drive in lamp order, flat."""
    return timeline_for(settings).frame_at(render)


def renderer_frame(settings, render: int) -> list:
    """Render ``render`` of a command: 100 (r, g, b) of LED drive, lamp order."""
    return frame_pixels(lamp_frame_bytes(settings, render))


def exact_frames(settings, first: int, count: int):
    """``count`` lamp frames from render ``first``, the run as the lamp's: a
    replay from the slot's warmup (from render 0 when it has none), with no
    timeline, no ring and no time limit."""
    slot = REGISTRY[settings["mode"]]
    step = slot["step"]
    settings = {**settings, "primary": tuple(settings["primary"])}
    start = 0 if slot["warmup"] is None else max(0, first - slot["warmup"])
    state = slot["init"](settings)
    rate = settings["rate"]
    for render in range(start, first + count):
        panel = step(state, settings, clock_at(rate, render), render)
        if render >= first:
            yield panel_to_frame(panel)


# ── Slot 10: Fireworks ──────────────────────────────────────────────────
# WLED's exploding fireworks with the lamp's constants: a flare climbs the
# strip and bursts into sparks of mode 3's colour wheel that fade in, burn and
# cool. A few steps are IEEE doubles with these constants; the rest is
# single precision.
_C_M800000 = -800000.0
_C_M0_0004 = -0.0004
_C_M2 = -2.0
_C_10000 = 10000.0
_C_M0_9 = -0.9
_C_0_99 = 0.99
_RECORD = 20
_FLOAT = struct.Struct("<f")
_HALF = struct.Struct("<H")
# Renders from the burst to the pause: the burst's render, the 85 renders
# that take spark 1's heat 341 -> 1 by 4, then the one that sees it cold.
_FIREWORKS_BURN = 87


def fireworks_sparks(length: int) -> int:
    """Spark records, the flare's included: min(N / 2 + 2, 80)."""
    return min(((length & 0xFFFF) >> 1) + 2, 80)


def fireworks_wheel(index: int) -> int:
    """Mode 3's colour wheel on a spark's colour index: word 0x00RRGGBB."""
    index &= 255
    if index >= 171:
        step = (index ^ 0xFF) * 3
        return (((0xFF - step) << 16) | (step & 0xFFFF)) & _U32
    if index >= 86:
        step = (-86 - index) & 0xFF
        return ((step * 0x300) | ((step * -3 + 255) & _U32)) & _U32
    step = (0x55 - index) & 0xFF
    return ((step * 0x30000) | ((step * -768 + 0xFF00) & _U32)) & _U32


def fireworks_heat(word: int, heat: int) -> tuple[int, int, int]:
    """A spark's colour word at its heat (after this render's -4): it fades
    in from heat 345 to 300, then dims and cools (green, then blue drop)."""
    word &= _U32
    heat &= 0xFFFF
    red, green, blue = (word >> 16) & 255, (word >> 8) & 255, word & 255
    if heat >= 301:
        scaled = (heat * 5) & 0xFFFF
        if scaled == 1500:
            out = word
        elif scaled == 1755:
            out = 3
        else:
            t = (scaled - 1500) & 0xFFFF
            k = 0xFF - t
            r6 = (green * k) & 0xFFFFFF00
            r1 = (((t * 3 + blue * k) & _U32) >> 8) | r6
            r2 = ((red * k) << 8) & 0xFFFF0000
            out = (r2 | r1) & _U32
        return (out >> 16) & 255, (out >> 8) & 255, out & 255
    if heat < 46:
        return 0, 0, 0
    if heat == 300:
        out = word
    else:
        p = (heat - 45) & 0xFFFF
        r3 = (green * p) & 0xFFFF00
        r3 |= (blue * p) >> 8
        r1 = ((p * red) << 8) & 0xFFFF0000
        out = (r3 | r1) & _U32
    cool = ((300 - heat) >> 5) & 0xFF
    cool2 = ((300 - heat) >> 4) & 0xFE
    g = ((out >> 8) & 255) - cool
    b = (out & 255) - cool2
    return (out >> 16) & 255, g & 255 if g > 0 else 0, b & 255 if b > 0 else 0


def _fireworks_gravity(length: int, rate: int) -> float:
    step = (rate & 255) * 900 // 255 + 100
    return _f32(_f32(length) * _f32(step / _C_M800000 + _C_M0_0004))


class FireworksState:
    """The renderer's state: the spark records (zeroed at every Apply),
    the phase (0 new flare, 1 rising, 2 burst, 3 burning, > 3 pause), the
    shot count, the unused side flag and the shared dying gravity (its float
    bits)."""

    __slots__ = ("records", "state", "launches", "side", "dying")

    def __init__(self, length: int = LENGTH) -> None:
        self.records = bytearray(fireworks_sparks(length) * _RECORD)
        self.state = 0
        self.launches = 0
        self.side = 0
        self.dying = 0x7FC00001


def fireworks_step(fw: FireworksState, length: int, rate: int, intensity: int,
                   selector: int, word: int, read) -> list:
    """One render (every pixel cleared to black first). ``read(site)`` gives
    the next source word for that site ("peak", "vel", "colour",
    "wait", "side"). Returns the pixel writes after the clear: (logical
    index, r, g, b), in order. Selector 0 draws every spark in colour word
    ``word``; any other selector uses the wheel."""
    n = length & 0xFFFF
    draws = []
    rec = fw.records

    def pos(k):
        return _FLOAT.unpack_from(rec, _RECORD * k)[0]

    def vel(k):
        return _FLOAT.unpack_from(rec, _RECORD * k + 4)[0]

    def heat(k):
        return _HALF.unpack_from(rec, _RECORD * k + 8)[0]

    def set_pos(k, value):
        _FLOAT.pack_into(rec, _RECORD * k, value)

    def set_vel(k, value):
        _FLOAT.pack_into(rec, _RECORD * k + 4, value)

    def set_heat(k, value):
        _HALF.pack_into(rec, _RECORD * k + 8, value & 0xFFFF)

    sparks = fireworks_sparks(n)
    grav = _fireworks_gravity(n, rate)
    nf = _f32(n)
    state = fw.state & 0xFFFF
    if state < 2:
        if state == 0:
            set_pos(0, 0.0)
            peak_byte = read("peak") & 0xFF
            product = ((n - 1) * (((peak_byte * 0x87) >> 8) + 100)) & _U32
            peak = (product >> 8) & 0xFFFF
            square = (grav * _C_M2) * peak
            set_vel(0, _f32(math.sqrt(square) if square >= 0 else math.nan))
            set_heat(0, 255)
            state = 1
        speed = vel(0)
        if not speed > _f32(grav * 12):  # explodes next render
            fw.state = 2
            fw.launches = (fw.launches + 1) & 0xFFFF
            return draws
        level = heat(0) & 255
        draws.append((_trunc_u16(pos(0)), level, level, level))
        moved = _f32(speed + pos(0))
        if moved < 0:
            set_pos(0, 0.0)
        else:
            top = _f32(n - 1)
            set_pos(0, moved if moved <= top or math.isnan(moved) else top)
        set_vel(0, _f32(grav + speed))
        set_heat(0, heat(0) - 5)
        fw.state = state
        return draws
    if state > 3:  # the pause between shots
        state = (state - 1) & 0xFFFF
        if state < 4:
            state = 0
            fw.side = 1 if (read("side") & 0xFF) < (intensity & 255) else 0
        fw.state = state
        return draws
    flare = pos(0)
    whole = math.trunc(flare) if math.isfinite(flare) else 0
    live = min(whole, sparks) if whole >= 0 else 0
    dying = _f32_from_bits(fw.dying)
    if state == 2:
        if live >= 2:
            kick = _f32(grav * -50)
            for i in range(1, live):
                set_pos(i, pos(0))
                v0 = ((read("vel") & 0xFFFF) * 20000) >> 16
                spark_speed = _f32(_f32(v0) / _C_10000 + _C_M0_9)
                set_vel(i, spark_speed)
                set_heat(i, 345)
                rec[_RECORD * i + 16] = read("colour") & 0xFF
                ratio = _f32(pos(0) / nf)
                set_vel(i, _f32(kick * _f32(spark_speed * ratio)))
        dying = _f32(grav * 0.5)
        state = 3
    fw.state = state
    if heat(1) < 5:  # burnt out: pause
        fw.state = (((read("wait") & 0xFF) * 10) >> 8) + 6
        fw.dying = _f32_bits(dying)
        return draws
    if live >= 2:
        for i in range(1, live):
            moved = _f32(vel(i) + pos(i))
            set_pos(i, moved)
            set_vel(i, _f32(vel(i) + dying))
            spark_heat = heat(i)
            if spark_heat >= 4:
                spark_heat -= 4
                set_heat(i, spark_heat)
            if moved <= 0 or math.isnan(moved) or moved >= nf:
                continue
            colour = word if (selector & 255) == 0 else fireworks_wheel(rec[_RECORD * i + 16])
            draws.append((_trunc_u16(moved), *fireworks_heat(colour, spark_heat)))
    fw.dying = _f32_bits(_f32(dying * _C_0_99))
    return draws


# ── Fireworks over time ─────────────────────────────────────────────────
# A preview asks for the frame at a moment, not for the next render. Each
# shot starts afresh (a new flare, the burst resets the dying gravity, and
# nothing a later render reads is left from the previous shot on the full
# panel), so shot k draws its own source words (source_word(k * 4096 + j):
# shot 0 reads the first stand-in sequence) and its length is known without
# drawing it (_fireworks_shot_length); the shot is then rendered from its
# start, or from the last render asked for.
_SHOT_READS = 4096
# Wheel colours: every command the integration sends for Fireworks (id 71,
# the colour-mode ids 15 / 64-67, a sent colour) installs a non-zero colour
# selector, so the sparks take the wheel.
FIREWORKS_MODE = 10
FIREWORKS_SELECTOR = 14
FIREWORKS_INTENSITY = 128


def _shot_source(shot: int):
    reads = iter(range(shot * _SHOT_READS, (shot + 1) * _SHOT_READS))
    return lambda _site: source_word(next(reads))


def _fireworks_shot_length(shot: int, rate: int) -> int:
    """Renders from shot ``shot``'s new flare to the next one: its rise
    (the renders the flare climbs, and the one that sees it stop), the
    burst and burn (_FIREWORKS_BURN), and the pause it reads."""
    n = LENGTH
    grav = _fireworks_gravity(n, rate)
    peak_byte = source_word(shot * _SHOT_READS) & 0xFF
    peak = ((((n - 1) * (((peak_byte * 0x87) >> 8) + 100)) & _U32) >> 8) & 0xFFFF
    speed = _f32(math.sqrt((grav * _C_M2) * peak))
    flare = 0.0
    top = _f32(n - 1)
    climb = _f32(grav * 12)
    rise = 1
    while speed > climb:
        moved = _f32(speed + flare)
        flare = 0.0 if moved < 0 else (moved if moved <= top else top)
        speed = _f32(grav + speed)
        rise += 1
    live = min(math.trunc(flare), fireworks_sparks(n))
    wait_read = 1 + 2 * (live - 1)
    pause = (((source_word(shot * _SHOT_READS + wait_read) & 0xFF) * 10) >> 8) + 6
    return rise + _FIREWORKS_BURN + pause - 3


class _FireworksShot:
    """A shot's renders so far, and what it takes to go on."""

    def __init__(self, shot: int) -> None:
        self.state = FireworksState()
        self.read = _shot_source(shot)
        self.draws = []


class _FireworksTimeline:
    """Shot starts (render index) for one rate, extended as needed, and the
    last shots' renders. Previews of one rate each have their own clock (a
    camera, a card), so each shot is computed once and read at any render."""

    def __init__(self, rate: int) -> None:
        self.rate = rate
        self.starts = [0]
        self.shots: dict[int, _FireworksShot] = {}

    def shot_at(self, render: int) -> tuple[int, int]:
        while self.starts[-1] <= render:
            shot = len(self.starts) - 1
            self.starts.append(self.starts[-1] + _fireworks_shot_length(shot, self.rate))
        low, high = 0, len(self.starts) - 1
        while high - low > 1:
            middle = (low + high) // 2
            if self.starts[middle] <= render:
                low = middle
            else:
                high = middle
        return low, render - self.starts[low]

    def draws_at(self, render: int) -> list:
        shot, offset = self.shot_at(render)
        # The most recently used last: the oldest goes first.
        record = self.shots.pop(shot, None) or _FireworksShot(shot)
        self.shots[shot] = record
        if len(self.shots) > _SHOT_LIMIT:
            self.shots.pop(next(iter(self.shots)))
        while len(record.draws) <= offset:
            record.draws.append(fireworks_step(
                record.state, LENGTH, self.rate, FIREWORKS_INTENSITY,
                FIREWORKS_SELECTOR, 0, record.read,
            ))
        return record.draws[offset]


_SHOT_LIMIT = 6
_TIMELINES: dict[int, _FireworksTimeline] = {}
_TIMELINE_LIMIT = 8


# The camera computes in an executor, the power estimate too.
_FIREWORKS_LOCK = threading.Lock()


def render_fireworks(seconds: float, rate: int, direction: int,
                     profile: int = REFERENCE_PROFILE) -> list:
    """The 20 x 5 frame (lamp order) Fireworks shows ``seconds`` after it
    was applied, at ``rate`` (0-255) and the lamp's ``direction`` (0-3)."""
    rate = max(0, min(255, int(rate)))
    render = max(0, int(seconds / RENDER_SECONDS))
    with _FIREWORKS_LOCK:
        timeline = _TIMELINES.get(rate)
        if timeline is None:
            if len(_TIMELINES) >= _TIMELINE_LIMIT:
                _TIMELINES.pop(next(iter(_TIMELINES)))
            timeline = _TIMELINES[rate] = _FireworksTimeline(rate)
        draws = timeline.draws_at(render)
    return strip_frame(draws, direction, profile)


# ── What a command installs ─────────────────────────────────────────────
# The lamp's stored presets, by command id, as far as the commands sent use
# them: (colour selector, intensity, rate, direction). A command starts from
# the row, then only the sent keys change.
PRESET_ROWS = {
    3: (0, 128, 128, 0),
    5: (0, 128, 128, 0),
    15: (8, 128, 128, 0),
    17: (0, 128, 128, 0),
    32: (0, 128, 128, 0),
    34: (0, 128, 128, 3),
    37: (0, 128, 128, 0),
    39: (0, 128, 128, 0),
    40: (0, 128, 128, 0),
    42: (0, 128, 128, 0),
    46: (0, 128, 128, 0),
    47: (0, 128, 128, 0),
    48: (0, 128, 128, 0),
    49: (0, 128, 128, 0),
    63: (0, 128, 128, 0),
    64: (12, 128, 128, 0),
    65: (13, 128, 128, 0),
    66: (14, 128, 128, 0),
    67: (32, 128, 128, 0),
    71: (14, 0, 128, 0),
    91: (0, 128, 128, 0),
    92: (0, 128, 128, 0),
    94: (0, 128, 128, 0),
    95: (0, 128, 128, 0),
    96: (0, 128, 128, 0),
}
# A sent color selects the ramp of the primary color; without one the words
# are white.
_COLOUR_SELECTOR = 8
_WHITE = (255, 255, 255)
# The raw direction that maps to 0: the lamp ignores the direction of a
# mode 40 command, so a clock's background keeps mapped direction 0 whatever is
# sent.
CLOCK_BACKGROUND_DIRECTION = DIRECTION_TABLE[REFERENCE_PROFILE].index(0)

# What the lamp does with a color: not what a preview shows, so these stay
# whatever draws the frames.
# Effects a single custom color recolors; the others ignore it on the lamp.
_COLOR_OVERRIDE_EFFECTS = frozenset({
    "Rainbow", "Waves", "Spectrum", "Ribbon", "Moving palette", "Starry Sky",
    "Triangular palette pulses", "Sine wave", "Aurora", "Sunrise and sunset",
    "Heat fire", "Mirrored comets", "Palette sparks", "Waterfall", "Fire",
    "Tide (slot 35)", "Bouncing Ball", "Tide", "Particle glows", "Palette stripes",
    "Kaleidoscope", "Meteor", "Building Blocks",
    # They draw their colour words: the picked one replaces the first
    # (const._EXTENDED_EFFECT_COLORS).
    "Two-colour alternation", "Rotating colour bands", "Scrolling bands",
    "Rising wisps", "Random scatter",
    # The slots named by number until 1.4.0: what their renderers draw
    # (frames with a color against the effect's own), not yet seen on a lamp.
    "Breathing", "Dual scan", "Palette trails", "Drop and bounce",
    "Music level glow", "Stacking blocks", "Music bars from both ends",
    "Music bars from the centre", "Music bar from one end", "Palette cross-fade",
    "Music Spectrum", "Music Gather", "Music Breathing", "Music Blossom",
    "Music noise equalizer", "Dot with fading trail", "Centre bursts",
    "Music Note", "Music Impact",
})
# Effects the lamp's B&W palette (command id 15) turns grey. Verified on
# hardware; Starry Sky, Waterfall and Aurora only once their default color is
# not sent (light_native).
_COLOR_MODE_BW_EFFECTS = frozenset({
    "Rainbow", "Waves", "Spectrum", "Ribbon", "Moving palette", "Starry Sky",
    "Triangular palette pulses", "Sine wave", "Aurora", "Sunrise and sunset",
    "Heat fire", "Mirrored comets", "Waterfall", "Fire", "Tide (slot 35)",
    "Bouncing Ball", "Tide", "Particle glows", "Palette stripes", "Kaleidoscope",
    # The slots named by number until 1.4.0, per their renderers; the five
    # that draw their colour words go white, as without them.
    "Two-colour alternation", "Rotating colour bands", "Scrolling bands",
    "Rising wisps", "Random scatter", "Dual scan", "Palette trails",
    "Drop and bounce", "Music level glow", "Stacking blocks",
    "Music bars from both ends", "Music bars from the centre",
    "Music bar from one end", "Palette cross-fade", "Music Spectrum",
    "Music Gather", "Music Breathing", "Music Blossom", "Music noise equalizer",
    "Music Note", "Music Impact",
})
# Particle path is intentionally absent: on the lamp it ignores these
# palette modes.
_COLOR_PALETTE_EFFECTS = frozenset({
    "Rainbow", "Spectrum", "Ribbon", "Moving palette", "Triangular palette pulses",
    "Mirrored comets", "Tide (slot 35)", "Tide", "Palette stripes", "Kaleidoscope",
    # The slots named by number until 1.4.0, per their renderers.
    "Dual scan", "Palette trails", "Drop and bounce", "Music level glow",
    "Stacking blocks", "Music bars from both ends", "Music bars from the centre",
    "Palette cross-fade", "Music noise equalizer", "Music Note", "Music Impact",
})
_COLOR_PALETTE_MODES = frozenset({"red_blue", "white_orange", "blue_yellow", "purple_orange"})


def effect_supports_color_override(effect: str) -> bool:
    return effect in _COLOR_OVERRIDE_EFFECTS


def effect_supports_color_mode(effect: str, mode: str) -> bool:
    return (
        (effect in _COLOR_PALETTE_EFFECTS and mode in _COLOR_PALETTE_MODES)
        or (mode == "bw" and effect in _COLOR_MODE_BW_EFFECTS)
        # The palette's colors reach every effect that takes a color (on
        # the lamp itself; lamp_studio streams the others in the palette).
        or (mode == PALETTE_COLOR_MODE and effect in _COLOR_OVERRIDE_EFFECTS)
    )


# ── The palette color mode ───────────────────────────────────────────────
# An effect takes as many colors as it draws: one (the first, which the lamp
# spreads into its own ramp), or each colour word of the effects that draw
# several (const._EXTENDED_EFFECT_COLORS), the palette repeated when it is
# shorter, since a word left out is black. The music effects of
# PALETTE_MUSIC_FLOWS take the whole palette (music_palette).
def palette_words(effect: str, palette) -> list[int]:
    """The colour words (0xRRGGBB) an effect is sent for ``palette``, a
    list of [r, g, b]; empty when the palette is."""
    colours = [tuple(colour) for colour in palette or ()]
    if not colours:
        return []
    count = len(ALL_NATIVE_EFFECTS[effect].get("colors", ())) or 1
    return [_colour_word(colours[index % len(colours)]) for index in range(count)]


def clock_palette_words(effect, palette) -> list[int]:
    """The colour words (0xRRGGBB) a clock is sent in the palette color
    mode: a plain-colour style (``effect`` None) its first colour, a style
    whose background ``effect`` takes the palette as many as that effect
    (palette_words), another none (it then runs as in the normal mode)."""
    if effect is None:
        colours = [tuple(colour) for colour in palette or ()]
        return [_colour_word(colours[0])] if colours else []
    if not effect_supports_color_mode(effect, PALETTE_COLOR_MODE):
        return []
    return palette_words(effect, palette)


def music_palette(palette) -> list[tuple]:
    """A palette spread over a music mode's 16 entries, in its order: each
    color as many times as fits (the lamp fills a short palette with black)."""
    colours = [tuple(colour) for colour in palette or ()]
    if not colours:
        return []
    return [
        colours[index * len(colours) // MUSIC_PALETTE_SIZE]
        for index in range(MUSIC_PALETTE_SIZE)
    ]


def palette_fits(effect: str, palette) -> bool:
    """Whether the lamp itself shows ``effect`` in the whole ``palette``: a
    music mode of PALETTE_MUSIC_FLOWS (16 colors), or an effect that takes a
    color with at most as many palette colors as it draws (palette_words: one,
    or its colour words). Otherwise the palette color mode streams it
    (lamp_studio), when it can."""
    colours = [colour for colour in palette or () if isinstance(colour, (list, tuple))]
    if not colours:
        return True
    if effect in PALETTE_MUSIC_FLOWS:
        return True
    if not effect_supports_color_mode(effect, PALETTE_COLOR_MODE):
        return False
    return len(colours) <= (len(ALL_NATIVE_EFFECTS[effect].get("colors", ())) or 1)


def palette_music_flow(effect: str, color_mode, palette) -> str | None:
    """The microphone music mode an effect runs as in the palette color
    mode (PALETTE_MUSIC_FLOWS), None for any other effect, mode, or no palette."""
    if color_mode != PALETTE_COLOR_MODE or not palette:
        return None
    return PALETTE_MUSIC_FLOWS.get(effect)


def _colour_word(color) -> int:
    red, green, blue = (int(channel) & 255 for channel in color)
    return red << 16 | green << 8 | blue


def _command_settings(
    mode: int, command_id: int, direction: int, rate: int, word, more=(), intensity=None,
) -> dict:
    """The fields a renderer reads, from what a command sends: ``word``, the
    first colour word sent (None: no color key), ``more`` the others,
    ``intensity`` the one sent (None: the preset row's)."""
    selector, row_intensity, *_ = PRESET_ROWS[command_id]
    intensity = row_intensity if intensity is None else intensity
    coloured = word is not None
    settings = {
        "mode": mode,
        "selector": _COLOUR_SELECTOR if coloured else selector,
        "intensity": intensity,
        "rate": rate,
        "direction": direction,
        "primary": _rgb(word) if coloured else list(_WHITE),
        "coloured": coloured,
    }
    if coloured and more:
        settings["colours"] = [_rgb(word), *(_rgb(other) for other in more)]
    return settings


def _rgb(word: int) -> list:
    return [word >> 16 & 255, word >> 8 & 255, word & 255]


def _sent_intensity(spec: dict, intensity) -> int | None:
    """The intensity a command sends for the effect ``spec`` (lamp_intensity):
    None when the effect reads none or none is chosen, so the row's applies."""
    if intensity is None or not spec.get("intensity"):
        return None
    return lamp_intensity(spec["mode"], intensity)


def lamp_settings(
    effect: str, direction: str, speed: int, color_override=None, color_mode=None,
    orientation=None, intensity=None, palette=None,
) -> dict:
    """What the lamp runs for a native effect (light_native._native_effect_params):
    the settings its renderer takes, from the same choices. ``color_override`` is
    [r, g, b]. What the send path ignores is ignored here. A direction label goes
    through the effect's remap and is turned for the mount; an effect offered none
    has its fixed one. ``intensity``: the one chosen (None: the row's).
    ``palette``: the lamp's palette ([r, g, b] each), for the palette color
    mode; without one that mode sends what the normal one does. (An effect
    the palette color mode streams is drawn by lamp_studio from the normal
    mode's settings.)"""
    spec = ALL_NATIVE_EFFECTS[effect]
    preset = (
        CLOCK_COLOR_MODES.get(color_mode)
        if effect_supports_color_mode(effect, color_mode)
        else None
    )
    command_id = spec["effect_id"] if preset is None else preset
    directions = spec.get("directions")
    if directions:
        label = direction if direction in directions else directions[0]
        value = effect_direction_value(spec, label, orientation)
    else:
        value = UNDIRECTED_EFFECT_DIRECTION
    rate = (
        lamp_rate(spec["mode"], speed) if spec.get("speed")
        else PRESET_ROWS[command_id][2]
    )
    words = [] if preset is not None else [
        int(color) & 0xFFFFFF
        for color in ((spec["color"],) if spec.get("color") is not None else spec.get("colors", ()))
    ]
    if (
        color_override is not None
        and color_mode in (None, "normal")
        and effect_supports_color_override(effect)
    ):
        words = [_colour_word(color_override), *words[1:]]
    if color_mode == PALETTE_COLOR_MODE and effect_supports_color_mode(effect, color_mode):
        words = palette_words(effect, palette) or words
    settings = _command_settings(
        spec["mode"], command_id, value, rate, words[0] if words else None, words[1:],
        _sent_intensity(spec, intensity),
    )
    if palette_music_flow(effect, color_mode, palette):
        # The music mode: the whole palette, at the effect's own speed and
        # intensity (the music mode takes none).
        settings["palette"] = [list(colour) for colour in music_palette(palette)]
        _, settings["intensity"], settings["rate"], _ = PRESET_ROWS[command_id]
    return settings


def lamp_effect_frame(settings, seconds: float) -> list:
    """What a command shows ``seconds`` into a preview: 100 (r, g, b) of LED
    drive, lamp order. A preview starts at Timeline.first_shown; Fireworks has
    its own timeline, and its flare from the first render."""
    if settings["mode"] == FIREWORKS_MODE:
        return render_fireworks(seconds, settings["rate"], settings["direction"])
    timeline = timeline_for(settings)
    render = timeline.first_shown() + int(seconds / RENDER_SECONDS)
    return frame_pixels(timeline.frame_at(render))


def lamp_clock_settings(
    effect: str, speed: int, color_override=None, color_mode=None, intensity=None,
    palette=None, direct: bool | None = None,
) -> dict:
    """What the lamp runs behind the clock when ``effect`` is its mixer: mode 40
    hands over to it under the clock overlay (light_native._native_clock_params
    for the command, the renderers here for what it does). The color and
    the palette reach every mixer (CLOCK_MIXER_EFFECTS there). A slot that draws its colour
    words (1, 8, 28, 33, 72) is sent all of them, the color first, none under
    B&W, and no palette, which would only drop them (const.clock_style_colors).
    A mixer with no speed reads no rate, so its timeline stays the effect's;
    the same for the intensity. In the palette color mode a background that
    takes it is sent the palette's colours (clock_palette_words, ``palette``);
    without them it runs as in the normal mode. A background mode 40 hands
    over to is marked ``handover``: it starts past its first render, on the
    hand-over's flags. ``direct``: the style runs it as itself under the
    clock overlay (const.clock_style_direct); by default
    CLOCK_DIRECT_BACKGROUNDS do."""
    settings = _clock_settings(effect, speed, color_override, color_mode, intensity, palette)
    if direct is None:
        direct = settings["mode"] in CLOCK_DIRECT_BACKGROUNDS
    if not direct:
        settings["handover"] = True
    return settings


def clock_digit_flags(mixer: int, direct: bool) -> int:
    """The flags the clock's digits are drawn on (lamp_core.clock_digit_targets):
    the clock's own, plus what a background started directly sets in its first
    render (CLOCK_SETUP_FLAGS)."""
    return HANDOVER_FLAGS | (CLOCK_SETUP_FLAGS.get(mixer, 0) if direct else 0)


def _clock_settings(effect, speed, color_override, color_mode, intensity, palette) -> dict:
    spec = ALL_NATIVE_EFFECTS[effect]
    mode = spec["mode"]
    if color_mode == PALETTE_COLOR_MODE:
        sent = clock_palette_words(effect, palette)
        color_mode = None
        if sent:
            command_id = CLOCK_MIXER_COMMAND_IDS.get(mode, NATIVE_CLOCK_EFFECT_ID)
            rate = lamp_rate(mode, speed) if spec.get("speed") else PRESET_ROWS[command_id][2]
            return _command_settings(
                mode, command_id, CLOCK_BACKGROUND_DIRECTION, rate, sent[0], sent[1:],
                _sent_intensity(spec, intensity),
            )
    words = [int(word) & 0xFFFFFF for word in spec.get("colors", ())]
    if words:
        if color_mode == "bw":
            color_override = None
            words = []
        color_mode = None
    active = color_mode not in (None, "normal")
    command_id = CLOCK_COLOR_MODES.get(color_mode) if active else None
    if command_id is None:
        command_id = CLOCK_MIXER_COMMAND_IDS.get(mode, NATIVE_CLOCK_EFFECT_ID)
    word = None
    if not active:
        if color_override is not None:
            word = _colour_word(color_override)
        elif spec.get("color") is not None:
            word = spec["color"] & 0xFFFFFF
        elif words:
            word = words[0]
    rate = lamp_rate(mode, speed) if spec.get("speed") else PRESET_ROWS[command_id][2]
    more = words[1:] if not active and word is not None else ()
    return _command_settings(
        mode, command_id, CLOCK_BACKGROUND_DIRECTION, rate, word, more,
        _sent_intensity(spec, intensity),
    )


# The families: one line each.
register_family(lamp_effects_core)
register_family(lamp_effects_waves)
register_family(lamp_effects_noise)
register_family(lamp_effects_sparks)
register_family(lamp_effects_trails)
register_family(lamp_effects_music)

# The effects these renderers draw: their frames are LED drive (see above).
LAMP_RENDERED_EFFECTS = frozenset(
    name for name, spec in ALL_NATIVE_EFFECTS.items()
    if spec["mode"] in REGISTRY or spec["mode"] == FIREWORKS_MODE
)
# The effects that draw what the microphone hears (lamp_effects_music; their
# previews run on the demo beat).
LAMP_MUSIC_EFFECTS = frozenset(
    name for name, spec in ALL_NATIVE_EFFECTS.items()
    if spec["mode"] in {slot["mode"] for slot in lamp_effects_music.SLOTS}
)
