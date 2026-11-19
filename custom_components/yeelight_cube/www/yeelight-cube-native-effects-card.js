import {
  followPreviewState,
  previewOnly,
  previewAttributes,
  setPreviewAttributes,
} from "./offline-preview-state.js";
import { ColorModeController, NATIVE_CARD_COLORS } from "./color-mode-controller.js";
import { nativePreviewCatalogue } from "./native-effect-card-utils.js";
import {
  nativeEffectCatalog,
  withNativeEffectCatalog,
} from "./native-effect-catalog.js";
import { resolvePreviewAppearance } from "./preview-appearance.js";
import { createNativeCardAdapter } from "./native-card-adapter.js";
import { LitElement, html, css, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import { ModeControlsController } from "./mode-controls-controller.js";
import { PreviewVisibility } from "./preview-visibility.js";
import { SUPERSEDED } from "./card-command-controller.js";
import { collectionGalleryStyles, modeGallery } from "./collection-gallery.js";
import { colorModeRow } from "./color-mode-ui.js";
import { colorModeSelectorStyles } from "./color-mode-selector-utils.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { paletteMusicFlow } from "./lamp-renderers.js";
import {
  effectOffersColorMode,
  effectSupportsColorOverride,
} from "./native-effect-preview.js";
import {
  closeColorPicker,
  colorPickerStyles,
} from "./color-picker-utils.js";
import { clockPresetLibrary } from "./clock-preset-utils.js";
import "./clock-preset-manager.js";
import "./mode-controls-ui.js";
import {
  nativeEffectItems,
  nativeEffectFrame,
  nativeEffectAction,
  nativeEffectPreviewConfig,
  isEffectName,
} from "./native-effect-card-utils.js";
import {
  matrixPreviewCells,
  renderMatrixPreview,
} from "./gallery-display-utils.js";
import { isVerticalMount } from "./matrix-view.js";
import { BLACK_THRESHOLD } from "./matrix-const.js";
import { actionButtonStyles } from "./action-button-utils.js";
import {
  renderSliderGroup,
  sliderControlStyles,
  lightSliderConfig,
  brightnessPctToRaw,
  brightnessRawToPct,
  speedPctToRaw,
  speedRawToPct,
  intensityPctToRaw,
  intensityRawToPct,
  sliderWhenUsed,
  stableSliderMarkup,
  isSliderHandler,
} from "./slider-control-utils.js";
import { YeelightCardMixin, cubeLampEntities, lampInputs } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampUnavailableLine,
  NOTICE,
} from "./card-shell.js";
import { LampSliders } from "./lamp-sliders.js";
import { availableTargets, everyAvailable } from "./service-call-utils.js";
import { matrixSurface } from "./matrix-animator.js";
import { AnimatedPreview, PreviewClock } from "./preview-animation.js";
import { RENDER_SECONDS } from "./lamp-timing.js";
import {
  chosenIntensity,
  chosenSpeed,
  isLampRendered,
} from "./lamp-renderers.js";
import { FamilyFilter, GallerySort, familyBadge } from "./effect-families.js";
import { ITEM_BADGES } from "./item-badges.js";
import { previewContext } from "./preview-context.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { itemLabel, normalizeCardOptions } from "./card-config.js";

const OFF_FRAME = Array.from({ length: 100 }, () => [0, 0, 0]);
// What the card shows before its lamp reports a color mode, and offline.
const PREVIEW_DEFAULTS = Object.freeze({
  native_effect_color_mode: "normal",
  native_effect_color: null,
});
const OFFLINE_ATTRIBUTES = Object.freeze({
  native_effect_catalog: nativePreviewCatalogue,
});
// A lit pixel's shadow, as on the cells of a repainted preview.
const PIXEL_SHADOW = "0 0 2px #0008";

/** Native host: catalogue/color policy and frame painting. Adapter mapping is
 * in native-card-adapter; shared controllers own commands and selection, and
 * collection-gallery/color-mode-ui own their DOM, subscriptions and bindings.
 */
class YeelightCubeNativeEffectsCard extends YeelightCardMixin(LitElement) {
  static cardSize = 7; // Dashboard height (card-base)
  static editor = [
    "yeelight-cube-native-effects-card-editor",
    "./yeelight-cube-native-effects-card-editor.js",
  ];
  // Slider markup names its handlers in data-on-* attributes.
  static hostEvents = isSliderHandler;

  static properties = {
    config: { state: true },
    _state: { state: true },
    _selected: { state: true },
    _error: { state: true },
    _customDraft: { state: true },
  };

