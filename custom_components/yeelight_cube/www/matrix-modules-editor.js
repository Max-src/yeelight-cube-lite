// A Cube Matrix's modules, set on a card: the Lamp Preview's Modules section
// and the older Cube Matrix Modules card draw it. The chain is drawn from the
// lamp's base with the preview's module looks (matrix-modules.js), each
// module with its remove cross, then the add buttons, Reset and Save. Edits
// are a draft until Save (matrix-modules-card-utils.js saveCalls).
//
// The power supply's side is the lamp's Device Orientation: a host with its
// own orientation row passes it (`orientation`, sent at once, the draft
// follows the lamp's); without one the section shows its own arrows, part of
// the draft ("draft").
import { html, nothing } from "./lib/lit-all.js";

import { renderActionButton, renderActionRow } from "./action-button-ui.js";
import { renderOrientationControls } from "./orientation-control-ui.js";
import { ORIENTATION_ORDER, nextOrientation } from "./orientation-control-utils.js";
import { getDeleteButtonConfig } from "./delete-button-styles.js";
import { moduleLook, modulePreviewRadius } from "./matrix-modules.js";
import { lampAvailable } from "./service-call-utils.js";
import { notifyUnreported } from "./notify-utils.js";
import { valueKey } from "./card-base.js";
import {
  MAX_MODULES,
  MODULE_TYPES,
  orientationForSupply,
  saveCalls,
  sameLayout,
  savedLayout,
  supplyForOrientation,
  withModuleAdded,
  withModuleRemoved,
} from "./matrix-modules-card-utils.js";

// How long a saved draft stays shown while the lamp reports its new layout.
export const SAVED_DRAFT_MS = 10000;

// The modules drawn lit in one neutral colour: their looks show, not a picture.
const NEUTRAL = [150, 150, 158];
const NEUTRAL_CSS = `rgb(${NEUTRAL.join(",")})`;
const SPOT_LOOK = moduleLook("spot", [NEUTRAL]);
const PANEL_LOOK = moduleLook("panel", Array(25).fill(NEUTRAL));

// Where the chain grows from the base, by the power supply's side.
const ARROWS = { left: "mdi:arrow-right", right: "mdi:arrow-left", down: "mdi:arrow-up", up: "mdi:arrow-down" };

const LABELS = Object.fromEntries(MODULE_TYPES.map(({ type, label }) => [type, label]));

export const matrixModulesEditorStyles = `
  .ycm-editor {
    display: flex;
    flex-direction: column;
    gap: var(--yc-control-gap, 8px);
    min-width: 0;
  }
  .ycm-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .ycm-title {
    font-weight: 500;
  }
  .ycm-status {
    flex-shrink: 0;
    font-size: 0.85em;
    color: var(--secondary-text-color, #666);
  }
  .ycm-status[data-state="edited"] {
    color: var(--primary-color, #03a9f4);
  }
  /* The chain in the preview's frame: dark, rounded, shadowed. */
  .ycm-stage {
    display: flex;
    justify-content: center;
    padding: 14px 10px;
    border-radius: 12px;
    background: var(--ycm-stage, #000);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }
  /* Standing: as narrow as its chain, like the standing preview. */
  .ycm-stage.ycm-standing {
    align-self: center;
    padding: 14px 18px;
  }
  .ycm-chain {
    --ycm-size: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
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
  /* A long standing chain takes smaller tiles, not a card twice as tall. */
  .ycm-chain.ycm-column.ycm-long {
    --ycm-size: 40px;
    gap: 4px;
  }
  /* The base: the power supply's block, where the chain starts. */
  .ycm-base {
    flex: 0 0 auto;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: #2b2b30;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    color: #8a8a92;
    --mdc-icon-size: 14px;
  }
  .ycm-row > .ycm-base { width: 18px; align-self: stretch; }
  .ycm-column > .ycm-base { height: 18px; width: var(--ycm-size); }
  .ycm-module {
    position: relative;
    box-sizing: border-box;
    aspect-ratio: 1;
  }
  /* A matrix: its 25 dots on the modules' face. */
  .ycm-dots {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    grid-template-rows: repeat(5, 1fr);
    gap: 6%;
    padding: 7%;
    box-sizing: border-box;
    border-radius: var(--ycm-face-radius, 12%);
    background: rgb(30, 30, 33);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }
  .ycm-dots span {
    border-radius: var(--ycm-dot-radius, 50%);
    background: ${NEUTRAL_CSS};
  }
  .ycm-face {
    position: absolute;
    inset: 0;
    border-radius: var(--ycm-face-radius, 12%);
  }
  .ycm-face[data-type="panel"] {
    background-blend-mode: lighten;
  }
  /* The shared remove cross (delete-button-styles.js), at a module's size. */
  .ycm-module .delete-btn-cross {
    width: 18px;
    height: 18px;
    top: -7px;
    right: -7px;
  }
  .ycm-module .delete-btn-cross::before,
  .ycm-module .delete-btn-cross::after {
    width: 9px !important;
  }
  .ycm-module .delete-btn-cross:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ycm-slot {
    box-sizing: border-box;
    aspect-ratio: 1;
    border: 2px dashed #4a4a52;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6a6a72;
    --mdc-icon-size: 18px;
  }
  .ycm-hint {
    color: var(--secondary-text-color, #666);
    font-size: 0.85em;
  }
  .ycm-error {
    color: var(--error-color, #db4437);
    text-align: center;
    font-size: 0.85rem;
  }
  .ycm-editor .action-row {
    justify-content: center;
  }
`;

