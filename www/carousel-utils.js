/**
 * Carousel Utilities - Reusable carousel rendering and navigation
 *
 * Extracted from yeelight-cube-draw-card.js to allow carousel functionality
 * to be reused across different modes and contexts.
 */

import { html } from "./lib/lit-all.js";

/**
 * Calculate which indicator dots to show with ellipsis for large item counts
 * Shows current item and nearby items, with ellipsis for hidden ranges
 *
 * Performance: Results are memoized based on totalItems and currentIndex
 * to avoid recalculating on every render when only non-visual state changes.
 *
 * @param {number} totalItems - Total number of items
 * @param {number} currentIndex - Current active index
 * @param {number} maxVisible - Maximum dots to show (default: 11)
 * @returns {Array} Array of objects {index: number, isEllipsis: boolean, side: 'start'|'end'}
 */
const _visibleDotsCache = new Map();
function getVisibleDots(totalItems, currentIndex, maxVisible = 11) {
  // Memoization key
  const cacheKey = `${totalItems}-${currentIndex}-${maxVisible}`;
  if (_visibleDotsCache.has(cacheKey)) {
    return _visibleDotsCache.get(cacheKey);
  }

  let result;
  if (totalItems <= maxVisible) {
    // Show all dots - no ellipsis needed
    result = Array.from({ length: totalItems }, (_, i) => ({
      index: i,
      isEllipsis: false,
    }));
  } else {
    const dots = [];
    const sideCount = Math.floor((maxVisible - 3) / 2); // Reserve 3 for current + ellipsis

    // Always show first dot
    dots.push({ index: 0, isEllipsis: false });

    // Calculate range around current index
    let rangeStart = Math.max(1, currentIndex - sideCount);
    let rangeEnd = Math.min(totalItems - 2, currentIndex + sideCount);

    // Adjust range if we're near the edges
    if (currentIndex < sideCount + 2) {
      rangeEnd = Math.min(totalItems - 2, maxVisible - 2);
      rangeStart = 1;
    } else if (currentIndex > totalItems - sideCount - 3) {
      rangeStart = Math.max(1, totalItems - maxVisible + 1);
      rangeEnd = totalItems - 2;
    }

    // Add start ellipsis if needed
    if (rangeStart > 1) {
      dots.push({ index: -1, isEllipsis: true, side: "start" });
    }

    // Add visible range
    for (let i = rangeStart; i <= rangeEnd; i++) {
      dots.push({ index: i, isEllipsis: false });
    }

    // Add end ellipsis if needed
    if (rangeEnd < totalItems - 2) {
      dots.push({ index: -2, isEllipsis: true, side: "end" });
    }

    // Always show last dot
    dots.push({ index: totalItems - 1, isEllipsis: false });

    result = dots;
  }

  // Cache the result (limit cache size to prevent memory bloat)
  if (_visibleDotsCache.size > 100) {
    const firstKey = _visibleDotsCache.keys().next().value;
    _visibleDotsCache.delete(firstKey);
  }
  _visibleDotsCache.set(cacheKey, result);

  return result;
}

/**
 * Renders a carousel wrapper with navigation and indicators
 * Delegates item rendering to the provided renderItem function
 *
 * @param {Object} options - Configuration options
 * @param {Array} options.items - Array of items to display
 * @param {number} options.currentIndex - Current carousel index (0-based)
 * @param {number} options.slideDirection - Direction of last slide (-1 = left, 1 = right, 0 = none)
 * @param {Function} options.onNavigate - Callback (direction, maxLength) when navigation is triggered
 * @param {Function} options.onSetIndex - Callback (index) when indicator is clicked
 * @param {Function} options.renderItem - Function to render the current item (receives: item, index)
 * @param {string} options.buttonShape - Button shape for navigation ('rect', 'circle', etc.)
 * @param {boolean} options.showAsCard - Whether to show content in a card container (default: false)
 * @param {boolean} options.wrapNavigation - Whether to wrap around at first/last items (default: false)
 * @returns {TemplateResult} LitElement HTML template
 */
