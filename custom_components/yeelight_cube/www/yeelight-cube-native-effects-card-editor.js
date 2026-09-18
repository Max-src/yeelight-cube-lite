import { LitElement, html } from "./lib/lit-all.js";
import {
  sharedEditorStyles,
  renderEditorSection,
  renderModeSettingsSection,
  renderMatrixAppearanceSettings,
  fireEvent,
} from "./editor_ui_utils.js";
import {
  createYeelightCubeEntityPicker,
  entitySelectorStyles,
} from "./entity-selector-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { createButtonGroup, buttonGroupStyles } from "./button-group-utils.js";
import {
  renderOrderableList,
  orderableListStyles,
} from "./orderable-list-utils.js";
import { renderActionButtonSettings } from "./action-button-ui.js";
import { renderOrientationSettings } from "./orientation-control-ui.js";
import { getTargetEntities } from "./service-call-utils.js";
import {
  nativeEffectItems,
  nativeEffectPreviewConfig,
} from "./native-effect-card-utils.js";
import { renderLightSliderSettings } from "./slider-control-utils.js";
import { renderStyleSelectorSettings } from "./style-selector-ui.js";

class YeelightCubeNativeEffectsCardEditor extends LitElement {
  static properties = {
    _config: { state: true },
    hass: { attribute: false },
    _open: { state: true },
  };
  constructor() {
    super();
    this._open = { general: true };
  }
  setConfig(config) {
    this._config = { ...config };
  }
  _change(key, value) {
    this._config = { ...this._config, [key]: value };
    if (key === "orientation_buttons") {
      delete this._config.orientation_layout;
      delete this._config.orientation_half_turn;
      delete this._config.orientation_directions;
    }
    fireEvent(this, "config-changed", { config: this._config });
  }
  _section(id, title, content) {
    return renderEditorSection(
      id,
      title,
      !!this._open[id],
      () => {
        this._open = { ...this._open, [id]: !this._open[id] };
      },
      content,
    );
  }
  _toggle(label, key, fallback = true) {
    return createToggleRow(label, key, this._config[key] ?? fallback, (event) =>
      this._change(key, event.target.checked),
    );
  }
  _choices(label, key, choices, fallback) {
    return html`<div class="form-row">
      <label>${label}</label>${createButtonGroup(
        choices,
        this._config[key] || fallback,
        (event) => this._change(key, event.currentTarget.dataset.value),
      )}
    </div>`;
  }
  render() {
    if (!this._config) return "";
    const config = this._config;
    const targets = getTargetEntities(config);
    const attrs = this.hass?.states[targets[0]]?.attributes || {};
    const effects = nativeEffectItems(attrs, {
      ...config,
      visible_effects: undefined,
    });
    const names = effects.map((item) => item.name);
    const visible = Array.isArray(config.visible_effects)
      ? [...new Set(config.visible_effects)].filter((name) =>
          names.includes(name),
        )
      : names;
    const change = (key, value) => this._change(key, value);
    return html`<div class="editor-root">
      ${this._section(
        "general",
        "Global Settings",
        html`
          <div class="form-row">
            <label>Card Title (optional)</label
            ><input
              type="text"
              aria-label="Title"
              .value=${config.title || ""}
              @change=${(event) => this._change("title", event.target.value)}
            />
          </div>
          <div class="form-row">
            <label>Target Entities</label>
            ${createYeelightCubeEntityPicker(
              this.hass,
              targets,
              (event) => this._change("target_entities", event.target.value),
              "multiple",
            )}
          </div>
          ${this._toggle("Card Background", "show_card_background")}
          ${this._toggle("Apply on Selection", "auto_apply")}
        `,
      )}
      ${this._section(
        "preview",
        "Lamp Preview",
        html`
          ${this._toggle("Show Lamp Preview", "show_preview")}
          ${config.show_preview !== false
            ? renderModeSettingsSection(
                "Preview Settings",
                html`
                  ${renderMatrixAppearanceSettings(
                    nativeEffectPreviewConfig(config),
                    change,
                    { defaultSize: 100 },
                  )}
                  ${this._toggle(
                    "Match Lamp Brightness",
                    "preview_brightness",
                    false,
                  )}
                `,
              )
            : ""}
        `,
      )}
      ${this._section(
        "actions",
        "Actions",
        html`
          ${this._toggle("Show Actions", "show_actions")}
          ${config.show_actions !== false
            ? renderModeSettingsSection(
                "Button Settings",
                renderActionButtonSettings(config, change, {
                  defaultStyle: "classic",
                  defaultContentMode: "icon",
                }),
              )
            : ""}
        `,
      )}
      ${this._section(
        "sliders",
        "Sliders",
        html`
          ${this._toggle("Show Brightness Slider", "show_brightness")}
          ${this._toggle("Show Animation Speed Slider", "show_animation_speed")}
          ${config.show_brightness !== false ||
          config.show_animation_speed !== false
            ? renderLightSliderSettings(config, change)
            : ""}
        `,
      )}
      ${this._section(
        "orientation",
        "Device Orientation",
        html`
          ${this._toggle("Show Device Orientation", "show_device_orientation")}
          ${config.show_device_orientation !== false
            ? renderModeSettingsSection(
                "Orientation Settings",
                renderOrientationSettings(config, change),
              )
            : ""}
        `,
      )}
      ${this._section(
        "effects",
        "Effects",
        html`
          ${this._toggle("Show Effect Browser", "show_gallery")}
          ${config.show_gallery !== false
            ? renderModeSettingsSection(
                "Browser Settings",
                html`
                  ${this._toggle("Text Search", "show_search")}
                  ${this._toggle(
                    "Experimental Effects",
                    "show_experimental",
                    false,
                  )}
                  ${renderStyleSelectorSettings(
                    {
                      ...config,
                      items_per_page: config.items_per_page ?? 8,
                      style_selector_style:
                        config.style_selector_style ||
                        (config.effect_view ? "original" : "preview-grid"),
                    },
                    change,
                    { allowOriginal: true },
                  )}
                  ${(config.style_selector_style ||
                    (config.effect_view ? "original" : "preview-grid")) ===
                  "original"
                    ? html`${this._choices(
                        "Display",
                        "effect_view",
                        ["grid", "list", "buttons", "dropdown"].map(
                          (value) => ({
                            value,
                            label: value[0].toUpperCase() + value.slice(1),
                          }),
                        ),
                        "grid",
                      )}
                      ${["grid", "list"].includes(config.effect_view || "grid")
                        ? renderModeSettingsSection(
                            "Gallery Appearance",
                            html`
                              ${this._toggle(
                                "Capability Labels",
                                "show_badges",
                              )}
                              ${renderMatrixAppearanceSettings(
                                nativeEffectPreviewConfig(config),
                                change,
                                { prefix: "effect", defaultSize: 100 },
                              )}
                            `,
                          )
                        : ""}
                      ${config.effect_view !== "dropdown"
                        ? html` <div class="form-row">
                            <label>Effects per Page</label>
                            <input
                              type="number"
                              aria-label="Effects per page"
                              min="0"
                              max="100"
                              .value=${String(config.items_per_page ?? 8)}
                              @change=${(event) =>
                                this._change(
                                  "items_per_page",
                                  Math.max(
                                    0,
                                    Math.min(
                                      100,
                                      Number(event.target.value) || 0,
                                    ),
                                  ),
                                )}
                            />
                          </div>`
                        : ""}
                      ${config.effect_view === "buttons"
                        ? renderModeSettingsSection(
                            "Button Settings",
                            renderActionButtonSettings(config, change, {
                              styleKey: "effect_buttons_style",
                              contentKey: "effect_buttons_content_mode",
                              defaultStyle: config.buttons_style || "classic",
                              defaultContentMode: "icon_text",
                            }),
                          )
                        : ""}`
                    : ""}
                  ${renderOrderableList({
                    items: visible,
                    available: names.filter((name) => !visible.includes(name)),
                    onUpdate: (items) => this._change("visible_effects", items),
                    onReset: () => this._change("visible_effects", undefined),
                    addPlaceholder: "Add effect",
                  })}
                `,
              )
            : ""}
        `,
      )}
      ${this._section(
        "favourites",
        "Favourites",
        html`
          ${this._toggle("Show Favourites", "show_favourites", false)}
          ${config.show_favourites
            ? renderModeSettingsSection(
                "Favourite Controls",
                html`${this._toggle(
                  "Animated Previews",
                  "favourites_show_previews",
                )}
                ${config.favourites_show_previews === false
                  ? renderActionButtonSettings(config, change, {
                      styleKey: "collection_buttons_style",
                      contentKey: "collection_buttons_content_mode",
                      defaultStyle: "classic",
                      defaultContentMode: "icon_text",
                    })
                  : renderMatrixAppearanceSettings(
                      nativeEffectPreviewConfig(config),
                      change,
                      { prefix: "effect", defaultSize: 100 },
                    )}`,
              )
            : ""}
        `,
      )}
      ${this._section(
        "rotation",
        "Effect Rotation",
        html`${this._toggle("Show Effect Rotation", "show_rotation", false)}
        ${config.show_rotation
          ? renderModeSettingsSection(
              "Rotation Settings",
              html`
                ${this._choices(
                  "Effects",
                  "rotation_source",
                  [
                    { value: "favourites", label: "Favourites" },
                    { value: "custom", label: "Custom List" },
                  ],
                  "favourites",
                )}
                ${config.rotation_source === "custom"
                  ? renderOrderableList({
                      items: (config.rotation_effects || []).filter((name) =>
                        names.includes(name),
                      ),
                      available: names.filter(
                        (name) =>
                          !(config.rotation_effects || []).includes(name),
                      ),
                      onUpdate: (items) => change("rotation_effects", items),
                      addPlaceholder: "Add effect to rotation",
                    })
                  : ""}
                ${createSliderRow(
                  "Interval",
                  config.rotation_interval ?? 60,
                  { min: 10, max: 3600, step: 10 },
                  (event) =>
                    change("rotation_interval", Number(event.target.value)),
                  "s",
                )}
                ${this._toggle(
                  "Shuffle (No Immediate Repeats)",
                  "rotation_shuffle",
                  false,
                )}
              `,
            )
          : ""}`,
      )}
    </div>`;
  }
  static styles = [
    sharedEditorStyles,
    entitySelectorStyles,
    buttonGroupStyles,
    orderableListStyles,
  ];
}
customElements.define(
  "yeelight-cube-native-effects-card-editor",
  YeelightCubeNativeEffectsCardEditor,
);
