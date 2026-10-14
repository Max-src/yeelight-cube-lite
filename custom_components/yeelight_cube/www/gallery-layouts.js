// The layouts of the shared gallery (<yc-collection-gallery>,
// collection-gallery.js) as Lit templates: the text buttons (filled, chips,
// dropdown), the previews (list, grid, strip, wheel, carousel, album), the
// Original browser and the pagination. Each item binds its own click, keyboard
// role and name, active outline, pending pulse and favourite star; a preview's
// cells are bindings, so new colors (live previews, a dragged angle) update
// only the cells that changed.
//
// Every layout takes the gallery's view `g`:
//   config, items (visible), active (key or null), highlight (outline the
//   active item), pending (key), favourites (Set of keys, or null),
//   actionLabel, navigateSelects, page/pagination, index,
//   select(key), navigate(delta), setIndex(index), setPage(value),
//   itemControls(item) (rename / delete of editable items, or nothing).
import { html, nothing, unsafeHTML } from "./lib/lit-all.js";
import { matrixCellLook } from "./gallery-display-utils.js";
import { previewLength } from "./preview-appearance.js";
import { renderActionButton } from "./action-button-ui.js";
import { renderCarousel } from "./carousel-utils.js";
import "./wheel-picker.js";
import "./album-view-coverflow.js";
import {
  resolveSelectorShape,
  resolveSelectorButtonShape,
  selectorShapeToCarouselButtonShape,
} from "./selector-shared-styles.js";

// ── Matrix previews ────────────────────────────────────────────────────────

/** A 5x20 matrix preview (the markup of renderMatrixPreview, as a template). */
export function matrixTemplate(colorData = [], options = {}) {
  const {
    cols = 20,
    bgColor = "#000000",
    pixelStyle = "square",
    pixelGap = 1,
    previewSize = 200,
    matrixBoxShadow = false,
    proportionalSpacing = true,
  } = options;
  const length = (value) =>
    proportionalSpacing ? previewLength(value) : `${value}px`;
  const radius =
    pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0";
  const size = options.forceAspectRatio ? "width: 100%;" : `width: ${previewSize}px;`;
  const grid = html`<div
    class="gallery-matrix-preview"
    style=${`grid-template-columns:repeat(${cols},1fr);gap:${length(pixelGap)};background:${bgColor};padding:${length(pixelGap * 2)};border-radius:${length(4)};--yc-px-radius:${radius};${proportionalSpacing ? "width:100%;" : size}${matrixBoxShadow ? `box-shadow: 0 ${length(2)} ${length(8)} rgba(0,0,0,0.5);` : ""}`}
  >${(colorData || []).map((color) => {
    const look = matrixCellLook(color, options);
    return html`<div style=${`background:${look.background};${look.shadow ? `box-shadow:${look.shadow};` : ""}`}></div>`;
  })}</div>`;
  return proportionalSpacing
    ? html`<div style=${`container-type:inline-size;max-width:100%;${size}`}>${grid}</div>`
    : grid;
}

/** An item's preview: the card's own markup (previewHtml, trusted: the card
 * escapes it) at the preview width, else its live matrix (colorData). */
export function itemPreviewTemplate(item, options = {}) {
  if (item?.previewHtml == null) return matrixTemplate(item?.colorData, options);
  const width = options.forceAspectRatio ? "100%" : `${options.previewSize ?? 200}px`;
  return html`<div
    class="gallery-item-preview"
    style=${`container-type:inline-size;width:${width};max-width:100%;`}
  >${unsafeHTML(item.previewHtml)}</div>`;
}

// ── What every item shares ─────────────────────────────────────────────────

// Its accessible name and tooltip ("Sunset: Apply" with an action label).
function itemName(g, item) {
  return g.actionLabel ? `${item.name}: ${g.actionLabel}` : item.name;
}

