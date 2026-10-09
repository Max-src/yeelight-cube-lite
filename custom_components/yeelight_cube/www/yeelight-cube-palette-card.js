import { LitElement, html, unsafeCSS, nothing } from "./lib/lit-all.js";

import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import { cardNotice, cardShell } from "./card-shell.js";
import { notify, notifyUnreported } from "./notify-utils.js";
import {
  normalizeImportedPalettes,
  MAX_PALETTE_IMPORT_BYTES,
} from "./palette-data-utils.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { normalizeCardOptions } from "./card-config.js";
import { CollectionStore } from "./user-collections.js";
import { getTargetEntities } from "./service-call-utils.js";
import "./collection-gallery.js";
import {
  colorCountLabel,
  paletteGradient,
  palettePreviewHtml,
} from "./palette-preview.js";
import { renderExportImportRow } from "./action-button-ui.js";
import { PALETTE_CARD_CSS } from "./palette-card-styles.js";

// A palette's gallery key: its index in the sensor's list. Commands also
// send the name seen at that index (expected_name), so the backend refuses
// them if another client changed the list meanwhile.
const paletteKey = (idx) => `palette:${idx}`;
const paletteIndex = (key) => Number(String(key).slice("palette:".length));

class YeelightCubePaletteCard extends YeelightCardMixin(LitElement) {
  static editor = ["yeelight-cube-palette-card-editor", "./yeelight-cube-palette-card-editor.js"];
  static styles = unsafeCSS(PALETTE_CARD_CSS);

  constructor() {
    super();
    // Every lamp/sensor call of this card goes through the card's queue
    // (this._commands); the palettes are read and edited through the
    // shared collection store (kept fresh, edits shown at once).
    this._hass = null;
    this.config = {};
    this._store = new CollectionStore("palettes", {
      onChange: () => this.requestUpdate(),
    });
    this._importStatus = { active: false, success: false };
  }

  setConfig(config) {
    this._store.reset();
    this._commands?.reset();
    // target_entities is not defaulted: `entity` covers single-lamp configs
    // (getTargetEntities falls back to it when the list is missing or empty).
    this.config = { ...normalizeCardOptions(config, "palette") };

    // Auto-resolve palette_sensor if not explicitly configured
    this._autoResolveSensor("palette_sensor", "color_palettes", this._hass);
    this.requestUpdate();
  }

  static getStubConfig(hass) {
    const firstEntity = cubeLampEntities(hass)[0] || "";
    return {
      type: "custom:yeelight-cube-palette-card",
      target_entities: firstEntity ? [firstEntity] : [],
      style_selector_style: "preview-album",
      swatch_style: "gradient-bg",
      show_color_count: false,
      show_search: false,
      selector_shape: "custom",
      item_radius: 16,
      gallery_background_color: "transparent",
      item_card_border: "always",
      remove_button_style: "none",
      buttons_style: "gradient",
      preview_size: 50,
      items_per_page: 12,
      delete_button_inside: false,
    };
  }

  get hass() {
    return this._hass;
  }

  /**
   * Home Assistant state: the palettes come from the shared collection
   * store, which keeps them fresh and shows this card's edits until the
   * backend confirms them (user-collections.js). The card has no reactive
   * properties: it re-renders only when what it shows changed, never for
   * unrelated entities.
   */
  set hass(hass) {
    this._hass = hass;
    // Auto-resolve palette_sensor on first hass set (setConfig may run before hass is available)
    this._autoResolveSensor("palette_sensor", "color_palettes", hass, this);
    if (!hass) return;
    // The lamps' colors decide the active palette (_activePaletteKey).
    const textColors = this._lampTextColors();
    const lampChanged = textColors !== this._lastTextColors;
    this._lastTextColors = textColors;
    if (this._store.update(hass, this.config) || lampChanged) this.requestUpdate();
  }

  // The first target lamp's text colors (applying a palette sets them).
  _lampTextColors() {
    const entity = getTargetEntities(this.config)[0];
    return this._hass?.states?.[entity]?.attributes?.text_colors;
  }

