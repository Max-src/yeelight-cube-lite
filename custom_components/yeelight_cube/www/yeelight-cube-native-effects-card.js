import {
  previewOnly,
  previewAttributes,
  setPreviewAttributes,
} from "./offline-preview-state.js";
import { nativePreviewCatalogue } from "./native-effect-card-utils.js";
import { resolvePreviewAppearance } from "./preview-appearance.js";
import { createNativeCardAdapter } from "./native-card-adapter.js";
import { LitElement, html, css, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import { ModeControlsController } from "./mode-controls-controller.js";
import { PreviewVisibility } from "./preview-visibility.js";
import { SUPERSEDED } from "./card-command-controller.js";
import { collectionGalleryStyles } from "./collection-gallery.js";
import "./color-mode-ui.js";
import { colorModeSelectorStyles } from "./color-mode-selector-utils.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { CLOCK_COLOR_MODES } from "./clock-preview-utils.js";
import {
  effectSupportsColorMode,
  effectSupportsColorOverride,
} from "./native-effect-preview.js";
import {
  openRgbColorPicker,
  closeColorPicker,
  colorPickerStyles,
} from "./color-picker-utils.js";
import {
  clockPresetLibrary,
  clockColorModeOptions,
  clockPresetsByKind,
} from "./clock-preset-utils.js";
import "./clock-preset-manager.js";
import "./mode-controls-ui.js";
import {
  nativeEffectItems,
  nativeEffectFrame,
  nativeEffectAction,
  nativeEffectPreviewConfig,
} from "./native-effect-card-utils.js";
import {
  renderMatrixPreview,
  markFavouriteModes,
} from "./gallery-display-utils.js";
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
  stableSliderMarkup,
  isSliderHandler,
} from "./slider-control-utils.js";
import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampUnavailableLine,
  NOTICE,
} from "./card-shell.js";
import { LampSliders } from "./lamp-sliders.js";
import {
  createRafLoop,
  createVisibilityTracker,
  paintCellBackground,
} from "./matrix-animator.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { itemLabel } from "./card-config.js";

/** Native host: catalogue/color policy and frame painting. Adapter mapping is
 * in native-card-adapter; shared controllers own commands and selection, and
 * collection-gallery/color-mode-ui own their DOM, subscriptions and bindings.
 */
