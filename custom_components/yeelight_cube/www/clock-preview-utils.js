// ============================================================================
//  Shared clock-face software preview
// ============================================================================
//
// Client-side reproduction of the Cube Lite's built-in clock, shared by
// the lamp-preview card and the dedicated clock card so there is a SINGLE
// source of truth for the clock previews (no duplication).
//
// Mirrors Python `camera.py:_get_clock_preview()` / `const.py`. The clock draws
// digit/colon glyphs; styles whose `mixer` is a native effect render
// that effect across the whole panel and let it through only on the lit glyph
// pixels (a mask), so the characters animate with the effect.
//
// Keep the mixer tables and glyph handling in sync with const.py.

import {
  effectOffersColorMode,
  effectSupportsColorOverride,
} from "./native-effect-preview.js";
import { clockStudioRuns, studioClockBackgroundAt, studioDrive, studioRender } from "./lamp-studio.js";
import {
  DEFAULT_EFFECT_SPEED,
  LAMP_EFFECTS,
  chosenIntensity,
  chosenSpeed,
  effectDisplayFrame,
  lampClockSettings,
  clockPaletteWords,
  clockDigitFlags,
  clockDigitTargets,
  CLOCK_DIRECT_BACKGROUNDS,
  lampEffectFrame,
  isLampRendered,
} from "./lamp-renderers.js";
import { flipMatrixVertical, lampTurnsClock } from "./matrix-view.js";
import { effectFamilyOfName } from "./effect-families.js";
import {
  FORMERLY_NUMBERED_EFFECT_NAMES,
  canonicalClockStyleName,
  canonicalEffectName,
  effectSlotRank,
} from "./effect-names.js";

export { canonicalClockStyleName };

// The lamp's color-mode palette presets (mirrors const.py CLOCK_COLOR_MODES).
// Selecting one forces the outer command id so compatible effects re-map their
// palette; "normal" keeps each effect's own colors. Which effects respond is
// verified on hardware (previews are adjusted per effect separately).
export const CLOCK_COLOR_MODES = [
  { value: "normal", label: "Default", icon: "mdi:palette-outline" },
  { value: "bw", label: "Black & White", icon: "mdi:invert-colors" },
  { value: "red_blue", label: "Vivid", icon: "mdi:palette-swatch" },
  {
    value: "white_orange",
    label: "Retro Orange",
    icon: "mdi:palette-swatch",
  },
  { value: "blue_yellow", label: "Tropical", icon: "mdi:palette-swatch" },
  {
    value: "purple_orange",
    label: "Violet & Gold",
    icon: "mdi:palette-swatch",
  },
];
// The Clock and Native Effects cards' color modes (const.py
// NATIVE_COLOR_MODES): the lamp's presets and Palette, the lamp's palette
// (its text_colors).
export const NATIVE_COLOR_MODES = [
  ...CLOCK_COLOR_MODES,
  { value: "palette", label: "Palette", icon: "mdi:palette" },
];

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

const NO_FONT = Object.freeze({ fontMap: null, metrics: null });

/**
 * The bundled "native" clock font (and its metrics) from the integration's
 * Font Characters sensor, so previews use the font the lamp renders.
 *
 * Home Assistant replaces `hass.states` on every state change anywhere, so
 * scanning all entities each time is costly. The sensor's entity id is kept
 * in `cache` (the previous result): later lookups read that one entity, and
 * only rescan when it disappears or changes. Returns the new cache; the font
 * is `cache.font`.
 */
export function lookupNativeClockFont(states, cache) {
  if (!states) return { entityId: null, state: null, states: null, font: NO_FONT };
  if (
    cache &&
    (cache.entityId
      ? states[cache.entityId] === cache.state
      : cache.states === states)
  )
    return cache;
  let entityId = cache?.entityId || null;
  let state = entityId ? states[entityId] : null;
  if (!state?.attributes?.font_maps?.native) {
    entityId = null;
    state = null;
    for (const id in states) {
      if (states[id]?.attributes?.font_maps?.native) {
        entityId = id;
        state = states[id];
        break;
      }
    }
  }
  const attributes = state?.attributes;
  return {
    entityId,
    state,
    // Without a sensor, remember which states object was scanned.
    states: entityId ? null : states,
    font: attributes
      ? {
          fontMap: attributes.font_maps.native,
          metrics: (attributes.font_metrics || {}).native || null,
        }
      : NO_FONT,
  };
}

