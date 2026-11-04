/**
 * Renderers of the lamp's trails and blocks, with the sine plotter
 * and its stacking blocks and fading dots.
 * Mirrors lamp_effects_trails.py exactly; its header tells how to add one.
 */

import {
  LENGTH,
  RENDER_MS,
  SIN8,
  beat,
  blendGrid,
  blurColumns,
  bpm88,
  convertColour,
  effectColours,
  effectGeometry,
  effectiveDirection,
  f32,
  fadeGrid,
  fadeTowards,
  newGrid,
  paletteSpan,
  placeStrip,
  rowBlurGrid,
  randomSource,
  sourceWord,
} from "./lamp-core.js";
import { SLOTS as CORE_SLOTS } from "./lamp-effects-core.js";

const newPanel = () => new Uint8Array(3 * LENGTH);

// ── Slot 15: Aurora ───────────────────────────────────────────────────
/** Seven source reads: colour, ttl, alpha, width, centre, direction, speed. */
function auroraSpawn(state) {
  const draw = state.draw;
  state.draw = draw + 7;
  let index = ((sourceWord(draw) & 255) * LENGTH) >> 8;
  index = Math.floor((index * 255) / (LENGTH - 1)) & 255;
  const at = 3 * ((index * state.span) >> 8);
  const tenth = Math.floor(LENGTH / 10);
  const reach =
    (((sourceWord(draw + 3) & 65535) * (((LENGTH >> 2) - tenth) & 65535)) >>> 16) + tenth;
  return {
    red: state.table[at],
    green: state.table[at + 1],
    blue: state.table[at + 2],
    ttl: (((sourceWord(draw + 1) & 65535) * 1001) >>> 16) + 500,
    alpha: f32(f32((((sourceWord(draw + 2) & 65535) * 31) >>> 16) + 70) / 100),
    width: reach & 65535 || 1,
    centre: f32(LENGTH * f32((((sourceWord(draw + 4) & 65535) * 101) >>> 16) / 100)),
    left: ((sourceWord(draw + 5) >>> 15) & 1) ^ 1,
    speed: f32(f32(f32(f32(((sourceWord(draw + 6) >>> 12) & 15) + 15) / 100) * 4) / 255),
    age: 0,
  };
}

function auroraInit(settings) {
  const colours = effectColours(settings);
  return {
    direction: settings.direction,
    table: colours.table,
    span: paletteSpan(colours.palette.length),
    backlight: 1 + colours.words.slice(0, 3).filter((word) => word.some(Boolean)).length,
    count: Math.trunc(f32(f32(settings.intensity / 255) * 20)),
    move: f32(Math.floor((settings.rate * 205) / 255) + 50),
    draw: 0,
    waves: null,
    light: new Int32Array(3 * LENGTH),
    strip: new Uint8Array(3 * LENGTH),
    panel: newPanel(),
  };
}

