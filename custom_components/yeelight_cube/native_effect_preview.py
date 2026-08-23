"""Software previews for Cube Lite firmware-native effects."""

from __future__ import annotations

import colorsys
import math

COLS = 20
ROWS = 5
BLACK = (0, 0, 0)
_TIDE_HEAD_PATHS = (
    (
        (
            16.0,
            34.0,
            21.0,
            40.0,
            24.0,
            46.0,
            29.0,
            49.0,
            35.0,
            58.0,
            40.0,
            61.0,
            46.0,
            65.0,
            49.0,
            70.0,
        ),
        (
            5.4,
            7.1,
            5.8,
            6.6,
            7.7,
            5.2,
            6.9,
            7.4,
            5.6,
            6.3,
            7.9,
            5.1,
            6.8,
            7.2,
            5.9,
            6.5,
        ),
        103.4,
        0.0,
    ),
    (
        (
            3.0,
            -16.0,
            -1.0,
            -23.0,
            -5.0,
            -22.0,
            -1.0,
            -15.0,
            4.0,
            -19.0,
            -3.0,
            -23.0,
            -1.0,
            -16.0,
            2.0,
            -19.0,
        ),
        (
            6.2,
            5.3,
            7.6,
            6.8,
            5.7,
            7.3,
            6.1,
            5.5,
            7.9,
            6.4,
            5.1,
            7.0,
            6.7,
            5.8,
            7.5,
            6.0,
        ),
        102.9,
        3.17,
    ),
)
_MUSIC_FLOW_FLOWERS = (
    (4, 2, (255, 55, 160)),
    (10, 1, (255, 126, 40)),
    (16, 3, (63, 210, 255)),
)
_MUSIC_FLOW_SPECTRUM_HEIGHTS = (
    1, 2, 3, 5, 4, 2, 3, 4, 5, 3, 2, 4, 5, 4, 2, 3, 5, 4, 2, 1
)
_MUSIC_FLOW_NOTE_PIXELS = frozenset(
    {
        (4, 0),
        (5, 0),
        (4, 1),
        (5, 1),
        (6, 1),
        (6, 2),
        (6, 3),
        (6, 4),
        (7, 4),
        (8, 4),
        (9, 4),
        (10, 4),
        (11, 4),
        (12, 4),
        (13, 1),
        (14, 1),
        (13, 2),
        (14, 2),
        (14, 3),
        (14, 4),
    }
)


def _clamp(value: float) -> int:
    # Round half up to match JS Math.round (channel values are always >= 0).
    return max(0, min(255, math.floor(value + 0.5)))


def _rgb(red: float, green: float, blue: float, level: float = 1.0):
    return (
        _clamp(red * level),
        _clamp(green * level),
        _clamp(blue * level),
    )


def _hsv(hue: float, saturation: float = 1.0, value: float = 1.0):
    red, green, blue = colorsys.hsv_to_rgb(hue % 1.0, saturation, value)
    return _rgb(red * 255, green * 255, blue * 255)


