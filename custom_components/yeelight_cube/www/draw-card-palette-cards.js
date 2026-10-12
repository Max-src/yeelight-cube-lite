// Palette cards of the draw card (recent / lamp palette / lamp colors / image
// palette) in their side, carousel, tabs, dropdown and preview-hover
// (<yc-preview-hover>) layouts, and the color carousel. Mixed into
// YeelightCubeDrawCard.
import { handleColorSelect } from "./draw_card_handlers.js";
import { html } from "./lib/lit-all.js";
import "./yc-swatches.js";
import "./preview-hover.js";
import { renderCarousel } from "./carousel-utils.js";

export const PaletteCardsMixin = (Base) => class extends Base {
  _renderPaletteCards(
    cfg,
    showRecentColors,
    showLampPalette,
    showLampColors,
    showImagePalette,
  ) {
    const mode = cfg.palette_card_mode || "side";
    // Every section's colors: the shared swatches, picking the draw color.
    const layout = cfg.swatch_layout || "row";
    const swatches = (palette, weights) => html`<yc-swatches
      .colors=${palette}
      .weights=${weights ? palette.map((color) => weights.get(color)) : undefined}
      .active=${this.selectedColor}
      .onSelect=${(color) => handleColorSelect(this, color)}
      selectable
      layout=${layout}
      shape=${cfg.swatch_shape || "round"}
      info=${cfg.color_info_display || "none"}
      order=${layout === "gradient" || layout === "fill" ? "smooth" : "given"}
      ?free-pick=${cfg.swatch_free_pick === true}
      direction=${cfg.swatch_blinds_direction || "rows"}
      expand-style=${cfg.swatch_expand_style || "pill"}
      button-shape=${cfg.colors_button_shape || "rounded"}
      style="--yc-swatch-size:${Number(cfg.colors_size) || 28}px"
    ></yc-swatches>`;
    const cards = [];
    const section = (key, title, palette, weights = null) =>
      cards.push({ key, title, palette, weights, content: swatches(palette, weights) });
    if (showRecentColors)
      section("recent", "Recent Colors", this.recentColors || []);
    if (showLampPalette)
      section("lamp", "Lamp Palette", this.getLampGradientColors() || []);
    if (showLampColors) {
      const { palette, weights } = this._getLampMatrixColors();
      section("lampcolors", "Lamp Colors", palette, weights);
    }
    if (showImagePalette) {
      const { palette, weights } = this._getCurrentColors();
      section("image", "Drawing Colors", palette, weights);
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
      // The color cards' corners (colors_item_radius; 16px by default).
      const paletteCardRadius = `${cfg.colors_item_radius ?? 16}px`;
      return html`<div
        class="palette-row${isZoomMode ? " zoom-mode" : ""}${colorsBorderClass}"
        style="--side-card-width:${sideW}%;--palette-card-radius:${paletteCardRadius}"
      >
        ${cards.map(
          (card) => html`
            <div
              class="palette-group-card yc-stack yc-controls${isZoomMode &&
              zoomedKey === card.key
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
      const carouselButtonShape = cfg.colors_button_shape || "rounded";
      if (this._colorCarouselIndex === undefined) this._colorCarouselIndex = 0;
      const carouselResult = renderCarousel({
        items: cards,
        currentIndex: this._colorCarouselIndex,
        buttonShape: carouselButtonShape,
        showAsCard: true,
        wrapNavigation: cfg.colors_wrap_navigation === true,
        // 12px by default in the carousel.
        roundedCards: cfg.colors_item_radius,
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
        <div class="palette-tabs yc-stack yc-controls${colorsBorderClass}">
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
        <div
          class="palette-dropdown-wrapper yc-stack yc-controls${colorsBorderClass}"
        >
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
    // Preview hover: small previews side by side, one opening at full size
    // (in place, or as an overlay: colors_preview_overlay).
    if (mode === "preview-hover") {
      return html`<yc-preview-hover
        .sections=${cards.map((card) => ({
          key: card.key,
          title: card.title,
          content: card.palette.length ? card.content : null,
        }))}
        ?overlay=${cfg.colors_preview_overlay === true}
        ?bordered=${showColorsBorder}
      ></yc-preview-hover>`;
    }
    // Fallback: side-by-side
    const fallbackSideW = cfg.side_card_width || 100;
    return html`<div
      class="palette-row${colorsBorderClass}"
      style="--side-card-width:${fallbackSideW}%"
    >
      ${cards.map(
        (card) => html`
          <div class="palette-group-card yc-stack yc-controls">
            <div class="palette-group-title">${card.title}</div>
            ${cardContent(card)}
          </div>
        `,
      )}
    </div>`;
  }

  _navigateColorCarousel(direction, maxLength) {
    const current = this._colorCarouselIndex || 0;
    const cfg = this.config || {};
    const wrapNavigation = cfg.colors_wrap_navigation === true;

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
      this._colorCarouselIndex = newIndex;
      this.requestUpdate();
    }
  }

  _setColorCarouselIndex(index) {
    const current = this._colorCarouselIndex || 0;
    if (index !== current) {
      this._colorCarouselIndex = index;
      this.requestUpdate();
    }
  }
};