// The attributes of an item made a keyboard button (Enter / Space: the
// gallery's keydown handler clicks it).
function itemState(g, item) {
  return {
    active: g.highlight && item.dataMode === g.active ? "true" : nothing,
    favourite: g.favourites?.has(item.dataMode) ? "true" : nothing,
    pending: item.dataMode === g.pending ? " gc-pending" : "",
    label: itemName(g, item),
    title: g.actionLabel ? itemName(g, item) : item.title || nothing,
  };
}

// The gallery_* matrix appearance in a preview layout.
function previewLook(config, style) {
  const previewSize = Math.round((Number(config.preview_size) || 55) * 4.5);
  const bgName = config.gallery_background_color || "black";
  const spacing = config.gallery_spacing_mode || "normal";
  return {
    previewSize,
    effectiveSize:
      style === "preview-grid"
        ? Math.round(previewSize * 0.5)
        : style === "preview-strip"
          ? Math.round(previewSize * 0.4)
          : previewSize,
    bgName,
    // Titles are white on exactly "#000000" (not "black").
    bgColor: bgName === "black" ? "#000000" : bgName,
    matrix: {
      rows: 5,
      cols: 20,
      bgColor: bgName === "black" ? "#000000" : bgName,
      pixelStyle: config.gallery_pixel_style || "square",
      pixelGap: spacing === "normal" ? 3 : 0,
      ignoreBlackPixels: bgName !== "black" && config.gallery_ignore_black_pixels === true,
      matrixBoxShadow: config.gallery_matrix_box_shadow === true,
      pixelBoxShadow: ["subtle", "normal"].includes(spacing),
      proportionalSpacing: true,
    },
    showTitles: config.preview_show_titles !== false,
  };
}

const titleFontSize = (size) => Math.max(10, Math.min(Math.round(13 * (size / 200)), 18));
const metaFontSize = (size) => Math.max(9, Math.min(Math.round(11 * (size / 200)), 15));
const titleColor = (bgColor) =>
  bgColor === "#000000" ? "color: #fff;" : "color: var(--primary-text-color);";

// ── Text layouts ───────────────────────────────────────────────────────────

/** A chip's swatch: the item's CSS background (a gradient, a palette's
 * colors), else a micro-matrix of its frame (animated like the previews),
 * else a neutral dot. */
function chipSwatch(item) {
  if (item.swatch)
    return html`<span class="mode-chip-swatch" style=${`background:${item.swatch}`}></span>`;
  if (item.colorData)
    return html`<span class="mode-chip-swatch mode-chip-matrix">${matrixTemplate(item.colorData, {
      bgColor: "#000000",
      pixelStyle: "square",
      pixelGap: 0,
      previewSize: 44,
      proportionalSpacing: false,
    })}</span>`;
  return html`<span class="mode-chip-swatch"></span>`;
}

