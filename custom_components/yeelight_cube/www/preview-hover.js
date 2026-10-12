/**
 * <yc-preview-hover>: sections side by side as small previews (each one its
 * content scaled down); one opens at full size under the pointer (Draw's
 * color sections, "Preview Hover").
 *
 *   sections   [{ key, title, content }] (content: a Lit template, or
 *              nothing for an empty section)
 *   overlay    the open section floats over the content around it (nothing
 *              moves; moving to another preview switches it, like a tab);
 *              else it opens in place of the previews and the content
 *              below makes room
 *   bordered   the color sections' border
 *
 * One motion in both modes: the open section is a panel whose first frame
 * lies exactly on its preview (same place, same scale) and which zooms out
 * to full size (a transform: no layout per frame); closing runs it back. In
 * place, the room the panel needs opens with the same timing.
 *
 * A mouse opens a section by hovering its preview and closes it by leaving
 * the whole component (previews and panel); a finger or Enter / Space
 * toggles, Escape and a tap outside close.
 */
import { LitElement, css, html, nothing, unsafeCSS } from "./lib/lit-all.js";
import { defineOnce } from "./card-registration.js";

const DURATION = 320;
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
// The same motion in the stylesheet (CSS transitions) and the scripts.
const MOTION = unsafeCSS(`${DURATION}ms ${EASING}`);
const GAP = 8;
const CLOSE_DELAY = 140;

class YcPreviewHover extends LitElement {
  static properties = {
    sections: { attribute: false },
    overlay: { type: Boolean, reflect: true },
    bordered: { type: Boolean, reflect: true },
    _open: { state: true },
    _closing: { state: true },
    _width: { state: true },
    _closedHeight: { state: true },
  };

