/**
 * Shared Entity Selector Utilities
 * Provides consistent entity selection dropdowns across all editor cards
 */

import { html, css } from "./lib/lit-all.js";

/**
 * Creates a searchable entity selector dropdown
 * @param {Object} hass - Home Assistant object
 * @param {string} domain - Entity domain to filter (e.g., 'light', 'sensor')
 * @param {string} currentValue - Currently selected entity ID
 * @param {string} placeholder - Placeholder text
 * @param {Function} onChange - Change handler function
 * @param {string} id - Element ID
 * @returns {TemplateResult} Lit HTML template
 */
export function createEntitySelector(
  hass,
  domain,
  currentValue,
  placeholder,
  onChange,
  id,
) {
  const entities = getEntitiesByDomain(hass, domain);

  return html`
    <div class="entity-selector">
      <select id="${id}" @change="${onChange}" class="entity-dropdown">
        <option value="">${placeholder}</option>
        ${entities.map(
          (entityId) => html`
            <option
              value="${entityId}"
              ?selected="${currentValue === entityId}"
            >
              ${getFriendlyName(hass, entityId)} (${entityId})
            </option>
          `,
        )}
      </select>
    </div>
  `;
}

/**
 * Creates a searchable entity selector with filter input
 * @param {Object} hass - Home Assistant object
 * @param {string} domain - Entity domain to filter
 * @param {string} currentValue - Currently selected entity ID
 * @param {string} placeholder - Placeholder text
 * @param {Function} onChange - Change handler function
 * @param {string} id - Element ID
 * @returns {TemplateResult} Lit HTML template
 */
export function createSearchableEntitySelector(
  hass,
  domain,
  currentValue,
  placeholder,
  onChange,
  id,
) {
  const entities = getEntitiesByDomain(hass, domain);
  const searchId = `${id}-search`;

  return html`
    <div class="searchable-entity-selector">
      <input
        type="text"
        id="${searchId}"
        placeholder="Search entities..."
        @input="${(e) => filterEntityOptions(e, id)}"
        class="entity-search"
      />
      <select
        id="${id}"
        @change="${onChange}"
        class="entity-dropdown searchable"
        size="8"
      >
        <option value="">${placeholder}</option>
        ${entities.map(
          (entityId) => html`
            <option
              value="${entityId}"
              ?selected="${currentValue === entityId}"
              data-friendly="${getFriendlyName(hass, entityId).toLowerCase()}"
              data-entity="${entityId.toLowerCase()}"
            >
              ${getFriendlyName(hass, entityId)} (${entityId})
            </option>
          `,
        )}
      </select>
    </div>
  `;
}

/**
 * Get entities by domain from Home Assistant
 * @param {Object} hass - Home Assistant object
 * @param {string} domain - Entity domain
 * @returns {Array} Array of entity IDs
 */
function getEntitiesByDomain(hass, domain) {
  if (!hass || !hass.states) return [];

  return Object.keys(hass.states)
    .filter((entityId) => entityId.startsWith(`${domain}.`))
    .sort();
}

/**
 * Get friendly name for entity
 * @param {Object} hass - Home Assistant object
 * @param {string} entityId - Entity ID
 * @returns {string} Friendly name or entity ID
 */
function getFriendlyName(hass, entityId) {
  if (!hass || !hass.states || !hass.states[entityId]) {
    return entityId;
  }

  const attributes = hass.states[entityId].attributes;
  return attributes.friendly_name || entityId;
}

/**
 * Filter entity options based on search input
 * @param {Event} e - Input event
 * @param {string} selectId - Select element ID
 */
function filterEntityOptions(e, selectId) {
  const searchTerm = e.target.value.toLowerCase();
  const selectElement = e.target
    .closest(".searchable-entity-selector")
    .querySelector(`#${selectId}`);

  if (!selectElement) return;

  const options = selectElement.querySelectorAll("option");

  options.forEach((option) => {
    if (option.value === "") {
      option.style.display = "block";
      return;
    }

    const friendlyName = option.dataset.friendly || "";
    const entityId = option.dataset.entity || "";

    const matches =
      friendlyName.includes(searchTerm) || entityId.includes(searchTerm);
    option.style.display = matches ? "block" : "none";
  });
}

/**
 * Get all light entities
 * @param {Object} hass - Home Assistant object
 * @returns {Array} Array of light entity IDs
 */
export function getLightEntities(hass) {
  return getEntitiesByDomain(hass, "light");
}

