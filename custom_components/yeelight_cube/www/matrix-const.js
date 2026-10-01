/**
 * Matrix preview constants shared by every card (Clock, Native Effects, Lamp
 * Preview, Gradient, Draw and the gallery renderers): black-pixel detection
 * and the on-screen brightness boost applied to LED colors.
 */

// --- Black pixel detection threshold ---
// RGB components all <= this value are considered "black/off"
export const BLACK_THRESHOLD = 10;

// --- Preview brightness boost constants ---
// On LCD screens, low-brightness LED colors appear too dim.
// The perceptual boost makes preview pixels brighter to compensate.
//
// Formula:
//   effective = FLOOR + (1 - FLOOR) * (brightness/255)^GAMMA
//   boost     = effective / darkenFactor
//
// where FLOOR = PREVIEW_MIN_BRIGHTNESS_BOOST * (1 - PREVIEW_MAX_DARKEN_PERCENT/100).
//
// PREVIEW_MIN_BRIGHTNESS_BOOST  – boost multiplier at 0% brightness.
//   Higher = brighter previews at very low brightness.  Default 8.0.
//
// PREVIEW_MAX_DARKEN_PERCENT    – must match Python MAX_DARKEN_PERCENT.
//
// PREVIEW_BRIGHTNESS_GAMMA      – curve shape of the brightness-to-effective
//   mapping.  Controls how quickly the preview dims as lamp brightness drops.
//     < 1.0 : more boost at mid-brightness (looks brighter overall)
//     = 1.0 : linear
//     > 1.0 : less boost at mid-brightness (dims more naturally)
//   Default 1.35 gives a smooth perceptual curve that never overshoots or dips.
export const PREVIEW_MIN_BRIGHTNESS_BOOST = 8.0;
export const PREVIEW_MAX_DARKEN_PERCENT = 94;
export const PREVIEW_BRIGHTNESS_GAMMA = 1.35;

export function previewBrightnessScale(brightness, darkenPercent = 0) {
  const minFactor = 1 - PREVIEW_MAX_DARKEN_PERCENT / 100;
  const darkenFactor = Math.max(minFactor, 1 - darkenPercent / 100);
  const floor = PREVIEW_MIN_BRIGHTNESS_BOOST * minFactor;
  const level = Math.max(0, Math.min(255, Number(brightness) || 0)) / 255;
  return (
    (floor + (1 - floor) * Math.pow(level, PREVIEW_BRIGHTNESS_GAMMA)) /
    darkenFactor
  );
}
