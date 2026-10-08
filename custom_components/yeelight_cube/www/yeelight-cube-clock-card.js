import {
  previewOnly,
  previewAttributes,
  setPreviewAttributes,
} from "./offline-preview-state.js";
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
// Date), 12/24-hour and colon-blink format, and an optional color override.
//
// Ownership: clock-card-adapter maps the domain; card-command-controller owns
// transport; mode-controls-controller owns selection/favourites/rotation;
// collection-gallery and color-mode-ui own interactive DOM. This host retains
// Clock format/preset policy and frame painting. The card is a LitElement that
// renders its shadow root from Lit templates into one persistent <ha-card>.

import {
  independentActionConfig,
  DEFAULT_BUTTON_STYLE,
  DEFAULT_BUTTON_CONTENT_MODE,
} from "./action-button-utils.js";
import { ModeControlsController } from "./mode-controls-controller.js";
import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampUnavailableLine,
  NOTICE,
} from "./card-shell.js";
import { LampSliders } from "./lamp-sliders.js";
import { LitElement, html, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import "./collection-gallery.js";
import "./color-mode-ui.js";
import { matchingColorOption } from "./color-mode-selector-utils.js";
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
import { closeColorPicker, openRgbColorPicker } from "./color-picker-utils.js";
import { markFavouriteModes } from "./gallery-display-utils.js";
import {
  renderSliderGroup,
  lightSliderConfig,
  stableSliderMarkup,
  sliderKeys,
  brightnessPctToRaw,
  brightnessRawToPct,
  speedPctToRaw,
  speedRawToPct,
  isSliderHandler,
} from "./slider-control-utils.js";
import { TEXT_SELECTOR_STYLES, PREVIEW_SELECTOR_STYLES } from "./selector-shared-styles.js";
import {
  CLOCK_COLOR_MODES,
  clockStyleColorModeState,
  clockStyleRespondsToCustomColor,
  clockStyleByName,
  getClockStyles,
  renderClockFrame,
  lookupNativeClockFont,
  flipMatrixVertical,
} from "./clock-preview-utils.js";
import { renderActionButtonGroup } from "./action-button-ui.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { ClockPreviewMixin } from "./clock-card-preview.js";
import { CLOCK_CARD_CSS } from "./clock-card-styles.js";
import { rgbToHex } from "./color-utils.js";
import { itemLabel, itemMatchesQuery } from "./card-config.js";

const CONTENT_OPTIONS = [
  { value: "time", label: "Time", icon: "mdi:clock-outline" },
  { value: "time_date", label: "Time & Date", icon: "mdi:calendar-clock" },
  { value: "date", label: "Date", icon: "mdi:calendar" },
];

export {
  COLOR_PRESET_STYLE_CHOICES,
  COLOR_PRESET_SHAPE_CHOICES,
} from "./color-mode-selector-utils.js";

class YeelightCubeClockCard extends ClockPreviewMixin(YeelightCardMixin(LitElement)) {
  static editor = ["yeelight-cube-clock-card-editor", "./yeelight-cube-clock-card-editor.js"];
  // Slider markup names its handlers in data-on-* attributes.
  static hostEvents = isSliderHandler;

  constructor() {
    super();
    this._hass = null;
    this.config = {};
    this._phaseAccum = 0;
    this._lastPhaseTs = null;
    this._animLoop = null;
    this._visible = new Set();
    this._visibility = null;
    this._stateSignature = null;
    // Two independent sliders on one host (shared appearance config) with
    // distinct namespaces so their handlers and DOM don't collide. Dragged
    // values survive until the lamp reports them back (lamp-sliders.js).
    this._sliderKeys = sliderKeys("slider");
    this._lampSliders = new LampSliders(this, {
      speed: {
        config: () => this._speedGc(),
        commit: (pct) => this._applySpeed(speedPctToRaw(pct)),
      },
      brightness: {
        config: () => this._brightnessGc(),
        commit: (pct) => this._applyBrightness(brightnessPctToRaw(pct)),
      },
    });
  }

  _commandsChanged() {
    if (this._controls) {
      this._controls.error = this._commands.error;
      this._controls.notify();
    }
  }

  // Live speed as a raw device value (1-255), or null when not overridden.
  get _speedPreview() {
    const pct = this._lampSliders?.value("speed");
    return pct == null ? null : speedPctToRaw(pct);
  }

  // Live brightness in slider %, or null when not overridden.
  get _brightnessPreview() {
    return this._lampSliders?.value("brightness") ?? null;
  }

  // Both sliders share the appearance config (slider_*); only color + icons
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
      // Custom color is now a color mode; its picker style lives here.
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
    // Custom color moved from its own section into the color-mode selector;
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
    this._controls.configure(this.config, this._targets);
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

  static getStubConfig(hass) {
    const allEntities = cubeLampEntities(hass);
    return {
      // Default to controlling ALL Cube lamps (like the gradient card), so a
      // freshly-added card applies changes to every lamp until narrowed down.
      entity: allEntities[0] || "",
      target_entities: allEntities,
      style_selector_style: "preview-grid",
      preview_appearance: { ...APPEARANCE_PRESETS.classic },
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
    this._lampSliders.settle(this._attrs());
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
      ...this._targets.map((entity) => states?.[entity]),
    ];
    return (
      !this._inputsChanged(inputs) &&
      this.hasUpdated &&
      this._stateSignature !== null
    );
  }

  connectedCallback() {
    super.connectedCallback();
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
    this._lampSliders.destroy();
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

  // The styles the gallery's search shows (its labels or built-in names).
  _shownStyles() {
    const query =
      this.config.show_search === false
        ? ""
        : (this._searchQuery || "").trim().toLowerCase();
    return this._availableStyles().filter((style) =>
      itemMatchesQuery(this.config, clockPresetKey(style), style.name, query),
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

  // The color-mode selector value: a firmware palette when one is active,
  // otherwise "custom" when a free custom RGB override is set, else "normal".
  _currentColorMode(a) {
    if (this._customMode) return "custom";
    const mode = a.clock_color_mode || "normal";
    if (mode !== "normal") return mode;
    const rgb = clockColorToRgb(a.clock_color);
    if (!rgb) return "normal";
    // The user explicitly entered Custom (even if the color happens to match a
    // saved preset); honour that so Custom stays selectable.
    // A style we just saved/selected owns this color until the HA library
    // echoes it back as a matchable preset; treat it as a style (Normal), not a
    // free override, so the selector doesn't flash "Custom" during that window.
    if (
      this._pendingStyleColor &&
      this._pendingStyleColor.every((channel, index) => channel === rgb[index])
    )
      return "normal";
    // A saved solid-color clock style carries its color on White; that is a
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
      // A preset previews its OWN saved color, not the active override.
      attrs.clock_style = "White";
      attrs.clock_color_rgb = style.color;
      return attrs;
    }
    // renderClockFrame applies the override only to color-supporting styles;
    // incompatible effects ignore it and solid styles show it flat. Only a free
    // custom color propagates to the gallery — a selected style preset does not.
    const rgb =
      this._currentColorMode(a) === "custom"
        ? this._customDraft || this._customPresetColor
        : null;
    if (this._customMode) attrs.clock_color_mode = "normal";
    if (rgb) attrs.clock_color_rgb = rgb;
    return attrs;
  }

  // Like _previewAttrs, but renders a favourite under its recorded color mode
  // (and custom color) instead of the card's currently selected mode.
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
    // color override unless the user is genuinely in Custom mode (where the
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
    // A color attached to the CURRENT state only counts as "the custom
    // color" while Custom mode is genuinely active; if it merely belongs to
    // an active style preset, entering Custom must not inherit it.
    const wasCustom = this._currentColorMode(this._attrs()) === "custom";
    const preserveStyle =
      !!(this._activeStylePreset(this._attrs()) || this._pendingStyleColor) &&
      (!wasCustom || !(this._customDraft || this._customPresetColor));
    this._revealSavedStyle = null;
    const currentColor = wasCustom ? this._customDraft : null;
    if (currentColor) this._lastCustomHex = rgbToHex(currentColor, "#ffee00");
    // Track the user's explicit mode choice (Custom is inferred, not a backend
    // field, so a color that matches a preset must not snap back to Normal).
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
    // it even when the backend color (and thus the state signature) is unchanged.
    this.render();
  }

  _applyColor(rgbOrClear) {
    this._customPresetColor = null;
    this._revealSavedStyle = null;
    this._customDraft = Array.isArray(rgbOrClear) ? [...rgbOrClear] : null;
    this._customMode = Array.isArray(rgbOrClear);
    this._selectedStylePresetId = null;
    this._pendingStyleColor = null;
    if (Array.isArray(rgbOrClear)) this._lastCustomHex = rgbToHex(rgbOrClear, "#ffee00");
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
    this._lastCustomHex = rgbToHex(preset.color, "#ffee00");
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

  // The gallery re-rendered its items: mark, observe and paint them.
  _onGalleryUpdated() {
    this._setupObserver();
    this._paintVisible();
  }

  _template() {
    this._mainRendered = false;
    if (!this._hass) return cardNotice(this, NOTICE.loading);
    if (!this._primaryEntity()) return cardNotice(this, NOTICE.noLamp);
    const body = this._mainTemplate();
    this._mainRendered = true;
    return cardShell(
      this,
      html`<div class="clock-body yc-stack">${body}</div>`,
    );
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

    return html`${!offline && config.show_active_label !== false
        ? html`<div class="active-label">
            ${current
              ? itemLabel(config, clockPresetKey(current), current.name)
              : ""}
          </div>`
        : ""}${offline ? lampUnavailableLine() : ""}${config.show_current_preview !== false
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
        ? this._gallery(offline, current, revealKey)
        : ""}
      <yeelight-mode-controls
        area="collections"
        .model=${this._controls}
      ></yeelight-mode-controls>`;
  }

  // The shared gallery (collection-gallery.js), used exactly like the Native
  // Effects card's. While a rotation runs with "Highlight the playing clock
  // mode" off, it keeps the selection from before it started (displayed()).
  _gallery(offline, current, revealKey) {
    return html`<yc-collection-gallery
      .config=${this.config}
      .items=${this._previewItems()}
      .active=${offline
        ? null
        : this._controls.displayed("key", clockPresetKey(current))}
      .model=${this._controls}
      .disabled=${this._commands.busy}
      .revealKey=${revealKey}
      heading="Clock style"
      searchLabel="Search clock modes"
      actionLabel="Show on the lamp"
      .onSelect=${(name) => this._controls.choose(name)}
      .onQuery=${(query) => {
        this._searchQuery = query;
      }}
      .onRename=${(key, name) => this._renamePreset(key, name)}
      .onDelete=${(key) => this._deletePreset(key)}
      @gallery-updated=${this._onGalleryUpdated}
    ></yc-collection-gallery>`;
  }

  // A custom clock style of the gallery (key custom:<id>), or undefined.
  _presetOf(key) {
    const id = String(key).startsWith("custom:") ? key.slice(7) : null;
    return clockPresetLibrary(this._hass).find(
      (preset) => preset.id === id && (preset.kind || "style") === "style",
    );
  }

  // Custom clock styles are shared presets: renamed and deleted for every
  // card (save_clock_preset / delete_clock_preset).
  async _renamePreset(key, name) {
    const preset = this._presetOf(key);
    if (!preset) return false;
    await this._hass.callService("yeelight_cube", "save_clock_preset", {
      preset_id: preset.id,
      name,
      color: preset.color,
      kind: "style",
    });
    return true;
  }

  async _deletePreset(key) {
    const preset = this._presetOf(key);
    if (!preset) return false;
    await this._hass.callService("yeelight_cube", "delete_clock_preset", {
      preset_id: preset.id,
    });
    return true;
  }

  async getUpdateComplete() {
    // Renders are synchronous; Lit's scheduler only settles once connected.
    const result = this.isConnected
      ? await super.getUpdateComplete()
      : !this.isUpdatePending;
    await Promise.all([
      this.shadowRoot?.querySelector("yc-collection-gallery")?.updateComplete,
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
      // Custom styles are the user's own: renamed and deleted in the gallery.
      editable: !!s.presetId,
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
        .selected=${this._controls.displayed("color", cur)}
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
        value: this._lampSliders.value("speed") ?? speedRawToPct(raw),
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
    // That color is now owned by the new style, not the freeform Custom
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
    "Select, configure and visualise the Cube Lite firmware clock: styles, content, format and color.",
  preview: true,
  documentationURL: "https://github.com/Max-src/yeelight-cube-lite",
});
