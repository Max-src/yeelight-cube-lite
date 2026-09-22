import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import {
  renderModeControlSettings,
  renderColorModeSettings,
} from "./mode-controls-ui.js";
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
  renderEditorSection,
  renderModeSettingsSection,
  renderMatrixAppearanceSettings,
  renderExperimentalAvailability,
} from "./editor_ui_utils.js";
import { createButtonGroup, buttonGroupStyles } from "./button-group-utils.js";
import { createToggleRow } from "./form-row-utils.js";
import { createYeelightCubeEntityPicker } from "./entity-selector-utils.js";
import { getClockStyles, CLOCK_COLOR_MODES } from "./clock-preview-utils.js";
import {
  renderLightSliderSettings,
  sliderKeys,
} from "./slider-control-utils.js";
import {
  renderOrderableList,
  orderableListStyles,
} from "./orderable-list-utils.js";

class YeelightCubeClockCardEditor extends LitElement {
  static get properties() {
    return {
      localTitle: { type: String },
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this.config = {};
    this.localTitle = "";
    this._hass = null;
    // Foldable sections follow the card's top→bottom element order.
    this._open = { general: true };
  }

  static get styles() {
    return [sharedEditorStyles, buttonGroupStyles, orderableListStyles];
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
    this.config = cfg;
    this.localTitle = config.title || "";
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

  _toggleSection(id) {
    this._open = { ...this._open, [id]: !this._open[id] };
  }

  _section(id, title, content) {
    return renderEditorSection(
      id,
      title,
      !!this._open[id],
      () => this._toggleSection(id),
      content,
    );
  }

  render() {
    if (!this._hass || !this._hass.states) {
      return html`<div
        style="padding: 20px; color: var(--secondary-text-color, #666);"
      >
        Loading…
      </div>`;
    }
    const config = {
      buttons_style: "modern",
      buttons_content_mode: "icon_text",
      ...this.config,
    };
    const selectedEntities =
      config.target_entities || (config.entity ? [config.entity] : []);
    const change = (key, value) => {
      this.config = { ...this.config, [key]: value };
      this.requestUpdate();
      this._fire();
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
            <div class="form-row">
              <label>Card Title (optional)</label>
              <input
                type="text"
                id="title"
                .value="${this.localTitle}"
                placeholder="Clock"
                @input="${this._onTitleInput}"
              />
            </div>
            <div class="form-row">
              <label>Target Entities</label>
              <div
                class="hint"
                style="font-size:0.9em;color:var(--secondary-text-color,#666);margin-bottom:8px;"
              >
                Choose the Yeelight Cube Lite light(s) this card controls.
              </div>
              ${createYeelightCubeEntityPicker(
                this._hass,
                selectedEntities,
                (e) => this._onEntityChange(e),
                "multiple",
              )}
            </div>
            ${createToggleRow(
              "Show active-style label",
              "show_active_label",
              config.show_active_label !== false,
              (e) => this._onToggle(e, "show_active_label"),
            )}
            ${createToggleRow(
              "Show card background",
              "show_card_background",
              config.show_card_background !== false,
              (e) => this._onToggle(e, "show_card_background"),
            )}
          `,
        )}
        ${this._section(
          "previews",
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
                  renderMatrixAppearanceSettings(config, (key, value) => {
                    this.config = { ...this.config, [key]: value };
                    this.requestUpdate();
                    this._fire();
                  }),
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
              this.config = { ...this.config, [key]: value };
              this.requestUpdate();
              this._fire();
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
              "Show colour modes",
              "show_color_modes",
              !!config.show_color_modes,
              (e) => this._onToggle(e, "show_color_modes"),
            )}
            ${config.show_color_modes
              ? renderModeSettingsSection(
                  "Colour mode style",
                  html`
                    ${renderColorModeSettings(config, change)}
                    ${createToggleRow(
                      "Show 'save colour mode' button",
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
                      "Visible colour modes",
                      this._renderVisibleColorModeList(),
                    )}
                  `,
                )
              : ""}
            ${renderModeSettingsSection(
              "Control buttons",
              renderActionButtonSettings(config, (key, value) => {
                this.config = { ...this.config, [key]: value };
                this.requestUpdate();
                this._fire();
              }),
            )}
          `,
        )}
        ${this._section(
          "presets",
          "Custom clock styles and colours",
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
          "style",
          "Clock style",
          html`
            ${createToggleRow(
              "Text Search",
              "show_search",
              config.show_search !== false,
              (event) => this._onToggle(event, "show_search"),
            )}
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
            ${this._renderStyleBrowserSettings()}
            ${renderStyleSelectorSettings(config, (key, value) => {
              this.config = { ...this.config, [key]: value };
              this.requestUpdate();
              this._fire();
            })}
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
    return visibleClockStyles(all, this.config).map(clockPresetKey);
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
        this.config = clockStyleVisibilityConfig(this.config, allStyles, l);
        this.requestUpdate();
        this._fire();
      },
      onReset: () => {
        this.config = { ...this.config };
        delete this.config.visible_styles;
        delete this.config.hidden_clock_styles;
        this.requestUpdate();
        this._fire();
      },
      addPlaceholder: "Add a style…",
      resetLabel: "Reset to all styles",
    });
  }

  _renderStyleBrowserSettings() {
    return renderModeSettingsSection(
      "Default style view",
      createToggleRow(
        "Show only responding styles",
        "show_only_responding_styles",
        this.config.show_only_responding_styles !== false,
        (event) => this._onToggle(event, "show_only_responding_styles"),
      ),
    );
  }

  _renderVisibleColorModeList() {
    const presets = clockPresetLibrary(this._hass);
    const all = clockColorModeOptions(CLOCK_COLOR_MODES, presets);
    const visible = clockColorModeOptions(
      CLOCK_COLOR_MODES,
      presets,
      this.config,
    ).map((mode) => mode.value);
    const labels = new Map(all.map((mode) => [mode.value, mode.label]));
    return renderOrderableList({
      labelFor: (key) => labels.get(key) || key,
      items: visible,
      available: all
        .map((mode) => mode.value)
        .filter((key) => !visible.includes(key)),
      onUpdate: (items) => {
        this.config = clockColorModeVisibilityConfig(this.config, all, items);
        this.requestUpdate();
        this._fire();
      },
      onReset: () => {
        this.config = { ...this.config };
        delete this.config.visible_color_modes;
        delete this.config.hidden_color_modes;
        this.requestUpdate();
        this._fire();
      },
      addPlaceholder: "Show a colour mode...",
      resetLabel: "Reset to all colour modes",
    });
  }

  _onTitleInput(e) {
    this.localTitle = e.target.value;
    this.config = { ...this.config, title: this.localTitle || undefined };
    this._fire();
  }

  _onEntityChange(e) {
    const value = Array.isArray(e.target.value)
      ? e.target.value
      : [e.target.value];
    this.config = { ...this.config, target_entities: value };
    // Keep a single `entity` in sync for stub/simple configs.
    this.config.entity = value[0] || undefined;
    this.requestUpdate();
    this._fire();
  }

  _onButtonGroup(key, e) {
    const value = e?.target?.dataset?.value;
    if (!value) return;
    this.config = { ...this.config, [key]: value };
    this.requestUpdate();
    this._fire();
  }

  _onToggle(e, key) {
    this.config = { ...this.config, [key]: e.target.checked };
    this.requestUpdate();
    this._fire();
  }

  _onSlider(key, e) {
    this.config = { ...this.config, [key]: parseInt(e.target.value, 10) };
    this.requestUpdate();
    this._fire();
  }

  _fire() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this.config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("yeelight-cube-clock-card-editor")) {
  customElements.define(
    "yeelight-cube-clock-card-editor",
    YeelightCubeClockCardEditor,
  );
}
