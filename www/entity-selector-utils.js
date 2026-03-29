/**
 * Shared Entity Selector Utilities
 * Provides consistent entity selection dropdowns across all editor cards
 */

import { html, css } from "https://unpkg.com/lit@2.8.0/index.js?module";

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
  id
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
          `
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
  id
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
          `
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
  mode = "multiple"
) {
  if (!hass || !hass.states) {
    return html`<div style="color: #666; font-style: italic; padding: 8px;">
      Loading entities...
    </div>`;
  }

  const entities = getYeelightCubeEntities(hass);

  if (entities.length === 0) {
    return html`<div
      style="border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;"
    >
      <div
        style="padding: 12px 16px 8px 16px; font-weight: 500; color: #333; border-bottom: 1px solid #e8e8e8; background: #f5f5f5; border-radius: 8px 8px 0 0;"
      >
        Yeelight Cube Lite Entities (0)
      </div>
      <div
        style="color: #666; font-style: italic; text-align: center; padding: 20px;"
      >
        <div style="margin-bottom: 8px;">No Yeelight Cube Lite entities found</div>
        <div style="font-size: 0.85em; color: #999;">
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
      const newSelected = [entityId];
      onChange({ target: { value: entityId } }); // Send single value for single mode
    };

    return html`
      <div
        style="border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;"
      >
        <div
          style="padding: 12px 16px 8px 16px; font-weight: 500; color: #333; border-bottom: 1px solid #e8e8e8; background: #f5f5f5; border-radius: 8px 8px 0 0;"
        >
          Yeelight Cube Lite Entities (${entities.length})
        </div>

        <div style="max-height: 200px; overflow-y: auto; padding: 8px;">
          ${entities.map((entityId) => {
            const isSelected =
              Array.isArray(selectedEntities) &&
              selectedEntities.length > 0 &&
              selectedEntities[0] === entityId;
            const state = hass.states[entityId];
            const friendlyName = state?.attributes?.friendly_name || entityId;

            return html`
              <div
                style="display: flex; align-items: center; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: ${isSelected
                  ? "#e3f2fd"
                  : "white"}; border: 1px solid ${isSelected
                  ? "#90caf9"
                  : "#e0e0e0"}; transition: all 0.2s ease; cursor: pointer;"
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
                    style="font-weight: 500; color: #333; margin-bottom: 2px;"
                  >
                    ${friendlyName}
                  </div>
                  <div
                    style="font-size: 0.85em; color: #666; font-family: monospace;"
                  >
                    ${entityId}
                  </div>
                </div>
              </div>
            `;
          })}
        </div>

        ${selectedEntities.length > 0
          ? html`<div
              style="padding: 8px 16px; font-size: 0.9em; color: #666; border-top: 1px solid #e8e8e8; background: #f9f9f9; border-radius: 0 0 8px 8px;"
            >
              1 entity selected
            </div>`
          : html`<div
              style="padding: 8px 16px; font-size: 0.9em; color: #999; border-top: 1px solid #e8e8e8; background: #f9f9f9; border-radius: 0 0 8px 8px; font-style: italic;"
            >
              No entity selected
            </div>`}
      </div>
    `;
  }

  // Multiple selection with checkboxes
  const toggleEntity = (entityId) => {
    const currentSelected = Array.isArray(selectedEntities)
      ? selectedEntities
      : [];
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
      style="border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;"
    >
      <div
        style="padding: 12px 16px 8px 16px; font-weight: 500; color: #333; border-bottom: 1px solid #e8e8e8; background: #f5f5f5; border-radius: 8px 8px 0 0;"
      >
        Yeelight Cube Lite Entities (${entities.length})
      </div>

      <div style="max-height: 200px; overflow-y: auto; padding: 8px;">
        ${entities.map((entityId) => {
          const isSelected =
            Array.isArray(selectedEntities) &&
            selectedEntities.includes(entityId);
          const state = hass.states[entityId];
          const friendlyName = state?.attributes?.friendly_name || entityId;

          return html`
            <div
              style="display: flex; align-items: center; padding: 8px 12px; margin: 4px 0; border-radius: 6px; background: ${isSelected
                ? "#e3f2fd"
                : "white"}; border: 1px solid ${isSelected
                ? "#90caf9"
                : "#e0e0e0"}; transition: all 0.2s ease; cursor: pointer;"
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
                <div style="font-weight: 500; color: #333; margin-bottom: 2px;">
                  ${friendlyName}
                </div>
                <div
                  style="font-size: 0.85em; color: #666; font-family: monospace;"
                >
                  ${entityId}
                </div>
              </div>
            </div>
          `;
        })}
      </div>

      ${selectedEntities.length > 0
        ? html`<div
            style="padding: 8px 16px; font-size: 0.9em; color: #666; border-top: 1px solid #e8e8e8; background: #f9f9f9; border-radius: 0 0 8px 8px;"
          >
            ${selectedEntities.length} entities selected
          </div>`
        : html`<div
            style="padding: 8px 16px; font-size: 0.9em; color: #999; border-top: 1px solid #e8e8e8; background: #f9f9f9; border-radius: 0 0 8px 8px; font-style: italic;"
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
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
    background-color: white;
    cursor: pointer;
  }

  .entity-dropdown:focus {
    outline: none;
    border-color: #007bff;
    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
  }

  .entity-dropdown.searchable {
    height: auto;
    max-height: 200px;
    overflow-y: auto;
  }

  .entity-search {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ccc;
    border-radius: 4px 4px 0 0;
    font-size: 14px;
    margin-bottom: 0;
  }

  .entity-search:focus {
    outline: none;
    border-color: #007bff;
    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
  }

  .searchable-entity-selector .entity-dropdown {
    border-top: none;
    border-radius: 0 0 4px 4px;
  }

  .entity-dropdown option {
    padding: 4px 8px;
  }

  .entity-dropdown option:hover {
    background-color: #f8f9fa;
  }
`;
