// Stylesheet text of the palette card.
import { cardLayoutStyles } from "./card-layout-utils.js";
import { compactModeStyles } from "./compact-mode-styles.js";
import {
  deleteButtonStyles,
  deleteButtonPositionStyles,
} from "./delete-button-styles.js";
import { exportImportButtonStyles } from "./action-button-utils.js";
import { carouselStyles } from "./carousel-utils.js";
import { gridModeStyles } from "./grid-mode-utils.js";
import { getAlbumStyles } from "./album-view-coverflow.js";
import { paginationStyles } from "./pagination-utils.js";

export function buildPaletteCardStyles(config, allowTitleEdit) {
  return `
      ${cardLayoutStyles}
      /* Shared Compact Mode Styles */
      ${compactModeStyles}

      /* Shared Delete Button Styles */
      ${deleteButtonStyles}
      ${deleteButtonPositionStyles}

      /* Shared Export/Import Button Styles */
      ${exportImportButtonStyles}

      /* Shared Carousel Styles */
      ${carouselStyles}

      /* Shared Grid Mode Styles */
      ${gridModeStyles}

      :host {
        --card-size-multiplier: ${(config.card_size || 50) / 100};
        --rounded-cards-radius: ${(() => {
          const v = config.rounded_cards;
          if (v === undefined || v === true || v === "round") return 16;
          if (v === false || v === "square") return 0;
          if (v === "rounded") return 4;
          return typeof v === "number" ? v : parseInt(v, 10) || 16;
        })()}px;
        overflow: visible !important;
      }
      ha-card {
        overflow: visible !important;
      }
      .card-title { font-size: 1.3em; font-weight: bold; margin-bottom: 18px; margin-top: 2px; color: var(--primary-text-color, #222); cursor: ${
        allowTitleEdit ? "pointer" : "default"
      }; }
      .palette-row {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        margin-inline: auto;
        background: var(--secondary-background-color, #fafbfc);
        border: 1.5px solid var(--divider-color, #d0d7de);
        border-radius: var(--rounded-cards-radius, 16px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        padding: 6px 12px;
        position: relative;
        width: 100%;
        max-width: calc(100% * var(--card-size-multiplier) * 2);
        box-sizing: border-box;
        transition: max-width 0.2s ease;
      }
      .palette-title {
        font-weight: 500;
        color: var(--primary-text-color, #333);
        cursor: default;
        margin-bottom: 4px;
      }
      .title-text {
        display: inline-block;
/*           padding: 2px 4px;
        border-radius: 4px; */
      }
      .title-text.editable {
        cursor: pointer;
        transition: opacity 0.2s ease;
      }
      .title-text.editable:hover {
        opacity: 0.8;
      }
      .palette-colors {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        justify-content: flex-start;
/*           margin-bottom: 8px; */
      }
      .palette-color {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        box-shadow: 0 0 0 1px var(--divider-color, #ccc);
      }
      /* Swatch Styles */
      .square-swatch {
        width: calc(28px * var(--card-size-multiplier));
        height: calc(28px * var(--card-size-multiplier));
        border-radius: 6px;
        display: inline-block;
        box-shadow: 0 0 0 1px var(--divider-color, #ddd);
        margin: 1px;
        transition: width 0.2s ease, height 0.2s ease;
      }
      .round-swatch {
        width: calc(28px * var(--card-size-multiplier));
        height: calc(28px * var(--card-size-multiplier));
        border-radius: 50%;
        display: inline-block;
        box-shadow: 0 0 0 1px var(--divider-color, #ddd);
        margin: 1px;
        transition: width 0.2s ease, height 0.2s ease;
      }
      .gradient-bar {
        width: 100%;
        height: calc(28px * var(--card-size-multiplier));
        border-radius: 14px;
        box-shadow: 0 0 0 1px var(--divider-color, #ddd);
        margin: 2px 0;
        transition: height 0.2s ease;
      }
      .stripes-bar {
        width: 100%;
        height: calc(28px * var(--card-size-multiplier));
        border-radius: 6px;
        box-shadow: 0 0 0 1px var(--divider-color, #ddd);
        margin: 2px 0;
        transition: height 0.2s ease;
      }
      /* Gradient background styles - Modern and cool design */
      .palette-row[style*="background: linear-gradient"] {
        color: var(--text-primary-color, #fff);
        border: none !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.2) !important;
        border-radius: 16px !important;
        overflow: hidden;
        position: relative;
      }
      .palette-row[style*="background: linear-gradient"]::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 100%);
        pointer-events: none;
        z-index: 1;
      }
      .palette-row[style*="background: linear-gradient"]:hover {
        box-shadow: 0 6px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.3) !important;
        transform: translateY(-2px);
        background-color: transparent !important;
      }
      .palette-row[style*="background: linear-gradient"] .palette-title {
        color: var(--text-primary-color, #fff);
        font-weight: 700;
        font-size: 1.1em;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        letter-spacing: 0.3px;
        position: relative;
        z-index: 2;
      }
      .palette-row[style*="background: linear-gradient"] .list-color-count {
        color: rgba(255,255,255,0.95);
        font-size: 0.85em;
        font-weight: 500;
        text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        margin-left: 12px;
        background: rgba(0,0,0,0.15);
        padding: 3px 10px;
        border-radius: 12px;
        backdrop-filter: blur(4px);
        position: relative;
        z-index: 2;
      }
      .palette-row[style*="background: linear-gradient"] .remove-btn {
        background: rgba(255,255,255,0.25);
        backdrop-filter: blur(8px);
        color: var(--text-primary-color, #fff);
        font-weight: 600;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 8px;
        padding: 4px 12px;
        text-shadow: 0 1px 2px rgba(0,0,0,0.2);
        transition: all 0.2s ease;
        position: relative;
        z-index: 2;
      }
      .palette-row[style*="background: linear-gradient"] .remove-btn:hover {
        background: rgba(255,255,255,0.35);
        border-color: rgba(255,255,255,0.5);
        transform: scale(1.05);
      }
      .palette-row[style*="background: linear-gradient"] .remove-btn-cross {
        color: var(--text-primary-color, #fff);
        background: rgba(0,0,0,0.2);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 50%;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.3em;
        font-weight: 700;
        text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        transition: all 0.2s ease;
        position: absolute;
        /* z-index: 1000; */
        pointer-events: auto;
      }
      /* Style variants inherited from delete-button-styles.js */
      .palette-row[style*="background: linear-gradient"] .remove-btn-cross:hover {
        background: rgba(255,255,255,0.25);
        border-color: rgba(255,255,255,0.4);
        transform: scale(1.1);
        color: color-mix(in srgb, var(--error-color, #f44336) 15%, var(--text-primary-color, #fff));
      }
      .palette-row {
        cursor: pointer;
        transition: background-color 0.1s ease, box-shadow 0.1s ease;
      }
      .palette-row:hover {
        background-color: var(--secondary-background-color, #f0f4f8);
        box-shadow: 0 3px 12px rgba(0,0,0,0.08);
      }
      .palette-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 4px;
      }
      .remove-btn { background: color-mix(in srgb, var(--error-color, #db4437) 15%, var(--card-background-color, #fff)); border: none; border-radius: 6px; color: var(--error-color, #db4437); padding: 6px 18px; cursor: pointer; font-size: 1em; font-weight: 500; transition: background 0.2s; }
      .remove-btn:hover { background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff)); }
      /* Style variants inherited from delete-button-styles.js */

      /* ── Palette list & carousel: remove button position ── */
      .palette-list-remove {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 10;
      }
      .palette-list-remove.btn-pos-inside {
        top: 6px;
        right: 6px;
      }
      .palette-list-remove.btn-pos-outside {
        top: -8px;
        right: -8px;
      }
      .palette-list-remove.dot-style.btn-pos-outside {
        top: -4px;
        right: -4px;
      }
      .palette-list-remove.btn-side-left {
        right: auto !important;
        left: 8px;
      }
      .palette-list-remove.btn-pos-inside.btn-side-left {
        left: 6px;
      }
      .palette-list-remove.btn-pos-outside.btn-side-left {
        left: -8px;
      }
      .palette-list-remove.dot-style.btn-pos-outside.btn-side-left {
        left: -4px;
      }
      /* Allow outside buttons to overflow list item bounds */
      .palette-list-item:has(.btn-pos-outside) {
        overflow: visible !important;
      }

      .palette-remove-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 10;
      }
      .palette-remove-btn.btn-pos-inside {
        top: 6px;
        right: 6px;
      }
      .palette-remove-btn.btn-pos-outside {
        top: -8px;
        right: -8px;
      }
      .palette-remove-btn.dot-style.btn-pos-outside {
        top: -4px;
        right: -4px;
      }
      .palette-remove-btn.btn-side-left {
        right: auto !important;
        left: 8px;
      }
      .palette-remove-btn.btn-pos-inside.btn-side-left {
        left: 6px;
      }
      .palette-remove-btn.btn-pos-outside.btn-side-left {
        left: -8px;
      }
      .palette-remove-btn.dot-style.btn-pos-outside.btn-side-left {
        left: -4px;
      }

      /* Display Mode Styles */
      /* Palette-specific grid styles (base grid styles from grid-mode-utils.js) */
      .grid-item .palette-colors {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-start;
      }

      /* Compact Mode - List with Dividers */
      .palettes-compact {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(250px * var(--card-size-multiplier)), 1fr));
        gap: 0;
        margin-bottom: 16px;
        /* border: 1px solid #e1e4e8; */
      }
      .palette-compact-item {
        background: transparent;
        border: none;
        border: 1px solid var(--divider-color, #e1e4e8);
        padding: calc(10px * var(--card-size-multiplier)) calc(8px * var(--card-size-multiplier));
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: relative;
        cursor: pointer;
        transition: background 0.15s, padding 0.2s ease;
        box-sizing: border-box;
      }
      .palette-compact-item:hover {
        background: var(--secondary-background-color, #f6f8fa);
      }
      .palette-compact-item .compact-info {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        align-items: flex-start;
        width: 100%;
      }
      .palette-compact-item .compact-header {
        display: flex;
        align-items: baseline;
        gap: 8px;
        width: 100%;
      }
      .palette-compact-item .compact-name {
        font-weight: 500;
        color: var(--primary-text-color, #24292f);
        font-size: 0.95em;
      }
      .palette-compact-item .compact-meta {
        font-size: 0.8em;
        color: var(--secondary-text-color, #57606a);
        white-space: nowrap;
      }
      .palette-compact-item .compact-colors-display {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        margin-top: 2px;
        width: 100%;
        justify-content: center;
      }
      .palette-compact-item .compact-more {
        font-size: 0.75em;
        color: var(--secondary-text-color, #57606a);
        margin-left: 4px;
      }
      /* Legacy compact swatches (not used anymore but kept for compatibility) */
      .palette-compact-item .compact-colors {
        display: flex;
        gap: 5px;
        align-items: center;
      }
      .palette-compact-item .compact-swatch {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1.5px solid var(--divider-color, rgba(0,0,0,0.1));
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      /* Compact gradient mode */
      .palette-compact-gradient {
        position: relative;
        padding: calc(12px * var(--card-size-multiplier)) calc(12px * var(--card-size-multiplier)) !important;
        min-height: calc(60px * var(--card-size-multiplier));
        border: none !important;
        transition: transform 0.15s, box-shadow 0.15s, padding 0.2s ease, min-height 0.2s ease;
      }
      .palette-compact-gradient:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      }
      .palette-compact-gradient .compact-gradient-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        pointer-events: none;
      }
      .palette-compact-gradient .compact-name {
        color: var(--text-primary-color, #fff);
        text-shadow: 1px 1px 3px rgba(0,0,0,0.5);
        font-weight: 600;
        font-size: 1em;
      }
      .palette-compact-gradient .compact-meta {
        color: rgba(255,255,255,0.95);
        font-size: 0.8em;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.4);
      }
      .palette-compact-item .remove-btn {
        padding: 4px 10px;
        font-size: 0.7em;
      }
      .palette-compact-item .remove-btn-cross {
        background: transparent;
        border: none;
        border-radius: 50%;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--error-color, #d73a49);
        font-size: 1.4em;
        font-weight: bold;
        transition: opacity 0.15s, background 0.15s;
        flex-shrink: 0;
        position: absolute;
        top: 8px;
        right: 8px;
      }
      .palette-compact-item .remove-btn-cross:hover {
        opacity: 1;
        background: rgba(215, 58, 73, 0.1);
      }
      .palette-compact-gradient .remove-btn-cross {
        color: rgba(255, 255, 255, 0.9);
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        position: absolute;
        /* z-index: 1000; */
        pointer-events: auto;
        background: rgba(0,0,0,0.2);
        border: 1px solid rgba(255,255,255,0.25);
      }
      /* Style variants inherited from delete-button-styles.js */
      .palette-compact-gradient .remove-btn-cross:hover {
        background: rgba(0, 0, 0, 0.25);
        border-color: rgba(0,0,0,0.4);
        color: var(--text-primary-color, #fff);
        opacity: 1;
      }

      /* Album Mode - Cover Flow Style - Use shared styles */
      ${getAlbumStyles(config, "palettes")}

      /* Album card size — driven by the "Display Card Size" slider, aligned
       * with the pixel-art album feature. getAlbumStyles() (shared module)
       * already scales the width, but this rule is emitted from the palette
       * card's own (always-fresh) style block so the slider takes effect
       * immediately and independently of the shared module's cache state.
       * Width scales from the 240px baseline (100%), clamped 30–200%;
       * margin-left is half the width to keep the card centred in the
       * coverflow. Same formula as the pixel-art album. */
      .palettes-album-item {
        width: ${Math.round(
          (240 * Math.max(30, Math.min(200, config.card_size || 50))) /
            100,
        )}px !important;
        margin-left: -${Math.round(
          (120 * Math.max(30, Math.min(200, config.card_size || 50))) /
            100,
        )}px !important;
      }

      /* Additional palette-specific album styles */
      .palettes-album-item .album-gradient {
        height: 55%;
        min-height: 125px;
        position: relative;
        transition: height 0.2s ease;
        flex-shrink: 1;
        border-radius: ${(() => {
          const v = config.rounded_cards;
          const r =
            v === undefined || v === true || v === "round"
              ? 16
              : v === false || v === "square"
                ? 0
                : v === "rounded"
                  ? 4
                  : typeof v === "number"
                    ? v
                    : parseInt(v, 10) || 16;
          return `${r}px ${r}px 0 0`;
        })()};
        overflow: hidden;
      }
      .palettes-album-item .album-content {
        padding: max(4px, 5%) max(4px, 4%);
        min-height: 40px;
        background: var(--card-background-color, white);
        border-radius: ${(() => {
          const v = config.rounded_cards;
          const r =
            v === undefined || v === true || v === "round"
              ? 16
              : v === false || v === "square"
                ? 0
                : v === "rounded"
                  ? 4
                  : typeof v === "number"
                    ? v
                    : parseInt(v, 10) || 16;
          return `0 0 ${r}px ${r}px`;
        })()};
        transition: padding 0.2s ease;
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        box-sizing: border-box;
      }
      
      /* Album mode - non-gradient swatch styles */
      .palettes-album-item .album-content-container {
        width: 100%;
        height: 100%;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-sizing: border-box;
        background: var(--card-background-color, white);
      }
      
      .palettes-album-item .album-title {
        font-size: 0.9em;
        font-weight: 600;
        color: var(--primary-text-color, #333);
        text-align: center;
        margin-bottom: 4px;
      }
      
      .palettes-album-item .album-preview {
        flex: 1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px;
      }
      
      .palettes-album-item .album-preview .square-swatch,
      .palettes-album-item .album-preview .round-swatch {
        width: 28px;
        height: 28px;
        margin: 2px;
        flex-shrink: 0;
      }
      
      .palettes-album-item .album-preview .gradient-bar,
      .palettes-album-item .album-preview .stripes-bar {
        width: calc(100% - 8px);
        height: 24px;
        margin: 3px 0;
      }
      
      .palettes-album-item .album-meta {
        font-size: 0.75em;
        color: var(--secondary-text-color, #666);
        text-align: center;
      }
      
      /* Carousel Mode Specific Styles */
      .palette-item-carousel {
        display: flex;
        flex-direction: column;
        /* min-height: 250px; */
        position: relative;
        cursor: pointer;
      }
      
      .palette-item-carousel .palette-title {
        font-size: 1.2em;
        font-weight: 600;
        text-align: center;
        margin-bottom: calc(20px * var(--card-size-multiplier));
        color: var(--primary-text-color, #333);
        transition: margin-bottom 0.2s ease;
      }
      
      .carousel-content-card .palette-remove-btn {
        position: absolute !important;
        top: -10px !important;
        right: -10px !important;
        z-index: 100 !important;
        margin: 0 !important;
        pointer-events: auto !important;
      }
      /* Make palette-item-carousel static so button positions relative to carousel-content-card */
      .carousel-content-card .palette-item-carousel {
        position: static;
      }
      .carousel-content-card .palette-remove-btn.btn-pos-inside {
        top: 12px !important;
        right: 12px !important;
      }
      .carousel-content-card .palette-remove-btn.btn-side-left {
        right: auto !important;
        left: -10px !important;
      }
      .carousel-content-card .palette-remove-btn.btn-pos-inside.btn-side-left {
        left: 12px !important;
      }
      .carousel-content-card .palette-remove-btn.dot-style {
        top: -4px !important;
        right: -4px !important;
      }
      .carousel-content-card .palette-remove-btn.dot-style.btn-pos-inside {
        top: 4px !important;
        right: 4px !important;
      }
      .carousel-content-card .palette-remove-btn.dot-style.btn-side-left {
        right: auto !important;
        left: -4px !important;
      }
      .carousel-content-card .palette-remove-btn.dot-style.btn-pos-inside.btn-side-left {
        left: 4px !important;
      }
      
      .palette-item-carousel .palette-colors {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: calc(8px * var(--card-size-multiplier));
        flex: 1;
        align-items: center;
        transition: gap 0.2s ease;
      }
      
      /* Carousel swatch styles - let specific classes control border-radius */
      .palette-item-carousel .square-swatch,
      .palette-item-carousel .round-swatch {
        width: calc(40px * var(--card-size-multiplier));
        height: calc(40px * var(--card-size-multiplier));
        box-shadow: 0 2px 4px rgba(0,0,0,0.1), 0 0 0 1px var(--divider-color, #ddd);
        transition: width 0.2s ease, height 0.2s ease;
      }
      
      .palette-item-carousel .square-swatch {
        border-radius: calc(8px * var(--card-size-multiplier));
      }
      
      .palette-item-carousel .round-swatch {
        border-radius: 50%;
      }
      
      .palette-item-carousel .gradient-bar,
      .palette-item-carousel .stripes-bar {
        width: 100%;
        height: calc(40px * var(--card-size-multiplier));
        border-radius: calc(8px * var(--card-size-multiplier));
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: height 0.2s ease, border-radius 0.2s ease;
      }
      
      /* Gradient background support for carousel - applied to container */
      .carousel-content-card.gradient-bg-mode {
        background: var(--carousel-gradient-bg);
        border: none !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
        overflow: hidden;
      }
      
      .carousel-content-card.gradient-bg-mode .palette-title {
        color: var(--text-primary-color, #fff);
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        font-weight: 700;
      }
      
      .carousel-content-card.gradient-bg-mode .color-count {
        color: rgba(255,255,255,0.95);
        text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        border-top-color: rgba(255,255,255,0.3);
      }
      
      .carousel-content-card.gradient-bg-mode .gradient-bg-marker {
        display: none;
      }
      
      .palette-item-carousel .color-count {
        text-align: center;
        font-size: calc(0.85em * var(--card-size-multiplier));
        color: var(--secondary-text-color, #666);
        margin-top: calc(16px * var(--card-size-multiplier));
        padding-top: calc(12px * var(--card-size-multiplier));
        border-top: 1px solid var(--divider-color, #eee);
        transition: font-size 0.2s ease, margin-top 0.2s ease, padding-top 0.2s ease;
      }

      /* PAGINATION STYLES */
      ${paginationStyles}

      /* Item card border for dark mode visibility */
      .item-card-border .gallery-item {
        border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
      }
      .item-card-border .carousel-content-card {
        border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
      }
      .item-card-border .palettes-album-item {
        border: 1px solid var(--divider-color, rgba(255,255,255,0.15));
      }
  `;
}
