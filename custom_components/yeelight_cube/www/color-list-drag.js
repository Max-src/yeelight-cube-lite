// Drag-to-reorder of the colour list editor card (mouse, touch and the
// fanned card layout). Mixed into YeelightCubeColorListEditorCard.
import { ITEM_DRAG_SELECTORS, isRgb } from "./color-list-utils.js";

export const ColorListDragMixin = (Base) => class extends Base {
  // ----- Drag and drop reordering -------------------------------------
  //
  // All drag events are delegated from the Lit-rendered #color-list
  // container. While a drag is active the nodes are moved by hand for live
  // feedback and renders are held back (shouldUpdate); on drop the new order
  // is saved and _listKey is bumped so Lit discards the hand-moved DOM and
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

  _beginDrag(kind, item, touch) {
    this._drag = {
      kind,
      item,
      touch,
      active: !touch,
      container: this._dragContainer(kind),
      colors: this._renderedColors,
      lastUpdate: 0,
      startX: 0,
      startY: 0,
    };
    if (!touch) this._isDragging = true;
    return this._drag;
  }

  _onDragStart(event) {
    const kind = this._dragKind();
    const item = kind && this._dragItemFrom(event.target, kind);
    if (!item) return;
    // Don't start dragging while a hex input is focused (text selection)
    if (this._hexInputFocused()) {
      event.preventDefault();
      return;
    }
    const drag = this._beginDrag(kind, item, false);
    item.classList.add("dragging");
    drag.container?.classList.add("dragging-active");
    event.dataTransfer.effectAllowed = "move";

    if (kind === "cards") {
      const card = item.querySelector(".card-item");
      event.dataTransfer.setData("text/html", card.innerHTML);
      // Create a colored drag ghost so the user sees the color being carried
      const dragColor = card.style.getPropertyValue("--card-color") || "#888";
      const dragImg = document.createElement("div");
      dragImg.style.cssText = `width:50px;height:70px;background:${dragColor};border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);position:absolute;top:-9999px;left:-9999px;`;
      document.body.appendChild(dragImg);
      event.dataTransfer.setDragImage(dragImg, 25, 35);
      // Clean up drag image element after browser captures it
      setTimeout(() => dragImg.remove(), 100);
      // CRITICAL: Defer fan collapse to AFTER browser captures the drag image.
      // Collapsing synchronously changes transforms, which makes the element
      // jump away from the cursor and the browser aborts the drag.
      if (this.config.card_arrangement === "fan") {
        setTimeout(() => this._collapseFanForDrag(drag.container), 0);
      }
      return;
    }
    if (kind === "grid") {
      event.dataTransfer.setData("text/html", item.innerHTML);
    }
    // Force layout calculation before drag operations begin
    // This prevents position offset issues on the first drag
    void item.offsetHeight;
  }

  _onDragOver(event) {
    const kind = this._dragKind();
    if (!kind) return;
    const drag = this._drag;
    if (kind === "items") {
      const item = this._dragItemFrom(event.target, kind);
      if (!item) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (drag?.item && item !== drag.item) this._moveItemTo(drag, item);
      return;
    }
    // Grid and cards accept drops anywhere in their container
    const container = drag?.container || this._dragContainer(kind);
    if (!container?.contains(event.target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!drag || drag.touch) return;
    // Throttle updates to max 60fps (every ~16ms)
    const now = Date.now();
    if (now - drag.lastUpdate <= 16) return;
    drag.lastUpdate = now;
    if (kind === "grid") this._updateGridPositions(event.clientX, event.clientY);
    else this._updateCardPositions(event.clientX, event.clientY);
  }

  _onDrop(event) {
    const drag = this._drag;
    if (!drag || drag.touch || drag.kind === "items") return;
    if (!drag.container?.contains(event.target)) return;
    event.stopPropagation();
    this._finishDrag(true);
  }

  _onDragEnd() {
    if (this._drag && !this._drag.touch) this._finishDrag(true);
  }

  _onTouchStart(event) {
    const kind = this._dragKind();
    if (!kind || this._hexInputFocused()) return;
    const target = event.target;
    if (
      (kind === "items" &&
        target.closest(
          ".chip-remove, .compact-remove, .tile-remove, .row-remove",
        )) ||
      (kind === "grid" &&
        target.closest(".grid-remove-btn, .grid-color-picker"))
    ) {
      return;
    }
    const item = this._dragItemFrom(target, kind);
    if (!item) return;
    const touch = event.touches[0];
    const drag = this._beginDrag(kind, item, true);
    drag.startX = touch.clientX;
    drag.startY = touch.clientY;
  }

  _onTouchMove(event) {
    const drag = this._drag;
    if (!drag?.touch) return;
    const touch = event.touches[0];
    const { kind, item } = drag;
    const threshold = kind === "cards" ? 5 : 8;
    if (
      !drag.active &&
      (Math.abs(touch.clientX - drag.startX) > threshold ||
        Math.abs(touch.clientY - drag.startY) > threshold)
    ) {
      drag.active = true;
      this._isDragging = true;
      this._startTouchGhost(drag, touch);
    }
    if (!drag.active) return;
    event.preventDefault(); // Prevent scrolling

    // Move the ghost that follows the finger
    const ghost = drag.ghost;
    if (ghost) {
      const rect = (drag.ghostSource || item).getBoundingClientRect();
      ghost.style.left = touch.clientX - rect.width / 2 + "px";
      ghost.style.top =
        touch.clientY - (kind === "items" ? 20 : rect.height / 2) + "px";
    }

    if (kind === "items") {
      // Find the item under the finger (inside our shadow root) and reorder
      const below = this.renderRoot.elementFromPoint(
        touch.clientX,
        touch.clientY,
      );
      const target = below && this._dragItemFrom(below, kind);
      if (target && target !== item && target.parentNode === item.parentNode) {
        this._moveItemTo(drag, target);
      }
    } else if (kind === "grid") {
      const now = Date.now();
      if (now - drag.lastUpdate > 16) {
        drag.lastUpdate = now;
        this._updateGridPositions(touch.clientX, touch.clientY);
      }
    } else {
      this._updateCardPositions(touch.clientX, touch.clientY);
    }
  }

  _onTouchEnd(event, cancelled) {
    const drag = this._drag;
    if (!drag?.touch) return;
    if (!drag.active) {
      // Was a tap, not a drag
      this._drag = null;
      return;
    }
    // A cancelled card drag still commits the order the user dragged to.
    this._finishDrag(!cancelled || drag.kind === "cards");
  }

  _startTouchGhost(drag, touch) {
    const { kind, item } = drag;
    let ghost;
    if (kind === "cards") {
      // Add placeholder styling to original card
      item.classList.add("touch-dragging-placeholder");
      drag.container?.classList.add("dragging-active");
      const card = item.querySelector(".card-item");
      // Measure BEFORE collapsing the fan so the ghost starts where the
      // card currently is
      const rect = card.getBoundingClientRect();
      if (this.config.card_arrangement === "fan") {
        setTimeout(() => this._collapseFanForDrag(drag.container), 0);
      }
      ghost = card.cloneNode(true);
      ghost.classList.add("touch-dragging");
      ghost.style.width = rect.width + "px";
      ghost.style.height = rect.height + "px";
      ghost.style.left = touch.clientX - rect.width / 2 + "px";
      ghost.style.top = touch.clientY - rect.height / 2 + "px";
      drag.ghostSource = card;
    } else {
      item.classList.add("dragging");
      drag.container?.classList.add("dragging-active");
      const rect = item.getBoundingClientRect();
      ghost = item.cloneNode(true);
      ghost.style.cssText = `
        position: fixed; z-index: 99999; pointer-events: none;
        width: ${rect.width}px;${kind === "grid" ? ` height: ${rect.height}px;` : ""}
        opacity: 0.85; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        transform: scale(1.03); transition: none;
        left: ${touch.clientX - rect.width / 2}px;
        top: ${touch.clientY - (kind === "grid" ? rect.height / 2 : 20)}px;
      `;
    }
    drag.ghost = ghost;
    document.body.appendChild(ghost);
    // Anything placed outside the card is torn down with the drag session,
    // including when the card is disconnected mid-drag.
    this._dragCleanup = () => ghost.remove();
  }

  _endDragSession() {
    const cleanup = this._dragCleanup;
    this._dragCleanup = null;
    cleanup?.();
  }

  // End the active drag. With `save`, the order now shown in the DOM is
  // saved; either way the hand-moved DOM is discarded and re-rendered.
  _finishDrag(save) {
    const drag = this._drag;
    this._drag = null;
    this._endDragSession();
    this._isDragging = false;
    if (!drag) {
      this._flushPendingRender();
      return;
    }
    let newColors = null;
    if (save && drag.active) {
      const order = [
        ...this.renderRoot.querySelectorAll(this._dragItemSelector(drag.kind)),
      ].map((el) =>
        parseInt(drag.kind === "cards" ? el.dataset.position : el.dataset.idx),
      );
      const reordered = order.map((idx) => drag.colors[idx]).filter(isRgb);
      const orderChanged = order.some((pos, idx) => pos !== idx);
      if (orderChanged && reordered.length === drag.colors.length) {
        newColors = reordered;
      }
    }
    this._listKey++;
    this._fanHover = { wrapper: null, justCollapsed: false };
    this._pendingHassRender = false;
    if (newColors) this.saveColors(newColors);
    else this.requestUpdate();
  }

  // Items layouts: place the dragged item before/after the hovered item.
  _moveItemTo(drag, target) {
    const dragged = drag.item;
    const items = [
      ...this.renderRoot.querySelectorAll(this._dragItemSelector(drag.kind)),
    ];
    const draggedIdx = items.indexOf(dragged);
    const targetIdx = items.indexOf(target);
    if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) {
      return;
    }
    if (draggedIdx < targetIdx) {
      // Moving forward - should be after target
      if (dragged.previousElementSibling !== target) {
        const next = target.nextElementSibling;
        if (next) target.parentNode.insertBefore(dragged, next);
        else target.parentNode.appendChild(dragged);
      }
    } else if (dragged.nextElementSibling !== target) {
      // Moving backward - should be before target
      target.parentNode.insertBefore(dragged, target);
    }
  }

  _onListMouseDown(event) {
    if (this._dragKind() !== "grid") return;
    const item = event.target.closest?.(".color-grid-item");
    if (!item) return;
    // Prevent dragging when pressing the remove button
    if (event.target.closest(".grid-remove-btn")) {
      event.stopPropagation();
      item.setAttribute("draggable", "false");
    } else if (event.target.closest(".color-grid-info")) {
      // Allow dragging from the color info text
      item.setAttribute("draggable", "true");
    }
  }

  _onListMouseUp(event) {
    if (this._dragKind() !== "grid") return;
    if (!event.target.closest?.(".grid-remove-btn")) return;
    const item = event.target.closest(".color-grid-item");
    setTimeout(() => item?.setAttribute("draggable", "true"), 100);
  }

  _updateGridPositions(clientX, clientY) {
    const drag = this._drag;
    if (!drag?.item) return;
    const draggedItem = drag.item;
    const gridContainer = drag.container;

    const items = Array.from(
      this.renderRoot.querySelectorAll(".color-grid-item"),
    );
    const draggedItemIndex = items.indexOf(draggedItem);

    // Find the item closest to cursor with expanded hitbox
    let closestItem = null;
    let closestDistance = Infinity;
    let insertIndex = -1;

    items.forEach((item, index) => {
      if (item === draggedItem) return;
      const rect = item.getBoundingClientRect();
      // Expand hitbox by 20px on all sides
      const isInExpandedHitbox =
        clientX >= rect.left - 20 &&
        clientX <= rect.right + 20 &&
        clientY >= rect.top - 20 &&
        clientY <= rect.bottom + 20;
      if (isInExpandedHitbox) {
        // Use distance for priority when in multiple hitboxes
        const distance = Math.hypot(
          clientX - (rect.left + rect.width / 2),
          clientY - (rect.top + rect.height / 2),
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = item;
          insertIndex = index;
        }
      }
    });

    if (!closestItem || insertIndex === -1) return;
    // Determine if we should insert before or after
    const rect = closestItem.getBoundingClientRect();
    if (clientX > rect.left + rect.width / 2) insertIndex++;
    if (draggedItemIndex < insertIndex) insertIndex--;

    // Reorder in DOM
    if (insertIndex !== draggedItemIndex && gridContainer) {
      const targetItem = items[insertIndex];
      if (targetItem && targetItem !== draggedItem) {
        if (insertIndex > draggedItemIndex) {
          const nextSibling = targetItem.nextSibling;
          if (nextSibling) gridContainer.insertBefore(draggedItem, nextSibling);
          else gridContainer.appendChild(draggedItem);
        } else {
          gridContainer.insertBefore(draggedItem, targetItem);
        }
      }
    }

    items.forEach((item) => item.classList.remove("grid-drag-over"));
    closestItem.classList.add("grid-drag-over");
  }

  // Cards: find the insertion position closest to the pointer and reorder
  // the card wrappers in the DOM.
  _updateCardPositions(clientX, clientY) {
    const drag = this._drag;
    if (!drag?.item) return;
    const root = this.renderRoot;
    const draggedCard = drag.item;
    const cardsContainer = drag.container;
    const cardArrangement = this.config.card_arrangement || "hand";

    const wrappers = Array.from(root.querySelectorAll(".card-wrapper"));
    const draggedCardIndex = wrappers.indexOf(draggedCard);

    // Fan mode: wrappers are all position:absolute at the same spot,
    // so use card-item rects (which differ due to rotation) for distance.
    const measure = (wrapper) =>
      cardArrangement === "fan"
        ? wrapper.querySelector(".card-item") || wrapper
        : wrapper;

    // Find the wrapper closest to the cursor position
    let closestWrapper = null;
    let closestDistance = Infinity;
    let insertIndex = -1;
    wrappers.forEach((wrapper, index) => {
      if (wrapper === draggedCard) return;
      const rect = measure(wrapper).getBoundingClientRect();
      const distance = Math.hypot(
        clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2),
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestWrapper = wrapper;
        insertIndex = index;
      }
    });
    if (!closestWrapper || insertIndex === -1) return;

    // If cursor is to the right of the card's center, insert after
    const rect = measure(closestWrapper).getBoundingClientRect();
    if (clientX > rect.left + rect.width / 2) insertIndex++;
    // Adjust insert index if dragging from left to right
    if (draggedCardIndex < insertIndex) insertIndex--;
    // Only reorder if position changed
    if (insertIndex === draggedCardIndex) return;

    if (cardArrangement === "hand") {
      // Hand mode: rebuild the poker-hand rows in the new order
      const newOrder = [...wrappers];
      newOrder.splice(draggedCardIndex, 1);
      newOrder.splice(insertIndex, 0, draggedCard);
      const pokerContainer = root.querySelector(".cards-poker-container");
      if (!pokerContainer) return;
      pokerContainer.replaceChildren();
      const cardsPerRow = 4;
      for (let i = 0; i < newOrder.length; i += cardsPerRow) {
        const rowWrapper = document.createElement("div");
        rowWrapper.className = "poker-hand";
        const rowSize = Math.min(cardsPerRow, newOrder.length - i);
        for (let j = 0; j < rowSize; j++) {
          const card = newOrder[i + j];
          // Recalculate poker hand positioning
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
      return;
    }

    // Non-hand arrangements - physically move the dragged card wrapper
    if (!cardsContainer || insertIndex < 0 || insertIndex >= wrappers.length) {
      return;
    }
    const targetPosition = wrappers[insertIndex];
    if (!targetPosition || targetPosition === draggedCard) return;
    if (insertIndex > draggedCardIndex) {
      // Moving right - insert after target
      const nextSibling = targetPosition.nextSibling;
      if (nextSibling) cardsContainer.insertBefore(draggedCard, nextSibling);
      else cardsContainer.appendChild(draggedCard);
    } else {
      // Moving left - insert before target
      cardsContainer.insertBefore(draggedCard, targetPosition);
    }
    // Fan mode: recalculate rotations so cards animate to their new arc slots
    this._recalcFanRotations(cardsContainer);
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
