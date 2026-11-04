/**
 * Renderers of the lamp's gradients, waves and simple cycles:
 * Alternation, Breathing, Streamer, Rainbow Flow, Dual Scan, Inline Bands, Pastel
 * Pulse, Monochrome Waves, Spectrum, Pulse, Scrolling Bands, Palette Fade, the raw
 * red, the one-shot wipes and Spectrum Bands. Mirrors lamp_effects_waves.py
 * exactly; its header tells how to add one.
 */

import {
  LENGTH,
  RENDER_MS,
  SIN8,
  effectColours,
  effectGeometry,
  envelopeGain,
  f32,
  newGrid,
  paletteSpan,
  pixelMap,
  placeStrip,
  stripBlur,
  triangle16,
} from "./lamp-core.js";

function fillPanel(panel, red, green, blue) {
  for (let at = 0; at < 3 * LENGTH; at += 3) {
    panel[at] = red;
    panel[at + 1] = green;
    panel[at + 2] = blue;
  }
  return panel;
}

/** Solid bands of the inline colors, unshifted. */
function bandStrip(palette) {
  const count = palette.length;
  const width = Math.floor(LENGTH / count);
  const strip = new Uint8Array(3 * LENGTH);
  for (let pixel = 0; pixel < LENGTH; pixel += 1)
    strip.set(palette[Math.min(Math.floor(pixel / width), count - 1)], 3 * pixel);
  return strip;
}

/** Into out: strip with pixel i moved to (i + shift) mod N. */
function rotateStrip(strip, shift, out) {
  const split = 3 * (LENGTH - shift);
  out.set(strip.subarray(split), 0);
  out.set(strip.subarray(0, split), 3 * shift);
  return out;
}

// ── Slot 1: Alternation ───────────────────────────────────────────────
// Swaps colors when the time since its last swap passes the threshold, one swap
// at a time. The Apply's clock is past every threshold (<= 2580 ms), so the
// first render swaps and the swaps fall every "turn" renders from it.
function alternateInit(settings) {
  const colours = effectColours(settings);
  const threshold = (255 - settings.rate) * 10 + 30;
  return {
    colours: [colours.primary, colours.secondary],
    threshold,
    turn: Math.floor(threshold / RENDER_MS) + 1,
    panel: new Uint8Array(3 * LENGTH),
  };
}

/** The signed low 32 bits of elapsed * 255 / threshold, truncated, as a byte. */
const alternateWeight = (elapsed, threshold) =>
  Math.trunc(Math.imul(elapsed, 255) / threshold) & 255;

function alternateStep(state, settings, clockMs, render) {
  const { colours, turn, panel } = state;
  const phase = (Math.floor(render / turn) + 1) & 1;
  const selected = colours[phase];
  if (settings.intensity < 128)
    return fillPanel(panel, selected[0], selected[1], selected[2]);
  // The time before this render's swap: the whole clock on the first.
  const elapsed = render ? (render % turn || turn) * RENDER_MS : clockMs;
  const weight = alternateWeight(elapsed, state.threshold);
  const opposite = colours[phase ^ 1];
  if (weight === 0) return fillPanel(panel, selected[0], selected[1], selected[2]);
  if (weight === 255) return fillPanel(panel, opposite[0], opposite[1], opposite[2]);
  const rest = 255 - weight;
  return fillPanel(
    panel,
    (opposite[0] * weight + selected[0] * rest) >> 8,
    (opposite[1] * weight + selected[1] * rest) >> 8,
    (opposite[2] * weight + selected[2] * rest) >> 8,
  );
}

// ── Slot 2: Breathing ─────────────────────────────────────────────────
function breathInit(settings) {
  return { primary: effectColours(settings).primary, panel: new Uint8Array(3 * LENGTH) };
}

function breathStep(state, settings, clockMs) {
  const gain = envelopeGain(clockMs, settings.rate);
  const [red, green, blue] = state.primary;
  return fillPanel(state.panel, (red * gain) >> 8, (green * gain) >> 8, (blue * gain) >> 8);
}

// ── Slot 3: Ribbon ────────────────────────────────────────────────────
const clockPhase = (clock, multiplier) =>
  (Math.imul(clock >>> 0, multiplier) >>> 8) & 255;

