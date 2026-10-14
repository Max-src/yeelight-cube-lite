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
 * The layouts are Lit templates (gallery-layouts.js): every item binds its
 * click, keyboard role and name, outline, pulse and star.
 *
 * Items: `dataMode` is the key, `name` is searched and listed (dropdown),
 * and the card's `item_labels` rename items for display (itemLabel; search
 * matches the label and the built-in name),
 * `title` captions the previews, `label` is an optional shorter button text
 * (filled, chips), `swatch` a CSS background shown by chips, `colorData` the
 * 100-pixel preview frame. Items that are not matrices bring their own
 * preview markup instead (`previewHtml`, trusted: the card escapes it; see
 * itemPreviewTemplate), and `meta` is a short plain-text line under the
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
 * frequent (Draw: every stroke) memoize their items. New colors only update
 * the preview cells that changed.
 *
 * It renders in the card's light DOM, so the card includes
 * collectionGalleryStyles in its static styles. Cards that animate their
 * previews paint them on gallery-updated: every item preview is a
 * `[data-mode]` element holding a `.gallery-matrix-preview` grid of 100 cells.
 */
import { LitElement, html, nothing } from "./lib/lit-all.js";
import { renderActionButton } from "./action-button-ui.js";
import {
  deleteButtonStyles,
  deleteButtonPositionStyles,
  getDeleteButtonConfig,
} from "./delete-button-styles.js";
import {
  selectorPagination,
  selectorPageSize,
  styleSelectorStyles,
  gallerySelectorStyle,
} from "./style-selector-utils.js";
import { favouriteKeys } from "./gallery-display-utils.js";
import {
  textLayout,
  previewLayout,
  wheelLayout,
  albumLayout,
  originalLayout,
} from "./gallery-layouts.js";
import { requestedPage, paginationStyles } from "./pagination-utils.js";
import { albumStyles } from "./album-view-coverflow.js";
import {
  resolveSelectorButtonShape,
  selectorItemRadius,
  selectorShapeToCarouselButtonShape,
} from "./selector-shared-styles.js";
import { isActivationKey } from "./card-shell.js";
import { defineOnce } from "./card-registration.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { itemLabel, itemMatchesQuery, sortGalleryItems } from "./card-config.js";

// Class prefix of the album markup (album-view-coverflow.js).
const ALBUM = "collection";
// The items that are keyboard buttons (role="button" divs: gallery-layouts.js).
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
  /* Keyboard focus on the items (role="button": gallery-layouts.js). */
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
    // Enter / Space activate the role="button" items; native
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
    if (key == null) return false;
    // The picked item pulses until its selection resolves; picks stay live
    // meanwhile (the cards send only the latest of quick picks).
    this._pendingKey = key;
    this.requestUpdate();
    try {
      return await this.onSelect?.(key);
    } finally {
      if (this._pendingKey === key) this._pendingKey = null;
      this.requestUpdate();
    }
  }

  _navigate(delta, index) {
    const items = this.visibleItems;
    if (!items.length) return;
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
    const style = this.selectorStyle;
    const pagination = selectorPagination(this.config, items, style, this.page);
    this.page = pagination.currentPage;
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
        >
          ${items.length
            ? this._layout(items, style, pagination)
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

  // What every layout reads (gallery-layouts.js).
  _view(items, style, pagination) {
    const actions = this._itemActions;
    const model = this.model;
    const appearance = browserPreviewAppearance(this.config);
    return {
      config: this.config,
      items,
      active: this.activeKey,
      // The carousel's only visible item is the active one: no outline.
      highlight:
        this.config.highlight_active_mode !== false && style !== "preview-carousel",
      // Not in the carousel when navigating picks (the shown item is it).
      pending:
        style === "preview-carousel" && this.navigateSelects ? null : this._pendingKey,
      favourites: model
        ? favouriteKeys(
            model.favourites,
            model.adapter.currentColorMode?.(),
            model.adapter.currentColor?.(),
          )
        : null,
      actionLabel: this.actionLabel,
      navigateSelects: this.navigateSelects,
      pagination,
      index:
        this.index ??
        Math.max(0, items.findIndex((item) => item.dataMode === this.activeKey)),
      matrix: { ...appearance, rows: 5, cols: 20, forceAspectRatio: true },
      matrixWidth: appearance.width,
      select: (key) => this._select(key),
      navigate: (delta) => this._navigate(delta),
      setIndex: (index) => this._navigate(0, index),
      setPage: (value) => this._changePage(value),
      itemControls: (item) => this._itemControls(item, actions),
    };
  }

  _layout(items, style, pagination) {
    const view = this._view(items, style, pagination);
    if (style === "original") return originalLayout(view);
    if (style === "preview-wheel") return wheelLayout(view);
    if (style === "preview-album")
      return albumLayout(view, ALBUM, {
        width: view.matrixWidth,
        radius: selectorItemRadius(this.config),
        buttonShape: selectorShapeToCarouselButtonShape(
          resolveSelectorButtonShape(this.config),
        ),
      });
    if (style.startsWith("preview-")) return previewLayout(view, style);
    return textLayout(view, style);
  }

  updated() {
    if (this.model !== this._subscribed) {
      this._subscribed?.listeners.delete(this._refresh);
      this._refresh ||= () => this.requestUpdate();
      this._subscribed = this.model;
      this._subscribed?.listeners.add(this._refresh);
    }
    this._syncLook();
    // The wheel outlines its centred item from this (gallery-display-utils).
    this.dataset.highlightActive = String(
      this.config.highlight_active_mode !== false,
    );
    this.dispatchEvent(new CustomEvent("gallery-updated", { bubbles: true }));
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

  // The delete / rename controls of an editable item in the card layouts
  // (list, grid, strip, carousel, album, Original; not the wheel, whose
  // items move, nor the text layouts, whose items are buttons).
  _itemControls(item, { button, remove, rename }) {
    if (!item.editable || !(remove || rename)) return nothing;
    return html`${remove
      ? this._actionControl(
          `${button.classes} ${button.posClass} ${button.sideClass} yc-item-delete`,
          `Delete ${item.name}`,
          "",
          () => this._openManage("delete", item),
        )
      : nothing}${rename
      ? this._actionControl(
          // Opposite the delete button.
          `yc-item-rename${button.left ? " yc-right" : ""}`,
          `Rename ${item.name}`,
          "✎",
          () => this._openManage("rename", item),
        )
      : nothing}`;
  }

  // A control inside an item: a focusable span (an item can itself be a
  // button), whose activation never reaches the item (which would select it).
  // Swipes and drags on it never move a carousel or an album.
  _actionControl(className, label, text, activate) {
    const run = (event) => {
      event.preventDefault();
      event.stopPropagation();
      activate();
    };
    const stop = (event) => event.stopPropagation();
    return html`<span
      class="${className} yc-item-action"
      role="button"
      tabindex="0"
      title=${label}
      aria-label=${label}
      @click=${run}
      @keydown=${(event) =>
        event.key === "Enter" || event.key === " " ? run(event) : stop(event)}
      @touchstart=${stop}
      @mousedown=${stop}
      @pointerdown=${stop}
    >${text}</span>`;
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
