import { LitElement, html, unsafeHTML } from "./lib/lit-all.js";
import {
  renderTextStyleSelector,
  renderPreviewStyleSelector,
  bindStyleSelectorEvents,
  selectorPagination,
} from "./style-selector-utils.js";
import {
  renderOriginalGallery,
  bindOriginalGallery,
  renderMatrixPreview,
  markFavouriteModes,
} from "./gallery-display-utils.js";
import {
  attachPaginationListeners,
  requestedPage,
} from "./pagination-utils.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import { escapeHtml } from "./html-escape-utils.js";

/** Interactive selector owner for both cards. Light DOM intentionally inherits
 * the card's existing styles and lets its domain painter update preview cells.
 * Items: {name, title, dataMode, colorData, badge?, preview?}. No HA attributes.
 * Cards receive selections and browser-updated, never bind this DOM themselves.
 */
class YeelightStyleBrowser extends LitElement {
  static properties = {
    config: { attribute: false },
    items: { attribute: false },
    active: {},
    model: { attribute: false },
    disabled: { type: Boolean },
    query: { state: true },
    page: { state: true },
    index: { state: true },
    searchLabel: {},
    searchClass: {},
    onSelect: { attribute: false },
    onQuery: { attribute: false },
    heading: {},
  };

  constructor() {
    super();
    this.config = {};
    this.items = [];
    this.query = "";
    this.page = 0;
    this.index = null;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "contents";
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._subscribed?.listeners.delete(this._refresh);
    this._subscribed = null;
    this._wheel?.destroy();
    this._wheel = null;
    this._wheelNode = null;
  }

  get selectorStyle() {
    return (
      this.config.style_selector_style ||
      (this.config.effect_view ? "original" : "preview-grid")
    );
  }

  get visibleItems() {
    const query =
      this.config.show_search === false ? "" : this.query.trim().toLowerCase();
    return this.items.filter((item) => item.name.toLowerCase().includes(query));
  }

  reveal(key) {
    const index = this.visibleItems.findIndex((item) => item.dataMode === key);
    if (index < 0) return;
    this.index = index;
    const size = Number(this.config.items_per_page) || 0;
    this.page = size > 0 ? Math.floor(index / size) : 0;
    this.requestUpdate();
  }

  _changePage(value) {
    const pagination = selectorPagination(
      this.config,
      this.visibleItems,
      this.selectorStyle,
      this.page,
    );
    this.page = requestedPage(
      value,
      pagination.currentPage,
      pagination.totalPages,
    );
  }

  async _select(key) {
    if (this.disabled) return false;
    const success = await this.onSelect?.(key);
    this.requestUpdate();
    return success;
  }

  get activeKey() {
    return this.model?.selectedFavourite?.key || this.active;
  }

  _navigate(delta, index) {
    const items = this.visibleItems;
    if (!items.length || this.disabled) return;
    const current =
      this.index ??
      Math.max(
        0,
        items.findIndex((item) => item.dataMode === this.active),
      );
    const requested = index ?? current + delta;
    this.index =
      this.config.gallery_wrap_navigation === true
        ? ((requested % items.length) + items.length) % items.length
        : Math.max(0, Math.min(requested, items.length - 1));
    this._select(items[this.index].dataMode);
  }

  _originalPreview(item) {
    if (item.preview === false)
      return '<div class="unmodelled">Preview unavailable</div>';
    const appearance = browserPreviewAppearance(this.config);
    return `<div class="original-item-preview" data-preview="${escapeHtml(item.dataMode)}" style="width:${appearance.width}%;margin-inline:auto;">${renderMatrixPreview(item.colorData, { ...appearance, rows: 5, cols: 20, forceAspectRatio: true })}</div>`;
  }

