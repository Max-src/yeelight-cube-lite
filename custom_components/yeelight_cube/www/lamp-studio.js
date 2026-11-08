/**
 * The Studio color mode (mirrors lamp_studio.py exactly; tests/test_lamp_studio.py).
 *
 * Home Assistant draws the effect in the lamp's whole palette and streams it
 * to the lamp frame by frame: the effects the lamp renderers draw, recolored;
 * the animations are recolored into the GIF the lamp plays itself
 * (lamp-animation-frames.js); the microphone's effects are left to the lamp,
 * as Palette runs them (lamp-renderers.js lampColorMode). A recolored pixel
 * keeps the effect's brightness and takes a palette color by the effect's
 * look (STUDIO_LOOKS): "wheel" (its hue wheel round the palette), "hue" (its
 * range of hues spread over the palette), "level"
 * (its brightness, the brightest the first color), "object" (each dot or
 * shape keeps one color while lit: the tracks below), "first".
 *
 * A Studio frame holds the colors sent (like a drawing); previews of a
 * lamp-drawn effect show it through the lamp's converter (studioDrive), LED
 * drive like every effect; an animation's preview shows its recolored GIF.
 */

import { COLS, LENGTH, RENDER_SECONDS, ROWS, convertColour, paletteSpan, paletteTable } from "./lamp-core.js";
import {
  FIREWORKS_MODE,
  LAMP_MUSIC_EFFECTS,
  PALETTE_COLOR_MODE,
  effectSupportsColorMode,
  isLampRendered,
  lampClockSettings,
  lampEffectFrame,
  lampFrame,
  lampSettings,
  paletteFits,
} from "./lamp-renderers.js";
import { LAMP_ANIMATIONS } from "./lamp-animations.js";

export const STUDIO_FPS = 25;
export const STUDIO_PALETTE_LIMIT = 32;
export const MIN_HUE_SPAN = 64;
const GREY_RATIO = 4;
const HUE_FLOOR = 16;

// lamp_studio.py STUDIO_LOOKS (tools/generate_studio_looks.py).
export const STUDIO_LOOKS = Object.freeze({
  "Two-colour alternation": ["hue", 171, 2, 24, 62, 81, 90],
  "Breathing": ["level", 44, 78, 124, 164, 192],
  "Ribbon": ["wheel", 20],
  "Moving palette": ["wheel", 20],
  "Starry Sky": ["object", 16],
  "Particle path": ["hue", 37, 15, 48, 63, 120, 134],
  "Dual scan": ["wheel", 4],
  "Rotating colour bands": ["hue", 170, 0, 92, 100, 114, 158],
  "Triangular palette pulses": ["hue", 134, 47, 153, 161, 169, 201],
  "Fireworks": ["wheel", 46],
  "Sine wave": ["level", 87, 105, 119, 133, 148],
  "Palette trails": ["hue", 0, 0, 8, 26, 51, 66],
  "Aurora": ["level", 2, 6, 17, 25, 45],
  "Drop and bounce": ["hue", 0, 0, 9, 24, 51, 71],
  "Spectrum": ["wheel", 0],
  "Sunrise and sunset": ["level", 70, 154, 218, 247, 253],
  "Heat fire": ["level", 15, 15, 15, 21, 120],
  "Stacking blocks": ["object", 16],
  "Mirrored comets": ["wheel", 51],
  "Aqua-lime trails": ["hue", 65, 0, 8, 16, 24, 64],
  "Palette sparks": ["level", 45, 75, 89, 103, 127],
  "Scrolling bands": ["hue", 158, 12, 104, 120, 128, 170],
  "Palette cross-fade": ["hue", 0, 0, 69, 86, 132, 172],
  "Waterfall": ["level", 19, 41, 53, 67, 86],
  "Rising wisps": ["level", 5, 17, 28, 39, 58],
  "Fire": ["level", 8, 36, 59, 74, 94],
  "Tide (slot 35)": ["wheel", 56],
  "Bouncing Ball": ["hue", 128, 5, 34, 58, 118, 128],
  "Sine plotter": ["object", 16],
  "Rainbow": ["wheel", 0],
  "Waves": ["level", 100, 146, 184, 197, 214],
  "Hacking": ["object", 128],
  "Meteor": ["wheel", 225],
  "Tide": ["hue", 160, 0, 38, 96, 152, 191],
  "Building Blocks": ["object", 16],
  "Solid red": ["first"],
  "Rainbow noise": ["hue", 70, 7, 36, 66, 86, 117],
  "Flower Sea": ["level", 183, 194, 208, 221, 233],
  "Violet interference": ["level", 100, 133, 156, 162, 176],
  "Night-amber waves": ["hue", 171, 0, 8, 29, 108, 116],
  "Navy-white noise": ["level", 186, 199, 208, 215, 229],
  "Night-sky waves": ["hue", 162, 8, 16, 24, 119, 143],
  "Flicker sweep": ["wheel", 0],
  "Particle glows": ["level", 1, 33, 74, 119, 214],
  "Dot with fading trail": ["object", 16],
  "Centre bursts": ["object", 32],
  "Rainbow fill-in (one-shot)": ["wheel", 40],
  "Rainbow wipe-out (one-shot)": ["wheel", 0],
  "White fill-in (one-shot)": ["first"],
  "White wipe-out (one-shot)": ["first"],
  "Palette stripes": ["wheel", 0],
  "Snowfall": ["object", 16],
  "Daydream": ["wheel", 118],
  "Halloween glow": ["hue", 209, 12, 41, 54, 62, 70],
  "Moonlit clouds": ["level", 118, 146, 172, 197, 224],
  "Random scatter": ["hue", 176, 0, 83, 106, 114, 148],
  "Neon sine bands": ["hue", 63, 6, 108, 121, 179, 196],
  "Magic": ["wheel", 126],
  "Wonderland": ["hue", 171, 7, 19, 36, 51, 66],
  "Violet twinkles": ["level", 40, 52, 59, 65, 78],
  "Kaleidoscope": ["wheel", 0],
  "Palette": ["wheel", 128],
});

