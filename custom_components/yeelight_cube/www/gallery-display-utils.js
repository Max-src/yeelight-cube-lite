import { BLACK_THRESHOLD } from "./matrix-const.js";
import { previewLength } from "./preview-appearance.js";
import { escapeHtml } from "./html-escape-utils.js";
import { favouriteId, normalizeFavourite } from "./mode-controls-controller.js";

/**
 * The preview layouts of the shared gallery (collection-gallery.js): list
 * (renderGalleryMode), strip, wheel, plus the item previews (live matrix or
 * a card's own markup), the Original browser and the favourite markers.
 * Every gallery card renders through them: Clock, Native Effects, Gradient,
 * Palettes, Draw.
 */

/**
 * Escape user-controlled item titles before they are interpolated into
 * innerHTML strings (both as element content and title="..." attributes).
 * Pixel-art / palette names are user data — without this, a name like
 * `<img src=x onerror=...>` is stored XSS.
 */
function sanitizeItems(items) {
  return (items || []).map((it) =>
    it && typeof it === "object" && it.title !== undefined && it.title !== null
      ? { ...it, title: escapeHtml(it.title) }
      : it,
  );
}

// ============================================================================
// WHEEL MODE CONSTANTS - Configuration and styling
// ============================================================================
// NOTE: Wheel mode is completely independent from gallery mode.
// - Wheel uses: wheel-item, wheel-item-title, wheel-item-title-hover, wheel-display
// - Gallery uses: gallery-item, gallery-item-title, gallery-display-*
// Changing gallery styles/classes will NOT affect wheel mode and vice versa.
// ============================================================================

const WHEEL_MODE = {
  // Display mode heights
  DEFAULT_ITEM_HEIGHT: 95,
  COMPACT_ITEM_HEIGHT: 68,

  // Preview sizes (fallbacks when no user previewSize is passed)
  DEFAULT_PREVIEW_SIZE: 200,
  COMPACT_PREVIEW_SIZE: 200,

  // Card padding
  DEFAULT_CARD_PADDING: "8px 12px",
  COMPACT_CARD_PADDING: "8px",

  // Typography
  DEFAULT_TITLE_FONT_SIZE: "14px",
  COMPACT_TITLE_FONT_SIZE: "15px",
  DEFAULT_TITLE_MARGIN: "10px",
  COMPACT_TITLE_MARGIN: "12px",

  // Layout
  DEFAULT_VISIBLE_ITEMS: 5,
  DEFAULT_WHEEL_HEIGHT: 300,

  // Nav buttons: the default shape (the rest of their look and the
  // animations are in galleryDisplayStyles).
  BUTTON: {
    BORDER_RADIUS: "50%",
  },
};

/**
 * Compute a title font size that scales with the preview size.
 * At 200px preview -> 13px title; scales linearly, clamped to [10px, 18px].
 * @param {number} previewSize
 * @returns {number} font size in px
 */
function getTitleFontSize(previewSize) {
  // 13px at 200px preview, linearly scaled, min 10, max 18
  const size = Math.round(13 * (previewSize / 200));
  return Math.max(10, Math.min(size, 18));
}

/**
 * Compute a metadata font size that scales with the preview size.
 * At 200px preview -> 11px; clamped to [9px, 15px].
 * @param {number} previewSize
 * @returns {number} font size in px
 */
function getMetadataFontSize(previewSize) {
  const size = Math.round(11 * (previewSize / 200));
  return Math.max(9, Math.min(size, 15));
}

/**
 * Get configuration for wheel mode based on display style
 * @param {string} wheelDisplayStyle - "default" or "compact"
 * @returns {Object} Configuration object with itemHeight, previewSize, padding, etc.
 */