  constructor() {
    super();
    this.config = {};
    // The previews' seconds: held while the lamp's display is frozen; a
    // frame adds at most 200 ms (the tab hidden, the card scrolled away).
    this._clock = new PreviewClock({ maxStep: 200 });
    this._frames = [];
    // The gallery shows the favourites' stars (it follows _controls).
    this._controls = new ModeControlsController(createNativeCardAdapter(this));
    this._colors = new ColorModeController(this, NATIVE_CARD_COLORS);
    // The previews' loop (preview-animation.js): running while the card
    // has previews and is on screen.
    this._animation = new AnimatedPreview(this, {
      onFrame: (due) => this._animationFrame(due),
      minIntervalMs: 100,
      smoothWhen: () =>
        this._frames.some(
          (frame) =>
            isLampRendered(frame.name) &&
            this._previewVisibility?.visible.has(frame.node),
        ),
      // Back on screen: the previews as they are now, at once.
      onShown: () => this._paint(),
    });
    // Dragged values survive until the lamp reports them back
    // (lamp-sliders.js); a slider change stops a running rotation first.
    const slider = (ns, commit) => ({
      config: () => this._sliderConfig(ns),
      live: () => this._paint(),
      beforeCommit: () => this._stopRotation(),
      commit,
    });
    this._lampSliders = new LampSliders(this, {
      speed: slider("speed", (value, options) =>
        this._command(
          "set_native_effect",
          { speed: speedPctToRaw(value), activate: false },
          "yeelight_cube",
          false,
          options,
        ),
      ),
      intensity: slider("intensity", (value, options) =>
        this._command(
          "set_native_effect",
          { intensity: intensityPctToRaw(value), activate: false },
          "yeelight_cube",
          false,
          options,
        ),
      ),
      // Raw brightness on the shared curve, like the other cards.
      brightness: slider("brightness", (value, options) =>
        this._command(
          "turn_on",
          { brightness: brightnessPctToRaw(value) },
          "light",
          false,
          options,
        ),
      ),
    });
  }

  /** The previews' seconds (the clock's). */
  get _elapsed() {
    return this._clock.elapsed;
  }
  set _elapsed(seconds) {
    this._clock.elapsed = seconds;
  }

  _animationFrame(due) {
    // A tile coming on screen shows what it is now, even with nothing
    // moving: its grid may be another item's by now.
    const shown = this._previewVisibility?.shown;
    if (shown !== this._paintedShown) {
      this._paintedShown = shown;
      this._paint();
    }
    // A frozen display holds its current frame, mirroring the lamp.
    const seconds = this._clock.advance(!!this._controls.frozen);
    // The display refreshes faster than the lamp renders: a frame already
    // painted stays.
    const render = Math.floor(seconds / RENDER_SECONDS);
    if (render !== this._paintedRender) {
      this._paintedRender = render;
      this._paint(due);
    }
  }

  _commandsChanged() {
    this._error = this._commands.error;
    this._controls?.notify();
  }

  static getStubConfig(hass) {
    return {
      entity: cubeLampEntities(hass)[0],
      // A new card: the Original gallery, as a grid, 10 effects a page.
      style_selector_style: "original",
      effect_view: "grid",
      items_per_page: 10,
    };
  }

  get _speedDraft() {
    return this._lampSliders?.value("speed") ?? null;
  }
  set _speedDraft(value) {
    this._lampSliders?.setDraft("speed", value);
  }
  get _intensityDraft() {
    return this._lampSliders?.value("intensity") ?? null;
  }
  set _intensityDraft(value) {
    this._lampSliders?.setDraft("intensity", value);
  }
  get _brightnessDraft() {
    return this._lampSliders?.value("brightness") ?? null;
  }
  set _brightnessDraft(value) {
    this._lampSliders?.setDraft("brightness", value);
  }

  setConfig(config) {
    this._offlinePreviewDraft = null;
    closeColorPicker(this);
    this._customDraft = null;
    // Never throw from setConfig: Home Assistant turns any thrown error into a
    // permanent "Configuration error" card that only clears on a full page
    // reload. When no entity is configured yet (e.g. right after the browser
    // cache is cleared and the dashboard re-renders), render the friendly
    // "Select an available Yeelight Cube lamp." placeholder instead and let it
    // self-heal once `hass` arrives.
    this._commands.reset();
    if (config?.show_gallery === false) this._searchQuery = "";
    this._speedDraft = null;
    this._intensityDraft = null;
    this._brightnessDraft = null;
    this.config = {
      show_preview: true,
      show_gallery: true,
      show_brightness: true,
      show_animation_speed: true,
      show_intensity: true,
      show_actions: true,
      show_search: true,
      show_family_filter: true,
      show_family_icons: true,
      favourites_show_family_icons: true,
      show_sort: true,
      show_device_orientation: true,
      show_effect_direction: true,
      // Color Modes & Controls: shown unless turned off in the editor.
      show_color_modes: true,
      favourites_show_stars: true,
      ...resolvePreviewAppearance(normalizeCardOptions(config, "native"), "native"),
    };
    this._selected = null;
    this._state = this._hass?.states?.[this._primaryEntity()];
    this._controls.configure(
      nativeEffectPreviewConfig(this.config),
      this._targets,
    );
  }