/** Whether Studio streams `effect`: a lamp-drawn effect that does not listen
 * to the microphone (an animation is recolored into its GIF instead). */
export const effectSupportsStudio = (effect) =>
  isLampRendered(effect) && !LAMP_MUSIC_EFFECTS.has(effect);

/** The palette's [r, g, b] entries Studio uses (at most STUDIO_PALETTE_LIMIT). */
export function studioPalette(palette) {
  if (!Array.isArray(palette)) return [];
  return palette
    .filter((colour) => Array.isArray(colour) && colour.length >= 3)
    .slice(0, STUDIO_PALETTE_LIMIT)
    .map((colour) => colour.slice(0, 3).map((channel) => Number(channel) & 255));
}

/** Whether `effect` in `colorMode` is streamed by Studio. */
export const studioRuns = (effect, colorMode, palette) =>
  colorMode === PALETTE_COLOR_MODE &&
  effectSupportsStudio(effect) &&
  studioPalette(palette).length > 0 &&
  !paletteFits(effect, palette);

/** Whether a clock over `effect` (null: a plain style) is streamed
 * (lamp_studio.py clock_studio_runs). */
export const clockStudioRuns = (effect, colorMode, palette) =>
  !!effect && studioRuns(effect, colorMode, palette);

// The animations by effect name (lamp-animations.js): recolored into their GIF.
const ANIMATION_NAMES = new Set(Object.values(LAMP_ANIMATIONS).map((entry) => entry.name));

/** Whether the cards offer `effect` in `mode` (lamp_studio.py
 * effect_offers_color_mode): what the lamp takes, and in the palette color
 * mode also what is streamed or recolored here. */
export const effectOffersColorMode = (effect, mode) =>
  (mode === PALETTE_COLOR_MODE && (effectSupportsStudio(effect) || ANIMATION_NAMES.has(effect))) ||
  effectSupportsColorMode(effect, mode);

