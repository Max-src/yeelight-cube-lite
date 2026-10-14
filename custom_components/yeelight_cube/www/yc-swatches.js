/**
 * <yc-swatches>: a set of colors, the same way in every card. Draw's
 * color sections pick a color from it, the Palettes gallery shows each
 * palette with it; any card can use it (properties from Lit, attributes from
 * markup strings).
 *
 *   colors        [r, g, b] arrays, "#hex" or "rgb()" strings (attribute:
 *                 space-separated hex codes)
 *   layout        swatch-utils.js SWATCH_LAYOUTS (row by default)
 *   shape         square | rounded | round: the swatches and gradient ticks
 *   selectable    a click, tap or key picks a color: onSelect(hex, index)
 *                 and a "yc-swatch-select" event ({color, index}); index is
 *                 -1 for a color picked between two stops. The colors are
 *                 one Tab stop: arrow keys (and Home / End) move between
 *                 them, Enter or Space picks
 *   active        the selected color, marked (any toHex format)
 *   info          none | hex | name: the hovered color's label (selectable)
 *   weights       one number per color: treemap and stripes sizes
 *   order         given | smooth (dark → light, the smooth blend order)
 *   free-pick     gradient / fill: pick any color of the blend, not only
 *                 its stops (their ticks pick the stops, also by keyboard)
 *   direction     blinds: rows | columns | diagonal-right | diagonal-left
 *   expand-style  expand: pill | chevron | dots (its +N button)
 *   button-shape  the arrows' shape (scroll, expand): square | rounded | round
 *
 * The look follows CSS custom properties set by the host page:
 * --yc-swatch-size (28px), --yc-swatch-gap (8px), --yc-swatch-radius (6px,
 * the rounded shape), --yc-swatch-ring (the border), --yc-swatch-shadow,
 * --yc-swatch-bar-height (bars: the size) and --yc-swatch-bar-shadow. Every
 * layout follows the size: the swatches themselves, the bars' and areas'
 * height (gradient, stripes, fill, blinds, treemap), the drawn layouts'
 * width (fan, wave, spiral, honeycomb).
 */
import { LitElement, css, html, nothing } from "./lib/lit-all.js";
import { defineOnce } from "./card-registration.js";
import {
  BLINDS_DIRECTIONS,
  EXPAND_COLLAPSED_COUNT,
  EXPAND_STYLES,
  blendBackground,
  blendColorAt,
  blindsHeight,
  colorLabel,
  fanGeometry,
  honeycombGeometry,
  smoothOrder,
  spiralGeometry,
  toHex,
  treemapGeometry,
  waveGeometry,
} from "./swatch-utils.js";

// Two color (or weight) lists hold the same values.
function sameList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) =>
    Array.isArray(value)
      ? sameList(value, b[index])
      : value === b[index],
  );
}
const listChanged = (value, old) => !sameList(value, old);
const colorList = {
  fromAttribute: (value) => (value || "").split(/\s+/).filter(Boolean),
  toAttribute: () => null,
};