class YeelightCubeNativeEffectsCard extends YeelightCardMixin(LitElement) {
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
    _busy: { state: true },
    _error: { state: true },
    _customColorDraft: { state: true },
    _pendingColorSelection: { state: true },
  };

  constructor() {
    super();
    this.config = {};
    this._elapsed = 0;
    this._frames = [];
    this._controls = new ModeControlsController(createNativeCardAdapter(this));
    this._onFavouritesChanged = () =>
      markFavouriteModes(
        this.shadowRoot,
        this._controls.favourites,
        this._colorModeKey(),
        this._currentCustomColor(),
      );
    this._controls.listeners.add(this._onFavouritesChanged);
    this._loop = createRafLoop(
      (now) => {
        const delta = this._lastFrame
          ? Math.min(200, now - this._lastFrame)
          : 0;
        this._lastFrame = now;
        // A frozen display holds its current frame, mirroring the lamp.
        if (!this._controls.frozen && this._visibility?.onScreen) {
          this._elapsed += delta / 1000;
          this._paint();
        }
      },
      { minIntervalMs: 100 },
    );
    // Dragged values survive until the lamp reports them back
    // (lamp-sliders.js); a slider change stops a running rotation first.
    const slider = (ns, commit) => ({
      config: () => this._sliderConfig(ns),
      live: () => this._paint(),
      beforeCommit: () => this._stopRotation(),
      commit,
    });
    this._lampSliders = new LampSliders(this, {
      speed: slider("speed", (value) =>
        this._command("set_native_effect", {
          speed: speedPctToRaw(value),
          activate: false,
        }),
      ),
      // Raw brightness on the shared curve, like the other cards.
      brightness: slider("brightness", (value) =>
        this._command(
          "turn_on",
          { brightness: brightnessPctToRaw(value) },
          "light",
        ),
      ),
    });
  }

  _commandsChanged() {
    this._busy = this._commands.busy;
    this._error = this._commands.error;
    this._controls?.notify();
  }

  static getStubConfig(hass) {
    return {
      entity: cubeLampEntities(hass)[0],
    };
  }

  get _speedDraft() {
    return this._lampSliders?.value("speed") ?? null;
  }
  set _speedDraft(value) {
    this._lampSliders?.setDraft("speed", value);
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
    this._customColorDraft = null;
    // Never throw from setConfig: Home Assistant turns any thrown error into a
    // permanent "Configuration error" card that only clears on a full page
    // reload. When no entity is configured yet (e.g. right after the browser
    // cache is cleared and the dashboard re-renders), render the friendly
    // "Select an available Yeelight Cube lamp." placeholder instead and let it
    // self-heal once `hass` arrives.
    this._commands.reset();
    this._speedDraft = null;
    this._brightnessDraft = null;
    this.config = {
      show_preview: true,
      show_gallery: true,
      show_brightness: true,
      show_animation_speed: true,
      show_actions: true,
      show_search: true,
      show_device_orientation: true,
      favourites_show_stars: true,
      ...resolvePreviewAppearance(config, "native"),
    };
    this._selected = null;
    this._state = this._hass?.states?.[this._targets[0]];
    this._controls.configure(
      nativeEffectPreviewConfig(this.config),
      this._targets,
    );
  }

  set hass(hass) {
    this._attrs();
    const wasPreviewOnly = previewOnly(this);
    this._hass = hass;
    if (wasPreviewOnly && !previewOnly(this)) {
      this._offlinePreviewDraft = null;
      this._customColorDraft = null;
      this._selected = null;
    }
    this._controls.update();
    if (
      (this.config?.show_rotation || this.config?.show_color_modes) &&
      this._hassInputsChanged?.(hass) !== false
    )
      this.requestUpdate();
    const state = hass?.states?.[this._targets[0]];
    if (state !== this._state) {
      if (
        state?.attributes.native_effect !==
          this._state?.attributes.native_effect &&
        !this._busy
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

  // Rotation status and color modes read every target lamp (not just the
  // primary `_state`), the shared color-preset library and the service
  // registry. Home Assistant hands out a new hass on every state push anywhere,
  // so re-render only when one of those inputs was replaced.
  _hassInputsChanged(hass) {
    return this._inputsChanged([
      this.config,
      ...this._targets.map((entity) => hass?.states?.[entity]),
      ...(this.config?.show_color_modes
        ? [clockPresetLibrary(hass), hass?.services]
        : []),
    ]);
  }

  connectedCallback() {
    super.connectedCallback();
    this._controls.listeners.add(this._onFavouritesChanged);
    this._visibility = createVisibilityTracker(this);
    this._visibility.connect();
    this._loop.start();
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    closeColorPicker(this);
    this._controls.listeners.delete(this._onFavouritesChanged);
    this._controls.disconnect();
    this._commands.reset();
    this._loop.stop();
    this._lampSliders.destroy();
    this._visibility?.disconnect();
    this._previewVisibility?.disconnect();
    this._frames = [];
  }

  getCardSize() {
    return 7;
  }
  async getUpdateComplete() {
    const complete = await super.getUpdateComplete();
    await this.shadowRoot.querySelector("yc-collection-gallery")
      ?.updateComplete;
    await this.shadowRoot.querySelector("yeelight-color-mode")?.updateComplete;
    return complete;
  }
  _attrs() {
    const attrs = previewAttributes(this, {
      native_effect_color_mode: "normal",
      native_effect_color: null,
    });
    return previewOnly(this)
      ? {
          ...attrs,
          native_effect_catalog: nativePreviewCatalogue,
          extended_effects_enabled: true,
        }
      : attrs;
  }
  _items() {
    const attrs = this._attrs();
    const mode = this._customColorDraft
      ? "normal"
      : attrs.native_effect_color_mode || "normal";
    const color = this._customColorDraft || attrs.native_effect_color;
    return nativeEffectItems(attrs, {
      ...this.config,
      show_experimental: !!attrs.extended_effects_enabled,
    }).filter((item) => this._respondsToColor(item.name, mode, color));
  }

  _respondsToColor(name, mode, color) {
    return mode !== "normal"
      ? effectSupportsColorMode(name, mode)
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
    return nativeEffectItems(this._attrs(), {
      ...this.config,
      show_experimental: !!this._attrs().extended_effects_enabled,
    }).find(
      (item) =>
        this._respondsToColor(item.name, mode, color) &&
        this._effectAvailable(item.name),
    )?.name;
  }
  _effect() {
    const catalogue = nativeEffectItems(this._attrs(), {
      show_experimental: true,
    });
    return (
      catalogue.find(
        (item) => item.name === (this._selected || this._attrs().native_effect),
      ) || this._items()[0]
    );
  }
  _disabled() {
    return (
      !this._state || ["unavailable", "unknown"].includes(this._state.state)
    );
  }
  _sliderConfig(ns) {
    return lightSliderConfig(this.config, ns);
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
    if (this._disabled()) return false;
    if (!managed) {
      // A rotation start in flight must finish first, so the stop below
      // really cancels it and it cannot overwrite this command afterwards.
      const pendingStart = this._controls?.whenIdle?.();
      if (pendingStart) await pendingStart;
      this._stopRotation();
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
      draft: this._customColorDraft,
      presetId: this._selectedColorPresetId,
    };
    this._selected = favourite.key;
    this._customColorDraft =
      favourite.colorMode === "custom" ? [...favourite.color] : null;
    this._selectedColorPresetId = null;
    this.requestUpdate();
    const success = await this._command(
      "set_native_effect",
      {
        ...nativeEffectAction(favourite.key),
        color_mode:
          favourite.colorMode === "custom" ? "normal" : favourite.colorMode,
        color: favourite.colorMode === "custom" ? favourite.color : "clear",
      },
      "yeelight_cube",
      true,
    );
    if (context !== this._context) return false;
    if (!success) {
      // Only roll back if nothing newer replaced the favourite meanwhile.
      if (this._selectionVersion === version) {
        this._selected = previous.selected;
        this._customColorDraft = previous.draft;
        this._selectedColorPresetId = previous.presetId;
        this.requestUpdate();
      }
      return false;
    }
    return true;
  }

  async _apply(name = this._effect()?.name, managed = false) {
    if (!name || /^\d+$/.test(name.trim())) return;
    const context = this._context;
    this._nextSelection?.();
    this._selected = name;
    const action = nativeEffectAction(name);
    if (this._speedDraft != null && this._effect()?.speed)
      action.speed = speedPctToRaw(this._speedDraft);
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
      return true;
    }
    return false;
  }

  _select(name) {
    this._stopRotation();
    this._selected = name;
    this._apply(name);
  }

  _effectBadge(item) {
    const kind = item.extended ? "Experimental" : "Official";
    return item.directions?.length ? `${kind} · Directional` : kind;
  }

  _matrix(effect, current = false) {
    if (!effect) return "";
    if (effect.preview === false)
      return html`<div class="unmodelled">Preview unavailable</div>`;
    const pixels = Array.from({ length: 100 }, () => [0, 0, 0]);
    const appearance = this._matrixAppearance(current);
    return html`<div
      class="effect-matrix ${current ? "current-matrix" : ""}"
      data-effect=${effect.name}
      style=${`width:${appearance.width}%;margin-inline:auto;`}
    >
      ${unsafeHTML(
        renderMatrixPreview(pixels, {
          ...appearance,
          forceAspectRatio: true,
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
          brightnessRawToPct(attrs.brightness || 3),
      });
    if (this.config.show_animation_speed && effect?.speed)
      controls.push({
        label: "Animation speed",
        ns: "speed",
        gc: {
          ...this._sliderConfig("speed"),
          rawValue: attrs.native_effect_speed,
        },
        value:
          this._speedDraft ??
          speedRawToPct(attrs.native_effect_speed || 50),
      });
    if (!controls.length) return "";
    return html`<div class="sliders" ?inert=${this._disabled() || this._busy}>
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
    return this._targets.every((entity) => {
      const state = this._hass?.states[entity];
      return (
        state &&
        !["unknown", "unavailable"].includes(state.state) &&
        nativeEffectItems(state.attributes, {
          show_experimental: !!state.attributes.extended_effects_enabled,
        }).some((item) => item.name === effect)
      );
    });
  }

  _rotationTargetsReady() {
    return this._targets.every(
      (entity) => this._hass?.states[entity]?.state === "on",
    );
  }

  _stopRotation() {
    this._controls?.stop();
  }

  _supportsCustomColor() {
    if (previewOnly(this)) return true;
    return this._targets.every((entity) =>
      Object.hasOwn(
        this._hass?.states[entity]?.attributes || {},
        "native_effect_color",
      ),
    );
  }

  _colorOptions() {
    const custom = this._supportsCustomColor();
    const options = clockColorModeOptions(
      CLOCK_COLOR_MODES,
      custom ? clockPresetLibrary(this._hass) : [],
      this.config,
    );
    return options.filter((option) => custom || option.value !== "__pick__");
  }

  _currentColorSelection() {
    // A clicked color mode is shown straight away while its request is in
    // flight (it may be queued behind an effect change); it reverts on failure.
    if (this._pendingColorSelection) return this._pendingColorSelection;
    const attrs = this._attrs();
    if (this._customColorDraft && this._supportsCustomColor())
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
      const matches = clockPresetsByKind(
        clockPresetLibrary(this._hass),
        "color_mode",
      ).filter((preset) =>
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
      return this._customColorDraft || attrs.native_effect_color || null;
    if (selection.startsWith("custom:")) {
      const preset = clockPresetsByKind(
        clockPresetLibrary(this._hass),
        "color_mode",
      ).find((preset) => `custom:${preset.id}` === selection);
      return preset?.color || attrs.native_effect_color || null;
    }
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
      this._customColorDraft = [...color];
      this._selectedColorPresetId = null;
      this._selected = effect;
    }
    return success;
  }

  async _applyColorMode(value) {
    if (value === "__pick__") {
      if (!this._supportsCustomColor()) return;
      const anchor = this.shadowRoot.querySelector(
        '.color-modes button[data-value="__pick__"], .colormode-select',
      );
      if (anchor?.tagName === "SELECT") {
        anchor.value =
          [...anchor.options].find((option) => option.defaultSelected)?.value ||
          "";
      }
      if (anchor)
        openRgbColorPicker(
          this,
          anchor,
          this._customColorDraft || this._attrs().native_effect_color,
          (rgb) => this._applyCustomColor(rgb),
        );
      return;
    }
    const preset = value.startsWith("custom:")
      ? clockPresetsByKind(clockPresetLibrary(this._hass), "color_mode").find(
          (preset) => `custom:${preset.id}` === value,
        )
      : null;
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
    // Each click owns the pending highlight until a newer click replaces it
    // (compared by click, not value: A, B, A must not clear on the first A).
    const click = (this._colorClick = (this._colorClick || 0) + 1);
    const version = this._nextSelection?.();
    this._pendingColorSelection = value;
    let success = false;
    try {
      success = await this._command("set_native_effect", {
        effect,
        color_mode: mode,
        ...(preset
          ? { color: [...preset.color] }
          : Object.hasOwn(this._attrs(), "native_effect_color")
            ? { color: "clear" }
            : {}),
      });
    } finally {
      if (this._colorClick === click) this._pendingColorSelection = null;
    }
    if (
      success &&
      context === this._context &&
      this._selectionVersion === version
    ) {
      this._customColorDraft = null;
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
          : !Array.isArray(attrs.native_effect_catalog)
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
          area="orientation"
          .model=${this._controls}
        ></yeelight-mode-controls>
        ${this.config.show_color_modes &&
        Object.hasOwn(attrs, "native_effect_color_mode")
          ? html`<section class="color-modes">
              <yeelight-color-mode
                .config=${this.config}
                .options=${this._colorOptions()}
                .selected=${this._controls.displayed(
                  "color",
                  this._currentColorSelection(),
                )}
                .draft=${this._customColorDraft}
                .hass=${this._hass}
                .saveKinds=${this._supportsCustomColor() &&
                this.config.show_save_color_mode_button !== false
                  ? ["color_mode"]
                  : []}
                .onSelect=${(value) => this._applyColorMode(value)}
                .onSaved=${() => {
                  this._customColorDraft = null;
                }}
              ></yeelight-color-mode>
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

  // The shared gallery (collection-gallery.js), used exactly like the Clock
  // card's.
  _gallery(effect, all) {
    return html`<yc-collection-gallery
      .config=${this.config}
      .items=${all.map((item) => ({
        ...item,
        dataMode: item.name,
        title: item.name,
        badge: this._effectBadge(item),
        colorData: nativeEffectFrame(item, this._attrs(), 0),
        favourite: this._controls.hasFavourite(item.name, this._colorModeKey()),
      }))}
      .active=${this._controls.displayed("key", effect?.name)}
      .model=${this._controls}
      .disabled=${this._busy}
      searchLabel="Search native effects"
      actionLabel="Play on the lamp"
      .onSelect=${(name) => this._controls.choose(name)}
      .onQuery=${(query) => {
        this._searchQuery = query;
        this._controls?.notify();
      }}
      @gallery-updated=${() => this._refreshPreviews()}
    ></yc-collection-gallery>`;
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
      cells: [...node.querySelectorAll(".gallery-matrix-preview > div")],
    }));
    // A render can land after the card left the page: never observe then
    // (disconnectedCallback already released the observer).
    if (this.isConnected === false) return;
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

  _paint() {
    const attrs = {
      ...this._attrs(),
      device_orientation:
        this._controls.pendingOrientation || this._attrs().device_orientation,
      native_effect_speed:
        this._speedDraft == null
          ? this._attrs().native_effect_speed
          : speedPctToRaw(this._speedDraft),
    };
    const cache = new Map();
    const brightness =
      this.config.preview_brightness === true
        ? (this._brightnessDraft ?? brightnessRawToPct(attrs.brightness || 255)) /
          100
        : 1;
    const off = this._state?.state === "off";
    for (const frame of this._frames) {
      if (!this._previewVisibility?.visible.has(frame.node)) continue;
      // A powered-off lamp shows a blank screen: black out the current preview.
      if (off && frame.node.classList.contains("current-matrix")) {
        frame.cells.forEach((cell) => {
          paintCellBackground(cell, "#000");
          if (cell.style.boxShadow !== "") cell.style.boxShadow = "";
        });
        continue;
      }
      const effect = attrs.native_effect_catalog?.find(
        (item) => item.name === frame.name,
      );
      if (!effect) continue;
      if (!cache.has(frame.name))
        cache.set(frame.name, nativeEffectFrame(effect, attrs, this._elapsed));
      cache.get(frame.name).forEach((pixel, index) => {
        if (frame.cells[index]) {
          const hidden =
            frame.appearance.ignoreBlackPixels &&
            pixel.every((value) => value <= BLACK_THRESHOLD);
          paintCellBackground(
            frame.cells[index],
            hidden
              ? "transparent"
              : `rgb(${pixel.map((value) => Math.round(value * brightness)).join(",")})`,
          );
          const shadow =
            !hidden && frame.appearance.pixelBoxShadow ? "0 0 2px #0008" : "";
          if (frame.cells[index].style.boxShadow !== shadow)
            frame.cells[index].style.boxShadow = shadow;
        }
      });
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
