import { css, html } from "./lib/lit-all.js";

export const formRowStyles = css`
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
`;

// Helper function to create a toggle switch row
export function createToggleRow(label, id, checked, changeHandler) {
  return html`
    <div class="toggle-row">
      <label class="toggle-label">${label}</label>
      <label class="toggle-switch">
        <input
          type="checkbox"
          id="${id}"
          .checked="${checked}"
          @change="${changeHandler}"
        />
        <span class="toggle-slider"></span>
      </label>
    </div>
  `;
}

// Helper function to create a config row with select
export function createConfigRow(label, id, options, value, changeHandler) {
  const optionsHtml = options.map(
    (opt) =>
      html`<option value="${opt.value}" ?selected="${opt.value === value}">
        ${opt.label}
      </option>`,
  );

  return html`
    <div class="config-row">
      <label class="config-label">${label}</label>
      <select id="${id}" @change="${changeHandler}">
        ${optionsHtml}
      </select>
    </div>
  `;
}

/**
 * Creates a slider row with column layout matching the unified editor style
 * @param {string} label - The slider label text
 * @param {number} value - Current slider value
 * @param {Object} config - Slider configuration (min, max, step)
 * @param {Function} onChange - Change handler function
 * @param {string} unit - Unit suffix (px, %, etc.)
 * @returns {TemplateResult} Slider HTML template
 */
export function createSliderRow(label, value, config, onChange, unit = "") {
  const { min = 0, max = 100, step = 1 } = config;

  return html`
    <div class="form-row">
      <label>${label}</label>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input
          type="range"
          min="${min}"
          max="${max}"
          step="${step}"
          .value="${value}"
          @input="${onChange}"
          @click="${(e) => e.stopPropagation()}"
          style="flex: 1;"
        />
        <span class="slider-value"> ${value}${unit} </span>
      </div>
    </div>
  `;
}

export function createButtonGroupRow(label, buttonGroupHtml) {
  return html`
    <div class="form-row">
      <label>${label}</label>
      ${buttonGroupHtml}
    </div>
  `;
}
