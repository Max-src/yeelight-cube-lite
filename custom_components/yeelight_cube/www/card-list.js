// The integration's cards (yeelight-cube-<name>-card.js), listed once: the
// integration registers them (__init__.py reads the array below, so it stays
// plain JSON: double quotes, no trailing comma), the frontend diagnostics
// watch them and the tests load them.
export const CARD_NAMES = [
  "lamp-preview",
  "gradient",
  "draw",
  "palette",
  "color-list-editor",
  "clock",
  "native-effects"
];
