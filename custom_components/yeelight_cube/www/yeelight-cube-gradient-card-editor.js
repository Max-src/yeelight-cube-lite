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
import {
  fireEvent,
  sharedEditorStyles,
  renderModeSettingsSection,
} from "./editor_ui_utils.js";
import {
  formRowStyles,
  createToggleRow,
  createSliderRow,
} from "./form-row-utils.js";

// localStorage key and event for gradient mode visibility
const LS_GRADIENT_MODE_VISIBILITY = "yeelight-gradient-mode-visibility";
const EVT_GRADIENT_MODE_VISIBILITY_RESET =
  "yeelight-gradient-mode-visibility-reset";

class YeelightCubeGradientCardEditor extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      _globalOpen: { type: Boolean },
      _labelOpen: { type: Boolean },
      _modeOpen: { type: Boolean },
      _panelOpen: { type: Boolean },
      _angleOpen: { type: Boolean },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._globalOpen = false;
    this._labelOpen = false;
    this._modeOpen = false;
    this._panelOpen = false;
    this._angleOpen = false;
    // Remember the last style chosen within each family so toggling the
    // Selector Type back and forth restores the user's previous pick.
    this._lastTextStyle = "filled";
    this._lastPreviewStyle = "preview-list";
  }

  setConfig(config) {
    this._config = { ...config };
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
    // mode_selector_style key.  Legacy configs always showed the preview
    // section, so they migrate to the matching preview style.
    if (!this._config.mode_selector_style) {
      const legacyMap = {
        inline: "preview-list",
        grid: "preview-list",
        gallery: "preview-list",
        list: "preview-list",
        compact: "preview-row",
        wheel: "preview-wheel",
      };
      this._config.mode_selector_style =
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
        this._config.mode_selector_style,
      )
    ) {
      this._config.mode_selector_style = "filled";
    }
    delete this._config.button_text_color;
    // Migrate removed "preview-row" style to "preview-list"
    if (this._config.mode_selector_style === "preview-row") {
      this._config.mode_selector_style = "preview-list";
    }
    // Migrate legacy panel toggle styles
    if (this._config.panel_toggle_style === "default") {
      this._config.panel_toggle_style = "minimal";
    }
    if (this._config.panel_toggle_style === "segmented") {
      this._config.panel_toggle_style = "tabs";
    }
    // Seed the per-family style memory from the loaded config
    const _style = this._config.mode_selector_style || "preview-list";
    if (_style.startsWith("preview-")) {
      this._lastPreviewStyle = _style;
    } else {
      this._lastTextStyle = _style;
    }
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
        return "compass";
      } else if (oldShape === "star") {
        return "compass";
      } else {
        return "compass";
      }
    }

    return "compass"; // default fallback
  }

  _toggleSection(section) {
    if (section === "global") {
      this._globalOpen = !this._globalOpen;
    } else if (section === "label") {
      this._labelOpen = !this._labelOpen;
    } else if (section === "mode") {
      this._modeOpen = !this._modeOpen;
    } else if (section === "panel") {
      this._panelOpen = !this._panelOpen;
    } else if (section === "angle") {
      this._angleOpen = !this._angleOpen;
    }
  }

  static get styles() {
    return [
      sharedEditorStyles,
      formRowStyles,
      buttonGroupStyles,
      entitySelectorStyles,
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
                id="title"
                type="text"
                .value="${cfg.title || ""}"
                placeholder="Gradient"
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
          class="editor-card${!this._labelOpen ? " editor-card-collapsed" : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("label")}"
          >
            Active Mode Label ${chevronIcon(!this._labelOpen)}
          </div>
          <div class="editor-card-content">
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
          </div>
        </div>

        <div
          class="editor-card${!this._modeOpen ? " editor-card-collapsed" : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("mode")}"
          >
            Mode Selector ${chevronIcon(!this._modeOpen)}
          </div>
          <div class="editor-card-content">
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

            <!-- Selector Type: pick the family first, then only that family's
                 style picker + settings are shown, so the visible options
                 always match the active selector. -->
            <div class="form-row">
              <label>Selector Type</label>
              ${createButtonGroup(
                [
                  {
                    value: "text",
                    label: "Text",
                    title: "Lightweight buttons — no preview computation",
                  },
                  {
                    value: "preview",
                    label: "Live Preview",
                    title:
                      "Live mini-matrix of every mode with your text, colors and angle",
                  },
                ],
                (cfg.mode_selector_style || "preview-list").startsWith(
                  "preview-",
                )
                  ? "preview"
                  : "text",
                createButtonGroupChangeHandler("__selector_type", (value) => {
                  const current = this._config.mode_selector_style || "";
                  const isPreview = current.startsWith("preview-");
                  // Only switch style when crossing families; preserve the
                  // last-chosen style within a family where possible.
                  if (value === "preview" && !isPreview) {
                    this._config = {
                      ...this._config,
                      mode_selector_style:
                        this._lastPreviewStyle || "preview-list",
                    };
                    this._fireConfigChanged();
                  } else if (value === "text" && isPreview) {
                    this._config = {
                      ...this._config,
                      mode_selector_style: this._lastTextStyle || "filled",
                    };
                    this._fireConfigChanged();
                  }
                }),
              )}
            </div>

            ${!(cfg.mode_selector_style || "preview-list").startsWith(
              "preview-",
            )
              ? html`
                  <div class="form-row">
                    <label>Text Style</label>
                    ${createButtonGroup(
                      [
                        { value: "filled", label: "Filled" },
                        { value: "dropdown", label: "Dropdown" },
                        {
                          value: "chips",
                          label: "Chips",
                          title:
                            "Chips with a live gradient swatch per mode (follows colors + angle)",
                        },
                      ],
                      cfg.mode_selector_style || "filled",
                      createButtonGroupChangeHandler(
                        "mode_selector_style",
                        (value) => {
                          this._lastTextStyle = value;
                          this._config = {
                            ...this._config,
                            mode_selector_style: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                `
              : html`
                  <div class="form-row">
                    <label>Preview Style</label>
                    ${createButtonGroup(
                      [
                        {
                          value: "preview-list",
                          label: "List",
                          title: "Responsive list of live mode previews",
                        },
                        {
                          value: "preview-grid",
                          label: "Grid",
                          title: "Fixed two-column grid of live mode previews",
                        },
                        {
                          value: "preview-carousel",
                          label: "Carousel",
                          title:
                            "One preview at a time with arrows, dots and swipe navigation",
                        },
                        {
                          value: "preview-wheel",
                          label: "Wheel",
                          title: "iOS-style rotating picker with live previews",
                        },
                      ],
                      cfg.mode_selector_style || "preview-list",
                      createButtonGroupChangeHandler(
                        "mode_selector_style",
                        (value) => {
                          this._lastPreviewStyle = value;
                          this._config = {
                            ...this._config,
                            mode_selector_style: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                `}

            <!-- Shared appearance axes: apply to EVERY selector style -->
            <div class="form-row">
              <label>Shape</label>
              ${createButtonGroup(
                [
                  { value: "square", label: "Square" },
                  { value: "rounded", label: "Rounded" },
                  { value: "round", label: "Round" },
                ],
                cfg.selector_shape || "rounded",
                createButtonGroupChangeHandler("selector_shape", (value) => {
                  this._config = { ...this._config, selector_shape: value };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            ${createSliderRow(
              "Size",
              cfg.gallery_preview_size || 50,
              { min: 50, max: 100, step: 1 },
              (e) => {
                this._config = {
                  ...this._config,
                  gallery_preview_size: e.target.value,
                };
                this._fireConfigChanged();
              },
              "%",
            )}
            ${(cfg.mode_selector_style || "preview-list").startsWith("preview-")
              ? html`
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
                          .checked="${this._config.edit_gradient_modes ??
                          false}"
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
                    Enable mode editing: show/hide toggles appear on each
                    gradient preview. Toggle visibility by clicking the eye icon
                    (👁) on each mode.
                  </div>

                  ${cfg.mode_selector_style === "preview-wheel"
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
                                max="400"
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

                  <div class="form-row">
                    <label>Preview Background Color</label>
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
                              value: "white",
                              label: "White",
                              title: "White Background",
                            },
                            {
                              value: "black",
                              label: "Black",
                              title: "Black Background",
                            },
                          ],
                          cfg.gallery_background_color || "black",
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

                  ${(cfg.gallery_background_color || "black") !== "black"
                    ? createToggleRow(
                        "Ignore Black Pixels",
                        "gallery_ignore_black_pixels",
                        cfg.gallery_ignore_black_pixels === true,
                        (e) => this._valueChanged(e),
                      )
                    : ""}

                  <div class="form-row">
                    <label>Preview Pixel Style</label>
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

                  <div class="form-row">
                    <label>Pixel Spacing</label>
                    ${createButtonGroup(
                      [
                        { value: "none", label: "None" },
                        { value: "subtle", label: "Subtle" },
                        { value: "normal", label: "Normal" },
                      ],
                      cfg.gallery_spacing_mode || "normal",
                      createButtonGroupChangeHandler(
                        "gallery_spacing_mode",
                        (value) => {
                          this._config = {
                            ...this._config,
                            gallery_spacing_mode: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                  ${createToggleRow(
                    "Matrix Box Shadow",
                    "gallery_matrix_box_shadow",
                    cfg.gallery_matrix_box_shadow === true,
                    (e) => this._valueChanged(e),
                  )}
                  ${createToggleRow(
                    "Show Titles",
                    "preview_show_titles",
                    cfg.preview_show_titles !== false,
                    (e) => this._valueChanged(e),
                  )}
                  ${cfg.mode_selector_style !== "preview-carousel"
                    ? createToggleRow(
                        "Highlight Active Mode",
                        "highlight_active_mode",
                        cfg.highlight_active_mode !== false,
                        (e) => this._valueChanged(e),
                      )
                    : ""}
                `
              : ""}
          </div>
        </div>

        <div
          class="editor-card${!this._panelOpen ? " editor-card-collapsed" : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("panel")}"
          >
            Apply to Whole Panel ${chevronIcon(!this._panelOpen)}
          </div>
          <div class="editor-card-content">
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
                    ${createToggleRow(
                      "Show Text Preview",
                      "matrix_rotary_text_preview",
                      cfg.matrix_rotary_text_preview === true,
                      (e) => this._valueChanged(e),
                    )}
                    <div class="form-row">
                      <label>Background Color</label>
                      <div style="display:flex;flex-direction:column;">
                        ${createButtonGroup(
                          [
                            {
                              value: "transparent",
                              label: "Transparent",
                              title: "Transparent",
                            },
                            { value: "white", label: "White", title: "White" },
                            { value: "black", label: "Black", title: "Black" },
                          ],
                          cfg.matrix_rotary_bg_color || "black",
                          createButtonGroupChangeHandler(
                            "matrix_rotary_bg_color",
                            (value) => {
                              this._config = {
                                ...this._config,
                                matrix_rotary_bg_color: value,
                              };
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                    ${(cfg.matrix_rotary_bg_color || "black") !== "black"
                      ? createToggleRow(
                          "Ignore Black Pixels",
                          "matrix_rotary_ignore_black",
                          cfg.matrix_rotary_ignore_black === true,
                          (e) => this._valueChanged(e),
                        )
                      : ""}
                    <div class="form-row">
                      <label>Pixel Style</label>
                      <div style="display:flex;flex-direction:column;">
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
                          cfg.matrix_rotary_pixel_style || "square",
                          createButtonGroupChangeHandler(
                            "matrix_rotary_pixel_style",
                            (value) => {
                              this._config = {
                                ...this._config,
                                matrix_rotary_pixel_style: value,
                              };
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                    <div class="form-row">
                      <label>Pixel Spacing</label>
                      ${createButtonGroup(
                        [
                          { value: "none", label: "None" },
                          { value: "subtle", label: "Subtle" },
                          { value: "normal", label: "Normal" },
                        ],
                        cfg.matrix_rotary_spacing_mode || "normal",
                        createButtonGroupChangeHandler(
                          "matrix_rotary_spacing_mode",
                          (value) => {
                            this._config = {
                              ...this._config,
                              matrix_rotary_spacing_mode: value,
                            };
                            this._fireConfigChanged();
                          },
                        ),
                      )}
                    </div>
                    ${createToggleRow(
                      "Matrix Box Shadow",
                      "matrix_rotary_box_shadow",
                      cfg.matrix_rotary_box_shadow === true,
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
