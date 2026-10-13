import { renderActionButtonSettings } from "./action-button-ui.js";
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
  createToggleRow,
  createSliderRow,
} from "./form-row-utils.js";
import {
  fireEvent,
  YeelightEditorMixin,
  renderModeSettingsSection,
  renderDeleteButtonSettings,
  sharedEditorStyles,
} from "./editor_ui_utils.js";
import { defineOnce } from "./card-registration.js";
import { normalizeCardOptions } from "./card-config.js";

class YeelightCubeColorListEditorCardEditor extends YeelightEditorMixin(LitElement) {
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
    this._config = { ...normalizeCardOptions(config, "color-list-editor") };
    // Force a re-render after config is set to avoid template errors
    this.requestUpdate();
  }

  _fireConfigChanged() {
    const config = {
      type: "custom:yeelight-cube-color-list-editor-card",
      ...this._config,
    };
    fireEvent(this, "config-changed", { config });
  }

  static get styles() {
    return [sharedEditorStyles, buttonGroupStyles, entitySelectorStyles];
  }

  render() {
    const cfg = this._config || {};

    return html`
      <div class="editor-root">
        ${this._section("global", "Global Settings", html`
            ${this._cardFrameSettings({
              placeholder: "Colors",
              lamps: "multiple",
            })}
        `)}

        ${this._section("colorlist", "Color List Settings", html`
            ${createToggleRow(
              "Show Color Section",
              "show_color_section",
              cfg.show_color_section !== false,
              (e) => {
                this._setOption("show_color_section", e.target.checked);
              },
            )}
            ${createToggleRow(
              "Enable Color Picker",
              "enable_color_picker",
              cfg.enable_color_picker !== false,
              (e) => {
                this._setOption("enable_color_picker", e.target.checked);
              },
            )}
            ${createToggleRow(
              "Show Hex Input Field",
              "show_hex_input",
              cfg.show_hex_input !== false,
              (e) => {
                this._setOption("show_hex_input", e.target.checked);
              },
            )}
            ${createToggleRow(
              "Allow Drag & Drop",
              "allow_drag_drop",
              cfg.allow_drag_drop !== false,
              (e) => {
                this._setOption("allow_drag_drop", e.target.checked);
              },
            )}
            <!-- Card/Layout settings first (containers before content on them) -->
            <div class="form-row">
              <label>Color Info Display</label>
              ${createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "hex", label: "Hex Code" },
                  { value: "name", label: "Color Name" },
                ],
                cfg.color_info_display || "hex",
                createButtonGroupChangeHandler(
                  "color_info_display",
                  (value) => {
                    this._setOption("color_info_display", value);
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
                  this._setOption("list_layout", value);
                }),
              )}
            </div>
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
                            this._setOption("card_arrangement", value);
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
                            this._setOption("card_surface_effect", value);
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
                            this._setOption("card_shadow_style", value);
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
                            this._setOption("card_hover_effect", value);
                          },
                        ),
                      )}
                    </div>
                  `,
                )
              : ""}
            ${createSliderRow(
              "Item Radius",
              cfg.item_radius ?? 16,
              { min: 0, max: 28, step: 1 },
              (e) => this._setOption("item_radius", parseInt(e.target.value, 10)),
              "px",
            )}
            ${["cards", "grid", "rows", "tiles", "chips"].includes(
              cfg.list_layout,
            )
              ? createSliderRow(
                  "Size",
                  cfg.preview_size || 70,
                  { min: 50, max: 100, step: 5 },
                  (e) => this._setOption("preview_size", parseInt(e.target.value, 10)),
                  "%",
                )
              : ""}
            <!-- Delete button settings last (button lives on the cards) -->
            ${renderDeleteButtonSettings(cfg, {
              styleKey: "remove_button_style",
              commit: (key, value) => this._setOption(key, value),
            })}
        `)}

        <!-- Add/Shuffle/Save Actions Section -->
        ${this._section("actions", "Add/Shuffle/Save Actions", html`
            ${createToggleRow(
              "Show Add Color Button",
              "show_add_color_button",
              cfg.show_add_color_button !== false,
              (e) => {
                this._setOption("show_add_color_button", e.target.checked);
              },
            )}
            ${createToggleRow(
              "Show Randomize Button",
              "show_randomize_button",
              cfg.show_randomize_button !== false,
              (e) => {
                this._setOption("show_randomize_button", e.target.checked);
              },
            )}
            ${createToggleRow(
              "Show Save Palette Button",
              "show_save_palette",
              cfg.show_save_palette !== false,
              (e) => this._onSwitchChange(e, "show_save_palette"),
            )}
            ${renderActionButtonSettings(cfg, (key, value) =>
              this._setOption(key, value),
            )}
        `)}
      </div>
    `;
  }
}

defineOnce("yeelight-cube-color-list-editor-card-editor", YeelightCubeColorListEditorCardEditor);
