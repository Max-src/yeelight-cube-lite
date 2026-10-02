import { resolvePreviewAppearance } from "./preview-appearance.js";

import { escapeHtml } from "./html-escape-utils.js";
import "./mode-controls-ui.js";
import {
  ModeControlsController,
  lampActionConfig,
} from "./mode-controls-controller.js";
import { CardCommandController } from "./card-command-controller.js";
import { orientationOptions, nextOrientation, orientationControlModel } from "./orientation-control-utils.js";
import { renderOrientationControls } from "./orientation-control-ui.js";
import { getInitialMatrix } from "./draw_card_state.js";

import {
  resolveCapsuleTheme,
  resolveCapsuleThickness,
} from "./capsule-slider-utils.js";
import {
  renderSliderGroup,
  createSliderHandlers,
  lightSliderConfig,
  brightnessPctToRaw,
  brightnessRawToPct,
  isSliderHandler,
} from "./slider-control-utils.js";
import { bindHostEvents } from "./host-events.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { LitElement, html, unsafeHTML } from "./lib/lit-all.js";
import { buildLampPreviewStyles } from "./lamp-preview-styles.js";
import { nothing } from "./lit-extras.js";
import { AdjustmentControlsMixin } from "./lamp-preview-adjustments.js";
import { MatrixPreviewMixin } from "./lamp-preview-matrix.js";

// Non-uniform legacy brightness config keys mapped to the shared slider's
// generic key names. Exported so the card editor renders the exact same
// controls without a config migration. One source of truth for both.
export const BRIGHTNESS_SLIDER_KEYS = {
  style: "brightness_slider_style",
  width: "brightness_slider_width",
  theme: "brightness_theme",
  thickness: "brightness_slider_thickness",
  color: "brightness_matrix_color",
  showValue: "show_brightness_percentage",
  variant: "brightness_slider_variant",
  barFill: "brightness_bar_fill",
  wheelStep: "brightness_wheel_step",
  wheelStyle: "brightness_wheel_style",
  wheelLabels: "brightness_wheel_labels",
  matrixCols: "brightness_matrix_cols",
  matrixRows: "brightness_matrix_rows",
  matrixDir: "brightness_matrix_direction",
  matrixPixelStyle: "brightness_matrix_pixel_style",
  matrixColor: "brightness_matrix_color",
  rotaryStyle: "brightness_rotary_style",
  stepButtons: "brightness_step_buttons",
  stepSize: "brightness_step_size",
  stepPosition: "brightness_step_position",
  valueDisplay: "brightness_value_display",
  valueSide: "brightness_value_side",
  snap: "brightness_snap_to_positions",
  capsuleVariant: "brightness_capsule_variant",
  iconLeftShow: "show_capsule_moon_icon",
  iconRightShow: "show_capsule_sun_icon",
};

// ================================================

