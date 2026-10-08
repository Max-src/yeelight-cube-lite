/**
 * Album View with Coverflow Effect
 *
 * The Album layout of the shared gallery (collection-gallery.js): a 3D
 * coverflow of the items, with arrows, swipes and a click on the centred
 * item to pick it. Items' rename / delete controls are the gallery's
 * (shown on the centred item only, see collectionGalleryStyles).
 *
 * Usage:
 * 1. Import renderAlbumView() and setupAlbumNavigation()
 * 2. Call renderAlbumView() to generate HTML
 * 3. Call setupAlbumNavigation() once per album node to attach event
 *    listeners; it resolves to { goTo(index) } to turn the album later
 *
 * Styles: albumStyles(classPrefix) is static (include it in the card's static
 * styles); the configurable values (card width from card_size, corner radius
 * from rounded_cards, 3D effect) are CSS variables that renderAlbumView()
 * sets on the album wrapper (albumStyleVars).
 *
 * Configuration:
 * - album_nav_shape: the arrows' shape, in the carousel vocabulary
 *   (circle by default; square, rect)
 * - wrap_navigation (setupAlbumNavigation): the arrows and swipes go from
 *   the last item to the first and back
 *
 * Pure JavaScript - no external dependencies
 */

import { normalizeButtonShape } from "./carousel-utils.js";
import { roundedCardsRadius } from "./card-config.js";

/**
 * The album's configurable values as CSS variables (inline style of the
 * album wrapper): --yc-album-width, --yc-album-radius, --yc-album-pad,
 * --yc-album-perspective.
 */
export function albumStyleVars(config = {}) {
  // Card width: `card_size` % of the 240px baseline (the gallery derives it
  // from its Size), within 30-200% so the coverflow never collapses.
  const albumSizePct = Math.max(
    30,
    Math.min(200, Number(config.card_size) || 100),
  );
  return [
    `--yc-album-width:${Math.round((240 * albumSizePct) / 100)}px`,
    `--yc-album-radius:${roundedCardsRadius(config.rounded_cards)}px`,
    // Room above the cards for the items' outside delete buttons.
    "--yc-album-pad:28px 14px",
    `--yc-album-perspective:${config.album_3d_effect !== false ? "1200px" : "none"}`,
  ].join(";");
}

