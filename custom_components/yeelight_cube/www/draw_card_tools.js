// Tool Management Module for Yeelight Cube Lite Draw Card
import { html } from "./lib/lit-all.js";
import { handleColorPickerClick } from "./color-picker-utils.js";
import { getExportImportButtonClass } from "./action-button-utils.js";
import {
  renderActionButton,
  renderActionButtonContent,
  renderActionRow,
} from "./action-button-ui.js";
import {
  TOOL_CONFIG,
  DEFAULT_TOOL_ORDER,
  DEFAULT_ACTION_ORDER,
} from "./draw_card_const.js";
import { StorageUtils } from "./draw_card_storage.js";

/**
 * The tools in the card's order (tools_order): every known tool once, the
 * stored ones first (a tool added since keeps its default place at the end).
 */
export function toolsOrder(config) {
  const stored = Array.isArray(config?.tools_order) ? config.tools_order : [];
  const known = stored.filter((tool, index) =>
    DEFAULT_TOOL_ORDER.includes(tool) && stored.indexOf(tool) === index,
  );
  return [...known, ...DEFAULT_TOOL_ORDER.filter((tool) => !known.includes(tool))];
}

export class ToolManager {
  constructor(card) {
    this.card = card;
    this.dragState = null;
    // Load tool visibility state from localStorage
    this.toolVisibility = this.loadToolVisibility();
    // Editor resets (EVT_TOOL_VISIBILITY_RESET) are handled by the card, which
    // adds/removes its window listener with its own connect/disconnect.
  }

  // Load tool visibility state from localStorage
  loadToolVisibility() {
    return StorageUtils.loadToolVisibility();
  }

  // Save tool visibility state to localStorage
  saveToolVisibility() {
    StorageUtils.saveToolVisibility(this.toolVisibility);
  }

  // Toggle tool visibility
  toggleToolVisibility(tool) {
    this.toolVisibility[tool] = !this.isToolVisible(tool);
    this.saveToolVisibility();
    this.card.requestUpdate();
  }

  // Check if tool is visible (default to visible)
  isToolVisible(tool) {
    return this.toolVisibility[tool] !== false;
  }

  // Get tools order from config or use default
  getToolsOrder(config) {
    return toolsOrder(config);
  }

  // Get default tools order
  getDefaultToolsOrder() {
    return [...DEFAULT_TOOL_ORDER];
  }

  // Filter tools based on config visibility options
  filterTools(toolsOrder, config) {
    const showColorPicker = config.show_color_picker !== false;
    const showEraserTool = config.show_eraser_tool !== false;
    const showFillTool = config.show_fill_tool !== false;

    return toolsOrder.filter((tool) => {
      switch (tool) {
        case "colorPicker":
        case "eyedropper":
          return showColorPicker;
        case "eraser":
          return showEraserTool;
        case "areaFill":
        case "fillAll":
          return showFillTool;
        default:
          return true; // Keep other tools by default
      }
    });
  }

  // Get tool content (icon or label)
  getToolContent(tool, paintContent) {
    const cfg = TOOL_CONFIG[tool];
    if (!cfg) return tool;
    if (paintContent === "label") {
      return cfg.label;
    }
    return html`<ha-icon icon="${cfg.icon}"></ha-icon>`;
  }

  // Get tool selection state
  getToolSelection(tool) {
    switch (tool) {
      case "pencil":
        return this.card.pencilMode;
      case "colorPicker":
        return false; // colorPicker is an input, not a mode
      case "eyedropper":
        return this.card.colorPickerMode; // eyedropper uses colorPickerMode
      case "eraser":
        return this.card.eraserMode;
      case "areaFill":
        return this.card.areaFillMode;
      case "fillAll":
        return this.card.fillAllMode;
      default:
        return false;
    }
  }

  // Get tool title/tooltip
  getToolTitle(tool) {
    const cfg = TOOL_CONFIG[tool];
    return cfg ? cfg.title : tool;
  }