/**
 * The drafts of a card's Cube Matrix lamps and their section. `host`: the
 * card (requestUpdate, its `_commands` queue).
 */
export class MatrixModulesEditor {
  constructor(host) {
    this.host = host;
    // Per lamp: its edited layout ({ modules, supply }), until saved and
    // reported back; `saving` while its calls are sent, `savedAt` once sent.
    this.drafts = {};
    this.errors = {};
  }

  /** Forget every draft (a new configuration, the card removed). */
  clear() {
    this.drafts = {};
    this.errors = {};
  }

  /** What the section shows from a lamp, as comparable values (hass inputs). */
  static inputs(state) {
    const attributes = state?.attributes;
    return [
      !!state,
      state?.state,
      valueKey(attributes?.matrix_module_list),
      valueKey(attributes?.matrix_modules),
      attributes?.device_orientation,
    ];
  }

  // The layout a lamp shows: its draft, else what it reports. `live`: the
  // power supply side is the lamp's (its host sends the orientation). A
  // draft the lamp now shows (saved, or set the same elsewhere) goes, a
  // saved one also after SAVED_DRAFT_MS.
  layout(hass, entityId, live = false) {
    const saved = savedLayout(hass?.states?.[entityId]?.attributes);
    const draft = this.drafts[entityId];
    if (!draft) return { saved, shown: saved };
    const shown = live ? { ...draft.layout, supply: saved.supply } : draft.layout;
    if (
      !draft.saving &&
      (sameLayout(shown, saved) || (draft.savedAt && Date.now() - draft.savedAt > SAVED_DRAFT_MS))
    ) {
      delete this.drafts[entityId];
      return { saved, shown: saved };
    }
    return { saved, shown, draft };
  }

  edit(hass, entityId, live, change) {
    const { saved, shown, draft } = this.layout(hass, entityId, live);
    if (draft?.saving) return;
    const layout = change(shown);
    if (sameLayout(layout, saved)) delete this.drafts[entityId];
    else this.drafts = { ...this.drafts, [entityId]: { layout } };
    delete this.errors[entityId];
    this.host.requestUpdate();
  }

  reset(entityId) {
    if (this.drafts[entityId]?.saving) return;
    delete this.drafts[entityId];
    delete this.errors[entityId];
    this.host.requestUpdate();
  }

  // Send the draft: the modules, then the power supply side, through the
  // card's command queue. The draft stays shown until the lamp reports it.
  async save(hass, entityId, live) {
    const { saved, shown, draft } = this.layout(hass, entityId, live);
    if (!draft || draft.saving) return;
    const calls = saveCalls(entityId, saved, shown);
    if (!calls.length) return;
    draft.layout = shown;
    draft.saving = true;
    delete this.errors[entityId];
    this.host.requestUpdate();
    try {
      for (const { service, data } of calls) {
        const sent = await this.host._commands.call(hass, "yeelight_cube", service, data);
        if (sent !== true) return; // the configuration changed meanwhile
      }
      draft.savedAt = Date.now();
      setTimeout(() => this.host.requestUpdate(), SAVED_DRAFT_MS + 50);
    } catch (error) {
      this.errors[entityId] = "The modules were not saved. Try again.";
      notifyUnreported(this.host, error, "The modules were not saved.");
    } finally {
      draft.saving = false;
      this.host.requestUpdate();
    }
  }

