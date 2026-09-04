"""Software previews for Cube Lite firmware-native effects."""

from __future__ import annotations

import colorsys
import math

COLS = 20
ROWS = 5
BLACK = (0, 0, 0)

# ── Row orientation convention (READ BEFORE ADDING A PREVIEW) ────────────
# render_native_effect() returns rows with ROW 0 = the panel's PHYSICAL
# BOTTOM: camera.py maps preview row 0 to the image bottom (_dr_n = ROWS-1-r)
# and the lamp-preview card does the same. Videos captured to reverse-engineer
# an effect have array row 0 = image TOP, so any phase field / row term fit
# from a recording MUST index the row axis flipped (ROWS - 1 - row) or the
# preview renders upside down. _render_carousel is the reference example.
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


def _smoothstep(value: float) -> float:
    return value * value * (3.0 - 2.0 * value)


def _value_noise_2d(x: float, y: float, frame: int) -> float:
    col = math.floor(x)
    row = math.floor(y)
    col_mix = _smoothstep(x - col)
    row_mix = _smoothstep(y - row)
    top = _noise(col, row, frame) + (
        _noise(col + 1, row, frame) - _noise(col, row, frame)
    ) * col_mix
    bottom = _noise(col, row + 1, frame) + (
        _noise(col + 1, row + 1, frame) - _noise(col, row + 1, frame)
    ) * col_mix
    return top + (bottom - top) * row_mix


def _value_noise_3d(x: float, y: float, time: float) -> float:
    frame = math.floor(time)
    frame_mix = _smoothstep(time - frame)
    current = _value_noise_2d(x, y, frame)
    following = _value_noise_2d(x, y, frame + 1)
    return current + (following - current) * frame_mix


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

_HACKING_GREENS = ((60, 255, 80), (0, 210, 45), (25, 165, 50))
# Glyphs in display orientation (row 0 = top): 4 wide x 3 tall, centred with an
# empty row above and below. 0 is a hollow box; 1 has a top-left tick.
_HACKING_ZERO = ((1, 1, 1, 1), (1, 0, 0, 1), (1, 1, 1, 1))
_HACKING_ONE = ((1, 0, 0, 0), (1, 1, 1, 1), (1, 0, 0, 1))
_HACKING_GLYPH_ROWS = 3
_HACKING_DIGIT_COUNT = 128
_hacking_strip_cache = None


def _hacking_strip():
    # Deterministic strip of random 0/1 digits with a one-column gap between
    # each, laid out once and reused (independent of phase).
    global _hacking_strip_cache
    if _hacking_strip_cache is not None:
        return _hacking_strip_cache
    specs = []
    width = 0
    for d in range(_HACKING_DIGIT_COUNT):
        glyph = _HACKING_ONE if _noise(d, 0, 101) > 0.5 else _HACKING_ZERO
        shade = min(2, int(_noise(d, 0, 202) * 3))
        specs.append((glyph, shade, width))
        width += len(glyph[0]) + 1
    cells = [None] * (width * _HACKING_GLYPH_ROWS)
    shades = [None] * width  # per-column digit shade (incl. gap)
    for glyph, shade, x in specs:
        color = _HACKING_GREENS[shade]
        for xx in range(len(glyph[0]) + 1):
            shades[x + xx] = color
        for gr in range(_HACKING_GLYPH_ROWS):
            for gx in range(len(glyph[gr])):
                if glyph[gr][gx]:
                    cells[gr * width + x + gx] = color
    _hacking_strip_cache = (cells, shades, width)
    return _hacking_strip_cache


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


def _render_magic(phase: float) -> list[tuple[int, int, int]]:
    """Render the two-field Magic effect with measured frame-level limits."""
    def waypoint(seed_x, seed_y, index):
        return (
            _noise(seed_x, index, 0) * 2.0 - 1.0,
            _noise(seed_y, index, 0) * 2.0 - 1.0,
        )

    def wander(seed_x, seed_y, tt):
        index = math.floor(tt)
        fraction = tt - index
        p0 = waypoint(seed_x, seed_y, index - 1)
        p1 = waypoint(seed_x, seed_y, index)
        p2 = waypoint(seed_x, seed_y, index + 1)
        p3 = waypoint(seed_x, seed_y, index + 2)
        fraction2 = fraction * fraction
        fraction3 = fraction2 * fraction
        return tuple(
            0.5
            * (
                2.0 * p1[axis]
                + (-p0[axis] + p2[axis]) * fraction
                + (2.0 * p0[axis] - 5.0 * p1[axis] + 4.0 * p2[axis] - p3[axis]) * fraction2
                + (-p0[axis] + 3.0 * p1[axis] - 3.0 * p2[axis] + p3[axis]) * fraction3
            )
            for axis in range(2)
        )

    oscillation = math.sin(phase * 0.40)
    radii = (27.0 + 13.0 * oscillation, 27.0 - 13.0 * oscillation)
    points = []
    for index, (seed_x, seed_y, offset) in enumerate(((11, 12, 0.0), (13, 14, 2.7))):
        wx, wy = wander(seed_x, seed_y, phase * 0.225 + offset)
        stretch = 0.25 * math.sin(phase * 0.31 + index * 1.7)
        points.append((9.5 + 20.0 * wx, 2.0 + 5.0 * wy, radii[index], 1.0 + stretch, 1.0 - stretch))

    hues = []
    for row in range(ROWS):
        for col in range(COLS):
            samples = []
            for px, py, radius, scale_x, scale_y in points:
                distance = math.hypot((col - px) * scale_x, (row - py) * scale_y)
                radial = max(0.0, distance / radius - 0.03)
                source_hue = 0.88 * math.tanh(2.4 * radial) ** 0.75
                weight = 1.0 / (distance * distance * 0.08 + 1.0)
                samples.append((source_hue, weight))
            sine_sum = sum(weight * math.sin(math.tau * hue) for hue, weight in samples)
            cosine_sum = sum(weight * math.cos(math.tau * hue) for hue, weight in samples)
            hue = math.atan2(sine_sum, cosine_sum) / math.tau % 1.0
            reddest_source = min(source_hue for source_hue, _ in samples)
            dominant_hue = max(samples, key=lambda sample: sample[1])[0]
            if reddest_source < 0.025:
                hue = reddest_source
            elif hue < 0.075 or hue > 0.96:
                hue = max(0.08, dominant_hue)
            if hue < 0.075:
                hue *= 0.08 / 0.075
            elif hue < 0.14:
                hue = 0.08 + (hue - 0.075) * 0.12 / 0.065
            elif hue < 0.44:
                hue = 0.20 + (hue - 0.14) * 0.23 / 0.30
            elif hue < 0.59:
                hue = 0.43 + (hue - 0.44) * 0.15 / 0.15
            elif hue < 0.75:
                hue = 0.58 + (hue - 0.59) * 0.17 / 0.16
            hues.append(hue)

    ordered_hues = sorted(hues)
    extended_hues = ordered_hues + [hue + 1.0 for hue in ordered_hues]
    hue_span = min(extended_hues[index + 89] - extended_hues[index] for index in range(100))
    if hue_span < 0.217:
        sine_mean = sum(math.sin(math.tau * hue) for hue in hues) / len(hues)
        cosine_mean = sum(math.cos(math.tau * hue) for hue in hues) / len(hues)
        center = math.atan2(sine_mean, cosine_mean) / math.tau % 1.0
        scale = 0.217 / max(hue_span, 1e-6)
        hues = [
            (center + ((hue - center + 0.5) % 1.0 - 0.5) * scale) % 1.0
            for hue in hues
        ]

    def cool_count(values):
        return sum(0.58 <= hue < 0.96 for hue in values)

    if cool_count(hues) > 88:
        for step in range(1, 51):
            shift = step * 0.01
            shifted = [(hue - shift) % 1.0 for hue in hues]
            if cool_count(shifted) <= 88:
                hues = shifted
                break
            shifted = [(hue + shift) % 1.0 for hue in hues]
            if cool_count(shifted) <= 88:
                hues = shifted
                break

    return [_hsv(hue, 1.0, 1.0) for hue in hues]


