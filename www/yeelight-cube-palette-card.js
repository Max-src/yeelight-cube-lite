import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { compactModeStyles } from "./compact-mode-styles.js";
import {
  deleteButtonStyles,
  getDeleteButtonClass,
} from "./delete-button-styles.js";
import {
  exportImportButtonStyles,
  renderButtonContent,
  getExportImportButtonClass,
} from "./export-import-button-utils.js";
import {
  getAlbumStyles,
  renderAlbumView,
  setupAlbumNavigation,
} from "./album-view-coverflow.js";
import {
  renderCarousel,
  renderCarouselString,
  carouselStyles,
} from "./carousel-utils.js";
import { gridModeStyles, renderGridMode } from "./grid-mode-utils.js";
import { galleryModeStyles, renderGalleryMode } from "./gallery-mode-utils.js";
import { callServiceOnTargetEntities as callServiceSequentially } from "./service-call-utils.js?v=2";
import {
  paginationStyles,
  renderPagination,
  attachPaginationListeners,
} from "./pagination-utils.js";

class YeelightCubePaletteCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this.config = {};
    this._lastPaletteState = null;
    this._importStatus = { active: false, success: false };
    this._stylesInjected = false; // Track if styles are already injected
    this._deletionInProgress = false; // Prevent re-render during deletion
    this._currentPalettePage = 0; // Pagination state
  }

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
        const stripePercent = 100 / colors.length;
        const stripeGradient = colors
          .map((color, i) => {
            const start = i * stripePercent;
            const end = (i + 1) * stripePercent;
            return `${rgbToCss(color)} ${start}% ${end}%`;
          })
          .join(", ");
        return `<div class="stripes-bar" style="background: linear-gradient(to right, ${stripeGradient});"></div>`;

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

  setConfig(config) {
    this.config = {
      palette_sensor: config.palette_sensor,
      target_entities: config.target_entities || [], // Array of entity IDs to control
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

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    this.render();
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
      swatch_style: "square",
      display_mode: "gallery",
      remove_button_style: "default",
      show_color_count: false,
      buttons_style: "gradient",
      card_size: 50,
      items_per_page: 12,
    };
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
   * 2. _localPalettes cache stores filtered array, _localPalettesTimestamp tracks age
   * 3. Backend service deletes item → fires event → sensor updates count/hash
   * 4. Websocket sends: {count: 16, hash: <new>} but palettes_v2: <stale 17-item array>
   * 5. This setter sees count match → clears cache → waits for full data
   * 6. render() checks count vs array length → trims stale array to match count
   *
   * CACHE MANAGEMENT:
   * - Cache cleared when sensor count matches local count (deletion complete)
   * - Cache expires after 5 seconds (navigated away and back)
   * - Cache cleared if count diff > 5 (very stale, multiple changes happened)
   * - While cache active, ignore all sensor updates (prevent stale renders)
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

    // Get sensor state info - use COUNT instead of content_hash (websocket limitation)
    const stateObj = hass.states[entityId];
    const prevCount = this._lastPaletteCount;
    const currCount =
      stateObj?.attributes?.count ||
      stateObj?.attributes?.palettes_v2?.length ||
      0;
    const isFirstLoad = prevCount === undefined;

    // Check if local cache should be cleared (even during album deletion)
    if (this._localPalettes !== undefined) {
      const cacheAge = Date.now() - (this._localPalettesTimestamp || 0);
      const maxCacheAge = 5000;
      const countDiff = Math.abs(currCount - this._localPalettes.length);

      if (currCount === this._localPalettes.length) {
        delete this._localPalettes;
        delete this._localPalettesTimestamp;
        this._lastPaletteCount = currCount;
        // Don't render yet - palettes_v2 array might be stale
        return;
      } else if (cacheAge > maxCacheAge) {
        delete this._localPalettes;
        delete this._localPalettesTimestamp;
        this._lastPaletteCount = undefined;
        return;
      } else if (countDiff > 5) {
        delete this._localPalettes;
        delete this._localPalettesTimestamp;
        this._lastPaletteCount = currCount;
        if (!this._deletionInProgress) {
          this.render();
        }
        return;
      }
      return;
    }

    // Block re-render during album deletion (after cache check)
    if (this._deletionInProgress) {
      return;
    }

    // Detect changes using COUNT (websocket sends count, not content_hash)
    if (prevCount !== currCount || isFirstLoad) {
      this._lastPaletteCount = currCount;

      // Use requestAnimationFrame to batch renders
      if (this._renderScheduled) {
        return;
      }
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;

        this.render();
      });
    }
  }
  /**
   * Render the palette card
   *
   * STALE DATA PROTECTION:
   * The palettes_v2 array from sensor attributes may be stale (HA websocket limitation).
   * We MUST use the count attribute as the source of truth and trim the array accordingly.
   * This ensures deleted items don't reappear even when HA doesn't send updated arrays.
   */
  render() {
    const hass = this._hass;
    const entityId = this.config.palette_sensor;
    if (!hass || !entityId) {
      return;
    }
    const stateObj = hass.states[entityId];
    if (!stateObj) {
      this.shadowRoot.innerHTML = `<ha-card>Palette sensor not found</ha-card>`;
      return;
    }

    // Use local palettes if deletion is in progress (client-side update)
    // Otherwise use sensor state
    let palettes =
      this._localPalettes !== undefined
        ? this._localPalettes
        : Array.isArray(stateObj.attributes.palettes_v2)
          ? stateObj.attributes.palettes_v2
          : Array.isArray(stateObj.attributes.palettes)
            ? stateObj.attributes.palettes
            : [];

    // CRITICAL FIX: HA websocket doesn't send updated palettes_v2 array for large arrays
    // Only the count attribute gets updated via websocket
    // We MUST trim the array to match count to prevent deleted items from reappearing
    // This is the final safety net against stale data
    if (this._localPalettes === undefined) {
      const expectedCount = stateObj.attributes.count || palettes.length;
      if (palettes.length > expectedCount) {
        palettes = palettes.slice(0, expectedCount);
      }
    }

    // Clear local cache if sensor has caught up to our local state
    if (this._localPalettes !== undefined) {
      const sensorPalettes = Array.isArray(stateObj.attributes.palettes_v2)
        ? stateObj.attributes.palettes_v2
        : Array.isArray(stateObj.attributes.palettes)
          ? stateObj.attributes.palettes
          : [];

      if (sensorPalettes.length === this._localPalettes.length) {
        delete this._localPalettes;
        // Cancel any pending timer since sensor already caught up
        if (this._localPalettesClearTimer) {
          clearTimeout(this._localPalettesClearTimer);
          delete this._localPalettesClearTimer;
        }
      }
    }

    const showCard = this.config.show_card_background !== false;
    const removeButtonStyle = this.config.remove_button_style || "default";
    const showRemove = removeButtonStyle !== "none";
    const showExport = this.config.show_export_button !== false;
    const showImport = this.config.show_import_button !== false;
    const showPaletteTitle = this.config.show_palette_title !== false;
    const showColorCount = this.config.show_color_count !== false;
    const allowTitleEdit =
      showPaletteTitle && this.config.allow_title_edit === true;

    // Use shared utility function to get delete button class
    const removeBtnClass = getDeleteButtonClass(removeButtonStyle);
    const cardTitle =
      typeof this.config.title === "string" ? this.config.title : "";
    const displayMode = this.config.display_mode || "list";

    let contentHtml = "";
    // Add card title at the top if present
    if (cardTitle) {
      contentHtml += `<div class="card-title" id="card-title">${cardTitle}</div>`;
    }
    if (palettes.length === 0) {
      contentHtml += `<div style='padding:16px;color:var(--secondary-text-color, #888);'>No palettes found. Add palettes to see them here.</div>`;
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
      contentHtml += this._renderPalettes(displayPalettes, displayMode, {
        showRemove,
        showPaletteTitle,
        allowTitleEdit,
        showColorCount,
        removeBtnClass,
        swatchStyle: this.config.swatch_style || "square",
        globalOffset: usePagination
          ? this._currentPalettePage * itemsPerPage
          : 0,
      });
      contentHtml += paginationHtml;
    }
    // Always show Export/Import buttons
    contentHtml += this._renderPaletteExportImportButtons(
      showExport,
      showImport,
    );

    this.shadowRoot.innerHTML = `
      <style>
        /* Shared Compact Mode Styles */
        ${compactModeStyles}

        /* Shared Delete Button Styles */
        ${deleteButtonStyles}

        /* Shared Export/Import Button Styles */
        ${exportImportButtonStyles}

        /* Shared Carousel Styles */
        ${carouselStyles}

        /* Shared Grid Mode Styles */
        ${gridModeStyles}

        :host {
          --card-size-multiplier: ${(this.config.card_size || 50) / 100};
        }
        .card-title { font-size: 1.3em; font-weight: bold; margin-bottom: 18px; margin-top: 2px; color: var(--primary-text-color, #222); cursor: ${
          allowTitleEdit ? "pointer" : "default"
        }; }
        .palette-row {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          margin: 0 auto 10px auto;
          background: var(--secondary-background-color, #fafbfc);
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: 14px;
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
          border: 1px solid var(--divider-color, #ccc);
        }
        /* Swatch Styles */
        .square-swatch {
          width: calc(28px * var(--card-size-multiplier));
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 6px;
          display: inline-block;
          border: 1px solid var(--divider-color, #ddd);
          margin: 1px;
          transition: width 0.2s ease, height 0.2s ease;
        }
        .round-swatch {
          width: calc(28px * var(--card-size-multiplier));
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 50%;
          display: inline-block;
          border: 1px solid var(--divider-color, #ddd);
          margin: 1px;
          transition: width 0.2s ease, height 0.2s ease;
        }
        .gradient-bar {
          width: 100%;
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 14px;
          border: 1px solid var(--divider-color, #ddd);
          margin: 2px 0;
          transition: height 0.2s ease;
        }
        .stripes-bar {
          width: 100%;
          height: calc(28px * var(--card-size-multiplier));
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ddd);
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
        /* Base button styles inherited from delete-button-styles.js */
        .remove-btn-cross.black-style:hover {
          background: linear-gradient(135deg, #3a3a3a 0%, #252525 50%, #101010 100%) !important;
          border-color: rgba(255, 255, 255, 0.5) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
        }
        .remove-btn-cross.trash-style {
          background: rgba(255, 255, 255, 0.95) !important;
          border: 1px solid rgba(211, 47, 47, 0.25) !important;
          color: var(--error-color, #d32f2f) !important;
          font-size: 0 !important;
          width: 28px !important;
          height: 28px !important;
        }
        .remove-btn-cross.trash-style::before {
          content: "🗑" !important;
          font-size: 13px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          filter: drop-shadow(0 0 2px rgba(211, 47, 47, 0.3)) !important;
        }
        .remove-btn-cross.trash-style:hover {
          background: var(--card-background-color, white) !important;
          border-color: rgba(211, 47, 47, 0.4) !important;
        }
        .remove-btn-cross.trash-style:hover::before {
          filter: drop-shadow(0 0 4px rgba(211, 47, 47, 0.5)) !important;
        }
        .remove-btn-cross:hover {
          background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff));
          transform: scale(1.1);
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
        
        /* Additional palette-specific album styles */
        .palettes-album-item .album-gradient {
          height: 55%;
          min-height: 125px;
          position: relative;
          transition: height 0.2s ease;
          flex-shrink: 1;
          border-radius: ${
            this.config.album_card_rounded !== false ? "16px 16px 0 0" : "0"
          };
          overflow: hidden;
        }
        .palettes-album-item .album-content {
          padding: max(4px, 5%) max(4px, 4%);
          min-height: 40px;
          background: var(--card-background-color, white);
          border-radius: ${
            this.config.album_card_rounded !== false ? "0 0 16px 16px" : "0"
          };
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
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          border: 1px solid var(--divider-color, #ddd);
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
        }
      </style>
      ${
        showCard
          ? `<ha-card><div class="card-content">${contentHtml}</div></ha-card>`
          : `<div class="card-content">${contentHtml}</div>`
      }
    `;

    if (palettes.length > 0) {
      this.addEventListeners(palettes, allowTitleEdit, showCard);
    } else {
      // Attach listeners for export/import buttons even if no palettes
      const root = this.shadowRoot;
      if (root) {
        const exportBtn = root.getElementById("export-palettes");
        if (exportBtn) {
          exportBtn.addEventListener("click", () => {
            const entityId = this.config.palette_sensor;
            const stateObj = this._hass.states[entityId];
            // Use palettes_v2 for export
            const palettes = Array.isArray(stateObj?.attributes?.palettes_v2)
              ? stateObj.attributes.palettes_v2
              : Array.isArray(stateObj?.attributes?.palettes)
                ? stateObj.attributes.palettes
                : [];
            const dataStr =
              "data:text/json;charset=utf-8," +
              encodeURIComponent(JSON.stringify(palettes, null, 2));
            const a = document.createElement("a");
            a.setAttribute("href", dataStr);
            a.setAttribute("download", "palettes.json");
            a.click();
          });
        }
        const importBtn = root.getElementById("import-palettes");
        if (importBtn) {
          importBtn.addEventListener("click", () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json,application/json";
            input.addEventListener("change", (e) => {
              const file = e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                try {
                  let palettes = JSON.parse(ev.target.result);
                  // Ensure palettes is a list of objects with name and colors
                  if (Array.isArray(palettes)) {
                    palettes = palettes
                      .map((p, i) => {
                        if (
                          typeof p === "object" &&
                          p.name &&
                          Array.isArray(p.colors)
                        ) {
                          return { name: p.name, colors: p.colors };
                        } else if (Array.isArray(p)) {
                          return { name: `Palette ${i + 1}`, colors: p };
                        }
                        return null;
                      })
                      .filter(Boolean);
                  } else {
                    palettes = [];
                  }
                  this._importStatus = { active: true, success: true };
                  this.render();
                  // Clear local cache to ensure updates aren't blocked
                  delete this._localPalettes;
                  delete this._localPalettesTimestamp;
                  this._hass
                    .callService("yeelight_cube", "set_palettes", {
                      palettes,
                    })
                    .then(async () => {
                      // Force sensor update to get fresh data immediately
                      const paletteSensor = this.config?.palette_sensor;
                      if (paletteSensor) {
                        await this._hass.callService(
                          "homeassistant",
                          "update_entity",
                          {
                            entity_id: paletteSensor,
                          },
                        );
                      }
                      setTimeout(() => {
                        this._importStatus = { active: false, success: false };
                        this.render();
                      }, 2000);
                    })
                    .catch(() => {
                      this._importStatus = { active: true, success: false };
                      this.render();
                      setTimeout(() => {
                        this._importStatus = { active: false, success: false };
                        this.render();
                      }, 3000);
                    });
                } catch (err) {
                  this._importStatus = { active: true, success: false };
                  this.render();
                  setTimeout(() => {
                    this._importStatus = { active: false, success: false };
                    this.render();
                  }, 3000);
                  alert("Invalid palette file");
                }
              };
              reader.readAsText(file);
            });
            input.click();
          });
        }
      }
    }
  }

  _renderContent(
    cardTitle,
    palettes,
    showRemove,
    showExport,
    showImport,
    showPaletteTitle,
    allowTitleEdit,
  ) {
    return `
      ${
        cardTitle
          ? `<div class="card-title" id="card-title">${cardTitle}</div>`
          : ""
      }
      ${palettes
        .map(
          (palette, idx) => `
          <div class="palette-row" data-idx="${idx}" style="position:relative;">
            ${
              showPaletteTitle
                ? `<div class="palette-title" data-idx="${idx}" style="display:flex;align-items:center;justify-content:space-between;">
                    <span class="title-text${
                      allowTitleEdit ? " editable" : ""
                    }">${palette.name || "Palette " + (idx + 1)}</span>
                    ${
                      removeButtonCross
                        ? `<button class="remove-btn-cross" data-idx="${idx}" title="Remove" style="background:none;border:none;color:var(--error-color, #db4437);font-size:1.4em;cursor:pointer;position:absolute;top:8px;right:8px;">&#10006;</button>`
                        : ""
                    }
                  </div>`
                : ""
            }
            <div class="palette-colors">
              ${this._renderPaletteColors(
                palette.colors,
                this.config.swatch_style || "square",
                idx,
              )}
            </div>
            <div class="palette-actions" style="${
              buttonLayoutRow
                ? "position:absolute;top:8px;right:8px;flex-direction:row;justify-content:flex-end;align-items:center;margin-top:0;"
                : "position:absolute;top:40px;right:8px;flex-direction:column;align-items:flex-end;margin-top:0;"
            }">
              ${
                showRemove && !removeButtonCross
                  ? `<button class="remove-btn" data-idx="${idx}" title="Remove">Remove</button>`
                  : ""
              }
            </div>
          </div>
        `,
        )
        .join("")}
    `;
  }

  // Simple method to delete a palette - called directly from onclick
  /**
   * Delete a palette with client-side caching for instant UI updates
   *
   * CLIENT-SIDE DELETION ARCHITECTURE:
   * 1. Filter palette array immediately (optimistic update)
   * 2. Store filtered array in _localPalettes cache with timestamp
   * 3. Render immediately with cached data (instant UI feedback)
   * 4. Call backend service to persist deletion
   * 5. Wait for sensor to catch up (count matches cache)
   * 6. Clear cache and let sensor data take over
   *
   * ERROR HANDLING:
   * - If backend fails, clear cache and re-render with sensor data
   * - If cache expires (5s) without sensor catching up, clear and re-render
   * - Prevents UI from being stuck in incorrect state
   */
  _deletePalette(idx) {
    const root = this.shadowRoot;
    const albumContainer = root?.getElementById("album-container");

    // Album mode uses its own handler in setupAlbumNavigation - skip this
    if (albumContainer) return;

    // For list/grid/compact modes: immediate client-side removal
    const entityId = this.config.palette_sensor;
    const stateObj = this._hass?.states[entityId];

    // Use local state if it exists (for rapid successive deletes), otherwise sensor state
    const palettes =
      this._localPalettes !== undefined
        ? this._localPalettes
        : stateObj?.attributes?.palettes_v2 || [];

    // Remove from local state immediately
    const updatedPalettes = palettes.filter((_, i) => i !== idx);

    // Store the updated palettes temporarily (ONLY during the deletion operation)
    this._localPalettes = updatedPalettes;
    this._localPalettesTimestamp = Date.now(); // Track when cache was created

    // Force immediate re-render with the updated list
    this.render();

    // Call backend service (will update sensor, but we already updated UI)
    this._hass
      .callService("yeelight_cube", "remove_palette", { idx })
      .then(() => {
        // Don't clear cache yet! Sensor hasn't updated yet
        // Cache will be cleared when sensor count matches in set hass()
      })
      .catch((err) => {
        console.error(`[PALETTE-DELETE] Backend error for idx=${idx}:`, err);
        // On error, restore the original palette list
        delete this._localPalettes;
        delete this._localPalettesTimestamp;
        this.render();
      });
  }

  // Wrapper methods for gallery mode event handlers
  handleGalleryDelete(event, idx) {
    event.stopPropagation();
    this._deletePalette(idx);
  }

  async handleGalleryItemClick(event, idx) {
    // Apply palette to lamp — delegates to shared sequential utility.
    await this.callServiceOnTargetEntities("load_palette", { idx });
  }

  // Call a service on every configured target entity (in parallel).
  // Delegates to the shared utility.  The Python backend holds per-IP locks,
  // so different lamps execute in parallel.
  async callServiceOnTargetEntities(service, data = {}) {
    return callServiceSequentially(this._hass, this.config, service, data, {
      callerTag: "Palette Card",
    });
  }

  handleGalleryTitleClick(event, idx) {
    // Palette card doesn't currently support title editing
    // This is a placeholder for future implementation
  }

  addEventListeners(palettes, allowTitleEdit, showCard) {
    const root = this.shadowRoot;
    if (!root) return;

    const contentDiv = showCard ? root.querySelector(".card-content") : root;

    if (contentDiv) {
      // Attach pagination listeners via shared utility
      attachPaginationListeners(contentDiv, (pageOrAction) => {
        if (pageOrAction === "prev") {
          this._currentPalettePage = Math.max(0, this._currentPalettePage - 1);
        } else if (pageOrAction === "next") {
          this._currentPalettePage += 1;
        } else {
          this._currentPalettePage = pageOrAction;
        }
        this.render();
      });

      contentDiv.addEventListener("click", (e) => {
        // Handle carousel navigation
        const carouselBtn = e.target.closest("[data-carousel-id][data-action]");
        if (carouselBtn) {
          const carouselId = carouselBtn.dataset.carouselId;
          const action = carouselBtn.dataset.action;

          if (carouselId === "palette-carousel") {
            if (action === "navigate") {
              const direction = parseInt(carouselBtn.dataset.direction);
              const cfg = this.config || {};
              const stateObj = this._hass.states[cfg.palette_sensor];
              const palettes = Array.isArray(stateObj?.attributes?.palettes_v2)
                ? stateObj.attributes.palettes_v2
                : Array.isArray(stateObj?.attributes?.palettes)
                  ? stateObj.attributes.palettes
                  : [];
              this._navigatePaletteCarousel(direction, palettes.length);
            } else if (action === "set-index") {
              const index = parseInt(carouselBtn.dataset.index);
              this._setPaletteCarouselIndex(index);
            }
          }
          return;
        }

        const paletteItem = e.target.closest(
          ".palette-row, .palette-grid-item, .palette-compact-item, .palette-album-item, .palette-item-carousel",
        );

        if (!paletteItem?.dataset?.idx) return;

        // Exclude button clicks - onclick handler will handle them
        if (e.target.closest("button, .remove-btn, .remove-btn-cross")) return;

        // Exclude title clicks if editing enabled
        if (allowTitleEdit && e.target.matches(".title-text")) return;

        const idx = parseInt(paletteItem.dataset.idx);
        // Apply palette — delegates to shared sequential utility.
        (async () => {
          await this.callServiceOnTargetEntities("load_palette", { idx });
        })();
      });
    }

    // Export palettes
    const exportBtn = root.getElementById("export-palettes");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const entityId = this.config.palette_sensor;
        const stateObj = this._hass.states[entityId];
        const palettes = Array.isArray(stateObj?.attributes?.palettes_v2)
          ? stateObj.attributes.palettes_v2
          : Array.isArray(stateObj?.attributes?.palettes)
            ? stateObj.attributes.palettes
            : [];
        const dataStr =
          "data:text/json;charset=utf-8," +
          encodeURIComponent(JSON.stringify(palettes, null, 2));
        const a = document.createElement("a");
        a.setAttribute("href", dataStr);
        a.setAttribute("download", "palettes.json");
        a.click();
      });
    }
    // Import palettes (append, not replace)
    const importBtn = root.getElementById("import-palettes");
    if (importBtn) {
      importBtn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              let imported = JSON.parse(ev.target.result);
              if (Array.isArray(imported)) {
                imported = imported
                  .map((p, i) => {
                    if (
                      typeof p === "object" &&
                      p.name &&
                      Array.isArray(p.colors)
                    ) {
                      return { name: p.name, colors: p.colors };
                    } else if (Array.isArray(p)) {
                      return { name: `Palette ${i + 1}`, colors: p };
                    }
                    return null;
                  })
                  .filter(Boolean);
              } else {
                imported = [];
              }
              // If palettes is empty, start with imported
              let newPalettes =
                palettes.length === 0
                  ? imported.slice()
                  : palettes.concat(imported);
              // Clear local cache to ensure updates aren't blocked
              delete this._localPalettes;
              delete this._localPalettesTimestamp;
              this._hass
                .callService("yeelight_cube", "set_palettes", {
                  palettes: newPalettes,
                })
                .then(async () => {
                  // Force sensor update to get fresh data immediately
                  const paletteSensor = this.config?.palette_sensor;
                  if (paletteSensor) {
                    await this._hass.callService(
                      "homeassistant",
                      "update_entity",
                      {
                        entity_id: paletteSensor,
                      },
                    );
                  }
                  this.render();
                });
            } catch (err) {
              alert("Invalid palette file");
            }
          };
          reader.readAsText(file);
        });
        input.click();
      });
    }
    // Edit card title
    if (allowTitleEdit) {
      const titleElem = root.getElementById("card-title");
      if (titleElem) {
        titleElem.addEventListener("click", () => {
          const newTitle = prompt(
            "Enter new card title:",
            titleElem.textContent,
          );
          if (newTitle !== null && newTitle.trim() !== "") {
            this.config.title = newTitle.trim();
            this.render();
          }
        });
      }
      // Edit palette title
      root.querySelectorAll(".title-text").forEach((el) => {
        el.addEventListener("click", (e) => {
          const paletteTitle = e.target.closest(".palette-title");
          if (!paletteTitle || !paletteTitle.dataset) return; // Safety check
          const idx = parseInt(paletteTitle.dataset.idx);
          const palette = (this._hass.states[this.config.palette_sensor]
            ?.attributes?.palettes || [])[idx];
          const newName = prompt(
            "Enter new palette name:",
            e.target.textContent.trim(),
          );
          if (newName !== null && newName.trim() !== "") {
            // Call the service and immediately update UI on success
            this._hass
              .callService("yeelight_cube", "rename_palette", {
                idx: idx,
                name: newName.trim(),
              })
              .then(() => {
                // Success: immediately update the UI
                e.target.textContent = newName.trim();

                // Also update the cached state so re-renders show the new name
                const stateObj = this._hass.states[this.config.palette_sensor];
                if (stateObj && stateObj.attributes) {
                  // Update palettes_v2 if available, else palettes
                  if (Array.isArray(stateObj.attributes.palettes_v2)) {
                    stateObj.attributes.palettes_v2[idx].name = newName.trim();
                  } else if (Array.isArray(stateObj.attributes.palettes)) {
                    stateObj.attributes.palettes[idx].name = newName.trim();
                  }
                }
              })
              .catch((error) => {
                // Error: show user feedback
                console.error("Failed to rename palette:", error);
                alert("Failed to rename palette. Please try again.");
              });
          }
        });
      });
    }

    // Cover Flow album interaction - use shared navigation utility
    const albumContainer = root.getElementById("palettes-album-container");
    if (albumContainer) {
      setupAlbumNavigation(
        root,
        "palettes",
        // On item click - apply palette to lamps (via shared sequential utility)
        async (idx) => {
          await this.callServiceOnTargetEntities("load_palette", { idx });
        },
        // On item remove - call backend with logging
        (idx) => {
          // Set deletion flag to block re-renders
          this._deletionInProgress = true;
          // Get palette name for logging and update local cache
          const paletteSensor = this.config.palette_sensor;
          if (paletteSensor && this._hass.states[paletteSensor]) {
            const palettes =
              this._hass.states[paletteSensor].attributes.palettes_v2 || [];
            const palette = palettes[idx];

            // Update local cache so other modes see correct state
            const updatedPalettes = palettes.filter((_, i) => i !== idx);
            this._localPalettes = updatedPalettes;
            this._localPalettesTimestamp = Date.now();
          }

          this._hass
            .callService("yeelight_cube", "remove_palette", { idx })
            .then(() => {
              // Wait 1.5s for album re-setup, then clear deletion flag
              // Don't clear local cache yet - let sensor update trigger that
              setTimeout(() => {
                this._deletionInProgress = false;
              }, 1500);
            })
            .catch((err) => {
              // Clear flag and cache on error
              this._deletionInProgress = false;
              delete this._localPalettes;
              delete this._localPalettesTimestamp;
            });
        },
        // Context object to store state
        this,
      );
    }
  }

  _renderPalettes(palettes, displayMode, options) {
    const { showRemove, showPaletteTitle, allowTitleEdit } = options;

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
      globalOffset = 0,
    } = options;

    return palettes
      .map((palette, localIdx) => {
        const idx = localIdx + globalOffset;
        const isGradientBg =
          (this.config.swatch_style || "square") === "gradient-bg";
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

        const removeButtonHtml = showRemove
          ? `<button class="${removeBtnClass}" data-idx="${idx}" title="Remove" onclick="event.stopPropagation(); this.getRootNode().host._deletePalette(${idx});" style="position:absolute;top:${
              showPaletteTitle ? "12px" : "8px"
            };right:${showPaletteTitle ? "12px" : "8px"};">${"×"}</button>`
          : "";

        return `
        <div class="palette-row palette-list-item" data-idx="${idx}" style="position:relative;padding:${
          isGradientBg ? "14px 16px" : "8px 12px"
        };box-sizing:border-box;${rowBgStyle}; min-height: ${minHeight};">
          <div style="display:flex;flex-direction:column;width:100%;${
            showRemove ? "padding-right:40px;" : ""
          };pointer-events:none;">
            ${
              showPaletteTitle
                ? `<div class="palette-title" data-idx="${idx}" style="display:flex;align-items:center;margin-bottom:${
                    isGradientBg ? "0" : "4px"
                  };width: fit-content;">
                    <span class="title-text${
                      allowTitleEdit ? " editable" : ""
                    }">${palette.name || "Palette " + (idx + 1)}</span>
                    ${
                      isGradientBg && showColorCount
                        ? `<span class="list-color-count">${colorCountText}</span>`
                        : ""
                    }
                  </div>`
                : isGradientBg && showColorCount
                  ? `<div style="display:flex;align-items:center;">
                    <span class="list-color-count">${colorCountText}</span>
                  </div>`
                  : ""
            }
            <div class="palette-colors" style="pointer-events:auto;">
              ${
                isGradientBg
                  ? ""
                  : this._renderPaletteColors(
                      palette.colors,
                      this.config.swatch_style || "square",
                      idx,
                    )
              }
            </div>
          </div>
          ${removeButtonHtml}
        </div>
      `;
      })
      .join("");
  }

  _renderPalettesGallery(palettes, options) {
    const {
      showRemove,
      showPaletteTitle,
      allowTitleEdit,
      showColorCount,
      removeBtnClass,
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
        const stripePercent = 100 / palette.colors.length;
        const stripeGradient = palette.colors
          .map((color, i) => {
            const start = i * stripePercent;
            const end = (i + 1) * stripePercent;
            return `${rgbToCss(color)} ${start}% ${end}%`;
          })
          .join(", ");
        return `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">
            <div style="width: 100%; height: ${scaledStripesHeight}px; background: linear-gradient(to right, ${stripeGradient});"></div>
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
                                border: 1px solid var(--divider-color, rgba(0,0,0,0.1));
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

    const galleryHTML = renderGalleryMode(
      palettesWithGradient,
      renderPaletteContent,
      {
        showTitle: showPaletteTitle,
        showDelete: showRemove,
        deleteButtonClass: removeBtnClass,
        onDeleteClick: "handleGalleryDelete",
        onItemClick: "handleGalleryItemClick",
        onTitleClick: allowTitleEdit ? "handleGalleryTitleClick" : null,
        cardSizeMultiplier: cardSizeMultiplier,
        isGradientBg: isGradientBg,
        isStripes: isStripes,
        isGradientBar: isGradientBar,
        globalOffset: options.globalOffset || 0,
        roundedCards: this.config.gallery_rounded_cards !== false,
      },
    );

    return `
      <style>
        ${galleryModeStyles}
      </style>
      ${galleryHTML}
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
            ${
              showPaletteTitle
                ? `<div class="album-title" data-idx="${idx}">
                <span class="title-text${allowTitleEdit ? " editable" : ""}">${
                  palette.name || "Palette " + (idx + 1)
                }</span>
              </div>`
                : ""
            }
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
            ${
              showPaletteTitle
                ? `<div class="album-title" data-idx="${idx}">
                <span class="title-text${allowTitleEdit ? " editable" : ""}">${
                  palette.name || "Palette " + (idx + 1)
                }</span>
              </div>`
                : ""
            }
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

    // Get album HTML using shared utility
    return renderAlbumView(
      palettes,
      renderPaletteContent,
      albumConfig,
      "palettes",
    );
  }

  _renderPalettesCarousel(palettes, options) {
    const {
      showRemove,
      showPaletteTitle,
      allowTitleEdit,
      showColorCount,
      removeBtnClass,
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

    return renderCarouselString({
      items: palettes,
      currentIndex: this._paletteCarouselIndex,
      buttonShape,
      showAsCard: true,
      wrapNavigation: cfg.palette_carousel_wrap_navigation === true,
      carouselId: "palette-carousel",
      containerGradient: containerGradient,
      renderItemString: (palette, idx) => {
        return this._renderPaletteItemString(
          palette,
          idx,
          showRemove,
          showPaletteTitle,
          allowTitleEdit,
          showColorCount,
          removeBtnClass,
          swatchStyle,
        );
      },
    });
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
      this.render();
    }
  }

  _setPaletteCarouselIndex(index) {
    const current = this._paletteCarouselIndex || 0;
    if (index !== current) {
      this._paletteCarouselSlideDirection = index > current ? 1 : -1;
      this._paletteCarouselIndex = index;
      this.render();
    }
  }

  _renderPaletteItemString(
    palette,
    idx,
    showRemove,
    showPaletteTitle,
    allowTitleEdit,
    showColorCount,
    removeBtnClass,
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
                <div class="palette-title">
                  ${palette.name || `Palette ${idx + 1}`}
                </div>
              `
            : ""
        }
        ${
          showRemove
            ? `
              <button
                class="palette-remove-btn ${removeBtnClass}"
                data-idx="${idx}"
                title="Delete palette"
                onclick="event.stopPropagation(); this.getRootNode().host._deletePalette(${idx});"
              >
                ×
              </button>
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

    const rowClass = `action-row${contentMode === "icon" ? " icon-mode" : ""}`;

    return `
      <div class='${rowClass}'>
        ${
          showExport
            ? `<button id='export-palettes' class='${exportBtnClass}' title="Export palettes to JSON file">
              ${renderButtonContent("mdi:download", "Export", contentMode)}
            </button>`
            : ""
        }
        ${
          showImport
            ? `<button id='import-palettes' class='${importBtnClass}' title="Import palettes from JSON file">
              ${
                isImportStatus
                  ? renderButtonContent(
                      "mdi:upload",
                      "Import",
                      contentMode,
                      true,
                      statusType,
                    )
                  : renderButtonContent("mdi:upload", "Import", contentMode)
              }
            </button>`
            : ""
        }
      </div>
    `;
  }
}
customElements.define("yeelight-cube-palette-card", YeelightCubePaletteCard);

if (typeof window !== "undefined") {
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "yeelight-cube-palette-card",
    name: "Yeelight Palettes Card",
    description: "View and manage palettes for the Yeelight Cube Lite.",
    preview: true,
  });
}
