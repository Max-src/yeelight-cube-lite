"""What the lamp's built-in renderers share, for the renderers in
lamp_effects_<family>.py: they match what the lamp draws, frame for frame.
Mirrors www/lamp-core.js exactly.

Written for speed: the arithmetic is the lamp's, the data is flat. A colour is
(r, g, b); a strip, a grid or a frame is 300 bytes (a bytearray for what
changes in place), r, g, b by pixel:

- a logical strip or grid: pixel r * W + c of the segment geometry W x H;
- a panel: the lamp's buffer, column-major, by index p (what step returns);
- a lamp frame: row-major, row 0 = the bottom (what the integration uses).

The segment is always the lamp's full 100 pixels, on mount profile 2 (see
lamp_renderers.py), at brightness 255, where the pixel writer stores what
it is given: the lamp's partial-segment, mixer and dimming paths do not
apply here. lamp_renderers.py explains LED drive against screen colors.
"""

from __future__ import annotations

import math
import struct

try:
    from .mount_profile import DIRECTION_TABLE, REFERENCE_PROFILE
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from mount_profile import DIRECTION_TABLE, REFERENCE_PROFILE

LENGTH = 100
COLS = 20
ROWS = 5
# The lamp's render cadence: two 10 ms ticks per pass, a render every 40 ms.
RENDER_SECONDS = 0.040
RENDER_MS = 40

U32 = 0xFFFFFFFF
_F32 = struct.Struct("<f")
_U32_BITS = struct.Struct("<I")


