import { escapeHtml } from "./html-escape-utils.js";
import {
  actionButtonGroupModel,
  renderActionButtonHTML,
  getActionRowClass,
} from "./action-button-utils.js";

export const COLOR_PRESET_STYLE_CHOICES = [
  { value: "label", label: "Swatch + name" },
  { value: "filled", label: "Filled" },
  { value: "name", label: "Name only" },
];

export const COLOR_PRESET_SHAPE_CHOICES = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
];

export const colorModeSelectorStyles = `
  .unified-color-modes { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .unified-color-modes > .shared-button-group.action-row { display:contents; }
  .unified-color-modes button { flex:0 0 auto; max-width:100%; min-height:36px; }
  .unified-color-modes .btn-text { white-space:normal; overflow-wrap:anywhere; }
  .unified-color-modes .color-add { display:inline-flex; }
  .unified-color-modes .color-add button:not(.btn-style-modern):not(.btn-style-gradient) { border:1px dashed var(--primary-color,#1976d2); }
  .unified-color-modes > .gc-selector { flex:1 1 180px; min-width:0; }
  .unified-color-modes .shared-action-button { flex:0 0 auto; width:auto; max-width:100%; }
  .unified-color-modes .shared-action-button.btn-style-icon { flex:0 0 44px; width:44px; height:44px; min-height:44px; padding:0; }
  .unified-color-modes .shared-action-button.btn-style-pill { min-height:44px; }
  .unified-color-modes .shared-button-group .shared-action-button.btn-fill { min-width:44px; min-height:44px; }
  .unified-color-modes .shared-action-button:not(.btn-style-icon):not(.btn-style-pill) {
    flex-direction:row; gap:6px; padding:8px 10px; line-height:1.15; min-width:36px; width:auto; min-height:36px;
  }
  .unified-color-modes .color-add .shared-action-button { min-height:36px; }
  .unified-color-modes .shared-button-group .btn-text { white-space:normal; overflow-wrap:break-word; word-break:normal; text-align:center; }
  .unified-color-modes .shared-button-group .shared-action-button.btn-style-pill { flex:0 0 auto; width:auto; }
  .unified-color-modes .shared-action-button.btn-style-pill .btn-text { white-space:nowrap; }
  .clock-color-save {
    flex:0 1 auto; min-width:0;
    --primary-color:var(--clock-save-accent, #2e8b57);
    --primary-color-dark:color-mix(in srgb, var(--clock-save-accent, #2e8b57) 72%, #000);
    --action-row-icon-align:flex-start;
  }
  .clock-color-save:empty { display:none; }
  .clock-color-save yeelight-clock-preset-manager { display:block; min-width:0; }
`;

export function matchingColorOption(options, color, selectedId, selectedName) {
  const matches = options.filter((option) =>
    option.color?.every((channel, index) => channel === color?.[index]),
  );
  return (
    matches.find((option) => option.value === `custom:${selectedId}`) ||
    matches.find((option) => option.label === selectedName) ||
    matches[0]
  );
}

export function renderColorModeSelector(
  config,
  options,
  current,
  {
    placeholder = "Current mode hidden",
    renderItem,
    disabled = false,
    draft = null,
  } = {},
) {
  const shape = ["square", "round"].includes(config.color_mode_shape)
    ? config.color_mode_shape
    : "rounded";
  const presetStyle =
    config.color_preset_style === "swatch"
      ? "filled"
      : config.color_preset_style || "label";
  const presetShape = ["square", "rounded", "circle"].includes(
    config.color_preset_shape,
  )
    ? config.color_preset_shape
    : "rounded";
  const hex = (color) =>
    `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const renderChoice =
    renderItem ||
    ((option) =>
      option.value === "__pick__"
        ? `<span class="color-add">${renderActionButtonHTML({
            ...option,
            action: "tool",
            role: "button",
            icon: "mdi:plus",
            label: draft ? "Change" : "Add",
            title: draft ? "Change unsaved colour" : "Add a colour",
            contentMode: "icon_text",
            selected: !!draft,
            swatch: draft ? hex(draft) : undefined,
            swatchShape: presetShape,
          })}</span>`
        : renderActionButtonHTML(option));
  if (config.color_mode_selector === "dropdown")
    return `<div class="gc-selector" data-shape="${shape}">
    <select class="mode-select colormode-select" aria-label="Colour mode"${disabled ? " disabled" : ""}>
      ${options.some((option) => option.value === current) ? "" : `<option value="" disabled selected>${escapeHtml(placeholder)}</option>`}
      ${options.map((option) => `<option value="${escapeHtml(option.value)}"${current === option.value ? " selected" : ""}${option.disabled ? " disabled" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select></div>`;
  return `<div class="color-mode-choices shared-button-group ${getActionRowClass({ buttonStyle: config.buttons_style || "modern", contentMode: config.buttons_content_mode || "icon_text" })}" role="radiogroup" aria-label="Colour mode">${actionButtonGroupModel(
    {
      buttonStyle: config.buttons_style || "modern",
      contentMode: config.buttons_content_mode || "icon_text",
      items: options.map((option) => ({
        ...option,
        ...(option.color
          ? presetStyle === "filled"
            ? {
                contentMode: "text",
                label: "",
                title: option.label,
                icon: "",
                fill: hex(option.color),
              }
            : presetStyle === "name"
              ? { contentMode: "text", icon: "" }
              : {
                  contentMode: "icon_text",
                  swatch: hex(option.color),
                  swatchShape: presetShape,
                }
          : {}),
        disabled: disabled || option.disabled,
      })),
      value: current,
    },
  )
    .map(renderChoice)
    .join("")}</div>`;
}
