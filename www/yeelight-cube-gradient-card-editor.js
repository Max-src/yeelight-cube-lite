import { LitElement, html, css } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  createEntitySelector,
  getLightEntities,
  entitySelectorStyles,
  createYeelightCubeEntityPicker,
} from "./entity-selector-utils.js";
import { fireEvent, renderModeSettingsSection } from "./editor_ui_utils.js";

// localStorage key and event for gradient mode visibility
const LS_GRADIENT_MODE_VISIBILITY = "yeelight-gradient-mode-visibility";
const EVT_GRADIENT_MODE_VISIBILITY_RESET =
  "yeelight-gradient-mode-visibility-reset";

class YeelightCubeGradientCardEditor extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      _globalOpen: { type: Boolean },
      _colorModeOpen: { type: Boolean },
      _angleOpen: { type: Boolean },
      _previewOpen: { type: Boolean },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._globalOpen = false;
    this._colorModeOpen = false;
    this._angleOpen = false;
    this._previewOpen = false;
  }

  setConfig(config) {
    this._config = { ...config };
    // Force a re-render after config is set to avoid template errors
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Auto-disable visibility edit mode when editor closes
    if (this._config && this._config.edit_gradient_modes) {
      this._config = { ...this._config, edit_gradient_modes: false };
      this._fireConfigChanged();
    }
  }

  _hasGradientModeVisibilityChanges() {
    try {
      const stored = localStorage.getItem(LS_GRADIENT_MODE_VISIBILITY);
      if (!stored) return false;
      const parsed = JSON.parse(stored);
      return Object.values(parsed).some((v) => v === false);
    } catch {
      return false;
    }
  }

  _resetGradientModeVisibility() {
    try {
      localStorage.removeItem(LS_GRADIENT_MODE_VISIBILITY);
      window.dispatchEvent(
        new CustomEvent(EVT_GRADIENT_MODE_VISIBILITY_RESET, {
          bubbles: true,
          composed: true,
        }),
      );
      this.requestUpdate();
    } catch (error) {
      console.error(
        "[Gradient Editor] Error resetting mode visibility:",
        error,
      );
    }
  }

  getConfig() {
    return this._config;
  }

  static getConfigElement() {
    return document.createElement("yeelight-cube-gradient-card-editor");
  }

  _valueChanged(ev) {
    const target = ev.target;
    if (!target) return;
    let key = target.id || target.name;
    let value = target.type === "checkbox" ? target.checked : target.value;

    if (key === "title" && value === "") value = undefined;

    this._config = { ...this._config, [key]: value };

    this._fireConfigChanged();
  }

  _entityChanged = (ev) => {
    this._config = { ...this._config, entity: ev.target.value };
    this._fireConfigChanged();
  };

  _renderEntityPicker() {
    const selectedCount = (this._config.target_entities || []).length;
    const message =
      selectedCount > 0
        ? `${selectedCount} entities selected for gradient operations`
        : "No entities selected for gradient operations";

    // Create wrapper callback that handles the array from entity picker
    const handleEntityChange = (event) => {
      const newSelectedEntities = event.target.value; // This is an array

      // Update config directly with the new array
      this._config = { ...this._config, target_entities: newSelectedEntities };

      this._fireConfigChanged();
      this.requestUpdate();
    };

    return createYeelightCubeEntityPicker(
      this.hass,
      this._config.target_entities || [],
      handleEntityChange,
      message,
    );
  }

  _colorInfoChanged(ev) {
    const target = ev.target;
    if (!target) return;

    // Update config with new color info display option
    this._config = { ...this._config, color_info_display: target.value };
    this._fireConfigChanged();
  }

  _handleColorInfoChange(ev) {
    const target = ev.target;
    if (!target || !target.dataset.value) return;

    // Update config with new color info display option
    this._config = {
      ...this._config,
      color_info_display: target.dataset.value,
    };
    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    const config = {
      type: "custom:yeelight-cube-gradient-card",
      ...this._config,
    };
    fireEvent(this, "config-changed", { config });
  }

  _getUnifiedRotaryStyle(cfg) {
    // Handle backward compatibility and convert to unified style
    if (cfg.rotary_unified_style) {
      return cfg.rotary_unified_style;
    }

    // Convert from old format
    const oldStyle = cfg.angle_rotary_style || "default";
    const oldShape = cfg.default_shape || "rectangle";

    if (oldStyle === "wheel") {
      return "wheel";
    } else if (oldStyle === "rect") {
      return "rectangle";
    } else if (oldStyle === "default") {
      if (oldShape === "arrow_classic") {
        return "arrow";
      } else if (oldShape === "star") {
        return "star";
      } else {
        return "turning_rectangle";
      }
    }

    return "turning_rectangle"; // default fallback
  }

  _toggleSection(section) {
    if (section === "global") {
      this._globalOpen = !this._globalOpen;
    } else if (section === "colormode") {
      this._colorModeOpen = !this._colorModeOpen;
    } else if (section === "angle") {
      this._angleOpen = !this._angleOpen;
    } else if (section === "preview") {
      this._previewOpen = !this._previewOpen;
    }
  }

  static get styles() {
    return [
      buttonGroupStyles,
      entitySelectorStyles,
      css`
        .editor-root {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 18px 8px 8px 8px;
        }
        .editor-card {
          background: var(--secondary-background-color, #f7fafd);
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
          transition:
            max-height 0.3s,
            opacity 0.3s;
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
          flex-direction: column;
          align-items: stretch;
          gap: 6px;
          margin-bottom: 16px;
        }
        label {
          font-weight: 500;
          color: var(--primary-text-color, #333);
          font-size: 1em;
        }
        input[type="text"],
        select {
          width: 100%;
          padding: 8px 12px;
          font-size: 1em;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #cfd8dc);
          margin-top: 2px;
          margin-bottom: 10px;
          box-sizing: border-box;
          background: var(--secondary-background-color, #f7f8fa);
        }
        .toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .config-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .config-label {
          font-weight: 500;
          color: var(--primary-text-color, #333);
          font-size: 1em;
        }
        .config-row select {
          padding: 6px 12px;
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: 8px;
          background: var(--card-background-color, white);
          font-size: 0.9em;
          color: var(--primary-text-color, #333);
          min-width: 140px;
        }
        .config-row select:focus {
          outline: none;
          border-color: var(--primary-color, #0969da);
          box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
        }
        .toggle-label {
          font-weight: 500;
          color: var(--primary-text-color, #333);
          font-size: 1em;
        }
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--divider-color, #cfd8dc);
          transition: 0.2s;
          border-radius: 24px;
        }
        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: var(--card-background-color, white);
          transition: 0.2s;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        }
        input:checked + .toggle-slider {
          background-color: var(--primary-color, #1976d2);
        }
        input:checked + .toggle-slider:before {
          transform: translateX(20px);
        }

        /* Range input premium styling */
        input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--divider-color, #e0e0e0);
          outline: none;
          cursor: pointer;
          margin: 8px 0;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: var(--primary-color, #1976d2);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          border: none;
          transition: all 0.2s ease;
        }
        input[type="range"]::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: var(--primary-color, #1976d2);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          border: none;
          transition: all 0.2s ease;
        }

        /* Color info group styles (specific to this component) */
        .color-info-group {
          display: flex;
          border-radius: 8px;
          overflow: hidden;
          border: 1.5px solid var(--divider-color, #d0d7de);
          margin-top: 8px;
        }

        .color-info-btn {
          flex: 1;
          padding: 8px 12px;
          border: none;
          background: var(--card-background-color, white);
          color: var(--primary-text-color, #333);
          font-size: 0.85em;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          border-right: 1px solid var(--divider-color, #d0d7de);
          text-align: center;
          white-space: nowrap;
        }

        .color-info-btn:last-child {
          border-right: none;
        }

        .color-info-btn:hover {
          background: var(--secondary-background-color, #f6f8fa);
        }

        .color-info-btn.active {
          background: var(--primary-color, #0969da);
          color: var(--text-primary-color, #fff);
        }

        .color-info-btn.active:hover {
          background: var(--primary-color, #0860ca);
        }

        /* Override margin for second row of button groups */
        .button-group-second-row .button-group {
          margin-top: 0 !important;
        }
      `,
    ];
  }

  render() {
    const cfg = this._config || {};

    const chevronIcon = (folded) => html`
      <ha-icon
        icon="mdi:chevron-up"
        style="transition:transform 0.4s;transform:rotate(${folded
          ? 180
          : 0}deg);"
      ></ha-icon>
    `;

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
              <label>Title (optional)</label>
              <input
                id="title"
                type="text"
                .value="${cfg.title || ""}"
                placeholder="Gradient Controls"
                @input="${this._valueChanged}"
              />
            </div>
            <div class="form-row">
              <label>Light Entities</label>
              ${this._renderEntityPicker()}
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Card Background</label>
              <label class="toggle-switch">
                <input
                  id="show_card_background"
                  type="checkbox"
                  .checked="${cfg.show_card_background !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div
          class="editor-card${!this._colorModeOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("colormode")}"
          >
            Color Mode Selector ${chevronIcon(!this._colorModeOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Color Mode Selector</label>
              <label class="toggle-switch">
                <input
                  id="show_color_mode_selector"
                  type="checkbox"
                  .checked="${cfg.show_color_mode_selector !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="form-row">
              <label>Color Mode Selector Style</label>
              ${createButtonGroup(
                [
                  { value: "buttons", label: "Buttons" },
                  { value: "colorized", label: "Colorized" },
                  { value: "dropdown", label: "Dropdown" },
                  { value: "compact", label: "Compact" },
                  { value: "pills", label: "Pills" },
                ],
                cfg.color_mode_style || "buttons",
                createButtonGroupChangeHandler("color_mode_style", (value) => {
                  this._config = {
                    ...this._config,
                    color_mode_style: value,
                  };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            <div class="form-row">
              <label>Button Text Color</label>
              ${createButtonGroup(
                [
                  { value: "white", label: "White" },
                  { value: "black", label: "Black" },
                ],
                cfg.button_text_color || "white",
                createButtonGroupChangeHandler("button_text_color", (value) => {
                  this._config = {
                    ...this._config,
                    button_text_color: value,
                  };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            <div class="form-row">
              <label>Panel Toggle Style</label>
              ${createButtonGroup(
                [
                  { value: "default", label: "Default" },
                  { value: "switch", label: "Switch" },
                  { value: "card", label: "Card" },
                ],
                cfg.panel_toggle_style || "default",
                createButtonGroupChangeHandler(
                  "panel_toggle_style",
                  (value) => {
                    this._config = {
                      ...this._config,
                      panel_toggle_style: value,
                    };
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
          </div>
        </div>

        <div
          class="editor-card${!this._angleOpen ? " editor-card-collapsed" : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("angle")}"
          >
            Angle Selector ${chevronIcon(!this._angleOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Angle Section</label>
              <label class="toggle-switch">
                <input
                  id="show_angle_section"
                  type="checkbox"
                  .checked="${cfg.show_angle_section !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="toggle-row">
              <label class="toggle-label">Show Angle Input Field</label>
              <label class="toggle-switch">
                <input
                  id="show_angle_input"
                  type="checkbox"
                  .checked="${cfg.show_angle_input !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Angle Slider</label>
              <label class="toggle-switch">
                <input
                  id="show_angle_slider"
                  type="checkbox"
                  .checked="${cfg.show_angle_slider !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Rotary Preview</label>
              <label class="toggle-switch">
                <input
                  id="show_angle_rotary"
                  type="checkbox"
                  .checked="${cfg.show_angle_rotary !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Selector Dot</label>
              <label class="toggle-switch">
                <input
                  id="show_selector_dot"
                  type="checkbox"
                  .checked="${cfg.show_selector_dot !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Rotary in Header</label>
              <label class="toggle-switch">
                <input
                  id="rotary_in_header"
                  type="checkbox"
                  .checked="${cfg.rotary_in_header === true}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="config-row">
              <label class="config-label">Rotary Style</label>
              <div style="display: flex; flex-direction: column;">
                <div>
                  ${createButtonGroup(
                    [
                      {
                        value: "turning_rectangle",
                        label: "Turning Rectangle",
                        title: "Turning Rectangle",
                      },
                      {
                        value: "arrow",
                        label: "Arrow",
                        title: "Arrow Classic",
                      },
                      { value: "star", label: "Star", title: "Star Shape" },
                    ],
                    this._getUnifiedRotaryStyle(cfg),
                    createButtonGroupChangeHandler(
                      "rotary_unified_style",
                      (value) => {
                        this._config = {
                          ...this._config,
                          rotary_unified_style: value,
                        };
                        this._fireConfigChanged();
                      },
                    ),
                  )}
                </div>
                <div class="button-group-second-row">
                  ${createButtonGroup(
                    [
                      { value: "wheel", label: "Wheel", title: "Color Wheel" },
                      {
                        value: "rectangle",
                        label: "Rectangle",
                        title: "Rectangle",
                      },
                      {
                        value: "square",
                        label: "Square",
                        title: "Square Shape",
                      },
                    ],
                    this._getUnifiedRotaryStyle(cfg),
                    createButtonGroupChangeHandler(
                      "rotary_unified_style",
                      (value) => {
                        this._config = {
                          ...this._config,
                          rotary_unified_style: value,
                        };
                        this._fireConfigChanged();
                      },
                    ),
                  )}
                </div>
              </div>
            </div>
            <div class="config-row">
              <label class="config-label">Rotary Size</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="rotary_size"
                  type="range"
                  min="30"
                  max="100"
                  step="5"
                  .value="${cfg.rotary_size || 80}"
                  @input="${this._valueChanged}"
                  style="flex: 1;"
                />
                <span
                  style="min-width: 45px; text-align: right; font-size: 0.9em; color: var(--secondary-text-color, #666);"
                >
                  ${cfg.rotary_size || 80}%
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Gradient Preview Settings -->
        <div class="editor-card ${this._previewOpen ? "expanded" : ""}">
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("preview")}"
          >
            Gradient Preview ${chevronIcon(!this._previewOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Mode Visibility</label>
              <div style="display:flex;align-items:center;gap:8px;">
                ${this._hasGradientModeVisibilityChanges()
                  ? html`
                      <button
                        type="button"
                        @click="${this._resetGradientModeVisibility}"
                        style="padding:4px 10px;border:1px solid var(--divider-color, #ddd);border-radius:4px;background:var(--secondary-background-color, #f5f5f5);color:var(--secondary-text-color, #666);cursor:pointer;font-size:0.8em;white-space:nowrap;"
                        title="Show all modes (reset visibility to all visible)"
                      >
                        👁 Reset
                      </button>
                    `
                  : ""}
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    id="edit_gradient_modes"
                    .checked="${this._config.edit_gradient_modes ?? false}"
                    @change="${(e) => {
                      this._config = {
                        ...this._config,
                        edit_gradient_modes: e.target.checked,
                      };
                      this._fireConfigChanged();
                    }}"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div
              style="font-size:0.85em;color:var(--secondary-text-color, #666);margin-top:2px;margin-bottom:8px;"
            >
              Enable mode editing: show/hide toggles appear on each gradient
              preview. Toggle visibility by clicking the eye icon (👁) on each
              mode.
            </div>

            <!-- 1. Preview Display Mode (container layout choice) -->
            <div class="config-row">
              <label class="config-label">Preview Display Mode</label>
              <div style="display: flex; flex-direction: column;">
                <div>
                  ${createButtonGroup(
                    [
                      {
                        value: "list",
                        label: "List",
                        title: "Responsive list layout",
                      },
                      {
                        value: "compact",
                        label: "Compact",
                        title: "Horizontal inline list",
                      },
                      {
                        value: "wheel",
                        label: "Wheel",
                        title: "iOS-style rotating picker",
                      },
                    ],
                    { inline: "list", grid: "list", gallery: "list" }[
                      cfg.preview_display_mode
                    ] ||
                      cfg.preview_display_mode ||
                      "list",
                    createButtonGroupChangeHandler(
                      "preview_display_mode",
                      (value) => {
                        this._config = {
                          ...this._config,
                          preview_display_mode: value,
                        };
                        this._fireConfigChanged();
                      },
                    ),
                  )}
                </div>
              </div>
            </div>

            <!-- 2. Conditional mode settings (right after Display Mode) -->
            ${cfg.preview_display_mode === "wheel"
              ? renderModeSettingsSection(
                  "Wheel Mode Settings",
                  html`
                    <div class="form-row">
                      <label>Wheel Navigation Position</label>
                      ${createButtonGroup(
                        [
                          {
                            value: "none",
                            label: "None",
                            title: "Hide navigation buttons",
                          },
                          {
                            value: "bottom",
                            label: "Bottom",
                            title: "Buttons at bottom center",
                          },
                          {
                            value: "sides",
                            label: "Sides",
                            title: "Buttons on left/right of center item",
                          },
                        ],
                        cfg.wheel_nav_position || "bottom",
                        createButtonGroupChangeHandler(
                          "wheel_nav_position",
                          (value) => {
                            this._config = {
                              ...this._config,
                              wheel_nav_position: value,
                            };
                            this._fireConfigChanged();
                          },
                        ),
                      )}
                    </div>
                    <div class="form-row">
                      <label>Wheel Height</label>
                      <div
                        style="display: flex; align-items: center; gap: 8px;"
                      >
                        <input
                          id="wheel_height"
                          type="range"
                          min="65"
                          max="255"
                          step="10"
                          .value="${cfg.wheel_height || 300}"
                          @input="${this._valueChanged}"
                          style="flex: 1;"
                        />
                        <span
                          style="min-width: 45px; text-align: right; font-size: 0.9em; color: var(--secondary-text-color, #666);"
                        >
                          ${cfg.wheel_height || 300}px
                        </span>
                      </div>
                    </div>
                  `,
                )
              : ""}

            <!-- 3. Gallery appearance settings -->
            <div class="config-row">
              <label class="config-label">Preview Background Color</label>
              <div style="display: flex; flex-direction: column;">
                <div>
                  ${createButtonGroup(
                    [
                      {
                        value: "transparent",
                        label: "Transparent",
                        title: "Transparent Background",
                      },
                      {
                        value: "#ffffff",
                        label: "White",
                        title: "White Background",
                      },
                      {
                        value: "#000000",
                        label: "Black",
                        title: "Black Background",
                      },
                    ],
                    cfg.gallery_background_color || "#000000",
                    createButtonGroupChangeHandler(
                      "gallery_background_color",
                      (value) => {
                        this._config = {
                          ...this._config,
                          gallery_background_color: value,
                        };
                        this._fireConfigChanged();
                      },
                    ),
                  )}
                </div>
              </div>
            </div>

            ${(cfg.gallery_background_color || "#000000") !== "#000000"
              ? html`
                  <div class="toggle-row">
                    <label class="toggle-label">Ignore Black Pixels</label>
                    <label class="toggle-switch">
                      <input
                        id="gallery_ignore_black_pixels"
                        type="checkbox"
                        .checked="${cfg.gallery_ignore_black_pixels === true}"
                        @change="${this._valueChanged}"
                      />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                `
              : ""}

            <div class="config-row">
              <label class="config-label">Gallery Pixel Style</label>
              <div style="display: flex; flex-direction: column;">
                <div>
                  ${createButtonGroup(
                    [
                      {
                        value: "square",
                        label: "Square",
                        title: "Square Pixels",
                      },
                      {
                        value: "rounded",
                        label: "Rounded",
                        title: "Rounded Pixels",
                      },
                      {
                        value: "circle",
                        label: "Circle",
                        title: "Circular Pixels",
                      },
                    ],
                    cfg.gallery_pixel_style || "square",
                    createButtonGroupChangeHandler(
                      "gallery_pixel_style",
                      (value) => {
                        this._config = {
                          ...this._config,
                          gallery_pixel_style: value,
                        };
                        this._fireConfigChanged();
                      },
                    ),
                  )}
                </div>
              </div>
            </div>

            <div class="config-row">
              <label class="config-label">Gallery Pixel Gap</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="gallery_pixel_gap"
                  type="range"
                  min="0"
                  max="5"
                  step="0.5"
                  .value="${cfg.gallery_pixel_gap !== undefined
                    ? cfg.gallery_pixel_gap
                    : 1}"
                  @input="${this._valueChanged}"
                  style="flex: 1;"
                />
                <span
                  style="min-width: 45px; text-align: right; font-size: 0.9em; color: var(--secondary-text-color, #666);"
                >
                  ${cfg.gallery_pixel_gap !== undefined
                    ? cfg.gallery_pixel_gap
                    : 1}px
                </span>
              </div>
            </div>

            <div class="config-row">
              <label class="config-label">Gallery Preview Size</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="gallery_preview_size"
                  type="range"
                  min="120"
                  max="450"
                  step="10"
                  .value="${cfg.gallery_preview_size || 200}"
                  @input="${this._valueChanged}"
                  style="flex: 1;"
                />
                <span
                  style="min-width: 45px; text-align: right; font-size: 0.9em; color: var(--secondary-text-color, #666);"
                >
                  ${cfg.gallery_preview_size || 200}px
                </span>
              </div>
            </div>

            <!-- 4. Content & Labels -->
            <div class="toggle-row">
              <label class="toggle-label">Show Titles</label>
              <label class="toggle-switch">
                <input
                  id="preview_show_titles"
                  type="checkbox"
                  .checked="${cfg.preview_show_titles !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="toggle-row">
              <label class="toggle-label">Highlight Active Mode</label>
              <label class="toggle-switch">
                <input
                  id="highlight_active_mode"
                  type="checkbox"
                  .checked="${cfg.highlight_active_mode !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("yeelight-cube-gradient-card-editor")) {
  customElements.define(
    "yeelight-cube-gradient-card-editor",
    YeelightCubeGradientCardEditor,
  );
}
