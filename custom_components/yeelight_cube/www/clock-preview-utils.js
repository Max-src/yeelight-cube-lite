// ============================================================================
//  Shared clock-face software preview
// ============================================================================
//
// Client-side reproduction of the Cube Lite firmware clock renderer, shared by
// the lamp-preview card and the dedicated clock card so there is a SINGLE
// source of truth for the clock previews (no duplication).
//
// Mirrors Python `camera.py:_get_clock_preview()` / `const.py`. The clock draws
// digit/colon glyphs; styles whose firmware `mixer` is a native effect render
// that effect across the whole panel and let it through only on the lit glyph
// pixels (a mask), so the characters animate with the effect.
//
// Keep the mixer tables and glyph handling in sync with const.py.

import { renderNativeEffect } from "./native-effect-preview.js";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  PREVIEW ORIENTATION — READ THIS BEFORE RENDERING ANY PREVIEW             ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║  renderClockFrame() and renderNativeEffect() return pixels where          ║
// ║  ROW 0 = the panel's PHYSICAL BOTTOM. This matches camera.py, which maps  ║
// ║  preview row 0 to the BOTTOM of the rendered image.                       ║
// ║                                                                            ║
// ║  Any renderer that fills top→bottom (CSS grid, renderMatrixPreview, a     ║
// ║  <table>, etc.) will therefore draw the clock/effect UPSIDE-DOWN unless   ║
// ║  you flip the rows first. The lamp-preview card flips via its layout      ║
// ║  indexFn `(rows-1-r)*cols + c`; simpler consumers should call             ║
// ║  flipMatrixVertical() on the frame before painting.                       ║
// ║                                                                            ║
// ║  This has bitten us repeatedly — if a preview looks vertically mirrored,  ║
// ║  this convention mismatch is almost always the cause.                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * Flip a row-major pixel array vertically (bottom-origin ⇄ top-origin).
 * Use this to convert renderClockFrame()/renderNativeEffect() output (row 0 =
 * physical bottom) into the top-to-bottom order a CSS-grid renderer expects.
 * @param {Array} pixels - flat rows*cols array of [r,g,b] (or any per-cell value)
 * @param {number} cols
 * @param {number} rows
 * @returns {Array} a new array with the row order reversed
 */
export function flipMatrixVertical(pixels, cols = 20, rows = 5) {
  const out = new Array(pixels.length);
  for (let r = 0; r < rows; r++) {
    const src = (rows - 1 - r) * cols;
    const dst = r * cols;
    for (let c = 0; c < cols; c++) out[dst + c] = pixels[src + c];
  }
  return out;
}

// Clock styles whose mixer is a native effect: the effect is rendered across
// the whole panel and masked to the lit glyph pixels (mirrors const.py).
export const CLOCK_MIXER_EFFECTS = {
  4: "Rainbow Flow",
  6: "Spectrum Chase",
  9: "Pastel Pulse",
  10: "Fireworks",
  11: "Monochrome Waves",
  18: "Pulse",
  19: "Solar Flare",
  22: "Prism",
  24: "Ember",
  35: "Color Trails",
  79: "Twinkle",
  39: "Rainbow",
  42: "Ocean Waves",
  17: "Spectrum",
  54: "Sunset",
  56: "Carousel",
  57: "Blue Yellow",
  58: "Ice Blue",
  59: "Blue White",
  61: "Drift",
  70: "Spectrum Bands",
  // Official effects that also support all four directions (mirrors const.py).
  32: "Waterfall",
  15: "Aurora",
  34: "Bonfire",
  55: "Flower Sea",
  80: "Kaleidoscope",
  // Named effects with no direction control still back the clock (no sweep).
  3: "Streamer",
  5: "Starry sky",
  37: "Pinball",
  48: "Tide",
  75: "Magic",
  77: "Wonderland",
  // Hacking, Shooting Star, Building block, and Palette are deliberately
  // omitted: the firmware rejects these mixer/clock combinations.
};

export const CLOCK_MIXER_EFFECT_DIRECTION = "Down";
export const CLOCK_MIXER_EFFECT_SPEED = 50;

// Clock-mixer effects whose firmware clock always renders the background in a
// fixed orientation, ignoring the selected native-effect direction.
export const CLOCK_MIXER_FIXED_DIRECTION = {
  "Spectrum Chase": "Up",
  "Pastel Pulse": "Up",
  "Monochrome Waves": "Left",
  "Solar Flare": "Up",
  Prism: "Right",
  Pulse: "Up",
  "Color Trails": "Right",
  "Spectrum Bands": "Right",
  Drift: "Right",
};