/**
 * Get all sensor entities
 * @param {Object} hass - Home Assistant object
 * @returns {Array} Array of sensor entity IDs
 */
export function getSensorEntities(hass) {
  return getEntitiesByDomain(hass, "sensor");
}

/**
 * Get only Yeelight Cube Lite entities from our custom component
 * @param {Object} hass - Home Assistant object
 * @returns {Array} Array of Yeelight Cube Lite entity IDs
 */
export function getYeelightCubeEntities(hass) {
  if (!hass || !hass.states) return [];

  const cubeEntities = Object.keys(hass.states).filter((entityId) => {
    if (!entityId.startsWith("light.")) return false;

    const state = hass.states[entityId];
    const attributes = state?.attributes || {};

    // More permissive check - look for any cube-related identifier
    return (
      attributes._yeelight_cube_component === "yeelight-cube-component-v1.0" ||
      entityId.includes("cube") ||
      entityId.includes("cubelite")
    );
  });

  return cubeEntities.sort();
}

/**
 * Renders a row for a configured entity that is not in the discovered cube
 * entity list (e.g. temporarily unavailable / reloading, or removed). Such
 * entities are never dropped automatically; the user removes them explicitly.
 * @param {Object} hass - Home Assistant object
 * @param {string} entityId - The configured entity ID
 * @param {Function} onRemove - Called when the user clicks "Remove"
 * @returns {TemplateResult} Lit HTML template
 */
function renderUnlistedSelectedEntity(hass, entityId, onRemove) {
  const state = hass.states[entityId];
  const friendlyName = state?.attributes?.friendly_name || entityId;
  const status =
    !state || state.state === "unavailable" ? "unavailable" : "not detected";
  return html`
    <div
      style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: color-mix(in srgb, var(--warning-color, #ff9800) 12%, var(--card-background-color, #fff)); border: 1px solid var(--warning-color, #ff9800);"
      title="This entity is configured but is currently not available in Home Assistant. It is kept in the configuration until you remove it."
    >
      <div style="flex: 1; min-width: 0;">
        <div
          style="font-weight: 500; color: var(--primary-text-color, #333); margin-bottom: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;"
        >
          <span>${friendlyName}</span>
          <span
            style="font-size: 0.75em; font-weight: 600; text-transform: uppercase; padding: 1px 6px; border-radius: 10px; color: var(--text-primary-color, #fff); background: var(--warning-color, #ff9800);"
            >${status}</span
          >
        </div>
        <div
          style="font-size: 0.85em; color: var(--secondary-text-color, #666); font-family: monospace; overflow-wrap: anywhere;"
        >
          ${entityId}
        </div>
      </div>
      <button
        type="button"
        style="flex: none; cursor: pointer; padding: 4px 10px; border-radius: 4px; border: 1px solid var(--warning-color, #ff9800); background: transparent; color: var(--primary-text-color, #333); font-size: 0.85em;"
        @click="${(e) => {
          e.stopPropagation();
          onRemove();
        }}"
      >
        Remove
      </button>
    </div>
  `;
}

/**
 * Creates a multi-select entity picker for Yeelight Cube Lite entities
 * @param {Object} hass - Home Assistant object
 * @param {Array} selectedEntities - Currently selected entity IDs
 * @param {Function} onChange - Change handler function
 * @param {string} mode - 'single' or 'multiple' selection mode
 * @returns {TemplateResult} Lit HTML template
 */
