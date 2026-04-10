// Shared UI utilities for Home Assistant card editors
// Provides consistent form elements and styles

import { html, css } from "./lib/lit-all.js";

/**
 * Dispatch a custom event, compatible with Home Assistant's event system.
 * Shared across all editor cards to avoid duplicating this helper.
 */
export function fireEvent(node, type, detail, options) {
  options = options || {};
  detail = detail === null || detail === undefined ? {} : detail;
  const event = new CustomEvent(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
    detail,
  });
  node.dispatchEvent(event);
}

/**
 * Common CSS styles for form elements
 */
export const sharedEditorStyles = css`
  .editor-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px 8px 8px 8px;
  }

  .form-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .form-row.column {
    flex-direction: column;
    align-items: stretch;
  }

  label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
    margin-bottom: 6px;
  }

  input[type="text"],
  input[type="number"],
  select {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--divider-color, #cfd8dc);
    font-size: 1em;
    background: var(--secondary-background-color, #f7f8fa);
    box-sizing: border-box;
  }

  input[type="range"] {
    width: 140px;
    margin: 0 10px;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    border-radius: 2px;
    background: var(--divider-color, #e0e0e0);
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background: var(--primary-color, #1976d2);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    border: none;
    transition: all 0.2s ease;
  }
  input[type="range"]::-moz-range-thumb {
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background: var(--primary-color, #1976d2);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    border: none;
    transition: all 0.2s ease;
  }

  /* Switch/Toggle styles */
  .switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--divider-color, #ccc);
    transition: 0.2s;
    border-radius: 24px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: var(--card-background-color, white);
    transition: 0.2s;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }

  input:checked + .slider {
    background-color: var(--primary-color, #1976d2);
  }

  input:checked + .slider:before {
    transform: translateX(20px);
  }

  /* Radio button styles */
  .radio-group {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: normal;
    margin-bottom: 0;
  }

  /* Button group styles */
  .button-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .button-group button {
    background: var(--secondary-background-color, #e3eaf2);
    border: 1px solid var(--divider-color, #b6c2d2);
    border-radius: 8px;
    padding: 7px 18px;
    font-size: 1em;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .button-group button.active {
    background: var(--primary-color, #1976d2);
    color: var(--text-primary-color, white);
    border-color: var(--primary-color, #1976d2);
  }

  .button-group button:hover {
    background: var(--divider-color, #d1d9e0);
  }

  .button-group button.active:hover {
    background: var(--primary-color, #1565c0);
    filter: brightness(0.9);
  }

  /* Foldable section styles */
  .foldable-section {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 8px;
    margin-bottom: 16px;
    overflow: hidden;
  }

  .foldable-header {
    background: var(--secondary-background-color, #f5f5f5);
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
  }

  .foldable-header:hover {
    background: var(--secondary-background-color, #eeeeee);
    filter: brightness(0.95);
  }

  .foldable-content {
    padding: 16px;
    background: var(--card-background-color, white);
  }

  .foldable-content.collapsed {
    display: none;
  }

  .foldable-arrow {
    transition: transform 0.2s;
  }

  .foldable-arrow.collapsed {
    transform: rotate(-90deg);
  }
`;

/**
 * Render utilities for common form elements
 */
export class FormElementRenderer {
  /**
   * Render a switch/toggle element
   */
  static renderSwitch(label, id, checked, onChange) {
    return html`
      <div class="form-row">
        <label for="${id}">${label}</label>
        <label class="switch">
          <input
            type="checkbox"
            id="${id}"
            .checked="${checked}"
            @change="${onChange}"
          />
          <span class="slider"></span>
        </label>
      </div>
    `;
  }

  /**
   * Render a text input element
   */
  static renderTextInput(label, id, value, placeholder = "", onChange) {
    return html`
      <div class="form-row column">
        <label for="${id}">${label}</label>
        <input
          type="text"
          id="${id}"
          .value="${value || ""}"
          placeholder="${placeholder}"
          @input="${onChange}"
        />
      </div>
    `;
  }

  /**
   * Render a select/dropdown element
   */
  static renderSelect(label, id, value, options, onChange) {
    return html`
      <div class="form-row column">
        <label for="${id}">${label}</label>
        <select id="${id}" @change="${onChange}">
          ${options.map(
            (option) => html`
              <option
                value="${option.value}"
                ?selected="${value === option.value}"
              >
                ${option.label}
              </option>
            `,
          )}
        </select>
      </div>
    `;
  }

