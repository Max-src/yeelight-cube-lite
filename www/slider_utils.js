/**
 * Centralized slider and button group utilities for Yeelight Cube Lite Draw Card Editor
 * Provides consistent rendering and handling for all UI components
 */

import { html, css } from "https://unpkg.com/lit@2.8.0/index.js?module";

/**
 * Renders a standardized slider with label and value display
 * @param {string} label - The slider label text
 * @param {number} value - Current slider value
 * @param {Object} config - Slider configuration
 * @param {Function} onChange - Change handler function
 * @param {string} unit - Unit suffix (px, %, etc.)
 * @returns {TemplateResult} Slider HTML template
 */
export function renderSlider(label, value, config, onChange, unit = "") {
  const {
    min = 0,
    max = 100,
    step = 1,
    width = "120px",
    valueWidth = "48px",
  } = config;

  return html`
    <div class="form-row">
      <label>${label}</label>
      <div style="display:flex;align-items:center;gap:16px;">
        <input
          type="range"
          min="${min}"
          max="${max}"
          step="${step}"
          .value="${value}"
          @input="${onChange}"
          @click="${(e) => e.stopPropagation()}"
          style="width:${width};"
        />
        <span class="slider-value"> ${value}${unit} </span>
      </div>
    </div>
  `;
}

/**
 * Renders a pixel gap slider with standard configuration
 * @param {string} label - The slider label
 * @param {number} value - Current pixel gap value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Pixel gap slider HTML
 */
export function renderPixelGapSlider(label, value, onChange) {
  return renderSlider(
    label,
    value,
    {
      min: 0,
      max: 6,
      step: 1,
      width: "120px",
      valueWidth: "32px",
    },
    onChange,
    "px"
  );
}

/**
 * Renders a percentage slider with standard configuration
 * @param {string} label - The slider label
 * @param {number} value - Current percentage value
 * @param {Function} onChange - Change handler
 * @param {Object} overrides - Optional config overrides
 * @returns {TemplateResult} Percentage slider HTML
 */
export function renderPercentageSlider(label, value, onChange, overrides = {}) {
  const config = {
    min: 25,
    max: 100,
    step: 5,
    width: "120px",
    valueWidth: "48px",
    ...overrides,
  };

  return renderSlider(label, value, config, onChange, "%");
}

/**
 * Renders a matrix size slider with standard configuration
 * @param {string} label - The slider label
 * @param {number} value - Current matrix size value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Matrix size slider HTML
 */
export function renderMatrixSizeSlider(label, value, onChange) {
  return renderPercentageSlider(label, value, onChange, {
    min: 50,
    max: 100,
    step: 1,
    width: "120px",
  });
}

/**
 * Standard slider event handler factory
 * Creates a change handler that updates config and fires change event
 * @param {Object} editor - The editor instance
 * @param {string} configKey - The config property to update
 * @param {Function} transformer - Optional value transformer (e.g., parseInt, Number)
 * @returns {Function} Event handler function
 */
export function createSliderHandler(editor, configKey, transformer = Number) {
  return (e) => {
    editor.config[configKey] = transformer(e.target.value);
    editor._fireConfigChanged();
  };
}

/**
 * Utility for consistent premium slider styling
 * Material Design sliders matching the color list editor style
 */
export const sliderStyles = css`
  .form-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    margin-bottom: 12px;
  }

  .form-row label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
    margin-bottom: 2px;
  }

  .form-row input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 140px;
    height: 4px;
    border-radius: 2px;
    background: #e0e0e0;
    outline: none;
    cursor: pointer;
    margin: 8px 0;
  }

  .form-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background: #1976d2;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    border: none;
    transition: all 0.2s ease;
  }

  .form-row input[type="range"]::-moz-range-thumb {
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background: #1976d2;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    border: none;
    transition: all 0.2s ease;
  }

  .form-row input[type="range"]::-webkit-slider-thumb:hover {
    background: #1565c0;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
    transform: scale(1.1);
  }

  .form-row input[type="range"]::-moz-range-thumb:hover {
    background: #1565c0;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
    transform: scale(1.1);
  }

  .form-row input[type="range"]::-webkit-slider-track {
    background: linear-gradient(
      to right,
      #1976d2 0%,
      #1976d2 var(--value-percent, 50%),
      #e0e0e0 var(--value-percent, 50%),
      #e0e0e0 100%
    );
    height: 4px;
    border-radius: 2px;
  }

  .form-row input[type="range"]::-moz-range-track {
    background: #e0e0e0;
    height: 4px;
    border-radius: 2px;
    border: none;
  }

  .form-row input[type="range"]::-moz-range-progress {
    background: #1976d2;
    height: 4px;
    border-radius: 2px;
    border: none;
  }

  /* Value display styling - clean and minimal */
  .slider-value {
    font-weight: 600;
    color: var(--primary-text-color, #333);
    text-align: center;
    min-width: 45px;
    font-size: 0.9em;
  }

  /* Legacy support for inline styled spans - clean style */
  .form-row span {
    font-weight: 600;
    color: var(--primary-text-color, #333);
    text-align: center;
    min-width: 45px;
    font-size: 0.9em;
  }
`;

