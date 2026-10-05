import "./preview-appearance-editor.js";
import { LitElement, html, css } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  createEntitySelector,
  entitySelectorStyles,
} from "./entity-selector-utils.js";
import {
  fireEvent,
  sharedEditorStyles,
  YeelightEditorMixin,
  renderModeSettingsSection,
} from "./editor_ui_utils.js";
import { normalizeCardOptions } from "./card-config.js";
import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import {
  formRowStyles,
  createToggleRow,
  createSliderRow,
} from "./form-row-utils.js";
import {
  renderOrderableList,
  orderableListStyles,
} from "./orderable-list-utils.js";
import { GRADIENT_MODES } from "./yeelight-cube-gradient-card.js";
import { defineOnce } from "./card-registration.js";

class YeelightCubeGradientCardEditor extends YeelightEditorMixin(LitElement) {
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
    this._config = { ...normalizeCardOptions(config, "gradient") };
    // Migrate deprecated rotary styles to new combined modes
    if (this._config.rotary_unified_style === "arrow_window") {
      this._config.rotary_unified_style = "wheel";
      if (this._config.wheel_show_mask === undefined) {
        this._config.wheel_show_mask = true;
      }
    } else if (this._config.rotary_unified_style === "beam") {
      this._config.rotary_unified_style = "compass";
      if (!this._config.compass_shape) {
        this._config.compass_shape = "beam";
      }
    } else if (this._config.rotary_unified_style === "arrow") {
      this._config.rotary_unified_style = "compass";
      if (!this._config.compass_shape) {
        this._config.compass_shape = "arrow";
      }
    } else if (this._config.rotary_unified_style === "star") {
      this._config.rotary_unified_style = "compass";
      if (!this._config.compass_shape) {
        this._config.compass_shape = "star";
      }
    } else if (this._config.rotary_unified_style === "turning_rectangle") {
      this._config.rotary_unified_style = "compass";
      if (!this._config.compass_shape) {
        this._config.compass_shape = "rectangle";
      }
    }
    // Migrate old standalone "square" style into rectangle + rectangle_shape
    if (this._config.rotary_unified_style === "square") {
      this._config.rotary_unified_style = "rectangle";
      if (!this._config.rectangle_shape) {
        this._config.rectangle_shape = "square";
      }
    }
    // Migrate compass_show_labels boolean to compass_labels_mode
    if (
      this._config.compass_show_labels !== undefined &&
      !this._config.compass_labels_mode
    ) {
      this._config.compass_labels_mode = this._config.compass_show_labels
        ? "under"
        : "none";
    }
    // --- Unified mode selector migration -----------------------------------
    // The old separate "color mode selector" (text buttons) and "gradient
    // preview" (clickable previews) are now ONE selector with a single
    // style_selector_style key.  Legacy configs always showed the preview
    // section, so they migrate to the matching preview style.
    if (!this._config.style_selector_style) {
      const legacyMap = {
        inline: "preview-list",
        grid: "preview-list",
        gallery: "preview-list",
        list: "preview-list",
        compact: "preview-row",
        wheel: "preview-wheel",
      };
      this._config.style_selector_style =
        legacyMap[this._config.preview_display_mode] || "preview-list";
    }
    // Legacy show_color_mode_selector=false hid the panel toggle too (it
    // lived inside the text selector block) — preserve that intent.
    if (
      this._config.show_color_mode_selector === false &&
      this._config.show_panel_toggle === undefined
    ) {
      this._config.show_panel_toggle = false;
    }
    // Drop superseded keys so saved configs stay clean
    delete this._config.show_color_mode_selector;
    delete this._config.color_mode_style;
    delete this._config.preview_display_mode;
    // Legacy text styles (buttons / pills / compact / colorized) are all
    // merged into the single "filled" style.
    if (
      ["buttons", "pills", "compact", "colorized"].includes(
        this._config.style_selector_style,
      )
    ) {
      this._config.style_selector_style = "filled";
    }
    delete this._config.button_text_color;
    // Migrate removed "preview-row" style to "preview-list"
    if (this._config.style_selector_style === "preview-row") {
      this._config.style_selector_style = "preview-list";
    }
    // Migrate legacy panel toggle styles
    if (this._config.panel_toggle_style === "default") {
      this._config.panel_toggle_style = "minimal";
    }
    if (this._config.panel_toggle_style === "segmented") {
      this._config.panel_toggle_style = "tabs";
    }
    // Force a re-render after config is set to avoid template errors
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  // Ordered list of modes shown in the selector (all modes when unset).
  _visibleModeList() {
    const list = this._config?.visible_modes;
    return Array.isArray(list) && list.length ? list : [...GRADIENT_MODES];
  }