def _render_wonderland(phase: float) -> list[tuple[int, int, int]]:
    """Render cyan and pink fields drifting through a periwinkle base."""
    def waypoint(seed_x, seed_y, index):
        return (
            _noise(seed_x, index, 0) * 2.0 - 1.0,
            _noise(seed_y, index, 0) * 2.0 - 1.0,
        )

    def wander(seed_x, seed_y, tt):
        index = math.floor(tt)
        fraction = tt - index
        p0 = waypoint(seed_x, seed_y, index - 1)
        p1 = waypoint(seed_x, seed_y, index)
        p2 = waypoint(seed_x, seed_y, index + 1)
        p3 = waypoint(seed_x, seed_y, index + 2)
        fraction2 = fraction * fraction
        fraction3 = fraction2 * fraction
        return tuple(
            0.5
            * (
                2.0 * p1[axis]
                + (-p0[axis] + p2[axis]) * fraction
                + (2.0 * p0[axis] - 5.0 * p1[axis] + 4.0 * p2[axis] - p3[axis]) * fraction2
                + (-p0[axis] + 3.0 * p1[axis] - 3.0 * p2[axis] + p3[axis]) * fraction3
            )
            for axis in range(2)
        )

    oscillation = math.sin(phase * 0.18)
    radii = (5.0 + 1.5 * oscillation, 6.2 - 1.5 * oscillation)
    fields = []
    settings = ((11, 12, 0.0, 0.54, 4.0), (13, 14, 2.7, 0.84, 6.0))
    for index, (seed_x, seed_y, offset, hue, peak) in enumerate(settings):
        wx, wy = wander(seed_x, seed_y, phase * 0.29 + offset)
        stretch = 0.20 * math.sin(phase * 0.18 + index * 1.7)
        fields.append(
            (
                9.5 + 20.0 * wx,
                2.0 + 8.0 * wy,
                radii[index],
                hue,
                1.0 + stretch,
                (1.0 - stretch) * 1.8,
                peak,
            )
        )

    pixels = []
    base_hue = 0.65
    for row in range(ROWS):
        for col in range(COLS):
            sine_sum = math.sin(math.tau * base_hue)
            cosine_sum = math.cos(math.tau * base_hue)
            for px, py, radius, hue, scale_x, scale_y, peak in fields:
                distance = math.hypot((col - px) * scale_x, (row - py) * scale_y)
                weight = peak / (distance * distance / (radius * radius) + 1.0)
                sine_sum += weight * math.sin(math.tau * hue)
                cosine_sum += weight * math.cos(math.tau * hue)
            hue = math.atan2(sine_sum, cosine_sum) / math.tau % 1.0
            softness = min(1.0, max(0.0, (hue - 0.54) / 0.30))
            pixels.append(_hsv(hue, 0.72 - 0.20 * softness, 1.0))
    return pixels


