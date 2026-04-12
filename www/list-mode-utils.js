/**
 * List Mode Utilities - Reusable list mode rendering
 *
 * Provides consistent list mode layout for gallery items.
 * Delete button style/shape/position is configured via getDeleteButtonConfig()
 * from delete-button-styles.js.  The caller passes deleteBtnClass, posClass,
 * and sideClass through the options bag.
 */

/**
 * Renders items in list mode
 * @param {Array} items - Array of items to display
 * @param {Object} options - Configuration options
 * @param {Function} options.renderItemContent - Function to render the item content (receives: item, index)
 * @param {boolean} options.showTitle - Whether to show item titles
 * @param {boolean} options.allowTitleEdit - Whether titles are editable
 * @param {boolean} options.showDelete - Whether to show delete buttons
 * @param {string} options.deleteBtnClass - CSS class for delete button
 * @param {string} [options.posClass] - "btn-pos-inside" | "btn-pos-outside" (default "")
 * @param {string} [options.sideClass] - "btn-side-left" or "" (default "")
 * @param {Function} options.onDeleteClick - Callback for delete button click (receives: index)
 * @param {string} options.itemClass - Additional CSS class for list items
 * @returns {string} HTML string
 */
export function renderListMode(items, options) {
  const {
    renderItemContent,
    showTitle = true,
    allowTitleEdit = false,
    showDelete = true,
    deleteBtnClass = "delete-btn-cross",
    posClass = "",
    sideClass = "",
    onDeleteClick,
    itemClass = "",
    roundedCards = true,
  } = options;

  // Normalize shape
  const shape =
    roundedCards === true || roundedCards === undefined
      ? "round"
      : roundedCards === false
        ? "square"
        : roundedCards;
  const shapeClass =
    shape === "square"
      ? " list-item-square"
      : shape === "rounded"
        ? " list-item-rounded"
        : "";
  const borderRadius =
    shape === "square" ? "0" : shape === "rounded" ? "4px" : "14px";

  return items
    .map((item, idx) => {
      const deleteButtonHtml = showDelete
        ? `<button class="${deleteBtnClass} list-delete-btn ${posClass} ${sideClass}" data-index="${idx}" title="Delete"></button>`
        : "";

      return `
        <div class="list-item ${itemClass}${shapeClass}" data-index="${idx}" style="position:relative;padding:8px 12px;box-sizing:border-box;margin-bottom:10px;background:var(--secondary-background-color, #fafbfc);border:1.5px solid var(--divider-color, #d0d7de);border-radius:${borderRadius};box-shadow:0 2px 8px rgba(0,0,0,0.04);">
          <div style="display:flex;flex-direction:column;width:100%;${
            showDelete ? "padding-right:40px;" : ""
          }">
            ${
              showTitle
                ? `<div class="list-item-title" data-index="${idx}" style="font-weight:500;color:var(--primary-text-color, #333);margin-bottom:4px;cursor:${
                    allowTitleEdit ? "pointer" : "default"
                  };">
                    <span class="title-text${
                      allowTitleEdit ? " editable" : ""
                    }">${item.name || `Item ${idx + 1}`}</span>
                  </div>`
                : ""
            }
            <div class="list-item-content">
              ${renderItemContent(item, idx)}
            </div>
          </div>
          ${deleteButtonHtml}
        </div>
      `;
    })
    .join("");
}

/**
 * List Mode Styles - CSS for list mode layout
 * To be included in card styles
 */
export const listModeStyles = `
  /* List Mode Container */
  .list-mode-container {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  /* List Item */
  .list-item {
    position: relative;
    padding: 8px 12px;
    background: var(--secondary-background-color, #fafbfc);
    border: 1.5px solid var(--divider-color, #d0d7de);
    border-radius: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .list-item.list-item-square {
    border-radius: 0;
  }

  .list-item.list-item-rounded {
    border-radius: 4px;
  }

  .list-item:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    border-color: var(--divider-color, #bcc5d0);
  }

  /* List Item Title */
  .list-item-title {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    margin-bottom: 4px;
  }

  .list-item-title .title-text.editable {
    cursor: pointer;
    transition: opacity 0.2s ease;
  }

  .list-item-title .title-text.editable:hover {
    opacity: 0.8;
  }

  /* List Item Content */
  .list-item-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* List Delete Button */
  .list-delete-btn {
    position: absolute !important;
    top: 8px !important;
    right: 8px !important;
    /* z-index: 10 !important; */
  }
  /* Inside: use default abs position (top-right inside) */
  .list-delete-btn.btn-pos-inside {
    top: 6px !important;
    right: 6px !important;
  }
  /* Outside: protrude from corner */
  .list-delete-btn.btn-pos-outside {
    top: -8px !important;
    right: -8px !important;
  }
  .list-delete-btn.dot-style.btn-pos-outside {
    top: -4px !important;
    right: -4px !important;
  }
  /* Allow outside buttons to overflow list item bounds */
  .list-item:has(.btn-pos-outside) {
    overflow: visible;
  }
  /* Left side */
  .list-delete-btn.btn-side-left {
    right: auto !important;
    left: 8px !important;
  }
  .list-delete-btn.btn-pos-inside.btn-side-left {
    left: 6px !important;
  }
  .list-delete-btn.btn-pos-outside.btn-side-left {
    left: -8px !important;
  }
  .list-delete-btn.dot-style.btn-pos-outside.btn-side-left {
    left: -4px !important;
  }
`;
