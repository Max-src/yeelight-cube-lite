import { LitElement, html, css } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  createYeelightCubeEntityPicker,
  entitySelectorStyles,
} from "./entity-selector-utils.js";
import {
  sharedEditorStyles,
  fireEvent,
  renderModeSettingsSection,
} from "./editor_ui_utils.js";
import {
  formRowStyles,
  createToggleRow,
  createSliderRow,
} from "./form-row-utils.js";

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
      brightness_slider_appearance: "default", // Legacy slider appearance (migrated to thickness)
      brightness_slider_thickness: 6, // Track thickness in px (2-20, replaces appearance)
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
    if (key === "title" && value === "") value = undefined;
    this._config = { ...this._config, [key]: value };
    this._fireConfigChanged();
  }

  _entityChanged = (ev) => {
    this._config = { ...this._config, entity: ev.target.value };
    this._fireConfigChanged();
  };

  _fireConfigChanged() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
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
    sharedEditorStyles,
    buttonGroupStyles,
    formRowStyles,
    entitySelectorStyles,
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
        <!-- Global Settings -->
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
                id="title"
                type="text"
                placeholder="Lamp"
                .value="${cfg.title ?? cfg.card_title ?? ""}"
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
            ${createToggleRow(
              "Show Card Background",
              "show_card_background",
              cfg.show_card_background !== false,
              (e) => this._onToggleChange(e),
            )}
          </div>
        </div>

        <!-- Lamp Preview -->
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
            ${createToggleRow(
              "Show Lamp Preview",
              "show_lamp_preview",
              cfg.show_lamp_preview !== false,
              (e) => this._onToggleChange(e),
            )}
            ${createSliderRow(
              "Matrix Size",
              cfg.size_pct || 100,
              { min: 50, max: 100, step: 1 },
              (e) => this._onSliderChange("size_pct", e),
              "%",
            )}
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
            ${(cfg.matrix_background || "black") !== "black"
              ? createToggleRow(
                  "Ignore Black Pixels",
                  "hide_black_dots",
                  cfg.hide_black_dots !== false,
                  (e) => this._onToggleChange(e),
                )
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
            ${createSliderRow(
              "Pixel Gap",
              cfg.matrix_pixel_gap ?? 4,
              { min: 0, max: 6, step: 1 },
              (e) => this._onSliderChange("matrix_pixel_gap", e),
              "px",
            )}
            ${createToggleRow(
              "Matrix Box Shadow",
              "matrix_box_shadow",
              cfg.matrix_box_shadow !== false,
              (e) => this._onToggleChange(e),
            )}
            ${createToggleRow(
              "Pixel Box Shadow",
              "lamp_dot_shadow",
              cfg.lamp_dot_shadow !== false,
              (e) => this._onToggleChange(e),
            )}
          </div>
        </div>

        <!-- Power / Refresh Actions -->
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
            ${createToggleRow(
              "Show Power Button",
              "show_power_toggle",
              cfg.show_power_toggle !== false,
              (e) => this._onToggleChange(e),
            )}
            ${createToggleRow(
              "Show Force Refresh Button",
              "show_force_refresh_button",
              cfg.show_force_refresh_button !== false,
              (e) => this._onToggleChange(e),
            )}
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

        <!-- Brightness Settings -->
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
            ${createToggleRow(
              "Show Brightness Slider",
              "show_brightness_slider",
              cfg.show_brightness_slider === true,
              (e) => this._onToggleChange(e),
            )}
            ${createToggleRow(
              "Show Brightness Label",
              "show_brightness_label",
              cfg.show_brightness_label !== false,
              (e) => this._onToggleChange(e),
            )}
            ${createToggleRow(
              "Show Brightness Percentage",
              "show_brightness_percentage",
              cfg.show_brightness_percentage !== false,
              (e) => this._onToggleChange(e),
            )}
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
            ${createSliderRow(
              "Slider Thickness",
              cfg.brightness_slider_thickness ??
                ({ thick: 12, thin: 3 }[cfg.brightness_slider_appearance] || 6),
              { min: 2, max: 10, step: 1 },
              (e) => this._onSliderChange("brightness_slider_thickness", e),
              "px",
            )}
            ${cfg.brightness_slider_style === "capsule"
              ? renderModeSettingsSection(
                  "Capsule Settings",
                  html`
                    ${createToggleRow(
                      "Show Moon Icon (🌙)",
                      "show_capsule_moon_icon",
                      cfg.show_capsule_moon_icon !== false,
                      (e) => this._onToggleChange(e),
                    )}
                    ${createToggleRow(
                      "Show Sun Icon (☀️)",
                      "show_capsule_sun_icon",
                      cfg.show_capsule_sun_icon !== false,
                      (e) => this._onToggleChange(e),
                    )}
                  `,
                )
              : ""}
            <div class="form-row">
              <label>Brightness Theme</label>
              ${createButtonGroup(
                [
                  { value: "flat", label: "Flat", icon: "▬" },
                  { value: "subtle", label: "Subtle", icon: "🔲" },
                  { value: "filled", label: "Filled", icon: "■" },
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
          </div>
        </div>

        <!-- Color Adjustments -->
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
            ${createToggleRow(
              "Show Adjustment Controls",
              "show_adjustment_controls",
              cfg.show_adjustment_controls ?? false,
              (e) => this._onToggleChange(e),
            )}
            ${cfg.show_adjustment_controls
              ? renderModeSettingsSection(
                  "Adjustment Settings",
                  html`
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
                          { value: "flat", label: "Flat", icon: "▬" },
                          { value: "subtle", label: "Subtle", icon: "🔲" },
                          { value: "filled", label: "Filled", icon: "■" },
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
                    ${createToggleRow(
                      "Show Change Indicator",
                      "show_change_indicators",
                      cfg.show_change_indicators ?? true,
                      (e) => this._onToggleChange(e),
                    )}
                    <div class="form-row">
                      <label>Reset Button Visibility</label>
                      ${createButtonGroup(
                        [
                          { value: "always", label: "Always", icon: "👁️" },
                          {
                            value: "changed",
                            label: "When Changed",
                            icon: "🔶",
                          },
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
                  `,
                )
              : ""}
          </div>
        </div>
      </div>
    `;
  }

  _onToggleChange(e) {
    const key = e.target.id;
    this._config = { ...this._config, [key]: e.target.checked };
    this._fireConfigChanged();
    this.requestUpdate();
  }

  _onSliderChange(key, e) {
    this._config = { ...this._config, [key]: Number(e.target.value) };
    this._fireConfigChanged();
  }
}

if (!customElements.get("yeelight-cube-lamp-preview-card-editor")) {
  customElements.define(
    "yeelight-cube-lamp-preview-card-editor",
    YeelightCubeLampPreviewCardEditor,
  );
}
