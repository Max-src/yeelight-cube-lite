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

// Row orientation convention (READ BEFORE ADDING A PREVIEW): renderNativeEffect
// returns rows with ROW 0 = the panel's PHYSICAL BOTTOM (camera.py maps preview
// row 0 to the image bottom; this card does the same). Videos used to reverse-
// engineer an effect have array row 0 = image TOP, so any phase field / row
// term fit from a recording MUST index the row axis flipped (PREVIEW_ROWS-1-row)
// or the preview renders upside down. renderCarousel is the reference example.

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

function smoothstep(value) {
  return value * value * (3.0 - 2.0 * value);
}

function valueNoise2d(x, y, frame) {
  const col = Math.floor(x);
  const row = Math.floor(y);
  const colMix = smoothstep(x - col);
  const rowMix = smoothstep(y - row);
  const top =
    noiseAt(col, row, frame) +
    (noiseAt(col + 1, row, frame) - noiseAt(col, row, frame)) * colMix;
  const bottom =
    noiseAt(col, row + 1, frame) +
    (noiseAt(col + 1, row + 1, frame) - noiseAt(col, row + 1, frame)) * colMix;
  return top + (bottom - top) * rowMix;
}

function valueNoise3d(x, y, time) {
  const frame = Math.floor(time);
  const frameMix = smoothstep(time - frame);
  const current = valueNoise2d(x, y, frame);
  const following = valueNoise2d(x, y, frame + 1);
  return current + (following - current) * frameMix;
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

function renderWonderland(phase) {
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

  const oscillation = Math.sin(phase * 0.18);
  const radii = [5.0 + 1.5 * oscillation, 6.2 - 1.5 * oscillation];
  const settings = [
    [11, 12, 0.0, 0.54, 4.0],
    [13, 14, 2.7, 0.84, 6.0],
  ];
  const fields = settings.map(([seedX, seedY, offset, hue, peak], index) => {
    const [wx, wy] = wander(seedX, seedY, phase * 0.29 + offset);
    const stretch = 0.2 * Math.sin(phase * 0.18 + index * 1.7);
    return [
      9.5 + 20.0 * wx,
      2.0 + 8.0 * wy,
      radii[index],
      hue,
      1.0 + stretch,
      (1.0 - stretch) * 1.8,
      peak,
    ];
  });

  const pixels = [];
  const baseHue = 0.65;
  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      let sineSum = Math.sin(TAU * baseHue);
      let cosineSum = Math.cos(TAU * baseHue);
      for (const [px, py, radius, hue, scaleX, scaleY, peak] of fields) {
        const distance = Math.hypot((col - px) * scaleX, (row - py) * scaleY);
        const weight = peak / ((distance * distance) / (radius * radius) + 1.0);
        sineSum += weight * Math.sin(TAU * hue);
        cosineSum += weight * Math.cos(TAU * hue);
      }
      let hue = Math.atan2(sineSum, cosineSum) / TAU;
      if (hue < 0.0) hue += 1.0;
      const softness = Math.min(1.0, Math.max(0.0, (hue - 0.54) / 0.3));
      pixels.push(hsv(hue, 0.72 - 0.2 * softness, 1.0));
    }
  }
  return pixels;
}

