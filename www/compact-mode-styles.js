/**
 * Compact Mode Styles (DEPRECATED - Grid Layout Only)
 *
 * DEPRECATED: For new compact layouts, use compact-layout-utils.js instead.
 * This file is maintained only for:
 * - Palette card grid compact mode (.palette-gallery-compact, .palette-compact-item)
 * - Legacy pixel art grid compact mode (being phased out)
 *
 * New implementations should use compact-layout-utils.js which provides:
 * - Modern inline-flex layout
 * - Better responsive design
 * - Consistent spacing with card-size-multiplier
 *
 * Usage (legacy only):
 *   import { compactModeStyles } from './compact-mode-styles.js';
 *   ${compactModeStyles}
 */

export const compactModeStyles = `
  /* LEGACY: Gallery Compact Mode - Responsive Grid Layout */
  /* Note: This grid-based layout is being replaced by inline-flex in compact-layout-utils.js */
  .pixelart-gallery-compact,
  .palette-gallery-compact {
    display: grid;
    grid-template-columns: repeat(
      auto-fill,
      minmax(calc(280px * var(--preview-size-percent, 100%) / 100), 1fr)
    );
    gap: 0;
    margin-bottom: 16px;
  }

  /* LEGACY: Compact Item Container (Grid-based) */
  .pixelart-compact-item,
  .palette-compact-item {
    background: transparent;
    border: 1px solid #e1e4e8;
    padding: calc(12px * var(--preview-size-percent, 100%) / 100)
      calc(10px * var(--preview-size-percent, 100%) / 100);
    display: flex;
    align-items: center;
    gap: calc(12px * var(--preview-size-percent, 100%) / 100);
    position: relative;
    cursor: pointer;
    transition: background 0.15s ease, padding 0.2s ease;
    box-sizing: border-box;
  }

  .pixelart-compact-item:hover,
  .palette-compact-item:hover {
    background: var(--secondary-background-color, #f6f8fa);
  }

  /* LEGACY: Compact Content Layout */
  .pixelart-compact-item .compact-content,
  .palette-compact-item .compact-content {
    display: flex;
    gap: calc(12px * var(--preview-size-percent, 100%) / 100);
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  /* LEGACY: Preview Container */
  .pixelart-compact-item .compact-preview,
  .palette-compact-item .compact-preview {
    flex-shrink: 0;
  }

  /* LEGACY: Info Section (Title + Metadata) */
  .pixelart-compact-item .compact-info,
  .palette-compact-item .compact-info {
    display: flex;
    flex-direction: column;
    gap: calc(6px * var(--preview-size-percent, 100%) / 100);
    flex: 1;
    min-width: 0;
  }

  /* LEGACY: Title Styling */
  .pixelart-compact-item .compact-title,
  .palette-compact-item .compact-title {
    font-weight: 500;
    color: #24292f;
    font-size: calc(0.95em * var(--preview-size-percent, 100%) / 100);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: fit-content;
    margin: 0 auto;
  }

  /* LEGACY: Metadata Text */
  .pixelart-compact-item .compact-meta,
  .palette-compact-item .compact-meta {
    font-size: calc(0.8em * var(--preview-size-percent, 100%) / 100);
    color: #57606a;
    white-space: nowrap;
  }

  /* LEGACY: Clickable Title Interaction */
  .pixelart-compact-item .compact-title.clickable,
  .palette-compact-item .compact-title.clickable {
    cursor: pointer;
    transition: color 0.2s ease;
  }

  .pixelart-compact-item .compact-title.clickable:hover,
  .palette-compact-item .compact-title.clickable:hover {
    color: var(--primary-color, #03a9f4);
    text-decoration: underline;
  }

  /* LEGACY: Delete Button in Grid Compact Mode */
  .pixelart-compact-item .delete-btn-cross,
  .palette-compact-item .delete-btn-cross {
    position: relative !important;
    flex-shrink: 0;
    margin-left: auto;
    top: auto !important;
    right: auto !important;
  }
`;