export function renderCarousel(options) {
  const {
    items = [],
    currentIndex = 0,
    slideDirection = 0,
    onNavigate,
    onSetIndex,
    renderItem,
    buttonShape = "rect",
    showAsCard = false,
    wrapNavigation = false,
  } = options;

  if (!items || items.length === 0) {
    return html`<div class="no-pixel-arts">No items available</div>`;
  }

  const validIndex = Math.max(0, Math.min(currentIndex, items.length - 1));

  // Touch swipe state (closures)
  let _swipeStartX = 0;
  let _swipeStartY = 0;
  let _swiping = false;

  const _onTouchStart = (e) => {
    const touch = e.touches[0];
    _swipeStartX = touch.clientX;
    _swipeStartY = touch.clientY;
    _swiping = false;

    const wrapper = e.currentTarget;

    const _moveHandler = (ev) => {
      if (!ev.touches[0]) return;
      const dx = ev.touches[0].clientX - _swipeStartX;
      const dy = Math.abs(ev.touches[0].clientY - _swipeStartY);
      if (Math.abs(dx) > 20 && Math.abs(dx) > dy * 1.5) {
        _swiping = true;
        ev.preventDefault();
      }
    };

    const _cleanup = (ev) => {
      wrapper.removeEventListener("touchmove", _moveHandler);
      wrapper.removeEventListener("touchend", _cleanup);
      wrapper.removeEventListener("touchcancel", _cleanup);

      if (_swiping && ev.type === "touchend") {
        const touch = ev.changedTouches[0];
        const dx = touch.clientX - _swipeStartX;
        if (Math.abs(dx) > 50) {
          onNavigate && onNavigate(dx < 0 ? 1 : -1, items.length);
        }
      }
      _swiping = false;
    };

    wrapper.addEventListener("touchmove", _moveHandler, { passive: false });
    wrapper.addEventListener("touchend", _cleanup, { passive: true });
    wrapper.addEventListener("touchcancel", _cleanup, { passive: true });
  };

  return html`
    <div class="carousel-wrapper" @touchstart=${_onTouchStart}>
      <div
        class="pixelart-gallery-carousel ${showAsCard
          ? "carousel-with-card"
          : ""}"
      >
        <button
          class="carousel-nav-btn carousel-nav-external nav-btn-${buttonShape} ${validIndex ===
            0 && !wrapNavigation
            ? "disabled"
            : ""}"
          title="Previous"
          @click=${() => onNavigate && onNavigate(-1, items.length)}
          ?disabled=${validIndex === 0 && !wrapNavigation}
          style="     width: 38px !important;
                      max-width: 38px !important;
                      min-width: 38px !important;
                      height: 38px;
                      padding: 0;"
        >
          <ha-icon icon="mdi:chevron-left"></ha-icon>
        </button>
        <div
          class="carousel-content ${showAsCard ? "carousel-content-card" : ""}"
        >
          ${renderItem ? renderItem(items[validIndex], validIndex) : ""}
        </div>
        <button
          class="carousel-nav-btn carousel-nav-external nav-btn-${buttonShape} ${validIndex ===
            items.length - 1 && !wrapNavigation
            ? "disabled"
            : ""}"
          title="Next"
          @click=${() => onNavigate && onNavigate(1, items.length)}
          ?disabled=${validIndex === items.length - 1 && !wrapNavigation}
          style="     width: 38px !important;
                      max-width: 38px !important;
                      min-width: 38px !important;
                      height: 38px;
                      padding: 0;"
        >
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>
      ${html`
        <div class="carousel-indicators carousel-indicators-outside">
          ${getVisibleDots(items.length, validIndex).map((dot) =>
            dot.isEllipsis
              ? html`<span class="carousel-dot-ellipsis">⋯</span>`
              : html`
                  <span
                    class="carousel-dot ${dot.index === validIndex
                      ? "active"
                      : ""}"
                    title="${items[dot.index]?.name || `Item ${dot.index + 1}`}"
                    @click=${() => onSetIndex && onSetIndex(dot.index)}
                  ></span>
                `,
          )}
        </div>
      `}
    </div>
  `;
}