  render() {
    if (this.config.show_search === false) this.query = "";
    const items = this.visibleItems;
    const signature = JSON.stringify(items.map((item) => item.dataMode));
    if (signature !== this._signature) {
      this._signature = signature;
      this.page = 0;
      this.index = null;
    }
    if (this.activeKey !== this._lastActive) {
      this._lastActive = this.activeKey;
      const index = items.findIndex((item) => item.dataMode === this.activeKey);
      if (index >= 0) this.index = index;
    }
    const active = this.activeKey;
    const style = this.selectorStyle;
    const pagination = selectorPagination(this.config, items, style, this.page);
    this.page = pagination.currentPage;
    let markup = "";
    if (style === "original") {
      markup =
        renderOriginalGallery(
          pagination.items.map((item) => ({
            ...item,
            previewHtml: this._originalPreview(item),
          })),
          {
            view: this.config.effect_view === "list" ? "list" : "grid",
            showBadges: this.config.show_badges !== false,
            highlight: this.config.highlight_active_mode !== false,
            current: active,
          },
        ) + pagination.html;
    } else if (style.startsWith("preview-")) {
      const state = { page: this.page, index: this.index };
      markup = renderPreviewStyleSelector(
        this.config,
        items,
        style,
        active,
        state,
      );
      this.index = state.index;
    } else {
      markup = renderTextStyleSelector(this.config, items, style, active);
    }
    return html`${this.config.show_search !== false
        ? html`<input
            class=${this.searchClass || "search"}
            type="search"
            aria-label=${this.searchLabel || "Search styles"}
            placeholder=${this.searchLabel || "Search styles"}
            style="box-sizing:border-box;width:100%;min-width:0;padding:10px;margin:8px 0;border:1px solid var(--divider-color,#ddd);border-radius:6px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit;"
            .value=${this.query}
            @keydown=${(event) => event.stopPropagation()}
            @keyup=${(event) => event.stopPropagation()}
            @input=${(event) => {
              this.query = event.target.value;
              this.page = 0;
              this.index = null;
              this.onQuery?.(this.query);
            }}
          />`
        : ""}
      <div class=${this.heading ? "section" : ""}>
        ${this.heading
          ? html`<div class="section-title">${this.heading}</div>`
          : ""}
        <div
          class=${style === "original"
            ? "original-browser"
            : "reference-selector"}
          ?inert=${this.disabled}
        >
          ${items.length
            ? unsafeHTML(markup)
            : html`<div class="empty" role="status">No matching styles.</div>`}
        </div>
      </div>`;
  }

  firstUpdated() {
    attachPaginationListeners(this, (value) => this._changePage(value));
  }

  updated() {
    if (this.model !== this._subscribed) {
      this._subscribed?.listeners.delete(this._refresh);
      this._refresh ||= () => this.requestUpdate();
      this._subscribed = this.model;
      this._subscribed?.listeners.add(this._refresh);
    }
    bindStyleSelectorEvents(this, {
      select: (key) => this._select(key),
      navigate: (delta) => this._navigate(delta),
      setIndex: (index) => this._navigate(0, index),
      style: this.selectorStyle,
    });
    bindOriginalGallery(this, { select: (key) => this._select(key) });
    const node = this.querySelector('[data-wheel-scroll="true"]');
    if (node !== this._wheelNode) {
      this._wheel?.destroy();
      this._wheel = null;
      this._wheelNode = node;
    }
    if (node && !this._wheel)
      this._wheel = initializeWheelNavigation({
        shadowRoot: this,
        displayMode: "wheel",
        immediate: true,
        config: {
          ...this.config,
          wheel_display_style:
            this.config.preview_show_titles === false ? "compact" : "default",
        },
        getCurrentMode: () => this.activeKey,
        onModeSelect: async (key) => this._select(key),
      });
    else this._wheel?.sync();
    this.querySelectorAll(".reference-selector [data-mode]").forEach((node) => {
      if (
        this.config.highlight_active_mode !== false &&
        node.dataset.mode === this.activeKey
      )
        node.setAttribute("data-active-mode", "true");
      else node.removeAttribute("data-active-mode");
    });
    if (this.model)
      markFavouriteModes(
        this,
        this.model.favourites,
        this.model.adapter.currentColorMode?.(),
        this.model.adapter.currentColor?.(),
      );
    this.dispatchEvent(new CustomEvent("browser-updated", { bubbles: true }));
  }
}

export function browserPreviewAppearance(config) {
  const background = config.gallery_background_color || "black";
  const spacing = config.gallery_spacing_mode || "normal";
  return {
    width: Math.max(30, Math.min(100, Number(config.preview_size) || 55)),
    pixelStyle: ["circle", "rounded"].includes(config.gallery_pixel_style)
      ? config.gallery_pixel_style
      : "square",
    pixelGap: spacing === "normal" ? 3 : 0,
    pixelBoxShadow: ["subtle", "normal"].includes(spacing),
    matrixBoxShadow: config.gallery_matrix_box_shadow === true,
    bgColor:
      background === "white"
        ? "#fff"
        : background === "transparent"
          ? "transparent"
          : "#000",
    ignoreBlackPixels:
      background !== "black" && config.gallery_ignore_black_pixels === true,
  };
}

customElements.define("yeelight-style-browser", YeelightStyleBrowser);
