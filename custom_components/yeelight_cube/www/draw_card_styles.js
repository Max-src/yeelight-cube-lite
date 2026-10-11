// Removed duplicate string export. Swatch shape styles merged below.
// CSS styles for Yeelight Cube Lite Draw Card
import { css, unsafeCSS } from "./lib/lit-all.js";
import { cardLayoutStyles, cardSpacing } from "./card-layout-utils.js";
import { compactLayoutStyles } from "./compact-layout-utils.js";
import {
  deleteButtonStyles,
  deleteButtonPositionStyles,
} from "./delete-button-styles.js";
import { exportImportButtonStyles } from "./action-button-utils.js";
import { carouselStyles } from "./carousel-utils.js";
import { collectionGalleryStyles } from "./collection-gallery.js";

export const drawCardStyles = css`
  ${unsafeCSS(cardLayoutStyles)}
  /* Allow outside delete buttons to overflow ha-card */
  :host {
    overflow: visible !important;
  }
  ha-card {
    overflow: visible !important;
  }


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

  /* The pixel-art gallery: the shared gallery (collection-gallery.js). */
  ${unsafeCSS(collectionGalleryStyles)}
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
  /* Palette card container modes */
  .palette-tabs {
    width: 100%;
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
    /* Smooth gap transition when entering/leaving expanded-mode (issue #6) */
    transition: gap 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .palette-preview-card {
    flex: 0 0 auto;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: stretch;
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
    /* Fix #13: fallback for browsers without color-mix() (older WebKit / HA webviews) */
    background: var(--secondary-background-color, #f0f4fa);
    background: color-mix(
      in srgb,
      var(--primary-color, #0077cc) 5%,
      var(--card-background-color, #fff)
    );
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
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
    gap: 0; /* transitions smoothly via .palette-preview-hover transition: gap rule */
    overflow: hidden !important;
    scrollbar-width: none !important;
  }
  .palette-preview-hover:not(.expanded-mode) .palette-preview-card.empty {
    opacity: 1;
  }
  /* Expanded card takes full width.
     max-height is set via inline style by applyHeights() after the palette has
     re-rendered at the expanded container width, giving the true content height.
     The CSS fallback (2000px) is only active on the very first RAF before
     applyHeights() runs. */
  .palette-preview-card.expanded {
    flex: 1 0 100%;
    max-height: var(--card-open-h, 2000px);
    z-index: 10;
    overflow: hidden;
    padding: 0;
  }
  /* Body wraps palette content — fixed pixel width from JS (--container-w) ensures
     content always renders at full container width. No transform transition —
     the body snaps instantly to its scaled state; only max-height animates. */
  .palette-preview-body {
    pointer-events: none;
    width: var(--container-w, 300px);
    transform: scale(calc(1 / var(--n-cards, 3)));
    transform-origin: top left;
    box-sizing: border-box;
    /* Animate scale when expanding/collapsing so the content doesn't jump.
       The background:transparent inline style (set by handleCollapse) hides the
       gap between the shrinking body and the card bottom during the animation. */
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .palette-preview-card.expanded .palette-preview-body {
    pointer-events: auto;
    /* width stays var(--container-w) — JS updates it to outerW when expanded
       so the body fills the card. Removing width:100% prevents the expand-flash
       where 100% was resolving to the card's narrow transitioning width. */
    transform: scale(1);
    padding: 0 10px 6px 8px;
  }
  /* Empty card: no pointer events since there's nothing to interact with */
  .palette-preview-card.empty {
    cursor: default;
  }
  /* Title bar — always rendered, animates in/out via max-height + opacity */
  .palette-preview-card-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--secondary-text-color, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    /* Collapsed: hidden with no space */
    max-height: 0;
    opacity: 0;
    padding: 0 10px;
    transition:
      max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      padding 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
  /* Expanded: full height and visible */
  .palette-preview-card.expanded .palette-preview-card-title {
    max-height: 2em;
    opacity: 1;
    padding: 8px 10px 6px;
  }
  /* Empty preview card placeholder */
  .palette-mini-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: 1;
    min-height: 0;
    margin: 1px;
    padding: 4px;
    /* inset box-shadow instead of border so it never overflows its box */
    box-shadow: inset 0 0 0 2px var(--divider-color, rgba(180, 180, 180, 0.5));
    border-radius: 6px;
    background: color-mix(
      in srgb,
      var(--primary-text-color, #333) 3%,
      transparent
    );
  }
  .palette-preview-hover[data-display-mode="treemap"] .palette-mini-empty {
    padding: 16px;
  }
  .palette-preview-hover[data-display-mode="blinds"] .palette-mini-empty {
    padding: 15px;
  }
  .palette-preview-hover[data-display-mode="honeycomb"] .palette-mini-empty {
    padding: 10px;
  }
  .palette-preview-hover[data-display-mode="gradient"] .palette-mini-empty {
    padding: 4px;
  }
  .mini-empty-hint {
    font-size: 11px;
    color: var(--secondary-text-color, #888);
    opacity: 0.45;
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
    width: 100%;
    align-items: center;
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

  /* Color picker base */
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: ${unsafeCSS(cardSpacing.control)};
    justify-content: center;
    width: 100%;
    box-sizing: border-box;
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
    width: 100%;
    gap: 12px;
  }
  /* Force all palette content inside side-by-side cards to respect the card width */
  .palette-group-card > * {
    max-width: 100%;
    box-sizing: border-box;
  }
  .palette-group-card yc-swatches {
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
  .selected {
    background: color-mix(
      in srgb,
      var(--primary-color, #00ff99) 15%,
      var(--card-background-color, #fff)
    ) !important;
    border: 2px solid var(--primary-color, #00ff99) !important;
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
  .palette-group-title[style*="cursor:pointer"] {
    user-select: none;
    transition: color 0.2s;
  }
  .palette-group-title[style*="cursor:pointer"]:hover {
    color: var(--primary-color, #0077cc);
  }
  .palette-dropdown-wrapper {
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
  /* Carousel wrapper: must fill full width */
  .palette-colors-carousel-wrapper {
    width: 100%;
    display: block;
  }

  /* Colors section card border */
  .palette-colors-card-border .palette-group-card {
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
  }
  .palette-colors-card-border .carousel-content-card {
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
  }
  .palette-colors-card-border .palette-tab-content {
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    padding: 8px;
    box-sizing: border-box;
  }
  .palette-colors-card-border .palette-dropdown-content {
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    padding: 8px;
    box-sizing: border-box;
  }
  .palette-colors-card-border .palette-preview-card.expanded {
    box-shadow: inset 0 0 0 1px var(--divider-color, rgba(128, 128, 128, 0.35));
  }

  .pixelart-gallery-message {
    text-align: center;
    color: var(--secondary-text-color, #727272);
    font-style: italic;
    padding: 24px 12px;
  }

  .carousel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: visible;
  }

  /* Carousel dot styles: shared carouselStyles (imported above) is the
     source of truth. No local overrides needed here. */

  /* ====================================================================
     COMPACT MODE & DELETE BUTTONS - CENTRALIZED
     ====================================================================
     
     All compact layout and delete button styles are centralized in:
     - www/compact-layout-utils.js (compact item layout)
     - www/delete-button-styles.js (button styles & variants)
     
     Both are imported and included via drawCardStyles.
     DO NOT add duplicate definitions here.
     ==================================================================== */

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

  /* Drag reordering styles */
`;