/**
 * Carousel Styles - CSS for carousel layout and navigation
 * To be included in card styles
 */
export const carouselStyles = `
  /* Carousel Navigation Button Styles */
  .carousel-nav-btn {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1em;
    font-weight: 500;
    transition: background 0.2s;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .carousel-nav-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }

  .carousel-nav-btn:disabled,
  .carousel-nav-btn.disabled {
    background: var(--disabled-text-color, #bdbdbd) !important;
    color: var(--text-primary-color, #fff) !important;
    cursor: not-allowed !important;
    opacity: 0.6;
  }

  .carousel-nav-btn:disabled:hover,
  .carousel-nav-btn.disabled:hover {
    background: var(--disabled-text-color, #bdbdbd) !important;
  }

  /* Button shape variants */
  .carousel-nav-btn.nav-btn-circle {
    border-radius: 50% !important;
  }

  .carousel-nav-btn.nav-btn-rect {
    border-radius: 8px !important;
  }

  .carousel-nav-btn.nav-btn-square {
    border-radius: 0 !important;
  }

  /* Carousel Wrapper - Contains carousel and outside indicators */
  .carousel-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  /* Carousel Container */
  .pixelart-gallery-carousel {
    position: relative;
    width: 100%;
    /* min-height: 400px; */
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Card Mode - Buttons outside, content in card */
  .carousel-with-card {
    gap: 12px;
  }

  /* Navigation Buttons */
  .carousel-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    background: var(--card-background-color, rgba(255, 255, 255, 0.9));
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: all 0.2s;
  }

  .carousel-nav:hover:not(:disabled) {
    background: var(--card-background-color, rgba(255, 255, 255, 1));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }

  .carousel-nav:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .carousel-nav-left {
    left: 10px;
  }

  .carousel-nav-right {
    right: 10px;
  }

  /* External navigation buttons (card mode) */
  .carousel-with-card .carousel-nav-external {
    position: relative;
    top: auto;
    transform: none;
  }

  /* Carousel Content Area */
  .carousel-content {
    width: 100%;
    max-width: 600px;
    padding: 0 60px;
  }

  /* Card-style content (with background and shadow) */
  .carousel-content-card {
    background: var(--card-background-color, #fff);
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    padding: 20px;
    /* padding-top: 30px; */
    position: relative;
    overflow: visible;
  }

  /* Delete button positioning for card mode - outside top right corner */
  .carousel-content-card .pixelart-item-carousel {
    position: static;
  }
  .carousel-content-card .pixelart-title-row {
    position: static;
  }

  /* Push card content away from inside delete button */
  .carousel-content-card:has(.btn-pos-inside:not(.btn-side-left)) {
    padding-right: 40px;
  }
  .carousel-content-card:has(.btn-pos-inside.btn-side-left) {
    padding-left: 40px;
  }

  .carousel-content-card .pixelart-delete-title-row,
  .carousel-content-card .pixelart-btn-cross {
    position: absolute !important;
    top: -10px !important;
    right: -10px !important;
    z-index: 100 !important;
    margin: 0 !important;
    pointer-events: auto !important;
  }
  /* Inside position */
  .carousel-content-card .pixelart-delete-title-row.btn-pos-inside,
  .carousel-content-card .pixelart-btn-cross.btn-pos-inside {
    top: 8px !important;
    right: 8px !important;
  }
  /* Left side */
  .carousel-content-card .pixelart-delete-title-row.btn-side-left,
  .carousel-content-card .pixelart-btn-cross.btn-side-left {
    right: auto !important;
    left: -10px !important;
  }
  .carousel-content-card .pixelart-delete-title-row.btn-pos-inside.btn-side-left,
  .carousel-content-card .pixelart-btn-cross.btn-pos-inside.btn-side-left {
    left: 8px !important;
  }
  /* Dot outside: smaller offset */
  .carousel-content-card .pixelart-btn-cross.dot-style {
    top: -4px !important;
    right: -4px !important;
  }
  .carousel-content-card .pixelart-btn-cross.dot-style.btn-pos-inside {
    top: 4px !important;
    right: 4px !important;
  }
  .carousel-content-card .pixelart-btn-cross.dot-style.btn-side-left {
    right: auto !important;
    left: -4px !important;
  }
  .carousel-content-card .pixelart-btn-cross.dot-style.btn-pos-inside.btn-side-left {
    left: 4px !important;
  }

  /* Carousel Indicators (dots) */
  .carousel-indicators {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: 20px;
  }

  /* Indicators outside card - positioned below with extra spacing */
  .carousel-indicators-outside {
    margin-top: 4px;
    padding-top: 16px;
  }

  .carousel-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: none;
    background: var(--divider-color, #ccc);
    cursor: pointer;
    transition: all 0.2s;
    padding: 0;
    display: inline-block;
  }

  .carousel-dot:hover {
    background: var(--secondary-text-color, #999);
  }

  .carousel-dot.active {
    background: var(--primary-color, #0077cc);
    width: 12px;
    height: 12px;
  }

  /* Ellipsis for hidden dots */
  .carousel-dot-ellipsis {
    color: var(--secondary-text-color, #999);
    font-size: 16px;
    line-height: 10px;
    padding: 0 4px;
    user-select: none;
  }
`;

