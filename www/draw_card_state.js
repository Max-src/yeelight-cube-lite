// State and config helpers for Yeelight Cube Lite Draw Card

export function getInitialMatrix(rows = 5, cols = 20) {
  return Array(rows * cols).fill(null);
}

export function parseConfig(config) {
  // Resolve primary entity: prefer target_entities[0], fall back to legacy entity
  const targetEntities = config.target_entities || [];
  const primaryEntity =
    targetEntities.length > 0 ? targetEntities[0] : config.entity || "";
  return {
    entity: primaryEntity,
    paletteSensor: config.palette_sensor || null,
    showColorPicker: config.show_color_picker !== false,
    showRecentColors: config.show_recent_colors !== false,
    showLampPalette: config.show_lamp_palette !== false,
    showLampColors: config.show_lamp_colors !== false,
    showImagePalette: config.show_image_palette !== false,
    showEraserTool: config.show_eraser_tool !== false,
    showFillTool: config.show_fill_tool !== false,
    showCard: config.show_card_background !== false,
    showSend: config.show_send_button !== false,
    showClear: config.show_clear_button !== false,
    showSave: config.show_save_button !== false,
    showUpload: config.show_upload_image_button !== false,
    drawWithSquares: config.draw_with_squares === true,
    cardTitle: typeof config.title === "string" ? config.title : "",
  };
}

export function updateRecentColors(recentColors, selectedColor) {
  if (!selectedColor) return recentColors;
  // Return a NEW array — never mutate the caller's array (breaks LitElement change detection)
  const filtered = recentColors.filter((c) => c !== selectedColor);
  const updated = [selectedColor, ...filtered];
  return updated.slice(0, 10);
}
