import { LitElement, html, css, unsafeCSS, repeat } from "./lib/lit-all.js";
import {
  getActionRowClass,
  exportImportButtonStyles,
  getExportImportButtonClass,
} from "./action-button-utils.js";
import { renderActionButtonContent } from "./action-button-ui.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import {
  openColorPicker,
  closeColorPicker,
  bindColorPickerTrigger,
} from "./color-picker-utils.js";
import {
  deleteButtonStyles,
  getDeleteButtonClass,
  getButtonPositionStyles,
} from "./delete-button-styles.js";
import { compactModeStyles } from "./compact-mode-styles.js";
import { compactLayoutStyles } from "./compact-layout-utils.js";
import { CardCommandController } from "./card-command-controller.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";

const nothing = Symbol.for("lit-nothing");

// Global storage for pending (optimistic) colors per entity (shared across all
// card instances).  Entries are { colors, ts }.  The cache only exists to
// bridge the short gap until the backend echoes our own set_text_colors call
// back; if it still disagrees with the backend after PENDING_COLORS_GRACE_MS
// it is dropped (see `set hass`), so it can never permanently mask changes
// made elsewhere (palette card, select entity, automations).
const PENDING_COLORS_STORE = {};
const PENDING_COLORS_GRACE_MS = 2000;

// Item selectors of the list layouts that reorder by moving their own items.
const ITEM_DRAG_SELECTORS = {
  compact: ".compact-item",
  chips: ".chip-item",
  tiles: ".tile-item",
  rows: ".row-item",
};

// Elements that open the color picker when clicked (resolved by delegation).
const PICKER_TRIGGERS =
  '.row-item[data-color-row="true"], .card-color-bar.clickable, .tile-color-preview, .chip-color-swatch, .compact-swatch, .color-grid-swatch';

const isRgb = (color) =>
  Array.isArray(color) &&
  color.length === 3 &&
  color.every((v) => typeof v === "number");

