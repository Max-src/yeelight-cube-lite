/**
 * Renderers of the integration's own effects (effect_catalog.py STREAMED_EFFECTS):
 * drawn by the integration and streamed to the lamps, which have none.
 * Mirrors lamp_effects_streamed.py exactly.
 */

import {
  PALETTE_SOURCES,
  RENDER_MS,
  convertColour,
  effectGeometry,
  nativePalette,
  placeStrip,
} from "./lamp-core.js";

// ── Slot 100: Knight Rider ────────────────────────────────────────────
// A light runs along the direction's line, back and forth, leaving a trail
// that fades as it goes out (lamp_effects_streamed.py).
export const KNIGHT_RIDER_MODE = 100;
const SWEEP_SLOWEST_MS = 2600;
const SWEEP_FASTEST_MS = 400;

const PRESET_COLOURS = 4;

/** A preset's colours along its gradient (lamp_effects_streamed.py
 * preset_colours). */
export function presetColours(selector, mode) {
  const colours = nativePalette(selector, mode).filter((colour) => Math.max(...colour) >= 32);
  if (colours.length <= PRESET_COLOURS + 1) return colours;
  const last = colours.length - 1;
  return Array.from({ length: PRESET_COLOURS }, (_, index) =>
    colours[Math.floor((index * last) / (PRESET_COLOURS - 1))],
  );
}

/** How long the trail takes to fade out (lamp_effects_streamed.py). */
export function knightTrailMs(sweep, intensity) {
  return Math.max(
    1,
    Math.floor((sweep * (32 * 65025 + 352 * intensity * intensity)) / (256 * 65025)),
  );
}

/** One sweep's time (ms): 2.6 s at rate 0 to 0.4 s at 255. */
export function knightSweepMs(rate) {
  return SWEEP_SLOWEST_MS - Math.floor((rate * (SWEEP_SLOWEST_MS - SWEEP_FASTEST_MS)) / 255);
}

function knightInit(settings) {
  const [width, height] = effectGeometry(settings);
  const sweep = knightSweepMs(settings.rate);
  let colours;
  if (settings.coloured)
    colours = (settings.colours?.length ? settings.colours : [settings.primary]).map((colour) =>
      convertColour(colour),
    );
  else if (Object.hasOwn(PALETTE_SOURCES, settings.selector))
    colours = presetColours(settings.selector, settings.mode);
  else colours = [convertColour(settings.primary)];
  return {
    direction: settings.direction,
    width,
    height,
    sweep,
    trail: knightTrailMs(sweep, settings.intensity),
    colours,
    strip: new Uint8Array(3 * width * height),
  };
}

function knightStep(state, settings, clockMs, render) {
  const { width, height, sweep, trail, colours, strip } = state;
  const count = colours.length;
  const full = (height - 1) * 256;
  const time = render * RENDER_MS;
  const sweeps = Math.floor(time / sweep);
  const into = time - sweeps * sweep;
  const forward = sweeps % 2 === 0;
  const head = Math.floor((into * full) / sweep);
  const position = forward ? head : full - head;
  strip.fill(0);
  for (let cell = 0; cell < height; cell++) {
    const at = cell * 256;
    const behind = forward ? position - at : at - position;
    let elapsed;
    let colour;
    if (behind >= 0) {
      elapsed = Math.floor((behind * sweep) / full);
      colour = colours[sweeps % count];
    } else {
      elapsed = into + Math.floor(((forward ? at : full - at) * sweep) / full);
      colour = colours[(((sweeps - 1) % count) + count) % count];
    }
    let level = 0;
    if (elapsed < trail) {
      const left = trail - elapsed;
      level = Math.floor((255 * left * left) / (trail * trail));
    }
    if (-behind > 0 && -behind < 256) {
      const front = Math.floor((255 * (256 + behind)) / 256);
      if (front > level) {
        level = front;
        colour = colours[sweeps % count];
      }
    }
    if (level) {
      const red = Math.floor((colour[0] * level) / 255);
      const green = Math.floor((colour[1] * level) / 255);
      const blue = Math.floor((colour[2] * level) / 255);
      for (let column = 0; column < width; column++) {
        const index = 3 * (width * cell + column);
        strip[index] = red;
        strip[index + 1] = green;
        strip[index + 2] = blue;
      }
    }
  }
  return placeStrip(strip, state.direction);
}

