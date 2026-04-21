import { html, css } from "./lib/lit-all.js";

// Reusable Button Group Component Utilities
export function createButtonGroup(choices, selectedValue, changeHandler) {
  return html`
    <div class="button-group">
      ${choices.map(
        (choice) => html`
          <button
            class="btn-group-item ${selectedValue === choice.value
              ? "active"
              : ""}"
            data-value="${choice.value}"
            @click="${changeHandler}"
            title="${choice.title || choice.label}"
          >
            ${choice.label}
          </button>
        `,
      )}
    </div>
  `;
}

export function createButtonGroupChangeHandler(configKey, callback) {
  return (ev) => {
    const target = ev.target;
    if (!target || !target.dataset.value) return;

    const value = target.dataset.value;
    callback(value);
  };
}

// CSS styles for button groups (to be included in component styles)
export const buttonGroupStyles = css`
  /* Button group styles (reusable) */
  .button-group {
    display: flex !important;
    flex-wrap: wrap !important;
    border-radius: 8px !important;
    overflow: visible !important;
    border: 1.5px solid var(--divider-color, #d0d7de) !important;
    margin-top: 8px !important;
    gap: 0px !important;
  }

  .btn-group-item {
    flex: 1 1 auto !important;
    padding: 8px 10px !important;
    border: none !important;
    border-radius: 0 !important;
    background: var(--card-background-color, white) !important;
    color: var(--primary-text-color, #333) !important;
    font-size: 0.82em !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    transition: all 0.2s ease !important;
    border-right: 1px solid var(--divider-color, #d0d7de) !important;
    border-bottom: 1px solid var(--divider-color, #d0d7de) !important;
    text-align: center !important;
    white-space: nowrap !important;
    min-width: 0 !important;
  }

  .btn-group-item:last-child {
    border-right: none !important;
  }

  .btn-group-item:hover {
    background: var(--secondary-background-color, #f6f8fa) !important;
  }

  .btn-group-item.active {
    background: var(--primary-color, #0969da) !important;
    color: var(--text-primary-color, #fff) !important;
  }

  .btn-group-item.active:hover {
    background: var(--primary-color, #0860ca) !important;
  }
`;
