// The Cube Matrix Modules card: which modules each chosen Cube Matrix has, in
// chain order from its power supply, and the side the power supply is on, set
// as in the Yeelight app's module page. Edits are a draft until Save, which
// sends set_matrix_modules and set_device_orientation (matrix-modules-card-utils.js).
import { LitElement, html, unsafeCSS, nothing } from "./lib/lit-all.js";

import { YeelightCardMixin, cubeLampEntities, valueKey } from "./card-base.js";
import { cardNotice, cardShell, NOTICE, lampUnavailableLine } from "./card-shell.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { renderActionButton, renderActionButtonGroup, renderActionRow } from "./action-button-ui.js";
import { lampAvailable } from "./service-call-utils.js";
import { notifyUnreported } from "./notify-utils.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { normalizeCardOptions } from "./card-config.js";
import {
  MAX_MODULES,
  MODULE_TYPES,
  SUPPLY_SIDES,
  cubeMatrixEntities,
  isCubeMatrix,
  saveCalls,
  sameLayout,
  savedLayout,
  withModuleAdded,
  withModuleRemoved,
} from "./matrix-modules-card-utils.js";

// How long a saved draft stays shown while the lamp reports its new layout.
const SAVED_DRAFT_MS = 10000;

// Where the chain grows from the power supply, by its side.
const ARROWS = { left: "mdi:arrow-right", right: "mdi:arrow-left", down: "mdi:arrow-up", up: "mdi:arrow-down" };