/** The colour wheel below intensity 128. */
export function streamerWheel(phase, intensity) {
  const colour =
    phase < 86
      ? [255 - 3 * phase, 3 * phase, 0]
      : phase < 171
        ? [0, 3 * (170 - phase), 255 - 3 * (170 - phase)]
        : [255 - 3 * (255 - phase), 0, 3 * (255 - phase)];
  const weight = 128 - intensity;
  return [
    (colour[0] * (255 - weight)) >> 8,
    (colour[1] * (255 - weight)) >> 8,
    (colour[2] * (255 - weight) + 3 * weight) >> 8,
  ];
}

function streamerInit(settings) {
  return { table: effectColours(settings).table, panel: new Uint8Array(3 * LENGTH) };
}

function streamerStep(state, settings, clockMs) {
  const phase = clockPhase(clockMs, (settings.rate >> 2) + 2);
  if (settings.intensity < 128) {
    const [red, green, blue] = streamerWheel(phase, settings.intensity);
    return fillPanel(state.panel, red, green, blue);
  }
  const { table } = state;
  const at = 3 * phase;
  return fillPanel(state.panel, table[at], table[at + 1], table[at + 2]);
}

// ── Slot 4: Moving palette ────────────────────────────────────────────
function flowInit(settings) {
  const scale = 16 << Math.floor(settings.intensity / 29);
  return {
    direction: settings.direction,
    table: effectColours(settings).table,
    // By logical pixel: the renderer draws them in reverse.
    offsets: Int32Array.from({ length: LENGTH }, (_, pixel) =>
      Math.floor(((LENGTH - 1 - pixel) * scale) / LENGTH),
    ),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function flowStep(state, settings, clockMs) {
  const phase = clockPhase(clockMs, (settings.rate >> 2) + 10);
  const { table, offsets, strip } = state;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const from = 3 * ((offsets[pixel] + phase) & 255);
    strip[3 * pixel] = table[from];
    strip[3 * pixel + 1] = table[from + 1];
    strip[3 * pixel + 2] = table[from + 2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 7: Dual Scan ─────────────────────────────────────────────────
// Two blocks over black, a block and its mirror, showing the gradient they cover.
function scanInit(settings) {
  const colours = effectColours(settings);
  const { table } = colours;
  const span = paletteSpan(colours.palette.length);
  const gradient = new Uint8Array(3 * LENGTH);
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const at = 3 * ((Math.floor((pixel * 255) / (LENGTH - 1)) * span) >> 8);
    gradient[3 * pixel] = table[at];
    gradient[3 * pixel + 1] = table[at + 1];
    gradient[3 * pixel + 2] = table[at + 2];
  }
  return {
    direction: settings.direction,
    gradient,
    period: (settings.rate ^ 255) * 150 + 250,
    size: ((settings.intensity * LENGTH) >> 9) + 1,
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function scanStep(state, settings, clockMs) {
  const { period, size, gradient, strip } = state;
  const progress = Math.floor(((clockMs % period) * 65535) / period);
  const room = LENGTH - size;
  const offset = Math.abs((((progress << 1) & 0x1fffe) * room >> 16) - room);
  const mirror = room - offset;
  strip.fill(0);
  strip.set(gradient.subarray(3 * mirror, 3 * (mirror + size)), 3 * mirror);
  strip.set(gradient.subarray(3 * offset, 3 * (offset + size)), 3 * offset);
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 8: Inline Bands ──────────────────────────────────────────────
/** The shift a render draws with. It steps after each render where clock /
 * (290 - rate) changed: the first (the quotient starts at 0, the Apply's clock
 * is a multiple past it), and never at rate 0, where the quotient stays 0. */
export function inlineShift(render, rate) {
  if (rate === 0 || render === 0) return 0;
  const bucket = 290 - rate;
  const steps =
    bucket <= RENDER_MS ? render - 1 : Math.floor(((render - 1) * RENDER_MS) / bucket);
  return (steps + 1) % LENGTH;
}

function inlineInit(settings) {
  return {
    direction: settings.direction,
    bands: bandStrip(effectColours(settings).palette),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function inlineStep(state, settings, clockMs, render) {
  rotateStrip(state.bands, inlineShift(render, settings.rate), state.strip);
  return placeStrip(state.strip, state.direction, state.panel);
}

// ── Slot 9: Triangular palette pulses ─────────────────────────────────
function pulseInit(settings) {
  const colours = effectColours(settings);
  const { table } = colours;
  const cells = ((settings.intensity * (LENGTH >> 2)) >> 8) + 1;
  const width = Math.floor(LENGTH / cells);
  const margin = (LENGTH - cells * width) >> 1;
  const span = paletteSpan(colours.palette.length);
  const foreground = new Uint8Array(3 * LENGTH);
  for (let pixel = margin; pixel < margin + cells * width; pixel += 1) {
    const at = 3 * ((Math.floor((pixel * 255) / (LENGTH - 1)) * span) >> 8);
    foreground[3 * pixel] = table[at];
    foreground[3 * pixel + 1] = table[at + 1];
    foreground[3 * pixel + 2] = table[at + 2];
  }
  return {
    direction: settings.direction,
    width,
    margin,
    end: margin + cells * width,
    levels: Int32Array.from({ length: width }, (_, place) =>
      triangle16(Math.floor((place * 65535) / width)),
    ),
    weights: new Int32Array(width),
    foreground,
    secondary: colours.secondary,
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function pulseStep(state, settings, clockMs) {
  const phase = triangle16(Math.imul(clockMs >>> 0, (settings.rate >> 2) + 8));
  const threshold = (phase >> 1) + (phase >> 2);
  const room = 65535 - threshold;
  const { width, margin, end, levels, weights, foreground, strip } = state;
  for (let place = 0; place < width; place += 1) {
    const level = levels[place];
    weights[place] =
      level <= threshold ? 0 : Math.floor(((level - threshold) * 255) / room);
  }
  const [red, green, blue] = state.secondary;
  fillPanel(strip, red, green, blue);
  for (let pixel = margin; pixel < end; pixel += 1) {
    const weight = weights[(pixel - margin) % width];
    if (!weight) continue;
    const at = 3 * pixel;
    if (weight === 255) {
      strip[at] = foreground[at];
      strip[at + 1] = foreground[at + 1];
      strip[at + 2] = foreground[at + 2];
    } else {
      const rest = 255 - weight;
      strip[at] = (foreground[at] * weight + red * rest) >> 8;
      strip[at + 1] = (foreground[at + 1] * weight + green * rest) >> 8;
      strip[at + 2] = (foreground[at + 2] * weight + blue * rest) >> 8;
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 11: Sine wave ────────────────────────────────────────────────
// Its phase counts the renders since the Apply.
function waveInit(settings) {
  const { primary } = effectColours(settings);
  const cells = new Uint8Array(768);
  for (let value = 0; value < 256; value += 1)
    for (let channel = 0; channel < 3; channel += 1)
      cells[3 * value + channel] =
        value === 0 ? primary[channel] : (primary[channel] * (255 - value)) >> 8;
  const step = settings.intensity >> 4;
  return {
    direction: settings.direction,
    cells,
    thetas: Int32Array.from({ length: LENGTH }, (_, pixel) => (LENGTH - 1 - pixel) * step),
    advance: Math.floor((settings.rate + 48) / 24),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function waveStep(state, settings, clockMs, render) {
  const phase = ((render + 1) * state.advance) % 256;
  const { cells, thetas, strip } = state;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const from = 3 * SIN8[(phase + thetas[pixel]) & 255];
    strip[3 * pixel] = cells[from];
    strip[3 * pixel + 1] = cells[from + 1];
    strip[3 * pixel + 2] = cells[from + 2];
  }
  stripBlur(strip, settings.intensity);
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 17: Spectrum ─────────────────────────────────────────────────
// A static gradient.
function spectrumInit(settings) {
  const colours = effectColours(settings);
  const { table } = colours;
  const span = paletteSpan(colours.palette.length);
  const strip = new Uint8Array(3 * LENGTH);
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const at = 3 * ((Math.floor((pixel * 255) / LENGTH) * span) >> 8);
    strip[3 * pixel] = table[at];
    strip[3 * pixel + 1] = table[at + 1];
    strip[3 * pixel + 2] = table[at + 2];
  }
  return { panel: placeStrip(strip, settings.direction) };
}

const panelStep = (state) => state.panel;

// ── Slot 18: Pulse ────────────────────────────────────────────────────
/** Rate 1-60 ramps up over rate minutes, 61-120 down over rate - 60, and from
 * 121 it cycles on the lamp's clock. */
export function pulseSpread(render, clock, rate) {
  if (rate === 0) return 65535;
  if (rate < 121) {
    const period = (rate <= 60 ? rate : rate - 60) * 600;
    const tenths = Math.floor((render * RENDER_MS) / 100);
    const ramp = Math.floor((Math.min(tenths, period) * 65535) / period);
    return rate <= 60 ? ramp : ramp ^ 65535;
  }
  return triangle16(Math.imul(clock >>> 1, ((rate - 120) >> 1) + 1));
}

function sunriseInit(settings) {
  return {
    direction: settings.direction,
    table: effectColours(settings).table,
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function sunriseStep(state, settings, clockMs, render) {
  const spread = pulseSpread(render, clockMs, settings.rate);
  const { intensity } = settings;
  const { table, strip } = state;
  const half = LENGTH >> 1;
  // Drawn from both ends: the middle index, written last, covers both centre pixels.
  for (let index = 0; index <= half; index += 1) {
    const value = triangle16(Math.floor((index * spread) / LENGTH));
    const at = 3 * Math.min(240, (value >> 8) + ((value * intensity) >> 15));
    const far = 3 * (LENGTH - 1 - index);
    strip[3 * index] = strip[far] = table[at];
    strip[3 * index + 1] = strip[far + 1] = table[at + 1];
    strip[3 * index + 2] = strip[far + 2] = table[at + 2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 28: Scrolling Bands ──────────────────────────────────────────
// Rate 255 gives a period of 0 and what the lamp shows is undefined: left black.
function scrollingPeriod(rate) {
  let step = Math.floor(12800 / LENGTH) + 1;
  step -= step >> 4;
  return step - Math.floor((rate * step) / 255);
}

function scrollingInit(settings) {
  return {
    direction: settings.direction,
    bands: bandStrip(effectColours(settings).palette),
    period: scrollingPeriod(settings.rate),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function scrollingStep(state, settings, clockMs) {
  const { period, strip } = state;
  if (!period) return state.panel;
  rotateStrip(state.bands, Math.floor(clockMs / period) % LENGTH, strip);
  stripBlur(strip, settings.intensity);
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 31: Palette Fade ─────────────────────────────────────────────
// The whole strip fades from entry to entry. Only green and blue are kept from
// the entry before (16 bits of it): red rises from 0 each time.
function fadeInit(settings) {
  const { palette } = effectColours(settings);
  return {
    entries: Array.from({ length: LENGTH }, (_, pixel) => palette[pixel % palette.length]),
    duration: Math.trunc(f32(f32(f32((255 - settings.rate) / 255) * 80) + 1)),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function fadeStep(state, settings, clockMs, render) {
  const { entries, duration, panel } = state;
  // The first entry runs phases 0..duration, the others 1..duration.
  const past = render - duration - 1;
  const entry = past < 0 ? 0 : Math.floor(past / duration) + 1;
  const phase = past < 0 ? render : (past % duration) + 1;
  const [red, green, blue] = entries[entry % LENGTH];
  const before = entry ? entries[(entry - 1) % LENGTH] : [0, 0, 0];
  const alpha = Math.trunc(f32(f32(phase * 255) / duration));
  if (alpha === 255) return fillPanel(panel, red, green, blue);
  const rest = 255 - alpha;
  return fillPanel(
    panel,
    (red * alpha) >> 8,
    (before[1] * rest + green * alpha) >> 8,
    (before[2] * rest + blue * alpha) >> 8,
  );
}

// ── Slot 52: Raw Red ──────────────────────────────────────────────────
function redInit() {
  return { panel: fillPanel(new Uint8Array(3 * LENGTH), 255, 0, 0) };
}

// ── Slots 65, 66, 68, 69: Wipes ────────────────────────────────────────────────
// One-shot, raw colors: a frame every 20 ms from the Apply changes one pixel, so
// two a render, then the picture holds. 65 draws the wheel and 68 white from
// pixel 0 over black; 66 and 69 start from the wheel and white and go black from
// pixel N - 1.
const WIPE_FRAME_MS = 20;

/** The wipes' colour wheel. */
export function wipeWheel(value) {
  if (value >= 171) {
    const rest = 255 - value;
    return [255 - 3 * rest, 0, 3 * rest];
  }
  if (value >= 86) {
    const rest = 170 - value;
    return [0, 3 * rest, 255 - 3 * rest];
  }
  const rest = 85 - value;
  return [3 * rest, 255 - 3 * rest, 0];
}

function wipeInit(settings) {
  const { mode } = settings;
  const picture = new Uint8Array(3 * LENGTH);
  for (let pixel = 0; pixel < LENGTH; pixel += 1)
    picture.set(
      mode === 65 || mode === 66
        ? wipeWheel(Math.floor((pixel * 255) / (LENGTH - 1)))
        : [255, 255, 255],
      3 * pixel,
    );
  return {
    direction: settings.direction,
    picture,
    growing: mode === 65 || mode === 68,
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function wipeStep(state, settings, clockMs, render) {
  const { picture, strip } = state;
  const done = Math.min(Math.floor((render * RENDER_MS) / WIPE_FRAME_MS) + 1, LENGTH);
  strip.set(picture);
  strip.fill(0, 3 * (state.growing ? done : LENGTH - done));
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 70: Palette stripes ──────────────────────────────────────────
// Static. The renderer maps each cell itself, then the pixel writer maps it again.
// Intensity 0 divides by zero and what the lamp shows is undefined: left black.
function bandsInit(settings) {
  const { direction, intensity } = settings;
  const [width, height] = effectGeometry(settings);
  const strip = newGrid(width, height);
  if (intensity) {
    const colours = effectColours(settings);
    const { table } = colours;
    const span = paletteSpan(colours.palette.length);
    const scale = f32(128 / intensity);
    const cellMap = pixelMap(direction);
    for (let row = 0; row < height; row += 1) {
      const level = Math.trunc((Math.trunc(f32(scale * row)) * 255) / height) & 255;
      const at = 3 * ((span * level) >> 8);
      for (let column = 0; column < width; column += 1) {
        const pixel = 3 * cellMap[row * width + column];
        strip[pixel] = table[at];
        strip[pixel + 1] = table[at + 1];
        strip[pixel + 2] = table[at + 2];
      }
    }
  }
  return { panel: placeStrip(strip, direction) };
}

export const SLOTS = [
  { mode: 1, init: alternateInit, step: alternateStep, warmup: 0 },
  { mode: 2, init: breathInit, step: breathStep, warmup: 0 },
  { mode: 3, init: streamerInit, step: streamerStep, warmup: 0 },
  { mode: 4, init: flowInit, step: flowStep, warmup: 0 },
  { mode: 7, init: scanInit, step: scanStep, warmup: 0 },
  { mode: 8, init: inlineInit, step: inlineStep, warmup: 0 },
  { mode: 9, init: pulseInit, step: pulseStep, warmup: 0 },
  { mode: 11, init: waveInit, step: waveStep, warmup: 0 },
  { mode: 17, init: spectrumInit, step: panelStep, warmup: 0 },
  { mode: 18, init: sunriseInit, step: sunriseStep, warmup: 0 },
  { mode: 28, init: scrollingInit, step: scrollingStep, warmup: 0 },
  { mode: 31, init: fadeInit, step: fadeStep, warmup: 0 },
  { mode: 52, init: redInit, step: panelStep, warmup: 0 },
  { mode: 65, init: wipeInit, step: wipeStep, warmup: 0 },
  { mode: 66, init: wipeInit, step: wipeStep, warmup: 0 },
  { mode: 68, init: wipeInit, step: wipeStep, warmup: 0 },
  { mode: 69, init: wipeInit, step: wipeStep, warmup: 0 },
  { mode: 70, init: bandsInit, step: panelStep, warmup: 0 },
];
