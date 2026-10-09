/**
 * The carousel shared by every card: one model (carouselModel), one swipe
 * (carouselSwipe) and one look (carouselStyles), in two templates: a Lit
 * one (renderCarousel: items that are Lit templates, the Draw card's color
 * groups) and an HTML-string one (renderCarouselString: the shared
 * gallery's Carousel layout).
 */

import { html } from "./lib/lit-all.js";
import { escapeHtml } from "./html-escape-utils.js";
import { normalizeButtonShape, roundedCardsRadius } from "./card-config.js";

// The shared button-shape vocabulary (card-config.js), re-exported for the
// carousels' callers.
export { normalizeButtonShape };

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
 * Everything both carousel renderers show, from one place: the item shown,
 * the arrows' shape and disabled state, the dots and the card's radius.
 */
function carouselModel({
  items = [],
  currentIndex = 0,
  buttonShape = "rect",
  wrapNavigation = false,
  roundedCards = true,
}) {
  const validIndex = Math.max(0, Math.min(currentIndex, items.length - 1));
  return {
    validIndex,
    navShape: normalizeButtonShape(buttonShape),
    // The carousel card's corners: 12px by default (legacy true / "round"),
    // else the rounded_cards value.
    radius:
      roundedCards === undefined || roundedCards === true || roundedCards === "round"
        ? 12
        : roundedCardsRadius(roundedCards),
    prevDisabled: validIndex === 0 && !wrapNavigation,
    nextDisabled: validIndex === items.length - 1 && !wrapNavigation,
    dots: getVisibleDots(items.length, validIndex),
    dotTitle: (index) => items[index]?.name || `Item ${index + 1}`,
  };
}

/**
 * A touchstart handler that turns a horizontal swipe into a step:
 * `onNavigate(1)` (to the left: next) or `onNavigate(-1)`. Vertical moves
 * still scroll the page, small moves are taps. Used by every carousel.
 */
export function carouselSwipe(onNavigate) {
  return (event) => {
    const start = event.touches[0];
    const startX = start.clientX;
    const startY = start.clientY;
    let swiping = false;
    const surface = event.currentTarget;
    const move = (moveEvent) => {
      const touch = moveEvent.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(touch.clientY - startY) * 1.5) {
        swiping = true;
        moveEvent.preventDefault();
      }
    };
    const end = (endEvent) => {
      surface.removeEventListener("touchmove", move);
      surface.removeEventListener("touchend", end);
      surface.removeEventListener("touchcancel", end);
      if (swiping && endEvent.type === "touchend") {
        const dx = endEvent.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 50) onNavigate(dx < 0 ? 1 : -1);
      }
    };
    surface.addEventListener("touchmove", move, { passive: false });
    surface.addEventListener("touchend", end, { passive: true });
    surface.addEventListener("touchcancel", end, { passive: true });
  };
}

/**
 * A carousel as a Lit template (cards whose items are Lit templates: the
 * Draw card's color groups). The same markup, model and swipe as
 * renderCarouselString (the shared gallery's carousel).
 *
 * @param {Object} options
 * @param {Array} options.items - the items
 * @param {number} options.currentIndex - the item shown (0-based)
 * @param {Function} options.onNavigate - (direction, count) => step
 * @param {Function} options.onSetIndex - (index) => show that item (dots)
 * @param {Function} options.renderItem - (item, index) => its template
 * @param {string} [options.buttonShape="rect"] - arrows: square, rounded, round
 * @param {boolean} [options.showAsCard=false] - the item in a card
 * @param {boolean} [options.wrapNavigation=false] - past the ends
 * @param {*} [options.roundedCards] - the card's corners (rounded_cards)
 */
