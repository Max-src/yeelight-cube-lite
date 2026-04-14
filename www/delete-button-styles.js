/**
 * Delete/Remove Button Styles and Utilities
 *
 * THE single source of truth for delete button styling, positioning, and
 * configuration across ALL cards (color-list-editor, palette, draw, etc.).
 *
 * Every variant draws the cross exclusively via CSS ::before / ::after
 * pseudo-elements, so inline `color` or `style` on the host element
 * never leaks into the cross.  This guarantees correct contrast in
 * every layout mode, theme (light/dark), and parent background color.
 *
 * Styles:
 *   - "none"     — hidden
 *   - "default"  — soft pink tint with red cross
 *   - "red"      — vibrant red gradient with glowing white cross
 *   - "black"    — metallic dark gradient with white cross
 *   - "dot"      — macOS traffic-light dot: tiny red circle, no cross
 *   - "glass"    — frosted glass blur, subtle white cross with shadow
 *
 * Usage:
 *   1. Import:
 *      import { deleteButtonStyles, getDeleteButtonClass,
 *               getDeleteButtonConfig, deleteButtonPositionStyles } from './delete-button-styles.js';
 *
 *   2. Include in CSS template:
 *      ${deleteButtonStyles}
 *      ${deleteButtonPositionStyles}
 *
 *   3. Read config (works with any card's config object):
 *      const btnCfg = getDeleteButtonConfig(config);
 *      // btnCfg = { style, shape, inside, left, classes, posClass, sideClass, allowDelete }
 *
 *   4. Render — leave content empty (cross is drawn by CSS):
 *      <button class="${btnCfg.classes} my-layout-btn ${btnCfg.posClass} ${btnCfg.sideClass}" ...></button>
 */

/* ─────────────────────────────────────────────────────────────────────────────
 * CONFIG HELPERS
 * ───────────────────────────────────────────────────────────────────────────*/

/**
 * Normalised delete-button configuration reader.
 * Accepts ANY card's config object and returns a consistent bag of values.
 *
 * Config key lookup order (first found wins):
 *   style  → remove_button_style | pixel_art_remove_button_style
 *   shape  → delete_button_shape
 *   inside → delete_button_inside
 *   left   → delete_button_left
 *
 * @param {Object} config - Card configuration object
 * @param {Object} [overrides] - Optional overrides for specific values
 * @returns {Object} { style, shape, inside, left, classes, posClass, sideClass, allowDelete }
 */
