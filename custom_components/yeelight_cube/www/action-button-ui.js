import { html, unsafeHTML } from "./lib/lit-all.js";
import { createButtonGroup } from "./button-group-utils.js";
import {
  actionButtonModel,
  actionButtonStyleChoices,
  actionButtonContentChoices,
  resolveActionButtonOptions,
  renderButtonContent,
  getActionRowClass,
  actionButtonGroupModel,
  handleActionButtonGroupEvent,
} from "./action-button-utils.js";

const nothing = Symbol.for("lit-nothing");

export function renderActionRow(content, options = {}) {
  return html`<div class=${getActionRowClass(options)}>${content}</div>`;
}

export function renderActionButtonContent(...args) {
  return unsafeHTML(renderButtonContent(...args));
}

export function renderActionButton(options = {}) {
  const model = actionButtonModel(options);
  return html`<button
    type=${model.type}
    class=${model.className}
    title=${model.title}
    aria-label=${model.title}
    aria-busy=${String(model.busy)}
    role=${model.role ?? nothing}
    aria-checked=${model.role === "radio" && model.selected !== undefined
      ? String(model.selected)
      : nothing}
    aria-pressed=${model.role !== "radio" && model.selected !== undefined
      ? String(model.selected)
      : nothing}
    data-value=${model.value ?? nothing}
    tabindex=${model.tabIndex ?? nothing}
    ?disabled=${model.disabled}
    @click=${options.onClick}
  >
    ${renderActionButtonContent(model.icon, model.label, model.contentMode)}
  </button>`;
}

export function renderActionButtonGroup(options, onChange) {
  return html`<div
    class="shared-button-group ${getActionRowClass(options)}"
    role=${options.multiple ? "group" : "radiogroup"}
    aria-label=${options.label}
    @click=${(event) => handleActionButtonGroupEvent(event, onChange)}
    @keydown=${(event) => handleActionButtonGroupEvent(event, onChange)}
  >
    ${actionButtonGroupModel(options).map(renderActionButton)}
  </div>`;
}

export function renderActionButtonSettings(
  config,
  onChange,
  {
    styleKey = "buttons_style",
    contentKey = "buttons_content_mode",
    defaultStyle = "modern",
    defaultContentMode = "icon_text",
  } = {},
) {
  const options = resolveActionButtonOptions({
    buttonStyle: config[styleKey] || defaultStyle,
    contentMode: config[contentKey] || defaultContentMode,
  });
  return html`
    <div class="form-row">
      <label>Buttons Style</label>
      ${createButtonGroup(
        actionButtonStyleChoices,
        options.buttonStyle,
        (event) => onChange(styleKey, event.currentTarget.dataset.value),
      )}
    </div>
    ${options.buttonStyle !== "icon"
      ? html`<div class="form-row">
          <label>Content Mode</label>
          ${createButtonGroup(
            actionButtonContentChoices,
            options.contentMode,
            (event) => onChange(contentKey, event.currentTarget.dataset.value),
          )}
        </div>`
      : ""}
  `;
}
