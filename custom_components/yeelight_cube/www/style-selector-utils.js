import { escapeHtml } from "./html-escape-utils.js";
import {
  renderGalleryDisplay,
  renderMatrixPreview,
  renderItemPreview,
  galleryDisplayStyles,
} from "./gallery-display-utils.js";
import {
  renderCarouselString,
  carouselSwipe,
  carouselStyles,
} from "./carousel-utils.js";
import { renderPagination } from "./pagination-utils.js";
import { renderActionButtonHTML } from "./action-button-utils.js";
import {
  resolveSelectorShape,
  resolveSelectorButtonShape,
  selectorShapeToCarouselButtonShape,
  selectorSharedStyles,
} from "./selector-shared-styles.js";
export const styleSelectorStyles =
  selectorSharedStyles + galleryDisplayStyles + carouselStyles;

/** The gallery layout of a card config (older Original configs only set
 * effect_view). The gallery and its editor settings both read it. */
export function gallerySelectorStyle(config) {
  return (
    config?.style_selector_style ||
    (config?.effect_view ? "original" : "preview-grid")
  );
}

/** One page-size value for every selector. 0 and missing both mean no paging. */
export function selectorItemsPerPage(config) {
  const value = parseInt(config?.items_per_page, 10);
  return value > 0 ? value : 0;
}
// Items per page of a browser layout (0: the layout does not page).
export function selectorPageSize(config, style) {
  return ["original", "preview-list", "preview-grid"].includes(style)
    ? selectorItemsPerPage(config)
    : 0;
}

export function selectorPagination(config, items, style, page = 0) {
  return renderPagination({
    items,
    currentPage: page,
    itemsPerPage: selectorPageSize(config, style),
  });
}
export function bindStyleSelectorEvents(
  root,
  { select, navigate, setIndex, style },
) {
  root
    .querySelectorAll(
      ".gc-selector .shared-action-button[data-mode], .gc-selector .mode-chip[data-mode], .gc-preview-shell .gallery-item[data-mode]",
    )
    .forEach((node) => {
      if (style !== "preview-wheel")
        node.onclick = () => select(node.dataset.mode);
    });
  const dropdown = root.querySelector(".mode-select:not(.colormode-select)");
  if (dropdown) dropdown.onchange = (event) => select(event.target.value);
  root.querySelectorAll('[data-action="navigate"]').forEach((node) => {
    node.onclick = (event) => {
      event.stopPropagation();
      navigate(Number(node.dataset.direction) || 1);
    };
  });
  root.querySelectorAll('[data-action="set-index"]').forEach((node) => {
    node.onclick = (event) => {
      event.stopPropagation();
      setIndex(Number(node.dataset.index) || 0);
    };
  });
  // The carousel's swipe (carouselSwipe: horizontal swipes step, vertical
  // moves still scroll the page).
  const shell = root.querySelector(".gc-preview-shell");
  if (shell && style === "preview-carousel")
    shell.ontouchstart = carouselSwipe((direction) => navigate(direction));
}
export function selectorDisplayMode(style) {
  return (
    {
      "preview-wheel": "wheel",
      "preview-carousel": "carousel",
      "preview-strip": "strip",
    }[style] || "list"
  );
}
/**
 * A chip's swatch, chosen per item so it means something for every kind:
 * - item.swatch, a CSS background the card computes (a gradient mode's own
 *   gradient, a palette's colors);
 * - else a micro-matrix of the item's preview frame (item.colorData: clock
 *   styles show their digits, pixel arts their picture). Cards that animate
 *   their previews (Clock, Native Effects) animate it too: it is a
 *   `.gallery-matrix-preview` inside the `[data-mode]` chip;
 * - else a neutral dot.
 */