export function renderCarousel(options) {
  const { items = [], onNavigate, onSetIndex, renderItem, showAsCard = false } = options;
  if (!items.length) return html`<div class="no-items">No items available</div>`;
  const model = carouselModel(options);
  const step = (direction) => onNavigate?.(direction, items.length);
  const arrow = (direction, disabled) => html`<button
    class="carousel-nav-btn carousel-nav-external nav-btn-${model.navShape} ${disabled ? "disabled" : ""}"
    title=${direction < 0 ? "Previous" : "Next"}
    ?disabled=${disabled}
    @click=${() => step(direction)}
  >
    <ha-icon icon=${direction < 0 ? "mdi:chevron-left" : "mdi:chevron-right"}></ha-icon>
  </button>`;
  return html`
    <div class="carousel-wrapper" @touchstart=${carouselSwipe(step)}>
      <div class="pixelart-gallery-carousel ${showAsCard ? "carousel-with-card" : ""}">
        ${arrow(-1, model.prevDisabled)}
        <div
          class="carousel-content ${showAsCard ? "carousel-content-card" : ""}"
          style=${showAsCard ? `border-radius: ${model.radius}px;` : ""}
        >
          ${renderItem ? renderItem(items[model.validIndex], model.validIndex) : ""}
        </div>
        ${arrow(1, model.nextDisabled)}
      </div>
      <div class="carousel-indicators carousel-indicators-outside">
        ${model.dots.map((dot) =>
          dot.isEllipsis
            ? html`<span class="carousel-dot-ellipsis">⋯</span>`
            : html`<span
                class="carousel-dot ${dot.index === model.validIndex ? "active" : ""}"
                title=${model.dotTitle(dot.index)}
                @click=${() => onSetIndex?.(dot.index)}
              ></span>`,
        )}
      </div>
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
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
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
  .carousel-nav-btn.nav-btn-circle,
  .carousel-nav-btn.nav-btn-round {
    border-radius: 50% !important;
  }

  .carousel-nav-btn.nav-btn-rect,
  .carousel-nav-btn.nav-btn-rounded {
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
    padding-top: 14px; /* Room for outside delete button */
  }

  /* Navigation Buttons */
  .carousel-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    background: var(--card-background-color, rgba(255, 255, 255, 0.9));
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
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
  /* The arrows beside the item (both carousel templates). */
  .carousel-nav-external {
    width: 38px !important;
    max-width: 38px !important;
    min-width: 38px !important;
    height: 38px;
    padding: 0;
  }

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
    cursor: pointer;
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
 * A carousel as an HTML string (the shared gallery's carousel; its clicks
 * are delegated: data-action="navigate" / "set-index", bindStyleSelectorEvents,
 * and its swipe is carouselSwipe). Same markup and model as renderCarousel.
 *
 * @param {Object} options - renderCarousel's, with:
 * @param {Function} options.renderItemString - (item, index) => its HTML
 * @param {string} [options.carouselId="carousel"] - names this carousel's
 *   buttons (data-carousel-id)
 * @returns {string} HTML string
 */
export function renderCarouselString(options) {
  const { items = [], renderItemString, showAsCard = false, carouselId = "carousel" } = options;
  if (!items.length) return `<div class="no-items">No items available</div>`;
  const model = carouselModel(options);
  const arrow = (direction, disabled) => `<button
      class="carousel-nav-btn carousel-nav-external nav-btn-${model.navShape} ${disabled ? "disabled" : ""}"
      title="${direction < 0 ? "Previous" : "Next"}"
      data-carousel-id="${carouselId}"
      data-action="navigate"
      data-direction="${direction}"
      ${disabled ? "disabled" : ""}
    ><ha-icon icon="${direction < 0 ? "mdi:chevron-left" : "mdi:chevron-right"}"></ha-icon></button>`;
  const dots = model.dots
    .map((dot) =>
      dot.isEllipsis
        ? `<span class="carousel-dot-ellipsis">⋯</span>`
        : `<span
        class="carousel-dot ${dot.index === model.validIndex ? "active" : ""}"
        title="${escapeHtml(model.dotTitle(dot.index))}"
        data-carousel-id="${carouselId}"
        data-action="set-index"
        data-index="${dot.index}"
      ></span>`,
    )
    .join("");
  return `
    <div class="carousel-wrapper">
      <div class="pixelart-gallery-carousel ${showAsCard ? "carousel-with-card" : ""}">
        ${arrow(-1, model.prevDisabled)}
        <div class="carousel-content ${showAsCard ? "carousel-content-card" : ""}"${
          showAsCard ? ` style="border-radius: ${model.radius}px;"` : ""
        }>
          ${renderItemString ? renderItemString(items[model.validIndex], model.validIndex) : ""}
        </div>
        ${arrow(1, model.nextDisabled)}
      </div>
      <div class="carousel-indicators carousel-indicators-outside">${dots}</div>
    </div>
  `;
}

