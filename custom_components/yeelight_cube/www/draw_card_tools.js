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
  ACTION_LABELS,
} from "./draw_card_const.js";
import { StorageUtils } from "./draw_card_storage.js";

// ---------------------------------------------------------------------------
// What the card shows, from its config: the tools and actions in their order
// (tools_order / actions_order) and the hidden ones (hidden_tools /
// hidden_actions). A config from before those options keeps what this
// browser hid (the former per-browser visibility) until its editor saves.
// ---------------------------------------------------------------------------

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

const isSpacer = (action) =>
  action === null || action === "" || action === "spacer" || action === "empty";

/**
 * The actions in the card's order (actions_order; older names: actions,
 * button_areas.actions): every known action once (a new one at the end),
 * spacers ("spacer", any number) where the config puts them.
 */
export function actionsOrder(config) {
  const stored =
    [config?.actions_order, config?.actions, config?.button_areas?.actions].find(
      (list) => Array.isArray(list) && list.length,
    ) || DEFAULT_ACTION_ORDER;
  const order = [];
  for (const action of stored) {
    if (isSpacer(action)) order.push("spacer");
    else if (DEFAULT_ACTION_ORDER.includes(action) && !order.includes(action)) order.push(action);
  }
  return [...order, ...DEFAULT_ACTION_ORDER.filter((action) => !order.includes(action))];
}

// The former per-browser visibility ({name: false}), read once per page.
const legacyHidden = {};
function hiddenInBrowser(kind) {
  if (!legacyHidden[kind]) {
    const saved =
      kind === "tools" ? StorageUtils.loadToolVisibility() : StorageUtils.loadActionVisibility();
    legacyHidden[kind] = Object.keys(saved || {}).filter((name) => saved[name] === false);
  }
  return legacyHidden[kind];
}

/** The tools the card hides (hidden_tools; before it, this browser's). */
export function hiddenTools(config) {
  return Array.isArray(config?.hidden_tools) ? config.hidden_tools : hiddenInBrowser("tools");
}

/** The actions the card hides (hidden_actions; before it, this browser's). */
export function hiddenActions(config) {
  return Array.isArray(config?.hidden_actions) ? config.hidden_actions : hiddenInBrowser("actions");
}

/** An action's (or tool's) name for the editor. */
export function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}

export class ToolManager {
  constructor(card) {
    this.card = card;
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

    // Special handling for color picker
    if (tool === "colorPicker") {
      return html`
        <div
          class="tool-item"
          data-tool="${tool}"
          data-index="${index}"
          style="position: relative;"
        >
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
        style="position: relative;"
      >
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
    // The tools shown, in the card's order.
    const hidden = hiddenTools(config);
    const tools = this.filterTools(toolsOrder(config), config).filter(
      (tool) => !hidden.includes(tool),
    );
    if (!tools.length) return "";

    return html`
      <div class="toolbar-container">
        <div
          class="toolbar"
          style="min-width: 100%; justify-content: space-between;"
        >
          ${tools.map((tool, index) => this.renderTool(tool, index, config, paintShape))}
        </div>
      </div>
    `;
  }
}

// Action Management Module for Yeelight Cube Lite Draw Card Action Buttons
export class ActionManager {
  constructor(card) {
    this.card = card;
  }

  // One action button (or a spacer: an empty slot for alignment).
  renderAction(action, index) {
    const actionConfig = this.getActionConfig(action);
    if (!actionConfig) return null;
    return html`
      <div
        class="action-item${actionConfig.isSpacer ? " action-spacer-item" : ""}"
        data-action="${action}"
        data-index="${index}"
        style="position: relative;"
      >
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
        // A spacer: an empty slot, for alignment.
        if (isSpacer(action)) {
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

  // The actions shown, in the card's order.
  renderActionsSection(config) {
    const hidden = hiddenActions(config);
    const actionsStyle = config?.actions_buttons_style || "modern";
    const renderedActions = actionsOrder(config)
      .filter((action) => !hidden.includes(action))
      .map((action, index) => this.renderAction(action, index))
      .filter((action) => action !== null);
    if (!renderedActions.length) return "";

    return renderActionRow(renderedActions, {
      buttonStyle: actionsStyle,
      contentMode: config?.actions_content_mode || "icon",
      slotted: true,
    });
  }
}
