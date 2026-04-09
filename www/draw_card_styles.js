// Removed duplicate string export. Swatch shape styles merged below.
// CSS styles for Yeelight Cube Lite Draw Card
import { css, unsafeCSS } from "https://unpkg.com/lit@2.8.0/index.js?module";
import { compactModeStyles } from "./compact-mode-styles.js";
import { compactLayoutStyles } from "./compact-layout-utils.js";
import { deleteButtonStyles } from "./delete-button-styles.js";
import { exportImportButtonStyles } from "./export-import-button-utils.js";
import { carouselStyles } from "./carousel-utils.js";

export const drawCardStyles = css`
  /* Shared Compact Mode Styles */
  ${unsafeCSS(compactModeStyles)}

  /* Shared Compact Layout Styles */
  ${unsafeCSS(compactLayoutStyles)}

  /* Shared Delete Button Styles */
  ${unsafeCSS(deleteButtonStyles)}

  /* Shared Export/Import Button Styles */
  ${unsafeCSS(exportImportButtonStyles)}

  /* Shared Carousel Styles */
  ${unsafeCSS(carouselStyles)}

  .palette-stacked-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 8px;
    gap: 12px;
  }

  .palette-stacked-title-row .draw-btn {
    margin: 0;\n  }\n  .palette-fold {
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
    border: 2px solid #fff;
    cursor: pointer;
    transition: box-shadow 0.2s, border 0.2s;
    display: inline-block;
  }
  .color-swatch.square {
    border-radius: 6px !important;
    width: 28px;
    height: 28px;
    margin: 0 4px;
    box-shadow: 0 1px 4px #0002;
    border: 2px solid #fff;
    cursor: pointer;
    transition: box-shadow 0.2s, border 0.2s;
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
  .palette-dropdown select:focus {
    outline: none;
    box-shadow: 0 1px 4px #0003;
  }
  /* Floating mode: center card below button */
  .palette-group-card.floating.hide {
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%) scale(0.95);
  }
  /* Preview-hover mode */
  .palette-preview-hover {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
    width: 100%;
    gap: 18px;
  }
  .palette-preview-card {
    flex: 1 1 0;
    min-width: 48px;
    max-width: 180px;
    height: 100%; /* Fill the row height */
    transition: box-shadow 0.2s, transform 0.3s;
    overflow: visible;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Slide-out animation for non-expanded preview cards */
  .palette-preview-hover.expanded-mode .palette-preview-card:not(.expanded) {
    opacity: 0;
    pointer-events: none;
    transform: translateX(var(--slide-dir, 0)) scale(0.95);
    transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  /* Slide-in animation for preview cards when not expanded */
  .palette-preview-hover:not(.expanded-mode) .palette-preview-card {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(0) scale(1);
    transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    margin: 0 auto;
  }
  .palette-preview-card.expanded {
    margin: 0 auto;
    height: 100%;
    z-index: 10;
    width: 100%;
    min-width: 100%;
    max-width: 100%;
  }
  .palette-preview-content {
    opacity: 0;
    pointer-events: none;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .palette-preview-card.expanded .palette-preview-content {
    opacity: 1;
    pointer-events: auto;
    position: static;
    gap: 6px;
    padding: 8px;
  }
  .palette-preview-dots {
    display: flex;
    flex-direction: row;
    gap: 4px;
    align-items: center;
    justify-content: center;
    padding: 4px 0;
  }
  .palette-preview-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--divider-color, #ccc);
    box-shadow: 0 1px 2px #0002;
    margin: 0 1px;
    border: 1px solid #fff8;
  }
  .palette-preview-dot.round {
    border-radius: 50%;
  }
  .palette-preview-dot.square {
    border-radius: 4px;
  }
  .palette-preview-card.expanded > .palette-preview-dots {
    display: none;
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
    transition: background 0.1s, border-radius 0.2s;
    cursor: pointer;
    box-sizing: border-box;
    display: block;
  }
  .pixel.round {
    border-radius: 50%;
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
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
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
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }
  .draw-btn.clear {
    background: color-mix(in srgb, var(--error-color, #db4437) 15%, var(--card-background-color, #fff));
    color: var(--error-color, #db4437);
  }
  .draw-btn.clear:hover {
    background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff));
  }
  .draw-btn.save {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
    box-shadow: none;
  }
  .draw-btn.save:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }
  .draw-btn:disabled,
  .draw-btn.disabled {
    background: var(--disabled-text-color, #bdbdbd) !important;
    color: #ffffff !important;
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
    border-radius: 8px;
    box-shadow: 0 2px 8px #0002;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: fit-content;
    box-sizing: border-box;
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

  .palette-row {
    display: flex;
    flex-direction: row;
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 4px;
    white-space: nowrap;
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
    background: #d0ffe6 !important;
    border: 2px solid #00ff99 !important;
  }
  .paint-btn-circle.selected {
    border: none !important;
    outline: 2.5px solid #00ff99;
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
    gap: 8px;
    justify-content: center;
    margin-bottom: 6px;
  }
  .palette-tab-btn {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    border: none;
    border-radius: 6px 6px 0 0;
    padding: 6px 18px;
    font-size: 1em;
    cursor: pointer;
    font-weight: 500;
    color: var(--primary-color, #0077cc);
    transition: background 0.2s;
  }
  .palette-tab-btn.active {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
    color: var(--primary-text-color, #222);
    font-weight: 600;
    box-shadow: 0 2px 8px #0002;
  }
  .palette-tab-content {
    width: 100%;
    display: flex;
    justify-content: center;
    position: absolute;
    margin-top: 12px;
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
  .palette-dropdown {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 100%;
    width: fit-content;
  }
  .palette-dropdown select {
    padding: 12px 12px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
    font-size: 1em;
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
    font-weight: 500;
    cursor: pointer;
  }
  .palette-dropdown-content {
    width: 100%;
    display: flex;
    justify-content: center;
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
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
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
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }
  .palette-group-card.floating {
    position: absolute;
    z-index: 10;
    min-width: 180px;
    max-width: 220px;
    box-shadow: 0 4px 16px #0003;
    background: var(--card-background-color, #fff);
    border: 1px solid color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
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
    width: 100%;
  }
  .palette-row-scroll {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    width: auto;
    max-width: 100%;
    align-items: center;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff)) var(--card-background-color, #fff);
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
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
    border-radius: 3px;
  }
  .palette-row-scroll > :first-child {
    margin: 0 2px 0 2px;
  }
  .palette-row-scroll > :last-child {
    margin: 0 2px 0 2px;
  }
  .palette-expandable {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap !important;
    white-space: nowrap !important;
    overflow-x: hidden;
  }
  .palette-expandable .color-swatch {
    flex: 0 0 auto;
  }
  .palette-expandable .expand-btn {
    flex: 0 0 auto;
    margin-left: 8px;
    /* Match paint tool button style */
    background: color-mix(in srgb, var(--primary-color, #1976d2) 12%, var(--card-background-color, #fff));
    border: none;
    border-radius: 8px;
    box-shadow: 0 1px 4px #0001;
    color: var(--primary-color, #0077cc);
    font-size: 18px;
    padding: 6px 12px;
    cursor: pointer;
    transition: box-shadow 0.2s, border 0.2s;
    display: flex;
    align-items: center;
  }
  .palette-expandable .expand-btn.icon-mode {
    padding: 6px 8px;
    font-size: 20px;
  }
  /* Ensure draw-btn and paint-btn shape classes apply to expand-btn */
  .palette-expandable .expand-btn.draw-btn {
    /* Inherit draw-btn styles */
  }
  .palette-expandable .expand-btn.paint-btn-rect {
    border-radius: 8px;
  }
  .palette-expandable .expand-btn.paint-btn-round {
    border-radius: 50px;
  }

  .palette-stacked-deck {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .palette-stacked-cards {
    position: relative;
    width: auto;
    height: auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
  }
  .palette-stacked-card {
    position: relative;
    width: auto;

    background: var(--card-background-color, #fff);
    border-radius: 14px;
    box-shadow: 0 2px 12px #0002;
    transition: box-shadow 0.3s, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.4s;
    overflow: hidden;
    z-index: 2;
    opacity: 1;
    filter: none;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .palette-stacked-card.active {
    z-index: 3;
    opacity: 1;
    filter: none;
    pointer-events: auto;
    transform: scale(1) translateY(0);
    padding: 10px 12px 14px 12px;
    position: relative;
    max-width: 370px;
  }
  .palette-stacked-card.bg.prev,
  .palette-stacked-card.bg.next {
    display: none !important;
  }
  .palette-stacked-nav {
    position: static;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin: 0 8px;
    z-index: 4;
  }
  .palette-stacked-nav button {
    background: rgba(100, 100, 255, 0.12);
    border: none;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6464ff;
    font-size: 1.2em;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    outline: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }
  .palette-stacked-nav button:hover {
    background: rgba(100, 100, 255, 0.22);
    color: var(--primary-color, #3333cc);
  }
  .palette-stacked-title {
    font-size: 1rem;
    font-weight: 500;
    margin-bottom: 8px;
    margin-left: 0;
    margin-top: 0;
    padding: 8px 0 0 8px;
  }
  .palette-stacked-nav > button:first-of-type {
    transform: translateX(-50px);
  }
  .palette-stacked-nav > button:last-of-type {
    transform: translateX(50px);
  }
  .palette-stacked-content {
    padding: 0 16px 8px 16px;
  }
  .palette-stacked-card.slide-in-left {
    opacity: 1;
    left: 50%;
    transform: translateX(-50%) scale(1);
    animation: slideInLeft 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .palette-stacked-card.slide-in-right {
    opacity: 1;
    left: 50%;
    transform: translateX(-50%) scale(1);
    animation: slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .palette-stacked-card.slide-out-left {
    opacity: 0;
    left: 10%;
    transform: translateX(-50%) scale(0.95);
    animation: slideOutLeft 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .palette-stacked-card.slide-out-right {
    opacity: 0;
    left: 90%;
    transform: translateX(-50%) scale(0.95);
    animation: slideOutRight 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  @keyframes slideInLeft {
    from {
      opacity: 0;
      left: 10%;
      transform: translateX(-50%) scale(0.95);
    }
    to {
      opacity: 1;
      left: 50%;
      transform: translateX(-50%) scale(1);
    }
  }
  @keyframes slideInRight {
    from {
      opacity: 0;
      left: 90%;
      transform: translateX(-50%) scale(0.95);
    }
    to {
      opacity: 1;
      left: 50%;
      transform: translateX(-50%) scale(1);
    }
  }
  @keyframes slideOutLeft {
    from {
      opacity: 1;
      left: 50%;
      transform: translateX(-50%) scale(1);
    }
    to {
      opacity: 0;
      left: 10%;
      transform: translateX(-50%) scale(0.95);
    }
  }
  @keyframes slideOutRight {
    from {
      opacity: 1;
      left: 50%;
      transform: translateX(-50%) scale(1);
    }
    to {
      opacity: 0;
      left: 90%;
      transform: translateX(-50%) scale(0.95);
    }
  }
  .palette-preview-hover.expanded-mode {
    overflow-x: hidden !important;
    scrollbar-width: none !important;
    white-space: wrap !important;
    display: flex;
    flex-wrap: nowrap !important;
  }
  .palette-preview-hover {
    scrollbar-width: none;
    white-space: nowrap;
    display: flex;
    flex-wrap: nowrap;
  }
  .palette-preview-hover::-webkit-scrollbar {
    display: none !important;
  }
  .palette-preview-content {
    overflow-x: auto;
    white-space: nowrap;
    cursor: grab;
    -webkit-overflow-scrolling: touch;
  }
  .palette-preview-content:active {
    cursor: grabbing;
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
    aspect-ratio: 3.5/1; /* 20:5.7 ratio for better proportions */
  }

  .pixelart-matrix {
    display: grid;
    grid-template-columns: repeat(20, 1fr);
    grid-template-rows: repeat(5, 1fr);
    gap: var(--pixelart-gap, 2px);
    background: transparent;
    border-radius: 4px;
    width: 100%;
    height: 100%;
    min-height: 25px;
  }

  .pixelart-pixel {
    width: 100%;
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
    transition: grid-template-columns 0.3s ease, gap 0.3s ease;

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
    transition: background 0.15s ease, padding 0.2s ease;
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
    overflow: hidden;
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
    background: #ff9800;
    color: var(--text-primary-color, #fff);
  }

  .apply-to-matrix-btn:hover {
    background: #f57c00;
    transform: translateY(-1px);
  }

  .delete-pixelart-btn {
    background: #f44336;
    color: var(--text-primary-color, #fff);
  }

  .delete-pixelart-btn:hover {
    background: #d32f2f;
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
    background: rgba(0, 119, 204, 0.05);
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
    background: color-mix(in srgb, #ff9800 12%, var(--card-background-color, #fff));
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
