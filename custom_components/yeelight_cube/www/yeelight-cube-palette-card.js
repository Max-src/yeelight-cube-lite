import { LitElement, html, unsafeHTML } from "./lib/lit-all.js";
import { getActionRowClass } from "./action-button-utils.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { escapeHtml } from "./html-escape-utils.js";
import { compactModeStyles } from "./compact-mode-styles.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import {
  deleteButtonStyles,
  deleteButtonPositionStyles,
  getDeleteButtonConfig,
} from "./delete-button-styles.js";
import {
  exportImportButtonStyles,
  renderButtonContent,
  getExportImportButtonClass,
} from "./action-button-utils.js";
import {
  getAlbumStyles,
  renderAlbumView,
  setupAlbumNavigation,
} from "./album-view-coverflow.js";
import {
  renderCarouselString,
  carouselStyles,
  attachCarouselSwipe,
} from "./carousel-utils.js";
import { gridModeStyles } from "./grid-mode-utils.js";
import { galleryModeStyles, renderGalleryMode } from "./gallery-mode-utils.js";
import { callServiceOnTargetEntities as callServiceSequentially } from "./service-call-utils.js";
import { CollectionState } from "./collection-state.js";
import { notify, notifyUnreported } from "./notify-utils.js";
import {
  normalizeImportedPalettes,
  MAX_PALETTE_IMPORT_BYTES,
} from "./palette-data-utils.js";
import { paginationStyles, renderPagination } from "./pagination-utils.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";

// lit-all.js does not re-export `nothing`; Lit defines it as this global symbol.
const nothing = Symbol.for("lit-nothing");

// renderGalleryMode() only renders the delete button together with an inline
// onclick handler; the card handles that click by delegation instead, so the
// generated handler is stripped (handleGalleryDelete stays as a fallback).
const GALLERY_INLINE_DELETE =
  /\s*onclick="event\.stopPropagation\(\); this\.getRootNode\(\)\.host\.handleGalleryDelete\(event, \d+\);"/g;

const isActivationKey = (event) =>
  event.key === "Enter" || event.key === " " || event.key === "Spacebar";

class YeelightCubePaletteCard extends LitElement {
  constructor() {
    super();
    this._hass = null;
    this.config = {};
    this._importStatus = { active: false, success: false };
    this._deletionInProgress = false; // Prevent re-render during album deletion
    this._currentPalettePage = 0; // Pagination state
    // Bumped by setConfig so the album markup (whose listeners are bound by
    // the shared coverflow helper) is recreated, never re-bound, on changes.
    this._configGeneration = 0;
    // Capture-phase delegated click handler for markup produced as HTML
    // strings by shared helpers (gallery, carousel, album, pagination).
    this._contentClick = {
      handleEvent: (event) => this._onContentClick(event),
      capture: true,
    };
  }

  // Swatches as an HTML string, for the shared helpers that take strings
  // (album, carousel). Colours come from rgbToCss, which only emits rgb().
  _renderPaletteColors(colors, style = "square", idx) {
    switch (style) {
      case "round":
        return colors
          .map(
            (color) =>
              `<span class="palette-color round-swatch" style="background:${rgbToCss(
                color,
              )};"></span>`,
          )
          .join("");

      case "gradient":
        const gradientColors = colors
          .map((color) => rgbToCss(color))
          .join(", ");
        return `<div class="gradient-bar" style="background: linear-gradient(to right, ${gradientColors});"></div>`;

      case "stripes":
        return `<div class="stripes-bar" style="background: linear-gradient(to right, ${this._stripeGradient(
          colors,
        )});"></div>`;

      case "gradient-bg":
        // Return a special marker that signals the row should have gradient background
        return `<div class="gradient-bg-marker" data-gradient="${colors
          .map((color) => rgbToCss(color))
          .join(", ")}"></div>`;

      case "square":
      default:
        return colors
          .map(
            (color) =>
              `<span class="palette-color square-swatch" style="background:${rgbToCss(
                color,
              )};"></span>`,
          )
          .join("");
    }
  }

  // Same swatches as a Lit template, for the card's own list markup.
  _paletteColorsTemplate(colors, style = "square") {
    switch (style) {
      case "round":
      case "square":
      default: {
        const swatch = style === "round" ? "round-swatch" : "square-swatch";
        return colors.map(
          (color) =>
            html`<span
              class="palette-color ${swatch}"
              style="background:${rgbToCss(color)};"
            ></span>`,
        );
      }
      case "gradient":
        return html`<div
          class="gradient-bar"
          style="background: linear-gradient(to right, ${colors
            .map((color) => rgbToCss(color))
            .join(", ")});"
        ></div>`;
      case "stripes":
        return html`<div
          class="stripes-bar"
          style="background: linear-gradient(to right, ${this._stripeGradient(
            colors,
          )});"
        ></div>`;
      case "gradient-bg":
        return html`<div
          class="gradient-bg-marker"
          data-gradient=${colors.map((color) => rgbToCss(color)).join(", ")}
        ></div>`;
    }
  }

  _stripeGradient(colors) {
    const stripePercent = 100 / colors.length;
    return colors
      .map((color, i) => {
        const start = i * stripePercent;
        const end = (i + 1) * stripePercent;
        return `${rgbToCss(color)} ${start}% ${end}%`;
      })
      .join(", ");
  }

