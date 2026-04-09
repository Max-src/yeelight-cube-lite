/**
 * Album View with Coverflow Effect
 *
 * This module provides a carousel/album view with 3D coverflow effect for displaying
 * palettes and pixel arts. It's used by both the palette card and draw card.
 *
 * Key Features:
 * - 3D coverflow carousel with smooth transitions
 * - Supports both palette items and pixel art items
 * - Configurable delete/remove buttons
 * - Touch and keyboard navigation support
 * - Position persistence across re-renders
 *
 * Usage:
 * 1. Import renderAlbumView() and setupAlbumNavigation()
 * 2. Call renderAlbumView() to generate HTML
 * 3. Call setupAlbumNavigation() to attach event listeners
 *
 * Configuration:
 * - Palette cards use: config.remove_button_style
 * - Draw cards use: config.pixel_art_remove_button_style
 *
 * Pure JavaScript - no external dependencies
 */

import { getDeleteButtonClass } from "./delete-button-styles.js";

export function getAlbumStyles(config = {}, classPrefix = "album") {
  const removeButtonStyle = config.album_remove_button_style || "outside";
  const cardRounded = config.album_card_rounded !== false;
  const enable3D = config.album_3d_effect !== false;
  const borderRadius = cardRounded ? "16px" : "0";

  return `
    .${classPrefix}-album-wrapper {
      position: relative;
      width: 100%;
      margin-bottom: 16px;
    }
    
    .${classPrefix}-album-container {
      min-height: 200px;
      max-height: 500px;
      /* padding: 40px 0; */
      padding: 12px 0;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      perspective: ${enable3D ? "1200px" : "none"};
      perspective-origin: center center;
      overflow: hidden;
    }
    
    .${classPrefix}-album-item {
      width: 240px;
      max-height: 420px;
      cursor: pointer;
      background: var(--card-background-color, white);
      border-radius: ${borderRadius};
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      overflow: ${removeButtonStyle === "inside" ? "hidden" : "visible"};
      position: absolute;
      left: 50%;
      top: 50%;
      margin-left: -120px;
      transform: translateY(-50%);
      transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      transform-style: preserve-3d;
      backface-visibility: hidden;
    }
    
    .album-card {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: ${borderRadius};
    }
    
    .album-gradient {
      height: 60%;
      position: relative;
    }
    
    .album-content {
      padding: 12px;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    
    .album-title {
      font-weight: 600;
      color: var(--primary-text-color, #333);
      font-size: 0.9em;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .album-meta {
      font-size: 0.75em;
      color: var(--secondary-text-color, #666);
    }
    
    .${classPrefix}-album-item .delete-btn-cross,
    .${classPrefix}-album-item .album-remove-btn {
      position: absolute;
      top: ${removeButtonStyle === "inside" ? "6px" : "-8px"};
      right: ${removeButtonStyle === "inside" ? "6px" : "-8px"};
      z-index: 15;
      transition: opacity 0.3s ease;
      background: ${
        removeButtonStyle === "inside"
          ? "transparent"
          : "var(--card-background-color, rgba(255,255,255,0.95))"
      };
      border: ${removeButtonStyle === "inside" ? "none" : "2px solid var(--divider-color, #e0e0e0)"};
      border-radius: ${removeButtonStyle === "square" ? "0" : "50%"};
      box-shadow: ${
        removeButtonStyle === "inside" ? "none" : "0 2px 8px rgba(0,0,0,0.15)"
      };
      width: ${removeButtonStyle === "inside" ? "auto" : "28px"};
      height: ${removeButtonStyle === "inside" ? "auto" : "28px"};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: ${removeButtonStyle === "inside" ? "2.2em" : "1.5em"};
      font-weight: bold;
      color: var(--error-color, #ff4444);
      cursor: pointer;
    }

    /* 
     * Album Mode Button Visibility Rules
     * 
     * In album/carousel mode, delete buttons have special visibility logic:
     * 1. Non-active (side) cards: buttons always hidden
     * 2. Active (center) card: buttons always visible
     * 
     * The !important flags ensure these rules override base button styles
     */

    /* Rule 1: Hide buttons on all non-active (side) cards */
    .${classPrefix}-album-item:not(.active) .delete-btn-cross,
    .${classPrefix}-album-item:not(.active) .album-remove-btn {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    
    .${classPrefix}-album-item .delete-btn-cross:hover,
    .${classPrefix}-album-item .album-remove-btn:hover {
      color: var(--error-color, #cc0000);
      background: ${
        removeButtonStyle === "inside"
          ? "rgba(255,255,255,0.1)"
          : "var(--card-background-color, #fff)"
      };
    }
    
    ${
      removeButtonStyle === "inside"
        ? `
    /* VISUAL TUNING - Album view specific size adjustments (not duplicates) */
    /* Red/black buttons: 26px (smaller than default 28px) for tighter spacing in album cards */
    .${classPrefix}-album-item .delete-btn-cross.red-style,
    .${classPrefix}-album-item .album-remove-btn.red-style {
      width: 26px !important;
      height: 26px !important;
    }
    
    .${classPrefix}-album-item .delete-btn-cross.black-style,
    .${classPrefix}-album-item .album-remove-btn.black-style {
      width: 26px !important;
      height: 26px !important;
    }
    
    .${classPrefix}-album-item .delete-btn-cross.trash-style,
    .${classPrefix}-album-item .album-remove-btn.trash-style {
      width: auto !important;
      height: auto !important;
      background: transparent !important;
      border: none !important;
      font-size: 0 !important;
    }
    
    .${classPrefix}-album-item .delete-btn-cross.trash-style::before,
    .${classPrefix}-album-item .album-remove-btn.trash-style::before {
      font-size: 22px !important;
    }
    `
        : ""
    }
    
    .album-nav-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 48px;
      height: 48px;
      background: var(--card-background-color, #FFF);
      border: 1px solid rgba(0,0,0,0.1);
      border-radius: 50%;
      cursor: pointer;
      font-size: 2em;
      color: var(--primary-text-color, #333);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: all 0.2s;
      user-select: none;
    }
    
    .album-nav-btn:hover {
      background: var(--card-background-color, white);
      box-shadow: 0 6px 16px rgba(0,0,0,0.2);
      color: var(--primary-text-color, #000);
    }
    
    .album-nav-btn:active {
      transform: translateY(-50%) scale(0.95);
    }
    
    .album-nav-prev {
      left: 20px;
    }
    
    .album-nav-next {
      right: 20px;
    }
  `;
}

