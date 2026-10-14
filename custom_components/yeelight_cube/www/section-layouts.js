/**
 * <yc-sections>: a card's sections (Draw's color sections, the Lamp
 * Preview's adjustment categories) in one of the shared layouts. Every card
 * gets every layout:
 *
 *   side           cards side by side (width; click-to-zoom a card; the
 *                  row scrolls by dragging it, mouse or finger)
 *   carousel       one section at a time with arrows and dots
 *   tabs           the shared tab bar over the open section
 *   dropdown       a select over the chosen section
 *   preview-hover  small previews, one opening at full size (<yc-preview-hover>)
 *   grouped        an accordion of section cards (one open at a time)
 *   radial         a half-wheel of section icons beside the open section
 *   categories     a column of section icons beside the open section
 *   compact        every section in one panel, one after another (each
 *                  led by a small header, or none: headers false)
 *
 *   html`<yc-sections
 *     layout="tabs"
 *     .sections=${[{
 *       key, title,
 *       icon,          // emoji (grouped, radial, categories, compact;
 *                      // tabs: tabIcons)
 *       description,   // grouped
 *       marked,        // true / false: a change dot (undefined: none)
 *       empty,         // no content: the empty label instead
 *       action,        // (layout) => a template beside the title (a reset),
 *                      // or nothing when there is none to show
 *       content,       // a template, or (layout) => a template
 *     }]}
 *     .options=${{
 *       style,         // "subtle" | "flat" | "filled": the section cards
 *       bordered,      // a border around each section's content
 *       width, zoom,   // side: card width (%), click-to-zoom
 *       radius,        // side / carousel: corner radius (px)
 *       buttonShape, wrap,  // carousel arrows, wrap-around navigation
 *       overlay,       // preview-hover: the open section floats over
 *       contentStyles, // preview-hover: the content's own stylesheet
 *       tabIcons,      // tabs: the sections' icons in the tab bar
 *       headers,       // compact: each section's header (default true)
 *       label,         // the sections' name (tab bar, select)
 *       emptyLabel,    // shown for an empty section
 *     }}
 *   ></yc-sections>`
 *
 * Which section is open (a tab, the dropdown, the carousel, the wheel or
 * the icon column), the expanded accordion card and the zoomed side card
 * are the component's own state. It renders in the card's light DOM, so the
 * card includes sectionLayoutStyles (and styles the contents it passes).
 */
import { LitElement, html, nothing, svg } from "./lib/lit-all.js";
import { defineOnce } from "./card-registration.js";
import { tabBar } from "./tab-bar.js";
import { renderCarousel } from "./carousel-utils.js";
import "./preview-hover.js";

export const SECTION_LAYOUTS = Object.freeze([
  "side",
  "carousel",
  "tabs",
  "dropdown",
  "preview-hover",
  "grouped",
  "radial",
  "categories",
  "compact",
]);

// The half-wheel of the radial layout (viewBox units).
const WHEEL = { cx: 0, cy: 80, outer: 70, inner: 36 };

class YcSections extends LitElement {
  static properties = {
    layout: { type: String },
    sections: { attribute: false },
    options: { attribute: false },
    _open: { state: true },
    _expanded: { state: true },
    _zoomed: { state: true },
    _index: { state: true },
  };

