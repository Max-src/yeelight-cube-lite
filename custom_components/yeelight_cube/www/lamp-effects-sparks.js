/**
 * Renderers of the lamp's particles and sparks.
 * Mirrors lamp_effects_sparks.py exactly; its header tells how to add one.
 *
 * Each draws from the random source in the order of its first run, so what it
 * keeps depends on all the history (warmup null), except Spectrum Chase and Random
 * scatter. Also here: the palette and aqua-lime trails, the drop-and-bounce dot, the
 * rising wisps and the centre bursts.
 */

import {
  DIRECTION_TABLE,
  LENGTH,
  REFERENCE_PROFILE,
  SIN8,
  convertColour,
  effectColours,
  effectGeometry,
  f32,
  fadeTowards,
  flaggedTargets,
  paletteSpan,
  placeStrip,
  readBackFlags,
  sin16Unsigned,
  sourceWord,
  stripBlur,
} from "./lamp-core.js";

/** The random source's next word: one draw per read. */
const read = (state) => sourceWord(state.reads++);

/** The seed scan: from the cursor, the first palette entry that is not black, or
 * black after `pixels` attempts. */
function scanColour(state, pixels = LENGTH, wrap = 2 ** 32) {
  const { palette, cursor } = state;
  let colour = [0, 0, 0];
  let attempt = 0;
  while (attempt < pixels) {
    colour = palette[((attempt + cursor) % pixels) % palette.length];
    attempt += 1;
    if (colour[0] || colour[1] || colour[2]) break;
  }
  state.cursor = (cursor + attempt) % wrap;
  return colour;
}

// ── Slots 5 and 79: the twinkle pass ──────────────────────────────────
function twinkleInit(settings, keepBase) {
  const { rate } = settings;
  const grow = (rate >> 2) + 8;
  const fade = (keepBase - Math.floor(rate / 7)) & 255;
  const sums = new Int32Array(256);
  const keep = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    sums[value] = value + (value ? ((value * grow) >> 8) + 1 : 0);
    keep[value] = (value * fade) >> 8;
  }
  return {
    direction: settings.direction,
    reads: 0,
    stars: new Uint8Array(3 * LENGTH),
    growing: new Uint8Array(LENGTH),
    sums,
    keep,
    panel: new Uint8Array(3 * LENGTH),
  };
}

/** Growing: s = c + (c * k >> 8) + 1; a channel at 255 ends the growth, and a
 * channel that did not change doubles the sums. Else c * keep >> 8. */
function twinklePass({ stars, growing, sums, keep }) {
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const at = 3 * pixel;
    const red = stars[at];
    const green = stars[at + 1];
    const blue = stars[at + 2];
    if (growing[pixel]) {
      const first = sums[red];
      const second = sums[green];
      const third = sums[blue];
      let newRed = Math.min(255, first);
      let newGreen = Math.min(255, second);
      let newBlue = Math.min(255, third);
      if (newRed === 255 || newGreen === 255 || newBlue === 255) growing[pixel] = 0;
      if (newRed === red || newGreen === green || newBlue === blue) {
        newRed = Math.min(255, 2 * first);
        newGreen = Math.min(255, 2 * second);
        newBlue = Math.min(255, 2 * third);
      }
      stars[at] = newRed;
      stars[at + 1] = newGreen;
      stars[at + 2] = newBlue;
    } else if (red || green || blue) {
      stars[at] = keep[red];
      stars[at + 1] = keep[green];
      stars[at + 2] = keep[blue];
    }
  }
}

const occupied = (stars, target) =>
  stars[3 * target] !== 0 || stars[3 * target + 1] !== 0 || stars[3 * target + 2] !== 0;

// ── Slot 5: Starry Sky ────────────────────────────────────────────────
/** The seed colour: the primary to HSV, the hue moved by `shift` (the jitter's
 * high nibble) - 8, S and V cut to hundredths, and back through the six-way
 * switch. */