  // Handle tool click
  handleToolClick(tool) {
    if (tool === "undo") {
      this.card._undoMatrix();
    } else if (tool === "colorPicker") {
      // colorPicker is handled by the input element directly, not as a mode
      return;
    } else {
      this.selectTool(tool);
    }
  }

  // Select a tool
  selectTool(tool) {
    this.card.pencilMode = tool === "pencil";
    this.card.eraserMode = tool === "eraser";
    this.card.areaFillMode = tool === "areaFill";
    this.card.fillAllMode = tool === "fillAll";
    this.card.colorPickerMode = tool === "eyedropper"; // eyedropper enables color picking mode
    this.card.previewFillArea = new Set();
    this.card.requestUpdate();
  }

  // Render individual tool
  renderTool(tool, index, config, paintShape) {
    const editMode =
      config?.edit_drawing_tools ??
      config?.allow_visual_tool_reordering ??
      false;
    const isVisible = this.isToolVisible(tool);

    // In edit mode, show hidden tools in gray; otherwise hide them completely
    const shouldShowTool = isVisible || editMode;
    const toolOpacity = editMode && !isVisible ? "0.3" : "1";

    // Tool button style system
    const toolStyle = config?.tool_buttons_style || "modern";
    const toolContentMode =
      toolStyle === "icon" ? "icon" : config?.tool_content_mode || "icon";

    const getToolClass = (selected) => {
      const base = getExportImportButtonClass(
        selected ? "tool-active" : "tool",
        toolStyle,
      );
      // Add shape modifier for non-icon styles
      if (toolStyle !== "icon") {
        return `${base} tool-shape-${paintShape}`;
      }
      return base;
    };

    // Visibility toggle template
    const visibilityToggle = editMode
      ? html`
          <div
            class="tool-visibility-toggle"
            title="${isVisible ? "Hide tool" : "Show tool"}"
            style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); font-size: 16px; color: ${isVisible
              ? "var(--primary-color, #0077cc)"
              : "var(--divider-color, #ccc)"}; cursor: pointer; z-index: 10; user-select: none; background: color-mix(in srgb, var(--primary-color, #0077cc) 10%, transparent); border-radius: 4px; padding: 4px; border: 2px solid color-mix(in srgb, var(--primary-color, #0077cc) 30%, transparent); line-height: 1; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;"
            @click="${(e) => {
              e.preventDefault();
              e.stopPropagation();
              this.toggleToolVisibility(tool);
            }}"
          >
            👁
          </div>
        `
      : "";

    // Special handling for color picker
    if (tool === "colorPicker") {
      return html`
        <div
          class="tool-item"
          data-tool="${tool}"
          data-index="${index}"
          style="position: relative; ${!shouldShowTool
            ? "visibility: hidden;"
            : ""} opacity: ${toolOpacity};"
        >
          ${visibilityToggle}
          <input
            type="color"
            .value="${this.card.selectedColor}"
            title="Pick Color"
            @click="${(event) => handleColorPickerClick(event, this.card)}"
            @input="${(e) => this.card._onColorPicker(e)}"
            class="color-picker-btn tool-shape-${paintShape}"
            style="background:${this.card.selectedColor};"
          />
        </div>
      `;
    }

    // Regular tool buttons (including eyedropper)
    const isSelected = this.getToolSelection(tool);
    const clickHandler = () => this.handleToolClick(tool);

    return html`
      <div
        class="tool-item"
        data-tool="${tool}"
        data-index="${index}"
        style="position: relative; ${!shouldShowTool
          ? "visibility: hidden;"
          : ""} opacity: ${toolOpacity};"
      >
        ${visibilityToggle}
        <button
          class="${getToolClass(isSelected)}"
          title="${this.getToolTitle(tool)}"
          @click="${clickHandler}"
        >
          ${renderActionButtonContent(
            TOOL_CONFIG[tool]?.icon || "mdi:help",
            TOOL_CONFIG[tool]?.label || tool,
            toolContentMode,
          )}
        </button>
      </div>
    `;
  }

