// Stylesheet of the lamp preview card (static). The config-dependent dot
// shape and shadow come from --lamp-dot-radius / --lamp-dot-shadow, set on
// the matrix grid (lamp-preview-matrix.js, _matrixGeometry).
import { exportImportButtonStyles } from "./action-button-utils.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { orientationControlStyles } from "./orientation-control-utils.js";
import { sliderControlStyles } from "./slider-control-utils.js";

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
      .button-row {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 10px;
        padding: 10px;
        margin: 10px 0;
      }
      ${orientationControlStyles}
      .button-row.two-buttons {
        justify-content: center;
      }
      .button-row .power-toggle-container,
      .button-row .force-refresh-container {
        padding: 0;
        margin: 0;
      }
      .force-refresh-container {
        display: inline-block;
        text-align: center;
        padding: 10px;
      }
      .force-refresh-btn {
        cursor: pointer;
      }
      .force-refresh-btn.loading {
        opacity: 0.6;
        cursor: wait;
      }
      .lamp-dot.lamp-dot-empty {
        border: none;
        box-shadow: none;
        background: transparent !important;
      }
      /* Brightness/value slider (all styles + interactions) — the full
         control CSS lives in the shared ./slider-control-utils.js module so
         the clock card and this card share one source of truth. */
      ${sliderControlStyles}
      .brightness-value {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }
      .adjustment-controls {
        width: 100%;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .color-effects-container {
        width: 100%;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .effect-section {
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
        overflow: hidden;
        background: var(--card-background-color, #1c1c1c);
      }
      .effect-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: var(--secondary-background-color, rgba(255, 255, 255, 0.05));
        transition: background 0.2s;
      }
      .effect-section-header:hover {
        background: var(--secondary-background-color, rgba(255, 255, 255, 0.08));
      }
      .section-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        cursor: pointer;
        user-select: none;
      }
      .expand-icon {
        font-size: 12px;
        transition: transform 0.2s;
        color: var(--primary-color, #03a9f4);
      }
      .section-title {
        font-size: 0.95em;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      .reset-section-button {
        background: transparent;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        color: var(--primary-color, #03a9f4);
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: all 0.2s;
      }
      .reset-section-button:hover {
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, white);
        border-color: var(--primary-color, #03a9f4);
      }
      .reset-section-button ha-icon {
        width: 18px;
        height: 18px;
      }
      .effect-section-content {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: max-height 0.3s ease-out;
      }
      .adjustment-slider-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .adjustment-label {
        font-size: 0.9em;
        color: var(--primary-text-color);
        font-weight: 500;
      }
      .adjustment-slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(to right, var(--disabled-text-color, #555), var(--divider-color, #aaa));
        outline: none;
        -webkit-appearance: none;
        cursor: pointer;
      }
      .adjustment-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary-color, #2196f3);
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }
      .adjustment-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--primary-color, #2196f3);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }
      .power-toggle-container {
        text-align: center;
        padding: 10px;
        margin: 10px;
      }
      
      .power-toggle-container button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .spinning {
        animation: spin 1s linear infinite;
      }

      .button-row .power-toggle-button {
        margin: 0;
      }

      /* === CHANGE INDICATOR === */
      .change-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent-color, #ff9800);
        margin-left: 6px;
        opacity: 0;
        transform: scale(0);
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        box-shadow: 0 0 8px rgba(255, 152, 0, 0.6);
        position: relative;
        top: -2px;
      }
      .change-indicator.visible {
        opacity: 1;
        transform: scale(1);
      }
      .change-indicator::after {
        content: '';
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        border-radius: 50%;
        background: rgba(255, 152, 0, 0.3);
        animation: pulse-indicator 2s infinite;
      }
      @keyframes pulse-indicator {
        0%, 100% { transform: scale(1); opacity: 0.3; }
        50% { transform: scale(1.3); opacity: 0; }
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

      /* === COMPACT LAYOUT === */
      .effects-compact-container {
        width: auto;
        /* padding: 12px; */
        display: flex;
        flex-direction: column;
        gap: 8px;
        /* background: var(--card-background-color, #1c1c1c); */
        border-radius: 8px;
      }
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
      .reset-mode-never .compact-slider-row {
        grid-template-columns: 30px 100px 1fr 60px;
      }
      /* Compact: Flat */
      .effects-compact-container.style-flat .compact-slider-row {
        background: transparent;
      }
      .effects-compact-container.style-flat .compact-slider-row:hover {
        background: transparent;
      }
      /* Compact: Subtle */
      .effects-compact-container.style-subtle .compact-slider-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      .effects-compact-container.style-subtle .compact-slider-row:hover {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
      }
      /* Compact: Filled */
      .effects-compact-container.style-filled .compact-slider-row {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .effects-compact-container.style-filled .compact-slider-row:hover {
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

      /* === TABBED LAYOUT === */
      .effects-tabbed-container {
        /* width: 100%; */
        padding: 12px;
        border-radius: 8px;
      }
      .tab-headers {
        display: flex;
        gap: 4px;
        border-bottom: 2px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        justify-content: space-around;
      }
      .tab-header {
        background: transparent;
        border: none;
        padding: 10px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.9em;
        color: var(--secondary-text-color);
        border-bottom: 3px solid transparent;
        transition: all 0.2s;
        font-weight: 500;
        position: relative; /* For absolute positioning of indicator */
      }
      .tab-header:hover {
        background: var(--secondary-background-color, rgba(255, 255, 255, 0.05));
        color: var(--primary-text-color);
      }
      .tab-header.active {
        color: var(--primary-color, #03a9f4);
        border-bottom-color: var(--primary-color, #03a9f4);
        font-weight: 600;
      }
      .tab-icon {
        font-size: 16px;
      }
      .tab-title {
        font-size: 0.95em;
      }
      /* Change indicator in tab header - positioned absolutely to not affect layout */
      .tab-header .change-indicator {
        position: absolute;
        top: 6px;
        right: 6px;
        margin-left: 0; /* Override default margin */
      }
      .tab-content-container {
        position: relative;
      }
      .tab-content {
        display: none;
      }
      .tab-content.active {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .tabbed-content-header {
        display: flex;
        align-items: center;
        border-radius: 8px;
      }
      .tabbed-content-title {
        margin: 0;
        font-size: 1.1em;
        font-weight: 600;
        color: var(--primary-text-color);
        display: flex;
        align-items: center;
        gap: 8px;
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
      .effects-tabbed-container.style-flat .tabbed-slider-row {
        background: transparent;
      }
      /* Tabbed: Subtle */
      .effects-tabbed-container.style-subtle .tabbed-slider-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      /* Tabbed: Filled */
      .effects-tabbed-container.style-filled .tabbed-slider-row {
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

      /* === GROUPED LAYOUT (Modern Default) === */
      .effects-grouped-container {
        position: relative;
      }
      .grouped-section {
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
        transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                    margin 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.3s ease,
                    border-color 0.3s ease,
                    box-shadow 0.3s ease,
                    transform 0.3s ease;
        position: relative;
        max-height: 1000px;
        opacity: 1;
      }
      /* Subtle: gentle tinted background */
      .grouped-section.style-subtle {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      /* Flat: transparent, blends with card/dashboard background */
      .grouped-section.style-flat {
        background: transparent;
        box-shadow: none;
      }
      /* Filled: full secondary background for strong separation */
      .grouped-section.style-filled {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      .grouped-section.hidden {
        display: none;
        max-height: 0;
        opacity: 0;
        padding: 0;
        border: none;
        pointer-events: none;
      }
      .grouped-section:hover {
        border-color: rgba(3, 169, 244, 0.4);
        transform: translateY(-2px);
      }
      .grouped-section.style-subtle:hover,
      .grouped-section.style-filled:hover {
        box-shadow: 0 4px 16px rgba(3, 169, 244, 0.15);
      }
      .grouped-section.style-flat:hover {
        box-shadow: none;
      }
      .grouped-section.expanded {
        border-color: rgba(3, 169, 244, 0.3);
      }
      .grouped-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 10px 2px;
        background: transparent;
        cursor: pointer;
        user-select: none;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .grouped-header:hover {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .grouped-header:active {
        transform: scale(0.99);
      }
      .grouped-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
      }
      .grouped-icon {
        font-size: 24px;
        min-width: 30px;
        text-align: center;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
        transition: transform 0.3s ease;
      }
      .grouped-section:hover .grouped-icon {
        transform: scale(1.1);
      }
      .grouped-title-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .grouped-title {
        font-size: 1em;
        font-weight: 700;
        color: var(--primary-text-color);
        letter-spacing: 0.3px;
      }
      .grouped-description {
        font-size: 0.75em;
        color: var(--secondary-text-color);
        opacity: 0.8;
      }
      .grouped-header-right {
        display: flex;
        align-items: center;
        gap: 10px;
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
      .grouped-content {
        max-height: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 10px;
        /* background: rgba(0, 0, 0, 0.2); */
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
        padding: 0 14px 0 14px;
        transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                    padding 0.3s ease;
      }
      .grouped-section.expanded .grouped-content {
        max-height: 2000px;
        padding: 12px 14px 14px 14px;
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

      /* === RADIAL LAYOUT === */

      /* ===== RADIAL LAYOUT STYLES ===== */
      .effects-radial-container {
        display: flex;
        gap: 0;
        padding: 16px;
        padding-left: 90px;
        padding-right: 0PX
        /* background: var(--card-background-color, #1c1c1c); */
        border-radius: 12px;
        align-items: flex-start;
        position: relative;
      }

      .radial-wheel-container {
        flex: 0 0 80px;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        position: absolute;
        left: 0px;
        top: 0;
        z-index: 1;
        width: 80px;
        height: 160px;
        padding-top: 8px;
        overflow: visible;
      }

      .radial-wheel {
        width: 80px;
        height: 160px;
        filter: drop-shadow(1px 1px 3px rgba(0, 0, 0, 0.15));
        overflow: visible;
        will-change: auto;
        backface-visibility: hidden;
        transform: translateZ(0);
      }

      /* Single ring segments - clearly defined clickable areas */
      .radial-segment {
        fill: var(--card-background-color, #fff);
        stroke: none;
        cursor: pointer;
        transition: fill 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
                    stroke 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                    stroke-width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                    filter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        will-change: fill, stroke;
      }

      .radial-segment:hover {
        fill: var(--secondary-background-color, rgba(200, 200, 200, 0.3));
      }

      .radial-segment.active-category {
        fill: rgba(3, 169, 244, 0.15);
        stroke: rgba(3, 169, 244, 0.6);
        stroke-width: 1;
      }

      /* Highlight segments with changed values */
      .radial-segment.has-changes {
        fill: rgba(255, 152, 0, 0.12);
        stroke: rgba(255, 152, 0, 0.5);
        stroke-width: 1.5;
      }

      .radial-segment.has-changes:hover {
        fill: rgba(255, 152, 0, 0.2);
      }

      /* Active category with changes - combine both styles */
      .radial-segment.active-category.has-changes {
        fill: rgba(255, 152, 0, 0.25);
        stroke: rgba(255, 152, 0, 0.7);
        stroke-width: 2;
        filter: drop-shadow(0 0 6px rgba(255, 152, 0, 0.4));
      }

      .radial-separator {
        display: block;
        stroke: var(--divider-color, rgba(200, 200, 200, 0.3));
        stroke-width: 1.5;
        pointer-events: none;
      }

      /* Outer circle border */
      .radial-outer-border {
        display: block;
        fill: none;
        stroke: var(--divider-color, rgba(200, 200, 200, 0.3));
        stroke-width: 1.5;
        pointer-events: none;
      }

      .radial-segment.selected {
        fill: var(--primary-color, #03a9f4);
        stroke: var(--primary-color, #03a9f4);
        stroke-width: 2;
        filter: drop-shadow(0 0 6px var(--primary-color, #03a9f4));
      }

      .radial-icon {
        font-size: 14px;
        fill: var(--secondary-text-color, rgba(128, 128, 128, 0.7));
        transition: all 0.3s ease;
        pointer-events: none;
      }

      .radial-icon.active-category {
        font-size: 15px;
        fill: rgba(3, 169, 244, 0.8);
      }

      .radial-icon.selected {
        font-size: 16px;
        fill: var(--text-primary-color, #fff);
        filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.9));
      }

      /* Center circle */
      .radial-center {
        fill: var(--card-background-color, #fff);
        stroke: var(--divider-color, rgba(0, 0, 0, 0.12));
        stroke-width: 1;
      }

      .radial-center-icon {
        font-size: 22px;
        fill: var(--primary-color, #03a9f4);
        pointer-events: none;
        /* filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4)); */
      }

      /* Slider panel */
      .radial-slider-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        /* padding: 0 12px; */
        /* background: var(--card-background-color, #1c1c1c); */
        /* border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08); */
        margin-left: 0;
        position: relative;
        z-index: 2;
      }

      .radial-category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        margin-bottom: 4px;
      }

      .radial-category-title {
        font-size: 1.1em;
        font-weight: 600;
        color: var(--primary-text-color);
        align-self: self-start;
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
      .effects-radial-container.style-flat .radial-effect-row {
        background: transparent;
      }
      .effects-radial-container.style-flat .radial-effect-row:hover {
        background: transparent;
      }
      /* Radial: Subtle */
      .effects-radial-container.style-subtle .radial-effect-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      .effects-radial-container.style-subtle .radial-effect-row:hover {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
      }
      /* Radial: Filled */
      .effects-radial-container.style-filled .radial-effect-row {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .effects-radial-container.style-filled .radial-effect-row:hover {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }

      .radial-effect-row.selected {
        background: transparent;
        box-shadow: none;
      }

      .radial-effect-row-header {
        display: flex;
        align-items: center;
        gap: 10px;
        /* margin-bottom: 6px; */
      }

      .radial-effect-row-icon {
        display: none; /* Icons removed */
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

      /* Responsive adjustments for radial layout */
      @media (max-width: 768px) {
        .effects-radial-container {
          flex-direction: row;
          padding: 12px;
          padding-left: 80px;
          align-items: flex-start;
          position: relative;
          gap: 8px;
        }

        .radial-wheel-container {
          flex: 0 0 80px;
          left: 0;
          position: absolute;
          z-index: 1;
          width: 80px;
          height: 160px;
          top: 12px;
        }
        
        .radial-wheel {
          width: 80px;
          height: 160px;
        }

        .radial-slider-panel {
          flex: 1;
          margin-left: 0;
          background: var(--card-background-color, #1c1c1c);
          position: relative;
          z-index: 2;
          min-width: 0;
        }
        
        /* Keep all icons visible on mobile */
        .radial-icon {
          font-size: 12px;
        }
        
        .radial-icon.active-category {
          font-size: 14px;
        }
      }

      /* ===== CATEGORIES LAYOUT STYLES ===== */
      .effects-categories-container {
        display: flex;
        gap: 12px;
       /*  padding: 12px;
        background: var(--card-background-color, #1c1c1c); */
        border-radius: 8px;
        align-items: stretch;
      }

      /* Icon column on left */
      .categories-icon-column {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        /* gap: 12px;
        padding: 12px; */
        background: transparent;
        border-radius: 8px;
        border: none;
      }

      .categories-icon-button {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: transparent;
        border: 1px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        position: relative; /* For absolute positioning of indicator */
      }

      .categories-icon-button:hover {
        background: var(--secondary-background-color, rgba(200, 200, 200, 0.15));
        border-color: var(--divider-color, rgba(200, 200, 200, 0.2));
        transform: scale(1.1);
      }

      .categories-icon-button.active {
        background: rgba(3, 169, 244, 0.15);
        border: 2px solid rgba(3, 169, 244, 0.6);
        box-shadow: 0 0 12px rgba(3, 169, 244, 0.4);
      }

      .categories-icon-emoji {
        font-size: 20px;
        transition: all 0.3s ease;
      }

      .categories-icon-button.active .categories-icon-emoji {
        filter: drop-shadow(0 0 4px rgba(3, 169, 244, 0.6));
      }

      /* Indicator positioning for categories layout */
      .categories-icon-button .change-indicator {
        position: absolute;
        top: -2px;
        right: -2px;
        margin-left: 0;
      }

      /* Slider panel */
      .categories-slider-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        /* gap: 10px;
        padding: 12px; */
        background: transparent;
        border-radius: 8px;
        border: none;
      }

      .categories-category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--divider-color, rgba(200, 200, 200, 0.15));
        margin-bottom: 6px;
      }

      .categories-category-title {
        font-size: 1.15em;
        font-weight: 600;
        color: var(--primary-text-color);
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
      .effects-categories-container.style-flat .categories-effect-row {
        background: transparent;
      }
      .effects-categories-container.style-flat .categories-effect-row:hover {
        background: transparent;
      }
      /* Categories: Subtle */
      .effects-categories-container.style-subtle .categories-effect-row {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      }
      .effects-categories-container.style-subtle .categories-effect-row:hover {
        background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 60%, var(--card-background-color, #fff) 40%);
      }
      /* Categories: Filled */
      .effects-categories-container.style-filled .categories-effect-row {
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
      }
      .effects-categories-container.style-filled .categories-effect-row:hover {
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
      @media (max-width: 768px) {
        .effects-circular-container {
          flex-direction: column;
          align-items: center;
        }

        .circular-wheel-container {
          margin-bottom: 16px;
        }

        .circular-slider-panel {
          width: 100%;
        }
      }
`;
