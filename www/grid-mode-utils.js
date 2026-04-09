/**
 * Grid Mode Utilities - Reusable grid layout rendering
 *
 * Extracted from yeelight-cube-palette-card.js to allow grid mode functionality
 * to be reused across different cards (palette, draw, etc.).
 */

/**
 * Grid Mode Styles - CSS for grid layout
 * To be included in card styles
 */
export const gridModeStyles = `
  /* Grid Mode - Card Grid Layout */
  .items-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 200px);
    gap: 16px;
    margin-bottom: 16px;
  }

  .grid-item {
    background: var(--secondary-background-color, #fafbfc);
    border: 1.5px solid var(--divider-color, #d0d7de);
    border-radius: 12px;
    padding: 16px;
    position: relative;
    box-shadow: 0 2px 6px rgba(0,0,0,0.04);
    transition: transform 0.2s, box-shadow 0.2s;
    cursor: pointer;
  }

  .grid-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  }

  .grid-item .item-title {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    margin-bottom: 12px;
    font-size: 0.95em;
    width: 100%;
    text-align: center;
  }

  .grid-item .item-title .title-text {
    cursor: inherit;
  }

  .grid-item .item-title .title-text.editable {
    cursor: pointer;
  }

  .grid-item .item-title .title-text.editable:hover {
    opacity: 0.7;
  }

  .grid-item .item-content {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-start;
  }

  .grid-item .item-meta {
    font-size: 0.8em;
    color: var(--secondary-text-color, #666);
    margin-top: 8px;
  }

  /* Grid gradient mode - for items with gradient backgrounds */
  .grid-item-gradient {
    position: relative;
    padding: 0;
    overflow: hidden;
  }

  .grid-item-gradient .grid-gradient-bg {
    height: 100px;
  }

  .grid-item-gradient .grid-gradient-content {
    padding: 12px 16px;
    background: var(--card-background-color, white);
  }

  .grid-item-gradient .item-title {
    margin-bottom: 4px;
    padding-right: 50px;
  }

  .grid-item-gradient .item-meta {
    font-size: 0.8em;
    color: var(--secondary-text-color, #666);
    margin-top: 4px;
  }

  /* Delete button positioning in grid */
  .grid-item .delete-btn,
  .grid-item .remove-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 4px 10px;
    font-size: 0.7em;
    z-index: 100;
  }

  .grid-item .delete-btn-cross,
  .grid-item .remove-btn-cross {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(255,255,255,0.95);
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--error-color, #db4437);
    font-size: 1.2em;
    font-weight: bold;
    z-index: 100;
    pointer-events: auto;
  }
`;

/**
 * Renders items in a grid layout
 * Returns HTML string for innerHTML usage
 *
 * @param {Array} items - Array of items to display
 * @param {Function} renderItemContent - Function to render item content (receives: item, index)
 * @param {Object} options - Configuration options
 * @param {boolean} options.showTitle - Whether to show item titles
 * @param {boolean} options.allowTitleEdit - Whether titles are editable
 * @param {boolean} options.showMeta - Whether to show meta information
 * @param {Function} options.getMetaText - Function to get meta text (receives: item, index)
 * @param {boolean} options.showDelete - Whether to show delete button
 * @param {string} options.deleteButtonClass - CSS class for delete button
 * @param {string|Function} options.onDeleteClick - Function name or handler for delete (receives: event, index)
 * @param {string|Function} options.onItemClick - Function name or handler for item click (receives: event, index)
 * @param {string|Function} options.onTitleClick - Function name or handler for title click (receives: event, index)
 * @param {boolean} options.isGradientMode - Whether to use gradient background mode
 * @param {Function} options.getGradientBg - Function to get gradient background (receives: item, index)
 * @returns {string} HTML string
 */
export function renderGridMode(items, renderItemContent, options = {}) {
  const {
    showTitle = true,
    allowTitleEdit = false,
    showMeta = false,
    getMetaText = null,
    showDelete = false,
    deleteButtonClass = "delete-btn-cross",
    onDeleteClick = null,
    onItemClick = null,
    onTitleClick = null,
    isGradientMode = false,
    getGradientBg = null,
  } = options;

  // Helper to get function call string
  const getFunctionCall = (handler, idx) => {
    if (!handler) return "";
    if (typeof handler === "string") {
      return `this.getRootNode().host.${handler}(event, ${idx});`;
    }
    return "";
  };

  return `<div class="items-grid">${items
    .map((item, idx) => {
      const metaText = showMeta && getMetaText ? getMetaText(item, idx) : "";
      const itemTitle = item.name || item.title || `Item ${idx + 1}`;

      // Build delete button HTML
      const deleteButtonHtml = showDelete
        ? `<button class="${deleteButtonClass}" 
                   data-idx="${idx}" 
                   title="Delete" 
                   onclick="event.stopPropagation(); ${getFunctionCall(
                     onDeleteClick,
                     idx,
                   )}"
                   style="position:absolute;top:10px;right:10px;z-index:1000;pointer-events:auto;">×</button>`
        : "";

      // Gradient mode
      if (isGradientMode && getGradientBg) {
        const gradientBg = getGradientBg(item, idx);
        return `
          <div class="grid-item grid-item-gradient" 
               data-idx="${idx}"
               ${
                 onItemClick
                   ? `onclick="${getFunctionCall(onItemClick, idx)}"`
                   : ""
               }>
            <div class="grid-gradient-bg" style="background: ${gradientBg};"></div>
            <div class="grid-gradient-content" style="pointer-events:none;">
              ${
                showTitle
                  ? `<div class="item-title" data-idx="${idx}">
                  <span class="title-text${allowTitleEdit ? " editable" : ""}"
                        ${
                          allowTitleEdit && onTitleClick
                            ? `onclick="event.stopPropagation(); ${getFunctionCall(
                                onTitleClick,
                                idx,
                              )}"`
                            : ""
                        }
                        style="${allowTitleEdit ? "pointer-events:auto;" : ""}">
                    ${itemTitle}
                  </span>
                </div>`
                  : ""
              }
              ${showMeta ? `<div class="item-meta">${metaText}</div>` : ""}
            </div>
            ${deleteButtonHtml}
          </div>
        `;
      }

      // Standard mode
      return `
        <div class="grid-item" 
             data-idx="${idx}"
             ${
               onItemClick
                 ? `onclick="${getFunctionCall(onItemClick, idx)}"`
                 : ""
             }>
          ${
            showTitle
              ? `<div class="item-title" data-idx="${idx}">
              <span class="title-text${allowTitleEdit ? " editable" : ""}"
                    ${
                      allowTitleEdit && onTitleClick
                        ? `onclick="event.stopPropagation(); ${getFunctionCall(
                            onTitleClick,
                            idx,
                          )}"`
                        : ""
                    }
                    style="${allowTitleEdit ? "pointer-events:auto;" : ""}">
                ${itemTitle}
              </span>
            </div>`
              : ""
          }
          <div class="item-content" style="pointer-events:auto;">
            ${renderItemContent(item, idx)}
          </div>
          ${showMeta ? `<div class="item-meta">${metaText}</div>` : ""}
          ${deleteButtonHtml}
        </div>
      `;
    })
    .join("")}</div>`;
}