const MODULES_CARD_CSS = `
  ${cardLayoutStyles}
  ${actionButtonStyles}
  .ycm-lamps {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .ycm-lamp {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ycm-lamp + .ycm-lamp {
    border-top: 1px solid var(--divider-color, #0002);
    padding-top: 20px;
  }
  .ycm-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .ycm-name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .ycm-count {
    flex-shrink: 0;
    color: var(--secondary-text-color, #666);
  }
  .ycm-count b {
    color: var(--primary-color, #03a9f4);
  }
  .ycm-label {
    font-weight: 500;
  }
  .ycm-stage {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px 8px;
    border-radius: 12px;
    background: var(--secondary-background-color, #f3f4f6);
    min-height: 120px;
  }
  .ycm-chain {
    --ycm-size: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  .ycm-chain.ycm-from-left { flex-direction: row; }
  .ycm-chain.ycm-from-right { flex-direction: row-reverse; }
  .ycm-chain.ycm-from-down { flex-direction: column-reverse; }
  .ycm-chain.ycm-from-up { flex-direction: column; }
  .ycm-chain.ycm-row > .ycm-module,
  .ycm-chain.ycm-row > .ycm-slot {
    flex: 0 1 var(--ycm-size);
    min-width: 0;
  }
  .ycm-chain.ycm-column > .ycm-module,
  .ycm-chain.ycm-column > .ycm-slot {
    width: var(--ycm-size);
  }
  .ycm-supply {
    flex: 0 0 auto;
    box-sizing: border-box;
    background: #444;
    border: 1px solid #222;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ycm-row > .ycm-supply { width: 16px; height: var(--ycm-size); }
  .ycm-column > .ycm-supply { width: var(--ycm-size); height: 16px; }
  .ycm-supply::after {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #111;
  }
  .ycm-module,
  .ycm-tile {
    position: relative;
    box-sizing: border-box;
    aspect-ratio: 1;
    border-radius: 6px;
    background: #3b3d42;
    border: 2px solid #1f2023;
  }
  .ycm-module { margin: 1px; }
  .ycm-dots {
    position: absolute;
    inset: 12%;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    grid-template-rows: repeat(5, 1fr);
    place-items: center;
  }
  .ycm-dots span {
    width: 62%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: #6f8cff;
  }
  .ycm-spot::after {
    content: "";
    position: absolute;
    inset: 16%;
    border-radius: 50%;
    border: 3px solid #1f2023;
    background: radial-gradient(circle, #a9b8ff 0%, #6f8cff 45%, #4058d8 100%);
  }
  .ycm-panel {
    background: linear-gradient(135deg, #a9b8ff, #6f8cff);
    border-color: #2b3a8f;
  }
  .ycm-remove {
    position: absolute;
    top: -9px;
    right: -9px;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: #ff9800;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
    --mdc-icon-size: 16px;
  }
  .ycm-remove:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
  .ycm-slot {
    box-sizing: border-box;
    aspect-ratio: 1;
    margin: 1px;
    border: 2px dashed var(--divider-color, #bbb);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--secondary-text-color, #999);
  }
  .ycm-hint {
    text-align: center;
    color: var(--secondary-text-color, #666);
    font-size: 0.9em;
  }
  .ycm-palette {
    display: flex;
    justify-content: space-around;
    gap: 12px;
  }
  .ycm-choice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .ycm-choice .ycm-tile {
    width: 52px;
  }
  .ycm-choice .add-btn {
    min-width: 64px;
    justify-content: center;
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
    // Per lamp: its edited layout ({ modules, supply }), until saved and
    // reported back; `saving` while its calls are sent, `savedAt` once sent.
    this._drafts = {};
  }

  setConfig(config) {
    this._commands?.reset();
    this._drafts = {};
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
  // layout the lamp never reports goes on its own timer (_save).
  _hassInputs(hass) {
    return [
      this.config,
      ...this._targets.flatMap((id) => {
        const state = hass?.states?.[id];
        const attributes = state?.attributes;
        return [
          !!state,
          state?.state,
          attributes?.friendly_name,
          valueKey(attributes?.matrix_module_list),
          valueKey(attributes?.matrix_modules),
          attributes?.device_orientation,
        ];
      }),
    ];
  }

  // The layout a lamp shows on the card: its draft, else what it reports. A
  // saved draft goes once the lamp reports it (or after SAVED_DRAFT_MS).
  _layout(entityId) {
    const saved = savedLayout(this._hass?.states?.[entityId]?.attributes);
    const draft = this._drafts[entityId];
    if (!draft) return { saved, shown: saved };
    if (draft.savedAt && (sameLayout(draft.layout, saved) || Date.now() - draft.savedAt > SAVED_DRAFT_MS)) {
      delete this._drafts[entityId];
      return { saved, shown: saved };
    }
    return { saved, shown: draft.layout, draft };
  }

  _edit(entityId, change) {
    const { saved, shown, draft } = this._layout(entityId);
    if (draft?.saving) return;
    const layout = change(shown);
    this._drafts = {
      ...this._drafts,
      [entityId]: sameLayout(layout, saved) ? undefined : { layout },
    };
    if (!this._drafts[entityId]) delete this._drafts[entityId];
    this.requestUpdate();
  }

  _reset(entityId) {
    delete this._drafts[entityId];
    this.requestUpdate();
  }

  // Send the draft: the modules, then the power supply side, each through the
  // card's command queue (Home Assistant shows a refused call's error). The
  // draft stays shown until the lamp reports it.
  async _save(entityId) {
    const { saved, draft } = this._layout(entityId);
    if (!draft || draft.saving) return;
    const calls = saveCalls(entityId, saved, draft.layout);
    if (!calls.length) return;
    draft.saving = true;
    this.requestUpdate();
    try {
      for (const { service, data } of calls) {
        const sent = await this._commands.call(this._hass, "yeelight_cube", service, data);
        if (sent !== true) return; // the configuration changed meanwhile
      }
      draft.savedAt = Date.now();
      setTimeout(() => this.requestUpdate(), SAVED_DRAFT_MS + 50);
    } catch (error) {
      notifyUnreported(this, error, "The modules were not saved.");
    } finally {
      draft.saving = false;
      this.requestUpdate();
    }
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

  _renderLamp(entityId) {
    const state = this._hass.states[entityId];
    const name = state.attributes?.friendly_name || entityId;
    if (!isCubeMatrix(state.attributes))
      return html`<section class="ycm-lamp">
        <div class="ycm-name">${name}</div>
        <div class="ycm-note">This lamp is not a Cube Matrix: it has no modules to set.</div>
      </section>`;
    const available = lampAvailable(state);
    const { shown, draft } = this._layout(entityId);
    const busy = !!draft?.saving;
    const options = {
      buttonStyle: this.config.buttons_style,
      contentMode: this.config.buttons_content_mode,
    };
    return html`<section class="ycm-lamp" data-entity=${entityId}>
      <div class="ycm-head">
        <span class="ycm-name">${name}</span>
        <span class="ycm-count">Added <b>(${shown.modules.length})</b></span>
      </div>
      ${available ? nothing : lampUnavailableLine()}
      <div class="ycm-label">Position of the power supply</div>
      ${renderActionButtonGroup(
        {
          ...options,
          contentMode: "text",
          label: "Position of the power supply",
          value: shown.supply,
          items: SUPPLY_SIDES.map((side) => ({ value: side.value, label: side.label, disabled: busy })),
        },
        (value) => this._edit(entityId, (layout) => ({ ...layout, supply: value })),
      )}
      <div class="ycm-stage">${this._renderChain(entityId, shown, busy)}</div>
      <div class="ycm-hint">Add the modules in the order they are fitted, from the power supply.</div>
      <div class="ycm-palette">
        ${MODULE_TYPES.map(
          ({ type, label, title }) => html`<div class="ycm-choice">
            ${this._renderTile(type, "ycm-tile")}
            ${renderActionButton({
              ...options,
              action: "add",
              icon: "mdi:plus",
              label,
              title: `Add a ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
              disabled: busy || shown.modules.length >= MAX_MODULES,
              dataMode: `add-${type}`,
              onClick: () => this._edit(entityId, (layout) => withModuleAdded(layout, type)),
            })}
          </div>`,
        )}
      </div>
      ${draft && !draft.savedAt
        ? renderActionRow(
            html`${renderActionButton({
              ...options,
              action: "clear",
              icon: "mdi:undo",
              label: "Reset",
              title: "Show the lamp's modules again",
              disabled: busy,
              dataMode: "reset",
              onClick: () => this._reset(entityId),
            })}${renderActionButton({
              ...options,
              action: "save",
              icon: "mdi:content-save-outline",
              label: "Save",
              title: shown.modules.length ? "Save to the lamp" : "Add at least one module",
              busy,
              busyLabel: "Saving…",
              disabled: !available || !shown.modules.length,
              dataMode: "save",
              onClick: () => this._save(entityId),
            })}`,
            options,
          )
        : nothing}
    </section>`;
  }

  // The chain as fitted: the power supply on its side, the modules away from
  // it, then the slot the next one goes in.
  _renderChain(entityId, layout, busy) {
    const vertical = layout.supply === "up" || layout.supply === "down";
    return html`<div
      class="ycm-chain ycm-from-${layout.supply} ${vertical ? "ycm-column" : "ycm-row"}"
      role="list"
      aria-label="Modules from the power supply"
    >
      <div class="ycm-supply" title="Power supply"></div>
      ${layout.modules.map(
        (type, index) => html`<div class=${`ycm-module ${this._tileClass(type)}`} role="listitem" data-type=${type}
          title=${`${index + 1}. ${MODULE_TYPES.find((entry) => entry.type === type)?.label}`}>
          ${type === "matrix" ? this._dots() : nothing}
          <button
            class="ycm-remove"
            aria-label=${`Remove module ${index + 1}`}
            title="Remove"
            ?disabled=${busy}
            @click=${() => this._edit(entityId, (current) => withModuleRemoved(current, index))}
          ><ha-icon icon="mdi:close"></ha-icon></button>
        </div>`,
      )}
      ${layout.modules.length < MAX_MODULES
        ? html`<div class="ycm-slot" aria-hidden="true"><ha-icon icon=${ARROWS[layout.supply]}></ha-icon></div>`
        : nothing}
    </div>`;
  }

  _tileClass(type) {
    return type === "spot" ? "ycm-spot" : type === "panel" ? "ycm-panel" : "ycm-matrix";
  }

  _renderTile(type, className) {
    return html`<div class=${`${className} ${this._tileClass(type)}`} aria-hidden="true">
      ${type === "matrix" ? this._dots() : nothing}
    </div>`;
  }

  _dots() {
    return html`<div class="ycm-dots">${Array.from({ length: 25 }, () => html`<span></span>`)}</div>`;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._drafts = {};
  }
}
defineOnce("yeelight-cube-matrix-modules-card", YeelightCubeMatrixModulesCard);

if (typeof window !== "undefined") {
  registerCustomCard({
    type: "yeelight-cube-matrix-modules-card",
    name: "Yeelight Cube Matrix Modules Card",
    description: "Set which modules a Yeelight Cube Matrix has and the side its power supply is on.",
    preview: true,
  });
}
