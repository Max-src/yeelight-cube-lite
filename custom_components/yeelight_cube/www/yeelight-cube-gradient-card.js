import { LitElement, html, unsafeCSS } from "./lib/lit-all.js";

import { resolvePreviewAppearance } from "./preview-appearance.js";

import { getTargetEntities } from "./service-call-utils.js";
import {
  CardCommandController,
  SUPERSEDED,
} from "./card-command-controller.js";

import { AngleCommandController } from "./angle-wheel-utils.js";

import {
  TEXT_SELECTOR_STYLES,
  PREVIEW_SELECTOR_STYLES,
  resolveSelectorButtonShape,
} from "./selector-shared-styles.js";

import { defineOnce, registerCustomCard } from "./card-registration.js";
import { createSliderDraft } from "./slider-control-utils.js";
import { bindHostEvents } from "./host-events.js";
import { AngleControlMixin } from "./gradient-angle-control.js";
import { ModeSelectorMixin } from "./gradient-mode-selector.js";
import { nothing } from "./lit-extras.js";
import { GRADIENT_CARD_CSS } from "./gradient-card-styles.js";

// Host methods the angle capsule markup may call (see bindHostEvents).
const CAPSULE_HANDLERS = new Set([
  "_startCapsuleDrag",
  "_endCapsuleDrag",
  "_handleCapsuleAngleInput",
  "_handleCapsuleWheel",
]);

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

// Mode visibility is config-based: `custom_visible_modes` (boolean) +
// `visible_modes` (ordered array) set from the editor's drag-drop list.
// The old localStorage + eye-overlay edit mode has been removed.

/** All gradient mode names, in display/iteration order. Exported so the
 * editor's visible-modes drag-drop list offers the same canonical set. */