// ── Slot 101: Lava Lamp ───────────────────────────────────────────────
// Wax heated in a pool rises in blobs, cools and sinks back: a simulation
// that never repeats, from a seed (lamp_effects_streamed.py).
export const LAVA_LAMP_MODE = 101;
const LAVA_CELL = 64;
const LAVA_FINE = 256;
const LAVA_NEUTRAL = 2048;
const LAVA_HOT = 4095;
const LAVA_TOP_COOL = 8;
const LAVA_SHOW = 150;
const LAVA_RAMP = 180;
const LAVA_REACH = 4096;
const LAVA_LIQUID_TOP = 10;
const LAVA_LIQUID_BOTTOM = 34;
const floorDiv = (value, divisor) => Math.floor(value / divisor);

/** Blobs of wax besides the pool: 2 at intensity 0 to 7 at 255. */
export const lavaBlobCount = (intensity) => 2 + floorDiv(intensity * 5, 255);

/** How fast the lamp runs, in 1/256: 0.5 at rate 0 to 2.25 at 255. */
export const lavaTempo = (rate) => 128 + floorDiv(rate * 448, 255);

/** The run's next random word (mulberry32, from the seed). */
function lavaDraw(state) {
  let value = (state.random = (state.random + 0x6d2b79f5) >>> 0);
  value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
  value = (value ^ (value + (Math.imul(value ^ (value >>> 7), value | 61) >>> 0))) >>> 0;
  return (value ^ (value >>> 14)) >>> 0;
}

const lavaRadius = (state) => floorDiv(state.size * (51 + (lavaDraw(state) % 52)), 64);
const lavaRelease = (state) => 3000 + (lavaDraw(state) % 801);

function lavaInit(settings) {
  const [width, height] = effectGeometry(settings);
  let colours;
  if (settings.coloured)
    colours = (settings.colours?.length ? settings.colours : [settings.primary]).map((colour) =>
      convertColour(colour),
    );
  else if (Object.hasOwn(PALETTE_SOURCES, settings.selector))
    colours = presetColours(settings.selector, settings.mode);
  else colours = [convertColour(settings.primary)];
  const wax = colours.length > 1 ? colours.slice(0, -1) : colours;
  const state = {
    direction: settings.direction,
    width,
    height,
    tempo: lavaTempo(settings.rate),
    wax,
    liquid: colours[colours.length - 1],
    random: (settings.seed || 0) >>> 0,
    size: height >= 10 ? 64 : 40,
    pool: 40,
    poolWave: new Array(width).fill(0),
    poolTarget: new Array(width).fill(0),
    strip: new Uint8Array(3 * width * height),
    blobs: [],
  };
  const top = height * LAVA_CELL;
  const across = width * LAVA_CELL;
  const count = lavaBlobCount(settings.intensity) + (width >= 10 ? 2 : 0);
  for (let index = 0; index < count; index++) {
    const radius = lavaRadius(state);
    const x = (floorDiv(across, 8) + (lavaDraw(state) % (floorDiv(across * 3, 4) + 1))) * LAVA_FINE;
    const y = (lavaDraw(state) % top) * LAVA_FINE;
    const t = 600 + (lavaDraw(state) % 2800);
    const heat = 8 + (lavaDraw(state) % 9);
    const cool = 1 + (lavaDraw(state) % 2);
    const release = lavaRelease(state);
    state.blobs.push({
      x, y, vx: 0, vy: 0, t, r: radius, target: radius, heat, cool, release, drift: x,
      colour: wax[index % wax.length],
    });
  }
  return state;
}

