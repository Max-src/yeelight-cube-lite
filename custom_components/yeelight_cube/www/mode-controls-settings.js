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
  ROTATION_INTERVAL_UNITS,
  rotationIntervalRows,
  intervalPartsSeconds,
  nextIntervalUnit,
  formatRotationInterval,
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

// `rotation` (rotation area): { interval: the lamp's shared interval in
// seconds, or null/undefined; onIntervalChange: stores a new total on the lamp }.
export function renderModeControlSettings(
  area,
  config,
  change,
  items = [],
  noun = "effect",
  renderAppearance = null,
  rotation = {},
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
  // Rotation always follows the favourites list. Settings: how often to
  // advance, composed of rows that add up (1 minute + 10 seconds = 70 s, one
  // row per unit), and whether the lists follow each step. The interval is
  // stored on the lamp, so every dashboard uses it; the card config keeps the
  // rows as entered.
  const rows = rotationIntervalRows(config, rotation.interval);
  const inputStyle =
    "min-width:0;padding:8px;border:1px solid var(--divider-color,#d0d7de);border-radius:6px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#333);font:inherit;box-sizing:border-box;";
  const applyRows = (next) => {
    const total = intervalPartsSeconds(next);
    change("rotation_interval_parts", next);
    change("rotation_interval", total);
    rotation.onIntervalChange?.(total);
  };
  const setRow = (index, patch) =>
    applyRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const suffix = (index) => (index ? ` ${index + 1}` : "");
  return html`${toggle(
    `Show ${noun === "effect" ? "Effect" : "Clock Mode"} Rotation`,
    "show_rotation",
    false,
  )}${config.show_rotation
    ? renderModeSettingsSection(
        "Rotation Settings",
        html`
          <div class="form-row" style="align-items:flex-start;">
            <label>Rotate every</label>
            <div style="display:flex;flex-direction:column;gap:6px;min-width:0;flex:1;">
              ${rows.map(
                (row, index) => html`<div
                  style="display:flex;gap:8px;align-items:center;min-width:0;"
                >
                  ${index
                    ? html`<span aria-hidden="true" style="opacity:0.7;">+</span>`
                    : ""}
                  <input
                    type="number"
                    aria-label=${`Rotation interval value${suffix(index)}`}
                    min="0"
                    max="9999"
                    style=${`width:80px;${inputStyle}`}
                    .value=${String(row.value)}
                    @change=${(event) => setRow(index, { value: event.target.value })}
                  />
                  <select
                    aria-label=${`Rotation interval unit${suffix(index)}`}
                    style=${`flex:1;${inputStyle}`}
                    @change=${(event) => setRow(index, { unit: event.target.value })}
                  >
                    ${ROTATION_INTERVAL_UNITS.filter(
                      // Each unit once: another row's unit is not offered.
                      (item) =>
                        item.unit === row.unit ||
                        !rows.some((other) => other.unit === item.unit),
                    ).map(
                      (item) =>
                        html`<option
                          value=${item.unit}
                          ?selected=${item.unit === row.unit}
                        >
                          ${item.label}
                        </option>`,
                    )}
                  </select>
                  ${rows.length > 1
                    ? html`<button
                        type="button"
                        aria-label=${`Remove interval${suffix(index)}`}
                        title="Remove"
                        style=${inputStyle}
                        @click=${() => applyRows(rows.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>`
                    : ""}
                </div>`,
              )}
              ${nextIntervalUnit(rows)
                ? html`<button
                    type="button"
                    style=${`align-self:flex-start;cursor:pointer;${inputStyle}`}
                    @click=${() =>
                      applyRows([
                        ...rows,
                        { value: 0, unit: nextIntervalUnit(rows) },
                      ])}
                  >
                    + Add interval
                  </button>`
                : ""}
              ${rows.length > 1
                ? html`<span class="muted" style="font-size:0.85em;opacity:0.8;"
                    >= ${formatRotationInterval(intervalPartsSeconds(rows))}</span
                  >`
                : ""}
            </div>
          </div>
          ${toggle(
            noun === "effect" ? "Follow in effect list" : "Follow in style list",
            "rotation_follow_active",
            true,
          )}
          ${toggle("Highlight in favourites", "rotation_highlight_favourite", true)}
        `,
      )
    : ""}`;
}
