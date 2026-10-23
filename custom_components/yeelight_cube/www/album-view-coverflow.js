/**
 * Album View with Coverflow Effect
 *
 * The Album layout of the shared gallery (collection-gallery.js): a 3D
 * coverflow of the items, with arrows, swipes and a click on the centred
 * item to pick it. Items' rename / delete controls are the gallery's
 * (shown on the centred item only, see collectionGalleryStyles).
 *
 * Usage: <yc-album> (below), rendered by the gallery (gallery-layouts.js
 * albumLayout) with the items' own templates.
 *
 * Styles: albumStyles(classPrefix) is static (include it in the card's static
 * styles); the configurable values (card width from card_size, corner radius
 * from rounded_cards, 3D effect) are CSS variables set on the album wrapper
 * (albumStyleVars).
 *
 * Configuration:
 * - album_nav_shape: the arrows' shape, in the carousel vocabulary
 *   (circle by default; square, rect)
 * - wrap: the arrows and swipes go from the last item to the first and back
 */

import { LitElement, html } from "./lib/lit-all.js";
import { normalizeButtonShape } from "./carousel-utils.js";
import { roundedCardsRadius } from "./card-config.js";
import { defineOnce } from "./card-registration.js";

/**
 * The album's configurable values as CSS variables (inline style of the
 * album wrapper): --yc-album-width, --yc-album-radius, --yc-album-pad,
 * --yc-album-perspective.
 */
export function albumStyleVars(config = {}) {
  return [
    `--yc-album-width:${albumCardWidth(config)}px`,
    `--yc-album-radius:${roundedCardsRadius(config.rounded_cards)}px`,
    // Room above the cards for the items' outside delete buttons.
    "--yc-album-pad:28px 14px",
    `--yc-album-perspective:${config.album_3d_effect !== false ? "1200px" : "none"}`,
  ].join(";");
}

/**
 * A card's configured width (px): `card_size` % of the 240px baseline (the
 * gallery derives it from its Size), within 30-200% so the coverflow never
 * collapses. A vertical item's card is half as wide (album-item-vertical).
 */
