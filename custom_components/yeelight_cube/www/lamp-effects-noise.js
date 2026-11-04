/**
 * Renderers of the lamp's noise fields: Bonfire, Ocean Waves, slots
 * 54 to 59, Neon, Wonderland and Kaleidoscope. All of them are functions of the
 * clock or the render count, so none has a warmup.
 * Mirrors lamp_effects_noise.py exactly; lamp_effects_core.py tells how to
 * add one.
 */

import {
  LENGTH,
  SIN8,
  blurColumns,
  convertColour,
  effectColours,
  effectGeometry,
  f32,
  hueDrive,
  inoise8Raw,
  inoise8Raw2d,
  nativePalette,
  noiseHeat,
  paletteSpan,
  paletteTable,
  placeStrip,
} from "./lamp-core.js";

// The gradients of slots 55, 56, 57 and 59 and slot 58's two buffer
// gradients: [index, r, g, b], ending at index 255.
const GRADIENTS = {
  55: [[0, 255, 255, 255], [128, 255, 0, 81], [255, 169, 0, 255]],
  56: [[0, 30, 0, 60], [128, 0, 0, 255], [180, 128, 0, 128], [255, 255, 0, 255]],
  57: [
    [0, 25, 25, 112], [70, 0, 0, 128], [100, 0, 0, 255], [130, 173, 166, 230],
    [150, 255, 235, 92], [200, 255, 183, 0], [255, 255, 183, 0],
  ],
  58: [[0, 255, 255, 255], [255, 0, 0, 255]],
  "58navy": [[0, 0, 0, 128], [255, 0, 0, 0]],
  59: [
    [0, 25, 25, 112], [70, 0, 0, 128], [120, 0, 0, 255], [160, 173, 216, 230],
    [180, 255, 255, 224], [255, 255, 223, 255],
  ],
};

const s16 = (value) => ((value + 0x8000) & 0xffff) - 0x8000;

/** FastLED's loadDynamicGradientPalette and fill_gradient_RGB in one pass,
 * each stop through the converter. Slots are index >> 4; below 16 stops a used
 * slot moves to last + 1. */
export function gradientPalette(stops) {
  const palette = new Array(16).fill(null);
  let last = -1;
  let position = 0;
  let startIndex = 0;
  let startColour = convertColour(stops[0].slice(1));
  while (startIndex < 255) {
    position += 1;
    const endIndex = stops[position][0];
    const endColour = convertColour(stops[position].slice(1));
    let first = startIndex >> 4;
    let final = endIndex >> 4;
    if (stops.length < 16) {
      if (first <= last && last < 15) {
        first = last + 1;
        final = Math.max(final, first);
      }
      last = final;
    }
    let [low, high, lowColour, highColour] = [first, final, startColour, endColour];
    if (high < low) [low, high, lowColour, highColour] = [high, low, endColour, startColour];
    const divisor = high - low || 1;
    const deltas = [0, 1, 2].map((channel) =>
      s16(Math.trunc(((highColour[channel] - lowColour[channel]) << 7) / divisor) * 2),
    );
    let accumulators = [0, 1, 2].map((channel) => lowColour[channel] << 8);
    for (let slot = low; slot <= high; slot += 1) {
      palette[slot] = accumulators.map((value) => value >> 8);
      accumulators = accumulators.map((value, channel) => (value + deltas[channel]) & 0xffff);
    }
    startIndex = endIndex;
    startColour = endColour;
  }
  return palette;
}

const gradientTable = (key) => paletteTable(gradientPalette(GRADIENTS[key]));

/** The sampler's gain on a sampled table, gain neither 0 nor 255. */
const gainTable = (table, gain) => table.map((value) => (((gain + 1) & 255) * value) >> 8);

const buffers = () => ({
  strip: new Uint8Array(3 * LENGTH),
  panel: new Uint8Array(3 * LENGTH),
});

