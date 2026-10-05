import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import { normalizeClockAppearance } from "./preview-appearance.js";
import {
  renderClockSharedAppearance,
  renderClockSectionAppearance,
  clockAppearanceEditorStyles,
} from "./preview-appearance-editor.js";
import {
  renderModeControlSettings,
  renderColorModeSettings,
} from "./mode-controls-settings.js";
import { LitElement, html } from "./lib/lit-all.js";
import "./clock-preset-manager.js";
import { renderActionButtonSettings } from "./action-button-ui.js";
import { independentActionConfig } from "./action-button-utils.js";
import {
  clockPresetLibrary,
  clockPresetKey,
  clockStylesWithPresets,
  visibleClockStyles,
  clockStyleVisibilityConfig,
  clockColorModeOptions,
  clockColorModeVisibilityConfig,
} from "./clock-preset-utils.js";

import {
  sharedEditorStyles,
  YeelightEditorMixin,
  renderModeSettingsSection,
  renderExperimentalAvailability,
} from "./editor_ui_utils.js";
import { createButtonGroup, buttonGroupStyles } from "./button-group-utils.js";
import { createToggleRow } from "./form-row-utils.js";
import { getClockStyles, CLOCK_COLOR_MODES } from "./clock-preview-utils.js";
import {
  renderLightSliderSettings,
  sliderKeys,
} from "./slider-control-utils.js";
import {
  renderOrderableList,
  orderableListStyles,
} from "./orderable-list-utils.js";
import { defineOnce } from "./card-registration.js";
import { getTargetEntities } from "./service-call-utils.js";
import {
  sharedRotationInterval,
  saveEditorRotationInterval,
} from "./shared-lamp-settings.js";

