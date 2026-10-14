import { LitElement, html } from "./lib/lit-all.js";
import "./preview-appearance-editor.js";
import { normalizePreviewAppearance } from "./preview-appearance.js";
import {
  VISIBILITY_KEYS,
  withAllItems,
  withVisibleItems,
} from "./visible-items.js";
import {
  sharedEditorStyles,
  YeelightEditorMixin,
  renderSettingsBox,
  renderExperimentalAvailability,
} from "./editor_ui_utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { createButtonGroup, buttonGroupStyles } from "./button-group-utils.js";
import { orderableListStyles } from "./orderable-list-utils.js";
import { renderActionButtonSettings } from "./action-button-ui.js";
import { independentActionConfig } from "./action-button-utils.js";
import "./clock-preset-manager.js";
import { getTargetEntities } from "./service-call-utils.js";
import {
  sharedRotationInterval,
  saveEditorRotationInterval,
} from "./shared-lamp-settings.js";
import {
  nativeEffectItems,
  isEffectName,
  nativeEffectPreviewConfig,
  nativeEffectFrame,
} from "./native-effect-card-utils.js";
import { renderLightSliderSettings } from "./slider-settings-ui.js";
import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import {
  renderModeControlSettings,
  renderColorModeSettings,
  renderVisibleColorModes,
} from "./mode-controls-settings.js";
import { defineOnce } from "./card-registration.js";

class YeelightCubeNativeEffectsCardEditor extends YeelightEditorMixin(LitElement) {
  static properties = {
    _config: { state: true },
    hass: { attribute: false },
    _open: { state: true },
  };
  // The first section, Global Settings, opens with the editor.
  static openSection = "general";
  setConfig(config) {
    this._config = normalizePreviewAppearance(
      independentActionConfig(config),
      "native",
    );
  }
  _change(key, value) {
    this._setOption(key, value);
  }
  _toggle(label, key, fallback = true) {
    return createToggleRow(label, key, this._config[key] ?? fallback, (event) =>
      this._change(key, event.target.checked),
    );
  }
  static appearanceProfile = "native";
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
      show_experimental: !!attrs.extended_effects_enabled,
      visible_effects: undefined,
      hidden_effects: undefined,
    });
    const names = effects.map((item) => item.name);
    const visible = Array.isArray(config.visible_effects)
      ? [...new Set(config.visible_effects)].filter(isEffectName)
      : names;
    const change = (key, value) => this._change(key, value);
    return html`<div class="editor-root">
      ${renderExperimentalAvailability(this.hass, targets, config, true)}
      ${this._section(
        "general",
        "Global Settings",
        html`
          ${this._cardFrameSettings({
            placeholder: "Native Effects",
            lamps: "multiple",
          })}
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
            ? renderSettingsBox(
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
        "Color Modes & Controls",
        html`${this._toggle("Show Color Modes", "show_color_modes", false)}
        ${config.show_color_modes
          ? renderSettingsBox(
              "Color Mode Style",
              html`${renderColorModeSettings(config, change)}
              ${this._toggle(
                "Show 'save color mode' button",
                "show_save_color_mode_button",
              )}
              ${renderVisibleColorModes(this)}`,
            )
          : ""}
        ${config.show_color_modes
          ? renderSettingsBox(
              "Control buttons",
              renderActionButtonSettings(config, change),
            )
          : ""}`,
      )}
      ${this._section(
        "presets",
        "Custom colors",
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
            ? renderSettingsBox(
                "Browser Settings",
                html`
                  ${this._galleryItemsSettings({
                    noun: "effect",
                    items: visible,
                    all: names,
                    labelFor: (name) =>
                      names.includes(name)
                        ? name
                        : `${name} (currently unavailable)`,
                    onList: (items) =>
                      withVisibleItems(
                        this._config,
                        VISIBILITY_KEYS.effects,
                        names,
                        items,
                      ),
                    onReset: () =>
                      withAllItems(this._config, VISIBILITY_KEYS.effects),
                  })}
                  ${renderStyleSelectorSettings(
                    config,
                    change,
                    {
                      allowOriginal: true,
                      allowChips: true,
                      noun: "Effect",
                      memory: (this._galleryMemory ||= {}),
                      renderAppearance: () => this._renderAppearance("gallery"),
                    },
                  )}
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
          "effect",
          null,
          {
            interval: sharedRotationInterval(this.hass, config, "native"),
            onIntervalChange: (seconds) =>
              saveEditorRotationInterval(this.hass, config, "native", seconds),
          },
        ),
      )}
    </div>`;
  }
  static styles = [
    sharedEditorStyles,
    buttonGroupStyles,
    orderableListStyles,
  ];
}
defineOnce("yeelight-cube-native-effects-card-editor", YeelightCubeNativeEffectsCardEditor);
