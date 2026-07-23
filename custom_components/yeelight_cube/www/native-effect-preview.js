// ============================================================================
//  Native effect software preview (JS port of native_effect_preview.py)
// ============================================================================
//
// Client-side approximation of the Cube Lite firmware's built-in animations,
// used by the lamp preview card so its dot-matrix animates for Native Effect
// mode -- mirroring what the camera entity renders server-side.
//
// This MUST stay in sync with custom_components/yeelight_cube/native_effect_preview.py.
// The math below is a 1:1 translation (including the direction-aware Fire /
// Aurora / Tide handling).

export const PREVIEW_COLS = 20;
export const PREVIEW_ROWS = 5;

const TAU = Math.PI * 2;

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgb(red, green, blue, level = 1.0) {
  return [clamp(red * level), clamp(green * level), clamp(blue * level)];
}

// HSV (0..1 hue/sat/val) -> [r,g,b] 0..255. Matches Python colorsys.hsv_to_rgb.
function hsv(hue, saturation = 1.0, value = 1.0) {
  hue = ((hue % 1.0) + 1.0) % 1.0;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = value * (1 - saturation);
  const q = value * (1 - f * saturation);
  const t = value * (1 - (1 - f) * saturation);
  let r;
  let g;
  let b;
  switch (i % 6) {
    case 0:
      r = value;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = value;
      b = p;
      break;
    case 2:
      r = p;
      g = value;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = value;
      break;
    case 4:
      r = t;
      g = p;
      b = value;
      break;
    default:
      r = value;
      g = p;
      b = q;
      break;
  }
  return rgb(r * 255, g * 255, b * 255);
}

function noiseAt(col, row, frame) {
  // Match the Python 32-bit integer hash using BigInt for exactness.
  const mask = 0xffffffffn;
  let value =
    (BigInt(col) * 374761393n +
      BigInt(row) * 668265263n +
      BigInt(frame) * 2246822519n) &
    mask;
  value = ((value ^ (value >> 13n)) * 1274126177n) & mask;
  return Number((value ^ (value >> 16n)) & 0xffn) / 255.0;
}

function flowCoordinates(col, row, direction) {
  const x = col / (PREVIEW_COLS - 1);
  const y = row / (PREVIEW_ROWS - 1);
  if (direction === "Down") return [1.0 - y, x];
  if (direction === "Left") return [1.0 - x, y];
  if (direction === "Right") return [x, y];
  return [y, x]; // Up (default)
}

function palette(stops, position) {
  position = Math.max(0.0, Math.min(1.0, position));
  const scaled = position * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const start = stops[index];
  const end = stops[index + 1];
  return [
    clamp(start[0] + (end[0] - start[0]) * local),
    clamp(start[1] + (end[1] - start[1]) * local),
    clamp(start[2] + (end[2] - start[2]) * local),
  ];
}

/**
 * Render one animated 20x5 approximation frame of a firmware effect.
 * Returns a flat array of 100 [r,g,b] tuples in row-major order
 * (row 0 = top, col 0 = left).
 */
