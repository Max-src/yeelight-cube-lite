/**
 * Delete/Remove Button Styles and Utilities
 *
 * Provides consistent delete button styling and helper functions for gallery items.
 * Supports four visual styles: "default" (pink), "red" (red with white border), "black" (black with white border), and "trash" (red trash icon).
 *
 * Features:
 * - Four button styles: default, red, black, and trash
 * - Automatic hover effects and transitions
 * - Responsive sizing for compact mode
 * - Cross (×) symbol or trash bin icon for delete action
 *
 * Usage:
 *   1. Import in your card's styles:
 *      import { deleteButtonStyles, getDeleteButtonClass } from './delete-button-styles.js';
 *
 *   2. Include styles in your CSS template:
 *      ${deleteButtonStyles}
 *
 *   3. Get button class based on config:
 *      const btnClass = getDeleteButtonClass(config.remove_button_style);
 *
 *   4. Render button with class:
 *      <button class="${btnClass}" @click=${handler}>×</button>
 *
 * Style Options:
 *   - "default": Pink background (#ffeaea) with red text
 *   - "red": Red background with white border and text
 *   - "black": Black background with white border and text
 *   - "trash": White background with red trash bin icon
 */

/**
 * Get CSS class for delete button based on style setting
 * @param {string} style - The button style: "none", "default", "red", "black", or "trash"
 * @returns {string} CSS class string to apply to button element
 */
export function getDeleteButtonClass(style) {
  if (style === "none") {
    return "delete-btn-cross hidden-style";
  }
  const baseClass = "delete-btn-cross";
  if (style === "red" || style === "prominent") {
    // Support legacy "prominent"
    return `${baseClass} red-style`;
  }
  if (style === "black") {
    return `${baseClass} black-style`;
  }
  if (style === "trash") {
    return `${baseClass} trash-style`;
  }
  return baseClass; // Default style
}

/**
 * Get inline styles for delete button positioning on card layouts
 * @param {string} position - The button position: "outside", "inside", or "square"
 * @returns {string} CSS inline styles for button positioning
 */
export function getCardButtonPositionStyles(position = "outside") {
  if (position === "inside") {
    return "top: 6px; right: 6px; background: transparent; border: none; font-size: 2.2em;";
  } else if (position === "square") {
    return "top: -8px; right: -8px; border-radius: 0; background: rgba(255,255,255,0.95); border: 2px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.15);";
  } else {
    // outside (default)
    return "top: -8px; right: -8px; border-radius: 50%; background: rgba(255,255,255,0.95); border: 2px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.15);";
  }
}

/**
 * CSS styles for delete/remove buttons
 * Includes base styles, default variant, red variant, black variant, and compact mode positioning
 */