  // A push that changed what the card shows (card-base set hass).
  _hassUpdated(hass) {
    // Back online: the offline picks go.
    if (followPreviewState(this)) {
      this._customDraft = null;
      this._selected = null;
    }
    this._controls.update();
    this.requestUpdate();
    const state = hass?.states?.[this._primaryEntity(hass)];
    if (state !== this._state) {
      if (
        state?.attributes.native_effect !==
          this._state?.attributes.native_effect &&
        !this._commands.busy
      )
        this._selected = null;
      this._settleSliderDrafts?.(state);
      this._state = state;
    }
  }

  // Drop dragged slider values once the lamp reports (about) them.
  _settleSliderDrafts(state) {
    this._lampSliders.settle(state?.attributes || {});
  }

  // What the card shows from hass (card-base _hassChanged): every target
  // lamp (the rotation status and color modes read them all) but not their
  // matrix_colors (lampInputs), which no preview here reads; the shared
  // color-preset library and the service registry.
  _hassInputs(hass) {
    return [
      this.config,
      ...this._targets.flatMap((entity) => lampInputs(hass?.states?.[entity])),
      ...(this.config?.show_color_modes
        ? [clockPresetLibrary(hass), hass?.services]
        : []),
    ];
  }

  connectedCallback() {
    super.connectedCallback();
    this._colors.connect();
    // The loop starts once the previews are rendered (_refreshPreviews).
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._colors.disconnect();
    this._controls.disconnect();
    this._commands.reset();
    this._animation.disconnect();
    this._hadFrames = false;
    this._lampSliders.destroy();
    this._previewVisibility?.disconnect();
    this._frames = [];
  }

  async getUpdateComplete() {
    const complete = await super.getUpdateComplete();
    await this.shadowRoot.querySelector("yc-collection-gallery")
      ?.updateComplete;
    await this.shadowRoot.querySelector("yeelight-color-mode")?.updateComplete;
    return complete;
  }
  // Offline: the preview catalogue (previewAttributes). Online, with the
  // lamp's catalogue (native-effect-catalog.js: fetched once per change,
  // the card renders again when it arrives).
  _attrs() {
    return withNativeEffectCatalog(
      previewAttributes(this, PREVIEW_DEFAULTS, OFFLINE_ATTRIBUTES),
      nativeEffectCatalog(this._hass, this._primaryEntity(), this),
    );
  }
  _items() {
    const attrs = this._attrs();
    const mode = this._customDraft
      ? "normal"
      : attrs.native_effect_color_mode || "normal";
    const color = this._customDraft || attrs.native_effect_color;
    return nativeEffectItems(attrs, this.config).filter((item) => this._respondsToColor(item.name, mode, color));
  }

  get _sort() {
    return (this.__sort ||= new GallerySort(this, "yeelight_cube_effect_sort"));
  }

  get _families() {
    return (this.__families ||= new FamilyFilter(
      this,
      "Effect family",
      "yeelight_cube_effect_family",
    ));
  }

  _respondsToColor(name, mode, color) {
    return mode !== "normal"
      ? effectOffersColorMode(name, mode)
      : !color || effectSupportsColorOverride(name);
  }

  _effectForColor(mode, color) {
    const current = this._effect();
    if (
      current &&
      this._respondsToColor(current.name, mode, color) &&
      this._effectAvailable(current.name)
    )
      return current.name;
    return nativeEffectItems(this._attrs(), this.config).find(
      (item) =>
        this._respondsToColor(item.name, mode, color) &&
        this._effectAvailable(item.name),
    )?.name;
  }
  _effect() {
    const catalogue = nativeEffectItems(this._attrs());
    return (
      catalogue.find(
        (item) => item.name === (this._selected || this._attrs().native_effect),
      ) || this._items()[0]
    );
  }
  // Only when none of the card's lamps is available (like the Clock's).
  _disabled() {
    return !availableTargets(this._hass, this.config).length;
  }
  // The shown effect's family picks the slider's icons (a music effect's
  // intensity: 🔈 → 🔊).
  _sliderConfig(ns) {
    return lightSliderConfig(this.config, ns, undefined, {
      family: this._effect()?.family,
    });
  }