# ── 8/16-bit maths ──────────────────────────────────────────────────────
def f32(value: float) -> float:
    """``value`` rounded to binary32, as the lamp's float maths."""
    try:
        return _F32.unpack(_F32.pack(value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def f32_bits(value: float) -> int:
    return _U32_BITS.unpack(_F32.pack(value))[0]


def f32_from_bits(bits: int) -> float:
    return _F32.unpack(_U32_BITS.pack(bits & U32))[0]


def trunc_u16(value: float) -> int:
    """C's (uint16_t)(int)value: toward zero, NaN and infinities as 0."""
    return int(value) & 0xFFFF if math.isfinite(value) else 0


def f32_trunc(value: float) -> int:
    """Toward zero, NaN as 0."""
    return 0 if math.isnan(value) else int(value)


def sx8(value: int) -> int:
    """A byte as signed."""
    return ((value & 255) ^ 128) - 128


def scale8(value: int, scale: int) -> int:
    """The lamp's scale8: no + 1."""
    return ((value & 255) * scale) >> 8


def triangle16(value: int) -> int:
    return (((value & 65535) << 1) ^ (0x1FFFF if value & 32768 else 0)) & 65535


def lround(value: float) -> int:
    """libm's lround: half away from zero."""
    return -math.floor(-value + 0.5) if value < 0 else math.floor(value + 0.5)


_SINE_TABLE = (0, 49, 49, 41, 90, 27, 117, 10)


def _sin8(theta: int) -> int:
    offset = (255 - theta if theta & 64 else theta) & 63
    secoffset = (offset & 15) + (1 if theta & 64 else 0)
    section = offset >> 4
    y = _SINE_TABLE[2 * section] + ((_SINE_TABLE[2 * section + 1] * secoffset) >> 4)
    return (128 - y if theta & 128 else 128 + y) & 255


# FastLED's sin8_C, by angle byte.
SIN8 = bytes(_sin8(theta) for theta in range(256))


def sin8(theta: int) -> int:
    return SIN8[theta & 255]


_SIN16_SLOPE = (49, 48, 44, 38, 31, 23, 14, 4)
_SIN16_BASE = (0, 6393, 12539, 18204, 23170, 27245, 30273, 32137)


def sin16_unsigned(theta: int) -> int:
    """FastLED's sin16 + 32768."""
    offset = (theta >> 3) & 0x7FF
    if theta & 0x4000:
        offset ^= 0x7FF
    section = offset >> 8
    value = ((offset >> 1) & 0x7F) * _SIN16_SLOPE[section] + _SIN16_BASE[section]
    return ((-value if theta & 0x8000 else value) ^ 0x8000) & 0xFFFF


def bpm88(value: int) -> int:
    """A beat speed as 8.8: value << 8 below 256, else mod 65536 (a negative
    value wraps to a fast beat)."""
    return value << 8 if 0 <= value < 256 else value & 65535


def beat(clock: int, speed: int) -> int:
    """FastLED's sin8(beat8) at ``clock``, ``speed`` from bpm88."""
    return SIN8[(((clock & U32) * speed * 280) & U32) >> 24]


_ENVELOPE_BASES = (0, 6393, 12539, 18204, 23170)
_ENVELOPE_SLOPES = (49, 48, 44, 38, 31)


def envelope_gain(time: int, rate: int) -> int:
    phase = ((time * ((rate >> 3) + 10)) & U32) >> 2 & 16383
    folded = min(phase, 16384 - phase) >> 3
    section = folded >> 8
    return (_ENVELOPE_BASES[section] + ((folded >> 1) & 127) * _ENVELOPE_SLOPES[section]) // 103 + 10


# ── Noise ───────────────────────────────────────────────────────────────
# FastLED's permutation table, as the lamp uses it (inoise8_raw).
_NOISE_TABLE = (
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
    140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
    247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
    57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
    74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
    60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
    65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
    200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
    52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
    207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
    119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
    129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
    218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
    81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
    184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
    222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
    151,
)


def _noise_int8(value: int) -> int:
    value &= 255
    return value - 256 if value & 128 else value


def _noise_ease(value: int) -> int:
    mirrored = 255 - value if value & 128 else value
    doubled = (scale8(mirrored, mirrored) << 1) & 255
    return 255 - doubled if value & 128 else doubled


def _noise_lerp(start: int, end: int, fraction: int) -> int:
    if end > start:
        return _noise_int8(start + scale8(end - start, fraction))
    return _noise_int8(start - scale8(start - end, fraction))


def _noise_grad(number: int, x: int, y: int, z: int) -> int:
    number &= 15
    u = y if number & 8 else x
    v = y if number < 4 else (x if number in (12, 14) else z)
    if number & 1:
        u = _noise_int8(-u)
    if number & 2:
        v = _noise_int8(-v)
    return _noise_int8(((u + v) >> 1) + (u & 1))


def inoise8_raw(x: int, y: int, z: int) -> int:
    """FastLED's 3-D 8-bit noise, as the lamp runs it."""
    table = _NOISE_TABLE
    a = (table[x >> 8] + (y >> 8)) & 255
    aa, ab = (table[a] + (z >> 8)) & 255, (table[a + 1] + (z >> 8)) & 255
    b = (table[(x >> 8) + 1] + (y >> 8)) & 255
    ba, bb = (table[b] + (z >> 8)) & 255, (table[b + 1] + (z >> 8)) & 255
    u, v, w = _noise_ease(x & 255), _noise_ease(y & 255), _noise_ease(z & 255)
    xx, yy, zz = (x & 255) >> 1, (y & 255) >> 1, (z & 255) >> 1
    nx, ny, nz = _noise_int8(xx - 128), _noise_int8(yy - 128), _noise_int8(zz - 128)
    x1 = _noise_lerp(_noise_grad(table[aa], xx, yy, zz), _noise_grad(table[ba], nx, yy, zz), u)
    x2 = _noise_lerp(_noise_grad(table[ab], xx, ny, zz), _noise_grad(table[bb], nx, ny, zz), u)
    x3 = _noise_lerp(_noise_grad(table[aa + 1], xx, yy, nz), _noise_grad(table[ba + 1], nx, yy, nz), u)
    x4 = _noise_lerp(_noise_grad(table[ab + 1], xx, ny, nz), _noise_grad(table[bb + 1], nx, ny, nz), u)
    return _noise_lerp(_noise_lerp(x1, x2, v), _noise_lerp(x3, x4, v), w)


def _noise_grad_2d(number: int, x: int, y: int) -> int:
    u, v = (y, x) if number & 4 else (x, y)
    if number & 1:
        u = _noise_int8(-u)
    if number & 2:
        v = _noise_int8(-v)
    return _noise_int8(((u + v) >> 1) + (u & 1))


def inoise8_raw_2d(x: int, y: int) -> int:
    """The 2-D noise over the same table."""
    table = _NOISE_TABLE
    a = (table[x >> 8] + (y >> 8)) & 255
    b = (table[(x >> 8) + 1] + (y >> 8)) & 255
    aa, ab, ba, bb = table[a], table[a + 1], table[b], table[b + 1]
    u, v = _noise_ease(x & 255), _noise_ease(y & 255)
    xx, yy = (x & 255) >> 1, (y & 255) >> 1
    nx, ny = _noise_int8(xx - 128), _noise_int8(yy - 128)
    first = _noise_lerp(_noise_grad_2d(table[aa], xx, yy), _noise_grad_2d(table[ba], nx, yy), u)
    second = _noise_lerp(_noise_grad_2d(table[ab], xx, ny), _noise_grad_2d(table[bb], nx, ny), u)
    return _noise_lerp(first, second, v)


def noise_heat(noise: int) -> int:
    return min(255, ((noise + 64) & 255) << 1)


# ── Random source ───────────────────────────────────────────────────────
def source_word(draw: int) -> int:
    """Stand-in for the lamp's hardware random source (an integer hash of
    the draw number). Not the lamp's behaviour: its values are not known. A
    renderer counts its own draws from 0, in state."""
    value = ((draw ^ 0x5BD1E995) * 0x9E3779B1) & U32
    value ^= value >> 15
    value = (value * 0x85EBCA6B) & U32
    value ^= value >> 13
    return value


def random_source(draw: int) -> int:
    """The low byte of source_word."""
    return source_word(draw) & 255


# ── Colour converter ────────────────────────────────────────────────────
# The lamp's converter, type 0, as the lamp starts up: full scale 255, scale
# 1.0, mode 0, limiter off, curve exponents 0. The LUT turns a byte into linear
# light; _CALIBRATION is the lamp's calibration table.
_LUT = struct.unpack(">256f", bytes.fromhex(
    "00000000399f22b33a967ecd3aae06ed3ac793a93ae330d43b0074933b1064773b216d97"
    "3b3394773b46df1a3b5b51a03b70f1923b83e2293b8fe6453b9c88103ba9c9fe3bb7ad85"
    "3bc6354f3bd563693be539c63bf5bafc3c0373db3c0c61653c15a70c3c1f45e53c293e79"
    "3c3391fc3c3e41563c494d453c54b7323c607ef23c6ca6053c792d373c830ae03c89afba"
    "3c9085e73c978dc93c9ec7c43ca634373cadd4003cb5a65c3cbdac5d3cc5e6613cce54c4"
    "3cd6f7e43cdfd06f3ce8ddf03cf2214d3cfb9ad43d02a56f3d0798e03d0ca7ec3d11d2b3"
    "3d1719683d1c7cab3d21fb9c3d2796fa3d2d4ef03d3323a73d3915473d3f23f73d454fdf"
    "3d4b996e3d5200213d5884893d5f26c93d65e7083d6cc5693d73c2123d7add3a3d810b69"
    "3d84b7963d8873893d8c3e903d90192d3d9403703d97fd6a3d9c072e3da020cd3da44a58"
    "3da883e03daccdb93db1275c3db591363dba0b523dbe95c43dc3309b3dc7dbe73dcc97b9"
    "3dd164213dd6413a3ddb2ef33de02d793de53d823dea5da93def8ecd3df4d0f63dfa243b"
    "3dff88a53e027f233e0542973e080eb53e0ae3863e0dc1113e10a7a63e1396ab3e168e83"
    "3e198f353e1c98c83e1fab443e22c6b03e25eb133e2918733e2c4ed73e2f8e473e32d6c9"
    "3e3628733e3983273e3ce7083e40541a3e43caf63e474a683e4ad3203e4e65243e52007c"
    "3e55a52e3e5953413e5d0abb3e60cba43e6496023e6869db3e6c47363e702e1f3e741e92"
    "3e7819123e7c1ca23e8014ec3e82205e3e8430a83e8645cf3e885fd53e8a7ebd3e8ca28c"
    "3e8ecb433e90f8e53e932b773e9562fa3e979f723e99e0e33e9c27583e9e72bc3ea0c324"
    "3ea318923ea573093ea7d28e3eaa371a3eaca0b73eaf0f6a3eb183b53eb3fc8d3eb67a80"
    "3eb8fd933ebb85cb3ebe13293ec0a5b03ec33d643ec5da483ec87c5d3ecb23a83ecdd02a"
    "3ed081e83ed338e33ed5f51e3ed8b69d3edb7d623ede49703ee11b313ee3f1cb3ee6cdb8"
    "3ee9aefa3eec95953eef818c3ef272e03ef569943ef865ac3efb672a3efe6e103f00bd32"
    "3f0246123f03d1aa3f055ffb3f06f1093f0884d23f0a1b583f0bb4ab3f0d50ab3f0eef6e"
    "3f1090f53f1235413f13dc533f15862d3f1733413f18e2a33f1a94d03f1c49ca3f1e0191"
    "3f1fbc293f2179903f2339ca3f24fcd63f26c2b73f288b6e3f2a56fb3f2c25613f2df6a0"
    "3f2fcab93f31a1b03f337b833f3558343f3737c53f391a363f3aff8a3f3ce7c13f3ed33d"
    "3f40c1333f42b2113f44a5d93f469c8b3f4896283f4a92b23f4c922a3f4e94913f5099e9"
    "3f52a2313f54ad6d3f56bb9c3f58ccc03f5ae0d93f5cf7eb3f5f11f43f612ef73f634ef3"
    "3f6571ee3f6797e53f69c0dc3f6becce3f6e1bc53f704dca3f7282bf3f74bab53f76f5b6"
    "3f7933ba3f7b74cb3f7db8e03f800000"
))
_CALIBRATION = bytes.fromhex(
    "81980840cae2debe1d6fa3be23435bbf54cff23f1a55e1bcb7b75b3d57d1fabd83c7043f"
    "769bb3bfbc596b3ffc5e9f3fc05ec1bd526071bec4e2f13e9c09a941d8ef2fc036ae39bf"
    "64194f3f0f8ddc3e302d6a3c72f92f3fc0ec9e3e0bb5263ed3de303f39b4083ee10b933d"
    "5dfec33eb8afc33e9a19e442e1ba90432f1dab4200000000000000000000000000000000"
    "00000000000000000000000001000000"
)
_FULL_SCALE = 255
_FLOOR = _FULL_SCALE * 0.003


def _calibration(offset: int) -> float:
    return _F32.unpack_from(_CALIBRATION, offset)[0]


_X_WEIGHTS = (0.4124000072479248, 0.35760000348091125, 0.18050000071525574)
_Y_WEIGHTS = (0.2125999927520752, 0.7152000069618225, 0.0722000002861023)
_Z_WEIGHTS = (0.019300000742077827, 0.11919999867677689, 0.9505000114440918)
# Near a primary (channel, centre x, centre y, limit).
_NEAR = (
    (0, 0.6399999856948853, 0.33000001311302185, 0.01),
    (1, 0.30000001192092896, 0.6000000238418579, 0.005),
    (2, 0.15000000596046448, 0.05999999865889549, 0.01),
)
_EDGES = {
    "gb": (_calibration(60), _calibration(64), _calibration(84), _calibration(88)),
    "rg": (_calibration(68), _calibration(72), _calibration(100), _calibration(104)),
    "rb": (_calibration(76), _calibration(80), _calibration(92), _calibration(96)),
}
_CONVERTED: dict[int, tuple[int, int, int]] = {}
_CONVERTED_LIMIT = 1 << 16


def _distance(value: float, centre: float) -> float:
    high = f32(centre - value)
    return high if high > 0 else f32(value + -centre)


def _keep(value: float, floor: float) -> float:
    return value if value >= floor else floor


def gamut_words(x: float, y: float, scalar: float) -> list:
    """The lamp's gamut mapping on its calibration table, then the output
    stage: the three unrounded output values."""
    x0, y0 = x, y

    def clip(edge):
        nonlocal x, y
        slope, intercept, xr, yr = _EDGES[edge]
        reference = f32(f32(f32(slope * xr) + intercept) - yr)
        here = f32(f32(f32(x * slope) + intercept) - y)
        if f32(here * reference) > 0:
            return
        x = f32(xr + f32(f32(f32(x - xr) * reference) / f32(reference - here)))
        y = f32(intercept + f32(slope * x))

    def side(slope, intercept):
        return f32(y0 - f32(f32(x0 * slope) + intercept))

    clip("gb")
    clip("rg")
    clip("rb")
    if side(_calibration(44), _calibration(48)) > 0:
        sector = "rg" if side(_calibration(36), _calibration(40)) > 0 else "gb"
    else:
        sector = "rg" if side(_calibration(52), _calibration(56)) > 0 else "rb"
    outside = f32(_EDGES[sector][0] * side(_EDGES[sector][0], _EDGES[sector][1]))
    if outside < 0 if sector == "rg" else outside > 0:
        clip(sector)
    z = f32(f32(1 - x) - y)

    def row(start):
        return _keep(f32(f32(f32(_calibration(start) * x) + f32(_calibration(start + 4) * y))
                         + f32(_calibration(start + 8) * z)), 0)

    channels = [row(0), row(12), row(24)]
    total = f32(channels[2] + f32(channels[0] + channels[1]))
    channels = [f32(value / total) for value in channels]
    normal = f32(1 / _keep(_keep(_keep(channels[0], channels[1]), channels[2]), 0))
    channels = [_keep(f32(value * normal), 0) for value in channels]
    # Brightness, full scale, the floor at FS * 0.003, the output curve.
    out = []
    for index, value in enumerate(channels):
        value = f32(f32(scalar * value) * _FULL_SCALE)
        if value < _FLOOR:
            value = 0
        exponent = _calibration(132 + 4 * index)
        if exponent != 0:
            ratio = f32(value / _FULL_SCALE)
            if ratio == 0:
                value = 0
            else:
                power = exponent / 100
                value = f32(_FULL_SCALE * f32(f32(power) - f32(f32(power - 1) * ratio)))
        out.append(value)
    return out


def _round_word(value: float) -> int:
    return min(int(value + 0.49), U32)


def _pack(words) -> tuple[int, int, int]:
    packed = ((words[0] << 16) | (words[1] << 8) | words[2]) & U32
    return (packed >> 16) & 255, (packed >> 8) & 255, packed & 255


def _convert(red: int, green: int, blue: int) -> tuple[int, int, int]:
    if not (red | green | blue):  # black: nothing to convert
        return (0, 0, 0)
    level = min((max(red, green, blue) * 100) >> 8, 100)
    scalar = 0 if level == 0 else f32(f32(level) / 100)

    def shortcut(channel):
        lit = _round_word(f32(scalar * _FULL_SCALE))
        return _pack([lit if index == channel else 0 for index in range(3)])

    word = (red << 16) | (green << 8) | blue
    if word in (0xFF0000, 0x00FF00, 0x0000FF):
        return shortcut((0xFF0000, 0x00FF00, 0x0000FF).index(word))
    r, g, b = _LUT[red], _LUT[green], _LUT[blue]
    y_sum = f32(f32(f32(_Y_WEIGHTS[0] * r) + f32(_Y_WEIGHTS[1] * g)) + f32(_Y_WEIGHTS[2] * b))
    x_sum = f32(f32(f32(_X_WEIGHTS[0] * r) + f32(_X_WEIGHTS[1] * g)) + f32(_X_WEIGHTS[2] * b))
    total = f32(f32(f32(f32(_Z_WEIGHTS[0] * r) + f32(_Z_WEIGHTS[1] * g)) + f32(_Z_WEIGHTS[2] * b))
                + f32(x_sum + y_sum))
    inverse = f32(1 / total)
    x, y = f32(x_sum * inverse), f32(y_sum * inverse)
    for channel, centre_x, centre_y, limit in _NEAR:
        if _distance(x, centre_x) < limit and _distance(y, centre_y) < limit:
            return shortcut(channel)
    return _pack([_round_word(value) for value in gamut_words(x, y, scalar)])


def convert_colour(colour) -> tuple[int, int, int]:
    """An RGB colour as the LED drive the lamp's converter gives it."""
    red, green, blue = colour[0], colour[1], colour[2]
    key = (red << 16) | (green << 8) | blue
    out = _CONVERTED.get(key)
    if out is None:
        if len(_CONVERTED) >= _CONVERTED_LIMIT:
            _CONVERTED.clear()
        out = _CONVERTED[key] = _convert(red, green, blue)
    return out


def hue_colour(hue: int) -> tuple[int, int, int]:
    """The full-saturation six-way switch of modes 75 to 77 (binary32): the
    converter's input, not yet LED drive."""
    sector = f32(f32(hue) / 60)
    index = math.floor(sector)
    fraction = f32(sector - index)
    rising, falling = f32(1 - (1 - fraction)), f32(1 - fraction)
    sides = (
        (1, rising, 0), (falling, 1, 0), (0, 1, rising),
        (0, falling, 1), (rising, 0, 1), (1, 0, falling),
    )
    return tuple(int(f32(value * 255)) for value in sides[index])


_HUE_DRIVE: list = [None] * 360


def hue_drive(hue: int) -> tuple[int, int, int]:
    """hue_colour through the converter, for a whole hue 0-359."""
    out = _HUE_DRIVE[hue]
    if out is None:
        out = _HUE_DRIVE[hue] = convert_colour(hue_colour(hue))
    return out


# LED drive as a screen colour: each row is X, Y or Z of the three LEDs' drive,
# from the inverse of the lamp's calibration matrix; the luminance of the
# lamp's converted white (252, 213, 100) is shown as the screen's white.
_LED_PRIMARIES = (
    (0.5163387415092199, 0.1394859134207411, 0.32517009647950995),
    (0.2331561508620735, 0.5919583299750346, 0.17488550127746175),
    (0.0016524911553138474, 0.12534883680422795, 1.9356753294369915),
)
_LED_WHITE_LUMINANCE = 202.33102442967106
_XYZ_TO_LINEAR_SRGB = (
    (3.2404542, -1.5371385, -0.4985314),
    (-0.9692660, 1.8760108, 0.0415560),
    (0.0556434, -0.2040259, 1.0572252),
)


def led_appearance(drive) -> tuple[int, int, int]:
    """LED drive as an sRGB screen color: the additive mix of the three LEDs
    (colors outside sRGB are clipped). Display only: a dim value looks far
    brighter on an LED than the same number on a screen, so a frame painted as
    it is looks dark. Never give the result to the power estimate."""
    red, green, blue = drive[0], drive[1], drive[2]
    if not (red or green or blue):
        return (0, 0, 0)
    xyz = [row[0] * red + row[1] * green + row[2] * blue for row in _LED_PRIMARIES]
    linear = [
        max(0.0, (row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]) / _LED_WHITE_LUMINANCE)
        for row in _XYZ_TO_LINEAR_SRGB
    ]
    peak = max(linear)
    if peak > 1:
        linear = [value / peak for value in linear]
    return tuple(
        math.floor(
            255 * (12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055)
            + 0.5
        )
        for value in linear
    )


# ── Palettes ────────────────────────────────────────────────────────────
PALETTE_SOURCES = {
    0: "ff0000 cf3000 9f6000 6f9000 3fc000 0ff000 00de21 00ae51 007e81 004eb1 001ee1 1200ed "
       "4200bd 72008d a2005d d2002d",
    12: "ff0000 ff2a00 ff7f00 ffaa00 ffd500 ffff00 d5ff00 aaff00 7fff00 00ff55 00ff7f 00ffaa "
        "00ffd5 00d5ff 00aaff 007fff 0055ff 002aff",
    13: "ffdfb3 fecfa3 fdbf92 fcaf82 fb9f71 fa8f61 f97f51 f96f41 f85f30 f74f20 f63f10 f52f00 "
        "e51f00 d51f00 c51f00 b51f00 a51f00 951f00",
    14: "28bdff 28d3ff 28e9ff 28fefa 28ffe6 28ffcd 28ffb3 28ff99 28ff7f 28ff66 75ff28 c3ff28 "
        "ddff28 f7ff28 ffea28 ffd428 ffbf28 ffaa28",
    32: "8080fc 9e53ff e574ff ffa55c ff941d",
    3: "000000 200400 400800 800600 ff0c00 921902 ae3308 bc4c17 ff6626 ff6626 ff6626 ff663a "
       "ff7f50 ff7f70 ff7f75 ff997f",
    4: "000001 000033 000066 000099 0000cc 0000ff 0033ff 0066ff 0099ff 00ccff 00ffff 00ffff "
       "00ffff 00ffff 00ffff 00ffff",
    10: "001100 003300 006600 009900 00cc00 00ff00 33ff00 66ff00 0099ff 00ccff 00ffff 00ffff "
        "00ffff 00ffff 00ffff 00ffff",
    5: "93fafa 71dffb 4dc2fc 32acfd 1192ff 1574ff 3559ff 573cff 6c2aff 8a11ff a906e2 bb0eb4 "
       "c4129c d31976 e52246 fe2d05",
    6: "ffffff adfffa 5efff6 00fff0 01baf5 017df9 014dfd 0029ff 5015ff 8c05ff d504e9 ff06d7 "
       "ff0c99 ff1616 ff6632 ffdb59",
}
# The lamp's per-mode palette table: the palette of modes 11..45, over the preset's.
MODE_PALETTES = {11: 4, 15: 10, 18: 3, 19: 3, 24: 3, 30: 6, 34: 3, 37: 2, 41: 5, 42: 4, 43: 5, 44: 5, 45: 6}
# Copied as they are; the others go through the converter.
_DIRECT_PALETTES = (0, 2, 3, 4, 10)
# The renderers that sample the palette R+32 (mode 3 at intensity >= 128 only).
LAMP_PALETTE_MODES = frozenset({
    16, 21, 22, 31, 14, 24, 3, 4, 7, 9, 15, 17, 18, 19, 20, 25, 26, 30, 34, 35, 37, 39,
    41, 42, 43, 44, 45, 47, 48, 51, 60, 70, 73, 74, 80, 81,
})
# The palette field of a command, for the modes that do not sample R+32 (the
# integration never sends one: the generator's fixed value).
LAB_PALETTE = ((255, 86, 61), (255, 208, 68), (38, 205, 148), (66, 123, 244))
_BLACK_TAIL = ((0, 0, 0), (0, 0, 0))


def primary_ramp(primary) -> list:
    """Selector 8's palette: 16 steps up to the primary."""
    return [
        tuple(channel if index == 15 else (channel * 17 * index) >> 8 for channel in primary)
        for index in range(16)
    ]


def native_palette(selector: int, mode: int) -> list:
    """The palette a mode samples under a preset's colour selector."""
    keeps = selector in (8, 9) or 22 <= selector <= 31
    chosen = MODE_PALETTES.get(mode, selector) if not keeps else selector
    if chosen == 8:
        return primary_ramp(convert_colour((255, 255, 255)))
    colours = [
        (int(text[:2], 16), int(text[2:4], 16), int(text[4:], 16))
        for text in PALETTE_SOURCES[0 if chosen == 2 else chosen].split()
    ]
    return colours if chosen in _DIRECT_PALETTES else [convert_colour(colour) for colour in colours]


def palette_span(count: int) -> int:
    return ((255 * count - 255) // count) & 255


def sample_palette(palette, index: int, tail=None):
    """The lamp's palette sampler: None past a palette's known entries (a
    5-colour palette at 255; 18 colours read black there)."""
    if tail is None:
        tail = _BLACK_TAIL if len(palette) == 18 else ()
    count = len(palette)
    width = 256 // count
    slot, remainder = divmod(index & 255, width)

    def stored(entry):
        if entry < count:
            return palette[entry]
        return tail[entry - count] if entry - count < len(tail) else None

    current = stored(slot)
    if current is None:
        return None
    if not remainder:
        return tuple(current)
    following = palette[0] if slot == count - 1 else stored(slot + 1)
    if following is None:
        return None
    weight = remainder * 255 // width
    return tuple(
        ((channel * (255 - weight)) >> 8) + ((other * weight) >> 8)
        for channel, other in zip(current, following)
    )


def palette_table(palette, tail=None) -> bytes:
    """sample_palette for every index: 256 colours, flat. An unknown sample
    is black, which no fixture reaches."""
    table = bytearray(768)
    for index in range(256):
        colour = sample_palette(palette, index, tail)
        if colour is not None:
            table[3 * index:3 * index + 3] = bytes(colour)
    return bytes(table)


# ── A command's colours ─────────────────────────────────────────────────
# Settings: the fields of a set_fx_effect the renderers read, as the fixture
# has them: mode, selector (the base preset's), intensity, rate, direction
# (raw, 0-3), primary [r, g, b] and coloured (a color key was sent).
_WORDLESS_MODES = frozenset({
    6, 27, 38, 46, 52, 53, 54, 55, 56, 57, 58, 59, 64, 65, 66, 67, 68, 69, 75, 76, 77,
})
_COLOURS: dict[tuple, dict] = {}
_COLOURS_LIMIT = 64


def installed_words(settings) -> list:
    """Colour words R+536..R+548, converted: the colors this component sends
    (one, or the list of const._EXTENDED_EFFECT_COLORS), 0 past them; with no
    color key the lamp sets all four to 0xffffffff, so white."""
    mode, coloured = settings["mode"], settings["coloured"]
    if mode in _WORDLESS_MODES or not coloured:
        return [convert_colour((255, 255, 255))] * 4
    words = [convert_colour(tuple(colour)) for colour in settings.get("colours", ())[:4]]
    if words:
        return words + [(0, 0, 0)] * (4 - len(words))
    return [convert_colour(tuple(settings["primary"]))] + [(0, 0, 0)] * 3


def effect_colours(settings) -> dict:
    """What the renderer preparation gives a command: primary and secondary,
    all four words, the palette and its sampled table. Shared: not to be
    changed."""
    mode, selector, intensity = settings["mode"], settings["selector"], settings["intensity"]
    coloured, primary = settings["coloured"], tuple(settings["primary"])
    key = (
        mode, selector, intensity >= 128, coloured, primary,
        tuple(map(tuple, settings.get("colours", ()))),
        tuple(map(tuple, settings.get("palette", ()))),
    )
    out = _COLOURS.get(key)
    if out is not None:
        return out
    words = installed_words(settings)
    palette_mode = mode in LAMP_PALETTE_MODES and not (mode == 3 and intensity < 128)
    if palette_mode and settings.get("palette"):
        # A music mode's own palette (lamp_renderers.music_palette).
        palette = [convert_colour(tuple(colour)) for colour in settings["palette"]]
    elif palette_mode:
        palette = primary_ramp(words[0]) if coloured or selector == 8 else native_palette(selector, mode)
    elif mode in (8, 28):
        palette = list(words)  # already converted: its four band colors
    else:
        palette = list(LAB_PALETTE)
    out = {
        "primary": words[0],
        "secondary": words[1],
        "words": words,
        "palette": palette,
        "table": palette_table(palette),
    }
    if len(_COLOURS) >= _COLOURS_LIMIT:
        _COLOURS.clear()
    _COLOURS[key] = out
    return out


# ── The demo beat ─────────────────────────────────────────────────────────
# The music slots draw what the lamp's microphone hears, which nothing here can
# know, and a silent room leaves most of them dark. Their previews run the
# lamp's own renderers on this fixed beat instead: the renderer is exact,
# the sound is a stand-in, so a music preview shows how an effect reacts, not
# what the lamp is showing now. About 125 beats a minute, a 7.7 s loop.
DEMO_BEAT_RENDERS = 12
DEMO_LOOP_RENDERS = 192
DEMO_ONSET = 96


def demo_sound(render: int) -> tuple:
    """(level, onset, sync tick, the 16 spectrum bands) a render reads: the
    bytes of a music packet. Bands 0-3 kick, 4-10 a melody, 11-15 hats."""
    render %= DEMO_LOOP_RENDERS
    beat = render // DEMO_BEAT_RENDERS
    left = DEMO_BEAT_RENDERS - render % DEMO_BEAT_RENDERS
    kick = 191 * left * left // (DEMO_BEAT_RENDERS * DEMO_BEAT_RENDERS)
    if beat % 4 == 3:
        kick >>= 1
    melody = 4 + SIN8[(beat * 37) & 255] * 6 // 255
    hat = (render + DEMO_BEAT_RENDERS // 2) % DEMO_BEAT_RENDERS
    bands = []
    for band in range(16):
        if band < 4:
            bands.append(kick * (4 - band) // 4)
        elif band < 11:
            bands.append(max(0, 200 - 60 * abs(band - melody)))
        else:
            bands.append(max(0, 170 - 14 * hat - 20 * (band - 11)))
    onset = DEMO_ONSET if render % DEMO_BEAT_RENDERS == 0 else 0
    return (64 + kick, onset, (4 * render) & 255, bands)


def assumed_apply_clock(rate: int) -> int:
    """The lamp's clock at the Apply, unknown on the lamp: an assumed 5100 ms
    rounded up to a multiple of 290 - rate."""
    bucket = 290 - rate
    return bucket * -(-5100 // bucket)


def clock_at(rate: int, render: int) -> int:
    """The lamp clock of a render: what the clock-reading renderers read, and
    step's clock_ms. The time since the Apply is render * RENDER_MS."""
    return (assumed_apply_clock(rate) + render * RENDER_MS) & U32


def effective_direction(settings) -> int:
    """The raw direction the renderer runs on: a mode-46 record installs
    only the reverse flag, so what maps to 2 or 3 runs as mapped 0."""
    direction = settings["direction"]
    if settings["mode"] == 46:
        row = DIRECTION_TABLE[REFERENCE_PROFILE]
        if row[direction] >= 2:
            return row.index(0)
    return direction


def effect_geometry(settings) -> tuple[int, int]:
    """The segment's (width, height): 5 x 20, or 20 x 5 when transposed."""
    return segment_geometry(LENGTH, DIRECTION_TABLE[REFERENCE_PROFILE][effective_direction(settings)])


# ── Geometry and the mapper ─────────────────────────────────────────────
def segment_geometry(length: int, mapped: int) -> tuple[int, int]:
    """The segment box (width, height) on the 5-wide panel, swapped by the
    transpose flag (mapped 2 / 3)."""
    row = (length - 1) // 5
    width, height = length - 1 - 5 * row + 1, row + 1
    return (height, width) if mapped >= 2 else (width, height)


def mapper_index(pixel: int, length: int, direction: int, profile: int) -> int:
    """The pixel mapper alone (16-bit, no segment test)."""
    mapped = DIRECTION_TABLE[profile][direction]
    width, height = segment_geometry(length, mapped)
    row, column = divmod(pixel, width)
    if mapped == 0:
        x, y = column, row
    elif mapped == 1:
        x, y = width - 1 - column, height - 1 - row
    elif mapped == 3:
        x, y = height - 1 - row, column
    else:
        x, y = row, width - 1 - column
    return (y * 5 + x) & 0xFFFF


def panel_index(pixel: int, length: int, direction: int, profile: int) -> int | None:
    """The mapper and the pixel writer's segment test: logical pixel ->
    panel buffer index, None when it falls outside."""
    index = mapper_index(pixel, length, direction, profile)
    return index if index < length else None


def frame_index(buffer_index: int) -> int:
    """A panel buffer index (column-major, bottom first) as the integration's
    frame index (row-major, row 0 = the bottom)."""
    column, row = divmod(buffer_index, ROWS)
    return row * COLS + column


_FRAME_ORDER = [0] * (3 * LENGTH)  # lamp-order byte -> panel byte
for _pixel in range(LENGTH):
    for _channel in range(3):
        _FRAME_ORDER[3 * frame_index(_pixel) + _channel] = 3 * _pixel + _channel
_PLACEMENTS: dict[tuple, tuple] = {}
_READ_BACKS: dict[tuple, tuple] = {}


def pixel_map(direction: int, profile: int = REFERENCE_PROFILE) -> tuple:
    """Logical pixel -> panel index, for every pixel (a renderer's pixel
    map; a permutation on the full segment)."""
    key = (direction, profile)
    out = _READ_BACKS.get(key)
    if out is None:
        out = _READ_BACKS[key] = tuple(
            mapper_index(pixel, LENGTH, direction, profile) for pixel in range(LENGTH)
        )
    return out


def place_strip(strip, direction: int, profile: int = REFERENCE_PROFILE) -> bytes:
    """A logical strip or grid on the panel: the renderers' last pass."""
    key = (direction, profile)
    order = _PLACEMENTS.get(key)
    if order is None:
        table = [0] * (3 * LENGTH)
        for pixel, index in enumerate(pixel_map(direction, profile)):
            for channel in range(3):
                table[3 * index + channel] = 3 * pixel + channel
        order = _PLACEMENTS[key] = tuple(table)
    return bytes(map(strip.__getitem__, order))


def read_back(work, direction: int, profile: int = REFERENCE_PROFILE) -> bytes:
    """The read-back pass of a renderer that stores in panel order: logical
    pixel i from the buffer at mapper(i)."""
    out = bytearray(3 * LENGTH)
    for pixel, index in enumerate(pixel_map(direction, profile)):
        out[3 * pixel:3 * pixel + 3] = work[3 * index:3 * index + 3]
    return bytes(out)


def panel_to_frame(panel) -> bytes:
    """A panel as a lamp frame."""
    return bytes(map(panel.__getitem__, _FRAME_ORDER))


def frame_pixels(frame) -> list:
    """A flat frame as (r, g, b) pixels."""
    return list(zip(frame[0::3], frame[1::3], frame[2::3]))


def strip_frame(draws, direction: int, profile: int = REFERENCE_PROFILE) -> list:
    """The frame a renderer's pixel writes draw (logical index, r, g, b,
    in order: a later write wins) after its clear to black."""
    frame = [(0, 0, 0)] * LENGTH
    for pixel, red, green, blue in draws:
        index = panel_index(pixel, LENGTH, direction, profile)
        if index is not None:
            frame[frame_index(index)] = (red, green, blue)
    return frame


_INSTALL_FLAGS = (0x05, 0x45, 0x55, 0x15)  # segment flags by mapped direction


def read_back_flags(mode: int, mapped: int, mixer: int = 0) -> int:
    """The flags a read-back pass runs with."""
    if mode == 46:
        return 0x45 if mapped == 1 else 0x05
    flags = 0x05 if mixer == 1 else _INSTALL_FLAGS[mapped]
    return flags | 0x42 if mode == 51 else flags


def flags_index(pixel: int, length: int, flags: int) -> int:
    """The mapper on those flags."""
    if flags == 0x47:
        width, height = segment_geometry(length, 0)
        return ((height - 1 - pixel // width) * 5 + pixel % width) & 0xFFFF
    mapped = _INSTALL_FLAGS.index(0x55 if flags == 0x57 else flags)
    return mapper_index(pixel, length, mapped, 3)


def flagged_targets(pixel: int, length: int, mapped: int, flags: int) -> list:
    """The pixel writer and the mapper on any flags: the indices written
    (bit 3 mirrors; bits 1, 4 and 6 turn the box)."""
    if length < 1:
        return []
    width, height = segment_geometry(length, mapped)
    row, column = divmod(pixel, width)
    bits = flags & 0x42
    if flags & 0x10:
        x, y = (
            (height - 1 - row, column) if bits == 0
            else (row, column) if bits == 2
            else (row, width - 1 - column)
        )
    else:
        x, y = (
            (column, row) if bits == 0
            else (width - 1 - column, row) if bits == 2
            else (column, height - 1 - row) if bits == 66
            else (width - 1 - column, height - 1 - row)
        )
    index = (y * 5 + x) & 0xFFFF
    if index >= length:
        return []
    return [length - 1 - index, index] if flags & 8 else [index]


# ── Grids and strips ────────────────────────────────────────────────────
# A grid is a bytearray of W x H pixels, r * W + c. index_of, when a renderer
# needs it, is a sequence: logical cell -> buffer cell (the clamped mapper).
_FADES: dict[int, bytes] = {}
_BLENDS: dict[tuple, bytes] = {}
_TOWARDS: dict[tuple, bytes] = {}


def new_grid(width: int, height: int) -> bytearray:
    return bytearray(3 * width * height)


def _fade_table(keep: int) -> bytes:
    table = _FADES.get(keep)
    if table is None:
        table = _FADES[keep] = bytes((value * keep) >> 8 for value in range(256))
    return table


def _blend_table(amount: int, target: int) -> bytes:
    key = (amount, target)
    table = _BLENDS.get(key)
    if table is None:
        if amount == 255:
            table = bytes([target]) * 256
        else:
            table = bytes((value * (255 - amount) + target * amount) >> 8 for value in range(256))
        _BLENDS[key] = table
    return table


def _visit_grid(work, tables, width: int, height: int, index_of) -> None:
    """The fade and blend helpers' walk, per channel: columns 0..W and rows
    0..H inclusive, an out-of-range coordinate replaced by 0, so row 0 and
    column 0 are visited twice (cell 0 four times)."""
    if index_of is None:
        stride = 3 * width
        for channel, table in enumerate(tables):
            work[channel::3] = work[channel::3].translate(table)
            work[channel:stride:3] = work[channel:stride:3].translate(table)
            work[channel::stride] = work[channel::stride].translate(table)
            work[channel] = table[work[channel]]
        return
    for column in range(width + 1):
        for row in range(height + 1):
            cell = 3 * index_of[(row if row < height else 0) * width + (column if column < width else 0)]
            for channel, table in enumerate(tables):
                work[cell + channel] = table[work[cell + channel]]


def fade_grid(work, amount: int, width: int, height: int, index_of=None):
    """Fade helper: FastLED fadeToBlackBy per visit."""
    table = _fade_table(255 - amount)
    _visit_grid(work, (table, table, table), width, height, index_of)
    return work


def blend_grid(work, amount: int, width: int, height: int, target=(0, 0, 0), index_of=None):
    """Blend helper: towards ``target`` by ``amount`` per visit."""
    if amount:
        tables = tuple(_blend_table(amount, channel) for channel in target)
        _visit_grid(work, tables, width, height, index_of)
    return work


def row_blur_grid(work, width: int, height: int, index_of=None):
    """Row blur helper: keep 239, c >> 5 added (saturating) to the
    previous column; the same walk as the fade; one carry, never reset."""
    identity = range(width * height) if index_of is None else index_of
    carry = (0, 0, 0)
    for column in range(width + 1):
        at = column if column < width else 0
        previous = (column - 1 if width > column - 1 else 0) if column else 0
        for row in range(height + 1):
            y = (row if row < height else 0) * width
            here = 3 * identity[y + at]
            red, green, blue = work[here], work[here + 1], work[here + 2]
            part = (red >> 5, green >> 5, blue >> 5)
            blended = (
                min(255, ((red * 239) >> 8) + carry[0]),
                min(255, ((green * 239) >> 8) + carry[1]),
                min(255, ((blue * 239) >> 8) + carry[2]),
            )
            if column:
                before = 3 * identity[y + previous]
                work[before] = min(255, work[before] + part[0])
                work[before + 1] = min(255, work[before + 1] + part[1])
                work[before + 2] = min(255, work[before + 2] + part[2])
            work[here], work[here + 1], work[here + 2] = blended
            carry = part
    return work


def blur_columns(work, amount: int, width: int, height: int, index_of=None):
    """Blur helper: FastLED blur1d down each column."""
    identity = range(width * height) if index_of is None else index_of
    keep, seep = 255 - amount, amount >> 1
    for column in range(width):
        carry = (0, 0, 0)
        for row in range(height):
            here = 3 * identity[row * width + column]
            red, green, blue = work[here], work[here + 1], work[here + 2]
            part = ((red * seep) >> 8, (green * seep) >> 8, (blue * seep) >> 8)
            if row:
                before = 3 * identity[(row - 1) * width + column]
                work[before] = min(255, work[before] + part[0])
                work[before + 1] = min(255, work[before + 1] + part[1])
                work[before + 2] = min(255, work[before + 2] + part[2])
            work[here] = min(255, ((red * keep) >> 8) + carry[0])
            work[here + 1] = min(255, ((green * keep) >> 8) + carry[1])
            work[here + 2] = min(255, ((blue * keep) >> 8) + carry[2])
            carry = part
    return work


def _towards_table(amount: int, target: int) -> bytes:
    key = (amount, target)
    table = _TOWARDS.get(key)
    if table is None:
        divisor = f32(((amount >> 1) ^ 127) + 1.1)
        out = bytearray(256)
        for value in range(256):
            gap = target - value
            sign = (gap > 0) - (gap < 0)
            out[value] = (value + sign + int(f32(f32(gap) / divisor))) & 255
        table = _TOWARDS[key] = bytes(out)
    return table


def fade_towards(strip, amount: int, target: int = 0, length: int = LENGTH):
    """Fade-towards helper on the displayed strip (the renderers read it
    back as drawn: at brightness 255, the renderer's own strip):
    each channel towards the word 0xRRGGBB."""
    for channel, shift in enumerate((16, 8, 0)):
        table = _towards_table(amount, (target >> shift) & 255)
        strip[channel:3 * length:3] = strip[channel:3 * length:3].translate(table)
    return strip


def strip_blur(strip, amount: int, length: int = LENGTH):
    """Blur helper along the displayed pixels."""
    keep, seep = amount ^ 255, amount >> 1
    carry = (0, 0, 0)
    for pixel in range(length):
        here = 3 * pixel
        red, green, blue = strip[here], strip[here + 1], strip[here + 2]
        share = ((red * seep) >> 8, (green * seep) >> 8, (blue * seep) >> 8)
        if pixel:
            strip[here - 3] = (strip[here - 3] + share[0]) & 255
            strip[here - 2] = (strip[here - 2] + share[1]) & 255
            strip[here - 1] = (strip[here - 1] + share[2]) & 255
        strip[here] = (((red * keep) >> 8) + carry[0]) & 255
        strip[here + 1] = (((green * keep) >> 8) + carry[1]) & 255
        strip[here + 2] = (((blue * keep) >> 8) + carry[2]) & 255
        carry = share
    return strip