  // Render tools section
  renderToolsSection(config, paintShape, paintContent) {
    // Get tools order and filter based on visibility
    let toolsOrder = this.getToolsOrder(config);
    toolsOrder = this.filterTools(toolsOrder, config);
    const editMode =
      config.edit_drawing_tools ?? config.allow_visual_tool_reordering ?? false;
    if (!editMode)
      toolsOrder = toolsOrder.filter((tool) => this.isToolVisible(tool));
    if (!toolsOrder.length) return "";

    return html`
      <div class="toolbar-container">
        <div
          class="toolbar"
          style="min-width: 100%; justify-content: space-between;"
        >
          ${toolsOrder.map((tool, index) =>
            this.renderTool(tool, index, config, paintShape),
          )}
        </div>
      </div>
    `;
  }
}

// Action Management Module for Yeelight Cube Lite Draw Card Action Buttons
export class ActionManager {
  constructor(card) {
    this.card = card;
    // Load action visibility state from localStorage
    this.actionVisibility = this.loadActionVisibility();
    // Editor resets (EVT_ACTION_VISIBILITY_RESET) are handled by the card, which
    // adds/removes its window listener with its own connect/disconnect.
  }

  // Load action visibility state from localStorage
  loadActionVisibility() {
    this.actionVisibility = StorageUtils.loadActionVisibility();
    return this.actionVisibility;
  }

  // Save action visibility state to localStorage
  saveActionVisibility() {
    StorageUtils.saveActionVisibility(this.actionVisibility);
  }

  // Toggle action visibility
  toggleActionVisibility(action) {
    this.actionVisibility[action] = !this.isActionVisible(action);
    this.saveActionVisibility();
    this.card.requestUpdate();
  }

  // Check if action is visible (default to visible)
  isActionVisible(action) {
    // Spacers are always considered "visible" for alignment purposes
    if (
      action === null ||
      action === "" ||
      action === "spacer" ||
      action === "empty"
    ) {
      return true;
    }
    return this.actionVisibility[action] !== false;
  }

  // Load action order from localStorage (if we ever implement localStorage for action order)
  loadActionOrder() {
    // For now, just trigger a refresh since action order comes from config
    this.card.requestUpdate();
  }

  // Get actions order from config or use default
  getActionsOrder(config) {
    // Check multiple possible locations for actions order
    const order = config.actions_order ||
      config.actions ||
      (config.button_areas && config.button_areas.actions) || [
        ...DEFAULT_ACTION_ORDER,
      ];

    return order;
  }

  // Get default actions order
  getDefaultActionsOrder() {
    return [...DEFAULT_ACTION_ORDER];
  }

