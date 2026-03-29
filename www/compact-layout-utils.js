/**
 * Compact Layout Utilities
 *
 * Provides reusable compact mode layout system for displaying items in an inline,
 * minimal design with preview, info, and optional delete button.
 *
 * Features:
 * - Inline-flex layout with automatic wrapping
 * - Consistent spacing and sizing with CSS variable support
 * - Drag-and-drop support
 * - Hover effects
 * - Delete button integration with hover-only mode
 *
 * Usage:
 *   import { compactLayoutStyles, renderCompactItem } from './compact-layout-utils.js';
 *
 *   In styles:
 *     ${compactLayoutStyles}
 *
 *   In template:
 *     ${renderCompactItem({
 *       index: 0,
 *       preview: html`<div>...</div>`,
 *       info: html`<span>...</span>`,
 *       allowDelete: true,
 *       deleteBtnClass: 'delete-btn-cross',
 *       onClick: (e) => {},
 *       allowDragDrop: true
 *     })}
 */

export const compactLayoutStyles = `
  /* COMPACT LAYOUT - Minimal inline design */
  .compact-item {
    display: inline-flex;
    align-items: center;
    
    padding: calc(4.29px * var(--card-size-multiplier, 0.7)) calc(8.57px * var(--card-size-multiplier, 0.7));
    border-radius: calc(8.57px * var(--card-size-multiplier, 0.7));
    background: #f8f9fa;
    transition: all 0.2s;
    cursor: grab;
    width: fit-content;
    min-width: 0;
    position: relative;
    justify-content: flex-start;
  }
  
  .compact-item:hover {
    background: #e9ecef;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  
  .compact-item.dragging {
    opacity: 0.5;
  }
  
  /* Compact Preview - Fixed size preview area */
  .compact-preview {
    flex-shrink: 0;
  }
  
  /* Compact Info - Text content area */
  .compact-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 80px !important;
    max-width: none !important;
    flex: 0 0 auto;
    justify-content: center;
    align-items: center;
  }
  
  /* Delete Button Positioning in Compact Mode */
  .compact-item .delete-btn-cross {
    flex-shrink: 0;
    position: relative !important; /* Relative so pseudo-elements position correctly inside */
    top: auto !important;
    right: auto !important;
    left: auto !important;
    bottom: auto !important;
    margin-left: calc(12px * var(--card-size-multiplier, 0.7));
    margin-top: 0 !important;
    margin-right: 0 !important;
    margin-bottom: 0 !important;
    width: 28px !important;
    height: 28px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    /* z-index: 10 !important; */
  }
  
  /* Hover-only support for compact mode */
  .compact-item:hover .hover-only {
    opacity: 1 !important;
    pointer-events: auto !important;
  }
  
  /* Container for multiple compact items */
  .compact-container {
    display: flex;
    flex-wrap: wrap;
    gap: calc(11.43px * var(--card-size-multiplier, 0.7));
    margin-bottom: 16px;
    justify-content: space-between;
  }
  
  /* Pixel Art Specific Compact Styles */
  .compact-preview.pixelart-preview {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .compact-title {
    font-weight: 500;
    color: #24292f;
    font-size: calc(0.95em * var(--card-size-multiplier, 0.7));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .compact-title.clickable {
    cursor: pointer;
    transition: color 0.2s ease;
  }
  
  .compact-title.clickable:hover {
    color: var(--primary-color, #03a9f4);
    text-decoration: underline;
  }
`;

/**
 * Renders a compact layout item (Lit HTML version)
 *
 * @param {Object} config - Configuration object
 * @param {number} config.index - Item index
 * @param {TemplateResult} config.preview - Preview content (Lit HTML template)
 * @param {TemplateResult} config.info - Info content (Lit HTML template)
 * @param {boolean} config.allowDelete - Whether to show delete button
 * @param {string} config.deleteBtnClass - CSS classes for delete button
 * @param {Function} config.onDeleteClick - Delete button click handler
 * @param {Function} config.onClick - Item click handler (optional)
 * @param {boolean} config.allowDragDrop - Whether item is draggable
 * @param {string} config.additionalClasses - Additional CSS classes for item
 * @returns {TemplateResult} Lit HTML template
 */
export function renderCompactItem(html, config) {
  const {
    index,
    preview,
    info,
    allowDelete = false,
    deleteBtnClass = "",
    onDeleteClick = null,
    onClick = null,
    allowDragDrop = false,
    additionalClasses = "",
  } = config;

  return html`
    <div
      class="compact-item ${additionalClasses}"
      data-idx="${index}"
      draggable="${allowDragDrop}"
      @click=${onClick}
    >
      ${preview} ${info}
      ${allowDelete && deleteBtnClass
        ? html`
            <button
              class="${deleteBtnClass}"
              data-action="remove"
              title="Remove"
              @click=${(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onDeleteClick) onDeleteClick(e);
              }}
            >
              ×
            </button>
          `
        : ""}
    </div>
  `;
}

