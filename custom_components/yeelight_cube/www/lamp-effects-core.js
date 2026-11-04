/**
 * Renderers of the lamp's core family: Rainbow, Tide and Magic.
 * Mirrors lamp_effects_core.py exactly; its header tells how to add one.
 */

import {
  COLS,
  LENGTH,
  ROWS,
  SIN8,
  effectColours,
  effectGeometry,
  fadeGrid,
  hueColour,
  hueDrive,
  inoise8Raw,
  newGrid,
  noiseHeat,
  paletteSpan,
  placeStrip,
} from "./lamp-core.js";

// ── Slot 39: Rainbow ──────────────────────────────────────────────────
/** ((clock * (m << 8)) * 280 >> 24) & 255: the low 32 bits hold every bit used. */
export function rainbowPhase(clock, rate) {
  const multiplier = Math.floor((rate * 30 + 960) / 160);
  return Math.imul(Math.imul(clock >>> 0, multiplier << 8), 280) >>> 24;
}

function rainbowInit(settings) {
  const [width, height] = effectGeometry(settings);
  const colours = effectColours(settings);
  return {
    direction: settings.direction,
    width,
    height,
    table: colours.table,
    span: paletteSpan(colours.palette.length),
    rows: Int32Array.from({ length: height }, (_, row) =>
      Math.floor(((255 - Math.floor(255 / height)) * row) / height),
    ),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function rainbowStep(state, settings, clockMs) {
  const phase = rainbowPhase(clockMs, settings.rate);
  const { table, span, width, height, rows, strip } = state;
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const from = 3 * ((span * ((rows[row] - phase) & 255)) >> 8);
    for (let column = 0; column < width; column += 1) {
      strip[at++] = table[from];
      strip[at++] = table[from + 1];
      strip[at++] = table[from + 2];
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slots 35 and 48: Tide ─────────────────────────────────────────────
// lamp_effects_core.py _TIDE_WARMUP.
const TIDE_WARMUP = 78;

function tideInit(settings) {
  const [width, height] = effectGeometry(settings);
  const { table } = effectColours(settings);
  const spreads = new Int32Array(height);
  const colours = new Uint8Array(3 * height);
  for (let dot = 0; dot < height; dot += 1) {
    spreads[dot] = Math.floor((128 * dot) / (height - 1));
    const at = 3 * (Math.floor((255 * dot) / height) & 255);
    colours[3 * dot] = table[at];
    colours[3 * dot + 1] = table[at + 1];
    colours[3 * dot + 2] = table[at + 2];
  }
  return {
    direction: settings.direction,
    width,
    height,
    speed: Math.floor((settings.rate * 191) / 255) + 32,
    spreads,
    colours,
    work: newGrid(width, height),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function tideStep(state, settings, clockMs) {
  const { width, height, work, spreads, colours } = state;
  fadeGrid(work, 8, width, height);
  const product = Math.imul(clockMs >>> 0, state.speed) >>> 0;
  const fast = product >>> 10;
  const slow = Math.floor(product / 2560);
  for (let dot = 0; dot < height; dot += 1) {
    const spread = spreads[dot];
    const x = Math.floor((SIN8[(spread + fast) % 255] * width) / 255) & 255;
    const y = Math.floor((SIN8[(spread + slow) % 255] * height) / 255) & 255;
    const at = 3 * (width * (y < height ? y : 0) + (x < width ? x : 0));
    work[at] = colours[3 * dot];
    work[at + 1] = colours[3 * dot + 1];
    work[at + 2] = colours[3 * dot + 2];
  }
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 76: Magic ────────────────────────────────────────────────────
/** The hues of mode 76 at `render` (0 = the first after the Apply), by logical
 * cell. A pure function of the render. */
export function magicHues(render, rate, width, height, out = new Int32Array(width * height)) {
  const phase = (Math.floor(render / 50) + 1) & 0xffff;
  const depth = (render + 1) & 0xffff;
  const multiplier = (Math.trunc((rate * 9 - 9) / 254) + 1) & 255;
  const moved = multiplier * depth;
  const z = (depth * 5) & 0xffff;
  for (let column = 0; column < width; column += 1) {
    const x = (20 * column + phase) & 0xffff;
    for (let row = 0; row < height; row += 1)
      out[row * width + column] =
        (noiseHeat(inoise8Raw(x, 20 * row, z)) + moved) % 360;
  }
  return out;
}

/** The converter's input at `render`, on the 20 x 5 box, by logical cell (row x
 * 20 + column). */
export function magicCells(render, rate) {
  return Array.from(magicHues(render, rate, COLS, ROWS), hueColour);
}

function magicInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: settings.direction,
    width,
    height,
    hues: new Int32Array(width * height),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function magicStep(state, settings, clockMs, render) {
  const { hues, strip } = state;
  magicHues(render, settings.rate, state.width, state.height, hues);
  for (let cell = 0; cell < LENGTH; cell += 1) {
    const drive = hueDrive(hues[cell]);
    strip[3 * cell] = drive[0];
    strip[3 * cell + 1] = drive[1];
    strip[3 * cell + 2] = drive[2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

export const SLOTS = [
  { mode: 39, init: rainbowInit, step: rainbowStep, warmup: 0 },
  { mode: 48, init: tideInit, step: tideStep, warmup: TIDE_WARMUP },
  { mode: 76, init: magicInit, step: magicStep, warmup: 0 },
];
