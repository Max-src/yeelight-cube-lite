import { LitElement, html } from "./lib/lit-all.js";

import { sharedEditorStyles, YeelightEditorMixin } from "./editor_ui_utils.js";
import { buttonGroupStyles } from "./button-group-utils.js";
import { renderActionButtonSettings } from "./action-button-ui.js";
import { normalizeCardOptions } from "./card-config.js";
import { cubeLampEntities } from "./card-base.js";
import { getTargetEntities } from "./service-call-utils.js";
import { isCubeMatrix } from "./matrix-modules-card-utils.js";
import { defineOnce } from "./card-registration.js";

class YeelightCubeMatrixModulesCardEditor extends YeelightEditorMixin(LitElement) {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
  }

  static get styles() {
    return [sharedEditorStyles, buttonGroupStyles];
  }

  setConfig(config) {
    this._config = { ...normalizeCardOptions(config, "matrix-modules") };
    this.requestUpdate();
  }

  // What the editor shows from hass (editor_ui_utils set hass): which
  // lamps are Cube Matrix lamps, by name.
  _hassInputs(hass) {
    const ids = [...new Set([...cubeLampEntities(hass), ...getTargetEntities(this._config || {})])];
    return [
      ...super._hassInputs(hass),
      ids
        .map((id) => {
          const attributes = hass.states[id]?.attributes;
          return `${id}:${!!hass.states[id]}:${isCubeMatrix(attributes)}:${attributes?.friendly_name ?? ""}`;
        })
        .join("\n"),
    ];
  }

  shouldUpdate() {
    return !!this._hass;
  }

  render() {
    if (!this._hass || !this._hass.states)
      return html`<div style="padding: 20px; color: var(--secondary-text-color, #666);">Loading...</div>`;
    const config = this._config || {};
    const states = this._hass.states;
    const matrices = cubeLampEntities(this._hass).filter((id) => isCubeMatrix(states[id]?.attributes));
    const others = getTargetEntities(config).filter(
      (id) => states[id] && !isCubeMatrix(states[id].attributes),
    );
    const hint = matrices.length
      ? `The Cube Matrix lamps to set up (${matrices.length} found: ${matrices
          .map((id) => states[id].attributes?.friendly_name || id)
          .join(", ")}). A Cube Lite has no modules.`
      : "No Cube Matrix found: a Cube Lite has no modules.";
    return html`
      <div class="editor-root">
        ${this._section("global", "Global Settings", html`
          ${this._cardFrameSettings({
            placeholder: "Cube Matrix Modules",
            lamps: "multiple",
            lampsHint: hint,
          })}
          ${others.length
            ? html`<div class="hint">Not a Cube Matrix (shown without modules): ${others.join(", ")}.</div>`
            : ""}
        `)}
        ${this._section("buttons", "Buttons", html`
          ${renderActionButtonSettings(config, (key, value) => this._setOption(key, value))}
        `)}
      </div>
    `;
  }
}

defineOnce("yeelight-cube-matrix-modules-card-editor", YeelightCubeMatrixModulesCardEditor);