class YeelightCubeColorListEditorCard extends LitElement {
  static styles = css`
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

  constructor() {
    super();
    this.config = undefined;
    this._pendingServiceCalls = []; // Queue service calls if hass not ready
    // Interaction guards. Lit diffs the DOM, so ordinary renders no longer
    // destroy inputs; these remain only where a render would still hurt:
    // - _isDragging: drag reordering moves DOM nodes by hand, so every render
    //   is held back until the drop (see shouldUpdate).
    // - _usingColorPicker / _editingText: state-driven (hass) renders are
    //   deferred so an open picker or a focused hex input is never clobbered.
    this._isDragging = false;
    this._usingColorPicker = false;
    this._editingText = false;
    this._editing = null; // { idx, value } of the focused hex input
    this._pendingHassRender = false; // A render was held back by a guard
    this._interactionSafetyTimer = null; // Safety timer to flush held renders
    this._drag = null; // Active drag session state
    this._dragCleanup = null; // Tears down drag artefacts outside the card
    this._listKey = 0; // Bumped after a drag so Lit rebuilds the moved DOM
    this._renderedColors = [];
    this._fanHover = { wrapper: null, justCollapsed: false };
    this._pickerBoundList = null;
    // Listener objects carry their own options (Lit re-binds them only if the
    // object identity changes, so they are created once).
    this._touchStartListener = {
      handleEvent: (event) => this._onTouchStart(event),
      passive: true,
    };
    this._touchMoveListener = {
      handleEvent: (event) => this._onTouchMove(event),
      passive: false,
    };
    this._touchEndListener = {
      handleEvent: (event) => this._onTouchEnd(event, false),
      passive: true,
    };
    this._touchCancelListener = {
      handleEvent: (event) => this._onTouchEnd(event, true),
      passive: true,
    };
    this._fanTouchListener = {
      handleEvent: (event) => this._onFanTouch(event),
      passive: true,
    };
  }

  setConfig(config) {
    this._commands?.reset();
    this._pendingServiceCalls = [];
    this.config = config;

    // Auto-resolve palette_sensor if not explicitly configured
    if (!this.config.palette_sensor && this._hass) {
      const autoSensor = Object.keys(this._hass.states || {}).find(
        (e) => e.startsWith("sensor.") && e.includes("color_palettes"),
      );
      if (autoSensor) {
        this.config = { ...this.config, palette_sensor: autoSensor };
      }
    }
    this.requestUpdate();
  }

  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-color-list-editor-card-editor")) {
      await import("./yeelight-cube-color-list-editor-card-editor.js");
    }
    return document.createElement(
      "yeelight-cube-color-list-editor-card-editor",
    );
  }
  static getStubConfig(hass) {
    const firstEntity =
      Object.keys(hass?.states || {}).find(
        (e) =>
          e.startsWith("light.yeelight_cube") ||
          e.startsWith("light.cubelite_"),
      ) || "";
    return {
      type: "custom:yeelight-cube-color-list-editor-card",
      target_entities: firstEntity ? [firstEntity] : [],
      remove_button_style: "none",
      list_layout: "rows",
      color_info_display: "name",
      show_hex_input: false,
      buttons_style: "icon",
      buttons_content_mode: "icon",
    };
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;

    // Auto-resolve palette_sensor on first hass set (setConfig may run before hass is available)
    if (this.config && !this.config.palette_sensor && hass) {
      const autoSensor = Object.keys(hass.states || {}).find(
        (e) => e.startsWith("sensor.") && e.includes("color_palettes"),
      );
      if (autoSensor) {
        this.config = { ...this.config, palette_sensor: autoSensor };
      }
    }

    // If this is the first time hass is set, flush any pending service calls
    if (!oldHass && hass && this._pendingServiceCalls.length > 0) {
      this._pendingServiceCalls.forEach((call) => {
        this._commitColors(call.entityId, call.entry, call.config);
      });
      this._pendingServiceCalls = [];
    }

    // PENDING-CACHE EXPIRY: if the optimistic cache is older than the
    // expected service-echo window, drop it.  Without this, one failed or
    // mismatched echo left the cache stale forever and the card ignored all
    // external color changes (e.g. selecting a palette on another card).
    let staleCacheCleared = false;
    if (this.config) {
      const entityId = this._getPrimaryEntity();
      const entry = entityId ? PENDING_COLORS_STORE[entityId] : null;
      if (entry && Date.now() - entry.ts > PENDING_COLORS_GRACE_MS) {
        const backendColors =
          hass.states?.[entityId]?.attributes?.text_colors || null;
        delete PENDING_COLORS_STORE[entityId];
        if (
          backendColors &&
          JSON.stringify(backendColors) !== JSON.stringify(entry.colors)
        ) {
          // Displayed colors were masking newer backend state — must render
          staleCacheCleared = true;
        }
      }
    }

    // Only render if our entity's state actually changed
    if (!staleCacheCleared && oldHass && this.config) {
      const entityId = this._getPrimaryEntity();
      if (entityId) {
        const oldState = oldHass.states[entityId];
        const newState = hass.states[entityId];

        // Skip render if state hasn't changed. HA only replaces the state
        // object of the entity that changed, so the common case (another
        // entity changed) is a cheap reference hit; deep-compare only when
        // our entity's state object was actually replaced.
        if (
          oldState &&
          newState &&
          (oldState === newState ||
            (oldState.state === newState.state &&
              JSON.stringify(oldState.attributes) ===
                JSON.stringify(newState.attributes)))
        ) {
          return;
        }
      }
    }

    if (this._interacting) {
      // Interaction in progress — remember that a state-driven render was held
      this._pendingHassRender = true;
      this._startInteractionSafety();
    } else {
      this._pendingHassRender = false;
      this.requestUpdate();
    }
  }

  get _interacting() {
    return this._isDragging || this._usingColorPicker || this._editingText;
  }

  shouldUpdate() {
    // A drag moves rendered nodes by hand; rendering now would fight it.
    if (!this._isDragging) return true;
    this._pendingHassRender = true;
    this._startInteractionSafety();
    return false;
  }

  // Flush any render that was held back while an interaction was active.
  // Called when an interaction flag is cleared to recover missed state updates.
  _flushPendingRender() {
    if (!this._pendingHassRender || this._interacting) return;
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
    this.requestUpdate();
  }

  // Safety timer: periodically check if all interaction flags have cleared
  // and flush the pending render. Covers edge cases where flag-clearing code
  // paths don't explicitly call _flushPendingRender().
  _startInteractionSafety() {
    if (this._interactionSafetyTimer) return; // Already running
    this._interactionSafetyTimer = setInterval(() => {
      if (!this._interacting) {
        clearInterval(this._interactionSafetyTimer);
        this._interactionSafetyTimer = null;
        this._flushPendingRender();
      }
    }, 1000);
  }

  // Resolve the primary entity: first VALID entity from target_entities,
  // fallback to legacy entity.  Skips entity IDs that no longer exist in
  // hass.states (stale config entries after entity renames / IP changes).
  _getPrimaryEntity() {
    const candidates = [
      ...(this.config?.target_entities || []),
      this.config?.entity,
    ].filter(Boolean);
    if (!this._hass?.states) return candidates[0] || null;
    for (const eid of candidates) {
      if (this._hass.states[eid]) return eid;
    }
    return candidates[0] || null; // return first even if stale (so error is shown)
  }

  // Every service call of this card goes through one ordered queue
  // (card-command-controller): results from a previous configuration are
  // dropped. Created on first use.
  _cardCommands() {
    return (this._commands ||= new CardCommandController());
  }

  // One call for all target lamps (the backend runs them in parallel).
  // Rejects on failure (HA has already shown it).
  callServiceOnTargetEntities(service, serviceData = {}) {
    return this._cardCommands().request(
      this._hass,
      this.config,
      service,
      serviceData,
    );
  }

  render() {
    // For multi-entity support: use the first *valid* entity as source of truth.
    // _getPrimaryEntity() skips stale entity IDs that no longer exist.
    const entityId = this.config ? this._getPrimaryEntity() : null;
    const hass = this._hass;
    if (!hass || !entityId) return nothing;
    const stateObj = hass.states[entityId];
    if (!stateObj) {
      return html`<ha-card
        ><div style="padding:16px;color:var(--error-color,#db4437)">
          Entity not found: ${entityId}<br /><small
            style="color:var(--secondary-text-color)"
            >Check the card configuration — the selected entity may have been
            removed or renamed.</small
          >
        </div></ha-card
      >`;
    }

    // Get colors from sensor
    const sensorColors = stateObj.attributes.text_colors || [[255, 255, 255]];

    // Clear pending colors if sensor has caught up
    const pendingEntry = PENDING_COLORS_STORE[entityId];
    if (
      pendingEntry &&
      JSON.stringify(pendingEntry.colors) === JSON.stringify(sensorColors)
    ) {
      delete PENDING_COLORS_STORE[entityId];
    }

    // Use pending colors for instant feedback, fall back to sensor
    const textColors = PENDING_COLORS_STORE[entityId]?.colors || sensorColors;
    this._renderedColors = textColors;

    const config = this.config;
    const showCard = config.show_card_background !== false;
    const showSavePalette = config.show_save_palette !== false;
    const showAddColorButton = config.show_add_color_button !== false;
    const showRandomizeButton = config.show_randomize_button !== false;
    const showColorSection = config.show_color_section !== false;
    const cardTitle = typeof config.title === "string" ? config.title : "";

    // Remove button styling configuration
    const removeButtonStyle = config.remove_button_style || "default";
    // Universal button shape & position configuration
    const buttonInside = config.delete_button_inside === true;
    const buttonLeft = config.delete_button_left === true;
    const options = {
      allowDelete: removeButtonStyle !== "none",
      enableColorPicker: config.enable_color_picker !== false,
      showHexInput: config.show_hex_input !== false,
      allowDragDrop: config.allow_drag_drop !== false,
      deleteBtnClass: getDeleteButtonClass(
        removeButtonStyle,
        config.delete_button_shape || "round",
      ),
      posClass: buttonInside ? "btn-pos-inside" : "btn-pos-outside",
      sideClass: buttonLeft ? "btn-side-left" : "",
      buttonPositionStyles: getButtonPositionStyles(buttonInside, buttonLeft),
    };

    const content = html`
      <div
        class="yc-stack"
        style="padding:16px; box-sizing: border-box; max-width: 100%;"
      >
        ${!showCard && cardTitle
          ? html`<div style="font-weight:600;font-size:1.1em;">
              ${cardTitle}
            </div>`
          : ""}
        ${showColorSection
          ? html`
              ${repeat(
                [this._listKey],
                (key) => key,
                () => this._renderColorList(textColors, options),
              )}
              ${this._renderActionRow(
                showAddColorButton,
                showRandomizeButton,
                showSavePalette,
              )}
            `
          : ""}
      </div>
    `;
    const radius = `--rounded-cards-radius: ${this._getCardBorderRadius()}px;`;
    return showCard
      ? html`<ha-card header=${cardTitle || nothing}
          ><div class="card-content" style=${radius}>${content}</div></ha-card
        >`
      : html`<div class="card-content" style=${radius}>${content}</div>`;
  }

  updated() {
    // Color-picker triggers are resolved by delegation from the list
    // container. bindColorPickerTrigger replaces its own listeners, and the
    // container is only rebound when Lit created a new one.
    const list = this.renderRoot.querySelector("#color-list");
    if (list && list !== this._pickerBoundList) {
      this._pickerBoundList = list;
      bindColorPickerTrigger(list, (event) => this._onPickerTrigger(event));
    }
  }

  _renderColorList(textColors, options) {
    const config = this.config;
    return html`
      <div
        id="color-list"
        class="layout-${config.list_layout ||
        "list"} item-card-border surface-${config.card_surface_effect ||
        "none"} shadow-${config.card_shadow_style ||
        "soft"} hover-${config.card_hover_effect || "lift"}"
        style="--card-size-multiplier: ${(config.card_size || 70) / 100};"
        @click=${this._onListClick}
        @mousedown=${this._onListMouseDown}
        @mouseup=${this._onListMouseUp}
        @dragstart=${this._onDragStart}
        @dragover=${this._onDragOver}
        @dragend=${this._onDragEnd}
        @drop=${this._onDrop}
        @touchstart=${this._touchStartListener}
        @touchmove=${this._touchMoveListener}
        @touchend=${this._touchEndListener}
        @touchcancel=${this._touchCancelListener}
      >
        ${this._renderItems(textColors, options)}
      </div>
    `;
  }

  _renderActionRow(showAdd, showRandomize, showSave) {
    const config = this.config;
    const contentMode =
      config.buttons_style === "icon"
        ? "icon"
        : config.buttons_content_mode || "icon_text";
    return html`<div
      class=${getActionRowClass({
        buttonStyle: config.buttons_style,
        contentMode: config.buttons_content_mode,
      })}
      ?hidden=${!(showAdd || showRandomize || showSave)}
    >
      ${showAdd
        ? html`<button
            id="add-color"
            title="Add Color"
            class=${this._getButtonClasses("add")}
            @click=${this._onAddColor}
          >
            ${renderActionButtonContent("mdi:plus", "Add Color", contentMode)}
          </button>`
        : ""}
      ${showRandomize
        ? html`<button
            id="randomize-order"
            title="Shuffle Order"
            class=${this._getButtonClasses("randomize")}
            @click=${this._onShuffle}
          >
            ${renderActionButtonContent(
              "mdi:shuffle-variant",
              "Shuffle Order",
              contentMode,
            )}
          </button>`
        : ""}
      ${showSave
        ? html`<button
            id="save-palette"
            title="Save as Palette"
            class=${this._getButtonClasses("save")}
            @click=${this._onSavePalette}
          >
            ${renderActionButtonContent(
              "mdi:content-save",
              "Save as Palette",
              contentMode,
            )}
          </button>`
        : ""}
    </div>`;
  }

  _renderItems(textColors, options) {
    const layoutMode = this.config.list_layout || "compact";

    switch (layoutMode) {
      case "chips":
        return this._renderChipsLayout(textColors, options);
      case "tiles":
        return this._renderTilesLayout(textColors, options);
      case "rows":
        return this._renderRowsLayout(textColors, options);
      case "grid":
        return this._renderGridLayout(textColors, options);
      case "cards":
        return this._renderCardsLayout(textColors, options);
      case "compact":
      default:
        return this._renderCompactLayout(textColors, options);
    }
  }

  _hexInput(idx, hex, className, style) {
    // While an input is focused, bind what the user typed so a render (e.g.
    // saving another color) never overwrites a half-typed value.
    const value = this._editing?.idx === idx ? this._editing.value : hex;
    return html`<input
      type="text"
      class=${className}
      .value=${value}
      data-idx=${idx}
      maxlength="7"
      style=${style ?? nothing}
      @focus=${this._onHexFocus}
      @blur=${this._onHexBlur}
      @keydown=${this._onHexKeydown}
      @input=${this._onHexInput}
    />`;
  }

  _removeButton(idx, className, options, style) {
    return html`<button
      data-action="remove"
      data-idx=${idx}
      class="${options.deleteBtnClass} ${className}"
      style=${style ?? nothing}
      title="Remove"
    ></button>`;
  }

  _colorInput(idx, hex, className) {
    return html`<input
      type="color"
      .value=${hex}
      data-idx=${idx}
      class=${className}
    />`;
  }

  // COMPACT MODE - Minimal inline design with hover actions
  _renderCompactLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "hex";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      return html`<div
        class="compact-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
      >
        <div
          class="compact-swatch"
          style="background: ${rgbToCss(color)};"
          title="Click to change color"
        >
          ${options.enableColorPicker
            ? this._colorInput(idx, hex, "compact-color-input")
            : ""}
        </div>
        <div class="compact-info">
          ${options.showHexInput
            ? this._hexInput(idx, hex, "compact-hex-input hex-input")
            : ""}
          <span class="compact-color-name"
            >${this.formatColorInfo(color, display)}</span
          >
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              `compact-remove ${posClass} ${sideClass}`,
              options,
            )
          : ""}
      </div>`;
    });
  }

  // CHIPS MODE - Colorful tag/pill style
  _renderChipsLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "hex";
    return html`<div class="chips-container">
      ${textColors.map((color, idx) => {
        if (!(Array.isArray(color) && color.length === 3)) return "";
        const hex = this.rgbToHex(color);
        const contrast = this.getContrastTextColor(color);
        const shade = contrast === "#ffffff" ? "255,255,255" : "0,0,0";
        return html`<div
          class="chip-item"
          data-idx=${idx}
          draggable=${options.allowDragDrop ? "true" : nothing}
          style="background: ${rgbToCss(color)}; color: ${contrast};"
        >
          ${options.enableColorPicker
            ? html`<div
                class="chip-color-swatch"
                title="Click to change color"
              >
                ${this._colorInput(idx, hex, "chip-color-input")}
              </div>`
            : ""}
          ${options.showHexInput
            ? this._hexInput(
                idx,
                hex,
                "chip-hex-input hex-input",
                `color: ${contrast}; background: rgba(${shade}, 0.2);`,
              )
            : ""}
          <span class="chip-content" title="Drag to reorder">
            ${this.formatColorInfo(color, display)}
          </span>
          ${options.allowDelete
            ? this._removeButton(
                idx,
                `chip-remove ${posClass} ${sideClass}`,
                options,
              )
            : ""}
        </div>`;
      })}
    </div>`;
  }

  // TILES MODE - Card-like items in vertical list
  _renderTilesLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "name";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      return html`<div
        class="tile-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
      >
        ${options.allowDragDrop
          ? html`<div class="tile-drag-area" title="Drag to reorder">⋮⋮</div>`
          : ""}
        <div class="tile-color-preview" style="background: ${rgbToCss(color)};">
          ${options.enableColorPicker
            ? this._colorInput(idx, hex, "tile-color-input")
            : ""}
        </div>
        <div class="tile-info">
          ${options.showHexInput
            ? this._hexInput(idx, hex, "tile-hex-input hex-input")
            : ""}
          <span class="tile-color-name"
            >${this.formatColorInfo(color, display)}</span
          >
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              `tile-remove ${posClass} ${sideClass}`,
              options,
            )
          : ""}
      </div>`;
    });
  }

  // ROWS MODE - Full-width colored rows with gradient effects
  _renderRowsLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "name";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      const contrast = this.getContrastTextColor(color);
      const shade = contrast === "#ffffff" ? "255,255,255" : "0,0,0";
      return html`<div
        class="row-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
        style="background: linear-gradient(135deg, ${rgbToCss(
          color,
        )} 0%, ${this.adjustColorBrightness(
          color,
          -20,
        )} 100%); color: ${contrast};"
        data-color-row="true"
      >
        ${options.enableColorPicker
          ? this._colorInput(idx, hex, "row-color-input")
          : ""}
        <div class="row-content">
          ${options.allowDragDrop
            ? html`<span class="row-drag-indicator" title="Drag to reorder"
                >⋮⋮</span
              >`
            : ""}
          ${options.showHexInput
            ? this._hexInput(
                idx,
                hex,
                "row-hex-input hex-input",
                `background: rgba(${shade}, 0.2); color: ${contrast}; border-color: rgba(${shade}, 0.3);`,
              )
            : ""}
          <span class="row-color-name"
            >${this.formatColorInfo(color, display)}</span
          >
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              `row-remove ${posClass} ${sideClass}`,
              options,
            )
          : ""}
      </div>`;
    });
  }

  _renderGridLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "hex";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      const info = this.formatColorInfo(color, display);
      return html`<div
        class="color-grid-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
      >
        <div
          class="color-grid-swatch"
          style="background-color: ${rgbToCss(color)};"
          title=${info}
        >
          ${options.enableColorPicker
            ? this._colorInput(idx, hex, "grid-color-picker")
            : ""}
          ${options.allowDelete
            ? this._removeButton(
                idx,
                `grid-remove-btn ${posClass} ${sideClass}`,
                options,
              )
            : ""}
        </div>
        ${options.showHexInput
          ? this._hexInput(idx, hex, "hex-input grid-hex-input")
          : ""}
        <div class="color-grid-info">${info}</div>
      </div>`;
    });
  }

  // CARDS MODE - playing cards in one of five arrangements
  _renderCardsLayout(textColors, options) {
    const arrangement = this.config.card_arrangement || "hand";
    const valid = (color) => Array.isArray(color) && color.length === 3;
    const card = (color, idx, layout) =>
      valid(color) ? this._renderCard(color, idx, options, layout) : "";

    switch (arrangement) {
      case "spread":
        return html`<div class="cards-container">
          ${textColors.map((color, idx) => {
            // Pseudo-random rotation / offset per position for a spread look
            const seed1 = (idx * 2654435761) % 2147483647;
            const seed2 = (idx * 1103515245 + 12345) % 2147483647;
            const rotationDeg = (seed1 % 25) - 12;
            const verticalOffset = (seed2 % 12) - 6;
            return card(color, idx, {
              transform: `rotate(${rotationDeg}deg) translateY(${verticalOffset}px)`,
              zIndex: idx,
            });
          })}
        </div>`;
      case "cascade":
        // Cascade: overlapping diagonal waterfall with a gentle vertical step
        // per card (reset every 8 cards) and a uniform slight rotation.
        return html`<div class="cards-container cascade-mode">
          ${textColors.map((color, idx) =>
            card(color, idx, {
              transform: `rotate(-3deg) translateY(${(idx % 8) * 4}px)`,
              zIndex: idx,
            }),
          )}
        </div>`;
      case "tilt":
        // Tilt: clean grid with all cards rotated at the same uniform angle.
        return html`<div class="cards-container tilt-mode">
          ${textColors.map((color, idx) =>
            card(color, idx, { transform: "rotate(-5deg)", zIndex: idx }),
          )}
        </div>`;
      case "fan": {
        // Fan: semicircular arc from a single origin point below the cards.
        const totalCards = textColors.filter(valid).length;
        // Spread angle range: up to ±50° for many cards, narrower for fewer
        const maxSpread = Math.min(50, totalCards * 6);
        const centerIndex = (totalCards - 1) / 2;
        return html`<div
          class="cards-fan-container"
          @mousemove=${this._onFanMouseMove}
          @mouseenter=${this._onFanMouseEnter}
          @mouseleave=${this._onFanMouseLeave}
          @touchstart=${this._fanTouchListener}
          @touchmove=${this._fanTouchListener}
          @touchend=${this._fanTouchListener}
          @touchcancel=${this._fanTouchListener}
        >
          ${textColors.map((color, idx) => {
            const rotation = (
              totalCards > 1 ? ((idx - centerIndex) / centerIndex) * maxSpread : 0
            ).toFixed(1);
            return card(color, idx, {
              transform: `rotate(${rotation}deg)`,
              zIndex: idx,
              baseRotation: rotation,
            });
          })}
        </div>`;
      }
      default: {
        // Hand: poker-hand rows. Cards per row follow the card size:
        // at 70% (default) 120px cards fit 4 per row in ~600px.
        const cardSizePercent = this.config.card_size || 70;
        const baseCardWidth = 171.43 * (cardSizePercent / 100);
        const cardsPerRow = Math.max(
          3,
          Math.min(10, Math.floor(600 / (baseCardWidth + 30))),
        );
        const rows = [];
        for (let i = 0; i < textColors.length; i += cardsPerRow) {
          rows.push(i);
        }
        return html`<div class="cards-poker-container">
          ${rows.map((rowStartIdx) => {
            const rowColors = textColors.slice(
              rowStartIdx,
              rowStartIdx + cardsPerRow,
            );
            const centerIndex = (rowColors.length - 1) / 2;
            return html`<div class="poker-hand">
              ${rowColors.map((color, idx) => {
                const offset = idx - centerIndex;
                return card(color, rowStartIdx + idx, {
                  wrapperClass: "card-wrapper poker-card",
                  transform: `rotate(${offset * 8}deg) translateY(${
                    Math.abs(offset) * 10
                  }px) translateX(${offset * -15}px)`,
                  zIndex: idx,
                });
              })}
            </div>`;
          })}
        </div>`;
      }
    }
  }

  _renderCard(color, idx, options, layout) {
    const hex = this.rgbToHex(color);
    const cssColor = rgbToCss(color);
    return html`<div
      class=${layout.wrapperClass || "card-wrapper"}
      data-position=${idx}
      data-base-rotation=${layout.baseRotation ?? nothing}
    >
      <div
        class="card-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
        style="--card-color: ${cssColor}; transform: ${layout.transform}; z-index: ${layout.zIndex};"
      >
        <div class="card-face">
          <div
            class="card-color-bar${options.enableColorPicker
              ? " clickable"
              : ""}"
            style="background: ${cssColor};"
          >
            ${options.enableColorPicker
              ? this._colorInput(idx, hex, "card-color-picker")
              : ""}
          </div>
          <div class="card-info-area">
            ${options.showHexInput
              ? this._hexInput(idx, hex, "hex-input card-hex")
              : ""}
            <div class="card-name">
              ${this.formatColorInfo(
                color,
                this.config.color_info_display || "hex",
              )}
            </div>
          </div>
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              "card-remove",
              options,
              options.buttonPositionStyles,
            )
          : ""}
      </div>
    </div>`;
  }

  // ----- Action buttons -------------------------------------------------

  _onAddColor() {
    const currentColors = this._getCurrentColors();
    currentColors.push([255, 255, 255]);
    this.saveColors(currentColors);
  }

  _onShuffle() {
    // Fisher-Yates shuffle
    const shuffled = this._getCurrentColors();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.saveColors(shuffled);
  }

  async _onSavePalette() {
    if (!this._hass) return;
    const currentColors = this._getCurrentColors();
    const primaryEntity = this._getPrimaryEntity();
    if (!primaryEntity) {
      console.error(
        "[ColorList Card] No primary entity available for save_palette",
      );
      return;
    }
    const commands = this._cardCommands();
    try {
      if (
        !(await commands.call(this._hass, "yeelight_cube", "save_palette", {
          palette: currentColors,
          entity_id: primaryEntity,
        }))
      )
        return;
    } catch (err) {
      console.error("Error saving palette:", err);
      return;
    }
    // Force sensor update to get fresh data immediately
    if (this.config?.palette_sensor) {
      try {
        await commands.call(this._hass, "homeassistant", "update_entity", {
          entity_id: this.config.palette_sensor,
        });
      } catch (err) {
        console.error("Error refreshing palette sensor:", err);
      }
    }
    window.dispatchEvent(
      new CustomEvent("palette-saved", {
        detail: { palette: currentColors },
      }),
    );
  }

  // ----- Hex inputs -----------------------------------------------------

  _onHexFocus(event) {
    this._editingText = true;
    this._editing = {
      idx: parseInt(event.target.dataset.idx),
      value: event.target.value,
    };
  }

  _onHexBlur(event) {
    this._editingText = false;
    this._editing = null;
    // An unfinished value reverts to the actual color. Lit only rewrites
    // .value when the bound value changes, so reset the live value here.
    const color = this._getCurrentColors()[parseInt(event.target.dataset.idx)];
    if (Array.isArray(color)) event.target.value = this.rgbToHex(color);
    this._flushPendingRender();
    this.requestUpdate();
  }

  _onHexKeydown(event) {
    if (event.key === "Enter" || event.key === "Escape") {
      event.target.blur(); // Clears _editingText via the blur handler
    }
  }

  _onHexInput(event) {
    const idx = parseInt(event.target.dataset.idx);
    const hex = event.target.value;
    this._editing = { idx, value: hex };
    const rgb = /^#[0-9a-f]{6}$/i.test(hex) ? this.hexToRgb(hex) : null;
    if (!rgb) {
      this.requestUpdate();
      return;
    }
    const currentColors = this._getCurrentColors();
    currentColors[idx] = rgb;
    this.saveColors(currentColors);
  }

  // ----- Color list clicks (remove buttons, color picker) ---------------

  _onListClick(event) {
    const button = event.target.closest("button[data-action=remove]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const idx = parseInt(button.dataset.idx);
    const currentColors = this._getCurrentColors();
    if (isNaN(idx) || idx < 0 || idx >= currentColors.length) {
      console.error(
        `[REMOVE COLOR] Invalid remove index: ${idx}, valid range: 0-${
          currentColors.length - 1
        }`,
      );
      this.requestUpdate();
      return;
    }
    if (currentColors.length > 1) {
      this.saveColors(currentColors.filter((_, i) => i !== idx));
    }
  }

  _onPickerTrigger(event) {
    if (this.config.enable_color_picker === false) return;
    const target = event.target;
    // Buttons, inputs and drag handles keep their own behaviour
    if (target.closest("button, input, .drag-handle")) return;
    const trigger = target.closest(PICKER_TRIGGERS);
    const idx = parseInt(trigger?.closest("[data-idx]")?.dataset.idx);
    const color = this._renderedColors[idx];
    if (!Array.isArray(color)) return;
    event.preventDefault();
    event.stopPropagation();
    this._openColorPickerAt(
      idx,
      this.rgbToHex(color),
      event.pageX,
      event.pageY,
    );
  }

  _getCardBorderRadius() {
    const v = this.config.rounded_cards;
    if (v === undefined || v === true || v === "round") return 16;
    if (v === false || v === "square") return 0;
    if (v === "rounded") return 4;
    return typeof v === "number" ? v : parseInt(v, 10) || 16;
  }

  _getCurrentColors() {
    // For multi-entity support: use first valid entity as the source of truth
    const entityId = this._getPrimaryEntity();

    if (!entityId) {
      return [[255, 255, 255]]; // Default fallback
    }
    const hass = this._hass;

    // Get the current colors from global pending state or entity state
    const pendingColors = PENDING_COLORS_STORE[entityId]?.colors;
    if (pendingColors) {
      return pendingColors.slice(); // Return a copy
    }

    if (!hass || !entityId) {
      return [[255, 255, 255]]; // Default fallback
    }

    const stateObj = hass.states[entityId];
    if (!stateObj || !stateObj.attributes) {
      return [[255, 255, 255]]; // Default fallback
    }

    const sensorColors = stateObj.attributes.text_colors || [[255, 255, 255]];
    return sensorColors.slice(); // Return a copy
  }

  _openColorPickerAt(idx, currentValue, clickX, clickY) {
    this._cleanupColorPicker(true);
    this._usingColorPicker = true;
    openColorPicker(this, {
      value: currentValue,
      pageX: clickX,
      pageY: clickY,
      onInput: (hex) => {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return;
        const currentColors = this._getCurrentColors();
        if (idx >= currentColors.length) return;
        currentColors[idx] = rgb;
        // Our own edits render immediately; hass renders stay deferred.
        this.saveColors(currentColors);
      },
      onClose: () => {
        if (!this._usingColorPicker) return;
        this._usingColorPicker = false;
        this._flushPendingRender();
      },
    });
  }

  _cleanupColorPicker(skipFlush) {
    this._usingColorPicker = false;
    closeColorPicker(this);
    if (!skipFlush) {
      this._flushPendingRender();
    }
  }

  saveColors(textColors) {
    // For multi-entity support: use first valid entity as the source of truth
    const entityId = this._getPrimaryEntity();

    if (!entityId) {
      return;
    }

    // Store pending colors in global store (shared across all card instances).
    // Timestamped so `set hass` can expire the entry if the backend echo
    // never matches (see PENDING_COLORS_GRACE_MS).
    const entry = {
      colors: structuredClone(textColors),
      ts: Date.now(),
    };
    PENDING_COLORS_STORE[entityId] = entry;
    this.requestUpdate();

    // If hass not ready yet, queue the service call for later
    if (!this._hass) {
      this._pendingServiceCalls.push({
        entityId,
        entry,
        config: structuredClone(this.config),
      });
      return;
    }

    // Use multi-entity service call - updates ALL target entities with the same colors
    return this._commitColors(entityId, entry, this.config);
  }

  async _commitColors(entityId, entry, config) {
    const commands = this._cardCommands();
    const context = commands.context;
    const success = await commands.execute(
      this._hass,
      config,
      "set_text_colors",
      {
        text_colors: entry.colors,
      },
    );
    if (context !== commands.context || success) return success;
    if (PENDING_COLORS_STORE[entityId] !== entry) return false;
    delete PENDING_COLORS_STORE[entityId];
    this.requestUpdate?.();
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        bubbles: true,
        composed: true,
        detail: {
          message: commands.error || "The colors could not be saved.",
        },
      }),
    );
    return false;
  }

  // ----- Drag and drop reordering -------------------------------------
  //
  // All drag events are delegated from the Lit-rendered #color-list
  // container. While a drag is active the nodes are moved by hand for live
  // feedback and renders are held back (shouldUpdate); on drop the new order
  // is saved and _listKey is bumped so Lit discards the hand-moved DOM and
  // renders the list afresh.

  _dragKind() {
    if (this.config?.allow_drag_drop === false) return null;
    const layout = this.config.list_layout || "compact";
    if (ITEM_DRAG_SELECTORS[layout]) return "items";
    if (layout === "grid" || layout === "cards") return layout;
    return null;
  }

  _dragItemSelector(kind) {
    if (kind === "grid") return ".color-grid-item";
    if (kind === "cards") return ".card-wrapper";
    return ITEM_DRAG_SELECTORS[this.config.list_layout || "compact"];
  }

  _dragItemFrom(target, kind) {
    if (kind === "cards") {
      return target.closest?.(".card-item")?.closest(".card-wrapper") || null;
    }
    return target.closest?.(this._dragItemSelector(kind)) || null;
  }

  _dragContainer(kind) {
    const root = this.renderRoot;
    if (kind === "grid") return root.querySelector(".layout-grid");
    if (kind !== "cards") return null;
    return (this.config.card_arrangement || "hand") === "hand"
      ? root.querySelector(".cards-poker-container")
      : root.querySelector(".cards-container") ||
          root.querySelector(".cards-fan-container");
  }

  _hexInputFocused() {
    return !!this.renderRoot?.activeElement?.classList?.contains("hex-input");
  }

  _beginDrag(kind, item, touch) {
    this._drag = {
      kind,
      item,
      touch,
      active: !touch,
      container: this._dragContainer(kind),
      colors: this._renderedColors,
      lastUpdate: 0,
      startX: 0,
      startY: 0,
    };
    if (!touch) this._isDragging = true;
    return this._drag;
  }

  _onDragStart(event) {
    const kind = this._dragKind();
    const item = kind && this._dragItemFrom(event.target, kind);
    if (!item) return;
    // Don't start dragging while a hex input is focused (text selection)
    if (this._hexInputFocused()) {
      event.preventDefault();
      return;
    }
    const drag = this._beginDrag(kind, item, false);
    item.classList.add("dragging");
    drag.container?.classList.add("dragging-active");
    event.dataTransfer.effectAllowed = "move";

    if (kind === "cards") {
      const card = item.querySelector(".card-item");
      event.dataTransfer.setData("text/html", card.innerHTML);
      // Create a colored drag ghost so the user sees the color being carried
      const dragColor = card.style.getPropertyValue("--card-color") || "#888";
      const dragImg = document.createElement("div");
      dragImg.style.cssText = `width:50px;height:70px;background:${dragColor};border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);position:absolute;top:-9999px;left:-9999px;`;
      document.body.appendChild(dragImg);
      event.dataTransfer.setDragImage(dragImg, 25, 35);
      // Clean up drag image element after browser captures it
      setTimeout(() => dragImg.remove(), 100);
      // CRITICAL: Defer fan collapse to AFTER browser captures the drag image.
      // Collapsing synchronously changes transforms, which makes the element
      // jump away from the cursor and the browser aborts the drag.
      if (this.config.card_arrangement === "fan") {
        setTimeout(() => this._collapseFanForDrag(drag.container), 0);
      }
      return;
    }
    if (kind === "grid") {
      event.dataTransfer.setData("text/html", item.innerHTML);
    }
    // Force layout calculation before drag operations begin
    // This prevents position offset issues on the first drag
    void item.offsetHeight;
  }

  _onDragOver(event) {
    const kind = this._dragKind();
    if (!kind) return;
    const drag = this._drag;
    if (kind === "items") {
      const item = this._dragItemFrom(event.target, kind);
      if (!item) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (drag?.item && item !== drag.item) this._moveItemTo(drag, item);
      return;
    }
    // Grid and cards accept drops anywhere in their container
    const container = drag?.container || this._dragContainer(kind);
    if (!container?.contains(event.target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!drag || drag.touch) return;
    // Throttle updates to max 60fps (every ~16ms)
    const now = Date.now();
    if (now - drag.lastUpdate <= 16) return;
    drag.lastUpdate = now;
    if (kind === "grid") this._updateGridPositions(event.clientX, event.clientY);
    else this._updateCardPositions(event.clientX, event.clientY);
  }

  _onDrop(event) {
    const drag = this._drag;
    if (!drag || drag.touch || drag.kind === "items") return;
    if (!drag.container?.contains(event.target)) return;
    event.stopPropagation();
    this._finishDrag(true);
  }

  _onDragEnd() {
    if (this._drag && !this._drag.touch) this._finishDrag(true);
  }

  _onTouchStart(event) {
    const kind = this._dragKind();
    if (!kind || this._hexInputFocused()) return;
    const target = event.target;
    if (
      (kind === "items" &&
        target.closest(
          ".chip-remove, .compact-remove, .tile-remove, .row-remove",
        )) ||
      (kind === "grid" &&
        target.closest(".grid-remove-btn, .grid-color-picker"))
    ) {
      return;
    }
    const item = this._dragItemFrom(target, kind);
    if (!item) return;
    const touch = event.touches[0];
    const drag = this._beginDrag(kind, item, true);
    drag.startX = touch.clientX;
    drag.startY = touch.clientY;
  }

  _onTouchMove(event) {
    const drag = this._drag;
    if (!drag?.touch) return;
    const touch = event.touches[0];
    const { kind, item } = drag;
    const threshold = kind === "cards" ? 5 : 8;
    if (
      !drag.active &&
      (Math.abs(touch.clientX - drag.startX) > threshold ||
        Math.abs(touch.clientY - drag.startY) > threshold)
    ) {
      drag.active = true;
      this._isDragging = true;
      this._startTouchGhost(drag, touch);
    }
    if (!drag.active) return;
    event.preventDefault(); // Prevent scrolling

    // Move the ghost that follows the finger
    const ghost = drag.ghost;
    if (ghost) {
      const rect = (drag.ghostSource || item).getBoundingClientRect();
      ghost.style.left = touch.clientX - rect.width / 2 + "px";
      ghost.style.top =
        touch.clientY - (kind === "items" ? 20 : rect.height / 2) + "px";
    }

    if (kind === "items") {
      // Find the item under the finger (inside our shadow root) and reorder
      const below = this.renderRoot.elementFromPoint(
        touch.clientX,
        touch.clientY,
      );
      const target = below && this._dragItemFrom(below, kind);
      if (target && target !== item && target.parentNode === item.parentNode) {
        this._moveItemTo(drag, target);
      }
    } else if (kind === "grid") {
      const now = Date.now();
      if (now - drag.lastUpdate > 16) {
        drag.lastUpdate = now;
        this._updateGridPositions(touch.clientX, touch.clientY);
      }
    } else {
      this._updateCardPositions(touch.clientX, touch.clientY);
    }
  }

  _onTouchEnd(event, cancelled) {
    const drag = this._drag;
    if (!drag?.touch) return;
    if (!drag.active) {
      // Was a tap, not a drag
      this._drag = null;
      return;
    }
    // A cancelled card drag still commits the order the user dragged to.
    this._finishDrag(!cancelled || drag.kind === "cards");
  }

  _startTouchGhost(drag, touch) {
    const { kind, item } = drag;
    let ghost;
    if (kind === "cards") {
      // Add placeholder styling to original card
      item.classList.add("touch-dragging-placeholder");
      drag.container?.classList.add("dragging-active");
      const card = item.querySelector(".card-item");
      // Measure BEFORE collapsing the fan so the ghost starts where the
      // card currently is
      const rect = card.getBoundingClientRect();
      if (this.config.card_arrangement === "fan") {
        setTimeout(() => this._collapseFanForDrag(drag.container), 0);
      }
      ghost = card.cloneNode(true);
      ghost.classList.add("touch-dragging");
      ghost.style.width = rect.width + "px";
      ghost.style.height = rect.height + "px";
      ghost.style.left = touch.clientX - rect.width / 2 + "px";
      ghost.style.top = touch.clientY - rect.height / 2 + "px";
      drag.ghostSource = card;
    } else {
      item.classList.add("dragging");
      drag.container?.classList.add("dragging-active");
      const rect = item.getBoundingClientRect();
      ghost = item.cloneNode(true);
      ghost.style.cssText = `
        position: fixed; z-index: 99999; pointer-events: none;
        width: ${rect.width}px;${kind === "grid" ? ` height: ${rect.height}px;` : ""}
        opacity: 0.85; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        transform: scale(1.03); transition: none;
        left: ${touch.clientX - rect.width / 2}px;
        top: ${touch.clientY - (kind === "grid" ? rect.height / 2 : 20)}px;
      `;
    }
    drag.ghost = ghost;
    document.body.appendChild(ghost);
    // Anything placed outside the card is torn down with the drag session,
    // including when the card is disconnected mid-drag.
    this._dragCleanup = () => ghost.remove();
  }

  _endDragSession() {
    const cleanup = this._dragCleanup;
    this._dragCleanup = null;
    cleanup?.();
  }

  // End the active drag. With `save`, the order now shown in the DOM is
  // saved; either way the hand-moved DOM is discarded and re-rendered.
  _finishDrag(save) {
    const drag = this._drag;
    this._drag = null;
    this._endDragSession();
    this._isDragging = false;
    if (!drag) {
      this._flushPendingRender();
      return;
    }
    let newColors = null;
    if (save && drag.active) {
      const order = [
        ...this.renderRoot.querySelectorAll(this._dragItemSelector(drag.kind)),
      ].map((el) =>
        parseInt(drag.kind === "cards" ? el.dataset.position : el.dataset.idx),
      );
      const reordered = order.map((idx) => drag.colors[idx]).filter(isRgb);
      const orderChanged = order.some((pos, idx) => pos !== idx);
      if (orderChanged && reordered.length === drag.colors.length) {
        newColors = reordered;
      }
    }
    this._listKey++;
    this._fanHover = { wrapper: null, justCollapsed: false };
    this._pendingHassRender = false;
    if (newColors) this.saveColors(newColors);
    else this.requestUpdate();
  }

  // Items layouts: place the dragged item before/after the hovered item.
  _moveItemTo(drag, target) {
    const dragged = drag.item;
    const items = [
      ...this.renderRoot.querySelectorAll(this._dragItemSelector(drag.kind)),
    ];
    const draggedIdx = items.indexOf(dragged);
    const targetIdx = items.indexOf(target);
    if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) {
      return;
    }
    if (draggedIdx < targetIdx) {
      // Moving forward - should be after target
      if (dragged.previousElementSibling !== target) {
        const next = target.nextElementSibling;
        if (next) target.parentNode.insertBefore(dragged, next);
        else target.parentNode.appendChild(dragged);
      }
    } else if (dragged.nextElementSibling !== target) {
      // Moving backward - should be before target
      target.parentNode.insertBefore(dragged, target);
    }
  }

  _onListMouseDown(event) {
    if (this._dragKind() !== "grid") return;
    const item = event.target.closest?.(".color-grid-item");
    if (!item) return;
    // Prevent dragging when pressing the remove button
    if (event.target.closest(".grid-remove-btn")) {
      event.stopPropagation();
      item.setAttribute("draggable", "false");
    } else if (event.target.closest(".color-grid-info")) {
      // Allow dragging from the color info text
      item.setAttribute("draggable", "true");
    }
  }

  _onListMouseUp(event) {
    if (this._dragKind() !== "grid") return;
    if (!event.target.closest?.(".grid-remove-btn")) return;
    const item = event.target.closest(".color-grid-item");
    setTimeout(() => item?.setAttribute("draggable", "true"), 100);
  }

  _updateGridPositions(clientX, clientY) {
    const drag = this._drag;
    if (!drag?.item) return;
    const draggedItem = drag.item;
    const gridContainer = drag.container;

    const items = Array.from(
      this.renderRoot.querySelectorAll(".color-grid-item"),
    );
    const draggedItemIndex = items.indexOf(draggedItem);

    // Find the item closest to cursor with expanded hitbox
    let closestItem = null;
    let closestDistance = Infinity;
    let insertIndex = -1;

    items.forEach((item, index) => {
      if (item === draggedItem) return;
      const rect = item.getBoundingClientRect();
      // Expand hitbox by 20px on all sides
      const isInExpandedHitbox =
        clientX >= rect.left - 20 &&
        clientX <= rect.right + 20 &&
        clientY >= rect.top - 20 &&
        clientY <= rect.bottom + 20;
      if (isInExpandedHitbox) {
        // Use distance for priority when in multiple hitboxes
        const distance = Math.hypot(
          clientX - (rect.left + rect.width / 2),
          clientY - (rect.top + rect.height / 2),
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = item;
          insertIndex = index;
        }
      }
    });

    if (!closestItem || insertIndex === -1) return;
    // Determine if we should insert before or after
    const rect = closestItem.getBoundingClientRect();
    if (clientX > rect.left + rect.width / 2) insertIndex++;
    if (draggedItemIndex < insertIndex) insertIndex--;

    // Reorder in DOM
    if (insertIndex !== draggedItemIndex && gridContainer) {
      const targetItem = items[insertIndex];
      if (targetItem && targetItem !== draggedItem) {
        if (insertIndex > draggedItemIndex) {
          const nextSibling = targetItem.nextSibling;
          if (nextSibling) gridContainer.insertBefore(draggedItem, nextSibling);
          else gridContainer.appendChild(draggedItem);
        } else {
          gridContainer.insertBefore(draggedItem, targetItem);
        }
      }
    }

    items.forEach((item) => item.classList.remove("grid-drag-over"));
    closestItem.classList.add("grid-drag-over");
  }

  // Cards: find the insertion position closest to the pointer and reorder
  // the card wrappers in the DOM.
  _updateCardPositions(clientX, clientY) {
    const drag = this._drag;
    if (!drag?.item) return;
    const root = this.renderRoot;
    const draggedCard = drag.item;
    const cardsContainer = drag.container;
    const cardArrangement = this.config.card_arrangement || "hand";

    const wrappers = Array.from(root.querySelectorAll(".card-wrapper"));
    const draggedCardIndex = wrappers.indexOf(draggedCard);

    // Fan mode: wrappers are all position:absolute at the same spot,
    // so use card-item rects (which differ due to rotation) for distance.
    const measure = (wrapper) =>
      cardArrangement === "fan"
        ? wrapper.querySelector(".card-item") || wrapper
        : wrapper;

    // Find the wrapper closest to the cursor position
    let closestWrapper = null;
    let closestDistance = Infinity;
    let insertIndex = -1;
    wrappers.forEach((wrapper, index) => {
      if (wrapper === draggedCard) return;
      const rect = measure(wrapper).getBoundingClientRect();
      const distance = Math.hypot(
        clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2),
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestWrapper = wrapper;
        insertIndex = index;
      }
    });
    if (!closestWrapper || insertIndex === -1) return;

    // If cursor is to the right of the card's center, insert after
    const rect = measure(closestWrapper).getBoundingClientRect();
    if (clientX > rect.left + rect.width / 2) insertIndex++;
    // Adjust insert index if dragging from left to right
    if (draggedCardIndex < insertIndex) insertIndex--;
    // Only reorder if position changed
    if (insertIndex === draggedCardIndex) return;

    if (cardArrangement === "hand") {
      // Hand mode: rebuild the poker-hand rows in the new order
      const newOrder = [...wrappers];
      newOrder.splice(draggedCardIndex, 1);
      newOrder.splice(insertIndex, 0, draggedCard);
      const pokerContainer = root.querySelector(".cards-poker-container");
      if (!pokerContainer) return;
      pokerContainer.replaceChildren();
      const cardsPerRow = 4;
      for (let i = 0; i < newOrder.length; i += cardsPerRow) {
        const rowWrapper = document.createElement("div");
        rowWrapper.className = "poker-hand";
        const rowSize = Math.min(cardsPerRow, newOrder.length - i);
        for (let j = 0; j < rowSize; j++) {
          const card = newOrder[i + j];
          // Recalculate poker hand positioning
          const offset = j - (rowSize - 1) / 2;
          const cardItem = card.querySelector(".card-item");
          if (cardItem) {
            cardItem.style.transform = `rotate(${offset * 8}deg) translateY(${
              Math.abs(offset) * 10
            }px) translateX(${offset * -15}px)`;
            cardItem.style.zIndex = j;
          }
          rowWrapper.appendChild(card);
        }
        pokerContainer.appendChild(rowWrapper);
      }
      return;
    }

    // Non-hand arrangements - physically move the dragged card wrapper
    if (!cardsContainer || insertIndex < 0 || insertIndex >= wrappers.length) {
      return;
    }
    const targetPosition = wrappers[insertIndex];
    if (!targetPosition || targetPosition === draggedCard) return;
    if (insertIndex > draggedCardIndex) {
      // Moving right - insert after target
      const nextSibling = targetPosition.nextSibling;
      if (nextSibling) cardsContainer.insertBefore(draggedCard, nextSibling);
      else cardsContainer.appendChild(draggedCard);
    } else {
      // Moving left - insert before target
      cardsContainer.insertBefore(draggedCard, targetPosition);
    }
    // Fan mode: recalculate rotations so cards animate to their new arc slots
    this._recalcFanRotations(cardsContainer);
  }

  // Fan mode: restore the normal fan arc for the current DOM order.
  _recalcFanRotations(container) {
    if (this.config.card_arrangement !== "fan" || !container) return;
    const wrappers = Array.from(container.querySelectorAll(".card-wrapper"));
    const totalCards = wrappers.length;
    if (totalCards <= 1) return;
    const maxSpread = Math.min(50, totalCards * 6);
    const centerIndex = (totalCards - 1) / 2;
    wrappers.forEach((wrapper, i) => {
      const rotationDeg =
        centerIndex > 0 ? ((i - centerIndex) / centerIndex) * maxSpread : 0;
      const cardItem = wrapper.querySelector(".card-item");
      if (cardItem) {
        cardItem.style.transform = `rotate(${rotationDeg.toFixed(1)}deg)`;
        cardItem.style.zIndex = i;
      }
      wrapper.style.transform = "none";
      wrapper.classList.remove("fan-hovered");
    });
  }

  // Fan mode: drop the hover spread when a drag starts. Cleans all fan
  // classes/transforms directly (avoids a race with mouseleave).
  _collapseFanForDrag(container) {
    if (!container) return;
    this._collapseFan(container);
    container.classList.remove("fan-active");
    container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
      wrapper.classList.remove("fan-hovered");
      wrapper.style.transition = "none";
      wrapper.style.transform = "none";
    });
    // Restore transitions next frame
    requestAnimationFrame(() => {
      container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
        wrapper.style.transition = "";
      });
    });
  }

  // ----- Fan hover ----------------------------------------------------
  //
  // Fan arrangement: spread neighbour cards on hover, collapse when the
  // pointer leaves the fan area entirely. The fan shape itself comes from the
  // card-item transforms; spreading only adds a push offset on the wrapper
  // (rotated around transform-origin 50% 320%).

  _spreadFan(container, hoveredWrapper) {
    if (hoveredWrapper === this._fanHover.wrapper) return;
    this._fanHover.wrapper = hoveredWrapper;
    const wrappers = Array.from(container.querySelectorAll(".card-wrapper"));
    const hoveredIdx = wrappers.indexOf(hoveredWrapper);
    if (hoveredIdx === -1) return;
    // Cumulative push: the gap next to the hovered card is the largest, each
    // further step adds a decaying amount.
    const firstGap = 18; // degrees for the immediate neighbour gap
    const pushPerStep = 8; // additional degrees per subsequent step
    const decay = 0.6; // each subsequent step pushes slightly less
    container.classList.add("fan-active");
    wrappers.forEach((wrapper, i) => {
      wrapper.style.transition = "";
      if (i === hoveredIdx) {
        wrapper.classList.add("fan-hovered");
        wrapper.style.transform = "none";
        return;
      }
      wrapper.classList.remove("fan-hovered");
      const dist = Math.abs(i - hoveredIdx);
      let totalPush = firstGap;
      for (let k = 1; k < dist; k++) {
        totalPush += pushPerStep * Math.pow(decay, k - 1);
      }
      wrapper.style.transform = `rotate(${(i > hoveredIdx ? 1 : -1) * totalPush}deg)`;
    });
  }

  _collapseFan(container) {
    if (!this._fanHover.wrapper) return;
    this._fanHover.wrapper = null;
    this._fanHover.justCollapsed = true;
    container.classList.remove("fan-active");
    container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
      wrapper.classList.remove("fan-hovered");
      wrapper.style.transition = "none";
      wrapper.style.transform = "none";
    });
    requestAnimationFrame(() => {
      container.querySelectorAll(".card-wrapper").forEach((wrapper) => {
        wrapper.style.transition = "";
      });
    });
  }

  _fanWrapperFromPoint(container, clientX, clientY) {
    const el = container.getRootNode().elementFromPoint(clientX, clientY);
    const wrapper = el?.closest?.(".card-item")?.closest(".card-wrapper");
    return wrapper && container.contains(wrapper) ? wrapper : null;
  }

  _onFanMouseMove(event) {
    const container = event.currentTarget;
    if (this._fanHover.justCollapsed) return;
    if (container.classList.contains("dragging-active")) return;
    const wrapper = this._fanWrapperFromPoint(
      container,
      event.clientX,
      event.clientY,
    );
    if (wrapper) this._spreadFan(container, wrapper);
  }

  _onFanMouseEnter() {
    this._fanHover.justCollapsed = false;
  }

  _onFanMouseLeave(event) {
    this._collapseFan(event.currentTarget);
  }

  _onFanTouch(event) {
    const container = event.currentTarget;
    if (event.type === "touchend" || event.type === "touchcancel") {
      this._collapseFan(container);
      return;
    }
    if (container.classList.contains("dragging-active")) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (event.type === "touchstart") this._fanHover.justCollapsed = false;
    const wrapper = this._fanWrapperFromPoint(
      container,
      touch.clientX,
      touch.clientY,
    );
    if (wrapper) this._spreadFan(container, wrapper);
  }

  // ----- Color helpers -----------------------------------------------

  rgbToHex(rgb) {
    return (
      "#" +
      rgb
        .map((v) => {
          const hex = v.toString(16).padStart(2, "0");
          return hex;
        })
        .join("")
    );
  }

  hexToRgb(hex) {
    if (!hex.startsWith("#") || hex.length !== 7) return null;
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  getClosestCssColorName(rgb) {
    const cssColors = {
      aliceblue: [240, 248, 255],
      antiquewhite: [250, 235, 215],
      aqua: [0, 255, 255],
      aquamarine: [127, 255, 212],
      azure: [240, 255, 255],
      beige: [245, 245, 220],
      bisque: [255, 228, 196],
      black: [0, 0, 0],
      blanchedalmond: [255, 235, 205],
      blue: [0, 0, 255],
      blueviolet: [138, 43, 226],
      brown: [165, 42, 42],
      burlywood: [222, 184, 135],
      cadetblue: [95, 158, 160],
      chartreuse: [127, 255, 0],
      chocolate: [210, 105, 30],
      coral: [255, 127, 80],
      cornflowerblue: [100, 149, 237],
      cornsilk: [255, 248, 220],
      crimson: [220, 20, 60],
      cyan: [0, 255, 255],
      darkblue: [0, 0, 139],
      darkcyan: [0, 139, 139],
      darkgoldenrod: [184, 134, 11],
      darkgray: [169, 169, 169],
      darkgreen: [0, 100, 0],
      darkkhaki: [189, 183, 107],
      darkmagenta: [139, 0, 139],
      darkolivegreen: [85, 107, 47],
      darkorange: [255, 140, 0],
      darkorchid: [153, 50, 204],
      darkred: [139, 0, 0],
      darksalmon: [233, 150, 122],
      darkseagreen: [143, 188, 143],
      darkslateblue: [72, 61, 139],
      darkslategray: [47, 79, 79],
      darkturquoise: [0, 206, 209],
      darkviolet: [148, 0, 211],
      deeppink: [255, 20, 147],
      deepskyblue: [0, 191, 255],
      dimgray: [105, 105, 105],
      dodgerblue: [30, 144, 255],
      firebrick: [178, 34, 34],
      floralwhite: [255, 250, 240],
      forestgreen: [34, 139, 34],
      fuchsia: [255, 0, 255],
      gainsboro: [220, 220, 220],
      ghostwhite: [248, 248, 255],
      gold: [255, 215, 0],
      goldenrod: [218, 165, 32],
      gray: [128, 128, 128],
      green: [0, 128, 0],
      greenyellow: [173, 255, 47],
      honeydew: [240, 255, 240],
      hotpink: [255, 105, 180],
      indianred: [205, 92, 92],
      indigo: [75, 0, 130],
      ivory: [255, 255, 240],
      khaki: [240, 230, 140],
      lavender: [230, 230, 250],
      lavenderblush: [255, 240, 245],
      lawngreen: [124, 252, 0],
      lemonchiffon: [255, 250, 205],
      lightblue: [173, 216, 230],
      lightcoral: [240, 128, 128],
      lightcyan: [224, 255, 255],
      lightgoldenrodyellow: [250, 250, 210],
      lightgray: [211, 211, 211],
      lightgreen: [144, 238, 144],
      lightpink: [255, 182, 193],
      lightsalmon: [255, 160, 122],
      lightseagreen: [32, 178, 170],
      lightskyblue: [135, 206, 250],
      lightslategray: [119, 136, 153],
      lightsteelblue: [176, 196, 222],
      lightyellow: [255, 255, 224],
      lime: [0, 255, 0],
      limegreen: [50, 205, 50],
      linen: [250, 240, 230],
      magenta: [255, 0, 255],
      maroon: [128, 0, 0],
      mediumaquamarine: [102, 205, 170],
      mediumblue: [0, 0, 205],
      mediumorchid: [186, 85, 211],
      mediumpurple: [147, 112, 219],
      mediumseagreen: [60, 179, 113],
      mediumslateblue: [123, 104, 238],
      mediumspringgreen: [0, 250, 154],
      mediumturquoise: [72, 209, 204],
      mediumvioletred: [199, 21, 133],
      midnightblue: [25, 25, 112],
      mintcream: [245, 255, 250],
      mistyrose: [255, 228, 225],
      moccasin: [255, 228, 181],
      navajowhite: [255, 222, 173],
      navy: [0, 0, 128],
      oldlace: [253, 245, 230],
      olive: [128, 128, 0],
      olivedrab: [107, 142, 35],
      orange: [255, 165, 0],
      orangered: [255, 69, 0],
      orchid: [218, 112, 214],
      palegoldenrod: [238, 232, 170],
      palegreen: [152, 251, 152],
      paleturquoise: [175, 238, 238],
      palevioletred: [219, 112, 147],
      papayawhip: [255, 239, 213],
      peachpuff: [255, 218, 185],
      peru: [205, 133, 63],
      pink: [255, 192, 203],
      plum: [221, 160, 221],
      powderblue: [176, 224, 230],
      purple: [128, 0, 128],
      red: [255, 0, 0],
      rosybrown: [188, 143, 143],
      royalblue: [65, 105, 225],
      saddlebrown: [139, 69, 19],
      salmon: [250, 128, 114],
      sandybrown: [244, 164, 96],
      seagreen: [46, 139, 87],
      seashell: [255, 245, 238],
      sienna: [160, 82, 45],
      silver: [192, 192, 192],
      skyblue: [135, 206, 235],
      slateblue: [106, 90, 205],
      slategray: [112, 128, 144],
      snow: [255, 250, 250],
      springgreen: [0, 255, 127],
      steelblue: [70, 130, 180],
      tan: [210, 180, 140],
      teal: [0, 128, 128],
      thistle: [216, 191, 216],
      tomato: [255, 99, 71],
      turquoise: [64, 224, 208],
      violet: [238, 130, 238],
      wheat: [245, 222, 179],
      white: [255, 255, 255],
      whitesmoke: [245, 245, 245],
      yellow: [255, 255, 0],
      yellowgreen: [154, 205, 50],
    };

    let closestColor = "unknown";
    let minDistance = Infinity;

    for (const [name, colorRgb] of Object.entries(cssColors)) {
      const distance = Math.sqrt(
        Math.pow(rgb[0] - colorRgb[0], 2) +
          Math.pow(rgb[1] - colorRgb[1], 2) +
          Math.pow(rgb[2] - colorRgb[2], 2),
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestColor = name;
      }
    }

    return closestColor;
  }

  formatColorInfo(color, displayMode) {
    if (!displayMode || displayMode === "hidden" || displayMode === "none") {
      return "";
    }

    switch (displayMode) {
      case "hex":
        return this.rgbToHex(color);
      case "name":
      case "css": // Keep css for backward compatibility
        return this.getClosestCssColorName(color);
      default:
        return this.rgbToHex(color); // Default to hex
    }
  }

  _getButtonClasses(type) {
    const style = this.config.buttons_style || "modern";
    // Use centralized utility for add/save/randomize buttons
    if (type === "add" || type === "save" || type === "randomize") {
      return getExportImportButtonClass(type, style);
    }
    // Handle remove button locally (not in centralized utility)
    return `remove-btn btn-style-${style}`;
  }

  // Calculate relative luminance based on WCAG guidelines
  getRelativeLuminance(rgb) {
    const [r, g, b] = rgb.map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Determine if we should use light or dark text based on background color
  getContrastTextColor(backgroundColor) {
    const luminance = this.getRelativeLuminance(backgroundColor);
    // WCAG threshold - use dark text on light backgrounds, light text on dark backgrounds
    return luminance > 0.179 ? "#000000" : "#ffffff";
  }

  // Adjust color brightness for gradients
  adjustColorBrightness(rgb, amount) {
    return rgbToCss(rgb.map((channel) => channel + amount));
  }

  getCardSize() {
    return 4;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._commands?.reset();
    this._pendingServiceCalls = [];

    // Tear down anything a drag placed outside the card (touch ghost) if
    // disconnected mid-drag; the drag's DOM is rebuilt on the next render.
    this._endDragSession();
    if (this._drag) this._listKey++;
    this._drag = null;

    this._cleanupColorPicker(true);

    // Reset interaction flags
    this._isDragging = false;
    this._usingColorPicker = false;
    this._editingText = false;
    this._editing = null;
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
  }
}

defineOnce("yeelight-cube-color-list-editor-card", YeelightCubeColorListEditorCard);

registerCustomCard({
  type: "yeelight-cube-color-list-editor-card",
  name: "Yeelight Colors Card",
  description: "Edit the list of text colors for the Yeelight Cube Lite.",
  preview: true,
});
