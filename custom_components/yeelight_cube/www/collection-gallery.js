/**
 * <yc-collection-gallery>: the shared gallery every card uses to browse and
 * pick one item of a collection (clock styles, native effects; later gradient
 * modes, palettes and pixel arts). Cards use it the same way:
 *
 *   html`<yc-collection-gallery
 *     .config=${this.config}            // the card config (options below)
 *     .items=${items}                   // [{dataMode, name, title, colorData,
 *                                       //   label?, swatch?, badge?, preview?,
 *                                       //   favourite?}]
 *     .active=${key}                    // the item the lamp shows (or null)
 *     .model=${this._controls}          // mode-controls model: favourites
 *     .disabled=${busy}                 // inert while a command runs
 *     .revealKey=${key}                 // turn to this item once (optional)
 *     heading="Clock style"             // title above the items (optional)
 *     searchLabel="Search clock modes"
 *     .onSelect=${(key) => choose(key)} // a pick; resolves when applied
 *     .onQuery=${(query) => …}          // the search text (optional)
 *     @gallery-updated=${() => paint()} // the items' DOM changed: repaint
 *   ></yc-collection-gallery>`
 *
 * Items: `dataMode` is the key, `name` is searched and listed (dropdown),
 * and the card's `item_labels` rename items for display (itemLabel; search
 * matches the label and the built-in name),
 * `title` captions the previews, `label` is an optional shorter button text
 * (filled, chips), `swatch` a CSS background shown by chips, `colorData` the
 * 100-pixel preview frame.
 *
 * Layouts (`style_selector_style`):
 *   text:     filled, dropdown, chips
 *   preview:  preview-list, preview-grid, preview-strip, preview-carousel,
 *             preview-wheel, preview-album
 *   original: original (grid or list with `effect_view`, capability badges)
 * Shared options: show_search, items_per_page (list, grid, original),
 * preview_show_titles, highlight_active_mode, gallery_wrap_navigation,
 * wheel_nav_position / wheel_height, album_3d_effect, preview_size,
 * selector_shape / selector_button_shape (items and arrows, every preview
 * layout but list and grid) and the gallery_* matrix appearance
 * (browserPreviewAppearance).
 *
 * Behaviour shared by every card:
 * - new items' colors only (text, colors, angle changed) repaint the
 *   previews in place; the DOM, scroll, hover and wheel position are kept;
 * - the picked item pulses until onSelect resolves;
 * - the active item is outlined (highlight_active_mode), except in the
 *   carousel, whose only visible item is always the active one;
 * - "No matching items" only follows a search: no items yet (previews
 *   still loading) shows nothing.
 *
 * It renders in the card's light DOM, so the card includes
 * collectionGalleryStyles in its static styles. Cards that animate their
 * previews paint them on gallery-updated: every item preview is a
 * `[data-mode]` element holding a `.gallery-matrix-preview` grid of 100 cells.
 */
import { LitElement, html, unsafeHTML } from "./lib/lit-all.js";
import {
  renderTextStyleSelector,
  renderPreviewStyleSelector,
  bindStyleSelectorEvents,
  selectorPagination,
  selectorPageSize,
  styleSelectorStyles,
  gallerySelectorStyle,
} from "./style-selector-utils.js";
import {
  renderOriginalGallery,
  bindOriginalGallery,
  renderMatrixPreview,
  paintMatrixPreview,
  markFavouriteModes,
} from "./gallery-display-utils.js";
import {
  attachPaginationListeners,
  requestedPage,
  paginationStyles,
} from "./pagination-utils.js";
import {
  albumStyles,
  renderAlbumView,
  setupAlbumNavigation,
} from "./album-view-coverflow.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import {
  resolveSelectorShape,
  resolveSelectorButtonShape,
  selectorShapeToCarouselButtonShape,
} from "./selector-shared-styles.js";
import { escapeHtml } from "./html-escape-utils.js";
import { defineOnce } from "./card-registration.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { itemLabel, itemMatchesQuery } from "./card-config.js";

