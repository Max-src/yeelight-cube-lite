import { resolvePreviewAppearance } from "./preview-appearance.js";
import { LitElement, html } from "./lib/lit-all.js";

import { parseConfig } from "./draw_card_state.js";
import { drawCardStyles } from "./draw_card_styles.js";

import { renderExportImportRow } from "./action-button-ui.js";

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
import { normalizeHex, extractDiversePaletteWithWeights } from "./draw_utils.js";
import { isDarkTheme, rgbToHex } from "./color-utils.js";
import { OFF_COLOR } from "./draw_card_const.js";
import { matrixFrame } from "./matrix-frame.js";
import {
  artOrientation,
  deviceOrientation,
  fromDisplayOrder,
  isVerticalArt,
  isVerticalMount,
  matrixView,
} from "./matrix-view.js";
import { StorageUtils } from "./draw_card_storage.js";

import { notifyUnreported } from "./notify-utils.js";
import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import { cardShell, lampUnavailableLine } from "./card-shell.js";
import { previewOnly } from "./offline-preview-state.js";
import { normalizeCardOptions } from "./card-config.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { PaletteCardsMixin } from "./draw-card-palette-cards.js";
import { PixelArtActionsMixin } from "./draw-card-pixel-art-actions.js";
import {
  MY_DRAWINGS,
  PIXEL_ART_ORIENTATIONS,
  builtinArtKey,
  defaultPixelArtOrientation,
  drawingPixels,
  loadBuiltinPixelArts,
  matchesPixelArtOrientation,
  pixelArtColorData,
  pixelArtSections,
  shownBuiltinPixelArts,
} from "./pixel-art-utils.js";
import { CollectionStore } from "./user-collections.js";
import "./collection-gallery.js";

const MAX_IMAGE_PALETTE_COLORS = 15;

// A pixel art's gallery key: its index in the stored list. Commands also
// send the name seen at that index (expected_name), so the backend refuses
// them if another client changed the list meanwhile.
const artKey = (idx) => `art:${idx}`;
const artIndex = (key) => Number(String(key).slice("art:".length));

