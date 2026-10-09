import "./preview-appearance-editor.js";
import { orderableListStyles } from "./orderable-list-utils.js";
import { renderActionButtonSettings } from "./action-button-ui.js";
import { LitElement, html, css } from "./lib/lit-all.js";
import {
  sharedEditorStyles,
  YeelightEditorMixin,
  renderModeSettingsSection,
  renderModeInfoMessage,
  renderCarouselNavSettings,
} from "./editor_ui_utils.js";
import { normalizeCardOptions } from "./card-config.js";
import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  formRowStyles,
  createToggleRow,
  createSliderRow,
  createButtonGroupRow,
} from "./form-row-utils.js";
import {
  DEFAULT_TOOL_ORDER,
  DEFAULT_ACTION_ORDER,
  LS_TOOL_VISIBILITY,
  LS_ACTION_VISIBILITY,
  LS_ACTION_ORDER,
  EVT_TOOL_VISIBILITY_RESET,
  EVT_ACTION_ORDER_RESET,
  EVT_ACTION_VISIBILITY_RESET,
} from "./draw_card_const.js";
import { defineOnce } from "./card-registration.js";

class YeelightCubeDrawCardEditor extends YeelightEditorMixin(LitElement) {
  static get properties() {
    return {
      hass: { type: Object },
      _config: { type: Object },
      _open: { state: true },
    };
  }

  static get styles() {
    return [
      sharedEditorStyles,
      buttonGroupStyles,
      formRowStyles,
      orderableListStyles,
      css`
        /* Layout Section Styles (draw card editor specific) */
        .layout-sections {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 8px 0;
        }
        .layout-section {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          background: var(--secondary-background-color, #f8f9fa);
          border: 2px solid var(--divider-color, #e1e5e9);
          border-radius: 8px;
          transition: all 0.2s ease;
          user-select: none;
        }
        .layout-section:hover {
          background: var(--secondary-background-color, #e9ecef);
          border-color: var(--divider-color, #ced4da);
        }
        .layout-section-icon {
          font-size: 32px !important;
          margin-right: 16px !important;
          color: var(--primary-text-color, #333) !important;
          min-width: 32px;
          min-height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(
            in srgb,
            var(--primary-color, #0077cc) 10%,
            transparent
          );
          border-radius: 6px;
          border: 2px solid
            color-mix(in srgb, var(--primary-color, #0077cc) 20%, transparent);
        }
        .layout-section-info {
          flex: 1;
        }
        .layout-section-title {
          font-weight: 600;
          font-size: 1.1em;
          color: var(--primary-text-color, #333);
          margin-bottom: 2px;
        }
        .layout-section-desc {
          font-size: 0.9em;
          color: var(--secondary-text-color, #666);
        }
        .layout-section.section-hidden {
          opacity: 0.5;
          background: var(--secondary-background-color, #f0f0f0);
        }
        .layout-section.section-hidden .layout-section-title {
          text-decoration: line-through;
          color: var(--secondary-text-color, #888);
        }
      `,
    ];
  }