export function starrySeed(primary, shift) {
  const [red, green, blue] = Array.from(primary, (channel) => f32(channel / 255));
  const top = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  let saturation = top > 1e-4 ? f32(f32(top - low) / top) : 0;
  let hue = 0;
  if (!(saturation < 1e-4)) {
    const spread = f32(top - low);
    const bluePart = f32(f32(top - blue) / spread);
    const greenPart = f32(f32(top - green) / spread);
    let sector;
    if (red === top) sector = f32(bluePart - greenPart);
    else {
      const redPart = f32(f32(top - red) / spread);
      sector = green === top ? f32(redPart + 2 - bluePart) : f32(greenPart + 4 - redPart);
    }
    let degrees = f32(sector * 60);
    if (degrees < 0) degrees = f32(degrees + 360);
    hue = Math.trunc(degrees);
  }
  let shifted = hue + shift - 8;
  if (shifted < 0) shifted += 360;
  saturation = f32(Math.trunc(f32(saturation * 100)) / 100);
  const value = f32(Math.trunc(f32(top * 100)) / 100);
  let channels = [value, value, value];
  if (!(saturation < 1e-4)) {
    const angle = shifted > 359 ? f32(f32(shifted) - 360) : f32(shifted);
    const position = f32(angle / 60);
    const index = Math.floor(position);
    const fraction = f32(position - index);
    const rising = f32(value * (1 - saturation * (1 - fraction)));
    const floor = f32(value * (1 - saturation));
    const falling = f32(value * (1 - f32(saturation * fraction)));
    channels = [
      [value, rising, floor],
      [falling, value, floor],
      [floor, value, rising],
      [floor, falling, value],
      [rising, floor, value],
      [value, floor, falling],
    ][index];
  }
  return channels.map((channel) => Math.trunc(f32(channel * 255)));
}

function starryInit(settings) {
  const { primary } = effectColours(settings);
  return {
    ...twinkleInit(settings, 250),
    seeds: Array.from({ length: 16 }, (_, shift) => starrySeed(primary, shift)),
  };
}

const seedStar = (state, target, colour) => {
  const at = 3 * target;
  state.stars[at] = colour[0];
  state.stars[at + 1] = colour[1];
  state.stars[at + 2] = colour[2];
  state.growing[target] = 1;
};

function starryStep(state, settings) {
  twinklePass(state);
  const { stars } = state;
  for (let chance = 0; chance < Math.floor(LENGTH / 50) + 1; chance += 1) {
    if ((read(state) & 255) > settings.intensity) continue;
    read(state); // unused
    for (let attempt = 1; ; attempt += 1) {
      const target = ((read(state) & 0xffff) * LENGTH) >>> 16;
      if (occupied(stars, target)) {
        if (attempt < ((read(state) >>> 7) & 1) + 1) continue;
        break;
      }
      seedStar(state, target, state.seeds[(read(state) >>> 4) & 15]);
      break;
    }
  }
  return placeStrip(stars, state.direction, state.panel);
}

// ── Slot 6: Particle path ─────────────────────────────────────────────
// lamp_effects_sparks.py _CHASE_WARMUP.
const CHASE_WARMUP = 190;

/** The wipe renderers' colour wheel. */
function wheel(byte) {
  if (byte >= 171) {
    const rest = 255 - byte;
    return [(255 - 3 * rest) & 255, 0, 3 * rest];
  }
  if (byte >= 86) {
    const rest = 170 - byte;
    return [0, 3 * rest, 255 - 3 * rest];
  }
  const rest = 85 - byte;
  return [3 * rest, 255 - 3 * rest, 0];
}