  async _command(
    service,
    data,
    domain = "yeelight_cube",
    managed = false,
    options = {},
  ) {
    if (previewOnly(this) && service === "set_native_effect") {
      setPreviewAttributes(this, {
        ...(data.effect ? { native_effect: data.effect } : {}),
        ...(data.direction ? { native_effect_direction: data.direction } : {}),
        ...(data.color_mode
          ? { native_effect_color_mode: data.color_mode }
          : {}),
        ...("color" in data
          ? { native_effect_color: data.color === "clear" ? null : data.color }
          : {}),
      });
      this.requestUpdate();
      return true;
    }
    // Rotation-aware, the shown palette shared first in the Palette color
    // mode, like the Clock card's (color-mode-controller.js send).
    return this._colors.send(service, data, { domain, managed, ...options });
  }

  get _context() {
    return this._commands.context;
  }

  // Every action that changes what is selected (effect, favourite, color)
  // takes a new version. A late success or failure only touches the shown
  // selection while it is still the latest, so an earlier request finishing
  // can never overwrite or roll back a newer choice.
  _nextSelection() {
    this._selectionVersion = (this._selectionVersion || 0) + 1;
    return this._selectionVersion;
  }

  async _applyFavourite(favourite) {
    const context = this._context;
    const version = this._nextSelection?.();
    // Show the favourite's effect and color straight away: a color mode
    // clicked before the lamp answers is built from the selected effect, so it
    // must already be the favourite's (restored below if the request fails).
    const previous = {
      selected: this._selected,
      draft: this._customDraft,
      presetId: this._selectedColorPresetId,
    };
    this._colors.drop();
    this._selected = favourite.key;
    this._customDraft =
      favourite.colorMode === "custom" ? [...favourite.color] : null;
    this._selectedColorPresetId = null;
    this.requestUpdate();
    const success = await this._command(
      "set_native_effect",
      {
        ...nativeEffectAction(favourite.key),
        ...this._colors.favouriteColor(favourite),
      },
      "yeelight_cube",
      true,
    );
    if (context !== this._context) return false;
    if (!success) {
      // Only roll back if nothing newer replaced the favourite meanwhile.
      if (this._selectionVersion === version) {
        this._selected = previous.selected;
        this._customDraft = previous.draft;
        this._selectedColorPresetId = previous.presetId;
        this.requestUpdate();
      }
      return false;
    }
    return true;
  }

  async _apply(name = this._effect()?.name, managed = false) {
    // Never a bare number: the card lists none.
    if (!name || !isEffectName(name)) return;
    const context = this._context;
    this._nextSelection?.();
    this._selected = name;
    const action = nativeEffectAction(name);
    if (this._speedDraft != null && this._effect()?.speed)
      action.speed = speedPctToRaw(this._speedDraft);
    if (this._intensityDraft != null && this._effect()?.intensity)
      action.intensity = intensityPctToRaw(this._intensityDraft);
    const result = await this._command(
      "set_native_effect",
      action,
      "yeelight_cube",
      managed,
      // Quick successive picks only send the latest one.
      { coalesce: "select" },
    );
    // Never sent: keep the drafted speed for the pick that replaced it.
    if (result === SUPERSEDED) return SUPERSEDED;
    if (result && context === this._context) {
      this._speedDraft = null;
      this._intensityDraft = null;
      return true;
    }
    return false;
  }

  _select(name) {
    this._stopRotation();
    this._selected = name;
    this._apply(name);
  }

  // What an effect is, as icons (item-badges.js): Official or Experimental,
  // and Directional when its direction can be chosen.
  _effectBadges(item) {
    return [
      item.extended ? ITEM_BADGES.experimental : ITEM_BADGES.official,
      ...(item.directions?.length ? [ITEM_BADGES.directional] : []),
    ];
  }

  _matrix(effect, current = false) {
    if (!effect) return "";
    if (effect.preview === false)
      return html`<div class="unmodelled">Preview unavailable</div>`;
    const pixels = Array.from({ length: 100 }, () => [0, 0, 0]);
    const appearance = this._matrixAppearance(current);
    const vertical = this._previewVertical();
    return html`<div
      class="effect-matrix ${current ? "current-matrix" : ""}"
      data-effect=${effect.name}
      style=${`width:${appearance.width}%;margin-inline:auto;`}
    >
      ${unsafeHTML(
        renderMatrixPreview(pixels, {
          ...appearance,
          forceAspectRatio: true,
          vertical,
          // A Cube Matrix's modules only (preview-context.js).
          context: previewContext(this._previewAttrs()),
        }),
      )}
    </div>`;
  }

