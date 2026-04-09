/**
 * List Mode Utilities - Reusable list mode rendering
 *
 * Provides consistent list mode layout for gallery items.
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
    onDeleteClick,
    itemClass = "",
  } = options;

  return items
    .map((item, idx) => {
      const deleteButtonHtml = showDelete
        ? `<button class="${deleteBtnClass} list-delete-btn" data-index="${idx}" title="Delete" style="position:absolute;top:8px;right:8px;z-index:10;">×</button>`
        : "";

      return `
        <div class="list-item ${itemClass}" data-index="${idx}" style="position:relative;padding:8px 12px;box-sizing:border-box;margin-bottom:10px;background:var(--secondary-background-color, #fafbfc);border:1.5px solid var(--divider-color, #d0d7de);border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
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
`;
