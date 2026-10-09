import { renderActionButtonSettings } from "./action-button-ui.js";
import { LitElement, html, css } from "./lib/lit-all.js";

import { sharedEditorStyles, YeelightEditorMixin } from "./editor_ui_utils.js";
import { orderableListStyles } from "./orderable-list-utils.js";

import { createButtonGroup, buttonGroupStyles } from "./button-group-utils.js";

import { createToggleRow } from "./form-row-utils.js";
import { normalizeCardOptions } from "./card-config.js";
import {
  renderStyleSelectorSettings,
  renderGalleryBackgroundRow,
} from "./style-selector-ui.js";

import { defineOnce } from "./card-registration.js";

class YeelightCubePaletteCardEditor extends YeelightEditorMixin(LitElement) {
  static get properties() {
    return {
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._open = {};
  }

  static get styles() {
    return [sharedEditorStyles, buttonGroupStyles, orderableListStyles];
  }

  setConfig(config) {
    this._config = { ...normalizeCardOptions(config, "palette") };
    this.requestUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    // Only trigger render if hass has states
    if (hass && hass.states) {
      this.requestUpdate();
    }
  }

  get hass() {
    return this._hass;
  }

  shouldUpdate(changedProperties) {
    // Always allow updates if config has changed (for display_mode changes, etc.)
    // Only block if _hass is completely missing
    return !!this._hass;
  }

  performUpdate() {
    // Extra guard at performUpdate level
    if (!this._hass || !this._hass.states) {
      return Promise.resolve();
    }
    try {
      const result = super.performUpdate();
      // Catch async errors from the promise chain
      if (result && typeof result.catch === "function") {
        return result.catch((e) => {
          return Promise.resolve();
        });
      }
      return result;
    } catch (e) {
      // Catch synchronous errors
      return Promise.resolve();
    }
  }

  render() {
    if (!this._hass || !this._hass.states)
      return html`<div
        style="padding: 20px; color: var(--secondary-text-color, #666);"
      >
        Loading...
      </div>`;
    const config = this._config || {};
    const sensors = Object.keys(this._hass.states || {}).filter((eid) =>
      eid.startsWith("sensor."),
    );

    return html`
      <div class="editor-root">
        ${this._section("global", "Global Settings", html`
            ${this._cardFrameSettings({
              placeholder: "Palettes",
              lamps: "multiple",
              lampsHint:
                "Optional: the lamps that receive applied palettes. Leave empty to affect all lights.",
            })}
        `)}

        ${this._section("palettes", "Palettes", html`
            <!-- The shared gallery settings (the same as every card with a
                 gallery); the palette previews are this card's appearance. -->
            ${renderStyleSelectorSettings(
              config,
              (key, value) => this._setOption(key, value),
              {
                allowChips: true,
                noun: "Palette",
                manage: "palettes",
                defaultSize: 50,
                memory: (this._galleryMemory ||= {}),
                renderAppearance: (cfg, onChange) =>
                  this._renderPaletteAppearance(cfg, onChange),
              },
            )}
            ${this._arrangeSettings("palettes")}
        `)}

        <!-- Import/Export Actions Section -->
        ${this._section("importExport", "Import/Export Actions", html`
            ${createToggleRow(
              "Show Export Button",
              "show_export_button",
              config.show_export_button !== false,
              (e) => this._onSwitchChange(e, "show_export_button"),
            )}
            ${createToggleRow(
              "Show Import Button",
              "show_import_button",
              config.show_import_button !== false,
              (e) => this._onSwitchChange(e, "show_import_button"),
            )}
            ${renderActionButtonSettings(config, (key, value) => {
              this._onButtonGroupChange(key, value);
            })}
        `)}
      </div>
    `;
  }

  // The palette previews (the gallery's appearance rows on this card).
  _renderPaletteAppearance(config, onChange) {
    return html`
      ${renderGalleryBackgroundRow(config, onChange)}
      <div class="form-row">
        <label>Swatch Style</label>
        ${createButtonGroup(
          [
            { value: "round", label: "Round" },
            { value: "square", label: "Square" },
            { value: "gradient", label: "Gradient Bar" },
            { value: "gradient-bg", label: "Gradient Background" },
            { value: "stripes", label: "Color Stripes" },
          ],
          config.swatch_style || "square",
          (event) => onChange("swatch_style", event.currentTarget.dataset.value),
        )}
      </div>
      ${createToggleRow(
        "Show Color Count",
        "show_color_count",
        config.show_color_count !== false,
        (event) => onChange("show_color_count", event.target.checked),
      )}
    `;
  }

  _onButtonGroupChange(key, value) {
    // Convert boolean-backed button groups from string to boolean
    if (key === "delete_button_left") value = value === "left";
    else if (key === "delete_button_inside") value = value === "inside";
    this._setOption(key, value);
  }


}

defineOnce("yeelight-cube-palette-card-editor", YeelightCubePaletteCardEditor);
