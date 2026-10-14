// The editor settings of the shared slider (slider-control-utils.js): the
// style, its options and the step buttons, as a Lit template. Imported by the
// card editors only, so the cards never load the editor helpers.
import { html } from "./lib/lit-all.js";
import { handleColorPickerClick } from "./color-picker-utils.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
} from "./button-group-utils.js";
import { createSliderRow, createToggleRow } from "./form-row-utils.js";
import { renderSettingsBox } from "./editor_ui_utils.js";
import { sliderKeys } from "./slider-control-utils.js";
import { resolveWheelStyle } from "./slider-values.js";

const STYLE_CHOICES = [
  { value: "slider", label: "Slider" },
  { value: "bar", label: "Bar" },
  { value: "wheel", label: "Wheel" },
  { value: "matrix", label: "Matrix" },
  { value: "rotary", label: "Rotary" },
  { value: "capsule", label: "Capsule" },
];

// Editor block for a lamp brightness/speed slider (the counterpart of
// lightSliderConfig). `options.keys` selects a card's key map; any other
// option (see renderSliderSettings) is added or replaces a default.
export function renderLightSliderSettings(
  config,
  onChange,
  { keys = sliderKeys("slider"), ...options } = {},
) {
  return renderSliderSettings(config, keys, onChange, {
    icons: { leftLabel: "Show Left Icon", rightLabel: "Show Right Icon" },
    showValueToggle: { label: "Show Value", key: keys.showValue },
    rawValueToggle: {
      label: "Show Raw Value (device units)",
      key: "slider_show_raw_value",
    },
    ...options,
  });
}

/**
 * Render the full slider settings block (all style options + per-style
 * sub-settings) for a card editor, as a Lit template. Every conditional group
 * (per-style options, step-button options) is wrapped in the shared blue
 * "mode settings" block so conditional settings are visually grouped.
 *
 * @param {Object} config  - the editor config object
 * @param {Object} K       - key map (from sliderKeys(prefix) or custom)
 * @param {Function} onChange - (key, value) => void
 * @param {Object} [opts]   - extra, consumer-specific controls:
 *   - showValueToggle: { label, key }  top-level toggle (non-capsule styles)
 *   - matrixColorKey: string           color picker inside the Matrix block
 *   - icons: { leftLabel, rightLabel } capsule icon show/hide toggles
 *                                      (uses K.iconLeftShow / K.iconRightShow)
 *   - thickness: number                override the displayed track thickness
 */
export function renderSliderSettings(config, K, onChange, opts = {}) {
  const value = (key, fallback) =>
    config[key] !== undefined ? config[key] : fallback;
  const style = value(K.style, "slider");
  const view = { config, K, onChange, opts, value };
  const stepButtonsOn = value(K.stepButtons, false) === true;
  const settings = STYLE_SETTINGS[style];
  return html`
    ${opts.showValueToggle && style !== "capsule"
      ? settingRow(view, toggle(() => opts.showValueToggle.key, opts.showValueToggle.label, true))
      : ""}
    ${opts.rawValueToggle
      ? settingRow(view, toggle(() => opts.rawValueToggle.key, opts.rawValueToggle.label, false))
      : ""}
    ${settingRow(view, choice("style", "Slider Style", STYLE_CHOICES, "slider"))}
    ${settingRow(view, range("width", "Control Width", 100, { min: 30, max: 100, step: 5 }, "%"))}
    ${createToggleRow(
      "Card background",
      K.theme,
      value(K.theme, "subtle") !== "flat",
      (e) => onChange(K.theme, e.target.checked ? "subtle" : "flat"),
    )}
    ${settings
      ? renderSettingsBox(
          settings.title,
          html`${settings.rows.map((row) => settingRow(view, row))}`,
        )
      : ""}
    ${settingRow(view, toggle("stepButtons", "Step Buttons", false))}
    ${stepButtonsOn
      ? renderSettingsBox(
          "Step Button Settings",
          html`
            ${settingRow(view, range("stepSize", "Step Size", 5, { min: 1, max: 25, step: 1 }, "%"))}
            ${settingRow(view, choice("stepPosition", "Step Position", STEP_POSITIONS, "below"))}
          `,
        )
      : ""}
    ${createSliderRow(
      "Track Thickness",
      opts.thickness ?? value(K.thickness, 6),
      { min: 2, max: 10, step: 1 },
      (e) => onChange(K.thickness, parseInt(e.target.value, 10)),
      "px",
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

const STEP_POSITIONS = [
  { value: "below", label: "Below" },
  { value: "sides", label: "Sides" },
];

// Each style's own settings (the blue section under the style choice).
const STYLE_SETTINGS = {
  slider: {
    title: "Slider Settings",
    rows: [
      choice("variant", "Slider Variant", [
        { value: "thin", label: "Thin" },
        { value: "thick", label: "Thick" },
      ], "thin"),
    ],
  },
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
      range("wheelStep", "Wheel Step", 10, { min: 5, max: 50, step: 5 }, "%"),
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
  capsule: {
    title: "Capsule Settings",
    rows: [
      choice("valueDisplay", "Value Display", [
        { value: "none", label: "None" },
        { value: "text", label: "Text" },
        { value: "input", label: "Input" },
      ], "text"),
      when(
        (view) => view.value(view.K.valueDisplay, "text") !== "none",
        choice("valueSide", "Value Side", [
          { value: "under", label: "Under" },
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ], "under"),
      ),
      // The icons' toggles: for the cards that pass their labels.
      when(
        (view) => !!(view.opts.icons && view.K.iconLeftShow),
        { kind: "toggle", field: "iconLeftShow", label: (view) => view.opts.icons.leftLabel, fallback: true },
      ),
      when(
        (view) => !!(view.opts.icons && view.K.iconRightShow),
        { kind: "toggle", field: "iconRightShow", label: (view) => view.opts.icons.rightLabel, fallback: true },
      ),
      toggle("snap", "Snap to Positions", false),
      choice("capsuleVariant", "Track Style", [
        { value: "thin", label: "Thin" },
        { value: "thick", label: "Thick" },
      ], "thin"),
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
