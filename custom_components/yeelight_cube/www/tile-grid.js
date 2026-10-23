/**
 * <yc-tile-grid>: packed tiles. A CSS grid whose tiles keep their own size:
 * each one says how many columns it spans (its inline `grid-column: span N`,
 * tileSpan) and the element gives it as many rows as its height needs, so
 * tiles of different heights (a vertical pixel art beside landscape ones)
 * stack without gaps; `grid-auto-flow: dense` lets a narrow tile take a free
 * place before it, in the items' order otherwise.
 *
 *   html`<yc-tile-grid style=${`grid-template-columns:${tileColumns(...)}`}>
 *     ${items.map((item) => html`<div style=${tileSpan(item)}>…</div>`)}
 *   </yc-tile-grid>`
 *
 * The columns are half a landscape tile wide (tileColumns), so a landscape
 * tile spans two and a vertical one one. The rows are TILE_ROW px: a tile's
 * span is its height plus the grid's column gap (the gap between rows too),
 * measured whenever it resizes (a ResizeObserver, before paint: no jump).
 * The look of the grid and its tiles is the host's CSS (galleryDisplayStyles
 * has the element's own rules). Used by the shared gallery's List, Grid,
 * Mosaic and Original layouts (gallery-layouts.js).
 */
import { defineOnce } from "./card-registration.js";

export const TILE_ROW = 2; // px

/** A tile's columns: one for a vertical item, two for any other. */
export const tileSpan = (item) => `grid-column: span ${item?.vertical ? 1 : 2};`;

/**
 * The columns of packed tiles `tileWidth` px wide (a landscape tile): pairs
 * of half columns, as many as fit (always one pair, whatever the width),
 * stretched to the width (`stretch`) or kept at their size.
 */
export function tileColumns(tileWidth, { gap = 12, stretch = true } = {}) {
  const half = Math.max(1, Math.round((tileWidth - gap) / 2));
  const column = `minmax(min(${half}px, calc(50% - ${gap / 2}px)), ${stretch ? "1fr" : `${half}px`})`;
  return `repeat(auto-fill, ${column} ${column})`;
}

/** A fixed number of landscape tiles per row (two half columns each). */
export const tileColumnsFixed = (perRow) =>
  `repeat(${perRow * 2}, minmax(0, 1fr))`;

class YcTileGrid extends HTMLElement {
  connectedCallback() {
    // Without it (no layout engine) the tiles stay a plain grid.
    if (typeof ResizeObserver === "undefined") return;
    this.toggleAttribute("packed", true);
    this._resize ||= new ResizeObserver((entries) => {
      const gap = parseFloat(getComputedStyle(this).columnGap) || 0;
      for (const { target } of entries) this._fit(target, gap);
    });
    this._watched = new Set();
    this._children ||= new MutationObserver(() => this._watch());
    this._children.observe(this, { childList: true });
    this._watch();
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    this._children?.disconnect();
    this._watched = new Set();
  }

  // Measure every tile (new ones as they come; removed ones are let go).
  _watch() {
    const tiles = new Set(this.children);
    for (const tile of this._watched)
      if (!tiles.has(tile)) {
        this._resize.unobserve(tile);
        this._watched.delete(tile);
      }
    for (const tile of tiles)
      if (!this._watched.has(tile)) {
        this._watched.add(tile);
        this._resize.observe(tile);
      }
  }

  // Its layout height (not transformed: a hover scale never re-packs).
  _fit(tile, gap) {
    const rows = Math.max(1, Math.ceil((tile.offsetHeight + gap) / TILE_ROW));
    const span = `span ${rows}`;
    if (tile.style.gridRowEnd !== span) tile.style.gridRowEnd = span;
  }
}

defineOnce("yc-tile-grid", YcTileGrid);
