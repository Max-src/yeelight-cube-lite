// Tool Management Module for Yeelight Cube Lite Draw Card
import { html } from "./lib/lit-all.js";
import {
  getExportImportButtonClass,
  renderButtonContent,
} from "./export-import-button-utils.js";
import {
  TOOL_CONFIG,
  DEFAULT_TOOL_ORDER,
  DEFAULT_ACTION_ORDER,
  EVT_TOOL_VISIBILITY_RESET,
  EVT_ACTION_VISIBILITY_RESET,
} from "./draw_card_const.js";
import { StorageUtils } from "./draw_card_storage.js";

export class ToolManager {
  constructor(card) {
    this.card = card;
    this.dragState = null;
    // Load tool visibility state from localStorage
    this.toolVisibility = this.loadToolVisibility();

    // Listen for tool visibility reset events from the editor
    window.addEventListener(EVT_TOOL_VISIBILITY_RESET, () => {
      this.toolVisibility = {};
      this.card.requestUpdate();
    });
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
    return config.tools_order || [...DEFAULT_TOOL_ORDER];
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
    const showIcon =
      toolContentMode === "icon" || toolContentMode === "icon_text";
    const showText =
      toolContentMode === "text" || toolContentMode === "icon_text";

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

    // Get tool icon html
    const getToolIcon = (tool) => {
      const cfg = TOOL_CONFIG[tool];
      const icon = cfg ? cfg.icon : "mdi:help";
      return html`<ha-icon icon="${icon}"></ha-icon>`;
    };

    // Get tool label
    const getToolLabel = (tool) => {
      const cfg = TOOL_CONFIG[tool];
      return cfg ? cfg.label : tool;
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
          ${showIcon ? getToolIcon(tool) : ""}${showText
            ? html`<span class="btn-text">${getToolLabel(tool)}</span>`
            : ""}
        </button>
      </div>
    `;
  }

  // Render tools section
  renderToolsSection(config, paintShape, paintContent) {
    // Get tools order and filter based on visibility
    let toolsOrder = this.getToolsOrder(config);
    toolsOrder = this.filterTools(toolsOrder, config);

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

  // Tool drag functionality
  startToolDrag(e, tool, index) {
    e.preventDefault();
    e.stopPropagation();

    const toolItem = e.target.closest(".tool-item");
    const toolbar = this.card.shadowRoot.querySelector(".toolbar");
    if (!toolItem || !toolbar) return;

    // Get initial tool order for debugging
    const initialOrder = Array.from(toolbar.querySelectorAll(".tool-item")).map(
      (item) => item.dataset.tool,
    );

    this.dragState = {
      tool,
      index,
      toolItem,
      toolbar,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      initialOrder: [...initialOrder], // Store for comparison
    };

    document.addEventListener("mousemove", this.handleDragMove);
    document.addEventListener("mouseup", this.handleDragEnd);
  }

  handleDragMove = (e) => {
    if (!this.dragState) return;

    const deltaX = Math.abs(e.clientX - this.dragState.startX);
    const deltaY = Math.abs(e.clientY - this.dragState.startY);

    if (!this.dragState.isDragging && (deltaX > 5 || deltaY > 5)) {
      this.dragState.isDragging = true;
      this.createDragVisuals();
    }

    if (this.dragState.isDragging) {
      this.updateDragPosition(e);
    }
  };

  handleDragEnd = (e) => {
    if (!this.dragState) return;

    if (this.dragState.isDragging) {
      this.finishDrag();
    }

    this.cleanupDrag();
  };

  createDragVisuals() {
    const { toolItem } = this.dragState;

    // Create placeholder
    this.dragState.placeholder = document.createElement("div");
    this.dragState.placeholder.style.cssText = `
      width: ${toolItem.offsetWidth}px;
      height: ${toolItem.offsetHeight}px;
      background: var(--secondary-background-color, #f0f0f0);
      border: 2px dashed var(--secondary-text-color, #999);
      opacity: 0.5;
      margin: ${getComputedStyle(toolItem).margin};
    `;

    toolItem.parentNode.insertBefore(
      this.dragState.placeholder,
      toolItem.nextSibling,
    );

    // Style dragged element
    toolItem.style.cssText += `
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      transform: scale(1.05) rotate(2deg);
      box-shadow: 0 5px 15px rgba(0,0,0,0.3);
      opacity: 0.9;
    `;
  }

  updateDragPosition(e) {
    const { toolItem } = this.dragState;
    toolItem.style.left = e.clientX - 30 + "px";
    toolItem.style.top = e.clientY - 20 + "px";

    // Find drop position
    const items = Array.from(
      this.dragState.toolbar.querySelectorAll(".tool-item"),
    ).filter((item) => item !== toolItem);

    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right) {
        const insertBefore = e.clientX < rect.left + rect.width / 2;
        if (insertBefore) {
          this.dragState.toolbar.insertBefore(this.dragState.placeholder, item);
        } else {
          this.dragState.toolbar.insertBefore(
            this.dragState.placeholder,
            item.nextSibling,
          );
        }
        break;
      }
    }
  }

  finishDrag() {
    const { toolItem, placeholder, toolbar, initialOrder, tool, index } =
      this.dragState;

    // Move to final position
    toolbar.insertBefore(toolItem, placeholder);

    // Get new order
    const newOrder = Array.from(toolbar.querySelectorAll(".tool-item")).map(
      (item) => item.dataset.tool,
    );

    // Find new index of the dragged tool
    const newIndex = newOrder.indexOf(tool);

    // Update config using the main card's update method
    if (this.card._updateConfig) {
      this.card._updateConfig({ tools_order: newOrder });
    } else {
      // Fallback: Update config directly and fire events manually
      this.card.config.tools_order = [...newOrder];

      // Fire config changed event for Home Assistant through the main card
      if (this.card._fireConfigChanged) {
        this.card._fireConfigChanged(this.card.config);
      } else {
        // Fallback to direct event dispatch
        this.card.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this.card.config },
            bubbles: true,
            composed: true,
          }),
        );
      }

      // Fire special event for immediate updates
      window.dispatchEvent(
        new CustomEvent("yeelight-tools-reordered", {
          detail: {
            config: this.card.config,
            tools_order: this.card.config.tools_order,
          },
          bubbles: true,
          composed: true,
        }),
      );

      // Force re-render
      this.card.requestUpdate();
    }

    // Clean up placeholder
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }

    // Reset styles
    toolItem.style.cssText = toolItem.style.cssText.replace(
      /position: fixed.*?opacity: 0.9;/s,
      "",
    );
  }

  cleanupDrag() {
    document.removeEventListener("mousemove", this.handleDragMove);
    document.removeEventListener("mouseup", this.handleDragEnd);
    this.dragState = null;
  }
}

// Action Management Module for Yeelight Cube Lite Draw Card Action Buttons
export class ActionManager {
  constructor(card) {
    this.card = card;
    // Load action visibility state from localStorage
    this.actionVisibility = this.loadActionVisibility();

    // Listen for action visibility reset events from the editor
    window.addEventListener(EVT_ACTION_VISIBILITY_RESET, () => {
      this.actionVisibility = {};

      this.card.requestUpdate();
    });
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
    const showIcon = contentMode === "icon" || contentMode === "icon_text";
    const showText = contentMode === "text" || contentMode === "icon_text";

    switch (action) {
      case "clear":
        return {
          element: html`
            <button
              class="${btnClass("clear")}"
              title="Clear"
              @click="${() => {
                this.card.matrixOperations.clearMatrix();
                this.card.constructor
                  .getStorageUtils()
                  .saveMatrix(this.card.matrix);
              }}"
            >
              ${showIcon
                ? html`<ha-icon icon="mdi:restore"></ha-icon>`
                : ""}${showText
                ? html`<span class="btn-text">Clear</span>`
                : ""}
            </button>
          `,
        };

      case "upload":
        return {
          element: html`
            <label
              class="upload-label ${btnClass("upload")}"
              title="Upload Image"
            >
              ${showIcon
                ? html`<ha-icon icon="mdi:arrow-up-circle-outline"></ha-icon>`
                : ""}${showText
                ? html`<span class="btn-text">Upload</span>`
                : ""}
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
          element: html`
            <button
              class="${btnClass("save")}"
              title="Save as Pixel Art"
              @click="${() => this.card._savePixelArt()}"
            >
              ${showIcon
                ? html`<ha-icon icon="mdi:content-save"></ha-icon>`
                : ""}${showText ? html`<span class="btn-text">Save</span>` : ""}
            </button>
          `,
        };

      case "apply":
        return {
          element: html`
            <button
              class="${btnClass("apply")}"
              title="Apply"
              @click="${() => this.card._sendToLamp()}"
            >
              ${showIcon
                ? html`<ha-icon icon="mdi:send"></ha-icon>`
                : ""}${showText
                ? html`<span class="btn-text">Apply</span>`
                : ""}
            </button>
          `,
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
    const isIconMode = actionsStyle === "icon";

    const renderedActions = actionsOrder
      .map((action, index) => {
        return this.renderAction(action, index, config, paintShape);
      })
      .filter((action) => action !== null);

    return html`
      <div class="actions-row${isIconMode ? " icon-mode" : ""}">
        ${renderedActions}
      </div>
    `;
  }
}
