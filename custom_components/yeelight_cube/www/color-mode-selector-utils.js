import { escapeHtml } from "./html-escape-utils.js";
import {
  actionButtonGroupModel,
  renderActionButtonHTML,
} from "./action-button-utils.js";

export function renderColorModeSelector(
  config,
  options,
  current,
  {
    placeholder = "Current mode hidden",
    renderItem = renderActionButtonHTML,
    disabled = false,
  } = {},
) {
  const shape = ["square", "round"].includes(config.color_mode_shape)
    ? config.color_mode_shape
    : "rounded";
  if (config.color_mode_selector === "dropdown")
    return `<div class="gc-selector" data-shape="${shape}">
    <select class="mode-select colormode-select" aria-label="Colour mode"${disabled ? " disabled" : ""}>
      ${options.some((option) => option.value === current) ? "" : `<option value="" disabled selected>${escapeHtml(placeholder)}</option>`}
      ${options.map((option) => `<option value="${escapeHtml(option.value)}"${current === option.value ? " selected" : ""}${option.disabled ? " disabled" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select></div>`;
  return `<div class="shared-button-group action-row" role="radiogroup" aria-label="Colour mode">${actionButtonGroupModel(
    {
      buttonStyle: config.buttons_style || "modern",
      contentMode: config.buttons_content_mode || "icon_text",
      items: options.map((option) => ({
        ...option,
        disabled: disabled || option.disabled,
      })),
      value: current,
    },
  )
    .map(renderItem)
    .join("")}</div>`;
}