// Built-in clock style id -> firmware mixer (mirrors NATIVE_CLOCK_STYLES 1-15).
export const CLOCK_STYLE_MIXER = {
  1: 39,
  2: 42,
  3: 17,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
  9: 0,
  10: 0,
  11: 54,
  12: 57,
  13: 59,
  14: 58,
  15: 56,
};

// ── Full clock-style registry (mirrors const.py NATIVE_CLOCK_STYLES) ────────
// Base styles 1-15 plus generated experimental styles (every native-effect
// mode not already used as a base mixer). style_id > 10 is experimental and
// requires the "Experimental Features" switch. Solid styles (mixer 0) render a
// fixed colour; effect styles render their mixer effect masked to the glyphs.
const _BASE_CLOCK_STYLES = [
  { id: 1, name: "Rainbow", mixer: 39 },
  { id: 2, name: "Ocean Waves", mixer: 42 },
  { id: 3, name: "Spectrum", mixer: 17 },
  { id: 4, name: "White", mixer: 0 },
  { id: 5, name: "Mint", mixer: 0 },
  { id: 6, name: "Yellow", mixer: 0 },
  { id: 7, name: "Pink", mixer: 0 },
  { id: 8, name: "Red", mixer: 0 },
  { id: 9, name: "Cyan", mixer: 0 },
  { id: 10, name: "Purple", mixer: 0 },
  { id: 11, name: "Sunset", mixer: 54 },
  { id: 12, name: "Blue Yellow", mixer: 57 },
  { id: 13, name: "Blue White", mixer: 59 },
  { id: 14, name: "Ice Blue", mixer: 58 },
  { id: 15, name: "Carousel", mixer: 56 },
];

// firmware mode -> effect name (official + extended), used to name generated
// experimental clock styles exactly like the backend does.
const _MODE_TO_EFFECT_NAME = {
  3: "Streamer",
  5: "Starry sky",
  17: "Spectrum",
  42: "Ocean Waves",
  39: "Rainbow",
  32: "Waterfall",
  15: "Aurora",
  34: "Bonfire",
  37: "Pinball",
  47: "Shooting Star",
  48: "Tide",
  49: "Building block",
  46: "Hacking",
  55: "Flower Sea",
  75: "Magic",
  77: "Wonderland",
  80: "Kaleidoscope",
  81: "Palette",
  4: "Rainbow Flow",
  6: "Spectrum Chase",
  9: "Pastel Pulse",
  10: "Fireworks",
  11: "Monochrome Waves",
  18: "Pulse",
  19: "Solar Flare",
  22: "Prism",
  24: "Ember",
  35: "Color Trails",
  54: "Sunset",
  56: "Carousel",
  57: "Blue Yellow",
  58: "Ice Blue",
  59: "Blue White",
  60: "Spectrum Crumble",
  61: "Drift",
  70: "Spectrum Bands",
  79: "Twinkle",
};

const _BASE_CLOCK_MIXERS = new Set(_BASE_CLOCK_STYLES.map((s) => s.mixer));
// Modes the firmware rejects as a clock mixer (mirrors _NON_CLOCK_EFFECT_MODES).
const _NON_CLOCK_EFFECT_MODES = new Set([60, 46, 47, 49, 81]);
const _NATIVE_CLOCK_EFFECT_ID = 40;

function _buildClockStyles() {
  const styles = _BASE_CLOCK_STYLES.map((s) => ({
    ...s,
    solid: s.mixer === 0,
    experimental: s.id > 10,
  }));
  let nextId = 16;
  for (let mode = 1; mode < 100; mode++) {
    if (
      _BASE_CLOCK_MIXERS.has(mode) ||
      mode === _NATIVE_CLOCK_EFFECT_ID ||
      _NON_CLOCK_EFFECT_MODES.has(mode)
    ) {
      continue;
    }
    const name = _MODE_TO_EFFECT_NAME[mode];
    // Skip unnamed experimental modes (placeholder = the bare mode number): the
    // card only offers styles that were actually named. nextId still advances so
    // the ids of named styles stay aligned with the backend's style_id sequence.
    if (!name) {
      nextId += 1;
      continue;
    }
    styles.push({
      id: nextId,
      name,
      mixer: mode,
      solid: false,
      experimental: true,
    });
    nextId += 1;
  }
  return styles;
}

// Ordered list of every clock style, matching the backend id sequence.
export const CLOCK_STYLES = _buildClockStyles();

const _CLOCK_STYLE_BY_ID = new Map(CLOCK_STYLES.map((s) => [s.id, s]));
const _CLOCK_STYLE_BY_NAME = new Map(CLOCK_STYLES.map((s) => [s.name, s]));

