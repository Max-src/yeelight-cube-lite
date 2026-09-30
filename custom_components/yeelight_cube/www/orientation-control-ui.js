import { html } from "./lib/lit-all.js";
import { createButtonGroup } from "./button-group-utils.js";
import { renderOrderableList } from "./orderable-list-utils.js";
import {
  actionButtonStyleChoices,
  actionButtonContentChoices,
} from "./action-button-utils.js";
import {
  ORIENTATION_CHOICES,
  ORIENTATION_ORDER,
  orientationOptions,
  orientationControlModel,
} from "./orientation-control-utils.js";
import { renderActionButton } from "./action-button-ui.js";

// lit-all.js does not re-export `nothing`; Lit defines it as this global symbol.
const nothing = Symbol.for("lit-nothing");

/**
 * The device-orientation row as a Lit template ("" when hidden). `onClick`
 * receives every click on the row; buttons carry their value in data-value.
 */
export function renderOrientationControls(config, current, unavailable, onClick) {
  const model = orientationControlModel(config, current, unavailable);
  if (!model) return "";
  const button = (item) =>
    model.style === "original"
      ? html`<button
          type="button"
          class=${`orient-btn${item.selected ? " active" : ""}`}
          data-value=${item.value}
          title=${item.label}
          aria-label=${item.label}
          aria-pressed=${item.selected === undefined
            ? nothing
            : String(item.selected)}
          ?disabled=${item.disabled}
        >
          ${item.glyph || html`<ha-icon icon=${item.icon}></ha-icon>`}
        </button>`
      : renderActionButton({
          action: "tool",
          buttonStyle: model.style,
          contentMode: model.contentMode,
          value: item.value,
          label: item.label,
          icon: item.icon,
          selected: item.selected,
          disabled: item.disabled,
        });
  return html`<div
    class="device-orientation-row"
    role="group"
    aria-label="Device orientation"
    @click=${onClick}
  >
    <div class="orientation-buttons">${model.buttons.map(button)}</div>
  </div>`;
}
import { renderModeSettingsSection } from "./editor_ui_utils.js";

export function renderOrientationSettings(config, onChange) {
  const options = orientationOptions(config);
  const choices = (label, key, items, value) =>
    html` <div class="form-row">
      <label>${label}</label>
      ${createButtonGroup(items, value, (event) =>
        onChange(key, event.currentTarget.dataset.value),
      )}
    </div>`;
  return html`
    ${choices(
      "Button Style",
      "orientation_button_style",
      [{ value: "original", label: "Original" }, ...actionButtonStyleChoices],
      options.style,
    )}
    ${!["original", "icon"].includes(options.style)
      ? renderModeSettingsSection(
          "Button Content",
          choices(
            "Content",
            "orientation_content_mode",
            actionButtonContentChoices,
            options.contentMode,
          ),
        )
      : ""}
    <div class="form-row"><label>Available Directions</label></div>
    ${renderOrderableList({
      items: options.buttons,
      available: ORIENTATION_CHOICES.map(({ value }) => value).filter(
        (value) => !options.buttons.includes(value),
      ),
      labelFor: (value) =>
        ORIENTATION_CHOICES.find((choice) => choice.value === value)?.label ||
        value,
      onUpdate: (buttons) => onChange("orientation_buttons", buttons),
      onReset: () => onChange("orientation_buttons", [...ORIENTATION_ORDER]),
      addPlaceholder: "Add button",
    })}
  `;
}