function renderFlowerSea(phase, direction) {
  const velocity = 0.16;
  const fadeIn = 0.73;
  const events = [];

  const addEvents = (coreHalf, falloff, seed, centered = false) => {
    const reach = coreHalf + falloff;
    const span = 1.0 + 2.0 * reach;
    const maxLife = (centered ? 0.5 + reach : span) / velocity;
    const spawn = centered ? maxLife : maxLife / 3.5;
    const eventStart = Math.floor((phase - maxLife) / spawn) - 1;
    const eventEnd = Math.floor(phase / spawn) + 1;
    for (let event = eventStart; event <= eventEnd; event++) {
      const jitter = centered ? 0.2 : 0.4;
      const emit =
        event * spawn + (noiseAt(event + seed, 7, 0) - 0.5) * spawn * jitter;
      const age = phase - emit;
      if (age < 0.0) continue;
      const start = centered
        ? 0.5
        : -reach + noiseAt(event + seed, 11, 0) * span;
      let travelDirection;
      if (centered) {
        travelDirection = noiseAt(event + seed, 9, 0) < 0.5 ? 1 : -1;
      } else if (start < 0.0) {
        travelDirection = 1;
      } else if (start > 1.0) {
        travelDirection = -1;
      } else {
        travelDirection = noiseAt(event + seed, 9, 0) < 0.5 ? 1 : -1;
        const minimumTravel = 0.4 * span;
        const travel =
          travelDirection > 0 ? 1.0 + reach - start : start + reach;
        if (travel < minimumTravel) travelDirection = -travelDirection;
      }
      const life =
        travelDirection > 0
          ? (1.0 + reach - start) / velocity
          : (start + reach) / velocity;
      if (age > life) continue;
      const saturationNoise = noiseAt(event + seed + 6144, 17, 0);
      const peakSaturation = centered
        ? 0.5 + 0.28 * saturationNoise
        : 0.3 + 0.42 * saturationNoise;
      events.push([
        start + travelDirection * velocity * age,
        coreHalf,
        falloff,
        Math.min(1.0, age / fadeIn),
        0.78 + 0.2 * noiseAt(event + seed + 4096, 13, 0) ** 0.7,
        peakSaturation,
      ]);
    }
  };

  addEvents(0.08, 0.4, 4096);
  addEvents(0.04, 0.2, 8888, true);

  const vertical = direction === "Up" || direction === "Down";
  const bandCount = vertical ? PREVIEW_COLS : PREVIEW_ROWS;
  const reverse = direction === "Left" || direction === "Up";

  const bandColors = [];
  for (let band = 0; band < bandCount; band++) {
    let position = bandCount > 1 ? band / (bandCount - 1) : 0.5;
    if (reverse) position = 1.0 - position;
    let level = 0.0;
    let hue = 0.93;
    let peakSaturation = 0.98;
    for (const [
      center,
      coreHalf,
      falloff,
      fade,
      eventHue,
      eventSaturation,
    ] of events) {
      const distance = Math.abs(position - center);
      let contribution = 0.0;
      if (distance <= coreHalf) contribution = fade;
      else if (distance <= coreHalf + falloff) {
        contribution = fade * (1.0 - (distance - coreHalf) / falloff);
      }
      if (contribution > level) {
        level = contribution;
        hue = eventHue;
        peakSaturation = eventSaturation;
      }
    }
    const saturation = 0.98 - (0.98 - peakSaturation) * level ** 2;
    const value = 0.72 + 0.28 * level;
    const colorHue = 0.93 + (hue - 0.93) * Math.sqrt(level);
    bandColors.push(hsv(colorHue, saturation, value));
  }

  const pixels = [];
  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      pixels.push(bandColors[vertical ? col : row]);
    }
  }
  return pixels;
}

// The lamp's four Kaleidoscope variants read 90 deg rotated from the on-screen
// arrow (verified on hardware): selecting Right looks like the preview's Up,
// Down like Right, Left like Down, Up like Left. Relabel so each arrow shows the
// variant the lamp actually plays.
const KALEIDOSCOPE_PREVIEW_DIRECTION = {
  Up: "Left",
  Left: "Down",
  Down: "Right",
  Right: "Up",
};

function renderKaleidoscope(phase, direction) {
  direction = KALEIDOSCOPE_PREVIEW_DIRECTION[direction] || direction;
  if (direction === "Up" || direction === "Down") {
    return renderKaleidoscopeSnakes(phase, direction);
  }
  return renderKaleidoscopeRows(phase, direction);
}

function kaleidoscopeBaseHue(phase) {
  return (
    (((0.47 +
      0.105 * Math.sin(phase * 0.16) +
      0.06 * Math.sin(phase * 0.16 * 0.37 + 1.4)) %
      1.0) +
      1.0) %
    1.0
  );
}

function renderKaleidoscopeRows(phase, direction) {
  // One continuous rainbow path folds through all five rows. A cycle still
  // spans about two rows, but it now crosses every row boundary naturally.
  const wavelength = 55.0;
  const speed = 8.8;
  const baseHue = kaleidoscopeBaseHue(phase);
  const arrow = direction === "Left" ? -1.0 : 1.0;

  const pixels = [];
  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const foldedCol = row % 2 === 0 ? col : PREVIEW_COLS - 1 - col;
      const position = row * PREVIEW_COLS + foldedCol;
      // A smooth path-wide warp breaks the mechanical stripe spacing without
      // introducing discontinuities where the rows fold.
      const warped =
        position +
        1.8 *
          Math.sin(
            TAU * (position / (PREVIEW_ROWS * PREVIEW_COLS) + phase * 0.035),
          );
      const progress =
        ((((warped - arrow * speed * phase) / wavelength) % 1.0) + 1.0) % 1.0;
      const rawHue = (((baseHue + progress) % 1.0) + 1.0) % 1.0;
      // The firmware dwells in broad cyan fields between narrower full
      // spectrum passages instead of distributing every hue uniformly.
      const hue =
        (((rawHue + 0.145 * Math.sin(TAU * rawHue)) % 1.0) + 1.0) % 1.0;
      pixels.push(hsv(hue, 0.97, 1.0));
    }
  }
  return pixels;
}