export function clockStyleById(id) {
  return _CLOCK_STYLE_BY_ID.get(id) || null;
}

export function clockStyleByName(name) {
  return _CLOCK_STYLE_BY_NAME.get(name) || null;
}

/** Return the base (non-experimental) clock styles, or all of them. */
export function getClockStyles(includeExperimental) {
  return includeExperimental
    ? CLOCK_STYLES
    : CLOCK_STYLES.filter((s) => !s.experimental);
}

// Default curated styles for the clock card's compact "quick schemes" row.
// Shared with the card's editor so the "reset to defaults" action and the
// card's fallback (when scheme_row_styles is unset) never drift apart.
export const DEFAULT_SCHEME_STYLES = [
  "White",
  "Yellow",
  "Red",
  "Blue White",
  "Blue Yellow",
  "Ice Blue",
  "Sunset",
  "Rainbow",
];

// Resolve the firmware mixer for a set of light attributes (or a style object).
export function clockStyleMixer(attrs) {
  const id = attrs.clock_style_id;
  if (typeof id === "number" && id in CLOCK_STYLE_MIXER)
    return CLOCK_STYLE_MIXER[id];
  if (typeof id === "number") {
    const style = _CLOCK_STYLE_BY_ID.get(id);
    if (style) return style.mixer;
  }
  const nested = attrs.clock_style;
  if (nested && typeof nested.mixer === "number") return nested.mixer;
  if (typeof nested === "string") {
    const byName = _CLOCK_STYLE_BY_NAME.get(nested);
    if (byName) return byName.mixer;
    const match = Object.entries(CLOCK_MIXER_EFFECTS).find(
      ([, effectName]) => effectName === nested,
    );
    if (match) return Number(match[0]);
  }
  return 0;
}

// Basic-font glyph data: each value is a list of positions (row*20+col).
const _CLOCK_FONT = {
  0: [1, 20, 22, 40, 42, 60, 62, 81, 0, 2, 80, 82],
  1: [0, 1, 2, 21, 41, 61, 81, 80],
  2: [0, 1, 2, 20, 41, 62, 80, 81, 82, 42, 40],
  3: [0, 1, 22, 41, 62, 80, 81, 2, 42, 82],
  4: [2, 22, 40, 41, 42, 60, 62, 80, 82],
  5: [0, 1, 22, 40, 41, 60, 80, 81, 82, 2, 42],
  6: [1, 20, 22, 40, 41, 60, 81, 82, 80, 42, 0, 2],
  7: [1, 21, 41, 62, 80, 81, 82],
  8: [1, 20, 22, 41, 60, 62, 81, 0, 2, 80, 82, 40, 42],
  9: [0, 1, 22, 41, 42, 60, 62, 81, 80, 82, 40, 2],
  ":": [20, 60],
  ".": [0],
  " ": [],
};

function _clockGlyphWidth(glyph) {
  return new Set(glyph.map((p) => p % 20)).size;
}

// Columns the cursor advances after a character.  Mirrors layout.char_advance:
// monospace fonts (the firmware "native" clock font) use a fixed advance with
// per-char overrides; otherwise proportional (glyph width + 1 gap).
function _clockCharAdvance(letter, glyph, metrics) {
  if (metrics && metrics.monospace) {
    const ov = metrics.advance_overrides || {};
    return Object.prototype.hasOwnProperty.call(ov, letter)
      ? ov[letter]
      : (metrics.advance ?? 4);
  }
  return _clockGlyphWidth(glyph) + 1;
}

function _clockGradientColor(palette, factor) {
  factor = Math.max(0.0, Math.min(1.0, factor));
  if (palette.length === 1) return palette[0];
  const scaled = factor * (palette.length - 1);
  const idx = Math.min(palette.length - 2, Math.floor(scaled));
  const local = scaled - idx;
  const s = palette[idx],
    e = palette[idx + 1];
  return [
    Math.round(s[0] + (e[0] - s[0]) * local),
    Math.round(s[1] + (e[1] - s[1]) * local),
    Math.round(s[2] + (e[2] - s[2]) * local),
  ];
}

