/**
 * The editors' lamp picker (Global Settings → Lamp / Lamps): every Yeelight
 * Cube lamp (card-base.js cubeLampEntities) as a radio list ("single") or a
 * checkbox list ("multiple"). Its CSS (entitySelectorStyles) is part of
 * sharedEditorStyles.
 */
import { html, css, nothing } from "./lib/lit-all.js";
import { cubeLampEntities } from "./card-base.js";

/**
 * A configured lamp Home Assistant does not list now (unavailable,
 * reloading, removed): kept in the configuration until the user removes it,
 * so a lamp that is only away for a moment is never dropped.
 */
function unlistedLampRow(hass, entityId, onRemove) {
  const state = hass.states[entityId];
  const status =
    !state || state.state === "unavailable" ? "unavailable" : "not detected";
  return html`<div
    class="yc-lamp-row yc-lamp-row-unlisted"
    title="This entity is configured but is currently not available in Home Assistant. It is kept in the configuration until you remove it."
  >
    <div class="yc-lamp-text">
      <div class="yc-lamp-name">
        <span>${state?.attributes?.friendly_name || entityId}</span>
        <span class="yc-lamp-status">${status}</span>
      </div>
      <div class="yc-lamp-id">${entityId}</div>
    </div>
    <button
      type="button"
      class="yc-lamp-remove"
      @click=${(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      Remove
    </button>
  </div>`;
}

/**
 * The picker. onChange({ target: { value } }) gets the chosen lamp id
 * ("single", "" when its unlisted lamp is removed) or the new list of ids
 * ("multiple").
 */
export function createYeelightCubeEntityPicker(
  hass,
  selectedEntities = [],
  onChange,
  mode = "multiple",
) {
  if (!hass?.states)
    return html`<div class="yc-lamp-loading">Loading entities...</div>`;

  const single = mode === "single";
  const entities = cubeLampEntities(hass).sort();
  const selectedList = Array.isArray(selectedEntities)
    ? selectedEntities.filter((id) => typeof id === "string" && id)
    : typeof selectedEntities === "string" && selectedEntities
      ? [selectedEntities]
      : [];
  const selected = single ? selectedList.slice(0, 1) : selectedList;
  const unlisted = selected.filter((id) => !entities.includes(id));
  const header = html`<div class="yc-lamp-header">
    Yeelight Cube Lite Entities (${entities.length})
  </div>`;

  if (!entities.length && !unlisted.length)
    return html`<div class="yc-lamp-picker">
      ${header}
      <div class="yc-lamp-empty">
        <div>No Yeelight Cube Lite entities found</div>
        <div class="yc-lamp-empty-hint">
          Make sure you have Yeelight Cube Lite devices configured in this
          integration
        </div>
      </div>
    </div>`;

  // Single: a click replaces the lamp. Multiple: it adds or removes one.
  const toggle = (entityId) =>
    onChange({
      target: {
        value: single
          ? entityId
          : selectedList.includes(entityId)
            ? selectedList.filter((id) => id !== entityId)
            : [...selectedList, entityId],
      },
    });
  const remove = (entityId) =>
    onChange({
      target: {
        value: single ? "" : selectedList.filter((id) => id !== entityId),
      },
    });

  let summary;
  if (!selected.length)
    summary = html`<div class="yc-lamp-footer yc-lamp-footer-empty">
      ${single ? "No entity selected" : "No entities selected"}
    </div>`;
  else if (single)
    summary = html`<div class="yc-lamp-footer">
      1 entity selected${unlisted.length ? " (unavailable)" : ""}
    </div>`;
  else
    summary = html`<div class="yc-lamp-footer">
      ${selected.length} ${selected.length === 1 ? "entity" : "entities"}
      selected${unlisted.length
        ? html`,
            <span class="yc-lamp-warning">${unlisted.length} unavailable</span>`
        : ""}
    </div>`;

  return html`<div class="yc-lamp-picker">
    ${header}
    <div class="yc-lamp-list">
      ${entities.map((entityId) => {
        const isSelected = selected.includes(entityId);
        return html`<div
          class="yc-lamp-row${isSelected ? " yc-lamp-row-selected" : ""}"
          @click=${() => toggle(entityId)}
        >
          <input
            type=${single ? "radio" : "checkbox"}
            name=${single ? "yeelight-cube-entity" : nothing}
            .checked=${isSelected}
            @click=${(event) => {
              // Its own change toggles it: the row's click would toggle it
              // back (a click on the box did nothing).
              event.stopPropagation();
            }}
            @change=${(event) => {
              event.stopPropagation();
              toggle(entityId);
            }}
          />
          <div class="yc-lamp-text">
            <div class="yc-lamp-name">
              ${hass.states[entityId]?.attributes?.friendly_name || entityId}
            </div>
            <div class="yc-lamp-id">${entityId}</div>
          </div>
        </div>`;
      })}
      ${unlisted.map((entityId) =>
        unlistedLampRow(hass, entityId, () => remove(entityId)),
      )}
    </div>
    ${summary}
  </div>`;
}