function auroraStep(state) {
  if (!state.waves)
    state.waves = Array.from({ length: state.count }, () => auroraSpawn(state));
  const { waves, move, light, strip } = state;
  for (let index = 0; index < waves.length; index += 1) {
    const wave = waves[index];
    const moved = f32(wave.speed * move);
    wave.centre = f32(wave.centre + (wave.left ? -moved : moved));
    wave.age = (wave.age + 1) & 65535;
    if (
      wave.age > wave.ttl ||
      (wave.left ? f32(wave.centre + wave.width) < 0 : f32(wave.centre - wave.width) > LENGTH)
    )
      waves[index] = auroraSpawn(state);
  }
  // Adds never go negative: the channel's sum saturates whatever the order.
  light.fill(state.backlight);
  for (const wave of waves) {
    const { centre, width, age, ttl, alpha, red, green, blue } = wave;
    const first = Math.max(0, Math.ceil(f32(centre - width)));
    const last = Math.min(LENGTH - 1, Math.floor(f32(centre + width)));
    if (first > last) continue;
    const height = f32((f32(age / ttl) < 0.5 ? age : f32(ttl - age)) / (ttl * 0.5));
    for (let pixel = first; pixel <= last; pixel += 1) {
      const factor = f32(alpha * f32(f32(1 - f32(Math.abs(f32(pixel - centre)) / width)) * height));
      const at = 3 * pixel;
      light[at] += Math.trunc(f32(red * factor));
      light[at + 1] += Math.trunc(f32(green * factor));
      light[at + 2] += Math.trunc(f32(blue * factor));
    }
  }
  for (let at = 0; at < 3 * LENGTH; at += 1) strip[at] = Math.min(255, light[at]);
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 19: Heat fire ────────────────────────────────────────────────
function solarFlareInit(settings) {
  const { rate } = settings;
  return {
    direction: settings.direction,
    table: effectColours(settings).table,
    cooling: Math.floor((100 + 5 * Math.floor(rate / 3)) / LENGTH) & 255,
    spark: 30 + Math.floor((20 * rate) / 255),
    heat: new Int32Array(LENGTH),
    bucket: 0,
    draw: 0,
    strip: new Uint8Array(3 * LENGTH),
    panel: newPanel(),
  };
}

function solarFlareStep(state, settings, clockMs) {
  const { heat, cooling, table, strip } = state;
  let { draw } = state;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const left = heat[pixel] - ((((sourceWord(draw) & 255) * cooling >> 8) + 2) & 255);
    heat[pixel] = left > 8 ? left : 8;
    draw += 1;
  }
  const bucket = Math.floor(clockMs / 32) >>> 0;
  if (bucket !== state.bucket) {
    state.bucket = bucket;
    for (let pixel = LENGTH - 1; pixel > 1; pixel -= 1)
      heat[pixel] = Math.floor((heat[pixel - 1] + 2 * heat[pixel - 2]) / 3);
    draw += 1;
    if (randomSource(draw - 1) <= state.spark) {
      const pixel = (randomSource(draw) * Math.floor(LENGTH / 3)) >> 8;
      heat[pixel] = Math.min(255, heat[pixel] + 64 + ((randomSource(draw + 1) * 134) >> 8));
      draw += 2;
    }
  }
  state.draw = draw;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const at = 3 * heat[pixel];
    strip[3 * pixel] = table[at];
    strip[3 * pixel + 1] = table[at + 1];
    strip[3 * pixel + 2] = table[at + 2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 21: Stacking blocks ──────────────────────────────────────────
// lamp_effects_trails.py tells how it runs.
// The lamp's 1/42.
const STACK_SCALE = (() => {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, 0x3f985f06);
  view.setUint32(4, 0xf6944674);
  return view.getFloat64(0);
})();

function stackInit(settings) {
  return {
    direction: settings.direction,
    draw: 0,
    palette: effectColours(settings).palette,
    due: null, // ms after the Apply; null before the first run
    phase: 0, // 0 new block, 1 waiting, 2 falling
    pile: 0,
    cursor: 0,
    position: 0,
    speed: 0,
    colour: [0, 0, 0],
    strip: new Uint8Array(3 * LENGTH),
    panel: newPanel(),
  };
}

function stackClear(state) {
  state.cursor = 0;
  state.pile = 0;
  state.phase = 0;
  state.strip.fill(0);
  return 250;
}

/** One step: what it asks to wait, in ms. */
function stackRun(state, rate) {
  if (state.pile >= LENGTH) return stackClear(state);
  if (state.phase === 0) {
    let pace = (rate >> 2) + 1;
    if (!rate) {
      pace = ((randomSource(state.draw) * 58) >> 8) + 6;
      state.draw += 1;
    }
    state.speed = f32(pace * STACK_SCALE);
    state.position = f32(LENGTH);
    const { palette, cursor } = state;
    state.colour = palette[(cursor % LENGTH) % palette.length]; // black is not skipped
    state.cursor = (cursor + 1) >>> 0;
    state.phase = 1;
  }
  if (state.phase === 1) {
    state.draw += 1;
    if (randomSource(state.draw - 1) < 64) return 25;
    state.phase = 2;
  }
  const { pile, strip } = state;
  if (!(state.position > pile)) {
    state.phase = 0;
    state.pile = pile + 1;
    return state.pile >= LENGTH ? 1000 : 25;
  }
  state.position = Math.max(f32(state.position - state.speed), pile);
  const first = Math.trunc(state.position);
  if (first < LENGTH) {
    const [red, green, blue] = state.colour;
    const end = Math.min(LENGTH, Math.ceil(f32(state.position + 1)));
    for (let pixel = first; pixel < end; pixel += 1) {
      strip[3 * pixel] = red;
      strip[3 * pixel + 1] = green;
      strip[3 * pixel + 2] = blue;
    }
    strip.fill(0, 3 * end);
  }
  return 25;
}

function stackStep(state, settings, clockMs, render) {
  const now = render * RENDER_MS;
  if (state.due !== null && now < state.due) return state.panel;
  const wait = state.due === null ? stackClear(state) : stackRun(state, settings.rate);
  state.due = now + (Math.floor(wait / 20) + 1) * 20;
  return placeStrip(state.strip, state.direction, state.panel);
}

// ── Slot 32: Waterfall ────────────────────────────────────────────────
// lamp_effects_trails.py _WATERFALL_WARMUP.
const WATERFALL_WARMUP = 39 * 4 - 1;
const WATERFALL_FADE = Uint8Array.from({ length: 256 }, (_, value) => (value * 192) >> 8);

function waterfallInit(settings) {
  const [width, height] = effectGeometry(settings);
  const { primary } = effectColours(settings);
  return {
    direction: settings.direction,
    width,
    primary,
    half: primary.map((channel) => channel >> 1),
    period: Math.max(1, Math.floor((((256 - settings.rate) >> 1) + 39) / 40)),
    work: newGrid(width, height),
    held: new Int32Array(LENGTH),
    panel: newPanel(),
  };
}

function waterfallStep(state, settings, clockMs, render) {
  const { work, held } = state;
  if (render % state.period === 0) {
    const { primary, half, width } = state;
    const [red, green, blue] = primary;
    const stride = 3 * width;
    const size = work.length;
    let count = 0;
    for (let at = size - 3; at >= 0; at -= 3)
      if (work[at] === red && work[at + 1] === green && work[at + 2] === blue) held[count++] = at;
    for (let hit = 0; hit < count; hit += 1) {
      const at = held[hit];
      work[at] = half[0];
      work[at + 1] = half[1];
      work[at + 2] = half[2];
      if (at + stride < size) {
        work[at + stride] = red;
        work[at + stride + 1] = green;
        work[at + stride + 2] = blue;
      }
    }
    let lit = 0;
    for (let at = 0; at < size; at += 1) {
      work[at] = WATERFALL_FADE[work[at]];
      lit |= work[at];
    }
    for (let hit = 0; hit < count; hit += 1) {
      const at = held[hit] + stride;
      if (at < size) {
        work[at] = red;
        work[at + 1] = green;
        work[at + 2] = blue;
        lit |= red | green | blue;
      }
    }
    if (!lit || randomSource(2 * render) < settings.intensity) {
      const column = (randomSource(2 * render + 1) * width) >> 8;
      const at = 3 * (width <= column ? 0 : column);
      work[at] = red;
      work[at + 1] = green;
      work[at + 2] = blue;
    }
  }
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 35: Tide (slot 35) ───────────────────────────────────────────
// The same renderer as Tide.
const TIDE = CORE_SLOTS.find((slot) => slot.mode === 48);

// ── Slot 37: Bouncing Ball ────────────────────────────────────────────
// lamp_effects_trails.py _PINBALL_WARMUP.
const PINBALL_WARMUP = 32;

function pinballInit(settings) {
  const [width, height] = effectGeometry(settings);
  const { rate, intensity } = settings;
  return {
    direction: settings.direction,
    width,
    height,
    table: effectColours(settings).table,
    across: Int32Array.from({ length: 8 }, (_, dot) => bpm88((rate >> 3) + 8 - dot)),
    down: Int32Array.from({ length: 8 }, (_, dot) => bpm88((intensity >> 3) + dot - 8)),
    work: newGrid(width, height),
    panel: newPanel(),
  };
}

function pinballStep(state, settings, clockMs) {
  const { width, height, work, table } = state;
  fadeGrid(work, 128, width, height);
  const index = 3 * (((beat(clockMs, 12 << 8) * 255) >> 9) | 128);
  const red = table[index];
  const green = table[index + 1];
  const blue = table[index + 2];
  for (let dot = 0; dot < 8; dot += 1) {
    const across = beat(clockMs, state.across[dot]);
    const down = beat(clockMs, state.down[dot]);
    let x = (across * width) >> 8;
    let y = (down * height) >> 8;
    const first = 3 * ((y < height ? y : 0) * width + (x < width ? x : 0));
    x = (across * (width - 1)) >> 8;
    y = (down * (height - 1)) >> 8;
    const second = 3 * ((y < height ? y : 0) * width + (x < width ? x : 0));
    work[first] = Math.min(255, work[second] + red);
    work[first + 1] = Math.min(255, work[second + 1] + green);
    work[first + 2] = Math.min(255, work[second + 2] + blue);
  }
  rowBlurGrid(work, width, height);
  blurColumns(work, 16, width, height);
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 38: Sine plotter ─────────────────────────────────────────────
// lamp_effects_trails.py tells how it runs.
const PLOTTER_RENDERS = 10;

function plotterInit(settings) {
  const [width, height] = effectGeometry(settings);
  const plotted = new Map();
  for (let phase = 0; phase < 256; phase += 1) {
    const column = Math.trunc(((width + 5) * (phase === 255 ? 0 : phase)) / 255 + 0 + 0.5);
    const row = Math.trunc((SIN8[phase] * 3) / 255 + 0 + 3);
    const cell = (row < height ? row : 0) * width + (column < width ? column : 0);
    if (!plotted.has(cell)) plotted.set(cell, phase);
  }
  return {
    direction: settings.direction,
    cells: [...plotted], // by first phase
    phases: -1,
    strip: new Uint8Array(3 * LENGTH),
    panel: newPanel(),
  };
}

function plotterStep(state, settings, clockMs, render) {
  const phases = Math.min(Math.floor(render / PLOTTER_RENDERS), 255);
  if (phases !== state.phases) {
    state.phases = phases;
    const { strip } = state;
    strip.fill(0);
    for (const [cell, phase] of state.cells) {
      if (phase > phases) break;
      strip.fill(255, 3 * cell, 3 * cell + 3);
    }
    placeStrip(strip, state.direction, state.panel);
  }
  return state.panel;
}

// ── Slot 46: Hacking ──────────────────────────────────────────────────
// lamp_effects_trails.py _HACKING_WARMUP.
const HACKING_WARMUP = 7;
const HACKING_GLYPHS = [1, 0, 1, 0, 0, 1, 1, 0, 0, 0]; // each record's digit
const HACKING_SOURCES = [[0x06, 0x3e, 0x29], [0x76, 0xff, 0xce], [0x00, 0xd4, 0x88]]; // the three greens
const HACKING_BITMAPS = [0xf6f, 0xe93]; // digits 0 and 1

/** Where a 3 x 4 digit lands on rows y - 5 .. y - 2. */
function hackingCells(bitmap, y, width, height) {
  const cells = [];
  for (let row = y - 5; row < y - 1; row += 1) {
    if (row >= 0)
      for (let bit = 0; bit < 3; bit += 1)
        if (bitmap & (1 << bit)) {
          const x = bit + 1 < width ? bit + 1 : 0;
          cells.push(3 * ((row < height ? row : 0) * width + x));
        }
    bitmap = (bitmap >> 3) & 0x1fff;
  }
  return Int32Array.from(cells);
}

function hackingInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: effectiveDirection(settings),
    width,
    height,
    period: ((settings.rate ^ 0xf0) >> 4) + 1,
    colours: Array.from({ length: 10 }, (_, k) => convertColour(HACKING_SOURCES[k % 3])),
    digits: HACKING_BITMAPS.map((bitmap) =>
      Array.from({ length: height + 5 }, (_, y) => hackingCells(bitmap, y, width, height)),
    ),
    work: newGrid(width, height),
    panel: newPanel(),
  };
}

function hackingStep(state, settings, clockMs, render) {
  const { width, height, work, colours, digits } = state;
  blendGrid(work, 128, width, height, [0, 2, 1]);
  const moved = Math.floor(render / state.period) + 1;
  const top = height + 5;
  for (let record = 0; record < 10; record += 1) {
    const y = (5 * record + moved) % 50;
    if (y < top) {
      const [red, green, blue] = colours[record];
      const cells = digits[HACKING_GLYPHS[record]][y];
      for (let cell = 0; cell < cells.length; cell += 1) {
        const at = cells[cell];
        work[at] = red;
        work[at + 1] = green;
        work[at + 2] = blue;
      }
    }
  }
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 47: Meteor ───────────────────────────────────────────────────
/** A meteor's spawn: speed, start, colour, column. */
function meteorSpawn(state, meteor, clockMs) {
  const { draw, table } = state;
  state.draw = draw + 4;
  meteor.speed = f32(((randomSource(draw) * 3) >> 8) + 1);
  meteor.start = f32(-50 - ((randomSource(draw + 1) * 50) >> 8));
  const at = 3 * (Math.floor((randomSource(draw + 2) * 255) / (LENGTH - 1)) & 255);
  meteor.red = table[at];
  meteor.green = table[at + 1];
  meteor.blue = table[at + 2];
  meteor.column = (state.width * randomSource(draw + 3)) >> 8;
  meteor.time = clockMs;
}

function meteorInit(settings) {
  const [width, height] = effectGeometry(settings);
  return {
    direction: settings.direction,
    width,
    height,
    table: effectColours(settings).table,
    count: ((settings.intensity >> 3) + 10) & 255,
    pace: (settings.rate + 32) >> 4,
    draw: 0,
    meteors: null,
    work: newGrid(width, height),
    panel: newPanel(),
  };
}

function meteorPut(state, meteor, row, scale) {
  const at = 3 * (row * state.width + meteor.column);
  state.work[at] = (meteor.red * scale) >> 8;
  state.work[at + 1] = (meteor.green * scale) >> 8;
  state.work[at + 2] = (meteor.blue * scale) >> 8;
}

function meteorStep(state, settings, clockMs) {
  const { height, pace, work } = state;
  if (!state.meteors) {
    state.meteors = Array.from({ length: state.count }, () => ({
      speed: 0,
      start: 0,
      red: 0,
      green: 0,
      blue: 0,
      column: 0,
      time: 0,
    }));
    for (const meteor of state.meteors) {
      meteorSpawn(state, meteor, clockMs);
      const value = randomSource(state.draw);
      state.draw += 1;
      meteor.start = f32(((value * ((2 * height) & 255)) >> 8) - height);
    }
  }
  work.fill(0);
  for (const meteor of state.meteors) {
    let elapsed = clockMs - meteor.time;
    if (elapsed < 0) elapsed += 2 ** 64;
    let position = f32(meteor.start + f32(meteor.speed * pace) * (elapsed / 1000));
    const trail = f32(meteor.speed * 2.5 + 1);
    if (!(position <= f32(height + f32(trail + trail)))) {
      const { draw } = state;
      state.draw = draw + 1;
      if (randomSource(draw) < 128) {
        meteorSpawn(state, meteor, clockMs);
        position = meteor.start;
      }
    }
    const { speed } = meteor;
    // Off the grid a draw lands 3 bytes before the buffer, which nothing reads.
    const first = Math.trunc(f32(position - 2));
    const last = Math.ceil(position) + 10;
    const fade = f32(f32(speed - 1) * 0.2 + 0.4);
    const bright = Math.trunc(fade * 255);
    const end = Math.min(last, height - 1);
    for (let row = Math.max(first, 0); row <= end; row += 1) {
      const e = f32((Math.abs(f32(row - position)) - 0.5) * 0.5);
      if (e < 0) meteorPut(state, meteor, row, bright);
      else if (e <= 1) meteorPut(state, meteor, row, Math.trunc(f32(fade * f32(255 - e * 255))));
    }
    const length = Math.trunc(f32(speed * 2.5 + 1));
    const limit = f32(position - length);
    for (let row = Math.min(Math.trunc(position), height - 1); row >= limit && row >= 0; row -= 1) {
      const e = f32((Math.abs(f32(row - position)) - 0.5) / length);
      if (e < 0) meteorPut(state, meteor, row, bright);
      else if (e <= 1)
        meteorPut(state, meteor, row, Math.trunc(f32(fade * f32(255 - f32(e * e) * 255))));
    }
  }
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 49: Building Blocks ──────────────────────────────────────────
// lamp_effects_trails.py tells what the records are.
function blocksInit(settings) {
  const [width, height] = effectGeometry(settings);
  const { rate, intensity } = settings;
  return {
    direction: settings.direction,
    width,
    height,
    primary: effectColours(settings).primary,
    gate: ((Math.floor((rate * 104) / 255) + 64) >> 3) + 1,
    landing: ((rate ^ 255) + 16) >> 4,
    falling: ((rate ^ 255) + 16) >> 5,
    fade: ((intensity >> 1) | 128) & 255,
    kinds: new Uint8Array(LENGTH), // 0 empty, 1 falling, 2 settled
    due: new Int32Array(LENGTH),
    draw: 1,
    work: newGrid(width, height),
    panel: newPanel(),
  };
}

function blocksStep(state, settings, clockMs, render) {
  const { width, height, work, kinds, due } = state;
  let { draw } = state;
  const source = randomSource(draw);
  draw += 1;
  if ((((state.gate * source) >> 8) & 255) === 0) {
    for (let attempt = 0; attempt <= width; attempt += 1) {
      const column = randomSource(draw);
      draw += 1;
      const slot = (height - 1) * width + ((column * width) >> 8);
      if (kinds[slot] === 0) {
        kinds[slot] = 1;
        due[slot] = render + state.landing;
        break;
      }
    }
  }
  state.draw = draw;
  for (let column = 0; column < width; column += 1) {
    for (let here = column; here < width * height; here += width) {
      if (kinds[here] !== 1 || due[here] > render) continue;
      if (here >= width && kinds[here - width] === 0) {
        kinds[here - width] = 1;
        due[here - width] = render + state.falling;
        kinds[here] = 0;
        due[here] = 0;
      } else kinds[here] = 2;
    }
  }
  fadeGrid(work, state.fade, width, height);
  const [red, green, blue] = state.primary;
  let painted = 0;
  for (let here = 0; here < LENGTH; here += 1) {
    if (kinds[here]) {
      work[3 * here] = red;
      work[3 * here + 1] = green;
      work[3 * here + 2] = blue;
      painted += 1;
    }
  }
  if (painted >= LENGTH) {
    kinds.fill(0);
    due.fill(0);
  }
  return placeStrip(work, state.direction, state.panel);
}

// ── Slot 62: Dot trail ────────────────────────────────────────────────
// lamp_effects_trails.py _DOT_TRAIL_WARMUP.
const DOT_TRAIL_WARMUP = 67;
const DOT_TRAIL_LEVEL = Math.floor(((LENGTH - 1) * 255) / LENGTH); // the last of the N writes wins

function dotTrailInit(settings) {
  const { rate } = settings;
  return {
    direction: settings.direction,
    period: 20 + Math.trunc((-10 * rate) / 255),
    amount: (Math.floor((rate * 30) / 255) + 210) & 255,
    colour: effectColours(settings).primary.map((channel) => (channel * DOT_TRAIL_LEVEL) >> 8),
    strip: new Uint8Array(3 * LENGTH),
    panel: newPanel(),
  };
}

function dotTrailStep(state, settings, clockMs, render) {
  const { strip, period, colour } = state;
  fadeTowards(strip, state.amount);
  const turn = Math.floor(render / period);
  if (turn & 1 && render % period === 0) {
    const at = 3 * ((turn - 1) % LENGTH);
    strip[at] = colour[0];
    strip[at + 1] = colour[1];
    strip[at + 2] = colour[2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

export const SLOTS = [
  { mode: 15, init: auroraInit, step: auroraStep, warmup: null },
  { mode: 19, init: solarFlareInit, step: solarFlareStep, warmup: null },
  { mode: 21, init: stackInit, step: stackStep, warmup: null, lit: 1 },
  { mode: 32, init: waterfallInit, step: waterfallStep, warmup: WATERFALL_WARMUP },
  { ...TIDE, mode: 35 },
  { mode: 37, init: pinballInit, step: pinballStep, warmup: PINBALL_WARMUP },
  { mode: 38, init: plotterInit, step: plotterStep, warmup: 0, lit: 1 },
  { mode: 46, init: hackingInit, step: hackingStep, warmup: HACKING_WARMUP },
  { mode: 47, init: meteorInit, step: meteorStep, warmup: null },
  { mode: 49, init: blocksInit, step: blocksStep, warmup: null },
  { mode: 62, init: dotTrailInit, step: dotTrailStep, warmup: DOT_TRAIL_WARMUP, lit: 1 },
];
