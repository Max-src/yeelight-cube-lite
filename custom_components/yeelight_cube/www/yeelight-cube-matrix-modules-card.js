// The Cube Matrix Modules card, kept for the dashboards that have it: the
// Lamp Preview card's Modules section for each chosen Cube Matrix
// (matrix-modules-editor.js), with its own arrows for the power supply's
// side. Edits are a draft until Save, which sends set_matrix_modules and
// set_device_orientation (matrix-modules-card-utils.js).
import { LitElement, html, unsafeCSS, nothing } from "./lib/lit-all.js";

import { YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import { cardNotice, cardShell, NOTICE, lampUnavailableLine } from "./card-shell.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { orientationControlStyles } from "./orientation-control-utils.js";
import { deleteButtonStyles, deleteButtonPositionStyles } from "./delete-button-styles.js";
import { lampAvailable } from "./service-call-utils.js";
import { defineOnce } from "./card-registration.js";
import { normalizeCardOptions } from "./card-config.js";
import { cubeMatrixEntities, isCubeMatrix } from "./matrix-modules-card-utils.js";
import { MatrixModulesEditor, matrixModulesEditorStyles } from "./matrix-modules-editor.js";

const MODULES_CARD_CSS = `
  ${cardLayoutStyles}
  ${actionButtonStyles}
  ${orientationControlStyles}
  ${deleteButtonStyles}
  ${deleteButtonPositionStyles}
  ${matrixModulesEditorStyles}
  .ycm-lamps {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .ycm-lamp + .ycm-lamp {
    border-top: 1px solid var(--divider-color, #0002);
    padding-top: 20px;
  }
  .ycm-note {
    color: var(--secondary-text-color, #666);
    font-size: 0.9em;
  }
`;

class YeelightCubeMatrixModulesCard extends YeelightCardMixin(LitElement) {
  static editor = ["yeelight-cube-matrix-modules-card-editor", "./yeelight-cube-matrix-modules-card-editor.js"];
  static cardSize = 6; // Dashboard height (card-base)
  static styles = unsafeCSS(MODULES_CARD_CSS);

  constructor() {
    super();
    this._hass = null;
    this.config = {};
    // Each lamp's draft and its section (matrix-modules-editor.js).
    this._modules = new MatrixModulesEditor(this);
  }

  setConfig(config) {
    this._commands?.reset();
    this._modules.clear();
    this.config = { ...normalizeCardOptions(config, "matrix-modules") };
    this.requestUpdate();
  }

  static getStubConfig(hass) {
    const lamps = cubeMatrixEntities(hass, cubeLampEntities(hass));
    return {
      type: "custom:yeelight-cube-matrix-modules-card",
      target_entities: lamps.length ? [lamps[0]] : [],
    };
  }

  // A push that changed what the card shows (card-base set hass).
  _hassUpdated(hass) {
    if (hass) this.requestUpdate();
  }

  // What the card shows from hass (card-base _hassChanged): each lamp's
  // name, availability, modules and orientation (the power supply's side),
  // not its other attributes (matrix_colors changes every second). A saved
  // layout the lamp never reports goes on its own timer.
  _hassInputs(hass) {
    return [
      this.config,
      ...this._targets.flatMap((id) => {
        const state = hass?.states?.[id];
        return [state?.attributes?.friendly_name, ...MatrixModulesEditor.inputs(state)];
      }),
    ];
  }

  render() {
    const hass = this._hass;
    if (!hass) return nothing;
    const targets = this._targets;
    if (!targets.length) return cardNotice(this, "Select a Cube Matrix in the card editor.");
    const known = targets.filter((id) => hass.states[id]);
    if (!known.length) return cardNotice(this, NOTICE.noLamp);
    return cardShell(
      this,
      html`<div class="ycm-lamps">${known.map((id) => this._renderLamp(id))}</div>`,
    );
  }

  // One lamp: the Lamp Preview's Modules section, with its own arrows for
  // the power supply's side (saved with the modules).
  _renderLamp(entityId) {
    const state = this._hass.states[entityId];
    const name = state.attributes?.friendly_name || entityId;
    if (!isCubeMatrix(state.attributes))
      return html`<section class="ycm-lamp">
        <div class="ycm-title">${name}</div>
        <div class="ycm-note">This lamp is not a Cube Matrix: it has no modules to set.</div>
      </section>`;
    return html`<section class="ycm-lamp" data-entity=${entityId}>
      ${lampAvailable(state) ? nothing : lampUnavailableLine()}
      ${this._modules.render(this._hass, entityId, {
        config: this.config,
        buttons: { buttonStyle: this.config.buttons_style, contentMode: this.config.buttons_content_mode },
        orientation: "draft",
        title: name,
      })}
    </section>`;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._modules.clear();
  }
}
defineOnce("yeelight-cube-matrix-modules-card", YeelightCubeMatrixModulesCard);

// Not in the card picker: the Lamp Preview card's Modules section replaces
// it. Kept for the dashboards that already have it.