function chaseInit(settings) {
  return {
    direction: settings.direction,
    divisor: 256 - settings.rate,
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function chaseStep(state, settings, clockMs, render) {
  const { strip, divisor } = state;
  fadeTowards(strip, settings.intensity);
  const quotient = Math.floor(clockMs / divisor);
  if (!render || quotient !== Math.floor((clockMs - 40) / divisor)) {
    // The first render always steps.
    const steps =
      divisor <= 40 ? render : quotient - Math.floor((clockMs - 40 * render) / divisor);
    const colour = wheel(quotient & 255);
    for (let start = 0; start < LENGTH; start += LENGTH >> 2) {
      const position = (start + steps) % (LENGTH + 1);
      if (position < LENGTH) {
        strip[3 * position] = colour[0];
        strip[3 * position + 1] = colour[1];
        strip[3 * position + 2] = colour[2];
      }
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 22: Mirrored comets ──────────────────────────────────────────
// lamp_effects_sparks.py tells how it runs.
const PRISM_PIXELS = 50;
const PRISM_COMETS = Math.floor(PRISM_PIXELS / 6) + 1;
// The lamp's 1/99.
const PRISM_SCALE = (() => {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, 0x3f84af4f);
  view.setUint32(4, 0x0d844d01);
  return view.getFloat64(0);
})();

function prismTiming(x) {
  const speed = f32(x * PRISM_SCALE);
  return [speed, f32(f32(PRISM_PIXELS / speed) / PRISM_COMETS)];
}

function prismInit(settings) {
  const mapped = DIRECTION_TABLE[REFERENCE_PROFILE][settings.direction];
  const flags = readBackFlags(22, mapped) | 0x0a;
  const { rate } = settings;
  return {
    reads: 0,
    timer: 0,
    cursor: 0,
    palette: effectColours(settings).palette,
    // A comet's two pixels reach past the 50.
    targets: Array.from({ length: PRISM_PIXELS + 2 }, (_, pixel) =>
      flaggedTargets(pixel, LENGTH, mapped, flags).map((index) => 3 * index),
    ),
    timing: rate ? prismTiming((rate >> 2) + 1) : null,
    comets: Array.from({ length: PRISM_COMETS }, () => ({
      active: false,
      position: 0,
      speed: 0,
      colour: null,
    })),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function prismStep(state, settings, clockMs, render) {
  const timing = state.timing ?? prismTiming((((read(state) & 255) * 58) >> 8) + 6);
  const { panel, comets, targets } = state;
  panel.fill(0);
  if (!render) {
    state.timer = 1;
    return panel;
  }
  const [speed, interval] = timing;
  if (!(state.timer <= interval)) {
    state.timer = 0;
    const comet = comets.find((candidate) => !candidate.active);
    if (comet) {
      comet.active = true;
      comet.position = 0;
      comet.speed = speed;
      comet.colour = scanColour(state, PRISM_PIXELS);
    }
  }
  for (const comet of comets) {
    if (!comet.active) continue;
    if (comet.position <= PRISM_PIXELS) {
      const at = Math.trunc(comet.position);
      const { colour } = comet;
      for (let pixel = at; pixel <= at + 1; pixel += 1)
        for (const target of targets[pixel]) {
          panel[target] = colour[0];
          panel[target + 1] = colour[1];
          panel[target + 2] = colour[2];
        }
    } else comet.active = false;
    comet.position = f32(comet.speed + comet.position);
  }
  state.timer = (state.timer + 1) & 0xffff;
  return panel;
}

// ── Slot 24: Palette sparks ───────────────────────────────────────────
const EMBER_SPARKS = LENGTH >> 1;
const EMBER_TRIES = 14; // trunc((N + 8) / 8 + 0.5)

function emberInit(settings) {
  const { table } = effectColours(settings);
  const colours = new Uint8Array(3 * 256);
  for (let level = 0; level < 256; level += 1) {
    const index = 3 * ((level >> 1) + 32);
    const gain = Math.floor((level * 239) / 255) + 16;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = table[index + channel];
      colours[3 * level + channel] = gain === 255 ? value : (value * (gain + 1)) >> 8;
    }
  }
  return {
    direction: settings.direction,
    reads: 0,
    colours,
    active: 0,
    status: new Uint8Array(EMBER_SPARKS),
    levels: new Int32Array(EMBER_SPARKS),
    positions: new Int32Array(EMBER_SPARKS),
    ups: new Int32Array(EMBER_SPARKS),
    downs: new Int32Array(EMBER_SPARKS),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function emberDraw({ status, levels, positions, colours, strip }) {
  for (let spark = 0; spark < EMBER_SPARKS; spark += 1) {
    if (!status[spark]) continue;
    const at = 3 * positions[spark];
    const level = 3 * levels[spark];
    strip[at] = colours[level];
    strip[at + 1] = colours[level + 1];
    strip[at + 2] = colours[level + 2];
  }
}

function emberStep(state) {
  const { status, levels, ups, downs, strip } = state;
  read(state); // discarded before the spawn calculation
  let attempts = 0;
  while (state.active < EMBER_SPARKS) {
    const spark = status.indexOf(0);
    levels[spark] = (read(state) >>> 4) & 15;
    state.positions[spark] = ((read(state) & 255) * LENGTH) >> 8;
    downs[spark] = (((read(state) & 255) * 15) >> 8) + 1;
    ups[spark] = (((read(state) & 255) * 15) >> 8) + 1;
    status[spark] = 1;
    state.active += 1;
    attempts += 1;
    if (attempts > (((read(state) & 255) * EMBER_TRIES) >> 8)) break;
  }
  emberDraw(state);
  stripBlur(strip, 64);
  emberDraw(state);
  for (let spark = 0; spark < EMBER_SPARKS; spark += 1) {
    if (status[spark] === 1) {
      levels[spark] += ups[spark];
      if (levels[spark] >= 255) {
        levels[spark] = 255;
        status[spark] = 2;
      }
    } else if (status[spark] === 2) {
      levels[spark] -= downs[spark];
      if (levels[spark] <= 0) {
        levels[spark] = 0;
        status[spark] = 0;
        state.active -= 1;
      }
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slots 14 and 23: the trail pass ───────────────────────────────────
// Slots 14 and 23 only differ by their seed.
const TRAIL_POINTS = 4; // whatever the intensity
const TRAIL_COLOURS = [[0x65, 0xfa, 0xff], [0x7e, 0xff, 0x32]]; // slot 23's, by bit 7: never converted

function trailInit(settings) {
  const { intensity, rate } = settings;
  return {
    direction: settings.direction,
    reads: 0,
    cursor: 0,
    palette: effectColours(settings).palette,
    amount: (intensity + Math.trunc(((1 - Math.floor(LENGTH / 40)) * (intensity ^ 255)) / 2)) & 255,
    period: Math.floor(((rate ^ 255) * (LENGTH + 40) * 4) / 200) + 1,
    bucket: 0,
    points: null,
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function trailPass(state, clockMs, seed) {
  const { strip } = state;
  fadeTowards(strip, state.amount);
  const bucket = Math.floor(clockMs / state.period) >>> 0;
  if (bucket !== state.bucket) {
    state.bucket = bucket;
    if (!state.points)
      state.points = Array.from({ length: TRAIL_POINTS }, () => {
        const position = ((read(state) & 0xffff) * LENGTH) >>> 16;
        return { position, colour: seed(state) };
      });
    for (const point of state.points) {
      const { position } = point;
      if (position < LENGTH) {
        const { colour } = point;
        strip[3 * position] = colour[0];
        strip[3 * position + 1] = colour[1];
        strip[3 * position + 2] = colour[2];
        point.position = position + 1;
      } else if ((((read(state) & 0xffff) * (LENGTH + 4)) & 0x7fff0000) === 0) {
        point.position = 0;
        point.colour = seed(state);
      }
    }
  }
  return placeStrip(strip, state.direction, state.panel);
}

const paletteSeed = (state) => scanColour(state, LENGTH, 0x10000);
const aquaLimeSeed = (state) => TRAIL_COLOURS[(read(state) >>> 7) & 1];
const trailStep = (state, settings, clockMs) => trailPass(state, clockMs, paletteSeed);
const aquaLimeStep = (state, settings, clockMs) => trailPass(state, clockMs, aquaLimeSeed);

// ── Slot 16: Drop and bounce ──────────────────────────────────────────
function dropInit(settings) {
  const { rate } = settings;
  return {
    direction: settings.direction,
    reads: 0,
    cursor: 0,
    palette: effectColours(settings).palette,
    gain: Math.floor(rate / 51) + 1,
    pull: f32(f32(LENGTH) * f32(rate / -100000 + -0.001)),
    phase: 0, // 0 new, 1 waiting, 2 falling, 5 bounced
    position: 0,
    speed: 0,
    counter: 0,
    colour: [0, 0, 0],
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function dropDraw({ strip, position, colour }) {
  const at = 3 * Math.trunc(position);
  strip[at] = colour[0];
  strip[at + 1] = colour[1];
  strip[at + 2] = colour[2];
}

function dropStep(state) {
  fadeTowards(state.strip, 251);
  let { phase } = state;
  let moving = phase >= 2;
  if (phase === 0) {
    state.position = f32(LENGTH - 1);
    state.speed = 0;
    state.counter = 12;
    state.colour = scanColour(state);
    phase = 1;
    state.phase = 1;
  } else if (phase === 1 && state.counter >= 256) state.counter = 255;
  if (!moving) {
    dropDraw(state);
    state.counter = (state.counter + state.gain) & 0xffff;
    if ((read(state) & 255) < Math.floor(state.counter / 10)) {
      phase = 2;
      state.phase = 2;
      state.counter = 255;
      moving = true;
    }
  }
  if (moving) {
    const { position, speed } = state;
    if (!(position > 0)) {
      if (phase < 3) {
        // Not drawn on this render.
        state.speed = f32(speed * -0.5);
        state.position = f32(state.speed + position);
        state.counter = 24;
        state.phase = 5;
      } else {
        state.counter = 12;
        state.phase = 0;
      }
    } else {
      state.position = Math.max(f32(position + speed), 0);
      state.speed = f32(state.pull + speed);
      dropDraw(state);
    }
  }
  return placeStrip(state.strip, state.direction, state.panel);
}

// ── Slot 33: Rising wisps ─────────────────────────────────────────────
// lamp_effects_sparks.py tells what it reads.
const WISPS = 20;
const WISP_GAINS = Math.floor(65025 / 257) + 1; // sin8 x sin8 / 257

function wispsInit(settings) {
  const [width, height] = effectGeometry(settings);
  const { primary, secondary } = effectColours(settings);
  const blends = new Uint8Array(3 * 256);
  for (let level = 0; level < 256; level += 1)
    for (let channel = 0; channel < 3; channel += 1)
      blends[3 * level + channel] =
        level === 0
          ? secondary[channel]
          : level === 255
            ? primary[channel]
            : (secondary[channel] * (255 - level) + primary[channel] * level) >> 8;
  return {
    direction: settings.direction,
    width,
    height,
    reads: 0,
    blends,
    wisps: new Array(WISPS).fill(null),
    sums: new Int32Array(LENGTH),
    counts: new Int32Array(LENGTH),
    waves: new Uint8Array(width),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

/** The seven reads of a spawn; the last one's byte is unused. */
function wispSpawn(state) {
  const { width } = state;
  const speed = f32(f32((((read(state) & 0xffff) * 27) >>> 16) + 3) / 40);
  const pull = f32(f32(((read(state) >>> 13) & 7) | 8) / 10000);
  const size = f32(f32((((read(state) & 0xffff) * 500) >>> 16) + 300) / 100);
  const stretch = f32(f32((((read(state) & 0xffff) * 800) >>> 16) + 400) / 100);
  const gain = f32(f32((((read(state) & 0xffff) * 50) >>> 16) + 50) / 100);
  const phase = read(state) & 255;
  read(state);
  const span = f32(f32(width / stretch) * 255);
  const turns = new Int32Array(width);
  for (let column = 0; column < width; column += 1)
    turns[column] = Math.trunc((column * span) / (width - 1)) - 64;
  const gains = new Int32Array(WISP_GAINS);
  for (let value = 0; value < WISP_GAINS; value += 1) gains[value] = Math.trunc(f32(gain * value));
  return { position: 0, speed, pull, half: f32(size * 0.5), phase, age: 0, turns, gains };
}

function wispsStep(state) {
  const { wisps, width, height, sums, counts, waves, blends, strip } = state;
  if ((((read(state) & 255) * 6) & 0x700) === 0) {
    const free = wisps.indexOf(null);
    if (free >= 0) wisps[free] = wispSpawn(state);
  }
  // By wisp, not by cell: the sums do not care for the order.
  sums.fill(0);
  counts.fill(0);
  for (const wisp of wisps) {
    if (!wisp) continue;
    const { position, half, phase, turns, gains } = wisp;
    const low = f32(position - half);
    const high = f32(position + half);
    const spread = high - low;
    const rest = 255 - wisp.age;
    for (let column = 0; column < width; column += 1)
      waves[column] = SIN8[(turns[column] + phase) & 255];
    const end = Math.min(height, Math.ceil(high) + 2);
    for (let row = Math.max(0, Math.floor(low) - 1); row < end; row += 1) {
      const offset = f32(row - position);
      if (Math.abs(offset) > half) continue;
      const swell = SIN8[(Math.trunc(((f32(position + offset) - low) * 255) / spread) - 64) & 255];
      for (let column = 0, cell = row * width; column < width; column += 1, cell += 1) {
        const value = (gains[Math.floor((waves[column] * swell) / 257)] * rest) >> 8;
        if (value) {
          sums[cell] += value;
          counts[cell] += 1;
        }
      }
    }
  }
  // A dead record runs on unread: lamp_effects_sparks.py tells why.
  for (let index = 0; index < WISPS; index += 1) {
    const wisp = wisps[index];
    if (!wisp) continue;
    wisp.position = f32(wisp.position + wisp.speed);
    wisp.speed = f32(wisp.speed - wisp.pull);
    wisp.phase = (wisp.phase + 1) & 255;
    wisp.age += 1;
    if (f32(wisp.position + wisp.half) < 0 || wisp.age >= 256) wisps[index] = null;
  }
  for (let cell = 0; cell < LENGTH; cell += 1) {
    const at = 3 * (counts[cell] ? Math.floor(sums[cell] / counts[cell]) : 0);
    strip[3 * cell] = blends[at];
    strip[3 * cell + 1] = blends[at + 1];
    strip[3 * cell + 2] = blends[at + 2];
  }
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 60: Flicker sweep ────────────────────────────────────────────
const CRUMBLE_SPAN = 5 * LENGTH; // the spark run sweeps a virtual length of 5N
const CRUMBLE_RUN = Math.floor(LENGTH / 10) + 1;

function crumbleInit(settings) {
  const colours = effectColours(settings);
  const { table } = colours;
  const span = paletteSpan(colours.palette.length);
  const bases = new Uint8Array(3 * LENGTH);
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const index = 3 * (((Math.floor((pixel * 255) / (LENGTH - 1)) & 255) * span) >> 8);
    bases[3 * pixel] = table[index];
    bases[3 * pixel + 1] = table[index + 1];
    bases[3 * pixel + 2] = table[index + 2];
  }
  return {
    direction: settings.direction,
    reads: 0,
    bases,
    heat: new Uint8Array(LENGTH),
    sweep: 0,
    step: Math.floor((settings.rate * 180) / 255) + 50,
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function crumbleStep(state, settings) {
  const { heat, bases, strip } = state;
  const limit = 255 - settings.intensity;
  for (let pixel = 0; pixel < LENGTH; pixel += 1) {
    const value = heat[pixel];
    if (value === 0 || (read(state) & 255) > limit) continue;
    let stored = (value + 3 - (((read(state) & 255) * 24) >> 8)) & 255;
    stored = stored > 235 ? 0 : Math.min(stored, 230);
    heat[pixel] = stored;
    const gain = stored ? stored + 1 : 0;
    const at = 3 * pixel;
    strip[at] = (bases[at] * gain) >> 8;
    strip[at + 1] = (bases[at + 1] * gain) >> 8;
    strip[at + 2] = (bases[at + 2] * gain) >> 8;
  }
  const position = Math.floor(((CRUMBLE_SPAN - 1) * ((state.sweep >>> 6) & 255)) / 255);
  for (let offset = position; offset < position + CRUMBLE_RUN; offset += 1) {
    const pixel = offset >= CRUMBLE_SPAN ? offset - CRUMBLE_SPAN : offset;
    if (pixel < LENGTH) {
      strip[3 * pixel] = bases[3 * pixel];
      strip[3 * pixel + 1] = bases[3 * pixel + 1];
      strip[3 * pixel + 2] = bases[3 * pixel + 2];
      heat[pixel] = 230;
    }
  }
  state.sweep = (state.sweep + state.step) >>> 0;
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 61: Particle glows ───────────────────────────────────────────
const DRIFT_WIDTH = (LENGTH >> 2) - 2;

function driftInit(settings) {
  const colours = effectColours(settings);
  return {
    direction: settings.direction,
    reads: 0,
    words: [colours.primary, colours.secondary],
    speed: f32(Math.floor((settings.rate * 205) / 255) + 50),
    particles: null,
    mixed: new Int32Array(3 * LENGTH),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

/** A particle's spawn: the colour's read, then its five, in this order. */
function driftSpawn(state, particle) {
  particle.colour = state.words[(read(state) >>> 7) & 1];
  particle.life = (((read(state) & 0xffff) * 1000) >>> 16) + 500;
  particle.scale = f32(f32((((read(state) & 0xffff) * 41) >>> 16) + 60) / 100);
  particle.age = 0;
  particle.position = f32(f32(LENGTH) * f32(f32(((read(state) & 0xffff) * 101) >>> 16) / 100));
  particle.back = !((read(state) >>> 15) & 1);
  particle.speed = f32(f32(f32(f32(((read(state) >>> 12) & 15) + 15) / 100) * 4) / 255);
  return particle;
}

function driftStep(state, settings) {
  const { intensity } = settings;
  if (!state.particles)
    state.particles = Array.from({ length: Math.trunc((intensity * 8) / 255 + 2) }, () =>
      driftSpawn(state, {}),
    );
  const { particles, mixed, strip } = state;
  const width = DRIFT_WIDTH;
  for (const particle of particles) {
    const move = f32(state.speed * particle.speed);
    const position = f32(particle.position + (particle.back ? -move : move));
    particle.position = position;
    particle.age = (particle.age + 1) & 0xffff;
    if (particle.age > particle.life) driftSpawn(state, particle);
    else if (particle.back) {
      if (!(f32(position + width) >= 0)) particle.back = false;
    } else if (!(f32(position - width) <= LENGTH)) particle.back = true;
  }
  // By particle, not by pixel: the adds are >= 0, so the cap can wait.
  mixed.fill(0);
  for (const { position, life, age, scale, colour } of particles) {
    const first = Math.max(0, Math.ceil(f32(position - width)));
    const last = Math.min(LENGTH - 1, Math.floor(f32(position + width)));
    if (first > last || !age) continue;
    const envelope = f32((f32(age / life) >= 0.5 ? life - age : age) / (life * 0.5));
    const [red, green, blue] = colour;
    for (let cell = first; cell <= last; cell += 1) {
      const share = f32(
        scale * f32(f32(1 - f32(Math.abs(f32(cell - position)) / width)) * envelope),
      );
      mixed[3 * cell] += Math.trunc(f32(red * share));
      mixed[3 * cell + 1] += Math.trunc(f32(green * share));
      mixed[3 * cell + 2] += Math.trunc(f32(blue * share));
    }
  }
  for (let at = 0; at < 3 * LENGTH; at += 1) strip[at] = Math.min(255, mixed[at]);
  stripBlur(strip, intensity);
  return placeStrip(strip, state.direction, state.panel);
}

// ── Slot 63: Centre bursts ────────────────────────────────────────────
// lamp_effects_sparks.py tells how it runs.
function burstInit(settings) {
  return {
    reads: 0,
    period: Math.trunc((settings.rate * -3.0) / 255.0 + 4.0),
    colour: effectColours(settings).primary,
    work: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function burstStep(state, settings, clockMs, render) {
  const step = (render + 1) & 0xffff;
  const { period, work, colour, panel } = state;
  if (step % period) return panel;
  const [red, green, blue] = colour;
  work.copyWithin(0, 3, 111);
  work.copyWithin(114, 111, 168);
  work.fill(0, 108, 114);
  if (step % (10 * period) === 0) {
    const left = ((read(state) & 255) * 7) >> 8;
    const right = ((read(state) & 255) * 3) >> 8;
    for (let at = 3 * (37 - left); at < 111 + 3 * right; at += 3) {
      work[at] = red;
      work[at + 1] = green;
      work[at + 2] = blue;
    }
  }
  const same = work[0] === red && work[1] === green && work[2] === blue;
  const tail = [0, 1, 2].map((channel) =>
    same ? (work[291 + channel] * 250 + work[channel] * 5) >> 8 : (work[291 + channel] * 235) >> 8,
  );
  for (let at = 171; at < 3 * LENGTH; at += 3) {
    work[at] = tail[0];
    work[at + 1] = tail[1];
    work[at + 2] = tail[2];
  }
  for (let at = 0; at < 3 * LENGTH; at += 1) panel[at] = (work[at] * 255) >> 8; // brightness 255
  return panel;
}

// ── Slot 72: Random scatter ───────────────────────────────────────────
// One colour word per pixel on the first render, then held: the same panel whatever
// the render.
function scatterInit(settings) {
  const { words } = effectColours(settings);
  const strip = new Uint8Array(3 * LENGTH);
  for (let draw = 0; draw < LENGTH; draw += 1) strip.set(words[sourceWord(draw) & 3], 3 * draw);
  return { panel: placeStrip(strip, settings.direction) };
}

const scatterStep = (state) => state.panel;

// ── Slot 79: Violet twinkles ──────────────────────────────────────────
const TWINKLE_COLOURS = [
  [0x5c, 0x07, 0xff],
  [0x83, 0x07, 0xff],
  [0xda, 0x07, 0xff],
  [0xff, 0x83, 0xf0],
];
// By the word's low nibble.
const TWINKLE_ENTRIES = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];

function twinkleInit79(settings) {
  return { ...twinkleInit(settings, 243), seeds: TWINKLE_COLOURS.map(convertColour) };
}

function twinkleStep(state) {
  twinklePass(state);
  const { stars } = state;
  for (let chance = 0; chance < Math.floor(LENGTH / 25) + 1; chance += 1) {
    read(state); // unused
    for (let attempt = 0; ; ) {
      const target = ((read(state) & 0xffff) * LENGTH) >>> 16;
      if (!occupied(stars, target)) {
        seedStar(state, target, state.seeds[TWINKLE_ENTRIES[read(state) & 15]]);
        break;
      }
      attempt += 1;
      if (attempt >= ((read(state) >>> 6) & 3) + 6) break;
    }
  }
  return placeStrip(stars, state.direction, state.panel);
}

// ── Slot 81: Palette ──────────────────────────────────────────────────
// The lamp's 2.8 gamma table.
const GAMMA = Uint8Array.from({ length: 256 }, (_, index) =>
  Math.floor(Math.pow(index / 255, 2.8) * 255 + 0.5),
);

/** Flat, nearest first: distances squared, their f32 roots, where each one's
 * offsets start and the offsets (dy, dx): a radius stays below 7 on the
 * 20-high box. */
const DISC = (() => {
  const cells = new Map();
  for (let dy = -7; dy <= 7; dy += 1)
    for (let dx = -7; dx <= 7; dx += 1) {
      const distance = dy * dy + dx * dx;
      if (!cells.has(distance)) cells.set(distance, []);
      cells.get(distance).push(dy, dx);
    }
  const distances = Int32Array.from([...cells.keys()].sort((a, b) => a - b));
  const roots = Float32Array.from(distances, Math.sqrt);
  const starts = new Int32Array(distances.length + 1);
  const offsets = [];
  distances.forEach((distance, index) => {
    offsets.push(...cells.get(distance));
    starts[index + 1] = offsets.length;
  });
  return { distances, roots, starts, offsets: Int32Array.from(offsets) };
})();

function paletteInit(settings) {
  const [width, height] = effectGeometry(settings);
  const colours = effectColours(settings);
  return {
    direction: settings.direction,
    width,
    height,
    limit: height * 300 + 1000,
    table: colours.table,
    span: paletteSpan(colours.palette.length),
    reads: 0,
    blobs: null,
    mixed: new Int32Array(3 * LENGTH),
    strip: new Uint8Array(3 * LENGTH),
    panel: new Uint8Array(3 * LENGTH),
  };
}

function blobPlace(state, blob) {
  blob.x = ((read(state) & 0xffff) * state.width) >>> 16;
  blob.y = ((read(state) & 0xffff) * state.height) >>> 16;
  blob.hue = read(state) & 255;
  return blob;
}

function blobSpawn(state, speedGain) {
  const blob = blobPlace(state, { radius: f32(0.1), previous: 0 });
  blob.phase = ((read(state) & 0xffff) * 0xffff) >>> 16;
  blob.speed = ((read(state) & 255) * speedGain) >> 8;
  return blob;
}

function paletteStep(state, settings, clockMs) {
  if (!state.blobs)
    state.blobs = Array.from({ length: 10 }, () => blobSpawn(state, settings.rate >> 2));
  const { width, height, limit, table, span, mixed, strip } = state;
  const { distances, roots, starts, offsets } = DISC;
  mixed.fill(0);
  for (const blob of state.blobs) {
    const { phase } = blob;
    // Theta: only the low 32 bits of the lamp's 64-bit product count.
    const turn =
      Math.imul(Math.imul((clockMs - phase) | 0, (blob.speed + 16) << 8), 280) >>> 16;
    const radius = (limit * sin16Unsigned((turn + phase) & 0xffff)) >>> 16;
    const before = blob.radius;
    const older = blob.previous;
    blob.previous = before;
    blob.radius = radius;
    if (!(radius < before) && before <= older) {
      // At a minimum: moved, not drawn.
      blobPlace(state, blob);
      continue;
    }
    const gain = Math.floor((radius * 239) / limit) + 17;
    const index = 3 * ((blob.hue * span) >> 8);
    const red = (table[index] * gain) >> 8;
    const green = (table[index + 1] * gain) >> 8;
    const blue = (table[index + 2] * gain) >> 8;
    const size = f32(radius / 1000);
    const square = f32(size * size);
    const { x, y } = blob;
    for (let ring = 0; ring < distances.length && distances[ring] <= square; ring += 1) {
      const root = roots[ring];
      const alpha = root <= 1 ? 255 : Math.trunc(f32(f32(1 - f32(root / size)) * 255));
      const weight = GAMMA[alpha];
      const addRed = (red * weight) >> 8;
      const addGreen = (green * weight) >> 8;
      const addBlue = (blue * weight) >> 8;
      for (let k = starts[ring]; k < starts[ring + 1]; k += 2) {
        const row = y + offsets[k];
        const column = x + offsets[k + 1];
        if (column >= 0 && row >= 0 && column < width && row < height) {
          const at = 3 * (row * width + column);
          mixed[at] += addRed;
          mixed[at + 1] += addGreen;
          mixed[at + 2] += addBlue;
        }
      }
    }
  }
  for (let at = 0; at < 3 * LENGTH; at += 1) strip[at] = Math.min(255, mixed[at]);
  return placeStrip(strip, state.direction, state.panel);
}

export const SLOTS = [
  { mode: 5, init: starryInit, step: starryStep, warmup: null },
  { mode: 6, init: chaseInit, step: chaseStep, warmup: CHASE_WARMUP },
  { mode: 14, init: trailInit, step: trailStep, warmup: null },
  { mode: 16, init: dropInit, step: dropStep, warmup: null, lit: 1 },
  { mode: 22, init: prismInit, step: prismStep, warmup: null },
  { mode: 23, init: trailInit, step: aquaLimeStep, warmup: null },
  { mode: 24, init: emberInit, step: emberStep, warmup: null },
  { mode: 33, init: wispsInit, step: wispsStep, warmup: null },
  { mode: 60, init: crumbleInit, step: crumbleStep, warmup: null },
  { mode: 61, init: driftInit, step: driftStep, warmup: null },
  { mode: 63, init: burstInit, step: burstStep, warmup: null, lit: 1 },
  { mode: 72, init: scatterInit, step: scatterStep, warmup: 0 },
  { mode: 79, init: twinkleInit79, step: twinkleStep, warmup: null },
  { mode: 81, init: paletteInit, step: paletteStep, warmup: null },
];
