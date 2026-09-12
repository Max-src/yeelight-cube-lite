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

export function clockStylesWithPresets(builtins, presets) {
  return [
    ...builtins,
    ...presets.map((preset) => ({
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
  return {
    style: style.presetId ? "White" : style.name,
    color: style.presetId ? style.color : "clear",
    activate: true,
  };
}
