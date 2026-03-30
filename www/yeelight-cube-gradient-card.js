import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { BLACK_THRESHOLD } from "./draw_card_const.js";
import {
  renderGalleryDisplay,
  renderMatrixPreview,
  galleryDisplayStyles,
} from "./gallery-display-utils.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import { callServiceOnTargetEntities as callServiceSequentially } from "./service-call-utils.js?v=2";

// Debounce time for angle updates (ms)
let ANGLE_UPDATE_DEBOUNCE_MS = 150; // Increased for smoother slider interaction

// Fill-panel test: map column count (1-20) to Private Use Area characters
// 0 = off, 1-20 = number of columns filled (U+E001-U+E014)
const FILL_PANEL_CHARS = {
  1: "\uE001",
  2: "\uE002",
  3: "\uE003",
  4: "\uE004",
  5: "\uE005",
  6: "\uE006",
  7: "\uE007",
  8: "\uE008",
  9: "\uE009",
  10: "\uE00A",
  11: "\uE00B",
  12: "\uE00C",
  13: "\uE00D",
  14: "\uE00E",
  15: "\uE00F",
  16: "\uE010",
  17: "\uE011",
  18: "\uE012",
  19: "\uE013",
  20: "\uE014",
};
// Reverse lookup: character -> column count
const FILL_PANEL_CHAR_TO_COLS = Object.fromEntries(
  Object.entries(FILL_PANEL_CHARS).map(([k, v]) => [v, Number(k)]),
);

// localStorage key and event for gradient mode visibility
const LS_GRADIENT_MODE_VISIBILITY = "yeelight-gradient-mode-visibility";
const EVT_GRADIENT_MODE_VISIBILITY_RESET =
  "yeelight-gradient-mode-visibility-reset";

// Global preview cache that survives card recreation
if (!window._yeelightPreviewCache) {
  window._yeelightPreviewCache = {
    data: null,
    timestamp: 0,
    responseHash: null,
  };
}

/** All gradient mode names, in display/iteration order. */
const GRADIENT_MODES = [
  "Solid Color",
  "Letter Gradient",
  "Column Gradient",
  "Row Gradient",
  "Angle Gradient",
  "Radial Gradient",
  "Letter Angle Gradient",
  "Letter Vertical Gradient",
  "Text Color Sequence",
];

class YeelightCubeGradientCard extends HTMLElement {
  constructor() {
    super();
    // --- UI/interaction state ---
    this._pendingAngle = null;
    this._angleDebounceTimer = null;
    this._lastAngleSent = null;
    this._isDragging = false;
    this._draggingRotary = false;
    this._usingSlider = false;
    this._processingModeChange = false;
    this._dropdownOpen = false; // Prevent re-render when dropdown is open
    this._lastModeChangeTime = 0; // Track when mode was last changed
    this._optimisticMode = null; // Store the optimistic mode selection
    this._renderScheduled = false;
    this._previewEventListenerRegistered = false; // Track event listener for global preview cache
    this._cachedPreviewHtml = null; // Cache rendered preview HTML
    this._lastPreviewDataHash = null; // Track if preview data changed
    this._lastWheelMode = null; // Track wheel mode to prevent unnecessary syncs
    this._wheelCenterIndex = 0; // Track center item in wheel mode
    this._wheelNavigationController = null; // Controller for wheel navigation
    this._modeVisibility = this._loadModeVisibility(); // Gradient mode visibility map
    // ---
    // Listen for visibility reset from editor
    this._onVisibilityReset = () => {
      this._modeVisibility = {};
      this._lastPreviewDataHash = null; // Force re-render
      this._updatePreviewSection();
    };
    window.addEventListener(
      EVT_GRADIENT_MODE_VISIBILITY_RESET,
      this._onVisibilityReset,
    );
    // All preview data is now stored in window._yeelightPreviewCache (see top of file)
    // This ensures preview data persists across card destruction/recreation.
  }

