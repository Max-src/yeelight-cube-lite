// ============================================================================
//  The shared gallery's selector design language (collection-gallery.js:
//  Clock, Native Effects, Gradient, Palettes, Draw)
// ============================================================================
//
// The unified selector has two families sharing one config key:
//   Text styles:    "filled" | "dropdown" | "chips"
//   Preview styles: "preview-list" | "preview-grid" | "preview-strip" |
//                   "preview-carousel" | "preview-wheel" | "preview-album"
// plus two appearance axes applied across every style: a shape
// (square/rounded/round/custom, via data-shape attributes) and a size scale
// (--gc-sel-scale custom property).  The CSS below styles the text selectors
// and the shape/columns overrides for the preview shell; the preview styles
// themselves render through gallery-display-utils / carousel-utils.

// The gallery layouts (collection-gallery.js): the one list every card,
// editor and config resolver reads.
export const TEXT_SELECTOR_STYLES = ["filled", "dropdown", "chips"];
export const PREVIEW_SELECTOR_STYLES = [
  "preview-list",
  "preview-grid",
  "preview-strip",
  "preview-carousel",
  "preview-wheel",
  "preview-album",
];

/**
 * Shared appearance axis: selector shape (matches the shape language used by
 * the other cards — pixel styles, delete buttons, rounded cards).
 *   "square"  → 0 radius
 *   "rounded" → subtle radius (default, current look)
 *   "round"   → pill / fully rounded
 *   "custom"  → item_radius px (selectorItemRadius), drawn through the
 *               --yc-item-radius variable the gallery sets on itself
 */
export function resolveSelectorShape(cfg) {
  const v = cfg?.selector_shape;
  return v === "square" || v === "round" || v === "custom" ? v : "rounded";
}

/** The item corner radius (px) of a config's selector shape. */
export function selectorItemRadius(cfg) {
  const shape = resolveSelectorShape(cfg);
  if (shape !== "custom") return { square: 0, rounded: 8, round: 18 }[shape];
  const value = Number(cfg?.item_radius);
  return Number.isFinite(value) ? Math.max(0, Math.min(28, value)) : 12;
}

/**
 * Second appearance axis: the shape of the selector's NAV BUTTONS (carousel
 * arrows, wheel arrows) — independent from the item shape. Falls back to the
 * item shape when unset (the historical behaviour, where carousel buttons
 * followed the single "Shape" setting).
 */
export function resolveSelectorButtonShape(cfg) {
  const v = cfg?.selector_button_shape;
  if (v === "square" || v === "round" || v === "rounded") return v;
  const shape = resolveSelectorShape(cfg);
  // Buttons have no custom radius: a custom item shape keeps rounded ones.
  return shape === "custom" ? "rounded" : shape;
}

/** Map a selector shape to the carousel nav-button shape for visual parity. */
export function selectorShapeToCarouselButtonShape(shape) {
  return shape === "round" ? "circle" : shape === "square" ? "square" : "rect";
}