/** filled (the shared action buttons), chips or dropdown. */
export function textLayout(g, style) {
  const { config, items, active } = g;
  const shape = resolveSelectorShape(config);
  const scale = Math.max(0.8, Math.min(1.4, (Number(config.preview_size) || 55) / 50));
  if (style === "dropdown") {
    const shown = items.some((item) => item.dataMode === active);
    return html`<div class="gc-selector" data-shape=${shape} style=${`--gc-sel-scale:${scale};`}>
      <select
        class="mode-select"
        data-mode-select="true"
        .value=${shown ? active : ""}
        @change=${(event) => g.select(event.target.value)}
      >
        ${shown
          ? nothing
          : // No active item (palettes, pixel arts): a prompt; an active one
            // hidden by the search or the list: said so.
            // (Option texts without surrounding whitespace: it would show.)
            html`<option value="" disabled selected>${active == null
              ? "Choose…"
              : "Current choice not in this list"}</option>`}
        ${items.map(
          (item) =>
            html`<option value=${item.dataMode} ?selected=${item.dataMode === active}>${(g.favourites
              ? g.favourites.has(item.dataMode)
              : item.favourite)
              ? "★ "
              : ""}${item.name}</option>`,
        )}
      </select>
    </div>`;
  }
  if (style === "chips")
    return html`<div
      class="gc-selector gc-chips"
      data-shape=${shape}
      style=${`--gc-sel-scale:${scale};`}
      role="radiogroup"
    >
      ${items.map((item) => {
        const state = itemState(g, item);
        const selected = item.dataMode === active;
        return html`<button
          type="button"
          class="mode-chip${selected ? " active" : ""}${state.pending}"
          data-mode=${item.dataMode}
          data-active-mode=${state.active}
          data-favourite=${state.favourite}
          role="radio"
          aria-checked=${String(selected)}
          title=${item.name}
          @click=${() => g.select(item.dataMode)}
        >
          ${chipSwatch(item)}
          <span class="mode-chip-label">${item.label || item.name}</span>
        </button>`;
      })}
    </div>`;
  // "filled": the shared action buttons (text only), like the color-mode
  // buttons of every card; item.label is the optional short text.
  return html`<div
    class="gc-selector"
    data-shape=${shape}
    style=${`display: flex; flex-wrap: wrap; gap: 6px; --gc-sel-scale:${scale};`}
  >
    ${items.map((item) => {
      const state = itemState(g, item);
      return renderActionButton({
        action: "tool",
        buttonStyle: config.buttons_style,
        contentMode: "text",
        label: item.label || item.name,
        title: item.name,
        selected: item.dataMode === active,
        role: "radio",
        value: item.dataMode,
        dataMode: item.dataMode,
        extraClass: state.pending.trim(),
        activeMode: state.active === "true",
        favourite: state.favourite === "true",
        onClick: () => g.select(item.dataMode),
      });
    })}
  </div>`;
}

// ── Preview layouts ────────────────────────────────────────────────────────

// A card of the list, grid and strip.
function previewItem(g, item, look, strip) {
  const state = itemState(g, item);
  const size = look.effectiveSize;
  const showCards = strip;
  const background = look.bgColor || (showCards ? "var(--card-background-color, #fff)" : "transparent");
  const title =
    look.showTitles && item.title
      ? html`<div
          class="gallery-item-title"
          style=${`font-size: ${titleFontSize(size)}px; ${strip ? `max-width: ${size}px; ` : ""}${titleColor(look.bgColor)}`}
        >${item.title}</div>`
      : nothing;
  const preview = itemPreviewTemplate(item, { ...look.matrix, previewSize: size });
  const controls = g.itemControls(item);
  return strip
    ? html`<div
        class="gallery-item gallery-compact-item${controls === nothing ? "" : " yc-editable"}${state.pending}"
        data-mode=${item.dataMode}
        data-active-mode=${state.active}
        data-favourite=${state.favourite}
        data-bg-transparent=${look.bgColor === "transparent" ? "true" : nothing}
        role="button"
        tabindex="0"
        aria-label=${state.label}
        title=${state.title}
        style=${`cursor: pointer; border-radius: 6px; background: ${background};`}
        @click=${() => g.select(item.dataMode)}
      >${preview}${title}${controls}</div>`
    : html`<div
        class="gallery-item gallery-item-plain${controls === nothing ? "" : " yc-editable"}${state.pending}"
        data-mode=${item.dataMode}
        data-active-mode=${state.active}
        data-favourite=${state.favourite}
        data-bg-transparent=${look.bgColor === "transparent" ? "true" : nothing}
        role="button"
        tabindex="0"
        aria-label=${state.label}
        title=${state.title}
        style=${`cursor: pointer; background: ${background};`}
        @click=${() => g.select(item.dataMode)}
      >${title}
        <div class="gallery-item-body">${preview}</div>
        ${item.meta
          ? html`<div class="gallery-item-metadata" style=${`font-size: ${metaFontSize(size)}px;`}>${item.meta}</div>`
          : nothing}${controls}</div>`;
}

