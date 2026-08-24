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
const TIDE_HEAD_PATHS = [
  {
    positions: [
      16.0, 34.0, 21.0, 40.0, 24.0, 46.0, 29.0, 49.0, 35.0, 58.0, 40.0, 61.0,
      46.0, 65.0, 49.0, 70.0,
    ],
    durations: [
      5.4, 7.1, 5.8, 6.6, 7.7, 5.2, 6.9, 7.4, 5.6, 6.3, 7.9, 5.1, 6.8, 7.2, 5.9,
      6.5,
    ],
    cycleDuration: 103.4,
    timeOffset: 0.0,
  },
  {
    positions: [
      3.0, -16.0, -1.0, -23.0, -5.0, -22.0, -1.0, -15.0, 4.0, -19.0, -3.0,
      -23.0, -1.0, -16.0, 2.0, -19.0,
    ],
    durations: [
      6.2, 5.3, 7.6, 6.8, 5.7, 7.3, 6.1, 5.5, 7.9, 6.4, 5.1, 7.0, 6.7, 5.8, 7.5,
      6.0,
    ],
    cycleDuration: 102.9,
    timeOffset: 3.17,
  },
];

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

function tideHeadPosition(time, headIndex) {
  const path = TIDE_HEAD_PATHS[headIndex];
  let local =
    (((time + path.timeOffset) % path.cycleDuration) + path.cycleDuration) %
    path.cycleDuration;
  for (let index = 0; index < path.durations.length; index++) {
    const duration = path.durations[index];
    if (local <= duration) {
      const start = path.positions[index];
      const end = path.positions[(index + 1) % path.positions.length];
      const unwrapped = start + (end - start) * (local / duration);
      return ((unwrapped % PREVIEW_COLS) + PREVIEW_COLS) % PREVIEW_COLS;
    }
    local -= duration;
  }
  return path.positions[0];
}

const BUILDING_BLOCK_BLUE = [0, 135, 255];

const HACKING_GREENS = [
  [60, 255, 80],
  [0, 210, 45],
  [25, 165, 50],
];
// Glyphs in display orientation (row 0 = top): 4 wide x 3 tall, centred with an
// empty row above and below. 0 is a hollow box; 1 has a top-left tick.
const HACKING_ZERO = [
  [1, 1, 1, 1],
  [1, 0, 0, 1],
  [1, 1, 1, 1],
];
const HACKING_ONE = [
  [1, 0, 0, 0],
  [1, 1, 1, 1],
  [1, 0, 0, 1],
];
const HACKING_GLYPH_ROWS = 3;
const HACKING_DIGIT_COUNT = 128; // long enough that the scroll loop is unnoticeable
let hackingStripCache = null;

// Deterministic strip of random 0/1 digits, one gap column between each,
// laid out once and reused (independent of phase).
function hackingStrip() {
  if (hackingStripCache) return hackingStripCache;
  const specs = [];
  let width = 0;
  for (let d = 0; d < HACKING_DIGIT_COUNT; d++) {
    const glyph = noiseAt(d, 0, 101) > 0.5 ? HACKING_ONE : HACKING_ZERO;
    const shade = Math.min(2, Math.floor(noiseAt(d, 0, 202) * 3));
    specs.push({ glyph, shade, x: width });
    width += glyph[0].length + 1; // 1-column gap after each digit
  }
  const cells = new Array(width * HACKING_GLYPH_ROWS).fill(null);
  const shades = new Array(width).fill(null); // per-column digit shade (incl. gap)
  for (const { glyph, shade, x } of specs) {
    const color = HACKING_GREENS[shade];
    for (let xx = 0; xx < glyph[0].length + 1; xx++) shades[x + xx] = color;
    for (let gr = 0; gr < HACKING_GLYPH_ROWS; gr++) {
      for (let gx = 0; gx < glyph[gr].length; gx++) {
        if (glyph[gr][gx]) cells[gr * width + x + gx] = color;
      }
    }
  }
  hackingStripCache = { cells, shades, width };
  return hackingStripCache;
}

