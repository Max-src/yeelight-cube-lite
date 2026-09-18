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
} from "./orientation-control-utils.js";
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