/** The album CSS for items of `classPrefix` (static; see albumStyleVars). */
export function albumStyles(classPrefix = "album") {
  return `
    .${classPrefix}-album-wrapper {
      position: relative;
      width: 100%;
      margin-bottom: 16px;
    }
    
    .${classPrefix}-album-container {
      min-height: 200px;
      max-height: 500px;
      padding: var(--yc-album-pad, 28px 14px);
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      perspective: var(--yc-album-perspective, 1200px);
      perspective-origin: center center;
      overflow: hidden;
    }
    
    .${classPrefix}-album-item {
      /* The configured width, kept clear of the arrows (2 x 20px + 48px)
         on narrow cards; 140px at least. */
      --yc-album-card: max(140px, min(var(--yc-album-width, 240px), 100% - 136px));
      width: var(--yc-album-card);
      max-height: 420px;
      cursor: pointer;
      background: var(--card-background-color, white);
      border-radius: var(--yc-album-radius, 16px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      overflow: visible;
      position: absolute;
      left: 50%;
      top: 50%;
      margin-left: calc(var(--yc-album-card) / -2);
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
      border-radius: var(--yc-album-radius, 16px);
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
    
    .album-nav-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 48px;
      height: 48px;
      background: var(--card-background-color, #FFF);
      border: 1px solid var(--divider-color, rgba(0,0,0,0.1));
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
    
    .album-nav-btn.nav-btn-rect,
    .album-nav-btn.nav-btn-rounded {
      border-radius: 8px;
    }

    .album-nav-btn.nav-btn-square {
      border-radius: 0;
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
 */
export function renderAlbumView(
  items,
  renderItemContent,
  config = {},
  classPrefix = "album",
) {
  const navClass = `album-nav-btn nav-btn-${normalizeButtonShape(
    config.album_nav_shape || "circle",
  )}`;

  return `
    <div class="${classPrefix}-album-wrapper" style="${albumStyleVars(config)}">
      <button class="${navClass} album-nav-prev" id="${classPrefix}-album-nav-prev" title="Previous">‹</button>
      <button class="${navClass} album-nav-next" id="${classPrefix}-album-nav-next" title="Next">›</button>
      <div class="${classPrefix}-album-container" id="${classPrefix}-album-container">
        ${items
          .map((item, idx) => {
            const itemContent = renderItemContent(item, idx, config);
            return `
            <div class="${classPrefix}-album-item" data-idx="${idx}">
              <div class="album-card">
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
  context,
  config = {},
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
  const enable3D = config.album_3d_effect !== false;
  const wrap = config.wrap_navigation === true;
  // The item `step` places away, past the ends only when wrapping.
  const stepTo = (step) => {
    const next = currentIndex + step;
    if (next >= 0 && next < items.length) return next;
    return wrap && items.length > 1 ? (next + items.length) % items.length : currentIndex;
  };

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
        if (enable3D) {
          // 3D coverflow: rotateY + translateZ for depth
          const angle = offset < 0 ? 45 : -45;
          const translateX = (offset < 0 ? -150 : 150) * absOffset;
          const translateZ = -100 * absOffset;
          transform = `translateY(-50%) translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${angle}deg) scale(0.7)`;
        } else {
          // Flat mode: no rotateY/translateZ to avoid stretching
          const translateX = (offset < 0 ? -150 : 150) * absOffset;
          transform = `translateY(-50%) translateX(${translateX}px) scale(0.7)`;
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

  // Touch swipe navigation on album container
  {
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swiping = false;

    container.addEventListener(
      "touchstart",
      (e) => {
        // Ignore if touching a button or delete control
        if (e.target.closest("button, .yc-item-action")) return;
        const touch = e.touches[0];
        swipeStartX = touch.clientX;
        swipeStartY = touch.clientY;
        swiping = false;
      },
      { passive: true },
    );

    container.addEventListener(
      "touchmove",
      (e) => {
        if (!e.touches[0] || swipeStartX === 0) return;
        const dx = e.touches[0].clientX - swipeStartX;
        const dy = Math.abs(e.touches[0].clientY - swipeStartY);
        if (Math.abs(dx) > 20 && Math.abs(dx) > dy * 1.5) {
          swiping = true;
          e.preventDefault();
        }
      },
      { passive: false },
    );

    container.addEventListener(
      "touchend",
      (e) => {
        if (!swiping) {
          swipeStartX = 0;
          return;
        }
        const touch = e.changedTouches[0];
        const dx = touch.clientX - swipeStartX;
        if (Math.abs(dx) > 50) {
          const next = stepTo(dx < 0 ? 1 : -1);
          if (next !== currentIndex) {
            currentIndex = next;
            updateCoverflow();
          }
        }
        swiping = false;
        swipeStartX = 0;
      },
      { passive: true },
    );
  }

  // Item clicks
  items.forEach((item, idx) => {
    item.addEventListener("click", (e) => {
      if (idx === currentIndex) {
        onItemClick(idx);
      } else {
        currentIndex = idx;
        updateCoverflow();
      }
    });
  });

  // Store named handler references for cleanup on re-init
  const step = (delta) => () => {
    const next = stepTo(delta);
    if (next !== currentIndex) {
      currentIndex = next;
      updateCoverflow();
    }
  };
  const prevClickHandler = prevBtn ? step(-1) : null;
  const nextClickHandler = nextBtn ? step(1) : null;

  // Replace anonymous listeners with named references we can remove
  if (prevBtn) {
    // Remove previous handler if stored
    if (prevBtn._coverflowHandler)
      prevBtn.removeEventListener("click", prevBtn._coverflowHandler);
    prevBtn.addEventListener("click", prevClickHandler);
    prevBtn._coverflowHandler = prevClickHandler;
  }
  if (nextBtn) {
    if (nextBtn._coverflowHandler)
      nextBtn.removeEventListener("click", nextBtn._coverflowHandler);
    nextBtn.addEventListener("click", nextClickHandler);
    nextBtn._coverflowHandler = nextClickHandler;
  }

  context._coverflowCleanup = () => {
    if (prevBtn && prevBtn._coverflowHandler)
      prevBtn.removeEventListener("click", prevBtn._coverflowHandler);
    if (nextBtn && nextBtn._coverflowHandler)
      nextBtn.removeEventListener("click", nextBtn._coverflowHandler);
  };

  // Initial render (skip animation if this is a re-setup after deletion)
  const isReSetup = context._coverflowCleanup !== undefined;
  updateCoverflow(isReSetup);

  // Lets the caller turn the album to an item (e.g. the newly active one)
  // without binding it again.
  return {
    goTo(index) {
      const next = Math.max(0, Math.min(index, items.length - 1));
      if (next === currentIndex) return;
      currentIndex = next;
      updateCoverflow();
    },
  };
}