  constructor() {
    super();
    this.layout = "side";
    this.sections = [];
    this.options = {};
    this._open = null;
    this._expanded = null;
    this._zoomed = null;
    this._index = 0;
    // The side row scrolls by dragging (after a 4 px dead zone, so a click
    // still opens a card), mouse or finger.
    this._drag = null;
    const start = (row, x) => {
      this._drag = { x, scroll: row.scrollLeft, moved: false };
      row.style.cursor = "grabbing";
    };
    const move = (row, x, event) => {
      const drag = this._drag;
      if (!drag) return;
      const dx = x - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      drag.moved = true;
      event.preventDefault();
      row.scrollLeft = drag.scroll - dx * 1.2;
    };
    const end = (event) => {
      if (!this._drag) return;
      this._drag = null;
      event.currentTarget.style.cursor = "grab";
    };
    this._rowDrag = {
      mousedown: (event) => start(event.currentTarget, event.pageX),
      mousemove: (event) => move(event.currentTarget, event.pageX, event),
      end,
      touchstart: {
        handleEvent: (event) => {
          if (event.touches.length === 1) start(event.currentTarget, event.touches[0].pageX);
        },
        passive: true,
      },
      touchmove: {
        handleEvent: (event) => {
          if (event.touches.length === 1) move(event.currentTarget, event.touches[0].pageX, event);
        },
        passive: false,
      },
      touchend: { handleEvent: end, passive: true },
    };
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "contents";
  }

  // The open section: the picked one, else the first (also when the picked
  // one was hidden since).
  _openSection() {
    return (
      this.sections.find((section) => section.key === this._open) ||
      this.sections[0]
    );
  }

  _content(section) {
    if (section.empty)
      return html`<div class="ys-empty">${this.options.emptyLabel || "Empty"}</div>`;
    return typeof section.content === "function"
      ? section.content(this.layout)
      : section.content;
  }

  _action(section) {
    return section.action ? section.action(this.layout) : nothing;
  }

  // An action under the content (tabs, dropdown, preview-hover): on the
  // right (none when the section has none to show).
  _actionBelow(section) {
    const action = section.action?.(this.layout);
    return action && action !== nothing
      ? html`<div class="ys-action">${action}</div>`
      : nothing;
  }

  _mark(section) {
    return section.marked === undefined
      ? nothing
      : html`<span class="ys-mark${section.marked ? " visible" : ""}"></span>`;
  }

  _classes(base) {
    const { style, bordered } = this.options;
    return `${base}${style ? ` style-${style}` : ""}${bordered ? " ys-bordered" : ""}`;
  }

  render() {
    if (!this.sections.length) return nothing;
    const layout = SECTION_LAYOUTS.includes(this.layout) ? this.layout : "side";
    return this[`_${layout.replace("-", "_")}`]();
  }

  // ── side by side ─────────────────────────────────────────────────────
  _side() {
    const { width = 100, zoom = false, radius } = this.options;
    const zoomed = zoom && this.sections.some((s) => s.key === this._zoomed) ? this._zoomed : null;
    const open = (key) => {
      if (!zoom || this._zoomed === key) return;
      // The row's scroll position, restored when the zoom closes.
      this._scrollLeft = this.querySelector(".ys-side")?.scrollLeft || 0;
      this._zoomed = key;
    };
    const close = (event) => {
      event.stopPropagation();
      const scroll = this._scrollLeft || 0;
      this._zoomed = null;
      // After the cards' width transition (0.3 s).
      this.updateComplete.then(() =>
        setTimeout(() => {
          const row = this.querySelector(".ys-side");
          if (row) row.scrollLeft = scroll;
        }, 350),
      );
    };
    const drag = this._rowDrag;
    return html`<div
      class=${this._classes(`ys-side${zoomed ? " zoom-mode" : ""}`)}
      style="--ys-side-width:${width}%;--ys-card-radius:${radius ?? 16}px"
      @mousedown=${drag.mousedown}
      @mousemove=${drag.mousemove}
      @mouseup=${drag.end}
      @mouseleave=${drag.end}
      @touchstart=${drag.touchstart}
      @touchmove=${drag.touchmove}
      @touchend=${drag.touchend}
      @touchcancel=${drag.touchend}
    >
      ${this.sections.map(
        (section) => html`<div
          class="ys-side-card yc-stack yc-controls${zoomed === section.key ? " zoomed" : ""}"
          @click=${() => open(section.key)}
          style=${zoom && !zoomed ? "cursor:pointer" : ""}
        >
          ${zoomed === section.key
            ? html`<button class="ys-side-collapse" @click=${close}>← Show All</button>`
            : nothing}
          <div class="ys-card-top">
            <div class="ys-card-title">${section.title}${this._mark(section)}</div>
            ${this._action(section)}
          </div>
          ${this._content(section)}
        </div>`,
      )}
    </div>`;
  }

