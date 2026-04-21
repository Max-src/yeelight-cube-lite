// Removed duplicate string export. Swatch shape styles merged below.
// CSS styles for Yeelight Cube Lite Draw Card
import { css, unsafeCSS } from "./lib/lit-all.js";
import { compactModeStyles } from "./compact-mode-styles.js";
import { compactLayoutStyles } from "./compact-layout-utils.js";
import {
  deleteButtonStyles,
  deleteButtonPositionStyles,
} from "./delete-button-styles.js";
import { exportImportButtonStyles } from "./export-import-button-utils.js";
import { carouselStyles } from "./carousel-utils.js";

export const drawCardStyles = css`
  /* Allow outside delete buttons to overflow ha-card */
  :host {
    overflow: visible !important;
  }
  ha-card {
    overflow: visible !important;
  }

  /* Shared Compact Mode Styles */
  ${unsafeCSS(compactModeStyles)}

  /* Shared Compact Layout Styles */
  ${unsafeCSS(compactLayoutStyles)}

  /* Shared Delete Button Styles */
  ${unsafeCSS(deleteButtonStyles)}

  /* Shared Delete Button Position Styles */
  ${unsafeCSS(deleteButtonPositionStyles)}

  /* Shared Export/Import Button Styles */
  ${unsafeCSS(exportImportButtonStyles)}

  /* Shared Carousel Styles */
  ${unsafeCSS(carouselStyles)}

  .palette-fold {
    position: relative;
    width: 100%;
    min-height: 64px;
    height: 64px;
    overflow: visible;
  }
  .palette-group-card.fold {
    position: relative;
    min-height: 48px;
    height: 48px;
    overflow: visible;
    background: none;
    box-shadow: none;
  }
  .palette-group-card.fold .palette-group-title {
    cursor: pointer;
    z-index: 2;
    background: var(--card-background-color, #fff);
    border-radius: 12px;
    padding: 6px 18px;
    box-shadow: 0 2px 8px #0001;
    position: relative;
    display: inline-block;
  }
  .palette-group-card.fold .palette-fold-content {
    position: absolute;
    left: 0;
    top: 48px;
    width: 100%;
    z-index: 10;
    background: var(--card-background-color, #fff);
    box-shadow: 0 4px 24px #0002;
    border-radius: 12px;
    padding: 12px 0 12px 0;
    min-height: 48px;
    max-height: 120px;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex;
    align-items: center;
  }
  .palette-group-card.fold .palette-fold-content::-webkit-scrollbar {
    height: 8px;
    background: var(--secondary-background-color, #eee);
    border-radius: 8px;
  }
  .palette-group-card.fold .palette-fold-content::-webkit-scrollbar-thumb {
    background: var(--divider-color, #ccc);
    border-radius: 8px;
  }
  .color-swatch.round {
    border-radius: 50%;
    width: 28px;
    height: 28px;
    margin: 0 4px;
    box-shadow: 0 1px 4px #0002;
    border: 2px solid var(--card-background-color, #fff);
    cursor: pointer;
    transition:
      box-shadow 0.2s,
      border 0.2s;
    display: inline-block;
  }
  .color-swatch.rounded {
    border-radius: 6px;
    width: 28px;
    height: 28px;
    margin: 0 4px;
    box-shadow: 0 1px 4px #0002;
    border: 2px solid var(--card-background-color, #fff);
    cursor: pointer;
    transition:
      box-shadow 0.2s,
      border 0.2s;
    display: inline-block;
  }
  .color-swatch.square {
    border-radius: 0 !important;
    width: 28px;
    height: 28px;
    margin: 0 4px;
    box-shadow: 0 1px 4px #0002;
    border: 2px solid var(--card-background-color, #fff);
    cursor: pointer;
    transition:
      box-shadow 0.2s,
      border 0.2s;
    display: inline-block;
  }
  /* Palette card container modes */
  .palette-tabs {
    width: 100%;
  }
  .palette-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    width: 100%;
    margin-bottom: 8px;
  }
  /* Palette card container modes */
  .palette-tabs {
    width: 100%;
  }
  .palette-group-card.floating.hide {
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%) scale(0.95);
  }
  /* Preview-hover mode */
  .palette-preview-hover {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    width: 100%;
    gap: 8px;
    overflow: hidden;
    transition: gap 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .palette-preview-card {
    flex: 0 0 auto;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    border-radius: 10px;
    padding: 0;
    cursor: pointer;
    position: relative;
    /* max-height managed by JS to match scaled visual content */
    transition:
      flex 0.4s cubic-bezier(0.4, 0, 0.2, 1),
      max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      padding 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  /* Collapsed: share space equally */
  .palette-preview-hover:not(.expanded-mode) .palette-preview-card {
    flex: 1 1 0;
  }
  .palette-preview-card:not(.expanded):hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #0077cc) 5%,
      var(--card-background-color, #fff)
    );
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }
  .palette-preview-card.empty {
    cursor: default;
  }
  /* When expanded mode is on, non-expanded cards shrink to zero */
  .palette-preview-hover.expanded-mode .palette-preview-card:not(.expanded) {
    flex: 0 0 0px;
    max-height: 0;
    opacity: 0;
    padding: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .palette-preview-hover.expanded-mode {
    gap: 0;
  }
  .palette-preview-hover:not(.expanded-mode) .palette-preview-card.empty {
    opacity: 1;
  }
  /* Expanded card takes full width */
  .palette-preview-card.expanded {
    flex: 1 0 100%;
    max-height: 2000px;
    z-index: 10;
    overflow: hidden;
    padding: 0;
  }
  /* Body wraps palette content — fixed pixel width from JS (--container-w) ensures
     content always renders at full container width. Only transform transitions,
     so visual_width = container-w × scale — perfectly linear, no overshoot. */
  .palette-preview-body {
    pointer-events: none;
    width: var(--container-w, 300px);
    transform: scale(calc(1 / var(--n-cards, 3)));
    transform-origin: top left;
    box-sizing: border-box;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .palette-preview-card.expanded .palette-preview-body {
    pointer-events: auto;
    width: 100%;
    transform: scale(1);
  }
  /* Empty preview card placeholder */
  .palette-mini-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px 8px;
    gap: 4px;
    min-height: 48px;
    border: 2px dashed var(--divider-color, #ddd);
    border-radius: 10px;
    background: color-mix(
      in srgb,
      var(--primary-text-color, #333) 3%,
      transparent
    );
  }
  .mini-empty-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color, #333);
    opacity: 0.6;
    white-space: nowrap;
  }
  .mini-empty-hint {
    font-size: 11px;
    color: var(--secondary-text-color, #888);
    opacity: 0.45;
  }

  /* Paint button shape variants */
  .paint-btn-rect {
    border-radius: 8px;
    min-width: 48px;
    min-height: 40px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    padding: 0 12px;
  }
  .paint-btn-circle {
    border-radius: 50%;
    min-width: 44px !important;
    max-width: 44px !important;
    min-height: 44px;
    width: 44px;
    height: 44px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .paint-btn-square {
    border-radius: 0;
    min-width: 48px;
    min-height: 48px;
    width: 48px;
    height: 48px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  input.color-picker-btn[type="color"] {
    border: none;
    cursor: pointer;
    vertical-align: middle;
    appearance: none;
    -webkit-appearance: none;
    outline: none;
    background: transparent !important;
    /* Let shape classes control size, border-radius, shadow, etc. */
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
  }
  input.color-picker-btn.paint-btn-rect[type="color"] {
    border-radius: 8px !important;
    width: 48px !important;
    height: 48px !important;
    min-height: 48px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
    padding: 0 !important;
    display: block !important;
    align-items: stretch !important;
    justify-content: stretch !important;
  }
  input.color-picker-btn.paint-btn-circle[type="color"] {
    border-radius: 50% !important;
    min-width: 44px !important;
    max-width: 44px !important;
    min-height: 44px !important;
    width: 44px !important;
    height: 44px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
    padding: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
  }
  input.color-picker-btn.paint-btn-square[type="color"] {
    border-radius: 0 !important;
    min-width: 48px !important;
    min-height: 48px !important;
    width: 48px !important;
    height: 48px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
    padding: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
  }
  input.color-picker-btn[type="color"]::-webkit-color-swatch-wrapper {
    padding: 0;
    border-radius: inherit;
  }
  input.color-picker-btn[type="color"]::-webkit-color-swatch {
    border-radius: inherit;
    border: none;
    box-shadow: none !important;
  }
  input.color-picker-btn[type="color"]::-moz-color-swatch {
    border-radius: inherit;
    border: none;
    box-shadow: none !important;
  }
  input.color-picker-btn[type="color"] {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
  }
  .draw-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin: 0 auto;
  }
  .matrix {
    display: grid;
    grid-template-columns: repeat(20, 1fr);
    grid-template-rows: repeat(5, 1fr);
    gap: 4px;
    background: #111;
    border-radius: 8px;
    padding: 8px;
    user-select: none;
    touch-action: none;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }
  .pixel {
    width: 100%;
    aspect-ratio: 1/1;
    background: #222;
    border: none;
    transition:
      background 0.1s,
      border-radius 0.2s;
    cursor: pointer;
    box-sizing: border-box;
    display: block;
  }
  .pixel.round {
    border-radius: 50%;
  }
  .pixel.rounded {
    border-radius: 20%;
  }
  .pixel.square {
    border-radius: 0;
  }
  .pixel.active {
    /* No border for active, just keep the color */
  }
  .color-picker {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .color-swatch {
    width: 24px;
    height: 24px;
    border: 2px solid #fff8;
    cursor: pointer;
    margin: 2px;
    box-shadow: 0 1px 4px #0004;
    transition: border 0.1s;
  }
  .draw-btn {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 15%,
      var(--card-background-color, #fff)
    );
    color: var(--primary-color, #0077cc);
    border: none;
    border-radius: 8px;
    padding: 10px 0;
    cursor: pointer;
    font-size: 1em;
    font-weight: 500;
    min-width: 120px;
    transition: background 0.2s;
    box-shadow: 0 1px 4px #0003;
    text-align: center;
  }
  .draw-btn:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 30%,
      var(--card-background-color, #fff)
    );
  }
  .draw-btn.clear {
    background: color-mix(
      in srgb,
      var(--error-color, #db4437) 15%,
      var(--card-background-color, #fff)
    );
    color: var(--error-color, #db4437);
  }
  .draw-btn.clear:hover {
    background: color-mix(
      in srgb,
      var(--error-color, #db4437) 25%,
      var(--card-background-color, #fff)
    );
  }
  .draw-btn.save {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 15%,
      var(--card-background-color, #fff)
    );
    color: var(--primary-color, #0077cc);
    box-shadow: none;
  }
  .draw-btn.save:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 30%,
      var(--card-background-color, #fff)
    );
  }
  .draw-btn:disabled,
  .draw-btn.disabled {
    background: var(--disabled-text-color, #bdbdbd) !important;
    color: var(--text-primary-color, #fff) !important;
    cursor: not-allowed !important;
    opacity: 0.6;
  }
  .draw-btn:disabled:hover,
  .draw-btn.disabled:hover {
    background: var(--disabled-text-color, #bdbdbd) !important;
  }

  /* Draw button active state for pagination */
  .draw-btn.active {
    background: var(--primary-color, #0077cc) !important;
    color: var(--text-primary-color, #fff) !important;
  }

  /* Pagination button sizing adjustments */
  .pagination-container .draw-btn {
    min-width: 40px;
    padding: 8px 12px;
    font-size: 0.9em;
  }

  .pagination-container .draw-btn.save {
    min-width: 40px;
    padding: 8px;
  }

  .pagination-container .draw-btn ha-icon {
    width: 18px;
    height: 18px;
  }

  /* Button shape styles for paint buttons (legacy) */
  .paint-btn-circle {
    border-radius: 50% !important;
    min-width: 44px !important;
    max-width: 44px !important;
    width: 44px;
    height: 44px;
    padding: 0 !important;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .paint-btn-rect {
    border-radius: 8px !important;
  }

  .paint-btn-square {
    border-radius: 0 !important;
  }

  /* Tool shape modifiers for new btn-style system */
  .tool-btn.tool-shape-circle {
    border-radius: 50%;
    min-width: 44px;
    max-width: 44px;
    width: 44px;
    height: 44px;
    padding: 0;
  }

  /* Circle with text needs to expand into a pill shape */
  .tool-btn.tool-shape-circle:has(.btn-text) {
    max-width: none;
    width: auto;
    height: auto;
    min-height: 44px;
    border-radius: 22px;
    padding: 4px 8px;
  }

  .tool-btn.tool-shape-rect {
    border-radius: 8px !important;
  }

  .tool-btn.tool-shape-square {
    border-radius: 0 !important;
  }

  /* Color picker shape classes */
  .color-picker-btn.tool-shape-circle {
    border-radius: 50% !important;
    min-width: 44px !important;
    max-width: 44px !important;
    width: 44px !important;
    height: 44px !important;
  }

  .color-picker-btn.tool-shape-rect {
    border-radius: 8px !important;
    width: 48px !important;
    height: 48px !important;
  }

  .color-picker-btn.tool-shape-square {
    border-radius: 0 !important;
    width: 48px !important;
    height: 48px !important;
  }

  /* Color picker base - no draw-btn dependency */
  .color-picker-btn {
    border: none;
    cursor: pointer;
    vertical-align: middle;
    appearance: none;
    -webkit-appearance: none;
    outline: none;
    background: transparent !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
    padding: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
  }

  .color-picker-btn::-webkit-color-swatch-wrapper {
    padding: 0;
    border-radius: inherit;
  }

  .color-picker-btn::-webkit-color-swatch {
    border-radius: inherit;
    border: none;
    box-shadow: none !important;
  }

  .color-picker-btn::-moz-color-swatch {
    border-radius: inherit;
    border: none;
    box-shadow: none !important;
  }

  /* Icon sizing inside tool buttons */
  .tool-btn ha-icon {
    --mdc-icon-size: 22px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Tool buttons with text: stack icon + text vertically */
  .tool-btn .btn-text {
    font-size: 0.75em;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .toolbar .tool-item .tool-btn {
    flex-direction: column;
    gap: 1px;
    padding: 4px 6px;
    min-width: 44px;
    text-align: center;
  }

  /* Pagination container styling */
  .pagination-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;
    width: 100%;
    box-sizing: border-box;
  }

  /* Actions row layout for consistent button widths */
  .actions-row {
    display: flex;
    width: 100%;
    gap: 8px;
    align-items: stretch;
  }

  .actions-row .action-item {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
  }

  .actions-row.icon-mode {
    justify-content: center;
    gap: 12px;
  }

  .actions-row.icon-mode .action-item {
    flex: 0 0 auto;
  }

  .actions-row .action-item button,
  .actions-row .action-item .upload-label {
    width: 100%;
    flex: 1;
    min-height: 44px;
    box-sizing: border-box;
    /* Stack icon + text vertically so content fits in equal-width columns */
    flex-direction: column;
    gap: 2px;
    padding: 6px 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.85em;
  }

  .actions-row .action-item button .btn-text,
  .actions-row .action-item .upload-label .btn-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    /* font-size: 0.85em; */
    line-height: 1.2;
  }

  /* In icon style, buttons must keep their fixed circular dimensions */
  .actions-row.icon-mode .action-item button,
  .actions-row.icon-mode .action-item .upload-label {
    width: 48px;
    height: 48px;
    min-height: 48px;
    flex: 0 0 48px;
    padding: 0;
    border-radius: 50%;
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    max-width: 100%;
    box-sizing: border-box;
  }
  .palette-group-card {
    background: var(--card-background-color, #fff);
    border-radius: var(--palette-card-radius, 8px);
    box-shadow: 0 2px 8px #0002;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: var(--side-card-width, 100%);
    flex-shrink: 0;
    box-sizing: border-box;
    overflow: hidden;
    white-space: normal;
    transition:
      width 0.3s ease,
      min-width 0.3s ease,
      flex 0.3s ease,
      padding 0.3s ease,
      opacity 0.3s ease;
  }
  /* Click-to-zoom: zoomed card fills row, siblings collapse */
  .palette-row.zoom-mode .palette-group-card.zoomed {
    flex: 1 0 100%;
    width: 100%;
    min-width: 100%;
    cursor: default;
  }
  .palette-row.zoom-mode .palette-group-card:not(.zoomed) {
    flex: 0 0 0px;
    width: 0;
    min-width: 0;
    padding: 0;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .palette-row.zoom-mode {
    gap: 0;
    overflow-x: hidden;
    width: 100%;
    transition: gap 0.3s ease;
  }
  /* Collapse button shown inside zoomed card */
  .palette-zoom-collapse-btn {
    align-self: flex-end;
    background: color-mix(
      in srgb,
      var(--primary-color, #0077cc) 12%,
      var(--card-background-color, #fff)
    );
    border: 1px solid
      color-mix(in srgb, var(--primary-color, #0077cc) 25%, transparent);
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 0.82em;
    font-weight: 500;
    color: var(--primary-color, #0077cc);
    cursor: pointer;
    margin-bottom: 6px;
    transition: background 0.2s;
  }
  .palette-zoom-collapse-btn:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #0077cc) 22%,
      var(--card-background-color, #fff)
    );
  }
  .palette-group-title {
    font-size: 1em;
    font-weight: 500;
    color: var(--primary-text-color, #444);
    margin: 0;
    width: auto;
    flex: 1 1 auto;
    text-align: left;
    display: block;
    align-self: center;
  }
  .palette-group-card .palette-card-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    width: 100%;
    gap: 12px;
  }
  /* Force all palette content inside side-by-side cards to respect the card width */
  .palette-group-card > * {
    max-width: 100%;
    box-sizing: border-box;
  }
  .palette-group-card .palette-expandable,
  .palette-group-card .palette-grid,
  .palette-group-card .palette-scroll-wrapper,
  .palette-group-card .palette-gradient-bar-wrapper,
  .palette-group-card palette-fan,
  .palette-group-card palette-wave,
  .palette-group-card palette-spiral,
  .palette-group-card palette-honeycomb,
  .palette-group-card palette-blinds,
  .palette-group-card palette-treemap {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .palette-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 4px;
    white-space: nowrap;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE 10+ */
    cursor: grab;
    user-select: none;
    padding: 5px;
  }
  .palette-row * {
    user-select: none;
  }
  .palette-row::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }
  .palette-section {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 120px;
  }
  .upload-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .upload-label.btn-style-icon {
    cursor: pointer;
  }
  .upload-label input[type="file"] {
    display: none;
  }
  .color-section {
    width: 100%;
    margin-bottom: 16px;
  }
  .color-section-title {
    font-size: 1.1em;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--primary-text-color, #222);
    text-align: center;
  }
  .color-section-list {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .selected {
    background: color-mix(
      in srgb,
      var(--primary-color, #00ff99) 15%,
      var(--card-background-color, #fff)
    ) !important;
    border: 2px solid var(--primary-color, #00ff99) !important;
  }
  .paint-btn-circle.selected {
    border: none !important;
    outline: 2.5px solid var(--primary-color, #00ff99);
    outline-offset: 2px;
  }
  /* Palette card container modes */
  .palette-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    width: 100%;
    margin-bottom: 8px;
  }
  .palette-tab-bar {
    display: flex;
    flex-direction: row;
    gap: 0;
    justify-content: center;
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 8%,
      var(--card-background-color, #fff)
    );
    border-radius: 10px;
    padding: 3px;
    margin-bottom: 10px;
    position: relative;
  }
  .palette-tab-indicator {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px) / var(--tab-count, 1));
    background: var(--card-background-color, #fff);
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
    transform: translateX(calc(var(--tab-active-index, 0) * 100%));
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
    z-index: 0;
  }
  .palette-tab-btn {
    flex: 1;
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 0.9em;
    cursor: pointer;
    font-weight: 500;
    color: var(--secondary-text-color, #666);
    transition: color 0.2s ease;
    position: relative;
    z-index: 1;
    user-select: none;
  }
  .palette-tab-btn:hover:not(.active) {
    color: var(--primary-text-color, #444);
  }
  .palette-tab-btn.active {
    color: var(--primary-text-color, #222);
    font-weight: 600;
  }
  .palette-tab-content {
    width: 100%;
    display: flex;
    justify-content: center;
    position: relative;
  }
  .palette-fold {
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: center;
    width: 100%;
    margin-bottom: 8px;
  }
  .palette-group-title[style*="cursor:pointer"] {
    user-select: none;
    transition: color 0.2s;
  }
  .palette-group-title[style*="cursor:pointer"]:hover {
    color: var(--primary-color, #0077cc);
  }
  .palette-dropdown-wrapper {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }
  .palette-dropdown-select {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--divider-color, #d0d7de);
    font-size: 0.9em;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #333);
    font-weight: 500;
    cursor: pointer;
    width: fit-content;
    transition: border-color 0.2s;
  }
  .palette-dropdown-select:focus {
    outline: none;
    border-color: var(--primary-color, #0077cc);
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--primary-color, #0077cc) 15%, transparent);
  }
  .palette-dropdown-content {
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .palette-empty-hint {
    font-size: 0.85em;
    color: var(--secondary-text-color, #888);
    font-style: italic;
    padding: 8px 0;
    text-align: center;
    width: 100%;
  }
  .palette-floating {
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: flex-start;
    width: 100%;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .palette-floating-btn {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 15%,
      var(--card-background-color, #fff)
    );
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 1em;
    color: var(--primary-color, #0077cc);
    font-weight: 500;
    cursor: pointer;
    margin-bottom: 6px;
    box-shadow: 0 1px 4px #0002;
    transition: background 0.2s;
  }
  .palette-floating-btn:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 30%,
      var(--card-background-color, #fff)
    );
  }
  .palette-group-card.floating {
    position: absolute;
    z-index: 10;
    min-width: 180px;
    max-width: 220px;
    box-shadow: 0 4px 16px #0003;
    background: var(--card-background-color, #fff);
    border: 1px solid
      color-mix(
        in srgb,
        var(--primary-color, #1976d2) 30%,
        var(--card-background-color, #fff)
      );
    margin-top: 32px;
    left: 0;
  }

  /* Palette display mode styles */
  .palette-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    width: 100%;
    margin: 0 auto;
  }
  .palette-grid-row {
    display: flex;
    flex-direction: row;
    gap: 6px;
    justify-content: center;
    flex-wrap: wrap;
    width: 100%;
  }
  .palette-grid-row .color-swatch {
    flex: 0 0 auto;
  }
  .palette-row-scroll {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    width: auto;
    max-width: 100%;
    align-items: center;
    scrollbar-width: thin;
    scrollbar-color: color-mix(
        in srgb,
        var(--primary-color, #1976d2) 30%,
        var(--card-background-color, #fff)
      )
      var(--card-background-color, #fff);
    height: 100%;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
  }
  .palette-row-scroll * {
    user-select: none;
    -webkit-user-select: none;
  }
  .palette-row-scroll .color-swatch {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    border: 2px solid #fff8;
    cursor: pointer;
    margin: 2px;
    box-shadow: 0 1px 4px #0004;
    transition: border 0.1s;
  }
  .palette-row-scroll::-webkit-scrollbar {
    height: 6px;
    background: var(--card-background-color, #fff);
  }
  .palette-row-scroll::-webkit-scrollbar-thumb {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 30%,
      var(--card-background-color, #fff)
    );
    border-radius: 3px;
  }
  .palette-row-scroll > :first-child {
    margin: 0 2px 0 2px;
  }
  .palette-row-scroll > :last-child {
    margin: 0 2px 0 2px;
  }
  /* ====== Expandable palette container ====== */
  .palette-expandable {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap !important;
    white-space: nowrap !important;
    overflow-x: hidden;
    position: relative;
  }
  .palette-expandable .color-swatch {
    flex: 0 0 auto;
  }

  /* --- Expand button: shared base --- */
  .palette-expandable .expand-btn {
    flex: 0 0 auto;
    margin-left: 6px;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    vertical-align: middle;
  }

  /* --- Pill style: "+N" badge --- */
  .palette-expandable .expand-pill {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 14%,
      var(--card-background-color, #fff)
    );
    color: var(--primary-color, #0077cc);
    font-size: 0.72em;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 50px;
    box-shadow: 0 1px 4px #0002;
    min-width: 28px;
    height: 24px;
    letter-spacing: 0.02em;
  }
  .palette-expandable .expand-pill:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 28%,
      var(--card-background-color, #fff)
    );
    box-shadow: 0 2px 8px #0003;
  }
  .palette-expandable .expand-pill.expanded {
    font-size: 1em;
    padding: 4px 10px;
    min-width: 24px;
    height: 24px;
  }

  /* --- Chevron style: carousel-matching arrow --- */
  .palette-expandable .expand-chevron {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 15%,
      var(--card-background-color, #fff)
    );
    color: var(--primary-color, #0077cc);
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    width: 28px;
    height: 28px;
    padding: 0;
  }
  .palette-expandable .expand-chevron:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 30%,
      var(--card-background-color, #fff)
    );
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .palette-expandable .expand-chevron svg {
    display: block;
  }

  /* --- Dots style: subtle ellipsis --- */
  .palette-expandable .expand-dots {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 10%,
      var(--card-background-color, #fff)
    );
    color: var(--primary-color, #0077cc);
    font-size: 1.1em;
    font-weight: 700;
    letter-spacing: 2px;
    padding: 2px 10px;
    border-radius: 50px;
    box-shadow: 0 1px 3px #0001;
    min-width: 28px;
    height: 24px;
    opacity: 0.75;
  }
  .palette-expandable .expand-dots:hover {
    opacity: 1;
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 22%,
      var(--card-background-color, #fff)
    );
    box-shadow: 0 2px 6px #0002;
  }

  /* --- Fade style: gradient mask over trailing edge --- */
  .palette-expandable.palette-fade-active {
    flex-wrap: nowrap !important;
    overflow: hidden;
    mask-image: linear-gradient(to right, black 60%, transparent 100%);
    -webkit-mask-image: linear-gradient(to right, black 60%, transparent 100%);
  }
  .palette-expandable .expand-fade-zone {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 60px;
    background: transparent;
    cursor: pointer;
    z-index: 4;
  }

  /* ====== Scroll mode: horizontal ribbon with nav arrows ====== */
  .palette-scroll-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  .palette-scroll-arrow {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    padding: 0;
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 15%,
      var(--card-background-color, #fff)
    );
    color: var(--primary-color, #0077cc);
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  .palette-scroll-arrow:hover {
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 30%,
      var(--card-background-color, #fff)
    );
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .palette-scroll-arrow svg {
    display: block;
  }
  .palette-scroll-track {
    flex: 1 1 auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 2px;
    scrollbar-width: none;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    scroll-behavior: smooth;
    padding: 4px 0;
  }
  .palette-scroll-track::-webkit-scrollbar {
    height: 0;
    display: none;
  }
  .palette-scroll-track.dragging {
    cursor: grabbing;
    scroll-behavior: auto;
  }
  .palette-scroll-track .color-swatch {
    flex: 0 0 auto;
  }

  /* ====== Gradient bar mode ====== */
  .palette-gradient-bar-wrapper {
    position: relative;
    width: 100%;
    padding: 4px 8px;
    box-sizing: border-box;
  }
  .palette-gradient-bar {
    height: 28px;
    border-radius: 14px;
    cursor: pointer;
    box-shadow:
      0 2px 8px #0002,
      inset 0 1px 2px #fff4;
    transition: box-shadow 0.2s;
    position: relative;
  }
  .palette-gradient-bar:hover {
    box-shadow:
      0 3px 12px #0003,
      inset 0 1px 2px #fff4;
  }
  .palette-gradient-ticks {
    position: relative;
    width: 100%;
    height: 14px;
    margin-top: 4px;
  }
  .palette-gradient-tick {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translateX(-50%);
  }
  .palette-gradient-tick.square {
    border-radius: 2px;
  }
  .palette-gradient-tick.rounded {
    border-radius: 4px;
  }
  .palette-gradient-tick.square,
  .palette-gradient-tick.rounded,
  .palette-gradient-tick.round {
    border: 2px solid var(--card-background-color, #fff);
    box-shadow: 0 1px 3px #0003;
    cursor: pointer;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }
  .palette-gradient-tick:hover {
    transform: translateX(-50%) scale(1.3);
    box-shadow: 0 2px 6px #0004;
  }

  /* ====== Fan / arc mode ====== */
  .palette-fan-container {
    overflow: hidden;
    margin: 0 auto;
  }
  .palette-fan-swatch {
    position: absolute !important;
    margin: 0 !important;
    box-sizing: border-box;
    transition:
      transform 0.2s,
      opacity 0.2s,
      box-shadow 0.2s;
    transform-origin: center bottom;
    z-index: 2;
  }
  .palette-fan-swatch:hover {
    z-index: 10 !important;
    transform: rotate(var(--fan-angle, 0deg)) scale(1.25) !important;
    opacity: 1 !important;
    box-shadow: 0 3px 12px #0004 !important;
  }

  /* ====== Wave mode ====== */
  .palette-wave-container {
    scrollbar-width: none;
  }
  .palette-wave-container::-webkit-scrollbar {
    display: none;
  }
  .palette-wave-swatch {
    position: absolute !important;
    margin: 0 !important;
    box-sizing: border-box;
    transition:
      transform 0.2s,
      box-shadow 0.2s;
    z-index: 2;
  }
  .palette-wave-swatch:hover {
    z-index: 10 !important;
    transform: scale(1.3) !important;
    box-shadow: 0 3px 12px #0004 !important;
  }

  /* ====== Spiral mode ====== */
  .palette-spiral-container {
    overflow: visible;
  }
  .palette-spiral-swatch {
    position: absolute !important;
    margin: 0 !important;
    box-sizing: border-box;
    transition:
      transform 0.2s,
      box-shadow 0.2s;
    z-index: 2;
  }
  .palette-spiral-swatch:hover {
    z-index: 10 !important;
    transform: scale(1.35) !important;
    box-shadow: 0 4px 14px #0005 !important;
  }

  /* ---- Honeycomb mode ---- */
  .palette-honeycomb-container {
    overflow: visible;
  }
  .palette-hex-swatch {
    position: absolute;
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    cursor: pointer;
    transition:
      transform 0.2s ease,
      filter 0.2s ease;
    box-shadow: none;
  }
  .palette-hex-swatch:hover {
    transform: scale(1.2);
    filter: brightness(1.2);
    z-index: 20 !important;
  }

  /* ---- Blinds mode ---- */
  .palette-blinds-inner {
    transform-origin: center center;
  }
  .palette-blind-strip {
    cursor: pointer;
    transition:
      flex 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      filter 0.2s;
    min-height: 0;
    min-width: 0;
  }

  /* ---- Treemap mode ---- */
  .palette-treemap-cell {
    position: absolute;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0.5px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .palette-treemap-cell span {
    font-size: 0.55em;
    font-family: monospace;
    pointer-events: none;
    white-space: nowrap;
  }
  .palette-treemap-cell:hover {
    outline: 3px solid var(--cell-color, #fff);
    outline-offset: -3px;
  }

  .palette-preview-hover.expanded-mode {
    overflow: hidden !important;
    scrollbar-width: none !important;
  }
  .palette-preview-hover {
    scrollbar-width: none;
    overflow: hidden;
  }
  .palette-preview-hover::-webkit-scrollbar {
    display: none !important;
  }
  .palette-preview-hover-expand {
    /* Remove transition for instant open/close */
    transition: none !important;
    max-height: none !important;
    opacity: 1 !important;
    overflow: visible !important;
  }
  .palette-expandable-content {
    /* Remove transition for instant open/close */
    transition: none !important;
    max-height: none !important;
    opacity: 1 !important;
    overflow: visible !important;
  }
  .card-title {
    font-size: 1.3em;
    font-weight: bold;
    margin-bottom: 18px;
    margin-top: 2px;
    color: var(--primary-text-color, #222);
  }

  /* Pixel Art Gallery Styles */
  .pixelart-gallery {
    width: 100%;
  }

  /* Item card border for dark mode visibility */
  .item-card-border .gallery-item {
    border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.15));
  }
  .item-card-border .carousel-content-card {
    border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.15));
  }
  .item-card-border .pixelarts-album-item {
    border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.15));
  }

  .pixelart-gallery-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    font-weight: 500;
    font-size: 0.95em;
    color: var(--primary-text-color, #212121);
  }

  .pixelart-count {
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.8em;
    font-weight: 500;
  }

  .pixelart-gallery-message {
    text-align: center;
    color: var(--secondary-text-color, #727272);
    font-style: italic;
    padding: 24px 12px;
  }

  /* Gallery Container Styles */
  .pixelart-gallery-plain {
    background: transparent;
    border: none;
    padding: 0;
    box-shadow: none;
  }

  /* Individual item plain styling */
  .pixelart-item.pixelart-item-plain,
  .pixelart-gallery-plain .pixelart-item.pixelart-item-plain {
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
  }

  .pixelart-item.pixelart-item-plain:hover,
  .pixelart-gallery-plain .pixelart-item.pixelart-item-plain:hover {
    transform: none !important;
    box-shadow: none !important;
  }

  .pixelart-item-list.pixelart-item-plain,
  .pixelart-gallery-plain .pixelart-item-list.pixelart-item-plain {
    width: calc(var(--pixelart-size-percent, 100%) * 0.5) !important;
  }

  /* Pixel Art Preview Styles - Match Matrix Exactly */
  .pixelart-preview {
    cursor: pointer;
    border-radius: 6px;
    overflow: hidden;
    background: var(--pixelart-bg-color, transparent);
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2px;
    width: 100%;
    height: auto;
  }

  .pixelart-matrix {
    display: grid;
    grid-template-columns: repeat(20, 1fr);
    gap: var(--pixelart-gap, 2px);
    background-color: var(--pixelart-bg-color, transparent);
    border-radius: 4px;
    width: 100%;
    min-height: 25px;
  }

  .pixelart-pixel {
    width: 100%;
    aspect-ratio: 1 / 1;
    background: #000000;
    border: none;
    transition: background 0.1s;
    box-sizing: border-box;
    display: block;
  }

  .pixelart-pixel.round {
    border-radius: 50%;
  }

  .pixelart-pixel.square {
    border-radius: 0;
  }

  .pixelart-pixel.active {
    /* No border for active, just keep the color */
  }

  /* Pixel Art Preview Sizes for Different Modes */
  .pixelart-item-grid .pixelart-preview {
    width: 100%;
    transition: all 0.3s ease;
    background: var(--pixelart-bg-color, transparent);
  }

  /* Grid item names and buttons - simple responsive scaling */
  .pixelart-item-grid .pixelart-name-grid {
    text-align: center;
    font-size: 0.85em;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pixelart-item-grid .pixelart-buttons-grid {
    width: 100%;
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-top: 4px;
  }

  .pixelart-item-grid .pixelart-buttons-grid .pixelart-btn {
    font-size: 0.75em;
    padding: 4px 8px;
  }

  .pixelart-item-list .pixelart-preview {
    width: calc(var(--pixelart-size-percent, 100%) * 1);
    height: auto;
    flex-grow: 1;
  }

  /* List mode name and button styling - Simple */
  .pixelart-item-list .pixelart-name-list {
    text-align: center;
    font-size: 0.9em;
  }

  .pixelart-item-list .pixelart-buttons-list {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .pixelart-item-list .pixelart-buttons-list .pixelart-btn {
    font-size: 0.75em;
    padding: 4px 8px;
    white-space: nowrap;
  }

  .pixel-btn-cross-container {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 10;
    pointer-events: none;
  }

  .pixel-btn-cross-container button {
    pointer-events: auto;
  }

  .pixelart-item-carousel .pixelart-preview {
    width: var(--pixelart-size-percent, 100%);
    max-width: none;
  }

  /* Gallery Grid Mode - Simple Container-Based Responsive Grid */
  .pixelart-gallery-grid {
    display: grid;
    gap: 12px;
    align-items: start;
    transition:
      grid-template-columns 0.3s ease,
      gap 0.3s ease;

    /* Container cards sized directly by preview size value */
    grid-template-columns: repeat(
      auto-fit,
      minmax(calc(var(--preview-size-value, 100) * 2px + 60px), 1fr)
    );
  }

  /* Grid item containers - simple and clean */
  .pixelart-item-grid {
    position: relative;
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    padding: 3px;
  }

  /* Preview fills its container naturally */
  .pixelart-item-grid .pixelart-preview {
    width: 100%;
    transition: all 0.3s ease;
  }

  /* Gallery List Mode */
  .pixelart-gallery-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* Gallery Compact Mode - List with Dividers */
  .pixelart-gallery-compact {
    display: grid;
    grid-template-columns: repeat(
      auto-fill,
      minmax(calc(280px * var(--preview-size-percent, 100%) / 100), 1fr)
    );
    gap: 0;
    margin-bottom: 16px;
  }

  .pixelart-compact-item {
    background: transparent;
    border: 1px solid var(--divider-color, #e1e4e8);
    padding: calc(12px * var(--preview-size-percent, 100%) / 100)
      calc(10px * var(--preview-size-percent, 100%) / 100);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    cursor: pointer;
    transition:
      background 0.15s ease,
      padding 0.2s ease;
    box-sizing: border-box;
  }

  .pixelart-compact-item:hover {
    background: var(--secondary-background-color, #f6f8fa);
  }

  .pixelart-compact-item .compact-content {
    display: flex;
    gap: calc(12px * var(--preview-size-percent, 100%) / 100);
    align-items: center;
    flex: 1;
    width: 100%;
  }

  .pixelart-compact-item .compact-preview {
    flex-shrink: 0;
  }

  .pixelart-compact-item .compact-info {
    display: flex;
    flex-direction: column;
    gap: calc(6px * var(--preview-size-percent, 100%) / 100);
    flex: 1;
    min-width: 0;
  }

  .pixelart-compact-item .compact-header {
    display: flex;
    align-items: baseline;
    gap: calc(8px * var(--preview-size-percent, 100%) / 100);
    width: 100%;
  }

  .pixelart-compact-item .compact-title {
    font-weight: 500;
    color: var(--primary-text-color, #24292f);
    font-size: calc(0.95em * var(--preview-size-percent, 100%) / 100);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: fit-content;
    margin: 0 auto;
  }

  .pixelart-compact-item .compact-meta {
    font-size: calc(0.8em * var(--preview-size-percent, 100%) / 100);
    color: var(--secondary-text-color, #57606a);
    white-space: nowrap;
  }

  /* Gallery Carousel Mode */
  .pixelart-gallery-carousel {
    display: flex;
    align-items: center;
  }

  .carousel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: visible;
  }

  .carousel-slide-container {
    width: 100%;
    display: flex;
    justify-content: center;
    margin: 0 0 10px;
  }

  .carousel-indicators {
    display: flex;
    gap: 8px;
    min-height: 12px; /* Ensure enough space for scaled dots */
  }

  .carousel-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--disabled-text-color, #bdbdbd);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .carousel-dot.active {
    background: var(--primary-color, #03a9f4);
    transform: scale(1.5);
  }

  .carousel-dot:hover {
    background: var(--primary-color-dark, #0288d1);
  }

  /* Pixel Art Item Base Styles */
  .pixelart-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    border-radius: 8px;

    transition: all 0.2s ease;
  }

  /*  .pixelart-item:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateY(-2px);
  } */

  /* Grid Mode Items */

  /* List Mode Items - Simple and Clean */
  .pixelart-item-list {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: all 0.2s ease;
    width: calc(var(--preview-size-percent, 100%) * 2.5px + 100px);
    max-width: 100%;
    margin: 0 auto;
  }

  .pixelart-item-list .pixelart-preview {
    flex: 0 0 auto;
    flex-grow: 2;
  }

  /* List content wrapper for proper centering */
  .pixelart-list-content-wrapper {
    display: flex;
    flex-direction: row;
    gap: 12px;
    align-items: center;
    justify-content: center;
    width: 100%;
  }

  /* Carousel Mode Items */
  .pixelart-item-carousel {
    border: none;
    background: transparent;
    width: 100%;
    padding: 0 8px;
    margin: 0 6px;
  }

  .pixelart-item-carousel:hover {
    transform: none;
    box-shadow: none;
  }

  /* Canvas Styles */
  .pixelart-canvas {
    display: block;
    border-radius: 6px;
    transition: transform 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid var(--divider-color, #e0e0e0);
  }

  .pixelart-item:hover .pixelart-canvas {
    transform: scale(1.02);
  }

  .pixelart-canvas-grid {
    width: 100%;
    max-width: 200px;
    height: auto;
    margin-bottom: 12px;
  }

  .pixelart-canvas-list {
    width: 120px;
    height: auto;
    flex-shrink: 0;
  }

  .pixelart-canvas-carousel {
    width: 100%;
    max-width: 300px;
    height: auto;
    margin-bottom: 16px;
  }

  /* Name Styles */
  .pixelart-name {
    font-weight: 500;
    color: var(--primary-text-color, #212121);
    text-align: center;
    font-size: 0.9em;
  }

  .pixelart-name.clickable {
    cursor: pointer;
    transition: color 0.2s ease;
  }

  .pixelart-name.clickable:hover {
    color: var(--primary-color, #03a9f4);
    text-decoration: underline;
  }

  .pixelart-name-list {
    flex-grow: 1;
    text-align: left;
    margin-bottom: 0;
    font-size: 0.95em;
  }

  .pixelart-name-carousel {
    font-size: 1.1em;
    font-weight: 600;
  }

  /* Button Styles */
  .pixelart-buttons {
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pixelart-buttons-list {
    flex-shrink: 0;
    flex-direction: column;
    gap: 6px;
  }

  .pixelart-buttons-carousel {
    gap: 12px;
  }

  .pixelart-btn {
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.8em;
    padding: 6px 12px;
    transition: all 0.2s ease;
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
  }

  .pixelart-btn:hover {
    background: var(--primary-color-dark, #0288d1);
  }

  .pixelart-btn.delete-btn {
    background: var(--error-color, #f44336);
  }

  .pixelart-btn.delete-btn:hover {
    background: var(--error-color-dark, #d32f2f);
  }

  /* ====================================================================
     COMPACT MODE & DELETE BUTTONS - CENTRALIZED
     ====================================================================
     
     All compact layout and delete button styles are centralized in:
     - www/compact-layout-utils.js (compact item layout)
     - www/delete-button-styles.js (button styles & variants)
     
     Both are imported and included via drawCardStyles.
     DO NOT add duplicate definitions here.
     ==================================================================== */

  /* Title row with cross (for grid, carousel) */
  .pixelart-title-row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 8px;
    gap: 8px;
  }

  .pixelart-delete-title-row {
    background: var(--card-background-color, rgba(255, 255, 255, 0.9));
    border-radius: 50%;
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 1em;
    flex-shrink: 0;
  }

  .pixelart-delete-title-row:hover {
    background: var(--card-background-color, rgba(255, 255, 255, 1));
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transform: scale(1.05);
  }

  /* List mode overlay cross (top-right of preview) - Simple */
  .pixelart-preview .pixelart-delete-overlay-list {
    position: absolute !important;
    top: calc(6px + var(--preview-size-percent, 100%) * 0.04px) !important;
    right: calc(6px + var(--preview-size-percent, 100%) * 0.04px) !important;
    z-index: 10;
    width: calc(20px + var(--preview-size-percent, 100%) * 0.08px) !important;
    height: calc(20px + var(--preview-size-percent, 100%) * 0.08px) !important;
    padding: 0 !important;
    transition: all 0.2s ease;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  /* Override red-style for list mode */
  .pixelart-preview .pixelart-delete-overlay-list.red-style::before,
  .pixelart-preview .pixelart-delete-overlay-list.red-style::after {
    width: calc(12px + var(--preview-size-percent, 100%) * 0.04px) !important;
  }

  .pixelart-preview .pixelart-delete-overlay-list:hover {
    transform: scale(1.1);
  }

  /* Grid mode overlay cross (top-right of preview when no title) */
  .pixelart-delete-overlay-grid {
    position: absolute;
    top: calc(4px * var(--preview-size-percent, 100%) / 100);
    right: calc(4px * var(--preview-size-percent, 100%) / 100);
    z-index: 10;
    background: var(--card-background-color, rgba(255, 255, 255, 0.9));
    border-radius: 50%;
    width: calc(24px * var(--preview-size-percent, 100%) / 100);
    height: calc(24px * var(--preview-size-percent, 100%) / 100);
    padding: 0;
    font-size: calc(1em * var(--preview-size-percent, 100%) / 100);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .pixelart-delete-overlay-grid:hover {
    background: var(--card-background-color, rgba(255, 255, 255, 1));
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transform: scale(1.05);
  }

  /* Ensure items are positioned relative for overlay buttons */
  .pixelart-item-list,
  .pixelart-item-grid,
  .pixelart-item-carousel {
    position: relative;
  }

  /* Remove old overlay styles */
  .pixelart-delete-overlay {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 10;
    background: var(--card-background-color, rgba(255, 255, 255, 0.9));
    border-radius: 50%;
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 1em;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pixelart-delete-overlay:hover {
    background: var(--card-background-color, rgba(255, 255, 255, 1));
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transform: scale(1.05);
  }

  /* Ensure preview container is positioned relative for overlay */
  .pixelart-preview {
    position: relative;
  }

  /* List mode button adjustments */
  .pixelart-buttons-list .pixelart-btn {
    font-size: 0.75em;
    padding: 4px 8px;
    min-width: 60px;
  }

  /* Carousel mode button adjustments */
  .pixelart-buttons-carousel .pixelart-btn {
    font-size: 0.9em;
    padding: 8px 16px;
  }

  .apply-pixelart-btn {
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
  }

  .apply-pixelart-btn:hover {
    background: var(--dark-primary-color, #0288d1);
    transform: translateY(-1px);
  }

  .apply-to-matrix-btn {
    background: var(--accent-color, #ff9800);
    color: var(--text-primary-color, #fff);
  }

  .apply-to-matrix-btn:hover {
    background: color-mix(in srgb, var(--accent-color, #ff9800) 85%, black);
    transform: translateY(-1px);
  }

  .delete-pixelart-btn {
    background: var(--error-color, #f44336);
    color: var(--text-primary-color, #fff);
  }

  .delete-pixelart-btn:hover {
    background: color-mix(in srgb, var(--error-color, #f44336) 85%, black);
    transform: translateY(-1px);
  }

  /* ==============================================
     PAGINATION STYLES
     ============================================== */

  .pagination-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 16px;
    border-radius: 8px;
  }

  /* Pages Mode */
  .pagination-container.pages {
    gap: 8px;
  }

  /* Responsive adjustments */
  @media (max-width: 600px) {
    .pagination-container.pages {
      gap: 4px;
    }

    .pagination-container .draw-btn {
      padding: 6px 8px;
      font-size: 0.85em;
      min-width: 32px;
    }

    .pagination-container .draw-btn.save {
      padding: 6px;
    }
  }

  /* Layout Section Spacing */
  .draw-container > * + * {
    margin-top: 16px;
  }

  .draw-container > .palettes {
    margin-bottom: 12px;
  }

  .draw-container > .toolbar {
    margin-bottom: 16px;
  }

  .draw-container > .matrix {
    margin-bottom: 16px;
  }

  .draw-container > .actions {
    margin-bottom: 12px;
  }

  /* Tool Reordering Styles */
  .toolbar-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .tool-item {
    position: relative;
    display: flex;
    align-items: center;
    transition: all 0.2s ease;
  }

  .tool-item[draggable="true"]:hover {
    transform: scale(1.05);
  }

  .toolbar-container[data-allow-drag="true"] {
    border: 2px dashed var(--primary-color, #0077cc);
    border-radius: 8px;
    padding: 8px;
    background: color-mix(
      in srgb,
      var(--primary-color, #0077cc) 5%,
      transparent
    );
    margin: 4px 0;
  }

  .toolbar-container[data-allow-drag="true"]::before {
    content: "🔄 Drag tools to reorder";
    display: block;
    text-align: center;
    font-size: 0.8em;
    color: var(--primary-color, #0077cc);
    margin-bottom: 8px;
    font-weight: 600;
  }

  .tool-item.tool-placeholder {
    background: var(--secondary-background-color, #e1e5e9);
    border: 2px dashed var(--primary-color, #0077cc) !important;
    border-radius: 6px;
    opacity: 0.5;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Drag reordering styles */
  .dragging {
    opacity: 0.9;
    transform: scale(1.04);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    z-index: 1000;
    transition: none !important;
  }

  .animating {
    transition: transform 0.2s ease;
  }

  .tool-order-handle,
  .layout-section-handle {
    cursor: grab;
    padding: 4px;
    margin: 0 4px;
    border-radius: 4px;
    user-select: none;
    color: var(--secondary-text-color, #666);
    font-size: 16px;
  }

  .tool-order-handle:hover,
  .layout-section-handle:hover {
    background: var(--secondary-background-color, #f0f0f0);
    color: var(--primary-text-color, #333);
  }

  .tool-order-handle:active,
  .layout-section-handle:active {
    cursor: grabbing;
  }

  .layout-section-handle::after {
    content: "☰";
  }

  /* Tool drag handles for main card */
  .tool-drag-handle {
    cursor: grab;
    user-select: none;
    color: var(--secondary-text-color, #666);
    font-size: 8px;
    position: absolute;
    top: 2px;
    right: 2px;
    z-index: 10;
    line-height: 1;
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    background: var(--card-background-color, rgba(255, 255, 255, 0.8));
  }

  .tool-drag-handle:hover {
    background: var(--card-background-color, rgba(255, 255, 255, 0.95));
    color: var(--primary-text-color, #333);
  }

  .tool-drag-handle:active {
    cursor: grabbing;
  }

  /* Tool order section styling to match layout section */
  .tool-order-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tool-order-item {
    display: flex;
    align-items: center;
    padding: 12px;
    background: var(--secondary-background-color, #f8f9fa);
    border: 1px solid var(--divider-color, #e0e4e7);
    border-radius: 8px;
    transition: all 0.2s ease;
    cursor: default;
  }

  .tool-order-item:hover {
    background: var(--secondary-background-color, #f0f2f5);
    border-color: var(--divider-color, #d1d6db);
  }

  .tool-order-item.dragging {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    background: color-mix(
      in srgb,
      var(--accent-color, #ff9800) 12%,
      var(--card-background-color, #fff)
    );
    transform: scale(1.04);
    z-index: 1000;
  }

  .tool-order-icon {
    font-size: 18px;
    margin-right: 10px;
    width: 20px;
    text-align: center;
  }

  .tool-order-info {
    flex: 1;
  }

  .tool-order-info > div:first-child {
    font-weight: 600;
    color: var(--primary-text-color, #333);
    margin-bottom: 2px;
  }

  .tool-order-info > div:last-child {
    font-size: 0.85em;
    color: var(--secondary-text-color, #666);
  }
`;
