import { LitElement, html, css, unsafeCSS } from "./lib/lit-all.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { renderActionButton, renderActionRow } from "./action-button-ui.js";
import { handleColorPickerClick } from "./color-picker-utils.js";
import {
  clockPresetLibrary,
  clockPresetsByKind,
} from "./clock-preset-utils.js";
import { renderClockFrame, flipMatrixVertical } from "./clock-preview-utils.js";

// Trigger buttons for each save destination (shown under Custom on the card).
const SAVE_TRIGGERS = {
  color_mode: { icon: "mdi:palette", label: "Save colour mode" },
  style: { icon: "mdi:clock-outline", label: "Save clock style" },
};

class ClockPresetManager extends LitElement {
  static properties = {
    hass: { attribute: false },
    initialColor: { attribute: false },
    saveKinds: { attribute: false },
    previewAttrs: { attribute: false },
    kind: { state: true },
    libraryKind: { state: true },
    showLibrary: { type: Boolean },
    compact: { type: Boolean, reflect: true },
    buttonStyle: { type: String },
    contentMode: { type: String },
    editing: { state: true },
    name: { state: true },
    color: { state: true },
    busy: { state: true },
    error: { state: true },
    deleting: { state: true },
  };

  constructor() {
    super();
    this.editing = false;
    this.name = "";
    this.color = "#ffee00";
    this.busy = false;
    this.error = "";
    this.deleting = null;
    this.kind = "style";
    this.libraryKind = "style";
    this.saveKinds = ["color_mode", "style"];
  }

  static styles = css`
    ${unsafeCSS(actionButtonStyles)}
    :host {
      display: block;
      color: var(--primary-text-color, #222);
    }
    /* Inline in the colour row: drop the leading action-row margin and match
       the height of the neighbouring control buttons. */
    :host([compact]) .action-row {
      margin-top: 0;
    }
    :host([compact]) .action-row .shared-action-button {
      min-height: 44px;
      padding: 8px 12px;
    }
    /* Inline save triggers share one row and may wrap on very narrow cards. */
    :host([compact]:not([editing])) .action-row {
      flex-wrap: wrap;
    }
    /* Text/label triggers stretch to share the row; icon-only triggers keep
       their fixed square size instead of ballooning into wide pills. */
    :host([compact]:not([editing]))
      .action-row
      .shared-action-button:not(.btn-style-icon) {
      /* flex: 1 1 140px; */
      max-width: fit-content;
    }
    input {
      font: inherit;
      box-sizing: border-box;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      min-width: 0;
    }
    legend {
      font-size: 13px;
      margin-bottom: 6px;
    }
    .kind-options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .kind-options label {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 8px;
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 6px;
      cursor: pointer;
    }
    .kind-options label:has(input:checked) {
      border-color: var(--primary-color, #1976d2);
      background: color-mix(
        in srgb,
        var(--primary-color, #1976d2) 10%,
        transparent
      );
    }
    .library-kind {
      margin: 12px 0 8px;
    }
    .library {
      max-height: 240px;
      overflow-y: auto;
      margin-top: 8px;
    }
    .entry {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--divider-color, #ddd);
    }
    .entry span {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .swatch {
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: 1px solid #8886;
      flex-shrink: 0;
    }
    form {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }
    .form-kind {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--secondary-text-color, #777);
    }
    label {
      display: grid;
      gap: 5px;
      font-size: 13px;
    }
    input[type="text"] {
      width: 100%;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--divider-color, #aaa);
      border-radius: 4px;
      background: var(--card-background-color, #fff);
      color: inherit;
    }
    input[type="color"] {
      width: 48px;
      height: 34px;
      padding: 2px;
      border: 1px solid var(--divider-color, #aaa);
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
    }
    .preview {
      display: grid;
      grid-template-columns: repeat(20, 1fr);
      aspect-ratio: 4;
      background: #000;
      padding: 6px;
      gap: 2px;
      width: 100%;
      max-width: 240px;
      box-sizing: border-box;
    }
    .pixel {
      aspect-ratio: 1;
      min-width: 0;
      border-radius: 1px;
    }
    .error {
      color: var(--error-color, #b00020);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .status {
      font-size: 13px;
      color: var(--secondary-text-color, #777);
    }
  `;

