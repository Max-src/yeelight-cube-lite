/**
 * What the lamp's built-in renderers share. Mirrors lamp_core.py
 * exactly (its header explains the flat data: logical strips and grids, panels
 * and lamp frames are 300 bytes, r, g, b by pixel). The renderers live in
 * lamp-effects-<family>.js.
 */

export const LENGTH = 100;
export const COLS = 20;
export const ROWS = 5;
export const RENDER_SECONDS = 0.04;
export const RENDER_MS = 40;
// mount_profile.py DIRECTION_TABLE: drawn = TABLE[profile][sent].
export const DIRECTION_TABLE = [
  [2, 3, 1, 0],
  [1, 0, 3, 2],
  [3, 2, 0, 1],
  [0, 1, 2, 3],
];
export const REFERENCE_PROFILE = 2;

// ── 8/16-bit maths ────────────────────────────────────────────────────
export const f32 = Math.fround;
const bitsView = new DataView(new ArrayBuffer(4));
export const f32Bits = (value) => {
  bitsView.setFloat32(0, value, true);
  return bitsView.getUint32(0, true);
};
export const f32FromBits = (bits) => {
  bitsView.setUint32(0, bits >>> 0, true);
  return bitsView.getFloat32(0, true);
};
export const truncU16 = (value) =>
  Number.isFinite(value) ? Math.trunc(value) & 0xffff : 0;
export const f32Trunc = (value) =>
  Number.isNaN(value) ? 0 : Math.trunc(value);
export const sx8 = (value) => ((value & 255) ^ 128) - 128;
export const scale8 = (value, scale) => ((value & 255) * scale) >> 8;
export const triangle16 = (value) =>
  (((value & 65535) << 1) ^ (value & 32768 ? 0x1ffff : 0)) & 65535;
/** libm's lround: half away from zero. */
export const lround = (value) =>
  value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);

const SINE_TABLE = [0, 49, 49, 41, 90, 27, 117, 10];
// FastLED's sin8_C, by angle byte.
export const SIN8 = Uint8Array.from({ length: 256 }, (_, theta) => {
  const offset = (theta & 64 ? 255 - theta : theta) & 63;
  const secoffset = (offset & 15) + (theta & 64 ? 1 : 0);
  const section = offset >> 4;
  const y =
    SINE_TABLE[2 * section] + ((SINE_TABLE[2 * section + 1] * secoffset) >> 4);
  return (theta & 128 ? 128 - y : 128 + y) & 255;
});
export const sin8 = (theta) => SIN8[theta & 255];

const SIN16_SLOPE = [49, 48, 44, 38, 31, 23, 14, 4];
const SIN16_BASE = [0, 6393, 12539, 18204, 23170, 27245, 30273, 32137];

/** FastLED's sin16 + 32768. */
export function sin16Unsigned(theta) {
  let offset = (theta >> 3) & 0x7ff;
  if (theta & 0x4000) offset ^= 0x7ff;
  const section = offset >> 8;
  const value = ((offset >> 1) & 0x7f) * SIN16_SLOPE[section] + SIN16_BASE[section];
  return ((theta & 0x8000 ? -value : value) ^ 0x8000) & 0xffff;
}

/** A beat speed as 8.8: value << 8 below 256, else mod 65536. */
export const bpm88 = (value) =>
  value >= 0 && value < 256 ? value << 8 : value & 65535;
/** FastLED's sin8(beat8) at `clock`, `speed` from bpm88. */
export const beat = (clock, speed) =>
  SIN8[Math.imul(Math.imul(clock >>> 0, speed), 280) >>> 24];

const ENVELOPE_BASES = [0, 6393, 12539, 18204, 23170];
const ENVELOPE_SLOPES = [49, 48, 44, 38, 31];

export function envelopeGain(time, rate) {
  const phase = (Math.imul(time, (rate >> 3) + 10) >>> 2) & 16383;
  const folded = Math.min(phase, 16384 - phase) >> 3;
  const section = folded >> 8;
  return (
    Math.floor(
      (ENVELOPE_BASES[section] + ((folded >> 1) & 127) * ENVELOPE_SLOPES[section]) / 103,
    ) + 10
  );
}

// ── Noise ─────────────────────────────────────────────────────────────
// FastLED's permutation table, as the lamp uses it (inoise8_raw).
const NOISE_TABLE = [
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
];

const noiseInt8 = (value) => (value & 128 ? (value & 255) - 256 : value & 255);
const noiseEase = (value) => {
  const mirrored = value & 128 ? 255 - value : value;
  const doubled = (scale8(mirrored, mirrored) << 1) & 255;
  return value & 128 ? 255 - doubled : doubled;
};
const noiseLerp = (start, end, fraction) =>
  end > start
    ? noiseInt8(start + scale8(end - start, fraction))
    : noiseInt8(start - scale8(start - end, fraction));
function noiseGrad(number, x, y, z) {
  number &= 15;
  let u = number & 8 ? y : x;
  let v = number < 4 ? y : number === 12 || number === 14 ? x : z;
  if (number & 1) u = noiseInt8(-u);
  if (number & 2) v = noiseInt8(-v);
  return noiseInt8(((u + v) >> 1) + (u & 1));
}

