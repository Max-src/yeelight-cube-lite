import { renderActionButtonSettings } from "./action-button-ui.js";
import { LitElement, html, css } from "./lib/lit-all.js";

import {
  sharedEditorStyles,
  YeelightEditorMixin,
  renderModeSettingsSection,
  roundedCardsToSliderValue,
  renderDeleteButtonSettings,
  renderCarouselNavSettings,
} from "./editor_ui_utils.js";

import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";

import { createToggleRow, createSliderRow } from "./form-row-utils.js";

import { defineOnce } from "./card-registration.js";

class YeelightCubePaletteCardEditor extends YeelightEditorMixin(LitElement) {
  static get properties() {
    return {
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._open = {};
  }

  static get styles() {
    return [sharedEditorStyles, buttonGroupStyles];
  }

  setConfig(config) {
    this._config = { ...config };
    this.requestUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    // Only trigger render if hass has states
    if (hass && hass.states) {
      this.requestUpdate();
    }
  }

  get hass() {
    return this._hass;
  }

  shouldUpdate(changedProperties) {
    // Always allow updates if config has changed (for display_mode changes, etc.)
    // Only block if _hass is completely missing
    return !!this._hass;
  }

  performUpdate() {
    // Extra guard at performUpdate level
    if (!this._hass || !this._hass.states) {
      return Promise.resolve();
    }
    try {
      const result = super.performUpdate();
      // Catch async errors from the promise chain
      if (result && typeof result.catch === "function") {
        return result.catch((e) => {
          return Promise.resolve();
        });
      }
      return result;
    } catch (e) {
      // Catch synchronous errors
      return Promise.resolve();
    }
  }

  render() {
    if (!this._hass || !this._hass.states)
      return html`<div
        style="padding: 20px; color: var(--secondary-text-color, #666);"
      >
        Loading...
      </div>`;
    const config = this._config || {};
    const sensors = Object.keys(this._hass.states || {}).filter((eid) =>
      eid.startsWith("sensor."),
    );

    return html`
      <div class="editor-root">
        ${this._section("global", "Global Settings", html`
            ${this._cardFrameSettings({
              placeholder: "Palettes",
              lamps: "multiple",
              lampsHint:
                "Optional: the lamps that receive applied palettes. Leave empty to affect all lights.",
            })}
        `)}

        ${this._section("palettes", "Palettes List", html`
            <!-- 1. Display Mode (container layout choice) -->
            <div class="form-row">
              <label>Display Mode</label>
              ${createButtonGroup(
                [
                  { value: "gallery", label: "Gallery" },
                  { value: "list", label: "List" },
                  { value: "carousel", label: "Carousel" },
                  { value: "album", label: "Album" },
                ],
                config.display_mode || "list",
                createButtonGroupChangeHandler("display_mode", (value) => {
                  this._onButtonGroupChange("display_mode", value);
                }),
              )}
            </div>

            <!-- 2. Conditional mode settings (right after Display Mode) -->
            ${config.display_mode === "carousel"
              ? renderModeSettingsSection(
                  "Carousel Mode Settings",
                  renderCarouselNavSettings(config, {
                    shapeKey: "palette_carousel_button_shape",
                    shapeDefault: "square",
                    onShapeChange: (value) => {
                      this._config = {
                        ...this._config,
                        palette_carousel_button_shape: value,
                      };
                      this.requestUpdate();
                      this._fireConfigChanged();
                    },
                    wrapKey: "palette_carousel_wrap_navigation",
                    onWrapChange: (e) =>
                      this._onSwitchChange(
                        e,
                        "palette_carousel_wrap_navigation",
                      ),
                  }),
                )
              : config.display_mode === "album"
                ? renderModeSettingsSection(
                    "Album Mode Settings",
                    html`
                      ${createToggleRow(
                        "3D Effect (Perspective)",
                        "album_3d_effect",
                        config.album_3d_effect !== false,
                        (e) => this._onSwitchChange(e, "album_3d_effect"),
                      )}
                    `,
                  )
                : config.display_mode === "list" ||
                    config.display_mode === "gallery"
                  ? renderModeSettingsSection(
                      config.display_mode === "gallery"
                        ? "Gallery Mode Settings"
                        : "List Mode Settings",
                      html`
                        ${createSliderRow(
                          "Items Per Page (0 = no pagination)",
                          config.items_per_page || 0,
                          { min: 0, max: 50, step: 1 },
                          (e) => this._onSliderChange("items_per_page", e),
                        )}
                      `,
                    )
                  : ""}

            <!-- 3. Card container settings -->
            ${createSliderRow(
              "Card Roundness",
              roundedCardsToSliderValue(config.rounded_cards),
              { min: 0, max: 28, step: 1 },
              (e) => this._onSliderChange("rounded_cards", e),
              "px",
            )}
            ${createSliderRow(
              "Display Card Size",
              config.card_size || 50,
              { min: 50, max: 100, step: 1 },
              (e) => this._onSliderChange("card_size", e),
              "%",
            )}
            <div class="form-row">
              <label>Item Card Border</label>
              ${createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "auto", label: "Auto" },
                  { value: "always", label: "Always" },
                ],
                config.item_card_border || "auto",
                createButtonGroupChangeHandler("item_card_border", (value) => {
                  this._onButtonGroupChange("item_card_border", value);
                }),
              )}
            </div>

            <!-- 4. Content settings (inside cards) -->
            <div class="form-row">
              <label>Swatch Style</label>
              ${createButtonGroup(
                [
                  { value: "round", label: "Round" },
                  { value: "square", label: "Square" },
                  { value: "gradient", label: "Gradient Bar" },
                  { value: "gradient-bg", label: "Gradient Background" },
                  { value: "stripes", label: "Color Stripes" },
                ],
                config.swatch_style || "square",
                createButtonGroupChangeHandler("swatch_style", (value) => {
                  this._onButtonGroupChange("swatch_style", value);
                }),
              )}
            </div>
            ${createToggleRow(
              "Show Palette Title",
              "show_palette_title",
              config.show_palette_title !== false,
              (e) => this._onSwitchChange(e, "show_palette_title"),
            )}
            ${createToggleRow(
              "Show Color Count",
              "show_color_count",
              config.show_color_count !== false,
              (e) => this._onSwitchChange(e, "show_color_count"),
            )}
            ${createToggleRow(
              "Allow Title Edit",
              "allow_title_edit",
              config.allow_title_edit === true,
              (e) => this._onSwitchChange(e, "allow_title_edit"),
            )}

            <!-- 6. Delete button settings -->
            ${renderDeleteButtonSettings(config, {
              styleKey: "remove_button_style",
              commit: (key, value) => {
                this._config = { ...this._config, [key]: value };
                this.requestUpdate();
                this._fireConfigChanged();
              },
            })}
        `)}

        <!-- Import/Export Actions Section -->
        ${this._section("importExport", "Import/Export Actions", html`
            ${createToggleRow(
              "Show Export Button",
              "show_export_button",
              config.show_export_button !== false,
              (e) => this._onSwitchChange(e, "show_export_button"),
            )}
            ${createToggleRow(
              "Show Import Button",
              "show_import_button",
              config.show_import_button !== false,
              (e) => this._onSwitchChange(e, "show_import_button"),
            )}
            ${renderActionButtonSettings(config, (key, value) => {
              this._onButtonGroupChange(key, value);
            })}
        `)}
      </div>
    `;
  }

  _onButtonGroupChange(key, value) {
    // Convert boolean-backed button groups from string to boolean
    if (key === "delete_button_left") value = value === "left";
    else if (key === "delete_button_inside") value = value === "inside";
    // New object: never mutate a config already dispatched to HA; also
    // forces re-render of conditional sections (like album settings).
    this._config = { ...this._config, [key]: value };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onSwitchChange(e, key) {
    // Immediately update the UI before firing config change
    this._config = { ...this._config, [key]: e.target.checked };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onSliderChange(key, e) {
    const value = parseInt(e.target.value);
    this._config = { ...this._config, [key]: value };
    this.requestUpdate();
    this._fireConfigChanged();
  }

}

defineOnce("yeelight-cube-palette-card-editor", YeelightCubePaletteCardEditor);
