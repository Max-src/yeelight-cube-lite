// The effect settings a lamp reports (speed, intensity), as the previews and
// the renderers read them: a module of its own (no imports) so a card that
// only reads them does not load the renderers (lamp-renderers.js re-exports
// it).

// effect_catalog.py DEFAULT_NATIVE_EFFECT_SPEED, DEFAULT_NATIVE_EFFECT_INTENSITY,
// SPEED_RANGE, INTENSITY_RANGE and UNDIRECTED_EFFECT_DIRECTION.
export const DEFAULT_EFFECT_SPEED = 128;
export const DEFAULT_EFFECT_INTENSITY = 128;
export const SPEED_RANGE = Object.freeze({ min: 0, max: 255 });
export const INTENSITY_RANGE = Object.freeze({ min: 0, max: 255 });
export const UNDIRECTED_EFFECT_DIRECTION = 0;

/** The intensity chosen on a lamp (its native_effect_intensity attribute), the
 * default when it reports none. Previews pass it on as the lamp gets it: only
 * the effects that read it change. */
export const chosenIntensity = (attrs) =>
  lampSetting(attrs?.native_effect_intensity, INTENSITY_RANGE, DEFAULT_EFFECT_INTENSITY);

/** The speed chosen on a lamp (its native_effect_speed attribute, 0-255),
 * the default when it reports none. */
export const chosenSpeed = (attrs) =>
  lampSetting(attrs?.native_effect_speed, SPEED_RANGE, DEFAULT_EFFECT_SPEED);

// A reported setting in its range; 0 is a value, only a missing one defaults.
function lampSetting(value, { min, max }, fallback) {
  const n = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}