/** list, grid, strip, carousel (wheel and album: their own templates). */
export function previewLayout(g, style) {
  const { config, items } = g;
  const look = previewLook(config, style);
  const shellAttrs = {
    shape: resolveSelectorShape(config),
    columns: style === "preview-grid" ? "2" : nothing,
  };
  if (style === "preview-carousel") {
    const index = Math.max(0, Math.min(g.index ?? 0, items.length - 1));
    return html`<div
      class="gc-preview-shell"
      data-shape=${shellAttrs.shape}
      style="border-radius:8px;"
    >
      ${renderCarousel({
        items,
        currentIndex: index,
        buttonShape: selectorShapeToCarouselButtonShape(resolveSelectorButtonShape(config)),
        showAsCard: true,
        wrapNavigation: config.gallery_wrap_navigation === true,
        onNavigate: (direction) => g.navigate(direction),
        onSetIndex: (target) => g.setIndex(target),
        renderItem: (item) => carouselItem(g, item, look),
      })}
    </div>`;
  }
  const paged = g.pagination.items;
  const strip = style === "preview-strip";
  return html`<div
    class="gc-preview-shell"
    data-shape=${shellAttrs.shape}
    data-columns=${shellAttrs.columns}
    style="border-radius: 8px;"
  >
    ${strip
      ? html`<div class="gallery-display-strip">${paged.map((item) => previewItem(g, item, look, true))}</div>`
      : html`<div
          class="gallery-display-grid"
          style=${`grid-template-columns: repeat(auto-fit, minmax(min(${look.effectiveSize + 60}px, 100%), 1fr));`}
        >${paged.map((item) => previewItem(g, item, look, false))}</div>`}
    ${paginationTemplate(g)}
  </div>`;
}

// The carousel's one item (the active one: no outline in the carousel).
function carouselItem(g, item, look) {
  const state = itemState(g, item);
  const controls = g.itemControls(item);
  return html`<div
    class="gallery-item yc-carousel-item${controls === nothing ? "" : " yc-editable"}${state.pending}"
    data-mode=${item.dataMode}
    data-favourite=${state.favourite}
    data-action="select-mode"
    role="button"
    tabindex="0"
    aria-label=${state.label}
    title=${g.actionLabel ? state.label : nothing}
    style=${`cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border-radius:8px;background:${look.bgName === "transparent" ? "transparent" : look.bgColor};max-width:100%;box-sizing:border-box;transition:all 0.2s ease;`}
    @click=${() => g.select(item.dataMode)}
  >
    <div style=${`width:100%;max-width:${look.previewSize}px;`}>
      ${itemPreviewTemplate(item, { ...look.matrix, previewSize: look.previewSize, forceAspectRatio: true })}
    </div>
    ${look.showTitles
      ? html`<div
          class="gallery-item-title"
          style=${`font-size:13px;font-weight:500;${look.bgName === "black" ? "color:#fff;" : "color:var(--primary-text-color);"}`}
        >${item.title}</div>`
      : nothing}
    ${item.meta ? html`<div class="gallery-item-metadata">${item.meta}</div>` : nothing}${controls}
  </div>`;
}

// ── Wheel ──────────────────────────────────────────────────────────────────

/** The wheel's sizes from the gallery's options (Size, titles, height,
 * arrows). The item steps overlap: each item covers 35% of the previous. */