export const GRADIENT_MODES = [
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

// ── Unified mode selector ──────────────────────────────────────────────────
// Historically the card had TWO ways to pick a gradient mode: a text-style
// selector (buttons/pills/dropdown/…) AND a clickable preview gallery.  They
// served the exact same purpose, so they are now ONE selector with a single
// `mode_selector_style` config key covering every presentation:
//   Text styles:    "filled" | "dropdown" | "chips"
//   Preview styles: "preview-list" | "preview-grid" | "preview-strip" |
//                   "preview-carousel" | "preview-wheel"
// Preview styles render live mini-matrix previews of every mode (click to
// apply); text styles are lightweight and skip ALL preview backend calls.
// Two appearance axes apply across EVERY style (shared design language with
// the other cards): `selector_shape` (square/rounded/round) and the size
// slider (`gallery_preview_size`, scales previews AND text buttons).
// TEXT_SELECTOR_STYLES / PREVIEW_SELECTOR_STYLES / resolveSelectorShape are
// shared with the clock card via ./selector-shared-styles.js.
// Legacy `preview_display_mode` values → unified style
const LEGACY_PREVIEW_STYLE_MAP = {
  inline: "preview-list",
  grid: "preview-list",
  gallery: "preview-list",
  list: "preview-list",
  compact: "preview-list",
  wheel: "preview-wheel",
};

// Legacy text-selector styles (buttons / pills / compact / colorized) are all
// merged into the single "filled" style.
const LEGACY_TEXT_STYLE_MAP = {
  buttons: "filled",
  pills: "filled",
  compact: "filled",
  colorized: "filled",
};

/**
 * Resolve the unified mode-selector style from a card config, migrating
 * legacy configs transparently.
 *
 * Legacy configs (pre-unification) ALWAYS showed the preview section — there
 * was no way to hide it — so they migrate to the matching preview style.
 * The old text selector (color_mode_style) remains available by explicitly
 * choosing a text style in the editor.
 */
function resolveModeSelectorStyle(cfg) {
  if (!cfg) return "preview-list";
  const explicit = cfg.mode_selector_style;
  if (explicit && LEGACY_TEXT_STYLE_MAP[explicit]) {
    return LEGACY_TEXT_STYLE_MAP[explicit];
  }
  if (
    explicit &&
    (TEXT_SELECTOR_STYLES.includes(explicit) ||
      PREVIEW_SELECTOR_STYLES.includes(explicit))
  ) {
    return explicit;
  }
  return LEGACY_PREVIEW_STYLE_MAP[cfg.preview_display_mode] || "preview-list";
}

class YeelightCubeGradientCard extends ModeSelectorMixin(AngleControlMixin(LitElement)) {
  // No reactive properties: rendering is driven explicitly by _renderCard()
  // (set hass fast path / skeleton key), which calls requestUpdate() only
  // when the card structure changes and syncs dynamic values in place
  // otherwise.
  static styles = unsafeCSS(GRADIENT_CARD_CSS);

  constructor() {
    super();
    // Every service call of this card (except the debounced angle, see
    // _angleCommands) goes through one ordered queue.
    this._commands = new CardCommandController();
    // The angle the user is setting, kept until the lamp reports it back so
    // re-renders during/after a drag never snap the controls to the old angle.
    this._angleDraft = createSliderDraft({
      tolerance: 1,
      isDragging: () =>
        !!(
          this._angleHeld ||
          this._usingSlider ||
          this._draggingRotary ||
          this._isDragging ||
          this._typingAngle
        ),
      onExpire: () => this._renderCard(),
    });
    // Passive delegated swipe listeners for the carousel preview (stable
    // objects so Lit never re-binds them across renders).
    this._previewTouchStartListener = {
      handleEvent: (e) => this._onPreviewTouchStart(e),
      passive: true,
    };
    this._previewTouchEndListener = {
      handleEvent: (e) => this._onPreviewTouchEnd(e),
      passive: true,
    };
    // Document-level drag handlers (attached only for an active rotary drag,
    // tracked in _rotaryDocListeners so they can never leak or stack).
    this._onDocMouseMove = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection during drag
        this._handleRotaryDrag(e);
      }
    };
    this._onDocTouchMove = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection
        this._handleRotaryDrag(e.touches[0]);
      }
    };
    this._onDocDragEnd = (e) => {
      // Always detach the document listeners, even if _draggingRotary was
      // reset elsewhere (e.g. setConfig mid-drag) — otherwise they leak.
      this._removeRotaryDocListeners();
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection

        // Cancel pending debounce and apply the final angle immediately
        if (this._pendingAngle !== null && this._pendingAngle !== undefined) {
          this._applyAngle(this._pendingAngle);
          this._lastAngleSent = this._pendingAngle;
        }

        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = null;
        this._flushPendingRender();
      }
    };
    // --- UI/interaction state ---
    this._pendingAngle = null;
    this._angleCommands = new AngleCommandController(
      (angle) => {
        this._lastAngleSent = angle;
        this._onAngleApplied();
      },
      (error) =>
        this.dispatchEvent(
          new CustomEvent("hass-notification", {
            bubbles: true,
            composed: true,
            detail: {
              message: error.message || "The angle could not be updated.",
            },
          }),
        ),
    );
    this._lastAngleSent = null;
    this._isDragging = false;
    this._draggingRotary = false;
    this._usingSlider = false;
    this._processingModeChange = false;
    this._dropdownOpen = false; // Prevent re-render when dropdown is open
    this._lastModeChangeTime = 0; // Track when mode was last changed
    this._optimisticMode = null; // Store the optimistic mode selection
    this._renderScheduled = false;
    this._pendingHassRender = false; // Track if a render was blocked by interaction flags
    this._interactionSafetyTimer = null; // Safety timer to flush pending renders
    this._previewEventListenerRegistered = false; // Track event listener for global preview cache
    this._cachedPreviewHtml = null; // Cache rendered preview HTML
    this._lastPreviewDataHash = null; // Track if preview data changed
    this._lastWheelMode = null; // Track wheel mode to prevent unnecessary syncs
    this._wheelCenterIndex = 0; // Track center item in wheel mode
    this._wheelNavigationController = null; // Controller for wheel navigation
    // All preview data is now stored in window._yeelightPreviewCaches (see top of file)
    // This ensures preview data persists across card destruction/recreation.
  }

  // --- Mode Visibility helpers (config-based) ---
  _isModeVisible(mode) {
    if (this.config?.custom_visible_modes !== true) return true;
    const list = this.config.visible_modes;
    return !Array.isArray(list) || !list.length || list.includes(mode);
  }

  /** Gradient mode names in display order, honoring the visible-modes config. */
  _orderedModes() {
    if (
      this.config?.custom_visible_modes === true &&
      Array.isArray(this.config.visible_modes) &&
      this.config.visible_modes.length
    ) {
      const picked = this.config.visible_modes.filter((m) =>
        GRADIENT_MODES.includes(m),
      );
      if (picked.length) return picked;
    }
    return GRADIENT_MODES;
  }

  // One call for all target lamps (the backend runs them in parallel), through
  // the card's command queue: sent in order, results from a previous
  // configuration dropped. Rejects on failure (HA has already shown it).
  // options.coalesce: see CardCommandController.execute.
  callServiceOnTargetEntities(serviceName, serviceData = {}, options = {}) {
    return this._commands.request(
      this._hass,
      this.config,
      serviceName,
      serviceData,
      options,
    );
  }

  connectedCallback() {
    super.connectedCallback();
    // The angle capsule names its handlers in data-on-* attributes.
    bindHostEvents(this, (name) => CAPSULE_HANDLERS.has(name));
    // Re-establish preview event subscription lost during disconnection.
    // disconnectedCallback unsubscribes, but the persistent _previewElement
    // survives, so the creation-time setTimeout that calls
    // _setupPreviewEventListener never runs again.  Re-subscribe here.
    if (!this._previewEventListenerRegistered && this._hass) {
      this._setupPreviewEventListener();
    }

    // After reconnection, the wheel controller was destroyed in disconnectedCallback.
    // We must re-initialize it once the DOM is ready again.
    if (
      this._isPreviewSelectorActive?.() &&
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
    super.disconnectedCallback();
    if (this._angleRelease) {
      for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
        document.removeEventListener(type, this._angleRelease, true);
      this._angleRelease = null;
      this._angleHeld = false;
    }
    this._angleCommands.reset();
    this._previewContext = (this._previewContext || 0) + 1;
    // Clean up wheel navigation controller
    if (this._wheelNavigationController) {
      this._wheelNavigationController.destroy();
      this._wheelNavigationController = null;
    }
    // Unsubscribe from preview events
    if (this._unsubscribePreviewEvents) {
      this._unsubscribePreviewEvents();
      this._unsubscribePreviewEvents = null;
    }
    this._previewEventListenerRegistered = false;

    // Clear pending timers
    if (this._previewReloadTimer) {
      clearTimeout(this._previewReloadTimer);
      this._previewReloadTimer = null;
    }
    if (this._panelModeTimeout) {
      clearTimeout(this._panelModeTimeout);
      this._panelModeTimeout = null;
    }
    if (this._fillPanelTimeout) {
      clearTimeout(this._fillPanelTimeout);
      this._fillPanelTimeout = null;
    }
    if (this._anglePreviewReloadTimer) {
      clearTimeout(this._anglePreviewReloadTimer);
      this._anglePreviewReloadTimer = null;
    }
    if (this._previewRetryTimer) {
      clearTimeout(this._previewRetryTimer);
      this._previewRetryTimer = null;
    }
    if (this._optimisticModeTimeout) {
      clearTimeout(this._optimisticModeTimeout);
      this._optimisticModeTimeout = null;
    }
    if (this._carouselNavTimer) {
      clearTimeout(this._carouselNavTimer);
      this._carouselNavTimer = null;
    }

    // Reset interaction flags and cleanup safety timer
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }

    // Detach any document-level rotary drag listeners left from an
    // in-progress drag.
    this._removeRotaryDocListeners();
    this._draggingRotary = false;
  }

  setConfig(config) {
    config = resolvePreviewAppearance(config, "gradient");
    this._angleCommands.reset();
    this._commands?.reset();
    this._pendingAngle = null;
    this._removeRotaryDocListeners();
    this._draggingRotary = false;
    clearTimeout(this._anglePreviewReloadTimer);
    clearTimeout(this._previewRetryTimer);
    clearTimeout(this._previewReloadTimer);
    this._unsubscribePreviewEvents?.();
    this._unsubscribePreviewEvents = null;
    this._previewEventListenerRegistered = false;
    this._previewContext = (this._previewContext || 0) + 1;
    // Check if wheel-affecting settings changed
    // Skip change detection on first init — this.config is undefined so every
    // comparison fires as "changed", causing a wasteful teardown/rebuild cycle
    // that races with preview loading and leaves a no-op wheel controller.

    // Structural changes require full preview element rebuild.
    // Compare the RESOLVED selector styles so legacy-key changes and
    // text↔preview switches are detected uniformly.
    const wheelStructureChanged = this.config
      ? resolveModeSelectorStyle(this.config) !==
          resolveModeSelectorStyle(config) ||
        this.config.wheel_nav_position !== config?.wheel_nav_position ||
        this.config.preview_show_titles !== config?.preview_show_titles
      : false;

    // Height-only changes can be handled with an in-place content refresh
    // (avoids destroy/recreate race condition when slider is dragged rapidly)
    const wheelHeightChanged = this.config
      ? this.config.wheel_height !== config?.wheel_height
      : false;

    if (wheelStructureChanged) {
      // Full rebuild: display mode, nav position, or titles changed
      if (this._wheelNavigationController) {
        this._wheelNavigationController.destroy();
        this._wheelNavigationController = null;
      }
      this._lastPreviewDataHash = null;
      this._cachedPreviewHtml = null;
      // Re-anchor the carousel on the active mode after a style switch
      this._carouselIndex = null;
      if (this._previewElement) {
        this._previewElement = null;
      }
    } else if (wheelHeightChanged) {
      // Height-only change: keep preview element alive, refresh content in-place
      if (this._wheelNavigationController) {
        this._wheelNavigationController.destroy();
        this._wheelNavigationController = null;
      }
      this._lastPreviewDataHash = null;
      this._cachedPreviewHtml = null;
      this._pendingWheelHeightUpdate = true;
    }

    this.config = config;
    this._setupPreviewEventListener();

    // Always render when setConfig is called (config changed in editor)
    // But we'll preserve the preview element across renders
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this._renderCard();
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
    const allEntities = Object.keys(hass?.states || {}).filter(
      (e) =>
        e.startsWith("light.yeelight_cube") || e.startsWith("light.cubelite_"),
    );
    const firstEntity = allEntities[0] || "";
    return {
      type: "custom:yeelight-cube-gradient-card",
      entity: firstEntity,
      target_entities: allEntities.length > 0 ? allEntities : [],
      mode_selector_style: "preview-wheel",
      selector_shape: "rounded",
      show_mode_selector: true,
      show_panel_toggle: true,
      show_active_mode_label: false,
      rotary_unified_style: "rectangle",
      show_angle_section: true,
      angle_value_display: "none",
      show_angle_slider: false,
      panel_toggle_style: "minimal",
      rotary_size: "100",
      gallery_background_color: "transparent",
      wheel_nav_position: "sides",
      preview_show_titles: false,
      gallery_pixel_style: "circle",
      gallery_ignore_black_pixels: true,
      gallery_preview_size: "64",
      gallery_spacing_mode: "normal",
      rectangle_shape: "rectangle",
      show_selector_dot: true,
      compass_snap_to_coordinates: false,
      wheel_height: "195",
      gallery_matrix_box_shadow: false,
      show_card_background: true,
    };
  }

  set hass(hass) {
    if (this._hass?.connection !== hass?.connection) {
      this._unsubscribePreviewEvents?.();
      this._unsubscribePreviewEvents = null;
      this._previewEventListenerRegistered = false;
      this._previewContext = (this._previewContext || 0) + 1;
    }
    this._hass = hass;

    // Re-establish preview event subscription if lost (connectedCallback may
    // fire before hass is available, so this is a belt-and-suspenders guard).
    if (!this._previewEventListenerRegistered && hass) {
      this._setupPreviewEventListener();
    }

    // Fast path: HA calls this setter for every state change anywhere in the
    // instance, but only replaces the state object of the entity that changed.
    // If our primary entity's state object is the same reference we fully
    // processed last time (same config, no optimistic flag waiting for a
    // backend echo, wheel already synced to this mode), everything below would
    // be a no-op, so skip it.
    if (this.config && this._seenConfig === this.config) {
      const seenId = this._getPrimaryEntity();
      const seenState = seenId ? hass?.states?.[seenId] : undefined;
      if (
        seenState &&
        seenId === this._seenEntityId &&
        seenState === this._seenStateObj &&
        this._optimisticMode == null &&
        this._optimisticPanelMode === undefined &&
        this._optimisticFillCols === undefined &&
        (this._getDisplayMode() !== "wheel" ||
          this._lastWheelMode === seenState.attributes?.mode)
      ) {
        return;
      }
    }

    // Track entity state changes to auto-reload gallery previews (debounced)
    // Only relevant when a preview-style selector is shown — text selectors
    // never call the preview service.
    const entityId = this._getPrimaryEntity();
    if (
      hass &&
      entityId &&
      this._isPreviewSelectorActive() &&
      // Same state object as the last check => all derived values are equal.
      (!hass.states[entityId] ||
        hass.states[entityId] !== this._lastPreviewStateObj)
    ) {
      const stateObj = hass.states[entityId];
      this._lastPreviewStateObj = stateObj;
      const currentText = stateObj?.attributes?.custom_text;
      const currentAngle = stateObj?.attributes?.angle;
      const currentColors = stateObj?.attributes?.text_colors;
      const currentPanelMode = stateObj?.attributes?.full_panel || false;
      // Only re-stringify when the array reference changed.
      let colorsHash = this._lastPreviewColors;
      if (
        currentColors === undefined ||
        currentColors !== this._lastPreviewColorsRef
      ) {
        colorsHash = currentColors ? JSON.stringify(currentColors) : null;
        this._lastPreviewColorsRef = currentColors;
      }
      // Also watch matrix_colors: in "Panel Color Sequence" mode the palette
      // paints the panel directly, so the rendered output (matrix_colors) can
      // change without text_colors differing.  Watching it here keeps the
      // preview in sync with the actual lamp output in every mode.
      const currentMatrixColors = stateObj?.attributes?.matrix_colors;
      let matrixColorsHash = this._lastPreviewMatrixColors;
      if (
        currentMatrixColors === undefined ||
        currentMatrixColors !== this._lastPreviewMatrixColorsRef
      ) {
        matrixColorsHash = currentMatrixColors
          ? JSON.stringify(currentMatrixColors)
          : null;
        this._lastPreviewMatrixColorsRef = currentMatrixColors;
      }
      if (
        this._lastPreviewText !== currentText ||
        this._lastPreviewAngle !== currentAngle ||
        this._lastPreviewColors !== colorsHash ||
        this._lastPreviewMatrixColors !== matrixColorsHash ||
        this._lastPreviewPanelMode !== currentPanelMode
      ) {
        this._lastPreviewText = currentText;
        this._lastPreviewAngle = currentAngle;
        this._lastPreviewColors = colorsHash;
        this._lastPreviewMatrixColors = matrixColorsHash;
        this._lastPreviewPanelMode = currentPanelMode;
        // Debounce preview reload to avoid flickering on rapid updates
        // (gallery thumbnails still use the preview cache)
        if (this._previewReloadTimer) clearTimeout(this._previewReloadTimer);
        this._previewReloadTimer = setTimeout(() => {
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
    if (!this.config) {
      return;
    }

    // Use the primary entity (first target_entity, or fallback to config.entity)
    const _primaryEntityId = this._getPrimaryEntity();
    if (!_primaryEntityId) {
      return;
    }

    // Check if the entities we care about actually changed
    const entity = this._hass.states[_primaryEntityId];
    if (!entity) {
      // Entity no longer exists in HA — force a render to show the error state
      this._previousHass = hass;
      this._renderCard();
      return;
    }
    const oldEntity = this._previousHass
      ? this._previousHass.states[_primaryEntityId]
      : null;

    // Only render if attributes that actually affect the card UI changed.
    // HA keeps the same state object for entities that did not change, but
    // replaces THIS entity's state object on ANY of its attribute updates
    // (brightness, etc.), so `entity !== oldEntity` alone would trigger
    // spurious full-DOM rebuilds that destroy & recreate the capsule slider,
    // causing the visible "blink" (thumb jumps to 0 then animates back).
    // Compare only the attributes the card actually reads during render().
    // NOTE: when this entity's state object is replaced, its attribute arrays
    // (text_colors/matrix_colors) are new references even if the values are
    // unchanged, so fall back to a JSON comparison when the reference differs.
    const entityChanged =
      !oldEntity ||
      (entity !== oldEntity &&
      (() => {
        if (entity.state !== oldEntity.state) return true;
        const a = entity.attributes;
        const b = oldEntity.attributes;
        if (
          a.angle !== b.angle ||
          a.mode !== b.mode ||
          a.full_panel !== b.full_panel ||
          a.custom_text !== b.custom_text
        )
          return true;
        // Deep-compare arrays only when the reference changed
        if (
          a.text_colors !== b.text_colors &&
          JSON.stringify(a.text_colors) !== JSON.stringify(b.text_colors)
        )
          return true;
        if (
          a.matrix_colors !== b.matrix_colors &&
          JSON.stringify(a.matrix_colors) !== JSON.stringify(b.matrix_colors)
        )
          return true;
        return false;
      })());

    // --- Optimistic Panel Mode: clear only when backend matches ---
    if (this._optimisticPanelMode !== undefined && entity) {
      const backendPanelMode = entity.attributes.full_panel || false;
      if (backendPanelMode === this._optimisticPanelMode) {
        this._optimisticPanelMode = undefined;
      }
    }

    // --- Optimistic Mode: clear only when backend echoes the new mode ---
    // (prevents the highlight snapping back to the old mode between service
    // completion and the entity state echo — see _selectMode)
    if (this._optimisticMode && entity) {
      if (entity.attributes.mode === this._optimisticMode) {
        this._optimisticMode = null;
        if (this._optimisticModeTimeout) {
          clearTimeout(this._optimisticModeTimeout);
          this._optimisticModeTimeout = null;
        }
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
    // Remember what was fully processed (used by the fast path above)
    this._seenConfig = this.config;
    this._seenEntityId = _primaryEntityId;
    this._seenStateObj = entity;

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
      !this._typingAngle &&
      timeSinceLastModeChange > ignoreUpdateWindow
    ) {
      this._pendingHassRender = false;
      if (!this._renderScheduled) {
        this._renderScheduled = true;
        requestAnimationFrame(() => {
          this._renderScheduled = false;
          this._renderCard();
        });
      }
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
      this._draggingRotary ||
      this._isDragging ||
      this._usingSlider ||
      this._dropdownOpen ||
      this._typingAngle
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
        this._renderCard();
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
        !this._draggingRotary &&
        !this._isDragging &&
        !this._usingSlider &&
        !this._dropdownOpen &&
        !this._typingAngle
      ) {
        clearInterval(this._interactionSafetyTimer);
        this._interactionSafetyTimer = null;
        this._flushPendingRender();
      }
    }, 1000);
  }

  /**
   * Imperative render entry point (called from set hass / setConfig /
   * interaction handlers).  Chooses between the surgical in-place sync
   * (structure unchanged) and a Lit re-render of the card skeleton.
   */
  _renderCard() {
    // Only block render if actively dragging/interacting with angle controls to prevent interference
    if (
      this._draggingRotary ||
      this._isDragging ||
      this._usingSlider ||
      this._typingAngle
    )
      return;

    const hass = this._hass;
    if (!hass) return;

    // Support both old single entity config and new multi-entity config
    const primaryEntity = this._getPrimaryEntity();
    const stateObj = primaryEntity ? hass.states[primaryEntity] : null;

    if (!primaryEntity || !stateObj) {
      const entityCount = (this.config.target_entities || []).length;
      this._errorMessage =
        entityCount === 0
          ? "No entities configured"
          : `Primary entity (${String(primaryEntity)}) not found`;
      this._skeletonKey = null; // force full rebuild when the entity recovers
      this.requestUpdate();
      return;
    }
    this._errorMessage = null;
    const textColors = this._pendingColors ||
      stateObj.attributes.text_colors || [[255, 255, 255]];

    // Current angle: the in-flight value while the lamp catches up.
    const currentAngle = this._displayAngle(stateObj);

    // ── SURGICAL RENDER FAST PATH ──────────────────────────────────────
    // The skeleton is (re)rendered through Lit ONCE per structural
    // configuration (config + text colors, which are baked into
    // rotary/button gradients); afterwards every call only syncs dynamic
    // values in place, which keeps state updates flicker-free.
    const structuralKey = JSON.stringify({
      cfg: this.config,
      colors: textColors,
    });
    if (
      this._skeletonKey === structuralKey &&
      this.shadowRoot?.querySelector(".card-content")
    ) {
      this._syncDynamicUI(stateObj, currentAngle);
      return;
    }
    this._skeletonKey = structuralKey;

    // For text-style selectors tear down the preview machinery (wheel
    // controller, cached preview HTML); the Lit template drops the host.
    if (!this._isPreviewSelectorActive()) {
      if (this._wheelNavigationController) {
        this._wheelNavigationController.destroy();
        this._wheelNavigationController = null;
      }
      if (this._previewElement) {
        this._previewElement = null;
        this._cachedPreviewHtml = null;
        this._lastPreviewDataHash = null;
      }
    }

    this._rebuildPending = true;
    this.requestUpdate();
  }

  render() {
    if (this._errorMessage != null) {
      return html`<ha-card><div style="padding: 16px;">${this._errorMessage}</div></ha-card>`;
    }
    const hass = this._hass;
    if (!hass || !this.config || this._skeletonKey == null) return nothing;
    const stateObj = hass.states[this._getPrimaryEntity()];
    if (!stateObj) return nothing;

    const textColors = this._pendingColors ||
      stateObj.attributes.text_colors || [[255, 255, 255]];
    const currentAngle = this._displayAngle(stateObj);

    const showCard = this.config.show_card_background !== false;
    // Unified mode selector (replaces the old separate color-mode selector +
    // always-on preview section — they served the same purpose).
    const selectorStyle = this._getModeSelectorStyle();
    const isPreviewSelector = PREVIEW_SELECTOR_STYLES.includes(selectorStyle);
    const showModeSelector =
      this.config.show_mode_selector !== undefined
        ? this.config.show_mode_selector !== false
        : true;
    // Panel toggle is independent of the selector now.  Legacy fallback: it
    // used to live inside the text selector block, so respect the old
    // show_color_mode_selector=false as "hide panel toggle" for old configs.
    const showPanelToggle =
      this.config.show_panel_toggle !== undefined
        ? this.config.show_panel_toggle !== false
        : this.config.show_color_mode_selector !== false;
    const showAngleSection = this.config.show_angle_section !== false;
    const showAngleSlider = this.config.show_angle_slider !== false;

    const cardTitle =
      typeof this.config.title === "string" ? this.config.title.trim() : "";

    // Get current lamp state for runtime controls
    const colorMode = this._getCurrentMode() || "Solid Color";
    // Use optimistic panel mode if set, else backend state
    const applyToWholePanel =
      this._optimisticPanelMode !== undefined
        ? this._optimisticPanelMode
        : stateObj.attributes.full_panel || false;
    // Fill panel column selector: detect active column count from custom_text
    const currentCustomText = stateObj.attributes.custom_text || "";
    const fillPanelCols =
      this._optimisticFillCols !== undefined
        ? this._optimisticFillCols
        : FILL_PANEL_CHAR_TO_COLS[currentCustomText] || 0;

    // Get panel toggle style + shape + alignment from config
    const panelToggleStyle = this.config.panel_toggle_style || "minimal";
    const panelToggleShape = this.config.panel_toggle_shape || "round";
    const labelAlign = this.config.active_mode_label_align || "left";
    const panelToggleAlign = this.config.panel_toggle_align || "left";
    const _alignToJustify = (a) =>
      a === "center" ? "center" : a === "right" ? "flex-end" : "flex-start";

    // Check if rotary should be in header
    const rotaryInHeader = this.config.rotary_in_header === true;
    const showActiveModeLabel = this.config.show_active_mode_label === true;

    const cardContent = html`
      <div class="yc-stack" style="padding:16px;">
        ${!showCard && cardTitle ? html`<div style="font-weight:600;font-size:1.1em;">${cardTitle}</div>` : nothing}
        ${
          rotaryInHeader && showAngleSection
            ? html`
          <div class="card-header" style="display: flex; justify-content: flex-end; align-items: center;">
            <div class="header-rotary"
              @mousedown=${this._onAngleAreaMouseDown}
              @touchstart=${this._onAngleAreaTouchStart}
              @focusin=${this._onAngleAreaFocusIn}
              @focusout=${this._onAngleAreaFocusOut}
              @input=${this._onAngleAreaInput}
              @keydown=${this._onAngleAreaKeyDown}
              @change=${this._onAngleAreaChange}
              @mouseout=${this._onAngleAreaMouseOut}
            >${this._angleRotaryTemplate(currentAngle, true)}</div>
          </div>
        `
            : nothing
        }
        ${
          showModeSelector || showPanelToggle
            ? html`
        <!-- Runtime Controls: unified mode selector -->
        <div class="runtime-controls" ?hidden=${!(showActiveModeLabel || (showModeSelector && !isPreviewSelector))}>
          <div class="control-section yc-stack yc-controls">
            ${
              showActiveModeLabel
                ? html`<div style="display:flex;justify-content:${_alignToJustify(labelAlign)};width:100%;">
                     <div class="gc-active-mode-label" id="gc-active-mode-label" title="Currently active mode" style="margin:0;">
                       <span class="gc-aml-dot"></span>
                       <span class="gc-aml-text">${colorMode}</span>
                     </div>
                   </div>`
                : nothing
            }
            ${
              showModeSelector && !isPreviewSelector
                ? this.generateColorModeSelector(
                    colorMode,
                    selectorStyle,
                    textColors,
                    this._draggingRotary && this._pendingAngle !== undefined
                      ? this._pendingAngle
                      : currentAngle,
                  )
                : nothing
            }
          </div>
        </div>
        ${showModeSelector && isPreviewSelector ? this._previewHostTemplate() : nothing}
        <div id="preview-anchor" style="display:none;"></div>
        ${
          showPanelToggle
            ? html`
        <div class="panel-section-wrapper yc-row" style=${panelToggleStyle !== "card" && panelToggleStyle !== "tabs" ? `justify-content:${_alignToJustify(panelToggleAlign)};` : ""}>
          ${this._renderPanelToggle(applyToWholePanel, panelToggleStyle, panelToggleShape)}
          <div class="panel-toggle default" style="margin-top: 4px; display: none; align-items: center; gap: 8px;">
            <label for="fill-panel-cols" style="white-space: nowrap;">Fill Panel Test:</label>
            <select id="fill-panel-cols" style="flex: 1; padding: 4px;" @change=${this._onFillPanelChange}>
              <option value="0" ?selected=${fillPanelCols === 0}>Off</option>
              ${Array.from({ length: 20 }, (_, i) => i + 1).map(
                (n) =>
                  html`<option value=${n} ?selected=${fillPanelCols === n}>${n} col${n > 1 ? "s" : ""} (${n * 5} px)</option>`,
              )}
            </select>
          </div>
        </div>`
            : nothing
        }
        `
            : nothing
        }
        ${
          showAngleSection
            ? html`
        <div class="angle-section">
          <div class="angle-row"
            @mousedown=${this._onAngleAreaMouseDown}
            @touchstart=${this._onAngleAreaTouchStart}
            @focusin=${this._onAngleAreaFocusIn}
            @focusout=${this._onAngleAreaFocusOut}
            @input=${this._onAngleAreaInput}
            @keydown=${this._onAngleAreaKeyDown}
            @change=${this._onAngleAreaChange}
            @mouseout=${this._onAngleAreaMouseOut}
          >
            ${
              showAngleSlider && this._getRotaryStyleInfo().style !== "capsule"
                ? html`
              <input id="angleslider" class="angle-slider" type="range" min="0" max="359" step="1" value=${Math.round(currentAngle)}
                @mousedown=${this._onAngleSliderPress}
                @touchstart=${this._onAngleSliderPress}
                @input=${this._onAngleSliderInput}
                @mouseup=${this._onAngleSliderRelease}
                @touchend=${this._onAngleSliderRelease}
                @touchcancel=${this._onAngleSliderRelease}
                @mouseleave=${this._onAngleSliderLeave} />
            `
                : nothing
            }
            ${!rotaryInHeader ? this._angleRotaryTemplate(currentAngle) : nothing}
          </div>
        </div>
        `
            : nothing
        }
      </div>
    `;

    return showCard
      ? html`<ha-card header=${cardTitle || nothing}><div class="card-content">${cardContent}</div></ha-card>`
      : html`<div class="card-content">${cardContent}</div>`;
  }

  /**
   * Lit-rendered persistent host for the preview-style mode selector.  Its
   * `.preview-grid-container` content is shared-renderer HTML (gallery /
   * carousel / wheel / pagination) that the card updates in place
   * (surgical per-item swaps, wheel controller), so Lit renders the
   * container without child bindings and all item interactions are
   * delegated from the host.
   */
  _previewHostTemplate() {
    return html`<div class="yc-stack yc-controls" id="gc-preview-host"
      @click=${this._onPreviewClick}
      @touchstart=${this._previewTouchStartListener}
      @touchend=${this._previewTouchEndListener}
    ><div id="preview-section-container"><div class="preview-section yc-stack yc-controls"><div class="preview-grid-container" style="max-width: 100%; overflow: visible;"></div></div></div></div>`;
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (!this._rebuildPending || this._errorMessage != null) return;
    if (!this.shadowRoot?.querySelector(".card-content")) return;
    this._rebuildPending = false;
    this._afterRebuild();
  }

  /** Post-render work after the card skeleton was (re)rendered by Lit. */
  _afterRebuild() {
    const root = this.shadowRoot;
    const stateObj = this._hass?.states?.[this._getPrimaryEntity()];
    if (!root || !stateObj) return;
    const currentAngle = this._displayAngle(stateObj);

    const host = root.getElementById("gc-preview-host");
    if (host) {
      if (host !== this._previewElement) {
        // New host (first render, preview-structure change reset by
        // setConfig, or recovery from the error state): fill it from the
        // global preview cache and (re)load previews.
        if (this._wheelNavigationController) {
          this._wheelNavigationController.destroy();
          this._wheelNavigationController = null;
        }
        this._previewElement = host;
        const container = host.querySelector(".preview-grid-container");
        container.innerHTML = this._getCachedPreviewGrid();

        setTimeout(() => {
          if (!this._previewEventListenerRegistered) {
            this._setupPreviewEventListener();
          }
          // Only load previews if we don't have recent data in global cache
          const cache = this._previewCache();
          const timeSinceLastRequest = Date.now() - cache.timestamp;
          const hasRecentData = cache.data && timeSinceLastRequest < 5000; // 5 seconds

          if (!hasRecentData) {
            this._loadPreviews();
          } else {
            // Immediately render with cached data
            this._updatePreviewSection();
          }
        }, 100);
      }

      // Refresh preview content from latest global cache.  This catches
      // updates whose event-based _updatePreviewSection() ran before the
      // host existed.
      this._updatePreviewSection();

      // Handle pending wheel height update (host kept alive, container
      // content needs refresh with new height)
      if (this._pendingWheelHeightUpdate) {
        this._pendingWheelHeightUpdate = false;
        const container = host.querySelector(".preview-grid-container");
        if (container) {
          const newPreviewHtml = this._renderPreviewGrid();
          // Always keep overflow visible — hover highlights (border +
          // translate/scale transforms) were clipped by overflow:hidden.
          container.style.overflow = "visible";
          container.innerHTML = newPreviewHtml;
          this._cachedPreviewHtml = newPreviewHtml;
          // Sync the preview-data hash so _getCachedPreviewGrid won't
          // regenerate with stale values on the next call
          this._lastPreviewDataHash = this._previewCache().data
            ? JSON.stringify({
                text: this._previewCache().data.text,
                angle: Math.round(this._previewCache().data.angle * 10) / 10,
                bgColor: this.config.gallery_background_color,
                pixelStyle: this.config.gallery_pixel_style,
                pixelGap:
                  this.config.gallery_spacing_mode ||
                  this.config.gallery_pixel_spacing,
                previewSize: this.config.gallery_preview_size,
                ignoreBlack: this.config.gallery_ignore_black_pixels,
                matrixShadow: this.config.gallery_matrix_box_shadow,
                displayMode: this._getModeSelectorStyle(),
                showTitles: this.config.preview_show_titles,
                visibleModes: JSON.stringify(
                  this.config.custom_visible_modes === true
                    ? this.config.visible_modes || null
                    : null,
                ),
                buttonShape: resolveSelectorButtonShape(this.config),
                itemsPerPage: this.config.items_per_page || 0,
                selectorPage: this._selectorPage || 0,
                wheelHeight: this.config.wheel_height,
                wheelNavPosition: this.config.wheel_nav_position,
              })
            : null;
          // Use immediate mode for wheel re-init (skip double-rAF delay)
          this._wheelReInitializing = true;
          // Re-initialise the wheel controller for the new content
          this._attachPreviewEventListeners();
        }
      }

      // Safety net: ensure the wheel controller is alive in wheel display
      // mode (fixes disconnect/reconnect)
      if (
        this._getDisplayMode() === "wheel" &&
        !this._wheelNavigationController
      ) {
        const wheelExists = host.querySelector(
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
    }

    // Update active-mode highlight on the preview items
    this._markActiveMode();

    // Re-apply every dynamic value in place: Lit only patches bindings whose
    // template value changed, so DOM state written by the in-place sync
    // path (classes, input values, rotary visuals) is reconciled here.
    this._syncDynamicUI(stateObj, currentAngle);
  }

  /**
   * In-place update of every dynamic UI element.  Called instead of a full
   * DOM rebuild when the structural configuration is unchanged — this is
   * what makes state updates flicker-free.
   */
  _syncDynamicUI(stateObj, currentAngle) {
    const root = this.shadowRoot;
    if (!root) return;

    // 1. Text-style selector: active button / dropdown value
    this._syncTextSelector();

    // 2. Panel toggle state (checkbox + card-style active class)
    const applyToPanel =
      this._optimisticPanelMode !== undefined
        ? this._optimisticPanelMode
        : stateObj.attributes.full_panel || false;
    const panelCheckbox = root.getElementById("apply-to-panel");
    if (panelCheckbox && panelCheckbox.checked !== applyToPanel) {
      panelCheckbox.checked = applyToPanel;
    }
    const cardToggle = root.querySelector(
      ".panel-toggle.card[data-toggle-card='true']",
    );
    if (cardToggle) cardToggle.classList.toggle("active", applyToPanel);
    const tabsEl = root.querySelector(".panel-toggle.tabs");
    if (tabsEl) {
      tabsEl.dataset.active = applyToPanel ? "1" : "0";
      tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle(
          "active",
          (btn.dataset.panelSeg === "true") === applyToPanel,
        );
      });
    }
    const chipEl = root.querySelector(
      ".panel-toggle.chip[data-chip-toggle='true']",
    );
    if (chipEl) chipEl.classList.toggle("active", applyToPanel);
    const minimalEl = root.querySelector(
      ".panel-toggle.minimal[data-minimal-toggle='true']",
    );
    if (minimalEl) minimalEl.classList.toggle("active", applyToPanel);

    // 3. Fill-panel column selector value
    const fillSel = root.getElementById("fill-panel-cols");
    if (fillSel) {
      const cols =
        this._optimisticFillCols !== undefined
          ? this._optimisticFillCols
          : FILL_PANEL_CHAR_TO_COLS[stateObj.attributes.custom_text || ""] || 0;
      if (fillSel.value !== String(cols)) fillSel.value = String(cols);
    }

    // 4. Angle visuals (rotary/capsule/slider/value displays).
    //    render() already returns early during active drags, so this never
    //    fights the user's pointer.
    this._updateRotaryDisplay(currentAngle);
    this._syncAngleValueDisplay(currentAngle);
    const angleSlider = root.getElementById("angleslider");
    if (angleSlider) angleSlider.value = Math.round(currentAngle);
    this._updateGradientButtons(currentAngle);

    // 5. Preview section: highlight + content refresh from cache.
    //    _updatePreviewSection string-compares against the last HTML we set,
    //    so this is a no-op unless preview data actually changed.
    this._markActiveMode();
    this._updatePreviewSection();
  }

  /**
   * Sync the text-style mode selector (active classes / dropdown value)
   * to the current mode without rebuilding DOM.
   */
  _syncTextSelector() {
    const root = this.shadowRoot;
    if (!root) return;
    const mode = this._getCurrentMode() || "Solid Color";
    root.querySelectorAll(".mode-btn-filled, .mode-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    const dropdown = root.querySelector(".mode-select");
    if (dropdown && !this._dropdownOpen && dropdown.value !== mode) {
      dropdown.value = mode;
    }
  }

  // ── Declarative event handlers (bound in the Lit templates) ─────────────

  /** Text selector (filled buttons / chips) click. */
  _onModeButtonClick(e) {
    const root = this.shadowRoot;
    if (!root) return;
    const target = e.currentTarget;
    // Use currentTarget to get the button, not the clicked child element
    const mode = target.dataset.mode;
    if (!this._hass || !this._getPrimaryEntity() || this._processingModeChange)
      return;

    const modeSelectors = [
      ...root.querySelectorAll(".mode-btn-filled"),
      ...root.querySelectorAll(".mode-chip"),
    ];

    // OPTIMISTIC UI UPDATE - immediately show selection
    modeSelectors.forEach((button) => {
      button.classList.remove("active");
    });
    target.classList.add("active");

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
  }

  // Dropdown selector: prevent re-render while the dropdown is open
  _onModeDropdownFocus() {
    this._dropdownOpen = true;
  }

  _onModeDropdownBlur() {
    this._dropdownOpen = false;
    this._flushPendingRender();
  }

  _onModeDropdownChange(e) {
    const modeDropdown = e.currentTarget;
    this._dropdownOpen = false; // Close flag when selection made
    this._flushPendingRender();
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
  }

  /** "Apply to Whole Panel" checkbox change (every toggle style). */
  _onPanelCheckboxChange(e) {
    const panelCheckbox = e.currentTarget;
    if (!this._hass || !this._getPrimaryEntity()) return;
    const applyToPanel = panelCheckbox.checked;

    // Optimistically update UI (show new value immediately)
    this._optimisticPanelMode = applyToPanel;
    // Safety timeout: clear optimistic state if backend doesn't confirm within 5s
    if (this._panelModeTimeout) clearTimeout(this._panelModeTimeout);
    this._panelModeTimeout = setTimeout(() => {
      if (this._optimisticPanelMode !== undefined) {
        this._optimisticPanelMode = undefined;
        this._renderCard();
      }
    }, 5000);
    this._renderCard();

    // Disable checkbox while updating
    panelCheckbox.disabled = true;

    this.callServiceOnTargetEntities("set_full_panel", {
      full_panel: applyToPanel,
    })
      .then(() => {
        // Re-enable checkbox, but do NOT clear optimistic state here
        panelCheckbox.disabled = false;
        // Matrix preview updates instantly via matrix_colors entity state
        // (same as lamp preview card).  Gallery thumbnails still need
        // preview cache, so trigger a reload for those.
        this._loadPreviews().catch(() => {});
      })
      .catch((err) => {
        // On error, revert optimistic state
        this._optimisticPanelMode = undefined;
        panelCheckbox.disabled = false;
        this._renderCard();
      });
  }

  /** Fill Panel column selector change. */
  _onFillPanelChange(e) {
    if (!this._hass || !this._getPrimaryEntity()) return;
    // Guard: ignore rapid change events while a service call is in flight.
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
        this._renderCard();
      }
    }, 5000);

    // Mark busy BEFORE render so another change event arriving meanwhile
    // short-circuits.
    this._fillPanelBusy = true;
    this._fillPanelLastSend = Date.now(); // Debounce timestamp
    this._renderCard();

    // Resolve the full list of target entities (same list used by
    // callServiceOnTargetEntities).
    const allTargets = getTargetEntities(this.config);

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
          this._renderCard();
        })
        .catch(() => {
          this._optimisticFillCols = undefined;
          this._fillPanelBusy = false;
          this._renderCard();
        });
    } else {
      // Off: restore each entity to its own previously-saved text.
      const saved = this._savedTextPerEntity || {};
      const restorePromises = allTargets.map(async (eid) => {
        const restoreText = saved[eid] ?? "";
        try {
          await this._commands.call(
            this._hass,
            "yeelight_cube",
            "set_custom_text",
            { text: restoreText, entity_id: eid },
          );
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
          this._renderCard();
        })
        .catch(() => {
          this._optimisticFillCols = undefined;
          this._fillPanelBusy = false;
          this._renderCard();
        });
    }
  }

  // Panel toggle interactions: switch container/label and card style
  _onPanelToggleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    this._togglePanelCheckbox();
  }

  // Chip / minimal styles
  _onPanelChipClick(e) {
    e.preventDefault();
    this._togglePanelCheckbox();
  }

  // Tabs style: each segment sets an explicit value
  _onPanelTabClick(e) {
    e.preventDefault();
    const targetValue = e.currentTarget.dataset.panelSeg === "true";
    const cb = this.shadowRoot?.getElementById("apply-to-panel");
    if (cb && cb.checked !== targetValue) {
      cb.checked = targetValue;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  /**
   * Delegated click handler on the Lit-rendered preview host.  The preview
   * content itself is shared-renderer HTML (gallery / carousel / wheel /
   * pagination) that is swapped in place, so a single listener on the
   * persistent host replaces the per-item listeners (nothing can stack).
   */
  _onPreviewClick(e) {
    const host = e.currentTarget;
    const t = e.target;
    if (!t?.closest) return;
    const within = (el) => el && host.contains(el);

    // Carousel: prev/next buttons, indicator dots and the displayed item
    if (this._getDisplayMode() === "carousel") {
      const nav = t.closest('[data-action="navigate"]');
      if (within(nav)) {
        e.stopPropagation();
        const dir = parseInt(nav.dataset.direction, 10);
        this._gcCarouselNavigate(dir || 1);
        return;
      }
      const dot = t.closest('[data-action="set-index"]');
      if (within(dot)) {
        e.stopPropagation();
        const idx = parseInt(dot.dataset.index, 10);
        this._gcCarouselSetIndex(idx || 0);
        return;
      }
      const selectItem = t.closest('[data-action="select-mode"]');
      if (within(selectItem)) {
        e.stopPropagation();
        const mode = selectItem.dataset.mode;
        if (mode) this._selectMode(mode);
        return;
      }
    }

    // Preview item clicks - apply the selected mode
    const item = t.closest(".gallery-item[data-mode]");
    if (within(item)) {
      const mode = item.dataset.mode;
      if (mode) this._selectMode(mode);
      return;
    }

    // Pagination (list / grid modes)
    const pageBtn = t.closest("[data-pagination-page], [data-pagination-action]");
    if (within(pageBtn)) {
      const directPage = pageBtn.dataset.paginationPage;
      const action = pageBtn.dataset.paginationAction;
      let pageOrAction;
      if (directPage !== undefined) pageOrAction = parseInt(directPage, 10);
      else if (action === "prev" || action === "next") pageOrAction = action;
      else return;
      const cur = this._selectorPage || 0;
      this._selectorPage =
        pageOrAction === "prev"
          ? Math.max(0, cur - 1)
          : pageOrAction === "next"
            ? cur + 1
            : pageOrAction;
      this._lastPreviewDataHash = null; // Force preview re-render
      this._updatePreviewSection();
    }
  }

  // Carousel swipe gesture (delegated, passive listeners — see constructor)
  _onPreviewTouchStart(e) {
    if (this._getDisplayMode() !== "carousel") return;
    if (!e.target?.closest?.(".gc-preview-shell")) return;
    this._swipeStartX = e.touches[0].clientX;
  }

  _onPreviewTouchEnd(e) {
    if (this._getDisplayMode() !== "carousel") return;
    if (!e.target?.closest?.(".gc-preview-shell")) return;
    const dx = e.changedTouches[0].clientX - (this._swipeStartX || 0);
    if (Math.abs(dx) > 40) {
      this._gcCarouselNavigate(dx < 0 ? 1 : -1);
    }
  }

  _renderPanelToggle(applyToWholePanel, style, shape = "round") {
    // Use optimistic value if set
    if (this._optimisticPanelMode !== undefined) {
      applyToWholePanel = this._optimisticPanelMode;
    }

    // Inline legacy migrations so old saved configs render correctly
    // without requiring an editor round-trip to normalise.
    if (style === "default") style = "minimal";
    if (style === "segmented") style = "tabs";

    switch (style) {
      case "switch":
        return html`
          <div class="panel-toggle switch" data-shape=${shape}>
            <label for="apply-to-panel" @click=${this._onPanelToggleClick}>Apply to Whole Panel</label>
            <div class="switch-container" @click=${this._onPanelToggleClick}>
              <input type="checkbox" id="apply-to-panel" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
              <span class="switch-slider"></span>
            </div>
          </div>
        `;

      case "card":
        return html`
          <div class="panel-toggle card ${
            applyToWholePanel ? "active" : ""
          }" data-shape=${shape} data-toggle-card="true" @click=${this._onPanelToggleClick}>
            <label for="apply-to-panel">Apply to Whole Panel</label>
            <div class="card-indicator"></div>
            <input type="checkbox" id="apply-to-panel" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
          </div>
        `;

      case "tabs":
        return html`
          <div class="panel-toggle tabs" data-shape=${shape} data-active=${applyToWholePanel ? "1" : "0"}>
            <input type="checkbox" id="apply-to-panel" style="display:none;" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
            <div class="tabs-thumb"></div>
            <button class="tab-btn${!applyToWholePanel ? " active" : ""}" data-panel-seg="false" @click=${this._onPanelTabClick}>
              <svg width="12" height="9" viewBox="0 0 12 9" fill="currentColor" style="flex-shrink:0;opacity:0.75"><rect x="0" y="0" width="3" height="3" rx="0.5"/><rect x="4.5" y="0" width="3" height="3" rx="0.5"/><rect x="9" y="0" width="3" height="3" rx="0.5"/><rect x="0" y="5" width="3" height="3" rx="0.5"/><rect x="4.5" y="5" width="3" height="3" rx="0.5"/><rect x="9" y="5" width="3" height="3" rx="0.5"/></svg>
              Pixels
            </button>
            <button class="tab-btn${applyToWholePanel ? " active" : ""}" data-panel-seg="true" @click=${this._onPanelTabClick}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="flex-shrink:0;opacity:0.85"><rect x="0" y="0" width="5" height="5" rx="1"/><rect x="7" y="0" width="5" height="5" rx="1"/><rect x="0" y="7" width="5" height="5" rx="1"/><rect x="7" y="7" width="5" height="5" rx="1"/></svg>
              Panel
            </button>
          </div>
        `;

      case "chip":
        return html`
          <div class="panel-toggle chip${applyToWholePanel ? " active" : ""}" data-shape=${shape} data-chip-toggle="true" @click=${this._onPanelChipClick}>
            <input type="checkbox" id="apply-to-panel" style="display:none;" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
            <span class="chip-dot"></span>
            <span class="chip-text">Whole Panel</span>
          </div>
        `;

      case "minimal":
      default:
        return html`
          <div class="panel-toggle minimal${applyToWholePanel ? " active" : ""}" data-shape=${shape} data-minimal-toggle="true" @click=${this._onPanelChipClick}>
            <input type="checkbox" id="apply-to-panel" style="display:none;" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
            <span class="minimal-indicator"></span>
            <span class="minimal-text">Whole Panel</span>
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

  /**
   * Return the primary entity ID (first target entity, or fallback single entity).
   */
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

  /**
   * Return the resolved unified mode-selector style (see resolveModeSelectorStyle).
   */
  _getModeSelectorStyle() {
    return resolveModeSelectorStyle(this.config);
  }

  /**
   * True when the mode selector is shown AND uses a preview style.
   * All preview machinery (backend preview service, event subscription,
   * wheel controller, persistent preview element) is active only then.
   */
  _isPreviewSelectorActive() {
    if (this.config?.show_mode_selector === false) return false;
    return PREVIEW_SELECTOR_STYLES.includes(this._getModeSelectorStyle());
  }

  /**
   * Return the normalised preview display mode derived from the unified
   * selector style: list / compact / carousel / wheel.
   * (preview-grid renders through the list renderer with a fixed column
   * override — see the [data-columns] CSS.)
   */
  _getDisplayMode() {
    const style = this._getModeSelectorStyle();
    if (style === "preview-wheel") return "wheel";
    if (style === "preview-carousel") return "carousel";
    if (style === "preview-strip") return "strip";
    return "list";
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
    // In-flight feedback: pulse the selected item until the backend confirms
    this._setPendingPulse(mode);

    // Read the panel setting from the checkbox when rendered; when the panel
    // toggle is hidden (show_panel_toggle=false) fall back to the entity's
    // actual full_panel state so selecting a mode never silently disables
    // panel mode.
    const panelCheckbox = this.shadowRoot?.getElementById("apply-to-panel");
    const applyToPanel = panelCheckbox
      ? panelCheckbox.checked
      : this._optimisticPanelMode !== undefined
        ? this._optimisticPanelMode
        : this._hass?.states[this._getPrimaryEntity()]?.attributes
            ?.full_panel || false;

    try {
      const result = await this.callServiceOnTargetEntities(
        "set_mode",
        { mode, full_panel: applyToPanel },
        // Quick successive picks only send the latest one.
        { coalesce: "select" },
      );
      // Never sent: the newer pick owns the highlight and the wheel.
      if (result === SUPERSEDED) return;
      // Keep _optimisticMode SET until the backend echoes the new mode back
      // through entity state (cleared in `set hass`).  The service resolves
      // before the hardware command completes (fire-and-forget backend), so
      // clearing after a blind delay made the highlight snap back to the OLD
      // mode until the echo arrived — a visible blink on every selection.
      // Safety timeout: drop the optimistic state if no echo arrives (e.g.
      // lamp offline) so the UI resyncs with reality.
      if (this._optimisticModeTimeout)
        clearTimeout(this._optimisticModeTimeout);
      this._optimisticModeTimeout = setTimeout(() => {
        this._optimisticModeTimeout = null;
        if (this._optimisticMode) {
          this._optimisticMode = null;
          if (this.isConnected) this._markActiveMode();
        }
      }, 5000);
      // For wheel mode, sync wheel position to the new mode and update highlight
      if (this._getDisplayMode() === "wheel") {
        this._lastWheelMode = mode;
        this._syncWheelToCurrentMode();
        this._markActiveMode();
      } else {
        this._renderCard();
      }
    } catch (error) {
      console.error("Error changing mode:", error);
      this._optimisticMode = null;
      if (this._optimisticModeTimeout) {
        clearTimeout(this._optimisticModeTimeout);
        this._optimisticModeTimeout = null;
      }
      if (this._getDisplayMode() === "wheel") {
        this._syncWheelToCurrentMode();
        this._markActiveMode();
      } else {
        this._renderCard();
      }
    } finally {
      this._processingModeChange = false;
    }
  }

  // Angle-related methods (from angle gradient card)
  // Angle control events are bound declaratively on the Lit-rendered
  // .angle-row / .header-rotary containers (see _onAngleArea* handlers and
  // _startRotaryDocDrag for the document-level drag listeners).

  // Always get the current textColors from the entity state
  _getCurrentTextColors() {
    const entityId = this._getPrimaryEntity();
    const hass = this._hass;
    if (hass && entityId && hass.states[entityId]) {
      const stateObj = hass.states[entityId];
      return stateObj.attributes.text_colors || [[255, 255, 255]];
    }
    return [[255, 255, 255]];
  }

  getCardSize() {
    // Estimate by selector presentation so masonry layout stacks sensibly
    const style = resolveModeSelectorStyle(this.config || {});
    if (style === "preview-list" || style === "preview-grid") return 8;
    if (style === "preview-wheel") return 5;
    if (style === "preview-carousel") return 4;
    return 4;
  }
}

defineOnce("yeelight-cube-gradient-card", YeelightCubeGradientCard);

if (typeof window !== "undefined") {
  registerCustomCard({
      type: "yeelight-cube-gradient-card",
      name: "Yeelight Gradient Card",
      description:
        "Control gradient settings for Yeelight Cube Lite matrix display",
      preview: true,
    });
}