  // Render individual action button
  renderAction(action, index, config, paintShape) {
    const editMode = config?.edit_action_buttons ?? false;

    // Check if this is a spacer item
    const isSpacer =
      action === null ||
      action === "" ||
      action === "spacer" ||
      action === "empty";

    if (isSpacer) {
      // Always render spacers, but show them differently in edit mode
      const actionConfig = this.getActionConfig(action);
      return html`
        <div
          class="action-item action-spacer-item"
          data-action="${action || "spacer"}"
          data-index="${index}"
          style="position: relative; opacity: ${editMode ? "0.5" : "1"};"
        >
          ${editMode
            ? html`
                <div
                  class="action-spacer-indicator"
                  title="Spacer item (for alignment)"
                  style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); font-size: 12px; color: var(--secondary-text-color, #999); cursor: default; z-index: 10; user-select: none; background: color-mix(in srgb, var(--divider-color, #999) 10%, transparent); border-radius: 4px; padding: 2px 4px; border: 1px dashed var(--divider-color, #999); line-height: 1; display: flex; align-items: center; justify-content: center;"
                >
                  ⬜
                </div>
              `
            : ""}
          ${actionConfig.element}
        </div>
      `;
    }

    const isVisible = this.isActionVisible(action);

    // If not in edit mode and action is not visible, don't render it at all
    if (!editMode && !isVisible) {
      return null;
    }

    const actionOpacity = editMode && !isVisible ? "0.3" : "1";

    // Get action content and handlers
    const actionConfig = this.getActionConfig(action);
    if (!actionConfig) return null;

    return html`
      <div
        class="action-item"
        data-action="${action}"
        data-index="${index}"
        style="position: relative; opacity: ${actionOpacity};"
      >
        ${editMode
          ? html`
              <div
                class="action-visibility-toggle"
                title="${isVisible ? "Hide action" : "Show action"}"
                style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); font-size: 16px; color: ${isVisible
                  ? "var(--primary-color, #0077cc)"
                  : "var(--divider-color, #ccc)"}; cursor: pointer; z-index: 10; user-select: none; background: color-mix(in srgb, var(--primary-color, #0077cc) 10%, transparent); border-radius: 4px; padding: 4px; border: 2px solid color-mix(in srgb, var(--primary-color, #0077cc) 30%, transparent); line-height: 1; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;"
                @click="${(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.toggleActionVisibility(action);
                }}"
              >
                👁
              </div>
            `
          : ""}
        ${actionConfig.element}
      </div>
    `;
  }

  // Get action configuration
  getActionConfig(action) {
    const cfg = this.card.config || {};
    const actionsStyle = cfg.actions_buttons_style || "modern";
    const contentMode =
      actionsStyle === "icon" ? "icon" : cfg.actions_content_mode || "icon";

    const btnClass = (type) => getExportImportButtonClass(type, actionsStyle);

    switch (action) {
      case "clear":
        return {
          element: renderActionButton({
            action: "clear",
            buttonStyle: actionsStyle,
            contentMode,
            icon: "mdi:restore",
            label: "Clear",
            onClick: () => {
              this.card.matrixOperations.clearMatrix();
              this.card.constructor
                .getStorageUtils()
                .saveMatrix(this.card.matrix);
            },
          }),
        };

      case "upload":
        return {
          element: html`
            <label
              class="upload-label ${btnClass("upload")}"
              title="Upload Image"
            >
              ${renderActionButtonContent(
                "mdi:arrow-up-circle-outline",
                "Upload",
                contentMode,
              )}
              <input
                type="file"
                accept="image/*"
                @change="${this.card._onImageUpload}"
                style="display:none;"
              />
            </label>
          `,
        };

      case "save":
        return {
          element: renderActionButton({
            action: "save",
            buttonStyle: actionsStyle,
            contentMode,
            icon: "mdi:content-save",
            label: "Save",
            title: "Save as Pixel Art",
            onClick: () =>
              this.card
                ._savePixelArt()
                .catch((err) =>
                  this.card._reportFailure(err, "Failed to save pixel art."),
                ),
          }),
        };

      case "apply":
        return {
          element: renderActionButton({
            action: "apply",
            buttonStyle: actionsStyle,
            contentMode,
            icon: "mdi:send",
            label: "Apply",
            onClick: () =>
              this.card
                ._sendToLamp()
                .catch((err) =>
                  this.card._reportFailure(
                    err,
                    "Failed to send the drawing to the lamp.",
                  ),
                ),
          }),
        };

      default:
        // Handle spacer/empty items for alignment
        if (
          action === null ||
          action === "" ||
          action === "spacer" ||
          action === "empty"
        ) {
          return {
            element: html`
              <div
                class="action-spacer"
                style="min-width: 40px; min-height: 40px; visibility: hidden;"
                title="Spacer (for alignment)"
              >
                <!-- Empty spacer for alignment -->
              </div>
            `,
            isSpacer: true,
          };
        }
        return null;
    }
  }

  // Render actions section with proper ordering and visibility
  renderActionsSection(config, paintShape) {
    const actionsOrder = this.getActionsOrder(config);
    const actionsStyle = config?.actions_buttons_style || "modern";

    const renderedActions = actionsOrder
      .map((action, index) => {
        return this.renderAction(action, index, config, paintShape);
      })
      .filter((action) => action !== null);
    if (!renderedActions.length) return "";

    return renderActionRow(renderedActions, {
      buttonStyle: actionsStyle,
      contentMode: config?.actions_content_mode || "icon",
      slotted: true,
    });
  }
}
