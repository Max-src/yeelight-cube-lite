import {
  resolvePreviewAppearance,
  previewLength,
} from "./preview-appearance.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { renderDotMatrix, rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { escapeHtml } from "./html-escape-utils.js";
import "./mode-controls-ui.js";
import {
  ModeControlsController,
  lampActionConfig,
} from "./mode-controls-controller.js";
import { CardCommandController } from "./card-command-controller.js";
import {
  orientationOptions,
  nextOrientation,
  renderOrientationControls,
  orientationControlStyles,
} from "./orientation-control-utils.js";
import { getInitialMatrix } from "./draw_card_state.js";
import { renderNativeEffectOriented } from "./native-effect-preview.js";
import {
  CLOCK_MIXER_EFFECTS,
  CLOCK_MIXER_EFFECT_SPEED,
  clockStyleMixer,
  renderClockFrame,
} from "./clock-preview-utils.js";
import { BLACK_THRESHOLD, previewBrightnessScale } from "./matrix-const.js";
import { createRafLoop, createVisibilityTracker } from "./matrix-animator.js";
import { exportImportButtonStyles } from "./action-button-utils.js";
import {
  resolveCapsuleTheme,
  resolveCapsuleThickness,
} from "./capsule-slider-utils.js";
import {
  renderSliderGroup,
  createSliderHandlers,
  sliderControlStyles,
  lightSliderConfig,
  brightnessPctToRaw,
  brightnessRawToPct,
  isSliderHandler,
} from "./slider-control-utils.js";
import { bindHostEvents } from "./host-events.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { LitElement, html, repeat, unsafeHTML } from "./lib/lit-all.js";

// The bundled ./lib/lit-all.js exports neither `nothing` nor `svg`. Both are
// stable parts of Lit's template protocol: `nothing` is the registered
// "lit-nothing" sentinel and an SVG template result is `_$litType$: 2`.
const nothing = Symbol.for("lit-nothing");
const svg = (strings, ...values) => ({ _$litType$: 2, strings, values });

// Clock-face preview (mixer tables, glyph font and renderClockFrame) now lives
// in the shared ./clock-preview-utils.js module, imported above.

// ==============  EFFECTS REGISTRY  ==============
// Single source of truth for all effect metadata.
// All effect definitions throughout this card derive from these two tables.
// To add/remove/change an effect, edit ONLY here.

const EFFECTS_REGISTRY = {
  hue_shift: {
    label: "Hue Shift",
    icon: "🔄",
    min: -180,
    max: 180,
    default: 0,
    unit: "°",
    hint: null,
  },
  temperature: {
    label: "Temperature",
    icon: "🌡️",
    min: -100,
    max: 100,
    default: 0,
    unit: "",
    hint: "Cool ❄ → Warm",
  },
  saturation: {
    label: "Saturation",
    icon: "🎨",
    min: 0,
    max: 200,
    default: 100,
    unit: "",
    hint: null,
  },
  vibrance: {
    label: "Vibrance",
    icon: "💥",
    min: 0,
    max: 200,
    default: 100,
    unit: "",
    hint: "Smart saturation",
  },
  contrast: {
    label: "Contrast",
    icon: "◐",
    min: 0,
    max: 200,
    default: 100,
    unit: "",
    hint: null,
  },
  glow: {
    label: "Glow",
    icon: "✨",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: "Boost bright pixels",
  },
  grayscale: {
    label: "Grayscale",
    icon: "⬜",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: null,
  },
  invert: {
    label: "Invert",
    icon: "🔃",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: null,
  },
  tint_hue: {
    label: "Tint Hue",
    icon: "🎯",
    min: 0,
    max: 360,
    default: 0,
    unit: "°",
    hint: "Color for tint",
  },
  tint_strength: {
    label: "Tint Strength",
    icon: "💧",
    min: 0,
    max: 100,
    default: 0,
    unit: "%",
    hint: "Tint intensity",
  },
};

const SECTIONS_REGISTRY = [
  {
    id: "color_adjustments",
    title: "Color",
    icon: "🎨",
    description: "Hue and tone",
    effects: ["hue_shift", "temperature"],
  },
  {
    id: "saturation_intensity",
    title: "Intensity",
    icon: "💎",
    description: "Color richness",
    effects: ["saturation", "vibrance"],
  },
  {
    id: "tone_contrast",
    title: "Tone",
    icon: "🌓",
    description: "Light/dark balance",
    effects: ["contrast", "glow"],
  },
  {
    id: "special_effects",
    title: "Effects",
    icon: "✨",
    description: "Creative transforms",
    effects: ["grayscale", "invert", "tint_hue", "tint_strength"],
  },
];

// Derived lookup tables (computed once at load time)
const EFFECT_ATTR_MAP = Object.fromEntries(
  Object.keys(EFFECTS_REGISTRY).map((name) => [name, `preview_${name}`]),
);

const EFFECT_DEFAULTS = Object.fromEntries(
  Object.entries(EFFECTS_REGISTRY).map(([name, def]) => [name, def.default]),
);

const EFFECT_NAMES = Object.keys(EFFECTS_REGISTRY);

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
// - The 20x5 .lamp-dot nodes carry no reactive bindings: their colours are only
//   ever painted directly (change-only) by _paintDots, from the static preview
//   and the native-effect / clock animation loops.
class YeelightCubeLampPreviewCard extends LitElement {
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
      // Only this card lets the user pick the slider colour.
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

  async handleEffectChange(effectName, event) {
    const newValue = parseInt(event.target.value);
    if (!this._hass || !this.config || !this.config.entity || isNaN(newValue)) {
      return;
    }

    // Mark as dragging to prevent re-render from hass updates
    this._isDragging = true;

    // Optimistic update: store locally and update label only
    this._localEffects[effectName] = newValue;
    this._resetPending?.delete(effectName);
    this._updateEffectLabel(effectName, newValue);

    // Auto-enable tint: changing Tint Hue without Tint Strength does nothing
    // visually, which feels broken. Auto-set Tint Strength to 50% when the
    // user starts changing Tint Hue and strength is currently 0.
    if (effectName === "tint_hue" && newValue !== 0) {
      const stateObj = this._hass?.states?.[this.config.entity];
      if (!stateObj) return;
      const currentStrength =
        this._localEffects.tint_strength ??
        stateObj?.attributes?.preview_tint_strength ??
        0;
      if (currentStrength === 0) {
        const autoStrength = 50;
        // The tint_strength slider and label follow _localEffects on render.
        this._localEffects.tint_strength = autoStrength;
        this._resetPending?.delete("tint_strength");
        this._updateEffectLabel("tint_strength", autoStrength);
      }
    }

    // Update change indicators
    this._updateChangeIndicators();

    // Update compact layout reset button visibility if in "changed" mode
    this._updateCompactResetButtons();

    // Update section-level reset button visibility (for Tabbed, Grouped, Radial, Categories)
    this._updateSectionResetButtons();

    // Debounce the service call
    if (this._effectDebounceTimer) {
      clearTimeout(this._effectDebounceTimer);
    }

    const context = this._effectContext;
    const entityId = this.config.entity;
    const hass = this._hass;
    this._effectDebounceTimer = setTimeout(async () => {
      if (context !== this._effectContext) return;
      this._effectDebounceTimer = null;
      // User stopped dragging
      this._isDragging = false;

      try {
        // Get all current effect values
        const stateObj = hass.states?.[entityId];
        if (!stateObj) return;
        const _tSvc = performance.now();
        const effects = {};
        for (const name of EFFECT_NAMES) {
          effects[name] =
            this._localEffects[name] ??
            stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ??
            EFFECT_DEFAULTS[name];
        }

        // Track when we make the service call
        this._lastServiceCallTime = Date.now();

        await this._commands.call(
          hass,
          "yeelight_cube",
          "set_preview_adjustments",
          { entity_id: entityId, ...effects },
          // Each call carries every adjustment, so a newer one waiting in
          // the queue replaces this one.
          { coalesce: "adjustments" },
        );

        // Don't clear local state on a timer - let the entity state update handle it
        // The set hass() method will trigger a render when entity updates
        // At that point, if entity state matches local state, we can safely clear it
      } catch (error) {
        if (context !== this._effectContext) return;
        // Revert to entity state on error
        delete this._localEffects[effectName];
        this._refresh();
        console.error("Error setting effect:", error);
      }
    }, 300); // Faster response for effects
  }

  // Layout interactions only change view state; the Lit template derives the
  // expanded / active / hidden classes from it on the next update.
  toggleSection(sectionId) {
    this._expandedSections[sectionId] = !this._expandedSections[sectionId];
    this.requestUpdate();
  }

  switchTab(tabId) {
    this._activeTab = tabId;
    this.requestUpdate();
  }

  selectRadialCategory(categoryId) {
    this._activeRadialCategory = categoryId;

    // Get the first effect of this category as the selected effect
    const effectsData = this._getEffectsData();
    const section = effectsData.find((s) => s.id === categoryId);
    if (section && section.effects.length > 0) {
      this._selectedRadialEffect = section.effects[0].name;
    }
    this.requestUpdate();
  }

  selectCircularCategory(categoryId) {
    this._activeRadialSection = categoryId;

    const layoutMode = this.config.adjustments_layout || "grouped";

    if (layoutMode === "categories") {
      this._updateCategoriesPanel(categoryId);
    } else if (layoutMode === "radial") {
      this.requestUpdate();
    }
  }

  _updateCategoriesPanel(categoryId) {
    // The icon column and slider panel both derive from _activeRadialSection;
    // Lit only patches what changed, so indicators never blink.
    this._activeRadialSection = categoryId;
    this.requestUpdate();
  }

  selectRadialEffect(effectName) {
    this._selectedRadialEffect = effectName;
    this.requestUpdate();
  }

