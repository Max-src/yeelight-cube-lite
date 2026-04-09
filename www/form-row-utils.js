import { css, html } from "https://unpkg.com/lit@2.8.0/index.js?module";

export const formRowStyles = css`
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .config-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .config-label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
  }
  .toggle-label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
  }
  .config-row select {
    padding: 6px 12px;
    border: 1.5px solid #d0d7de;
    border-radius: 8px;
    background: var(--card-background-color, white);
    font-size: 0.9em;
    color: var(--primary-text-color, #333);
    min-width: 140px;
  }
  .config-row select:focus {
    outline: none;
    border-color: var(--primary-color, #0969da);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color, #0969da) 10%, transparent);
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
 * Creates a premium slider row with inline layout matching color list editor style
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
    <div class="config-row">
      <label class="config-label">${label}</label>
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
        <span
          style="min-width: 45px; text-align: right; font-size: 0.9em; color: var(--secondary-text-color, #666);"
        >
          ${value}${unit}
        </span>
      </div>
    </div>
  `;
}

export function createButtonGroupRow(label, buttonGroupHtml) {
  return html`
    <div class="config-row">
      <label class="config-label">${label}</label>
      <div
        style="display: flex; flex-direction: column; align-items: flex-end;"
      >
        ${buttonGroupHtml}
      </div>
    </div>
  `;
}
