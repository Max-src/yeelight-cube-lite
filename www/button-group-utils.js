import { html, css } from "https://unpkg.com/lit@2.8.0/index.js?module";

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
        `
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
    border-radius: 8px !important;
    overflow: hidden !important;
    border: 1.5px solid #d0d7de !important;
    margin-top: 8px !important;
    gap: 0px !important;
  }

  .btn-group-item {
    flex: 1 !important;
    padding: 8px 12px !important;
    border: none !important;
    border-radius: 0 !important;
    background: white !important;
    color: #333 !important;
    font-size: 0.85em !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    transition: all 0.2s ease !important;
    border-right: 1px solid #d0d7de !important;
    text-align: center !important;
    white-space: nowrap !important;
  }

  .btn-group-item:last-child {
    border-right: none !important;
  }

  .btn-group-item:hover {
    background: #f6f8fa !important;
  }

  .btn-group-item.active {
    background: #0969da !important;
    color: white !important;
  }

  .btn-group-item.active:hover {
    background: #0860ca !important;
  }
`;
