import { LitElement, html, repeat, unsafeHTML } from "./lib/lit-all.js";
import { getInitialMatrix, parseConfig } from "./draw_card_state.js";
import { drawCardStyles } from "./draw_card_styles.js";
import { compactModeStyles } from "./compact-mode-styles.js";
import {
  compactLayoutStyles,
  renderCompactItem,
  setupCompactDragDrop,
} from "./compact-layout-utils.js";
import {
  deleteButtonStyles,
  deleteButtonPositionStyles,
  getDeleteButtonClass,
  getDeleteButtonConfig,
} from "./delete-button-styles.js";
import {
  exportImportButtonStyles,
  renderButtonContent as renderExportImportButtonContent,
  getExportImportButtonClass,
} from "./export-import-button-utils.js";
import { renderCarousel } from "./carousel-utils.js";
import { listModeStyles } from "./list-mode-utils.js";
import { galleryModeStyles, renderGalleryMode } from "./gallery-mode-utils.js";
import { savePalette, getLampPalette } from "./draw_card_palette.js";
import { ToolManager, ActionManager } from "./draw_card_tools.js";
import { MatrixOperations1D } from "./draw_card_matrix_1d.js";
import {
  getAlbumStyles,
  renderAlbumView,
  setupAlbumNavigation,
} from "./album-view-coverflow.js";
import {
  handleToolSelect,
  handleColorSelect,
  handleMatrixClear,
  handleMatrixFillAll,
  handleMatrixAreaFill,
  handleMatrixPreviewArea,
  handleMatrixPreviewFillAll,
} from "./draw_card_handlers.js";
import { renderPaletteSection } from "./draw_card_palette_ui.js";
import { renderMatrixPixel } from "./draw_card_ui.js";
import {
  drawPixel,
  startDraw,
  endDraw,
  drawMove,
  onMatrixClick,
  erasePixel,
  onMatrixMouseOver,
  onMatrixMouseLeave,
} from "./draw_card_events.js";
import {
  normalizeHex,
  updateRecentColors,
  lampToMatrixCoords,
  matrixToLampCoords,
  rgbArrayToHex,
  isBlackPixel,
  resolveBgColor,
  createEmptyMatrix,
  extractDiversePaletteFromRgb,
  extractDiversePaletteWithWeights,
} from "./draw_utils.js";
import {
  GRID_COLS,
  GRID_ROWS,
  MATRIX_SIZE,
  OFF_COLOR,
  EVT_ACTION_ORDER_RESET,
  EVT_ACTION_VISIBILITY_RESET,
} from "./draw_card_const.js";
import { StorageUtils } from "./draw_card_storage.js";
import { callServiceOnTargetEntities as callServiceSequentially } from "./service-call-utils.js?v=2";

const MAX_IMAGE_PALETTE_COLORS = 15;

console.error(
  `[YeelightDrawCard] module loaded at ${new Date().toISOString()}`,
);

class YeelightCubeDrawCard extends LitElement {
  static getStubConfig(hass) {
    const firstEntity =
      Object.keys(hass?.states || {}).find(
        (e) =>
          e.startsWith("light.yeelight_cube") ||
          e.startsWith("light.cubelite_"),
      ) || "";
    return {
      type: "custom:yeelight-cube-draw-card",
      entity: firstEntity,
      target_entities: firstEntity ? [firstEntity] : [],
      pixel_spacing_mode: "normal",
      matrix_bg: "black",
      matrix_box_shadow: true,
      pixel_art_spacing_mode: "normal",
      pixel_art_show_titles: true,
      pixel_art_allow_rename: false,
      matrix_size: 100,
      button_shape: "circle",
      actions_buttons_style: "gradient",
      actions_content_mode: "icon_text",
      tool_buttons_style: "icon",
      tool_content_mode: "icon",
      paint_button_shape: "rect",
      swatch_shape: "round",
      expand_btn_mode: "label",
      pixel_art_preview_size: 82,
      tools_order: [
        "colorPicker",
        "eyedropper",
        "pencil",
        "eraser",
        "areaFill",
        "fillAll",
        "undo",
      ],
      show_colors_section: true,
      show_tools_section: true,
      show_matrix_section: true,
      show_actions_section: true,
      show_pixelart_section: true,
      show_card_background: true,
      show_recent_colors: false,
      show_lamp_palette: true,
      show_lamp_colors: true,
      show_image_palette: true,
      show_pixelart_gallery: true,
      pixel_art_delete_button_style: "text",
      show_pixelart_export_button: true,
      show_pixelart_import_button: true,
      pixelart_buttons_content_mode: "icon_text",
      palette_card_mode: "tabs",
      pixel_art_items_per_page: 3,
      pixel_art_gallery_mode: "carousel",
      pixel_art_background_color: "black",
      pixelart_buttons_style: "icon",
      expand_btn_style: "pill",
      palette_display_mode: "row",
      color_info_display: "name",
      matrix_pixel_style: "circle",
      pixel_art_remove_button_style: "black",
      delete_button_inside: true,
      pixelart_content_mode: "icon",
      pixel_art_pixel_style: "circle",
    };
  }

  static getStorageUtils() {
    return StorageUtils;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("mousedown", this._handleTabsOutsideClick);
    document.addEventListener("mousedown", this._handleFloatingOutsideClick);
  }

  _handleTabsOutsideClick = (e) => {
    if (this.config?.palette_card_mode !== "tabs") return;
    // Early-exit when no tab is open — avoids a requestUpdate() on every global mousedown (#9)
    if (this._activePaletteTab === null) return;
    const tabBar = this.shadowRoot?.querySelector(".palette-tab-bar");
    const tabContent = this.shadowRoot?.querySelector(".palette-tab-content");
    if (!tabBar && !tabContent) return;
    if (
      (tabBar && tabBar.contains(e.target)) ||
      (tabContent && tabContent.contains(e.target))
    ) {
      return;
    }
    this._activePaletteTab = null;
    this.requestUpdate();
  };

  firstUpdated() {
    // Setup album navigation on first render if in album mode
    const cfg = this.config || {};
    if (cfg.pixel_art_gallery_mode === "album") {
      setTimeout(() => this._setupPixelArtAlbumNavigation(), 0);
    }

    // Drag-to-scroll is now setup in _setupPaletteRowDragScroll(), called from updated()
    this._setupPaletteRowDragScroll();
  }

  _handleFloatingOutsideClick = (e) => {
    if (!this.config || this.config.palette_card_mode !== "floating") return;
    const openKeys = Object.keys(this._floatingStates || {}).filter(
      (k) => this._floatingStates[k],
    );
    if (!openKeys.length) return;
    // Use composedPath() so clicks inside shadow-DOM children of buttons/cards
    // are correctly identified as "inside" (issue #10).
    // Falls back to e.target for environments that don't support composedPath.
    const composedPath = e.composedPath ? e.composedPath() : [];
    const isInsideEl = (el) =>
      composedPath.some(
        (n) => n === el || (n instanceof Node && el.contains(n)),
      );
    const btns = this.shadowRoot.querySelectorAll(".palette-floating-btn");
    const cards = this.shadowRoot.querySelectorAll(
      ".palette-group-card.floating",
    );
    let inside = false;
    btns.forEach((btn) => {
      if (isInsideEl(btn)) inside = true;
    });
    cards.forEach((card) => {
      if (isInsideEl(card)) inside = true;
    });
    if (!inside) {
      openKeys.forEach((k) => (this._floatingStates[k] = false));
      this.requestUpdate();
    }
  };

