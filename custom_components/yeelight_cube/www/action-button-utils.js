/**
 * Shared Action Button Utilities
 *
 * Rendering, style variants, and content modes for actions across all cards.
 *
 * Features:
 * - Multiple button styles: modern, classic, outline, gradient, icon, pill
 * - Support for icon-only, text-only, and icon+text content modes
 * - Status indicators for import success/error states
 * - Consistent styling and behavior across all cards
 *
 * Usage:
 *   1. Import utilities:
 *      import { exportImportButtonStyles, renderExportImportButtons, getExportImportButtonClass } from './action-button-utils.js';
 *
 *   2. Include styles in your card's CSS:
 *      ${exportImportButtonStyles}
 *
 *   3. Render buttons:
 *      const buttonsHTML = renderExportImportButtons({
 *        showExport: true,
 *        showImport: true,
 *        buttonStyle: 'modern',
 *        contentMode: 'icon_text',
 *        importStatus: { showing: true, type: 'success' },
 *        onExportClick: () => { ... },
 *        onImportChange: (file) => { ... }
 *      });
 */

/**
 * Get CSS classes for action buttons based on style
 * @param {string} type - Button type: 'export', 'import', 'add', 'save', 'randomize', 'power', 'force-refresh'
 * @param {string} style - Button style: 'modern', 'classic', 'outline', 'gradient', 'icon', 'pill'
 * @returns {string} CSS class string
 */
export function getActionButtonClass(type, style = "modern") {
  const TYPE_TO_CLASS = {
    export: "export-btn",
    import: "import-btn",
    add: "add-btn",
    save: "save-btn",
    randomize: "randomize-btn",
    power: "power-btn",
    "force-refresh": "force-refresh-btn",
    clear: "clear-btn",
    upload: "upload-btn",
    apply: "apply-btn",
    tool: "tool-btn",
    "tool-active": "tool-btn tool-active",
  };
  const baseClass = TYPE_TO_CLASS[type] || "import-btn";
  return `${baseClass} btn-style-${resolveActionButtonOptions({ buttonStyle: style }).buttonStyle}`;
}

export const getExportImportButtonClass = getActionButtonClass;

export const actionButtonStyleChoices = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" },
  { value: "outline", label: "Outline" },
  { value: "gradient", label: "Gradient" },
  { value: "icon", label: "Icon" },
  { value: "pill", label: "Pill" },
];

export const actionButtonContentChoices = [
  { value: "icon", label: "Icon" },
  { value: "text", label: "Text" },
  { value: "icon_text", label: "Icon + Text" },
];

export function resolveActionButtonOptions({
  buttonStyle = "modern",
  contentMode = "icon_text",
} = {}) {
  if (!actionButtonStyleChoices.some((choice) => choice.value === buttonStyle))
    buttonStyle = "modern";
  if (
    !actionButtonContentChoices.some((choice) => choice.value === contentMode)
  )
    contentMode = "icon_text";
  return {
    buttonStyle,
    contentMode: buttonStyle === "icon" ? "icon" : contentMode,
  };
}

import { escapeHtml } from "./html-escape-utils.js";

export function getActionRowClass(options = {}) {
  return `action-row${resolveActionButtonOptions(options).contentMode === "icon" ? " icon-mode" : ""}${options.slotted ? " action-row-slotted" : ""}`;
}

export function actionButtonModel({
  action = "save",
  buttonStyle,
  contentMode,
  icon = "mdi:content-save-outline",
  label = "Save",
  busy = false,
  busyLabel = "Loading...",
  disabled = false,
  compact = false,
  type = "button",
  title,
  selected,
  role,
  value,
  tabIndex,
  states,
} = {}) {
  const options = resolveActionButtonOptions({ buttonStyle, contentMode });
  const stateful = typeof selected === "boolean";
  // A stateful button with on/off states is a single toggle that always shows
  // the current value (12h/24h). Radio groups (no states) show selection.
  const currentValue = stateful && role !== "radio" && Boolean(states);
  const state = currentValue ? states[selected ? "on" : "off"] : undefined;
  // Stateful buttons reuse the shared tool/tool-active appearance so every
  // button style keeps its identity across cards (gradient stays gradient,
  // outline stays outline...). Selected/current = the prominent active look.
  const activeLook = stateful && (Boolean(currentValue) || selected === true);
  const resolvedAction = stateful
    ? activeLook
      ? "tool-active"
      : "tool"
    : action;
  return {
    ...options,
    className: `${getActionButtonClass(resolvedAction, options.buttonStyle)} shared-action-button${stateful ? " action-state" : ""}${compact ? " action-compact" : ""}${busy ? " action-busy" : ""}`,
    icon: busy ? "mdi:loading" : state?.icon || icon,
    label: busy ? busyLabel : state?.label || label,
    title: busy ? busyLabel : state?.title || title || state?.label || label,
    disabled: disabled || busy,
    busy,
    selected: stateful && !currentValue ? selected : undefined,
    role: role === "radio" ? "radio" : undefined,
    value,
    tabIndex,
    type: ["button", "submit", "reset"].includes(type) ? type : "button",
  };
}

