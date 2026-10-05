import { LitElement, html, repeat, nothing } from "./lib/lit-all.js";
import { getActionRowClass, getExportImportButtonClass } from "./action-button-utils.js";
import { renderActionButtonContent } from "./action-button-ui.js";

import {
  openColorPicker,
  closeColorPicker,
  bindColorPickerTrigger,
} from "./color-picker-utils.js";
import { getDeleteButtonClass, getButtonPositionStyles } from "./delete-button-styles.js";

import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampNotFoundNotice,
  NOTICE,
} from "./card-shell.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { ColorListLayoutsMixin } from "./color-list-layouts.js";
import { ColorListDragMixin } from "./color-list-drag.js";
import { ColorInfoMixin } from "./color-list-color-info.js";
import { COLOR_LIST_EDITOR_STYLES } from "./color-list-editor-styles.js";

// Global storage for pending (optimistic) colors per entity (shared across all
// card instances).  Entries are { colors, ts }.  The cache only exists to
// bridge the short gap until the backend echoes our own set_text_colors call
// back; if it still disagrees with the backend after PENDING_COLORS_GRACE_MS
// it is dropped (see `set hass`), so it can never permanently mask changes
// made elsewhere (palette card, select entity, automations).
const PENDING_COLORS_STORE = {};
const PENDING_COLORS_GRACE_MS = 2000;

// Elements that open the color picker when clicked (resolved by delegation).
const PICKER_TRIGGERS =
  '.row-item[data-color-row="true"], .card-color-bar.clickable, .tile-color-preview, .chip-color-swatch, .compact-swatch, .color-grid-swatch';