  // Drop the local override of effects that were reset to their default once
  // the entity reports that value (or reports nothing, which reads as default).
  _pruneResetEffects(stateObj) {
    if (!this._resetPending?.size) return;
    for (const name of [...this._resetPending]) {
      const local = this._localEffects[name];
      const shown =
        stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ?? EFFECT_DEFAULTS[name];
      if (local === undefined || shown === local) {
        if (local !== undefined) delete this._localEffects[name];
        this._resetPending.delete(name);
      }
    }
  }

  async resetSection(sectionId) {
    // Derive section defaults from SECTIONS_REGISTRY + EFFECT_DEFAULTS
    const section = SECTIONS_REGISTRY.find((s) => s.id === sectionId);
    if (!section) {
      console.error("? Unknown section ID:", sectionId);
      return;
    }
    const defaultValues = {};
    for (const name of section.effects) {
      defaultValues[name] = EFFECT_DEFAULTS[name];
    }

    // Get current state from entity
    const stateObj = this._hass?.states?.[this.config.entity];
    if (!stateObj) return;

    // Build the effects object: Start with current values from entity state OR local changes
    const getCurrentValue = (effectName) => {
      // Priority: 1) Local changes (if user is dragging), 2) Entity state, 3) Default
      return (
        this._localEffects[effectName] ??
        stateObj.attributes?.[EFFECT_ATTR_MAP[effectName]] ??
        EFFECT_DEFAULTS[effectName] ??
        0
      );
    };

    const allEffects = {};
    for (const name of EFFECT_NAMES) {
      allEffects[name] = getCurrentValue(name);
    }

    // Override ONLY the effects in this section with their defaults
    Object.keys(defaultValues).forEach((effectName) => {
      allEffects[effectName] = defaultValues[effectName];
      // Also update local state so sliders move immediately
      this._localEffects[effectName] = defaultValues[effectName];
    });
    this.requestUpdate();

    // Send everything to the lamp (only this section's values changed)
    if (await this._sendReset(defaultValues, allEffects)) {
      // Sliders and labels keep showing the defaults until the entity echoes
      // them; the local overrides are then dropped (see _pruneResetEffects).
      Object.keys(defaultValues).forEach((effectName) =>
        this._resetPending.add(effectName),
      );
      this._pruneResetEffects(this._hass?.states?.[this.config.entity]);
    }

    // Update change indicators and section reset button visibility
    this._updateChangeIndicators();
    this._updateSectionResetButtons();
  }

  // Send a reset whose defaults are already shown. If the lamp refuses it,
  // drop those defaults again (unless the user moved a slider meanwhile) so
  // the controls show what the lamp really has. True once sent.
  async _sendReset(defaults, allEffects) {
    const context = this._effectContext;
    try {
      const sent = await this._commands.call(
        this._hass,
        "yeelight_cube",
        "set_preview_adjustments",
        { entity_id: this.config.entity, ...allEffects },
      );
      return sent === true && context === this._effectContext;
    } catch (error) {
      if (context !== this._effectContext) return false;
      for (const [name, value] of Object.entries(defaults))
        if (this._localEffects[name] === value) delete this._localEffects[name];
      this._refresh();
      console.error("[lamp-preview] Reset failed:", error);
      return false;
    }
  }

  async resetEffect(effectName) {
    // Reset a single effect to its default value (for compact layout)
    const defaultValue = this._getDefaultValue(effectName);

    // Get current state from entity
    const stateObj = this._hass?.states?.[this.config.entity];
    if (!stateObj) return;

    // Build the effects object with all current values
    const allEffects = {};
    Object.keys(EFFECT_ATTR_MAP).forEach((effect) => {
      const attrName = EFFECT_ATTR_MAP[effect];
      if (attrName && stateObj.attributes[attrName] !== undefined) {
        allEffects[effect] =
          this._localEffects[effect] ?? stateObj.attributes[attrName];
      }
    });

    // Update only this effect to default
    allEffects[effectName] = defaultValue;
    this._localEffects[effectName] = defaultValue;
    this.requestUpdate();

    // Send to the lamp
    if (
      await this._sendReset({ [effectName]: defaultValue }, allEffects)
    ) {
      // Keep showing the default until the entity echoes it.
      this._resetPending.add(effectName);
      this._pruneResetEffects(this._hass?.states?.[this.config.entity]);
    }

    // Update change indicators and reset button visibility
    this._updateChangeIndicators();
    this._updateCompactResetButtons();
  }

  _sectionHasChanges(section) {
    // Check if any effect in the section has been changed from default
    // Prioritize _localEffects (for immediate feedback during dragging)
    // Then check entityValue (which comes from actual entity state)
    const changedEffects = [];

    const hasChanges = section.effects.some((effect) => {
      // First check if there's a pending local change
      if (this._localEffects[effect.name] !== undefined) {
        const isDifferent = this._localEffects[effect.name] !== effect.default;
        if (isDifferent) {
          changedEffects.push(
            `${effect.name}:local=${this._localEffects[effect.name]}`,
          );
        }
        return isDifferent;
      }

      // Otherwise check the actual entity state value
      // If entityValue is undefined, it means the entity hasn't set this value yet, so treat it as default
      const entityValue =
        effect.entityValue !== undefined ? effect.entityValue : effect.default;
      const isDifferent = entityValue !== effect.default;
      if (isDifferent) {
        changedEffects.push(`${effect.name}:entity=${entityValue}`);
      }
      return isDifferent;
    });

    return hasChanges;
  }

  // Change indicators (orange dots) and "changed"-mode reset buttons are
  // derived from _checkSectionChanges / _checkEffectChanged inside the Lit
  // template, so refreshing them is just a (batched) re-render.
  _updateChangeIndicators() {
    this.requestUpdate();
  }

  _updateCompactResetButtons() {
    this.requestUpdate();
  }

  _updateSectionResetButtons() {
    this.requestUpdate();
  }

  _checkSectionChanges(sectionId) {
    // Check if a section has any changes from defaults
    // Works even if sliders aren't currently rendered (e.g., in Categories/Radial layouts)

    // Get the section definition with its effects
    const effectsData = this._getEffectsDataForAllLayouts();
    const section = effectsData.find((s) => s.id === sectionId);

    if (!section) {
      return false;
    }

    // Get entity state
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) {
      return false;
    }

    const stateObj = hass.states[entityId];
    if (!stateObj) {
      return false;
    }

    // Check each effect in this section
    let hasChanges = false;

    for (const effect of section.effects) {
      const effectName = effect.name;
      const defaultValue = EFFECT_DEFAULTS[effectName] ?? 0;
      const attrName = EFFECT_ATTR_MAP[effectName];

      // Check _localEffects first (for pending changes), then entity attribute
      let currentValue;
      if (this._localEffects[effectName] !== undefined) {
        currentValue = this._localEffects[effectName];
      } else if (attrName && stateObj.attributes[attrName] !== undefined) {
        currentValue = stateObj.attributes[attrName];
      } else {
        currentValue = defaultValue;
      }

      if (Math.abs(currentValue - defaultValue) > 0.1) {
        hasChanges = true;
      }
    }