export function getDeleteButtonConfig(config = {}, overrides = {}) {
  const style =
    overrides.style ??
    config.remove_button_style ??
    config.pixel_art_remove_button_style ??
    "default";
  const shape = overrides.shape ?? config.delete_button_shape ?? "round";
  const inside = overrides.inside ?? config.delete_button_inside === true;
  const left = overrides.left ?? config.delete_button_left === true;

  const classes = getDeleteButtonClass(style, shape);
  const posClass = inside ? "btn-pos-inside" : "btn-pos-outside";
  const sideClass = left ? "btn-side-left" : "";
  const allowDelete = style !== "none";

  return {
    style,
    shape,
    inside,
    left,
    classes,
    posClass,
    sideClass,
    allowDelete,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CLASS HELPERS
 * ───────────────────────────────────────────────────────────────────────────*/

/**
 * Map style name → CSS class string, optionally including a shape modifier.
 * @param {string} style - "none" | "default" | "red" | "black" | "dot" | "glass"
 * @param {string} [shape] - "round" | "rounded" | "square" (default: "round")
 * @returns {string}
 */
export function getDeleteButtonClass(style, shape) {
  if (style === "none") return "delete-btn-cross hidden-style";
  const map = {
    red: "red-style",
    prominent: "red-style", // legacy alias
    black: "black-style",
    dot: "dot-style",
    glass: "glass-style",
    outline: "dot-style", // migrate legacy "outline" → dot
    trash: "dot-style", // migrate legacy "trash" → dot
    neon: "dot-style", // migrate legacy "neon" → dot
  };
  const shapeMap = {
    rounded: "btn-shape-rounded",
    square: "btn-shape-square",
  };
  let cls = `delete-btn-cross${map[style] ? ` ${map[style]}` : ""}`;
  if (shape && shapeMap[shape]) cls += ` ${shapeMap[shape]}`;
  return cls;
}

/**
 * Inline styles for delete-button positioning (works for all layouts).
 * @param {boolean} inside - true = inside the element, false = protruding outside
 * @param {boolean} left - true = left side, false = right side (default)
 * @returns {string}
 */
export function getButtonPositionStyles(inside = false, left = false) {
  const hSide = left ? "left" : "right";
  if (inside) {
    return `top: 6px; ${hSide}: 6px;`;
  }
  // outside (default) — protrudes from corner
  return `top: -8px; ${hSide}: -8px;`;
}

/**
 * @deprecated Use getButtonPositionStyles(inside) instead.
 * Kept for backward compatibility.
 */
export function getCardButtonPositionStyles(position = "outside") {
  return getButtonPositionStyles(position === "inside");
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

  /* ── Shape modifiers ── */
  .delete-btn-cross.btn-shape-rounded {
    border-radius: 6px !important;
  }
  .delete-btn-cross.btn-shape-square {
    border-radius: 0 !important;
  }
  /* Dot shape — smaller radius since dot is 14px */
  .delete-btn-cross.dot-style.btn-shape-rounded {
    border-radius: 3px !important;
  }
  .delete-btn-cross.dot-style.btn-shape-square {
    border-radius: 0 !important;
  }

  /* ── Base (shared by every visible variant) ── */
  .delete-btn-cross {
    position: absolute;
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
  .delete-btn-cross:not(.red-style):not(.black-style):not(.dot-style):not(.glass-style) {
    background: color-mix(in srgb, var(--error-color, #db4437) 12%, var(--card-background-color, #fff));
  }
  .delete-btn-cross:not(.red-style):not(.black-style):not(.dot-style):not(.glass-style)::before,
  .delete-btn-cross:not(.red-style):not(.black-style):not(.dot-style):not(.glass-style)::after {
    background: var(--error-color, #db4437) !important;
  }
  .delete-btn-cross:not(.red-style):not(.black-style):not(.dot-style):not(.glass-style):hover {
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
    background: rgba(255, 255, 255, 0.9) !important;
    box-shadow: none !important;
    width: 14px !important;
    height: 1.5px !important;
  }
  .delete-btn-cross.black-style:hover {
    background: linear-gradient(135deg, #3a3a3a 0%, #252525 50%, #101010 100%) !important;
    border-color: rgba(255, 255, 255, 0.5) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
    transform: scale(1.1);
  }

  /* ── Dot — macOS traffic-light: tiny red circle, no cross ── */
  .delete-btn-cross.dot-style {
    width: 14px !important;
    height: 14px !important;
    min-width: 14px;
    min-height: 14px;
    background: #ff5f57 !important;
    border: 1px solid rgba(0, 0, 0, 0.12) !important;
    box-shadow: inset 0 0.5px 1px rgba(255, 255, 255, 0.35),
                0 0.5px 1px rgba(0, 0, 0, 0.12) !important;
  }
  /* Hide cross entirely — dot only */
  .delete-btn-cross.dot-style::before,
  .delete-btn-cross.dot-style::after {
    display: none !important;
  }
  .delete-btn-cross.dot-style:hover {
    background: #ff3b30 !important;
    transform: scale(1.18);
    box-shadow: inset 0 0.5px 1px rgba(255, 255, 255, 0.35),
                0 1px 3px rgba(255, 59, 48, 0.35) !important;
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

/* ─────────────────────────────────────────────────────────────────────────────
 * POSITION CSS — inside/outside × left/right, usable by any layout.
 *
 * Apply alongside deleteButtonStyles.  These use the CSS classes:
 *   .btn-pos-inside  / .btn-pos-outside  (default if neither is set = outside)
 *   .btn-side-left   (omit = right side, which is the default)
 *
 * Each layout may scope these under its own container selector for specificity,
 * but these generic rules cover the common absolute-positioned case
 * (gallery, grid, list, compact, etc.)
 * ───────────────────────────────────────────────────────────────────────────*/
export const deleteButtonPositionStyles = `
  /* ── Generic position rules (absolute-positioned buttons) ── */

  /* Outside (default) — protrudes from top-right corner */
  .delete-btn-cross.btn-pos-outside {
    position: absolute !important;
    top: -8px;
    right: -8px;
    z-index: 10;
  }

  /* Inside — sits inside the element's top-right corner */
  .delete-btn-cross.btn-pos-inside {
    position: absolute !important;
    top: 6px;
    right: 6px;
    z-index: 10;
  }

  /* Dot outside — smaller offset */
  .delete-btn-cross.dot-style.btn-pos-outside {
    top: -4px;
    right: -4px;
  }

  /* Dot inside — smaller offset */
  .delete-btn-cross.dot-style.btn-pos-inside {
    top: 4px;
    right: 4px;
  }

  /* ── Left side overrides ── */
  .delete-btn-cross.btn-side-left {
    right: auto !important;
  }
  .delete-btn-cross.btn-pos-outside.btn-side-left {
    left: -8px;
  }
  .delete-btn-cross.btn-pos-inside.btn-side-left {
    left: 6px;
  }
  .delete-btn-cross.dot-style.btn-pos-outside.btn-side-left {
    left: -4px;
  }
  .delete-btn-cross.dot-style.btn-pos-inside.btn-side-left {
    left: 4px;
  }

  /* ── Flex-child mode (used by chips, tiles, rows where button is a flex child when inside) ── */
  .delete-btn-cross.btn-flex-inside {
    position: relative !important;
    top: auto !important;
    right: auto !important;
    left: auto !important;
    flex-shrink: 0;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    margin-left: auto;
  }
  .delete-btn-cross.btn-flex-inside.btn-side-left {
    order: -1;
    margin-left: 0 !important;
    margin-right: auto;
  }
`;
