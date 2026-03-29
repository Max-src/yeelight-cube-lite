// Shared palette sensor utilities for Yeelight Cube cards

export function getPalettesFromSensor(hass, paletteSensorId) {
  if (!hass || !paletteSensorId || !hass.states[paletteSensorId]) {
    console.warn("[PaletteUtils] Palette sensor not found", paletteSensorId);
    return [];
  }
  const stateObj = hass.states[paletteSensorId];
  const palettes = stateObj.attributes.palettes_v2 || [];
  return palettes;
}

export function forcePaletteSensorUpdate(hass, paletteSensorId) {
  if (!hass || !paletteSensorId) return;
  // ...removed console.log...
  return hass.callService("homeassistant", "update_entity", {
    entity_id: paletteSensorId,
  });
}

export function logPaletteAction(action, details) {
  // ...removed console.log...
}
