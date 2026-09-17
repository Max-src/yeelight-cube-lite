// ============================================================================
//  Shared matrix-preview animation utilities
// ============================================================================
//
// One source of truth for the throttled, power-friendly animation pattern used
// by every animated LED matrix preview (clock card gallery, lamp-preview card,
// the internal calibration card). Consolidating this keeps all previews
// consistent and prevents any one card from regressing on performance.
//
// Provides:
//   • createRafLoop        — a requestAnimationFrame loop that throttles to a
//                            target interval and pauses while the tab is hidden.
//   • createVisibilityTracker — an IntersectionObserver wrapper that reports
//                            whether a host element is on screen.
//   • paintCellBackground / paintCellBoxShadow — change-only style writes that
//                            skip the DOM mutation when the value is unchanged.

/**
 * A throttled requestAnimationFrame loop that pauses while the tab is hidden.
 * @param {(t:number)=>void} onFrame - called at most once per interval with the
 *   rAF timestamp, only while the document is visible.
 * @param {{minIntervalMs?: number | (() => number)}} [options] - minimum ms
 *   between frames; a function is re-evaluated each tick (for variable rates).
 * @returns {{start():void, stop():void, running:boolean}}
 */
export function createRafLoop(onFrame, options = {}) {
  const { minIntervalMs = 1000 / 24 } = options;
  const intervalOf =
    typeof minIntervalMs === "function" ? minIntervalMs : () => minIntervalMs;
  let rafId = null;
  let last = 0;
  const loop = (t) => {
    rafId = requestAnimationFrame(loop);
    if (typeof document !== "undefined" && document.hidden) return;
    if (t - last < intervalOf()) return;
    last = t;
    onFrame(t);
  };
  return {
    start() {
      if (rafId == null) rafId = requestAnimationFrame(loop);
    },
    stop() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    get running() {
      return rafId != null;
    },
  };
}

/**
 * Track whether a host element is on screen so an animation loop can idle while
 * scrolled out of view. Falls back to always-visible where IntersectionObserver
 * is unavailable (e.g. tests).
 * @param {Element} target
 * @param {{rootMargin?: string, threshold?: number, onChange?: (v:boolean)=>void}} [options]
 */
export function createVisibilityTracker(target, options = {}) {
  const { rootMargin = "120px", threshold = 0, onChange } = options;
  if (typeof IntersectionObserver === "undefined") {
    return { onScreen: true, connect() {}, disconnect() {} };
  }
  const state = { onScreen: true };
  const io = new IntersectionObserver(
    (entries) => {
      const next = entries.some((e) => e.isIntersecting);
      if (next !== state.onScreen) {
        state.onScreen = next;
        onChange?.(next);
      }
    },
    { rootMargin, threshold },
  );
  return {
    get onScreen() {
      return state.onScreen;
    },
    connect() {
      io.observe(target);
    },
    disconnect() {
      io.disconnect();
    },
  };
}

/**
 * Set a cell's background only when it changes, tracking the last value on the
 * node so repeated identical frames don't touch the DOM.
 */
export function paintCellBackground(cell, bg) {
  if (cell._bg !== bg) {
    cell._bg = bg;
    cell.style.background = bg;
  }
}

/** Change-only box-shadow write (companion to paintCellBackground). */
export function paintCellBoxShadow(cell, sh) {
  if (cell._sh !== sh) {
    cell._sh = sh;
    cell.style.boxShadow = sh;
  }
}
