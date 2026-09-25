import { LitElement, html, css, unsafeHTML } from "./lib/lit-all.js";
import { sharedEditorStyles } from "./editor_ui_utils.js";
import { createSliderRow, formRowStyles } from "./form-row-utils.js";
import { renderMatrixPreview } from "./gallery-display-utils.js";
import { renderClockFrame, flipMatrixVertical } from "./clock-preview-utils.js";
import {
  clockAppearancePresets,
  clockSectionAppearance,
  APPEARANCE_PROFILES,
  normalizePreviewAppearance,
} from "./preview-appearance.js";

const labels = {
  background: "Background",
  pixels: "Pixel shape",
  spacing: "Pixel spacing",
  shadow: "Shadow",
  ignoreBlack: "Hide black pixels",
};
const choices = {
  background: ["black", "white", "transparent"],
  pixels: ["square", "rounded", "circle"],
  spacing: ["none", "subtle", "normal"],
};
const title = (value) => value[0].toUpperCase() + value.slice(1);
const own = (object, key) =>
  Object.prototype.hasOwnProperty.call(object || {}, key);
const sectionLabels = {
  lamp: "Lamp Preview",
  gallery: "Previews",
  favourites: "Favourites",
};

function sample(appearance) {
  const pixels = flipMatrixVertical(
    renderClockFrame(
      { clock_style_id: 6, clock_color_rgb: [70, 190, 180] },
      {},
      {},
      1,
    ),
  );
  const digits = pixels.filter((_, index) => index % 20 < 8);
  return html`<div class="appearance-sample" aria-hidden="true">
    ${unsafeHTML(
      renderMatrixPreview(digits, {
        cols: 8,
        forceAspectRatio: true,
        pixelStyle: appearance.pixels,
        pixelGap: appearance.spacing === "normal" ? 2 : 0,
        pixelBoxShadow: appearance.spacing !== "none",
        matrixBoxShadow: appearance.shadow,
        bgColor:
          appearance.background === "white"
            ? "#fff"
            : appearance.background === "black"
              ? "#000"
              : "transparent",
        ignoreBlackPixels:
          appearance.background !== "black" && appearance.ignoreBlack,
      }),
    )}
  </div>`;
}

function fields(values, change, overrides, reset, inheritance) {
  return html`<div class="appearance-fields">
    ${Object.keys(labels)
      .filter(
        (field) => field !== "ignoreBlack" || values.background !== "black",
      )
      .map((field) => {
        const overridden = overrides && own(overrides, field);
        const customSections = Object.keys(inheritance?.overrides || {}).filter(
          (section) => own(inheritance.overrides[section], field),
        );
        return html`<div class="appearance-field" data-field=${field}>
          <div class="appearance-field-heading">
            <span>${labels[field]}</span>
            ${!choices[field]
              ? html`<label class="toggle-switch appearance-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label=${labels[field]}
                    .checked=${values[field]}
                    @change=${(event) => change(field, event.target.checked)}
                  />
                  <span class="toggle-slider"></span>
                </label>`
              : ""}
            ${overrides
              ? html`<span class="appearance-source"
                  >${overridden ? "Custom" : "Card default"}</span
                >`
              : ""}
            ${overridden
              ? html`<button
                  type="button"
                  class="appearance-reset"
                  title=${`Reset ${labels[field].toLowerCase()} to card default`}
                  aria-label=${`Reset ${labels[field].toLowerCase()} to card default`}
                  @click=${() => reset(field)}
                >
                  <ha-icon icon="mdi:restore"></ha-icon>
                </button>`
              : ""}
          </div>
          ${choices[field]
            ? html`<div
                class="appearance-options"
                role="group"
                aria-label=${labels[field]}
              >
                ${choices[field].map(
                  (value) =>
                    html`<button
                      type="button"
                      title=${title(value)}
                      aria-label=${title(value)}
                      aria-pressed=${String(values[field] === value)}
                      @click=${() => change(field, value)}
                    >
                      ${field === "background"
                        ? html`<span
                            class="appearance-swatch ${value}"
                            aria-hidden="true"
                          ></span>`
                        : ""}
                      ${field === "pixels"
                        ? html`<span
                            class="appearance-pixel ${value}"
                            aria-hidden="true"
                          ></span>`
                        : ""}
                      <span>${title(value)}</span>
                    </button>`,
                )}
              </div>`
            : ""}
          ${customSections.length
            ? html`<div class="appearance-inheritance">
                <span
                  >Custom ${labels[field].toLowerCase()}:
                  ${customSections
                    .map(
                      (section) =>
                        inheritance?.labels?.[section] ||
                        sectionLabels[section],
                    )
                    .join(", ")}</span
                >
                <button
                  type="button"
                  class="appearance-link"
                  aria-label=${`Use card ${labels[field].toLowerCase()} for all previews`}
                  @click=${() => inheritance.resetField(field)}
                >
                  Use for all previews
                </button>
              </div>`
            : ""}
        </div>`;
      })}
  </div>`;
}

