// State and config helpers for Yeelight Cube Lite Draw Card

export function parseConfig(config) {
  return {
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

/** Recent colors as stored: lowercase strings, each color once (whatever
 * its case, the first kept), at most 10. A new array (Lit sees the change). */
export function normalizeRecentColors(colors) {
  const seen = new Set();
  for (const color of colors)
    if (typeof color === "string" && color) seen.add(color.toLowerCase());
  return [...seen].slice(0, 10);
}

/** The recent colors with `color` first. */
export function updateRecentColors(recentColors, color) {
  if (typeof color !== "string" || !color) return recentColors;
  return normalizeRecentColors([color, ...recentColors]);
}
