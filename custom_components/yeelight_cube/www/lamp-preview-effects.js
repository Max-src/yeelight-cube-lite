// Colour adjustment effects of the lamp preview card: the effects and
// sections registry, their state attributes and default values.

// Clock-face preview (mixer tables, glyph font and renderClockFrame) now lives
// in the shared ./clock-preview-utils.js module, imported above.

// ==============  EFFECTS REGISTRY  ==============
// Single source of truth for all effect metadata.
// All effect definitions throughout this card derive from these two tables.
// To add/remove/change an effect, edit ONLY here.

export const EFFECTS_REGISTRY = {
  hue_shift: {
    label: "Hue Shift",
    icon: "🔄",
    min: -180,
    max: 180,
    default: 0,
    unit: "°",
    hint: null,
  },
  temperature: {
    label: "Temperature",
    icon: "🌡️",
    min: -100,
    max: 100,
    default: 0,
    unit: "",
    hint: "Cool ❄ → Warm",
  },
  saturation: {
    label: "Saturation",
    icon: "🎨",
    min: 0,
    max: 200,
    default: 100,
    unit: "",
    hint: null,
  },
  vibrance: {
    label: "Vibrance",
    icon: "💥",
    min: 0,
    max: 200,
    default: 100,
    unit: "",
    hint: "Smart saturation",
  },
  contrast: {
    label: "Contrast",
    icon: "◐",
    min: 0,
    max: 200,
    default: 100,
    unit: "",
    hint: null,
  },
  glow: {
    label: "Glow",
    icon: "✨",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: "Boost bright pixels",
  },
  grayscale: {
    label: "Grayscale",
    icon: "⬜",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: null,
  },
  invert: {
    label: "Invert",
    icon: "🔃",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: null,
  },
  tint_hue: {
    label: "Tint Hue",
    icon: "🎯",
    min: 0,
    max: 360,
    default: 0,
    unit: "°",
    hint: "Color for tint",
  },
  tint_strength: {
    label: "Tint Strength",
    icon: "💧",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: "Tint intensity",
  },
};

export const SECTIONS_REGISTRY = [
  {
    id: "color_adjustments",
    title: "Color",
    icon: "🎨",
    description: "Hue and tone",
    effects: ["hue_shift", "temperature"],
  },
  {
    id: "saturation_intensity",
    title: "Intensity",
    icon: "💎",
    description: "Color richness",
    effects: ["saturation", "vibrance"],
  },
  {
    id: "tone_contrast",
    title: "Tone",
    icon: "🌓",
    description: "Light/dark balance",
    effects: ["contrast", "glow"],
  },
  {
    id: "special_effects",
    title: "Effects",
    icon: "✨",
    description: "Creative transforms",
    effects: ["grayscale", "invert", "tint_hue", "tint_strength"],
  },
];

export const EFFECT_NAMES = Object.keys(EFFECTS_REGISTRY);

// Derived lookup tables (computed once at load time)
export const EFFECT_ATTR_MAP = Object.fromEntries(
  Object.keys(EFFECTS_REGISTRY).map((name) => [name, `preview_${name}`]),
);

export const EFFECT_DEFAULTS = Object.fromEntries(
  Object.entries(EFFECTS_REGISTRY).map(([name, def]) => [name, def.default]),
);