function wheelGeometry(config) {
  const look = previewLook(config, "preview-wheel");
  const compact = !look.showTitles;
  const height = config.wheel_height || 300;
  const previewSize = look.previewSize;
  const itemHeight = Math.max(compact ? 68 : 95, Math.round(previewSize * 0.25) + (compact ? 40 : 55));
  const step = Math.round(itemHeight * 0.65);
  // Two items show above and below the centred one.
  const paddingTop = 2 * step;
  const black = look.bgColor === "#000000";
  const transparent = look.bgColor === "transparent";
  return {
    look,
    compact,
    height,
    previewSize,
    itemHeight,
    step,
    paddingTop,
    // Centres item 0; each next item moves the column by one step.
    baseOffset: paddingTop + itemHeight / 2 - height / 2,
    maxWidth: Math.max(350, previewSize + 150),
    columnWidth: Math.max(250, previewSize + 50),
    navPosition: config.wheel_nav_position || "bottom",
    navRadius:
      { square: "0", rounded: "8px", round: "50%" }[resolveSelectorButtonShape(config)] || "50%",
    transparent,
    // Every item's look but its 3D place (wheel-picker.js wheelItemPlace).
    itemStyle: (index) =>
      `cursor: pointer; padding: ${compact ? "8px" : "8px 12px"}; border-radius: 10px; background: ${transparent ? "rgba(255,255,255,0.08)" : look.bgColor}; border: ${black ? "1px solid rgba(255,255,255,0.25)" : "1px solid var(--divider-color, #e0e0e0)"}; ${transparent ? "backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); " : ""}min-height: ${itemHeight}px; height: ${itemHeight}px; box-shadow: ${black ? "0 1px 4px rgba(255,255,255,0.08)" : "0 1px 3px rgba(0,0,0,0.1)"}; margin-top: ${index === 0 ? "0" : `-${Math.round(itemHeight * 0.35)}px`}; `,
  };
}

/** The wheel (wheel-picker.js <yc-wheel>): a move picks the centred item,
 * unless the gallery only browses (navigateSelects false: a click picks). */
export function wheelLayout(g) {
  const geometry = wheelGeometry(g.config);
  const { look, compact } = geometry;
  return html`<div class="gc-preview-shell" data-shape=${resolveSelectorShape(g.config)} style="border-radius: 8px;">
    <yc-wheel
      .items=${g.items}
      .active=${g.active}
      .geometry=${geometry}
      .onMove=${g.navigateSelects ? (key) => g.select(key) : null}
      .renderItem=${(item, index, place, centred) => {
        const state = itemState(g, item);
        return html`<div
          class="wheel-item${state.pending}"
          data-idx=${index}
          data-mode=${item.dataMode}
          data-active-mode=${state.active}
          data-favourite=${state.favourite}
          data-wheel-centered=${centred ? "true" : nothing}
          data-wheel-item=${compact ? nothing : "true"}
          data-wheel-compact-item=${compact ? "true" : nothing}
          role="button"
          tabindex="0"
          aria-label=${state.label}
          title=${state.title}
          style=${geometry.itemStyle(index) + place}
          @click=${g.navigateSelects ? nothing : () => g.select(item.dataMode)}
        >
          ${item.title
            ? compact
              ? html`<div class="wheel-item-title-hover">${item.title}</div>`
              : html`<div
                  class="wheel-item-title"
                  style=${`font-size: 14px; margin-bottom: 10px; ${titleColor(look.bgColor)}`}
                >${item.title}</div>`
            : nothing}
          <div class="wheel-item-body">
            ${itemPreviewTemplate(item, { ...look.matrix, previewSize: geometry.previewSize })}
          </div>
        </div>`;
      }}
    ></yc-wheel>
  </div>`;
}

// ── Album ──────────────────────────────────────────────────────────────────

/** The album: a 3D coverflow (album-view-coverflow.js <yc-album>); a click
 * on the centred card picks it. */
export function albumLayout(g, prefix, { width, radius, buttonShape }) {
  const { config } = g;
  const look = previewLook(config, "preview-album");
  return html`<div class="gc-preview-shell">
    <yc-album
      prefix=${prefix}
      .items=${g.items}
      .target=${g.index}
      .config=${{
        // The album card follows the preview size (55% = the 240px card).
        card_size: Math.round((width / 55) * 100),
        album_3d_effect: config.album_3d_effect,
        rounded_cards: radius,
      }}
      .wrap=${config.gallery_wrap_navigation === true}
      .navShape=${buttonShape}
      .onPick=${(item) => g.select(item.dataMode)}
      .renderItem=${(item) => {
        const state = itemState(g, item);
        const controls = g.itemControls(item);
        return html`<div
          class="${prefix}-album-entry${controls === nothing ? "" : " yc-editable"}${state.pending}"
          data-mode=${item.dataMode}
          data-active-mode=${state.active}
          data-favourite=${state.favourite}
          role="button"
          tabindex="0"
          aria-label=${state.label}
          title=${g.actionLabel ? state.label : nothing}
        >
          ${look.showTitles ? html`<div class="gallery-item-title">${item.title}</div>` : nothing}
          ${itemPreviewTemplate(item, g.matrix)}
          ${item.meta ? html`<div class="gallery-item-metadata">${item.meta}</div>` : nothing}${controls}
        </div>`;
      }}
    ></yc-album>
  </div>`;
}