  setConfig(config) {
    this._collection?.reset();
    // target_entities is deliberately not defaulted: an empty array counts as
    // "configured" for the service helper and would override `entity`.
    this.config = {
      palette_sensor: config.palette_sensor,
      ...config,
    };

    // Auto-resolve palette_sensor if not explicitly configured
    if (!this.config.palette_sensor && this._hass) {
      const autoSensor = Object.keys(this._hass.states || {}).find(
        (e) => e.startsWith("sensor.") && e.includes("color_palettes"),
      );
      if (autoSensor) {
        this.config = { ...this.config, palette_sensor: autoSensor };
      }
    }

    this._configGeneration++;
    this.requestUpdate();
  }

  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-palette-card-editor")) {
      await import("./yeelight-cube-palette-card-editor.js");
    }
    return document.createElement("yeelight-cube-palette-card-editor");
  }
  static getStubConfig(hass) {
    const firstEntity =
      Object.keys(hass?.states || {}).find(
        (e) =>
          e.startsWith("light.yeelight_cube") ||
          e.startsWith("light.cubelite_"),
      ) || "";
    return {
      type: "custom:yeelight-cube-palette-card",
      target_entities: firstEntity ? [firstEntity] : [],
      swatch_style: "gradient-bg",
      display_mode: "album",
      remove_button_style: "none",
      show_color_count: false,
      buttons_style: "gradient",
      card_size: 50,
      items_per_page: 12,
      delete_button_inside: false,
    };
  }

  get hass() {
    return this._hass;
  }

  /**
   * Handle Home Assistant state changes
   *
   * CRITICAL ARCHITECTURE NOTE:
   * This setter is called whenever Home Assistant sends a state update via websocket.
   * However, HA has a limitation: when sensor attribute arrays are large (>100 items),
   * the websocket only sends scalar attribute updates (count, hash) but NOT the full
   * array data (palettes_v2). This causes stale data issues.
   *
   * DELETION FLOW:
   * 1. User clicks delete → _deletePalette() filters array client-side → renders immediately
   * 2. CollectionState stores the optimistic array and its timestamp
   * 3. Backend service deletes item → fires event → sensor updates count/hash
   * 4. Websocket sends: {count: 16, hash: <new>} but palettes_v2: <stale 17-item array>
   * 5. This setter confirms the full array before retiring the overlay
   *
   * CACHE MANAGEMENT:
   * - Cache cleared when the full sensor array matches the optimistic snapshot
   * - Cache expires after 5 seconds (navigated away and back)
   * - HA state remains available while the collection overlay is active
   *
   * The card has no reactive properties: updates are requested explicitly here
   * so unrelated hass updates (other entities) never re-render it.
   */
  set hass(hass) {
    this._hass = hass;

    // Auto-resolve palette_sensor on first hass set (setConfig may run before hass is available)
    if (this.config && !this.config.palette_sensor && hass) {
      const autoSensor = Object.keys(hass.states || {}).find(
        (e) => e.startsWith("sensor.") && e.includes("color_palettes"),
      );
      if (autoSensor) {
        this.config = { ...this.config, palette_sensor: autoSensor };
      }
    }

    const entityId = this.config?.palette_sensor;
    if (!entityId || !hass) return;

    // Detect changes using the sensor's content_hash. Unlike a plain count,
    // the hash also changes on renames and reorders, so the card refreshes for
    // every kind of palette change -- not just additions/deletions.
    const stateObj = hass.states[entityId];
    const sensorArr = Array.isArray(stateObj?.attributes?.palettes_v2)
      ? stateObj.attributes.palettes_v2
      : Array.isArray(stateObj?.attributes?.palettes)
        ? stateObj.attributes.palettes
        : [];
    const sensorCount = stateObj?.attributes?.count ?? sensorArr.length;
    const currHash =
      stateObj?.attributes?.content_hash ?? `count:${sensorCount}`;
    const prevHash = this._lastPaletteHash;
    const isFirstLoad = prevHash === undefined;

    // While an optimistic local cache is active (just after a delete), keep
    // showing the correctly-filtered local list until the sensor has fully
    // caught up. Confirmation requires the full authoritative array to match.
    // The websocket can deliver an updated `count`
    // a beat before the full `palettes_v2` array converges, so checking both
    // avoids briefly re-rendering the stale (pre-delete) array -- which would
    // make the just-deleted item flash back into the list.
    if (this._localPalettes !== undefined) {
      this._collection.observe(sensorArr, sensorCount);
      if (this._localPalettes === undefined) {
        this._lastPaletteHash = currHash;
        if (!this._deletionInProgress) {
          this.requestUpdate();
        }
      }
      // Otherwise keep displaying the optimistic list -- do not render the
      // sensor data yet, it is still mid-update.
      return;
    }

    // Block re-render during album deletion (after cache check)
    if (this._deletionInProgress) {
      return;
    }

    if (prevHash !== currHash || isFirstLoad) {
      this._lastPaletteHash = currHash;
      this.requestUpdate();
    }
  }

  _sensorPalettes() {
    const attributes =
      this._hass?.states?.[this.config.palette_sensor]?.attributes;
    return Array.isArray(attributes?.palettes_v2)
      ? attributes.palettes_v2
      : Array.isArray(attributes?.palettes)
        ? attributes.palettes
        : [];
  }

  _allowTitleEdit() {
    return (
      this.config.show_palette_title !== false &&
      this.config.allow_title_edit === true
    );
  }

  /**
   * Render the palette card
   *
   * DATA SOURCE:
   * Renders from the optimistic local cache (`_localPalettes`) while a deletion
   * is being confirmed, otherwise straight from the sensor's authoritative
   * `palettes_v2` array. The cache lifecycle (creation on delete, clearing once
   * the sensor array has converged) is handled in the `hass` setter, so render()
   * just trusts whichever source is current.
   */
  render() {
    const hass = this._hass;
    const entityId = this.config.palette_sensor;
    if (!hass || !entityId) {
      return nothing;
    }
    const stateObj = hass.states[entityId];
    if (!stateObj) {
      return html`<ha-card>Palette sensor not found</ha-card>`;
    }

    const palettes =
      this._localPalettes !== undefined
        ? this._localPalettes
        : this._sensorPalettes();

    const showCard = this.config.show_card_background !== false;
    const btnCfg = getDeleteButtonConfig(this.config);
    const showRemove = btnCfg.allowDelete;
    const removeBtnClass = btnCfg.classes;
    const showExport = this.config.show_export_button !== false;
    const showImport = this.config.show_import_button !== false;
    const showPaletteTitle = this.config.show_palette_title !== false;
    const showColorCount = this.config.show_color_count !== false;
    const allowTitleEdit = this._allowTitleEdit();

    const cardTitle =
      typeof this.config.title === "string" ? this.config.title : "";
    const displayMode = this.config.display_mode || "list";
    const borderMode = this.config.item_card_border || "auto";
    const isDark =
      this._hass?.themes?.darkMode ??
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ??
      false;
    const showItemBorder =
      borderMode === "always" || (borderMode === "auto" && isDark);

    let content;
    if (palettes.length === 0) {
      content = html`<div
        style="padding:16px;color:var(--secondary-text-color, #888);"
      >
        No palettes found. Add palettes to see them here.
      </div>`;
    } else {
      // Pagination: slice palettes for list/gallery modes
      const itemsPerPage = parseInt(this.config.items_per_page) || 0;
      const usePagination =
        itemsPerPage > 0 &&
        (displayMode === "list" || displayMode === "gallery");
      let displayPalettes = palettes;
      let paginationHtml = "";
      if (usePagination) {
        const result = renderPagination({
          items: palettes,
          currentPage: this._currentPalettePage,
          itemsPerPage,
        });
        displayPalettes = result.items;
        paginationHtml = result.html;
        this._currentPalettePage = result.currentPage;
      }
      content = html`${this._renderPalettes(displayPalettes, displayMode, {
        showRemove,
        showPaletteTitle,
        allowTitleEdit,
        showColorCount,
        removeBtnClass,
        posClass: btnCfg.posClass,
        sideClass: btnCfg.sideClass,
        swatchStyle: this.config.swatch_style || "square",
        globalOffset: usePagination
          ? this._currentPalettePage * itemsPerPage
          : 0,
      })}${paginationHtml ? unsafeHTML(paginationHtml) : nothing}`;
    }

    const body = html`<div
      class="card-content yc-stack${showItemBorder ? " item-card-border" : ""}"
      @click=${this._contentClick}
      @keydown=${this._onContentKeydown}
    >
      ${content}${this._renderPaletteExportImportButtons(
        showExport,
        showImport,
      )}
    </div>`;

    return html`
      <style>
        ${this._styles(allowTitleEdit)}
      </style>
      ${showCard
        ? html`<ha-card header=${cardTitle || nothing}>${body}</ha-card>`
        : html`<div class="yc-stack">
            ${cardTitle
              ? html`<div
                  id="card-title"
                  style="font-weight:600;font-size:1.1em;padding:16px 16px 0;${allowTitleEdit
                    ? "cursor:pointer;"
                    : ""}"
                  role=${allowTitleEdit ? "button" : nothing}
                  tabindex=${allowTitleEdit ? "0" : nothing}
                  @click=${allowTitleEdit
                    ? (event) => this._editCardTitle(event.currentTarget)
                    : nothing}
                  @keydown=${allowTitleEdit ? this._onContentKeydown : nothing}
                >
                  ${cardTitle}
                </div>`
              : nothing}${body}
          </div>`}
    `;
  }

  _styles(allowTitleEdit) {
    return `
        ${cardLayoutStyles}
        /* Shared Compact Mode Styles */
        ${compactModeStyles}

        /* Shared Delete Button Styles */
        ${deleteButtonStyles}
        ${deleteButtonPositionStyles}

        /* Shared Export/Import Button Styles */
        ${exportImportButtonStyles}

        /* Shared Carousel Styles */
        ${carouselStyles}

        /* Shared Grid Mode Styles */
        ${gridModeStyles}

        :host {
          --card-size-multiplier: ${(this.config.card_size || 50) / 100};
          --rounded-cards-radius: ${(() => {
            const v = this.config.rounded_cards;
            if (v === undefined || v === true || v === "round") return 16;
            if (v === false || v === "square") return 0;
            if (v === "rounded") return 4;
            return typeof v === "number" ? v : parseInt(v, 10) || 16;
          })()}px;
          overflow: visible !important;
        }
        ha-card {
          overflow: visible !important;
        }
        .card-title { font-size: 1.3em; font-weight: bold; margin-bottom: 18px; margin-top: 2px; color: var(--primary-text-color, #222); cursor: ${
          allowTitleEdit ? "pointer" : "default"
        }; }
        .palette-row {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          margin-inline: auto;
          background: var(--secondary-background-color, #fafbfc);
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: var(--rounded-cards-radius, 16px);
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          padding: 6px 12px;
          position: relative;
          width: 100%;
          max-width: calc(100% * var(--card-size-multiplier) * 2);
          box-sizing: border-box;
          transition: max-width 0.2s ease;
        }
        .palette-title {
          font-weight: 500;
          color: var(--primary-text-color, #333);
          cursor: default;
          margin-bottom: 4px;
        }
        .title-text {
          display: inline-block;
/*           padding: 2px 4px;
          border-radius: 4px; */
        }
        .title-text.editable {
          cursor: pointer;
          transition: opacity 0.2s ease;
        }
        .title-text.editable:hover {
          opacity: 0.8;
        }
        .palette-colors {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          justify-content: flex-start;
/*           margin-bottom: 8px; */
        }
        .palette-color {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          box-shadow: 0 0 0 1px var(--divider-color, #ccc);
        }
        /* Swatch Styles */
        .square-swatch {
          width: calc(28px * var(--card-size-multiplier));
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 6px;
          display: inline-block;
          box-shadow: 0 0 0 1px var(--divider-color, #ddd);
          margin: 1px;
          transition: width 0.2s ease, height 0.2s ease;
        }
        .round-swatch {
          width: calc(28px * var(--card-size-multiplier));
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 0 1px var(--divider-color, #ddd);
          margin: 1px;
          transition: width 0.2s ease, height 0.2s ease;
        }
        .gradient-bar {
          width: 100%;
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 14px;
          box-shadow: 0 0 0 1px var(--divider-color, #ddd);
          margin: 2px 0;
          transition: height 0.2s ease;
        }
        .stripes-bar {
          width: 100%;
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 6px;
          box-shadow: 0 0 0 1px var(--divider-color, #ddd);
          margin: 2px 0;
          transition: height 0.2s ease;
        }
        /* Gradient background styles - Modern and cool design */
        .palette-row[style*="background: linear-gradient"] {
          color: var(--text-primary-color, #fff);
          border: none !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.2) !important;
          border-radius: 16px !important;
          overflow: hidden;
          position: relative;
        }
        .palette-row[style*="background: linear-gradient"]::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 100%);
          pointer-events: none;
          z-index: 1;
        }
        .palette-row[style*="background: linear-gradient"]:hover {
          box-shadow: 0 6px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.3) !important;
          transform: translateY(-2px);
          background-color: transparent !important;
        }
        .palette-row[style*="background: linear-gradient"] .palette-title {
          color: var(--text-primary-color, #fff);
          font-weight: 700;
          font-size: 1.1em;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          letter-spacing: 0.3px;
          position: relative;
          z-index: 2;
        }
        .palette-row[style*="background: linear-gradient"] .list-color-count {
          color: rgba(255,255,255,0.95);
          font-size: 0.85em;
          font-weight: 500;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
          margin-left: 12px;
          background: rgba(0,0,0,0.15);
          padding: 3px 10px;
          border-radius: 12px;
          backdrop-filter: blur(4px);
          position: relative;
          z-index: 2;
        }
        .palette-row[style*="background: linear-gradient"] .remove-btn {
          background: rgba(255,255,255,0.25);
          backdrop-filter: blur(8px);
          color: var(--text-primary-color, #fff);
          font-weight: 600;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 8px;
          padding: 4px 12px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.2);
          transition: all 0.2s ease;
          position: relative;
          z-index: 2;
        }
        .palette-row[style*="background: linear-gradient"] .remove-btn:hover {
          background: rgba(255,255,255,0.35);
          border-color: rgba(255,255,255,0.5);
          transform: scale(1.05);
        }
        .palette-row[style*="background: linear-gradient"] .remove-btn-cross {
          color: var(--text-primary-color, #fff);
          background: rgba(0,0,0,0.2);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.25);
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3em;
          font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
          transition: all 0.2s ease;
          position: absolute;
          /* z-index: 1000; */
          pointer-events: auto;
        }
        /* Style variants inherited from delete-button-styles.js */
        .palette-row[style*="background: linear-gradient"] .remove-btn-cross:hover {
          background: rgba(255,255,255,0.25);
          border-color: rgba(255,255,255,0.4);
          transform: scale(1.1);
          color: color-mix(in srgb, var(--error-color, #f44336) 15%, var(--text-primary-color, #fff));
        }
        .palette-row {
          cursor: pointer;
          transition: background-color 0.1s ease, box-shadow 0.1s ease;
        }
        .palette-row:hover {
          background-color: var(--secondary-background-color, #f0f4f8);
          box-shadow: 0 3px 12px rgba(0,0,0,0.08);
        }
        .palette-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 4px;
        }
        .remove-btn { background: color-mix(in srgb, var(--error-color, #db4437) 15%, var(--card-background-color, #fff)); border: none; border-radius: 6px; color: var(--error-color, #db4437); padding: 6px 18px; cursor: pointer; font-size: 1em; font-weight: 500; transition: background 0.2s; }
        .remove-btn:hover { background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff)); }
        /* Style variants inherited from delete-button-styles.js */

        /* ── Palette list & carousel: remove button position ── */
        .palette-list-remove {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 10;
        }
        .palette-list-remove.btn-pos-inside {
          top: 6px;
          right: 6px;
        }
        .palette-list-remove.btn-pos-outside {
          top: -8px;
          right: -8px;
        }
        .palette-list-remove.dot-style.btn-pos-outside {
          top: -4px;
          right: -4px;
        }
        .palette-list-remove.btn-side-left {
          right: auto !important;
          left: 8px;
        }
        .palette-list-remove.btn-pos-inside.btn-side-left {
          left: 6px;
        }
        .palette-list-remove.btn-pos-outside.btn-side-left {
          left: -8px;
        }
        .palette-list-remove.dot-style.btn-pos-outside.btn-side-left {
          left: -4px;
        }
        /* Allow outside buttons to overflow list item bounds */
        .palette-list-item:has(.btn-pos-outside) {
          overflow: visible !important;
        }

        .palette-remove-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 10;
        }
        .palette-remove-btn.btn-pos-inside {
          top: 6px;
          right: 6px;
        }
        .palette-remove-btn.btn-pos-outside {
          top: -8px;
          right: -8px;
        }
        .palette-remove-btn.dot-style.btn-pos-outside {
          top: -4px;
          right: -4px;
        }
        .palette-remove-btn.btn-side-left {
          right: auto !important;
          left: 8px;
        }
        .palette-remove-btn.btn-pos-inside.btn-side-left {
          left: 6px;
        }
        .palette-remove-btn.btn-pos-outside.btn-side-left {
          left: -8px;
        }
        .palette-remove-btn.dot-style.btn-pos-outside.btn-side-left {
          left: -4px;
        }

        /* Display Mode Styles */
        /* Palette-specific grid styles (base grid styles from grid-mode-utils.js) */
        .grid-item .palette-colors {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          justify-content: flex-start;
        }

        /* Compact Mode - List with Dividers */
        .palettes-compact {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(calc(250px * var(--card-size-multiplier)), 1fr));
          gap: 0;
          margin-bottom: 16px;
          /* border: 1px solid #e1e4e8; */
        }
        .palette-compact-item {
          background: transparent;
          border: none;
          border: 1px solid var(--divider-color, #e1e4e8);
          padding: calc(10px * var(--card-size-multiplier)) calc(8px * var(--card-size-multiplier));
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: relative;
          cursor: pointer;
          transition: background 0.15s, padding 0.2s ease;
          box-sizing: border-box;
        }
        .palette-compact-item:hover {
          background: var(--secondary-background-color, #f6f8fa);
        }
        .palette-compact-item .compact-info {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
          align-items: flex-start;
          width: 100%;
        }
        .palette-compact-item .compact-header {
          display: flex;
          align-items: baseline;
          gap: 8px;
          width: 100%;
        }
        .palette-compact-item .compact-name {
          font-weight: 500;
          color: var(--primary-text-color, #24292f);
          font-size: 0.95em;
        }
        .palette-compact-item .compact-meta {
          font-size: 0.8em;
          color: var(--secondary-text-color, #57606a);
          white-space: nowrap;
        }
        .palette-compact-item .compact-colors-display {
          display: flex;
          gap: 5px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 2px;
          width: 100%;
          justify-content: center;
        }
        .palette-compact-item .compact-more {
          font-size: 0.75em;
          color: var(--secondary-text-color, #57606a);
          margin-left: 4px;
        }
        /* Legacy compact swatches (not used anymore but kept for compatibility) */
        .palette-compact-item .compact-colors {
          display: flex;
          gap: 5px;
          align-items: center;
        }
        .palette-compact-item .compact-swatch {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          border: 1.5px solid var(--divider-color, rgba(0,0,0,0.1));
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        /* Compact gradient mode */
        .palette-compact-gradient {
          position: relative;
          padding: calc(12px * var(--card-size-multiplier)) calc(12px * var(--card-size-multiplier)) !important;
          min-height: calc(60px * var(--card-size-multiplier));
          border: none !important;
          transition: transform 0.15s, box-shadow 0.15s, padding 0.2s ease, min-height 0.2s ease;
        }
        .palette-compact-gradient:hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .palette-compact-gradient .compact-gradient-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          pointer-events: none;
        }
        .palette-compact-gradient .compact-name {
          color: var(--text-primary-color, #fff);
          text-shadow: 1px 1px 3px rgba(0,0,0,0.5);
          font-weight: 600;
          font-size: 1em;
        }
        .palette-compact-gradient .compact-meta {
          color: rgba(255,255,255,0.95);
          font-size: 0.8em;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.4);
        }
        .palette-compact-item .remove-btn {
          padding: 4px 10px;
          font-size: 0.7em;
        }
        .palette-compact-item .remove-btn-cross {
          background: transparent;
          border: none;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--error-color, #d73a49);
          font-size: 1.4em;
          font-weight: bold;
          transition: opacity 0.15s, background 0.15s;
          flex-shrink: 0;
          position: absolute;
          top: 8px;
          right: 8px;
        }
        .palette-compact-item .remove-btn-cross:hover {
          opacity: 1;
          background: rgba(215, 58, 73, 0.1);
        }
        .palette-compact-gradient .remove-btn-cross {
          color: rgba(255, 255, 255, 0.9);
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
          position: absolute;
          /* z-index: 1000; */
          pointer-events: auto;
          background: rgba(0,0,0,0.2);
          border: 1px solid rgba(255,255,255,0.25);
        }
        /* Style variants inherited from delete-button-styles.js */
        .palette-compact-gradient .remove-btn-cross:hover {
          background: rgba(0, 0, 0, 0.25);
          border-color: rgba(0,0,0,0.4);
          color: var(--text-primary-color, #fff);
          opacity: 1;
        }

        /* Album Mode - Cover Flow Style - Use shared styles */
        ${getAlbumStyles(this.config, "palettes")}

        /* Album card size — driven by the "Display Card Size" slider, aligned
         * with the pixel-art album feature. getAlbumStyles() (shared module)
         * already scales the width, but this rule is emitted from the palette
         * card's own (always-fresh) style block so the slider takes effect
         * immediately and independently of the shared module's cache state.
         * Width scales from the 240px baseline (100%), clamped 30–200%;
         * margin-left is half the width to keep the card centred in the
         * coverflow. Same formula as the pixel-art album. */
        .palettes-album-item {
          width: ${Math.round(
            (240 * Math.max(30, Math.min(200, this.config.card_size || 50))) /
              100,
          )}px !important;
          margin-left: -${Math.round(
            (120 * Math.max(30, Math.min(200, this.config.card_size || 50))) /
              100,
          )}px !important;
        }

        /* Additional palette-specific album styles */
        .palettes-album-item .album-gradient {
          height: 55%;
          min-height: 125px;
          position: relative;
          transition: height 0.2s ease;
          flex-shrink: 1;
          border-radius: ${(() => {
            const v = this.config.rounded_cards;
            const r =
              v === undefined || v === true || v === "round"
                ? 16
                : v === false || v === "square"
                  ? 0
                  : v === "rounded"
                    ? 4
                    : typeof v === "number"
                      ? v
                      : parseInt(v, 10) || 16;
            return `${r}px ${r}px 0 0`;
          })()};
          overflow: hidden;
        }
        .palettes-album-item .album-content {
          padding: max(4px, 5%) max(4px, 4%);
          min-height: 40px;
          background: var(--card-background-color, white);
          border-radius: ${(() => {
            const v = this.config.rounded_cards;
            const r =
              v === undefined || v === true || v === "round"
                ? 16
                : v === false || v === "square"
                  ? 0
                  : v === "rounded"
                    ? 4
                    : typeof v === "number"
                      ? v
                      : parseInt(v, 10) || 16;
            return `0 0 ${r}px ${r}px`;
          })()};
          transition: padding 0.2s ease;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          box-sizing: border-box;
        }
        
        /* Album mode - non-gradient swatch styles */
        .palettes-album-item .album-content-container {
          width: 100%;
          height: 100%;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-sizing: border-box;
          background: var(--card-background-color, white);
        }
        
        .palettes-album-item .album-title {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-text-color, #333);
          text-align: center;
          margin-bottom: 4px;
        }
        
        .palettes-album-item .album-preview {
          flex: 1;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px;
        }
        
        .palettes-album-item .album-preview .square-swatch,
        .palettes-album-item .album-preview .round-swatch {
          width: 28px;
          height: 28px;
          margin: 2px;
          flex-shrink: 0;
        }
        
        .palettes-album-item .album-preview .gradient-bar,
        .palettes-album-item .album-preview .stripes-bar {
          width: calc(100% - 8px);
          height: 24px;
          margin: 3px 0;
        }
        
        .palettes-album-item .album-meta {
          font-size: 0.75em;
          color: var(--secondary-text-color, #666);
          text-align: center;
        }
        
        /* Carousel Mode Specific Styles */
        .palette-item-carousel {
          display: flex;
          flex-direction: column;
          /* min-height: 250px; */
          position: relative;
          cursor: pointer;
        }
        
        .palette-item-carousel .palette-title {
          font-size: 1.2em;
          font-weight: 600;
          text-align: center;
          margin-bottom: calc(20px * var(--card-size-multiplier));
          color: var(--primary-text-color, #333);
          transition: margin-bottom 0.2s ease;
        }
        
        .carousel-content-card .palette-remove-btn {
          position: absolute !important;
          top: -10px !important;
          right: -10px !important;
          z-index: 100 !important;
          margin: 0 !important;
          pointer-events: auto !important;
        }
        /* Make palette-item-carousel static so button positions relative to carousel-content-card */
        .carousel-content-card .palette-item-carousel {
          position: static;
        }
        .carousel-content-card .palette-remove-btn.btn-pos-inside {
          top: 12px !important;
          right: 12px !important;
        }
        .carousel-content-card .palette-remove-btn.btn-side-left {
          right: auto !important;
          left: -10px !important;
        }
        .carousel-content-card .palette-remove-btn.btn-pos-inside.btn-side-left {
          left: 12px !important;
        }
        .carousel-content-card .palette-remove-btn.dot-style {
          top: -4px !important;
          right: -4px !important;
        }
        .carousel-content-card .palette-remove-btn.dot-style.btn-pos-inside {
          top: 4px !important;
          right: 4px !important;
        }
        .carousel-content-card .palette-remove-btn.dot-style.btn-side-left {
          right: auto !important;
          left: -4px !important;
        }
        .carousel-content-card .palette-remove-btn.dot-style.btn-pos-inside.btn-side-left {
          left: 4px !important;
        }
        
        .palette-item-carousel .palette-colors {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: calc(8px * var(--card-size-multiplier));
          flex: 1;
          align-items: center;
          transition: gap 0.2s ease;
        }
        
        /* Carousel swatch styles - let specific classes control border-radius */
        .palette-item-carousel .square-swatch,
        .palette-item-carousel .round-swatch {
          width: calc(40px * var(--card-size-multiplier));
          height: calc(40px * var(--card-size-multiplier));
          box-shadow: 0 2px 4px rgba(0,0,0,0.1), 0 0 0 1px var(--divider-color, #ddd);
          transition: width 0.2s ease, height 0.2s ease;
        }
        
        .palette-item-carousel .square-swatch {
          border-radius: calc(8px * var(--card-size-multiplier));
        }
        
        .palette-item-carousel .round-swatch {
          border-radius: 50%;
        }
        
        .palette-item-carousel .gradient-bar,
        .palette-item-carousel .stripes-bar {
          width: 100%;
          height: calc(40px * var(--card-size-multiplier));
          border-radius: calc(8px * var(--card-size-multiplier));
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          transition: height 0.2s ease, border-radius 0.2s ease;
        }
        
        /* Gradient background support for carousel - applied to container */
        .carousel-content-card.gradient-bg-mode {
          background: var(--carousel-gradient-bg);
          border: none !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
          overflow: hidden;
        }
        
        .carousel-content-card.gradient-bg-mode .palette-title {
          color: var(--text-primary-color, #fff);
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          font-weight: 700;
        }
        
        .carousel-content-card.gradient-bg-mode .color-count {
          color: rgba(255,255,255,0.95);
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
          border-top-color: rgba(255,255,255,0.3);
        }
        
        .carousel-content-card.gradient-bg-mode .gradient-bg-marker {
          display: none;
        }
        
        .palette-item-carousel .color-count {
          text-align: center;
          font-size: calc(0.85em * var(--card-size-multiplier));
          color: var(--secondary-text-color, #666);
          margin-top: calc(16px * var(--card-size-multiplier));
          padding-top: calc(12px * var(--card-size-multiplier));
          border-top: 1px solid var(--divider-color, #eee);
          transition: font-size 0.2s ease, margin-top 0.2s ease, padding-top 0.2s ease;
        }

        /* PAGINATION STYLES */
        ${paginationStyles}

        /* Item card border for dark mode visibility */
        .item-card-border .gallery-item {
          border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
        }
        .item-card-border .carousel-content-card {
          border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
        }
        .item-card-border .palettes-album-item {
          border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
        }
    `;
  }

  updated() {
    const root = this.renderRoot;
    const content = root.querySelector(".card-content");
    if (!content) return;
    this._enhanceGeneratedMarkup(content);
    // Guarded by the shared helper (one binding per carousel wrapper node).
    attachCarouselSwipe(content, "palette-carousel", (direction) =>
      this._navigatePaletteCarousel(direction, this._paletteItems().length),
    );
    this._setupAlbum();
    this._bindCardHeaderEdit();
  }

  // Markup produced as HTML strings by shared helpers cannot carry Lit
  // bindings; give its clickable parts keyboard/screen-reader semantics here.
  // Idempotent, so it is safe to run after every update.
  _enhanceGeneratedMarkup(content) {
    const items = this._paletteItems();
    const nameOf = (el) => {
      const idx = Number(el.closest("[data-idx]")?.dataset.idx);
      return items[idx]?.name || `Palette ${idx + 1}`;
    };
    const makeButton = (el, label) => {
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-label", label);
    };
    content
      .querySelectorAll(".gallery-item-image, .palette-item-carousel")
      .forEach((el) => makeButton(el, `Apply palette ${nameOf(el)}`));
    content
      .querySelectorAll(".palettes-album-item")
      .forEach((el) => makeButton(el, `Palette ${nameOf(el)}`));
    const allowTitleEdit = this._allowTitleEdit();
    content
      .querySelectorAll(
        ".gallery-item-title, .palette-item-carousel .palette-title, .album-title .title-text",
      )
      .forEach((el) => {
        if (allowTitleEdit) makeButton(el, `Rename palette ${nameOf(el)}`);
        else {
          el.removeAttribute("role");
          el.removeAttribute("tabindex");
          el.removeAttribute("aria-label");
        }
      });
    content.querySelectorAll(".carousel-dot").forEach((el) => {
      makeButton(el, el.getAttribute("title") || "Go to palette");
    });
    // Icon-only buttons (delete crosses, carousel/album/pagination arrows).
    content.querySelectorAll("button:not([aria-label])").forEach((button) => {
      const title = button.getAttribute("title");
      if (title && button.textContent.trim().length <= 1)
        button.setAttribute("aria-label", title);
    });
  }

  // The album DOM comes from unsafeHTML, whose nodes persist while the markup
  // is unchanged; the shared coverflow helper binds listeners on those nodes,
  // so bind once per container node to avoid stacking handlers.
  _setupAlbum() {
    const root = this.renderRoot;
    const albumContainer = root.getElementById("palettes-album-container");
    if (!albumContainer || albumContainer === this._boundAlbumContainer) return;
    this._boundAlbumContainer = albumContainer;
    setupAlbumNavigation(
      root,
      "palettes",
      // On item click - apply palette to lamps (via shared sequential utility)
      async (idx) => {
        await this._applyPalette(idx);
      },
      // On item remove - the helper already animated the item out of the DOM
      (idx) => {
        this._deletionInProgress = true;
        const palettes = this._paletteItems();
        if (!palettes[idx]) return;
        this._mutatePalettes(
          palettes.filter((_, index) => index !== idx),
          "remove_palette",
          { idx, expected_name: palettes[idx].name },
          false,
        ).then((success) => {
          if (!success) return;
          clearTimeout(this._albumDeletionTimer);
          this._albumDeletionTimer = setTimeout(() => {
            this._deletionInProgress = false;
            this.requestUpdate();
          }, 1500);
        });
      },
      // Context object to store state
      this,
      // Config for 3D mode detection
      this.config,
    );
  }

  // <ha-card>'s header lives in its own shadow root, so it cannot be bound
  // from this template; bind once per header node.
  _bindCardHeaderEdit() {
    if (!this._allowTitleEdit()) return;
    const haCard = this.renderRoot.querySelector("ha-card");
    if (!haCard) return;
    Promise.resolve(haCard.updateComplete).then(() => {
      const header = haCard.shadowRoot?.querySelector(".card-header");
      if (!header || header._yeelightTitleEdit) return;
      header._yeelightTitleEdit = true;
      header.style.cursor = "pointer";
      header.addEventListener("click", () => {
        if (this._allowTitleEdit()) this._editCardTitle(header);
      });
    });
  }

  _editCardTitle(titleElem) {
    const newTitle = prompt(
      "Enter new card title:",
      titleElem.textContent.trim(),
    );
    if (newTitle !== null && newTitle.trim() !== "") {
      this.config.title = newTitle.trim();
      this.requestUpdate();
    }
  }

  // Enter/Space activate any non-native element exposed as a button.
  _onContentKeydown(event) {
    const target = event.target;
    if (
      !isActivationKey(event) ||
      target?.getAttribute?.("role") !== "button" ||
      target.localName === "button"
    )
      return;
    event.preventDefault();
    target.click();
  }

  // Capture-phase delegation for markup generated as HTML strings. Runs before
  // the album helper's per-item listeners, so title renames can stop the click
  // from also selecting/applying the item.
  _onContentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const indexOf = (el) => parseInt(el.closest("[data-idx]")?.dataset.idx);

    const page = target.closest(
      "[data-pagination-page], [data-pagination-action]",
    );
    if (page) {
      const action = page.dataset.paginationAction;
      if (action === "prev") {
        this._currentPalettePage = Math.max(0, this._currentPalettePage - 1);
      } else if (action === "next") {
        this._currentPalettePage += 1;
      } else {
        this._currentPalettePage = parseInt(page.dataset.paginationPage, 10);
      }
      this.requestUpdate();
      return;
    }

    const carouselBtn = target.closest(
      '[data-carousel-id="palette-carousel"][data-action]',
    );
    if (carouselBtn) {
      if (carouselBtn.dataset.action === "navigate") {
        this._navigatePaletteCarousel(
          parseInt(carouselBtn.dataset.direction),
          this._paletteItems().length,
        );
      } else if (carouselBtn.dataset.action === "set-index") {
        this._setPaletteCarouselIndex(parseInt(carouselBtn.dataset.index));
      }
      return;
    }

    if (this._allowTitleEdit()) {
      const title = target.closest(
        ".gallery-item-title, .palette-item-carousel .palette-title, .album-title .title-text",
      );
      if (title) {
        event.stopPropagation();
        this._renamePalette(indexOf(title), title.textContent.trim(), title);
        return;
      }
    }

    const remove = target.closest(
      ".gallery-item button, .palette-item-carousel .palette-remove-btn",
    );
    if (remove) {
      event.stopPropagation();
      this._deletePalette(indexOf(remove));
      return;
    }

    const item = target.closest(".gallery-item-image, .palette-item-carousel");
    if (item && !target.closest("button")) {
      this._applyPalette(indexOf(item));
    }
  }

  // Simple method to delete a palette
  /**
   * Delete a palette with client-side caching for instant UI updates
   *
   * CLIENT-SIDE DELETION ARCHITECTURE:
   * 1. Filter palette array immediately (optimistic update)
   * 2. Store filtered array in CollectionState with timestamp
   * 3. Render immediately with cached data (instant UI feedback)
   * 4. Call backend service to persist deletion
   * 5. Wait for the full sensor array to match
   * 6. Clear cache and let sensor data take over
   *
   * ERROR HANDLING:
   * - If backend fails, clear cache and re-render with sensor data
   * - If cache expires (5s) without sensor catching up, clear and re-render
   * - Prevents UI from being stuck in incorrect state
   */
  get _localPalettes() {
    return this._collection?.pending?.items;
  }

  _paletteItems() {
    const attributes =
      this._hass?.states?.[this.config.palette_sensor]?.attributes;
    return (
      this._localPalettes ??
      attributes?.palettes_v2 ??
      attributes?.palettes ??
      []
    );
  }

  _notify(message) {
    notify(this, message);
  }

  // Toast only failures HA did not already report: hass.callService shows its
  // own toast for service errors, so those must not be notified twice.
  _notifyUnreported(error, message) {
    notifyUnreported(this, error, message);
  }

  _notifySkipped(skipped) {
    if (skipped)
      this._notify(
        `${skipped} palette${skipped === 1 ? " was" : "s were"} skipped: colours must be [R, G, B] values from 0 to 255 or #hex.`,
      );
  }

  // Apply a palette by index, sending the name seen at that index so the
  // backend refuses the call if another client changed the list meanwhile.
  // Never rejects: failures are logged by the service helper and reported once.
  _applyPalette(idx) {
    return this.callServiceOnTargetEntities("load_palette", {
      idx,
      expected_name: this._paletteItems()[idx]?.name,
    }).catch((error) =>
      this._notifyUnreported(error, "Failed to load the palette."),
    );
  }

  // `requestUpdate` is optional-called so this method also runs on plain
  // objects (tests extract it with only a `render` stub).
  async _mutatePalettes(items, service, data, render = true) {
    const collection = (this._collection ||= new CollectionState());
    const operation = collection.record(items);
    if (render) this.requestUpdate?.();
    try {
      if (!(await collection.execute(this._hass, service, data))) {
        throw new Error("The palette collection changed. Please retry.");
      }
      return true;
    } catch (error) {
      if (collection.rollback(operation)) {
        this._deletionInProgress = false;
        this.requestUpdate?.();
        // Service failures were already toasted by HA; only the locally
        // detected "collection changed" conflict (or other local errors) is.
        this._notifyUnreported(error);
      }
      return false;
    }
  }

  _deletePalette(idx) {
    const palettes = this._paletteItems();
    if (!palettes[idx]) return;
    const updatedPalettes = palettes.filter((_, i) => i !== idx);
    return this._mutatePalettes(updatedPalettes, "remove_palette", {
      idx,
      expected_name: palettes[idx].name,
    });
  }

  // Fallback for renderGalleryMode's inline delete handler, should the markup
  // ever escape GALLERY_INLINE_DELETE.
  handleGalleryDelete(event, idx) {
    event.stopPropagation();
    this._deletePalette(idx);
  }

  // Call a service on every configured target entity (in parallel).
  // Delegates to the shared utility.  The Python backend holds per-IP locks,
  // so different lamps execute in parallel.
  async callServiceOnTargetEntities(service, data = {}) {
    return callServiceSequentially(this._hass, this.config, service, data, {
      callerTag: "Palette Card",
    });
  }

  // Prompt for a new palette name and persist it via the backend. Shared by
  // every display mode's title click handler.
  _renamePalette(idx, currentName, titleEl) {
    const newName = prompt("Enter new palette name:", currentName);
    if (newName === null || newName.trim() === "") return;
    const palettes = this._paletteItems();
    if (!palettes[idx]) return;
    const name = newName.trim();
    return this._mutatePalettes(
      palettes.map((palette, index) =>
        index === idx ? { ...palette, name } : palette,
      ),
      "rename_palette",
      { idx, name, expected_name: palettes[idx].name },
    );
  }

  _exportPalettes() {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(this._sensorPalettes(), null, 2));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute("download", "palettes.json");
    a.click();
  }

  _setImportStatus(status, resetAfter) {
    clearTimeout(this._importStatusTimer);
    this._importStatus = status;
    this.requestUpdate();
    if (resetAfter)
      this._importStatusTimer = setTimeout(
        () => this._setImportStatus({ active: false, success: false }),
        resetAfter,
      );
  }

  // Import palettes from a JSON file (appended, never replacing the list).
  _importPalettes() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > MAX_PALETTE_IMPORT_BYTES) {
        this._notify("This palette file is too large to import.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        let imported;
        try {
          const result = normalizeImportedPalettes(
            JSON.parse(ev.target.result),
          );
          imported = result.palettes;
          if (!imported.length) throw new Error("No valid palettes");
          this._notifySkipped(result.skipped);
        } catch (err) {
          this._setImportStatus({ active: true, success: false }, 3000);
          this._notify("Invalid palette file");
          return;
        }
        // Append on the server (add_palettes) so palettes other clients added
        // since this card last refreshed are kept.
        this._mutatePalettes(
          this._paletteItems().concat(imported),
          "add_palettes",
          { palettes: imported },
        )
          .then(async (success) => {
            if (!success) {
              this._setImportStatus({ active: true, success: false }, 3000);
              return;
            }
            this._setImportStatus({ active: true, success: true }, 2000);
            // Force sensor update to get fresh data immediately
            const paletteSensor = this.config?.palette_sensor;
            if (paletteSensor) {
              await this._hass.callService("homeassistant", "update_entity", {
                entity_id: paletteSensor,
              });
            }
          })
          .catch((error) => this._notifyUnreported(error));
      };
      reader.readAsText(file);
    });
    input.click();
  }

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

    // Item and title clicks are delegated (see _onContentClick), so no inline
    // handler names are passed; the delete handler name is required for the
    // helper to render the button at all, and its inline onclick is stripped.
    const galleryHTML = renderGalleryMode(
      palettesWithGradient,
      renderPaletteContent,
      {
        showTitle: showPaletteTitle,
        showDelete: showRemove,
        deleteButtonClass: removeBtnClass,
        posClass,
        sideClass,
        onDeleteClick: "handleGalleryDelete",
        onItemClick: null,
        onTitleClick: null,
        cardSizeMultiplier: cardSizeMultiplier,
        isGradientBg: isGradientBg,
        isStripes: isStripes,
        isGradientBar: isGradientBar,
        globalOffset: options.globalOffset || 0,
        roundedCards: this.config.rounded_cards,
      },
    ).replace(GALLERY_INLINE_DELETE, "");

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
              ${unsafeHTML(
                renderButtonContent("mdi:download", "Export", contentMode),
              )}
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
              ${unsafeHTML(
                isImportStatus
                  ? renderButtonContent(
                      "mdi:upload",
                      "Import",
                      contentMode,
                      true,
                      statusType,
                    )
                  : renderButtonContent("mdi:upload", "Import", contentMode),
              )}
            </button>`
          : nothing}
      </div>
    `;
  }

  connectedCallback() {
    super.connectedCallback();
    // State was reset on disconnect; show current data when re-attached.
    if (this._hass) this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._albumDeletionTimer);
    clearTimeout(this._importStatusTimer);

    // Reset interaction flags
    this._deletionInProgress = false;
    this._importStatus = { active: false, success: false };

    // Clear local palette cache
    this._collection?.reset();
  }
}
defineOnce("yeelight-cube-palette-card", YeelightCubePaletteCard);

if (typeof window !== "undefined") {
  registerCustomCard({
    type: "yeelight-cube-palette-card",
    name: "Yeelight Palettes Card",
    description: "View and manage palettes for the Yeelight Cube Lite.",
    preview: true,
  });
}
