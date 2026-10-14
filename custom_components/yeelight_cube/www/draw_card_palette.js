// Palette management helpers for Yeelight Cube Lite Draw Card
import { hexToRgbOrBlack } from "./draw_utils.js";

/**
 * Save `colors` as a named palette, then refresh the palette sensor.
 * `call(domain, service, data)` sends one service call (the card's command
 * queue); it rejects if either call fails so the caller can report it.
 */
export async function savePalette(
  call,
  paletteSensor,
  colors,
  entityId = null,
  name = null,
) {
  if (!call || !paletteSensor) return;
  const rgbColors = colors.map((c) => hexToRgbOrBlack(c));
  const serviceData = { palette: rgbColors };
  if (name) serviceData.name = name;
  if (entityId) {
    serviceData.entity_id = entityId;
  }
  await call("yeelight_cube", "save_palette", serviceData);
  await call("homeassistant", "update_entity", {
    entity_id: paletteSensor,
  });
}