  constructor() {
    super();
    this._config = {};
    this.hass = null;
    this._open = {};

    // Throttle state for slider updates
    this._previewSizeUpdateScheduled = false;
    this._pendingPreviewSize = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Auto-disable "Tool Visibility Mode" when editor is closed
    if (this._config && this._config.edit_drawing_tools) {
      this._config = { ...this._config, edit_drawing_tools: false };

      // Fire a final config update to save the disabled state
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  // Layout management methods
  _getSectionInfo() {
    return {
      colors: {
        icon: "🎨",
        title: "Colors Section",
        desc: "Color palettes and picker",
      },
      tools: {
        icon: "🛠️",
        title: "Drawing Tools",
        desc: "Pencil, eraser, fill tools",
      },
      matrix: {
        icon: "⬜",
        title: "Drawing Matrix",
        desc: "Main 20×20 pixel grid",
      },
      actions: {
        icon: "⚡",
        title: "Action Buttons",
        desc: "Save, apply, clear buttons",
      },
      pixelart: {
        icon: "🖼️",
        title: "Pixel Art Gallery",
        desc: "Saved pixel art collection",
      },
    };
  }

  _renderLayoutSection() {
    const sections = this._getSectionInfo();

    // Default visibility settings
    const showSections = {
      colors: this._config.show_colors_section !== false,
      tools: this._config.show_tools_section !== false,
      matrix: this._config.show_matrix_section !== false,
      actions: this._config.show_actions_section !== false,
      pixelart: this._config.show_pixelart_section !== false,
    };

    // Fixed section order
    const sectionOrder = ["colors", "tools", "matrix", "actions", "pixelart"];

    return html`
      <div class="layout-sections">
        <p
          style="margin: 8px 0; color: var(--secondary-text-color, #666); font-size: 0.9em;"
        >
          Sections to display:
        </p>
        ${sectionOrder.map((sectionId) => {
          const section = sections[sectionId];
          if (!section) return "";

          return html`
            <div
              class="layout-section ${!showSections[sectionId]
                ? "section-hidden"
                : ""}"
            >
              <div class="layout-section-icon">${section.icon}</div>
              <div class="layout-section-info">
                <div class="layout-section-title">${section.title}</div>
                <div class="layout-section-desc">${section.desc}</div>
              </div>
              <label
                class="toggle-switch"
                style="margin: 0;"
                title="Show/hide this section"
              >
                <input
                  type="checkbox"
                  .checked="${showSections[sectionId]}"
                  @change="${(e) =>
                    this._onSectionVisibilityChange(
                      sectionId,
                      e.target.checked,
                    )}"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          `;
        })}
      </div>
    `;
  }

  _resetToolOrder() {
    this._config = { ...this._config, tools_order: [...DEFAULT_TOOL_ORDER] };
    this._fireConfigChanged();
  }

  _resetToolVisibility() {
    // Reset all tool visibility to default (all visible)
    // Clear the localStorage where tool visibility is actually stored
    try {
      localStorage.removeItem(LS_TOOL_VISIBILITY);

      // Fire a custom event to notify the main card to refresh tool visibility
      window.dispatchEvent(
        new CustomEvent(EVT_TOOL_VISIBILITY_RESET, {
          bubbles: true,
          composed: true,
        }),
      );
      this.requestUpdate();
    } catch (error) {
      console.warn("[EDITOR] Failed to reset tool visibility:", error);
    }
  }

  _hasToolVisibilityChanges() {
    try {
      const stored = localStorage.getItem(LS_TOOL_VISIBILITY);
      if (!stored) return false;
      const parsed = JSON.parse(stored);
      // If any tool is set to hidden, there are changes
      return Object.values(parsed).some((v) => v === false);
    } catch {
      return false;
    }
  }

  _resetActionOrder() {
    // Reset action order to default
    try {
      localStorage.removeItem(LS_ACTION_ORDER);

      // Fire a custom event to notify the main card to refresh action order
      window.dispatchEvent(
        new CustomEvent(EVT_ACTION_ORDER_RESET, {
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      console.warn("[EDITOR] Failed to reset action order:", error);
    }
  }

  _resetActionVisibility() {
    // Reset all action visibility to default (all visible)
    // Clear the localStorage where action visibility is actually stored
    try {
      localStorage.removeItem(LS_ACTION_VISIBILITY);

      // Fire a custom event to notify the main card to refresh action visibility
      window.dispatchEvent(
        new CustomEvent(EVT_ACTION_VISIBILITY_RESET, {
          bubbles: true,
          composed: true,
        }),
      );
      this.requestUpdate();
    } catch (error) {
      console.warn("[EDITOR] Failed to reset action visibility:", error);
    }
  }

  _hasActionVisibilityChanges() {
    try {
      const stored = localStorage.getItem(LS_ACTION_VISIBILITY);
      if (!stored) return false;
      const parsed = JSON.parse(stored);
      // If any action is set to hidden, there are changes
      return Object.values(parsed).some((v) => v === false);
    } catch {
      return false;
    }
  }

  _onSectionVisibilityChange(sectionId, visible) {
    this._config = { ...this._config, [`show_${sectionId}_section`]: visible };
    this._fireConfigChanged();
  }

  // Simple drag methods are implemented above in _initSimpleDrag()

  setConfig(config) {
    this._config = { ...normalizeCardOptions(config, "draw") };
    if (!this._config.pixel_spacing_mode)
      this._config.pixel_spacing_mode = "normal";
    if (!this._config.matrix_bg) this._config.matrix_bg = "black";
    if (typeof this._config.matrix_box_shadow !== "boolean")
      this._config.matrix_box_shadow = true;
    if (typeof this._config.preview_show_titles !== "boolean")
      this._config.preview_show_titles = true;
    if (!this._config.matrix_size) this._config.matrix_size = 100;
    if (!this._config.button_shape) this._config.button_shape = "rect";
    if (!this._config.actions_buttons_style)
      this._config.actions_buttons_style = "modern";
    if (!this._config.actions_content_mode)
      this._config.actions_content_mode = "icon";
    if (!this._config.tool_buttons_style)
      this._config.tool_buttons_style = "modern";
    if (!this._config.tool_content_mode) this._config.tool_content_mode = "icon";
    if (!this._config.paint_button_shape)
      this._config.paint_button_shape = "rect";
    if (!this._config.swatch_shape) this._config.swatch_shape = "round";
    if (!this._config.expand_btn_style) this._config.expand_btn_style = "pill";

    // Ensure tools_order exists with default value
    if (!this._config.tools_order) {
      this._config.tools_order = [...DEFAULT_TOOL_ORDER];
    }

    // Default section visibility
    if (typeof this._config.show_colors_section !== "boolean")
      this._config.show_colors_section = true;
    if (typeof this._config.show_tools_section !== "boolean")
      this._config.show_tools_section = true;
    if (typeof this._config.show_matrix_section !== "boolean")
      this._config.show_matrix_section = true;
    if (typeof this._config.show_actions_section !== "boolean")
      this._config.show_actions_section = true;
    if (typeof this._config.show_pixelart_section !== "boolean")
      this._config.show_pixelart_section = true;

    // Default boolean settings that use "!== false" pattern
    if (typeof this._config.show_card_background !== "boolean")
      this._config.show_card_background = true;
    if (typeof this._config.show_recent_colors !== "boolean")
      this._config.show_recent_colors = true;
    if (typeof this._config.show_lamp_palette !== "boolean")
      this._config.show_lamp_palette = true;
    if (typeof this._config.show_lamp_colors !== "boolean")
      this._config.show_lamp_colors = true;
    if (typeof this._config.show_image_palette !== "boolean")
      this._config.show_image_palette = true;
    if (typeof this._config.show_gallery !== "boolean")
      this._config.show_gallery = true;
    if (typeof this._config.show_pixelart_export_button !== "boolean")
      this._config.show_pixelart_export_button = true;
    if (typeof this._config.show_pixelart_import_button !== "boolean")
      this._config.show_pixelart_import_button = true;
    if (!this._config.pixelart_buttons_content_mode)
      this._config.pixelart_buttons_content_mode = "icon_text";
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", oldHass);
  }

  render() {
    return html`
      <div class="editor-root">
        ${this._section("global", "Global Settings", html`
            ${this._cardFrameSettings({
              placeholder: "Draw",
              lamps: "multiple",
            })}
        `)}

        <!-- Layout Section -->
        ${this._section("layout", "Layout", this._renderLayoutSection())}

        <!-- Colors Section -->
        ${this._section("colors", "Colors Section", html`
            ${createToggleRow(
              "Show Recent Colors",
              "show_recent_colors",
              this._config.show_recent_colors !== false,
              (e) => this._onSwitchChange(e, "show_recent_colors"),
            )}
            ${createToggleRow(
              "Show Lamp Palette Colors",
              "show_lamp_palette",
              this._config.show_lamp_palette !== false,
              (e) => this._onSwitchChange(e, "show_lamp_palette"),
            )}
            ${createToggleRow(
              "Show Lamp Colors",
              "show_lamp_colors",
              this._config.show_lamp_colors !== false,
              (e) => this._onSwitchChange(e, "show_lamp_colors"),
            )}
            ${createToggleRow(
              "Show Drawing Colors",
              "show_image_palette",
              this._config.show_image_palette !== false,
              (e) => this._onSwitchChange(e, "show_image_palette"),
            )}
            ${createButtonGroupRow(
              "Colors Container Mode",
              createButtonGroup(
                [
                  { value: "side", label: "Side-by-Side" },
                  { value: "carousel", label: "Carousel" },
                  { value: "tabs", label: "Tabs" },
                  { value: "dropdown", label: "Dropdown" },
                  { value: "preview-hover", label: "Preview Hover" },
                ],
                this._config.palette_card_mode || "side",
                createButtonGroupChangeHandler("palette_card_mode", (value) => {
                  this._config = { ...this._config, palette_card_mode: value };
                  this._fireConfigChanged();
                }),
              ),
            )}
            ${(this._config.palette_card_mode || "side") === "carousel"
              ? renderModeSettingsSection(
                  "Carousel Mode Settings",
                  renderCarouselNavSettings(this._config, {
                    shapeKey: "colors_button_shape",
                    shapeDefault: "rounded",
                    onShapeChange: (value) =>
                      this._setOption("colors_button_shape", value),
                    wrapKey: "colors_wrap_navigation",
                    onWrapChange: (e) =>
                      this._onSwitchChange(e, "colors_wrap_navigation"),
                    extra: this._colorsRadiusRow(12),
                  }),
                )
              : (this._config.palette_card_mode || "side") === "side"
                ? renderModeSettingsSection(
                    "Side-by-Side Settings",
                    html`
                      ${createSliderRow(
                        "Card Width",
                        this._config.side_card_width || 100,
                        { min: 30, max: 100, step: 1 },
                        this._onSideCardWidthChange.bind(this),
                        "%",
                      )}
                      ${createButtonGroupRow(
                        "Click to Zoom",
                        createButtonGroup(
                          [
                            { value: "off", label: "Off" },
                            { value: "on", label: "On" },
                          ],
                          this._config.side_click_zoom || "off",
                          createButtonGroupChangeHandler(
                            "side_click_zoom",
                            (value) => {
                              this._config = { ...this._config, side_click_zoom: value };
                              this._fireConfigChanged();
                            },
                          ),
                        ),
                      )}
                      ${this._colorsRadiusRow(16)}
                    `,
                  )
                : ""}
            ${(() => {
              const dm = this._config.palette_display_mode || "row";
              const swatchSubModes = [
                "row",
                "grid",
                "expand",
                "scroll",
                "fan",
                "wave",
                "spiral",
              ];
              const isSwatches = swatchSubModes.includes(dm);
              // Derive top-level bucket
              const topLevel = isSwatches ? "swatches" : dm;
              return html`
                ${createButtonGroupRow(
                  "Colors Display Mode",
                  createButtonGroup(
                    [
                      { value: "swatches", label: "Color Swatches" },
                      { value: "gradient", label: "Gradient" },
                      { value: "honeycomb", label: "Honeycomb" },
                      { value: "blinds", label: "Blinds" },
                      { value: "treemap", label: "Treemap" },
                    ],
                    topLevel,
                    createButtonGroupChangeHandler(
                      "palette_display_mode",
                      (value) => {
                        if (value === "swatches") {
                          // Keep current sub-mode if already a swatch, else default to row
                          this._config = {
                            ...this._config,
                            palette_display_mode: isSwatches ? dm : "row",
                          };
                        } else {
                          this._config = { ...this._config, palette_display_mode: value };
                        }
                        this._fireConfigChanged();
                      },
                    ),
                  ),
                )}
                ${topLevel === "swatches"
                  ? renderModeSettingsSection(
                      "Color Swatches Settings",
                      html`
                        ${createButtonGroupRow(
                          "Layout",
                          createButtonGroup(
                            [
                              { value: "row", label: "Row" },
                              { value: "grid", label: "Grid" },
                              { value: "expand", label: "Expandable" },
                              { value: "scroll", label: "Scroll" },
                              { value: "fan", label: "Fan" },
                              { value: "wave", label: "Wave" },
                              { value: "spiral", label: "Spiral" },
                            ],
                            dm,
                            createButtonGroupChangeHandler(
                              "palette_display_mode",
                              (value) => {
                                this._config = { ...this._config, palette_display_mode: value };
                                this._fireConfigChanged();
                              },
                            ),
                          ),
                        )}
                        ${createButtonGroupRow(
                          "Swatch Shape",
                          createButtonGroup(
                            [
                              { value: "square", label: "Square" },
                              { value: "rounded", label: "Rounded" },
                              { value: "round", label: "Circle" },
                            ],
                            this._config.swatch_shape || "round",
                            createButtonGroupChangeHandler(
                              "swatch_shape",
                              (value) => {
                                this._config = { ...this._config, swatch_shape: value };
                                this._fireConfigChanged();
                              },
                            ),
                          ),
                        )}
                        ${dm === "expand"
                          ? createButtonGroupRow(
                              "Expand Button Style",
                              createButtonGroup(
                                [
                                  { value: "pill", label: "Pill (+N)" },
                                  { value: "chevron", label: "Chevron" },
                                  { value: "dots", label: "Dots" },
                                ],
                                this._config.expand_btn_style || "pill",
                                createButtonGroupChangeHandler(
                                  "expand_btn_style",
                                  (value) => {
                                    this._config = { ...this._config, expand_btn_style: value };
                                    this._fireConfigChanged();
                                  },
                                ),
                              ),
                            )
                          : ""}
                      `,
                    )
                  : topLevel === "gradient"
                    ? renderModeSettingsSection(
                        "Gradient Settings",
                        html`${createButtonGroupRow(
                          "Swatch Shape",
                          createButtonGroup(
                            [
                              { value: "square", label: "Square" },
                              { value: "rounded", label: "Rounded" },
                              { value: "round", label: "Circle" },
                            ],
                            this._config.swatch_shape || "round",
                            createButtonGroupChangeHandler(
                              "swatch_shape",
                              (value) => {
                                this._config = { ...this._config, swatch_shape: value };
                                this._fireConfigChanged();
                              },
                            ),
                          ),
                        )}
                        ${createToggleRow(
                          "Free Pick (Interpolate Any Color)",
                          "gradient_free_pick",
                          this._config.gradient_free_pick === true,
                          (e) => this._onSwitchChange(e, "gradient_free_pick"),
                        )}`,
                      )
                    : topLevel === "blinds"
                      ? renderModeSettingsSection(
                          "Blinds Settings",
                          createButtonGroupRow(
                            "Blinds Direction",
                            createButtonGroup(
                              [
                                { value: "rows", label: "Horizontal" },
                                { value: "columns", label: "Vertical" },
                                {
                                  value: "diagonal-right",
                                  label: "Diagonal \u2572",
                                },
                                {
                                  value: "diagonal-left",
                                  label: "Diagonal \u2571",
                                },
                              ],
                              this._config.blinds_direction || "rows",
                              createButtonGroupChangeHandler(
                                "blinds_direction",
                                (value) => {
                                  this._config = { ...this._config, blinds_direction: value };
                                  this._fireConfigChanged();
                                },
                              ),
                            ),
                          ),
                        )
                      : ""}
              `;
            })()}
            ${createButtonGroupRow(
              "Color Info Display",
              createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "hex", label: "Hex Code" },
                  { value: "name", label: "Color Name" },
                ],
                this._config.color_info_display || "none",
                createButtonGroupChangeHandler(
                  "color_info_display",
                  (value) => {
                    this._config = { ...this._config, color_info_display: value };
                    this._fireConfigChanged();
                  },
                ),
              ),
            )}
            ${createButtonGroupRow(
              "Colors Card Border",
              createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "auto", label: "Auto" },
                  { value: "always", label: "Always" },
                ],
                this._config.colors_card_border || "auto",
                createButtonGroupChangeHandler(
                  "colors_card_border",
                  (value) => {
                    this._config = { ...this._config, colors_card_border: value };
                    this._fireConfigChanged();
                  },
                ),
              ),
            )}
        `)}

        <!-- Tool Order Section -->
        <!-- Tool Settings Section -->
        ${this._section("tools", "Drawing Tools", html`
            <!-- Tool visibility mode toggle with Reset Visibility -->
            <div class="toggle-row">
              <label class="toggle-label">Tool Visibility Mode</label>
              <div style="display:flex;align-items:center;gap:8px;">
                ${this._hasToolVisibilityChanges()
                  ? html`
                      <button
                        type="button"
                        @click="${this._resetToolVisibility}"
                        style="padding:4px 10px;border:1px solid var(--divider-color, #ddd);border-radius:4px;background:var(--secondary-background-color, #f5f5f5);color:var(--secondary-text-color, #666);cursor:pointer;font-size:0.8em;white-space:nowrap;"
                        title="Show all tools (reset visibility to all visible)"
                      >
                        👁 Reset
                      </button>
                    `
                  : ""}
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    id="edit_drawing_tools"
                    .checked="${this._config.edit_drawing_tools ??
                    this._config.allow_visual_tool_reordering ??
                    false}"
                    @change="${(e) =>
                      this._onSwitchChange(e, "edit_drawing_tools")}"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div
              style="font-size:0.85em;color:var(--secondary-text-color, #666);margin-top:4px;"
            >
              Enable tool editing mode: show/hide toggles appear above each
              tool. Toggle tool visibility by clicking the eye icon (👁) above
              each tool.
            </div>

            <!-- Tool button appearance settings -->
            <div
              style="margin-top:16px;border-top:1px solid var(--divider-color, #e0e0e0);padding-top:16px;"
            >
              <div class="form-row">
                <label>Button Shape</label>
                ${createButtonGroup(
                  [
                    { value: "circle", label: "Circle" },
                    { value: "rect", label: "Rounded" },
                    { value: "square", label: "Square" },
                  ],
                  this._config.button_shape || "rect",
                  createButtonGroupChangeHandler("button_shape", (value) => {
                    this._config = { ...this._config, button_shape: value };
                    this._fireConfigChanged();
                  }),
                )}
              </div>
              ${renderActionButtonSettings(
                this._config,
                (key, value) => {
                  this._config = { ...this._config, [key]: value };
                  this._fireConfigChanged();
                },
                {
                  styleKey: "tool_buttons_style",
                  contentKey: "tool_content_mode",
                  defaultContentMode: "icon",
                },
              )}
            </div>
        `)}

        <!-- Drawing Matrix Section -->
        ${this._section(
          "preview_appearance",
          "Preview Appearance",
          this._renderAppearance("shared"),
        )}
        ${this._section("matrix", "Drawing Matrix Section", html`
            ${createSliderRow(
              "Matrix Size",
              this._config.matrix_size || 100,
              {
                min: 50,
                max: 100,
                step: 1,
              },
              this._onMatrixSizeSliderChange.bind(this),
              "%",
            )}
            ${this._renderAppearance("canvas")}
        `)}

        <!-- Action Buttons Section -->
        ${this._section("actions", "Action Buttons", html`
            <!-- Action visibility mode toggle with Reset Visibility -->
            <div class="toggle-row">
              <label class="toggle-label">Action Visibility Mode</label>
              <div style="display:flex;align-items:center;gap:8px;">
                ${this._hasActionVisibilityChanges()
                  ? html`
                      <button
                        type="button"
                        @click="${this._resetActionVisibility}"
                        style="padding:4px 10px;border:1px solid var(--divider-color, #ddd);border-radius:4px;background:var(--secondary-background-color, #f5f5f5);color:var(--secondary-text-color, #666);cursor:pointer;font-size:0.8em;white-space:nowrap;"
                        title="Show all actions (reset visibility to all visible)"
                      >
                        👁 Reset
                      </button>
                    `
                  : ""}
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    id="edit_action_buttons"
                    .checked="${this._config.edit_action_buttons ?? false}"
                    @change="${(e) =>
                      this._onSwitchChange(e, "edit_action_buttons")}"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div
              style="font-size:0.85em;color:var(--secondary-text-color, #666);margin-top:4px;"
            >
              Enable action editing mode: show/hide toggles appear above each
              action button. Toggle action visibility by clicking the eye icon
              (👁) above each button.
            </div>

            <!-- Action button appearance settings -->
            <div
              style="margin-top:16px;border-top:1px solid var(--divider-color, #e0e0e0);padding-top:16px;"
            >
              ${renderActionButtonSettings(
                this._config,
                (key, value) => {
                  this._config = { ...this._config, [key]: value };
                  this._fireConfigChanged();
                },
                {
                  styleKey: "actions_buttons_style",
                  contentKey: "actions_content_mode",
                  defaultContentMode: "icon",
                },
              )}
            </div>
        `)}

        ${this._section("pixelart", "Pixel Art Section", html`
            <!-- 1. Core Behavior -->
            ${createToggleRow(
              "Apply to lamp automatically",
              "pixel_art_auto_apply_to_lamp",
              this._config.pixel_art_auto_apply_to_lamp === true,
              (e) => this._onSwitchChange(e, "pixel_art_auto_apply_to_lamp"),
            )}

            <!-- 2. The shared gallery settings (the same as every card with a
                 gallery); the pixel-art previews use the "Pixel Art"
                 appearance. -->
            ${renderStyleSelectorSettings(
              this._config,
              (key, value) => this._setOption(key, value),
              {
                allowChips: true,
                noun: "Pixel Art",
                manage: "pixel arts",
                defaultSize: 100,
                memory: (this._galleryMemory ||= {}),
                renderAppearance: () => this._renderAppearance("art"),
              },
            )}
            ${this._arrangeSettings("pixel_arts")}
        `)}

        <!-- Import/Export Actions Section -->
        ${this._section("importExport", "Import/Export Actions", html`
            ${createToggleRow(
              "Show Export Button",
              "show_pixelart_export_button",
              this._config.show_pixelart_export_button !== false,
              (e) => this._onSwitchChange(e, "show_pixelart_export_button"),
            )}
            ${createToggleRow(
              "Show Import Button",
              "show_pixelart_import_button",
              this._config.show_pixelart_import_button !== false,
              (e) => this._onSwitchChange(e, "show_pixelart_import_button"),
            )}
            ${renderActionButtonSettings(
              this._config,
              (key, value) => {
                this._config = { ...this._config, [key]: value };
                this._fireConfigChanged();
              },
              {
                styleKey: "pixelart_buttons_style",
                contentKey: "pixelart_content_mode",
              },
            )}
        `)}
      </div>
    `;
  }

  // New centralized slider handlers

  // The colour cards' corners (colors_item_radius), shared by the
  // side-by-side and carousel modes; `fallback` is the mode's default.
  _colorsRadiusRow(fallback) {
    return createSliderRow(
      "Card Roundness",
      this._config.colors_item_radius ?? fallback,
      { min: 0, max: 28, step: 1 },
      (e) => this._setOption("colors_item_radius", parseInt(e.target.value, 10)),
      "px",
    );
  }

  _renderAppearance(section) {
    return html`<yeelight-preview-appearance-editor
      profile="draw"
      section=${section}
      .owner=${this}
      .config=${this._config}
      @appearance-changed=${(event) => {
        this._config = event.detail.config;
        this._fireConfigChanged();
      }}
    ></yeelight-preview-appearance-editor>`;
  }

  _onMatrixSizeChange(e) {
    this._config = { ...this._config, matrix_size: e.target.value };
    this._fireConfigChanged();
  }

  _onSwitchChange(e, key) {
    this._config = { ...this._config, [key]: e.target.checked };
    this._fireConfigChanged();

    // Trigger re-render for settings that affect other setting visibility
    if (key === "preview_show_titles") {
      this.requestUpdate();
    }
  }


  _onMatrixSizeSliderChange(e) {
    const val = Number(e.target.value);
    this._config = { ...this._config, matrix_size: val };
    this._fireConfigChanged();
  }

  _onSideCardWidthChange(e) {
    const val = Number(e.target.value);
    this._config = { ...this._config, side_card_width: val };
    this._fireConfigChanged();
  }
}

defineOnce("yeelight-cube-draw-card-editor", YeelightCubeDrawCardEditor);
