// The animations a lamp can store (lamp-animations.js, generated): their
// frames for the previews, as lamp_animations.py draws them for the camera.
// The frames are top-first, as the viewer sees a lamp mounted the default
// way; a preview frame is in lamp order (row 0 = the lamp's bottom row), the
// order every effect preview has, which matrix-view.js turns back for the
// viewer. The lamp plays them at the pace and in the colors of the GIF it
// stores: the effect speed (animationDelays) and the color adjustments
// (color-adjustments.js) are in it.
import { LAMP_ANIMATIONS } from "./lamp-animations.js";
import { studioAnimationFrames, studioLook, studioPalette } from "./lamp-studio.js";
import { adjustColor, adjustmentsKey } from "./color-adjustments.js";
import { MATRIX_COLS, MATRIX_ROWS, MATRIX_SIZE, isUpsideDownMount } from "./matrix-view.js";
import { frameWidthFor } from "./lamp-core.js";

/** Each animation's key by its effect name (effect_catalog.py LAMP_ANIMATION_EFFECTS). */
export const ANIMATION_EFFECTS = Object.fromEntries(
  Object.entries(LAMP_ANIMATIONS).map(([key, entry]) => [entry.name, key]),
);

/** Whether `key` names one of the animations. */
export const isAnimation = (key) =>
  typeof key === "string" && Object.hasOwn(LAMP_ANIMATIONS, key);

const decoded = new Map();

function animation(key) {
  if (!decoded.has(key)) {
    const entry = LAMP_ANIMATIONS[key];
    const raw = atob(entry.frames);
    const frames = [];
    for (let start = 0; start < raw.length; start += MATRIX_SIZE * 3) {
      const frame = [];
      for (let pixel = 0; pixel < MATRIX_SIZE; pixel++) {
        const at = start + pixel * 3;
        frame.push([raw.charCodeAt(at), raw.charCodeAt(at + 1), raw.charCodeAt(at + 2)]);
      }
      frames.push(frame);
    }
    decoded.set(key, { delays: entry.delays, frames });
  }
  return decoded.get(key);
}

// effect_catalog.py DEFAULT_NATIVE_EFFECT_SPEED: the speed an animation plays at as
// drawn; lamp_animations.py SPEED_DOUBLING, MIN_DELAY_HUNDREDTHS.
const DRAWN_SPEED = 128;
const SPEED_DOUBLING = 64;
const MIN_DELAY_HUNDREDTHS = 2;

/** An animation's frame delays (ms) at the effect `speed`, as its GIF holds
 * them (lamp_animations.py animation_delays). */
export function animationDelays(key, speed = null) {
  const { delays } = animation(key);
  if (speed == null || speed === DRAWN_SPEED) return delays;
  const pace = 2 ** ((speed - DRAWN_SPEED) / SPEED_DOUBLING);
  return delays.map(
    (delay) => 10 * Math.max(MIN_DELAY_HUNDREDTHS, Math.floor(delay / 10 / pace + 0.5)),
  );
}

// The frames with each set of color adjustments shown lately.
const adjusted = new Map();

/** An animation's top-first frames in the Studio `palette` (null: its own
 * colors) with the color `adjustments` (lamp_animations.py animation_frames). */
export function animationFrames(key, adjustments = null, palette = null) {
  let { frames } = animation(key);
  const colours = studioPalette(palette);
  const look = adjustmentsKey(adjustments);
  if (!look && !colours.length) return frames;
  const cacheKey = `${key}|${look}|${colours.join(";")}`;
  if (!adjusted.has(cacheKey)) {
    if (colours.length)
      frames = studioAnimationFrames(frames, studioLook(LAMP_ANIMATIONS[key].name), colours);
    const colors = new Map();
    const color = (pixel) => {
      const id = pixel.join(",");
      if (!colors.has(id)) colors.set(id, adjustColor(pixel, adjustments));
      return colors.get(id);
    };
    if (adjusted.size >= 8) adjusted.delete(adjusted.keys().next().value);
    adjusted.set(cacheKey, look ? frames.map((frame) => frame.map(color)) : frames);
  }
  return adjusted.get(cacheKey);
}

/** The top-first frame `seconds` into an animation at the effect `speed`, in
 * the Studio `palette`, with the color `adjustments` (lamp_animations.py
 * animation_frame_at). */