function _clockPixelColor(styleId, charIndex, col) {
  const fixed = {
    2: [0, 221, 255],
    4: [255, 255, 255],
    5: [34, 238, 178],
    6: [255, 238, 0],
    7: [255, 44, 222],
    8: [255, 45, 40],
    9: [0, 222, 255],
    10: [132, 24, 238],
  };
  if (fixed[styleId]) return fixed[styleId];
  if (styleId === 3)
    return [
      [243, 38, 229],
      [43, 120, 255],
      [21, 223, 131],
      [125, 255, 23],
    ][charIndex % 4];
  if (styleId === 12)
    return [
      [70, 132, 255],
      [255, 230, 39],
    ][charIndex % 2];
  const palettes = {
    1: [
      [255, 55, 20],
      [255, 201, 30],
      [44, 238, 88],
      [38, 157, 255],
      [230, 31, 224],
    ],
    11: [
      [255, 93, 19],
      [235, 64, 91],
      [124, 25, 242],
    ],
    13: [
      [35, 92, 230],
      [73, 143, 255],
      [229, 246, 255],
    ],
    14: [
      [25, 143, 255],
      [56, 183, 255],
      [230, 248, 255],
    ],
  };
  return _clockGradientColor(palettes[styleId] || [[255, 238, 0]], col / 19);
}

/**
 * Render one clock frame as 100 [r,g,b] pixels (row-major, row 0 = top).
 * Mirrors _get_clock_preview() in camera.py, including colon blink.
 *
 * `attrs` fields used: clock_style_id, clock_style (name), clock_content,
 * clock_show_date, clock_12_hour, clock_colon_blink, native_effect_direction,
 * and (preview-only) clock_color_rgb -> [r,g,b] override that recolours every
 * lit glyph pixel.
 * `fontMap`/`metrics` come from the Font Characters sensor ("native" font).
 * When absent, falls back to the embedded Basic-style glyphs (proportional).
 */
export function renderClockFrame(attrs, fontMap, metrics, phase = 0) {
  const COLS = 20;
  const now = new Date();
  const tsSec = now.getTime() / 1000;

  // 3-way clock content (byte 0): time | time_date (alternate) | date.
  // Fall back to the legacy show_date boolean for older backends.
  let content = attrs.clock_content;
  if (content !== "time" && content !== "time_date" && content !== "date") {
    content = attrs.clock_show_date ? "time_date" : "time";
  }
  let datePhase;
  if (content === "date") datePhase = true;
  else if (content === "time_date") datePhase = Math.floor(tsSec / 5) % 2 === 1;
  else datePhase = false;

  let text;
  if (datePhase) {
    text =
      String(now.getMonth() + 1).padStart(2, "0") +
      "." +
      String(now.getDate()).padStart(2, "0");
  } else {
    let h = now.getHours();
    if (attrs.clock_12_hour) h = h % 12 || 12;
    text =
      String(h).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");
  }

  const colonVisible = !(
    !datePhase &&
    !!attrs.clock_colon_blink &&
    now.getSeconds() % 2 === 1
  );

  const styleId = attrs.clock_style_id ?? 6;
  // Styles whose mixer is a native effect show that effect through the lit
  // glyph pixels; render it once and mask it below.
  const mixer = clockStyleMixer(attrs);
  const effectName = CLOCK_MIXER_EFFECTS[mixer];
  // The mixer effect flows in the selected native-effect direction, so the
  // preview matches whatever direction was applied to the clock on the lamp.
  const direction =
    CLOCK_MIXER_FIXED_DIRECTION[effectName] ||
    attrs.native_effect_direction ||
    CLOCK_MIXER_EFFECT_DIRECTION;
  const override = Array.isArray(attrs.clock_color_rgb)
    ? attrs.clock_color_rgb
    : null;
  const effectFrame =
    effectName && !override
      ? renderNativeEffect(effectName, phase, direction)
      : null;
  const matrix = Array.from({ length: 100 }, () => [0, 0, 0]);
  const chars = [...text];
  const font = fontMap || _CLOCK_FONT;
  const glyphs = chars.map((c) => font[c] || _CLOCK_FONT[c] || []);
  const advances = glyphs.map((g, i) =>
    _clockCharAdvance(chars[i], g, metrics),
  );
  // Total drawn width = sum of advances minus the trailing gap of the last glyph.
  const totalWidth = Math.max(0, advances.reduce((a, b) => a + b, 0) - 1);
  let offset = Math.max(0, Math.floor((COLS - totalWidth) / 2));

  for (let i = 0; i < chars.length; i++) {
    const advance = advances[i];
    if (chars[i] === ":" && !colonVisible) {
      offset += advance;
      continue;
    }
    for (const pos of glyphs[i]) {
      const col = (pos % COLS) + offset;
      const row = Math.floor(pos / COLS);
      if (col >= 0 && col < COLS && row >= 0 && row < 5) {
        matrix[row * COLS + col] = override
          ? override
          : effectFrame
            ? effectFrame[row * COLS + col]
            : _clockPixelColor(styleId, i, col);
      }
    }
    offset += advance;
  }
  return matrix;
}
