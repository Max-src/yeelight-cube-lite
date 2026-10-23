/**
 * <yc-wheel>: the shared gallery's Wheel layout, an iOS-style 3D picker.
 * Its centred item and every item's 3D place are its own state, rendered by
 * Lit: the arrows, the mouse wheel and a vertical drag move it one item at a
 * time; it re-centres on the active item only when that changes (a pick, a
 * rotation step), so browsing is never reset by unrelated updates.
 *
 *   html`<yc-wheel
 *     .items=${items}                 // the gallery's visible items
 *     .active=${key}                  // the active item (centred when it changes)
 *     .geometry=${geometry}           // wheelGeometry() of gallery-layouts.js
 *     .renderItem=${(item, index, style, centred) => …}
 *     .onMove=${(key) => …}           // the centred item after a move, or null
 *   ></yc-wheel>`
 *
 * It renders in the gallery's light DOM (the gallery's CSS: .wheel-display
 * and the rest, galleryDisplayStyles) and takes no box of its own
 * (display: contents).
 */
import { LitElement, html, nothing } from "./lib/lit-all.js";
import { defineOnce } from "./card-registration.js";

// Pixels of vertical drag that move the wheel one item.
const DRAG_STEP = 40;

/** An item's 3D place by its distance from the centred one. */
export function wheelItemPlace(index, center) {
  const distance = Math.abs(index - center);
  if (distance === 0)
    return "opacity: 1; transform: scale(1) rotateX(0deg) translateZ(0px); z-index: 100;";
  // Items above the centre lean forward, below it backward.
  const rotateX = Math.min(distance * 20, 50) * (index < center ? 1 : -1);
  const scale = Math.max(0.92, 1 - distance * 0.02);
  return `opacity: 1; transform: scale(${scale}) rotateX(${rotateX}deg) translateZ(0px); z-index: ${100 - distance * 10};`;
}

class YcWheel extends LitElement {
  static properties = {
    items: { attribute: false },
    active: { attribute: false },
    geometry: { attribute: false },
    renderItem: { attribute: false },
    onMove: { attribute: false },
    center: { state: true },
  };

  constructor() {
    super();
    this.items = [];
    this.center = 0;
    this._dragY = null;
    this._moving = false;
    // The mouse wheel, as a non-passive listener (it stops the page scroll).
    this._onWheel = {
      handleEvent: (event) => {
        event.preventDefault();
        this._move(event.deltaY > 0 ? 1 : -1);
      },
      passive: false,
    };
    this._onTouchStart = {
      handleEvent: (event) => {
        event.preventDefault();
        this._startDrag(event.touches[0].clientY);
      },
      passive: false,
    };
    this._onTouchMove = {
      handleEvent: (event) => {
        if (this._dragY != null) event.preventDefault();
        this._drag(event.touches[0].clientY);
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

  // The active item is centred when it, or the list of items, changes; new
  // previews or labels of the same items keep the one being browsed.
  willUpdate(changed) {
    const keys = this.items.map((item) => item.dataMode).join("\n");
    if (!changed.has("active") && keys === this._keys) return;
    this._keys = keys;
    const index = this.items.findIndex((item) => item.dataMode === this.active);
    if (index >= 0) this.center = index;
    else this.center = Math.max(0, Math.min(this.center, this.items.length - 1));
  }

  // One item up (-1) or down (+1); a move tells the gallery (onMove), which
  // picks it unless it only browses. A move while one is still being
  // applied only turns the wheel.
  _move(step) {
    const center = Math.max(0, Math.min(this.items.length - 1, this.center + step));
    if (center === this.center) return;
    this.center = center;
    const key = this.items[center]?.dataMode;
    if (key == null || !this.onMove || this._moving) return;
    this._moving = true;
    Promise.resolve(this.onMove(key))
      .catch((error) => console.error("[Wheel] Move failed:", error))
      .finally(() => {
        this._moving = false;
      });
  }

  _startDrag(y) {
    this._dragY = y;
    this.requestUpdate();
  }

  _drag(y) {
    if (this._dragY == null) return;
    const delta = this._dragY - y;
    if (Math.abs(delta) > DRAG_STEP) {
      this._move(delta > 0 ? 1 : -1);
      this._dragY = y; // keeps going while the pointer moves
    }
  }

  _endDrag() {
    if (this._dragY == null) return;
    this._dragY = null;
    this.requestUpdate();
  }

  render() {
    const geometry = this.geometry;
    if (!geometry) return nothing;
    const offset = geometry.offsetFor(this.center);
    // In "sides", the left arrow goes up the list and the right one down.
    const navs = geometry.navPosition === "sides" ? ["up", "down"] : ["down", "up"];
    const nav = (className, direction, title, symbol) => html`<button
      class=${className}
      data-wheel-nav=${direction}
      title=${title}
      aria-label=${title}
      style=${`border-radius: ${geometry.navRadius};`}
      @click=${(event) => {
        event.stopPropagation();
        this._move(direction === "up" ? -1 : 1);
      }}
    >${symbol}</button>`;
    return html`<div
      class="wheel-display"
      data-bg-transparent=${geometry.transparent ? "true" : nothing}
      style=${`max-width: ${geometry.maxWidth}px; height: ${geometry.height}px;`}
    >
      <div class="wheel-clip-viewport" @wheel=${this._onWheel}>
        <div
          class="wheel-scroll-container"
          data-wheel-scroll="true"
          style=${`padding: ${geometry.paddingTop}px 0; transform: translateY(-${offset}px); max-width: ${geometry.columnWidth}px;${this._dragY != null ? " cursor: grabbing;" : ""}`}
          @touchstart=${this._onTouchStart}
          @touchmove=${this._onTouchMove}
          @touchend=${() => this._endDrag()}
          @mousedown=${(event) => {
            event.preventDefault();
            this._startDrag(event.clientY);
          }}
          @mousemove=${(event) => {
            if (this._dragY == null) return;
            event.preventDefault();
            this._drag(event.clientY);
          }}
          @mouseup=${() => this._endDrag()}
          @mouseleave=${() => this._endDrag()}
        >
          ${this.items.map((item, index) =>
            this.renderItem(item, index, wheelItemPlace(index, this.center), index === this.center),
          )}
        </div>
      </div>
      ${geometry.navPosition === "none"
        ? nothing
        : html`<div class="wheel-nav-buttons" data-wheel-nav-layout=${geometry.navPosition}>
            ${nav("wheel-nav-down", navs[0], "Previous", "‹")}${nav("wheel-nav-up", navs[1], "Next", "›")}
          </div>`}
    </div>`;
  }
}

defineOnce("yc-wheel", YcWheel);