// ==================== BUTTON GROUP UTILITIES ====================

/**
 * Standard background color options for consistency across components
 */
export const BACKGROUND_COLORS = [
  { value: "transparent", label: "Transparent" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "#111", label: "Grey" },
];

/**
 * Standard pixel style options
 */
export const PIXEL_STYLES = [
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
];

/**
 * Standard gallery display modes
 */
export const GALLERY_MODES = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
  { value: "carousel", label: "Carousel" },
];

/**
 * Renders a standardized button group with consistent styling
 * @param {string} label - The group label text
 * @param {Array} options - Array of {value, label} objects
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler function
 * @param {string} groupClass - Optional CSS class for the group container
 * @returns {TemplateResult} Button group HTML template
 */
export function renderButtonGroup(
  label,
  options,
  currentValue,
  onChange,
  groupClass = "palette-mode-group"
) {
  return html`
    <div class="form-row">
      <label>${label}</label>
      <div class="${groupClass}">
        ${options.map(
          (option) => html`
            <button
              class="palette-mode-btn${currentValue === option.value
                ? " selected"
                : ""}"
              title="${option.label}"
              @click="${() => onChange({ target: { value: option.value } })}"
              type="button"
            >
              ${option.label}
            </button>
          `
        )}
      </div>
    </div>
  `;
}

/**
 * Renders a background color button group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Background color button group HTML
 */
export function renderBackgroundColorGroup(label, currentValue, onChange) {
  return renderButtonGroup(label, BACKGROUND_COLORS, currentValue, onChange);
}

/**
 * Renders a pixel style button group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Pixel style button group HTML
 */
export function renderPixelStyleGroup(label, currentValue, onChange) {
  return renderButtonGroup(label, PIXEL_STYLES, currentValue, onChange);
}

/**
 * Renders an expand button mode group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Expand button mode group HTML
 */
export function renderExpandButtonModeGroup(label, currentValue, onChange) {
  const expandBtnOptions = [
    { value: "label", label: "Label" },
    { value: "icon", label: "Icon" },
  ];

  return renderButtonGroup(label, expandBtnOptions, currentValue, onChange);
}

/**
 * Renders a matrix pixel style group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Matrix pixel style group HTML
 */
export function renderMatrixPixelStyleGroup(label, currentValue, onChange) {
  const pixelStyleOptions = [
    { value: "false", label: "Round" },
    { value: "true", label: "Square" },
  ];

  return renderButtonGroup(label, pixelStyleOptions, currentValue, onChange);
}

/**
 * Renders a gallery background color group with extended options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Gallery background color group HTML
 */
export function renderGalleryBackgroundColorGroup(
  label,
  currentValue,
  onChange
) {
  const galleryBgOptions = [
    { value: "transparent", label: "Transparent" },
    { value: "white", label: "White" },
    { value: "black", label: "Black" },
    { value: "#111", label: "Grey" },
  ];

  return renderButtonGroup(label, galleryBgOptions, currentValue, onChange);
}

/**
 * Renders a gallery pixel style group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Gallery pixel style group HTML
 */
export function renderGalleryPixelStyleGroup(label, currentValue, onChange) {
  const galleryPixelStyleOptions = [
    { value: "round", label: "Round" },
    { value: "square", label: "Square" },
  ];

  return renderButtonGroup(
    label,
    galleryPixelStyleOptions,
    currentValue,
    onChange
  );
}

/**
 * Renders a swatch shape group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Swatch shape group HTML
 */
export function renderSwatchShapeGroup(label, currentValue, onChange) {
  const swatchShapeOptions = [
    { value: "round", label: "Round" },
    { value: "square", label: "Square" },
  ];

  return renderButtonGroup(label, swatchShapeOptions, currentValue, onChange);
}

/**
 * Renders a palette card container mode group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Palette card container mode group HTML
 */