function kaleidoscopeSnakeEmit(event) {
  return event * 3.25 + (noiseAt(event + 101, 17, 0) - 0.5) * 2.0;
}

function kaleidoscopeSnakeEvents(phase) {
  const spawnDt = 3.25;
  const branchLen = 8 * PREVIEW_ROWS + (PREVIEW_ROWS - 1);
  const latest = Math.floor(phase / spawnDt);
  const events = [];
  for (let event = latest - 8; event <= latest + 1; event++) {
    const emit = kaleidoscopeSnakeEmit(event);
    const age = phase - emit;
    const lifetime = 8.0 + 3.0 * noiseAt(event + 47, 9, 0);
    if (age < 0.0 || age >= lifetime) continue;
    const trail = 18.0 + 12.0 * noiseAt(event + 73, 11, 0);
    const hueSpan = 0.65 + 0.33 * noiseAt(event + 89, 13, 0);
    const progress = age / lifetime;
    const remaining = 1.0 - progress;
    const travel = branchLen + trail;
    const radius = travel * (1.0 - remaining ** 4);
    const velocity = (4.0 * travel * remaining ** 3) / lifetime;
    events.push([radius, velocity, trail, hueSpan, event]);
  }
  return events;
}

function mirroredPathDistance(position, origin, period) {
  return Math.abs(
    ((((position - origin + period / 2.0) % period) + period) % period) -
      period / 2.0,
  );
}

function kaleidoscopeMirrorColumn(col) {
  return Math.round(mirroredPathDistance(col, 7.0, 16.0));
}

function renderKaleidoscopeSnakes(phase, direction) {
  const baseHue = (((kaleidoscopeBaseHue(phase) - 0.08) % 1.0) + 1.0) % 1.0;

  // Down originates at one-based column 8 (index 7). The branch repeats
  // every 16 columns, meeting its reflection at one-based column 16.
  const pathHue = new Array(PREVIEW_ROWS * PREVIEW_COLS).fill(null);
  const pathAge = new Array(PREVIEW_ROWS * PREVIEW_COLS).fill(Infinity);
  for (const [radius, , trail, hueSpan] of kaleidoscopeSnakeEvents(phase)) {
    for (let row = 0; row < PREVIEW_ROWS; row++) {
      for (let col = 0; col < PREVIEW_COLS; col++) {
        const mirrorCol = kaleidoscopeMirrorColumn(col);
        const branchRow = mirrorCol % 2 === 0 ? row : PREVIEW_ROWS - 1 - row;
        const branchPos = mirrorCol * PREVIEW_ROWS + branchRow;
        const distance = radius - branchPos;
        const index = row * PREVIEW_COLS + col;
        if (distance < 0.0 || distance >= trail || distance >= pathAge[index]) {
          continue;
        }
        pathAge[index] = distance;
        const progress = distance / trail;
        pathHue[index] =
          (((0.02 +
            hueSpan * progress ** 1.15 +
            0.05 * Math.sin(TAU * progress)) %
            1.0) +
            1.0) %
          1.0;
      }
    }
  }

  const hues = pathHue.map((value) => (value === null ? baseHue : value));
  const sats = pathHue.map((value) => (value === null ? 0.9 : 0.98));

  const pixels = hues.map((hue, index) => hsv(hue, sats[index], 1.0));
  if (direction === "Up") pixels.reverse();
  return pixels;
}

function bluePulseOrigin(phase) {
  // Slow drift of the source/end, matching the recording's ~140 s wander.
  return (
    (((9.5 +
      5.8 * Math.sin(phase * 0.045 + 0.7) +
      1.6 * Math.sin(phase * 0.045 * 0.39 + 2.1)) %
      PREVIEW_COLS) +
      PREVIEW_COLS) %
    PREVIEW_COLS
  );
}