  _matrixAppearance(current) {
    const config = current
      ? nativeEffectPreviewConfig(this.config)
      : this.config;
    // Current preview keeps its lamp_* settings. Every browser preview uses
    // the same gallery_*/preview_size settings as Live Preview.
    const prefix = current ? "lamp" : "gallery";
    const sizeKey = current ? "lamp_preview_size" : "preview_size";
    const background = current
      ? config.lamp_matrix_background
      : config.gallery_background_color || "black";
    const spacing = config[`${prefix}_spacing_mode`];
    return {
      width: Math.max(
        30,
        Math.min(100, Number(config[sizeKey]) || (current ? 100 : 55)),
      ),
      pixelStyle: ["circle", "rounded"].includes(
        config[`${prefix}_pixel_style`],
      )
        ? config[`${prefix}_pixel_style`]
        : "square",
      pixelGap: spacing === "normal" ? 3 : 0,
      proportionalSpacing: true,
      pixelBoxShadow: ["subtle", "normal"].includes(spacing),
      matrixBoxShadow: config[`${prefix}_matrix_box_shadow`] === true,
      bgColor:
        background === "white"
          ? "#fff"
          : background === "transparent"
            ? "transparent"
            : "#000",
      ignoreBlackPixels:
        background !== "black" &&
        config[`${prefix}_ignore_black_pixels`] === true,
    };
  }

  _sliders(effect) {
    const attrs = this._attrs();
    const controls = [];
    if (this.config.show_brightness)
      controls.push({
        label: "Brightness",
        ns: "brightness",
        gc: { ...this._sliderConfig("brightness"), rawValue: attrs.brightness },
        value:
          this._brightnessDraft ??
          brightnessRawToPct(Number(attrs.brightness) || 0),
      });
    // Speed and intensity only for an effect that reads them (effect_catalog.py
    // LAMP_INTENSITY_SLOTS); otherwise hidden or greyed out (sliderWhenUsed).
    // A music effect in the Palette color mode runs as the microphone's
    // music mode, which takes neither (lamp-renderers.js paletteMusicFlow).
    const musicMode = !!paletteMusicFlow(
      effect?.name,
      attrs.native_effect_color_mode,
      attrs.text_colors,
    );
    if (this.config.show_animation_speed)
      controls.push(sliderWhenUsed(this.config, effect?.speed && !musicMode, {
        label: "Speed",
        ns: "speed",
        gc: {
          ...this._sliderConfig("speed"),
          rawValue: attrs.native_effect_speed,
        },
        value:
          this._speedDraft ??
          speedRawToPct(chosenSpeed(attrs)),
      }));
    if (this.config.show_intensity)
      controls.push(sliderWhenUsed(this.config, effect?.intensity && !musicMode, {
        label: "Intensity",
        ns: "intensity",
        gc: {
          ...this._sliderConfig("intensity"),
          rawValue: chosenIntensity(attrs),
        },
        value: this._intensityDraft ?? intensityRawToPct(chosenIntensity(attrs)),
      }));
    if (!controls.some(Boolean)) return "";
    // Usable while a command runs (like the Clock and Lamp Preview sliders:
    // the shared slider draft keeps a dragged value until the lamp has it);
    // inert only while the lamp is unavailable.
    return html`<div class="sliders" ?inert=${this._disabled()}>
      ${unsafeHTML(
        stableSliderMarkup(this, "sliders", renderSliderGroup(controls)),
      )}
    </div>`;
  }

  _selectorStyle() {
    return (
      this.config.style_selector_style ||
      (this.config.effect_view ? "original" : "preview-grid")
    );
  }

  _effectAvailable(effect) {
    if (previewOnly(this))
      return nativePreviewCatalogue.some((item) => item.name === effect);
    return everyAvailable(this._hass, this.config, (entity, state) =>
      nativeEffectItems(
        withNativeEffectCatalog(
          state.attributes,
          nativeEffectCatalog(this._hass, entity, this),
        ),
      ).some((item) => item.name === effect),
    );
  }

  _rotationTargetsReady() {
    return everyAvailable(this._hass, this.config, (entity, state) => state.state === "on");
  }

  _stopRotation() {
    this._controls?.stop();
  }

  _supportsCustomColor() {
    if (previewOnly(this)) return true;
    return everyAvailable(this._hass, this.config, (entity, state) =>
      Object.hasOwn(state.attributes || {}, "native_effect_color"),
    );
  }

  // The saved colors and Add only where every lamp takes a color.
  _colorOptions() {
    return this._colors.options(this._supportsCustomColor());
  }

  // A clicked color mode shows at once (color-mode-controller.js).
  _currentColorSelection() {
    return this._colors.selection(this._lampColorSelection());
  }

