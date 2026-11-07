/**
 * Native effects as the lamp draws them.
 *
 * These renderers match what the lamp draws, frame for frame (the fixtures
 * check it). Mirrors lamp_renderers.py exactly: every effect's preview,
 * the camera and the estimated power follow the lamp itself.
 *
 * Three layers: lamp-core.js holds what the renderers share, the
 * lamp-effects-<family>.js modules the renderers, and this module the
 * registry, the timeline every preview reads (lampFrame), what a command
 * installs (lampSettings) and Fireworks.
 *
 * - The renderer draws a strip of N = 100 logical pixels; the lamp's pixel
 *   mapper places them on the panel by DIRECTION_TABLE[profile][sent]. The
 *   integration sends directions compensated to profile 2, so a preview always
 *   maps as on profile 2.
 * - The panel's buffer is column-major (5 cells per column, bottom first); the
 *   integration's frames are row-major, row 0 = the bottom (lamp order).
 * - The lamp renders every 40 ms.
 * - The lamp's random numbers come from a hardware source whose values
 *   are not known: a stand-in hash takes its place (sourceWord).
 *
 * Two kinds of frame, not to be mixed up (lamp_renderers.py explains them):
 * these renderers return LED drive, the lamp's own values, for computing
 * anything about the lamp; ledAppearance turns it into screen colors, for
 * display only (effectDisplayFrame). Every effect but one is drawn by the
 * lamp's own renderer, the music slots on the demo beat (lamp-core.js). Only
 * Music Flow, a fixed illustration, slot 71, the GIF stored in the lamp, and
 * the solid clock styles
 * are not: their values are already screen colors and are never converted.
 */

import {
  DIRECTION_TABLE,
  LENGTH,
  REFERENCE_PROFILE,
  RENDER_SECONDS,
  clockAt,
  f32,
  f32Bits,
  f32FromBits,
  framePixels,
  ledAppearance,
  panelToFrame,
  sourceWord,
  stripFrame,
  truncU16,
} from "./lamp-core.js";
import * as coreEffects from "./lamp-effects-core.js";
import * as wavesEffects from "./lamp-effects-waves.js";
import * as noiseEffects from "./lamp-effects-noise.js";
import * as sparksEffects from "./lamp-effects-sparks.js";
import * as trailsEffects from "./lamp-effects-trails.js";
import * as musicEffects from "./lamp-effects-music.js";
import { FORMERLY_NUMBERED_EFFECT_NAMES } from "./effect-names.js";

export {
  LENGTH,
  RENDER_SECONDS,
  clockDigitTargets,
  frameIndex,
  hueColour,
  inoise8Raw,
  ledAppearance,
  panelIndex,
  segmentGeometry,
  sourceWord,
  stripFrame,
} from "./lamp-core.js";
export { magicCells } from "./lamp-effects-core.js";

// The effects drawn by the lamp's own renderers: their frames are LED
// drive, and their previews show every render, 25 a second like the lamp
// (createRafLoop's smoothWhen).
export const isLampRendered = (effect) =>
  Object.hasOwn(LAMP_EFFECTS, effect ?? "");

// A drive color's appearance is costly and a frame's colors repeat: each is
// computed once, and a whole frame once per render (lampEffectFrame
// returns the same array while the render is the same).
const APPEARANCE_LIMIT = 1 << 16;
const appearances = new Map();
const displayFrames = new WeakMap();

function appearance(pixel) {
  const key = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
  let shown = appearances.get(key);
  if (!shown) {
    if (appearances.size >= APPEARANCE_LIMIT) appearances.clear();
    shown = ledAppearance(pixel);
    appearances.set(key, shown);
  }
  return shown;
}

/** An effect's frame as a card shows it (shared, not to be changed). Music Flow
 * and slot 71 stay as they are. */
export function effectDisplayFrame(effect, frame) {
  if (!isLampRendered(effect)) return frame;
  let shown = displayFrames.get(frame);
  if (!shown) {
    shown = frame.map(appearance);
    displayFrames.set(frame, shown);
  }
  return shown;
}

// ── Registry ──────────────────────────────────────────────────────────
// A slot: { mode, init, step, warmup } (lamp_effects_core.py).
export const REGISTRY = new Map();

export function registerSlot(slot) {
  const held = REGISTRY.get(slot.mode);
  if (held && held !== slot) throw new Error(`mode ${slot.mode} is registered twice`);
  REGISTRY.set(slot.mode, slot);
}

/** Every slot of a lamp-effects-<family> module. */
export function registerFamily(module) {
  module.SLOTS.forEach(registerSlot);
}

// ── Timeline (lamp_renderers.py) ──────────────────────────────────
const RING = 256;
const CURSORS = 6;
const CURSOR_REACH = 64;
const REPLAY_LIMIT = 2000;
const REPLAY_MS = 20;
// One timeline per settings: a dashboard's full gallery (70), the clock's styles
// with their backgrounds (65), the favourites' palettes. Beyond it the oldest
// starts over, and with it every tile reading it: at most 160 x 300 KB (frames,
// cursors, renderer states) = 48 MB, only with every tile shown.
const EFFECT_TIMELINE_LIMIT = 160;
// A preview's start (lamp_renderers.py).
const LIT_PIXELS = 25;
const DARK_LIMIT = 2000;

/** The frames of one settings tuple, by render, in lamp order. */
export class Timeline {
  constructor(slot, settings) {
    this.slot = slot;
    this.settings = settings;
    this.frames = new Map();
    this.cursors = [];
    this.uses = 0;
    this.firstShownRender = null;
  }

  /** The render a preview starts from (LIT_PIXELS). */
  firstShown() {
    this.firstShownRender ??= this.findFirstShown();
    return this.firstShownRender;
  }

  findFirstShown() {
    if (this.frameAt(0, true).some(Boolean)) return 0;
    const enough = this.slot.lit ?? LIT_PIXELS;
    let best = 0;
    let most = 0;
    for (let render = 1; render < DARK_LIMIT; render += 1) {
      const frame = this.frameAt(render, true);
      let lit = 0;
      for (let at = 0; at < frame.length; at += 3)
        if (frame[at] || frame[at + 1] || frame[at + 2]) lit += 1;
      if (lit >= enough) return render;
      if (lit > most) {
        best = render;
        most = lit;
      }
    }
    return best;
  }

