import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit@2.8.0/index.js?module";

import {
  renderModeSettingsSection,
  renderModeInfoMessage,
} from "./editor_ui_utils.js";

import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";

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
    return [
      buttonGroupStyles,
      css`
        .editor-root {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 18px 8px 8px 8px;
        }
        .editor-card {
          background: #f7fafd;
          border-radius: 14px;
          box-shadow: 0 2px 8px #0001;
          padding: 16px 18px 12px 18px;
          margin-bottom: 10px;
          position: relative;
        }
        .editor-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 1.15em;
          font-weight: 600;
          margin-bottom: 8px;
          cursor: pointer;
          user-select: none;
        }
        .editor-card-content {
          transition: max-height 0.3s, opacity 0.3s;
          overflow: hidden;
        }
        .editor-card-collapsed .editor-card-content {
          max-height: 0;
          opacity: 0;
          pointer-events: none;
        }
        .editor-card:not(.editor-card-collapsed) .editor-card-content {
          max-height: 1200px;
          opacity: 1;
          pointer-events: auto;
        }
        .form-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .form-row.column {
          flex-direction: column;
          align-items: stretch;
        }
        label {
          font-weight: 500;
          color: #333;
          font-size: 1em;
        }
        input[type="text"],
        select {
          flex: 1;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid #cfd8dc;
          font-size: 1em;
          background: #f7f8fa;
          box-sizing: border-box;
        }
        .form-row.column input[type="text"],
        .form-row.column select {
          width: 100%;
          margin-top: 6px;
        }
        .switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: 0.2s;
          border-radius: 24px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.2s;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        }
        input:checked + .slider {
          background-color: #0077cc;
        }
        input:checked + .slider:before {
          transform: translateX(20px);
        }
        input[type="range"] {
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: #e0e0e0;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #0077cc;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #0077cc;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .button-group {
          display: flex;
          flex-wrap: wrap;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #cfd8dc;
          gap: 1px;
        }
        .button-group-btn {
          background: #f7f8fa;
          border: none;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 14px;
          transition: background 0.2s;
          flex: 1 1 calc(25% - 1px);
          min-width: 80px;
        }
        .button-group-btn:hover {
          background: #e8f0fe;
        }
        .button-group-btn.active {
          background: #0077cc;
          color: white;
        }
      `,
    ];
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
          console.debug(
            "Editor performUpdate promise error (suppressed):",
            e.message
          );
          return Promise.resolve();
        });
      }
      return result;
    } catch (e) {
      // Catch synchronous errors
      console.debug("Editor performUpdate error (suppressed):", e.message);
      return Promise.resolve();
    }
  }

  render() {
    if (!this._hass || !this._hass.states)
      return html`<div style="padding: 20px; color: #666;">Loading...</div>`;
    const config = this.config || {};
    const sensors = Object.keys(this._hass.states || {}).filter((eid) =>
      eid.startsWith("sensor.")
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
            <div class="form-row column">
              <label>Title (optional)</label>
              <input
                type="text"
                id="title"
                .value="${this.localTitle}"
                placeholder="Optional title"
                @input="${this._onTitleInput}"
              />
            </div>
            <div class="form-row column">
              <label>Palette Sensor Entity</label>
              ${this._renderPaletteSensorPicker()}
            </div>
            <div class="form-row column">
              <label>Target Entities (optional)</label>
              <div style="font-size: 0.9em; color: #666; margin-bottom: 8px;">
                Select which Yeelight Cube lights should receive palette
                applications. Leave empty to affect all lights.
              </div>
              ${this._renderEntityPicker()}
            </div>
            ${this._renderSwitch(
              "Show Card Background",
              "show_card_background",
              config.show_card_background !== false
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
            ${this._renderSwitch(
              "Show Palette Title",
              "show_palette_title",
              config.show_palette_title !== false
            )}
            ${this._renderSwitch(
              "Show Color Count",
              "show_color_count",
              config.show_color_count !== false
            )}
            ${this._renderSwitch(
              "Allow Title Edit",
              "allow_title_edit",
              config.allow_title_edit === true
            )}
            ${this._renderButtonGroup(
              "Swatch Style",
              "swatch_style",
              config.swatch_style || "square",
              [
                { value: "round", label: "Round" },
                { value: "square", label: "Square" },
                { value: "gradient", label: "Gradient Bar" },
                { value: "gradient-bg", label: "Gradient Background" },
                { value: "stripes", label: "Color Stripes" },
              ]
            )}
            ${this._renderButtonGroup(
              "Palette List Display Mode",
              "display_mode",
              config.display_mode || "list",
              [
                { value: "list", label: "List" },
                { value: "gallery", label: "Gallery" },
                { value: "carousel", label: "Carousel" },
                { value: "album", label: "Album" },
              ]
            )}
            ${
              // Gallery-specific settings
              config.display_mode === "gallery"
                ? renderModeSettingsSection(
                    "Gallery Mode Settings",
                    html`
                      ${this._renderSwitch(
                        "Rounded Cards",
                        "gallery_rounded_cards",
                        config.gallery_rounded_cards !== false
                      )}
                    `
                  )
                : ""
            }

            <!-- Global Remove Button Settings -->
            ${this._renderButtonGroup(
              "Remove Button Style",
              "remove_button_style",
              config.remove_button_style || "default",
              [
                { value: "none", label: "None" },
                { value: "default", label: "Default" },
                { value: "red", label: "Red" },
                { value: "black", label: "Black" },
                { value: "trash", label: "Trash" },
              ]
            )}
            ${config.remove_button_style !== "none"
              ? this._renderSwitch(
                  "Remove Button Always Visible",
                  "remove_button_always_visible",
                  config.remove_button_always_visible !== false
                )
              : ""}

            <div class="form-row">
              <label>Display Card Size</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="card_size"
                  type="range"
                  min="30"
                  max="100"
                  step="1"
                  .value="${config.card_size || 50}"
                  @input="${this._onRangeInput}"
                  style="flex: 1;"
                />
                <span
                  id="card_size_display"
                  style="min-width: 45px; text-align: right; font-size: 0.9em; color: #666;"
                >
                  ${config.card_size || 50}%
                </span>
              </div>
            </div>

            <!-- Carousel Mode Settings -->
            ${config.display_mode === "carousel"
              ? renderModeSettingsSection(
                  "Carousel Mode Settings",
                  html`
                    <div class="form-row">
                      <label>Navigation Button Shape</label>
                      ${createButtonGroup(
                        [
                          { value: "circle", label: "Circle" },
                          { value: "rect", label: "Rounded" },
                          { value: "square", label: "Square" },
                        ],
                        config.palette_carousel_button_shape || "square",
                        createButtonGroupChangeHandler(
                          "palette_carousel_button_shape",
                          (value) => {
                            this.config.palette_carousel_button_shape = value;
                            this._fireConfigChanged();
                          }
                        )
                      )}
                    </div>
                    ${this._renderSwitch(
                      "Wrap Navigation (Infinite Loop)",
                      "palette_carousel_wrap_navigation",
                      config.palette_carousel_wrap_navigation === true
                    )}
                    ${this._renderSwitch(
                      "Show Indicators Outside Card",
                      "palette_carousel_indicators_outside",
                      config.palette_carousel_indicators_outside === true
                    )}
                  `
                )
              : ""}

            <!-- Album Mode Settings -->
            ${config.display_mode === "album"
              ? renderModeSettingsSection(
                  "Album Mode Settings",
                  html`
                    ${this._renderSwitch(
                      "3D Effect (Perspective)",
                      "album_3d_effect",
                      config.album_3d_effect !== false
                    )}
                    ${this._renderSwitch(
                      "Rounded Cards",
                      "album_card_rounded",
                      config.album_card_rounded !== false
                    )}
                    ${this._renderButtonGroup(
                      "Delete Button Position",
                      "album_remove_button_style",
                      config.album_remove_button_style || "outside",
                      [
                        { value: "outside", label: "Outside" },
                        { value: "inside", label: "Inside" },
                        { value: "square", label: "Square" },
                      ]
                    )}
                  `
                )
              : config.display_mode === "compact"
              ? renderModeSettingsSection(
                  "Compact Mode Settings",
                  renderModeInfoMessage(
                    "No additional compact mode settings available."
                  )
                )
              : ""}
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
            ${this._renderSwitch(
              "Show Export Button",
              "show_export_button",
              config.show_export_button !== false
            )}
            ${this._renderSwitch(
              "Show Import Button",
              "show_import_button",
              config.show_import_button !== false
            )}
            ${this._renderButtonGroup(
              "Button Style",
              "buttons_style",
              config.buttons_style || "modern",
              [
                { value: "modern", label: "Modern" },
                { value: "classic", label: "Classic" },
                { value: "outline", label: "Outline" },
                { value: "gradient", label: "Gradient" },
                { value: "icon", label: "Icon" },
                { value: "pill", label: "Pill" },
              ]
            )}
            ${(config.buttons_style || "modern") !== "icon"
              ? this._renderButtonGroup(
                  "Content Mode",
                  "buttons_content_mode",
                  config.buttons_content_mode || "icon_text",
                  [
                    { value: "icon", label: "Icon" },
                    { value: "text", label: "Text" },
                    { value: "icon_text", label: "Icon + Text" },
                  ]
                )
              : html`
                  <div class="form-row" style="opacity: 0.5;">
                    <label>Content Mode</label>
                    <div style="font-size: 0.85em; color: #888;">
                      Icon style always uses icon-only
                    </div>
                  </div>
                `}
          </div>
        </div>
      </div>
    `;
  }

  _onSensorChange(e) {
    this.config.palette_sensor = e.target.value;
    this._fireConfigChanged();
  }

  _onPaletteSensorSelection(entityId) {
    this.config.palette_sensor = entityId;
    this._fireConfigChanged();
  }

  _onTitleInput(e) {
    this.localTitle = e.target.value;
    this.config.title = this.localTitle;
    this._fireConfigChanged();
  }

  _renderSwitch(label, id, checked) {
    return html`
      <div class="form-row">
        <label for="${id}">${label}</label>
        <label class="switch">
          <input
            type="checkbox"
            id="${id}"
            .checked="${checked}"
            @change="${(e) => this._onSwitchChange(e, id)}"
          />
          <span class="slider"></span>
        </label>
      </div>
    `;
  }

  _renderButtonGroup(label, id, currentValue, options) {
    return html`
      <div class="form-row">
        <label>${label}</label>
        <div class="button-group">
          ${options.map(
            (option) => html`
              <button
                class="button-group-btn ${currentValue === option.value
                  ? "active"
                  : ""}"
                title="${option.label}"
                @click="${() => this._onButtonGroupChange(id, option.value)}"
              >
                ${option.label}
              </button>
            `
          )}
        </div>
      </div>
    `;
  }

  _renderPaletteSensorPicker() {
    if (!this._hass || !this._hass.states) {
      return html`<div style="color: #666; font-style: italic; padding: 8px;">
        Loading sensors...
      </div>`;
    }

    // Get all sensor entities and filter for palette sensors
    const allSensorEntities = Object.keys(this._hass.states)
      .filter((entityId) => entityId.startsWith("sensor."))
      .sort();

    // Filter to only show palette sensors (those with palettes_v2 or palettes attributes)
    const paletteSensors = allSensorEntities.filter((entityId) => {
      const state = this._hass.states[entityId];
      const attributes = state?.attributes || {};
      return (
        attributes.palettes_v2 !== undefined ||
        attributes.palettes !== undefined
      );
    });

    const selectedSensor = this.config.palette_sensor || "";

    return html`
      <div
        style="border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;"
      >
        <!-- Header -->
        <div
          style="padding: 12px 16px 8px 16px; font-weight: 500; color: #333; border-bottom: 1px solid #e8e8e8; background: #f5f5f5; border-radius: 8px 8px 0 0;"
        >
          Palette Sensors (${paletteSensors.length})
        </div>

        <!-- Sensor list -->
        <div style="max-height: 200px; overflow-y: auto; padding: 8px;">
          ${paletteSensors.length === 0
            ? html`<div
                style="color: #666; font-style: italic; text-align: center; padding: 20px;"
              >
                <div style="margin-bottom: 8px;">No palette sensors found</div>
                <div style="font-size: 0.85em; color: #999;">
                  Make sure you have Yeelight Cube devices configured in this
                  integration
                </div>
              </div>`
            : paletteSensors.map((entityId) => {
                const isSelected = selectedSensor === entityId;
                const state = this._hass.states[entityId];
                const friendlyName =
                  state?.attributes?.friendly_name || entityId;
                const paletteCount = state?.attributes?.count || 0;

                return html`
                  <div
                    style="display: flex; align-items: center; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: ${isSelected
                      ? "#e3f2fd"
                      : "white"}; border: 1px solid ${isSelected
                      ? "#90caf9"
                      : "#e0e0e0"}; transition: all 0.2s ease; cursor: pointer;"
                    @click="${() => this._onPaletteSensorSelection(entityId)}"
                  >
                    <input
                      type="radio"
                      name="palette_sensor"
                      id="sensor_${entityId.replace(/[^a-zA-Z0-9]/g, "_")}"
                      .checked="${isSelected}"
                      @change="${(e) => {
                        e.stopPropagation();
                        if (e.target.checked) {
                          this._onPaletteSensorSelection(entityId);
                        }
                      }}"
                      style="margin-right: 12px; transform: scale(1.1);"
                    />
                    <div style="flex: 1;">
                      <div
                        style="font-weight: 500; color: #333; margin-bottom: 2px;"
                      >
                        ${friendlyName}
                      </div>
                      <div style="font-size: 0.85em; color: #666;">
                        ${entityId} • ${paletteCount}
                        palette${paletteCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                `;
              })}
        </div>
      </div>
    `;
  }

  _renderEntityPicker() {
    if (!this._hass || !this._hass.states) {
      return html`<div style="color: #666; font-style: italic; padding: 8px;">
        Loading entities...
      </div>`;
    }

    // Get all light entities and filter for our custom component
    const allLightEntities = Object.keys(this._hass.states)
      .filter((entityId) => entityId.startsWith("light."))
      .sort();

    // Filter to only show entities from our yeelight_cube component
    // Use our internal component identifier that users cannot modify
    const ourComponentEntities = allLightEntities.filter((entityId) => {
      const state = this._hass.states[entityId];
      const attributes = state?.attributes || {};

      // Check for our internal component identifier
      // This is bulletproof as users cannot modify internal attributes
      return (
        attributes._yeelight_cube_component === "yeelight-cube-component-v1.0"
      );
    });

    // Use Yeelight entities if found, otherwise show all light entities
    const entitiesToShow = ourComponentEntities;
    const selectedEntities = this.config.target_entities || [];

    return html`
      <div
        style="border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;"
      >
        <!-- Header -->
        <div
          style="padding: 12px 16px 8px 16px; font-weight: 500; color: #333; border-bottom: 1px solid #e8e8e8; background: #f5f5f5; border-radius: 8px 8px 0 0;"
        >
          Yeelight Cube Entities (${ourComponentEntities.length})
        </div>

        <!-- Entity list -->
        <div style="max-height: 200px; overflow-y: auto; padding: 8px;">
          ${entitiesToShow.length === 0
            ? html`<div
                style="color: #666; font-style: italic; text-align: center; padding: 20px;"
              >
                <div style="margin-bottom: 8px;">
                  No Yeelight Cube entities found
                </div>
                <div style="font-size: 0.85em; color: #999;">
                  Make sure you have Yeelight Cube devices configured in this
                  integration
                </div>
              </div>`
            : entitiesToShow.map((entityId) => {
                if (!this._hass || !this._hass.states) {
                  return html``;
                }
                const isSelected = selectedEntities.includes(entityId);
                const state = this._hass.states[entityId];
                const friendlyName =
                  state?.attributes?.friendly_name || entityId;
                return html`
                  <div
                    style="display: flex; align-items: center; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: ${isSelected
                      ? "#e3f2fd"
                      : "white"}; border: 1px solid ${isSelected
                      ? "#90caf9"
                      : "#e0e0e0"}; transition: all 0.2s ease; cursor: pointer;"
                    @click="${() => this._toggleEntitySelection(entityId)}"
                  >
                    <input
                      type="checkbox"
                      id="entity_${entityId.replace(/[^a-zA-Z0-9]/g, "_")}"
                      .checked="${isSelected}"
                      @change="${(e) => {
                        e.stopPropagation();
                        this._onEntitySelectionChange(
                          entityId,
                          e.target.checked
                        );
                      }}"
                      style="margin-right: 12px; transform: scale(1.1);"
                    />
                    <div style="flex: 1;">
                      <div
                        style="font-weight: 500; color: #333; margin-bottom: 2px;"
                      >
                        ${friendlyName}
                      </div>
                      <div
                        style="font-size: 0.85em; color: #666; font-family: monospace;"
                      >
                        ${entityId}
                      </div>
                    </div>
                  </div>
                `;
              })}
        </div>

        <!-- Footer info -->
        ${selectedEntities.length > 0
          ? html`<div
              style="padding: 8px 16px; font-size: 0.9em; color: #666; border-top: 1px solid #e8e8e8; background: #f9f9f9; border-radius: 0 0 8px 8px;"
            >
              ${selectedEntities.length} entities selected for palette
              applications
            </div>`
          : html`<div
              style="padding: 8px 16px; font-size: 0.9em; color: #999; border-top: 1px solid #e8e8e8; background: #f9f9f9; border-radius: 0 0 8px 8px; font-style: italic;"
            >
              No entities selected - palettes will not be applied
            </div>`}
      </div>
    `;
  }

  _toggleEntitySelection(entityId) {
    const currentEntities = this.config.target_entities || [];
    const isSelected = currentEntities.includes(entityId);
    this._onEntitySelectionChange(entityId, !isSelected);
  }

  _onEntitySelectionChange(entityId, isSelected) {
    const currentEntities = this.config.target_entities || [];

    if (isSelected) {
      // Add entity if not already present
      if (!currentEntities.includes(entityId)) {
        this.config.target_entities = [...currentEntities, entityId];
      }
    } else {
      // Remove entity
      this.config.target_entities = currentEntities.filter(
        (id) => id !== entityId
      );
    }

    this._fireConfigChanged();
  }

  _onButtonGroupChange(key, value) {
    this.config[key] = value;
    // Force re-render to update conditional sections (like album settings)
    this.config = { ...this.config };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onSwitchChange(e, key) {
    this.config[key] = e.target.checked;
    // Immediately update the UI before firing config change
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onRangeInput(e) {
    const id = e.target.id;
    const value = parseInt(e.target.value);
    this.config[id] = value;

    // Update the display value
    const display = this.shadowRoot.getElementById(`${id}_display`);
    if (display) {
      display.textContent = `${value}%`;
    }

    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this.config },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define(
  "yeelight-cube-palette-card-editor",
  YeelightCubePaletteCardEditor
);
