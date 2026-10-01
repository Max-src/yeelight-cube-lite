// Small helpers shared by the gradient card and its angle-control and
// mode-selector mixins.

// Angle value displays/inputs inside the rotary: pointer-downs on these never
// start a rotary drag.
export const ANGLE_NO_DRAG_SELECTOR =
  "#angleinput, #angletext, .rotary-overlay-value, .matrix-angle-value, .capsule-angle-slot";

/**
 * Convert gallery_preview_size config value (%) to pixels.
 * Legacy configs stored px values (120-450); new configs store % (30-100).
 * Values > 100 are treated as legacy px; values ≤ 100 are % mapped to px.
 */
export function galleryPreviewSizeToPx(configValue) {
  const v = Number(configValue) || 50;
  if (v > 100) return v; // legacy px value
  return Math.round((v / 100) * 450);
}

/**
 * Shared appearance axis: size.  The same slider (gallery_preview_size)
 * drives preview pixel size AND a text-button scale factor, so "Size" means
 * one thing regardless of the chosen selector style.
 * 50% = 1.0× text scale; clamped to a sane 0.8–1.4 range.
 */
export function resolveSelectorTextScale(cfg) {
  const v = Number(cfg?.gallery_preview_size) || 50;
  const pct = v > 100 ? 50 : v; // legacy px values → neutral scale
  return Math.max(0.8, Math.min(1.4, pct / 50));
}