  /**
   * Render a number input with range slider
   */
  static renderRangeInput(label, id, value, min, max, step, onChange) {
    return html`
      <div class="form-row">
        <label for="${id}">${label}</label>
        <div style="display:flex;align-items:center;gap:16px;">
          <input
            type="range"
            id="${id}"
            .value="${value}"
            min="${min}"
            max="${max}"
            step="${step}"
            @input="${onChange}"
          />
          <span style="min-width:30px;text-align:center;">${value}</span>
        </div>
      </div>
    `;
  }

  /**
   * Render a radio button group
   */
  static renderRadioGroup(label, name, value, options, onChange) {
    return html`
      <div class="form-row column">
        <label>${label}</label>
        <div class="radio-group">
          ${options.map(
            (option) => html`
              <label class="radio-label">
                <input
                  type="radio"
                  name="${name}"
                  value="${option.value}"
                  ?checked="${value === option.value}"
                  @change="${onChange}"
                />
                ${option.label}
              </label>
            `,
          )}
        </div>
      </div>
    `;
  }

  /**
   * Render a button group for mode selection
   */
  static renderButtonGroup(label, value, options, onChange) {
    return html`
      <div class="form-row column">
        <label>${label}</label>
        <div class="button-group">
          ${options.map(
            (option) => html`
              <button
                class="${value === option.value ? "active" : ""}"
                title="${option.label}"
                @click="${() => onChange(option.value)}"
              >
                ${option.label}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  /**
   * Render a foldable section
   */
  static renderFoldableSection(title, content, isCollapsed = false, onToggle) {
    return html`
      <div class="foldable-section">
        <div class="foldable-header" @click="${onToggle}">
          <span>${title}</span>
          <span class="foldable-arrow ${isCollapsed ? "collapsed" : ""}"
            >▼</span
          >
        </div>
        <div class="foldable-content ${isCollapsed ? "collapsed" : ""}">
          ${content}
        </div>
      </div>
    `;
  }
}

/**
 * Utility functions for editor config management
 */
export class EditorConfigManager {
  /**
   * Create a standard config change handler
   */
  static createConfigChangeHandler(component) {
    return function (key, value) {
      if (!component.config) component.config = {};
      component.config[key] = value;
      component._fireConfigChanged();
    };
  }

  /**
   * Get entity list by domain from HASS
   */
  static getEntitiesByDomain(hass, domain) {
    if (!hass || !hass.states) return [];
    return Object.keys(hass.states)
      .filter((eid) => eid.startsWith(`${domain}.`))
      .sort();
  }

  /**
   * Standard config change event fire
   */
  static fireConfigChanged(component) {
    const event = new CustomEvent("config-changed", {
      detail: { config: component.config },
      bubbles: true,
      composed: true,
    });
    component.dispatchEvent(event);
  }
}

/**
 * Renders a mode-specific settings section with consistent styling
 * Used for conditional settings that appear based on selected mode
 *
 * @param {string} title - Section title (e.g., "Carousel Mode Settings")
 * @param {TemplateResult} content - LitElement html template with settings controls
 * @returns {TemplateResult} Styled settings section
 */
export function renderModeSettingsSection(title, content) {
  return html`
    <div
      style="margin-top: 20px; padding: 16px; background: var(--secondary-background-color, #f0f8ff); border-radius: 8px; border-left: 4px solid var(--primary-color, #0077cc);"
    >
      <div
        style="font-weight: 600; font-size: 1.05em; margin-bottom: 12px; color: var(--primary-color, #0077cc);"
      >
        ${title}
      </div>
      ${content}
    </div>
  `;
}

/**
 * Renders a simple info message in a mode settings section
 * Used when a mode has no additional settings to configure
 *
 * @param {string} message - Message to display
 * @returns {TemplateResult} Styled info message
 */
export function renderModeInfoMessage(message) {
  return html`
    <div
      style="padding: 12px; background: var(--secondary-background-color, #f0f8ff); border-radius: 6px; color: var(--secondary-text-color, #666);"
    >
      ${message}
    </div>
  `;
}
