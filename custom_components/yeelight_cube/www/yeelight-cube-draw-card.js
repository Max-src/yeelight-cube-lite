import {
  resolvePreviewAppearance,
  previewLength,
} from "./preview-appearance.js";
import { renderMatrixPreview } from "./gallery-display-utils.js";
import { getActionRowClass } from "./action-button-utils.js";
import { LitElement, html } from "./lib/lit-all.js";

import { parseConfig } from "./draw_card_state.js";
import { drawCardStyles } from "./draw_card_styles.js";

import { getExportImportButtonClass } from "./action-button-utils.js";
import { renderActionButtonContent } from "./action-button-ui.js";


// Host methods the pixel-art gallery markup may call (see bindHostEvents).
const GALLERY_HANDLERS = new Set([
  "handleGridItemClick",
  "handleGridDelete",
  "handleGridTitleClick",
]);
import { savePalette } from "./draw_card_palette.js";
import { ToolManager, ActionManager } from "./draw_card_tools.js";
import { MatrixOperations1D } from "./draw_card_matrix_1d.js";

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
  rgbArrayToHex,
  createEmptyMatrix,
  extractDiversePaletteWithWeights,
} from "./draw_utils.js";
import {
  GRID_COLS,
  GRID_ROWS,
  MATRIX_SIZE,
  EVT_TOOL_VISIBILITY_RESET,
  EVT_ACTION_ORDER_RESET,
  EVT_ACTION_VISIBILITY_RESET,
} from "./draw_card_const.js";
import { StorageUtils } from "./draw_card_storage.js";

import { notifyUnreported } from "./notify-utils.js";
import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import {
  cardShell,
} from "./card-shell.js";
import { normalizeCardOptions } from "./card-config.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { PaletteCardsMixin } from "./draw-card-palette-cards.js";
import { PixelArtGalleryMixin } from "./draw-card-pixel-art-gallery.js";
import { PixelArtActionsMixin } from "./draw-card-pixel-art-actions.js";
import { expandPixelArt } from "./pixel-art-utils.js";

const MAX_IMAGE_PALETTE_COLORS = 15;

