/**
 * The native effects' names (const.py, the lamp's own), for the
 * cards: every former name of an effect or clock style, so a card config
 * written with an older name (visible or hidden items, item labels,
 * browser-kept favourites) keeps working.
 * tests/test_native_features.py keeps this equal to const.py.
 */

// The order both cards list effects in when the card editor sets none
// (light._native_effect_catalog): const.py NATIVE_EFFECTS' slots, the official
// effects as the Yeelight app lists them, then every other slot in slot order.
// The clock card lists its effect styles in it too.
export const OFFICIAL_EFFECT_SLOTS = Object.freeze([
  3, 5, 17, 42, 39, 32, 15, 34, 37, 47, 48, 49, 46, 55, 76, 77, 80, 81,
]);

/** An effect's place in that order, by its slot on the lamp. */
export function effectSlotRank(slot) {
  const official = OFFICIAL_EFFECT_SLOTS.indexOf(slot);
  return official >= 0 ? official : OFFICIAL_EFFECT_SLOTS.length + slot;
}

// const.py FORMERLY_NUMBERED_SLOTS: the slots named by their bare number until
// 1.4.0, and their names today.
export const FORMERLY_NUMBERED_EFFECT_NAMES = Object.freeze({
  1: "Two-colour alternation",
  2: "Breathing",
  7: "Dual scan",
  8: "Rotating colour bands",
  14: "Palette trails",
  16: "Drop and bounce",
  20: "Music level glow",
  21: "Stacking blocks",
  23: "Aqua-lime trails",
  25: "Music bars from both ends",
  26: "Music bars from the centre",
  27: "Music bass-mid-treble colour",
  28: "Scrolling bands",
  30: "Music bar from one end",
  31: "Palette cross-fade",
  33: "Rising wisps",
  38: "Sine plotter",
  41: "Music Spectrum",
  43: "Music Gather",
  44: "Music Breathing",
  45: "Music Blossom",
  51: "Music noise equalizer",
  52: "Solid red",
  62: "Dot with fading trail",
  63: "Centre bursts",
  65: "Rainbow fill-in (one-shot)",
  66: "Rainbow wipe-out (one-shot)",
  68: "White fill-in (one-shot)",
  69: "White wipe-out (one-shot)",
  71: "Stored GIF",
  72: "Random scatter",
  73: "Music Note",
  74: "Music Impact",
});


// const.py NATIVE_EFFECT_ALIASES: every former name -> today's, flattened.
// Music Flow has its own names: never looked up here.
export const NATIVE_EFFECT_ALIASES = Object.freeze({
  // Official effects (the names until 1.4.0).
  Streamer: "Ribbon",
  "Starry sky": "Starry Sky",
  "Ocean Waves": "Waves",
  Bonfire: "Fire",
  Pinball: "Bouncing Ball",
  "Shooting Star": "Meteor",
  "Building block": "Building Blocks",
  // Extended effects with a name until 1.4.0.
  "Rainbow Flow": "Moving palette",
  "Spectrum Chase": "Particle path",
  "Pastel Pulse": "Triangular palette pulses",
  "Monochrome Waves": "Sine wave",
  Pulse: "Sunrise and sunset",
  "Solar Flare": "Heat fire",
  Prism: "Mirrored comets",
  Ember: "Palette sparks",
  "Color Trails": "Tide (slot 35)",
  Sunset: "Rainbow noise",
  Carousel: "Violet interference",
  "Blue Yellow": "Night-amber waves",
  "Ice Blue": "Navy-white noise",
  "Blue White": "Night-sky waves",
  "Spectrum Crumble": "Flicker sweep",
  Drift: "Particle glows",
  "Spectrum Bands": "Palette stripes",
  Neon: "Neon sine bands",
  Twinkle: "Violet twinkles",
  // Older names.
  "Color Snakes": "Tide (slot 35)",
  // Slots named by their number until 1.4.0 (76 before Magic took it).
  ...FORMERLY_NUMBERED_EFFECT_NAMES,
  76: "Magic",
});

const hasOwn = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

/** A native effect's name today, from any name it ever had (anything else
 * is returned as it is). */
export function canonicalEffectName(name) {
  return typeof name === "string" && hasOwn(NATIVE_EFFECT_ALIASES, name)
    ? NATIVE_EFFECT_ALIASES[name]
    : name;
}

/** `names` (a config's list of effect or clock style names) in today's names,
 * with `canonical`; the same array when nothing changes. */
export function canonicalNames(names, canonical = canonicalEffectName) {
  if (!Array.isArray(names)) return names;
  const renamed = names.map((name) => canonical(name));
  return renamed.some((name, index) => name !== names[index])
    ? [...new Set(renamed)]
    : names;
}

/** A card's item_labels ({name: label}) keyed by today's names; the same
 * object when nothing changes. A label set on today's name wins. */
export function canonicalLabels(labels, canonical = canonicalEffectName) {
  if (!labels || typeof labels !== "object") return labels;
  const keys = Object.keys(labels);
  if (!keys.some((key) => canonical(key) !== key)) return labels;
  const result = {};
  for (const key of keys) if (canonical(key) === key) result[key] = labels[key];
  for (const key of keys) {
    const name = canonical(key);
    if (name !== key && !(name in result)) result[name] = labels[key];
  }
  return result;
}

// The effects no clock style is named after: the ones that cannot back the
// clock (const.py _NON_CLOCK_EFFECT_MODES: slots 46, 47, 49, 60 and 81).
const NON_CLOCK_EFFECT_NAMES = new Set([
  "Hacking",
  "Meteor",
  "Building Blocks",
  "Flicker sweep",
  "Palette",
]);

// const.py CLOCK_STYLE_ALIASES: a clock style is named after the effect behind
// it, so it was renamed with it. A clock style's key in a card config is a name
// ("custom:<id>" for a saved preset), never a style id.
export const CLOCK_STYLE_ALIASES = Object.freeze(
  Object.fromEntries(
    Object.entries(NATIVE_EFFECT_ALIASES).filter(
      ([, name]) => !NON_CLOCK_EFFECT_NAMES.has(name),
    ),
  ),
);

/** A clock style's name today, from any name it ever had (a saved preset's
 * key, "custom:<id>", and anything else are returned as they are). */
export function canonicalClockStyleName(name) {
  return typeof name === "string" && hasOwn(CLOCK_STYLE_ALIASES, name)
    ? CLOCK_STYLE_ALIASES[name]
    : name;
}

/** A card config (`kind`: "native" or "clock") with the effect or clock style
 * names it lists (visible / hidden items, item labels) in today's names; the
 * same object when nothing changes. */
export function withCanonicalNames(config, kind) {
  if (!config || typeof config !== "object") return config;
  const canonical = kind === "clock" ? canonicalClockStyleName : canonicalEffectName;
  const keys =
    kind === "clock"
      ? ["visible_styles", "hidden_styles", "hidden_clock_styles"]
      : ["visible_effects", "hidden_effects"];
  let result = config;
  for (const key of keys) {
    const names = canonicalNames(config[key], canonical);
    if (names !== config[key]) result = { ...result, [key]: names };
  }
  const labels = canonicalLabels(config.item_labels, canonical);
  if (labels !== config.item_labels) result = { ...result, item_labels: labels };
  return result;
}
