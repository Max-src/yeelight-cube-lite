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

export function matchingClockPreset(styles, attrs) {
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
  return (
    styles.find(
      (style) =>
        style.presetId &&
        style.color.every((channel, index) => channel === color[index]),
    ) || null
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