/** A pixel's hue on a 0-255 wheel; null when too dim or too grey. */
export function hueByte(pixel) {
  const [red, green, blue] = pixel;
  const high = Math.max(red, green, blue);
  const spread = high - Math.min(red, green, blue);
  if (high < HUE_FLOOR || spread * GREY_RATIO < high) return null;
  let hue;
  if (high === red) hue = Math.floor((43 * (green - blue)) / spread);
  else if (high === green) hue = 85 + Math.floor((43 * (blue - red)) / spread);
  else hue = 171 + Math.floor((43 * (red - green)) / spread);
  return hue & 255;
}

/** The render shown `seconds` in (lamp_studio.py studio_render). */
export const studioRender = (seconds) => Math.floor(seconds / RENDER_SECONDS + 1e-6);

// ── What is recolored ────────────────────────────────────────────────
// An effect's own frames by render: a preview from its first shown, the
// lamp (`fromStart`) from its very first (lamp_studio.py _Source).
function source(effect, direction, speed, orientation, intensity, fromStart = false) {
  const settings = lampSettings(effect, direction, speed, null, null, orientation, intensity, null);
  return {
    key: `effect|${effect}|${direction}|${speed}|${orientation}|${intensity}|${fromStart}`,
    frame:
      fromStart && settings.mode !== FIREWORKS_MODE
        ? (render) => lampFrame(settings, render)
        : (render) => lampEffectFrame(settings, (render + 0.5) * RENDER_SECONDS),
  };
}

// ── Objects (lamp_studio.py track_step) ─────────────────────────────
const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1],
  [-2, 0], [2, 0], [0, -2], [0, 2]];
const SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function around(index, offsets) {
  const row = Math.floor(index / COLS);
  const col = index % COLS;
  const out = [];
  for (const [dRow, dCol] of offsets) {
    const r = row + dRow;
    const c = col + dCol;
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) out.push(r * COLS + c);
  }
  return out;
}

/** The objects of `frame` after `state` ([labels, levels, count]); a pixel
 * belongs to one while it is at least `floor` bright. */
export function trackStep([labelsBefore, levelsBefore, countBefore], frame, floor) {
  let count = countBefore;
  const levels = frame.map((pixel) => Math.max(pixel[0], pixel[1], pixel[2]));
  const lit = levels.map((level) => level >= floor);
  const labels = new Array(LENGTH).fill(-1);
  for (let index = 0; index < LENGTH; index++)
    if (lit[index] && labelsBefore[index] >= 0) labels[index] = labelsBefore[index];
  const moved = new Array(LENGTH).fill(false);
  for (let index = 0; index < LENGTH; index++) {
    if (!lit[index] || labels[index] >= 0) continue;
    let best = -1;
    let brightest = -1;
    for (const near of around(index, NEIGHBOURS))
      if (
        labelsBefore[near] >= 0 &&
        levels[near] < levelsBefore[near] &&
        levelsBefore[near] > brightest
      ) {
        best = near;
        brightest = levelsBefore[near];
      }
    if (best >= 0) {
      labels[index] = labelsBefore[best];
      moved[index] = true;
    }
  }
  for (let index = 0; index < LENGTH; index++) {
    if (!lit[index] || labels[index] >= 0) continue;
    const group = [];
    const waiting = [index];
    labels[index] = -2;
    while (waiting.length) {
      const pixel = waiting.pop();
      group.push(pixel);
      for (const near of around(pixel, SIDES))
        if (lit[near] && labels[near] === -1) {
          labels[near] = -2;
          waiting.push(near);
        }
    }
    group.sort((a, b) => a - b);
    let joined = -1;
    search: for (const pixel of group)
      for (const near of around(pixel, SIDES))
        if (moved[near]) {
          joined = labels[near];
          break search;
        }
    if (joined < 0) joined = count++;
    for (const pixel of group) labels[pixel] = joined;
  }
  return [labels, levels, count];
}

const EMPTY = [new Array(LENGTH).fill(-1), new Array(LENGTH).fill(0), 0];
const TRACK_STATES = 64;
const TRACKS_LIMIT = 16;
const tracks = new Map();

// ── Fields (lamp_studio.py level_step) ──────────────────────────────
const LEVEL_AROUND = [2, 1];
const LEVEL_SMOOTHING = 3;

/** The followed brightness of `frame` after `state` (null: the first frame's
 * own): the mean brightness around each pixel, moved part of the way. */
