import {
  previewOnly,
  previewAttributes,
  setPreviewAttributes,
} from "./offline-preview-state.js";
import { previewLength } from "./preview-appearance.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { createClockCardAdapter } from "./clock-card-adapter.js";
import {
  resolveClockAppearance,
  APPEARANCE_PRESETS,
} from "./preview-appearance.js";
// ============================================================================
//  Yeelight Cube Lite — Clock Card
// ============================================================================
//
// Select, configure and visualise the firmware clock: pick a clock style from
// an animated live-preview gallery, set the content (Time / Time & Date /
// Date), 12/24-hour and colon-blink format, and an optional colour override.
//
// Ownership: clock-card-adapter maps the domain; card-command-controller owns
// transport; mode-controls-controller owns selection/favourites/rotation;
// style-browser-ui and color-mode-ui own interactive DOM. This host retains
// Clock format/preset policy and frame painting. The card is a LitElement that
// renders its shadow root from Lit templates into one persistent <ha-card>.

import {
  independentActionConfig,
  DEFAULT_BUTTON_STYLE,
  DEFAULT_BUTTON_CONTENT_MODE,
} from "./action-button-utils.js";
import { ModeControlsController } from "./mode-controls-controller.js";
import { CardCommandController } from "./card-command-controller.js";
import { LitElement, html, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import "./style-browser-ui.js";
import "./color-mode-ui.js";
import {
  matchingColorOption,
  colorModeSelectorStyles,
} from "./color-mode-selector-utils.js";
import "./mode-controls-ui.js";
import "./clock-preset-manager.js";
import {
  clockPresetLibrary,
  clockColorToRgb,
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
  openRgbColorPicker,
  colorPickerStyles,
} from "./color-picker-utils.js";
import { getTargetEntities } from "./service-call-utils.js";
import {
  galleryDisplayStyles,
  markFavouriteModes,
} from "./gallery-display-utils.js";
import { carouselStyles } from "./carousel-utils.js";
import {
  renderSliderGroup,
  lightSliderConfig,
  createSliderHandlers,
  createSliderDraft,
  stableSliderMarkup,
  sliderControlStyles,
  sliderKeys,
  brightnessPctToRaw,
  brightnessRawToPct,
  speedPctToRaw,
  speedRawToPct,
  isSliderHandler,
} from "./slider-control-utils.js";
import { bindHostEvents } from "./host-events.js";
import {
  TEXT_SELECTOR_STYLES,
  PREVIEW_SELECTOR_STYLES,
  selectorSharedStyles,
} from "./selector-shared-styles.js";
import { paginationStyles } from "./pagination-utils.js";
import {
  CLOCK_MIXER_EFFECT_SPEED,
  CLOCK_COLOR_MODES,
  clockStyleColorModeState,
  clockStyleRespondsToCustomColor,
  clockStyleByName,
  getClockStyles,
  renderClockFrame,
  lookupNativeClockFont,
  flipMatrixVertical,
} from "./clock-preview-utils.js";
import { previewBrightnessScale } from "./matrix-const.js";
import {
  createRafLoop,
  paintCellBackground,
  paintCellBoxShadow,
} from "./matrix-animator.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { renderActionButtonGroup } from "./action-button-ui.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { PreviewVisibility } from "./preview-visibility.js";

const CONTENT_OPTIONS = [
  { value: "time", label: "Time", icon: "mdi:clock-outline" },
  { value: "time_date", label: "Time & Date", icon: "mdi:calendar-clock" },
  { value: "date", label: "Date", icon: "mdi:calendar" },
];

export {
  COLOR_PRESET_STYLE_CHOICES,
  COLOR_PRESET_SHAPE_CHOICES,
} from "./color-mode-selector-utils.js";

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

// Card styles (static Lit styles; unchanged from the former inline <style>).
const CLOCK_CARD_CSS = `
      ${cardLayoutStyles}
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
      .card-title { font-size: 1.15em; font-weight: 600; }
      .active-label { font-size: 0.9em; color: var(--secondary-text-color, #9aa); }
      /* The Content and Format sections sit side by side when the card is
         wide enough, and wrap to their own rows otherwise. */
      .section-row > .section { flex: 1 1 auto; min-width: 0; }

      .current-preview { display: flex; justify-content: center; }
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

      ${colorModeSelectorStyles}

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
    `;

class YeelightCubeClockCard extends LitElement {
  constructor() {
    super();
    this._hass = null;
    this.config = {};
    this._commands = new CardCommandController(() => {
      if (this._controls) {
        this._controls.error = this._commands.error;
        this._controls.notify();
      }
    });
    this._phaseAccum = 0;
    this._lastPhaseTs = null;
    this._animLoop = null;
    this._visible = new Set();
    this._visibility = null;
    this._stateSignature = null;
    // Dragged slider values (in slider %) survive until the lamp reports them
    // back, so a slow drag or an in-between update never jumps them back.
    this._sliderDrafts = {
      speed: createSliderDraft({
        isDragging: () => this._anySliderDragging,
        onExpire: () => this.requestUpdate(),
      }),
      brightness: createSliderDraft({
        isDragging: () => this._anySliderDragging,
        onExpire: () => this.requestUpdate(),
      }),
    };
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
        onCommit: (pct) => {
          this._sliderDrafts.speed.commit(pct);
          this._applySpeed(speedPctToRaw(pct));
        },
        onLive: (pct) => this._sliderDrafts.speed.live(pct),
        onDragEnd: () => this.requestUpdate(),
      }),
    );
    Object.assign(
      this,
      createSliderHandlers({
        host: this,
        ns: "brightness",
        getConfig: () => this._brightnessGc(),
        onCommit: (pct) => {
          this._sliderDrafts.brightness.commit(pct);
          this._applyBrightness(brightnessPctToRaw(pct));
        },
        onLive: (pct) => this._sliderDrafts.brightness.live(pct),
        onDragEnd: () => this.requestUpdate(),
      }),
    );
  }

  // Live speed as a raw device value (1-255), or null when not overridden.
  get _speedPreview() {
    const pct = this._sliderDrafts?.speed.value;
    return pct == null ? null : speedPctToRaw(pct);
  }

  // Live brightness in slider %, or null when not overridden.
  get _brightnessPreview() {
    return this._sliderDrafts?.brightness.value ?? null;
  }

  // Both sliders share the appearance config (slider_*); only colour + icons
  // differ per slider.
  _speedGc() {
    return lightSliderConfig(this.config, "speed", this._sliderKeys);
  }

  _brightnessGc() {
    return lightSliderConfig(this.config, "brightness", this._sliderKeys);
  }

  setConfig(config) {
    this._offlinePreviewDraft = null;
    this._commands.reset();
    const cfg = independentActionConfig(config, {
      buttons_style: DEFAULT_BUTTON_STYLE,
      buttons_content_mode: DEFAULT_BUTTON_CONTENT_MODE,
    });
    if (cfg.show_search === false) this._searchQuery = "";
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
      buttons_style: DEFAULT_BUTTON_STYLE,
      buttons_content_mode: DEFAULT_BUTTON_CONTENT_MODE,
      // Unified selector (same families as the gradient card):
      //   Text:    filled | dropdown
      //   Preview: preview-list | preview-grid | preview-carousel | preview-wheel
      //   Original: grid | list badge gallery (shared with the native card)
      style_selector_style: "preview-grid",
      show_gallery: true,
      selector_shape: "rounded", // square | rounded | round
      preview_size: 55, // % -> px (same size axis as the gradient card)
      preview_show_titles: true,
      highlight_active_mode: true,
      favourites_show_stars: true,
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
      ...resolveClockAppearance(cfg),
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
    this._controls ||= new ModeControlsController(createClockCardAdapter(this));
    this._controls.configure(this.config, getTargetEntities(this.config));
    // Keep the grid/list star badges in sync whenever favourites change
    // (controller.notify fires on every state update — marking is cheap).
    this._markFavouritesListener ||= () =>
      markFavouriteModes(
        this.shadowRoot,
        this._controls.favourites,
        this._currentColorMode(this._attrs()),
        this._controls.adapter.currentColor(),
      );
    this._controls.listeners.add(this._markFavouritesListener);
    this._stateSignature = null;
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
      clock_preview_appearance: { ...APPEARANCE_PRESETS.classic },
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
    if (this._hassInputsUnchanged(hass)) {
      // Nothing this card reads was replaced: keep the fresh hass object (for
      // service calls) but skip attribute reads, controller updates and the
      // state-signature work. Drag previews still drop once the drag ends.
      this._hass = hass;
      return;
    }
    this._attrs();
    const wasPreviewOnly = previewOnly(this);
    this._hass = hass;
    if (wasPreviewOnly && !previewOnly(this)) {
      this._offlinePreviewDraft = null;
      this._customMode = undefined;
      this._customDraft = null;
      this._customPresetColor = null;
      this._selectedStylePresetId = null;
    }
    this._controls?.update();
    this._restoreCustomColor();
    this._ensureRenderRoot();
    // Once the lamp reports (about) the dragged values, drop the overrides so
    // the sliders and previews follow the real values again.
    const sliderAttrs = this._attrs();
    this._sliderDrafts.brightness.settle(
      brightnessRawToPct(Number(sliderAttrs.brightness) || 3),
    );
    this._sliderDrafts.speed.settle(
      speedRawToPct(Number(sliderAttrs.native_effect_speed) || 50),
    );
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

  // Home Assistant hands out a new hass object on every state push anywhere.
  // Everything this card reads comes from the config, the primary/target lamp
  // states, the clock preset library (cached per hass.states and resolved via
  // its remembered sensor), the native font sensor and the service registry;
  // when all of those are the same references as the last processed update
  // (and the first render is done) the update can be skipped entirely.
  _hassInputsUnchanged(hass) {
    const states = hass?.states;
    const primary = this._primaryEntity();
    const inputs = [
      this.config,
      hass?.services,
      clockPresetLibrary(hass),
      this._nativeFontState(states),
      primary ? states?.[primary] : undefined,
      ...getTargetEntities(this.config).map((entity) => states?.[entity]),
    ];
    const last = this._lastHassInputs;
    this._lastHassInputs = inputs;
    return (
      !!last &&
      this.hasUpdated &&
      this._stateSignature !== null &&
      last.length === inputs.length &&
      inputs.every((value, index) => value === last[index])
    );
  }

  connectedCallback() {
    super.connectedCallback();
    // Slider markup names its handlers in data-on-* attributes.
    bindHostEvents(this, isSliderHandler);
    this._controls?.listeners.add(this._markFavouritesListener);
    this._startAnimation();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._commands.reset();
    this._controls?.listeners.delete(this._markFavouritesListener);
    this._controls?.disconnect();
    closeColorPicker(this);
    this._stopAnimation();
    this._slSpeedDestroy?.();
    this._slBrightnessDestroy?.();
  }

  // ── Selector helpers (shared design language with the gradient card) ──────
  _selectorStyle() {
    const v = this.config.style_selector_style;
    if (v === "original") return "original";
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
    const attrs = previewAttributes(this);
    return previewOnly(this)
      ? { ...attrs, extended_effects_enabled: true }
      : attrs;
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
    // The preset library array is replaced whenever its sensor's state
    // changes, so its identity (tracked as a version) plus its length stand in
    // for serialising the whole library on every hass update.
    const presets = clockPresetLibrary(this._hass);
    if (presets !== this._signaturePresets) {
      this._signaturePresets = presets;
      this._signaturePresetVersion = (this._signaturePresetVersion || 0) + 1;
    }
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
      a.device_orientation,
      a.extended_effects_enabled,
      a.content_mode,
      a.brightness,
      this._stateObj()?.state,
      this._signaturePresetVersion,
      presets.length,
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
  // preview card. The sensor's entity id is remembered once found and the
  // result is cached on that entity's state object, so state pushes elsewhere
  // never rescan every entity; only a missing sensor falls back to a scan
  // (cached per hass.states until one appears).
  _getNativeClockFont(states = this._hass?.states) {
    if (!states) return { fontMap: null, metrics: null };
    this._nativeFontCache = lookupNativeClockFont(states, this._nativeFontCache);
    return this._nativeFontCache.font;
  }

  // The font sensor state object backing the cached native font (null when
  // no sensor exists), used as a cheap change marker for hass updates.
  _nativeFontState(states) {
    this._getNativeClockFont(states);
    return this._nativeFontCache?.state ?? null;
  }

  _controlStyles(attrs = this._attrs()) {
    return clockStylesWithPresets(
      getClockStyles(!!attrs.extended_effects_enabled),
      clockPresetLibrary(this._hass),
    );
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
    const query =
      this.config.show_search === false
        ? ""
        : (this._searchQuery || "").trim().toLowerCase();
    return this._availableStyles().filter((style) =>
      style.name.toLowerCase().includes(query),
    );
  }

  _availableStyles() {
    const styles = this._styleList();
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

  // Like _previewAttrs, but renders a favourite under its recorded colour mode
  // (and custom colour) instead of the card's currently selected mode.
  _previewAttrsFor(style, colorMode, color) {
    const a = this._attrs();
    const attrs = {
      clock_style_id: style.id,
      clock_style: style.name,
      clock_content: a.clock_content,
      clock_show_date: a.clock_show_date,
      clock_12_hour: a.clock_12_hour,
      clock_colon_blink: a.clock_colon_blink,
      clock_color_mode:
        colorMode === "custom" ? "normal" : colorMode || "normal",
      native_effect_direction: a.native_effect_direction,
    };
    if (style.presetId) {
      attrs.clock_style = "White";
      attrs.clock_color_rgb =
        colorMode === "custom" && color ? color : style.color;
      return attrs;
    }
    if (colorMode === "custom" && Array.isArray(color))
      attrs.clock_color_rgb = color;
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
  async _callSetClock(data, managed = false, options = {}) {
    if (previewOnly(this)) {
      const style = this._controlStyles().find(
        (item) => item.id === data.style || item.name === data.style,
      );
      setPreviewAttributes(this, {
        ...(style ? { clock_style: style.name, clock_style_id: style.id } : {}),
        ...(data.color_mode ? { clock_color_mode: data.color_mode } : {}),
        ...("color" in data
          ? {
              clock_color: Array.isArray(data.color)
                ? 0x01000000 +
                  data.color[0] * 65536 +
                  data.color[1] * 256 +
                  data.color[2]
                : null,
            }
          : {}),
        ...(data.content ? { clock_content: data.content } : {}),
      });
      this.render();
      return true;
    }
    return this._command(
      "set_clock_style",
      data,
      "yeelight_cube",
      managed,
      options,
    );
  }

  async _command(
    service,
    data,
    domain = "yeelight_cube",
    managed = false,
    options = {},
  ) {
    if (!managed) {
      // A rotation start in flight must finish first, so the stop below
      // really cancels it and it cannot overwrite this command afterwards.
      const pendingStart = this._controls?.whenIdle?.();
      if (pendingStart) await pendingStart;
      this._controls?.stop();
    }
    return this._commands.execute(
      this._hass,
      this.config,
      service,
      data,
      domain,
      options,
    );
  }

  _applyStyle(name, managed = false) {
    const style = this._controlStyles().find(
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
    // Quick successive picks only send the latest one.
    const result = this._callSetClock(action, managed, { coalesce: "select" });
    this.render();
    return result;
  }

  async _applyFavourite(favourite) {
    const style = this._controlStyles().find(
      (item) => clockPresetKey(item) === favourite.key,
    );
    if (!style) return false;
    const action = clockStyleAction(style);
    action.color_mode =
      favourite.colorMode === "custom" ? "normal" : favourite.colorMode;
    action.color =
      favourite.colorMode === "custom"
        ? favourite.color
        : action.color || "clear";
    const context = this._controls.context;
    if (
      !(await this._callSetClock(action, true)) ||
      context !== this._controls.context
    )
      return false;
    this._customMode = favourite.colorMode === "custom";
    this._customDraft = this._customMode ? [...favourite.color] : null;
    this._customPresetColor = null;
    this._selectedStylePresetId = style.presetId || null;
    this._revealSavedStyle = null;
    this._pendingStyleColor = null;
    this.render();
    return true;
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
    return this._command("turn_on", { brightness }, "light");
  }

  // ── Preview-selector interaction (wheel / carousel / active marking) ──────
  _markActive() {
    this.dataset.highlightActive = String(
      this.config.highlight_active_mode !== false,
    );
  }

  // ── Animation ─────────────────────────────────────────────────────────────
  // A single rAF loop repaints ONLY the on-screen previews, in place (updating
  // each dot's background rather than rebuilding HTML), throttled to ~11 fps and
  // paused while the tab is hidden (shared createRafLoop). This keeps a long
  // gallery of animated previews smooth instead of full-innerHTML rebuilds.
  _startAnimation() {
    if (!this._animLoop) {
      this._animLoop = createRafLoop(() => this._paintVisible(), {
        minIntervalMs: 90, // ~11 fps
      });
    }
    this._animLoop.start();
  }

  _stopAnimation() {
    if (this._animLoop) this._animLoop.stop();
    this._visibility?.disconnect();
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
    // A render can land after the card left the page (disconnectedCallback
    // already ran): never keep an observer nothing would clean up.
    if (!this.isConnected) {
      this._visibility?.disconnect();
      this._visible = new Set();
      return;
    }
    const tiles = this.shadowRoot
      ? [
          ...this.shadowRoot.querySelectorAll("[data-clock-preview]"),
          ...this.shadowRoot.querySelectorAll(".gc-preview-shell [data-mode]"),
          ...this.shadowRoot.querySelectorAll(
            ".original-gallery .original-item",
          ),
        ]
      : [];
    // One observer for the card's lifetime: a re-render only observes the
    // tiles it added and releases the ones it removed.
    this._visibility ||= new PreviewVisibility({
      rootMargin: "120px",
      Observer:
        typeof IntersectionObserver === "undefined"
          ? null
          : IntersectionObserver,
    });
    // The observer reports a new tile asynchronously (next frame at best), so
    // a re-render (new style/colour selected) would leave freshly built
    // gallery tiles on their static first frame until then -- a visible blink.
    // Seed new tiles synchronously with the same 120px margin so the
    // following _paintVisible() repaints them before the browser shows them.
    const margin = 120;
    const viewHeight = globalThis.innerHeight || 0;
    const viewWidth = globalThis.innerWidth || 0;
    this._visibility.track(tiles, (el) => {
      if (el.hasAttribute("data-clock-preview")) return true;
      const rect = el.getBoundingClientRect?.();
      return (
        !!rect &&
        rect.width > 0 &&
        rect.bottom >= -margin &&
        rect.top <= viewHeight + margin &&
        rect.right >= -margin &&
        rect.left <= viewWidth + margin
      );
    });
    this._visible = this._visibility.visible;
    // The card's own previews (lamp/current) are always repainted after a
    // render, whatever the observer last reported: a re-render (e.g. an
    // appearance change) must show on them at once.
    tiles.forEach((el) => {
      if (el.hasAttribute("data-clock-preview")) this._visible.add(el);
    });
  }

  _paintVisible() {
    if (!this._hass) return;
    // Freezing holds the background animation on its current frame, but the
    // clock digits/colon keep evolving -- so skip advancing the phase yet keep
    // repainting, exactly like the frozen lamp.
    if (!this._controls?.frozen) this._advancePhase();
    else this._lastPhaseTs = Date.now();
    const phase = this._phase();
    this._visible.forEach((el) => this._paintPreview(el, phase));
  }

  // Build a tile's dot grid exactly once, caching the cell nodes on the element.
  // Card-owned tiles (current preview) use the Lamp Preview
  // appearance settings.
  _ensureGrid(el) {
    const appearanceSignature = JSON.stringify([
      this.config.lamp_pixel_style,
      this.config.lamp_matrix_background,
      this.config.lamp_spacing_mode,
      this.config.lamp_matrix_box_shadow,
      this.config.lamp_ignore_black_pixels,
    ]);
    if (el._cells && el._appearanceSignature === appearanceSignature)
      return el._cells;
    el._appearanceSignature = appearanceSignature;
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
    el._pixelShadow = this._spacingShadow(spacing)
      ? `0 0 ${previewLength(2)} #0008`
      : "";
    const matrixShadow =
      this.config.lamp_matrix_box_shadow === true
        ? `box-shadow:0 ${previewLength(2)} ${previewLength(8)} rgba(0,0,0,0.5);`
        : "";
    el._ignoreBlack = this._lampIgnoreBlack();
    el.style.containerType = "inline-size";
    el.innerHTML = "";
    const grid = document.createElement("div");
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:${previewLength(gap)};background:${bg};padding:${previewLength(pad)};border-radius:${previewLength(4)};width:100%;box-sizing:border-box;${matrixShadow}`;
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
    } else if (el.classList.contains("original-item")) {
      // Original uses the same gallery_* appearance as Live Preview. The key
      // is read from the escaped data-mode attribute, never from raw HTML.
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
          ? `0 0 ${previewLength(2)} #0008`
          : "";
      }
    } else {
      // Preview selector item: repaint using the gallery_* appearance.
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
          ? `0 0 ${previewLength(2)} #0008`
          : "";
      }
    }
    const style =
      this._styleList().find((item) => clockPresetKey(item) === styleName) ||
      this._currentStyle();
    if (!style) return;
    // A powered-off lamp shows a blank screen: black out the current preview.
    if (isCurrent && this._stateObj()?.state === "off") {
      for (let i = 0; i < cells.length; i++) {
        paintCellBackground(cells[i], "#000");
        paintCellBoxShadow(cells[i], "");
      }
      return;
    }
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
        ? brightnessPctToRaw(this._brightnessPreview)
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
      paintCellBackground(cell, bg);
      paintCellBoxShadow(cell, sh);
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  //
  // Lit renders the whole shadow root from `_template()` into one persistent
  // <ha-card> (HA's asynchronously slotted ha-card must survive updates).
  // `render()` keeps its imperative meaning for domain actions and external
  // callers: outside Lit's own update cycle it re-renders synchronously, and
  // inside it (LitElement.update -> render) it returns the template.
  render() {
    if (this._litRendering) return this._template();
    this._ensureRenderRoot();
    this.requestUpdate();
    this.performUpdate();
    return undefined;
  }

  _ensureRenderRoot() {
    if (this.renderRoot === undefined)
      this.renderRoot = this.createRenderRoot();
  }

  update(changedProperties) {
    const focus = this._captureFocus();
    this._litRendering = true;
    try {
      super.update(changedProperties);
    } finally {
      this._litRendering = false;
    }
    this._restoreFocus(focus);
  }

  // Post-render wiring for the main view (previews + favourite markers).
  updated() {
    if (!this._mainRendered) return;
    this._controls?.update();
    this._markActive();
    this.dataset.favStars = String(this.config.favourites_show_stars !== false);
    markFavouriteModes(
      this.shadowRoot,
      this._controls?.favourites,
      this._currentColorMode(this._attrs()),
      this._controls?.adapter.currentColor(),
    );
    this._setupObserver();
    this._paintVisible();
  }

  // Remember which toggle button had focus so it can be restored when a
  // re-render replaces its group (e.g. the Content/Format row reflows).
  _captureFocus() {
    const focused = this.shadowRoot?.activeElement;
    const control = focused?.closest("[data-clock-control]")?.dataset
      .clockControl;
    const value = focused?.dataset.value;
    return control && value ? { control, value } : null;
  }

  _restoreFocus(focus) {
    if (!focus) return;
    const group = this.shadowRoot.querySelector(
      `[data-clock-control="${focus.control}"] .shared-button-group`,
    );
    const button = [...(group?.querySelectorAll("button") || [])].find(
      (item) => item.dataset.value === focus.value,
    );
    if (!button || button.disabled) return;
    if (group.getAttribute("role") === "radiogroup") {
      group.querySelectorAll("button").forEach((item) => {
        item.tabIndex = item === button ? 0 : -1;
      });
    }
    if (this.shadowRoot.activeElement !== button)
      button.focus({ preventScroll: true });
  }

  _onBrowserUpdated() {
    this._markActive();
    this._setupObserver();
    this._paintVisible();
  }

  _template() {
    this._mainRendered = false;
    let content;
    let background;
    if (!this._hass) {
      content = html`<div class="loading">Loading…</div>`;
      background = false;
    } else if (!this._primaryEntity()) {
      content = html`<div class="empty">
        Configure a Yeelight Cube Lite light entity in the card editor.
      </div>`;
      background = true;
    } else {
      content = this._mainTemplate();
      background = this.config.show_card_background !== false;
      this._mainRendered = true;
    }
    return html`<ha-card
      class=${background ? "clock-card yc-stack" : "clock-card no-bg yc-stack"}
      @browser-updated=${this._onBrowserUpdated}
      >${content}</ha-card
    >`;
  }

  _mainTemplate() {
    const a = this._attrs();
    let revealKey;
    if (this._revealSavedStyle) {
      const preset = clockStylesWithPresets(
        [],
        clockPresetLibrary(this._hass),
      ).find((style) => style.name === this._revealSavedStyle);
      if (preset) {
        this._selectedStylePresetId = preset.presetId;
        this._pendingStyleColor = null;
        revealKey = clockPresetKey(preset);
        this._revealSavedStyle = null;
      }
    }

    const config = this.config;
    const current = this._currentStyle();
    const offline = previewOnly(this);
    // 12/24-hour and colon only affect the time, so hide them for date-only.
    const content =
      a.clock_content || (a.clock_show_date ? "time_date" : "time");
    const showContent = !offline && config.show_content_toggle !== false;
    const showFormat =
      !offline && config.show_format_toggles !== false && content !== "date";
    // Content + Format share a row so they sit side by side when there's room.
    const toggles =
      showContent && showFormat
        ? html`<div class="section-row yc-row">
            ${this._renderContentToggle(a)}${this._renderFormatToggles(a)}
          </div>`
        : showContent
          ? this._renderContentToggle(a)
          : showFormat
            ? this._renderFormatToggles(a)
            : "";
    const sliders =
      !offline &&
      (config.show_brightness === true || config.show_animation_speed !== false)
        ? this._renderSliders(a)
        : "";

    return html`${config.title
        ? html`<div class="card-title">${config.title}</div>`
        : ""}${!offline && config.show_active_label !== false
        ? html`<div class="active-label">${current?.name || ""}</div>`
        : ""}${offline
        ? html`<div class="muted" role="status">Lamp unavailable</div>`
        : ""}${config.show_current_preview !== false
        ? this._renderCurrentPreview(current)
        : ""}
      <yeelight-mode-controls
        area="actions"
        .model=${this._controls}
      ></yeelight-mode-controls>
      ${sliders}${toggles}${config.show_color_modes
        ? this._renderColorMode(a)
        : ""}
      ${config.show_gallery !== false
        ? this._galleryBrowser(offline, current, revealKey)
        : ""}
      <yeelight-mode-controls
        area="collections"
        .model=${this._controls}
      ></yeelight-mode-controls>`;
  }

  // The browser owns its own query/page/wheel state, so one instance is kept
  // for the card's lifetime (it survives the gallery being hidden and shown).
  _galleryBrowser(offline, current, revealKey) {
    this._browser ||= document.createElement("yeelight-style-browser");
    this._browser.config = this.config;
    this._browser.items = this._previewItems();
    // While a rotation runs with "Highlight the playing clock mode" off, the
    // list keeps the selection from before it started (see displayed()).
    this._browser.active = offline
      ? null
      : this._controls.displayed("key", clockPresetKey(current));
    this._browser.model = this._controls;
    this._browser.disabled = this._commands.busy;
    this._browser.searchLabel = "Search clock modes";
    this._browser.searchClass = "clock-search";
    this._browser.heading = "Clock style";
    this._browser.onSelect = (name) => this._controls.choose(name);
    this._browser.onQuery = (query) => {
      this._searchQuery = query;
    };
    if (revealKey)
      this._browser.updateComplete.then(() => this._browser.reveal(revealKey));
    return this._browser;
  }

  async getUpdateComplete() {
    // Renders are synchronous; Lit's scheduler only settles once connected.
    const result = this.isConnected
      ? await super.getUpdateComplete()
      : !this.isUpdatePending;
    await Promise.all([
      this._browser?.updateComplete,
      this.shadowRoot?.querySelector("ha-card")?.updateComplete,
      this.shadowRoot?.querySelector("yeelight-color-mode")?.updateComplete,
    ]);
    return result;
  }

  _previewTile(style, { current = false, size } = {}) {
    const px = size || this._previewSizePx();
    return html`<div
      class="clock-preview"
      data-clock-preview
      data-style-name=${clockPresetKey(style) ?? ""}
      data-current=${current ? "1" : "0"}
      data-size=${px}
    ></div>`;
  }

  _renderCurrentPreview(current) {
    const pct = Number(this.config.lamp_preview_size) || 55;
    const maxW = Math.round(120 + (pct / 100) * 380);
    return html`<div class="current-preview">
      <div class="current-preview-inner" style="max-width:${maxW}px;">
        ${this._previewTile(current, { current: true })}
      </div>
    </div>`;
  }

  // Build the shared-renderer item list: one animated clock frame per style.
  _previewItems() {
    const phase = 0;
    const { fontMap, metrics } = this._getNativeClockFont();
    return this._availableStyles().map((s) => ({
      title: s.name,
      name: s.name,
      colorData: flipMatrixVertical(
        renderClockFrame(this._previewAttrs(s), fontMap, metrics, phase),
      ),
      dataMode: clockPresetKey(s),
      badge: this._clockStyleBadge(s),
      favourite: this._controls?.hasFavourite(
        clockPresetKey(s),
        this._currentColorMode(this._attrs()),
      ),
      metadata: null,
    }));
  }

  _clockStyleBadge(style) {
    if (style.presetId) return "Custom";
    return style.experimental ? "Experimental" : "Official";
  }

  _controlGroup(options, onChange) {
    return renderActionButtonGroup(
      {
        buttonStyle: this.config.buttons_style || DEFAULT_BUTTON_STYLE,
        contentMode:
          this.config.buttons_content_mode || DEFAULT_BUTTON_CONTENT_MODE,
        ...options,
      },
      onChange,
    );
  }

  _toggleFormat(value) {
    const a = this._attrs();
    this._applyFormat(
      value === "twelve"
        ? { twelve_hour: !a.clock_12_hour }
        : { colon_blink: !a.clock_colon_blink },
    );
  }

  _renderContentToggle(a) {
    const cur = a.clock_content || (a.clock_show_date ? "time_date" : "time");
    return html`<div class="section">
      <div data-clock-control="content">
        ${this._controlGroup(
          { label: "Content", items: CONTENT_OPTIONS, value: cur },
          (value) => this._applyContent(value),
        )}
      </div>
    </div>`;
  }

  _renderFormatToggles(a) {
    const twelve = !!a.clock_12_hour;
    const blink = !!a.clock_colon_blink;
    return html`<div
      class="section"
      style="--ctl-accent: color-mix(in srgb, var(--primary-color, #1976d2) 58%, #12a594);"
    >
      <div
        data-clock-control="format"
        style="--primary-color: var(--ctl-accent); --primary-color-dark: color-mix(in srgb, var(--ctl-accent) 74%, #000);"
      >
        ${this._controlGroup(
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
          (value) => this._toggleFormat(value),
        )}
      </div>
    </div>`;
  }

  _renderColorMode(a) {
    const mode = this._currentColorMode(a);
    const options = this._colorModeOptions();
    const saved =
      mode === "custom" && !this._customDraft
        ? matchingColorOption(
            options,
            this._customPresetColor,
            this._selectedColorPresetId,
            this._selectedColorPresetName,
          )
        : null;
    const cur = mode === "custom" ? saved?.value : mode;
    const draft = this._customMode && this._customDraft;
    return html` <div
      class="section"
      style="--ctl-accent: color-mix(in srgb, var(--primary-color, #1976d2) 58%, #7c5cbf);"
    >
      <yeelight-color-mode
        .config=${this.config}
        .options=${options}
        .selected=${this._controls.displayed("colour", cur)}
        .draft=${draft || null}
        .hass=${this._hass}
        .saveKinds=${this._saveKinds()}
        .previewAttrs=${this._previewAttrs(this._currentStyle())}
        .onSelect=${(value) => this._applyColorMode(value)}
        .onSaved=${(detail) => this._onPresetSaved(detail)}
      ></yeelight-color-mode>
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
          ? brightnessPctToRaw(this._brightnessPreview)
          : Number(this._attrs().brightness) || 3;
      const briPct =
        this._brightnessPreview != null
          ? this._brightnessPreview
          : brightnessRawToPct(briRaw);
      controls.push({
        label: "Brightness",
        gc: { ...this._brightnessGc(), rawValue: briRaw },
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
        gc: { ...this._speedGc(), rawValue: this._speedPreview ?? raw },
        value: this._sliderDrafts.speed.value ?? speedRawToPct(raw),
        ns: "speed",
      });
    }
    // The shared slider renderer emits an HTML string naming this card's
    // `_sl*` handlers in data-on-* attributes (see host-events.js).
    return html`<div class="section section-sliders">
      ${unsafeHTML(
        stableSliderMarkup(this, "sliders", renderSliderGroup(controls)),
      )}
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

  // The trailing "+" choice opens the native picker; changes apply live.
  _openCustomPicker(anchor) {
    openRgbColorPicker(this, anchor, this._customDraft, (rgb) =>
      this._applyColor(rgb),
    );
  }

  static styles = unsafeCSS(CLOCK_CARD_CSS);
}

defineOnce("yeelight-cube-clock-card", YeelightCubeClockCard);

registerCustomCard({
  type: "yeelight-cube-clock-card",
  name: "Yeelight Cube Clock Card",
  description:
    "Select, configure and visualise the Cube Lite firmware clock: styles, content, format and colour.",
  preview: true,
  documentationURL: "https://github.com/Max-src/yeelight-cube-lite",
});