export function createYeelightCubeEntityPicker(
  hass,
  selectedEntities = [],
  onChange,
  mode = "multiple",
) {
  if (!hass || !hass.states) {
    return html`<div
      style="color: var(--secondary-text-color, #666); font-style: italic; padding: 8px;"
    >
      Loading entities...
    </div>`;
  }

  const entities = getYeelightCubeEntities(hass);

  // Normalise the configured selection. Entities that are not currently in
  // hass.states (e.g. lamp unavailable or integration reloading while the
  // editor is open) are intentionally KEPT: they are rendered with an
  // "unavailable" marker and only removed when the user explicitly asks.
  const selectedList = Array.isArray(selectedEntities)
    ? selectedEntities.filter((id) => typeof id === "string" && id)
    : typeof selectedEntities === "string" && selectedEntities
      ? [selectedEntities]
      : [];
  const relevantSelected =
    mode === "single" ? selectedList.slice(0, 1) : selectedList;
  const unlistedSelected = relevantSelected.filter(
    (id) => !entities.includes(id),
  );

  if (entities.length === 0 && unlistedSelected.length === 0) {
    return html`<div
      style="border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; background: var(--secondary-background-color, #fafafa);"
    >
      <div
        style="padding: 12px 16px 8px 16px; font-weight: 500; color: var(--primary-text-color, #333); border-bottom: 1px solid var(--divider-color, #e8e8e8); background: var(--secondary-background-color, #f5f5f5); border-radius: 8px 8px 0 0;"
      >
        Yeelight Cube Lite Entities (0)
      </div>
      <div
        style="color: var(--secondary-text-color, #666); font-style: italic; text-align: center; padding: 20px;"
      >
        <div style="margin-bottom: 8px;">
          No Yeelight Cube Lite entities found
        </div>
        <div
          style="font-size: 0.85em; color: var(--secondary-text-color, #999);"
        >
          Make sure you have Yeelight Cube Lite devices configured in this
          integration
        </div>
      </div>
    </div>`;
  }

  if (mode === "single") {
    // Single selection with radio button style UI (same visual as multiple but limited to one)
    const toggleEntity = (entityId) => {
      // For single mode, always replace the selection with the clicked entity
      onChange({ target: { value: entityId } }); // Send single value for single mode
    };

    return html`
      <div
        style="border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; background: var(--secondary-background-color, #fafafa);"
      >
        <div
          style="padding: 12px 16px 8px 16px; font-weight: 500; color: var(--primary-text-color, #333); border-bottom: 1px solid var(--divider-color, #e8e8e8); background: var(--secondary-background-color, #f5f5f5); border-radius: 8px 8px 0 0;"
        >
          Yeelight Cube Lite Entities (${entities.length})
        </div>

        <div style="max-height: 200px; overflow-y: auto; padding: 8px;">
          ${entities.map((entityId) => {
            const isSelected =
              relevantSelected.length > 0 && relevantSelected[0] === entityId;
            const state = hass.states[entityId];
            const friendlyName = state?.attributes?.friendly_name || entityId;

            return html`
              <div
                style="display: flex; align-items: center; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: ${isSelected
                  ? "color-mix(in srgb, var(--primary-color) 15%, var(--card-background-color, #fff))"
                  : "var(--card-background-color, white)"}; border: 1px solid ${isSelected
                  ? "var(--primary-color)"
                  : "var(--divider-color, #e0e0e0)"}; transition: all 0.2s ease; cursor: pointer;"
                @click="${() => toggleEntity(entityId)}"
              >
                <input
                  type="radio"
                  name="yeelight-cube-entity"
                  .checked="${isSelected}"
                  @change="${(e) => {
                    e.stopPropagation();
                    toggleEntity(entityId);
                  }}"
                  style="margin-right: 12px; transform: scale(1.1);"
                />
                <div style="flex: 1;">
                  <div
                    style="font-weight: 500; color: var(--primary-text-color, #333); margin-bottom: 2px;"
                  >
                    ${friendlyName}
                  </div>
                  <div
                    style="font-size: 0.85em; color: var(--secondary-text-color, #666); font-family: monospace;"
                  >
                    ${entityId}
                  </div>
                </div>
              </div>
            `;
          })}
          ${unlistedSelected.map((entityId) =>
            renderUnlistedSelectedEntity(hass, entityId, () =>
              onChange({ target: { value: "" } }),
            ),
          )}
        </div>

        ${relevantSelected.length > 0
          ? html`<div
              style="padding: 8px 16px; font-size: 0.9em; color: var(--secondary-text-color, #666); border-top: 1px solid var(--divider-color, #e8e8e8); background: var(--secondary-background-color, #f9f9f9); border-radius: 0 0 8px 8px;"
            >
              1 entity selected${unlistedSelected.length > 0
                ? " (unavailable)"
                : ""}
            </div>`
          : html`<div
              style="padding: 8px 16px; font-size: 0.9em; color: var(--secondary-text-color, #999); border-top: 1px solid var(--divider-color, #e8e8e8); background: var(--secondary-background-color, #f9f9f9); border-radius: 0 0 8px 8px; font-style: italic;"
            >
              No entity selected
            </div>`}
      </div>
    `;
  }

  // Multiple selection with checkboxes

  // NOTE: selected entities missing from hass.states are never removed
  // automatically (doing so from render would permanently drop a lamp that is
  // only temporarily unavailable). They are listed below with a Remove button.
  const removeEntity = (entityId) => {
    onChange({
      target: { value: selectedList.filter((id) => id !== entityId) },
    });
  };

  const toggleEntity = (entityId) => {
    const currentSelected = [...selectedList];
    const isSelected = currentSelected.includes(entityId);

    let newSelected;
    if (isSelected) {
      newSelected = currentSelected.filter((id) => id !== entityId);
    } else {
      newSelected = [...currentSelected, entityId];
    }

    onChange({ target: { value: newSelected } });
  };

  return html`
    <div
      style="border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; background: var(--secondary-background-color, #fafafa);"
    >
      <div
        style="padding: 12px 16px 8px 16px; font-weight: 500; color: var(--primary-text-color, #333); border-bottom: 1px solid var(--divider-color, #e8e8e8); background: var(--secondary-background-color, #f5f5f5); border-radius: 8px 8px 0 0;"
      >
        Yeelight Cube Lite Entities (${entities.length})
      </div>

      <div style="max-height: 200px; overflow-y: auto; padding: 8px;">
        ${entities.map((entityId) => {
          const isSelected = selectedList.includes(entityId);
          const state = hass.states[entityId];
          const friendlyName = state?.attributes?.friendly_name || entityId;

          return html`
            <div
              style="display: flex; align-items: center; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: ${isSelected
                ? "color-mix(in srgb, var(--primary-color) 15%, var(--card-background-color, #fff))"
                : "var(--card-background-color, white)"}; border: 1px solid ${isSelected
                ? "var(--primary-color)"
                : "var(--divider-color, #e0e0e0)"}; transition: all 0.2s ease; cursor: pointer;"
              @click="${() => toggleEntity(entityId)}"
            >
              <input
                type="checkbox"
                .checked="${isSelected}"
                @change="${(e) => {
                  e.stopPropagation();
                  toggleEntity(entityId);
                }}"
                style="margin-right: 12px; transform: scale(1.1);"
              />
              <div style="flex: 1;">
                <div
                  style="font-weight: 500; color: var(--primary-text-color, #333); margin-bottom: 2px;"
                >
                  ${friendlyName}
                </div>
                <div
                  style="font-size: 0.85em; color: var(--secondary-text-color, #666); font-family: monospace;"
                >
                  ${entityId}
                </div>
              </div>
            </div>
          `;
        })}
        ${unlistedSelected.map((entityId) =>
          renderUnlistedSelectedEntity(hass, entityId, () =>
            removeEntity(entityId),
          ),
        )}
      </div>

      ${selectedList.length > 0
        ? html`<div
            style="padding: 8px 16px; font-size: 0.9em; color: var(--secondary-text-color, #666); border-top: 1px solid var(--divider-color, #e8e8e8); background: var(--secondary-background-color, #f9f9f9); border-radius: 0 0 8px 8px;"
          >
            ${selectedList.length}
            ${selectedList.length === 1 ? "entity" : "entities"}
            selected${unlistedSelected.length > 0
              ? html`,
                  <span style="color: var(--warning-color, #ff9800);"
                    >${unlistedSelected.length} unavailable</span
                  >`
              : ""}
          </div>`
        : html`<div
            style="padding: 8px 16px; font-size: 0.9em; color: var(--secondary-text-color, #999); border-top: 1px solid var(--divider-color, #e8e8e8); background: var(--secondary-background-color, #f9f9f9); border-radius: 0 0 8px 8px; font-style: italic;"
          >
            No entities selected
          </div>`}
    </div>
  `;
}

/**
 * CSS styles for entity selectors
 */
export const entitySelectorStyles = css`
  .entity-selector,
  .searchable-entity-selector {
    width: 100%;
  }

  .entity-dropdown {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 4px;
    font-size: 14px;
    background-color: var(--card-background-color, white);
    cursor: pointer;
  }

  .entity-dropdown:focus {
    outline: none;
    border-color: var(--primary-color, #007bff);
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--primary-color, #007bff) 25%, transparent);
  }

  .entity-dropdown.searchable {
    height: auto;
    max-height: 200px;
    overflow-y: auto;
  }

  .entity-search {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 4px 4px 0 0;
    font-size: 14px;
    margin-bottom: 0;
  }

  .entity-search:focus {
    outline: none;
    border-color: var(--primary-color, #007bff);
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--primary-color, #007bff) 25%, transparent);
  }

  .searchable-entity-selector .entity-dropdown {
    border-top: none;
    border-radius: 0 0 4px 4px;
  }

  .entity-dropdown option {
    padding: 4px 8px;
  }

  .entity-dropdown option:hover {
    background-color: var(--secondary-background-color, #f8f9fa);
  }
`;
