// Pixel-art gallery of the draw card: the gallery / album / list / carousel /
// compact display modes, item rendering, pagination, carousel and album
// navigation, and drag-to-reorder. Mixed into YeelightCubeDrawCard.
import { html, unsafeHTML, repeat } from "./lib/lit-all.js";
import { getDeleteButtonConfig } from "./delete-button-styles.js";
import { resolveBgColor } from "./draw_utils.js";
import { renderGalleryMode, galleryModeStyles } from "./gallery-mode-utils.js";
import { escapeHtml } from "./html-escape-utils.js";
import {
  renderAlbumView,
  albumStyles,
  setupAlbumNavigation,
} from "./album-view-coverflow.js";
import { listModeStyles } from "./list-mode-utils.js";
import { renderCarousel } from "./carousel-utils.js";
import { setupCompactDragDrop } from "./compact-layout-utils.js";
import { singleMove } from "./pixel-art-utils.js";

export const PixelArtGalleryMixin = (Base) => class extends Base {
  _renderPixelArtGallery() {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this._pixelArtState(pixelartSensor)) {
      return html`
        <div class="pixelart-gallery-message">
          Pixel art sensor not found or not configured.
        </div>
      `;
    }

    const stateObj = this._pixelArtState(pixelartSensor);
    // Memoised by source array so art objects keep their identity across
    // unrelated re-renders (the per-art and gallery/album HTML caches key on it).
    const sourceArts = this._applyPendingRenames(
      stateObj.attributes.pixel_arts || [],
    );
    if (this._sanitizedArtsSource !== sourceArts) {
      this._sanitizedArtsSource = sourceArts;
      this._sanitizedArts = sourceArts.map((art) => {
        const name =
          typeof art?.name === "string"
            ? art.name.replace(/[<>]/g, "")
            : art?.name;
        return name === art?.name ? art : { ...art, name };
      });
    }
    const pixelArts = this._sanitizedArts;

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
    const showTitles = cfg.preview_show_titles !== false; // Default to true
    const allowRename = cfg.pixel_art_allow_rename === true; // Default to false

    if (!this._galleryCarouselIndex) this._galleryCarouselIndex = 0;

    return html`
      <div class="pixelart-gallery yc-stack yc-controls">
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
                    padding:0;">
            ${this._pixelArtHTML(art)}
        </div>
      `;
    };

    const galleryHTML = this._memoPixelArtHTML(
      "gallery",
      pixelArts,
      [cfg, showTitles, allowDelete, allowRename, removeBtnClass],
      () =>
        renderGalleryMode(pixelArts, renderPixelArtContent, {
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
        }),
    );

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
      // The album card width (240px at 100%) follows the preview size.
      card_size: cfg.pixel_art_preview_size || 100,
      remove_button_style: btnCfg.style,
      delete_button_shape: btnCfg.shape,
      delete_button_inside: btnCfg.inside,
      delete_button_left: btnCfg.left,
    };

    // Render function for each pixel art item content
    const renderPixelArtContent = (art, idx) => {
      return `
        <div class="album-content-container">
          ${
            showTitles
              ? `
            <div class="album-title">
              <span class="title-text${
                allowRename ? " editable" : ""
              }" data-index="${idx}">
                ${escapeHtml(art.name) || "Unnamed"}
              </span>
            </div>
          `
              : ""
          }
          <div class="album-preview pixelart-preview-album"
               style="padding:0;background:transparent;"
               data-index="${idx}">
            ${this._pixelArtHTML(art)}
          </div>
        </div>
      `;
    };

    // Get album HTML using shared utility
    const albumHTML = this._memoPixelArtHTML(
      "album",
      pixelArts,
      [cfg, showTitles, allowDelete, allowRename],
      () =>
        renderAlbumView(
          pixelArts,
          renderPixelArtContent,
          albumConfig,
          "pixelarts",
        ),
    );

    // Return unsafeHTML wrapped content
    return html`
      <style>
        ${albumStyles("pixelarts")}

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
        /* When the title is hidden the preview is the only in-flow content;
           centre it in the row (it would otherwise be left-aligned) and scale
           from the centre so it stays centred at any preview size. The title's
           delete-button padding is dropped too, since there is no title text to
           protect from the (absolutely positioned) delete button. */
        .pixelart-list-item .list-item-content:not(:has(.list-item-name)) {
          justify-content: center;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        .pixelart-list-item
          .list-item-content:not(:has(.list-item-name))
          .list-item-preview {
          transform-origin: center center;
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
                      style="width:250px;max-width:100%;padding:0;background:transparent;"
                      title="Click to apply to drawing matrix${autoApplyToLamp
                        ? " and lamp"
                        : ""}"
                    >
                      ${unsafeHTML(this._pixelArtHTML(art))}
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
                style="padding:0;background:transparent;
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
                ${unsafeHTML(this._pixelArtHTML(art))}
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
              style="padding:0;background:transparent;
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
              ${unsafeHTML(this._pixelArtHTML(art))}
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

    if (!this.hass || !pixelartSensor || !this._pixelArtState(pixelartSensor)) {
      return;
    }

    const stateObj = this._pixelArtState(pixelartSensor);
    let pixelArts = stateObj.attributes.pixel_arts || [];

    // CRITICAL FIX: Trim stale array to match count attribute
    // Websocket doesn't send full array updates, only scalar attributes like 'count'
    const expectedCount = stateObj.attributes.count || pixelArts.length;
    if (pixelArts.length > expectedCount) {
      pixelArts = pixelArts.slice(0, expectedCount);
    }

    if (pixelArts.length === 0) return;

    // The album DOM comes from unsafeHTML, which keeps the same nodes while the
    // generated HTML is unchanged. updated() calls us on every hass change, so
    // without a guard the item/delete/swipe/rename listeners would stack on
    // those persisting nodes (e.g. one delete click deleting several arts).
    // Only (re)bind when the container is new or the config object changed.
    const albumContainer = this.shadowRoot.getElementById(
      "pixelarts-album-container",
    );
    if (albumContainer && albumContainer._yeelightAlbumBoundCfg === cfg) {
      return;
    }
    if (albumContainer) albumContainer._yeelightAlbumBoundCfg = cfg;

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
        // Bind once per element: these nodes persist across updates.
        if (titleEl.dataset.renameBound === "1") return;
        titleEl.dataset.renameBound = "1";
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

    if (!this.hass || !pixelartSensor || !this._pixelArtState(pixelartSensor)) {
      return;
    }

    const container = this.shadowRoot.querySelector(".compact-container");
    if (!container) {
      return;
    }

    // setupCompactDragDrop adds per-item listeners with no removal API and
    // updated() calls us on every hass change; skip when every item already
    // has listeners so they don't stack on nodes that persisted.
    const compactItems = Array.from(
      container.querySelectorAll(".compact-item"),
    );
    if (
      compactItems.length > 0 &&
      compactItems.every((item) => item.dataset.compactDragBound === "1")
    ) {
      return;
    }
    compactItems.forEach((item) => {
      item.dataset.compactDragBound = "1";
    });

    // Setup drag-and-drop using shared utility
    setupCompactDragDrop(
      container,
      ".compact-item",
      (newOrder) => {
        // Get current pixel arts
        const stateObj = this._pixelArtState(pixelartSensor);
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
          // until the websocket confirms the reorder (expires after 5s — see set hass)
          this._pendingReorderedPixelArts = reorderedPixelArts;
          this._pendingReorderTs = Date.now();

          this._saveReorderedPixelArts(
            reorderedPixelArts,
            singleMove(newOrder, pixelArts),
          );
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
};
