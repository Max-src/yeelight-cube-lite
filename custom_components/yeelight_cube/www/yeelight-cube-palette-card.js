import {
  LitElement,
  html,
  unsafeHTML,
  unsafeCSS,
  nothing,
} from "./lib/lit-all.js";

import { rgbToCss } from "./yeelight-cube-dotmatrix.js";

import { getDeleteButtonConfig } from "./delete-button-styles.js";

import { setupAlbumNavigation } from "./album-view-coverflow.js";
import { attachCarouselSwipe } from "./carousel-utils.js";

import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import { cardNotice, cardShell, isActivationKey } from "./card-shell.js";
import { CollectionState } from "./collection-state.js";
import { notify, notifyUnreported } from "./notify-utils.js";
import {
  normalizeImportedPalettes,
  MAX_PALETTE_IMPORT_BYTES,
} from "./palette-data-utils.js";
import { renderPagination } from "./pagination-utils.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { PaletteGalleryMixin } from "./palette-card-gallery.js";
import { PALETTE_CARD_CSS, paletteStyleVars } from "./palette-card-styles.js";

class YeelightCubePaletteCard extends PaletteGalleryMixin(YeelightCardMixin(LitElement)) {
  static editor = ["yeelight-cube-palette-card-editor", "./yeelight-cube-palette-card-editor.js"];
  // Static: the config-dependent values are CSS variables (paletteStyleVars).
  static styles = unsafeCSS(PALETTE_CARD_CSS);

  constructor() {
    super();
    // Every lamp/sensor call of this card goes through the card's queue
    // (this._commands; palette collection edits use _collection).
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
  // (album, carousel). Colors come from rgbToCss, which only emits rgb().
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
    this._commands?.reset();
    // target_entities is not defaulted: `entity` covers single-lamp configs
    // (getTargetEntities falls back to it when the list is missing or empty).
    this.config = {
      palette_sensor: config.palette_sensor,
      ...config,
    };

    // Auto-resolve palette_sensor if not explicitly configured
    this._autoResolveSensor("palette_sensor", "color_palettes", this._hass);

    this._configGeneration++;
    this.requestUpdate();
  }

  static getStubConfig(hass) {
    const firstEntity = cubeLampEntities(hass)[0] || "";
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
    this._autoResolveSensor("palette_sensor", "color_palettes", hass, this);

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
    if (!stateObj)
      return cardNotice(this, `Palette sensor not found: ${entityId}`);

    const palettes =
      this._localPalettes !== undefined
        ? this._localPalettes
        : this._sensorPalettes();

    const btnCfg = getDeleteButtonConfig(this.config);
    const showRemove = btnCfg.allowDelete;
    const removeBtnClass = btnCfg.classes;
    const showExport = this.config.show_export_button !== false;
    const showImport = this.config.show_import_button !== false;
    const showPaletteTitle = this.config.show_palette_title !== false;
    const showColorCount = this.config.show_color_count !== false;
    const allowTitleEdit = this._allowTitleEdit();

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
      style=${paletteStyleVars(this.config)}
      @click=${this._contentClick}
      @keydown=${this._onContentKeydown}
    >
      ${content}${this._renderPaletteExportImportButtons(
        showExport,
        showImport,
      )}
    </div>`;

    return html`
      ${cardShell(this, body, {
        // "Allow title edit" renames the card title too (until reloaded).
        onTitleClick: allowTitleEdit
          ? (title) => this._editCardTitle(title)
          : undefined,
      })}
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
        `${skipped} palette${skipped === 1 ? " was" : "s were"} skipped: colors must be [R, G, B] values from 0 to 255 or #hex.`,
      );
  }

  // Apply a palette by index, sending the name seen at that index so the
  // backend refuses the call if another client changed the list meanwhile.
  // Never rejects: failures are logged by the service helper and reported once.
  _applyPalette(idx) {
    return this.callServiceOnTargetEntities(
      "load_palette",
      { idx, expected_name: this._paletteItems()[idx]?.name },
      // Quick successive picks only send the latest one.
      { coalesce: "select" },
    ).catch((error) =>
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

  // One call for all target lamps (the backend runs them in parallel), through
  // the card's command queue: sent in order, results from a previous
  // configuration dropped. Rejects on failure (HA has already shown it).
  // options.coalesce: see CardCommandController.execute.
  callServiceOnTargetEntities(service, data = {}, options = {}) {
    return this._commands.request(
      this._hass,
      this.config,
      service,
      data,
      options,
    );
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
              await this._commands.call(
                this._hass,
                "homeassistant",
                "update_entity",
                { entity_id: paletteSensor },
              );
            }
          })
          .catch((error) => this._notifyUnreported(error));
      };
      reader.readAsText(file);
    });
    input.click();
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