// Bottom-origin <-> top-origin (matrix-view.js, shared by every preview).
export { flipMatrixVertical };

// Clock styles whose mixer is a native effect: the effect is rendered across
// the whole panel and masked to the lit glyph pixels (mirrors const.py).
export const CLOCK_MIXER_EFFECTS = {
  4: "Moving palette",
  6: "Particle path",
  9: "Triangular palette pulses",
  10: "Fireworks",
  11: "Sine wave",
  18: "Sunrise and sunset",
  19: "Heat fire",
  22: "Mirrored comets",
  24: "Palette sparks",
  35: "Tide (slot 35)",
  79: "Violet twinkles",
  39: "Rainbow",
  42: "Waves",
  17: "Spectrum",
  54: "Rainbow noise",
  56: "Violet interference",
  57: "Night-amber waves",
  58: "Navy-white noise",
  59: "Night-sky waves",
  61: "Particle glows",
  70: "Palette stripes",
  // Official effects that also support all four directions (mirrors const.py).
  32: "Waterfall",
  15: "Aurora",
  34: "Fire",
  55: "Flower Sea",
  80: "Kaleidoscope",
  // Named effects with no direction control still back the clock (no sweep).
  3: "Ribbon",
  5: "Starry Sky",
  37: "Bouncing Ball",
  48: "Tide",
  75: "Neon sine bands",
  76: "Magic",
  77: "Wonderland",
  // The slots named by number until 1.4.0, but the stored GIF (no preview can
  // draw it: a clock over it is sent no palette, as a solid style).
  ...Object.fromEntries(
    Object.entries(FORMERLY_NUMBERED_EFFECT_NAMES).filter(([mode]) => mode !== "71"),
  ),
  // Hacking, Meteor, Building Blocks, and Palette are deliberately
  // omitted: the lamp rejects these mixer/clock combinations.
};

// The speed when a lamp reports none (const.py's default).
export const DEFAULT_CLOCK_SPEED = DEFAULT_EFFECT_SPEED;

/** The rate the lamp's clock background runs at: previews take it as it is. */
export const clockSpeed = (attrs) => chosenSpeed(attrs);

/** The phase of `seconds` of animation at a speed (renderClockFrame's). */
export const clockPhase = (seconds, speed) => seconds * (0.25 + speed / 55);

// Built-in clock style id -> the lamp's mixer (mirrors NATIVE_CLOCK_STYLES 1-15).
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
// mode not already used as a base mixer). style_id > 10 is experimental (the
// cards' badge); all are offered. Solid styles (mixer 0) render a
// fixed color; effect styles render their mixer effect masked to the glyphs.
const _BASE_CLOCK_STYLES = [
  { id: 1, name: "Rainbow", mixer: 39 },
  { id: 2, name: "Waves", mixer: 42 },
  { id: 3, name: "Spectrum", mixer: 17 },
  { id: 4, name: "White", mixer: 0 },
  { id: 5, name: "Mint", mixer: 0 },
  { id: 6, name: "Yellow", mixer: 0 },
  { id: 7, name: "Pink", mixer: 0 },
  { id: 8, name: "Red", mixer: 0 },
  { id: 9, name: "Cyan", mixer: 0 },
  { id: 10, name: "Purple", mixer: 0 },
  { id: 11, name: "Rainbow noise", mixer: 54 },
  { id: 12, name: "Night-amber waves", mixer: 57 },
  { id: 13, name: "Night-sky waves", mixer: 59 },
  { id: 14, name: "Navy-white noise", mixer: 58 },
  { id: 15, name: "Violet interference", mixer: 56 },
];