export function renderActionButtonHTML(options = {}) {
  const model = actionButtonModel(options);
  const state =
    model.selected === undefined
      ? ""
      : ` ${model.role === "radio" ? "aria-checked" : "aria-pressed"}="${model.selected}"`;
  return `<button type="${model.type}" class="${model.className}" title="${escapeHtml(model.title)}" aria-label="${escapeHtml(model.title)}" aria-busy="${model.busy}"${state}${model.role ? ' role="radio"' : ""}${model.value !== undefined ? ` data-value="${escapeHtml(String(model.value))}"` : ""}${model.tabIndex !== undefined ? ` tabindex="${model.tabIndex === -1 ? -1 : 0}"` : ""} ${model.disabled ? "disabled" : ""}>${renderButtonContent(model.icon, model.label, model.contentMode)}</button>`;
}

export function actionButtonGroupModel({
  items,
  value,
  multiple = false,
  ...options
}) {
  const selected = (item) =>
    multiple ? !!item.selected : item.value === value;
  const focusItem =
    items.find((item) => selected(item) && !item.disabled) ||
    items.find((item) => !item.disabled);
  return items.map((item) => ({
    ...options,
    action: "tool",
    ...item,
    selected: selected(item),
    role: multiple ? undefined : "radio",
    tabIndex: multiple || item === focusItem ? 0 : -1,
  }));
}

export function renderActionButtonGroupHTML(options) {
  return `<div class="shared-button-group ${getActionRowClass(options)}" role="${options.multiple ? "group" : "radiogroup"}" aria-label="${escapeHtml(options.label)}">${actionButtonGroupModel(options).map(renderActionButtonHTML).join("")}</div>`;
}

export function bindActionButtonGroup(group, onChange) {
  if (!group) return;
  group.onclick = (event) => handleActionButtonGroupEvent(event, onChange);
  group.onkeydown = (event) => handleActionButtonGroupEvent(event, onChange);
}

export function handleActionButtonGroupEvent(event, onChange) {
  const group = event.currentTarget;
  const activate = (button) => {
    if (!button || button.disabled) return;
    if (
      group.getAttribute("role") === "radiogroup" &&
      button.getAttribute("aria-checked") === "true"
    )
      return;
    onChange(button.dataset.value);
  };
  if (event.type === "click") {
    activate(event.target.closest("button[data-value]"));
  } else if (event.type === "keydown") {
    if (group.getAttribute("role") !== "radiogroup") return;
    const keys = [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ];
    if (!keys.includes(event.key)) return;
    const buttons = [
      ...group.querySelectorAll("button[data-value]:not(:disabled)"),
    ];
    const index = buttons.indexOf(event.target.closest("button"));
    if (index < 0) return;
    event.preventDefault();
    const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (backwards ? -1 : 1) + buttons.length) % buttons.length;
    buttons.forEach((button, position) => {
      button.tabIndex = position === next ? 0 : -1;
    });
    buttons[next].focus();
    activate(buttons[next]);
  }
}

/**
 * Render button content based on content mode
 * @param {string} icon - Material Design Icon name (e.g., 'mdi:download')
 * @param {string} text - Button text
 * @param {string} contentMode - 'icon', 'text', or 'icon_text'
 * @param {boolean} isStatus - Whether this is a status message
 * @param {string} statusType - 'success' or 'error'
 * @returns {string} HTML string for button content
 */