  // The color mode the lamp shows (or the color being drafted).
  _lampColorSelection() {
    const attrs = this._attrs();
    if (this._customDraft && this._supportsCustomColor())
      return "__draft__";
    if (
      attrs.native_effect_color_mode &&
      attrs.native_effect_color_mode !== "normal"
    )
      return attrs.native_effect_color_mode;
    if (
      attrs.native_effect_color_mode === "normal" &&
      attrs.native_effect_color &&
      this._supportsCustomColor()
    ) {
      const matches = this._colors.presets().filter((preset) =>
        preset.color.every(
          (channel, index) => channel === attrs.native_effect_color[index],
        ),
      );
      const preset =
        matches.find((preset) => preset.id === this._selectedColorPresetId) ||
        matches[0];
      return preset ? `custom:${preset.id}` : "__draft__";
    }
    return "normal";
  }

  // Normalized color-mode key for favourites: "normal", a palette mode, or
  // "custom" (covers both a draft and a saved custom color preset).
  _colorModeKey() {
    const selection = this._currentColorSelection();
    if (selection === "normal") return "normal";
    if (selection === "__draft__" || selection.startsWith("custom:"))
      return "custom";
    return selection;
  }

  // RGB tuple recorded alongside a "custom" favourite.
  _currentCustomColor() {
    const attrs = this._attrs();
    const selection = this._currentColorSelection();
    if (selection === "__draft__")
      return this._customDraft || attrs.native_effect_color || null;
    if (selection.startsWith("custom:"))
      return this._colors.preset(selection)?.color || attrs.native_effect_color || null;
    return null;
  }

  async _applyCustomColor(color) {
    if (!this._supportsCustomColor()) return false;
    const effect = this._effectForColor("normal", color);
    if (!effect) {
      this._error =
        "No configured effect supports this color on all selected lamps.";
      return false;
    }
    const context = this._context;
    const version = this._nextSelection?.();
    this._colors.drop();
    const success = await this._command("set_native_effect", {
      effect,
      color_mode: "normal",
      color,
    });
    if (
      success &&
      context === this._context &&
      this._selectionVersion === version
    ) {
      this._customDraft = [...color];
      this._selectedColorPresetId = null;
      this._selected = effect;
    }
    return success;
  }

  async _applyColorMode(value) {
    if (value === "__pick__") {
      if (!this._supportsCustomColor()) return;
      // The picker at the row's Add (color-mode-ui).
      this._colors.openPicker(
        this._customDraft || this._attrs().native_effect_color,
        (rgb) => this._applyCustomColor(rgb),
      );
      return;
    }
    const preset = value.startsWith("custom:") ? this._colors.preset(value) : null;
    if (
      value.startsWith("custom:") &&
      (!preset || !this._supportsCustomColor())
    )
      return;
    const mode = preset ? "normal" : value;
    const effect = this._effectForColor(mode, preset?.color);
    if (!effect) {
      this._error =
        "No configured effect supports this color on all selected lamps.";
      return;
    }
    const context = this._context;
    const version = this._nextSelection?.();
    // Shown at once; kept once sent until the lamp reports it.
    const shown = this._colors.show(
      value,
      this._command("set_native_effect", {
        effect,
        color_mode: mode,
        ...(preset
          ? { color: [...preset.color] }
          : Object.hasOwn(this._attrs(), "native_effect_color")
            ? { color: "clear" }
            : {}),
      }),
    );
    this.requestUpdate();
    const success = await shown;
    if (
      success &&
      context === this._context &&
      this._selectionVersion === version
    ) {
      this._customDraft = null;
      this._selectedColorPresetId = preset?.id;
      this._selected = effect;
    }
  }

