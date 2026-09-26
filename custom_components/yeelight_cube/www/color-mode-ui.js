import { LitElement, html, unsafeHTML } from "./lib/lit-all.js";
import { renderColorModeSelector } from "./color-mode-selector-utils.js";
import { bindActionButtonGroup } from "./action-button-utils.js";
import "./clock-preset-manager.js";

/** Shared colour interaction view. Domain adapters provide selector values,
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
        ${unsafeHTML(
          renderColorModeSelector(this.config, this.options, this.selected, {
            disabled: this.disabled,
            placeholder: this.draft ? "Unsaved colour" : "Current mode hidden",
            draft: this.draft,
          }),
        )}
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
                .buttonStyle=${this.config.buttons_style || "modern"}
                .contentMode=${this.config.buttons_content_mode || "icon_text"}
                @clock-preset-saved=${(event) =>
                  this.onSaved?.(event.detail || {})}
              ></yeelight-clock-preset-manager>
            </div>
          </div>`
        : ""}`;
  }

  updated() {
    bindActionButtonGroup(this.querySelector(".shared-button-group"), (value) =>
      this.onSelect?.(value),
    );
    const dropdown = this.querySelector(".colormode-select");
    if (dropdown)
      dropdown.onchange = (event) => this.onSelect?.(event.target.value);
  }

  async getUpdateComplete() {
    const complete = await super.getUpdateComplete();
    await this.querySelector("yeelight-clock-preset-manager")?.updateComplete;
    return complete;
  }
}

customElements.define("yeelight-color-mode", YeelightColorMode);