  /** The 300 bytes of `render`, shared: not to be changed. Replaying stops at
   * REPLAY_MS, with an earlier frame, unless `exact`. */
  frameAt(render, exact = false) {
    render = Math.max(0, Math.trunc(render));
    return this.frames.get(render) ?? this.advance(this.cursorFor(render), render, exact);
  }

  cursorFor(target) {
    const { warmup } = this.slot;
    // A fresh cursor starts a warmup behind: one that can't reach as far would be
    // given up before it arrives, again and again.
    const reach = warmup === null ? REPLAY_LIMIT : Math.max(CURSOR_REACH, warmup + 1);
    let best = null;
    for (const cursor of this.cursors) {
      const behind = target - cursor.render;
      if (
        target >= cursor.settled &&
        behind >= 0 &&
        behind <= reach &&
        (!best || cursor.render > best.render)
      )
        best = cursor;
    }
    if (best) return best;
    const start =
      warmup === null
        ? target > REPLAY_LIMIT ? target - REPLAY_LIMIT : 0
        : Math.max(0, target - warmup);
    if (this.cursors.length >= CURSORS) {
      const oldest = this.cursors.reduce((a, b) => (b.used < a.used ? b : a));
      this.cursors.splice(this.cursors.indexOf(oldest), 1);
    }
    // Before `settled` it is still warming up: those frames are not the run's,
    // and stay out of the ring.
    const cursor = {
      render: start - 1,
      settled: start ? target : 0,
      state: this.slot.init(this.settings),
      frame: null,
      used: 0,
    };
    this.cursors.push(cursor);
    return cursor;
  }

  advance(cursor, target, exact) {
    const { step } = this.slot;
    const { settings, frames } = this;
    const stop = exact ? Infinity : performance.now() + REPLAY_MS;
    if (this.slot.warmup === 0) cursor.render = target - 1; // a pure function of the render
    while (cursor.render < target) {
      const render = cursor.render + 1;
      const panel = step(cursor.state, settings, clockAt(settings.rate, render), render);
      const frame = panelToFrame(panel);
      cursor.render = render;
      cursor.frame = frame;
      if (render >= cursor.settled) {
        frames.set(render, frame);
        if (frames.size > RING) frames.delete(frames.keys().next().value);
      }
      if (performance.now() > stop) break;
    }
    this.uses += 1;
    cursor.used = this.uses;
    return cursor.frame;
  }
}

const effectTimelines = new Map();

export const hasRenderer = (mode) => REGISTRY.has(mode);

/** The run of `settings`, the most recently used last. */
export function timelineFor(settings) {
  const { mode, selector, intensity, rate, direction, primary, coloured, colours, handover } = settings;
  const key = `${mode},${selector},${intensity},${rate},${direction},${primary},${Boolean(coloured)},${colours ?? ""},${Boolean(handover)}`;
  const timeline = effectTimelines.get(key) ?? new Timeline(REGISTRY.get(mode), settings);
  effectTimelines.delete(key);
  effectTimelines.set(key, timeline);
  if (effectTimelines.size > EFFECT_TIMELINE_LIMIT)
    effectTimelines.delete(effectTimelines.keys().next().value);
  return timeline;
}

/** Render `render` of a command, LED drive in lamp order, flat. */
export const lampFrameBytes = (settings, render) =>
  timelineFor(settings).frameAt(render);

/** Render `render` of a command: 100 [r, g, b] of LED drive, lamp order. */
export const lampFrame = (settings, render) =>
  framePixels(lampFrameBytes(settings, render));

/** What a command shows `seconds` into a preview: 100 [r, g, b] of LED drive,
 * lamp order, shared and the same array while the render is the same. A
 * preview starts at Timeline.firstShown. */
export function lampEffectFrame(settings, seconds) {
  if (settings.mode === FIREWORKS_MODE)
    return renderFireworks(seconds, settings.rate, settings.direction);
  const timeline = timelineFor(settings);
  const bytes = timeline.frameAt(timeline.firstShown() + Math.trunc(seconds / RENDER_SECONDS));
  if (timeline.shownBytes !== bytes) {
    timeline.shownBytes = bytes;
    timeline.shown = framePixels(bytes);
  }
  return timeline.shown;
}

/** `count` lamp frames from render `first`, the run as the lamp's: a replay
 * from the slot's warmup (from render 0 when it has none), no timeline, no ring
 * and no time limit. */
export function* exactFrames(settings, first, count) {
  const slot = REGISTRY.get(settings.mode);
  const start = slot.warmup === null ? 0 : Math.max(0, first - slot.warmup);
  const state = slot.init(settings);
  for (let render = start; render < first + count; render += 1) {
    const panel = slot.step(state, settings, clockAt(settings.rate, render), render);
    if (render >= first) yield panelToFrame(panel);
  }
}

// ── Slot 10: Fireworks ─────────────────────────────────────────────────
const C_M800000 = -800000.0;
const C_M0_0004 = -0.0004;
const C_M2 = -2.0;
const C_10000 = 10000.0;
const C_M0_9 = -0.9;
const C_0_99 = 0.99;
const RECORD = 20;
const FIREWORKS_MODE = 10;
// Renders from the burst to the pause: the burst's render, the 85 renders
// that take spark 1's heat 341 -> 1 by 4, then the one that sees it cold.
const FIREWORKS_BURN = 87;

export const fireworksSparks = (length) =>
  Math.min(((length & 0xffff) >>> 1) + 2, 80);

export function fireworksWheel(index) {
  index &= 255;
  if (index >= 171) {
    const step = (index ^ 0xff) * 3;
    return (((0xff - step) << 16) | (step & 0xffff)) >>> 0;
  }
  if (index >= 86) {
    const step = (-86 - index) & 0xff;
    return ((step * 0x300) | (step * -3 + 255)) >>> 0;
  }
  const step = (0x55 - index) & 0xff;
  return ((step * 0x30000) | ((step * -768 + 0xff00) >>> 0)) >>> 0;
}