  // --- Mode Visibility helpers ---
  _loadModeVisibility() {
    try {
      const stored = localStorage.getItem(LS_GRADIENT_MODE_VISIBILITY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  _saveModeVisibility() {
    try {
      localStorage.setItem(
        LS_GRADIENT_MODE_VISIBILITY,
        JSON.stringify(this._modeVisibility),
      );
    } catch (e) {
      console.error("[Gradient Card] Error saving mode visibility:", e);
    }
  }

  _isModeVisible(mode) {
    return this._modeVisibility[mode] !== false;
  }

  _toggleModeVisibility(mode) {
    this._modeVisibility[mode] = !this._isModeVisible(mode);
    this._saveModeVisibility();
    this._lastPreviewDataHash = null; // Force re-render

    // For wheel mode, destroy the controller so we get a full rebuild
    // (surgical update doesn't handle item count changes)
    if (this._wheelNavigationController) {
      this._wheelNavigationController.destroy();
      this._wheelNavigationController = null;
    }

    this._updatePreviewSection();
  }

  /**
   * Inject eye-icon visibility overlays on preview items when in edit mode.
   * Also sets opacity on hidden items and attaches click handlers for toggling.
   */
  _injectVisibilityOverlays(root, editMode) {
    if (!root) return;

    // Select both gallery and wheel items
    const allItems = root.querySelectorAll(
      ".gallery-item[data-mode], .wheel-item[data-mode], .wheel-compact-item[data-mode]",
    );

    allItems.forEach((item) => {
      const mode = item.dataset.mode;
      if (!mode) return;

      const isVisible = this._isModeVisible(mode);
      const isWheelItem =
        item.classList.contains("wheel-item") ||
        item.classList.contains("wheel-compact-item");

      if (editMode) {
        // For non-wheel items, set opacity directly
        // For wheel items, the wheel controller manages opacity, so use a filter instead
        if (isWheelItem) {
          item.style.filter = isVisible ? "" : "grayscale(1) brightness(0.5)";
        } else {
          item.style.opacity = isVisible ? "1" : "0.3";
        }
        item.style.position = "relative";

        // Remove any existing overlay (avoid duplicates)
        const existing = item.querySelector(".gradient-mode-visibility-toggle");
        if (existing) existing.remove();

        // Create eye overlay
        const overlay = document.createElement("div");
        overlay.className = "gradient-mode-visibility-toggle";
        overlay.title = isVisible ? "Hide this mode" : "Show this mode";
        overlay.innerHTML = "👁";

        // Wheel items have overflow:hidden, so position overlay inside the item
        // Gallery items can use the top-positioned overlay
        if (isWheelItem) {
          overlay.style.cssText = `
            position: absolute;
            top: 4px;
            right: 4px;
            font-size: 16px;
            color: ${isVisible ? "#0077cc" : "#ccc"};
            cursor: pointer;
            z-index: 100;
            user-select: none;
            background: ${isVisible ? "rgba(0, 119, 204, 0.15)" : "rgba(200, 200, 200, 0.3)"};
            border-radius: 4px;
            padding: 4px;
            border: 2px solid ${isVisible ? "rgba(0, 119, 204, 0.4)" : "rgba(200, 200, 200, 0.5)"};
            line-height: 1;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
          `;
        } else {
          overlay.style.cssText = `
            position: absolute;
            top: -8px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 16px;
            color: ${isVisible ? "#0077cc" : "#ccc"};
            cursor: pointer;
            z-index: 10;
            user-select: none;
            background: ${isVisible ? "rgba(0, 119, 204, 0.1)" : "rgba(200, 200, 200, 0.2)"};
            border-radius: 4px;
            padding: 4px;
            border: 2px solid ${isVisible ? "rgba(0, 119, 204, 0.3)" : "rgba(200, 200, 200, 0.4)"};
            line-height: 1;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
          `;
        }

        overlay.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._toggleModeVisibility(mode);
        });

        // For wheel items, also stop mousedown/touchstart propagation
        // so the wheel's drag handlers don't intercept the click
        if (isWheelItem) {
          overlay.addEventListener("mousedown", (e) => {
            e.stopPropagation();
          });
          overlay.addEventListener(
            "touchstart",
            (e) => {
              e.stopPropagation();
            },
            { passive: true },
          );
        }

        item.insertBefore(overlay, item.firstChild);
      } else {
        // Normal mode: ensure no leftover overlays and reset opacity/filter
        const existing = item.querySelector(".gradient-mode-visibility-toggle");
        if (existing) existing.remove();
        item.style.opacity = "";
        item.style.filter = "";
      }
    });
  }

  // Helper method to call services on target entities.
  // Delegates to the shared utility.  The Python backend holds per-IP locks,
  // so different lamps execute in parallel.
  async callServiceOnTargetEntities(serviceName, serviceData = {}) {
    return callServiceSequentially(
      this._hass,
      this.config,
      serviceName,
      serviceData,
      { callerTag: "Gradient Card" },
    );
  }

  connectedCallback() {
    // Re-register visibility reset listener (removed in disconnectedCallback)
    if (this._onVisibilityReset) {
      window.addEventListener(
        EVT_GRADIENT_MODE_VISIBILITY_RESET,
        this._onVisibilityReset,
      );
    }

    // After reconnection, the wheel controller was destroyed in disconnectedCallback.
    // We must re-initialize it once the DOM is ready again.
    if (
      this._getDisplayMode?.() === "wheel" &&
      !this._wheelNavigationController
    ) {
      // Reset _lastWheelMode so that the next set hass() triggers a sync
      this._lastWheelMode = null;
      // Defer re-init until the preview element is re-attached in the next render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this._wheelNavigationController && this._previewElement) {
            this._setupWheelNavigation();
          }
        });
      });
    }
  }

  disconnectedCallback() {
    // Clean up wheel navigation controller
    if (this._wheelNavigationController) {
      this._wheelNavigationController.destroy();
      this._wheelNavigationController = null;
    }
    // Clean up visibility reset listener
    if (this._onVisibilityReset) {
      window.removeEventListener(
        EVT_GRADIENT_MODE_VISIBILITY_RESET,
        this._onVisibilityReset,
      );
    }
  }

  setConfig(config) {
    // hasEntity: !!config.entity,
    // targetEntitiesCount: config.target_entities?.length || 0,
    // shadowRootExists: !!this.shadowRoot,
    // hadPreviousConfig: !!this.config,
    // previewElementExists: !!this._previewElement,
    // timestamp: Date.now(),
    // });

    // Check if wheel-affecting settings changed
    // Skip change detection on first init — this.config is undefined so every
    // comparison fires as "changed", causing a wasteful teardown/rebuild cycle
    // that races with preview loading and leaves a no-op wheel controller.
    const wheelModeChanged = this.config
      ? this.config.preview_display_mode !== config?.preview_display_mode ||
        this.config.wheel_nav_position !== config?.wheel_nav_position ||
        this.config.preview_show_titles !== config?.preview_show_titles ||
        this.config.wheel_height !== config?.wheel_height
      : false;

    if (wheelModeChanged) {
      // Clean up previous wheel controller when config changes
      if (this._wheelNavigationController) {
        this._wheelNavigationController.destroy();
        this._wheelNavigationController = null;
      }
      // Force full DOM rebuild by invalidating cached preview HTML
      this._lastPreviewDataHash = null;
      this._cachedPreviewHtml = null;
      // Reset the persistent preview element so it gets recreated with new structure
      if (this._previewElement) {
        this._previewElement = null;
      }
    }

    this.config = config;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    // Always render when setConfig is called (config changed in editor)
    // But we'll preserve the preview element across renders
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.render();
      });
    }
  }

  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-gradient-card-editor")) {
      await import("./yeelight-cube-gradient-card-editor.js");
    }
    return document.createElement("yeelight-cube-gradient-card-editor");
  }
  static getStubConfig(hass) {
    const entity =
      Object.keys(hass?.states || {}).find(
        (e) =>
          e.startsWith("light.yeelight_cube") ||
          e.startsWith("light.cubelite_"),
      ) || "";
    return { type: "custom:yeelight-cube-gradient-card", entity };
  }

  set hass(hass) {
    this._hass = hass;

    // Track entity state changes to auto-reload previews (debounced)
    // Only reload if text, angle, or colors changed
    const entityId = this._getPrimaryEntity();
    if (hass && entityId) {
      const stateObj = hass.states[entityId];
      const currentText = stateObj?.attributes?.custom_text;
      const currentAngle = stateObj?.attributes?.angle;
      const currentColors = stateObj?.attributes?.text_colors;
      const colorsHash = currentColors ? JSON.stringify(currentColors) : null;
      if (
        this._lastPreviewText !== currentText ||
        this._lastPreviewAngle !== currentAngle ||
        this._lastPreviewColors !== colorsHash
      ) {
        this._lastPreviewText = currentText;
        this._lastPreviewAngle = currentAngle;
        this._lastPreviewColors = colorsHash;
        // Debounce preview reload to avoid flickering on rapid updates
        if (this._previewReloadTimer) clearTimeout(this._previewReloadTimer);
        this._previewReloadTimer = setTimeout(() => {
          // "[Gradient Card] Text, angle, or colors changed, reloading previews..."
          // );
          this._loadPreviews().catch((err) =>
            console.error("[Gradient Card] Error reloading previews:", err),
          );
        }, 500);
      }
    }

    // Check if we recently changed mode (within last 2 seconds)
    const timeSinceLastModeChange = Date.now() - this._lastModeChangeTime;
    const ignoreUpdateWindow = 2000; // Ignore sensor updates for 2 seconds after mode change

    // Skip if config not set yet (hass can be set before config)
    if (!this.config || !this.config.entity) {
      return;
    }

    // Check if the entities we care about actually changed
    const entity = this._hass.states[this.config.entity];
    const oldEntity = this._previousHass
      ? this._previousHass.states[this.config.entity]
      : null;

    // Only render if our entity changed or this is the first hass update
    const entityChanged =
      !oldEntity || entity !== oldEntity || entity.state !== oldEntity.state;

    // --- Optimistic Panel Mode: clear only when backend matches ---
    if (this._optimisticPanelMode !== undefined && entity) {
      const backendPanelMode = entity.attributes.panel_mode || false;
      if (backendPanelMode === this._optimisticPanelMode) {
        this._optimisticPanelMode = undefined;
      }
    }

    // --- Optimistic Fill Panel Cols: clear when backend custom_text matches ---
    if (this._optimisticFillCols !== undefined && entity) {
      const backendText = entity.attributes.custom_text || "";
      const backendCols = FILL_PANEL_CHAR_TO_COLS[backendText] || 0;
      if (backendCols === this._optimisticFillCols) {
        this._optimisticFillCols = undefined;
      }
    }

    // Store current hass for next comparison
    this._previousHass = this._hass;

    // Re-initialize wheel center ONLY if mode attribute actually changed
    if (this._getDisplayMode() === "wheel" && entity) {
      const currentMode = entity.attributes?.mode;

      // Only sync if:
      // 1. Mode actually changed from last known value
      // 2. Not in optimistic mode (we're already showing the right mode)
      // 3. First initialization (no last mode tracked)
      const modeChanged = this._lastWheelMode !== currentMode;
      const isFirstInit = this._lastWheelMode === null;

      if (modeChanged && !this._optimisticMode) {
        this._lastWheelMode = currentMode;
        setTimeout(
          () => {
            this._syncWheelToCurrentMode();
            this._markActiveMode();
          },
          isFirstInit ? 100 : 0,
        );
      } else if (modeChanged && this._optimisticMode) {
        // Mode changed but we're in optimistic mode - still sync wheel position
        // (e.g. mode changed via color-mode selector buttons, not the wheel itself)
        this._lastWheelMode = currentMode;
        setTimeout(() => {
          this._syncWheelToCurrentMode();
          this._markActiveMode();
        }, 0);
      } else if (!modeChanged) {
        // Mode didn't change - this is just a color/angle/sensor update
        // DO NOT sync wheel - this prevents the blink you're seeing
        // `[Wheel Sync] Sensor update detected but mode unchanged ('${currentMode}'), skipping wheel sync`
        // );
      }
    }

    // For non-wheel display modes: detect external mode changes and update highlight
    if (this._getDisplayMode() !== "wheel" && entity && oldEntity) {
      const currentMode = entity.attributes?.mode;
      const prevMode = oldEntity.attributes?.mode;
      if (prevMode !== currentMode) {
        this._markActiveMode();
      }
    }

    // Skip render if entity didn't change
    if (!entityChanged) {
      return;
    }

    // Always allow render for button updates unless:
    // 1. Actively dragging rotary controls or angle slider
    // 2. Dropdown is open
    // 3. Recently changed mode (prevent sensor updates from overriding optimistic UI)
    if (
      !this._draggingRotary &&
      !this._isDragging &&
      !this._usingSlider &&
      !this._dropdownOpen &&
      timeSinceLastModeChange > ignoreUpdateWindow
    ) {
      if (!this._renderScheduled) {
        this._renderScheduled = true;
        requestAnimationFrame(() => {
          this._renderScheduled = false;
          this.render();
        });
      }
    }
  }

  render() {
    // Only block render if actively dragging/interacting with angle controls to prevent interference
    if (this._draggingRotary || this._isDragging || this._usingSlider) return;

    const hass = this._hass;
    if (!hass) return;

    // Support both old single entity config and new multi-entity config
    const primaryEntity = this._getPrimaryEntity();
    const stateObj = primaryEntity ? hass.states[primaryEntity] : null;

    if (!primaryEntity || !stateObj) {
      const entityCount = (this.config.target_entities || []).length;
      const message =
        entityCount === 0
          ? "No entities configured"
          : `Primary entity (${String(primaryEntity)}) not found`;
      this.shadowRoot.innerHTML = `<ha-card><div style="padding: 16px;">${message}</div></ha-card>`;
      return;
    }
    let textColors = this._pendingColors ||
      stateObj.attributes.text_colors || [[255, 255, 255]];

    // Get current angle from entity
    const currentAngle = stateObj.attributes.angle ?? 0;

    const showCard = this.config.show_card_background !== false;
    const showColorModeSelector =
      this.config.show_color_mode_selector !== false;
    const showAngleSection = this.config.show_angle_section !== false;

    // Individual angle control visibility
    const showAngleInput = this.config.show_angle_input !== false;
    const showAngleSlider = this.config.show_angle_slider !== false;
    const showAngleRotary = this.config.show_angle_rotary !== false;

    const cardTitle =
      typeof this.config.title === "string" && this.config.title.trim()
        ? this.config.title
        : null;

    // Get current lamp state for runtime controls
    const currentMode = this._getCurrentMode() || "Solid Color";
    // Use optimistic panel mode if set, else backend state
    const applyToWholePanel =
      this._optimisticPanelMode !== undefined
        ? this._optimisticPanelMode
        : stateObj.attributes.panel_mode || false;
    // Fill panel column selector: detect active column count from custom_text
    const currentCustomText = stateObj.attributes.custom_text || "";
    const fillPanelCols =
      this._optimisticFillCols !== undefined
        ? this._optimisticFillCols
        : FILL_PANEL_CHAR_TO_COLS[currentCustomText] || 0;
    const colorMode = currentMode;

    // Get color mode selector style from config
    const colorModeStyle = this.config.color_mode_style || "buttons";

    // Get panel toggle style from config
    const panelToggleStyle = this.config.panel_toggle_style || "default";

    // Check if rotary should be in header
    const rotaryInHeader = this.config.rotary_in_header === true;

    const cardContent = `
      <div style="padding:16px;">
        ${
          cardTitle || rotaryInHeader
            ? `
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            ${
              cardTitle
                ? `<div class="card-title">${cardTitle}</div>`
                : "<div></div>"
            }
            ${
              rotaryInHeader && showAngleSection && showAngleRotary
                ? `<div class="header-rotary">${this._renderAngleRotary(
                    currentAngle,
                    true,
                  )}</div>`
                : ""
            }
          </div>
        `
            : ""
        }
        
        ${
          showColorModeSelector
            ? `
        <!-- Runtime Controls -->
        <div class="runtime-controls" style="margin-bottom: 16px;">
          <div class="control-section">
            ${this.generateColorModeSelector(
              colorMode,
              colorModeStyle,
              textColors,
              this._draggingRotary && this._pendingAngle !== undefined
                ? this._pendingAngle
                : currentAngle,
            )}
            ${this._renderPanelToggle(applyToWholePanel, panelToggleStyle)}
            <div class="panel-toggle default" style="margin-top: 4px; display: none; align-items: center; gap: 8px;">
              <label for="fill-panel-cols" style="white-space: nowrap;">Fill Panel Test:</label>
              <select id="fill-panel-cols" style="flex: 1; padding: 4px;">
                <option value="0" ${fillPanelCols === 0 ? "selected" : ""}>Off</option>
                ${Array.from({ length: 20 }, (_, i) => i + 1)
                  .map(
                    (n) =>
                      `<option value="${n}" ${fillPanelCols === n ? "selected" : ""}>${n} col${n > 1 ? "s" : ""} (${n * 5} px)</option>`,
                  )
                  .join("")}
              </select>
            </div>
          </div>
        </div>
        `
            : ""
        }
        
        ${
          showAngleSection
            ? `
        <div class="angle-section ${
          showColorModeSelector ? "" : "no-color-selector"
        }">
          <div class="angle-row">
            ${
              showAngleInput
                ? `
              <span>Angle:</span>
              <input id="angleinput" class="angle-input" type="number" min="0" max="359" step="1" value="${Math.round(
                currentAngle,
              )}" />
              <span>°</span>
            `
                : ""
            }
            ${
              showAngleSlider
                ? `
              <input id="angleslider" class="angle-slider" type="range" min="0" max="359" step="1" value="${Math.round(
                currentAngle,
              )}" />
            `
                : ""
            }
            ${
              showAngleRotary && !rotaryInHeader
                ? this._renderAngleRotary(currentAngle)
                : ""
            }
          </div>
        </div>
        `
            : ""
        }
      </div>
    `;

    // "[Gradient Card] Setting shadowRoot.innerHTML - THIS REPLACES ALL DOM",
    // {
    // previewSectionInitialized: this._previewSectionInitialized,
    // timestamp: Date.now(),
    // }
    // );

    // NOTE: Do NOT destroy the wheel navigation controller here.
    // The wheel DOM lives inside _previewElement, which persists across
    // render() calls (it's detached and re-appended, not rebuilt).
    // Destroying the controller would remove event listeners from the
    // surviving wheel DOM, making it permanently unresponsive.

    this.shadowRoot.innerHTML = `
      <style>
        .card-title {
          font-size: 1.3em;
          font-weight: bold;
          margin-bottom: 18px;
          margin-top: 2px;
          color: #222;
        }
        
        /* Header rotary styling - sized for 88px height */
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
          max-width: 88px !important;
          max-height: 88px !important;
          width: 88px !important;
          height: 88px !important;
        }
        
        .header-rotary .color-rect {
          /* Remove fixed sizing - let inline styles handle dynamic sizing */
          aspect-ratio: auto !important;
        }
        
        /* Force shapes to fill container in header mode */
        .header-rotary svg circle,
        .header-rotary svg rect,
        .header-rotary svg polygon,
        .header-rotary svg path {
          transform-origin: center;
        }
        
        /* Override percentage-based sizing in header mode */
        .header-rotary .color-wheel,
        .header-rotary #angle-preview {
          width: 88px !important;
          height: 88px !important;
        }
        
        .card-content {
          max-width: 480px;
          margin: 0 auto;
        }
        .color-row {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          background: #fafbfc;
          border: 1.5px solid #d0d7de;
          border-radius: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          padding: 6px 12px;
          transition: box-shadow 0.2s, transform 0.2s cubic-bezier(.4,2,.6,1), background 0.2s;
          position: relative;
          width: 100%;
          box-sizing: border-box;
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
        }
        
        .color-row.full-row-color .hex-input:focus {
          background: rgba(255, 255, 255, 0.5) !important;
          border-color: rgba(255, 255, 255, 0.7) !important;
          outline: none;
          border: 0 !important;
        }
        .color-main {
          display: flex;
          align-items: center;
          flex: 1 1 auto;
          min-width: 0;
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
          border: 1px solid #ccc;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 1em;
          font-family: inherit;
          background: #fff;
          color: #222;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          transition: border 0.2s, box-shadow 0.2s;
        }
        .color-row input[type="text"].hex-input:focus {
          border: 1.5px solid transparent !important;
          outline: none;
          box-shadow: 2px 2px 2px 2px transparent;
        }
        .remove-btn { background: #ffeaea; border: none; border-radius: 6px; color: #b00; padding: 6px 18px; cursor: pointer; font-size: 1em; font-weight: 500; margin-left: 0; transition: background 0.2s; }
        .remove-btn:hover { background: #ffd6d6; }
        
        /* Red cross style remove button */
        .color-btn-cross.remove-btn-cross {
          position: absolute;
          top: 8px;
          right: 8px;
          background: none;
          border: none;
          color: #b00;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s ease;
          min-width: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: bold;
          z-index: 2;
        }
        
        .color-btn-cross.remove-btn-cross:hover {
          background: rgba(187, 0, 0, 0.1);
          color: #d32f2f;
          transform: scale(1.1);
        }
        
        /* Make color-row relative for absolute positioning of cross */
        .color-row {
          position: relative;
        }
        
        /* Add padding when cross button is present */
        .color-row.has-cross {
          padding-right: 40px;
        }
        .drag-handle { margin-left: 0; cursor: grab; font-size: 1.5em; color: #888; user-select: none; }
        .drag-handle::after { content: "\\2630"; }
        
        /* Drag handle styles for Full Row Color Mode */
        .color-row.full-row-color .drag-handle {
          transition: background 0.2s ease;
        }
        
        .color-row.full-row-color .drag-handle:hover {
          background: rgba(255, 255, 255, 0.5) !important;
        }
        #color-list { position: relative; }
        .action-row {
          display: flex;
          gap: 16px;
          margin-top: 16px;
          justify-content: stretch;
          width: 100%;
        }
        .add-btn {
          background: #d4edda;
          border: none;
          border-radius: 8px;
          color: #218838;
          padding: 10px 0;
          cursor: pointer;
          font-size: 1em;
          font-weight: 500;
          flex: 1 1 0;
          transition: background 0.2s;
          width: 100%;
        }
        .add-btn:hover { background: #b3e6c3; }
        .save-btn {
          background: #e6f7ff;
          border: none;
          border-radius: 8px;
          color: #0077cc;
          padding: 10px 0;
          cursor: pointer;
          font-size: 1em;
          font-weight: 500;
          flex: 1 1 0;
          transition: background 0.2s;
          width: 100%;
        }
        .save-btn:hover { background: #b3e6ff; }
        
        /* Angle section styles */
        .angle-section {
          margin-top: 16px;
          /* padding-top: 16px; */
        }

        .angle-section.no-color-selector {
          margin-top: 0;
        }

        .angle-title {
          font-size: 1.1em;
          font-weight: 600;
          margin-bottom: 12px;
          color: #333;
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
          background: #e0e0e0;
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
          background: #1976d2;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          border: none;
          transition: all 0.2s ease;
        }
        .angle-slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #1976d2;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          border: none;
          transition: all 0.2s ease;
        }
        .angle-input {
          width: 60px;
          border: 1px solid #ccc;
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

        /* Runtime Controls */
        .runtime-controls {
          margin-bottom: 16px;
        }

        /* Panel Toggle Styles */
        .panel-toggle {
          margin-top: 12px;
        }
        
        /* Default style - simple checkbox */
        .panel-toggle.default {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .panel-toggle.default input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        .panel-toggle.default label {
          font-weight: 500;
          cursor: pointer;
        }

        /* Toggle Switch style */
        .panel-toggle.switch {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .panel-toggle.switch .switch-container {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .panel-toggle.switch input[type="checkbox"] {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .panel-toggle.switch .switch-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: 0.3s;
          border-radius: 24px;
        }
        .panel-toggle.switch .switch-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        .panel-toggle.switch input:checked + .switch-slider {
          background-color: #2196F3;
        }
        .panel-toggle.switch input:checked + .switch-slider:before {
          transform: translateX(20px);
        }
        .panel-toggle.switch label {
          font-weight: 500;
          cursor: pointer;
        }

        /* Card style - button-like appearance */
        .panel-toggle.card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border: 2px solid #e1e4e8;
          border-radius: 8px;
          background: #f6f8fa;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .panel-toggle.card:hover {
          border-color: #0969da;
          background: #f1f3f4;
        }
        .panel-toggle.card.active {
          border-color: #0969da;
          background: #dbeafe;
        }
        .panel-toggle.card input[type="checkbox"] {
          display: none;
        }
        .panel-toggle.card label {
          font-weight: 500;
          cursor: pointer;
          margin: 0;
        }
        .panel-toggle.card .card-indicator {
          width: 20px;
          height: 20px;
          border: 2px solid #6b7280;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        .panel-toggle.card.active .card-indicator {
          background: #0969da;
          border-color: #0969da;
          color: white;
        }
        .panel-toggle.card .card-indicator::after {
          content: "✓";
          font-size: 12px;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .panel-toggle.card.active .card-indicator::after {
          opacity: 1;
        }

        /* Scroll Controls */
        .scroll-info {
          font-family: monospace;
          color: #656d76;
        }
        
        .scroll-controls input[type="range"] {
          height: 4px;
          background: #d0d7de;
          border-radius: 2px;
          outline: none;
        }
        
        .scroll-controls input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #0969da;
          cursor: pointer;
        }
        
        .control-button {
          padding: 4px 8px;
          border: 1px solid #d0d7de;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85em;
          transition: all 0.2s ease;
        }
        
        .control-button:hover {
          background: #f6f8fa;
        }

        .mode-btn {
          padding: 6px 10px;
          border: 1px solid #d0d7de;
          background: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85em;
          transition: all 0.2s ease;
          min-width: 60px;
        }

        .mode-btn:hover {
          background: #f6f8fa;
        }

        .mode-btn.active {
          background: #0969da;
          color: white;
          border-color: #0969da;
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
          border-color: white;
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

        /* Compact style - smaller, tight grid */
        .mode-btn-compact {
          padding: 4px 6px;
          border: 1px solid #d0d7de;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.75em;
          transition: all 0.15s ease;
          text-align: center;
        }

        .mode-btn-compact:hover {
          background: #f6f8fa;
          border-color: #0969da;
        }

        .mode-btn-compact.active {
          background: #0969da;
          color: white;
          border-color: #0969da;
          font-weight: 600;
        }

        /* Pills style - rounded, modern look */
        .mode-btn-pill {
          padding: 6px 14px;
          border: none;
          background: #e7ecf0;
          border-radius: 20px;
          cursor: pointer;
          font-size: 0.85em;
          font-weight: 500;
          transition: all 0.25s ease;
          color: #24292f;
        }

        .mode-btn-pill:hover {
          background: #d0d7de;
          transform: scale(1.05);
        }

        .mode-btn-pill.active {
          background: linear-gradient(135deg, #0969da 0%, #0550ae 100%);
          color: white;
          box-shadow: 0 2px 8px rgba(9, 105, 218, 0.3);
          transform: scale(1.05);
        }

        /* Dropdown style */
        .mode-select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          background: white;
          font-size: 0.9em;
          cursor: pointer;
        }

        .mode-select:focus {
          outline: none;
          border-color: #0969da;
          box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
        }

        .panel-toggle input[type="checkbox"] {
          margin: 0;
        }

        .panel-toggle label {
          margin: 0;
          cursor: pointer;
        }

        /* Preview section styles */
        .preview-toggle-btn {
          width: 100%;
          padding: 10px 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }

        .preview-toggle-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .preview-toggle-btn:active {
          transform: translateY(0);
        }

        .preview-item {
          border: 2px solid transparent;
        }

        .preview-item:hover {
          border-color: rgba(102, 126, 234, 0.5);
        }

        .preview-title {
          color: #fff;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        /* Gallery display styles from shared utility */
        ${galleryDisplayStyles}

        .gallery-item[data-mode]:hover {
          border-color: rgba(102, 126, 234, 0.5);
        }

        /* Wheel navigation button styles */
        .wheel-nav-down:hover,
        .wheel-nav-up:hover {
          background: white !important;
          box-shadow: 0 6px 16px rgba(0,0,0,0.2) !important;
          color: #000 !important;
        }

      </style>
      ${
        showCard
          ? `<ha-card><div class="card-content">${cardContent}</div></ha-card>`
          : `<div class="card-content">${cardContent}</div>`
      }
    `;

    // Create/append persistent preview section OUTSIDE the innerHTML
    if (!this._previewElement) {
      // "[Gradient Card] Creating persistent preview element for first time",
      // { displayMode: this.config?.preview_display_mode }
      // );
      this._previewElement = document.createElement("div");
      this._previewElement.style.cssText =
        "padding: 16px; padding-top: 0; margin-top: 20px;";

      const initialHTML = this._renderPreviewSection();
      // htmlLength: initialHTML.length,
      // containsWheelDisplay: initialHTML.includes('class="wheel-display"'),
      // containsWheelItem: initialHTML.includes('class="wheel-item"'),
      // });

      this._previewElement.innerHTML = `
        <div id="preview-section-container">${initialHTML}</div>
      `;
      // No need to track _previewSectionInitialized anymore

      // Setup event listener and load previews
      setTimeout(() => {
        if (!this._previewEventListenerRegistered) {
          this._setupPreviewEventListener();
        }
        // Only load previews if we don't have recent data in global cache
        const cache = window._yeelightPreviewCache;
        const timeSinceLastRequest = Date.now() - cache.timestamp;
        const hasRecentData = cache.data && timeSinceLastRequest < 5000; // 5 seconds

        if (!hasRecentData) {
          // hasCache: !!cache.data,
          // timeSince: timeSinceLastRequest,
          // });
          this._loadPreviews();
        } else {
          // "[Gradient Card] Using cached preview data from global cache",
          // {
          // timeSinceLastRequest,
          // hasData: !!cache.data,
          // displayMode: this.config?.preview_display_mode,
          // }
          // );
          // Immediately render with cached data
          // "[Gradient Card] About to call _updatePreviewSection with cached data"
          // );
          this._updatePreviewSection();
        }
      }, 100);
    }

    // Always append the persistent preview element after innerHTML replacement
    const cardContentDiv = this.shadowRoot.querySelector(".card-content");
    // cardContentDivFound: !!cardContentDiv,
    // previewElementExists: !!this._previewElement,
    // previewElementParent: this._previewElement?.parentElement?.tagName,
    // });

    if (cardContentDiv && this._previewElement) {
      // Remove from old parent if it exists
      if (this._previewElement.parentElement) {
        this._previewElement.parentElement.removeChild(this._previewElement);
      }
      cardContentDiv.appendChild(this._previewElement);

      // Safety net: after re-appending preview element, ensure wheel controller
      // is alive if we're in wheel display mode (fixes disconnect/reconnect)
      if (
        this._getDisplayMode() === "wheel" &&
        !this._wheelNavigationController
      ) {
        const wheelExists = this._previewElement.querySelector(
          ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
        );
        if (wheelExists) {
          requestAnimationFrame(() => {
            if (!this._wheelNavigationController) {
              this._setupWheelNavigation();
            }
          });
        }
      }
    } else {
      console.warn("[Gradient Card] Failed to append preview element", {
        reason: !cardContentDiv
          ? "cardContentDiv not found"
          : "previewElement not created",
      });
    }

    this.addEventListeners();

    // Update active-mode highlight on the persistent preview element
    this._markActiveMode();

    setTimeout(() => {
      const root = this.shadowRoot;
      if (!root) return;
      root.querySelectorAll("input.hex-input").forEach((input) => {
        const idx = parseInt(input.dataset.idx);
        if (Array.isArray(textColors[idx])) {
          const hex = this._rgbToHex(textColors[idx]);
          if (input.value !== hex) input.value = hex;
        }
      });

      // Initialize angle preview if angle section is shown
      if (showAngleSection) {
        this._updateRotaryDisplay(currentAngle);
        this._bindAngleEvents();
      }
    }, 0);
  }

  addEventListeners() {
    const root = this.shadowRoot;
    if (!root) return;

    // Runtime Controls - Color Mode selectors (all styles)
    const modeSelectors = [
      ...root.querySelectorAll(".mode-btn"),
      ...root.querySelectorAll(".mode-btn-colorized"),
      ...root.querySelectorAll(".mode-btn-compact"),
      ...root.querySelectorAll(".mode-btn-pill"),
    ];

    modeSelectors.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        // Use currentTarget to get the button, not the clicked child element
        const mode = e.currentTarget.dataset.mode;
        if (!this._hass || !this.config.entity || this._processingModeChange)
          return;

        // OPTIMISTIC UI UPDATE - immediately show selection
        modeSelectors.forEach((button) => {
          button.classList.remove("active");
        });
        e.currentTarget.classList.add("active");

        // Disable all mode selectors during processing (but keep visual feedback)
        modeSelectors.forEach((button) => {
          button.style.pointerEvents = "none";
          if (!button.classList.contains("active")) {
            button.style.opacity = "0.6";
          }
        });

        // Also disable dropdown if present
        const dropdown = root.querySelector(".mode-select");
        if (dropdown) {
          dropdown.style.pointerEvents = "none";
          dropdown.style.opacity = "0.6";
        }

        this._selectMode(mode).finally(() => {
          // Re-enable all mode selectors
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
        });
      });
    });

    // Runtime Controls - Dropdown selector
    const modeDropdown = root.querySelector(".mode-select");
    if (modeDropdown) {
      // Prevent re-render when dropdown is open
      modeDropdown.addEventListener("focus", () => {
        this._dropdownOpen = true;
      });

      modeDropdown.addEventListener("blur", () => {
        this._dropdownOpen = false;
      });

      modeDropdown.addEventListener("change", (e) => {
        this._dropdownOpen = false; // Close flag when selection made
        const mode = e.target.value;
        if (!this._hass || this._processingModeChange) return;

        if (!this._getPrimaryEntity()) return;

        // Disable dropdown during processing, re-enable after
        modeDropdown.style.pointerEvents = "none";
        modeDropdown.style.opacity = "0.6";

        this._selectMode(mode).finally(() => {
          modeDropdown.style.pointerEvents = "";
          modeDropdown.style.opacity = "";
        });
      });
    }

    // Runtime Controls - Apply to Whole Panel checkbox
    const panelCheckbox = root.getElementById("apply-to-panel");
    if (panelCheckbox) {
      panelCheckbox.addEventListener("change", (e) => {
        if (!this._hass || !this._getPrimaryEntity()) return;
        const applyToPanel = e.target.checked;

        // Optimistically update UI (show new value immediately)
        this._optimisticPanelMode = applyToPanel;
        // Safety timeout: clear optimistic state if backend doesn't confirm within 5s
        if (this._panelModeTimeout) clearTimeout(this._panelModeTimeout);
        this._panelModeTimeout = setTimeout(() => {
          if (this._optimisticPanelMode !== undefined) {
            this._optimisticPanelMode = undefined;
            this.render();
          }
        }, 5000);
        this.render();

        // Disable checkbox while updating
        panelCheckbox.disabled = true;

        this.callServiceOnTargetEntities("set_panel_mode", {
          panel_mode: applyToPanel,
        })
          .then(() => {
            // Re-enable checkbox, but do NOT clear optimistic state here
            panelCheckbox.disabled = false;
            this.render();
          })
          .catch(() => {
            // On error, revert optimistic state
            this._optimisticPanelMode = undefined;
            panelCheckbox.disabled = false;
            this.render();
          });
      });
    }

    // --- Fill Panel Column Selector ---
    const fillPanelSel = root.getElementById("fill-panel-cols");
    if (fillPanelSel) {
      fillPanelSel.addEventListener("change", (e) => {
        if (!this._hass || !this._getPrimaryEntity()) return;
        // Guard: ignore rapid change events while a service call is in flight.
        // The select can't be reliably disabled via the DOM reference because
        // render() rebuilds the DOM (detaching the element).  Use a flag instead.
        if (this._fillPanelBusy) return;

        // DEBOUNCE: After each fill-panel change, enforce a 600ms cooldown
        // before the next change can be sent.  Rapid column-count changes
        // (1→5→10→20) each trigger activate_fx_mode + draw_matrices on the
        // backend.  The Cube firmware can become overwhelmed by rapid FX
        // sessions and enter a confused state where commands are silently
        // ignored, making the lamp appear stuck.
        const now = Date.now();
        if (this._fillPanelLastSend && now - this._fillPanelLastSend < 600) {
          return; // Drop this change — too soon after previous
        }
        const cols = parseInt(e.target.value, 10);

        // Optimistic UI update
        this._optimisticFillCols = cols;
        if (this._fillPanelTimeout) clearTimeout(this._fillPanelTimeout);
        this._fillPanelTimeout = setTimeout(() => {
          if (this._optimisticFillCols !== undefined) {
            this._optimisticFillCols = undefined;
            this.render();
          }
        }, 5000);

        // Mark busy BEFORE render so the re-created select's listener also
        // sees the flag and short-circuits if another change event arrives.
        this._fillPanelBusy = true;
        this._fillPanelLastSend = Date.now(); // Debounce timestamp
        this.render();

        // Resolve the full list of target entities (same list used by
        // callServiceOnTargetEntities).
        const allTargets =
          this.config.target_entities ||
          (this.config.entity ? [this.config.entity] : []);

        if (cols > 0) {
          // Save each entity's current text before filling.
          // Use a Map so each entity can be restored to its own text.
          if (!this._savedTextPerEntity) {
            this._savedTextPerEntity = {};
          }
          for (const eid of allTargets) {
            const st = this._hass.states[eid];
            const curText = st?.attributes?.custom_text || "";
            // Only save if not already a fill char (avoid overwriting the
            // real text with another fill char when changing column count).
            if (!FILL_PANEL_CHAR_TO_COLS[curText]) {
              this._savedTextPerEntity[eid] = curText;
            }
          }
          this.callServiceOnTargetEntities("set_custom_text", {
            text: FILL_PANEL_CHARS[cols],
          })
            .then(() => {
              this._fillPanelBusy = false;
              this.render();
            })
            .catch(() => {
              this._optimisticFillCols = undefined;
              this._fillPanelBusy = false;
              this.render();
            });
        } else {
          // Off: restore each entity to its own previously-saved text.
          const saved = this._savedTextPerEntity || {};
          const restorePromises = allTargets.map(async (eid) => {
            const restoreText = saved[eid] ?? "";
            try {
              await this._hass.callService("yeelight_cube", "set_custom_text", {
                text: restoreText,
                entity_id: eid,
              });
            } catch (err) {
              console.error(
                `[Gradient Card] Error restoring text for ${eid}:`,
                err,
              );
            }
          });
          Promise.all(restorePromises)
            .then(() => {
              this._fillPanelBusy = false;
              this._savedTextPerEntity = undefined;
              this.render();
            })
            .catch(() => {
              this._optimisticFillCols = undefined;
              this._fillPanelBusy = false;
              this.render();
            });
        }
      });
    }

    // Handle panel toggle interactions for switch and card styles
    const switchContainer = root.querySelector(
      ".panel-toggle.switch .switch-container",
    );
    if (switchContainer) {
      switchContainer.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._togglePanelCheckbox();
      });
    }

    const switchLabel = root.querySelector(".panel-toggle.switch label");
    if (switchLabel) {
      switchLabel.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._togglePanelCheckbox();
      });
    }

    const cardToggle = root.querySelector(
      ".panel-toggle.card[data-toggle-card='true']",
    );
    if (cardToggle) {
      cardToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._togglePanelCheckbox();
      });
    }

    // Inject visibility overlays in edit mode (for initial render)
    this._injectVisibilityOverlays(
      root,
      this.config?.edit_gradient_modes === true,
    );

    // NOTE: Preview item click handlers are bound in _attachPreviewEventListeners(),
    // not here, to avoid double-binding when the preview DOM is updated.
  }

  _renderPanelToggle(applyToWholePanel, style) {
    // Use optimistic value if set
    if (this._optimisticPanelMode !== undefined) {
      applyToWholePanel = this._optimisticPanelMode;
    }
    const checkboxId = "apply-to-panel";

    switch (style) {
      case "switch":
        return `
          <div class="panel-toggle switch">
            <label for="${checkboxId}">Apply to Whole Panel</label>
            <div class="switch-container">
              <input type="checkbox" id="${checkboxId}" ${
                applyToWholePanel ? "checked" : ""
              }>
              <span class="switch-slider"></span>
            </div>
          </div>
        `;

      case "card":
        return `
          <div class="panel-toggle card ${
            applyToWholePanel ? "active" : ""
          }" data-toggle-card="true">
            <label for="${checkboxId}">Apply to Whole Panel</label>
            <div class="card-indicator"></div>
            <input type="checkbox" id="${checkboxId}" ${
              applyToWholePanel ? "checked" : ""
            }>
          </div>
        `;

      case "default":
      default:
        return `
          <div class="panel-toggle default">
            <input type="checkbox" id="${checkboxId}" ${
              applyToWholePanel ? "checked" : ""
            }>
            <label for="${checkboxId}">Apply to Whole Panel</label>
          </div>
        `;
    }
  }

  _togglePanelCheckbox() {
    const root = this.shadowRoot;
    if (!root) return;

    const checkbox = root.getElementById("apply-to-panel");
    if (!checkbox) return;

    // Toggle the checkbox state
    checkbox.checked = !checkbox.checked;

    // Create and dispatch a change event to trigger the existing change handler
    const changeEvent = new Event("change", { bubbles: true });
    checkbox.dispatchEvent(changeEvent);
  }

  _renderPreviewSection() {
    // "[Gradient Card] _renderPreviewSection() called - just returning HTML template",
    // {
    // cachedPreviewHtml: this._cachedPreviewHtml ? "exists" : "null",
    // timestamp: Date.now(),
    // }
    // );

    // Just return the HTML template, initialization is handled elsewhere now
    return `
      <div class="preview-section" style="margin-top: 12px;">
        <div class="preview-grid-container" style="max-width: 100%; overflow: visible;">
          ${this._getCachedPreviewGrid()}
        </div>
      </div>
    `;
  }

  _updatePreviewSection() {
    // containerExists: !!this.shadowRoot?.querySelector(
    // ".preview-grid-container"
    // ),
    // displayMode: this.config?.preview_display_mode,
    // timestamp: Date.now(),
    // });

    const displayMode = this._getDisplayMode();

    // For wheel mode, try surgical update first (only update preview images)
    // But if wheel doesn't exist yet, or we're in edit mode, fall through to full render
    const editMode = this.config?.edit_gradient_modes === true;
    if (displayMode === "wheel" && !editMode) {
      const wheelExists = this.shadowRoot?.querySelector(
        ".wheel-item[data-mode]",
      );
      // wheelExists: !!wheelExists,
      // wheelItemsCount:
      // this.shadowRoot?.querySelectorAll(".wheel-item").length,
      // allWheelItems: Array.from(
      // this.shadowRoot?.querySelectorAll(".wheel-item") || []
      // ).map((item) => item.dataset.mode),
      // });

      if (wheelExists) {
        // Ensure wheel controller is initialized
        if (!this._wheelNavigationController) {
          this._attachPreviewEventListeners();
        }

        this._updateWheelPreviews();
        return;
      } else {
        // "[Gradient Card] Wheel doesn't exist yet, will do full render"
        // );
      }
    }

    // For other modes OR if wheel doesn't exist yet, update the entire container
    const container = this.shadowRoot?.querySelector(".preview-grid-container");
    if (container) {
      // Ensure overflow matches current display mode
      container.style.overflow = displayMode === "wheel" ? "visible" : "hidden";

      // Generate new preview HTML with updated data
      const newPreviewHtml = this._renderPreviewGrid();

      // currentLength: container.innerHTML.length,
      // newLength: newPreviewHtml.length,
      // willUpdate: container.innerHTML !== newPreviewHtml,
      // });

      // Only update if content actually changed
      if (container.innerHTML !== newPreviewHtml) {
        container.innerHTML = newPreviewHtml;

        // Re-attach event listeners for preview items after updating DOM
        this._attachPreviewEventListeners();
      } else {
        // HTML unchanged — but listeners may be missing if _previewElement was
        // just recreated (e.g. after toggling titles). The initial HTML in the
        // new element is identical to the generated HTML, so innerHTML doesn't
        // change, but its gallery items have never had click listeners bound.
        // _attachPreviewEventListeners uses per-element guards (_gcClickBound)
        // to prevent duplicate listeners on already-bound items.
        this._attachPreviewEventListeners();
      }

      // Update cache
      this._cachedPreviewHtml = newPreviewHtml;
    } else {
      console.warn("[Gradient Card] Container not found in DOM!");
    }
  }

  /**
   * Surgically update only the preview images within wheel items
   * This avoids destroying and re-creating the wheel structure
   */
  _updateWheelPreviews() {
    // "[Gradient Card] Updating wheel preview images only (not wheel structure)"
    // );

    const previewData = window._yeelightPreviewCache.data;
    if (!previewData) {
      return;
    }

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;

    // Get gallery settings from config
    const galleryBgColor = this.config.gallery_background_color || "#000000";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPixelGap =
      this.config.gallery_pixel_gap !== undefined
        ? this.config.gallery_pixel_gap
        : 1;
    const galleryPreviewSize = this.config.gallery_preview_size || 200;
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;

    // Find all wheel items and update their preview images
    const wheelItems = this.shadowRoot.querySelectorAll(
      ".wheel-item[data-mode]",
    );

    wheelItems.forEach((item) => {
      const mode = item.dataset.mode;
      const previewColors = previewData.previews[mode];

      if (!previewColors) return;

      // Flip vertically: reverse rows to fix upside-down display
      const flippedColors = [];
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          const color = previewColors[row * cols + col];
          flippedColors.push(color);
        }
      }

      // Find the preview container within this item
      const previewContainer = item.querySelector(".gallery-matrix-preview");
      if (previewContainer) {
        // Generate new preview HTML
        const newPreviewHtml = this._renderSingleMatrixPreview(flippedColors, {
          rows,
          cols,
          bgColor: galleryBgColor,
          pixelStyle: galleryPixelStyle,
          pixelGap: galleryPixelGap,
          previewSize: galleryPreviewSize,
          ignoreBlackPixels,
        });

        // Update only the preview content
        previewContainer.outerHTML = newPreviewHtml;
      }
    });

    // "[Gradient Card] Updated preview images in",
    // wheelItems.length,
    // "wheel items"
    // );

    // Refresh active-mode highlighting on wheel items
    this._markActiveMode();
  }

  /**
   * Render a single matrix preview (delegates to shared renderMatrixPreview utility)
   */
  _renderSingleMatrixPreview(colorData, options) {
    return renderMatrixPreview(colorData, options);
  }

  /**
   * Return the primary entity ID (first target entity, or fallback single entity).
   */
  _getPrimaryEntity() {
    const targetEntities = this.config?.target_entities || [];
    return targetEntities.length > 0 ? targetEntities[0] : this.config?.entity;
  }

  /**
   * Return the normalised preview display mode.
   * Maps legacy values: "inline" → "grid", "gallery" → "list".
   * Defaults to "grid" when unset.
   */
  _getDisplayMode() {
    const raw = this.config?.preview_display_mode;
    // Map legacy values and removed "grid" mode to "list"
    if (raw === "inline" || raw === "grid") return "list";
    if (raw === "gallery") return "list";
    return raw || "list";
  }

  /**
   * Return the current gradient mode, preferring the optimistic (pending) mode.
   * Falls back to the entity's reported mode, or null.
   */
  _getCurrentMode() {
    if (this._optimisticMode) return this._optimisticMode;
    const primaryEntity = this._getPrimaryEntity();
    const entityState = primaryEntity && this._hass?.states[primaryEntity];
    return entityState?.attributes?.mode || null;
  }

  /**
   * Shared mode-selection logic: set optimistic state, call backend, clean up.
   * Callers handle any UI-specific disabling/enabling around this.
   */
  async _selectMode(mode) {
    if (this._processingModeChange) return;
    this._processingModeChange = true;

    this._optimisticMode = mode;
    this._lastModeChangeTime = Date.now();
    this._markActiveMode();

    const applyToPanel =
      this.shadowRoot?.getElementById("apply-to-panel")?.checked || false;

    try {
      await this.callServiceOnTargetEntities("set_mode", {
        mode,
        panel_mode: applyToPanel,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      this._optimisticMode = null;
      // For wheel mode, skip full render to avoid blink — just update active highlight
      if (this._getDisplayMode() === "wheel") {
        this._markActiveMode();
      } else {
        this.render();
      }
    } catch (error) {
      console.error("Error changing mode:", error);
      this._optimisticMode = null;
      if (this._getDisplayMode() === "wheel") {
        this._markActiveMode();
      } else {
        this.render();
      }
    } finally {
      this._processingModeChange = false;
    }
  }

  /**
   * Update data-active-mode attributes on all gallery/wheel items in the DOM.
   * Called after DOM updates to keep the active-mode highlight in sync.
   */
  _markActiveMode() {
    const root = this.shadowRoot;
    if (!root) return;

    const highlightActive = this.config?.highlight_active_mode !== false;
    const currentMode = highlightActive ? this._getCurrentMode() : null;

    // Set host attribute so CSS can conditionally style wheel-centered items
    this.dataset.highlightActive = highlightActive ? "true" : "false";

    // Update gallery items (.gallery-item) and wheel items (.wheel-item)
    const allItems = root.querySelectorAll("[data-mode]");
    allItems.forEach((item) => {
      const mode = item.dataset.mode;
      if (highlightActive && currentMode && mode === currentMode) {
        item.setAttribute("data-active-mode", "true");
      } else {
        item.removeAttribute("data-active-mode");
      }
    });
  }

  _attachPreviewEventListeners() {
    const root = this.shadowRoot;
    if (!root) return;

    // Mark the active mode item in the DOM
    this._markActiveMode();

    const editMode = this.config?.edit_gradient_modes === true;

    // Inject visibility overlays in edit mode
    this._injectVisibilityOverlays(root, editMode);

    // Preview item clicks - apply the selected mode
    // Guarded: each DOM element is marked once to prevent duplicate listeners
    const previewItems = root.querySelectorAll(".gallery-item[data-mode]");
    let boundCount = 0;
    previewItems.forEach((item) => {
      if (item._gcClickBound) return; // Already has listener
      item._gcClickBound = true;
      boundCount++;
      item.addEventListener("click", (e) => {
        // In edit mode, ignore clicks on items (only eye icon should work)
        if (this.config?.edit_gradient_modes === true) return;

        const mode = e.currentTarget.dataset.mode;
        if (!mode) return;

        this._selectMode(mode);
      });
    });

    // Setup wheel mode navigation
    // After DOM update, we need to re-initialize if wheel was destroyed
    const displayMode = this._getDisplayMode();
    if (displayMode === "wheel") {
      if (!this._wheelNavigationController) {
        // "[Gradient Card] Initializing wheel navigation (DOM was updated)"
        // );
        this._setupWheelNavigation();
      } else {
        // "[Gradient Card] Wheel already exists (shouldn't happen after DOM update)"
        // );
      }
    }
  }

  _syncWheelToCurrentMode() {
    if (!this._wheelNavigationController) {
      // Self-healing: if controller is missing but we're in wheel mode with items in DOM, re-init
      const displayMode = this._getDisplayMode();
      const wheelExists = this.shadowRoot?.querySelector(
        ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
      );
      if (displayMode === "wheel" && wheelExists) {
        console.warn(
          "[Gradient Card] _syncWheelToCurrentMode: controller missing but wheel items exist — re-initializing",
          {
            displayMode,
            wheelItemsCount: this.shadowRoot?.querySelectorAll(
              ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
            ).length,
          },
        );
        this._setupWheelNavigation();
      }
      return;
    }
    this._wheelNavigationController.sync();
  }

  _setupWheelNavigation() {
    const displayMode = this._getDisplayMode();

    // Clean up previous controller if exists
    if (this._wheelNavigationController) {
      this._wheelNavigationController.destroy();
      this._wheelNavigationController = null;
    }

    // Check if this is a re-initialization (preview update) or first load
    const isReInitializing = this._wheelReInitializing || false;
    this._wheelReInitializing = false; // Reset flag

    // Derive wheel display style from showTitles setting
    const showTitles = this.config.preview_show_titles !== false;
    const derivedConfig = {
      ...this.config,
      wheel_display_style: showTitles ? "default" : "compact",
    };

    // Initialize new controller
    const controller = initializeWheelNavigation({
      shadowRoot: this.shadowRoot,
      displayMode,
      config: derivedConfig,
      currentCenterIndex: this._wheelCenterIndex,
      immediate: isReInitializing, // Skip animation delay if re-initializing
      onModeSelect: async (mode, index) => {
        // In edit mode, ignore mode selection (only eye icon should work)
        if (this.config?.edit_gradient_modes === true) return;

        this._wheelCenterIndex = index;
        await this._selectMode(mode);
      },
      getCurrentMode: () => this._getCurrentMode(),
    });

    // Verify the controller actually found items — initializeWheelNavigation
    // returns a no-op stub when container/items are missing. Storing that stub
    // as truthy blocks later re-initialization when items DO appear in the DOM.
    const wheelItemsInDOM =
      this.shadowRoot?.querySelectorAll(
        '[data-wheel-item="true"], [data-wheel-compact-item="true"]',
      ).length || 0;

    if (wheelItemsInDOM === 0) {
      // Expected during connectedCallback before first render — not an error.
      controller.destroy();
      this._wheelNavigationController = null;
    } else {
      this._wheelNavigationController = controller;
      this._wheelCenterIndex = controller.getCenterIndex();
    }
  }

  _getCachedPreviewGrid() {
    // Generate a hash of the preview data to detect changes
    // Round angle to avoid re-renders on tiny floating point changes
    const previewData = window._yeelightPreviewCache.data;
    // hasData: !!previewData,
    // displayMode: this.config.preview_display_mode,
    // });

    const currentHash = previewData
      ? JSON.stringify({
          text: previewData.text,
          angle: Math.round(previewData.angle * 10) / 10, // Round to 1 decimal
          bgColor: this.config.gallery_background_color,
          pixelStyle: this.config.gallery_pixel_style,
          pixelGap: this.config.gallery_pixel_gap,
          previewSize: this.config.gallery_preview_size,
          ignoreBlack: this.config.gallery_ignore_black_pixels,
          displayMode: this.config.preview_display_mode,
          showTitles: this.config.preview_show_titles,
          editGradientModes: this.config.edit_gradient_modes,
          modeVisibility: JSON.stringify(this._modeVisibility),
        })
      : null;

    // Only re-render if data actually changed
    if (currentHash !== this._lastPreviewDataHash) {
      this._lastPreviewDataHash = currentHash;
      this._cachedPreviewHtml = this._renderPreviewGrid();
      // htmlLength: this._cachedPreviewHtml?.length,
      // containsWheelDisplay: this._cachedPreviewHtml?.includes(
      // 'class="wheel-display"'
      // ),
      // });
    } else {
    }

    return this._cachedPreviewHtml || this._renderPreviewGrid();
  }

  _renderPreviewGrid() {
    const previewData = window._yeelightPreviewCache.data;
    if (!previewData) {
      return ``; // Return empty instead of "Loading previews..." message
    }

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;
    // Get gallery settings from config
    const galleryBgColor = this.config.gallery_background_color || "#000000";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPixelGap =
      this.config.gallery_pixel_gap !== undefined
        ? this.config.gallery_pixel_gap
        : 1;
    const galleryPreviewSize = this.config.gallery_preview_size || 200;
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;
    const displayMode = this._getDisplayMode();
    const showTitles = this.config.preview_show_titles !== false;
    // Derive showCards per mode:
    //   list  → always plain
    //   compact → cards when titles on, plain when titles off
    //   wheel → always cards
    const showCards =
      displayMode === "wheel"
        ? true
        : displayMode === "compact"
          ? showTitles
          : false; // list = always plain
    const editMode = this.config.edit_gradient_modes === true;

    // Prepare items for the shared gallery utility
    const items = GRADIENT_MODES.map((mode) => {
      const previewColors = previewData.previews[mode];
      if (!previewColors) return null;

      const isVisible = this._isModeVisible(mode);

      // In normal mode, skip hidden items entirely
      if (!editMode && !isVisible) return null;

      // Flip vertically: reverse rows to fix upside-down display
      const flippedColors = [];
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          const color = previewColors[row * cols + col];
          flippedColors.push(color);
        }
      }

      return {
        title: mode.replace(" Gradient", ""),
        colorData: flippedColors,
        dataMode: mode, // For click handler
        metadata: null,
        _hidden: !isVisible, // Internal flag for edit mode styling
      };
    }).filter((item) => item !== null);

    // Render using shared utility
    // Resolve the current active mode for highlighting
    const highlightActive = this.config.highlight_active_mode !== false;
    const currentMode = highlightActive ? this._getCurrentMode() : null;

    const galleryHtml = renderGalleryDisplay(items, displayMode, {
      rows,
      cols,
      bgColor: galleryBgColor,
      pixelStyle: galleryPixelStyle,
      pixelGap: galleryPixelGap,
      previewSize: galleryPreviewSize,
      ignoreBlackPixels,
      showCards,
      showTitles,
      onClickEnabled: true,
      matrixBoxShadow: false,
      pixelBoxShadow: false,
      wheelNavPosition: this.config.wheel_nav_position || "bottom",
      wheelHeight: this.config.wheel_height || 300,
      wheelDisplayStyle: showTitles ? "default" : "compact",
      currentMode,
      highlightActive,
    });

    return `
      <div style="margin-top: 12px; 
      /* padding: 12px; 
      background: rgba(0,0,0,0.1); */
       border-radius: 8px;">
        ${galleryHtml}
      </div>
    `;
  }

  async _loadPreviews() {
    if (!this._hass || !this.config.entity) return;

    try {
      // Get target entity
      const entityId = this._getPrimaryEntity();

      // Track request time in global cache
      window._yeelightPreviewCache.timestamp = Date.now();

      // Call the preview service
      await this._hass.callService("yeelight_cube", "preview_gradient_modes", {
        entity_id: entityId,
      });

      // The response will come via event bus, handled by event listener
      // Reset retry counter on success
      this._previewRetryCount = 0;
    } catch (error) {
      // During HA startup, the light platform services may not be registered yet.
      // Also handle transient connection-lost errors.
      const errorCode = error?.code || error?.error?.code;
      const isTransient =
        errorCode === "not_found" ||
        errorCode === 3 ||
        errorCode === "connection-lost";
      if (isTransient) {
        const retryCount = (this._previewRetryCount || 0) + 1;
        this._previewRetryCount = retryCount;
        if (retryCount <= 5) {
          const delay = Math.min(retryCount * 2000, 10000); // 2s, 4s, 6s, 8s, 10s
          setTimeout(() => this._loadPreviews(), delay);
        } else {
          console.warn(
            "[Gradient Card] Preview load still failing after 5 retries. " +
              "Check device connectivity.",
          );
        }
        return;
      }
      console.error("[Gradient Card] Error loading previews:", error);
    }
  }

  _setupPreviewEventListener() {
    if (this._previewEventListenerRegistered || !this._hass) return;

    this._previewEventListenerRegistered = true;

    this._hass.connection.subscribeEvents((event) => {
      // Generate hash of response to deduplicate
      const responseHash = JSON.stringify({
        entity: event.data.entity_id,
        text: event.data.text,
        angle: Math.round(event.data.angle * 10) / 10,
        brightness: event.data.brightness,
      });

      const cache = window._yeelightPreviewCache;

      // Ignore duplicate responses
      if (responseHash === cache.responseHash) {
        return;
      }

      // Store in global cache
      cache.data = event.data;
      cache.responseHash = responseHash;
      cache.timestamp = Date.now();

      // Update only the preview section instead of re-rendering entire card
      this._updatePreviewSection();
    }, "yeelight_cube_gradient_preview_response");
  }

  _getRotaryStyleInfo() {
    // Handle unified rotary style with backward compatibility
    const unifiedStyle = this.config.rotary_unified_style;

    if (unifiedStyle) {
      // New unified format
      switch (unifiedStyle) {
        case "turning_rectangle":
          return { style: "default", shape: "rectangle" };
        case "arrow":
          return { style: "default", shape: "arrow_classic" };
        case "star":
          return { style: "default", shape: "star" };
        case "wheel":
          return { style: "wheel", shape: null };
        case "rectangle":
          return { style: "rect", shape: null };
        case "square":
          return { style: "square", shape: null };
        default:
          return { style: "default", shape: "rectangle" };
      }
    } else {
      // Backward compatibility with old format
      const oldStyle = this.config.angle_rotary_style || "default";
      const oldShape = this.config.default_shape || "rectangle";
      return { style: oldStyle, shape: oldShape };
    }
  }

  _getRotarySize() {
    // Use unified rotary_size if available, otherwise fall back to specific sizes
    if (this.config.rotary_size) {
      return this.config.rotary_size;
    }

    const styleInfo = this._getRotaryStyleInfo();
    if (styleInfo.style === "wheel") {
      return this.config.wheel_size || 80;
    } else if (styleInfo.style === "rect") {
      return this.config.rect_size || 80;
    } else {
      return this.config.default_size || 80;
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
        this._updateRotaryDisplay(angle);
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
        this._updateRotaryDisplay(angle);
        this._debouncedApplyAngle(angle);
      });

      // Clear the slider flag when slider interaction ends
      angleSlider.addEventListener("mouseup", () => {
        setTimeout(() => {
          this._usingSlider = false;
        }, 100);
      });
      angleSlider.addEventListener("touchend", () => {
        setTimeout(() => {
          this._usingSlider = false;
        }, 100);
      });

      // Safety timeout to ensure flag gets cleared
      angleSlider.addEventListener("mouseleave", () => {
        setTimeout(() => {
          this._usingSlider = false;
        }, 200);
      });
    }

    // Enhanced drag behavior: Document-level event handlers for continuous interaction
    // This allows dragging to continue even when mouse/touch leaves the rotary control area
    // These handlers are shared between rotary containers and selector dots for consistent behavior
    const handleMouseMove = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection during drag
        this._handleRotaryDrag(e);
      }
    };

    const handleMouseUp = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = undefined;

        // Clean up document listeners
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      }
    };

    const handleTouchMove = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection
        this._handleRotaryDrag(e.touches[0]);
      }
    };

    const handleTouchEnd = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = undefined;

        // Clean up document listeners
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
      }
    };

    // Rotary slider (SVG): click or drag to set angle
    if (rotary) {
      rotary.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = true;
        this._handleRotaryDrag(e);

        // Add document listeners for mouse move and up
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
      });

      rotary.addEventListener("touchstart", (e) => {
        e.preventDefault(); // Prevent text selection
        this._draggingRotary = true;
        this._handleRotaryDrag(e.touches[0]);

        // Add document listeners for touch move and end
        document.addEventListener("touchmove", handleTouchMove);
        document.addEventListener("touchend", handleTouchEnd);
      });

      rotary.addEventListener("click", (e) => {
        // Only handle click if we're not dragging
        if (!this._draggingRotary) {
          e.preventDefault(); // Prevent text selection
          this._handleRotaryDrag(e);
        }
      });
    }

    // Enhanced selector dot interaction: Make selector dots clickable and draggable
    // This provides an alternative interaction method alongside the rotary container itself
    // Both elements share the same event handlers for consistent behavior across all rotary styles
    if (this.config.show_selector_dot !== false) {
      // Wheel selector dot (SVG circle)
      const wheelSelector = root.querySelector(".wheel-selector");
      if (wheelSelector) {
        wheelSelector.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation(); // Prevent event from bubbling to parent
          this._draggingRotary = true;
          this._handleRotaryDrag(e);
          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
        });

        wheelSelector.addEventListener("touchstart", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._draggingRotary = true;
          this._handleRotaryDrag(e.touches[0]);
          document.addEventListener("touchmove", handleTouchMove);
          document.addEventListener("touchend", handleTouchEnd);
        });

        wheelSelector.addEventListener("click", (e) => {
          if (!this._draggingRotary) {
            e.preventDefault();
            e.stopPropagation();
            this._handleRotaryDrag(e);
          }
        });
      }

      // Rectangle selector dot (div)
      const rectSelector = root.querySelector(".rect-selector");
      if (rectSelector) {
        rectSelector.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._draggingRotary = true;
          this._handleRotaryDrag(e);
          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
        });

        rectSelector.addEventListener("touchstart", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._draggingRotary = true;
          this._handleRotaryDrag(e.touches[0]);
          document.addEventListener("touchmove", handleTouchMove);
          document.addEventListener("touchend", handleTouchEnd);
        });

        rectSelector.addEventListener("click", (e) => {
          if (!this._draggingRotary) {
            e.preventDefault();
            e.stopPropagation();
            this._handleRotaryDrag(e);
          }
        });
      }

      // Square selector dot (div)
      const squareSelector = root.querySelector(".square-selector");
      if (squareSelector) {
        squareSelector.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._draggingRotary = true;
          this._handleRotaryDrag(e);
          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
        });

        squareSelector.addEventListener("touchstart", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._draggingRotary = true;
          this._handleRotaryDrag(e.touches[0]);
          document.addEventListener("touchmove", handleTouchMove);
          document.addEventListener("touchend", handleTouchEnd);
        });

        squareSelector.addEventListener("click", (e) => {
          if (!this._draggingRotary) {
            e.preventDefault();
            e.stopPropagation();
            this._handleRotaryDrag(e);
          }
        });
      }
    }
  } // Always get the current textColors from the entity state
  _getCurrentTextColors() {
    const entityId = this.config?.entity;
    const hass = this._hass;
    if (hass && entityId && hass.states[entityId]) {
      const stateObj = hass.states[entityId];
      return stateObj.attributes.text_colors || [[255, 255, 255]];
    }
    return [[255, 255, 255]];
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
    const targetEntities = this.config.target_entities || [];
    const fallbackEntity = this.config.entity;

    // "_applyAngle called with:",
    // angle,
    // "target_entities:",
    // targetEntities,
    // "fallback_entity:",
    // fallbackEntity,
    // "hass:",
    // !!this._hass
    // );

    if ((targetEntities.length === 0 && !fallbackEntity) || !this._hass) return;

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
    return (
      "#" +
      rgb
        .map((x) => {
          const hex = x.toString(16);
          return hex.length === 1 ? "0" + hex : hex;
        })
        .join("")
    );
  }

  _createColorWheelSegments(colors, radius) {
    if (!colors || colors.length === 0) {
      return `<circle cx="50" cy="50" r="${radius}" fill="#ff0000"/>`;
    }

    if (colors.length === 1) {
      const hex = this._rgbToHex(colors[0]);
      return `<circle cx="50" cy="50" r="${radius}" fill="${hex}"/>`;
    }

    // Create pie slices for each color
    const segments = [];
    const anglePerSegment = 360 / colors.length;

    for (let i = 0; i < colors.length; i++) {
      const startAngle = (i * anglePerSegment - 90) * (Math.PI / 180); // Start from top
      const endAngle = ((i + 1) * anglePerSegment - 90) * (Math.PI / 180);

      const x1 = 50 + radius * Math.cos(startAngle);
      const y1 = 50 + radius * Math.sin(startAngle);
      const x2 = 50 + radius * Math.cos(endAngle);
      const y2 = 50 + radius * Math.sin(endAngle);

      const largeArcFlag = anglePerSegment > 180 ? 1 : 0;

      const hex = this._rgbToHex(colors[i]);

      const pathData = [
        `M 50 50`, // Move to center
        `L ${x1} ${y1}`, // Line to start of arc
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`, // Arc
        `Z`, // Close path
      ].join(" ");

      segments.push(`<path d="${pathData}" fill="${hex}"/>`);
    }

    return segments.join("\n                ");
  }

  _createWheelGradientStops(colors) {
    if (!colors || colors.length === 0) {
      return '<stop offset="0%" style="stop-color:#ff0000"/><stop offset="100%" style="stop-color:#ff0000"/>';
    }

    if (colors.length === 1) {
      const hex = this._rgbToHex(colors[0]);
      return `<stop offset="0%" style="stop-color:${hex}"/><stop offset="100%" style="stop-color:${hex}"/>`;
    }

    // Create a simple linear gradient from left (0%) to right (100%)
    const stops = [];

    for (let i = 0; i < colors.length; i++) {
      const offset = (i / (colors.length - 1)) * 100;
      const hex = this._rgbToHex(colors[i]);
      stops.push(`<stop offset="${offset}%" style="stop-color:${hex}"/>`);
    }

    return stops.join("\n                  ");
  }

  _createShapeGradientStops(colors) {
    if (!colors || colors.length === 0) {
      return '<stop offset="0%" style="stop-color:#ff0000"/><stop offset="100%" style="stop-color:#ff0000"/>';
    }

    if (colors.length === 1) {
      const hex = this._rgbToHex(colors[0]);
      return `<stop offset="0%" style="stop-color:${hex}"/><stop offset="100%" style="stop-color:${hex}"/>`;
    }

    // Create symmetric gradient stops with equal extensions for first and last colors
    const stops = [];
    const extension = 10; // Small symmetric extension (reduced from ~30%)
    const startOffset = extension;
    const endOffset = 100 - extension;
    const gradientRange = endOffset - startOffset;

    // Add extended first color at the beginning
    const firstColor = this._rgbToHex(colors[0]);
    stops.push(`<stop offset="0%" style="stop-color:${firstColor}"/>`);

    // Main color distribution in the middle range
    for (let i = 0; i < colors.length; i++) {
      const offset = startOffset + (i / (colors.length - 1)) * gradientRange;
      const hex = this._rgbToHex(colors[i]);
      stops.push(`<stop offset="${offset}%" style="stop-color:${hex}"/>`);
    }

    // Add extended last color at the end
    const lastColor = this._rgbToHex(colors[colors.length - 1]);
    stops.push(`<stop offset="100%" style="stop-color:${lastColor}"/>`);

    return stops.join("\n                  ");
  }
  _generateShapeMask(shape, selectorRadius) {
    // Shape size should be proportional to gradient area for proper color concentration
    const size = selectorRadius * 1.8; // Reasonable size to work with concentrated gradient
    const centerX = 50;
    const centerY = 50;

    switch (shape) {
      case "rectangle":
        const rectWidth = size;
        const rectHeight = size * 0.6;
        const rectX = centerX - rectWidth / 2;
        const rectY = centerY - rectHeight / 2;
        return `<rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" rx="6" fill="white"/>`;

      case "arrow_classic":
        // Classic pointed arrow with sharp tip
        const classicLength = size;
        const classicBodyWidth = size * 0.25;
        const classicHeadWidth = size * 0.5;
        const classicHeadLength = size * 0.3;

        const tipX = centerX + classicLength / 2;
        const bodyLeft = centerX - classicLength / 2;
        const bodyTop = centerY - classicBodyWidth / 2;
        const bodyBottom = centerY + classicBodyWidth / 2;
        const headTop = centerY - classicHeadWidth / 2;
        const headBottom = centerY + classicHeadWidth / 2;
        const headStart = tipX - classicHeadLength;

        return `<path d="
          M ${bodyLeft} ${bodyTop}
          L ${headStart} ${bodyTop}
          L ${headStart} ${headTop}
          L ${tipX} ${centerY}
          L ${headStart} ${headBottom}
          L ${headStart} ${bodyBottom}
          L ${bodyLeft} ${bodyBottom}
          Z" fill="white"/>`;

      case "arrow":
        // Keep the old arrow for backward compatibility - redirect to classic
        return this._generateShapeMask("arrow_classic", selectorRadius);

      case "star":
        // Position star with one point exactly touching the selector dot
        // At 0°, selector is at RIGHT side (3 o'clock position), so star point should be there
        const starOuterRadius = selectorRadius; // Full size to match selector radius
        const starInnerRadius = starOuterRadius * 0.4;
        const starPoints = [];

        // Position star so first point is at 0° (right side, 3 o'clock)
        // This matches the selector coordinate system: cos(0)=1, sin(0)=0 → right side
        const startAngle = 0; // Start at 0 degrees (3 o'clock position)

        for (let i = 0; i < 10; i++) {
          // Each point is 36 degrees apart (2π/10), outer points at even indices
          const angle = startAngle + (i * Math.PI) / 5;
          const radius = i % 2 === 0 ? starOuterRadius : starInnerRadius;
          // Use SAME coordinate system as selector: +cos for X, -sin for Y
          const x = centerX + radius * Math.cos(angle);
          const y = centerY - radius * Math.sin(angle);
          starPoints.push(`${x},${y}`);
        }
        return `<polygon points="${starPoints.join(" ")}" fill="white"/>`;

      default:
        return this._generateShapeMask("rectangle", selectorRadius);
    }
  }

  _renderAngleRotary(currentAngle, isHeaderMode = false) {
    const styleInfo = this._getRotaryStyleInfo();
    const style = styleInfo.style;

    switch (style) {
      case "wheel":
        // Get the actual colors from the lamp
        const textColors = this._getCurrentTextColors();
        const wheelGradientStops = this._createWheelGradientStops(textColors);

        // Use visual angle for immediate feedback during dragging
        const visualAngle =
          this._draggingRotary && this._pendingAngle !== undefined
            ? this._pendingAngle
            : currentAngle;

        const selectorAngle = visualAngle;
        const selectorRadians = (selectorAngle * Math.PI) / 180;

        // Make wheel size configurable like rectangle
        // In header mode, use rotary size directly (no minimum constraint)
        const baseWheelSizePercent = this._getRotarySize();
        const wheelSizePercent = baseWheelSizePercent;
        const wheelSize = Math.min(100, wheelSizePercent); // SVG viewBox size
        const wheelRadius = (wheelSize * 45) / 100; // Scale radius proportionally
        const selectorRadius = (wheelSize * 40) / 100; // Scale selector radius too

        // Fix: 0° should be at center-right (3 o'clock), not center-top
        // Fix: Invert Y axis since SVG Y+ goes down but we want mathematical Y+ goes up
        const selectorX = 50 + selectorRadius * Math.cos(selectorRadians);
        const selectorY = 50 - selectorRadius * Math.sin(selectorRadians); // Flip Y axis

        // Gradient should always flow in the same direction relative to the dot
        // The gradient should rotate with the dot to maintain consistent relative positioning
        const gradientAngle = -visualAngle;

        return `
          <div class="wheel-container" style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <svg width="${
              isHeaderMode ? "88px" : `${wheelSizePercent}%`
            }" height="${
              isHeaderMode ? "88px" : `${wheelSizePercent}%`
            }" viewBox="0 0 100 100" id="angle-preview" class="color-wheel" style="max-width: 200px; max-height: 200px;">
              <defs>
                <linearGradient id="wheelGradient" x1="0%" y1="50%" x2="100%" y2="50%">
                  ${wheelGradientStops}
                </linearGradient>
                <mask id="circleMask">
                  <circle cx="50" cy="50" r="${wheelRadius}" fill="white"/>
                </mask>
              </defs>
              <g transform="rotate(${gradientAngle} 50 50)">
                <rect x="${50 - wheelRadius}" y="${50 - wheelRadius}" width="${
                  wheelRadius * 2
                }" height="${
                  wheelRadius * 2
                }" fill="url(#wheelGradient)" mask="url(#circleMask)"/>
              </g>
              <circle cx="50" cy="50" r="${wheelRadius}" fill="none" stroke="#ddd" stroke-width="1"/>
              ${
                this.config.show_selector_dot !== false
                  ? `<circle cx="${selectorX}" cy="${selectorY}" r="4" class="wheel-selector" fill="#fff" stroke="#333" stroke-width="2"/>`
                  : ""
              }
              <!-- Invisible circle to make entire wheel draggable -->
              <circle cx="50" cy="50" r="${wheelRadius}" fill="transparent" style="cursor: pointer;"/>
            </svg>
          </div>
        `;

      case "rect":
        // Get the actual colors from the lamp
        const rectTextColors = this._getCurrentTextColors();
        const rectGradientStops =
          this._createWheelGradientStops(rectTextColors);

        // Use visual angle for immediate feedback during dragging
        const rectVisualAngle =
          this._draggingRotary && this._pendingAngle !== undefined
            ? this._pendingAngle
            : currentAngle;

        // EXACT same logic as wheel for consistency
        const rectNormalizedAngle = ((rectVisualAngle % 360) + 360) % 360;

        // Map angle to rectangle perimeter position using continuous mapping
        // Rectangle has 4:1 aspect ratio, so we need to map to the perimeter
        const rectWidth = 4;
        const rectHeight = 1;
        const perimeter = 2 * (rectWidth + rectHeight); // Total perimeter = 10 units

        // Map angle (0-360°) to perimeter position (0 to perimeter)
        const perimeterPosition = (rectNormalizedAngle / 360) * perimeter;

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
        } else if (
          perimeterPosition <=
          rectHeight / 2 + rectWidth + rectHeight
        ) {
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
        const rectGradientAngle = -rectNormalizedAngle;

        // Make rectangle use full width of container with 4:1 aspect ratio
        // In header mode, use rotary size directly (no minimum constraint)
        const baseRectSizePercent = this._getRotarySize();
        const rectSizePercent = baseRectSizePercent;

        // Calculate header mode dimensions based on rotary size
        const headerWidth = isHeaderMode
          ? Math.round((rectSizePercent / 100) * 300)
          : 300;
        const headerHeight = isHeaderMode
          ? Math.round((rectSizePercent / 100) * 88)
          : 88;

        return `
          <div class="rect-container" style="width: 100%; position: relative;">
            <div 
              id="angle-preview" 
              class="color-rect rect-gradient" 
              style="
                ${
                  isHeaderMode
                    ? `width: ${headerWidth}px !important; height: ${headerHeight}px !important;`
                    : `width: ${rectSizePercent}%; aspect-ratio: 4 / 1;`
                }
                background: linear-gradient(${
                  90 + rectGradientAngle
                }deg, ${rectTextColors
                  .map((color) => `rgb(${color.join(",")})`)
                  .join(", ")});
                border: 1px solid #ddd;
                border-radius: 6px;
                margin: 0 auto;
                position: relative;
                cursor: pointer;
              "
            >
              <!-- Selector dot positioned EXACTLY like the wheel -->
              ${
                this.config.show_selector_dot !== false
                  ? `<div 
                class="rect-selector" 
                style="
                  position: absolute;
                  width: 12px;
                  height: 12px;
                  background: #fff;
                  border: 2px solid #333;
                  border-radius: 50%;
                  transform: translate(-50%, -50%);
                  left: ${rectSelectorX}%;
                  top: ${rectSelectorY}%;
                  cursor: pointer;
                "
              ></div>`
                  : ""
              }
            </div>
          </div>
        `;

      case "square":
        // Get the actual colors from the lamp (EXACT same as rectangle)
        const squareTextColors = this._getCurrentTextColors();

        // Use visual angle for immediate feedback during dragging (EXACT same as rectangle)
        const squareVisualAngle =
          this._draggingRotary && this._pendingAngle !== undefined
            ? this._pendingAngle
            : currentAngle;

        // Angle processing (EXACT same as rectangle)
        const squareNormalizedAngle = ((squareVisualAngle % 360) + 360) % 360;

        // Calculate position on square perimeter using continuous mapping
        // For 1:1 square: width = 1 unit, height = 1 unit
        const squareWidth = 1;
        const squareHeight = 1;
        const squarePerimeter = 2 * (squareWidth + squareHeight); // Total perimeter = 4 units

        // Map angle (0-360°) to perimeter position (0 to perimeter)
        const squarePerimeterPosition =
          (squareNormalizedAngle / 360) * squarePerimeter;

        let squareSelectorX, squareSelectorY;

        // Start from right edge center, go clockwise
        if (squarePerimeterPosition <= squareHeight / 2) {
          // Right edge, top half (0° to 45°)
          squareSelectorX = 100;
          squareSelectorY =
            50 - (squarePerimeterPosition / (squareHeight / 2)) * 50;
        } else if (squarePerimeterPosition <= squareHeight / 2 + squareWidth) {
          // Top edge (going from right to left) (45° to 135°)
          const topProgress =
            (squarePerimeterPosition - squareHeight / 2) / squareWidth;
          squareSelectorX = 100 - topProgress * 100;
          squareSelectorY = 0;
        } else if (
          squarePerimeterPosition <=
          squareHeight / 2 + squareWidth + squareHeight
        ) {
          // Left edge (going from top to bottom) (135° to 225°)
          const leftProgress =
            (squarePerimeterPosition - squareHeight / 2 - squareWidth) /
            squareHeight;
          squareSelectorX = 0;
          squareSelectorY = leftProgress * 100;
        } else if (
          squarePerimeterPosition <=
          squareHeight / 2 + squareWidth + squareHeight + squareWidth
        ) {
          // Bottom edge (going from left to right) (225° to 315°)
          const bottomProgress =
            (squarePerimeterPosition -
              squareHeight / 2 -
              squareWidth -
              squareHeight) /
            squareWidth;
          squareSelectorX = bottomProgress * 100;
          squareSelectorY = 100;
        } else {
          // Right edge, bottom half (back to start) (315° to 360°)
          const rightBottomProgress =
            (squarePerimeterPosition -
              squareHeight / 2 -
              squareWidth -
              squareHeight -
              squareWidth) /
            (squareHeight / 2);
          squareSelectorX = 100;
          squareSelectorY = 100 - rightBottomProgress * 50;
        }

        // Gradient rotation EXACT same as rectangle
        const squareGradientAngle = -squareNormalizedAngle;

        // Make square use rotary size (maintains 1:1 aspect ratio)
        const baseSquareSizePercent = this._getRotarySize();
        const squareSizePercent = baseSquareSizePercent;

        // Calculate header mode dimensions based on rotary size (square: width = height)
        const squareHeaderSize = isHeaderMode
          ? Math.round((squareSizePercent / 100) * 88)
          : 88;

        return `
          <div class="square-container" style="width: 100%; position: relative;">
            <div 
              id="angle-preview" 
              class="color-square square-gradient" 
              style="
                ${
                  isHeaderMode
                    ? `width: ${squareHeaderSize}px !important; height: ${squareHeaderSize}px !important;`
                    : `width: ${squareSizePercent}%; aspect-ratio: 1 / 1;`
                }
                background: linear-gradient(${
                  90 + squareGradientAngle
                }deg, ${squareTextColors
                  .map((color) => `rgb(${color.join(",")})`)
                  .join(", ")});
                border: 1px solid #ddd;
                border-radius: 6px;
                margin: 0 auto;
                position: relative;
                cursor: pointer;
              "
            >
              <!-- Selector dot positioned EXACTLY like the rectangle -->
              ${
                this.config.show_selector_dot !== false
                  ? `<div 
                class="square-selector" 
                style="
                  position: absolute;
                  width: 12px;
                  height: 12px;
                  background: #fff;
                  border: 2px solid #333;
                  border-radius: 50%;
                  transform: translate(-50%, -50%);
                  left: ${squareSelectorX}%;
                  top: ${squareSelectorY}%;
                  cursor: pointer;
                "
              ></div>`
                  : ""
              }
            </div>
          </div>
        `;

      default:
        // Get the actual colors from the lamp (EXACT same as wheel)
        const defaultTextColors = this._getCurrentTextColors();
        const defaultGradientStops =
          this._createShapeGradientStops(defaultTextColors);

        // Use visual angle for immediate feedback during dragging (EXACT same as wheel)
        const defaultVisualAngle =
          this._draggingRotary && this._pendingAngle !== undefined
            ? this._pendingAngle
            : currentAngle;

        const defaultSelectorAngle = defaultVisualAngle;
        const defaultSelectorRadians = (defaultSelectorAngle * Math.PI) / 180;

        // Make size configurable (EXACT same as wheel)
        // In header mode, use rotary size directly (no minimum constraint)
        const baseDefaultSizePercent = this._getRotarySize();
        const defaultSizePercent = baseDefaultSizePercent;
        const defaultSize = Math.min(100, defaultSizePercent);
        const defaultRadius = (defaultSize * 45) / 100;
        const defaultSelectorRadius = (defaultSize * 40) / 100;

        // Position selector (EXACT same as wheel)
        const defaultSelectorX =
          50 + defaultSelectorRadius * Math.cos(defaultSelectorRadians);
        const defaultSelectorY =
          50 - defaultSelectorRadius * Math.sin(defaultSelectorRadians);

        // Gradient rotation (EXACT same as wheel)
        const defaultGradientAngle = -defaultVisualAngle;

        // Get selected shape
        const defaultShape = styleInfo.shape || "rectangle";
        const shapeMask = this._generateShapeMask(
          defaultShape,
          defaultSelectorRadius,
        );

        // Calculate gradient area to exactly match the shape size for perfect color distribution
        const gradientSize = defaultSelectorRadius * 2.0; // Exact match to shape boundaries
        const gradientX = 50 - gradientSize / 2;
        const gradientY = 50 - gradientSize / 2;

        return `
          <div class="default-container" style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <svg width="${
              isHeaderMode ? "88px" : `${defaultSizePercent}%`
            }" height="${
              isHeaderMode ? "88px" : `${defaultSizePercent}%`
            }" viewBox="0 0 100 100" id="angle-preview" class="color-wheel" style="max-width: 200px; max-height: 200px;">
              <defs>
                <linearGradient id="defaultGradient" x1="0%" y1="50%" x2="100%" y2="50%">
                  ${defaultGradientStops}
                </linearGradient>
                <mask id="shapeMask">
                  ${shapeMask}
                </mask>
              </defs>
              <g transform="rotate(${defaultGradientAngle} 50 50)">
                <rect x="${gradientX}" y="${gradientY}" width="${gradientSize}" height="${gradientSize}" fill="url(#defaultGradient)" mask="url(#shapeMask)"/>
              </g>
              <!-- NO static frame - removed the stroke rectangle -->
              ${
                this.config.show_selector_dot !== false
                  ? `<circle cx="${defaultSelectorX}" cy="${defaultSelectorY}" r="4" class="wheel-selector" fill="#fff" stroke="#333" stroke-width="2"/>`
                  : ""
              }
              <!-- Invisible circle to make entire area draggable -->
              <circle cx="50" cy="50" r="${defaultRadius}" fill="transparent" style="cursor: pointer;"/>
            </svg>
          </div>
        `;
    }
  }

  _handleRotaryDrag(e) {
    // Prevent text selection during dragging
    e.preventDefault();

    const rotaryElement = this.shadowRoot.getElementById("angle-preview");
    if (!rotaryElement) return;

    const styleInfo = this._getRotaryStyleInfo();
    const style = styleInfo.style;
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
        const rectRelX = e.clientX - rect.left;
        const rectRelY = e.clientY - rect.top;

        // Convert click position to percentage within rectangle
        const rectClickX = (rectRelX / rect.width) * 100;
        const rectClickY = (rectRelY / rect.height) * 100;

        // Map rectangle position to angle using SAME perimeter logic as display
        // Rectangle has 4:1 aspect ratio
        const rectWidth = 4;
        const rectHeight = 1;
        const perimeter = 2 * (rectWidth + rectHeight); // Total perimeter = 10 units

        let perimeterPos = 0;

        // Determine which edge and position on that edge
        if (rectClickX >= 90 && rectClickY <= 60) {
          // Right edge region - map Y position to perimeter
          if (rectClickY <= 50) {
            // Top half of right edge (0° to ~18°)
            const progress = (50 - rectClickY) / 50;
            perimeterPos = progress * (rectHeight / 2);
          } else {
            // Bottom half of right edge (~342° to 360°)
            const progress = (rectClickY - 50) / 50;
            perimeterPos = perimeter - progress * (rectHeight / 2);
          }
        } else if (rectClickY <= 20) {
          // Top edge region - map X position to perimeter
          const progress = (100 - rectClickX) / 100;
          perimeterPos = rectHeight / 2 + progress * rectWidth;
        } else if (rectClickX <= 10) {
          // Left edge region - map Y position to perimeter
          const progress = rectClickY / 100;
          perimeterPos = rectHeight / 2 + rectWidth + progress * rectHeight;
        } else if (rectClickY >= 80) {
          // Bottom edge region - map X position to perimeter
          const progress = rectClickX / 100;
          perimeterPos =
            rectHeight / 2 + rectWidth + rectHeight + progress * rectWidth;
        } else {
          // Inside rectangle - use distance to nearest edge to determine angle
          const distToRight = 100 - rectClickX;
          const distToLeft = rectClickX;
          const distToTop = rectClickY;
          const distToBottom = 100 - rectClickY;
          const minDist = Math.min(
            distToRight,
            distToLeft,
            distToTop,
            distToBottom,
          );

          if (minDist === distToRight) {
            // Closest to right edge
            perimeterPos =
              rectClickY <= 50
                ? ((50 - rectClickY) / 50) * (rectHeight / 2)
                : perimeter - ((rectClickY - 50) / 50) * (rectHeight / 2);
          } else if (minDist === distToTop) {
            // Closest to top edge
            perimeterPos =
              rectHeight / 2 + ((100 - rectClickX) / 100) * rectWidth;
          } else if (minDist === distToLeft) {
            // Closest to left edge
            perimeterPos =
              rectHeight / 2 + rectWidth + (rectClickY / 100) * rectHeight;
          } else {
            // Closest to bottom edge
            perimeterPos =
              rectHeight / 2 +
              rectWidth +
              rectHeight +
              (rectClickX / 100) * rectWidth;
          }
        }

        // Convert perimeter position to angle
        angle = (perimeterPos / perimeter) * 360;
        angle = ((angle % 360) + 360) % 360;
        break;

      case "square":
        // Handle square dragging using SAME perimeter logic as display
        const squareRelX = e.clientX - rect.left;
        const squareRelY = e.clientY - rect.top;

        // Convert click position to percentage within square
        const squareClickX = (squareRelX / rect.width) * 100;
        const squareClickY = (squareRelY / rect.height) * 100;

        // Map square position to angle using SAME perimeter logic as display
        // Square has 1:1 aspect ratio
        const squareWidth = 1;
        const squareHeight = 1;
        const squarePerimeter = 2 * (squareWidth + squareHeight); // Total perimeter = 4 units

        let squarePerimeterPos = 0;

        // Determine which edge and position on that edge
        if (squareClickX >= 85 && squareClickY <= 65) {
          // Right edge region - map Y position to perimeter
          if (squareClickY <= 50) {
            // Top half of right edge (0° to 45°)
            const progress = (50 - squareClickY) / 50;
            squarePerimeterPos = progress * (squareHeight / 2);
          } else {
            // Bottom half of right edge (315° to 360°)
            const progress = (squareClickY - 50) / 50;
            squarePerimeterPos =
              squarePerimeter - progress * (squareHeight / 2);
          }
        } else if (squareClickY <= 15) {
          // Top edge region - map X position to perimeter
          const progress = (100 - squareClickX) / 100;
          squarePerimeterPos = squareHeight / 2 + progress * squareWidth;
        } else if (squareClickX <= 15) {
          // Left edge region - map Y position to perimeter
          const progress = squareClickY / 100;
          squarePerimeterPos =
            squareHeight / 2 + squareWidth + progress * squareHeight;
        } else if (squareClickY >= 85) {
          // Bottom edge region - map X position to perimeter
          const progress = squareClickX / 100;
          squarePerimeterPos =
            squareHeight / 2 +
            squareWidth +
            squareHeight +
            progress * squareWidth;
        } else {
          // Inside square - use distance to nearest edge to determine angle
          const distToRight = 100 - squareClickX;
          const distToLeft = squareClickX;
          const distToTop = squareClickY;
          const distToBottom = 100 - squareClickY;
          const minDist = Math.min(
            distToRight,
            distToLeft,
            distToTop,
            distToBottom,
          );

          if (minDist === distToRight) {
            // Closest to right edge
            squarePerimeterPos =
              squareClickY <= 50
                ? ((50 - squareClickY) / 50) * (squareHeight / 2)
                : squarePerimeter -
                  ((squareClickY - 50) / 50) * (squareHeight / 2);
          } else if (minDist === distToTop) {
            // Closest to top edge
            squarePerimeterPos =
              squareHeight / 2 + ((100 - squareClickX) / 100) * squareWidth;
          } else if (minDist === distToLeft) {
            // Closest to left edge
            squarePerimeterPos =
              squareHeight / 2 +
              squareWidth +
              (squareClickY / 100) * squareHeight;
          } else {
            // Closest to bottom edge
            squarePerimeterPos =
              squareHeight / 2 +
              squareWidth +
              squareHeight +
              (squareClickX / 100) * squareWidth;
          }
        }

        // Convert perimeter position to angle
        angle = (squarePerimeterPos / squarePerimeter) * 360;
        angle = ((angle % 360) + 360) % 360;
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

    // Update visual elements directly for better performance
    if (style === "wheel") {
      this._updateWheelVisual(angle);
    } else if (style === "rect") {
      this._updateRectVisual(angle);
    } else if (style === "square") {
      this._updateSquareVisual(angle);
    } else if (style === "default") {
      // Use EXACT same logic as wheel for default mode
      this._updateWheelVisual(angle);
    }

    // Update gradient buttons during dragging for immediate visual feedback
    this._updateGradientButtons(angle);

    this._debouncedApplyAngle(angle);
  }

  _updateRotaryDisplay(angle) {
    const rotaryContainer = this.shadowRoot.querySelector(
      ".wheel-container, .rect-container, .default-container",
    );
    if (!rotaryContainer) return;

    const styleInfo = this._getRotaryStyleInfo();
    const style = styleInfo.style;

    switch (style) {
      case "wheel":
        this._updateWheelVisual(angle);
        break;

      case "rect":
        this._updateRectVisual(angle);
        break;

      case "square":
        this._updateSquareVisual(angle);
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
        break;
    }
  }

  _updateWheelVisual(angle) {
    const selectorRadians = (angle * Math.PI) / 180;

    // Use unified sizing method
    const sizePercent = this._getRotarySize();
    const selectorRadius = (sizePercent * 40) / 100; // Scale selector radius

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
  }

  _updateRectVisual(angle) {
    // EXACT same logic as wheel for consistency
    const normalizedAngle = ((angle % 360) + 360) % 360;

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
  }

  _updateSquareVisual(angle) {
    // EXACT same logic as rectangle but for 1:1 square
    const normalizedAngle = ((angle % 360) + 360) % 360;

    // Calculate position on square perimeter using continuous mapping
    // For 1:1 square: width = 1 unit, height = 1 unit
    const squareWidth = 1;
    const squareHeight = 1;
    const perimeter = 2 * (squareWidth + squareHeight); // Total perimeter = 4 units

    // Map angle (0-360°) to perimeter position (0 to perimeter)
    const perimeterPosition = (normalizedAngle / 360) * perimeter;

    let squareSelectorX, squareSelectorY;

    // Start from right edge center, go clockwise
    if (perimeterPosition <= squareHeight / 2) {
      // Right edge, top half (0° to 45°)
      squareSelectorX = 100;
      squareSelectorY = 50 - (perimeterPosition / (squareHeight / 2)) * 50;
    } else if (perimeterPosition <= squareHeight / 2 + squareWidth) {
      // Top edge (going from right to left) (45° to 135°)
      const topProgress = (perimeterPosition - squareHeight / 2) / squareWidth;
      squareSelectorX = 100 - topProgress * 100;
      squareSelectorY = 0;
    } else if (
      perimeterPosition <=
      squareHeight / 2 + squareWidth + squareHeight
    ) {
      // Left edge (going from top to bottom) (135° to 225°)
      const leftProgress =
        (perimeterPosition - squareHeight / 2 - squareWidth) / squareHeight;
      squareSelectorX = 0;
      squareSelectorY = leftProgress * 100;
    } else if (
      perimeterPosition <=
      squareHeight / 2 + squareWidth + squareHeight + squareWidth
    ) {
      // Bottom edge (going from left to right) (225° to 315°)
      const bottomProgress =
        (perimeterPosition - squareHeight / 2 - squareWidth - squareHeight) /
        squareWidth;
      squareSelectorX = bottomProgress * 100;
      squareSelectorY = 100;
    } else {
      // Right edge, bottom half (back to start) (315° to 360°)
      const rightBottomProgress =
        (perimeterPosition -
          squareHeight / 2 -
          squareWidth -
          squareHeight -
          squareWidth) /
        (squareHeight / 2);
      squareSelectorX = 100;
      squareSelectorY = 100 - rightBottomProgress * 50;
    }

    // Gradient rotation EXACT same as rectangle
    const gradientAngle = -normalizedAngle;

    // Update selector dot position using CSS positioning
    const squareSelectorDot = this.shadowRoot.querySelector(".square-selector");
    if (squareSelectorDot) {
      squareSelectorDot.style.left = `${squareSelectorX}%`;
      squareSelectorDot.style.top = `${squareSelectorY}%`;
    }

    // Update gradient background using CSS - SAME rotation as rectangle
    const squareElement = this.shadowRoot.querySelector(".square-gradient");
    if (squareElement) {
      const squareTextColors = this._getCurrentTextColors();
      const colorStops = squareTextColors
        .map((color) => `rgb(${color.join(",")})`)
        .join(", ");
      squareElement.style.background = `linear-gradient(${
        90 + gradientAngle
      }deg, ${colorStops})`;
    }

    // Update angle display
    const squareAngleDisplay = this.shadowRoot.querySelector(".square-angle");
    if (squareAngleDisplay) {
      squareAngleDisplay.textContent = `${Math.round(angle)}°`;
    }
  }

  _updateGradientButtons(angle) {
    // Update gradient buttons with new angle during dragging for immediate visual feedback
    const textColors = this._getCurrentTextColors();

    // Find "Angle Gradient" buttons and update their background
    const angleGradButtons = this.shadowRoot.querySelectorAll(
      '.mode-btn[data-mode="Angle Gradient"], .mode-btn-colorized[data-mode="Angle Gradient"]',
    );
    angleGradButtons.forEach((button) => {
      const gradientColors = this.getModeGradientColors(
        "Angle Gradient",
        textColors,
        angle,
      );
      // Use setProperty with important to override CSS
      button.style.setProperty("background", gradientColors, "important");
    });

    // Find "Letter Angle Gradient" buttons and update their background
    const letterAngleButtons = this.shadowRoot.querySelectorAll(
      '.mode-btn[data-mode="Letter Angle Gradient"], .mode-btn-colorized[data-mode="Letter Angle Gradient"]',
    );
    letterAngleButtons.forEach((button) => {
      const gradientColors = this.getModeGradientColors(
        "Letter Angle Gradient",
        textColors,
        angle,
      );
      // Use setProperty with important to override CSS
      button.style.setProperty("background", gradientColors, "important");
    });
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
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const angleDeg = -(currentAngle || 0) + 90;
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
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const letterAngleGrad = [];
        for (let i = 0; i < colors.length; i++) {
          letterAngleGrad.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        const letterAngle = -(currentAngle || 0) + 90;
        return `linear-gradient(${letterAngle}deg, ${letterAngleGrad.join(
          ", ",
        )})`;

      case "Text Color Sequence":
        // Random/shuffled colors - create discrete color blocks that fill the button
        if (colors.length === 1) return rgbToCss(colors[0]);

        // Create a checkerboard pattern of color squares using CSS patterns
        // Simple approach: create alternating color stripes in both directions

        // Pick 4 random colors for a 2x2 repeating pattern
        const patternColors = [];
        for (let i = 0; i < 4; i++) {
          const randomValue = deterministicRandom(i);
          const randomColorIndex = Math.floor(randomValue * colors.length);
          patternColors.push(colors[randomColorIndex]);
        }

        // Create horizontal stripes (rows)
        const verticalStripes = `repeating-linear-gradient(90deg, 
          ${rgbToCss(patternColors[2])} 0%, ${rgbToCss(patternColors[2])} 25%, 
          ${rgbToCss(patternColors[3])} 25%, ${rgbToCss(patternColors[3])} 50%,
          ${rgbToCss(patternColors[0])} 50%, ${rgbToCss(patternColors[0])} 75%,
          ${rgbToCss(patternColors[1])} 75%, ${rgbToCss(
            patternColors[1],
          )} 100%)`;

        // Combine both to create a grid effect
        return verticalStripes;

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
        // Custom rendering for Color Seq buttons - inline HTML dots
        function renderDotGrid(colors) {
          // Ensure every color appears at least once - use more dots to fill the button
          let dotColors = [];
          const numDots = 60; // More dots for better coverage
          if (colors.length >= numDots) {
            for (let i = 0; i < numDots; i++)
              dotColors.push(colors[i % colors.length]);
          } else {
            dotColors = colors.slice();
            let idx = 0;
            while (dotColors.length < numDots) {
              dotColors.push(colors[idx % colors.length]);
              idx++;
            }
          }
          // Shuffle deterministically based on palette
          for (let i = dotColors.length - 1; i > 0; i--) {
            const seed = colors.length * 7 + i;
            const j = seed % (i + 1);
            [dotColors[i], dotColors[j]] = [dotColors[j], dotColors[i]];
          }

          // Generate compact grid filling the entire button
          // 15 columns x 4 rows = 60 dots, tightly packed with no borders
          let dotsHtml =
            '<span style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">';

          // Optimized style: 9.25px dots for best visual balance
          const dotSize = 9.25;
          const spacingX = 6;
          const spacingY = 7.1;

          const buttonWidth = 90;
          const buttonHeight = 32;
          const numCols = 15;
          const numRows = 4;

          // Calculate exact grid height: (rows-1) * spacingY + dotSize
          // = 3 * 7.1 + 9.25 = 21.3 + 9.25 = 30.55px
          // Available height = 32px
          // Center with equal overflow, then adjust UP to balance visually
          const totalGridWidth = (numCols - 1) * spacingX + dotSize;
          const totalGridHeight = (numRows - 1) * spacingY + dotSize;

          const offsetX = (buttonWidth - totalGridWidth) / 2;
          const offsetY = (buttonHeight - totalGridHeight) / 2 - 0.5;

          for (let i = 0; i < numDots; i++) {
            const col = i % 15;
            const row = Math.floor(i / 15);
            const x = col * spacingX + offsetX;
            const y = row * spacingY + offsetY;
            dotsHtml += `<span style="position:absolute;left:${x}px;top:${y}px;width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dotColors[i]};"></span>`;
          }

          dotsHtml += "</span>";
          return { html: dotsHtml };
        }

        // Get text color preference from config (default: white)
        const buttonTextColor = this.config.button_text_color || "white";
        const isWhiteText = buttonTextColor === "white";
        const textColor = isWhiteText ? "white" : "#222";
        const textShadow = isWhiteText
          ? "1px 1px 2px rgba(0,0,0,0.8)"
          : "1px 1px 2px rgba(255,255,255,0.8)";
        const dotBgColor = isWhiteText
          ? "rgba(0,0,0,0.95)"
          : "rgba(255,255,255,0.95)";

        return `
          <div class="color-mode-colorized" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
            ${modes
              .map((mode, index) => {
                let buttonContent = mode.label;
                let buttonStyle = `background: ${this.getModeGradientColors(
                  mode.value,
                  textColors,
                  currentAngle,
                )}; color: ${textColor}; text-shadow: ${textShadow}; position:relative; overflow:hidden; min-width:90px; min-height:32px;`;
                let dotsHtml = "";
                if (mode.label.startsWith("Color Seq")) {
                  const dotGrid = renderDotGrid(textColors.map(rgbToCss));
                  dotsHtml = dotGrid.html;
                  buttonStyle = `background: ${dotBgColor}; color: ${textColor}; text-shadow: ${textShadow}; position:relative; overflow:hidden; min-width:90px; min-height:32px;`;
                }
                return `
              <button class="mode-btn-colorized ${
                colorMode === mode.value ? "active" : ""
              }" 
                      data-mode="${mode.value}"
                      title="${mode.label}"
                      style="${buttonStyle}" tabindex="0">
                ${dotsHtml}
                <span style="position:relative;z-index:1;display:inline-block;width:100%;text-align:center;">${buttonContent}</span>
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

      case "compact":
        return `
          <div class="color-mode-compact" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 3px; margin-bottom: 12px;">
            ${modes
              .map(
                (mode) => `
              <button class="mode-btn-compact ${
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

      case "pills":
        return `
          <div class="color-mode-pills" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
            ${modes
              .map(
                (mode) => `
              <button class="mode-btn-pill ${
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

  getCardSize() {
    return 4;
  }
}

customElements.define("yeelight-cube-gradient-card", YeelightCubeGradientCard);

if (typeof window !== "undefined") {
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "yeelight-cube-gradient-card",
    name: "Yeelight Gradient Card",
    description:
      "Control gradient settings for Yeelight Cube Lite matrix display",
    preview: true,
  });
}