// lamp mode -> effect name (official + extended), used to name generated
// experimental clock styles exactly like the backend does.
const _MODE_TO_EFFECT_NAME = {
  3: "Ribbon",
  5: "Starry Sky",
  17: "Spectrum",
  42: "Waves",
  39: "Rainbow",
  32: "Waterfall",
  15: "Aurora",
  34: "Fire",
  37: "Bouncing Ball",
  47: "Meteor",
  48: "Tide",
  49: "Building Blocks",
  46: "Hacking",
  55: "Flower Sea",
  75: "Neon sine bands",
  76: "Magic",
  77: "Wonderland",
  80: "Kaleidoscope",
  81: "Palette",
  4: "Moving palette",
  6: "Particle path",
  9: "Triangular palette pulses",
  10: "Fireworks",
  11: "Sine wave",
  18: "Sunrise and sunset",
  19: "Heat fire",
  22: "Mirrored comets",
  24: "Palette sparks",
  35: "Tide (slot 35)",
  54: "Rainbow noise",
  56: "Violet interference",
  57: "Night-amber waves",
  58: "Navy-white noise",
  59: "Night-sky waves",
  60: "Flicker sweep",
  61: "Particle glows",
  70: "Palette stripes",
  79: "Violet twinkles",
  // The slots named by number until 1.4.0, but the stored GIF for now: the card
  // does not offer a style over it (the clock style selector does).
  ...Object.fromEntries(
    Object.entries(FORMERLY_NUMBERED_EFFECT_NAMES).filter(([mode]) => mode !== "71"),
  ),
};

const _BASE_CLOCK_MIXERS = new Set(_BASE_CLOCK_STYLES.map((s) => s.mixer));
// A style shows its effect through the digits, so it has that effect's family;
// a solid style is a fixed color.
const _clockFamily = (name, mixer) =>
  mixer ? effectFamilyOfName(_MODE_TO_EFFECT_NAME[mixer] ?? name) : "still";
// const.py CLOCK_FORM_TWINS: a background that looks different in each form.
// Its style over the hand-over is named for that look; a style over the
// direct form, added after the others, shows the effect.
const _CLOCK_FORM_TWINS = {
  22: ["Comet stream", "Mirrored comets"],
  51: ["Music flipped equalizer", "Music noise equalizer"],
};
// Modes the lamp rejects as a clock mixer (mirrors _NON_CLOCK_EFFECT_MODES).
const _NON_CLOCK_EFFECT_MODES = new Set([60, 46, 47, 49, 81]);
const _NATIVE_CLOCK_EFFECT_ID = 40;

function _buildClockStyles() {
  const styles = _BASE_CLOCK_STYLES.map((s) => ({
    ...s,
    family: _clockFamily(s.name, s.mixer),
    solid: s.mixer === 0,
    experimental: s.id > 10,
  }));
  let nextId = 16;
  for (let mode = 1; mode < 82; mode++) {
    if (
      _BASE_CLOCK_MIXERS.has(mode) ||
      mode === _NATIVE_CLOCK_EFFECT_ID ||
      _NON_CLOCK_EFFECT_MODES.has(mode)
    ) {
      continue;
    }
    const name = _MODE_TO_EFFECT_NAME[mode];
    // A dead end (or the stored GIF, not offered for now) has no style here,
    // but takes its id all the same, so the ids of the others stay aligned
    // with the backend's style_id sequence.
    if (!name) {
      nextId += 1;
      continue;
    }
    const twin = _CLOCK_FORM_TWINS[mode];
    styles.push({
      id: nextId,
      name: twin ? twin[0] : name,
      mixer: mode,
      family: _clockFamily(name, mode),
      solid: false,
      experimental: true,
      ...(twin ? { direct: false } : {}),
    });
    nextId += 1;
  }
  for (const [mode, [, name]] of Object.entries(_CLOCK_FORM_TWINS)) {
    styles.push({
      id: nextId,
      name,
      mixer: Number(mode),
      family: _clockFamily(name, Number(mode)),
      solid: false,
      experimental: true,
      direct: true,
    });
    nextId += 1;
  }
  return styles;
}

// Ordered list of every clock style, matching the backend id sequence.
export const CLOCK_STYLES = _buildClockStyles();

/**
 * Whether a clock style's background reads a setting shared with the effects
 * ("speed", "intensity", the effect's flag): a solid style reads neither
 * (light_native.shown_effect_reads for the clock).
 */
export function clockStyleTakes(style, setting) {
  const effect = CLOCK_MIXER_EFFECTS[style?.mixer];
  return !!(effect && LAMP_EFFECTS[effect]?.[setting]);
}

const _CLOCK_STYLE_BY_ID = new Map(CLOCK_STYLES.map((s) => [s.id, s]));
const _CLOCK_STYLE_BY_NAME = new Map(CLOCK_STYLES.map((s) => [s.name, s]));

