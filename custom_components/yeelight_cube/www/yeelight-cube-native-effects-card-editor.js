import { LitElement, html } from "./lib/lit-all.js";
import "./preview-appearance-editor.js";
import { normalizePreviewAppearance } from "./preview-appearance.js";
import {
  sharedEditorStyles,
  renderEditorSection,
  renderModeSettingsSection,
  renderMatrixAppearanceSettings,
  renderExperimentalAvailability,
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
import { independentActionConfig } from "./action-button-utils.js";
import "./clock-preset-manager.js";
import { CLOCK_COLOR_MODES } from "./clock-preview-utils.js";
import {
  clockPresetLibrary,
  clockColorModeOptions,
  clockColorModeVisibilityConfig,
} from "./clock-preset-utils.js";
import { getTargetEntities } from "./service-call-utils.js";
import {
  nativeEffectItems,
  nativeEffectPreviewConfig,
  nativeEffectFrame,
} from "./native-effect-card-utils.js";
import { renderLightSliderSettings } from "./slider-control-utils.js";
import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import {
  renderModeControlSettings,
  renderColorModeSettings,
} from "./mode-controls-settings.js";

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
    this._config = normalizePreviewAppearance(
      independentActionConfig(config),
      "native",
    );
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
  _renderAppearance(section) {
    return html`<yeelight-preview-appearance-editor
      profile="native"
      section=${section}
      .owner=${this}
      .config=${this._config}
      @appearance-changed=${(event) => {
        this._config = event.detail.config;
        fireEvent(this, "config-changed", { config: this._config });
      }}
    ></yeelight-preview-appearance-editor>`;
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
  _renderVisibleColorModeList() {
    const presets = clockPresetLibrary(this.hass);
    const all = clockColorModeOptions(CLOCK_COLOR_MODES, presets);
    const visible = clockColorModeOptions(
      CLOCK_COLOR_MODES,
      presets,
      this._config,
    ).map((mode) => mode.value);
    const labels = new Map(all.map((mode) => [mode.value, mode.label]));
    return renderOrderableList({
      labelFor: (key) => labels.get(key) || key,
      items: visible,
      available: all
        .map((mode) => mode.value)
        .filter((key) => !visible.includes(key)),
      onUpdate: (items) => {
        this._config = clockColorModeVisibilityConfig(this._config, all, items);
        fireEvent(this, "config-changed", { config: this._config });
      },
      onReset: () => {
        const config = { ...this._config };
        delete config.visible_color_modes;
        delete config.hidden_color_modes;
        this._config = config;
        fireEvent(this, "config-changed", { config: this._config });
      },
      addPlaceholder: "Show a colour mode...",
      resetLabel: "Reset to all colour modes",
    });
  }

  render() {
    if (!this._config) return "";
    const config = this._config;
    const targets = getTargetEntities(config);
    const attrs = this.hass?.states[targets[0]]?.attributes || {};
    const effects = nativeEffectItems(attrs, {
      ...config,
      show_experimental: !!attrs.extended_effects_enabled,
      visible_effects: undefined,
    });
    const names = effects.map((item) => item.name);
    const visible = Array.isArray(config.visible_effects)
      ? [...new Set(config.visible_effects)].filter(
          (name) =>
            typeof name === "string" &&
            name.trim() &&
            !/^\d+$/.test(name.trim()),
        )
      : names;
    const change = (key, value) => this._change(key, value);
    return html`<div class="editor-root">
      ${renderExperimentalAvailability(this.hass, targets, config, true)}
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
        `,
      )}
      ${this._section(
        "preview_appearance",
        "Preview Appearance",
        this._renderAppearance("shared"),
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
                  ${createSliderRow(
                    "Size",
                    config.lamp_preview_size ?? 100,
                    { min: 30, max: 100, step: 5 },
                    (event) =>
                      change("lamp_preview_size", Number(event.target.value)),
                    "%",
                  )}
                  ${this._renderAppearance("lamp")}
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
        renderModeControlSettings("actions", config, change),
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
        renderModeControlSettings("orientation", config, change),
      )}
      ${this._section(
        "colors",
        "Colour Modes & Controls",
        html`${this._toggle("Show Colour Modes", "show_color_modes", false)}
        ${config.show_color_modes
          ? renderModeSettingsSection(
              "Colour Mode Style",
              html`${renderColorModeSettings(config, change)}
              ${this._toggle(
                "Show 'save colour mode' button",
                "show_save_color_mode_button",
              )}
              ${renderModeSettingsSection(
                "Visible colour modes",
                this._renderVisibleColorModeList(),
              )}`,
            )
          : ""}
        ${config.show_color_modes
          ? renderModeSettingsSection(
              "Control buttons",
              renderActionButtonSettings(config, change),
            )
          : ""}`,
      )}
      ${this._section(
        "presets",
        "Custom colours",
        html`<yeelight-clock-preset-manager
          .hass=${this.hass}
          .showLibrary=${true}
          .libraryKinds=${["color_mode"]}
          .libraryKind=${"color_mode"}
          .saveKinds=${["color_mode"]}
          .buttonStyle=${config.buttons_style || "modern"}
          .contentMode=${config.buttons_content_mode || "icon_text"}
          .frameRenderer=${(color) => {
            const effect =
              effects.find((item) => item.name === attrs.native_effect) ||
              effects[0];
            return effect
              ? nativeEffectFrame(effect, {
                  ...attrs,
                  native_effect_color: color,
                  native_effect_color_mode: "normal",
                })
              : [];
          }}
        ></yeelight-clock-preset-manager>`,
      )}
      ${this._section(
        "previews",
        "Previews",
        html`
          ${this._toggle("Show Effect Browser", "show_gallery")}
          ${config.show_gallery !== false
            ? renderModeSettingsSection(
                "Browser Settings",
                html`
                  ${this._toggle("Text Search", "show_search")}
                  ${renderStyleSelectorSettings(
                    {
                      ...config,
                      style_selector_style:
                        config.style_selector_style ||
                        (config.effect_view ? "original" : "preview-grid"),
                    },
                    change,
                    {
                      allowOriginal: true,
                      renderAppearance: () =>
                        html`${createSliderRow(
                          "Size",
                          config.preview_size ?? 55,
                          { min: 30, max: 100, step: 5 },
                          (event) =>
                            change("preview_size", Number(event.target.value)),
                          "%",
                        )}${this._renderAppearance("gallery")}`,
                    },
                  )}
                  ${renderOrderableList({
                    items: visible,
                    labelFor: (name) =>
                      names.includes(name)
                        ? name
                        : `${name} (currently unavailable)`,
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
        renderModeControlSettings(
          "favourites",
          nativeEffectPreviewConfig(config),
          change,
          [],
          "effect",
          () =>
            html`${createSliderRow(
              "Size",
              config.effect_preview_size ?? 100,
              { min: 30, max: 100, step: 5 },
              (event) =>
                change("effect_preview_size", Number(event.target.value)),
              "%",
            )}${this._renderAppearance("favourites")}`,
        ),
      )}
      ${this._section(
        "rotation",
        "Effect Rotation",
        renderModeControlSettings(
          "rotation",
          config,
          change,
          effects.map((item) => ({ key: item.name, title: item.name })),
        ),
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