export function renderButtonContent(
  icon,
  text,
  contentMode = "icon_text",
  isStatus = false,
  statusType = null,
) {
  if (isStatus) {
    const statusIcon =
      statusType === "success" ? "mdi:check" : "mdi:alert-circle";
    const statusText = statusType === "success" ? "Success!" : "Error!";

    switch (contentMode) {
      case "icon":
        return `<ha-icon icon="${statusIcon}"></ha-icon>`;
      case "text":
        return statusText;
      case "icon_text":
      default:
        return `<ha-icon icon="${statusIcon}"></ha-icon><span class="btn-text">${statusText}</span>`;
    }
  }

  switch (contentMode) {
    case "icon":
      return `<ha-icon icon="${escapeHtml(icon)}"></ha-icon>`;
    case "text":
      return escapeHtml(text);
    case "icon_text":
    default:
      return `<ha-icon icon="${escapeHtml(icon)}"></ha-icon><span class="btn-text">${escapeHtml(text)}</span>`;
  }
}

/**
 * Render export/import buttons (HTML string version for shadow DOM)
 * @param {Object} options - Configuration options
 * @returns {string} HTML string
 */
export function renderExportImportButtonsHTML(options) {
  const {
    showExport = true,
    showImport = true,
    buttonStyle = "modern",
    contentMode = "icon_text",
    importStatus = { showing: false, type: null },
    exportButtonId = "export-btn",
    importButtonId = "import-btn",
  } = options;

  const exportBtnClass = getExportImportButtonClass("export", buttonStyle);
  const importBtnClass = getExportImportButtonClass("import", buttonStyle);
  const isImportStatus = importStatus?.showing === true;
  const statusType = importStatus?.type;

  const rowClass = getActionRowClass({ buttonStyle, contentMode });

  return `
    <div class="${rowClass}">
      ${
        showExport
          ? `
        <button id="${exportButtonId}" class="${exportBtnClass}" title="Export to JSON file">
          ${renderButtonContent("mdi:download", "Export", contentMode)}
        </button>
      `
          : ""
      }
      ${
        showImport
          ? `
        <button id="${importButtonId}" class="${importBtnClass}" title="Import from JSON file">
          ${
            isImportStatus
              ? renderButtonContent(
                  "mdi:upload",
                  "Import",
                  contentMode,
                  true,
                  statusType,
                )
              : renderButtonContent("mdi:upload", "Import", contentMode)
          }
        </button>
      `
          : ""
      }
    </div>
  `;
}

/**
 * CSS styles for export/import buttons
 * Includes all button style variants and responsive behavior
 */