export const deleteButtonStyles = `
  /* Delete Button - Hidden Style */
  .delete-btn-cross.hidden-style {
    display: none !important;
  }

  /* Delete Button - Hover Only Visibility */
  .delete-btn-cross.hover-only {
    opacity: 0 !important;
    pointer-events: none !important;
    transition: opacity 0.2s ease !important;
  }

  /* Parent hover reveals button */
  .compact-item:hover .delete-btn-cross.hover-only,
  .palette-row:hover .delete-btn-cross.hover-only,
  .palette-grid-item:hover .delete-btn-cross.hover-only,
  .palette-compact-item:hover .delete-btn-cross.hover-only,
  .pixelart-compact-item:hover .delete-btn-cross.hover-only,
  .pixelart-grid-item:hover .delete-btn-cross.hover-only,
  .pixelart-list-item:hover .delete-btn-cross.hover-only,
  .pixelart-carousel-item:hover .delete-btn-cross.hover-only,
  .palettes-album-item:hover .delete-btn-cross.hover-only,
  .pixelart-album-item:hover .delete-btn-cross.hover-only,
  .palettes-album-item.active:hover .delete-btn-cross.hover-only,
  .pixelart-album-item.active:hover .delete-btn-cross.hover-only,
  .gallery-item:hover .delete-btn-cross.hover-only {
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  /* Delete Button - Base Styles (Default Variant) */
  .delete-btn-cross {
    background: #ffeaea;
    border: none;
    border-radius: 50%;
    color: #b00;
    width: 28px;
    height: 28px;
    display: flex !important;
    align-items: center;
    justify-content: center;
    font-size: 1.3em;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    position: absolute;
    /* top: 4px; */
    right: 4px;
    /* z-index: 1000; */
    pointer-events: auto !important;
  }

  .delete-btn-cross:hover {
    background: #ffd6d6;
    transform: scale(1.1);
  }

  /* Red Style Variant - Vibrant gradient with glowing cross */
  .delete-btn-cross.red-style {
    background: linear-gradient(135deg, #ff1744 0%, #d50000 100%) !important;
    border: none !important;
    color: transparent !important;
    font-size: 0 !important;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2) !important;
  }

  .delete-btn-cross.red-style::before,
  .delete-btn-cross.red-style::after {
    content: '' !important;
    position: absolute !important;
    background: white !important;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.8) !important;
    top: 50% !important;
    left: 50% !important;
  }

  .delete-btn-cross.red-style::before {
    width: 14px !important;
    height: 2px !important;
    border-radius: 1px !important;
    transform: translate(-50%, -50%) rotate(45deg) !important;
  }

  .delete-btn-cross.red-style::after {
    width: 14px !important;
    height: 2px !important;
    border-radius: 1px !important;
    transform: translate(-50%, -50%) rotate(-45deg) !important;
  }

  .delete-btn-cross.red-style:hover {
    background: linear-gradient(135deg, #ff5252 0%, #ff1744 100%) !important;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3) !important;
    transform: scale(1.1);
  }

  /* Black Style Variant - Metallic gradient with border-to-border cross */
  .delete-btn-cross.black-style {
    background: linear-gradient(135deg, #2c2c2c 0%, #1a1a1a 50%, #000000 100%) !important;
    border: 1.5px solid rgba(255, 255, 255, 0.3) !important;
    color: transparent !important;
    font-size: 0 !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  }

  .delete-btn-cross.black-style::before,
  .delete-btn-cross.black-style::after {
    content: '' !important;
    position: absolute !important;
    background: white !important;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.5) !important;
    top: 50% !important;
    left: 50% !important;
  }

  .delete-btn-cross.black-style::before {
    width: 16px !important;
    height: 1.5px !important;
    transform: translate(-50%, -50%) rotate(45deg) !important;
  }

  .delete-btn-cross.black-style::after {
    width: 16px !important;
    height: 1.5px !important;
    transform: translate(-50%, -50%) rotate(-45deg) !important;
  }

  .delete-btn-cross.black-style:hover {
    background: linear-gradient(135deg, #3a3a3a 0%, #252525 50%, #101010 100%) !important;
    border-color: rgba(255, 255, 255, 0.5) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
    transform: scale(1.1);
  }

  /* Trash Style Variant - Sleek minimal with icon glow */
  .delete-btn-cross.trash-style {
    background: rgba(255, 255, 255, 0.95) !important;
    border: 1px solid rgba(211, 47, 47, 0.25) !important;
    color: #d32f2f !important;
    font-size: 0 !important;
    width: 28px !important;
    height: 28px !important;
  }

  .delete-btn-cross.trash-style::before {
    content: "🗑" !important;
    font-size: 13px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    filter: drop-shadow(0 0 2px rgba(211, 47, 47, 0.3)) !important;
  }

  .delete-btn-cross.trash-style:hover {
    background: white !important;
    border-color: rgba(211, 47, 47, 0.4) !important;
    transform: scale(1.1);
  }

  .delete-btn-cross.trash-style:hover::before {
    filter: drop-shadow(0 0 4px rgba(211, 47, 47, 0.5)) !important;
  }

  /* Compact Mode Positioning */
  .pixelart-compact-item .delete-btn-cross,
  .palette-compact-item .delete-btn-cross {
    font-size: 1.4em;
    font-weight: bold;
    transition: opacity 0.15s, background 0.15s;
    flex-shrink: 0;
    position: absolute;
    top: 8px;
    right: 8px;
  }

  .pixelart-compact-item .delete-btn-cross:hover,
  .palette-compact-item .delete-btn-cross:hover {
    opacity: 1;
    background: rgba(215, 58, 73, 0.1);
  }

  /* NOTE: .pixelart-btn-cross.delete-btn-cross inherits from .delete-btn-cross above */
  /* No need for duplicate definitions - CSS cascade handles it */
`;