export function fireworksHeat(word, heat) {
  word >>>= 0;
  heat &= 0xffff;
  const red = (word >>> 16) & 255;
  const green = (word >>> 8) & 255;
  const blue = word & 255;
  let out;
  if (heat >= 301) {
    const scaled = (heat * 5) & 0xffff;
    if (scaled === 1500) out = word;
    else if (scaled === 1755) out = 3;
    else {
      const t = (scaled - 1500) & 0xffff;
      const k = 0xff - t;
      const r6 = (Math.imul(green, k) & 0xffffff00) >>> 0;
      const r1 =
        ((((Math.imul(t, 3) + Math.imul(blue, k)) >>> 0) >>> 8) | r6) >>> 0;
      const r2 = ((Math.imul(red, k) << 8) & 0xffff0000) >>> 0;
      out = (r2 | r1) >>> 0;
    }
    return [(out >>> 16) & 255, (out >>> 8) & 255, out & 255];
  }
  if (heat < 46) return [0, 0, 0];
  if (heat === 300) out = word;
  else {
    const p = (heat - 45) & 0xffff;
    let r3 = (Math.imul(green, p) & 0xffff00) >>> 0;
    r3 = (r3 | ((Math.imul(blue, p) >>> 0) >>> 8)) >>> 0;
    const r1 = ((Math.imul(p, red) << 8) & 0xffff0000) >>> 0;
    out = (r3 | r1) >>> 0;
  }
  const cool = ((300 - heat) >>> 5) & 0xff;
  const cool2 = ((300 - heat) >>> 4) & 0xfe;
  const g = ((out >>> 8) & 255) - cool;
  const b = (out & 255) - cool2;
  return [(out >>> 16) & 255, g > 0 ? g & 255 : 0, b > 0 ? b & 255 : 0];
}

function fireworksGravity(length, rate) {
  const step = Math.floor(((rate & 255) * 900) / 255) + 100;
  return f32(f32(length) * f32(step / C_M800000 + C_M0_0004));
}

export function fireworksState(length = LENGTH) {
  return {
    records: new DataView(new ArrayBuffer(fireworksSparks(length) * RECORD)),
    state: 0,
    launches: 0,
    side: 0,
    dying: 0x7fc00001,
  };
}

/** One render (every pixel cleared to black first); see
 * lamp_renderers.fireworks_step. Returns [index, r, g, b] writes. */
export function fireworksStep(fw, length, rate, intensity, selector, word, read) {
  const n = length & 0xffff;
  const draws = [];
  const rec = fw.records;
  const pos = (k) => rec.getFloat32(RECORD * k, true);
  const vel = (k) => rec.getFloat32(RECORD * k + 4, true);
  const heat = (k) => rec.getUint16(RECORD * k + 8, true);
  const setPos = (k, value) => rec.setFloat32(RECORD * k, value, true);
  const setVel = (k, value) => rec.setFloat32(RECORD * k + 4, value, true);
  const setHeat = (k, value) => rec.setUint16(RECORD * k + 8, value & 0xffff, true);

  const sparks = fireworksSparks(n);
  const grav = fireworksGravity(n, rate);
  const nf = f32(n);
  let state = fw.state & 0xffff;
  if (state < 2) {
    if (state === 0) {
      setPos(0, 0);
      const peakByte = read("peak") & 0xff;
      const product = Math.imul((n - 1) | 0, ((peakByte * 0x87) >>> 8) + 100) >>> 0;
      const peak = (product >>> 8) & 0xffff;
      setVel(0, f32(Math.sqrt(grav * C_M2 * peak)));
      setHeat(0, 255);
      state = 1;
    }
    const speed = vel(0);
    if (!(speed > f32(grav * 12))) {
      fw.state = 2;
      fw.launches = (fw.launches + 1) & 0xffff;
      return draws;
    }
    const level = heat(0) & 255;
    draws.push([truncU16(pos(0)), level, level, level]);
    const moved = f32(speed + pos(0));
    if (moved < 0) setPos(0, 0);
    else {
      const top = f32((n - 1) | 0);
      setPos(0, moved <= top || Number.isNaN(moved) ? moved : top);
    }
    setVel(0, f32(grav + speed));
    setHeat(0, heat(0) - 5);
    fw.state = state;
    return draws;
  }
  if (state > 3) {
    state = (state - 1) & 0xffff;
    if (state < 4) {
      state = 0;
      fw.side = (read("side") & 0xff) < (intensity & 255) ? 1 : 0;
    }
    fw.state = state;
    return draws;
  }
  const flare = pos(0);
  const whole = Number.isFinite(flare) ? Math.trunc(flare) : 0;
  const live = whole >= 0 ? Math.min(whole, sparks) : 0;
  let dying = f32FromBits(fw.dying);
  if (state === 2) {
    if (live >= 2) {
      const kick = f32(grav * -50);
      for (let i = 1; i < live; i += 1) {
        setPos(i, pos(0));
        const v0 = (Math.imul(read("vel") & 0xffff, 20000) >>> 0) >>> 16;
        const sparkSpeed = f32(f32(v0) / C_10000 + C_M0_9);
        setVel(i, sparkSpeed);
        setHeat(i, 345);
        rec.setUint8(RECORD * i + 16, read("colour") & 0xff);
        const ratio = f32(pos(0) / nf);
        setVel(i, f32(kick * f32(sparkSpeed * ratio)));
      }
    }
    dying = f32(grav * 0.5);
    state = 3;
  }
  fw.state = state;
  if (heat(1) < 5) {
    fw.state = (((read("wait") & 0xff) * 10) >>> 8) + 6;
    fw.dying = f32Bits(dying);
    return draws;
  }
  if (live >= 2) {
    for (let i = 1; i < live; i += 1) {
      const moved = f32(vel(i) + pos(i));
      setPos(i, moved);
      setVel(i, f32(vel(i) + dying));
      let sparkHeat = heat(i);
      if (sparkHeat >= 4) {
        sparkHeat -= 4;
        setHeat(i, sparkHeat);
      }
      if (moved <= 0 || Number.isNaN(moved) || moved >= nf) continue;
      const colour =
        (selector & 255) === 0
          ? word >>> 0
          : fireworksWheel(rec.getUint8(RECORD * i + 16));
      draws.push([truncU16(moved), ...fireworksHeat(colour, sparkHeat)]);
    }
  }
  fw.dying = f32Bits(f32(dying * C_0_99));
  return draws;
}

