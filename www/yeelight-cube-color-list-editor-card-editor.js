import { LitElement, html, css } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  getLightEntities,
  createYeelightCubeEntityPicker,
  getYeelightCubeEntities,
  entitySelectorStyles,
} from "./entity-selector-utils.js";
import { renderPercentageSlider, sliderStyles } from "./slider_utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { fireEvent, renderModeSettingsSection } from "./editor_ui_utils.js";

class YeelightCubeColorListEditorCardEditor extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      _globalOpen: { type: Boolean },
      _colorListOpen: { type: Boolean },
      _actionsOpen: { type: Boolean },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._globalOpen = false;
    this._colorListOpen = false;
    this._actionsOpen = false;
  }

  setConfig(config) {
    this._config = { ...config };
    // Force a re-render after config is set to avoid template errors
    this.requestUpdate();
  }

  getConfig() {
    return this._config;
  }

  static getConfigElement() {
    return document.createElement(
      "yeelight-cube-color-list-editor-card-editor",
    );
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
    // Handle multi-entity selection
    if (Array.isArray(ev.target.value)) {
      this._config = {
        ...this._config,
        target_entities: ev.target.value,
        // Keep the first entity as the main entity for backward compatibility
        entity: ev.target.value.length > 0 ? ev.target.value[0] : "",
      };
    } else {
      // Single entity selection (fallback)
      this._config = {
        ...this._config,
        entity: ev.target.value,
        target_entities: ev.target.value ? [ev.target.value] : [],
      };
    }
    this._fireConfigChanged();
  };

  _fireConfigChanged() {
    const config = {
      type: "custom:yeelight-cube-color-list-editor-card",
      ...this._config,
    };
    fireEvent(this, "config-changed", { config });
  }

  _toggleSection(section) {
    if (section === "global") {
      this._globalOpen = !this._globalOpen;
    } else if (section === "colorlist") {
      this._colorListOpen = !this._colorListOpen;
    } else if (section === "actions") {
      this._actionsOpen = !this._actionsOpen;
    }
    this.requestUpdate();
  }

  static get styles() {
    return [
      buttonGroupStyles,
      entitySelectorStyles,
      sliderStyles,
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
                placeholder="Colors"
                @input="${this._valueChanged}"
              />
            </div>
            <div class="form-row">
              <label>Entities</label>
              ${createYeelightCubeEntityPicker(
                this.hass,
                cfg.target_entities || (cfg.entity ? [cfg.entity] : []),
                this._entityChanged,
                "multiple",
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
          class="editor-card${!this._colorListOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("colorlist")}"
          >
            Color List Settings ${chevronIcon(!this._colorListOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Color Section</label>
              <label class="toggle-switch">
                <input
                  id="show_color_section"
                  type="checkbox"
                  .checked="${cfg.show_color_section !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Enable Color Picker</label>
              <label class="toggle-switch">
                <input
                  id="enable_color_picker"
                  type="checkbox"
                  .checked="${cfg.enable_color_picker !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Hex Input Field</label>
              <label class="toggle-switch">
                <input
                  id="show_hex_input"
                  type="checkbox"
                  .checked="${cfg.show_hex_input !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Allow Drag & Drop</label>
              <label class="toggle-switch">
                <input
                  id="allow_drag_drop"
                  type="checkbox"
                  .checked="${cfg.allow_drag_drop !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <!-- Card/Layout settings first (containers before content on them) -->
            <div class="form-row">
              <label>Color Info Display</label>
              ${createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "hex", label: "Hex" },
                  { value: "name", label: "Name" },
                ],
                cfg.color_info_display || "hex",
                createButtonGroupChangeHandler(
                  "color_info_display",
                  (value) => {
                    this._config = {
                      ...this._config,
                      color_info_display: value,
                    };
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
            <div class="form-row">
              <label>Colors Layout Mode</label>
              ${createButtonGroup(
                [
                  { value: "compact", label: "Compact", icon: "≡" },
                  { value: "chips", label: "Chips", icon: "◐" },
                  { value: "tiles", label: "Tiles", icon: "▢" },
                  { value: "rows", label: "Rows", icon: "▬" },
                  { value: "grid", label: "Grid", icon: "▦" },
                  { value: "cards", label: "Cards", icon: "🂠" },
                ],
                cfg.list_layout || "compact",
                createButtonGroupChangeHandler("list_layout", (value) => {
                  this._config = {
                    ...this._config,
                    list_layout: value,
                  };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            ${createSliderRow(
              "Card Roundness",
              (() => {
                const v = cfg.rounded_cards;
                if (v === undefined || v === true || v === "round") return 16;
                if (v === false || v === "square") return 0;
                if (v === "rounded") return 4;
                return typeof v === "number" ? v : parseInt(v, 10) || 16;
              })(),
              { min: 0, max: 28, step: 1 },
              (e) => {
                this._config = {
                  ...this._config,
                  rounded_cards: parseInt(e.target.value),
                };
                this._fireConfigChanged();
              },
              "px",
            )}
            ${["cards", "grid", "rows", "tiles", "chips", "compact"].includes(
              cfg.list_layout,
            )
              ? renderPercentageSlider(
                  "Element Size",
                  cfg.card_size || 70,
                  (e) => {
                    this._config = {
                      ...this._config,
                      card_size: parseInt(e.target.value),
                    };
                    this._fireConfigChanged();
                  },
                  { min: 30, max: 100, step: 5 },
                )
              : ""}
            ${cfg.list_layout === "cards"
              ? renderModeSettingsSection(
                  "Card Effects",
                  html`
                    <div class="form-row">
                      <label>Card Arrangement</label>
                      ${createButtonGroup(
                        [
                          { value: "hand", label: "Hand", icon: "🤚" },
                          { value: "spread", label: "Spread", icon: "🎴" },
                          { value: "cascade", label: "Cascade", icon: "🃏" },
                          { value: "tilt", label: "Tilt", icon: "📐" },
                          { value: "fan", label: "Fan", icon: "🦚" },
                        ],
                        cfg.card_arrangement || "hand",
                        createButtonGroupChangeHandler(
                          "card_arrangement",
                          (value) => {
                            this._config = {
                              ...this._config,
                              card_arrangement: value,
                            };
                            this._fireConfigChanged();
                          },
                        ),
                      )}
                    </div>
                    <div class="form-row">
                      <label>Card Surface Effect</label>
                      ${createButtonGroup(
                        [
                          { value: "none", label: "None" },
                          { value: "gloss", label: "Gloss" },
                          { value: "matte", label: "Matte" },
                          { value: "plastic", label: "Plastic" },
                        ],
                        cfg.card_surface_effect || "none",
                        createButtonGroupChangeHandler(
                          "card_surface_effect",
                          (value) => {
                            this._config = {
                              ...this._config,
                              card_surface_effect: value,
                            };
                            this._fireConfigChanged();
                          },
                        ),
                      )}
                    </div>
                    <div class="form-row">
                      <label>Card Shadow</label>
                      ${createButtonGroup(
                        [
                          { value: "none", label: "None" },
                          { value: "soft", label: "Soft" },
                          { value: "strong", label: "Strong" },
                          { value: "colored", label: "Colored" },
                        ],
                        cfg.card_shadow_style || "soft",
                        createButtonGroupChangeHandler(
                          "card_shadow_style",
                          (value) => {
                            this._config = {
                              ...this._config,
                              card_shadow_style: value,
                            };
                            this._fireConfigChanged();
                          },
                        ),
                      )}
                    </div>
                    <div class="form-row">
                      <label>Card Hover Effect</label>
                      ${createButtonGroup(
                        [
                          { value: "none", label: "None" },
                          { value: "lift", label: "Lift" },
                          { value: "glow", label: "Glow" },
                          { value: "spotlight", label: "Spotlight" },
                        ],
                        cfg.card_hover_effect || "lift",
                        createButtonGroupChangeHandler(
                          "card_hover_effect",
                          (value) => {
                            this._config = {
                              ...this._config,
                              card_hover_effect: value,
                            };
                            this._fireConfigChanged();
                          },
                        ),
                      )}
                    </div>
                  `,
                )
              : ""}
            <div class="form-row">
              <label>Item Card Border</label>
              ${createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "auto", label: "Auto" },
                  { value: "always", label: "Always" },
                ],
                cfg.item_card_border || "auto",
                createButtonGroupChangeHandler("item_card_border", (value) => {
                  this._config = {
                    ...this._config,
                    item_card_border: value,
                  };
                  this._fireConfigChanged();
                }),
              )}
            </div>

            <!-- Delete button settings last (button lives on the cards) -->
            <div class="form-row">
              <label>Delete Button Style</label>
              ${createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "default", label: "Default" },
                  { value: "glass", label: "Glass" },
                  { value: "red", label: "Red" },
                  { value: "black", label: "Black" },
                  { value: "dot", label: "Dot" },
                ],
                cfg.remove_button_style || "default",
                createButtonGroupChangeHandler(
                  "remove_button_style",
                  (value) => {
                    this._config = {
                      ...this._config,
                      remove_button_style: value,
                    };
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
            ${(cfg.remove_button_style || "default") !== "none"
              ? html`
                  <div class="form-row">
                    <label>Button Shape</label>
                    ${createButtonGroup(
                      [
                        { value: "round", label: "Round" },
                        { value: "rounded", label: "Rounded" },
                        { value: "square", label: "Square" },
                      ],
                      cfg.delete_button_shape || "round",
                      createButtonGroupChangeHandler(
                        "delete_button_shape",
                        (value) => {
                          this._config = {
                            ...this._config,
                            delete_button_shape: value,
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                  <div class="form-row">
                    <label>Button Position</label>
                    ${createButtonGroup(
                      [
                        { value: "inside", label: "Inside" },
                        { value: "outside", label: "Outside" },
                      ],
                      cfg.delete_button_inside === true ? "inside" : "outside",
                      createButtonGroupChangeHandler(
                        "delete_button_inside",
                        (value) => {
                          this._config = {
                            ...this._config,
                            delete_button_inside: value === "inside",
                          };
                          this._fireConfigChanged();
                        },
                      ),
                    )}
                  </div>
                  <div class="form-row">
                    <label>Delete Button Position</label>
                    ${createButtonGroup(
                      [
                        { value: "left", label: "Left" },
                        { value: "right", label: "Right" },
                      ],
                      cfg.delete_button_left === true ? "left" : "right",
                      createButtonGroupChangeHandler(
                        "delete_button_left",
                        (value) => {
                          this._config = {
                            ...this._config,
                            delete_button_left: value === "left",
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

        <!-- Add/Shuffle/Save Actions Section -->
        <div
          class="editor-card${!this._actionsOpen
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleSection("actions")}"
          >
            Add/Shuffle/Save Actions ${chevronIcon(!this._actionsOpen)}
          </div>
          <div class="editor-card-content">
            <div class="toggle-row">
              <label class="toggle-label">Show Add Color Button</label>
              <label class="toggle-switch">
                <input
                  id="show_add_color_button"
                  type="checkbox"
                  .checked="${cfg.show_add_color_button !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Randomize Button</label>
              <label class="toggle-switch">
                <input
                  id="show_randomize_button"
                  type="checkbox"
                  .checked="${cfg.show_randomize_button !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <label class="toggle-label">Show Save Palette Button</label>
              <label class="toggle-switch">
                <input
                  id="show_save_palette"
                  type="checkbox"
                  .checked="${cfg.show_save_palette !== false}"
                  @change="${this._valueChanged}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
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
                cfg.buttons_style || "modern",
                createButtonGroupChangeHandler("buttons_style", (value) => {
                  this._config = {
                    ...this._config,
                    buttons_style: value,
                  };
                  this._fireConfigChanged();
                }),
              )}
            </div>
            ${(cfg.buttons_style || "modern") !== "icon"
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
      </div>
    `;
  }
}

if (!customElements.get("yeelight-cube-color-list-editor-card-editor")) {
  customElements.define(
    "yeelight-cube-color-list-editor-card-editor",
    YeelightCubeColorListEditorCardEditor,
  );
}
