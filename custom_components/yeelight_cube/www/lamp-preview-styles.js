// Stylesheet of the lamp preview card (static). The config-dependent dot
// shape and shadow come from --lamp-dot-radius / --lamp-dot-shadow, set on
// the matrix grid (lamp-preview-matrix.js, _matrixGeometry).
import { exportImportButtonStyles } from "./action-button-utils.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { orientationControlStyles } from "./orientation-control-utils.js";
import { sliderControlStyles } from "./slider-control-utils.js";
import { tabBarStyles } from "./tab-bar.js";
import { carouselStyles } from "./carousel-utils.js";
import { sectionLayoutStyles } from "./section-layouts.js";

const totalRows = 5;
const totalCols = 20;

export const LAMP_PREVIEW_CSS = `
      /* Inject centralized button styles */
      ${exportImportButtonStyles}
      ${cardLayoutStyles}

      .yeelight-cube-lamp-preview-container {
        width: 100%;
        max-width: 100%;
        /* Clips wide content, but not the matrix shadow: the card body's
           padding (16px) is room for it. Browsers without clip margins
           fall back to hidden. */
        overflow: hidden;
        overflow: clip;
        overflow-clip-margin: 16px;
        min-height: 0;
      }
      .lamp-preview-css {
        width: 100%;
        aspect-ratio: ${totalCols} / ${totalRows};
        border-radius: 12px;
        display: grid;
        box-sizing: border-box;
        padding: 8px;
      }
      .lamp-preview-css.align-center {
        margin-left: auto;
        margin-right: auto;
      }
      .lamp-preview-css.align-left {
        margin-left: 0;
        margin-right: auto;
      }
      .lamp-preview-css.align-right {
        margin-left: auto;
        margin-right: 0;
      }
      .lamp-dot {
        width: 100%;
        height: 100%;
        border-radius: var(--lamp-dot-radius, 0px);
        margin: auto;
        box-shadow: var(--lamp-dot-shadow, none);
        transition: background 0.2s, border 0.2s;
        aspect-ratio: 1 / 1;
        border: none;
        cursor: pointer;
        box-sizing: border-box;
        display: block;
      }
      .lamp-dot.lamp-dot-empty {
        border: none;
        box-shadow: none;
        background: transparent !important;
      }
      ${orientationControlStyles}
      .force-refresh-btn {
        cursor: pointer;
      }
      .force-refresh-btn.loading {
        opacity: 0.6;
        cursor: wait;
      }
      /* Brightness/value slider (all styles + interactions) — the full
         control CSS lives in the shared ./slider-control-utils.js module so
         the clock card and this card share one source of truth. */
      ${sliderControlStyles}
      ${tabBarStyles}
      ${carouselStyles}
      /* The adjustment categories' layouts (section-layouts.js). */
      ${sectionLayoutStyles}
      /* A category's sliders (the layouts without their own rows). */
      .adjustment-rows {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .brightness-value {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }

      /* === COMPACT LAYOUT RESET BUTTON === */
      .compact-reset-button {
        background: rgba(3, 169, 244, 0.1);
        border: 1.5px solid rgba(3, 169, 244, 0.4);
        color: var(--primary-color, #03a9f4);
        padding: 4px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 600;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 2px 4px rgba(3, 169, 244, 0.2);
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .compact-reset-button:hover {
        background: rgba(3, 169, 244, 0.2);
        border-color: var(--primary-color, #03a9f4);
        transform: scale(1.1);
        box-shadow: 0 3px 8px rgba(3, 169, 244, 0.3);
      }
      .compact-reset-button:active {
        transform: scale(0.95);
      }

      /* === COMPACT ROWS (the panel: section-layouts.js) === */
      .compact-slider-row {
        display: grid;
        grid-template-columns: 30px 100px 1fr 60px 32px;
        gap: 8px;
        align-items: center;
        padding: 6px;
        border-radius: 6px;
        transition: background 0.2s;
      }
      /* When reset buttons are never shown, remove the button column space */
      .compact-slider-row.no-reset {
        grid-template-columns: 30px 100px 1fr 60px;
      }
      /* Compact: Flat */
      .ys-compact.style-flat .compact-slider-row {
        background: transparent;
      }
      .ys-compact.style-flat .compact-slider-row:hover {
        background: transparent;
      }
      /* Compact: Subtle */
      .ys-compact.style-subtle .compact-slider-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      .ys-compact.style-subtle .compact-slider-row:hover {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
      }
      /* Compact: Filled */
      .ys-compact.style-filled .compact-slider-row {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .ys-compact.style-filled .compact-slider-row:hover {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .compact-icon {
        font-size: 18px;
        text-align: center;
      }
      .compact-label {
        font-size: 0.85em;
        font-weight: 500;
        color: var(--primary-text-color);
        white-space: nowrap;
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .compact-indicator {
        display: inline-block;
        position: relative;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent-color, #ff9800);
        opacity: 0;
        transform: scale(0);
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        box-shadow: 0 0 6px rgba(255, 152, 0, 0.6);
        margin-left: 2px;
      }
      .compact-indicator.visible {
        opacity: 1;
        transform: scale(1);
      }
      .compact-indicator::after {
        content: '';
        position: absolute;
        top: -1px;
        left: -1px;
        right: -1px;
        bottom: -1px;
        border-radius: 50%;
        background: rgba(255, 152, 0, 0.3);
        animation: pulse-indicator 2s infinite;
      }
      .compact-slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--disabled-text-color, #bbb);
        outline: none;
        -webkit-appearance: none;
        cursor: pointer;
      }
      .compact-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }
      .compact-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }
      .compact-value {
        font-size: 0.8em;
        color: var(--secondary-text-color);
        text-align: right;
        font-weight: 600;
        min-width: 50px;
      }

      .tabbed-reset-button {
        padding: 4px 0;
        font-size: 0.9em;
        font-weight: 500;
        color: var(--primary-color, #03a9f4);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        margin: 0 0 0 auto;
        align-self: flex-end;
        text-decoration: none;
      }
      .tabbed-reset-button:hover {
        color: var(--primary-color-dark, #0288d1);
      }
      .tabbed-reset-button:active {
        opacity: 0.7;
      }
      .tabbed-slider-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-radius: 6px;
      }
      /* Tabbed: Flat */
      .ys-tabs.style-flat .tabbed-slider-row {
        background: transparent;
      }
      /* Tabbed: Subtle */
      .ys-tabs.style-subtle .tabbed-slider-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      /* Tabbed: Filled */
      .ys-tabs.style-filled .tabbed-slider-row {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .tabbed-label-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .tabbed-label {
        font-size: 0.9em;
        color: var(--primary-text-color);
        font-weight: 500;
      }
      .tabbed-label strong {
        color: var(--primary-color, #03a9f4);
        margin-left: 4px;
      }
      .tabbed-hint {
        font-size: 0.75em;
        color: var(--secondary-text-color);
        font-style: italic;
      }
      .tabbed-slider {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background: var(--disabled-text-color, #bbb);
        outline: none;
        -webkit-appearance: none;
        cursor: pointer;
      }
      .tabbed-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      }
      .tabbed-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      }

      .grouped-reset {
        background: rgba(3, 169, 244, 0.1);
        border: 1.5px solid rgba(3, 169, 244, 0.4);
        color: var(--primary-color, #03a9f4);
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 2px 6px rgba(3, 169, 244, 0.2);
      }
      .grouped-reset:hover {
        background: rgba(3, 169, 244, 0.2);
        border-color: var(--primary-color, #03a9f4);
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(3, 169, 244, 0.3);
      }
      .grouped-reset:active {
        transform: scale(0.95);
      }
      .grouped-slider-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
        /* padding: 10px; */
        background: transparent;
        border-radius: 6px;
        border: none;
        transition: all 0.2s ease;
      }
      .grouped-slider-row:hover {
        background: transparent;
      }
      .grouped-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .grouped-label {
        flex: 1;
        font-size: 0.95em;
        color: var(--primary-text-color);
        font-weight: 600;
      }
      .grouped-value {
        font-size: 0.9em;
        color: var(--primary-color, #03a9f4);
        font-weight: 700;
        min-width: 50px;
        text-align: right;
        font-family: 'Courier New', monospace;
        background: rgba(3, 169, 244, 0.1);
        padding: 4px 8px;
        border-radius: 4px;
      }
      .grouped-slider {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background: var(--disabled-text-color, #bbb);
        outline: none;
        -webkit-appearance: none;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .grouped-slider:hover {
        height: 10px;
      }
      .grouped-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: linear-gradient(145deg, var(--primary-color, #03a9f4), var(--primary-color-dark, #0288d1));
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(3, 169, 244, 0.5), 0 0 12px rgba(3, 169, 244, 0.3);
        transition: all 0.2s ease;
      }
      .grouped-slider::-webkit-slider-thumb:hover {
        width: 24px;
        height: 24px;
        box-shadow: 0 4px 12px rgba(3, 169, 244, 0.6), 0 0 16px rgba(3, 169, 244, 0.4);
      }
      .grouped-slider::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: linear-gradient(145deg, var(--primary-color, #03a9f4), var(--primary-color-dark, #0288d1));
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 8px rgba(3, 169, 244, 0.5), 0 0 12px rgba(3, 169, 244, 0.3);
        transition: all 0.2s ease;
      }
      .grouped-slider::-moz-range-thumb:hover {
        width: 24px;
        height: 24px;
        box-shadow: 0 4px 12px rgba(3, 169, 244, 0.6), 0 0 16px rgba(3, 169, 244, 0.4);
      }
      .grouped-hint {
        font-size: 0.75em;
        color: var(--secondary-text-color);
        font-style: italic;
        margin-top: 4px;
      }

      .radial-reset-button {
        padding: 6px 12px;
        font-size: 0.9em;
        font-weight: 500;
        color: var(--primary-color, #03a9f4);
        background: rgba(3, 169, 244, 0.1);
        border: 1px solid var(--primary-color, #03a9f4);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
            position: absolute;
  right: 0;
      }

      .radial-reset-button:hover {
        background: rgba(3, 169, 244, 0.2);
        transform: scale(1.05);
      }

      .radial-reset-button:active {
        transform: scale(0.95);
      }

      .radial-effect-row {
        /* padding: 8px; */
        border-radius: 6px;
        border: none;
        transition: all 0.2s ease;
        cursor: default;
      }
      /* Radial: Flat */
      .ys-radial.style-flat .radial-effect-row {
        background: transparent;
      }
      .ys-radial.style-flat .radial-effect-row:hover {
        background: transparent;
      }
      /* Radial: Subtle */
      .ys-radial.style-subtle .radial-effect-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      .ys-radial.style-subtle .radial-effect-row:hover {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
      }
      /* Radial: Filled */
      .ys-radial.style-filled .radial-effect-row {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .ys-radial.style-filled .radial-effect-row:hover {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }

      .radial-effect-row-header {
        display: flex;
        align-items: center;
        gap: 10px;
        /* margin-bottom: 6px; */
      }

      .radial-effect-row-label {
        flex: 1;
        font-size: 0.95em;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      .radial-effect-row-value {
        font-size: 0.9em;
        font-weight: 600;
        color: var(--primary-color, #03a9f4);
        min-width: 45px;
        text-align: right;
        font-family: 'Courier New', monospace;
      }

      .radial-effect-slider {
        width: 100%;
        height: 5px;
        border-radius: 2.5px;
        background: var(--disabled-text-color, linear-gradient(to right, #444, #888));
        outline: none;
        -webkit-appearance: none;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .radial-effect-slider:hover {
        height: 6px;
      }

      .radial-effect-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
        transition: all 0.2s ease;
      }

      .radial-effect-slider::-webkit-slider-thumb:hover {
        width: 18px;
        height: 18px;
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
      }

      .radial-effect-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
        transition: all 0.2s ease;
      }

      .radial-effect-slider::-moz-range-thumb:hover {
        width: 18px;
        height: 18px;
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
      }

      .categories-reset-button {
        padding: 6px 12px;
        margin: -2px 0;
        font-size: 0.9em;
        font-weight: 500;
        color: var(--primary-color, #03a9f4);
        background: rgba(3, 169, 244, 0.1);
        border: 1px solid var(--primary-color, #03a9f4);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .categories-reset-button:hover {
        background: rgba(3, 169, 244, 0.2);
        transform: scale(1.05);
      }

      .categories-reset-button:active {
        transform: scale(0.95);
      }

      .categories-effect-row {
        padding: 8px;
        border-radius: 6px;
        border: none;
        transition: all 0.2s ease;
      }
      /* Categories: Flat */
      .ys-categories.style-flat .categories-effect-row {
        background: transparent;
      }
      .ys-categories.style-flat .categories-effect-row:hover {
        background: transparent;
      }
      /* Categories: Subtle */
      .ys-categories.style-subtle .categories-effect-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      .ys-categories.style-subtle .categories-effect-row:hover {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
      }
      /* Categories: Filled */
      .ys-categories.style-filled .categories-effect-row {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .ys-categories.style-filled .categories-effect-row:hover {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }

      .categories-effect-row-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 6px;
      }

      .categories-effect-row-label {
        flex: 1;
        font-size: 0.95em;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      .categories-effect-row-value {
        font-size: 0.9em;
        font-weight: 600;
        color: var(--primary-color, #03a9f4);
        min-width: 45px;
        text-align: right;
        font-family: 'Courier New', monospace;
      }

      .categories-effect-slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--disabled-text-color, #bbb);
        outline: none;
        -webkit-appearance: none;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .categories-effect-slider:hover {
        height: 7px;
      }

      .categories-effect-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
        transition: all 0.2s ease;
      }

      .categories-effect-slider::-webkit-slider-thumb:hover {
        width: 18px;
        height: 18px;
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
      }

      .categories-effect-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
        transition: all 0.2s ease;
      }

      .categories-effect-slider::-moz-range-thumb:hover {
        width: 18px;
        height: 18px;
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
      }

      /* Responsive adjustments for circular layout */
`;
