/**
 * Delete/Remove Button Styles and Utilities
 *
 * Provides consistent delete button styling and helper functions.
 * All variants draw the cross exclusively via CSS ::before / ::after
 * pseudo-elements, so inline `color` or `style` on the host element
 * never leaks into the cross.  This guarantees correct contrast in
 * every layout mode, theme (light/dark), and parent background color.
 *
 * Styles:
 *   - "none"     — hidden
 *   - "default"  — soft pink tint with red cross
 *   - "red"      — vibrant red gradient with glowing white cross
 *   - "black"    — metallic dark gradient with white cross
 *   - "outline"  — thin red ring, transparent fill, fine red cross
 *   - "glass"    — frosted glass blur, subtle white cross with shadow
 *
 * Usage:
 *   1. Import:
 *      import { deleteButtonStyles, getDeleteButtonClass } from './delete-button-styles.js';
 *
 *   2. Include in CSS template:
 *      ${deleteButtonStyles}
 *
 *   3. Get CSS class:
 *      const cls = getDeleteButtonClass(config.remove_button_style);
 *
 *   4. Render — leave content empty (cross is drawn by CSS):
 *      <button class="${cls}" @click=${handler}></button>
 */

/**
 * Map style name → CSS class string.
 * @param {string} style - "none" | "default" | "red" | "black" | "outline" | "glass"
 * @returns {string}
 */
export function getDeleteButtonClass(style) {
  if (style === "none") return "delete-btn-cross hidden-style";
  const map = {
    red: "red-style",
    prominent: "red-style",   // legacy alias
    black: "black-style",
    outline: "outline-style",
    glass: "glass-style",
    trash: "outline-style",   // migrate legacy "trash" → outline
  };
  return `delete-btn-cross${map[style] ? ` ${map[style]}` : ""}`;
}

/**
 * Inline styles for delete-button positioning on card/spread layouts.
 * @param {string} position - "outside" | "inside" | "square"
 * @returns {string}
 */
export function getCardButtonPositionStyles(position = "outside") {
  if (position === "inside") {
    return "top: 6px; right: 6px;";
  }
  if (position === "square") {
    return "top: -8px; right: -8px; border-radius: 0; background: var(--card-background-color, rgba(255,255,255,0.95)); border: 2px solid var(--divider-color, #f0f0f0); box-shadow: 0 2px 8px rgba(0,0,0,0.15);";
  }
  // outside (default)
  return "top: -8px; right: -8px;";
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CSS — every variant draws the × cross via ::before / ::after only.
 * Text content inside the <button> is forced invisible so inline style
 * overrides from layout code (e.g. `color: ${contrastColor}`) cannot
 * change the cross appearance.
 * ───────────────────────────────────────────────────────────────────────────*/
export const deleteButtonStyles = `
  /* ── Hidden ── */
  .delete-btn-cross.hidden-style { display: none !important; }

  /* ── Base (shared by every visible variant) ── */
  .delete-btn-cross {
    position: absolute;
    right: 4px;
    width: 28px;
    height: 28px;
    display: flex !important;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    padding: 0;
    /* Force-hide any text content (×) so inline color never matters */
    font-size: 0 !important;
    color: transparent !important;
    transition: all 0.2s ease;
    pointer-events: auto !important;
    -webkit-appearance: none;
    appearance: none;
    line-height: 1;
    box-sizing: border-box;
  }

  /* Shared cross arms */
  .delete-btn-cross::before,
  .delete-btn-cross::after {
    content: '' !important;
    position: absolute !important;
    width: 14px !important;
    height: 2px !important;
    border-radius: 1px !important;
    top: 50% !important;
    left: 50% !important;
    pointer-events: none;
  }
  .delete-btn-cross::before { transform: translate(-50%, -50%) rotate(45deg) !important; }
  .delete-btn-cross::after  { transform: translate(-50%, -50%) rotate(-45deg) !important; }

  /* ── Default — soft tint, red cross ── */
  .delete-btn-cross:not(.red-style):not(.black-style):not(.outline-style):not(.glass-style) {
    background: color-mix(in srgb, var(--error-color, #db4437) 12%, var(--card-background-color, #fff));
  }
  .delete-btn-cross:not(.red-style):not(.black-style):not(.outline-style):not(.glass-style)::before,
  .delete-btn-cross:not(.red-style):not(.black-style):not(.outline-style):not(.glass-style)::after {
    background: var(--error-color, #db4437) !important;
  }
  .delete-btn-cross:not(.red-style):not(.black-style):not(.outline-style):not(.glass-style):hover {
    background: color-mix(in srgb, var(--error-color, #db4437) 22%, var(--card-background-color, #fff));
    transform: scale(1.1);
  }

  /* ── Red — vibrant gradient, glowing white cross ── */
  .delete-btn-cross.red-style {
    background: linear-gradient(135deg, #ff1744 0%, #d50000 100%) !important;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2) !important;
  }
  .delete-btn-cross.red-style::before,
  .delete-btn-cross.red-style::after {
    background: #fff !important;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.8) !important;
  }
  .delete-btn-cross.red-style:hover {
    background: linear-gradient(135deg, #ff5252 0%, #ff1744 100%) !important;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3) !important;
    transform: scale(1.1);
  }

  /* ── Black — metallic gradient, white cross ── */
  .delete-btn-cross.black-style {
    background: linear-gradient(135deg, #2c2c2c 0%, #1a1a1a 50%, #000 100%) !important;
    border: 1.5px solid rgba(255, 255, 255, 0.3) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  }
  .delete-btn-cross.black-style::before,
  .delete-btn-cross.black-style::after {
    background: #fff !important;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.5) !important;
    width: 16px !important;
    height: 1.5px !important;
  }
  .delete-btn-cross.black-style:hover {
    background: linear-gradient(135deg, #3a3a3a 0%, #252525 50%, #101010 100%) !important;
    border-color: rgba(255, 255, 255, 0.5) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
    transform: scale(1.1);
  }

  /* ── Outline — thin red ring, transparent fill, fine red cross ── */
  .delete-btn-cross.outline-style {
    background: transparent !important;
    border: 1.5px solid var(--error-color, #db4437) !important;
  }
  .delete-btn-cross.outline-style::before,
  .delete-btn-cross.outline-style::after {
    background: var(--error-color, #db4437) !important;
    width: 12px !important;
    height: 1.5px !important;
  }
  .delete-btn-cross.outline-style:hover {
    background: color-mix(in srgb, var(--error-color, #db4437) 10%, transparent) !important;
    transform: scale(1.1);
  }

  /* ── Glass — frosted blur, white cross with subtle shadow ── */
  .delete-btn-cross.glass-style {
    background: rgba(255, 255, 255, 0.18) !important;
    -webkit-backdrop-filter: blur(10px) saturate(140%);
    backdrop-filter: blur(10px) saturate(140%);
    border: 1px solid rgba(255, 255, 255, 0.25) !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
  }
  .delete-btn-cross.glass-style::before,
  .delete-btn-cross.glass-style::after {
    background: #fff !important;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.3) !important;
  }
  .delete-btn-cross.glass-style:hover {
    background: rgba(255, 255, 255, 0.3) !important;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18) !important;
    transform: scale(1.1);
  }

  /* ── Compact mode positioning (draw-card / palette-card) ── */
  .pixelart-compact-item .delete-btn-cross,
  .palette-compact-item .delete-btn-cross {
    transition: opacity 0.15s, background 0.15s;
    flex-shrink: 0;
    position: absolute;
    top: 8px;
    right: 8px;
  }
`;
