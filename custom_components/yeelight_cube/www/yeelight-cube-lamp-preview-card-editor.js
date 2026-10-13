import "./preview-appearance-editor.js";
import { renderModeControlSettings } from "./mode-controls-settings.js";
import { lampActionConfig } from "./mode-controls-controller.js";
import { orderableListStyles } from "./orderable-list-utils.js";
import { renderOrientationSettings } from "./orientation-control-ui.js";
import { LitElement, html } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  entitySelectorStyles,
} from "./entity-selector-utils.js";
import {
  sharedEditorStyles,
  YeelightEditorMixin,
  renderModeSettingsSection,
} from "./editor_ui_utils.js";
import {
  createToggleRow,
  createSliderRow,
} from "./form-row-utils.js";
import { renderLightSliderSettings } from "./slider-settings-ui.js";
import { resolveCapsuleThickness } from "./capsule-slider-utils.js";
import { normalizeCardOptions } from "./card-config.js";
import { defineOnce } from "./card-registration.js";

// Editor class for the Yeelight Cube Lite Lamp Preview Card
class YeelightCubeLampPreviewCardEditor extends YeelightEditorMixin(LitElement) {
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

  // Unset options keep the card's defaults (each row reads them): only what
  // the user changes is saved.
  setConfig(config) {
    this._config = lampActionConfig(normalizeCardOptions(config, "lamp-preview"));
  }

  getConfig() {
    return this._config;
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
    entitySelectorStyles,
    orderableListStyles,
  ];

  _renderOrientationSettings() {
    return renderOrientationSettings(this._config, (key, value) =>
      this._setOption(key, value),
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
            ${this._cardFrameSettings({
              placeholder: "Lamp",
              lamps: "single",
            })}
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
              (e) => this._onSwitchChange(e, e.target.id),
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
              (key, value) => this._setOption(key, value),
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
              (e) => this._onSwitchChange(e, e.target.id),
            )}
            ${cfg.show_device_orientation !== false
              ? this._renderOrientationSettings()
              : ""}
        `)}

        <!-- Brightness Settings -->
        ${this._section("brightnessSettings", "Brightness Settings", html`
            ${createToggleRow(
              "Show Brightness Slider",
              "show_brightness",
              cfg.show_brightness !== false,
              (e) => this._onSwitchChange(e, e.target.id),
            )}
            ${renderLightSliderSettings(
              cfg,
              (key, value) => this._setOption(key, value),
              {
                showValueToggle: {
                  label: "Show Brightness Percentage",
                  key: "slider_show_value",
                },
                icons: {
                  leftLabel: "Show Moon Icon (🌙)",
                  rightLabel: "Show Sun Icon (☀️)",
                },
                // Only this card lets the user pick the slider color.
                matrixColorKey: "slider_color",
                thickness: resolveCapsuleThickness(
                  cfg.slider_thickness,
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
              (e) => this._onSwitchChange(e, e.target.id),
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
                            this._setOption("adjustments_layout", value);
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
                            this._setOption("section_style", value);
                          },
                        ),
                      )}
                    </div>
                    ${createToggleRow(
                      "Show Change Indicator",
                      "show_change_indicators",
                      cfg.show_change_indicators ?? true,
                      (e) => this._onSwitchChange(e, e.target.id),
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
                            this._setOption("reset_button_mode", value);
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

  _onSliderChange(key, e) {
    this._setOption(key, Number(e.target.value));
  }
}

defineOnce("yeelight-cube-lamp-preview-card-editor", YeelightCubeLampPreviewCardEditor);