// ── Original ───────────────────────────────────────────────────────────────

/** The Original browser: a grid or list of preview tiles with a name and
 * an optional capability badge (Clock and Native Effects). */
export function originalLayout(g) {
  const { config } = g;
  const view = config.effect_view === "list" ? "list" : "grid";
  const showBadges = config.show_badges !== false;
  const highlight = config.highlight_active_mode !== false;
  return html`<div class="original-gallery ${view}">
      ${g.pagination.items.map((item) => {
        const selected = g.active != null && item.dataMode === g.active;
        const state = itemState(g, item);
        const controls = g.itemControls(item);
        return html`<button
          class="original-item${controls === nothing ? "" : " yc-editable"}${state.pending}"
          type="button"
          data-mode=${item.dataMode}
          aria-label=${item.title}
          aria-pressed=${selected ? "true" : "false"}
          data-active-mode=${highlight && selected ? "true" : nothing}
          data-favourite=${state.favourite}
          title=${item.title}
          @click=${() => g.select(item.dataMode)}
        >
          ${item.preview === false
            ? html`<div class="unmodelled">Preview unavailable</div>`
            : html`<div
                class="original-item-preview"
                data-preview=${item.dataMode}
                style=${`width:${g.matrixWidth}%;margin-inline:auto;`}
              >${itemPreviewTemplate(item, g.matrix)}</div>`}
          <span class="original-item-name">${item.title}</span>
          ${showBadges && item.badge
            ? html`<span class="original-item-badge">${item.badge}</span>`
            : nothing}${controls}
        </button>`;
      })}
    </div>${paginationTemplate(g)}`;
}

// ── Pagination ─────────────────────────────────────────────────────────────

/** The page buttons of the list, grid and Original (pagination-utils.js
 * renderPagination's markup), at most 5 page numbers. */
export function paginationTemplate(g, maxPages = 5) {
  const { currentPage, totalPages } = g.pagination;
  if (!totalPages || totalPages <= 1) return nothing;
  const start = Math.max(0, currentPage - Math.floor(maxPages / 2));
  const end = Math.min(totalPages, start + maxPages);
  const pages = [];
  for (let page = start; page < end; page++) pages.push(page);
  const first = currentPage === 0;
  const last = currentPage >= totalPages - 1;
  return html`<div class="pagination-container pages">
    <button
      class="yc-page-btn save${first ? " disabled" : ""}"
      data-pagination-action="prev"
      title="Previous page"
      aria-label="Previous page"
      ?disabled=${first}
      @click=${() => g.setPage("prev")}
    ><ha-icon icon="mdi:chevron-left"></ha-icon></button>
    ${pages.map(
      (page) => html`<button
        class="yc-page-btn save${page === currentPage ? " active" : ""}"
        data-pagination-page=${page}
        title=${`Page ${page + 1}`}
        aria-label=${`Page ${page + 1}`}
        style="min-width:29px;height:29px;"
        @click=${() => g.setPage(page)}
      >${page + 1}</button>`,
    )}
    <button
      class="yc-page-btn save${last ? " disabled" : ""}"
      data-pagination-action="next"
      title="Next page"
      aria-label="Next page"
      ?disabled=${last}
      @click=${() => g.setPage("next")}
    ><ha-icon icon="mdi:chevron-right"></ha-icon></button>
  </div>`;
}
