import { LitElement, html, css, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import {
  nativeEffectItems,
  nativeEffectFrame,
  nativeEffectAction,
  nativeEffectPreviewConfig,
  nextRotationEffect,
  rotationIntervalMs,
  effectCollectionKey,
  readEffectCollections,
  sanitizeEffectCollections,
} from "./native-effect-card-utils.js";
import { renderMatrixPreview } from "./gallery-display-utils.js";
import {
  renderTextStyleSelector,
  renderPreviewStyleSelector,
  bindStyleSelectorEvents,
  styleSelectorStyles,
} from "./style-selector-utils.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import { BLACK_THRESHOLD } from "./draw_card_const.js";
import { renderActionButton, renderActionRow } from "./action-button-ui.js";
import { actionButtonStyles } from "./action-button-utils.js";
import {
  renderOrderableList,
  orderableListStyles,
} from "./orderable-list-utils.js";
import {
  renderOrientationControls,
  orientationControlStyles,
  orientationOptions,
  nextOrientation,
} from "./orientation-control-utils.js";
import {
  renderSliderGroup,
  createSliderHandlers,
  sliderControlStyles,
  lightSliderConfig,
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
    _pendingOrientation: { state: true },
    _collections: { state: true },
    _manageFavourites: { state: true },
    _rotationActive: { state: true },
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
    this._loop = createRafLoop(
      (now) => {
        const delta = this._lastFrame
          ? Math.min(200, now - this._lastFrame)
          : 0;
        this._lastFrame = now;
        if (!this._paused && this._visibility?.onScreen) {
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
    if (!getTargetEntities(config).length)
      throw new Error("Select at least one Yeelight Cube light entity.");
    this._context++;
    this._stopRotation();
    this._manageFavourites = false;
    clearTimeout(this._orientationTimer);
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
      items_per_page: 8,
      ...config,
    };
    if (this.config.show_search === false) {
      this._query = "";
    }
    this._selected = null;
    this._pendingOrientation = null;
    this._page = 0;
    this._state = this._hass?.states[getTargetEntities(config)[0]];
    this._selectorIndex = undefined;
    this._collectionKey = effectCollectionKey(getTargetEntities(config));
    this._collections = readEffectCollections(undefined, this._collectionKey);
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config.show_rotation) this.requestUpdate();
    if (this._rotationActive && !this._rotationTargetsReady())
      this._stopRotation();
    const state = hass.states[getTargetEntities(this.config)[0]];
    if (
      this._orientationSettled &&
      this._pendingOrientation === state?.attributes.device_orientation
    ) {
      this._pendingOrientation = null;
      clearTimeout(this._orientationTimer);
    }
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
    this._onVisibilityChange ||= () => {
      if (document.hidden) this._stopRotation();
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    this._visibility = createVisibilityTracker(this);
    this._visibility.connect();
    this._loop.start();
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopRotation();
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    this._context++;
    clearTimeout(this._orientationTimer);
    this._busy = false;
    this._pendingCommands = 0;
    this._pendingOrientation = null;
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
    return nativeEffectItems(this._attrs(), this.config);
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
    return Math.round(1 + ((value - 1) * 254) / 99);
  }
  _sliderConfig(ns) {
    return lightSliderConfig(this.config, ns);
  }

  async _command(service, data, domain = "yeelight_cube") {
    if (this._disabled()) return false;
    if (!this._rotationApplying) this._stopRotation();
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

  async _apply(name = this._effect()?.name) {
    if (!name || /^\d+$/.test(name.trim())) return;
    const context = this._context;
    this._selected = name;
    const action = nativeEffectAction(name);
    if (this._speedDraft != null && this._effect()?.speed)
      action.speed = this._speedRaw(this._speedDraft);
    if (
      (await this._command("set_native_effect", action)) &&
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

  _stepEffect(delta) {
    const items = this._items();
    if (!items.length) return;
    const index = items.findIndex((item) => item.name === this._effect()?.name);
    this._select(
      items[(Math.max(0, index) + delta + items.length) % items.length].name,
    );
  }

  async handleOrientationControl(event) {
    const button = event.target.closest("button[data-value]");
    if (!button || button.disabled) return;
    const current =
      this._pendingOrientation || this._attrs().device_orientation || "right";
    const step = { clockwise: 1, counterclockwise: -1, "half-turn": 2 }[
      button.dataset.value
    ];
    const target = step
      ? nextOrientation(
          current,
          step,
          orientationOptions(this.config).directions,
        )
      : button.dataset.value;
    if (!target || target === current) return;
    this._stopRotation();
    const context = this._context;
    const sequence = (this._orientationSequence =
      (this._orientationSequence || 0) + 1);
    clearTimeout(this._orientationTimer);
    this._orientationSettled = false;
    this._pendingOrientation = target;
    const success = await this._command("set_device_orientation", {
      orientation: target,
    });
    if (context !== this._context || sequence !== this._orientationSequence)
      return;
    this._orientationSettled = true;
    if (!success || this._attrs().device_orientation === target)
      this._pendingOrientation = null;
    else
      this._orientationTimer = setTimeout(() => {
        this._pendingOrientation = null;
        this._error = "Orientation was not confirmed. Try again.";
      }, 8000);
  }

  _button(label, icon, onClick, extra = {}) {
    return renderActionButton({
      label,
      icon,
      onClick,
      action: "tool",
      buttonStyle: this.config.buttons_style || "classic",
      contentMode: this.config.buttons_content_mode || "icon",
      disabled: this._disabled(),
      ...extra,
    });
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
    const config = nativeEffectPreviewConfig(this.config);
    const prefix = current ? "lamp" : "effect";
    const background = config[`${prefix}_matrix_background`] || "black";
    const spacing = config[`${prefix}_spacing_mode`];
    return {
      width: Math.max(
        30,
        Math.min(100, Number(config[`${prefix}_preview_size`]) || 100),
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
        gc: this._sliderConfig("brightness"),
        value:
          this._brightnessDraft ??
          Math.max(1, Math.round(((attrs.brightness || 3) * 100) / 255)),
      });
    if (this.config.show_animation_speed && effect?.speed)
      controls.push({
        label: "Animation speed",
        ns: "speed",
        gc: this._sliderConfig("speed"),
        value:
          this._speedDraft ??
          Math.round(1 + (((attrs.native_effect_speed || 50) - 1) * 99) / 254),
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

  _saveCollections(collections) {
    this._collections = sanitizeEffectCollections(collections);
    try {
      globalThis.localStorage.setItem(
        this._collectionKey,
        JSON.stringify(this._collections),
      );
    } catch {
      this._error =
        "Browser storage is unavailable; this collection will last for this session only.";
    }
  }

  _toggleFavourite(name = this._effect()?.name) {
    if (!name || /^\d+$/.test(name)) return;
    const favourites = this._collections.favourites.includes(name)
      ? this._collections.favourites.filter((value) => value !== name)
      : [...this._collections.favourites, name];
    this._saveCollections({ ...this._collections, favourites });
  }

  _favouritesSection() {
    const names = this._collections.favourites;
    const available = nativeEffectItems(this._attrs(), {
      show_experimental: this.config.show_experimental,
    });
    const playable = names.filter((name) =>
      available.some((item) => item.name === name),
    );
    return html`<section class="effect-collection">
      <div class="current-heading">
        <h3>Favourites <span class="state-label">${names.length}</span></h3>
        <div class="section-tools">
          ${this._button(
            "Shuffle favourite",
            "mdi:shuffle-variant",
            () => {
              this._select(
                nextRotationEffect(playable, this._effect()?.name, true),
              );
            },
            {
              contentMode: "icon",
              disabled: this._disabled() || this._busy || playable.length < 2,
            },
          )}
          ${this._button(
            this._manageFavourites ? "Done" : "Manage favourites",
            "mdi:playlist-edit",
            () => {
              this._manageFavourites = !this._manageFavourites;
            },
            {
              contentMode: "icon",
              selected: this._manageFavourites,
              disabled: false,
            },
          )}
          ${this._button(
            this._collections.favourites.includes(this._effect()?.name)
              ? "Remove favourite"
              : "Add favourite",
            this._collections.favourites.includes(this._effect()?.name)
              ? "mdi:star"
              : "mdi:star-outline",
            () => this._toggleFavourite(),
            { contentMode: "icon", disabled: !this._effect() },
          )}
        </div>
      </div>
      ${this._manageFavourites
        ? renderOrderableList({
            items: names,
            available: available
              .map((item) => item.name)
              .filter((name) => !names.includes(name)),
            onUpdate: (favourites) =>
              this._saveCollections({ ...this._collections, favourites }),
            addPlaceholder: "Add favourite",
          })
        : ""}
      ${names.length
        ? this.config.favourites_show_previews !== false
          ? html`<div class="effects favourite-effects">
              ${names.map((name) => {
                const effect = available.find((item) => item.name === name);
                return html`<button
                  class="effect"
                  type="button"
                  aria-label=${name}
                  aria-pressed=${String(name === this._effect()?.name)}
                  ?disabled=${!effect || this._disabled() || this._busy}
                  @click=${() => this._select(name)}
                >
                  ${effect ? this._matrix(effect) : ""}<span class="effect-name"
                    >${name}</span
                  >
                  ${!effect
                    ? html`<span class="state-label">Unavailable</span>`
                    : ""}
                </button>`;
              })}
            </div>`
          : renderActionRow(
              html`${names.map((name) =>
                this._button(name, "mdi:creation", () => this._select(name), {
                  buttonStyle:
                    this.config.collection_buttons_style || "classic",
                  contentMode:
                    this.config.collection_buttons_content_mode || "icon_text",
                  selected: name === this._effect()?.name,
                  disabled:
                    this._disabled() || this._busy || !playable.includes(name),
                }),
              )}`,
            )
        : html`<div class="state-label">No favourites yet.</div>`}
    </section>`;
  }

  _effectAvailable(effect) {
    return getTargetEntities(this.config).every((entity) => {
      const state = this._hass?.states[entity];
      return (
        state &&
        !["unknown", "unavailable"].includes(state.state) &&
        nativeEffectItems(state.attributes, {
          show_experimental: this.config.show_experimental,
        }).some((item) => item.name === effect)
      );
    });
  }

  _rotationNames() {
    const names =
      this.config.rotation_source === "custom"
        ? this.config.rotation_effects || []
        : this._collections.favourites;
    return [...new Set(names)].filter((effect) =>
      this._effectAvailable(effect),
    );
  }

  _rotationTargetsReady() {
    return getTargetEntities(this.config).every(
      (entity) => this._hass?.states[entity]?.state === "on",
    );
  }

  _stopRotation() {
    clearTimeout(this._rotationTimer);
    this._rotationActive = false;
    this._rotationToken = (this._rotationToken || 0) + 1;
  }

  _startRotation() {
    if (
      this._busy ||
      !this._rotationTargetsReady() ||
      this._rotationNames().length < 2 ||
      document.hidden
    )
      return;
    this._stopRotation();
    this._rotationActive = true;
    this._rotateNext(this._rotationToken);
  }

  async _rotateNext(token) {
    if (!this._rotationActive || token !== this._rotationToken) return;
    const names = this._rotationNames();
    if (!this._rotationTargetsReady() || names.length < 2 || document.hidden) {
      this._stopRotation();
      return;
    }
    this._rotationApplying = true;
    let success;
    try {
      success = await this._apply(
        nextRotationEffect(
          names,
          this._effect()?.name,
          this.config.rotation_shuffle === true,
        ),
      );
    } finally {
      this._rotationApplying = false;
    }
    if (!this._rotationActive || token !== this._rotationToken) return;
    if (!success) {
      this._stopRotation();
      return;
    }
    this._rotationTimer = setTimeout(
      () => this._rotateNext(token),
      rotationIntervalMs(this.config),
    );
  }

  _rotationSection() {
    const names = this._rotationNames();
    return html`<section class="effect-rotation">
      <div class="current-heading">
        <h3>Effect Rotation</h3>
        <span class="state-label" role="status"
          >${this._rotationActive ? "Running" : "Stopped"}</span
        >
      </div>
      <div class="rotation-summary">
        <span
          >${names.length} effects · ${rotationIntervalMs(this.config) / 1000}s
          · ${this.config.rotation_shuffle ? "Shuffle" : "In order"}</span
        >
        <div class="section-tools">
          ${this._button(
            this._rotationActive ? "Stop rotation" : "Start rotation",
            this._rotationActive ? "mdi:stop" : "mdi:play",
            () => {
              if (this._rotationActive) this._stopRotation();
              else this._startRotation();
            },
            {
              contentMode: "icon",
              disabled:
                !this._rotationActive &&
                (this._busy ||
                  names.length < 2 ||
                  !this._rotationTargetsReady()),
            },
          )}
          ${this._button(
            "Skip effect",
            "mdi:skip-next",
            () => {
              clearTimeout(this._rotationTimer);
              this._rotateNext(this._rotationToken);
            },
            {
              contentMode: "icon",
              disabled: !this._rotationActive || this._busy,
            },
          )}
        </div>
      </div>
      <div class="state-label">
        ${names.join(" · ") || "No effects selected."}
      </div>
    </section>`;
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
      swatch: `rgb(${nativeEffectFrame(item, this._attrs(), 0)[50].join(",")})`,
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
    const items = searched;
    const pagination = renderPagination({
      items,
      currentPage: this._page,
      itemsPerPage: Math.max(0, Number(this.config.items_per_page) || 0),
    });
    this._totalPages = pagination.totalPages;
    const view = ["list", "buttons", "dropdown"].includes(
      this.config.effect_view,
    )
      ? this.config.effect_view
      : "grid";
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
        ${this.config.show_actions
          ? renderActionRow(
              html`
                ${this._button(
                  "Previous effect",
                  "mdi:chevron-left",
                  () => this._stepEffect(-1),
                  { disabled: this._busy || !all.length },
                )}
                ${this._button("Apply", "mdi:play", () => this._apply(), {
                  busy: this._busy,
                  disabled: !effect || this._disabled(),
                })}
                ${this._button(
                  "Next effect",
                  "mdi:chevron-right",
                  () => this._stepEffect(1),
                  { disabled: this._busy || !all.length },
                )}
                ${this._button(
                  this._paused ? "Resume previews" : "Pause previews",
                  this._paused ? "mdi:motion-play-outline" : "mdi:pause",
                  () => {
                    this._paused = !this._paused;
                  },
                  { disabled: false },
                )}
                ${this._button(
                  this._state.state === "on" ? "Turn off" : "Turn on",
                  "mdi:power",
                  () =>
                    this._command(
                      this._state.state === "on" ? "turn_off" : "turn_on",
                      {},
                      "light",
                    ),
                  { disabled: this._disabled() || this._busy },
                )}
              `,
              { contentMode: this.config.buttons_content_mode || "icon" },
            )
          : ""}
        ${this._sliders(effect)}
        ${unsafeHTML(
          renderOrientationControls(
            this.config,
            this._pendingOrientation || attrs.device_orientation || "right",
            this._disabled(),
          ),
        )}
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
              ${!items.length
                ? html`<div class="empty" role="status">No effects match.</div>`
                : this._selectorStyle() !== "original"
                  ? html`<div
                      class="reference-selector"
                      ?inert=${this._disabled() || this._busy}
                    >
                      ${unsafeHTML(this._referenceSelector(items))}
                    </div>`
                  : view === "dropdown"
                    ? html` <select
                        class="search"
                        aria-label="Native effect"
                        @change=${(event) => this._select(event.target.value)}
                        ?disabled=${this._busy || this._disabled()}
                      >
                        ${items.map(
                          (item) =>
                            html`<option value=${item.name}>
                              ${item.name}
                            </option>`,
                        )}
                      </select>`
                    : html`<div class="effects ${view}">
                          ${pagination.items.map((item) =>
                            view === "buttons"
                              ? this._button(
                                  item.name,
                                  "mdi:creation",
                                  () => this._select(item.name),
                                  {
                                    selected: item.name === effect?.name,
                                    buttonStyle:
                                      this.config.effect_buttons_style ||
                                      this.config.buttons_style ||
                                      "classic",
                                    contentMode:
                                      this.config.effect_buttons_content_mode ||
                                      "icon_text",
                                    disabled: this._busy || this._disabled(),
                                  },
                                )
                              : html` <button
                                  class="effect"
                                  type="button"
                                  aria-label=${item.name}
                                  aria-pressed=${String(
                                    item.name === effect?.name,
                                  )}
                                  ?disabled=${this._busy || this._disabled()}
                                  @click=${() => this._select(item.name)}
                                >
                                  ${this._matrix(item)}<span class="effect-name"
                                    >${item.name}</span
                                  >
                                  ${this.config.show_badges !== false
                                    ? html`<span class="capabilities"
                                        >${item.extended
                                          ? "Experimental"
                                          : "Official"}${item.directions?.length
                                          ? " · Directional"
                                          : ""}</span
                                      >`
                                    : ""}
                                </button>`,
                          )}
                        </div>
                        ${unsafeHTML(pagination.html)}`}
            </section>`
          : ""}
        ${this.config.show_favourites ? this._favouritesSection() : ""}
        ${this.config.show_rotation ? this._rotationSection() : ""}
      </div></ha-card
    >`;
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
    this._observer?.disconnect();
    this._frames = [
      ...this.shadowRoot.querySelectorAll(
        ".effect-matrix, .reference-selector [data-mode]",
      ),
    ].map((node) => ({
      node,
      name: node.dataset.effect || node.dataset.mode,
      appearance: node.dataset.mode
        ? {
            ignoreBlackPixels:
              (this.config.gallery_background_color || "black") !== "black" &&
              this.config.gallery_ignore_black_pixels === true,
            pixelBoxShadow:
              (this.config.gallery_spacing_mode || "normal") !== "none",
          }
        : this._matrixAppearance(node.classList.contains("current-matrix")),
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
        this._pendingOrientation || this._attrs().device_orientation,
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
    orderableListStyles,
    unsafeCSS(actionButtonStyles),
    unsafeCSS(orientationControlStyles),
    unsafeCSS(sliderControlStyles),
    unsafeCSS(styleSelectorStyles),
    unsafeCSS(paginationStyles),
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
      .state-label,
      .capabilities {
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
      .effects {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
      }
      .effects.list {
        grid-template-columns: 1fr;
      }
      .effects.buttons {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
      }
      .effect {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding: 10px;
        border: 1px solid var(--divider-color, #ddd);
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
      }
      .effect .effect-matrix {
        width: 100%;
      }
      .effect[aria-pressed="true"] {
        border-color: var(--primary-color, #00897b);
        box-shadow: inset 0 0 0 1px var(--primary-color, #00897b);
      }
      .effect-name {
        font-size: 14px;
        overflow-wrap: anywhere;
      }
      .effect:disabled {
        opacity: 0.6;
        cursor: default;
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
