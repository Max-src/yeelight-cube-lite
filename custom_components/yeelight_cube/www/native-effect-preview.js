// ============================================================================
//  Native effect software preview
// ============================================================================
//
// An effect's frame comes from the lamp's own renderer, for the command the
// lamp gets (lamp-renderers.js): the entry points below only read it. What is
// left here: a plain gradient for slot 71, whose picture is a GIF stored on the
// lamp, and what the lamp supports (the Freeze list; the color lists live with
// the command's settings). The Music Flow illustrations are the camera's
// (native_effect_preview.py).

import {
  DEFAULT_EFFECT_SPEED,
  COLOR_MODE_BW_EFFECTS,
  COLOR_OVERRIDE_EFFECTS,
  effectSupportsColorMode,
  effectSupportsColorOverride,
  lampEffectFrame,
  lampSettings,
  isLampRendered,
} from "./lamp-renderers.js";

export {
  COLOR_MODE_BW_EFFECTS,
  COLOR_OVERRIDE_EFFECTS,
  effectSupportsColorMode,
  effectSupportsColorOverride,
};

export const PREVIEW_COLS = 20;
export const PREVIEW_ROWS = 5;
const TAU = Math.PI * 2;

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgb(red, green, blue, level = 1.0) {
  return [clamp(red * level), clamp(green * level), clamp(blue * level)];
}

// HSV (0..1 hue/sat/val) -> [r,g,b] 0..255. Matches Python colorsys.hsv_to_rgb.
function hsv(hue, saturation = 1.0, value = 1.0) {
  hue = ((hue % 1) + 1) % 1;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = value * (1 - saturation);
  const q = value * (1 - f * saturation);
  const t = value * (1 - (1 - f) * saturation);
  let r;
  let g;
  let b;
  switch (i % 6) {
    case 0:
      r = value;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = value;
      b = p;
      break;
    case 2:
      r = p;
      g = value;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = value;
      break;
    case 4:
      r = t;
      g = p;
      b = value;
      break;
    default:
      r = value;
      g = p;
      b = q;
      break;
  }
  return rgb(r * 255, g * 255, b * 255);
}

// The preview speed: phase advances 0.25 + speed / 55 per second (camera.py,
// the cards); the lamp's default when a caller gives none.
export const DEFAULT_PREVIEW_SPEED = DEFAULT_EFFECT_SPEED;

// Effects (and clock-style backgrounds of the same name) whose renderer on
// the lamp honours the freeze-frame command (mode 64 for native effects, the
// clock's mixer 64). Others ignore it, so the Freeze action is disabled.
export const FREEZE_COMPATIBLE_EFFECTS = new Set([
  "Waves",
  "Rainbow",
  "Waterfall",
  "Fire",
  "Bouncing Ball",
  "Meteor",
  "Tide",
  "Building Blocks",
  "Hacking",
  "Flower Sea",
  "Magic",
  "Neon sine bands",
  "Wonderland",
  "Palette",
  "Tide (slot 35)",
  "Rainbow noise",
  "Violet interference",
  "Night-amber waves",
  "Navy-white noise",
  "Night-sky waves",
]);

export function effectSupportsFreeze(name) {
  return FREEZE_COMPATIBLE_EFFECTS.has(name);
}

// One frame of a native effect, lamp order: what the lamp's renderer draws
// for the command sent, LED drive (lamp-renderers.js).
// `speed`: the one the phase was computed with, and the rate the lamp gets
// (DEFAULT_PREVIEW_SPEED when omitted). `orientation`: how the lamp is mounted,
// which the direction sent is turned for.
export function renderNativeEffect(
  effect,
  phase,
  direction = "Up",
  colorOverride = null,
  colorMode = null,
  speed = null,
  orientation = null,
) {
  if (!isLampRendered(effect)) return renderGradient(phase, direction);
  const rate = speed ?? DEFAULT_PREVIEW_SPEED;
  return lampEffectFrame(
    lampSettings(effect, direction, rate, colorOverride, colorMode, orientation),
    phase / (0.25 + rate / 55),
  );
}

// Kept for its callers: the lamp's renderers place every direction as the
// lamp does, nothing is left to correct.
export const renderNativeEffectOriented = renderNativeEffect;

// A moving gradient for slot 71: its picture cannot be read from the lamp.
function renderGradient(phase, direction) {
  const pixels = [];
  for (let row = 0; row < PREVIEW_ROWS; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const x = col / (PREVIEW_COLS - 1);
      const y = row / (PREVIEW_ROWS - 1);
      const along =
        direction === "Down" ? 1 - y
        : direction === "Left" ? 1 - x
        : direction === "Right" ? x
        : y;
      const wave = (Math.sin((along * 2 - phase) * TAU) + 1) / 2;
      pixels.push(hsv(x + phase * 0.05, 0.8, 0.35 + 0.65 * wave));
    }
  }
  return pixels;
}
