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
//   • matrixSurface        — one canvas over a preview's grid, for the tiles of a
//                            gallery that change 25 times a second.

import { matrixView } from "./matrix-view.js";

// Every refresh of a 60 Hz display, over twice the lamp's 25 renders a second;
// faster displays are not followed.
const SMOOTH_INTERVAL_MS = 15;

/**
 * A throttled requestAnimationFrame loop that pauses while the tab is hidden.
 * @param {(t:number)=>void} onFrame - called at most once per interval with the
 *   rAF timestamp, only while the document is visible.
 * @param {{minIntervalMs?: number | (() => number)}} [options] - minimum ms
 *   between frames; a function is re-evaluated each tick (for variable rates).
 *   options.smoothWhen: while it returns true, frames run at the display's
 *   rate (capped at SMOOTH_INTERVAL_MS), for an effect the lamp draws: each
 *   render shows on the first refresh after it, wherever the preview's clock
 *   started, and a frame that changes no cell costs no DOM write. onFrame's
 *   second argument says whether the minimum interval passed, so the other
 *   previews sharing the loop keep their own rate.
 * @returns {{start():void, stop():void, running:boolean}}
 */
export function createRafLoop(onFrame, options = {}) {
  const { minIntervalMs = 1000 / 24, smoothWhen } = options;
  const intervalOf =
    typeof minIntervalMs === "function" ? minIntervalMs : () => minIntervalMs;
  let rafId = null;
  let last = 0;
  let lastSmooth = 0;
  const loop = (t) => {
    rafId = requestAnimationFrame(loop);
    if (typeof document !== "undefined" && document.hidden) return;
    const due = t - last >= intervalOf();
    if (!due && (t - lastSmooth < SMOOTH_INTERVAL_MS || !smoothWhen?.())) return;
    lastSmooth = t;
    if (due) last = t;
    onFrame(t, due);
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

const surfaces = new WeakMap();

// A grid is reused: Lit changes its attributes in place (a mount standing up,
// the pixel style, the spacing), and it resizes or goes from hidden to shown
// without any paint, a frozen preview has none. So a surface is told, and
// redraws what it shows: a new look never waits for the next frame. The
// observers belong to the grids, nothing here keeps one alive.
const attributeChanges =
  typeof MutationObserver === "undefined"
    ? null
    : new MutationObserver((records) => {
        for (const grid of new Set(records.map((record) => record.target)))
          surfaces.get(grid)?.refit();
      });
const resizes =
  typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver((entries) => {
        for (const { target } of entries) {
          const surface = surfaces.get(target);
          if (target.isConnected) surface?.refit();
          else {
            // Gone: a paint watches it again if it comes back.
            resizes.unobserve(target);
            if (surface) surface.watched = false;
          }
        }
      });

/**
 * A preview's picture on one canvas of a pixel per cell, scaled up over its
 * grid, the cells' shape cut out of it (a mask). A gallery repaints 25 times a
 * second what a full tile of 100 cells would pay for in style writes, style
 * recalculation and paint: this is one call and the compositor scales it. The
 * grid stays what it is: its size, its background and, when black shows, its
 * cells' shadows; .matrix-surface makes the cells see-through. With see-through
 * black (.matrix-surface-holes) only lit pixels have a shadow, and the canvas's
 * holder draws it: `paint`'s last argument.
 *
 * Everything is read from the grid, which may change at any time: a surface
 * follows it (attributeChanges, resizes above).
 * @returns {{paint(frame: number[][], scale?: number, hideBlack?: number|null, shadow?: string): void}}
 */
export function matrixSurface(grid) {
  let surface = surfaces.get(grid);
  if (!surface) {
    surface = new MatrixSurface(grid);
    surfaces.set(grid, surface);
  }
  return surface;
}

class MatrixSurface {
  constructor(grid) {
    this.grid = grid;
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d", { alpha: true });
    Object.assign(this.canvas.style, {
      display: "block",
      width: "100%",
      height: "100%",
      imageRendering: "pixelated",
    });
    // A span: the grid's cells are its divs. Absolute from the start: a grid
    // not laid out yet (hidden) must not take it for a cell.
    this.holder = document.createElement("span");
    this.holder.setAttribute("aria-hidden", "true");
    Object.assign(this.holder.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
    });
    this.holder.append(this.canvas);
    this.view = null;
    this.watched = false;
    this.last = null;
  }

  // A frame's index -> its pixel in the image: the cell the view puts it in.
  layout() {
    const view = matrixView(this.grid.dataset.vertical === "true");
    if (view === this.view) return;
    this.view = view;
    this.canvas.width = view.cols;
    this.canvas.height = view.rows;
    this.image = this.context.createImageData(view.cols, view.rows);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.offsets = Int32Array.from(view.target);
  }

  // The canvas covers the cells and half a gap around them, so a canvas pixel is
  // a cell and its gap, and the mask one cell's shape, repeated. Not laid out
  // (hidden): nothing to read yet, resizes calls again once it is.
  fit() {
    const { grid, canvas, holder, view } = this;
    const width = grid.clientWidth;
    const first = grid.firstElementChild;
    if (!width || !first) return;
    const look = getComputedStyle(grid);
    const gap = parseFloat(look.columnGap) || 0;
    const left = parseFloat(look.paddingLeft) || 0;
    const top = parseFloat(look.paddingTop) || 0;
    const cell = (width - left * 2 - gap * (view.cols - 1)) / view.cols;
    const pitch = cell + gap;
    const radius = getComputedStyle(first).borderTopLeftRadius;
    const rounded = radius.endsWith("%")
      ? (parseFloat(radius) / 100) * cell
      : parseFloat(radius) || 0;
    const shape = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${pitch} ${pitch}'><rect x='${gap / 2}' y='${gap / 2}' width='${cell}' height='${cell}' rx='${rounded}'/></svg>`;
    const mask = gap || rounded ? `url("data:image/svg+xml,${encodeURIComponent(shape)}")` : "none";
    // In percents of the grid: it may resize before the next fit.
    const size = `${100 / view.cols}% ${100 / view.rows}%`;
    Object.assign(holder.style, {
      inset: "auto",
      left: `${left - gap / 2}px`,
      top: `${top - gap / 2}px`,
      width: `calc(100% - ${2 * left - gap}px)`,
      height: `calc(100% - ${2 * top - gap}px)`,
    });
    Object.assign(canvas.style, {
      maskImage: mask,
      webkitMaskImage: mask,
      maskSize: size,
      webkitMaskSize: size,
    });
  }

  refit() {
    this.layout();
    this.fit();
    if (this.last) this.draw();
  }

  /** `scale`: the preview's brightness. `hideBlack`: a pixel at or below this
   * level is see-through, null when black shows. `shadow`: a lit pixel's, as a
   * cell's box-shadow, with see-through black. */
  paint(frame, scale = 1, hideBlack = null, shadow = "") {
    this.last = { frame, scale, hideBlack, shadow };
    const { grid, holder } = this;
    if (!holder.isConnected) {
      grid.append(holder);
      grid.classList.add("matrix-surface");
      this.layout();
      this.fit();
    }
    if (!this.watched) {
      this.watched = true;
      attributeChanges?.observe(grid, { attributeFilter: ["style", "data-vertical"] });
      resizes?.observe(grid);
    }
    this.draw();
  }

  // A picture that did not change costs no canvas update: a still effect, a
  // dark moment.
  draw() {
    const { frame, scale, hideBlack, shadow } = this.last;
    const holes = hideBlack !== null;
    const filter = holes && shadow ? `drop-shadow(${shadow})` : "none";
    if (this.holes !== holes) {
      this.holes = holes;
      this.grid.classList.toggle("matrix-surface-holes", holes);
    }
    if (this.filter !== filter) {
      this.filter = filter;
      this.holder.style.filter = filter;
    }
    const { offsets, pixels } = this;
    let changed = false;
    for (let index = 0; index < offsets.length; index += 1) {
      const pixel = frame[index] || BLACK;
      const red = pixel[0];
      const green = pixel[1];
      const blue = pixel[2];
      const hidden = holes && red <= hideBlack && green <= hideBlack && blue <= hideBlack;
      // Bytes R, G, B, A in memory.
      const value = hidden
        ? 0
        : scale === 1
          ? (0xff000000 | (blue << 16) | (green << 8) | red) >>> 0
          : (0xff000000 |
              (Math.min(255, Math.round(blue * scale)) << 16) |
              (Math.min(255, Math.round(green * scale)) << 8) |
              Math.min(255, Math.round(red * scale))) >>> 0;
      if (pixels[offsets[index]] !== value) {
        pixels[offsets[index]] = value;
        changed = true;
      }
    }
    if (changed) this.context.putImageData(this.image, 0, 0);
  }
}

const BLACK = [0, 0, 0];