  /**
   * The section of one Cube Matrix lamp.
   * @param {Object} hass
   * @param {string} entityId
   * @param {Object} options
   *   config       the card's (remove_button_style, matrix_background,
   *                matrix_pixel_style; orientation_* for its own arrows)
   *   buttons      {buttonStyle, contentMode} of its buttons
   *   orientation  the host's orientation row (a template: the draft follows
   *                the lamp's), "draft" (its own arrows, saved with the
   *                modules) or null (none: the lamp's side)
   *   title        a heading (the lamp's name on the older card)
   */
  render(hass, entityId, { config = {}, buttons = {}, orientation = null, title = "Modules" } = {}) {
    const state = hass?.states?.[entityId];
    const live = orientation !== "draft";
    const available = lampAvailable(state);
    const { shown, draft } = this.layout(hass, entityId, live);
    const busy = !!draft?.saving;
    const edited = !!draft && !draft.savedAt;
    const count = shown.modules.length;
    const status = busy ? "Saving…" : edited ? "Edited" : "Saved";
    const pixelStyle = config.matrix_pixel_style || "circle";
    const background = config.matrix_background;
    const stage = `--ycm-dot-radius:${pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0"};--ycm-face-radius:${modulePreviewRadius(pixelStyle)};${
      background === "white" ? "--ycm-stage:#fff;" : background === "transparent" ? "--ycm-stage:transparent;" : ""
    }`;
    const error = this.errors[entityId];
    return html`<div class="ycm-editor" data-entity=${entityId}>
      <div class="ycm-head">
        <span class="ycm-title">${title}</span>
        <span class="ycm-status" data-state=${busy ? "saving" : edited ? "edited" : "saved"}
          >${status} · ${count}/${MAX_MODULES}</span
        >
      </div>
      ${orientation === "draft"
        ? html`<div class="orientation-controls">
            ${renderOrientationControls(
              { ...config, show_device_orientation: true },
              orientationForSupply(shown.supply),
              busy,
              (event) => {
                const button = event.target.closest("button[data-value]");
                if (!button || button.disabled) return;
                const value = button.dataset.value;
                const step = { clockwise: 1, counterclockwise: -1, "half-turn": 2 }[value];
                const target = step ? nextOrientation(orientationForSupply(shown.supply), step) : value;
                if (ORIENTATION_ORDER.includes(target))
                  this.edit(hass, entityId, false, (layout) => ({ ...layout, supply: supplyForOrientation(target) }));
              },
              "Lamp mounted",
            )}
          </div>`
        : orientation || nothing}
      <div class=${`ycm-stage${shown.supply === "up" || shown.supply === "down" ? " ycm-standing" : ""}`} style=${stage}>${this._chain(hass, entityId, shown, busy, live, config)}</div>
      <div class="ycm-hint">
        Add the modules in the order they are fitted, from the power supply. The lamp cannot detect its modules: a
        block missing from this list stays dark, except for one green light in its corner.
      </div>
      ${renderActionRow(
        html`${MODULE_TYPES.map(({ type, label, title: name }) =>
          renderActionButton({
            ...buttons,
            action: "add",
            compact: true,
            icon: "mdi:plus",
            label,
            title: `Add a ${name.charAt(0).toLowerCase()}${name.slice(1)}`,
            disabled: busy || count >= MAX_MODULES,
            dataMode: `add-${type}`,
            onClick: () => this.edit(hass, entityId, live, (layout) => withModuleAdded(layout, type)),
          }),
        )}`,
        buttons,
      )}
      ${renderActionRow(
        html`${renderActionButton({
          ...buttons,
          action: "clear",
          icon: "mdi:undo",
          label: "Reset",
          title: "Show the lamp's modules again",
          disabled: busy || !edited,
          dataMode: "reset",
          onClick: () => this.reset(entityId),
        })}${renderActionButton({
          ...buttons,
          action: "save",
          icon: "mdi:content-save-outline",
          label: "Save",
          title: count ? "Save to the lamp" : "Add at least one module",
          busy,
          busyLabel: "Saving…",
          disabled: !edited || !available || !count,
          dataMode: "save",
          onClick: () => this.save(hass, entityId, live),
        })}`,
        buttons,
      )}
      ${error ? html`<div class="ycm-error" role="alert">${error}</div>` : nothing}
    </div>`;
  }

  // The chain as fitted: the base on the power supply's side, the modules
  // away from it, then the place the next one goes.
  _chain(hass, entityId, layout, busy, live, config) {
    const vertical = layout.supply === "up" || layout.supply === "down";
    const long = layout.modules.length > 4;
    const cross = getDeleteButtonConfig(config, { inside: false, left: false });
    return html`<div
      class="ycm-chain ycm-from-${layout.supply} ${vertical ? "ycm-column" : "ycm-row"}${long ? " ycm-long" : ""}"
      role="list"
      aria-label="Modules from the power supply"
    >
      <div class="ycm-base" title="Power supply"><ha-icon icon="mdi:power-plug"></ha-icon></div>
      ${layout.modules.map(
        (type, index) => html`<div class="ycm-module" role="listitem" data-type=${type}
          title=${`${index + 1}. ${LABELS[type]}`}>
          ${moduleFace(type)}
          ${cross.allowDelete
            ? html`<button
                type="button"
                class=${`${cross.classes} ${cross.posClass}`}
                aria-label=${`Remove module ${index + 1}`}
                title="Remove"
                ?disabled=${busy}
                @click=${() => this.edit(hass, entityId, live, (current) => withModuleRemoved(current, index))}
              ></button>`
            : nothing}
        </div>`,
      )}
      ${layout.modules.length < MAX_MODULES
        ? html`<div class="ycm-slot" aria-hidden="true"><ha-icon icon=${ARROWS[layout.supply]}></ha-icon></div>`
        : nothing}
    </div>`;
  }
}

// A module as the preview draws it: a matrix's 25 dots, a spot's lens in its
// bezel, a panel's one face.
function moduleFace(type) {
  if (type === "matrix")
    return html`<div class="ycm-dots" aria-hidden="true">${Array.from({ length: 25 }, () => html`<span></span>`)}</div>`;
  const look = type === "spot" ? SPOT_LOOK : PANEL_LOOK;
  return html`<div
    class="ycm-face"
    data-type=${type}
    aria-hidden="true"
    style=${`background:${look.background};box-shadow:${look.boxShadow}`}
  ></div>`;
}
