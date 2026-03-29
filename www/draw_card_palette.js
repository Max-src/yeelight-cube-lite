// Palette management helpers for Yeelight Cube Draw Card
import { hexToRgb, rgbToHex } from "./draw_utils.js";

export function savePalette(hass, paletteSensor, colors) {
  if (!hass || !paletteSensor) return;
  const rgbColors = colors.map((c) => hexToRgb(c));
  hass
    .callService("yeelight_cube", "save_palette", { palette: rgbColors })
    .then(() => {
      hass.callService("homeassistant", "update_entity", {
        entity_id: paletteSensor,
      });
    });
}

export function getLampPalette(hass, paletteSensor) {
  if (!hass || !paletteSensor) return [];
  const stateObj = hass.states[paletteSensor];
  if (!stateObj) return [];
  const palettes =
    stateObj.attributes.palettes_v2 || stateObj.attributes.palettes || [];
  if (!Array.isArray(palettes) || palettes.length === 0) return [];
  const colors = palettes[0]?.colors || [];
  return colors.map((c) =>
    Array.isArray(c) && c.length === 3 ? rgbToHex(c) : c
  );
}
