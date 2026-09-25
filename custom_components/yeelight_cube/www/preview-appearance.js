export const previewLength = (value) => `calc(100cqw * ${value} / 350)`;

export const APPEARANCE_DEFAULTS = Object.freeze({
  background: "black",
  pixels: "rounded",
  spacing: "normal",
  shadow: false,
  ignoreBlack: false,
});

export const APPEARANCE_PRESETS = Object.freeze({
  classic: { ...APPEARANCE_DEFAULTS, pixels: "circle" },
  light: {
    ...APPEARANCE_DEFAULTS,
    background: "white",
    spacing: "subtle",
    shadow: true,
    ignoreBlack: true,
  },
  square: {
    ...APPEARANCE_DEFAULTS,
    background: "transparent",
    pixels: "square",
    spacing: "none",
    ignoreBlack: true,
  },
});

const fields = {
  background: ["matrix_background", ["black", "white", "transparent"]],
  pixels: ["pixel_style", ["square", "rounded", "circle"]],
  spacing: ["spacing_mode", ["none", "subtle", "normal"]],
  shadow: ["matrix_box_shadow", [true, false]],
  ignoreBlack: ["ignore_black_pixels", [true, false]],
};
const validFields = (values) =>
  Object.fromEntries(
    Object.entries(fields)
      .filter(([field, [, choices]]) => choices.includes(values?.[field]))
      .map(([field]) => [field, values[field]]),
  );

const section = (label, keys, defaults = {}) => ({
  label,
  keys,
  defaults: { ...APPEARANCE_DEFAULTS, pixels: "square", ...defaults },
});
const prefixed = (prefix, label, defaults) =>
  section(
    label,
    {
      background: `${prefix}_matrix_background`,
      pixels: `${prefix}_pixel_style`,
      spacing: `${prefix}_spacing_mode`,
      shadow: `${prefix}_matrix_box_shadow`,
      ignoreBlack: `${prefix}_ignore_black_pixels`,
    },
    defaults,
  );
const gallery = section("Previews", {
  background: "gallery_background_color",
  pixels: "gallery_pixel_style",
  spacing: "gallery_spacing_mode",
  shadow: "gallery_matrix_box_shadow",
  ignoreBlack: "gallery_ignore_black_pixels",
});
const rotary = section("Matrix Preview", {
  background: "matrix_rotary_bg_color",
  pixels: "matrix_rotary_pixel_style",
  spacing: "matrix_rotary_spacing_mode",
  shadow: "matrix_rotary_box_shadow",
  ignoreBlack: "matrix_rotary_ignore_black",
});
export const APPEARANCE_PROFILES = {
  clock: {
    lamp: prefixed("lamp", "Lamp Preview", { pixels: "rounded" }),
    gallery,
    favourites: prefixed("effect", "Favourites"),
  },
  native: {
    lamp: prefixed("lamp", "Lamp Preview"),
    gallery,
    favourites: prefixed("effect", "Favourites"),
  },
  gradient: { gallery, rotary },
  lamp: {
    lamp: section(
      "Lamp Preview",
      {
        background: "matrix_background",
        pixels: "matrix_pixel_style",
        spacing: "matrix_spacing_mode",
        shadow: "matrix_box_shadow",
        ignoreBlack: "hide_black_dots",
      },
      { shadow: true },
    ),
  },
  draw: {
    canvas: section(
      "Drawing Matrix",
      {
        background: "matrix_bg",
        pixels: "matrix_pixel_style",
        spacing: "pixel_spacing_mode",
        shadow: "matrix_box_shadow",
        ignoreBlack: "matrix_ignore_black_pixels",
      },
      { shadow: true },
    ),
    art: section(
      "Pixel Art",
      {
        background: "pixel_art_background_color",
        pixels: "pixel_art_pixel_style",
        spacing: "pixel_art_spacing_mode",
        shadow: "pixel_art_matrix_box_shadow",
        ignoreBlack: "gallery_ignore_black_pixels",
      },
      { background: "transparent" },
    ),
  },
};