function lavaMove(state) {
  const { tempo } = state;
  const top = state.height * LAVA_CELL * LAVA_FINE;
  const across = state.width * LAVA_CELL * LAVA_FINE;
  const floor = state.pool * LAVA_FINE;
  const coolZone = top - 2 * LAVA_CELL * LAVA_FINE;
  const targets = (state.poolTarget = state.poolTarget.map(
    (target) => target + (lavaDraw(state) % 7) - 3 - floorDiv(target, 16),
  ));
  const waves = state.poolWave;
  const last = waves.length - 1;
  state.poolWave = waves.map(
    (wave, cell) =>
      wave + floorDiv(targets[cell] - wave, 4) +
      floorDiv(waves[Math.max(0, cell - 1)] + waves[Math.min(last, cell + 1)] - 2 * wave, 8),
  );
  for (const blob of state.blobs) {
    let y = blob.y;
    const word = lavaDraw(state);
    if (y <= floor) {
      blob.t = Math.min(LAVA_HOT, blob.t + floorDiv(blob.heat * tempo, 256));
      if (blob.t < blob.release) blob.vy = 0;
      blob.vx += floorDiv(blob.drift - blob.x, 24 * LAVA_FINE);
    } else {
      const cool = blob.cool + (y > coolZone ? LAVA_TOP_COOL : 0);
      blob.t = Math.max(0, blob.t - floorDiv(cool * tempo, 256));
    }
    let vy = blob.vy;
    if (y > floor || blob.t >= blob.release) {
      vy += floorDiv(blob.t - LAVA_NEUTRAL, 32) + (word & 31) - 15;
      vy -= floorDiv(vy, 32);
    }
    let vx = blob.vx + ((word >>> 8) & 63) - 31;
    vx -= floorDiv(vx, 8);
    vx += floorDiv(floorDiv(across, 2) - blob.x, 4 * LAVA_FINE * state.width);
    y += floorDiv(vy * tempo, 256);
    let x = blob.x + floorDiv(vx * tempo, 256);
    if (y < floor) {
      if (blob.y > floor) {
        blob.release = lavaRelease(state);
        blob.drift =
          floorDiv(across, 8) +
          (lavaDraw(state) % (floorDiv(floorDiv(across * 3, 4), LAVA_FINE) + 1)) * LAVA_FINE;
      }
      y = floor;
      vy = 0;
    }
    const held = top - floorDiv(blob.r * LAVA_FINE, 2);
    if (y > held) {
      y = held;
      vy = Math.min(vy, 0);
    }
    const edge = floorDiv(blob.r * LAVA_FINE, 2);
    if (x < edge) {
      x = edge;
      vx = Math.abs(vx);
    } else if (x > across - edge) {
      x = across - edge;
      vx = -Math.abs(vx);
    }
    blob.x = x;
    blob.y = y;
    blob.vx = vx;
    blob.vy = vy;
    if (((word >>> 16) & 127) === 0) blob.target = lavaRadius(state);
    if (blob.r < blob.target) blob.r += 1;
    else if (blob.r > blob.target) blob.r -= 1;
  }
}

function lavaStep(state, settings, clockMs, render) {
  lavaMove(state);
  const { width, height, liquid, strip } = state;
  const top = height * LAVA_CELL;
  const first = state.wax[0];
  const shapes = state.blobs.map((blob) => {
    const stretch = floorDiv(Math.min(Math.abs(blob.vy), 1600) * blob.r, 6400);
    const along = blob.r + stretch;
    const side = Math.max(16, blob.r - floorDiv(stretch, 2));
    return [floorDiv(blob.x, LAVA_FINE), floorDiv(blob.y, LAVA_FINE), side * side, along * along, blob.colour];
  });
  for (let row = 0; row < height; row++) {
    const centreY = row * LAVA_CELL + LAVA_CELL / 2;
    const glow =
      LAVA_LIQUID_TOP + floorDiv((LAVA_LIQUID_BOTTOM - LAVA_LIQUID_TOP) * (top - centreY), top);
    for (let column = 0; column < width; column++) {
      const centreX = column * LAVA_CELL + LAVA_CELL / 2;
      const above = centreY - state.pool - state.poolWave[column];
      const pool =
        above <= 0
          ? Math.min(4096, 256 - above * 64)
          : floorDiv(65536, 256 + floorDiv(above * above * 256, 576));
      let field = pool;
      let weight = pool;
      let red = first[0] * pool;
      let green = first[1] * pool;
      let blue = first[2] * pool;
      for (const [x, y, side2, along2, colour] of shapes) {
        const dx = centreX - x;
        const dy = centreY - y;
        const q = floorDiv(dx * dx * 256, side2) + floorDiv(dy * dy * 256, along2);
        if (q >= LAVA_REACH) continue;
        const part = floorDiv(65536, Math.max(16, q));
        field += part;
        weight += part;
        red += colour[0] * part;
        green += colour[1] * part;
        blue += colour[2] * part;
      }
      weight = Math.max(1, weight);
      const level = Math.min(255, Math.max(0, floorDiv((field - LAVA_SHOW) * 255, LAVA_RAMP)));
      const dark = (255 - level) * glow;
      const index = 3 * (row * width + column);
      strip[index] = floorDiv(floorDiv(red, weight) * level + floorDiv(liquid[0] * dark, 255), 255);
      strip[index + 1] = floorDiv(floorDiv(green, weight) * level + floorDiv(liquid[1] * dark, 255), 255);
      strip[index + 2] = floorDiv(floorDiv(blue, weight) * level + floorDiv(liquid[2] * dark, 255), 255);
    }
  }
  return placeStrip(strip, state.direction);
}

