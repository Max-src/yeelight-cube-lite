import { escapeHtml } from "./html-escape-utils.js";
import {
  renderGalleryDisplay,
  renderMatrixPreview,
  galleryDisplayStyles,
} from "./gallery-display-utils.js";
import { renderCarouselString, carouselStyles } from "./carousel-utils.js";
import { renderPagination } from "./pagination-utils.js";
import {
  resolveSelectorShape,
  resolveSelectorButtonShape,
  selectorShapeToCarouselButtonShape,
  selectorSharedStyles,
} from "./selector-shared-styles.js";
export const styleSelectorStyles =
  selectorSharedStyles + galleryDisplayStyles + carouselStyles;
export function bindStyleSelectorEvents(
  root,
  { select, navigate, setIndex, style },
) {
  root
    .querySelectorAll(
      ".mode-btn-filled[data-mode], .mode-chip[data-mode], .gc-preview-shell .gallery-item[data-mode]",
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
  const shell = root.querySelector(".gc-preview-shell");
  if (shell && style === "preview-carousel") {
    let start = null;
    shell.ontouchstart = (event) => {
      start = event.touches[0].clientX;
    };
    shell.ontouchend = (event) => {
      const delta = event.changedTouches[0].clientX - start;
      if (start != null && Math.abs(delta) > 40) navigate(delta < 0 ? 1 : -1);
      start = null;
    };
  }
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
export function renderTextStyleSelector(config, items, sel, active) {
  const styles = items;
  const shape = resolveSelectorShape(config);
  const scale = Math.max(
    0.8,
    Math.min(1.4, (Number(config.preview_size) || 55) / 50),
  );
  const selAttrs = `data-shape="${shape}" style="--gc-sel-scale:${scale}; display: flex; flex-wrap: wrap; gap: 6px;"`;

  if (sel === "dropdown") {
    return `
        <div class="gc-selector" data-shape="${shape}" style="--gc-sel-scale:${scale};">
          <select class="mode-select" data-mode-select="true">
            ${styles.some((style) => style.dataMode === active) ? "" : '<option value="" disabled selected>Current style outside this list</option>'}
            ${styles
              .map(
                (s) =>
                  `<option value="${escapeHtml(s.dataMode)}" ${
                    active === s.dataMode ? "selected" : ""
                  }>${escapeHtml(s.name)}</option>`,
              )
              .join("")}
          </select>
        </div>`;
  }

  if (sel === "chips") {
    return `
        <div class="gc-selector" ${selAttrs}>
          ${styles
            .map(
              (s) => `
                <button class="mode-chip ${active === s.dataMode ? "active" : ""}"
                  data-mode="${escapeHtml(s.dataMode)}" title="${escapeHtml(s.name)}">
              <span class="mode-chip-swatch" style="background:${s.swatch || "var(--primary-color)"}"></span>
              <span class="mode-chip-label">${escapeHtml(s.name)}</span>
            </button>`,
            )
            .join("")}
        </div>`;
  }

  // "filled" (default text style)
  return `
      <div class="gc-selector" ${selAttrs}>
        ${styles
          .map(
            (s) => `
            <button class="mode-btn-filled ${active === s.dataMode ? "active" : ""}"
              data-mode="${escapeHtml(s.dataMode)}" title="${escapeHtml(s.name)}">
            ${escapeHtml(s.name)}
          </button>`,
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
  // The shared renderers colour titles white only when the bg is exactly
  // "#000000"; pass that (not "black") so titles stay readable on a black bg.
  const rendererBg = bgName === "black" ? "#000000" : bgName;
  const showTitles = config.preview_show_titles !== false;
  const spacing = config.gallery_spacing_mode || "normal";
  const pixelGap =
    spacing === "normal" ? Math.max(0, (previewSize / 350) * 3) : 0;
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
        <div class="gc-preview-shell" ${shellAttrs} style="margin-top:12px;border-radius:8px;">
          ${renderCarouselString({
            items,
            currentIndex: state.index,
            buttonShape: selectorShapeToCarouselButtonShape(
              resolveSelectorButtonShape(config),
            ),
            showAsCard: true,
            carouselId: "cc-clock-carousel",
            wrapNavigation: config.gallery_wrap_navigation === true,
            renderItemString: (it) => `
              <div class="gallery-item cc-carousel-item" data-mode="${escapeHtml(it.dataMode)}"
                   data-action="select-mode"
                   style="cursor:pointer;display:flex;flex-direction:column;align-items:center;
                          gap:6px;padding:10px;border-radius:8px;background:${bgName === "transparent" ? "transparent" : rendererBg};
                          max-width:100%;box-sizing:border-box;transition:all 0.2s ease;">
                <div style="width:100%;max-width:${previewSize}px;">
                  ${renderMatrixPreview(it.colorData, {
                    rows: 5,
                    cols: 20,
                    bgColor: rendererBg,
                    pixelStyle,
                    pixelGap,
                    previewSize,
                    ignoreBlackPixels,
                    matrixBoxShadow,
                    pixelBoxShadow,
                    forceAspectRatio: true,
                  })}
                </div>
                ${showTitles ? `<div style="font-size:13px;font-weight:500;${bgName === "black" ? "color:#fff;" : "color:var(--primary-text-color);"}">${escapeHtml(it.title)}</div>` : ""}
              </div>`,
          })}
        </div>`;
  }

  // List / grid modes: optional pagination via the shared utility (same
  // config key + controls as the palette and draw cards).
  let pagedItems = items;
  let paginationHtml = "";
  const itemsPerPage = parseInt(config.items_per_page) || 0;
  if (displayMode === "list" && itemsPerPage > 0) {
    const result = renderPagination({
      items,
      currentPage: state.page || 0,
      itemsPerPage,
    });
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
    wheelNavPosition: config.wheel_nav_position || "bottom",
    wheelHeight: config.wheel_height || 300,
    wheelDisplayStyle: showTitles ? "default" : "compact",
    navButtonShape: resolveSelectorButtonShape(config),
    currentMode: null, // highlight applied afterwards as DOM attributes
    highlightActive: config.highlight_active_mode !== false,
  });

  return `
      <div class="gc-preview-shell" ${shellAttrs} style="margin-top: 12px; border-radius: 8px;">
        ${galleryHtml}
        ${paginationHtml}
      </div>`;
}
