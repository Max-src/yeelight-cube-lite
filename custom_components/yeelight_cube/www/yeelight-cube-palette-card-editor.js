import { LitElement, html, css } from "./lib/lit-all.js";

import {
  sharedEditorStyles,
  fireEvent,
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

import { createYeelightCubeEntityPicker } from "./entity-selector-utils.js";

class YeelightCubePaletteCardEditor extends LitElement {
  static get properties() {
    return {
      localTitle: { type: String },
      _globalOpen: { type: Boolean },
      _palettesListOpen: { type: Boolean },
      _importExportOpen: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.config = {};
    this.localTitle = "";
    this._hass = null;
    this._globalOpen = false;
    this._palettesListOpen = false;
    this._importExportOpen = false;
  }

  _toggleSection(section) {
    if (section === "global") {
      this._globalOpen = !this._globalOpen;
    } else if (section === "palettes") {
      this._palettesListOpen = !this._palettesListOpen;
    } else if (section === "importExport") {
      this._importExportOpen = !this._importExportOpen;
    }
  }

  static get styles() {
    return [sharedEditorStyles, buttonGroupStyles];
  }

  setConfig(config) {
    this.config = { ...config };
    this.localTitle = config.title || "";
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
    const config = this.config || {};
    const sensors = Object.keys(this._hass.states || {}).filter((eid) =>
      eid.startsWith("sensor."),
    );

    const chevronIcon = (folded) => {
      const rotation = folded ? 180 : 0;
      return html`
        <ha-icon
          icon="mdi:chevron-up"
          style="transition:transform 0.4s;transform:rotate(${rotation}deg);"
        ></ha-icon>
      `;
    };

    return html`
      <div class="editor-root">
        <div
          class="editor-card${!this._globalOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("global")}"
          >
            Global Settings ${chevronIcon(!this._globalOpen)}
          </div>
          <div class="editor-card-content">
            <div class="form-row">
              <label>Card Title (optional)</label>
              <input
                type="text"
                id="title"
                .value="${this.localTitle}"
                placeholder="Palettes"
                @input="${this._onTitleInput}"
              />
            </div>
            <div class="form-row">
              <label>Target Entities (optional)</label>
              <div
                style="font-size: 0.9em; color: var(--secondary-text-color, #666); margin-bottom: 8px;"
              >
                Select which Yeelight Cube Lite lights should receive palette
                applications. Leave empty to affect all lights.
              </div>
              ${createYeelightCubeEntityPicker(
                this._hass,
                this.config.target_entities || [],
                (e) => this._onEntityChange(e),
                "multiple",
              )}
            </div>
            ${createToggleRow(
              "Show Card Background",
              "show_card_background",
              config.show_card_background !== false,
              (e) => this._onSwitchChange(e, "show_card_background"),
            )}
          </div>
        </div>

        <div
          class="editor-card${!this._palettesListOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("palettes")}"
          >
            Palettes List ${chevronIcon(!this._palettesListOpen)}
          </div>
          <div class="editor-card-content">
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
                      this.config.palette_carousel_button_shape = value;
                      this.config = { ...this.config };
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
                this.config[key] = value;
                this.config = { ...this.config };
                this.requestUpdate();
                this._fireConfigChanged();
              },
            })}
          </div>
        </div>

        <!-- Import/Export Actions Section -->
        <div
          class="editor-card${!this._importExportOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("importExport")}"
          >
            Import/Export Actions ${chevronIcon(!this._importExportOpen)}
          </div>
          <div class="editor-card-content">
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
            <div class="form-row">
              <label>Button Style</label>
              ${createButtonGroup(
                [
                  { value: "modern", label: "Modern" },
                  { value: "classic", label: "Classic" },
                  { value: "outline", label: "Outline" },
                  { value: "gradient", label: "Gradient" },
                  { value: "icon", label: "Icon" },
                  { value: "pill", label: "Pill" },
                ],
                config.buttons_style || "modern",
                createButtonGroupChangeHandler("buttons_style", (value) => {
                  this._onButtonGroupChange("buttons_style", value);
                }),
              )}
            </div>
            ${(config.buttons_style || "modern") !== "icon"
              ? html`
                  <div class="form-row">
                    <label>Content Mode</label>
                    ${createButtonGroup(
                      [
                        { value: "icon", label: "Icon" },
                        { value: "text", label: "Text" },
                        { value: "icon_text", label: "Icon + Text" },
                      ],
                      config.buttons_content_mode || "icon_text",
                      createButtonGroupChangeHandler(
                        "buttons_content_mode",
                        (value) => {
                          this._onButtonGroupChange(
                            "buttons_content_mode",
                            value,
                          );
                        },
                      ),
                    )}
                  </div>
                `
              : html`
                  <div class="form-row" style="opacity: 0.5;">
                    <label>Content Mode</label>
                    <div
                      style="font-size: 0.85em; color: var(--secondary-text-color, #888);"
                    >
                      Icon style always uses icon-only
                    </div>
                  </div>
                `}
          </div>
        </div>
      </div>
    `;
  }

  _onTitleInput(e) {
    this.localTitle = e.target.value;
    this.config.title = this.localTitle || undefined;
    this._fireConfigChanged();
  }

  _onEntityChange(e) {
    const newEntities = Array.isArray(e.target.value)
      ? e.target.value
      : [e.target.value];
    this.config.target_entities = newEntities;
    this.config = { ...this.config };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onButtonGroupChange(key, value) {
    // Convert boolean-backed button groups from string to boolean
    if (key === "delete_button_left") {
      this.config[key] = value === "left";
    } else if (key === "delete_button_inside") {
      this.config[key] = value === "inside";
    } else {
      this.config[key] = value;
    }
    // Force re-render to update conditional sections (like album settings)
    this.config = { ...this.config };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onSwitchChange(e, key) {
    this.config[key] = e.target.checked;
    // Immediately update the UI before firing config change
    this.config = { ...this.config };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onSliderChange(key, e) {
    const value = parseInt(e.target.value);
    this.config[key] = value;
    this.config = { ...this.config };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this.config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("yeelight-cube-palette-card-editor")) {
  customElements.define(
    "yeelight-cube-palette-card-editor",
    YeelightCubePaletteCardEditor,
  );
}