  /**
   * Attach drag-to-scroll (mouse + touch) to a single scrollable element.
   * No-ops if already attached.
   */
  _attachDragScroll(el) {
    if (!el || el._dragScrollAttached) return;
    el._dragScrollAttached = true;

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let hasDragged = false;

    const onStart = (pageX) => {
      isDown = true;
      hasDragged = false;
      el.style.cursor = "grabbing";
      startX = pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    };
    const onEnd = () => {
      if (!isDown) return;
      isDown = false;
      el.style.cursor = "grab";
    };
    const onMove = (pageX, e) => {
      if (!isDown) return;
      const x = pageX - el.offsetLeft;
      const dx = x - startX;
      // Only start scrolling after a small dead-zone to avoid interfering with clicks
      if (!hasDragged && Math.abs(dx) < 4) return;
      hasDragged = true;
      e.preventDefault();
      const walk = dx * 1.2; // slight acceleration for natural feel
      el.scrollLeft = scrollLeft - walk;
    };

    // Mouse events
    el.addEventListener("mousedown", (e) => onStart(e.pageX));
    el.addEventListener("mouseleave", onEnd);
    el.addEventListener("mouseup", onEnd);
    el.addEventListener("mousemove", (e) => onMove(e.pageX, e));

    // Touch events (mobile)
    el.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) onStart(e.touches[0].pageX);
      },
      { passive: true },
    );
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    el.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 1) onMove(e.touches[0].pageX, e);
      },
      { passive: false },
    );
  }

  /**
   * Enable drag-to-scroll for .palette-row and .palette-row-scroll containers.
   * Safe to call repeatedly — skips already-attached elements.
   */
  _setupPaletteRowDragScroll() {
    // Top-level side-by-side container
    const paletteRow = this.shadowRoot?.querySelector(".palette-row");
    this._attachDragScroll(paletteRow);

    // Individual color swatch scroll rows inside palette cards
    const scrollRows =
      this.shadowRoot?.querySelectorAll(".palette-row-scroll") || [];
    scrollRows.forEach((row) => this._attachDragScroll(row));
  }

  updated(changedProperties) {
    super.updated(changedProperties);

    const cfg = this.config || {};

    // Re-setup album navigation when config changes or sensor updates (in album mode)
    if (
      cfg.pixel_art_gallery_mode === "album" &&
      (changedProperties.has("config") || changedProperties.has("hass"))
    ) {
      // Use setTimeout to ensure DOM is fully rendered
      setTimeout(() => this._setupPixelArtAlbumNavigation(), 0);
    }

    // Setup drag-and-drop for compact mode pixel arts
    if (
      cfg.pixel_art_gallery_mode === "compact" &&
      (changedProperties.has("config") || changedProperties.has("hass"))
    ) {
      setTimeout(() => this._setupPixelArtCompactDragDrop(), 0);
    }

    // Re-setup drag-to-scroll only when config/hass changes (avoids querySelectorAll
    // on every render cycle including rapid hover animation re-renders — issue #8).
    if (changedProperties.has("config") || changedProperties.has("hass")) {
      setTimeout(() => this._setupPaletteRowDragScroll(), 0);
    }

    // Trigger preview-hover height measurement after each render
    this._schedulePreviewHoverMeasure();
  }

  // ─── Preview-hover measurement ─────────────────────────────────────────
  //
  // Each palette custom element (PaletteBase subclass) fires
  // "palette-element-rendered" (bubbling) at the END of its rAF-deferred
  // _doRender(), i.e. after its innerHTML has settled and the browser has
  // resolved layout for that element.  We listen for this event on the
  // .palette-preview-hover container and use it as the authoritative
  // trigger to measure collapsed card heights.
  //
  // Additional triggers:
  //   • _schedulePreviewHoverMeasure() — called from Lit's updated() for
  //     cases where no custom-element re-render happens (e.g. empty cards,
  //     mode changes that don't touch palette content).
  //   • A 600ms fallback timeout — catches any edge case.
  //
  // All triggers are debounced through a single rAF so rapid successive
  // events coalesce into one measurement per frame.
  //
  // applyHeights():
  //   Reads each non-empty body's scrollHeight (layout height, unaffected by
  //   CSS transforms), picks the tallest one as uniformH = ceil(max / nCards),
  //   and sets that same max-height on EVERY collapsed card so they are all
  //   the same height regardless of palette size or color-info display mode.

  _schedulePreviewHoverMeasure() {
    if (this._previewMeasurePending) return;
    this._previewMeasurePending = true;
    requestAnimationFrame(() => {
      this._previewMeasurePending = false;
      this._setupPreviewHoverMeasurement();
    });
  }

  // Set up (or refresh) the hover measurement for the current DOM state.
  // Safe to call multiple times — tears down/recreates listeners cleanly.
  _setupPreviewHoverMeasurement() {
    const el = this.shadowRoot
      ? this.shadowRoot.querySelector(".palette-preview-hover")
      : this.querySelector(".palette-preview-hover");

    if (!el) {
      // Container gone — clean up any lingering state.
      if (this._previewEl && this._previewRenderedListener) {
        this._previewEl.removeEventListener(
          "palette-element-rendered",
          this._previewRenderedListener,
        );
      }
      if (this._previewApplyRAF) {
        cancelAnimationFrame(this._previewApplyRAF);
        this._previewApplyRAF = null;
      }
      clearTimeout(this._previewROTimeout);
      this._previewEl = null;
      return;
    }

    const allCards = [...el.querySelectorAll(".palette-preview-card")];
    const nCards = allCards.length || 1;

    // ── Early-exit: same element, same card count ─────────────────────────
    // updated() fires on every prop/state change (expand timer, HA entity
    // updates, etc.).  Avoid tearing down and re-adding listeners when
    // nothing structural has changed — that caused unnecessary overhead.
    if (el === this._previewEl && nCards === this._previewNCards) {
      // Still schedule a fresh measurement in case content changed.
      if (this._previewScheduleApply) this._previewScheduleApply();
      return;
    }

    // ── Full setup (first time, or structural change) ─────────────────────
    if (this._previewEl && this._previewRenderedListener) {
      this._previewEl.removeEventListener(
        "palette-element-rendered",
        this._previewRenderedListener,
      );
    }
    if (this._previewApplyRAF) {
      cancelAnimationFrame(this._previewApplyRAF);
      this._previewApplyRAF = null;
    }
    clearTimeout(this._previewROTimeout);
    this._previewEl = el;
    this._previewNCards = nCards;

    // Preserve in-flight collapse guards across re-setups (called from
    // updated() which fires even during the collapse timer window).
    if (!this._collapsingCards) this._collapsingCards = new Set();

    // Prune stale entries from previous card list.
    for (const stale of this._collapsingCards) {
      if (!allCards.includes(stale)) this._collapsingCards.delete(stale);
    }

    const gap = 8;
    const outerW = el.offsetWidth;
    const bodyW = outerW - (nCards - 1) * gap;
    if (bodyW > 0) el.style.setProperty("--container-w", bodyW + "px");

    // ── Core measurement function ──────────────────────────────────────────
    // Reads body.scrollHeight (full layout height, unaffected by CSS
    // transforms / overflow clipping) and sets max-height = scrollH/nCards
    // so each card shows exactly its scaled-down share of the content.
    const applyHeights = () => {
      const outerW2 = el.offsetWidth;
      const expandedMode = el.classList.contains("expanded-mode");
      if (expandedMode) {
        if (outerW2 > 0) el.style.setProperty("--container-w", outerW2 + "px");
      } else {
        const bodyW2 = outerW2 - (nCards - 1) * gap;
        if (bodyW2 > 0) el.style.setProperty("--container-w", bodyW2 + "px");
      }
      let maxScrollH = 0;
      allCards.forEach((card) => {
        if (card.classList.contains("empty")) return;
        if (card.classList.contains("expanded") || expandedMode) return;
        const body = card.querySelector(".palette-preview-body");
        if (body && body.scrollHeight > maxScrollH)
          maxScrollH = body.scrollHeight;
      });
      // +1px breathing room avoids sub-pixel clipping.
      const uniformH = maxScrollH > 0 ? Math.ceil(maxScrollH / nCards) + 1 : 0;
      const uniformPx = uniformH > 0 ? uniformH + "px" : "";
      // Stored so handleCollapse can read the target without re-measuring.
      this._previewUniformPx = uniformPx;
      allCards.forEach((card) => {
        if (this._collapsingCards && this._collapsingCards.has(card)) {
          // handleCollapse owns this card's animation via a direct rAF.
          // Don't touch max-height here or we'll race with it.
          return;
        } else if (card.classList.contains("expanded") || expandedMode) {
          // Expanded: clear any inline max-height and let the CSS class rule
          // (max-height: 2000px) handle space. Writing a JS-measured value here
          // creates a feedback loop — the inline style constrains the layout,
          // which changes body.scrollHeight on the next call, causing oscillation.
          // The collapse handler pins with scrollHeight separately, just before
          // triggering the collapse transition.
          if (card.style.maxHeight) card.style.removeProperty("max-height");
        } else if (uniformPx && card.style.maxHeight !== uniformPx) {
          // Only write when the value actually changes — avoids forced style
          // recalculations on every palette-element-rendered event.
          card.style.maxHeight = uniformPx;
        }
      });
    };

    // ── Debounce helper — coalesces bursts of events into one rAF ─────────
    const scheduleApply = () => {
      if (this._previewApplyRAF) cancelAnimationFrame(this._previewApplyRAF);
      this._previewApplyRAF = requestAnimationFrame(() => {
        this._previewApplyRAF = null;
        applyHeights();
      });
    };

    // Expose so handleCollapse's transitionend callback (different closure)
    // can trigger the final measurement after the animation completes.
    this._previewScheduleApply = scheduleApply;

    // ── palette-element-rendered — fires after each palette finishes render ─
    // Fix #7: skip events that bubble from a card that is currently mid-collapse.
    // Those cards have their max-height pinned by handleCollapse; calling
    // applyHeights() from inside the collapse animation could overwrite that pin
    // and restart or stutter the CSS transition.
    this._previewRenderedListener = (ev) => {
      if (this._collapsingCards && this._collapsingCards.size > 0) {
        const path = ev.composedPath ? ev.composedPath() : [];
        for (const node of path) {
          if (this._collapsingCards.has(node)) return;
        }
      }
      scheduleApply();
    };
    el.addEventListener(
      "palette-element-rendered",
      this._previewRenderedListener,
    );

    // ── Immediate baseline pass ────────────────────────────────────────────
    scheduleApply();

    // ── Hard fallback — catches cases where no event fires (e.g. empty cards) ─
    this._previewROTimeout = setTimeout(applyHeights, 600);
  }

  _renderPaletteCards(
    cfg,
    showRecentColors,
    showLampPalette,
    showLampColors,
    showImagePalette,
  ) {
    const mode = cfg.palette_card_mode || "side";
    const buttonShape = cfg.button_shape || "rect";
    const cards = [];
    const expandStyle = cfg.expand_btn_style || "pill";
    const blindsDir = cfg.blinds_direction || "rows";
    const colorInfo = cfg.color_info_display || "none";
    const gradientFreePick = cfg.gradient_free_pick === true;
    if (showRecentColors) {
      const palette = this.recentColors || [];
      cards.push({
        key: "recent",
        title: "Recent Colors",
        palette,
        weights: null,
        content: renderPaletteSection(
          palette,
          "recent",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          null,
          colorInfo,
          gradientFreePick,
        ),
      });
    }
    if (showLampPalette) {
      const palette = this.getLampGradientColors() || [];
      cards.push({
        key: "lamp",
        title: "Lamp Palette",
        palette,
        weights: null,
        content: renderPaletteSection(
          palette,
          "lamp",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          null,
          colorInfo,
          gradientFreePick,
        ),
      });
    }
    if (showLampColors) {
      const { palette, weights } = this._getLampMatrixColors();
      cards.push({
        key: "lampcolors",
        title: "Lamp Colors",
        palette,
        weights,
        content: renderPaletteSection(
          palette,
          "lampcolors",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          weights,
          colorInfo,
          gradientFreePick,
        ),
      });
    }
    if (showImagePalette) {
      const { palette, weights } = this._getCurrentColors();
      cards.push({
        key: "image",
        title: "Drawing Colors",
        palette,
        weights,
        content: renderPaletteSection(
          palette,
          "image",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          weights,
          colorInfo,
          gradientFreePick,
        ),
      });
    }

    if (!cards.length) return html``;

    const emptyHint = html`<div class="palette-empty-hint">No colors</div>`;
    const cardContent = (card) =>
      card.palette.length ? card.content : emptyHint;

    // Colors card border
    const colorsBorderMode = cfg.colors_card_border || "auto";
    const isDark =
      this.hass?.themes?.darkMode ??
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ??
      false;
    const showColorsBorder =
      colorsBorderMode === "always" || (colorsBorderMode === "auto" && isDark);
    const colorsBorderClass = showColorsBorder
      ? " palette-colors-card-border"
      : "";

    // Side-by-side (default)
    if (mode === "side") {
      const sideW = cfg.side_card_width || 100;
      const clickZoom = cfg.side_click_zoom === "on";
      if (!this._sideZoomedKey) this._sideZoomedKey = null;
      const zoomedKey = this._sideZoomedKey;
      const isZoomMode = clickZoom && zoomedKey;
      const handleZoomClick = (key) => {
        if (!clickZoom) return;
        if (this._sideZoomedKey === key) return;
        // Save scroll position before zooming
        const row = this.shadowRoot?.querySelector(".palette-row");
        if (row) this._sideZoomScrollLeft = row.scrollLeft;
        this._sideZoomedKey = key;
        this.requestUpdate();
      };
      const handleCollapse = () => {
        const savedScroll = this._sideZoomScrollLeft || 0;
        this._sideZoomedKey = null;
        this.requestUpdate();
        // Restore scroll position after CSS transition (0.3s) completes
        this.updateComplete.then(() => {
          setTimeout(() => {
            const row = this.shadowRoot?.querySelector(".palette-row");
            if (row) row.scrollLeft = savedScroll;
          }, 350);
        });
      };
      const paletteCardRadius = (() => {
        const v = cfg.rounded_cards;
        if (v === undefined || v === true || v === "round") return "16px";
        if (v === false || v === "square") return "0px";
        if (v === "rounded") return "4px";
        return typeof v === "number" ? `${v}px` : `${parseInt(v, 10) || 16}px`;
      })();
      return html`<div
        class="palette-row${isZoomMode ? " zoom-mode" : ""}${colorsBorderClass}"
        style="--side-card-width:${sideW}%;--palette-card-radius:${paletteCardRadius}"
      >
        ${cards.map(
          (card) => html`
            <div
              class="palette-group-card${isZoomMode && zoomedKey === card.key
                ? " zoomed"
                : ""}"
              @click="${() => handleZoomClick(card.key)}"
              style="${clickZoom && !isZoomMode ? "cursor:pointer" : ""}"
            >
              ${isZoomMode && zoomedKey === card.key
                ? html`<button
                    class="palette-zoom-collapse-btn"
                    @click="${(e) => {
                      e.stopPropagation();
                      handleCollapse();
                    }}"
                  >
                    ← Show All
                  </button>`
                : ""}
              <div class="palette-card-top-row">
                <div class="palette-group-title">${card.title}</div>
              </div>
              ${cardContent(card)}
            </div>
          `,
        )}
      </div>`;
    }
    // Carousel mode
    if (mode === "carousel") {
      const carouselButtonShape = cfg.palette_carousel_button_shape || "rect";
      if (this._colorCarouselIndex === undefined) this._colorCarouselIndex = 0;
      if (this._colorCarouselSlideDirection === undefined)
        this._colorCarouselSlideDirection = 0;
      const carouselResult = renderCarousel({
        items: cards,
        currentIndex: this._colorCarouselIndex,
        slideDirection: this._colorCarouselSlideDirection,
        buttonShape: carouselButtonShape,
        showAsCard: true,
        wrapNavigation: cfg.palette_carousel_wrap_navigation === true,
        roundedCards: cfg.rounded_cards,
        onNavigate: (direction, maxLength) => {
          this._navigateColorCarousel(direction, maxLength);
        },
        onSetIndex: (index) => {
          this._setColorCarouselIndex(index);
        },
        renderItem: (card) => {
          return html`
            <div class="palette-card-top-row">
              <div class="palette-group-title">${card.title}</div>
            </div>
            ${cardContent(card)}
          `;
        },
      });
      return html`<div
        class="palette-colors-carousel-wrapper${colorsBorderClass}"
      >
        ${carouselResult}
      </div>`;
    }
    // Tabs (segmented control)
    if (mode === "tabs") {
      if (!this._activePaletteTab && cards.length) {
        this._activePaletteTab = cards[0].key;
      }
      const activeTab = this._activePaletteTab;
      const activeCard = cards.find((c) => c.key === activeTab);
      const activeIdx = cards.findIndex((c) => c.key === activeTab);
      return html`
        <div class="palette-tabs${colorsBorderClass}">
          <div
            class="palette-tab-bar"
            style="--tab-count:${cards.length};--tab-active-index:${activeIdx}"
          >
            <div class="palette-tab-indicator"></div>
            ${cards.map(
              (card) => html`
                <button
                  class="palette-tab-btn${activeTab === card.key
                    ? " active"
                    : ""}"
                  title="${card.title}"
                  @click="${() => {
                    this._activePaletteTab = card.key;
                    this.requestUpdate();
                  }}"
                >
                  ${card.title}
                </button>
              `,
            )}
          </div>
          ${activeCard
            ? html`
                <div class="palette-tab-content">
                  ${cardContent(activeCard)}
                </div>
              `
            : ""}
        </div>
      `;
    }
    // Dropdown
    if (mode === "dropdown") {
      const activeDrop = this._activePaletteDropdown || cards[0]?.key;
      const activeCard = cards.find((c) => c.key === activeDrop);
      return html`
        <div class="palette-dropdown-wrapper${colorsBorderClass}">
          <select
            class="palette-dropdown-select"
            @change="${(e) => {
              this._activePaletteDropdown = e.target.value;
              this.requestUpdate();
            }}"
          >
            ${cards.map(
              (card) =>
                html`<option
                  value="${card.key}"
                  ?selected="${activeDrop === card.key}"
                >
                  ${card.title}
                </option>`,
            )}
          </select>
          ${activeCard
            ? html`
                <div class="palette-dropdown-content">
                  ${cardContent(activeCard)}
                </div>
              `
            : ""}
        </div>
      `;
    }
    // Preview-hover mode
    if (mode === "preview-hover") {
      if (!this._previewStates) this._previewStates = {};
      if (!cards.length) {
        return html`<div class="palette-empty-hint">
          No palette colors available
        </div>`;
      }
      const displayMode = cfg.palette_display_mode || "row";
      const expandedKey = Object.keys(this._previewStates).find(
        (k) => this._previewStates[k],
      );
      const expandedMode = !!expandedKey;
      const nCards = cards.length;
      return html`<div
        class="palette-preview-hover${expandedMode
          ? " expanded-mode"
          : ""}${colorsBorderClass}"
        data-display-mode="${displayMode}"
        style="--n-cards:${nCards};"
      >
        ${cards.map((card, idx) => {
          const hasPalette = card.palette.length > 0;
          const isExpanded = !!this._previewStates[card.key];
          // Per-card timer map prevents one shared timer from racing across cards
          if (!this._previewCollapseTimers)
            this._previewCollapseTimers = new Map();

          const handleExpand = (e) => {
            // If this card was mid-collapse when the mouse re-entered, remove it
            // from the collapsing guard so applyHeights() can set its max-height
            // for re-expansion instead of waiting for .expanded to be removed.
            const cardEl4 = e?.currentTarget;
            if (cardEl4 && this._collapsingCards) {
              this._collapsingCards.delete(cardEl4);
            }
            // Cancel pending collapse for THIS card
            if (this._previewCollapseTimers.has(card.key)) {
              clearTimeout(this._previewCollapseTimers.get(card.key));
              this._previewCollapseTimers.delete(card.key);
            }
            // Legacy single-timer cleanup
            if (this._previewCollapseTimer) {
              clearTimeout(this._previewCollapseTimer);
              this._previewCollapseTimer = null;
            }
            // Immediately collapse all OTHER cards so only one is ever expanded.
            // This prevents dangling _previewStates[k]=true when moving quickly
            // between cards (which caused both cards to appear expanded at once).
            Object.keys(this._previewStates).forEach((k) => {
              if (k !== card.key && this._previewStates[k]) {
                if (this._previewCollapseTimers.has(k)) {
                  clearTimeout(this._previewCollapseTimers.get(k));
                  this._previewCollapseTimers.delete(k);
                }
                this._previewStates[k] = false;
              }
            });
            // Issue #5 — touch toggle: on mobile a touchstart opens the card.
            // Track whether this specific touchstart is the opener so that the
            // matching touchend can be ignored (card stays open until tap elsewhere).
            const wasExpanded = !!this._previewStates[card.key];
            if (e?.type === "touchstart" && !wasExpanded) {
              this._touchJustExpanded = card.key;
            }
            this._previewStates[card.key] = true;
            this.requestUpdate();
          };
          const handleCollapse = (e) => {
            // Touch guard: ignore the touchend that immediately follows the
            // touchstart that opened this card.
            if (
              e?.type === "touchend" &&
              this._touchJustExpanded === card.key
            ) {
              this._touchJustExpanded = null;
              return;
            }
            if (e?.type === "touchend") this._touchJustExpanded = null;

            const key = card.key;
            if (this._previewCollapseTimers.has(key)) {
              clearTimeout(this._previewCollapseTimers.get(key));
              this._previewCollapseTimers.delete(key);
            }

            if (!isExpanded) return;

            const cardEl = e?.currentTarget;
            if (!cardEl) {
              this._previewStates[key] = false;
              this.requestUpdate();
              return;
            }

            // Compute the collapse target directly from this card's body so
            // we never depend on the possibly-stale/zero _previewUniformPx cache
            // (which is skipped for the collapsing card during applyHeights).
            const body = cardEl.querySelector(".palette-preview-body");
            const fullH = cardEl.scrollHeight;
            const targetH = body
              ? Math.ceil(body.scrollHeight / nCards) + 1
              : 0;
            const targetPx = targetH > 0 ? targetH + "px" : "0px";

            // Pin start value. Make background transparent so the white gap
            // between the mini-body and the card bottom is invisible during
            // the height animation (inline style survives Lit re-renders).
            cardEl.style.maxHeight = fullH + "px";
            cardEl.style.background = "transparent";
            cardEl.style.boxShadow = "none";
            if (this._collapsingCards) this._collapsingCards.add(cardEl);

            // Remove .expanded immediately so Lit re-renders and other cards
            // start recovering in parallel.
            this._previewStates[key] = false;
            this.requestUpdate();

            // Force a synchronous reflow to commit the pinned fullH value,
            // then set the target in the same call-stack execution so the CSS
            // transition fires immediately — no rAF gap, no extra white frame.
            void cardEl.getBoundingClientRect();
            cardEl.style.maxHeight = targetPx;

            // Clean up after the transition completes.
            const onTransitionEnd = (ev) => {
              if (ev.propertyName !== "max-height") return;
              cardEl.removeEventListener("transitionend", onTransitionEnd);
              clearTimeout(this._previewCollapseTimers.get(key));
              this._previewCollapseTimers.delete(key);
              if (this._collapsingCards) this._collapsingCards.delete(cardEl);
              cardEl.style.removeProperty("background");
              cardEl.style.removeProperty("box-shadow");
              if (this._previewScheduleApply) this._previewScheduleApply();
            };
            cardEl.addEventListener("transitionend", onTransitionEnd);

            const fallbackTimer = setTimeout(() => {
              cardEl.removeEventListener("transitionend", onTransitionEnd);
              this._previewCollapseTimers.delete(key);
              if (this._collapsingCards) this._collapsingCards.delete(cardEl);
              cardEl.style.removeProperty("background");
              cardEl.style.removeProperty("box-shadow");
            }, 500);
            this._previewCollapseTimers.set(key, fallbackTimer);
          };
          const content = hasPalette ? card.content : null;
          return html`
            <div
              class="palette-preview-card${isExpanded
                ? " expanded"
                : ""}${!hasPalette ? " empty" : ""}"
              @mouseenter="${handleExpand}"
              @mouseleave="${handleCollapse}"
              @touchstart="${handleExpand}"
              @touchend="${handleCollapse}"
            >
              <div class="palette-preview-card-title">${card.title}</div>
              ${hasPalette
                ? html`<div class="palette-preview-body">${content}</div>`
                : html`<div class="palette-mini-empty">
                    ${isExpanded
                      ? html`<span class="mini-empty-hint">Empty</span>`
                      : ""}
                  </div>`}
            </div>
          `;
        })}
      </div>`;
    }
    // Fallback: side-by-side
    const fallbackSideW = cfg.side_card_width || 100;
    return html`<div
      class="palette-row${colorsBorderClass}"
      style="--side-card-width:${fallbackSideW}%"
    >
      ${cards.map(
        (card) => html`
          <div class="palette-group-card">
            <div class="palette-group-title">${card.title}</div>
            ${cardContent(card)}
          </div>
        `,
      )}
    </div>`;
  }
  static properties = {
    matrix: { type: Array },
    selectedColor: { type: String },
    isDrawing: { type: Boolean },
    hass: { type: Object },
    entity: { type: String },
    pixelArtVersion: { type: Number },
  };

  static styles = drawCardStyles;

  constructor() {
    super();
    this._onConfigChanged = this._onConfigChanged.bind(this);
    this._onToolsReordered = this._onToolsReordered.bind(this);
    this._onActionOrderReset = this._onActionOrderReset.bind(this);
    this._onActionVisibilityReset = this._onActionVisibilityReset.bind(this);
    this.matrix = StorageUtils.loadMatrix();
    this._matrixHistory = [];
    this._renderScheduled = false;

    // Initialize managers
    this.toolManager = new ToolManager(this);
    this.actionManager = new ActionManager(this);
    this.matrixOperations = new MatrixOperations1D(this);

    // Pagination state
    this._currentPage = 0;
    this._loadedItems = 0;
    this._totalPages = 0;

    this.selectedColor = "#ff0000";
    this.isDrawing = false;
    this.hass = null;
    this.entity = "";
    this.palette = [
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffff00",
      "#00ffff",
      "#ff00ff",
      "#ffffff",
      "#000000",
      "#ffa500",
      "#00ff99",
      "#9999ff",
      "#ff99cc",
    ];
    this.pencilMode = true;
    this.recentColors = StorageUtils.loadRecentColors();
    this.lampPalette = [];
    this.eraserMode = false;
    this.areaFillMode = false;
    this.fillAllMode = false;
    this.previewFillArea = new Set();
    this.lastHoveredIdx = null;
    this.colorPickerMode = false;
    this.pixelArtVersion = 0;
    this._lastPixelArtState = null;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("config-changed", this._onConfigChanged);
    window.addEventListener("yeelight-tools-reordered", this._onToolsReordered);

    // Add action reset event listeners
    window.addEventListener(EVT_ACTION_ORDER_RESET, this._onActionOrderReset);
    window.addEventListener(
      EVT_ACTION_VISIBILITY_RESET,
      this._onActionVisibilityReset,
    );
  }

  set hass(hass) {
    const oldHass = this._hass;

    // Auto-resolve sensors on first hass set (setConfig may run before hass is available)
    if (this.config && hass) {
      if (!this.config.pixelart_sensor) {
        const autoSensor = Object.keys(hass.states || {}).find(
          (e) => e.startsWith("sensor.") && e.includes("pixel_art"),
        );
        if (autoSensor) {
          this.config = { ...this.config, pixelart_sensor: autoSensor };
        }
      }
      if (!this.config.palette_sensor) {
        const autoSensor = Object.keys(hass.states || {}).find(
          (e) => e.startsWith("sensor.") && e.includes("color_palettes"),
        );
        if (autoSensor) {
          this.config = { ...this.config, palette_sensor: autoSensor };
          this.paletteSensor = autoSensor;
        }
      }
    }

    const pixelartSensor = this.config?.pixelart_sensor;
    if (!pixelartSensor || !hass) {
      this._hass = hass;
      return;
    }

    // Check if we have an optimistically updated state that websocket might overwrite
    const incomingStateObj = hass.states[pixelartSensor];
    const currentStateObj = oldHass?.states?.[pixelartSensor];
    const incomingPixelArts = incomingStateObj?.attributes?.pixel_arts || [];
    const currentPixelArts = currentStateObj?.attributes?.pixel_arts || [];

    // If we have pending operations, check if incoming data would overwrite our optimistic state
    if (this._pendingReorderedPixelArts) {
      const pendingCount = this._pendingReorderedPixelArts.length;

      // Check if incoming websocket matches our pending state
      if (incomingPixelArts.length === pendingCount) {
        const namesMatch = this._pendingReorderedPixelArts.every(
          (art, idx) => incomingPixelArts[idx]?.name === art.name,
        );

        if (namesMatch) {
          this._pendingReorderedPixelArts = null;
          this._hass = hass; // Accept the websocket update
        } else {
          return; // Reject the stale websocket update
        }
      } else if (incomingPixelArts.length > pendingCount) {
        // Incoming has MORE items than our optimistic state - websocket is stale (pre-delete)
        return; // Reject the stale websocket update
      } else {
        // Incoming has FEWER items - might be a newer delete
        this._pendingReorderedPixelArts = null;
        this._hass = hass;
      }
    } else {
      // No pending operations - accept websocket update normally
      this._hass = hass;
    }

    // Check if pixel art sensor changed using COUNT or content_hash
    // (count alone won't detect renames since the list size stays the same)
    const stateObj = this._hass.states[pixelartSensor];
    if (!stateObj) return; // Sensor entity not (yet) available
    const prevCount = this._lastPixelArtCount;
    const currCount = stateObj?.attributes?.count;
    const prevHash = this._lastPixelArtHash;
    const currHash = stateObj?.attributes?.content_hash;

    if (prevCount !== currCount || prevHash !== currHash) {
      this._lastPixelArtCount = currCount;
      this._lastPixelArtHash = currHash;

      // HA websocket does NOT resend large attribute arrays (pixel_arts) on updates —
      // only scalars like count/content_hash arrive. Fetch fresh data via REST API
      // so the gallery always shows up-to-date names even for renames from outside the card.
      this._fetchFreshPixelArts(pixelartSensor);

      if (!this._renderScheduled) {
        this._renderScheduled = true;
        requestAnimationFrame(() => {
          this._renderScheduled = false;
          // Force complete re-render
          this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
          // Force LitElement to re-render AND trigger updated() callback
          this.requestUpdate("hass", oldHass);
        });
      }
    }

    // Check if light entity state changed (for Lamp Colors palette)
    if (this.entity) {
      const lightState = this._hass.states[this.entity];
      if (lightState) {
        const newEpoch = lightState.attributes?._update_epoch;
        if (newEpoch !== this._lastLampEpoch) {
          this._lastLampEpoch = newEpoch;
          if (!this._renderScheduled) {
            this._renderScheduled = true;
            requestAnimationFrame(() => {
              this._renderScheduled = false;
              this.requestUpdate("hass", oldHass);
            });
          }
        }
      }
    }
  }

  get hass() {
    return this._hass;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("config-changed", this._onConfigChanged);
    window.removeEventListener(
      "yeelight-tools-reordered",
      this._onToolsReordered,
    );

    // Remove action reset event listeners
    window.removeEventListener(
      EVT_ACTION_ORDER_RESET,
      this._onActionOrderReset,
    );
    window.removeEventListener(
      EVT_ACTION_VISIBILITY_RESET,
      this._onActionVisibilityReset,
    );

    // Remove document-level listeners added in connectedCallback / firstUpdated
    document.removeEventListener("mousedown", this._handleTabsOutsideClick);
    document.removeEventListener("mousedown", this._handleFloatingOutsideClick);

    // Clean up drag utility
    if (this._toolDragUtil) {
      this._toolDragUtil.destroy();
      this._toolDragUtil = null;
    }

    // Clear pending timers
    if (this._applyPixelArtTimer) {
      clearTimeout(this._applyPixelArtTimer);
      this._applyPixelArtTimer = null;
    }
    if (this._previewCollapseTimer) {
      clearTimeout(this._previewCollapseTimer);
      this._previewCollapseTimer = null;
    }
    // Clear all per-card collapse timers (issue #3 fix)
    if (this._previewCollapseTimers) {
      this._previewCollapseTimers.forEach((id) => clearTimeout(id));
      this._previewCollapseTimers.clear();
    }
  }

  _onConfigChanged(e) {
    if (!e.detail || !e.detail.config) return;
    // Only accept config-changed events meant for this card type
    const cfg = e.detail.config;
    if (cfg.type && cfg.type !== "custom:yeelight-cube-draw-card") return;
    this.setConfig(cfg);
    this.requestUpdate();
  }

  _onToolsReordered(e) {
    if (!e.detail || !e.detail.config) return;
    this.setConfig(e.detail.config);
    this.requestUpdate();

    // Force a complete re-render to ensure tools are reordered
    this.matrix = this.matrix || this.getBlankMatrix();
    this.requestUpdate();
  }

  _onActionOrderReset() {
    this.actionManager?.loadActionOrder();
    this.requestUpdate();
  }

  _onActionVisibilityReset() {
    this.actionManager?.loadActionVisibility();
    this.requestUpdate();
  }

  _fireConfigChanged() {
    // Fire event to update the config in the editor
    window.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this.config },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _updateConfig(updates) {
    try {
      // Create a mutable copy of the config
      const newConfig = { ...this.config };

      // Apply updates
      Object.assign(newConfig, updates);

      // Update the config
      this.config = newConfig;

      // Fire config changed event
      this._fireConfigChanged(newConfig);

      // Request update to re-render
      this.requestUpdate();
    } catch (error) {
      console.warn("Failed to update config:", error);
    }
  }

  _matrixColorCount() {
    // Count pixels that are not null and not black
    return this.matrix.filter((c) => c && c.toLowerCase() !== "#000000").length;
  }

  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-draw-card-editor")) {
      await import("./yeelight-cube-draw-card-editor.js");
    }
    return document.createElement("yeelight-cube-draw-card-editor");
  }

  setConfig(config) {
    // Create a mutable copy of the config to allow adding new properties
    this.config = { ...config };

    // Auto-resolve pixelart_sensor if not explicitly configured
    if (!this.config.pixelart_sensor && this._hass) {
      const autoSensor = Object.keys(this._hass.states || {}).find(
        (e) => e.startsWith("sensor.") && e.includes("pixel_art"),
      );
      if (autoSensor) {
        this.config.pixelart_sensor = autoSensor;
      }
    }

    // Auto-resolve palette_sensor if not explicitly configured
    if (!this.config.palette_sensor && this._hass) {
      const autoSensor = Object.keys(this._hass.states || {}).find(
        (e) => e.startsWith("sensor.") && e.includes("color_palettes"),
      );
      if (autoSensor) {
        this.config.palette_sensor = autoSensor;
      }
    }

    // Ensure tools_order exists with default value
    if (!this.config.tools_order) {
      this.config.tools_order = [
        "colorPicker",
        "eyedropper",
        "pencil",
        "eraser",
        "areaFill",
        "fillAll",
        "undo",
      ];
    }

    // Defensive: Ensure both colorPicker and eyedropper are present if either is configured
    // Create a new array to avoid modifying non-extensible arrays
    const toolsArray = [...this.config.tools_order];
    const hasColorPicker = toolsArray.includes("colorPicker");
    const hasEyedropper = toolsArray.includes("eyedropper");
    let configChanged = false;

    if (hasColorPicker && !hasEyedropper) {
      // If colorPicker exists but eyedropper doesn't, add eyedropper after colorPicker
      const colorPickerIndex = toolsArray.indexOf("colorPicker");
      toolsArray.splice(colorPickerIndex + 1, 0, "eyedropper");
      this.config.tools_order = toolsArray;
      configChanged = true;
    } else if (hasEyedropper && !hasColorPicker) {
      // If eyedropper exists but colorPicker doesn't, add colorPicker before eyedropper
      const eyedropperIndex = toolsArray.indexOf("eyedropper");
      toolsArray.splice(eyedropperIndex, 0, "colorPicker");
      this.config.tools_order = toolsArray;
      configChanged = true;
    }

    // If we made changes to the config, fire the config-changed event to save to YAML
    if (configChanged) {
      // Use the _updateConfig method to properly save configuration changes
      this._updateConfig({ tools_order: this.config.tools_order });
    }

    // Ensure actions_order exists with default value (check multiple possible locations)
    const actionsConfig =
      this.config.actions_order ||
      this.config.actions ||
      (this.config.button_areas && this.config.button_areas.actions);

    if (
      !actionsConfig ||
      !Array.isArray(actionsConfig) ||
      actionsConfig.length === 0
    ) {
      this.config.actions_order = ["clear", "upload", "save", "apply"];
    } else {
      // Normalize to use actions_order property
      this.config.actions_order = actionsConfig;
    }

    const parsed = parseConfig(this.config);
    this.entity = parsed.entity;
    this.paletteSensor = parsed.paletteSensor;

    // Do NOT reset this.matrix here!
  }

  // Helper method to call services on target entities (multi-entity support)
  // Call a service sequentially on every configured target entity.
  // Delegates to the shared utility.  The Python backend holds per-IP locks,
  // so different lamps execute in parallel.
  async callServiceOnTargetEntities(service, data = {}) {
    return callServiceSequentially(this.hass, this.config, service, data, {
      callerTag: "Draw Card",
    });
  }

  // Helper method for global services (pixel art operations) - only called ONCE regardless of number of target entities
  async callGlobalService(service, data = {}) {
    // Pixel art services are truly global and don't require entity_id
    // Including an invalid entity_id causes "unknown.unknown" errors
    try {
      await this.hass.callService("yeelight_cube", service, data);
    } catch (error) {
      console.error(`Error calling service ${service}:`, error);
      throw error;
    }
  }

  _pushMatrixHistory() {
    this.matrixOperations.pushMatrixHistory();
  }

  _undoMatrix() {
    this.matrixOperations.undoMatrix();
  }

  // Section rendering methods for layout customization
  _renderColorsSection(
    cfg,
    showRecentColors,
    showLampPalette,
    showLampColors,
    showImagePalette,
  ) {
    return html`
      <div
        class="palettes"
        style="width: 100%;
        display: flex; 
        flex-wrap: wrap;
        width: 100%;
        justify-content: space-between;"
      >
        ${this._renderPaletteCards(
          cfg,
          showRecentColors,
          showLampPalette,
          showLampColors,
          showImagePalette,
        )}
      </div>
    `;
  }

  _renderToolsSection(cfg, paintShape, paintContent) {
    return this.toolManager.renderToolsSection(cfg, paintShape, paintContent);
  }

  _getToolSelection(tool) {
    return this.toolManager.getToolSelection(tool);
  }

  _getToolTitle(tool) {
    return this.toolManager.getToolTitle(tool);
  }

  _getDefaultToolsOrder() {
    return this.toolManager.getDefaultToolsOrder();
  }

  _handleToolClick(tool) {
    this.toolManager.handleToolClick(tool);
  }

  // ULTRA-SIMPLE inline drag implementation
  _startToolDrag(e, tool, index) {
    this.toolManager.startToolDrag(e, tool, index);
  }

  _createDragVisuals() {
    // Delegated to ToolManager
  }

  _updateDragPosition(e) {
    // Delegated to ToolManager
  }

  _finishDrag() {
    // Delegated to ToolManager
  }

  _cleanupDrag() {
    // Delegated to ToolManager
  }

  _renderMatrixSection(
    cfg,
    pixelGap,
    matrixBg,
    matrixShadowStyle,
    matrixWidth,
    matrixPixelStyle,
  ) {
    // Resolve pixel box shadow locally (spacing mode tri-state)
    const spacingMode =
      cfg.pixel_spacing_mode ||
      (cfg.pixel_spacing === false ? "none" : "normal");
    const pixelBoxShadow = spacingMode === "subtle" || spacingMode === "normal";

    return html`
      <div
        class="matrix"
        style="display:grid;grid-template-columns:repeat(${GRID_COLS},1fr);gap:${pixelGap}px;background:${matrixBg};padding:8px;border-radius:6px;${matrixShadowStyle}width:${matrixWidth};margin:0 auto;"
        @mousedown=${(e) => startDraw(this, e)}
        @mouseup=${(e) => endDraw(this, e)}
        @mouseleave=${() => onMatrixMouseLeave(this)}
        @mousemove=${(e) => drawMove(this, e)}
        @touchstart=${(e) => startDraw(this, e)}
        @touchend=${(e) => endDraw(this, e)}
        @touchcancel=${(e) => endDraw(this, e)}
        @touchmove=${(e) => drawMove(this, e)}
      >
        ${this.matrix.map((color, idx) => {
          let previewStyle = "";
          const shadowParts = [];
          if (pixelBoxShadow) shadowParts.push("0 0 2px #0008");
          if (this.areaFillMode && this.previewFillArea.has(idx)) {
            shadowParts.push(`0 0 0 3px ${this.selectedColor}`);
            previewStyle += ` border: 2px solid ${this.selectedColor};`;
          }
          if (shadowParts.length) {
            previewStyle =
              `box-shadow: ${shadowParts.join(", ")};` + previewStyle;
          }
          return renderMatrixPixel(
            idx,
            color,
            matrixPixelStyle,
            previewStyle,
            {
              onMouseDown: (e) => drawPixel(this, e, idx),
              onContextMenu: (e) => erasePixel(this, e, idx),
              onClick: () => onMatrixClick(this, idx),
              onMouseOver: () => onMatrixMouseOver(this, idx),
              onMouseLeave: () => onMatrixMouseLeave(this),
            },
            cfg.matrix_ignore_black_pixels,
          );
        })}
      </div>
    `;
  }

  _renderActionsSection() {
    return html` <div class="actions">${this._renderActions()}</div> `;
  }

  _renderPixelArtSection(showPixelArtGallery) {
    if (!showPixelArtGallery) return "";

    const cfg = this.config || {};
    const showExportBtn = cfg.show_pixelart_export_button !== false;
    const showImportBtn = cfg.show_pixelart_import_button !== false;

    // Reference pixelArtVersion to ensure LitElement tracks it
    const _ = this.pixelArtVersion;

    const galleryContent = this._renderPixelArtGallery();

    // Add export/import buttons if enabled
    if (showExportBtn || showImportBtn) {
      return html`
        ${galleryContent}
        ${this._renderPixelArtExportImportButtons(showExportBtn, showImportBtn)}
      `;
    }

    return galleryContent;
  }

  _renderPixelArtExportImportButtons(showExportBtn, showImportBtn) {
    const cfg = this.config || {};
    const buttonStyle = cfg.pixelart_buttons_style || "modern";

    // Use icon mode for icon style, otherwise respect config (default icon_text)
    const contentMode =
      buttonStyle === "icon"
        ? "icon"
        : cfg.pixelart_content_mode || "icon_text";

    // Get button classes using centralized utility
    const exportBtnClass = getExportImportButtonClass("export", buttonStyle);
    const importBtnClass = getExportImportButtonClass("import", buttonStyle);

    // Check import status
    const isImportStatus = this._importStatus?.showing === true;
    const statusType = isImportStatus ? this._importStatus.type : null;

    return html`
      <div
        class="action-row${contentMode === "icon" || buttonStyle === "icon"
          ? " icon-mode"
          : ""}"
      >
        ${showExportBtn
          ? html`
              <button
                class="${exportBtnClass}"
                @click="${() => this._exportPixelArts()}"
                title="Export all pixel arts as JSON file"
              >
                ${unsafeHTML(
                  renderExportImportButtonContent(
                    "mdi:download",
                    "Export",
                    contentMode,
                  ),
                )}
              </button>
            `
          : ""}
        ${showImportBtn
          ? html`
              <button
                class="${importBtnClass}"
                @click="${() => this._triggerImportFile()}"
                title="Import pixel arts from JSON file"
              >
                ${isImportStatus
                  ? unsafeHTML(
                      renderExportImportButtonContent(
                        "mdi:upload",
                        "Import",
                        contentMode,
                        true,
                        statusType,
                      ),
                    )
                  : unsafeHTML(
                      renderExportImportButtonContent(
                        "mdi:upload",
                        "Import",
                        contentMode,
                      ),
                    )}
              </button>
            `
          : ""}
      </div>
    `;
  }

  render() {
    const cfg = this.config || {};
    // Resolve pixel spacing mode (new tri-state) with backward compat for old booleans
    const spacingMode =
      cfg.pixel_spacing_mode ||
      (cfg.pixel_spacing === false ? "none" : "normal");
    const pixelGap = spacingMode === "normal" ? 3 : 0;
    const pixelBoxShadow = spacingMode === "subtle" || spacingMode === "normal";
    let matrixBg = cfg.matrix_bg || "black";
    if (matrixBg === "transparent") matrixBg = "transparent";
    const matrixBoxShadow = cfg.matrix_box_shadow !== false;
    const matrixShadowStyle = matrixBoxShadow
      ? "box-shadow: 0 2px 8px #0008;"
      : "";
    let matrixWidth = "100%";
    if (typeof cfg.matrix_size === "number") {
      matrixWidth = `${cfg.matrix_size}%`;
    } else if (
      typeof cfg.matrix_size === "string" &&
      !isNaN(Number(cfg.matrix_size))
    ) {
      matrixWidth = `${Number(cfg.matrix_size)}%`;
    } else if (cfg.matrix_size === "small") {
      matrixWidth = "70%";
    } else if (cfg.matrix_size === "medium") {
      matrixWidth = "85%";
    }
    const cardTitle = typeof cfg.title === "string" ? cfg.title : "";
    const showColorPicker = cfg.show_color_picker !== false;
    const showRecentColors = cfg.show_recent_colors !== false;
    const showLampPalette = cfg.show_lamp_palette !== false;
    const showLampColors = cfg.show_lamp_colors !== false;
    const showImagePalette = cfg.show_image_palette !== false;
    const showEraserTool = cfg.show_eraser_tool !== false;
    const showFillTool = cfg.show_fill_tool !== false;
    const showCard = cfg.show_card_background !== false;
    const showSend = cfg.show_send_button !== false;
    const showClear = cfg.show_clear_button !== false;
    const showSave = cfg.show_save_button !== false;
    const showUpload = cfg.show_upload_image_button !== false;
    const showPixelArtGallery = cfg.show_pixelart_gallery !== false;
    const matrixPixelStyle = cfg.matrix_pixel_style || "square";
    const paintShape = cfg.button_shape || "rect";
    const paintContent = cfg.paint_button_content || "icon";

    // Check section visibility
    const showColors = cfg.show_colors_section !== false;
    const showTools = cfg.show_tools_section !== false;
    const showMatrix = cfg.show_matrix_section !== false;
    const showActions = cfg.show_actions_section !== false;
    const showPixelArtSection = cfg.show_pixelart_section !== false;

    const content = html`
      <div style="padding:18px 12px;margin:0 auto;">
        ${!showCard && cardTitle
          ? html`<div
              style="font-weight:600;font-size:1.1em;margin-bottom:8px;"
            >
              ${cardTitle}
            </div>`
          : ""}
        <div class="draw-container">
          ${showColors
            ? this._renderColorsSection(
                cfg,
                showRecentColors,
                showLampPalette,
                showLampColors,
                showImagePalette,
              )
            : ""}
          ${showTools
            ? this._renderToolsSection(cfg, paintShape, paintContent)
            : ""}
          ${showMatrix
            ? this._renderMatrixSection(
                cfg,
                pixelGap,
                matrixBg,
                matrixShadowStyle,
                matrixWidth,
                matrixPixelStyle,
              )
            : ""}
          ${showActions ? this._renderActionsSection() : ""}
          ${showPixelArtSection
            ? this._renderPixelArtSection(showPixelArtGallery)
            : ""}
        </div>
      </div>
    `;
    return showCard
      ? cardTitle
        ? html`<ha-card header="${cardTitle}">${content}</ha-card>`
        : html`<ha-card>${content}</ha-card>`
      : content;
  }

  _selectTool(tool) {
    this.toolManager.selectTool(tool);
  }

  _onColorPicker(e) {
    this.selectedColor = normalizeHex(e.target.value);
    this.requestUpdate();
  }

  _selectRecentColor(color) {
    if (this.colorPickerMode) {
      this.selectedColor = color;
      this.requestUpdate();
      return;
    }
    this.selectedColor = color;
    this.requestUpdate();
  }

  _selectLampColor(color) {
    if (this.colorPickerMode) {
      this.selectedColor = color;
      this.requestUpdate();
      return;
    }
    this.selectedColor = color;
    this.requestUpdate();
  }

  _selectImageColor(color) {
    if (this.colorPickerMode) {
      this.selectedColor = color;
      this.requestUpdate();
      return;
    }
    this.selectedColor = color;
    this.requestUpdate();
  }

  getLampGradientColors() {
    if (!this.hass || !this.entity) return [];
    const stateObj = this.hass.states[this.entity];
    if (!stateObj || !Array.isArray(stateObj.attributes.text_colors)) return [];
    // Convert [[r,g,b], ...] to hex strings
    return stateObj.attributes.text_colors.map((rgb) => {
      if (!Array.isArray(rgb) || rgb.length !== 3) return "#ffffff";
      return "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
    });
  }

  /**
   * Extract diverse colors from the lamp's actual displayed matrix.
   * Uses K-means clustering for color diversity. Reads matrix_colors from the light entity.
   */
  _getLampMatrixColors() {
    if (!this.hass || !this.entity) return { palette: [], weights: null };
    const stateObj = this.hass.states[this.entity];
    if (!stateObj || !Array.isArray(stateObj.attributes.matrix_colors))
      return { palette: [], weights: null };
    return extractDiversePaletteWithWeights(
      stateObj.attributes.matrix_colors,
      MAX_IMAGE_PALETTE_COLORS,
    );
  }

  /**
   * Extract diverse colors from the current draw matrix.
   * Uses K-means clustering for color diversity. This is the "Drawing Colors" palette.
   */
  _getCurrentColors() {
    if (!this.matrix || !Array.isArray(this.matrix))
      return { palette: [], weights: null };
    // Issue #11/#14 — Memoize by matrix reference identity.
    // Lit assigns a new array to this.matrix on every pixel draw, so a new
    // reference = genuine change → cache miss.  During hover animation re-renders
    // the matrix object identity is unchanged → cache hit, skipping K-means.
    // This also fixes the #14 edge case where swapping one color for another at
    // equal non-black count produced a stale palette (count-based cache miss).
    if (
      this._currentColorsCacheRef === this.matrix &&
      this._currentColorsCache
    ) {
      return this._currentColorsCache;
    }
    // Convert hex strings to RGB tuples for the shared palette extractor
    const rgbPixels = [];
    for (const hex of this.matrix) {
      if (!hex || hex === "#000000") continue;
      const h = hex.replace("#", "");
      rgbPixels.push([
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
      ]);
    }
    const result = extractDiversePaletteWithWeights(
      rgbPixels,
      MAX_IMAGE_PALETTE_COLORS,
    );
    this._currentColorsCacheRef = this.matrix;
    this._currentColorsCache = result;
    return result;
  }

  _savePalette(colors, name = "Custom Palette") {
    savePalette(this.hass, this.paletteSensor, colors);
  }

  _saveRecentPalette() {
    this._savePalette(this.recentColors, "Recent Colors");
  }

  _saveImagePalette() {
    this._savePalette(this._getCurrentColors().palette, "Drawing Colors");
  }

  _saveLampColorsPalette() {
    this._savePalette(this._getLampMatrixColors().palette, "Lamp Colors");
  }

  _toggleEraser() {
    this.eraserMode = !this.eraserMode;
    this.pencilMode = false;
    this.areaFillMode = false;
    this.fillAllMode = false;
    this.previewFillArea = new Set();
    this.requestUpdate();
  }

  _erasePixel(e, idx) {
    this.matrixOperations.erasePixel(e, idx);
  }

  _fillAll() {
    this.matrixOperations.fillAll();
  }

  _toggleFillAll() {
    this.matrixOperations.toggleFillAll();
  }

  _onMatrixMouseOver(idx) {
    this.matrixOperations.onMatrixMouseOver(idx);
  }

  _onMatrixMouseLeave() {
    this.matrixOperations.onMatrixMouseLeave();
  }

  _onMatrixClick(idx) {
    this.matrixOperations.onMatrixClick(idx);
  }

  _clearMatrix() {
    this.matrixOperations.clearMatrix();
  }

  _setPixel(idx) {
    this.matrixOperations.setPixel(idx);
  }

  async _savePixelArt() {
    if (!this.hass) return;
    // Convert matrix to array of { position, color } with correct row order
    const pixels = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const srcIdx = row * GRID_COLS + col;
        const destIdx = (GRID_ROWS - 1 - row) * GRID_COLS + col; // flip vertically
        const c = this.matrix[srcIdx];
        let rgb = [0, 0, 0];
        if (c) {
          const hex = c.replace(/^#/, "");
          rgb = [
            parseInt(hex.substring(0, 2), 16),
            parseInt(hex.substring(2, 4), 16),
            parseInt(hex.substring(4, 6), 16),
          ];
        }
        pixels.push({ position: destIdx, color: rgb });
      }
    }
    // Save as pixel art
    await this.callGlobalService("save_pixel_art", {
      pixels,
    });
    // Update pixel art sensor entity
    const pixelartSensor = this.config?.pixelart_sensor;
    if (pixelartSensor) {
      await this.hass.callService("homeassistant", "update_entity", {
        entity_id: pixelartSensor,
      });
    }
    // Fire pixelart-saved event
    window.dispatchEvent(new Event("pixelart-saved"));
  }

  async _sendToLamp() {
    if (!this.hass) return;
    const pixels = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = row * GRID_COLS + col;
        const lampIdx = (GRID_ROWS - 1 - row) * GRID_COLS + col;
        const colorHex = this.matrix[idx];
        let rgb = [0, 0, 0];
        if (colorHex) {
          const hex = colorHex.replace(/^#/, "");
          rgb = [
            parseInt(hex.substring(0, 2), 16),
            parseInt(hex.substring(2, 4), 16),
            parseInt(hex.substring(4, 6), 16),
          ];
        }
        pixels.push({ position: lampIdx, color: rgb });
      }
    }
    const debugPayload = {
      service: "yeelight_cube.apply_custom_pixels",
      data: { entity_id: this.entity, pixels },
    };
    window.__YEELIGHT_DRAW_DEBUG_LAST_PAYLOAD = debugPayload;
    console.error(
      "[YeelightDrawCard] _sendToLamp → apply_custom_pixels payload",
      debugPayload,
    );
    await this.callServiceOnTargetEntities("apply_custom_pixels", {
      pixels,
    });
    // Also call update_entity for lamp entity or palette sensor
    const updateTarget = this.entity || this.paletteSensor;
    if (updateTarget) {
      await this.hass.callService("homeassistant", "update_entity", {
        entity_id: updateTarget,
      });
    }
    // Fire pixelart-saved event for consistency
    window.dispatchEvent(new Event("pixelart-saved"));
  }

  _onImageUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        // Draw image to canvas
        const canvas = document.createElement("canvas");
        canvas.width = 20;
        canvas.height = GRID_ROWS;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, GRID_COLS, GRID_ROWS);
        const imgData = ctx.getImageData(0, 0, GRID_COLS, GRID_ROWS).data;
        // Fill matrix with image pixels (current colors will be derived automatically)
        const matrix = [];
        for (let i = 0; i < MATRIX_SIZE; i++) {
          const r = imgData[i * 4];
          const g = imgData[i * 4 + 1];
          const b = imgData[i * 4 + 2];
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b)
            .toString(16)
            .slice(1)}`;
          matrix.push(hex);
        }
        this.matrix = matrix;
        StorageUtils.saveMatrix(this.matrix);
        this.requestUpdate();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  _renderPixelArtGallery() {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this.hass.states[pixelartSensor]) {
      return html`
        <div class="pixelart-gallery-message">
          Pixel art sensor not found or not configured.
        </div>
      `;
    }

    const stateObj = this.hass.states[pixelartSensor];
    const pixelArts = stateObj.attributes.pixel_arts || [];

    if (pixelArts.length === 0) {
      return html`
        <div class="pixelart-gallery-message">No pixel art saved yet.</div>
      `;
    }

    const currentMode = cfg.pixel_art_gallery_mode || "gallery";
    const borderMode = cfg.item_card_border || "auto";
    const isDark =
      this.hass?.themes?.darkMode ??
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ??
      false;
    const showItemBorder =
      borderMode === "always" || (borderMode === "auto" && isDark);
    const btnCfg = getDeleteButtonConfig(cfg);
    const allowDelete = btnCfg.allowDelete;
    const bgColor = cfg.pixel_art_background_color || "transparent";
    const autoApplyToLamp = cfg.pixel_art_auto_apply_to_lamp === true;
    const showTitles = cfg.pixel_art_show_titles !== false; // Default to true
    const allowRename = cfg.pixel_art_allow_rename === true; // Default to false

    if (!this._galleryCarouselIndex) this._galleryCarouselIndex = 0;

    return html`
      <div class="pixelart-gallery">
        <div
          class="pixelart-gallery-content ${currentMode} pixelart-gallery-plain${showItemBorder
            ? " item-card-border"
            : ""}"
          @click=${this._handleGalleryClick}
          style="--pixelart-bg-color: ${resolveBgColor(bgColor)}"
        >
          ${this._renderPixelArtByMode(
            pixelArts,
            currentMode,
            allowDelete,
            bgColor,
            autoApplyToLamp,
            showTitles,
            allowRename,
            btnCfg,
          )}
        </div>
      </div>
    `;
  }

  /**
   * Get paginated pixel arts based on current settings
   */
  _getPaginatedPixelArts(pixelArts, mode) {
    const cfg = this.config || {};
    const itemsPerPage = parseInt(cfg.pixel_art_items_per_page) || 12;
    const buttonShape = cfg.button_shape || "rect";

    // Carousel and album modes don't need pagination
    if (mode === "carousel" || mode === "album") {
      return { items: pixelArts, pagination: null };
    }

    // Calculate total pages
    this._totalPages = Math.ceil(pixelArts.length / itemsPerPage);

    // Traditional page navigation
    const startIdx = this._currentPage * itemsPerPage;
    const paginatedItems = pixelArts.slice(startIdx, startIdx + itemsPerPage);

    let paginationHTML = "";

    if (this._totalPages > 1) {
      const maxDisplayPages = 5;
      const startPage = Math.max(
        0,
        this._currentPage - Math.floor(maxDisplayPages / 2),
      );
      const endPage = Math.min(this._totalPages, startPage + maxDisplayPages);

      paginationHTML = html`
        <div class="pagination-container pages">
          <button
            class="draw-btn save nav-btn-${buttonShape}${this._currentPage === 0
              ? " disabled"
              : ""}"
            title="Previous page"
            ?disabled=${this._currentPage === 0}
            @click=${this._handlePrevPageClick}
          >
            <ha-icon icon="mdi:chevron-left"></ha-icon>
          </button>

          ${Array.from({ length: endPage - startPage }, (_, i) => {
            const pageNum = startPage + i;
            return html`
              <button
                class="draw-btn save nav-btn-${buttonShape} ${pageNum ===
                this._currentPage
                  ? "active"
                  : ""}"
                title="Page ${pageNum + 1}"
                @click=${this._handlePageButtonClick}
                data-page-num="${pageNum}"
                style=" min-width: 29px;
                        height: 29px;"
              >
                ${pageNum + 1}
              </button>
            `;
          })}

          <button
            class="draw-btn save nav-btn-${buttonShape}${this._currentPage >=
            this._totalPages - 1
              ? " disabled"
              : ""}"
            title="Next page"
            ?disabled=${this._currentPage >= this._totalPages - 1}
            @click=${this._handleNextPageClick}
          >
            <ha-icon icon="mdi:chevron-right"></ha-icon>
          </button>
        </div>
      `;
    }

    return {
      items: paginatedItems,
      pagination: paginationHTML,
    };
  }

  _handlePageButtonClick(e) {
    const pageNum = parseInt(e.currentTarget?.dataset?.pageNum, 10);
    if (!Number.isNaN(pageNum)) {
      this._goToPage(pageNum);
    }
  }

  _handlePrevPageClick() {
    this._goToPage(this._currentPage - 1);
  }

  _handleNextPageClick() {
    this._goToPage(this._currentPage + 1);
  }

  _goToPage(pageIndex) {
    this._currentPage = Math.max(0, Math.min(pageIndex, this._totalPages - 1));
    this.requestUpdate();
  }

  _loadMoreItems(itemsPerPage, totalItems) {
    this._loadedItems = Math.min(this._loadedItems + itemsPerPage, totalItems);
    this.requestUpdate();
  }

  _onPageSliderChange(e, itemsPerPage) {
    this._currentPage = parseInt(e.target.value);
    this.requestUpdate();
  }

  _renderPixelArtByMode(
    pixelArts,
    mode,
    allowDelete,
    bgColor,
    autoApplyToLamp,
    showTitles = true,
    allowRename = false,
    btnCfg = null,
  ) {
    const cfg = this.config || {};
    if (!btnCfg) btnCfg = getDeleteButtonConfig(cfg);
    const pixelStyle = cfg.pixel_art_pixel_style || "square";
    // Resolve pixel art spacing mode (new tri-state) with backward compat for old booleans
    const artSpacingMode =
      cfg.pixel_art_spacing_mode ||
      (cfg.pixel_art_pixel_spacing === false ? "none" : "normal");
    const pixelGap = artSpacingMode === "normal" ? 3 : 0;
    const pixelArtPixelBoxShadow =
      artSpacingMode === "subtle" || artSpacingMode === "normal";

    // Get paginated data
    const { items: paginatedPixelArts, pagination } =
      this._getPaginatedPixelArts(pixelArts, mode);

    // Calculate the global offset for the current page
    const itemsPerPage = parseInt(cfg.pixel_art_items_per_page) || 12;
    const globalOffset =
      mode === "carousel" ? 0 : this._currentPage * itemsPerPage;

    let galleryContent;
    switch (mode) {
      case "album":
        galleryContent = this._renderPixelArtAlbum(
          pixelArts,
          allowDelete,
          bgColor,
          pixelStyle,
          pixelGap,
          autoApplyToLamp,
          showTitles,
          allowRename,
          btnCfg,
        );
        break;
      case "list":
        galleryContent = this._renderPixelArtList(
          paginatedPixelArts,
          globalOffset,
          allowDelete,
          bgColor,
          pixelStyle,
          pixelGap,
          autoApplyToLamp,
          showTitles,
          allowRename,
          btnCfg,
        );
        break;
      case "carousel":
        galleryContent = this._renderPixelArtCarousel(
          pixelArts,
          allowDelete,
          bgColor,
          pixelStyle,
          pixelGap,
          autoApplyToLamp,
          showTitles,
          allowRename,
          btnCfg,
        );
        break;
      case "gallery":
        galleryContent = this._renderPixelArtGalleryMode(
          paginatedPixelArts,
          globalOffset,
          allowDelete,
          bgColor,
          pixelStyle,
          pixelGap,
          autoApplyToLamp,
          showTitles,
          allowRename,
          btnCfg,
        );
        break;
      default:
        galleryContent = this._renderPixelArtList(
          paginatedPixelArts,
          globalOffset,
          allowDelete,
          bgColor,
          pixelStyle,
          pixelGap,
          autoApplyToLamp,
          showTitles,
          allowRename,
          btnCfg,
        );
        break;
    }

    // Return gallery content with pagination
    return html` ${galleryContent} ${pagination || ""} `;
  }

  _renderPixelArtGalleryMode(
    pixelArts,
    globalOffset,
    allowDelete,
    bgColor,
    pixelStyle,
    pixelGap,
    autoApplyToLamp,
    showTitles,
    allowRename,
    btnCfg = null,
  ) {
    const cfg = this.config || {};
    if (!btnCfg) btnCfg = getDeleteButtonConfig(cfg);
    // Resolve pixel art box shadow locally (spacing mode tri-state)
    const artSpacingMode =
      cfg.pixel_art_spacing_mode ||
      (cfg.pixel_art_pixel_spacing === false ? "none" : "normal");
    const pixelArtPixelBoxShadow =
      artSpacingMode === "subtle" || artSpacingMode === "normal";
    const previewSizePercent = cfg.pixel_art_preview_size || 100;
    // Use pixel_art_preview_size to control card size in gallery mode
    const cardSizeMultiplier = previewSizePercent / 100;

    // Get delete button class
    const removeBtnClass = btnCfg.classes;

    // Store context for event handlers
    this._gridContext = {
      globalOffset,
      autoApplyToLamp,
    };

    // Render function for pixel art content - make it fully responsive
    const renderPixelArtContent = (art, idx) => {
      const pixelMatrix = this._convertPixelArtToDisplayMatrix(art);

      // Scale padding from 6px at 100% to 4px at 55%
      // Formula: padding = 6 - ((100 - previewSizePercent) / (100 - 55)) * (6 - 4)
      const minPadding = 4;
      const maxPadding = 6;
      const minSize = 55;
      const maxSize = 100;
      const scaledPadding =
        previewSizePercent >= maxSize
          ? maxPadding
          : previewSizePercent <= minSize
            ? minPadding
            : maxPadding -
              ((maxSize - previewSizePercent) / (maxSize - minSize)) *
                (maxPadding - minPadding);

      return `
        <div class="pixelart-preview"
             style="width: 100%;
                    height: 100%;
                    box-sizing: border-box;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: ${scaledPadding}px;">
            <div class="pixelart-matrix ${pixelStyle}"
                 style="display: grid;
                        grid-template-columns: repeat(${GRID_COLS}, 1fr);
                        grid-template-rows: repeat(${GRID_ROWS}, 1fr);
                        gap: ${pixelGap}px;
                        width: 100%;
                        max-width: 100%;
                        background: ${resolveBgColor(bgColor)};">
              ${pixelMatrix
                .map((color) => {
                  // Check if pixel is black and should be ignored
                  const shouldIgnore =
                    cfg.gallery_ignore_black_pixels && isBlackPixel(color);
                  const pixelShadowStyle = pixelArtPixelBoxShadow
                    ? "box-shadow: 0 0 2px #0008;"
                    : "";
                  return `<div class="pixelart-pixel ${pixelStyle} ${
                    shouldIgnore ? "pixelart-pixel-empty" : ""
                  }" 
                               style="width: 100%; 
                                      height: 100%; 
                                      background: ${
                                        shouldIgnore
                                          ? "transparent"
                                          : color || "#000000"
                                      }; 
                                      ${pixelShadowStyle}
                                      ${
                                        pixelStyle === "circle"
                                          ? "border-radius: 50%;"
                                          : pixelStyle === "rounded"
                                            ? "border-radius: 15%;"
                                            : ""
                                      }">
                          </div>`;
                })
                .join("")}
            </div>
        </div>
      `;
    };

    const galleryHTML = renderGalleryMode(pixelArts, renderPixelArtContent, {
      showTitle: showTitles,
      showDelete: allowDelete,
      deleteButtonClass: removeBtnClass,
      posClass: btnCfg.posClass,
      sideClass: btnCfg.sideClass,
      onDeleteClick: "handleGridDelete",
      onItemClick: "handleGridItemClick",
      onTitleClick: allowRename ? "handleGridTitleClick" : null,
      cardSizeMultiplier: cardSizeMultiplier,
      roundedCards: cfg.rounded_cards,
    });

    return html`
      <style>
        ${galleryModeStyles}
        /* Remove padding for pixel art gallery items */
        .gallery-item-image {
          padding: 0 !important;
        }
      </style>
      ${unsafeHTML(galleryHTML)}
    `;
  }

  _renderPixelArtAlbum(
    pixelArts,
    allowDelete,
    bgColor,
    pixelStyle,
    pixelGap,
    autoApplyToLamp,
    showTitles,
    allowRename,
    btnCfg = null,
  ) {
    const cfg = this.config || {};
    if (!btnCfg) btnCfg = getDeleteButtonConfig(cfg);
    // Resolve pixel art box shadow locally (spacing mode tri-state)
    const artSpacingMode =
      cfg.pixel_art_spacing_mode ||
      (cfg.pixel_art_pixel_spacing === false ? "none" : "normal");
    const pixelArtPixelBoxShadow =
      artSpacingMode === "subtle" || artSpacingMode === "normal";
    const previewSizePercent = cfg.pixel_art_preview_size || 100;
    const proportionalGap = (pixelGap * previewSizePercent) / 100;
    const proportionalPadding = (8 * previewSizePercent) / 100;

    // Prepare config for album view
    const albumConfig = {
      ...cfg,
      show_remove_button: allowDelete,
      card_size: cfg.pixel_art_preview_size || 50,
      pixel_art_remove_button_style: btnCfg.style,
      delete_button_shape: btnCfg.shape,
      delete_button_inside: btnCfg.inside,
      delete_button_left: btnCfg.left,
    };

    // Render function for each pixel art item content
    const renderPixelArtContent = (art, idx) => {
      const pixelMatrix = this._convertPixelArtToDisplayMatrix(art);

      return `
        <div class="album-content-container">
          ${
            showTitles
              ? `
            <div class="album-title">
              <span class="title-text${
                allowRename ? " editable" : ""
              }" data-index="${idx}">
                ${art.name || "Unnamed"}
              </span>
            </div>
          `
              : ""
          }
          <div class="album-preview pixelart-preview-album"
               style="padding: ${proportionalPadding}px;
                      --pixelart-bg-color: ${resolveBgColor(bgColor, "#ffffff")};
                      --pixelart-gap: ${proportionalGap}px;"
               data-index="${idx}">
            <div class="pixelart-matrix ${pixelStyle}">
              ${pixelMatrix
                .map((color, pixelIdx) => {
                  const pixelShadowStyle = pixelArtPixelBoxShadow
                    ? "box-shadow: 0 0 2px #0008;"
                    : "";
                  // Check if pixel is black and should be ignored
                  const shouldIgnore =
                    cfg.gallery_ignore_black_pixels && isBlackPixel(color);
                  return `
                  <div class="pixelart-pixel ${pixelStyle} ${
                    color !== "#000000" ? "active" : ""
                  } ${shouldIgnore ? "pixelart-pixel-empty" : ""}"
                       style="background-color: ${
                         shouldIgnore ? "transparent" : color
                       }; ${pixelShadowStyle}">
                  </div>
                `;
                })
                .join("")}
            </div>
          </div>
        </div>
      `;
    };

    // Get album HTML using shared utility
    const albumHTML = renderAlbumView(
      pixelArts,
      renderPixelArtContent,
      albumConfig,
      "pixelarts",
    );

    // Return unsafeHTML wrapped content
    return html`
      <style>
        ${getAlbumStyles(
          albumConfig,
          "pixelarts",
        )}
        
        /* Pixelart-specific album styles */
        .pixelarts-album-item .album-content-container {
          width: 100%;
          height: 100%;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-sizing: border-box;
          background: var(--card-background-color, white);
        }

        .pixelarts-album-item .album-title {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-text-color, #333);
          text-align: center;
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .pixelarts-album-item .album-title .title-text.editable {
          cursor: pointer;
          transition: color 0.2s;
        }

        .pixelarts-album-item .album-title .title-text.editable:hover {
          color: var(--primary-color, #1e90ff);
        }

        .pixelarts-album-item .album-preview {
          /* flex: 1;
          display: flex;
          align-items: center;
          justify-content: center; */
          width: auto;
          height: fit-content;
        }

        .pixelart-preview-album {
          cursor: pointer;
          width: 100%;
          /* No transform transition here - parent handles coverflow animations */
        }
        .pixelart-preview-album:hover {
          /* Hover effect without conflicting with coverflow transitions */
          filter: brightness(1.1);
        }
        .pixelart-preview-album .pixelart-matrix {
          display: grid;
          grid-template-columns: repeat(20, 1fr);
          gap: var(--pixelart-gap, 0px);
          background-color: var(--pixelart-bg-color, transparent);
          border-radius: 8px;
          padding: 8px;
          width: 100%;
          box-sizing: border-box;
        }
        .pixelart-preview-album .pixelart-pixel {
          width: 100%;
          aspect-ratio: 1 / 1;
          background-color: #000;
          transition: background-color 0.1s ease;
        }
        .pixelart-pixel.pixelart-pixel-empty {
          background: transparent !important;
        }
        .pixelart-pixel.circle {
          border-radius: 50%;
        }
        .pixelart-pixel.rounded {
          border-radius: 15%;
        }
      </style>
      ${unsafeHTML(albumHTML)}
    `;
  }

  _renderPixelArtList(
    pixelArts,
    globalOffset,
    allowDelete,
    bgColor,
    pixelStyle,
    pixelGap,
    autoApplyToLamp,
    showTitles,
    allowRename,
    btnCfg = null,
  ) {
    const cfg = this.config || {};
    if (!btnCfg) btnCfg = getDeleteButtonConfig(cfg);
    // Resolve pixel art box shadow locally (spacing mode tri-state)
    const artSpacingMode =
      cfg.pixel_art_spacing_mode ||
      (cfg.pixel_art_pixel_spacing === false ? "none" : "normal");
    const pixelArtPixelBoxShadow =
      artSpacingMode === "subtle" || artSpacingMode === "normal";
    const previewSizePercent = cfg.pixel_art_preview_size || 100;
    const scaleValue = previewSizePercent / 100;

    const removeBtnClass = btnCfg.classes;
    // Fix #12: compute border-radius once, expose as CSS custom property so the
    // <style> block below never contains a dynamic ${...} expression.  Lit then
    // caches the style sheet and the browser only re-parses it on the very first
    // render — not on every subsequent re-render.
    const itemBorderRadius = (() => {
      const v = cfg.rounded_cards;
      if (v === undefined || v === true || v === "round") return 16;
      if (v === false || v === "square") return 0;
      if (v === "rounded") return 4;
      return typeof v === "number" ? v : parseInt(v, 10) || 16;
    })();

    return html`
      <style>
        ${listModeStyles} .pixelart-list-item {
          position: relative;
          display: flex;
          flex-direction: column;
          padding: 12px;
          background: var(--secondary-background-color, #fafbfc);
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: var(--pixelart-list-radius, 16px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          margin-bottom: 10px;
          transition: all 0.2s ease;
        }

        .pixelart-list-item:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          border-color: var(--divider-color, #bcc5d0);
        }

        .list-item-content {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          flex-wrap: wrap-reverse;
        }

        .list-item-preview {
          flex-shrink: 0;
          transform: scale(var(--preview-scale, 1));
          transform-origin: left center;
        }

        .pixelart-list-item .pixelart-preview {
          background: var(--pixelart-bg-color, transparent);
          border-radius: 8px;
          /* display: inline-block; */
          padding: 6px;
        }

        .pixelart-list-item .pixelart-matrix {
          display: grid;
          grid-template-columns: repeat(20, 1fr);
          gap: var(--pixelart-gap, 0px);
          width: fit-content;
        }

        .pixelart-list-item .pixelart-pixel {
          width: 10px;
          height: 10px;
          background: #000;
          transition: background 0.15s ease;
        }

        .pixelart-list-item .pixelart-pixel.circle {
          border-radius: 50%;
        }

        .pixelart-list-item .pixelart-pixel.rounded {
          border-radius: 15%;
        }

        .pixelart-list-item .pixelart-pixel.square {
          border-radius: 0;
        }

        .list-item-name {
          font-weight: 500;
          color: var(--primary-text-color, #333);
          flex: 1 1 120px;
          min-width: 0;
          word-break: break-word;
          overflow-wrap: break-word;
          cursor: ${allowRename ? "pointer" : "default"};
        }

        .list-item-name:hover {
          opacity: ${allowRename ? 0.8 : 1};
        }

        .list-delete-btn {
          position: absolute !important;
          top: 8px !important;
          right: 8px !important;
        }
        .list-delete-btn.btn-pos-inside {
          top: 6px !important;
          right: 6px !important;
        }
        .list-delete-btn.btn-pos-outside {
          top: -8px !important;
          right: -8px !important;
        }
        .list-delete-btn.dot-style.btn-pos-outside {
          top: -4px !important;
          right: -4px !important;
        }
        .list-delete-btn.btn-side-left {
          right: auto !important;
          left: 8px !important;
        }
        .list-delete-btn.btn-pos-inside.btn-side-left {
          left: 6px !important;
        }
        .list-delete-btn.btn-pos-outside.btn-side-left {
          left: -8px !important;
        }
        .list-delete-btn.dot-style.btn-pos-outside.btn-side-left {
          left: -4px !important;
        }
        .pixelart-list-item:has(.btn-pos-outside) {
          overflow: visible;
        }
        /* Push content away from inside delete button */
        .pixelart-list-item:has(.list-delete-btn:not(.btn-side-left))
          .list-item-content {
          padding-right: 30px;
        }
        .pixelart-list-item:has(.list-delete-btn.btn-side-left)
          .list-item-content {
          padding-left: 30px;
        }
      </style>
      <div
        class="pixelart-gallery-list"
        style="--pixelart-list-radius: ${itemBorderRadius}px"
      >
        ${repeat(
          pixelArts,
          (art, idx) => `${art.name || "untitled"}-${globalOffset + idx}`,
          // --pixelart-list-radius is set on the wrapper div above; the CSS var
          // propagates into every .pixelart-list-item child via cascade.
          (art, idx) => {
            const pixelMatrix = this._convertPixelArtToDisplayMatrix(art);
            const globalIdx = globalOffset + idx;

            return html`
              <div class="pixelart-list-item" data-index="${globalIdx}">
                ${allowDelete
                  ? html`<button
                      class="${removeBtnClass} list-delete-btn ${btnCfg.posClass} ${btnCfg.sideClass}"
                      data-index="${globalIdx}"
                      title="Delete pixel art"
                      @click=${(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._handleGalleryClick(e);
                      }}
                    ></button>`
                  : ""}
                <div
                  class="list-item-content"
                  @click=${() =>
                    this._handlePixelArtCanvasClick(globalIdx, autoApplyToLamp)}
                >
                  <div
                    class="list-item-preview"
                    style="--preview-scale: ${scaleValue};"
                  >
                    <div
                      class="pixelart-preview"
                      style="width: fit-content;
                             --pixelart-bg-color: ${resolveBgColor(bgColor)};
                             --pixelart-gap: ${pixelGap}px;"
                      title="Click to apply to drawing matrix${autoApplyToLamp
                        ? " and lamp"
                        : ""}"
                    >
                      <div class="pixelart-matrix ${pixelStyle}">
                        ${pixelMatrix.map((color) => {
                          const pixelShadowStyle = pixelArtPixelBoxShadow
                            ? "box-shadow: 0 0 2px #0008;"
                            : "";
                          // Check if pixel is black and should be ignored
                          const shouldIgnore =
                            cfg.gallery_ignore_black_pixels &&
                            isBlackPixel(color);
                          return html`
                            <div
                              class="pixelart-pixel ${pixelStyle} ${color !==
                              "#000000"
                                ? "active"
                                : ""} ${shouldIgnore
                                ? "pixelart-pixel-empty"
                                : ""}"
                              style="background: ${shouldIgnore
                                ? "transparent"
                                : color || "#000000"}; ${pixelShadowStyle}"
                            ></div>
                          `;
                        })}
                      </div>
                    </div>
                  </div>
                  ${showTitles
                    ? html`<div
                        class="list-item-name"
                        data-index="${globalIdx}"
                        @click=${allowRename
                          ? (e) => {
                              e.stopPropagation();
                              this._handleRenameClick(e, globalIdx);
                            }
                          : null}
                      >
                        ${art.name || "Unnamed"}
                      </div>`
                    : ""}
                </div>
              </div>
            `;
          },
        )}
      </div>
    `;
  }

  /**
   * Carousel - Carousel mode using reusable carousel utility
   */
  _renderPixelArtCarousel(
    pixelArts,
    allowDelete,
    bgColor,
    pixelStyle,
    pixelGap,
    autoApplyToLamp,
    showTitles,
    allowRename,
    btnCfg = null,
  ) {
    const cfg = this.config || {};
    if (!btnCfg) btnCfg = getDeleteButtonConfig(cfg);
    const buttonShape = cfg.carousel_button_shape || "rect";

    // Initialize carousel index and slide direction
    if (!this._galleryCarouselIndex) this._galleryCarouselIndex = 0;
    if (!this._galleryCarouselSlideDirection)
      this._galleryCarouselSlideDirection = 0;

    return renderCarousel({
      items: pixelArts,
      currentIndex: this._galleryCarouselIndex,
      slideDirection: this._galleryCarouselSlideDirection,
      buttonShape,
      showAsCard: true, // Always show as card for carousel
      wrapNavigation: cfg.carousel_wrap_navigation === true,
      roundedCards: cfg.rounded_cards,
      onNavigate: (direction, maxLength) => {
        this._navigateCarousel(direction, maxLength);
      },
      onSetIndex: (index) => {
        this._setCarouselIndex(index);
      },
      renderItem: (art, idx) => {
        return this._renderPixelArtItem(
          art,
          idx,
          allowDelete,
          "carousel",
          bgColor,
          pixelStyle,
          pixelGap,
          autoApplyToLamp,
          showTitles,
          allowRename,
        );
      },
    });
  }

  _navigateColorCarousel(direction, maxLength) {
    const current = this._colorCarouselIndex || 0;
    const cfg = this.config || {};
    const wrapNavigation = cfg.palette_carousel_wrap_navigation === true;

    let newIndex = current + direction;

    if (wrapNavigation) {
      if (newIndex < 0) {
        newIndex = maxLength - 1;
      } else if (newIndex >= maxLength) {
        newIndex = 0;
      }
    } else {
      newIndex = Math.max(0, Math.min(newIndex, maxLength - 1));
    }

    if (newIndex !== current) {
      this._colorCarouselSlideDirection = direction;
      this._colorCarouselIndex = newIndex;
      this.requestUpdate();
    }
  }

  _setColorCarouselIndex(index) {
    const current = this._colorCarouselIndex || 0;
    if (index !== current) {
      this._colorCarouselSlideDirection = index > current ? 1 : -1;
      this._colorCarouselIndex = index;
      this.requestUpdate();
    }
  }

  _navigateCarousel(direction, maxLength) {
    const current = this._galleryCarouselIndex || 0;
    const cfg = this.config || {};
    const wrapNavigation = cfg.carousel_wrap_navigation === true;

    let newIndex = current + direction;

    // Handle wrapping
    if (wrapNavigation) {
      if (newIndex < 0) {
        newIndex = maxLength - 1; // Wrap to last
      } else if (newIndex >= maxLength) {
        newIndex = 0; // Wrap to first
      }
    } else {
      // Clamp to bounds
      newIndex = Math.max(0, Math.min(newIndex, maxLength - 1));
    }

    if (newIndex !== current) {
      this._galleryCarouselSlideDirection = direction;
      this._galleryCarouselIndex = newIndex;
      this.requestUpdate();
    }
  }

  _setCarouselIndex(index) {
    const current = this._galleryCarouselIndex || 0;
    if (index !== current) {
      // Determine slide direction based on index change
      this._galleryCarouselSlideDirection = index > current ? 1 : -1;
      this._galleryCarouselIndex = index;
      this.requestUpdate();
    }
  }

  _renderPixelArtItem(
    art,
    idx,
    allowDelete,
    displayMode = "grid",
    bgColor = "transparent",
    pixelStyle = "square",
    pixelGap = 0,
    autoApplyToLamp = false,
    showTitles = true,
    allowRename = false,
  ) {
    const itemClass = `pixelart-item pixelart-item-${displayMode} pixelart-item-plain`;
    const nameClass = `pixelart-name pixelart-name-${displayMode}${
      allowRename ? " clickable" : ""
    }`;
    const buttonsClass = `pixelart-buttons pixelart-buttons-${displayMode}`;

    // Get delete button config from centralized helper
    const cfg = this.config || {};
    const itemBtnCfg = getDeleteButtonConfig(cfg);
    const deleteBtnClass = `pixelart-btn-cross ${itemBtnCfg.classes} ${itemBtnCfg.posClass} ${itemBtnCfg.sideClass}`;

    // Get preview size percentage (matching matrix size approach)
    const previewSizePercent = cfg.pixel_art_preview_size || 100;

    // Make pixel gap proportional to preview size
    const proportionalGap = (pixelGap * previewSizePercent) / 100;

    // Make padding proportional to preview size (base padding is 8px at 100%)
    const proportionalPadding = (8 * previewSizePercent) / 100;

    // Convert pixel art to 20x5 matrix for rendering
    const pixelMatrix = this._convertPixelArtToDisplayMatrix(art);

    // Box shadow settings — resolve from pixel_art_spacing_mode with backward compat
    const artSpacingMode =
      cfg.pixel_art_spacing_mode ||
      (cfg.pixel_art_pixel_spacing === false ? "none" : "normal");
    const pixelArtPixelBoxShadow =
      artSpacingMode === "subtle" || artSpacingMode === "normal";

    // Determine if title should be on top (for grid, carousel)
    const titleOnTop = displayMode !== "list";
    const isCarousel = displayMode === "carousel";

    return html`
      <div class="${itemClass}">
        ${isCarousel && showTitles
          ? html`<div class="pixelart-title-row">
              <div
                class="${nameClass}"
                data-index="${idx}"
                title=${allowRename ? "Click to rename" : ""}
              >
                ${art.name || "Unnamed"}
              </div>
            </div>`
          : ""}
        ${isCarousel && allowDelete
          ? html`<button
              class="${deleteBtnClass} pixelart-delete-title-row"
              data-index="${idx}"
              title="Delete pixel art"
              @click=${(e) => {
                e.preventDefault();
                e.stopPropagation();
                this._handleGalleryClick(e);
              }}
            >
              &#10006;
            </button>`
          : ""}
        ${!isCarousel && titleOnTop && showTitles
          ? html`<div class="pixelart-title-row">
              <div
                class="${nameClass}"
                data-index="${idx}"
                title=${allowRename ? "Click to rename" : ""}
              >
                ${art.name || "Unnamed"}
              </div>
              ${allowDelete
                ? html`<button
                    class="${deleteBtnClass} pixelart-delete-title-row"
                    data-index="${idx}"
                    title="Delete pixel art"
                    @click=${(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      this._handleGalleryClick(e);
                    }}
                  >
                    &#10006;
                  </button>`
                : ""}
            </div>`
          : ""}
        ${!isCarousel && titleOnTop && !showTitles && allowDelete
          ? html`<div class="pixel-btn-cross-container">
              <button
                class="${deleteBtnClass} pixelart-delete-overlay-grid"
                data-index="${idx}"
                title="Delete pixel art"
                @click=${(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this._handleGalleryClick(e);
                }}
              >
                &#10006;
              </button>
            </div>`
          : ""}
        <!-- List mode - simple and direct -->
        ${displayMode === "list"
          ? html`<div
                class="pixelart-preview"
                style="padding: ${proportionalPadding}px;
                --pixelart-size-percent: ${previewSizePercent}%;
                --pixelart-bg-color: ${resolveBgColor(bgColor, "#ffffff")};
                --pixelart-gap: ${proportionalGap}px;
              "
                @click=${() =>
                  this._handlePixelArtCanvasClick(idx, autoApplyToLamp)}
                title="Click to apply to drawing matrix${autoApplyToLamp
                  ? " and lamp"
                  : ""}"
              >
                <div class="pixelart-matrix ${pixelStyle}">
                  ${pixelMatrix.map((color, pixelIdx) => {
                    // Individual pixel shadow style (like in drawing matrix)
                    const pixelShadowStyle = pixelArtPixelBoxShadow
                      ? "box-shadow: 0 0 2px #0008;"
                      : "";

                    return html`
                      <div
                        class="pixelart-pixel ${pixelStyle} ${color !==
                        "#000000"
                          ? "active"
                          : ""}"
                        style="background: ${color ||
                        "#000000"}; ${pixelShadowStyle}"
                      ></div>
                    `;
                  })}
                </div>
              </div>
              ${showTitles
                ? html`<div
                    class="${nameClass}"
                    data-index="${idx}"
                    title=${allowRename ? "Click to rename" : ""}
                  >
                    ${art.name || "Unnamed"}
                  </div>`
                : ""}`
          : html`<div
              class="pixelart-preview"
              style="padding: ${proportionalPadding}px;
                --pixelart-size-percent: ${previewSizePercent}%;
                --pixelart-bg-color: ${resolveBgColor(bgColor, "#ffffff")};
                --pixelart-gap: ${proportionalGap}px;
                position: relative;
              "
              @click=${() =>
                this._handlePixelArtCanvasClick(idx, autoApplyToLamp)}
              title="Click to apply to drawing matrix${autoApplyToLamp
                ? " and lamp"
                : ""}"
            >
              ${!titleOnTop && allowDelete
                ? html`<button
                    class="${deleteBtnClass} pixelart-delete-overlay-list"
                    data-index="${idx}"
                    title="Delete pixel art"
                    @click=${(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      this._handleGalleryClick(e);
                    }}
                  >
                    &#10006;
                  </button>`
                : ""}
              <div class="pixelart-matrix ${pixelStyle}">
                ${pixelMatrix.map((color, pixelIdx) => {
                  // Individual pixel shadow style (like in drawing matrix)
                  const pixelShadowStyle = pixelArtPixelBoxShadow
                    ? "box-shadow: 0 0 2px #0008;"
                    : "";
                  // Check if pixel is black and should be ignored
                  const shouldIgnore =
                    cfg.gallery_ignore_black_pixels && isBlackPixel(color);

                  return html`
                    <div
                      class="pixelart-pixel ${pixelStyle} ${color !== "#000000"
                        ? "active"
                        : ""} ${shouldIgnore ? "pixelart-pixel-empty" : ""}"
                      style="background: ${shouldIgnore
                        ? "transparent"
                        : color || "#000000"}; ${pixelShadowStyle}"
                    ></div>
                  `;
                })}
              </div>
            </div>`}
        ${!titleOnTop && displayMode !== "list" && showTitles
          ? html`<div
              class="${nameClass}"
              data-index="${idx}"
              title=${allowRename ? "Click to rename" : ""}
            >
              ${art.name || "Unnamed"}
            </div>`
          : ""}
      </div>
    `;
  }

  _setupPixelArtAlbumNavigation() {
    if (!this.shadowRoot) return;

    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this.hass.states[pixelartSensor]) {
      return;
    }

    const stateObj = this.hass.states[pixelartSensor];
    let pixelArts = stateObj.attributes.pixel_arts || [];

    // CRITICAL FIX: Trim stale array to match count attribute
    // Websocket doesn't send full array updates, only scalar attributes like 'count'
    const expectedCount = stateObj.attributes.count || pixelArts.length;
    if (pixelArts.length > expectedCount) {
      pixelArts = pixelArts.slice(0, expectedCount);
    }

    if (pixelArts.length === 0) return;

    // Setup navigation using shared utility (album-view-utils handles _currentAlbumIndex initialization)
    setupAlbumNavigation(
      this.shadowRoot,
      "pixelarts",
      // On item click - load pixel art
      (idx) => {
        const autoApplyToLamp = cfg.pixel_art_auto_apply_to_lamp === true;
        this._handlePixelArtCanvasClick(idx, autoApplyToLamp);
      },
      // On item remove - delete pixel art
      (idx) => {
        this._deletePixelArt(idx);
      },
      // Context object to store state
      this,
      // Config for 3D mode detection
      cfg,
    );

    // Setup rename functionality if enabled
    if (cfg.pixel_art_allow_rename === true) {
      const titleElements = this.shadowRoot.querySelectorAll(
        ".album-title .title-text.editable",
      );
      titleElements.forEach((titleEl) => {
        titleEl.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = parseInt(titleEl.dataset.index, 10);
          this._handleRenameClick(e, idx);
        });
      });
    }
  }

  _setupPixelArtCompactDragDrop() {
    if (!this.shadowRoot) return;

    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this.hass.states[pixelartSensor]) {
      return;
    }

    const container = this.shadowRoot.querySelector(".compact-container");
    if (!container) {
      return;
    }

    // Setup drag-and-drop using shared utility
    setupCompactDragDrop(
      container,
      ".compact-item",
      (newOrder) => {
        // Get current pixel arts
        const stateObj = this.hass.states[pixelartSensor];
        let pixelArts = stateObj.attributes.pixel_arts || [];

        // CRITICAL FIX: Trim stale array to match count attribute
        const expectedCount = stateObj.attributes.count || pixelArts.length;
        if (pixelArts.length > expectedCount) {
          pixelArts = pixelArts.slice(0, expectedCount);
        }

        // Reorder pixel arts based on new order
        const reorderedPixelArts = newOrder
          .map((idx) => {
            const art = pixelArts[idx];
            return art;
          })
          .filter((art) => art !== undefined);

        // Save reordered pixel arts
        if (reorderedPixelArts.length === pixelArts.length) {
          this._isDragging = true;

          // Store the reordered array locally so delete operations use the correct indices
          // until the websocket confirms the reorder
          this._pendingReorderedPixelArts = reorderedPixelArts;

          this._saveReorderedPixelArts(reorderedPixelArts);
        } else {
          console.error(
            `[PixelArt] Length mismatch! Original: ${pixelArts.length}, Reordered: ${reorderedPixelArts.length}`,
          );
        }
      },
      {
        context: this,
        shouldPreventDrag: (e) => {
          // Don't drag if clicking on delete button
          if (e.target.closest('button[data-action="remove"]')) {
            return true;
          }
          return false;
        },
      },
    );
  }

  _saveReorderedPixelArts(pixelArts) {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor) return;

    // Use update_pixel_arts service to save the reordered list
    // This service is specifically designed for bulk updates like reordering
    this.hass
      .callService("yeelight_cube", "update_pixel_arts", {
        pixel_arts: pixelArts,
      })
      .then(() => {
        this._isDragging = false;
      })
      .catch((error) => {
        console.error("[PixelArt] Failed to save reordered pixel arts:", error);
        this._isDragging = false;
        this._pendingReorderedPixelArts = null; // Clear on error
      });
  }

  _convertPixelArtToDisplayMatrix(art) {
    if (!art.pixels || !Array.isArray(art.pixels)) return createEmptyMatrix();

    const matrix = createEmptyMatrix();

    for (const px of art.pixels) {
      const lampPos = px.position; // This is 0-99 (20x5 grid)
      const color = px.color;

      if (
        lampPos >= 0 &&
        lampPos < MATRIX_SIZE &&
        Array.isArray(color) &&
        color.length >= 3
      ) {
        // Convert lamp position to display matrix position
        // Lamp grid: 20x5 (positions 0-99), Y-axis flipped
        const lampRow = GRID_ROWS - 1 - Math.floor(lampPos / GRID_COLS); // 4-0 (flipped Y-axis)
        const lampCol = lampPos % GRID_COLS; // 0-19 (20 columns)

        // Display matrix position (20x5 grid for preview)
        const displayPos = lampRow * GRID_COLS + lampCol;

        if (displayPos >= 0 && displayPos < MATRIX_SIZE) {
          const hex = rgbArrayToHex(color);
          matrix[displayPos] = hex;
        }
      }
    }

    return matrix;
  }

  // Grid mode event handlers
  handleGridItemClick(event, idx) {
    const context = this._gridContext || {};
    const globalIdx = (context.globalOffset || 0) + idx;
    this._handlePixelArtCanvasClick(globalIdx, context.autoApplyToLamp);
  }

  handleGridDelete(event, idx) {
    const context = this._gridContext || {};
    const globalIdx = (context.globalOffset || 0) + idx;

    // Create a proper fake event with the button as target
    const button = event.target.closest("button");
    if (!button) return;

    // Create a fake button element with the index in dataset
    const fakeButton = {
      classList: button.classList,
      dataset: { index: globalIdx, action: "remove" },
      closest: (selector) => {
        if (selector === "button") return fakeButton;
        return null;
      },
    };

    this._handleGalleryClick({
      target: fakeButton,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }

  handleGridTitleClick(event, idx) {
    const context = this._gridContext || {};
    const globalIdx = (context.globalOffset || 0) + idx;
    this._handleRenameClick(event, globalIdx);
  }

  async _handlePixelArtCanvasClick(idx, autoApplyToLamp) {
    // Always apply to matrix
    await this._applyPixelArtToMatrix(idx);

    // If auto-apply is enabled, also send current matrix to lamp
    if (autoApplyToLamp) {
      await this._sendToLamp();
    }
  }

  _handleGalleryClick(e) {
    // Check if click is on a clickable title element (for rename)
    const titleElement = e.target.closest(".pixelart-name.clickable");

    if (titleElement && titleElement.dataset.index !== undefined) {
      const idx = parseInt(titleElement.dataset.index);
      if (!isNaN(idx) && idx >= 0) {
        this._handleRenameClick(e, idx);
        return;
      }
    }

    // Check for button clicks
    e.preventDefault();
    e.stopPropagation();

    const target = e.target.closest("button");
    if (!target) return;

    // Ignore navigation buttons and carousel indicators (they have their own handlers)
    if (
      target.classList.contains("carousel-nav") ||
      target.classList.contains("carousel-dot") ||
      target.classList.contains("carousel-indicator") ||
      target.classList.contains("mode-btn")
    ) {
      return;
    }

    // Get index from button's data attributes OR from parent .compact-item
    // For compact mode with drag-and-drop, data-idx is only on the parent element
    let index = null;

    if (target.dataset.index !== undefined) {
      index = parseInt(target.dataset.index);
    } else if (target.dataset.idx !== undefined) {
      index = parseInt(target.dataset.idx);
    } else {
      // Check parent .compact-item for data-idx (used in compact mode after drag-and-drop)
      const compactItem = target.closest(".compact-item");
      if (compactItem && compactItem.dataset.idx !== undefined) {
        index = parseInt(compactItem.dataset.idx);
      }
    }

    if (index === null || isNaN(index)) {
      console.error("[Gallery] Invalid index, aborting");
      return;
    }

    if (target.classList.contains("apply-btn")) {
      this._applyPixelArt(index);
    } else if (target.classList.contains("apply-matrix-btn")) {
      this._applyPixelArtToMatrix(index);
    } else if (
      target.classList.contains("delete-btn") ||
      target.classList.contains("delete-btn-cross") ||
      target.dataset.action === "remove"
    ) {
      // INSTANT UI UPDATE: Remove the DOM element immediately for instant visual feedback
      const compactItem = target.closest(".compact-item");
      if (compactItem) {
        compactItem.style.transition = "opacity 0.2s, transform 0.2s";
        compactItem.style.opacity = "0";
        compactItem.style.transform = "scale(0.8)";
        setTimeout(() => compactItem.remove(), 200);
      }

      this._deletePixelArt(index);
    } else if (target.classList.contains("mode-btn")) {
      const mode = target.dataset.mode;
      if (mode) {
        this.galleryMode = mode;
        this.requestUpdate();
      }
    }
  }

  async _handleRenameClick(e, idx) {
    e.preventDefault();
    e.stopPropagation();

    // Get sensor entity from config
    const sensorEntityId = this.config.pixelart_sensor;
    if (!sensorEntityId || !this.hass) {
      console.error("[Rename] No sensor entity configured");
      return;
    }

    const stateObj = this.hass.states[sensorEntityId];
    if (!stateObj) {
      console.error("[Rename] Sensor entity not found:", sensorEntityId);
      return;
    }

    // Get current pixel arts from sensor
    const pixelArts = stateObj.attributes.pixel_arts || [];

    if (idx < 0 || idx >= pixelArts.length) {
      console.error(
        "[Rename] Invalid index:",
        idx,
        "length:",
        pixelArts.length,
      );
      return;
    }

    const currentArt = pixelArts[idx];
    const currentName = currentArt.name || "Unnamed";

    // Show prompt for new name
    const newName = prompt(`Rename pixel art:`, currentName);

    // If user cancelled or entered empty name, don't change
    if (newName === null || newName.trim() === "") {
      return;
    }

    // Optimistically update the UI immediately by patching local hass state.
    // This survives subsequent websocket re-renders (HA doesn't resend large arrays).
    const updatedPixelArts = pixelArts.map((art, i) =>
      i === idx ? { ...art, name: newName.trim() } : art,
    );
    const updatedState = {
      ...stateObj,
      attributes: {
        ...stateObj.attributes,
        pixel_arts: updatedPixelArts,
      },
    };
    this.hass = {
      ...this.hass,
      states: {
        ...this.hass.states,
        [sensorEntityId]: updatedState,
      },
    };
    this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
    this.requestUpdate();

    // Call service to rename (pixel arts are global, use callGlobalService)
    try {
      await this.callGlobalService("rename_pixel_art", {
        idx: idx,
        name: newName.trim(),
      });

      // Trigger sensor update
      await this.hass.callService("homeassistant", "update_entity", {
        entity_id: sensorEntityId,
      });

      // Trigger UI update
      window.dispatchEvent(new Event("pixelart-saved"));
    } catch (error) {
      console.error("[Rename] Failed to rename pixel art:", error);
      alert("Failed to rename pixel art. Please try again.");

      // Revert optimistic update on error
      const revertedPixelArts = updatedPixelArts.map((art, i) =>
        i === idx ? { ...art, name: currentName } : art,
      );
      this.hass = {
        ...this.hass,
        states: {
          ...this.hass.states,
          [sensorEntityId]: {
            ...updatedState,
            attributes: {
              ...updatedState.attributes,
              pixel_arts: revertedPixelArts,
            },
          },
        },
      };
      this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
      this.requestUpdate();
    }
  }
  async _applyPixelArt(idx) {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor) {
      console.error(
        "[draw-card] Cannot apply pixel art: missing hass or pixelart_sensor",
      );
      return;
    }

    // Debounce: if user clicks multiple pixel arts rapidly, only send the last one.
    // This prevents overwhelming the lamp with back-to-back TCP connections.
    if (this._applyPixelArtTimer) {
      clearTimeout(this._applyPixelArtTimer);
    }
    this._applyPixelArtTimer = setTimeout(async () => {
      this._applyPixelArtTimer = null;
      try {
        await this.callServiceOnTargetEntities("apply_pixel_art", { idx });
        await this.hass.callService("homeassistant", "update_entity", {
          entity_id: pixelartSensor,
        });
        window.dispatchEvent(new Event("pixelart-saved"));
      } catch (err) {
        console.error("[draw-card] Error applying pixel art:", err);
      }
    }, 300);
  }

  async _applyPixelArtToMatrix(idx) {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this.hass.states[pixelartSensor]) {
      console.error(
        "[draw-card] Cannot apply pixel art to matrix: missing hass or pixelart_sensor",
      );
      return;
    }

    try {
      const stateObj = this.hass.states[pixelartSensor];
      const pixelArts = stateObj.attributes.pixel_arts || [];
      const pixelArt = pixelArts[idx];

      if (!pixelArt || !pixelArt.pixels) {
        console.error("[draw-card] Pixel art not found or has no pixels");
        return;
      }

      this._pushMatrixHistory();

      // Start with black matrix (same as image upload)
      this.matrix = createEmptyMatrix();

      // Apply pixel art with row flipping to match preview display
      // Preview uses: row = (GRID_ROWS-1) - Math.floor(pos / GRID_COLS) to flip rows vertically
      for (const px of pixelArt.pixels) {
        const position = px.position;
        const color = px.color;

        if (
          position >= 0 &&
          position < MATRIX_SIZE &&
          Array.isArray(color) &&
          color.length >= 3
        ) {
          // Convert RGB array to hex (same as image upload)
          const r = color[0];
          const g = color[1];
          const b = color[2];
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b)
            .toString(16)
            .slice(1)}`;

          // Apply with row flipping to match preview display
          // Original position: row = Math.floor(position / GRID_COLS), col = position % GRID_COLS
          // Flipped row: flippedRow = (GRID_ROWS-1) - row (same as preview rendering)
          const originalRow = Math.floor(position / GRID_COLS); // 0-4
          const col = position % GRID_COLS; // 0-19
          const flippedRow = GRID_ROWS - 1 - originalRow; // Flip vertically
          const matrixPosition = flippedRow * GRID_COLS + col;

          if (matrixPosition >= 0 && matrixPosition < MATRIX_SIZE) {
            this.matrix[matrixPosition] = hex;
          }
        }
      }

      StorageUtils.saveMatrix(this.matrix);
      this.requestUpdate();
    } catch (err) {
      console.error("[draw-card] Error applying pixel art to matrix:", err);
    }
  }

  /**
   * Delete a pixel art by calling the backend service.
   * Backend updates sensor → websocket pushes update → card re-renders → album re-initializes.
   */
  /**
   * Fetch fresh pixel_arts from the REST API and patch _hass directly.
   * This bypasses the websocket limitation where HA doesn't resend large attribute
   * arrays (only scalar attributes like count/content_hash are pushed via websocket).
   * Called whenever content_hash changes in set hass.
   */
  async _fetchFreshPixelArts(sensorEntityId) {
    if (!this._hass || !sensorEntityId) return;
    // Debounce: avoid parallel fetches
    if (this._fetchingPixelArts) return;
    this._fetchingPixelArts = true;
    try {
      const freshState = await this._hass.callApi(
        "GET",
        `states/${sensorEntityId}`,
      );
      if (freshState?.attributes?.pixel_arts) {
        // Patch _hass directly (not via setter) to avoid re-triggering set hass logic
        this._hass = {
          ...this._hass,
          states: {
            ...this._hass.states,
            [sensorEntityId]: {
              ...this._hass.states[sensorEntityId],
              attributes: {
                ...this._hass.states[sensorEntityId].attributes,
                pixel_arts: freshState.attributes.pixel_arts,
              },
            },
          },
        };
        this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
        this.requestUpdate();
      }
    } catch (err) {
      console.warn("[PixelArt] Failed to fetch fresh pixel arts:", err);
    } finally {
      this._fetchingPixelArts = false;
    }
  }

  async _deletePixelArt(idx) {
    // Get current sensor state
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;
    if (!this.hass || !pixelartSensor || !this.hass.states[pixelartSensor]) {
      console.error("[Delete] No sensor found");
      return;
    }

    const stateObj = this.hass.states[pixelartSensor];

    // Use pending reordered pixel arts if available (after drag-and-drop, before websocket confirms)
    // Otherwise use the sensor's pixel arts
    const pixelArts =
      this._pendingReorderedPixelArts || stateObj.attributes.pixel_arts || [];
    const usingPendingReorder = !!this._pendingReorderedPixelArts;

    if (pixelArts[idx]) {
      // pixel art exists, proceed
    } else {
      console.error("[Delete] No pixel art found at index:", idx);
      return;
    }

    // OPTIMISTIC UPDATE: Remove from local state immediately for instant UI feedback
    const updatedPixelArts = [...pixelArts];
    updatedPixelArts.splice(idx, 1);

    // Update pending reordered array if we're using it
    if (usingPendingReorder) {
      this._pendingReorderedPixelArts = updatedPixelArts;
    }

    // Create a modified hass object with updated pixel arts
    const updatedState = {
      ...stateObj,
      attributes: {
        ...stateObj.attributes,
        pixel_arts: updatedPixelArts,
        count: updatedPixelArts.length,
      },
    };

    // Update hass with the optimistic state
    this.hass = {
      ...this.hass,
      states: {
        ...this.hass.states,
        [pixelartSensor]: updatedState,
      },
    };

    // Trigger re-render
    this.requestUpdate();

    // Then call backend (websocket update will eventually sync, but UI is already updated)
    try {
      await this.callGlobalService("remove_pixel_art", { idx });
    } catch (err) {
      console.error("[PIXELART-DELETE] Error calling backend:", err);
      // On error, websocket will restore the correct state
    }
  }

  async _exportPixelArts() {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this.hass.states[pixelartSensor]) {
      console.error("[draw-card] Pixel art sensor not found for export");
      return;
    }

    const stateObj = this.hass.states[pixelartSensor];
    const pixelArts = stateObj.attributes.pixel_arts || [];

    const json = JSON.stringify(pixelArts, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yeelight_pixel_arts.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  _triggerImportFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", (e) => this._importPixelArts(e));
    input.click();
  }

  async _importPixelArts(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor) {
      this._showImportStatus("error");
      return;
    }

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      if (!Array.isArray(imported)) {
        throw new Error("Invalid format: Expected an array of pixel arts");
      }

      // Validate each pixel art has required structure
      for (const art of imported) {
        if (!art || typeof art !== "object" || !Array.isArray(art.pixels)) {
          throw new Error("Invalid pixel art format");
        }
      }

      // Get existing pixel arts and append new ones
      const stateObj = this.hass.states[pixelartSensor];
      const existingPixelArts = stateObj?.attributes?.pixel_arts || [];
      const combinedPixelArts = [...existingPixelArts, ...imported];

      // Send to backend for import (append to existing)
      await this.callGlobalService("import_pixel_arts", {
        pixel_arts: combinedPixelArts,
      });

      await this.hass.callService("homeassistant", "update_entity", {
        entity_id: pixelartSensor,
      });

      window.dispatchEvent(new Event("pixelart-saved"));
      this._showImportStatus("success");
    } catch (err) {
      console.error("[draw-card] Import failed:", err);
      this._showImportStatus("error");
    }

    // Clear the file input safely
    try {
      if (e.target) {
        e.target.value = "";
      }
    } catch (clearErr) {
      console.warn("[draw-card] Could not clear file input:", clearErr);
    }
  }

  _showImportStatus(type) {
    // Set import status for button display
    this._importStatus = { showing: true, type };
    this.requestUpdate();

    // Clear status after delay
    setTimeout(
      () => {
        this._importStatus = { showing: false, type: null };
        this.requestUpdate();
      },
      type === "success" ? 2000 : 4000,
    );
  }

  _renderActions() {
    const cfg = this.config || {};
    const paintShape = cfg.button_shape || "rect";

    return this.actionManager.renderActionsSection(cfg, paintShape);
  }
}

customElements.define("yeelight-cube-draw-card", YeelightCubeDrawCard);

// Register with Home Assistant's card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: "yeelight-cube-draw-card",
  name: "Yeelight Draw Card",
  description:
    "Draw pixel art and control your Yeelight Cube Lite matrix display.",
  preview: true,
});
