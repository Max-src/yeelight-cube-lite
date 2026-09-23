import { html } from "./lib/lit-all.js";
import { createButtonGroup } from "./button-group-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import {
  renderModeSettingsSection,
  renderSelectorShapeRows,
  BG_COLOR_CHOICES,
  SPACING_CHOICES,
} from "./editor_ui_utils.js";
import { selectorItemsPerPage } from "./style-selector-utils.js";
const TEXT_STYLE_CHOICES = [
  { value: "filled", label: "Filled" },
  { value: "dropdown", label: "Dropdown" },
];

const PREVIEW_STYLE_CHOICES = [
  {
    value: "preview-list",
    label: "List",
    title: "Responsive list of live previews",
  },
  {
    value: "preview-grid",
    label: "Grid",
    title: "Fixed two-column grid of live previews",
  },
  {
    value: "preview-strip",
    label: "Strip",
    title: "Horizontal scrollable strip of mini previews",
  },
  {
    value: "preview-carousel",
    label: "Carousel",
    title: "One preview at a time with arrows, dots and swipe navigation",
  },
  {
    value: "preview-wheel",
    label: "Wheel",
    title: "iOS-style rotating picker with live previews",
  },
];

export function renderStyleSelectorSettings(
  config,
  onChange,
  { allowOriginal = false } = {},
) {
  const style = config.style_selector_style || "preview-grid";
  const family =
    style === "original"
      ? "original"
      : style.startsWith("preview-")
        ? "preview"
        : "text";
  return html` <div class="form-row">
      <label>Selector Type</label>
      ${createButtonGroup(
        [
          {
            value: "text",
            label: "Text",
            title: "Lightweight buttons — no preview animation",
          },
          {
            value: "preview",
            label: "Live Preview",
            title: "Animated preview of every style",
          },
          ...(allowOriginal ? [{ value: "original", label: "Original" }] : []),
        ],
        family,
        (event) =>
          onChange(
            "style_selector_style",
            { text: "filled", preview: "preview-grid", original: "original" }[
              event.currentTarget.dataset.value
            ],
          ),
      )}
    </div>
    ${family === "original"
      ? renderOriginalSelectorSettings(config, onChange)
      : family === "text"
        ? html`
            <div class="form-row">
              <label>Text Style</label>
              ${createButtonGroup(TEXT_STYLE_CHOICES, style, (event) =>
                onChange(
                  "style_selector_style",
                  event.currentTarget.dataset.value,
                ),
              )}
            </div>
          `
        : html`
            <div class="form-row">
              <label>Preview Style</label>
              ${createButtonGroup(PREVIEW_STYLE_CHOICES, style, (event) =>
                onChange(
                  "style_selector_style",
                  event.currentTarget.dataset.value,
                ),
              )}
            </div>
            ${style === "preview-wheel"
              ? renderModeSettingsSection(
                  "Wheel Mode Settings",
                  html`
                    <div class="form-row">
                      <label>Wheel Navigation Position</label>
                      ${createButtonGroup(
                        [
                          { value: "none", label: "None" },
                          { value: "bottom", label: "Bottom" },
                          { value: "sides", label: "Sides" },
                        ],
                        config.wheel_nav_position || "bottom",
                        (event) =>
                          onChange(
                            "wheel_nav_position",
                            event.currentTarget.dataset.value,
                          ),
                      )}
                    </div>
                    ${createSliderRow(
                      "Wheel Height",
                      config.wheel_height ?? 300,
                      { min: 65, max: 400, step: 10 },
                      (event) =>
                        onChange("wheel_height", Number(event.target.value)),
                      "px",
                    )}
                    ${createToggleRow(
                      "Highlight Active Style",
                      "highlight_active_mode",
                      config.highlight_active_mode !== false,
                      (event) =>
                        onChange("highlight_active_mode", event.target.checked),
                    )}
                  `,
                )
              : ""}
            ${style === "preview-carousel"
              ? renderModeSettingsSection(
                  "Carousel Mode Settings",
                  createToggleRow(
                    "Wrap Navigation (Infinite Loop)",
                    "gallery_wrap_navigation",
                    config.gallery_wrap_navigation === true,
                    (event) =>
                      onChange("gallery_wrap_navigation", event.target.checked),
                  ),
                )
              : ""}
            ${style === "preview-strip"
              ? renderModeSettingsSection(
                  "Strip Mode Settings",
                  createToggleRow(
                    "Highlight Active Style",
                    "highlight_active_mode",
                    config.highlight_active_mode !== false,
                    (event) =>
                      onChange("highlight_active_mode", event.target.checked),
                  ),
                )
              : ""}
            ${style === "preview-list" || style === "preview-grid"
              ? renderModeSettingsSection(
                  style === "preview-grid"
                    ? "Grid Mode Settings"
                    : "List Mode Settings",
                  html`
                    ${createToggleRow(
                      "Highlight Active Style",
                      "highlight_active_mode",
                      config.highlight_active_mode !== false,
                      (event) =>
                        onChange("highlight_active_mode", event.target.checked),
                    )}
                    ${createSliderRow(
                      "Items Per Page (0 = no pagination)",
                      selectorItemsPerPage(config),
                      { min: 0, max: 16, step: 1 },
                      (event) =>
                        onChange("items_per_page", Number(event.target.value)),
                    )}
                  `,
                )
              : ""}
            ${createToggleRow(
              "Show Style Titles",
              "preview_show_titles",
              config.preview_show_titles !== false,
              (event) => onChange("preview_show_titles", event.target.checked),
            )}
            ${renderGalleryMatrixSettings(config, onChange)}
          `}
    ${!["original", "preview-list", "preview-grid"].includes(style)
      ? renderSelectorShapeRows(config, onChange, {
          showButtonShape:
            style === "preview-carousel" || style === "preview-wheel",
        })
      : ""}`;
}