class YeelightCubeClockCardEditor extends YeelightEditorMixin(LitElement) {
  static get properties() {
    return {
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._hass = null;
    // Foldable sections follow the card's top→bottom element order.
    this._open = { general: true };
  }

  static get styles() {
    return [
      sharedEditorStyles,
      buttonGroupStyles,
      orderableListStyles,
      clockAppearanceEditorStyles,
    ];
  }

  setConfig(config) {
    const cfg = independentActionConfig(config, {
      buttons_style: "modern",
      buttons_content_mode: "icon_text",
    });
    if (cfg.show_color_override) cfg.show_color_modes = true;
    delete cfg.show_color_override;
    // Mirror the card's legacy speed_* → shared slider_* migration so existing
    // customizations show up in the editor controls.
    const K = sliderKeys("slider");
    const oldK = sliderKeys("speed");
    for (const f of Object.keys(K)) {
      if (cfg[K[f]] === undefined && cfg[oldK[f]] !== undefined) {
        cfg[K[f]] = cfg[oldK[f]];
      }
    }
    this._config = normalizeClockAppearance(cfg);
    this.requestUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    if (hass && hass.states) this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  shouldUpdate() {
    return !!this._hass;
  }

  render() {
    if (!this._hass || !this._hass.states) {
      return html`<div
        style="padding: 20px; color: var(--secondary-text-color, #666);"
      >
        Loading…
      </div>`;
    }
    const config = normalizeClockAppearance({
      buttons_style: "modern",
      buttons_content_mode: "icon_text",
      ...this._config,
    });
    const selectedEntities = getTargetEntities(config);
    // Several changes from one control (e.g. the interval rows and their
    // total) build on each other.
    let next = config;
    const change = (key, value) => {
      next = { ...next, [key]: value };
      this._config = next;
      this.requestUpdate();
      this._fireConfigChanged();
    };
    const modes = clockStylesWithPresets(
      getClockStyles(true),
      clockPresetLibrary(this._hass),
    ).map((style) => ({ key: clockPresetKey(style), title: style.name }));

    // Editor sections follow the card's visual order.
    return html`
      <div class="editor-root">
        ${renderExperimentalAvailability(this._hass, selectedEntities, config)}
        ${this._section(
          "general",
          "Global Settings",
          html`
            ${this._cardFrameSettings({
              placeholder: "Clock",
              lamps: "multiple",
            })}
            ${createToggleRow(
              "Show active-style label",
              "show_active_label",
              config.show_active_label !== false,
              (e) => this._onToggle(e, "show_active_label"),
            )}
          `,
        )}
        ${this._section(
          "preview_appearance",
          "Preview Appearance",
          renderClockSharedAppearance(config, change, this),
        )}
        ${this._section(
          "lamp_preview",
          "Lamp Preview",
          html`
            ${createToggleRow(
              "Show Lamp Preview",
              "show_current_preview",
              config.show_current_preview !== false,
              (e) => this._onToggle(e, "show_current_preview"),
            )}
            ${config.show_current_preview !== false
              ? renderModeSettingsSection(
                  "Preview Settings",
                  renderClockSectionAppearance(config, change, "lamp", this),
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
          "speed",
          "Sliders",
          html`
            ${createToggleRow(
              "Show brightness slider",
              "show_brightness",
              config.show_brightness === true,
              (e) => this._onToggle(e, "show_brightness"),
            )}
            ${createToggleRow(
              "Show animation speed slider",
              "show_animation_speed",
              config.show_animation_speed !== false,
              (e) => this._onToggle(e, "show_animation_speed"),
            )}
            ${renderLightSliderSettings(config, (key, value) => {
              this._config = { ...this._config, [key]: value };
              this.requestUpdate();
              this._fireConfigChanged();
            })}
          `,
        )}
        ${this._section(
          "display",
          "Content & Controls",
          html`
            ${createToggleRow(
              "Show content toggle",
              "show_content_toggle",
              config.show_content_toggle !== false,
              (e) => this._onToggle(e, "show_content_toggle"),
            )}
            ${createToggleRow(
              "Show format toggles",
              "show_format_toggles",
              config.show_format_toggles !== false,
              (e) => this._onToggle(e, "show_format_toggles"),
            )}
            ${createToggleRow(
              "Show color modes",
              "show_color_modes",
              !!config.show_color_modes,
              (e) => this._onToggle(e, "show_color_modes"),
            )}
            ${config.show_color_modes
              ? renderModeSettingsSection(
                  "Color mode style",
                  html`
                    ${renderColorModeSettings(config, change)}
                    ${createToggleRow(
                      "Show 'save color mode' button",
                      "show_save_color_mode_button",
                      config.show_save_color_mode_button !== false,
                      (e) => this._onToggle(e, "show_save_color_mode_button"),
                    )}
                    ${createToggleRow(
                      "Show 'save clock style' button",
                      "show_save_clock_style_button",
                      config.show_save_clock_style_button !== false,
                      (e) => this._onToggle(e, "show_save_clock_style_button"),
                    )}
                    ${renderModeSettingsSection(
                      "Visible color modes",
                      this._renderVisibleColorModeList(),
                    )}
                  `,
                )
              : ""}
            ${renderModeSettingsSection(
              "Control buttons",
              renderActionButtonSettings(config, (key, value) => {
                this._config = { ...this._config, [key]: value };
                this.requestUpdate();
                this._fireConfigChanged();
              }),
            )}
          `,
        )}
        ${this._section(
          "presets",
          "Custom clock styles and colors",
          html`
            <yeelight-clock-preset-manager
              .hass=${this._hass}
              .showLibrary=${true}
              .buttonStyle=${config.buttons_style || "modern"}
              .contentMode=${config.buttons_content_mode || "icon_text"}
            ></yeelight-clock-preset-manager>
          `,
        )}
        ${this._section(
          "previews",
          "Previews",
          html`
            ${createToggleRow(
              "Show Effect Browser",
              "show_gallery",
              config.show_gallery !== false,
              (event) => this._onToggle(event, "show_gallery"),
            )}
            ${config.show_gallery !== false
              ? renderModeSettingsSection(
                  "Browser Settings",
                  html`
                    ${createToggleRow(
                      "Customize visible styles",
                      "custom_visible_styles",
                      config.custom_visible_styles === true,
                      (e) => this._onToggle(e, "custom_visible_styles"),
                    )}
                    ${config.custom_visible_styles === true
                      ? renderModeSettingsSection(
                          "Visible Styles",
                          html`
                            <div
                              class="hint"
                              style="font-size:0.9em;color:var(--secondary-text-color,#666);margin-bottom:4px;"
                            >
                              Styles shown in the selector, in this order.
                            </div>
                            ${this._renderVisibleStyleList()}
                          `,
                        )
                      : ""}
                    ${renderStyleSelectorSettings(config, change, {
                      allowOriginal: true,
                      memory: (this._galleryMemory ||= {}),
                      renderAppearance: () =>
                        renderClockSectionAppearance(
                          config,
                          change,
                          "gallery",
                          this,
                          { size: false },
                        ),
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
            config,
            change,
            modes,
            "clock mode",
            () =>
              renderClockSectionAppearance(config, change, "favourites", this),
          ),
        )}
        ${this._section(
          "rotation",
          "Clock Mode Rotation",
          renderModeControlSettings(
            "rotation",
            config,
            change,
            modes,
            "clock mode",
            null,
            {
              interval: sharedRotationInterval(this._hass, config, "clock"),
              onIntervalChange: (seconds) =>
                saveEditorRotationInterval(this._hass, config, "clock", seconds),
            },
          ),
        )}
      </div>
    `;
  }

  // Ordered list of styles shown in the selector (all styles when unset).
  _visibleStyleList() {
    const all = clockStylesWithPresets(
      getClockStyles(true),
      clockPresetLibrary(this._hass),
    );
    return visibleClockStyles(all, this._config).map(clockPresetKey);
  }

  _renderVisibleStyleList() {
    const list = this._visibleStyleList();
    const allStyles = clockStylesWithPresets(
      getClockStyles(true),
      clockPresetLibrary(this._hass),
    );
    const allNames = allStyles.map(clockPresetKey);
    const labels = new Map(
      allStyles.map((style) => [
        clockPresetKey(style),
        style.name + (style.presetId ? " (Custom)" : ""),
      ]),
    );
    return renderOrderableList({
      labelFor: (key) => labels.get(key) || key,
      items: list,
      available: allNames.filter((name) => !list.includes(name)),
      onUpdate: (l) => {
        this._config = clockStyleVisibilityConfig(this._config, allStyles, l);
        this.requestUpdate();
        this._fireConfigChanged();
      },
      onReset: () => {
        this._config = { ...this._config };
        delete this._config.visible_styles;
        delete this._config.hidden_clock_styles;
        this.requestUpdate();
        this._fireConfigChanged();
      },
      addPlaceholder: "Add a style…",
      resetLabel: "Reset to all styles",
    });
  }

  _renderVisibleColorModeList() {
    const presets = clockPresetLibrary(this._hass);
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
        this.requestUpdate();
        this._fireConfigChanged();
      },
      onReset: () => {
        this._config = { ...this._config };
        delete this._config.visible_color_modes;
        delete this._config.hidden_color_modes;
        this.requestUpdate();
        this._fireConfigChanged();
      },
      addPlaceholder: "Show a color mode...",
      resetLabel: "Reset to all color modes",
    });
  }

  _onButtonGroup(key, e) {
    const value = e?.target?.dataset?.value;
    if (!value) return;
    this._config = { ...this._config, [key]: value };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onToggle(e, key) {
    this._config = { ...this._config, [key]: e.target.checked };
    this.requestUpdate();
    this._fireConfigChanged();
  }

  _onSlider(key, e) {
    this._config = { ...this._config, [key]: parseInt(e.target.value, 10) };
    this.requestUpdate();
    this._fireConfigChanged();
  }

}

defineOnce("yeelight-cube-clock-card-editor", YeelightCubeClockCardEditor);