  constructor() {
    super();
    this.sections = [];
    this.overlay = false;
    this._open = null; // the open section
    this._closing = null; // the section whose panel runs back to its preview
    this._width = 0;
    this._closedHeight = 0;
    this._closeTimer = null;
    this._motion = []; // the running zoom (and room) animations
    // The host's width sets the previews' scale; the contents' sizes their
    // height (the tallest content, scaled). Each content is observed once
    // (a new one reports its first size).
    this._observed = new WeakSet();
    this._resize = new ResizeObserver((entries) => {
      for (const entry of entries)
        if (entry.target === this) this._width = Math.round(entry.contentRect.width);
      this._measureClosed();
    });
    this._outside = (event) => {
      if (this._open && !event.composedPath().includes(this)) this._setOpen(null);
    };
    this.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") clearTimeout(this._closeTimer);
    });
    this.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") this._closeSoon();
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this._resize.observe(this);
    document.addEventListener("pointerdown", this._outside, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resize.disconnect();
    this._observed = new WeakSet();
    document.removeEventListener("pointerdown", this._outside, true);
    clearTimeout(this._closeTimer);
    this._open = this._closing = null;
  }

  get _count() {
    return Math.max(this.sections?.length || 0, 1);
  }

  // ---- interaction ----------------------------------------------------------

  // Open `key` (null: close). `focus` moves the focus into the panel
  // (opened from the keyboard).
  _setOpen(key, { focus = false } = {}) {
    clearTimeout(this._closeTimer);
    if (key === this._open) return;
    this._previous = this._open;
    this._roomBefore = this.renderRoot.querySelector(".stack")?.getBoundingClientRect().height;
    this._closing = key ? null : this._open;
    this._focusPanel = focus && !!key;
    this._open = key;
  }

  _closeSoon() {
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => this._setOpen(null), CLOSE_DELAY);
  }

  // A mouse over a preview opens it (over the content: switches to it; in
  // place the panel covers the previews, so there is nothing to switch).
  _onEnter(event, key) {
    if (event.pointerType !== "mouse") return;
    if (this._open && !this.overlay) {
      clearTimeout(this._closeTimer);
      return;
    }
    this._setOpen(key);
  }

  // A tap toggles; a mouse click on the preview its hover opened keeps it.
  _onClick(event, key) {
    if (event.pointerType === "mouse" && this._open === key) return;
    this._setOpen(this._open === key ? null : key);
  }

  _onKey(event, key) {
    if (event.key === "Escape" && this._open) {
      event.stopPropagation();
      this._setOpen(null);
      this.renderRoot.querySelector(`.preview[data-key="${key}"]`)?.focus();
    } else if ((event.key === "Enter" || event.key === " ") && event.target.classList.contains("preview")) {
      event.preventDefault();
      this._setOpen(this._open === key ? null : key, { focus: true });
    }
  }

  // ---- motion ---------------------------------------------------------------

  // The previews' height: the tallest content at their scale (layout height:
  // the scale is a transform).
  _measureClosed() {
    const contents = [...this.renderRoot.querySelectorAll(".preview-content")];
    const tallest = Math.max(0, ...contents.map((content) => content.scrollHeight));
    const height = tallest ? Math.ceil(tallest / this._count) + 1 : 0;
    if (height && height !== this._closedHeight) this._closedHeight = height;
  }

  willUpdate(changed) {
    // The open section is gone (hidden on the card): nothing stays open.
    if (changed.has("sections") && (this._open || this._closing)) {
      const keys = new Set(this.sections.map((section) => section.key));
      if (this._open && !keys.has(this._open)) this._open = null;
      if (this._closing && !keys.has(this._closing)) this._closing = null;
    }
  }

  updated(changed) {
    for (const content of this.renderRoot.querySelectorAll(".preview-content")) {
      if (this._observed.has(content)) continue;
      this._observed.add(content);
      this._resize.observe(content);
    }
    if (changed.has("_open")) this._animate();
  }

  // The motion of an open / close / switch. It runs before the next paint:
  // the panel's own elements (yc-swatches) render in microtasks, awaited
  // here so the measures see their final size.
  async _animate() {
    const panel = this.renderRoot.querySelector(".panel");
    if (!panel) return;
    await Promise.all([...panel.querySelectorAll("*")].map((node) => node.updateComplete).filter(Boolean));
    const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timing = { duration: reduce ? 0 : DURATION, easing: EASING };

    // Over the content, another preview: only the content changes (no size
    // animation: nothing is ever cut).
    if (this._open && this._previous) {
      panel.querySelector(".panel-content")?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: reduce ? 0 : 160 });
      this._place(panel);
      return;
    }
    // Reopened while closing: the same motion turns back.
    if (this._open && this._motion.some((animation) => animation.playState === "running")) {
      for (const animation of this._motion) {
        animation.onfinish = null;
        animation.reverse();
      }
      return;
    }
    this._motion.forEach((animation) => animation.cancel());
    this._place(panel);
    const closing = !this._open;
    const key = this._open ?? this._closing;
    const zoom = this._zoomFrames(panel, key);
    const fade = [{ opacity: 0 }, { opacity: 1 }];
    if (closing) {
      zoom.reverse();
      fade.reverse();
    }
    this._motion = [
      panel.animate(zoom, timing),
      panel.querySelector(".title").animate(fade, timing),
    ];
    // In place: the room the panel needs opens (closes) alongside.
    const stack = this.renderRoot.querySelector(".stack");
    if (!this.overlay && this._roomBefore !== undefined) {
      const end = closing ? this._closedHeight : stack.getBoundingClientRect().height;
      this._motion.push(stack.animate([{ height: `${this._roomBefore}px` }, { height: `${end}px` }], timing));
    }
    if (closing) this._motion[0].onfinish = () => (this._closing = null);
    if (this._focusPanel) {
      this._focusPanel = false;
      const swatches = panel.querySelector("yc-swatches");
      (swatches?.shadowRoot?.querySelector('[tabindex="0"]') || panel).focus();
    }
  }

  // The panel's first frame lies exactly on its preview: the content at the
  // preview's scale and place (the title above it fades in).
  _zoomFrames(panel, key) {
    const preview = this.renderRoot.querySelector(`.preview[data-key="${key}"]`);
    const content = panel.querySelector(".panel-content");
    if (!preview || !content) return [{ opacity: 0 }, { opacity: 1 }];
    const scale = 1 / this._count;
    const from = preview.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const inner = content.getBoundingClientRect();
    const dx = from.left - box.left - (inner.left - box.left) * scale;
    const dy = from.top - box.top - (inner.top - box.top) * scale;
    return [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }];
  }

  // Overlay: below the previews, or above them when the viewport has more
  // room there.
  _place(panel) {
    if (!this.overlay) return;
    const row = this.renderRoot.querySelector(".row").getBoundingClientRect();
    const below = innerHeight - row.bottom;
    panel.classList.toggle("up", below < panel.offsetHeight + GAP && row.top > below);
  }

  // ---- render ---------------------------------------------------------------

  render() {
    const n = this._count;
    const width = this._width;
    const shown = this._open ?? this._closing;
    const section = this.sections.find((item) => item.key === shown);
    const style = `--n:${n};--w:${width}px;--bw:${Math.max(width - (n - 1) * GAP, 0)}px;--closed-h:${this._closedHeight}px`;
    return html`<div class="stack${this._open && !this.overlay ? " covered" : ""}" style=${style}>
      <div class="row">${this.sections.map((item) => this._preview(item, item.key === shown))}</div>
      ${section
        ? html`<div
            class="panel${this._open ? "" : " closing"}${this.overlay ? " over" : ""}"
            tabindex="-1"
            @keydown=${(event) => this._onKey(event, section.key)}
          >
            <div class="title">${section.title}</div>
            <div class="panel-content">${section.content ?? this._empty(true)}</div>
          </div>`
        : nothing}
    </div>`;
  }

  // A section's preview (`current`: the one the panel shows).
  _preview(section, current) {
    return html`<div
      class="preview${current ? " current" : ""}${section.content ? "" : " empty"}"
      data-key=${section.key}
      tabindex="0"
      role="button"
      aria-label=${section.title}
      aria-expanded=${section.key === this._open ? "true" : "false"}
      @pointerenter=${(event) => this._onEnter(event, section.key)}
      @click=${(event) => this._onClick(event, section.key)}
      @keydown=${(event) => this._onKey(event, section.key)}
    >
      ${section.content
        ? html`<div class="preview-content" inert>${section.content}</div>`
        : this._empty(false)}
    </div>`;
  }

  // An empty section's placeholder ("Empty" when open).
  _empty(open) {
    return html`<div class="empty-box">
      ${open ? html`<span class="empty-hint">Empty</span>` : nothing}
    </div>`;
  }

  static styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      min-width: 0;
    }
    /* The previews and (in place) the panel share one spot: the stack is as
       high as the taller of the two. */
    .stack {
      display: grid;
      position: relative;
    }
    .stack > * {
      grid-area: 1 / 1;
      min-width: 0;
    }
    .row {
      display: flex;
      align-items: flex-start;
      gap: ${GAP}px;
    }

    /* A preview: the content at the row's width, scaled to its box. */
    .preview {
      flex: 1 1 0;
      min-width: 0;
      height: var(--closed-h);
      overflow: hidden;
      border-radius: 8px;
      cursor: pointer;
      outline: none;
      transition:
        opacity ${MOTION},
        background 0.2s,
        box-shadow 0.2s;
    }
    .preview:focus-visible {
      box-shadow: 0 0 0 2px var(--primary-color, #03a9f4);
    }
    .preview:not(.empty):hover,
    :host([overlay]) .preview.current {
      background: color-mix(in srgb, var(--primary-color, #0077cc) 5%, var(--card-background-color, #fff));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
    :host([overlay]) .preview.current {
      box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--primary-color, #0077cc) 45%, transparent);
    }
    .preview.empty {
      cursor: default;
    }
    /* In place: the previews fade under the opening panel (and back). */
    .covered .preview {
      opacity: 0;
      pointer-events: none;
    }
    .preview-content {
      width: var(--bw);
      transform: scale(calc(1 / var(--n)));
      transform-origin: top left;
      pointer-events: none;
    }

    /* The open section: its content at full size and at the previews' width
       (the side padding makes up the row's gaps). */
    .panel {
      position: relative;
      z-index: 2;
      align-self: start;
      box-sizing: border-box;
      padding: 0 calc((var(--w) - var(--bw)) / 2) 8px;
      border-radius: 10px;
      background: var(--card-background-color, #fff);
      transform-origin: top left;
      will-change: transform;
    }
    :host([bordered]) .panel {
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(128, 128, 128, 0.35));
    }
    /* Closing in place: the panel leaves the flow, the room closes. */
    .panel.closing:not(.over) {
      position: absolute;
      inset: 0 0 auto 0;
    }
    .panel.closing {
      pointer-events: none;
    }
    .panel:focus {
      outline: none;
    }
    .title {
      padding: 8px 2px 6px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 12px;
      font-weight: 600;
      color: var(--secondary-text-color, #888);
    }
    .panel-content {
      width: var(--bw);
    }

    /* Overlay: the panel floats under (or above) the previews. */
    .panel.over {
      position: absolute;
      top: calc(100% + ${GAP}px);
      left: 0;
      right: 0;
      z-index: 20;
      box-shadow:
        0 10px 28px rgba(0, 0, 0, 0.22),
        0 0 0 1px var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .panel.over.up {
      top: auto;
      bottom: calc(100% + ${GAP}px);
    }

    /* An empty section: a placeholder (in the panel: the preview's, at
       full size). */
    .empty-box {
      box-sizing: border-box;
      height: var(--closed-h);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      box-shadow: inset 0 0 0 2px var(--divider-color, rgba(180, 180, 180, 0.5));
      background: color-mix(in srgb, var(--primary-text-color, #333) 3%, transparent);
    }
    .panel .empty-box {
      height: calc(var(--closed-h) * var(--n));
    }
    .empty-hint {
      font-size: 11px;
      color: var(--secondary-text-color, #888);
      opacity: 0.6;
    }
    @media (prefers-reduced-motion: reduce) {
      .preview {
        transition: none;
      }
    }
  `;
}

defineOnce("yc-preview-hover", YcPreviewHover);