function bluePulseOffsets(phase, rate, rowSkew) {
  const origin = bluePulseOrigin(phase);
  const travel = phase * rate;
  const front = 8.0 * (travel - Math.floor(travel));
  const offsets = [];

  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const position = col + (row / (PREVIEW_ROWS - 1) - 0.5) * rowSkew;
      const distance = mirroredPathDistance(position, origin, 16.0);
      offsets.push(distance - front);
    }
  }

  return offsets;
}

function renderBlueWhite(phase, direction) {
  void direction;
  const sigma = 1.25;
  return bluePulseOffsets(phase, 0.17, 0.7).map((offset) => {
    const spread = offset <= 0.0 ? sigma : sigma * 0.6;
    let level = Math.exp(-(offset ** 2) / (2.0 * spread * spread));
    if (offset < 0.0) {
      level = Math.max(level, 0.4 * Math.exp(offset / 2.2));
    }
    return rgb(16.0 + 224.0 * level, 104.0 + 142.0 * level, 255.0);
  });
}

function renderBlueYellow(phase, direction) {
  void direction;
  const background = [16, 104, 255];
  const vividBlue = [0, 172, 255];
  const white = [238, 249, 255];
  const yellow = [255, 226, 20];
  // Mirror-symmetric yellow rings expand outward from a drifting center and
  // reflect at the fold edges, so sections continuously join and separate. A
  // periodic ring train (period 8) keeps the outward motion seamless.
  const origin = bluePulseOrigin(phase);
  const front = phase * 0.7;
  const ringPeriod = 8.0;
  const pixels = [];

  for (let row = 0; row < PREVIEW_ROWS; row++) {
    const rowOffset = (row / (PREVIEW_ROWS - 1) - 0.5) * 1.0;
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const distance = mirroredPathDistance(col + rowOffset, origin, 16.0);
      const ring =
        (((distance - front) % ringPeriod) + ringPeriod) % ringPeriod;
      const radius = Math.min(ring, ringPeriod - ring);
      if (radius <= 0.7) {
        pixels.push(yellow);
      } else if (radius < 1.1) {
        pixels.push(palette([yellow, white], (radius - 0.7) / 0.4));
      } else if (radius <= 1.5) {
        pixels.push(white);
      } else if (radius < 2.0) {
        pixels.push(palette([white, vividBlue], (radius - 1.5) / 0.5));
      } else if (radius <= 2.6) {
        pixels.push(vividBlue);
      } else if (radius < 3.2) {
        pixels.push(palette([vividBlue, background], (radius - 2.6) / 0.6));
      } else {
        pixels.push(background);
      }
    }
  }

  return pixels;
}

function renderIceBlue(phase, direction) {
  void direction;
  const stops = [
    [8, 165, 255],
    [85, 189, 255],
    [145, 211, 255],
  ];
  const time = phase * 1.5;
  const pixels = [];

  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const broad = valueNoise3d(col / 4.0, row / 3.0, time);
      const detail = valueNoise3d(
        col / 2.0 + 2.3,
        row / 1.65 - 1.2,
        time * 0.73 + 8.1,
      );
      let level = (broad + 0.35 * detail) / 1.35;
      level = 0.5 + (level - 0.5) * 1.7;
      pixels.push(palette(stops, level));
    }
  }

  return pixels;
}

function sunsetTarget(event) {
  const color = noiseAt(event + 2189, 37, 0);
  const shade = noiseAt(event + 2290, 43, 0);
  if (color < 0.04) return [0, 255, 12];
  if (color < 0.4) {
    return rgb(10 + 35 * shade, 190 + 45 * shade, 255);
  }
  return rgb(145 + 75 * shade, 170 + 60 * shade, 255);
}

function sunsetEventStart(event, row) {
  const rowPosition = row / (PREVIEW_ROWS - 1) - 0.5;
  const sweepDirection = noiseAt(event + 2400, 41, 0) >= 0.5 ? 1 : -1;
  return event + sweepDirection * 0.22 * rowPosition;
}

function renderSunset(phase, direction) {
  void direction;
  const targetTime = phase / 0.99;
  const pixels = [];

  for (let row = 0; row < PREVIEW_ROWS; row += 1) {
    const nearbyEvent = Math.floor(targetTime);
    let event = nearbyEvent - 1;
    for (
      let candidate = nearbyEvent;
      candidate <= nearbyEvent + 1;
      candidate += 1
    ) {
      if (sunsetEventStart(candidate, row) <= targetTime) event = candidate;
    }
    const eventStart = sunsetEventStart(event, row);
    let transition = Math.min(1.0, (targetTime - eventStart) / 0.35);
    transition = smoothstep(transition);
    const color = palette(
      [sunsetTarget(event - 1), sunsetTarget(event)],
      transition,
    );
    pixels.push(...Array.from({ length: PREVIEW_COLS }, () => color));
  }

  return pixels;
}