export const selectorSharedStyles = `
  /* Text selectors (collection-gallery.js): "filled" renders through the
     shared action-button system (action-button-utils.js) so it matches the
     color-mode buttons; "dropdown" and "chips" are styled here. */

  /* Chips: a pill per item with its swatch (a gradient, a palette, ...). */
  .gc-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .mode-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px 4px 5px;
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 999px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #24292f);
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .mode-chip:hover {
    border-color: color-mix(in srgb, var(--primary-color, #03a9f4) 55%, transparent);
  }
  .mode-chip.active {
    border-color: var(--primary-color, #03a9f4);
    box-shadow: inset 0 0 0 1px var(--primary-color, #03a9f4);
    font-weight: 600;
  }
  .mode-chip-swatch {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  /* Micro-matrix swatch: the item's preview at chip size, kept crisp
     (square pixels, no shadows, whatever the gallery appearance). */
  .mode-chip-swatch.mode-chip-matrix {
    width: auto;
    height: auto;
    border-radius: 3px;
    box-shadow: none;
    overflow: hidden;
    display: inline-flex;
    background: #000;
  }
  .mode-chip-matrix .gallery-matrix-preview {
    border-radius: 0 !important;
  }
  .mode-chip-matrix .gallery-matrix-preview > div {
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  .mode-chip[data-favourite="true"] .mode-chip-label::before {
    content: "★ ";
    color: var(--warning-color, #f0a202);
  }

  /* Dropdown style */
  .mode-select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--disabled-text-color, #d0d7de);
    border-radius: 6px;
    background: var(--card-background-color, white);
    font-size: 0.9em;
    cursor: pointer;
  }

  .mode-select:focus {
    outline: none;
    border-color: var(--primary-color, #0969da);
    box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
  }

  /* ── Selection-pending pulse (in-flight feedback mechanic) ───── */
  @keyframes gcPendingPulse {
    0%,
    100% {
      outline-color: color-mix(
        in srgb,
        var(--primary-color, #03a9f4) 90%,
        transparent
      );
    }
    50% {
      outline-color: color-mix(
        in srgb,
        var(--primary-color, #03a9f4) 25%,
        transparent
      );
    }
  }
  .gc-pending {
    outline: 2px solid var(--primary-color, #03a9f4) !important;
    outline-offset: -2px !important;
    animation: gcPendingPulse 0.9s ease-in-out infinite;
  }

  /* Hover ring on preview items (transparent base so :hover only animates
     outline-color — avoids the white UA-default border flash). */
  .gallery-item[data-mode] {
    outline: 2px solid transparent;
    outline-offset: -2px;
  }
  .gallery-item[data-mode]:hover {
    outline-color: color-mix(
      in srgb,
      var(--primary-color, #03a9f4) 55%,
      transparent
    );
    border-radius: 8px;
  }

  /* ── Shared appearance axes: shape + size (all selector styles) ── */
  .gc-selector {
    font-size: calc(1em * var(--gc-sel-scale, 1));
  }
  .gc-selector[data-shape="square"] .shared-action-button,
  .gc-selector[data-shape="square"] .mode-select,
  .gc-selector[data-shape="square"] .mode-chip,
  .gc-selector[data-shape="square"] .mode-chip-swatch {
    border-radius: 0 !important;
  }
  .gc-selector[data-shape="rounded"] .mode-chip {
    border-radius: 8px;
  }
  .gc-selector[data-shape="rounded"] .mode-chip-swatch {
    border-radius: 4px;
  }
  .gc-selector[data-shape="round"] .shared-action-button,
  .gc-selector[data-shape="round"] .mode-select {
    border-radius: 999px !important;
  }

  /* Text selector buttons reuse the shared action-button look. Match the
     color-mode radio group: neutralise the tool-active ring/scale so only the
     fill changes when selected. */
  .gc-selector .shared-action-button.tool-active {
    transform: none;
    box-shadow: none;
  }
  .gc-preview-shell[data-shape="square"] .gallery-item,
  .gc-preview-shell[data-shape="square"] .gallery-item:hover,
  .gc-preview-shell[data-shape="square"] .wheel-item,
  .gc-preview-shell[data-shape="square"] .wheel-compact-item {
    border-radius: 0 !important;
  }
  .gc-preview-shell[data-shape="round"] .gallery-item,
  .gc-preview-shell[data-shape="round"] .gallery-item:hover,
  .gc-preview-shell[data-shape="round"] .wheel-item,
  .gc-preview-shell[data-shape="round"] .wheel-compact-item {
    border-radius: 18px !important;
  }

  /* "custom" shape: the gallery's item_radius (--yc-item-radius). */
  .gc-selector[data-shape="custom"] .shared-action-button,
  .gc-selector[data-shape="custom"] .mode-select,
  .gc-selector[data-shape="custom"] .mode-chip,
  .gc-preview-shell[data-shape="custom"] .gallery-item,
  .gc-preview-shell[data-shape="custom"] .gallery-item:hover,
  .gc-preview-shell[data-shape="custom"] .wheel-item,
  .gc-preview-shell[data-shape="custom"] .wheel-compact-item {
    border-radius: var(--yc-item-radius, 8px) !important;
  }

  /* preview-grid style: fixed 2-column layout over the list renderer */
  .gc-preview-shell[data-columns="2"] .gallery-display-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
`;