// Left/Right stack along columns (dots travel over rows); Up/Down stack along
// rows (dots travel over columns). Dots land at the far end of their lane and
// pile back toward the entry side; movement matches the direction arrow.
function buildingBlockCells(phase, direction) {
  const spawnDt = 0.48; // phase units between successive dots
  const rise = 1.5; // cells travelled per phase unit
  const laneGap = 2.0 / rise; // keep >= 2 empty cells between moving dots
  const hold = 0.4; // brief full-panel pause before the reset
  const resetHold = 0.75;
  const vertical = direction === "Left" || direction === "Right";
  const laneCount = vertical ? PREVIEW_COLS : PREVIEW_ROWS;
  const laneLength = vertical ? PREVIEW_ROWS : PREVIEW_COLS;
  const total = laneCount * laneLength;
  const movingForward = direction === "Right" || direction === "Up";
  const counts = new Array(laneCount).fill(0);
  const lastSpawn = new Array(laneCount).fill(-laneGap);
  const events = [];
  let spawnTime = resetHold;
  let lastLanding = 0.0;

  for (let k = 0; k < total; k++) {
    if (k > 0) spawnTime += spawnDt;
    const startLane = Math.min(
      laneCount - 1,
      Math.floor(noiseAt(k, 0, 777) * laneCount),
    );
    let lane = -1;
    for (let offset = 0; offset < laneCount; offset++) {
      const candidate = (startLane + offset) % laneCount;
      if (
        counts[candidate] < laneLength &&
        spawnTime - lastSpawn[candidate] >= laneGap
      ) {
        lane = candidate;
        break;
      }
    }
    if (lane < 0) {
      let earliest = Infinity;
      for (let candidate = 0; candidate < laneCount; candidate++) {
        if (counts[candidate] < laneLength) {
          earliest = Math.min(earliest, lastSpawn[candidate] + laneGap);
        }
      }
      spawnTime = earliest;
      for (let offset = 0; offset < laneCount; offset++) {
        const candidate = (startLane + offset) % laneCount;
        if (
          counts[candidate] < laneLength &&
          spawnTime - lastSpawn[candidate] >= laneGap - 1e-9
        ) {
          lane = candidate;
          break;
        }
      }
    }
    const targetPos = movingForward
      ? laneLength - 1 - counts[lane]
      : counts[lane];
    counts[lane] += 1;
    lastSpawn[lane] = spawnTime;
    events.push([lane, targetPos, spawnTime]);
    const startPos = movingForward ? 0 : laneLength - 1;
    lastLanding = Math.max(
      lastLanding,
      spawnTime + Math.abs(targetPos - startPos) / rise,
    );
  }

  const cycle = lastLanding + hold;
  const local = ((phase % cycle) + cycle) % cycle;
  const grid = new Array(total).fill(null);
  for (const [lane, targetPos, eventTime] of events) {
    const spawnTime = eventTime;
    if (local < spawnTime) continue;
    let pos = movingForward
      ? rise * (local - spawnTime)
      : laneLength - 1 - rise * (local - spawnTime);
    if (movingForward && pos > targetPos) pos = targetPos;
    if (!movingForward && pos < targetPos) pos = targetPos;
    const cell = Math.floor(pos + 0.5);
    if (cell >= 0 && cell < laneLength) {
      const index = vertical
        ? cell * PREVIEW_COLS + lane
        : lane * PREVIEW_COLS + cell;
      grid[index] = BUILDING_BLOCK_BLUE;
    }
  }
  return grid;
}