// ── Fireworks over time (lamp_renderers.py _FireworksTimeline) ─────
const SHOT_READS = 4096;
const FIREWORKS_SELECTOR = 14;
const FIREWORKS_INTENSITY = 128;

export function shotSource(shot) {
  let draw = shot * SHOT_READS;
  return () => sourceWord(draw++);
}

export function fireworksShotLength(shot, rate) {
  const n = LENGTH;
  const grav = fireworksGravity(n, rate);
  const peakByte = sourceWord(shot * SHOT_READS) & 0xff;
  const peak =
    ((Math.imul(n - 1, ((peakByte * 0x87) >>> 8) + 100) >>> 0) >>> 8) & 0xffff;
  let speed = f32(Math.sqrt(grav * C_M2 * peak));
  let flare = 0;
  const top = f32(n - 1);
  const climb = f32(grav * 12);
  let rise = 1;
  while (speed > climb) {
    const moved = f32(speed + flare);
    flare = moved < 0 ? 0 : moved <= top ? moved : top;
    speed = f32(grav + speed);
    rise += 1;
  }
  const live = Math.min(Math.trunc(flare), fireworksSparks(n));
  const waitRead = 1 + 2 * (live - 1);
  const pause =
    (((sourceWord(shot * SHOT_READS + waitRead) & 0xff) * 10) >>> 8) + 6;
  return rise + FIREWORKS_BURN + pause - 3;
}

const SHOT_LIMIT = 6;

// A shot's renders so far, and what it takes to go on.
const fireworksShot = (shot) => ({
  state: fireworksState(),
  read: shotSource(shot),
  draws: [],
});

// Shot starts for one rate and the last shots' renders: previews of one rate
// each have their own clock, so a shot is computed once and read at any render.
class FireworksTimeline {
  constructor(rate) {
    this.rate = rate;
    this.starts = [0];
    this.shots = new Map();
  }

  shotAt(render) {
    while (this.starts[this.starts.length - 1] <= render) {
      const shot = this.starts.length - 1;
      this.starts.push(
        this.starts[this.starts.length - 1] + fireworksShotLength(shot, this.rate),
      );
    }
    let low = 0;
    let high = this.starts.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (this.starts[middle] <= render) low = middle;
      else high = middle;
    }
    return [low, render - this.starts[low]];
  }

  drawsAt(render) {
    const [shot, offset] = this.shotAt(render);
    // The most recently used last: the oldest goes first.
    const record = this.shots.get(shot) ?? fireworksShot(shot);
    this.shots.delete(shot);
    this.shots.set(shot, record);
    if (this.shots.size > SHOT_LIMIT)
      this.shots.delete(this.shots.keys().next().value);
    while (record.draws.length <= offset)
      record.draws.push(
        fireworksStep(
          record.state, LENGTH, this.rate, FIREWORKS_INTENSITY,
          FIREWORKS_SELECTOR, 0, record.read,
        ),
      );
    return record.draws[offset];
  }
}

const timelines = new Map();
const TIMELINE_LIMIT = 8;

/** The 20 x 5 frame (lamp order) Fireworks shows `seconds` after it was
 * applied, at `rate` (0-255) and the lamp's `direction` (0-3). */
export function renderFireworks(seconds, rate, direction, profile = REFERENCE_PROFILE) {
  rate = Math.max(0, Math.min(255, Math.trunc(Number(rate)) || 0));
  let timeline = timelines.get(rate);
  if (!timeline) {
    if (timelines.size >= TIMELINE_LIMIT)
      timelines.delete(timelines.keys().next().value);
    timeline = new FireworksTimeline(rate);
    timelines.set(rate, timeline);
  }
  const render = Math.max(0, Math.floor(seconds / RENDER_SECONDS));
  const shown = timeline.shown;
  if (shown?.render === render && shown.direction === direction && shown.profile === profile)
    return shown.frame;
  const frame = stripFrame(timeline.drawsAt(render), direction, profile);
  timeline.shown = { render, direction, profile, frame };
  return frame;
}

// ── What a command installs (const.py and lamp_renderers.py) ──────
// The effects as the integration sends them: this side has no const.py.
// tests/test_lamp_renderers.py keeps this equal to it.
// const.py EXTENDED_EFFECT_COMMAND_ID: the outer id of the effects the
// Yeelight app does not offer (3 made the app show Ribbon).
const EXTENDED_EFFECT_ID = 63;
const ALL_DIRECTIONS = ["Up", "Down", "Left", "Right"];
const SWAP_UP_DOWN = { Up: "Down", Down: "Up" };
// const.py _EXTENDED_EFFECT_NO_SPEED / _NO_DIRECTION for the slots named by
// number until 1.4.0 (the others say it in their row), and
// _EXTENDED_EFFECT_COLORS.
const NUMBERED_NO_SPEED = new Set([20, 27, 33, 38, 44, 52, 65, 66, 68, 69, 72, 73]);
const NUMBERED_NO_DIRECTION = new Set([1, 2, 20, 27, 31, 44, 52, 63, 72]);
const SLOT_COLORS = {
  1: [0x01ff563d, 0x01427bf4],
  8: [0x01ff563d, 0x01ffd044, 0x0126cd94, 0x01427bf4],
  28: [0x01ff563d, 0x01ffd044, 0x0126cd94, 0x01427bf4],
  33: [0x01ff563d],
  72: [0x01ff3010, 0x0110ff40, 0x012050ff, 0x01e0c0a0],
};
// const.py LAMP_INTENSITY_SLOTS (what intensity sets on each is listed there)
// and LAMP_INTENSITY_MINIMUMS.
export const LAMP_INTENSITY_SLOTS = new Set([
  4, 5, 6, 7, 9, 11, 14, 15, 18, 23, 25, 26, 28, 30, 32, 37, 42, 43, 45, 47,
  49, 51, 60, 61, 70, 73,
]);
export const LAMP_INTENSITY_MINIMUMS = { 15: 13, 70: 1 };
// The effects that read the intensity get `intensity: true`, like `speed`.
const withIntensity = (effects) =>
  Object.fromEntries(
    Object.entries(effects).map(([name, spec]) => [
      name,
      LAMP_INTENSITY_SLOTS.has(spec.mode) ? { ...spec, intensity: true } : spec,
    ]),
  );
