// ============================================================================
//  Yeelight Cube Lite — Clock Card
// ============================================================================
//
// Select, configure and visualise the firmware clock: pick a clock style from
// an animated live-preview gallery, set the content (Time / Time & Date /
// Date), 12/24-hour and colon-blink format, and an optional colour override.
//
// Everything shared with the lamp-preview card (the clock renderer, mixer
// tables and glyph font) lives in ./clock-preview-utils.js so there is no
// duplication. All changes are applied through the clean `set_clock_style`
// action.

import { escapeHtml } from "./html-escape-utils.js";
import "./clock-preset-manager.js";
import {
  clockPresetLibrary,
  clockColorModeOptions,
  clockPresetKey,
  clockStylesWithPresets,
  visibleClockStyles,
  matchingClockPreset,
  clockStyleAction,
  clockPresetsByKind,
  clockColorPresetAction,
  matchingClockColorPreset,
} from "./clock-preset-utils.js";
import {
  closeColorPicker,
  openColorPicker,
  colorPickerStyles,
} from "./color-picker-utils.js";
import { callServiceOnTargetEntities } from "./service-call-utils.js";
import {
  renderGalleryDisplay,
  renderMatrixPreview,
  galleryDisplayStyles,
} from "./gallery-display-utils.js";
import { renderCarouselString, carouselStyles } from "./carousel-utils.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import {
  renderSliderGroup,
  createSliderHandlers,
  sliderControlStyles,
  sliderKeys,
  sliderConfigToGc,
} from "./slider-control-utils.js";
import {
  TEXT_SELECTOR_STYLES,
  PREVIEW_SELECTOR_STYLES,
  resolveSelectorShape,
  resolveSelectorButtonShape,
  selectorShapeToCarouselButtonShape,
  selectorSharedStyles,
} from "./selector-shared-styles.js";
import {
  paginationStyles,
  renderPagination,
  attachPaginationListeners,
} from "./pagination-utils.js";
import {
  CLOCK_MIXER_EFFECT_SPEED,
  CLOCK_COLOR_MODES,
  clockStyleColorModeState,
  clockStyleRespondsToCustomColor,
  clockStyleByName,
  getClockStyles,
  renderClockFrame,
  flipMatrixVertical,
} from "./clock-preview-utils.js";
import { previewBrightnessScale } from "./draw_card_const.js";
import {
  actionButtonStyles,
  renderActionButtonGroupHTML,
  renderActionButtonHTML,
  actionButtonGroupModel,
  bindActionButtonGroup,
} from "./action-button-utils.js";

const CONTENT_OPTIONS = [
  { value: "time", label: "Time", icon: "mdi:clock-outline" },
  { value: "time_date", label: "Time & Date", icon: "mdi:calendar-clock" },
  { value: "date", label: "Date", icon: "mdi:calendar" },
];

// How saved custom colours (and the trailing picker) present themselves.
export const COLOR_PRESET_STYLE_CHOICES = [
  { value: "label", label: "Swatch + name" },
  { value: "filled", label: "Filled" },
  { value: "name", label: "Name only" },
];

// Swatch shape for the "swatch + name" and "swatch only" preset styles.
export const COLOR_PRESET_SHAPE_CHOICES = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
];