function renderCarousel(phase, direction) {
  // Fields keyed by the on-screen arrow. The recordings were rotated 90 deg
  // vs the hardware arrows, so each arrow maps to the field that matches the
  // lamp (Right<-Up, Down<-Right, Left<-Down, Up<-Left recordings).
  const phaseFields = {
    Right: [0.48335, 0.0, 0.50472, -0.06236, 0.0],
    Down: [0.38038, -0.026969, 0.19137, -0.046688, 0.00334],
    Left: [-0.266153, 0.002328, 0.694217, -0.06439, 0.000189],
    Up: [0.302916, -0.012155, -0.517179, 0.081158, -0.003279],
  };
  const [colPhase, colCurve, rowPhase, rowSkew, rowCurve] =
    phaseFields[direction] ?? phaseFields.Up;
  const pixels = [];
  const timeAngle = (phase * TAU) / 2.366;

  for (let row = 0; row < PREVIEW_ROWS; row += 1) {
    // Coefficients were fit from recordings whose row 0 = image top; the
    // renderer's row 0 = panel bottom, so index the fit flipped.
    const fitRow = PREVIEW_ROWS - 1 - row;
    for (let col = 0; col < PREVIEW_COLS; col += 1) {
      const colSquared = col * col;
      const angle =
        timeAngle -
        2.132 +
        colPhase * col +
        colCurve * colSquared +
        rowPhase * fitRow +
        rowSkew * col * fitRow +
        rowCurve * colSquared * fitRow;
      const position = (((angle / TAU) % 1.0) + 1.0) % 1.0;
      let distance;
      let hue;
      if (position < 0.2 || position > 0.8) {
        distance = Math.min(position, 1.0 - position) / 0.2;
        hue = 0.76 + 0.04 * Math.sin(Math.PI * distance);
      } else {
        distance = (position - 0.2) / 0.6;
        hue = 0.63 + 0.052 * Math.sin(Math.PI * distance);
      }
      pixels.push(hsv(hue));
    }
  }

  return pixels;
}

const PALETTE_HUES = [
  0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.62, 0.64, 0.68, 0.72, 0.32, 0.38, 0.46,
  0.04, 0.08, 0.12, 0.16, 0.78, 0.84, 0.88,
];

function paletteHue(event) {
  const index = Math.min(
    PALETTE_HUES.length - 1,
    Math.floor(noiseAt(event + 1701, 19, 0) * PALETTE_HUES.length),
  );
  return PALETTE_HUES[index];
}