export function chipSwatch(item) {
  if (item.swatch)
    return `<span class="mode-chip-swatch" style="background:${escapeHtml(item.swatch)}"></span>`;
  if (item.colorData)
    return `<span class="mode-chip-swatch mode-chip-matrix">${renderMatrixPreview(
      item.colorData,
      {
        rows: 5,
        cols: 20,
        bgColor: "#000000",
        pixelStyle: "square",
        pixelGap: 0,
        previewSize: 44,
        proportionalSpacing: false,
      },
    )}</span>`;
  return `<span class="mode-chip-swatch"></span>`;
}

export function renderTextStyleSelector(config, items, sel, active) {
  const styles = items;
  const shape = resolveSelectorShape(config);
  const scale = Math.max(
    0.8,
    Math.min(1.4, (Number(config.preview_size) || 55) / 50),
  );
  const selAttrs = `data-shape="${shape}" style="display: flex; flex-wrap: wrap; gap: 6px; --gc-sel-scale:${scale};"`;

  if (sel === "dropdown") {
    return `
        <div class="gc-selector" data-shape="${shape}" style="--gc-sel-scale:${scale};">
          <select class="mode-select" data-mode-select="true">
            ${
              styles.some((style) => style.dataMode === active)
                ? ""
                : // No active item (palettes, pixel arts): a prompt; an
                  // active one hidden by the search or the list: said so.
                  `<option value="" disabled selected>${
                    active == null ? "Choose…" : "Current choice not in this list"
                  }</option>`
            }
            ${styles
              .map(
                (s) =>
                  `<option value="${escapeHtml(s.dataMode)}" ${
                    active === s.dataMode ? "selected" : ""
                  }>${s.favourite ? "★ " : ""}${escapeHtml(s.name)}</option>`,
              )
              .join("")}
          </select>
        </div>`;
  }

  // "chips": a pill per item with its swatch before its label (chipSwatch).
  if (sel === "chips") {
    return `
      <div class="gc-selector gc-chips" data-shape="${shape}" style="--gc-sel-scale:${scale};" role="radiogroup">
        ${styles
          .map((s) => {
            const selected = active === s.dataMode;
            return `<button type="button" class="mode-chip${selected ? " active" : ""}"
                data-mode="${escapeHtml(s.dataMode)}" role="radio"
                aria-checked="${selected}" title="${escapeHtml(s.name)}">
              ${chipSwatch(s)}
              <span class="mode-chip-label">${escapeHtml(s.label || s.name)}</span>
            </button>`;
          })
          .join("")}
      </div>`;
  }

  // "filled" (default text style) — rendered through the shared action-button
  // system (text-only, no icons) so these buttons match the color-mode buttons
  // on every card. item.label is the optional short button text.
  return `
      <div class="gc-selector" ${selAttrs}>
        ${styles
          .map((s) =>
            renderActionButtonHTML({
              action: "tool",
              // Unset falls back to DEFAULT_BUTTON_STYLE in the shared model.
              buttonStyle: config.buttons_style,
              contentMode: "text",
              label: s.label || s.name,
              title: s.name,
              selected: active === s.dataMode,
              role: "radio",
              value: s.dataMode,
              dataMode: s.dataMode,
            }),
          )
          .join("")}
      </div>`;
}
export function renderPreviewStyleSelector(config, items, sel, active, state) {
  if (!items.length) return "";

  const shape = resolveSelectorShape(config);
  const shellAttrs = `data-shape="${shape}"${
    sel === "preview-grid" ? ' data-columns="2"' : ""
  }`;
  const previewSize = Math.round((Number(config.preview_size) || 55) * 4.5);
  const effectivePreviewSize =
    sel === "preview-grid"
      ? Math.round(previewSize * 0.5)
      : sel === "preview-strip"
        ? Math.round(previewSize * 0.4)
        : previewSize;
  const pixelStyle = config.gallery_pixel_style || "square";
  const bgName = config.gallery_background_color || "black";
  // The shared renderers color titles white only when the bg is exactly
  // "#000000"; pass that (not "black") so titles stay readable on a black bg.
  const rendererBg = bgName === "black" ? "#000000" : bgName;
  const showTitles = config.preview_show_titles !== false;
  const spacing = config.gallery_spacing_mode || "normal";
  const pixelGap = spacing === "normal" ? 3 : 0;
  const pixelBoxShadow = ["subtle", "normal"].includes(spacing);
  const matrixBoxShadow = config.gallery_matrix_box_shadow === true;
  const ignoreBlackPixels =
    bgName !== "black" && config.gallery_ignore_black_pixels === true;
  const displayMode = selectorDisplayMode(sel);

  if (displayMode === "carousel") {
    if (state.index == null) {
      const idx = items.findIndex((it) => it.dataMode === active);
      state.index = idx >= 0 ? idx : 0;
    }
    state.index = Math.max(0, Math.min(state.index, items.length - 1));
    return `
        <div class="gc-preview-shell" ${shellAttrs} style="border-radius:8px;">
          ${renderCarouselString({
            items,
            currentIndex: state.index,
            buttonShape: selectorShapeToCarouselButtonShape(
              resolveSelectorButtonShape(config),
            ),
            showAsCard: true,
            carouselId: "gallery-carousel",
            wrapNavigation: config.gallery_wrap_navigation === true,
            renderItemString: (it) => `
              <div class="gallery-item yc-carousel-item" data-mode="${escapeHtml(it.dataMode)}"
                   data-action="select-mode"
                   style="cursor:pointer;display:flex;flex-direction:column;align-items:center;
                          gap:6px;padding:10px;border-radius:8px;background:${bgName === "transparent" ? "transparent" : rendererBg};
                          max-width:100%;box-sizing:border-box;transition:all 0.2s ease;">
                <div style="width:100%;max-width:${previewSize}px;">
                  ${renderItemPreview(it, {
                    rows: 5,
                    cols: 20,
                    bgColor: rendererBg,
                    pixelStyle,
                    pixelGap,
                    proportionalSpacing: true,
                    previewSize,
                    ignoreBlackPixels,
                    matrixBoxShadow,
                    pixelBoxShadow,
                    forceAspectRatio: true,
                  })}
                </div>
                ${showTitles ? `<div class="gallery-item-title" style="font-size:13px;font-weight:500;${bgName === "black" ? "color:#fff;" : "color:var(--primary-text-color);"}">${escapeHtml(it.title)}</div>` : ""}
                ${it.metadata ? `<div class="gallery-item-metadata">${it.metadata}</div>` : ""}
              </div>`,
          })}
        </div>`;
  }

  // List / grid modes: optional pagination via the shared utility (same
  // config key + controls as the palette and draw cards).
  let pagedItems = items;
  let paginationHtml = "";
  const itemsPerPage = selectorItemsPerPage(config);
  if (displayMode === "list" && itemsPerPage > 0) {
    const result = selectorPagination(config, items, sel, state.page || 0);
    pagedItems = result.items;
    paginationHtml = result.html;
    state.page = result.currentPage;
  }

  const galleryHtml = renderGalleryDisplay(pagedItems, displayMode, {
    rows: 5,
    cols: 20,
    bgColor: rendererBg,
    pixelStyle,
    pixelGap,
    previewSize: effectivePreviewSize,
    ignoreBlackPixels,
    showCards: displayMode === "wheel" || displayMode === "strip",
    showTitles,
    onClickEnabled: true,
    matrixBoxShadow,
    pixelBoxShadow,
    proportionalSpacing: true,
    wheelNavPosition: config.wheel_nav_position || "bottom",
    wheelHeight: config.wheel_height || 300,
    wheelDisplayStyle: showTitles ? "default" : "compact",
    navButtonShape: resolveSelectorButtonShape(config),
    currentMode: null, // highlight applied afterwards as DOM attributes
    highlightActive: config.highlight_active_mode !== false,
  });

  return `
      <div class="gc-preview-shell" ${shellAttrs} style="border-radius: 8px;">
        ${galleryHtml}
        ${paginationHtml}
      </div>`;
}