/** The picker's CSS (included by sharedEditorStyles). */
export const entitySelectorStyles = css`
  .yc-lamp-loading {
    color: var(--secondary-text-color, #666);
    font-style: italic;
    padding: 8px;
  }
  .yc-lamp-picker {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 8px;
    background: var(--secondary-background-color, #fafafa);
  }
  .yc-lamp-header {
    padding: 12px 16px 8px 16px;
    font-weight: 500;
    color: var(--primary-text-color, #333);
    border-bottom: 1px solid var(--divider-color, #e8e8e8);
    background: var(--secondary-background-color, #f5f5f5);
    border-radius: 8px 8px 0 0;
  }
  .yc-lamp-empty {
    color: var(--secondary-text-color, #666);
    font-style: italic;
    text-align: center;
    padding: 20px;
  }
  .yc-lamp-empty > div:first-child {
    margin-bottom: 8px;
  }
  .yc-lamp-empty-hint {
    font-size: 0.85em;
    color: var(--secondary-text-color, #999);
  }
  .yc-lamp-list {
    max-height: 200px;
    overflow-y: auto;
    padding: 8px;
  }
  .yc-lamp-row {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    margin: 4px 0;
    border-radius: 6px;
    background: var(--card-background-color, white);
    border: 1px solid var(--divider-color, #e0e0e0);
    transition: all 0.2s ease;
    cursor: pointer;
  }
  .yc-lamp-row-selected {
    background: color-mix(
      in srgb,
      var(--primary-color) 15%,
      var(--card-background-color, #fff)
    );
    border-color: var(--primary-color);
  }
  .yc-lamp-row > input {
    margin-right: 12px;
    transform: scale(1.1);
  }
  .yc-lamp-text {
    flex: 1;
    min-width: 0;
  }
  .yc-lamp-name {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    margin-bottom: 2px;
  }
  .yc-lamp-id {
    font-size: 0.85em;
    color: var(--secondary-text-color, #666);
    font-family: monospace;
  }
  .yc-lamp-row-unlisted {
    gap: 8px;
    cursor: default;
    background: color-mix(
      in srgb,
      var(--warning-color, #ff9800) 12%,
      var(--card-background-color, #fff)
    );
    border-color: var(--warning-color, #ff9800);
  }
  .yc-lamp-row-unlisted .yc-lamp-name {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .yc-lamp-row-unlisted .yc-lamp-id {
    overflow-wrap: anywhere;
  }
  .yc-lamp-status {
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 10px;
    color: var(--text-primary-color, #fff);
    background: var(--warning-color, #ff9800);
  }
  .yc-lamp-remove {
    flex: none;
    cursor: pointer;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid var(--warning-color, #ff9800);
    background: transparent;
    color: var(--primary-text-color, #333);
    font-size: 0.85em;
  }
  .yc-lamp-footer {
    padding: 8px 16px;
    font-size: 0.9em;
    color: var(--secondary-text-color, #666);
    border-top: 1px solid var(--divider-color, #e8e8e8);
    background: var(--secondary-background-color, #f9f9f9);
    border-radius: 0 0 8px 8px;
  }
  .yc-lamp-footer-empty {
    color: var(--secondary-text-color, #999);
    font-style: italic;
  }
  .yc-lamp-warning {
    color: var(--warning-color, #ff9800);
  }
`;
