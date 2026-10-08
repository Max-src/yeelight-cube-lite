import { html } from "./lib/lit-all.js";
import { createButtonGroup } from "./button-group-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import {
  renderModeSettingsSection,
  renderSelectorShapeRows,
  renderDeleteButtonSettings,
  BG_COLOR_CHOICES,
  SPACING_CHOICES,
} from "./editor_ui_utils.js";
import {
  selectorItemsPerPage,
  gallerySelectorStyle,
} from "./style-selector-utils.js";
const TEXT_STYLE_CHOICES = [
  { value: "filled", label: "Filled" },
  { value: "dropdown", label: "Dropdown" },
];
const CHIPS_CHOICE = {
  value: "chips",
  label: "Chips",
  title: "A pill per item with its color swatch",
};

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
  {
    value: "preview-album",
    label: "Album",
    title: "3D coverflow of live previews; click the centred one to apply it",
  },
];

/**
 * The settings of the shared gallery (collection-gallery.js), the same in
 * every card editor that has one.
 *
 * @param {Object} config - the edited config
 * @param {Function} onChange - (key, value) => void
 * @param {Object} [options]
 * @param {boolean} [options.allowOriginal] - offer the Original layout
 * @param {boolean} [options.allowChips] - offer Chips (items have swatches)
 * @param {string} [options.noun] - what the items are ("Style", "Mode", ...)
 * @param {string} [options.manage] - the user's own items, when the card
 *   has some ("custom styles", "palettes", ...): offers renaming and the
 *   delete button (its style, shape and position) for them
 * @param {Object} [options.memory] - an object the editor keeps: switching
 *   Selector Type back restores the style last picked in that family
 * @param {number} [options.defaultSize] - the card's preview_size default
 * @param {boolean} [options.hasActive] - false when no item is ever the
 *   active one (palettes): no Highlight Active row
 * @param {Function} [options.renderAppearance] - (config, onChange) => the
 *   card's appearance rows (previews and Original only); default: the
 *   matrix rows. Cards whose items are not matrices (palettes) render
 *   renderGalleryBackgroundRow and their own preview rows instead.
 *
 * Size (preview_size) is shown for every layout: it scales the previews and
 * the text buttons alike.
 */
