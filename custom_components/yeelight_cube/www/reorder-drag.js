/**
 * Drag to reorder: one behaviour for every reorderable list of the cards
 * (the editors' ordered lists, Arrange, Draw's tools, Color List).
 *
 * Pointer Events only, so a mouse, a finger and a pen drag the same way. The
 * host calls startReorderDrag() from its pointerdown handler; the drag
 * begins once the pointer moves a few pixels (a press alone stays a click).
 * The dragged item itself follows the pointer (the CSS `translate` property,
 * so it adds to the item's own transform) and the other items make room
 * live. A click that ends a drag is swallowed; Escape cancels.
 *
 * Touch drags need `touch-action: none` on the element the drag starts from
 * (a handle, or items that never scroll the page), else the browser scrolls
 * and cancels the pointer.
 *
 * Classes: the item gets `dragging`, the container `dragging-active` (hosts
 * style the lifted look). Lit hosts: with `restore` (default) the DOM is put
 * back exactly as it was before onDrop, so the host re-renders the new order
 * from its own data; a host that re-renders its list afresh can pass
 * `restore: false`.
 */

const THRESHOLD = 5;

/**
 * @param {PointerEvent} event the pointerdown on `item`
 * @param {object} options
 * @param {Element} options.item the item to drag
 * @param {Element} [options.container] gets `dragging-active` while dragging
 * @param {() => Element[]} options.items the reorderable items, in order
 * @param {(order: number[], items: Element[]) => void} options.onDrop the
 *   new order, as the items' indexes before the drag, and the items in it
 *   (only when it changed)
 * @param {(item: Element, target: Element, after: boolean) => void} [options.place]
 *   puts the item before/after the target (default: DOM insert next to it)
 * @param {(el: Element) => Element} [options.measure] the element whose box
 *   stands for an item (e.g. a rotated card inside its wrapper)
 * @param {boolean} [options.nearest=false] the target is the nearest item
 *   (overlapping layouts) instead of the item under the pointer
 * @param {boolean} [options.restore=true] put the DOM back before onDrop
 * @param {() => void} [options.onStart] the drag began (past the threshold)
 * @param {() => void} [options.onMoved] the items were reordered
 * @param {(dropped: boolean) => void} [options.onEnd] last, once the drag
 *   began (a press without a drag stays a click: no onStart / onEnd)
 * @returns {{cancel: () => void}} ends the drag as if cancelled (e.g. the
 *   host is removed mid-drag)
 */
export function startReorderDrag(event, options) {
  if (event.button > 0 || !event.isPrimary) return { cancel() {} };
  const {
    item,
    container = item.parentElement,
    items,
    onDrop,
    place = defaultPlace,
    measure = (el) => el,
    nearest = false,
    restore = true,
    onStart,
    onMoved,
    onEnd,
  } = options;
  const start = { x: event.clientX, y: event.clientY };
  const pointerId = event.pointerId;
  let active = false;
  let original = null;
  let snapshot = null;
  let grab = null;
  let laid = null; // the item's box where the layout puts it (no translate)
  let frame = 0;
  let last = start;

  const begin = () => {
    active = true;
    original = items();
    // Every parent's children, to put the DOM back as it was (Lit keeps
    // references to these very nodes).
    snapshot = new Map(
      [...new Set(original.map((el) => el.parentNode))].map((parent) => [
        parent,
        [...parent.childNodes],
      ]),
    );
    const rect = item.getBoundingClientRect();
    laid = rect;
    grab = { x: start.x - rect.left, y: start.y - rect.top };
    item.classList.add("dragging");
    container?.classList.add("dragging-active");
    item.style.transition = "none";
    item.style.pointerEvents = "none";
    item.style.zIndex = "1000";
    onStart?.();
  };

  // The item under the pointer (or the nearest one), and which side of it.
  const target = (x, y) => {
    let best = null;
    let bestDistance = Infinity;
    for (const el of items()) {
      if (el === item) continue;
      const r = measure(el).getBoundingClientRect();
      const inside = x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
      if (!nearest && !inside) continue;
      const distance = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { el, r };
      }
    }
    if (!best) return null;
    const { r } = best;
    // An item on the dragged item's line (a row, a wrapping row): left /
    // right of its centre; on another line (a column, the next row): above
    // / below it. Overlapping layouts (nearest): left / right.
    const sameLine = laid.top < r.bottom && laid.bottom > r.top;
    const after = nearest || sameLine ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    return { el: best.el, after };
  };

  // The item sits under the pointer wherever the layout put it.
  const follow = () => {
    frame = 0;
    const found = target(last.x, last.y);
    if (found) {
      const list = items();
      const from = list.indexOf(item);
      const to = list.indexOf(found.el);
      // Only a move that changes the order (no jitter at an item's edge).
      if ((found.after && to !== from - 1) || (!found.after && to !== from + 1)) {
        place(item, found.el, found.after);
        onMoved?.();
      }
    }
    item.style.translate = "";
    laid = item.getBoundingClientRect();
    item.style.translate = `${last.x - grab.x - laid.left}px ${last.y - grab.y - laid.top}px`;
  };

  const move = (e) => {
    if (e.pointerId !== pointerId) return;
    last = { x: e.clientX, y: e.clientY };
    if (!active) {
      if (Math.hypot(last.x - start.x, last.y - start.y) < THRESHOLD) return;
      begin();
    }
    e.preventDefault();
    if (!frame) frame = requestAnimationFrame(follow);
  };

  const finish = (dropped) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (frame) cancelAnimationFrame(frame);
    if (!active) return;
    const final = items();
    const order = final.map((el) => original.indexOf(el));
    item.classList.remove("dragging");
    container?.classList.remove("dragging-active");
    for (const prop of ["translate", "transition", "pointerEvents", "zIndex"]) item.style[prop] = "";
    if (restore || !dropped)
      for (const [parent, children] of snapshot) parent.replaceChildren(...children);
    // The click that ends a drag is not a click on the item.
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    const changed = order.some((from, to) => from !== to);
    if (dropped && changed) onDrop(order, final);
    onEnd?.(dropped && changed);
  };
  const up = (e) => e.pointerId === pointerId && finish(true);
  const cancel = (e) => e.pointerId === pointerId && finish(false);
  const key = (e) => {
    if (e.key !== "Escape" || !active) return;
    e.stopPropagation();
    finish(false);
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  return { cancel: () => finish(false) };
}

function defaultPlace(item, target, after) {
  target.parentNode.insertBefore(item, after ? target.nextSibling : target);
}

/** The new order of `list` after a drag (onDrop's `order`). */
export function reorderList(list, order) {
  return order.map((index) => list[index]);
}
