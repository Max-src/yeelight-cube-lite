/**
 * The editor rows of the shared swatches (<yc-swatches>), the same in every
 * editor with swatches (Draw's color sections, the Palettes gallery). They
 * edit the shared option names:
 *   swatch_layout, swatch_shape, swatch_expand_style,
 *   swatch_blinds_direction, swatch_free_pick, color_info_display
 * `options`:
 *   defaults    { layout, shape } the card's defaults
 *   selectable  the card picks colors from its swatches: the picking
 *               options (free pick, color info) are offered
 *   sizeKey     the card's option for the size of its colors (px; every
 *               display follows it). Cards whose colors follow another
 *               size, like the gallery's Size, leave it out.
 */
import { html } from "./lib/lit-all.js";
import { createButtonGroup } from "./button-group-utils.js";
import { createButtonGroupRow, createSliderRow, createToggleRow } from "./form-row-utils.js";
import { renderSettingsBox } from "./editor_ui_utils.js";
import { swatchLayoutGroup } from "./swatch-utils.js";

const GROUP_CHOICES = [
  { value: "swatches", label: "Swatches" },
  { value: "gradient", label: "Gradient" },
  { value: "stripes", label: "Stripes" },
  { value: "fill", label: "Fill" },
  { value: "honeycomb", label: "Honeycomb" },
  { value: "blinds", label: "Blinds" },
  { value: "treemap", label: "Treemap" },
];
const SWATCH_ARRANGEMENTS = [
  { value: "row", label: "Row" },
  { value: "grid", label: "Grid" },
  { value: "expand", label: "Expandable" },
  { value: "scroll", label: "Scroll" },
  { value: "fan", label: "Fan" },
  { value: "wave", label: "Wave" },
  { value: "spiral", label: "Spiral" },
];
const SHAPE_CHOICES = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "round", label: "Circle" },
];

/** The swatches' settings rows. onChange(key, value) stores an option. */
export function renderSwatchSettings(config, onChange, options = {}) {
  const { defaults = {}, selectable = false, sizeKey = null } = options;
  const layout = config.swatch_layout || defaults.layout || "row";
  const group = swatchLayoutGroup(layout);
  const choices = (label, key, items, value) =>
    createButtonGroupRow(
      label,
      createButtonGroup(items, value, (event) =>
        onChange(key, event.currentTarget.dataset.value),
      ),
    );
  const shapeRow = choices(
    group === "swatches" ? "Swatch Shape" : "Tick Shape",
    "swatch_shape",
    SHAPE_CHOICES,
    config.swatch_shape || defaults.shape || "round",
  );
  const freePick = createToggleRow(
    "Free Pick (any color of the blend)",
    "swatch_free_pick",
    config.swatch_free_pick === true,
    (event) => onChange("swatch_free_pick", event.target.checked),
  );
  let groupSettings = "";
  if (group === "swatches")
    groupSettings = html`
      ${choices("Arrangement", "swatch_layout", SWATCH_ARRANGEMENTS, layout)}
      ${shapeRow}
      ${layout === "expand"
        ? choices(
            "Expand Button",
            "swatch_expand_style",
            [
              { value: "pill", label: "Pill (+N)" },
              { value: "chevron", label: "Chevron" },
              { value: "dots", label: "Dots" },
            ],
            config.swatch_expand_style || "pill",
          )
        : ""}
    `;
  else if (group === "gradient" && selectable)
    groupSettings = html`${shapeRow}${freePick}`;
  else if (group === "fill" && selectable) groupSettings = html`${shapeRow}${freePick}`;
  else if (group === "blinds")
    groupSettings = choices(
      "Blinds Direction",
      "swatch_blinds_direction",
      [
        { value: "rows", label: "Horizontal" },
        { value: "columns", label: "Vertical" },
        { value: "diagonal-right", label: "Diagonal ╲" },
        { value: "diagonal-left", label: "Diagonal ╱" },
      ],
      config.swatch_blinds_direction || "rows",
    );
  const groupLabel = GROUP_CHOICES.find((choice) => choice.value === group).label;
  return html`
    ${createButtonGroupRow(
      "Colors Display",
      createButtonGroup(GROUP_CHOICES, group, (event) => {
        const next = event.currentTarget.dataset.value;
        // "Swatches" keeps the current arrangement, else a row.
        onChange(
          "swatch_layout",
          next !== "swatches" ? next : group === "swatches" ? layout : "row",
        );
      }),
    )}
    ${groupSettings ? renderSettingsBox(`${groupLabel} Settings`, groupSettings) : ""}
    ${sizeKey
      ? createSliderRow(
          "Size",
          Number(config[sizeKey]) || 28,
          { min: 16, max: 48, step: 1 },
          (event) => onChange(sizeKey, parseInt(event.target.value, 10)),
          "px",
        )
      : ""}
    ${selectable
      ? choices(
          "Color Info Display",
          "color_info_display",
          [
            { value: "none", label: "None" },
            { value: "hex", label: "Hex Code" },
            { value: "name", label: "Color Name" },
          ],
          config.color_info_display || "none",
        )
      : ""}
  `;
}