// ── Slot 34: Fire ─────────────────────────────────────────────────────
function fireInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: settings.direction,
    width,
    height,
    speed: settings.rate + 32,
    table: effectColours(settings).table,
    fades: Int32Array.from({ length: height }, (_, row) =>
      Math.floor(((height - row) * 255) / height) & 255,
    ),
    ...buffers(),
  };
}

function fireStep(state, settings, clockMs) {
  const { width, height, table, fades, strip } = state;
  const base = Math.floor(((clockMs & 0xffff) * state.speed) / 160);
  const depth = Math.floor((base & 0xffff) / 20);
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const y = (base + 128 * row) & 0xffff;
    const fade = fades[row];
    for (let column = 0; column < width; column += 1) {
      const heat = noiseHeat(inoise8Raw((column << 7) & 0xffff, y, depth)) - fade;
      const from = 3 * (heat > 0 ? (heat * 240) >> 8 : 0);
      strip[at++] = table[from];
      strip[at++] = table[from + 1];
      strip[at++] = table[from + 2];
    }
  }
  blurColumns(strip, 128, width, height);
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 42: Waves ────────────────────────────────────────────────────
function oceanInit(settings) {
  const [width, height] = effectGeometry(settings);
  const scale = settings.intensity;
  const angles = new Uint8Array(LENGTH);
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1)
      angles[row * width + column] =
        SIN8[Math.floor((scale * row) / 16) & 255] +
        SIN8[Math.floor((scale * column) / 16) & 255] - 256;
  return {
    direction: settings.direction,
    speed: settings.rate + 32,
    table: effectColours(settings).table,
    angles,
    ...buffers(),
  };
}