  // The palette the lamps show: the one whose colors are their text colors.
  _activePaletteKey(palettes) {
    const colors = this._lampTextColors();
    if (!Array.isArray(colors) || !colors.length) return null;
    const rgb = (list) =>
      JSON.stringify(list.map((color) => (Array.isArray(color) ? color.slice(0, 3).map(Number) : color)));
    const shown = rgb(colors);
    const index = palettes.findIndex((palette) => rgb(palette.colors || []) === shown);
    return index < 0 ? null : paletteKey(index);
  }

  // The palettes as gallery items: a preview in the card's swatch style,
  // the blend as chip swatch, the color count under the preview. Every
  // palette is the user's own (renamed and deleted for real).
  _galleryItems(palettes) {
    const style = this.config.swatch_style || "square";
    const showCount = this.config.show_color_count !== false;
    return palettes.map((palette, idx) => {
      const colors = Array.isArray(palette.colors) ? palette.colors : [];
      const name = palette.name || `Palette ${idx + 1}`;
      return {
        dataMode: paletteKey(idx),
        name,
        title: name,
        swatch: paletteGradient(colors),
        previewHtml: palettePreviewHtml(colors, style),
        meta: showCount ? colorCountLabel(colors) : undefined,
        editable: true,
      };
    });
  }

  // The palettes shown: this card's pending edit, else the freshest array.
  _paletteItems() {
    return this._store.items(this._hass, this.config);
  }

  render() {
    const hass = this._hass;
    const entityId = this.config.palette_sensor;
    if (!hass || !entityId) {
      return nothing;
    }
    const stateObj = hass.states[entityId];
    if (!stateObj)
      return cardNotice(this, `Palette sensor not found: ${entityId}`);

    const palettes = this._paletteItems();
    const body = html`<div class="card-content yc-stack">
      <yc-collection-gallery
        .config=${this.config}
        .items=${this._galleryItems(palettes)}
        .active=${this._activePaletteKey(palettes)}
        searchLabel="Search palettes"
        actionLabel="Apply to the lamps"
        .navigateSelects=${false}
        emptyLabel="No palettes found. Add palettes to see them here."
        .onSelect=${(key) => this._applyPalette(paletteIndex(key))}
        .onRename=${(key, name) => this._renamePalette(paletteIndex(key), name)}
        .onDelete=${(key) => this._deletePalette(paletteIndex(key))}
      ></yc-collection-gallery>
      ${this._renderPaletteExportImportButtons(
        this.config.show_export_button !== false,
        this.config.show_import_button !== false,
      )}
    </div>`;

    return cardShell(this, body);
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

  // An edit of the palettes: shown at once, then saved. Resolves true once
  // saved, false when refused or failed (rolled back; service failures were
  // already shown by HA, only a local conflict is reported here).
  _mutatePalettes(items, service, data) {
    return this._store.edit(this._hass, items, service, data, {
      onError: (error) => this._notifyUnreported(error),
    });
  }

  _deletePalette(idx) {
    const palettes = this._paletteItems();
    if (!palettes[idx]) return false;
    return this._mutatePalettes(
      palettes.filter((_, i) => i !== idx),
      "remove_palette",
      { idx, expected_name: palettes[idx].name },
    );
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

  // Rename the palette at `idx` (the gallery's rename bar gives the name).
  _renamePalette(idx, newName) {
    const name = String(newName ?? "").trim();
    const palettes = this._paletteItems();
    if (!name || !palettes[idx]) return false;
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
      encodeURIComponent(JSON.stringify(this._paletteItems(), null, 2));
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

  // The export / import row (shared: renderExportImportRow).
  _renderPaletteExportImportButtons(showExport, showImport) {
    const status = this._importStatus;
    return renderExportImportRow({
      noun: "palettes",
      showExport,
      showImport,
      buttonStyle: this.config.buttons_style || "modern",
      contentMode: this.config.buttons_content_mode || "icon_text",
      importStatus: status.active ? (status.success ? "success" : "error") : null,
      onExport: () => this._exportPalettes(),
      onImport: () => this._importPalettes(),
    });
  }

  connectedCallback() {
    super.connectedCallback();
    // State was reset on disconnect; show current data when re-attached.
    if (this._hass) this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._importStatusTimer);
    this._importStatus = { active: false, success: false };
    // Late results of this connection are dropped.
    this._store.reset();
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