export function renderNativeEffect(effect, phase, direction = "Up") {
  const frame = Math.floor(phase * 5);
  const pixels = [];

  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const x = col / (PREVIEW_COLS - 1);
      const y = row / (PREVIEW_ROWS - 1);
      const [u, v] = flowCoordinates(col, row, direction);
      const wave = (Math.sin((u * 2.0 - phase) * TAU) + 1.0) / 2.0;
      const noise = noiseAt(col, row, frame);
      let color;

      if (effect === "Streamer") {
        // The whole panel is one uniform color that slowly morphs through
        // the spectrum as phase advances -- no spatial variation.
        color = hsv((((phase * 0.08) % 1.0) + 1.0) % 1.0, 0.9, 0.88);
      } else if (effect === "Starry sky") {
        const twinkle =
          Math.max(0.0, Math.sin((noise * 3.0 + phase) * TAU)) ** 7;
        color = rgb(110, 165, 255, 0.08 + 0.92 * twinkle);
      } else if (effect === "Spectrum") {
        color = hsv(
          x * 0.9,
          1.0,
          0.82 + 0.18 * Math.sin((x + phase * 0.08) * TAU),
        );
      } else if (effect === "Ocean Waves") {
        // Concentric ripples radiating from a source point at the "bottom"
        // centre (along the flow axis), matching the real firmware effect:
        // deep-blue troughs, cyan crests, wide bands.
        const du = u; // 0 at the source edge (u=0), grows toward u=1
        const dv = (v - 0.5) * 2.2; // perpendicular spread, aspect-weighted
        const dist = Math.hypot(du, dv);
        const ripple = (Math.sin((dist * 1.0 - phase) * TAU) + 1.0) / 2.0;
        color = hsv(0.64 - 0.07 * ripple, 0.97, 0.12 + 0.88 * ripple);
      } else if (effect === "Rainbow") {
        color = hsv(u - phase * 0.18, 0.95, 0.95);
      } else if (effect === "Waterfall") {
        const trail =
          Math.max(
            0.0,
            Math.sin((u * 3.0 - phase * 1.4 + noise * 0.3) * TAU),
          ) ** 3;
        color = rgb(20, 125 + 110 * trail, 255, 0.18 + 0.82 * trail);
      } else if (effect === "Aurora") {
        // Curtains hang perpendicular to the flow (v) and shift along it (u).
        const curtain =
          (Math.sin((v * 1.6 + phase * 0.22) * TAU + u * 2.0) + 1.0) / 2.0;
        const base = palette(
          [
            [18, 255, 143],
            [20, 126, 255],
            [192, 55, 255],
          ],
          curtain,
        );
        color = rgb(base[0], base[1], base[2], 0.3 + 0.7 * wave);
      } else if (effect === "Bonfire") {
        // Flames rise along the flow axis (u); flicker varies across it (v).
        const heat = Math.max(
          0.0,
          1.0 - u + noise * 0.45 - 0.2 * Math.sin((v * 3 + phase) * TAU),
        );
        color = palette(
          [
            [70, 0, 0],
            [255, 35, 0],
            [255, 200, 0],
            [255, 255, 180],
          ],
          Math.min(1.0, heat),
        );
      } else if (effect === "Pinball") {
        const centerX = (Math.sin(phase * 1.7) + 1.0) * 0.5;
        const centerY = Math.abs(Math.sin(phase * 2.3));
        const distance = Math.hypot((x - centerX) * 1.8, y - centerY);
        const level = Math.max(0.03, 1.0 - distance * 3.6);
        color = rgb(255, 65, 190, level);
      } else if (effect === "Shooting Star") {
        const position = (((u - phase * 0.7) % 1.0) + 1.0) % 1.0;
        const trail = Math.max(0.0, 1.0 - position * 5.0);
        color = rgb(
          130 + 125 * trail,
          170 + 85 * trail,
          255,
          0.08 + 0.92 * trail,
        );
      } else if (effect === "Tide") {
        // Water rises along the flow axis (u); ripples run across it (v).
        const height = 0.46 + 0.25 * Math.sin((v * 1.5 - phase * 0.35) * TAU);
        const level = u > height ? 0.15 : 0.55 + 0.45 * wave;
        color = rgb(0, 145, 255, level);
      } else if (effect === "Building block") {
        const block =
          (((Math.trunc(u * 8 - phase * 2.0) + Math.trunc(v * 4)) % 6) + 6) % 6;
        color = [
          [255, 58, 52],
          [255, 190, 24],
          [46, 224, 95],
          [35, 155, 255],
          [164, 64, 255],
          [255, 67, 190],
        ][block];
      } else if (effect === "Hacking") {
        const head = (phase * 0.8 + noiseAt(col, 0, 0)) % 1.0;
        const distance = (((head - u) % 1.0) + 1.0) % 1.0;
        const level =
          distance < 0.08 ? 1.0 : Math.max(0.04, 0.65 - distance * 1.8);
        color = rgb(25, 255, 85, level);
      } else if (effect === "Flower Sea") {
        const petal = Math.abs(
          Math.sin((x * 3.5 + y * 2.0 + phase * 0.25) * TAU),
        );
        color = hsv(0.82 + 0.22 * x + phase * 0.03, 0.75, 0.25 + 0.75 * petal);
      } else if (effect === "Magic") {
        const angle = Math.atan2(y - 0.5, x - 0.5) / TAU;
        const radius = Math.hypot((x - 0.5) * 1.6, y - 0.5);
        color = hsv(angle + radius - phase * 0.2, 0.85, 0.35 + 0.65 * wave);
      } else if (effect === "Wonderland") {
        color = hsv(0.48 + x * 0.36 + phase * 0.025, 0.48, 0.55 + 0.45 * wave);
      } else if (effect === "Kaleidoscope") {
        const sx = Math.abs(x - 0.5) * 2.0;
        const sy = Math.abs(y - 0.5) * 2.0;
        const pattern =
          (Math.sin((sx + sy - phase * 0.35) * TAU * 2.0) + 1.0) / 2.0;
        color = hsv(
          sx * 0.35 + sy * 0.4 + phase * 0.05,
          0.9,
          0.22 + 0.78 * pattern,
        );
      } else if (effect === "Palette") {
        const index =
          (Math.trunc(x * 8) + Math.trunc(y * 3) + Math.trunc(phase * 0.7)) % 8;
        color = hsv(index / 8.0, 0.72, 0.95);
      } else {
        color = hsv(x + phase * 0.05, 0.8, 0.35 + 0.65 * wave);
      }

      pixels.push(color);
    }
  }

  return pixels;
}
