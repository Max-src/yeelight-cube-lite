import { BLACK_THRESHOLD } from "./matrix-const.js";
import { previewLength } from "./preview-appearance.js";
import { favouriteId, normalizeFavourite } from "./mode-controls-controller.js";

/**
 * Matrix previews as HTML strings (renderMatrixPreview: the cards' own
 * previews, thumbnails, editors), their cell colors (matrixCellLook, also
 * used by the gallery's Lit layouts, gallery-layouts.js), the favourites'
 * keys (favouriteKeys) and the look of the shared gallery's layouts (galleryDisplayStyles).
 */

/**
 * One matrix cell's color and shadow: black pixels may be left out
 * (ignoreBlackPixels) and lose their shadow. Shared by renderMatrixPreview
 * (markup) and paintMatrixPreview (in place) so both always agree.
 */
export function matrixCellLook(color, options) {
  let css;
  let isBlack;
  if (Array.isArray(color)) {
    isBlack =
      color[0] <= BLACK_THRESHOLD &&
      color[1] <= BLACK_THRESHOLD &&
      color[2] <= BLACK_THRESHOLD;
    css = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  } else {
    const hex = (color || "#000000").replace(/^#/, "");
    isBlack =
      parseInt(hex.substring(0, 2), 16) <= BLACK_THRESHOLD &&
      parseInt(hex.substring(2, 4), 16) <= BLACK_THRESHOLD &&
      parseInt(hex.substring(4, 6), 16) <= BLACK_THRESHOLD;
    css = color || "#000000";
  }
  const ignored = options.ignoreBlackPixels && isBlack;
  const length = (value) =>
    options.proportionalSpacing !== false ? previewLength(value) : `${value}px`;
  return {
    background: ignored ? "transparent" : css,
    shadow: !ignored && options.pixelBoxShadow ? `0 0 ${length(2)} #0008` : "",
  };
}

/**
 * Render a matrix preview (5x20 LED grid)
 * @param {Array} colorData - Flattened array of 100 colors (5 rows x 20 cols)
 * @param {Object} options - Display options
 * @returns {string} HTML string for the matrix
 */
export function renderMatrixPreview(colorData, options = {}) {
  const {
    rows = 5,
    cols = 20,
    bgColor = "#000000",
    pixelStyle = "square", // "square", "circle", "rounded"
    pixelGap = 1,
    previewSize = 200, // Width in pixels
    ignoreBlackPixels = false,
    matrixBoxShadow = false,
    pixelBoxShadow = false,
    proportionalSpacing = true,
  } = options;

  const length = (value) =>
    proportionalSpacing ? previewLength(value) : `${value}px`;

  const matrixShadowStyle = matrixBoxShadow
    ? `box-shadow: 0 ${length(2)} ${length(8)} rgba(0,0,0,0.5);`
    : "";

  const borderRadius =
    pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0";

  // Width is controlled by previewSize (or 100% in forceAspectRatio mode).
  // Height is auto-calculated: each pixel is forced square via aspect-ratio 1/1,
  // so height naturally follows from (width, cols, rows, gap, padding).
  const sizeStyle = options.forceAspectRatio
    ? `width: 100%;`
    : `width: ${previewSize}px;`;

  return `
    ${proportionalSpacing ? `<div style="container-type:inline-size;max-width:100%;${sizeStyle}">` : ""}
    <div class="gallery-matrix-preview" style="grid-template-columns:repeat(${cols},1fr);gap:${length(pixelGap)};background:${bgColor};padding:${length(pixelGap * 2)};border-radius:${length(4)};--yc-px-radius:${borderRadius};${proportionalSpacing ? "width:100%;" : sizeStyle}${matrixShadowStyle}">${colorData
      .map((color) => {
        const look = matrixCellLook(color, options);
        return `<div style="background:${look.background};${look.shadow ? `box-shadow:${look.shadow};` : ""}"></div>`;
      })
      .join("")}
    </div>
    ${proportionalSpacing ? "</div>" : ""}
  `;
}

/**
 * The keys of the favourites saved with this color mode (and color): their
 * items show the star.
 */
export function favouriteKeys(favourites, colorMode = "normal", color) {
  const marked = new Set();
  for (const item of favourites || []) {
    const favourite = normalizeFavourite(item);
    if (
      favourite &&
      favouriteId(favourite) ===
        favouriteId({ key: favourite.key, colorMode, color })
    )
      marked.add(favourite.key);
  }
  return marked;
}

/**
 * The fixed look of a matrix preview (renderMatrixPreview): every root that
 * shows one includes it (galleryDisplayStyles does). Each cell keeps only
 * its color and shadow inline, which the animations repaint.
 */
export const matrixPreviewStyles = `
  .gallery-matrix-preview {
    display: grid;
    max-width: 100%;
    box-sizing: border-box;
  }
  .gallery-matrix-preview > div {
    aspect-ratio: 1 / 1;
    border-radius: var(--yc-px-radius, 0);
  }
`;

/**
 * CSS styles for gallery display (to be imported into card styles)
 */
export const galleryDisplayStyles = matrixPreviewStyles + `
  /* List / grid (renderGalleryMode); the columns and per-render colors and
     font sizes are inline. */
  .gallery-display-grid {
    display: grid;
    gap: 12px;
    align-items: start;
    max-width: 100%;
    box-sizing: border-box;
    padding: 4px;
  }
  .gallery-display-grid > .gallery-item {
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--divider-color, #e0e0e0);
    transition: all 0.2s ease;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }
  .gallery-display-grid > .gallery-item-plain {
    padding: 6px;
    border: none;
  }
  .gallery-display-grid .gallery-item-title {
    text-align: center;
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .gallery-item-body {
    display: flex;
    justify-content: center;
  }
  .gallery-display-grid .gallery-item-metadata {
    text-align: center;
    margin-top: 4px;
    color: var(--secondary-text-color, #666);
  }

  .gallery-item-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }

  /* Strip (one scrollable row) and compact (a centred wrapping row). */
  .gallery-display-strip,
  .gallery-display-compact {
    display: flex;
    gap: 8px;
    max-width: 100%;
    box-sizing: border-box;
    padding: 4px;
  }
  .gallery-display-strip {
    flex-wrap: nowrap;
    overflow-x: auto;
    align-items: flex-start;
    padding-bottom: 8px;
  }
  .gallery-display-compact {
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
  }
  .gallery-compact-item {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--divider-color, #e0e0e0);
    transition: all 0.2s ease;
    max-width: 100%;
    box-sizing: border-box;
  }
  .gallery-display-strip > .gallery-compact-item {
    flex: 0 0 auto;
  }
  .gallery-compact-item.gallery-compact-plain {
    padding: 2px;
    border: none;
  }
  .gallery-compact-item .gallery-item-title {
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  .gallery-compact-item:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transform: scale(1.05);
  }

  /* Strip mode: thin, unobtrusive horizontal scrollbar */
  .gallery-display-strip {
    scrollbar-width: thin;
    scrollbar-color: var(--divider-color, #ccc) transparent;
  }
  .gallery-display-strip::-webkit-scrollbar {
    height: 6px;
  }
  .gallery-display-strip::-webkit-scrollbar-thumb {
    background: var(--divider-color, #ccc);
    border-radius: 3px;
  }
  .gallery-display-strip::-webkit-scrollbar-track {
    background: transparent;
  }

  .gallery-matrix-preview {
    user-select: none;
    pointer-events: none;
  }

  /* Favourite marker: a gold star inline with the item's title/label (the same
     presentation the text dropdowns use). Live-preview modes (list/grid/strip/
     carousel/wheel) render the star larger; Text and Original keep it at label
     size. The gallery's layouts set data-favourite on each [data-mode] item.
     Hidden when the card host has data-fav-stars="false" (the editor's
     "Show favourite stars" toggle). */
  :host([data-fav-stars="false"])
    [data-mode][data-favourite="true"]
    :is(.gallery-item-title, .wheel-item-title, .wheel-item-title-hover, .original-item-name)::before {
    content: none !important;
  }
  :host([data-fav-stars="false"]) .shared-action-button[data-favourite="true"]::before {
    content: none !important;
  }

  /* Live-preview titles: a larger, clearly visible star. */
  [data-mode][data-favourite="true"]
    :is(.gallery-item-title, .wheel-item-title, .wheel-item-title-hover)::before {
    content: "★";
    margin-right: 6px;
    color: var(--warning-color, #f0a202);
    font-size: 1.45em;
    line-height: 1;
  }

  /* Text selector + Original display: star at label size. */
  [data-mode][data-favourite="true"] .original-item-name::before {
    content: "★";
    margin-right: 5px;
    color: var(--warning-color, #f0a202);
    font-weight: 400;
  }
  .shared-action-button[data-favourite="true"]::before {
    content: "★";
    color: var(--warning-color, #f0a202);
  }

  /* Shared "Original" browser gallery (Native Effects + Clock cards). */
  .original-gallery {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  }
  .original-gallery.list {
    grid-template-columns: 1fr;
  }
  .original-item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--divider-color, #ddd);
    border-radius: 8px;
    background: var(--card-background-color, #fff);
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .original-item-preview {
    width: 100%;
    min-width: 0;
  }
  .original-item[data-active-mode="true"] {
    border-color: var(--primary-color, #00897b);
    box-shadow: inset 0 0 0 1px var(--primary-color, #00897b);
  }
  .original-item-name {
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .original-item-badge {
    font-size: 12px;
    color: var(--secondary-text-color, #666);
  }

  /* ========================================
     WHEEL MODE STYLES - Independent from gallery
     ======================================== */
  
  .wheel-display {
    user-select: none;
    position: relative;
    width: 100%;
    margin: 0 auto;
    overflow: visible;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    box-sizing: border-box;
  }
  .wheel-clip-viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    padding: 0;
  }
  /* The scrolled column: its offset (transform) and the items' opacity,
     transform and z-index are inline (wheel-picker.js <yc-wheel>). */
  .wheel-scroll-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    width: 100%;
    box-sizing: border-box;
    pointer-events: auto;
    margin: 0 auto;
    cursor: grab;
  }
  .wheel-item {
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    transform-origin: center center;
    max-width: 90%;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .wheel-item-body {
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 1;
  }
  .wheel-item[data-wheel-compact-item="true"] > .wheel-item-body {
    flex: initial;
    width: 100%;
    height: 100%;
  }
  .wheel-item-title {
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  /* Compact wheel: the title shows on hover. */
  .wheel-item[data-wheel-compact-item="true"]:hover .wheel-item-title-hover {
    opacity: 1;
  }
  .wheel-item-title-hover {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    color: var(--text-primary-color, #fff);
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 1000;
  }
  /* Nav buttons: under the wheel (rotated arrows), or on its sides. */
  .wheel-nav-buttons {
    position: absolute;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 18px;
    z-index: 10;
    pointer-events: none;
  }
  .wheel-nav-buttons[data-wheel-nav-layout="sides"] {
    top: 50%;
    bottom: auto;
    left: -12px;
    transform: translateY(-50%);
    justify-content: space-between;
    width: calc(100% + 24px);
    gap: 0;
  }
  .wheel-nav-buttons button {
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
    width: 48px;
    height: 48px;
    cursor: pointer;
    font-size: 2em;
    color: var(--primary-text-color, #333);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    pointer-events: auto;
    user-select: none;
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .wheel-nav-buttons .wheel-nav-down {
    padding: 0 2px 6px 0;
  }
  .wheel-nav-buttons .wheel-nav-up {
    padding: 0 0 6px 2px;
  }
  /* Under the wheel the arrows point up and down, whatever the hover. */
  .wheel-nav-buttons:not([data-wheel-nav-layout="sides"]) button {
    transform: rotate(-90deg);
  }

  .wheel-item[data-wheel-centered="true"] {
    opacity: 1 !important;
    transform: scale(1) rotateX(0deg) !important;
    z-index: 10;
  }

  /* When wheel bg is transparent, give centered item a solid background
     so overlapping items behind it don't show through */
  .wheel-display[data-bg-transparent="true"] .wheel-item[data-wheel-centered="true"] {
    background: var(--card-background-color, #fff) !important;
  }

  /* Wheel centered border - only when highlight_active_mode is ON (set by
     collection-gallery.js on itself) */
  [data-highlight-active="true"] .wheel-item[data-wheel-centered="true"] {
    border-color: rgba(9, 105, 218, 0.7) !important;
    border-width: 2px !important;
  }

  .wheel-nav-up:hover,
  .wheel-nav-down:hover {
    background: linear-gradient(135deg, #0550ae 0%, #033d8a 100%) !important;
    transform: scale(1.08);
    box-shadow: 0 6px 16px rgba(9, 105, 218, 0.45) !important;
  }

  .wheel-nav-up:active,
  .wheel-nav-down:active {
    transform: scale(0.92);
  }

  /* ========================================
     ACTIVE MODE HIGHLIGHT STYLES
     — Drawn INSET (negative outline-offset / inset box-shadow) so the ring
       renders inside the element and can never be clipped by container or
       ha-card overflow, even for full-width items.
     — Only border / outline / shadow — never override background
       so the user's chosen Preview Background Color is preserved.
     ======================================== */

  /* Gallery / Grid / List mode: card style */
  .gallery-item-card[data-active-mode="true"] {
    border-color: var(--primary-color, #03a9f4) !important;
    box-shadow: inset 0 0 0 1px var(--primary-color, #03a9f4) !important;
  }

  /* Gallery / Grid / List mode: plain (no-card) style */
  .gallery-item-plain[data-active-mode="true"] {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: -2px;
    border-radius: 8px;
  }

  /* Transparent bg: give active items a subtle tinted background */
  .gallery-item-card[data-active-mode="true"][data-bg-transparent="true"] {
    background: color-mix(in srgb, var(--primary-color, #03a9f4) 8%, transparent) !important;
  }
  .gallery-item-plain[data-active-mode="true"][data-bg-transparent="true"] {
    background: color-mix(in srgb, var(--primary-color, #03a9f4) 8%, transparent) !important;
  }
  .gallery-compact-item[data-active-mode="true"][data-bg-transparent="true"] {
    background: color-mix(in srgb, var(--primary-color, #03a9f4) 8%, transparent) !important;
  }

  /* Compact mode */
  .gallery-compact-item[data-active-mode="true"] {
    border-color: var(--primary-color, #03a9f4) !important;
    box-shadow: inset 0 0 0 1px var(--primary-color, #03a9f4) !important;
  }

  /* Wheel mode: highlight the active mode item (complements data-wheel-centered) */
  .wheel-item[data-active-mode="true"] {
    border-color: var(--primary-color, #03a9f4) !important;
    border-width: 2px !important;
    box-shadow: 0 0 12px rgba(3, 169, 244, 0.35) !important;
  }

  /* Wheel compact mode: active highlight */
  .wheel-compact-item[data-active-mode="true"] {
    border-color: var(--primary-color, #03a9f4) !important;
    box-shadow: 0 0 0 2px var(--primary-color, #03a9f4), 0 4px 12px rgba(3, 169, 244, 0.25) !important;
  }
`;
