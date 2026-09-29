/**
 * Grid Mode Styles - the grid layout CSS shared by the palette card's grid
 * display (the markup itself is rendered by gallery-display-utils.js).
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

  /* Allow outside buttons to overflow gradient card bounds */
  .grid-item-gradient:has(.btn-pos-outside) {
    overflow: visible;
  }
  .grid-item-gradient:has(.btn-pos-outside) .grid-gradient-bg {
    border-radius: 12px 12px 0 0;
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
    top: 4px;
    right: 4px;
    padding: 4px 10px;
    font-size: 0.7em;
    z-index: 100;
  }

  .grid-item .delete-btn-cross,
  .grid-item .remove-btn-cross {
    position: absolute;
    top: 4px;
    right: 4px;
    background: var(--card-background-color, rgba(255,255,255,0.95));
    border: 1px solid color-mix(in srgb, var(--primary-text-color, #000) 10%, transparent);
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

  /* Dot style inside grid: more inset for the small dot */
  .grid-item .delete-btn-cross.dot-style {
    top: 8px !important;
    right: 8px !important;
  }

  /* ── Grid: position class overrides ── */
  .grid-item .delete-btn-cross.btn-pos-outside {
    top: -8px;
    right: -8px;
  }
  .grid-item .delete-btn-cross.btn-pos-inside {
    top: 6px;
    right: 6px;
  }
  .grid-item .delete-btn-cross.dot-style.btn-pos-outside {
    top: -4px !important;
    right: -4px !important;
  }
  .grid-item .delete-btn-cross.dot-style.btn-pos-inside {
    top: 4px !important;
    right: 4px !important;
  }
  /* Left side */
  .grid-item .delete-btn-cross.btn-side-left {
    right: auto !important;
    left: 4px;
  }
  .grid-item .delete-btn-cross.btn-pos-outside.btn-side-left {
    left: -8px;
  }
  .grid-item .delete-btn-cross.btn-pos-inside.btn-side-left {
    left: 6px;
  }
  .grid-item .delete-btn-cross.dot-style.btn-side-left {
    left: 8px;
  }
  .grid-item .delete-btn-cross.dot-style.btn-pos-outside.btn-side-left {
    left: -4px !important;
  }
  .grid-item .delete-btn-cross.dot-style.btn-pos-inside.btn-side-left {
    left: 4px !important;
  }
`;