export function normalizePreviewAppearance(config = {}, profile = "clock") {
  const schema = APPEARANCE_PROFILES[profile];
  const result = { ...config };
  const stored = config.preview_appearance ?? config.clock_preview_appearance;
  const shared = { ...APPEARANCE_DEFAULTS, ...validFields(stored) };
  const overrides = {};
  for (const [name, definition] of Object.entries(schema)) {
    const values =
      stored != null
        ? validFields(
            (config.preview_overrides ?? config.clock_preview_overrides)?.[
              name
            ],
          )
        : {};
    for (const [field, key] of Object.entries(definition.keys)) {
      if (stored == null) {
        let fallback = definition.defaults[field];
        if (profile === "native" && name !== "gallery") {
          if (field === "pixels") fallback = config.pixel_style || "square";
          if (field === "spacing" && config.pixel_gap === 0) fallback = "none";
        }
        if (
          profile === "draw" &&
          name === "art" &&
          field === "spacing" &&
          config.pixel_art_pixel_spacing === false
        )
          fallback = "none";
        if (
          profile === "draw" &&
          name === "canvas" &&
          field === "spacing" &&
          config.pixel_spacing === false
        )
          fallback = "none";
        if (
          profile === "lamp" &&
          field === "spacing" &&
          config.matrix_pixel_spacing === false
        )
          fallback = "none";
        if (
          profile === "gradient" &&
          field === "spacing" &&
          config[
            name === "rotary"
              ? "matrix_rotary_pixel_spacing"
              : "gallery_pixel_spacing"
          ] === false
        )
          fallback = "none";
        const value = fields[field][1].includes(config[key])
          ? config[key]
          : fallback;
        if (value !== shared[field]) values[field] = value;
      }
      delete result[key];
    }
    if (Object.keys(values).length) overrides[name] = values;
  }
  delete result.clock_preview_appearance;
  delete result.clock_preview_overrides;
  delete result.clock_appearance_presets;
  const presets = config.appearance_presets ?? config.clock_appearance_presets;
  if (presets !== undefined) result.appearance_presets = presets;
  return {
    ...result,
    preview_appearance: shared,
    preview_overrides: overrides,
  };
}

export function resolvePreviewAppearance(config, profile) {
  const result = normalizePreviewAppearance(config, profile);
  for (const [name, definition] of Object.entries(
    APPEARANCE_PROFILES[profile],
  )) {
    const values = {
      ...result.preview_appearance,
      ...result.preview_overrides[name],
    };
    for (const [field, key] of Object.entries(definition.keys))
      result[key] = values[field];
  }
  return result;
}

export function appearancePresets(config) {
  return clockAppearancePresets({
    clock_appearance_presets:
      config.appearance_presets ?? config.clock_appearance_presets,
  });
}

export function clockAppearancePresets(config) {
  const presets = Object.entries(APPEARANCE_PRESETS).map(
    ([id, appearance]) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      appearance: { ...appearance },
      builtin: true,
    }),
  );
  const saved = Array.isArray(config.clock_appearance_presets)
    ? config.clock_appearance_presets
    : [];
  const seen = new Set();
  for (const preset of saved) {
    if (
      typeof preset?.id !== "string" ||
      !preset.id.trim() ||
      seen.has(preset.id) ||
      typeof preset.name !== "string" ||
      !preset.name.trim()
    )
      continue;
    seen.add(preset.id);
    const existing = presets.findIndex((entry) => entry.id === preset.id);
    const normalized = {
      id: preset.id,
      name: preset.name.trim().slice(0, 60),
      appearance: { ...APPEARANCE_DEFAULTS, ...validFields(preset.appearance) },
      builtin: existing >= 0,
      modified: true,
    };
    if (existing >= 0) presets[existing] = normalized;
    else presets.push(normalized);
  }
  return presets;
}

export function normalizeClockAppearance(config) {
  return clockConfigAliases(normalizePreviewAppearance(config, "clock"));
}

function clockConfigAliases(config) {
  const { preview_appearance, preview_overrides, appearance_presets, ...rest } =
    config;
  return {
    ...rest,
    clock_preview_appearance: preview_appearance,
    clock_preview_overrides: preview_overrides,
    ...(appearance_presets !== undefined
      ? { clock_appearance_presets: appearance_presets }
      : {}),
  };
}

export function clockSectionAppearance(config, section) {
  const normalized = normalizeClockAppearance(config);
  return {
    ...normalized.clock_preview_appearance,
    ...normalized.clock_preview_overrides[section],
  };
}

export function resolveClockAppearance(config) {
  return clockConfigAliases(resolvePreviewAppearance(config, "clock"));
}
