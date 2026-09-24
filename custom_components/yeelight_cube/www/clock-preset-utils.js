export function clockColorToRgb(intColor) {
  if (typeof intColor !== "number") return null;
  return [(intColor >> 16) & 0xff, (intColor >> 8) & 0xff, intColor & 0xff];
}

export function clockPresetLibrary(hass) {
  return (
    Object.values(hass?.states || {}).find((state) =>
      Array.isArray(state.attributes?.clock_presets),
    )?.attributes.clock_presets || []
  );
}

export function clockPresetKey(style) {
  if (!style) return null;
  return style.presetId ? `custom:${style.presetId}` : style.name;
}

export function clockColorModeOptions(builtins, presets, config = {}) {
  const all = [
    ...builtins,
    ...clockPresetsByKind(presets, "color_mode").map((preset) => ({
      value: `custom:${preset.id}`,
      label: preset.name,
      color: preset.color,
    })),
    { value: "__pick__", label: "Add", icon: "mdi:plus" },
  ];
  if (!Array.isArray(config.visible_color_modes)) return all;
  const byKey = new Map(all.map((mode) => [mode.value, mode]));
  const ordered = [...new Set(config.visible_color_modes)];
  const hidden = new Set(config.hidden_color_modes || []);
  return [
    ...ordered.map((key) => byKey.get(key)).filter(Boolean),
    ...all.filter(
      (mode) => !ordered.includes(mode.value) && !hidden.has(mode.value),
    ),
  ];
}

export function clockColorModeVisibilityConfig(config, all, visible) {
  return {
    ...config,
    visible_color_modes: [...visible],
    hidden_color_modes: [
      ...new Set([
        ...(config.hidden_color_modes || []),
        ...all.map((mode) => mode.value),
      ]),
    ].filter((key) => !visible.includes(key)),
  };
}

export function clockPresetsByKind(presets, kind = "style") {
  return presets.filter((preset) => (preset.kind || "style") === kind);
}

export function clockColorPresetAction(preset) {
  return { color_mode: "normal", color: [...preset.color] };
}

export function matchingClockColorPreset(presets, attrs) {
  if (
    (attrs.clock_color_mode || "normal") !== "normal" ||
    typeof attrs.clock_color !== "number"
  )
    return null;
  return (
    clockPresetsByKind(presets, "color_mode").find((preset) =>
      preset.color.every(
        (channel, index) =>
          channel === ((attrs.clock_color >> (16 - index * 8)) & 255),
      ),
    ) || null
  );
}

export function clockStylesWithPresets(builtins, presets) {
  return [
    ...builtins,
    ...clockPresetsByKind(presets).map((preset) => ({
      id: 4,
      name: preset.name,
      presetId: preset.id,
      color: preset.color,
      mixer: 0,
      solid: true,
      experimental: false,
    })),
  ];
}

export function visibleClockStyles(styles, config) {
  if (
    config.custom_visible_styles !== true ||
    !Array.isArray(config.visible_styles)
  )
    return styles;
  const byKey = new Map(styles.map((style) => [clockPresetKey(style), style]));
  const hidden = new Set(config.hidden_clock_styles || []);
  const ordered = [...new Set(config.visible_styles)];
  const included = new Set(ordered);
  return [
    ...ordered.map((key) => byKey.get(key)).filter(Boolean),
    ...styles.filter((style) => {
      const key = clockPresetKey(style);
      return style.presetId && !included.has(key) && !hidden.has(key);
    }),
  ];
}

export function clockStyleVisibilityConfig(config, styles, visible) {
  return {
    ...config,
    visible_styles: [...visible],
    hidden_clock_styles: [
      ...new Set([
        ...(config.hidden_clock_styles || []),
        ...styles.filter((style) => style.presetId).map(clockPresetKey),
      ]),
    ].filter((key) => !visible.includes(key)),
  };
}

export function matchingClockPreset(styles, attrs, preferredId) {
  if (
    attrs.clock_style_id != null
      ? attrs.clock_style_id !== 4
      : attrs.clock_style !== "White"
  )
    return null;
  if (typeof attrs.clock_color !== "number") return null;
  const color = [
    (attrs.clock_color >> 16) & 255,
    (attrs.clock_color >> 8) & 255,
    attrs.clock_color & 255,
  ];
  const matches = styles.filter(
    (style) =>
      style.presetId &&
      style.color.every((channel, index) => channel === color[index]),
  );
  return (
    matches.find((style) => style.presetId === preferredId) ||
    matches[0] ||
    null
  );
}

export function clockStyleAction(style) {
  // A preset IS a colour choice, so it sets one explicitly. Any other style
  // switch omits `color` entirely so an active custom override (or "clear")
  // persists across style changes instead of resetting to the style default.
  return style.presetId
    ? { style: "White", color: style.color, activate: true }
    : { style: style.name, activate: true };
}
