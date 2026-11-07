/**
 * Renderers of the lamp's music slots, on the demo beat
 * (lamp_core.py): Breathing (20, 44), the bars (25, 26, 30), Music (27),
 * Spectrum (41), Gather (43), Blossom (45), the noise equalizer (51), Note (73)
 * and Impact (74). Mirrors lamp_effects_music.py exactly;
 * lamp_effects_core.py tells how to add one.
 *
 * Nothing here hears the lamp: each step reads its render's packet from
 * demoSound on its first line, the one place a real source would go.
 */

import {
  DIRECTION_TABLE,
  HANDOVER_FLAGS,
  LENGTH,
  REFERENCE_PROFILE,
  blendGrid,
  blurColumns,
  demoSound,
  effectColours,
  effectGeometry,
  f32,
  fadeGrid,
  fadeTowards,
  flaggedTargets,
  inoise8Raw,
  lround,
  newGrid,
  noiseHeat,
  paletteSpan,
  pixelMap,
  placeStrip,
  readBackFlags,
  rowBlurGrid,
  sourceWord,
  sx8,
} from "./lamp-core.js";

const newPanel = () => new Uint8Array(3 * LENGTH);

// A warmup here is the worst start over the demo loop (and the rates and
// intensities that matter, swept against a full replay): the smoothers forget
// because the beat is periodic. A real source would void these counts.

/** What the grid renderers share: the box, its colours, a black grid. */
function gridState(settings) {
  const [width, height] = effectGeometry(settings);
  const colours = effectColours(settings);
  return {
    direction: settings.direction,
    width,
    height,
    table: colours.table,
    span: paletteSpan(colours.palette.length),
    work: newGrid(width, height),
    panel: newPanel(),
  };
}

// ── Slots 20 and 44: Breathing ────────────────────────────────────────
const BREATHING_20_WARMUP = 35;
const BREATHING_44_WARMUP = 11;

const breathingInit = (settings, weight) => ({
  table: effectColours(settings).table,
  weight,
  level: 0, // the smoothed level, shared across slots
  panel: newPanel(),
});

const breathing20Init = (settings) => breathingInit(settings, 4);
const breathing44Init = (settings) => breathingInit(settings, 1);

function breathingStep(state, settings, clockMs, render) {
  const [level, , tick] = demoSound(render);
  const { table, weight, panel } = state;
  state.level = Math.floor((weight * state.level + level) / (weight + 1));
  const bright = state.level & 255;
  const at = 3 * (tick === 255 ? 0 : tick);
  let red = table[at];
  let green = table[at + 1];
  let blue = table[at + 2];
  if (bright !== 255) {
    // the sampler's gain
    const gain = bright + 1;
    red = (red * gain) >> 8;
    green = (green * gain) >> 8;
    blue = (blue * gain) >> 8;
  }
  for (let cell = 0; cell < 3 * LENGTH; cell += 3) {
    // one colour: no placement
    panel[cell] = red;
    panel[cell + 1] = green;
    panel[cell + 2] = blue;
  }
  return panel;
}

// ── Slots 30, 26 and 25: the bars ─────────────────────────────────────
// Selector 0 draws pixels 0.., 1 from the centre outwards, 2 from both ends
// inwards. The lamp's 16-bit wrap never shows: bars <= N >> (selector != 0).
const BARS_WARMUP = 36; // the level, then the peak's next catch

const barsInit = (settings, selector) => {
  const colours = effectColours(settings);
  return {
    direction: settings.direction,
    table: colours.table,
    span: paletteSpan(colours.palette.length),
    selector,
    width: f32(LENGTH >> (selector ? 1 : 0)),
    limit: 8 - (settings.rate >> 5),
    strip: new Uint8Array(3 * LENGTH),
    level: 0,
    index: 0,
    peak: 0,
    panel: newPanel(),
  };
};

const bars30Init = (settings) => barsInit(settings, 0);
const bars26Init = (settings) => barsInit(settings, 1);
const bars25Init = (settings) => barsInit(settings, 2);

/** Steps first..last - 1 of a bar, in one colour. */
function barsDraw(strip, selector, first, last, red, green, blue) {
  const put = (pixel) => {
    strip[3 * pixel] = red;
    strip[3 * pixel + 1] = green;
    strip[3 * pixel + 2] = blue;
  };
  const mid = LENGTH >> 1;
  for (let step = first; step < last; step += 1) {
    if (selector === 1) {
      put(mid + step);
      put(mid - 1 - step);
    } else {
      put(step);
      if (selector === 2) put(LENGTH - 1 - step);
    }
  }
}

