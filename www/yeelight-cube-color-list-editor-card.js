import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import {
  exportImportButtonStyles,
  getExportImportButtonClass,
  renderButtonContent,
} from "./export-import-button-utils.js";
import {
  deleteButtonStyles,
  getDeleteButtonClass,
  getButtonPositionStyles,
} from "./delete-button-styles.js";
import { compactModeStyles } from "./compact-mode-styles.js";
import { compactLayoutStyles } from "./compact-layout-utils.js";
import { callServiceOnTargetEntities as callServiceSequentially } from "./service-call-utils.js?v=2";
import {
  ANGLE_UPDATE_DEBOUNCE_MS,
  rgbToHex as _sharedRgbToHex,
  createColorWheelSegments as _sharedCreateColorWheelSegments,
  createWheelGradientStops as _sharedCreateWheelGradientStops,
  createShapeGradientStops as _sharedCreateShapeGradientStops,
  generateShapeMask as _sharedGenerateShapeMask,
} from "./angle-wheel-utils.js";

// Global storage for pending colors per entity (shared across all card instances)
const PENDING_COLORS_STORE = {};

class YeelightCubeColorListEditorCard extends HTMLElement {
  constructor() {
    super();
    this._pendingAngle = null;
    this._angleDebounceTimer = null;
    this._lastAngleSent = null;
    this._draggingRotary = false;
    this._processingModeChange = false;
    this._isInitialRenderComplete = false;
    this._lastLayoutMode = null;
    this._lastColorsKey = null;
    this._lastColorsLength = null;
    this._isReordering = false; // Flag to skip animations during drag-and-drop
    this._renderScheduled = false; // Track if render is scheduled
    this._pendingServiceCalls = []; // Queue service calls if hass not ready
    this._pendingHassRender = false; // Track if a render was blocked by interaction flags
    this._interactionSafetyTimer = null; // Safety timer to flush pending renders
  }