export function levelStep(state, frame) {
  const levels = frame.map((pixel) => Math.max(pixel[0], pixel[1], pixel[2]));
  const [across, down] = LEVEL_AROUND;
  const around = [];
  for (let index = 0; index < LENGTH; index++) {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    let total = 0;
    let count = 0;
    for (let r = Math.max(0, row - down); r < Math.min(ROWS, row + down + 1); r++)
      for (let c = Math.max(0, col - across); c < Math.min(COLS, col + across + 1); c++) {
        total += levels[r * COLS + c];
        count++;
      }
    around.push(Math.floor(total / count));
  }
  if (!state) return around;
  return state.map((before, index) => before + ((around[index] - before) >> LEVEL_SMOOTHING));
}

// How a look follows its frames ([step, first state]), null when it does not.
function stepper(look) {
  if (look[0] === "object") return [(state, frame) => trackStep(state, frame, look[1]), EMPTY];
  if (look[0] === "level") return [levelStep, null];
  return null;
}

const followedOf = (look, state) => (look[0] === "object" ? state[0] : state);

// A followed look of one source at `render`, from its first render: the
// latest states worked out are kept (the oldest dropped first), so each
// preview goes on from where it was, on its own clock (StudioTrack).
function stateAt(key, render, frameOf, step, empty) {
  let states = tracks.get(key);
  if (states) tracks.delete(key);
  else states = new Map();
  tracks.set(key, states);
  while (tracks.size > TRACKS_LIMIT) tracks.delete(tracks.keys().next().value);
  const keep = (step, kept) => {
    states.set(step, kept);
    if (states.size > TRACK_STATES) states.delete(states.keys().next().value);
  };
  let state = states.get(render);
  if (states.has(render)) states.delete(render);
  else {
    let start = -1;
    for (const known of states.keys()) if (known < render && known > start) start = known;
    state = start >= 0 ? states.get(start) : empty;
    for (let at = start + 1; at < render; at++) {
      state = step(state, frameOf(at));
      keep(at, state);
    }
    state = step(state, frameOf(render));
  }
  keep(render, state);
  return state;
}

// ── Colors ──────────────────────────────────────────────────────────
const PALETTES_LIMIT = 32;
const palettes = new Map();

function prepared(colours) {
  const key = colours.join(";");
  let out = palettes.get(key);
  if (!out) {
    if (palettes.size >= PALETTES_LIMIT) palettes.clear();
    const count = colours.length;
    const table = paletteTable(colours, []);
    out = {
      key,
      table,
      cycle: count * Math.floor(256 / count),
      last: paletteSpan(count),
      at: (position) => [table[3 * position], table[3 * position + 1], table[3 * position + 2]],
    };
    palettes.set(key, out);
  }
  return out;
}

// lamp_studio.py _along: a value between 0 and last, each quarter of the
// way between two of the effect's quartiles.
function along(value, knots, last) {
  if (value <= knots[0]) return 0;
  if (value >= knots[knots.length - 1]) return last;
  const quarters = knots.length - 1;
  for (let segment = 0; segment < quarters; segment++) {
    const low = knots[segment];
    const high = knots[segment + 1];
    if (value < high)
      return Math.floor((segment * last + Math.floor(((value - low) * last) / (high - low))) / quarters);
  }
  return last;
}

function hueOffset(hue, start, knots) {
  const offset = (hue - start) & 255;
  const end = knots[knots.length - 1];
  return offset > end && offset - end >= 256 - offset + knots[0] ? knots[0] : offset;
}