function getWheelModeConfig(wheelDisplayStyle, userPreviewSize) {
  const isCompact = wheelDisplayStyle === "compact";
  // Use user's slider value; fall back to defaults
  const previewSize =
    userPreviewSize ||
    (isCompact
      ? WHEEL_MODE.COMPACT_PREVIEW_SIZE
      : WHEEL_MODE.DEFAULT_PREVIEW_SIZE);
  // Scale item height to fit the preview (ratio 5:20 = 0.25, plus padding)
  const baseItemHeight = isCompact
    ? WHEEL_MODE.COMPACT_ITEM_HEIGHT
    : WHEEL_MODE.DEFAULT_ITEM_HEIGHT;
  const scaledItemHeight = Math.max(
    baseItemHeight,
    Math.round(previewSize * 0.25) + (isCompact ? 40 : 55),
  );

  return {
    isCompact,
    itemHeight: scaledItemHeight,
    previewSize,
    cardPadding: isCompact
      ? WHEEL_MODE.COMPACT_CARD_PADDING
      : WHEEL_MODE.DEFAULT_CARD_PADDING,
    titleFontSize: isCompact
      ? WHEEL_MODE.COMPACT_TITLE_FONT_SIZE
      : WHEEL_MODE.DEFAULT_TITLE_FONT_SIZE,
    titleMargin: isCompact
      ? WHEEL_MODE.COMPACT_TITLE_MARGIN
      : WHEEL_MODE.DEFAULT_TITLE_MARGIN,
    showTitle: !isCompact, // Titles hidden in compact mode, shown on hover
  };
}

// ============================================================================
// WHEEL MODE RENDERER
// ============================================================================

/**
 * One matrix cell's color and shadow: black pixels may be left out
 * (ignoreBlackPixels) and lose their shadow. Shared by renderMatrixPreview
 * (markup) and paintMatrixPreview (in place) so both always agree.
 */