// Shared gallery matrix appearance controls. Live Preview and Original use the
// same keys, labels, ranges and defaults so one setting is configured and read
// the same way everywhere.
function renderGalleryMatrixSettings(config, onChange) {
  return html`
    ${createSliderRow(
      "Size",
      config.preview_size ?? 55,
      { min: 30, max: 100, step: 5 },
      (event) => onChange("preview_size", Number(event.target.value)),
      "%",
    )}
    <div class="form-row">
      <label>Preview Background Color</label>
      ${createButtonGroup(
        BG_COLOR_CHOICES,
        config.gallery_background_color || "black",
        (event) =>
          onChange(
            "gallery_background_color",
            event.currentTarget.dataset.value,
          ),
      )}
    </div>
    ${(config.gallery_background_color || "black") !== "black"
      ? renderModeSettingsSection(
          "Background Settings",
          createToggleRow(
            "Ignore Black Pixels",
            "gallery_ignore_black_pixels",
            config.gallery_ignore_black_pixels === true,
            (event) =>
              onChange("gallery_ignore_black_pixels", event.target.checked),
          ),
        )
      : ""}
    <div class="form-row">
      <label>Preview Pixel Style</label>
      ${createButtonGroup(
        [
          { value: "square", label: "Square" },
          { value: "rounded", label: "Rounded" },
          { value: "circle", label: "Circle" },
        ],
        config.gallery_pixel_style || "square",
        (event) =>
          onChange("gallery_pixel_style", event.currentTarget.dataset.value),
      )}
    </div>
    <div class="form-row">
      <label>Pixel Spacing</label>
      ${createButtonGroup(
        SPACING_CHOICES,
        config.gallery_spacing_mode || "normal",
        (event) =>
          onChange("gallery_spacing_mode", event.currentTarget.dataset.value),
      )}
    </div>
    ${createToggleRow(
      "Matrix Box Shadow",
      "gallery_matrix_box_shadow",
      config.gallery_matrix_box_shadow === true,
      (event) => onChange("gallery_matrix_box_shadow", event.target.checked),
    )}
  `;
}

// Original uses the same controls as Live Preview for every shared config key.
// Display is its only extra choice. Do not recreate these rows in a card editor.
function renderOriginalSelectorSettings(config, onChange) {
  const view = config.effect_view === "list" ? "list" : "grid";
  return html`
    <div class="form-row">
      <label>Display</label>
      ${createButtonGroup(
        [
          { value: "grid", label: "Grid" },
          { value: "list", label: "List" },
        ],
        view,
        (event) => onChange("effect_view", event.currentTarget.dataset.value),
      )}
    </div>
    ${renderModeSettingsSection(
      view === "list" ? "List Mode Settings" : "Grid Mode Settings",
      html`
        ${createToggleRow(
          "Highlight Active Style",
          "highlight_active_mode",
          config.highlight_active_mode !== false,
          (event) => onChange("highlight_active_mode", event.target.checked),
        )}
        ${createSliderRow(
          "Items Per Page (0 = no pagination)",
          selectorItemsPerPage(config),
          { min: 0, max: 16, step: 1 },
          (event) => onChange("items_per_page", Number(event.target.value)),
        )}
      `,
    )}
    ${renderModeSettingsSection(
      "Gallery Appearance",
      html`
        ${createToggleRow(
          "Capability Labels",
          "show_badges",
          config.show_badges !== false,
          (event) => onChange("show_badges", event.target.checked),
        )}
        ${renderGalleryMatrixSettings(config, onChange)}
      `,
    )}
  `;
}