// ── Slot 102: Falling Blocks ──────────────────────────────────────────
// A falling-block puzzle played by itself (lamp_effects_streamed.py).
export const BLOCKS_MODE = 102;
const BLOCK_SHAPES = [
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [0, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
];
const BLOCK_COLOURS = [
  [0, 200, 220], [255, 200, 0], [170, 60, 255], [60, 220, 60],
  [255, 40, 60], [40, 90, 255], [255, 120, 0],
];
const BLOCK_SHADES = [255, 205, 160, 230, 185, 140, 215];
const BLOCK_CLEAR_RENDERS = 8;
const BLOCK_OVER_RENDERS = 40;
const BLOCK_OVER_HOLD = 12;
const BLOCK_MOVE_SHARE = 4;
const BLOCK_LINES = 760;
const BLOCK_HEIGHT = 200;
const BLOCK_HOLES = 1200;
const BLOCK_BUMPS = 300;

function blockRotations(cells) {
  const out = [];
  const keys = [];
  let current = cells.map(([x, y]) => [x, y]);
  for (let turn = 0; turn < 4; turn++) {
    const lowX = Math.min(...current.map(([x]) => x));
    const lowY = Math.min(...current.map(([, y]) => y));
    const placed = current
      .map(([x, y]) => [x - lowX, y - lowY])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const key = JSON.stringify(placed);
    if (!keys.includes(key)) {
      keys.push(key);
      out.push(placed);
    }
    current = current.map(([x, y]) => [y, -x]);
  }
  return out;
}

const BLOCK_ROTATIONS = BLOCK_SHAPES.map(blockRotations);
const spanOf = (cells) => Math.max(...cells.map(([x]) => x)) + 1;
const riseOf = (cells) => Math.max(...cells.map(([, y]) => y)) + 1;
const shadeOf = (colour, level) => colour.map((value) => floorDiv(value * level, 255));

/** Renders for a piece to fall one cell: 680 ms at rate 0 to 80 ms at 255. */
export const blocksFallRenders = (rate) =>
  Math.max(2, floorDiv(700 - floorDiv(rate * 600, 255), RENDER_MS));

function blocksInit(settings) {
  const [width, height] = effectGeometry(settings);
  let chosen;
  if (settings.coloured) {
    chosen = (settings.colours?.length ? settings.colours : [settings.primary]).map((colour) =>
      convertColour(colour),
    );
    if (chosen.length === 1) {
      const only = chosen[0];
      chosen = BLOCK_SHADES.map((level) => shadeOf(only, level));
    }
  } else if (settings.selector === 0) chosen = BLOCK_COLOURS.map((colour) => convertColour(colour));
  else if (Object.hasOwn(PALETTE_SOURCES, settings.selector))
    chosen = presetColours(settings.selector, settings.mode);
  else {
    const base = convertColour(settings.primary);
    chosen = BLOCK_SHADES.map((level) => shadeOf(base, level));
  }
  const white = convertColour([255, 255, 255]);
  const fall = blocksFallRenders(settings.rate);
  return {
    direction: settings.direction,
    width,
    height,
    colours: chosen,
    white,
    fall,
    wipe: Math.max(2, floorDiv(BLOCK_OVER_RENDERS, height)),
    move: Math.max(1, floorDiv(fall, Math.max(3, floorDiv(width, 2)))),
    skill: settings.intensity,
    random: (settings.seed || 0) >>> 0,
    grid: Array.from({ length: height }, () => new Array(width).fill(-1)),
    bag: [],
    piece: null,
    phase: "play",
    timer: 0,
    tick: 0,
    lastFall: 0,
    clearing: [],
    strip: new Uint8Array(3 * width * height),
  };
}

function blocksFits(state, cells, x, y) {
  const { width, height, grid } = state;
  for (const [cellX, cellY] of cells) {
    const column = x + cellX;
    const row = y + cellY;
    if (column < 0 || column >= width || row < 0) return false;
    if (row < height && grid[row][column] >= 0) return false;
  }
  return true;
}

function blocksNextShape(state) {
  if (!state.bag.length) {
    const bag = BLOCK_SHAPES.map((_, index) => index);
    for (let index = bag.length - 1; index > 0; index--) {
      const other = lavaDraw(state) % (index + 1);
      [bag[index], bag[other]] = [bag[other], bag[index]];
    }
    state.bag = bag;
  }
  return state.bag.pop();
}

function blocksScore(state, cells, x, y) {
  const { width, height } = state;
  const rows = state.grid.map((row) => row.map((cell) => cell >= 0));
  for (const [cellX, cellY] of cells) if (y + cellY < height) rows[y + cellY][x + cellX] = true;
  const kept = rows.filter((row) => !row.every(Boolean));
  const lines = height - kept.length;
  const heights = [];
  let holes = 0;
  for (let column = 0; column < width; column++) {
    let top = 0;
    for (let row = 0; row < kept.length; row++) if (kept[row][column]) top = row + 1;
    heights.push(top);
    for (let row = 0; row < top; row++) if (!kept[row][column]) holes += 1;
  }
  let bumps = 0;
  for (let column = 0; column < width - 1; column++)
    bumps += Math.abs(heights[column] - heights[column + 1]);
  const total = heights.reduce((sum, value) => sum + value, 0);
  return BLOCK_LINES * lines - BLOCK_HEIGHT * total - BLOCK_HOLES * holes - BLOCK_BUMPS * bumps;
}

/** Where the player puts a piece (lamp_effects_streamed.py blocks_plan). */
export function blocksPlan(state, shape, spawnY) {
  const mistakes = 255 - state.skill;
  const options = [];
  BLOCK_ROTATIONS[shape].forEach((cells, rotation) => {
    for (let x = 0; x <= state.width - spanOf(cells); x++) {
      if (!blocksFits(state, cells, x, spawnY)) continue;
      let y = spawnY;
      while (blocksFits(state, cells, x, y - 1)) y -= 1;
      const score = blocksScore(state, cells, x, y) + (lavaDraw(state) % (mistakes * 20 + 1));
      options.push([score, rotation, x]);
    }
  });
  if (!options.length) return [0, null];
  if (lavaDraw(state) % 1024 < mistakes) {
    const picked = options[lavaDraw(state) % options.length];
    return [picked[1], picked[2]];
  }
  let best = options[0];
  for (const option of options.slice(1)) if (option[0] > best[0]) best = option;
  return [best[1], best[2]];
}

function blocksSpawn(state) {
  const shape = blocksNextShape(state);
  const cells = BLOCK_ROTATIONS[shape][0];
  const width = spanOf(cells);
  const y = state.height - riseOf(cells);
  const [rotation, target] = blocksPlan(state, shape, y);
  let middle = floorDiv(state.width - width, 2);
  if (state.width > state.height && target !== null) middle = Math.min(target, state.width - width);
  let start = null;
  for (let offset = 0; offset < state.width; offset++)
    for (const x of [middle - offset, middle + offset])
      if (start === null && x >= 0 && x <= state.width - width && blocksFits(state, cells, x, y))
        start = [0, x];
  if (start === null && target !== null) start = [rotation, target];
  if (start === null) {
    state.phase = "over";
    state.timer = 0;
    state.piece = null;
    return;
  }
  const goalX = target === null ? start[1] : target;
  const every = blocksMoveEvery(state, BLOCK_ROTATIONS[shape], start, rotation, goalX, y);
  state.piece = {
    shape,
    rotation: start[0],
    x: start[1],
    y,
    goalRotation: rotation,
    goalX,
    every,
    nextMove: state.tick + every,
  };
  state.lastFall = state.tick;
}

/** Renders between a piece's turns and moves (lamp_effects_streamed.py). */
function blocksMoveEvery(state, rotations, start, rotation, goalX, y) {
  const turns = (((rotation - start[0]) % rotations.length) + rotations.length) % rotations.length;
  const moves = turns + Math.abs(goalX - start[1]);
  const cells = rotations[rotation];
  let landing = y;
  while (blocksFits(state, cells, goalX, landing - 1)) landing -= 1;
  const budget = floorDiv((y - landing) * state.fall * BLOCK_MOVE_SHARE, 5);
  if (!moves || budget <= 0) return state.move;
  return Math.max(state.move, floorDiv(budget, moves + 1));
}

function blocksLock(state) {
  const { piece, grid } = state;
  const colour = piece.shape % state.colours.length;
  for (const [cellX, cellY] of BLOCK_ROTATIONS[piece.shape][piece.rotation]) {
    const row = piece.y + cellY;
    if (row < state.height) grid[row][piece.x + cellX] = colour;
  }
  state.piece = null;
  const full = [];
  for (let row = 0; row < state.height; row++)
    if (grid[row].every((cell) => cell >= 0)) full.push(row);
  if (full.length) {
    state.phase = "clear";
    state.timer = 0;
    state.clearing = full;
  }
}

function blocksPlay(state) {
  const { piece } = state;
  if (piece === null) {
    blocksSpawn(state);
    return;
  }
  const rotations = BLOCK_ROTATIONS[piece.shape];
  const placed = piece.rotation === piece.goalRotation && piece.x === piece.goalX;
  if (!placed && state.tick >= piece.nextMove) {
    piece.nextMove = state.tick + piece.every;
    if (piece.rotation !== piece.goalRotation) {
      const rotation = (piece.rotation + 1) % rotations.length;
      const x = Math.min(piece.x, state.width - spanOf(rotations[rotation]));
      if (blocksFits(state, rotations[rotation], x, piece.y)) {
        piece.rotation = rotation;
        piece.x = x;
      } else piece.goalRotation = piece.rotation;
    } else {
      const step = piece.goalX > piece.x ? 1 : -1;
      if (blocksFits(state, rotations[piece.rotation], piece.x + step, piece.y)) piece.x += step;
      else piece.goalX = piece.x;
    }
  }
  // The same pace all the way down, in place or not.
  if (state.tick - state.lastFall >= state.fall) {
    state.lastFall = state.tick;
    if (blocksFits(state, rotations[piece.rotation], piece.x, piece.y - 1)) piece.y -= 1;
    else blocksLock(state);
  }
}

function blocksMove(state) {
  state.tick += 1;
  if (state.phase === "play") blocksPlay(state);
  else if (state.phase === "clear") {
    state.timer += 1;
    if (state.timer >= BLOCK_CLEAR_RENDERS) {
      const gone = new Set(state.clearing);
      const kept = state.grid.filter((_, index) => !gone.has(index));
      for (let index = 0; index < gone.size; index++) kept.push(new Array(state.width).fill(-1));
      state.grid = kept;
      state.phase = "play";
      state.clearing = [];
    }
  } else {
    state.timer += 1;
    if (state.timer >= state.height * state.wipe + BLOCK_OVER_HOLD) {
      state.grid = Array.from({ length: state.height }, () => new Array(state.width).fill(-1));
      state.phase = "play";
      state.timer = 0;
    }
  }
}

function blocksStep(state, settings, clockMs, render) {
  blocksMove(state);
  const { width, height, colours, strip, grid, phase, clearing } = state;
  const flash = phase === "clear" && floorDiv(state.timer, 2) % 2 === 0;
  const wiped = phase === "over" ? height - floorDiv(state.timer, state.wipe) : height;
  const black = [0, 0, 0];
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const cell = grid[row][column];
      let colour;
      if (row >= wiped) colour = black;
      else if (flash && clearing.includes(row)) colour = state.white;
      else if (cell >= 0) colour = colours[cell];
      else colour = black;
      strip.set(colour, 3 * (row * width + column));
    }
  }
  const { piece } = state;
  if (piece !== null && phase === "play") {
    const colour = colours[piece.shape % colours.length];
    for (const [cellX, cellY] of BLOCK_ROTATIONS[piece.shape][piece.rotation]) {
      const row = piece.y + cellY;
      if (row < height) strip.set(colour, 3 * (row * width + piece.x + cellX));
    }
  }
  return placeStrip(strip, state.direction);
}

export const SLOTS = [
  { mode: KNIGHT_RIDER_MODE, init: knightInit, step: knightStep, warmup: 0 },
  // A simulation: each frame depends on every render before it.
  { mode: LAVA_LAMP_MODE, init: lavaInit, step: lavaStep, warmup: null, live: true },
  // A game played out render by render: live too.
  { mode: BLOCKS_MODE, init: blocksInit, step: blocksStep, warmup: null, live: true },
];
