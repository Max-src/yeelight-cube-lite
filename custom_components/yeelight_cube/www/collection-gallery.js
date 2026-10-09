/**
 * <yc-collection-gallery>: the shared gallery every card uses to browse and
 * pick one item of a collection (clock styles, native effects; later gradient
 * modes, palettes and pixel arts). Cards use it the same way:
 *
 *   html`<yc-collection-gallery
 *     .config=${this.config}            // the card config (options below)
 *     .items=${items}                   // [{dataMode, name, title, colorData,
 *                                       //   label?, swatch?, badge?, preview?,
 *                                       //   previewHtml?, meta?, favourite?,
 *                                       //   editable?}]
 *     .active=${key}                    // the item the lamp shows (or null)
 *     .model=${this._controls}          // mode-controls model: favourites
 *     .disabled=${busy}                 // inert while a command runs
 *     .revealKey=${key}                 // turn to this item once (optional)
 *     heading="Clock style"             // title above the items (optional)
 *     searchLabel="Search clock modes"
 *     emptyLabel="No palettes yet."     // shown when there are no items
 *                                       //   (optional: none while loading)
 *     .navigateSelects=${false}         // carousel and wheel moves only
 *                                       //   browse; a click picks (optional;
 *                                       //   default: moving picks, as for the
 *                                       //   lamp modes of Clock, Native,
 *                                       //   Gradient)
 *     actionLabel="Apply"               // what picking an item does: its
 *                                       //   tooltip and accessible name
 *                                       //   ("Sunset: Apply"; optional)
 *     .onSelect=${(key) => choose(key)} // a pick; resolves when applied
 *     .onQuery=${(query) => …}          // the search text (optional)
 *     .onRename=${(key, name) => …}     // user-owned items (optional)
 *     .onDelete=${(key) => …}           // user-owned items (optional)
 *     @gallery-updated=${() => paint()} // the items' DOM changed: repaint
 *   ></yc-collection-gallery>`
 *
 * Items: `dataMode` is the key, `name` is searched and listed (dropdown),
 * and the card's `item_labels` rename items for display (itemLabel; search
 * matches the label and the built-in name),
 * `title` captions the previews, `label` is an optional shorter button text
 * (filled, chips), `swatch` a CSS background shown by chips, `colorData` the
 * 100-pixel preview frame. Items that are not matrices bring their own
 * preview markup instead (`previewHtml`, trusted: the card escapes it; see
 * renderItemPreview), and `meta` is a short plain-text line under the
 * preview (list, grid, carousel, album: a palette's color count).
 *
 * Layouts (`style_selector_style`):
 *   text:     filled, dropdown, chips
 *   preview:  preview-list, preview-grid, preview-strip, preview-carousel,
 *             preview-wheel, preview-album
 *   original: original (grid or list with `effect_view`, capability badges)
 * Shared options: show_search, gallery_sort (the card's order or A → Z,
 * sortGalleryItems), items_per_page (list, grid, original),
 * preview_show_titles, highlight_active_mode, gallery_wrap_navigation,
 * wheel_nav_position / wheel_height, album_3d_effect, preview_size,
 * selector_shape (square, rounded, round, or custom with item_radius px) /
 * selector_button_shape (items and arrows, every preview layout but list
 * and grid), item_card_border (none, auto: with a dark theme, always) and
 * the gallery_* matrix appearance (browserPreviewAppearance).
 *
 * User-owned items (`editable: true`: palettes, pixel arts, custom clock
 * presets) can be renamed (allow_rename) and deleted (remove_button_style
 * and the other delete_button_* options, delete-button-styles.js) in the
 * card layouts (list, grid, strip, carousel, album, Original). Both open one
 * bar above the items: a name field, or a confirmation, so nothing is
 * deleted by a single tap. Built-in items are never deleted or renamed here:
 * their visibility, order and names belong to the card editor.
 *
 * Behaviour shared by every card:
 * - new items' colors only (text, colors, angle changed) repaint the
 *   previews in place; the DOM, scroll, hover and wheel position are kept;
 * - the picked item pulses until onSelect resolves;
 * - the active item is outlined (highlight_active_mode), except in the
 *   carousel, whose only visible item is always the active one;
 * - "No matching items" only follows a search: no items yet (previews
 *   still loading) shows emptyLabel, or nothing;
 * - every item is a keyboard button (focusable, Enter / Space, named for
 *   screen readers), whatever markup its layout generates.
 *
 * Pass the same `items` array (and config) while nothing changed: the
 * gallery then does not re-render at all. Cards whose own updates are
 * frequent (Draw: every stroke) memoize their items.
 *
 * It renders in the card's light DOM, so the card includes
 * collectionGalleryStyles in its static styles. Cards that animate their
 * previews paint them on gallery-updated: every item preview is a
 * `[data-mode]` element holding a `.gallery-matrix-preview` grid of 100 cells.
 */