function renderPalette(phase, direction) {
  // Horizontal arrows produce sparse daubs; vertical arrows produce broad,
  // overlapping colour fields with occasional near-dark troughs.
  const broad = direction === "Up" || direction === "Down";
  phase *= broad ? 1.5 : 1.25;
  const spawn = broad ? 0.9 : 0.58;
  const maxLifetime = broad ? 7.2 : 4.8;
  let activity = 1.0;
  if (broad) {
    const activityIndex = Math.floor(phase / 4.0);
    let activityFraction = phase / 4.0 - activityIndex;
    activityFraction = activityFraction ** 2 * (3.0 - 2.0 * activityFraction);
    const activityNoise =
      noiseAt(activityIndex + 1901, 31, 0) +
      (noiseAt(activityIndex + 1902, 31, 0) -
        noiseAt(activityIndex + 1901, 31, 0)) *
        activityFraction;
    activity = 0.04 + 1.75 * activityNoise ** 1.3;
  }

  const latest = Math.floor(phase / spawn);
  const events = [];
  for (
    let event = latest - Math.ceil(maxLifetime / spawn) - 2;
    event <= latest + 1;
    event++
  ) {
    const emit =
      event * spawn + (noiseAt(event + 1201, 7, 0) - 0.5) * spawn * 0.9;
    const lifetime = broad
      ? 2.8 + 4.2 * noiseAt(event + 1301, 11, 0)
      : 2.4 + 2.4 * noiseAt(event + 1301, 11, 0);
    const age = phase - emit;
    if (age < 0.0 || age >= lifetime) continue;
    const progress = age / lifetime;
    const envelope = Math.sin(Math.PI * progress) ** 0.7 * activity;
    let centerX;
    let centerY;
    let radiusX;
    let radiusY;
    if (broad) {
      centerX = -3.0 + 25.0 * noiseAt(event + 1401, 13, 0);
      centerY = -1.0 + 6.0 * noiseAt(event + 1501, 17, 0);
      radiusX = 2.2 + 8.6 * noiseAt(event + 1601, 23, 0);
      radiusY = 1.2 + 4.3 * noiseAt(event + 1651, 29, 0);
    } else {
      centerX = 19.0 * noiseAt(event + 1401, 13, 0);
      centerY = 4.0 * noiseAt(event + 1501, 17, 0);
      radiusX = 0.75 + 2.25 * noiseAt(event + 1601, 23, 0);
      radiusY = 0.65 + 0.9 * noiseAt(event + 1651, 29, 0);
    }
    events.push([
      centerX,
      centerY,
      radiusX,
      radiusY,
      envelope,
      paletteHue(event),
    ]);
  }

  const pixels = [];
  const reverse = direction === "Left" || direction === "Up";
  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const sampleCol = reverse ? PREVIEW_COLS - 1 - col : col;
      const sampleRow = reverse ? PREVIEW_ROWS - 1 - row : row;
      let color;
      if (broad) {
        let sineSum = 0.0;
        let cosineSum = 0.0;
        let levelSum = 0.0;
        for (const [
          centerX,
          centerY,
          radiusX,
          radiusY,
          envelope,
          hue,
        ] of events) {
          const dx = (sampleCol - centerX) / radiusX;
          const dy = (sampleRow - centerY) / radiusY;
          const distance = Math.hypot(dx, dy);
          const weight = envelope * Math.max(0.0, 1.0 - distance) ** 1.35;
          const fieldHue = (((hue + dx * 0.1) % 1.0) + 1.0) % 1.0;
          sineSum += weight * Math.sin(TAU * fieldHue);
          cosineSum += weight * Math.cos(TAU * fieldHue);
          levelSum += weight;
        }
        if (levelSum <= 0.025) {
          color = [0, 0, 0];
        } else {
          const hue =
            (((Math.atan2(sineSum, cosineSum) / TAU) % 1.0) + 1.0) % 1.0;
          color = hsv(hue, 0.88, Math.min(1.0, levelSum * 1.7));
        }
      } else {
        let bestLevel = 0.0;
        let bestHue = 0.0;
        for (const [
          centerX,
          centerY,
          radiusX,
          radiusY,
          envelope,
          hue,
        ] of events) {
          const dx = Math.abs(sampleCol - centerX) / radiusX;
          const dy = Math.abs(sampleRow - centerY) / radiusY;
          const distance = dx + dy;
          const level = envelope * Math.max(0.0, 1.25 - distance);
          if (level > bestLevel) {
            bestLevel = level;
            bestHue =
              (((hue + (sampleCol - centerX) * 0.018) % 1.0) + 1.0) % 1.0;
          }
        }
        color =
          bestLevel > 0.03
            ? hsv(bestHue, 0.92, Math.min(1.0, bestLevel))
            : [0, 0, 0];
      }
      pixels.push(color);
    }
  }
  return pixels;
}

/**
 * Render one animated 20x5 approximation frame of a firmware effect.
 * Returns a flat array of 100 [r,g,b] tuples in row-major order
 * (row 0 = top, col 0 = left).
 */
export function renderNativeEffect(effect, phase, direction = "Up") {
  if (effect === "Magic") return renderMagic(phase);
  if (effect === "Wonderland") return renderWonderland(phase);
  if (effect === "Flower Sea") return renderFlowerSea(phase, direction);
  if (effect === "Kaleidoscope") return renderKaleidoscope(phase, direction);
  if (effect === "Blue Yellow") return renderBlueYellow(phase, direction);
  if (effect === "Ice Blue") return renderIceBlue(phase, direction);
  if (effect === "Sunset") return renderSunset(phase, direction);
  if (effect === "Carousel") return renderCarousel(phase, direction);
  if (effect === "Blue White") return renderBlueWhite(phase, direction);
  if (effect === "Palette") return renderPalette(phase, direction);

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
      } else {
        color = hsv(x + phase * 0.05, 0.8, 0.35 + 0.65 * wave);
      }

      pixels.push(color);
    }
  }

  return pixels;
}