export const actionButtonStyles = `
  /* Action Row Container */
  .action-row {
    display: flex;
    gap: 16px;
    margin-top: 16px;
    justify-content: stretch;
    width: 100%;
    flex-wrap: wrap;
  }
  
  .action-row.icon-mode {
    justify-content: center;
  }

  .action-row-slotted {
    margin-top: 0;
    align-items: stretch;
  }
  .action-row-slotted .action-item {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
  }
  .action-row-slotted.icon-mode .action-item {
    flex: 0 0 auto;
  }
  .action-row-slotted .action-item button,
  .action-row-slotted .action-item .upload-label {
    width: 100%;
    flex: 1;
    min-height: 44px;
    box-sizing: border-box;
    flex-direction: column;
    gap: 2px;
    padding: 6px 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.85em;
  }
  .action-row-slotted .action-item .btn-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    line-height: 1.2;
  }
  .action-row-slotted .action-item .btn-style-icon {
    width: 48px;
    height: 48px;
    min-height: 48px;
    flex: 0 0 48px;
    padding: 0;
    border-radius: 50%;
  }

  /* Base Button Styles */
  .export-btn,
  .import-btn,
  .add-btn,
  .save-btn,
  .randomize-btn,
  .power-btn,
  .force-refresh-btn,
  .clear-btn,
  .upload-btn,
  .apply-btn,
  .tool-btn {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    border: none;
    border-radius: 8px;
    color: var(--primary-color, #0077cc);
    padding: 10px 16px;
    cursor: pointer;
    font-size: 1em;
    font-weight: 500;
    flex: 1 1 0;
    transition: background 0.2s, transform 0.1s;
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
  }

  /* Tool buttons: don't stretch full width, size to content */
  .tool-btn {
    flex: 0 0 auto;
    width: auto;
    min-width: 44px;
    padding: 8px 12px;
  }

  /* Active tool state */
  .tool-btn.tool-active {
    background: var(--primary-color, #0077cc) !important;
    color: var(--text-primary-color, #fff) !important;
    box-shadow: 0 0 0 2px var(--primary-color, #0077cc), 0 2px 8px rgba(0,119,204,0.3);
  }

  /* Tool button style-specific active states */
  .tool-btn.tool-active.btn-style-classic {
    background: var(--primary-color-dark, #01579b) !important;
    color: var(--text-primary-color, #fff) !important;
    border: 2px solid var(--card-background-color, #fff) !important;
    box-shadow: 0 0 0 3px var(--primary-color-dark, #01579b), 0 2px 10px rgba(1,87,155,0.45);
    transform: scale(1.06);
  }

  .tool-btn.tool-active.btn-style-outline {
    background: var(--primary-color, #03a9f4) !important;
    color: var(--text-primary-color, #fff) !important;
    border-color: var(--primary-color-dark, #0288d1) !important;
    box-shadow: 0 0 0 2px var(--primary-color-dark, #0288d1);
  }

  .tool-btn.tool-active.btn-style-gradient {
    background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%) !important;
    border: 2px solid rgba(255,255,255,0.85) !important;
    box-shadow: 0 0 0 3px var(--primary-color-dark, #0d47a1), 0 3px 12px rgba(13,71,161,0.5);
    transform: scale(1.08);
  }

  .tool-btn.tool-active.btn-style-icon {
    background: var(--primary-color, #0077cc) !important;
    color: var(--text-primary-color, #fff) !important;
    box-shadow: 0 0 0 3px rgba(0,119,204,0.4);
  }

  .tool-btn.tool-active.btn-style-pill {
    background: var(--primary-color, #0077cc) !important;
    color: var(--text-primary-color, #fff) !important;
    box-shadow: 0 0 0 2px var(--primary-color, #0077cc);
  }

  /* Button Type-Specific Colors (Modern Style) */
  .add-btn {
    background: color-mix(in srgb, #4caf50 15%, var(--card-background-color, #fff));
    color: color-mix(in srgb, #4caf50 80%, var(--primary-text-color, #333));
  }

  .add-btn:hover {
    background: color-mix(in srgb, #4caf50 25%, var(--card-background-color, #fff));
  }

  .save-btn {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
  }

  .save-btn:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }

  .randomize-btn {
    background: color-mix(in srgb, #ff9800 15%, var(--card-background-color, #fff));
    color: color-mix(in srgb, #ff9800 80%, var(--primary-text-color, #333));
  }

  .randomize-btn:hover {
    background: color-mix(in srgb, #ff9800 20%, var(--card-background-color, #fff));
  }

  .force-refresh-btn {
    background: color-mix(in srgb, #ff9800 12%, var(--card-background-color, #fff));
    color: color-mix(in srgb, #ff9800 80%, var(--primary-text-color, #333));
  }

  .force-refresh-btn:hover {
    background: color-mix(in srgb, #ff9800 18%, var(--card-background-color, #fff));
  }

  .power-btn {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #03a9f4);
  }

  .power-btn:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }

  .power-btn.off {
    background: var(--secondary-background-color, #f5f5f5);
    color: var(--secondary-text-color, #757575);
  }

  .power-btn.off:hover {
    background: var(--divider-color, #e0e0e0);
  }

  .clear-btn {
    background: color-mix(in srgb, var(--error-color, #db4437) 15%, var(--card-background-color, #fff));
    color: var(--error-color, #c62828);
  }

  .clear-btn:hover {
    background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff));
  }

  .upload-btn {
    background: color-mix(in srgb, #4caf50 15%, var(--card-background-color, #fff));
    color: color-mix(in srgb, #4caf50 80%, var(--primary-text-color, #333));
  }

  .upload-btn:hover {
    background: color-mix(in srgb, #4caf50 25%, var(--card-background-color, #fff));
  }

  .apply-btn {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
    font-weight: 600;
  }

  .apply-btn:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }

  .export-btn:hover,
  .import-btn:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }

  .export-btn:active,
  .import-btn:active,
  .add-btn:active,
  .save-btn:active,
  .randomize-btn:active,
  .power-btn:active,
  .force-refresh-btn:active,
  .clear-btn:active,
  .upload-btn:active,
  .apply-btn:active,
  .tool-btn:active {
    transform: scale(0.98);
  }

  /* Modern Style (Default) */
  .btn-style-modern {
    /* Uses default blue style defined above */
  }

  /* Classic Style */
  .btn-style-classic {
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
    border: 2px solid transparent;
  }

  .btn-style-classic:hover {
    background: var(--primary-color-dark, #0288d1);
  }

  /* Outline Style */
  .btn-style-outline {
    background: transparent;
    border: 2px solid var(--primary-color, #03a9f4);
    color: var(--primary-color, #03a9f4);
  }

  .btn-style-outline:hover {
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
  }

  /* Gradient Style */
  .btn-style-gradient {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: var(--text-primary-color, #fff);
    border: 2px solid transparent;
    box-shadow: 0 2px 8px rgba(118, 75, 162, 0.3);
  }

  .btn-style-gradient:hover {
    background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
  }

  /* Export-specific gradient */
  .export-btn.btn-style-gradient {
    background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
    box-shadow: 0 2px 8px rgba(30, 136, 229, 0.3);
  }

  .export-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
  }

  /* Import-specific gradient */
  .import-btn.btn-style-gradient {
    background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
    box-shadow: 0 2px 8px rgba(67, 160, 71, 0.3);
  }

  .import-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #43a047 0%, #2e7d32 100%);
  }

  /* Add button gradient */
  .add-btn.btn-style-gradient {
    background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
    box-shadow: 0 2px 8px rgba(67, 160, 71, 0.3);
  }

  .add-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #43a047 0%, #2e7d32 100%);
  }

  /* Save button gradient */
  .save-btn.btn-style-gradient {
    background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
    box-shadow: 0 2px 8px rgba(30, 136, 229, 0.3);
  }

  .save-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
  }

  /* Randomize button gradient */
  .randomize-btn.btn-style-gradient {
    background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
    box-shadow: 0 2px 8px rgba(245, 124, 0, 0.3);
  }

  .randomize-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #f57c00 0%, #e65100 100%);
  }

  /* Force refresh button gradient */
  .force-refresh-btn.btn-style-gradient {
    background: linear-gradient(135deg, #fdd835 0%, #f9a825 100%);
    box-shadow: 0 2px 8px rgba(249, 168, 37, 0.3);
    color: var(--text-primary-color, #fff);
  }

  .force-refresh-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #f9a825 0%, #f57f17 100%);
  }

  /* Power button gradient */
  .power-btn.btn-style-gradient {
    background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
    box-shadow: 0 2px 8px rgba(30, 136, 229, 0.3);
  }

  .power-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
  }

  .power-btn.btn-style-gradient.off {
    background: linear-gradient(135deg, #9e9e9e 0%, #757575 100%);
    box-shadow: 0 2px 8px rgba(117, 117, 117, 0.3);
  }

  .power-btn.btn-style-gradient.off:hover {
    background: linear-gradient(135deg, #757575 0%, #616161 100%);
  }

  /* Clear button gradient */
  .clear-btn.btn-style-gradient {
    background: linear-gradient(135deg, #ef5350 0%, #c62828 100%);
    box-shadow: 0 2px 8px rgba(198, 40, 40, 0.3);
    color: var(--text-primary-color, #fff);
  }

  .clear-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #c62828 0%, #b71c1c 100%);
  }

  /* Upload button gradient */
  .upload-btn.btn-style-gradient {
    background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
    box-shadow: 0 2px 8px rgba(67, 160, 71, 0.3);
    color: var(--text-primary-color, #fff);
  }

  .upload-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #43a047 0%, #2e7d32 100%);
  }

  /* Apply button gradient */
  .apply-btn.btn-style-gradient {
    background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
    box-shadow: 0 2px 8px rgba(30, 136, 229, 0.3);
    color: var(--text-primary-color, #fff);
  }

  .apply-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
  }

  /* Tool button gradient */
  .tool-btn.btn-style-gradient {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    box-shadow: 0 2px 8px rgba(118, 75, 162, 0.3);
    color: var(--text-primary-color, #fff);
  }

  .tool-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
  }

  /* Icon Style */
  .btn-style-icon {
    width: 48px;
    height: 48px;
    padding: 0;
    border-radius: 50%;
    font-size: 1.5em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 48px;
  }

  .btn-style-icon .btn-text {
    display: none;
  }

  .export-btn.btn-style-icon {
    background: #03a9f4;
    color: var(--text-primary-color, #fff);
  }

  .export-btn.btn-style-icon:hover {
    background: #0288d1;
  }

  .import-btn.btn-style-icon {
    background: #66bb6a;
    color: var(--text-primary-color, #fff);
  }

  .import-btn.btn-style-icon:hover {
    background: #43a047;
  }

  .add-btn.btn-style-icon {
    background: #66bb6a;
    color: var(--text-primary-color, #fff);
  }

  .add-btn.btn-style-icon:hover {
    background: #43a047;
  }

  .save-btn.btn-style-icon {
    background: #03a9f4;
    color: var(--text-primary-color, #fff);
  }

  .save-btn.btn-style-icon:hover {
    background: #0288d1;
  }

  .randomize-btn.btn-style-icon {
    background: #ff9800;
    color: var(--text-primary-color, #fff);
  }

  .randomize-btn.btn-style-icon:hover {
    background: #f57c00;
  }

  .force-refresh-btn.btn-style-icon {
    background: #f9a825;
    color: var(--text-primary-color, #fff);
  }

  .force-refresh-btn.btn-style-icon:hover {
    background: #f57f17;
  }

  .power-btn.btn-style-icon {
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
  }

  .power-btn.btn-style-icon:hover {
    background: var(--primary-color-dark, #0288d1);
  }

  .power-btn.btn-style-icon.off {
    background: var(--disabled-text-color, #757575);
    color: var(--text-primary-color, #fff);
  }

  .power-btn.btn-style-icon.off:hover {
    background: var(--disabled-text-color, #616161);
  }

  .clear-btn.btn-style-icon {
    background: #ef5350;
    color: var(--text-primary-color, #fff);
  }

  .clear-btn.btn-style-icon:hover {
    background: #c62828;
  }

  .upload-btn.btn-style-icon {
    background: #66bb6a;
    color: var(--text-primary-color, #fff);
  }

  .upload-btn.btn-style-icon:hover {
    background: #43a047;
  }

  .apply-btn.btn-style-icon {
    background: #03a9f4;
    color: var(--text-primary-color, #fff);
  }

  .apply-btn.btn-style-icon:hover {
    background: #0288d1;
  }

  .tool-btn.btn-style-icon {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }

  .tool-btn.btn-style-icon:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }

  .tool-btn.tool-active.btn-style-icon {
    background: var(--primary-color, #0077cc);
    color: var(--text-primary-color, #fff);
  }

  /* Pill Style */
  .btn-style-pill {
    border-radius: 25px;
    padding: 10px 24px;
  }

  /* Icon and Text Utilities */
  .export-btn ha-icon,
  .import-btn ha-icon,
  .add-btn ha-icon,
  .save-btn ha-icon,
  .randomize-btn ha-icon,
  .power-btn ha-icon,
  .force-refresh-btn ha-icon,
  .clear-btn ha-icon,
  .upload-btn ha-icon,
  .apply-btn ha-icon,
  .tool-btn ha-icon {
    display: inline-block;
  }

  .btn-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* File Input (hidden) */
  .export-btn input[type="file"],
  .import-btn input[type="file"] {
    display: none;
  }

  .shared-action-button {
    box-sizing: border-box;
    font-family: inherit;
    max-width: 100%;
    min-width: 0;
    letter-spacing: 0;
  }
  .shared-action-button.action-compact:not(.btn-style-icon) {
    flex: 0 0 auto;
    width: auto;
  }
  .shared-button-group.action-row {
    margin-top: 0;
    gap: 8px;
    align-items: stretch;
    justify-content: flex-start;
  }
  .shared-button-group .shared-action-button:not(.btn-style-icon) {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
    min-height: 44px;
    padding: 8px 10px;
  }
  .shared-button-group.icon-mode .shared-action-button:not(.btn-style-icon) {
    flex: 0 0 auto;
  }
  .shared-button-group .shared-action-button.btn-style-icon {
    flex: 0 0 48px;
    width: 48px;
    height: 48px;
  }
  .shared-button-group .btn-text {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  /* Stateful group buttons reuse the shared tool/tool-active look (see the
     .tool-btn rules above) so every style keeps its identity. Neutralise the
     tool-active scale AND outer ring so selected/unselected stay the same box
     size - only the fill changes. */
  .shared-button-group .tool-btn.tool-active {
    transform: none;
    box-shadow: none;
  }
  .action-row.icon-mode {
    justify-content: var(--action-row-icon-align, center);
  }
  .shared-button-group.action-row.icon-mode {
    justify-content: flex-start;
  }
  .shared-action-button:disabled {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }
  .shared-action-button:focus-visible {
    outline: 2px solid var(--primary-color, #1976d2);
    outline-offset: 3px;
  }
  .shared-action-button ha-icon {
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    --mdc-icon-size: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
  }
  .shared-action-button.action-busy ha-icon {
    animation: action-button-spin 1s linear infinite;
  }
  @keyframes action-button-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .shared-action-button.action-busy ha-icon { animation: none; }
    .shared-action-button.action-state { transition: none; }
  }
`;

export const exportImportButtonStyles = actionButtonStyles;