export function clockStyleByName(name) {
  return _CLOCK_STYLE_BY_NAME.get(canonicalClockStyleName(name)) || null;
}

// The order the cards list the styles in (when the card editor sets none):
// the styles over an effect in the effect card's order (effect-names.js
// effectSlotRank), so both cards list an effect at the same place, then the
// plain colours (then the custom styles, clockStylesWithPresets).
const _cardRank = (style) => (style.solid ? Infinity : effectSlotRank(style.mixer));
const _CARD_ORDER = [...CLOCK_STYLES].sort(
  (first, second) =>
    _cardRank(first) - _cardRank(second) || first.id - second.id,
);
/** Every clock style, in the cards' order. */
export function getClockStyles() {
  return _CARD_ORDER;
}

export function clockStyleColorModeState(style, mode, override = null) {
  if (!style || !NATIVE_COLOR_MODES.some((option) => option.value === mode))
    return "unknown";
  if (mode === "normal") return "unchanged";
  const known =
    _CLOCK_STYLE_BY_ID.get(style.id) || _CLOCK_STYLE_BY_NAME.get(style.name);
  if (!known && !style.presetId) return "unknown";
  // The palette: a plain style takes its first color, a background its
  // colors, on the lamp (clockPaletteWords) or streamed (lamp-studio.js).
  // Saved presets keep theirs, as under Custom.
  if (mode === "palette") {
    if (style.presetId) return "unchanged";
    if (known.mixer === 0) return "responds";
  }
  const mixer = style.presetId ? 0 : known.mixer;
  if (mixer === 0) {
    if (mode !== "bw") return "unchanged";
    const color = style.presetId ? style.color : override;
    const alreadyWhite = Array.isArray(color)
      ? color.every((channel) => channel === 255)
      : known?.name === "White";
    return alreadyWhite ? "unchanged" : "responds";
  }
  const effect = CLOCK_MIXER_EFFECTS[mixer];
  return effect
    ? effectOffersColorMode(effect, mode)
      ? "responds"
      : "unchanged"
    : "unknown";
}

// A custom RGB override behaves like a color mode: solid styles flat-fill with
// it, color-supporting effects recolor toward it, and other effects ignore
// it (mirrors renderClockFrame). Saved presets are fixed-color styles (like
// Yellow/Mint) — they belong under Normal/B&W, not the free Custom mode.
export function clockStyleRespondsToCustomColor(style) {
  if (!style) return false;
  if (style.presetId) return false;
  const known =
    _CLOCK_STYLE_BY_ID.get(style.id) || _CLOCK_STYLE_BY_NAME.get(style.name);
  if (!known) return false;
  if (known.mixer === 0) return true;
  const effect = CLOCK_MIXER_EFFECTS[known.mixer];
  return effect ? effectSupportsColorOverride(effect) : false;
}

// What a preview draws behind the clock: CLOCK_MIXER_EFFECTS's effect.
export const clockPreviewEffect = (mixer) => CLOCK_MIXER_EFFECTS[mixer];

/** Whether the style of `attrs` runs its background as itself under the clock
 * overlay (const.py clock_style_direct): its own `direct`, else null (by its
 * background, lampClockSettings). */
export function clockStyleDirect(attrs) {
  const id = attrs.clock_style_id;
  const style =
    (typeof id === "number" && _CLOCK_STYLE_BY_ID.get(id)) ||
    (typeof attrs.clock_style === "string" &&
      _CLOCK_STYLE_BY_NAME.get(canonicalClockStyleName(attrs.clock_style))) ||
    (typeof attrs.clock_style?.name === "string" && _CLOCK_STYLE_BY_NAME.get(attrs.clock_style.name));
  return style?.direct ?? null;
}