// Class prefix of the album markup (album-view-coverflow.js).
const ALBUM = "collection";
// Item corner radius (px) of each selector shape: the same as the other
// preview layouts (selector-shared-styles.js).
const SHAPE_RADIUS = { square: 0, rounded: 8, round: 18 };

/** Everything the gallery's markup needs (the filled text layout renders
 * shared action buttons); cards include it once. */
export const collectionGalleryStyles = `
  ${actionButtonStyles}
  ${styleSelectorStyles}
  ${paginationStyles}
  ${albumStyles(ALBUM)}
  /* Carousel: each item draws its own background, so the wrapper card
     stays transparent around it. */
  .gc-preview-shell .carousel-content-card {
    background: transparent !important;
    box-shadow: none !important;
    padding: 0 !important;
  }
  .yc-gallery-search {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--divider-color, #ddd);
    border-radius: 6px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    font: inherit;
  }
  .collection-album-entry {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }
  .collection-album-entry .gallery-item-title {
    font-weight: 600;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .collection-album-entry[data-active-mode="true"] {
    box-shadow: inset 0 0 0 2px var(--primary-color, #03a9f4);
    border-radius: inherit;
  }
`;

class YcCollectionGallery extends LitElement {
  static properties = {
    config: { attribute: false },
    items: { attribute: false },
    active: {},
    model: { attribute: false },
    disabled: { type: Boolean },
    revealKey: { attribute: false },
    heading: {},
    searchLabel: {},
    onSelect: { attribute: false },
    onQuery: { attribute: false },
    query: { state: true },
    page: { state: true },
    index: { state: true },
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
    this.classList.add("yc-stack", "yc-controls");
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._subscribed?.listeners.delete(this._refresh);
    this._subscribed = null;
    this._wheel?.destroy();
    this._wheel = null;
    this._wheelNode = null;
    this._albumState?._coverflowCleanup?.();
    this._album = null;
    this._albumNode = null;
  }

  get selectorStyle() {
    return gallerySelectorStyle(this.config);
  }

  get visibleItems() {
    const query =
      this.config.show_search === false ? "" : this.query.trim().toLowerCase();
    return this.items
      .map((item) => {
        const label = itemLabel(this.config, item.dataMode, null);
        return label
          ? { ...item, name: label, title: label, label, builtinName: item.name }
          : item;
      })
      .filter((item) =>
        itemMatchesQuery(
          this.config,
          item.dataMode,
          item.builtinName || item.name,
          query,
        ),
      );
  }

  get activeKey() {
    return this.model?.selectedFavourite?.key || this.active;
  }

  /** Show `key` (its page, carousel slot or album card), once. */
  reveal(key) {
    const index = this.visibleItems.findIndex((item) => item.dataMode === key);
    if (index < 0) return;
    this.index = index;
    this.page = this._pageOf(index);
    this._album?.goTo(index);
    this.requestUpdate();
  }

  willUpdate(changed) {
    if (changed.has("revealKey") && this.revealKey != null)
      this.updateComplete.then(() => this.reveal(this.revealKey));
  }

  // The page showing item `index` in the current layout.
  _pageOf(index) {
    const size = selectorPageSize(this.config, this.selectorStyle);
    return size > 0 ? Math.floor(index / size) : 0;
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
    if (this.disabled || key == null) return false;
    this._pendingKey = key;
    this._markPending();
    try {
      return await this.onSelect?.(key);
    } finally {
      if (this._pendingKey === key) this._pendingKey = null;
      this._markPending();
      this.requestUpdate();
    }
  }

