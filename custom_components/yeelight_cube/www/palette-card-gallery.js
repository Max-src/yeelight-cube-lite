// Palette collection display of the palette card: list, gallery, album and
// carousel modes, item rendering, carousel navigation and the export/import
// buttons. Mixed into YeelightCubePaletteCard.
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { html, unsafeHTML } from "./lib/lit-all.js";
import { nothing } from "./lit-extras.js";
import { renderGalleryMode, galleryModeStyles } from "./gallery-mode-utils.js";
import { escapeHtml } from "./html-escape-utils.js";
import { renderAlbumView } from "./album-view-coverflow.js";
import { renderCarouselString } from "./carousel-utils.js";
import {
  getExportImportButtonClass,
  getActionRowClass,
} from "./action-button-utils.js";
import { renderActionButtonContent } from "./action-button-ui.js";

export const PaletteGalleryMixin = (Base) => class extends Base {
  _renderPalettes(palettes, displayMode, options) {
    switch (displayMode) {
      case "gallery":
        return this._renderPalettesGallery(palettes, options);
      case "carousel":
        return this._renderPalettesCarousel(palettes, options);
      case "album":
      case "timeline": // Keep for backwards compatibility
        return this._renderPalettesAlbum(palettes, options);
      case "list":
      default:
        return this._renderPalettesList(palettes, options);
    }
  }

  _renderPalettesList(palettes, options) {
    const {
      showRemove,
      showPaletteTitle,
      allowTitleEdit,
      showColorCount,
      removeBtnClass,
      posClass = "",
      sideClass = "",
      globalOffset = 0,
    } = options;
    const swatchStyle = this.config.swatch_style || "square";
    const isGradientBg = swatchStyle === "gradient-bg";
    const padSide = sideClass.includes("btn-side-left")
      ? "padding-left"
      : "padding-right";

    return palettes.map((palette, localIdx) => {
      const idx = localIdx + globalOffset;
      const name = palette.name || `Palette ${idx + 1}`;
      const rowBgStyle = isGradientBg
        ? `background: linear-gradient(to right, ${palette.colors
            .map((color) => rgbToCss(color))
            .join(", ")});`
        : "";
      const minHeight = isGradientBg ? "50px" : "64px";
      const colorCountText =
        palette.colors.length === 1
          ? "1 color"
          : `${palette.colors.length} colors`;
      const colorCount =
        isGradientBg && showColorCount
          ? html`<span class="list-color-count">${colorCountText}</span>`
          : nothing;

      return html`<div
        class="palette-row palette-list-item"
        data-idx=${idx}
        role="button"
        tabindex="0"
        aria-label="Apply palette ${name}"
        style="position:relative;padding:${isGradientBg
          ? "14px 16px"
          : "8px 12px"};box-sizing:border-box;${rowBgStyle}; min-height: ${minHeight};"
        @click=${() => this._applyPalette(idx)}
      >
        <div
          style="display:flex;flex-direction:column;width:100%;${showRemove
            ? `${padSide}:40px;`
            : ""};pointer-events:none;"
        >
          ${showPaletteTitle
            ? html`<div
                class="palette-title"
                data-idx=${idx}
                style="display:flex;align-items:center;margin-bottom:${isGradientBg
                  ? "0"
                  : "4px"};width: fit-content;${allowTitleEdit
                  ? "pointer-events:auto;"
                  : ""}"
              >
                <span
                  class="title-text${allowTitleEdit ? " editable" : ""}"
                  role=${allowTitleEdit ? "button" : nothing}
                  tabindex=${allowTitleEdit ? "0" : nothing}
                  aria-label=${allowTitleEdit
                    ? `Rename palette ${name}`
                    : nothing}
                  @click=${allowTitleEdit
                    ? (event) => {
                        event.stopPropagation();
                        this._renamePalette(
                          idx,
                          event.currentTarget.textContent.trim(),
                          event.currentTarget,
                        );
                      }
                    : nothing}
                  >${name}</span
                >
                ${colorCount}
              </div>`
            : isGradientBg && showColorCount
              ? html`<div style="display:flex;align-items:center;">
                  ${colorCount}
                </div>`
              : nothing}
          <div class="palette-colors" style="pointer-events:auto;">
            ${isGradientBg
              ? nothing
              : this._paletteColorsTemplate(palette.colors, swatchStyle)}
          </div>
        </div>
        ${showRemove
          ? html`<button
              class="${removeBtnClass} palette-list-remove ${posClass} ${sideClass}"
              data-idx=${idx}
              title="Remove"
              aria-label="Remove palette ${name}"
              @click=${(event) => {
                event.stopPropagation();
                this._deletePalette(idx);
              }}
            ></button>`
          : nothing}
      </div>`;
    });
  }

  _renderPalettesGallery(palettes, options) {
    const {
      showRemove,
      showPaletteTitle,
      showColorCount,
      removeBtnClass,
      posClass = "",
      sideClass = "",
    } = options;
    const swatchStyle = this.config.swatch_style || "square";
    const swatchSize = this.config.swatch_size || 32;
    const cardSizeMultiplier = (this.config.card_size || 50) / 100;

    // Scale sizes with card multiplier
    const scaledSwatchSize = swatchSize * cardSizeMultiplier;
    const scaledGradientBarHeight = 40 * cardSizeMultiplier;
    const scaledStripesHeight = 60 * cardSizeMultiplier;

    // Render function for palette content - handles all swatch styles
    const renderPaletteContent = (palette, idx) => {
      const colorCount =
        palette.colors.length === 1
          ? "1 color"
          : `${palette.colors.length} colors`;

      // Handle different swatch styles
      if (swatchStyle === "gradient-bg") {
        // For gradient-bg, use full-width gradient bar (swapped with gradient-bar)
        const gradientColors = palette.colors
          .map((color) => rgbToCss(color))
          .join(", ");
        return `
          <div style="width: 100%; height: 100%; background: linear-gradient(to right, ${gradientColors});"></div>
          ${
            showColorCount
              ? `<div style="text-align: center; margin-top: 8px; font-size: 12px; color: var(--secondary-text-color, #666);">${colorCount}</div>`
              : ""
          }
        `;
      } else if (swatchStyle === "gradient-bar" || swatchStyle === "gradient") {
        // For gradient-bar, show actual gradient bar with padding and borders
        const gradientColors = palette.colors
          .map((color) => rgbToCss(color))
          .join(", ");
        return `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">
            <div style="width: 90%; height: ${scaledGradientBarHeight}px; background: linear-gradient(to right, ${gradientColors}); border-radius: 8px;"></div>
            ${
              showColorCount
                ? `<div style="text-align: center; font-size: 12px; color: var(--secondary-text-color, #666);">${colorCount}</div>`
                : ""
            }
          </div>
        `;
      } else if (swatchStyle === "stripes") {
        return `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">
            <div style="width: 100%; height: ${scaledStripesHeight}px; background: linear-gradient(to right, ${this._stripeGradient(
              palette.colors,
            )});"></div>
            ${
              showColorCount
                ? `<div style="text-align: center; font-size: 12px; color: var(--secondary-text-color, #666);">${colorCount}</div>`
                : ""
            }
          </div>
        `;
      } else {
        // Default: round or square swatches
        const swatchHtml = palette.colors
          .map((color) => {
            const cssColor = rgbToCss(color);
            const borderRadius = swatchStyle === "round" ? "50%" : "4px";
            return `<div style="width: ${scaledSwatchSize}px;
                                height: ${scaledSwatchSize}px;
                                background: ${cssColor};
                                border-radius: ${borderRadius};
                                box-shadow: 0 0 0 1px var(--divider-color, rgba(0,0,0,0.1));
                                flex-shrink: 0;">
                    </div>`;
          })
          .join("");

        return `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">
            <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
              ${swatchHtml}
            </div>
            ${
              showColorCount
                ? `<div style="text-align: center; font-size: 12px; color: var(--secondary-text-color, #666);">${colorCount}</div>`
                : ""
            }
          </div>
        `;
      }
    };

    // For gradient-bg mode, we need to pass gradient info
    const isGradientBg = swatchStyle === "gradient-bg";
    const isStripes = swatchStyle === "stripes";
    const isGradientBar =
      swatchStyle === "gradient" || swatchStyle === "gradient-bar";
    const palettesWithGradient = isGradientBg
      ? palettes.map((p) => ({
          ...p,
          gradientBg: p.colors.map((c) => rgbToCss(c)).join(", "),
        }))
      : palettes;

    // Item, title and delete clicks are all delegated (see _onContentClick),
    // so no handler names are passed.
    const galleryHTML = renderGalleryMode(
      palettesWithGradient,
      renderPaletteContent,
      {
        showTitle: showPaletteTitle,
        showDelete: showRemove,
        deleteButtonClass: removeBtnClass,
        posClass,
        sideClass,
        onDeleteClick: null,
        onItemClick: null,
        onTitleClick: null,
        cardSizeMultiplier: cardSizeMultiplier,
        isGradientBg: isGradientBg,
        isStripes: isStripes,
        isGradientBar: isGradientBar,
        globalOffset: options.globalOffset || 0,
        roundedCards: this.config.rounded_cards,
      },
    );

    return html`
      <style>
        ${galleryModeStyles}
      </style>
      ${unsafeHTML(galleryHTML)}
    `;
  }

  _renderPalettesAlbum(palettes, options) {
    const { showRemove, showPaletteTitle, allowTitleEdit, showColorCount } =
      options;
    const swatchStyle = this.config.swatch_style || "square";
    const isGradientBg = swatchStyle === "gradient-bg";

    // Prepare config for album view
    const albumConfig = {
      ...this.config,
      show_remove_button: showRemove,
    };

    const renderTitle = (palette, idx) =>
      showPaletteTitle
        ? `<div class="album-title" data-idx="${idx}">
                <span class="title-text${allowTitleEdit ? " editable" : ""}">${
                  escapeHtml(palette.name) || "Palette " + (idx + 1)
                }</span>
              </div>`
        : "";

    // Render function for each palette item content
    const renderPaletteContent = (palette, idx) => {
      const gradientColors = palette.colors.map((c) => rgbToCss(c)).join(", ");
      const colorCountText =
        palette.colors.length === 1
          ? "1 color"
          : `${palette.colors.length} colors`;

      // For gradient-bg mode, show large gradient section
      if (isGradientBg) {
        return `
          <div class="album-gradient" style="background: linear-gradient(135deg, ${gradientColors});"></div>
          <div class="album-content">
            ${renderTitle(palette, idx)}
            ${
              showColorCount
                ? `<div class="album-meta">${colorCountText}</div>`
                : ""
            }
          </div>
        `;
      } else {
        // For other modes, show color swatches
        return `
          <div class="album-content-container">
            ${renderTitle(palette, idx)}
            <div class="album-preview">
              ${this._renderPaletteColors(palette.colors, swatchStyle, idx)}
            </div>
            ${
              showColorCount
                ? `<div class="album-meta">${colorCountText}</div>`
                : ""
            }
          </div>
        `;
      }
    };

    // The generation comment makes a config change produce new album nodes,
    // which _setupAlbum() then binds exactly once.
    return unsafeHTML(
      `<!--palettes-album:${this._configGeneration}-->` +
        renderAlbumView(palettes, renderPaletteContent, albumConfig, "palettes"),
    );
  }

  _renderPalettesCarousel(palettes, options) {
    const {
      showRemove,
      showPaletteTitle,
      allowTitleEdit,
      showColorCount,
      removeBtnClass,
      posClass = "",
      sideClass = "",
      swatchStyle,
    } = options;

    // Initialize carousel state
    if (!this._paletteCarouselIndex) this._paletteCarouselIndex = 0;
    if (!this._paletteCarouselSlideDirection)
      this._paletteCarouselSlideDirection = 0;

    const cfg = this.config || {};
    const buttonShape = cfg.palette_carousel_button_shape || "square";

    // For gradient-bg mode, pass gradient info to be applied to carousel container
    const isGradientBg = swatchStyle === "gradient-bg";
    const currentPalette = palettes[this._paletteCarouselIndex];
    const containerGradient =
      isGradientBg && currentPalette
        ? `linear-gradient(to right, ${currentPalette.colors
            .map((c) => rgbToCss(c))
            .join(", ")})`
        : null;

    return unsafeHTML(
      renderCarouselString({
        items: palettes,
        currentIndex: this._paletteCarouselIndex,
        buttonShape,
        showAsCard: true,
        wrapNavigation: cfg.palette_carousel_wrap_navigation === true,
        carouselId: "palette-carousel",
        containerGradient: containerGradient,
        roundedCards: cfg.rounded_cards,
        renderItemString: (palette, idx) =>
          this._renderPaletteItemString(
            palette,
            idx,
            showRemove,
            showPaletteTitle,
            allowTitleEdit,
            showColorCount,
            removeBtnClass,
            posClass,
            sideClass,
            swatchStyle,
          ),
      }),
    );
  }

  _navigatePaletteCarousel(direction, maxLength) {
    const current = this._paletteCarouselIndex || 0;
    const cfg = this.config || {};
    const wrapNavigation = cfg.palette_carousel_wrap_navigation === true;

    let newIndex = current + direction;

    // Handle wrapping
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
      this._paletteCarouselSlideDirection = direction;
      this._paletteCarouselIndex = newIndex;
      this.requestUpdate();
    }
  }

  _setPaletteCarouselIndex(index) {
    const current = this._paletteCarouselIndex || 0;
    if (index !== current) {
      this._paletteCarouselSlideDirection = index > current ? 1 : -1;
      this._paletteCarouselIndex = index;
      this.requestUpdate();
    }
  }

  // Carousel item as an HTML string (renderCarouselString takes strings).
  // Title and delete clicks are handled by _onContentClick delegation.
  _renderPaletteItemString(
    palette,
    idx,
    showRemove,
    showPaletteTitle,
    allowTitleEdit,
    showColorCount,
    removeBtnClass,
    posClass,
    sideClass,
    swatchStyle,
  ) {
    const isGradientBg = swatchStyle === "gradient-bg";

    return `
      <div class="palette-item palette-item-carousel${
        isGradientBg ? " gradient-bg-mode" : ""
      }" data-idx="${idx}">
        ${
          showPaletteTitle
            ? `
                <div class="palette-title${allowTitleEdit ? " editable" : ""}">
                  ${escapeHtml(palette.name) || `Palette ${idx + 1}`}
                </div>
              `
            : ""
        }
        ${
          showRemove
            ? `
              <button
                class="palette-remove-btn ${removeBtnClass} ${posClass} ${sideClass}"
                data-idx="${idx}"
                title="Delete palette"
              ></button>
            `
            : ""
        }
        <div class="palette-colors">
          ${this._renderPaletteColors(palette.colors, swatchStyle, idx)}
        </div>
        ${
          showColorCount
            ? `
              <div class="color-count">
                ${palette.colors.length}
                color${palette.colors.length !== 1 ? "s" : ""}
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  _renderPaletteExportImportButtons(showExport, showImport) {
    if (!showExport && !showImport) return "";
    const buttonStyle = this.config.buttons_style || "modern";
    const isImportStatus = this._importStatus.active;
    const statusType = this._importStatus.success ? "success" : "error";

    const exportBtnClass = getExportImportButtonClass("export", buttonStyle);
    const importBtnClass = getExportImportButtonClass("import", buttonStyle);

    // Use config content mode, forced to icon when button style is icon
    const contentMode =
      buttonStyle === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";

    const rowClass = getActionRowClass({ buttonStyle, contentMode });

    return html`
      <div class=${rowClass}>
        ${showExport
          ? html`<button
              id="export-palettes"
              class=${exportBtnClass}
              title="Export palettes to JSON file"
              aria-label="Export palettes to JSON file"
              @click=${() => this._exportPalettes()}
            >
              ${renderActionButtonContent("mdi:download", "Export", contentMode)}
            </button>`
          : nothing}
        ${showImport
          ? html`<button
              id="import-palettes"
              class=${importBtnClass}
              title="Import palettes from JSON file"
              aria-label="Import palettes from JSON file"
              @click=${() => this._importPalettes()}
            >
              ${renderActionButtonContent(
                "mdi:upload",
                "Import",
                contentMode,
                isImportStatus,
                statusType,
              )}
            </button>`
          : nothing}
      </div>
    `;
  }
};
