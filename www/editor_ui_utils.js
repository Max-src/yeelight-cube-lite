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
 * Unified CSS styles for all editor cards.
 * Matches the color list editor card editor (the reference).
 * All editors should import this for consistent appearance.
 */
export const sharedEditorStyles = css`
  /* Base editor layout */
  .editor-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px 8px 8px 8px;
  }

  /* Foldable card sections */
  .editor-card {
    background: var(--secondary-background-color, #f7fafd);
    border-radius: 14px;
    box-shadow: 0 2px 8px #0001;
    padding: 16px 18px 12px 18px;
    margin-bottom: 10px;
    position: relative;
  }
  .editor-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 1.15em;
    font-weight: 600;
    margin-bottom: 8px;
    cursor: pointer;
    user-select: none;
  }
  .editor-card-content {
    transition:
      max-height 0.3s,
      opacity 0.3s;
    overflow: hidden;
  }
  .editor-card-collapsed .editor-card-content {
    max-height: 0;
    opacity: 0;
    pointer-events: none;
  }
  .editor-card:not(.editor-card-collapsed) .editor-card-content {
    max-height: 2000px;
    opacity: 1;
    pointer-events: auto;
  }

  /* Form rows — column layout: label above, control below (full-width) */
  .form-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    margin-bottom: 16px;
  }

  /* Labels */
  label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
  }

  /* Text inputs and selects */
  input[type="text"],
  input[type="number"],
  select {
    width: 100%;
    padding: 8px 12px;
    font-size: 1em;
    border-radius: 8px;
    border: 1px solid var(--divider-color, #cfd8dc);
    margin-top: 2px;
    box-sizing: border-box;
    background: var(--secondary-background-color, #f7f8fa);
  }

  /* Toggle switches — horizontal row: label left, toggle right */
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .toggle-label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
  }
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }
  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--divider-color, #cfd8dc);
    transition: 0.2s;
    border-radius: 24px;
  }
  .toggle-slider:before {
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
  input:checked + .toggle-slider {
    background-color: var(--primary-color, #1976d2);
  }
  input:checked + .toggle-slider:before {
    transform: translateX(20px);
  }

  /* Range slider styles */
  input[type="range"] {
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

  /* Slider value display */
  .slider-value {
    font-weight: 600;
    color: var(--primary-text-color, #333);
    text-align: center;
    min-width: 45px;
    font-size: 0.9em;
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
      style="margin-top: 20px; padding: 16px; background: color-mix(in srgb, var(--primary-color, #1976d2) 10%, var(--card-background-color, #fff)); border-radius: 8px; border-left: 4px solid var(--primary-color, #0077cc);"
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