/** FastLED's 3-D 8-bit noise, as the lamp runs it. */
export function inoise8Raw(x, y, z) {
  const table = NOISE_TABLE;
  const a = (table[x >> 8] + (y >> 8)) & 255;
  const aa = (table[a] + (z >> 8)) & 255;
  const ab = (table[a + 1] + (z >> 8)) & 255;
  const b = (table[(x >> 8) + 1] + (y >> 8)) & 255;
  const ba = (table[b] + (z >> 8)) & 255;
  const bb = (table[b + 1] + (z >> 8)) & 255;
  const u = noiseEase(x & 255);
  const v = noiseEase(y & 255);
  const w = noiseEase(z & 255);
  const xx = (x & 255) >> 1;
  const yy = (y & 255) >> 1;
  const zz = (z & 255) >> 1;
  const nx = noiseInt8(xx - 128);
  const ny = noiseInt8(yy - 128);
  const nz = noiseInt8(zz - 128);
  const x1 = noiseLerp(noiseGrad(table[aa], xx, yy, zz), noiseGrad(table[ba], nx, yy, zz), u);
  const x2 = noiseLerp(noiseGrad(table[ab], xx, ny, zz), noiseGrad(table[bb], nx, ny, zz), u);
  const x3 = noiseLerp(noiseGrad(table[aa + 1], xx, yy, nz), noiseGrad(table[ba + 1], nx, yy, nz), u);
  const x4 = noiseLerp(noiseGrad(table[ab + 1], xx, ny, nz), noiseGrad(table[bb + 1], nx, ny, nz), u);
  return noiseLerp(noiseLerp(x1, x2, v), noiseLerp(x3, x4, v), w);
}

function noiseGrad2d(number, x, y) {
  let u = number & 4 ? y : x;
  let v = number & 4 ? x : y;
  if (number & 1) u = noiseInt8(-u);
  if (number & 2) v = noiseInt8(-v);
  return noiseInt8(((u + v) >> 1) + (u & 1));
}

/** The 2-D noise over the same table. */
export function inoise8Raw2d(x, y) {
  const table = NOISE_TABLE;
  const a = (table[x >> 8] + (y >> 8)) & 255;
  const b = (table[(x >> 8) + 1] + (y >> 8)) & 255;
  const aa = table[a];
  const ab = table[a + 1];
  const ba = table[b];
  const bb = table[b + 1];
  const u = noiseEase(x & 255);
  const v = noiseEase(y & 255);
  const xx = (x & 255) >> 1;
  const yy = (y & 255) >> 1;
  const nx = noiseInt8(xx - 128);
  const ny = noiseInt8(yy - 128);
  const first = noiseLerp(noiseGrad2d(table[aa], xx, yy), noiseGrad2d(table[ba], nx, yy), u);
  const second = noiseLerp(noiseGrad2d(table[ab], xx, ny), noiseGrad2d(table[bb], nx, ny), u);
  return noiseLerp(first, second, v);
}

export const noiseHeat = (noise) => Math.min(255, ((noise + 64) & 255) << 1);

// ── Random source ─────────────────────────────────────────────────────
/** Stand-in for the lamp's hardware random source (not the lamp's behaviour:
 * its values are not known). A renderer counts its own draws from 0, in
 * state. */