  render() {
    if (!this._targets.length) return cardNotice(this, NOTICE.noLamp);
    const attrs = this._attrs();
    const effect = this._effect();
    const all = this._items();
    const offline = previewOnly(this);
    return cardShell(
      this,
      html`<div class="body yc-stack">
        ${offline
          ? lampUnavailableLine()
          : !Array.isArray(attrs.native_effect_catalog) &&
              attrs.native_effect_catalog_key == null
            ? html`<div role="alert" class="error">
                Native-effect catalogue unavailable. Reload the updated
                integration.
              </div>`
            : ""}
        ${this._error
          ? html`<div class="error" role="alert">${this._error}</div>`
          : ""}
        ${this.config.show_preview && effect
          ? html`<section class="current yc-stack yc-controls">
              <div class="current-heading">
                <h3>${itemLabel(this.config, effect.name, effect.name)}</h3>
                <span class="state-label"
                  >${attrs.content_mode === "Native Effect" &&
                  attrs.native_effect === effect.name &&
                  !offline &&
                  this._state?.state === "on"
                    ? "Active"
                    : "Preview"}</span
                >
              </div>
              ${this._matrix(effect, true)}
            </section>`
          : ""}
        <yeelight-mode-controls
          area="actions"
          .model=${this._controls}
        ></yeelight-mode-controls>
        ${offline ? "" : this._sliders(effect)}
        <yeelight-mode-controls
          area="direction"
          .model=${this._controls}
        ></yeelight-mode-controls>
        <yeelight-mode-controls
          area="orientation"
          .model=${this._controls}
        ></yeelight-mode-controls>
        ${this.config.show_color_modes &&
        Object.hasOwn(attrs, "native_effect_color_mode")
          ? html`<section class="color-modes">
              ${colorModeRow(this, {
                options: this._colorOptions(),
                lamp: this._lampColorSelection(),
                draft: this._customDraft,
                saveKinds:
                  this._supportsCustomColor() &&
                  this.config.show_save_color_mode_button !== false
                    ? ["color_mode"]
                    : [],
                onSaved: () => {
                  this._customDraft = null;
                },
              })}
            </section>`
          : ""}
        ${this.config.show_gallery && Array.isArray(attrs.native_effect_catalog)
          ? this._gallery(effect, all)
          : ""}
        <yeelight-mode-controls
          area="collections"
          .model=${this._controls}
        ></yeelight-mode-controls></div
      >`,
    );
  }

  // The shared gallery (collection-gallery.js modeGallery), as the Clock
  // card's.
  _gallery(effect, all) {
    const attrs = this._previewAttrs();
    const vertical = isVerticalMount(attrs.device_orientation);
    return modeGallery(this, {
      items: all.map((item) => ({
        ...item,
        dataMode: item.name,
        title: item.name,
        badges: this._effectBadges(item),
        // Its family's icon under the preview (a flame, a sparkle...).
        badgeIcon: this.config.show_family_icons === false ? null : familyBadge(item.family),
        colorData: nativeEffectFrame(item, attrs, 0),
        vertical,
        // A Cube Matrix's modules only (preview-context.js).
        context: previewContext(attrs),
        favourite: this._controls.hasFavourite(item.name, this._colorModeKey()),
      })),
      active: this._controls.displayed("key", effect?.name),
      filter: this._families.gallery(this._items()),
      searchLabel: "Search native effects",
      actionLabel: "Play on the lamp",
      onUpdated: () => this._refreshPreviews(),
    });
  }

  updated() {
    this._controls.update();
    this.dataset.favStars = String(this.config.favourites_show_stars !== false);
    this._refreshPreviews();
  }

  _refreshPreviews() {
    this._frames = [
      ...this.shadowRoot.querySelectorAll(
        ".effect-matrix, .original-item-preview, .reference-selector [data-mode]",
      ),
    ].map((node) => ({
      node,
      name: node.dataset.effect || node.dataset.preview || node.dataset.mode,
      appearance: node.classList.contains("current-matrix")
        ? this._matrixAppearance(true)
        : this._matrixAppearance(false),
      grid: node.querySelector(".gallery-matrix-preview"),
      cells: matrixPreviewCells(node.querySelector(".gallery-matrix-preview")),
    }));
    // A render can land after the card left the page: never observe then
    // (disconnectedCallback already released the observer).
    if (this.isConnected === false) return;
    // Animated while it has previews (and is on screen): started when they
    // appear (a loop stopped meanwhile, e.g. for a capture, stays stopped).
    if (!this._frames.length) this._animation.stop();
    else if (!this._hadFrames) this._animation.start();
    this._hadFrames = this._frames.length > 0;
    // One observer for the card's lifetime: a re-render only observes the
    // previews it added and releases the ones it removed. New previews count
    // as visible until the observer reports, so they are painted at once.
    this._previewVisibility ||= new PreviewVisibility({
      Observer:
        typeof IntersectionObserver === "undefined"
          ? null
          : IntersectionObserver,
    });
    this._previewVisibility.track(this._frames.map((frame) => frame.node));
    // The current preview is always repainted after a render, whatever the
    // observer last reported (same rule as the Clock card).
    for (const frame of this._frames)
      if (frame.node.classList.contains("current-matrix"))
        this._previewVisibility.visible.add(frame.node);
    this._paint();
  }