class YeelightCubeColorListEditorCard extends ColorInfoMixin(
  ColorListDragMixin(ColorListLayoutsMixin(YeelightCardMixin(LitElement))),
) {
  static editor = [
    "yeelight-cube-color-list-editor-card-editor",
    "./yeelight-cube-color-list-editor-card-editor.js",
  ];
  static styles = COLOR_LIST_EDITOR_STYLES;

  constructor() {
    super();
    this.config = undefined;
    this._pendingServiceCalls = []; // Queue service calls if hass not ready
    // Interaction guards. Lit diffs the DOM, so ordinary renders no longer
    // destroy inputs; these remain only where a render would still hurt:
    // - _isDragging: drag reordering moves DOM nodes by hand, so every render
    //   is held back until the drop (see shouldUpdate).
    // - _usingColorPicker / _editingText: state-driven (hass) renders are
    //   deferred so an open picker or a focused hex input is never clobbered.
    this._isDragging = false;
    this._usingColorPicker = false;
    this._editingText = false;
    this._editing = null; // { idx, value } of the focused hex input
    this._pendingHassRender = false; // A render was held back by a guard
    this._interactionSafetyTimer = null; // Safety timer to flush held renders
    this._drag = null; // Active drag session state
    this._dragCleanup = null; // Tears down drag artefacts outside the card
    this._listKey = 0; // Bumped after a drag so Lit rebuilds the moved DOM
    this._renderedColors = [];
    this._fanHover = { wrapper: null, justCollapsed: false };
    this._pickerBoundList = null;
    // Listener objects carry their own options (Lit re-binds them only if the
    // object identity changes, so they are created once).
    this._touchStartListener = {
      handleEvent: (event) => this._onTouchStart(event),
      passive: true,
    };
    this._touchMoveListener = {
      handleEvent: (event) => this._onTouchMove(event),
      passive: false,
    };
    this._touchEndListener = {
      handleEvent: (event) => this._onTouchEnd(event, false),
      passive: true,
    };
    this._touchCancelListener = {
      handleEvent: (event) => this._onTouchEnd(event, true),
      passive: true,
    };
    this._fanTouchListener = {
      handleEvent: (event) => this._onFanTouch(event),
      passive: true,
    };
  }

  setConfig(config) {
    this._commands?.reset();
    this._pendingServiceCalls = [];
    this.config = config;

    // Auto-resolve palette_sensor if not explicitly configured
    this._autoResolveSensor("palette_sensor", "color_palettes", this._hass);
    this.requestUpdate();
  }

  static getStubConfig(hass) {
    const firstEntity = cubeLampEntities(hass)[0] || "";
    return {
      type: "custom:yeelight-cube-color-list-editor-card",
      target_entities: firstEntity ? [firstEntity] : [],
      remove_button_style: "none",
      list_layout: "rows",
      color_info_display: "name",
      show_hex_input: false,
      buttons_style: "icon",
      buttons_content_mode: "icon",
    };
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;

    // Auto-resolve palette_sensor on first hass set (setConfig may run before hass is available)
    this._autoResolveSensor("palette_sensor", "color_palettes", hass, this);

    // If this is the first time hass is set, flush any pending service calls
    if (!oldHass && hass && this._pendingServiceCalls.length > 0) {
      this._pendingServiceCalls.forEach((call) => {
        this._commitColors(call.entityId, call.entry, call.config);
      });
      this._pendingServiceCalls = [];
    }

    // PENDING-CACHE EXPIRY: if the optimistic cache is older than the
    // expected service-echo window, drop it.  Without this, one failed or
    // mismatched echo left the cache stale forever and the card ignored all
    // external color changes (e.g. selecting a palette on another card).
    let staleCacheCleared = false;
    if (this.config) {
      const entityId = this._getPrimaryEntity();
      const entry = entityId ? PENDING_COLORS_STORE[entityId] : null;
      if (entry && Date.now() - entry.ts > PENDING_COLORS_GRACE_MS) {
        const backendColors =
          hass.states?.[entityId]?.attributes?.text_colors || null;
        delete PENDING_COLORS_STORE[entityId];
        if (
          backendColors &&
          JSON.stringify(backendColors) !== JSON.stringify(entry.colors)
        ) {
          // Displayed colors were masking newer backend state — must render
          staleCacheCleared = true;
        }
      }
    }

    // Only render if our entity's state actually changed
    if (!staleCacheCleared && oldHass && this.config) {
      const entityId = this._getPrimaryEntity();
      if (entityId) {
        const oldState = oldHass.states[entityId];
        const newState = hass.states[entityId];

        // Skip render if state hasn't changed. HA only replaces the state
        // object of the entity that changed, so the common case (another
        // entity changed) is a cheap reference hit; deep-compare only when
        // our entity's state object was actually replaced.
        if (
          oldState &&
          newState &&
          (oldState === newState ||
            (oldState.state === newState.state &&
              JSON.stringify(oldState.attributes) ===
                JSON.stringify(newState.attributes)))
        ) {
          return;
        }
      }
    }

    if (this._interacting) {
      // Interaction in progress — remember that a state-driven render was held
      this._pendingHassRender = true;
      this._startInteractionSafety();
    } else {
      this._pendingHassRender = false;
      this.requestUpdate();
    }
  }

  get _interacting() {
    return this._isDragging || this._usingColorPicker || this._editingText;
  }

  shouldUpdate() {
    // A drag moves rendered nodes by hand; rendering now would fight it.
    if (!this._isDragging) return true;
    this._pendingHassRender = true;
    this._startInteractionSafety();
    return false;
  }

  // Flush any render that was held back while an interaction was active.
  // Called when an interaction flag is cleared to recover missed state updates.
  _flushPendingRender() {
    if (!this._pendingHassRender || this._interacting) return;
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
    this.requestUpdate();
  }

  // Safety timer: periodically check if all interaction flags have cleared
  // and flush the pending render. Covers edge cases where flag-clearing code
  // paths don't explicitly call _flushPendingRender().
  _startInteractionSafety() {
    if (this._interactionSafetyTimer) return; // Already running
    this._interactionSafetyTimer = setInterval(() => {
      if (!this._interacting) {
        clearInterval(this._interactionSafetyTimer);
        this._interactionSafetyTimer = null;
        this._flushPendingRender();
      }
    }, 1000);
  }

  // Resolve the primary entity: first VALID entity from target_entities,
  // fallback to legacy entity.  Skips entity IDs that no longer exist in
  // hass.states (stale config entries after entity renames / IP changes).
  _getPrimaryEntity() {
    const candidates = [
      ...(this.config?.target_entities || []),
      this.config?.entity,
    ].filter(Boolean);
    if (!this._hass?.states) return candidates[0] || null;
    for (const eid of candidates) {
      if (this._hass.states[eid]) return eid;
    }
    return candidates[0] || null; // return first even if stale (so error is shown)
  }

  // Every service call of this card goes through one ordered queue
  // (card-command-controller): results from a previous configuration are
  // dropped. Created on first use.
  _cardCommands() {
    return this._commands;
  }

  // One call for all target lamps (the backend runs them in parallel).
  // Rejects on failure (HA has already shown it).
  callServiceOnTargetEntities(service, serviceData = {}) {
    return this._cardCommands().request(
      this._hass,
      this.config,
      service,
      serviceData,
    );
  }

  render() {
    // For multi-entity support: use the first *valid* entity as source of truth.
    // _getPrimaryEntity() skips stale entity IDs that no longer exist.
    const entityId = this.config ? this._getPrimaryEntity() : null;
    const hass = this._hass;
    if (!hass) return nothing;
    if (!entityId) return cardNotice(this, NOTICE.noLamp);
    const stateObj = hass.states[entityId];
    if (!stateObj) return lampNotFoundNotice(this, entityId);

    // Get colors from sensor
    const sensorColors = stateObj.attributes.text_colors || [[255, 255, 255]];

    // Clear pending colors if sensor has caught up
    const pendingEntry = PENDING_COLORS_STORE[entityId];
    if (
      pendingEntry &&
      JSON.stringify(pendingEntry.colors) === JSON.stringify(sensorColors)
    ) {
      delete PENDING_COLORS_STORE[entityId];
    }

    // Use pending colors for instant feedback, fall back to sensor
    const textColors = PENDING_COLORS_STORE[entityId]?.colors || sensorColors;
    this._renderedColors = textColors;

    const config = this.config;
    const showSavePalette = config.show_save_palette !== false;
    const showAddColorButton = config.show_add_color_button !== false;
    const showRandomizeButton = config.show_randomize_button !== false;
    const showColorSection = config.show_color_section !== false;

    // Remove button styling configuration
    const removeButtonStyle = config.remove_button_style || "default";
    // Universal button shape & position configuration
    const buttonInside = config.delete_button_inside === true;
    const buttonLeft = config.delete_button_left === true;
    const options = {
      allowDelete: removeButtonStyle !== "none",
      enableColorPicker: config.enable_color_picker !== false,
      showHexInput: config.show_hex_input !== false,
      allowDragDrop: config.allow_drag_drop !== false,
      deleteBtnClass: getDeleteButtonClass(
        removeButtonStyle,
        config.delete_button_shape || "round",
      ),
      posClass: buttonInside ? "btn-pos-inside" : "btn-pos-outside",
      sideClass: buttonLeft ? "btn-side-left" : "",
      buttonPositionStyles: getButtonPositionStyles(buttonInside, buttonLeft),
    };

    const content = html`
      <div
        class="yc-stack"
        style="box-sizing: border-box; max-width: 100%;"
      >
        ${showColorSection
          ? html`
              ${repeat(
                [this._listKey],
                (key) => key,
                () => this._renderColorList(textColors, options),
              )}
              ${this._renderActionRow(
                showAddColorButton,
                showRandomizeButton,
                showSavePalette,
              )}
            `
          : ""}
      </div>
    `;
    const radius = `--rounded-cards-radius: ${this._getCardBorderRadius()}px;`;
    return cardShell(
      this,
      html`<div class="card-content" style=${radius}>${content}</div>`,
    );
  }

  updated() {
    // Color-picker triggers are resolved by delegation from the list
    // container. bindColorPickerTrigger replaces its own listeners, and the
    // container is only rebound when Lit created a new one.
    const list = this.renderRoot.querySelector("#color-list");
    if (list && list !== this._pickerBoundList) {
      this._pickerBoundList = list;
      bindColorPickerTrigger(list, (event) => this._onPickerTrigger(event));
    }
  }

  _renderColorList(textColors, options) {
    const config = this.config;
    return html`
      <div
        id="color-list"
        class="layout-${config.list_layout ||
        "list"} item-card-border surface-${config.card_surface_effect ||
        "none"} shadow-${config.card_shadow_style ||
        "soft"} hover-${config.card_hover_effect || "lift"}"
        style="--card-size-multiplier: ${(config.card_size || 70) / 100};"
        @click=${this._onListClick}
        @mousedown=${this._onListMouseDown}
        @mouseup=${this._onListMouseUp}
        @dragstart=${this._onDragStart}
        @dragover=${this._onDragOver}
        @dragend=${this._onDragEnd}
        @drop=${this._onDrop}
        @touchstart=${this._touchStartListener}
        @touchmove=${this._touchMoveListener}
        @touchend=${this._touchEndListener}
        @touchcancel=${this._touchCancelListener}
      >
        ${this._renderItems(textColors, options)}
      </div>
    `;
  }

  _renderActionRow(showAdd, showRandomize, showSave) {
    const config = this.config;
    const contentMode =
      config.buttons_style === "icon"
        ? "icon"
        : config.buttons_content_mode || "icon_text";
    return html`<div
      class=${getActionRowClass({
        buttonStyle: config.buttons_style,
        contentMode: config.buttons_content_mode,
      })}
      ?hidden=${!(showAdd || showRandomize || showSave)}
    >
      ${showAdd
        ? html`<button
            id="add-color"
            title="Add Color"
            class=${this._getButtonClasses("add")}
            @click=${this._onAddColor}
          >
            ${renderActionButtonContent("mdi:plus", "Add Color", contentMode)}
          </button>`
        : ""}
      ${showRandomize
        ? html`<button
            id="randomize-order"
            title="Shuffle Order"
            class=${this._getButtonClasses("randomize")}
            @click=${this._onShuffle}
          >
            ${renderActionButtonContent(
              "mdi:shuffle-variant",
              "Shuffle Order",
              contentMode,
            )}
          </button>`
        : ""}
      ${showSave
        ? html`<button
            id="save-palette"
            title="Save as Palette"
            class=${this._getButtonClasses("save")}
            @click=${this._onSavePalette}
          >
            ${renderActionButtonContent(
              "mdi:content-save",
              "Save as Palette",
              contentMode,
            )}
          </button>`
        : ""}
    </div>`;
  }

  // ----- Action buttons -------------------------------------------------

  _onAddColor() {
    const currentColors = this._getCurrentColors();
    currentColors.push([255, 255, 255]);
    this.saveColors(currentColors);
  }

  _onShuffle() {
    // Fisher-Yates shuffle
    const shuffled = this._getCurrentColors();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.saveColors(shuffled);
  }

  async _onSavePalette() {
    if (!this._hass) return;
    const currentColors = this._getCurrentColors();
    const primaryEntity = this._getPrimaryEntity();
    if (!primaryEntity) {
      console.error(
        "[ColorList Card] No primary entity available for save_palette",
      );
      return;
    }
    const commands = this._cardCommands();
    try {
      if (
        !(await commands.call(this._hass, "yeelight_cube", "save_palette", {
          palette: currentColors,
          entity_id: primaryEntity,
        }))
      )
        return;
    } catch (err) {
      console.error("Error saving palette:", err);
      return;
    }
    // Force sensor update to get fresh data immediately
    if (this.config?.palette_sensor) {
      try {
        await commands.call(this._hass, "homeassistant", "update_entity", {
          entity_id: this.config.palette_sensor,
        });
      } catch (err) {
        console.error("Error refreshing palette sensor:", err);
      }
    }
    window.dispatchEvent(
      new CustomEvent("palette-saved", {
        detail: { palette: currentColors },
      }),
    );
  }

  // ----- Hex inputs -----------------------------------------------------

  _onHexFocus(event) {
    this._editingText = true;
    this._editing = {
      idx: parseInt(event.target.dataset.idx),
      value: event.target.value,
    };
  }

  _onHexBlur(event) {
    this._editingText = false;
    this._editing = null;
    // An unfinished value reverts to the actual color. Lit only rewrites
    // .value when the bound value changes, so reset the live value here.
    const color = this._getCurrentColors()[parseInt(event.target.dataset.idx)];
    if (Array.isArray(color)) event.target.value = this.rgbToHex(color);
    this._flushPendingRender();
    this.requestUpdate();
  }

  _onHexKeydown(event) {
    if (event.key === "Enter" || event.key === "Escape") {
      event.target.blur(); // Clears _editingText via the blur handler
    }
  }

  _onHexInput(event) {
    const idx = parseInt(event.target.dataset.idx);
    const hex = event.target.value;
    this._editing = { idx, value: hex };
    const rgb = /^#[0-9a-f]{6}$/i.test(hex) ? this.hexToRgb(hex) : null;
    if (!rgb) {
      this.requestUpdate();
      return;
    }
    const currentColors = this._getCurrentColors();
    currentColors[idx] = rgb;
    this.saveColors(currentColors);
  }

  // ----- Color list clicks (remove buttons, color picker) ---------------

  _onListClick(event) {
    const button = event.target.closest("button[data-action=remove]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const idx = parseInt(button.dataset.idx);
    const currentColors = this._getCurrentColors();
    if (isNaN(idx) || idx < 0 || idx >= currentColors.length) {
      console.error(
        `[REMOVE COLOR] Invalid remove index: ${idx}, valid range: 0-${
          currentColors.length - 1
        }`,
      );
      this.requestUpdate();
      return;
    }
    if (currentColors.length > 1) {
      this.saveColors(currentColors.filter((_, i) => i !== idx));
    }
  }

  _onPickerTrigger(event) {
    if (this.config.enable_color_picker === false) return;
    const target = event.target;
    // Buttons, inputs and drag handles keep their own behaviour
    if (target.closest("button, input, .drag-handle")) return;
    const trigger = target.closest(PICKER_TRIGGERS);
    const idx = parseInt(trigger?.closest("[data-idx]")?.dataset.idx);
    const color = this._renderedColors[idx];
    if (!Array.isArray(color)) return;
    event.preventDefault();
    event.stopPropagation();
    this._openColorPickerAt(
      idx,
      this.rgbToHex(color),
      event.pageX,
      event.pageY,
    );
  }

  _getCardBorderRadius() {
    const v = this.config.rounded_cards;
    if (v === undefined || v === true || v === "round") return 16;
    if (v === false || v === "square") return 0;
    if (v === "rounded") return 4;
    return typeof v === "number" ? v : parseInt(v, 10) || 16;
  }

  _getCurrentColors() {
    // For multi-entity support: use first valid entity as the source of truth
    const entityId = this._getPrimaryEntity();

    if (!entityId) {
      return [[255, 255, 255]]; // Default fallback
    }
    const hass = this._hass;

    // Get the current colors from global pending state or entity state
    const pendingColors = PENDING_COLORS_STORE[entityId]?.colors;
    if (pendingColors) {
      return pendingColors.slice(); // Return a copy
    }

    if (!hass || !entityId) {
      return [[255, 255, 255]]; // Default fallback
    }

    const stateObj = hass.states[entityId];
    if (!stateObj || !stateObj.attributes) {
      return [[255, 255, 255]]; // Default fallback
    }

    const sensorColors = stateObj.attributes.text_colors || [[255, 255, 255]];
    return sensorColors.slice(); // Return a copy
  }

  _openColorPickerAt(idx, currentValue, clickX, clickY) {
    this._cleanupColorPicker(true);
    this._usingColorPicker = true;
    openColorPicker(this, {
      value: currentValue,
      pageX: clickX,
      pageY: clickY,
      onInput: (hex) => {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return;
        const currentColors = this._getCurrentColors();
        if (idx >= currentColors.length) return;
        currentColors[idx] = rgb;
        // Our own edits render immediately; hass renders stay deferred.
        this.saveColors(currentColors);
      },
      onClose: () => {
        if (!this._usingColorPicker) return;
        this._usingColorPicker = false;
        this._flushPendingRender();
      },
    });
  }

  _cleanupColorPicker(skipFlush) {
    this._usingColorPicker = false;
    closeColorPicker(this);
    if (!skipFlush) {
      this._flushPendingRender();
    }
  }

  saveColors(textColors) {
    // For multi-entity support: use first valid entity as the source of truth
    const entityId = this._getPrimaryEntity();

    if (!entityId) {
      return;
    }

    // Store pending colors in global store (shared across all card instances).
    // Timestamped so `set hass` can expire the entry if the backend echo
    // never matches (see PENDING_COLORS_GRACE_MS).
    const entry = {
      colors: structuredClone(textColors),
      ts: Date.now(),
    };
    PENDING_COLORS_STORE[entityId] = entry;
    this.requestUpdate();

    // If hass not ready yet, queue the service call for later
    if (!this._hass) {
      this._pendingServiceCalls.push({
        entityId,
        entry,
        config: structuredClone(this.config),
      });
      return;
    }

    // Use multi-entity service call - updates ALL target entities with the same colors
    return this._commitColors(entityId, entry, this.config);
  }

  async _commitColors(entityId, entry, config) {
    const commands = this._cardCommands();
    const context = commands.context;
    const success = await commands.execute(
      this._hass,
      config,
      "set_text_colors",
      {
        text_colors: entry.colors,
      },
    );
    if (context !== commands.context || success) return success;
    if (PENDING_COLORS_STORE[entityId] !== entry) return false;
    delete PENDING_COLORS_STORE[entityId];
    this.requestUpdate?.();
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        bubbles: true,
        composed: true,
        detail: {
          message: commands.error || "The colors could not be saved.",
        },
      }),
    );
    return false;
  }

  _getButtonClasses(type) {
    const style = this.config.buttons_style || "modern";
    // Use centralized utility for add/save/randomize buttons
    if (type === "add" || type === "save" || type === "randomize") {
      return getExportImportButtonClass(type, style);
    }
    // Handle remove button locally (not in centralized utility)
    return `remove-btn btn-style-${style}`;
  }

  getCardSize() {
    return 4;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._commands?.reset();
    this._pendingServiceCalls = [];

    // Tear down anything a drag placed outside the card (touch ghost) if
    // disconnected mid-drag; the drag's DOM is rebuilt on the next render.
    this._endDragSession();
    if (this._drag) this._listKey++;
    this._drag = null;

    this._cleanupColorPicker(true);

    // Reset interaction flags
    this._isDragging = false;
    this._usingColorPicker = false;
    this._editingText = false;
    this._editing = null;
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
  }
}

defineOnce("yeelight-cube-color-list-editor-card", YeelightCubeColorListEditorCard);

registerCustomCard({
  type: "yeelight-cube-color-list-editor-card",
  name: "Yeelight Colors Card",
  description: "Edit the list of text colors for the Yeelight Cube Lite.",
  preview: true,
});
