// The editor settings of the shared slider (slider-control-utils.js), as a
// Lit template, in one order for every card: which sliders (the card's own
// toggles, then Grey out unused), the style and its own options, the value,
// the ends and steps, then the size. Imported by the card editors only, so the
// cards never load the editor helpers.
import { html } from "./lib/lit-all.js";
import { handleColorPickerClick } from "./color-picker-utils.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
} from "./button-group-utils.js";
import { createSliderRow, createToggleRow } from "./form-row-utils.js";
import { renderSettingsBox } from "./editor_ui_utils.js";
import {
  GREY_OUT_UNUSED_KEY,
  defaultSliderEnds,
  sliderKeys,
  sliderStyleFeatures,
  withSliderOptions,
} from "./slider-control-utils.js";
import { resolveWheelStyle } from "./slider-values.js";

const STYLE_CHOICES = [
  { value: "slider", label: "Slider" },
  { value: "bar", label: "Bar" },
  { value: "wheel", label: "Wheel" },
  { value: "matrix", label: "Matrix" },
  { value: "rotary", label: "Rotary" },
  { value: "capsule", label: "Capsule" },
];

// Editor block for a lamp brightness/speed/intensity slider (the counterpart
// of lightSliderConfig). `options.keys` selects a card's key map; any other
// option (see renderSliderSettings) is added or replaces a default. A card
// whose sliders are always used (Lamp Preview: brightness) passes
// `unusedToggle: null`.
export function renderLightSliderSettings(
  config,
  onChange,
  { keys = sliderKeys("slider"), ...options } = {},
) {
  return renderSliderSettings(config, keys, onChange, {
    unusedToggle: {
      label: "Grey out unused sliders (instead of hiding them)",
      key: GREY_OUT_UNUSED_KEY,
    },
    ...options,
  });
}

/**
 * Render the full slider settings block for a card editor, as a Lit
 * template. A style's own options are wrapped in the shared blue "mode
 * settings" block. Older options are shown as today's (withSliderOptions).
 *
 * @param {Object} config  - the editor config object
 * @param {Object} K       - key map (from sliderKeys(prefix))
 * @param {Function} onChange - (key, value) => void
 * @param {Object} [opts]   - extra, consumer-specific controls:
 *   - unusedToggle: { label, key }     grey out sliders the content does not
 *                                      use instead of hiding them
 *                                      (sliderWhenUsed)
 *   - matrixColorKey: string           color picker inside the Matrix block
 */
export function renderSliderSettings(config, K, onChange, opts = {}) {
  config = withSliderOptions(config, K);
  const value = (key, fallback) =>
    config[key] !== undefined ? config[key] : fallback;
  const style = value(K.style, "slider");
  const features = sliderStyleFeatures(style);
  const view = { config, K, onChange, opts, value };
  const settings = STYLE_SETTINGS[style];
  const row = (r) => settingRow(view, r);
  return html`
    ${opts.unusedToggle
      ? row(toggle(() => opts.unusedToggle.key, opts.unusedToggle.label, false))
      : ""}
    ${row(choice("style", "Slider Style", STYLE_CHOICES, "slider"))}
    ${settings
      ? renderSettingsBox(
          settings.title,
          html`${settings.rows.map(row)}`,
        )
      : ""}
    ${row(choice("value", "Value", VALUE_CHOICES, "percent"))}
    ${features.ends
      ? row(choice("ends", "Ends", END_CHOICES, defaultSliderEnds(style)))
      : ""}
    ${row(range("stepSize", "Step Size", 5, { min: 1, max: 25, step: 1 }, "%"))}
    ${row(toggle("snap", "Snap to Positions", false))}
    ${features.compact
      ? ""
      : row(range("width", "Control Width", 100, { min: 30, max: 100, step: 5 }, "%"))}
    ${row(choice("thickness", "Thickness", THICKNESS_CHOICES, "medium"))}
    ${features.compact
      ? ""
      : createToggleRow(
          "Card background",
          K.theme,
          value(K.theme, "subtle") !== "flat",
          (e) => onChange(K.theme, e.target.checked ? "subtle" : "flat"),
        )}
  `;
}

// ── The settings as data ──────────────────────────────────────────────────
// A row names its option by the key map's field (K[field]), or by a function
// of the view (an option the card passes); `when` hides it.