export function albumCardWidth(config = {}) {
  const albumSizePct = Math.max(30, Math.min(200, Number(config.card_size) || 100));
  return Math.round((240 * albumSizePct) / 100);
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

    /* A vertical item (item.vertical): half the width, its picture standing
       up at the landscape cards' pixel size. */
    .${classPrefix}-album-item.album-item-vertical {
      --yc-album-card: max(110px, min(var(--yc-album-width, 240px) / 2, 100% - 136px));
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

/** A card's place in the coverflow, `offset` cards from the centred one. */
export function albumItemPlace(offset, enable3D) {
  const distance = Math.abs(offset);
  if (offset === 0)
    return "transform: translateY(-50%) translateX(0) translateZ(0) rotateY(0deg) scale(1); z-index: 200; opacity: 1;";
  const translateX = (offset < 0 ? -150 : 150) * distance;
  // 3D: turned towards the centre and pushed back; flat: only side by side.
  const transform = enable3D
    ? `translateY(-50%) translateX(${translateX}px) translateZ(${-100 * distance}px) rotateY(${offset < 0 ? 45 : -45}deg) scale(0.7)`
    : `translateY(-50%) translateX(${translateX}px) scale(0.7)`;
  return `transform: ${transform}; z-index: ${100 - distance}; opacity: ${distance > 3 ? "0" : "1"};`;
}

/**
 * <yc-album>: the coverflow. Its centred card is its own state; the arrows
 * and horizontal swipes turn it (past the ends with `wrap`), a click on a
 * side card brings it to the centre and a click on the centred one picks it
 * (onPick). It turns to `target` (an index) whenever that changes (the
 * gallery's active item, a reveal) or the items do; new previews or labels
 * of the same items keep the card being browsed.
 *
 *   html`<yc-album
 *     prefix="collection" .items=${items} .target=${index}
 *     .config=${{ card_size, album_3d_effect, rounded_cards }}
 *     .wrap=${false} .navShape=${"round"}
 *     .renderItem=${(item, index) => …} .onPick=${(item) => …}
 *   ></yc-album>`
 *
 * It renders in the host's light DOM (albumStyles) without a box of its own.
 */
class YcAlbum extends LitElement {
  static properties = {
    prefix: { type: String },
    items: { attribute: false },
    target: { attribute: false },
    config: { attribute: false },
    wrap: { attribute: false },
    navShape: { attribute: false },
    renderItem: { attribute: false },
    onPick: { attribute: false },
    current: { state: true },
  };

  constructor() {
    super();
    this.prefix = "album";
    this.items = [];
    this.config = {};
    this.current = 0;
    this._swipe = null;
    // A horizontal swipe turns the album; vertical moves scroll the page.
    this._onTouchMove = {
      handleEvent: (event) => {
        const swipe = this._swipe;
        const touch = event.touches[0];
        if (!swipe || !touch) return;
        const dx = touch.clientX - swipe.x;
        if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(touch.clientY - swipe.y) * 1.5) {
          swipe.moved = true;
          event.preventDefault();
        }
      },
      passive: false,
    };
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "contents";
  }

  willUpdate(changed) {
    const keys = this.items.map((item) => item.dataMode).join("\n");
    if (!changed.has("target") && keys === this._keys) return;
    this._keys = keys;
    this.current = Math.max(0, Math.min(this.target ?? this.current, this.items.length - 1));
  }

  // The card `step` places away; past the ends only when wrapping.
  _turn(step) {
    const count = this.items.length;
    let next = this.current + step;
    if (next < 0 || next >= count) {
      if (!this.wrap || count < 2) return;
      next = (next + count) % count;
    }
    this.current = next;
  }

  _click(index) {
    if (index === this.current) this.onPick?.(this.items[index]);
    else this.current = index;
  }

  render() {
    const prefix = this.prefix;
    const enable3D = this.config.album_3d_effect !== false;
    const navClass = `album-nav-btn nav-btn-${normalizeButtonShape(this.navShape || "circle")}`;
    const arrow = (side, step, title, symbol) => html`<button
      class="${navClass} album-nav-${side}"
      id="${prefix}-album-nav-${side}"
      title=${title}
      aria-label=${title}
      @click=${() => this._turn(step)}
    >${symbol}</button>`;
    return html`<div class="${prefix}-album-wrapper" style=${albumStyleVars(this.config)}>
      ${arrow("prev", -1, "Previous", "‹")}${arrow("next", 1, "Next", "›")}
      <div
        class="${prefix}-album-container"
        id="${prefix}-album-container"
        @touchstart=${{
          handleEvent: (event) => {
            // Not from an arrow or an item's rename / delete control.
            if (event.target.closest("button, .yc-item-action")) return;
            const touch = event.touches[0];
            this._swipe = { x: touch.clientX, y: touch.clientY, moved: false };
          },
          passive: true,
        }}
        @touchmove=${this._onTouchMove}
        @touchend=${{
          handleEvent: (event) => {
            const swipe = this._swipe;
            this._swipe = null;
            if (!swipe?.moved) return;
            const dx = event.changedTouches[0].clientX - swipe.x;
            if (Math.abs(dx) > 50) this._turn(dx < 0 ? 1 : -1);
          },
          passive: true,
        }}
      >
        ${this.items.map(
          (item, index) => html`<div
            class="${prefix}-album-item${item?.vertical ? " album-item-vertical" : ""}${index === this.current ? " active" : ""}"
            data-idx=${index}
            style=${albumItemPlace(index - this.current, enable3D)}
            @click=${() => this._click(index)}
          >
            <div class="album-card">${this.renderItem(item, index)}</div>
          </div>`,
        )}
      </div>
    </div>`;
  }
}

defineOnce("yc-album", YcAlbum);