const CHEVRON = (points) =>
  html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points=${points}></polyline></svg>`;

class YcSwatches extends LitElement {
  static properties = {
    colors: { converter: colorList, hasChanged: listChanged },
    weights: { attribute: false, hasChanged: listChanged },
    layout: { reflect: true },
    shape: { reflect: true },
    selectable: { type: Boolean, reflect: true },
    active: {},
    info: {},
    order: {},
    freePick: { type: Boolean, attribute: "free-pick" },
    direction: {},
    expandStyle: { attribute: "expand-style" },
    buttonShape: { attribute: "button-shape", reflect: true },
    onSelect: { attribute: false, hasChanged: () => false },
    _expanded: { state: true },
  };

  constructor() {
    super();
    this.colors = [];
    this.layout = "row";
    this.shape = "round";
    this.selectable = false;
    this.info = "none";
    this.order = "given";
    this.freePick = false;
    this.direction = "rows";
    this.expandStyle = "pill";
    this.buttonShape = "rounded";
    this._expanded = false;
    this._entries = [];
  }

  // The colors shown, in order: {hex, index (in `colors`), weight}.
  willUpdate(changed) {
    if (!["colors", "weights", "order"].some((key) => changed.has(key))) return;
    const entries = [];
    (Array.isArray(this.colors) ? this.colors : []).forEach((color, index) => {
      const hex = toHex(color);
      const weight = Number(this.weights?.[index]);
      if (hex)
        entries.push({
          hex,
          index,
          weight: Math.max(Number.isFinite(weight) ? weight : 1, 0.1),
        });
    });
    this._entries =
      this.order === "smooth"
        ? smoothOrder(entries.map((entry) => entry.hex)).map((i) => entries[i])
        : entries;
  }

  firstUpdated() {
    const root = this.renderRoot;
    root.addEventListener("click", (event) => this._onClick(event), true);
    root.addEventListener("pointerover", (event) => this._onHover(event));
    root.addEventListener("pointerout", (event) => this._onHover(event, true));
    root.addEventListener("focusin", (event) => this._onHover(event));
    root.addEventListener("focusout", (event) => this._onHover(event, true));
    root.addEventListener("pointermove", (event) => this._onPickHover(event));
    root.addEventListener("pointerdown", (event) => this._onDragStart(event));
    root.addEventListener("keydown", (event) => this._onKey(event));
  }

  updated() {
    const label = `${this._entries.length} ${this._entries.length === 1 ? "color" : "colors"}`;
    this.setAttribute("role", this.selectable ? "group" : "img");
    this.setAttribute("aria-label", label);
  }

  render() {
    const entries = this._entries;
    if (!entries.length) return nothing;
    const active = entries.findIndex((entry) => this._isActive(entry));
    this._tabStop = entries[this._focused] ? this._focused : Math.max(active, 0);
    const hint =
      this.selectable && this.info !== "none"
        ? html`<div class="hint" aria-live="polite">&nbsp;</div>`
        : nothing;
    return html`${this._layout(entries)}${hint}`;
  }

  _layout(entries) {
    switch (this.layout) {
      case "grid": {
        const perRow = Math.ceil(entries.length / 2);
        return html`<div class="grid">
          ${[entries.slice(0, perRow), entries.slice(perRow)].map(
            (row, r) => html`<div class="row">${row.map((e, i) => this._swatch(e, r * perRow + i))}</div>`,
          )}
        </div>`;
      }
      case "expand":
        return this._expand(entries);
      case "scroll":
        return html`<div class="scroll">
          <button class="nav" data-action="left" title="Scroll left" aria-label="Scroll left">${CHEVRON("15 18 9 12 15 6")}</button>
          <div class="track">${entries.map((e, i) => this._swatch(e, i))}</div>
          <button class="nav" data-action="right" title="Scroll right" aria-label="Scroll right">${CHEVRON("9 18 15 12 9 6")}</button>
        </div>`;
      case "fan":
        return this._drawn("fan", fanGeometry(entries.length), entries);
      case "wave":
        return this._drawn("wave", waveGeometry(entries.length), entries);
      case "spiral":
        return this._drawn("spiral", spiralGeometry(entries.length), entries);
      case "honeycomb": {
        const geometry = honeycombGeometry(entries.length);
        return html`<div class="area" style="max-width:calc(var(--_size) * ${geometry.width});aspect-ratio:${geometry.ratio}">
          ${geometry.items.map((box, i) => this._cell(entries[i], i, "hex", box))}
        </div>`;
      }
      case "blinds":
        return this._blinds(entries);
      case "treemap": {
        const geometry = treemapGeometry(entries.map((entry) => entry.weight));
        return html`<div class="treemap">
          ${geometry.items.map((box) => this._cell(entries[box.index], box.index, "tile", box))}
        </div>`;
      }
      case "gradient":
        return this._blend(entries, "bar");
      case "stripes":
        return html`<div class="stripes">
          ${entries.map((e, i) => this._cell(e, i, "band", null, `flex-grow:${e.weight}`))}
        </div>`;
      case "fill":
        return this._blend(entries, "fill");
      default:
        return html`<div class="row">${entries.map((e, i) => this._swatch(e, i))}</div>`;
    }
  }

  // One color in the chosen shape (a button when selectable).
  _swatch(entry, index, kind = "", style = "") {
    return this._item(entry, index, `sw ${kind}`, style);
  }

  // One color as an area of a drawn layout (hexagon, tile, band, strip).
  _cell(entry, index, kind, box, extra = "") {
    const place = box
      ? `left:${box.left};top:${box.top};width:${box.width};height:${box.height};`
      : "";
    return this._item(entry, index, `cell ${kind}`, place + extra);
  }

  // A color: a picture in a preview, a button (one Tab stop for all of
  // them) when selectable.
  _item(entry, index, classes, style) {
    const look = `background:${entry.hex};${style}`;
    if (!this.selectable) return html`<span class=${classes} style=${look}></span>`;
    return html`<button
      class=${classes}
      style=${look}
      data-index=${index}
      tabindex=${index === this._tabStop ? "0" : "-1"}
      aria-label=${colorLabel(entry.hex, this.info === "none" ? "hex" : this.info)}
      aria-pressed=${this._isActive(entry) ? "true" : "false"}
    ></button>`;
  }

  // Gradient (a bar) and fill (the whole area): the blend; when selectable,
  // a tick per color under it picks that color (pointer or keyboard).
  _blend(entries, kind) {
    const blend = html`<div
      class=${kind}
      ?data-pick=${this.selectable}
      style="background:${blendBackground(entries.map((e) => e.hex))}"
    ></div>`;
    if (!this.selectable)
      return kind === "bar" ? html`<div class="bar-wrap">${blend}</div>` : blend;
    const last = Math.max(entries.length - 1, 1);
    return html`<div class="bar-wrap picker">
      ${blend}
      <div class="ticks">
        ${entries.map((e, i) => this._swatch(e, i, "tick", `left:${((i / last) * 100).toFixed(1)}%`))}
      </div>
    </div>`;
  }

  _drawn(kind, geometry, entries) {
    return html`<div class="area ${kind}" style="max-width:calc(var(--_size) * ${geometry.width});aspect-ratio:${geometry.ratio}">
      ${geometry.items.map((box, i) =>
        this._swatch(
          entries[i],
          i,
          "placed",
          `left:${box.left};top:${box.top};width:${box.width};height:${box.height};--r:${box.rotate}deg;--s0:${box.scale};${box.opacity ? `--o:${box.opacity};` : ""}`,
        ),
      )}
    </div>`;
  }

  _expand(entries) {
    const more = entries.length > EXPAND_COLLAPSED_COUNT;
    const shown = more && !this._expanded ? entries.slice(0, EXPAND_COLLAPSED_COUNT) : entries;
    if (!shown[this._tabStop]) this._tabStop = 0;
    const hidden = entries.length - EXPAND_COLLAPSED_COUNT;
    const style = EXPAND_STYLES.includes(this.expandStyle) ? this.expandStyle : "pill";
    let button = nothing;
    if (more) {
      const label = this._expanded ? "Show fewer colors" : `Show ${hidden} more colors`;
      const content =
        style === "chevron"
          ? CHEVRON(this._expanded ? "15 18 9 12 15 6" : "9 18 15 12 9 6")
          : this._expanded
            ? "−"
            : style === "dots"
              ? "⋯"
              : `+${hidden}`;
      button = html`<button
        class="${style === "chevron" ? "nav" : `more ${style}`}"
        data-action="expand"
        title=${label}
        aria-label=${label}
        aria-expanded=${this._expanded ? "true" : "false"}
      >${content}</button>`;
    }
    return html`<div class="row">${shown.map((e, i) => this._swatch(e, i))}${button}</div>`;
  }

  _blinds(entries) {
    const direction = BLINDS_DIRECTIONS.includes(this.direction)
      ? this.direction
      : "rows";
    return html`<div class="blinds" style="--h:calc(var(--_size) * ${blindsHeight(entries.length, direction)})">
      <div class="blinds-inner ${direction}">
        ${entries.map((e, i) => this._cell(e, i, "strip"))}
      </div>
    </div>`;
  }

  _isActive(entry) {
    return !!this.active && toHex(this.active) === entry.hex;
  }

  // ---- interaction ----------------------------------------------------------

  _onClick(event) {
    if (this._dragged) {
      // The click that ends a drag-scroll picks nothing.
      this._dragged = false;
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    const target = event.target.closest?.("[data-index], [data-action], [data-pick]");
    const action = target?.dataset.action;
    // A preview (not selectable) leaves clicks to its host, but its own
    // controls (expand, scroll arrows).
    if (!target || (!this.selectable && !action)) return;
    event.stopPropagation();
    if (action === "expand") this._expanded = !this._expanded;
    else if (action === "left" || action === "right")
      this.renderRoot
        .querySelector(".track")
        ?.scrollBy({ left: action === "left" ? -120 : 120, behavior: "smooth" });
    else if (target.dataset.index !== undefined) {
      const entry = this._entries[Number(target.dataset.index)];
      this._moveFocus(Number(target.dataset.index), false);
      if (entry) this._select(entry.hex, entry.index);
    } else {
      const picked = this._pickAt(target, event.clientX);
      if (picked) this._select(picked.hex, picked.index);
    }
  }

  // Arrow keys (and Home / End) move between the colors, in their order.
  _onKey(event) {
    const current = event.target.closest?.("[data-index]");
    if (!current) return;
    const indexes = [...this.renderRoot.querySelectorAll("[data-index]")]
      .map((node) => Number(node.dataset.index))
      .sort((a, b) => a - b);
    const at = indexes.indexOf(Number(current.dataset.index));
    const next = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: indexes.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this._moveFocus(indexes[Math.max(0, Math.min(indexes.length - 1, next))], true);
  }

  // The color `index` becomes the Tab stop (and takes the focus).
  _moveFocus(index, focus) {
    this._focused = index;
    for (const node of this.renderRoot.querySelectorAll("[data-index]")) {
      const stop = Number(node.dataset.index) === index;
      node.tabIndex = stop ? 0 : -1;
      if (stop && focus) node.focus();
    }
  }

  // The color of a pick surface (gradient bar, fill) at clientX.
  _pickAt(surface, clientX) {
    const rect = surface.getBoundingClientRect();
    if (!rect.width) return null;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const hexes = this._entries.map((entry) => entry.hex);
    if (this.freePick) {
      const hex = blendColorAt(hexes, t);
      const stop = hexes.indexOf(hex);
      return { hex, index: stop < 0 ? -1 : this._entries[stop].index };
    }
    const entry = this._entries[Math.round(t * (hexes.length - 1))];
    return { hex: entry.hex, index: entry.index };
  }

  _select(hex, index) {
    this._showHint(colorLabel(hex, this.info));
    this.onSelect?.(hex, index);
    this.dispatchEvent(
      new CustomEvent("yc-swatch-select", {
        detail: { color: hex, index },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onHover(event, leaving = false) {
    if (!this.selectable || this.info === "none") return;
    const swatch = event.target.closest?.("[data-index], [data-pick]");
    if (!swatch) return;
    if (swatch.dataset.index === undefined) {
      // A pick surface: its label follows the pointer (_onPickHover).
      if (leaving && !swatch.contains(event.relatedTarget)) this._showHint("");
      return;
    }
    if (leaving) {
      if (!swatch.contains(event.relatedTarget)) this._showHint("");
      return;
    }
    this._showHint(colorLabel(this._entries[Number(swatch.dataset.index)]?.hex, this.info));
  }

  // Free pick: the label follows the pointer along the blend.
  _onPickHover(event) {
    if (this._drag) this._onDragMove(event);
    if (!this.selectable || !this.freePick || this.info === "none") return;
    const surface = event.target.closest?.("[data-pick]");
    if (!surface) return;
    if (this._hintFrame) return;
    const x = event.clientX;
    this._hintFrame = requestAnimationFrame(() => {
      this._hintFrame = null;
      const picked = this._pickAt(surface, x);
      if (picked) this._showHint(colorLabel(picked.hex, this.info));
    });
  }

  _showHint(text) {
    const hint = this.renderRoot?.querySelector(".hint");
    if (!hint) return;
    hint.textContent = text || " ";
    hint.classList.toggle("shown", !!text);
  }

  // Scroll layout: drag the row with a mouse (touch scrolls natively).
  _onDragStart(event) {
    const track = event.target.closest?.(".track");
    if (!track || event.pointerType !== "mouse" || event.button !== 0) return;
    this._dragged = false;
    this._drag = { track, x: event.clientX, left: track.scrollLeft };
    const end = () => {
      this._drag = null;
      track.classList.remove("dragging");
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointerup", end);
  }

  _onDragMove(event) {
    const { track, x, left } = this._drag;
    const dx = event.clientX - x;
    if (!this._dragged && Math.abs(dx) < 5) return;
    this._dragged = true;
    track.classList.add("dragging");
    track.scrollLeft = left - dx;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      box-sizing: border-box;
      --_size: var(--yc-swatch-size, 28px);
      --_gap: var(--yc-swatch-gap, 8px);
      --_radius: var(--yc-swatch-radius, 6px);
      --_ring: var(--yc-swatch-ring, 2px solid var(--card-background-color, #fff));
      --_shadow: var(--yc-swatch-shadow, 0 1px 4px #0002);
      --_bar: var(--yc-swatch-bar-height, var(--_size));
      --_bar-shadow: var(--yc-swatch-bar-shadow, 0 2px 8px #0002, inset 0 1px 2px #fff4);
      --_btn-radius: 8px;
    }
    :host([button-shape="square"]) {
      --_btn-radius: 0;
    }
    :host([button-shape="round"]) {
      --_btn-radius: 50%;
    }
    button {
      appearance: none;
      margin: 0;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
      z-index: 30;
    }

    /* A swatch: one color in the chosen shape. */
    .sw {
      display: inline-block;
      flex: 0 0 auto;
      width: var(--_size);
      height: var(--_size);
      padding: 0;
      box-sizing: content-box;
      border: var(--_ring);
      border-radius: 50%;
      box-shadow: var(--_shadow);
      transition:
        transform 0.15s,
        box-shadow 0.2s,
        opacity 0.2s;
    }
    :host([shape="rounded"]) .sw {
      border-radius: var(--_radius);
    }
    :host([shape="square"]) .sw {
      border-radius: 0;
    }
    button.sw:hover {
      transform: scale(1.1);
    }
    .sw[aria-pressed="true"] {
      box-shadow:
        0 0 0 2px var(--primary-color, #03a9f4),
        var(--_shadow);
    }

    /* Every layout fits its host's width (also as a flex item). */
    .row,
    .grid,
    .scroll {
      min-width: 0;
      max-width: 100%;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: var(--_gap);
    }
    .grid {
      display: flex;
      flex-direction: column;
      gap: var(--_gap);
    }

    /* Arrows (scroll, the expand chevron): the gallery arrows' look. */
    .nav {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--_size);
      height: var(--_size);
      padding: 0;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
      border-radius: var(--_btn-radius);
      background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
      color: var(--primary-color, #0077cc);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
      transition: all 0.2s;
    }
    .nav:hover {
      background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    .nav svg {
      display: block;
    }
    .scroll {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
    }
    .track {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--_gap);
      padding: 4px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      scroll-behavior: smooth;
      cursor: grab;
      user-select: none;
    }
    .track::-webkit-scrollbar {
      display: none;
    }
    .track.dragging {
      cursor: grabbing;
      scroll-behavior: auto;
    }

    /* Expand: the +N / ⋯ button. */
    .more {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--_size);
      height: calc(var(--_size) * 0.86);
      padding: 0 calc(var(--_size) * 0.36);
      box-sizing: border-box;
      border: none;
      border-radius: 50px;
      color: var(--primary-color, #0077cc);
      line-height: 1;
      transition: all 0.2s;
    }
    .more.pill {
      background: color-mix(in srgb, var(--primary-color, #1976d2) 14%, var(--card-background-color, #fff));
      font-size: calc(var(--_size) * 0.42);
      font-weight: 600;
      letter-spacing: 0.02em;
      box-shadow: 0 1px 4px #0002;
    }
    .more.pill:hover {
      background: color-mix(in srgb, var(--primary-color, #1976d2) 28%, var(--card-background-color, #fff));
      box-shadow: 0 2px 8px #0003;
    }
    .more.dots {
      background: color-mix(in srgb, var(--primary-color, #1976d2) 10%, var(--card-background-color, #fff));
      font-size: calc(var(--_size) * 0.62);
      font-weight: 700;
      letter-spacing: 2px;
      box-shadow: 0 1px 3px #0001;
      opacity: 0.75;
    }
    .more.dots:hover {
      opacity: 1;
      background: color-mix(in srgb, var(--primary-color, #1976d2) 22%, var(--card-background-color, #fff));
    }
    .more[aria-expanded="true"] {
      font-size: calc(var(--_size) * 0.57);
    }

    /* Gradient: the blend as a bar; when selectable, a tick per color. */
    .bar-wrap {
      width: 100%;
      box-sizing: border-box;
    }
    .bar-wrap.picker {
      padding: 4px 8px;
    }
    .bar {
      height: var(--_bar);
      border-radius: calc(var(--_bar) / 2);
      box-shadow: var(--_bar-shadow);
      transition: box-shadow 0.2s;
    }
    .picker .bar {
      cursor: pointer;
    }
    .picker .bar:hover {
      box-shadow:
        0 3px 12px #0003,
        inset 0 1px 2px #fff4;
    }
    .ticks {
      position: relative;
      height: calc(var(--_size) * 0.36 + 4px);
      margin-top: 4px;
    }
    .sw.tick {
      position: absolute;
      width: calc(var(--_size) * 0.36);
      height: calc(var(--_size) * 0.36);
      box-shadow: 0 1px 3px #0003;
      transform: translateX(-50%);
    }
    :host([shape="rounded"]) .sw.tick {
      border-radius: 4px;
    }
    :host([shape="square"]) .sw.tick {
      border-radius: 2px;
    }
    button.sw.tick:hover {
      transform: translateX(-50%) scale(1.3);
    }

    /* Stripes and fill. */
    .stripes {
      display: flex;
      width: 100%;
      height: calc(var(--_bar) * 1.27);
      border-radius: var(--_radius);
      overflow: hidden;
      box-shadow: var(--_bar-shadow);
    }
    .cell.band {
      flex: 1 1 0;
      min-width: 0;
    }
    .fill {
      width: 100%;
      align-self: stretch;
      min-height: calc(var(--_size) * 2);
      border-radius: calc(var(--_radius) * 1.25);
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
    }
    .fill[data-pick] {
      cursor: pointer;
    }

    /* Drawn layouts: boxes in % of an area that keeps its proportions. */
    .area {
      position: relative;
      width: 100%;
      margin: 0 auto;
    }
    .fan {
      overflow: hidden;
    }
    .sw.placed {
      position: absolute;
      box-sizing: border-box;
      z-index: 2;
      opacity: var(--op, var(--o, 1));
      transform: rotate(var(--r, 0deg)) scale(var(--s, var(--s0, 1)));
    }
    .fan .sw.placed {
      transform-origin: center bottom;
    }
    button.sw.placed:hover {
      z-index: 10;
      --op: 1;
      --s: 1.3;
      box-shadow: 0 3px 12px #0004;
    }
    .fan button.sw.placed:hover {
      --s: 1.25;
    }
    .spiral button.sw.placed:hover {
      --s: 1.35;
    }

    /* Areas of a color: hexagon, tile, band, strip. */
    .cell {
      position: relative;
      display: block;
      padding: 0;
      border: 0;
      border-radius: 0;
    }
    .cell[aria-pressed="true"]::after {
      content: "";
      position: absolute;
      inset: 0;
      margin: auto;
      width: min(14px, 40%);
      aspect-ratio: 1;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
      pointer-events: none;
    }
    .cell.hex {
      position: absolute;
      clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
      transition:
        transform 0.2s ease,
        filter 0.2s ease;
    }
    button.cell.hex:hover {
      transform: scale(1.2);
      filter: brightness(1.2);
      z-index: 20;
    }
    /* 110 px high at the default size (the treemap's 350 × 110 design). */
    .treemap {
      position: relative;
      width: 100%;
      height: calc(var(--_size) * 3.93);
      border-radius: 10px;
    }
    .cell.tile {
      position: absolute;
      box-sizing: border-box;
      border: 0.5px solid rgba(255, 255, 255, 0.08);
      z-index: 1;
      transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    button.cell.tile:hover {
      transform: scale(1.12);
      z-index: 10;
    }
    .blinds {
      width: 100%;
      height: var(--h);
      overflow: hidden;
      border-radius: 8px;
      --over: calc(var(--h) * 0.268 + 4px);
    }
    .blinds-inner {
      display: flex;
      gap: 1px;
      width: 100%;
      height: 100%;
    }
    .blinds-inner.rows {
      flex-direction: column;
    }
    .blinds-inner.diagonal-right,
    .blinds-inner.diagonal-left {
      width: calc(100% + 2 * var(--over));
      margin-left: calc(-1 * var(--over));
      transform: skewX(-15deg);
    }
    .blinds-inner.diagonal-left {
      transform: skewX(15deg);
    }
    .cell.strip {
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
      transition:
        flex-grow 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        filter 0.2s;
    }
    button.cell.strip:hover,
    button.cell.strip:focus-visible {
      flex-grow: 4;
      filter: brightness(1.1);
    }

    /* The hovered color's label. */
    .hint {
      min-height: 1.4em;
      margin-top: 4px;
      text-align: center;
      font-size: 0.8em;
      color: var(--secondary-text-color, #888);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .hint.shown {
      opacity: 1;
    }
    :host([layout="treemap"]) .hint {
      margin-top: 14px;
    }
  `;
}

defineOnce("yc-swatches", YcSwatches);
