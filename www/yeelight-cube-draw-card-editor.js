import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit@2.8.0/index.js?module";
import {
  sharedEditorStyles,
  FormElementRenderer,
  EditorConfigManager,
  renderModeSettingsSection,
  renderModeInfoMessage,
} from "./editor_ui_utils.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import {
  formRowStyles,
  createToggleRow,
  createConfigRow,
  createSliderRow,
  createButtonGroupRow,
} from "./form-row-utils.js";
import {
  createYeelightCubeEntityPicker,
  getYeelightCubeEntities,
} from "./entity-selector-utils.js";
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

class YeelightCubeDrawCardEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      localTitle: { type: String },
    };
  }

  static get styles() {
    return [
      sharedEditorStyles,
      buttonGroupStyles,
      formRowStyles,
      css`
        .editor-root {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 18px 8px 8px 8px;
        }
        .editor-card {
          background: #f7fafd;
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

        /* Layout Section Styles */
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
          background: #f8f9fa;
          border: 2px solid #e1e5e9;
          border-radius: 8px;
          transition: all 0.2s ease;
          user-select: none;
        }
        .layout-section:hover {
          background: #e9ecef;
          border-color: #ced4da;
        }
        .layout-section-icon {
          font-size: 32px !important;
          margin-right: 16px !important;
          color: #333 !important;
          min-width: 32px;
          min-height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 119, 204, 0.1);
          border-radius: 6px;
          border: 2px solid rgba(0, 119, 204, 0.2);
        }
        .layout-section-info {
          flex: 1;
        }
        .layout-section-title {
          font-weight: 600;
          font-size: 1.1em;
          color: #333;
          margin-bottom: 2px;
        }
        .layout-section-desc {
          font-size: 0.9em;
          color: #666;
        }
        .layout-section.section-hidden {
          opacity: 0.5;
          background: #f0f0f0;
        }
        .layout-section.section-hidden .layout-section-title {
          text-decoration: line-through;
          color: #888;
        }
      `,
    ];
  }

  constructor() {
    super();
    this.config = {};
    this.localTitle = "";
    this.hass = null;
    this._folded = {
      global: true,
      layout: true,
      tools: true,
      actions: true,
      colors: true,
      matrix: true,
      pixelart: true,
      importExport: true,
    };

    // Bind event handler
    this._handleMainCardConfigUpdate =
      this._handleMainCardConfigUpdate.bind(this);

    // Throttle state for slider updates
    this._previewSizeUpdateScheduled = false;
    this._pendingPreviewSize = null;
    this._pixelGapUpdateScheduled = false;
    this._pendingPixelGap = null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Listen for config updates from the main card
    window.addEventListener(
      "yeelight-config-updated",
      this._handleMainCardConfigUpdate,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Auto-disable "Tool Visibility Mode" when editor is closed
    if (this.config && this.config.edit_drawing_tools) {
      this.config.edit_drawing_tools = false;

      // Fire a final config update to save the disabled state
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this.config },
          bubbles: true,
          composed: true,
        }),
      );
    }

    // Remove event listener
    window.removeEventListener(
      "yeelight-config-updated",
      this._handleMainCardConfigUpdate,
    );
  }

  _handleMainCardConfigUpdate(event) {
    const { type, config, tools_order } = event.detail;

    if (type === "tools_order" && tools_order) {
      // Update our config
      this.config = { ...this.config, tools_order };

      // Fire config changed event to save it
      this._fireConfigChanged();

      // Re-render to show the new order
      this.requestUpdate();
    }
  }

  _toggleFold(section) {
    this._folded[section] = !this._folded[section];
    this.requestUpdate();
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
      colors: this.config.show_colors_section !== false,
      tools: this.config.show_tools_section !== false,
      matrix: this.config.show_matrix_section !== false,
      actions: this.config.show_actions_section !== false,
      pixelart: this.config.show_pixelart_section !== false,
    };

    // Fixed section order
    const sectionOrder = ["colors", "tools", "matrix", "actions", "pixelart"];

    return html`
      <div class="layout-sections">
        <p style="margin: 8px 0; color: #666; font-size: 0.9em;">
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
                class="switch"
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
                <span class="slider"></span>
              </label>
            </div>
          `;
        })}
      </div>
    `;
  }

  _resetToolOrder() {
    this.config.tools_order = [...DEFAULT_TOOL_ORDER];
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
    this.config[`show_${sectionId}_section`] = visible;
    this._fireConfigChanged();
  }

  // Simple drag methods are implemented above in _initSimpleDrag()

  setConfig(config) {
    this.config = { ...config };
    this.localTitle = config.title || "";
    if (typeof this.config.pixel_gap !== "number") this.config.pixel_gap = 2;
    if (!this.config.matrix_bg) this.config.matrix_bg = "black";
    if (typeof this.config.matrix_box_shadow !== "boolean")
      this.config.matrix_box_shadow = true;
    if (typeof this.config.pixel_art_matrix_box_shadow !== "boolean")
      this.config.pixel_art_matrix_box_shadow = true;
    if (typeof this.config.pixel_art_pixel_box_shadow !== "boolean")
      this.config.pixel_art_pixel_box_shadow = true;
    if (typeof this.config.pixel_art_gallery_container_card !== "boolean")
      this.config.pixel_art_gallery_container_card = true;
    if (typeof this.config.pixel_art_items_as_cards !== "boolean")
      this.config.pixel_art_items_as_cards = true;
    if (typeof this.config.pixel_art_show_titles !== "boolean")
      this.config.pixel_art_show_titles = true;
    if (typeof this.config.pixel_art_allow_rename !== "boolean")
      this.config.pixel_art_allow_rename = false;
    if (!this.config.matrix_size) this.config.matrix_size = "large";
    if (!this.config.button_shape) this.config.button_shape = "rect";
    if (!this.config.actions_buttons_style)
      this.config.actions_buttons_style = "modern";
    if (!this.config.actions_content_mode)
      this.config.actions_content_mode = "icon";
    if (!this.config.tool_buttons_style)
      this.config.tool_buttons_style = "modern";
    if (!this.config.tool_content_mode) this.config.tool_content_mode = "icon";
    if (!this.config.paint_button_shape)
      this.config.paint_button_shape = "rect";
    if (!this.config.swatch_shape) this.config.swatch_shape = "round";
    if (!this.config.expand_btn_mode) this.config.expand_btn_mode = "label";
    if (typeof this.config.pixel_art_preview_size !== "number")
      this.config.pixel_art_preview_size = 100;

    // Ensure tools_order exists with default value
    if (!this.config.tools_order) {
      this.config.tools_order = [...DEFAULT_TOOL_ORDER];
    }

    // Default section visibility
    if (typeof this.config.show_colors_section !== "boolean")
      this.config.show_colors_section = true;
    if (typeof this.config.show_tools_section !== "boolean")
      this.config.show_tools_section = true;
    if (typeof this.config.show_matrix_section !== "boolean")
      this.config.show_matrix_section = true;
    if (typeof this.config.show_actions_section !== "boolean")
      this.config.show_actions_section = true;
    if (typeof this.config.show_pixelart_section !== "boolean")
      this.config.show_pixelart_section = true;

    // Default boolean settings that use "!== false" pattern
    if (typeof this.config.show_card_background !== "boolean")
      this.config.show_card_background = true;
    if (typeof this.config.show_recent_colors !== "boolean")
      this.config.show_recent_colors = true;
    if (typeof this.config.show_lamp_palette !== "boolean")
      this.config.show_lamp_palette = true;
    if (typeof this.config.show_image_palette !== "boolean")
      this.config.show_image_palette = true;
    if (typeof this.config.show_pixelart_gallery !== "boolean")
      this.config.show_pixelart_gallery = true;
    if (!this.config.pixel_art_delete_button_style)
      this.config.pixel_art_delete_button_style = "text";
    if (typeof this.config.show_pixelart_export_button !== "boolean")
      this.config.show_pixelart_export_button = true;
    if (typeof this.config.show_pixelart_import_button !== "boolean")
      this.config.show_pixelart_import_button = true;
    if (!this.config.pixelart_buttons_content_mode)
      this.config.pixelart_buttons_content_mode = "icon_text";
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    this.requestUpdate("hass", oldHass);
  }

  render() {
    const chevronIcon = (folded) => html`
      <ha-icon
        icon="mdi:chevron-down"
        style="transition:transform 0.4s;transform:rotate(${folded
          ? 0
          : 180}deg);width:22px;height:22px;color:#666;"
      ></ha-icon>
    `;
    return html`
      <div class="editor-root">
        <div
          class="editor-card${this._folded.global
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("global")}"
          >
            Global Settings ${chevronIcon(this._folded.global)}
          </div>
          <div class="editor-card-content">
            <div class="form-row">
              <label>Card Title (optional)</label>
              <input
                type="text"
                id="title"
                .value="${this.localTitle}"
                placeholder="Draw card"
                @input="${this._onTitleInput}"
              />
            </div>
            <div class="form-row">
              <label>Light Entities</label>
              ${(() => {
                if (this._hass && this._hass.states) {
                  const lights = Object.keys(this._hass.states).filter((id) =>
                    id.startsWith("light."),
                  );
                  const cubes = lights.filter(
                    (id) => id.includes("cube") || id.includes("cubelite"),
                  );
                }
                return this._renderEntityPicker();
              })()}
            </div>
            ${createToggleRow(
              "Show Card Background",
              "show_card_background",
              this.config.show_card_background !== false,
              (e) => this._onSwitchChange(e, "show_card_background"),
            )}
          </div>
        </div>

        <!-- Layout Section -->
        <div
          class="editor-card${this._folded.layout
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("layout")}"
          >
            Layout ${chevronIcon(this._folded.layout)}
          </div>
          <div class="editor-card-content">${this._renderLayoutSection()}</div>
        </div>

        <!-- Colors Section -->
        <div
          class="editor-card${this._folded.colors
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("colors")}"
          >
            Colors Section ${chevronIcon(this._folded.colors)}
          </div>
          <div class="editor-card-content">
            ${createToggleRow(
              "Show Recent Colors",
              "show_recent_colors",
              this.config.show_recent_colors !== false,
              (e) => this._onSwitchChange(e, "show_recent_colors"),
            )}
            ${createToggleRow(
              "Show Lamp Palette Colors",
              "show_lamp_palette",
              this.config.show_lamp_palette !== false,
              (e) => this._onSwitchChange(e, "show_lamp_palette"),
            )}
            ${createToggleRow(
              "Show Image Palette Colors",
              "show_image_palette",
              this.config.show_image_palette !== false,
              (e) => this._onSwitchChange(e, "show_image_palette"),
            )}
            <div class="config-row">
              <label class="config-label">Swatch Shape</label>
              <div
                style="display: flex; flex-direction: column; align-items: flex-end;"
              >
                ${createButtonGroup(
                  [
                    { value: "round", label: "Round" },
                    { value: "square", label: "Square" },
                  ],
                  this.config.swatch_shape || "round",
                  createButtonGroupChangeHandler("swatch_shape", (value) => {
                    this.config.swatch_shape = value;
                    this._fireConfigChanged();
                  }),
                )}
              </div>
            </div>
            ${createButtonGroupRow(
              "Palette Card Container Mode",
              createButtonGroup(
                [
                  { value: "side", label: "Side-by-Side" },
                  { value: "stacked", label: "Stacked" },
                  { value: "tabs", label: "Tabs" },
                  { value: "dropdown", label: "Dropdown" },
                  { value: "preview-hover", label: "Preview Hover" },
                ],
                this.config.palette_card_mode || "side",
                createButtonGroupChangeHandler("palette_card_mode", (value) => {
                  this.config.palette_card_mode = value;
                  this._fireConfigChanged();
                }),
              ),
            )}
            ${createButtonGroupRow(
              "Preview Dots (for Preview on Hover)",
              createButtonGroup(
                [
                  { value: "1", label: "1" },
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                  { value: "4", label: "4" },
                  { value: "5", label: "5" },
                  { value: "all", label: "All" },
                ],
                this.config.palette_preview_dot_count || "3",
                createButtonGroupChangeHandler(
                  "palette_preview_dot_count",
                  (value) => {
                    this.config.palette_preview_dot_count = value;
                    this._fireConfigChanged();
                  },
                ),
              ),
            )}
            ${createButtonGroupRow(
              "Palette Display Mode",
              createButtonGroup(
                [
                  { value: "row", label: "Row" },
                  { value: "grid", label: "Grid" },
                  { value: "expand", label: "Expandable" },
                ],
                this.config.palette_display_mode || "row",
                createButtonGroupChangeHandler(
                  "palette_display_mode",
                  (value) => {
                    this.config.palette_display_mode = value;
                    this._fireConfigChanged();
                  },
                ),
              ),
            )}
            ${createButtonGroupRow(
              "More/Less Button Content (Expandable Palette)",
              createButtonGroup(
                [
                  { value: "label", label: "Label" },
                  { value: "icon", label: "Icon" },
                  { value: "both", label: "Both" },
                ],
                this.config.expand_btn_mode || "label",
                createButtonGroupChangeHandler("expand_btn_mode", (value) => {
                  this.config.expand_btn_mode = value;
                  this._fireConfigChanged();
                }),
              ),
            )}
          </div>
        </div>

        <!-- Tool Order Section -->
        <!-- Tool Settings Section -->
        <div
          class="editor-card${this._folded.tools
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("tools")}"
          >
            Drawing Tools ${chevronIcon(this._folded.tools)}
          </div>
          <div class="editor-card-content">
            <!-- Tool visibility mode toggle with Reset Visibility -->
            <div class="toggle-row">
              <label class="toggle-label">Tool Visibility Mode</label>
              <div style="display:flex;align-items:center;gap:8px;">
                ${this._hasToolVisibilityChanges()
                  ? html`
                      <button
                        type="button"
                        @click="${this._resetToolVisibility}"
                        style="padding:4px 10px;border:1px solid #ddd;border-radius:4px;background:#f5f5f5;color:#666;cursor:pointer;font-size:0.8em;white-space:nowrap;"
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
                    .checked="${this.config.edit_drawing_tools ??
                    this.config.allow_visual_tool_reordering ??
                    false}"
                    @change="${(e) =>
                      this._onSwitchChange(e, "edit_drawing_tools")}"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div style="font-size:0.85em;color:#666;margin-top:4px;">
              Enable tool editing mode: show/hide toggles appear above each
              tool. Toggle tool visibility by clicking the eye icon (👁) above
              each tool.
            </div>

            <!-- Tool button appearance settings -->
            <div
              style="margin-top:16px;border-top:1px solid #e0e0e0;padding-top:16px;"
            >
              <div class="config-row">
                <label class="config-label">Button Shape</label>
                <div
                  style="display: flex; flex-direction: column; align-items: flex-end;"
                >
                  ${createButtonGroup(
                    [
                      { value: "circle", label: "Circle" },
                      { value: "rect", label: "Rounded" },
                      { value: "square", label: "Square" },
                    ],
                    this.config.button_shape || "rect",
                    createButtonGroupChangeHandler("button_shape", (value) => {
                      this.config.button_shape = value;
                      this._fireConfigChanged();
                    }),
                  )}
                </div>
              </div>
              <div class="config-row">
                <label class="config-label">Button Style</label>
                <div
                  style="display: flex; flex-direction: column; align-items: flex-end;"
                >
                  ${createButtonGroup(
                    [
                      { value: "modern", label: "Modern" },
                      { value: "classic", label: "Classic" },
                      { value: "outline", label: "Outline" },
                      { value: "gradient", label: "Gradient" },
                      { value: "icon", label: "Icon" },
                      { value: "pill", label: "Pill" },
                    ],
                    this.config.tool_buttons_style || "modern",
                    createButtonGroupChangeHandler(
                      "tool_buttons_style",
                      (value) => {
                        this.config.tool_buttons_style = value;
                        this._fireConfigChanged();
                      },
                    ),
                  )}
                </div>
              </div>
              ${(this.config.tool_buttons_style || "modern") !== "icon"
                ? html`
                    <div class="config-row">
                      <label class="config-label">Content Mode</label>
                      <div
                        style="display: flex; flex-direction: column; align-items: flex-end;"
                      >
                        ${createButtonGroup(
                          [
                            { value: "icon", label: "Icon" },
                            { value: "text", label: "Text" },
                            { value: "icon_text", label: "Icon + Text" },
                          ],
                          this.config.tool_content_mode || "icon",
                          createButtonGroupChangeHandler(
                            "tool_content_mode",
                            (value) => {
                              this.config.tool_content_mode = value;
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                  `
                : html`
                    <div class="config-row" style="opacity: 0.5;">
                      <label class="config-label">Content Mode</label>
                      <div style="font-size: 0.85em; color: #888;">
                        Icon style always uses icon-only
                      </div>
                    </div>
                  `}
            </div>
          </div>
        </div>

        <!-- Drawing Matrix Section -->
        <div
          class="editor-card${this._folded.matrix
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("matrix")}"
          >
            Drawing Matrix Section ${chevronIcon(this._folded.matrix)}
          </div>
          <div class="editor-card-content">
            ${createSliderRow(
              "Matrix Size",
              this.config.matrix_size || 100,
              {
                min: 50,
                max: 100,
                step: 1,
              },
              this._onMatrixSizeSliderChange.bind(this),
              "%",
            )}
            ${createToggleRow(
              "Pixel Box Shadow",
              "pixel_box_shadow",
              this.config.pixel_box_shadow === true,
              (e) => this._onSwitchChange(e, "pixel_box_shadow"),
            )}
            ${createSliderRow(
              "Pixel Gap",
              this.config.pixel_gap ?? 2,
              {
                min: 0,
                max: 6,
                step: 0.5,
              },
              this._onDrawingMatrixPixelGapChange.bind(this),
              "px",
            )}
            <div class="form-row">
              <label>Matrix Background Color</label>
              ${createButtonGroup(
                [
                  { value: "transparent", label: "Transparent" },
                  { value: "white", label: "White" },
                  { value: "black", label: "Black" },
                ],
                this.config.matrix_bg || "black",
                createButtonGroupChangeHandler("matrix_bg", (value) => {
                  this.config.matrix_bg = value;
                  this._fireConfigChanged();
                }),
              )}
            </div>
            ${(this.config.matrix_bg || "black") !== "black" ? createToggleRow(
              "Ignore Black Pixels",
              "matrix_ignore_black_pixels",
              this.config.matrix_ignore_black_pixels === true,
              (e) => this._onSwitchChange(e, "matrix_ignore_black_pixels"),
            ) : ''}
            ${createToggleRow(
              "Matrix Box Shadow",
              "matrix_box_shadow",
              this.config.matrix_box_shadow !== false,
              (e) => this._onSwitchChange(e, "matrix_box_shadow"),
            )}
            <div class="form-row">
              <label>Matrix Pixel Style</label>
              ${createButtonGroup(
                [
                  { value: "false", label: "Round" },
                  { value: "true", label: "Square" },
                ],
                this.config.draw_with_squares ? "true" : "false",
                createButtonGroupChangeHandler("draw_with_squares", (value) => {
                  this.config.draw_with_squares = value === "true";
                  this._fireConfigChanged();
                }),
              )}
            </div>
          </div>
        </div>

        <!-- Action Buttons Section -->
        <div
          class="editor-card${this._folded.actions
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("actions")}"
          >
            Action Buttons ${chevronIcon(this._folded.actions)}
          </div>
          <div class="editor-card-content">
            <!-- Action visibility mode toggle with Reset Visibility -->
            <div class="toggle-row">
              <label class="toggle-label">Action Visibility Mode</label>
              <div style="display:flex;align-items:center;gap:8px;">
                ${this._hasActionVisibilityChanges()
                  ? html`
                      <button
                        type="button"
                        @click="${this._resetActionVisibility}"
                        style="padding:4px 10px;border:1px solid #ddd;border-radius:4px;background:#f5f5f5;color:#666;cursor:pointer;font-size:0.8em;white-space:nowrap;"
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
                    .checked="${this.config.edit_action_buttons ?? false}"
                    @change="${(e) =>
                      this._onSwitchChange(e, "edit_action_buttons")}"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div style="font-size:0.85em;color:#666;margin-top:4px;">
              Enable action editing mode: show/hide toggles appear above each
              action button. Toggle action visibility by clicking the eye icon
              (👁) above each button.
            </div>

            <!-- Action button appearance settings -->
            <div
              style="margin-top:16px;border-top:1px solid #e0e0e0;padding-top:16px;"
            >
              <div class="config-row">
                <label class="config-label">Button Style</label>
                <div
                  style="display: flex; flex-direction: column; align-items: flex-end;"
                >
                  ${createButtonGroup(
                    [
                      { value: "modern", label: "Modern" },
                      { value: "classic", label: "Classic" },
                      { value: "outline", label: "Outline" },
                      { value: "gradient", label: "Gradient" },
                      { value: "icon", label: "Icon" },
                      { value: "pill", label: "Pill" },
                    ],
                    this.config.actions_buttons_style || "modern",
                    createButtonGroupChangeHandler(
                      "actions_buttons_style",
                      (value) => {
                        this.config.actions_buttons_style = value;
                        this._fireConfigChanged();
                      },
                    ),
                  )}
                </div>
              </div>
              ${(this.config.actions_buttons_style || "modern") !== "icon"
                ? html`
                    <div class="config-row">
                      <label class="config-label">Content Mode</label>
                      <div
                        style="display: flex; flex-direction: column; align-items: flex-end;"
                      >
                        ${createButtonGroup(
                          [
                            { value: "icon", label: "Icon" },
                            { value: "text", label: "Text" },
                            { value: "icon_text", label: "Icon + Text" },
                          ],
                          this.config.actions_content_mode || "icon",
                          createButtonGroupChangeHandler(
                            "actions_content_mode",
                            (value) => {
                              this.config.actions_content_mode = value;
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                  `
                : html`
                    <div class="config-row" style="opacity: 0.5;">
                      <label class="config-label">Content Mode</label>
                      <div style="font-size: 0.85em; color: #888;">
                        Icon style always uses icon-only
                      </div>
                    </div>
                  `}
            </div>
          </div>
        </div>

        <div
          class="editor-card${this._folded.pixelart
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("pixelart")}"
          >
            Pixel Art Section ${chevronIcon(this._folded.pixelart)}
          </div>
          <div class="editor-card-content">
            <!-- GROUP 1: Core Behavior -->
            ${createToggleRow(
              "Apply to lamp automatically",
              "pixel_art_auto_apply_to_lamp",
              this.config.pixel_art_auto_apply_to_lamp === true,
              (e) => this._onSwitchChange(e, "pixel_art_auto_apply_to_lamp"),
            )}

            <!-- GROUP 2: Gallery Layout & Display -->
            <div class="form-row">
              <label>Gallery Display Mode</label>
              ${createButtonGroup(
                [
                  { value: "gallery", label: "Gallery" },
                  { value: "list", label: "List" },
                  { value: "carousel", label: "Carousel" },
                  { value: "album", label: "Album" },
                ],
                this.config.pixel_art_gallery_mode || "gallery",
                createButtonGroupChangeHandler(
                  "pixel_art_gallery_mode",
                  (value) => {
                    this.config.pixel_art_gallery_mode = value;
                    this._fireConfigChanged();
                    this.requestUpdate(); // Force re-render to show/hide settings
                  },
                ),
              )}
            </div>
            ${
              // Gallery-specific settings
              this.config.pixel_art_gallery_mode === "gallery"
                ? html`
                    <div
                      style="margin-top: 20px; padding: 16px; background: #f0f8ff; border-radius: 8px; border-left: 4px solid #0077cc;"
                    >
                      <div
                        style="font-weight: 600; font-size: 1.05em; margin-bottom: 12px; color: #0077cc;"
                      >
                        Gallery Mode Settings
                      </div>
                      ${createToggleRow(
                        "Rounded Cards",
                        "gallery_rounded_cards",
                        this.config.gallery_rounded_cards !== false,
                        (e) => this._onSwitchChange(e, "gallery_rounded_cards"),
                      )}
                    </div>
                  `
                : ""
            }

            <!-- Global Remove Button Settings -->
            <div class="form-row">
              <label>Remove Button Style</label>
              ${createButtonGroup(
                [
                  { value: "none", label: "None" },
                  { value: "default", label: "Default" },
                  { value: "red", label: "Red" },
                  { value: "black", label: "Black" },
                  { value: "trash", label: "Trash" },
                ],
                this.config.pixel_art_remove_button_style || "default",
                createButtonGroupChangeHandler(
                  "pixel_art_remove_button_style",
                  (value) => {
                    this.config.pixel_art_remove_button_style = value;
                    this._fireConfigChanged();
                    this.requestUpdate();
                  },
                ),
              )}
            </div>
            ${this.config.pixel_art_remove_button_style !== "none"
              ? createToggleRow(
                  "Remove Button Always Visible",
                  "pixel_art_remove_button_always_visible",
                  this.config.pixel_art_remove_button_always_visible !== false,
                  (e) =>
                    this._onSwitchChange(
                      e,
                      "pixel_art_remove_button_always_visible",
                    ),
                )
              : ""}
            ${
              // Album-specific settings - styled section
              this.config.pixel_art_gallery_mode === "album"
                ? html`
                    <div
                      style="margin-top: 20px; padding: 16px; background: #f0f8ff; border-radius: 8px; border-left: 4px solid #0077cc;"
                    >
                      <div
                        style="font-weight: 600; font-size: 1.05em; margin-bottom: 12px; color: #0077cc;"
                      >
                        Album Mode Settings
                      </div>
                      ${createToggleRow(
                        "3D Effect (Perspective)",
                        "album_3d_effect",
                        this.config.album_3d_effect !== false,
                        (e) => this._onSwitchChange(e, "album_3d_effect"),
                      )}
                      ${createToggleRow(
                        "Rounded Cards",
                        "album_card_rounded",
                        this.config.album_card_rounded !== false,
                        (e) => this._onSwitchChange(e, "album_card_rounded"),
                      )}
                      <div class="form-row">
                        <label>Remove Button Style</label>
                        ${createButtonGroup(
                          [
                            { value: "outside", label: "Outside" },
                            { value: "inside", label: "Inside" },
                            { value: "square", label: "Square" },
                          ],
                          this.config.album_remove_button_style || "outside",
                          createButtonGroupChangeHandler(
                            "album_remove_button_style",
                            (value) => {
                              this.config.album_remove_button_style = value;
                              this._fireConfigChanged();
                            },
                          ),
                        )}
                      </div>
                    </div>
                  `
                : this.config.pixel_art_gallery_mode === "carousel"
                  ? renderModeSettingsSection(
                      "Carousel Mode Settings",
                      html`
                        <div class="form-row">
                          <label>Navigation Button Shape</label>
                          ${createButtonGroup(
                            [
                              { value: "circle", label: "Circle" },
                              { value: "rect", label: "Rounded" },
                              { value: "square", label: "Square" },
                            ],
                            this.config.carousel_button_shape || "rect",
                            createButtonGroupChangeHandler(
                              "carousel_button_shape",
                              (value) => {
                                this.config.carousel_button_shape = value;
                                this._fireConfigChanged();
                              },
                            ),
                          )}
                        </div>
                        ${createToggleRow(
                          "Wrap Navigation (Infinite Loop)",
                          "carousel_wrap_navigation",
                          this.config.carousel_wrap_navigation === true,
                          (e) =>
                            this._onSwitchChange(e, "carousel_wrap_navigation"),
                        )}
                        ${createToggleRow(
                          "Show Indicators Outside Card",
                          "carousel_indicators_outside",
                          this.config.carousel_indicators_outside === true,
                          (e) =>
                            this._onSwitchChange(
                              e,
                              "carousel_indicators_outside",
                            ),
                        )}
                      `,
                    )
                  : this.config.pixel_art_gallery_mode === "compact"
                    ? renderModeSettingsSection(
                        "Compact Mode Settings",
                        html`
                          ${createToggleRow(
                            "Show Pixel Art Preview",
                            "compact_show_preview",
                            this.config.compact_show_preview !== false,
                            (e) =>
                              this._onSwitchChange(e, "compact_show_preview"),
                          )}
                        `,
                      )
                    : ""
            }
            ${
              // Only show "Items Per Page" for grid and list modes
              (this.config.pixel_art_gallery_mode || "grid") !== "carousel" &&
              this.config.pixel_art_gallery_mode !== "album" &&
              this.config.pixel_art_gallery_mode !== "compact"
                ? createSliderRow(
                    "Items Per Page",
                    this.config.pixel_art_items_per_page || 12,
                    {
                      min: 1,
                      max: 50,
                      step: 1,
                    },
                    this._onItemsPerPageChange.bind(this),
                  )
                : ""
            }

            <!-- GROUP 3: Visual Styling - Container & Cards -->
            ${createToggleRow(
              "Show Gallery Container as Card",
              "pixel_art_gallery_container_card",
              this.config.pixel_art_gallery_container_card !== false,
              (e) =>
                this._onSwitchChange(e, "pixel_art_gallery_container_card"),
            )}
            ${createToggleRow(
              "Show Pixel Art Items as Cards",
              "pixel_art_items_as_cards",
              this.config.pixel_art_items_as_cards !== false,
              (e) => this._onSwitchChange(e, "pixel_art_items_as_cards"),
            )}
            <div class="form-row">
              <label>Gallery Background Color</label>
              ${createButtonGroup(
                [
                  { value: "transparent", label: "Transparent" },
                  { value: "white", label: "White" },
                  { value: "black", label: "Black" },
                ],
                this.config.pixel_art_background_color || "transparent",
                createButtonGroupChangeHandler(
                  "pixel_art_background_color",
                  (value) => {
                    this.config.pixel_art_background_color = value;
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
            ${(this.config.pixel_art_background_color || "transparent") !== "black" ? createToggleRow(
              "Ignore Black Pixels",
              "gallery_ignore_black_pixels",
              this.config.gallery_ignore_black_pixels === true,
              (e) => this._onSwitchChange(e, "gallery_ignore_black_pixels"),
            ) : ''}

            <!-- GROUP 4: Preview Appearance -->
            <div class="form-row">
              <label>Gallery Pixel Style</label>
              ${createButtonGroup(
                [
                  { value: "round", label: "Round" },
                  { value: "square", label: "Square" },
                ],
                this.config.pixel_art_pixel_style || "round",
                createButtonGroupChangeHandler(
                  "pixel_art_pixel_style",
                  (value) => {
                    this.config.pixel_art_pixel_style = value;
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
            ${createSliderRow(
              "Gallery Pixel Gap",
              this.config.pixel_art_pixel_gap || 0,
              {
                min: 0,
                max: 6,
                step: 1,
              },
              this._onPixelArtPixelGapChange.bind(this),
              "px",
            )}
            ${createSliderRow(
              "Gallery Preview Size",
              this.config.pixel_art_preview_size || 100,
              {
                min: 30,
                max: 100,
                step: 1,
              },
              this._onPixelArtPreviewSizeChange.bind(this),
              "%",
            )}
            ${createToggleRow(
              "Pixel Art Matrix Box Shadow",
              "pixel_art_matrix_box_shadow",
              this.config.pixel_art_matrix_box_shadow === true,
              (e) => this._onSwitchChange(e, "pixel_art_matrix_box_shadow"),
            )}
            ${createToggleRow(
              "Pixel Art Pixel Box Shadow",
              "pixel_art_pixel_box_shadow",
              this.config.pixel_art_pixel_box_shadow !== false,
              (e) => this._onSwitchChange(e, "pixel_art_pixel_box_shadow"),
            )}

            <!-- GROUP 5: Content & Labels -->
            ${createToggleRow(
              "Show Pixel Art Titles",
              "pixel_art_show_titles",
              this.config.pixel_art_show_titles !== false,
              (e) => this._onSwitchChange(e, "pixel_art_show_titles"),
            )}
            ${
              // Only show "Allow Rename" when titles are visible
              this.config.pixel_art_show_titles !== false
                ? createToggleRow(
                    "Allow Rename Pixel Art",
                    "pixel_art_allow_rename",
                    this.config.pixel_art_allow_rename === true,
                    (e) => this._onSwitchChange(e, "pixel_art_allow_rename"),
                  )
                : ""
            }
          </div>
        </div>

        <!-- Import/Export Actions Section -->
        <div
          class="editor-card${this._folded.importExport
            ? " editor-card-collapsed"
            : ""}"
        >
          <div
            class="editor-card-header"
            @click="${() => this._toggleFold("importExport")}"
          >
            Import/Export Actions ${chevronIcon(this._folded.importExport)}
          </div>
          <div class="editor-card-content">
            ${createToggleRow(
              "Show Export Button",
              "show_pixelart_export_button",
              this.config.show_pixelart_export_button !== false,
              (e) => this._onSwitchChange(e, "show_pixelart_export_button"),
            )}
            ${createToggleRow(
              "Show Import Button",
              "show_pixelart_import_button",
              this.config.show_pixelart_import_button !== false,
              (e) => this._onSwitchChange(e, "show_pixelart_import_button"),
            )}
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
                this.config.pixelart_buttons_style || "modern",
                createButtonGroupChangeHandler(
                  "pixelart_buttons_style",
                  (value) => {
                    this.config.pixelart_buttons_style = value;
                    this._fireConfigChanged();
                  },
                ),
              )}
            </div>
            ${(this.config.pixelart_buttons_style || "modern") !== "icon"
              ? html`
                  <div class="config-row">
                    <label class="config-label">Content Mode</label>
                    <div
                      style="display: flex; flex-direction: column; align-items: flex-end;"
                    >
                      ${createButtonGroup(
                        [
                          { value: "icon", label: "Icon" },
                          { value: "text", label: "Text" },
                          { value: "icon_text", label: "Icon + Text" },
                        ],
                        this.config.pixelart_content_mode || "icon_text",
                        createButtonGroupChangeHandler(
                          "pixelart_content_mode",
                          (value) => {
                            this.config.pixelart_content_mode = value;
                            this._fireConfigChanged();
                          },
                        ),
                      )}
                    </div>
                  </div>
                `
              : html`
                  <div class="config-row" style="opacity: 0.5;">
                    <label class="config-label">Content Mode</label>
                    <div style="font-size: 0.85em; color: #888;">
                      Icon style always uses icon-only
                    </div>
                  </div>
                `}
          </div>
        </div>
      </div>
    `;
  }

  _onPaletteDisplayModeChange(e) {
    this.config.palette_display_mode = e.target.value;
    this._fireConfigChanged();
  }

  _onTitleInput(e) {
    this.localTitle = e.target.value;
    this.config.title = this.localTitle;
    this._fireConfigChanged();
  }

  _onEntitySelectMultiple(e) {
    // Get selected values from multi-select
    const selectedValues = Array.from(e.target.selectedOptions).map(
      (option) => option.value,
    );

    this.config.target_entities = selectedValues;
    // Keep the first entity as the main entity for backward compatibility
    this.config.entity = selectedValues.length > 0 ? selectedValues[0] : "";

    this._fireConfigChanged();
  }

  _onEntitySelect(e) {
    // Handle multi-entity selection
    if (Array.isArray(e.target.value)) {
      this.config.target_entities = e.target.value;
      // Keep the first entity as the main entity for backward compatibility
      this.config.entity = e.target.value.length > 0 ? e.target.value[0] : "";
    } else {
      // Single entity selection (fallback)
      this.config.entity = e.target.value;
      this.config.target_entities = e.target.value ? [e.target.value] : [];
    }
    this._fireConfigChanged();
  }

  // New centralized slider handlers
  _onDrawingMatrixPixelGapChange(e) {
    this.config.pixel_gap = Number(e.target.value);
    this._fireConfigChanged();
  }

  _onMatrixSizeChange(e) {
    this.config.matrix_size = e.target.value;
    this._fireConfigChanged();
  }

  _onItemsPerPageChange(e) {
    this.config.pixel_art_items_per_page = parseInt(e.target.value, 10);
    this._fireConfigChanged();
  }

  _onPixelArtPixelGapChange(e) {
    const newGap = Number(e.target.value);
    this._pendingPixelGap = newGap;

    // Update config immediately for slider position
    this.config.pixel_art_pixel_gap = newGap;

    // Throttle the expensive config-changed event using requestAnimationFrame
    if (!this._pixelGapUpdateScheduled) {
      this._pixelGapUpdateScheduled = true;
      requestAnimationFrame(() => {
        this._pixelGapUpdateScheduled = false;
        // Use the most recent value
        if (this._pendingPixelGap !== null) {
          this.config.pixel_art_pixel_gap = this._pendingPixelGap;
          this._pendingPixelGap = null;
          this._fireConfigChanged();
        }
      });
    }
  }

  _onPixelArtPreviewSizeChange(e) {
    const newSize = Number(e.target.value);
    this._pendingPreviewSize = newSize;

    // Update config immediately for slider position
    this.config.pixel_art_preview_size = newSize;

    // Throttle the expensive config-changed event using requestAnimationFrame
    if (!this._previewSizeUpdateScheduled) {
      this._previewSizeUpdateScheduled = true;
      requestAnimationFrame(() => {
        this._previewSizeUpdateScheduled = false;
        // Use the most recent value
        if (this._pendingPreviewSize !== null) {
          this.config.pixel_art_preview_size = this._pendingPreviewSize;
          this._pendingPreviewSize = null;
          this._fireConfigChanged();
        }
      });
    }
  }

  _onSwitchChange(e, key) {
    this.config[key] = e.target.checked;
    this._fireConfigChanged();

    // Trigger re-render for settings that affect other setting visibility
    if (key === "pixel_art_show_titles") {
      this.requestUpdate();
    }
  }

  _fireConfigChanged() {
    // Dispatch on this element for Home Assistant
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this.config },
        bubbles: true,
        composed: true,
      }),
    );

    // Also dispatch on window for main card listening
    window.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this.config },
        bubbles: true,
        composed: true,
      }),
    );

    // Special event for tool order changes
    window.dispatchEvent(
      new CustomEvent("yeelight-tools-reordered", {
        detail: {
          config: this.config,
          tools_order: this.config.tools_order,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onMatrixSizeSliderChange(e) {
    const val = Number(e.target.value);
    this.config.matrix_size = val;
    this._fireConfigChanged();
  }

  _renderEntityPicker() {
    if (!this._hass) {
      return html`<div style="color: #666; font-style: italic; padding: 8px;">
        Loading entities...
      </div>`;
    }

    if (!this._hass.states) {
      return html`<div style="color: #666; font-style: italic; padding: 8px;">
        No entities available
      </div>`;
    }

    // Get all light entities and filter for our custom component
    const allLightEntities = Object.keys(this._hass.states)
      .filter((entityId) => entityId.startsWith("light."))
      .sort();

    // Filter to only show entities from our yeelight_cube component
    const ourComponentEntities = allLightEntities.filter((entityId) => {
      const state = this._hass.states[entityId];
      const attributes = state?.attributes || {};

      // Check for our internal component identifier or entity name pattern
      return (
        attributes._yeelight_cube_component ===
          "yeelight-cube-component-v1.0" ||
        entityId.includes("cube") ||
        entityId.includes("cubelite")
      );
    });

    const selectedEntities = this.config.target_entities || [];

    return html`
      <div
        style="border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;"
      >
        <!-- Header -->
        <div
          style="padding: 12px 16px 8px 16px; font-weight: 500; color: #333; border-bottom: 1px solid #e8e8e8; background: #f5f5f5; border-radius: 8px 8px 0 0;"
        >
          Yeelight Cube Lite Entities (${ourComponentEntities.length})
        </div>

        <!-- Entity list -->
        <div style="max-height: 200px; overflow-y: auto; padding: 8px;">
          ${ourComponentEntities.length === 0
            ? html`<div
                style="color: #666; font-style: italic; text-align: center; padding: 20px;"
              >
                <div style="margin-bottom: 8px;">
                  No Yeelight Cube Lite entities found
                </div>
                <div style="font-size: 0.85em; color: #999;">
                  Make sure you have Yeelight Cube Lite devices configured in this
                  integration
                </div>
              </div>`
            : ourComponentEntities.map((entityId) => {
                const isSelected = selectedEntities.includes(entityId);
                const state = this._hass.states[entityId];
                const friendlyName =
                  state?.attributes?.friendly_name || entityId;
                return html`
                  <div
                    style="display: flex; align-items: center; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: ${isSelected
                      ? "#e3f2fd"
                      : "#fff"}; cursor: pointer; border: 1px solid ${isSelected
                      ? "#2196f3"
                      : "#e0e0e0"};"
                    @click="${() => this._toggleEntitySelection(entityId)}"
                  >
                    <input
                      type="checkbox"
                      .checked="${isSelected}"
                      @click="${(e) => e.stopPropagation()}"
                      @change="${() => this._toggleEntitySelection(entityId)}"
                      style="margin-right: 12px; transform: scale(1.2);"
                    />
                    <div style="flex: 1;">
                      <div style="font-weight: 500; color: #333;">
                        ${friendlyName}
                      </div>
                      <div style="font-size: 0.85em; color: #666;">
                        ${entityId}
                      </div>
                    </div>
                  </div>
                `;
              })}
        </div>

        <!-- Footer with selection count -->
        ${selectedEntities.length > 0
          ? html`<div
              style="padding: 8px 16px; background: #f0f8ff; border-top: 1px solid #e8e8e8; border-radius: 0 0 8px 8px; font-size: 0.9em; color: #1976d2;"
            >
              ${selectedEntities.length} entities selected for drawing
              operations
            </div>`
          : ""}
      </div>
    `;
  }

  _toggleEntitySelection(entityId) {
    const currentSelection = this.config.target_entities || [];
    const isSelected = currentSelection.includes(entityId);

    if (isSelected) {
      // Remove from selection
      this.config.target_entities = currentSelection.filter(
        (id) => id !== entityId,
      );
    } else {
      // Add to selection
      this.config.target_entities = [...currentSelection, entityId];
    }

    // Keep the first entity as the main entity for backward compatibility
    this.config.entity =
      this.config.target_entities.length > 0
        ? this.config.target_entities[0]
        : "";

    this._fireConfigChanged();
  }
}

customElements.define(
  "yeelight-cube-draw-card-editor",
  YeelightCubeDrawCardEditor,
);
