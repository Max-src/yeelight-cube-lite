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
import { tabBarStyles } from "./tab-bar.js";
import { sectionLayoutStyles } from "./section-layouts.js";

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
  ${unsafeCSS(tabBarStyles)}
  /* The color sections' layouts (section-layouts.js). */
  ${unsafeCSS(sectionLayoutStyles)}

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
  .tool-btn.tool-shape-round {
    border-radius: 50%;
    min-width: 44px;
    max-width: 44px;
    width: 44px;
    height: 44px;
    padding: 0;
  }

  /* Round with text expands into a pill */
  .tool-btn.tool-shape-round:has(.btn-text) {
    max-width: none;
    width: auto;
    height: auto;
    min-height: 44px;
    border-radius: 22px;
    padding: 4px 8px;
  }

  .tool-btn.tool-shape-rounded {
    border-radius: 8px !important;
  }

  .tool-btn.tool-shape-square {
    border-radius: 0 !important;
  }

  /* Color picker shape classes */
  .color-picker-btn.tool-shape-round {
    border-radius: 50% !important;
    min-width: 44px !important;
    max-width: 44px !important;
    width: 44px !important;
    height: 44px !important;
  }

  .color-picker-btn.tool-shape-rounded {
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

  /* The color sections' row (_renderColorsSection). */
  .palettes {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
  }

  /* The color sections' swatches fill a side card. */
  .ys-side-card yc-swatches {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
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
