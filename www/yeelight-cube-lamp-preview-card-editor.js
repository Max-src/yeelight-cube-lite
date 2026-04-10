import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit@2.8.0/index.js?module";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  createEntitySelector,
  getLightEntities,
  createYeelightCubeEntityPicker,
  getYeelightCubeEntities,
  entitySelectorStyles,
} from "./entity-selector-utils.js";
import { fireEvent } from "./editor_ui_utils.js";

// Editor class for the Yeelight Cube Lite Lamp Preview Card
class YeelightCubeLampPreviewCardEditor extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      _globalOpen: { type: Boolean },
      _lampPreviewOpen: { type: Boolean },
      _lampControlOpen: { type: Boolean },
      _brightnessSettingsOpen: { type: Boolean },
      _colorAdjustmentsOpen: { type: Boolean },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._globalOpen = false;
    this._lampPreviewOpen = false;
    this._lampControlOpen = false;
    this._brightnessSettingsOpen = false;
    this._colorAdjustmentsOpen = false;
  }

  setConfig(config) {
    // Apply the same defaults as the card component
    this._config = {
      show_card_background: true,
      size: "medium",
      size_pct: 100, // Default matrix size to 100%
      align: "center",
      matrix_pixel_gap: 4, // Default pixel gap to 4px
      matrix_background: "black", // Black background by default
      matrix_box_shadow: true, // Keep matrix box shadow enabled
      matrix_pixel_style: "round", // Keep round pixel style
      lamp_dot_shadow: true, // Keep pixel box shadow enabled
      show_force_refresh_button: true, // Default force refresh button to enabled
      buttons_style: "classic", // New: default style for all buttons
      show_brightness_slider: true, // Show brightness slider by default
      brightness_slider_style: "slider", // Default brightness slider style
      brightness_slider_appearance: "default", // Default slider appearance
      brightness_theme: "subtle", // Default brightness theme (matches section_style naming)
      show_brightness_label: true, // Show "Brightness" label above slider
      ...config,
    };
  }

  getConfig() {
    return this._config;
  }

  static getConfigElement() {
    return document.createElement("yeelight-cube-lamp-preview-card-editor");
  }

  _valueChanged(ev) {
    const target = ev.target;
    if (!target) return;
    let key = target.id || target.name;
    let value;
    if (target.type === "checkbox") {
      value = target.checked;
    } else if (target.type === "number" || target.type === "range") {
      value = Number(target.value);
    } else if (target.tagName === "SELECT") {
      value =
        target.value === "false"
          ? false
          : target.value === "true"
            ? true
            : target.value;
    } else {
      value = target.value;
    }
    this._config = { ...this._config, [key]: value };
    this._fireConfigChanged();
  }

  _entityChanged = (ev) => {
    this._config = { ...this._config, entity: ev.target.value };
    this._fireConfigChanged();
  };

  _fireConfigChanged() {
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: this._config } }),
    );
  }

  _toggleSection(section) {
    if (section === "global") {
      this._globalOpen = !this._globalOpen;
    } else if (section === "lampPreview") {
      this._lampPreviewOpen = !this._lampPreviewOpen;
    } else if (section === "lampControl") {
      this._lampControlOpen = !this._lampControlOpen;
    } else if (section === "brightnessSettings") {
      this._brightnessSettingsOpen = !this._brightnessSettingsOpen;
    } else if (section === "colorAdjustments") {
      this._colorAdjustmentsOpen = !this._colorAdjustmentsOpen;
    }
  }

  static styles = [
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
        margin-bottom: 2px;
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
      .toggle-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .toggle-label {
        font-weight: 500;
        color: var(--primary-text-color, #333);
        font-size: 1em;
      }
      .toggle-switch {
        position: relative;
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
      input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(
          to right,
          var(--primary-color, #1976d2) 0%,
          var(--primary-color, #1976d2) var(--value, 0%),
          var(--divider-color, #e0e0e0) var(--value, 0%),
          var(--divider-color, #e0e0e0) 100%
        );
        outline: none;
        cursor: pointer;
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
      ${buttonGroupStyles}
    `,
  ];

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
              <label>Card Title (optional)</label>
              <input
                id="card_title"
                type="text"
                placeholder="Lamp Preview"
                .value="${cfg.card_title || ""}"
                @input="${this._valueChanged}"
              />
            </div>
            <div class="form-row">
              <label>Light Entity</label>
              ${createYeelightCubeEntityPicker(
                this.hass,
                cfg.entity ? [cfg.entity] : [],
                this._entityChanged,
                "single",
              )}
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
          class="editor-card${!this._lampPreviewOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("lampPreview")}"
          >
            Lamp Preview ${chevronIcon(!this._lampPreviewOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Lamp Preview</label>
              <label class="toggle-switch">
                <input
                  id="show_lamp_preview"
                  type="checkbox"
                  .checked="${cfg.show_lamp_preview !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="config-row">
              <label class="config-label">Matrix Size</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="size_pct"
                  type="range"
                  min="50"
                  max="100"
                  .value="${cfg.size_pct || 100}"
                  @input="${this._valueChanged}"
                  style="flex: 1;"
                />
                <span
                  style="min-width: 45px; text-align: right; font-size: 0.9em; color: var(--secondary-text-color, #666);"
                >
                  ${cfg.size_pct || 100}%
                </span>
              </div>
            </div>
            <div class="config-row">
              <label class="config-label">Pixel Gap</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  id="matrix_pixel_gap"
                  type="range"
                  min="0"
                  max="6"
                  .value="${cfg.matrix_pixel_gap ?? 4}"
                  @input="${this._valueChanged}"
                  style="flex: 1;"
                />
                <span
                  style="min-width: 45px; text-align: right; font-size: 0.9em; color: var(--secondary-text-color, #666);"
                >
                  ${cfg.matrix_pixel_gap ?? 4}px
                </span>
              </div>
            </div>
            <div class="form-row">
              <label>Matrix Background Color</label>
              ${createButtonGroup(
                [
                  { value: "transparent", label: "Transparent" },
                  { value: "white", label: "White" },
                  { value: "black", label: "Black" },
                ],
                cfg.matrix_background || "black",
                createButtonGroupChangeHandler("matrix_background", (value) => {
                  this._config = { ...this._config, matrix_background: value };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Matrix Box Shadow</label>
              <label class="toggle-switch">
                <input
                  id="matrix_box_shadow"
                  type="checkbox"
                  .checked="${cfg.matrix_box_shadow !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Pixel Box Shadow</label>
              <label class="toggle-switch">
                <input
                  id="lamp_dot_shadow"
                  type="checkbox"
                  .checked="${cfg.lamp_dot_shadow !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            ${(cfg.matrix_background || "black") !== "black"
              ? html`
                  <div class="toggle-row">
                    <label class="toggle-label">Ignore Black Pixels</label>
                    <label class="toggle-switch">
                      <input
                        id="hide_black_dots"
                        type="checkbox"
                        .checked="${cfg.hide_black_dots !== false}"
                        @change="${this._valueChanged}"
                      />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                `
              : ""}
            <div class="form-row">
              <label>Matrix Pixel Style</label>
              ${createButtonGroup(
                [
                  { value: "round", label: "Round" },
                  { value: "square", label: "Square" },
                ],
                cfg.matrix_pixel_style || "round",
                createButtonGroupChangeHandler(
                  "matrix_pixel_style",
                  (value) => {
                    this._config = {
                      ...this._config,
                      matrix_pixel_style: value,
                    };
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
          </div>
        </div>

        <div
          class="editor-card${!this._lampControlOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("lampControl")}"
          >
            Power / Refresh Actions ${chevronIcon(!this._lampControlOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Power Button</label>
              <label class="toggle-switch">
                <input
                  id="show_power_toggle"
                  type="checkbox"
                  .checked="${cfg.show_power_toggle !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Force Refresh Button</label>
              <label class="toggle-switch">
                <input
                  id="show_force_refresh_button"
                  type="checkbox"
                  .checked="${cfg.show_force_refresh_button !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="form-row">
              <label>Buttons Style</label>
              ${createButtonGroup(
                [
                  { value: "modern", label: "Modern" },
                  { value: "classic", label: "Classic" },
                  { value: "outline", label: "Outline" },
                  { value: "gradient", label: "Gradient" },
                  { value: "icon", label: "Icon" },
                  { value: "pill", label: "Pill" },
                ],
                cfg.buttons_style || "classic",
                createButtonGroupChangeHandler("buttons_style", (value) => {
                  this._config = {
                    ...this._config,
                    buttons_style: value,
                  };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            ${(cfg.buttons_style || "classic") !== "icon"
              ? html`
                  <div class="form-row">
                    <label>Content Mode</label>
                    ${createButtonGroup(
                      [
                        { value: "icon", label: "Icon" },
                        { value: "text", label: "Text" },
                        { value: "icon_text", label: "Icon + Text" },
                      ],
                      cfg.buttons_content_mode || "icon_text",
                      createButtonGroupChangeHandler(
                        "buttons_content_mode",
                        (value) => {
                          this._config = {
                            ...this._config,
                            buttons_content_mode: value,
                          };
                          this._fireConfigChanged();
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

        <div
          class="editor-card${!this._brightnessSettingsOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("brightnessSettings")}"
          >
            Brightness Settings ${chevronIcon(!this._brightnessSettingsOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Brightness Slider</label>
              <label class="toggle-switch">
                <input
                  id="show_brightness_slider"
                  type="checkbox"
                  .checked="${cfg.show_brightness_slider === true}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Brightness Percentage</label>
              <label class="toggle-switch">
                <input
                  id="show_brightness_percentage"
                  type="checkbox"
                  .checked="${cfg.show_brightness_percentage !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Brightness Label</label>
              <label class="toggle-switch">
                <input
                  id="show_brightness_label"
                  type="checkbox"
                  .checked="${cfg.show_brightness_label !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="form-row">
              <label>Brightness Slider Style</label>
              ${createButtonGroup(
                [
                  { value: "slider", label: "Slider" },
                  { value: "bar", label: "Bar" },
                  { value: "rotary", label: "Rotary" },
                  { value: "capsule", label: "Capsule" },
                ],
                cfg.brightness_slider_style || "slider",
                createButtonGroupChangeHandler(
                  "brightness_slider_style",
                  (value) => {
                    this._config = {
                      ...this._config,
                      brightness_slider_style: value,
                    };
                    this._fireConfigChanged();
                    this.requestUpdate();
                  },
                ),
              )}
            </div>
            ${cfg.brightness_slider_style === "slider" ||
            !cfg.brightness_slider_style
              ? html`
                  <div class="form-row">
                    <label>Slider Appearance</label>
                    ${createButtonGroup(
                      [
                        { value: "default", label: "Default" },
                        { value: "thick", label: "Thick" },
                        { value: "thin", label: "Thin" },
                      ],
                      cfg.brightness_slider_appearance || "default",
                      createButtonGroupChangeHandler(
                        "brightness_slider_appearance",
                        (value) => {
                          this._config = {
                            ...this._config,
                            brightness_slider_appearance: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                `
              : ""}
            <div class="form-row">
              <label>Brightness Theme</label>
              ${createButtonGroup(
                [
                  {
                    value: "flat",
                    label: "Flat",
                    icon: "▬",
                  },
                  {
                    value: "subtle",
                    label: "Subtle",
                    icon: "🔲",
                  },
                  {
                    value: "filled",
                    label: "Filled",
                    icon: "■",
                  },
                ],
                cfg.brightness_theme ||
                  (cfg.capsule_theme === "dark"
                    ? "filled"
                    : cfg.capsule_theme === "transparent"
                      ? "flat"
                      : "subtle"),
                createButtonGroupChangeHandler("brightness_theme", (value) => {
                  this._config = {
                    ...this._config,
                    brightness_theme: value,
                  };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            ${cfg.brightness_slider_style === "capsule"
              ? html`
                  <div class="toggle-row">
                    <label class="toggle-label">Show Moon Icon (🌙)</label>
                    <label class="toggle-switch">
                      <input
                        id="show_capsule_moon_icon"
                        type="checkbox"
                        .checked=${cfg.show_capsule_moon_icon !== false}
                        @change="${this._valueChanged}"
                      />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="toggle-row">
                    <label class="toggle-label">Show Sun Icon (☀️)</label>
                    <label class="toggle-switch">
                      <input
                        id="show_capsule_sun_icon"
                        type="checkbox"
                        .checked=${cfg.show_capsule_sun_icon !== false}
                        @change="${this._valueChanged}"
                      />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                `
              : ""}
          </div>
        </div>

        <div
          class="editor-card${!this._colorAdjustmentsOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("colorAdjustments")}"
          >
            Color Adjustments ${chevronIcon(!this._colorAdjustmentsOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Adjustment Controls</label>
              <label class="toggle-switch">
                <input
                  id="show_adjustment_controls"
                  type="checkbox"
                  .checked="${cfg.show_adjustment_controls ?? false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            ${cfg.show_adjustment_controls
              ? html`
                  <div class="form-row">
                    <label>Adjustments Layout Mode</label>
                    ${createButtonGroup(
                      [
                        { value: "compact", label: "Compact", icon: "☰" },
                        { value: "tabbed", label: "Tabbed", icon: "📑" },
                        { value: "grouped", label: "Grouped", icon: "📦" },
                        { value: "radial", label: "Radial", icon: "⭕" },
                        {
                          value: "categories",
                          label: "Categories",
                          icon: "🏷️",
                        },
                      ],
                      cfg.adjustments_layout || "grouped",
                      createButtonGroupChangeHandler(
                        "adjustments_layout",
                        (value) => {
                          this._config = {
                            ...this._config,
                            adjustments_layout: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                  <div class="form-row">
                    <label>Section Style</label>
                    ${createButtonGroup(
                      [
                        {
                          value: "flat",
                          label: "Flat",
                          icon: "▬",
                        },
                        {
                          value: "subtle",
                          label: "Subtle",
                          icon: "🔲",
                        },
                        {
                          value: "filled",
                          label: "Filled",
                          icon: "■",
                        },
                      ],
                      cfg.section_style ||
                        cfg.grouped_section_style ||
                        "subtle",
                      createButtonGroupChangeHandler(
                        "section_style",
                        (value) => {
                          this._config = {
                            ...this._config,
                            section_style: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                  <div class="toggle-row">
                    <label class="toggle-label">Show Change Indicator</label>
                    <label class="toggle-switch">
                      <input
                        id="show_change_indicators"
                        type="checkbox"
                        .checked="${cfg.show_change_indicators ?? true}"
                        @change="${this._valueChanged}"
                      />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="form-row">
                    <label>Reset Button Visibility</label>
                    ${createButtonGroup(
                      [
                        { value: "always", label: "Always", icon: "👁️" },
                        { value: "changed", label: "When Changed", icon: "🔶" },
                        { value: "never", label: "Never", icon: "🚫" },
                      ],
                      cfg.reset_button_mode || "always",
                      createButtonGroupChangeHandler(
                        "reset_button_mode",
                        (value) => {
                          this._config = {
                            ...this._config,
                            reset_button_mode: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                `
              : ""}
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("yeelight-cube-lamp-preview-card-editor")) {
  customElements.define(
    "yeelight-cube-lamp-preview-card-editor",
    YeelightCubeLampPreviewCardEditor,
  );
}