const choice = (field, label, choices, fallback, read = (v) => v) => ({
  kind: "choice", field, label, choices, fallback, read,
});
const toggle = (field, label, fallback) => ({ kind: "toggle", field, label, fallback });
const range = (field, label, fallback, bounds, unit) => ({
  kind: "range", field, label, fallback, bounds, unit,
});
const when = (shown, row) => ({ ...row, shown });

// The merged settings' choices (slider-control-utils.js SLIDER_VALUE_MODES,
// SLIDER_ENDS, SLIDER_THICKNESS).
const VALUE_CHOICES = [
  { value: "none", label: "None" },
  { value: "percent", label: "%" },
  { value: "raw", label: "Device units" },
];
// Each end steps the value by the step size when tapped.
const END_CHOICES = [
  { value: "none", label: "None" },
  { value: "icons", label: "Icons" },
  { value: "plus_minus", label: "➖ ➕" },
];
const THICKNESS_CHOICES = [
  { value: "thin", label: "Thin" },
  { value: "medium", label: "Medium" },
  { value: "thick", label: "Thick" },
];

// Each style's own settings (the blue section under the style choice); the
// Slider and Capsule have none beyond the shared ones.
const STYLE_SETTINGS = {
  bar: {
    title: "Bar Settings",
    rows: [
      choice("barFill", "Bar Fill", [
        { value: "solid", label: "Solid" },
        { value: "pulse", label: "Pulse" },
        { value: "stripes", label: "Stripes" },
        { value: "gloss", label: "Gloss" },
      ], "solid"),
    ],
  },
  wheel: {
    title: "Wheel Settings",
    rows: [
      choice("wheelStyle", "Wheel Style", [
        { value: "ticks", label: "Classic" },
        { value: "mesh", label: "Mesh" },
      ], "ticks", resolveWheelStyle),
      toggle("wheelLabels", "Show Wheel Labels", true),
    ],
  },
  matrix: {
    title: "Matrix Settings",
    rows: [
      range("matrixCols", "Matrix Columns", 10, { min: 3, max: 20, step: 1 }, ""),
      range("matrixRows", "Matrix Rows", 2, { min: 1, max: 6, step: 1 }, ""),
      choice("matrixDir", "Fill Direction", [
        { value: "row", label: "Row" },
        { value: "col", label: "Column" },
      ], "row"),
      choice("matrixPixelStyle", "Pixel Shape", [
        { value: "square", label: "Square" },
        { value: "rounded", label: "Rounded" },
        { value: "round", label: "Round" },
      ], "rounded"),
      // Only the cards that let the user pick the slider color.
      when((view) => !!view.opts.matrixColorKey, {
        kind: "color", field: (view) => view.opts.matrixColorKey, label: "Matrix Color", fallback: "#ff9800",
      }),
    ],
  },
  rotary: {
    title: "Rotary Settings",
    rows: [
      choice("rotaryStyle", "Rotary Style", [
        { value: "glow", label: "Glow" },
        { value: "gloss", label: "Gloss" },
        { value: "thick", label: "Thick" },
        { value: "dial", label: "Dial" },
      ], "glow"),
    ],
  },
};

// One row: a button group, a toggle, a slider or a color picker.
function settingRow(view, row) {
  if (row.shown && !row.shown(view)) return "";
  const key = typeof row.field === "function" ? row.field(view) : view.K[row.field];
  const label = typeof row.label === "function" ? row.label(view) : row.label;
  const current = view.value(key, row.fallback);
  switch (row.kind) {
    case "choice":
      return html`<div class="form-row">
        <label>${html`<span>${label}</span>`}</label>
        ${createButtonGroup(
          row.choices,
          row.read(current),
          createButtonGroupChangeHandler(key, (v) => view.onChange(key, v)),
        )}
      </div>`;
    case "toggle":
      // On by default: anything but false; off by default: only true.
      return createToggleRow(
        label,
        key,
        row.fallback ? current !== false : current === true,
        (e) => view.onChange(key, e.target.checked),
      );
    case "range":
      return createSliderRow(
        label,
        current,
        row.bounds,
        (e) => view.onChange(key, parseInt(e.target.value, 10)),
        row.unit,
      );
    case "color":
      return html`
        <div class="form-row">
          <label>${label}</label>
          <input
            type="color"
            .value="${current}"
            @click="${(event) => handleColorPickerClick(event)}"
            @input="${(e) => view.onChange(key, e.target.value)}"
            style="width:60px;height:32px;border:none;cursor:pointer;border-radius:6px;"
          />
        </div>
      `;
    default:
      return "";
  }
}