  // ── carousel ─────────────────────────────────────────────────────────
  _carousel() {
    const { buttonShape = "rounded", wrap = false, radius } = this.options;
    const count = this.sections.length;
    const index = Math.min(this._index, count - 1);
    return html`<div class=${this._classes("ys-carousel")}>
      ${renderCarousel({
        items: this.sections,
        currentIndex: index,
        buttonShape,
        showAsCard: true,
        wrapNavigation: wrap,
        roundedCards: radius,
        onNavigate: (direction) => {
          let next = index + direction;
          if (wrap) next = (next + count) % count;
          this._index = Math.max(0, Math.min(next, count - 1));
        },
        onSetIndex: (next) => (this._index = next),
        renderItem: (section) => html`
          <div class="ys-card-top">
            <div class="ys-card-title">${section.title}${this._mark(section)}</div>
            ${this._action(section)}
          </div>
          ${this._content(section)}
        `,
      })}
    </div>`;
  }

  // ── tabs ─────────────────────────────────────────────────────────────
  _tabs() {
    const open = this._openSection();
    return html`<div class=${this._classes("ys-tabs yc-stack yc-controls")}>
      ${tabBar({
        tabs: this.sections.map((section) => ({
          key: section.key,
          label: section.title,
          icon: this.options.tabIcons ? section.icon : undefined,
          extra: this._mark(section),
        })),
        active: open.key,
        label: this.options.label,
        onSelect: (key) => (this._open = key),
      })}
      <div class="ys-tab-content" data-section-id=${open.key}>
        ${this._content(open)}${this._actionBelow(open)}
      </div>
    </div>`;
  }

  // ── dropdown ─────────────────────────────────────────────────────────
  _dropdown() {
    const open = this._openSection();
    return html`<div class=${this._classes("ys-dropdown yc-stack yc-controls")}>
      <select
        class="ys-dropdown-select"
        aria-label=${this.options.label || nothing}
        @change=${(event) => (this._open = event.target.value)}
      >
        ${this.sections.map(
          (section) =>
            html`<option value=${section.key} ?selected=${section.key === open.key}>${section.title}</option>`,
        )}
      </select>
      <div class="ys-dropdown-content" data-section-id=${open.key}>
        ${this._content(open)}${this._actionBelow(open)}
      </div>
    </div>`;
  }

  // ── preview hover ────────────────────────────────────────────────────
  _preview_hover() {
    return html`<yc-preview-hover
      .sections=${this.sections.map((section) => ({
        key: section.key,
        title: section.title,
        content: section.empty
          ? null
          : html`${this._content(section)}${this._actionBelow(section)}`,
      }))}
      .contentStyles=${this.options.contentStyles}
      ?overlay=${this.options.overlay === true}
      ?bordered=${this.options.bordered === true}
    ></yc-preview-hover>`;
  }

  // ── grouped (accordion) ──────────────────────────────────────────────
  _grouped() {
    const expanded = this.sections.some((s) => s.key === this._expanded) ? this._expanded : null;
    const style = this.options.style ? ` style-${this.options.style}` : "";
    return html`<div class="ys-grouped yc-stack yc-controls${this.options.bordered ? " ys-bordered" : ""}">
      ${this.sections.map((section, index) => {
        const open = section.key === expanded;
        const state = open ? "expanded" : expanded ? "collapsed hidden" : "collapsed";
        return html`<div
          class="ys-grouped-section${style} ${state}"
          data-section-id=${section.key}
          style="z-index: ${open ? 100 : 10 - index};"
        >
          <div
            class="ys-grouped-header"
            @click=${() => (this._expanded = open ? null : section.key)}
          >
            <div class="ys-grouped-header-left">
              <span class="ys-grouped-icon">${section.icon}${this._mark(section)}</span>
              <div class="ys-grouped-title-area">
                <span class="ys-grouped-title">${section.title}</span>
                ${section.description
                  ? html`<span class="ys-grouped-description">${section.description}</span>`
                  : nothing}
              </div>
            </div>
            <div class="ys-grouped-header-right">${this._action(section)}</div>
          </div>
          <div class="ys-grouped-content" data-section=${section.key}>
            ${this._content(section)}
          </div>
        </div>`;
      })}
    </div>`;
  }