function renderPresetManager(config, change, editor, presets) {
  const editing = presets.find(
    (preset) => preset.id === editor._appearanceEditingPreset,
  );
  const name = editor._appearancePresetName ?? editing?.name ?? "";
  const duplicate = presets.some(
    (preset) =>
      preset.id !== editing?.id &&
      preset.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  const saved = presets
    .filter((preset) => preset.modified)
    .map(({ id, name, appearance }) => ({ id, name, appearance }));
  const clear = () => {
    editor._appearanceEditingPreset = "";
    editor._appearancePresetName = "";
    editor._appearanceDeleteId = null;
  };
  const remove = () => {
    const next = saved.filter((preset) => preset.id !== editing.id);
    clear();
    change("clock_appearance_presets", next);
  };
  return html`<details class="appearance-details" data-preset-manager>
    <summary>Manage presets</summary>
    <div class="form-row">
      <label for="appearance-preset-target">Save current appearance to</label>
      <select
        id="appearance-preset-target"
        @change=${(event) => {
          editor._appearanceEditingPreset = event.target.value;
          editor._appearancePresetName =
            presets.find((preset) => preset.id === event.target.value)?.name ||
            "";
          editor._appearanceDeleteId = null;
          editor.requestUpdate();
        }}
      >
        <option value="" ?selected=${!editing}>New preset</option>
        ${presets.map(
          (preset) =>
            html`<option
              value=${preset.id}
              ?selected=${editing?.id === preset.id}
            >
              ${preset.name}
            </option>`,
        )}
      </select>
    </div>
    <div class="form-row">
      <label for="appearance-preset-name">Preset name</label>
      <input
        id="appearance-preset-name"
        type="text"
        maxlength="60"
        autocomplete="off"
        .value=${name}
        aria-invalid=${String(duplicate)}
        @input=${(event) => {
          editor._appearancePresetName = event.target.value;
          editor.requestUpdate();
        }}
      />
    </div>
    ${duplicate
      ? html`<div class="appearance-error" role="alert">
          A preset with this name already exists.
        </div>`
      : ""}
    <div class="appearance-manager-actions">
      <button
        type="button"
        class="appearance-command"
        ?disabled=${!name.trim() || duplicate}
        @click=${() => {
          const id = editing?.id || `custom-${crypto.randomUUID()}`;
          const next = saved.filter((preset) => preset.id !== id);
          next.push({
            id,
            name: name.trim(),
            appearance: { ...config.clock_preview_appearance },
          });
          editor._appearanceEditingPreset = id;
          editor._appearancePresetName = name.trim();
          editor._appearanceDeleteId = null;
          change("clock_appearance_presets", next);
        }}
      >
        <ha-icon icon="mdi:content-save-outline"></ha-icon>${editing
          ? "Update preset"
          : "Save new preset"}
      </button>
      ${editing?.builtin && editing.modified
        ? html`<button
            type="button"
            class="appearance-command"
            @click=${remove}
          >
            <ha-icon icon="mdi:restore"></ha-icon>Restore original preset
          </button>`
        : ""}
      ${editing && !editing.builtin
        ? html`<button
            type="button"
            class="appearance-reset"
            title="Delete preset"
            aria-label="Delete preset"
            @click=${() => {
              editor._appearanceDeleteId = editing.id;
              editor.requestUpdate();
            }}
          >
            <ha-icon icon="mdi:delete-outline"></ha-icon>
          </button>`
        : ""}
    </div>
    ${editing && editor._appearanceDeleteId === editing.id
      ? html`<div
          class="appearance-delete-confirm"
          role="group"
          aria-label="Confirm preset deletion"
        >
          <span>Delete ${editing.name}?</span>
          <button type="button" class="appearance-command" @click=${remove}>
            Delete
          </button>
          <button
            type="button"
            class="appearance-command"
            @click=${() => {
              editor._appearanceDeleteId = null;
              editor.requestUpdate();
            }}
          >
            Cancel
          </button>
        </div>`
      : ""}
  </details>`;
}

export function renderClockSharedAppearance(config, change, editor) {
  const shared = config.clock_preview_appearance;
  const presets = clockAppearancePresets(config);
  const matches = presets.filter((preset) =>
    Object.keys(shared).every(
      (field) => preset.appearance[field] === shared[field],
    ),
  );
  const selected =
    matches.find((preset) => preset.id === editor._appearanceSelectedPreset) ||
    matches[0];
  const overrides = config.clock_preview_overrides || {};
  const customSections = Object.keys(overrides).filter(
    (section) => Object.keys(overrides[section]).length,
  );
  return html`<div class="clock-appearance" data-appearance="shared">
    <div class="appearance-preset-heading">
      <span>Preset</span
      ><span class="appearance-source">${selected?.name || "Custom"}</span>
    </div>
    <div
      class="appearance-presets"
      role="group"
      aria-label="Preview appearance preset"
    >
      ${presets.map(
        (preset) =>
          html`<button
            type="button"
            class="appearance-preset"
            aria-label=${`${preset.name} preset`}
            aria-pressed=${String(selected?.id === preset.id)}
            @click=${() => {
              editor._appearanceSelectedPreset = preset.id;
              change("clock_preview_appearance", { ...preset.appearance });
            }}
          >
            ${sample(preset.appearance)}<span>${preset.name}</span>
          </button>`,
      )}
    </div>
    <details class="appearance-details">
      <summary>Fine-tune appearance</summary>
      ${fields(
        shared,
        (field, value) =>
          change("clock_preview_appearance", { ...shared, [field]: value }),
        undefined,
        undefined,
        {
          overrides,
          labels: editor.appearanceSectionLabels,
          resetField: (field) =>
            change(
              "clock_preview_overrides",
              Object.fromEntries(
                Object.entries(overrides).map(([section, values]) => [
                  section,
                  Object.fromEntries(
                    Object.entries(values).filter(([key]) => key !== field),
                  ),
                ]),
              ),
            ),
        },
      )}
    </details>
    ${renderPresetManager(config, change, editor, presets)}
    ${customSections.length
      ? html`<div class="appearance-inheritance">
          <span
            >Custom sections:
            ${customSections
              .map(
                (section) =>
                  (editor.appearanceSectionLabels || {
                    lamp: "Lamp Preview",
                    gallery: "Previews",
                    favourites: "Favourites",
                  })[section],
              )
              .join(", ")}</span
          >
          <button
            type="button"
            class="appearance-link"
            @click=${() => {
              editor._appearanceCustom = {};
              change("clock_preview_overrides", {});
            }}
          >
            Use card default everywhere
          </button>
        </div>`
      : ""}
  </div>`;
}

export function renderClockSectionAppearance(config, change, section, editor) {
  const sizeKey = {
    lamp: "lamp_preview_size",
    gallery: "preview_size",
    favourites: "effect_preview_size",
  }[section];
  return html`<div class="clock-appearance" data-appearance=${section}>
    ${createSliderRow(
      "Size",
      config[sizeKey] ?? (section === "favourites" ? 100 : 55),
      { min: 30, max: 100, step: 5 },
      (event) => change(sizeKey, Number(event.target.value)),
      "%",
    )}
    ${renderSectionAppearance(config, change, section, editor)}
  </div>`;
}

function renderSectionAppearance(config, change, section, editor) {
  const overrides = config.clock_preview_overrides?.[section] || {};
  const custom =
    Object.keys(overrides).length > 0 || editor._appearanceCustom?.[section];
  const values = { ...config.clock_preview_appearance, ...overrides };
  const setOverrides = (next) =>
    change("clock_preview_overrides", {
      ...config.clock_preview_overrides,
      [section]: next,
    });
  return html`<div class="clock-appearance">
    <div class="appearance-preset-heading">
      <span>Appearance</span
      ><span class="appearance-source"
        >${Object.keys(overrides).length
          ? `${Object.keys(overrides).length} custom`
          : "Card default"}</span
      >
    </div>
    <div class="appearance-options" role="group" aria-label="Appearance source">
      ${[false, true].map(
        (value) =>
          html`<button
            type="button"
            aria-pressed=${String(!!custom === value)}
            @click=${() => {
              editor._appearanceCustom = {
                ...editor._appearanceCustom,
                [section]: value,
              };
              if (!value) setOverrides({});
              editor.requestUpdate();
            }}
          >
            ${value ? "Custom" : "Card default"}
          </button>`,
      )}
    </div>
    ${custom
      ? html`${fields(
          values,
          (field, value) => setOverrides({ ...overrides, [field]: value }),
          overrides,
          (field) => {
            const next = { ...overrides };
            delete next[field];
            setOverrides(next);
          },
        )}`
      : ""}
  </div>`;
}

export const clockAppearanceEditorStyles = css`
  ${formRowStyles}
  .appearance-switch {
    margin-left: auto;
    flex: 0 0 44px;
  }
  .appearance-switch input:focus-visible + .toggle-slider {
    outline: 2px solid var(--primary-color);
    outline-offset: 3px;
  }
  .appearance-manager-actions,
  .appearance-delete-confirm {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .appearance-delete-confirm {
    margin-top: 12px;
  }
  .appearance-command {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    min-height: 36px;
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 6px;
    background: var(--card-background-color, #fff);
    color: var(--primary-color, #03a9f4);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .appearance-command:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .appearance-command ha-icon {
    --mdc-icon-size: 20px;
  }
  .appearance-error {
    color: var(--error-color, #b3261e);
    font-size: 13px;
    margin-bottom: 8px;
  }
  [data-preset-manager] .form-row {
    margin-top: 12px;
  }
  [data-preset-manager] input,
  [data-preset-manager] select {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .clock-appearance {
    min-width: 0;
  }
  .appearance-presets {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 10px 0 16px;
  }
  .appearance-preset {
    min-width: 0;
    padding: 10px 6px;
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 8px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #222);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  .appearance-preset[aria-pressed="true"],
  .appearance-options button[aria-pressed="true"] {
    border-color: var(--primary-color, #03a9f4);
    box-shadow: inset 0 0 0 1px var(--primary-color, #03a9f4);
  }
  .appearance-sample {
    aspect-ratio: 8 / 5;
    margin: 4px 0 12px;
    pointer-events: none;
  }
  .appearance-preset-heading,
  .appearance-field-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-height: 32px;
  }
  .appearance-source {
    color: var(--secondary-text-color, #666);
    font-size: 12px;
    margin-left: auto;
  }
  .appearance-details {
    border-top: 1px solid var(--divider-color, #ddd);
    padding: 12px 0;
  }
  .appearance-details summary {
    cursor: pointer;
    font-size: 14px;
  }
  .appearance-fields {
    margin-top: 8px;
  }
  .appearance-field {
    padding: 8px 0;
  }
  .appearance-options {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .appearance-options button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 1 1 auto;
    min-height: 36px;
    padding: 6px 8px;
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 6px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #222);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .appearance-swatch,
  .appearance-pixel {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    border: 1px solid #888;
  }
  .appearance-swatch.black {
    background: #000;
  }
  .appearance-swatch.white {
    background: #fff;
  }
  .appearance-swatch.transparent {
    background: repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 0 / 8px 8px;
  }
  .appearance-pixel {
    background: var(--primary-color, #03a9f4);
    border: 0;
  }
  .appearance-pixel.rounded {
    border-radius: 4px;
  }
  .appearance-pixel.circle {
    border-radius: 50%;
  }
  .appearance-reset {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 4px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--primary-color, #03a9f4);
    cursor: pointer;
  }
  .appearance-reset ha-icon {
    --mdc-icon-size: 20px;
  }
  .appearance-inheritance {
    border-top: 1px solid var(--divider-color, #ddd);
    padding-top: 12px;
    font-size: 12px;
    color: var(--secondary-text-color, #666);
  }
  .appearance-link {
    display: block;
    border: 0;
    background: none;
    color: var(--primary-color, #03a9f4);
    font: inherit;
    padding: 8px 0;
    text-align: left;
    cursor: pointer;
  }
  .clock-appearance button:focus-visible,
  .clock-appearance summary:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 3px;
  }
  .clock-appearance span {
    overflow-wrap: anywhere;
  }
`;

export class PreviewAppearanceEditor extends LitElement {
  static properties = {
    config: { attribute: false },
    profile: { type: String },
    section: { type: String },
    owner: { attribute: false },
  };
  static styles = [
    sharedEditorStyles,
    clockAppearanceEditorStyles,
    css`
      :host {
        display: block;
        margin: 12px 0;
        min-width: 0;
      }
    `,
  ];
  constructor() {
    super();
    this.config = {};
    this.profile = "native";
    this.section = "shared";
  }
  get _appearanceCustom() {
    return this.owner
      ? this.owner._appearanceCustom
      : this._localAppearanceCustom;
  }
  set _appearanceCustom(value) {
    if (this.owner) this.owner._appearanceCustom = value;
    else this._localAppearanceCustom = value;
  }
  render() {
    const config = normalizePreviewAppearance(this.config, this.profile);
    const definitions = APPEARANCE_PROFILES[this.profile];
    this.appearanceSectionLabels = Object.fromEntries(
      Object.entries(definitions).map(([name, section]) => [
        name,
        section.label,
      ]),
    );
    const change = (key, value) => {
      const keys = {
        clock_preview_appearance: "preview_appearance",
        clock_preview_overrides: "preview_overrides",
        clock_appearance_presets: "appearance_presets",
      };
      this.config = { ...config, [keys[key] || key]: value };
      this.dispatchEvent(
        new CustomEvent("appearance-changed", {
          detail: { config: this.config },
          bubbles: true,
          composed: true,
        }),
      );
      this.requestUpdate();
    };
    const virtual = {
      ...config,
      clock_preview_appearance: config.preview_appearance,
      clock_preview_overrides: config.preview_overrides,
      clock_appearance_presets: config.appearance_presets,
    };
    if (this.section === "shared") {
      return renderClockSharedAppearance(virtual, change, this);
    }
    if (definitions[this.section]) {
      return html`<div data-appearance=${this.section}>
        ${renderSectionAppearance(virtual, change, this.section, this)}
      </div>`;
    }
    return html``;
  }
}

customElements.define(
  "yeelight-preview-appearance-editor",
  PreviewAppearanceEditor,
);