def _noise(col: int, row: int, frame: int) -> float:
    value = (col * 374761393 + row * 668265263 + frame * 2246822519) & 0xFFFFFFFF
    value = (value ^ (value >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((value ^ (value >> 16)) & 0xFF) / 255.0


def _flow_coordinates(col: int, row: int, direction: str) -> tuple[float, float]:
    x = col / (COLS - 1)
    y = row / (ROWS - 1)
    if direction == "Down":
        return 1.0 - y, x
    if direction == "Left":
        return 1.0 - x, y
    if direction == "Right":
        return x, y
    return y, x


def _palette(stops: tuple[tuple[int, int, int], ...], position: float):
    position = max(0.0, min(1.0, position))
    scaled = position * (len(stops) - 1)
    index = min(len(stops) - 2, int(scaled))
    local = scaled - index
    start, end = stops[index], stops[index + 1]
    return tuple(
        _clamp(start[channel] + (end[channel] - start[channel]) * local)
        for channel in range(3)
    )


def _tide_head_position(time: float, head_index: int) -> float:
    positions, durations, cycle_duration, time_offset = _TIDE_HEAD_PATHS[head_index]
    local = (time + time_offset) % cycle_duration
    for index, duration in enumerate(durations):
        if local <= duration:
            start = positions[index]
            end = positions[(index + 1) % len(positions)]
            return (start + (end - start) * (local / duration)) % COLS
        local -= duration
    return positions[0]


_BUILDING_BLOCK_BLUE = (0, 135, 255)


# Left/Right stack along columns (dots travel over rows); Up/Down stack along
# rows (dots travel over columns). Dots land at the far end of their lane and
# pile back toward the entry side; movement matches the direction arrow.
def _building_block_cells(phase: float, direction: str) -> list:
    spawn_dt = 0.48  # phase units between successive dots
    rise = 1.5  # cells travelled per phase unit
    lane_gap = 2.0 / rise  # keep >= 2 empty cells between moving dots
    hold = 0.4  # brief full-panel pause before the reset
    reset_hold = 0.75
    vertical = direction in ("Left", "Right")
    lane_count = COLS if vertical else ROWS
    lane_length = ROWS if vertical else COLS
    total = lane_count * lane_length
    moving_forward = direction in ("Right", "Up")
    counts = [0] * lane_count
    last_spawn = [-lane_gap] * lane_count
    events = []
    spawn_time = reset_hold
    last_landing = 0.0

    for k in range(total):
        if k > 0:
            spawn_time += spawn_dt
        start_lane = min(lane_count - 1, int(_noise(k, 0, 777) * lane_count))
        lane = -1
        for offset in range(lane_count):
            candidate = (start_lane + offset) % lane_count
            if (
                counts[candidate] < lane_length
                and spawn_time - last_spawn[candidate] >= lane_gap
            ):
                lane = candidate
                break
        if lane < 0:
            spawn_time = min(
                last_spawn[candidate] + lane_gap
                for candidate in range(lane_count)
                if counts[candidate] < lane_length
            )
            for offset in range(lane_count):
                candidate = (start_lane + offset) % lane_count
                if (
                    counts[candidate] < lane_length
                    and spawn_time - last_spawn[candidate] >= lane_gap - 1e-9
                ):
                    lane = candidate
                    break
        target_pos = (
            lane_length - 1 - counts[lane] if moving_forward else counts[lane]
        )
        counts[lane] += 1
        last_spawn[lane] = spawn_time
        events.append((lane, target_pos, spawn_time))
        start_pos = 0 if moving_forward else lane_length - 1
        last_landing = max(
            last_landing,
            spawn_time + abs(target_pos - start_pos) / rise,
        )

    cycle = last_landing + hold
    local = ((phase % cycle) + cycle) % cycle
    grid: list = [None] * total
    for lane, target_pos, spawn_time in events:
        if local < spawn_time:
            continue
        pos = (
            rise * (local - spawn_time)
            if moving_forward
            else lane_length - 1 - rise * (local - spawn_time)
        )
        if moving_forward and pos > target_pos:
            pos = target_pos
        if not moving_forward and pos < target_pos:
            pos = target_pos
        cell = math.floor(pos + 0.5)
        if 0 <= cell < lane_length:
            index = cell * COLS + lane if vertical else lane * COLS + cell
            grid[index] = _BUILDING_BLOCK_BLUE
    return grid


def render_music_flow_effect(effect: str) -> list[tuple[int, int, int]]:
    """Return a deterministic 20x5 illustration of a Music Flow effect."""
    pixels: list[tuple[int, int, int]] = []

    for row in range(ROWS):
        for col in range(COLS):
            x = col / (COLS - 1)
            y = row / (ROWS - 1)

            if effect == "Gather":
                distance = math.hypot((x - 0.5) * 1.35, (y - 0.5) * 0.8)
                funnel = abs(y - 0.5) < 0.12 + abs(x - 0.5) * 0.55
                level = max(0.08, 1.0 - distance)
                if funnel:
                    level = min(1.0, level + 0.38)
                color = _hsv(0.78 - x * 0.65, 0.92, level)
            elif effect == "Breathing":
                distance = math.hypot((x - 0.5) * 1.15, (y - 0.5) * 1.7)
                level = max(0.04, 1.0 - distance)
                color = _palette(
                    (
                        (18, 13, 72),
                        (82, 38, 214),
                        (255, 64, 181),
                        (255, 225, 247),
                    ),
                    level,
                )
                color = _rgb(*color, 0.22 + level * 0.78)
            elif effect == "Blossom":
                color = (7, 2, 18)
                for center_col, center_row, petal_color in _MUSIC_FLOW_FLOWERS:
                    dx = col - center_col
                    dy = row - center_row
                    if dx == 0 and dy == 0:
                        color = (255, 244, 115)
                        break
                    if (abs(dx), abs(dy)) in ((1, 0), (0, 1), (1, 1)):
                        color = petal_color
                        break
            elif effect == "Spectrum":
                if row < _MUSIC_FLOW_SPECTRUM_HEIGHTS[col]:
                    color = _hsv(x * 0.86, 0.95, 0.58 + row * 0.1)
                else:
                    color = BLACK
            elif effect == "Music Note":
                if (col, row) in _MUSIC_FLOW_NOTE_PIXELS:
                    color = _hsv(0.82 + x * 0.48, 0.8, 1.0)
                else:
                    color = (2, 5, 22)
            elif effect == "Impact":
                dx = col - (COLS - 1) / 2
                dy = row - (ROWS - 1) / 2
                distance = math.hypot(dx / 9.5, dy / 2.0)
                ray = (
                    row == 2
                    or col in (9, 10)
                    or abs(abs(dx) - abs(dy) * 2.8) < 0.75
                )
                if distance < 0.18:
                    color = (255, 255, 235)
                elif ray:
                    color = _palette(
                        ((255, 28, 86), (255, 117, 25), (255, 235, 83)),
                        max(0.0, 1.0 - distance),
                    )
                else:
                    color = _rgb(96, 8, 112, max(0.08, 0.38 - distance * 0.2))
            else:
                color = _hsv(x * 0.86, 0.9, 0.35 + 0.65 * y)

            pixels.append(color)

    return pixels


def render_native_effect(
    effect: str,
    phase: float,
    direction: str = "Up",
) -> list[tuple[int, int, int]]:
    """Return one animated 20x5 approximation of a firmware effect."""
    frame = int(phase * 5)
    pixels: list[tuple[int, int, int]] = []
    building_block_grid = None  # lazily built once per frame

    for row in range(ROWS):
        for col in range(COLS):
            x = col / (COLS - 1)
            y = row / (ROWS - 1)
            u, v = _flow_coordinates(col, row, direction)
            wave = (math.sin((u * 2.0 - phase) * math.tau) + 1.0) / 2.0
            noise = _noise(col, row, frame)

            if effect == "Streamer":
                # The whole panel is one uniform color that slowly morphs
                # through the spectrum as phase advances -- no spatial
                # variation across pixels.
                color = _hsv(phase * 0.08 % 1.0, 0.9, 0.88)
            elif effect == "Starry sky":
                # Sparse blue stars that pop on and slowly fade to black. Each
                # pixel runs its own cycle (stable random phase + rate) so stars
                # appear and fade independently instead of the whole panel
                # jumping between states. ``phase`` already scales with the
                # effect speed, so a higher speed shortens the fade -- matching
                # the real firmware, where speed controls the fade rate rather
                # than a spawn rate.
                seed = _noise(col, row, 0)
                seed2 = _noise(col, row, 999)
                cycle_rate = 0.25 + 0.3 * seed2
                local = (phase * cycle_rate + seed) % 1.0
                rise = 0.04
                fade = 0.34
                if local < rise:
                    level = local / rise
                elif local < rise + fade:
                    level = 1.0 - (local - rise) / fade
                else:
                    level = 0.0
                color = _rgb(30, 140, 255, level)
            elif effect == "Spectrum":
                # A full rainbow gradient painted pixel-by-pixel, red -> magenta.
                # "Right" scans line-by-line (bottom-left red, top-right magenta);
                # "Down" scans column-by-column (bottom-left red, top-right magenta);
                # "Left"/"Up" are the 180-degree rotations of "Right"/"Down".
                last = COLS * ROWS - 1
                if direction in ("Down", "Up"):
                    index = col * ROWS + row
                    if direction == "Up":
                        index = last - index
                else:
                    index = (ROWS - 1 - row) * COLS + col
                    if direction == "Left":
                        index = last - index
                t = index / last
                color = _hsv(t * 0.83, 1.0, 0.82 + 0.18 * math.sin((t + phase * 0.08) * math.tau))
            elif effect == "Ocean Waves":
                # Right/Left reuse Up/Down coordinates so device-orientation rotation renders correctly.
                if direction == "Right":
                    ow_u, ow_v = y, x
                elif direction == "Left":
                    ow_u, ow_v = 1.0 - y, x
                else:
                    ow_u, ow_v = u, v
                # Source offset matches physical lamp: Down/Right shift left, Up/Left shift right.
                v_center = 0.5 - 2.0 / 19.0 if direction in ("Down", "Right") else 0.5 + 2.0 / 19.0
                du = ow_u
                dv = (ow_v - v_center) * 2.2
                dist = math.hypot(du, dv)
                ripple = (math.sin((dist * 1.0 - phase) * math.tau) + 1.0) / 2.0
                color = _hsv(0.64 - 0.07 * ripple, 0.97, 0.12 + 0.88 * ripple)
            elif effect == "Rainbow":
                # Swap the Right<->Down and Left<->Up direction pairs to match the lamp.
                _rainbow_remap = {"Right": "Down", "Down": "Right", "Left": "Up", "Up": "Left"}
                ru, _ = _flow_coordinates(col, row, _rainbow_remap.get(direction, direction))
                # Smoothly sweep the hue magenta -> red, then hard-jump back to magenta
                # and loop -- a sharp trailing switch instead of a smooth fade-out.
                s = (ru - phase * 0.18) % 1.0
                color = _hsv(s * 0.85, 0.95, 0.95)
            elif effect == "Waterfall":
                # Blue dots spawn on one edge and travel to the opposite edge at
                # a constant speed, each leaving a fixed-length trail fading to
                # black. Spawn times per lane are jittered (irregular) so dots
                # appear at random moments rather than a fixed rhythm. Direction
                # picks the axis:
                #   Right: top->bottom, Left: bottom->top (lanes = columns)
                #   Down:  left->right, Up:   right->left (lanes = rows)
                if direction in ("Left", "Right"):
                    lane = col
                    pos = ROWS - 1 - row if direction == "Right" else row
                else:
                    lane = row
                    pos = col if direction == "Down" else COLS - 1 - col
                v = 7.0  # pixels per phase unit (same speed everywhere)
                trail_pixels = 7.5
                spawn = 2.5  # avg phase units between spawns per lane
                lo = phase - (pos + trail_pixels) / v
                hi = phase - pos / v
                level = 0.0
                n = math.floor(lo / spawn) - 1
                n_end = math.ceil(hi / spawn) + 1
                while n <= n_end:
                    # Jitter each spawn slot's emission time within its interval.
                    emit = n * spawn + (_noise(lane, n + 1024, 0) - 0.5) * spawn * 0.9
                    if lo <= emit <= hi:
                        d = (phase - emit) * v - pos  # distance behind the head
                        level = max(level, 1.0 - d / trail_pixels)
                    n += 1
                color = _rgb(30, 140, 255, level)
            elif effect == "Aurora":
                # Snake of green LEDs travelling along the raster path
                # (row-major index). A ~40px segment (bright ~7px centre, long
                # gradient tails) slides pixel by pixel and disappears off an
                # edge. Each snake spawns at a random position -- off an edge
                # (slides in) or on-screen in the middle (fades in slowly) --
                # and heads up or down; a single snake never reverses.
                # Randomised so it never feels like a loop. Overlaps take the
                # brightest value (max-combine).
                cell_count = COLS * ROWS
                # Left/Right run the snake row-major (line by line); Up/Down run
                # it column-major (column by column).
                if direction in ("Up", "Down"):
                    idx = col * ROWS + row
                else:
                    idx = row * COLS + col
                core_half = 3.5  # ~7px bright centre
                falloff = 24.0  # core_half + falloff = 27.5 -> 55px segment
                reach = core_half + falloff
                last = cell_count - 1
                v = 9.0  # pixels per phase unit
                fade_in = 2.2  # phase units to fade a snake in (slow centre appear)
                span = last + 2 * reach
                min_travel = 0.4 * span  # keep snakes on-screen long enough
                max_life = span / v
                spawn = max_life / 3.5  # avg ~2.5 snakes (mostly 2-3) on screen
                t = 0.0
                n = math.floor((phase - max_life) / spawn) - 1
                n_hi = math.floor(phase / spawn) + 1
                while n <= n_hi:
                    emit = n * spawn + (_noise(n + 4096, 7, 0) - 0.5) * spawn * 0.4
                    age = phase - emit
                    if age >= 0.0:
                        p0 = -reach + _noise(n + 4096, 11, 0) * span
                        if p0 < 0:
                            a_dir = 1  # off the top edge -> must slide down
                        elif p0 > last:
                            a_dir = -1  # off the bottom edge -> must slide up
                        else:
                            a_dir = 1 if _noise(n + 4096, 9, 0) < 0.5 else -1
                            # Flip if this direction would exit too soon.
                            travel = last + reach - p0 if a_dir > 0 else p0 + reach
                            if travel < min_travel:
                                a_dir = -a_dir
                        life = (last + reach - p0) / v if a_dir > 0 else (p0 + reach) / v
                        if age <= life:
                            center = p0 + a_dir * v * age
                            fade = min(1.0, age / fade_in)
                            d = abs(idx - center)
                            if d <= core_half:
                                ti = 1.0
                            elif d <= reach:
                                ti = 1.0 - (d - core_half) / falloff
                            else:
                                ti = 0.0
                            ti *= fade
                            if ti > t:
                                t = ti
                    n += 1
                # Lerp dark blue-grey -> brighter deep green.
                color = _rgb(14 + (15 - 14) * t, 20 + (200 - 20) * t, 34 + (75 - 34) * t)
            elif effect == "Bonfire":
                # Flames rise along the flow axis (u); flicker varies across it (v).
                heat = max(0.0, 1.0 - u + noise * 0.45 - 0.2 * math.sin((v * 3 + phase) * math.tau))
                color = _palette(((70, 0, 0), (255, 35, 0), (255, 200, 0), (255, 255, 180)), min(1.0, heat))
            elif effect == "Pinball":
                # Triangle-wave bounce (constant velocity, incommensurate x/y
                # speeds) on a table 2x the visible area: a ball in the margin
                # is clamped to the border it exited, sliding as a half-ball.
                # Each ball is point-mirrored through the panel centre, and both
                # periodically split into a two-child trailing trace (identical
                # colour/brightness, in sync) while slowly cycling colour.
                def _tri(t):
                    return 1.0 - abs((t % 2.0) - 1.0)

                def _ext(t):
                    return _tri(t) * 2.0 - 0.5

                def _clamp01(c):
                    return max(0.0, min(1.0, c))

                def _ball1(p):
                    return _ext(p * 0.309), _ext(p * 0.207 + 0.5)

                def _ball2(p):
                    return _ext(p * 0.381 + 1.3), _ext(p * 0.267 + 0.9)

                spread = (1.0 - math.cos(phase * 1.25)) * 0.5
                lag = 0.6
                offsets = (0.0, spread * lag, spread * lag * 2.0)
                level = 0.03
                for _ball in (_ball1, _ball2):
                    for _dp in offsets:
                        bx, by = _ball(phase - _dp)
                        for px, py in (
                            (_clamp01(bx), _clamp01(by)),
                            (_clamp01(1.0 - bx), _clamp01(1.0 - by)),
                        ):
                            d = math.hypot((x - px) * 2.17, y - py)
                            contrib = max(0.0, 1.0 - d * 3.6)
                            if contrib > level:
                                level = contrib
                ball_color = _palette(
                    (
                        (255, 0, 0),
                        (148, 0, 211),
                        (255, 105, 180),
                        (0, 0, 255),
                        (0, 255, 255),
                        (255, 0, 255),
                        (255, 0, 0),
                    ),
                    (phase * 0.12) % 1.0,
                )
                color = _rgb(ball_color[0], ball_color[1], ball_color[2], level)
            elif effect == "Shooting Star":
                # Black sky with independent shooting stars. Five slots cap the
                # count at 5; each runs its own spawn -> travel -> idle-gap cycle
                # (~50% duty) so 0 and 5 are both rare. Per spawn the lane,
                # colour (10 rainbow hues), speed and length (4-9 px) are random,
                # and a fresh spawn can reuse a busy lane. Direction picks the
                # travel axis and sense:
                #   Left top->bottom, Right bottom->top (lanes = columns)
                #   Down left->right,  Up   right->left  (lanes = rows)
                vertical = direction not in ("Up", "Down")
                increasing = direction in ("Left", "Down")
                span = ROWS if vertical else COLS
                lane_count = COLS if vertical else ROWS
                lane_idx = col if vertical else row
                pos = row if vertical else col
                sphase = phase * 0.4  # 2.5x slower than the raw animation phase
                best = 0.0
                star = BLACK
                for s in range(5):
                    rate = 0.55 + 0.5 * _noise(s, 0, 7)
                    t = sphase * rate + _noise(s, 0, 8) * 7.0
                    cyc = math.floor(t)
                    local = t - cyc
                    fall_len = 0.3 + 0.4 * _noise(s, cyc, 33)
                    if local >= fall_len:
                        continue
                    if int(_noise(s, cyc, 11) * lane_count) != lane_idx:
                        continue
                    length = 4 + min(5, int(_noise(s, cyc, 44) * 6))
                    prog = local / fall_len
                    travel = span + length + 1
                    if increasing:
                        head = -1.0 + prog * travel
                        lo, hi = head - length, head
                    else:
                        head = span - prog * travel
                        lo, hi = head, head + length
                    dseg = max(0.0, lo - pos, pos - hi)
                    lvl = max(0.0, min(1.0, 1.2 - dseg * 0.7))
                    if lvl > best:
                        best = lvl
                        hue = int(_noise(s, cyc, 22) * 10) / 10
                        star = _hsv(hue, 1.0, 1.0)
                color = (
                    _rgb(star[0], star[1], star[2], best) if best > 0 else BLACK
                )
            elif effect == "Tide":
                # Independent heads on the top and bottom rows paint in either
                # direction for 2-3 seconds at a time. They wrap across the
                # panel edges and leave fading trails, with opposite row offsets
                # bending each trail.
                history_step = 0.125
                history_start = math.floor(phase / history_step) * history_step
                best_level = 0.0
                paint_hue = 0.0
                for sample in range(73):
                    sample_time = (
                        phase
                        if sample == 0
                        else history_start - (sample - 1) * history_step
                    )
                    age = phase - sample_time
                    fade = (
                        1.0
                        if age <= 1.0
                        else max(0.0, 1.0 - (age - 1.0) / 3.0)
                    )
                    for head_index in range(2):
                        anchor_row = 0 if head_index == 0 else ROWS - 1
                        row_distance = abs(row - anchor_row)
                        row_time = sample_time - row_distance * 0.11
                        row_offset = (row - anchor_row) * (
                            2.0 if head_index == 0 else -2.0
                        )
                        head = (
                            _tide_head_position(row_time, head_index) + row_offset
                            + COLS
                        ) % COLS
                        direct_distance = abs(col - head)
                        distance = min(direct_distance, COLS - direct_distance)
                        coverage = max(0.0, min(1.0, 1.35 - distance))
                        level = coverage * fade
                        if level > best_level:
                            best_level = level
                            paint_hue = (
                                sample_time * 0.045
                                - col / COLS
                                - row * 0.075
                                + head_index * 0.12
                            )
                color = (
                    _rgb(*_hsv(paint_hue, 1.0, 1.0), best_level)
                    if best_level > 0
                    else BLACK
                )
            elif effect == "Building block":
                if building_block_grid is None:
                    building_block_grid = _building_block_cells(phase, direction)
                color = building_block_grid[row * COLS + col] or BLACK
            elif effect == "Hacking":
                head = (phase * 0.8 + _noise(col, 0, 0)) % 1.0
                distance = (head - u) % 1.0
                level = 1.0 if distance < 0.08 else max(0.04, 0.65 - distance * 1.8)
                color = _rgb(25, 255, 85, level)
            elif effect == "Flower Sea":
                petal = abs(math.sin((x * 3.5 + y * 2.0 + phase * 0.25) * math.tau))
                color = _hsv(0.82 + 0.22 * x + phase * 0.03, 0.75, 0.25 + 0.75 * petal)
            elif effect == "Magic":
                angle = math.atan2(y - 0.5, x - 0.5) / math.tau
                radius = math.hypot((x - 0.5) * 1.6, y - 0.5)
                color = _hsv(angle + radius - phase * 0.2, 0.85, 0.35 + 0.65 * wave)
            elif effect == "Wonderland":
                color = _hsv(0.48 + x * 0.36 + phase * 0.025, 0.48, 0.55 + 0.45 * wave)
            elif effect == "Kaleidoscope":
                sx = abs(x - 0.5) * 2.0
                sy = abs(y - 0.5) * 2.0
                pattern = (math.sin((sx + sy - phase * 0.35) * math.tau * 2.0) + 1.0) / 2.0
                color = _hsv(sx * 0.35 + sy * 0.4 + phase * 0.05, 0.9, 0.22 + 0.78 * pattern)
            elif effect == "Palette":
                index = (int(x * 8) + int(y * 3) + int(phase * 0.7)) % 8
                color = _hsv(index / 8.0, 0.72, 0.95)
            else:
                color = _hsv(x + phase * 0.05, 0.8, 0.35 + 0.65 * wave)

            pixels.append(color)

    return pixels
