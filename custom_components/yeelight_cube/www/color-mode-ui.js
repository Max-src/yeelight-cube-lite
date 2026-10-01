import { LitElement, html, repeat } from "./lib/lit-all.js";
import { colorModeSelectorModel } from "./color-mode-selector-utils.js";
import {
  handleActionButtonGroupEvent,
  DEFAULT_BUTTON_STYLE,
  DEFAULT_BUTTON_CONTENT_MODE,
} from "./action-button-utils.js";
import { renderActionButton } from "./action-button-ui.js";
import "./clock-preset-manager.js";
import { defineOnce } from "./card-registration.js";

/** Shared color interaction view. Domain adapters provide selector values,
 * RGB drafts and save kinds; the view owns bindings and stable save-form DOM.
 */
class YeelightColorMode extends LitElement {
  static properties = {
    config: { attribute: false },
    options: { attribute: false },
    selected: {},
    draft: { attribute: false },
    disabled: { type: Boolean },
    hass: { attribute: false },
    saveKinds: { attribute: false },
    previewAttrs: { attribute: false },
    onSelect: { attribute: false },
    onSaved: { attribute: false },
  };

  constructor() {
    super();
    this.config = {};
    this.options = [];
    this.saveKinds = [];
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("yc-stack", "yc-controls");
  }

  render() {
    return html`<div
        class="unified-color-modes colormode-buttons"
        data-clock-control="colormode"
      >
        ${this._selector()}
      </div>
      ${this.draft && this.saveKinds.length
        ? html`<div class="clock-color-control">
            <div class="clock-color-save">
              <yeelight-clock-preset-manager
                .hass=${this.hass}
                .compact=${true}
                .saveKinds=${this.saveKinds}
                .previewAttrs=${this.previewAttrs}
                .initialColor=${`#${this.draft.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`}
                .buttonStyle=${this.config.buttons_style || DEFAULT_BUTTON_STYLE}
                .contentMode=${this.config.buttons_content_mode || DEFAULT_BUTTON_CONTENT_MODE}
                @clock-preset-saved=${(event) =>
                  this.onSaved?.(event.detail || {})}
              ></yeelight-clock-preset-manager>
            </div>
          </div>`
        : ""}`;
  }

  // The color modes as a dropdown or a row of shared buttons. Buttons are
  // keyed by value, so a selection updates them in place (no re-created row).
  _selector() {
    const model = colorModeSelectorModel(
      this.config,
      this.options,
      this.selected,
      {
        disabled: this.disabled,
        placeholder: this.draft ? "Unsaved color" : "Current mode hidden",
        draft: this.draft,
      },
    );
    if (model.kind === "dropdown")
      return html`<div class="gc-selector" data-shape=${model.shape}>
        <select
          class="mode-select colormode-select"
          aria-label="Color mode"
          ?disabled=${model.disabled}
          .value=${model.placeholder === null ? this.selected : ""}
          @change=${(event) => this.onSelect?.(event.target.value)}
        >
          ${model.placeholder === null
            ? ""
            : html`<option value="" disabled selected>
                ${model.placeholder}
              </option>`}
          ${model.options.map(
            (option) =>
              html`<option
                value=${option.value}
                ?selected=${option.selected}
                ?disabled=${option.disabled}
              >
                ${option.label}
              </option>`,
          )}
        </select>
      </div>`;
    const choose = (event) =>
      handleActionButtonGroupEvent(event, (value) => this.onSelect?.(value));
    return html`<div
      class=${`color-mode-choices shared-button-group ${model.rowClass}`}
      role="radiogroup"
      aria-label="Color mode"
      @click=${choose}
      @keydown=${choose}
    >
      ${repeat(
        model.buttons,
        (button) => button.value,
        (button) =>
          button.add
            ? html`<span class="color-add">${renderActionButton(button)}</span>`
            : renderActionButton(button),
      )}
    </div>`;
  }

  async getUpdateComplete() {
    const complete = await super.getUpdateComplete();
    await this.querySelector("yeelight-clock-preset-manager")?.updateComplete;
    return complete;
  }
}

defineOnce("yeelight-color-mode", YeelightColorMode);
