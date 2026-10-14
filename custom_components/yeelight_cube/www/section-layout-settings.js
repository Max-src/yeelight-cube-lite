/**
 * The section layouts' settings in a card editor (the layouts of
 * section-layouts.js <yc-sections>): the layout, then the options of the
 * chosen one, the sections' style and border, and the card's own rows.
 * Every card offers every layout; each keeps its own option names:
 *
 *   renderSectionLayoutSettings({
 *     config,
 *     set: (key, value) => …,          // store one option
 *     keys: { layout, style, border, width, zoom, radius,
 *             buttonShape, wrap, overlay, tabIcons, headers },
 *     defaults: { layout, border, tabIcons, headers },
 *     styled: ["grouped", …],          // layouts the style shows in
 *     extra,                           // the card's own rows
 *   })
 *
 * Editor-only (the cards never load it).
 */
import { html, nothing } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
} from "./button-group-utils.js";
import {
  createButtonGroupRow,
  createSliderRow,
  createToggleRow,
} from "./form-row-utils.js";
import { renderCarouselNavSettings, renderSettingsBox } from "./editor_ui_utils.js";

const LAYOUT_CHOICES = [
  { value: "compact", label: "Compact", icon: "☰" },
  { value: "side", label: "Side-by-Side", icon: "▥" },
  { value: "carousel", label: "Carousel", icon: "🎠" },
  { value: "tabs", label: "Tabs", icon: "📑" },
  { value: "dropdown", label: "Dropdown", icon: "▾" },
  { value: "preview-hover", label: "Preview Hover", icon: "🔍" },
  { value: "grouped", label: "Grouped", icon: "📦" },
  { value: "radial", label: "Radial", icon: "⭕" },
  { value: "categories", label: "Categories", icon: "🏷️" },
];

const buttons = (label, key, choices, value, set) =>
  createButtonGroupRow(
    label,
    createButtonGroup(
      choices,
      value,
      createButtonGroupChangeHandler(key, (choice) => set(key, choice)),
    ),
  );

export function renderSectionLayoutSettings({
  config,
  set,
  keys,
  defaults,
  styled = ["grouped"],
  extra = nothing,
}) {
  const layout = config[keys.layout] || defaults.layout;
  const radius = (fallback) =>
    createSliderRow(
      "Card Roundness",
      config[keys.radius] ?? fallback,
      { min: 0, max: 28, step: 1 },
      (event) => set(keys.radius, parseInt(event.target.value, 10)),
      "px",
    );
  const toggle = (label, key, fallback) =>
    createToggleRow(label, key, config[key] ?? fallback, (event) =>
      set(key, event.target.checked),
    );
  const options = {
    side: html`${createSliderRow(
        "Card Width",
        config[keys.width] || 100,
        { min: 30, max: 100, step: 1 },
        (event) => set(keys.width, Number(event.target.value)),
        "%",
      )}
      ${buttons(
        "Click to Zoom",
        keys.zoom,
        [
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ],
        config[keys.zoom] || "off",
        set,
      )}
      ${radius(16)}`,
    carousel: renderCarouselNavSettings(config, {
      shapeKey: keys.buttonShape,
      shapeDefault: "rounded",
      onShapeChange: (value) => set(keys.buttonShape, value),
      wrapKey: keys.wrap,
      onWrapChange: (event) => set(keys.wrap, event.target.checked),
      extra: radius(12),
    }),
    tabs: toggle("Tab icons", keys.tabIcons, defaults.tabIcons),
    "preview-hover": toggle("Open as overlay", keys.overlay, false),
    compact: toggle("Section titles", keys.headers, defaults.headers),
  }[layout];
  const shown = LAYOUT_CHOICES.find((choice) => choice.value === layout);
  return html`
    ${buttons("Layout", keys.layout, LAYOUT_CHOICES, layout, set)}
    ${options ? renderSettingsBox(`${shown.label} Settings`, options) : nothing}
    ${styled.includes(layout)
      ? buttons(
          "Section Style",
          keys.style,
          [
            { value: "flat", label: "Flat", icon: "▬" },
            { value: "subtle", label: "Subtle", icon: "🔲" },
            { value: "filled", label: "Filled", icon: "■" },
          ],
          config[keys.style] || "subtle",
          set,
        )
      : nothing}
    ${buttons(
          "Section Border",
          keys.border,
          [
            { value: "none", label: "None" },
            { value: "auto", label: "Auto" },
            { value: "always", label: "Always" },
          ],
          config[keys.border] || defaults.border,
          set,
        )}
    ${extra}
  `;
}