  // The lamp's attributes the previews follow: the orientation and direction
  // being set (the lamp's until it confirms) and the speed and intensity being
  // dragged.
  // The same object until one of those changes (the previews paint from it
  // on every frame).
  _previewAttrs() {
    const attrs = this._attrs();
    const inputs = [
      attrs,
      this._controls.shownOrientation(),
      this._controls.pendingDirection,
      this._speedDraft,
      this._intensityDraft,
    ];
    const memo = this.__previewAttrs;
    if (memo?.inputs.every((value, index) => value === inputs[index]))
      return memo.value;
    const value = {
      ...attrs,
      device_orientation: inputs[1],
      native_effect_direction:
        this._controls.pendingDirection || attrs.native_effect_direction,
      native_effect_speed:
        this._speedDraft == null
          ? attrs.native_effect_speed
          : speedPctToRaw(this._speedDraft),
      native_effect_intensity:
        this._intensityDraft == null
          ? attrs.native_effect_intensity
          : intensityPctToRaw(this._intensityDraft),
    };
    this.__previewAttrs = { inputs, value };
    return value;
  }

  // The lamp's effects by name (once per catalogue).
  _catalogue(attrs) {
    const list = attrs.native_effect_catalog;
    if (this.__catalogue?.list !== list)
      this.__catalogue = {
        list,
        byName: new Map(list?.map((item) => [item.name, item])),
      };
    return this.__catalogue.byName;
  }

  // The previews stand up while the lamp does (matrix-view.js).
  _previewVertical() {
    return isVerticalMount(this._previewAttrs().device_orientation);
  }

  // all = false: only the previews the lamp's renderers draw, on the frames
  // between the others' (createRafLoop's smoothWhen).
  _paint(all = true) {
    const attrs = this._previewAttrs();
    const cache = new Map();
    // The same preview brightness as the other cards (LampSliders).
    const brightness =
      this.config.preview_brightness === true
        ? this._lampSliders.previewScale(attrs)
        : 1;
    const off = this._state?.state === "off";
    const catalogue = this._catalogue(attrs);
    for (const frame of this._frames) {
      if (!frame.grid || !this._previewVisibility?.visible.has(frame.node)) continue;
      if (!all && !isLampRendered(frame.name)) continue;
      // A powered-off lamp shows a blank screen: black out the current preview.
      if (off && frame.node.classList.contains("current-matrix")) {
        matrixSurface(frame.grid).paint(OFF_FRAME);
        continue;
      }
      const effect = catalogue.get(frame.name);
      if (!effect) continue;
      if (!cache.has(frame.name))
        cache.set(frame.name, nativeEffectFrame(effect, attrs, this._elapsed));
      matrixSurface(frame.grid).paint(
        cache.get(frame.name),
        brightness,
        frame.appearance.ignoreBlackPixels ? BLACK_THRESHOLD : null,
        frame.appearance.pixelBoxShadow ? PIXEL_SHADOW : "",
      );
    }
  }

  static styles = [
    unsafeCSS(cardLayoutStyles),
    unsafeCSS(colorPickerStyles),
    unsafeCSS(actionButtonStyles),
    unsafeCSS(sliderControlStyles),
    unsafeCSS(collectionGalleryStyles),
    unsafeCSS(colorModeSelectorStyles),
    css`
      :host {
        display: block;
        min-width: 0;
      }
      ha-card {
        display: block;
        color: var(--primary-text-color, #222);
        overflow: hidden;
      }
      .current-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      h3 {
        font-size: 16px;
        margin: 0;
        font-weight: 500;
        overflow-wrap: anywhere;
      }
      .state-label {
        font-size: 12px;
        color: var(--secondary-text-color, #666);
      }
      .current-matrix {
        width: 100%;
        max-width: 560px;
        margin: auto;
      }
      .effect-matrix {
        min-width: 0;
      }
      .error {
        color: var(--error-color, #db4437);
        font-size: 14px;
        overflow-wrap: anywhere;
      }
      .empty,
      .unmodelled {
        padding: 18px 0;
        text-align: center;
        color: var(--secondary-text-color, #777);
      }
      .sliders:empty {
        display: none;
      }
      button:focus-visible {
        outline: 2px solid var(--primary-color, #00897b);
        outline-offset: 2px;
      }
      .rotation-summary,
      .section-tools {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .section-tools {
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .rotation-summary {
        justify-content: space-between;
      }
      .rotation-summary > span,
      .effect-rotation .state-label {
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .favourite-effects {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .effect-collection .action-row {
        flex-wrap: wrap;
      }
    `,
  ];
}

defineOnce("yeelight-cube-native-effects-card", YeelightCubeNativeEffectsCard);
registerCustomCard({
  type: "yeelight-cube-native-effects-card",
  name: "Yeelight Cube Native Effects",
  description: "Browse, preview and apply native effects.",
  preview: true,
});
