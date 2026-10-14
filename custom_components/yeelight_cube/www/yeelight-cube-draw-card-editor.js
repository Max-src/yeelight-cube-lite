import "./preview-appearance-editor.js";
import { orderableListStyles, renderOrderableList } from "./orderable-list-utils.js";
import {
  toolsOrder,
  actionsOrder,
  hiddenTools,
  hiddenActions,
  actionLabel,
} from "./draw_card_tools.js";
import { renderActionButtonSettings } from "./action-button-ui.js";
import { LitElement, html, css } from "./lib/lit-all.js";
import { sharedEditorStyles, YeelightEditorMixin } from "./editor_ui_utils.js";
import { normalizeCardOptions } from "./card-config.js";
import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import { renderSwatchSettings } from "./swatch-settings-ui.js";
import { renderSectionLayoutSettings } from "./section-layout-settings.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { TOOL_CONFIG } from "./draw_card_const.js";
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

    // Throttle state for slider updates
    this._previewSizeUpdateScheduled = false;
    this._pendingPreviewSize = null;
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

  // The tools / actions shown and their order (the shared ordered list):
  // the list is what is shown; the rest is hidden, after it in the order.
  _setShown(orderKey, hiddenKey, all, shown) {
    const hidden = all.filter((name) => name !== "spacer" && !shown.includes(name));
    this._setOptions({ [orderKey]: [...shown, ...hidden], [hiddenKey]: hidden });
  }

  _shownList({ orderKey, hiddenKey, all, hidden, labelFor, extra = [], noun }) {
    return renderOrderableList({
      items: all.filter((name) => !hidden.includes(name)),
      available: [...all.filter((name) => hidden.includes(name)), ...extra],
      labelFor,
      addPlaceholder: `Show ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}…`,
      onUpdate: (shown) => this._setShown(orderKey, hiddenKey, all, shown),
      onReset: () => this._setOptions({ [orderKey]: undefined, [hiddenKey]: [] }),
      resetLabel: `Show all ${noun}s, default order`,
    });
  }

  _onSectionVisibilityChange(sectionId, visible) {
    this._setOption(`show_${sectionId}_section`, visible);
  }


  // Unset options keep their defaults (each row reads the card's default):
  // only what the user changes is saved.
  setConfig(config) {
    this._config = { ...normalizeCardOptions(config, "draw") };
    // Tools / actions this browser hid in former versions: kept with the
    // card's config from now on (saved with the next change).
    if (!Array.isArray(this._config.hidden_tools) && hiddenTools(this._config).length)
      this._config.hidden_tools = [...hiddenTools(this._config)];
    if (!Array.isArray(this._config.hidden_actions) && hiddenActions(this._config).length)
      this._config.hidden_actions = [...hiddenActions(this._config)];
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
            ${renderSectionLayoutSettings({
              config: this._config,
              set: (key, value) => this._setOption(key, value),
              keys: {
                layout: "palette_card_mode",
                style: "colors_section_style",
                border: "colors_card_border",
                width: "side_card_width",
                zoom: "side_click_zoom",
                radius: "colors_item_radius",
                buttonShape: "colors_button_shape",
                wrap: "colors_wrap_navigation",
                overlay: "colors_preview_overlay",
                tabIcons: "colors_tab_icons",
                headers: "colors_compact_headers",
              },
              defaults: { layout: "side", border: "auto", tabIcons: false, headers: true },
              styled: ["grouped", "compact"],
            })}
            ${renderSwatchSettings(
              this._config,
              (key, value) => this._setOption(key, value),
              {
                defaults: { layout: "row", shape: "round" },
                selectable: true,
                sizeKey: "colors_size",
              },
            )}
        `)}

        <!-- Tool Order Section -->
        <!-- Tool Settings Section -->
        ${this._section("tools", "Drawing Tools", html`
            <!-- The tools shown and their order (drag or the arrows; ✕ hides,
                 the menu shows again) -->
            <div class="form-row"><label>Tools</label></div>
            ${this._shownList({
              orderKey: "tools_order",
              hiddenKey: "hidden_tools",
              all: toolsOrder(this._config),
              hidden: hiddenTools(this._config),
              labelFor: (tool) => TOOL_CONFIG[tool]?.label || tool,
              noun: "tool",
            })}

            <!-- Tool button appearance settings -->
            <div
              style="margin-top:16px;border-top:1px solid var(--divider-color, #e0e0e0);padding-top:16px;"
            >
              <div class="form-row">
                <label>Button Shape</label>
                ${createButtonGroup(
                  [
                    { value: "round", label: "Circle" },
                    { value: "rounded", label: "Rounded" },
                    { value: "square", label: "Square" },
                  ],
                  this._config.tool_buttons_shape || "rounded",
                  createButtonGroupChangeHandler("tool_buttons_shape", (value) =>
                    this._setOption("tool_buttons_shape", value),
                  ),
                )}
              </div>
              ${renderActionButtonSettings(
                this._config,
                (key, value) => this._setOption(key, value),
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
            <!-- The actions shown and their order; spacers are empty slots
                 (any number) for alignment -->
            <div class="form-row"><label>Actions</label></div>
            ${this._shownList({
              orderKey: "actions_order",
              hiddenKey: "hidden_actions",
              all: actionsOrder(this._config),
              hidden: hiddenActions(this._config),
              labelFor: actionLabel,
              extra: ["spacer"],
              noun: "action",
            })}

            <!-- Action button appearance settings -->
            <div
              style="margin-top:16px;border-top:1px solid var(--divider-color, #e0e0e0);padding-top:16px;"
            >
              ${renderActionButtonSettings(
                this._config,
                (key, value) => this._setOption(key, value),
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
              (key, value) => this._setOption(key, value),
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

  static appearanceProfile = "draw";

  _onMatrixSizeSliderChange(e) {
    this._setOption("matrix_size", Number(e.target.value));
  }

}

defineOnce("yeelight-cube-draw-card-editor", YeelightCubeDrawCardEditor);