// Rendering model (LitElement):
// - render() is a pure Lit template over the card's state; every control binds
//   its events declaratively (no inline handler strings).
// - _refresh() keeps the historical "render" decision logic (drag / typing /
//   oscillation guards, full vs smart update). A full update re-captures the
//   brightness slider markup and requests a Lit update; a smart update patches
//   the matrix dots and slider visuals in place.
// - The 20x5 .lamp-dot nodes carry no reactive bindings: their colors are only
//   ever painted directly (change-only) by _paintDots, from the static preview
//   and the native-effect / clock animation loops.
class YeelightCubeLampPreviewCard extends MatrixPreviewMixin(AdjustmentControlsMixin(LitElement)) {
  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-lamp-preview-card-editor")) {
      await import("./yeelight-cube-lamp-preview-card-editor.js");
    }
    return document.createElement("yeelight-cube-lamp-preview-card-editor");
  }
  static getStubConfig(hass) {
    const firstEntity =
      Object.keys(hass?.states || {}).find(
        (e) =>
          e.startsWith("light.yeelight_cube") ||
          e.startsWith("light.cubelite_"),
      ) || "";
    return {
      type: "custom:yeelight-cube-lamp-preview-card",
      entity: firstEntity,
      show_card_background: true,
      size: "medium",
      size_pct: 100,
      align: "center",
      matrix_spacing_mode: "normal",
      matrix_background: "black",
      matrix_box_shadow: true,
      matrix_pixel_style: "circle",
      show_force_refresh_button: false,
      buttons_style: "gradient",
      show_brightness_slider: true,
      brightness_slider_style: "capsule",
      brightness_slider_appearance: "default",
      brightness_slider_thickness: 6,
      brightness_theme: "subtle",
      show_brightness_label: false,
      brightness_label_mode: "text",
      brightness_value_display: "none",
      show_power_toggle: false,
      show_capsule_moon_icon: true,
      show_adjustment_controls: true,
      adjustments_layout: "categories",
      reset_button_mode: "changed",
    };
  }

  constructor() {
    super();
    this.config = {};
    this._hass = null;
    // Lamp calls (brightness, adjustments, resets, orientation) share one
    // ordered queue. The action row has its own, so a slider commit never
    // shows the actions as busy.
    this._commands = new CardCommandController();
    this._actionCommands = new CardCommandController(() => {
      if (!this._actions) return;
      this._actions.error = this._actionCommands.error;
      this._actions.notify();
    });
    const command = (service, data = {}, domain = "yeelight_cube") =>
      this._actionCommands.execute(
        this._hass,
        this.config,
        service,
        data,
        domain,
      );
    this._actions = new ModeControlsController({
      kind: "lamp",
      actionKeys: ["refresh", "power"],
      items: () => [],
      current: () => null,
      on: () => this._hass?.states?.[this.config.entity]?.state === "on",
      disabled: () =>
        this._actionCommands.busy ||
        !["on", "off"].includes(
          this._hass?.states?.[this.config.entity]?.state,
        ),
      command,
      refresh: () => command("force_refresh"),
    });
    this._brightnessDebounceTimer = null;
    this._realBrightnessDebounceTimer = null;
    this._effectDebounceTimer = null;
    this._renderDebounceTimer = null; // Debounce rendering to avoid flicker
    this._renderScheduled = false;
    this._nativeAnimKey = null;
    this._nativeAnimStartedAt = null;
    // Animation loops + visibility (shared matrix-animator): pause when the tab
    // is hidden or the card is scrolled off screen, and reuse the dot NodeList.
    this._nativeLoop = null;
    this._clockLoop = null;
    this._visTracker = null;
    this._onScreen = true;
    this._lampDots = null;

    // Local state for optimistic UI updates
    this._localBrightness = null;
    this._localEffects = {}; // Store all effect values locally

    // Track if user is actively dragging to prevent re-render
    this._isDragging = false;
    this._anySliderDragging = false; // Track if ANY slider is being dragged
    this._typingBrightness = false; // Track if user is typing in brightness input
    this._userSetBrightness = null; // Cache user-set brightness during drag/update cycle
    this._userBrightnessTimeout = null; // Timer to clear cached brightness
    this._lastRenderedBrightness = null; // Track last rendered brightness to detect oscillations
    this._brightnessOscillationCount = 0; // Count rapid brightness changes
    this._oscillationResetTimeout = null; // Timer to reset oscillation counter

    // Track the last service call timestamp to avoid clearing local state too early
    this._lastServiceCallTime = 0;

    // Track expanded sections
    this._expandedSections = {
      tone: false,
      color: false,
      effects: false,
    };

    // Track lamp on/off state to detect changes
    this._lastKnownState = null;

    // Track last brightness to detect brightness changes
    this._lastBrightness = null;

    // Track last matrix_colors to detect effect changes
    this._lastMatrixColors = null;

    // Track if initial render is complete
    this._isInitialRenderComplete = false;

    // Cache for comparing if full re-render is needed
    this._lastRenderedConfig = null;

    // Track active tab for tabbed layout
    this._activeTab = null;

    // Track selected category and effect for radial layout
    this._activeRadialCategory = null;
    this._selectedRadialEffect = null;

    // Lit render inputs captured by _refresh(): the brightness slider markup
    // (shared string renderer, only rebuilt on full updates so drags and typed
    // values are never replaced mid-interaction), a generation counter that
    // recreates the matrix dots on full updates, and the post-render work of
    // the pending full update (static paint + animation loop start/stop).
    this._sliderMarkup = "";
    this._dotGeneration = 0;
    this._pendingFull = null;
    // Effects just reset to their default: the default is shown locally until
    // the entity reports it, then the local override is dropped.
    this._resetPending = new Set();

    // Wire the shared multi-style slider (render + CSS + interactions) for the
    // brightness control. The handlers are assigned onto this element as
    // _slChange/_slWheel/..., named by the markup in data-on-* attributes.
    // Works in 1-100 display space; onCommit maps that to HA brightness 3-255.
    Object.assign(
      this,
      createSliderHandlers({
        host: this,
        getConfig: () => this._brightnessGc(),
        onCommit: (pct) => {
          if (!this._hass || !this.config || !this.config.entity) return;
          const safeBrightness = brightnessPctToRaw(pct);
          this._commands
            .call(
              this._hass,
              "light",
              "turn_on",
              { entity_id: this.config.entity, brightness: safeBrightness },
              // A drag commits every few hundred ms and each call waits for
              // the lamp: while one is sent, only the latest value waits.
              { coalesce: "brightness" },
            )
            .catch((error) => {
              this._refresh();
              const errorMsg = error?.message || String(error);
              if (errorMsg.includes("NoneType") || errorMsg.includes("close")) {
                console.warn("Lamp connection temporarily unavailable");
              } else if (errorMsg.includes("quota exceeded")) {
                console.warn("Device rate limit - brightness update queued");
              } else {
                console.error("Error setting brightness:", error);
              }
            });
        },
        onLive: (pct) => {
          // Optimistic cache so render() doesn't jump during drag/render storms.
          this._userSetBrightness = pct;
          this._isDragging = true;
          if (this._userBrightnessTimeout)
            clearTimeout(this._userBrightnessTimeout);
          this._userBrightnessTimeout = setTimeout(() => {
            this._userSetBrightness = null;
            // Let the next hass update re-sync the slider to the entity value
            // even if the entity state object has not changed since.
            this._renderIncomplete = true;
          }, 3000);
        },
      }),
    );
  }

  // Non-uniform legacy brightness config keys mapped to the shared slider's
  // generic key names (module-level BRIGHTNESS_SLIDER_KEYS is the single
  // source of truth, shared with the editor).

  // Build the generic slider render config from the brightness config, applying
  // the same legacy theme/thickness migrations the card used before.
  _brightnessGc() {
    // The shared lamp-slider config (units, raw range, icons: same as the
    // Clock and Native Effects cards), with this card's own additions.
    return lightSliderConfig(this.config, "brightness", BRIGHTNESS_SLIDER_KEYS, {
      // Older theme names and the old "thick"/"thin" appearance still work.
      theme: resolveCapsuleTheme(
        this.config.brightness_theme,
        this.config.capsule_theme,
      ),
      thickness: resolveCapsuleThickness(
        this.config.brightness_slider_thickness,
        this.config.brightness_slider_appearance,
        6,
      ),
      // Only this card lets the user pick the slider color.
      color: this.config.brightness_matrix_color || "#ff9800",
      rawValue:
        this._hass?.states?.[this.config?.entity]?.attributes?.brightness,
    });
  }

  setConfig(config) {
    this._commands?.reset();
    this._effectContext = (this._effectContext || 0) + 1;
    clearTimeout(this._effectDebounceTimer);
    this._effectDebounceTimer = null;
    this._localEffects = {};
    this._resetPending = new Set();
    this._isDragging = false;
    this._orientationContext = (this._orientationContext || 0) + 1;
    this._orientationPending = null;
    this._orientationError = null;
    clearTimeout(this._orientationTimer);
    this.config = {
      show_card_background: true,
      size: "medium",
      size_pct: 100, // Default matrix size to 100%
      align: "center",
      matrix_spacing_mode: "normal", // Default pixel spacing mode
      matrix_background: "black", // Black background by default
      matrix_box_shadow: true, // Keep matrix box shadow enabled
      matrix_pixel_style: "square", // Default pixel style
      buttons_style: "classic", // Style for all buttons (power toggle, force refresh)
      show_brightness_slider: true, // NEW: Show brightness slider by default
      show_brightness_percentage: true, // NEW: Show brightness percentage value
      brightness_slider_style: "slider", // NEW: Style for brightness slider (slider, bar, rotary)
      brightness_slider_width: 100,
      brightness_slider_appearance: "default", // Legacy: Appearance for slider mode (migrated to thickness)
      brightness_slider_thickness: 6, // Track thickness in px (2-20, replaces appearance)
      brightness_label_mode: "text", // NEW: Brightness label mode (none, text, icon, icon_text)
      brightness_max: 500, // NEW: Maximum brightness value (default 500 to test beyond 255)
      show_device_orientation: true, // Show the 4-way device orientation control

      hide_black_dots: false, // NEW: Ignore black pixels on preview (default: false = OFF)
      show_lamp_preview: true, // NEW: Show lamp matrix preview by default
      show_adjustment_controls: false, // Deprecated: Use light brightness control instead
      ...resolvePreviewAppearance(lampActionConfig(config), "lamp"),
    };
    this._actionCommands.reset();
    this._actions.configure(
      this.config,
      this.config.entity ? [this.config.entity] : [],
    );
    // Support legacy config migrations
    if (config.reconnect_button_style && !config.buttons_style) {
      this.config.buttons_style = config.reconnect_button_style;
    }

    // Force full re-render when config changes
    this._isInitialRenderComplete = false;

    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this._refresh();
      });
    }
  }

  set hass(hass) {
    const prevHass = this._hass;
    this._hass = hass;
    // HA calls this setter for every state change anywhere in the instance,
    // but only recreates the state object of the entity that changed. If our
    // entity's state object is the very same reference as last time (and the
    // config is unchanged, the card has rendered, and no render was deferred
    // by a slider drag / oscillation guard), there is nothing to do.
    const entityStateObj = hass?.states?.[this.config?.entity];
    if (
      prevHass &&
      this._isInitialRenderComplete &&
      !this._renderIncomplete &&
      this._seenConfig === this.config &&
      this._seenStateObj === entityStateObj
    ) {
      return;
    }
    this._seenConfig = this.config;
    this._seenStateObj = entityStateObj;
    if (
      this._orientationSettled &&
      this._orientationPending ===
        hass.states[this.config?.entity]?.attributes?.device_orientation
    ) {
      this._orientationPending = null;
      clearTimeout(this._orientationTimer);
    }
    this._refreshOrientationControls();

    // Note: _localEffects are NOT cleared when the entity state matches; they
    // keep tracking values that differ from defaults for the change indicator
    // system. _localEffects should only be cleared by explicit reset actions.

    // Check if the lamp on/off state has changed
    const oldState = this._lastKnownState;
    const newState = this.config?.entity
      ? hass.states[this.config.entity]?.state
      : null;
    const stateChanged = oldState !== newState;

    if (newState) {
      this._lastKnownState = newState;
    }

    // Don't re-render while user is actively dragging ANY slider OR if we have pending local effects
    // UNLESS the lamp on/off state changed (always show correct power button state)
    const hasPendingLocalEffects = Object.keys(this._localEffects).length > 0;

    // Detect brightness changes to debounce rendering
    const currentBrightness = this.config?.entity
      ? hass.states[this.config.entity]?.attributes?.brightness
      : null;
    const brightnessChanged = currentBrightness !== this._lastBrightness;

    // Detect matrix_colors changes to trigger re-render (for effect updates)
    const currentMatrixColors = this.config?.entity
      ? hass.states[this.config.entity]?.attributes?.matrix_colors
      : null;
    // Reference check first; only deep-compare when the array was replaced.
    const matrixColorsChanged =
      currentMatrixColors !== this._lastMatrixColors &&
      JSON.stringify(currentMatrixColors) !==
        JSON.stringify(this._lastMatrixColors);

    // Detect content-mode transitions (Matrix <-> Clock <-> Native Effect).
    // Each mode is driven by a different client-side loop (clock animation,
    // native-effect animation, or the static matrix). A switch changes none of
    // state/brightness/matrix_colors, so without this we may skip render() and
    // leave the preview frozen on the previous mode's last frame (e.g. stuck on
    // a native effect after switching to Clock).
    const currentContentMode = this.config?.entity
      ? hass.states[this.config.entity]?.attributes?.content_mode
      : null;
    const contentModeChanged = currentContentMode !== this._lastContentMode;
    if (currentContentMode != null) this._lastContentMode = currentContentMode;

    if (brightnessChanged && currentBrightness !== null) {
      this._lastBrightness = currentBrightness;

      // Debounce rendering when brightness changes to avoid flicker
      // Wait for both brightness AND matrix_colors updates to arrive
      if (this._renderDebounceTimer) {
        clearTimeout(this._renderDebounceTimer);
      }
      this._renderDebounceTimer = setTimeout(() => {
        this._renderDebounceTimer = null;
        // Always render to update matrix colors, even if dragging
        this._refresh();
      }, 250); // Increased from 150ms to 250ms for better performance
    } else if (
      !hasPendingLocalEffects ||
      stateChanged ||
      matrixColorsChanged ||
      contentModeChanged
    ) {
      // Normal rendering for non-brightness changes
      // Always render to update matrix - slider protection is inside _updateSliderValues
      // Also render when matrix_colors change (effect updates from backend)
      if (matrixColorsChanged && currentMatrixColors !== null) {
        this._lastMatrixColors = currentMatrixColors;
      }
      this._refresh();
    }
  }

  // Brightness slider interaction handlers now live in the shared
  // ./slider-control-utils.js module and are assigned onto this element via
  // createSliderHandlers() in the constructor (as _slChange, _slWheel, etc.).
  // _startDrag / _endDrag stay here because the effect sliders reference them.

  // Track when user starts dragging any slider
  _startDrag() {
    this._anySliderDragging = true;
  }

  // Track when user stops dragging any slider
  _endDrag() {
    // Use setTimeout to ensure the final value is processed before allowing re-render
    setTimeout(() => {
      this._anySliderDragging = false;
      // Don't force render here - let the hass setter handle it naturally
    }, 50);
  }

  // Historical render entry point: decides between a full update (Lit
  // re-render + fresh matrix dots + fresh brightness slider markup) and a smart
  // update (dots and slider visuals patched in place).
  _refresh() {
    // Cleared at the end of _renderCard; stays set if this render bails out
    // (slider drag, typing, brightness oscillation guard) so the next hass
    // update re-renders even when the entity state object is unchanged.
    this._renderIncomplete = true;
    // Skip re-rendering if user is dragging a slider or typing in brightness input
    if (this._anySliderDragging || this._typingBrightness || this._slTyping) {
      return;
    }

    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) {
      return;
    }
    const stateObj = hass.states[entityId];

    if (!stateObj) {
      // Rendered by render(); the next update with the entity is a full one
      // because the preview container is gone.
      this._missingEntity = entityId;
      this._lampDots = null;
      this.requestUpdate();
      return;
    }
    this._missingEntity = null;
    this._pruneResetEffects(stateObj);
    let matrixColors = stateObj.attributes.matrix_colors;

    if (!matrixColors?.length) {
      // Blank matrix: no data yet, or the firmware draws the matrix (Clock,
      // Native Effect, Music Flow), whose frames the backend can't read back.
      matrixColors = getInitialMatrix(5, 20); // 5 rows x 20 cols
    }

    // Use entity state for brightness (no optimistic updates to prevent flash)
    const entityBrightness = stateObj.attributes.brightness ?? 255;

    // Entity brightness (3-255) on the slider's 1-100 scale (shared curve).
    const sliderBrightness = brightnessRawToPct(entityBrightness);

    // Get all effect values (local or entity state)
    const effects = this._currentEffects(stateObj);

    // Render the card (pass entity brightness for color calculations, slider brightness for slider display)
    this._renderCard(
      stateObj,
      matrixColors,
      entityBrightness,
      sliderBrightness,
      effects,
    );
  }

  _renderCard(
    stateObj,
    matrixColors,
    entityBrightness,
    sliderBrightness,
    effects,
  ) {
    // Apply brightness to all pixels (black pixels stay black: effects are
    // never applied to the background).
    //
    // Perceptual boost: LCD screens look dimmer than LEDs at the same RGB.
    // We compute a target "effective" brightness from the lamp brightness
    // slider, then divide by the darken factor to get the boost multiplier.
    //
    //   effective = FLOOR + (1 - FLOOR) * t^GAMMA   (smooth power curve)
    //   boost     = effective / darkenFactor
    //
    // This is guaranteed monotonic (power + constant floor), never flat,
    // and controlled by just GAMMA (curve shape) and BOOST (floor height).
    const gridColors = this._matrixColorsToGridColors(matrixColors, stateObj);

    // Use user-set brightness if available (prevents jumping during render storms)
    const displayBrightness =
      this._userSetBrightness !== null
        ? this._userSetBrightness
        : sliderBrightness;

    // Detect brightness oscillation (HA sending alternating old/new values)
    if (
      this._lastRenderedBrightness !== null &&
      this._lastRenderedBrightness !== sliderBrightness &&
      this._userSetBrightness === null
    ) {
      this._brightnessOscillationCount++;

      // If we detect rapid oscillations (>2 changes), skip this render entirely
      if (this._brightnessOscillationCount > 2) {
        // Reset counter after 500ms of no oscillations
        clearTimeout(this._oscillationResetTimeout);
        this._oscillationResetTimeout = setTimeout(() => {
          this._brightnessOscillationCount = 0;
        }, 500);
        return; // Skip this render completely
      }
    } else if (this._lastRenderedBrightness === sliderBrightness) {
      // Same value - reset oscillation counter
      this._brightnessOscillationCount = 0;
    }

    this._lastRenderedBrightness = displayBrightness;

    // Smart update: Only rebuild DOM if not initialized or if dragging just ended
    const needsFullRender =
      !this._isInitialRenderComplete ||
      // A full update is still waiting for Lit: fold this one into it so its
      // post-render paint uses the newest colors.
      this._pendingFull !== null ||
      // The matrix (.lamp-preview-css) is absent when show_lamp_preview is
      // false, so check the always-rendered container instead; otherwise a
      // hidden preview forced a full DOM rebuild on every update.
      !this.shadowRoot?.querySelector(
        this.config.show_lamp_preview !== false
          ? ".lamp-preview-css"
          : ".yeelight-cube-lamp-preview-container",
      );

    // Firmware Native Effect and Clock modes run animations the plugin can't
    // read back, so the static matrix_colors attribute is meaningless there.
    // When active, we drive client-side animation loops and skip overwriting
    // the matrix with the static (stale) colors on smart updates.
    const isNativeAnimating =
      this.config.show_lamp_preview !== false &&
      stateObj.attributes.content_mode === "Native Effect" &&
      stateObj.state === "on";
    const isClockAnimating =
      this.config.show_lamp_preview !== false &&
      stateObj.attributes.content_mode === "Clock" &&
      stateObj.state === "on";

    if (needsFullRender) {
      // Full update on first load or structural changes. The brightness
      // slider markup is only rebuilt here; smart updates patch it in place.
      this._sliderMarkup =
        this.config.show_lamp_control !== false &&
        this.config.show_brightness_slider === true
          ? renderSliderGroup([
              { gc: this._brightnessGc(), value: displayBrightness },
            ])
          : "";
      // Fresh .lamp-dot nodes (keyed by generation), painted in updated().
      this._dotGeneration++;
      this._pendingFull = {
        gridColors,
        orientation: stateObj?.attributes?.device_orientation || "right",
        isNativeAnimating,
        isClockAnimating,
      };
      this._isInitialRenderComplete = true;
      // The matrix DOM (and its .lamp-dot nodes) is rebuilt; drop the cache.
      this._lampDots = null;
      // Remember which orientation this DOM was built for (smart updates compare).
      this._lastPreviewOrientation = this._pendingFull.orientation;
      this.requestUpdate();
      this._renderIncomplete = false;
      return;
    }

    // Smart update: Only update matrix colors and slider values
    // When a native animation or clock animation owns the matrix, don't
    // clobber it with the static (stale) matrix_colors attribute. With the
    // preview hidden there are no dots; calling _updateMatrixColors would
    // see a dot-count mismatch and rebuild the whole card on every update.
    if (
      !isNativeAnimating &&
      !isClockAnimating &&
      this.config.show_lamp_preview !== false
    )
      this._updateMatrixColors(gridColors, stateObj);
    this._updateSliderValues(displayBrightness, effects); // Use cached value to prevent jumping
    // Effect sliders, value labels and change indicators follow the state.
    this.requestUpdate();

    this._syncActions();
    // Start/stop the client-side animations to match current mode.
    this._syncAnimations(isNativeAnimating, isClockAnimating, false);
    this._renderIncomplete = false;
  }

  // Hand the shared Actions view its model and let it re-evaluate.
  _syncActions() {
    const actions = this.shadowRoot?.querySelector(
      'yeelight-mode-controls[area="actions"]',
    );
    if (actions) {
      actions.model = this._actions;
      this._actions.notify();
    }
  }

  // Start/stop the client-side animations to match the current mode. After a
  // full update the dots are new: a loop that was already running paints them
  // right away instead of waiting for its next tick.
  _syncAnimations(isNativeAnimating, isClockAnimating, repaint) {
    if (isNativeAnimating) {
      const running = this._nativeLoop?.running;
      this._startNativeAnimation();
      if (running && repaint) this._nativeAnimFrame();
    } else this._stopNativeAnimation();
    if (isClockAnimating) {
      const running = this._clockLoop?.running;
      this._startClockAnimation();
      if (running && repaint) this._clockAnimFrame();
    } else this._stopClockAnimation();
  }

  // Post-render work of a full update: paint the fresh dots, wire the Actions
  // view and (re)start the animation loop owning the matrix.
  updated(changedProperties) {
    super.updated?.(changedProperties);
    const pending = this._pendingFull;
    if (!pending) return;
    this._pendingFull = null;
    this._lampDots = null;
    if (
      this.config.show_lamp_preview !== false &&
      !pending.isNativeAnimating &&
      !pending.isClockAnimating
    ) {
      const dots = this._getLampDots();
      if (dots.length === pending.gridColors.length)
        this._paintDots(pending.gridColors, pending.orientation, dots);
    }
    this._syncActions();
    this._syncAnimations(
      pending.isNativeAnimating,
      pending.isClockAnimating,
      true,
    );
  }

  // Update only the brightness slider without rebuilding DOM. Effect sliders
  // and their labels are Lit bindings over _localEffects / the entity state.
  _updateSliderValues(brightness, effects) {
    // Update brightness slider and visual indicators via the shared control.
    const brightnessSlider =
      this.shadowRoot?.querySelector(".brightness-slider") ||
      this.shadowRoot?.querySelector(".capsule-input");
    if (brightnessSlider && !this._anySliderDragging) {
      brightnessSlider.value = brightness;
      // Per-style visuals (bar/wheel/matrix/rotary/capsule/slider) are handled
      // by the shared slider-control module.
      this._slUpdateVisuals?.(brightness);
    }
  }

  // HTML-string rendering of the same preview with its colors inline, for
  // callers that embed a static snapshot (e.g. the appearance regression tests).
  _generateMatrixHtml(gridColors, stateObj) {
    const { layout, alignClass, outerStyle, gridStyle } =
      this._matrixGeometry(stateObj);
    const pixels = Array.from({ length: layout.rows * layout.cols })
      .map((_, idx) => {
        const row = Math.floor(idx / layout.cols);
        const col = idx % layout.cols;
        const color = gridColors[layout.indexFn(row, col)] || "#000000";
        const { isEmpty, displayColor } = this._dotAppearance(color);
        return `<div class="lamp-dot${
          isEmpty ? " lamp-dot-empty" : ""
        }" style="background: ${escapeHtml(displayColor)};"></div>`;
      })
      .join("");
    return `<div class="${alignClass}" style="${escapeHtml(outerStyle)}"><div class="lamp-preview-css" style="${escapeHtml(gridStyle)}">${pixels}</div></div>`;
  }

  // The shared 4-way device orientation control (right / down / left / up):
  // its current orientation and whether the lamp can take a command.
  _orientationState(stateObj) {
    return [
      this._orientationPending ||
        stateObj?.attributes?.device_orientation ||
        "right",
      !stateObj || ["unavailable", "unknown"].includes(stateObj.state),
    ];
  }

  // What the row shows, as a comparable key (re-render only on change).
  _orientationKey(stateObj) {
    const [current, unavailable] = this._orientationState(stateObj);
    return `${JSON.stringify(
      orientationControlModel(this.config, current, unavailable),
    )}\u0000${this._orientationError || ""}`;
  }

  _orientationTemplate(stateObj) {
    const [current, unavailable] = this._orientationState(stateObj);
    this._renderedOrientationKey = this._orientationKey(stateObj);
    const error = this._orientationError
      ? html`<div class="orientation-error" role="alert">${this._orientationError}</div>`
      : nothing;
    return html`<div class="orientation-controls">
      ${renderOrientationControls(this.config, current, unavailable, (event) =>
        this.handleOrientationControl(event),
      )}${error}
    </div>`;
  }

  // Re-render the orientation control when its markup or error changed, and
  // keep keyboard focus on the same button across the markup swap.
  _refreshOrientationControls() {
    const container = this.shadowRoot?.querySelector(".orientation-controls");
    if (!container) return;
    if (
      this._orientationKey(this._hass?.states[this.config?.entity]) ===
      this._renderedOrientationKey
    )
      return;
    const focused = container.contains(this.shadowRoot.activeElement)
      ? this.shadowRoot.activeElement?.dataset.value
      : null;
    this.requestUpdate();
    if (focused) {
      this.updateComplete.then(() =>
        Array.from(
          this.shadowRoot.querySelectorAll(".orientation-controls button"),
        )
          .find((button) => button.dataset.value === focused)
          ?.focus({ preventScroll: true }),
      );
    }
  }

  handleOrientationControl(event) {
    const button = event.target.closest("button[data-value]");
    if (!button || button.disabled) return;
    const value = button.dataset.value;
    const options = orientationOptions(this.config);
    const current =
      this._orientationPending ||
      this._hass?.states[this.config?.entity]?.attributes?.device_orientation ||
      "right";
    const step = { clockwise: 1, counterclockwise: -1, "half-turn": 2 }[value];
    const target = step
      ? nextOrientation(current, step, options.directions)
      : value;
    if (target && target !== current) this.handleOrientationSelect(target);
  }

  async handleOrientationSelect(orientation) {
    const hass = this._hass;
    const entity = this.config?.entity;
    const state = hass?.states[entity];
    if (
      !state ||
      ["unavailable", "unknown"].includes(state.state) ||
      !orientationOptions(this.config).directions.includes(orientation)
    )
      return;
    const context = this._orientationContext;
    const sequence = (this._orientationSequence =
      (this._orientationSequence || 0) + 1);
    clearTimeout(this._orientationTimer);
    this._orientationPending = orientation;
    this._orientationSettled = false;
    this._orientationError = null;
    this._refreshOrientationControls();
    try {
      // Queued behind earlier clicks; dropped (resolves false) if the card is
      // reconfigured before it is sent.
      await this._commands.call(hass, "yeelight_cube", "set_device_orientation", {
        entity_id: entity,
        orientation,
      });
      if (
        context !== this._orientationContext ||
        sequence !== this._orientationSequence
      )
        return;
      this._orientationSettled = true;
      if (
        this._hass?.states[entity]?.attributes?.device_orientation ===
        orientation
      ) {
        this._orientationPending = null;
      } else {
        this._orientationTimer = setTimeout(() => {
          this._orientationPending = null;
          this._orientationError = "Orientation was not confirmed. Try again.";
          this._refreshOrientationControls();
        }, 8000);
      }
    } catch (error) {
      if (
        context !== this._orientationContext ||
        sequence !== this._orientationSequence
      )
        return;
      this._orientationPending = null;
      this._orientationError = "Could not change orientation. Try again.";
      console.error("[device-orientation] service call failed:", error);
    }
    this._refreshOrientationControls();
  }

  // Actions, device orientation and the brightness slider. The slider is the
  // shared multi-style control (./slider-control-utils.js, same as the clock
  // card), rendered from markup captured on the last full update.
  _lampControlsTemplate(stateObj) {
    return html`<yeelight-mode-controls
        area="actions"
        .model=${this._actions}
      ></yeelight-mode-controls
      >${this.config.show_device_orientation !== false
        ? this._orientationTemplate(stateObj)
        : nothing}${this._sliderMarkup
        ? unsafeHTML(this._sliderMarkup)
        : nothing}`;
  }

  render() {
    const entityId = this.config?.entity;
    const hass = this._hass;
    // Nothing to show yet (or any more): keep whatever was rendered last.
    if (!hass || !entityId) return this._lastTemplate ?? nothing;
    const stateObj = hass.states[entityId];
    if (!stateObj) {
      return html`<ha-card>
        <div style="padding: 16px;">
          <h3>${`Entity not found: ${entityId}`}</h3>
          <p>Please check your configuration and ensure the entity exists.</p>
        </div>
      </ha-card>`;
    }

    const showCard = this.config.show_card_background !== false;
    const cardTitle = this.config.title || this.config.card_title || "";
    const usingFallbackMatrix = !stateObj.attributes.matrix_colors;
    const content = html`${this.config.show_lamp_preview !== false
      ? this._matrixTemplate(stateObj)
      : nothing}${this.config.show_lamp_control !== false
      ? this._lampControlsTemplate(stateObj)
      : nothing}${this.config.show_adjustment_controls === true
      ? this._adjustmentControlsTemplate(this._currentEffects(stateObj))
      : nothing}`;

    this._lastTemplate = html`<style>
        ${this._stylesText()}
      </style>
      ${showCard
        ? html`<ha-card
            header=${cardTitle
              ? `${cardTitle}${usingFallbackMatrix ? " (No Matrix Data)" : ""}`
              : nothing}
          >
            <div style="display: flex; width: 100%;">
              <div class="yeelight-cube-lamp-preview-container yc-stack">
                ${content}
              </div>
            </div>
          </ha-card>`
        : html`<div style="display: flex; width: 100%;">
            <div class="yeelight-cube-lamp-preview-container yc-stack">
              ${cardTitle
                ? html`<div style="font-weight:600;font-size:1.1em;">
                    ${cardTitle}
                  </div>`
                : nothing}
              ${content}
            </div>
          </div>`}`;
    return this._lastTemplate;
  }

  // The card stylesheet wrapped in a <style> element, as an HTML string (for
  // callers that embed a static snapshot next to _generateMatrixHtml).
  _getStyles() {
    return `<style>${this._stylesText()}</style>`;
  }

  // The card CSS. Only the pixel shape and dot shadow depend on the config, so
  // the text is memoised on those and Lit only rewrites it when they change.
  _stylesText() {
    const pixelStyle = this.config.matrix_pixel_style || "square";
    // Resolve pixel spacing mode for CSS styles
    const spacingMode =
      this.config.matrix_spacing_mode ||
      (this.config.matrix_pixel_spacing === false ? "none" : "normal");
    const lampDotShadow = spacingMode === "subtle" || spacingMode === "normal";
    const key = `${pixelStyle}|${lampDotShadow}`;
    if (this._stylesKey !== key) {
      this._stylesKey = key;
      this._stylesCache = buildLampPreviewStyles(pixelStyle, lampDotShadow);
    }
    return this._stylesCache;
  }

  connectedCallback() {
    super.connectedCallback();
    // Slider markup names its handlers in data-on-* attributes.
    bindHostEvents(this, isSliderHandler);
    // Reattached after a disconnect (dashboard edit mode, view switch): the
    // animation loops were stopped, so run a full update to restart them.
    if (this._wasDisconnected) {
      this._wasDisconnected = false;
      this._isInitialRenderComplete = false;
      this._refresh();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._wasDisconnected = true;
    this._actionCommands.reset();
    this._commands.reset();
    this._actions.configure(
      this.config,
      this.config.entity ? [this.config.entity] : [],
    );
    this._effectContext = (this._effectContext || 0) + 1;
    this._localEffects = {};
    this._resetPending = new Set();
    this._isDragging = false;
    this._orientationContext = (this._orientationContext || 0) + 1;
    this._orientationPending = null;
    clearTimeout(this._orientationTimer);
    // Clear all stored debounce/timeout timers
    clearTimeout(this._brightnessDebounceTimer);
    clearTimeout(this._realBrightnessDebounceTimer);
    clearTimeout(this._effectDebounceTimer);
    clearTimeout(this._renderDebounceTimer);
    clearTimeout(this._oscillationResetTimeout);
    clearTimeout(this._userBrightnessTimeout);

    // Stop the client-side animation loops if running.
    this._stopNativeAnimation();
    this._stopClockAnimation();
    // Disconnect the off-screen visibility observer.
    if (this._visTracker) {
      this._visTracker.disconnect();
      this._visTracker = null;
    }
    this._lampDots = null;

    this._brightnessDebounceTimer = null;
    this._realBrightnessDebounceTimer = null;
    this._effectDebounceTimer = null;
    this._renderDebounceTimer = null;
    this._oscillationResetTimeout = null;
    this._userBrightnessTimeout = null;

    // Clean up document-level drag listeners if disconnected mid-drag
    if (this._dragCleanup) {
      document.removeEventListener("mousemove", this._dragCleanup.handleMove);
      document.removeEventListener("mouseup", this._dragCleanup.handleEnd);
      document.removeEventListener("touchmove", this._dragCleanup.handleMove);
      document.removeEventListener("touchend", this._dragCleanup.handleEnd);
      this._dragCleanup = null;
    }

    // Tear down the shared slider handlers (clears their internal timers/listeners).
    this._slDestroy?.();

    // Reset drag/interaction flags
    this._renderScheduled = false;
    this._isDragging = false;
    this._anySliderDragging = false;
    this._rotaryDragging = false;
  }

  getCardSize() {
    return 2;
  }
}

defineOnce("yeelight-cube-lamp-preview-card", YeelightCubeLampPreviewCard);

// Register for Lovelace "Add Card" UI
registerCustomCard({
    type: "yeelight-cube-lamp-preview-card",
    name: "Yeelight Preview Card",
    description: "Preview the Yeelight Cube Lite lamp matrix and settings.",
    preview: true,
  });