function barsStep(state, settings, clockMs, render) {
  const [level, , , spectrum] = demoSound(render);
  const { strip, selector, width, table } = state;
  state.level = Math.floor((2 * state.level + level) / 3);
  fadeTowards(strip, 254);
  const gain = f32(f32(f32(f32(state.level) * f32(settings.intensity)) / 255.0) * 0.125);
  const span = f32(width * (gain + gain) * 0.03125);
  const bars = span < 1 ? 1 : Math.trunc(span <= width ? span : width);
  if ((render & 3) === 0) {
    // the strictly loudest band; band 15 only wins alone
    let best = spectrum[0];
    let index = state.index;
    if (best) index = 0;
    for (let band = 1; band < 15; band += 1)
      if (best < spectrum[band]) {
        index = band;
        best = spectrum[band];
      }
    state.index = best >= spectrum[15] ? (index * 17) & 0xffff : 255;
  }
  const at = 3 * ((state.span * (state.index & 255)) >> 8);
  barsDraw(strip, selector, 0, bars, table[at], table[at + 1], table[at + 2]);
  let { peak } = state;
  if (bars >= peak) peak = bars - 1;
  else if (render % state.limit === 0) peak -= 1; // the hold counter, from 0 at the Apply
  state.peak = peak;
  if (peak >= 0) barsDraw(strip, selector, peak, peak + 1, 255, 255, 255);
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 27: Music ────────────────────────────────────────────────────
const MUSIC_WARMUP = 11; // a re-sum, then the fade; ties on the beat hold it

const musicInit = () => ({ colour: new Uint8Array(3), low: 0, mid: 0, high: 0, panel: newPanel() });

function musicStep(state, settings, clockMs, render) {
  const [level, , , spectrum] = demoSound(render);
  if (render % 5 === 0) {
    state.low = spectrum[3] + spectrum[4] + spectrum[5];
    state.mid = spectrum[8] + spectrum[9] + spectrum[10];
    state.high = spectrum[12] + spectrum[13] + spectrum[14];
  }
  const { low, mid, high, colour, panel } = state;
  let target = null; // a tie writes nothing
  if (level === 0) target = 0xffffff;
  else if (low > mid && low > high) target = 0xff0000;
  else if (mid > low && mid > high) target = 0xff00;
  else if (high > low && high > mid) target = 0xff;
  if (target !== null) fadeTowards(colour, 255, target, 1); // the strip is one colour
  for (let cell = 0; cell < 3 * LENGTH; cell += 3) panel.set(colour, cell);
  return panel;
}

// ── Slot 41: Spectrum ─────────────────────────────────────────────────
// The lamp keeps peaks but never draws them: not here. The
// warmup is the rate 0 fade's: at rate 6 and more it is shorter.
const SPECTRUM_WARMUP = 104;

function spectrumInit(settings) {
  const state = gridState(settings);
  const { width, height, table, span } = state;
  state.columns = [];
  for (let column = 0; column < width; column += 1) {
    // H, not W, in the colour's step, as the lamp does.
    const at = 3 * (((Math.floor((column * 255) / (height - 1)) & 255) * span) >> 8);
    state.columns.push({
      band: lround((column * 14) / (width - 1) + 1),
      red: table[at],
      green: table[at + 1],
      blue: table[at + 2],
      lit: Boolean(table[at] || table[at + 1] || table[at + 2]),
    });
  }
  state.bands = new Int32Array(16);
  return state;
}

function spectrumStep(state, settings, clockMs, render) {
  const spectrum = demoSound(render)[3];
  const { width, height, work, bands, columns } = state;
  fadeGrid(work, settings.rate, width, height);
  for (let band = 0; band < 16; band += 1) {
    const fresh = spectrum[band];
    const old = bands[band];
    bands[band] = fresh > old ? Math.floor((4 * fresh + 2 * old) / 6) : fresh;
  }
  for (let column = 0; column < width; column += 1) {
    const { band, red, green, blue, lit } = columns[column];
    const bar = lround((bands[band] * height) / 255);
    if (!lit) continue; // written only when not black
    for (let cell = 0; cell < Math.min(bar, height); cell += 1) {
      const at = 3 * ((height - 1 - cell) * width + column);
      work[at] = red;
      work[at + 1] = green;
      work[at + 2] = blue;
    }
  }
  return placeStrip(work, state.direction, state.panel);
}

// ── Slots 43 and 45: Gather and Blossom ───────────────────────────────
// Warmup null: the noise runs on the lamp's clock, so no loop can be swept, and
// blurs over a saturating add have no bound to forget by (sampled starts merged
// after up to 111 and 190 renders at rate 0).

/** A palette colour added, saturating. */
function add(work, cell, table, at) {
  const atCell = 3 * cell;
  for (let channel = 0; channel < 3; channel += 1) {
    const value = work[atCell + channel] + table[at + channel];
    work[atCell + channel] = value < 255 ? value : 255;
  }
}

function gatherInit(settings) {
  const state = gridState(settings);
  // A bar longer than the grid gives negative mirrored rows: the 16-bit index
  // clamps to the last pixel after the mapper, the cell the mapper sends there.
  state.last = pixelMap(settings.direction).indexOf(LENGTH - 1);
  return state;
}

function gatherStep(state, settings, clockMs, render) {
  const level = demoSound(render)[0];
  const { width, height, work, table, span, last } = state;
  blendGrid(work, settings.rate, width, height);
  const time = (clockMs >>> 1) & 65535;
  const gain = (settings.intensity * level) >> 6;
  for (let column = 0; column < width; column += 1) {
    const value = noiseHeat(inoise8Raw(column * 45, time, time));
    const bar = ((((value * gain) >> 6) * height) >> 10) & 65535;
    const far = width - 1 - column;
    for (let step = 1; step <= bar; step += 1) {
      const bright = 250 - Math.floor((250 * (step - 1)) / bar);
      const at = 3 * ((span * (bright & 255)) >> 8);
      add(work, (step <= height ? step - 1 : 0) * width + column, table, at);
      add(work, step > height ? last : (height - step) * width + far, table, at);
    }
  }
  rowBlurGrid(work, width, height);
  blurColumns(work, 16, width, height);
  return placeStrip(work, state.direction, state.panel);
}

function blossomStep(state, settings, clockMs, render) {
  const level = demoSound(render)[0];
  const { width, height, work, table, span } = state;
  blendGrid(work, settings.rate, width, height);
  const time = (clockMs >>> 2) & 65535;
  const gain = (settings.intensity * level) >> 6;
  const middle = height >> 1;
  for (let column = 0; column < width; column += 1) {
    const value = noiseHeat(inoise8Raw(column * 45, time, time));
    const bar = ((((value * gain) >> 6) * height) >> 11) & 65535;
    const far = width - 1 - column;
    for (let step = 0; step < Math.min(bar, middle + 1); step += 1) {
      const at = 3 * ((span * (Math.floor((step * 250) / bar) & 255)) >> 8);
      add(work, (middle - step) * width + column, table, at);
      const below = middle + step;
      add(work, (below < height ? below : 0) * width + far, table, at);
    }
  }
  rowBlurGrid(work, width, height);
  blurColumns(work, 16, width, height);
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 51: noise equalizer ──────────────────────────────────────────
// The mapper on the flags 51 runs with (0x47, 0x57) is a permutation and the
// read-back undoes it: the buffer by logical cell is the same picture.
// noise51 only ever reads x < 384, so three hashes of Perlin's table.
// The warmup is over the 768 renders of the beat and the noise's step together.
const EQUALIZER_WARMUP = 218; // at low intensity a peak waits for the next tall bar
const NOISE51_HASHES = [36, 86, 227];

/** grad8's operands, then ((u + v) >> 1) + (u & 1) on 32 bits. */
function grad51(number, x) {
  let u = x;
  let v = x;
  if (!(number & 8)) {
    if (number & 4) u = 1;
    else v = 1;
  }
  u = sx8(number & 1 ? -u : u);
  v = sx8(number & 2 ? -v : v);
  return ((v + u) >>> 1) + (u & 1);
}

/** FastLED's 1-D inoise8 as the lamp computes it: ease = j * j >> 7 with j
 * folded at 128, plain (a * b) >> 8 lerp. */
function noise51(x) {
  const low = x & 255;
  const high = x >> 8;
  const fold = low < 128 ? low : 255 - low;
  const square = (fold * fold) >> 7;
  const ease = (low < 128 ? square & 0x1fe : (square | 1) ^ 0xfffffffe) & 255;
  const half = (x >> 1) & 0x7f;
  const one = grad51(NOISE51_HASHES[high], half);
  const two = grad51(NOISE51_HASHES[high + 1], half - 128);
  const answer =
    sx8(two) > sx8(one)
      ? ((ease * ((two - one) & 255)) >> 8) + one
      : one - ((ease * ((one - two) & 255)) >> 8);
  return Math.min(((answer << 1) + 0x80) & 0x1fe, 255);
}

// f32(f32(n + 256) / 384) by x.
const NOISE51_SCALES = Float64Array.from({ length: 384 }, (_, x) =>
  f32(f32(noise51(x) + 256) / 384),
);

function equalizerInit(settings) {
  const state = gridState(settings);
  const { width } = state;
  [state.red, state.green, state.blue] = effectColours(settings).palette[0];
  state.offsets = Array.from({ length: width }, (_, column) =>
    Math.floor((column * 128) / width),
  );
  state.k = (8 - lround(f32(settings.rate * 0.03125))) & 255; // rate < 240
  state.peaks = new Float64Array(width);
  state.falls = new Float64Array(width);
  state.smooth = 0;
  return state;
}

function equalizerStep(state, settings, clockMs, render) {
  const level = demoSound(render)[0];
  const { width, height, work, table, span, peaks, falls, k, offsets } = state;
  fadeGrid(work, (settings.rate >> 1) + 64, width, height);
  state.smooth = ((state.smooth + level) >> 1) & 0xffff;
  let scale = f32((height * f32(f32(state.smooth * settings.intensity) * 0.0078125)) / 255.0);
  scale = scale < 0 ? 0 : scale <= height ? scale : f32(height);
  const falling = render % k === 0; // the record's count, the same in every column
  const fallBy = f32(k + 6);
  const position = render & 255; // the step, from 0 at the Apply
  for (let column = 0; column < width; column += 1) {
    let bar = lround(f32(scale * NOISE51_SCALES[position + offsets[column]]));
    bar = (bar <= height ? bar : height) & 0xffff;
    for (let row = 0; row < bar; row += 1) {
      const at = 3 * ((span * (Math.floor((row * 255) / bar) & 255)) >> 8);
      const cell = 3 * (row * width + column);
      work[cell] = table[at];
      work[cell + 1] = table[at + 1];
      work[cell + 2] = table[at + 2];
    }
    const tall = f32(bar);
    let peak = peaks[column];
    if (tall >= peak) {
      falls[column] = 0;
      peak = tall;
    } else {
      if (falling) falls[column] = f32(f32(peak - tall) / fallBy);
      peak = f32(peak - falls[column]);
    }
    peaks[column] = peak;
    if (peak > 0) {
      const row = lround(peak);
      const cell = 3 * ((height <= row ? 0 : row) * width + column);
      work[cell] = state.red;
      work[cell + 1] = state.green;
      work[cell + 2] = state.blue;
    }
  }
  // Through the mapper on the flags it runs with (lamp_effects_music.py).
  const placement = equalizerPlacement(settings);
  const { panel } = state;
  for (let byte = 0; byte < panel.length; byte++) panel[byte] = work[placement[byte]];
  return panel;
}

const PLACEMENTS_51 = new Map();

// Panel byte -> grid byte: each grid cell through the mapper on the flags slot
// 51 runs with (0x05 behind the clock), one panel pixel each.
function equalizerPlacement(settings) {
  const mapped = DIRECTION_TABLE[REFERENCE_PROFILE][settings.direction];
  const flags = settings.handover ? HANDOVER_FLAGS : readBackFlags(51, mapped);
  const key = `${mapped},${flags}`;
  if (!PLACEMENTS_51.has(key)) {
    const table = new Uint16Array(3 * LENGTH);
    for (let pixel = 0; pixel < LENGTH; pixel++) {
      const [index] = flaggedTargets(pixel, LENGTH, mapped, flags);
      for (let channel = 0; channel < 3; channel++) table[3 * index + channel] = 3 * pixel + channel;
    }
    PLACEMENTS_51.set(key, table);
  }
  return PLACEMENTS_51.get(key);
}

// ── Slot 73: Note ─────────────────────────────────────────────────────
// The fade takes 255 to 0 in 16 renders, the 16th's glyph reads the level
// before. The demo beat never skips a frame: no clock changes that.
const NOTE_WARMUP = 16;
const NOTE_GLYPH = [
  // the 19 x 13 bitmap
  ".........#####.....",
  ".........######....",
  ".........##..##....",
  ".........##...#....",
  ".........##...#....",
  ".........##........",
  ".........##........",
  ".........##........",
  ".......####........",
  "......#####........",
  ".....######........",
  ".....######........",
  "......####.........",
].join("");

function noteInit(settings) {
  const state = gridState(settings);
  const { width, height } = state;
  const low = f32((f32(width) * 0.8) / 19);
  state.low = low;
  state.stride = f32(f32(f32((f32(width) * 1.5) / 19) - low) / 255);
  state.centreX = Math.trunc(f32(width * 0.5) + 0.49);
  state.centreY = Math.trunc(f32(height * 0.5) + 0.49);
  state.previous = 0; // the last render's level
  return state;
}

function noteStep(state, settings, clockMs, render) {
  const [level, onset] = demoSound(render);
  const { width, height, work, table, span } = state;
  let size = f32(state.stride * (level + onset + state.previous));
  size = f32(state.low + f32(size / 3));
  state.previous = level;
  const glyphW = Math.trunc(f32(size * 19) + 0.49);
  const glyphH = Math.trunc(f32(size * 13) + 0.49);
  if (((glyphW * glyphH) & 65535) > ((width * width * 10) & 65535))
    return placeStrip(work, state.direction, state.panel); // a skipped frame
  fadeGrid(work, 64, width, height);
  const time = clockMs >>> 1;
  const gain = (settings.intensity * level) >> 6;
  const sixth = Math.floor(height / 6);
  const paint = (cell, at) => {
    work[cell] = table[at];
    work[cell + 1] = table[at + 1];
    work[cell + 2] = table[at + 2];
  };
  for (let column = 0; column < width; column += 1) {
    const value = noiseHeat(
      inoise8Raw(column * 45, time & 65535, Math.imul(time, column) & 65535),
    );
    const bar = ((((value * gain) >> 6) * sixth) >> 10) & 65535;
    for (let step = 0; step < bar; step += 1) {
      const at = 3 * ((span * (Math.floor((step * 240) / bar) & 255)) >> 8);
      paint(3 * ((step < height ? step : 0) * width + column), at);
      // A row above the grid wraps through the 16-bit index and the clamp.
      const row = height - 1 - step;
      paint(3 * (row >= 0 ? row * width + width - 1 - column : width * height - 1), at);
    }
  }
  const colour = 3 * ((span * (level ^ 255)) >> 8);
  const top = Math.trunc(state.centreY - (f32(glyphH * 0.5) + 0.49) + 1);
  const left = Math.trunc(state.centreX - (f32(glyphW * 0.5) + 0.49));
  for (let row = Math.max(top, 0); row < Math.min(top + glyphH, height); row += 1) {
    const source = Math.trunc(f32(f32((row - top) * 13) / glyphH)) * 19;
    const stop = Math.min(width - left, glyphW);
    for (let offset = Math.max(-left, 0); offset < stop; offset += 1)
      if (NOTE_GLYPH[source + Math.trunc(f32(f32(offset * 19) / glyphW))] === "#")
        paint(3 * (row * width + left + offset), colour);
  }
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 74: Impact ───────────────────────────────────────────────────
const IMPACT_FALL = -0.0004000000189989805;
const IMPACT_LAUNCH = -2.200000047683716;

function impactInit(settings) {
  const state = gridState(settings);
  state.gravity = f32(state.height * f32(f32(settings.rate / -10000) + IMPACT_FALL));
  state.particles = Array.from({ length: LENGTH >> 4 }, () => ({
    y: 0,
    x: 0,
    vy: 0,
    vx: 0,
    alive: false,
    level: 0,
    radius: 0,
  }));
  state.active = 0; // the live particles
  state.stored = 0; // the level the last render kept
  state.draw = 0;
  return state;
}

/** Four source reads: side, height, drift, one unused. Then the 4r x 2r
 * ellipse at the bottom row. */
function impactSpawn(state, particle, level, at) {
  const { width, height, work, table, draw } = state;
  state.draw = draw + 4;
  const side = sourceWord(draw) & 255;
  const rise = sourceWord(draw + 1);
  const drift = sourceWord(draw + 2) & 255;
  particle.y = 0;
  particle.x = side <= 128 ? width - 3 : 2;
  const lift =
    (((height - 1) * ((Math.floor(level / 2) + ((rise >>> 1) & 127)) & 65535)) >> 8) & 65535;
  particle.vy = f32(Math.sqrt(f32(f32(state.gravity * IMPACT_LAUNCH) * lift)));
  particle.vx = f32(
    f32(width * f32(f32(((drift * 13) >> 8) - 6) * 0.0078125)) *
      f32(f32(320 - level) * 0.0078125),
  );
  particle.alive = true;
  particle.level = level & 255;
  const radius = (Math.floor(level / 128) + 1) & 255;
  particle.radius = radius;
  state.active = (state.active + 1) & 255;
  const column0 = particle.x;
  const limit = (8 * radius * radius) ** 2;
  for (let dy = -2 * radius; dy <= 2 * radius; dy += 1) {
    const row = height - 1 + dy;
    if (row < 0 || row >= height) continue;
    for (let dx = -4 * radius; dx <= 4 * radius; dx += 1) {
      const column = column0 + dx;
      if (
        column >= 0 &&
        column < width &&
        (2 * radius * dx) ** 2 + (4 * radius * dy) ** 2 <= limit
      ) {
        const cell = 3 * (row * width + column);
        work[cell] = table[at];
        work[cell + 1] = table[at + 1];
        work[cell + 2] = table[at + 2];
      }
    }
  }
}

function impactStep(state, settings, clockMs, render) {
  const [level, onset] = demoSound(render);
  const { width, height, work, table, span, gravity, particles } = state;
  fadeGrid(work, 64, width, height);
  const { stored } = state;
  let spawns = level - stored >= 17 ? Math.floor(Math.abs(stored - level) / 64) : 0;
  state.stored = level;
  if (onset) spawns = (onset >> 5) + 1;
  spawns &= 255;
  if (spawns && spawns + state.active < particles.length) {
    const at = 3 * ((span * (level & 255)) >> 8);
    for (const particle of particles) {
      if (particle.alive) continue;
      impactSpawn(state, particle, level, at);
      spawns -= 1;
      if (!spawns) break;
    }
    blurColumns(work, 128, width, height);
  }
  const start = state.active;
  let processed = 0;
  for (const particle of particles) {
    if (!particle.alive) continue;
    const { radius } = particle;
    const at = 3 * ((span * particle.level) >> 8);
    const row0 = height - 1 - Math.trunc(particle.y);
    const column0 = Math.trunc(particle.x);
    for (let dy = -radius; dy <= radius; dy += 1) {
      const row = row0 + dy;
      if (row < 0 || row >= height) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const column = column0 + dx;
        if (column >= 0 && column < width && dx * dx + dy * dy <= radius * radius) {
          const cell = 3 * (row * width + column);
          work[cell] = table[at];
          work[cell + 1] = table[at + 1];
          work[cell + 2] = table[at + 2];
        }
      }
    }
    const x = f32(particle.vx + particle.x);
    const y = f32(particle.vy + particle.y);
    const right = width + radius - 1;
    if (f32(y + radius) <= 0 || f32(radius + x) <= 0 || !(x <= right)) {
      particle.alive = false;
      state.active = (state.active - 1) & 255;
    }
    particle.x = x < -radius ? -radius : Math.min(x, right);
    particle.y = y < -radius ? -radius : Math.min(y, height + radius - 1);
    particle.vy = f32(gravity + particle.vy);
    processed += 1;
    if ((processed & 255) >= start) break;
  }
  return placeStrip(work, state.direction, state.panel);
}

export const SLOTS = [
  { mode: 20, init: breathing20Init, step: breathingStep, warmup: BREATHING_20_WARMUP },
  { mode: 25, init: bars25Init, step: barsStep, warmup: BARS_WARMUP },
  { mode: 26, init: bars26Init, step: barsStep, warmup: BARS_WARMUP },
  { mode: 27, init: musicInit, step: musicStep, warmup: MUSIC_WARMUP },
  { mode: 30, init: bars30Init, step: barsStep, warmup: BARS_WARMUP },
  { mode: 41, init: spectrumInit, step: spectrumStep, warmup: SPECTRUM_WARMUP },
  { mode: 43, init: gatherInit, step: gatherStep, warmup: null },
  { mode: 44, init: breathing44Init, step: breathingStep, warmup: BREATHING_44_WARMUP },
  { mode: 45, init: gridState, step: blossomStep, warmup: null },
  { mode: 51, init: equalizerInit, step: equalizerStep, warmup: EQUALIZER_WARMUP },
  { mode: 73, init: noteInit, step: noteStep, warmup: NOTE_WARMUP },
  { mode: 74, init: impactInit, step: impactStep, warmup: null },
];