    return hasChanges;
  }

  _checkEffectChanged(effectName) {
    // Check if a single effect has changed from its default value
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) {
      return false;
    }

    const stateObj = hass.states[entityId];
    if (!stateObj) {
      return false;
    }

    const defaultValue = EFFECT_DEFAULTS[effectName] ?? 0;
    const attrName = EFFECT_ATTR_MAP[effectName];

    // Check _localEffects first (for pending changes), then entity attribute
    let currentValue;
    let source;
    if (this._localEffects[effectName] !== undefined) {
      currentValue = this._localEffects[effectName];
      source = "_localEffects";
    } else if (attrName && stateObj.attributes[attrName] !== undefined) {
      currentValue = stateObj.attributes[attrName];
      source = "entity";
    } else {
      currentValue = defaultValue;
      source = "default";
    }

    const hasChanged = Math.abs(currentValue - defaultValue) > 0.1;

    // Compare with tolerance for floating point
    return hasChanged;
  }

  _shouldShowResetButton(sectionId) {
    // Determines if reset button should be visible based on config (for section-level)
    const mode = this.config.reset_button_mode || "always";

    if (mode === "never") {
      return false;
    }

    if (mode === "always") {
      return true;
    }

    // mode === "changed"
    return this._checkSectionChanges(sectionId);
  }

  _shouldShowEffectResetButton(effectName) {
    // Determines if reset button should be visible for individual effect (compact layout)
    const mode = this.config.reset_button_mode || "always";

    if (mode === "never") {
      return false;
    }

    if (mode === "always") {
      return true;
    }

    // mode === "changed"
    return this._checkEffectChanged(effectName);
  }

  _getEffectsDataForAllLayouts() {
    // Returns section definitions that work across all layouts.
    // Derives from SECTIONS_REGISTRY plus legacy aliases for backward compatibility.
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return [];

    const stateObj = hass.states[entityId];
    if (!stateObj) return [];

    // Build from registry
    const sections = SECTIONS_REGISTRY.map((s) => ({
      id: s.id,
      effects: s.effects.map((name) => ({ name })),
    }));

    // Legacy aliases (old layouts may use these section IDs)
    const SECTION_ALIASES = {
      color_shift: "color_adjustments",
      tone_adjustments: ["saturation_intensity", "tone_contrast"],
    };

    for (const [alias, targets] of Object.entries(SECTION_ALIASES)) {
      const targetIds = Array.isArray(targets) ? targets : [targets];
      const combinedEffects = targetIds.flatMap(
        (tid) => SECTIONS_REGISTRY.find((s) => s.id === tid)?.effects || [],
      );
      sections.push({
        id: alias,
        effects: combinedEffects.map((name) => ({ name })),
      });
    }

    return sections;
  }

  _getDefaultValue(effectName) {
    return EFFECT_DEFAULTS[effectName] ?? 0;
  }

  _getEffectsData() {
    // Derives section data from EFFECTS_REGISTRY + SECTIONS_REGISTRY
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return [];

    const stateObj = hass.states[entityId];
    if (!stateObj) return [];

    // Helper to get value: prioritize _localEffects over entity state FOR DISPLAY
    const getValue = (name) =>
      this._localEffects[name] !== undefined
        ? this._localEffects[name]
        : stateObj.attributes?.[EFFECT_ATTR_MAP[name]];

    // Helper to get ENTITY value (not local effects) for change detection
    const getEntityValue = (name) =>
      stateObj.attributes?.[EFFECT_ATTR_MAP[name]];

    return SECTIONS_REGISTRY.map((section) => ({
      id: section.id,
      title: section.title,
      icon: section.icon,
      description: section.description,
      effects: section.effects.map((name) => {
        const def = EFFECTS_REGISTRY[name];
        return {
          name,
          label: def.label,
          icon: def.icon,
          min: def.min,
          max: def.max,
          value: getValue(name),
          entityValue: getEntityValue(name),
          unit: def.unit,
          default: def.default,
          ...(def.hint && { hint: def.hint }),
        };
      }),
    }));
  }

  _updateEffectLabel(effectName, value) {
    // Every layout's value label reads _localEffects / the entity on render.
    this.requestUpdate();
  }

  // Current value of every effect: local (optimistic) value, then entity
  // attribute, then the registry default.
  _currentEffects(stateObj) {
    const effects = {};
    for (const name of EFFECT_NAMES) {
      effects[name] =
        this._localEffects[name] ??
        stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ??
        EFFECT_DEFAULTS[name];
    }
    return effects;
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
      // post-render paint uses the newest colours.
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

  // Convert a 100-entry matrix_colors array (RGB tuples) to CSS colors using
  // the same brightness-boost pipeline as the static preview. Extracted so the
  // native-effect animation loop renders identically to the normal path.
  _matrixColorsToGridColors(matrixColors, stateObj) {
    const entityBrightness = stateObj?.attributes?.brightness ?? 255;
    const darkenPercent = stateObj?.attributes?.preview_darken ?? 0;
    const previewBoost = previewBrightnessScale(
      entityBrightness,
      darkenPercent,
    );
    return matrixColors.map((c) => {
      let px = c;
      if (!Array.isArray(px) || px.length !== 3) px = [0, 0, 0];
      if (px[0] === 0 && px[1] === 0 && px[2] === 0) return rgbToCss([0, 0, 0]);
      return rgbToCss(
        px.map((v) => Math.min(255, Math.round(v * previewBoost))),
      );
    });
  }

  // Lazily cache the .lamp-dot NodeList so animation frames don't re-query the
  // DOM every tick. Invalidated (set null) whenever the matrix DOM is rebuilt;
  // a cache whose nodes Lit has since removed is re-queried as well.
  _getLampDots() {
    if (
      !this._lampDots ||
      this._lampDots.length === 0 ||
      (this.isConnected && !this._lampDots[0].isConnected)
    ) {
      this._lampDots = this.shadowRoot?.querySelectorAll(".lamp-dot") || [];
    }
    return this._lampDots;
  }

  // Observe the card so animations idle while it is scrolled off screen. Paired
  // with the tab-hidden pause inside createRafLoop.
  _ensureVisibilityTracker() {
    if (this._visTracker) return;
    this._visTracker = createVisibilityTracker(this, {
      onChange: (onScreen) => {
        this._onScreen = onScreen;
      },
    });
    this._onScreen = this._visTracker.onScreen;
    this._visTracker.connect();
  }

  // Begin the client-side approximation animation for Native Effect mode.
  _startNativeAnimation() {
    this._ensureVisibilityTracker();
    if (!this._nativeLoop) {
      this._nativeLoop = createRafLoop(() => this._nativeAnimFrame(), {
        minIntervalMs: 100, // ~10 fps
      });
    }
    if (this._nativeLoop.running) return;
    this._nativeAnimFrame(); // draw the first frame immediately
    this._nativeLoop.start();
  }

  _stopNativeAnimation() {
    if (this._nativeLoop) this._nativeLoop.stop();
    this._nativeAnimKey = null;
    this._nativeAnimStartedAt = null;
    this._nativeFrozenPhase = null;
  }

  // Begin the client-side clock animation. Solid/gradient styles only need a
  // slow tick for the colon blink and minute changes (500 ms); styles whose
  // mixer is a native effect animate that effect, so they tick at 100 ms. The
  // interval is re-evaluated each frame, so a style change adapts the rate.
  _startClockAnimation() {
    this._ensureVisibilityTracker();
    if (!this._clockLoop) {
      this._clockLoop = createRafLoop(() => this._clockAnimFrame(), {
        minIntervalMs: () => this._clockAnimInterval(),
      });
    }
    if (this._clockLoop.running) return;
    this._clockAnimFrame(); // draw the first frame immediately
    this._clockLoop.start();
  }

  _clockAnimInterval() {
    const attrs = this._hass?.states?.[this.config?.entity]?.attributes;
    const mixer = attrs ? clockStyleMixer(attrs) : 0;
    return CLOCK_MIXER_EFFECTS[mixer] ? 100 : 500;
  }

  _stopClockAnimation() {
    if (this._clockLoop) this._clockLoop.stop();
    this._clockAnimStartedAt = null;
    this._frozenBackgroundPhase = null;
  }

  _clockAnimFrame() {
    if (!this._onScreen) return;
    const st = this._hass?.states?.[this.config?.entity];
    if (!st || st.state !== "on" || st.attributes.content_mode !== "Clock") {
      this._stopClockAnimation();
      return;
    }
    const dots = this._getLampDots();
    if (!dots || dots.length !== 100) return; // matrix not rendered yet

    const now = performance.now();
    if (this._clockAnimStartedAt == null) this._clockAnimStartedAt = now;
    const rate = 0.25 + CLOCK_MIXER_EFFECT_SPEED / 55.0;
    // While frozen, hold the background effect on the frame the lamp holds;
    // the digits/colon (rendered from real time in renderClockFrame) still
    // advance. Resume seamlessly from the held phase.
    const frozen = st.attributes.display_frozen === true;
    if (frozen) {
      if (this._frozenBackgroundPhase == null)
        this._frozenBackgroundPhase =
          ((now - this._clockAnimStartedAt) / 1000) * rate;
    } else if (this._frozenBackgroundPhase != null) {
      this._clockAnimStartedAt =
        now - (this._frozenBackgroundPhase / rate) * 1000;
      this._frozenBackgroundPhase = null;
    }
    const phase =
      this._frozenBackgroundPhase ??
      ((now - this._clockAnimStartedAt) / 1000) * rate;
    const { fontMap, metrics } = this._getNativeClockFont();
    const pix = renderClockFrame(st.attributes, fontMap, metrics, phase);
    const grid = this._matrixColorsToGridColors(pix, st);
    this._updateMatrixColors(grid, st);
  }

  // Locate the component's "Font Characters" sensor and return the bundled
  // "native" clock font + its monospace metrics, so the preview matches the
  // font the lamp actually renders.  Cached per hass object for cheap lookups.
  _getNativeClockFont() {
    const states = this._hass?.states;
    if (!states) return { fontMap: null, metrics: null };
    if (this._nativeFontCacheStates === states && this._nativeFontCache)
      return this._nativeFontCache;
    let result = { fontMap: null, metrics: null };
    for (const eid in states) {
      const a = states[eid]?.attributes;
      if (a && a.font_maps && a.font_maps.native) {
        result = {
          fontMap: a.font_maps.native,
          metrics: (a.font_metrics || {}).native || null,
        };
        break;
      }
    }
    this._nativeFontCacheStates = states;
    this._nativeFontCache = result;
    return result;
  }

  _nativeAnimFrame() {
    if (!this._onScreen) return;
    const st = this._hass?.states?.[this.config?.entity];
    if (
      !st ||
      st.state !== "on" ||
      st.attributes.content_mode !== "Native Effect"
    ) {
      this._stopNativeAnimation();
      return;
    }
    const dots = this._getLampDots();
    if (!dots || dots.length !== 100) return; // matrix not rendered yet

    const effect = st.attributes.native_effect || "Streamer";
    const dir = st.attributes.native_effect_direction || "Up";
    const speed = Math.max(
      1,
      Math.min(100, Number(st.attributes.native_effect_speed ?? 50)),
    );
    const now = performance.now();
    const animationKey = `${effect}\u0000${dir}`;
    if (animationKey !== this._nativeAnimKey) {
      this._nativeAnimKey = animationKey;
      this._nativeAnimStartedAt = now;
      this._nativeFrozenPhase = null;
    }
    // Match the camera's phase mapping (native_effect_preview usage).
    const rate = 0.25 + speed / 55.0;
    // While frozen, hold the frame the lamp is holding; resume seamlessly.
    const frozen = st.attributes.display_frozen === true;
    if (frozen) {
      if (this._nativeFrozenPhase == null)
        this._nativeFrozenPhase =
          ((now - this._nativeAnimStartedAt) / 1000) * rate;
    } else if (this._nativeFrozenPhase != null) {
      this._nativeAnimStartedAt = now - (this._nativeFrozenPhase / rate) * 1000;
      this._nativeFrozenPhase = null;
    }
    const phase =
      this._nativeFrozenPhase ??
      ((now - this._nativeAnimStartedAt) / 1000) * rate;
    // Bottom-origin frame (row 0 = physical bottom), like the clock path: hand
    // it straight to _updateMatrixColors, whose layout indexFn provides the one
    // display flip. (A prior extra flip here double-flipped native effects, so
    // they showed upside-down vs the calibration card / lamp.)
    const raw = renderNativeEffectOriented(
      effect,
      phase,
      dir,
      st.attributes.native_effect_color || null,
      st.attributes.native_effect_color_mode || "normal",
    );
    const grid = this._matrixColorsToGridColors(raw, st);
    this._updateMatrixColors(grid, st);
  }

  // Update only matrix dot colors without rebuilding DOM
  _updateMatrixColors(gridColors, stateObj) {
    const dots = this._getLampDots();
    if (dots.length !== gridColors.length) {
      // Mismatch - need full render
      this._isInitialRenderComplete = false;
      this._refresh();
      return;
    }

    // If the device orientation changed, the grid geometry (rows/cols, tall vs
    // wide) changed too — a colour-only update can't fix that, so full re-render.
    const orientation = stateObj?.attributes?.device_orientation || "right";
    if (this._lastPreviewOrientation !== orientation) {
      this._lastPreviewOrientation = orientation;
      this._isInitialRenderComplete = false;
      this._refresh();
      return;
    }

    this._paintDots(gridColors, orientation, dots);
  }

  // Paint the .lamp-dot nodes directly. The dots have no reactive bindings, so
  // Lit never rewrites what the static preview or the animation loops paint.
  _paintDots(gridColors, orientation, dots = this._getLampDots()) {
    const layout = this._orientedLayout(orientation);
    const totalCols = layout.cols;

    dots.forEach((dot, idx) => {
      const row = Math.floor(idx / totalCols);
      const col = idx % totalCols;
      const colorIndex = layout.indexFn(row, col);

      const color = gridColors[colorIndex] || "#000000";

      // Change-only: the raw colour fully determines the black/empty/display
      // state, so skip the parse and DOM writes when it hasn't changed.
      if (dot._rawColor === color) return;
      dot._rawColor = color;

      const { isEmpty, displayColor } = this._dotAppearance(color);

      // Update background and class
      dot.style.background = displayColor;
      if (isEmpty) {
        dot.classList.add("lamp-dot-empty");
      } else {
        dot.classList.remove("lamp-dot-empty");
      }
    });
  }

  // Black detection (shared BLACK_THRESHOLD from matrix-const.js) and the
  // hide_black_dots display rule for one CSS colour.
  _dotAppearance(color) {
    let isBlack = false;
    if (color.startsWith("#")) {
      // Hex color format
      const hex = color.replace(/^#/, "");
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      isBlack =
        r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD;
    } else if (color.startsWith("rgb")) {
      // RGB color format
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        isBlack =
          r <= BLACK_THRESHOLD &&
          g <= BLACK_THRESHOLD &&
          b <= BLACK_THRESHOLD;
      }
    }
    const isEmpty = this.config.hide_black_dots ? isBlack : false;
    const displayColor =
      this.config.hide_black_dots && isBlack ? "transparent" : color;
    return { isEmpty, displayColor };
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

  // Map the physical device orientation to a preview grid geometry + a
  // function returning the gridColors index for each display cell (r,c).
  //   right / left : 20x5 landscape (identical preview; left only flips the lamp)
  //   up / down    : 5x20 tall. Both use the SAME 90deg rotation mapping — the
  //                  180deg difference between them comes from the lamp content
  //                  itself (up => _orientation normal, down => flipped). Using
  //                  different mappings here would cancel that content flip and
  //                  make up and down look identical.
  // gridColors is stored bottom-to-top, so the base landscape read is
  // (rows-1 - r)*20 + c (the historical vertical flip).
  _orientedLayout(orientation) {
    if (orientation === "up" || orientation === "down") {
      return {
        cols: 5,
        rows: 20,
        tall: true,
        indexFn: (r, c) => c * 20 + r,
      };
    }
    return {
      cols: 20,
      rows: 5,
      tall: false,
      indexFn: (r, c) => (4 - r) * 20 + c,
    };
  }

  // Container geometry of the matrix preview (shared by the Lit template and
  // the string renderer below).
  _matrixGeometry(stateObj) {
    const matrixBackground = this.config.matrix_background || "black";
    const matrixBoxShadow = this.config.matrix_box_shadow !== false;
    // Resolve pixel spacing mode (new tri-state) with backward compat for old booleans
    const spacingMode =
      this.config.matrix_spacing_mode ||
      (this.config.matrix_pixel_spacing === false ? "none" : "normal");
    const pixelGap = spacingMode === "normal" ? 4 : 0;
    const alignClass =
      this.config.align === "left"
        ? "align-left"
        : this.config.align === "right"
          ? "align-right"
          : "align-center";

    // Preview geometry follows the physical device orientation.
    const orientation = stateObj?.attributes?.device_orientation || "right";
    const layout = this._orientedLayout(orientation);
    const sizePct = this.config.size_pct || 100;
    return {
      layout,
      alignClass,
      outerStyle: `container-type:inline-size;max-width:100%;width:${layout.tall ? `${(85 * sizePct) / 100}px` : `${sizePct}%`};margin-inline:${this.config.align === "left" ? "0 auto" : this.config.align === "right" ? "auto 0" : "auto"};`,
      gridStyle:
        `width:100%;aspect-ratio:auto;padding:${previewLength(8)};border-radius:${previewLength(12)};` +
        `background: ${matrixBackground}; ` +
        `gap: ${previewLength(pixelGap)}; ` +
        `box-shadow: ${matrixBoxShadow ? `0 ${previewLength(2)} ${previewLength(8)} #0008` : "none"}; ` +
        `grid-template-columns: repeat(${layout.cols}, 1fr); ` +
        `grid-template-rows: repeat(${layout.rows}, 1fr);`,
    };
  }

  // Lit matrix preview. The dots are keyed by the full-update generation (so
  // every full update gets fresh nodes, like the former rebuild) and carry no
  // bindings: _paintDots and the animation loops own their colours.
  _matrixTemplate(stateObj) {
    const { layout, alignClass, outerStyle, gridStyle } =
      this._matrixGeometry(stateObj);
    const generation = this._dotGeneration;
    const indices = Array.from(
      { length: layout.rows * layout.cols },
      (_, index) => index,
    );
    return html`<div class=${alignClass} style=${outerStyle}>
      <div class="lamp-preview-css" style=${gridStyle}>
        ${repeat(
          indices,
          (index) => `${generation}:${index}`,
          () => html`<div class="lamp-dot"></div>`,
        )}
      </div>
    </div>`;
  }

  // HTML-string rendering of the same preview with its colours inline, for
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

  // Markup of the shared 4-way device orientation control (right / down /
  // left / up). The shared renderer returns an HTML string whose row carries
  // its click handler (handleOrientationControl) in data-on-click.
  _orientationMarkup(stateObj) {
    const current =
      this._orientationPending ||
      stateObj?.attributes?.device_orientation ||
      "right";
    const unavailable =
      !stateObj || ["unavailable", "unknown"].includes(stateObj.state);
    return renderOrientationControls(this.config, current, unavailable);
  }

  _orientationTemplate(stateObj) {
    const markup = this._orientationMarkup(stateObj);
    this._renderedOrientationKey = `${markup}\u0000${this._orientationError || ""}`;
    const error = this._orientationError
      ? html`<div class="orientation-error" role="alert">${this._orientationError}</div>`
      : nothing;
    return html`<div class="orientation-controls">${unsafeHTML(markup)}${error}</div>`;
  }

  // Re-render the orientation control when its markup or error changed, and
  // keep keyboard focus on the same button across the markup swap.
  _refreshOrientationControls() {
    const container = this.shadowRoot?.querySelector(".orientation-controls");
    if (!container) return;
    const markup = this._orientationMarkup(
      this._hass?.states[this.config?.entity],
    );
    if (
      `${markup}\u0000${this._orientationError || ""}` ===
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

  // Section / effect view data derived from SECTIONS_REGISTRY + EFFECTS_REGISTRY.
  _adjustmentSections(effects) {
    return SECTIONS_REGISTRY.map((section) => ({
      id: section.id,
      title: section.title,
      icon: section.icon,
      description: section.description,
      effects: section.effects.map((name) => {
        const def = EFFECTS_REGISTRY[name];
        return {
          name,
          label: def.label,
          icon: def.icon,
          min: def.min,
          max: def.max,
          value: effects[name],
          unit: def.unit,
          default: def.default,
          ...(def.hint && { hint: def.hint }),
        };
      }),
    }));
  }

  _adjustmentControlsTemplate(effects) {
    const layoutMode = this.config.adjustments_layout || "grouped";
    const sections = this._adjustmentSections(effects);
    if (layoutMode === "compact") return this._compactLayout(sections);
    if (layoutMode === "tabbed") return this._tabbedLayout(sections);
    if (layoutMode === "radial") return this._radialLayout(sections);
    if (layoutMode === "categories") return this._categoriesLayout(sections);
    // Default to "grouped" layout
    return this._groupedLayout(sections);
  }

  _sectionStyle() {
    return (
      this.config.section_style ||
      this.config.grouped_section_style ||
      "subtle"
    );
  }

  // Section reset button display for "always" / "changed" / "never".
  _sectionResetDisplay(sectionId, visible = "block") {
    const mode = this.config.reset_button_mode || "always";
    if (mode === "always") return visible;
    if (mode === "changed")
      return this._checkSectionChanges(sectionId) ? visible : "none";
    return "none";
  }

  _sectionIndicatorClass(sectionId) {
    const showIndicators = this.config?.show_change_indicators ?? true;
    return showIndicators && this._checkSectionChanges(sectionId)
      ? "change-indicator visible"
      : "change-indicator";
  }

  _effectDisplayValue(effect) {
    return effect.value !== undefined ? effect.value : effect.default;
  }

  // "value + unit" as one text node (e.g. "30°").
  _effectValueText(effect) {
    return `${this._effectDisplayValue(effect)}${effect.unit}`;
  }

  // One effect range input (all layouts share the drag guard and handler).
  _effectSlider(effect, className, step) {
    return html`<input
      type="range"
      min=${effect.min}
      max=${effect.max}
      step=${step ?? nothing}
      .value=${String(this._effectDisplayValue(effect))}
      class=${className}
      data-effect=${effect.name}
      data-default=${effect.default}
      @mousedown=${this._startDrag}
      @touchstart=${this._startDrag}
      @mouseup=${this._endDrag}
      @touchend=${this._endDrag}
      @input=${this._onEffectInput}
      @click=${className.includes("radial-effect-slider")
        ? this._stopPropagation
        : nothing}
    />`;
  }

  _onEffectInput(event) {
    this.handleEffectChange(event.currentTarget.dataset.effect, event);
  }

  _stopPropagation(event) {
    event.stopPropagation();
  }

  _onResetSection(event) {
    event.stopPropagation();
    this.resetSection(event.currentTarget.dataset.sectionId);
  }

  _onResetEffect(event) {
    this.resetEffect(event.currentTarget.dataset.effect);
  }

  // Compact Layout: All controls in a single clean panel with minimal spacing
  _compactLayout(sections) {
    const showIndicators = this.config?.show_change_indicators ?? true;
    const resetButtonMode = this.config.reset_button_mode || "always";
    const rows = sections.flatMap((section) =>
      section.effects.map((effect) => {
        const displayValue = this._effectDisplayValue(effect);
        const hasChanged = this._checkEffectChanged(effect.name);
        const resetButtonVisible =
          resetButtonMode === "always" ||
          (resetButtonMode === "changed" && hasChanged);
        return html`<div class="compact-slider-row">
          <span class="compact-icon">${effect.icon || section.icon}</span>
          <span class="compact-label">
            ${effect.label}
            ${showIndicators
              ? html`<span
                  class="change-indicator compact-indicator ${hasChanged
                    ? "visible"
                    : ""}"
                  data-effect=${effect.name}
                ></span>`
              : nothing}
          </span>
          ${this._effectSlider(effect, "compact-slider effect-slider")}
          <span class="compact-value" data-effect=${effect.name}
            >${this._effectValueText(effect)}</span
          >
          <button
            class="compact-reset-button"
            data-effect=${effect.name}
            @click=${this._onResetEffect}
            title="Reset ${effect.label}"
            style="display: ${resetButtonVisible ? "flex" : "none"};"
          >
            🔄
          </button>
        </div>`;
      }),
    );
    return html`<div
      class="effects-compact-container reset-mode-${resetButtonMode} style-${this._sectionStyle()}"
    >
      ${rows}
    </div>`;
  }

  // Tabbed Layout: Effects organized in tabs with smooth transitions
  _tabbedLayout(sections) {
    const activeTab = this._activeTab || sections[0].id;
    return html`<div
      class="effects-tabbed-container yc-stack yc-controls style-${this._sectionStyle()}"
    >
      <div class="tab-headers">
        ${sections.map(
          (section) =>
            html`<button
              class="tab-header ${section.id === activeTab ? "active" : ""}"
              title=${section.title}
              @click=${() => this.switchTab(section.id)}
            >
              <span class="tab-icon">${section.icon}</span>
              <span class="tab-title">${section.title}</span>
              <span
                class=${this._sectionIndicatorClass(section.id)}
                data-section-id=${section.id}
              ></span>
            </button>`,
        )}
      </div>
      <div class="tab-content-container">
        ${sections.map(
          (section) =>
            html`<div
              class="tab-content ${section.id === activeTab ? "active" : ""}"
              data-tab=${section.id}
              data-section-id=${section.id}
            >
              ${section.effects.map((effect) => {
                // Plain "Label: value" text: the steady-state output of the
                // former label updates (which replaced the initial <strong>).
                return html`<div class="tabbed-slider-row">
                  <div class="tabbed-label-row">
                    <label class="tabbed-label" data-effect=${effect.name}
                      >${`${effect.label}: ${this._effectValueText(effect)}`}</label
                    >
                    ${effect.hint
                      ? html`<span class="tabbed-hint">${effect.hint}</span>`
                      : nothing}
                  </div>
                  ${this._effectSlider(effect, "tabbed-slider effect-slider")}
                </div>`;
              })}
              <button
                class="tabbed-reset-button"
                data-section-id=${section.id}
                @click=${this._onResetSection}
                title="Reset ${section.title}"
                style="display: ${this._sectionResetDisplay(
                  section.id,
                  "flex",
                )};"
              >
                🔄 Reset
              </button>
            </div>`,
        )}
      </div>
    </div>`;
  }

  // Grouped Layout: Modern collapsible cards with better spacing (default)
  _groupedLayout(sections) {
    const sectionStyle = this._sectionStyle();
    const anyExpanded = Object.values(this._expandedSections).some(
      (value) => value === true,
    );
    return html`<div class="effects-grouped-container yc-stack yc-controls">
      ${sections.map((section, index) => {
        const isExpanded = this._expandedSections[section.id] === true;
        const state = isExpanded
          ? "expanded"
          : anyExpanded
            ? "collapsed hidden"
            : "collapsed";
        return html`<div
          class="grouped-section style-${sectionStyle} ${state}"
          data-section-id=${section.id}
          style="z-index: ${isExpanded ? 100 : 10 - index};"
        >
          <div
            class="grouped-header"
            @click=${() => this.toggleSection(section.id)}
          >
            <div class="grouped-header-left">
              <span class="grouped-icon"
                >${section.icon}<span
                  class=${this._sectionIndicatorClass(section.id)}
                  data-section-id=${section.id}
                ></span
              ></span>
              <div class="grouped-title-area">
                <span class="grouped-title">${section.title}</span>
                <span class="grouped-description">${section.description}</span>
              </div>
            </div>
            <div class="grouped-header-right">
              <button
                class="grouped-reset"
                data-section-id=${section.id}
                @click=${this._onResetSection}
                title="Reset ${section.title}"
                style="display: ${this._sectionResetDisplay(section.id)};"
              >
                🔄
              </button>
            </div>
          </div>
          <div class="grouped-content" data-section=${section.id}>
            ${section.effects.map(
              (effect) =>
                html`<div class="grouped-slider-row">
                  <div class="grouped-label-row">
                    <label class="grouped-label">${effect.label}</label>
                    <span class="grouped-value" data-effect=${effect.name}
                      >${this._effectValueText(effect)}</span
                    >
                  </div>
                  ${this._effectSlider(effect, "grouped-slider effect-slider")}
                  ${effect.hint
                    ? html`<span class="grouped-hint">${effect.hint}</span>`
                    : nothing}
                </div>`,
            )}
          </div>
        </div>`;
      })}
    </div>`;
  }

  // Radial Layout: Color wheel selector with dynamic slider panel
  _radialLayout(sections) {
    // Select active category (default to first section)
    if (!this._activeRadialCategory && sections[0]?.id) {
      this._activeRadialCategory = sections[0].id;
    }

    const activeCategory =
      this._activeRadialCategory || sections[0]?.id || null;
    const activeSection =
      sections.find((s) => s.id === activeCategory) || sections[0];

    // Select active effect within the category
    const selectedEffect =
      this._selectedRadialEffect || activeSection?.effects[0]?.name || null;

    const centerX = 0; // At the left edge
    const centerY = 80; // Vertically centered
    const outerRadius = 70;
    const innerRadius = 36;

    // Draw CATEGORY segments only (not individual effects)
    const numCategories = sections.length;
    const angleStep = 180 / numCategories; // Divide half-circle by number of categories
    const showIndicators = this.config?.show_change_indicators ?? true;

    const segments = sections.map((section, index) => {
      // Change to -90° to 90° to draw on the RIGHT side
      const startAngle = (-90 + index * angleStep) * (Math.PI / 180);
      const endAngle = (-90 + (index + 1) * angleStep) * (Math.PI / 180);

      // Segment path
      const x1 = centerX + innerRadius * Math.cos(startAngle);
      const y1 = centerY + innerRadius * Math.sin(startAngle);
      const x2 = centerX + outerRadius * Math.cos(startAngle);
      const y2 = centerY + outerRadius * Math.sin(startAngle);
      const x3 = centerX + outerRadius * Math.cos(endAngle);
      const y3 = centerY + outerRadius * Math.sin(endAngle);
      const x4 = centerX + innerRadius * Math.cos(endAngle);
      const y4 = centerY + innerRadius * Math.sin(endAngle);

      const isActive = section.id === activeCategory;
      const hasChanges =
        showIndicators && this._checkSectionChanges(section.id);

      let segmentClass = "radial-segment";
      if (isActive) segmentClass += " active-category";
      if (hasChanges) segmentClass += " has-changes";

      // Category icon in the ring
      const midAngle = (startAngle + endAngle) / 2;
      const iconRadius = (innerRadius + outerRadius) / 2;
      const iconX = centerX + iconRadius * Math.cos(midAngle);
      const iconY = centerY + iconRadius * Math.sin(midAngle);

      return svg`<path
          class=${segmentClass}
          d="M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1} Z"
          data-category=${section.id}
          data-section-id=${section.id}
          @click=${() => this.selectRadialCategory(section.id)}
        ><title>${section.title}</title></path>
        <text
          x=${iconX}
          y=${iconY}
          class="radial-icon ${isActive ? "active-category" : ""}"
          text-anchor="middle"
          dominant-baseline="middle"
          pointer-events="none"
        >${section.icon}</text>`;
    });

    // Separator lines between categories (drawn after the center)
    const separators = [];
    for (let i = 1; i < numCategories; i++) {
      const angle = (-90 + i * angleStep) * (Math.PI / 180);
      separators.push(svg`<line
          x1=${centerX + innerRadius * Math.cos(angle)}
          y1=${centerY + innerRadius * Math.sin(angle)}
          x2=${centerX + outerRadius * Math.cos(angle)}
          y2=${centerY + outerRadius * Math.sin(angle)}
          class="radial-separator"
          pointer-events="none"
        />`);
    }

    // Center half-circle (only draw the right half) and outer border arc
    const innerArcPath = `M ${centerX} ${centerY - innerRadius} A ${innerRadius} ${innerRadius} 0 0 1 ${centerX} ${centerY + innerRadius}`;
    const outerArcPath = `M ${centerX} ${centerY - outerRadius} A ${outerRadius} ${outerRadius} 0 0 1 ${centerX} ${centerY + outerRadius}`;

    return html`<div class="effects-radial-container style-${this._sectionStyle()}">
      <div class="radial-wheel-container">
        <svg class="radial-wheel" viewBox="-5 0 80 160">
          ${segments}
          <path
            d="${innerArcPath} L ${centerX} ${centerY + innerRadius} L ${centerX} ${centerY - innerRadius} Z"
            class="radial-center"
          />
          ${separators}
          <path
            d=${outerArcPath}
            class="radial-outer-border"
            pointer-events="none"
          />
          ${activeSection
            ? svg`<text
                x=${innerRadius / 2}
                y=${centerY}
                class="radial-center-icon"
                text-anchor="middle"
                dominant-baseline="middle"
              ><title>${activeSection.title}</title>${activeSection.icon}</text>`
            : nothing}
        </svg>
      </div>
      <div class="radial-slider-panel" data-section-id=${activeSection.id}>
        ${activeSection
          ? html`<div class="radial-category-header">
                <div class="radial-category-title">
                  ${activeSection.title}<span
                    class=${this._sectionIndicatorClass(activeSection.id)}
                    data-section-id=${activeSection.id}
                  ></span>
                </div>
                <button
                  class="radial-reset-button"
                  data-section-id=${activeSection.id}
                  @click=${this._onResetSection}
                  title="Reset ${activeSection.title}"
                  style="display: ${this._sectionResetDisplay(
                    activeSection.id,
                  )};"
                >
                  🔄 Reset
                </button>
              </div>
              ${activeSection.effects.map(
                (effect) =>
                  html`<div
                    class="radial-effect-row${effect.name === selectedEffect
                      ? " selected"
                      : ""}"
                    data-effect=${effect.name}
                  >
                    <div class="radial-effect-row-header">
                      <span class="radial-effect-row-label"
                        >${effect.label}</span
                      >
                      <span class="radial-effect-row-value"
                        >${this._effectValueText(effect)}</span
                      >
                    </div>
                    ${this._effectSlider(
                      effect,
                      "radial-effect-slider effect-slider",
                    )}
                  </div>`,
              )}`
          : nothing}
      </div>
    </div>`;
  }

  // Categories Layout: Icon column on left with category-based slider panel
  _categoriesLayout(sections) {
    const activeSection =
      sections.find((s) => s.id === this._activeRadialSection) || sections[0];
    this._activeRadialSection = activeSection.id;

    return html`<div
      class="effects-categories-container style-${this._sectionStyle()}"
    >
      <div class="categories-icon-column">
        ${sections.map(
          (section) =>
            html`<div
              class="categories-icon-button ${section.id === activeSection.id
                ? "active"
                : ""}"
              @click=${() => this.selectCircularCategory(section.id)}
              title=${section.title}
            >
              <span class="categories-icon-emoji">${section.icon}</span>
              <span
                class=${this._sectionIndicatorClass(section.id)}
                data-section-id=${section.id}
              ></span>
            </div>`,
        )}
      </div>
      <div class="categories-slider-panel" data-section-id=${activeSection.id}>
        <div class="categories-category-header">
          <div class="categories-category-title">${activeSection.title}</div>
          <button
            class="categories-reset-button"
            data-section-id=${activeSection.id}
            title="Reset ${activeSection.title}"
            @click=${this._onResetSection}
            style="display: ${this._shouldShowResetButton(activeSection.id)
              ? "block"
              : "none"};"
          >
            🔄 Reset
          </button>
        </div>
        ${activeSection.effects.map(
          (effect) =>
            html`<div class="categories-effect-row">
              <div class="categories-effect-row-header">
                <span class="categories-effect-row-label">${effect.label}</span>
                <span
                  class="categories-effect-row-value"
                  data-effect=${effect.name}
                  >${this._effectValueText(effect)}</span
                >
              </div>
              ${this._effectSlider(
                effect,
                "categories-effect-slider",
                effect.step || 1,
              )}
            </div>`,
        )}
      </div>
    </div>`;
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
      this._stylesCache = this._buildStylesText(pixelStyle, lampDotShadow);
    }
    return this._stylesCache;
  }

  _buildStylesText(pixelStyle, lampDotShadow) {
    const totalRows = 5;
    const totalCols = 20;
    return `
        /* Inject centralized button styles */
        ${exportImportButtonStyles}
        ${cardLayoutStyles}

        .yeelight-cube-lamp-preview-container {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          min-height: 0;
          padding: 12px;
        }
        .lamp-preview-css {
          width: 100%;
          aspect-ratio: ${totalCols} / ${totalRows};
          border-radius: 12px;
          display: grid;
          box-sizing: border-box;
          padding: 8px;
        }
        .lamp-preview-css.align-center {
          margin-left: auto;
          margin-right: auto;
        }
        .lamp-preview-css.align-left {
          margin-left: 0;
          margin-right: auto;
        }
        .lamp-preview-css.align-right {
          margin-left: auto;
          margin-right: 0;
        }
        .lamp-dot {
          width: 100%;
          height: 100%;
          border-radius: ${pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0px"};
          margin: auto;
          box-shadow: ${lampDotShadow ? `0 0 ${previewLength(2)} #0008` : "none"};
          transition: background 0.2s, border 0.2s;
          aspect-ratio: 1 / 1;
          border: none;
          cursor: pointer;
          box-sizing: border-box;
          display: block;
        }
        .lamp-dot.lamp-dot-empty {
          border: none;
          box-shadow: none;
          background: transparent !important;
        }
        .button-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          padding: 10px;
          margin: 10px 0;
        }
        ${orientationControlStyles}
        .button-row.two-buttons {
          justify-content: center;
        }
        .button-row .power-toggle-container,
        .button-row .force-refresh-container {
          padding: 0;
          margin: 0;
        }
        .force-refresh-container {
          display: inline-block;
          text-align: center;
          padding: 10px;
        }
        .force-refresh-btn {
          cursor: pointer;
        }
        .force-refresh-btn.loading {
          opacity: 0.6;
          cursor: wait;
        }
        .lamp-dot.lamp-dot-empty {
          border: none;
          box-shadow: none;
          background: transparent !important;
        }
        /* Brightness/value slider (all styles + interactions) — the full
           control CSS lives in the shared ./slider-control-utils.js module so
           the clock card and this card share one source of truth. */
        ${sliderControlStyles}
        .brightness-value {
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-top: 4px;
        }
        .adjustment-controls {
          width: 100%;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .color-effects-container {
          width: 100%;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .effect-section {
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          border-radius: 8px;
          overflow: hidden;
          background: var(--card-background-color, #1c1c1c);
        }
        .effect-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.05));
          transition: background 0.2s;
        }
        .effect-section-header:hover {
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.08));
        }
        .section-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          cursor: pointer;
          user-select: none;
        }
        .expand-icon {
          font-size: 12px;
          transition: transform 0.2s;
          color: var(--primary-color, #03a9f4);
        }
        .section-title {
          font-size: 0.95em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .reset-section-button {
          background: transparent;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          color: var(--primary-color, #03a9f4);
          padding: 6px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.2s;
        }
        .reset-section-button:hover {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, white);
          border-color: var(--primary-color, #03a9f4);
        }
        .reset-section-button ha-icon {
          width: 18px;
          height: 18px;
        }
        .effect-section-content {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: max-height 0.3s ease-out;
        }
        .adjustment-slider-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .adjustment-label {
          font-size: 0.9em;
          color: var(--primary-text-color);
          font-weight: 500;
        }
        .adjustment-slider {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, var(--disabled-text-color, #555), var(--divider-color, #aaa));
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .adjustment-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #2196f3);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .adjustment-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #2196f3);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .power-toggle-container {
          text-align: center;
          padding: 10px;
          margin: 10px;
        }
        
        .power-toggle-container button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .spinning {
          animation: spin 1s linear infinite;
        }

        .button-row .power-toggle-button {
          margin: 0;
        }

        /* === CHANGE INDICATOR === */
        .change-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          margin-left: 6px;
          opacity: 0;
          transform: scale(0);
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 0 8px rgba(255, 152, 0, 0.6);
          position: relative;
          top: -2px;
        }
        .change-indicator.visible {
          opacity: 1;
          transform: scale(1);
        }
        .change-indicator::after {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          border-radius: 50%;
          background: rgba(255, 152, 0, 0.3);
          animation: pulse-indicator 2s infinite;
        }
        @keyframes pulse-indicator {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.3); opacity: 0; }
        }

        /* === COMPACT LAYOUT RESET BUTTON === */
        .compact-reset-button {
          background: rgba(3, 169, 244, 0.1);
          border: 1.5px solid rgba(3, 169, 244, 0.4);
          color: var(--primary-color, #03a9f4);
          padding: 4px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 600;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 4px rgba(3, 169, 244, 0.2);
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .compact-reset-button:hover {
          background: rgba(3, 169, 244, 0.2);
          border-color: var(--primary-color, #03a9f4);
          transform: scale(1.1);
          box-shadow: 0 3px 8px rgba(3, 169, 244, 0.3);
        }
        .compact-reset-button:active {
          transform: scale(0.95);
        }

        /* === COMPACT LAYOUT === */
        .effects-compact-container {
          width: auto;
          /* padding: 12px; */
          display: flex;
          flex-direction: column;
          gap: 8px;
          /* background: var(--card-background-color, #1c1c1c); */
          border-radius: 8px;
        }
        .compact-slider-row {
          display: grid;
          grid-template-columns: 30px 100px 1fr 60px 32px;
          gap: 8px;
          align-items: center;
          padding: 6px;
          border-radius: 6px;
          transition: background 0.2s;
        }
        /* When reset buttons are never shown, remove the button column space */
        .reset-mode-never .compact-slider-row {
          grid-template-columns: 30px 100px 1fr 60px;
        }
        /* Compact: Flat */
        .effects-compact-container.style-flat .compact-slider-row {
          background: transparent;
        }
        .effects-compact-container.style-flat .compact-slider-row:hover {
          background: transparent;
        }
        /* Compact: Subtle */
        .effects-compact-container.style-subtle .compact-slider-row {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
        }
        .effects-compact-container.style-subtle .compact-slider-row:hover {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
        }
        /* Compact: Filled */
        .effects-compact-container.style-filled .compact-slider-row {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }
        .effects-compact-container.style-filled .compact-slider-row:hover {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }
        .compact-icon {
          font-size: 18px;
          text-align: center;
        }
        .compact-label {
          font-size: 0.85em;
          font-weight: 500;
          color: var(--primary-text-color);
          white-space: nowrap;
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .compact-indicator {
          display: inline-block;
          position: relative;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          opacity: 0;
          transform: scale(0);
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 0 6px rgba(255, 152, 0, 0.6);
          margin-left: 2px;
        }
        .compact-indicator.visible {
          opacity: 1;
          transform: scale(1);
        }
        .compact-indicator::after {
          content: '';
          position: absolute;
          top: -1px;
          left: -1px;
          right: -1px;
          bottom: -1px;
          border-radius: 50%;
          background: rgba(255, 152, 0, 0.3);
          animation: pulse-indicator 2s infinite;
        }
        .compact-slider {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: var(--disabled-text-color, #bbb);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .compact-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .compact-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .compact-value {
          font-size: 0.8em;
          color: var(--secondary-text-color);
          text-align: right;
          font-weight: 600;
          min-width: 50px;
        }

        /* === TABBED LAYOUT === */
        .effects-tabbed-container {
          /* width: 100%; */
          padding: 12px;
          border-radius: 8px;
        }
        .tab-headers {
          display: flex;
          gap: 4px;
          border-bottom: 2px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          justify-content: space-around;
        }
        .tab-header {
          background: transparent;
          border: none;
          padding: 10px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.9em;
          color: var(--secondary-text-color);
          border-bottom: 3px solid transparent;
          transition: all 0.2s;
          font-weight: 500;
          position: relative; /* For absolute positioning of indicator */
        }
        .tab-header:hover {
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.05));
          color: var(--primary-text-color);
        }
        .tab-header.active {
          color: var(--primary-color, #03a9f4);
          border-bottom-color: var(--primary-color, #03a9f4);
          font-weight: 600;
        }
        .tab-icon {
          font-size: 16px;
        }
        .tab-title {
          font-size: 0.95em;
        }
        /* Change indicator in tab header - positioned absolutely to not affect layout */
        .tab-header .change-indicator {
          position: absolute;
          top: 6px;
          right: 6px;
          margin-left: 0; /* Override default margin */
        }
        .tab-content-container {
          position: relative;
        }
        .tab-content {
          display: none;
        }
        .tab-content.active {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .tabbed-content-header {
          display: flex;
          align-items: center;
          border-radius: 8px;
        }
        .tabbed-content-title {
          margin: 0;
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-text-color);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tabbed-reset-button {
          padding: 4px 0;
          font-size: 0.9em;
          font-weight: 500;
          color: var(--primary-color, #03a9f4);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          margin: 0 0 0 auto;
          align-self: flex-end;
          text-decoration: none;
        }
        .tabbed-reset-button:hover {
          color: var(--primary-color-dark, #0288d1);
        }
        .tabbed-reset-button:active {
          opacity: 0.7;
        }
        .tabbed-slider-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px;
          border-radius: 6px;
        }
        /* Tabbed: Flat */
        .effects-tabbed-container.style-flat .tabbed-slider-row {
          background: transparent;
        }
        /* Tabbed: Subtle */
        .effects-tabbed-container.style-subtle .tabbed-slider-row {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
        }
        /* Tabbed: Filled */
        .effects-tabbed-container.style-filled .tabbed-slider-row {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }
        .tabbed-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .tabbed-label {
          font-size: 0.9em;
          color: var(--primary-text-color);
          font-weight: 500;
        }
        .tabbed-label strong {
          color: var(--primary-color, #03a9f4);
          margin-left: 4px;
        }
        .tabbed-hint {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          font-style: italic;
        }
        .tabbed-slider {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: var(--disabled-text-color, #bbb);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .tabbed-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .tabbed-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }

        /* === GROUPED LAYOUT (Modern Default) === */
        .effects-grouped-container {
          position: relative;
        }
        .grouped-section {
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
          transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                      margin 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                      opacity 0.3s ease,
                      border-color 0.3s ease,
                      box-shadow 0.3s ease,
                      transform 0.3s ease;
          position: relative;
          max-height: 1000px;
          opacity: 1;
        }
        /* Subtle: gentle tinted background */
        .grouped-section.style-subtle {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        /* Flat: transparent, blends with card/dashboard background */
        .grouped-section.style-flat {
          background: transparent;
          box-shadow: none;
        }
        /* Filled: full secondary background for strong separation */
        .grouped-section.style-filled {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .grouped-section.hidden {
          display: none;
          max-height: 0;
          opacity: 0;
          padding: 0;
          border: none;
          pointer-events: none;
        }
        .grouped-section:hover {
          border-color: rgba(3, 169, 244, 0.4);
          transform: translateY(-2px);
        }
        .grouped-section.style-subtle:hover,
        .grouped-section.style-filled:hover {
          box-shadow: 0 4px 16px rgba(3, 169, 244, 0.15);
        }
        .grouped-section.style-flat:hover {
          box-shadow: none;
        }
        .grouped-section.expanded {
          border-color: rgba(3, 169, 244, 0.3);
        }
        .grouped-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 10px 2px;
          background: transparent;
          cursor: pointer;
          user-select: none;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .grouped-header:hover {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }
        .grouped-header:active {
          transform: scale(0.99);
        }
        .grouped-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }
        .grouped-icon {
          font-size: 24px;
          min-width: 30px;
          text-align: center;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
          transition: transform 0.3s ease;
        }
        .grouped-section:hover .grouped-icon {
          transform: scale(1.1);
        }
        .grouped-title-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .grouped-title {
          font-size: 1em;
          font-weight: 700;
          color: var(--primary-text-color);
          letter-spacing: 0.3px;
        }
        .grouped-description {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          opacity: 0.8;
        }
        .grouped-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .grouped-reset {
          background: rgba(3, 169, 244, 0.1);
          border: 1.5px solid rgba(3, 169, 244, 0.4);
          color: var(--primary-color, #03a9f4);
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 6px rgba(3, 169, 244, 0.2);
        }
        .grouped-reset:hover {
          background: rgba(3, 169, 244, 0.2);
          border-color: var(--primary-color, #03a9f4);
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(3, 169, 244, 0.3);
        }
        .grouped-reset:active {
          transform: scale(0.95);
        }
        .grouped-content {
          max-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 10px;
          /* background: rgba(0, 0, 0, 0.2); */
          border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
          padding: 0 14px 0 14px;
          transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                      padding 0.3s ease;
        }
        .grouped-section.expanded .grouped-content {
          max-height: 2000px;
          padding: 12px 14px 14px 14px;
        }
        .grouped-slider-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
          /* padding: 10px; */
          background: transparent;
          border-radius: 6px;
          border: none;
          transition: all 0.2s ease;
        }
        .grouped-slider-row:hover {
          background: transparent;
        }
        .grouped-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .grouped-label {
          flex: 1;
          font-size: 0.95em;
          color: var(--primary-text-color);
          font-weight: 600;
        }
        .grouped-value {
          font-size: 0.9em;
          color: var(--primary-color, #03a9f4);
          font-weight: 700;
          min-width: 50px;
          text-align: right;
          font-family: 'Courier New', monospace;
          background: rgba(3, 169, 244, 0.1);
          padding: 4px 8px;
          border-radius: 4px;
        }
        .grouped-slider {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: var(--disabled-text-color, #bbb);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .grouped-slider:hover {
          height: 10px;
        }
        .grouped-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(145deg, var(--primary-color, #03a9f4), var(--primary-color-dark, #0288d1));
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(3, 169, 244, 0.5), 0 0 12px rgba(3, 169, 244, 0.3);
          transition: all 0.2s ease;
        }
        .grouped-slider::-webkit-slider-thumb:hover {
          width: 24px;
          height: 24px;
          box-shadow: 0 4px 12px rgba(3, 169, 244, 0.6), 0 0 16px rgba(3, 169, 244, 0.4);
        }
        .grouped-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(145deg, var(--primary-color, #03a9f4), var(--primary-color-dark, #0288d1));
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 8px rgba(3, 169, 244, 0.5), 0 0 12px rgba(3, 169, 244, 0.3);
          transition: all 0.2s ease;
        }
        .grouped-slider::-moz-range-thumb:hover {
          width: 24px;
          height: 24px;
          box-shadow: 0 4px 12px rgba(3, 169, 244, 0.6), 0 0 16px rgba(3, 169, 244, 0.4);
        }
        .grouped-hint {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          font-style: italic;
          margin-top: 4px;
        }

        /* === RADIAL LAYOUT === */

        /* ===== RADIAL LAYOUT STYLES ===== */
        .effects-radial-container {
          display: flex;
          gap: 0;
          padding: 16px;
          padding-left: 90px;
          padding-right: 0PX
          /* background: var(--card-background-color, #1c1c1c); */
          border-radius: 12px;
          align-items: flex-start;
          position: relative;
        }

        .radial-wheel-container {
          flex: 0 0 80px;
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          position: absolute;
          left: 0px;
          top: 0;
          z-index: 1;
          width: 80px;
          height: 160px;
          padding-top: 8px;
          overflow: visible;
        }

        .radial-wheel {
          width: 80px;
          height: 160px;
          filter: drop-shadow(1px 1px 3px rgba(0, 0, 0, 0.15));
          overflow: visible;
          will-change: auto;
          backface-visibility: hidden;
          transform: translateZ(0);
        }

        /* Single ring segments - clearly defined clickable areas */
        .radial-segment {
          fill: var(--card-background-color, #fff);
          stroke: none;
          cursor: pointer;
          transition: fill 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
                      stroke 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                      stroke-width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                      filter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          will-change: fill, stroke;
        }

        .radial-segment:hover {
          fill: var(--secondary-background-color, rgba(200, 200, 200, 0.3));
        }

        .radial-segment.active-category {
          fill: rgba(3, 169, 244, 0.15);
          stroke: rgba(3, 169, 244, 0.6);
          stroke-width: 1;
        }

        /* Highlight segments with changed values */
        .radial-segment.has-changes {
          fill: rgba(255, 152, 0, 0.12);
          stroke: rgba(255, 152, 0, 0.5);
          stroke-width: 1.5;
        }

        .radial-segment.has-changes:hover {
          fill: rgba(255, 152, 0, 0.2);
        }

        /* Active category with changes - combine both styles */
        .radial-segment.active-category.has-changes {
          fill: rgba(255, 152, 0, 0.25);
          stroke: rgba(255, 152, 0, 0.7);
          stroke-width: 2;
          filter: drop-shadow(0 0 6px rgba(255, 152, 0, 0.4));
        }

        .radial-separator {
          display: block;
          stroke: var(--divider-color, rgba(200, 200, 200, 0.3));
          stroke-width: 1.5;
          pointer-events: none;
        }

        /* Outer circle border */
        .radial-outer-border {
          display: block;
          fill: none;
          stroke: var(--divider-color, rgba(200, 200, 200, 0.3));
          stroke-width: 1.5;
          pointer-events: none;
        }

        .radial-segment.selected {
          fill: var(--primary-color, #03a9f4);
          stroke: var(--primary-color, #03a9f4);
          stroke-width: 2;
          filter: drop-shadow(0 0 6px var(--primary-color, #03a9f4));
        }

        .radial-icon {
          font-size: 14px;
          fill: var(--secondary-text-color, rgba(128, 128, 128, 0.7));
          transition: all 0.3s ease;
          pointer-events: none;
        }

        .radial-icon.active-category {
          font-size: 15px;
          fill: rgba(3, 169, 244, 0.8);
        }

        .radial-icon.selected {
          font-size: 16px;
          fill: var(--text-primary-color, #fff);
          filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.9));
        }

        /* Center circle */
        .radial-center {
          fill: var(--card-background-color, #fff);
          stroke: var(--divider-color, rgba(0, 0, 0, 0.12));
          stroke-width: 1;
        }

        .radial-center-icon {
          font-size: 22px;
          fill: var(--primary-color, #03a9f4);
          pointer-events: none;
          /* filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4)); */
        }

        /* Slider panel */
        .radial-slider-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
          /* padding: 0 12px; */
          /* background: var(--card-background-color, #1c1c1c); */
          /* border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08); */
          margin-left: 0;
          position: relative;
          z-index: 2;
        }

        .radial-category-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          margin-bottom: 4px;
        }

        .radial-category-title {
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-text-color);
          align-self: self-start;
        }

        .radial-reset-button {
          padding: 6px 12px;
          font-size: 0.9em;
          font-weight: 500;
          color: var(--primary-color, #03a9f4);
          background: rgba(3, 169, 244, 0.1);
          border: 1px solid var(--primary-color, #03a9f4);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
              position: absolute;
    right: 0;
        }

        .radial-reset-button:hover {
          background: rgba(3, 169, 244, 0.2);
          transform: scale(1.05);
        }

        .radial-reset-button:active {
          transform: scale(0.95);
        }

        .radial-effect-row {
          /* padding: 8px; */
          border-radius: 6px;
          border: none;
          transition: all 0.2s ease;
          cursor: default;
        }
        /* Radial: Flat */
        .effects-radial-container.style-flat .radial-effect-row {
          background: transparent;
        }
        .effects-radial-container.style-flat .radial-effect-row:hover {
          background: transparent;
        }
        /* Radial: Subtle */
        .effects-radial-container.style-subtle .radial-effect-row {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
        }
        .effects-radial-container.style-subtle .radial-effect-row:hover {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
        }
        /* Radial: Filled */
        .effects-radial-container.style-filled .radial-effect-row {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }
        .effects-radial-container.style-filled .radial-effect-row:hover {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }

        .radial-effect-row.selected {
          background: transparent;
          box-shadow: none;
        }

        .radial-effect-row-header {
          display: flex;
          align-items: center;
          gap: 10px;
          /* margin-bottom: 6px; */
        }

        .radial-effect-row-icon {
          display: none; /* Icons removed */
        }

        .radial-effect-row-label {
          flex: 1;
          font-size: 0.95em;
          font-weight: 500;
          color: var(--primary-text-color);
        }

        .radial-effect-row-value {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-color, #03a9f4);
          min-width: 45px;
          text-align: right;
          font-family: 'Courier New', monospace;
        }

        .radial-effect-slider {
          width: 100%;
          height: 5px;
          border-radius: 2.5px;
          background: var(--disabled-text-color, linear-gradient(to right, #444, #888));
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .radial-effect-slider:hover {
          height: 6px;
        }

        .radial-effect-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .radial-effect-slider::-webkit-slider-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        .radial-effect-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .radial-effect-slider::-moz-range-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        /* Responsive adjustments for radial layout */
        @media (max-width: 768px) {
          .effects-radial-container {
            flex-direction: row;
            padding: 12px;
            padding-left: 80px;
            align-items: flex-start;
            position: relative;
            gap: 8px;
          }

          .radial-wheel-container {
            flex: 0 0 80px;
            left: 0;
            position: absolute;
            z-index: 1;
            width: 80px;
            height: 160px;
            top: 12px;
          }
          
          .radial-wheel {
            width: 80px;
            height: 160px;
          }

          .radial-slider-panel {
            flex: 1;
            margin-left: 0;
            background: var(--card-background-color, #1c1c1c);
            position: relative;
            z-index: 2;
            min-width: 0;
          }
          
          /* Keep all icons visible on mobile */
          .radial-icon {
            font-size: 12px;
          }
          
          .radial-icon.active-category {
            font-size: 14px;
          }
        }

        /* ===== CATEGORIES LAYOUT STYLES ===== */
        .effects-categories-container {
          display: flex;
          gap: 12px;
         /*  padding: 12px;
          background: var(--card-background-color, #1c1c1c); */
          border-radius: 8px;
          align-items: stretch;
        }

        /* Icon column on left */
        .categories-icon-column {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          /* gap: 12px;
          padding: 12px; */
          background: transparent;
          border-radius: 8px;
          border: none;
        }

        .categories-icon-button {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: transparent;
          border: 1px solid transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          position: relative; /* For absolute positioning of indicator */
        }

        .categories-icon-button:hover {
          background: var(--secondary-background-color, rgba(200, 200, 200, 0.15));
          border-color: var(--divider-color, rgba(200, 200, 200, 0.2));
          transform: scale(1.1);
        }

        .categories-icon-button.active {
          background: rgba(3, 169, 244, 0.15);
          border: 2px solid rgba(3, 169, 244, 0.6);
          box-shadow: 0 0 12px rgba(3, 169, 244, 0.4);
        }

        .categories-icon-emoji {
          font-size: 20px;
          transition: all 0.3s ease;
        }

        .categories-icon-button.active .categories-icon-emoji {
          filter: drop-shadow(0 0 4px rgba(3, 169, 244, 0.6));
        }

        /* Indicator positioning for categories layout */
        .categories-icon-button .change-indicator {
          position: absolute;
          top: -2px;
          right: -2px;
          margin-left: 0;
        }

        /* Slider panel */
        .categories-slider-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          /* gap: 10px;
          padding: 12px; */
          background: transparent;
          border-radius: 8px;
          border: none;
        }

        .categories-category-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--divider-color, rgba(200, 200, 200, 0.15));
          margin-bottom: 6px;
        }

        .categories-category-title {
          font-size: 1.15em;
          font-weight: 600;
          color: var(--primary-text-color);
        }

        .categories-reset-button {
          padding: 6px 12px;
          margin: -2px 0;
          font-size: 0.9em;
          font-weight: 500;
          color: var(--primary-color, #03a9f4);
          background: rgba(3, 169, 244, 0.1);
          border: 1px solid var(--primary-color, #03a9f4);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .categories-reset-button:hover {
          background: rgba(3, 169, 244, 0.2);
          transform: scale(1.05);
        }

        .categories-reset-button:active {
          transform: scale(0.95);
        }

        .categories-effect-row {
          padding: 8px;
          border-radius: 6px;
          border: none;
          transition: all 0.2s ease;
        }
        /* Categories: Flat */
        .effects-categories-container.style-flat .categories-effect-row {
          background: transparent;
        }
        .effects-categories-container.style-flat .categories-effect-row:hover {
          background: transparent;
        }
        /* Categories: Subtle */
        .effects-categories-container.style-subtle .categories-effect-row {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
        }
        .effects-categories-container.style-subtle .categories-effect-row:hover {
          background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
        }
        /* Categories: Filled */
        .effects-categories-container.style-filled .categories-effect-row {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }
        .effects-categories-container.style-filled .categories-effect-row:hover {
          background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        }

        .categories-effect-row-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 6px;
        }

        .categories-effect-row-label {
          flex: 1;
          font-size: 0.95em;
          font-weight: 500;
          color: var(--primary-text-color);
        }

        .categories-effect-row-value {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-color, #03a9f4);
          min-width: 45px;
          text-align: right;
          font-family: 'Courier New', monospace;
        }

        .categories-effect-slider {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: var(--disabled-text-color, #bbb);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .categories-effect-slider:hover {
          height: 7px;
        }

        .categories-effect-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .categories-effect-slider::-webkit-slider-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        .categories-effect-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .categories-effect-slider::-moz-range-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        /* Responsive adjustments for circular layout */
        @media (max-width: 768px) {
          .effects-circular-container {
            flex-direction: column;
            align-items: center;
          }

          .circular-wheel-container {
            margin-bottom: 16px;
          }

          .circular-slider-panel {
            width: 100%;
          }
        }
    `;
  }

  connectedCallback() {
    super.connectedCallback();
    // Slider and orientation markup name their handlers in data-on-*.
    bindHostEvents(this, (name) => isSliderHandler(name) || name === "handleOrientationControl");
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