function oceanStep(state, settings, clockMs) {
  const { table, angles, strip } = state;
  const drift = Math.imul(clockMs >>> 4, state.speed) >>> 7;
  for (let cell = 0; cell < LENGTH; cell += 1) {
    const from = 3 * SIN8[(angles[cell] + drift) & 255];
    strip[3 * cell] = table[from];
    strip[3 * cell + 1] = table[from + 1];
    strip[3 * cell + 2] = table[from + 2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 54: Rainbow noise ────────────────────────────────────────────
function sunsetInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: settings.direction,
    width,
    height,
    table: paletteTable(nativePalette(0, 54)), // the lamp's raw wheel
    stepX: Math.floor(16 / width),
    stepY: Math.floor(32 / height),
    ...buffers(),
  };
}

function sunsetStep(state, settings, clockMs) {
  const { width, height, table, stepX, stepY, strip } = state;
  const moved = clockMs >>> 3;
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const y = (stepY * row) & 0xffff;
    for (let column = 0; column < width; column += 1) {
      const from = 3 * noiseHeat(inoise8Raw2d((moved + stepX * column) & 0xffff, y));
      strip[at++] = table[from];
      strip[at++] = table[from + 1];
      strip[at++] = table[from + 2];
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 55: Flower Sea ───────────────────────────────────────────────
function flowerInit(settings) {
  const [width, height] = effectGeometry(settings);
  const speed = settings.rate * (1 / 64);
  const table = gradientTable(55);
  return {
    direction: settings.direction,
    width,
    height,
    speed: speed < 1 ? 1 : speed > 4 ? 4 : f32(speed),
    tables: Array.from({ length: height }, (_, row) =>
      gainTable(table, (192 + row * Math.floor(63 / height)) & 255),
    ),
    ...buffers(),
  };
}

function flowerStep(state, settings, clockMs) {
  const { width, height, tables, strip } = state;
  const time = f32(clockMs * state.speed);
  const hundredth = f32(time / 100);
  const depth = Math.trunc(f32(time / 10)) & 0xffff;
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const y = Math.trunc(f32(hundredth + 50 * row)) & 0xffff;
    const table = tables[row];
    for (let column = 0; column < width; column += 1) {
      const x = Math.abs((column - width) * row) & 0xffff;
      const from = 3 * noiseHeat(inoise8Raw(x, y, depth));
      strip[at++] = table[from];
      strip[at++] = table[from + 1];
      strip[at++] = table[from + 2];
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 56: Violet interference ──────────────────────────────────────
function carouselInit(settings) {
  const [width, height] = effectGeometry(settings);
  const angles = new Uint8Array(LENGTH);
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1)
      angles[row * width + column] = Math.trunc((SIN8[144 + 4 * row] * (column - 8)) / 4);
  return { direction: settings.direction, table: gradientTable(56), angles, ...buffers() };
}

function carouselStep(state, settings, clockMs) {
  const { table, angles, strip } = state;
  const moved = clockMs >>> 3;
  for (let cell = 0; cell < LENGTH; cell += 1) {
    const from = 3 * SIN8[(angles[cell] + moved) & 255];
    strip[3 * cell] = table[from];
    strip[3 * cell + 1] = table[from + 1];
    strip[3 * cell + 2] = table[from + 2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slots 57 and 59: Night-amber waves and Night-sky waves ────────────────────────────
// Pattern index i is stored at the buffer's cell i and the last pass reads it
// back through the mapper, so the pattern sits on the panel at any direction.
const distances = (centre) =>
  Int32Array.from({ length: LENGTH }, (_, pixel) =>
    Math.trunc(f32(f32(Math.abs(f32(pixel - centre)) / centre) * 20)),
  );

function yellowInit() {
  return {
    table: gradientTable(57),
    distances: distances(f32(LENGTH / 15)),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function yellowStep(state, settings, clockMs) {
  const { table, panel } = state;
  const period = Math.floor(clockMs / (100 - Math.floor(settings.rate / 3)));
  const eighth = period >> 3;
  const double = period * 2;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const from = 3 * ((SIN8[(state.distances[pixel] + eighth) & 255] + double) % 255);
    panel[3 * pixel] = table[from];
    panel[3 * pixel + 1] = table[from + 1];
    panel[3 * pixel + 2] = table[from + 2];
  }
  return panel;
}

function whiteInit() {
  return {
    table: gradientTable(59),
    distances: distances(f32(LENGTH >> 4)),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function whiteStep(state, settings, clockMs) {
  const { table, panel } = state;
  const moved = clockMs >>> 7;
  const double = (clockMs >>> 4) * 2;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const from = 3 * ((SIN8[(state.distances[pixel] + moved) & 255] + double) % 255);
    panel[3 * pixel] = table[from];
    panel[3 * pixel + 1] = table[from + 1];
    panel[3 * pixel + 2] = table[from + 2];
  }
  return panel;
}

// ── Slot 58: Navy-white noise ─────────────────────────────────────────
function iceInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: settings.direction,
    width,
    height,
    light: gradientTable(58),
    shade: gainTable(gradientTable("58navy"), 128),
    shades: Int32Array.from({ length: width }, (_, column) => Math.floor((255 * column) / width)),
    ...buffers(),
  };
}

function iceStep(state, settings, clockMs, render) {
  const { width, height, light, shade, shades, strip } = state;
  const across = clockMs >>> 4;
  const up = clockMs >>> 2;
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const y = (up + 70 * row) & 0xffff;
    for (let column = 0; column < width; column += 1) {
      const heat = 3 * noiseHeat(inoise8Raw2d((across + 70 * column) & 0xffff, y));
      const dark = 3 * ((render + shades[column]) & 255);
      strip[at++] = Math.min(255, light[heat] + shade[dark]);
      strip[at++] = Math.min(255, light[heat + 1] + shade[dark + 1]);
      strip[at++] = Math.min(255, light[heat + 2] + shade[dark + 2]);
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 75: Neon sine bands ──────────────────────────────────────────
function neonInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: settings.direction,
    width,
    height,
    period: settings.rate * -0.5 + 250,
    across: new Int32Array(width),
    ...buffers(),
  };
}

function neonStep(state, settings, clockMs) {
  const { width, height, across, strip } = state;
  const time = f32(clockMs / state.period);
  const slow = f32(time * 6);
  const fast = f32(time * 7);
  for (let column = 0; column < width; column += 1)
    across[column] = SIN8[(SIN8[Math.trunc(f32(slow + 2 * column)) & 255] + 8 * column) & 255] >> 1;
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const along = SIN8[(8 * row + (SIN8[Math.trunc(f32(fast + 2 * row)) & 255] >> 1)) & 255];
    for (let column = 0; column < width; column += 1) {
      const hue = along + across[column];
      const drive = hueDrive(hue > 359 ? hue - 360 : hue);
      strip[at++] = drive[0];
      strip[at++] = drive[1];
      strip[at++] = drive[2];
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 77: Wonderland ───────────────────────────────────────────────
// lamp_effects_noise.py tells how its global counters step.
function wonderlandInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: settings.direction,
    width,
    height,
    period: Math.ceil((1000 - settings.rate) / 40),
    depth: Math.floor(settings.rate / 20),
    ...buffers(),
  };
}

function wonderlandStep(state, settings, clockMs, render) {
  const { width, height, strip } = state;
  const offset = 1 + Math.floor(render / state.period);
  const depth = (state.depth * (render + 1)) & 0xffff;
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const y = 25 * row;
    for (let column = 0; column < width; column += 1) {
      const heat = noiseHeat(inoise8Raw((offset + 25 * column) & 0xffff, y, depth));
      const drive = hueDrive((heat >> 1) + 220);
      strip[at++] = drive[0];
      strip[at++] = drive[1];
      strip[at++] = drive[2];
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 80: Kaleidoscope ─────────────────────────────────────────────
function kaleidoscopeInit(settings) {
  const centre = f32(LENGTH / 1.3);
  const colours = effectColours(settings);
  return {
    direction: settings.direction,
    table: colours.table,
    span: paletteSpan(colours.palette.length),
    period: Math.floor(((255 - settings.rate) * 40) / 255) + 20,
    every: Math.floor(settings.rate / 85) + 1,
    halves: Float64Array.from({ length: LENGTH }, (_, pixel) => {
      const distance = Math.abs(Math.trunc(f32(f32(pixel) - centre)));
      return f32(SIN8[Math.trunc(f32(f32(f32(distance) / centre) * 127)) & 255] * 0.5);
    }),
    ...buffers(),
  };
}

function kaleidoscopeStep(state, settings, clockMs, render) {
  const { table, span, halves, strip } = state;
  const step = Math.floor(clockMs / state.period);
  const offset = (step >> 3) + 128;
  const drift = f32(step);
  const phase = (1 + Math.floor(render / state.every)) & 0xffff;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const second = SIN8[Math.trunc(f32(drift + halves[pixel])) & 255] - 128;
    const third = SIN8[(offset + second) & 255] - 128;
    const from = 3 * ((((third + phase + 128) & 255) * span) >> 8);
    strip[3 * pixel] = table[from];
    strip[3 * pixel + 1] = table[from + 1];
    strip[3 * pixel + 2] = table[from + 2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

export const SLOTS = [
  { mode: 34, init: fireInit, step: fireStep, warmup: 0 },
  { mode: 42, init: oceanInit, step: oceanStep, warmup: 0 },
  { mode: 54, init: sunsetInit, step: sunsetStep, warmup: 0 },
  { mode: 55, init: flowerInit, step: flowerStep, warmup: 0 },
  { mode: 56, init: carouselInit, step: carouselStep, warmup: 0 },
  { mode: 57, init: yellowInit, step: yellowStep, warmup: 0 },
  { mode: 58, init: iceInit, step: iceStep, warmup: 0 },
  { mode: 59, init: whiteInit, step: whiteStep, warmup: 0 },
  { mode: 75, init: neonInit, step: neonStep, warmup: 0 },
  { mode: 77, init: wonderlandInit, step: wonderlandStep, warmup: 0 },
  { mode: 80, init: kaleidoscopeInit, step: kaleidoscopeStep, warmup: 0 },
];
