// Stylesheet of the colour list editor card.
import { css, unsafeCSS } from "./lib/lit-all.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import { exportImportButtonStyles } from "./action-button-utils.js";
import { compactLayoutStyles } from "./compact-layout-utils.js";
import { deleteButtonStyles } from "./delete-button-styles.js";
import { compactModeStyles } from "./compact-mode-styles.js";

// Card stylesheet (static; adopted once per shadow root by LitElement).
export const COLOR_LIST_EDITOR_STYLES = css`
        ${unsafeCSS(cardLayoutStyles)}
        :host {
          display: block;
          max-width: 100%;
          box-sizing: border-box;
          overflow: visible;
        }
        ha-card {
          overflow: visible;
        }
        * {
          box-sizing: border-box;
        }
        /* Block ALL native color inputs from receiving clicks.
           Color picking is handled by wrapper click handlers that call _openColorPickerAt(). */
        input[type="color"] {
          pointer-events: none !important;
        }
        > div {
          max-width: 100%;
          overflow: hidden;
        }
        .card-title {
          font-size: 1.3em;
          font-weight: bold;
          margin-bottom: 18px;
          margin-top: 2px;
          color: var(--primary-text-color, #222);
        }
        
        /* Header rotary styling - smaller and compact */
        .header-rotary {
          flex-shrink: 0;
        }
        
        .header-rotary .wheel-container,
        .header-rotary .rect-container,
        .header-rotary .default-container {
          margin: 0;
          gap: 4px;
        }
        
        .header-rotary svg {
          max-width: 60px !important;
          max-height: 60px !important;
        }
        
        .header-rotary .color-rect {
          width: 60px !important;
          aspect-ratio: 3 / 1 !important;
        }
        
        /* Hide angle display in header mode */
        .header-rotary div[style*="text-align: center"] {
          display: none;
        }
        .card-content {
          max-width: 480px;
          margin: 0 auto;
        }
        .color-row {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          background: var(--secondary-background-color, #fafbfc);
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          padding: 6px 12px;
          transition: box-shadow 0.2s, transform 0.2s cubic-bezier(.4,2,.6,1), background 0.2s;
          position: relative;
          width: 100%;
          box-sizing: border-box;
        }
        .color-main {
          display: flex;
          align-items: center;
          flex: 1 1 auto;
          min-width: 0;
        }
        
        /* Full row color mode styles */
        .color-row.full-row-color {
          border: 2px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.2);
          border: 0 !important;
        }
        
        .color-row.full-row-color[data-color-row="true"] {
          cursor: pointer;
        }
        
        .color-row.full-row-color[data-color-row="true"]:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(255, 255, 255, 0.3);
          border: 0 !important;
        }
        
        .color-row.full-row-color .color-main span,
        .color-row.full-row-color .color-main .hex-input {
          color: #fff;
        }
        
        .color-row.full-row-color .hex-input {
          background: rgba(255, 255, 255, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.4);
          transition: all 0.2s ease;
        }
        
        .color-row.full-row-color .hex-input:focus {
          background: rgba(255, 255, 255, 0.95) !important;
          color: var(--primary-text-color, #000) !important;
          border: 2px solid rgba(255, 255, 255, 0.9) !important;
          outline: none;
          box-shadow: 
            0 0 0 2px rgba(0, 0, 0, 0.3),
            0 0 0 4px rgba(255, 255, 255, 0.8),
            0 2px 8px rgba(0, 0, 0, 0.15) !important;
          transform: scale(1.02);
          z-index: 10;
          position: relative;
        }
        .color-actions {
          display: flex;
          align-items: center;
          gap: 20px;
          flex: 0 0 auto;
          justify-content: flex-end;
        }
        .color-row.dragging { box-shadow: 0 8px 24px rgba(0,0,0,0.18); z-index: 10; transform: scale(1.04); }
        .color-row.animating { transition: transform 0.2s cubic-bezier(.4,2,.6,1); }
        .color-row input[type="color"] {
          width: 32px;
          height: 32px;
          border: none;
          background: none;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
          padding: 0;
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .color-row input[type="color"]::-webkit-color-swatch {
          border-radius: 8px;
          border: none;
          padding: 0;
        }
        .color-row input[type="color"]::-webkit-color-swatch-wrapper {
          border-radius: 8px;
          padding: 0;
        }
        .color-row input[type="color"]::-moz-color-swatch {
          border-radius: 8px;
          border: none;
          padding: 0;
        }
        .color-row input[type="color"]::-moz-focus-inner {
          border: none;
        }
        .color-row input[type="text"].hex-input {
          width: 70px;
          margin-left: 8px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 1em;
          font-family: inherit;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #222);
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          transition: all 0.2s ease;
        }
        .color-row input[type="text"].hex-input:focus {
          border: 2px solid var(--primary-color, #1976d2) !important;
          outline: none;
          box-shadow: 
            0 0 0 2px color-mix(in srgb, var(--primary-color, #1976d2) 20%, transparent),
            0 2px 8px color-mix(in srgb, var(--primary-color, #1976d2) 15%, transparent) !important;
          background: var(--card-background-color, #fff) !important;
          transform: scale(1.02);
          z-index: 10;
          position: relative;
        }
        .remove-btn { background: color-mix(in srgb, var(--error-color, #db4437) 15%, var(--card-background-color, #fff)); border: none; border-radius: 6px; color: var(--error-color, #db4437); padding: 6px 18px; cursor: pointer; font-size: 1em; font-weight: 500; margin-left: 0; transition: background 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
        .remove-btn:hover { background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff)); }
        
        /* Make color-row relative for absolute positioning of cross */
        .color-row {
          position: relative;
        }
        
        /* Add padding when cross button is present */
        .color-row.has-cross {
          padding-right: 40px;
        }
        .drag-handle { margin-left: 0; cursor: grab; font-size: 1.5em; color: var(--secondary-text-color, #888); user-select: none; }
        .drag-handle::after { content: "\\2630"; }
        
        /* Drag handle styles for Full Row Color Mode */
        .color-row.full-row-color .drag-handle {
          transition: background 0.2s ease;
        }
        
        .color-row.full-row-color .drag-handle:hover {
          background: rgba(255, 255, 255, 0.5) !important;
        }
        #color-list { position: relative; 
        text-align: center;}
        
        /* Compact layout container - wrap items horizontally */
        #color-list.layout-compact {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: flex-start;
          justify-content: space-between;
        }
        
        /* Inject centralized button styles */
        ${unsafeCSS(exportImportButtonStyles)}
        
        /* Inject centralized compact layout styles */
        ${unsafeCSS(compactLayoutStyles)}
        
        /* Grid Layout */
        .layout-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(114.29px * var(--card-size-multiplier, 0.7)), 1fr)); gap: 12px; padding: 8px 0; }
        .color-grid-item { 
          display: flex; 
          flex-direction: column; 
          align-items: center; 
          gap: 6px;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          cursor: grab;
        }
        .color-grid-item.dragging {
          opacity: 0.3;
          cursor: grabbing;
        }
        .color-grid-item.grid-drag-over {
          transform: scale(0.95);
        }
        .layout-grid.dragging-active .grid-remove-btn {
          opacity: 0 !important;
          pointer-events: none;
        }
        .color-grid-swatch { position: relative; width: calc(114.29px * var(--card-size-multiplier, 0.7)); height: calc(114.29px * var(--card-size-multiplier, 0.7)); border-radius: calc(17.14px * var(--card-size-multiplier, 0.7)); box-shadow: 0 2px 8px rgba(0,0,0,0.15); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
        .color-grid-swatch:hover { transform: translateY(-4px); box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
        .grid-color-picker { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: calc(85.71px * var(--card-size-multiplier, 0.7)); height: calc(85.71px * var(--card-size-multiplier, 0.7)); opacity: 0; cursor: pointer; pointer-events: none; }
        .grid-remove-btn { 
          /* Positioning only - styles come from deleteButtonStyles */
          position: absolute; 
          top: -10px; 
          right: -10px; 
          z-index: 10; 
        }
        .grid-remove-btn.btn-pos-inside {
          top: 6px;
          right: 6px;
        }
        /* Dot on grid: same position logic, smaller button */
        .grid-remove-btn.dot-style {
          top: -4px;
          right: -4px;
        }
        .grid-remove-btn.dot-style.btn-pos-inside {
          top: 4px;
          right: 4px;
        }
        /* ---- Grid: left-side button overrides ---- */
        .grid-remove-btn.btn-side-left {
          right: auto;
          left: -10px;
        }
        .grid-remove-btn.btn-pos-inside.btn-side-left {
          right: auto;
          left: 6px;
        }
        .grid-remove-btn.dot-style.btn-side-left {
          right: auto;
          left: -4px;
        }
        .grid-remove-btn.dot-style.btn-pos-inside.btn-side-left {
          right: auto;
          left: 4px;
        }
        .color-grid-info { font-size: calc(0.85em * var(--card-size-multiplier, 0.7)); color: var(--secondary-text-color, #666); text-align: center; margin-top: 8px; }
        .grid-hex-input { 
          width: 100%; 
          margin-top: 8px; 
          padding: 4px 8px; 
          border: 1px solid var(--divider-color, #ddd); 
          border-radius: 4px; 
          font-size: calc(0.85em * var(--card-size-multiplier, 0.7)); 
          text-align: center; 
          font-family: monospace;
          box-sizing: border-box;
        }
        .grid-hex-input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
        }
        
        /* ===== COMPACT MODE - COLOR LIST SPECIFIC ONLY ===== */
        /* Base compact layout from compact-layout-utils.js - DO NOT duplicate */
        /* Only color-list-specific styles below */
        
        .compact-swatch {
          width: calc(45.71px * var(--card-size-multiplier, 0.7));
          height: calc(45.71px * var(--card-size-multiplier, 0.7));
          border-radius: calc(7.14px * var(--card-size-multiplier, 0.7));
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
        }
        .compact-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
        }
        .compact-hex-display {
          font-family: monospace;
          font-size: calc(0.9em * var(--card-size-multiplier, 0.7));
          color: var(--primary-text-color, #212529);
          font-weight: 600;
        }
        .compact-color-name {
          font-size: calc(0.75em * var(--card-size-multiplier, 0.7));
          color: var(--secondary-text-color, #6c757d);
          line-height: 1.2;
          max-width: none !important;
          text-align: left;
        }
        .compact-hex-input {
          padding: calc(4.29px * var(--card-size-multiplier, 0.7)) calc(8.57px * var(--card-size-multiplier, 0.7));
          border: 1px solid var(--divider-color, #dee2e6);
          border-radius: calc(5.71px * var(--card-size-multiplier, 0.7));
          font-family: monospace;
          font-size: calc(0.85em * var(--card-size-multiplier, 0.7));
          font-weight: 600;
          width: 70px;
        }
        .compact-hex-input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
        }
        
        /* CHIPS MODE - Tag/pill style */
        .chips-container {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 0;
          justify-content: space-between;
        }
        .chip-item {
          display: inline-flex;
          align-items: center;
          gap: calc(11.43px * var(--card-size-multiplier, 0.7));
          padding: calc(11.43px * var(--card-size-multiplier, 0.7)) calc(17.14px * var(--card-size-multiplier, 0.7));
          padding-right: calc(8px * var(--card-size-multiplier, 0.7));
          border-radius: calc(28.57px * var(--card-size-multiplier, 0.7));
          font-size: calc(0.9em * var(--card-size-multiplier, 0.7));
          font-weight: 500;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          cursor: grab;
          transition: all 0.2s;
          position: relative;
        }
        .chip-item:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        }
        .chip-item.dragging {
          opacity: 0.5;
        }
        .chip-color-swatch {
          position: relative;
          width: calc(34.29px * var(--card-size-multiplier, 0.7));
          height: calc(34.29px * var(--card-size-multiplier, 0.7));
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.5);
          cursor: pointer;
          flex-shrink: 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .chip-color-swatch:hover {
          transform: scale(1.1);
          border-color: rgba(255, 255, 255, 0.8);
        }
        .chip-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
          border-radius: 50%;
          width: 100%;
          height: 100%;
        }
        .chip-content {
          font-family: monospace;
          user-select: none;
        }
        .chip-hex-input {
          padding: 2px 6px;
          border: 1px solid transparent;
          border-radius: 4px;
          font-family: monospace;
          font-size: 0.9em;
          width: 70px;
          text-align: center;
        }
        .chip-hex-input:focus {
          outline: none;
          border-color: currentColor;
        }
        .chip-remove {
          /* Default: inside (relative, flex child) */
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative !important;
          flex-shrink: 0;
        }
        /* Outside: absolute top-right corner */
        .chip-remove.btn-pos-outside {
          position: absolute !important;
          top: -6px !important;
          right: -6px !important;
          z-index: 10;
        }
        /* Dot-style chips: size only, position from btn-pos classes */
        .chip-remove.dot-style {
          top: auto !important;
          right: auto !important;
        }
        .chip-remove.dot-style.btn-pos-outside {
          position: absolute !important;
          top: -4px !important;
          right: -4px !important;
        }
        /* Extra padding when button protrudes outside */
        .chip-item:has(.btn-pos-outside) {
          padding-top: calc(10px * var(--card-size-multiplier, 0.7));
          padding-right: calc(10px * var(--card-size-multiplier, 0.7));
        }
        /* ---- Chips: left-side button overrides ---- */
        .chip-remove.btn-side-left {
          order: -1;
        }
        .chip-remove.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -6px !important;
        }
        .chip-remove.dot-style.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -4px !important;
        }
        .chip-item:has(.btn-pos-outside.btn-side-left) {
          padding-right: 0;
          padding-left: calc(10px * var(--card-size-multiplier, 0.7));
        }
        
        /* TILES MODE - Card-like items */
        .tile-item {
          display: flex;
          align-items: center;
          gap: calc(17.14px * var(--card-size-multiplier, 0.7));
          padding: calc(17.14px * var(--card-size-multiplier, 0.7));
          border-radius: calc(17.14px * var(--card-size-multiplier, 0.7));
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          margin-bottom: calc(14.29px * var(--card-size-multiplier, 0.7));
          cursor: grab;
          transition: all 0.2s;
          position: relative;
        }
        .tile-item:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          transform: translateY(-2px);
        }
        .tile-item.dragging {
          opacity: 0.5;
        }
        .tile-drag-area {
          font-size: calc(28.57px * var(--card-size-multiplier, 0.7));
          color: var(--disabled-text-color, #adb5bd);
          cursor: grab;
          user-select: none;
          line-height: 1;
        }
        .tile-color-preview {
          width: calc(85.71px * var(--card-size-multiplier, 0.7));
          height: calc(85.71px * var(--card-size-multiplier, 0.7));
          border-radius: calc(14.29px * var(--card-size-multiplier, 0.7));
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          position: relative;
          cursor: pointer;
          flex-shrink: 0;
        }
        .tile-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
        }
        .tile-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .tile-hex-display, .tile-hex-input {
          font-family: monospace;
          font-size: 1em;
          font-weight: 600;
          color: var(--primary-text-color, #212529);
        }
        .tile-hex-input {
          padding: 4px 8px;
          border: 1px solid var(--divider-color, #dee2e6);
          border-radius: 4px;
          width: 100px;
        }
        .tile-hex-input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
        }
        .tile-color-name {
          font-size: 0.85em;
          color: var(--secondary-text-color, #6c757d);
        }
        .tile-remove {
          /* Default: inside (relative, flex child) */
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative !important;
          top: auto !important;
          right: auto !important;
          margin-left: auto;
        }
        /* Outside: absolute top-right corner */
        .tile-remove.btn-pos-outside {
          position: absolute !important;
          top: -8px !important;
          right: -8px !important;
          margin-left: 0 !important;
          z-index: 10;
        }
        /* Dot-style tiles: inside is default (relative); outside needs explicit absolute */
        .tile-remove.dot-style.btn-pos-outside {
          position: absolute !important;
          top: -4px !important;
          right: -4px !important;
          margin-left: 0 !important;
        }
        /* ---- Tiles: left-side button overrides ---- */
        .tile-remove.btn-side-left {
          order: -1;
          margin-left: 0 !important;
          margin-right: auto;
        }
        .tile-remove.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -8px !important;
          margin-right: 0 !important;
        }
        .tile-remove.dot-style.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -4px !important;
        }
        
        /* ROWS MODE - Full-width gradients */
        .row-item {
          /* padding: 14px 16px; */
          padding: 0px calc(22.86px * var(--card-size-multiplier, 0.7));
          border-radius: calc(17.14px * var(--card-size-multiplier, 0.7));
          margin-bottom: calc(11.43px * var(--card-size-multiplier, 0.7));
          cursor: grab;
          transition: all 0.3s;
          position: relative;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          min-height: calc(80px * var(--card-size-multiplier, 0.7));
          display: flex;
          align-items: center;
        }
        /* Allow button to overflow when positioned outside */
        .row-item:has(.btn-pos-outside) {
          overflow: visible;
        }
        .row-item:hover {
          transform: translateX(4px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        }
        .row-item.dragging {
          opacity: 0.5;
        }
        .row-item:active {
          cursor: grabbing;
        }
        .row-color-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          pointer-events: none;
        }
        .row-content {
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
          z-index: 1;
          flex: 1;
          min-width: 0;
        }
        .row-content > * {
          pointer-events: auto; /* Re-enable for children that need interaction */
        }
        .row-drag-indicator {
          font-size: 18px;
          opacity: 0.6;
          user-select: none;
          cursor: grab;
          line-height: 1;
          flex-shrink: 0;
        }
        .row-hex-display, .row-hex-input {
          font-family: monospace;
          font-size: 1em;
          font-weight: 600;
          min-width: 70px;
          flex-shrink: 0;
        }
        .row-hex-input {
          padding: 4px 8px;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: text;
        }
        .row-hex-input:focus {
          outline: none;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.3);
        }
        .row-color-name {
          flex: 1;
          font-size: 0.9em;
          opacity: 0.9;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* On devices with hover (desktop), disable pointer-events on row children
           to avoid interfering with HTML5 drag. Re-enable on hover.
           On touch devices (no hover), leave pointer-events enabled. */
        @media (hover: hover) {
          .row-color-input {
            pointer-events: none;
          }
          .row-content {
            pointer-events: none;
          }
          .row-content > * {
            pointer-events: auto;
          }
          .row-drag-indicator {
            pointer-events: none;
          }
          .row-hex-input:not(:focus) {
            pointer-events: none;
          }
          .row-item:hover .row-hex-input:not(:focus) {
            pointer-events: auto;
          }
          .row-color-name {
            pointer-events: none;
          }
        }

        .row-remove {
          /* Default: inside (relative, flex child at right end) */
          flex-shrink: 0;
          position: relative !important;
          top: auto !important;
          right: auto !important;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: auto;
        }
        /* Outside: absolute top-right corner */
        .row-remove.btn-pos-outside {
          position: absolute !important;
          top: -8px !important;
          right: -8px !important;
          margin-left: 0 !important;
          z-index: 10;
        }
        .row-remove.dot-style.btn-pos-outside {
          top: -4px !important;
          right: -4px !important;
        }
        /* ---- Rows: left-side button overrides ---- */
        .row-remove.btn-side-left {
          order: -1;
          margin-left: 0 !important;
          margin-right: auto;
        }
        .row-remove.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -8px !important;
          margin-right: 0 !important;
        }
        .row-remove.dot-style.btn-pos-outside.btn-side-left {
          right: auto !important;
          left: -4px !important;
        }
        
        /* Spread Arrangement - Cards spread on table */
        .cards-container { 
          display: flex;
          flex-wrap: wrap;
          gap: 30px;
          padding: 40px 20px;
          justify-content: space-evenly;
          align-items: flex-end;
          perspective: 1000px;
          max-width: 100%;
          margin: 0 auto;
        }

        /* Cascade Arrangement - overlapping waterfall */
        .cards-container.cascade-mode {
          gap: 0;
          padding: 30px 20px;
          justify-content: center;
          align-items: center;
        }
        .cards-container.cascade-mode .card-wrapper {
          margin-left: -28px;
        }
        .cards-container.cascade-mode .card-wrapper:first-child {
          margin-left: 0;
        }

        /* Tilt Arrangement - uniform rotation grid */
        .cards-container.tilt-mode {
          gap: 22px;
          padding: 30px 20px;
          justify-content: center;
          align-items: flex-start;
        }

        /* Fan Arrangement - semicircular arc */
        .cards-fan-container {
          display: flex;
          justify-content: center;
          align-items: flex-end;
          min-height: 320px;
          padding: 30px 10px 60px;
          position: relative;
          max-width: 100%;
          margin: 0 auto;
          perspective: 1200px;
        }
        .cards-fan-container .card-wrapper {
          position: absolute;
          transform-origin: 50% 320%;
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          pointer-events: none;
        }
        .cards-fan-container .card-item {
          pointer-events: auto;
          transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease, opacity 0.25s ease, filter 0.25s ease;
        }
        /* JS-managed classes: .fan-active on container, .fan-hovered on active wrapper */
        .cards-fan-container.fan-active .card-wrapper:not(.fan-hovered) {
          z-index: 0 !important;
        }
        .cards-fan-container.fan-active .card-wrapper.fan-hovered {
          z-index: 200 !important;
        }
        .cards-fan-container.fan-active .card-wrapper:not(.fan-hovered) .card-item {
          opacity: 0.35;
          filter: brightness(0.55) saturate(0.4);
        }
        .cards-fan-container.fan-active .card-wrapper.fan-hovered .card-item {
          transform: scale(1.12) !important;
          box-shadow: 0 8px 28px rgba(0,0,0,0.30);
        }

        /* Fan drag mode: keep fan shape, just enable pointer-events on wrappers */
        .cards-fan-container.dragging-active .card-wrapper {
          pointer-events: auto !important;
        }
        .cards-fan-container .card-wrapper.dragging .card-item {
          opacity: 0.75;
          outline: 2px dashed rgba(255,255,255,0.7);
          outline-offset: 3px;
          filter: brightness(1.1);
          box-shadow: 0 0 16px 4px rgba(255,255,255,0.25);
          transition: none !important;
        }
        /* Spread / Hand mode: same dashed-outline drop-preview as fan */
        .cards-container .card-wrapper.dragging .card-item,
        .cards-poker-container .card-wrapper.dragging .card-item {
          opacity: 0.75;
          outline: 2px dashed rgba(255,255,255,0.7);
          outline-offset: 3px;
          filter: brightness(1.1);
          box-shadow: 0 0 16px 4px rgba(255,255,255,0.25);
          transition: none !important;
        }
        
        /* Hand Arrangement - Poker Hand Style */
        .cards-poker-container {
          display: flex;
          flex-direction: column;
          /* gap: 40px;
          padding: 40px 20px; */
          /* align-items: center; */
          /* align-items: baseline; */
          margin: 0 auto 55px;
          max-width: 100%;
        }
        
        .poker-hand {
          display: flex;
          justify-content: center;
          align-items: flex-end;
          perspective: 1000px;
          position: relative;
          min-height: 220px;
        }
        
        .poker-card {
          position: absolute;
          transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        @keyframes cardAppear {
          from {
            opacity: 0;
            transform: scale(0.5) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        
        @keyframes cardDisappear {
          from {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          to {
            opacity: 0;
            transform: scale(0.5) translateY(20px);
          }
        }
        
        .card-wrapper {
          position: relative;
          transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
          /* flex: 0 0 120px; */
          width: calc(171.43px * var(--card-size-multiplier, 0.7));
          margin: calc(-14.29px * var(--card-size-multiplier, 0.7));
        }
        
        /* Allow cards to adapt to available space - no max-width constraint */
        .cards-container {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 15px;
          padding: 10px;
        }
        
        .card-wrapper.card-entering {
          animation: cardAppear 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        
        .card-wrapper.card-removing {
          animation: cardDisappear 0.3s ease-out forwards;
          pointer-events: none;
        }
        
        .card-item { 
          position: relative;
          width: calc(171.43px * var(--card-size-multiplier, 0.7)); 
          height: calc(257.14px * var(--card-size-multiplier, 0.7)); 
          background: var(--card-background-color, white);
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          cursor: grab; 
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, z-index 0s 0.3s, margin 0.3s ease, opacity 0.3s ease;
          /* margin: 0 -20px; */
          transform-origin: bottom center;
          flex-shrink: 0;
          overflow: visible;
        }
        /* Item card border for dark mode visibility */
        .item-card-border .card-item {
          border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
        }
        .cards-container:not(.dragging-active) .card-item:hover::before,
        .cards-poker-container:not(.dragging-active) .card-item:hover::before {
          content: '';
          position: absolute;
          top: -25px;
          left: -16px;
          right: -16px;
          bottom: -35px;
          z-index: -1;
        }
        .cards-container:not(.dragging-active) .card-item:hover,
        .cards-poker-container:not(.dragging-active) .card-item:hover { 
          transform: translateY(-30px) scale(1.08) !important;
          z-index: 100 !important;
          box-shadow: 0 12px 32px rgba(0,0,0,0.25);
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, z-index 0s 0s;
        }
        /* Fan hover: entirely JS-managed via .fan-active/.fan-hovered classes */
        .cards-fan-container:not(.dragging-active) .card-item:hover {
          z-index: 100 !important;
        }
        /* Elevate the entire poker-hand ROW so hovered card renders above later rows */
        .cards-poker-container:not(.dragging-active) .poker-hand:has(.card-item:hover) {
          z-index: 200 !important;
        }
        /* Legacy — kept as fallback if dragging class ends up on card-item */
        .card-item.dragging {
          opacity: 0;
          visibility: hidden;
          cursor: grabbing;
          z-index: 1000;
          transition: none;
        }
        .card-item.touch-dragging {
          position: fixed;
          opacity: 0.9;
          cursor: grabbing;
          transform: scale(1.15) rotate(8deg);
          z-index: 10000;
          pointer-events: none;
          transition: none;
        }
        .card-wrapper.touch-dragging-placeholder {
          opacity: 0;
        }
        .card-wrapper.touch-dragging-placeholder .card-item {
          opacity: 0;
          visibility: hidden;
        }
        .card-wrapper.drag-placeholder {
          opacity: 0.3;
        }
        .card-face {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          border-radius: inherit;
        }
        .card-color-bar {
          flex: 1;
          width: 100%;
          min-height: 0;
          position: relative;
        }
        .card-color-picker {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          width: 100%;
          height: 100%;
          border: none;
          pointer-events: none;
        }
        .card-color-bar.clickable {
          cursor: pointer;
        }
        .card-info-area {
          background: var(--card-background-color, white);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          align-items: center;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.05));
        }
        .card-swatch {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          flex-shrink: 0;
        }
        .card-picker {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          flex-shrink: 0;
        }
        .card-hex, .card-hex-display {
          width: 100%;
          background: transparent;
          padding: 4px 6px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.75em;
          text-align: center;
          border: 1px solid var(--divider-color, rgba(0,0,0,0.1));
          box-sizing: border-box;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .card-hex {
          border: 1px solid var(--divider-color, rgba(0,0,0,0.2));
        }
        .card-name {
          width: 100%;
          padding: 3px 6px;
          font-size: 0.7em;
          color: var(--secondary-text-color, #666);
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-sizing: border-box;
        }
        .card-remove {
          /* Positioning comes from inline styles via getButtonPositionStyles() */
          position: absolute;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          width: 28px;
          height: 28px;
          font-size: 1.5em;
        }
        /* Dot-style on cards: position from inline styles */
        .card-remove.dot-style {
          /* No position override — inline styles from getButtonPositionStyles() apply */
        }
        
        /* Hide remove button during drag */
        .dragging-active .card-remove,
        .card-wrapper.dragging .card-remove,
        .card-wrapper.touch-dragging-placeholder .card-remove {
          opacity: 0 !important;
          pointer-events: none;
        }
        
        /* Angle section styles */
        .angle-section {
          margin-top: 16px;
          padding-top: 16px;
        }
        .angle-section.with-separator {
          border-top: 1px solid var(--divider-color, #e6e6e6);
        }
        .angle-section.no-separator {
          border-top: none;
        }
        .angle-title {
          font-size: 1.1em;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--primary-text-color, #333);
        }
        .angle-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .angle-slider {
          flex: 1 1 auto;
          min-width: 120px;
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--divider-color, #e0e0e0);
          outline: none;
          cursor: pointer;
          margin: 8px 0;
        }
        .angle-slider::-webkit-slider-thumb {
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
        .angle-slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: var(--primary-color, #1976d2);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          border: none;
          transition: all 0.2s ease;
        }
        .angle-input {
          width: 60px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          padding: 4px 6px;
          text-align: center;
        }
        .angle-preview {
          width: 64px;
          height: 64px;
          cursor: pointer;
          user-select: none;
        }
        
        /* Wheel Style */
        .wheel-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .color-wheel {
          cursor: pointer;
          border-radius: 50%;
        }

        .wheel-selector {
          cursor: pointer;
          filter: drop-shadow(1px 1px 3px rgba(0,0,0,0.3));
          transition: r 0.1s ease;
        }

        .wheel-selector:hover {
          r: 5;
        }

        /* Prevent text selection during dragging */
        .color-wheel, .default-container, .rect-container {
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        }

        .wheel-angle {
          font-size: 14px;
          font-weight: 500;
          color: var(--primary-text-color, #333);
          background: var(--card-background-color, rgba(255,255,255,0.9));
          border-radius: 4px;
          padding: 2px 6px;
          border: 1px solid var(--divider-color, #ddd);
        }

        /* Rectangle Style */
        .rect-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .color-rect {
          cursor: pointer;
        }

        .rect-selector {
          cursor: pointer;
          transition: r 0.2s ease;
        }

        .rect-selector:hover {
          r: 5;
        }

        .rect-angle {
          font-size: 14px;
          font-weight: 500;
          color: var(--primary-text-color, #333);
          background: var(--card-background-color, rgba(255,255,255,0.9));
          border-radius: 4px;
          padding: 2px 6px;
          border: 1px solid var(--divider-color, #ddd);
        }

        /* Runtime Controls */
        .runtime-controls {
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: 8px;
          padding: 12px;
          background: var(--secondary-background-color, #f7f8fa);
        }

        /* Scroll Controls */
        .scroll-info {
          font-family: monospace;
          color: var(--secondary-text-color, #656d76);
        }
        
        .scroll-controls input[type="range"] {
          height: 4px;
          background: var(--disabled-text-color, #d0d7de);
          border-radius: 2px;
          outline: none;
        }
        
        .scroll-controls input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #0969da);
          cursor: pointer;
        }
        
        .control-button {
          padding: 4px 8px;
          border: 1px solid var(--divider-color, #d0d7de);
          background: var(--card-background-color, white);
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85em;
          transition: all 0.2s ease;
        }
        
        .control-button:hover {
          background: var(--secondary-background-color, #f6f8fa);
        }

        .mode-btn {
          padding: 6px 10px;
          border: 1px solid var(--divider-color, #d0d7de);
          background: var(--card-background-color, white);
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85em;
          transition: all 0.2s ease;
          min-width: 60px;
        }

        .mode-btn:hover {
          background: var(--secondary-background-color, #f6f8fa);
        }

        .mode-btn.active {
          background: var(--primary-color, #0969da);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color, #0969da);
        }

        /* Colorized style */
        .mode-btn-colorized {
          padding: 8px 12px;
          border: 2px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85em;
          font-weight: 600;
          transition: all 0.3s ease;
          min-width: 70px;
          position: relative;
          overflow: hidden;
        }

        .mode-btn-colorized:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          border-color: rgba(255,255,255,0.3);
        }

        .mode-btn-colorized.active {
          transform: scale(1.05);
          box-shadow: 0 6px 20px rgba(0,0,0,0.25);
          border-color: var(--card-background-color, white);
        }

        .mode-btn-colorized::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255,255,255,0.1);
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .mode-btn-colorized:hover::before {
          opacity: 1;
        }

        /* Dropdown style */
        .mode-select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--divider-color, #d0d7de);
          border-radius: 6px;
          background: var(--card-background-color, white);
          font-size: 0.9em;
          cursor: pointer;
        }

        .mode-select:focus {
          outline: none;
          border-color: var(--primary-color, #0969da);
          box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
        }

        .panel-toggle input[type="checkbox"] {
          margin: 0;
        }

        .panel-toggle label {
          margin: 0;
          cursor: pointer;
        }

        /* Rounded Cards override — applied via CSS variable */
        .compact-item,
        .chip-item,
        .tile-item,
        .row-item,
        .color-grid-swatch,
        .card-item { border-radius: var(--rounded-cards-radius) !important; }
        .card-item .card-face { border-radius: var(--rounded-cards-radius) !important; }

        /* ===== Card Surface Effects ===== */
        .surface-gloss .card-color-bar::after,
        .surface-matte .card-color-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
        }
        .surface-gloss .card-color-bar::after {
          background: linear-gradient(135deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.10) 35%, transparent 55%);
        }
        .surface-matte .card-color-bar::after {
          background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.18) 100%);
        }
        /* Plastic: soft specular highlight + subtle edge darkening like injection-molded ABS */
        .surface-plastic .card-color-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
          background:
            linear-gradient(165deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 25%, transparent 50%),
            linear-gradient(to bottom, transparent 70%, rgba(0,0,0,0.22) 100%);
        }
        .surface-plastic .card-color-bar {
          filter: saturate(1.1) contrast(1.05);
        }

        /* ===== Card Shadow Styles ===== */
        .shadow-none .card-item { box-shadow: none !important; }
        .shadow-soft .card-item { box-shadow: 0 4px 16px rgba(0,0,0,0.15) !important; }
        .shadow-strong .card-item { box-shadow: 0 8px 28px rgba(0,0,0,0.32) !important; }
        .shadow-colored .card-item { box-shadow: 0 6px 22px color-mix(in srgb, var(--card-color, #888) 55%, transparent) !important; }

        /* ===== Card Hover Effects ===== */
        /* Disable default hover when a specific hover mode is set */
        .hover-none .cards-container:not(.dragging-active) .card-item:hover,
        .hover-none .cards-poker-container:not(.dragging-active) .card-item:hover,
        .hover-none .cards-fan-container:not(.dragging-active) .card-item:hover {
          transform: none !important;
          box-shadow: inherit !important;
        }
        .hover-glow .cards-container:not(.dragging-active) .card-item:hover,
        .hover-glow .cards-poker-container:not(.dragging-active) .card-item:hover {
          transform: translateY(-12px) scale(1.04) !important;
          z-index: 100 !important;
          box-shadow: 0 0 24px 8px color-mix(in srgb, var(--card-color, #888) 60%, transparent) !important;
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, z-index 0s 0s !important;
        }
        /* Fan glow: JS-managed via .fan-hovered class */
        .hover-glow .cards-fan-container.fan-active .card-wrapper.fan-hovered .card-item {
          box-shadow: 0 0 24px 8px color-mix(in srgb, var(--card-color, #888) 60%, transparent) !important;
        }
        .hover-glow .cards-poker-container:not(.dragging-active) .poker-hand:has(.card-item:hover) {
          z-index: 200 !important;
        }
        .hover-spotlight .cards-container:not(.dragging-active) .card-item:hover,
        .hover-spotlight .cards-poker-container:not(.dragging-active) .card-item:hover {
          transform: translateY(-16px) scale(1.06) !important;
          z-index: 100 !important;
          filter: brightness(1.15);
          box-shadow: 0 18px 44px rgba(0,0,0,0.40) !important;
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, filter 0.3s ease, z-index 0s 0s !important;
        }
        /* Fan spotlight: JS-managed via .fan-hovered class */
        .hover-spotlight .cards-fan-container.fan-active .card-wrapper.fan-hovered .card-item {
          filter: brightness(1.15);
          box-shadow: 0 18px 44px rgba(0,0,0,0.40) !important;
        }
        .hover-spotlight .cards-poker-container:not(.dragging-active) .poker-hand:has(.card-item:hover) {
          z-index: 200 !important;
        }
        /* lift uses the existing default hover rules */

        /* Shared Delete Button Styles */
        ${unsafeCSS(deleteButtonStyles)}

        /* Shared Compact Mode Styles */
        ${unsafeCSS(compactModeStyles)}

  `;
