// ============================================================================
//  Native-effect orientation table (calibration source of truth)
// ============================================================================
//
// Per-effect, per-firmware-direction correction so the SOFTWARE previews match
// the physical lamp. Captured with the internal calibration card and applied
// inside renderNativeEffect (and mirrored in native_effect_preview.py).
//
// Model (display space, but the flags are identical in raw space): for firmware
// direction T, render the RAW frame for `source`, then reverse rows iff flipV
// and reverse columns iff flipH. `clock` is the fixed firmware direction the
// effect's clock-style background uses.
//
// Only non-default effects are listed; anything absent is identity (source =
// the requested direction, no flips) with clock direction "Down".
//
// CRITICAL — the firmware direction_remap is the ground truth (do NOT remove it):
// This table was calibrated against the lamp AS DRIVEN BY THE EXISTING send path,
// which applies const.py direction_remap / resolve_clock_mixer_direction so the
// lamp's physical flow matches the arrow. These previews correct on TOP of that.
// If you ever delete the send-side remap, the lamp's up/down flips for the
// _SWAP_UP_DOWN effects (Ocean Waves, Rainbow, Spectrum, Waterfall, Shooting
// Star, Building block, Kaleidoscope) and EVERY calibrated preview here becomes
// inverted. Correct previews by editing THIS table, never the send path.
//
// Keep this file in sync with effect_orientation.py.

const COLS = 20;
const ROWS = 5;

// Shared rotation maps (no flips), reused by several effects.
const ROT_B = {
  Up: ["Right", false, false],
  Down: ["Left", false, false],
  Left: ["Up", false, false],
  Right: ["Down", false, false],
};
const ROT_C = {
  Up: ["Left", false, false],
  Down: ["Right", false, false],
  Left: ["Down", false, false],
  Right: ["Up", false, false],
};
const ROT_D = {
  Up: ["Left", false, false],
  Down: ["Right", false, false],
  Left: ["Up", false, false],
  Right: ["Down", false, false],
};

// effect -> { clock, dirs: { [firmwareDir]: [sourceDir, flipH, flipV] } }
export const EFFECT_ORIENTATION = {
  Spectrum: {
    clock: "Left",
    dirs: {
      Up: ["Right", true, true],
      Down: ["Left", true, true],
      Left: ["Down", false, false],
      Right: ["Up", false, false],
    },
  },
  "Ocean Waves": {
    clock: "Left",
    dirs: {
      Up: ["Up", false, true],
      Down: ["Down", false, true],
      Left: ["Left", true, false],
      Right: ["Right", true, false],
    },
  },
  Rainbow: {
    clock: "Left",
    dirs: {
      Up: ["Right", false, true],
      Down: ["Left", false, true],
      Left: ["Down", false, false],
      Right: ["Up", false, false],
    },
  },
  Waterfall: {
    clock: "Left",
    dirs: {
      Up: ["Right", false, true],
      Down: ["Left", false, true],
      Left: ["Down", false, false],
      Right: ["Up", false, false],
    },
  },
  Aurora: {
    clock: "Left",
    dirs: {
      Up: ["Up", false, false],
      Down: ["Down", true, false],
      Left: ["Left", false, false],
      Right: ["Right", true, false],
    },
  },
  Bonfire: { clock: "Up", dirs: { ...ROT_D } },
  "Shooting Star": { clock: "Down", dirs: { ...ROT_C } },
  "Building block": { clock: "Down", dirs: { ...ROT_C } },
  Hacking: {
    clock: "Down",
    dirs: {
      Up: ["Up", false, false],
      Down: ["Up", false, false],
      Left: ["Up", false, false],
      Right: ["Down", false, false],
    },
  },
  "Flower Sea": { clock: "Right", dirs: { ...ROT_D } },
  Kaleidoscope: { clock: "Left", dirs: {} },
  Palette: { clock: "Down", dirs: { ...ROT_B } },
  Carousel: { clock: "Left", dirs: { ...ROT_B } },
  "Blue Yellow": {
    clock: "Up",
    dirs: {
      Up: ["Up", true, true],
      Down: ["Down", false, false],
      Left: ["Left", false, false],
      Right: ["Right", false, false],
    },
  },
  "Blue White": {
    clock: "Down",
    dirs: {
      Up: ["Up", true, true],
      Down: ["Down", false, false],
      Left: ["Left", false, false],
      Right: ["Right", false, false],
    },
  },
  "Rainbow Flow": { clock: "Left", dirs: { ...ROT_B } },
  "Spectrum Chase": { clock: "Left", dirs: { ...ROT_B } },
  "Pastel Pulse": { clock: "Left", dirs: { ...ROT_B } },
  Fireworks: {
    clock: "Left",
    dirs: {
      Up: ["Up", false, false],
      Down: ["Down", false, false],
      Left: ["Left", true, false],
      Right: ["Right", true, false],
    },
  },
  "Monochrome Waves": { clock: "Left", dirs: {} },
  Pulse: { clock: "Left", dirs: { ...ROT_D } },
  "Solar Flare": { clock: "Left", dirs: { ...ROT_B } },
  Prism: {
    clock: "Left",
    dirs: {
      Up: ["Up", false, false],
      Down: ["Down", false, true],
      Left: ["Right", false, true],
      Right: ["Right", false, true],
    },
  },
  "Color Trails": { clock: "Left", dirs: {} },
  "Spectrum Crumble": { clock: "Down", dirs: { ...ROT_B } },
  Drift: { clock: "Left", dirs: {} },
  "Spectrum Bands": {
    clock: "Left",
    dirs: {
      Up: ["Down", false, false],
      Down: ["Down", false, false],
      Left: ["Right", false, false],
      Right: ["Right", false, false],
    },
  },
};

/** Resolve {source, flipH, flipV} for an effect + firmware direction. */
export function effectOrientation(effect, direction) {
  const entry = EFFECT_ORIENTATION[effect];
  const d = entry && entry.dirs && entry.dirs[direction];
  if (!d) return { source: direction, flipH: false, flipV: false };
  return { source: d[0], flipH: !!d[1], flipV: !!d[2] };
}

/** The fixed firmware direction an effect's clock-style background uses. */
export function clockEffectDirection(effect) {
  const entry = EFFECT_ORIENTATION[effect];
  return (entry && entry.clock) || "Down";
}

/** Reverse rows (flipV) and/or columns (flipH) of a raw 20x5 frame. */
export function orientFrame(pixels, flipH, flipV) {
  if (!flipH && !flipV) return pixels;
  const out = new Array(pixels.length);
  for (let r = 0; r < ROWS; r++) {
    const sr = flipV ? ROWS - 1 - r : r;
    for (let c = 0; c < COLS; c++) {
      const sc = flipH ? COLS - 1 - c : c;
      out[r * COLS + c] = pixels[sr * COLS + sc];
    }
  }
  return out;
}
