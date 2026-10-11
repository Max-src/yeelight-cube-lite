// Drag-to-reorder of the color list editor card: the shared drag
// (reorder-drag.js) in every layout (mouse, touch and pen), with the card
// layouts' own placement (poker hand rows, fan arc). Mixed into
// YeelightCubeColorListEditorCard.
import { ITEM_DRAG_SELECTORS, isRgb } from "./color-list-utils.js";
import { startReorderDrag } from "./reorder-drag.js";

// Controls inside an item that never start a drag.
const NO_DRAG = "input, button, select, textarea, .chip-remove, .compact-remove, .tile-remove, .row-remove, .grid-remove-btn, .grid-color-picker";

export const ColorListDragMixin = (Base) => class extends Base {
  // ----- Drag and drop reordering -------------------------------------
  //
  // While a drag is active the items are moved by hand for live feedback
  // and renders are held back (shouldUpdate); on drop the new order is
  // saved and _listKey is bumped so Lit discards the hand-moved DOM and
  // renders the list afresh.

  _dragKind() {
    if (this.config?.allow_drag_drop === false) return null;
    const layout = this.config.list_layout || "compact";
    if (ITEM_DRAG_SELECTORS[layout]) return "items";
    if (layout === "grid" || layout === "cards") return layout;
    return null;
  }

  _dragItemSelector(kind) {
    if (kind === "grid") return ".color-grid-item";
    if (kind === "cards") return ".card-wrapper";
    return ITEM_DRAG_SELECTORS[this.config.list_layout || "compact"];
  }

  _dragItemFrom(target, kind) {
    if (kind === "cards") {
      return target.closest?.(".card-item")?.closest(".card-wrapper") || null;
    }
    return target.closest?.(this._dragItemSelector(kind)) || null;
  }

  _dragContainer(kind) {
    const root = this.renderRoot;
    if (kind === "grid") return root.querySelector(".layout-grid");
    if (kind !== "cards") return null;
    return (this.config.card_arrangement || "hand") === "hand"
      ? root.querySelector(".cards-poker-container")
      : root.querySelector(".cards-container") ||
          root.querySelector(".cards-fan-container");
  }

  _hexInputFocused() {
    return !!this.renderRoot?.activeElement?.classList?.contains("hex-input");
  }

  // A press on an item may become a drag (past a few pixels).
  _onListPointerDown(event) {
    const kind = this._dragKind();
    if (!kind || this._hexInputFocused() || event.target.closest?.(NO_DRAG)) return;
    const item = this._dragItemFrom(event.target, kind);
    if (!item) return;
    const arrangement = this.config.card_arrangement || "hand";
    const fan = kind === "cards" && arrangement === "fan";
    const container = this._dragContainer(kind) || item.parentElement;
    const colors = this._renderedColors;
    const selector = this._dragItemSelector(kind);
    let reordered = null;
    if (event.pointerType === "mouse") event.preventDefault(); // no text selection
    this._dragSession = startReorderDrag(event, {
      item,
      container,
      items: () => [...this.renderRoot.querySelectorAll(selector)],
      // Overlapping cards: the nearest one, measured by its (rotated) face.
      nearest: kind === "cards",
      measure: fan ? (wrapper) => wrapper.querySelector(".card-item") || wrapper : undefined,
      place:
        kind === "cards" && arrangement === "hand"
          ? (dragged, target, after) => this._placeInHand(dragged, target, after)
          : undefined,
      // The list is rendered afresh after the drop (_listKey).
      restore: false,
      onStart: () => {
        this._isDragging = true;
        if (fan) this._collapseFanForDrag(container);
      },
      onMoved: () => fan && this._recalcFanRotations(container),
      onDrop: (order, items) => {
        const positions = items.map((el) =>
          parseInt(kind === "cards" ? el.dataset.position : el.dataset.idx, 10),
        );
        const next = positions.map((index) => colors[index]).filter(isRgb);
        if (next.length === colors.length) reordered = next;
      },
      onEnd: () => this._finishDrag(reordered),
    });
  }

  // End of a drag: the hand-moved DOM is discarded and re-rendered, with
  // the new order saved when there is one.
  _finishDrag(newColors) {
    this._dragSession = null;
    this._isDragging = false;
    this._listKey++;
    this._fanHover = { wrapper: null, justCollapsed: false };
    this._pendingHassRender = false;
    if (newColors) this.saveColors(newColors);
    else this.requestUpdate();
  }

  // Hand: the cards in rows of four, each row fanned like a poker hand.
  _placeInHand(dragged, target, after) {
    const root = this.renderRoot;
    const pokerContainer = root.querySelector(".cards-poker-container");
    if (!pokerContainer) return;
    const order = [...root.querySelectorAll(".card-wrapper")].filter((card) => card !== dragged);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, dragged);
    pokerContainer.replaceChildren();
    const cardsPerRow = 4;
    for (let i = 0; i < order.length; i += cardsPerRow) {
      const rowWrapper = document.createElement("div");
      rowWrapper.className = "poker-hand";
      const rowSize = Math.min(cardsPerRow, order.length - i);
      for (let j = 0; j < rowSize; j++) {
        const card = order[i + j];
        const offset = j - (rowSize - 1) / 2;
        const cardItem = card.querySelector(".card-item");
        if (cardItem) {
          cardItem.style.transform = `rotate(${offset * 8}deg) translateY(${
            Math.abs(offset) * 10
          }px) translateX(${offset * -15}px)`;
          cardItem.style.zIndex = j;
        }
        rowWrapper.appendChild(card);
      }
      pokerContainer.appendChild(rowWrapper);
    }
  }

  // Fan mode: restore the normal fan arc for the current DOM order.
  _recalcFanRotations(container) {
    if (this.config.card_arrangement !== "fan" || !container) return;
    const wrappers = Array.from(container.querySelectorAll(".card-wrapper"));
    const totalCards = wrappers.length;
    if (totalCards <= 1) return;
    const maxSpread = Math.min(50, totalCards * 6);
    const centerIndex = (totalCards - 1) / 2;
    wrappers.forEach((wrapper, i) => {
      const rotationDeg =
        centerIndex > 0 ? ((i - centerIndex) / centerIndex) * maxSpread : 0;
      const cardItem = wrapper.querySelector(".card-item");
      if (cardItem) {
        cardItem.style.transform = `rotate(${rotationDeg.toFixed(1)}deg)`;
        cardItem.style.zIndex = i;
      }
      wrapper.style.transform = "none";
      wrapper.classList.remove("fan-hovered");
    });
  }

  // Fan mode: drop the hover spread when a drag starts. Cleans all fan
  // classes/transforms directly (avoids a race with mouseleave).
  _collapseFanForDrag(container) {
    if (!container) return;
    this._collapseFan(container);
    container.classList.remove("fan-active");
    container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
      wrapper.classList.remove("fan-hovered");
      wrapper.style.transition = "none";
      wrapper.style.transform = "none";
    });
    // Restore transitions next frame
    requestAnimationFrame(() => {
      container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
        wrapper.style.transition = "";
      });
    });
  }

  // ----- Fan hover ----------------------------------------------------
  //
  // Fan arrangement: spread neighbour cards on hover, collapse when the
  // pointer leaves the fan area entirely. The fan shape itself comes from the
  // card-item transforms; spreading only adds a push offset on the wrapper
  // (rotated around transform-origin 50% 320%).

  _spreadFan(container, hoveredWrapper) {
    if (hoveredWrapper === this._fanHover.wrapper) return;
    this._fanHover.wrapper = hoveredWrapper;
    const wrappers = Array.from(container.querySelectorAll(".card-wrapper"));
    const hoveredIdx = wrappers.indexOf(hoveredWrapper);
    if (hoveredIdx === -1) return;
    // Cumulative push: the gap next to the hovered card is the largest, each
    // further step adds a decaying amount.
    const firstGap = 18; // degrees for the immediate neighbour gap
    const pushPerStep = 8; // additional degrees per subsequent step
    const decay = 0.6; // each subsequent step pushes slightly less
    container.classList.add("fan-active");
    wrappers.forEach((wrapper, i) => {
      wrapper.style.transition = "";
      if (i === hoveredIdx) {
        wrapper.classList.add("fan-hovered");
        wrapper.style.transform = "none";
        return;
      }
      wrapper.classList.remove("fan-hovered");
      const dist = Math.abs(i - hoveredIdx);
      let totalPush = firstGap;
      for (let k = 1; k < dist; k++) {
        totalPush += pushPerStep * Math.pow(decay, k - 1);
      }
      wrapper.style.transform = `rotate(${(i > hoveredIdx ? 1 : -1) * totalPush}deg)`;
    });
  }

  _collapseFan(container) {
    if (!this._fanHover.wrapper) return;
    this._fanHover.wrapper = null;
    this._fanHover.justCollapsed = true;
    container.classList.remove("fan-active");
    container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
      wrapper.classList.remove("fan-hovered");
      wrapper.style.transition = "none";
      wrapper.style.transform = "none";
    });
    requestAnimationFrame(() => {
      container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
        wrapper.style.transition = "";
      });
    });
  }

  _fanWrapperFromPoint(container, clientX, clientY) {
    const el = container.getRootNode().elementFromPoint(clientX, clientY);
    const wrapper = el?.closest?.(".card-item")?.closest(".card-wrapper");
    return wrapper && container.contains(wrapper) ? wrapper : null;
  }

  _onFanMouseMove(event) {
    const container = event.currentTarget;
    if (this._fanHover.justCollapsed) return;
    if (container.classList.contains("dragging-active")) return;
    const wrapper = this._fanWrapperFromPoint(
      container,
      event.clientX,
      event.clientY,
    );
    if (wrapper) this._spreadFan(container, wrapper);
  }

  _onFanMouseEnter() {
    this._fanHover.justCollapsed = false;
  }

  _onFanMouseLeave(event) {
    this._collapseFan(event.currentTarget);
  }

  _onFanTouch(event) {
    const container = event.currentTarget;
    if (event.type === "touchend" || event.type === "touchcancel") {
      this._collapseFan(container);
      return;
    }
    if (container.classList.contains("dragging-active")) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (event.type === "touchstart") this._fanHover.justCollapsed = false;
    const wrapper = this._fanWrapperFromPoint(
      container,
      touch.clientX,
      touch.clientY,
    );
    if (wrapper) this._spreadFan(container, wrapper);
  }
};
