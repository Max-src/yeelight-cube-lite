// The color modes the Clock and Native Effects cards offer, by name: a module
// of its own (no imports) so a card that only names them (the gallery's
// badges) does not load the clock renderers (clock-preview-utils.js
// re-exports it).

// The lamp's color-mode palette presets (mirrors effect_catalog.py CLOCK_COLOR_MODES).
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
// The Clock and Native Effects cards' color modes (effect_catalog.py
// NATIVE_COLOR_MODES): the lamp's presets and Palette, the lamp's palette
// (its text_colors).
export const NATIVE_COLOR_MODES = [
  ...CLOCK_COLOR_MODES,
  { value: "palette", label: "Palette", icon: "mdi:palette" },
];