def _render_flower_sea(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render broad pink/purple bands filling whole rows or columns.

    Each band spans a full line perpendicular to the arrow so a region can
    never colour only part of a row or column. Right/Left move across the
    5 rows; Up/Down move across the 20 columns.
    """
    velocity = 0.16
    fade_in = 0.73
    events = []

    def add_events(core_half, falloff, seed, centered=False):
        reach = core_half + falloff
        span = 1.0 + 2.0 * reach
        max_life = ((0.5 + reach) if centered else span) / velocity
        spawn = max_life if centered else max_life / 3.5
        event = math.floor((phase - max_life) / spawn) - 1
        event_end = math.floor(phase / spawn) + 1
        while event <= event_end:
            jitter = 0.2 if centered else 0.4
            emit = event * spawn + (_noise(event + seed, 7, 0) - 0.5) * spawn * jitter
            age = phase - emit
            if age >= 0.0:
                start = 0.5 if centered else -reach + _noise(event + seed, 11, 0) * span
                if centered:
                    travel_direction = 1 if _noise(event + seed, 9, 0) < 0.5 else -1
                elif start < 0.0:
                    travel_direction = 1
                elif start > 1.0:
                    travel_direction = -1
                else:
                    travel_direction = 1 if _noise(event + seed, 9, 0) < 0.5 else -1
                    minimum_travel = 0.4 * span
                    travel = 1.0 + reach - start if travel_direction > 0 else start + reach
                    if travel < minimum_travel:
                        travel_direction = -travel_direction
                life = (
                    (1.0 + reach - start) / velocity
                    if travel_direction > 0
                    else (start + reach) / velocity
                )
                if age <= life:
                    saturation_noise = _noise(event + seed + 6144, 17, 0)
                    peak_saturation = (
                        0.50 + 0.28 * saturation_noise
                        if centered
                        else 0.30 + 0.42 * saturation_noise
                    )
                    events.append(
                        (
                            start + travel_direction * velocity * age,
                            core_half,
                            falloff,
                            min(1.0, age / fade_in),
                            0.78 + 0.20 * _noise(event + seed + 4096, 13, 0) ** 0.7,
                            peak_saturation,
                        )
                    )
            event += 1

    add_events(0.08, 0.40, 4096)
    add_events(0.04, 0.20, 8888, centered=True)

    vertical = direction in ("Up", "Down")
    band_count = COLS if vertical else ROWS
    reverse = direction in ("Left", "Up")

    band_colors = []
    for band in range(band_count):
        position = band / (band_count - 1) if band_count > 1 else 0.5
        if reverse:
            position = 1.0 - position
        level = 0.0
        hue = 0.93
        peak_saturation = 0.98
        for center, core_half, falloff, fade, event_hue, event_saturation in events:
            distance = abs(position - center)
            if distance <= core_half:
                contribution = fade
            elif distance <= core_half + falloff:
                contribution = fade * (1.0 - (distance - core_half) / falloff)
            else:
                contribution = 0.0
            if contribution > level:
                level = contribution
                hue = event_hue
                peak_saturation = event_saturation
        saturation = 0.98 - (0.98 - peak_saturation) * level ** 2
        value = 0.72 + 0.28 * level
        color_hue = 0.93 + (hue - 0.93) * math.sqrt(level)
        band_colors.append(_hsv(color_hue, saturation, value))

    pixels = []
    for row in range(ROWS):
        for col in range(COLS):
            pixels.append(band_colors[col if vertical else row])
    return pixels


# The lamp's four Kaleidoscope variants read 90 deg rotated from the on-screen
# arrow (verified on hardware): selecting Right looks like the preview's Up,
# Down like Right, Left like Down, Up like Left. Relabel so each arrow shows the
# variant the lamp actually plays.
_KALEIDOSCOPE_PREVIEW_DIRECTION = {
    "Up": "Left",
    "Left": "Down",
    "Down": "Right",
    "Right": "Up",
}


def _render_kaleidoscope(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render counter-moving rows or bidirectional rainbow fronts."""
    direction = _KALEIDOSCOPE_PREVIEW_DIRECTION.get(direction, direction)
    if direction in ("Up", "Down"):
        return _render_kaleidoscope_snakes(phase, direction)
    return _render_kaleidoscope_rows(phase, direction)


def _kaleidoscope_base_hue(phase: float) -> float:
    return (
        0.47
        + 0.105 * math.sin(phase * 0.16)
        + 0.06 * math.sin(phase * 0.16 * 0.37 + 1.4)
    ) % 1.0


def _render_kaleidoscope_rows(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    # One continuous rainbow path folds through all five rows. A cycle still
    # spans about two rows, but it now crosses every row boundary naturally.
    wavelength = 55.0
    speed = 8.8
    base_hue = _kaleidoscope_base_hue(phase)
    arrow = -1.0 if direction == "Left" else 1.0

    pixels = []
    for row in range(ROWS):
        for col in range(COLS):
            folded_col = col if row % 2 == 0 else COLS - 1 - col
            position = row * COLS + folded_col
            # A smooth path-wide warp breaks the mechanical stripe spacing
            # without introducing discontinuities where the rows fold.
            warped = position + 1.8 * math.sin(
                math.tau * (position / (ROWS * COLS) + phase * 0.035)
            )
            progress = (warped - arrow * speed * phase) / wavelength % 1.0
            raw_hue = (base_hue + progress) % 1.0
            # The firmware dwells in broad cyan fields between narrower full
            # spectrum passages instead of distributing every hue uniformly.
            hue = (raw_hue + 0.145 * math.sin(math.tau * raw_hue)) % 1.0
            pixels.append(_hsv(hue, 0.97, 1.0))
    return pixels


def _kaleidoscope_snake_emit(event: int) -> float:
    return event * 3.25 + (_noise(event + 101, 17, 0) - 0.5) * 2.0


def _kaleidoscope_snake_events(
    phase: float,
) -> list[tuple[float, float, float, float, float]]:
    spawn_dt = 3.25
    branch_len = 8 * ROWS + (ROWS - 1)
    latest = math.floor(phase / spawn_dt)
    events = []
    for event in range(latest - 8, latest + 2):
        emit = _kaleidoscope_snake_emit(event)
        age = phase - emit
        lifetime = 8.0 + 3.0 * _noise(event + 47, 9, 0)
        if not 0.0 <= age < lifetime:
            continue
        trail = 18.0 + 12.0 * _noise(event + 73, 11, 0)
        hue_span = 0.65 + 0.33 * _noise(event + 89, 13, 0)
        progress = age / lifetime
        remaining = 1.0 - progress
        travel = branch_len + trail
        radius = travel * (1.0 - remaining**4)
        velocity = 4.0 * travel * remaining**3 / lifetime
        events.append((radius, velocity, trail, hue_span, float(event)))
    return events


def _mirrored_path_distance(
    position: float,
    origin: float,
    period: float,
) -> float:
    return abs((position - origin + period / 2.0) % period - period / 2.0)


def _kaleidoscope_mirror_column(col: int) -> int:
    return round(_mirrored_path_distance(col, 7.0, 16.0))


def _render_kaleidoscope_snakes(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    base_hue = (_kaleidoscope_base_hue(phase) - 0.08) % 1.0

    # Down originates at one-based column 8 (index 7). The branch repeats
    # every 16 columns, meeting its reflection at one-based column 16.
    path_hue: list[float | None] = [None] * (ROWS * COLS)
    path_age = [math.inf] * (ROWS * COLS)
    for radius, _velocity, trail, hue_span, _event in _kaleidoscope_snake_events(
        phase
    ):
        for row in range(ROWS):
            for col in range(COLS):
                mirror_col = _kaleidoscope_mirror_column(col)
                branch_row = row if mirror_col % 2 == 0 else ROWS - 1 - row
                branch_pos = mirror_col * ROWS + branch_row
                distance = radius - branch_pos
                index = row * COLS + col
                if not (0.0 <= distance < trail and distance < path_age[index]):
                    continue
                path_age[index] = distance
                progress = distance / trail
                path_hue[index] = (
                    0.02
                    + hue_span * progress**1.15
                    + 0.05 * math.sin(math.tau * progress)
                ) % 1.0

    hues = [base_hue if value is None else value for value in path_hue]
    sats = [0.9 if value is None else 0.98 for value in path_hue]

    pixels = [_hsv(hue, sat, 1.0) for hue, sat in zip(hues, sats)]
    if direction == "Up":
        pixels.reverse()
    return pixels


def _blue_pulse_origin(phase: float) -> float:
    # Slow drift of the source/end, matching the recording's ~140 s wander.
    return (
        9.5
        + 5.8 * math.sin(phase * 0.045 + 0.7)
        + 1.6 * math.sin(phase * 0.045 * 0.39 + 2.1)
    ) % COLS


def _blue_pulse_offsets(
    phase: float,
    rate: float,
    row_skew: float,
) -> list[float]:
    origin = _blue_pulse_origin(phase)
    travel = phase * rate
    front = 8.0 * (travel - math.floor(travel))
    offsets = []

    for row in range(ROWS):
        for col in range(COLS):
            position = col + (row / (ROWS - 1) - 0.5) * row_skew
            distance = _mirrored_path_distance(position, origin, 16.0)
            offsets.append(distance - front)

    return offsets


def _render_blue_white(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render the direction-independent Blue White pulse."""
    del direction
    pixels = []
    sigma = 1.25
    for offset in _blue_pulse_offsets(phase, 0.17, 0.7):
        spread = sigma if offset <= 0.0 else sigma * 0.6
        level = math.exp(-(offset**2) / (2.0 * spread * spread))
        if offset < 0.0:
            level = max(level, 0.4 * math.exp(offset / 2.2))
        pixels.append(
            _rgb(
                16.0 + 224.0 * level,
                104.0 + 142.0 * level,
                255.0,
            )
        )
    return pixels


def _render_blue_yellow(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mirror-symmetric yellow rings expanding from a drifting center.

    Yellow bands are born merged at the center, split into mirror halves and
    travel outward to the fold edges where they reflect, while a fresh ring
    emerges at the center -- so sections continuously join and separate. A
    periodic ring train (period 8 in distance) keeps the outward motion seamless
    with no reset jump.
    """
    del direction
    background = (16, 104, 255)
    vivid_blue = (0, 172, 255)
    white = (238, 249, 255)
    yellow = (255, 226, 20)
    origin = _blue_pulse_origin(phase)
    front = phase * 0.7  # outward-only, so rings never contract
    ring_period = 8.0
    pixels = []

    for row in range(ROWS):
        row_offset = (row / (ROWS - 1) - 0.5) * 1.0
        for col in range(COLS):
            distance = _mirrored_path_distance(col + row_offset, origin, 16.0)
            ring = (distance - front) % ring_period
            radius = min(ring, ring_period - ring)
            if radius <= 0.7:
                color = yellow
            elif radius < 1.1:
                color = _palette((yellow, white), (radius - 0.7) / 0.4)
            elif radius <= 1.5:
                color = white
            elif radius < 2.0:
                color = _palette((white, vivid_blue), (radius - 1.5) / 0.5)
            elif radius <= 2.6:
                color = vivid_blue
            elif radius < 3.2:
                color = _palette((vivid_blue, background), (radius - 2.6) / 0.6)
            else:
                color = background
            pixels.append(color)

    return pixels


def _render_ice_blue(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render the softly morphing cyan cloud field used by mixer 58."""
    del direction
    stops = ((8, 165, 255), (85, 189, 255), (145, 211, 255))
    time = phase * 1.5
    pixels = []

    for row in range(ROWS):
        for col in range(COLS):
            broad = _value_noise_3d(col / 4.0, row / 3.0, time)
            detail = _value_noise_3d(
                col / 2.0 + 2.3,
                row / 1.65 - 1.2,
                time * 0.73 + 8.1,
            )
            level = (broad + 0.35 * detail) / 1.35
            level = 0.5 + (level - 0.5) * 1.7
            pixels.append(_palette(stops, level))

    return pixels


def _sunset_target(event: int) -> tuple[int, int, int]:
    color = _noise(event + 2189, 37, 0)
    shade = _noise(event + 2290, 43, 0)
    if color < 0.04:
        return (0, 255, 12)
    if color < 0.40:
        return _rgb(10 + 35 * shade, 190 + 45 * shade, 255)
    return _rgb(145 + 75 * shade, 170 + 60 * shade, 255)


def _sunset_event_start(event: int, row: int) -> float:
    row_position = row / (ROWS - 1) - 0.5
    sweep_direction = 1 if _noise(event + 2400, 41, 0) >= 0.5 else -1
    return event + sweep_direction * 0.22 * row_position


def _render_sunset(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render Sunset's alternating top-to-bottom and bottom-to-top washes."""
    del direction
    target_time = phase / 0.99
    pixels = []

    for row in range(ROWS):
        nearby_event = math.floor(target_time)
        events = range(nearby_event - 1, nearby_event + 2)
        event = max(
            candidate
            for candidate in events
            if _sunset_event_start(candidate, row) <= target_time
        )
        event_start = _sunset_event_start(event, row)
        transition = min(1.0, (target_time - event_start) / 0.35)
        color = _palette(
            (_sunset_target(event - 1), _sunset_target(event)),
            _smoothstep(transition),
        )
        pixels.extend([color] * COLS)

    return pixels


def _render_carousel(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 56's direction-specific pivoting blue and violet bands."""
    # Fields keyed by the on-screen arrow. The recordings were rotated 90 deg
    # vs the hardware arrows, so each arrow maps to the field that matches the
    # lamp (Right<-Up, Down<-Right, Left<-Down, Up<-Left recordings).
    phase_fields = {
        "Right": (0.483350, 0.0, 0.504720, -0.062360, 0.0),
        "Down": (0.380380, -0.026969, 0.191370, -0.046688, 0.003340),
        "Left": (-0.266153, 0.002328, 0.694217, -0.064390, 0.000189),
        "Up": (0.302916, -0.012155, -0.517179, 0.081158, -0.003279),
    }
    col_phase, col_curve, row_phase, row_skew, row_curve = phase_fields.get(
        direction,
        phase_fields["Up"],
    )
    pixels = []
    time_angle = phase * math.tau / 2.366

    for row in range(ROWS):
        # Coefficients were fit from recordings whose row 0 = image top; the
        # renderer's row 0 = panel bottom, so index the fit flipped.
        fit_row = ROWS - 1 - row
        for col in range(COLS):
            col_squared = col * col
            angle = (
                time_angle
                - 2.132
                + col_phase * col
                + col_curve * col_squared
                + row_phase * fit_row
                + row_skew * col * fit_row
                + row_curve * col_squared * fit_row
            )
            position = (angle / math.tau) % 1.0
            if position < 0.2 or position > 0.8:
                distance = min(position, 1.0 - position) / 0.2
                hue = 0.76 + 0.04 * math.sin(math.pi * distance)
            else:
                distance = (position - 0.2) / 0.6
                hue = 0.63 + 0.052 * math.sin(math.pi * distance)
            pixels.append(_hsv(hue))

    return pixels


def _render_spectrum_chase(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 6's four repeating spectrum transition waves."""
    wave_period = 6.04
    hue = phase / (wave_period * 10.0)
    pixels = []

    for row in range(ROWS):
        for col in range(COLS):
            if direction in ("Up", "Down"):
                distance = 5 * col + row
                if direction == "Down":
                    distance = -distance
            else:
                distance = col + 5 * row
                if direction == "Left":
                    distance = -distance

            travel = phase / wave_period - distance / 25.0
            position = travel - math.floor(travel)
            if position < 0.06:
                level = 0.08 + 0.92 * _smoothstep(position / 0.06)
            elif position < 0.34:
                level = 1.0
            elif position < 0.92:
                level = 1.0 - 0.92 * _smoothstep((position - 0.34) / 0.58)
            else:
                level = 0.08
            pixels.append(_hsv(hue, 1.0, level))

    return pixels


# Measured Cube Lite mode-9 colour maps (renderer coords: row 0 = physical
# bottom, col 0 = left), flat-field corrected from calibrated recordings. The
# horizontal-flow map serves Left as captured and Right column-mirrored; the
# vertical-flow map serves Down as captured and Up row-mirrored.
_PASTEL_PULSE_H = [
    [(213,250,255),(214,246,255),(201,241,255),(217,214,146),(207,230,215),(218,235,243),(188,230,209),(14,234,147),(210,226,234),(213,227,236),(16,216,245),(161,216,244),(219,227,230),(164,212,250),(61,182,255),(207,233,233),(209,231,234),(170,172,255),(212,210,241),(212,238,233)],
    [(193,244,255),(211,223,232),(213,234,254),(205,225,220),(168,221,135),(202,235,238),(201,231,238),(14,240,145),(162,230,222),(213,227,241),(160,222,245),(23,212,255),(214,231,240),(207,239,233),(66,185,255),(167,216,255),(212,249,247),(191,227,255),(213,171,255),(209,251,238)],
    [(197,240,255),(239,174,155),(204,236,245),(209,235,246),(146,226,123),(175,234,205),(205,235,242),(149,238,214),(17,238,198),(210,235,242),(209,237,241),(25,216,255),(155,228,254),(218,248,250),(149,223,253),(98,186,255),(181,225,226),(182,229,228),(167,152,226),(150,191,190)],
    [(198,242,254),(235,184,152),(206,230,217),(207,242,253),(183,239,211),(67,247,123),(215,240,240),(214,247,245),(23,243,220),(145,240,252),(225,241,251),(144,233,255),(49,201,255),(189,235,244),(190,214,229),(99,160,251),(142,178,200),(158,201,201),(231,234,241),(255,255,255)],
    [(212,245,255),(213,236,232),(221,222,142),(210,245,250),(205,243,243),(72,242,117),(130,245,205),(215,238,241),(140,221,221),(28,211,229),(189,212,222),(186,208,221),(47,171,246),(136,188,218),(170,187,198),(128,162,184),(94,112,185),(210,232,235),(221,228,231),(207,232,231)],
]

_PASTEL_PULSE_V = [
    [(210,232,235),(210,232,235),(210,232,235),(123,148,173),(147,160,235),(170,179,255),(213,225,248),(217,247,250),(210,254,243),(210,242,244),(206,209,244),(201,156,255),(209,158,254),(210,204,233),(208,224,230),(196,233,226),(201,230,225),(210,237,231),(216,234,232),(221,235,231)],
    [(210,232,235),(145,167,173),(160,206,230),(51,190,255),(55,216,255),(168,238,255),(217,247,248),(225,249,245),(221,238,244),(164,216,255),(63,187,255),(63,184,255),(162,210,255),(199,233,226),(211,227,232),(198,221,233),(152,201,243),(92,171,255),(112,168,255),(180,203,237)],
    [(163,171,165),(162,227,213),(31,255,212),(25,255,222),(170,255,240),(233,248,247),(224,246,245),(223,242,244),(160,236,238),(18,228,246),(16,225,246),(156,225,243),(208,229,234),(210,228,235),(197,226,232),(137,219,246),(24,208,255),(25,208,255),(149,216,247),(218,227,240)],
    [(182,191,181),(188,232,137),(180,252,139),(207,254,223),(222,251,253),(217,251,255),(220,241,245),(190,244,219),(97,237,130),(69,237,131),(170,232,211),(197,233,240),(206,227,244),(195,234,239),(151,228,204),(19,239,133),(20,238,135),(142,237,212),(207,234,240),(230,237,254)],
    [(196,214,228),(220,255,255),(226,255,255),(213,255,255),(207,255,255),(211,249,255),(204,234,233),(239,183,155),(230,175,148),(203,225,228),(196,235,251),(196,237,255),(200,233,255),(203,229,226),(209,207,148),(203,215,133),(189,227,214),(193,239,250),(213,238,255),(252,253,255)],
]


def _render_pastel_pulse(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 9 from the measured colour maps with a subtle brightness pulse."""
    breath = math.sin(math.tau * phase / 3.2)
    pixels = []

    for row in range(ROWS):
        for col in range(COLS):
            if direction == "Right":
                base = _PASTEL_PULSE_V[row][col]
            elif direction == "Left":
                base = _PASTEL_PULSE_V[ROWS - 1 - row][COLS - 1 - col]
            elif direction == "Up":
                base = _PASTEL_PULSE_H[row][col]
            else:  # Down
                base = _PASTEL_PULSE_H[ROWS - 1 - row][COLS - 1 - col]

            # Push low-chroma (grey/pale) cells toward white so only genuinely
            # coloured islands stand out, matching the real panel.
            red, green, blue = base
            chroma = max(red, green, blue) - min(red, green, blue)
            tint = min(1.0, max(0.0, (chroma - 30) / 40.0))
            red = red * tint + 255 * (1.0 - tint)
            green = green * tint + 255 * (1.0 - tint)
            blue = blue * tint + 255 * (1.0 - tint)

            sign = 1.0 if (row + col) % 2 == 0 else -1.0
            gain = 1.0 + 0.05 * breath * sign
            pixels.append((_clamp(red * gain), _clamp(green * gain), _clamp(blue * gain)))

    return pixels


def _render_spectrum_crumble(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 60's Spectrum field flowing in and dissolving to black."""
    cycle_length = 8.954
    cycle = math.floor(phase / cycle_length)
    local = phase - cycle * cycle_length
    last = COLS * ROWS - 1
    pixels = []

    for row in range(ROWS):
        for col in range(COLS):
            if direction in ("Down", "Up"):
                index = col * ROWS + row
                if direction == "Down":
                    index = last - index
            else:
                index = (ROWS - 1 - row) * COLS + col
                if direction == "Left":
                    index = last - index

            position = index / last
            rise_start = 1.95 * position
            rise = _smoothstep(min(1.0, max(0.0, (local - rise_start) / 0.24)))
            release_noise = _noise(col + cycle * 29, row, 3061)
            duration_noise = _noise(col + cycle * 31, row, 3163)
            fade_start = 1.85 + 2.30 * position + 0.64 * (release_noise - 0.5)
            fade_duration = 0.62 + 0.48 * duration_noise
            fade = _smoothstep(
                min(1.0, max(0.0, (local - fade_start) / fade_duration))
            )
            level = rise * (1.0 - fade)
            if local > fade_start and level > 0.0:
                shimmer = _value_noise_3d(
                    col * 0.73 + cycle * 3.1,
                    row * 0.91,
                    local * 3.2,
                )
                level *= 0.58 + 0.42 * shimmer
            pixels.append(_hsv(position * 0.83, 1.0, level))

    return pixels


_SOLAR_FLARE_PALETTE = (
    (110, 16, 26),
    (190, 24, 58),
    (235, 32, 62),
    (250, 60, 40),
    (252, 120, 52),
    (252, 150, 70),
    (250, 190, 130),
    (245, 225, 210),
)

# Flares may only ignite on the top row at these columns.
_SOLAR_FLARE_SPAWN_COLS = (0, 1, 2, 4, 9, 14, 19)
_SOLAR_FLARE_SPAWN_INTERVAL = 0.5
_SOLAR_FLARE_MAX_LIFE = 12.0
# Every dot moves at the SAME horizontal speed; only its trail length varies.
# Near-row dots have short trails; the rare far-reaching flares (from columns
# 0-2) are long streaks that fill their whole path.
_SOLAR_FLARE_SPEED = 36.0  # cells per phase unit
_SOLAR_FLARE_FADE_LEAD = 0.8  # phase units before arrival that a far flare's tail starts fading
_SOLAR_FLARE_FADE_TIME = 1.2  # phase units the whole-length fade takes

# Damped ringing artefact near the spawn cell of flares starting on cols 0-2:
# the origin overshoots bright, the next cell undershoots dim, alternating and
# decaying over a few cells until it settles to the correct level.
_SOLAR_FLARE_RING_CELLS = 6
_SOLAR_FLARE_RING_AMPL = 1.5  # peak over/undershoot at the origin, in palette-level units
_SOLAR_FLARE_RING_DECAY = 0.6  # per-cell amplitude decay
_SOLAR_FLARE_RING = []
_ring_w = _SOLAR_FLARE_RING_AMPL
for _ring_k in range(_SOLAR_FLARE_RING_CELLS):
    _SOLAR_FLARE_RING.append(_ring_w if _ring_k % 2 == 0 else -_ring_w)
    _ring_w *= _SOLAR_FLARE_RING_DECAY
_SOLAR_FLARE_RING = tuple(_SOLAR_FLARE_RING)


def _solar_flare_events(phase: float):
    """Yield deterministic flares active at ``phase``.

    Each flare = (spawn_time, spawn_col, dist): it ignites on the top row and
    streaks right (wrapping to the next row's left edge) at the shared speed as
    a bright head with a fading tail. ``dist`` is how many cells it stays lit
    before fading out — the per-dot fade speed that sets how far it reaches.
    """
    interval = _SOLAR_FLARE_SPAWN_INTERVAL
    latest = math.floor(phase / interval)
    first = latest - math.ceil(_SOLAR_FLARE_MAX_LIFE / interval) - 1
    events = []
    for e in range(first, latest + 1):
        # Flares appear only at random times, not on every slot.
        if _noise(e, 211, 0) < 0.4:
            continue
        ts = e * interval + (_noise(e, 223, 0) - 0.5) * 0.4
        if ts < 0.0 or ts > phase:
            continue
        col = _SOLAR_FLARE_SPAWN_COLS[int(_noise(e, 227, 0) * 7) % 7]
        # Reach distribution: 80% stay within rows 0-2 (any column), 15% reach
        # row 3, 5% reach row 4 — only columns 0/1/2 may reach rows 3-4.
        band = _noise(e, 241, 0)
        if band < 0.80:
            low, high = col + 2, 59
        else:
            col = (0, 1, 2)[int(_noise(e, 257, 0) * 3) % 3]
            low, high = (60, 79) if band < 0.95 else (80, 99)
        reach = low + (high - low) * _noise(e, 251, 0)
        if reach < col + 2:
            reach = col + 2
        dist = reach - col
        # Near-row flares carry a short trail; the rare far-reaching flares are
        # long streaks that fill their whole path until they fade.
        if band < 0.80:
            trail = 4.0 + 16.0 * _noise(e, 263, 0) ** 2
        else:
            trail = dist
        events.append((ts, col, dist, trail))
    return events


def _render_solar_flare(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 19 as bright flares that streak right leaving fading trails."""
    levels = len(_SOLAR_FLARE_PALETTE)
    top = levels - 1
    cell_count = 100  # 5 rows x 20 cols flattened, index = row * 20 + col
    speed = _SOLAR_FLARE_SPEED

    # Canonical brightness levels (flare row 0 = ignition/top row).
    canon = [0.0] * cell_count
    for ts, col, dist, trail in _solar_flare_events(phase):
        age = phase - ts
        reach = col + dist
        reach_cell = min(int(math.floor(reach)), cell_count - 1)
        # Flares born on columns 0-2 ring: their origin cells over/undershoot.
        ring = col < 3
        if reach >= 60.0:
            # Far flares (rows 3-4): the point keeps moving while the whole tail
            # behind it already fades together, finishing just after arrival.
            growth = dist / speed
            fade_start = max(0.0, growth - _SOLAR_FLARE_FADE_LEAD)
            tail_level = top * (
                1.0 - max(0.0, age - fade_start) / _SOLAR_FLARE_FADE_TIME
            )
            if age < growth:
                head = col + speed * age
                head_cell = min(int(math.floor(head)), reach_cell)
                for pos in range(col, head_cell):
                    lvl = tail_level
                    if ring and pos - col < _SOLAR_FLARE_RING_CELLS:
                        lvl += _SOLAR_FLARE_RING[pos - col]
                    if lvl > canon[pos]:
                        canon[pos] = lvl
                if canon[head_cell] < top:
                    canon[head_cell] = top
                ramp = 3.0 + 5.0 * min(1.0, trail / 40.0)
                ramp_last = min(int(math.floor(head + ramp)), reach_cell)
                for pos in range(head_cell + 1, ramp_last + 1):
                    level = top * (1.0 - (pos - head) / ramp)
                    if level > canon[pos]:
                        canon[pos] = level
            elif tail_level > 0.0:
                for pos in range(col, reach_cell + 1):
                    lvl = tail_level
                    if ring and pos - col < _SOLAR_FLARE_RING_CELLS:
                        lvl += _SOLAR_FLARE_RING[pos - col]
                    if lvl > canon[pos]:
                        canon[pos] = lvl
            continue
        # Normal flares: a moving comet with a short fading tail. Skip once the
        # whole comet has passed `reach`.
        head = col + speed * age
        if head - trail > reach:
            continue
        last = min(int(math.floor(head)), reach_cell)
        for pos in range(col, last + 1):
            level = top * (1.0 - (head - pos) / trail)
            if ring and pos - col < _SOLAR_FLARE_RING_CELLS:
                level += _SOLAR_FLARE_RING[pos - col]
            if level > canon[pos]:
                canon[pos] = level
        # Short ramp-up gradient AHEAD of the head (3-8 cells, scaled to tail).
        ramp = 3.0 + 5.0 * min(1.0, trail / 40.0)
        ramp_last = min(int(math.floor(head + ramp)), reach_cell)
        for pos in range(last + 1, ramp_last + 1):
            level = top * (1.0 - (pos - head) / ramp)
            if level > canon[pos]:
                canon[pos] = level

    pixels = []
    for row in range(ROWS):
        for col in range(COLS):
            # Y is flipped: the ignition row is shown at the top of the panel.
            if direction == "Right":
                source = (ROWS - 1 - row) * 20 + col
            elif direction == "Left":
                # Right rotated 180 degrees.
                source = row * 20 + (COLS - 1 - col)
            elif direction == "Down":
                # Same canonical sequence, counted column-major from top-right:
                # down the rightmost column first, then the next column left.
                source = (COLS - 1 - col) * ROWS + (ROWS - 1 - row)
            else:  # Up
                # Down rotated 180 degrees.
                source = col * ROWS + row
            level = canon[source]
            if level < 0.0:
                level = 0.0
            elif level > top:
                level = float(top)
            lo = int(math.floor(level))
            frac = level - lo
            if frac <= 0.0 or lo >= top:
                pixels.append(_SOLAR_FLARE_PALETTE[lo])
            else:
                c0 = _SOLAR_FLARE_PALETTE[lo]
                c1 = _SOLAR_FLARE_PALETTE[lo + 1]
                pixels.append(
                    (
                        int(math.floor(c0[0] + (c1[0] - c0[0]) * frac + 0.5)),
                        int(math.floor(c0[1] + (c1[1] - c0[1]) * frac + 0.5)),
                        int(math.floor(c0[2] + (c1[2] - c0[2]) * frac + 0.5)),
                    )
                )

    return pixels


_EMBER_PALETTE = (
    (255, 0, 40),
    (255, 0, 28),
    (255, 3, 18),
    (255, 15, 10),
    (255, 45, 10),
    (255, 80, 14),
    (255, 120, 25),
    (255, 170, 75),
    (255, 210, 145),
)


def _render_ember(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 24's slowly evolving, direction-stretched heat field."""
    pixels = []
    for row in range(ROWS):
        for col in range(COLS):
            if direction in ("Left", "Right"):
                along = COLS - 1 - col if direction == "Left" else col
                across = ROWS - 1 - row
            else:
                along = ROWS - 1 - row if direction == "Down" else row
                across = col

            time_offset = (_noise(along + 811, across + 337, 0) - 0.5) * 1.30
            broad = _value_noise_3d(
                along,
                across * 0.40,
                phase * 0.50 + time_offset,
            )
            fine = _value_noise_3d(
                along * 1.73 + 17.2,
                across * 1.37 + 8.1,
                phase * 0.68 + time_offset * 1.9,
            )
            heat = broad * 0.85 + fine * 0.15
            heat = min(1.0, max(0.0, (heat - 0.12) / 0.70))
            heat = _smoothstep(heat)
            red, green, blue = _palette(_EMBER_PALETTE, heat)
            pixels.append(_rgb(red, green, blue, heat))

    return pixels


def _render_twinkle(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 79's independently phased purple and pink fade pulses."""
    pixels = []
    for row in range(ROWS):
        for col in range(COLS):
            if direction == "Left":
                sample_col, sample_row = COLS - 1 - col, row
            elif direction == "Down":
                sample_col, sample_row = col, ROWS - 1 - row
            else:
                sample_col, sample_row = col, row

            period = 2.02 + 0.33 * _noise(sample_col + 797, sample_row + 149, 0)
            offset = period * _noise(sample_col + 431, sample_row + 887, 0)
            local = (phase + offset) / period
            cycle = math.floor(local)
            progress = local - cycle

            hue_noise = _noise(sample_col + cycle * 37, sample_row + 1231, 4079)
            hue = 0.60 + 0.20 * hue_noise
            saturation = 0.25 + 0.62 * _noise(
                sample_col + cycle * 43,
                sample_row + 1877,
                4211,
            )
            target = 0.82 + 0.18 * _noise(
                sample_col + cycle * 47,
                sample_row + 2081,
                4253,
            )
            decay = (1.0 - progress) ** 0.48
            level = target * _smoothstep(decay)
            pixels.append(_hsv(hue, saturation, level))

    return pixels


_PALETTE_HUES = (
    0.50,
    0.52,
    0.54,
    0.56,
    0.58,
    0.60,
    0.62,
    0.64,
    0.68,
    0.72,
    0.32,
    0.38,
    0.46,
    0.04,
    0.08,
    0.12,
    0.16,
    0.78,
    0.84,
    0.88,
)


def _palette_hue(event: int) -> float:
    index = min(
        len(_PALETTE_HUES) - 1,
        int(_noise(event + 1701, 19, 0) * len(_PALETTE_HUES)),
    )
    return _PALETTE_HUES[index]


def _render_palette(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render sparse daubs horizontally and broad colour fields vertically."""
    broad = direction in ("Up", "Down")
    phase *= 1.50 if broad else 1.25
    spawn = 0.90 if broad else 0.58
    max_lifetime = 7.2 if broad else 4.8
    activity = 1.0
    if broad:
        activity_index = math.floor(phase / 4.0)
        activity_fraction = phase / 4.0 - activity_index
        activity_fraction = activity_fraction**2 * (3.0 - 2.0 * activity_fraction)
        activity_noise = _noise(activity_index + 1901, 31, 0) + (
            _noise(activity_index + 1902, 31, 0)
            - _noise(activity_index + 1901, 31, 0)
        ) * activity_fraction
        activity = 0.04 + 1.75 * activity_noise**1.3
    latest = math.floor(phase / spawn)
    events = []
    for event in range(latest - math.ceil(max_lifetime / spawn) - 2, latest + 2):
        emit = event * spawn + (_noise(event + 1201, 7, 0) - 0.5) * spawn * 0.90
        lifetime = (
            2.8 + 4.2 * _noise(event + 1301, 11, 0)
            if broad
            else 2.4 + 2.4 * _noise(event + 1301, 11, 0)
        )
        age = phase - emit
        if not 0.0 <= age < lifetime:
            continue
        progress = age / lifetime
        envelope = math.sin(math.pi * progress) ** 0.7 * activity
        if broad:
            center_x = -3.0 + 25.0 * _noise(event + 1401, 13, 0)
            center_y = -1.0 + 6.0 * _noise(event + 1501, 17, 0)
            radius_x = 2.2 + 8.6 * _noise(event + 1601, 23, 0)
            radius_y = 1.2 + 4.3 * _noise(event + 1651, 29, 0)
        else:
            center_x = 19.0 * _noise(event + 1401, 13, 0)
            center_y = 4.0 * _noise(event + 1501, 17, 0)
            radius_x = 0.75 + 2.25 * _noise(event + 1601, 23, 0)
            radius_y = 0.65 + 0.90 * _noise(event + 1651, 29, 0)
        events.append(
            (center_x, center_y, radius_x, radius_y, envelope, _palette_hue(event))
        )

    pixels = []
    reverse = direction in ("Left", "Up")
    for row in range(ROWS):
        for col in range(COLS):
            sample_col = COLS - 1 - col if reverse else col
            sample_row = ROWS - 1 - row if reverse else row
            if broad:
                sine_sum = 0.0
                cosine_sum = 0.0
                level_sum = 0.0
                for center_x, center_y, radius_x, radius_y, envelope, hue in events:
                    dx = (sample_col - center_x) / radius_x
                    dy = (sample_row - center_y) / radius_y
                    distance = math.hypot(dx, dy)
                    weight = envelope * max(0.0, 1.0 - distance) ** 1.35
                    field_hue = (hue + dx * 0.10) % 1.0
                    sine_sum += weight * math.sin(math.tau * field_hue)
                    cosine_sum += weight * math.cos(math.tau * field_hue)
                    level_sum += weight
                if level_sum <= 0.025:
                    color = BLACK
                else:
                    hue = math.atan2(sine_sum, cosine_sum) / math.tau % 1.0
                    value = min(1.0, level_sum * 1.70)
                    color = _hsv(hue, 0.88, value)
            else:
                best_level = 0.0
                best_hue = 0.0
                for center_x, center_y, radius_x, radius_y, envelope, hue in events:
                    dx = abs(sample_col - center_x) / radius_x
                    dy = abs(sample_row - center_y) / radius_y
                    distance = dx + dy
                    level = envelope * max(0.0, 1.25 - distance)
                    if level > best_level:
                        best_level = level
                        best_hue = (hue + (sample_col - center_x) * 0.018) % 1.0
                color = _hsv(best_hue, 0.92, min(1.0, best_level)) if best_level > 0.03 else BLACK
            pixels.append(color)
    return pixels


_FIREWORKS_CYCLE = 2.9
_FIREWORKS_ROCKET_SPEED = 9.0
_FIREWORKS_BURST_TIME = 0.82
_FIREWORKS_PARTICLES = 46


def _fireworks_orient(x: float, y: float, direction: str) -> tuple[float, float]:
    """Map normalized Down-direction coordinates to the selected direction."""
    u = x / (COLS - 1)
    v = y / (ROWS - 1)
    if direction == "Up":
        u, v = 1.0 - u, 1.0 - v
    elif direction == "Right":
        u, v = v, 1.0 - u
    elif direction == "Left":
        u, v = 1.0 - v, u
    return u * (COLS - 1), v * (ROWS - 1)


def _render_fireworks(
    phase: float,
    direction: str,
) -> list[tuple[int, int, int]]:
    """Render mode 10 as a white rocket followed by a confetti burst."""
    event = int(math.floor(phase / _FIREWORKS_CYCLE))
    age = phase - event * _FIREWORKS_CYCLE
    target_x = 1.5 + 16.0 * _noise(event, 701, 10)
    target_y = 1.2 + 2.7 * _noise(event, 709, 10)
    distance = math.hypot(19.0 - target_x, target_y)
    launch_time = distance / _FIREWORKS_ROCKET_SPEED
    levels = [(0.0, 0.0, 0.0)] * (ROWS * COLS)

    def add(x: float, y: float, color: tuple[int, int, int], strength: float) -> None:
        x, y = _fireworks_orient(x, y, direction)
        col = int(math.floor(x + 0.5))
        row = int(math.floor(y + 0.5))
        if not (0 <= col < COLS and 0 <= row < ROWS):
            return
        index = row * COLS + col
        candidate = tuple(channel * strength for channel in color)
        if sum(candidate) > sum(levels[index]):
            levels[index] = candidate

    if age < launch_time:
        travel = age / launch_time if launch_time > 0.0 else 1.0
        x = 19.0 + (target_x - 19.0) * travel
        y = target_y * travel
        add(x, y, (235, 250, 255), 1.0)
        if travel > 0.04:
            previous = max(0.0, travel - 0.035)
            add(
                19.0 + (target_x - 19.0) * previous,
                target_y * previous,
                (110, 205, 255),
                0.42,
            )
    else:
        burst_age = age - launch_time
        if burst_age < _FIREWORKS_BURST_TIME:
            fade = min(1.0, (_FIREWORKS_BURST_TIME - burst_age) / 0.28)
            for particle in range(_FIREWORKS_PARTICLES):
                angle = math.tau * _noise(event, particle, 727)
                radial = 4.5 + 14.5 * _noise(event, particle, 733)
                velocity_x = math.cos(angle) * radial
                velocity_y = math.sin(angle) * (2.0 + radial * 0.30)
                x = target_x + velocity_x * burst_age
                y = target_y + velocity_y * burst_age - 4.8 * burst_age * burst_age
                hue = _noise(event, particle, 739)
                value = fade * (0.78 + 0.22 * _noise(event, particle, 743))
                add(x, y, _hsv(hue, 0.94, value), 1.0)

    return [
        (
            max(0, min(255, int(math.floor(red + 0.5)))),
            max(0, min(255, int(math.floor(green + 0.5)))),
            max(0, min(255, int(math.floor(blue + 0.5)))),
        )
        for red, green, blue in levels
    ]


def render_native_effect(
    effect: str,
    phase: float,
    direction: str = "Up",
) -> list[tuple[int, int, int]]:
    """Return one animated 20x5 approximation of a firmware effect."""
    if effect == "Fireworks":
        return _render_fireworks(phase, direction)
    if effect == "Magic":
        return _render_magic(phase)
    if effect == "Wonderland":
        return _render_wonderland(phase)
    if effect == "Flower Sea":
        return _render_flower_sea(phase, direction)
    if effect == "Kaleidoscope":
        return _render_kaleidoscope(phase, direction)
    if effect == "Blue Yellow":
        return _render_blue_yellow(phase, direction)
    if effect == "Ice Blue":
        return _render_ice_blue(phase, direction)
    if effect == "Sunset":
        return _render_sunset(phase, direction)
    if effect == "Carousel":
        return _render_carousel(phase, direction)
    if effect == "Spectrum Chase":
        return _render_spectrum_chase(phase, direction)
    if effect == "Pastel Pulse":
        return _render_pastel_pulse(phase, direction)
    if effect == "Solar Flare":
        return _render_solar_flare(phase, direction)
    if effect == "Ember":
        return _render_ember(phase, direction)
    if effect == "Twinkle":
        return _render_twinkle(phase, direction)
    if effect == "Spectrum Crumble":
        return _render_spectrum_crumble(phase, direction)
    if effect == "Blue White":
        return _render_blue_white(phase, direction)
    if effect == "Palette":
        return _render_palette(phase, direction)

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
                ripple = (math.sin((dist * 1.0 - phase * 0.5) * math.tau) + 1.0) / 2.0
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
                if direction in ("Down", "Up"):
                    if row < 1 or row > 3:
                        color = BLACK
                    else:
                        cells, shades, width = _hacking_strip()
                        offset = math.floor(phase * 1.5)
                        down = direction == "Down"
                        if down:
                            x = (col + offset) % width
                            gr = row - 1
                            entry_col = COLS - 1
                            exit_pos = offset % width
                        else:
                            x = (offset - col) % width
                            gr = 3 - row
                            entry_col = 0
                            exit_pos = (offset - (COLS - 1)) % width
                        # Hardware artefact: while a character is still scrolling
                        # in, the entry-edge column lights all 3 rows, tinted with
                        # the shade of the character leaving the opposite edge.
                        if col == entry_col and x % 5 <= 2:
                            color = shades[exit_pos] or BLACK
                        else:
                            color = cells[gr * width + x] or BLACK
                else:
                    head = (phase * 0.8 + _noise(col, 0, 0)) % 1.0
                    distance = ((head - u) % 1.0 + 1.0) % 1.0
                    level = 1.0 if distance < 0.08 else max(0.04, 0.65 - distance * 1.8)
                    color = _rgb(25, 255, 85, level)
            else:
                color = _hsv(x + phase * 0.05, 0.8, 0.35 + 0.65 * wave)

            pixels.append(color)

    return pixels
