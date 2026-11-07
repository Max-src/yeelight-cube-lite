// The Lamp Preview card's color adjustments as color math, the same as
// color_adjustments.py (the integration applies them to the pixels it sends
// and to the animations it uploads): for the previews of those animations.
// Python's own rounding (halves to even) and colorsys, so both draw the same.

// The light's preview_<name> attributes, in the order they apply, with their
// defaults (no change).
export const ADJUSTMENT_DEFAULTS = Object.freeze({
  hue_shift: 0,
  temperature: 0,
  saturation: 100,
  vibrance: 100,
  contrast: 100,
  glow: 0,
  grayscale: 0,
  tint_hue: 0,
  tint_strength: 0,
  invert: 0,
});

/** The adjustments of `values` (name -> value) that change a color, as
 * color_adjustments.active_adjustments: an empty object when none does. */
export function activeAdjustments(values = {}) {
  const active = {};
  for (const [name, fallback] of Object.entries(ADJUSTMENT_DEFAULTS)) {
    const value = Math.trunc(Number(values?.[name]));
    if (values?.[name] != null && Number.isFinite(value) && value !== fallback)
      active[name] = value;
  }
  if (!active.tint_strength) delete active.tint_hue;
  return active;
}

/** The adjustments a light's attributes set (its preview_<name> values). */
export function adjustmentsOf(attrs = {}) {
  const values = {};
  for (const name of Object.keys(ADJUSTMENT_DEFAULTS))
    values[name] = attrs?.[`preview_${name}`];
  return activeAdjustments(values);
}

/** A stable key for a set of adjustments ("" for none). */
export function adjustmentsKey(adjustments) {
  if (!adjustments) return "";
  return Object.keys(ADJUSTMENT_DEFAULTS)
    .filter((name) => adjustments[name] != null)
    .map((name) => `${name}=${adjustments[name]}`)
    .join(",");
}

// Python's round(): halves to even.
function pyRound(x) {
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest < 0.5) return floor;
  if (rest > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Python's x % 1.0 for a float.
function unitMod(x) {
  const rest = x % 1;
  return rest < 0 ? rest + 1 : rest;
}

// colorsys.rgb_to_hsv / hsv_to_rgb.
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (min === max) return [0, 0, max];
  const range = max - min;
  const s = range / max;
  const rc = (max - r) / range;
  const gc = (max - g) / range;
  const bc = (max - b) / range;
  let h;
  if (r === max) h = bc - gc;
  else if (g === max) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  return [unitMod(h / 6), s, max];
}

function hsvToRgb(h, s, v) {
  if (s === 0) return [v, v, v];
  let i = Math.trunc(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  i %= 6;
  return [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i];
}

const toRgb = (unit) => unit.map((channel) => pyRound(channel * 255));
const clamp = (value) => Math.max(0, Math.min(255, value));

/** `rgb` ([r, g, b]) with `adjustments` applied (color_adjustments.adjust_color).
 * Black stays black: it is the background, off pixels. */
export function adjustColor(rgb, adjustments = {}) {
  let [r, g, b] = rgb;
  if (r === 0 && g === 0 && b === 0) return [0, 0, 0];
  const get = (name, fallback) => adjustments[name] ?? fallback;

  const hueShift = get("hue_shift", 0);
  if (hueShift) {
    const [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255);
    [r, g, b] = toRgb(hsvToRgb(unitMod(h + hueShift / 360), s, v));
  }
  const temperature = get("temperature", 0);
  if (temperature) {
    const factor = Math.abs(temperature) / 100;
    if (temperature > 0) {
      r = pyRound(r + (255 - r) * factor * 0.3);
      g = pyRound(g + (255 - g) * factor * 0.1);
      b = pyRound(b * (1 - factor * 0.3));
    } else {
      r = pyRound(r * (1 - factor * 0.3));
      g = pyRound(g * (1 - factor * 0.1));
      b = pyRound(b + (255 - b) * factor * 0.3);
    }
  }

  const saturation = get("saturation", 100);
  if (saturation !== 100) {
    let [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255);
    s = Math.max(0, Math.min(1, s * (saturation / 100)));
    [r, g, b] = toRgb(hsvToRgb(h, s, v));
  }
  const vibrance = get("vibrance", 100);
  if (vibrance !== 100) {
    let [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255);
    if (s > 0) {
      const weight = (1 - s) ** 0.5;
      s = Math.max(0, Math.min(1, s * (1 + (vibrance / 100 - 1) * weight)));
    }
    [r, g, b] = toRgb(hsvToRgb(h, s, v));
  }

  const contrast = get("contrast", 100);
  if (contrast !== 100) {
    const factor = contrast / 100;
    [r, g, b] = [r, g, b].map((channel) =>
      clamp(pyRound(((channel / 255 - 0.5) * factor + 0.5) * 255)),
    );
  }
  const glow = get("glow", 0);
  if (glow > 0) {
    const luminosity = (r + g + b) / 3;
    if (luminosity > 127) {
      const factor = (luminosity / 255) * (glow / 100);
      r = pyRound(r + (255 - r) * factor);
      g = pyRound(g + (255 - g) * factor);
      b = pyRound(b + (255 - b) * factor);
    }
  }

  const grayscale = get("grayscale", 0);
  if (grayscale > 0) {
    const factor = grayscale / 100;
    const gray = pyRound(0.299 * r + 0.587 * g + 0.114 * b);
    [r, g, b] = [r, g, b].map((channel) =>
      clamp(pyRound(channel * (1 - factor) + gray * factor)),
    );
  }
  const strength = get("tint_strength", 0);
  if (strength > 0) {
    const tint = toRgb(hsvToRgb(get("tint_hue", 0) / 360, 1, 1));
    const factor = strength / 100;
    [r, g, b] = [r, g, b].map((channel, index) =>
      pyRound(channel * (1 - factor) + tint[index] * factor),
    );
  }
  const invert = get("invert", 0);
  if (invert > 0) {
    const factor = invert / 100;
    [r, g, b] = [r, g, b].map((channel) =>
      pyRound(channel * (1 - factor) + (255 - channel) * factor),
    );
  }
  return [clamp(r), clamp(g), clamp(b)];
}