/**
 * Helper function to navigate carousel
 * Updates index with bounds checking
 *
 * @param {number} currentIndex - Current carousel index
 * @param {number} direction - Direction to navigate (-1 for prev, 1 for next)
 * @param {number} maxLength - Total number of items
 * @returns {number} New clamped index
 */
export function navigateCarousel(currentIndex, direction, maxLength) {
  const newIndex = currentIndex + direction;
  return Math.max(0, Math.min(newIndex, maxLength - 1));
}

/**
 * Helper function to set carousel index directly
 *
 * @param {number} index - Target index to set
 * @param {number} maxLength - Total number of items
 * @returns {number} Clamped index
 */
export function setCarouselIndex(index, maxLength) {
  return Math.max(0, Math.min(index, maxLength - 1));
}

/**
 * Renders a carousel as a string (for vanilla JS/innerHTML use cases)
 * This is an alternative to renderCarousel() for components that don't use LitElement
 *
 * @param {Object} options - Configuration options (same as renderCarousel)
 * @param {Array} options.items - Array of items to display
 * @param {number} options.currentIndex - Current carousel index (0-based)
 * @param {Function} options.onNavigateAttr - HTML attribute for navigation (e.g., 'onclick' or 'data-action')
 * @param {Function} options.renderItemString - Function to render item as HTML string (receives: item, index)
 * @param {string} options.buttonShape - Button shape for navigation ('rect', 'circle', etc.)
 * @param {boolean} options.showAsCard - Whether to show content in a card container (default: false)
 * @param {boolean} options.wrapNavigation - Whether to wrap around at first/last items (default: false)
 * @param {string} options.carouselId - Unique ID for this carousel instance (required for event handling)
 * @returns {string} HTML string
 */
