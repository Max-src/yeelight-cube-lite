// Stylesheet of the gradient card (adopted once per shadow root by LitElement).
import { cardLayoutStyles } from "./card-layout-utils.js";
import { collectionGalleryStyles } from "./collection-gallery.js";
import { tabBarStyles } from "./tab-bar.js";
import { getCapsuleCSS } from "./capsule-slider-utils.js";

// Card stylesheet (static; adopted once per shadow root by LitElement).
export const GRADIENT_CARD_CSS = `
        ${cardLayoutStyles}
        
        /* Header rotary styling - sized for 88px height */
        .header-rotary {
          flex-shrink: 0;
        }
        
        .header-rotary .wheel-container,
        .header-rotary .rect-container,
        .header-rotary .matrix-preview-container,
        .header-rotary .compass-container {
          margin: 0;
          gap: 4px;
        }
        
        .header-rotary svg {
          max-width: 88px !important;
          max-height: 88px !important;
          width: 88px !important;
          height: 88px !important;
        }
        
        .header-rotary .color-rect {
          /* Remove fixed sizing - let inline styles handle dynamic sizing */
          aspect-ratio: auto !important;
        }
        
        /* Force shapes to fill container in header mode */
        .header-rotary svg circle,
        .header-rotary svg rect,
        .header-rotary svg polygon,
        .header-rotary svg path {
          transform-origin: center;
        }
        
        /* Override percentage-based sizing in header mode */
        .header-rotary .color-wheel,
        .header-rotary #angle-preview {
          width: 88px !important;
          height: 88px !important;
        }
        
        .card-content {
          max-width: 480px;
          margin: 0 auto;
        }
        #color-list { position: relative; }
        .action-row {
          display: flex;
          gap: 16px;
          margin-top: 16px;
          justify-content: stretch;
          width: 100%;
        }
        .add-btn {
          background: color-mix(in srgb, var(--success-color, #43a047) 15%, var(--card-background-color, #fff));
          border: none;
          border-radius: 8px;
          color: var(--success-color, #43a047);
          padding: 10px 0;
          cursor: pointer;
          font-size: 1em;
          font-weight: 500;
          flex: 1 1 0;
          transition: background 0.2s;
          width: 100%;
        }
        .add-btn:hover { background: color-mix(in srgb, var(--success-color, #43a047) 25%, var(--card-background-color, #fff)); }
        .save-btn {
          background: color-mix(in srgb, var(--primary-color) 15%, var(--card-background-color, #fff));
          border: none;
          border-radius: 8px;
          color: var(--primary-color, #0077cc);
          padding: 10px 0;
          cursor: pointer;
          font-size: 1em;
          font-weight: 500;
          flex: 1 1 0;
          transition: background 0.2s;
          width: 100%;
        }
        .save-btn:hover { background: color-mix(in srgb, var(--primary-color) 25%, var(--card-background-color, #fff)); }
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

        /* Compass center angle display */
        .compass-center-input {
          width: 100%;
          height: 100%;
          border: 1px solid var(--divider-color, rgba(128,128,128,0.3));
          border-radius: 6px;
          background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent);
          color: var(--primary-text-color, #333);
          font-size: 12px;
          font-weight: 700;
          text-align: center;
          box-sizing: border-box;
          padding: 0;
          -moz-appearance: textfield;
          outline: none;
        }
        .compass-center-input::-webkit-outer-spin-button,
        .compass-center-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .compass-center-input[readonly] {
          cursor: default;
        }
        .rotary-overlay-value {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 2;
        }
        .rotary-overlay-value input {
          width: 80px;
          height: 34px;
          border: 1px solid var(--divider-color, rgba(128,128,128,0.3));
          border-radius: 8px;
          background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent);
          color: var(--primary-text-color, #333);
          font-size: 16px;
          font-weight: 700;
          text-align: center;
          box-sizing: border-box;
          padding: 0;
          -moz-appearance: textfield;
          outline: none;
        }
        .rotary-overlay-value input::-webkit-outer-spin-button,
        .rotary-overlay-value input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .rotary-overlay-value input[readonly] {
          cursor: default;
        }
        .matrix-angle-value {
          display: flex;
          justify-content: center;
          margin-top: 6px;
        }
        .matrix-angle-value input {
          width: 80px;
          height: 34px;
          border: 1px solid var(--divider-color, rgba(128,128,128,0.3));
          border-radius: 8px;
          background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent);
          color: var(--primary-text-color, #333);
          font-size: 16px;
          font-weight: 700;
          text-align: center;
          box-sizing: border-box;
          padding: 0;
          -moz-appearance: textfield;
          outline: none;
        }
        .matrix-angle-value input::-webkit-outer-spin-button,
        .matrix-angle-value input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .matrix-angle-value input[readonly] {
          cursor: default;
        }
        .capsule-angle-slot {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .capsule-angle-input {
          width: 52px;
          height: 26px;
          border: 1px solid var(--divider-color, rgba(128,128,128,0.3));
          border-radius: 5px;
          background: transparent;
          color: var(--primary-text-color, #333);
          font-size: 13px;
          font-weight: 700;
          text-align: center;
          box-sizing: border-box;
          padding: 0;
          -moz-appearance: textfield;
          outline: none;
        }
        .capsule-angle-input::-webkit-outer-spin-button,
        .capsule-angle-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .capsule-angle-input[readonly] {
          cursor: default;
        }
        .capsule-value-under {
          display: flex;
          justify-content: center;
          padding: 8px 0;
        }
        .snap-tick {
          position: absolute;
          background: var(--secondary-text-color, #999);
          pointer-events: none;
          z-index: 1;
        }
        .snap-tick-top, .snap-tick-bottom {
          width: 6px;
          height: 3px;
          transform: translateX(-50%);
        }
        .snap-tick-top { top: 0; border-radius: 0 0 3px 3px; }
        .snap-tick-bottom { bottom: 0; border-radius: 3px 3px 0 0; }
        .snap-tick-left, .snap-tick-right {
          width: 3px;
          height: 6px;
          transform: translateY(-50%);
        }
        .snap-tick-left { left: 0; border-radius: 0 3px 3px 0; }
        .snap-tick-right { right: 0; border-radius: 3px 0 0 3px; }
        .snap-tick-corner {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }
        .capsule-snap-ticks {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 1;
        }
        .capsule-snap-tick {
          position: absolute;
          top: 50%;
          width: 5px;
          height: 5px;
          transform: translate(-50%, -50%);
          background: var(--primary-text-color, #333);
          border-radius: 50%;
          opacity: 0.35;
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
          overflow: visible;
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
        .color-wheel, .rect-container, .matrix-preview-container, .compass-container {
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
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

        /* Default style - simple checkbox */
        .panel-toggle.default {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .panel-toggle.default input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        .panel-toggle.default label {
          font-weight: 500;
          cursor: pointer;
        }

        /* Toggle Switch style */
        .panel-toggle.switch {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .panel-toggle.switch .switch-container {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .panel-toggle.switch input[type="checkbox"] {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .panel-toggle.switch .switch-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--divider-color, #ccc);
          transition: 0.3s;
          border-radius: 24px;
        }
        .panel-toggle.switch .switch-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: var(--card-background-color, white);
          transition: 0.3s;
          border-radius: 50%;
        }
        .panel-toggle.switch input:checked + .switch-slider {
          background-color: var(--primary-color, #2196F3);
        }
        .panel-toggle.switch input:checked + .switch-slider:before {
          transform: translateX(20px);
        }
        .panel-toggle.switch label {
          font-weight: 500;
          cursor: pointer;
        }

        /* Card style - button-like appearance */
        .panel-toggle.card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border: 2px solid var(--divider-color, #e1e4e8);
          border-radius: 8px;
          background: var(--secondary-background-color, #f6f8fa);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .panel-toggle.card:hover {
          border-color: var(--primary-color, #0969da);
          background: var(--secondary-background-color, #f1f3f4);
        }
        .panel-toggle.card.active {
          border-color: var(--primary-color, #0969da);
          background: color-mix(in srgb, var(--primary-color) 20%, var(--card-background-color, #fff));
        }
        .panel-toggle.card input[type="checkbox"] {
          display: none;
        }
        .panel-toggle.card label {
          font-weight: 500;
          cursor: pointer;
          margin: 0;
        }
        .panel-toggle.card .card-indicator {
          width: 20px;
          height: 20px;
          border: 2px solid var(--secondary-text-color, #6b7280);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        .panel-toggle.card.active .card-indicator {
          background: var(--primary-color, #0969da);
          border-color: var(--primary-color, #0969da);
          color: var(--text-primary-color, #fff);
        }
        .panel-toggle.card .card-indicator::after {
          content: "✓";
          font-size: 12px;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .panel-toggle.card.active .card-indicator::after {
          opacity: 1;
        }


        /* Chip style — single floating chip that toggles */
        .panel-toggle.chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 14px 6px 10px;
          border: 1.5px solid var(--divider-color, #d0d7de);
          border-radius: 20px;
          cursor: pointer;
          background: transparent;
          color: var(--secondary-text-color, #6b7280);
          font-size: 0.85em;
          font-weight: 500;
          transition: all 0.2s ease;
          user-select: none;
        }
        .panel-toggle.chip[data-shape="square"] { border-radius: 0; }
        .panel-toggle.chip[data-shape="rounded"] { border-radius: 8px; }
        .panel-toggle.chip:hover {
          border-color: var(--primary-color, #0969da);
          color: var(--primary-color, #0969da);
        }
        .panel-toggle.chip.active {
          background: var(--primary-color, #0969da);
          border-color: var(--primary-color, #0969da);
          color: var(--text-primary-color, #fff);
        }
        .panel-toggle.chip .chip-dot {
          width: 8px;
          height: 8px;
          border-radius: 2px;
          border: 1.5px solid currentColor;
          flex-shrink: 0;
          transition: all 0.2s;
        }
        .panel-toggle.chip.active .chip-dot {
          background: currentColor;
        }

        /* Minimal style — shape-aware dot/check indicator + text toggle */
        .panel-toggle.minimal {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          user-select: none;
          padding: 4px 0;
        }
        .panel-toggle.minimal .minimal-indicator {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid var(--disabled-text-color, #ccc);
          flex-shrink: 0;
          transition: all 0.2s;
          position: relative;
          box-sizing: border-box;
        }
        /* shape variants for the indicator */
        .panel-toggle.minimal[data-shape="rounded"] .minimal-indicator { border-radius: 4px; }
        .panel-toggle.minimal[data-shape="square"] .minimal-indicator { border-radius: 0; }
        .panel-toggle.minimal.active .minimal-indicator {
          border-color: var(--primary-color, #0969da);
          background: var(--primary-color, #0969da);
        }
        /* round (radio-dot) inner mark */
        .panel-toggle.minimal.active:not([data-shape]) .minimal-indicator::after,
        .panel-toggle.minimal.active[data-shape="round"] .minimal-indicator::after {
          content: "";
          position: absolute;
          top: 3px; left: 3px;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--text-primary-color, #fff);
        }
        /* square (checkbox) inner check */
        .panel-toggle.minimal.active[data-shape="square"] .minimal-indicator::after {
          content: "✓";
          position: absolute;
          top: -2px; left: 1px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-primary-color, #fff);
          line-height: 1;
        }
        .panel-toggle.minimal .minimal-text {
          font-size: 0.85em;
          font-weight: 500;
          color: var(--secondary-text-color, #888);
          transition: color 0.2s;
        }
        .panel-toggle.minimal.active .minimal-text {
          color: var(--primary-color, #0969da);
          font-weight: 600;
        }
        .panel-toggle.minimal:hover .minimal-text {
          color: var(--primary-color, #0969da);
        }
        .panel-toggle.minimal:hover .minimal-indicator {
          border-color: var(--primary-color, #0969da);
        }

        /* Switch shape variants */
        .panel-toggle.switch[data-shape="square"] .switch-slider { border-radius: 0; }
        .panel-toggle.switch[data-shape="square"] .switch-slider:before { border-radius: 0; }
        .panel-toggle.switch[data-shape="rounded"] .switch-slider { border-radius: 6px; }
        .panel-toggle.switch[data-shape="rounded"] .switch-slider:before { border-radius: 3px; }

        /* Card shape variants */
        .panel-toggle.card[data-shape="square"] { border-radius: 0; }
        .panel-toggle.card[data-shape="square"] .card-indicator { border-radius: 0; }
        .panel-toggle.card[data-shape="round"] { border-radius: 14px; }
        .panel-toggle.card[data-shape="round"] .card-indicator { border-radius: 50%; }

        /* The mode selector: the shared gallery (collection-gallery.js). */
        ${collectionGalleryStyles}
        ${tabBarStyles}
        .panel-toggle-tabs {
          width: 100%;
        }

        .panel-toggle input[type="checkbox"] {
          margin: 0;
        }

        .panel-toggle label {
          margin: 0;
          cursor: pointer;
        }


        /* ── Active-mode label chip ──────────────────────────── */
        .gc-active-mode-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 999px;
          background: color-mix(
            in srgb,
            var(--primary-color, #0969da) 12%,
            transparent
          );
          border: 1px solid
            color-mix(in srgb, var(--primary-color, #0969da) 30%, transparent);
          color: var(--primary-text-color, #24292f);
          font-size: 0.8em;
          font-weight: 600;
        }
        .gc-aml-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--primary-color, #0969da);
        }


        /* ===== Capsule angle slider (shared util) ===== */
        ${getCapsuleCSS()}
        .angle-capsule-host {
          width: 100%;
          flex: 1 1 auto;
          min-width: 160px;
        }

`;