  _open(preset, kind) {
    this.editing = preset?.id || true;
    this.name = preset?.name || "";
    this.color = preset
      ? this._hex(preset.color)
      : this.initialColor || "#ffee00";
    this.error = "";
    this.deleting = null;
    this.kind = preset
      ? preset.kind || "style"
      : kind || (this.showLibrary ? this.libraryKind : "color_mode");
    this.updateComplete.then(() =>
      this.renderRoot.querySelector('input[type="text"]')?.focus(),
    );
  }

  _hex(color) {
    return `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  _rgb() {
    return [1, 3, 5].map((offset) =>
      parseInt(this.color.slice(offset, offset + 2), 16),
    );
  }

  async _save(event) {
    event.preventDefault();
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    const isNew = typeof this.editing !== "string";
    try {
      const data = {
        name: this.name.trim().replace(/\s+/g, " "),
        color: this._rgb(),
        kind: this.kind,
      };
      if (!isNew) data.preset_id = this.editing;
      await this.hass.callService("yeelight_cube", "save_clock_preset", data);
      this.editing = false;
      this.libraryKind = this.kind;
      if (isNew)
        this.dispatchEvent(
          new CustomEvent("clock-preset-saved", {
            detail: { kind: data.kind, name: data.name, color: data.color },
            bubbles: true,
            composed: true,
          }),
        );
    } catch (error) {
      this.error = error.message || String(error);
    } finally {
      this.busy = false;
    }
  }

  async _delete(preset) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await this.hass.callService("yeelight_cube", "delete_clock_preset", {
        preset_id: preset.id,
      });
      this.deleting = null;
      if (this.editing === preset.id) this.editing = false;
    } catch (error) {
      this.error = error.message || String(error);
    } finally {
      this.busy = false;
    }
  }

  _button(options) {
    return renderActionButton({
      buttonStyle: this.buttonStyle || "modern",
      contentMode: this.contentMode || "icon_text",
      compact: true,
      disabled: this.busy,
      ...options,
    });
  }

  _actionRow(content) {
    return renderActionRow(content, {
      buttonStyle: this.buttonStyle,
      contentMode: this.contentMode,
    });
  }

  updated() {
    // Reflect the open form so a host can react (e.g. hide a sibling picker).
    this.toggleAttribute("editing", !!this.editing);
  }

  render() {
    const available = !!this.hass?.services?.yeelight_cube?.save_clock_preset;
    const library = clockPresetLibrary(this.hass);
    const presets = clockPresetsByKind(library, this.libraryKind);
    const frame = this.editing
      ? flipMatrixVertical(
          renderClockFrame(
            {
              ...(this.kind === "color_mode" ? this.previewAttrs : {}),
              clock_style_id:
                this.kind === "color_mode"
                  ? (this.previewAttrs?.clock_style_id ?? 4)
                  : 4,
              clock_color_mode: "normal",
              clock_color_rgb: this._rgb(),
              clock_content: "time",
            },
            null,
            null,
          ),
        )
      : [];
    return html`
      ${this.showLibrary
        ? this._actionRow(
            this._button({
              action: "add",
              icon: "mdi:plus",
              label: "Add preset",
              disabled: !available || this.busy,
              onClick: () => this._open(),
            }),
          )
        : !this.editing
          ? this._actionRow(
              (this.saveKinds || []).map((kind) =>
                this._button({
                  action: "save",
                  icon: SAVE_TRIGGERS[kind].icon,
                  label: SAVE_TRIGGERS[kind].label,
                  // Inline in the colour row each trigger fills its slot.
                  compact: !this.compact,
                  disabled: !available || this.busy,
                  onClick: () => this._open(undefined, kind),
                }),
              ),
            )
          : ""}
      ${!available
        ? html`<p class="status">
            Clock preset services unavailable. Reload the integration.
          </p>`
        : ""}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ""}
      ${this.editing
        ? html` <form @submit=${(event) => this._save(event)}>
            <p class="form-kind">
              ${typeof this.editing === "string"
                ? "Edit preset"
                : SAVE_TRIGGERS[this.kind]?.label}
            </p>
            <label
              >Name<input
                type="text"
                required
                maxlength="40"
                .value=${this.name}
                ?disabled=${this.busy}
                @input=${(event) => {
                  this.name = event.target.value;
                }}
            /></label>
            <label
              >Colour<input
                type="color"
                .value=${this.color}
                ?disabled=${this.busy}
                @click=${(event) => handleColorPickerClick(event, this)}
                @input=${(event) => {
                  this.color = event.target.value;
                }}
            /></label>
            <div class="preview" role="img" aria-label="Clock colour preview">
              ${frame.map(
                (pixel) =>
                  html`<span
                    class="pixel"
                    style="background:rgb(${pixel.join(",")})"
                  ></span>`,
              )}
            </div>
            ${this._actionRow(html`
              ${this._button({
                type: "submit",
                label: "Save",
                busy: this.busy,
                busyLabel: "Saving...",
              })}
              ${this._button({
                action: "tool",
                icon: "mdi:close",
                label: "Cancel",
                onClick: () => {
                  this.editing = false;
                  this.error = "";
                },
              })}
            `)}
          </form>`
        : ""}
      ${this.showLibrary
        ? html` <fieldset class="library-kind" ?disabled=${this.busy}>
              <legend>Saved presets</legend>
              <div class="kind-options">
                ${[
                  ["style", "Clock styles"],
                  ["color_mode", "Colour modes"],
                ].map(
                  ([value, label]) => html`
                    <label
                      ><input
                        type="radio"
                        name="library-kind"
                        value=${value}
                        .checked=${this.libraryKind === value}
                        @change=${() => {
                          this.libraryKind = value;
                          this.editing = false;
                          this.error = "";
                          this.deleting = null;
                        }}
                      />${label}
                      (${clockPresetsByKind(library, value).length})</label
                    >
                  `,
                )}
              </div>
            </fieldset>
            <div class="library">
              ${presets.length
                ? ""
                : html`<p class="status">
                    No saved
                    ${this.libraryKind === "style"
                      ? "clock styles"
                      : "colour modes"}.
                  </p>`}
              ${presets.map(
                (preset) =>
                  html` <div class="entry">
                    <i
                      class="swatch"
                      style="background:${this._hex(preset.color)}"
                    ></i
                    ><span>${preset.name}</span>
                    ${this.deleting === preset.id
                      ? html` ${this._button({
                          action: "clear",
                          icon: "mdi:check",
                          label: "Delete?",
                          title: `Confirm deletion of ${preset.name}`,
                          onClick: () => this._delete(preset),
                        })}
                        ${this._button({
                          action: "tool",
                          icon: "mdi:close",
                          label: "Cancel deletion",
                          contentMode: "icon",
                          onClick: () => {
                            this.deleting = null;
                          },
                        })}`
                      : html` ${this._button({
                          action: "tool",
                          icon: "mdi:pencil",
                          label: "Edit preset",
                          contentMode: "icon",
                          onClick: () => this._open(preset),
                        })}
                        ${this._button({
                          action: "clear",
                          icon: "mdi:delete-outline",
                          label: "Delete preset",
                          contentMode: "icon",
                          onClick: () => {
                            this.deleting = preset.id;
                          },
                        })}`}
                  </div>`,
              )}
            </div>`
        : ""}
    `;
  }
}

if (!customElements.get("yeelight-clock-preset-manager")) {
  customElements.define("yeelight-clock-preset-manager", ClockPresetManager);
}