import { LitElement, html, unsafeHTML } from "./lib/lit-all.js";
import { renderActionButton } from "./action-button-ui.js";
import {
  deleteButtonStyles,
  deleteButtonPositionStyles,
  getDeleteButtonConfig,
} from "./delete-button-styles.js";
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
  renderItemPreview,
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
  resolveSelectorButtonShape,
  selectorItemRadius,
  selectorShapeToCarouselButtonShape,
} from "./selector-shared-styles.js";
import { isActivationKey } from "./card-shell.js";
import { escapeHtml } from "./html-escape-utils.js";
import { defineOnce } from "./card-registration.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { itemLabel, itemMatchesQuery, sortGalleryItems } from "./card-config.js";

// Class prefix of the album markup (album-view-coverflow.js).
const ALBUM = "collection";
// The generated items made keyboard buttons (_syncKeyboard).
const ITEM_NODES =
  ".gallery-item[data-mode], .wheel-item[data-mode], .collection-album-entry[data-mode]";

/** Everything the gallery's markup needs (the filled text layout renders
 * shared action buttons); cards include it once. */
export const collectionGalleryStyles = `
  /* The gallery fills its host's width whatever the host's layout (a
     centring flex column would shrink it to its items, collapsing the
     carousel and album, which have no width of their own). */
  yc-collection-gallery {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    align-self: stretch;
  }
  ${actionButtonStyles}
  ${deleteButtonStyles}
  ${deleteButtonPositionStyles}
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
  /* The carousel item spans the carousel (whatever a card's own
     .carousel-content rules, e.g. Draw's centring column). */
  .gc-preview-shell .carousel-content {
    align-items: stretch;
  }
  .gc-preview-shell .yc-carousel-item {
    width: 100%;
  }
  /* No preview is ever wider than the card (narrow cards, large Size). */
  .gc-preview-shell .gallery-matrix-preview,
  .gc-preview-shell .gallery-item-preview {
    max-width: 100% !important;
  }
  .gc-preview-shell[data-columns="2"] .gallery-display-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
  /* Every arrow of the gallery (carousel, album, wheel) has the look of
     its page buttons: a tint of the primary color, never a host card's or
     theme's own button colors (--card-background-color can be far from
     the card's real background in some themes). */
  yc-collection-gallery :is(.carousel-nav-btn, .album-nav-btn, .wheel-nav-buttons button) {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff)) !important;
    color: var(--primary-color, #0077cc) !important;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1)) !important;
  }
  yc-collection-gallery :is(.carousel-nav-btn, .album-nav-btn, .wheel-nav-buttons button):hover:not(:disabled) {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff)) !important;
  }
  yc-collection-gallery :is(.carousel-nav-btn, .album-nav-btn, .wheel-nav-buttons button):focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
  /* The active item: clearly visible on any background color. */
  .gc-preview-shell .gallery-item[data-active-mode="true"] {
    outline: 2px solid var(--primary-color, #03a9f4) !important;
    outline-offset: -2px;
    box-shadow: 0 0 8px rgba(3, 169, 244, 0.5) !important;
  }
  /* User-owned items: delete (shared delete-button styles) and rename
     controls, and the bar that confirms them. */
  .yc-editable {
    position: relative;
    overflow: visible !important;
  }
  .yc-item-rename {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #333);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }
  /* Album: rename / delete only on the centred card (the side cards are
     out of reach and partly hidden). */
  .collection-album-item:not(.active) .yc-item-action {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  /* Album cards clip their content: the delete button stays in a corner. */
  .collection-album-entry .delete-btn-cross.btn-pos-outside {
    top: 6px;
    right: 6px;
  }
  .collection-album-entry .delete-btn-cross.btn-pos-outside.btn-side-left {
    left: 6px;
  }
  .yc-item-rename.yc-right {
    left: auto;
    right: 6px;
  }
  .yc-item-manage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 8px;
    background: var(--secondary-background-color, #f6f8fa);
  }
  .yc-item-manage .yc-manage-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .yc-item-manage input {
    flex: 1 1 140px;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 6px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    font: inherit;
  }
  .yc-item-manage .error {
    flex-basis: 100%;
    color: var(--error-color, #db4437);
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
  /* meta: a short line under the preview (carousel, album; list and grid
     style it inline). */
  .gc-preview-shell .gallery-item-metadata,
  .collection-album-entry .gallery-item-metadata {
    font-size: 0.8em;
    text-align: center;
    color: var(--secondary-text-color, #666);
  }
  .yc-gallery-empty {
    padding: 8px 0;
    color: var(--secondary-text-color, #888);
  }
  /* Keyboard focus on the generated items (_syncKeyboard). */
  yc-collection-gallery [role="button"][data-mode]:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4) !important;
    outline-offset: -2px;
  }
  /* item_card_border: a border around each item (data-item-border). */
  yc-collection-gallery[data-item-border="true"] .gallery-item,
  yc-collection-gallery[data-item-border="true"] .collection-album-item,
  yc-collection-gallery[data-item-border="true"] .original-item {
    border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35)) !important;
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
    emptyLabel: {},
    actionLabel: {},
    navigateSelects: { type: Boolean },
    // Callbacks are kept but never re-render the gallery: cards pass new
    // arrow functions on every render (Draw: every stroke), and they are
    // only called on a user action.
    onSelect: { attribute: false, hasChanged: () => false },
    onQuery: { attribute: false, hasChanged: () => false },
    onRename: { attribute: false, hasChanged: () => false },
    onDelete: { attribute: false, hasChanged: () => false },
    query: { state: true },
    _manage: { state: true },
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
    this.navigateSelects = true;
    // Enter / Space activate the generated items (_syncKeyboard); native
    // buttons and the item controls handle their own keys.
    this.addEventListener("keydown", (event) => {
      const target = event.target;
      if (
        !isActivationKey(event) ||
        target?.getAttribute?.("role") !== "button" ||
        !target.matches?.(ITEM_NODES)
      )
        return;
      event.preventDefault();
      target.click();
    });
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
    const shown = this.items
      .map((item) => {
        const label = itemLabel(this.config, item.dataMode, null);
        // meta is plain text; the layouts insert `metadata` as markup.
        if (item.meta != null) item = { ...item, metadata: escapeHtml(item.meta) };
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
    return sortGalleryItems(this.config, shown, (item) => item.name);
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
      this.selectorStyle === "preview-carousel" && this.navigateSelects
        ? null
        : this._pendingKey;
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
    // Browsing only (user collections: a pick replaces the drawing or the
    // lamps' colors): the item shown changes; a click on it picks it.
    if (this.navigateSelects) this._select(items[this.index].dataMode);
    else this.requestUpdate();
  }

  // One item's preview (live matrix or the card's markup), in the gallery_*
  // appearance.
  _matrix(item) {
    return renderItemPreview(item, {
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
          ${item.metadata ? `<div class="gallery-item-metadata">${item.metadata}</div>` : ""}
        </div>`,
      {
        // The album card follows the preview size (55% = the 240px card),
        // within the Size range of every layout.
        card_size: Math.round(
          (browserPreviewAppearance(this.config).width / 55) * 100,
        ),
        album_3d_effect: this.config.album_3d_effect,
        rounded_cards: selectorItemRadius(this.config),
        album_nav_shape: selectorShapeToCarouselButtonShape(
          resolveSelectorButtonShape(this.config),
        ),
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
    // Everything the markup shows but the preview colors: unchanged, only
    // colors changed (live previews, an angle being dragged), which are
    // repainted in place (updated) without building any markup.
    const structure = JSON.stringify([
      style,
      active,
      this.page,
      this.index,
      this.config,
      items.map(({ colorData, ...item }) => [item, colorData?.length ?? -1]),
    ]);
    let markup = this._shownMarkup;
    if (markup !== undefined && structure === this._shownStructure) {
      if (items !== this._shownItems) this._repaint = items;
    } else {
      // The carousel layout settles its index while rendering.
      this._renderedIndex = undefined;
      markup = this._markup(items, style, active, pagination);
      if (this._renderedIndex !== undefined) this.index = this._renderedIndex;
      this._shownStructure = structure;
      this._shownMarkup = markup;
    }
    this._shownItems = items;
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
        ${this._manageBar()}
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
              : this.emptyLabel && !this.items.length
                ? html`<div class="yc-gallery-empty" role="status">
                    ${this.emptyLabel}
                  </div>`
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
    // Browsing wheel (navigateSelects false): its moves only browse, a click
    // on an item picks it.
    if (!this.navigateSelects)
      this.querySelectorAll(".wheel-item[data-mode]").forEach((node) => {
        node.onclick = () => this._select(node.dataset.mode);
      });
    this._paintInPlace();
    this._syncItemActions();
    this._syncKeyboard();
    this._syncLook();
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

  // Every generated item is a keyboard button, named after its item (the
  // layouts' markup is HTML strings, without these semantics).
  _syncKeyboard() {
    const names = new Map(
      this.visibleItems.map((item) => [item.dataMode, item.name]),
    );
    this.querySelectorAll(ITEM_NODES).forEach((node) => {
      const name = names.get(node.dataset.mode) || "";
      const label = this.actionLabel ? `${name}: ${this.actionLabel}` : name;
      if (node.getAttribute("aria-label") === label) return;
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      node.setAttribute("aria-label", label);
      if (this.actionLabel) node.title = label;
    });
    // Icon-only buttons (arrows) are named after their tooltip.
    this.querySelectorAll("button[title]:not([aria-label])").forEach((button) =>
      button.setAttribute("aria-label", button.title),
    );
  }

  // The item radius (custom shape) and border, as attributes the shared CSS
  // reads. "auto" borders follow the theme: a light text color means a dark
  // theme, where items can melt into the card.
  _syncLook() {
    this.style.setProperty(
      "--yc-item-radius",
      `${selectorItemRadius(this.config)}px`,
    );
    const border = this.config.item_card_border;
    this.dataset.itemBorder = String(
      border === "always" ||
        (border === "auto" && isLightColor(getComputedStyle(this).color)),
    );
  }

  // ── User-owned items: rename and delete ─────────────────────────────────

  // What may be done to `editable` items with this config and these callbacks.
  get _itemActions() {
    const button = getDeleteButtonConfig(this.config);
    return {
      button,
      remove: !!this.onDelete && button.allowDelete,
      rename: !!this.onRename && this.config.allow_rename === true,
    };
  }

  // Add the delete / rename controls to the editable items of the card
  // layouts (not the wheel, whose items move, nor the text layouts, whose
  // items are buttons). Idempotent: an item is only rebuilt when the
  // controls it should show change.
  _syncItemActions() {
    const { button, remove, rename } = this._itemActions;
    const editable = new Map(
      this.visibleItems
        .filter((item) => item.editable)
        .map((item) => [item.dataMode, item]),
    );
    const nodes = this.querySelectorAll(
      ".gallery-item[data-mode], .collection-album-entry[data-mode], .original-item[data-mode]",
    );
    for (const node of nodes) {
      const item = editable.get(node.dataset.mode);
      const signature = item
        ? `${remove ? button.classes + button.posClass + button.sideClass : ""}|${rename}`
        : "";
      if ((node.dataset.ycActions || "") === signature) continue;
      node.querySelectorAll(":scope > .yc-item-action").forEach((el) => el.remove());
      node.classList.toggle("yc-editable", !!signature && (remove || rename));
      node.dataset.ycActions = signature;
      if (!item) continue;
      const name = item.name;
      if (remove)
        node.append(
          this._actionControl(
            `${button.classes} ${button.posClass} ${button.sideClass} yc-item-delete`,
            `Delete ${name}`,
            "",
            () => this._openManage("delete", item),
          ),
        );
      if (rename)
        node.append(
          this._actionControl(
            // Opposite the delete button.
            `yc-item-rename${button.left ? " yc-right" : ""}`,
            `Rename ${name}`,
            "✎",
            () => this._openManage("rename", item),
          ),
        );
    }
  }

  // A control inside an item: a focusable span (an item can itself be a
  // button), whose activation never reaches the item (which would select it).
  _actionControl(className, label, text, activate) {
    const control = document.createElement("span");
    control.className = `${className} yc-item-action`;
    control.setAttribute("role", "button");
    control.tabIndex = 0;
    control.title = label;
    control.setAttribute("aria-label", label);
    control.textContent = text;
    const run = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.disabled) activate();
    };
    control.addEventListener("click", run);
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") run(event);
      else event.stopPropagation();
    });
    // Swipes and drags on the control never move a carousel or an album.
    for (const type of ["touchstart", "mousedown", "pointerdown"])
      control.addEventListener(type, (event) => event.stopPropagation());
    return control;
  }

  _openManage(action, item) {
    this._manage = {
      action,
      key: item.dataMode,
      name: item.name,
      value: item.builtinName || item.name,
      busy: false,
      error: "",
    };
    // The bar sits above the items: bring it into view (a long list), and
    // put the cursor in the name field.
    this.updateComplete.then(() => {
      this.querySelector(".yc-item-manage")?.scrollIntoView?.({
        block: "nearest",
      });
      if (action === "rename")
        this.querySelector(".yc-item-manage input")?.focus();
    });
  }

  async _runManage() {
    const manage = this._manage;
    if (!manage || manage.busy) return;
    const name = manage.value.trim().replace(/\s+/g, " ");
    if (manage.action === "rename" && !name) return;
    this._manage = { ...manage, busy: true, error: "" };
    try {
      const done =
        manage.action === "delete"
          ? await this.onDelete(manage.key)
          : await this.onRename(manage.key, name);
      this._manage = done === false ? { ...this._manage, busy: false } : null;
    } catch (error) {
      this._manage = {
        ...this._manage,
        busy: false,
        error: error?.message || String(error),
      };
    }
  }

  // The bar that confirms a delete or takes the new name.
  _manageBar() {
    const manage = this._manage;
    if (!manage) return "";
    const button = (options) =>
      renderActionButton({
        buttonStyle: this.config.buttons_style,
        contentMode: "icon_text",
        compact: true,
        disabled: manage.busy,
        ...options,
      });
    const cancel = button({
      action: "tool",
      icon: "mdi:close",
      label: "Cancel",
      onClick: () => {
        this._manage = null;
      },
    });
    const error = manage.error
      ? html`<div class="error" role="alert">${manage.error}</div>`
      : "";
    if (manage.action === "delete")
      return html`<div class="yc-item-manage" role="alertdialog">
        <span class="yc-manage-text">Delete “${manage.name}”?</span>
        ${button({
          action: "clear",
          icon: "mdi:delete-outline",
          label: "Delete",
          busy: manage.busy,
          busyLabel: "Deleting...",
          onClick: () => this._runManage(),
        })}${cancel}${error}
      </div>`;
    return html`<form
      class="yc-item-manage"
      @submit=${(event) => {
        event.preventDefault();
        this._runManage();
      }}
    >
      <span class="yc-manage-text">Rename “${manage.name}”</span>
      <input
        type="text"
        required
        maxlength="40"
        aria-label="New name"
        .value=${manage.value}
        ?disabled=${manage.busy}
        @keydown=${(event) => event.stopPropagation()}
        @keyup=${(event) => event.stopPropagation()}
        @input=${(event) => {
          this._manage = { ...this._manage, value: event.target.value };
        }}
      />
      ${button({
        type: "submit",
        action: "save",
        icon: "mdi:check",
        label: "Save",
        busy: manage.busy,
        busyLabel: "Saving...",
      })}${cancel}${error}
    </form>`;
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
        onModeSelect: async (key) =>
          this.navigateSelects ? this._select(key) : undefined,
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

// Whether a computed CSS color ("rgb(r, g, b)") is light.
function isLightColor(color) {
  const [r, g, b] = (String(color).match(/\d+(\.\d+)?/g) || []).map(Number);
  return r != null && 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
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