export function animationFrameAt(key, seconds, speed = null, adjustments = null, palette = null) {
  const frames = animationFrames(key, adjustments, palette);
  const delays = animationDelays(key, speed);
  const loop = delays.reduce((a, b) => a + b, 0);
  let elapsed = Math.trunc(Math.max(0, seconds) * 1000) % loop;
  for (let index = 0; index < delays.length; index++) {
    if (elapsed < delays[index]) return frames[index];
    elapsed -= delays[index];
  }
  return frames[frames.length - 1];
}

// One lamp-order frame per shown frame and mount, so a tile can tell it is
// the same.
const lampFrames = new WeakMap();

// effect_catalog.py ANIMATION_LAYOUT_APP: an animation sent as the Yeelight app sends
// its GIFs, the picture as it is, which the lamp shows rearranged.
export const ANIMATION_LAYOUT_APP = "app";

// lamp_animations.py REPEATED_ANIMATIONS: repeated along a wider lamp; the
// others are stretched over it.
export const REPEATED_ANIMATIONS = new Set(["snowfall"]);

/** A 20-wide lamp-order frame on a lamp showing `columns` (null: 20): as it
 * is up to 20, else as wide as them: animation `key` repeated every 20
 * columns (REPEATED_ANIMATIONS), else stretched, each column blended from
 * the two nearest of the picture (lamp_animations.py widen_frame, the same
 * integer arithmetic). */
export function widenFrame(frame, columns = null, key = null) {
  const width = frameWidthFor(columns);
  if (width === MATRIX_COLS) return frame;
  const out = [];
  const span = width - 1;
  const repeated = REPEATED_ANIMATIONS.has(key);
  for (let row = 0; row < MATRIX_ROWS; row++) {
    const line = frame.slice(row * MATRIX_COLS, (row + 1) * MATRIX_COLS);
    for (let column = 0; column < width; column++) {
      if (repeated) {
        out.push(line[column % MATRIX_COLS]);
        continue;
      }
      const position = column * (MATRIX_COLS - 1);
      const left = Math.floor(position / span);
      const part = position % span;
      const near = line[left];
      const far = line[Math.min(left + 1, MATRIX_COLS - 1)];
      out.push(near.map((a, channel) => Math.floor((a * (span - part) + far[channel] * part + Math.floor(span / 2)) / span)));
    }
  }
  return out;
}

/** The frame in lamp order for a mount (lamp_animations.py animation_frame),
 * in `layout` (upright unless ANIMATION_LAYOUT_APP: file pixel n at column
 * n / 5, row n % 5 from the top, whatever the mount), at the effect `speed`
 * with the color `adjustments`, on a lamp showing `columns` (null: 20; more:
 * widenFrame). */
export function animationFrame(
  key,
  seconds,
  orientation = null,
  layout = null,
  speed = null,
  adjustments = null,
  palette = null,
  columns = null,
) {
  const shown = animationFrameAt(key, seconds, speed, adjustments, palette);
  let byMount = lampFrames.get(shown);
  if (!byMount) lampFrames.set(shown, (byMount = new Map()));
  const width = frameWidthFor(columns);
  const app = layout === ANIMATION_LAYOUT_APP;
  const turned = !app && isUpsideDownMount(orientation);
  const base = app ? layout : turned;
  const held = width === MATRIX_COLS ? base : `${base}|${width}`;
  if (!byMount.has(held)) {
    if (!byMount.has(base)) {
      const frame = [];
      if (app) {
        for (let row = 0; row < MATRIX_ROWS; row++)
          for (let column = 0; column < MATRIX_COLS; column++)
            frame.push(shown[column * MATRIX_ROWS + (MATRIX_ROWS - 1 - row)]);
      } else {
        const topFirst = turned ? shown.slice().reverse() : shown;
        for (let row = 0; row < MATRIX_ROWS; row++)
          for (let column = 0; column < MATRIX_COLS; column++)
            frame.push(topFirst[(MATRIX_ROWS - 1 - row) * MATRIX_COLS + column]);
      }
      byMount.set(base, frame);
    }
    if (held !== base) byMount.set(held, widenFrame(byMount.get(base), columns, key));
  }
  return byMount.get(held);
}