/** `frame` in the palette's colors by `look` (lamp_studio.py recolour). */
export function recolour(frame, look, palette, followed = null) {
  const colours = studioPalette(palette);
  if (!colours.length) return frame.map(() => [0, 0, 0]);
  const sampled = prepared(colours);
  const [kind] = look;
  return frame.map((pixel, index) => {
    const level = Math.max(pixel[0], pixel[1], pixel[2]);
    if (!level) return [0, 0, 0];
    let colour;
    if (kind === "object") {
      const label = followed ? followed[index] : -1;
      colour = label >= 0 ? colours[(label + 1) % colours.length] : colours[0];
    } else if (kind === "level") {
      const key = followed ? followed[index] : level;
      colour = sampled.at(sampled.last - along(key, look.slice(1), sampled.last));
    } else if (kind === "wheel") {
      const hue = hueByte(pixel);
      colour = sampled.at(hue === null ? 0 : (((hue - look[1]) & 255) * sampled.cycle) >> 8);
    } else if (kind === "hue") {
      const hue = hueByte(pixel);
      const knots = look.slice(2);
      colour = sampled.at(hue === null ? 0 : along(hueOffset(hue, look[1], knots), knots, sampled.last));
    } else colour = colours[0];
    const [red, green, blue] = colour;
    const high = Math.max(red, green, blue);
    if (!high) return [0, 0, 0];
    return [
      Math.floor((red * level) / high),
      Math.floor((green * level) / high),
      Math.floor((blue * level) / high),
    ];
  });
}

/** The effect's look (the first color when unknown). */
export const studioLook = (effect) => STUDIO_LOOKS[effect] ?? ["first"];

/** What Studio sends at `render` of `effect` (lamp_studio.py studio_frame_at). */
export function studioFrameAt(
  effect, render, direction, speed, orientation = null, intensity = null, palette = null, fromStart = false,
) {
  const from = source(effect, direction, speed, orientation, intensity, fromStart);
  const look = studioLook(effect);
  const follow = stepper(look);
  const followed = follow
    ? followedOf(look, stateAt(`${from.key}|${look.join(",")}`, render, from.frame, ...follow))
    : null;
  return recolour(from.frame(render), look, palette, followed);
}

/** studioFrameAt for the render shown `seconds` in (lamp_studio.py studio_frame). */
export const studioFrame = (effect, seconds, direction, speed, orientation = null, intensity = null, palette = null) =>
  studioFrameAt(effect, studioRender(seconds), direction, speed, orientation, intensity, palette);

/** An animation's frames (a loop, top-first) in the palette's colors by
 * `look` (lamp_studio.py studio_animation_frames). */
export function studioAnimationFrames(frames, look, palette) {
  const followed = frames.map(() => null);
  const follow = stepper(look);
  if (follow) {
    const [step] = follow;
    let [, state] = follow;
    for (let round = 0; round < 2; round++)
      frames.forEach((frame, index) => {
        state = step(state, frame);
        followed[index] = followedOf(look, state);
      });
  }
  return frames.map((frame, index) => recolour(frame, look, palette, followed[index]));
}

/** A clock's background `effect` at `render` in the palette's colors
 * (lamp_studio.py studio_clock_background_at). */
export function studioClockBackgroundAt(effect, render, speed, intensity = null, palette = null, direct = null) {
  const settings = lampClockSettings(effect, speed, null, null, intensity, null, direct);
  const frame = (at) => lampEffectFrame(settings, (at + 0.5) * RENDER_SECONDS);
  const look = studioLook(effect);
  const follow = stepper(look);
  const key = `clock|${effect}|${speed}|${intensity}|${direct}|false|${look.join(",")}`;
  const followed = follow ? followedOf(look, stateAt(key, render, frame, ...follow)) : null;
  return recolour(frame(render), look, palette, followed);
}

/** A Studio frame as the lamp shows it: LED drive (lamp_studio.py studio_drive). */
export const studioDrive = (frame) => frame.map((pixel) => convertColour(pixel));

// A preview asks for a frame on every display refresh: the same render and
// palette give the same array (effectDisplayFrame and the tiles keep their
// work per array).
const shown = new Map();
const SHOWN_LIMIT = 256;

/** The preview of a streamed Studio effect, one array per render: LED drive. */
export function studioPreviewFrame(effect, seconds, direction, speed, orientation, intensity, palette) {
  const render = studioRender(seconds);
  const key = `${effect}|${direction}|${speed}|${orientation}|${intensity}|${prepared(studioPalette(palette)).key}|${render}`;
  let frame = shown.get(key);
  if (!frame) {
    if (shown.size >= SHOWN_LIMIT) shown.clear();
    frame = studioDrive(studioFrameAt(effect, render, direction, speed, orientation, intensity, palette));
    shown.set(key, frame);
  }
  return frame;
}
