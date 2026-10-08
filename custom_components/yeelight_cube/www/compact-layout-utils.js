/**
 * Compact layout styles: the inline, minimal item rows (preview, info and
 * an optional delete button) of the Color List and Draw cards' color
 * lists. Cards include compactLayoutStyles in their styles.
 */

export const compactLayoutStyles = `
  /* COMPACT LAYOUT - Minimal inline design */
  .compact-item {
    display: inline-flex;
    align-items: center;
    
    padding: calc(4.29px * var(--card-size-multiplier, 0.7)) calc(8.57px * var(--card-size-multiplier, 0.7));
    border-radius: calc(8.57px * var(--card-size-multiplier, 0.7));
    background: var(--secondary-background-color, #f8f9fa);
    transition: all 0.2s;
    cursor: grab;
    width: fit-content;
    min-width: 0;
    position: relative;
    justify-content: flex-start;
  }
  
  .compact-item:hover {
    background: color-mix(in srgb, var(--primary-text-color, #000) 8%, var(--secondary-background-color, #e9ecef));
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  
  .compact-item.dragging {
    opacity: 0.5;
  }
  
  /* Compact Preview - Fixed size preview area */
  .compact-preview {
    flex-shrink: 0;
  }
  
  /* Compact Info - Text content area */
  .compact-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 80px !important;
    max-width: none !important;
    flex: 0 0 auto;
    justify-content: center;
    align-items: center;
  }
  
  /* Delete Button Positioning in Compact Mode */
  .compact-item .delete-btn-cross {
    flex-shrink: 0;
    position: relative !important; /* Relative so pseudo-elements position correctly inside */
    top: auto !important;
    right: auto !important;
    left: auto !important;
    bottom: auto !important;
    margin-left: calc(12px * var(--card-size-multiplier, 0.7));
    margin-top: 0 !important;
    margin-right: 0 !important;
    margin-bottom: 0 !important;
    width: 28px !important;
    height: 28px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  
  /* Outside: absolute top-right corner */
  .compact-item .delete-btn-cross.btn-pos-outside {
    position: absolute !important;
    top: -8px !important;
    right: -8px !important;
    left: auto !important;
    margin-left: 0 !important;
    z-index: 10;
  }
  
  /* Dot-style in compact mode: just set size, let position classes handle placement */
  .compact-item .delete-btn-cross.dot-style {
    width: 14px !important;
    height: 14px !important;
  }
  /* Dot outside: absolute corner */
  .compact-item .delete-btn-cross.dot-style.btn-pos-outside {
    position: absolute !important;
    top: -4px !important;
    right: -4px !important;
    left: auto !important;
    margin-left: 0 !important;
  }
  
  /* Extra padding when button protrudes outside */
  .compact-item:has(.btn-pos-outside) {
    padding-top: calc(10px * var(--card-size-multiplier, 0.7));
    padding-right: calc(10px * var(--card-size-multiplier, 0.7));
  }
  
  /* ---- Left-side button overrides ---- */
  /* Inside (flex child): move to start of row */
  .compact-item .delete-btn-cross.btn-side-left {
    order: -1;
    margin-left: 0 !important;
    margin-right: calc(12px * var(--card-size-multiplier, 0.7));
  }
  /* Outside: top-left corner instead of top-right */
  .compact-item .delete-btn-cross.btn-pos-outside.btn-side-left {
    right: auto !important;
    left: -8px !important;
    margin-right: 0 !important;
  }
  /* Dot outside top-left */
  .compact-item .delete-btn-cross.dot-style.btn-pos-outside.btn-side-left {
    right: auto !important;
    left: -4px !important;
  }
  /* Swap padding when outside-left */
  .compact-item:has(.btn-pos-outside.btn-side-left) {
    padding-right: 0;
    padding-left: calc(10px * var(--card-size-multiplier, 0.7));
  }
  
  /* Container for multiple compact items */
  .compact-container {
    display: flex;
    flex-wrap: wrap;
    gap: calc(11.43px * var(--card-size-multiplier, 0.7));
    margin-bottom: 16px;
    justify-content: space-between;
  }
  
  .compact-title {
    font-weight: 500;
    color: var(--primary-text-color, #24292f);
    font-size: calc(0.95em * var(--card-size-multiplier, 0.7));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .compact-title.clickable {
    cursor: pointer;
    transition: color 0.2s ease;
  }
  
  .compact-title.clickable:hover {
    color: var(--primary-color, #03a9f4);
    text-decoration: underline;
  }
`;