export function renderPaletteCardModeGroup(label, currentValue, onChange) {
  const paletteCardModeOptions = [
    { value: "side", label: "Side-by-Side" },
    { value: "stacked", label: "Stacked" },
    { value: "tabs", label: "Tabs" },
    { value: "dropdown", label: "Dropdown" },
    { value: "preview-hover", label: "Preview Hover" },
  ];

  return renderButtonGroup(
    label,
    paletteCardModeOptions,
    currentValue,
    onChange
  );
}

/**
 * Renders a palette display mode group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Palette display mode group HTML
 */
export function renderPaletteDisplayModeGroup(label, currentValue, onChange) {
  const paletteDisplayModeOptions = [
    { value: "row", label: "Row" },
    { value: "grid", label: "Grid" },
    { value: "expand", label: "Expandable" },
  ];

  return renderButtonGroup(
    label,
    paletteDisplayModeOptions,
    currentValue,
    onChange
  );
}

/**
 * Renders a paint button shape group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Paint button shape group HTML
 */
export function renderPaintButtonShapeGroup(label, currentValue, onChange) {
  const paintButtonShapeOptions = [
    { value: "rect", label: "Rounded" },
    { value: "circle", label: "Circle" },
    { value: "square", label: "Square" },
  ];

  return renderButtonGroup(
    label,
    paintButtonShapeOptions,
    currentValue,
    onChange
  );
}

/**
 * Renders a gallery display mode group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Gallery display mode group HTML
 */
export function renderGalleryDisplayModeGroup(label, currentValue, onChange) {
  const galleryDisplayModeOptions = [
    { value: "grid", label: "Grid" },
    { value: "list", label: "List" },
    { value: "carousel", label: "Carousel" },
  ];

  return renderButtonGroup(
    label,
    galleryDisplayModeOptions,
    currentValue,
    onChange
  );
}

/**
 * Renders a gallery mode button group with standard options
 * @param {string} label - The group label
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @returns {TemplateResult} Gallery mode button group HTML
 */
export function renderGalleryModeGroup(label, currentValue, onChange) {
  return renderButtonGroup(label, GALLERY_MODES, currentValue, onChange);
}

/**
 * Renders a radio button group (alternative style for some cases)
 * @param {string} label - The group label
 * @param {Array} options - Array of {value, label} objects
 * @param {string} currentValue - Currently selected value
 * @param {Function} onChange - Change handler
 * @param {string} groupName - Radio group name attribute
 * @returns {TemplateResult} Radio button group HTML
 */
export function renderRadioGroup(
  label,
  options,
  currentValue,
  onChange,
  groupName
) {
  return html`
    <div class="form-row">
      <label>${label}</label>
      <div>
        ${options.map(
          (option) => html`
            <label>
              <input
                type="radio"
                name="${groupName}"
                value="${option.value}"
                .checked="${currentValue === option.value}"
                @change="${onChange}"
              />
              ${option.label}
            </label>
          `
        )}
      </div>
    </div>
  `;
}

/**
 * Standard button group event handler factory
 * Creates a change handler that updates config and fires change event
 * @param {Object} editor - The editor instance
 * @param {string} configKey - The config property to update
 * @returns {Function} Event handler function
 */
export function createButtonGroupHandler(editor, configKey) {
  return (value) => {
    editor.config[configKey] = value;
    editor._fireConfigChanged();
  };
}

/**
 * Additional CSS styles for button groups
 */
export const buttonGroupStyles = css`
  .palette-mode-group {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .palette-mode-btn {
    padding: 6px 12px;
    border: 1px solid var(--divider-color, #ccc);
    background: #f8f9fa;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    transition: all 0.2s ease;
  }

  .palette-mode-btn:hover {
    background: #e9ecef;
    border-color: #0077cc;
  }

  .palette-mode-btn.selected {
    background: #0077cc;
    color: var(--text-primary-color, #fff);
    border-color: #0077cc;
  }

  .form-row label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    cursor: pointer;
  }

  .form-row input[type="radio"] {
    margin: 0;
  }
`;

/**
 * Renders a pagination mode selection button group
 * @param {string} label - The group label text
 * @param {string} currentValue - Currently selected pagination mode
 * @param {Function} onChange - Change handler function
 * @returns {string} HTML string for the pagination mode group
 */
export function renderGalleryPaginationModeGroup(
  label,
  currentValue,
  onChange
) {
  const paginationModeOptions = [
    { value: "pages", label: "Pages" },
    { value: "all", label: "All" },
  ];

  return renderButtonGroup(
    label,
    paginationModeOptions,
    currentValue,
    onChange
  );
}
