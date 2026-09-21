import { LitElement, html, css, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import {
  renderActionButton,
  renderActionRow,
  renderActionButtonSettings,
} from "./action-button-ui.js";
import {
  actionButtonStyles,
  modeActionOptions,
} from "./action-button-utils.js";
import {
  renderOrientationControls,
  orientationControlStyles,
  orientationOptions,
  nextOrientation,
} from "./orientation-control-utils.js";
import { renderOrientationSettings } from "./orientation-control-ui.js";
import {
  renderOrderableList,
  orderableListStyles,
} from "./orderable-list-utils.js";
import { renderMatrixPreview } from "./gallery-display-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { createButtonGroup } from "./button-group-utils.js";
import {
  renderModeSettingsSection,
  renderMatrixAppearanceSettings,
} from "./editor_ui_utils.js";
import {
  nextRotationMode,
  rotationIntervalMs,
  actionButtonOrder,
  ACTION_BUTTON_KEYS,
  ACTION_BUTTON_LABELS,
} from "./mode-controls-controller.js";

export function renderColorModeSettings(config, change) {
  const choices = (label, key, values, fallback) =>
    html`<div class="form-row">
      <label>${label}</label>${createButtonGroup(
        values.map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        })),
        config[key] || fallback,
        (event) => change(key, event.currentTarget.dataset.value),
      )}
    </div>`;
  return html`${choices(
      "Presentation",
      "color_mode_selector",
      ["buttons", "dropdown"],
      "buttons",
    )}${config.color_mode_selector === "dropdown"
      ? choices(
          "Item Shape",
          "color_mode_shape",
          ["square", "rounded", "round"],
          "rounded",
        )
      : ""}
    <div class="form-row">
      <label>Custom colour modes style</label>
      ${createButtonGroup(
        [
          { value: "label", label: "Swatch + name" },
          { value: "filled", label: "Filled" },
          { value: "name", label: "Name only" },
        ],
        config.color_preset_style === "swatch"
          ? "filled"
          : ["label", "filled", "name"].includes(config.color_preset_style)
            ? config.color_preset_style
            : "label",
        (event) =>
          change("color_preset_style", event.currentTarget.dataset.value),
      )}
    </div>
    ${["filled", "swatch", "name"].includes(config.color_preset_style)
      ? ""
      : choices(
          "Swatch shape",
          "color_preset_shape",
          ["square", "rounded", "circle"],
          "rounded",
        )}`;
}

export function renderModeControlSettings(
  area,
  config,
  change,
  items = [],
  noun = "effect",
) {
  const toggle = (label, key, fallback = true) =>
    createToggleRow(label, key, config[key] ?? fallback, (event) =>
      change(key, event.target.checked),
    );
  if (area === "actions")
    return html`${toggle(
      "Show Actions",
      "show_actions",
    )}${config.show_actions !== false
      ? html`${renderModeSettingsSection(
          "Button Settings",
          renderActionButtonSettings(config, change, {
            styleKey: "actions_buttons_style",
            contentKey: "actions_buttons_content_mode",
            defaultStyle: modeActionOptions(config).buttonStyle,
            defaultContentMode: modeActionOptions(config).contentMode,
          }),
        )}${renderModeSettingsSection(
          "Actions & Order",
          renderOrderableList({
            items: actionButtonOrder(config),
            available: ACTION_BUTTON_KEYS.filter(
              (key) => !actionButtonOrder(config).includes(key),
            ),
            labelFor: (key) => ACTION_BUTTON_LABELS[key] || key,
            onUpdate: (keys) => change("action_buttons", keys),
            onReset: () => change("action_buttons", undefined),
            addPlaceholder: "Add action",
            resetLabel: "Reset to all actions",
          }),
        )}`
      : ""}`;
  if (area === "orientation")
    return html`${toggle(
      "Show Device Orientation",
      "show_device_orientation",
    )}${config.show_device_orientation !== false
      ? renderModeSettingsSection(
          "Orientation Settings",
          renderOrientationSettings(config, change),
        )
      : ""}`;
  if (area === "favourites")
    return html`${toggle(
      "Show Favourites",
      "show_favourites",
      false,
    )}${config.show_favourites
      ? renderModeSettingsSection(
          "Favourite Controls",
          html`
            ${toggle("Animated Previews", "favourites_show_previews")}
            ${config.favourites_show_previews === false
              ? renderActionButtonSettings(config, change, {
                  styleKey: "collection_buttons_style",
                  contentKey: "collection_buttons_content_mode",
                  defaultStyle: "classic",
                  defaultContentMode: "icon_text",
                })
              : renderMatrixAppearanceSettings(config, change, {
                  prefix: "effect",
                  defaultSize: 100,
                })}
          `,
        )
      : ""}`;
  const key = noun === "effect" ? "rotation_effects" : "rotation_modes";
  const selected = Array.isArray(config[key]) ? config[key] : [];
  return html`${toggle(
    `Show ${noun === "effect" ? "Effect" : "Clock Mode"} Rotation`,
    "show_rotation",
    false,
  )}${config.show_rotation
    ? renderModeSettingsSection(
        "Rotation Settings",
        html`
          <div class="form-row">
            <label>Source</label>${createButtonGroup(
              [
                { value: "favourites", label: "Favourites" },
                { value: "custom", label: "Custom List" },
              ],
              config.rotation_source || "favourites",
              (event) =>
                change("rotation_source", event.currentTarget.dataset.value),
            )}
          </div>
          ${config.rotation_source === "custom"
            ? renderOrderableList({
                items: selected,
                available: items
                  .map((item) => item.key)
                  .filter((name) => !selected.includes(name)),
                labelFor: (name) =>
                  items.find((item) => item.key === name)?.title || name,
                onUpdate: (names) => change(key, names),
                addPlaceholder: `Add ${noun} to rotation`,
              })
            : ""}
          ${createSliderRow(
            "Interval",
            config.rotation_interval ?? 60,
            { min: 10, max: 3600, step: 10 },
            (event) => change("rotation_interval", Number(event.target.value)),
            "s",
          )}
          ${toggle("Shuffle (No Immediate Repeats)", "rotation_shuffle", false)}
        `,
      )
    : ""}`;
}

class YeelightModeControls extends LitElement {
  static properties = {
    model: { attribute: false },
    area: { reflect: true },
    _manage: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this._refresh ||= () => this.requestUpdate();
    this._visibility ||= () => {
      if (document.hidden) this.model?.stop();
    };
    document.addEventListener("visibilitychange", this._visibility);
    this._subscribe();
    this._animate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._subscribed?.listeners.delete(this._refresh);
    this._subscribed = null;
    document.removeEventListener("visibilitychange", this._visibility);
    cancelAnimationFrame(this._frame);
  }

  _subscribe() {
    if (this.model === this._subscribed) return;
    this._subscribed?.listeners.delete(this._refresh);
    this._subscribed = this.model;
    this._subscribed?.listeners.add(this._refresh);
  }

  updated() {
    this._subscribe();
  }

  _animate() {
    cancelAnimationFrame(this._frame);
    const paint = (now) => {
      if (
        this.area === "collections" &&
        !document.hidden &&
        !this.model?.paused &&
        now - (this._lastPaint || 0) > 100
      ) {
        const bounds = this.getBoundingClientRect();
        if (bounds.bottom >= 0 && bounds.top <= innerHeight) {
          this._lastPaint = now;
          this.shadowRoot.querySelectorAll("[data-preview]").forEach((node) => {
            const pixels = this.model.adapter.frame(
              node.dataset.preview,
              now / 1000,
            );
            node
              .querySelectorAll(".gallery-matrix-preview > div")
              .forEach((cell, index) => {
                const rgb = pixels?.[index] || [0, 0, 0];
                const off = !rgb.some(Boolean);
                cell.style.background =
                  off &&
                  this.model.config.effect_ignore_black_pixels &&
                  this.model.config.effect_matrix_background !== "black"
                    ? "transparent"
                    : `rgb(${rgb.join(",")})`;
              });
          });
        }
      }
      this._frame = requestAnimationFrame(paint);
    };
    this._frame = requestAnimationFrame(paint);
  }

  _button(label, icon, onClick, options = {}) {
    const model = this.model;
    return renderActionButton({
      label,
      icon,
      onClick,
      action: "tool",
      buttonStyle: model.config.buttons_style || "classic",
      contentMode: model.config.buttons_content_mode || "icon",
      ...(this.area === "actions" ? modeActionOptions(model.config) : {}),
      disabled: model.busy || model.adapter.disabled(),
      ...options,
    });
  }

  handleOrientationControl(event) {
    const button = event.target.closest("button[data-value]");
    if (!button || button.disabled) return;
    const model = this.model;
    const step = { clockwise: 1, counterclockwise: -1, "half-turn": 2 }[
      button.dataset.value
    ];
    const target = step
      ? nextOrientation(
          model.pendingOrientation || model.adapter.orientation(),
          step,
          orientationOptions(model.config).directions,
        )
      : button.dataset.value;
    model.orient(target);
  }

  _preview(item) {
    const config = this.model.config;
    const pixels = this.model.adapter.frame(item.key, 0);
    if (!pixels) return html`<span class="muted">Preview unavailable</span>`;
    const background = config.effect_matrix_background || "black";
    return html`<div
      data-preview=${item.key}
      style=${`width:${Math.max(30, Math.min(100, Number(config.effect_preview_size) || 100))}%;margin:auto;`}
    >
      ${unsafeHTML(
        renderMatrixPreview(pixels, {
          forceAspectRatio: true,
          pixelStyle: config.effect_pixel_style || "square",
          pixelGap:
            (config.effect_spacing_mode || "normal") === "normal" ? 3 : 0,
          pixelBoxShadow: config.effect_spacing_mode !== "none",
          matrixBoxShadow: config.effect_matrix_box_shadow === true,
          bgColor:
            background === "white"
              ? "#fff"
              : background === "transparent"
                ? "transparent"
                : "#000",
          ignoreBlackPixels:
            background !== "black" &&
            config.effect_ignore_black_pixels === true,
        }),
      )}
    </div>`;
  }

  render() {
    const model = this.model;
    if (!model?.config) return "";
    const { adapter, config } = model;
    const items =
      this.area === "actions" && adapter.navigationItems
        ? adapter.navigationItems()
        : adapter.items();
    const current = adapter.current();
    const title = (key) => items.find((item) => item.key === key)?.title || key;
    const noun = adapter.kind === "clock" ? "clock mode" : "effect";
    if (this.area === "actions") {
      const buttons = {
        previous: () =>
          this._button(
            `Previous ${noun}`,
            "mdi:chevron-left",
            () =>
              model.choose(
                items[
                  (Math.max(
                    0,
                    items.findIndex((item) => item.key === current),
                  ) -
                    1 +
                    items.length) %
                    items.length
                ]?.key,
              ),
            {
              disabled: model.busy || adapter.disabled() || !items.length,
            },
          ),
        apply: () =>
          this._button("Apply", "mdi:play", () => model.select(current), {
            busy: model.busy,
            disabled: model.busy || adapter.disabled() || !current,
          }),
        next: () =>
          this._button(
            `Next ${noun}`,
            "mdi:chevron-right",
            () =>
              model.choose(
                nextRotationMode(
                  items.map((item) => item.key),
                  current,
                ),
              ),
            {
              disabled: model.busy || adapter.disabled() || !items.length,
            },
          ),
        pause_previews: () =>
          this._button(
            model.paused ? "Resume previews" : "Pause previews",
            model.paused ? "mdi:motion-play-outline" : "mdi:pause",
            () => {
              model.paused = !model.paused;
              adapter.pause(model.paused);
              model.notify();
            },
            { disabled: false },
          ),
        freeze: () =>
          this._button(
            model.frozen ? "Resume effect" : "Freeze effect",
            model.frozen ? "mdi:play-circle-outline" : "mdi:snowflake",
            () => model.freeze(),
            {
              selected: model.frozen,
              disabled:
                model.busy ||
                adapter.disabled() ||
                (!model.frozen && !model.freezable()),
            },
          ),
        power: () =>
          this._button(adapter.on() ? "Turn off" : "Turn on", "mdi:power", () =>
            model.command(() =>
              adapter.command(
                adapter.on() ? "turn_off" : "turn_on",
                {},
                "light",
              ),
            ),
          ),
      };
      return html` ${config.show_actions !== false
        ? renderActionRow(
            html`${actionButtonOrder(config).map((key) => buttons[key]?.())}`,
            modeActionOptions(config),
          )
        : ""}
      ${model.error
        ? html`<div class="error" role="alert">${model.error}</div>`
        : ""}`;
    }
    if (this.area === "orientation")
      return unsafeHTML(
        renderOrientationControls(
          config,
          model.pendingOrientation || adapter.orientation(),
          model.busy || adapter.disabled(),
        ),
      );
    const playable = model.favourites.filter((name) => adapter.available(name));
    const names = model.names();
    return html` ${config.show_favourites
      ? html`<section>
          <header>
            <h3>Favourites <small>${model.favourites.length}</small></h3>
            <div class="tools">
              ${this._button(
                "Shuffle favourite",
                "mdi:shuffle-variant",
                () => model.choose(nextRotationMode(playable, current, true)),
                {
                  contentMode: "icon",
                  disabled:
                    model.busy || adapter.disabled() || playable.length < 2,
                },
              )}
              ${this._button(
                this._manage ? "Done" : "Manage favourites",
                "mdi:playlist-edit",
                () => {
                  this._manage = !this._manage;
                },
                {
                  contentMode: "icon",
                  selected: this._manage,
                  disabled: false,
                },
              )}
              ${this._button(
                model.favourites.includes(current)
                  ? "Remove favourite"
                  : "Add favourite",
                model.favourites.includes(current)
                  ? "mdi:star"
                  : "mdi:star-outline",
                () => model.toggleFavourite(),
                { contentMode: "icon", disabled: !current },
              )}
            </div>
          </header>
          ${this._manage
            ? renderOrderableList({
                items: model.favourites,
                available: items
                  .map((item) => item.key)
                  .filter((key) => !model.favourites.includes(key)),
                labelFor: title,
                onUpdate: (names) => model.save(names),
                addPlaceholder: "Add favourite",
              })
            : ""}
          ${!model.favourites.length
            ? html`<div class="muted">No favourites yet.</div>`
            : config.favourites_show_previews !== false
              ? html`<div class="favourites">
                  ${model.favourites.map(
                    (key) =>
                      html` <button
                        type="button"
                        class="mode"
                        aria-label=${title(key)}
                        aria-pressed=${String(key === current)}
                        ?disabled=${model.busy ||
                        adapter.disabled() ||
                        !playable.includes(key)}
                        @click=${() => model.choose(key)}
                      >
                        ${items.some((item) => item.key === key)
                          ? this._preview({ key })
                          : ""}<span>${title(key)}</span>${!playable.includes(
                          key,
                        )
                          ? html`<small>Unavailable</small>`
                          : ""}
                      </button>`,
                  )}
                </div>`
              : renderActionRow(
                  html`${model.favourites.map((key) =>
                    this._button(
                      title(key),
                      adapter.kind === "clock"
                        ? "mdi:clock-outline"
                        : "mdi:creation",
                      () => model.choose(key),
                      {
                        buttonStyle:
                          config.collection_buttons_style || "classic",
                        contentMode:
                          config.collection_buttons_content_mode || "icon_text",
                        selected: key === current,
                        disabled:
                          model.busy ||
                          adapter.disabled() ||
                          !playable.includes(key),
                      },
                    ),
                  )}`,
                  {
                    buttonStyle: config.collection_buttons_style || "classic",
                    contentMode:
                      config.collection_buttons_content_mode || "icon_text",
                  },
                )}
        </section>`
      : ""}
    ${config.show_rotation
      ? html`<section>
          <header>
            <h3>
              ${adapter.kind === "clock"
                ? "Clock Mode Rotation"
                : "Effect Rotation"}
            </h3>
            <span class="muted" role="status"
              >${model.active ? "Running" : "Stopped"}</span
            >
          </header>
          <div class="summary">
            <span
              >${names.length} ${noun}s / ${rotationIntervalMs(config) / 1000}s
              / ${config.rotation_shuffle ? "Shuffle" : "In order"}</span
            >
            <div class="tools">
              ${this._button(
                model.active ? "Stop rotation" : "Start rotation",
                model.active ? "mdi:stop" : "mdi:play",
                () => (model.active ? model.stop() : model.start()),
                {
                  contentMode: "icon",
                  disabled:
                    !model.active &&
                    (model.busy || !model.ready() || names.length < 2),
                },
              )}
              ${this._button(
                `Skip ${noun}`,
                "mdi:skip-next",
                () => model.skip(),
                {
                  contentMode: "icon",
                  disabled: !model.active || model.busy,
                },
              )}
            </div>
          </div>
          <div class="muted">
            ${names.map(title).join(" / ") || `No ${noun}s selected.`}
          </div>
        </section>`
      : ""}`;
  }

  static styles = [
    unsafeCSS(actionButtonStyles),
    unsafeCSS(orientationControlStyles),
    orderableListStyles,
    css`
      :host {
        display: block;
        --action-row-icon-align: center;
        min-width: 0;
      }
      section {
        padding: 12px 0;
        border-top: 1px solid var(--divider-color, #ddd);
      }
      header,
      .summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }
      .tools {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .favourites {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .mode {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--divider-color, #ddd);
        border-radius: 8px;
        color: var(--primary-text-color);
        background: var(--card-background-color);
        cursor: pointer;
      }
      .mode[aria-pressed="true"] {
        border-color: var(--primary-color);
      }
      .mode:disabled {
        opacity: 0.45;
        cursor: default;
      }
      span,
      small,
      .muted {
        overflow-wrap: anywhere;
      }
      .muted,
      small {
        color: var(--secondary-text-color);
        font-size: 12px;
      }
      .error {
        color: var(--error-color, #db4437);
        padding: 8px 0;
      }
    `,
  ];
}

customElements.define("yeelight-mode-controls", YeelightModeControls);