  // ── radial ───────────────────────────────────────────────────────────
  _radial() {
    const open = this._openSection();
    const { cx, cy, outer, inner } = WHEEL;
    const step = 180 / this.sections.length;
    const point = (radius, angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    const rad = (degrees) => (degrees * Math.PI) / 180;
    const segments = this.sections.map((section, index) => {
      // From -90° (top) to 90° (bottom): the wheel's right half.
      const start = rad(-90 + index * step);
      const end = rad(-90 + (index + 1) * step);
      const [x1, y1] = point(inner, start);
      const [x2, y2] = point(outer, start);
      const [x3, y3] = point(outer, end);
      const [x4, y4] = point(inner, end);
      const [ix, iy] = point((inner + outer) / 2, (start + end) / 2);
      const active = section.key === open.key;
      return svg`<path
          class="ys-radial-segment${active ? " active-category" : ""}${section.marked ? " has-changes" : ""}"
          d="M ${x1} ${y1} L ${x2} ${y2} A ${outer} ${outer} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${inner} ${inner} 0 0 0 ${x1} ${y1} Z"
          data-category=${section.key}
          data-section-id=${section.key}
          @click=${() => (this._open = section.key)}
        ><title>${section.title}</title></path>
        <text
          x=${ix}
          y=${iy}
          class="ys-radial-icon ${active ? "active-category" : ""}"
          text-anchor="middle"
          dominant-baseline="middle"
          pointer-events="none"
        >${section.icon}</text>`;
    });
    const separators = this.sections.slice(1).map((_, i) => {
      const angle = rad(-90 + (i + 1) * step);
      const [x1, y1] = point(inner, angle);
      const [x2, y2] = point(outer, angle);
      return svg`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} class="ys-radial-separator" pointer-events="none" />`;
    });
    const innerArc = `M ${cx} ${cy - inner} A ${inner} ${inner} 0 0 1 ${cx} ${cy + inner}`;
    const outerArc = `M ${cx} ${cy - outer} A ${outer} ${outer} 0 0 1 ${cx} ${cy + outer}`;
    return html`<div class=${this._classes("ys-radial")}>
      <div class="ys-radial-wheel-box">
        <svg class="ys-radial-wheel" viewBox="-5 0 80 160">
          ${segments}
          <path
            d="${innerArc} L ${cx} ${cy + inner} L ${cx} ${cy - inner} Z"
            class="ys-radial-center"
          />
          ${separators}
          <path d=${outerArc} class="ys-radial-outer" pointer-events="none" />
          ${svg`<text
            x=${inner / 2}
            y=${cy}
            class="ys-radial-center-icon"
            text-anchor="middle"
            dominant-baseline="middle"
          ><title>${open.title}</title>${open.icon}</text>`}
        </svg>
      </div>
      <div class="ys-radial-panel" data-section-id=${open.key}>
        <div class="ys-radial-header">
          <div class="ys-radial-title">${open.title}${this._mark(open)}</div>
          ${this._action(open)}
        </div>
        ${this._content(open)}
      </div>
    </div>`;
  }

  // ── categories ───────────────────────────────────────────────────────
  _categories() {
    const open = this._openSection();
    return html`<div class=${this._classes("ys-categories")}>
      <div class="ys-categories-column">
        ${this.sections.map(
          (section) => html`<div
            class="ys-categories-button ${section.key === open.key ? "active" : ""}"
            @click=${() => (this._open = section.key)}
            title=${section.title}
          >
            <span class="ys-categories-icon">${section.icon}</span>
            ${this._mark(section)}
          </div>`,
        )}
      </div>
      <div class="ys-categories-panel" data-section-id=${open.key}>
        <div class="ys-categories-header">
          <div class="ys-categories-title">${open.title}</div>
          ${this._action(open)}
        </div>
        ${this._content(open)}
      </div>
    </div>`;
  }

  // ── compact ──────────────────────────────────────────────────────────
  _compact() {
    const headers = this.options.headers !== false;
    return html`<div class=${this._classes(`ys-compact${headers ? "" : " ys-plain"}`)}>
      ${this.sections.map(
        (section) => html`<div class="ys-compact-section" data-section-id=${section.key}>
          ${headers
            ? html`<div class="ys-compact-header">
                <span class="ys-compact-icon">${section.icon}</span>
                <span class="ys-compact-title">${section.title}${this._mark(section)}</span>
                ${this._action(section)}
              </div>`
            : nothing}
          ${this._content(section)}
        </div>`,
      )}
    </div>`;
  }
}

defineOnce("yc-sections", YcSections);

/** The layouts' CSS (in the card's stylesheet: the component renders in the
 * card's light DOM). The section contents keep their card's own CSS. */
export const sectionLayoutStyles = `
  /* The change dot ("marked" sections). */
  .ys-mark {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-color, #ff9800);
    margin-left: 6px;
    opacity: 0;
    transform: scale(0);
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 0 8px rgba(255, 152, 0, 0.6);
    position: relative;
    top: -2px;
  }
  .ys-mark.visible {
    opacity: 1;
    transform: scale(1);
  }
  .ys-mark::after {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    border-radius: 50%;
    background: rgba(255, 152, 0, 0.3);
    animation: pulse-indicator 2s infinite;
  }
  @keyframes pulse-indicator {
    0%, 100% { transform: scale(1); opacity: 0.3; }
    50% { transform: scale(1.3); opacity: 0; }
  }
  /* An action under a section's content (a reset). */
  .ys-action {
    display: flex;
    justify-content: flex-end;
  }
  .ys-empty {
    font-size: 0.85em;
    color: var(--secondary-text-color, #888);
    font-style: italic;
    padding: 8px 0;
    text-align: center;
    width: 100%;
  }

  /* === Side by side === */
  .ys-side {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 4px;
    white-space: nowrap;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE 10+ */
    cursor: grab;
    user-select: none;
    padding: 5px;
  }
  .ys-side * {
    user-select: none;
  }
  .ys-side::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }
  .ys-side-card {
    background: var(--card-background-color, #fff);
    border-radius: var(--ys-card-radius, 8px);
    box-shadow: 0 2px 8px #0002;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: var(--ys-side-width, 100%);
    flex-shrink: 0;
    box-sizing: border-box;
    overflow: hidden;
    white-space: normal;
    transition:
      width 0.3s ease,
      min-width 0.3s ease,
      flex 0.3s ease,
      padding 0.3s ease,
      opacity 0.3s ease;
  }
  /* Force every content inside a side card to respect the card width. */
  .ys-side-card > * {
    max-width: 100%;
    box-sizing: border-box;
  }
  /* Click-to-zoom: the zoomed card fills the row, the others collapse. */
  .ys-side.zoom-mode .ys-side-card.zoomed {
    flex: 1 0 100%;
    width: 100%;
    min-width: 100%;
    cursor: default;
  }
  .ys-side.zoom-mode .ys-side-card:not(.zoomed) {
    flex: 0 0 0px;
    width: 0;
    min-width: 0;
    padding: 0;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .ys-side.zoom-mode {
    gap: 0;
    overflow-x: hidden;
    width: 100%;
    transition: gap 0.3s ease;
  }
  .ys-side-collapse {
    align-self: flex-end;
    background: color-mix(
      in srgb,
      var(--primary-color, #0077cc) 12%,
      var(--card-background-color, #fff)
    );
    border: 1px solid
      color-mix(in srgb, var(--primary-color, #0077cc) 25%, transparent);
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 0.82em;
    font-weight: 500;
    color: var(--primary-color, #0077cc);
    cursor: pointer;
    margin-bottom: 6px;
    transition: background 0.2s;
  }
  .ys-side-collapse:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #0077cc) 22%,
      var(--card-background-color, #fff)
    );
  }
  /* A side or carousel card's title row (title, action). */
  .ys-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 12px;
  }
  .ys-card-title {
    font-size: 1em;
    font-weight: 500;
    color: var(--primary-text-color, #444);
    margin: 0;
    width: auto;
    flex: 1 1 auto;
    text-align: left;
    display: block;
    align-self: center;
  }

  /* === Carousel (the shared carousel, carousel-utils.js) === */
  .ys-carousel {
    width: 100%;
    display: block;
  }
  /* The title row centred over the section (as wide as its content). */
  .ys-carousel .ys-card-top {
    width: auto;
  }

  /* === Tabs (the shared tab bar, tab-bar.js) === */
  .ys-tabs {
    width: 100%;
  }
  /* A change dot in a tab: positioned so it never moves the label. */
  .yc-tab .ys-mark {
    position: absolute;
    top: 6px;
    right: 6px;
    margin-left: 0;
  }
  .ys-tab-content {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
  }

  /* === Dropdown === */
  .ys-dropdown {
    width: 100%;
  }
  .ys-dropdown-select {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--divider-color, #d0d7de);
    font-size: 0.9em;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #333);
    font-weight: 500;
    cursor: pointer;
    width: fit-content;
    transition: border-color 0.2s;
  }
  .ys-dropdown-select:focus {
    outline: none;
    border-color: var(--primary-color, #0077cc);
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--primary-color, #0077cc) 15%, transparent);
  }
  .ys-dropdown-content {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* The sections' border (bordered). */
  .ys-bordered .ys-side-card,
  .ys-bordered .carousel-content-card,
  .ys-bordered .ys-grouped-section,
  .ys-bordered .ys-compact-section {
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
  }
  .ys-bordered .ys-tab-content,
  .ys-bordered .ys-dropdown-content,
  .ys-bordered.ys-radial,
  .ys-bordered.ys-categories,
  .ys-bordered.ys-compact.ys-plain {
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    padding: 8px;
    box-sizing: border-box;
  }

  /* === Grouped (accordion) === */
  .ys-grouped {
    position: relative;
    width: 100%;
  }
  .ys-grouped-section {
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
    transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                margin 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.3s ease,
                border-color 0.3s ease,
                box-shadow 0.3s ease,
                transform 0.3s ease;
    position: relative;
    max-height: 1000px;
    opacity: 1;
  }
  /* Subtle: gentle tinted background */
  .ys-grouped-section.style-subtle {
    background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  /* Flat: transparent, blends with card/dashboard background */
  .ys-grouped-section.style-flat {
    background: transparent;
    box-shadow: none;
  }
  /* Filled: full secondary background for strong separation */
  .ys-grouped-section.style-filled {
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .ys-grouped-section.hidden {
    display: none;
    max-height: 0;
    opacity: 0;
    padding: 0;
    border: none;
    pointer-events: none;
  }
  .ys-grouped-section:hover {
    border-color: rgba(3, 169, 244, 0.4);
    transform: translateY(-2px);
  }
  .ys-grouped-section.style-subtle:hover,
  .ys-grouped-section.style-filled:hover {
    box-shadow: 0 4px 16px rgba(3, 169, 244, 0.15);
  }
  .ys-grouped-section.style-flat:hover {
    box-shadow: none;
  }
  .ys-grouped-section.expanded {
    border-color: rgba(3, 169, 244, 0.3);
  }
  .ys-grouped-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10px 2px;
    background: transparent;
    cursor: pointer;
    user-select: none;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .ys-grouped-header:hover {
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
  }
  .ys-grouped-header:active {
    transform: scale(0.99);
  }
  .ys-grouped-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
  }
  .ys-grouped-icon {
    font-size: 24px;
    min-width: 30px;
    text-align: center;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
    transition: transform 0.3s ease;
  }
  .ys-grouped-section:hover .ys-grouped-icon {
    transform: scale(1.1);
  }
  .ys-grouped-title-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ys-grouped-title {
    font-size: 1em;
    font-weight: 700;
    color: var(--primary-text-color);
    letter-spacing: 0.3px;
  }
  .ys-grouped-description {
    font-size: 0.75em;
    color: var(--secondary-text-color);
    opacity: 0.8;
  }
  .ys-grouped-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ys-grouped-content {
    max-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
    padding: 0 14px 0 14px;
    transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                padding 0.3s ease;
  }
  .ys-grouped-section.expanded .ys-grouped-content {
    max-height: 2000px;
    padding: 12px 14px 14px 14px;
  }

  /* === Radial === */
  .ys-radial {
    width: 100%;
    box-sizing: border-box;
    /* The wheel (absolute, 8 + 160 px) always fits, even beside a short
       section. */
    min-height: 176px;
    display: flex;
    gap: 0;
    padding: 16px;
    padding-left: 90px;
    padding-right: 0;
    border-radius: 12px;
    align-items: flex-start;
    position: relative;
  }
  .ys-radial-wheel-box {
    flex: 0 0 80px;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    position: absolute;
    left: 0px;
    top: 0;
    z-index: 1;
    width: 80px;
    height: 160px;
    padding-top: 8px;
    overflow: visible;
  }
  .ys-radial-wheel {
    width: 80px;
    height: 160px;
    filter: drop-shadow(1px 1px 3px rgba(0, 0, 0, 0.15));
    overflow: visible;
    will-change: auto;
    backface-visibility: hidden;
    transform: translateZ(0);
  }
  /* Single ring segments - clearly defined clickable areas */
  .ys-radial-segment {
    fill: var(--card-background-color, #fff);
    stroke: none;
    cursor: pointer;
    transition: fill 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                stroke 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                stroke-width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                filter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: fill, stroke;
  }
  .ys-radial-segment:hover {
    fill: var(--secondary-background-color, rgba(200, 200, 200, 0.3));
  }
  .ys-radial-segment.active-category {
    fill: rgba(3, 169, 244, 0.15);
    stroke: rgba(3, 169, 244, 0.6);
    stroke-width: 1;
  }
  /* Highlight segments with changed values */
  .ys-radial-segment.has-changes {
    fill: rgba(255, 152, 0, 0.12);
    stroke: rgba(255, 152, 0, 0.5);
    stroke-width: 1.5;
  }
  .ys-radial-segment.has-changes:hover {
    fill: rgba(255, 152, 0, 0.2);
  }
  /* Active category with changes - combine both styles */
  .ys-radial-segment.active-category.has-changes {
    fill: rgba(255, 152, 0, 0.25);
    stroke: rgba(255, 152, 0, 0.7);
    stroke-width: 2;
    filter: drop-shadow(0 0 6px rgba(255, 152, 0, 0.4));
  }
  .ys-radial-separator {
    display: block;
    stroke: var(--divider-color, rgba(200, 200, 200, 0.3));
    stroke-width: 1.5;
    pointer-events: none;
  }
  /* Outer circle border */
  .ys-radial-outer {
    display: block;
    fill: none;
    stroke: var(--divider-color, rgba(200, 200, 200, 0.3));
    stroke-width: 1.5;
    pointer-events: none;
  }
  .ys-radial-icon {
    font-size: 14px;
    fill: var(--secondary-text-color, rgba(128, 128, 128, 0.7));
    transition: all 0.3s ease;
    pointer-events: none;
  }
  .ys-radial-icon.active-category {
    font-size: 15px;
    fill: rgba(3, 169, 244, 0.8);
  }
  /* Center circle */
  .ys-radial-center {
    fill: var(--card-background-color, #fff);
    stroke: var(--divider-color, rgba(0, 0, 0, 0.12));
    stroke-width: 1;
  }
  .ys-radial-center-icon {
    font-size: 22px;
    fill: var(--primary-color, #03a9f4);
    pointer-events: none;
  }
  /* The open section */
  .ys-radial-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-left: 0;
    position: relative;
    z-index: 2;
  }
  .ys-radial-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    margin-bottom: 4px;
  }
  .ys-radial-title {
    font-size: 1.1em;
    font-weight: 600;
    color: var(--primary-text-color);
    align-self: self-start;
  }
  @media (max-width: 768px) {
    .ys-radial {
      flex-direction: row;
      padding: 12px;
      padding-left: 80px;
      align-items: flex-start;
      position: relative;
      gap: 8px;
    }
    .ys-radial-wheel-box {
      flex: 0 0 80px;
      left: 0;
      position: absolute;
      z-index: 1;
      width: 80px;
      height: 160px;
      top: 12px;
    }
    .ys-radial-wheel {
      width: 80px;
      height: 160px;
    }
    .ys-radial-panel {
      flex: 1;
      margin-left: 0;
      background: var(--card-background-color, #1c1c1c);
      position: relative;
      z-index: 2;
      min-width: 0;
    }
    /* Keep all icons visible on mobile */
    .ys-radial-icon {
      font-size: 12px;
    }
    .ys-radial-icon.active-category {
      font-size: 14px;
    }
  }

  /* === Categories === */
  .ys-categories {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    gap: 12px;
    border-radius: 8px;
    align-items: stretch;
  }
  /* Icon column on the left */
  .ys-categories-column {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: transparent;
    border-radius: 8px;
    border: none;
  }
  .ys-categories-button {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: transparent;
    border: 1px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: relative; /* For absolute positioning of the change dot */
  }
  .ys-categories-button:hover {
    background: var(--secondary-background-color, rgba(200, 200, 200, 0.15));
    border-color: var(--divider-color, rgba(200, 200, 200, 0.2));
    transform: scale(1.1);
  }
  .ys-categories-button.active {
    background: rgba(3, 169, 244, 0.15);
    border: 2px solid rgba(3, 169, 244, 0.6);
    box-shadow: 0 0 12px rgba(3, 169, 244, 0.4);
  }
  .ys-categories-icon {
    font-size: 20px;
    transition: all 0.3s ease;
  }
  .ys-categories-button.active .ys-categories-icon {
    filter: drop-shadow(0 0 4px rgba(3, 169, 244, 0.6));
  }
  .ys-categories-button .ys-mark {
    position: absolute;
    top: -2px;
    right: -2px;
    margin-left: 0;
  }
  /* The open section */
  .ys-categories-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: transparent;
    border-radius: 8px;
    border: none;
  }
  .ys-categories-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--divider-color, rgba(200, 200, 200, 0.15));
    margin-bottom: 6px;
  }
  .ys-categories-title {
    font-size: 1.15em;
    font-weight: 600;
    color: var(--primary-text-color);
  }

  /* === Compact: every section in one panel === */
  .ys-compact {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: 8px;
  }
  .ys-compact-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 8px;
    box-sizing: border-box;
  }
  /* Without headers the sections' contents are the panel's rows. */
  .ys-compact.ys-plain .ys-compact-section {
    display: contents;
  }
  .ys-compact.style-subtle .ys-compact-section {
    background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
  }
  .ys-compact.style-filled .ys-compact-section {
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
  }
  .ys-compact-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85em;
    font-weight: 600;
    color: var(--secondary-text-color);
  }
  .ys-compact-icon {
    font-size: 1.2em;
  }
  .ys-compact-title {
    flex: 1;
    display: inline-flex;
    align-items: center;
  }
`;