function matrixCellLook(color, options) {
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
 * Repaint a rendered matrix preview (`.gallery-matrix-preview`) with new
 * colors, keeping its DOM: content-only updates (new text, colors, angle)
 * then never rebuild a gallery. `options` are renderMatrixPreview's.
 * Returns false when the matrix does not have one cell per color.
 */
export function paintMatrixPreview(matrix, colorData, options = {}) {
  const cells = matrix?.children;
  if (!cells || !colorData || cells.length !== colorData.length) return false;
  for (let index = 0; index < cells.length; index++) {
    const look = matrixCellLook(colorData[index], options);
    const style = cells[index].style;
    if (style.background !== look.background) style.background = look.background;
    if (style.boxShadow !== look.shadow) style.boxShadow = look.shadow;
  }
  return true;
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
    <div class="gallery-matrix-preview" style="
      display: grid;
      grid-template-columns: repeat(${cols}, 1fr);
      gap: ${length(pixelGap)};
      background: ${bgColor};
      padding: ${length(pixelGap * 2)};
      border-radius: ${length(4)};
      max-width: 100%;
      box-sizing: border-box;
      ${proportionalSpacing ? "width:100%;" : sizeStyle}
      ${matrixShadowStyle}
    ">${colorData
      .map((color) => {
        const look = matrixCellLook(color, options);
        return `<div style="
            aspect-ratio: 1 / 1;
            background: ${look.background};
            border-radius: ${borderRadius};
            ${look.shadow ? `box-shadow: ${look.shadow};` : ""}
          "></div>`;
      })
      .join("")}
    </div>
    ${proportionalSpacing ? "</div>" : ""}
  `;
}

/**
 * An item's preview in every gallery layout: the card's own markup when it
 * has one (item.previewHtml: a palette's swatches; trusted, escaped by the
 * card) at the layout's preview width, else the live matrix of
 * item.colorData. The markup sits in an inline-size container, so cards
 * size it with cqw units and it scales with the gallery's Size like a matrix.
 */
export function renderItemPreview(item, options = {}) {
  if (item?.previewHtml == null) return renderMatrixPreview(item?.colorData, options);
  const width = options.forceAspectRatio
    ? "100%"
    : `${options.previewSize ?? 200}px`;
  return `<div class="gallery-item-preview" style="container-type:inline-size;width:${width};max-width:100%;">${item.previewHtml}</div>`;
}

/**
 * Render items in gallery mode (responsive grid)
 * @param {Array} items - Array of item objects with { title, colorData, metadata, onClick }
 * @param {Object} options - Display options
 * @returns {string} HTML string
 */
export function renderGalleryMode(items, options = {}) {
  items = sanitizeItems(items);
  const {
    previewSize = 200,
    showCards = true,
    showTitles = true,
    onClickEnabled = true,
    currentMode = null,
    highlightActive = false,
    bgColor = "#000000",
    ...matrixOptions
  } = options;

  const cardClass = showCards ? "gallery-item-card" : "gallery-item-plain";
  const cursorStyle = onClickEnabled ? "cursor: pointer;" : "";
  const itemBg =
    bgColor ||
    (showCards ? "var(--card-background-color, #fff)" : "transparent");
  const titleColor =
    bgColor === "#000000"
      ? "color: #fff;"
      : "color: var(--primary-text-color);";
  const isBgTransparent = bgColor === "transparent";

  return `
    <div class="gallery-display-grid" style="grid-template-columns: repeat(auto-fit, minmax(min(${previewSize + 60}px, 100%), 1fr));">
      ${items
        .map((item, idx) => {
          const isActive =
            highlightActive && currentMode && item.dataMode === currentMode;
          return `
        <div class="gallery-item ${cardClass}" 
             data-idx="${idx}"
             ${item.dataMode ? `data-mode="${item.dataMode}"` : ""}
             ${isActive ? 'data-active-mode="true"' : ""}
             ${isBgTransparent ? 'data-bg-transparent="true"' : ""}
             ${item.title ? `title="${item.title}"` : ""}
             style="${cursorStyle} background: ${itemBg};">${
               showTitles && item.title
                 ? `<div class="gallery-item-title" style="font-size: ${getTitleFontSize(previewSize)}px; ${titleColor}">${item.title}</div>`
                 : ""
             }
          <div class="gallery-item-body">
            ${renderItemPreview(item, {
              previewSize,
              bgColor,
              ...matrixOptions,
            })}
          </div>
          ${
            item.metadata
              ? `<div class="gallery-item-metadata" style="font-size: ${getMetadataFontSize(previewSize)}px;">${item.metadata}</div>`
              : ""
          }
        </div>
      `;
        })
        .join("")}
    </div>
  `;
}

/**
 * Render items in strip mode: one horizontally SCROLLABLE row of mini
 * previews (never wraps).
 */
export function renderStripMode(items, options = {}) {
  return renderCompactFlavor(items, options, /*strip=*/ true);
}

// The strip's items (gallery-compact-item; `strip` false: a wrapping row).
function renderCompactFlavor(items, options = {}, strip = false) {
  items = sanitizeItems(items);
  const {
    previewSize = 200,
    showCards = true,
    showTitles = true,
    onClickEnabled = true,
    currentMode = null,
    highlightActive = false,
    bgColor = "#000000",
    ...matrixOptions
  } = options;

  const cursorStyle = onClickEnabled ? "cursor: pointer;" : "";
  const itemBg =
    bgColor ||
    (showCards ? "var(--card-background-color, #fff)" : "transparent");
  const titleColor =
    bgColor === "#000000"
      ? "color: #fff;"
      : "color: var(--primary-text-color);";
  const isBgTransparent = bgColor === "transparent";

  // Strip: single non-wrapping scrollable row; compact: centered wrapping row
  // (galleryDisplayStyles).
  return `
    <div class="${strip ? "gallery-display-strip" : "gallery-display-compact"}">
      ${items
        .map((item, idx) => {
          const isActive =
            highlightActive && currentMode && item.dataMode === currentMode;
          return `
        <div class="gallery-item gallery-compact-item${showCards ? "" : " gallery-compact-plain"}" 
             data-idx="${idx}"
             ${item.dataMode ? `data-mode="${item.dataMode}"` : ""}
             ${isActive ? 'data-active-mode="true"' : ""}
             ${isBgTransparent ? 'data-bg-transparent="true"' : ""}
             ${item.title ? `title="${item.title}"` : ""}
             style="${cursorStyle} border-radius: ${showCards ? "6px" : "4px"}; background: ${itemBg};">${renderItemPreview(item, {
               previewSize,
               bgColor,
               ...matrixOptions,
             })}
          ${
            showTitles && item.title
              ? `<div class="gallery-item-title" style="font-size: ${getTitleFontSize(previewSize)}px; max-width: ${previewSize}px; ${titleColor}">${item.title}</div>`
              : ""
          }
        </div>
      `;
        })
        .join("")}
    </div>
  `;
}

/**
 * Render items in wheel mode (iOS-style picker with 3D rotation effect)
 * @param {Array} items - Array of item objects with title, colorData, dataMode
 * @param {Object} options - Display options
 * @returns {string} HTML string for wheel picker
 */
export function renderWheelMode(items, options = {}) {
  items = sanitizeItems(items);
  const {
    wheelHeight = WHEEL_MODE.DEFAULT_WHEEL_HEIGHT,
    wheelDisplayStyle = "default",
    onClickEnabled = true,
    showTitles = true,
    ...matrixOptions
  } = options;

  // Get mode-specific configuration (showTitle is derived from wheelDisplayStyle)
  const userPreviewSize = matrixOptions.previewSize;
  const config = getWheelModeConfig(wheelDisplayStyle, userPreviewSize);
  const halfVisible = Math.floor(WHEEL_MODE.DEFAULT_VISIBLE_ITEMS / 2);
  const cursorStyle = onClickEnabled ? "cursor: pointer;" : "";
  // Scale outer/inner max-widths based on preview size
  const outerMaxWidth = Math.max(350, config.previewSize + 150);
  const cardMaxWidth = Math.max(250, config.previewSize + 50);

  // Compute effective step size (height minus overlap margin)
  const itemStep = Math.round(config.itemHeight * 0.65);

  // Pre-compute initial translateY so the wheel starts centered on the
  // current mode immediately, without waiting for JS initialization.
  const paddingTop = halfVisible * itemStep;
  let initialCenterIndex = 0;
  if (matrixOptions.currentMode) {
    const foundIdx = items.findIndex(
      (item) => item.dataMode === matrixOptions.currentMode,
    );
    if (foundIdx >= 0) initialCenterIndex = foundIdx;
  }
  const initialBaseOffset =
    paddingTop + config.itemHeight / 2 - wheelHeight / 2;
  const initialOffset = initialBaseOffset + initialCenterIndex * itemStep;

  return `
    <div class="wheel-display" ${matrixOptions.bgColor === "transparent" ? 'data-bg-transparent="true"' : ""} style="max-width: ${outerMaxWidth}px; height: ${wheelHeight}px;">
      <!-- Inner clipping viewport - clips top/bottom overflow only -->
      <div class="wheel-clip-viewport">
        <!-- Scrollable wheel container -->
        <div class="wheel-scroll-container" data-wheel-scroll="true"
          data-wheel-item-height="${config.itemHeight}"
          data-wheel-item-step="${itemStep}"
          data-wheel-container-height="${wheelHeight}"
          data-wheel-padding-top="${paddingTop}"
          style="padding: ${paddingTop}px 0; transform: translateY(-${initialOffset}px); max-width: ${cardMaxWidth}px;">
          ${renderWheelItems(items, config, cursorStyle, matrixOptions, initialCenterIndex)}
        </div>
      </div>

      ${renderWheelNavButtons(options)}
    </div>
  `;
}

/**
 * Compute initial visual style for a wheel item based on distance from center
 * @private
 */
function getInitialWheelItemStyle(idx, centerIndex) {
  const distance = Math.abs(idx - centerIndex);
  if (distance === 0) {
    return { opacity: 1, scale: 1, rotateX: 0, zIndex: 100 };
  }
  // Match WHEEL_CONSTANTS.OFF_CENTER values
  const scale = Math.max(0.92 - 0.02 * (distance - 1), 0.8);
  const direction = idx < centerIndex ? 1 : -1;
  const rotateX = Math.min(distance * 20, 50) * direction;
  const opacity = Math.max(1 - 0.15 * distance, 0.3);
  const zIndex = 100 - distance * 10;
  return { opacity, scale, rotateX, zIndex };
}

/**
 * Render individual wheel items
 * @private
 */
function renderWheelItems(
  items,
  config,
  cursorStyle,
  matrixOptions,
  initialCenterIndex = 0,
) {
  const {
    currentMode = null,
    highlightActive = false,
    showCards = true,
    bgColor = "#000000",
  } = matrixOptions;
  const isBgBlack = bgColor === "#000000";
  const isBgTransparent = bgColor === "transparent";
  const itemBg = isBgTransparent
    ? "rgba(255,255,255,0.08)"
    : bgColor ||
      (showCards ? "var(--card-background-color, #fff)" : "transparent");
  const titleColor = isBgBlack
    ? "color: #fff;"
    : "color: var(--primary-text-color);";
  // Border: white subtle border on black bg, standard on others
  const borderStyle = showCards
    ? isBgBlack
      ? "1px solid rgba(255,255,255,0.25)"
      : "1px solid var(--divider-color, #e0e0e0)"
    : "1px solid transparent";
  // Backdrop blur for transparent mode so overlapping cards show layering
  const backdropBlur = isBgTransparent
    ? "backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);"
    : "";
  return items
    .map((item, idx) => {
      const isActive =
        highlightActive && currentMode && item.dataMode === currentMode;
      const initStyle = getInitialWheelItemStyle(idx, initialCenterIndex);
      return `
      <div class="wheel-item" 
           data-idx="${idx}"
           ${item.dataMode ? `data-mode="${item.dataMode}"` : ""}
           ${isActive ? 'data-active-mode="true"' : ""}
           ${item.title ? `title="${item.title}"` : ""}
           ${
             config.isCompact
               ? `data-wheel-compact-item="true"`
               : `data-wheel-item="true"`
           }
           style="
             ${cursorStyle}
             padding: ${showCards ? config.cardPadding : "4px"};
             border-radius: ${showCards ? "10px" : "6px"};
             background: ${itemBg};
             border: ${borderStyle};
             ${backdropBlur}
             opacity: ${initStyle.opacity};
             transform: scale(${initStyle.scale}) rotateX(${initStyle.rotateX}deg);
             z-index: ${initStyle.zIndex};
             min-height: ${config.itemHeight}px;
             height: ${config.itemHeight}px;
             box-shadow: ${isBgBlack ? "0 1px 4px rgba(255,255,255,0.08)" : "0 1px 3px rgba(0,0,0,0.1)"};
             margin-top: ${idx === 0 ? "0" : `-${Math.round(config.itemHeight * 0.35)}px`};
           ">
        ${renderWheelItemTitle(item.title, config, titleColor)}
        <div class="wheel-item-body">
          ${renderItemPreview(item, {
            previewSize: config.previewSize,
            bgColor,
            ...matrixOptions,
          })}
        </div>
      </div>
    `;
    })
    .join("");
}

/**
 * Render wheel item title (visible or hover-only based on mode)
 * @private
 */
function renderWheelItemTitle(title, config, titleColor = "") {
  if (!title) return "";

  if (config.showTitle) {
    // Default mode: always visible title
    return `
      <div class="wheel-item-title" style="font-size: ${config.titleFontSize}; margin-bottom: ${config.titleMargin}; ${titleColor}">${title}</div>
    `;
  } else {
    // Compact mode: hover-only tooltip
    return `
      <div class="wheel-item-title-hover">${title}</div>
    `;
  }
}

/**
 * Render wheel navigation buttons
 * @private
 */
function renderWheelNavButtons(options) {
  if (options.wheelNavPosition === "none") {
    return "";
  }

  const isSideLayout = options.wheelNavPosition === "sides";

  // Nav-button shape (shared selector appearance axis); default keeps the
  // historical circular look when no shape is passed. Layout and look:
  // galleryDisplayStyles (data-wheel-nav-layout).
  const navRadius =
    { square: "0", rounded: "8px", round: "50%" }[options.navButtonShape] ||
    WHEEL_MODE.BUTTON.BORDER_RADIUS;

  return `
    <div class="wheel-nav-buttons" data-wheel-nav-layout="${options.wheelNavPosition || "bottom"}">
      <button class="wheel-nav-down" data-wheel-nav="${isSideLayout ? "up" : "down"}" title="Previous" style="border-radius: ${navRadius};">‹</button>
      <button class="wheel-nav-up" data-wheel-nav="${isSideLayout ? "down" : "up"}" title="Next" style="border-radius: ${navRadius};">›</button>
    </div>
  `;
}

/**
 * Toggle the `data-favourite` star badge on every `[data-mode]` item in root.
 * Shared by the Clock and Native Effects cards: called after each render and
 * whenever the favourites list changes (controller notification).
 */
export function markFavouriteModes(
  root,
  favourites,
  colorMode = "normal",
  color,
) {
  if (!root) return;
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
  root.querySelectorAll("[data-mode]").forEach((node) => {
    if (marked.has(node.dataset.mode))
      node.setAttribute("data-favourite", "true");
    else node.removeAttribute("data-favourite");
  });
  root
    .querySelectorAll("[data-mode-select] option[value]")
    .forEach((option) => {
      option.dataset.favouriteLabel ??= option.textContent.replace(
        /^\u2605 /,
        "",
      );
      option.textContent = `${marked.has(option.value) ? "\u2605 " : ""}${option.dataset.favouriteLabel}`;
    });
}

/**
 * The markup of `items` in a preview layout: "list" (also the 2-column
 * grid, styled by the shell), "strip" or "wheel" (selectorDisplayMode).
 * @returns {string} HTML string
 */
export function renderGalleryDisplay(items, displayMode = "list", options = {}) {
  if (displayMode === "strip") return renderStripMode(items, options);
  if (displayMode === "wheel") return renderWheelMode(items, options);
  return renderGalleryMode(items, options);
}

/**
 * Render the shared "Original" browser gallery: a grid or list of preview
 * tiles, each with a name and an optional capability badge.  Used by both the
 * Native Effects and Clock cards so their Original browsers look and behave
 * identically.  Each card supplies its own `previewHtml` (animated matrix
 * markup) plus `title` and `badge`.
 *
 * @param {Array} items - [{ dataMode, title, badge, previewHtml }]
 * @param {Object} options - { view: "grid"|"list", showBadges, current }
 * @returns {string} HTML string
 */
export function renderOriginalGallery(items, options = {}) {
  const view = options.view === "list" ? "list" : "grid";
  const showBadges = options.showBadges !== false;
  return `<div class="original-gallery ${view}">
    ${(items || [])
      .map((item) => {
        const selected =
          options.current != null && item.dataMode === options.current;
        const highlighted = options.highlight !== false && selected;
        return `<button
          class="original-item"
          type="button"
          data-mode="${escapeHtml(item.dataMode)}"
          aria-label="${escapeHtml(item.title)}"
          aria-pressed="${selected ? "true" : "false"}"
          ${highlighted ? 'data-active-mode="true"' : ""}
          title="${escapeHtml(item.title)}">
          ${item.previewHtml || ""}
          <span class="original-item-name">${escapeHtml(item.title)}</span>
          ${showBadges && item.badge ? `<span class="original-item-badge">${escapeHtml(item.badge)}</span>` : ""}
        </button>`;
      })
      .join("")}
  </div>`;
}

/** Bind click handlers for the shared Original browser gallery. */
export function bindOriginalGallery(root, { select }) {
  root.querySelectorAll(".original-item[data-mode]").forEach((node) => {
    node.onclick = () => select(node.dataset.mode);
  });
}

/**
 * CSS styles for gallery display (to be imported into card styles)
 */
export const galleryDisplayStyles = `
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
     size. markFavouriteModes sets data-favourite on each [data-mode] item.
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
     transform and z-index are inline, written by wheel-navigation-utils.js. */
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
  /* Compact wheel: the title shows on hover (wheel-navigation-utils.js). */
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