// Resolve the lamp's mixer for a set of light attributes (or a style object).
// Whether a clock style's background is an effect the lamp draws itself.
export const clockUsesLampRenderer = (attrs) =>
  isLampRendered(clockPreviewEffect(clockStyleMixer(attrs)));

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
    const byName = _CLOCK_STYLE_BY_NAME.get(canonicalClockStyleName(nested));
    if (byName) return byName.mixer;
    const effect = canonicalEffectName(nested);
    const match = Object.entries(CLOCK_MIXER_EFFECTS).find(
      ([, effectName]) => effectName === effect,
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
// monospace fonts (the lamp's own "native" clock font) use a fixed advance with
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
 * clock_show_date, clock_12_hour, clock_colon_blink,
 * clock_color_mode, and a custom color override supplied either as a decoded
 * clock_color_rgb -> [r,g,b] or the raw clock_color ARGB integer the
 * lamp exposes (decoded here like camera.py). The override recolors every lit
 * glyph pixel of compatible styles.
 * `fontMap`/`metrics` come from the Font Characters sensor ("native" font).
 * When absent, falls back to the embedded Basic-style glyphs (proportional).
 * `phase` is clockPhase's, at the lamp's speed (attrs.native_effect_speed), or
 * at `speed` when given.
 */
export function renderClockFrame(attrs, fontMap, metrics, phase = 0, speed = null) {
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
  const effectName = clockPreviewEffect(mixer);
  // Preview callers may supply either a decoded [r,g,b] (clock_color_rgb) or the
  // raw ARGB integer the lamp exposes as clock_color; decode the
  // latter exactly like camera.py so every card renders the same override.
  const override = Array.isArray(attrs.clock_color_rgb)
    ? attrs.clock_color_rgb
    : typeof attrs.clock_color === "number"
      ? [
          (attrs.clock_color >> 16) & 0xff,
          (attrs.clock_color >> 8) & 0xff,
          attrs.clock_color & 0xff,
        ]
      : null;
  // A palette color mode (e.g. B&W) takes precedence over the custom override.
  let colorMode = attrs.clock_color_mode || "normal";
  let paletteColor = null;
  // Palette with more colors than the background takes on the lamp: streamed,
  // the background recolored in the whole palette (camera.py, light_studio.py).
  const streamed = clockStudioRuns(effectName, colorMode, attrs.text_colors);
  if (colorMode === "palette" && !streamed) {
    // The palette's first color on a plain style; its colors on a background
    // that takes them (lampClockSettings); else as the normal mode (camera.py).
    const words = clockPaletteWords(effectName, attrs.text_colors);
    if (!effectName && words.length)
      paletteColor = [(words[0] >> 16) & 255, (words[0] >> 8) & 255, words[0] & 255];
    if (!words.length) colorMode = "normal";
  }
  const modeActive = colorMode !== "normal" && colorMode !== "palette";
  // The mixer's renderer behind the clock overlay, on the command the lamp gets
  // (light_native): it takes the color or not as on the lamp. Styles with no
  // effect fall back to the flat override color.
  const rate = speed ?? clockSpeed(attrs);
  const effectFrame = streamed
    ? effectDisplayFrame(
        effectName,
        studioDrive(
          studioClockBackgroundAt(
            effectName, studioRender(phase / (0.25 + rate / 55)), rate, chosenIntensity(attrs),
            attrs.text_colors, clockStyleDirect(attrs),
          ),
        ),
      )
    : effectName
    ? effectDisplayFrame(
        effectName,
        lampEffectFrame(
          lampClockSettings(
            effectName, rate, override, colorMode, chosenIntensity(attrs), attrs.text_colors,
            clockStyleDirect(attrs),
          ),
          phase / (0.25 + rate / 55),
        ),
      )
    : null;
  // A palette mode overrides the custom color, so don't flat-fill with it.
  const flatOverride = modeActive ? null : paletteColor || override;
  // Solid styles (no mixer effect) have no animated renderer to remap for B&W;
  // the backend achieves it by omitting their color, which the lamp
  // renders as plain white.
  const soloBwFallback = !effectFrame && colorMode === "bw";
  const digitFlags = clockDigitFlags(
    mixer,
    clockStyleDirect(attrs) ?? CLOCK_DIRECT_BACKGROUNDS.has(mixer),
  );
  // On a mount profile that turns the clock, the lamp lays the text out a
  // half turn round; the background stays where it is on the panel.
  const turned = lampTurnsClock(attrs);
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
        // Where the lamp draws it: a background started directly may turn or
        // mirror the digits (clockDigitFlags).
        const at = row * COLS + col;
        for (const index of clockDigitTargets(turned ? 99 - at : at, digitFlags)) {
          matrix[index] = effectFrame
            ? effectFrame[index]
            : soloBwFallback
              ? [255, 255, 255]
              : flatOverride
                ? flatOverride
                : _clockPixelColor(styleId, i, col);
        }
      }
    }
    offset += advance;
  }
  return matrix;
}