function hexToRgb(hex) {
  const h = String(hex || "").replace(/^#/, "");
  if (h.length !== 6) return null;
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return "#ffee00";
  return (
    "#" +
    rgb
      .slice(0, 3)
      .map((v) =>
        Math.max(0, Math.min(255, v | 0))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// Decode the firmware's 0x01RRGGBB clock colour integer into [r, g, b].
function clockColorToRgb(intColor) {
  if (typeof intColor !== "number") return null;
  return [(intColor >> 16) & 0xff, (intColor >> 8) & 0xff, intColor & 0xff];
}

// Chips-selector swatch backgrounds, sampled once per style from a rendered
// frame's lit pixels (styles are static, so a module-level cache is safe).
const _swatchCache = new Map();
function styleSwatchBackground(style) {
  if (style.presetId) return `rgb(${style.color.join(",")})`;
  if (_swatchCache.has(style.name)) return _swatchCache.get(style.name);
  const frame = renderClockFrame(
    {
      clock_style_id: style.id,
      clock_style: style.name,
      clock_content: "time",
    },
    null,
    null,
    0.6,
  );
  const lit = frame.filter((p) => p[0] | p[1] | p[2]);
  let bg = "#444";
  if (lit.length) {
    const picks = [0, 0.33, 0.66, 0.99].map(
      (f) => lit[Math.floor(f * (lit.length - 1))],
    );
    const colors = [
      ...new Set(picks.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`)),
    ];
    bg =
      colors.length === 1
        ? colors[0]
        : `linear-gradient(90deg, ${colors.join(", ")})`;
  }
  _swatchCache.set(style.name, bg);
  return bg;
}

class YeelightCubeClockCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this.config = {};
    this._phaseAccum = 0;
    this._lastPhaseTs = null;
    this._rafId = null;
    this._lastPaint = 0;
    this._visible = new Set();
    this._io = null;
    this._stateSignature = null;
    this._carouselIndex = null;
    this._wheelController = null;
    this._wheelCenterIndex = 0;
    this._speedPreview = null;
    this._brightnessPreview = null;
    // Two independent sliders on one host (shared appearance config), wired
    // through the shared module with distinct namespaces so their handlers and
    // DOM don't collide.
    this._sliderKeys = sliderKeys("slider");
    Object.assign(
      this,
      createSliderHandlers({
        host: this,
        ns: "speed",
        getConfig: () => this._speedGc(),
        onCommit: (pct) => this._applySpeed(this._pctToRaw(pct)),
        onLive: (pct) => {
          this._speedPreview = this._pctToRaw(pct);
        },
      }),
    );
    Object.assign(
      this,
      createSliderHandlers({
        host: this,
        ns: "brightness",
        getConfig: () => this._brightnessGc(),
        onCommit: (pct) => this._applyBrightness(this._pctToBri(pct)),
        onLive: (pct) => {
          this._brightnessPreview = pct;
        },
      }),
    );
  }

  _pctToRaw(pct) {
    return Math.max(1, Math.min(255, Math.round(1 + ((pct - 1) * 254) / 99)));
  }

  _rawToPct(raw) {
    return Math.max(
      1,
      Math.min(
        100,
        Math.round(((Math.max(1, Math.min(255, raw)) - 1) / 254) * 100),
      ),
    );
  }

  // Brightness maps 1-100% ↔ HA 3-255 (same curve as the lamp-preview card).
  _pctToBri(pct) {
    return Math.max(3, Math.min(255, Math.round(3 + ((pct - 1) * 252) / 99)));
  }

  _briToPct(bri) {
    return Math.max(
      1,
      Math.min(
        100,
        Math.round(1 + ((Math.max(3, Math.min(255, bri)) - 3) * 99) / 252),
      ),
    );
  }

  // Both sliders share the appearance config (slider_*); only colour + icons
  // differ per slider.
  _speedGc() {
    return sliderConfigToGc(this.config, this._sliderKeys, {
      color: "#5aa9ff",
      unit: "%",
      iconLeft: this.config.slider_show_icon_left !== false ? "🐢" : null,
      iconRight: this.config.slider_show_icon_right !== false ? "⚡" : null,
    });
  }

  _brightnessGc() {
    return sliderConfigToGc(this.config, this._sliderKeys, {
      color: "#ffb74d",
      unit: "%",
      iconLeft: this.config.slider_show_icon_left !== false ? "🌙" : null,
      iconRight: this.config.slider_show_icon_right !== false ? "☀️" : null,
    });
  }

  setConfig(config) {
    const cfg = { ...config };
    // Migrate legacy per-speed slider appearance keys to the shared slider_*
    // keys now driving both the brightness and speed sliders.
    const K = sliderKeys("slider");
    const oldK = sliderKeys("speed");
    for (const f of Object.keys(K)) {
      if (cfg[K[f]] === undefined && cfg[oldK[f]] !== undefined) {
        cfg[K[f]] = cfg[oldK[f]];
      }
    }
    this.config = {
      title: "Clock",
      show_card_background: true,
      // Unified selector (same families as the gradient card):
      //   Text:    filled | dropdown | chips
      //   Preview: preview-list | preview-grid | preview-carousel | preview-wheel
      style_selector_style: "preview-grid",
      selector_shape: "rounded", // square | rounded | round
      preview_size: 55, // % -> px (same size axis as the gradient card)
      preview_show_titles: true,
      show_only_responding_styles: true,
      highlight_active_mode: true,
      wheel_nav_position: "bottom", // none | bottom | sides
      wheel_height: 300,
      gallery_wrap_navigation: false,
      // Clock-style preview appearance (mirrors the gradient card's gallery_*)
      gallery_background_color: "black", // black | white | transparent
      gallery_pixel_style: "square", // square | rounded | circle
      gallery_spacing_mode: "normal", // none | subtle | normal
      gallery_ignore_black_pixels: false,
      gallery_matrix_box_shadow: false,
      // Lamp Preview appearance (mirrors the lamp-preview card's matrix_*)
      show_current_preview: true,
      lamp_preview_size: 55,
      lamp_matrix_background: "black", // black | white | transparent
      lamp_pixel_style: "rounded", // square | rounded | circle
      lamp_spacing_mode: "normal", // none | subtle | normal
      lamp_ignore_black_pixels: false,
      lamp_matrix_box_shadow: false,
      show_content_toggle: true,
      show_format_toggles: true,
      show_color_modes: false,
      color_mode_selector: "buttons", // buttons | dropdown
      color_mode_shape: "rounded", // dropdown shape: square | rounded | round
      // Custom colour is now a colour mode; its picker style lives here.
      color_override_style: "swatch",
      // Sliders: brightness + animation speed share one appearance config
      // (slider_*); each can be shown/hidden independently.
      show_brightness: false,
      show_animation_speed: true,
      slider_style: "slider", // slider | bar | wheel | matrix | rotary | capsule
      slider_width: 100,
      slider_theme: "subtle",
      slider_thickness: 6,
      slider_variant: "thin",
      slider_show_icon_left: true, // 🐢 / 🌙 lower icon on the capsule
      slider_show_icon_right: true, // ⚡ / ☀️ upper icon on the capsule
      show_active_label: true,
      ...cfg,
    };
    // Custom colour moved from its own section into the colour-mode selector;
    // surface it for configs that only enabled the old override control.
    if (this.config.show_color_override) this.config.show_color_modes = true;
    delete this.config.show_color_override;
    // One save button split into per-kind toggles; keep old "hidden" intent.
    if (this.config.show_save_preset_button === false) {
      this.config.show_save_color_mode_button ??= false;
      this.config.show_save_clock_style_button ??= false;
    }
    delete this.config.show_save_preset_button;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._stateSignature = null;
    this._carouselIndex = null;
    this._browserSignature = null;
    this.render();
  }

  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-clock-card-editor")) {
      await import("./yeelight-cube-clock-card-editor.js");
    }
    return document.createElement("yeelight-cube-clock-card-editor");
  }

  static getStubConfig(hass) {
    const allEntities = Object.keys(hass?.states || {}).filter(
      (e) =>
        e.startsWith("light.yeelight_cube") || e.startsWith("light.cubelite_"),
    );
    return {
      // Default to controlling ALL Cube lamps (like the gradient card), so a
      // freshly-added card applies changes to every lamp until narrowed down.
      entity: allEntities[0] || "",
      target_entities: allEntities,
      title: "Clock",
      style_selector_style: "preview-grid",
    };
  }

  getCardSize() {
    const style = this._selectorStyle();
    if (style === "preview-list" || style === "preview-grid") return 8;
    if (style === "preview-wheel") return 5;
    if (style === "preview-carousel") return 4;
    return 4;
  }

  set hass(hass) {
    this._hass = hass;
    this._restoreCustomColor();
    if (this._presetManager) this._presetManager.hass = hass;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    // Once the lamp echoes the applied values, drop the live-drag overrides so
    // the previews follow the real values again.
    if (!this._anySliderDragging) {
      this._speedPreview = null;
      this._brightnessPreview = null;
    }
    // Only rebuild the DOM when a relevant attribute changes; the animation
    // loop repaints the previews in place so live updates stay cheap.
    const sig = this._computeStateSignature();
    if (sig !== this._stateSignature) {
      this._stateSignature = sig;
      this.render();
    }
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._startAnimation();
  }

  disconnectedCallback() {
    closeColorPicker(this);
    this._stopAnimation();
    if (this._wheelController) {
      this._wheelController.destroy();
      this._wheelController = null;
    }
    this._slSpeedDestroy?.();
    this._slBrightnessDestroy?.();
  }

  // ── Selector helpers (shared design language with the gradient card) ──────
  _selectorStyle() {
    const v = this.config.style_selector_style;
    if (TEXT_SELECTOR_STYLES.includes(v) || PREVIEW_SELECTOR_STYLES.includes(v))
      return v;
    return "preview-grid";
  }

  _isPreviewSelector() {
    return PREVIEW_SELECTOR_STYLES.includes(this._selectorStyle());
  }

  _displayMode() {
    const style = this._selectorStyle();
    if (style === "preview-wheel") return "wheel";
    if (style === "preview-carousel") return "carousel";
    if (style === "preview-strip") return "strip";
    return "list";
  }

  // 50% = 1.0× text scale, clamped like the gradient card.
  _selectorTextScale() {
    const pct = Number(this.config.preview_size) || 55;
    return Math.max(0.8, Math.min(1.4, pct / 50));
  }

  // ── Preview appearance helpers (shared semantics with the reference cards) ─
  _bgCss(name) {
    return name === "white"
      ? "#fff"
      : name === "transparent"
        ? "transparent"
        : "#000";
  }

  // Pixel gap in px for a spacing mode (only "normal" spaces the dots).
  _spacingGap(mode, size = 350) {
    return mode === "normal" ? Math.max(0, (size / 350) * 3) : 0;
  }

  // Per-pixel drop shadow for "subtle"/"normal" spacing (matches gradient card).
  _spacingShadow(mode) {
    return mode === "subtle" || mode === "normal";
  }

  // Ignore-black only applies on a non-black background (like the ref cards).
  _lampIgnoreBlack() {
    return (
      (this.config.lamp_matrix_background || "black") !== "black" &&
      this.config.lamp_ignore_black_pixels === true
    );
  }

  _galleryIgnoreBlack() {
    return (
      (this.config.gallery_background_color || "black") !== "black" &&
      this.config.gallery_ignore_black_pixels === true
    );
  }

  // ── State helpers ─────────────────────────────────────────────────────────
  _primaryEntity() {
    const list = this.config.target_entities;
    if (Array.isArray(list) && list.length) return list[0];
    return this.config.entity || "";
  }

  _stateObj() {
    const eid = this._primaryEntity();
    return eid ? this._hass?.states?.[eid] : null;
  }

  _attrs() {
    return this._stateObj()?.attributes || {};
  }

  _restoreCustomColor() {
    if (this._customMode !== undefined) return;
    const attrs = this._attrs();
    const rgb =
      this._currentColorMode(attrs) === "custom"
        ? clockColorToRgb(attrs.clock_color)
        : null;
    const preset =
      rgb && matchingClockColorPreset(clockPresetLibrary(this._hass), attrs);
    this._customDraft = preset ? null : rgb;
    this._customPresetColor = preset ? rgb : null;
  }

  _computeStateSignature() {
    const a = this._attrs();
    return [
      this._primaryEntity(),
      a.clock_style_id,
      a.clock_style,
      a.clock_content,
      a.clock_12_hour,
      a.clock_colon_blink,
      a.clock_color,
      a.clock_color_mode,
      a.native_effect_speed,
      a.native_effect_direction,
      a.extended_effects_enabled,
      a.content_mode,
      a.brightness,
      this._stateObj()?.state,
      JSON.stringify(clockPresetLibrary(this._hass)),
    ].join("|");
  }

  // Same size axis as the gradient card: % of a 450px reference preview.
  _previewSizePx() {
    const pct = Number(this.config.preview_size) || 55;
    return Math.round((pct / 100) * 450);
  }

  // Locate the "Font Characters" sensor and return the firmware "native" clock
  // font + its monospace metrics, so previews render with the SAME font the
  // lamp uses for the clock (not the matrix-mode font). Mirrors the lamp
  // preview card; cached per hass object.
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

  _styleList() {
    const a = this._attrs();
    const cache = this._styleListCache;
    if (
      cache &&
      cache.states === this._hass?.states &&
      cache.config === this.config
    )
      return cache.styles;
    // Experimental styles follow the entity's Experimental Features switch
    // exactly — no separate card-level override.
    const styles = clockStylesWithPresets(
      getClockStyles(!!a.extended_effects_enabled),
      clockPresetLibrary(this._hass),
    );
    const visible = visibleClockStyles(styles, this.config);
    this._styleListCache = {
      states: this._hass?.states,
      config: this.config,
      styles: visible,
    };
    return visible;
  }

  _shownStyles() {
    const styles = this._styleList();
    if (this.config.show_only_responding_styles === false) return styles;
    const a = this._attrs();
    const mode = this._currentColorMode(a);
    if (mode === "normal") return styles;
    if (mode === "custom")
      return styles.filter((style) => clockStyleRespondsToCustomColor(style));
    const override = clockColorToRgb(a.clock_color);
    return styles.filter(
      (style) => clockStyleColorModeState(style, mode, override) === "responds",
    );
  }

  // The colour-mode selector value: a firmware palette when one is active,
  // otherwise "custom" when a free custom RGB override is set, else "normal".
  _currentColorMode(a) {
    if (this._customMode) return "custom";
    const mode = a.clock_color_mode || "normal";
    if (mode !== "normal") return mode;
    const rgb = clockColorToRgb(a.clock_color);
    if (!rgb) return "normal";
    // The user explicitly entered Custom (even if the colour happens to match a
    // saved preset); honour that so Custom stays selectable.
    // A style we just saved/selected owns this colour until the HA library
    // echoes it back as a matchable preset; treat it as a style (Normal), not a
    // free override, so the selector doesn't flash "Custom" during that window.
    if (
      this._pendingStyleColor &&
      this._pendingStyleColor.every((channel, index) => channel === rgb[index])
    )
      return "normal";
    // A saved solid-colour clock style carries its colour on White; that is a
    // style choice (like Yellow/Mint), not a free override, so it stays Normal.
    if (this._activeStylePreset(a)) return "normal";
    return "custom";
  }

  // The saved clock-style preset the current lamp state matches, if any.
  _activeStylePreset(a) {
    return (
      matchingClockPreset(this._styleList(), a, this._selectedStylePresetId) ||
      matchingClockPreset(
        clockStylesWithPresets([], clockPresetLibrary(this._hass)),
        a,
        this._selectedStylePresetId,
      )
    );
  }

  // Selector options: Custom sits right after Normal, ahead of the palettes.
  _colorModeOptions() {
    return clockColorModeOptions(
      CLOCK_COLOR_MODES,
      clockPresetLibrary(this._hass),
      this.config,
    );
  }

  // Build the attrs object a preview needs, mixing the current format settings
  // with a specific style. Non-preset styles reflect an active custom override
  // so the whole gallery shows what picking each style would look like.
  _previewAttrs(style) {
    const a = this._attrs();
    const attrs = {
      clock_style_id: style.id,
      clock_style: style.name,
      clock_content: a.clock_content,
      clock_show_date: a.clock_show_date,
      clock_12_hour: a.clock_12_hour,
      clock_colon_blink: a.clock_colon_blink,
      clock_color_mode: a.clock_color_mode,
      native_effect_direction: a.native_effect_direction,
    };
    if (style.presetId) {
      // A preset previews its OWN saved colour, not the active override.
      attrs.clock_style = "White";
      attrs.clock_color_rgb = style.color;
      return attrs;
    }
    // renderClockFrame applies the override only to colour-supporting styles;
    // incompatible effects ignore it and solid styles show it flat. Only a free
    // custom colour propagates to the gallery — a selected style preset does not.
    const rgb =
      this._currentColorMode(a) === "custom"
        ? this._customDraft || this._customPresetColor
        : null;
    if (this._customMode) attrs.clock_color_mode = "normal";
    if (rgb) attrs.clock_color_rgb = rgb;
    return attrs;
  }

  _currentStyle() {
    const a = this._attrs();
    const preset = !this._customMode && this._activeStylePreset(a);
    if (preset) return preset;
    if (typeof a.clock_style === "string") {
      const s = clockStyleByName(a.clock_style);
      if (s) return s;
    }
    const list = getClockStyles(true);
    return list.find((s) => s.id === a.clock_style_id) || list[0];
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async _callSetClock(data) {
    return callServiceOnTargetEntities(
      this._hass,
      this.config,
      "set_clock_style",
      data,
      { callerTag: "Clock Card" },
    );
  }

  _applyStyle(name) {
    const style = this._styleList().find(
      (item) => clockPresetKey(item) === name,
    );
    if (!style) return;
    const keepCustom =
      this._currentColorMode(this._attrs()) === "custom" && !style.presetId;
    const action = clockStyleAction(style);
    // Leaving a style/preset for a plain built-in style drops any residual
    // colour override unless the user is genuinely in Custom mode (where the
    // override is meant to follow the style change).
    if (
      !style.presetId &&
      (!keepCustom || !(this._customDraft || this._customPresetColor))
    )
      action.color = "clear";
    this._revealSavedStyle = null;
    this._pendingStyleColor = null;
    this._selectedStylePresetId = style.presetId || null;
    this._customMode = keepCustom;
    this._lastSelfSelect = Date.now();
    this._callSetClock(action);
    this.render();
  }

  _applyContent(content) {
    this._callSetClock({ content });
  }

  _applyFormat(patch) {
    this._callSetClock(patch);
  }

  _applyColorMode(mode) {
    if (mode === "__pick__") {
      const anchor = this.shadowRoot.querySelector(
        ".color-add button, .colormode-select",
      );
      if (anchor) {
        if (anchor.tagName === "SELECT")
          anchor.value =
            [...anchor.options].find((option) => option.defaultSelected)
              ?.value || "";
        this._openCustomPicker(anchor);
      }
      return;
    }
    if (mode.startsWith("custom:")) {
      this._applyColorPreset(mode.slice(7));
      return;
    }
    // A colour attached to the CURRENT state only counts as "the custom
    // colour" while Custom mode is genuinely active; if it merely belongs to
    // an active style preset, entering Custom must not inherit it.
    const wasCustom = this._currentColorMode(this._attrs()) === "custom";
    const preserveStyle =
      !!(this._activeStylePreset(this._attrs()) || this._pendingStyleColor) &&
      (!wasCustom || !(this._customDraft || this._customPresetColor));
    this._revealSavedStyle = null;
    const currentColor = wasCustom ? this._customDraft : null;
    if (currentColor) this._lastCustomHex = rgbToHex(currentColor);
    // Track the user's explicit mode choice (Custom is inferred, not a backend
    // field, so a colour that matches a preset must not snap back to Normal).
    this._customMode = mode === "custom";
    this._pendingStyleColor = null;
    if (mode === "custom") {
      this._customDraft = currentColor || null;
      if (!wasCustom) this._customPresetColor = null;
    } else if (mode === "normal") {
      this._callSetClock({
        color_mode: "normal",
        ...(preserveStyle ? {} : { color: "clear" }),
      });
    } else {
      this._callSetClock({ color_mode: mode });
    }
    if (mode !== "custom") {
      this._customDraft = null;
      this._customPresetColor = null;
    }
    // The custom flag is local UI state; repaint now so the selector reflects
    // it even when the backend colour (and thus the state signature) is unchanged.
    this.render();
  }

  _applyColor(rgbOrClear) {
    this._customPresetColor = null;
    this._revealSavedStyle = null;
    this._customDraft = Array.isArray(rgbOrClear) ? [...rgbOrClear] : null;
    this._customMode = Array.isArray(rgbOrClear);
    this._selectedStylePresetId = null;
    this._pendingStyleColor = null;
    if (Array.isArray(rgbOrClear)) this._lastCustomHex = rgbToHex(rgbOrClear);
    this._callSetClock({ color_mode: "normal", color: rgbOrClear });
    this.render();
  }

  _applyColorPreset(id) {
    const preset = clockPresetsByKind(
      clockPresetLibrary(this._hass),
      "color_mode",
    ).find((item) => item.id === id);
    if (!preset) return;
    this._selectedColorPresetId = preset.id;
    this._selectedColorPresetName = null;
    this._customDraft = null;
    this._customPresetColor = [...preset.color];
    this._revealSavedStyle = null;
    this._customMode = true;
    this._selectedStylePresetId = null;
    this._pendingStyleColor = null;
    this._lastCustomHex = rgbToHex(preset.color);
    this._callSetClock(clockColorPresetAction(preset));
    this.render();
  }

  // Which save-as buttons the inline preset manager should offer under Custom.
  _saveKinds() {
    const kinds = [];
    if (this.config.show_save_color_mode_button !== false)
      kinds.push("color_mode");
    if (this.config.show_save_clock_style_button !== false) kinds.push("style");
    return kinds;
  }

  _applySpeed(value) {
    this._callSetClock({ speed: Math.max(1, Math.min(255, value | 0)) });
  }

  _applyBrightness(bri) {
    const brightness = Math.max(3, Math.min(255, bri | 0));
    const list = this.config.target_entities;
    const entities =
      Array.isArray(list) && list.length
        ? list
        : [this._primaryEntity()].filter(Boolean);
    if (!this._hass || !entities.length) return;
    this._hass
      .callService("light", "turn_on", { entity_id: entities, brightness })
      .catch(() => this.render());
  }

  // ── Preview-selector interaction (wheel / carousel / active marking) ──────
  _markActive() {
    const root = this.shadowRoot;
    if (!root) return;
    const highlight = this.config.highlight_active_mode !== false;
    // Host attribute drives the shared wheel-centered CSS.
    this.dataset.highlightActive = highlight ? "true" : "false";
    const currentName = clockPresetKey(this._currentStyle());
    const isCarousel =
      this._isPreviewSelector() && this._displayMode() === "carousel";
    root.querySelectorAll("[data-mode]").forEach((item) => {
      // Carousel: navigation IS selection; a ring on the only visible item
      // would just flash.
      if (isCarousel || !highlight || item.dataset.mode !== currentName) {
        item.removeAttribute("data-active-mode");
      } else {
        item.setAttribute("data-active-mode", "true");
      }
    });
  }

  _setupWheelNavigation() {
    if (this._wheelController) {
      this._wheelController.destroy();
      this._wheelController = null;
    }
    const showTitles = this.config.preview_show_titles !== false;
    const controller = initializeWheelNavigation({
      shadowRoot: this.shadowRoot,
      displayMode: "wheel",
      config: {
        ...this.config,
        wheel_display_style: showTitles ? "default" : "compact",
      },
      currentCenterIndex: this._wheelCenterIndex,
      immediate: true,
      onModeSelect: async (mode, index) => {
        this._wheelCenterIndex = index;
        this._applyStyle(mode);
      },
      getCurrentMode: () => clockPresetKey(this._currentStyle()),
    });
    const itemsInDom =
      this.shadowRoot?.querySelectorAll(
        '[data-wheel-item="true"], [data-wheel-compact-item="true"]',
      ).length || 0;
    if (!itemsInDom) {
      controller.destroy();
    } else {
      this._wheelController = controller;
      this._wheelCenterIndex = controller.getCenterIndex();
    }
  }

  // Carousel navigation IS selection (same mechanic as the gradient card).
  _carouselNavigate(direction) {
    const names = this._shownStyles().map(clockPresetKey);
    if (!names.length) return;
    if (this._carouselIndex == null) {
      const idx = names.indexOf(clockPresetKey(this._currentStyle()));
      this._carouselIndex = idx >= 0 ? idx : 0;
    }
    const wrap = this.config.gallery_wrap_navigation === true;
    let next = this._carouselIndex + direction;
    if (wrap) next = ((next % names.length) + names.length) % names.length;
    else next = Math.max(0, Math.min(next, names.length - 1));
    if (next === this._carouselIndex) return;
    this._carouselIndex = next;
    this.render();
    this._applyStyle(names[next]);
  }

  _carouselSetIndex(index) {
    const names = this._shownStyles().map(clockPresetKey);
    if (!names.length) return;
    const clamped = Math.max(0, Math.min(index, names.length - 1));
    if (clamped === this._carouselIndex) return;
    this._carouselIndex = clamped;
    this.render();
    this._applyStyle(names[clamped]);
  }

  // ── Animation ─────────────────────────────────────────────────────────────
  // A single rAF loop repaints ONLY the on-screen previews, in place (updating
  // each dot's background rather than rebuilding HTML), throttled to ~11 fps and
  // paused while the tab is hidden. This keeps a long gallery of animated
  // previews smooth instead of the jan*ky full-innerHTML rebuilds it replaced.
  _startAnimation() {
    if (this._rafId) return;
    const loop = (t) => {
      this._rafId = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (t - this._lastPaint < 90) return; // ~11 fps
      this._lastPaint = t;
      this._paintVisible();
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopAnimation() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._io) {
      this._io.disconnect();
      this._io = null;
    }
    this._visible = new Set();
  }

  // Current clock animation speed (1-255), read from the lamp so the preview
  // matches the rate the slider applies. While dragging, the live slider value
  // takes over so the preview responds immediately.
  _animationSpeed() {
    if (this._speedPreview != null) return this._speedPreview;
    const v = Number(this._attrs().native_effect_speed);
    return Math.max(1, Math.min(255, v || CLOCK_MIXER_EFFECT_SPEED));
  }

  // Accumulated phase (peek). Advanced once per paint tick by _advancePhase so
  // changing the speed re-scales future motion without a visual jump.
  _phase() {
    return this._phaseAccum;
  }

  _advancePhase() {
    const now = Date.now();
    if (this._lastPhaseTs == null) this._lastPhaseTs = now;
    const dt = (now - this._lastPhaseTs) / 1000;
    this._lastPhaseTs = now;
    this._phaseAccum += dt * (0.25 + this._animationSpeed() / 55.0);
  }

  // Track which preview tiles are actually on screen so the loop never wastes
  // work animating tiles scrolled out of view. Covers both the card's own
  // tiles (data-clock-preview) and the shared-renderer items ([data-mode]
  // inside the preview shell).
  _setupObserver() {
    if (this._io) this._io.disconnect();
    this._visible = new Set();
    const tiles = this.shadowRoot
      ? [
          ...this.shadowRoot.querySelectorAll("[data-clock-preview]"),
          ...this.shadowRoot.querySelectorAll(".gc-preview-shell [data-mode]"),
        ]
      : [];
    if (typeof IntersectionObserver === "undefined") {
      tiles.forEach((el) => this._visible.add(el));
      return;
    }
    this._io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this._visible.add(e.target);
          else this._visible.delete(e.target);
        }
      },
      { root: null, rootMargin: "120px", threshold: 0 },
    );
    tiles.forEach((el) => {
      if (el.hasAttribute("data-clock-preview")) this._visible.add(el);
      this._io.observe(el);
    });
  }

  _paintVisible() {
    if (!this._hass) return;
    this._advancePhase();
    const phase = this._phase();
    this._visible.forEach((el) => this._paintPreview(el, phase));
  }

  // Build a tile's dot grid exactly once, caching the cell nodes on the element.
  // Card-owned tiles (current preview) use the Lamp Preview
  // appearance settings.
  _ensureGrid(el) {
    if (el._cells) return el._cells;
    const cols = 20;
    const rows = 5;
    const pixelStyle = this.config.lamp_pixel_style || "rounded";
    const radius =
      pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0";
    const bg = this._bgCss(this.config.lamp_matrix_background || "black");
    const spacing = this.config.lamp_spacing_mode || "normal";
    const gap = this._spacingGap(spacing);
    const pad = Math.max(2, gap * 2);
    // Shadow is state-dependent (ignored-black pixels get none) — stored on the
    // element so _paintPreview keeps it in sync as pixels turn on/off.
    el._pixelShadow = this._spacingShadow(spacing) ? "0 0 2px #0008" : "";
    const matrixShadow =
      this.config.lamp_matrix_box_shadow === true
        ? "box-shadow:0 2px 8px rgba(0,0,0,0.5);"
        : "";
    el._ignoreBlack = this._lampIgnoreBlack();
    el.innerHTML = "";
    const grid = document.createElement("div");
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:${gap}px;background:${bg};padding:${pad}px;border-radius:4px;width:100%;box-sizing:border-box;${matrixShadow}`;
    const emptyBg = el._ignoreBlack ? "transparent" : "#000";
    // Empty cells: no shadow when ignore-black hides them (matches the shared
    // renderMatrixPreview rule), shadow otherwise (visible black pixel).
    const emptyShadow = el._ignoreBlack ? "" : el._pixelShadow;
    const cells = [];
    for (let i = 0; i < cols * rows; i++) {
      const d = document.createElement("div");
      d.style.cssText = `aspect-ratio:1/1;border-radius:${radius};background:${emptyBg};${emptyShadow ? `box-shadow:${emptyShadow};` : ""}`;
      grid.appendChild(d);
      cells.push(d);
    }
    el.appendChild(grid);
    el._cells = cells;
    return cells;
  }

  _paintPreview(el, phase) {
    let styleName;
    let isCurrent = false;
    let cells;
    if (el.hasAttribute("data-clock-preview")) {
      styleName = el.dataset.styleName;
      isCurrent = el.dataset.current === "1";
      cells = this._ensureGrid(el);
    } else {
      // Shared-renderer item: repaint the renderMatrixPreview cells in place.
      styleName = el.dataset.mode;
      cells = el._cells;
      if (!cells) {
        const matrix = el.querySelector(".gallery-matrix-preview");
        if (!matrix || matrix.children.length !== 100) return;
        cells = Array.from(matrix.children);
        el._cells = cells;
        el._ignoreBlack = this._galleryIgnoreBlack();
        el._pixelShadow = this._spacingShadow(
          this.config.gallery_spacing_mode || "normal",
        )
          ? "0 0 2px #0008"
          : "";
      }
    }
    const style =
      this._styleList().find((item) => clockPresetKey(item) === styleName) ||
      this._currentStyle();
    if (!style) return;
    const emptyBg = el._ignoreBlack ? "transparent" : "#000";
    const attrs = this._previewAttrs(style);
    const { fontMap, metrics } = this._getNativeClockFont();
    // renderClockFrame is bottom-origin (row 0 = physical bottom); the CSS grid
    // fills top→bottom, so flip vertically or the clock renders upside-down.
    const frame = flipMatrixVertical(
      renderClockFrame(attrs, fontMap, metrics, phase),
    );
    const brightnessRaw =
      this._brightnessPreview != null
        ? this._pctToBri(this._brightnessPreview)
        : Number(this._attrs().brightness) || 255;
    const brightnessScale = isCurrent
      ? previewBrightnessScale(brightnessRaw, this._attrs().preview_darken)
      : 1;
    for (let i = 0; i < cells.length; i++) {
      const source = frame[i] || [0, 0, 0];
      const p =
        brightnessScale === 1
          ? source
          : source.map((channel) => Math.round(channel * brightnessScale));
      const isOff = (p[0] | p[1] | p[2]) === 0;
      const bg = isOff ? emptyBg : `rgb(${p[0]},${p[1]},${p[2]})`;
      // The initial render bakes box-shadow only on lit pixels (shared
      // renderMatrixPreview rule); keep it in sync as pixels turn on/off or
      // ghost outlines linger where digits/colons used to be.
      const sh = isOff && el._ignoreBlack ? "" : el._pixelShadow || "";
      const cell = cells[i];
      if (cell._bg !== bg) {
        cell.style.background = bg;
        cell._bg = bg;
      }
      if (cell._sh !== sh) {
        cell.style.boxShadow = sh;
        cell._sh = sh;
      }
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (!this._hass) {
      this.shadowRoot.innerHTML = `<div class="loading">Loading…</div>`;
      return;
    }
    const entity = this._primaryEntity();
    if (!entity || !this._hass.states?.[entity]) {
      this.shadowRoot.innerHTML = `
        ${this._styles()}
        <ha-card class="clock-card"><div class="empty">
          Configure a Yeelight Cube Lite light entity in the card editor.
        </div></ha-card>`;
      return;
    }

    const a = this._attrs();
    const sel = this._selectorStyle();
    const browserSignature = JSON.stringify(
      this._shownStyles().map(clockPresetKey),
    );
    if (browserSignature !== this._browserSignature) {
      this._browserSignature = browserSignature;
      this._selectorPage = 0;
      this._carouselIndex = null;
      this._wheelCenterIndex = 0;
    }

    if (this._revealSavedStyle) {
      const preset = clockStylesWithPresets(
        [],
        clockPresetLibrary(this._hass),
      ).find((style) => style.name === this._revealSavedStyle);
      if (preset) {
        this._selectedStylePresetId = preset.presetId;
        this._pendingStyleColor = null;
        const shown = this._shownStyles();
        const idx = shown.findIndex(
          (s) => clockPresetKey(s) === clockPresetKey(preset),
        );
        if (idx >= 0) {
          const mode = this._isPreviewSelector() ? this._displayMode() : null;
          if (mode === "wheel") this._wheelCenterIndex = idx;
          else if (mode === "carousel") this._carouselIndex = idx;
          else {
            const perPage = parseInt(this.config.items_per_page) || 0;
            if (perPage > 0) this._selectorPage = Math.floor(idx / perPage);
          }
        }
        this._revealSavedStyle = null;
      }
    }

    const current = this._currentStyle();

    // Carousel follows EXTERNAL style changes (automations, select entity);
    // skipped briefly after a self-initiated selection so the state echo
    // doesn't bounce the index back.
    if (
      this._isPreviewSelector() &&
      this._displayMode() === "carousel" &&
      this._carouselIndex != null &&
      Date.now() - (this._lastSelfSelect || 0) > 5000
    ) {
      const names = this._shownStyles().map(clockPresetKey);
      const idx = names.indexOf(clockPresetKey(current));
      if (idx >= 0) this._carouselIndex = idx;
    }

    const sections = [];
    if (this.config.show_current_preview !== false) {
      sections.push(this._renderCurrentPreview(current));
    }
    if (
      this.config.show_brightness === true ||
      this.config.show_animation_speed !== false
    ) {
      sections.push(this._renderSliders(a));
    }
    // 12/24-hour and colon only affect the time, so hide them for date-only.
    const content =
      a.clock_content || (a.clock_show_date ? "time_date" : "time");
    // Content + Format share a row so they sit side by side when there's room.
    const inlineToggles = [];
    if (this.config.show_content_toggle !== false)
      inlineToggles.push(this._renderContentToggle(a));
    if (this.config.show_format_toggles !== false && content !== "date")
      inlineToggles.push(this._renderFormatToggles(a));
    if (inlineToggles.length)
      sections.push(
        inlineToggles.length > 1
          ? `<div class="section-row">${inlineToggles.join("")}</div>`
          : inlineToggles[0],
      );
    if (this.config.show_color_modes) {
      sections.push(this._renderColorMode(a));
    }
    sections.push(this._renderStyleSelector(sel, current));

    const showCard = this.config.show_card_background !== false;
    const title = this.config.title
      ? `<div class="card-title">${escapeHtml(this.config.title)}</div>`
      : "";
    const activeLabel =
      this.config.show_active_label !== false
        ? `<div class="active-label">${escapeHtml(current?.name || "")}</div>`
        : "";

    const inner = `${title}${activeLabel}${sections.join("")}`;
    const focusedButton = this.shadowRoot.activeElement;
    const focusedControl = focusedButton?.closest("[data-clock-control]")
      ?.dataset.clockControl;
    const focusedValue = focusedButton?.dataset.value;
    this.shadowRoot.innerHTML = `
      ${this._styles()}
      ${
        showCard
          ? `<ha-card class="clock-card">${inner}</ha-card>`
          : `<div class="clock-card no-bg">${inner}</div>`
      }`;

    this._attachHandlers();
    if (focusedControl && focusedValue) {
      const group = this.shadowRoot.querySelector(
        `[data-clock-control="${focusedControl}"] .shared-button-group`,
      );
      const button = [...(group?.querySelectorAll("button") || [])].find(
        (item) => item.dataset.value === focusedValue,
      );
      if (button && !button.disabled) {
        if (group.getAttribute("role") === "radiogroup") {
          group.querySelectorAll("button").forEach((item) => {
            item.tabIndex = item === button ? 0 : -1;
          });
        }
        button.focus({ preventScroll: true });
      }
    }
    this._markActive();
    if (this._isPreviewSelector() && this._displayMode() === "wheel") {
      this._setupWheelNavigation();
    }
    this._setupObserver();
    this._paintVisible();
  }

  _previewTile(style, { current = false, size } = {}) {
    const px = size || this._previewSizePx();
    return `<div class="clock-preview" data-clock-preview data-style-name="${escapeHtml(
      clockPresetKey(style),
    )}" data-current="${current ? "1" : "0"}" data-size="${px}"></div>`;
  }

  _renderCurrentPreview(current) {
    const pct = Number(this.config.lamp_preview_size) || 55;
    const maxW = Math.round(120 + (pct / 100) * 380);
    return `
      <div class="current-preview">
        <div class="current-preview-inner" style="max-width:${maxW}px;">
          ${this._previewTile(current, { current: true })}
        </div>
      </div>`;
  }

  _renderStyleSelector(sel, current) {
    const styles = this._shownStyles();
    const inner = !styles.length
      ? this._styleList().length
        ? '<div class="item-browser-empty">No styles respond to this colour mode.</div>'
        : '<div class="item-browser-empty">No visible styles configured.</div>'
      : TEXT_SELECTOR_STYLES.includes(sel)
        ? this._renderTextSelector(sel, current)
        : this._renderPreviewSelector(sel, current);
    return `
      <div class="section">
        <div class="section-title">Clock style</div>
        ${inner}
      </div>`;
  }

  // Text selector family — markup + classes identical to the gradient card.
  _renderTextSelector(sel, current) {
    const styles = this._shownStyles();
    const shape = resolveSelectorShape(this.config);
    const scale = this._selectorTextScale();
    const selAttrs = `data-shape="${shape}" style="--gc-sel-scale:${scale}; display: flex; flex-wrap: wrap; gap: 6px;"`;
    const active = clockPresetKey(current);

    if (sel === "dropdown") {
      return `
        <div class="gc-selector" data-shape="${shape}" style="--gc-sel-scale:${scale};">
          <select class="mode-select" data-mode-select="true">
            ${styles.some((style) => clockPresetKey(style) === active) ? "" : '<option value="" disabled selected>Current style outside this list</option>'}
            ${styles
              .map(
                (s) =>
                  `<option value="${escapeHtml(clockPresetKey(s))}" ${
                    active === clockPresetKey(s) ? "selected" : ""
                  }>${escapeHtml(s.name)}</option>`,
              )
              .join("")}
          </select>
        </div>`;
    }

    if (sel === "chips") {
      return `
        <div class="gc-selector" ${selAttrs}>
          ${styles
            .map(
              (s) => `
                <button class="mode-chip ${active === clockPresetKey(s) ? "active" : ""}"
                  data-mode="${escapeHtml(clockPresetKey(s))}" title="${escapeHtml(s.name)}">
              <span class="mode-chip-swatch" style="background:${styleSwatchBackground(s)}"></span>
              <span class="mode-chip-label">${escapeHtml(s.name)}</span>
            </button>`,
            )
            .join("")}
        </div>`;
    }

    // "filled" (default text style)
    return `
      <div class="gc-selector" ${selAttrs}>
        ${styles
          .map(
            (s) => `
            <button class="mode-btn-filled ${active === clockPresetKey(s) ? "active" : ""}"
              data-mode="${escapeHtml(clockPresetKey(s))}" title="${escapeHtml(s.name)}">
            ${escapeHtml(s.name)}
          </button>`,
          )
          .join("")}
      </div>`;
  }

  // Build the shared-renderer item list: one animated clock frame per style.
  _previewItems() {
    const phase = this._phase();
    const { fontMap, metrics } = this._getNativeClockFont();
    return this._shownStyles().map((s) => ({
      title: s.name,
      name: s.name,
      colorData: flipMatrixVertical(
        renderClockFrame(this._previewAttrs(s), fontMap, metrics, phase),
      ),
      dataMode: clockPresetKey(s),
      metadata: null,
    }));
  }

  // Preview selector family — rendered through the SAME shared utilities as
  // the gradient card (gallery-display-utils / carousel-utils) so the look is
  // identical across cards.
  _renderPreviewSelector(sel, current) {
    const items = this._previewItems();
    if (!items.length) return "";

    const shape = resolveSelectorShape(this.config);
    const shellAttrs = `data-shape="${shape}"${
      sel === "preview-grid" ? ' data-columns="2"' : ""
    }`;
    const previewSize = this._previewSizePx();
    const effectivePreviewSize =
      sel === "preview-grid"
        ? Math.round(previewSize * 0.5)
        : sel === "preview-strip"
          ? Math.round(previewSize * 0.4)
          : previewSize;
    const pixelStyle = this.config.gallery_pixel_style || "square";
    const bgName = this.config.gallery_background_color || "black";
    // The shared renderers colour titles white only when the bg is exactly
    // "#000000"; pass that (not "black") so titles stay readable on a black bg.
    const rendererBg = bgName === "black" ? "#000000" : bgName;
    const showTitles = this.config.preview_show_titles !== false;
    const spacing = this.config.gallery_spacing_mode || "normal";
    const pixelGap = this._spacingGap(spacing, previewSize);
    const pixelBoxShadow = this._spacingShadow(spacing);
    const matrixBoxShadow = this.config.gallery_matrix_box_shadow === true;
    const ignoreBlackPixels = this._galleryIgnoreBlack();
    const displayMode = this._displayMode();

    if (displayMode === "carousel") {
      if (this._carouselIndex == null) {
        const idx = items.findIndex(
          (it) => it.dataMode === clockPresetKey(current),
        );
        this._carouselIndex = idx >= 0 ? idx : 0;
      }
      this._carouselIndex = Math.max(
        0,
        Math.min(this._carouselIndex, items.length - 1),
      );
      return `
        <div class="gc-preview-shell" ${shellAttrs} style="margin-top:12px;border-radius:8px;">
          ${renderCarouselString({
            items,
            currentIndex: this._carouselIndex,
            buttonShape: selectorShapeToCarouselButtonShape(
              resolveSelectorButtonShape(this.config),
            ),
            showAsCard: true,
            carouselId: "cc-clock-carousel",
            wrapNavigation: this.config.gallery_wrap_navigation === true,
            renderItemString: (it) => `
              <div class="gallery-item cc-carousel-item" data-mode="${escapeHtml(it.dataMode)}"
                   data-action="select-mode"
                   style="cursor:pointer;display:flex;flex-direction:column;align-items:center;
                          gap:6px;padding:10px;border-radius:8px;background:${bgName === "transparent" ? "transparent" : rendererBg};
                          max-width:100%;box-sizing:border-box;transition:all 0.2s ease;">
                <div style="width:100%;max-width:${previewSize}px;">
                  ${renderMatrixPreview(it.colorData, {
                    rows: 5,
                    cols: 20,
                    bgColor: rendererBg,
                    pixelStyle,
                    pixelGap,
                    previewSize,
                    ignoreBlackPixels,
                    matrixBoxShadow,
                    pixelBoxShadow,
                    forceAspectRatio: true,
                  })}
                </div>
                ${showTitles ? `<div style="font-size:13px;font-weight:500;${bgName === "black" ? "color:#fff;" : "color:var(--primary-text-color);"}">${escapeHtml(it.title)}</div>` : ""}
              </div>`,
          })}
        </div>`;
    }

    // List / grid modes: optional pagination via the shared utility (same
    // config key + controls as the palette and draw cards).
    let pagedItems = items;
    let paginationHtml = "";
    const itemsPerPage = parseInt(this.config.items_per_page) || 0;
    if (displayMode === "list" && itemsPerPage > 0) {
      const result = renderPagination({
        items,
        currentPage: this._selectorPage || 0,
        itemsPerPage,
      });
      pagedItems = result.items;
      paginationHtml = result.html;
      this._selectorPage = result.currentPage;
    }

    const galleryHtml = renderGalleryDisplay(pagedItems, displayMode, {
      rows: 5,
      cols: 20,
      bgColor: rendererBg,
      pixelStyle,
      pixelGap,
      previewSize: effectivePreviewSize,
      ignoreBlackPixels,
      showCards: displayMode === "wheel" || displayMode === "strip",
      showTitles,
      onClickEnabled: true,
      matrixBoxShadow,
      pixelBoxShadow,
      wheelNavPosition: this.config.wheel_nav_position || "bottom",
      wheelHeight: this.config.wheel_height || 300,
      wheelDisplayStyle: showTitles ? "default" : "compact",
      navButtonShape: resolveSelectorButtonShape(this.config),
      currentMode: null, // highlight applied afterwards as DOM attributes
      highlightActive: this.config.highlight_active_mode !== false,
    });

    return `
      <div class="gc-preview-shell" ${shellAttrs} style="margin-top: 12px; border-radius: 8px;">
        ${galleryHtml}
        ${paginationHtml}
      </div>`;
  }

  _controlGroup(options) {
    return renderActionButtonGroupHTML({
      buttonStyle: this.config.buttons_style || "modern",
      contentMode: this.config.buttons_content_mode || "icon_text",
      ...options,
    });
  }

  _renderContentToggle(a) {
    const cur = a.clock_content || (a.clock_show_date ? "time_date" : "time");
    return `
      <div class="section">
        <div class="section-title">Content</div>
        <div data-clock-control="content">${this._controlGroup({ label: "Content", items: CONTENT_OPTIONS, value: cur })}</div>
      </div>`;
  }

  _renderFormatToggles(a) {
    const twelve = !!a.clock_12_hour;
    const blink = !!a.clock_colon_blink;
    return `
      <div class="section" style="--ctl-accent: color-mix(in srgb, var(--primary-color, #1976d2) 58%, #12a594);">
        <div class="section-title">Format</div>
        <div data-clock-control="format" style="--primary-color: var(--ctl-accent); --primary-color-dark: color-mix(in srgb, var(--ctl-accent) 74%, #000);">${this._controlGroup(
          {
            label: "Format",
            multiple: true,
            items: [
              {
                value: "twelve",
                label: "12-hour",
                icon: "mdi:hours-12",
                selected: twelve,
                states: {
                  on: {
                    label: "12-hour",
                    icon: "mdi:hours-12",
                    title: "12-hour. Switch to 24-hour",
                  },
                  off: {
                    label: "24-hour",
                    icon: "mdi:hours-24",
                    title: "24-hour. Switch to 12-hour",
                  },
                },
              },
              {
                value: "colon",
                label: "Colon blinks",
                icon: "mdi:animation-outline",
                selected: blink,
                states: {
                  on: {
                    label: "Colon blinks",
                    icon: "mdi:animation-play-outline",
                    title: "Colon blinks. Switch to steady",
                  },
                  off: {
                    label: "Colon steady",
                    icon: "mdi:pause-circle-outline",
                    title: "Colon steady. Enable blinking",
                  },
                },
              },
            ],
          },
        )}</div>
      </div>`;
  }

  _renderColorMode(a) {
    const mode = this._currentColorMode(a);
    const options = this._colorModeOptions();
    const matches =
      mode === "custom" && !this._customDraft
        ? options.filter((option) =>
            option.color?.every(
              (channel, index) => channel === this._customPresetColor?.[index],
            ),
          )
        : [];
    const saved =
      matches.find(
        (option) => option.value === `custom:${this._selectedColorPresetId}`,
      ) ||
      matches.find(
        (option) => option.label === this._selectedColorPresetName,
      ) ||
      matches[0];
    const cur = mode === "custom" ? saved?.value : mode;
    const shape = ["square", "round"].includes(this.config.color_mode_shape)
      ? this.config.color_mode_shape
      : "rounded";
    const draft = this._customMode && this._customDraft;
    const picker = renderActionButtonHTML({
      buttonStyle: this.config.buttons_style || "modern",
      action: "tool",
      value: "__pick__",
      icon: "mdi:plus",
      label: draft ? "Change" : "Add",
      title: draft ? "Change unsaved colour" : "Add a colour",
      contentMode: "icon_text",
      selected: !!draft,
      swatch: draft ? rgbToHex(draft) : undefined,
      swatchShape: this._colorPresetShape(),
    });
    const inner =
      this.config.color_mode_selector === "dropdown"
        ? `<div class="gc-selector" data-shape="${shape}">
            <select class="mode-select colormode-select" aria-label="Colour mode">
              ${options.some((option) => option.value === cur) ? "" : `<option value="" disabled selected>${draft ? "Unsaved colour" : "Current mode hidden"}</option>`}
              ${options
                .map(
                  (mode) =>
                    `<option value="${escapeHtml(mode.value)}" ${
                      cur === mode.value ? "selected" : ""
                    }>${escapeHtml(mode.label)}</option>`,
                )
                .join("")}
            </select>
          </div>`
        : `<div class="shared-button-group action-row" role="radiogroup" aria-label="Colour mode">${actionButtonGroupModel(
            {
              buttonStyle: this.config.buttons_style || "modern",
              contentMode: this.config.buttons_content_mode || "icon_text",
              items: options.map((option) =>
                option.color
                  ? this._colorChoiceProps(
                      this._colorPresetStyle(),
                      this._colorPresetShape(),
                      {
                        value: option.value,
                        label: option.label,
                        title: option.label,
                        color: rgbToHex(option.color),
                      },
                    )
                  : option,
              ),
              value: cur,
            },
          )
            .map((option) =>
              option.value === "__pick__"
                ? `<span class="color-add">${picker}</span>`
                : renderActionButtonHTML(option),
            )
            .join("")}</div>`;
    return `
      <div class="section" style="--ctl-accent: color-mix(in srgb, var(--primary-color, #1976d2) 58%, #7c5cbf);">
        <div class="section-title">Colour mode</div>
        <div data-clock-control="colormode" class="colormode-buttons unified-color-modes">${inner}</div>
        ${draft ? this._renderCustomColorControls(a) : ""}
      </div>`;
  }

  // Colour choices (saved colours + a trailing picker) for the Custom mode.
  // Everything rides on the shared button group so it stays aligned with the
  // rest of the card; the save buttons are filled in via _attachHandlers.
  _renderCustomColorControls(a) {
    return `
      <div class="clock-color-control" style="margin-top:10px; --primary-color: var(--ctl-accent); --primary-color-dark: color-mix(in srgb, var(--ctl-accent) 74%, #000);">
        ${this._customDraft && this._saveKinds().length ? `<div class="clock-color-save" data-preset-save></div>` : ""}
      </div>`;
  }

  _colorPresetStyle() {
    const value = this.config.color_preset_style;
    if (value === "swatch") return "filled";
    return ["label", "filled", "name"].includes(value) ? value : "label";
  }

  _colorPresetShape() {
    const value = this.config.color_preset_shape;
    return ["square", "rounded", "circle"].includes(value) ? value : "rounded";
  }

  // Map a colour choice to shared-button options for the active preset style.
  // `action: "tool"` keeps the neutral look (not the blue "save" styling).
  _colorChoiceProps(presetStyle, shape, { color, picker, replace, ...base }) {
    const opts = { ...base, action: "tool" };
    // Neutral "add" affordance (no colour yet). Chip styles keep it icon-only
    // so it matches the fixed-size saved chips beside it.
    if (picker && !color)
      return presetStyle === "label"
        ? { ...opts, contentMode: "icon_text", icon: "mdi:plus" }
        : { ...opts, contentMode: "icon", icon: "mdi:plus" };
    // A picked-but-unsaved colour: reflect it and hint that it will be replaced.
    if (replace) {
      if (presetStyle === "label")
        return {
          ...opts,
          contentMode: "icon_text",
          swatch: color,
          swatchShape: shape,
        };
      return {
        ...opts,
        contentMode: "icon",
        icon: "mdi:eyedropper-variant",
        fill: color,
      };
    }
    // Saved colours.
    if (presetStyle === "filled")
      return { ...opts, contentMode: "text", label: "", icon: "", fill: color };
    if (presetStyle === "name")
      return { ...opts, contentMode: "text", icon: "" };
    return {
      ...opts,
      contentMode: "icon_text",
      swatch: color,
      swatchShape: shape,
    };
  }

  _renderColorChoices(a, presets, selected, isSaved = !!selected) {
    const presetStyle = this._colorPresetStyle();
    const shape = this._colorPresetShape();
    const buttonStyle = this.config.buttons_style || "modern";
    const currentHex = this._customDraft
      ? rgbToHex(this._customDraft)
      : "#ffee00";
    const choice = (props) =>
      renderActionButtonHTML({
        buttonStyle,
        ...this._colorChoiceProps(presetStyle, shape, props),
      });
    const saved = presets
      .map((preset) =>
        choice({
          role: "radio",
          value: preset.id,
          label: preset.name,
          title: preset.name,
          color: rgbToHex(preset.color),
          selected: selected?.id === preset.id,
        }),
      )
      .join("");
    // A saved colour (as a colour-mode chip or a clock-style preset) means the
    // picker just adds a new one; an unsaved colour reflects and offers replace.
    const picker = isSaved
      ? choice({
          value: "__pick__",
          label: "Add",
          title: "Pick a new custom colour",
          picker: true,
        })
      : choice({
          value: "__pick__",
          label: "Change",
          title: "Replace the custom colour",
          color: currentHex,
          picker: true,
          replace: true,
        });
    return `<div data-clock-control="colorpreset" class="clock-color-presets">
        <div class="shared-button-group action-row clock-color-choices cc-${presetStyle} cc-shape-${shape}" role="group" aria-label="Custom colour">${saved}${picker}</div>
      </div>`;
  }

  _renderSliders(a) {
    const showBrightness = this.config.show_brightness === true;
    const showSpeed = this.config.show_animation_speed !== false;
    if (!showBrightness && !showSpeed) return "";

    const controls = [];
    if (showBrightness) {
      const briRaw =
        this._brightnessPreview != null
          ? this._pctToBri(this._brightnessPreview)
          : Number(this._attrs().brightness) || 3;
      const briPct =
        this._brightnessPreview != null
          ? this._brightnessPreview
          : this._briToPct(briRaw);
      controls.push({
        label: "Brightness",
        gc: this._brightnessGc(),
        value: briPct,
        ns: "brightness",
      });
    }
    if (showSpeed) {
      const raw = Math.max(
        1,
        Math.min(255, Number(a.native_effect_speed) || 50),
      );
      controls.push({
        label: "Animation speed",
        gc: this._speedGc(),
        value: this._rawToPct(raw),
        ns: "speed",
      });
    }
    return `
      <div class="section">
        <div class="section-title">Sliders</div>
        ${renderSliderGroup(controls)}
      </div>`;
  }

  _onPresetSaved({ kind, name, color }) {
    this._customDraft = null;
    if (kind === "color_mode") {
      this._selectedColorPresetId = null;
      this._selectedColorPresetName = name;
      this._customPresetColor = [...color];
      this._customMode = true;
      this._callSetClock(clockColorPresetAction({ color }));
      this.render();
      return;
    }
    if (kind !== "style" || !name || !Array.isArray(color)) return;
    this._customPresetColor = null;
    this._customMode = false;
    this._lastSelfSelect = Date.now();
    this._revealSavedStyle = name;
    // That colour is now owned by the new style, not the freeform Custom
    // slot — forget it so the next Custom pick doesn't reuse it, and mark it
    // pending so the mode reads Normal until the library echoes the preset.
    this._lastCustomHex = null;
    this._pendingStyleColor = [...color];
    this._callSetClock({
      style: "White",
      color_mode: "normal",
      color,
      activate: true,
    });
    this.render();
  }

  _attachHandlers() {
    const root = this.shadowRoot;
    if (!root) return;
    const presetSlot = root.querySelector("[data-preset-save]");
    const saveKinds = this._saveKinds();
    if (presetSlot && saveKinds.length) {
      if (!this._presetManager) {
        this._presetManager = document.createElement(
          "yeelight-clock-preset-manager",
        );
        this._presetManager.addEventListener("clock-preset-saved", (event) => {
          this._onPresetSaved(event.detail || {});
        });
      }
      this._presetManager.hass = this._hass;
      this._presetManager.compact = true;
      this._presetManager.saveKinds = saveKinds;
      this._presetManager.previewAttrs = this._previewAttrs(
        this._currentStyle(),
      );
      this._presetManager.buttonStyle = this.config.buttons_style || "modern";
      this._presetManager.contentMode =
        this.config.buttons_content_mode || "icon_text";
      const rgb = this._customDraft;
      this._presetManager.initialColor = rgb ? rgbToHex(rgb) : "#ffee00";
      presetSlot.append(this._presetManager);
    }

    // Text selectors: filled buttons + chips share the data-mode contract
    root
      .querySelectorAll(".mode-btn-filled[data-mode], .mode-chip[data-mode]")
      .forEach((btn) => {
        btn.addEventListener("click", () => this._applyStyle(btn.dataset.mode));
      });
    const dropdown = root.querySelector(".mode-select:not(.colormode-select)");
    if (dropdown) {
      dropdown.addEventListener("change", (e) =>
        this._applyStyle(e.target.value),
      );
    }
    const colorModeDropdown = root.querySelector(".colormode-select");
    if (colorModeDropdown) {
      colorModeDropdown.addEventListener("change", (e) =>
        this._applyColorMode(e.target.value),
      );
    }

    // Preview selectors
    if (this._isPreviewSelector()) {
      const displayMode = this._displayMode();
      if (displayMode === "carousel") {
        root.querySelectorAll('[data-action="navigate"]').forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            this._carouselNavigate(parseInt(btn.dataset.direction, 10) || 1);
          });
        });
        root.querySelectorAll('[data-action="set-index"]').forEach((dot) => {
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            this._carouselSetIndex(parseInt(dot.dataset.index, 10) || 0);
          });
        });
        // Swipe gesture on the shell
        const shell = root.querySelector(".gc-preview-shell");
        if (shell) {
          let tx = 0;
          shell.addEventListener(
            "touchstart",
            (e) => {
              tx = e.touches[0].clientX;
            },
            { passive: true },
          );
          shell.addEventListener(
            "touchend",
            (e) => {
              const dx = e.changedTouches[0].clientX - tx;
              if (Math.abs(dx) > 40) this._carouselNavigate(dx < 0 ? 1 : -1);
            },
            { passive: true },
          );
        }
      } else if (displayMode !== "wheel") {
        // list / grid: click a preview item to apply (wheel wires its own
        // selection through the shared controller)
        root
          .querySelectorAll(".gc-preview-shell .gallery-item[data-mode]")
          .forEach((item) => {
            item.addEventListener("click", () =>
              this._applyStyle(item.dataset.mode),
            );
          });
        // Pagination controls (shadowRoot is rebuilt each render, so this
        // never double-binds).
        const shell = root.querySelector(".gc-preview-shell");
        if (shell) {
          attachPaginationListeners(shell, (pageOrAction) => {
            const cur = this._selectorPage || 0;
            this._selectorPage =
              pageOrAction === "prev"
                ? Math.max(0, cur - 1)
                : pageOrAction === "next"
                  ? cur + 1
                  : pageOrAction;
            this.render();
          });
        }
      }
    }

    bindActionButtonGroup(
      root.querySelector('[data-clock-control="content"] .shared-button-group'),
      (value) => this._applyContent(value),
    );
    bindActionButtonGroup(
      root.querySelector('[data-clock-control="format"] .shared-button-group'),
      (value) => {
        const a = this._attrs();
        this._applyFormat(
          value === "twelve"
            ? { twelve_hour: !a.clock_12_hour }
            : { colon_blink: !a.clock_colon_blink },
        );
      },
    );
    bindActionButtonGroup(
      root.querySelector(
        '[data-clock-control="colormode"] .shared-button-group',
      ),
      (value) => this._applyColorMode(value),
    );
  }

  // The trailing "+" choice opens the native picker; changes apply live.
  _openCustomPicker(anchor) {
    const rgb = this._customDraft;
    const view = this.ownerDocument.defaultView;
    const bounds = anchor.getBoundingClientRect();
    const apply = (hex) => {
      const value = hexToRgb(hex);
      if (value) this._applyColor(value);
    };
    openColorPicker(this, {
      value: rgb ? rgbToHex(rgb) : "#ffee00",
      pageX: bounds.left + view.scrollX,
      pageY: bounds.bottom + view.scrollY,
      onInput: apply,
      onChange: apply,
    });
  }

  _styles() {
    return `<style>
      :host { display: block; --action-row-icon-align: flex-start; }
      .loading, .empty { padding: 16px; color: var(--secondary-text-color, #888); }
      /* ha-card supplies the native background, border and radius when
         "Show Card Background" is on; the plain .no-bg variant drops them. */
      ha-card.clock-card { padding: 14px; }
      .clock-card.no-bg {
        background: transparent;
        box-shadow: none;
        border: none;
        padding: 8px 0;
      }
      .card-title { font-size: 1.15em; font-weight: 600; margin-bottom: 2px; }
      .active-label { font-size: 0.9em; color: var(--secondary-text-color, #9aa); margin-bottom: 10px; }
      .section { margin-top: 14px; }
      .unified-color-modes { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      [data-clock-control="colormode"].unified-color-modes > .shared-button-group.action-row { display:contents; }
      .unified-color-modes button { flex:0 0 auto; max-width:100%; min-height:36px; }
      .unified-color-modes .btn-text { white-space:normal; overflow-wrap:anywhere; }
      .unified-color-modes .color-add { display:inline-flex; }
      .unified-color-modes .color-add button:not(.btn-style-modern):not(.btn-style-gradient) { border:1px dashed var(--primary-color,#1976d2); }
      .unified-color-modes > .gc-selector { flex:1 1 180px; min-width:0; }
      /* Two titled sections (Content + Format) sit side by side when the card is
         wide enough, and wrap to their own rows otherwise. */
      .section-row { display: flex; flex-wrap: wrap; column-gap: 18px; }
      .section-row > .section { flex: 1 1 auto; min-width: 0; }
      .section-title { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color, #9aa); margin-bottom: 6px; }

      .current-preview { display: flex; justify-content: center; padding: 6px 0 2px; }
      .current-preview-inner { width: 100%; }
      .clock-preview { width: 100%; }

      ${actionButtonStyles}
      ${colorPickerStyles}
      .clock-color-control { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;     justify-content: space-between;}
      /* Saved colours + the trailing picker share one button group; the save
         buttons sit next to them when there's room and wrap below otherwise. */
      .clock-color-presets { flex: 0 1 auto; min-width: 0; }
      .clock-color-choices { flex-wrap: wrap; }
      /* Filled style: fixed square chips so empty (name-less) colours match the
         add/replace button beside them. max-width overrides the shared group's
         fit-content cap, which would otherwise collapse the empty chips. */
      .clock-color-choices.cc-filled .shared-action-button {
        flex: 0 0 auto; width: 44px; max-width: 44px; height: 44px; min-height: 0; padding: 0;
      }
      /* Swatch-only style: fixed-size colour chips whose shape is configurable. */
      .clock-color-choices.cc-swatch .shared-action-button {
        flex: 0 0 44px; width: 44px; max-width: 44px; height: 44px; min-height: 0; padding: 0;
        overflow: visible; border-radius: 12px;
      }
      .clock-color-choices.cc-swatch.cc-shape-square .shared-action-button { border-radius: 4px; }
      .clock-color-choices.cc-swatch.cc-shape-circle .shared-action-button { border-radius: 50%; }
      /* The picker's dashed "add" border only suits the outline button style. */
      .clock-color-choices button[data-value="__pick__"].btn-style-outline {
        border-style: dashed;
      }
      /* Saving is a distinct action, so the save buttons take a different hue
         and sit together on their own row. */
      .clock-color-save {
        flex: 0 1 auto; min-width: 0;
        --primary-color: var(--clock-save-accent, #2e8b57);
        --primary-color-dark: color-mix(in srgb, var(--clock-save-accent, #2e8b57) 72%, #000);
      }
      .clock-color-save:empty { display: none; }
      .clock-color-save yeelight-clock-preset-manager { display: block; min-width: 0; }
      /* While the save form is open, hide the choice row and give the form the
         full width so its fields are comfortable. */
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-presets { display: none; }
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-save { flex: 1 1 100%; }
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-save yeelight-clock-preset-manager { width: 100%; }

      /* Shared design language: text selectors + shape/size axes */
      ${selectorSharedStyles}
      ${paginationStyles}
      /* Shared preview renderers (gallery list/grid/wheel + carousel) */
      ${galleryDisplayStyles}
      ${carouselStyles}
      /* Shared multi-style value slider (same control as brightness) */
      ${sliderControlStyles}

      [data-clock-control="colormode"] .shared-button-group.action-row {
        flex-wrap: wrap;
      }
      [data-clock-control="colormode"].unified-color-modes .shared-action-button {
        flex:0 0 auto;
        width:auto;
        max-width:100%;
      }
      [data-clock-control="colormode"].unified-color-modes .shared-action-button.btn-style-icon {
        width:44px; height:44px; min-height:44px; padding:0;
      }
      [data-clock-control="colormode"].unified-color-modes .shared-action-button.btn-style-pill {
        min-height:44px;
      }
      [data-clock-control="colormode"].unified-color-modes .shared-button-group .shared-action-button.btn-fill {
        min-width:44px;
        min-height:44px;
      }
      [data-clock-control="colormode"]
        .shared-action-button:not(.btn-style-icon):not(.btn-style-pill) {
        flex-direction: row;
        gap: 6px;
        padding: 8px 10px;
        line-height: 1.15;
        min-width: 36px;
        width: auto;
        min-height: 36px;
      }
      .unified-color-modes .color-add .shared-action-button { min-height:36px; }
      [data-clock-control="colormode"] .shared-button-group .btn-text {
        white-space: normal;
        overflow-wrap: break-word;
        word-break: normal;
        text-align: center;
      }
      /* Pill: size to content and wrap like tags (single-line label per pill). */
      [data-clock-control="colormode"]
        .shared-button-group
        .shared-action-button.btn-style-pill {
        flex: 0 0 auto;
        width: auto;
      }
      [data-clock-control="colormode"]
        .shared-action-button.btn-style-pill
        .btn-text {
        white-space: nowrap;
      }

      /* ── Carousel: match the gradient card exactly ──────────────────
         Transparent wrapper (each item paints its own background), keep the
         subtle nav-button hover (not a solid blue fill), and never let a
         preview grow wider than the card. */
      .gc-preview-shell .carousel-content-card {
        background: transparent !important;
        box-shadow: none !important;
        padding: 0 !important;
      }
      .gc-preview-shell .carousel-nav-btn:hover:not(:disabled) {
        background: color-mix(
          in srgb,
          var(--primary-color, #1976d2) 30%,
          var(--card-background-color, #fff)
        );
      }
      .gc-preview-shell .gallery-matrix-preview { max-width: 100% !important; }

      /* Active-style highlight: clearly visible on any background colour. */
      .gc-preview-shell .gallery-item[data-active-mode="true"] {
        outline: 2px solid var(--primary-color, #03a9f4) !important;
        outline-offset: -2px;
        box-shadow: 0 0 8px rgba(3, 169, 244, 0.5) !important;
      }
    </style>`;
  }
}

customElements.define("yeelight-cube-clock-card", YeelightCubeClockCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "yeelight-cube-clock-card",
  name: "Yeelight Cube Clock Card",
  description:
    "Select, configure and visualise the Cube Lite firmware clock: styles, content, format and colour.",
  preview: true,
  documentationURL: "https://github.com/Max-src/yeelight-cube-lite",
});