  setConfig(config) {
    this.config = config;

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
    // Force re-render after config change
    this._isInitialRenderComplete = false;
    this._lastLayoutMode = null;
    this._lastColorsKey = null;
    this._lastColorsLength = null;

    // Use requestAnimationFrame instead of setTimeout
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.render();
      // Attach listeners after initial render, even if hass not ready yet
      // The listeners use this._getCurrentColors() which has proper fallbacks
      this._attachColorListEventListeners();
    });
  }

  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-color-list-editor-card-editor")) {
      await import("./yeelight-cube-color-list-editor-card-editor.js");
    }
    return document.createElement(
      "yeelight-cube-color-list-editor-card-editor",
    );
  }
  static getStubConfig(hass) {
    const firstEntity =
      Object.keys(hass?.states || {}).find(
        (e) =>
          e.startsWith("light.yeelight_cube") ||
          e.startsWith("light.cubelite_"),
      ) || "";
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
    if (this.config && !this.config.palette_sensor && hass) {
      const autoSensor = Object.keys(hass.states || {}).find(
        (e) => e.startsWith("sensor.") && e.includes("color_palettes"),
      );
      if (autoSensor) {
        this.config = { ...this.config, palette_sensor: autoSensor };
      }
    }

    // If this is the first time hass is set, flush any pending service calls
    if (!oldHass && hass && this._pendingServiceCalls.length > 0) {
      this._pendingServiceCalls.forEach((call) => {
        this.callServiceOnTargetEntities(call.service, call.serviceData);
      });
      this._pendingServiceCalls = [];
    }

    // Only render if our entity's state actually changed
    if (oldHass && this.config) {
      const targetEntities =
        this.config.target_entities ||
        (this.config.entity ? [this.config.entity] : []);
      if (targetEntities.length > 0) {
        const entityId = targetEntities[0];
        const oldState = oldHass.states[entityId];
        const newState = hass.states[entityId];

        // Skip render if state hasn't changed
        if (
          oldState &&
          newState &&
          JSON.stringify(oldState.attributes) ===
            JSON.stringify(newState.attributes) &&
          oldState.state === newState.state
        ) {
          return;
        }
      }
    }

    if (
      !this._isDragging &&
      !this._draggingRotary &&
      !this._usingSlider &&
      !this._usingColorPicker &&
      !this._editingText
    ) {
      this._pendingHassRender = false;
      // Use requestAnimationFrame to batch renders
      if (this._renderScheduled) return;
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.render();
      });
    } else {
      // Interaction in progress — remember that a state-driven render was blocked
      this._pendingHassRender = true;
      this._startInteractionSafety();
    }
  }

  // Flush any render that was blocked while interaction flags were set.
  // Called when an interaction flag is cleared to recover missed state updates.
  _flushPendingRender() {
    if (!this._pendingHassRender) return;
    if (
      this._isDragging ||
      this._draggingRotary ||
      this._usingSlider ||
      this._usingColorPicker ||
      this._editingText
    )
      return; // Another flag still active
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.render();
      });
    }
  }

  // Safety timer: periodically check if all interaction flags have cleared
  // and flush the pending render. Covers edge cases where flag-clearing code
  // paths don't explicitly call _flushPendingRender().
  _startInteractionSafety() {
    if (this._interactionSafetyTimer) return; // Already running
    this._interactionSafetyTimer = setInterval(() => {
      if (
        !this._isDragging &&
        !this._draggingRotary &&
        !this._usingSlider &&
        !this._usingColorPicker &&
        !this._editingText
      ) {
        clearInterval(this._interactionSafetyTimer);
        this._interactionSafetyTimer = null;
        this._flushPendingRender();
      }
    }, 1000);
  }

  // Resolve the primary entity: first from target_entities, fallback to legacy entity.
  _getPrimaryEntity() {
    const targetEntities = this.config?.target_entities || [];
    if (targetEntities.length > 0) return targetEntities[0];
    return this.config?.entity || null;
  }

  // Helper method for calling services on multiple entities.
  // Delegates to the shared utility.  The Python backend holds per-IP locks,
  // so different lamps execute in parallel.
  async callServiceOnTargetEntities(service, serviceData) {
    return callServiceSequentially(
      this._hass,
      this.config,
      service,
      serviceData,
      { callerTag: "ColorList Card" },
    );
  }

  render() {
    if (
      this._isDragging ||
      this._draggingRotary ||
      this._usingSlider ||
      this._usingColorPicker ||
      this._editingText
    )
      return;

    // For multi-entity support: use first entity as the source of truth
    const targetEntities =
      this.config.target_entities ||
      (this.config.entity ? [this.config.entity] : []);

    if (targetEntities.length === 0) return;

    const entityId = targetEntities[0]; // Use first entity as source
    const hass = this._hass;
    if (!hass || !entityId) {
      return;
    }
    const stateObj = hass.states[entityId];
    if (!stateObj) {
      this.shadowRoot.innerHTML = `<ha-card>Entity not found</ha-card>`;
      this._isInitialRenderComplete = false;
      return;
    }

    // Get colors from sensor
    const sensorColors = stateObj.attributes.text_colors || [[255, 255, 255]];

    // Use global pending colors store (shared across all card instances for this entity)
    const pendingColors = PENDING_COLORS_STORE[entityId];

    // Clear pending colors if sensor has caught up
    if (
      pendingColors &&
      JSON.stringify(pendingColors) === JSON.stringify(sensorColors)
    ) {
      delete PENDING_COLORS_STORE[entityId];
    }

    // Use pending colors for instant feedback, fall back to sensor
    let textColors = PENDING_COLORS_STORE[entityId] || sensorColors;

    // Get current angle from entity
    const currentAngle = stateObj.attributes.angle ?? 0;

    const showCard = this.config.show_card_background !== false;
    const showItemBorder = true;
    const showSavePalette = this.config.show_save_palette !== false;
    const enableColorPicker = this.config.enable_color_picker !== false;
    const showHexInput = this.config.show_hex_input !== false;
    const allowDragDrop = this.config.allow_drag_drop !== false;
    const showAddColorButton = this.config.show_add_color_button !== false;
    const showRandomizeButton = this.config.show_randomize_button !== false;
    const showColorSection = this.config.show_color_section !== false;
    const fullRowColorMode = this.config.full_row_color_mode === true;

    // Remove button styling configuration
    const removeButtonStyle = this.config.remove_button_style || "default";
    const allowDelete = removeButtonStyle !== "none";

    // Universal button shape & position configuration
    const buttonShape = this.config.delete_button_shape || "round";
    const buttonInside = this.config.delete_button_inside === true;
    const buttonLeft = this.config.delete_button_left === true;

    const cardTitle =
      typeof this.config.title === "string" ? this.config.title : "";

    // Get scroll state from entity attributes
    const scrollSpeed = stateObj.attributes.scroll_speed || 1.0;
    const scrollEnabled = stateObj.attributes.scroll_enabled !== false;
    const scrollOffset = stateObj.attributes.scroll_offset || 0;
    const maxScrollOffset = stateObj.attributes.max_scroll_offset || 0;

    // Smart update: Only do full render on first load or config change
    const currentLayout = this.config.list_layout || "list";
    const layoutChanged = this._lastLayoutMode !== currentLayout;

    // For cards layout, check if colors actually changed to prevent hover blinking
    const currentColorsKey = JSON.stringify(textColors);
    const colorsChanged = this._lastColorsKey !== currentColorsKey;

    // Track length changes separately - if number of colors changed, force full re-render
    const lengthChanged = this._lastColorsLength !== textColors.length;

    if (
      this._isInitialRenderComplete &&
      this.shadowRoot.querySelector("#color-list") &&
      !layoutChanged &&
      !lengthChanged
    ) {
      // For cards layout, handle animations for adding/removing/reordering
      if (currentLayout === "cards" && colorsChanged) {
        const colorListElement = this.shadowRoot.querySelector("#color-list");
        if (colorListElement) {
          // If we're just reordering (drag-and-drop), skip animations
          if (this._isReordering) {
            // Just update the HTML without animations
            colorListElement.innerHTML = `
              ${this._generateColorList(textColors, {
                allowDelete,
                fullRowColorMode,
                enableColorPicker,
                showHexInput,
                allowDragDrop,
                removeButtonStyle,
                buttonShape,
                buttonInside,
                buttonLeft,
              })}
            `;
            this._attachColorListEventListeners();
            this._lastColorsKey = currentColorsKey;
            this._lastColorsLength = textColors.length;
            this._isReordering = false; // Reset flag
            return;
          }

          // Store previous cards data
          const oldCards = Array.from(
            colorListElement.querySelectorAll(".card-wrapper"),
          ).map((wrapper) => {
            const idx = parseInt(wrapper.dataset.position);
            const colorHex =
              wrapper.querySelector(".card-hex-display, .card-hex")
                ?.textContent || wrapper.querySelector(".card-hex")?.value;
            return { idx, colorHex, element: wrapper };
          });

          const newColorHexes = textColors.map((c) => this.rgbToHex(c));
          const oldColorHexes = oldCards.map((c) => c.colorHex);

          // Check if this is just a reorder (same colors, different positions)
          const oldColorHexesSorted = [...oldColorHexes].sort();
          const newColorHexesSorted = [...newColorHexes].sort();
          const isJustReorder =
            oldColorHexesSorted.length === newColorHexesSorted.length &&
            oldColorHexesSorted.every(
              (hex, i) => hex === newColorHexesSorted[i],
            );

          if (isJustReorder) {
            // Just reorder, no animation needed
            colorListElement.innerHTML = `
              ${this._generateColorList(textColors, {
                allowDelete,
                fullRowColorMode,
                enableColorPicker,
                showHexInput,
                allowDragDrop,
                removeButtonStyle,
                buttonShape,
                buttonInside,
                buttonLeft,
              })}
            `;
            this._attachColorListEventListeners();
            this._lastColorsKey = currentColorsKey;
            this._lastColorsLength = textColors.length;
            return;
          }

          // Check if only one card was added
          const addedColors = newColorHexes.filter(
            (hex) => !oldColorHexes.includes(hex),
          );
          const removedColors = oldColorHexes.filter(
            (hex) => !newColorHexes.includes(hex),
          );

          // Handle removal - just remove the specific card
          if (removedColors.length > 0 && addedColors.length === 0) {
            oldCards.forEach((oldCard) => {
              if (!newColorHexes.includes(oldCard.colorHex)) {
                // Card was removed - animate out
                oldCard.element.classList.add("card-removing");
                setTimeout(() => {
                  if (oldCard.element.parentNode) {
                    oldCard.element.remove();
                  }
                  // Update data attributes for remaining cards
                  this._updateCardPositions();
                }, 300);
              }
            });
            this._lastColorsKey = currentColorsKey;
            this._lastColorsLength = textColors.length;
            return;
          }

          // Handle addition - rebuild and animate only the new card
          if (addedColors.length > 0 && removedColors.length === 0) {
            // Rebuild the list
            colorListElement.innerHTML = `
              ${this._generateColorList(textColors, {
                allowDelete,
                fullRowColorMode,
                enableColorPicker,
                showHexInput,
                allowDragDrop,
                removeButtonStyle,
                buttonShape,
                buttonInside,
                buttonLeft,
              })}
            `;

            // Find and animate only the new card
            const newWrappers =
              colorListElement.querySelectorAll(".card-wrapper");
            newWrappers.forEach((wrapper, idx) => {
              const colorHex = textColors[idx]
                ? this.rgbToHex(textColors[idx])
                : null;
              if (colorHex && addedColors.includes(colorHex)) {
                // New card - animate in
                wrapper.classList.add("card-entering");
                setTimeout(() => {
                  wrapper.classList.remove("card-entering");
                }, 400);
              }
            });

            this._attachColorListEventListeners();
            this._lastColorsKey = currentColorsKey;
            this._lastColorsLength = textColors.length;
            return;
          }

          // For complex changes (multiple adds/removes), just rebuild without animation
          colorListElement.innerHTML = `
            ${this._generateColorList(textColors, {
              allowDelete,
              fullRowColorMode,
              enableColorPicker,
              showHexInput,
              allowDragDrop,
              removeButtonStyle,
              buttonShape,
              buttonInside,
              buttonLeft,
            })}
          `;
          this._attachColorListEventListeners();
          this._lastColorsKey = currentColorsKey;
          this._lastColorsLength = textColors.length;
        }
        return;
      }

      // For cards layout when colors haven't changed
      if (currentLayout === "cards" && !colorsChanged) {
        // Just update action row if needed, don't touch the cards
        const actionRowElement = this.shadowRoot.querySelector(".action-row");
        if (actionRowElement) {
          actionRowElement.className = `action-row${
            this.config.buttons_style === "icon" ? " icon-mode" : ""
          }`;
        }
        // Re-attach event listeners even when skipping re-render (buttons need to work!)
        this._attachColorListEventListeners();
        return;
      }

      // For all other layouts (compact, chips, tiles, rows, grid), prevent re-render if colors haven't changed
      if (
        !colorsChanged &&
        (currentLayout === "compact" ||
          currentLayout === "chips" ||
          currentLayout === "tiles" ||
          currentLayout === "rows" ||
          currentLayout === "grid")
      ) {
        // Just update action row if needed, don't touch the color list
        const actionRowElement = this.shadowRoot.querySelector(".action-row");
        if (actionRowElement) {
          actionRowElement.className = `action-row${
            this.config.buttons_style === "icon" ? " icon-mode" : ""
          }`;
        }
        // Re-attach event listeners even when skipping re-render (buttons need to work!)
        this._attachColorListEventListeners();
        return;
      }

      // Just update the color list content without rebuilding entire card
      const colorListElement = this.shadowRoot.querySelector("#color-list");
      const actionRowElement = this.shadowRoot.querySelector(".action-row");
      if (colorListElement) {
        // Update layout class in case it changed
        colorListElement.className = `layout-${currentLayout}${showItemBorder ? " item-card-border" : ""}`;

        colorListElement.innerHTML = `
          ${this._generateColorList(textColors, {
            allowDelete,
            fullRowColorMode,
            enableColorPicker,
            showHexInput,
            allowDragDrop,
            removeButtonStyle,
            buttonShape,
            buttonInside,
            buttonLeft,
          })}
        `;

        // Only update action row if it doesn't exist yet
        // This prevents button "blinking" on sensor updates
        if (actionRowElement && !actionRowElement.querySelector("button")) {
          actionRowElement.className = `action-row${
            this.config.buttons_style === "icon" ? " icon-mode" : ""
          }`;
          const contentMode =
            this.config.buttons_style === "icon"
              ? "icon"
              : this.config.buttons_content_mode || "icon_text";
          actionRowElement.innerHTML = `
            ${
              showAddColorButton
                ? `<button id="add-color" title="Add Color" class="${this._getButtonClasses(
                    "add",
                  )}">${renderButtonContent("mdi:plus", "Add Color", contentMode)}</button>`
                : ""
            }
            ${
              showRandomizeButton
                ? `<button id="randomize-order" title="Shuffle Order" class="${this._getButtonClasses(
                    "randomize",
                  )}">${renderButtonContent("mdi:shuffle-variant", "Shuffle Order", contentMode)}</button>`
                : ""
            }
            ${
              showSavePalette
                ? `<button id="save-palette" title="Save as Palette" class="${this._getButtonClasses(
                    "save",
                  )}">${renderButtonContent("mdi:content-save", "Save as Palette", contentMode)}</button>`
                : ""
            }
          `;
        }
        this._attachColorListEventListeners();
        this._lastColorsKey = currentColorsKey;
        return;
      }
    }

    // Full render for initial load
    const cardContent = `
      <div style="padding:16px; box-sizing: border-box; max-width: 100%;">
        ${!showCard && cardTitle ? `<div style="font-weight:600;font-size:1.1em;margin-bottom:8px;">${cardTitle}</div>` : ""}
        
        ${
          showColorSection
            ? `
        <div id="color-list" class="layout-${
          this.config.list_layout || "list"
        }${showItemBorder ? " item-card-border" : ""} surface-${
          this.config.card_surface_effect || "none"
        } shadow-${this.config.card_shadow_style || "soft"} hover-${
          this.config.card_hover_effect || "lift"
        }" style="--card-size-multiplier: ${
          (this.config.card_size || 70) / 100
        };">
          ${this._generateColorList(textColors, {
            allowDelete,
            fullRowColorMode,
            enableColorPicker,
            showHexInput,
            allowDragDrop,
            removeButtonStyle,
            buttonShape,
            buttonInside,
            buttonLeft,
          })}
        </div>
        <div class="action-row${
          this.config.buttons_style === "icon" ? " icon-mode" : ""
        }">
            ${(() => {
              const contentMode =
                this.config.buttons_style === "icon"
                  ? "icon"
                  : this.config.buttons_content_mode || "icon_text";
              return `
            ${
              showAddColorButton
                ? `<button id="add-color" title="Add Color" class="${this._getButtonClasses(
                    "add",
                  )}">${renderButtonContent("mdi:plus", "Add Color", contentMode)}</button>`
                : ""
            }
            ${
              showRandomizeButton
                ? `<button id="randomize-order" title="Shuffle Order" class="${this._getButtonClasses(
                    "randomize",
                  )}">${renderButtonContent("mdi:shuffle-variant", "Shuffle Order", contentMode)}</button>`
                : ""
            }
            ${
              showSavePalette
                ? `<button id="save-palette" title="Save as Palette" class="${this._getButtonClasses(
                    "save",
                  )}">${renderButtonContent("mdi:content-save", "Save as Palette", contentMode)}</button>`
                : ""
            }
            `;
            })()}
          </div>
        `
            : ""
        }
      </div>
    `;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          max-width: 100%;
          box-sizing: border-box;
          overflow: visible;
          --rounded-cards-radius: ${this._getCardBorderRadius()}px;
        }
        ha-card {
          overflow: visible;
        }
        * {
          box-sizing: border-box;
        }
        /* Block ALL native color inputs from receiving clicks.
           Color picking is handled by wrapper click handlers that call _openColorPickerAt(). */
        input[type="color"] {
          pointer-events: none !important;
        }
        > div {
          max-width: 100%;
          overflow: hidden;
        }
        .card-title {
          font-size: 1.3em;
          font-weight: bold;
          margin-bottom: 18px;
          margin-top: 2px;
          color: var(--primary-text-color, #222);
        }
        
        /* Header rotary styling - smaller and compact */
        .header-rotary {
          flex-shrink: 0;
        }
        
        .header-rotary .wheel-container,
        .header-rotary .rect-container,
        .header-rotary .default-container {
          margin: 0;
          gap: 4px;
        }
        
        .header-rotary svg {
          max-width: 60px !important;
          max-height: 60px !important;
        }
        
        .header-rotary .color-rect {
          width: 60px !important;
          aspect-ratio: 3 / 1 !important;
        }
        
        /* Hide angle display in header mode */
        .header-rotary div[style*="text-align: center"] {
          display: none;
        }
        .card-content {
          max-width: 480px;
          margin: 0 auto;
        }
        .color-row {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          background: var(--secondary-background-color, #fafbfc);
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          padding: 6px 12px;
          transition: box-shadow 0.2s, transform 0.2s cubic-bezier(.4,2,.6,1), background 0.2s;
          position: relative;
          width: 100%;
          box-sizing: border-box;
        }
        .color-main {
          display: flex;
          align-items: center;
          flex: 1 1 auto;
          min-width: 0;
        }
        
        /* Full row color mode styles */
        .color-row.full-row-color {
          border: 2px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.2);
          border: 0 !important;
        }
        
        .color-row.full-row-color[data-color-row="true"] {
          cursor: pointer;
        }
        
        .color-row.full-row-color[data-color-row="true"]:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(255, 255, 255, 0.3);
          border: 0 !important;
        }
        
        .color-row.full-row-color .color-main span,
        .color-row.full-row-color .color-main .hex-input {
          color: #fff;
        }
        
        .color-row.full-row-color .hex-input {
          background: rgba(255, 255, 255, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.4);
          transition: all 0.2s ease;
        }
        
        .color-row.full-row-color .hex-input:focus {
          background: rgba(255, 255, 255, 0.95) !important;
          color: var(--primary-text-color, #000) !important;
          border: 2px solid rgba(255, 255, 255, 0.9) !important;
          outline: none;
          box-shadow: 
            0 0 0 2px rgba(0, 0, 0, 0.3),
            0 0 0 4px rgba(255, 255, 255, 0.8),
            0 2px 8px rgba(0, 0, 0, 0.15) !important;
          transform: scale(1.02);
          z-index: 10;
          position: relative;
        }
        .color-actions {
          display: flex;
          align-items: center;
          gap: 20px;
          flex: 0 0 auto;
          justify-content: flex-end;
        }
        .color-row.dragging { box-shadow: 0 8px 24px rgba(0,0,0,0.18); z-index: 10; transform: scale(1.04); }
        .color-row.animating { transition: transform 0.2s cubic-bezier(.4,2,.6,1); }
        .color-row input[type="color"] {
          width: 32px;
          height: 32px;
          border: none;
          background: none;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
          padding: 0;
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .color-row input[type="color"]::-webkit-color-swatch {
          border-radius: 8px;
          border: none;
          padding: 0;
        }
        .color-row input[type="color"]::-webkit-color-swatch-wrapper {
          border-radius: 8px;
          padding: 0;
        }
        .color-row input[type="color"]::-moz-color-swatch {
          border-radius: 8px;
          border: none;
          padding: 0;
        }
        .color-row input[type="color"]::-moz-focus-inner {
          border: none;
        }
        .color-row input[type="text"].hex-input {
          width: 70px;
          margin-left: 8px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 1em;
          font-family: inherit;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #222);
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          transition: all 0.2s ease;
        }
        .color-row input[type="text"].hex-input:focus {
          border: 2px solid var(--primary-color, #1976d2) !important;
          outline: none;
          box-shadow: 
            0 0 0 2px color-mix(in srgb, var(--primary-color, #1976d2) 20%, transparent),
            0 2px 8px color-mix(in srgb, var(--primary-color, #1976d2) 15%, transparent) !important;
          background: var(--card-background-color, #fff) !important;
          transform: scale(1.02);
          z-index: 10;
          position: relative;
        }
        .remove-btn { background: color-mix(in srgb, var(--error-color, #db4437) 15%, var(--card-background-color, #fff)); border: none; border-radius: 6px; color: var(--error-color, #db4437); padding: 6px 18px; cursor: pointer; font-size: 1em; font-weight: 500; margin-left: 0; transition: background 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
        .remove-btn:hover { background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff)); }
        
        /* Make color-row relative for absolute positioning of cross */
        .color-row {
          position: relative;
        }
        
        /* Add padding when cross button is present */
        .color-row.has-cross {
          padding-right: 40px;
        }
        .drag-handle { margin-left: 0; cursor: grab; font-size: 1.5em; color: var(--secondary-text-color, #888); user-select: none; }
        .drag-handle::after { content: "\\2630"; }
        
        /* Drag handle styles for Full Row Color Mode */
        .color-row.full-row-color .drag-handle {
          transition: background 0.2s ease;
        }
        
        .color-row.full-row-color .drag-handle:hover {
          background: rgba(255, 255, 255, 0.5) !important;
        }
        #color-list { position: relative; 
        text-align: center;}
        
        /* Compact layout container - wrap items horizontally */
        #color-list.layout-compact {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: flex-start;
          justify-content: space-between;
        }
        
        /* Inject centralized button styles */
        ${exportImportButtonStyles}
        
        /* Inject centralized compact layout styles */
        ${compactLayoutStyles}
        
        /* Grid Layout */
        .layout-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(114.29px * var(--card-size-multiplier, 0.7)), 1fr)); gap: 12px; padding: 8px 0; }
        .color-grid-item { 
          display: flex; 
          flex-direction: column; 
          align-items: center; 
          gap: 6px;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          cursor: grab;
        }
        .color-grid-item.dragging {
          opacity: 0.3;
          cursor: grabbing;
        }
        .color-grid-item.grid-drag-over {
          transform: scale(0.95);
        }
        .layout-grid.dragging-active .grid-remove-btn {
          opacity: 0 !important;
          pointer-events: none;
        }
        .color-grid-swatch { position: relative; width: calc(114.29px * var(--card-size-multiplier, 0.7)); height: calc(114.29px * var(--card-size-multiplier, 0.7)); border-radius: calc(17.14px * var(--card-size-multiplier, 0.7)); box-shadow: 0 2px 8px rgba(0,0,0,0.15); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
        .color-grid-swatch:hover { transform: translateY(-4px); box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
        .grid-color-picker { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: calc(85.71px * var(--card-size-multiplier, 0.7)); height: calc(85.71px * var(--card-size-multiplier, 0.7)); opacity: 0; cursor: pointer; pointer-events: none; }
        .grid-remove-btn { 
          /* Positioning only - styles come from deleteButtonStyles */
          position: absolute; 
          top: -10px; 
          right: -10px; 
          z-index: 10; 
        }
        .grid-remove-btn.btn-pos-inside {
          top: 6px;
          right: 6px;
        }
        /* Dot on grid: same position logic, smaller button */
        .grid-remove-btn.dot-style {
          top: -4px;
          right: -4px;
        }
        .grid-remove-btn.dot-style.btn-pos-inside {
          top: 4px;
          right: 4px;
        }
        /* ---- Grid: left-side button overrides ---- */
        .grid-remove-btn.btn-side-left {
          right: auto;
          left: -10px;
        }
        .grid-remove-btn.btn-pos-inside.btn-side-left {
          right: auto;
          left: 6px;
        }
        .grid-remove-btn.dot-style.btn-side-left {
          right: auto;
          left: -4px;
        }
        .grid-remove-btn.dot-style.btn-pos-inside.btn-side-left {
          right: auto;
          left: 4px;
        }
        .color-grid-info { font-size: calc(0.85em * var(--card-size-multiplier, 0.7)); color: var(--secondary-text-color, #666); text-align: center; margin-top: 8px; }
        .grid-hex-input { 
          width: 100%; 
          margin-top: 8px; 
          padding: 4px 8px; 
          border: 1px solid var(--divider-color, #ddd); 
          border-radius: 4px; 
          font-size: calc(0.85em * var(--card-size-multiplier, 0.7)); 
          text-align: center; 
          font-family: monospace;
          box-sizing: border-box;
        }
        .grid-hex-input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
        }
        
        /* ===== COMPACT MODE - COLOR LIST SPECIFIC ONLY ===== */
        /* Base compact layout from compact-layout-utils.js - DO NOT duplicate */
        /* Only color-list-specific styles below */
        
        .compact-swatch {
          width: calc(45.71px * var(--card-size-multiplier, 0.7));
          height: calc(45.71px * var(--card-size-multiplier, 0.7));
          border-radius: calc(7.14px * var(--card-size-multiplier, 0.7));
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
        }
        .compact-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
        }
        .compact-hex-display {
          font-family: monospace;
          font-size: calc(0.9em * var(--card-size-multiplier, 0.7));
          color: var(--primary-text-color, #212529);
          font-weight: 600;
        }
        .compact-color-name {
          font-size: calc(0.75em * var(--card-size-multiplier, 0.7));
          color: var(--secondary-text-color, #6c757d);
          line-height: 1.2;
          max-width: none !important;
          text-align: left;
        }
        .compact-hex-input {
          padding: calc(4.29px * var(--card-size-multiplier, 0.7)) calc(8.57px * var(--card-size-multiplier, 0.7));
          border: 1px solid var(--divider-color, #dee2e6);
          border-radius: calc(5.71px * var(--card-size-multiplier, 0.7));
          font-family: monospace;
          font-size: calc(0.85em * var(--card-size-multiplier, 0.7));
          font-weight: 600;
          width: 70px;
        }
        .compact-hex-input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
        }
        
        /* CHIPS MODE - Tag/pill style */
        .chips-container {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 0;
          justify-content: space-between;
        }
        .chip-item {
          display: inline-flex;
          align-items: center;
          gap: calc(11.43px * var(--card-size-multiplier, 0.7));
          padding: calc(11.43px * var(--card-size-multiplier, 0.7)) calc(17.14px * var(--card-size-multiplier, 0.7));
          padding-right: calc(8px * var(--card-size-multiplier, 0.7));
          border-radius: calc(28.57px * var(--card-size-multiplier, 0.7));
          font-size: calc(0.9em * var(--card-size-multiplier, 0.7));
          font-weight: 500;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          cursor: grab;
          transition: all 0.2s;
          position: relative;
        }
        .chip-item:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        }
        .chip-item.dragging {
          opacity: 0.5;
        }
        .chip-color-swatch {
          position: relative;
          width: calc(34.29px * var(--card-size-multiplier, 0.7));
          height: calc(34.29px * var(--card-size-multiplier, 0.7));
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.5);
          cursor: pointer;
          flex-shrink: 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .chip-color-swatch:hover {
          transform: scale(1.1);
          border-color: rgba(255, 255, 255, 0.8);
        }
        .chip-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
          border-radius: 50%;
          width: 100%;
          height: 100%;
        }
        .chip-content {
          font-family: monospace;
          user-select: none;
        }
        .chip-hex-input {
          padding: 2px 6px;
          border: 1px solid transparent;
          border-radius: 4px;
          font-family: monospace;
          font-size: 0.9em;
          width: 70px;
          text-align: center;
        }
        .chip-hex-input:focus {
          outline: none;
          border-color: currentColor;
        }
        .chip-remove {
          /* Default: inside (relative, flex child) */
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative !important;
          flex-shrink: 0;
        }
        /* Outside: absolute top-right corner */
        .chip-remove.btn-pos-outside {
          position: absolute !important;
          top: -6px !important;
          right: -6px !important;
          z-index: 10;
        }
        /* Dot-style chips: size only, position from btn-pos classes */
        .chip-remove.dot-style {
          top: auto !important;
          right: auto !important;
        }
        .chip-remove.dot-style.btn-pos-outside {
          position: absolute !important;
          top: -4px !important;
          right: -4px !important;
        }
        /* Extra padding when button protrudes outside */
        .chip-item:has(.btn-pos-outside) {
          padding-top: calc(10px * var(--card-size-multiplier, 0.7));
          padding-right: calc(10px * var(--card-size-multiplier, 0.7));
        }
        /* ---- Chips: left-side button overrides ---- */
        .chip-remove.btn-side-left {
          order: -1;
        }
        .chip-remove.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -6px !important;
        }
        .chip-remove.dot-style.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -4px !important;
        }
        .chip-item:has(.btn-pos-outside.btn-side-left) {
          padding-right: 0;
          padding-left: calc(10px * var(--card-size-multiplier, 0.7));
        }
        
        /* TILES MODE - Card-like items */
        .tile-item {
          display: flex;
          align-items: center;
          gap: calc(17.14px * var(--card-size-multiplier, 0.7));
          padding: calc(17.14px * var(--card-size-multiplier, 0.7));
          border-radius: calc(17.14px * var(--card-size-multiplier, 0.7));
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          margin-bottom: calc(14.29px * var(--card-size-multiplier, 0.7));
          cursor: grab;
          transition: all 0.2s;
          position: relative;
        }
        .tile-item:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          transform: translateY(-2px);
        }
        .tile-item.dragging {
          opacity: 0.5;
        }
        .tile-drag-area {
          font-size: calc(28.57px * var(--card-size-multiplier, 0.7));
          color: var(--disabled-text-color, #adb5bd);
          cursor: grab;
          user-select: none;
          line-height: 1;
        }
        .tile-color-preview {
          width: calc(85.71px * var(--card-size-multiplier, 0.7));
          height: calc(85.71px * var(--card-size-multiplier, 0.7));
          border-radius: calc(14.29px * var(--card-size-multiplier, 0.7));
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          position: relative;
          cursor: pointer;
          flex-shrink: 0;
        }
        .tile-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
        }
        .tile-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .tile-hex-display, .tile-hex-input {
          font-family: monospace;
          font-size: 1em;
          font-weight: 600;
          color: var(--primary-text-color, #212529);
        }
        .tile-hex-input {
          padding: 4px 8px;
          border: 1px solid var(--divider-color, #dee2e6);
          border-radius: 4px;
          width: 100px;
        }
        .tile-hex-input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
        }
        .tile-color-name {
          font-size: 0.85em;
          color: var(--secondary-text-color, #6c757d);
        }
        .tile-remove {
          /* Default: inside (relative, flex child) */
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative !important;
          top: auto !important;
          right: auto !important;
          margin-left: auto;
        }
        /* Outside: absolute top-right corner */
        .tile-remove.btn-pos-outside {
          position: absolute !important;
          top: -8px !important;
          right: -8px !important;
          margin-left: 0 !important;
          z-index: 10;
        }
        /* Dot-style tiles: inside is default (relative); outside needs explicit absolute */
        .tile-remove.dot-style.btn-pos-outside {
          position: absolute !important;
          top: -4px !important;
          right: -4px !important;
          margin-left: 0 !important;
        }
        /* ---- Tiles: left-side button overrides ---- */
        .tile-remove.btn-side-left {
          order: -1;
          margin-left: 0 !important;
          margin-right: auto;
        }
        .tile-remove.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -8px !important;
          margin-right: 0 !important;
        }
        .tile-remove.dot-style.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -4px !important;
        }
        
        /* ROWS MODE - Full-width gradients */
        .row-item {
          /* padding: 14px 16px; */
          padding: 0px calc(22.86px * var(--card-size-multiplier, 0.7));
          border-radius: calc(17.14px * var(--card-size-multiplier, 0.7));
          margin-bottom: calc(11.43px * var(--card-size-multiplier, 0.7));
          cursor: grab;
          transition: all 0.3s;
          position: relative;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          min-height: calc(80px * var(--card-size-multiplier, 0.7));
          display: flex;
          align-items: center;
        }
        /* Allow button to overflow when positioned outside */
        .row-item:has(.btn-pos-outside) {
          overflow: visible;
        }
        .row-item:hover {
          transform: translateX(4px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        }
        .row-item.dragging {
          opacity: 0.5;
        }
        .row-item:active {
          cursor: grabbing;
        }
        .row-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
        }
        .row-content {
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
          z-index: 1;
          flex: 1;
          min-width: 0;
        }
        .row-content > * {
          pointer-events: auto; /* Re-enable for children that need interaction */
        }
        .row-drag-indicator {
          font-size: 18px;
          opacity: 0.6;
          user-select: none;
          cursor: grab;
          line-height: 1;
          flex-shrink: 0;
        }
        .row-hex-display, .row-hex-input {
          font-family: monospace;
          font-size: 1em;
          font-weight: 600;
          min-width: 70px;
          flex-shrink: 0;
        }
        .row-hex-input {
          padding: 4px 8px;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: text;
        }
        .row-hex-input:focus {
          outline: none;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.3);
        }
        .row-color-name {
          flex: 1;
          font-size: 0.9em;
          opacity: 0.9;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* On devices with hover (desktop), disable pointer-events on row children
           to avoid interfering with HTML5 drag. Re-enable on hover.
           On touch devices (no hover), leave pointer-events enabled. */
        @media (hover: hover) {
          .row-color-input {
            pointer-events: none;
          }
          .row-content {
            pointer-events: none;
          }
          .row-content > * {
            pointer-events: auto;
          }
          .row-drag-indicator {
            pointer-events: none;
          }
          .row-hex-input:not(:focus) {
            pointer-events: none;
          }
          .row-item:hover .row-hex-input:not(:focus) {
            pointer-events: auto;
          }
          .row-color-name {
            pointer-events: none;
          }
        }

        .row-remove {
          /* Default: inside (relative, flex child at right end) */
          flex-shrink: 0;
          position: relative !important;
          top: auto !important;
          right: auto !important;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: auto;
        }
        /* Outside: absolute top-right corner */
        .row-remove.btn-pos-outside {
          position: absolute !important;
          top: -8px !important;
          right: -8px !important;
          margin-left: 0 !important;
          z-index: 10;
        }
        .row-remove.dot-style.btn-pos-outside {
          top: -4px !important;
          right: -4px !important;
        }
        /* ---- Rows: left-side button overrides ---- */
        .row-remove.btn-side-left {
          order: -1;
          margin-left: 0 !important;
          margin-right: auto;
        }
        .row-remove.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -8px !important;
          margin-right: 0 !important;
        }
        .row-remove.dot-style.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -4px !important;
        }
        
        /* Spread Arrangement - Cards spread on table */
        .cards-container { 
          display: flex;
          flex-wrap: wrap;
          gap: 30px;
          padding: 40px 20px;
          justify-content: space-evenly;
          align-items: flex-end;
          perspective: 1000px;
          max-width: 100%;
          margin: 0 auto;
        }

        /* Cascade Arrangement - overlapping waterfall */
        .cards-container.cascade-mode {
          gap: 0;
          padding: 30px 20px;
          justify-content: center;
          align-items: center;
        }
        .cards-container.cascade-mode .card-wrapper {
          margin-left: -28px;
        }
        .cards-container.cascade-mode .card-wrapper:first-child {
          margin-left: 0;
        }

        /* Tilt Arrangement - uniform rotation grid */
        .cards-container.tilt-mode {
          gap: 22px;
          padding: 30px 20px;
          justify-content: center;
          align-items: flex-start;
        }

        /* Fan Arrangement - semicircular arc */
        .cards-fan-container {
          display: flex;
          justify-content: center;
          align-items: flex-end;
          min-height: 320px;
          padding: 30px 10px 60px;
          position: relative;
          max-width: 100%;
          margin: 0 auto;
          perspective: 1200px;
        }
        .cards-fan-container .card-wrapper {
          position: absolute;
          transform-origin: 50% 320%;
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          pointer-events: none;
        }
        .cards-fan-container .card-item {
          pointer-events: auto;
          transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease, opacity 0.25s ease, filter 0.25s ease;
        }
        /* JS-managed classes: .fan-active on container, .fan-hovered on active wrapper */
        .cards-fan-container.fan-active .card-wrapper:not(.fan-hovered) {
          z-index: 0 !important;
        }
        .cards-fan-container.fan-active .card-wrapper.fan-hovered {
          z-index: 200 !important;
        }
        .cards-fan-container.fan-active .card-wrapper:not(.fan-hovered) .card-item {
          opacity: 0.35;
          filter: brightness(0.55) saturate(0.4);
        }
        .cards-fan-container.fan-active .card-wrapper.fan-hovered .card-item {
          transform: scale(1.12) !important;
          box-shadow: 0 8px 28px rgba(0,0,0,0.30);
        }

        /* Fan drag mode: keep fan shape, just enable pointer-events on wrappers */
        .cards-fan-container.dragging-active .card-wrapper {
          pointer-events: auto !important;
        }
        .cards-fan-container .card-wrapper.dragging .card-item {
          opacity: 0.75;
          outline: 2px dashed rgba(255,255,255,0.7);
          outline-offset: 3px;
          filter: brightness(1.1);
          box-shadow: 0 0 16px 4px rgba(255,255,255,0.25);
          transition: none !important;
        }
        /* Spread / Hand mode: same dashed-outline drop-preview as fan */
        .cards-container .card-wrapper.dragging .card-item,
        .cards-poker-container .card-wrapper.dragging .card-item {
          opacity: 0.75;
          outline: 2px dashed rgba(255,255,255,0.7);
          outline-offset: 3px;
          filter: brightness(1.1);
          box-shadow: 0 0 16px 4px rgba(255,255,255,0.25);
          transition: none !important;
        }
        
        /* Hand Arrangement - Poker Hand Style */
        .cards-poker-container {
          display: flex;
          flex-direction: column;
          /* gap: 40px;
          padding: 40px 20px; */
          /* align-items: center; */
          /* align-items: baseline; */
          margin: 0 auto 55px;
          max-width: 100%;
        }
        
        .poker-hand {
          display: flex;
          justify-content: center;
          align-items: flex-end;
          perspective: 1000px;
          position: relative;
          min-height: 220px;
        }
        
        .poker-card {
          position: absolute;
          transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        @keyframes cardAppear {
          from {
            opacity: 0;
            transform: scale(0.5) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        
        @keyframes cardDisappear {
          from {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          to {
            opacity: 0;
            transform: scale(0.5) translateY(20px);
          }
        }
        
        .card-wrapper {
          position: relative;
          transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
          /* flex: 0 0 120px; */
          width: calc(171.43px * var(--card-size-multiplier, 0.7));
          margin: calc(-14.29px * var(--card-size-multiplier, 0.7));
        }
        
        /* Allow cards to adapt to available space - no max-width constraint */
        .cards-container {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 15px;
          padding: 10px;
        }
        
        .card-wrapper.card-entering {
          animation: cardAppear 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        
        .card-wrapper.card-removing {
          animation: cardDisappear 0.3s ease-out forwards;
          pointer-events: none;
        }
        
        .card-item { 
          position: relative;
          width: calc(171.43px * var(--card-size-multiplier, 0.7)); 
          height: calc(257.14px * var(--card-size-multiplier, 0.7)); 
          background: var(--card-background-color, white);
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          cursor: grab; 
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, z-index 0s 0.3s, margin 0.3s ease, opacity 0.3s ease;
          /* margin: 0 -20px; */
          transform-origin: bottom center;
          flex-shrink: 0;
          overflow: visible;
        }
        /* Item card border for dark mode visibility */
        .item-card-border .card-item {
          border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
        }
        .cards-container:not(.dragging-active) .card-item:hover::before,
        .cards-poker-container:not(.dragging-active) .card-item:hover::before {
          content: '';
          position: absolute;
          top: -25px;
          left: -16px;
          right: -16px;
          bottom: -35px;
          z-index: -1;
        }
        .cards-container:not(.dragging-active) .card-item:hover,
        .cards-poker-container:not(.dragging-active) .card-item:hover { 
          transform: translateY(-30px) scale(1.08) !important;
          z-index: 100 !important;
          box-shadow: 0 12px 32px rgba(0,0,0,0.25);
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, z-index 0s 0s;
        }
        /* Fan hover: entirely JS-managed via .fan-active/.fan-hovered classes */
        .cards-fan-container:not(.dragging-active) .card-item:hover {
          z-index: 100 !important;
        }
        /* Elevate the entire poker-hand ROW so hovered card renders above later rows */
        .cards-poker-container:not(.dragging-active) .poker-hand:has(.card-item:hover) {
          z-index: 200 !important;
        }
        /* Legacy — kept as fallback if dragging class ends up on card-item */
        .card-item.dragging {
          opacity: 0;
          visibility: hidden;
          cursor: grabbing;
          z-index: 1000;
          transition: none;
        }
        .card-item.touch-dragging {
          position: fixed;
          opacity: 0.9;
          cursor: grabbing;
          transform: scale(1.15) rotate(8deg);
          z-index: 10000;
          pointer-events: none;
          transition: none;
        }
        .card-wrapper.touch-dragging-placeholder {
          opacity: 0;
        }
        .card-wrapper.touch-dragging-placeholder .card-item {
          opacity: 0;
          visibility: hidden;
        }
        .card-wrapper.drag-placeholder {
          opacity: 0.3;
        }
        .card-face {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          border-radius: inherit;
        }
        .card-color-bar {
          flex: 1;
          width: 100%;
          min-height: 0;
          position: relative;
        }
        .card-color-picker {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          width: 100%;
          height: 100%;
          border: none;
          pointer-events: none;
        }
        .card-color-bar.clickable {
          cursor: pointer;
        }
        .card-info-area {
          background: var(--card-background-color, white);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          align-items: center;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.05));
        }
        .card-swatch {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          flex-shrink: 0;
        }
        .card-picker {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          flex-shrink: 0;
        }
        .card-hex, .card-hex-display {
          width: 100%;
          background: transparent;
          padding: 4px 6px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.75em;
          text-align: center;
          border: 1px solid var(--divider-color, rgba(0,0,0,0.1));
          box-sizing: border-box;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .card-hex {
          border: 1px solid var(--divider-color, rgba(0,0,0,0.2));
        }
        .card-name {
          width: 100%;
          padding: 3px 6px;
          font-size: 0.7em;
          color: var(--secondary-text-color, #666);
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-sizing: border-box;
        }
        .card-remove {
          /* Positioning comes from inline styles via getButtonPositionStyles() */
          position: absolute;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          width: 28px;
          height: 28px;
          font-size: 1.5em;
        }
        /* Dot-style on cards: position from inline styles */
        .card-remove.dot-style {
          /* No position override — inline styles from getButtonPositionStyles() apply */
        }
        
        /* Hide remove button during drag */
        .dragging-active .card-remove,
        .card-wrapper.dragging .card-remove,
        .card-wrapper.touch-dragging-placeholder .card-remove {
          opacity: 0 !important;
          pointer-events: none;
        }
        
        /* Angle section styles */
        .angle-section {
          margin-top: 16px;
          padding-top: 16px;
        }
        .angle-section.with-separator {
          border-top: 1px solid var(--divider-color, #e6e6e6);
        }
        .angle-section.no-separator {
          border-top: none;
        }
        .angle-title {
          font-size: 1.1em;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--primary-text-color, #333);
        }
        .angle-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .angle-slider {
          flex: 1 1 auto;
          min-width: 120px;
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--divider-color, #e0e0e0);
          outline: none;
          cursor: pointer;
          margin: 8px 0;
        }
        .angle-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: var(--primary-color, #1976d2);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          border: none;
          transition: all 0.2s ease;
        }
        .angle-slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: var(--primary-color, #1976d2);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          border: none;
          transition: all 0.2s ease;
        }
        .angle-input {
          width: 60px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          padding: 4px 6px;
          text-align: center;
        }
        .angle-preview {
          width: 64px;
          height: 64px;
          cursor: pointer;
          user-select: none;
        }
        
        /* Wheel Style */
        .wheel-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .color-wheel {
          cursor: pointer;
          border-radius: 50%;
        }

        .wheel-selector {
          cursor: pointer;
          filter: drop-shadow(1px 1px 3px rgba(0,0,0,0.3));
          transition: r 0.1s ease;
        }

        .wheel-selector:hover {
          r: 5;
        }

        /* Prevent text selection during dragging */
        .color-wheel, .default-container, .rect-container {
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        }

        .wheel-angle {
          font-size: 14px;
          font-weight: 500;
          color: var(--primary-text-color, #333);
          background: var(--card-background-color, rgba(255,255,255,0.9));
          border-radius: 4px;
          padding: 2px 6px;
          border: 1px solid var(--divider-color, #ddd);
        }

        /* Rectangle Style */
        .rect-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .color-rect {
          cursor: pointer;
        }

        .rect-selector {
          cursor: pointer;
          transition: r 0.2s ease;
        }

        .rect-selector:hover {
          r: 5;
        }

        .rect-angle {
          font-size: 14px;
          font-weight: 500;
          color: var(--primary-text-color, #333);
          background: var(--card-background-color, rgba(255,255,255,0.9));
          border-radius: 4px;
          padding: 2px 6px;
          border: 1px solid var(--divider-color, #ddd);
        }

        /* Runtime Controls */
        .runtime-controls {
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: 8px;
          padding: 12px;
          background: var(--secondary-background-color, #f7f8fa);
        }

        /* Scroll Controls */
        .scroll-info {
          font-family: monospace;
          color: var(--secondary-text-color, #656d76);
        }
        
        .scroll-controls input[type="range"] {
          height: 4px;
          background: var(--disabled-text-color, #d0d7de);
          border-radius: 2px;
          outline: none;
        }
        
        .scroll-controls input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #0969da);
          cursor: pointer;
        }
        
        .control-button {
          padding: 4px 8px;
          border: 1px solid var(--divider-color, #d0d7de);
          background: var(--card-background-color, white);
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85em;
          transition: all 0.2s ease;
        }
        
        .control-button:hover {
          background: var(--secondary-background-color, #f6f8fa);
        }

        .mode-btn {
          padding: 6px 10px;
          border: 1px solid var(--divider-color, #d0d7de);
          background: var(--card-background-color, white);
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85em;
          transition: all 0.2s ease;
          min-width: 60px;
        }

        .mode-btn:hover {
          background: var(--secondary-background-color, #f6f8fa);
        }

        .mode-btn.active {
          background: var(--primary-color, #0969da);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color, #0969da);
        }

        /* Colorized style */
        .mode-btn-colorized {
          padding: 8px 12px;
          border: 2px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85em;
          font-weight: 600;
          transition: all 0.3s ease;
          min-width: 70px;
          position: relative;
          overflow: hidden;
        }

        .mode-btn-colorized:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          border-color: rgba(255,255,255,0.3);
        }

        .mode-btn-colorized.active {
          transform: scale(1.05);
          box-shadow: 0 6px 20px rgba(0,0,0,0.25);
          border-color: var(--card-background-color, white);
        }

        .mode-btn-colorized::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255,255,255,0.1);
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .mode-btn-colorized:hover::before {
          opacity: 1;
        }

        /* Dropdown style */
        .mode-select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--divider-color, #d0d7de);
          border-radius: 6px;
          background: var(--card-background-color, white);
          font-size: 0.9em;
          cursor: pointer;
        }

        .mode-select:focus {
          outline: none;
          border-color: var(--primary-color, #0969da);
          box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
        }

        .panel-toggle input[type="checkbox"] {
          margin: 0;
        }

        .panel-toggle label {
          margin: 0;
          cursor: pointer;
        }

        /* Rounded Cards override — applied via CSS variable */
        .compact-item,
        .chip-item,
        .tile-item,
        .row-item,
        .color-grid-swatch,
        .card-item { border-radius: var(--rounded-cards-radius) !important; }
        .card-item .card-face { border-radius: var(--rounded-cards-radius) !important; }

        /* ===== Card Surface Effects ===== */
        .surface-gloss .card-color-bar::after,
        .surface-matte .card-color-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
        }
        .surface-gloss .card-color-bar::after {
          background: linear-gradient(135deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.10) 35%, transparent 55%);
        }
        .surface-matte .card-color-bar::after {
          background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.18) 100%);
        }
        /* Plastic: soft specular highlight + subtle edge darkening like injection-molded ABS */
        .surface-plastic .card-color-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
          background:
            linear-gradient(165deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 25%, transparent 50%),
            linear-gradient(to bottom, transparent 70%, rgba(0,0,0,0.22) 100%);
        }
        .surface-plastic .card-color-bar {
          filter: saturate(1.1) contrast(1.05);
        }

        /* ===== Card Shadow Styles ===== */
        .shadow-none .card-item { box-shadow: none !important; }
        .shadow-soft .card-item { box-shadow: 0 4px 16px rgba(0,0,0,0.15) !important; }
        .shadow-strong .card-item { box-shadow: 0 8px 28px rgba(0,0,0,0.32) !important; }
        .shadow-colored .card-item { box-shadow: 0 6px 22px color-mix(in srgb, var(--card-color, #888) 55%, transparent) !important; }

        /* ===== Card Hover Effects ===== */
        /* Disable default hover when a specific hover mode is set */
        .hover-none .cards-container:not(.dragging-active) .card-item:hover,
        .hover-none .cards-poker-container:not(.dragging-active) .card-item:hover,
        .hover-none .cards-fan-container:not(.dragging-active) .card-item:hover {
          transform: none !important;
          box-shadow: inherit !important;
        }
        .hover-glow .cards-container:not(.dragging-active) .card-item:hover,
        .hover-glow .cards-poker-container:not(.dragging-active) .card-item:hover {
          transform: translateY(-12px) scale(1.04) !important;
          z-index: 100 !important;
          box-shadow: 0 0 24px 8px color-mix(in srgb, var(--card-color, #888) 60%, transparent) !important;
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, z-index 0s 0s !important;
        }
        /* Fan glow: JS-managed via .fan-hovered class */
        .hover-glow .cards-fan-container.fan-active .card-wrapper.fan-hovered .card-item {
          box-shadow: 0 0 24px 8px color-mix(in srgb, var(--card-color, #888) 60%, transparent) !important;
        }
        .hover-glow .cards-poker-container:not(.dragging-active) .poker-hand:has(.card-item:hover) {
          z-index: 200 !important;
        }
        .hover-spotlight .cards-container:not(.dragging-active) .card-item:hover,
        .hover-spotlight .cards-poker-container:not(.dragging-active) .card-item:hover {
          transform: translateY(-16px) scale(1.06) !important;
          z-index: 100 !important;
          filter: brightness(1.15);
          box-shadow: 0 18px 44px rgba(0,0,0,0.40) !important;
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, filter 0.3s ease, z-index 0s 0s !important;
        }
        /* Fan spotlight: JS-managed via .fan-hovered class */
        .hover-spotlight .cards-fan-container.fan-active .card-wrapper.fan-hovered .card-item {
          filter: brightness(1.15);
          box-shadow: 0 18px 44px rgba(0,0,0,0.40) !important;
        }
        .hover-spotlight .cards-poker-container:not(.dragging-active) .poker-hand:has(.card-item:hover) {
          z-index: 200 !important;
        }
        /* lift uses the existing default hover rules */

        /* Shared Delete Button Styles */
        ${deleteButtonStyles}

        /* Shared Compact Mode Styles */
        ${compactModeStyles}

      </style>
      ${
        showCard
          ? `<ha-card${cardTitle ? ` header="${cardTitle}"` : ""}><div class="card-content">${cardContent}</div></ha-card>`
          : `<div class="card-content">${cardContent}</div>`
      }
    `;
    this._isInitialRenderComplete = true;
    this._lastLayoutMode = currentLayout;
    this._lastColorsKey = JSON.stringify(textColors);
    this._lastColorsLength = textColors.length;
    this.addEventListeners(textColors);

    setTimeout(() => {
      const root = this.shadowRoot;
      if (!root) return;
      root.querySelectorAll("input.hex-input").forEach((input) => {
        const idx = parseInt(input.dataset.idx);
        if (Array.isArray(textColors[idx])) {
          const hex = this.rgbToHex(textColors[idx]);
          if (input.value !== hex) input.value = hex;
        }
      });
    }, 0);
  }

  _attachColorListEventListeners() {
    const root = this.shadowRoot;
    if (!root) return;

    // For multi-entity support: use first entity as the source of truth
    const targetEntities =
      this.config.target_entities ||
      (this.config.entity ? [this.config.entity] : []);

    if (targetEntities.length === 0) return;

    const entityId = targetEntities[0]; // Use first entity (same as saveColors and render)

    // Determine textColors based on whether _hass is ready
    let textColors;
    if (!this._hass || !this._hass.states) {
      textColors = [[255, 255, 255]];
    } else {
      const stateObj = this._hass.states[entityId];
      textColors = PENDING_COLORS_STORE[entityId] ||
        (stateObj &&
          stateObj.attributes &&
          stateObj.attributes.text_colors) || [[255, 255, 255]];
    }

    // Add Color button - only attach if not already attached
    const addBtn = root.querySelector("#add-color");
    if (addBtn && !addBtn.hasAttribute("data-listener-attached")) {
      addBtn.setAttribute("data-listener-attached", "true");
      addBtn.addEventListener("click", () => {
        // Get CURRENT colors (not stale closure variable)
        const currentColors = this._getCurrentColors();
        currentColors.push([255, 255, 255]);
        this.saveColors(currentColors);
      });
    }

    // Randomize Order button - only attach if not already attached
    const randomizeBtn = root.querySelector("#randomize-order");

    if (randomizeBtn && !randomizeBtn.hasAttribute("data-listener-attached")) {
      randomizeBtn.setAttribute("data-listener-attached", "true");

      randomizeBtn.addEventListener("click", () => {
        // Get CURRENT colors (not stale closure variable)
        const currentColors = this._getCurrentColors();

        // Fisher-Yates shuffle algorithm
        const shuffled = [...currentColors];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        this.saveColors(shuffled);
      });
    }

    // Re-attach all color list event listeners
    this.addEventListeners(textColors);
  }

  addEventListeners(textColors) {
    const root = this.shadowRoot;
    if (!root) return;

    // Runtime Controls - Color Mode selectors (all styles)
    const modeSelectors = [
      ...root.querySelectorAll(".mode-btn"),
      ...root.querySelectorAll(".mode-btn-colorized"),
    ];

    modeSelectors.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const mode = e.target.dataset.mode;
        if (!this._hass || !this._getPrimaryEntity()) return;

        // Prevent multiple rapid clicks
        if (this._processingModeChange) {
          return;
        }
        this._processingModeChange = true;

        // Get current panel setting
        const applyToPanel =
          root.getElementById("apply-to-panel")?.checked || false;

        // Disable all mode selectors during processing
        modeSelectors.forEach((button) => {
          button.style.pointerEvents = "none";
          button.style.opacity = "0.6";
        });

        // Also disable dropdown if present
        const dropdown = root.querySelector(".mode-select");
        if (dropdown) {
          dropdown.style.pointerEvents = "none";
          dropdown.style.opacity = "0.6";
        }

        try {
          // Single merged call instead of two separate calls
          await this.callServiceOnTargetEntities("set_mode", {
            mode: mode,
            panel_mode: applyToPanel,
          });

          // Reduced wait time since only 1 call now
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Re-render to update button states
          this.render();
        } catch (error) {
          // Force re-render even on error to clear button states
          this.render();
        } finally {
          // Re-enable all mode selectors and clear processing flag
          modeSelectors.forEach((button) => {
            button.style.pointerEvents = "";
            button.style.opacity = "";
          });

          // Re-enable dropdown if present
          const dropdown = root.querySelector(".mode-select");
          if (dropdown) {
            dropdown.style.pointerEvents = "";
            dropdown.style.opacity = "";
          }

          this._processingModeChange = false;
        }
      });
    });

    // Runtime Controls - Dropdown selector
    const modeDropdown = root.querySelector(".mode-select");
    if (modeDropdown) {
      modeDropdown.addEventListener("change", async (e) => {
        const mode = e.target.value;
        if (
          !this._hass ||
          !this._getPrimaryEntity() ||
          this._processingModeChange
        )
          return;

        this._processingModeChange = true;

        // Get current panel setting
        const applyToPanel =
          root.getElementById("apply-to-panel")?.checked || false;

        // Disable dropdown during processing
        modeDropdown.style.pointerEvents = "none";
        modeDropdown.style.opacity = "0.6";

        try {
          await this.callServiceOnTargetEntities("set_mode", {
            mode: mode,
            panel_mode: applyToPanel,
          });

          await new Promise((resolve) => setTimeout(resolve, 100));

          this.render();
        } catch (error) {
          console.error("Error changing mode:", error);
          this.render();
        } finally {
          modeDropdown.style.pointerEvents = "";
          modeDropdown.style.opacity = "";
          this._processingModeChange = false;
        }
      });
    }

    // Runtime Controls - Apply to Whole Panel checkbox
    const panelCheckbox = root.getElementById("apply-to-panel");
    if (panelCheckbox) {
      panelCheckbox.addEventListener("change", async (e) => {
        if (!this._hass) return;

        const applyToPanel = e.target.checked;

        // Simply set the panel mode flag on all target entities
        await this.callServiceOnTargetEntities("set_panel_mode", {
          panel_mode: applyToPanel,
        });

        // Re-render to update states
        if (!this._renderScheduled) {
          this._renderScheduled = true;
          requestAnimationFrame(() => {
            this._renderScheduled = false;
            this.render();
          });
        }
      });
    }

    // Save as Palette button
    const savePaletteBtn = root.getElementById("save-palette");
    if (
      savePaletteBtn &&
      !savePaletteBtn.hasAttribute("data-listener-attached")
    ) {
      savePaletteBtn.setAttribute("data-listener-attached", "true");
      savePaletteBtn.addEventListener("click", async () => {
        if (!this._hass) return;

        // Get the current colors (not the stale closure variable)
        const currentColors = this._getCurrentColors();

        try {
          // Save palette globally (no entity_id = uses first light entity as default)
          // Note: config.entity is the palette sensor, not a light entity
          await this._hass.callService("yeelight_cube", "save_palette", {
            palette: currentColors,
            // Don't pass entity_id - let the service use the default light_entity
          });

          // Force sensor update to get fresh data immediately
          if (this.config && this.config.palette_sensor) {
            await this._hass.callService("homeassistant", "update_entity", {
              entity_id: this.config.palette_sensor,
            });
          }
        } catch (err) {
          console.error("Error saving palette:", err);
        }

        window.dispatchEvent(
          new CustomEvent("palette-saved", {
            detail: { palette: currentColors },
          }),
        );
      });
    }
    const self = this;
    // Color input handlers - prevent direct clicks from opening native picker
    // All color picking now goes through _openColorPickerAt() called by wrapper handlers
    root.querySelectorAll("input[type=color]").forEach((input) => {
      // Block any direct clicks on color inputs to prevent native picker double-open
      input.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Do NOT open picker here - wrapper handlers (bar, swatch, row, tile, etc.) handle it
      });
    });
    root.querySelectorAll("input.hex-input").forEach((input) => {
      // Prevent re-renders while typing in hex input
      input.addEventListener("focus", (e) => {
        this._editingText = true;
      });

      input.addEventListener("blur", (e) => {
        this._editingText = false;
        this._flushPendingRender();
      }); // Handle Enter/Escape keys to finish editing
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          input.blur(); // This will trigger the blur event and clear _editingText
        }
      });

      input.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const hex = e.target.value;
        const rgb = this.hexToRgb(hex);
        if (rgb) {
          // Get current colors (not stale closure)
          const currentColors = this._getCurrentColors();
          currentColors[idx] = rgb;

          const colorInput = root.querySelector(
            `input[type=color][data-idx='${idx}']`,
          );
          if (colorInput) colorInput.value = hex;

          // Optimistically update all visual elements for instant feedback
          this._updateColorVisuals(idx, rgb, hex);

          this.saveColors(currentColors);
        }
      });
    });

    // Color row click handler (covers standard list rows, full-row-color rows, and "rows" mode items)
    root
      .querySelectorAll('.color-row, [data-color-row="true"]')
      .forEach((row) => {
        row.addEventListener("click", (e) => {
          // Don't trigger if clicking on buttons, inputs, or drag handle
          if (
            e.target.tagName === "BUTTON" ||
            e.target.tagName === "INPUT" ||
            e.target.classList.contains("drag-handle") ||
            e.target.closest("button") ||
            e.target.closest(".drag-handle")
          ) {
            return;
          }

          const idx = parseInt(row.dataset.idx);
          const hiddenColorInput = row.querySelector('input[type="color"]');
          if (hiddenColorInput) {
            this._openColorPickerAt(
              idx,
              hiddenColorInput.value,
              e.pageX,
              e.pageY,
            );
          }
        });
      });

    // Card color bar click handler (for cards mode with pointer-events: none on color picker)
    root.querySelectorAll(".card-color-bar.clickable").forEach((bar) => {
      bar.addEventListener("click", (e) => {
        // Don't trigger if clicking on delete button or other interactive elements
        if (
          e.target.tagName === "BUTTON" ||
          e.target.tagName === "INPUT" ||
          e.target.closest("button")
        ) {
          return;
        }

        // Find the color picker input inside this bar
        const colorInput = bar.querySelector(
          'input[type="color"].card-color-picker',
        );
        if (colorInput) {
          const idx = parseInt(colorInput.dataset.idx);
          this._openColorPickerAt(idx, colorInput.value, e.pageX, e.pageY);
        }
      });
    });

    // Remove button - Use event delegation on container instead of individual buttons
    // This dramatically improves performance by avoiding iteration through all buttons on every render
    const colorListContainer = root.querySelector("#color-list");
    if (
      colorListContainer &&
      !colorListContainer.hasAttribute("data-remove-listener-attached")
    ) {
      colorListContainer.setAttribute("data-remove-listener-attached", "true");

      colorListContainer.addEventListener("click", (e) => {
        // Check if clicked element is a remove button or inside one
        const button = e.target.closest("button[data-action=remove]");
        if (!button) return;

        e.preventDefault();
        e.stopPropagation();

        const idx = parseInt(button.dataset.idx);

        // Get CURRENT colors (not stale closure variable)
        const currentColors = this._getCurrentColors();

        if (isNaN(idx) || idx < 0 || idx >= currentColors.length) {
          console.error(
            `[REMOVE COLOR] Invalid remove index: ${idx}, valid range: 0-${
              currentColors.length - 1
            }`,
          );

          // Disable the button to prevent multiple clicks
          button.disabled = true;
          button.style.opacity = "0.5";
          button.style.pointerEvents = "none";

          // Force a full re-render to clean up stale DOM
          this._isInitialRenderComplete = false;
          this.render();
          return;
        }

        if (currentColors.length > 1) {
          // Create a new array without the removed item (don't mutate the original)
          const newColors = currentColors.filter((_, i) => i !== idx);
          this.saveColors(newColors);
        } else {
        }
      });
    }

    // NEW MODES DRAG-AND-DROP SETUP
    const newModesLayout = this.config.list_layout || "compact";

    if (
      (newModesLayout === "compact" ||
        newModesLayout === "chips" ||
        newModesLayout === "tiles" ||
        newModesLayout === "rows") &&
      this.config.allow_drag_drop !== false
    ) {
      let draggedItem = null;
      let draggedIndex = null;

      const itemSelector =
        newModesLayout === "chips"
          ? ".chip-item"
          : newModesLayout === "compact"
            ? ".compact-item"
            : newModesLayout === "tiles"
              ? ".tile-item"
              : ".row-item";

      root.querySelectorAll(itemSelector).forEach((item) => {
        item.addEventListener("dragstart", (e) => {
          const focusedElement = document.activeElement;
          if (
            focusedElement &&
            focusedElement.classList.contains("hex-input")
          ) {
            e.preventDefault();
            return;
          }

          self._isDragging = true;
          draggedItem = item;
          draggedIndex = parseInt(item.dataset.idx);
          item.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";

          // Force layout calculation before drag operations begin
          // This prevents position offset issues on the first drag
          void item.offsetHeight;
        });

        item.addEventListener("dragend", () => {
          if (draggedItem) {
            draggedItem.classList.remove("dragging");

            // Get new order
            const items = Array.from(root.querySelectorAll(itemSelector));
            const newOrder = items.map((i) => parseInt(i.dataset.idx));
            const newColors = newOrder
              .map((idx) => textColors[idx])
              .filter((color) => Array.isArray(color) && color.length === 3);

            const orderChanged = newOrder.some((pos, idx) => pos !== idx);

            if (orderChanged && newColors.length === textColors.length) {
              self._isReordering = true;
              self.saveColors(newColors);
            }
          }

          draggedItem = null;
          draggedIndex = null;
          self._isDragging = false;
          self._flushPendingRender();
        });

        item.addEventListener("dragover", (e) => {
          if (e.preventDefault) e.preventDefault();
          e.dataTransfer.dropEffect = "move";

          if (draggedItem && item !== draggedItem) {
            const items = Array.from(root.querySelectorAll(itemSelector));
            const draggedIdx = items.indexOf(draggedItem);
            const targetIdx = items.indexOf(item);

            // Only update DOM if the position would actually change
            if (
              draggedIdx !== -1 &&
              targetIdx !== -1 &&
              Math.abs(draggedIdx - targetIdx) > 0
            ) {
              // Check if draggedItem is already in the correct position relative to item
              const currentNext = draggedItem.nextElementSibling;
              const currentPrev = draggedItem.previousElementSibling;

              if (draggedIdx < targetIdx) {
                // Moving forward - should be after target
                if (currentPrev !== item) {
                  const nextSibling = item.nextElementSibling;
                  if (nextSibling) {
                    item.parentNode.insertBefore(draggedItem, nextSibling);
                  } else {
                    item.parentNode.appendChild(draggedItem);
                  }
                }
              } else {
                // Moving backward - should be before target
                if (currentNext !== item) {
                  item.parentNode.insertBefore(draggedItem, item);
                }
              }
            }
          }

          return false;
        });

        // --- Touch drag support (mobile) ---
        let touchStartX = 0;
        let touchStartY = 0;
        let touchIsDragging = false;
        let touchClone = null;

        item.addEventListener(
          "touchstart",
          (e) => {
            // Don't start if input is focused or on remove buttons
            const focused = document.activeElement;
            if (focused && focused.classList.contains("hex-input")) return;
            if (
              e.target.closest(
                ".chip-remove, .compact-remove, .tile-remove, .row-remove",
              )
            )
              return;

            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchIsDragging = false;

            draggedItem = item;
            draggedIndex = parseInt(item.dataset.idx);
          },
          { passive: true },
        );

        item.addEventListener(
          "touchmove",
          (e) => {
            if (!draggedItem || draggedItem !== item) return;
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);

            if (!touchIsDragging && (dx > 8 || dy > 8)) {
              touchIsDragging = true;
              self._isDragging = true;
              item.classList.add("dragging");

              // Create clone to follow finger
              const rect = item.getBoundingClientRect();
              touchClone = item.cloneNode(true);
              touchClone.style.cssText = `
                position: fixed; z-index: 99999; pointer-events: none;
                width: ${rect.width}px; opacity: 0.85;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                transform: scale(1.03); transition: none;
                left: ${touch.clientX - rect.width / 2}px;
                top: ${touch.clientY - 20}px;
              `;
              document.body.appendChild(touchClone);
            }

            if (touchIsDragging) {
              e.preventDefault();
              // Move clone
              if (touchClone) {
                const rect = item.getBoundingClientRect();
                touchClone.style.left = touch.clientX - rect.width / 2 + "px";
                touchClone.style.top = touch.clientY - 20 + "px";
              }

              // Find element under finger and reorder
              const elemBelow = document.elementFromPoint(
                touch.clientX,
                touch.clientY,
              );
              if (elemBelow) {
                const targetItem = elemBelow.closest(itemSelector);
                if (
                  targetItem &&
                  targetItem !== draggedItem &&
                  targetItem.parentNode === draggedItem.parentNode
                ) {
                  const allItems = Array.from(
                    root.querySelectorAll(itemSelector),
                  );
                  const dIdx = allItems.indexOf(draggedItem);
                  const tIdx = allItems.indexOf(targetItem);
                  if (dIdx !== -1 && tIdx !== -1) {
                    if (dIdx < tIdx) {
                      const next = targetItem.nextElementSibling;
                      if (next)
                        targetItem.parentNode.insertBefore(draggedItem, next);
                      else targetItem.parentNode.appendChild(draggedItem);
                    } else {
                      targetItem.parentNode.insertBefore(
                        draggedItem,
                        targetItem,
                      );
                    }
                  }
                }
              }
            }
          },
          { passive: false },
        );

        item.addEventListener(
          "touchend",
          (e) => {
            if (!draggedItem || draggedItem !== item) return;

            // Remove clone
            if (touchClone && touchClone.parentNode) {
              touchClone.parentNode.removeChild(touchClone);
              touchClone = null;
            }

            if (touchIsDragging) {
              draggedItem.classList.remove("dragging");
              const items = Array.from(root.querySelectorAll(itemSelector));
              const newOrder = items.map((i) => parseInt(i.dataset.idx));
              const newColors = newOrder
                .map((idx) => textColors[idx])
                .filter((color) => Array.isArray(color) && color.length === 3);
              const orderChanged = newOrder.some((pos, idx) => pos !== idx);
              if (orderChanged && newColors.length === textColors.length) {
                self._isReordering = true;
                self.saveColors(newColors);
              }
            }

            draggedItem = null;
            draggedIndex = null;
            touchIsDragging = false;
            self._isDragging = false;
            self._flushPendingRender();
          },
          { passive: true },
        );

        item.addEventListener(
          "touchcancel",
          () => {
            if (touchClone && touchClone.parentNode)
              touchClone.parentNode.removeChild(touchClone);
            touchClone = null;
            if (draggedItem) draggedItem.classList.remove("dragging");
            draggedItem = null;
            draggedIndex = null;
            touchIsDragging = false;
            self._isDragging = false;
            self._flushPendingRender();
          },
          { passive: true },
        );
      });

      // TILES MODE: Add color picker click handler for tile-color-preview
      if (newModesLayout === "tiles") {
        root.querySelectorAll(".tile-item").forEach((item) => {
          const colorPicker = item.querySelector(".tile-color-input");
          const colorPreview = item.querySelector(".tile-color-preview");

          if (colorPicker && colorPreview) {
            let mouseDownTime = 0;
            let hasMoved = false;

            colorPreview.addEventListener("click", (e) => {
              // Don't trigger if clicking on remove button
              if (e.target.closest(".tile-remove")) return;

              // Only trigger if it was a click, not a drag
              if (!hasMoved && Date.now() - mouseDownTime < 300) {
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt(colorPicker.dataset.idx);
                this._openColorPickerAt(
                  idx,
                  colorPicker.value,
                  e.pageX,
                  e.pageY,
                );
              }
            });

            colorPreview.addEventListener("mousedown", (e) => {
              if (e.target.closest(".tile-remove")) return;
              mouseDownTime = Date.now();
              hasMoved = false;
            });

            colorPreview.addEventListener("mousemove", () => {
              hasMoved = true;
            });

            // Touch equivalents for tile color picker detection
            colorPreview.addEventListener(
              "touchstart",
              (e) => {
                if (e.target.closest(".tile-remove")) return;
                mouseDownTime = Date.now();
                hasMoved = false;
              },
              { passive: true },
            );

            colorPreview.addEventListener(
              "touchmove",
              () => {
                hasMoved = true;
              },
              { passive: true },
            );
          }
        });
      }

      // CHIPS MODE: Add color picker click handler for chip-color-swatch
      if (newModesLayout === "chips") {
        root.querySelectorAll(".chip-color-swatch").forEach((swatch) => {
          const colorPicker = swatch.querySelector(".chip-color-input");
          if (colorPicker) {
            swatch.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const idx = parseInt(colorPicker.dataset.idx);
              this._openColorPickerAt(idx, colorPicker.value, e.pageX, e.pageY);
            });
          }
        });
      }

      // COMPACT MODE: Add color picker click handler for compact-swatch
      if (newModesLayout === "compact") {
        root.querySelectorAll(".compact-swatch").forEach((swatch) => {
          const colorPicker = swatch.querySelector(".compact-color-input");
          if (colorPicker) {
            swatch.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const idx = parseInt(colorPicker.dataset.idx);
              this._openColorPickerAt(idx, colorPicker.value, e.pageX, e.pageY);
            });
          }
        });
      }
    }

    // Drag reorder setup if enabled
    if (this.config.allow_drag_drop !== false) {
      let dragStartIndex = null;
      let draggingElem = null;
      root.querySelectorAll(".drag-handle").forEach((handle) => {
        handle.addEventListener("mousedown", (e) => {
          // Don't start dragging if a hex input field is focused (user might be selecting text)
          const focusedElement = document.activeElement;
          if (
            focusedElement &&
            focusedElement.classList.contains("hex-input")
          ) {
            return;
          }

          e.preventDefault();
          self._isDragging = true;
          dragStartIndex = parseInt(handle.dataset.idx);
          draggingElem = handle.closest(".color-row");
          if (draggingElem) draggingElem.classList.add("dragging");
          const handleMouseMove = (e) => {
            if (!draggingElem) return;
            const colorList = root.getElementById("color-list");
            const actionRow = root.querySelector(".action-row");

            // Check if mouse is over the action row area
            if (actionRow) {
              const actionRowRect = actionRow.getBoundingClientRect();
              if (e.clientY >= actionRowRect.top) {
                // Mouse is over action row area, place at end of color list
                colorList.appendChild(draggingElem);
                return;
              }
            }

            const afterElement = getDragAfterElement(colorList, e.clientY);

            if (afterElement == null) {
              // If no after element found, insert before action row (at the end of color rows)
              if (actionRow) {
                colorList.insertBefore(draggingElem, actionRow);
              } else {
                colorList.appendChild(draggingElem);
              }
            } else {
              colorList.insertBefore(draggingElem, afterElement);
            }
          };
          const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            self._dragCleanup = null;
            self._isDragging = false;
            self._flushPendingRender();
            if (!draggingElem) return;
            draggingElem.classList.remove("dragging");
            const colorList = root.getElementById("color-list");
            const newOrder = [
              ...colorList.querySelectorAll(".color-row[data-idx]"),
            ].map((row) => parseInt(row.dataset.idx));
            let dragColors = newOrder.map((i) => textColors[i]);
            if (dragColors && dragColors.length > 0) {
              dragColors = dragColors.filter(
                (c) =>
                  Array.isArray(c) &&
                  c.length === 3 &&
                  c.every((v) => typeof v === "number"),
              );
              draggingElem = null;

              // Set flag to skip animations during reorder
              self._isReordering = true;

              self.saveColors(dragColors);
            } else {
              draggingElem = null;
            }
            if (!self._renderScheduled) {
              self._renderScheduled = true;
              requestAnimationFrame(() => {
                self._renderScheduled = false;
                self.render();
              });
            }
          };
          // Store references so disconnectedCallback can clean up mid-drag
          self._dragCleanup = { handleMouseMove, handleMouseUp };

          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
        });

        // --- Touch support for list drag handles (mobile) ---
        handle.addEventListener(
          "touchstart",
          (e) => {
            const focused = document.activeElement;
            if (focused && focused.classList.contains("hex-input")) return;

            const touch = e.touches[0];
            self._isDragging = true;
            dragStartIndex = parseInt(handle.dataset.idx);
            draggingElem = handle.closest(".color-row");
            if (draggingElem) draggingElem.classList.add("dragging");

            let lastTouchY = touch.clientY;

            const handleTouchMove = (e) => {
              if (!draggingElem) return;
              e.preventDefault();
              const t = e.touches[0];
              lastTouchY = t.clientY;

              const colorList = root.getElementById("color-list");
              const actionRow = root.querySelector(".action-row");

              if (actionRow) {
                const actionRowRect = actionRow.getBoundingClientRect();
                if (t.clientY >= actionRowRect.top) {
                  colorList.appendChild(draggingElem);
                  return;
                }
              }

              const afterElement = getDragAfterElement(colorList, t.clientY);
              if (afterElement == null) {
                if (actionRow) colorList.insertBefore(draggingElem, actionRow);
                else colorList.appendChild(draggingElem);
              } else {
                colorList.insertBefore(draggingElem, afterElement);
              }
            };

            const handleTouchEnd = () => {
              document.removeEventListener("touchmove", handleTouchMove);
              document.removeEventListener("touchend", handleTouchEnd);
              document.removeEventListener("touchcancel", handleTouchEnd);
              self._isDragging = false;
              self._flushPendingRender();
              if (!draggingElem) return;
              draggingElem.classList.remove("dragging");

              const colorList = root.getElementById("color-list");
              const newOrder = [
                ...colorList.querySelectorAll(".color-row[data-idx]"),
              ].map((row) => parseInt(row.dataset.idx));
              let dragColors = newOrder.map((i) => textColors[i]);
              if (dragColors && dragColors.length > 0) {
                dragColors = dragColors.filter(
                  (c) =>
                    Array.isArray(c) &&
                    c.length === 3 &&
                    c.every((v) => typeof v === "number"),
                );
                draggingElem = null;
                self._isReordering = true;
                self.saveColors(dragColors);
              } else {
                draggingElem = null;
              }
              if (!self._renderScheduled) {
                self._renderScheduled = true;
                requestAnimationFrame(() => {
                  self._renderScheduled = false;
                  self.render();
                });
              }
            };

            document.addEventListener("touchmove", handleTouchMove, {
              passive: false,
            });
            document.addEventListener("touchend", handleTouchEnd, {
              passive: true,
            });
            document.addEventListener("touchcancel", handleTouchEnd, {
              passive: true,
            });
          },
          { passive: true },
        );
      });
      function getDragAfterElement(container, y) {
        const draggableElements = [
          ...container.querySelectorAll(
            ".color-row:not(.dragging):not(.action-row)",
          ),
        ];
        return draggableElements.reduce(
          (closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
              return { offset: offset, element: child };
            } else {
              return closest;
            }
          },
          { offset: Number.NEGATIVE_INFINITY },
        ).element;
      }
      root.querySelectorAll("input[type=color]").forEach((input) => {
        input.addEventListener("mousedown", (e) => {
          e.stopPropagation();
        });
        input.addEventListener("touchstart", (e) => {
          e.stopPropagation();
        });
      });
    }

    // Fan arrangement: spread neighbour cards on hover, collapse when cursor
    // leaves the fan area entirely.
    //
    // The initial fan shape is created by card-item inline transforms
    // (rotate around card center). The wrapper has NO initial transform.
    // Spread/collapse only add/remove a PUSH OFFSET on the wrapper
    // (rotated around transform-origin 50% 320%), never the base rotation.
    const currentLayout = this.config.list_layout || "list";
    const cardArrangementForFan = this.config.card_arrangement || "hand";
    if (currentLayout === "cards" && cardArrangementForFan === "fan") {
      const fanContainer = root.querySelector(".cards-fan-container");
      if (fanContainer && !fanContainer._fanHoverInit) {
        fanContainer._fanHoverInit = true;
        let currentHoveredWrapper = null;
        let justCollapsed = false;

        // Cumulative push: each step away from the hovered card adds spacing,
        // with a decay factor so distant cards are still pushed but less per step.
        // The first gap (immediately next to hovered) is the largest.
        const firstGap = 18; // degrees for the immediate neighbour gap
        const pushPerStep = 8; // additional degrees per subsequent step
        const decay = 0.6; // each subsequent step pushes slightly less

        const spreadFan = (hoveredWrapper) => {
          if (hoveredWrapper === currentHoveredWrapper) return;
          currentHoveredWrapper = hoveredWrapper;
          const wrappers = Array.from(
            fanContainer.querySelectorAll(".card-wrapper"),
          );
          const hoveredIdx = wrappers.indexOf(hoveredWrapper);
          if (hoveredIdx === -1) return;
          fanContainer.classList.add("fan-active");
          wrappers.forEach((w, i) => {
            w.style.transition = "";
            if (i === hoveredIdx) {
              w.classList.add("fan-hovered");
              w.style.transform = "none";
            } else {
              w.classList.remove("fan-hovered");
              const dist = Math.abs(i - hoveredIdx);
              const sign = i > hoveredIdx ? 1 : -1;
              // First gap is large, then cumulative smaller steps
              let totalPush = firstGap;
              for (let k = 1; k < dist; k++) {
                totalPush += pushPerStep * Math.pow(decay, k - 1);
              }
              const push = sign * totalPush;
              w.style.transform = `rotate(${push}deg)`;
            }
          });
        };

        const collapseFan = () => {
          if (!currentHoveredWrapper) return;
          currentHoveredWrapper = null;
          justCollapsed = true;
          fanContainer.classList.remove("fan-active");
          fanContainer.querySelectorAll(".card-wrapper").forEach((w) => {
            w.classList.remove("fan-hovered");
            w.style.transition = "none";
            w.style.transform = "none";
          });
          requestAnimationFrame(() => {
            fanContainer.querySelectorAll(".card-wrapper").forEach((w) => {
              w.style.transition = "";
            });
          });
        };

        // --- Helper: resolve card-wrapper from a pointer coordinate ---
        const wrapperFromPoint = (clientX, clientY) => {
          const el = fanContainer
            .getRootNode()
            .elementFromPoint(clientX, clientY);
          if (!el) return null;
          const cardItem = el.closest && el.closest(".card-item");
          if (!cardItem) return null;
          return cardItem.closest(".card-wrapper");
        };

        // --- Mouse events (desktop) ---
        fanContainer.addEventListener("mousemove", (e) => {
          if (justCollapsed) return;
          if (fanContainer.classList.contains("dragging-active")) return;
          const wrapper = wrapperFromPoint(e.clientX, e.clientY);
          if (wrapper && fanContainer.contains(wrapper)) spreadFan(wrapper);
        });

        fanContainer.addEventListener("mouseenter", () => {
          justCollapsed = false;
        });

        fanContainer.addEventListener("mouseleave", () => {
          collapseFan();
        });

        // --- Touch events (mobile / tablet) ---
        // touchstart on a card → spread around it
        fanContainer.addEventListener(
          "touchstart",
          (e) => {
            if (fanContainer.classList.contains("dragging-active")) return;
            const touch = e.touches[0];
            if (!touch) return;
            justCollapsed = false;
            const wrapper = wrapperFromPoint(touch.clientX, touch.clientY);
            if (wrapper && fanContainer.contains(wrapper)) spreadFan(wrapper);
          },
          { passive: true },
        );

        // touchmove → update spread as finger slides across cards
        fanContainer.addEventListener(
          "touchmove",
          (e) => {
            if (fanContainer.classList.contains("dragging-active")) return;
            const touch = e.touches[0];
            if (!touch) return;
            const wrapper = wrapperFromPoint(touch.clientX, touch.clientY);
            if (wrapper && fanContainer.contains(wrapper)) {
              spreadFan(wrapper);
            }
          },
          { passive: true },
        );

        // touchend / touchcancel → collapse fan
        fanContainer.addEventListener(
          "touchend",
          () => {
            collapseFan();
          },
          { passive: true },
        );
        fanContainer.addEventListener(
          "touchcancel",
          () => {
            collapseFan();
          },
          { passive: true },
        );

        // Expose collapseFan so drag-and-drop code can call it
        fanContainer._collapseFan = collapseFan;
      }
    }

    // Cards layout drag-and-drop with wrapper-based drop zones
    if (currentLayout === "cards" && this.config.allow_drag_drop !== false) {
      const cardArrangement = this.config.card_arrangement || "hand";
      let draggedCard = null;
      let draggedIndex = null;
      let targetWrapper = null; // Track which wrapper has the gap indicator
      let touchStartY = 0;
      let touchStartX = 0;
      let isDragging = false;
      let lastUpdateTime = 0; // Throttle timer
      let clonedCard = null; // Clone that follows the finger
      const cardsContainer =
        cardArrangement === "hand"
          ? root.querySelector(".cards-poker-container")
          : root.querySelector(".cards-container") ||
            root.querySelector(".cards-fan-container");

      // Fan mode helpers (simplified for drag).
      // recalcFanRotations: restore normal fan arc after drop.
      const recalcFanRotations = () => {
        if (cardArrangement !== "fan" || !cardsContainer) return;
        const wrappers = Array.from(
          cardsContainer.querySelectorAll(".card-wrapper"),
        );
        const totalCards = wrappers.length;
        if (totalCards <= 1) return;
        const maxSpread = Math.min(50, totalCards * 6);
        const centerIndex = (totalCards - 1) / 2;
        wrappers.forEach((w, i) => {
          const offset = i - centerIndex;
          const rotationDeg =
            centerIndex > 0 ? (offset / centerIndex) * maxSpread : 0;
          const cardItem = w.querySelector(".card-item");
          if (cardItem) {
            cardItem.style.transform = `rotate(${rotationDeg.toFixed(1)}deg)`;
            cardItem.style.zIndex = i;
          }
          w.style.transform = "none";
          w.classList.remove("fan-hovered");
        });
      };

      // Fan mode: collapse fan hover state when drag starts.
      // Robust: directly cleans all fan classes/transforms without relying
      // on collapseFan's internal guard (avoids race with mouseleave).
      const spreadFanForDrag = () => {
        if (cardArrangement !== "fan" || !cardsContainer) return;
        // Reset internal hover tracking if collapseFan exists
        try {
          if (cardsContainer._collapseFan) cardsContainer._collapseFan();
        } catch (_) {}
        // Force-clean all fan hover state regardless
        cardsContainer.classList.remove("fan-active");
        cardsContainer.querySelectorAll(".card-wrapper").forEach((w) => {
          w.classList.remove("fan-hovered");
          w.style.transition = "none";
          w.style.transform = "none";
        });
        // Restore transitions next frame
        requestAnimationFrame(() => {
          if (!cardsContainer) return;
          cardsContainer.querySelectorAll(".card-wrapper").forEach((w) => {
            w.style.transition = "";
          });
        });
      };

      // Helper function to find insertion position and reorder DOM
      const updateCardPositions = (clientX, clientY) => {
        if (!draggedCard) return;

        const wrappers = Array.from(root.querySelectorAll(".card-wrapper"));
        const draggedCardIndex = wrappers.indexOf(draggedCard);

        // Find the wrapper closest to the cursor position
        let closestWrapper = null;
        let closestDistance = Infinity;
        let insertIndex = -1;

        wrappers.forEach((wrapper, index) => {
          if (wrapper === draggedCard) return;

          // Fan mode: wrappers are all position:absolute at the same spot,
          // so use card-item rects (which differ due to rotation) for distance.
          const el =
            cardArrangement === "fan"
              ? wrapper.querySelector(".card-item") || wrapper
              : wrapper;
          const rect = el.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          const distance = Math.sqrt(
            Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2),
          );

          if (distance < closestDistance) {
            closestDistance = distance;
            closestWrapper = wrapper;
            insertIndex = index;
          }
        });

        if (closestWrapper && insertIndex !== -1) {
          // Determine if we should insert before or after based on position
          // Fan mode: use card-item rect for before/after determination
          const beforeAfterEl =
            cardArrangement === "fan"
              ? closestWrapper.querySelector(".card-item") || closestWrapper
              : closestWrapper;
          const rect = beforeAfterEl.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;

          // If cursor is to the right of the card's center, insert after
          if (clientX > centerX) {
            insertIndex++;
          }

          // Adjust insert index if dragging from left to right
          if (draggedCardIndex < insertIndex) {
            insertIndex--;
          }

          // Only reorder if position changed
          if (insertIndex !== draggedCardIndex) {
            // For hand mode, we need to reorganize into rows
            if (cardArrangement === "hand") {
              // Get all wrappers in their new order
              const allWrappers = Array.from(
                root.querySelectorAll(".card-wrapper"),
              );
              const newOrder = [...allWrappers];

              // Remove dragged card from its current position
              newOrder.splice(draggedCardIndex, 1);

              // Insert at new position
              newOrder.splice(insertIndex, 0, draggedCard);

              // Clear all poker-hand containers
              const pokerContainer = root.querySelector(
                ".cards-poker-container",
              );
              if (pokerContainer) {
                pokerContainer.innerHTML = "";

                // Reorganize into rows of 4
                const cardsPerRow = 4;
                for (let i = 0; i < newOrder.length; i += cardsPerRow) {
                  const rowWrapper = document.createElement("div");
                  rowWrapper.className = "poker-hand";

                  // Add up to 4 cards to this row
                  for (
                    let j = 0;
                    j < cardsPerRow && i + j < newOrder.length;
                    j++
                  ) {
                    const card = newOrder[i + j];

                    // Recalculate poker hand positioning
                    const rowSize = Math.min(cardsPerRow, newOrder.length - i);
                    const centerIndex = (rowSize - 1) / 2;
                    const offset = j - centerIndex;
                    const rotationDeg = offset * 8;
                    const verticalOffset = Math.abs(offset) * 10;
                    const horizontalOffset = offset * -15;

                    // Update the card-item's inline styles
                    const cardItem = card.querySelector(".card-item");
                    if (cardItem) {
                      cardItem.style.transform = `rotate(${rotationDeg}deg) translateY(${verticalOffset}px) translateX(${horizontalOffset}px)`;
                      cardItem.style.zIndex = j;
                    }

                    rowWrapper.appendChild(card);
                  }

                  pokerContainer.appendChild(rowWrapper);
                }
              }
            } else {
              // Non-hand arrangements - simple reorder
              // Physically move the dragged card wrapper in the DOM
              if (insertIndex >= 0 && insertIndex < wrappers.length) {
                const targetPosition = wrappers[insertIndex];

                if (targetPosition && targetPosition !== draggedCard) {
                  if (insertIndex > draggedCardIndex) {
                    // Moving right - insert after target
                    const nextSibling = targetPosition.nextSibling;
                    if (nextSibling) {
                      cardsContainer.insertBefore(draggedCard, nextSibling);
                    } else {
                      // Target is last element, append to end
                      cardsContainer.appendChild(draggedCard);
                    }
                  } else {
                    // Moving left - insert before target
                    cardsContainer.insertBefore(draggedCard, targetPosition);
                  }
                  // Fan mode: recalculate rotations after reorder
                  // so cards animate to their new positions in the arc
                  recalcFanRotations();
                }
              }
            }
          }

          targetWrapper = closestWrapper;
        }
      };

      // Helper function to perform the drop
      const performDrop = () => {
        if (draggedCard) {
          // Use DOM order for all modes (fan is now flattened during drag)
          const wrappers = Array.from(root.querySelectorAll(".card-wrapper"));
          const newOrder = wrappers.map((w) => parseInt(w.dataset.position));

          // Reorder colors array based on new DOM order
          const newColors = newOrder
            .map((idx) => textColors[idx])
            .filter(
              (color) =>
                Array.isArray(color) &&
                color.length === 3 &&
                color.every((v) => typeof v === "number"),
            );

          // Only save if order actually changed and we have valid colors
          const orderChanged = newOrder.some((pos, idx) => pos !== idx);

          if (orderChanged && newColors.length === textColors.length) {
            // Set flag to skip animations during reorder
            self._isReordering = true;

            // Save the new order
            self.saveColors(newColors);
          }
        }

        // Clean up
        if (draggedCard) {
          draggedCard.classList.remove(
            "dragging",
            "touch-dragging-placeholder",
            "drag-placeholder",
          );
        }
        if (cardsContainer) {
          cardsContainer.classList.remove("dragging-active");
        }

        // Clean up fan state
        if (cardArrangement === "fan") {
          recalcFanRotations();
        }

        // Remove cloned card
        if (clonedCard && clonedCard.parentNode) {
          clonedCard.parentNode.removeChild(clonedCard);
        }

        targetWrapper = null;
        draggedCard = null;
        draggedIndex = null;
        clonedCard = null;
        isDragging = false;
      };

      root.querySelectorAll(".card-wrapper").forEach((wrapper) => {
        const card = wrapper.querySelector(".card-item");
        card.setAttribute("draggable", "true");

        // Mouse drag events
        card.addEventListener("dragstart", (e) => {
          // Don't start dragging if a hex input field is focused (user might be selecting text)
          const focusedElement = document.activeElement;
          if (
            focusedElement &&
            focusedElement.classList.contains("hex-input")
          ) {
            e.preventDefault();
            return;
          }

          draggedCard = wrapper;
          draggedIndex = parseInt(wrapper.dataset.position);
          wrapper.classList.add("dragging");
          if (cardsContainer) {
            cardsContainer.classList.add("dragging-active");
          }
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/html", card.innerHTML);

          // Create a colored drag ghost so the user sees the color being carried
          const dragColor =
            card.style.getPropertyValue("--card-color") || "#888";
          const dragImg = document.createElement("div");
          dragImg.style.cssText = `width:50px;height:70px;background:${dragColor};border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);position:absolute;top:-9999px;left:-9999px;`;
          document.body.appendChild(dragImg);
          e.dataTransfer.setDragImage(dragImg, 25, 35);
          // Clean up drag image element after browser captures it
          setTimeout(() => {
            if (dragImg.parentNode) dragImg.parentNode.removeChild(dragImg);
          }, 100);

          // CRITICAL: Defer fan collapse to AFTER browser captures the drag image.
          // Collapsing synchronously changes transforms, which makes the element
          // jump away from the cursor and the browser aborts the drag.
          if (cardArrangement === "fan") {
            setTimeout(() => spreadFanForDrag(), 0);
          }
        });

        card.addEventListener("dragend", (e) => {
          performDrop();
        });

        wrapper.addEventListener("dragover", (e) => {
          if (e.preventDefault) {
            e.preventDefault();
          }
          e.dataTransfer.dropEffect = "move";

          if (wrapper !== draggedCard) {
            // Throttle updates to max 60fps (every ~16ms)
            const now = Date.now();
            if (now - lastUpdateTime > 16) {
              lastUpdateTime = now;
              updateCardPositions(e.clientX, e.clientY);
            }
          }
          return false;
        });

        // Touch drag events
        card.addEventListener(
          "touchstart",
          (e) => {
            // Don't start dragging if a hex input field is focused (user might be selecting text)
            const focusedElement = document.activeElement;
            if (
              focusedElement &&
              focusedElement.classList.contains("hex-input")
            ) {
              return;
            }

            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;

            draggedCard = wrapper;
            draggedIndex = parseInt(wrapper.dataset.position);
            isDragging = false; // Will become true after slight movement
          },
          { passive: false },
        );

        card.addEventListener(
          "touchmove",
          (e) => {
            if (!draggedCard) return;

            const touch = e.touches[0];
            const deltaX = Math.abs(touch.clientX - touchStartX);
            const deltaY = Math.abs(touch.clientY - touchStartY);

            // Start dragging after 5px movement to avoid accidental drags
            if (!isDragging && (deltaX > 5 || deltaY > 5)) {
              isDragging = true;

              // Prevent scrolling
              e.preventDefault();

              // Add placeholder styling to original card
              wrapper.classList.add("touch-dragging-placeholder");
              if (cardsContainer) {
                cardsContainer.classList.add("dragging-active");
              }

              // Create clone that follows finger BEFORE collapsing fan
              // (so cardRect captures the current spread position)
              const cardRect = card.getBoundingClientRect();

              // Fan mode: defer collapse so clone captures correct position
              if (cardArrangement === "fan") {
                setTimeout(() => spreadFanForDrag(), 0);
              }
              clonedCard = card.cloneNode(true);
              clonedCard.classList.add("touch-dragging");
              clonedCard.style.width = cardRect.width + "px";
              clonedCard.style.height = cardRect.height + "px";
              clonedCard.style.left = touch.clientX - cardRect.width / 2 + "px";
              clonedCard.style.top = touch.clientY - cardRect.height / 2 + "px";
              document.body.appendChild(clonedCard);
            }

            if (isDragging) {
              e.preventDefault(); // Prevent scrolling

              // Update clone position
              if (clonedCard) {
                const cardRect = card.getBoundingClientRect();
                clonedCard.style.left =
                  touch.clientX - cardRect.width / 2 + "px";
                clonedCard.style.top =
                  touch.clientY - cardRect.height / 2 + "px";
              }

              updateCardPositions(touch.clientX, touch.clientY);
            }
          },
          { passive: false },
        );

        card.addEventListener(
          "touchend",
          (e) => {
            if (!draggedCard) return;
            if (isDragging) {
              performDrop();
            } else {
              // Was a tap, not a drag - clean up
              draggedCard = null;
              draggedIndex = null;
            }
          },
          { passive: false },
        );

        card.addEventListener(
          "touchcancel",
          (e) => {
            if (!draggedCard) return;
            performDrop();
          },
          { passive: false },
        );
      });

      // Add drop listener to container to catch drops in gaps (mouse only)
      if (cardsContainer) {
        cardsContainer.addEventListener("dragover", (e) => {
          if (e.preventDefault) {
            e.preventDefault();
          }
          e.dataTransfer.dropEffect = "move";

          // Throttle updates to max 60fps (every ~16ms)
          const now = Date.now();
          if (now - lastUpdateTime > 16) {
            lastUpdateTime = now;
            updateCardPositions(e.clientX, e.clientY);
          }

          return false;
        });

        cardsContainer.addEventListener("drop", (e) => {
          if (e.stopPropagation) {
            e.stopPropagation();
          }
          performDrop();
          return false;
        });
      }
    }

    // Grid layout drag-and-drop
    if (currentLayout === "grid" && this.config.allow_drag_drop !== false) {
      let draggedItem = null;
      let draggedIndex = null;
      let lastGridUpdateTime = 0; // Throttle timer
      const gridContainer = root.querySelector(".layout-grid");

      const updateGridPositions = (clientX, clientY) => {
        if (!draggedItem) return;

        const items = Array.from(root.querySelectorAll(".color-grid-item"));
        const draggedItemIndex = items.indexOf(draggedItem);

        // Find the item closest to cursor with expanded hitbox
        let closestItem = null;
        let closestDistance = Infinity;
        let insertIndex = -1;

        items.forEach((item, index) => {
          if (item === draggedItem) return;

          const rect = item.getBoundingClientRect();

          // Expand hitbox by 20px on all sides
          const expandedRect = {
            left: rect.left - 20,
            right: rect.right + 20,
            top: rect.top - 20,
            bottom: rect.bottom + 20,
          };

          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          // Check if cursor is within expanded hitbox
          const isInExpandedHitbox =
            clientX >= expandedRect.left &&
            clientX <= expandedRect.right &&
            clientY >= expandedRect.top &&
            clientY <= expandedRect.bottom;

          if (isInExpandedHitbox) {
            // Use distance for priority when in multiple hitboxes
            const distance = Math.sqrt(
              Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2),
            );

            if (distance < closestDistance) {
              closestDistance = distance;
              closestItem = item;
              insertIndex = index;
            }
          }
        });

        if (closestItem && insertIndex !== -1) {
          // Determine if we should insert before or after
          const rect = closestItem.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;

          if (clientX > centerX) {
            insertIndex++;
          }

          if (draggedItemIndex < insertIndex) {
            insertIndex--;
          }

          // Reorder in DOM
          if (insertIndex !== draggedItemIndex) {
            const targetItem = items[insertIndex];

            if (targetItem && targetItem !== draggedItem) {
              if (insertIndex > draggedItemIndex) {
                const nextSibling = targetItem.nextSibling;
                if (nextSibling) {
                  gridContainer.insertBefore(draggedItem, nextSibling);
                } else {
                  // Target is last element, append to end
                  gridContainer.appendChild(draggedItem);
                }
              } else {
                gridContainer.insertBefore(draggedItem, targetItem);
              }
            }
          }

          // Remove drag-over class from all items
          items.forEach((item) => item.classList.remove("grid-drag-over"));
          // Add to closest item
          if (closestItem) {
            closestItem.classList.add("grid-drag-over");
          }
        }
      };

      const performGridDrop = () => {
        // Re-enable rendering
        self._isDragging = false;
        self._flushPendingRender();

        if (draggedItem) {
          // Get new order from DOM
          const items = Array.from(root.querySelectorAll(".color-grid-item"));
          const newOrder = items.map((item) => parseInt(item.dataset.idx));

          // Reorder colors
          const newColors = newOrder
            .map((idx) => textColors[idx])
            .filter(
              (color) =>
                Array.isArray(color) &&
                color.length === 3 &&
                color.every((v) => typeof v === "number"),
            );

          const orderChanged = newOrder.some((pos, idx) => pos !== idx);

          if (orderChanged && newColors.length === textColors.length) {
            self._isReordering = true;
            self.saveColors(newColors);
          }
        }

        // Clean up
        if (draggedItem) {
          draggedItem.classList.remove("dragging");
        }
        if (gridContainer) {
          gridContainer.classList.remove("dragging-active");
        }
        root.querySelectorAll(".color-grid-item").forEach((item) => {
          item.classList.remove("grid-drag-over");
        });

        draggedItem = null;
        draggedIndex = null;
      };

      root.querySelectorAll(".color-grid-item").forEach((item) => {
        item.setAttribute("draggable", "true");

        // Prevent dragging when clicking on color picker or remove button
        const colorPicker = item.querySelector(".grid-color-picker");
        const removeBtn = item.querySelector(".grid-remove-btn");
        const swatch = item.querySelector(".color-grid-swatch");
        const colorInfo = item.querySelector(".color-grid-info");

        let dragStartX = 0;
        let dragStartY = 0;
        let mouseDownTime = 0;
        let hasMoved = false;

        if (colorPicker && swatch) {
          // Click on swatch triggers color picker at click position
          swatch.addEventListener("click", (e) => {
            // Don't trigger if clicking on remove button
            if (e.target.classList.contains("grid-remove-btn")) return;

            // Only trigger if it was a click, not a drag
            if (!hasMoved && Date.now() - mouseDownTime < 300) {
              e.preventDefault();
              e.stopPropagation();

              const idx = parseInt(colorPicker.dataset.idx);
              this._openColorPickerAt(idx, colorPicker.value, e.pageX, e.pageY);
            }
          });

          // Track mouse down position and time
          swatch.addEventListener("mousedown", (e) => {
            if (e.target.classList.contains("grid-remove-btn")) return;

            dragStartX = e.pageX;
            dragStartY = e.pageY;
            mouseDownTime = Date.now();
            hasMoved = false;
          });

          // Track if mouse moved (indicates drag intent)
          swatch.addEventListener("mousemove", (e) => {
            if (mouseDownTime > 0) {
              const dx = Math.abs(e.pageX - dragStartX);
              const dy = Math.abs(e.pageY - dragStartY);
              if (dx > 5 || dy > 5) {
                hasMoved = true;
              }
            }
          });

          // Touch equivalents for grid swatch click vs drag detection
          swatch.addEventListener(
            "touchstart",
            (e) => {
              if (e.target.classList.contains("grid-remove-btn")) return;
              const touch = e.touches[0];
              dragStartX = touch.pageX;
              dragStartY = touch.pageY;
              mouseDownTime = Date.now();
              hasMoved = false;
            },
            { passive: true },
          );

          swatch.addEventListener(
            "touchmove",
            (e) => {
              if (mouseDownTime > 0 && e.touches[0]) {
                const dx = Math.abs(e.touches[0].pageX - dragStartX);
                const dy = Math.abs(e.touches[0].pageY - dragStartY);
                if (dx > 5 || dy > 5) {
                  hasMoved = true;
                }
              }
            },
            { passive: true },
          );

          colorPicker.addEventListener("mousedown", (e) => {
            e.stopPropagation();
          });
        }

        // Allow dragging from the color info text
        if (colorInfo) {
          colorInfo.addEventListener("mousedown", (e) => {
            // Ensure dragging is enabled when starting from color info
            item.setAttribute("draggable", "true");
          });
        }

        if (removeBtn) {
          removeBtn.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            item.setAttribute("draggable", "false");
          });
          removeBtn.addEventListener("mouseup", (e) => {
            setTimeout(() => item.setAttribute("draggable", "true"), 100);
          });
        }

        item.addEventListener("dragstart", (e) => {
          // Don't start dragging if a hex input field is focused (user might be selecting text)
          const focusedElement = document.activeElement;
          if (
            focusedElement &&
            focusedElement.classList.contains("hex-input")
          ) {
            e.preventDefault();
            return;
          }

          // Prevent re-renders during drag
          self._isDragging = true;

          draggedItem = item;
          draggedIndex = parseInt(item.dataset.idx);
          item.classList.add("dragging");
          if (gridContainer) {
            gridContainer.classList.add("dragging-active");
          }
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/html", item.innerHTML);

          // Force layout calculation before drag operations begin
          // This prevents position offset issues on the first drag
          void item.offsetHeight;
        });

        item.addEventListener("dragend", (e) => {
          performGridDrop();
        });

        item.addEventListener("dragover", (e) => {
          if (e.preventDefault) {
            e.preventDefault();
          }
          e.dataTransfer.dropEffect = "move";

          if (item !== draggedItem) {
            // Throttle updates to max 60fps (every ~16ms)
            const now = Date.now();
            if (now - lastGridUpdateTime > 16) {
              lastGridUpdateTime = now;
              updateGridPositions(e.clientX, e.clientY);
            }
          }
          return false;
        });

        // --- Touch drag support for grid items (mobile) ---
        let gridTouchStartX = 0;
        let gridTouchStartY = 0;
        let gridTouchDragging = false;
        let gridTouchClone = null;

        item.addEventListener(
          "touchstart",
          (e) => {
            if (e.target.closest(".grid-remove-btn, .grid-color-picker"))
              return;
            const focused = document.activeElement;
            if (focused && focused.classList.contains("hex-input")) return;

            const touch = e.touches[0];
            gridTouchStartX = touch.clientX;
            gridTouchStartY = touch.clientY;
            gridTouchDragging = false;

            draggedItem = item;
            draggedIndex = parseInt(item.dataset.idx);
          },
          { passive: true },
        );

        item.addEventListener(
          "touchmove",
          (e) => {
            if (!draggedItem || draggedItem !== item) return;
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - gridTouchStartX);
            const dy = Math.abs(touch.clientY - gridTouchStartY);

            if (!gridTouchDragging && (dx > 8 || dy > 8)) {
              gridTouchDragging = true;
              self._isDragging = true;
              item.classList.add("dragging");
              if (gridContainer) gridContainer.classList.add("dragging-active");

              const rect = item.getBoundingClientRect();
              gridTouchClone = item.cloneNode(true);
              gridTouchClone.style.cssText = `
                position: fixed; z-index: 99999; pointer-events: none;
                width: ${rect.width}px; height: ${rect.height}px;
                opacity: 0.85; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                transform: scale(1.03); transition: none;
                left: ${touch.clientX - rect.width / 2}px;
                top: ${touch.clientY - rect.height / 2}px;
              `;
              document.body.appendChild(gridTouchClone);
            }

            if (gridTouchDragging) {
              e.preventDefault();
              if (gridTouchClone) {
                const rect = item.getBoundingClientRect();
                gridTouchClone.style.left =
                  touch.clientX - rect.width / 2 + "px";
                gridTouchClone.style.top =
                  touch.clientY - rect.height / 2 + "px";
              }

              const now = Date.now();
              if (now - lastGridUpdateTime > 16) {
                lastGridUpdateTime = now;
                updateGridPositions(touch.clientX, touch.clientY);
              }
            }
          },
          { passive: false },
        );

        item.addEventListener(
          "touchend",
          () => {
            if (gridTouchClone && gridTouchClone.parentNode) {
              gridTouchClone.parentNode.removeChild(gridTouchClone);
              gridTouchClone = null;
            }
            if (gridTouchDragging) {
              performGridDrop();
            } else {
              if (draggedItem) draggedItem.classList.remove("dragging");
              draggedItem = null;
              draggedIndex = null;
              self._isDragging = false;
              self._flushPendingRender();
            }
            gridTouchDragging = false;
          },
          { passive: true },
        );

        item.addEventListener(
          "touchcancel",
          () => {
            if (gridTouchClone && gridTouchClone.parentNode)
              gridTouchClone.parentNode.removeChild(gridTouchClone);
            gridTouchClone = null;
            if (draggedItem) draggedItem.classList.remove("dragging");
            if (gridContainer)
              gridContainer.classList.remove("dragging-active");
            draggedItem = null;
            draggedIndex = null;
            gridTouchDragging = false;
            self._isDragging = false;
            self._flushPendingRender();
          },
          { passive: true },
        );
      });

      if (gridContainer) {
        gridContainer.addEventListener("dragover", (e) => {
          if (e.preventDefault) {
            e.preventDefault();
          }
          e.dataTransfer.dropEffect = "move";

          // Throttle updates to max 60fps (every ~16ms)
          const now = Date.now();
          if (now - lastGridUpdateTime > 16) {
            lastGridUpdateTime = now;
            updateGridPositions(e.clientX, e.clientY);
          }
          return false;
        });

        gridContainer.addEventListener("drop", (e) => {
          if (e.stopPropagation) {
            e.stopPropagation();
          }
          performGridDrop();
          return false;
        });
      }
    }
  }

  // Angle-related methods (from angle gradient card)
  _bindAngleEvents() {
    const root = this.shadowRoot;
    if (!root) return;

    const angleInput = root.getElementById("angleinput");
    const angleSlider = root.getElementById("angleslider");
    const rotary = root.getElementById("angle-preview");

    // Angle input control
    if (angleInput) {
      angleInput.addEventListener("input", () => {
        let angle = parseFloat(angleInput.value);
        if (isNaN(angle)) angle = 0;
        angle = Math.max(0, Math.min(359, angle));
        if (angleSlider) angleSlider.value = angle;
        this._drawAnglePreviewMulti(angle, this._getCurrentTextColors());
        this._debouncedApplyAngle(angle);
      });
    }

    // Angle slider control
    if (angleSlider) {
      angleSlider.addEventListener("input", () => {
        this._usingSlider = true; // Flag to prevent re-renders during slider use
        let angle = parseFloat(angleSlider.value);
        if (isNaN(angle)) angle = 0;
        if (angleInput) angleInput.value = angle;
        this._drawAnglePreviewMulti(angle, this._getCurrentTextColors());
        this._debouncedApplyAngle(angle);
      });

      // Clear the slider flag when slider interaction ends
      angleSlider.addEventListener("mouseup", () => {
        setTimeout(() => {
          this._usingSlider = false;
          this._flushPendingRender();
        }, 100);
      });
      angleSlider.addEventListener("touchend", () => {
        setTimeout(() => {
          this._usingSlider = false;
          this._flushPendingRender();
        }, 100);
      });
      angleSlider.addEventListener("touchcancel", () => {
        setTimeout(() => {
          this._usingSlider = false;
          this._flushPendingRender();
        }, 100);
      });

      // Safety timeout to ensure flag gets cleared
      angleSlider.addEventListener("mouseleave", () => {
        setTimeout(() => {
          this._usingSlider = false;
          this._flushPendingRender();
        }, 200);
      });
    }

    // Rotary slider (SVG): click or drag to set angle
    if (rotary) {
      rotary.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = true;
        this._handleRotaryDrag(e);
      });
      rotary.addEventListener("mousemove", (e) => {
        if (this._draggingRotary) {
          e.preventDefault(); // Prevent text selection
          this._handleRotaryDrag(e);
        }
      });
      rotary.addEventListener("mouseup", (e) => {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = undefined;
        this._flushPendingRender();
      });
      rotary.addEventListener("mouseleave", (e) => {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = undefined;
        this._flushPendingRender();
      });
      rotary.addEventListener("touchstart", (e) => {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = true;
        this._handleRotaryDrag(e.touches[0]);
      });
      rotary.addEventListener("touchmove", (e) => {
        if (this._draggingRotary) {
          e.preventDefault(); // Prevent text selection
          this._handleRotaryDrag(e.touches[0]);
        }
      });
      rotary.addEventListener("touchend", (e) => {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = undefined;
        this._flushPendingRender();
      });
      rotary.addEventListener("touchcancel", (e) => {
        e.preventDefault();
        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = undefined;
        this._flushPendingRender();
      });
      rotary.addEventListener("click", (e) => {
        e.preventDefault(); // Prevent text selection
        this._handleRotaryDrag(e);
      });
    }
  } // Always get the current textColors from the entity state
  _getCurrentTextColors() {
    const entityId = this._getPrimaryEntity();
    const hass = this._hass;
    if (hass && entityId && hass.states[entityId]) {
      const stateObj = hass.states[entityId];
      return stateObj.attributes.text_colors || [[255, 255, 255]];
    }
    return [[255, 255, 255]];
  }

  // Draw rotary preview with multi-stop gradient
  _drawAnglePreviewMulti(angle, stops) {
    const style = this.config.angle_rotary_style || "default";

    // For ALL styles (including default), just update the display
    this._updateRotaryDisplay(angle);
    return;
  }

  _debouncedApplyAngle(angle) {
    this._pendingAngle = angle;
    if (this._angleDebounceTimer) {
      clearTimeout(this._angleDebounceTimer);
    }
    this._angleDebounceTimer = setTimeout(() => {
      if (this._pendingAngle !== null) {
        this._applyAngle(this._pendingAngle);
        this._lastAngleSent = this._pendingAngle;
        this._pendingAngle = null;
      }
    }, ANGLE_UPDATE_DEBOUNCE_MS);
  }

  _applyAngle(angle) {
    if (!this._hass) return;

    // Ensure angle is a valid number and convert to float
    const validAngle = parseFloat(angle);
    if (isNaN(validAngle)) {
      console.warn("Invalid angle value:", angle);
      return;
    }

    // Normalize angle to 0-359 range
    const normalizedAngle = ((validAngle % 360) + 360) % 360;

    this.callServiceOnTargetEntities("set_angle", {
      angle: normalizedAngle,
    });
  }

  _rgbToHex(rgb) {
    return _sharedRgbToHex(rgb);
  }

  _createColorWheelSegments(colors, radius) {
    return _sharedCreateColorWheelSegments(colors, radius);
  }

  _createWheelGradientStops(colors) {
    return _sharedCreateWheelGradientStops(colors);
  }

  _createShapeGradientStops(colors) {
    return _sharedCreateShapeGradientStops(colors);
  }
  _generateShapeMask(shape, selectorRadius) {
    return _sharedGenerateShapeMask(shape, selectorRadius);
  }

  _handleRotaryDrag(e) {
    // Prevent text selection during dragging
    e.preventDefault();

    const rotaryElement = this.shadowRoot.getElementById("angle-preview");
    if (!rotaryElement) return;

    const style = this.config.angle_rotary_style || "default";
    let angle = 0;

    const rect = rotaryElement.getBoundingClientRect();

    switch (style) {
      case "wheel":
        const wheelCx = rect.left + rect.width / 2;
        const wheelCy = rect.top + rect.height / 2;
        const wheelX = e.clientX - wheelCx;
        const wheelY = -(e.clientY - wheelCy); // Invert Y to match SVG coordinate system
        // Fix: 0° should be at center-right (3 o'clock), remove the +90 offset
        angle = (Math.atan2(wheelY, wheelX) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        break;

      case "rect":
        const rectCx = rect.left + rect.width / 2;
        const rectCy = rect.top + rect.height / 2;
        const rectX = e.clientX - rectCx;
        const rectY = -(e.clientY - rectCy); // Invert Y to match SVG coordinate system
        // Same logic as wheel - calculate angle from center
        angle = (Math.atan2(rectY, rectX) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        break;

      default:
        const defaultCx = rect.left + rect.width / 2;
        const defaultCy = rect.top + rect.height / 2;
        const defaultX = e.clientX - defaultCx;
        const defaultY = defaultCy - e.clientY;
        angle = (Math.atan2(defaultY, defaultX) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        break;
    }

    // Validate the calculated angle
    if (isNaN(angle) || !isFinite(angle)) {
      console.warn("Invalid angle calculated:", angle);
      return;
    }

    // Store the pending angle for immediate visual feedback
    this._isDragging = true;
    this._pendingAngle = angle;

    // Update both input and slider if they exist
    const angleInput = this.shadowRoot.getElementById("angleinput");
    const angleSlider = this.shadowRoot.getElementById("angleslider");
    if (angleInput) angleInput.value = Math.round(angle);
    if (angleSlider) angleSlider.value = Math.round(angle);

    // For wheel, rect, and default styles, update visual elements directly for better performance
    if (style === "wheel") {
      this._updateWheelVisual(angle);
    } else if (style === "rect") {
      this._updateRectVisual(angle);
    } else if (style === "default") {
      // Use EXACT same logic as wheel for default mode
      this._updateDefaultVisual(angle);
    } else {
      this._updateRotaryDisplay(angle);
    }

    this._debouncedApplyAngle(angle);
  }

  _updateRotaryDisplay(angle) {
    const rotaryContainer = this.shadowRoot.querySelector(
      ".wheel-container, .rect-container, .default-container",
    );
    if (!rotaryContainer) return;

    const style = this.config.angle_rotary_style || "default";

    switch (style) {
      case "wheel":
        this._updateWheelVisual(angle);
        break;

      case "rect":
        this._updateRectVisual(angle);
        break;

      case "default":
        // Use EXACT same logic as wheel
        const defaultSelectorRadians = (angle * Math.PI) / 180;
        const defaultSizePercent = this.config.default_size || 80;
        const defaultSize = Math.min(100, defaultSizePercent);
        const defaultSelectorRadius = (defaultSize * 40) / 100;

        const defaultSelectorX =
          50 + defaultSelectorRadius * Math.cos(defaultSelectorRadians);
        const defaultSelectorY =
          50 - defaultSelectorRadius * Math.sin(defaultSelectorRadians);
        const defaultGradientAngle = -angle;

        // Update selector dot position
        const defaultSelectorDot =
          this.shadowRoot.querySelector(".wheel-selector");
        if (defaultSelectorDot) {
          defaultSelectorDot.setAttribute("cx", defaultSelectorX);
          defaultSelectorDot.setAttribute("cy", defaultSelectorY);
        }

        // Update gradient rotation
        const defaultGradientGroup = this.shadowRoot.querySelector(
          "g[transform*='rotate']",
        );
        if (defaultGradientGroup) {
          defaultGradientGroup.setAttribute(
            "transform",
            `rotate(${defaultGradientAngle} 50 50)`,
          );
        }

        // Update angle display
        const defaultAngleDisplay =
          this.shadowRoot.querySelector(".default-angle");
        if (defaultAngleDisplay) {
          defaultAngleDisplay.textContent = `${Math.round(angle)}°`;
        }
        break;
    }
  }

  // Helper to update card position attributes after removal
  _updateCardPositions() {
    const root = this.shadowRoot;
    if (!root) return;

    const wrappers = root.querySelectorAll(".card-wrapper");
    wrappers.forEach((wrapper, index) => {
      wrapper.dataset.position = index;
      const cardItem = wrapper.querySelector(".card-item");
      if (cardItem) {
        cardItem.dataset.idx = index;
      }
    });
  }

  _getCurrentColors() {
    // For multi-entity support: use first entity as the source of truth
    const targetEntities =
      this.config.target_entities ||
      (this.config.entity ? [this.config.entity] : []);

    if (targetEntities.length === 0) {
      return [[255, 255, 255]]; // Default fallback
    }

    const entityId = targetEntities[0]; // Use first entity (same as saveColors and render)
    const hass = this._hass;

    // Get the current colors from global pending state or entity state
    const pendingColors = PENDING_COLORS_STORE[entityId];
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

  // Opens a color picker at the given page coordinates for the color at index idx.
  // Creates a temporary invisible <input type="color"> appended to document.body
  // positioned at (clickX, clickY) so the browser anchors its picker popup there.
  _openColorPickerAt(idx, currentValue, clickX, clickY) {
    // Clean up any previous picker without triggering a re-render (we're about to reopen)
    this._cleanupColorPicker(true);

    this._usingColorPicker = true; // Prevent re-renders

    const root = this.shadowRoot;

    // Create temporary input at click position
    const tempInput = document.createElement("input");
    tempInput.type = "color";
    tempInput.value = currentValue;
    tempInput.style.cssText = `
      position: absolute;
      left: ${clickX}px;
      top: ${clickY}px;
      width: 1px;
      height: 1px;
      padding: 0;
      border: 0;
      margin: 0;
      opacity: 0.01;
      pointer-events: none;
    `;

    // Store reference for cleanup
    this._activeTempInput = tempInput;

    // Add to body temporarily
    document.body.appendChild(tempInput);

    // Force layout so the browser knows the position before the picker opens
    void tempInput.getBoundingClientRect();

    // Set up event listener for color change
    tempInput.addEventListener("input", (e) => {
      const hex = e.target.value;
      const rgb = this.hexToRgb(hex);
      if (rgb) {
        // Get current colors (not stale closure)
        const currentColors = this._getCurrentColors();
        currentColors[idx] = rgb;

        // Update the original hidden input if it exists
        if (root) {
          const originalInput = root.querySelector(
            `input[type="color"][data-idx='${idx}']`,
          );
          if (originalInput) originalInput.value = hex;

          const hexInput = root.querySelector(
            `input.hex-input[data-idx='${idx}']`,
          );
          if (hexInput) hexInput.value = hex;
        }

        // Optimistically update all visual elements for instant feedback
        this._updateColorVisuals(idx, rgb, hex);
        this.saveColors(currentColors);
      }
    });

    // Only clean up on 'change' event (fires when user confirms or cancels the picker).
    // Do NOT listen to 'blur' — it fires immediately when the picker dialog opens,
    // which would destroy the input and close the picker before the user can interact.
    tempInput.addEventListener("change", () => {
      this._cleanupColorPicker(false);
    });

    // Open the color picker
    tempInput.click();
  }

  // Clean up the active temporary color picker input
  // skipFlush: true when we're about to immediately reopen (avoids a useless render cycle)
  _cleanupColorPicker(skipFlush) {
    if (this._activeTempInput) {
      if (this._activeTempInput.parentNode) {
        this._activeTempInput.parentNode.removeChild(this._activeTempInput);
      }
      this._activeTempInput = null;
    }
    this._usingColorPicker = false;
    if (!skipFlush) {
      this._flushPendingRender();
    }
  }

  // Optimistically update all visual elements when a color changes
  _updateColorVisuals(idx, rgb, hex) {
    const root = this.shadowRoot;
    if (!root) return;

    const displayMode = this.config.color_info_display || "rgb";

    // Update LIST mode elements
    const colorNameSpan = root.querySelector(
      `.color-row[data-idx='${idx}'] span`,
    );
    if (colorNameSpan) {
      colorNameSpan.textContent = this.formatColorInfo(rgb, displayMode);
    }

    const colorRow = root.querySelector(`.color-row[data-idx='${idx}']`);
    if (colorRow) {
      colorRow.style.backgroundColor = `rgb(${rgb.join(", ")})`;

      // Update text color for contrast if in full row mode
      if (colorRow.classList.contains("full-row-color")) {
        const contrastColor = this.getContrastTextColor(rgb);
        colorRow.style.color = contrastColor;

        // Update all text elements in the row for proper contrast
        const textElements = colorRow.querySelectorAll("span, .drag-handle");
        textElements.forEach((element) => {
          element.style.color = contrastColor;
        });
      }
    }

    // Update TILES mode elements
    const tilePreview = root.querySelector(
      `.tile-color-preview[data-idx='${idx}']`,
    );
    if (tilePreview) {
      tilePreview.style.background = hex;
    }

    const tileName = root.querySelector(
      `.tile-item[data-idx='${idx}'] .tile-color-name`,
    );
    if (tileName) {
      tileName.textContent = this.formatColorInfo(rgb, displayMode);
    }

    // Update CARDS mode elements
    const cardBar = root.querySelector(
      `.card-wrapper[data-position='${idx}'] .card-color-bar`,
    );
    if (cardBar) {
      cardBar.style.backgroundColor = hex;
    }

    const cardName = root.querySelector(
      `.card-wrapper[data-position='${idx}'] .card-name`,
    );
    if (cardName) {
      cardName.textContent = this.formatColorInfo(rgb, displayMode);
    }

    const cardHex = root.querySelector(
      `.card-wrapper[data-position='${idx}'] .card-hex-display`,
    );
    if (cardHex) {
      cardHex.textContent = hex;
    }
  }

  saveColors(textColors) {
    // For multi-entity support: use first entity as the source of truth
    const targetEntities =
      this.config.target_entities ||
      (this.config.entity ? [this.config.entity] : []);

    if (targetEntities.length === 0) {
      return;
    }

    const entityId = targetEntities[0]; // Use first entity for pending storage

    // Store old length to detect if array size changed
    const oldColors =
      PENDING_COLORS_STORE[entityId] ||
      this._hass?.states[entityId]?.attributes.text_colors ||
      [];
    const lengthChanged = oldColors.length !== textColors.length;

    // Store pending colors in global store (shared across all card instances)
    PENDING_COLORS_STORE[entityId] = textColors.slice();

    // Render SYNCHRONOUSLY if length changed to prevent stale DOM issues
    // (e.g., rapid clicks on remove button need immediate DOM updates)
    if (lengthChanged) {
      this.render();
    } else {
      // For color changes only, async render is fine
      if (!this._renderScheduled) {
        this._renderScheduled = true;
        requestAnimationFrame(() => {
          this._renderScheduled = false;
          this.render();
        });
      }
    }

    // If hass not ready yet, queue the service call for later
    if (!this._hass) {
      this._pendingServiceCalls.push({
        service: "set_text_colors",
        serviceData: { text_colors: textColors },
      });
      return;
    }

    // Use multi-entity service call - updates ALL target entities with the same colors
    this.callServiceOnTargetEntities("set_text_colors", {
      text_colors: textColors,
    });

    // Note: Pending colors will be cleared automatically in render()
    // when the sensor value matches, providing seamless sync
  }
  _getCardBorderRadius() {
    const v = this.config.rounded_cards;
    if (v === undefined || v === true || v === "round") return 16;
    if (v === false || v === "square") return 0;
    if (v === "rounded") return 4;
    return typeof v === "number" ? v : parseInt(v, 10) || 16;
  }
  rgbToHex(rgb) {
    return (
      "#" +
      rgb
        .map((v) => {
          const hex = v.toString(16).padStart(2, "0");
          return hex;
        })
        .join("")
    );
  }

  hexToRgb(hex) {
    if (!hex.startsWith("#") || hex.length !== 7) return null;
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  rgbToHsl(rgb) {
    const [r, g, b] = rgb.map((c) => c / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    const sum = max + min;

    let h = 0;
    let s = 0;
    const l = sum / 2;

    if (diff !== 0) {
      s = l > 0.5 ? diff / (2 - sum) : diff / sum;

      switch (max) {
        case r:
          h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / diff + 2) / 6;
          break;
        case b:
          h = ((r - g) / diff + 4) / 6;
          break;
      }
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  getClosestCssColorName(rgb) {
    const cssColors = {
      aliceblue: [240, 248, 255],
      antiquewhite: [250, 235, 215],
      aqua: [0, 255, 255],
      aquamarine: [127, 255, 212],
      azure: [240, 255, 255],
      beige: [245, 245, 220],
      bisque: [255, 228, 196],
      black: [0, 0, 0],
      blanchedalmond: [255, 235, 205],
      blue: [0, 0, 255],
      blueviolet: [138, 43, 226],
      brown: [165, 42, 42],
      burlywood: [222, 184, 135],
      cadetblue: [95, 158, 160],
      chartreuse: [127, 255, 0],
      chocolate: [210, 105, 30],
      coral: [255, 127, 80],
      cornflowerblue: [100, 149, 237],
      cornsilk: [255, 248, 220],
      crimson: [220, 20, 60],
      cyan: [0, 255, 255],
      darkblue: [0, 0, 139],
      darkcyan: [0, 139, 139],
      darkgoldenrod: [184, 134, 11],
      darkgray: [169, 169, 169],
      darkgreen: [0, 100, 0],
      darkkhaki: [189, 183, 107],
      darkmagenta: [139, 0, 139],
      darkolivegreen: [85, 107, 47],
      darkorange: [255, 140, 0],
      darkorchid: [153, 50, 204],
      darkred: [139, 0, 0],
      darksalmon: [233, 150, 122],
      darkseagreen: [143, 188, 143],
      darkslateblue: [72, 61, 139],
      darkslategray: [47, 79, 79],
      darkturquoise: [0, 206, 209],
      darkviolet: [148, 0, 211],
      deeppink: [255, 20, 147],
      deepskyblue: [0, 191, 255],
      dimgray: [105, 105, 105],
      dodgerblue: [30, 144, 255],
      firebrick: [178, 34, 34],
      floralwhite: [255, 250, 240],
      forestgreen: [34, 139, 34],
      fuchsia: [255, 0, 255],
      gainsboro: [220, 220, 220],
      ghostwhite: [248, 248, 255],
      gold: [255, 215, 0],
      goldenrod: [218, 165, 32],
      gray: [128, 128, 128],
      green: [0, 128, 0],
      greenyellow: [173, 255, 47],
      honeydew: [240, 255, 240],
      hotpink: [255, 105, 180],
      indianred: [205, 92, 92],
      indigo: [75, 0, 130],
      ivory: [255, 255, 240],
      khaki: [240, 230, 140],
      lavender: [230, 230, 250],
      lavenderblush: [255, 240, 245],
      lawngreen: [124, 252, 0],
      lemonchiffon: [255, 250, 205],
      lightblue: [173, 216, 230],
      lightcoral: [240, 128, 128],
      lightcyan: [224, 255, 255],
      lightgoldenrodyellow: [250, 250, 210],
      lightgray: [211, 211, 211],
      lightgreen: [144, 238, 144],
      lightpink: [255, 182, 193],
      lightsalmon: [255, 160, 122],
      lightseagreen: [32, 178, 170],
      lightskyblue: [135, 206, 250],
      lightslategray: [119, 136, 153],
      lightsteelblue: [176, 196, 222],
      lightyellow: [255, 255, 224],
      lime: [0, 255, 0],
      limegreen: [50, 205, 50],
      linen: [250, 240, 230],
      magenta: [255, 0, 255],
      maroon: [128, 0, 0],
      mediumaquamarine: [102, 205, 170],
      mediumblue: [0, 0, 205],
      mediumorchid: [186, 85, 211],
      mediumpurple: [147, 112, 219],
      mediumseagreen: [60, 179, 113],
      mediumslateblue: [123, 104, 238],
      mediumspringgreen: [0, 250, 154],
      mediumturquoise: [72, 209, 204],
      mediumvioletred: [199, 21, 133],
      midnightblue: [25, 25, 112],
      mintcream: [245, 255, 250],
      mistyrose: [255, 228, 225],
      moccasin: [255, 228, 181],
      navajowhite: [255, 222, 173],
      navy: [0, 0, 128],
      oldlace: [253, 245, 230],
      olive: [128, 128, 0],
      olivedrab: [107, 142, 35],
      orange: [255, 165, 0],
      orangered: [255, 69, 0],
      orchid: [218, 112, 214],
      palegoldenrod: [238, 232, 170],
      palegreen: [152, 251, 152],
      paleturquoise: [175, 238, 238],
      palevioletred: [219, 112, 147],
      papayawhip: [255, 239, 213],
      peachpuff: [255, 218, 185],
      peru: [205, 133, 63],
      pink: [255, 192, 203],
      plum: [221, 160, 221],
      powderblue: [176, 224, 230],
      purple: [128, 0, 128],
      red: [255, 0, 0],
      rosybrown: [188, 143, 143],
      royalblue: [65, 105, 225],
      saddlebrown: [139, 69, 19],
      salmon: [250, 128, 114],
      sandybrown: [244, 164, 96],
      seagreen: [46, 139, 87],
      seashell: [255, 245, 238],
      sienna: [160, 82, 45],
      silver: [192, 192, 192],
      skyblue: [135, 206, 235],
      slateblue: [106, 90, 205],
      slategray: [112, 128, 144],
      snow: [255, 250, 250],
      springgreen: [0, 255, 127],
      steelblue: [70, 130, 180],
      tan: [210, 180, 140],
      teal: [0, 128, 128],
      thistle: [216, 191, 216],
      tomato: [255, 99, 71],
      turquoise: [64, 224, 208],
      violet: [238, 130, 238],
      wheat: [245, 222, 179],
      white: [255, 255, 255],
      whitesmoke: [245, 245, 245],
      yellow: [255, 255, 0],
      yellowgreen: [154, 205, 50],
    };

    let closestColor = "unknown";
    let minDistance = Infinity;

    for (const [name, colorRgb] of Object.entries(cssColors)) {
      const distance = Math.sqrt(
        Math.pow(rgb[0] - colorRgb[0], 2) +
          Math.pow(rgb[1] - colorRgb[1], 2) +
          Math.pow(rgb[2] - colorRgb[2], 2),
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestColor = name;
      }
    }

    return closestColor;
  }

  formatColorInfo(color, displayMode) {
    if (!displayMode || displayMode === "hidden" || displayMode === "none") {
      return "";
    }

    switch (displayMode) {
      case "hex":
        return this.rgbToHex(color);
      case "name":
      case "css": // Keep css for backward compatibility
        return this.getClosestCssColorName(color);
      default:
        return this.rgbToHex(color); // Default to hex
    }
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

  _generateColorList(textColors, options) {
    const layoutMode = this.config.list_layout || "compact";

    switch (layoutMode) {
      case "compact":
        return this._generateCompactLayout(textColors, options);
      case "chips":
        return this._generateChipsLayout(textColors, options);
      case "tiles":
        return this._generateTilesLayout(textColors, options);
      case "rows":
        return this._generateRowsLayout(textColors, options);
      case "grid":
        return this._generateGridLayout(textColors, options);
      case "cards": {
        const arrangement = this.config.card_arrangement || "hand";
        switch (arrangement) {
          case "spread":
            return this._generateSpreadLayout(textColors, options);
          case "cascade":
            return this._generateCascadeLayout(textColors, options);
          case "tilt":
            return this._generateTiltLayout(textColors, options);
          case "fan":
            return this._generateFanLayout(textColors, options);
          default:
            return this._generateCardsLayout(textColors, options);
        }
      }
      default:
        return this._generateCompactLayout(textColors, options);
    }
  }

  _generateListLayout(textColors, options) {
    const {
      allowDelete,
      fullRowColorMode,
      enableColorPicker,
      showHexInput,
      allowDragDrop,
    } = options;

    return textColors
      .map((color, idx) =>
        Array.isArray(color) &&
        color.length === 3 &&
        color.every((v) => typeof v === "number")
          ? `<div class="color-row${
              fullRowColorMode ? " full-row-color" : ""
            }" data-idx="${idx}" ${
              fullRowColorMode
                ? `style="background-color: ${this.rgbToHex(color)};" ${
                    enableColorPicker ? `data-color-row="true"` : ""
                  }`
                : ""
            }>
                <div class="color-main">
                  ${
                    enableColorPicker && !fullRowColorMode
                      ? `<input type="color" value="${this.rgbToHex(
                          color,
                        )}" data-idx="${idx}" />`
                      : ""
                  }
                  ${
                    enableColorPicker && fullRowColorMode
                      ? `<input type="color" value="${this.rgbToHex(
                          color,
                        )}" data-idx="${idx}" style="display: none;" />`
                      : ""
                  }
                  ${
                    showHexInput
                      ? `<input type="text" class="hex-input ${
                          fullRowColorMode
                            ? this.getContrastTextColor(color) === "#ffffff"
                              ? "dark-bg"
                              : "light-bg"
                            : ""
                        }" value="${this.rgbToHex(
                          color,
                        )}" data-idx="${idx}" maxlength="7" ${
                          fullRowColorMode
                            ? `style="background: rgba(255, 255, 255, 0.3); color: ${this.getContrastTextColor(
                                color,
                              )}; border-color: ${this.getContrastTextColor(
                                color,
                              )}40;"`
                            : ""
                        } />`
                      : ""
                  }
                  <span style="margin-left:8px; ${
                    fullRowColorMode
                      ? `color: ${this.getContrastTextColor(color)};`
                      : ""
                  }">${this.formatColorInfo(
                    color,
                    this.config.color_info_display || "hex",
                  )}</span>
                </div>
                <div class="color-actions">
                  ${
                    allowDelete
                      ? `<button data-action="remove" data-idx="${idx}" title="Remove" class="${this._getButtonClasses(
                          "remove",
                        )}">${(() => {
                          const contentMode =
                            this.config.buttons_style === "icon"
                              ? "icon"
                              : this.config.buttons_content_mode || "icon_text";
                          return renderButtonContent(
                            "mdi:delete",
                            "Remove",
                            contentMode,
                          );
                        })()}</button>`
                      : ""
                  }
                  ${
                    allowDragDrop
                      ? `<span class="drag-handle" data-idx="${idx}" ${
                          fullRowColorMode
                            ? `style="background: rgba(255, 255, 255, 0.3); color: ${this.getContrastTextColor(
                                color,
                              )}; border-radius: 4px; padding: 2px 4px;"`
                            : ""
                        }></span>`
                      : ""
                  }
                </div>
              </div>`
          : `<div class="color-row" data-idx="${idx}" style="color:red;">Invalid color</div>`,
      )
      .join("");
  }

  // COMPACT MODE - Minimal inline design with hover actions
  _generateCompactLayout(textColors, options) {
    const {
      enableColorPicker,
      showHexInput,
      allowDragDrop,
      allowDelete,
      removeButtonStyle = "default",
      buttonShape = "round",
      buttonInside = false,
      buttonLeft = false,
    } = options;

    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const posClass = buttonInside ? "btn-pos-inside" : "btn-pos-outside";
    const sideClass = buttonLeft ? "btn-side-left" : "";

    return textColors
      .map((color, idx) =>
        Array.isArray(color) && color.length === 3
          ? `<div class="compact-item" data-idx="${idx}" ${
              allowDragDrop !== false ? 'draggable="true"' : ""
            }>
              <div class="compact-swatch" style="background: ${this.rgbToHex(
                color,
              )};" title="Click to change color">
                ${
                  enableColorPicker
                    ? `<input type="color" value="${this.rgbToHex(
                        color,
                      )}" data-idx="${idx}" class="compact-color-input" />`
                    : ""
                }
              </div>
              <div class="compact-info">
                ${
                  showHexInput
                    ? `<input type="text" class="compact-hex-input hex-input" value="${this.rgbToHex(
                        color,
                      )}" data-idx="${idx}" maxlength="7" />`
                    : ""
                }
                <span class="compact-color-name">${this.formatColorInfo(
                  color,
                  this.config.color_info_display || "hex",
                )}</span>
              </div>
              ${
                allowDelete !== false
                  ? `<button data-action="remove" data-idx="${idx}" class="${deleteBtnClass} compact-remove ${posClass} ${sideClass}" title="Remove"></button>`
                  : ""
              }
            </div>`
          : "",
      )
      .join("");
  }

  // CHIPS MODE - Colorful tag/pill style
  _generateChipsLayout(textColors, options) {
    const {
      enableColorPicker,
      showHexInput,
      allowDragDrop,
      allowDelete,
      removeButtonStyle = "default",
      buttonShape = "round",
      buttonInside = false,
      buttonLeft = false,
    } = options;

    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const posClass = buttonInside ? "btn-pos-inside" : "btn-pos-outside";
    const sideClass = buttonLeft ? "btn-side-left" : "";

    return `<div class="chips-container">
      ${textColors
        .map((color, idx) =>
          Array.isArray(color) && color.length === 3
            ? `<div class="chip-item" data-idx="${idx}" ${
                allowDragDrop !== false ? 'draggable="true"' : ""
              } style="background: ${this.rgbToHex(
                color,
              )}; color: ${this.getContrastTextColor(color)};">
                ${
                  enableColorPicker
                    ? `<div class="chip-color-swatch" title="Click to change color">
                        <input type="color" value="${this.rgbToHex(
                          color,
                        )}" data-idx="${idx}" class="chip-color-input" />
                      </div>`
                    : ""
                }
                ${
                  showHexInput
                    ? `<input type="text" class="chip-hex-input hex-input" value="${this.rgbToHex(
                        color,
                      )}" data-idx="${idx}" maxlength="7" style="color: ${this.getContrastTextColor(
                        color,
                      )}; background: rgba(${
                        this.getContrastTextColor(color) === "#ffffff"
                          ? "255,255,255"
                          : "0,0,0"
                      }, 0.2);" />`
                    : ""
                }
                <span class="chip-content" title="Drag to reorder">
                  ${this.formatColorInfo(
                    color,
                    this.config.color_info_display || "hex",
                  )}
                </span>
                ${
                  allowDelete !== false
                    ? `<button data-action="remove" data-idx="${idx}" class="${deleteBtnClass} chip-remove ${posClass} ${sideClass}" title="Remove"></button>`
                    : ""
                }
              </div>`
            : "",
        )
        .join("")}
    </div>`;
  }

  // TILES MODE - Card-like items in vertical list
  _generateTilesLayout(textColors, options) {
    const {
      enableColorPicker,
      showHexInput,
      allowDragDrop,
      allowDelete,
      removeButtonStyle = "default",
      buttonShape = "round",
      buttonInside = false,
      buttonLeft = false,
    } = options;

    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const posClass = buttonInside ? "btn-pos-inside" : "btn-pos-outside";
    const sideClass = buttonLeft ? "btn-side-left" : "";

    return textColors
      .map((color, idx) =>
        Array.isArray(color) && color.length === 3
          ? `<div class="tile-item" data-idx="${idx}" ${
              allowDragDrop !== false ? 'draggable="true"' : ""
            }>
              ${
                allowDragDrop !== false
                  ? '<div class="tile-drag-area" title="Drag to reorder">⋮⋮</div>'
                  : ""
              }
              <div class="tile-color-preview" style="background: ${this.rgbToHex(
                color,
              )};">
                ${
                  enableColorPicker
                    ? `<input type="color" value="${this.rgbToHex(
                        color,
                      )}" data-idx="${idx}" class="tile-color-input" />`
                    : ""
                }
              </div>
              <div class="tile-info">
                ${
                  showHexInput
                    ? `<input type="text" class="tile-hex-input hex-input" value="${this.rgbToHex(
                        color,
                      )}" data-idx="${idx}" maxlength="7" />`
                    : ""
                }
                <span class="tile-color-name">${this.formatColorInfo(
                  color,
                  this.config.color_info_display || "name",
                )}</span>
              </div>
              ${
                allowDelete !== false
                  ? `<button data-action="remove" data-idx="${idx}" class="${deleteBtnClass} tile-remove ${posClass} ${sideClass}" title="Remove"></button>`
                  : ""
              }
            </div>`
          : "",
      )
      .join("");
  }

  // ROWS MODE - Full-width colored rows with gradient effects (IMPROVED VERSION)
  _generateRowsLayout(textColors, options) {
    const {
      enableColorPicker,
      showHexInput,
      allowDragDrop,
      allowDelete,
      removeButtonStyle = "default",
      buttonShape = "round",
      buttonInside = false,
      buttonLeft = false,
    } = options;

    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const posClass = buttonInside ? "btn-pos-inside" : "btn-pos-outside";
    const sideClass = buttonLeft ? "btn-side-left" : "";

    return textColors
      .map((color, idx) =>
        Array.isArray(color) && color.length === 3
          ? `<div class="row-item" data-idx="${idx}" ${
              allowDragDrop !== false ? 'draggable="true"' : ""
            } 
                style="background: linear-gradient(135deg, ${this.rgbToHex(
                  color,
                )} 0%, ${this.adjustColorBrightness(color, -20)} 100%); 
                       color: ${this.getContrastTextColor(color)};"
                data-color-row="true">
              ${
                enableColorPicker
                  ? `<input type="color" value="${this.rgbToHex(
                      color,
                    )}" data-idx="${idx}" class="row-color-input" />`
                  : ""
              }
              <div class="row-content">
                ${
                  allowDragDrop !== false
                    ? '<span class="row-drag-indicator" title="Drag to reorder">⋮⋮</span>'
                    : ""
                }
                ${
                  showHexInput
                    ? `<input type="text" class="row-hex-input hex-input" value="${this.rgbToHex(
                        color,
                      )}" data-idx="${idx}" maxlength="7" 
                      style="background: rgba(${
                        this.getContrastTextColor(color) === "#ffffff"
                          ? "255,255,255"
                          : "0,0,0"
                      }, 0.2); 
                             color: ${this.getContrastTextColor(color)}; 
                             border-color: rgba(${
                               this.getContrastTextColor(color) === "#ffffff"
                                 ? "255,255,255"
                                 : "0,0,0"
                             }, 0.3);" />`
                    : ""
                }
                <span class="row-color-name">${this.formatColorInfo(
                  color,
                  this.config.color_info_display || "name",
                )}</span>
              </div>
              ${
                allowDelete
                  ? `<button data-action="remove" data-idx="${idx}" class="${deleteBtnClass} row-remove ${posClass} ${sideClass}" title="Remove"></button>`
                  : ""
              }
            </div>`
          : "",
      )
      .join("");
  }

  _generateGridLayout(textColors, options) {
    const {
      allowDragDrop,
      removeButtonStyle = "default",
      buttonShape = "round",
      buttonInside = false,
      buttonLeft = false,
    } = options;

    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const posClass = buttonInside ? "btn-pos-inside" : "btn-pos-outside";
    const sideClass = buttonLeft ? "btn-side-left" : "";

    return textColors
      .map((color, idx) =>
        Array.isArray(color) && color.length === 3
          ? `<div class="color-grid-item" data-idx="${idx}" ${
              allowDragDrop !== false ? 'draggable="true"' : ""
            }>
              <div class="color-grid-swatch" style="background-color: ${this.rgbToHex(
                color,
              )};" title="${this.formatColorInfo(
                color,
                this.config.color_info_display || "hex",
              )}">
                ${
                  options.enableColorPicker
                    ? `<input type="color" value="${this.rgbToHex(
                        color,
                      )}" data-idx="${idx}" class="grid-color-picker" />`
                    : ""
                }
                ${
                  options.allowDelete
                    ? `<button data-action="remove" data-idx="${idx}" class="${deleteBtnClass} grid-remove-btn ${posClass} ${sideClass}" title="Remove"></button>`
                    : ""
                }
              </div>
              ${
                options.showHexInput
                  ? `<input type="text" class="hex-input grid-hex-input" value="${this.rgbToHex(
                      color,
                    )}" data-idx="${idx}" maxlength="7" />`
                  : ""
              }
              <div class="color-grid-info">${this.formatColorInfo(
                color,
                this.config.color_info_display || "hex",
              )}</div>
            </div>`
          : "",
      )
      .join("");
  }

  _generateCardsLayout(textColors, options) {
    const removeButtonStyle = options.removeButtonStyle || "default";
    const buttonShape = options.buttonShape || "round";
    const buttonInside = options.buttonInside === true;
    const buttonLeft = options.buttonLeft === true;
    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);

    // Card styling
    const buttonPositionStyles = getButtonPositionStyles(
      buttonInside,
      buttonLeft,
    );

    // Calculate cards per row based on card size
    // At 70% (default): 120px cards, 4 per row fits in ~600px
    // At 30%: 51.4px cards, can fit 9-10 per row
    // At 100%: 171.4px cards, fits 3 per row
    const cardSizePercent = this.config.card_size || 70;
    const baseCardWidth = 171.43 * (cardSizePercent / 100); // Width in px
    const estimatedContainerWidth = 600; // Approximate available width
    const cardsPerRow = Math.max(
      3,
      Math.min(10, Math.floor(estimatedContainerWidth / (baseCardWidth + 30))),
    ); // 30px for gaps/margins
    const rows = [];

    // Split into rows based on calculated cards per row
    for (let i = 0; i < textColors.length; i += cardsPerRow) {
      rows.push(textColors.slice(i, i + cardsPerRow));
    }

    return `<div class="cards-poker-container">
      ${rows
        .map((rowColors, rowIdx) => {
          const rowStartIdx = rows
            .slice(0, rowIdx)
            .reduce((sum, row) => sum + row.length, 0);
          const cardsInRow = rowColors.length;

          return `<div class="poker-hand">
            ${rowColors
              .map((color, idx) => {
                if (Array.isArray(color) && color.length === 3) {
                  const globalIdx = rowStartIdx + idx;
                  const centerIndex = (cardsInRow - 1) / 2;
                  const offset = idx - centerIndex;
                  const rotationDeg = offset * 8; // Fan angle
                  const verticalOffset = Math.abs(offset) * 10;
                  const horizontalOffset = offset * -15; // Overlap

                  return `<div class="card-wrapper poker-card" data-position="${globalIdx}">
                    <div class="card-item" data-idx="${globalIdx}" 
                      style="
                        --card-color: ${this.rgbToHex(color)};
                        transform: rotate(${rotationDeg}deg) translateY(${verticalOffset}px) translateX(${horizontalOffset}px);
                        z-index: ${idx};
                      ">
                      <div class="card-face">
                        <div class="card-color-bar${
                          options.enableColorPicker ? " clickable" : ""
                        }" style="background: ${this.rgbToHex(color)};">
                          ${
                            options.enableColorPicker
                              ? `<input type="color" value="${this.rgbToHex(
                                  color,
                                )}" data-idx="${globalIdx}" class="card-color-picker" />`
                              : ""
                          }
                        </div>
                        <div class="card-info-area">
                          ${
                            options.showHexInput
                              ? `<input type="text" class="hex-input card-hex" value="${this.rgbToHex(
                                  color,
                                )}" data-idx="${globalIdx}" maxlength="7" />`
                              : ""
                          }
                          <div class="card-name">${this.formatColorInfo(
                            color,
                            this.config.color_info_display || "hex",
                          )}</div>
                        </div>
                      </div>
                      ${
                        options.allowDelete
                          ? `<button data-action="remove" data-idx="${globalIdx}" class="${deleteBtnClass} card-remove" style="${buttonPositionStyles}" title="Remove"></button>`
                          : ""
                      }
                    </div>
                  </div>`;
                }
                return "";
              })
              .join("")}
          </div>`;
        })
        .join("")}
    </div>`;
  }

  _generateSpreadLayout(textColors, options) {
    const removeButtonStyle = options.removeButtonStyle || "default";
    const buttonShape = options.buttonShape || "round";
    const buttonInside = options.buttonInside === true;
    const buttonLeft = options.buttonLeft === true;
    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);

    // Card styling
    const buttonPositionStyles = getButtonPositionStyles(
      buttonInside,
      buttonLeft,
    );

    return `<div class="cards-container">
      ${textColors
        .map((color, globalIdx) => {
          if (Array.isArray(color) && color.length === 3) {
            // Better random rotation for spread effect using multiple hash operations
            const seed1 = (globalIdx * 2654435761) % 2147483647;
            const seed2 = (globalIdx * 1103515245 + 12345) % 2147483647;
            const seed3 = (globalIdx * 69069 + 1) % 2147483647;

            // More random rotation between -12 and +12 degrees
            const rotationDeg = (seed1 % 25) - 12;
            // More varied vertical offset
            const verticalOffset = (seed2 % 12) - 6;

            return `<div class="card-wrapper" data-position="${globalIdx}">
              <div class="card-item" data-idx="${globalIdx}" 
                style="
                  --card-color: ${this.rgbToHex(color)};
                  transform: rotate(${rotationDeg}deg) translateY(${verticalOffset}px);
                  z-index: ${globalIdx};
                ">
                <div class="card-face">
                  <div class="card-color-bar${
                    options.enableColorPicker ? " clickable" : ""
                  }" style="background: ${this.rgbToHex(color)};">
                    ${
                      options.enableColorPicker
                        ? `<input type="color" value="${this.rgbToHex(
                            color,
                          )}" data-idx="${globalIdx}" class="card-color-picker" />`
                        : ""
                    }
                  </div>
                  <div class="card-info-area">
                    ${
                      options.showHexInput
                        ? `<input type="text" class="hex-input card-hex" value="${this.rgbToHex(
                            color,
                          )}" data-idx="${globalIdx}" maxlength="7" />`
                        : ""
                    }
                    <div class="card-name">${this.formatColorInfo(
                      color,
                      this.config.color_info_display || "hex",
                    )}</div>
                  </div>
                </div>
                ${
                  options.allowDelete
                    ? `<button data-action="remove" data-idx="${globalIdx}" class="${deleteBtnClass} card-remove" style="${buttonPositionStyles}" title="Remove"></button>`
                    : ""
                }
              </div>
            </div>`;
          }
          return "";
        })
        .join("")}
    </div>`;
  }

  _generateCascadeLayout(textColors, options) {
    const removeButtonStyle = options.removeButtonStyle || "default";
    const buttonShape = options.buttonShape || "round";
    const buttonInside = options.buttonInside === true;
    const buttonLeft = options.buttonLeft === true;
    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const buttonPositionStyles = getButtonPositionStyles(
      buttonInside,
      buttonLeft,
    );

    // Cascade: overlapping diagonal waterfall. Cards overlap horizontally
    // with a uniform slight rotation, and a gentle vertical step per card.
    const tiltDeg = -3;

    return `<div class="cards-container cascade-mode">
      ${textColors
        .map((color, globalIdx) => {
          if (Array.isArray(color) && color.length === 3) {
            // Gentle vertical step: each card a bit lower, reset every ~8 cards
            const verticalOffset = (globalIdx % 8) * 4;

            return `<div class="card-wrapper" data-position="${globalIdx}">
              <div class="card-item" data-idx="${globalIdx}" 
                style="
                  --card-color: ${this.rgbToHex(color)};
                  transform: rotate(${tiltDeg}deg) translateY(${verticalOffset}px);
                  z-index: ${globalIdx};
                ">
                <div class="card-face">
                  <div class="card-color-bar${
                    options.enableColorPicker ? " clickable" : ""
                  }" style="background: ${this.rgbToHex(color)};">
                    ${
                      options.enableColorPicker
                        ? `<input type="color" value="${this.rgbToHex(color)}" data-idx="${globalIdx}" class="card-color-picker" />`
                        : ""
                    }
                  </div>
                  <div class="card-info-area">
                    ${
                      options.showHexInput
                        ? `<input type="text" class="hex-input card-hex" value="${this.rgbToHex(color)}" data-idx="${globalIdx}" maxlength="7" />`
                        : ""
                    }
                    <div class="card-name">${this.formatColorInfo(color, this.config.color_info_display || "hex")}</div>
                  </div>
                </div>
                ${
                  options.allowDelete
                    ? `<button data-action="remove" data-idx="${globalIdx}" class="${deleteBtnClass} card-remove" style="${buttonPositionStyles}" title="Remove"></button>`
                    : ""
                }
              </div>
            </div>`;
          }
          return "";
        })
        .join("")}
    </div>`;
  }

  _generateTiltLayout(textColors, options) {
    const removeButtonStyle = options.removeButtonStyle || "default";
    const buttonShape = options.buttonShape || "round";
    const buttonInside = options.buttonInside === true;
    const buttonLeft = options.buttonLeft === true;
    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const buttonPositionStyles = getButtonPositionStyles(
      buttonInside,
      buttonLeft,
    );

    // Tilt: clean grid with all cards rotated at the exact same uniform angle.
    // Looks organised like a catalog / magazine spread.
    const uniformAngle = -5;

    return `<div class="cards-container tilt-mode">
      ${textColors
        .map((color, globalIdx) => {
          if (Array.isArray(color) && color.length === 3) {
            return `<div class="card-wrapper" data-position="${globalIdx}">
              <div class="card-item" data-idx="${globalIdx}" 
                style="
                  --card-color: ${this.rgbToHex(color)};
                  transform: rotate(${uniformAngle}deg);
                  z-index: ${globalIdx};
                ">
                <div class="card-face">
                  <div class="card-color-bar${
                    options.enableColorPicker ? " clickable" : ""
                  }" style="background: ${this.rgbToHex(color)};">
                    ${
                      options.enableColorPicker
                        ? `<input type="color" value="${this.rgbToHex(color)}" data-idx="${globalIdx}" class="card-color-picker" />`
                        : ""
                    }
                  </div>
                  <div class="card-info-area">
                    ${
                      options.showHexInput
                        ? `<input type="text" class="hex-input card-hex" value="${this.rgbToHex(color)}" data-idx="${globalIdx}" maxlength="7" />`
                        : ""
                    }
                    <div class="card-name">${this.formatColorInfo(color, this.config.color_info_display || "hex")}</div>
                  </div>
                </div>
                ${
                  options.allowDelete
                    ? `<button data-action="remove" data-idx="${globalIdx}" class="${deleteBtnClass} card-remove" style="${buttonPositionStyles}" title="Remove"></button>`
                    : ""
                }
              </div>
            </div>`;
          }
          return "";
        })
        .join("")}
    </div>`;
  }

  _generateFanLayout(textColors, options) {
    const removeButtonStyle = options.removeButtonStyle || "default";
    const buttonShape = options.buttonShape || "round";
    const buttonInside = options.buttonInside === true;
    const buttonLeft = options.buttonLeft === true;
    const deleteBtnClass = getDeleteButtonClass(removeButtonStyle, buttonShape);
    const buttonPositionStyles = getButtonPositionStyles(
      buttonInside,
      buttonLeft,
    );

    // Fan: semicircular arc from a single origin point below the cards.
    // Each card is rotated around a distant pivot so they fan out evenly.
    const totalCards = textColors.filter(
      (c) => Array.isArray(c) && c.length === 3,
    ).length;
    // Spread angle range: up to ±50° for many cards, narrower for fewer
    const maxSpread = Math.min(50, totalCards * 6);

    return `<div class="cards-fan-container">
      ${textColors
        .map((color, globalIdx) => {
          if (Array.isArray(color) && color.length === 3) {
            const centerIndex = (totalCards - 1) / 2;
            const offset = globalIdx - centerIndex;
            // Distribute evenly across the arc
            const rotationDeg =
              totalCards > 1 ? (offset / centerIndex) * maxSpread : 0;

            return `<div class="card-wrapper" data-position="${globalIdx}" data-base-rotation="${rotationDeg.toFixed(1)}">
              <div class="card-item" data-idx="${globalIdx}" 
                style="
                  --card-color: ${this.rgbToHex(color)};
                  transform: rotate(${rotationDeg.toFixed(1)}deg);
                  z-index: ${globalIdx};
                ">
                <div class="card-face">
                  <div class="card-color-bar${
                    options.enableColorPicker ? " clickable" : ""
                  }" style="background: ${this.rgbToHex(color)};">
                    ${
                      options.enableColorPicker
                        ? `<input type="color" value="${this.rgbToHex(color)}" data-idx="${globalIdx}" class="card-color-picker" />`
                        : ""
                    }
                  </div>
                  <div class="card-info-area">
                    ${
                      options.showHexInput
                        ? `<input type="text" class="hex-input card-hex" value="${this.rgbToHex(color)}" data-idx="${globalIdx}" maxlength="7" />`
                        : ""
                    }
                    <div class="card-name">${this.formatColorInfo(color, this.config.color_info_display || "hex")}</div>
                  </div>
                </div>
                ${
                  options.allowDelete
                    ? `<button data-action="remove" data-idx="${globalIdx}" class="${deleteBtnClass} card-remove" style="${buttonPositionStyles}" title="Remove"></button>`
                    : ""
                }
              </div>
            </div>`;
          }
          return "";
        })
        .join("")}
    </div>`;
  }

  _updateWheelVisual(angle) {
    const selectorRadians = (angle * Math.PI) / 180;

    // Use configurable sizing like in render method
    const wheelSizePercent = this.config.wheel_size || 80;
    const wheelSize = Math.min(100, wheelSizePercent);
    const selectorRadius = (wheelSize * 40) / 100; // Scale selector radius

    const selectorX = 50 + selectorRadius * Math.cos(selectorRadians);
    const selectorY = 50 - selectorRadius * Math.sin(selectorRadians);
    const gradientAngle = -angle;

    // Update selector dot position
    const selectorDot = this.shadowRoot.querySelector(".wheel-selector");
    if (selectorDot) {
      selectorDot.setAttribute("cx", selectorX);
      selectorDot.setAttribute("cy", selectorY);
    }

    // Update gradient rotation
    const gradientGroup = this.shadowRoot.querySelector(
      'g[transform*="rotate"]',
    );
    if (gradientGroup) {
      gradientGroup.setAttribute("transform", `rotate(${gradientAngle} 50 50)`);
    }

    // Update angle display
    const angleDisplay = this.shadowRoot.querySelector(".wheel-angle");
    if (angleDisplay) {
      angleDisplay.textContent = `${Math.round(angle)}°`;
    }
  }

  _updateDefaultVisual(angle) {
    // EXACT same logic as wheel for immediate visual feedback during dragging
    const selectorRadians = (angle * Math.PI) / 180;

    // Use configurable sizing like in render method
    const defaultSizePercent = this.config.default_size || 80;
    const defaultSize = Math.min(100, defaultSizePercent);
    const selectorRadius = (defaultSize * 40) / 100; // Scale selector radius

    const selectorX = 50 + selectorRadius * Math.cos(selectorRadians);
    const selectorY = 50 - selectorRadius * Math.sin(selectorRadians);
    const gradientAngle = -angle;

    // Update selector dot position
    const selectorDot = this.shadowRoot.querySelector(".wheel-selector");
    if (selectorDot) {
      selectorDot.setAttribute("cx", selectorX);
      selectorDot.setAttribute("cy", selectorY);
    }

    // Update gradient rotation
    const gradientGroup = this.shadowRoot.querySelector(
      'g[transform*="rotate"]',
    );
    if (gradientGroup) {
      gradientGroup.setAttribute("transform", `rotate(${gradientAngle} 50 50)`);
    }

    // Update angle display
    const angleDisplay = this.shadowRoot.querySelector(".default-angle");
    if (angleDisplay) {
      angleDisplay.textContent = `${Math.round(angle)}°`;
    }
  }

  _updateRectVisual(angle) {
    // EXACT same logic as wheel for consistency
    const normalizedAngle = ((angle % 360) + 360) % 360;

    // Map angle to rectangle perimeter position
    // Rectangle has 4:1 aspect ratio, so we need to map to the perimeter
    const selectorRadians = (normalizedAngle * Math.PI) / 180;

    // Calculate position on rectangle perimeter using continuous mapping
    // For 4:1 rectangle: width = 4 units, height = 1 unit
    const rectWidth = 4;
    const rectHeight = 1;
    const perimeter = 2 * (rectWidth + rectHeight); // Total perimeter = 10 units

    // Map angle (0-360°) to perimeter position (0 to perimeter)
    const perimeterPosition = (normalizedAngle / 360) * perimeter;

    let rectSelectorX, rectSelectorY;

    // Start from right edge center, go clockwise
    if (perimeterPosition <= rectHeight / 2) {
      // Right edge, top half (0° to ~18°)
      rectSelectorX = 100;
      rectSelectorY = 50 - (perimeterPosition / (rectHeight / 2)) * 50;
    } else if (perimeterPosition <= rectHeight / 2 + rectWidth) {
      // Top edge (going from right to left)
      const topProgress = (perimeterPosition - rectHeight / 2) / rectWidth;
      rectSelectorX = 100 - topProgress * 100;
      rectSelectorY = 0;
    } else if (perimeterPosition <= rectHeight / 2 + rectWidth + rectHeight) {
      // Left edge (going from top to bottom)
      const leftProgress =
        (perimeterPosition - rectHeight / 2 - rectWidth) / rectHeight;
      rectSelectorX = 0;
      rectSelectorY = leftProgress * 100;
    } else if (
      perimeterPosition <=
      rectHeight / 2 + rectWidth + rectHeight + rectWidth
    ) {
      // Bottom edge (going from left to right)
      const bottomProgress =
        (perimeterPosition - rectHeight / 2 - rectWidth - rectHeight) /
        rectWidth;
      rectSelectorX = bottomProgress * 100;
      rectSelectorY = 100;
    } else {
      // Right edge, bottom half (back to start)
      const rightBottomProgress =
        (perimeterPosition -
          rectHeight / 2 -
          rectWidth -
          rectHeight -
          rectWidth) /
        (rectHeight / 2);
      rectSelectorX = 100;
      rectSelectorY = 100 - rightBottomProgress * 50;
    }

    // Gradient rotation EXACT same as wheel
    const gradientAngle = -normalizedAngle;

    // Update selector dot position using CSS positioning
    const rectSelectorDot = this.shadowRoot.querySelector(".rect-selector");
    if (rectSelectorDot) {
      rectSelectorDot.style.left = `${rectSelectorX}%`;
      rectSelectorDot.style.top = `${rectSelectorY}%`;
    }

    // Update gradient background using CSS - SAME rotation as wheel
    const rectElement = this.shadowRoot.querySelector(".rect-gradient");
    if (rectElement) {
      const rectTextColors = this._getCurrentTextColors();
      const colorStops = rectTextColors
        .map((color) => `rgb(${color.join(",")})`)
        .join(", ");
      rectElement.style.background = `linear-gradient(${
        90 + gradientAngle
      }deg, ${colorStops})`;
    }

    // Update angle display
    const rectAngleDisplay = this.shadowRoot.querySelector(".rect-angle");
    if (rectAngleDisplay) {
      rectAngleDisplay.textContent = `${Math.round(angle)}°`;
    }
  }

  getModeGradientColors(mode, textColors, currentAngle) {
    // Use default colors if none provided
    const colors =
      textColors && textColors.length > 0
        ? textColors
        : [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
          ];

    // Helper function to replicate Python's calculate_multi_gradient_color
    const calculateMultiGradientColor = (colors, position, totalPositions) => {
      if (!colors || colors.length === 0) return [255, 0, 0];
      if (colors.length === 1 || totalPositions <= 1) return colors[0];

      position = Math.max(0, Math.min(position, totalPositions - 1));
      const nSegments = colors.length - 1;
      const segmentLength =
        nSegments > 0 ? (totalPositions - 1) / nSegments : 1;
      const segment = Math.min(
        Math.floor(position / segmentLength),
        nSegments - 1,
      );

      const startColor = colors[segment];
      const endColor = colors[Math.min(segment + 1, colors.length - 1)];

      const localStart = segment * segmentLength;
      const localFactor =
        segmentLength > 0 ? (position - localStart) / segmentLength : 0;

      return [
        Math.round(startColor[0] + (endColor[0] - startColor[0]) * localFactor),
        Math.round(startColor[1] + (endColor[1] - startColor[1]) * localFactor),
        Math.round(startColor[2] + (endColor[2] - startColor[2]) * localFactor),
      ];
    };

    // Convert RGB array to CSS color
    const rgbToCss = (rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

    // Create mini-preview gradients that replicate the actual mode calculations
    switch (mode) {
      case "Solid Color":
        // Use first color only
        return rgbToCss(colors[0]);

      case "Letter Gradient":
        // Each letter gets a different color - show discrete steps, not smooth gradient
        if (colors.length === 1) return rgbToCss(colors[0]);
        const letterSteps = colors
          .map((color, i) => {
            const startPercent = (i / colors.length) * 100;
            const endPercent = ((i + 1) / colors.length) * 100;
            return `${rgbToCss(color)} ${startPercent}% ${endPercent}%`;
          })
          .join(", ");
        return `linear-gradient(90deg, ${letterSteps})`;

      case "Column Gradient":
        // Vertical columns get gradient - show vertical gradient
        const colGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 columns
          const color = calculateMultiGradientColor(colors, i, 10);
          colGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(90deg, ${colGradient.join(", ")})`;

      case "Row Gradient":
        // Horizontal rows get gradient - show horizontal gradient
        const rowGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 rows
          const color = calculateMultiGradientColor(colors, i, 10);
          rowGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(0deg, ${rowGradient.join(", ")})`;

      case "Angle Gradient":
        // Directional gradient based on current angle setting
        const angleDeg = currentAngle || 0;
        const angleGradient = [];
        for (let i = 0; i < colors.length; i++) {
          angleGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(${angleDeg}deg, ${angleGradient.join(", ")})`;

      case "Radial Gradient":
        // Radial from center outward
        const radialGradient = [];
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          const distance = i / (steps - 1);
          const color = calculateMultiGradientColor(
            colors,
            distance * (colors.length - 1),
            colors.length,
          );
          radialGradient.push(`${rgbToCss(color)} ${(i / (steps - 1)) * 100}%`);
        }
        return `radial-gradient(circle, ${radialGradient.join(", ")})`;

      case "Letter Vertical Gradient":
        // Vertical gradient within each letter - columns get different colors (left to right)
        const letterVertGradient = [];
        for (let i = 0; i < colors.length; i++) {
          letterVertGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(90deg, ${letterVertGradient.join(", ")})`;

      case "Letter Angle Gradient":
        // Angle gradient within each letter using current angle setting
        const letterAngleGrad = [];
        for (let i = 0; i < colors.length; i++) {
          letterAngleGrad.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        const letterAngle = currentAngle || 0;
        return `linear-gradient(${letterAngle}deg, ${letterAngleGrad.join(
          ", ",
        )})`;

      case "Text Color Sequence":
        // Random/shuffled colors - create a 5x8 grid with deterministic random colors
        if (colors.length === 1) return rgbToCss(colors[0]);

        // Create deterministic "random" based on colors array to avoid constant changes
        const colorHash = colors.map((c) => c.join(",")).join("|");
        let seed = 0;
        for (let i = 0; i < colorHash.length; i++) {
          seed = ((seed << 5) - seed + colorHash.charCodeAt(i)) & 0xffffffff;
        }

        // Simple deterministic random function
        const deterministicRandom = (index) => {
          const x = Math.sin(seed + index * 12.9898) * 43758.5453;
          return x - Math.floor(x);
        };

        // Create a 5x8 grid (40 zones) - more reasonable size
        const rows = 5;
        const cols = 8;
        const zoneWidth = 100 / cols; // Each zone width
        const zoneHeight = 100 / rows; // Each zone height

        // Generate 40 deterministic random color assignments
        const randomZones = [];
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const zoneIndex = row * cols + col;
            const randomValue = deterministicRandom(zoneIndex);
            const randomColorIndex = Math.floor(randomValue * colors.length);
            const randomColor = colors[randomColorIndex];

            const x = col * zoneWidth;
            const y = row * zoneHeight;
            const x2 = (col + 1) * zoneWidth;
            const y2 = (row + 1) * zoneHeight;

            // Create a small rectangular gradient for each zone
            randomZones.push(
              `linear-gradient(0deg, transparent ${y}%, ${rgbToCss(
                randomColor,
              )} ${y}% ${y2}%, transparent ${y2}%) ${x}% 0% / ${zoneWidth}% 100% no-repeat`,
            );
          }
        }

        // Combine all zones into one background
        return randomZones.join(", ");

      default:
        return rgbToCss(colors[0]);
    }
  }

  generateColorModeSelector(colorMode, style, textColors, currentAngle) {
    const modes = [
      { value: "Solid Color", label: "Solid" },
      { value: "Letter Gradient", label: "Letter Grad" },
      { value: "Column Gradient", label: "Column Grad" },
      { value: "Row Gradient", label: "Row Grad" },
      { value: "Angle Gradient", label: "Angle Grad" },
      { value: "Radial Gradient", label: "Radial Grad" },
      { value: "Letter Vertical Gradient", label: "Letter Vert" },
      { value: "Letter Angle Gradient", label: "Letter Angle" },
      { value: "Text Color Sequence", label: "Color Seq" },
    ];

    switch (style) {
      case "colorized":
        return `
          <div class="color-mode-colorized" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
            ${modes
              .map((mode, index) => {
                const gradientColors = this.getModeGradientColors(
                  mode.value,
                  textColors,
                  currentAngle,
                );
                return `
              <button class="mode-btn-colorized ${
                colorMode === mode.value ? "active" : ""
              }" 
                      data-mode="${mode.value}"
                      title="${mode.label}"
                      style="background: ${gradientColors}; color: white; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">
                ${mode.label}
              </button>
            `;
              })
              .join("")}
          </div>`;

      case "dropdown":
        return `
          <div class="color-mode-dropdown" style="margin-bottom: 12px;">
            <select class="mode-select" data-mode-select="true">
              ${modes
                .map(
                  (mode) => `
                <option value="${mode.value}" ${
                  colorMode === mode.value ? "selected" : ""
                }>
                  ${mode.value}
                </option>
              `,
                )
                .join("")}
            </select>
          </div>`;

      case "buttons":
      default:
        return `
          <div class="color-mode-buttons" style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px;">
            ${modes
              .map(
                (mode) => `
              <button class="mode-btn ${
                colorMode === mode.value ? "active" : ""
              }" 
                      data-mode="${mode.value}"
                      title="${mode.label}">
                ${mode.label}
              </button>
            `,
              )
              .join("")}
          </div>`;
    }
  }

  // Calculate relative luminance based on WCAG guidelines
  getRelativeLuminance(rgb) {
    const [r, g, b] = rgb.map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Determine if we should use light or dark text based on background color
  getContrastTextColor(backgroundColor) {
    const luminance = this.getRelativeLuminance(backgroundColor);
    // WCAG threshold - use dark text on light backgrounds, light text on dark backgrounds
    return luminance > 0.179 ? "#000000" : "#ffffff";
  }

  // Adjust color brightness for gradients
  adjustColorBrightness(rgb, amount) {
    return this.rgbToHex([
      Math.max(0, Math.min(255, rgb[0] + amount)),
      Math.max(0, Math.min(255, rgb[1] + amount)),
      Math.max(0, Math.min(255, rgb[2] + amount)),
    ]);
  }

  getCardSize() {
    return 4;
  }

  disconnectedCallback() {
    // Clear angle debounce timer
    clearTimeout(this._angleDebounceTimer);
    this._angleDebounceTimer = null;

    // Clean up document-level drag listeners if disconnected mid-drag
    if (this._dragCleanup) {
      document.removeEventListener(
        "mousemove",
        this._dragCleanup.handleMouseMove,
      );
      document.removeEventListener("mouseup", this._dragCleanup.handleMouseUp);
      this._dragCleanup = null;
    }

    // Remove any temp color picker inputs left on document.body
    document.querySelectorAll('input[type="color"]').forEach((input) => {
      if (
        input.style.opacity === "0" &&
        input.style.pointerEvents === "none" &&
        input.parentNode === document.body
      ) {
        document.body.removeChild(input);
      }
    });

    // Reset interaction flags
    this._renderScheduled = false;
    this._isDragging = false;
    this._draggingRotary = false;
    this._processingModeChange = false;
    this._usingColorPicker = false;
    this._usingSlider = false;
    this._editingText = false;
    this._isReordering = false;
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
  }
}

customElements.define(
  "yeelight-cube-color-list-editor-card",
  YeelightCubeColorListEditorCard,
);

if (typeof window !== "undefined") {
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "yeelight-cube-color-list-editor-card",
    name: "Yeelight Colors Card",
    description: "Edit the list of text colors for the Yeelight Cube Lite.",
    preview: true,
  });
}
