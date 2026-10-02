import { html } from "./lib/lit-all.js";
import { createButtonGroup } from "./button-group-utils.js";
import {
  actionButtonModel,
  actionButtonStyleChoices,
  actionButtonContentChoices,
  resolveActionButtonOptions,
  getActionRowClass,
  actionButtonGroupModel,
  handleActionButtonGroupEvent,
} from "./action-button-utils.js";
import { nothing } from "./lit-extras.js";

export function renderActionRow(content, options = {}) {
  return html`<div class=${getActionRowClass(options)}>${content}</div>`;
}

/**
 * A button's icon/swatch and label as a Lit template: labels (favourite and
 * preset names) are bound as text, never parsed as HTML. A status button
 * (isStatus) shows a success/error icon and text instead.
 */
export function renderActionButtonContent(
  icon,
  text,
  contentMode = "icon_text",
  isStatus = false,
  statusType = null,
  swatch = null,
  swatchShape = null,
) {
  if (isStatus) {
    const success = statusType === "success";
    icon = success ? "mdi:check" : "mdi:alert-circle";
    text = success ? "Success!" : "Error!";
    swatch = null;
  }
  const shape =
    swatchShape === "square"
      ? " btn-swatch-square"
      : swatchShape === "circle" || swatchShape === "round"
        ? " btn-swatch-round"
        : "";
  const visual = swatch
    ? html`<span class=${`btn-swatch${shape}`} style=${`background:${swatch}`}></span>`
    : html`<ha-icon icon=${icon}></ha-icon>`;
  switch (contentMode) {
    case "icon":
      return visual;
    case "text":
      return text;
    case "icon_text":
    default:
      return html`${visual}<span class="btn-text">${text}</span>`;
  }
}

export function renderActionButton(options = {}) {
  const model = actionButtonModel(options);
  return html`<button
    type=${model.type}
    class=${model.className}
    title=${model.title}
    aria-label=${model.title}
    aria-busy=${String(model.busy)}
    style=${model.fill
      ? `--btn-fill:${model.fill};--btn-ink:${model.ink}`
      : nothing}
    role=${model.role ?? nothing}
    aria-checked=${model.role === "radio" && model.selected !== undefined
      ? String(model.selected)
      : nothing}
    aria-pressed=${model.role !== "radio" && model.selected !== undefined
      ? String(model.selected)
      : nothing}
    data-value=${model.value ?? nothing}
    data-mode=${options.dataMode ?? nothing}
    tabindex=${model.tabIndex ?? nothing}
    ?disabled=${model.disabled}
    @click=${options.onClick}
  >
    ${renderActionButtonContent(
      model.icon,
      model.label,
      model.contentMode,
      false,
      null,
      model.swatch,
      model.swatchShape,
    )}
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
