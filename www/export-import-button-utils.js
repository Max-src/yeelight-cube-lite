/**
 * Export/Import Button Utilities
 *
 * Provides centralized rendering logic, styles, and helper functions for export/import buttons
 * used across palette and pixel art galleries.
 *
 * Features:
 * - Multiple button styles: modern, classic, outline, gradient, icon, pill
 * - Support for icon-only, text-only, and icon+text content modes
 * - Status indicators for import success/error states
 * - Consistent styling and behavior across all cards
 *
 * Usage:
 *   1. Import utilities:
 *      import { exportImportButtonStyles, renderExportImportButtons, getExportImportButtonClass } from './export-import-button-utils.js';
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
export function getExportImportButtonClass(type, style = "modern") {
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
  return `${baseClass} btn-style-${style}`;
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
      return `<ha-icon icon="${icon}"></ha-icon>`;
    case "text":
      return text;
    case "icon_text":
    default:
      return `<ha-icon icon="${icon}"></ha-icon><span class="btn-text">${text}</span>`;
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

  const rowClass = `action-row${
    contentMode === "icon" || buttonStyle === "icon" ? " icon-mode" : ""
  }`;

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
export const exportImportButtonStyles = `
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
    background: #e6f7ff;
    border: none;
    border-radius: 8px;
    color: #0077cc;
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
    background: #0077cc !important;
    color: white !important;
    box-shadow: 0 0 0 2px #0077cc, 0 2px 8px rgba(0,119,204,0.3);
  }

  /* Tool button style-specific active states */
  .tool-btn.tool-active.btn-style-classic {
    background: #01579b !important;
    color: #fff !important;
    border: 2px solid #fff !important;
    box-shadow: 0 0 0 3px #01579b, 0 2px 10px rgba(1,87,155,0.45);
    transform: scale(1.06);
  }

  .tool-btn.tool-active.btn-style-outline {
    background: var(--primary-color, #03a9f4) !important;
    color: white !important;
    border-color: var(--primary-color-dark, #0288d1) !important;
    box-shadow: 0 0 0 2px var(--primary-color-dark, #0288d1);
  }

  .tool-btn.tool-active.btn-style-gradient {
    background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%) !important;
    border: 2px solid rgba(255,255,255,0.85) !important;
    box-shadow: 0 0 0 3px #0d47a1, 0 3px 12px rgba(13,71,161,0.5);
    transform: scale(1.08);
  }

  .tool-btn.tool-active.btn-style-icon {
    background: #0077cc !important;
    color: white !important;
    box-shadow: 0 0 0 3px rgba(0,119,204,0.4);
  }

  .tool-btn.tool-active.btn-style-pill {
    background: #0077cc !important;
    color: white !important;
    box-shadow: 0 0 0 2px #0077cc;
  }

  /* Button Type-Specific Colors (Modern Style) */
  .add-btn {
    background: #d4edda;
    color: #218838;
  }

  .add-btn:hover {
    background: #b3e6c3;
  }

  .save-btn {
    background: #e6f7ff;
    color: #0077cc;
  }

  .save-btn:hover {
    background: #b3e6ff;
  }

  .randomize-btn {
    background: #fff3e0;
    color: #e65100;
  }

  .randomize-btn:hover {
    background: #ffe0b2;
  }

  .force-refresh-btn {
    background: #fff8e1;
    color: #f9a825;
  }

  .force-refresh-btn:hover {
    background: #ffecb3;
  }

  .power-btn {
    background: #e6f7ff;
    color: var(--primary-color, #03a9f4);
  }

  .power-btn:hover {
    background: #b3e6ff;
  }

  .power-btn.off {
    background: #f5f5f5;
    color: #757575;
  }

  .power-btn.off:hover {
    background: #e0e0e0;
  }

  .clear-btn {
    background: #ffeaea;
    color: #c62828;
  }

  .clear-btn:hover {
    background: #ffd6d6;
  }

  .upload-btn {
    background: #e8f5e9;
    color: #2e7d32;
  }

  .upload-btn:hover {
    background: #c8e6c9;
  }

  .apply-btn {
    background: #e6f7ff;
    color: #0077cc;
    font-weight: 600;
  }

  .apply-btn:hover {
    background: #b3e6ff;
  }

  .export-btn:hover,
  .import-btn:hover {
    background: #b3e6ff;
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
    color: white;
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
    color: white;
  }

  /* Gradient Style */
  .btn-style-gradient {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
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
    color: #fff;
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
    color: white;
  }

  .clear-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #c62828 0%, #b71c1c 100%);
  }

  /* Upload button gradient */
  .upload-btn.btn-style-gradient {
    background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
    box-shadow: 0 2px 8px rgba(67, 160, 71, 0.3);
    color: white;
  }

  .upload-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #43a047 0%, #2e7d32 100%);
  }

  /* Apply button gradient */
  .apply-btn.btn-style-gradient {
    background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
    box-shadow: 0 2px 8px rgba(30, 136, 229, 0.3);
    color: white;
  }

  .apply-btn.btn-style-gradient:hover {
    background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
  }

  /* Tool button gradient */
  .tool-btn.btn-style-gradient {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    box-shadow: 0 2px 8px rgba(118, 75, 162, 0.3);
    color: white;
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
    color: white;
  }

  .export-btn.btn-style-icon:hover {
    background: #0288d1;
  }

  .import-btn.btn-style-icon {
    background: #66bb6a;
    color: white;
  }

  .import-btn.btn-style-icon:hover {
    background: #43a047;
  }

  .add-btn.btn-style-icon {
    background: #66bb6a;
    color: white;
  }

  .add-btn.btn-style-icon:hover {
    background: #43a047;
  }

  .save-btn.btn-style-icon {
    background: #03a9f4;
    color: white;
  }

  .save-btn.btn-style-icon:hover {
    background: #0288d1;
  }

  .randomize-btn.btn-style-icon {
    background: #ff9800;
    color: white;
  }

  .randomize-btn.btn-style-icon:hover {
    background: #f57c00;
  }

  .force-refresh-btn.btn-style-icon {
    background: #f9a825;
    color: white;
  }

  .force-refresh-btn.btn-style-icon:hover {
    background: #f57f17;
  }

  .power-btn.btn-style-icon {
    background: var(--primary-color, #03a9f4);
    color: white;
  }

  .power-btn.btn-style-icon:hover {
    background: var(--primary-color-dark, #0288d1);
  }

  .power-btn.btn-style-icon.off {
    background: #757575;
    color: white;
  }

  .power-btn.btn-style-icon.off:hover {
    background: #616161;
  }

  .clear-btn.btn-style-icon {
    background: #ef5350;
    color: white;
  }

  .clear-btn.btn-style-icon:hover {
    background: #c62828;
  }

  .upload-btn.btn-style-icon {
    background: #66bb6a;
    color: white;
  }

  .upload-btn.btn-style-icon:hover {
    background: #43a047;
  }

  .apply-btn.btn-style-icon {
    background: #03a9f4;
    color: white;
  }

  .apply-btn.btn-style-icon:hover {
    background: #0288d1;
  }

  .tool-btn.btn-style-icon {
    background: #e6f7ff;
    color: #0077cc;
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }

  .tool-btn.btn-style-icon:hover {
    background: #b3e6ff;
  }

  .tool-btn.tool-active.btn-style-icon {
    background: #0077cc;
    color: white;
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
`;
