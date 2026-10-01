import "./preview-appearance-editor.js";
import { renderModeControlSettings } from "./mode-controls-settings.js";
import { lampActionConfig } from "./mode-controls-controller.js";
import { orderableListStyles } from "./orderable-list-utils.js";
import { renderOrientationSettings } from "./orientation-control-ui.js";
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
  renderEditorSection,
  renderModeSettingsSection,
} from "./editor_ui_utils.js";
import {
  formRowStyles,
  createToggleRow,
  createSliderRow,
} from "./form-row-utils.js";
import { renderLightSliderSettings } from "./slider-control-utils.js";
import { resolveCapsuleThickness } from "./capsule-slider-utils.js";
import { BRIGHTNESS_SLIDER_KEYS } from "./yeelight-cube-lamp-preview-card.js";
import { defineOnce } from "./card-registration.js";

// Editor class for the Yeelight Cube Lite Lamp Preview Card
class YeelightCubeLampPreviewCardEditor extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._open = {};
  }

  setConfig(config) {
    // Apply the same defaults as the card component
    this._config = {
      show_card_background: true,
      size: "medium",
      size_pct: 100, // Default matrix size to 100%
      align: "center",
      matrix_spacing_mode: "normal", // Default pixel spacing mode
      matrix_background: "black", // Black background by default
      matrix_box_shadow: true, // Keep matrix box shadow enabled
      matrix_pixel_style: "square", // Default pixel style
      buttons_style: "classic", // New: default style for all buttons
      show_brightness_slider: true, // Show brightness slider by default
      brightness_slider_style: "slider", // Default brightness slider style
      brightness_slider_appearance: "default", // Legacy slider appearance (migrated to thickness)
      brightness_slider_thickness: 6, // Track thickness in px (2-20, replaces appearance)
      brightness_theme: "subtle", // Default brightness theme (matches section_style naming)
      show_brightness_label: true, // Show "Brightness" label above slider
      ...lampActionConfig(config),
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

  _toggleSection(id) {
    this._open = { ...this._open, [id]: !this._open[id] };
  }

  _section(id, title, content) {
    return renderEditorSection(
      id,
      title,
      !!this._open[id],
      () => this._toggleSection(id),
      content,
    );
  }

  // Alias kept for callers (e.g. docs fixtures) that open the shared
  // appearance section directly.
  get _appearanceOpen() {
    return !!this._open?.preview_appearance;
  }

  set _appearanceOpen(value) {
    this._open = { ...this._open, preview_appearance: !!value };
  }

  static styles = [
    sharedEditorStyles,
    buttonGroupStyles,
    formRowStyles,
    entitySelectorStyles,
    orderableListStyles,
  ];

  _orientationChanged(key, value) {
    this._config = { ...this._config, [key]: value };
    if (key === "orientation_buttons") {
      delete this._config.orientation_layout;
      delete this._config.orientation_half_turn;
      delete this._config.orientation_directions;
    }
    this._fireConfigChanged();
  }

  _renderOrientationSettings() {
    return renderOrientationSettings(this._config, (key, value) =>
      this._orientationChanged(key, value),
    );
  }

  _renderAppearance(section) {
    return html`<yeelight-preview-appearance-editor
      profile="lamp"
      section=${section}
      .owner=${this}
      .config=${this._config}
      @appearance-changed=${(event) => {
        this._config = event.detail.config;
        this._fireConfigChanged();
      }}
    ></yeelight-preview-appearance-editor>`;
  }

  render() {
    const cfg = this._config || {};

    return html`
      <div class="editor-root">
        <!-- Global Settings -->
        ${this._section("global", "Global Settings", html`
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
        `)}

        <!-- Lamp Preview -->
        ${this._section(
          "preview_appearance",
          "Preview Appearance",
          this._renderAppearance("shared"),
        )}
        ${this._section("lampPreview", "Lamp Preview", html`
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
            ${this._renderAppearance("lamp")}
        `)}

        <!-- Actions -->
        ${this._section("lampControl", "Actions", html`
            ${renderModeControlSettings(
              "actions",
              cfg,
              (key, value) => {
                this._config = { ...this._config, [key]: value };
                this._fireConfigChanged();
              },
              [],
              "lamp",
            )}
        `)}

        <!-- Device Orientation -->
        ${this._section("deviceOrientation", "Device Orientation", html`
            ${createToggleRow(
              "Show Device Orientation Control",
              "show_device_orientation",
              cfg.show_device_orientation !== false,
              (e) => this._onToggleChange(e),
            )}
            ${cfg.show_device_orientation !== false
              ? this._renderOrientationSettings()
              : ""}
        `)}

        <!-- Brightness Settings -->
        ${this._section("brightnessSettings", "Brightness Settings", html`
            ${createToggleRow(
              "Show Brightness Slider",
              "show_brightness_slider",
              cfg.show_brightness_slider === true,
              (e) => this._onToggleChange(e),
            )}
            ${renderLightSliderSettings(
              cfg,
              (key, value) => {
                this._config = { ...this._config, [key]: value };
                this._fireConfigChanged();
                this.requestUpdate();
              },
              {
                keys: BRIGHTNESS_SLIDER_KEYS,
                showValueToggle: {
                  label: "Show Brightness Percentage",
                  key: BRIGHTNESS_SLIDER_KEYS.showValue,
                },
                icons: {
                  leftLabel: "Show Moon Icon (🌙)",
                  rightLabel: "Show Sun Icon (☀️)",
                },
                // Only this card lets the user pick the slider color.
                matrixColorKey: BRIGHTNESS_SLIDER_KEYS.color,
                thickness: resolveCapsuleThickness(
                  cfg.brightness_slider_thickness,
                  cfg.brightness_slider_appearance,
                  6,
                ),
              },
            )}
        `)}

        <!-- Color Adjustments -->
        ${this._section("colorAdjustments", "Color Adjustments", html`
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
        `)}
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

defineOnce("yeelight-cube-lamp-preview-card-editor", YeelightCubeLampPreviewCardEditor);
