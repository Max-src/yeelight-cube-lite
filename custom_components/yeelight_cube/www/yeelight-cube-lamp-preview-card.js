import { renderDotMatrix, rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { escapeHtml } from "./html-escape-utils.js";
import { getInitialMatrix } from "./draw_card_state.js";
import { renderNativeEffect } from "./native-effect-preview.js";
import {
  BLACK_THRESHOLD,
  PREVIEW_MIN_BRIGHTNESS_BOOST,
  PREVIEW_MAX_DARKEN_PERCENT,
  PREVIEW_BRIGHTNESS_GAMMA,
} from "./draw_card_const.js";
import {
  exportImportButtonStyles,
  getExportImportButtonClass,
  renderButtonContent,
} from "./export-import-button-utils.js";
import {
  renderCapsuleHTML,
  getCapsuleCSS,
  updateCapsuleVisuals,
  resolveCapsuleTheme,
  resolveCapsuleThickness,
} from "./capsule-slider-utils.js";

// ── Clock face pixel renderer (mirrors Python camera.py _get_clock_preview) ──
// Basic-font glyph data: each value is a list of positions (row*20+col)
const _CLOCK_FONT = {
  0: [1, 20, 22, 40, 42, 60, 62, 81, 0, 2, 80, 82],
  1: [0, 1, 2, 21, 41, 61, 81, 80],
  2: [0, 1, 2, 20, 41, 62, 80, 81, 82, 42, 40],
  3: [0, 1, 22, 41, 62, 80, 81, 2, 42, 82],
  4: [2, 22, 40, 41, 42, 60, 62, 80, 82],
  5: [0, 1, 22, 40, 41, 60, 80, 81, 82, 2, 42],
  6: [1, 20, 22, 40, 41, 60, 81, 82, 80, 42, 0, 2],
  7: [1, 21, 41, 62, 80, 81, 82],
  8: [1, 20, 22, 41, 60, 62, 81, 0, 2, 80, 82, 40, 42],
  9: [0, 1, 22, 41, 42, 60, 62, 81, 80, 82, 40, 2],
  ":": [20, 60],
  " ": [],
};

function _clockGlyphWidth(glyph) {
  return new Set(glyph.map((p) => p % 20)).size;
}

function _clockGradientColor(palette, factor) {
  factor = Math.max(0.0, Math.min(1.0, factor));
  if (palette.length === 1) return palette[0];
  const scaled = factor * (palette.length - 1);
  const idx = Math.min(palette.length - 2, Math.floor(scaled));
  const local = scaled - idx;
  const s = palette[idx],
    e = palette[idx + 1];
  return [
    Math.round(s[0] + (e[0] - s[0]) * local),
    Math.round(s[1] + (e[1] - s[1]) * local),
    Math.round(s[2] + (e[2] - s[2]) * local),
  ];
}

function _clockPixelColor(styleId, charIndex, col) {
  const fixed = {
    2: [0, 221, 255],
    4: [255, 255, 255],
    5: [34, 238, 178],
    6: [255, 238, 0],
    7: [255, 44, 222],
    8: [255, 45, 40],
    9: [0, 222, 255],
    10: [132, 24, 238],
  };
  if (fixed[styleId]) return fixed[styleId];
  if (styleId === 3)
    return [
      [243, 38, 229],
      [43, 120, 255],
      [21, 223, 131],
      [125, 255, 23],
    ][charIndex % 4];
  if (styleId === 12)
    return [
      [70, 132, 255],
      [255, 230, 39],
    ][charIndex % 2];
  const palettes = {
    1: [
      [255, 55, 20],
      [255, 201, 30],
      [44, 238, 88],
      [38, 157, 255],
      [230, 31, 224],
    ],
    11: [
      [255, 93, 19],
      [235, 64, 91],
      [124, 25, 242],
    ],
    13: [
      [35, 92, 230],
      [73, 143, 255],
      [229, 246, 255],
    ],
    14: [
      [25, 143, 255],
      [56, 183, 255],
      [230, 248, 255],
    ],
  };
  return _clockGradientColor(palettes[styleId] || [[255, 238, 0]], col / 19);
}

/**
 * Render one clock frame as 100 [r,g,b] pixels (row-major, row 0 = top).
 * Mirrors _get_clock_preview() in camera.py, including colon blink.
 */
function renderClockFrame(attrs) {
  const COLS = 20;
  const now = new Date();
  const tsSec = now.getTime() / 1000;

  const showDate = !!attrs.clock_show_date;
  const datePhase = showDate && Math.floor(tsSec / 5) % 2 === 1;

  let text;
  if (datePhase) {
    text =
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
  } else {
    let h = now.getHours();
    if (attrs.clock_12_hour) h = h % 12 || 12;
    text =
      String(h).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");
  }

  const colonVisible = !(
    !datePhase &&
    !!attrs.clock_colon_blink &&
    now.getSeconds() % 2 === 1
  );

  const styleId = attrs.clock_style_id ?? 6;
  const matrix = Array.from({ length: 100 }, () => [0, 0, 0]);
  const chars = [...text];
  const glyphs = chars.map((c) => _CLOCK_FONT[c] || []);
  const widths = glyphs.map(_clockGlyphWidth);
  const totalWidth =
    widths.reduce((a, b) => a + b, 0) + Math.max(0, chars.length - 1);
  let offset = Math.max(0, Math.floor((COLS - totalWidth) / 2));

  for (let i = 0; i < chars.length; i++) {
    const width = widths[i];
    if (chars[i] === ":" && !colonVisible) {
      offset += width + 1;
      continue;
    }
    for (const pos of glyphs[i]) {
      const col = (pos % COLS) + offset;
      const row = Math.floor(pos / COLS);
      if (col >= 0 && col < COLS && row >= 0 && row < 5)
        matrix[row * COLS + col] = _clockPixelColor(styleId, i, col);
    }
    offset += width + 1;
  }
  return matrix;
}

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

// ================================================

class YeelightCubeLampPreviewCard extends HTMLElement {
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
    this._brightnessDebounceTimer = null;
    this._realBrightnessDebounceTimer = null;
    this._effectDebounceTimer = null;
    this._renderDebounceTimer = null; // Debounce rendering to avoid flicker
    this._renderScheduled = false;

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
  }
  setConfig(config) {
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
      brightness_slider_appearance: "default", // Legacy: Appearance for slider mode (migrated to thickness)
      brightness_slider_thickness: 6, // Track thickness in px (2-20, replaces appearance)
      brightness_label_mode: "text", // NEW: Brightness label mode (none, text, icon, icon_text)
      brightness_max: 500, // NEW: Maximum brightness value (default 500 to test beyond 255)
      show_power_toggle: true, // NEW: Show on/off toggle button by default
      show_force_refresh_button: true, // Show force refresh button (raw TCP bypass)
      show_device_orientation: true, // Show the 4-way device orientation control

      hide_black_dots: false, // NEW: Ignore black pixels on preview (default: false = OFF)
      show_lamp_preview: true, // NEW: Show lamp matrix preview by default
      show_adjustment_controls: false, // Deprecated: Use light brightness control instead
      ...config,
    };
    // Support legacy config migrations
    if (config.reconnect_button_style && !config.buttons_style) {
      this.config.buttons_style = config.reconnect_button_style;
    }

    // Force full re-render when config changes
    this._isInitialRenderComplete = false;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.render();
      });
    }
  }

  set hass(hass) {
    const _t0 = performance.now();
    this._hass = hass;

    // Clean up local effects that match the entity state
    // This prevents flickering when entity state updates after a service call
    // Reduced to 50ms since Python now returns state updates immediately
    const timeSinceLastServiceCall = Date.now() - this._lastServiceCallTime;
    const canClearLocalEffects = timeSinceLastServiceCall > 50;

    if (
      canClearLocalEffects &&
      this.config &&
      this.config.entity &&
      hass.states[this.config.entity]
    ) {
      // Don't clear _localEffects when entity state matches!
      // We need to keep tracking values that differ from defaults
      // for the change indicator system to work properly.
      // _localEffects should only be cleared by explicit reset actions.
    }

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
    const matrixColorsChanged =
      JSON.stringify(currentMatrixColors) !==
      JSON.stringify(this._lastMatrixColors);

    if (matrixColorsChanged) {
      const updateEpoch = this.config?.entity
        ? hass.states[this.config.entity]?.attributes?._update_epoch
        : null;
      const latencyStr = updateEpoch
        ? ` latency=${(Date.now() / 1000 - updateEpoch).toFixed(2)}s`
        : "";
    }

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
        this.render();
      }, 250); // Increased from 150ms to 250ms for better performance
    } else if (!hasPendingLocalEffects || stateChanged || matrixColorsChanged) {
      // Normal rendering for non-brightness changes
      // Always render to update matrix - slider protection is inside _updateSliderValues
      // Also render when matrix_colors change (effect updates from backend)
      if (matrixColorsChanged && currentMatrixColors !== null) {
        this._lastMatrixColors = currentMatrixColors;
      }
      this.render();
    }
  }

  async forceRefreshLamp() {
    if (!this._hass || !this.config || !this.config.entity) {
      return;
    }

    this._forceRefreshLoading = true;
    this.render();

    try {
      await this._hass.callService("yeelight_cube", "force_refresh", {
        entity_id: this.config.entity,
      });
      // Brief delay so the user sees visual feedback
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error("[FORCE REFRESH] Service call failed:", error);
    } finally {
      this._forceRefreshLoading = false;
      this.render();
    }
  }

  async handlePowerToggle() {
    if (!this._hass || !this.config || !this.config.entity) {
      return;
    }

    const stateObj = this._hass.states[this.config.entity];
    if (!stateObj) return;

    const currentState = stateObj.state === "on";
    const expectedState = !currentState; // We're toggling

    // Show loading state immediately and track expected state
    this._powerToggling = true;
    this._expectedPowerState = expectedState;
    this._updatePowerButtonLoadingState(true);

    try {
      // Toggle the light (same as clicking toggle in HA light card)
      await this._hass.callService("light", "toggle", {
        entity_id: this.config.entity,
      });

      // Safety timeout: clear loading after 5 seconds if state doesn't update.
      // Tracked + isConnected-guarded so a removed card can't touch the DOM.
      if (this._powerToggleSafetyTimer) {
        clearTimeout(this._powerToggleSafetyTimer);
      }
      this._powerToggleSafetyTimer = setTimeout(() => {
        this._powerToggleSafetyTimer = null;
        if (!this.isConnected) return;
        if (this._powerToggling) {
          console.warn("[POWER BUTTON] Timeout - clearing loading state");
          this._powerToggling = false;
          this._expectedPowerState = null;
          this._updatePowerButtonLoadingState(false);
        }
      }, 5000);
    } catch (error) {
      console.error("Error toggling light:", error);
      this._powerToggling = false;
      this._expectedPowerState = null;
      this._updatePowerButtonLoadingState(false);
    }
  }

  handleBrightnessWheel(event) {
    event.preventDefault();
    const container = event.currentTarget;

    // Check if it's a rotary container
    if (container.classList.contains("brightness-rotary-wrapper")) {
      const slider = container.querySelector(".brightness-slider-rotary");
      if (slider) {
        const currentValue = parseInt(slider.value);
        const delta = event.deltaY < 0 ? 5 : -5;
        const newValue = Math.max(1, Math.min(100, currentValue + delta));
        slider.value = newValue;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else {
      // Regular slider modes (including capsule via shared util)
      const slider =
        container.querySelector(".brightness-slider") ||
        container.querySelector(".capsule-input");
      if (slider) {
        const currentValue = parseInt(slider.value);
        const delta = event.deltaY < 0 ? 5 : -5;
        const newValue = Math.max(1, Math.min(100, currentValue + delta));
        slider.value = newValue;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  handleRotaryClick(event) {
    const container = event.currentTarget;

    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate angle from center
    let angle =
      Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
    // Normalize to 0-360
    angle = (angle + 360) % 360;

    // The gauge starts at 135° (bottom-left) and goes 270° clockwise
    // Adjust angle relative to start position
    let adjustedAngle = angle - 135;
    if (adjustedAngle < 0) adjustedAngle += 360;

    // Map to 0-270 range, clamping values outside the arc
    if (adjustedAngle > 270) {
      // Click is in the dead zone (between end and start of arc)
      // Snap to nearest end
      adjustedAngle = adjustedAngle > 315 ? 0 : 270;
    }

    // Convert angle to brightness (1-100)
    const brightness = Math.round((adjustedAngle / 270) * 99) + 1;

    // Update the hidden slider and trigger change
    const slider = container.querySelector(".brightness-slider-rotary");

    if (slider) {
      slider.value = brightness;

      // Directly call handleBrightnessChange instead of relying on event dispatch
      const changeEvent = { target: slider };
      this.handleBrightnessChange(changeEvent);
    } else {
      console.error("[Rotary Click] ERROR: Slider not found!");
    }
  }

  handleRotaryDragStart(event) {
    this._rotaryDragging = true;
    this._startDrag();
    this.handleRotaryClick(event);

    const container = event.currentTarget;

    const handleMove = (e) => {
      if (!this._rotaryDragging) return;
      e.preventDefault();
      const clientX = e.clientX || e.touches?.[0]?.clientX;
      const clientY = e.clientY || e.touches?.[0]?.clientY;
      if (clientX !== undefined && clientY !== undefined) {
        const rect = container.getBoundingClientRect();
        const moveEvent = {
          currentTarget: container,
          clientX,
          clientY,
        };
        this.handleRotaryClick(moveEvent);
      }
    };

    const handleEnd = () => {
      this._rotaryDragging = false;
      this._endDrag();
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
      this._dragCleanup = null;
    };

    // Store references so disconnectedCallback can clean up mid-drag
    this._dragCleanup = { handleMove, handleEnd };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleMove);
    document.addEventListener("touchend", handleEnd);
  }

  handleRotaryStep(delta) {
    // Find whichever brightness input is currently rendered (all modes give it .brightness-slider;
    // capsule mode uses .capsule-input from the shared capsule utility)
    const input =
      this.shadowRoot?.querySelector(".brightness-slider") ||
      this.shadowRoot?.querySelector(".capsule-input");
    if (!input) return;
    const cur = parseInt(input.value) || 1;
    const newVal = Math.max(1, Math.min(100, cur + delta));
    input.value = newVal;
    this.handleBrightnessChange({ target: { value: newVal } });
  }

  // ===== Preset wheel handlers =====
  _getWheelStops() {
    const step = Math.max(
      1,
      Math.min(50, parseInt(this.config.brightness_wheel_step) || 10),
    );
    const stops = [];
    for (let v = step; v <= 100; v += step) stops.push(v);
    if (stops[stops.length - 1] !== 100) stops.push(100);
    return stops;
  }

  handleWheelTick(value) {
    const input = this.shadowRoot?.querySelector(".brightness-slider-wheel");
    if (input) input.value = value;
    this.handleBrightnessChange({ target: { value } });
  }

  handleWheelDragStart(event) {
    event.preventDefault();
    const viewport = event.currentTarget;
    const startX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const stops = this._getWheelStops();
    const input = viewport
      .closest(".brightness-wheel-wrapper")
      ?.querySelector(".brightness-slider-wheel");
    const startValue = parseInt(input?.value) || stops[0];
    let startIdx = stops.reduce(
      (best, v, i) =>
        Math.abs(v - startValue) < Math.abs(stops[best] - startValue)
          ? i
          : best,
      0,
    );
    // Compute tick width from DOM (or estimate)
    const tick = viewport.querySelector(".brightness-wheel-tick");
    const tickW = tick ? tick.offsetWidth || 52 : 52;

    this._startDrag();

    const handleMove = (e) => {
      const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const dx = cx - startX;
      const steps = Math.round(-dx / tickW);
      const idx = Math.max(0, Math.min(stops.length - 1, startIdx + steps));
      const value = stops[idx];
      if (input && parseInt(input.value) !== value) {
        input.value = value;
        this.handleBrightnessChange({ target: { value } });
      }
    };
    const handleEnd = () => {
      this._endDrag();
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
  }

  handleWheelStep(event) {
    event.preventDefault();
    event.stopPropagation();
    const input = this.shadowRoot?.querySelector(".brightness-slider-wheel");
    if (!input) return;
    const stops = this._getWheelStops();
    const cur = parseInt(input.value) || stops[0];
    let idx = stops.reduce(
      (best, v, i) =>
        Math.abs(v - cur) < Math.abs(stops[best] - cur) ? i : best,
      0,
    );
    // Support both vertical and horizontal scroll. Increase when scrolling up
    // (deltaY < 0) or right (deltaX > 0); decrease otherwise.
    const goUp =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY < 0
        : event.deltaX > 0;
    idx = goUp ? Math.min(stops.length - 1, idx + 1) : Math.max(0, idx - 1);
    const value = stops[idx];
    input.value = value;
    this.handleBrightnessChange({ target: { value } });
  }

  _updateWheelVisual(brightness) {
    const stops = this._getWheelStops();
    const activeIndex = stops.reduce(
      (best, v, i) =>
        Math.abs(v - brightness) < Math.abs(stops[best] - brightness)
          ? i
          : best,
      0,
    );
    const tick = this.shadowRoot?.querySelector(".brightness-wheel-tick");
    const tickW = tick ? tick.offsetWidth || 52 : 52;
    const track = this.shadowRoot?.querySelector(".brightness-wheel-track");
    if (track)
      track.style.setProperty(
        "--wheel-shift",
        `${-(activeIndex * tickW + tickW / 2)}px`,
      );
    const ticks = this.shadowRoot?.querySelectorAll(".brightness-wheel-tick");
    if (ticks)
      ticks.forEach((t, i) => t.classList.toggle("active", i === activeIndex));
    const val = this.shadowRoot?.querySelector(".brightness-wheel-value");
    if (val)
      val.textContent =
        this.config.show_brightness_percentage !== false
          ? `${brightness}%`
          : "";
  }

  // ===== Matrix fill handlers =====
  handleMatrixPointerDown(event) {
    event.preventDefault();
    this._startDrag();
    const grid = event.currentTarget;
    const total = parseInt(grid.dataset.total) || 1;
    const input = grid.parentElement?.querySelector(
      ".brightness-slider-matrix",
    );

    const applyAt = (clientX, clientY) => {
      if (clientX === undefined || clientY === undefined) return;
      const el = this.shadowRoot.elementFromPoint(clientX, clientY);
      if (
        el &&
        el.classList &&
        el.classList.contains("brightness-matrix-cell")
      ) {
        const level = parseInt(el.dataset.level) || 1;
        const val = Math.max(
          1,
          Math.min(100, Math.round((level / total) * 100)),
        );
        if (input) input.value = val;
        this.handleBrightnessChange({ target: { value: val } });
      }
    };

    applyAt(
      event.clientX ?? event.touches?.[0]?.clientX,
      event.clientY ?? event.touches?.[0]?.clientY,
    );

    let _rafPending = false;
    const handleMove = (e) => {
      const cx = e.clientX ?? e.touches?.[0]?.clientX;
      const cy = e.clientY ?? e.touches?.[0]?.clientY;
      if (cx !== undefined) {
        e.preventDefault();
        if (_rafPending) return;
        _rafPending = true;
        requestAnimationFrame(() => {
          _rafPending = false;
          applyAt(cx, cy);
        });
      }
    };
    const handleEnd = () => {
      this._endDrag();
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
      this._dragCleanup = null;
    };
    this._dragCleanup = { handleMove, handleEnd };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
  }

  _updateMatrixVisual(brightness) {
    const grid = this.shadowRoot?.querySelector(".brightness-matrix-grid");
    if (!grid) return;
    const total = parseInt(grid.dataset.total) || 1;
    const litCount = Math.max(1, Math.round((brightness / 100) * total));
    grid.querySelectorAll(".brightness-matrix-cell").forEach((cell) => {
      const level = parseInt(cell.dataset.level) || 0;
      cell.classList.toggle("lit", level <= litCount);
    });
    if (this.config.show_brightness_percentage !== false) {
      const val = this.shadowRoot?.querySelector(".brightness-matrix-value");
      if (val) val.textContent = `${brightness}%`;
    }
  }

  async handleBrightnessChange(event) {
    let newBrightness = parseInt(event.target.value);

    // Snap to positions if enabled
    if (this.config.brightness_snap_to_positions) {
      const snapValues = [20, 40, 60, 80];
      const snapThreshold = 4;
      for (const sv of snapValues) {
        if (Math.abs(newBrightness - sv) <= snapThreshold) {
          newBrightness = sv;
          break;
        }
      }
    }

    // Cache the user-set brightness to use during render storms
    this._userSetBrightness = newBrightness;

    if (this._userBrightnessTimeout) {
      clearTimeout(this._userBrightnessTimeout);
    }
    // Clear cached value after 3 seconds (extended to cover longer render storms)
    this._userBrightnessTimeout = setTimeout(() => {
      this._userSetBrightness = null;
    }, 3000);

    if (
      !this._hass ||
      !this.config ||
      !this.config.entity ||
      isNaN(newBrightness)
    ) {
      return;
    }

    // Mark as dragging to prevent re-render from hass updates
    this._isDragging = true;

    // Clamp to 1-100 FIRST to ensure we never work with 0
    newBrightness = Math.max(1, Math.min(100, newBrightness));

    // Update visual elements immediately for responsive feedback
    const sliderStyle = this.config.brightness_slider_style || "minimal";
    const showPercentage = this.config.show_brightness_percentage !== false;

    if (sliderStyle === "bar") {
      const barFill = this.shadowRoot?.querySelector(".brightness-bar-fill");
      if (barFill) barFill.style.width = `${newBrightness}%`;

      if (showPercentage) {
        const valueRight = this.shadowRoot?.querySelector(
          ".brightness-value-right",
        );
        if (valueRight) valueRight.textContent = `${newBrightness}%`;
      }
    } else if (sliderStyle === "wheel") {
      this._updateWheelVisual(newBrightness);
    } else if (sliderStyle === "matrix") {
      this._updateMatrixVisual(newBrightness);
    } else if (sliderStyle === "rotary") {
      const angle = ((newBrightness - 1) / 99) * 270; // Map 1-100 to 0-270 degrees
      const radius = 40;
      const circumference = 2 * Math.PI * radius; // ~251.33
      const arcLength = (circumference * 270) / 360; // Exact 270 degree arc
      const progressArcLength = (angle / 270) * arcLength;
      const da = `${progressArcLength} ${circumference}`;
      this.shadowRoot
        ?.querySelectorAll(".rotary-progress, .rotary-gloss-overlay")
        .forEach((el) => {
          el.style.strokeDasharray = da;
        });
      // Thick style: move the rectangular knob to the arc tip
      const knobArm = this.shadowRoot?.querySelector(".rotary-knob-arm");
      if (knobArm)
        knobArm.style.setProperty("--knob-angle", `${225 + angle}deg`);
      // Dial style: move the SVG circle knob to the arc tip
      const dialKnob = this.shadowRoot?.querySelector(".rotary-dial-knob");
      if (dialKnob) {
        const rad = (angle * Math.PI) / 180;
        dialKnob.setAttribute("cx", (50 + 40 * Math.cos(rad)).toFixed(2));
        dialKnob.setAttribute("cy", (50 + 40 * Math.sin(rad)).toFixed(2));
      }

      if (showPercentage) {
        const rotaryValue = this.shadowRoot?.querySelector(".rotary-value");
        if (rotaryValue) rotaryValue.textContent = `${newBrightness}%`;
      }
    } else if (sliderStyle === "capsule") {
      const bvd =
        this.config.brightness_value_display ||
        (this.config.show_brightness_percentage !== false ? "text" : "none");
      const bvs = this.config.brightness_value_side || "under";
      // Update capsule fill/thumb + under-text if in text/under mode
      updateCapsuleVisuals(
        this.shadowRoot,
        newBrightness,
        bvd !== "none" && bvs === "under" && bvd !== "input"
          ? `${newBrightness}%`
          : null,
        ".brightness-capsule-host",
      );
      // Sync brightness value in all positions
      this._syncBrightnessValueDisplay(newBrightness);
    } else {
      // Slider mode — native slider or glow variant
      if ((this.config.brightness_slider_variant || "thin") === "glow") {
        const glowFill = this.shadowRoot?.querySelector(
          ".brightness-glow-fill",
        );
        if (glowFill) glowFill.style.width = `${newBrightness}%`;
        const glowThumb = this.shadowRoot?.querySelector(
          ".brightness-glow-thumb",
        );
        if (glowThumb) glowThumb.style.left = `${newBrightness}%`;
        if (showPercentage) {
          const valueRight = this.shadowRoot?.querySelector(
            ".brightness-value-right",
          );
          if (valueRight) valueRight.textContent = `${newBrightness}%`;
        }
      } else if (showPercentage) {
        const valueSlider = this.shadowRoot?.querySelector(
          ".brightness-value-slider",
        );
        if (valueSlider) valueSlider.textContent = `${newBrightness}%`;
      }
      // Update thick slider fill position (CSS var approach)
      const thickSlider = this.shadowRoot?.querySelector(
        ".slider-variant-thick",
      );
      if (thickSlider)
        thickSlider.style.setProperty("--slider-pct", `${newBrightness}%`);
    }

    // Map 1-100 slider to Home Assistant brightness (displayed as 1%-100%)
    // HA shows brightness as (value/255)*100, so we need:
    // - Slider 1% ? HA brightness 3 (shows as 1.18% ≈ 1%)
    // - Slider 100% ? HA brightness 255 (shows as 100%)
    // Formula: map 1-100 to 3-255 (252 steps across 99 slider positions)
    const haBrightness = Math.round(3 + ((newBrightness - 1) * 252) / 99);

    // Final safety check: clamp to valid range
    const safeBrightness = Math.max(3, Math.min(255, haBrightness));

    // Debounce the actual service call to avoid overwhelming the device
    if (this._brightnessDebounceTimer) {
      clearTimeout(this._brightnessDebounceTimer);
    }

    this._brightnessDebounceTimer = setTimeout(async () => {
      // User stopped dragging
      this._isDragging = false;

      try {
        // Call light.turn_on with brightness (Home Assistant expects 1-255)
        await this._hass.callService("light", "turn_on", {
          entity_id: this.config.entity,
          brightness: safeBrightness,
        });

        // No need to clear local state - we're not using optimistic updates
      } catch (error) {
        console.error(`[Brightness] Service call failed:`, error);
        // Just render on error
        this.render();

        // Only log errors that aren't connection-related
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("NoneType") || errorMsg.includes("close")) {
          console.warn("Lamp connection temporarily unavailable");
        } else if (errorMsg.includes("quota exceeded")) {
          console.warn("Device rate limit - brightness update queued");
        } else {
          console.error("Error setting brightness:", error);
        }
      }
    }, 500);
  }

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

  /** Sync brightness value UI elements (input, readonly text, under-text). */
  _syncBrightnessValueDisplay(brightness) {
    const root = this.shadowRoot;
    if (!root) return;
    const input = root.getElementById("brightnessinput");
    const text = root.getElementById("brightnesstext");
    const valueText = root.querySelector(
      ".brightness-capsule-host .capsule-value-text",
    );
    if (input && !this._typingBrightness) input.value = brightness;
    if (text) text.value = `${brightness}%`;
    if (valueText) valueText.textContent = `${brightness}%`;
  }

  /** Handle typing in the brightness number input (visual update only). */
  _handleBrightnessValueInput(event) {
    let val = parseInt(event.target.value);
    if (isNaN(val)) return;
    val = Math.max(1, Math.min(100, val));
    // Update capsule visuals immediately
    updateCapsuleVisuals(
      this.shadowRoot,
      val,
      null,
      ".brightness-capsule-host",
    );
  }

  /** Handle blur/Enter on the brightness number input (apply to HA). */
  _handleBrightnessValueBlur(event) {
    this._typingBrightness = false;
    let val = parseInt(event.target.value);
    if (isNaN(val)) val = 1;
    val = Math.max(1, Math.min(100, val));
    event.target.value = val;
    // Apply brightness via HA service
    this.handleBrightnessChange({ target: { value: val } });
    // Allow re-render
    setTimeout(() => {
      this._isDragging = false;
    }, 100);
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
        this._localEffects.tint_strength = autoStrength;
        this._updateEffectLabel("tint_strength", autoStrength);
        // Update the tint_strength slider element position
        const strengthSliders = this.shadowRoot.querySelectorAll(
          'input[data-effect="tint_strength"]',
        );
        strengthSliders.forEach((s) => (s.value = autoStrength));
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

    this._effectDebounceTimer = setTimeout(async () => {
      // User stopped dragging
      this._isDragging = false;

      try {
        // Get all current effect values
        const stateObj = this._hass?.states?.[this.config.entity];
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

        await this._hass.callService(
          "yeelight_cube",
          "set_preview_adjustments",
          {
            entity_id: this.config.entity,
            ...effects,
          },
        );

        // Don't clear local state on a timer - let the entity state update handle it
        // The set hass() method will trigger a render when entity updates
        // At that point, if entity state matches local state, we can safely clear it
      } catch (error) {
        // Revert to entity state on error
        delete this._localEffects[effectName];
        this.render();
        console.error("Error setting effect:", error);
      }
    }, 300); // Faster response for effects
  }

  toggleSection(sectionId) {
    this._expandedSections[sectionId] = !this._expandedSections[sectionId];
    const isExpanded = this._expandedSections[sectionId];

    // Get all grouped sections
    const allGroupedSections =
      this.shadowRoot.querySelectorAll(".grouped-section");

    // Check if any section is expanded
    const anyExpanded = Object.values(this._expandedSections).some(
      (val) => val === true,
    );

    allGroupedSections.forEach((groupedSection) => {
      const sectionContent = groupedSection.querySelector(".grouped-content");
      const thisSectionId = sectionContent?.getAttribute("data-section");
      const isThisExpanded = this._expandedSections[thisSectionId] === true;

      if (isThisExpanded) {
        // This section is expanded
        groupedSection.classList.add("expanded");
        groupedSection.classList.remove("collapsed", "hidden");
      } else {
        // This section is collapsed
        groupedSection.classList.remove("expanded");
        groupedSection.classList.add("collapsed");

        // Hide with transition if any section is expanded, otherwise show
        if (anyExpanded) {
          groupedSection.classList.add("hidden");
        } else {
          groupedSection.classList.remove("hidden");
        }
      }
    });

    // Update the UI for old effect section layout (legacy support)
    const section = this.shadowRoot.querySelector(
      `.effect-section-content[data-section="${sectionId}"]`,
    );

    if (section) {
      // Update the icon for the old effect section header (legacy support)
      const header = section.previousElementSibling;
      if (header && header.classList.contains("effect-section-header")) {
        const iconElement = header.querySelector(".expand-icon");
        if (iconElement) {
          iconElement.textContent = isExpanded ? "?" : "?";
        }
      }
    }

    // Don't call render() - we already updated the DOM directly
  }

  switchTab(tabId) {
    this._activeTab = tabId;

    // Update UI
    const allTabs = this.shadowRoot.querySelectorAll(".tab-content");
    const allHeaders = this.shadowRoot.querySelectorAll(".tab-header");

    allTabs.forEach((tab) => {
      if (tab.dataset.tab === tabId) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });

    allHeaders.forEach((header) => {
      const onclick = header.getAttribute("onclick");
      if (onclick && onclick.includes(tabId)) {
        header.classList.add("active");
      } else {
        header.classList.remove("active");
      }
    });

    // Don't call render() - we already updated the DOM directly
  }

  selectRadialCategory(categoryId) {
    this._activeRadialCategory = categoryId;

    // Get the first effect of this category as the selected effect
    const effectsData = this._getEffectsData();
    const section = effectsData.find((s) => s.id === categoryId);
    if (section && section.effects.length > 0) {
      this._selectedRadialEffect = section.effects[0].name;
    }

    // Force a re-render to update the wheel and slider panel
    this._isInitialRenderComplete = false;
    this.render();

    // Update change indicators after render
    requestAnimationFrame(() => {
      this._updateChangeIndicators();
    });
  }
  selectCircularCategory(categoryId) {
    this._activeRadialSection = categoryId;

    const layoutMode = this.config.adjustments_layout || "grouped";

    if (layoutMode === "categories") {
      // For categories layout, update only the slider panel and active states
      // This prevents rebuilding the icon column and causing indicator blink
      this._updateCategoriesPanel(categoryId);
    } else if (layoutMode === "radial") {
      // For radial layout, we need full re-render
      this._isInitialRenderComplete = false;
      this.render();

      // Update change indicators immediately after render completes
      requestAnimationFrame(() => {
        this._updateChangeIndicators();
      });
    }
  }

  _updateCategoriesPanel(categoryId) {
    // Update categories layout without full re-render to prevent indicator blinking
    if (!this.shadowRoot) return;

    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return;

    const stateObj = hass.states[entityId];
    if (!stateObj) return;

    // Derive sections from registry
    const sections = SECTIONS_REGISTRY.map((section) => ({
      id: section.id,
      title: section.title,
      icon: section.icon,
      effects: section.effects.map((name) => {
        const def = EFFECTS_REGISTRY[name];
        return {
          name,
          label: def.label,
          min: def.min,
          max: def.max,
          value: stateObj.attributes[EFFECT_ATTR_MAP[name]] || def.default,
          unit: def.unit,
          default: def.default,
        };
      }),
    }));

    const activeSection =
      sections.find((s) => s.id === categoryId) || sections[0];

    // Update active class on icon buttons
    const iconButtons = this.shadowRoot.querySelectorAll(
      ".categories-icon-button",
    );
    iconButtons.forEach((button) => {
      const sectionId = button.getAttribute("onclick").match(/'([^']+)'/)?.[1];
      if (sectionId === categoryId) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });

    // Update slider panel content
    const sliderPanel = this.shadowRoot.querySelector(
      ".categories-slider-panel",
    );
    if (!sliderPanel) return;

    sliderPanel.setAttribute("data-section-id", activeSection.id);

    // Determine button visibility based on mode
    const resetButtonMode = this.config.reset_button_mode || "always";
    let resetButtonVisible = "none";
    if (resetButtonMode === "always") {
      resetButtonVisible = "block";
    } else if (resetButtonMode === "changed") {
      const hasChanges = this._checkSectionChanges(activeSection.id);
      resetButtonVisible = hasChanges ? "block" : "none";
    }
    // resetButtonMode === "never" ? stays "none"

    let panelHtml = `
      <div class="categories-category-header">
        <div class="categories-category-title">${activeSection.title}</div>
        <button 
          class="categories-reset-button" 
          data-section-id="${activeSection.id}"
          title="Reset ${activeSection.title}"
          onclick="this.getRootNode().host.resetSection('${activeSection.id}')"
          style="display: ${resetButtonVisible};"
        >
          🔄 Reset
        </button>
      </div>
    `;

    activeSection.effects.forEach((effect) => {
      const displayValue =
        effect.value !== undefined ? effect.value : effect.default;
      panelHtml += `
        <div class="categories-effect-row">
          <div class="categories-effect-row-header">
            <span class="categories-effect-row-label">${effect.label}</span>
            <span class="categories-effect-row-value" data-effect="${
              effect.name
            }">${displayValue}${effect.unit}</span>
          </div>
          <input
            type="range"
            class="categories-effect-slider"
            min="${effect.min}"
            max="${effect.max}"
            step="${effect.step || 1}"
            value="${displayValue}"
            data-effect="${effect.name}"
            data-default="${effect.default}"
            onmousedown="this.getRootNode().host._startDrag()"
            ontouchstart="this.getRootNode().host._startDrag()"
            onmouseup="this.getRootNode().host._endDrag()"
            ontouchend="this.getRootNode().host._endDrag()"
            oninput="this.getRootNode().host.handleEffectChange('${
              effect.name
            }', event)"
          />
        </div>
      `;
    });

    sliderPanel.innerHTML = panelHtml;
  }

  selectRadialEffect(effectName) {
    this._selectedRadialEffect = effectName;

    // Update UI - highlight the selected effect row only
    const allEffectRows =
      this.shadowRoot.querySelectorAll(".radial-effect-row");

    allEffectRows.forEach((row) => {
      if (row.dataset.effect === effectName) {
        row.classList.add("selected");
      } else {
        row.classList.remove("selected");
      }
    });

    // Don't call render() - we already updated the DOM directly
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

    // Send everything to the lamp (only this section's values changed)
    await this._hass.callService("yeelight_cube", "set_preview_adjustments", {
      entity_id: this.config.entity,
      ...allEffects,
    });

    // Update sliders in DOM immediately (for categories layout)
    Object.keys(defaultValues).forEach((effectName) => {
      const slider = this.shadowRoot.querySelector(
        `.categories-effect-slider[data-effect="${effectName}"]`,
      );
      if (slider) {
        slider.value = defaultValues[effectName];
      }

      // Update the value display
      const valueDisplay = this.shadowRoot.querySelector(
        `.categories-effect-row-value[data-effect="${effectName}"]`,
      );
      if (valueDisplay) {
        const effectData = this._getEffectsData()
          .flatMap((s) => s.effects)
          .find((e) => e.name === effectName);
        const unit = effectData?.unit || "";
        valueDisplay.textContent = `${defaultValues[effectName]}${unit}`;
      }
    });

    // Clear local effects for this section immediately
    Object.keys(defaultValues).forEach((effectName) => {
      delete this._localEffects[effectName];
    });

    // Update change indicators immediately
    this._updateChangeIndicators();

    // Update section reset button visibility
    this._updateSectionResetButtons();

    // Also update after a brief delay to ensure DOM is ready
    setTimeout(() => {
      this._updateChangeIndicators();
      this._updateSectionResetButtons();
    }, 50);
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

    // Send to the lamp
    await this._hass.callService("yeelight_cube", "set_preview_adjustments", {
      entity_id: this.config.entity,
      ...allEffects,
    });

    // Update slider in DOM
    const slider = this.shadowRoot.querySelector(
      `input.effect-slider[data-effect="${effectName}"]`,
    );
    if (slider) {
      slider.value = defaultValue;
    }

    // Update value display
    const valueDisplay = this.shadowRoot.querySelector(
      `.compact-value[data-effect="${effectName}"]`,
    );
    if (valueDisplay) {
      const effectData = this._getEffectsData()
        .flatMap((s) => s.effects)
        .find((e) => e.name === effectName);
      const unit = effectData?.unit || "";
      valueDisplay.textContent = `${defaultValue}${unit}`;
    }

    // Clear from local effects
    delete this._localEffects[effectName];

    // Update change indicators and reset button visibility
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      this._updateChangeIndicators();
      this._updateCompactResetButtons();
    }, 10);
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

  _updateChangeIndicators() {
    // Update visual change indicators (orange dots) for all sections
    if (!this.shadowRoot) return;

    // Check if change indicators are enabled in config
    const showIndicators = this.config.show_change_indicators ?? true;

    // CLEANUP: When indicators are disabled, remove any lingering has-changes classes
    // This handles the case where the setting was just toggled OFF but HTML still has old classes
    if (!showIndicators) {
      const radialSegments = this.shadowRoot.querySelectorAll(
        ".radial-segment.has-changes",
      );
      radialSegments.forEach((segment) => {
        segment.classList.remove("has-changes");
      });
      return;
    }

    // Find all indicators in the DOM and update them based on actual rendered content
    const allIndicators = this.shadowRoot.querySelectorAll(
      ".change-indicator[data-section-id]",
    );

    // If no section indicators found, skip section updates (likely in compact mode)
    if (allIndicators.length > 0) {
      // Get all sections that actually exist in the current layout
      const allSections = this.shadowRoot.querySelectorAll("[data-section-id]");
      const sectionIds = new Set();
      allSections.forEach((el) => {
        const id = el.getAttribute("data-section-id");
        if (id) sectionIds.add(id);
      });

      sectionIds.forEach((sectionId) => {
        // Check if this section has any non-default values
        const hasChanges = this._checkSectionChanges(sectionId);

        // Find all indicators for this section
        const indicators = this.shadowRoot.querySelectorAll(
          `.change-indicator[data-section-id="${sectionId}"]`,
        );

        indicators.forEach((indicator) => {
          if (hasChanges) {
            indicator.classList.add("visible");
          } else {
            indicator.classList.remove("visible");
          }
        });
      });
    }

    // Also update compact layout indicators (effect-level, not section-level)
    const compactIndicators = this.shadowRoot.querySelectorAll(
      ".compact-indicator[data-effect]",
    );
    compactIndicators.forEach((indicator) => {
      const effectName = indicator.getAttribute("data-effect");
      const hasChanged = this._checkEffectChanged(effectName);
      if (hasChanged) {
        indicator.classList.add("visible");
      } else {
        indicator.classList.remove("visible");
      }
    });
  }

  _updateCompactResetButtons() {
    // Update visibility of reset buttons in compact layout based on changed state
    // Only needed when reset_button_mode is "changed"
    const mode = this.config.reset_button_mode || "always";
    if (mode !== "changed") return; // Skip if not in "changed" mode

    if (!this.shadowRoot) return;

    // Find all compact reset buttons
    const resetButtons = this.shadowRoot.querySelectorAll(
      ".compact-reset-button[data-effect]",
    );
    resetButtons.forEach((button) => {
      const effectName = button.getAttribute("data-effect");
      const hasChanged = this._checkEffectChanged(effectName);

      // Show/hide button based on changed state
      if (hasChanged) {
        button.style.display = "flex";
      } else {
        button.style.display = "none";
      }
    });
  }

  _updateSectionResetButtons() {
    // Update visibility of section-level reset buttons (for Tabbed, Grouped, Radial, Categories layouts)
    // Only needed when reset_button_mode is "changed"
    const mode = this.config.reset_button_mode || "always";

    if (!this.shadowRoot) return;

    // Only update if mode is "changed" - otherwise buttons are always visible/hidden via initial render
    if (mode !== "changed") return;

    // Find all section-level reset buttons (multiple classes for different layouts)
    const resetButtons = this.shadowRoot.querySelectorAll(
      "[data-section-id].tabbed-reset-button, [data-section-id].grouped-reset, [data-section-id].radial-reset-button, [data-section-id].categories-reset-button",
    );
    resetButtons.forEach((button) => {
      const sectionId = button.getAttribute("data-section-id");
      const hasChanges = this._checkSectionChanges(sectionId);

      // Show/hide button based on changed state
      // Tabbed buttons use "flex", others use "block"
      const visibleDisplay = button.classList.contains("tabbed-reset-button")
        ? "flex"
        : "block";
      if (hasChanges) {
        button.style.display = visibleDisplay;
      } else {
        button.style.display = "none";
      }
    });
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
    // Look up unit and label from the registry
    const def = EFFECTS_REGISTRY[effectName];
    const unit = def?.unit || "";
    const labelText = def?.label || effectName;

    // Update labels for all layout modes using direct data-effect selectors

    // Compact layout - update the value span directly
    const compactValue = this.shadowRoot.querySelector(
      `.compact-value[data-effect="${effectName}"]`,
    );
    if (compactValue) {
      compactValue.textContent = `${value}${unit}`;
    }

    // Tabbed layout - update the label with the full text directly
    const tabbedLabel = this.shadowRoot.querySelector(
      `.tabbed-label[data-effect="${effectName}"]`,
    );
    if (tabbedLabel) {
      tabbedLabel.innerHTML = `${labelText}: <strong>${value}${unit}</strong>`;
    }

    // Grouped layout - update the value span directly
    const groupedValue = this.shadowRoot.querySelector(
      `.grouped-value[data-effect="${effectName}"]`,
    );
    if (groupedValue) {
      groupedValue.textContent = `${value}${unit}`;
    }

    // Radial layout - update the effect row value
    const radialRowValue = this.shadowRoot.querySelector(
      `.radial-effect-row-value[data-effect="${effectName}"]`,
    );
    if (radialRowValue) {
      radialRowValue.textContent = `${value}${unit}`;
    }

    // Also update if it's in an effect row (for the main display)
    const radialEffectRow = this.shadowRoot.querySelector(
      `.radial-effect-row[data-effect="${effectName}"] .radial-effect-row-value`,
    );
    if (radialEffectRow) {
      radialEffectRow.textContent = `${value}${unit}`;
    }

    // Categories layout - update the value span directly
    const categoriesValue = this.shadowRoot.querySelector(
      `.categories-effect-row-value[data-effect="${effectName}"]`,
    );
    if (categoriesValue) {
      categoriesValue.textContent = `${value}${unit}`;
    }

    // Legacy support (old effect-section layout)
    const legacyLabel = this.shadowRoot.querySelector(
      `label[data-effect="${effectName}"]`,
    );
    if (legacyLabel) {
      legacyLabel.textContent = `${labelText}: ${value}${unit}`;
    }
  }

  render() {
    const _tRender = performance.now();
    // Skip re-rendering if user is dragging a slider or typing in brightness input
    if (this._anySliderDragging || this._typingBrightness) {
      return;
    }

    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) {
      return;
    }
    const stateObj = hass.states[entityId];

    if (!stateObj) {
      this.shadowRoot.innerHTML = `<ha-card>
        <div style="padding: 16px;">
          <h3>Entity not found: ${entityId}</h3>
          <p>Please check your configuration and ensure the entity exists.</p>
        </div>
      </ha-card>`;
      return;
    }
    let usingFallbackMatrix = false;
    let matrixColors = stateObj.attributes.matrix_colors;

    if (!matrixColors) {
      // Use a blank matrix as fallback instead of showing an error
      matrixColors = getInitialMatrix(5, 20); // 5 rows x 20 cols
      usingFallbackMatrix = true;
    }

    // Use entity state for brightness (no optimistic updates to prevent flash)
    const entityBrightness = stateObj.attributes.brightness ?? 255;

    // Convert entity brightness (3-255) to slider scale (1-100) for display
    // This matches the forward conversion: slider 1-100 ? HA 3-255
    let sliderBrightness;
    if (entityBrightness <= 3) {
      sliderBrightness = 1;
    } else if (entityBrightness >= 255) {
      sliderBrightness = 100;
    } else {
      // Reverse the forward formula: ((brightness-3) / 252) * 99 + 1
      sliderBrightness = Math.round(((entityBrightness - 3) / 252) * 99) + 1;
    }

    // Get all effect values (local or entity state)
    const effects = {};
    for (const name of EFFECT_NAMES) {
      effects[name] =
        this._localEffects[name] ??
        stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ??
        EFFECT_DEFAULTS[name];
    }

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
    // Helper to apply ALL color adjustments (matching backend logic)
    const applyColorAdjustments = (rgbArray, originalRgb, brightness) => {
      let [r, g, b] = rgbArray;

      // If the original pixel was black, keep it black (don't apply effects to background)
      const isOriginalBlack =
        originalRgb[0] === 0 && originalRgb[1] === 0 && originalRgb[2] === 0;

      if (isOriginalBlack) {
        return [0, 0, 0];
      }

      // Note: Darken/brighten effects removed - use light brightness control instead
      // The preview now only shows actual color effects, not brightness adjustments

      return [r, g, b];
    };

    // Apply brightness and color adjustments to all pixels
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
    const darkenPercent = stateObj.attributes.preview_darken ?? 0;
    const _minFactor = 1 - PREVIEW_MAX_DARKEN_PERCENT / 100; // 0.06
    const _darkenFactor = Math.max(_minFactor, 1 - darkenPercent / 100);
    const _floor = PREVIEW_MIN_BRIGHTNESS_BOOST * _minFactor; // ≈ 0.48
    const _t = entityBrightness / 255; // normalised lamp brightness 0..1
    const _effective =
      _floor + (1 - _floor) * Math.pow(_t, PREVIEW_BRIGHTNESS_GAMMA);
    const previewBoost = _effective / _darkenFactor;

    const gridColors = matrixColors.map((rgb) => {
      if (!Array.isArray(rgb) || rgb.length !== 3) rgb = [0, 0, 0];

      const originalRgb = [...rgb]; // Keep original for black check

      const brightAdjusted = rgb.map((v) =>
        Math.min(255, Math.round(v * previewBoost)),
      );

      // Then apply color effects (pass original RGB for black check)
      const finalColor = applyColorAdjustments(
        brightAdjusted,
        originalRgb,
        entityBrightness,
      );

      return rgbToCss(finalColor);
    });

    // Generate matrix HTML (pass stateObj for orientation info)
    const matrixHtml =
      this.config.show_lamp_preview !== false
        ? this._generateMatrixHtml(gridColors, stateObj)
        : "";

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

    // Generate lamp controls HTML (buttons and brightness slider)
    const lampControlsHtml =
      this.config.show_lamp_control !== false
        ? this._generateLampControlsHtml(stateObj, displayBrightness)
        : "";

    // Generate adjustment controls HTML (color effects)
    const adjustmentControlsHtml =
      this.config.show_adjustment_controls === true
        ? this._generateAdjustmentControlsHtml(effects)
        : "";

    // Generate final template
    const showCard = this.config.show_card_background !== false;
    const cardTitle = this.config.title || this.config.card_title || "";
    const usingFallbackMatrix = !stateObj.attributes.matrix_colors;

    // Smart update: Only rebuild DOM if not initialized or if dragging just ended
    const needsFullRender =
      !this._isInitialRenderComplete ||
      !this.shadowRoot.querySelector(".lamp-preview-css");

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
      // Full render on first load or structural changes
      this.shadowRoot.innerHTML = `
        ${this._getStyles()}
        ${
          showCard
            ? `<ha-card${
                cardTitle
                  ? ` header="${escapeHtml(cardTitle)}${
                      usingFallbackMatrix ? " (No Matrix Data)" : ""
                    }"`
                  : ""
              }>
               <div style="display: flex; width: 100%;">
                 <div class="yeelight-cube-lamp-preview-container">
                   ${matrixHtml}
                   ${lampControlsHtml}
                   ${adjustmentControlsHtml}
                 </div>
               </div>
             </ha-card>`
            : `<div style="display: flex; width: 100%;">
               <div class="yeelight-cube-lamp-preview-container">
                 ${
                   cardTitle
                     ? `<div style="font-weight:600;font-size:1.1em;margin-bottom:8px;">${escapeHtml(cardTitle)}</div>`
                     : ""
                 }
                 ${matrixHtml}
                 ${lampControlsHtml}
                 ${adjustmentControlsHtml}
               </div>
             </div>`
        }
      `;
      this._isInitialRenderComplete = true;
      // Remember which orientation this DOM was built for (smart updates compare).
      this._lastPreviewOrientation =
        stateObj?.attributes?.device_orientation || "right";

      // Update change indicators after initial render
      requestAnimationFrame(() => {
        this._updateChangeIndicators();

        // Double-check indicators after a short delay to ensure everything is ready
        setTimeout(() => {
          this._updateChangeIndicators();
        }, 100);
      });
    } else {
      // Smart update: Only update matrix colors and slider values
      const _tSmart = performance.now();
      // When a native animation or clock animation owns the matrix, don't
      // clobber it with the static (stale) matrix_colors attribute.
      if (!isNativeAnimating && !isClockAnimating)
        this._updateMatrixColors(gridColors, stateObj);
      this._updateSliderValues(displayBrightness, effects); // Use cached value to prevent jumping
      this._updatePowerButton(stateObj);

      // Update change indicators on smart updates too, but defer to next frame
      // to avoid querying DOM while it's being updated
      requestAnimationFrame(() => {
        this._updateChangeIndicators();
      });
    }

    // Start/stop the client-side animations to match current mode.
    if (isNativeAnimating) this._startNativeAnimation();
    else this._stopNativeAnimation();
    if (isClockAnimating) this._startClockAnimation();
    else this._stopClockAnimation();
  }

  // Convert a 100-entry matrix_colors array (RGB tuples) to CSS colors using
  // the same brightness-boost pipeline as the static preview. Extracted so the
  // native-effect animation loop renders identically to the normal path.
  _matrixColorsToGridColors(matrixColors, stateObj) {
    const entityBrightness = stateObj?.attributes?.brightness ?? 255;
    const darkenPercent = stateObj?.attributes?.preview_darken ?? 0;
    const _minFactor = 1 - PREVIEW_MAX_DARKEN_PERCENT / 100;
    const _darkenFactor = Math.max(_minFactor, 1 - darkenPercent / 100);
    const _floor = PREVIEW_MIN_BRIGHTNESS_BOOST * _minFactor;
    const _t = entityBrightness / 255;
    const _effective =
      _floor + (1 - _floor) * Math.pow(_t, PREVIEW_BRIGHTNESS_GAMMA);
    const previewBoost = _effective / _darkenFactor;
    return matrixColors.map((c) => {
      let px = c;
      if (!Array.isArray(px) || px.length !== 3) px = [0, 0, 0];
      if (px[0] === 0 && px[1] === 0 && px[2] === 0) return rgbToCss([0, 0, 0]);
      return rgbToCss(
        px.map((v) => Math.min(255, Math.round(v * previewBoost))),
      );
    });
  }

  // Begin the client-side approximation animation for Native Effect mode.
  _startNativeAnimation() {
    if (this._nativeAnimTimer) return;
    this._nativeAnimTimer = setInterval(() => this._nativeAnimFrame(), 100);
    this._nativeAnimFrame(); // draw the first frame immediately
  }

  _stopNativeAnimation() {
    if (this._nativeAnimTimer) {
      clearInterval(this._nativeAnimTimer);
      this._nativeAnimTimer = null;
    }
  }

  // Begin the client-side clock animation (updates every 500 ms so the
  // colon blink and minute changes are always visible).
  _startClockAnimation() {
    if (this._clockAnimTimer) return;
    this._clockAnimTimer = setInterval(() => this._clockAnimFrame(), 500);
    this._clockAnimFrame(); // draw the first frame immediately
  }

  _stopClockAnimation() {
    if (this._clockAnimTimer) {
      clearInterval(this._clockAnimTimer);
      this._clockAnimTimer = null;
    }
  }

  _clockAnimFrame() {
    const st = this._hass?.states?.[this.config?.entity];
    if (!st || st.state !== "on" || st.attributes.content_mode !== "Clock") {
      this._stopClockAnimation();
      return;
    }
    const dots = this.shadowRoot?.querySelectorAll(".lamp-dot");
    if (!dots || dots.length !== 100) return; // matrix not rendered yet

    const pix = renderClockFrame(st.attributes);
    const grid = this._matrixColorsToGridColors(pix, st);
    this._updateMatrixColors(grid, st);
  }

  _nativeAnimFrame() {
    const st = this._hass?.states?.[this.config?.entity];
    if (
      !st ||
      st.state !== "on" ||
      st.attributes.content_mode !== "Native Effect"
    ) {
      this._stopNativeAnimation();
      return;
    }
    const dots = this.shadowRoot?.querySelectorAll(".lamp-dot");
    if (!dots || dots.length !== 100) return; // matrix not rendered yet

    const effect = st.attributes.native_effect || "Ribbon";
    const dir = st.attributes.native_effect_direction || "Up";
    const speed = Math.max(
      1,
      Math.min(100, Number(st.attributes.native_effect_speed ?? 50)),
    );
    // Match the camera's phase mapping (native_effect_preview usage).
    const phase = (performance.now() / 1000) * (0.25 + speed / 55.0);
    const pix = renderNativeEffect(effect, phase, dir); // row-major, top->bottom

    // _updateMatrixColors already applies the top/bottom flip that matches the
    // matrix_colors convention, so feed the effect pixels in their natural
    // row-major order (row 0 = top). Reversing rows here double-flips and
    // inverts the Up/Down orientation vs the camera.
    const grid = this._matrixColorsToGridColors(pix, st);
    this._updateMatrixColors(grid, st);
  }

  // Update only matrix dot colors without rebuilding DOM
  _updateMatrixColors(gridColors, stateObj) {
    const dots = this.shadowRoot.querySelectorAll(".lamp-dot");
    if (dots.length !== gridColors.length) {
      // Mismatch - need full render
      this._isInitialRenderComplete = false;
      this.render();
      return;
    }

    // If the device orientation changed, the grid geometry (rows/cols, tall vs
    // wide) changed too — a colour-only update can't fix that, so full re-render.
    const orientation = stateObj?.attributes?.device_orientation || "right";
    if (this._lastPreviewOrientation !== orientation) {
      this._lastPreviewOrientation = orientation;
      this._isInitialRenderComplete = false;
      this.render();
      return;
    }

    const layout = this._orientedLayout(orientation);
    const totalCols = layout.cols;

    dots.forEach((dot, idx) => {
      const row = Math.floor(idx / totalCols);
      const col = idx % totalCols;
      const colorIndex = layout.indexFn(row, col);

      const color = gridColors[colorIndex] || "#000000";

      // Check if pixel is black using RGB values (same logic as _generateMatrixHtml)
      let isBlack = false;
      if (color.startsWith("#")) {
        const hex = color.replace(/^#/, "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        isBlack =
          r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD;
      } else if (color.startsWith("rgb")) {
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

      // Update background and class
      dot.style.background = displayColor;
      if (isEmpty) {
        dot.classList.add("lamp-dot-empty");
      } else {
        dot.classList.remove("lamp-dot-empty");
      }
    });
  }

  // Update only slider values without rebuilding DOM
  _updateSliderValues(brightness, effects) {
    // Update brightness slider and visual indicators
    const brightnessSlider =
      this.shadowRoot.querySelector(".brightness-slider") ||
      this.shadowRoot.querySelector(".capsule-input");
    if (brightnessSlider && !this._anySliderDragging) {
      brightnessSlider.value = brightness;

      // Also update visual brightness indicators (bar fill, percentage, rotary progress)
      const sliderStyle = this.config.brightness_slider_style || "minimal";
      const showPercentage = this.config.show_brightness_percentage !== false;

      if (sliderStyle === "bar") {
        const barFill = this.shadowRoot?.querySelector(".brightness-bar-fill");
        if (barFill) barFill.style.width = `${brightness}%`;

        if (showPercentage) {
          const valueRight = this.shadowRoot?.querySelector(
            ".brightness-value-right",
          );
          if (valueRight) valueRight.textContent = `${brightness}%`;
        }
      } else if (sliderStyle === "wheel") {
        this._updateWheelVisual(brightness);
      } else if (sliderStyle === "matrix") {
        this._updateMatrixVisual(brightness);
      } else if (sliderStyle === "rotary") {
        const angle = ((brightness - 1) / 99) * 270;
        const radius = 40;
        const circumference = 2 * Math.PI * radius;
        const arcLength = (circumference * 270) / 360;
        const progressArcLength = (angle / 270) * arcLength;
        const da = `${progressArcLength} ${circumference}`;
        const rotaryProgress =
          this.shadowRoot?.querySelector(".rotary-progress");
        if (rotaryProgress) rotaryProgress.style.strokeDasharray = da;
        this.shadowRoot
          ?.querySelectorAll(".rotary-gloss-overlay")
          .forEach((el) => {
            el.style.strokeDasharray = da;
          });
        const knobArm = this.shadowRoot?.querySelector(".rotary-knob-arm");
        if (knobArm)
          knobArm.style.setProperty("--knob-angle", `${225 + angle}deg`);
        const dialKnob = this.shadowRoot?.querySelector(".rotary-dial-knob");
        if (dialKnob) {
          const rad = (angle * Math.PI) / 180;
          dialKnob.setAttribute("cx", (50 + 40 * Math.cos(rad)).toFixed(2));
          dialKnob.setAttribute("cy", (50 + 40 * Math.sin(rad)).toFixed(2));
        }
        if (showPercentage) {
          const rotaryValue = this.shadowRoot?.querySelector(".rotary-value");
          if (rotaryValue) rotaryValue.textContent = `${brightness}%`;
        }
      } else if (sliderStyle === "capsule") {
        const bvd =
          this.config.brightness_value_display ||
          (this.config.show_brightness_percentage !== false ? "text" : "none");
        const bvs = this.config.brightness_value_side || "under";
        updateCapsuleVisuals(
          this.shadowRoot,
          brightness,
          bvd !== "none" && bvs === "under" && bvd !== "input"
            ? `${brightness}%`
            : null,
          ".brightness-capsule-host",
        );
        this._syncBrightnessValueDisplay(brightness);
      } else {
        // Slider mode — default native slider or glow variant
        if ((this.config.brightness_slider_variant || "thin") === "glow") {
          const glowFill = this.shadowRoot?.querySelector(
            ".brightness-glow-fill",
          );
          if (glowFill) glowFill.style.width = `${brightness}%`;
          const glowThumb = this.shadowRoot?.querySelector(
            ".brightness-glow-thumb",
          );
          if (glowThumb) glowThumb.style.left = `${brightness}%`;
          if (showPercentage) {
            const valueRight = this.shadowRoot?.querySelector(
              ".brightness-value-right",
            );
            if (valueRight) valueRight.textContent = `${brightness}%`;
          }
        } else if (showPercentage) {
          const valueSlider = this.shadowRoot?.querySelector(
            ".brightness-value-slider",
          );
          if (valueSlider) valueSlider.textContent = `${brightness}%`;
        }
        // Update thick slider fill position
        const thickSlider = this.shadowRoot?.querySelector(
          ".slider-variant-thick",
        );
        if (thickSlider)
          thickSlider.style.setProperty("--slider-pct", `${brightness}%`);
      }
    }

    // Update effect sliders
    Object.entries(effects).forEach(([effectName, value]) => {
      const slider = this.shadowRoot.querySelector(
        `.effect-slider[data-effect="${effectName}"]`,
      );
      if (slider && !this._anySliderDragging) {
        slider.value = value;
        // Update the displayed value text
        this._updateEffectLabel(effectName, value);
      }
    });
  }

  _updatePowerButton(stateObj) {
    const powerButton = this.shadowRoot.querySelector(
      ".power-toggle-container button",
    );
    if (!powerButton) {
      return;
    }

    const style = this.config.buttons_style || "classic";
    const isOn = stateObj.state === "on";
    const stateClass = isOn ? "on" : "off";
    const label = isOn ? "Turn Off" : "Turn On";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";

    // Update button state class (add/remove "on" or "off")
    powerButton.classList.remove("on", "off");
    powerButton.classList.add(stateClass);

    // Clear loading state only when we reach the expected state
    if (this._powerToggling && this._expectedPowerState !== null) {
      if (isOn === this._expectedPowerState) {
        this._powerToggling = false;
        this._expectedPowerState = null;
        powerButton.disabled = false;
      } else {
        // Keep loading state - we haven't reached expected state yet
        return;
      }
    }

    // Update button content
    powerButton.innerHTML = renderButtonContent(
      "mdi:power",
      label,
      contentMode,
    );
    powerButton.title = label;
  }

  _updatePowerButtonLoadingState(isLoading) {
    const powerButton = this.shadowRoot.querySelector(
      ".power-toggle-container button",
    );
    if (!powerButton) return;

    const style = this.config.buttons_style || "classic";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";

    powerButton.disabled = isLoading;

    if (isLoading) {
      // Show loading spinner
      powerButton.innerHTML = renderButtonContent(
        "mdi:loading",
        "Loading...",
        contentMode,
      );
      powerButton.title = "Loading...";
      // Add spinning class to the icon
      const icon = powerButton.querySelector("ha-icon");
      if (icon) icon.classList.add("spinning");
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

  _generateMatrixHtml(gridColors, stateObj) {
    const matrixBackground = this.config.matrix_background || "black";
    const matrixBoxShadow = this.config.matrix_box_shadow !== false;
    const pixelStyle = this.config.matrix_pixel_style || "square";
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
    const totalRows = layout.rows;
    const totalCols = layout.cols;

    const pixels = Array.from({ length: totalRows * totalCols })
      .map((_, idx) => {
        const row = Math.floor(idx / totalCols);
        const col = idx % totalCols;
        const colorIndex = layout.indexFn(row, col);

        const color = gridColors[colorIndex] || "#000000";

        // Check if pixel is black using RGB values (more robust than string matching)
        // Uses shared BLACK_THRESHOLD from draw_card_const.js
        let isBlack = false;
        if (color.startsWith("#")) {
          // Hex color format
          const hex = color.replace(/^#/, "");
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          isBlack =
            r <= BLACK_THRESHOLD &&
            g <= BLACK_THRESHOLD &&
            b <= BLACK_THRESHOLD;
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

        // For empty dots, use inline style background: transparent
        return `<div class="lamp-dot${
          isEmpty ? " lamp-dot-empty" : ""
        }" style="background: ${displayColor};"></div>`;
      })
      .join("");

    return `
      <div class="lamp-preview-css ${alignClass}" 
           style="${
             layout.tall
               ? `height:340px; width:auto; aspect-ratio:${totalCols} / ${totalRows};`
               : `width:${this.config.size_pct || 100}%; aspect-ratio:${totalCols} / ${totalRows};`
           }
                  background: ${matrixBackground}; 
                  gap: ${pixelGap}px; 
                  box-shadow: ${matrixBoxShadow ? "0 2px 8px #0008" : "none"};
                  grid-template-columns: repeat(${totalCols}, 1fr);
                  grid-template-rows: repeat(${totalRows}, 1fr);">
        ${pixels}
      </div>
    `;
  }

  // Build the 4-way device orientation control (right / down / left / up).
  _generateDeviceOrientationHtml(stateObj) {
    const current = stateObj?.attributes?.device_orientation || "right";
    // Order + glyphs match the official app's mount picker.
    const opts = [
      { key: "right", glyph: "→", label: "Right" },
      { key: "down", glyph: "↓", label: "Down" },
      { key: "left", glyph: "←", label: "Left" },
      { key: "up", glyph: "↑", label: "Up" },
    ];
    const buttons = opts
      .map(
        (o) =>
          `<button type="button" class="orient-btn${
            o.key === current ? " active" : ""
          }" data-orient="${o.key}" title="${o.label}"
            onclick="this.getRootNode().host.handleOrientationSelect('${o.key}')">${o.glyph}</button>`,
      )
      .join("");
    return `<div class="device-orientation-row">${buttons}</div>`;
  }

  // Apply a device orientation immediately on the lamp (all modes).
  handleOrientationSelect(orientation) {
    if (!this._hass || !this.config?.entity) return;
    // Optimistically highlight the chosen button for instant feedback.
    this.shadowRoot
      ?.querySelectorAll(".orient-btn")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.orient === orientation),
      );
    this._hass
      .callService("yeelight_cube", "set_device_orientation", {
        entity_id: this.config.entity,
        orientation,
      })
      .catch((e) =>
        console.error("[device-orientation] service call failed:", e),
      );
  }

  _generateLampControlsHtml(stateObj, brightness) {
    let html = "";
    // Power toggle and force refresh buttons on same line
    const showPowerToggle = this.config.show_power_toggle === true;
    const showForceRefresh = this.config.show_force_refresh_button !== false;

    if (showPowerToggle || showForceRefresh) {
      const buttonCount = [showPowerToggle, showForceRefresh].filter(
        Boolean,
      ).length;
      const multiClass = buttonCount >= 2 ? " two-buttons" : "";
      html += `<div class="button-row${multiClass}">`;
      if (showForceRefresh) {
        html += this._generateForceRefreshButtonHtml();
      }
      if (showPowerToggle) {
        html += this._generatePowerToggleHtml(stateObj);
      }
      html += "</div>";
    }

    // Device orientation control (between power/refresh actions and brightness).
    if (this.config.show_device_orientation !== false) {
      html += this._generateDeviceOrientationHtml(stateObj);
    }

    // Brightness slider (brightness parameter is already converted to 1-100 scale)
    if (this.config.show_brightness_slider === true) {
      const sliderStyle = this.config.brightness_slider_style || "slider";
      // Migrate old appearance to numeric thickness
      const sliderThickness = resolveCapsuleThickness(
        this.config.brightness_slider_thickness,
        this.config.brightness_slider_appearance,
        6,
      );
      const brightnessPercent = brightness;

      // Resolve brightness theme (migrate old values via shared util)
      const brightnessTheme = resolveCapsuleTheme(
        this.config.brightness_theme,
        this.config.capsule_theme,
      );

      // Brightness label: simple show/hide (backward compat with old label modes)
      let showLabel = false; // label always hidden — removed from UI
      const labelContent = showLabel ? "Brightness" : "";

      html += `<div class="brightness-slider-container brightness-style-${sliderStyle} brightness-theme-${brightnessTheme}" style="--slider-thickness: ${sliderThickness}px; --brightness-color: ${this.config.brightness_matrix_color || "#ff9800"};" onwheel="this.getRootNode().host.handleBrightnessWheel(event)">`;

      if (sliderStyle === "bar") {
        // Mushroom-style bar with selectable fill style (solid/pulse/stripes/gloss)
        const barFill = this.config.brightness_bar_fill || "solid";
        // Stripes animation is activated only while dragging via JS class
        const stripesClass = barFill === "stripes" ? " bar-stripes-idle" : "";
        if (showLabel) {
          html += `<div class="brightness-label">${labelContent}</div>`;
        }
        html += `
            <div class="brightness-bar-wrapper brightness-bar-full">
              <div class="brightness-bar-track bar-fill-${barFill}${stripesClass}">
                <div class="brightness-bar-fill" style="width: ${brightnessPercent}%"></div>
                <div class="brightness-bar-seams"></div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value="${brightness}" 
                  class="brightness-slider brightness-slider-bar"
                  onmousedown="this.getRootNode().host._startDrag(); this.closest('.brightness-bar-track')?.classList.remove('bar-stripes-idle');"
                  ontouchstart="this.getRootNode().host._startDrag(); this.closest('.brightness-bar-track')?.classList.remove('bar-stripes-idle');"
                  onmouseup="this.getRootNode().host._endDrag(); this.closest('.brightness-bar-track')?.classList.add('bar-stripes-idle');"
                  ontouchend="this.getRootNode().host._endDrag(); this.closest('.brightness-bar-track')?.classList.add('bar-stripes-idle');"
                  oninput="this.getRootNode().host.handleBrightnessChange(event)"
                />
              </div>
              ${
                this.config.show_brightness_percentage !== false
                  ? `<div class="brightness-value-right">${brightnessPercent}%</div>`
                  : ""
              }
            </div>
          `;
      } else if (sliderStyle === "wheel") {
        // Preset wheel — drag or scroll to snapped stops
        const step = Math.max(
          1,
          Math.min(50, parseInt(this.config.brightness_wheel_step) || 10),
        );
        const wheelStyle = this.config.brightness_wheel_style || "ticks";
        const showWheelLabels = this.config.brightness_wheel_labels !== false;
        const stops = [];
        for (let v = step; v <= 100; v += step) stops.push(v);
        if (stops[stops.length - 1] !== 100) stops.push(100);
        const tickW = sliderThickness * 5 + 20; // tick width scales with thickness
        const activeIndex = stops.reduce(
          (best, v, i) =>
            Math.abs(v - brightnessPercent) <
            Math.abs(stops[best] - brightnessPercent)
              ? i
              : best,
          0,
        );
        const shift = -(activeIndex * tickW + tickW / 2);
        const ticks = stops
          .map(
            (v, i) => `
                <button type="button" class="brightness-wheel-tick wheel-style-${wheelStyle}${
                  i === activeIndex ? " active" : ""
                }" data-value="${v}" data-index="${i}" style="width:${tickW}px;flex:0 0 ${tickW}px;"
                  onclick="this.getRootNode().host.handleWheelTick(${v})">
                  <span class="wheel-tick-mark"></span>
                  ${showWheelLabels ? `<span class="wheel-tick-label">${v}</span>` : ""}
                </button>`,
          )
          .join("");
        html += `
            <div class="brightness-wheel-wrapper">
              <div class="brightness-wheel-value">${this.config.show_brightness_percentage !== false ? `${brightnessPercent}%` : ""}</div>
              <div class="brightness-wheel-viewport wheel-style-${wheelStyle}"
                style="height:${sliderThickness * 5 + 20}px;"
                onwheel="this.getRootNode().host.handleWheelStep(event)"
                onmousedown="this.getRootNode().host.handleWheelDragStart(event)"
                ontouchstart="this.getRootNode().host.handleWheelDragStart(event)">
                <div class="brightness-wheel-caret"></div>
                <div class="brightness-wheel-fade brightness-wheel-fade-left"></div>
                <div class="brightness-wheel-fade brightness-wheel-fade-right"></div>
                <div class="brightness-wheel-track" style="--wheel-shift: ${shift}px; --tick-w: ${tickW}px;">
                  ${ticks}
                </div>
              </div>
              <input type="range" min="${step}" max="100" step="${step}"
                value="${stops[activeIndex]}"
                class="brightness-slider brightness-slider-wheel"
                style="display:none;"
                oninput="this.getRootNode().host.handleBrightnessChange(event)" />
            </div>
          `;
      } else if (sliderStyle === "matrix") {
        // Matrix fill — light pixels up; more lit pixels = brighter (on-theme)
        const cols = Math.max(
          3,
          Math.min(20, parseInt(this.config.brightness_matrix_cols) || 10),
        );
        const rows = Math.max(
          1,
          Math.min(6, parseInt(this.config.brightness_matrix_rows) || 2),
        );
        const matrixDir = this.config.brightness_matrix_direction || "row";
        const matrixPixelStyle =
          this.config.brightness_matrix_pixel_style || "rounded";
        const cellPx = sliderThickness * 3 + 4; // cell size scales with thickness
        const total = cols * rows;
        const litCount = Math.max(
          1,
          Math.round((brightnessPercent / 100) * total),
        );
        let cells = "";
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            let level;
            if (matrixDir === "col") {
              // Column by column, bottom to top within each column
              level = c * rows + (rows - 1 - r) + 1;
            } else {
              // Row by row, bottom row first
              const fromBottom = rows - 1 - r;
              level = fromBottom * cols + c + 1;
            }
            const lit = level <= litCount ? " lit" : "";
            cells += `<div class="brightness-matrix-cell${lit}" data-level="${level}"></div>`;
          }
        }
        html += `
            <div class="brightness-matrix-wrapper">
              <div class="brightness-matrix-grid pixel-shape-${matrixPixelStyle}" data-total="${total}"
                   style="box-sizing:border-box;grid-template-columns:repeat(${cols},1fr);gap:3px;max-width:${cols * (cellPx + 3) + 16}px;"
                   onmousedown="this.getRootNode().host.handleMatrixPointerDown(event)"
                   ontouchstart="this.getRootNode().host.handleMatrixPointerDown(event)">
                ${cells}
              </div>
              ${
                this.config.show_brightness_percentage !== false
                  ? `<div class="brightness-matrix-value">${brightnessPercent}%</div>`
                  : ""
              }
              <input type="range" min="1" max="100" value="${brightness}"
                class="brightness-slider brightness-slider-matrix"
                style="display:none;"
                oninput="this.getRootNode().host.handleBrightnessChange(event)" />
            </div>
          `;
      } else if (sliderStyle === "rotary") {
        // Rotary/circular dial style - 270 degree arc with multiple visual styles
        const rotaryStyle = this.config.brightness_rotary_style || "glow";
        const angle = ((brightnessPercent - 1) / 99) * 270; // Map 1-100% to 0-270 degrees
        const radius = 40;
        const circumference = 2 * Math.PI * radius; // ~251.33
        const arcLength = (circumference * 270) / 360; // Exact 270 degree arc
        const progressArcLength = (angle / 270) * arcLength;
        // Knob angle for the thick pointer: arc starts at 225° (rendered) + progress
        const knobAngle = 225 + angle;
        // Dial style: SVG knob circle at the arc tip endpoint
        const dialKnobAngleRad = (angle * Math.PI) / 180;
        const dialKnobX = (50 + radius * Math.cos(dialKnobAngleRad)).toFixed(2);
        const dialKnobY = (50 + radius * Math.sin(dialKnobAngleRad)).toFixed(2);
        const showStepBtns = this.config.brightness_step_buttons === true;
        const rotaryStep = Math.max(
          1,
          Math.min(25, parseInt(this.config.brightness_step_size) || 5),
        );
        html += `
          <div class="brightness-rotary-wrapper" onwheel="this.getRootNode().host.handleBrightnessWheel(event)">
            <div class="brightness-rotary-container rotary-style-${rotaryStyle}" 
                 onmousedown="this.getRootNode().host.handleRotaryDragStart(event)"
                 ontouchstart="this.getRootNode().host.handleRotaryDragStart(event)"
                 style="position: relative; z-index: 10; --rotary-stroke: ${sliderThickness * 2};">
              <svg class="brightness-rotary-svg" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="brightnessRotaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#ffcf7a" />
                    <stop offset="55%" stop-color="#ff9800" />
                    <stop offset="100%" stop-color="#ff7043" />
                  </linearGradient>
                  <linearGradient id="rotaryGlossGrad" x1="50" y1="10" x2="50" y2="90" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="rgba(255,255,255,0.65)" />
                    <stop offset="35%" stop-color="rgba(255,255,255,0.18)" />
                    <stop offset="100%" stop-color="rgba(0,0,0,0)" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="${radius}" class="rotary-bg"
                  style="stroke-dasharray: ${arcLength} ${circumference};" />
                <circle cx="50" cy="50" r="${radius}" class="rotary-progress rotary-progress-${rotaryStyle}"
                  style="stroke-dasharray: ${progressArcLength} ${circumference};" />
                ${rotaryStyle === "gloss" ? `<circle cx="50" cy="50" r="${radius}" class="rotary-gloss-overlay" style="stroke-dasharray: ${progressArcLength} ${circumference};" />` : ""}
                ${rotaryStyle === "dial" && progressArcLength > 0 ? `<circle class="rotary-dial-knob" cx="${dialKnobX}" cy="${dialKnobY}" r="${sliderThickness + 2}" />` : ""}
              </svg>
              ${rotaryStyle === "thick" ? `<div class="rotary-knob-arm" style="--knob-angle:${knobAngle}deg;"><div class="rotary-knob"></div></div>` : ""}
              <div class="rotary-center-content">
                ${
                  showLabel
                    ? `<div class="rotary-label">${labelContent}</div>`
                    : ""
                }
                ${
                  this.config.show_brightness_percentage !== false
                    ? `<div class="rotary-value">${brightnessPercent}%</div>`
                    : ""
                }
              </div>
              <input 
                type="range" 
                min="1" 
                max="100" 
                value="${brightness}" 
                class="brightness-slider brightness-slider-rotary"
                style="display: none;"
              />
            </div>
          </div>
        `;
      } else if (sliderStyle === "capsule") {
        // Capsule/pill style — uses shared capsule component
        const showMoonIcon = this.config.show_capsule_moon_icon !== false;
        const showSunIcon = this.config.show_capsule_sun_icon !== false;

        // Brightness value display: none / text / input
        const bvd =
          this.config.brightness_value_display ||
          (this.config.show_brightness_percentage !== false ? "text" : "none");
        const bvs = this.config.brightness_value_side || "under";

        let bLeftSlot = null;
        let bRightSlot = null;
        let bIconLeft = showMoonIcon ? "🌙" : null;
        let bIconRight = showSunIcon ? "☀️" : null;
        let bShowValue = false;
        let bValueText = "";
        let bUnderHtml = null;

        if (bvd !== "none") {
          const isInput = bvd === "input";
          if (bvs === "under") {
            if (isInput) {
              bUnderHtml = `<div class="brightness-capsule-slot capsule-value-under"><input id="brightnessinput" class="brightness-capsule-input" type="number" min="1" max="100" step="1" value="${brightnessPercent}" onfocus="this.getRootNode().host._typingBrightness=true" onblur="this.getRootNode().host._handleBrightnessValueBlur(event)" onkeydown="if(event.key==='Enter')this.blur()" oninput="this.getRootNode().host._handleBrightnessValueInput(event)" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" /></div>`;
            } else {
              bShowValue = true;
              bValueText = `${brightnessPercent}%`;
            }
          } else {
            // left or right side — keep icon visible between value and track
            const inputHtml = isInput
              ? `<input id="brightnessinput" class="brightness-capsule-input" type="number" min="1" max="100" step="1" value="${brightnessPercent}" onfocus="this.getRootNode().host._typingBrightness=true" onblur="this.getRootNode().host._handleBrightnessValueBlur(event)" onkeydown="if(event.key==='Enter')this.blur()" oninput="this.getRootNode().host._handleBrightnessValueInput(event)" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" />`
              : `<input id="brightnesstext" class="brightness-capsule-input" type="text" value="${brightnessPercent}%" readonly tabindex="-1" />`;
            if (bvs === "left") {
              // Layout: [value] [icon] [track] — icon stays between value and slider
              const iconHtml = bIconLeft
                ? `<div class="capsule-icon capsule-icon-left">${bIconLeft}</div>`
                : "";
              bLeftSlot = `<div class="brightness-capsule-slot">${inputHtml}${iconHtml}</div>`;
              bIconLeft = null; // already included in slot
            } else {
              // Layout: [track] [icon] [value] — icon stays between slider and value
              const iconHtml = bIconRight
                ? `<div class="capsule-icon capsule-icon-right">${bIconRight}</div>`
                : "";
              bRightSlot = `<div class="brightness-capsule-slot">${iconHtml}${inputHtml}</div>`;
              bIconRight = null; // already included in slot
            }
          }
        }

        html += `<div class="brightness-capsule-host${this.config.brightness_capsule_variant === "thick" ? " capsule-variant-thick" : ""}">`;
        html += renderCapsuleHTML({
          theme: brightnessTheme,
          thickness: sliderThickness,
          value: brightness,
          min: 1,
          max: 100,
          iconLeft: bIconLeft,
          iconRight: bIconRight,
          leftSlotHtml: bLeftSlot,
          rightSlotHtml: bRightSlot,
          hostInputHandler:
            "this.getRootNode().host.handleBrightnessChange(event)",
          hostDragStart: "this.getRootNode().host._startDrag()",
          hostDragEnd: "this.getRootNode().host._endDrag()",
          label: showLabel ? labelContent : null,
          showValue: bShowValue,
          valueText: bValueText,
          underHtml: bUnderHtml,
          trackExtraHtml: this.config.brightness_snap_to_positions
            ? `<div class="capsule-snap-ticks">${[20, 40, 60, 80].map((v) => `<div class="capsule-snap-tick" style="left:${((v - 1) / 99) * 100}%"></div>`).join("")}</div>`
            : "",
          // No wheelHandler — outer brightness-slider-container handles it
        });
        html += `</div>`;
      } else {
        // Slider style with multiple visual variants
        const sliderVariant = this.config.brightness_slider_variant || "thin";
        if (showLabel) {
          html += `<div class="brightness-label">${labelContent}</div>`;
        }
        if (sliderVariant === "glow") {
          html += `
            <div class="brightness-bar-wrapper brightness-glow-wrapper">
              <div class="brightness-glow-track">
                <div class="brightness-glow-fill" style="width: ${brightnessPercent}%"></div>
                <div class="brightness-glow-thumb" style="left: ${brightnessPercent}%"></div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value="${brightness}" 
                  class="brightness-slider brightness-slider-glow"
                  onmousedown="this.getRootNode().host._startDrag()"
                  ontouchstart="this.getRootNode().host._startDrag()"
                  onmouseup="this.getRootNode().host._endDrag()"
                  ontouchend="this.getRootNode().host._endDrag()"
                  oninput="this.getRootNode().host.handleBrightnessChange(event)"
                />
              </div>
              ${
                this.config.show_brightness_percentage !== false
                  ? `<div class="brightness-value-right">${brightnessPercent}%</div>`
                  : ""
              }
            </div>
          `;
        } else {
          html += `
            <div class="brightness-slider-wrapper${
              this.config.show_brightness_percentage !== false
                ? ""
                : " brightness-slider-full"
            }" style="--slider-pct:${brightnessPercent}%">
              <input 
                type="range" 
                min="1" 
                max="100" 
                value="${brightness}" 
                class="brightness-slider brightness-slider-variable slider-variant-${sliderVariant}"
                style="--slider-pct:${brightnessPercent}%"
                onmousedown="this.getRootNode().host._startDrag()"
                ontouchstart="this.getRootNode().host._startDrag()"
                onmouseup="this.getRootNode().host._endDrag()"
                ontouchend="this.getRootNode().host._endDrag()"
                oninput="this.getRootNode().host.handleBrightnessChange(event)"
              />
              ${
                this.config.show_brightness_percentage !== false
                  ? `<span class="brightness-value-slider">${brightnessPercent}%</span>`
                  : ""
              }
            </div>
          `;
        }
      }

      // Global step buttons inside the container
      if (this.config.show_brightness_slider === true) {
        const showGlobalStepBtns = this.config.brightness_step_buttons === true;
        const globalStep = Math.max(
          1,
          Math.min(25, parseInt(this.config.brightness_step_size) || 5),
        );
        const stepPos = this.config.brightness_step_position || "below";
        if (showGlobalStepBtns && stepPos === "below") {
          html += `
          <div class="brightness-step-buttons brightness-step-below">
            <button class="rotary-step-btn" title="Decrease by ${globalStep}%"
              onclick="this.getRootNode().host.handleRotaryStep(-${globalStep})">&#x2212;</button>
            <button class="rotary-step-btn" title="Increase by ${globalStep}%"
              onclick="this.getRootNode().host.handleRotaryStep(${globalStep})">&#x2b;</button>
          </div>`;
        }
      }

      html += `</div>`;

      // Sides layout: buttons flank the slider container (wrap in a flex row)
      if (this.config.show_brightness_slider === true) {
        const showGlobalStepBtns = this.config.brightness_step_buttons === true;
        const globalStep = Math.max(
          1,
          Math.min(25, parseInt(this.config.brightness_step_size) || 5),
        );
        const stepPos = this.config.brightness_step_position || "below";
        if (showGlobalStepBtns && stepPos === "sides") {
          // Wrap last block with side buttons; the container div is already closed above
          // Re-open a row wrapper using a class that JS or CSS handles
          // Strategy: inject side buttons as sibling elements the parent flex handles
          const lastDiv = html.lastIndexOf(
            '<div class="brightness-slider-container',
          );
          const closingIdx = html.lastIndexOf("</div>");
          const inner = html.slice(lastDiv, closingIdx + 6);
          html = html.slice(0, lastDiv);
          html += `<div class="brightness-sides-row">
            <button class="rotary-step-btn rotary-step-side" title="Decrease by ${globalStep}%"
              onclick="this.getRootNode().host.handleRotaryStep(-${globalStep})">&#x2212;</button>
            ${inner}
            <button class="rotary-step-btn rotary-step-side" title="Increase by ${globalStep}%"
              onclick="this.getRootNode().host.handleRotaryStep(${globalStep})">&#x2b;</button>
          </div>`;
        }
      }
    }

    return html;
  }

  _generateAdjustmentControlsHtml(effects) {
    let html = "";

    const layoutMode = this.config.adjustments_layout || "grouped";

    // Derive effectsData from SECTIONS_REGISTRY + EFFECTS_REGISTRY
    const effectsData = SECTIONS_REGISTRY.map((section) => ({
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

    // Generate HTML based on layout mode
    if (layoutMode === "compact") {
      html += this._generateCompactLayout(effectsData);
    } else if (layoutMode === "tabbed") {
      html += this._generateTabbedLayout(effectsData);
    } else if (layoutMode === "radial") {
      html += this._generateRadialLayout(effectsData);
    } else if (layoutMode === "categories") {
      html += this._generateCategoriesLayout(effectsData);
    } else {
      // Default to "grouped" layout
      html += this._generateGroupedLayout(effectsData);
    }

    return html;
  }

  _generatePowerToggleHtml(stateObj) {
    const style = this.config.buttons_style || "classic";
    const isOn = stateObj.state === "on";
    const stateClass = isOn ? "on" : "off";
    const label = isOn ? "Turn Off" : "Turn On";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";

    // Use centralized utility for button class
    const buttonClass = getExportImportButtonClass("power", style);

    return `
      <div class="power-toggle-container">
        <button 
          class="${buttonClass} ${stateClass}"
          onclick="this.getRootNode().host.handlePowerToggle()"
          title="${label}"
        >
          ${renderButtonContent("mdi:power", label, contentMode)}
        </button>
      </div>
    `;
  }

  _generateForceRefreshButtonHtml() {
    const style = this.config.buttons_style || "classic";
    const isLoading = this._forceRefreshLoading;
    const icon = isLoading ? "mdi:loading" : "mdi:flash";
    const label = isLoading ? "Refreshing..." : "Force Refresh";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";
    const buttonClass = getExportImportButtonClass("force-refresh", style);
    const disabledAttr = isLoading ? " disabled" : "";

    return `
      <div class="force-refresh-container">
        <button 
          class="${buttonClass}${isLoading ? " loading" : ""}" 
          onclick="this.getRootNode().host.forceRefreshLamp()"
          title="Force Refresh"
          ${disabledAttr}
        >
          ${renderButtonContent(icon, label, contentMode)}
        </button>
      </div>
    `;
  }

  // Compact Layout: All controls in a single clean panel with minimal spacing
  _generateCompactLayout(sections) {
    const showIndicators = this.config?.show_change_indicators ?? true;
    const resetButtonMode = this.config.reset_button_mode || "always";
    const sectionStyle =
      this.config.section_style ||
      this.config.grouped_section_style ||
      "subtle";

    // Add class to container based on reset button mode and section style for CSS styling
    let html = `<div class="effects-compact-container reset-mode-${resetButtonMode} style-${sectionStyle}">`;

    // Render all effects in a compact grid
    sections.forEach((section) => {
      section.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        const hasChanged = this._checkEffectChanged(effect.name);

        // Determine if reset button should be visible
        let resetButtonVisible = false;
        if (resetButtonMode === "always") {
          resetButtonVisible = true;
        } else if (resetButtonMode === "changed") {
          resetButtonVisible = hasChanged;
        }
        // resetButtonMode === "never" ? resetButtonVisible stays false

        html += `
          <div class="compact-slider-row">
            <span class="compact-icon">${effect.icon || section.icon}</span>
            <span class="compact-label">
              ${effect.label}
              ${
                showIndicators
                  ? `<span class="change-indicator compact-indicator ${
                      hasChanged ? "visible" : ""
                    }" data-effect="${effect.name}"></span>`
                  : ""
              }
            </span>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="compact-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
            <span class="compact-value" data-effect="${
              effect.name
            }">${displayValue}${effect.unit}</span>
            <button 
              class="compact-reset-button" 
              data-effect="${effect.name}"
              onclick="this.getRootNode().host.resetEffect('${effect.name}')"
              title="Reset ${effect.label}"
              style="display: ${resetButtonVisible ? "flex" : "none"};"
            >
              🔄
            </button>
          </div>
        `;
      });
    });

    html += "</div>";
    return html;
  }

  // Tabbed Layout: Effects organized in tabs with smooth transitions
  _generateTabbedLayout(sections) {
    const activeTab = this._activeTab || sections[0].id;
    const sectionStyle =
      this.config.section_style ||
      this.config.grouped_section_style ||
      "subtle";

    let html = `<div class="effects-tabbed-container style-${sectionStyle}">`;

    // Tab headers
    html += '<div class="tab-headers">';
    sections.forEach((section) => {
      const isActive = section.id === activeTab;
      html += `
        <button 
          class="tab-header ${isActive ? "active" : ""}" 
          title="${section.title}"
          onclick="this.getRootNode().host.switchTab('${section.id}')"
        >
          <span class="tab-icon">${section.icon}</span>
          <span class="tab-title">${section.title}</span>
          <span class="change-indicator" data-section-id="${section.id}"></span>
        </button>
      `;
    });
    html += "</div>";

    // Tab content
    html += '<div class="tab-content-container">';
    sections.forEach((section) => {
      const isActive = section.id === activeTab;

      // Determine button visibility based on mode
      const resetButtonMode = this.config.reset_button_mode || "always";
      let resetButtonVisible = "none";
      if (resetButtonMode === "always") {
        resetButtonVisible = "flex";
      } else if (resetButtonMode === "changed") {
        const hasChanges = this._checkSectionChanges(section.id);
        resetButtonVisible = hasChanges ? "flex" : "none";
      }
      // resetButtonMode === "never" ? stays "none"

      html += `
        <div class="tab-content ${isActive ? "active" : ""}" data-tab="${
          section.id
        }" data-section-id="${section.id}">
      `;

      section.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        html += `
          <div class="tabbed-slider-row">
            <div class="tabbed-label-row">
              <label class="tabbed-label" data-effect="${effect.name}">${
                effect.label
              }: <strong>${displayValue}${effect.unit}</strong></label>
              ${
                effect.hint
                  ? `<span class="tabbed-hint">${effect.hint}</span>`
                  : ""
              }
            </div>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="tabbed-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
          </div>
        `;
      });

      // Add reset button at the end (always rendered, visibility controlled by inline style)
      html += `
        <button 
          class="tabbed-reset-button" 
          data-section-id="${section.id}"
          onclick="this.getRootNode().host.resetSection('${section.id}')"
          title="Reset ${section.title}"
          style="display: ${resetButtonVisible};"
        >
          🔄 Reset
        </button>
      `;

      html += "</div>";
    });
    html += "</div>";

    html += "</div>";
    return html;
  }

  // Grouped Layout: Modern collapsible cards with better spacing (default)
  _generateGroupedLayout(sections) {
    const sectionStyle =
      this.config.section_style ||
      this.config.grouped_section_style ||
      "subtle";
    let html = '<div class="effects-grouped-container">';

    sections.forEach((section, index) => {
      const isExpanded = this._expandedSections[section.id] === true;

      // Determine button visibility based on mode
      const resetButtonMode = this.config.reset_button_mode || "always";
      let resetButtonVisible = "none";
      if (resetButtonMode === "always") {
        resetButtonVisible = "block";
      } else if (resetButtonMode === "changed") {
        const hasChanges = this._checkSectionChanges(section.id);
        resetButtonVisible = hasChanges ? "block" : "none";
      }
      // resetButtonMode === "never" ? stays "none"

      html += `
        <div class="grouped-section style-${sectionStyle} ${
          isExpanded ? "expanded" : "collapsed"
        }" data-section-id="${section.id}" style="z-index: ${
          isExpanded ? 100 : 10 - index
        };">
          <div class="grouped-header" onclick="this.getRootNode().host.toggleSection('${
            section.id
          }')">
            <div class="grouped-header-left">
              <span class="grouped-icon">${
                section.icon
              }<span class="change-indicator" data-section-id="${
                section.id
              }"></span></span>
              <div class="grouped-title-area">
                <span class="grouped-title">${section.title}</span>
                <span class="grouped-description">${section.description}</span>
              </div>
            </div>
            <div class="grouped-header-right">
              <button 
                class="grouped-reset" 
                data-section-id="${section.id}"
                onclick="event.stopPropagation(); this.getRootNode().host.resetSection('${
                  section.id
                }');"
                title="Reset ${section.title}"
                style="display: ${resetButtonVisible};"
              >
                🔄
              </button>
            </div>
          </div>
          <div class="grouped-content" data-section="${section.id}">
      `;

      section.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        html += `
          <div class="grouped-slider-row">
            <div class="grouped-label-row">
              <label class="grouped-label">${effect.label}</label>
              <span class="grouped-value" data-effect="${
                effect.name
              }">${displayValue}${effect.unit}</span>
            </div>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="grouped-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
            ${
              effect.hint
                ? `<span class="grouped-hint">${effect.hint}</span>`
                : ""
            }
          </div>
        `;
      });

      html += "</div></div>";
    });

    html += "</div>";
    return html;
  }

  // Radial Layout: Color wheel selector with dynamic slider panel
  _generateRadialLayout(sections) {
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

    const sectionStyle =
      this.config.section_style ||
      this.config.grouped_section_style ||
      "subtle";

    let html = `<div class="effects-radial-container style-${sectionStyle}">`;

    // Left side: Half-circle selector (facing right, positioned at left edge)
    html += '<div class="radial-wheel-container">';
    html += '<svg class="radial-wheel" viewBox="-5 0 80 160">';

    const centerX = 0; // At the left edge
    const centerY = 80; // Vertically centered
    const outerRadius = 70;
    const innerRadius = 36;

    // Draw CATEGORY segments only (not individual effects)
    const numCategories = sections.length;
    const angleStep = 180 / numCategories; // Divide half-circle by number of categories

    sections.forEach((section, index) => {
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

      // Determine segment styling based on state and config
      // IMPORTANT: Classes are set during HTML generation, NOT post-render
      // This prevents blinking when switching categories
      const showIndicators = this.config?.show_change_indicators ?? true;
      const hasChanges =
        showIndicators && this._checkSectionChanges(section.id);

      let segmentClass = "radial-segment";
      if (isActive) {
        segmentClass += " active-category";
      }
      if (hasChanges) {
        segmentClass += " has-changes";
      }

      html += `
        <path 
          class="${segmentClass}" 
          d="M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1} Z"
          data-category="${section.id}"
          data-section-id="${section.id}"
          onclick="this.getRootNode().host.selectRadialCategory('${section.id}')"
        ><title>${section.title}</title></path>
      `;

      // Category icon in the ring
      const midAngle = (startAngle + endAngle) / 2;
      const iconRadius = (innerRadius + outerRadius) / 2;
      const iconX = centerX + iconRadius * Math.cos(midAngle);
      const iconY = centerY + iconRadius * Math.sin(midAngle);

      html += `
        <text 
          x="${iconX}" 
          y="${iconY}" 
          class="radial-icon ${isActive ? "active-category" : ""}"
          text-anchor="middle" 
          dominant-baseline="middle"
          pointer-events="none"
        >${section.icon}</text>
      `;
    });

    // Center half-circle (only draw the right half)
    const innerArcPath = `M ${centerX} ${
      centerY - innerRadius
    } A ${innerRadius} ${innerRadius} 0 0 1 ${centerX} ${
      centerY + innerRadius
    }`;
    html += `<path d="${innerArcPath} L ${centerX} ${
      centerY + innerRadius
    } L ${centerX} ${centerY - innerRadius} Z" class="radial-center" />`;

    // Draw separator lines between categories (AFTER center so they're visible)
    for (let i = 1; i < numCategories; i++) {
      const angle = (-90 + i * angleStep) * (Math.PI / 180);
      const x1 = centerX + innerRadius * Math.cos(angle);
      const y1 = centerY + innerRadius * Math.sin(angle);
      const x2 = centerX + outerRadius * Math.cos(angle);
      const y2 = centerY + outerRadius * Math.sin(angle);

      html += `
        <line 
          x1="${x1}" y1="${y1}" 
          x2="${x2}" y2="${y2}" 
          class="radial-separator"
          pointer-events="none"
        />
      `;
    }

    // Draw outer border arc (half-circle)
    const outerArcPath = `M ${centerX} ${
      centerY - outerRadius
    } A ${outerRadius} ${outerRadius} 0 0 1 ${centerX} ${
      centerY + outerRadius
    }`;
    html += `<path d="${outerArcPath}" class="radial-outer-border" pointer-events="none" />`;

    if (activeSection) {
      // Position icon in the center of the visible half circle (at half the radius)
      html += `
        <text 
          x="${innerRadius / 2}" 
          y="${centerY}" 
          class="radial-center-icon"
          text-anchor="middle" 
          dominant-baseline="middle"
        ><title>${activeSection.title}</title>${activeSection.icon}</text>
      `;
    }

    html += "</svg>";
    html += "</div>"; // End radial-wheel-container

    // Right side: Sliders for all effects in active category
    html +=
      '<div class="radial-slider-panel" data-section-id="' +
      activeSection.id +
      '">';

    if (activeSection) {
      // Determine button visibility based on mode
      const resetButtonMode = this.config.reset_button_mode || "always";
      let resetButtonVisible = "none";
      if (resetButtonMode === "always") {
        resetButtonVisible = "block";
      } else if (resetButtonMode === "changed") {
        const hasChanges = this._checkSectionChanges(activeSection.id);
        resetButtonVisible = hasChanges ? "block" : "none";
      }
      // resetButtonMode === "never" ? stays "none"

      html += `
        <div class="radial-category-header">
          <div class="radial-category-title">${activeSection.title}<span class="change-indicator" data-section-id="${activeSection.id}"></span></div>
          <button class="radial-reset-button" 
            data-section-id="${activeSection.id}"
            onclick="this.getRootNode().host.resetSection('${activeSection.id}')" 
            title="Reset ${activeSection.title}"
            style="display: ${resetButtonVisible};">
            🔄 Reset
          </button>
        </div>
      `;

      activeSection.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        const isSelected = effect.name === selectedEffect;
        const selectedClass = isSelected ? " selected" : "";

        html += `
          <div class="radial-effect-row${selectedClass}" data-effect="${effect.name}">
            <div class="radial-effect-row-header">
              <span class="radial-effect-row-label">${effect.label}</span>
              <span class="radial-effect-row-value">${displayValue}${effect.unit}</span>
            </div>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="radial-effect-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${effect.name}', event)"
              onclick="event.stopPropagation()"
            />
          </div>
        `;
      });
    }

    html += "</div>"; // End radial-slider-panel
    html += "</div>"; // End effects-radial-container

    return html;
  }

  // Categories Layout: Icon column on left with category-based slider panel
  _generateCategoriesLayout(sections) {
    const activeSection =
      sections.find((s) => s.id === this._activeRadialSection) || sections[0];
    this._activeRadialSection = activeSection.id;

    const sectionStyle =
      this.config.section_style ||
      this.config.grouped_section_style ||
      "subtle";

    let html = `<div class="effects-categories-container style-${sectionStyle}">`;

    // Left side: Vertical icon column
    html += '<div class="categories-icon-column">';
    sections.forEach((section, index) => {
      const isActive = section.id === activeSection.id;
      html += `
        <div 
          class="categories-icon-button ${isActive ? "active" : ""}" 
          onclick="this.getRootNode().host.selectCircularCategory('${
            section.id
          }')"
          title="${section.title}"
        >
          <span class="categories-icon-emoji">${section.icon}</span>
          <span class="change-indicator" data-section-id="${section.id}"></span>
        </div>
      `;
    });
    html += "</div>"; // End icon column

    // Right side: Sliders for active category
    html +=
      '<div class="categories-slider-panel" data-section-id="' +
      activeSection.id +
      '">';

    if (activeSection) {
      const resetButtonVisible = this._shouldShowResetButton(activeSection.id)
        ? "block"
        : "none";

      html += `
        <div class="categories-category-header">
          <div class="categories-category-title">${activeSection.title}</div>
          <button 
            class="categories-reset-button" 
            data-section-id="${activeSection.id}"
            title="Reset ${activeSection.title}"
            onclick="this.getRootNode().host.resetSection('${activeSection.id}')"
            style="display: ${resetButtonVisible};"
          >
            🔄 Reset
          </button>
        </div>
      `;

      activeSection.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        html += `
          <div class="categories-effect-row">
            <div class="categories-effect-row-header">
              <span class="categories-effect-row-label">${effect.label}</span>
              <span class="categories-effect-row-value" data-effect="${
                effect.name
              }">${displayValue}${effect.unit}</span>
            </div>
            <input
              type="range"
              class="categories-effect-slider"
              min="${effect.min}"
              max="${effect.max}"
              step="${effect.step || 1}"
              value="${displayValue}"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
          </div>
        `;
      });
    }

    html += "</div>"; // End categories-slider-panel
    html += "</div>"; // End effects-categories-container

    return html;
  }

  _getStyles() {
    const totalRows = 5;
    const totalCols = 20;
    const pixelStyle = this.config.matrix_pixel_style || "square";
    // Resolve pixel spacing mode for CSS styles
    const spacingMode =
      this.config.matrix_spacing_mode ||
      (this.config.matrix_pixel_spacing === false ? "none" : "normal");
    const lampDotShadow = spacingMode === "subtle" || spacingMode === "normal";

    return `
      <style>
        /* Inject centralized button styles */
        ${exportImportButtonStyles}

        .yeelight-cube-lamp-preview-container {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          min-height: 0;
          display: block;
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
          box-shadow: ${lampDotShadow ? "0 0 2px #0008" : "none"};
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
        .device-orientation-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          padding: 4px 10px 10px;
          margin: 0 0 4px;
        }
        .device-orientation-row .orient-btn {
          width: 44px;
          height: 40px;
          border: none;
          border-radius: 10px;
          background: var(--secondary-background-color, #e0e0e0);
          color: var(--primary-text-color, #444);
          font-size: 1.2rem;
          line-height: 1;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
        }
        .device-orientation-row .orient-btn:hover {
          transform: translateY(-1px);
        }
        .device-orientation-row .orient-btn.active {
          background: linear-gradient(135deg, #b026ff, #ff5e3a);
          color: #fff;
          box-shadow: 0 2px 8px rgba(176, 38, 255, 0.4);
        }
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
        .brightness-slider-container {
          margin: 10px 0;
          padding: 10px 0;
          text-align: center;
        }
        .brightness-label {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--primary-text-color);
          text-align: left;
        }
        .brightness-slider-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .brightness-slider-full {
          gap: 0;
        }
        .brightness-value-slider {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          min-width: 40px;
          text-align: right;
          flex-shrink: 0;
        }
        .brightness-percentage-standalone {
          font-size: 16px;
          font-weight: 600;
          color: var(--primary-text-color);
          text-align: center;
          padding: 8px 0;
        }
        
        /* Slider Style - Variable Thickness with multiple visual variants */
        /* Base styles shared by all variants */
        .brightness-slider-variable {
          width: 100%;
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        /* thin (default) — minimal hair-line track */
        .brightness-slider-variable.slider-variant-thin {
          height: var(--slider-thickness, 6px);
          border-radius: calc(var(--slider-thickness, 6px) / 2);
          background: linear-gradient(to right, #ff9800, var(--divider-color, #444));
        }
        .brightness-slider-variable.slider-variant-thin::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: calc(var(--slider-thickness, 6px) * 3.2);
          height: calc(var(--slider-thickness, 6px) * 3.2);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .brightness-slider-variable.slider-variant-thin::-moz-range-thumb {
          width: calc(var(--slider-thickness, 6px) * 3.2);
          height: calc(var(--slider-thickness, 6px) * 3.2);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          border: none;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        /* thick — chunky solid track, fill tracks cursor via --slider-pct */
        .brightness-slider-variable.slider-variant-thick {
          height: calc(var(--slider-thickness, 6px) * 4);
          border-radius: 6px;
          background: linear-gradient(to right,
            #ff9800 0%,
            #ffc56b var(--slider-pct, 50%),
            var(--divider-color, rgba(0,0,0,0.14)) var(--slider-pct, 50%),
            var(--divider-color, rgba(0,0,0,0.14)) 100%);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .brightness-slider-variable.slider-variant-thick::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 7);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          border: 2px solid var(--divider-color, #ccc);
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        }
        .brightness-slider-variable.slider-variant-thick::-moz-range-thumb {
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 7);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          border: 2px solid var(--divider-color, #ccc);
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        }
        /* Backwards compat: unmigrated configs had no variant key */
        .brightness-slider-variable:not([class*="slider-variant-"]) {
          height: var(--slider-thickness, 6px);
          border-radius: calc(var(--slider-thickness, 6px) / 2);
          background: linear-gradient(to right, var(--disabled-text-color, #333), var(--card-background-color, #fff));
        }
        .brightness-slider-variable:not([class*="slider-variant-"])::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 3);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .brightness-slider-variable:not([class*="slider-variant-"])::-moz-range-thumb {
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 3);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          border: none;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        /* Bar Style (Mushroom-like) */
        .brightness-bar-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .brightness-bar-wrapper.brightness-bar-full {
          gap: 8px;
        }
        .brightness-label-left {
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color);
          white-space: nowrap;
          min-width: 80px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .brightness-label-left:has(span:only-child) {
          font-size: 24px;
          min-width: 40px;
          justify-content: center;
        }
        .brightness-bar-track {
          position: relative;
          flex: 1;
          height: calc(var(--slider-thickness, 6px) * 5.5);
          background: var(--disabled-color, rgba(255,255,255,0.1));
          border-radius: calc(var(--slider-thickness, 6px) * 2);
          overflow: hidden;
        }
        .brightness-bar-fill {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          background: linear-gradient(90deg, #ffa726 0%, #ffb74d 100%);
          border-radius: 12px;
          transition: width 0.1s ease;
          pointer-events: none;
        }
        .brightness-slider-bar {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          -webkit-appearance: none;
          cursor: pointer;
          outline: none;
        }
        .brightness-slider-bar::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 0;
          height: 0;
          opacity: 0;
        }
        .brightness-slider-bar::-moz-range-thumb {
          width: 0;
          height: 0;
          opacity: 0;
          border: none;
        }

        /* ===== Bar fill styles (modifier classes on .brightness-bar-track) ===== */
        .brightness-bar-seams {
          position: absolute;
          inset: 0;
          pointer-events: none;
          display: none;
        }
        /* Pulse — use --brightness-color */
        .bar-fill-pulse .brightness-bar-fill {
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%,
            var(--brightness-color, #ff9800) 60%,
            color-mix(in srgb, var(--brightness-color, #ff9800) 60%, #fff) 100%);
          animation: barPulseGlow 2s ease-in-out infinite;
        }
        @keyframes barPulseGlow {
          0%, 100% { box-shadow: 0 0 6px color-mix(in srgb, var(--brightness-color, #ff9800) 40%, transparent); opacity: 1; }
          50%       { box-shadow: 0 0 18px color-mix(in srgb, var(--brightness-color, #ff9800) 85%, transparent), 0 0 32px color-mix(in srgb, var(--brightness-color, #ff9800) 40%, transparent); opacity: 0.92; }
        }
        /* Stripes — use --brightness-color */
        .bar-fill-stripes .brightness-bar-fill {
          background:
            repeating-linear-gradient(
              -45deg,
              rgba(255, 255, 255, 0.22) 0,
              rgba(255, 255, 255, 0.22) 8px,
              transparent 8px,
              transparent 16px
            ),
            linear-gradient(90deg,
              color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%,
              var(--brightness-color, #ff9800) 100%);
          background-size: 22px 100%, 100% 100%;
          animation: barStripesShift 0.8s linear infinite;
        }
        /* Stripes are paused until drag starts; JS removes/re-adds .bar-stripes-idle */
        .bar-fill-stripes.bar-stripes-idle .brightness-bar-fill {
          animation-play-state: paused;
        }
        @keyframes barStripesShift {
          from {
            background-position:
              0 0,
              0 0;
          }
          to {
            background-position:
              22px 0,
              0 0;
          }
        }
        /* Gloss — use --brightness-color */
        .bar-fill-gloss .brightness-bar-fill {
          background:
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.55) 0%,
              rgba(255, 255, 255, 0.08) 46%,
              rgba(0, 0, 0, 0.12) 54%,
              rgba(0, 0, 0, 0) 100%
            ),
            linear-gradient(90deg,
              color-mix(in srgb, var(--brightness-color, #ff9800) 80%, #000) 0%,
              color-mix(in srgb, var(--brightness-color, #ff9800) 70%, #fff) 100%);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.5);
        }

        /* Glow (neon pill) Style */
        .brightness-glow-wrapper {
          gap: 12px;
        }
        .brightness-glow-track {
          position: relative;
          flex: 1;
          height: calc(var(--slider-thickness, 6px) * 3.5);
          background: var(--primary-background-color, rgba(0, 0, 0, 0.35));
          border-radius: 999px;
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
          overflow: visible;
        }
        .brightness-glow-fill {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%,
            var(--brightness-color, #ff9800) 55%,
            color-mix(in srgb, var(--brightness-color, #ff9800) 60%, #fff) 100%
          );
          border-radius: 999px;
          box-shadow:
            0 0 8px color-mix(in srgb, var(--brightness-color, #ff9800) 75%, transparent),
            0 0 16px color-mix(in srgb, var(--brightness-color, #ff9800) 45%, transparent);
          transition: width 0.1s ease;
          pointer-events: none;
        }
        .brightness-glow-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: calc(var(--slider-thickness, 6px) * 3.5 + 6px);
          height: calc(var(--slider-thickness, 6px) * 3.5 + 6px);
          border-radius: 50%;
          background: radial-gradient(
            circle at 35% 30%,
            #fff 0%,
            #ffd38a 45%,
            #ff9800 100%
          );
          box-shadow:
            0 0 6px rgba(255, 200, 100, 0.9),
            0 0 14px rgba(255, 150, 0, 0.6),
            0 2px 4px rgba(0, 0, 0, 0.3);
          transition: left 0.1s ease;
          pointer-events: none;
          z-index: 3;
        }
        .brightness-slider-glow {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          -webkit-appearance: none;
          cursor: pointer;
          outline: none;
          z-index: 2;
        }
        .brightness-slider-glow::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 0;
          height: 0;
          opacity: 0;
        }
        .brightness-slider-glow::-moz-range-thumb {
          width: 0;
          height: 0;
          opacity: 0;
          border: none;
        }

        /* ===== Preset Wheel Style ===== */
        .brightness-wheel-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 100%;
        }
        .brightness-wheel-value {
          font-size: 22px;
          font-weight: 700;
          color: var(--primary-text-color);
          text-shadow: 0 0 10px rgba(255, 152, 0, 0.3);
        }
        /* Wheel viewport grows with slider thickness */
        .brightness-wheel-viewport {
          position: relative;
          width: 100%;
          min-height: 40px;
          overflow: hidden;
          border-radius: 12px;
          background: color-mix(
            in srgb,
            var(--card-background-color, #fff) 84%,
            #000
          );
          box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.28);
          cursor: ew-resize;
          touch-action: none;
          user-select: none;
        }
        /* === Wheel style variants === */
        /* dots style — round pip indicators */
        .brightness-wheel-viewport.wheel-style-dots .brightness-wheel-track {
          align-items: center;
        }
        .wheel-style-dots .wheel-tick-mark {
          width: calc(var(--slider-thickness, 6px) * 1.5 + 4px) !important;
          height: calc(var(--slider-thickness, 6px) * 1.5 + 4px) !important;
          min-width: 8px;
          min-height: 8px;
          border-radius: 50% !important;
          background: var(--secondary-text-color, #aaa) !important;
          opacity: 0.7;
        }
        .wheel-style-dots .brightness-wheel-tick.active .wheel-tick-mark {
          background: var(--brightness-color, #ff9800) !important;
          box-shadow: 0 0 6px color-mix(in srgb, var(--brightness-color, #ff9800) 70%, transparent) !important;
          opacity: 1;
          width: calc(var(--slider-thickness, 6px) * 2 + 6px) !important;
          height: calc(var(--slider-thickness, 6px) * 2 + 6px) !important;
        }
        /* mesh style — woven cross-hatch texture over the viewport */
        .brightness-wheel-viewport.wheel-style-mesh,
        .brightness-wheel-viewport.wheel-style-bars {
          background-image:
            repeating-linear-gradient(45deg,
              rgba(0,0,0,0.07) 0, rgba(0,0,0,0.07) 1px,
              transparent 0, transparent 50%),
            repeating-linear-gradient(-45deg,
              rgba(0,0,0,0.07) 0, rgba(0,0,0,0.07) 1px,
              transparent 0, transparent 50%);
          background-size: 7px 7px;
        }
        .wheel-style-mesh .wheel-tick-mark,
        .wheel-style-bars .wheel-tick-mark {
          background: color-mix(in srgb, var(--brightness-color, #ff9800) 55%, var(--secondary-text-color, #888)) !important;
        }
        .wheel-style-mesh .brightness-wheel-tick.active .wheel-tick-mark,
        .wheel-style-bars .brightness-wheel-tick.active .wheel-tick-mark {
          background: var(--brightness-color, #ff9800) !important;
          box-shadow: 0 0 8px color-mix(in srgb, var(--brightness-color, #ff9800) 80%, transparent) !important;
          height: 70% !important;
          width: 4px !important;
        }
        /* ===== Wheel style gradient removed — keep class for harmless compat ===== */
        .brightness-wheel-track {
          position: absolute;
          left: 50%;
          top: 0;
          height: 100%;
          display: flex;
          align-items: center;
          transform: translateX(var(--wheel-shift, -26px));
          transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .brightness-wheel-tick {
          height: 100%;
          flex: 0 0 52px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          opacity: 0.45;
          transform: scale(0.82);
          transition:
            opacity 0.18s ease,
            transform 0.18s ease;
        }
        .brightness-wheel-tick .wheel-tick-mark {
          width: 3px;
          height: calc(50% - 6px);
          max-height: 22px;
          border-radius: 3px;
          background: var(--secondary-text-color, #888);
        }
        .brightness-wheel-tick .wheel-tick-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--secondary-text-color, #888);
        }
        .brightness-wheel-tick.active {
          opacity: 1;
          transform: scale(1.08);
        }
        .brightness-wheel-tick.active .wheel-tick-mark {
          height: calc(65% - 4px);
          max-height: 28px;
          background: linear-gradient(180deg, #ffcf7a, #ff8f00);
          box-shadow: 0 0 8px rgba(255, 152, 0, 0.7);
        }
        .brightness-wheel-tick.active .wheel-tick-label {
          color: var(--primary-text-color);
        }
        .brightness-wheel-caret {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 2px;
          height: 100%;
          background: linear-gradient(
            180deg,
            transparent,
            rgba(255, 152, 0, 0.85),
            transparent
          );
          z-index: 3;
          pointer-events: none;
        }
        .brightness-wheel-fade {
          position: absolute;
          top: 0;
          width: 34px;
          height: 100%;
          z-index: 2;
          pointer-events: none;
        }
        .brightness-wheel-fade-left {
          left: 0;
          background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--card-background-color, #fff) 84%, #000),
            transparent
          );
        }
        .brightness-wheel-fade-right {
          right: 0;
          background: linear-gradient(
            270deg,
            color-mix(in srgb, var(--card-background-color, #fff) 84%, #000),
            transparent
          );
        }

        /* ===== Matrix Fill Style ===== */
        .brightness-matrix-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .brightness-matrix-grid {
          flex: 1;
          display: grid;
          gap: 4px;
          padding: 8px;
          border-radius: 10px;
          background: #101012;
          box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.55);
          cursor: pointer;
          user-select: none;
          touch-action: none;
        }
        .brightness-matrix-cell {
          aspect-ratio: 1 / 1;
          border-radius: 3px;
          background: #2a2a2e;
          box-shadow: inset 0 0 2px rgba(0, 0, 0, 0.6);
          transition:
            background 0.12s ease,
            box-shadow 0.12s ease;
        }
        /* matrix color now pulled from --brightness-color CSS var */
        .brightness-matrix-cell.lit {
          background: radial-gradient(
            circle at 40% 35%,
            color-mix(in srgb, var(--brightness-color, #ff9800) 15%, #fff) 0%,
            var(--brightness-color, #ff9800) 55%,
            color-mix(in srgb, var(--brightness-color, #ff9800) 80%, #000) 100%
          );
          box-shadow:
            0 0 6px color-mix(in srgb, var(--brightness-color, #ff9800) 75%, transparent),
            inset 0 0 2px rgba(255, 255, 255, 0.4);
        }
        /* Matrix pixel shape variants */
        .pixel-shape-square .brightness-matrix-cell { border-radius: 0; }
        .pixel-shape-rounded .brightness-matrix-cell { border-radius: 3px; }
        .pixel-shape-round .brightness-matrix-cell { border-radius: 50%; }
        .brightness-matrix-value {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          min-width: 40px;
          text-align: right;
        }
        .brightness-value-right {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          min-width: 40px;
          text-align: right;
        }
        
        /* Rotary Style */
        .brightness-rotary-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .brightness-rotary-container {
          position: relative;
          width: 160px;
          height: 160px;
          padding: 10px;
          cursor: pointer;
          user-select: none;
        }
        /* Dimensional bowl behind the dial for depth */
        .brightness-rotary-container::before {
          content: "";
          position: absolute;
          inset: 16px;
          border-radius: 50%;
          background: radial-gradient(
            circle at 50% 36%,
            color-mix(in srgb, var(--card-background-color, #fff) 86%, #000) 0%,
            var(--card-background-color, #fff) 72%
          );
          box-shadow:
            inset 0 2px 7px rgba(0, 0, 0, 0.3),
            inset 0 -1px 3px rgba(255, 255, 255, 0.06),
            0 6px 16px rgba(0, 0, 0, 0.18);
          pointer-events: none;
        }
        .brightness-rotary-svg {
          position: relative;
          width: 100%;
          height: 100%;
          transform: rotate(135deg);
          pointer-events: none;
          overflow: visible;
        }
        .rotary-stripe-mask-circle {\n          fill: none;\n          stroke: white;\n          stroke-width: var(--rotary-stroke, 12);\n          stroke-linecap: round;\n        }\n        .rotary-bg {
          fill: none;
          stroke: var(--divider-color, rgba(0, 0, 0, 0.14));
          stroke-width: var(--rotary-stroke, 12);
          stroke-linecap: round;
          opacity: 0.55;
        }
        /* Rotary style variants */
        /* glow (default) — the warm gradient arc with neon drop shadow */
        .rotary-progress-glow {
          fill: none;
          stroke: url(#brightnessRotaryGrad);
          stroke-width: var(--rotary-stroke, 12);
          stroke-linecap: round;
          transition: stroke-dasharray 0.1s ease;
          filter: drop-shadow(0 0 3px rgba(255, 152, 0, 0.85))
            drop-shadow(0 0 8px rgba(255, 145, 0, 0.5));
        }
        /* gloss — same warm arc + bright highlight overlay on top half */
        .rotary-progress-gloss {
          fill: none;
          stroke: url(#brightnessRotaryGrad);
          stroke-width: var(--rotary-stroke, 12);
          stroke-linecap: round;
          transition: stroke-dasharray 0.1s ease;
        }
        .rotary-gloss-overlay {
          fill: none;
          stroke: url(#rotaryGlossGrad);
          stroke-width: var(--rotary-stroke, 12);
          stroke-linecap: round;
          transition: stroke-dasharray 0.1s ease;
          pointer-events: none;
        }
        /* thick — flat wide arc, no glow, with a rectangular pointer knob */
        .rotary-progress-thick {
          fill: none;
          stroke: #ff9800;
          stroke-width: calc(var(--rotary-stroke, 12) * 1.4);
          stroke-linecap: butt;
          transition: stroke-dasharray 0.1s ease;
          opacity: 0.9;
        }
        /* dial — clean flat arc like a thermostat, with a round circle knob at the tip */
        .rotary-progress-dial {
          fill: none;
          stroke: var(--primary-color, #1976d2);
          stroke-width: var(--rotary-stroke, 12);
          stroke-linecap: round;
          transition: stroke-dasharray 0.1s ease;
        }
        .rotary-style-dial .rotary-bg {
          opacity: 0.15;
        }
        .rotary-style-dial .brightness-rotary-container::before {
          background: none;
          box-shadow: none;
        }
        .rotary-style-dial .rotary-label {
          font-size: 14px;
          color: var(--secondary-text-color);
        }
        .rotary-style-dial .rotary-value {
          font-size: 28px;
          font-weight: 700;
          text-shadow: none;
        }
        .rotary-dial-knob {
          fill: var(--card-background-color, #fff);
          stroke: var(--primary-color, #1976d2);
          stroke-width: 3;
          filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.25));
          transition: cx 0.1s ease, cy 0.1s ease;
        }
        /* Step buttons below the rotary */
        /* ===== Step buttons inside brightness container ===== */
        .brightness-step-below {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 6px;
          padding-top: 2px;
        }
        /* Sides layout: outer flex row wrapping [btn] [container] [btn] */
        .brightness-sides-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .brightness-sides-row .brightness-slider-container {
          flex: 1;
          min-width: 0;
        }
        .rotary-step-side {
          flex: 0 0 auto;
        }
        .rotary-step-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 2px solid var(--divider-color, rgba(0,0,0,0.15));
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.12);
          transition: box-shadow 0.15s ease, transform 0.1s ease;
          user-select: none;
        }
        .rotary-step-btn:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          transform: scale(1.05);
        }
        .rotary-step-btn:active {
          transform: scale(0.95);
        }
        .rotary-style-thick .brightness-rotary-container::before {
          display: none; /* hide depth bowl for flat thick look */
        }
        /* Rectangular pointer knob for the thick rotary — an arm rotated to the
           arc tip; the knob sits at the outer radius pointing outward. */
        .rotary-knob-arm {
          position: absolute;
          inset: 0;
          transform: rotate(var(--knob-angle, 225deg));
          transition: transform 0.1s ease;
          pointer-events: none;
          z-index: 6;
        }
        .rotary-knob {
          position: absolute;
          top: 24px;
          left: 50%;
          transform: translate(-50%, -50%);
          width: calc(var(--rotary-stroke, 12) * 0.9px);
          height: calc(var(--rotary-stroke, 12) * 1.9px);
          min-width: 10px;
          min-height: 22px;
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          border: 2px solid var(--divider-color, #ccc);
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35);
        }
        /* ===== Capsule thick variant ===== */
        .capsule-variant-thick .capsule-track {
          height: calc(var(--capsule-thickness, 6px) * 4) !important;
          border-radius: 6px !important;
        }
        .capsule-variant-thick .capsule-thumb {
          width: calc(var(--capsule-thickness, 6px) * 3) !important;
          height: calc(var(--capsule-thickness, 6px) * 6.5) !important;
          border-radius: 5px !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.28) !important;
        }
        /* base class kept for backwards compat; per-variant classes override */
        .rotary-progress {
          fill: none;
          stroke: url(#brightnessRotaryGrad);
          stroke-width: var(--rotary-stroke, 12);
          stroke-linecap: round;
          transition: stroke-dasharray 0.1s ease;
          filter: drop-shadow(0 0 3px rgba(255, 152, 0, 0.85))
            drop-shadow(0 0 8px rgba(255, 145, 0, 0.5));
        }
        .rotary-center-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          pointer-events: none;
        }
        .rotary-label {
          font-size: 16px;
          font-weight: 500;
          color: var(--secondary-text-color);
          text-align: center;
        }
        .rotary-value {
          font-size: 24px;
          font-weight: bold;
          color: var(--primary-text-color);
          text-shadow: 0 0 10px rgba(255, 152, 0, 0.35);
        }
        .brightness-slider-rotary {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        
        /* Capsule/Pill Style — shared component */
        ${getCapsuleCSS()}
        .brightness-capsule-host {
          width: 100%;
        }
        .capsule-snap-ticks {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 1;
        }
        .capsule-snap-tick {
          position: absolute;
          top: 50%;
          width: 5px;
          height: 5px;
          transform: translate(-50%, -50%);
          background: var(--primary-text-color, #333);
          border-radius: 50%;
          opacity: 0.35;
        }
        .brightness-capsule-slot {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
        }
        .brightness-capsule-input {
          width: 52px;
          height: 26px;
          border: 1px solid var(--divider-color, rgba(128,128,128,0.3));
          border-radius: 5px;
          background: transparent;
          color: var(--primary-text-color, #333);
          font-size: 13px;
          font-weight: 700;
          text-align: center;
          box-sizing: border-box;
          padding: 0;
          -moz-appearance: textfield;
          outline: none;
        }
        .brightness-capsule-input::-webkit-outer-spin-button,
        .brightness-capsule-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .brightness-capsule-input[readonly] {
          cursor: default;
        }
        .capsule-value-under {
          display: flex;
          justify-content: center;
          padding: 8px 0;
        }
        
        /* ===== Brightness Background: removed — container is always transparent ===== */
        .brightness-slider-container.brightness-theme-flat,
        .brightness-slider-container.brightness-theme-subtle,
        .brightness-slider-container.brightness-theme-filled {
          background: transparent;
          padding: 10px 0;
          border: none;
          box-shadow: none;
        }

        /* ===== Slider Style themed variants ===== */
        .brightness-theme-flat .brightness-slider-variable {
          background: linear-gradient(to right, var(--brightness-color, #ff9800), var(--divider-color, #d0d0d0));
        }
        /* All themes: labels always use card text color (no inversion) */
        .brightness-theme-subtle .brightness-label,
        .brightness-theme-subtle .brightness-value-slider,
        .brightness-theme-subtle .brightness-value-right,
        .brightness-theme-filled .brightness-label,
        .brightness-theme-filled .brightness-value-slider,
        .brightness-theme-filled .brightness-value-right,
        .brightness-theme-flat .brightness-label {
          color: var(--primary-text-color);
        }

        /* ===== Bar Style themed variants ===== */
        .brightness-theme-subtle .brightness-bar-track {
          background: var(--divider-color, rgba(0, 0, 0, 0.08));
        }
        .brightness-theme-filled .brightness-bar-track {
          background: var(--primary-background-color, rgba(0, 0, 0, 0.3));
        }
        .brightness-theme-flat .brightness-bar-track {
          background: var(--divider-color, rgba(0, 0, 0, 0.06));
        }

        /* ===== Rotary Style themed variants ===== */
        .brightness-theme-subtle .rotary-bg {
          stroke: var(--divider-color, rgba(0, 0, 0, 0.1));
        }
        .brightness-theme-filled .rotary-bg {
          stroke: var(--primary-background-color, rgba(0, 0, 0, 0.3));
        }
        .brightness-theme-flat .rotary-bg {
          stroke: var(--divider-color, rgba(0, 0, 0, 0.08));
        }
        .brightness-theme-filled .rotary-label,
        .brightness-theme-subtle .rotary-label {
          color: var(--secondary-text-color);
        }
        .brightness-theme-filled .rotary-value,
        .brightness-theme-subtle .rotary-value {
          color: var(--primary-text-color);
        }

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
          margin-bottom: 16px;
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
          /* width: 100%; */
          /* padding: 12px; */
          display: flex;
          flex-direction: column;
          /* gap: 10px; */
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
          margin-bottom: 10px;
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
          max-height: 0;
          opacity: 0;
          margin-bottom: 0;
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
      </style>
    `;
  }

  disconnectedCallback() {
    // Clear all stored debounce/timeout timers
    clearTimeout(this._brightnessDebounceTimer);
    clearTimeout(this._realBrightnessDebounceTimer);
    clearTimeout(this._effectDebounceTimer);
    clearTimeout(this._renderDebounceTimer);
    clearTimeout(this._oscillationResetTimeout);
    clearTimeout(this._userBrightnessTimeout);
    clearTimeout(this._powerToggleSafetyTimer);

    // Stop the client-side animation loops if running.
    this._stopNativeAnimation();
    this._stopClockAnimation();

    this._brightnessDebounceTimer = null;
    this._realBrightnessDebounceTimer = null;
    this._effectDebounceTimer = null;
    this._renderDebounceTimer = null;
    this._oscillationResetTimeout = null;
    this._userBrightnessTimeout = null;
    this._powerToggleSafetyTimer = null;

    // Clean up document-level drag listeners if disconnected mid-drag
    if (this._dragCleanup) {
      document.removeEventListener("mousemove", this._dragCleanup.handleMove);
      document.removeEventListener("mouseup", this._dragCleanup.handleEnd);
      document.removeEventListener("touchmove", this._dragCleanup.handleMove);
      document.removeEventListener("touchend", this._dragCleanup.handleEnd);
      this._dragCleanup = null;
    }

    // Reset drag/interaction flags
    this._renderScheduled = false;
    this._isDragging = false;
    this._anySliderDragging = false;
    this._rotaryDragging = false;
    this._powerToggling = false;
  }

  getCardSize() {
    return 2;
  }
}

if (!customElements.get("yeelight-cube-lamp-preview-card")) {
  customElements.define(
    "yeelight-cube-lamp-preview-card",
    YeelightCubeLampPreviewCard,
  );
}

// Register for Lovelace "Add Card" UI
window.customCards = window.customCards || [];
if (
  !window.customCards.some((c) => c.type === "yeelight-cube-lamp-preview-card")
) {
  window.customCards.push({
    type: "yeelight-cube-lamp-preview-card",
    name: "Yeelight Preview Card",
    description: "Preview the Yeelight Cube Lite lamp matrix and settings.",
    preview: true,
  });
}