function renderMagic(phase) {
  const waypoint = (seedX, seedY, index) => [
    noiseAt(seedX, index, 0) * 2.0 - 1.0,
    noiseAt(seedY, index, 0) * 2.0 - 1.0,
  ];
  const wander = (seedX, seedY, time) => {
    const index = Math.floor(time);
    const fraction = time - index;
    const p0 = waypoint(seedX, seedY, index - 1);
    const p1 = waypoint(seedX, seedY, index);
    const p2 = waypoint(seedX, seedY, index + 1);
    const p3 = waypoint(seedX, seedY, index + 2);
    const fraction2 = fraction * fraction;
    const fraction3 = fraction2 * fraction;
    return [0, 1].map(
      (axis) =>
        0.5 *
        (2.0 * p1[axis] +
          (-p0[axis] + p2[axis]) * fraction +
          (2.0 * p0[axis] - 5.0 * p1[axis] + 4.0 * p2[axis] - p3[axis]) *
            fraction2 +
          (-p0[axis] + 3.0 * p1[axis] - 3.0 * p2[axis] + p3[axis]) * fraction3),
    );
  };

  const oscillation = Math.sin(phase * 0.4);
  const radii = [27.0 + 13.0 * oscillation, 27.0 - 13.0 * oscillation];
  const settings = [
    [11, 12, 0.0],
    [13, 14, 2.7],
  ];
  const points = settings.map(([seedX, seedY, offset], index) => {
    const [wx, wy] = wander(seedX, seedY, phase * 0.225 + offset);
    const stretch = 0.25 * Math.sin(phase * 0.31 + index * 1.7);
    return [
      9.5 + 20.0 * wx,
      2.0 + 5.0 * wy,
      radii[index],
      1.0 + stretch,
      1.0 - stretch,
    ];
  });

  let hues = [];
  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const samples = points.map(([px, py, radius, scaleX, scaleY]) => {
        const distance = Math.hypot((col - px) * scaleX, (row - py) * scaleY);
        const radial = Math.max(0.0, distance / radius - 0.03);
        return [
          0.88 * Math.tanh(2.4 * radial) ** 0.75,
          1.0 / (distance * distance * 0.08 + 1.0),
        ];
      });
      const sineSum = samples.reduce(
        (sum, [hue, weight]) => sum + weight * Math.sin(TAU * hue),
        0.0,
      );
      const cosineSum = samples.reduce(
        (sum, [hue, weight]) => sum + weight * Math.cos(TAU * hue),
        0.0,
      );
      let hue = Math.atan2(sineSum, cosineSum) / TAU;
      if (hue < 0.0) hue += 1.0;
      const reddestSource = Math.min(
        ...samples.map(([sourceHue]) => sourceHue),
      );
      const dominantHue = samples.reduce((dominant, sample) =>
        sample[1] > dominant[1] ? sample : dominant,
      )[0];
      if (reddestSource < 0.025) hue = reddestSource;
      else if (hue < 0.075 || hue > 0.96) hue = Math.max(0.08, dominantHue);
      if (hue < 0.075) hue *= 0.08 / 0.075;
      else if (hue < 0.14) hue = 0.08 + ((hue - 0.075) * 0.12) / 0.065;
      else if (hue < 0.44) hue = 0.2 + ((hue - 0.14) * 0.23) / 0.3;
      else if (hue < 0.59) hue = 0.43 + ((hue - 0.44) * 0.15) / 0.15;
      else if (hue < 0.75) hue = 0.58 + ((hue - 0.59) * 0.17) / 0.16;
      hues.push(hue);
    }
  }

  const orderedHues = [...hues].sort((left, right) => left - right);
  const extendedHues = orderedHues.concat(orderedHues.map((hue) => hue + 1.0));
  let hueSpan = Infinity;
  for (let index = 0; index < 100; index++) {
    hueSpan = Math.min(hueSpan, extendedHues[index + 89] - extendedHues[index]);
  }
  if (hueSpan < 0.217) {
    const sineMean =
      hues.reduce((sum, hue) => sum + Math.sin(TAU * hue), 0.0) / hues.length;
    const cosineMean =
      hues.reduce((sum, hue) => sum + Math.cos(TAU * hue), 0.0) / hues.length;
    let center = Math.atan2(sineMean, cosineMean) / TAU;
    if (center < 0.0) center += 1.0;
    const scale = 0.217 / Math.max(hueSpan, 1e-6);
    hues = hues.map((hue) => {
      const difference = ((((hue - center + 0.5) % 1.0) + 1.0) % 1.0) - 0.5;
      return (((center + difference * scale) % 1.0) + 1.0) % 1.0;
    });
  }

  const coolCount = (values) =>
    values.filter((hue) => hue >= 0.58 && hue < 0.96).length;
  if (coolCount(hues) > 88) {
    for (let step = 1; step <= 50; step++) {
      const shift = step * 0.01;
      let shifted = hues.map((hue) => (((hue - shift) % 1.0) + 1.0) % 1.0);
      if (coolCount(shifted) <= 88) {
        hues = shifted;
        break;
      }
      shifted = hues.map((hue) => (hue + shift) % 1.0);
      if (coolCount(shifted) <= 88) {
        hues = shifted;
        break;
      }
    }
  }

  return hues.map((hue) => hsv(hue, 1.0, 1.0));
}

