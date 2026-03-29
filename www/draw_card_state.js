// State and config helpers for Yeelight Cube Draw Card

export function getInitialMatrix(rows = 5, cols = 20) {
  return Array(rows * cols).fill(null);
}

export function parseConfig(config) {
  return {
    entity: config.entity || "",
    paletteSensor: config.palette_sensor || null,
    showColorPicker: config.show_color_picker !== false,
    showRecentColors: config.show_recent_colors !== false,
    showLampPalette: config.show_lamp_palette !== false,
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
  if (!recentColors.includes(selectedColor)) {
    recentColors.unshift(selectedColor);
    if (recentColors.length > 10) recentColors.pop();
  }
  return recentColors;
}
