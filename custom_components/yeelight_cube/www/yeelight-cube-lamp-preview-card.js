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
  lightSliderConfig,
  sliderKeys,
  brightnessPctToRaw,
  brightnessRawToPct,
  isSliderHandler,
} from "./slider-control-utils.js";
import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampNotFoundNotice,
  NOTICE,
} from "./card-shell.js";
import { normalizeCardOptions } from "./card-config.js";
import { LampSliders } from "./lamp-sliders.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import {
  LitElement,
  html,
  unsafeHTML,
  unsafeCSS,
  nothing,
} from "./lib/lit-all.js";
import { LAMP_PREVIEW_CSS } from "./lamp-preview-styles.js";
import { AdjustmentControlsMixin } from "./lamp-preview-adjustments.js";
import { MatrixPreviewMixin } from "./lamp-preview-matrix.js";


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
class YeelightCubeLampPreviewCard extends MatrixPreviewMixin(
  AdjustmentControlsMixin(YeelightCardMixin(LitElement)),
) {
  // Static: the config-dependent values are CSS variables (_matrixGeometry).
  static styles = unsafeCSS(LAMP_PREVIEW_CSS);
  static editor = [
    "yeelight-cube-lamp-preview-card-editor",
    "./yeelight-cube-lamp-preview-card-editor.js",
  ];
  // Slider markup names its handlers in data-on-* attributes.
  static hostEvents = isSliderHandler;

  static getStubConfig(hass) {
    const firstEntity = cubeLampEntities(hass)[0] || "";
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
      show_brightness: true,
      slider_style: "capsule",
      brightness_slider_appearance: "default",
      slider_thickness: 6,
      slider_theme: "subtle",
      show_brightness_label: false,
      brightness_label_mode: "text",
      slider_value_display: "none",
      show_power_toggle: false,
      slider_show_icon_left: true,
      show_adjustment_controls: true,
      adjustments_layout: "categories",
      reset_button_mode: "changed",
    };
  }

  constructor() {
    super();
    this.config = {};
    this._hass = null;
    // Lamp calls (brightness, adjustments, resets, orientation) share the
    // card's queue (this._commands). The action row has its own, so a slider
    // commit never shows the actions as busy.
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
    this._localEffects = {}; // Store all effect values locally

    // Track if user is actively dragging to prevent re-render
    this._anySliderDragging = false; // Track if ANY slider is being dragged
    this._lastRenderedBrightness = null; // Track last rendered brightness to detect oscillations
    this._brightnessOscillationCount = 0; // Count rapid brightness changes
    this._oscillationResetTimeout = null; // Timer to reset oscillation counter

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

    // The brightness slider, through the shared lamp-slider controller like
    // the Clock and Native Effects sliders (lamp-sliders.js). Its markup is
    // patched in place on smart updates rather than re-rendered by Lit, so the
    // controller re-syncs it through _refresh().
    this._lampSliders = new LampSliders(
      this,
      {
        brightness: {
          config: () => this._brightnessGc(),
          commit: (pct) => this._sendBrightness(pct),
        },
      },
      { refresh: () => this._refresh() },
    );
  }

  // Send a brightness (slider %) to the lamp on the shared 3-255 curve.
  _sendBrightness(pct) {
    if (!this._hass || !this.config || !this.config.entity) return;
    this._commands
      .call(
        this._hass,
        "light",
        "turn_on",
        { entity_id: this.config.entity, brightness: brightnessPctToRaw(pct) },
        // A drag commits every few hundred ms and each call waits for the
        // lamp: while one is sent, only the latest value waits.
        { coalesce: "brightness" },
      )
      .catch((error) => {
        // Show the lamp's real value again.
        this._lampSliders.setDraft("brightness", null);
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
  }

  // Build the generic slider render config from the brightness config, applying
  // the same legacy theme/thickness migrations the card used before.
  _brightnessGc() {
    // The shared lamp-slider config (units, raw range, icons: same as the
    // Clock and Native Effects cards), with this card's own additions.
    // The slider_* options are the shared ones (older brightness_* names are
    // aliases, see card-config.js).
    return lightSliderConfig(this.config, "brightness", sliderKeys("slider"), {
      // Older theme names and the old "thick"/"thin" appearance still work.
      theme: resolveCapsuleTheme(
        this.config.slider_theme,
        this.config.capsule_theme,
      ),
      thickness: resolveCapsuleThickness(
        this.config.slider_thickness,
        this.config.brightness_slider_appearance,
        6,
      ),
      // Only this card lets the user pick the slider color.
      color: this.config.slider_color || "#ff9800",
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
      show_brightness: true, // Show the brightness slider
      slider_show_value: true, // Show the brightness percentage
      slider_style: "slider", // Brightness slider style (slider, bar, rotary...)
      slider_width: 100,
      brightness_slider_appearance: "default", // Legacy: Appearance for slider mode (migrated to thickness)
      slider_thickness: 6, // Track thickness in px (2-20, replaces appearance)
      brightness_label_mode: "text", // NEW: Brightness label mode (none, text, icon, icon_text)
      brightness_max: 500, // NEW: Maximum brightness value (default 500 to test beyond 255)
      show_device_orientation: true, // Show the 4-way device orientation control

      hide_black_dots: false, // NEW: Ignore black pixels on preview (default: false = OFF)
      show_lamp_preview: true, // NEW: Show lamp matrix preview by default
      show_adjustment_controls: false, // Deprecated: Use light brightness control instead
      ...resolvePreviewAppearance(
        lampActionConfig(normalizeCardOptions(config, "lamp-preview")),
        "lamp",
      ),
    };
    this._actionCommands.reset();
    this._actions.configure(
      this.config,
      this.config.entity ? [this.config.entity] : [],
    );
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

  // The brightness slider's handlers come from the shared lamp-slider
  // controller (constructor). _startDrag / _endDrag serve the effect sliders.

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
    if (this._anySliderDragging || this._slBrightnessTyping) {
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
    // Drop the dragged brightness once the lamp reports it.
    this._lampSliders.settle(stateObj.attributes);
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

    // The dragged value until the lamp reports it (prevents jumping during
    // render storms), else the lamp's.
    const draftBrightness = this._lampSliders.value("brightness");
    const displayBrightness = draftBrightness ?? sliderBrightness;

    // Detect brightness oscillation (HA sending alternating old/new values)
    if (
      this._lastRenderedBrightness !== null &&
      this._lastRenderedBrightness !== sliderBrightness &&
      draftBrightness === null
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
        this.config.show_brightness === true
          ? renderSliderGroup([
              {
                gc: this._brightnessGc(),
                value: displayBrightness,
                ns: "brightness",
              },
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
      this._slBrightnessUpdateVisuals?.(brightness);
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
    if (!entityId) return cardNotice(this, NOTICE.noLamp);
    // No hass yet (or a moment without it): keep what was rendered last.
    if (!hass) return this._lastTemplate ?? nothing;
    const stateObj = hass.states[entityId];
    if (!stateObj) return lampNotFoundNotice(this, entityId);

    const content = html`${this.config.show_lamp_preview !== false
      ? this._matrixTemplate(stateObj)
      : nothing}${this.config.show_lamp_control !== false
      ? this._lampControlsTemplate(stateObj)
      : nothing}${this.config.show_adjustment_controls === true
      ? this._adjustmentControlsTemplate(this._currentEffects(stateObj))
      : nothing}`;

    this._lastTemplate = html`${cardShell(
        this,
        html`<div style="display: flex; width: 100%;">
          <div class="yeelight-cube-lamp-preview-container yc-stack">
            ${content}
          </div>
        </div>`,
      )}`;
    return this._lastTemplate;
  }

  // The card stylesheet wrapped in a <style> element, as an HTML string (for
  // callers that embed a static snapshot next to _generateMatrixHtml).
  _getStyles() {
    return `<style>${LAMP_PREVIEW_CSS}</style>`;
  }

  connectedCallback() {
    super.connectedCallback();
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
    this._orientationContext = (this._orientationContext || 0) + 1;
    this._orientationPending = null;
    clearTimeout(this._orientationTimer);
    // Clear all stored debounce/timeout timers
    clearTimeout(this._effectDebounceTimer);
    clearTimeout(this._renderDebounceTimer);
    clearTimeout(this._oscillationResetTimeout);

    // Stop the client-side animation loops if running.
    this._stopNativeAnimation();
    this._stopClockAnimation();
    // Disconnect the off-screen visibility observer.
    if (this._visTracker) {
      this._visTracker.disconnect();
      this._visTracker = null;
    }
    this._lampDots = null;

    this._effectDebounceTimer = null;
    this._renderDebounceTimer = null;
    this._oscillationResetTimeout = null;

    // Detach a slider drag still in progress (and its timers).
    this._lampSliders.destroy();

    // Reset drag/interaction flags
    this._renderScheduled = false;
    this._anySliderDragging = false;
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