export const LAMP_EFFECTS = withIntensity({
  Ribbon: { mode: 3, effectId: 3, speed: true },
  "Starry Sky": { mode: 5, effectId: 5, speed: true, color: 255 },
  Spectrum: { mode: 17, effectId: 17, directions: ALL_DIRECTIONS, remap: SWAP_UP_DOWN },
  Waves: { mode: 42, effectId: 42, speed: true, directions: ALL_DIRECTIONS, remap: SWAP_UP_DOWN },
  Rainbow: { mode: 39, effectId: 39, speed: true, directions: ALL_DIRECTIONS, remap: SWAP_UP_DOWN },
  Waterfall: { mode: 32, effectId: 32, speed: true, directions: ALL_DIRECTIONS, remap: SWAP_UP_DOWN, color: 255 },
  Aurora: { mode: 15, effectId: 15, speed: true, directions: ALL_DIRECTIONS, color: 16842496 },
  Fire: { mode: 34, effectId: 34, speed: true, directions: ALL_DIRECTIONS, remap: { Right: "Down", Down: "Right", Left: "Up", Up: "Left" } },
  "Bouncing Ball": { mode: 37, effectId: 37, speed: true },
  Meteor: { mode: 47, effectId: 47, speed: true, directions: ALL_DIRECTIONS, remap: SWAP_UP_DOWN },
  Tide: { mode: 48, effectId: 48, speed: true, directions: ALL_DIRECTIONS, remap: { Right: "Up", Left: "Down", Up: "Left", Down: "Right" } },
  "Building Blocks": { mode: 49, effectId: 49, speed: true, directions: ALL_DIRECTIONS, remap: SWAP_UP_DOWN, color: 16777471 },
  Hacking: { mode: 46, effectId: 46, speed: true, directions: ["Up", "Down"] },
  "Flower Sea": { mode: 55, effectId: 91, speed: true, directions: ALL_DIRECTIONS },
  Magic: { mode: 76, effectId: 92, speed: true },
  Wonderland: { mode: 77, effectId: 94, speed: true },
  Kaleidoscope: { mode: 80, effectId: 95, speed: true, directions: ALL_DIRECTIONS, remap: SWAP_UP_DOWN },
  Palette: { mode: 81, effectId: 96, speed: true, directions: ALL_DIRECTIONS },
  "Moving palette": { mode: 4, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Particle path": { mode: 6, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Triangular palette pulses": { mode: 9, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  Fireworks: { mode: 10, effectId: 71, speed: true, directions: ALL_DIRECTIONS },
  "Sine wave": { mode: 11, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Sunrise and sunset": { mode: 18, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Heat fire": { mode: 19, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Mirrored comets": { mode: 22, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Palette sparks": { mode: 24, effectId: EXTENDED_EFFECT_ID, directions: ALL_DIRECTIONS },
  "Tide (slot 35)": { mode: 35, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Rainbow noise": { mode: 54, effectId: EXTENDED_EFFECT_ID, directions: ALL_DIRECTIONS },
  "Violet interference": { mode: 56, effectId: EXTENDED_EFFECT_ID, directions: ALL_DIRECTIONS },
  "Night-amber waves": { mode: 57, effectId: EXTENDED_EFFECT_ID, speed: true },
  "Navy-white noise": { mode: 58, effectId: EXTENDED_EFFECT_ID, directions: ALL_DIRECTIONS },
  "Night-sky waves": { mode: 59, effectId: EXTENDED_EFFECT_ID },
  "Flicker sweep": { mode: 60, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Particle glows": { mode: 61, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  "Palette stripes": { mode: 70, effectId: EXTENDED_EFFECT_ID, directions: ALL_DIRECTIONS },
  "Neon sine bands": { mode: 75, effectId: EXTENDED_EFFECT_ID, speed: true },
  "Violet twinkles": { mode: 79, effectId: EXTENDED_EFFECT_ID, speed: true, directions: ALL_DIRECTIONS },
  // The slots named by number until 1.4.0 (effect-names.js). Not 71: it plays
  // the lamp's stored GIF.
  ...Object.fromEntries(
    [1, 2, 7, 8, 14, 16, 20, 21, 23, 25, 26, 27, 28, 30, 31, 33, 38, 41, 43, 44, 45, 51, 52,
      62, 63, 65, 66, 68, 69, 72, 73, 74].map((mode) => [
      FORMERLY_NUMBERED_EFFECT_NAMES[mode],
      {
        mode,
        effectId: EXTENDED_EFFECT_ID,
        ...(NUMBERED_NO_SPEED.has(mode) ? {} : { speed: true }),
        ...(NUMBERED_NO_DIRECTION.has(mode) ? {} : { directions: ALL_DIRECTIONS }),
        ...(SLOT_COLORS[mode] ? { colors: SLOT_COLORS[mode] } : {}),
      },
    ]),
  ),
});
export const DIRECTION_VALUES = { Up: 0, Down: 1, Left: 2, Right: 3 };
// const.py MOUNT_DIRECTION_VALUES: what keeps an effect flowing the same way for
// the viewer once the lamp is turned.
export const MOUNT_DIRECTION_VALUES = {
  right: [0, 1, 2, 3],
  down: [2, 3, 1, 0],
  left: [1, 0, 3, 2],
  up: [3, 2, 0, 1],
};
export const CLOCK_COLOR_MODE_IDS = {
  bw: 15,
  red_blue: 64,
  white_orange: 65,
  blue_yellow: 66,
  purple_orange: 67,
};
export const CLOCK_MIXER_COMMAND_IDS = { 10: 71 };
export const NATIVE_CLOCK_EFFECT_ID = 40;
export const LAMP_RATE_LIMITS = { 28: 254, 51: 239 };
// The lamp's stored presets, by command id, as far as the commands sent use
// them: [colour selector, intensity, rate, direction]. A command starts from
// the row, then only the sent keys change.
// const.py DEFAULT_NATIVE_EFFECT_SPEED, DEFAULT_NATIVE_EFFECT_INTENSITY,
// SPEED_RANGE, INTENSITY_RANGE and UNDIRECTED_EFFECT_DIRECTION.
export const DEFAULT_EFFECT_SPEED = 128;
export const DEFAULT_EFFECT_INTENSITY = 128;
export const SPEED_RANGE = Object.freeze({ min: 0, max: 255 });
export const INTENSITY_RANGE = Object.freeze({ min: 0, max: 255 });
export const UNDIRECTED_EFFECT_DIRECTION = 0;

export const PRESET_ROWS = {
  3: [0, 128, 128, 0],
  5: [0, 128, 128, 0],
  15: [8, 128, 128, 0],
  17: [0, 128, 128, 0],
  32: [0, 128, 128, 0],
  34: [0, 128, 128, 3],
  37: [0, 128, 128, 0],
  39: [0, 128, 128, 0],
  40: [0, 128, 128, 0],
  42: [0, 128, 128, 0],
  46: [0, 128, 128, 0],
  47: [0, 128, 128, 0],
  48: [0, 128, 128, 0],
  49: [0, 128, 128, 0],
  63: [0, 128, 128, 0],
  64: [12, 128, 128, 0],
  65: [13, 128, 128, 0],
  66: [14, 128, 128, 0],
  67: [32, 128, 128, 0],
  71: [14, 0, 128, 0],
  91: [0, 128, 128, 0],
  92: [0, 128, 128, 0],
  94: [0, 128, 128, 0],
  95: [0, 128, 128, 0],
  96: [0, 128, 128, 0],
};
// A sent color selects the ramp of the primary color; without one the words
// are white.
const COLOUR_SELECTOR = 8;
// The raw direction that maps to 0: the lamp ignores the direction of a
// mode 40 command, so a clock's background keeps mapped direction 0 whatever is
// sent.
export const CLOCK_BACKGROUND_DIRECTION = DIRECTION_TABLE[REFERENCE_PROFILE].indexOf(0);

export const lampRate = (mode, rate) =>
  Math.min(rate, LAMP_RATE_LIMITS[mode] ?? rate);

/** const.py lamp_intensity: the intensity sent for slot `mode`. */
export function lampIntensity(mode, intensity) {
  const value = Math.max(
    INTENSITY_RANGE.min,
    Math.min(INTENSITY_RANGE.max, Math.trunc(Number(intensity))),
  );
  return Math.max(value, LAMP_INTENSITY_MINIMUMS[mode] ?? value);
}

/** The intensity chosen on a lamp (its native_effect_intensity attribute), the
 * default when it reports none. Previews pass it on as the lamp gets it: only
 * the effects that read it change. */
export const chosenIntensity = (attrs) =>
  lampSetting(attrs?.native_effect_intensity, INTENSITY_RANGE, DEFAULT_EFFECT_INTENSITY);

/** The speed chosen on a lamp (its native_effect_speed attribute, 0-255),
 * the default when it reports none. */
export const chosenSpeed = (attrs) =>
  lampSetting(attrs?.native_effect_speed, SPEED_RANGE, DEFAULT_EFFECT_SPEED);

// A reported setting in its range; 0 is a value, only a missing one defaults.
function lampSetting(value, { min, max }, fallback) {
  const n = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

// The intensity a command sends for the effect `spec`: null when the effect
// reads none or none is chosen, so the preset row's applies (lamp_renderers.py
// _sent_intensity).
const sentIntensity = (spec, intensity) =>
  intensity == null || !spec.intensity ? null : lampIntensity(spec.mode, intensity);

// What the lamp does with a color: not what a preview shows, so these stay
// whatever draws the frames.
// Effects a single custom color recolors; the others ignore it on the lamp.
// Two-colour alternation to Random scatter draw their colour words: the picked
// one replaces the first. From Breathing on, the slots named by number until
// 1.4.0: what their renderers draw, not yet seen on a lamp
// (lamp_renderers.py).
export const COLOR_OVERRIDE_EFFECTS = new Set([
  "Aurora", "Fire", "Building Blocks", "Tide (slot 35)", "Particle glows",
  "Palette sparks", "Kaleidoscope", "Sine wave", "Waves",
  "Triangular palette pulses", "Bouncing Ball", "Mirrored comets",
  "Sunrise and sunset", "Rainbow", "Moving palette", "Meteor", "Heat fire",
  "Spectrum", "Palette stripes", "Starry Sky", "Ribbon", "Tide", "Waterfall",
  "Two-colour alternation", "Rotating colour bands", "Scrolling bands",
  "Rising wisps", "Random scatter",
  "Breathing", "Dual scan", "Palette trails", "Drop and bounce",
  "Music level glow", "Stacking blocks", "Music bars from both ends",
  "Music bars from the centre", "Music bar from one end", "Palette cross-fade",
  "Music Spectrum", "Music Gather", "Music Breathing", "Music Blossom",
  "Music noise equalizer", "Dot with fading trail", "Centre bursts",
  "Music Note", "Music Impact",
]);
// Effects the lamp's B&W palette (command id 15) turns grey. Verified on
// hardware; Starry Sky, Waterfall and Aurora only once their default color is
// not sent (light_native). From Two-colour alternation on, the slots named by
// number until 1.4.0, per their renderers; the five that draw their colour
// words go white, as without them.
export const COLOR_MODE_BW_EFFECTS = new Set([
  "Aurora", "Fire", "Tide (slot 35)", "Particle glows", "Kaleidoscope",
  "Sine wave", "Waves", "Triangular palette pulses", "Bouncing Ball",
  "Mirrored comets", "Sunrise and sunset", "Rainbow", "Moving palette",
  "Heat fire", "Spectrum", "Palette stripes", "Starry Sky", "Ribbon", "Tide",
  "Waterfall",
  "Two-colour alternation", "Rotating colour bands", "Scrolling bands",
  "Rising wisps", "Random scatter", "Dual scan", "Palette trails",
  "Drop and bounce", "Music level glow", "Stacking blocks",
  "Music bars from both ends", "Music bars from the centre",
  "Music bar from one end", "Palette cross-fade", "Music Spectrum",
  "Music Gather", "Music Breathing", "Music Blossom", "Music noise equalizer",
  "Music Note", "Music Impact",
]);
// Particle path is intentionally absent: on the lamp it ignores these
// palette modes. From Dual scan on, the slots named by number until
// 1.4.0, per their renderers.
const COLOR_PALETTE_EFFECTS = new Set([
  "Tide (slot 35)", "Kaleidoscope", "Triangular palette pulses",
  "Mirrored comets", "Rainbow", "Moving palette", "Spectrum", "Palette stripes",
  "Ribbon", "Tide",
  "Dual scan", "Palette trails", "Drop and bounce", "Music level glow",
  "Stacking blocks", "Music bars from both ends", "Music bars from the centre",
  "Palette cross-fade", "Music noise equalizer", "Music Note", "Music Impact",
]);
const COLOR_PALETTE_MODES = new Set([
  "red_blue", "white_orange", "blue_yellow", "purple_orange",
]);

export const effectSupportsColorOverride = (effect) =>
  COLOR_OVERRIDE_EFFECTS.has(effect);

// const.py PALETTE_COLOR_MODE: the native effects' own color mode, the
// lamp's palette (its text_colors attribute).
export const PALETTE_COLOR_MODE = "palette";

export const effectSupportsColorMode = (effect, mode) =>
  (COLOR_PALETTE_EFFECTS.has(effect) && COLOR_PALETTE_MODES.has(mode)) ||
  (mode === "bw" && COLOR_MODE_BW_EFFECTS.has(effect)) ||
  // The palette's colors reach every effect that takes a color.
  (mode === PALETTE_COLOR_MODE && COLOR_OVERRIDE_EFFECTS.has(effect));

// const.py PALETTE_MUSIC_FLOWS and MUSIC_PALETTE_SIZE.
export const PALETTE_MUSIC_FLOWS = {
  "Music Gather": "Gather",
  "Music Breathing": "Breathing",
  "Music Blossom": "Blossom",
  "Music Spectrum": "Spectrum",
  "Music Note": "Music Note",
  "Music Impact": "Impact",
};
const MUSIC_PALETTE_SIZE = 16;

const paletteColours = (palette) =>
  Array.isArray(palette) ? palette.filter((colour) => Array.isArray(colour) && colour.length >= 3) : [];

/** The colour words (0xRRGGBB) an effect is sent for `palette`, a list of
 * [r, g, b]; empty when the palette is (lamp_renderers.py palette_words). */
export function paletteWords(effect, palette) {
  const colours = paletteColours(palette);
  if (!colours.length) return [];
  const count = (LAMP_EFFECTS[effect].colors ?? []).length || 1;
  return Array.from({ length: count }, (_, index) => {
    const [r, g, b] = colours[index % colours.length];
    return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  });
}

/** The colour words a clock is sent in the palette color mode
 * (lamp_renderers.py clock_palette_words): a plain-colour style (`effect`
 * null) its first colour, a background that takes the palette as many as that
 * effect, another none. */
export function clockPaletteWords(effect, palette) {
  if (!effect) {
    const colours = paletteColours(palette);
    if (!colours.length) return [];
    const [r, g, b] = colours[0];
    return [((r & 255) << 16) | ((g & 255) << 8) | (b & 255)];
  }
  if (!effectSupportsColorMode(effect, PALETTE_COLOR_MODE)) return [];
  return paletteWords(effect, palette);
}

/** A palette spread over a music mode's 16 entries (lamp_renderers.py
 * music_palette). */
export function musicPalette(palette) {
  const colours = paletteColours(palette);
  if (!colours.length) return [];
  return Array.from({ length: MUSIC_PALETTE_SIZE }, (_, index) =>
    colours[Math.floor((index * colours.length) / MUSIC_PALETTE_SIZE)].slice(0, 3),
  );
}

/** The microphone music mode an effect runs as in the palette color mode,
 * null otherwise (lamp_renderers.py palette_music_flow). */
export const paletteMusicFlow = (effect, colorMode, palette) =>
  colorMode === PALETTE_COLOR_MODE && paletteColours(palette).length
    ? (PALETTE_MUSIC_FLOWS[effect] ?? null)
    : null;

/** The fields a renderer reads, from what a command sends. */
// `word`: the first colour word sent (null: no color key), `more` the others,
// `sent` the intensity sent (null: the preset row's).
function commandSettings(mode, commandId, direction, rate, word, more = [], sent = null) {
  const [selector, rowIntensity] = PRESET_ROWS[commandId];
  const intensity = sent ?? rowIntensity;
  const coloured = word !== null;
  const settings = {
    mode,
    selector: coloured ? COLOUR_SELECTOR : selector,
    intensity,
    rate,
    direction,
    primary: coloured ? rgb(word) : [255, 255, 255],
    coloured,
  };
  if (coloured && more.length) settings.colours = [rgb(word), ...more.map(rgb)];
  return settings;
}

const rgb = (word) => [(word >>> 16) & 255, (word >>> 8) & 255, word & 255];

// const.py effect_direction_value.
function effectDirectionValue(spec, label, orientation) {
  const value = (name) => DIRECTION_VALUES[spec.remap?.[name] ?? name];
  const own = value(label);
  const turned = (MOUNT_DIRECTION_VALUES[orientation] ?? MOUNT_DIRECTION_VALUES.right)[own];
  return spec.directions.some((name) => value(name) === turned) ? turned : own;
}

/** What the lamp runs for a native effect (lamp_renderers.py). */
export function lampSettings(
  effect,
  direction,
  speed,
  colorOverride = null,
  colorMode = null,
  orientation = null,
  intensity = null,
  lampPalette = null,
) {
  const spec = LAMP_EFFECTS[effect];
  const palette = effectSupportsColorMode(effect, colorMode)
    ? (CLOCK_COLOR_MODE_IDS[colorMode] ?? null)
    : null;
  const commandId = palette ?? spec.effectId;
  let value = UNDIRECTED_EFFECT_DIRECTION;
  if (spec.directions) {
    const label = spec.directions.includes(direction) ? direction : spec.directions[0];
    value = effectDirectionValue(spec, label, orientation);
  }
  const rate = spec.speed ? lampRate(spec.mode, speed) : PRESET_ROWS[commandId][2];
  let words =
    palette !== null ? [] : (spec.color != null ? [spec.color] : spec.colors ?? []).map(
      (color) => color & 0xffffff,
    );
  if (colorOverride && (!colorMode || colorMode === "normal") && effectSupportsColorOverride(effect))
    words = [(colorOverride[0] << 16) | (colorOverride[1] << 8) | colorOverride[2], ...words.slice(1)];
  if (colorMode === PALETTE_COLOR_MODE && effectSupportsColorMode(effect, colorMode)) {
    const sent = paletteWords(effect, lampPalette);
    if (sent.length) words = sent;
  }
  const settings = commandSettings(
    spec.mode, commandId, value, rate, words[0] ?? null, words.slice(1),
    sentIntensity(spec, intensity),
  );
  if (paletteMusicFlow(effect, colorMode, lampPalette)) {
    // The music mode: the whole palette, at the effect's own speed and
    // intensity (the music mode takes none).
    settings.palette = musicPalette(lampPalette);
    [, settings.intensity, settings.rate] = PRESET_ROWS[commandId];
  }
  return settings;
}

// const.py CLOCK_SETUP_FLAGS: the flags these backgrounds set in their first
// render, which the clock's digits go through when they are started directly.
export const CLOCK_SETUP_FLAGS = Object.freeze({ 22: 0x0a, 51: 0x42 });

/** The flags the clock's digits are drawn on (lamp_renderers.py
 * clock_digit_flags). */
export function clockDigitFlags(mixer, direct) {
  return 0x05 | (direct ? CLOCK_SETUP_FLAGS[mixer] ?? 0 : 0);
}

// const.py CLOCK_DIRECT_BACKGROUNDS: sent as themselves under the clock
// overlay; mode 40 hands over to every other background.
export const CLOCK_DIRECT_BACKGROUNDS = new Set([24, 33, 46, 47, 49, 60, 66, 69, 71, 72, 81]);

/** What the lamp runs behind the clock when `effect` is its mixer
 * (lamp_renderers.py); `handover` when mode 40 hands over to it (it starts
 * past its first render, on the hand-over's flags). `direct`: the style runs
 * it as itself under the clock overlay (by default the
 * CLOCK_DIRECT_BACKGROUNDS do). */
export function lampClockSettings(
  effect,
  speed,
  colorOverride = null,
  colorMode = null,
  intensity = null,
  lampPalette = null,
  direct = null,
) {
  const settings = clockSettings(effect, speed, colorOverride, colorMode, intensity, lampPalette);
  if (!(direct ?? CLOCK_DIRECT_BACKGROUNDS.has(settings.mode))) settings.handover = true;
  return settings;
}

function clockSettings(effect, speed, colorOverride, colorMode, intensity, lampPalette) {
  const spec = LAMP_EFFECTS[effect];
  // The palette color mode: the palette's colours to a background that takes
  // them, else as the normal mode (lamp_renderers.py).
  if (colorMode === PALETTE_COLOR_MODE) {
    const sent = clockPaletteWords(effect, lampPalette);
    colorMode = null;
    if (sent.length) {
      const commandId = CLOCK_MIXER_COMMAND_IDS[spec.mode] ?? NATIVE_CLOCK_EFFECT_ID;
      const rate = spec.speed ? lampRate(spec.mode, speed) : PRESET_ROWS[commandId][2];
      return commandSettings(
        spec.mode, commandId, CLOCK_BACKGROUND_DIRECTION, rate, sent[0], sent.slice(1),
        sentIntensity(spec, intensity),
      );
    }
  }
  // A slot that draws its colour words (1, 8, 28, 33, 72) is sent all of them,
  // the color first, none under B&W, and no palette, which would only drop
  // them (lamp_renderers.py).
  let words = (spec.colors ?? []).map((color) => color & 0xffffff);
  if (words.length) {
    if (colorMode === "bw") {
      colorOverride = null;
      words = [];
    }
    colorMode = null;
  }
  const active = !!colorMode && colorMode !== "normal";
  const commandId =
    (active ? CLOCK_COLOR_MODE_IDS[colorMode] : null) ??
    CLOCK_MIXER_COMMAND_IDS[spec.mode] ??
    NATIVE_CLOCK_EFFECT_ID;
  let word = null;
  if (!active) {
    if (colorOverride)
      word = (colorOverride[0] << 16) | (colorOverride[1] << 8) | colorOverride[2];
    else if (spec.color != null) word = spec.color & 0xffffff;
    else if (words.length) word = words[0];
  }
  const rate = spec.speed ? lampRate(spec.mode, speed) : PRESET_ROWS[commandId][2];
  const more = !active && word !== null ? words.slice(1) : [];
  return commandSettings(
    spec.mode, commandId, CLOCK_BACKGROUND_DIRECTION, rate, word, more,
    sentIntensity(spec, intensity),
  );
}

// The families: one line each.
registerFamily(coreEffects);
registerFamily(wavesEffects);
registerFamily(noiseEffects);
registerFamily(sparksEffects);
registerFamily(trailsEffects);
registerFamily(musicEffects);