export function renderCarouselString(options) {
  const {
    items = [],
    currentIndex = 0,
    renderItemString,
    buttonShape = "rect",
    showAsCard = false,
    wrapNavigation = false,
    carouselId = "carousel",
    containerGradient = null,
  } = options;

  if (!items || items.length === 0) {
    return `<div class="no-items">No items available</div>`;
  }

  const validIndex = Math.max(0, Math.min(currentIndex, items.length - 1));
  const visibleDots = getVisibleDots(items.length, validIndex);

  const leftDisabled = validIndex === 0 && !wrapNavigation;
  const rightDisabled = validIndex === items.length - 1 && !wrapNavigation;

  const indicatorsHtml = visibleDots
    .map((dot) => {
      if (dot.isEllipsis) {
        return `<span class="carousel-dot-ellipsis">⋯</span>`;
      }
      const isActive = dot.index === validIndex;
      const itemName = items[dot.index]?.name || `Item ${dot.index + 1}`;
      return `<span 
        class="carousel-dot ${isActive ? "active" : ""}" 
        title="${itemName}"
        data-carousel-id="${carouselId}"
        data-action="set-index"
        data-index="${dot.index}"
      ></span>`;
    })
    .join("");

  const content = renderItemString
    ? renderItemString(items[validIndex], validIndex)
    : "";

  return `
    <div class="carousel-wrapper">
      <div class="pixelart-gallery-carousel ${
        showAsCard ? "carousel-with-card" : ""
      }">
        <button
          class="carousel-nav-btn carousel-nav-external nav-btn-${buttonShape} ${
            leftDisabled ? "disabled" : ""
          }"
          title="Previous"
          data-carousel-id="${carouselId}"
          data-action="navigate"
          data-direction="-1"
          ${leftDisabled ? "disabled" : ""}
          style="width: 38px !important; max-width: 38px !important; min-width: 38px !important; height: 38px; padding: 0;"
        >
          <ha-icon icon="mdi:chevron-left"></ha-icon>
        </button>
        <div class="carousel-content ${
          showAsCard ? "carousel-content-card" : ""
        }${containerGradient ? " gradient-bg-mode" : ""}" ${
          containerGradient
            ? `style="--carousel-gradient-bg: ${containerGradient};"`
            : ""
        }>
          ${content}
        </div>
        <button
          class="carousel-nav-btn carousel-nav-external nav-btn-${buttonShape} ${
            rightDisabled ? "disabled" : ""
          }"
          title="Next"
          data-carousel-id="${carouselId}"
          data-action="navigate"
          data-direction="1"
          ${rightDisabled ? "disabled" : ""}
          style="width: 38px !important; max-width: 38px !important; min-width: 38px !important; height: 38px; padding: 0;"
        >
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>
      ${`<div class="carousel-indicators carousel-indicators-outside">${indicatorsHtml}</div>`}
    </div>
  `;
}

/**
 * Attaches horizontal swipe gesture support to a carousel rendered with renderCarouselString.
 * Call this after innerHTML is set and the carousel wrapper is in the DOM.
 *
 * @param {HTMLElement} container - The element containing the carousel (e.g., shadowRoot)
 * @param {string} carouselId - The carouselId used in renderCarouselString
 * @param {Function} onSwipeNavigate - Callback(direction) where direction is -1 (prev) or 1 (next)
 */
export function attachCarouselSwipe(container, carouselId, onSwipeNavigate) {
  const wrapper = container.querySelector(".carousel-wrapper");
  if (!wrapper || wrapper._swipeAttached) return;

  let startX = 0;
  let startY = 0;
  let swiping = false;

  wrapper.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      swiping = false;
    },
    { passive: true },
  );

  wrapper.addEventListener(
    "touchmove",
    (e) => {
      if (!e.touches[0]) return;
      const dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (Math.abs(dx) > 20 && Math.abs(dx) > dy * 1.5) {
        swiping = true;
        e.preventDefault();
      }
    },
    { passive: false },
  );

  wrapper.addEventListener(
    "touchend",
    (e) => {
      if (!swiping) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      if (Math.abs(dx) > 50) {
        onSwipeNavigate(dx < 0 ? 1 : -1);
      }
      swiping = false;
    },
    { passive: true },
  );

  wrapper._swipeAttached = true;
}
