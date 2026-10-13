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
import { renderModeSettingsSection } from "./editor_ui_utils.js";
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
  const g = (k, d) => (config[k] !== undefined ? config[k] : d);
  const bg = (key, choices, current, extra = "") =>
    html`<div class="form-row">
      <label>${extra}</label>
      ${createButtonGroup(
        choices,
        current,
        createButtonGroupChangeHandler(key, (v) => onChange(key, v)),
      )}
    </div>`;
  const colorRow = (label, key, fallback) => html`
    <div class="form-row">
      <label>${label}</label>
      <input
        type="color"
        .value="${g(key, fallback)}"
        @click="${(event) => handleColorPickerClick(event)}"
        @input="${(e) => onChange(key, e.target.value)}"
        style="width:60px;height:32px;border:none;cursor:pointer;border-radius:6px;"
      />
    </div>
  `;

  const style = g(K.style, "slider");
  const thickness = opts.thickness ?? g(K.thickness, 6);

  // Per-style conditional options — each grouped in the shared blue block.
  let modeSection = "";
  if (style === "slider") {
    modeSection = renderModeSettingsSection(
      "Slider Settings",
      bg(
        K.variant,
        [
          { value: "thin", label: "Thin" },
          { value: "thick", label: "Thick" },
        ],
        g(K.variant, "thin"),
        html`<span>Slider Variant</span>`,
      ),
    );
  } else if (style === "bar") {
    modeSection = renderModeSettingsSection(
      "Bar Settings",
      bg(
        K.barFill,
        [
          { value: "solid", label: "Solid" },
          { value: "pulse", label: "Pulse" },
          { value: "stripes", label: "Stripes" },
          { value: "gloss", label: "Gloss" },
        ],
        g(K.barFill, "solid"),
        html`<span>Bar Fill</span>`,
      ),
    );
  } else if (style === "wheel") {
    modeSection = renderModeSettingsSection(
      "Wheel Settings",
      html`
        ${bg(
          K.wheelStyle,
          [
            { value: "ticks", label: "Classic" },
            { value: "mesh", label: "Mesh" },
          ],
          resolveWheelStyle(g(K.wheelStyle, "ticks")),
          html`<span>Wheel Style</span>`,
        )}
        ${createToggleRow(
          "Show Wheel Labels",
          K.wheelLabels,
          g(K.wheelLabels, true) !== false,
          (e) => onChange(K.wheelLabels, e.target.checked),
        )}
        ${createSliderRow(
          "Wheel Step",
          g(K.wheelStep, 10),
          { min: 5, max: 50, step: 5 },
          (e) => onChange(K.wheelStep, parseInt(e.target.value, 10)),
          "%",
        )}
      `,
    );
  } else if (style === "matrix") {
    modeSection = renderModeSettingsSection(
      "Matrix Settings",
      html`
        ${createSliderRow(
          "Matrix Columns",
          g(K.matrixCols, 10),
          { min: 3, max: 20, step: 1 },
          (e) => onChange(K.matrixCols, parseInt(e.target.value, 10)),
          "",
        )}
        ${createSliderRow(
          "Matrix Rows",
          g(K.matrixRows, 2),
          { min: 1, max: 6, step: 1 },
          (e) => onChange(K.matrixRows, parseInt(e.target.value, 10)),
          "",
        )}
        ${bg(
          K.matrixDir,
          [
            { value: "row", label: "Row" },
            { value: "col", label: "Column" },
          ],
          g(K.matrixDir, "row"),
          html`<span>Fill Direction</span>`,
        )}
        ${bg(
          K.matrixPixelStyle,
          [
            { value: "square", label: "Square" },
            { value: "rounded", label: "Rounded" },
            { value: "round", label: "Round" },
          ],
          g(K.matrixPixelStyle, "rounded"),
          html`<span>Pixel Shape</span>`,
        )}
        ${opts.matrixColorKey
          ? colorRow("Matrix Color", opts.matrixColorKey, "#ff9800")
          : ""}
      `,
    );
  } else if (style === "rotary") {
    modeSection = renderModeSettingsSection(
      "Rotary Settings",
      bg(
        K.rotaryStyle,
        [
          { value: "glow", label: "Glow" },
          { value: "gloss", label: "Gloss" },
          { value: "thick", label: "Thick" },
          { value: "dial", label: "Dial" },
        ],
        g(K.rotaryStyle, "glow"),
        html`<span>Rotary Style</span>`,
      ),
    );
  } else if (style === "capsule") {
    const valueDisplay = g(K.valueDisplay, "text");
    modeSection = renderModeSettingsSection(
      "Capsule Settings",
      html`
        ${bg(
          K.valueDisplay,
          [
            { value: "none", label: "None" },
            { value: "text", label: "Text" },
            { value: "input", label: "Input" },
          ],
          valueDisplay,
          html`<span>Value Display</span>`,
        )}
        ${valueDisplay !== "none"
          ? bg(
              K.valueSide,
              [
                { value: "under", label: "Under" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ],
              g(K.valueSide, "under"),
              html`<span>Value Side</span>`,
            )
          : ""}
        ${opts.icons && K.iconLeftShow
          ? createToggleRow(
              opts.icons.leftLabel,
              K.iconLeftShow,
              g(K.iconLeftShow, true) !== false,
              (e) => onChange(K.iconLeftShow, e.target.checked),
            )
          : ""}
        ${opts.icons && K.iconRightShow
          ? createToggleRow(
              opts.icons.rightLabel,
              K.iconRightShow,
              g(K.iconRightShow, true) !== false,
              (e) => onChange(K.iconRightShow, e.target.checked),
            )
          : ""}
        ${createToggleRow(
          "Snap to Positions",
          K.snap,
          g(K.snap, false) === true,
          (e) => onChange(K.snap, e.target.checked),
        )}
        ${bg(
          K.capsuleVariant,
          [
            { value: "thin", label: "Thin" },
            { value: "thick", label: "Thick" },
          ],
          g(K.capsuleVariant, "thin"),
          html`<span>Track Style</span>`,
        )}
      `,
    );
  }

  const stepButtonsOn = g(K.stepButtons, false) === true;

  return html`
    ${opts.showValueToggle && style !== "capsule"
      ? createToggleRow(
          opts.showValueToggle.label,
          opts.showValueToggle.key,
          g(opts.showValueToggle.key, true) !== false,
          (e) => onChange(opts.showValueToggle.key, e.target.checked),
        )
      : ""}
    ${opts.rawValueToggle
      ? createToggleRow(
          opts.rawValueToggle.label,
          opts.rawValueToggle.key,
          g(opts.rawValueToggle.key, false) === true,
          (e) => onChange(opts.rawValueToggle.key, e.target.checked),
        )
      : ""}
    ${bg(K.style, STYLE_CHOICES, style, html`<span>Slider Style</span>`)}
    ${createSliderRow(
      "Control Width",
      g(K.width, 100),
      { min: 30, max: 100, step: 5 },
      (e) => onChange(K.width, parseInt(e.target.value, 10)),
      "%",
    )}
    ${createToggleRow(
      "Card background",
      K.theme,
      g(K.theme, "subtle") !== "flat",
      (e) => onChange(K.theme, e.target.checked ? "subtle" : "flat"),
    )}
    ${modeSection}
    ${createToggleRow("Step Buttons", K.stepButtons, stepButtonsOn, (e) =>
      onChange(K.stepButtons, e.target.checked),
    )}
    ${stepButtonsOn
      ? renderModeSettingsSection(
          "Step Button Settings",
          html`
            ${createSliderRow(
              "Step Size",
              g(K.stepSize, 5),
              { min: 1, max: 25, step: 1 },
              (e) => onChange(K.stepSize, parseInt(e.target.value, 10)),
              "%",
            )}
            ${bg(
              K.stepPosition,
              [
                { value: "below", label: "Below" },
                { value: "sides", label: "Sides" },
              ],
              g(K.stepPosition, "below"),
              html`<span>Step Position</span>`,
            )}
          `,
        )
      : ""}
    ${createSliderRow(
      "Track Thickness",
      thickness,
      { min: 2, max: 10, step: 1 },
      (e) => onChange(K.thickness, parseInt(e.target.value, 10)),
      "px",
    )}
  `;
}