/**
 * Render one animated 20x5 approximation frame of a firmware effect.
 * Returns a flat array of 100 [r,g,b] tuples in row-major order
 * (row 0 = top, col 0 = left).
 */
export function renderNativeEffect(effect, phase, direction = "Up") {
  if (effect === "Magic") return renderMagic(phase);

  const frame = Math.floor(phase * 5);
  const pixels = [];
  let buildingBlockGrid = null; // lazily built once per frame

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
        // Sparse blue stars that pop on and slowly fade to black. Each pixel
        // runs its own cycle (stable random phase + rate) so stars appear and
        // fade independently instead of the whole panel jumping between states.
        // `phase` already scales with the effect speed, so a higher speed
        // shortens the fade -- matching the real firmware, where speed controls
        // the fade rate rather than a spawn rate.
        const seed = noiseAt(col, row, 0);
        const seed2 = noiseAt(col, row, 999);
        const cycleRate = 0.25 + 0.3 * seed2;
        const local = (((phase * cycleRate + seed) % 1.0) + 1.0) % 1.0;
        const rise = 0.04;
        const fade = 0.34;
        let level;
        if (local < rise) {
          level = local / rise;
        } else if (local < rise + fade) {
          level = 1.0 - (local - rise) / fade;
        } else {
          level = 0.0;
        }
        color = rgb(30, 140, 255, level);
      } else if (effect === "Spectrum") {
        // A full rainbow gradient painted pixel-by-pixel, red -> magenta.
        // "Right" scans line-by-line (bottom-left red, top-right magenta);
        // "Down" scans column-by-column (bottom-left red, top-right magenta);
        // "Left"/"Up" are the 180-degree rotations of "Right"/"Down".
        const last = PREVIEW_COLS * PREVIEW_ROWS - 1;
        let index;
        if (direction === "Down" || direction === "Up") {
          index = col * PREVIEW_ROWS + row;
          if (direction === "Up") index = last - index;
        } else {
          index = (PREVIEW_ROWS - 1 - row) * PREVIEW_COLS + col;
          if (direction === "Left") index = last - index;
        }
        const t = index / last;
        color = hsv(
          t * 0.83,
          1.0,
          0.82 + 0.18 * Math.sin((t + phase * 0.08) * TAU),
        );
      } else if (effect === "Ocean Waves") {
        // Right/Left reuse Up/Down coordinates so device-orientation rotation renders correctly.
        let ow_u, ow_v;
        if (direction === "Right") {
          ow_u = y;
          ow_v = x;
        } else if (direction === "Left") {
          ow_u = 1.0 - y;
          ow_v = x;
        } else {
          ow_u = u;
          ow_v = v;
        }
        // Source offset matches physical lamp: Down/Right shift left, Up/Left shift right.
        const vCenter =
          direction === "Down" || direction === "Right"
            ? 0.5 - 2.0 / 19.0
            : 0.5 + 2.0 / 19.0;
        const du = ow_u;
        const dv = (ow_v - vCenter) * 2.2;
        const dist = Math.hypot(du, dv);
        const ripple = (Math.sin((dist * 1.0 - phase) * TAU) + 1.0) / 2.0;
        color = hsv(0.64 - 0.07 * ripple, 0.97, 0.12 + 0.88 * ripple);
      } else if (effect === "Rainbow") {
        // Swap the Right<->Down and Left<->Up direction pairs to match the lamp.
        const rainbowRemap = {
          Right: "Down",
          Down: "Right",
          Left: "Up",
          Up: "Left",
        };
        const [ru] = flowCoordinates(
          col,
          row,
          rainbowRemap[direction] || direction,
        );
        // Smoothly sweep the hue magenta -> red, then hard-jump back to magenta
        // and loop -- a sharp trailing switch instead of a smooth fade-out.
        const s = (((ru - phase * 0.18) % 1.0) + 1.0) % 1.0;
        color = hsv(s * 0.85, 0.95, 0.95);
      } else if (effect === "Waterfall") {
        // Blue dots spawn on one edge and travel to the opposite edge at a
        // constant speed, each leaving a fixed-length trail fading to black.
        // Spawn times per lane are jittered (irregular) so dots appear at
        // random moments rather than a fixed rhythm. Direction picks the axis:
        //   Right: top->bottom, Left: bottom->top (lanes = columns)
        //   Down:  left->right, Up:   right->left (lanes = rows)
        let lane;
        let pos;
        if (direction === "Left" || direction === "Right") {
          lane = col;
          pos = direction === "Right" ? PREVIEW_ROWS - 1 - row : row;
        } else {
          lane = row;
          pos = direction === "Down" ? col : PREVIEW_COLS - 1 - col;
        }
        const v = 7.0; // pixels per phase unit (same speed everywhere)
        const trailPixels = 7.5;
        const spawn = 2.5; // avg phase units between spawns per lane
        const lo = phase - (pos + trailPixels) / v;
        const hi = phase - pos / v;
        let level = 0.0;
        const nStart = Math.floor(lo / spawn) - 1;
        const nEnd = Math.ceil(hi / spawn) + 1;
        for (let n = nStart; n <= nEnd; n++) {
          // Jitter each spawn slot's emission time within its interval.
          const emit =
            n * spawn + (noiseAt(lane, n + 1024, 0) - 0.5) * spawn * 0.9;
          if (emit >= lo && emit <= hi) {
            const d = (phase - emit) * v - pos; // distance behind the head
            level = Math.max(level, 1.0 - d / trailPixels);
          }
        }
        color = rgb(30, 140, 255, level);
      } else if (effect === "Aurora") {
        // Snake of green LEDs travelling along the raster path (row-major
        // index). A ~40px segment (bright ~7px centre, long gradient tails)
        // slides pixel by pixel and disappears off an edge. Each snake spawns
        // at a random position -- off an edge (slides in) or on-screen in the
        // middle (fades in slowly) -- and heads up or down; a single snake
        // never reverses. Randomised so it never feels like a loop. Overlaps
        // take the brightest value (max-combine).
        const cellCount = PREVIEW_COLS * PREVIEW_ROWS;
        // Left/Right run the snake row-major (line by line); Up/Down run it
        // column-major (column by column).
        const idx =
          direction === "Up" || direction === "Down"
            ? col * PREVIEW_ROWS + row
            : row * PREVIEW_COLS + col;
        const coreHalf = 3.5; // ~7px bright centre
        const falloff = 24.0; // coreHalf+falloff = 27.5 -> 55px segment
        const reach = coreHalf + falloff;
        const last = cellCount - 1;
        const v = 9.0; // pixels per phase unit
        const fadeIn = 2.2; // phase units to fade a snake in (slow centre appear)
        const span = last + 2 * reach;
        const minTravel = 0.4 * span; // keep snakes on-screen long enough
        const maxLife = span / v;
        const spawn = maxLife / 3.5; // avg ~2.5 snakes (mostly 2-3) on screen
        let t = 0.0;
        const nLo = Math.floor((phase - maxLife) / spawn) - 1;
        const nHi = Math.floor(phase / spawn) + 1;
        for (let n = nLo; n <= nHi; n++) {
          const emit =
            n * spawn + (noiseAt(n + 4096, 7, 0) - 0.5) * spawn * 0.4;
          const age = phase - emit;
          if (age < 0.0) continue;
          const p0 = -reach + noiseAt(n + 4096, 11, 0) * span;
          let dir;
          if (p0 < 0)
            dir = 1; // off the top edge -> must slide down
          else if (p0 > last)
            dir = -1; // off the bottom edge -> must slide up
          else {
            dir = noiseAt(n + 4096, 9, 0) < 0.5 ? 1 : -1;
            // Flip if this direction would exit too soon (avoids flicker).
            const travel = dir > 0 ? last + reach - p0 : p0 + reach;
            if (travel < minTravel) dir = -dir;
          }
          const life = dir > 0 ? (last + reach - p0) / v : (p0 + reach) / v;
          if (age > life) continue;
          const center = p0 + dir * v * age;
          const fade = Math.min(1.0, age / fadeIn);
          const d = Math.abs(idx - center);
          let ti = 0.0;
          if (d <= coreHalf) ti = 1.0;
          else if (d <= reach) ti = 1.0 - (d - coreHalf) / falloff;
          ti *= fade;
          if (ti > t) t = ti;
        }
        // Lerp dark blue-grey -> brighter deep green.
        color = rgb(
          14 + (15 - 14) * t,
          20 + (200 - 20) * t,
          34 + (75 - 34) * t,
        );
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
        // Triangle-wave bounce with constant velocity reflecting off walls.
        // Incommensurate x/y speed ratios keep the path dense and non-repeating.
        const tri = (t) => 1.0 - Math.abs((((t % 2.0) + 2.0) % 2.0) - 1.0);
        // The bounce table is 2x the visible area (centred): coords span
        // [-0.5, 1.5]. Frequencies are halved vs. the visible-only version so
        // the on-screen ball speed is unchanged despite the larger table.
        const ext = (t) => tri(t) * 2.0 - 0.5;
        const clamp01 = (c) => Math.max(0.0, Math.min(1.0, c));
        const ball1At = (p) => [ext(p * 0.309), ext(p * 0.207 + 0.5)];
        const ball2At = (p) => [ext(p * 0.381 + 1.3), ext(p * 0.267 + 0.9)];
        // Trailing trace: children sample each ball's OWN past positions, so
        // they follow its exact bouncing path. `spread` oscillates 0 (fused) ->
        // 1 (split) -> 0, shared by both balls so they divide/fuse in sync, and
        // never affects the main-ball position. Children are identical balls
        // (same colour and brightness), not faded ghosts.
        const spread = (1.0 - Math.cos(phase * 1.25)) * 0.5;
        const lag = 0.6;
        const offsets = [0.0, spread * lag, spread * lag * 2.0];
        // A ball out in the margin shows as a half-ball pinned to the border it
        // exited (clamped), sliding until it re-enters and moves freely again.
        let level = 0.03;
        for (const ballAt of [ball1At, ball2At]) {
          for (const dp of offsets) {
            const [bx, by] = ballAt(phase - dp);
            const points = [
              [clamp01(bx), clamp01(by)],
              [clamp01(1.0 - bx), clamp01(1.0 - by)],
            ];
            for (const [px, py] of points) {
              const d = Math.hypot((x - px) * 2.17, y - py);
              const contrib = Math.max(0.0, 1.0 - d * 3.6);
              if (contrib > level) level = contrib;
            }
          }
        }
        // Slow shared colour cycle: red -> violet -> pink -> blue -> cyan -> magenta -> red.
        const ballColor = palette(
          [
            [255, 0, 0],
            [148, 0, 211],
            [255, 105, 180],
            [0, 0, 255],
            [0, 255, 255],
            [255, 0, 255],
            [255, 0, 0],
          ],
          (phase * 0.12) % 1.0,
        );
        color = rgb(ballColor[0], ballColor[1], ballColor[2], level);
      } else if (effect === "Shooting Star") {
        // Black sky with independent shooting stars. Five slots cap the count
        // at 5; each runs its own spawn -> travel -> idle-gap cycle (~50% duty)
        // so 0 and 5 are both rare. Per spawn the lane, colour (10 rainbow
        // hues), speed and length (4-9 px) are random, and a fresh spawn can
        // reuse a busy lane. Direction picks the travel axis and sense:
        //   Left top->bottom, Right bottom->top (lanes = columns)
        //   Down left->right,  Up   right->left  (lanes = rows)
        const vertical = direction !== "Up" && direction !== "Down";
        const increasing = direction === "Left" || direction === "Down";
        const span = vertical ? PREVIEW_ROWS : PREVIEW_COLS;
        const laneCount = vertical ? PREVIEW_COLS : PREVIEW_ROWS;
        const laneIdx = vertical ? col : row;
        const pos = vertical ? row : col;
        const sphase = phase * 0.4; // 2.5x slower than the raw animation phase
        const SLOTS = 5;
        let best = 0.0;
        let starR = 0;
        let starG = 0;
        let starB = 0;
        for (let s = 0; s < SLOTS; s++) {
          const rate = 0.55 + 0.5 * noiseAt(s, 0, 7);
          const t = sphase * rate + noiseAt(s, 0, 8) * 7.0;
          const cyc = Math.floor(t);
          const local = t - cyc;
          const fallLen = 0.3 + 0.4 * noiseAt(s, cyc, 33);
          if (local >= fallLen) continue; // idle gap: no star this slot
          const starLane = Math.floor(noiseAt(s, cyc, 11) * laneCount);
          if (starLane !== laneIdx) continue;
          const length = 4 + Math.min(5, Math.floor(noiseAt(s, cyc, 44) * 6));
          const prog = local / fallLen;
          const travel = span + length + 1;
          let lo;
          let hi;
          if (increasing) {
            const head = -1.0 + prog * travel;
            lo = head - length;
            hi = head;
          } else {
            const head = span - prog * travel;
            lo = head;
            hi = head + length;
          }
          const dseg = Math.max(0.0, lo - pos, pos - hi);
          const lvl = Math.max(0.0, Math.min(1.0, 1.2 - dseg * 0.7));
          if (lvl > best) {
            best = lvl;
            const hue = Math.floor(noiseAt(s, cyc, 22) * 10) / 10;
            [starR, starG, starB] = hsv(hue, 1.0, 1.0);
          }
        }
        color = best > 0 ? rgb(starR, starG, starB, best) : [0, 0, 0];
      } else if (effect === "Tide") {
        // Independent heads on the top and bottom rows paint in either
        // direction for 2-3 seconds at a time. They wrap across the panel edges
        // and leave fading trails, with opposite row offsets bending each trail.
        const historyStep = 0.125;
        const historyStart = Math.floor(phase / historyStep) * historyStep;
        let bestLevel = 0.0;
        let paintHue = 0.0;
        for (let sample = 0; sample <= 72; sample++) {
          const sampleTime =
            sample === 0 ? phase : historyStart - (sample - 1) * historyStep;
          const age = phase - sampleTime;
          const fade =
            age <= 1.0 ? 1.0 : Math.max(0.0, 1.0 - (age - 1.0) / 3.0);
          for (let headIndex = 0; headIndex < 2; headIndex++) {
            const anchorRow = headIndex === 0 ? 0 : PREVIEW_ROWS - 1;
            const rowDistance = Math.abs(row - anchorRow);
            const rowTime = sampleTime - rowDistance * 0.11;
            const rowOffset =
              (row - anchorRow) * (headIndex === 0 ? 2.0 : -2.0);
            const head =
              (tideHeadPosition(rowTime, headIndex) +
                rowOffset +
                PREVIEW_COLS) %
              PREVIEW_COLS;
            const directDistance = Math.abs(col - head);
            const distance = Math.min(
              directDistance,
              PREVIEW_COLS - directDistance,
            );
            const coverage = Math.max(0.0, Math.min(1.0, 1.35 - distance));
            const level = coverage * fade;
            if (level > bestLevel) {
              bestLevel = level;
              paintHue =
                sampleTime * 0.045 -
                col / PREVIEW_COLS -
                row * 0.075 +
                headIndex * 0.12;
            }
          }
        }
        color =
          bestLevel > 0
            ? rgb(...hsv(paintHue, 1.0, 1.0), bestLevel)
            : [0, 0, 0];
      } else if (effect === "Building block") {
        if (buildingBlockGrid === null) {
          buildingBlockGrid = buildingBlockCells(phase, direction);
        }
        color = buildingBlockGrid[row * PREVIEW_COLS + col] || [0, 0, 0];
      } else if (effect === "Hacking") {
        if (direction === "Down" || direction === "Up") {
          if (row < 1 || row > 3) {
            color = [0, 0, 0];
          } else {
            const { cells, shades, width } = hackingStrip();
            const offset = Math.floor(phase * 1.5);
            const down = direction === "Down";
            const x = down
              ? (((col + offset) % width) + width) % width
              : (((offset - col) % width) + width) % width;
            const gr = down ? row - 1 : 3 - row;
            const entryCol = down ? PREVIEW_COLS - 1 : 0;
            // Hardware artefact: while a character is still scrolling in, the
            // entry-edge column lights all 3 rows, tinted with the shade of the
            // character currently leaving the opposite edge.
            if (col === entryCol && x % 5 <= 2) {
              const exitPos = down
                ? ((offset % width) + width) % width
                : (((offset - (PREVIEW_COLS - 1)) % width) + width) % width;
              color = shades[exitPos] || [0, 0, 0];
            } else {
              color = cells[gr * width + x] || [0, 0, 0];
            }
          }
        } else {
          const head = (phase * 0.8 + noiseAt(col, 0, 0)) % 1.0;
          const distance = (((head - u) % 1.0) + 1.0) % 1.0;
          const level =
            distance < 0.08 ? 1.0 : Math.max(0.04, 0.65 - distance * 1.8);
          color = rgb(25, 255, 85, level);
        }
      } else if (effect === "Flower Sea") {
        // Aurora-style flowing snakes, but each area is ~2x larger and rendered
        // in shades of pink: a baby-pink sea deepening to hot pink / near-magenta
        // where areas overlap. Each snake carries its own pink hue.
        const cellCount = PREVIEW_COLS * PREVIEW_ROWS;
        const idx =
          direction === "Up" || direction === "Down"
            ? col * PREVIEW_ROWS + row
            : row * PREVIEW_COLS + col;
        const coreHalf = 7.0; // 2x Aurora
        const falloff = 48.0; // 2x Aurora
        const reach = coreHalf + falloff;
        const last = cellCount - 1;
        const v = 9.0;
        const fadeIn = 0.73; // 3x faster appear than Aurora
        const span = last + 2 * reach;
        const minTravel = 0.4 * span;
        const maxLife = span / v;
        const spawn = maxLife / 3.5;
        let t = 0.0;
        let winHue = 0.95; // warm baby-pink for snake peaks
        const nLo = Math.floor((phase - maxLife) / spawn) - 1;
        const nHi = Math.floor(phase / spawn) + 1;
        for (let n = nLo; n <= nHi; n++) {
          const emit =
            n * spawn + (noiseAt(n + 4096, 7, 0) - 0.5) * spawn * 0.4;
          const age = phase - emit;
          if (age < 0.0) continue;
          const p0 = -reach + noiseAt(n + 4096, 11, 0) * span;
          let dir;
          if (p0 < 0) dir = 1;
          else if (p0 > last) dir = -1;
          else {
            dir = noiseAt(n + 4096, 9, 0) < 0.5 ? 1 : -1;
            const travel = dir > 0 ? last + reach - p0 : p0 + reach;
            if (travel < minTravel) dir = -dir;
          }
          const life = dir > 0 ? (last + reach - p0) / v : (p0 + reach) / v;
          if (age > life) continue;
          const center = p0 + dir * v * age;
          const fade = Math.min(1.0, age / fadeIn);
          const d = Math.abs(idx - center);
          let ti = 0.0;
          if (d <= coreHalf) ti = 1.0;
          else if (d <= reach) ti = 1.0 - (d - coreHalf) / falloff;
          ti *= fade;
          if (ti > t) {
            t = ti;
            winHue = 0.93 + 0.05 * noiseAt(n + 8192, 13, 0);
          }
        }
        // Half-sized snake always spawning from the centre; adds ~1 extra snake.
        const coreHalf2 = 3.5;
        const falloff2 = 24.0;
        const reach2 = coreHalf2 + falloff2;
        const p0c = last / 2.0;
        const maxLife2 = (p0c + reach2) / v;
        const spawn2 = maxLife2;
        const nLo2 = Math.floor((phase - maxLife2) / spawn2) - 1;
        const nHi2 = Math.floor(phase / spawn2) + 1;
        for (let n = nLo2; n <= nHi2; n++) {
          const emit2 =
            n * spawn2 + (noiseAt(n + 8888, 7, 0) - 0.5) * spawn2 * 0.2;
          const age2 = phase - emit2;
          if (age2 < 0.0) continue;
          const dir2 = noiseAt(n + 8888, 9, 0) < 0.5 ? 1 : -1;
          const life2 =
            dir2 > 0 ? (last + reach2 - p0c) / v : (p0c + reach2) / v;
          if (age2 > life2) continue;
          const center2 = p0c + dir2 * v * age2;
          const fade2 = Math.min(1.0, age2 / fadeIn);
          const d2 = Math.abs(idx - center2);
          let ti2 = 0.0;
          if (d2 <= coreHalf2) ti2 = 1.0;
          else if (d2 <= reach2) ti2 = 1.0 - (d2 - coreHalf2) / falloff2;
          ti2 *= fade2;
          if (ti2 > t) {
            t = ti2;
            winHue = 0.93 + 0.05 * noiseAt(n + 9999, 13, 0);
          }
        }
        // Background is hot pink; snake peaks are warm bright baby pink.
        const hue = 0.9 + (winHue - 0.9) * t;
        color = hsv(hue, 0.85 - 0.45 * t, 0.55 + 0.45 * t);
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