class YeelightCubeDrawCard extends PixelArtActionsMixin(
  PixelArtGalleryMixin(PaletteCardsMixin(YeelightCardMixin(LitElement))),
) {
  static editor = ["yeelight-cube-draw-card-editor", "./yeelight-cube-draw-card-editor.js"];
  // The pixel-art gallery names its handlers in data-on-* attributes.
  static hostEvents = (name) => GALLERY_HANDLERS.has(name);

  static getStubConfig(hass) {
    const firstEntity = cubeLampEntities(hass)[0] || "";
    return {
      type: "custom:yeelight-cube-draw-card",
      entity: firstEntity,
      target_entities: firstEntity ? [firstEntity] : [],
      pixel_spacing_mode: "normal",
      matrix_bg: "black",
      matrix_box_shadow: true,
      pixel_art_spacing_mode: "normal",
      preview_show_titles: true,
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
      show_gallery: true,
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
      remove_button_style: "black",
      delete_button_inside: true,
      pixelart_content_mode: "icon",
      pixel_art_pixel_style: "circle",
    };
  }

  static getStorageUtils() {
    return StorageUtils;
  }

  // NOTE: connectedCallback is defined ONCE, further down in this class.
  // A second definition here previously shadowed it silently (JS keeps only
  // the last class member with a given name), so the document mousedown
  // listeners for tabs/floating palette modes were never attached.

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
    this._onToolVisibilityReset = this._onToolVisibilityReset.bind(this);
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
    // No window "config-changed" listener: HA delivers editor changes through
    // setConfig() on the edited card only; a window bus leaked one card's
    // config (entity, sensors, tools) into every draw card on the dashboard.
    //
    // The reset events below carry no config: they announce that the editor
    // cleared the *global* localStorage keys shared by every draw card, so
    // every instance reloads from storage.
    window.addEventListener(
      EVT_TOOL_VISIBILITY_RESET,
      this._onToolVisibilityReset,
    );
    window.addEventListener(EVT_ACTION_ORDER_RESET, this._onActionOrderReset);
    window.addEventListener(
      EVT_ACTION_VISIBILITY_RESET,
      this._onActionVisibilityReset,
    );

    // Outside-click handlers for tabs/floating palette modes (merged from a
    // former duplicate connectedCallback definition that never ran).
    document.addEventListener("mousedown", this._handleTabsOutsideClick);
    document.addEventListener("mousedown", this._handleFloatingOutsideClick);
  }

  set hass(hass) {
    const oldHass = this._hass;

    // Auto-resolve sensors on first hass set (setConfig may run before hass is available)
    if (this.config && hass) {
      this._autoResolveSensor("pixelart_sensor", "pixel_art", hass, this);
      if (!this.config.palette_sensor) {
        this._autoResolveSensor("palette_sensor", "color_palettes", hass, this);
        if (this.config.palette_sensor) this.paletteSensor = this.config.palette_sensor;
      }
    }

    const pixelartSensor = this.config?.pixelart_sensor;
    if (!pixelartSensor || !hass) {
      this._hass = hass;
      this._pixelArtOverlay = null;
      return;
    }

    // Check if we have an optimistically updated state that websocket might overwrite
    const incomingStateObj = hass.states[pixelartSensor];
    const incomingPixelArts = incomingStateObj?.attributes?.pixel_arts || [];

    this._pixelArtCollection?.observe(
      incomingPixelArts,
      incomingStateObj?.attributes?.count,
    );
    this._hass = hass;
    // A new hass replaces the previous snapshot, so any fresh/optimistic
    // overlay from the last one is dropped (re-applied below when still valid).
    this._pixelArtOverlay = null;
    if (this._pendingReorderedPixelArts && incomingStateObj) {
      this._hass = {
        ...hass,
        states: {
          ...hass.states,
          [pixelartSensor]: {
            ...incomingStateObj,
            attributes: {
              ...incomingStateObj.attributes,
              pixel_arts: this._pendingReorderedPixelArts,
            },
          },
        },
      };
    }

    // Check if pixel art sensor changed using COUNT or content_hash
    // (count alone won't detect renames since the list size stays the same)
    const stateObj = this._hass.states[pixelartSensor];
    if (!stateObj) return; // Sensor entity not (yet) available
    const prevCount = this._lastPixelArtCount;
    const currCount = stateObj?.attributes?.count;
    const prevHash = this._lastPixelArtHash;
    const currHash = stateObj?.attributes?.content_hash;

    // The global hass may carry a STALE pixel_arts array: HA doesn't push large
    // attributes over the state feed — only scalars like content_hash/count. So
    // `this._hass = hass` above can silently revert the gallery to pre-rename
    // data on any unrelated state change. If we've already fetched the array for
    // this exact content_hash, re-inject it to keep the fresh names. The
    // overlay is read through _pixelArtState() so we never copy hass.states.
    if (
      !this._pendingReorderedPixelArts &&
      this._freshPixelArts &&
      this._freshPixelArtsHash != null &&
      currHash === this._freshPixelArtsHash &&
      stateObj.attributes?.pixel_arts !== this._freshPixelArts
    ) {
      this._pixelArtOverlay = {
        sensorId: pixelartSensor,
        attributes: { pixel_arts: this._freshPixelArts },
      };
    }

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

    // Re-render only when something this card displays from the light changed:
    // text_colors (Lamp Palette), matrix_colors (Lamp Colors) and the theme
    // (dark-mode item borders), not on every light update, which would
    // re-render the whole gallery for unrelated changes. HA keeps unchanged
    // attribute values by reference across pushes.
    if (this.entity) {
      const lightState = this._hass.states[this.entity];
      if (lightState) {
        const cfg = this.config || {};
        const textColors =
          cfg.show_lamp_palette !== false
            ? lightState.attributes?.text_colors
            : undefined;
        const matrixColors =
          cfg.show_lamp_colors !== false
            ? lightState.attributes?.matrix_colors
            : undefined;
        const themes = hass.themes;
        if (
          textColors !== this._lastLampTextColors ||
          matrixColors !== this._lastLampMatrixColors ||
          themes !== this._lastLampThemes
        ) {
          this._lastLampTextColors = textColors;
          this._lastLampMatrixColors = matrixColors;
          this._lastLampThemes = themes;
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

  /**
   * The effective pixel-art sensor state: the hass state with the card's
   * fresh (REST-fetched) or optimistic pixel_arts overlay applied. The merged
   * object is cached per underlying state object, so repeated reads return the
   * same reference and no hass.states copy is ever made.
   */
  _pixelArtState(sensorId = this.config?.pixelart_sensor) {
    const raw = sensorId ? this._hass?.states?.[sensorId] : undefined;
    const overlay = this._pixelArtOverlay;
    if (!raw || !overlay || overlay.sensorId !== sensorId) return raw;
    if (overlay.base !== raw) {
      overlay.base = raw;
      overlay.state = {
        ...raw,
        attributes: { ...raw.attributes, ...overlay.attributes },
      };
    }
    return overlay.state;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._collectionContext = (this._collectionContext || 0) + 1;
    this._pixelArtCollection?.reset();
    this._fetchingPixelArts = false;
    window.removeEventListener(
      EVT_TOOL_VISIBILITY_RESET,
      this._onToolVisibilityReset,
    );
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

  _onToolVisibilityReset() {
    if (this.toolManager)
      this.toolManager.toolVisibility = this.toolManager.loadToolVisibility();
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

  // Card-internal config change (e.g. tools reordered by drag): update this
  // card's own config only. Nothing is broadcast, so other draw cards on the
  // dashboard are never affected.
  _updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    this.requestUpdate();
  }

  _matrixColorCount() {
    // Count pixels that are not null and not black
    return this.matrix.filter((c) => c && c.toLowerCase() !== "#000000").length;
  }

  setConfig(config) {
    config = resolvePreviewAppearance(normalizeCardOptions(config, "draw"), "draw");
    this._collectionContext = (this._collectionContext || 0) + 1;
    this._fetchingPixelArts = false;
    this._pixelArtCollection?.reset();
    this._commands?.reset();
    // Create a mutable copy of the config to allow adding new properties
    this.config = { ...config };

    // Auto-resolve the sensors when not configured explicitly.
    this._autoResolveSensor("pixelart_sensor", "pixel_art", this._hass);
    this._autoResolveSensor("palette_sensor", "color_palettes", this._hass);

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

    if (hasColorPicker && !hasEyedropper) {
      // If colorPicker exists but eyedropper doesn't, add eyedropper after colorPicker
      const colorPickerIndex = toolsArray.indexOf("colorPicker");
      toolsArray.splice(colorPickerIndex + 1, 0, "eyedropper");
      this.config.tools_order = toolsArray;
    } else if (hasEyedropper && !hasColorPicker) {
      // If eyedropper exists but colorPicker doesn't, add colorPicker before eyedropper
      const eyedropperIndex = toolsArray.indexOf("eyedropper");
      toolsArray.splice(eyedropperIndex, 0, "colorPicker");
      this.config.tools_order = toolsArray;
    }

    // The pairing fix-up above only touches this card's own fresh config copy;
    // it is intentionally not broadcast (it used to leak into other cards).

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

  // Service calls go through the card's command queue (card-command-controller):
  // sent in order, and results from a previous configuration are dropped.
  // They reject on failure (Home Assistant has already shown the error).

  // One call for all target lamps; the backend runs them in parallel.
  callServiceOnTargetEntities(service, data = {}, options = {}) {
    return this._commands.request(this.hass, this.config, service, data, options);
  }

  // Pixel-art services are global: sent once, without entity_id (an invalid
  // one causes "unknown.unknown" errors).
  callGlobalService(service, data = {}) {
    return this._commands.call(this.hass, "yeelight_cube", service, data);
  }

  // Ask Home Assistant to refresh a sensor now rather than at its next poll.
  _refreshEntity(entityId) {
    if (!entityId) return Promise.resolve(false);
    return this._commands.call(this.hass, "homeassistant", "update_entity", {
      entity_id: entityId,
    });
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

  /** Matrix HTML for one pixel art, cached per art object and config. */
  _pixelArtHTML(art) {
    if (!art || typeof art !== "object")
      return this._pixelArtMatrix(this._convertPixelArtToDisplayMatrix(art));
    const cfg = this.config;
    const cache = (this._pixelArtHTMLCache ||= new WeakMap());
    const hit = cache.get(art);
    if (hit && hit.cfg === cfg) return hit.html;
    const html = this._pixelArtMatrix(this._convertPixelArtToDisplayMatrix(art));
    cache.set(art, { cfg, html });
    return html;
  }

  /**
   * Return the cached HTML string for `slot` when the rendered items (by
   * identity) and deps are unchanged, so unrelated re-renders reuse the same
   * string (and unsafeHTML keeps its DOM); otherwise build and cache it.
   */
  _memoPixelArtHTML(slot, items, deps, build) {
    const memo = (this._pixelArtHTMLMemo ||= {});
    const prev = memo[slot];
    if (
      prev &&
      prev.items.length === items.length &&
      prev.items.every((item, i) => item === items[i]) &&
      prev.deps.every((dep, i) => dep === deps[i])
    )
      return prev.html;
    const html = build();
    memo[slot] = { items: items.slice(), deps, html };
    return html;
  }

  _pixelArtMatrix(pixelMatrix) {
    const cfg = this.config;
    const spacing = cfg.pixel_art_spacing_mode || "normal";
    return renderMatrixPreview(pixelMatrix, {
      rows: GRID_ROWS,
      cols: GRID_COLS,
      forceAspectRatio: true,
      bgColor: cfg.pixel_art_background_color || "transparent",
      pixelStyle: cfg.pixel_art_pixel_style || "square",
      pixelGap: spacing === "normal" ? 3 : 0,
      pixelBoxShadow: spacing !== "none",
      matrixBoxShadow: cfg.pixel_art_matrix_box_shadow === true,
      ignoreBlackPixels: cfg.gallery_ignore_black_pixels === true,
    });
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
        style="container-type:inline-size;width:${matrixWidth};max-width:100%;margin:0 auto;"
      >
        <div
          class="matrix"
          style="display:grid;grid-template-columns:repeat(${GRID_COLS},1fr);gap:${previewLength(
            pixelGap,
          )};background:${matrixBg};padding:${previewLength(
            8,
          )};border-radius:${previewLength(
            6,
          )};box-shadow:${cfg.matrix_box_shadow !== false
            ? `0 ${previewLength(2)} ${previewLength(8)} #0008`
            : "none"};width:100%;margin:0 auto;"
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
            if (pixelBoxShadow)
              shadowParts.push(`0 0 ${previewLength(2)} #0008`);
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
      </div>
    `;
  }

  _renderActionsSection() {
    return this._renderActions();
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
      <div class=${getActionRowClass({ buttonStyle, contentMode })}>
        ${showExportBtn
          ? html`
              <button
                class="${exportBtnClass}"
                @click="${() => this._exportPixelArts()}"
                title="Export all pixel arts as JSON file"
              >
                ${renderActionButtonContent(
                  "mdi:download",
                  "Export",
                  contentMode,
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
                ${renderActionButtonContent(
                  "mdi:upload",
                  "Import",
                  contentMode,
                  isImportStatus,
                  statusType,
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
    const showColorPicker = cfg.show_color_picker !== false;
    const showRecentColors = cfg.show_recent_colors !== false;
    const showLampPalette = cfg.show_lamp_palette !== false;
    const showLampColors = cfg.show_lamp_colors !== false;
    const showImagePalette = cfg.show_image_palette !== false;
    const showEraserTool = cfg.show_eraser_tool !== false;
    const showFillTool = cfg.show_fill_tool !== false;
    const showSend = cfg.show_send_button !== false;
    const showClear = cfg.show_clear_button !== false;
    const showSave = cfg.show_save_button !== false;
    const showUpload = cfg.show_upload_image_button !== false;
    const showPixelArtGallery = cfg.show_gallery !== false;
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
      <div class="yc-stack" style="margin:0 auto;">
        <div class="draw-container yc-stack">
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
    return cardShell(this, content);
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
    // K-means is expensive; memoise by the attribute's reference identity.
    const matrixColors = stateObj.attributes.matrix_colors;
    if (this._lampMatrixColorsRef !== matrixColors) {
      this._lampMatrixColorsRef = matrixColors;
      this._lampMatrixColorsCache = extractDiversePaletteWithWeights(
        matrixColors,
        MAX_IMAGE_PALETTE_COLORS,
      );
    }
    return this._lampMatrixColorsCache;
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
    return savePalette(
      (domain, service, data) =>
        this._commands.call(this.hass, domain, service, data),
      this.paletteSensor,
      colors,
      this.entity,
      name,
    ).catch((err) => this._reportFailure(err, "Failed to save the palette."));
  }

  // Log a failed action and show one toast, unless HA's callService already
  // showed one for this error (service errors are reported by HA itself).
  _reportFailure(err, message) {
    console.error(`[draw-card] ${message}`, err);
    notifyUnreported(this, err, message);
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
    await this._refreshEntity(this.config?.pixelart_sensor);
    // Fire pixelart-saved event
    window.dispatchEvent(new Event("pixelart-saved"));
  }

  /**
   * Send the drawing matrix to the lamps.
   * @param {Object} [options]
   * @param {boolean} [options.latestOnly] - for quick successive picks (the
   *   pixel-art gallery): a send still waiting in the queue is replaced by
   *   this one, and the lamp entity is not polled afterwards (it pushes its
   *   new state itself). Each click otherwise queues two calls, and a fast
   *   run of clicks piles them up behind each other.
   */
  async _sendToLamp({ latestOnly = false } = {}) {
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
    const sent = await this.callServiceOnTargetEntities(
      "apply_custom_pixels",
      { pixels },
      latestOnly ? { coalesce: "send-matrix" } : {},
    );
    if (latestOnly) return sent;
    // Also call update_entity for lamp entity or palette sensor
    await this._refreshEntity(this.entity || this.paletteSensor);
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

  _convertPixelArtToDisplayMatrix(art) {
    if (!art.pixels || !Array.isArray(art.pixels)) return createEmptyMatrix();

    const matrix = createEmptyMatrix();

    for (const px of expandPixelArt(art)) {
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

  _renderActions() {
    const cfg = this.config || {};
    const paintShape = cfg.button_shape || "rect";

    return this.actionManager.renderActionsSection(cfg, paintShape);
  }
}

defineOnce("yeelight-cube-draw-card", YeelightCubeDrawCard);

// Register with Home Assistant's card picker
registerCustomCard({
    type: "yeelight-cube-draw-card",
    name: "Yeelight Draw Card",
    description:
      "Draw pixel art and control your Yeelight Cube Lite matrix display.",
    preview: true,
  });