/**
 * Renders the HTML for an album/carousel view
 *
 * @param {Array} items - Array of items to display (palettes or pixel arts)
 * @param {Function} renderItemContent - Function to render each item's content
 * @param {Object} config - Configuration object containing card settings
 * @param {string} classPrefix - CSS class prefix ("palettes" or "pixelarts")
 * @returns {string} HTML string for the album view
 *
 * Button Visibility Logic:
 * - If setting is "none", no delete button is rendered
 * - Album mode only shows buttons on the active (centered) card
 */
export function renderAlbumView(
  items,
  renderItemContent,
  config = {},
  classPrefix = "album",
) {
  // Determine button style (supports both palette and pixel art configs)
  const removeButtonStyle =
    config.remove_button_style ||
    config.pixel_art_remove_button_style ||
    "default";
  const showRemove = removeButtonStyle !== "none";

  // Build button CSS classes
  const deleteBtnClass = getDeleteButtonClass(removeButtonStyle);

  return `
    <div class="${classPrefix}-album-wrapper">
      <button class="album-nav-btn album-nav-prev" id="${classPrefix}-album-nav-prev" title="Previous">‹</button>
      <button class="album-nav-btn album-nav-next" id="${classPrefix}-album-nav-next" title="Next">›</button>
      <div class="${classPrefix}-album-container" id="${classPrefix}-album-container">
        ${items
          .map((item, idx) => {
            const itemContent = renderItemContent(item, idx, config);
            return `
            <div class="${classPrefix}-album-item" data-idx="${idx}">
              <div class="album-card">
                ${
                  showRemove
                    ? `<button class="${deleteBtnClass} album-remove-btn" data-idx="${idx}" title="Remove">×</button>`
                    : ""
                }
                ${itemContent}
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    </div>
  `;
}

export async function setupAlbumNavigation(
  shadowRoot,
  classPrefix,
  onItemClick,
  onItemRemove,
  context,
) {
  if (!shadowRoot) return;

  const container = shadowRoot.getElementById(`${classPrefix}-album-container`);
  const prevBtn = shadowRoot.getElementById(`${classPrefix}-album-nav-prev`);
  const nextBtn = shadowRoot.getElementById(`${classPrefix}-album-nav-next`);

  if (!container) return;

  // Clean up old event listeners if re-initializing
  if (context._coverflowCleanup) {
    context._coverflowCleanup();
  }

  // Initialize position
  if (typeof context._currentAlbumIndex !== "number") {
    context._currentAlbumIndex = 0;
  }

  const items = Array.from(
    container.querySelectorAll(`.${classPrefix}-album-item`),
  );
  let currentIndex = context._currentAlbumIndex;

  // Clamp index to valid range after re-render
  currentIndex = Math.max(0, Math.min(currentIndex, items.length - 1));
  context._currentAlbumIndex = currentIndex;

  // Coverflow update function
  const updateCoverflow = (skipAnimation = false) => {
    // Temporarily disable transitions if requested
    if (skipAnimation) {
      items.forEach((item) => (item.style.transition = "none"));
    }

    items.forEach((item, idx) => {
      const offset = idx - currentIndex;
      const absOffset = Math.abs(offset);

      let transform = "";
      let zIndex = 100 - absOffset;

      if (offset === 0) {
        // Active center item
        transform =
          "translateY(-50%) translateX(0) translateZ(0) rotateY(0deg) scale(1)";
        zIndex = 200;
        item.classList.add("active");
      } else {
        item.classList.remove("active");
        if (offset < 0) {
          // Items on the left
          const angle = 45;
          const translateX = -150 * absOffset;
          const translateZ = -100 * absOffset;
          transform = `translateY(-50%) translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${angle}deg) scale(0.7)`;
        } else {
          // Items on the right
          const angle = -45;
          const translateX = 150 * absOffset;
          const translateZ = -100 * absOffset;
          transform = `translateY(-50%) translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${angle}deg) scale(0.7)`;
        }
      }

      item.style.transform = transform;
      item.style.zIndex = zIndex;
      item.style.opacity = absOffset > 3 ? "0" : "1";
    });

    // Re-enable transitions after instant update
    if (skipAnimation) {
      // Force reflow to ensure styles are applied
      void items[0]?.offsetHeight;
      items.forEach((item) => (item.style.transition = ""));
    }

    context._currentAlbumIndex = currentIndex;
  };

  // Navigation
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (currentIndex > 0) {
        currentIndex--;
        updateCoverflow();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (currentIndex < items.length - 1) {
        currentIndex++;
        updateCoverflow();
      }
    });
  }

  // Item clicks
  items.forEach((item, idx) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".album-remove-btn")) return;

      if (idx === currentIndex) {
        onItemClick(idx);
      } else {
        currentIndex = idx;
        updateCoverflow();
      }
    });
  });

  // Delete buttons
  container.querySelectorAll(".album-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();

      const dataIdx = parseInt(btn.dataset.idx, 10);
      if (isNaN(dataIdx)) return;

      const item = btn.closest(`.${classPrefix}-album-item`);
      if (!item) return;

      // Animate item removal (fade out + scale down)
      item.style.transition = "opacity 0.3s, transform 0.3s";
      item.style.opacity = "0";
      item.style.transform += " scale(0.5)";
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Adjust current index if needed
      if (dataIdx < currentIndex) {
        currentIndex--;
      } else if (dataIdx === currentIndex && currentIndex > 0) {
        currentIndex--;
      }

      // Remove from DOM
      item.remove();
      const itemIndex = items.findIndex((i) => i === item);
      if (itemIndex !== -1) items.splice(itemIndex, 1);

      // Update coverflow position
      currentIndex = Math.max(0, Math.min(currentIndex, items.length - 1));
      context._currentAlbumIndex = currentIndex;
      updateCoverflow();

      // Call backend to delete (will update sensor → trigger parent re-render → album re-setup)
      onItemRemove(dataIdx);
    });
  });

  // Store cleanup function to remove listeners on re-init
  const prevHandler = prevBtn?._coverflowHandler;
  const nextHandler = nextBtn?._coverflowHandler;

  context._coverflowCleanup = () => {
    if (prevBtn && prevHandler)
      prevBtn.removeEventListener("click", prevHandler);
    if (nextBtn && nextHandler)
      nextBtn.removeEventListener("click", nextHandler);
  };

  // Store handlers for cleanup
  if (prevBtn) prevBtn._coverflowHandler = prevBtn.onclick;
  if (nextBtn) nextBtn._coverflowHandler = nextBtn.onclick;

  // Initial render (skip animation if this is a re-setup after deletion)
  const isReSetup = context._coverflowCleanup !== undefined;
  updateCoverflow(isReSetup);
}
