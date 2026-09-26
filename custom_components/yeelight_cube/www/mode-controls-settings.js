/** Editor-only controls. Runtime cards import mode-controls-ui instead. */
import {
  COLOR_PRESET_STYLE_CHOICES,
  COLOR_PRESET_SHAPE_CHOICES,
} from "./color-mode-selector-utils.js";

import { html } from "./lib/lit-all.js";
import { renderActionButtonSettings } from "./action-button-ui.js";
import { modeActionOptions } from "./action-button-utils.js";
import { renderOrientationSettings } from "./orientation-control-ui.js";
import { renderOrderableList } from "./orderable-list-utils.js";
import { createToggleRow } from "./form-row-utils.js";
import { createButtonGroup } from "./button-group-utils.js";
import {
  renderModeSettingsSection,
  renderMatrixAppearanceSettings,
} from "./editor_ui_utils.js";
import {
  rotationIntervalParts,
  ROTATION_INTERVAL_UNITS,
  actionButtonOrder,
  ACTION_BUTTON_KEYS,
  ACTION_BUTTON_LABELS,
} from "./mode-controls-controller.js";

export function renderColorModeSettings(config, change) {
  const choices = (label, key, values, fallback) =>
    html`<div class="form-row">
      <label>${label}</label>${createButtonGroup(
        values.map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        })),
        config[key] || fallback,
        (event) => change(key, event.currentTarget.dataset.value),
      )}
    </div>`;
  return html`${choices(
      "Presentation",
      "color_mode_selector",
      ["buttons", "dropdown"],
      "buttons",
    )}${config.color_mode_selector === "dropdown"
      ? choices(
          "Item Shape",
          "color_mode_shape",
          ["square", "rounded", "round"],
          "rounded",
        )
      : ""}
    <div class="form-row">
      <label>Custom colour modes style</label>
      ${createButtonGroup(
        COLOR_PRESET_STYLE_CHOICES,
        config.color_preset_style === "swatch"
          ? "filled"
          : ["label", "filled", "name"].includes(config.color_preset_style)
            ? config.color_preset_style
            : "label",
        (event) =>
          change("color_preset_style", event.currentTarget.dataset.value),
      )}
    </div>
    ${["filled", "swatch", "name"].includes(config.color_preset_style)
      ? ""
      : choices(
          "Swatch shape",
          "color_preset_shape",
          COLOR_PRESET_SHAPE_CHOICES.map((option) => option.value),
          "rounded",
        )}`;
}

export function renderModeControlSettings(
  area,
  config,
  change,
  items = [],
  noun = "effect",
  renderAppearance = null,
) {
  const toggle = (label, key, fallback = true) =>
    createToggleRow(label, key, config[key] ?? fallback, (event) =>
      change(key, event.target.checked),
    );
  const actionKeys =
    noun === "lamp" ? ["refresh", "power"] : ACTION_BUTTON_KEYS;
  if (area === "actions")
    return html`${toggle(
      "Show Actions",
      "show_actions",
    )}${config.show_actions !== false
      ? html`${renderModeSettingsSection(
          "Button Settings",
          renderActionButtonSettings(config, change, {
            styleKey: "actions_buttons_style",
            contentKey: "actions_buttons_content_mode",
            defaultStyle: modeActionOptions(config).buttonStyle,
            defaultContentMode: modeActionOptions(config).contentMode,
          }),
        )}${renderModeSettingsSection(
          "Actions & Order",
          renderOrderableList({
            items: actionButtonOrder(config, actionKeys),
            available: actionKeys.filter(
              (key) => !actionButtonOrder(config, actionKeys).includes(key),
            ),
            labelFor: (key) => ACTION_BUTTON_LABELS[key] || key,
            onUpdate: (keys) => change("action_buttons", keys),
            onReset: () => change("action_buttons", undefined),
            addPlaceholder: "Add action",
            resetLabel: "Reset to all actions",
          }),
        )}`
      : ""}`;
  if (area === "orientation")
    return html`${toggle(
      "Show Device Orientation",
      "show_device_orientation",
    )}${config.show_device_orientation !== false
      ? renderModeSettingsSection(
          "Orientation Settings",
          renderOrientationSettings(config, change),
        )
      : ""}`;
  if (area === "favourites")
    return html`${toggle("Show Favourites", "show_favourites", false)}${toggle(
      "Show favourite stars",
      "favourites_show_stars",
    )}${config.show_favourites
      ? renderModeSettingsSection(
          "Favourite Controls",
          html`
            ${toggle("Animated Previews", "favourites_show_previews")}
            ${config.favourites_show_previews === false
              ? renderActionButtonSettings(config, change, {
                  styleKey: "collection_buttons_style",
                  contentKey: "collection_buttons_content_mode",
                  defaultStyle: "classic",
                  defaultContentMode: "icon_text",
                })
              : renderAppearance
                ? renderAppearance(config, change)
                : renderMatrixAppearanceSettings(config, change, {
                    prefix: "effect",
                    defaultSize: 100,
                  })}
          `,
        )
      : ""}`;
  // Rotation always follows the favourites list: no custom source, no
  // shuffle toggle. The only setting is how often to advance, edited as a
  // value + unit (seconds → days) and stored as whole seconds.
  const parts = rotationIntervalParts(config.rotation_interval ?? 60);
  const applyInterval = (value, unit) => {
    const size =
      ROTATION_INTERVAL_UNITS.find((item) => item.unit === unit)?.seconds || 1;
    change(
      "rotation_interval",
      Math.max(1, Math.round(Number(value) || 1)) * size,
    );
  };
  return html`${toggle(
    `Show ${noun === "effect" ? "Effect" : "Clock Mode"} Rotation`,
    "show_rotation",
    false,
  )}${config.show_rotation
    ? renderModeSettingsSection(
        "Rotation Settings",
        html`
          <div class="form-row">
            <label>Rotate every</label>
            <div style="display:flex;gap:8px;align-items:center;min-width:0;">
              <input
                type="number"
                aria-label="Rotation interval value"
                min="1"
                max="999"
                style="width:80px;min-width:0;padding:8px;border:1px solid var(--divider-color,#d0d7de);border-radius:6px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#333);font:inherit;box-sizing:border-box;"
                .value=${String(parts.value)}
                @change=${(event) =>
                  applyInterval(event.target.value, parts.unit)}
              />
              <select
                aria-label="Rotation interval unit"
                style="flex:1;min-width:0;padding:8px;border:1px solid var(--divider-color,#d0d7de);border-radius:6px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#333);font:inherit;"
                @change=${(event) =>
                  applyInterval(parts.value, event.target.value)}
              >
                ${ROTATION_INTERVAL_UNITS.map(
                  (item) =>
                    html`<option
                      value=${item.unit}
                      ?selected=${item.unit === parts.unit}
                    >
                      ${item.label}
                    </option>`,
                )}
              </select>
            </div>
          </div>
        `,
      )
    : ""}`;
}