  _renderVisibleModeList() {
    const list = this._visibleModeList();
    return renderOrderableList({
      items: list,
      available: GRADIENT_MODES.filter((n) => !list.includes(n)),
      onUpdate: (l) => {
        this._config = { ...this._config, visible_modes: l };
        this._fireConfigChanged();
        this.requestUpdate();
      },
      onReset: () => {
        this._config = { ...this._config };
        delete this._config.visible_modes;
        this._fireConfigChanged();
        this.requestUpdate();
      },
      addPlaceholder: "Add a mode…",
      resetLabel: "Reset to all modes",
    });
  }

  getConfig() {
    return this._config;
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
        return "compass";
      } else if (oldShape === "star") {
        return "compass";
      } else {
        return "compass";
      }
    }

    return "compass"; // default fallback
  }

  static get styles() {
    return [
      sharedEditorStyles,
      formRowStyles,
      buttonGroupStyles,
      entitySelectorStyles,
      orderableListStyles,
      css`
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

  _renderAppearance(section) {
    return html`<yeelight-preview-appearance-editor
      profile="gradient"
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
        ${this._section(
          "preview_appearance",
          "Preview Appearance",
          this._renderAppearance("shared"),
        )}
        ${this._section("global", "Global Settings", html`
            ${this._cardFrameSettings({
              placeholder: "Gradient",
              lamps: "multiple",
            })}
        `)}

        ${this._section("label", "Active Mode Label", html`
            <div class="toggle-row">
              <label class="toggle-label">Show Active Mode Label</label>
              <label class="toggle-switch">
                <input
                  id="show_active_mode_label"
                  type="checkbox"
                  .checked="${cfg.show_active_mode_label === true}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            ${cfg.show_active_mode_label === true
              ? html`
                  <div class="form-row">
                    <label>Alignment</label>
                    ${createButtonGroup(
                      [
                        { value: "left", label: "Left" },
                        { value: "center", label: "Center" },
                        { value: "right", label: "Right" },
                      ],
                      cfg.active_mode_label_align || "left",
                      createButtonGroupChangeHandler(
                        "active_mode_label_align",
                        (value) => {
                          this._config = {
                            ...this._config,
                            active_mode_label_align: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                `
              : ""}
        `)}

        ${this._section("mode", "Mode Selector", html`
            <div class="toggle-row">
              <label class="toggle-label">Show Mode Selector</label>
              <label class="toggle-switch">
                <input
                  id="show_mode_selector"
                  type="checkbox"
                  .checked="${cfg.show_mode_selector !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            ${createToggleRow(
              "Customize visible modes",
              "custom_visible_modes",
              cfg.custom_visible_modes === true,
              (e) => {
                this._config = {
                  ...this._config,
                  custom_visible_modes: e.target.checked,
                };
                this._fireConfigChanged();
                this.requestUpdate();
              },
            )}
            ${cfg.custom_visible_modes === true
              ? renderModeSettingsSection(
                  "Visible Modes",
                  html`
                    <div
                      style="font-size:0.9em;color:var(--secondary-text-color,#666);margin-bottom:4px;"
                    >
                      Modes shown in the selector, in this order.
                    </div>
                    ${this._renderVisibleModeList()}
                  `,
                )
              : ""}
            <!-- The shared gallery settings (the same as the Clock and
                 Native Effects editors). -->
            ${renderStyleSelectorSettings(cfg, (key, value) => this._setOption(key, value), {
              allowChips: true,
              noun: "Mode",
              memory: (this._galleryMemory ||= {}),
              defaultSize: 50,
              renderAppearance: () => this._renderAppearance("gallery"),
            })}
        `)}

        ${this._section("panel", "Apply to Whole Panel", html`
            <div class="toggle-row">
              <label class="toggle-label">Show "Apply to Whole Panel"</label>
              <label class="toggle-switch">
                <input
                  id="show_panel_toggle"
                  type="checkbox"
                  .checked="${cfg.show_panel_toggle !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            ${cfg.show_panel_toggle !== false
              ? html`
                  <div class="form-row">
                    <label>Panel Toggle Style</label>
                    ${createButtonGroup(
                      [
                        { value: "minimal", label: "Minimal" },
                        { value: "switch", label: "Switch" },
                        { value: "card", label: "Card" },
                        { value: "tabs", label: "Tabs" },
                        { value: "chip", label: "Chip" },
                      ],
                      cfg.panel_toggle_style || "minimal",
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
                  <div class="form-row">
                    <label>Toggle Shape</label>
                    ${createButtonGroup(
                      [
                        { value: "square", label: "Square" },
                        { value: "rounded", label: "Rounded" },
                        { value: "round", label: "Round" },
                      ],
                      cfg.panel_toggle_shape || "round",
                      createButtonGroupChangeHandler(
                        "panel_toggle_shape",
                        (value) => {
                          this._config = {
                            ...this._config,
                            panel_toggle_shape: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                  ${
                    (cfg.panel_toggle_style || "minimal") !== "card" &&
                    (cfg.panel_toggle_style || "minimal") !== "tabs"
                      ? html`
                          <div class="form-row">
                            <label>Alignment</label>
                            ${createButtonGroup(
                              [
                                { value: "left", label: "Left" },
                                { value: "center", label: "Center" },
                                { value: "right", label: "Right" },
                              ],
                              cfg.panel_toggle_align || "left",
                              createButtonGroupChangeHandler(
                                "panel_toggle_align",
                                (value) => {
                                  this._config = {
                                    ...this._config,
                                    panel_toggle_align: value,
                                  };
                                  this._fireConfigChanged();
                                },
                              ),
                            )}
                          </div>
                        `
                      : ""
                  }
                  </div>
                `
              : ""}
        `)}

        ${this._section("angle", "Angle Selector", html`
            <div class="toggle-row">
              <label class="toggle-label">Show Angle Selector</label>
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

            <div class="form-row">
              <label>Show Angle Value</label>
              ${createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "text", label: "Text" },
                  { value: "input", label: "Input" },
                ],
                cfg.angle_value_display || "none",
                createButtonGroupChangeHandler(
                  "angle_value_display",
                  (value) => {
                    this._config = {
                      ...this._config,
                      angle_value_display: value,
                    };
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
            <div class="form-row">
              <label>Angle Selector Style</label>
              <div style="display: flex; flex-direction: column;">
                <div>
                  ${createButtonGroup(
                    [
                      {
                        value: "rectangle",
                        label: "Rectangle",
                        title: "Gradient Bar (Rectangle or Square)",
                      },
                      {
                        value: "wheel",
                        label: "Wheel",
                        title: "Gradient wheel with optional arrow mask",
                      },
                      {
                        value: "compass",
                        label: "Compass",
                        title: "Circular dial with configurable overlay shape",
                      },
                      {
                        value: "matrix_preview",
                        label: "Matrix",
                        title: "Mini Matrix — pixel grid preview of gradient",
                      },
                      {
                        value: "capsule",
                        label: "Capsule",
                        title: "Horizontal pill slider for angle",
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
            ${this._getUnifiedRotaryStyle(cfg) === "rectangle"
              ? renderModeSettingsSection(
                  "Rectangle Settings",
                  html`
                    <div class="form-row">
                      <label>Element Size</label>
                      <div
                        style="display: flex; align-items: center; gap: 8px;"
                      >
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
                    <div class="form-row">
                      <label>Shape</label>
                      <div style="display:flex;flex-direction:column;">
                        ${createButtonGroup(
                          [
                            {
                              value: "rectangle",
                              label: "Rectangle",
                              title: "Wide gradient bar (4:1)",
                            },
                            {
                              value: "square",
                              label: "Square",
                              title: "Square shape (1:1)",
                            },
                          ],
                          cfg.rectangle_shape || "rectangle",
                          createButtonGroupChangeHandler(
                            "rectangle_shape",
                            (value) => {
                              this._config = {
                                ...this._config,
                                rectangle_shape: value,
                              };
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                    <div class="toggle-row">
                      <label class="toggle-label">Snap to Coordinates</label>
                      <label class="toggle-switch">
                        <input
                          id="compass_snap_to_coordinates"
                          type="checkbox"
                          .checked="${cfg.compass_snap_to_coordinates === true}"
                          @change="${this._valueChanged}"
                        />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                  `,
                )
              : ""}
            ${this._getUnifiedRotaryStyle(cfg) === "wheel"
              ? renderModeSettingsSection(
                  "Wheel Settings",
                  html`
                    <div class="form-row">
                      <label>Element Size</label>
                      <div
                        style="display: flex; align-items: center; gap: 8px;"
                      >
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
                      <label class="toggle-label">Show Arrow Mask</label>
                      <label class="toggle-switch">
                        <input
                          id="wheel_show_mask"
                          type="checkbox"
                          .checked="${cfg.wheel_show_mask === true}"
                          @change="${this._valueChanged}"
                        />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                    <div class="toggle-row">
                      <label class="toggle-label">Snap to Coordinates</label>
                      <label class="toggle-switch">
                        <input
                          id="compass_snap_to_coordinates"
                          type="checkbox"
                          .checked="${cfg.compass_snap_to_coordinates === true}"
                          @change="${this._valueChanged}"
                        />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                  `,
                )
              : ""}
            ${this._getUnifiedRotaryStyle(cfg) === "compass"
              ? renderModeSettingsSection(
                  "Compass Settings",
                  html`
                    <div class="form-row">
                      <label>Element Size</label>
                      <div
                        style="display: flex; align-items: center; gap: 8px;"
                      >
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
                    <div class="form-row">
                      <label>Overlay Shape</label>
                      <div style="display:flex;flex-direction:column;">
                        ${createButtonGroup(
                          [
                            {
                              value: "none",
                              label: "None",
                              title: "No overlay shape, just selector dot",
                            },
                            {
                              value: "needle",
                              label: "Needle",
                              title: "Tapered diamond needle",
                            },
                            {
                              value: "beam",
                              label: "Beam",
                              title: "Spotlight wedge beam",
                            },
                            {
                              value: "arrow",
                              label: "Arrow",
                              title: "Arrow shape overlay",
                            },
                            {
                              value: "star",
                              label: "Star",
                              title: "Five-pointed star overlay",
                            },
                            {
                              value: "rectangle",
                              label: "Rectangle",
                              title: "Turning rectangle overlay",
                            },
                          ],
                          cfg.compass_shape || "none",
                          createButtonGroupChangeHandler(
                            "compass_shape",
                            (value) => {
                              this._config = {
                                ...this._config,
                                compass_shape: value,
                              };
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                    <div class="form-row">
                      <label>Coordinates</label>
                      <div style="display:flex;flex-direction:column;">
                        ${createButtonGroup(
                          [
                            {
                              value: "none",
                              label: "None",
                              title: "No coordinate labels",
                            },
                            {
                              value: "under",
                              label: "Under",
                              title: "Coordinates behind shape/colors",
                            },
                            {
                              value: "over",
                              label: "Over",
                              title: "Coordinates always visible over shape",
                            },
                          ],
                          cfg.compass_labels_mode || "under",
                          createButtonGroupChangeHandler(
                            "compass_labels_mode",
                            (value) => {
                              this._config = {
                                ...this._config,
                                compass_labels_mode: value,
                              };
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                    <div class="toggle-row">
                      <label class="toggle-label">Snap to Coordinates</label>
                      <label class="toggle-switch">
                        <input
                          id="compass_snap_to_coordinates"
                          type="checkbox"
                          .checked="${cfg.compass_snap_to_coordinates === true}"
                          @change="${this._valueChanged}"
                        />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                  `,
                )
              : ""}
            ${this._getUnifiedRotaryStyle(cfg) === "matrix_preview"
              ? renderModeSettingsSection(
                  "Matrix Preview Settings",
                  html`
                    ${createSliderRow(
                      "Element Size",
                      cfg.rotary_size || 80,
                      { min: 30, max: 100, step: 5 },
                      (e) => {
                        this._config = {
                          ...this._config,
                          rotary_size: e.target.value,
                        };
                        this._fireConfigChanged();
                      },
                      "%",
                    )}
                    ${this._renderAppearance("rotary")}
                    ${createToggleRow(
                      "Show Text Preview",
                      "matrix_rotary_text_preview",
                      cfg.matrix_rotary_text_preview === true,
                      (e) => this._valueChanged(e),
                    )}
                  `,
                )
              : ""}
            ${this._getUnifiedRotaryStyle(cfg) === "capsule"
              ? renderModeSettingsSection(
                  "Capsule Settings",
                  html`
                    <div class="form-row">
                      <label>Theme</label>
                      <div style="display:flex;flex-direction:column;">
                        ${createButtonGroup(
                          [
                            {
                              value: "flat",
                              label: "Flat",
                              title: "No background, blends with card",
                            },
                            {
                              value: "subtle",
                              label: "Subtle",
                              title: "Light tinted background",
                            },
                            {
                              value: "filled",
                              label: "Filled",
                              title: "Deeper background, strong contrast",
                            },
                          ],
                          cfg.capsule_theme || "subtle",
                          createButtonGroupChangeHandler(
                            "capsule_theme",
                            (value) => {
                              this._config = {
                                ...this._config,
                                capsule_theme: value,
                              };
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                    <div class="form-row">
                      <label>Thickness</label>
                      <div style="display:flex;align-items:center;gap:8px;">
                        <input
                          id="capsule_thickness"
                          type="range"
                          min="2"
                          max="10"
                          step="1"
                          .value="${cfg.capsule_thickness ?? 6}"
                          @input="${this._valueChanged}"
                          style="flex:1;"
                        />
                        <span
                          style="min-width:45px;text-align:right;font-size:0.9em;color:var(--secondary-text-color, #666);"
                        >
                          ${cfg.capsule_thickness ?? 6}px
                        </span>
                      </div>
                    </div>
                    <div class="toggle-row">
                      <label class="toggle-label">Snap to Coordinates</label>
                      <label class="toggle-switch">
                        <input
                          id="compass_snap_to_coordinates"
                          type="checkbox"
                          .checked="${cfg.compass_snap_to_coordinates === true}"
                          @change="${this._valueChanged}"
                        />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                    ${(cfg.angle_value_display || "none") !== "none"
                      ? html`
                          <div class="form-row">
                            <label>Angle Value Side</label>
                            ${createButtonGroup(
                              [
                                { value: "left", label: "Left" },
                                { value: "under", label: "Under" },
                                { value: "right", label: "Right" },
                              ],
                              cfg.capsule_angle_value_side || "right",
                              createButtonGroupChangeHandler(
                                "capsule_angle_value_side",
                                (value) => {
                                  this._config = {
                                    ...this._config,
                                    capsule_angle_value_side: value,
                                  };
                                  this._fireConfigChanged();
                                },
                              ),
                            )}
                          </div>
                        `
                      : ""}
                  `,
                )
              : ""}
        `)}
      </div>
    `;
  }
}

defineOnce("yeelight-cube-gradient-card-editor", YeelightCubeGradientCardEditor);
