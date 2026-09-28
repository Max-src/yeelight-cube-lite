/**
 * List Mode Utilities - Reusable list mode rendering
 *
 * Provides consistent list mode layout for gallery items.
 * Delete button style/shape/position is configured via getDeleteButtonConfig()
 * from delete-button-styles.js.  The caller passes deleteBtnClass, posClass,
 * and sideClass through the options bag.
 */


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
