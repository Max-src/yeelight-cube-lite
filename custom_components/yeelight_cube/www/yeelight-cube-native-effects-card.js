import { LitElement, html, css, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import { ModeControlsController } from "./mode-controls-controller.js";
import {
  renderColorModeSelector,
  colorModeSelectorStyles,
} from "./color-mode-selector-utils.js";
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
import { bindActionButtonGroup } from "./action-button-utils.js";
import "./mode-controls-ui.js";
import {
  nativeEffectItems,
  nativeEffectFrame,
  nativeEffectAction,
  nativeEffectPreviewConfig,
  effectSupportsFreeze,
} from "./native-effect-card-utils.js";
import {
  renderMatrixPreview,
  markFavouriteModes,
  renderOriginalGallery,
  bindOriginalGallery,
} from "./gallery-display-utils.js";
import {
  renderTextStyleSelector,
  renderPreviewStyleSelector,
  bindStyleSelectorEvents,
  selectorItemsPerPage,
  styleSelectorStyles,
} from "./style-selector-utils.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import { BLACK_THRESHOLD } from "./draw_card_const.js";
import { escapeHtml } from "./html-escape-utils.js";
import { actionButtonStyles } from "./action-button-utils.js";
import {
  renderSliderGroup,
  createSliderHandlers,
  sliderControlStyles,
  lightSliderConfig,
  sliderPctToRaw,
  sliderRawToPct,
} from "./slider-control-utils.js";
import {
  renderPagination,
  attachPaginationListeners,
  paginationStyles,
} from "./pagination-utils.js";
import {
  createRafLoop,
  createVisibilityTracker,
  paintCellBackground,
} from "./matrix-animator.js";
import {
  callServiceOnTargetEntities,
  getTargetEntities,
} from "./service-call-utils.js";

class YeelightCubeNativeEffectsCard extends LitElement {
  static properties = {
    config: { state: true },
    _state: { state: true },
    _selected: { state: true },
    _query: { state: true },
    _page: { state: true },
    _paused: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _customColorDraft: { state: true },
  };

  constructor() {
    super();
    this.config = {};
    this._query = "";
    this._page = 0;
    this._elapsed = 0;
    this._queue = Promise.resolve();
    this._context = 0;
    this._frames = [];
    this._controls = new ModeControlsController({
      kind: "native",
      items: () =>
        nativeEffectItems(this._attrs(), {
          show_experimental: !!this._attrs().extended_effects_enabled,
        }).map((item) => ({ key: item.name, title: item.name })),
      navigationItems: () =>
        this._items().map((item) => ({ key: item.name, title: item.name })),
      current: () => this._effect()?.name,
      available: (name) => this._effectAvailable(name),
      ready: () => this._rotationTargetsReady(),
      disabled: () => this._disabled() || this._busy,
      on: () => this._state?.state === "on",
      orientation: () => this._attrs().device_orientation || "right",
      apply: (name) => this._apply(name, true),
      select: (name) => {
        this._selected = name;
        return this.config.auto_apply !== false
          ? this._apply(name, true)
          : true;
      },
      command: (service, data, domain) =>
        this._command(service, data, domain, true),
      freeze: () => this._command("freeze_display", {}, "yeelight_cube", true),
      freezable: () => effectSupportsFreeze(this._effect()?.name),
      startRotation: (names, intervalSeconds) =>
        this._command(
          "start_effect_rotation",
          { items: names, interval: intervalSeconds, kind: "native" },
          "yeelight_cube",
          true,
        ),
      stopRotation: () =>
        this._command("stop_effect_rotation", {}, "yeelight_cube", true),
      skipRotation: () =>
        this._command("skip_effect_rotation", {}, "yeelight_cube", true),
      rotationActive: () =>
        getTargetEntities(this.config).every(
          (entity) =>
            this._hass?.states[entity]?.attributes?.effect_rotation?.active ===
              true &&
            this._hass?.states[entity]?.attributes?.effect_rotation?.kind ===
              "native",
        ),
      rotationError: () =>
        getTargetEntities(this.config)
          .map((entity) => {
            const rotation =
              this._hass?.states[entity]?.attributes?.effect_rotation;
            return rotation?.kind === "native" ? rotation.error : null;
          })
          .find(Boolean) || this._error,
      // The `effect_rotation` attribute only exists in the backend version that
      // ships the rotation services; its presence is our capability probe.
      rotationSupported: () =>
        getTargetEntities(this.config).every(
          (entity) =>
            this._hass?.states[entity]?.attributes?.effect_rotation !==
            undefined,
        ),
      pause: (paused) => {
        this._paused = paused;
      },
      frame: (name, elapsed) => {
        const item = this._attrs().native_effect_catalog?.find(
          (item) => item.name === name,
        );
        return item && item.preview !== false
          ? nativeEffectFrame(item, this._attrs(), elapsed)
          : null;
      },
    });
    this._onFavouritesChanged = () =>
      markFavouriteModes(this.shadowRoot, this._controls.favourites);
    this._controls.listeners.add(this._onFavouritesChanged);
    this._loop = createRafLoop(
      (now) => {
        const delta = this._lastFrame
          ? Math.min(200, now - this._lastFrame)
          : 0;
        this._lastFrame = now;
        // A frozen display holds its current frame, mirroring the lamp.
        if (
          !this._paused &&
          !this._controls.frozen &&
          this._visibility?.onScreen
        ) {
          this._elapsed += delta / 1000;
          this._paint();
        }
      },
      { minIntervalMs: 100 },
    );
    for (const ns of ["speed", "brightness"]) {
      Object.assign(
        this,
        createSliderHandlers({
          host: this,
          ns,
          getConfig: () => this._sliderConfig(ns),
          onLive: (value) => {
            this[`_${ns}Draft`] = value;
            this._paint();
          },
          onCommit: (value) => {
            this._stopRotation();
            if (ns === "speed" && this.config.auto_apply === false) {
              this._speedDraft = value;
              this.requestUpdate();
              return;
            }
            this[`_${ns}Draft`] = null;
            if (ns === "speed")
              this._command("set_native_effect", {
                speed: this._speedRaw(value),
                activate: false,
              });
            else
              this._command(
                "turn_on",
                { brightness_pct: Math.round(value) },
                "light",
              );
          },
        }),
      );
    }
  }

  static async getConfigElement() {
    await import("./yeelight-cube-native-effects-card-editor.js");
    return document.createElement("yeelight-cube-native-effects-card-editor");
  }

  static getStubConfig(hass) {
    return {
      entity: Object.keys(hass?.states || {}).find(
        (id) =>
          id.startsWith("light.") && hass.states[id].attributes.native_effect,
      ),
    };
  }

  setConfig(config) {
    closeColorPicker(this);
    this._customColorDraft = null;
    // Never throw from setConfig: Home Assistant turns any thrown error into a
    // permanent "Configuration error" card that only clears on a full page
    // reload. When no entity is configured yet (e.g. right after the browser
    // cache is cleared and the dashboard re-renders), render the friendly
    // "Select an available Yeelight Cube lamp." placeholder instead and let it
    // self-heal once `hass` arrives.
    this._context++;
    this._busy = false;
    this._pendingCommands = 0;
    this._error = null;
    this._speedDraft = null;
    this._brightnessDraft = null;
    this.config = {
      show_preview: true,
      show_gallery: true,
      show_brightness: true,
      show_animation_speed: true,
      show_actions: true,
      show_search: true,
      auto_apply: true,
      show_device_orientation: true,
      favourites_show_stars: true,
      ...config,
    };
    if (this.config.show_search === false) {
      this._query = "";
    }
    this._selected = null;
    this._page = 0;
    this._state = this._hass?.states?.[getTargetEntities(config || {})[0]];
    this._selectorIndex = undefined;
    this._controls.configure(
      nativeEffectPreviewConfig(this.config),
      getTargetEntities(this.config),
    );
  }

  set hass(hass) {
    this._hass = hass;
    this._controls.update();
    if (this.config?.show_rotation || this.config?.show_color_modes)
      this.requestUpdate();
    const state = hass?.states?.[getTargetEntities(this.config || {})[0]];
    if (state !== this._state) {
      if (
        state?.attributes.native_effect !==
          this._state?.attributes.native_effect &&
        !this._busy
      )
        this._selected = null;
      this._state = state;
    }
  }

  connectedCallback() {
    super.connectedCallback();
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
    this._context++;
    this._busy = false;
    this._pendingCommands = 0;
    this._loop.stop();
    this._visibility?.disconnect();
    this._observer?.disconnect();
    this._wheelController?.destroy();
    this._wheelNode = null;
    this._frames = [];
  }

  getCardSize() {
    return 7;
  }
  _attrs() {
    return this._state?.attributes || {};
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
  _speedRaw(value) {
    return sliderPctToRaw(value, 1, 255);
  }
  _sliderConfig(ns) {
    return lightSliderConfig(this.config, ns);
  }

  async _command(service, data, domain = "yeelight_cube", managed = false) {
    if (this._disabled()) return false;
    if (!managed) this._stopRotation();
    const context = this._context;
    const hass = this._hass;
    const config = this.config;
    this._error = null;
    this._pendingCommands = (this._pendingCommands || 0) + 1;
    this._busy = true;
    const job = this._queue.then(async () => {
      if (context !== this._context) return false;
      await callServiceOnTargetEntities(hass, config, service, data, {
        domain,
      });
      return true;
    });
    this._queue = job.catch(() => {});
    try {
      return await job;
    } catch (error) {
      if (context === this._context)
        this._error = error.message || "The lamp could not be updated.";
      return false;
    } finally {
      if (context === this._context) {
        this._pendingCommands--;
        this._busy = this._pendingCommands > 0;
      }
    }
  }

  async _apply(name = this._effect()?.name, managed = false) {
    if (!name || /^\d+$/.test(name.trim())) return;
    const context = this._context;
    this._selected = name;
    const action = nativeEffectAction(name);
    if (this._speedDraft != null && this._effect()?.speed)
      action.speed = this._speedRaw(this._speedDraft);
    if (
      (await this._command(
        "set_native_effect",
        action,
        "yeelight_cube",
        managed,
      )) &&
      context === this._context
    ) {
      this._speedDraft = null;
      return true;
    }
    return false;
  }

  _select(name) {
    this._stopRotation();
    this._selected = name;
    if (this.config.auto_apply !== false) this._apply(name);
  }

  _effectBadge(item) {
    const kind = item.extended ? "Experimental" : "Official";
    return item.directions?.length ? `${kind} · Directional` : kind;
  }

  _originalPreview(item) {
    if (!item) return "";
    if (item.preview === false)
      return '<div class="unmodelled">Preview unavailable</div>';
    const appearance = this._matrixAppearance(false);
    const pixels = Array.from({ length: 100 }, () => [0, 0, 0]);
    return `<div class="original-item-preview" data-preview="${escapeHtml(item.name)}" style="width:${appearance.width}%;margin-inline:auto;">
      ${renderMatrixPreview(pixels, { ...appearance, forceAspectRatio: true })}
    </div>`;
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
          sliderRawToPct(attrs.brightness || 3, 3, 255),
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
          sliderRawToPct(attrs.native_effect_speed || 50, 1, 255),
      });
    if (!controls.length) return "";
    return html`<div class="sliders" ?inert=${this._disabled() || this._busy}>
      ${unsafeHTML(renderSliderGroup(controls))}
    </div>`;
  }

  _selectorStyle() {
    return (
      this.config.style_selector_style ||
      (this.config.effect_view ? "original" : "preview-grid")
    );
  }

  _effectAvailable(effect) {
    return getTargetEntities(this.config).every((entity) => {
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
    return getTargetEntities(this.config).every(
      (entity) => this._hass?.states[entity]?.state === "on",
    );
  }

  _stopRotation() {
    this._controls?.stop();
  }

  _referenceSelector(items) {
    const style = this._selectorStyle();
    this._selectorItems = items;
    const active = this._effect()?.name;
    const previews = items.map((item) => ({
      name: item.name,
      title: item.name,
      dataMode: item.name,
      colorData: nativeEffectFrame(item, this._attrs(), 0),
      favourite: this._controls.favourites.includes(item.name),
    }));
    if (!style.startsWith("preview-"))
      return renderTextStyleSelector(this.config, previews, style, active);
    const state = { index: this._selectorIndex, page: this._page };
    const markup = renderPreviewStyleSelector(
      this.config,
      previews,
      style,
      active,
      state,
    );
    this._selectorIndex = state.index;
    return markup;
  }

  _selectorNavigate(delta, index) {
    if (this._disabled() || this._busy) return;
    const items = this._selectorItems || [];
    if (!items.length) return;
    const requested = index ?? (this._selectorIndex || 0) + delta;
    const next =
      this.config.gallery_wrap_navigation === true
        ? ((requested % items.length) + items.length) % items.length
        : Math.max(0, Math.min(requested, items.length - 1));
    this._selectorIndex = next;
    this._select(items[next].name);
    this.requestUpdate();
  }

  _supportsCustomColor() {
    return getTargetEntities(this.config).every((entity) =>
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

  async _applyCustomColor(color) {
    if (!this._supportsCustomColor()) return false;
    const effect = this._effectForColor("normal", color);
    if (!effect) {
      this._error =
        "No configured effect supports this colour on all selected lamps.";
      return false;
    }
    const context = this._context;
    const success = await this._command("set_native_effect", {
      effect,
      color_mode: "normal",
      color,
    });
    if (success && context === this._context) {
      this._customColorDraft = [...color];
      this._selectedColorPresetId = null;
      this._selected = effect;
      this._page = 0;
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
        "No configured effect supports this colour on all selected lamps.";
      return;
    }
    const context = this._context;
    const success = await this._command("set_native_effect", {
      effect,
      color_mode: mode,
      ...(preset
        ? { color: [...preset.color] }
        : Object.hasOwn(this._attrs(), "native_effect_color")
          ? { color: "clear" }
          : {}),
    });
    if (success && context === this._context) {
      this._customColorDraft = null;
      this._selectedColorPresetId = preset?.id;
      this._selected = effect;
      this._page = 0;
    }
  }

  render() {
    if (!this._state)
      return html`<ha-card
        ><div class="body" role="status">
          Select an available Yeelight Cube lamp.
        </div></ha-card
      >`;
    const attrs = this._attrs();
    const effect = this._effect();
    const all = this._items();
    const searched = all.filter((item) =>
      item.name.toLowerCase().includes(this._query.toLowerCase().trim()),
    );
    // Only Original pages here. Live Preview list pages itself; its other
    // modes intentionally ignore items_per_page.
    const paginateOriginal = this._selectorStyle() === "original";
    const pagination = renderPagination({
      items: searched,
      currentPage: this._page,
      itemsPerPage: paginateOriginal ? selectorItemsPerPage(this.config) : 0,
    });
    this._totalPages = pagination.totalPages;
    // "Original" display only offers Grid and List now; legacy "buttons" and
    // "dropdown" configs fall back to Grid.
    const view = this.config.effect_view === "list" ? "list" : "grid";
    return html`<ha-card
      class=${this.config.show_card_background === false ? "transparent" : ""}
    >
      <div class="body">
        <header>
          <h2>${this.config.title || "Native Effects"}</h2>
          <span class="state-label"
            >${this._state.state === "on"
              ? attrs.content_mode
              : this._state.state}</span
          >
        </header>
        ${!Array.isArray(attrs.native_effect_catalog)
          ? html`<div role="alert" class="error">
              Native-effect catalogue unavailable. Reload the updated
              integration.
            </div>`
          : ""}
        ${this._error
          ? html`<div class="error" role="alert">${this._error}</div>`
          : ""}
        ${this.config.show_preview && effect
          ? html`<section class="current">
              <div class="current-heading">
                <h3>${effect.name}</h3>
                <span class="state-label"
                  >${attrs.content_mode === "Native Effect" &&
                  attrs.native_effect === effect.name &&
                  this._state.state === "on"
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
        ${this._sliders(effect)}
        <yeelight-mode-controls
          area="orientation"
          .model=${this._controls}
        ></yeelight-mode-controls>
        ${this.config.show_color_modes &&
        Object.hasOwn(attrs, "native_effect_color_mode")
          ? html`<section class="color-modes">
              <div class="color-mode-heading">Colour mode</div>
              <div class="unified-color-modes">
                ${unsafeHTML(
                  renderColorModeSelector(
                    this.config,
                    this._colorOptions(),
                    this._currentColorSelection(),
                    {
                      disabled:
                        this._busy || this._controls.busy || this._disabled(),
                      placeholder: this._customColorDraft
                        ? "Unsaved colour"
                        : "Current mode hidden",
                      draft: this._customColorDraft,
                    },
                  ),
                )}
              </div>
              ${this._customColorDraft &&
              this._supportsCustomColor() &&
              this.config.show_save_color_mode_button !== false
                ? html` <div class="clock-color-save" style="margin-top:10px;">
                    <yeelight-clock-preset-manager
                      .hass=${this._hass}
                      .compact=${true}
                      .saveKinds=${["color_mode"]}
                      .initialColor=${`#${this._customColorDraft.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`}
                      .buttonStyle=${this.config.buttons_style || "modern"}
                      .contentMode=${this.config.buttons_content_mode ||
                      "icon_text"}
                      @clock-preset-saved=${() => {
                        this._customColorDraft = null;
                      }}
                    ></yeelight-clock-preset-manager>
                  </div>`
                : ""}
            </section>`
          : ""}
        ${this.config.show_gallery
          ? html`<section class="browser">
              ${this.config.show_search
                ? html`<input
                    class="search"
                    type="search"
                    aria-label="Search native effects"
                    placeholder="Search effects"
                    .value=${this._query}
                    @input=${(event) => {
                      this._query = event.target.value;
                      this._page = 0;
                    }}
                  />`
                : ""}
              ${!searched.length
                ? html`<div class="empty" role="status">No effects match.</div>`
                : this._selectorStyle() !== "original"
                  ? html`<div
                      class="reference-selector"
                      ?inert=${this._disabled() || this._busy}
                    >
                      ${unsafeHTML(this._referenceSelector(searched))}
                    </div>`
                  : html`${unsafeHTML(
                      renderOriginalGallery(
                        pagination.items.map((item) => ({
                          dataMode: item.name,
                          title: item.name,
                          badge: this._effectBadge(item),
                          previewHtml: this._originalPreview(item),
                        })),
                        {
                          view,
                          showBadges: this.config.show_badges !== false,
                          highlight:
                            this.config.highlight_active_mode !== false,
                          current: effect?.name,
                        },
                      ),
                    )}
                    ${unsafeHTML(pagination.html)}`}
            </section>`
          : ""}
        <yeelight-mode-controls
          area="collections"
          .model=${this._controls}
        ></yeelight-mode-controls></div
    ></ha-card>`;
  }

  firstUpdated() {
    attachPaginationListeners(this.shadowRoot, (page) =>
      this._changePage(page),
    );
  }

  _changePage(page) {
    const current = Math.min(this._page, (this._totalPages || 1) - 1);
    const requested =
      page === "next"
        ? current + 1
        : page === "prev"
          ? current - 1
          : Number(page);
    this._page = Math.max(
      0,
      Math.min(
        Number.isFinite(requested) ? requested : 0,
        (this._totalPages || 1) - 1,
      ),
    );
  }

  updated() {
    this._controls.update();
    const colorModes = this.shadowRoot.querySelector(".color-modes");
    if (colorModes) {
      const apply = (value) => this._applyColorMode(value);
      bindActionButtonGroup(
        colorModes.querySelector(".shared-button-group"),
        apply,
      );
      const dropdown = colorModes.querySelector(".colormode-select");
      if (dropdown) dropdown.onchange = (event) => apply(event.target.value);
    }
    const effectSelect = this.shadowRoot.querySelector(
      'select[aria-label="Native effect"]',
    );
    if (effectSelect) effectSelect.value = this._effect()?.name || "";
    bindStyleSelectorEvents(this.shadowRoot, {
      select: (name) => {
        if (!this._busy && !this._disabled()) this._select(name);
      },
      navigate: (delta) => this._selectorNavigate(delta),
      setIndex: (index) => this._selectorNavigate(0, index),
      style: this._selectorStyle(),
    });
    bindOriginalGallery(this.shadowRoot, {
      select: (name) => {
        if (!this._busy && !this._disabled()) this._select(name);
      },
    });
    const wheelNode = this.shadowRoot.querySelector(
      '[data-wheel-scroll="true"]',
    );
    if (wheelNode !== this._wheelNode) {
      this._wheelController?.destroy();
      this._wheelController = null;
      this._wheelNode = wheelNode;
    }
    if (wheelNode && !this._wheelController)
      this._wheelController = initializeWheelNavigation({
        shadowRoot: this.shadowRoot,
        displayMode: "wheel",
        immediate: true,
        config: {
          ...this.config,
          wheel_display_style:
            this.config.preview_show_titles === false ? "compact" : "default",
        },
        getCurrentMode: () => this._effect()?.name,
        onModeSelect: async (name) => {
          if (!this._busy && !this._disabled()) this._select(name);
        },
      });
    else this._wheelController?.sync();
    this.dataset.highlightActive = String(
      this.config.highlight_active_mode !== false,
    );
    this.dataset.favStars = String(this.config.favourites_show_stars !== false);
    this.shadowRoot
      .querySelectorAll(".reference-selector [data-mode]")
      .forEach((node) => {
        node.toggleAttribute(
          "data-active-mode",
          this.config.highlight_active_mode !== false &&
            node.dataset.mode === this._effect()?.name,
        );
        if (node.hasAttribute("data-active-mode"))
          node.setAttribute("data-active-mode", "true");
      });
    markFavouriteModes(this.shadowRoot, this._controls.favourites);
    this._observer?.disconnect();
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
      visible: true,
      cells: [...node.querySelectorAll(".gallery-matrix-preview > div")],
    }));
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const frame = this._frames.find((item) => item.node === entry.target);
          if (frame) frame.visible = entry.isIntersecting;
        }
      });
      this._frames.forEach((frame) => this._observer.observe(frame.node));
    }
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
          : this._speedRaw(this._speedDraft),
    };
    const cache = new Map();
    const brightness =
      this.config.preview_brightness === true
        ? (this._brightnessDraft ?? ((attrs.brightness || 255) * 100) / 255) /
          100
        : 1;
    for (const frame of this._frames) {
      if (!frame.visible) continue;
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
    unsafeCSS(colorPickerStyles),
    unsafeCSS(actionButtonStyles),
    unsafeCSS(sliderControlStyles),
    unsafeCSS(styleSelectorStyles),
    unsafeCSS(paginationStyles),
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
      ha-card.transparent {
        background: transparent;
        border: none;
        box-shadow: none;
      }
      .body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      header,
      .current-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      h2 {
        font-size: 20px;
        font-weight: 500;
        margin: 0;
        overflow-wrap: anywhere;
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
      .current-heading {
        margin-bottom: 10px;
      }
      .current-matrix {
        width: 100%;
        max-width: 560px;
        margin: auto;
      }
      .effect-matrix {
        min-width: 0;
      }
      .search {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        border: 1px solid var(--divider-color, #ddd);
        border-radius: 6px;
        padding: 10px;
        font: inherit;
        color: inherit;
        background: var(--card-background-color, #fff);
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
      .brightness-control-group {
        gap: 6px;
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

customElements.define(
  "yeelight-cube-native-effects-card",
  YeelightCubeNativeEffectsCard,
);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "yeelight-cube-native-effects-card",
  name: "Yeelight Cube Native Effects",
  description: "Browse, preview and apply native effects.",
  preview: true,
});