export function sourceWord(draw) {
  let value = Math.imul(draw ^ 0x5bd1e995, 0x9e3779b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return value >>> 0;
}

/** The low byte of sourceWord. */
export const randomSource = (draw) => sourceWord(draw) & 255;

// ── Colour converter (lamp_core.py) ───────────────────────────────
const hexBytes = (hex) =>
  Uint8Array.from({ length: hex.length >> 1 }, (_, i) =>
    parseInt(hex.slice(2 * i, 2 * i + 2), 16),
  );
const LUT = (() => {
  const view = new DataView(hexBytes(
    "00000000399f22b33a967ecd3aae06ed3ac793a93ae330d43b0074933b1064773b216d97" +
    "3b3394773b46df1a3b5b51a03b70f1923b83e2293b8fe6453b9c88103ba9c9fe3bb7ad85" +
    "3bc6354f3bd563693be539c63bf5bafc3c0373db3c0c61653c15a70c3c1f45e53c293e79" +
    "3c3391fc3c3e41563c494d453c54b7323c607ef23c6ca6053c792d373c830ae03c89afba" +
    "3c9085e73c978dc93c9ec7c43ca634373cadd4003cb5a65c3cbdac5d3cc5e6613cce54c4" +
    "3cd6f7e43cdfd06f3ce8ddf03cf2214d3cfb9ad43d02a56f3d0798e03d0ca7ec3d11d2b3" +
    "3d1719683d1c7cab3d21fb9c3d2796fa3d2d4ef03d3323a73d3915473d3f23f73d454fdf" +
    "3d4b996e3d5200213d5884893d5f26c93d65e7083d6cc5693d73c2123d7add3a3d810b69" +
    "3d84b7963d8873893d8c3e903d90192d3d9403703d97fd6a3d9c072e3da020cd3da44a58" +
    "3da883e03daccdb93db1275c3db591363dba0b523dbe95c43dc3309b3dc7dbe73dcc97b9" +
    "3dd164213dd6413a3ddb2ef33de02d793de53d823dea5da93def8ecd3df4d0f63dfa243b" +
    "3dff88a53e027f233e0542973e080eb53e0ae3863e0dc1113e10a7a63e1396ab3e168e83" +
    "3e198f353e1c98c83e1fab443e22c6b03e25eb133e2918733e2c4ed73e2f8e473e32d6c9" +
    "3e3628733e3983273e3ce7083e40541a3e43caf63e474a683e4ad3203e4e65243e52007c" +
    "3e55a52e3e5953413e5d0abb3e60cba43e6496023e6869db3e6c47363e702e1f3e741e92" +
    "3e7819123e7c1ca23e8014ec3e82205e3e8430a83e8645cf3e885fd53e8a7ebd3e8ca28c" +
    "3e8ecb433e90f8e53e932b773e9562fa3e979f723e99e0e33e9c27583e9e72bc3ea0c324" +
    "3ea318923ea573093ea7d28e3eaa371a3eaca0b73eaf0f6a3eb183b53eb3fc8d3eb67a80" +
    "3eb8fd933ebb85cb3ebe13293ec0a5b03ec33d643ec5da483ec87c5d3ecb23a83ecdd02a" +
    "3ed081e83ed338e33ed5f51e3ed8b69d3edb7d623ede49703ee11b313ee3f1cb3ee6cdb8" +
    "3ee9aefa3eec95953eef818c3ef272e03ef569943ef865ac3efb672a3efe6e103f00bd32" +
    "3f0246123f03d1aa3f055ffb3f06f1093f0884d23f0a1b583f0bb4ab3f0d50ab3f0eef6e" +
    "3f1090f53f1235413f13dc533f15862d3f1733413f18e2a33f1a94d03f1c49ca3f1e0191" +
    "3f1fbc293f2179903f2339ca3f24fcd63f26c2b73f288b6e3f2a56fb3f2c25613f2df6a0" +
    "3f2fcab93f31a1b03f337b833f3558343f3737c53f391a363f3aff8a3f3ce7c13f3ed33d" +
    "3f40c1333f42b2113f44a5d93f469c8b3f4896283f4a92b23f4c922a3f4e94913f5099e9" +
    "3f52a2313f54ad6d3f56bb9c3f58ccc03f5ae0d93f5cf7eb3f5f11f43f612ef73f634ef3" +
    "3f6571ee3f6797e53f69c0dc3f6becce3f6e1bc53f704dca3f7282bf3f74bab53f76f5b6" +
    "3f7933ba3f7b74cb3f7db8e03f800000",
  ).buffer);
  return Float32Array.from({ length: 256 }, (_, i) => view.getFloat32(4 * i));
})();
const CALIBRATION = new DataView(hexBytes(
  "81980840cae2debe1d6fa3be23435bbf54cff23f1a55e1bcb7b75b3d57d1fabd83c7043f" +
  "769bb3bfbc596b3ffc5e9f3fc05ec1bd526071bec4e2f13e9c09a941d8ef2fc036ae39bf" +
  "64194f3f0f8ddc3e302d6a3c72f92f3fc0ec9e3e0bb5263ed3de303f39b4083ee10b933d" +
  "5dfec33eb8afc33e9a19e442e1ba90432f1dab4200000000000000000000000000000000" +
  "00000000000000000000000001000000",
).buffer);
const FULL_SCALE = 255;
const FLOOR = FULL_SCALE * 0.003;
const calibration = (offset) => CALIBRATION.getFloat32(offset, true);

const X_WEIGHTS = [0.4124000072479248, 0.35760000348091125, 0.18050000071525574];
const Y_WEIGHTS = [0.2125999927520752, 0.7152000069618225, 0.0722000002861023];
const Z_WEIGHTS = [0.019300000742077827, 0.11919999867677689, 0.9505000114440918];
const NEAR = [
  [0, 0.6399999856948853, 0.33000001311302185, 0.01],
  [1, 0.30000001192092896, 0.6000000238418579, 0.005],
  [2, 0.15000000596046448, 0.05999999865889549, 0.01],
];
const EDGES = {
  gb: [calibration(60), calibration(64), calibration(84), calibration(88)],
  rg: [calibration(68), calibration(72), calibration(100), calibration(104)],
  rb: [calibration(76), calibration(80), calibration(92), calibration(96)],
};
const CONVERTED_LIMIT = 1 << 16;
const converted = new Map();

const distance = (value, centre) => {
  const high = f32(centre - value);
  return high > 0 ? high : f32(value + -centre);
};
const keepAbove = (value, floor) => (value >= floor ? value : floor);

/** The lamp's gamut mapping on its calibration table, then the output stage:
 * the three unrounded output values. */
export function gamutWords(x, y, scalar) {
  const x0 = x;
  const y0 = y;
  const clip = (edge) => {
    const [slope, intercept, xr, yr] = EDGES[edge];
    const reference = f32(f32(f32(slope * xr) + intercept) - yr);
    const here = f32(f32(f32(x * slope) + intercept) - y);
    if (f32(here * reference) > 0) return;
    x = f32(xr + f32(f32(f32(x - xr) * reference) / f32(reference - here)));
    y = f32(intercept + f32(slope * x));
  };
  const side = (slope, intercept) => f32(y0 - f32(f32(x0 * slope) + intercept));
  clip("gb");
  clip("rg");
  clip("rb");
  const sector =
    side(calibration(44), calibration(48)) > 0
      ? side(calibration(36), calibration(40)) > 0 ? "rg" : "gb"
      : side(calibration(52), calibration(56)) > 0 ? "rg" : "rb";
  const outside = f32(EDGES[sector][0] * side(EDGES[sector][0], EDGES[sector][1]));
  if (sector === "rg" ? outside < 0 : outside > 0) clip(sector);
  const z = f32(f32(1 - x) - y);
  const row = (start) =>
    keepAbove(
      f32(f32(f32(calibration(start) * x) + f32(calibration(start + 4) * y)) +
        f32(calibration(start + 8) * z)),
      0,
    );
  let channels = [row(0), row(12), row(24)];
  const total = f32(channels[2] + f32(channels[0] + channels[1]));
  channels = channels.map((value) => f32(value / total));
  const normal = f32(1 / keepAbove(keepAbove(keepAbove(channels[0], channels[1]), channels[2]), 0));
  channels = channels.map((value) => keepAbove(f32(value * normal), 0));
  // Brightness, full scale, the floor at FS * 0.003, the output curve.
  return channels.map((channel, index) => {
    let value = f32(f32(scalar * channel) * FULL_SCALE);
    if (value < FLOOR) value = 0;
    const exponent = calibration(132 + 4 * index);
    if (exponent !== 0) {
      const ratio = f32(value / FULL_SCALE);
      if (ratio === 0) value = 0;
      else {
        const power = exponent / 100;
        value = f32(FULL_SCALE * f32(f32(power) - f32(f32(power - 1) * ratio)));
      }
    }
    return value;
  });
}

const roundWord = (value) => Math.min(Math.trunc(value + 0.49), 0xffffffff);
const pack = (words) => {
  const packed = ((words[0] << 16) | (words[1] << 8) | words[2]) >>> 0;
  return [(packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255];
};

function convert(red, green, blue) {
  if (!(red | green | blue)) return [0, 0, 0]; // black: nothing to convert
  const level = Math.min((Math.max(red, green, blue) * 100) >> 8, 100);
  const scalar = level === 0 ? 0 : f32(f32(level) / 100);
  const shortcut = (channel) => {
    const lit = roundWord(f32(scalar * FULL_SCALE));
    return pack([0, 1, 2].map((index) => (index === channel ? lit : 0)));
  };
  const word = (red << 16) | (green << 8) | blue;
  if (word === 0xff0000) return shortcut(0);
  if (word === 0x00ff00) return shortcut(1);
  if (word === 0x0000ff) return shortcut(2);
  const r = LUT[red];
  const g = LUT[green];
  const b = LUT[blue];
  const ySum = f32(f32(f32(Y_WEIGHTS[0] * r) + f32(Y_WEIGHTS[1] * g)) + f32(Y_WEIGHTS[2] * b));
  const xSum = f32(f32(f32(X_WEIGHTS[0] * r) + f32(X_WEIGHTS[1] * g)) + f32(X_WEIGHTS[2] * b));
  const total = f32(
    f32(f32(f32(Z_WEIGHTS[0] * r) + f32(Z_WEIGHTS[1] * g)) + f32(Z_WEIGHTS[2] * b)) +
      f32(xSum + ySum),
  );
  const inverse = f32(1 / total);
  const x = f32(xSum * inverse);
  const y = f32(ySum * inverse);
  for (const [channel, centreX, centreY, limit] of NEAR)
    if (distance(x, centreX) < limit && distance(y, centreY) < limit)
      return shortcut(channel);
  return pack(gamutWords(x, y, scalar).map(roundWord));
}

/** An RGB colour as the LED drive the lamp's converter gives it. Shared:
 * not to be changed. */
export function convertColour(colour) {
  const key = (colour[0] << 16) | (colour[1] << 8) | colour[2];
  let out = converted.get(key);
  if (!out) {
    if (converted.size >= CONVERTED_LIMIT) converted.clear();
    out = convert(colour[0], colour[1], colour[2]);
    converted.set(key, out);
  }
  return out;
}

/** The full-saturation six-way switch of modes 75 to 77 (binary32): the
 * converter's input, not yet LED drive. */
export function hueColour(hue) {
  const sector = f32(f32(hue) / 60);
  const index = Math.floor(sector);
  const fraction = f32(sector - index);
  const rising = f32(1 - (1 - fraction));
  const falling = f32(1 - fraction);
  const sides = [
    [1, rising, 0], [falling, 1, 0], [0, 1, rising],
    [0, falling, 1], [rising, 0, 1], [1, 0, falling],
  ];
  return sides[index].map((value) => Math.trunc(f32(value * 255)));
}

const hueDrives = new Array(360).fill(null);

/** hueColour through the converter, for a whole hue 0-359. */
export function hueDrive(hue) {
  return hueDrives[hue] ?? (hueDrives[hue] = convertColour(hueColour(hue)));
}

// lamp_core.py _LED_PRIMARIES and its other constants.
const LED_PRIMARIES = [
  [0.5163387415092199, 0.1394859134207411, 0.32517009647950995],
  [0.2331561508620735, 0.5919583299750346, 0.17488550127746175],
  [0.0016524911553138474, 0.12534883680422795, 1.9356753294369915],
];
const LED_WHITE_LUMINANCE = 202.33102442967106;
const XYZ_TO_LINEAR_SRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

/**
 * LED drive as an sRGB screen color: the additive mix of the three LEDs. A dim
 * value looks far brighter on an LED than the same number on a screen, so a
 * frame painted as it is looks dark. Display only.
 */
export function ledAppearance(drive) {
  const [red, green, blue] = drive;
  if (!(red || green || blue)) return [0, 0, 0];
  const [p0, p1, p2] = LED_PRIMARIES;
  const x = p0[0] * red + p0[1] * green + p0[2] * blue;
  const y = p1[0] * red + p1[1] * green + p1[2] * blue;
  const z = p2[0] * red + p2[1] * green + p2[2] * blue;
  const [m0, m1, m2] = XYZ_TO_LINEAR_SRGB;
  let r = Math.max(0, (m0[0] * x + m0[1] * y + m0[2] * z) / LED_WHITE_LUMINANCE);
  let g = Math.max(0, (m1[0] * x + m1[1] * y + m1[2] * z) / LED_WHITE_LUMINANCE);
  let b = Math.max(0, (m2[0] * x + m2[1] * y + m2[2] * z) / LED_WHITE_LUMINANCE);
  const peak = Math.max(r, g, b);
  if (peak > 1) {
    r /= peak;
    g /= peak;
    b /= peak;
  }
  return [screenChannel(r), screenChannel(g), screenChannel(b)];
}

const screenChannel = (value) =>
  Math.floor(
    255 *
      (value <= 0.0031308
        ? 12.92 * value
        : 1.055 * value ** (1 / 2.4) - 0.055) +
      0.5,
  );

// ── Palettes ──────────────────────────────────────────────────────────
export const PALETTE_SOURCES = {
  0: "ff0000 cf3000 9f6000 6f9000 3fc000 0ff000 00de21 00ae51 007e81 004eb1 001ee1 1200ed 4200bd 72008d a2005d d2002d",
  12: "ff0000 ff2a00 ff7f00 ffaa00 ffd500 ffff00 d5ff00 aaff00 7fff00 00ff55 00ff7f 00ffaa 00ffd5 00d5ff 00aaff 007fff 0055ff 002aff",
  13: "ffdfb3 fecfa3 fdbf92 fcaf82 fb9f71 fa8f61 f97f51 f96f41 f85f30 f74f20 f63f10 f52f00 e51f00 d51f00 c51f00 b51f00 a51f00 951f00",
  14: "28bdff 28d3ff 28e9ff 28fefa 28ffe6 28ffcd 28ffb3 28ff99 28ff7f 28ff66 75ff28 c3ff28 ddff28 f7ff28 ffea28 ffd428 ffbf28 ffaa28",
  32: "8080fc 9e53ff e574ff ffa55c ff941d",
  3: "000000 200400 400800 800600 ff0c00 921902 ae3308 bc4c17 ff6626 ff6626 ff6626 ff663a ff7f50 ff7f70 ff7f75 ff997f",
  4: "000001 000033 000066 000099 0000cc 0000ff 0033ff 0066ff 0099ff 00ccff 00ffff 00ffff 00ffff 00ffff 00ffff 00ffff",
  10: "001100 003300 006600 009900 00cc00 00ff00 33ff00 66ff00 0099ff 00ccff 00ffff 00ffff 00ffff 00ffff 00ffff 00ffff",
  5: "93fafa 71dffb 4dc2fc 32acfd 1192ff 1574ff 3559ff 573cff 6c2aff 8a11ff a906e2 bb0eb4 c4129c d31976 e52246 fe2d05",
  6: "ffffff adfffa 5efff6 00fff0 01baf5 017df9 014dfd 0029ff 5015ff 8c05ff d504e9 ff06d7 ff0c99 ff1616 ff6632 ffdb59",
};
// The lamp's per-mode palette table: the palette of modes 11..45, over the preset's.
export const MODE_PALETTES = { 11: 4, 15: 10, 18: 3, 19: 3, 24: 3, 30: 6, 34: 3, 37: 2, 41: 5, 42: 4, 43: 5, 44: 5, 45: 6 };
// Copied as they are; the others go through the converter.
const DIRECT_PALETTES = [0, 2, 3, 4, 10];
// The renderers that sample the palette R+32 (mode 3 at intensity >= 128 only).
export const LAMP_PALETTE_MODES = new Set([
  16, 21, 22, 31, 14, 24, 3, 4, 7, 9, 15, 17, 18, 19, 20, 25, 26, 30, 34, 35, 37, 39,
  41, 42, 43, 44, 45, 47, 48, 51, 60, 70, 73, 74, 80, 81,
]);
// The palette field of a command, for the modes that do not sample R+32.
export const LAB_PALETTE = [[255, 86, 61], [255, 208, 68], [38, 205, 148], [66, 123, 244]];
const BLACK_TAIL = [[0, 0, 0], [0, 0, 0]];

/** Selector 8's palette: 16 steps up to the primary. */
export const primaryRamp = (primary) =>
  Array.from({ length: 16 }, (_, index) =>
    primary.map((channel) => (index === 15 ? channel : (channel * 17 * index) >> 8)),
  );

/** The palette a mode samples under a preset's colour selector. */
export function nativePalette(selector, mode) {
  const keeps = selector === 8 || selector === 9 || (selector >= 22 && selector <= 31);
  const chosen = keeps ? selector : MODE_PALETTES[mode] ?? selector;
  if (chosen === 8) return primaryRamp(convertColour([255, 255, 255]));
  const colours = PALETTE_SOURCES[chosen === 2 ? 0 : chosen]
    .split(" ")
    .map((text) => [0, 2, 4].map((at) => parseInt(text.slice(at, at + 2), 16)));
  return DIRECT_PALETTES.includes(chosen) ? colours : colours.map(convertColour);
}

export const paletteSpan = (count) =>
  Math.floor((255 * count - 255) / count) & 255;

/** The lamp's palette sampler: null past a palette's known entries. */
export function samplePalette(palette, index, tail = null) {
  const count = palette.length;
  const after = tail ?? (count === 18 ? BLACK_TAIL : []);
  const width = Math.floor(256 / count);
  const slot = Math.floor((index & 255) / width);
  const remainder = (index & 255) % width;
  const stored = (entry) =>
    entry < count ? palette[entry] : after[entry - count];
  const current = stored(slot);
  if (!current) return null;
  if (!remainder) return current.slice();
  const following = slot === count - 1 ? palette[0] : stored(slot + 1);
  if (!following) return null;
  const weight = Math.floor((remainder * 255) / width);
  return current.map(
    (channel, at) =>
      ((channel * (255 - weight)) >> 8) + ((following[at] * weight) >> 8),
  );
}

/** samplePalette for every index: 256 colours, flat (an unknown sample black). */
export function paletteTable(palette, tail = null) {
  const table = new Uint8Array(768);
  for (let index = 0; index < 256; index += 1) {
    const colour = samplePalette(palette, index, tail);
    if (colour) table.set(colour, 3 * index);
  }
  return table;
}

// ── A command's colours (lamp_core.py) ────────────────────────────
const WORDLESS_MODES = new Set([
  6, 27, 38, 46, 52, 53, 54, 55, 56, 57, 58, 59, 64, 65, 66, 67, 68, 69, 75, 76, 77,
]);
const COLOURS_LIMIT = 64;
const colourMemo = new Map();

/** Colour words R+536..R+548, converted (lamp_core.py): the colors this
 * component sends (one, or a slot's list), 0 past them; with no color key, white
 * in all four. */
export function installedWords(settings) {
  const { mode, coloured, primary } = settings;
  if (WORDLESS_MODES.has(mode) || !coloured)
    return new Array(4).fill(convertColour([255, 255, 255]));
  const words = (settings.colours ?? []).slice(0, 4).map((colour) => convertColour(colour));
  if (words.length) return [...words, ...new Array(4 - words.length).fill([0, 0, 0])];
  return [convertColour(primary), [0, 0, 0], [0, 0, 0], [0, 0, 0]];
}

/** What the renderer preparation gives a command: primary and secondary, all
 * four words, the palette and its sampled table. Shared: not to be changed. */
export function effectColours(settings) {
  const { mode, selector, intensity, coloured, primary } = settings;
  const key = `${mode},${selector},${intensity >= 128},${coloured},${primary},${settings.colours ?? ""},${settings.palette ?? ""}`;
  let out = colourMemo.get(key);
  if (out) return out;
  const words = installedWords(settings);
  const paletteMode =
    LAMP_PALETTE_MODES.has(mode) && !(mode === 3 && intensity < 128);
  let palette;
  if (paletteMode && settings.palette?.length)
    // A music mode's own palette (lamp-renderers.js musicPalette).
    palette = settings.palette.map((colour) => convertColour(colour));
  else if (paletteMode)
    palette =
      coloured || selector === 8 ? primaryRamp(words[0]) : nativePalette(selector, mode);
  else if (mode === 8 || mode === 28) palette = words.slice(); // its four band colors
  else palette = LAB_PALETTE.map((colour) => colour.slice());
  out = {
    primary: words[0],
    secondary: words[1],
    words,
    palette,
    table: paletteTable(palette),
  };
  if (colourMemo.size >= COLOURS_LIMIT) colourMemo.clear();
  colourMemo.set(key, out);
  return out;
}

/** The lamp's clock at the Apply, unknown on the lamp: an assumed 5100 ms
 * rounded up to a multiple of 290 - rate. */
export function assumedApplyClock(rate) {
  const bucket = 290 - rate;
  return bucket * Math.ceil(5100 / bucket);
}

/** The lamp clock of a render: step's clock_ms. The time since the Apply is
 * render * RENDER_MS. */
export const clockAt = (rate, render) =>
  (assumedApplyClock(rate) + render * RENDER_MS) % 4294967296;

/** The raw direction the renderer runs on (a mode-46 record installs only the
 * reverse flag). */
export function effectiveDirection(settings) {
  const { direction, mode } = settings;
  if (mode === 46) {
    const row = DIRECTION_TABLE[REFERENCE_PROFILE];
    if (row[direction] >= 2) return row.indexOf(0);
  }
  return direction;
}

/** The segment's [width, height]: 5 x 20, or 20 x 5 when transposed. */
export const effectGeometry = (settings) =>
  segmentGeometry(
    LENGTH,
    DIRECTION_TABLE[REFERENCE_PROFILE][effectiveDirection(settings)],
  );

// ── Geometry and the mapper ───────────────────────────────────────────
export function segmentGeometry(length, mapped) {
  const row = Math.floor((length - 1) / 5);
  const width = length - 1 - 5 * row + 1;
  const height = row + 1;
  return mapped >= 2 ? [height, width] : [width, height];
}

/** The pixel mapper alone (16-bit, no segment test). */
export function mapperIndex(pixel, length, direction, profile) {
  const mapped = DIRECTION_TABLE[profile][direction];
  const [width, height] = segmentGeometry(length, mapped);
  const row = Math.floor(pixel / width);
  const column = pixel % width;
  const [x, y] =
    mapped === 0
      ? [column, row]
      : mapped === 1
        ? [width - 1 - column, height - 1 - row]
        : mapped === 3
          ? [height - 1 - row, column]
          : [row, width - 1 - column];
  return (y * 5 + x) & 0xffff;
}

/** The mapper and the pixel writer's segment test: logical pixel -> panel
 * buffer index, null when it falls outside. */
export function panelIndex(pixel, length, direction, profile) {
  const index = mapperIndex(pixel, length, direction, profile);
  return index < length ? index : null;
}

/** A panel buffer index (column-major) as the frame index (row-major). */
export function frameIndex(bufferIndex) {
  return (bufferIndex % ROWS) * COLS + Math.floor(bufferIndex / ROWS);
}

const FRAME_ORDER = new Uint16Array(3 * LENGTH); // lamp-order byte -> panel byte
for (let pixel = 0; pixel < LENGTH; pixel += 1)
  for (let channel = 0; channel < 3; channel += 1)
    FRAME_ORDER[3 * frameIndex(pixel) + channel] = 3 * pixel + channel;
const pixelMaps = new Map();
const placements = new Map();

/** Logical pixel -> panel index, for every pixel. */
export function pixelMap(direction, profile = REFERENCE_PROFILE) {
  const key = direction * 4 + profile;
  let out = pixelMaps.get(key);
  if (!out) {
    out = Uint16Array.from({ length: LENGTH }, (_, pixel) =>
      mapperIndex(pixel, LENGTH, direction, profile),
    );
    pixelMaps.set(key, out);
  }
  return out;
}

/** A logical strip or grid on the panel: the renderers' last pass. */
export function placeStrip(strip, direction, out = new Uint8Array(3 * LENGTH), profile = REFERENCE_PROFILE) {
  const key = direction * 4 + profile;
  let order = placements.get(key);
  if (!order) {
    order = new Uint16Array(3 * LENGTH);
    pixelMap(direction, profile).forEach((index, pixel) => {
      for (let channel = 0; channel < 3; channel += 1)
        order[3 * index + channel] = 3 * pixel + channel;
    });
    placements.set(key, order);
  }
  for (let at = 0; at < 3 * LENGTH; at += 1) out[at] = strip[order[at]];
  return out;
}

/** The read-back pass of a renderer that stores in panel order: logical pixel
 * i from the buffer at mapper(i). */
export function readBack(work, direction, out = new Uint8Array(3 * LENGTH), profile = REFERENCE_PROFILE) {
  const map = pixelMap(direction, profile);
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const at = 3 * map[pixel];
    out[3 * pixel] = work[at];
    out[3 * pixel + 1] = work[at + 1];
    out[3 * pixel + 2] = work[at + 2];
  }
  return out;
}

/** A panel as a lamp frame. */
export function panelToFrame(panel) {
  const frame = new Uint8Array(3 * LENGTH);
  for (let at = 0; at < 3 * LENGTH; at += 1) frame[at] = panel[FRAME_ORDER[at]];
  return frame;
}

/** A flat frame as [r, g, b] pixels. */
export function framePixels(frame) {
  const pixels = new Array(LENGTH);
  for (let pixel = 0, at = 0; pixel < LENGTH; pixel += 1, at += 3)
    pixels[pixel] = [frame[at], frame[at + 1], frame[at + 2]];
  return pixels;
}

export function stripFrame(draws, direction, profile = REFERENCE_PROFILE) {
  const frame = Array.from({ length: LENGTH }, () => [0, 0, 0]);
  for (const [pixel, red, green, blue] of draws) {
    const index = panelIndex(pixel, LENGTH, direction, profile);
    if (index !== null) frame[frameIndex(index)] = [red, green, blue];
  }
  return frame;
}

const INSTALL_FLAGS = [0x05, 0x45, 0x55, 0x15]; // segment flags by mapped direction
// A clock background's flags: mode 40 hands over to it with these, whatever
// direction is sent, and skips its first render, where some set their own.
export const HANDOVER_FLAGS = 0x05;

/** The flags a read-back pass runs with. */
export function readBackFlags(mode, mapped, mixer = 0) {
  if (mode === 46) return mapped === 1 ? 0x45 : 0x05;
  const flags = mixer === 1 ? 0x05 : INSTALL_FLAGS[mapped];
  return mode === 51 ? flags | 0x42 : flags;
}

/** The mapper on those flags. */
export function flagsIndex(pixel, length, flags) {
  if (flags === 0x47) {
    const [width, height] = segmentGeometry(length, 0);
    return ((height - 1 - Math.floor(pixel / width)) * 5 + pixel % width) & 0xffff;
  }
  const mapped = INSTALL_FLAGS.indexOf(flags === 0x57 ? 0x55 : flags);
  return mapperIndex(pixel, length, mapped, 3);
}

/** The pixel writer and the mapper on any flags: the indices written. */
/** Where the lamp draws the clock digits' pixel at frame `index` (lamp order)
 * on the flags its clock runs with (lamp_core.py clock_digit_targets). */
export function clockDigitTargets(index, flags) {
  if (flags === HANDOVER_FLAGS) return [index];
  const row = Math.floor(index / COLS);
  const pixel = (index % COLS) * ROWS + row;
  if (flags & 0x08 && pixel >= LENGTH / 2) return [];
  return flaggedTargets(pixel, LENGTH, 0, flags).map(frameIndex);
}

export function flaggedTargets(pixel, length, mapped, flags) {
  if (length < 1) return [];
  const [width, height] = segmentGeometry(length, mapped);
  const row = Math.floor(pixel / width);
  const column = pixel % width;
  const bits = flags & 0x42;
  const [x, y] =
    flags & 0x10
      ? bits === 0
        ? [height - 1 - row, column]
        : bits === 2
          ? [row, column]
          : [row, width - 1 - column]
      : bits === 0
        ? [column, row]
        : bits === 2
          ? [width - 1 - column, row]
          : bits === 66
            ? [column, height - 1 - row]
            : [width - 1 - column, height - 1 - row];
  const index = (y * 5 + x) & 0xffff;
  if (index >= length) return [];
  return flags & 8 ? [length - 1 - index, index] : [index];
}

// ── Grids and strips (lamp_core.py) ───────────────────────────────
const fades = new Map();
const blends = new Map();
const towards = new Map();

export const newGrid = (width, height) => new Uint8Array(3 * width * height);

function fadeTable(keep) {
  let table = fades.get(keep);
  if (!table) {
    table = Uint8Array.from({ length: 256 }, (_, value) => (value * keep) >> 8);
    fades.set(keep, table);
  }
  return table;
}

function blendTable(amount, target) {
  const key = amount * 256 + target;
  let table = blends.get(key);
  if (!table) {
    table = Uint8Array.from({ length: 256 }, (_, value) =>
      amount === 255 ? target : (value * (255 - amount) + target * amount) >> 8,
    );
    blends.set(key, table);
  }
  return table;
}

// The fade and blend helpers' walk: columns 0..W and rows 0..H inclusive, an
// out-of-range coordinate replaced by 0.
function visitGrid(work, red, green, blue, width, height, indexOf) {
  for (let column = 0; column <= width; column += 1) {
    const across = column < width ? column : 0;
    for (let row = 0; row <= height; row += 1) {
      const logical = (row < height ? row : 0) * width + across;
      const cell = 3 * (indexOf ? indexOf[logical] : logical);
      work[cell] = red[work[cell]];
      work[cell + 1] = green[work[cell + 1]];
      work[cell + 2] = blue[work[cell + 2]];
    }
  }
}

/** Fade helper: FastLED fadeToBlackBy per visit. */
export function fadeGrid(work, amount, width, height, indexOf = null) {
  const table = fadeTable(255 - amount);
  visitGrid(work, table, table, table, width, height, indexOf);
  return work;
}

/** Blend helper: towards `target` by `amount` per visit. */
export function blendGrid(work, amount, width, height, target = [0, 0, 0], indexOf = null) {
  if (amount)
    visitGrid(
      work, blendTable(amount, target[0]), blendTable(amount, target[1]),
      blendTable(amount, target[2]), width, height, indexOf,
    );
  return work;
}

/** Row blur helper: keep 239, c >> 5 added (saturating) to the
 * previous column; the same walk as the fade; one carry, never reset. */
export function rowBlurGrid(work, width, height, indexOf = null) {
  let carryR = 0;
  let carryG = 0;
  let carryB = 0;
  for (let column = 0; column <= width; column += 1) {
    const at = column < width ? column : 0;
    const previous = column && width > column - 1 ? column - 1 : 0;
    for (let row = 0; row <= height; row += 1) {
      const y = (row < height ? row : 0) * width;
      const here = 3 * (indexOf ? indexOf[y + at] : y + at);
      const red = work[here];
      const green = work[here + 1];
      const blue = work[here + 2];
      const partR = red >> 5;
      const partG = green >> 5;
      const partB = blue >> 5;
      const blendR = Math.min(255, ((red * 239) >> 8) + carryR);
      const blendG = Math.min(255, ((green * 239) >> 8) + carryG);
      const blendB = Math.min(255, ((blue * 239) >> 8) + carryB);
      if (column) {
        const before = 3 * (indexOf ? indexOf[y + previous] : y + previous);
        work[before] = Math.min(255, work[before] + partR);
        work[before + 1] = Math.min(255, work[before + 1] + partG);
        work[before + 2] = Math.min(255, work[before + 2] + partB);
      }
      work[here] = blendR;
      work[here + 1] = blendG;
      work[here + 2] = blendB;
      carryR = partR;
      carryG = partG;
      carryB = partB;
    }
  }
  return work;
}

/** Blur helper: FastLED blur1d down each column. */
export function blurColumns(work, amount, width, height, indexOf = null) {
  const keep = 255 - amount;
  const seep = amount >> 1;
  for (let column = 0; column < width; column += 1) {
    let carryR = 0;
    let carryG = 0;
    let carryB = 0;
    for (let row = 0; row < height; row += 1) {
      const logical = row * width + column;
      const here = 3 * (indexOf ? indexOf[logical] : logical);
      const red = work[here];
      const green = work[here + 1];
      const blue = work[here + 2];
      const partR = (red * seep) >> 8;
      const partG = (green * seep) >> 8;
      const partB = (blue * seep) >> 8;
      if (row) {
        const up = logical - width;
        const before = 3 * (indexOf ? indexOf[up] : up);
        work[before] = Math.min(255, work[before] + partR);
        work[before + 1] = Math.min(255, work[before + 1] + partG);
        work[before + 2] = Math.min(255, work[before + 2] + partB);
      }
      work[here] = Math.min(255, ((red * keep) >> 8) + carryR);
      work[here + 1] = Math.min(255, ((green * keep) >> 8) + carryG);
      work[here + 2] = Math.min(255, ((blue * keep) >> 8) + carryB);
      carryR = partR;
      carryG = partG;
      carryB = partB;
    }
  }
  return work;
}

function towardsTable(amount, target) {
  const key = amount * 256 + target;
  let table = towards.get(key);
  if (!table) {
    const divisor = f32(((amount >> 1) ^ 127) + 1.1);
    table = Uint8Array.from({ length: 256 }, (_, value) => {
      const gap = target - value;
      return (value + Math.sign(gap) + Math.trunc(f32(f32(gap) / divisor))) & 255;
    });
    towards.set(key, table);
  }
  return table;
}

/** Fade-towards helper on the displayed strip: each channel towards the word
 * 0xRRGGBB. */
export function fadeTowards(strip, amount, target = 0, length = LENGTH) {
  const red = towardsTable(amount, (target >> 16) & 255);
  const green = towardsTable(amount, (target >> 8) & 255);
  const blue = towardsTable(amount, target & 255);
  for (let at = 0; at < 3 * length; at += 3) {
    strip[at] = red[strip[at]];
    strip[at + 1] = green[strip[at + 1]];
    strip[at + 2] = blue[strip[at + 2]];
  }
  return strip;
}

// ── The demo beat (lamp_core.py explains it) ──────────────────────
const DEMO_BEAT_RENDERS = 12;
const DEMO_LOOP_RENDERS = 192;
const DEMO_ONSET = 96;

/** [level, onset, sync tick, the 16 spectrum bands] a render reads. */
export function demoSound(render) {
  render %= DEMO_LOOP_RENDERS;
  const beat = Math.trunc(render / DEMO_BEAT_RENDERS);
  const left = DEMO_BEAT_RENDERS - (render % DEMO_BEAT_RENDERS);
  let kick = Math.trunc((191 * left * left) / (DEMO_BEAT_RENDERS * DEMO_BEAT_RENDERS));
  if (beat % 4 === 3) kick >>= 1;
  const melody = 4 + Math.trunc((SIN8[(beat * 37) & 255] * 6) / 255);
  const hat = (render + (DEMO_BEAT_RENDERS >> 1)) % DEMO_BEAT_RENDERS;
  const bands = new Array(16);
  for (let band = 0; band < 16; band += 1) {
    if (band < 4) bands[band] = (kick * (4 - band)) >> 2;
    else if (band < 11) bands[band] = Math.max(0, 200 - 60 * Math.abs(band - melody));
    else bands[band] = Math.max(0, 170 - 14 * hat - 20 * (band - 11));
  }
  const onset = render % DEMO_BEAT_RENDERS === 0 ? DEMO_ONSET : 0;
  return [64 + kick, onset, (4 * render) & 255, bands];
}

/** Blur helper along the displayed pixels. */
export function stripBlur(strip, amount, length = LENGTH) {
  const keep = amount ^ 255;
  const seep = amount >> 1;
  let carryR = 0;
  let carryG = 0;
  let carryB = 0;
  for (let pixel = 0; pixel < length; pixel += 1) {
    const here = 3 * pixel;
    const red = strip[here];
    const green = strip[here + 1];
    const blue = strip[here + 2];
    const shareR = (red * seep) >> 8;
    const shareG = (green * seep) >> 8;
    const shareB = (blue * seep) >> 8;
    if (pixel) {
      strip[here - 3] = (strip[here - 3] + shareR) & 255;
      strip[here - 2] = (strip[here - 2] + shareG) & 255;
      strip[here - 1] = (strip[here - 1] + shareB) & 255;
    }
    strip[here] = (((red * keep) >> 8) + carryR) & 255;
    strip[here + 1] = (((green * keep) >> 8) + carryG) & 255;
    strip[here + 2] = (((blue * keep) >> 8) + carryB) & 255;
    carryR = shareR;
    carryG = shareG;
    carryB = shareB;
  }
  return strip;
}