  // The picked item pulses until its selection resolves (not in the
  // carousel, where navigating is selecting).
  _markPending() {
    const pending =
      this.selectorStyle === "preview-carousel" ? null : this._pendingKey;
    this.querySelectorAll("[data-mode]").forEach((node) =>
      node.classList.toggle("gc-pending", node.dataset.mode === pending),
    );
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

  // One item's live matrix, in the gallery_* appearance.
  _matrix(item) {
    return renderMatrixPreview(item.colorData, {
      ...browserPreviewAppearance(this.config),
      rows: 5,
      cols: 20,
      forceAspectRatio: true,
    });
  }

  _originalPreview(item) {
    if (item.preview === false)
      return '<div class="unmodelled">Preview unavailable</div>';
    const appearance = browserPreviewAppearance(this.config);
    return `<div class="original-item-preview" data-preview="${escapeHtml(item.dataMode)}" style="width:${appearance.width}%;margin-inline:auto;">${this._matrix(item)}</div>`;
  }

  // Album: a 3D coverflow of the items; the centred card is picked on click.
  _albumMarkup(items) {
    const showTitles = this.config.preview_show_titles !== false;
    return `<div class="gc-preview-shell">${renderAlbumView(
      items,
      (item) => `<div class="collection-album-entry" data-mode="${escapeHtml(item.dataMode)}">
          ${showTitles ? `<div class="gallery-item-title">${escapeHtml(item.title)}</div>` : ""}
          ${this._matrix(item)}
        </div>`,
      {
        // The album card follows the preview size (55% = the 240px card).
        card_size: Math.round(
          ((Number(this.config.preview_size) || 55) / 55) * 100,
        ),
        album_3d_effect: this.config.album_3d_effect,
        rounded_cards: SHAPE_RADIUS[resolveSelectorShape(this.config)],
        album_nav_shape: selectorShapeToCarouselButtonShape(
          resolveSelectorButtonShape(this.config),
        ),
        remove_button_style: "none",
      },
      ALBUM,
    )}</div>`;
  }

  // The markup of `items` in the current layout.
  _markup(items, style, active, pagination) {
    if (style === "original")
      return (
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
        ) + pagination.html
      );
    if (style === "preview-album") return this._albumMarkup(items);
    if (style.startsWith("preview-")) {
      const state = { page: this.page, index: this.index };
      const markup = renderPreviewStyleSelector(
        this.config,
        items,
        style,
        active,
        state,
      );
      this._renderedIndex = state.index;
      return markup;
    }
    return renderTextStyleSelector(this.config, items, style, active);
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
      if (index >= 0) {
        this.index = index;
        // Turn to the page of the newly active item (a rotation step, Next,
        // a favourite); a pick on the page shown stays on it.
        this.page = this._pageOf(index);
      }
    }
    const active = this.activeKey;
    const style = this.selectorStyle;
    const pagination = selectorPagination(this.config, items, style, this.page);
    this.page = pagination.currentPage;
    // The carousel layout settles its index while rendering.
    this._renderedIndex = undefined;
    let markup = this._markup(items, style, active, pagination);
    if (this._renderedIndex !== undefined) this.index = this._renderedIndex;
    // Same items with blank previews: equal means only preview colors
    // changed, which are repainted in place (updated) instead of rebuilt.
    const blank = items.map((item) => ({
      ...item,
      colorData: item.colorData?.map(() => "#000000"),
    }));
    const structure = this._markup(
      blank,
      style,
      active,
      selectorPagination(this.config, blank, style, this.page),
    );
    if (
      this._shownMarkup &&
      structure === this._shownStructure &&
      markup !== this._shownMarkup
    ) {
      this._repaint = items;
      markup = this._shownMarkup;
    } else {
      this._shownStructure = structure;
      this._shownMarkup = markup;
    }
    const label = this.searchLabel || "Search";
    return html`${this.config.show_search !== false
        ? html`<input
            class="yc-gallery-search"
            type="search"
            aria-label=${label}
            placeholder=${label}
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
      <div class="yc-stack yc-controls">
        ${this.heading
          ? html`<div class="section-title">${this.heading}</div>`
          : ""}
        <div
          class=${style === "original"
            ? "original-browser yc-stack yc-controls"
            : "reference-selector yc-stack yc-controls"}
          ?inert=${this.disabled}
        >
          ${items.length
            ? unsafeHTML(markup)
            : this.query.trim()
              ? html`<div class="empty" role="status">No matching items.</div>`
              : ""}
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
    this._paintInPlace();
    this._syncWheel();
    this._syncAlbum();
    // The wheel outlines its centred item from this (gallery-display-utils).
    this.dataset.highlightActive = String(
      this.config.highlight_active_mode !== false,
    );
    const highlight =
      this.config.highlight_active_mode !== false &&
      this.selectorStyle !== "preview-carousel";
    this.querySelectorAll(".reference-selector [data-mode]").forEach((node) => {
      if (highlight && node.dataset.mode === this.activeKey)
        node.setAttribute("data-active-mode", "true");
      else node.removeAttribute("data-active-mode");
    });
    this._markPending();
    if (this.model)
      markFavouriteModes(
        this,
        this.model.favourites,
        this.model.adapter.currentColorMode?.(),
        this.model.adapter.currentColor?.(),
      );
    this.dispatchEvent(new CustomEvent("gallery-updated", { bubbles: true }));
  }

  // New preview colors on unchanged items: repaint their matrices in place.
  _paintInPlace() {
    const items = this._repaint;
    this._repaint = null;
    if (!items) return;
    const byKey = new Map(items.map((item) => [item.dataMode, item.colorData]));
    const appearance = browserPreviewAppearance(this.config);
    this.querySelectorAll("[data-mode]").forEach((node) => {
      const colors = byKey.get(node.dataset.mode);
      const matrix = node.querySelector(".gallery-matrix-preview");
      if (colors && matrix) paintMatrixPreview(matrix, colors, appearance);
    });
  }

  // The wheel's scroll controller, bound once per wheel node.
  _syncWheel() {
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
  }

  // The album's coverflow, bound once per album node; it turns to the
  // active item whenever that changes (a pick, a rotation step).
  _syncAlbum() {
    const node = this.querySelector(`#${ALBUM}-album-container`);
    const items = this.visibleItems;
    const index = Math.max(
      0,
      items.findIndex((item) => item.dataMode === this.activeKey),
    );
    if (node !== this._albumNode) {
      this._albumNode = node;
      this._album = null;
      this._albumActive = undefined;
      if (!node) return;
      this._albumState ||= {};
      this._albumState._currentAlbumIndex = index;
      this._albumActive = this.activeKey;
      setupAlbumNavigation(
        // Ids are looked up in the gallery's own subtree.
        { getElementById: (id) => this.querySelector(`#${id}`) },
        ALBUM,
        (idx) => this._select(this.visibleItems[idx]?.dataMode),
        () => {},
        this._albumState,
        {
          album_3d_effect: this.config.album_3d_effect,
          wrap_navigation: this.config.gallery_wrap_navigation === true,
        },
      ).then((album) => {
        if (this._albumNode === node) this._album = album;
      });
      return;
    }
    if (this._album && this.activeKey !== this._albumActive) {
      this._albumActive = this.activeKey;
      this._album.goTo(index);
    }
  }
}

/** The gallery_* matrix appearance shared by every preview layout. */
export function browserPreviewAppearance(config) {
  const background = config.gallery_background_color || "black";
  const spacing = config.gallery_spacing_mode || "normal";
  return {
    width: Math.max(30, Math.min(100, Number(config.preview_size) || 55)),
    pixelStyle: ["circle", "rounded"].includes(config.gallery_pixel_style)
      ? config.gallery_pixel_style
      : "square",
    pixelGap: spacing === "normal" ? 3 : 0,
    proportionalSpacing: true,
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

defineOnce("yc-collection-gallery", YcCollectionGallery);
