// Values of the shared slider (slider-control-utils.js): the 1-100 slider
// percent and the lamp's device values, the text shown for a value, and the
// render config (gc) kept to safe shapes. Plain functions, no DOM.
import { escapeHtml } from "./html-escape-utils.js";

/** Which host methods slider markup may call (see bindHostEvents). */
export const isSliderHandler = (name) => /^_sl[A-Za-z]*$/.test(name);

/** The wheel style names: "bars" / "mesh" draw the mesh, others the ticks. */
export function resolveWheelStyle(style) {
  return style === "bars" || style === "mesh" ? "mesh" : "ticks";
}

// The range every slider style works in (its inputs, its drawing and its
// live updates): one source, so what a style draws and what it updates to
// never disagree.
export const SLIDER_MIN = 0;
export const SLIDER_MAX = 100;
const SLIDER_SPAN = SLIDER_MAX - SLIDER_MIN;

/** The position (%) along a style's track of a slider value. */
export const capsulePercent = (value) => ((value - SLIDER_MIN) / SLIDER_SPAN) * 100;

// ── Device value ↔ 1-100 percent ────────────────────────────────────────────
// One linear, endpoint-exact and mutually-inverse mapping so every card turns
// the SAME device value into the SAME percentage (e.g. speed 50 → 20% on every
// card, not 20% on one and 19% on another). The sliders always operate in the
// 0-100 space; these convert to/from the device's raw range (0-255) only for
// the command payload and the optional raw display. A device value above the
// range's minimum never reads 0 %.
export function sliderPctToRaw(pct, min, max) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return Math.max(min, Math.min(max, Math.round(min + (p * (max - min)) / 100)));
}

export function sliderRawToPct(raw, min, max) {
  const r = Math.max(min, Math.min(max, Number(raw) || 0));
  const pct = Math.round(((r - min) * 100) / (max - min));
  return Math.max(r > min ? 1 : 0, Math.min(100, pct));
}

// The lamp's device ranges. Cards convert through the helpers below instead of
// retyping a range or a formula, so every card (and the raw-value display)
// reads the same device value as the same percentage.
// Brightness 0 turns the lamp off (Home Assistant's light.turn_on does), 1 %
// is the lamp's lowest level. Every effect takes speed 0; intensity 0 is
// raised for the few effects with a minimum (lamp-renderers.js lampIntensity).
export const BRIGHTNESS_RAW = Object.freeze({ min: 0, max: 255 }); // HA brightness
export const SPEED_RAW = Object.freeze({ min: 0, max: 255 }); // const.py SPEED_RANGE
export const INTENSITY_RAW = Object.freeze({ min: 0, max: 255 }); // const.py INTENSITY_RANGE

export const brightnessPctToRaw = (pct) =>
  sliderPctToRaw(pct, BRIGHTNESS_RAW.min, BRIGHTNESS_RAW.max);
export const brightnessRawToPct = (raw) =>
  sliderRawToPct(raw, BRIGHTNESS_RAW.min, BRIGHTNESS_RAW.max);
export const speedPctToRaw = (pct) =>
  sliderPctToRaw(pct, SPEED_RAW.min, SPEED_RAW.max);
export const speedRawToPct = (raw) =>
  sliderRawToPct(raw, SPEED_RAW.min, SPEED_RAW.max);
export const intensityPctToRaw = (pct) =>
  sliderPctToRaw(pct, INTENSITY_RAW.min, INTENSITY_RAW.max);
export const intensityRawToPct = (raw) =>
  sliderRawToPct(raw, INTENSITY_RAW.min, INTENSITY_RAW.max);

// True when a gc should display the device's raw value instead of a percent.
export function sliderRawMode(gc) {
  return (
    gc.valueMode === "raw" &&
    Number.isFinite(gc.rawMin) &&
    Number.isFinite(gc.rawMax)
  );
}

// The exact device value for a 1-100 value: prefer the real device value when
// the shown percent still represents it (so 128 reads 128, not 129, despite the
// 100-step slider); while dragging (pct differs) fall back to the linear map.
export function sliderRawValue(pct, gc) {
  const derived = sliderPctToRaw(pct, gc.rawMin, gc.rawMax);
  return Number.isFinite(gc.rawValue) &&
    sliderRawToPct(gc.rawValue, gc.rawMin, gc.rawMax) === pct
    ? Math.round(Math.max(gc.rawMin, Math.min(gc.rawMax, gc.rawValue)))
    : derived;
}

// Card configuration reaches the slider markup (class names, inline styles,
// text), and a dashboard config can come from anywhere (pasted YAML). Keep
// every value to its expected shape so none can break out of the HTML:
// class-name tokens, finite numbers, a CSS color, and escaped text.
const SLIDER_TOKEN_KEYS = [
  "style",
  "theme",
  "barFill",
  "variant",
  "wheelStyle",
  "rotaryStyle",
  "matrixPixelStyle",
  "matrixDir",
  "capsuleVariant",
  "valueMode",
  "ends",
];
const SLIDER_NUMBER_KEYS = [
  "width",
  "thickness",
  "wheelStep",
  "matrixCols",
  "matrixRows",
  "stepSize",
];
const SLIDER_TEXT_KEYS = ["unit", "rawUnit", "iconLeft", "iconRight"];
export const TOKEN_PATTERN = /^[a-z0-9_-]+$/i;
// A color lands inside style="--brightness-color: …;". Rather than listing
// every CSS color syntax (var() with fallbacks, color-mix(), oklch(), deg
// units, ...), allow only the characters colors use: no quotes, <>, ;, :,
// braces or backslashes means the value cannot leave the declaration, and
// url()/expression()/image() are refused outright.
const CSS_COLOR_PATTERN = /^[\w#(),.%\s/+-]+$/;
const CSS_COLOR_FORBIDDEN = /(url|expression|image|element)\s*\(/i;

export function sanitizeSliderGc(gc = {}) {
  const safe = { ...gc };
  for (const key of SLIDER_TOKEN_KEYS)
    if (safe[key] != null && !TOKEN_PATTERN.test(String(safe[key])))
      delete safe[key];
  for (const key of SLIDER_NUMBER_KEYS) {
    if (safe[key] == null) continue;
    // An empty value means "not set" (Number("") would be 0).
    if (String(safe[key]).trim() === "") {
      delete safe[key];
      continue;
    }
    const number = Number(safe[key]);
    if (Number.isFinite(number)) safe[key] = number;
    else delete safe[key];
  }
  if (safe.color != null) {
    const color = String(safe.color).trim();
    if (
      !color ||
      !CSS_COLOR_PATTERN.test(color) ||
      CSS_COLOR_FORBIDDEN.test(color)
    )
      delete safe.color;
    else safe.color = color;
  }
  for (const key of SLIDER_TEXT_KEYS)
    if (safe[key] != null) safe[key] = escapeHtml(String(safe[key]));
  return safe;
}

// The text shown for a 1-100 value, honouring the percent/raw display toggle.
export function formatSliderValue(pct, gc) {
  return sliderRawMode(gc)
    ? `${sliderRawValue(pct, gc)}${gc.rawUnit ?? ""}`
    : `${pct}${gc.unit ?? "%"}`;
}