class YeelightCubeDrawCard extends PixelArtActionsMixin(
  PaletteCardsMixin(YeelightCardMixin(LitElement)),
) {
  static editor = ["yeelight-cube-draw-card-editor", "./yeelight-cube-draw-card-editor.js"];
  static cardSize = 10; // Dashboard height (card-base): colors, tools, matrix


  static getStubConfig(hass) {
    const firstEntity = cubeLampEntities(hass)[0] || "";
    return {
      type: "custom:yeelight-cube-draw-card",
      entity: firstEntity,
      target_entities: firstEntity ? [firstEntity] : [],
      pixel_spacing_mode: "normal",
      matrix_bg: "black",
      matrix_box_shadow: true,
      gallery_spacing_mode: "normal",
      preview_show_titles: true,
      allow_rename: false,
      matrix_size: 100,
      tool_buttons_shape: "round",
      actions_buttons_style: "gradient",
      actions_content_mode: "icon_text",
      tool_buttons_style: "icon",
      tool_content_mode: "icon",
      swatch_shape: "round",
      expand_btn_mode: "label",
      preview_size: 82,
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
      pixel_art_orientation: "all",
      show_pixelart_export_button: true,
      show_pixelart_import_button: true,
      palette_card_mode: "tabs",
      items_per_page: 3,
      style_selector_style: "preview-carousel",
      show_search: false,
      selector_shape: "custom",
      item_radius: 16,
      item_card_border: "auto",
      gallery_background_color: "black",
      pixelart_buttons_style: "icon",
      swatch_expand_style: "pill",
      swatch_layout: "row",
      color_info_display: "name",
      matrix_pixel_style: "circle",
      remove_button_style: "black",
      delete_button_inside: true,
      pixelart_content_mode: "icon",
      gallery_pixel_style: "circle",
    };
  }

  static getStorageUtils() {
    return StorageUtils;
  }

  static properties = {
    matrix: { type: Array },
    selectedColor: { type: String },
    isDrawing: { type: Boolean },
    hass: { type: Object },
    pixelArtVersion: { type: Number },
  };

  static styles = drawCardStyles;

  constructor() {
    super();
    this.matrix = StorageUtils.loadMatrix();
    // The drawing area's view, chosen with Rotate or by loading a pixel art
    // (null: follows the lamp's orientation, _drawingVertical).
    this._drawVertical = StorageUtils.loadDrawingView();
    this._matrixHistory = [];
    this._renderScheduled = false;

    // Initialize managers
    this.toolManager = new ToolManager(this);
    this.actionManager = new ActionManager(this);
    this.matrixOperations = new MatrixOperations1D(this);

    this.selectedColor = "#ff0000";
    this.isDrawing = false;
    this.hass = null;
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
    // The pixel arts: read and edited through the shared collection store
    // (kept fresh, this card's edits shown until confirmed).
    this._pixelArtStore = new CollectionStore("pixel_arts", {
      onChange: () => this._schedulePixelArtRender(),
    });
  }

  // One re-render per frame for pixel-art changes (a fetch landing, an edit).
  _schedulePixelArtRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
      this.requestUpdate("hass");
    });
  }

  // The pixel arts shown: this card's pending edit, else the freshest array.
  _pixelArts() {
    return this._pixelArtStore.items(this._hass, this.config);
  }

  // The pixel-art sensor's state (undefined while it does not exist).
  _pixelArtSensorState() {
    const sensor = this.config?.pixelart_sensor;
    return sensor ? this._hass?.states?.[sensor] : undefined;
  }

  connectedCallback() {
    super.connectedCallback();
    // No window "config-changed" listener: HA delivers editor changes through
    // setConfig() on the edited card only; a window bus leaked one card's
    // config (entity, sensors, tools) into every draw card on the dashboard.
  }

  set hass(hass) {
    const oldHass = this._hass;

    // The collection sensors: found on the first hass (setConfig may run
    // before it), and again if renamed.
    if (this.config && hass) {
      this._autoResolveSensor("pixelart_sensor", "pixel_arts", hass, this);
      this._autoResolveSensor("palette_sensor", "palettes", hass, this);
      this.paletteSensor = this.config.palette_sensor || null;
    }

    this._hass = hass;
    if (!hass) return;
    this._loadBuiltinPixelArts(hass);
    // The pixel arts (a new content, a fetch, a confirmed edit): the store
    // compares the sensor's hash and refreshes the gallery only.
    if (this.config?.pixelart_sensor && this._pixelArtStore.update(hass, this.config))
      this._schedulePixelArtRender();
    if (!this._hassChanged(hass)) return;
    // One render per frame for bursts of pushes.
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.requestUpdate("hass", oldHass);
      });
    }
  }

  // What the card shows from hass (card-base _hassChanged): the lamp's
  // colors (Lamp Palette, Lamp Colors) when shown, whether it is
  // unavailable (the shared line) and the theme (dark-mode borders); not the
  // lamp's other attributes, which would re-render the whole card for
  // nothing. The pixel arts follow their store (set hass).
  _hassInputs(hass) {
    const cfg = this.config || {};
    const lamp = hass?.states?.[this._primaryEntity(hass)]?.attributes;
    return [
      this.config,
      hass?.themes,
      previewOnly({ config: cfg, _hass: hass }),
      cfg.show_lamp_palette !== false ? lamp?.text_colors : undefined,
      cfg.show_lamp_colors !== false ? lamp?.matrix_colors : undefined,
      // The drawing area (until one is chosen) and the gallery's default
      // orientation ("lamp") follow the lamp's orientation.
      lamp?.device_orientation,
    ];
  }

  /** The orientation the pixel-art gallery shows: the one picked in its
   * filter (kept in this browser), else the card's default. */
  _pixelArtOrientation() {
    if (this._pickedArtOrientation) return this._pickedArtOrientation;
    const lamp = this._hass?.states?.[this._primaryEntity(this._hass)];
    return defaultPixelArtOrientation(
      this.config,
      isVerticalMount(deviceOrientation(lamp?.attributes)),
    );
  }

  _pickPixelArtOrientation(value) {
    this._pickedArtOrientation = value;
    StorageUtils.saveArtOrientation(value, this.config?.pixel_art_orientation);
    this.requestUpdate();
  }

  /** The gallery's orientation filter (collection-gallery.js `filter`): the
   * same object while nothing changes, so a stroke never re-renders the
   * galleries. */
  _pixelArtFilter() {
    const value = this._pixelArtOrientation();
    const hidden = this.config?.pixel_art_orientation_filter === false;
    const cached = this._pixelArtFilterCache;
    if (cached?.value !== value || cached?.hidden !== hidden)
      this._pixelArtFilterCache = {
        label: "Pixel art orientation",
        value,
        hidden,
        choices: PIXEL_ART_ORIENTATIONS,
        match: matchesPixelArtOrientation,
        onChange: (choice) => this._pickPixelArtOrientation(choice),
      };
    return this._pixelArtFilterCache;
  }

  /** Whether the drawing area is vertical: as chosen (Rotate, a loaded
   * pixel art), else as the lamp stands (Down / Up orientation). */
  _drawingVertical() {
    if (this._drawVertical != null) return this._drawVertical;
    const lamp = this._hass?.states?.[this._primaryEntity(this._hass)];
    return isVerticalMount(deviceOrientation(lamp?.attributes));
  }

  /** The drawing area's geometry (matrix-view.js): its columns and rows and
   * the pixel each cell shows. */
  _drawingView() {
    return matrixView(this._drawingVertical());
  }

  /** Show the drawing landscape or vertical (remembered in this browser). */
  _setDrawingVertical(vertical) {
    this._drawVertical = !!vertical;
    StorageUtils.saveDrawingView(this._drawVertical);
    this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._pixelArtStore.reset();

    // Clear pending timers
    if (this._applyPixelArtTimer) {
      clearTimeout(this._applyPixelArtTimer);
      this._applyPixelArtTimer = null;
    }
  }

  // The official pixel arts, once (pixel-art-utils loadBuiltinPixelArts):
  // the gallery shows them when they arrive.
  _loadBuiltinPixelArts(hass) {
    if (this._builtinPixelArts || this._builtinPixelArtsLoading) return;
    this._builtinPixelArtsLoading = loadBuiltinPixelArts(hass)
      .then((arts) => {
        this._builtinPixelArts = arts;
        this._schedulePixelArtRender();
      })
      .catch((error) => console.warn("[draw-card] Official pixel arts unavailable:", error))
      .finally(() => {
        this._builtinPixelArtsLoading = null;
      });
  }

  _matrixColorCount() {
    // Count pixels that are not null and not black
    return this.matrix.filter((c) => c && c.toLowerCase() !== "#000000").length;
  }

  setConfig(config) {
    config = resolvePreviewAppearance(normalizeCardOptions(config, "draw"), "draw");
    this._pixelArtStore.reset();
    this._commands?.reset();
    // Create a mutable copy of the config to allow adding new properties
    this.config = { ...config };
    // The orientation picked in the gallery's filter under this default.
    this._pickedArtOrientation = StorageUtils.loadArtOrientation(
      this.config.pixel_art_orientation,
    );

    // Auto-resolve the sensors when not configured explicitly.
    this._autoResolveSensor("pixelart_sensor", "pixel_arts", this._hass);
    this._autoResolveSensor("palette_sensor", "palettes", this._hass);

    // The tools' and actions' order and visibility are read where they are
    // shown (draw_card_tools.js: toolsOrder, actionsOrder, hidden*).

    const parsed = parseConfig(this.config);
    this.paletteSensor = parsed.paletteSensor;
    // A new config renders now (config is not a reactive property).
    this.requestUpdate();

    // Do NOT reset this.matrix here!
  }

  // Service calls go through the card's command queue (card-command-controller):
  // sent in order, and results from a previous configuration are dropped
  // (the lamps' services: callServiceOnTargetEntities, card-base.js).
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
      <div class="palettes">
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

  /**
   * The pixel-art gallery: the shared gallery (collection-gallery.js) with
   * the stored pixel arts (with this card's pending edits) and the official
   * ones. Picking one loads it into the drawing, and sends it to the lamp
   * too with "Apply to lamp automatically". With official ones, the groups
   * (All, My drawings, each collection) are the shared section layouts
   * (<yc-sections>, the same choices as the color sections), one gallery
   * each; only the sections shown are rendered.
   */
  _renderPixelArtGallery() {
    const cfg = this.config || {};
    if (!this.hass || !this._pixelArtSensorState())
      return html`<div class="pixelart-gallery-message">
        Pixel art sensor not found or not configured.
      </div>`;
    const items = this._pixelArtGalleryItems(this._pixelArts());
    const sections = this._pixelArtSectionsCache;
    if (!sections.length) return this._pixelArtGallery(items);
    const border = cfg.pixel_art_groups_border || "auto";
    return html`<yc-sections
      layout=${cfg.pixel_art_groups_layout || "tabs"}
      .sections=${sections.map((section) => ({
        key: section.key,
        title: section.title,
        icon: section.icon,
        empty: !section.items.length,
        content: () => this._pixelArtGallery(section.items),
      }))}
      .options=${{
        style: cfg.pixel_art_groups_style || "subtle",
        bordered: border === "always" || (border === "auto" && isDarkTheme(this, this.hass)),
        width: cfg.pixel_art_groups_width || 100,
        zoom: cfg.pixel_art_groups_zoom === "on",
        radius: cfg.pixel_art_groups_radius,
        buttonShape: cfg.pixel_art_groups_button_shape || "rounded",
        wrap: cfg.pixel_art_groups_wrap === true,
        overlay: cfg.pixel_art_groups_overlay === true,
        // Preview Hover renders the galleries in its own shadow root.
        contentStyles: this.constructor.styles,
        tabIcons: cfg.pixel_art_groups_tab_icons === true,
        headers: cfg.pixel_art_groups_headers !== false,
        label: "Pixel art collections",
        emptyLabel: "No pixel art",
      }}
    ></yc-sections>`;
  }

  // One gallery of pixel arts (`items`: all of them, or a section's).
  _pixelArtGallery(items) {
    const cfg = this.config || {};
    const autoApply = cfg.pixel_art_auto_apply_to_lamp === true;
    return html`<yc-collection-gallery
      .config=${cfg}
      .items=${items}
      .active=${this._activePixelArtKey()}
      .filter=${this._pixelArtFilter()}
      searchLabel="Search pixel arts"
      emptyLabel="No pixel art saved yet."
      .navigateSelects=${false}
      actionLabel=${autoApply ? "Load into the drawing and the lamp" : "Load into the drawing"}
      .onSelect=${(key) =>
        String(key).startsWith("builtin:")
          ? this._handleBuiltinPixelArtClick(key, autoApply)
          : this._handlePixelArtCanvasClick(artIndex(key), autoApply)}
      .onRename=${(key, name) => this._renamePixelArt(artIndex(key), name)}
      .onDelete=${(key) => this._deletePixelArt(artIndex(key))}
    ></yc-collection-gallery>`;
  }

  // The pixel arts as gallery items: the user's own ("My drawings", renamed
  // and deleted in the gallery), then the official ones the card shows
  // (shownBuiltinPixelArts; in their collections' sections, named and hidden
  // in the editor), and their sections (pixelArtSections). Memoized by what
  // they come from: the card re-renders on every stroke, the galleries only
  // when they change.
  _pixelArtGalleryItems(arts) {
    const builtins = this._builtinPixelArts || null;
    const source = this._galleryItemsSource;
    if (
      source?.arts !== arts ||
      source?.builtins !== builtins ||
      source?.config !== this.config
    ) {
      this._galleryItemsSource = { arts, builtins, config: this.config };
      // Each art's picture as a key, to find the one on the canvas (the
      // user's own first).
      this._artByPicture = new Map();
      const item = (art, key, extra) => {
        const name = art?.name || "Unnamed";
        const colorData = pixelArtColorData(art);
        const picture = colorData.map((color) => rgbToHex(color)).join(",");
        if (!this._artByPicture.has(picture)) this._artByPicture.set(picture, key);
        return {
          dataMode: key,
          name,
          title: name,
          colorData,
          // Drawn for a lamp standing on its end: shown so (the app's way).
          vertical: isVerticalArt(art),
          ...extra,
        };
      };
      this._galleryItemsCache = [
        ...arts.map((art, idx) =>
          item(art, artKey(idx), { editable: true, group: MY_DRAWINGS }),
        ),
        ...shownBuiltinPixelArts(builtins || [], this.config).map((art) =>
          item(art, builtinArtKey(art), { group: art.collection }),
        ),
      ];
      this._pixelArtSectionsCache = pixelArtSections(this._galleryItemsCache);
    }
    return this._galleryItemsCache;
  }

  // The pixel art on the canvas (the drawing is exactly that art), if any.
  _activePixelArtKey() {
    const picture = this.matrix
      .map((color) => (color || OFF_COLOR).toLowerCase())
      .join(",");
    return this._artByPicture?.get(picture) ?? null;
  }

  _renderMatrixSection(cfg, pixelGap, matrixBg, matrixWidth, matrixPixelStyle) {
    const pixelBoxShadow =
      cfg.pixel_spacing_mode === "subtle" || cfg.pixel_spacing_mode === "normal";
    // The area's view (landscape or vertical) in every preview's frame
    // (matrix-frame.js): a vertical one keeps the landscape pixel size.
    const view = this._drawingView();
    const frame = matrixFrame({
      width: matrixWidth,
      vertical: view.vertical,
      gap: pixelGap,
      padding: 8,
      radius: 6,
      background: matrixBg,
      shadow: cfg.matrix_box_shadow !== false,
    });
    const length = frame.length;

    return html`
      <div style="${frame.wrapperStyle}margin:0 auto;">
        <div
          class="matrix"
          data-vertical=${view.vertical ? "true" : "false"}
          style="${frame.gridStyle}margin:0 auto;"
          @mousedown=${(e) => startDraw(this, e)}
          @mouseup=${(e) => endDraw(this, e)}
          @mouseleave=${() => onMatrixMouseLeave(this)}
          @mousemove=${(e) => drawMove(this, e)}
          @touchstart=${(e) => startDraw(this, e)}
          @touchend=${(e) => endDraw(this, e)}
          @touchcancel=${(e) => endDraw(this, e)}
          @touchmove=${(e) => drawMove(this, e)}
        >
          ${view.source.map((idx) => {
            const color = this.matrix[idx];
            let previewStyle = "";
            const shadowParts = [];
            if (pixelBoxShadow) shadowParts.push(`0 0 ${length(2)} #0008`);
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

  // The export / import row (shared: renderExportImportRow).
  _renderPixelArtExportImportButtons(showExportBtn, showImportBtn) {
    const cfg = this.config || {};
    return renderExportImportRow({
      noun: "pixel arts",
      showExport: showExportBtn,
      showImport: showImportBtn,
      buttonStyle: cfg.pixelart_buttons_style || "modern",
      contentMode: cfg.pixelart_content_mode || "icon_text",
      importStatus: this._importStatus?.showing ? this._importStatus.type : null,
      onExport: () => this._exportPixelArts(),
      onImport: () => this._triggerImportFile(),
    });
  }

  render() {
    const cfg = this.config || {};
    // Older options arrive in today's values (normalizeCardOptions and
    // resolvePreviewAppearance: pixel_spacing, matrix_size words).
    const pixelGap = cfg.pixel_spacing_mode === "normal" ? 3 : 0;
    const matrixBg = cfg.matrix_bg || "black";
    const matrixWidth = `${cfg.matrix_size ?? 100}%`;
    const showRecentColors = cfg.show_recent_colors !== false;
    const showLampPalette = cfg.show_lamp_palette !== false;
    const showLampColors = cfg.show_lamp_colors !== false;
    const showImagePalette = cfg.show_image_palette !== false;
    const showPixelArtGallery = cfg.show_gallery !== false;
    const matrixPixelStyle = cfg.matrix_pixel_style || "square";
    const paintShape = cfg.tool_buttons_shape || "rounded";
    const paintContent = cfg.paint_button_content || "icon";

    // Check section visibility
    const showColors = cfg.show_colors_section !== false;
    const showTools = cfg.show_tools_section !== false;
    const showMatrix = cfg.show_matrix_section !== false;
    const showActions = cfg.show_actions_section !== false;
    const showPixelArtSection = cfg.show_pixelart_section !== false;

    // Drawing and saving work without the lamp: a missing or unavailable
    // one is a line, like on the Clock and Native Effects cards.
    const offline = this._targets.length > 0 && previewOnly(this);

    const content = html`
      <div class="yc-stack" style="margin:0 auto;">
        <div class="draw-container yc-stack">
          ${offline ? lampUnavailableLine() : ""}
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
    this._selectColor(normalizeHex(e.target.value));
  }

  /** The drawing color (picked in a color section or the picker). */
  _selectColor(color) {
    this.selectedColor = color;
  }

  getLampGradientColors() {
    if (!this.hass || !this._primaryEntity()) return [];
    const stateObj = this.hass.states[this._primaryEntity()];
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
    if (!this.hass || !this._primaryEntity()) return { palette: [], weights: null };
    const stateObj = this.hass.states[this._primaryEntity()];
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
      this._primaryEntity(),
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
    // Saved with the area's view: a vertical drawing is shown standing up.
    await this.callGlobalService("save_pixel_art", {
      pixels: drawingPixels(this.matrix),
      orientation: artOrientation(this._drawingVertical()),
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
   * @param {string} [options.name] - the pixel art the drawing is (one just
   *   picked in the gallery), shown by the lamp's Pixel Art select; without
   *   it the drawing is the user's own and the select is cleared.
   */
  async _sendToLamp({ latestOnly = false, name } = {}) {
    if (!this.hass) return;
    const pixels = drawingPixels(this.matrix);
    const sent = await this.callServiceOnTargetEntities(
      "apply_custom_pixels",
      name ? { pixels, name } : { pixels },
      latestOnly ? { coalesce: "send-matrix" } : {},
    );
    if (latestOnly) return sent;
    // Also call update_entity for lamp entity or palette sensor
    await this._refreshEntity(this._primaryEntity() || this.paletteSensor);
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
        // The image scaled to the drawing area as it is shown (landscape or
        // vertical), then read back into the drawing's order.
        const { cols, rows, vertical } = this._drawingView();
        const canvas = document.createElement("canvas");
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, cols, rows);
        const imgData = ctx.getImageData(0, 0, cols, rows).data;
        const cells = Array.from({ length: cols * rows }, (_, i) =>
          rgbToHex([imgData[i * 4], imgData[i * 4 + 1], imgData[i * 4 + 2]]),
        );
        this._pushMatrixHistory();
        this.matrix = fromDisplayOrder(cells, vertical);
        StorageUtils.saveMatrix(this.matrix);
        this.requestUpdate();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  _renderActions() {
    return this.actionManager.renderActionsSection(this.config || {});
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