export function renderStyleSelectorSettings(
  config,
  onChange,
  {
    allowOriginal = false,
    allowChips = false,
    noun = "Style",
    memory = {},
    manage = "",
    defaultSize = 55,
    hasActive = true,
    renderAppearance = renderGalleryMatrixSettings,
  } = {},
) {
  const style = gallerySelectorStyle(config);
  const sizeRow = () =>
    createSliderRow(
      "Size",
      config.preview_size ?? defaultSize,
      { min: 30, max: 100, step: 5 },
      (event) => onChange("preview_size", Number(event.target.value)),
      "%",
    );
  const textChoices = allowChips
    ? [...TEXT_STYLE_CHOICES, CHIPS_CHOICE]
    : TEXT_STYLE_CHOICES;
  const highlightRow = () =>
    hasActive
      ? createToggleRow(
          `Highlight Active ${noun}`,
          "highlight_active_mode",
          config.highlight_active_mode !== false,
          (event) => onChange("highlight_active_mode", event.target.checked),
        )
      : "";
  const family =
    style === "original"
      ? "original"
      : style.startsWith("preview-")
        ? "preview"
        : "text";
  memory[family] = style;
  const pick = (value) => {
    memory[family] = value;
    onChange("style_selector_style", value);
  };
  return html`${createToggleRow(
      "Text Search",
      "show_search",
      config.show_search !== false,
      (event) => onChange("show_search", event.target.checked),
    )}
    <div class="form-row">
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
        (event) => {
          const next = event.currentTarget.dataset.value;
          onChange(
            "style_selector_style",
            memory[next] ||
              { text: "filled", preview: "preview-grid", original: "original" }[
                next
              ],
          );
        },
      )}
    </div>
    ${family === "original"
      ? renderOriginalSelectorSettings(
          config,
          onChange,
          renderAppearance,
          noun,
          sizeRow,
        )
      : family === "text"
        ? html`
            <div class="form-row">
              <label>Text Style</label>
              ${createButtonGroup(textChoices, style, (event) =>
                pick(event.currentTarget.dataset.value),
              )}
            </div>
            ${sizeRow()}
          `
        : html`
            <div class="form-row">
              <label>Preview Style</label>
              ${createButtonGroup(PREVIEW_STYLE_CHOICES, style, (event) =>
                pick(event.currentTarget.dataset.value),
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
                    ${highlightRow()}
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
            ${style === "preview-album"
              ? renderModeSettingsSection(
                  "Album Mode Settings",
                  html`
                    ${createToggleRow(
                      "3D Effect",
                      "album_3d_effect",
                      config.album_3d_effect !== false,
                      (event) =>
                        onChange("album_3d_effect", event.target.checked),
                    )}
                    ${createToggleRow(
                      "Wrap Navigation (Infinite Loop)",
                      "gallery_wrap_navigation",
                      config.gallery_wrap_navigation === true,
                      (event) =>
                        onChange("gallery_wrap_navigation", event.target.checked),
                    )}
                    ${highlightRow()}
                  `,
                )
              : ""}
            ${style === "preview-strip" && hasActive
              ? renderModeSettingsSection(
                  "Strip Mode Settings",
                  highlightRow(),
                )
              : ""}
            ${style === "preview-list" || style === "preview-grid"
              ? renderModeSettingsSection(
                  style === "preview-grid"
                    ? "Grid Mode Settings"
                    : "List Mode Settings",
                  html`
                    ${highlightRow()}
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
              `Show ${noun} Titles`,
              "preview_show_titles",
              config.preview_show_titles !== false,
              (event) => onChange("preview_show_titles", event.target.checked),
            )}
            ${sizeRow()}${renderAppearance(config, onChange)}
          `}
    ${manage
      ? renderModeSettingsSection(
          `Your ${manage}`,
          html`
            <div class="hint">
              Rename or delete your ${manage} from the gallery's cards (list,
              grid, strip, carousel, album, Original). A delete always asks
              for confirmation.
            </div>
            ${createToggleRow(
              "Allow Rename",
              "allow_rename",
              config.allow_rename === true,
              (event) => onChange("allow_rename", event.target.checked),
            )}
            ${renderDeleteButtonSettings(config, {
              commit: (key, value) => onChange(key, value),
            })}
          `,
        )
      : ""}
    ${style !== "original"
      ? renderSelectorShapeRows(config, onChange, {
          showButtonShape: [
            "preview-carousel",
            "preview-wheel",
            "preview-album",
          ].includes(style),
        })
      : ""}
    ${family !== "text" ? renderItemBorderRow(config, onChange) : ""}`;
}

// A border around every item (item_card_border): never, only with a dark
// theme (where items can melt into the card), or always.
function renderItemBorderRow(config, onChange) {
  return html`<div class="form-row">
    <label>Item Border</label>
    ${createButtonGroup(
      [
        { value: "none", label: "None" },
        { value: "auto", label: "Dark Theme", title: "Only with a dark theme" },
        { value: "always", label: "Always" },
      ],
      config.item_card_border || "none",
      (event) => onChange("item_card_border", event.currentTarget.dataset.value),
    )}
  </div>`;
}

/** The items' background (gallery_background_color), for the appearance
 * rows of every card, matrix previews or not (renderAppearance). */
export function renderGalleryBackgroundRow(config, onChange) {
  return html`<div class="form-row">
    <label>Preview Background Color</label>
    ${createButtonGroup(
      BG_COLOR_CHOICES,
      config.gallery_background_color || "black",
      (event) =>
        onChange("gallery_background_color", event.currentTarget.dataset.value),
    )}
  </div>`;
}

// Shared gallery matrix appearance controls. Live Preview and Original use the
// same keys, labels, ranges and defaults so one setting is configured and read
// the same way everywhere.
function renderGalleryMatrixSettings(config, onChange) {
  return html`
    ${renderGalleryBackgroundRow(config, onChange)}
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
function renderOriginalSelectorSettings(
  config,
  onChange,
  renderAppearance = renderGalleryMatrixSettings,
  noun = "Style",
  sizeRow = () => "",
) {
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
          `Highlight Active ${noun}`,
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
        ${sizeRow()}${renderAppearance(config, onChange)}
      `,
    )}
  `;
}
