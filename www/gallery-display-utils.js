import { BLACK_THRESHOLD } from "./draw_card_const.js";

/**
 * Shared utility for rendering gallery/preview display modes
 * Used by draw card (pixel arts), gradient card (gradient previews), and color list card
 */

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

  // Button styling
  BUTTON: {
    SIZE: "48px",
    FONT_SIZE: "2em",
    BORDER_RADIUS: "50%",
    BACKGROUND: "var(--card-background-color, #FFF)",
    BORDER: "1px solid var(--divider-color, rgba(0,0,0,0.1))",
    BOX_SHADOW: "0 4px 12px rgba(0,0,0,0.15)",
    GAP: "18px",
  },

  // Animation
  TRANSITION: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
  CONTAINER_TRANSITION: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
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
  } = options;

  const matrixShadowStyle = matrixBoxShadow
    ? "box-shadow: 0 2px 8px rgba(0,0,0,0.5);"
    : "";

  const pixelShadowStyle = pixelBoxShadow ? "box-shadow: 0 0 2px #0008;" : "";

  const borderRadius =
    pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0";

  // Use aspect-ratio for grid mode to preserve correct shape
  // If previewSize is set, use width/height as fallback for gallery/inline
  const aspectRatioStyle = options.forceAspectRatio
    ? `aspect-ratio: ${cols} / ${rows}; width: 100%; height: auto;`
    : `width: ${previewSize}px; height: ${previewSize * (rows / cols)}px;`;

  return `
    <div class="gallery-matrix-preview" style="
      display: grid;
      grid-template-columns: repeat(${cols}, 1fr);
      gap: ${pixelGap}px;
      background: ${bgColor};
      padding: ${pixelGap * 2}px;
      border-radius: 4px;
      max-width: 100%;
      box-sizing: border-box;
      ${aspectRatioStyle}
      ${matrixShadowStyle}
    ">${colorData
      .map((color) => {
        // Handle both RGB arrays and hex strings
        let bgColor;
        let isBlack = false;

        if (Array.isArray(color)) {
          // RGB array format [r, g, b]
          isBlack =
            color[0] <= BLACK_THRESHOLD &&
            color[1] <= BLACK_THRESHOLD &&
            color[2] <= BLACK_THRESHOLD;
          bgColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        } else {
          // Hex string format "#RRGGBB"
          const hex = (color || "#000000").replace(/^#/, "");
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          isBlack =
            r <= BLACK_THRESHOLD &&
            g <= BLACK_THRESHOLD &&
            b <= BLACK_THRESHOLD;
          bgColor = color || "#000000";
        }

        const shouldIgnore = ignoreBlackPixels && isBlack;

        return `<div style="
            background: ${shouldIgnore ? "transparent" : bgColor};
            border-radius: ${borderRadius};
            ${shouldIgnore ? "" : pixelShadowStyle}
          "></div>`;
      })
      .join("")}
    </div>
  `;
}

/**
 * Render items in gallery mode (responsive grid)
 * @param {Array} items - Array of item objects with { title, colorData, metadata, onClick }
 * @param {Object} options - Display options
 * @returns {string} HTML string
 */
export function renderGalleryMode(items, options = {}) {
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
    <div class="gallery-display-grid" style="
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(${previewSize + 60}px, 100%), 1fr));
      gap: 12px;
      align-items: start;
      max-width: 100%;
      box-sizing: border-box;
      padding: 4px;
    ">
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
             style="
               ${cursorStyle}
               padding: ${showCards ? "12px" : "6px"};
               border-radius: 8px;
               background: ${itemBg};
               border: ${
                 showCards ? "1px solid var(--divider-color, #e0e0e0)" : "none"
               };
               transition: all 0.2s ease;
               max-width: 100%;
               box-sizing: border-box;
               overflow: hidden;
             ">${
               showTitles && item.title
                 ? `<div class="gallery-item-title" style="
                 font-size: ${getTitleFontSize(previewSize)}px;
                 text-align: center;
                 margin-bottom: 6px;
                 white-space: nowrap;
                 overflow: hidden;
                 text-overflow: ellipsis;
                 font-weight: 500;
                 ${titleColor}
               ">${item.title}</div>`
                 : ""
             }
          <div style="display: flex; justify-content: center;">
            ${renderMatrixPreview(item.colorData, {
              previewSize,
              bgColor,
              ...matrixOptions,
            })}
          </div>
          ${
            item.metadata
              ? `<div class="gallery-item-metadata" style="
                 font-size: ${getMetadataFontSize(previewSize)}px;
                 text-align: center;
                 margin-top: 4px;
                 color: var(--secondary-text-color, #666);
               ">${item.metadata}</div>`
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
 * Render items in grid mode (fixed columns, uniform sizing)
 * @param {Array} items - Array of item objects
 * @param {Object} options - Display options
 * @returns {string} HTML string
 */
export function renderGridMode(items, options = {}) {
  const {
    columns = 3,
    previewSize = 200,
    showCards = true,
    showTitles = true,
    onClickEnabled = true,
    forceAspectRatio = false,
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
    <div class="gallery-display-grid" style="
      display: grid;
      grid-template-columns: repeat(${columns}, 1fr);
      gap: 10px;
      max-width: 100%;
      box-sizing: border-box;
      padding: 4px;
    ">
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
             style="
               ${cursorStyle}
               padding: ${showCards ? "10px" : "6px"};
               border-radius: 8px;
               background: ${itemBg};
               border: ${
                 showCards ? "1px solid var(--divider-color, #e0e0e0)" : "none"
               };
               transition: all 0.2s ease;
               max-width: 100%;
               box-sizing: border-box;
               overflow: hidden;
             ">${
               showTitles && item.title
                 ? `<div class="gallery-item-title" style="
                 font-size: ${getTitleFontSize(previewSize)}px;
                 text-align: center;
                 margin-bottom: 4px;
                 white-space: nowrap;
                 overflow: hidden;
                 text-overflow: ellipsis;
                 font-weight: 500;
                 ${titleColor}
               ">${item.title}</div>`
                 : ""
             }
          <div style="display: flex; justify-content: center;">
            ${renderMatrixPreview(item.colorData, {
              previewSize,
              bgColor,
              ...matrixOptions,
              forceAspectRatio,
            })}
          </div>
          ${
            item.metadata
              ? `<div class="gallery-item-metadata" style="
                 font-size: ${getMetadataFontSize(previewSize)}px;
                 text-align: center;
                 margin-top: 3px;
                 color: var(--secondary-text-color, #666);
               ">${item.metadata}</div>`
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
 * Render items in compact mode (horizontal inline list)
 * @param {Array} items - Array of item objects
 * @param {Object} options - Display options
 * @returns {string} HTML string
 */
export function renderCompactMode(items, options = {}) {
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

  return `
    <div class="gallery-display-compact" style="
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: center;
      max-width: 100%;
      box-sizing: border-box;
      padding: 4px;
    ">
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
             style="
               ${cursorStyle}
               display: inline-flex;
               flex-direction: column;
               align-items: center;
               gap: 4px;
               padding: ${showCards ? "6px" : "2px"};
               border-radius: ${showCards ? "6px" : "4px"};
               background: ${itemBg};
               border: ${showCards ? "1px solid var(--divider-color, #e0e0e0)" : "none"};
               transition: all 0.2s ease;
               max-width: 100%;
               box-sizing: border-box;
             ">${renderMatrixPreview(item.colorData, {
               previewSize,
               bgColor,
               ...matrixOptions,
             })}
          ${
            showTitles && item.title
              ? `<div class="gallery-item-title" style="
                 font-size: ${getTitleFontSize(previewSize)}px;
                 text-align: center;
                 max-width: ${previewSize}px;
                 white-space: nowrap;
                 overflow: hidden;
                 text-overflow: ellipsis;
                 font-weight: 500;
                 ${titleColor}
               ">${item.title}</div>`
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
 * Render items in inline mode (simple 2-column grid, original gradient card style)
 * @param {Array} items - Array of item objects
 * @param {Object} options - Display options
 * @returns {string} HTML string
 */
export function renderInlineMode(items, options = {}) {
  const {
    columns = 2,
    previewSize = 200,
    showTitles = true,
    onClickEnabled = true,
    ...matrixOptions
  } = options;

  const cursorStyle = onClickEnabled ? "cursor: pointer;" : "";

  return `
    <div class="gallery-display-inline" style="
      display: grid;
      grid-template-columns: repeat(${columns}, 1fr);
      gap: 12px;
      max-width: 100%;
      box-sizing: border-box;
    ">
      ${items
        .map(
          (item, idx) => `
        <div class="gallery-item" 
             data-idx="${idx}"
             ${item.dataMode ? `data-mode="${item.dataMode}"` : ""}
             ${item.title ? `title="${item.title}"` : ""}
             style="
               ${cursorStyle}
               padding: 8px;
               border-radius: 4px;
               background: rgba(255,255,255,0.05);
               transition: all 0.2s;
               max-width: 100%;
               box-sizing: border-box;
               overflow: hidden;
             ">${
               showTitles && item.title
                 ? `<div class="gallery-item-title" style="
                 font-size: ${getTitleFontSize(previewSize)}px;
                 text-align: center;
                 margin-bottom: 4px;
                 white-space: nowrap;
                 overflow: hidden;
                 text-overflow: ellipsis;
               ">${item.title}</div>`
                 : ""
             }
          <div style="display: flex; justify-content: center;">
            ${renderMatrixPreview(item.colorData, {
              ...matrixOptions,
              forceAspectRatio: true,
            })}
          </div>
        </div>
      `,
        )
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
    <div class="wheel-display" ${matrixOptions.bgColor === "transparent" ? 'data-bg-transparent="true"' : ""} style="
      position: relative;
      width: 100%;
      max-width: ${outerMaxWidth}px;
      margin: 0 auto;
      height: ${wheelHeight}px;
      overflow: visible;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      box-sizing: border-box;
    ">
      <!-- Inner clipping viewport - clips top/bottom overflow only -->
      <div class="wheel-clip-viewport" style="
        position: absolute;
        top: 0;
        left: -16px;
        right: -16px;
        bottom: 0;
        overflow: hidden;
        pointer-events: none;
        padding: 0 16px;
      ">
        <!-- Scrollable wheel container -->
        <div class="wheel-scroll-container" data-wheel-scroll="true"
          data-wheel-item-height="${config.itemHeight}"
          data-wheel-item-step="${itemStep}"
          data-wheel-container-height="${wheelHeight}"
          data-wheel-padding-top="${paddingTop}"
          style="
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0px;
          padding: ${paddingTop}px 0;
          transition: ${WHEEL_MODE.CONTAINER_TRANSITION};
          transform: translateY(-${initialOffset}px);
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          pointer-events: auto;
          max-width: ${cardMaxWidth}px;
          margin: 0 auto;
          cursor: grab;
        ">
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
             transition: ${WHEEL_MODE.TRANSITION};
             opacity: ${initStyle.opacity};
             transform: scale(${initStyle.scale}) rotateX(${initStyle.rotateX}deg);
             z-index: ${initStyle.zIndex};
             transform-origin: center center;
             max-width: 90%;
             width: 100%;
             min-height: ${config.itemHeight}px;
             height: ${config.itemHeight}px;
             box-sizing: border-box;
             overflow: hidden;
             box-shadow: ${isBgBlack ? "0 1px 4px rgba(255,255,255,0.08)" : "0 1px 3px rgba(0,0,0,0.1)"};
             backface-visibility: hidden;
             -webkit-backface-visibility: hidden;
             position: relative;
             flex-shrink: 0;
             display: flex;
             flex-direction: column;
             justify-content: center;
             margin-top: ${idx === 0 ? "0" : `-${Math.round(config.itemHeight * 0.35)}px`};
           ">
        ${renderWheelItemTitle(item.title, config, titleColor)}
        <div style="
          display: flex; 
          justify-content: center; 
          align-items: center; 
          ${config.isCompact ? "width: 100%; height: 100%;" : "flex: 1;"}
        ">
          ${renderMatrixPreview(item.colorData, {
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
      <div class="wheel-item-title" style="
        font-size: ${config.titleFontSize};
        text-align: center;
        margin-bottom: ${config.titleMargin};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 600;
        ${titleColor}
      ">${title}</div>
    `;
  } else {
    // Compact mode: hover-only tooltip
    return `
      <div class="wheel-item-title-hover" style="
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
      ">${title}</div>
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
  const { BUTTON } = WHEEL_MODE;

  const containerStyle = isSideLayout
    ? `
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      justify-content: space-between;
      width: calc(100% + 24px);
      left: -12px;
    `
    : `
      bottom: 14px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: ${BUTTON.GAP};
    `;

  const buttonRotation = isSideLayout ? "" : "transform: rotate(-90deg);";

  return `
    <div class="wheel-nav-buttons" 
         data-wheel-nav-layout="${options.wheelNavPosition || "bottom"}" 
         style="
           position: absolute;
           ${containerStyle}
           z-index: 10;
           pointer-events: none;
         ">
      <button class="wheel-nav-down" 
              data-wheel-nav="${isSideLayout ? "up" : "down"}" 
              title="Previous"
              style="
                background: ${BUTTON.BACKGROUND};
                border: ${BUTTON.BORDER};
                border-radius: ${BUTTON.BORDER_RADIUS};
                width: ${BUTTON.SIZE};
                height: ${BUTTON.SIZE};
                cursor: pointer;
                font-size: ${BUTTON.FONT_SIZE};
                color: var(--primary-text-color, #333);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                box-shadow: ${BUTTON.BOX_SHADOW};
                pointer-events: auto;
                user-select: none;
                margin: 0;
                padding: 0 2px 6px 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                ${buttonRotation}
              ">‹</button>
      <button class="wheel-nav-up" 
              data-wheel-nav="${isSideLayout ? "down" : "up"}" 
              title="Next"
              style="
                background: ${BUTTON.BACKGROUND};
                border: ${BUTTON.BORDER};
                border-radius: ${BUTTON.BORDER_RADIUS};
                width: ${BUTTON.SIZE};
                height: ${BUTTON.SIZE};
                cursor: pointer;
                font-size: ${BUTTON.FONT_SIZE};
                color: var(--primary-text-color, #333);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                box-shadow: ${BUTTON.BOX_SHADOW};
                pointer-events: auto;
                user-select: none;
                margin: 0;
                padding: 0 0 6px 2px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                ${buttonRotation}
              ">›</button>
    </div>
  `;
}

/**
 * Main render function - dispatches to appropriate mode renderer
 * @param {Array} items - Array of item objects
 * @param {string} displayMode - "list", "gallery" (legacy alias for list), "grid", "compact", "inline" (legacy alias for grid), or "wheel"
 * @param {Object} options - Display options
 * @returns {string} HTML string
 */
export function renderGalleryDisplay(
  items,
  displayMode = "list",
  options = {},
) {
  switch (displayMode) {
    case "list":
    case "gallery": // Legacy alias used by draw-card / palette-card
    case "grid": // Removed mode – falls back to list
    case "inline": // Legacy alias for "grid"
      return renderGalleryMode(items, options);
    case "compact":
      return renderCompactMode(items, options);
    case "wheel":
      return renderWheelMode(items, options);
    default:
      return renderGalleryMode(items, options);
  }
}

/**
 * CSS styles for gallery display (to be imported into card styles)
 */
export const galleryDisplayStyles = `
  .gallery-item-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    border-color: var(--primary-color, #03a9f4);
  }

  .gallery-compact-item:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transform: scale(1.05);
  }

  .gallery-display-inline .gallery-item:hover {
    background: rgba(255,255,255,0.1);
  }

  .gallery-matrix-preview {
    user-select: none;
    pointer-events: none;
  }

  /* ========================================
     WHEEL MODE STYLES - Independent from gallery
     ======================================== */
  
  .wheel-display {
    user-select: none;
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

  /* Wheel centered border - only when highlight_active_mode is ON */
  :host([data-highlight-active="true"]) .wheel-item[data-wheel-centered="true"] {
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
     — Only border / outline / shadow — never override background
       so the user's chosen Preview Background Color is preserved.
     ======================================== */

  /* Gallery / Grid / List mode: card style */
  .gallery-item-card[data-active-mode="true"] {
    border-color: var(--primary-color, #03a9f4) !important;
    box-shadow: 0 0 0 1px var(--primary-color, #03a9f4), 0 2px 8px rgba(3, 169, 244, 0.25) !important;
  }

  /* Gallery / Grid / List mode: plain (no-card) style */
  .gallery-item-plain[data-active-mode="true"] {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
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
    box-shadow: 0 0 0 1px var(--primary-color, #03a9f4), 0 2px 8px rgba(3, 169, 244, 0.25) !important;
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