/**
 * Renders a compact layout item (Plain HTML string version for non-Lit contexts)
 *
 * @param {Object} config - Configuration object
 * @param {number} config.index - Item index
 * @param {string} config.previewHTML - Preview HTML content
 * @param {string} config.infoHTML - Info HTML content
 * @param {boolean} config.allowDelete - Whether to show delete button
 * @param {string} config.deleteBtnClass - CSS classes for delete button
 * @param {boolean} config.allowDragDrop - Whether item is draggable
 * @param {string} config.additionalClasses - Additional CSS classes for item
 * @returns {string} HTML string
 */
export function renderCompactItemHTML(config) {
  const {
    index,
    previewHTML = "",
    infoHTML = "",
    allowDelete = false,
    deleteBtnClass = "",
    allowDragDrop = false,
    additionalClasses = "",
  } = config;

  return `
    <div 
      class="compact-item ${additionalClasses}"
      data-idx="${index}"
      ${allowDragDrop ? 'draggable="true"' : ""}
    >
      ${previewHTML}
      ${infoHTML}
      ${
        allowDelete && deleteBtnClass
          ? `<button class="${deleteBtnClass}" data-action="remove" data-idx="${index}" title="Remove">×</button>`
          : ""
      }
    </div>
  `;
}

/**
 * Sets up drag-and-drop functionality for compact layout items
 *
 * @param {HTMLElement} root - Root element containing the compact items
 * @param {string} itemSelector - CSS selector for draggable items (e.g., '.compact-item')
 * @param {Function} onReorder - Callback when items are reordered, receives (newOrder: number[])
 * @param {Object} options - Optional configuration
 * @param {Function} options.shouldPreventDrag - Function to check if drag should be prevented (e.g., for focused inputs)
 * @param {Object} options.context - Context object to set _isDragging flag on
 */
export function setupCompactDragDrop(
  root,
  itemSelector,
  onReorder,
  options = {}
) {
  const { shouldPreventDrag = null, context = null } = options;

  let draggedItem = null;
  let draggedIndex = null;

  root.querySelectorAll(itemSelector).forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      // Allow custom drag prevention logic
      if (shouldPreventDrag && shouldPreventDrag(e)) {
        e.preventDefault();
        return;
      }

      if (context) {
        context._isDragging = true;
      }

      draggedItem = item;
      draggedIndex = parseInt(item.dataset.idx);
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";

      // Force layout calculation to prevent position offset on first drag
      void item.offsetHeight;
    });

    item.addEventListener("dragend", () => {
      if (draggedItem) {
        draggedItem.classList.remove("dragging");

        // Get new order based on current DOM positions
        const items = Array.from(root.querySelectorAll(itemSelector));
        const newOrder = items.map((i) => parseInt(i.dataset.idx));


        // Check if order actually changed
        const orderChanged = newOrder.some((pos, idx) => pos !== idx);

        if (orderChanged) {
          // CRITICAL: Call onReorder FIRST with the old data-idx values
          // onReorder needs these to correctly map the backend array
          if (onReorder) {
            onReorder(newOrder);
          }

          // THEN update data-idx to sequential values (0, 1, 2...)
          // This ensures future operations use correct indices matching the new backend order
          items.forEach((item, newIdx) => {
            const oldIdx = item.dataset.idx;
            item.dataset.idx = newIdx;
          });

        }
      }

      draggedItem = null;
      draggedIndex = null;

      if (context) {
        context._isDragging = false;
      }
    });

    item.addEventListener("dragover", (e) => {
      if (e.preventDefault) e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (draggedItem && item !== draggedItem) {
        const items = Array.from(root.querySelectorAll(itemSelector));
        const draggedIdx = items.indexOf(draggedItem);
        const targetIdx = items.indexOf(item);

        // Only update DOM if position would actually change
        if (
          draggedIdx !== -1 &&
          targetIdx !== -1 &&
          Math.abs(draggedIdx - targetIdx) > 0
        ) {
          const currentNext = draggedItem.nextElementSibling;
          const currentPrev = draggedItem.previousElementSibling;

          if (draggedIdx < targetIdx) {
            // Moving forward - insert after target
            if (currentPrev !== item) {
              const nextSibling = item.nextElementSibling;
              if (nextSibling) {
                item.parentNode.insertBefore(draggedItem, nextSibling);
              } else {
                item.parentNode.appendChild(draggedItem);
              }
            }
          } else {
            // Moving backward - insert before target
            if (currentNext !== item) {
              item.parentNode.insertBefore(draggedItem, item);
            }
          }
        }
      }

      return false;
    });
  });
}
