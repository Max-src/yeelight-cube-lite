import { LitElement, html, unsafeCSS, unsafeHTML } from "./lib/lit-all.js";
import { cardLayoutStyles } from "./card-layout-utils.js";
import {
  resolvePreviewAppearance,
  previewLength,
} from "./preview-appearance.js";
import { BLACK_THRESHOLD } from "./matrix-const.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import {
  renderGalleryDisplay,
  renderMatrixPreview,
  galleryDisplayStyles,
} from "./gallery-display-utils.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import { getTargetEntities } from "./service-call-utils.js";
import {
  CardCommandController,
  SUPERSEDED,
} from "./card-command-controller.js";
import { gradientPreviewStore } from "./gradient-preview-store.js";
import {
  AngleCommandController,
  rgbToHex as _sharedRgbToHex,
  createColorWheelSegments as _sharedCreateColorWheelSegments,
  createWheelGradientStops as _sharedCreateWheelGradientStops,
  createShapeGradientStops as _sharedCreateShapeGradientStops,
  generateShapeMask as _sharedGenerateShapeMask,
} from "./angle-wheel-utils.js";
import {
  renderCapsuleHTML,
  getCapsuleCSS,
  updateCapsuleVisuals,
  resolveCapsuleTheme,
  resolveCapsuleThickness,
} from "./capsule-slider-utils.js";
import {
  renderCarouselString,
  carouselStyles,
} from "./carousel-utils.js";
import {
  TEXT_SELECTOR_STYLES,
  PREVIEW_SELECTOR_STYLES,
  resolveSelectorShape,
  resolveSelectorButtonShape,
  selectorShapeToCarouselButtonShape,
  selectorSharedStyles,
} from "./selector-shared-styles.js";
import {
  paginationStyles,
  renderPagination,
} from "./pagination-utils.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import { createSliderDraft } from "./slider-control-utils.js";
import { bindHostEvents, hostEventAttrs } from "./host-events.js";

// Host methods the angle capsule markup may call (see bindHostEvents).
const CAPSULE_HANDLERS = new Set([
  "_startCapsuleDrag",
  "_endCapsuleDrag",
  "_handleCapsuleAngleInput",
  "_handleCapsuleWheel",
]);

// ── Lit helpers not exported by the bundled lit-all.js ─────────────────────
// Lit's `nothing` sentinel is a registered symbol (same trick as
// action-button-ui.js).
const nothing = Symbol.for("lit-nothing");
// `svg` tag: identical to lit-html's own (SVG_RESULT = 2).  Needed for
// sub-templates rendered INSIDE an <svg> element so they are created in the
// SVG namespace.
const svg = (strings, ...values) => ({ _$litType$: 2, strings, values });
// `unsafeSVG`: lit-html's UnsafeSVGDirective is UnsafeHTMLDirective with an
// SVG result type.  Used only for the SVG fragments produced by the shared
// angle-wheel-utils helpers (gradient <stop>s, shape masks).
const UnsafeHTMLDirective = unsafeHTML("")._$litDirective$;
class UnsafeSVGDirective extends UnsafeHTMLDirective {}
UnsafeSVGDirective.directiveName = "unsafeSVG";
UnsafeSVGDirective.resultType = 2;
const unsafeSVG = (value) => ({
  _$litDirective$: UnsafeSVGDirective,
  values: [value],
});

const _escapeMarkup = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Serialise a Lit template (as produced by this card: text/attribute
 * bindings, boolean `?attr` bindings, nested templates/arrays and
 * unsafeHTML/unsafeSVG directives) to an escaped HTML string.  Only used by
 * the string-returning `_renderAngleRotary()` compatibility API — the card
 * itself renders the templates through Lit.
 */
function templateToString(value) {
  if (value == null || value === false || value === nothing) return "";
  if (Array.isArray(value)) return value.map(templateToString).join("");
  if (typeof value === "object" && value._$litDirective$) {
    const raw = value.values?.[0];
    return raw == null || raw === nothing ? "" : String(raw);
  }
  if (typeof value === "object" && value._$litType$ !== undefined) {
    const { strings, values } = value;
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
      let next = strings[i + 1];
      const bound = /\s([?@.])([\w:-]+)=(["']?)$/.exec(out);
      const attr = /\s[\w:-]+=(["']?)[^"'<>]*$/.test(out) && !/>[^<]*$/.test(out);
      if (bound) {
        out = out.slice(0, bound.index);
        if (bound[3] && next.startsWith(bound[3])) next = next.slice(1);
        if (bound[1] === "?" && values[i] && values[i] !== nothing)
          out += ` ${bound[2]}`;
      } else if (attr) {
        const v = values[i];
        if (v === nothing) {
          // Attribute removed: drop `name=` (and a surrounding quote pair).
          const m = /\s([\w:-]+)=(["']?)$/.exec(out);
          if (m) {
            out = out.slice(0, m.index);
            if (m[2] && next.startsWith(m[2])) next = next.slice(1);
          }
        } else if (/\s[\w:-]+=$/.test(out)) {
          // Unquoted binding (`attr=${v}`): quote the serialised value.
          out += `"${_escapeMarkup(v ?? "")}"`;
        } else {
          out += _escapeMarkup(v ?? "");
        }
      } else {
        const v = values[i];
        out +=
          typeof v === "object" && v !== null
            ? templateToString(v)
            : v == null || v === nothing
              ? ""
              : _escapeMarkup(v);
      }
      out += next;
    }
    return out;
  }
  return _escapeMarkup(value);
}

/**
 * Convert gallery_preview_size config value (%) to pixels.
 * Legacy configs stored px values (120-450); new configs store % (30-100).
 * Values > 100 are treated as legacy px; values ≤ 100 are % mapped to px.
 */
function galleryPreviewSizeToPx(configValue) {
  const v = Number(configValue) || 50;
  if (v > 100) return v; // legacy px value
  return Math.round((v / 100) * 450);
}

// Fill-panel test: map column count (1-20) to Private Use Area characters
// 0 = off, 1-20 = number of columns filled (U+E001-U+E014)
const FILL_PANEL_CHARS = {
  1: "\uE001",
  2: "\uE002",
  3: "\uE003",
  4: "\uE004",
  5: "\uE005",
  6: "\uE006",
  7: "\uE007",
  8: "\uE008",
  9: "\uE009",
  10: "\uE00A",
  11: "\uE00B",
  12: "\uE00C",
  13: "\uE00D",
  14: "\uE00E",
  15: "\uE00F",
  16: "\uE010",
  17: "\uE011",
  18: "\uE012",
  19: "\uE013",
  20: "\uE014",
};
// Reverse lookup: character -> column count
const FILL_PANEL_CHAR_TO_COLS = Object.fromEntries(
  Object.entries(FILL_PANEL_CHARS).map(([k, v]) => [v, Number(k)]),
);

// Angle value displays/inputs inside the rotary: pointer-downs on these never
// start a rotary drag.
const ANGLE_NO_DRAG_SELECTOR =
  "#angleinput, #angletext, .rotary-overlay-value, .matrix-angle-value, .capsule-angle-slot";

// Mode visibility is config-based: `custom_visible_modes` (boolean) +
// `visible_modes` (ordered array) set from the editor's drag-drop list.
// The old localStorage + eye-overlay edit mode has been removed.

/** All gradient mode names, in display/iteration order. Exported so the
 * editor's visible-modes drag-drop list offers the same canonical set. */
export const GRADIENT_MODES = [
  "Solid Color",
  "Letter Gradient",
  "Column Gradient",
  "Row Gradient",
  "Angle Gradient",
  "Radial Gradient",
  "Letter Angle Gradient",
  "Letter Vertical Gradient",
  "Text Color Sequence",
];

// ── Unified mode selector ──────────────────────────────────────────────────
// Historically the card had TWO ways to pick a gradient mode: a text-style
// selector (buttons/pills/dropdown/…) AND a clickable preview gallery.  They
// served the exact same purpose, so they are now ONE selector with a single
// `mode_selector_style` config key covering every presentation:
//   Text styles:    "filled" | "dropdown" | "chips"
//   Preview styles: "preview-list" | "preview-grid" | "preview-strip" |
//                   "preview-carousel" | "preview-wheel"
// Preview styles render live mini-matrix previews of every mode (click to
// apply); text styles are lightweight and skip ALL preview backend calls.
// Two appearance axes apply across EVERY style (shared design language with
// the other cards): `selector_shape` (square/rounded/round) and the size
// slider (`gallery_preview_size`, scales previews AND text buttons).
// TEXT_SELECTOR_STYLES / PREVIEW_SELECTOR_STYLES / resolveSelectorShape are
// shared with the clock card via ./selector-shared-styles.js.
// Legacy `preview_display_mode` values → unified style
const LEGACY_PREVIEW_STYLE_MAP = {
  inline: "preview-list",
  grid: "preview-list",
  gallery: "preview-list",
  list: "preview-list",
  compact: "preview-list",
  wheel: "preview-wheel",
};

// Legacy text-selector styles (buttons / pills / compact / colorized) are all
// merged into the single "filled" style.
const LEGACY_TEXT_STYLE_MAP = {
  buttons: "filled",
  pills: "filled",
  compact: "filled",
  colorized: "filled",
};

/**
 * Resolve the unified mode-selector style from a card config, migrating
 * legacy configs transparently.
 *
 * Legacy configs (pre-unification) ALWAYS showed the preview section — there
 * was no way to hide it — so they migrate to the matching preview style.
 * The old text selector (color_mode_style) remains available by explicitly
 * choosing a text style in the editor.
 */
function resolveModeSelectorStyle(cfg) {
  if (!cfg) return "preview-list";
  const explicit = cfg.mode_selector_style;
  if (explicit && LEGACY_TEXT_STYLE_MAP[explicit]) {
    return LEGACY_TEXT_STYLE_MAP[explicit];
  }
  if (
    explicit &&
    (TEXT_SELECTOR_STYLES.includes(explicit) ||
      PREVIEW_SELECTOR_STYLES.includes(explicit))
  ) {
    return explicit;
  }
  return LEGACY_PREVIEW_STYLE_MAP[cfg.preview_display_mode] || "preview-list";
}

/**
 * Shared appearance axis: size.  The same slider (gallery_preview_size)
 * drives preview pixel size AND a text-button scale factor, so "Size" means
 * one thing regardless of the chosen selector style.
 * 50% = 1.0× text scale; clamped to a sane 0.8–1.4 range.
 */
function resolveSelectorTextScale(cfg) {
  const v = Number(cfg?.gallery_preview_size) || 50;
  const pct = v > 100 ? 50 : v; // legacy px values → neutral scale
  return Math.max(0.8, Math.min(1.4, pct / 50));
}

// Card stylesheet (static; adopted once per shadow root by LitElement).
const GRADIENT_CARD_CSS = `
        ${cardLayoutStyles}
        .card-title {
          font-size: 1.3em;
          font-weight: bold;
          margin-bottom: 18px;
          margin-top: 2px;
          color: var(--primary-text-color, #222);
        }
        
        /* Header rotary styling - sized for 88px height */
        .header-rotary {
          flex-shrink: 0;
        }
        
        .header-rotary .wheel-container,
        .header-rotary .rect-container,
        .header-rotary .default-container,
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
        .color-row {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          background: var(--secondary-background-color, #fafbfc);
          border: 1.5px solid var(--disabled-text-color, #d0d7de);
          border-radius: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          padding: 6px 12px;
          transition: box-shadow 0.2s, transform 0.2s cubic-bezier(.4,2,.6,1), background 0.2s;
          position: relative;
          width: 100%;
          box-sizing: border-box;
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
          color: var(--text-primary-color, #fff);
        }
        
        .color-row.full-row-color .hex-input {
          background: rgba(255, 255, 255, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.4);
        }
        
        .color-row.full-row-color .hex-input:focus {
          background: rgba(255, 255, 255, 0.5) !important;
          border-color: rgba(255, 255, 255, 0.7) !important;
          outline: none;
          border: 0 !important;
        }
        .color-main {
          display: flex;
          align-items: center;
          flex: 1 1 auto;
          min-width: 0;
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
          transition: border 0.2s, box-shadow 0.2s;
        }
        .color-row input[type="text"].hex-input:focus {
          border: 1.5px solid transparent !important;
          outline: none;
          box-shadow: 2px 2px 2px 2px transparent;
        }
        .remove-btn { background: color-mix(in srgb, var(--error-color, #db4437) 15%, var(--card-background-color, #fff)); border: none; border-radius: 6px; color: var(--error-color, #db4437); padding: 6px 18px; cursor: pointer; font-size: 1em; font-weight: 500; margin-left: 0; transition: background 0.2s; }
        .remove-btn:hover { background: color-mix(in srgb, var(--error-color, #db4437) 25%, var(--card-background-color, #fff)); }
        
        /* Red cross style remove button */
        .color-btn-cross.remove-btn-cross {
          position: absolute;
          top: 8px;
          right: 8px;
          background: none;
          border: none;
          color: var(--error-color, #db4437);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s ease;
          min-width: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: bold;
          z-index: 2;
        }
        
        .color-btn-cross.remove-btn-cross:hover {
          background: rgba(187, 0, 0, 0.1);
          color: var(--error-color, #d32f2f);
          transform: scale(1.1);
        }
        
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
        
        /* Angle section styles */
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
        .angle-text {
          font-size: 14px;
          font-weight: 600;
          color: var(--primary-text-color, #333);
          min-width: 40px;
          text-align: center;
          user-select: none;
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
        .color-wheel, .default-container, .rect-container, .matrix-preview-container, .compass-container {
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

        /* Tabs style — two-option sliding control: [Pixels] / [Panel] */
        .panel-toggle.tabs {
          position: relative;
          display: flex;
          gap: 0;
          background: var(--secondary-background-color, #eef0f2);
          border-radius: 10px;
          padding: 3px;
        }
        .panel-toggle.tabs .tabs-thumb {
          position: absolute;
          top: 3px;
          bottom: 3px;
          left: 3px;
          width: calc(50% - 3px);
          background: var(--card-background-color, #fff);
          border-radius: 8px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.12);
          transition: transform 0.22s ease;
          pointer-events: none;
        }
        .panel-toggle.tabs[data-active="1"] .tabs-thumb {
          transform: translateX(100%);
        }
        .panel-toggle.tabs[data-shape="round"] .tabs-thumb {
          border-radius: 999px;
        }
        .panel-toggle.tabs[data-shape="square"] .tabs-thumb {
          border-radius: 0;
        }
        .panel-toggle.tabs .tab-btn {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 7px 10px;
          border: none;
          background: transparent;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.82em;
          font-weight: 500;
          color: var(--secondary-text-color, #888);
          transition: color 0.2s ease;
          white-space: nowrap;
        }
        .panel-toggle.tabs[data-shape="round"] .tab-btn {
          border-radius: 999px;
        }
        .panel-toggle.tabs[data-shape="square"] .tab-btn {
          border-radius: 0;
        }
        .panel-toggle.tabs .tab-btn.active {
          color: var(--primary-color, #0969da);
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
          border: 1px solid var(--disabled-text-color, #d0d7de);
          background: var(--card-background-color, white);
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85em;
          transition: all 0.2s ease;
        }
        
        .control-button:hover {
          background: var(--secondary-background-color, #f6f8fa);
        }

        /* Text selectors (filled/dropdown/chips), hover ring, shape/size axes
           and pending pulse — shared with the clock card. */
        ${selectorSharedStyles}
        ${paginationStyles}

        .panel-toggle input[type="checkbox"] {
          margin: 0;
        }

        .panel-toggle label {
          margin: 0;
          cursor: pointer;
        }

        /* Preview section styles */
        .preview-toggle-btn {
          width: 100%;
          padding: 10px 16px;
          background: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color, #764ba2) 100%);
          color: var(--text-primary-color, #fff);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }

        .preview-toggle-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .preview-toggle-btn:active {
          transform: translateY(0);
        }

        .preview-item {
          border: 2px solid transparent;
        }

        .preview-item:hover {
          border-color: rgba(102, 126, 234, 0.5);
        }

        .preview-title {
          color: var(--text-primary-color, #fff);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        /* Gallery display styles from shared utility */
        ${galleryDisplayStyles}

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

        /* Gradient carousel: transparent wrapper — item handles its own background */
        .gc-preview-shell .carousel-content-card {
          background: transparent !important;
          box-shadow: none !important;
          padding: 0 !important;
        }

        /* Shared carousel component styles (carousel-utils) */
        ${carouselStyles}

        /* Wheel navigation button styles */
        .wheel-nav-down:hover,
        .wheel-nav-up:hover {
          background: var(--card-background-color, white) !important;
          box-shadow: 0 6px 16px rgba(0,0,0,0.2) !important;
          color: var(--primary-text-color, #000) !important;
        }

        /* ===== Capsule angle slider (shared util) ===== */
        ${getCapsuleCSS()}
        .angle-capsule-host {
          width: 100%;
          flex: 1 1 auto;
          min-width: 160px;
        }

`;

class YeelightCubeGradientCard extends LitElement {
  // No reactive properties: rendering is driven explicitly by _renderCard()
  // (set hass fast path / skeleton key), which calls requestUpdate() only
  // when the card structure changes and syncs dynamic values in place
  // otherwise.
  static styles = unsafeCSS(GRADIENT_CARD_CSS);

  constructor() {
    super();
    // Every service call of this card (except the debounced angle, see
    // _angleCommands) goes through one ordered queue.
    this._commands = new CardCommandController();
    // The angle the user is setting, kept until the lamp reports it back so
    // re-renders during/after a drag never snap the controls to the old angle.
    this._angleDraft = createSliderDraft({
      tolerance: 1,
      isDragging: () =>
        !!(
          this._angleHeld ||
          this._usingSlider ||
          this._draggingRotary ||
          this._isDragging ||
          this._typingAngle
        ),
      onExpire: () => this._renderCard(),
    });
    // Passive delegated swipe listeners for the carousel preview (stable
    // objects so Lit never re-binds them across renders).
    this._previewTouchStartListener = {
      handleEvent: (e) => this._onPreviewTouchStart(e),
      passive: true,
    };
    this._previewTouchEndListener = {
      handleEvent: (e) => this._onPreviewTouchEnd(e),
      passive: true,
    };
    // Document-level drag handlers (attached only for an active rotary drag,
    // tracked in _rotaryDocListeners so they can never leak or stack).
    this._onDocMouseMove = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection during drag
        this._handleRotaryDrag(e);
      }
    };
    this._onDocTouchMove = (e) => {
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection
        this._handleRotaryDrag(e.touches[0]);
      }
    };
    this._onDocDragEnd = (e) => {
      // Always detach the document listeners, even if _draggingRotary was
      // reset elsewhere (e.g. setConfig mid-drag) — otherwise they leak.
      this._removeRotaryDocListeners();
      if (this._draggingRotary) {
        e.preventDefault(); // Prevent text selection

        // Cancel pending debounce and apply the final angle immediately
        if (this._pendingAngle !== null && this._pendingAngle !== undefined) {
          this._applyAngle(this._pendingAngle);
          this._lastAngleSent = this._pendingAngle;
        }

        this._draggingRotary = false;
        this._isDragging = false;
        this._pendingAngle = null;
        this._flushPendingRender();
      }
    };
    // --- UI/interaction state ---
    this._pendingAngle = null;
    this._angleCommands = new AngleCommandController(
      (angle) => {
        this._lastAngleSent = angle;
        this._onAngleApplied();
      },
      (error) =>
        this.dispatchEvent(
          new CustomEvent("hass-notification", {
            bubbles: true,
            composed: true,
            detail: {
              message: error.message || "The angle could not be updated.",
            },
          }),
        ),
    );
    this._lastAngleSent = null;
    this._isDragging = false;
    this._draggingRotary = false;
    this._usingSlider = false;
    this._processingModeChange = false;
    this._dropdownOpen = false; // Prevent re-render when dropdown is open
    this._lastModeChangeTime = 0; // Track when mode was last changed
    this._optimisticMode = null; // Store the optimistic mode selection
    this._renderScheduled = false;
    this._pendingHassRender = false; // Track if a render was blocked by interaction flags
    this._interactionSafetyTimer = null; // Safety timer to flush pending renders
    this._previewEventListenerRegistered = false; // Track event listener for global preview cache
    this._cachedPreviewHtml = null; // Cache rendered preview HTML
    this._lastPreviewDataHash = null; // Track if preview data changed
    this._lastWheelMode = null; // Track wheel mode to prevent unnecessary syncs
    this._wheelCenterIndex = 0; // Track center item in wheel mode
    this._wheelNavigationController = null; // Controller for wheel navigation
    // All preview data is now stored in window._yeelightPreviewCaches (see top of file)
    // This ensures preview data persists across card destruction/recreation.
  }

  // --- Mode Visibility helpers (config-based) ---
  _isModeVisible(mode) {
    if (this.config?.custom_visible_modes !== true) return true;
    const list = this.config.visible_modes;
    return !Array.isArray(list) || !list.length || list.includes(mode);
  }

  /** Gradient mode names in display order, honoring the visible-modes config. */
  _orderedModes() {
    if (
      this.config?.custom_visible_modes === true &&
      Array.isArray(this.config.visible_modes) &&
      this.config.visible_modes.length
    ) {
      const picked = this.config.visible_modes.filter((m) =>
        GRADIENT_MODES.includes(m),
      );
      if (picked.length) return picked;
    }
    return GRADIENT_MODES;
  }

  // One call for all target lamps (the backend runs them in parallel), through
  // the card's command queue: sent in order, results from a previous
  // configuration dropped. Rejects on failure (HA has already shown it).
  // options.coalesce: see CardCommandController.execute.
  callServiceOnTargetEntities(serviceName, serviceData = {}, options = {}) {
    return this._commands.request(
      this._hass,
      this.config,
      serviceName,
      serviceData,
      options,
    );
  }

  connectedCallback() {
    super.connectedCallback();
    // The angle capsule names its handlers in data-on-* attributes.
    bindHostEvents(this, (name) => CAPSULE_HANDLERS.has(name));
    // Re-establish preview event subscription lost during disconnection.
    // disconnectedCallback unsubscribes, but the persistent _previewElement
    // survives, so the creation-time setTimeout that calls
    // _setupPreviewEventListener never runs again.  Re-subscribe here.
    if (!this._previewEventListenerRegistered && this._hass) {
      this._setupPreviewEventListener();
    }

    // After reconnection, the wheel controller was destroyed in disconnectedCallback.
    // We must re-initialize it once the DOM is ready again.
    if (
      this._isPreviewSelectorActive?.() &&
      this._getDisplayMode?.() === "wheel" &&
      !this._wheelNavigationController
    ) {
      // Reset _lastWheelMode so that the next set hass() triggers a sync
      this._lastWheelMode = null;
      // Defer re-init until the preview element is re-attached in the next render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this._wheelNavigationController && this._previewElement) {
            this._setupWheelNavigation();
          }
        });
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._angleRelease) {
      for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
        document.removeEventListener(type, this._angleRelease, true);
      this._angleRelease = null;
      this._angleHeld = false;
    }
    this._angleCommands.reset();
    this._previewContext = (this._previewContext || 0) + 1;
    // Clean up wheel navigation controller
    if (this._wheelNavigationController) {
      this._wheelNavigationController.destroy();
      this._wheelNavigationController = null;
    }
    // Unsubscribe from preview events
    if (this._unsubscribePreviewEvents) {
      this._unsubscribePreviewEvents();
      this._unsubscribePreviewEvents = null;
    }
    this._previewEventListenerRegistered = false;

    // Clear pending timers
    if (this._previewReloadTimer) {
      clearTimeout(this._previewReloadTimer);
      this._previewReloadTimer = null;
    }
    if (this._panelModeTimeout) {
      clearTimeout(this._panelModeTimeout);
      this._panelModeTimeout = null;
    }
    if (this._fillPanelTimeout) {
      clearTimeout(this._fillPanelTimeout);
      this._fillPanelTimeout = null;
    }
    if (this._anglePreviewReloadTimer) {
      clearTimeout(this._anglePreviewReloadTimer);
      this._anglePreviewReloadTimer = null;
    }
    if (this._previewRetryTimer) {
      clearTimeout(this._previewRetryTimer);
      this._previewRetryTimer = null;
    }
    if (this._optimisticModeTimeout) {
      clearTimeout(this._optimisticModeTimeout);
      this._optimisticModeTimeout = null;
    }
    if (this._carouselNavTimer) {
      clearTimeout(this._carouselNavTimer);
      this._carouselNavTimer = null;
    }

    // Reset interaction flags and cleanup safety timer
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }

    // Detach any document-level rotary drag listeners left from an
    // in-progress drag.
    this._removeRotaryDocListeners();
    this._draggingRotary = false;
  }

  /**
   * Remove the document-level mouse/touch listeners attached for an active
   * rotary drag (recorded in this._rotaryDocListeners by _startRotaryDrag).
   */
  _removeRotaryDocListeners() {
    const listeners = this._rotaryDocListeners;
    this._rotaryDocListeners = null;
    if (!listeners) return;
    listeners.forEach(([type, fn]) => document.removeEventListener(type, fn));
  }

  /**
   * Attach document-level drag listeners, recording them on the instance so
   * they can be removed from anywhere (drag end, setConfig, disconnect).
   * Any previously attached set is removed first so listeners never stack.
   */
  _startRotaryDocDrag(touch) {
    this._removeRotaryDocListeners();
    this._rotaryDocListeners = touch
      ? [
          ["touchmove", this._onDocTouchMove],
          ["touchend", this._onDocDragEnd],
          ["touchcancel", this._onDocDragEnd],
        ]
      : [
          ["mousemove", this._onDocMouseMove],
          ["mouseup", this._onDocDragEnd],
        ];
    this._rotaryDocListeners.forEach(([type, fn]) =>
      document.addEventListener(type, fn),
    );
  }

  setConfig(config) {
    config = resolvePreviewAppearance(config, "gradient");
    this._angleCommands.reset();
    this._commands?.reset();
    this._pendingAngle = null;
    this._removeRotaryDocListeners();
    this._draggingRotary = false;
    clearTimeout(this._anglePreviewReloadTimer);
    clearTimeout(this._previewRetryTimer);
    clearTimeout(this._previewReloadTimer);
    this._unsubscribePreviewEvents?.();
    this._unsubscribePreviewEvents = null;
    this._previewEventListenerRegistered = false;
    this._previewContext = (this._previewContext || 0) + 1;
    // Check if wheel-affecting settings changed
    // Skip change detection on first init — this.config is undefined so every
    // comparison fires as "changed", causing a wasteful teardown/rebuild cycle
    // that races with preview loading and leaves a no-op wheel controller.

    // Structural changes require full preview element rebuild.
    // Compare the RESOLVED selector styles so legacy-key changes and
    // text↔preview switches are detected uniformly.
    const wheelStructureChanged = this.config
      ? resolveModeSelectorStyle(this.config) !==
          resolveModeSelectorStyle(config) ||
        this.config.wheel_nav_position !== config?.wheel_nav_position ||
        this.config.preview_show_titles !== config?.preview_show_titles
      : false;

    // Height-only changes can be handled with an in-place content refresh
    // (avoids destroy/recreate race condition when slider is dragged rapidly)
    const wheelHeightChanged = this.config
      ? this.config.wheel_height !== config?.wheel_height
      : false;

    if (wheelStructureChanged) {
      // Full rebuild: display mode, nav position, or titles changed
      if (this._wheelNavigationController) {
        this._wheelNavigationController.destroy();
        this._wheelNavigationController = null;
      }
      this._lastPreviewDataHash = null;
      this._cachedPreviewHtml = null;
      // Re-anchor the carousel on the active mode after a style switch
      this._carouselIndex = null;
      if (this._previewElement) {
        this._previewElement = null;
      }
    } else if (wheelHeightChanged) {
      // Height-only change: keep preview element alive, refresh content in-place
      if (this._wheelNavigationController) {
        this._wheelNavigationController.destroy();
        this._wheelNavigationController = null;
      }
      this._lastPreviewDataHash = null;
      this._cachedPreviewHtml = null;
      this._pendingWheelHeightUpdate = true;
    }

    this.config = config;
    this._setupPreviewEventListener();

    // Always render when setConfig is called (config changed in editor)
    // But we'll preserve the preview element across renders
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this._renderCard();
      });
    }
  }

  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-gradient-card-editor")) {
      await import("./yeelight-cube-gradient-card-editor.js");
    }
    return document.createElement("yeelight-cube-gradient-card-editor");
  }
  static getStubConfig(hass) {
    const allEntities = Object.keys(hass?.states || {}).filter(
      (e) =>
        e.startsWith("light.yeelight_cube") || e.startsWith("light.cubelite_"),
    );
    const firstEntity = allEntities[0] || "";
    return {
      type: "custom:yeelight-cube-gradient-card",
      entity: firstEntity,
      target_entities: allEntities.length > 0 ? allEntities : [],
      mode_selector_style: "preview-wheel",
      selector_shape: "rounded",
      show_mode_selector: true,
      show_panel_toggle: true,
      show_active_mode_label: false,
      rotary_unified_style: "rectangle",
      show_angle_section: true,
      angle_value_display: "none",
      show_angle_slider: false,
      panel_toggle_style: "minimal",
      rotary_size: "100",
      gallery_background_color: "transparent",
      wheel_nav_position: "sides",
      preview_show_titles: false,
      gallery_pixel_style: "circle",
      gallery_ignore_black_pixels: true,
      gallery_preview_size: "64",
      gallery_spacing_mode: "normal",
      rectangle_shape: "rectangle",
      show_selector_dot: true,
      compass_snap_to_coordinates: false,
      wheel_height: "195",
      gallery_matrix_box_shadow: false,
      show_card_background: true,
    };
  }

  set hass(hass) {
    if (this._hass?.connection !== hass?.connection) {
      this._unsubscribePreviewEvents?.();
      this._unsubscribePreviewEvents = null;
      this._previewEventListenerRegistered = false;
      this._previewContext = (this._previewContext || 0) + 1;
    }
    this._hass = hass;

    // Re-establish preview event subscription if lost (connectedCallback may
    // fire before hass is available, so this is a belt-and-suspenders guard).
    if (!this._previewEventListenerRegistered && hass) {
      this._setupPreviewEventListener();
    }

    // Fast path: HA calls this setter for every state change anywhere in the
    // instance, but only replaces the state object of the entity that changed.
    // If our primary entity's state object is the same reference we fully
    // processed last time (same config, no optimistic flag waiting for a
    // backend echo, wheel already synced to this mode), everything below would
    // be a no-op, so skip it.
    if (this.config && this._seenConfig === this.config) {
      const seenId = this._getPrimaryEntity();
      const seenState = seenId ? hass?.states?.[seenId] : undefined;
      if (
        seenState &&
        seenId === this._seenEntityId &&
        seenState === this._seenStateObj &&
        this._optimisticMode == null &&
        this._optimisticPanelMode === undefined &&
        this._optimisticFillCols === undefined &&
        (this._getDisplayMode() !== "wheel" ||
          this._lastWheelMode === seenState.attributes?.mode)
      ) {
        return;
      }
    }

    // Track entity state changes to auto-reload gallery previews (debounced)
    // Only relevant when a preview-style selector is shown — text selectors
    // never call the preview service.
    const entityId = this._getPrimaryEntity();
    if (
      hass &&
      entityId &&
      this._isPreviewSelectorActive() &&
      // Same state object as the last check => all derived values are equal.
      (!hass.states[entityId] ||
        hass.states[entityId] !== this._lastPreviewStateObj)
    ) {
      const stateObj = hass.states[entityId];
      this._lastPreviewStateObj = stateObj;
      const currentText = stateObj?.attributes?.custom_text;
      const currentAngle = stateObj?.attributes?.angle;
      const currentColors = stateObj?.attributes?.text_colors;
      const currentPanelMode = stateObj?.attributes?.full_panel || false;
      // Only re-stringify when the array reference changed.
      let colorsHash = this._lastPreviewColors;
      if (
        currentColors === undefined ||
        currentColors !== this._lastPreviewColorsRef
      ) {
        colorsHash = currentColors ? JSON.stringify(currentColors) : null;
        this._lastPreviewColorsRef = currentColors;
      }
      // Also watch matrix_colors: in "Panel Color Sequence" mode the palette
      // paints the panel directly, so the rendered output (matrix_colors) can
      // change without text_colors differing.  Watching it here keeps the
      // preview in sync with the actual lamp output in every mode.
      const currentMatrixColors = stateObj?.attributes?.matrix_colors;
      let matrixColorsHash = this._lastPreviewMatrixColors;
      if (
        currentMatrixColors === undefined ||
        currentMatrixColors !== this._lastPreviewMatrixColorsRef
      ) {
        matrixColorsHash = currentMatrixColors
          ? JSON.stringify(currentMatrixColors)
          : null;
        this._lastPreviewMatrixColorsRef = currentMatrixColors;
      }
      if (
        this._lastPreviewText !== currentText ||
        this._lastPreviewAngle !== currentAngle ||
        this._lastPreviewColors !== colorsHash ||
        this._lastPreviewMatrixColors !== matrixColorsHash ||
        this._lastPreviewPanelMode !== currentPanelMode
      ) {
        this._lastPreviewText = currentText;
        this._lastPreviewAngle = currentAngle;
        this._lastPreviewColors = colorsHash;
        this._lastPreviewMatrixColors = matrixColorsHash;
        this._lastPreviewPanelMode = currentPanelMode;
        // Debounce preview reload to avoid flickering on rapid updates
        // (gallery thumbnails still use the preview cache)
        if (this._previewReloadTimer) clearTimeout(this._previewReloadTimer);
        this._previewReloadTimer = setTimeout(() => {
          this._loadPreviews().catch((err) =>
            console.error("[Gradient Card] Error reloading previews:", err),
          );
        }, 500);
      }
    }

    // Check if we recently changed mode (within last 2 seconds)
    const timeSinceLastModeChange = Date.now() - this._lastModeChangeTime;
    const ignoreUpdateWindow = 2000; // Ignore sensor updates for 2 seconds after mode change

    // Skip if config not set yet (hass can be set before config)
    if (!this.config) {
      return;
    }

    // Use the primary entity (first target_entity, or fallback to config.entity)
    const _primaryEntityId = this._getPrimaryEntity();
    if (!_primaryEntityId) {
      return;
    }

    // Check if the entities we care about actually changed
    const entity = this._hass.states[_primaryEntityId];
    if (!entity) {
      // Entity no longer exists in HA — force a render to show the error state
      this._previousHass = hass;
      this._renderCard();
      return;
    }
    const oldEntity = this._previousHass
      ? this._previousHass.states[_primaryEntityId]
      : null;

    // Only render if attributes that actually affect the card UI changed.
    // HA keeps the same state object for entities that did not change, but
    // replaces THIS entity's state object on ANY of its attribute updates
    // (brightness, etc.), so `entity !== oldEntity` alone would trigger
    // spurious full-DOM rebuilds that destroy & recreate the capsule slider,
    // causing the visible "blink" (thumb jumps to 0 then animates back).
    // Compare only the attributes the card actually reads during render().
    // NOTE: when this entity's state object is replaced, its attribute arrays
    // (text_colors/matrix_colors) are new references even if the values are
    // unchanged, so fall back to a JSON comparison when the reference differs.
    const entityChanged =
      !oldEntity ||
      (entity !== oldEntity &&
      (() => {
        if (entity.state !== oldEntity.state) return true;
        const a = entity.attributes;
        const b = oldEntity.attributes;
        if (
          a.angle !== b.angle ||
          a.mode !== b.mode ||
          a.full_panel !== b.full_panel ||
          a.custom_text !== b.custom_text
        )
          return true;
        // Deep-compare arrays only when the reference changed
        if (
          a.text_colors !== b.text_colors &&
          JSON.stringify(a.text_colors) !== JSON.stringify(b.text_colors)
        )
          return true;
        if (
          a.matrix_colors !== b.matrix_colors &&
          JSON.stringify(a.matrix_colors) !== JSON.stringify(b.matrix_colors)
        )
          return true;
        return false;
      })());

    // --- Optimistic Panel Mode: clear only when backend matches ---
    if (this._optimisticPanelMode !== undefined && entity) {
      const backendPanelMode = entity.attributes.full_panel || false;
      if (backendPanelMode === this._optimisticPanelMode) {
        this._optimisticPanelMode = undefined;
      }
    }

    // --- Optimistic Mode: clear only when backend echoes the new mode ---
    // (prevents the highlight snapping back to the old mode between service
    // completion and the entity state echo — see _selectMode)
    if (this._optimisticMode && entity) {
      if (entity.attributes.mode === this._optimisticMode) {
        this._optimisticMode = null;
        if (this._optimisticModeTimeout) {
          clearTimeout(this._optimisticModeTimeout);
          this._optimisticModeTimeout = null;
        }
      }
    }

    // --- Optimistic Fill Panel Cols: clear when backend custom_text matches ---
    if (this._optimisticFillCols !== undefined && entity) {
      const backendText = entity.attributes.custom_text || "";
      const backendCols = FILL_PANEL_CHAR_TO_COLS[backendText] || 0;
      if (backendCols === this._optimisticFillCols) {
        this._optimisticFillCols = undefined;
      }
    }

    // Store current hass for next comparison
    this._previousHass = this._hass;
    // Remember what was fully processed (used by the fast path above)
    this._seenConfig = this.config;
    this._seenEntityId = _primaryEntityId;
    this._seenStateObj = entity;

    // Re-initialize wheel center ONLY if mode attribute actually changed
    if (this._getDisplayMode() === "wheel" && entity) {
      const currentMode = entity.attributes?.mode;

      // Only sync if:
      // 1. Mode actually changed from last known value
      // 2. Not in optimistic mode (we're already showing the right mode)
      // 3. First initialization (no last mode tracked)
      const modeChanged = this._lastWheelMode !== currentMode;
      const isFirstInit = this._lastWheelMode === null;

      if (modeChanged && !this._optimisticMode) {
        this._lastWheelMode = currentMode;
        setTimeout(
          () => {
            this._syncWheelToCurrentMode();
            this._markActiveMode();
          },
          isFirstInit ? 100 : 0,
        );
      } else if (modeChanged && this._optimisticMode) {
        // Mode changed but we're in optimistic mode - still sync wheel position
        // (e.g. mode changed via color-mode selector buttons, not the wheel itself)
        this._lastWheelMode = currentMode;
        setTimeout(() => {
          this._syncWheelToCurrentMode();
          this._markActiveMode();
        }, 0);
      } else if (!modeChanged) {
        // Mode didn't change - this is just a color/angle/sensor update
        // DO NOT sync wheel - this prevents the blink you're seeing
        // `[Wheel Sync] Sensor update detected but mode unchanged ('${currentMode}'), skipping wheel sync`
        // );
      }
    }

    // For non-wheel display modes: detect external mode changes and update highlight
    if (this._getDisplayMode() !== "wheel" && entity && oldEntity) {
      const currentMode = entity.attributes?.mode;
      const prevMode = oldEntity.attributes?.mode;
      if (prevMode !== currentMode) {
        this._markActiveMode();
      }
    }

    // Skip render if entity didn't change
    if (!entityChanged) {
      return;
    }

    // Always allow render for button updates unless:
    // 1. Actively dragging rotary controls or angle slider
    // 2. Dropdown is open
    // 3. Recently changed mode (prevent sensor updates from overriding optimistic UI)
    if (
      !this._draggingRotary &&
      !this._isDragging &&
      !this._usingSlider &&
      !this._dropdownOpen &&
      !this._typingAngle &&
      timeSinceLastModeChange > ignoreUpdateWindow
    ) {
      this._pendingHassRender = false;
      if (!this._renderScheduled) {
        this._renderScheduled = true;
        requestAnimationFrame(() => {
          this._renderScheduled = false;
          this._renderCard();
        });
      }
    } else {
      // Interaction in progress — remember that a state-driven render was blocked
      this._pendingHassRender = true;
      this._startInteractionSafety();
    }
  }

  // Flush any render that was blocked while interaction flags were set.
  // Called when an interaction flag is cleared to recover missed state updates.
  _flushPendingRender() {
    if (!this._pendingHassRender) return;
    if (
      this._draggingRotary ||
      this._isDragging ||
      this._usingSlider ||
      this._dropdownOpen ||
      this._typingAngle
    )
      return; // Another flag still active
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this._renderCard();
      });
    }
  }

  // Safety timer: periodically check if all interaction flags have cleared
  // and flush the pending render. Covers edge cases where flag-clearing code
  // paths don't explicitly call _flushPendingRender().
  _startInteractionSafety() {
    if (this._interactionSafetyTimer) return; // Already running
    this._interactionSafetyTimer = setInterval(() => {
      if (
        !this._draggingRotary &&
        !this._isDragging &&
        !this._usingSlider &&
        !this._dropdownOpen &&
        !this._typingAngle
      ) {
        clearInterval(this._interactionSafetyTimer);
        this._interactionSafetyTimer = null;
        this._flushPendingRender();
      }
    }, 1000);
  }

  /**
   * Imperative render entry point (called from set hass / setConfig /
   * interaction handlers).  Chooses between the surgical in-place sync
   * (structure unchanged) and a Lit re-render of the card skeleton.
   */
  _renderCard() {
    // Only block render if actively dragging/interacting with angle controls to prevent interference
    if (
      this._draggingRotary ||
      this._isDragging ||
      this._usingSlider ||
      this._typingAngle
    )
      return;

    const hass = this._hass;
    if (!hass) return;

    // Support both old single entity config and new multi-entity config
    const primaryEntity = this._getPrimaryEntity();
    const stateObj = primaryEntity ? hass.states[primaryEntity] : null;

    if (!primaryEntity || !stateObj) {
      const entityCount = (this.config.target_entities || []).length;
      this._errorMessage =
        entityCount === 0
          ? "No entities configured"
          : `Primary entity (${String(primaryEntity)}) not found`;
      this._skeletonKey = null; // force full rebuild when the entity recovers
      this.requestUpdate();
      return;
    }
    this._errorMessage = null;
    const textColors = this._pendingColors ||
      stateObj.attributes.text_colors || [[255, 255, 255]];

    // Current angle: the in-flight value while the lamp catches up.
    const currentAngle = this._displayAngle(stateObj);

    // ── SURGICAL RENDER FAST PATH ──────────────────────────────────────
    // The skeleton is (re)rendered through Lit ONCE per structural
    // configuration (config + text colors, which are baked into
    // rotary/button gradients); afterwards every call only syncs dynamic
    // values in place, which keeps state updates flicker-free.
    const structuralKey = JSON.stringify({
      cfg: this.config,
      colors: textColors,
    });
    if (
      this._skeletonKey === structuralKey &&
      this.shadowRoot?.querySelector(".card-content")
    ) {
      this._syncDynamicUI(stateObj, currentAngle);
      return;
    }
    this._skeletonKey = structuralKey;

    // For text-style selectors tear down the preview machinery (wheel
    // controller, cached preview HTML); the Lit template drops the host.
    if (!this._isPreviewSelectorActive()) {
      if (this._wheelNavigationController) {
        this._wheelNavigationController.destroy();
        this._wheelNavigationController = null;
      }
      if (this._previewElement) {
        this._previewElement = null;
        this._cachedPreviewHtml = null;
        this._lastPreviewDataHash = null;
      }
    }

    this._rebuildPending = true;
    this.requestUpdate();
  }

  render() {
    if (this._errorMessage != null) {
      return html`<ha-card><div style="padding: 16px;">${this._errorMessage}</div></ha-card>`;
    }
    const hass = this._hass;
    if (!hass || !this.config || this._skeletonKey == null) return nothing;
    const stateObj = hass.states[this._getPrimaryEntity()];
    if (!stateObj) return nothing;

    const textColors = this._pendingColors ||
      stateObj.attributes.text_colors || [[255, 255, 255]];
    const currentAngle = this._displayAngle(stateObj);

    const showCard = this.config.show_card_background !== false;
    // Unified mode selector (replaces the old separate color-mode selector +
    // always-on preview section — they served the same purpose).
    const selectorStyle = this._getModeSelectorStyle();
    const isPreviewSelector = PREVIEW_SELECTOR_STYLES.includes(selectorStyle);
    const showModeSelector =
      this.config.show_mode_selector !== undefined
        ? this.config.show_mode_selector !== false
        : true;
    // Panel toggle is independent of the selector now.  Legacy fallback: it
    // used to live inside the text selector block, so respect the old
    // show_color_mode_selector=false as "hide panel toggle" for old configs.
    const showPanelToggle =
      this.config.show_panel_toggle !== undefined
        ? this.config.show_panel_toggle !== false
        : this.config.show_color_mode_selector !== false;
    const showAngleSection = this.config.show_angle_section !== false;
    const showAngleSlider = this.config.show_angle_slider !== false;

    const cardTitle =
      typeof this.config.title === "string" ? this.config.title.trim() : "";

    // Get current lamp state for runtime controls
    const colorMode = this._getCurrentMode() || "Solid Color";
    // Use optimistic panel mode if set, else backend state
    const applyToWholePanel =
      this._optimisticPanelMode !== undefined
        ? this._optimisticPanelMode
        : stateObj.attributes.full_panel || false;
    // Fill panel column selector: detect active column count from custom_text
    const currentCustomText = stateObj.attributes.custom_text || "";
    const fillPanelCols =
      this._optimisticFillCols !== undefined
        ? this._optimisticFillCols
        : FILL_PANEL_CHAR_TO_COLS[currentCustomText] || 0;

    // Get panel toggle style + shape + alignment from config
    const panelToggleStyle = this.config.panel_toggle_style || "minimal";
    const panelToggleShape = this.config.panel_toggle_shape || "round";
    const labelAlign = this.config.active_mode_label_align || "left";
    const panelToggleAlign = this.config.panel_toggle_align || "left";
    const _alignToJustify = (a) =>
      a === "center" ? "center" : a === "right" ? "flex-end" : "flex-start";

    // Check if rotary should be in header
    const rotaryInHeader = this.config.rotary_in_header === true;
    const showActiveModeLabel = this.config.show_active_mode_label === true;

    const cardContent = html`
      <div class="yc-stack" style="padding:16px;">
        ${!showCard && cardTitle ? html`<div style="font-weight:600;font-size:1.1em;">${cardTitle}</div>` : nothing}
        ${
          rotaryInHeader && showAngleSection
            ? html`
          <div class="card-header" style="display: flex; justify-content: flex-end; align-items: center;">
            <div class="header-rotary"
              @mousedown=${this._onAngleAreaMouseDown}
              @touchstart=${this._onAngleAreaTouchStart}
              @focusin=${this._onAngleAreaFocusIn}
              @focusout=${this._onAngleAreaFocusOut}
              @input=${this._onAngleAreaInput}
              @keydown=${this._onAngleAreaKeyDown}
              @change=${this._onAngleAreaChange}
              @mouseout=${this._onAngleAreaMouseOut}
            >${this._angleRotaryTemplate(currentAngle, true)}</div>
          </div>
        `
            : nothing
        }
        ${
          showModeSelector || showPanelToggle
            ? html`
        <!-- Runtime Controls: unified mode selector -->
        <div class="runtime-controls" ?hidden=${!(showActiveModeLabel || (showModeSelector && !isPreviewSelector))}>
          <div class="control-section yc-stack yc-controls">
            ${
              showActiveModeLabel
                ? html`<div style="display:flex;justify-content:${_alignToJustify(labelAlign)};width:100%;">
                     <div class="gc-active-mode-label" id="gc-active-mode-label" title="Currently active mode" style="margin:0;">
                       <span class="gc-aml-dot"></span>
                       <span class="gc-aml-text">${colorMode}</span>
                     </div>
                   </div>`
                : nothing
            }
            ${
              showModeSelector && !isPreviewSelector
                ? this.generateColorModeSelector(
                    colorMode,
                    selectorStyle,
                    textColors,
                    this._draggingRotary && this._pendingAngle !== undefined
                      ? this._pendingAngle
                      : currentAngle,
                  )
                : nothing
            }
          </div>
        </div>
        ${showModeSelector && isPreviewSelector ? this._previewHostTemplate() : nothing}
        <div id="preview-anchor" style="display:none;"></div>
        ${
          showPanelToggle
            ? html`
        <div class="panel-section-wrapper yc-row" style=${panelToggleStyle !== "card" && panelToggleStyle !== "tabs" ? `justify-content:${_alignToJustify(panelToggleAlign)};` : ""}>
          ${this._renderPanelToggle(applyToWholePanel, panelToggleStyle, panelToggleShape)}
          <div class="panel-toggle default" style="margin-top: 4px; display: none; align-items: center; gap: 8px;">
            <label for="fill-panel-cols" style="white-space: nowrap;">Fill Panel Test:</label>
            <select id="fill-panel-cols" style="flex: 1; padding: 4px;" @change=${this._onFillPanelChange}>
              <option value="0" ?selected=${fillPanelCols === 0}>Off</option>
              ${Array.from({ length: 20 }, (_, i) => i + 1).map(
                (n) =>
                  html`<option value=${n} ?selected=${fillPanelCols === n}>${n} col${n > 1 ? "s" : ""} (${n * 5} px)</option>`,
              )}
            </select>
          </div>
        </div>`
            : nothing
        }
        `
            : nothing
        }
        ${
          showAngleSection
            ? html`
        <div class="angle-section">
          <div class="angle-row"
            @mousedown=${this._onAngleAreaMouseDown}
            @touchstart=${this._onAngleAreaTouchStart}
            @focusin=${this._onAngleAreaFocusIn}
            @focusout=${this._onAngleAreaFocusOut}
            @input=${this._onAngleAreaInput}
            @keydown=${this._onAngleAreaKeyDown}
            @change=${this._onAngleAreaChange}
            @mouseout=${this._onAngleAreaMouseOut}
          >
            ${
              showAngleSlider && this._getRotaryStyleInfo().style !== "capsule"
                ? html`
              <input id="angleslider" class="angle-slider" type="range" min="0" max="359" step="1" value=${Math.round(currentAngle)}
                @mousedown=${this._onAngleSliderPress}
                @touchstart=${this._onAngleSliderPress}
                @input=${this._onAngleSliderInput}
                @mouseup=${this._onAngleSliderRelease}
                @touchend=${this._onAngleSliderRelease}
                @touchcancel=${this._onAngleSliderRelease}
                @mouseleave=${this._onAngleSliderLeave} />
            `
                : nothing
            }
            ${!rotaryInHeader ? this._angleRotaryTemplate(currentAngle) : nothing}
          </div>
        </div>
        `
            : nothing
        }
      </div>
    `;

    return showCard
      ? html`<ha-card header=${cardTitle || nothing}><div class="card-content">${cardContent}</div></ha-card>`
      : html`<div class="card-content">${cardContent}</div>`;
  }

  /**
   * Lit-rendered persistent host for the preview-style mode selector.  Its
   * `.preview-grid-container` content is shared-renderer HTML (gallery /
   * carousel / wheel / pagination) that the card updates in place
   * (surgical per-item swaps, wheel controller), so Lit renders the
   * container without child bindings and all item interactions are
   * delegated from the host.
   */
  _previewHostTemplate() {
    return html`<div class="yc-stack yc-controls" id="gc-preview-host"
      @click=${this._onPreviewClick}
      @touchstart=${this._previewTouchStartListener}
      @touchend=${this._previewTouchEndListener}
    ><div id="preview-section-container"><div class="preview-section yc-stack yc-controls"><div class="preview-grid-container" style="max-width: 100%; overflow: visible;"></div></div></div></div>`;
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (!this._rebuildPending || this._errorMessage != null) return;
    if (!this.shadowRoot?.querySelector(".card-content")) return;
    this._rebuildPending = false;
    this._afterRebuild();
  }

  /** Post-render work after the card skeleton was (re)rendered by Lit. */
  _afterRebuild() {
    const root = this.shadowRoot;
    const stateObj = this._hass?.states?.[this._getPrimaryEntity()];
    if (!root || !stateObj) return;
    const currentAngle = this._displayAngle(stateObj);

    const host = root.getElementById("gc-preview-host");
    if (host) {
      if (host !== this._previewElement) {
        // New host (first render, preview-structure change reset by
        // setConfig, or recovery from the error state): fill it from the
        // global preview cache and (re)load previews.
        if (this._wheelNavigationController) {
          this._wheelNavigationController.destroy();
          this._wheelNavigationController = null;
        }
        this._previewElement = host;
        const container = host.querySelector(".preview-grid-container");
        container.innerHTML = this._getCachedPreviewGrid();

        setTimeout(() => {
          if (!this._previewEventListenerRegistered) {
            this._setupPreviewEventListener();
          }
          // Only load previews if we don't have recent data in global cache
          const cache = this._previewCache();
          const timeSinceLastRequest = Date.now() - cache.timestamp;
          const hasRecentData = cache.data && timeSinceLastRequest < 5000; // 5 seconds

          if (!hasRecentData) {
            this._loadPreviews();
          } else {
            // Immediately render with cached data
            this._updatePreviewSection();
          }
        }, 100);
      }

      // Refresh preview content from latest global cache.  This catches
      // updates whose event-based _updatePreviewSection() ran before the
      // host existed.
      this._updatePreviewSection();

      // Handle pending wheel height update (host kept alive, container
      // content needs refresh with new height)
      if (this._pendingWheelHeightUpdate) {
        this._pendingWheelHeightUpdate = false;
        const container = host.querySelector(".preview-grid-container");
        if (container) {
          const newPreviewHtml = this._renderPreviewGrid();
          // Always keep overflow visible — hover highlights (border +
          // translate/scale transforms) were clipped by overflow:hidden.
          container.style.overflow = "visible";
          container.innerHTML = newPreviewHtml;
          this._cachedPreviewHtml = newPreviewHtml;
          // Sync the preview-data hash so _getCachedPreviewGrid won't
          // regenerate with stale values on the next call
          this._lastPreviewDataHash = this._previewCache().data
            ? JSON.stringify({
                text: this._previewCache().data.text,
                angle: Math.round(this._previewCache().data.angle * 10) / 10,
                bgColor: this.config.gallery_background_color,
                pixelStyle: this.config.gallery_pixel_style,
                pixelGap:
                  this.config.gallery_spacing_mode ||
                  this.config.gallery_pixel_spacing,
                previewSize: this.config.gallery_preview_size,
                ignoreBlack: this.config.gallery_ignore_black_pixels,
                matrixShadow: this.config.gallery_matrix_box_shadow,
                displayMode: this._getModeSelectorStyle(),
                showTitles: this.config.preview_show_titles,
                visibleModes: JSON.stringify(
                  this.config.custom_visible_modes === true
                    ? this.config.visible_modes || null
                    : null,
                ),
                buttonShape: resolveSelectorButtonShape(this.config),
                itemsPerPage: this.config.items_per_page || 0,
                selectorPage: this._selectorPage || 0,
                wheelHeight: this.config.wheel_height,
                wheelNavPosition: this.config.wheel_nav_position,
              })
            : null;
          // Use immediate mode for wheel re-init (skip double-rAF delay)
          this._wheelReInitializing = true;
          // Re-initialise the wheel controller for the new content
          this._attachPreviewEventListeners();
        }
      }

      // Safety net: ensure the wheel controller is alive in wheel display
      // mode (fixes disconnect/reconnect)
      if (
        this._getDisplayMode() === "wheel" &&
        !this._wheelNavigationController
      ) {
        const wheelExists = host.querySelector(
          ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
        );
        if (wheelExists) {
          requestAnimationFrame(() => {
            if (!this._wheelNavigationController) {
              this._setupWheelNavigation();
            }
          });
        }
      }
    }

    // Update active-mode highlight on the preview items
    this._markActiveMode();

    // Re-apply every dynamic value in place: Lit only patches bindings whose
    // template value changed, so DOM state written by the in-place sync
    // path (classes, input values, rotary visuals) is reconciled here.
    this._syncDynamicUI(stateObj, currentAngle);
  }

  /**
   * In-place update of every dynamic UI element.  Called instead of a full
   * DOM rebuild when the structural configuration is unchanged — this is
   * what makes state updates flicker-free.
   */
  _syncDynamicUI(stateObj, currentAngle) {
    const root = this.shadowRoot;
    if (!root) return;

    // 1. Text-style selector: active button / dropdown value
    this._syncTextSelector();

    // 2. Panel toggle state (checkbox + card-style active class)
    const applyToPanel =
      this._optimisticPanelMode !== undefined
        ? this._optimisticPanelMode
        : stateObj.attributes.full_panel || false;
    const panelCheckbox = root.getElementById("apply-to-panel");
    if (panelCheckbox && panelCheckbox.checked !== applyToPanel) {
      panelCheckbox.checked = applyToPanel;
    }
    const cardToggle = root.querySelector(
      ".panel-toggle.card[data-toggle-card='true']",
    );
    if (cardToggle) cardToggle.classList.toggle("active", applyToPanel);
    const tabsEl = root.querySelector(".panel-toggle.tabs");
    if (tabsEl) {
      tabsEl.dataset.active = applyToPanel ? "1" : "0";
      tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle(
          "active",
          (btn.dataset.panelSeg === "true") === applyToPanel,
        );
      });
    }
    const chipEl = root.querySelector(
      ".panel-toggle.chip[data-chip-toggle='true']",
    );
    if (chipEl) chipEl.classList.toggle("active", applyToPanel);
    const minimalEl = root.querySelector(
      ".panel-toggle.minimal[data-minimal-toggle='true']",
    );
    if (minimalEl) minimalEl.classList.toggle("active", applyToPanel);

    // 3. Fill-panel column selector value
    const fillSel = root.getElementById("fill-panel-cols");
    if (fillSel) {
      const cols =
        this._optimisticFillCols !== undefined
          ? this._optimisticFillCols
          : FILL_PANEL_CHAR_TO_COLS[stateObj.attributes.custom_text || ""] || 0;
      if (fillSel.value !== String(cols)) fillSel.value = String(cols);
    }

    // 4. Angle visuals (rotary/capsule/slider/value displays).
    //    render() already returns early during active drags, so this never
    //    fights the user's pointer.
    this._updateRotaryDisplay(currentAngle);
    this._syncAngleValueDisplay(currentAngle);
    const angleSlider = root.getElementById("angleslider");
    if (angleSlider) angleSlider.value = Math.round(currentAngle);
    this._updateGradientButtons(currentAngle);

    // 5. Preview section: highlight + content refresh from cache.
    //    _updatePreviewSection string-compares against the last HTML we set,
    //    so this is a no-op unless preview data actually changed.
    this._markActiveMode();
    this._updatePreviewSection();
  }

  /**
   * Sync the text-style mode selector (active classes / dropdown value)
   * to the current mode without rebuilding DOM.
   */
  _syncTextSelector() {
    const root = this.shadowRoot;
    if (!root) return;
    const mode = this._getCurrentMode() || "Solid Color";
    root.querySelectorAll(".mode-btn-filled, .mode-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    const dropdown = root.querySelector(".mode-select");
    if (dropdown && !this._dropdownOpen && dropdown.value !== mode) {
      dropdown.value = mode;
    }
  }

  // ── Declarative event handlers (bound in the Lit templates) ─────────────

  /** Text selector (filled buttons / chips) click. */
  _onModeButtonClick(e) {
    const root = this.shadowRoot;
    if (!root) return;
    const target = e.currentTarget;
    // Use currentTarget to get the button, not the clicked child element
    const mode = target.dataset.mode;
    if (!this._hass || !this._getPrimaryEntity() || this._processingModeChange)
      return;

    const modeSelectors = [
      ...root.querySelectorAll(".mode-btn-filled"),
      ...root.querySelectorAll(".mode-chip"),
    ];

    // OPTIMISTIC UI UPDATE - immediately show selection
    modeSelectors.forEach((button) => {
      button.classList.remove("active");
    });
    target.classList.add("active");

    // Disable all mode selectors during processing (but keep visual feedback)
    modeSelectors.forEach((button) => {
      button.style.pointerEvents = "none";
      if (!button.classList.contains("active")) {
        button.style.opacity = "0.6";
      }
    });

    // Also disable dropdown if present
    const dropdown = root.querySelector(".mode-select");
    if (dropdown) {
      dropdown.style.pointerEvents = "none";
      dropdown.style.opacity = "0.6";
    }

    this._selectMode(mode).finally(() => {
      // Re-enable all mode selectors
      modeSelectors.forEach((button) => {
        button.style.pointerEvents = "";
        button.style.opacity = "";
      });

      // Re-enable dropdown if present
      const dropdown = root.querySelector(".mode-select");
      if (dropdown) {
        dropdown.style.pointerEvents = "";
        dropdown.style.opacity = "";
      }
    });
  }

  // Dropdown selector: prevent re-render while the dropdown is open
  _onModeDropdownFocus() {
    this._dropdownOpen = true;
  }

  _onModeDropdownBlur() {
    this._dropdownOpen = false;
    this._flushPendingRender();
  }

  _onModeDropdownChange(e) {
    const modeDropdown = e.currentTarget;
    this._dropdownOpen = false; // Close flag when selection made
    this._flushPendingRender();
    const mode = e.target.value;
    if (!this._hass || this._processingModeChange) return;

    if (!this._getPrimaryEntity()) return;

    // Disable dropdown during processing, re-enable after
    modeDropdown.style.pointerEvents = "none";
    modeDropdown.style.opacity = "0.6";

    this._selectMode(mode).finally(() => {
      modeDropdown.style.pointerEvents = "";
      modeDropdown.style.opacity = "";
    });
  }

  /** "Apply to Whole Panel" checkbox change (every toggle style). */
  _onPanelCheckboxChange(e) {
    const panelCheckbox = e.currentTarget;
    if (!this._hass || !this._getPrimaryEntity()) return;
    const applyToPanel = panelCheckbox.checked;

    // Optimistically update UI (show new value immediately)
    this._optimisticPanelMode = applyToPanel;
    // Safety timeout: clear optimistic state if backend doesn't confirm within 5s
    if (this._panelModeTimeout) clearTimeout(this._panelModeTimeout);
    this._panelModeTimeout = setTimeout(() => {
      if (this._optimisticPanelMode !== undefined) {
        this._optimisticPanelMode = undefined;
        this._renderCard();
      }
    }, 5000);
    this._renderCard();

    // Disable checkbox while updating
    panelCheckbox.disabled = true;

    this.callServiceOnTargetEntities("set_full_panel", {
      full_panel: applyToPanel,
    })
      .then(() => {
        // Re-enable checkbox, but do NOT clear optimistic state here
        panelCheckbox.disabled = false;
        // Matrix preview updates instantly via matrix_colors entity state
        // (same as lamp preview card).  Gallery thumbnails still need
        // preview cache, so trigger a reload for those.
        this._loadPreviews().catch(() => {});
      })
      .catch((err) => {
        // On error, revert optimistic state
        this._optimisticPanelMode = undefined;
        panelCheckbox.disabled = false;
        this._renderCard();
      });
  }

  /** Fill Panel column selector change. */
  _onFillPanelChange(e) {
    if (!this._hass || !this._getPrimaryEntity()) return;
    // Guard: ignore rapid change events while a service call is in flight.
    if (this._fillPanelBusy) return;

    // DEBOUNCE: After each fill-panel change, enforce a 600ms cooldown
    // before the next change can be sent.  Rapid column-count changes
    // (1→5→10→20) each trigger activate_fx_mode + draw_matrices on the
    // backend.  The Cube firmware can become overwhelmed by rapid FX
    // sessions and enter a confused state where commands are silently
    // ignored, making the lamp appear stuck.
    const now = Date.now();
    if (this._fillPanelLastSend && now - this._fillPanelLastSend < 600) {
      return; // Drop this change — too soon after previous
    }
    const cols = parseInt(e.target.value, 10);

    // Optimistic UI update
    this._optimisticFillCols = cols;
    if (this._fillPanelTimeout) clearTimeout(this._fillPanelTimeout);
    this._fillPanelTimeout = setTimeout(() => {
      if (this._optimisticFillCols !== undefined) {
        this._optimisticFillCols = undefined;
        this._renderCard();
      }
    }, 5000);

    // Mark busy BEFORE render so another change event arriving meanwhile
    // short-circuits.
    this._fillPanelBusy = true;
    this._fillPanelLastSend = Date.now(); // Debounce timestamp
    this._renderCard();

    // Resolve the full list of target entities (same list used by
    // callServiceOnTargetEntities).
    const allTargets = getTargetEntities(this.config);

    if (cols > 0) {
      // Save each entity's current text before filling.
      // Use a Map so each entity can be restored to its own text.
      if (!this._savedTextPerEntity) {
        this._savedTextPerEntity = {};
      }
      for (const eid of allTargets) {
        const st = this._hass.states[eid];
        const curText = st?.attributes?.custom_text || "";
        // Only save if not already a fill char (avoid overwriting the
        // real text with another fill char when changing column count).
        if (!FILL_PANEL_CHAR_TO_COLS[curText]) {
          this._savedTextPerEntity[eid] = curText;
        }
      }
      this.callServiceOnTargetEntities("set_custom_text", {
        text: FILL_PANEL_CHARS[cols],
      })
        .then(() => {
          this._fillPanelBusy = false;
          this._renderCard();
        })
        .catch(() => {
          this._optimisticFillCols = undefined;
          this._fillPanelBusy = false;
          this._renderCard();
        });
    } else {
      // Off: restore each entity to its own previously-saved text.
      const saved = this._savedTextPerEntity || {};
      const restorePromises = allTargets.map(async (eid) => {
        const restoreText = saved[eid] ?? "";
        try {
          await this._commands.call(
            this._hass,
            "yeelight_cube",
            "set_custom_text",
            { text: restoreText, entity_id: eid },
          );
        } catch (err) {
          console.error(
            `[Gradient Card] Error restoring text for ${eid}:`,
            err,
          );
        }
      });
      Promise.all(restorePromises)
        .then(() => {
          this._fillPanelBusy = false;
          this._savedTextPerEntity = undefined;
          this._renderCard();
        })
        .catch(() => {
          this._optimisticFillCols = undefined;
          this._fillPanelBusy = false;
          this._renderCard();
        });
    }
  }

  // Panel toggle interactions: switch container/label and card style
  _onPanelToggleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    this._togglePanelCheckbox();
  }

  // Chip / minimal styles
  _onPanelChipClick(e) {
    e.preventDefault();
    this._togglePanelCheckbox();
  }

  // Tabs style: each segment sets an explicit value
  _onPanelTabClick(e) {
    e.preventDefault();
    const targetValue = e.currentTarget.dataset.panelSeg === "true";
    const cb = this.shadowRoot?.getElementById("apply-to-panel");
    if (cb && cb.checked !== targetValue) {
      cb.checked = targetValue;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  /**
   * Delegated click handler on the Lit-rendered preview host.  The preview
   * content itself is shared-renderer HTML (gallery / carousel / wheel /
   * pagination) that is swapped in place, so a single listener on the
   * persistent host replaces the per-item listeners (nothing can stack).
   */
  _onPreviewClick(e) {
    const host = e.currentTarget;
    const t = e.target;
    if (!t?.closest) return;
    const within = (el) => el && host.contains(el);

    // Carousel: prev/next buttons, indicator dots and the displayed item
    if (this._getDisplayMode() === "carousel") {
      const nav = t.closest('[data-action="navigate"]');
      if (within(nav)) {
        e.stopPropagation();
        const dir = parseInt(nav.dataset.direction, 10);
        this._gcCarouselNavigate(dir || 1);
        return;
      }
      const dot = t.closest('[data-action="set-index"]');
      if (within(dot)) {
        e.stopPropagation();
        const idx = parseInt(dot.dataset.index, 10);
        this._gcCarouselSetIndex(idx || 0);
        return;
      }
      const selectItem = t.closest('[data-action="select-mode"]');
      if (within(selectItem)) {
        e.stopPropagation();
        const mode = selectItem.dataset.mode;
        if (mode) this._selectMode(mode);
        return;
      }
    }

    // Preview item clicks - apply the selected mode
    const item = t.closest(".gallery-item[data-mode]");
    if (within(item)) {
      const mode = item.dataset.mode;
      if (mode) this._selectMode(mode);
      return;
    }

    // Pagination (list / grid modes)
    const pageBtn = t.closest("[data-pagination-page], [data-pagination-action]");
    if (within(pageBtn)) {
      const directPage = pageBtn.dataset.paginationPage;
      const action = pageBtn.dataset.paginationAction;
      let pageOrAction;
      if (directPage !== undefined) pageOrAction = parseInt(directPage, 10);
      else if (action === "prev" || action === "next") pageOrAction = action;
      else return;
      const cur = this._selectorPage || 0;
      this._selectorPage =
        pageOrAction === "prev"
          ? Math.max(0, cur - 1)
          : pageOrAction === "next"
            ? cur + 1
            : pageOrAction;
      this._lastPreviewDataHash = null; // Force preview re-render
      this._updatePreviewSection();
    }
  }

  // Carousel swipe gesture (delegated, passive listeners — see constructor)
  _onPreviewTouchStart(e) {
    if (this._getDisplayMode() !== "carousel") return;
    if (!e.target?.closest?.(".gc-preview-shell")) return;
    this._swipeStartX = e.touches[0].clientX;
  }

  _onPreviewTouchEnd(e) {
    if (this._getDisplayMode() !== "carousel") return;
    if (!e.target?.closest?.(".gc-preview-shell")) return;
    const dx = e.changedTouches[0].clientX - (this._swipeStartX || 0);
    if (Math.abs(dx) > 40) {
      this._gcCarouselNavigate(dx < 0 ? 1 : -1);
    }
  }

  // ── Angle controls (delegated from the Lit-rendered .angle-row /
  //    .header-rotary containers; also covers the shared capsule markup) ──

  _angleDragStart(e, touch) {
    const t = e.target;
    if (!t?.closest) return;
    // Value displays / inputs never start a drag (they need their own
    // clicks, and the read-only text must not move the selector).
    if (t.closest(ANGLE_NO_DRAG_SELECTOR)) {
      e.stopPropagation();
      return;
    }
    // Rotary (and its selector dot): click or drag to set angle
    if (!t.closest("#angle-preview")) return;
    e.preventDefault(); // Prevent text selection
    if (
      this.config.show_selector_dot !== false &&
      t.closest(".wheel-selector, .rect-selector, .square-selector")
    ) {
      e.stopPropagation();
    }
    this._draggingRotary = true;
    this._handleRotaryDrag(touch ? e.touches[0] : e);
    this._startRotaryDocDrag(touch);
  }

  _onAngleAreaMouseDown(e) {
    this._angleDragStart(e, false);
  }

  _onAngleAreaTouchStart(e) {
    this._angleDragStart(e, true);
  }

  // Block renders while the user is focused on the angle input so DOM
  // updates don't fight the typing.
  _onAngleAreaFocusIn(e) {
    if (e.target?.id === "angleinput") this._typingAngle = true;
  }

  _onAngleAreaFocusOut(e) {
    const angleInput = e.target;
    if (angleInput?.id !== "angleinput") return;
    this._typingAngle = false;
    // Apply the final value on blur (covers Tab-out, click-away)
    let angle = parseFloat(angleInput.value);
    if (!isNaN(angle)) {
      angle = Math.max(0, Math.min(359, angle));
      const angleSlider = this.shadowRoot?.getElementById("angleslider");
      if (angleSlider) angleSlider.value = angle;
      this._updateRotaryDisplay(angle);
      this._debouncedApplyAngle(angle);
    }
    this._flushPendingRender();
  }

  // Live visual feedback while typing (debounced backend call).
  _onAngleAreaInput(e) {
    const angleInput = e.target;
    if (angleInput?.id !== "angleinput") return;
    let angle = parseFloat(angleInput.value);
    if (isNaN(angle)) return; // incomplete input, skip
    angle = Math.max(0, Math.min(359, angle));
    const angleSlider = this.shadowRoot?.getElementById("angleslider");
    if (angleSlider) angleSlider.value = angle;
    this._updateRotaryDisplay(angle);
    this._debouncedApplyAngle(angle);
  }

  // Enter key: apply immediately and blur (confirms the value)
  _onAngleAreaKeyDown(e) {
    if (e.target?.id === "angleinput" && e.key === "Enter") {
      e.target.blur();
    }
  }

  // Capsule slider safety handlers: `change` fires reliably when the native
  // slider finalises its value; leaving the input covers releases outside.
  _onAngleAreaChange(e) {
    if (e.target?.matches?.(".angle-capsule-host .capsule-input")) {
      this._endCapsuleDrag();
    }
  }

  _onAngleAreaMouseOut(e) {
    const input = e.target;
    if (!input?.matches?.(".angle-capsule-host .capsule-input")) return;
    if (e.relatedTarget && input.contains(e.relatedTarget)) return;
    if (this._angleHeld) return;
    if (this._usingSlider) {
      setTimeout(() => {
        this._usingSlider = false;
        this._flushPendingRender();
      }, 200);
    }
  }

  // Standalone angle slider
  _onAngleSliderInput(e) {
    this._usingSlider = true; // Flag to prevent re-renders during slider use
    let angle = parseFloat(e.currentTarget.value);
    if (isNaN(angle)) angle = 0;
    this._syncAngleValueDisplay(angle);
    this._updateRotaryDisplay(angle);
    this._debouncedApplyAngle(angle);
  }

  // Clear the slider flag when slider interaction ends
  _onAngleSliderRelease() {
    setTimeout(() => {
      this._usingSlider = false;
      this._flushPendingRender();
    }, 100);
  }

  // Safety timeout to ensure flag gets cleared
  _onAngleSliderLeave() {
    if (this._angleHeld) return;
    setTimeout(() => {
      this._usingSlider = false;
      this._flushPendingRender();
    }, 200);
  }

  _renderPanelToggle(applyToWholePanel, style, shape = "round") {
    // Use optimistic value if set
    if (this._optimisticPanelMode !== undefined) {
      applyToWholePanel = this._optimisticPanelMode;
    }

    // Inline legacy migrations so old saved configs render correctly
    // without requiring an editor round-trip to normalise.
    if (style === "default") style = "minimal";
    if (style === "segmented") style = "tabs";

    switch (style) {
      case "switch":
        return html`
          <div class="panel-toggle switch" data-shape=${shape}>
            <label for="apply-to-panel" @click=${this._onPanelToggleClick}>Apply to Whole Panel</label>
            <div class="switch-container" @click=${this._onPanelToggleClick}>
              <input type="checkbox" id="apply-to-panel" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
              <span class="switch-slider"></span>
            </div>
          </div>
        `;

      case "card":
        return html`
          <div class="panel-toggle card ${
            applyToWholePanel ? "active" : ""
          }" data-shape=${shape} data-toggle-card="true" @click=${this._onPanelToggleClick}>
            <label for="apply-to-panel">Apply to Whole Panel</label>
            <div class="card-indicator"></div>
            <input type="checkbox" id="apply-to-panel" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
          </div>
        `;

      case "tabs":
        return html`
          <div class="panel-toggle tabs" data-shape=${shape} data-active=${applyToWholePanel ? "1" : "0"}>
            <input type="checkbox" id="apply-to-panel" style="display:none;" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
            <div class="tabs-thumb"></div>
            <button class="tab-btn${!applyToWholePanel ? " active" : ""}" data-panel-seg="false" @click=${this._onPanelTabClick}>
              <svg width="12" height="9" viewBox="0 0 12 9" fill="currentColor" style="flex-shrink:0;opacity:0.75"><rect x="0" y="0" width="3" height="3" rx="0.5"/><rect x="4.5" y="0" width="3" height="3" rx="0.5"/><rect x="9" y="0" width="3" height="3" rx="0.5"/><rect x="0" y="5" width="3" height="3" rx="0.5"/><rect x="4.5" y="5" width="3" height="3" rx="0.5"/><rect x="9" y="5" width="3" height="3" rx="0.5"/></svg>
              Pixels
            </button>
            <button class="tab-btn${applyToWholePanel ? " active" : ""}" data-panel-seg="true" @click=${this._onPanelTabClick}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="flex-shrink:0;opacity:0.85"><rect x="0" y="0" width="5" height="5" rx="1"/><rect x="7" y="0" width="5" height="5" rx="1"/><rect x="0" y="7" width="5" height="5" rx="1"/><rect x="7" y="7" width="5" height="5" rx="1"/></svg>
              Panel
            </button>
          </div>
        `;

      case "chip":
        return html`
          <div class="panel-toggle chip${applyToWholePanel ? " active" : ""}" data-shape=${shape} data-chip-toggle="true" @click=${this._onPanelChipClick}>
            <input type="checkbox" id="apply-to-panel" style="display:none;" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
            <span class="chip-dot"></span>
            <span class="chip-text">Whole Panel</span>
          </div>
        `;

      case "minimal":
      default:
        return html`
          <div class="panel-toggle minimal${applyToWholePanel ? " active" : ""}" data-shape=${shape} data-minimal-toggle="true" @click=${this._onPanelChipClick}>
            <input type="checkbox" id="apply-to-panel" style="display:none;" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
            <span class="minimal-indicator"></span>
            <span class="minimal-text">Whole Panel</span>
          </div>
        `;
    }
  }

  _togglePanelCheckbox() {
    const root = this.shadowRoot;
    if (!root) return;

    const checkbox = root.getElementById("apply-to-panel");
    if (!checkbox) return;

    // Toggle the checkbox state
    checkbox.checked = !checkbox.checked;

    // Create and dispatch a change event to trigger the existing change handler
    const changeEvent = new Event("change", { bubbles: true });
    checkbox.dispatchEvent(changeEvent);
  }

  _updatePreviewSection() {
    // Nothing to update when the selector doesn't render previews (e.g. a
    // stale preview event arriving right after switching to a text style).
    if (!this._isPreviewSelectorActive()) return;

    const displayMode = this._getDisplayMode();

    // For wheel mode, try surgical update first (only update preview images)
    // But if wheel doesn't exist yet, fall through to full render
    if (displayMode === "wheel") {
      const wheelExists = this.shadowRoot?.querySelector(
        ".wheel-item[data-mode]",
      );
      // wheelExists: !!wheelExists,
      // wheelItemsCount:
      // this.shadowRoot?.querySelectorAll(".wheel-item").length,
      // allWheelItems: Array.from(
      // this.shadowRoot?.querySelectorAll(".wheel-item") || []
      // ).map((item) => item.dataset.mode),
      // });

      if (wheelExists) {
        // Ensure wheel controller is initialized
        if (!this._wheelNavigationController) {
          this._attachPreviewEventListeners();
        }

        this._updateWheelPreviews();
        return;
      } else {
        // "[Gradient Card] Wheel doesn't exist yet, will do full render"
        // );
      }
    }

    // For other modes OR if wheel doesn't exist yet, update the entire container
    const container = this.shadowRoot?.querySelector(".preview-grid-container");
    if (container) {
      // Always keep overflow visible — hover highlights (border + transforms
      // like translateY/scale) on preview items were clipped at the container
      // edges by the previous overflow:hidden.  Items are max-width-bounded so
      // nothing can actually escape the layout.
      container.style.overflow = "visible";

      // Generate new preview HTML with updated data
      const newPreviewHtml = this._renderPreviewGrid();
      const presentationKey = this._getPreviewPresentationKey();

      // Compare against the LAST HTML STRING WE SET — not container.innerHTML.
      // The browser re-serializes DOM (attribute order, entity encoding), so
      // `container.innerHTML !== generatedString` was effectively ALWAYS true
      // and every call replaced the full preview DOM — the primary source of
      // visible blinking on each state/preview update.
      if (newPreviewHtml !== this._cachedPreviewHtml) {
        // SURGICAL ITEM UPDATE (same technique the wheel uses): when only the
        // preview CONTENT changed (text/colors/angle) and the item structure
        // and presentation are identical, re-render just each item's matrix
        // image.  The container DOM — layout, hover state, listeners — is
        // untouched, so content updates are completely flicker-free.
        const structureStable =
          presentationKey === this._lastPreviewPresentationKey;
        if (structureStable && this._updateGalleryItemPreviews()) {
          this._cachedPreviewHtml = newPreviewHtml;
        } else {
          container.innerHTML = newPreviewHtml;
          this._cachedPreviewHtml = newPreviewHtml;
          // Refresh highlight / wheel controller for the new preview DOM
          // (clicks are delegated from the persistent preview host)
          this._attachPreviewEventListeners();
        }
      } else {
        // Content unchanged — refresh the active-mode highlight and make
        // sure the wheel controller exists (e.g. after a host re-render).
        this._attachPreviewEventListeners();
      }
      this._lastPreviewPresentationKey = presentationKey;
    } else {
      console.warn("[Gradient Card] Container not found in DOM!");
    }
  }

  /**
   * Presentation-affecting config signature.  When this changes, the preview
   * container structure must be rebuilt; when only content (text/colors/angle)
   * changes, per-item surgical updates are safe.
   */
  _getPreviewPresentationKey() {
    const cfg = this.config || {};
    return JSON.stringify({
      display: this._getModeSelectorStyle(),
      bg: cfg.gallery_background_color,
      px: cfg.gallery_pixel_style,
      gap: cfg.gallery_spacing_mode || cfg.gallery_pixel_spacing,
      size: cfg.gallery_preview_size,
      ib: cfg.gallery_ignore_black_pixels,
      titles: cfg.preview_show_titles,
      shadow: cfg.gallery_matrix_box_shadow,
      vis: cfg.custom_visible_modes === true ? cfg.visible_modes || null : null,
      shape: resolveSelectorShape(cfg),
      bshape: resolveSelectorButtonShape(cfg),
      ipp: cfg.items_per_page || 0,
      pg: this._selectorPage || 0,
      ci: this._carouselIndex ?? null, // carousel slide is part of presentation
    });
  }

  /**
   * Surgically update the matrix image inside each gallery item (list / row
   * display modes) from the current preview cache — the gallery counterpart
   * of _updateWheelPreviews().  Returns true when all items were updated in
   * place; false when the item structure doesn't match (caller falls back to
   * a full container swap).
   */
  _updateGalleryItemPreviews() {
    const previewData = this._previewCache().data;
    if (!previewData) return false;
    // Paginated views render a slice — use the full rebuild path there.
    if ((parseInt(this.config.items_per_page) || 0) > 0) return false;

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;

    const expectedModes = this._orderedModes().filter(
      (m) => previewData.previews[m],
    );
    const items = Array.from(
      this.shadowRoot?.querySelectorAll(
        ".gallery-item[data-mode]:not(.wheel-item)",
      ) || [],
    );
    if (items.length !== expectedModes.length) return false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].dataset.mode !== expectedModes[i]) return false;
    }

    // Same option resolution as _renderPreviewGrid / _updateWheelPreviews
    const galleryBgColor = this.config.gallery_background_color || "black";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPreviewSize = galleryPreviewSizeToPx(
      this.config.gallery_preview_size,
    );
    const gallerySpacingMode =
      this.config.gallery_spacing_mode ||
      (this.config.gallery_pixel_spacing !== false ? "normal" : "none");
    const galleryPixelGap = gallerySpacingMode === "normal" ? 3 : 0;
    const galleryPixelBoxShadow =
      gallerySpacingMode === "subtle" || gallerySpacingMode === "normal";
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;
    // Effective preview size must match _renderPreviewGrid exactly, or the
    // surgical updater rewrites items at a different size than the initial
    // render (grid = half, strip = mini), causing a size "jump" on every update.
    const selectorStyle = this._getModeSelectorStyle();
    const effectivePreviewSize =
      selectorStyle === "preview-grid"
        ? Math.round(galleryPreviewSize * 0.5)
        : selectorStyle === "preview-strip"
          ? Math.round(galleryPreviewSize * 0.4)
          : galleryPreviewSize;

    for (const item of items) {
      const previewColors = previewData.previews[item.dataset.mode];
      if (!previewColors) return false;
      const previewContainer = item.querySelector(".gallery-matrix-preview");
      if (!previewContainer) return false;

      // Flip vertically (same convention as _renderPreviewGrid)
      const flippedColors = [];
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          flippedColors.push(previewColors[row * cols + col]);
        }
      }

      previewContainer.outerHTML = this._renderSingleMatrixPreview(
        flippedColors,
        {
          rows,
          cols,
          bgColor: galleryBgColor,
          pixelStyle: galleryPixelStyle,
          pixelGap: galleryPixelGap,
          previewSize: effectivePreviewSize,
          ignoreBlackPixels,
          matrixBoxShadow: this.config.gallery_matrix_box_shadow === true,
          pixelBoxShadow: galleryPixelBoxShadow,
        },
      );
    }

    // Keep the highlight consistent after image swaps
    this._markActiveMode();
    return true;
  }

  /**
   * Surgically update only the preview images within wheel items
   * This avoids destroying and re-creating the wheel structure
   */
  _updateWheelPreviews() {
    const previewData = this._previewCache().data;
    if (!previewData) {
      return;
    }

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;

    // Get gallery settings from config
    const galleryBgColor = this.config.gallery_background_color || "black";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPreviewSize = galleryPreviewSizeToPx(
      this.config.gallery_preview_size,
    );
    const galleryPixelGap =
      (this.config.gallery_spacing_mode ||
        (this.config.gallery_pixel_spacing !== false ? "normal" : "none")) ===
      "normal"
        ? 3
        : 0;
    const gallerySpacingModeResolved =
      this.config.gallery_spacing_mode ||
      (this.config.gallery_pixel_spacing !== false ? "normal" : "none");
    const galleryPixelBoxShadow =
      gallerySpacingModeResolved === "subtle" ||
      gallerySpacingModeResolved === "normal";
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;
    const wheelItems = this.shadowRoot.querySelectorAll(
      ".wheel-item[data-mode]",
    );

    let updatedCount = 0;
    wheelItems.forEach((item) => {
      const mode = item.dataset.mode;
      const previewColors = previewData.previews[mode];

      if (!previewColors) return;

      // Flip vertically: reverse rows to fix upside-down display
      const flippedColors = [];
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          const color = previewColors[row * cols + col];
          flippedColors.push(color);
        }
      }

      // Find the preview container within this item
      const previewContainer = item.querySelector(".gallery-matrix-preview");
      if (previewContainer) {
        // Generate new preview HTML
        const newPreviewHtml = this._renderSingleMatrixPreview(flippedColors, {
          rows,
          cols,
          bgColor: galleryBgColor,
          pixelStyle: galleryPixelStyle,
          pixelGap: galleryPixelGap,
          previewSize: galleryPreviewSize,
          ignoreBlackPixels,
          matrixBoxShadow: this.config.gallery_matrix_box_shadow === true,
          pixelBoxShadow: galleryPixelBoxShadow,
        });

        // Update only the preview content
        previewContainer.outerHTML = newPreviewHtml;
        updatedCount++;
      }
    });

    // "[Gradient Card] Updated preview images in",
    // wheelItems.length,
    // "wheel items"
    // );

    // Refresh active-mode highlighting on wheel items
    this._markActiveMode();
  }

  /**
   * Render a single matrix preview (delegates to shared renderMatrixPreview utility)
   */
  _renderSingleMatrixPreview(colorData, options) {
    return renderMatrixPreview(colorData, options);
  }

  /**
   * Return the primary entity ID (first target entity, or fallback single entity).
   */
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

  /**
   * Return the resolved unified mode-selector style (see resolveModeSelectorStyle).
   */
  _getModeSelectorStyle() {
    return resolveModeSelectorStyle(this.config);
  }

  /**
   * True when the mode selector is shown AND uses a preview style.
   * All preview machinery (backend preview service, event subscription,
   * wheel controller, persistent preview element) is active only then.
   */
  _isPreviewSelectorActive() {
    if (this.config?.show_mode_selector === false) return false;
    return PREVIEW_SELECTOR_STYLES.includes(this._getModeSelectorStyle());
  }

  /**
   * Return the normalised preview display mode derived from the unified
   * selector style: list / compact / carousel / wheel.
   * (preview-grid renders through the list renderer with a fixed column
   * override — see the [data-columns] CSS.)
   */
  _getDisplayMode() {
    const style = this._getModeSelectorStyle();
    if (style === "preview-wheel") return "wheel";
    if (style === "preview-carousel") return "carousel";
    if (style === "preview-strip") return "strip";
    return "list";
  }

  /**
   * Return the current gradient mode, preferring the optimistic (pending) mode.
   * Falls back to the entity's reported mode, or null.
   */
  _getCurrentMode() {
    if (this._optimisticMode) return this._optimisticMode;
    const primaryEntity = this._getPrimaryEntity();
    const entityState = primaryEntity && this._hass?.states[primaryEntity];
    return entityState?.attributes?.mode || null;
  }

  /**
   * Shared mode-selection logic: set optimistic state, call backend, clean up.
   * Callers handle any UI-specific disabling/enabling around this.
   */
  async _selectMode(mode) {
    if (this._processingModeChange) return;
    this._processingModeChange = true;

    this._optimisticMode = mode;
    this._lastModeChangeTime = Date.now();
    this._markActiveMode();
    // In-flight feedback: pulse the selected item until the backend confirms
    this._setPendingPulse(mode);

    // Read the panel setting from the checkbox when rendered; when the panel
    // toggle is hidden (show_panel_toggle=false) fall back to the entity's
    // actual full_panel state so selecting a mode never silently disables
    // panel mode.
    const panelCheckbox = this.shadowRoot?.getElementById("apply-to-panel");
    const applyToPanel = panelCheckbox
      ? panelCheckbox.checked
      : this._optimisticPanelMode !== undefined
        ? this._optimisticPanelMode
        : this._hass?.states[this._getPrimaryEntity()]?.attributes
            ?.full_panel || false;

    try {
      const result = await this.callServiceOnTargetEntities(
        "set_mode",
        { mode, full_panel: applyToPanel },
        // Quick successive picks only send the latest one.
        { coalesce: "select" },
      );
      // Never sent: the newer pick owns the highlight and the wheel.
      if (result === SUPERSEDED) return;
      // Keep _optimisticMode SET until the backend echoes the new mode back
      // through entity state (cleared in `set hass`).  The service resolves
      // before the hardware command completes (fire-and-forget backend), so
      // clearing after a blind delay made the highlight snap back to the OLD
      // mode until the echo arrived — a visible blink on every selection.
      // Safety timeout: drop the optimistic state if no echo arrives (e.g.
      // lamp offline) so the UI resyncs with reality.
      if (this._optimisticModeTimeout)
        clearTimeout(this._optimisticModeTimeout);
      this._optimisticModeTimeout = setTimeout(() => {
        this._optimisticModeTimeout = null;
        if (this._optimisticMode) {
          this._optimisticMode = null;
          if (this.isConnected) this._markActiveMode();
        }
      }, 5000);
      // For wheel mode, sync wheel position to the new mode and update highlight
      if (this._getDisplayMode() === "wheel") {
        this._lastWheelMode = mode;
        this._syncWheelToCurrentMode();
        this._markActiveMode();
      } else {
        this._renderCard();
      }
    } catch (error) {
      console.error("Error changing mode:", error);
      this._optimisticMode = null;
      if (this._optimisticModeTimeout) {
        clearTimeout(this._optimisticModeTimeout);
        this._optimisticModeTimeout = null;
      }
      if (this._getDisplayMode() === "wheel") {
        this._syncWheelToCurrentMode();
        this._markActiveMode();
      } else {
        this._renderCard();
      }
    } finally {
      this._processingModeChange = false;
    }
  }

  /**
   * Update data-active-mode attributes on all gallery/wheel items in the DOM.
   * Called after DOM updates to keep the active-mode highlight in sync.
   */
  _markActiveMode() {
    const root = this.shadowRoot;
    if (!root) return;

    const highlightActive = this.config?.highlight_active_mode !== false;
    const currentMode = highlightActive ? this._getCurrentMode() : null;

    // Set host attribute so CSS can conditionally style wheel-centered items
    this.dataset.highlightActive = highlightActive ? "true" : "false";

    // Update gallery items (.gallery-item) and wheel items (.wheel-item)
    const allItems = root.querySelectorAll("[data-mode]");
    allItems.forEach((item) => {
      // Carousel: navigation = instant selection; the active-mode ring
      // would be a distracting flash on the only visible item.
      if (this._getDisplayMode() === "carousel") {
        item.removeAttribute("data-active-mode");
        return;
      }
      const mode = item.dataset.mode;
      if (highlightActive && currentMode && mode === currentMode) {
        item.setAttribute("data-active-mode", "true");
      } else {
        item.removeAttribute("data-active-mode");
      }
    });

    // Active-mode label chip: update text in place (independent of highlight)
    const label = root.getElementById("gc-active-mode-label");
    if (label) {
      const txt = label.querySelector(".gc-aml-text");
      const modeForLabel = this._getCurrentMode() || "—";
      if (txt && txt.textContent !== modeForLabel) {
        txt.textContent = modeForLabel;
      }
    }

    // Selection pulse: clear once the backend has confirmed (no optimistic
    // mode pending anymore)
    if (!this._optimisticMode) {
      root
        .querySelectorAll(".gc-pending")
        .forEach((el) => el.classList.remove("gc-pending"));

      // Release the carousel-navigating guard ONLY when the echoed backend
      // mode matches what the carousel is currently displaying.
      //
      // Critical timing issue this fixes: _gcCarouselNavigate calls
      // _updatePreviewSection() BEFORE _selectMode(), so _optimisticMode is
      // still null at that point. Without this check, the guard would be
      // released immediately, the sync block below would fire with the OLD
      // entity mode, and _carouselIndex would flash back to the previous item.
      if (this._carouselNavigating) {
        const _navModes = this._getVisibleModeList();
        const _displayedMode = _navModes[this._carouselIndex];
        const _echoedMode = this._getCurrentMode(); // entity, since _optimisticMode is null
        if (_displayedMode && _echoedMode === _displayedMode) {
          // Echo confirmed our navigation — safe to release the guard.
          this._setCarouselNavigating(false);
        }
        // If modes don't match yet, keep the guard: either the echo hasn't
        // arrived or _selectMode hasn't set _optimisticMode yet.
      }
    }

    // Carousel follows the active mode when it changes EXTERNALLY
    // (automations, another card, select entity) — but NEVER while the user
    // is navigating the carousel (_carouselNavigating) or while a selection
    // is in-flight (_processingModeChange / _optimisticMode).  Previously
    // a race between a fast echo clearing _optimisticMode and the finally
    // block clearing _processingModeChange allowed a brief window where
    // this block would reset _carouselIndex back to the OLD mode, causing
    // the carousel to flash the previous item before the echo arrived.
    if (
      this._getModeSelectorStyle() === "preview-carousel" &&
      !this._carouselNavigating &&
      !this._processingModeChange &&
      !this._optimisticMode &&
      this._carouselIndex != null
    ) {
      const activeMode = this._getCurrentMode();
      const modes = this._getVisibleModeList();
      const idx = activeMode ? modes.indexOf(activeMode) : -1;
      if (idx >= 0 && idx !== this._carouselIndex) {
        this._carouselIndex = idx;
        this._updatePreviewSection();
      }
    }
  }

  _attachPreviewEventListeners() {
    const root = this.shadowRoot;
    if (!root) return;

    // Item, carousel, pagination and swipe interactions are delegated from
    // the Lit-rendered preview host (see _onPreviewClick), so nothing is
    // bound per item here — only the active-mode highlight and the shared
    // wheel controller (which binds to the wheel DOM itself) are refreshed.

    // Mark the active mode item in the DOM
    this._markActiveMode();

    // Setup wheel mode navigation
    // After DOM update, we need to re-initialize if wheel was destroyed
    if (this._getDisplayMode() === "wheel") {
      if (!this._wheelNavigationController) {
        this._setupWheelNavigation();
      }
    }
  }

  /** Ordered list of currently visible gradient modes (matches preview items). */
  _getVisibleModeList() {
    // Fall back to the full visible mode list when preview data hasn't
    // arrived yet so carousel navigation works from the very first render.
    const data = this._previewCache().data;
    const modes = this._orderedModes();
    if (!data) return modes;
    return modes.filter((m) => data.previews[m]);
  }

  // In carousel mode navigation IS selection: one item displayed at a time,
  // moving to the next/previous immediately applies that mode to the lamp.
  _gcCarouselNavigate(direction) {
    const modes = this._getVisibleModeList();
    if (!modes.length) {
      return;
    }
    if (this._carouselIndex == null) {
      const active = this._getCurrentMode();
      const idx = active ? modes.indexOf(active) : -1;
      this._carouselIndex = idx >= 0 ? idx : 0;
    }
    const next =
      (((this._carouselIndex + direction) % modes.length) + modes.length) %
      modes.length;
    this._carouselIndex = next;
    // Show the new item IMMEDIATELY so the UI is responsive before the
    // service round-trip completes.
    this._setCarouselNavigating(true);
    this._updatePreviewSection();
    this._selectMode(modes[next]);
  }

  _gcCarouselSetIndex(index) {
    const modes = this._getVisibleModeList();
    if (!modes.length) return;
    const clamped = Math.max(0, Math.min(index, modes.length - 1));
    this._carouselIndex = clamped;
    this._setCarouselNavigating(true);
    this._updatePreviewSection();
    this._selectMode(modes[clamped]);
  }

  /**
   * Set / clear the _carouselNavigating guard.  While active, the
   * external-sync block in _markActiveMode is suppressed so no intermediate
   * state-change render can flash _carouselIndex back to the old mode.
   * Released automatically when the echo confirms the new mode, with a
   * 5 s safety timeout in case the echo never arrives.
   */
  _setCarouselNavigating(active) {
    if (this._carouselNavTimer) {
      clearTimeout(this._carouselNavTimer);
      this._carouselNavTimer = null;
    }
    this._carouselNavigating = !!active;
    if (active) {
      this._carouselNavTimer = setTimeout(() => {
        this._carouselNavTimer = null;
        this._carouselNavigating = false;
      }, 5000);
    }
  }

  /**
   * Selection feedback mechanic: pulse the chosen item(s) while the command
   * is in flight.  Cleared by _markActiveMode once the backend confirms.
   */
  _setPendingPulse(mode) {
    const root = this.shadowRoot;
    if (!root) return;
    // Carousel: navigation is instant selection; no in-flight pulse needed.
    if (this._getDisplayMode() === "carousel") return;
    root
      .querySelectorAll(".gc-pending")
      .forEach((el) => el.classList.remove("gc-pending"));
    if (!mode) return;
    root.querySelectorAll("[data-mode]").forEach((el) => {
      if (el.dataset.mode === mode) el.classList.add("gc-pending");
    });
  }

  _syncWheelToCurrentMode() {
    if (!this._wheelNavigationController) {
      // Self-healing: if controller is missing but we're in wheel mode with items in DOM, re-init
      const displayMode = this._getDisplayMode();
      const wheelExists = this.shadowRoot?.querySelector(
        ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
      );
      if (displayMode === "wheel" && wheelExists) {
        console.warn(
          "[Gradient Card] _syncWheelToCurrentMode: controller missing but wheel items exist — re-initializing",
          {
            displayMode,
            wheelItemsCount: this.shadowRoot?.querySelectorAll(
              ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
            ).length,
          },
        );
        this._setupWheelNavigation();
      }
      return;
    }
    this._wheelNavigationController.sync();
  }

  _setupWheelNavigation() {
    const displayMode = this._getDisplayMode();

    // Clean up previous controller if exists
    if (this._wheelNavigationController) {
      this._wheelNavigationController.destroy();
      this._wheelNavigationController = null;
    }

    // Check if this is a re-initialization (preview update) or first load
    const isReInitializing = this._wheelReInitializing || false;
    this._wheelReInitializing = false; // Reset flag

    // Derive wheel display style from showTitles setting
    const showTitles = this.config.preview_show_titles !== false;
    const derivedConfig = {
      ...this.config,
      wheel_display_style: showTitles ? "default" : "compact",
    };

    // Initialize new controller
    const controller = initializeWheelNavigation({
      shadowRoot: this.shadowRoot,
      displayMode,
      config: derivedConfig,
      currentCenterIndex: this._wheelCenterIndex,
      immediate: isReInitializing, // Skip animation delay if re-initializing
      onModeSelect: async (mode, index) => {
        this._wheelCenterIndex = index;
        await this._selectMode(mode);
      },
      getCurrentMode: () => this._getCurrentMode(),
    });

    // Verify the controller actually found items — initializeWheelNavigation
    // returns a no-op stub when container/items are missing. Storing that stub
    // as truthy blocks later re-initialization when items DO appear in the DOM.
    const wheelItemsInDOM =
      this.shadowRoot?.querySelectorAll(
        '[data-wheel-item="true"], [data-wheel-compact-item="true"]',
      ).length || 0;

    if (wheelItemsInDOM === 0) {
      // Expected during connectedCallback before first render — not an error.
      controller.destroy();
      this._wheelNavigationController = null;
    } else {
      this._wheelNavigationController = controller;
      this._wheelCenterIndex = controller.getCenterIndex();
    }
  }

  _getCachedPreviewGrid() {
    // Generate a hash of the preview data to detect changes
    // Round angle to avoid re-renders on tiny floating point changes
    const previewData = this._previewCache().data;
    // hasData: !!previewData,
    // displayMode: this.config.preview_display_mode,
    // });

    const currentHash = previewData
      ? JSON.stringify({
          text: previewData.text,
          angle: Math.round(previewData.angle * 10) / 10, // Round to 1 decimal
          bgColor: this.config.gallery_background_color,
          pixelStyle: this.config.gallery_pixel_style,
          pixelGap:
            this.config.gallery_spacing_mode ||
            this.config.gallery_pixel_spacing,
          previewSize: this.config.gallery_preview_size,
          ignoreBlack: this.config.gallery_ignore_black_pixels,
          matrixShadow: this.config.gallery_matrix_box_shadow,
          displayMode: this._getModeSelectorStyle(),
          showTitles: this.config.preview_show_titles,
          visibleModes: JSON.stringify(
            this.config.custom_visible_modes === true
              ? this.config.visible_modes || null
              : null,
          ),
          buttonShape: resolveSelectorButtonShape(this.config),
          itemsPerPage: this.config.items_per_page || 0,
          selectorPage: this._selectorPage || 0,
          wheelHeight: this.config.wheel_height,
          wheelNavPosition: this.config.wheel_nav_position,
        })
      : null;

    // Only re-render if data actually changed
    if (currentHash !== this._lastPreviewDataHash) {
      this._lastPreviewDataHash = currentHash;
      this._cachedPreviewHtml = this._renderPreviewGrid();
      // htmlLength: this._cachedPreviewHtml?.length,
      // containsWheelDisplay: this._cachedPreviewHtml?.includes(
      // 'class="wheel-display"'
      // ),
      // });
    } else {
    }

    return this._cachedPreviewHtml || this._renderPreviewGrid();
  }

  _renderPreviewGrid() {
    const previewData = this._previewCache().data;
    if (!previewData) {
      return ``; // Return empty instead of "Loading previews..." message
    }

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;
    // Get gallery settings from config
    const galleryBgColor = this.config.gallery_background_color || "black";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPreviewSize = galleryPreviewSizeToPx(
      this.config.gallery_preview_size,
    );
    const galleryPixelGap =
      (this.config.gallery_spacing_mode ||
        (this.config.gallery_pixel_spacing !== false ? "normal" : "none")) ===
      "normal"
        ? 3
        : 0;
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;
    const displayMode = this._getDisplayMode();
    const showTitles = this.config.preview_show_titles !== false;
    // Derive showCards per mode:
    //   list  → always plain
    //   compact → cards when titles on, plain when titles off
    //   wheel → always cards
    const showCards =
      displayMode === "wheel" || displayMode === "strip"
        ? true
        : displayMode === "compact"
          ? showTitles
          : false; // list = always plain

    // Prepare items for the shared gallery utility (visible modes only, in
    // the user's configured order).
    const items = this._orderedModes()
      .map((mode) => {
        const previewColors = previewData.previews[mode];
        if (!previewColors) return null;

        // Flip vertically: reverse rows to fix upside-down display
        const flippedColors = [];
        for (let row = rows - 1; row >= 0; row--) {
          for (let col = 0; col < cols; col++) {
            const color = previewColors[row * cols + col];
            flippedColors.push(color);
          }
        }

        return {
          title: mode.replace(" Gradient", ""),
          name: mode, // used by renderCarouselString for dot tooltips
          colorData: flippedColors,
          dataMode: mode, // For click handler
          metadata: null,
        };
      })
      .filter((item) => item !== null);

    // Render using shared utility.
    // IMPORTANT: the active-mode highlight is NOT baked into the HTML here.
    // _markActiveMode() applies it afterwards as DOM attributes on stable DOM.
    // Baking it made the generated string change on every mode switch, which
    // forced a full preview DOM replacement (= blink) on every selection.
    const highlightActive = this.config.highlight_active_mode !== false;

    // Resolve gallery pixel box shadow from spacing mode
    const gallerySpacingMode =
      this.config.gallery_spacing_mode ||
      (this.config.gallery_pixel_spacing !== false ? "normal" : "none");
    const galleryPixelBoxShadow =
      gallerySpacingMode === "subtle" || gallerySpacingMode === "normal";

    // Shared appearance axes (see resolveSelectorShape): applied through the
    // shell's data attributes + CSS overrides so the shared renderers stay
    // untouched and every display mode obeys the same shape setting.
    const selectorShape = resolveSelectorShape(this.config);
    const selectorButtonShape = resolveSelectorButtonShape(this.config);
    const selectorStyle = this._getModeSelectorStyle();
    const shellAttrs = `data-shape="${selectorShape}"${
      selectorStyle === "preview-grid" ? ' data-columns="2"' : ""
    }`;

    // Grid mode: halve the effective preview size so matrix previews fit
    // naturally within 2-column cells and the size slider has a visible
    // effect on item height.  Without this, items are clipped (overflow:hidden)
    // because a 450px preview doesn\'t fit a ~230px-wide column.
    // Strip mode: mini previews (scrollable row), so scale down further.
    const effectivePreviewSize =
      selectorStyle === "preview-grid"
        ? Math.round(galleryPreviewSize * 0.5)
        : selectorStyle === "preview-strip"
          ? Math.round(galleryPreviewSize * 0.4)
          : galleryPreviewSize;

    // ── Carousel display mode ─────────────────────────────────────────
    // Uses the shared renderCarouselString() so buttons and dots are
    // visually identical to every other carousel in the component suite.
    if (displayMode === "carousel") {
      if (this._carouselIndex == null) {
        const activeIdx = items.findIndex(
          (it) => it.dataMode === this._getCurrentMode(),
        );
        this._carouselIndex = activeIdx >= 0 ? activeIdx : 0;
      }
      this._carouselIndex = Math.max(
        0,
        Math.min(this._carouselIndex, items.length - 1),
      );

      const ci = this._carouselIndex;
      const item = items[ci];
      if (!item) return ``;

      return `
        <div class="gc-preview-shell" ${shellAttrs} style="border-radius:8px;">
          ${renderCarouselString({
            items,
            currentIndex: ci,
            buttonShape:
              selectorShapeToCarouselButtonShape(selectorButtonShape),
            showAsCard: true,
            carouselId: "gc-gradient-carousel",
            wrapNavigation: this.config.gallery_wrap_navigation === true,
            renderItemString: (it) => `
              <div class="gallery-item gc-carousel-item" data-mode="${it.dataMode}"
                   data-action="select-mode"
                   style="cursor:pointer;display:flex;flex-direction:column;align-items:center;
                          gap:6px;padding:10px;border-radius:8px;
                          background:${galleryBgColor === "transparent" ? "transparent" : galleryBgColor};
                          max-width:100%;box-sizing:border-box;transition:all 0.2s ease;">
                ${renderMatrixPreview(it.colorData, {
                  rows,
                  cols,
                  bgColor: galleryBgColor,
                  pixelStyle: galleryPixelStyle,
                  pixelGap: galleryPixelGap,
                  previewSize: galleryPreviewSize,
                  ignoreBlackPixels,
                  matrixBoxShadow:
                    this.config.gallery_matrix_box_shadow === true,
                  pixelBoxShadow: galleryPixelBoxShadow,
                })}
                ${showTitles ? `<div style="font-size:13px;font-weight:500;${galleryBgColor === "black" ? "color:#fff;" : "color:var(--primary-text-color);"}">` + it.dataMode + `</div>` : ""}
              </div>`,
          })}
        </div>`;
    }

    // List / grid modes: optional pagination via the shared utility (same
    // config key + controls as the palette and draw cards).
    let pagedItems = items;
    let paginationHtml = "";
    const itemsPerPage = parseInt(this.config.items_per_page) || 0;
    if (displayMode === "list" && itemsPerPage > 0) {
      const result = renderPagination({
        items,
        currentPage: this._selectorPage || 0,
        itemsPerPage,
      });
      pagedItems = result.items;
      paginationHtml = result.html;
      this._selectorPage = result.currentPage;
    }

    const galleryHtml = renderGalleryDisplay(pagedItems, displayMode, {
      rows,
      cols,
      bgColor: galleryBgColor,
      pixelStyle: galleryPixelStyle,
      pixelGap: galleryPixelGap,
      previewSize: effectivePreviewSize,
      ignoreBlackPixels,
      showCards,
      showTitles,
      onClickEnabled: true,
      matrixBoxShadow: this.config.gallery_matrix_box_shadow === true,
      pixelBoxShadow: galleryPixelBoxShadow,
      wheelNavPosition: this.config.wheel_nav_position || "bottom",
      wheelHeight: this.config.wheel_height || 300,
      wheelDisplayStyle: showTitles ? "default" : "compact",
      navButtonShape: selectorButtonShape,
      currentMode: null, // never bake the highlight — see comment above
      highlightActive,
    });

    return `
      <div class="gc-preview-shell" ${shellAttrs} style="border-radius: 8px;">
        ${galleryHtml}
        ${paginationHtml}
      </div>
    `;
  }

  async _loadPreviews() {
    if (!this.isConnected) return;
    // Preview data is only needed when the mode selector uses a preview style.
    // Text-style selectors skip the backend preview service entirely.
    if (!this._isPreviewSelectorActive()) return;

    // Ensure event subscription is active before requesting preview data
    if (!this._previewEventListenerRegistered && this._hass) {
      this._setupPreviewEventListener();
    }

    const entityId = this._getPrimaryEntity();
    if (!this._hass || !entityId) return;
    const context = this._previewContext;

    try {
      await gradientPreviewStore(this._hass.connection).request(
        this._hass,
        entityId,
      );
      if (context !== this._previewContext || !this.isConnected) return;

      // Reset retry counter on success
      this._previewRetryCount = 0;
    } catch (error) {
      if (context !== this._previewContext || !this.isConnected) return;
      // During HA startup, the light platform services may not be registered yet.
      // Also handle transient connection-lost errors.
      const errorCode = error?.code || error?.error?.code;
      const isTransient =
        errorCode === "not_found" ||
        errorCode === 3 ||
        errorCode === "connection-lost";
      if (isTransient) {
        const retryCount = (this._previewRetryCount || 0) + 1;
        this._previewRetryCount = retryCount;
        if (retryCount <= 5) {
          const delay = Math.min(retryCount * 2000, 10000); // 2s, 4s, 6s, 8s, 10s
          // Tracked + isConnected-guarded so a removed card stops retrying.
          if (this._previewRetryTimer) clearTimeout(this._previewRetryTimer);
          this._previewRetryTimer = setTimeout(() => {
            this._previewRetryTimer = null;
            if (!this.isConnected) return;
            this._loadPreviews();
          }, delay);
        } else {
          console.warn(
            "[Gradient Card] Preview load still failing after 5 retries. " +
              "Check device connectivity.",
          );
        }
        return;
      }
      console.error("[Gradient Card] Error loading previews:", error);
    }
  }

  _previewCache() {
    if (!this._hass?.connection) {
      return (this._emptyPreviewCache ||= {
        data: null,
        timestamp: 0,
        responseHash: null,
      });
    }
    return gradientPreviewStore(this._hass.connection).cache(
      this._getPrimaryEntity(),
    );
  }

  _setupPreviewEventListener() {
    if (
      this._previewEventListenerRegistered ||
      !this._hass?.connection ||
      !this.isConnected
    )
      return;
    // No subscription needed when the selector doesn't render previews
    if (!this._isPreviewSelectorActive()) return;

    this._previewEventListenerRegistered = true;

    this._unsubscribePreviewEvents = gradientPreviewStore(
      this._hass.connection,
    ).subscribe(this._getPrimaryEntity(), () => {
      if (!this.isConnected) return;

      // Update only the preview section instead of re-rendering entire card
      this._updatePreviewSection();

      // Fresh preview data arrived — if text preview mode is active and we are
      // NOT mid-drag, force the exact same path as toggling the "Show Text
      // Preview" switch: a synchronous this._renderCard() that rebuilds the full DOM
      // from the now-fresh cache.  Previous attempts using requestAnimationFrame
      // were silently blocked by the _renderScheduled guard when a set-hass
      // render was already queued.
      if (
        this.config?.matrix_rotary_text_preview === true &&
        !this._draggingRotary
      ) {
        this._renderScheduled = false; // clear any pending guard
        this._renderCard(); // full DOM rebuild from fresh cache
      }
    });
  }

  _getRotaryStyleInfo() {
    // Handle unified rotary style with backward compatibility
    const unifiedStyle = this.config.rotary_unified_style;

    if (unifiedStyle) {
      // New unified format
      switch (unifiedStyle) {
        case "turning_rectangle":
          return { style: "compass", shape: null };
        case "star":
          return { style: "compass", shape: null };
        case "wheel":
          return { style: "wheel", shape: null };
        case "rectangle":
          return {
            style: this.config.rectangle_shape === "square" ? "square" : "rect",
            shape: null,
          };
        case "square":
          // Backward compat: old standalone square → rectangle with square shape
          return { style: "square", shape: null };
        case "matrix_preview":
          return { style: "matrix_preview", shape: null };
        case "compass":
          return { style: "compass", shape: null };
        case "capsule":
          return { style: "capsule", shape: null };
        // Backward compat: deprecated styles now merged into wheel/compass
        case "arrow_window":
          return { style: "wheel", shape: null };
        case "arrow":
          return { style: "compass", shape: null };
        case "beam":
          return { style: "compass", shape: null };
        default:
          return { style: "compass", shape: null };
      }
    } else {
      // Backward compatibility with old format
      const oldStyle = this.config.angle_rotary_style || "default";
      const oldShape = this.config.default_shape || "rectangle";
      return { style: oldStyle, shape: oldShape };
    }
  }

  _getWheelShowMask() {
    // Explicit setting takes priority
    if (this.config.wheel_show_mask !== undefined)
      return this.config.wheel_show_mask;
    // Backward compat: arrow_window implies mask
    return this.config.rotary_unified_style === "arrow_window";
  }

  _getCompassShape() {
    if (this.config.compass_shape) return this.config.compass_shape;
    // Backward compat from deprecated unified styles
    if (this.config.rotary_unified_style === "beam") return "beam";
    if (this.config.rotary_unified_style === "arrow") return "arrow";
    if (this.config.rotary_unified_style === "star") return "star";
    if (this.config.rotary_unified_style === "turning_rectangle")
      return "rectangle";
    return "none"; // default
  }

  _getCompassLabelsMode() {
    if (this.config.compass_labels_mode) return this.config.compass_labels_mode;
    // Backward compat: boolean compass_show_labels
    if (this.config.compass_show_labels !== undefined)
      return this.config.compass_show_labels ? "under" : "none";
    return "under"; // default
  }

  _getRotarySize() {
    // Use unified rotary_size if available, otherwise fall back to specific sizes
    if (this.config.rotary_size) {
      return this.config.rotary_size;
    }

    const styleInfo = this._getRotaryStyleInfo();
    if (styleInfo.style === "wheel") {
      return this.config.wheel_size || 80;
    } else if (styleInfo.style === "rect") {
      return this.config.rect_size || 80;
    } else {
      return this.config.default_size || 80;
    }
  }

  // Angle-related methods (from angle gradient card)
  // Angle control events are bound declaratively on the Lit-rendered
  // .angle-row / .header-rotary containers (see _onAngleArea* handlers and
  // _startRotaryDocDrag for the document-level drag listeners).

  // Always get the current textColors from the entity state
  _getCurrentTextColors() {
    const entityId = this._getPrimaryEntity();
    const hass = this._hass;
    if (hass && entityId && hass.states[entityId]) {
      const stateObj = hass.states[entityId];
      return stateObj.attributes.text_colors || [[255, 255, 255]];
    }
    return [[255, 255, 255]];
  }

  _debouncedApplyAngle(angle) {
    this._pendingAngle = angle;
    this._angleDraft.commit(angle);
    this._angleCommands.schedule(this._hass, this.config, angle);
  }

  _applyAngle(angle) {
    this._angleDraft.commit(angle);
    this._angleCommands.schedule(this._hass, this.config, angle, true);
  }

  // The angle to display: the one being set (until the lamp reports about
  // that value, or a timeout) or else the lamp's current angle.
  _displayAngle(stateObj) {
    const stateAngle = stateObj?.attributes?.angle ?? 0;
    this._angleDraft.settle(stateAngle);
    return this._angleDraft.value ?? stateAngle;
  }

  // A pointer press on the angle slider/capsule: the drag lasts until the
  // button is released anywhere on the page, not when the pointer merely
  // leaves the control (which used to let a state update snap it back).
  _holdAngleControl(onRelease) {
    this._angleHeld = true;
    if (this._angleRelease) return;
    this._angleRelease = () => {
      for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
        document.removeEventListener(type, this._angleRelease, true);
      this._angleRelease = null;
      this._angleHeld = false;
      onRelease();
    };
    for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
      document.addEventListener(type, this._angleRelease, true);
  }

  _onAngleSliderPress() {
    this._usingSlider = true;
    this._holdAngleControl(() => this._onAngleSliderRelease());
  }

  _onAngleApplied() {
    // Invalidate the response deduplication hash so the next preview_gradient_modes
    // response is always accepted, even if the backend briefly returns data for the
    // same angle (e.g., during rapid adjustments).
    this._previewCache().responseHash = null;

    // Directly schedule a preview reload after the backend processes the angle
    // change.  The set hass() detection path is unreliable because the entity
    // state update only arrives after the hardware operation completes (sending
    // pixels to the lamp), and timing/flag interactions can prevent the debounced
    // _loadPreviews() from ever firing.  A direct reload with a generous delay
    // guarantees the wheel/gallery previews reflect the new angle.
    if (this._anglePreviewReloadTimer) {
      clearTimeout(this._anglePreviewReloadTimer);
    }
    this._anglePreviewReloadTimer = setTimeout(() => {
      this._loadPreviews().catch((err) =>
        console.error(
          "[Gradient Card] Error reloading previews after angle change:",
          err,
        ),
      );
    }, 800);
  }

  _rgbToHex(rgb) {
    return _sharedRgbToHex(rgb);
  }

  _createColorWheelSegments(colors, radius) {
    return _sharedCreateColorWheelSegments(colors, radius);
  }

  _createWheelGradientStops(colors) {
    return _sharedCreateWheelGradientStops(colors);
  }

  _createShapeGradientStops(colors) {
    return _sharedCreateShapeGradientStops(colors);
  }
  _generateShapeMask(shape, selectorRadius) {
    return _sharedGenerateShapeMask(shape, selectorRadius);
  }

  /**
   * String form of the angle rotary markup.  Compatibility API (used by
   * the preview-appearance fixtures); the card itself renders
   * _angleRotaryTemplate() through Lit.
   */
  _renderAngleRotary(currentAngle, isHeaderMode = false) {
    return templateToString(
      this._angleRotaryTemplate(currentAngle, isHeaderMode),
    );
  }

  /** Resolved angle value display mode: "none" | "text" | "input". */
  _getAngleValueDisplay() {
    return (
      this.config.angle_value_display ||
      (this.config.show_angle_input === true ? "input" : "none")
    );
  }

  /** In-SVG angle value (text or input) for the circular rotary styles. */
  _svgAngleValueTemplate(radius, visualAngle) {
    const avd = this._getAngleValueDisplay();
    if (avd === "none") return nothing;
    const displayAngle = Math.round(visualAngle);
    const foW = Math.max(radius * 1.11, 30);
    const foH = Math.max(radius * 0.58, 16);
    const foX = 50 - foW / 2;
    const foY = 50 - foH / 2;
    const foFS = Math.max(radius * 0.27, 7.5).toFixed(1);
    const foBR = Math.max(radius * 0.13, 3.5).toFixed(1);
    if (avd === "input") {
      return svg`<foreignObject x=${foX.toFixed(1)} y=${foY.toFixed(1)} width=${foW.toFixed(1)} height=${foH.toFixed(1)}>
                      <input xmlns="http://www.w3.org/1999/xhtml" id="angleinput" class="compass-center-input" type="number" min="0" max="359" step="1" value=${displayAngle} style="font-size:${foFS}px;border-radius:${foBR}px" />
                    </foreignObject>`;
    }
    return svg`<foreignObject x=${foX.toFixed(1)} y=${foY.toFixed(1)} width=${foW.toFixed(1)} height=${foH.toFixed(1)}>
                    <input xmlns="http://www.w3.org/1999/xhtml" id="angletext" class="compass-center-input" type="text" value="${displayAngle}°" readonly tabindex="-1" style="font-size:${foFS}px;border-radius:${foBR}px" />
                  </foreignObject>`;
  }

  /** HTML angle value (text or input) for the rect/square/matrix styles. */
  _htmlAngleValueTemplate(className, visualAngle) {
    const avd = this._getAngleValueDisplay();
    if (avd === "none") return nothing;
    const da = Math.round(visualAngle);
    if (avd === "input") {
      return html`<div class=${className}><input id="angleinput" type="number" min="0" max="359" step="1" value=${da} /></div>`;
    }
    return html`<div class=${className}><input id="angletext" type="text" value="${da}°" readonly tabindex="-1" /></div>`;
  }

  /** Snap ticks along a w:h rectangle perimeter (rect/square styles). */
  _perimeterSnapTicks(angles, rw, rh) {
    const rp = 2 * (rw + rh);
    return angles.map((sa) => {
      const pp = (sa / 360) * rp;
      let sx, sy, cls;
      if (pp <= rh / 2) {
        sx = 100;
        sy = 50 - (pp / (rh / 2)) * 50;
        cls = "right";
      } else if (pp <= rh / 2 + rw) {
        sx = 100 - ((pp - rh / 2) / rw) * 100;
        sy = 0;
        cls = "top";
      } else if (pp <= rh / 2 + rw + rh) {
        sx = 0;
        sy = ((pp - rh / 2 - rw) / rh) * 100;
        cls = "left";
      } else if (pp <= rh / 2 + rw + rh + rw) {
        sx = ((pp - rh / 2 - rw - rh) / rw) * 100;
        sy = 100;
        cls = "bottom";
      } else {
        sx = 100;
        sy = 100 - ((pp - rh / 2 - rw - rh - rw) / (rh / 2)) * 50;
        cls = "right";
      }
      if (cls === "top" || cls === "bottom")
        return html`<div class="snap-tick snap-tick-${cls}" style="left:${sx}%"></div>`;
      return html`<div class="snap-tick snap-tick-${cls}" style="top:${sy}%"></div>`;
    });
  }

  /** Angle rotary control as a Lit template (every rotary style). */
  _angleRotaryTemplate(currentAngle, isHeaderMode = false) {
    const styleInfo = this._getRotaryStyleInfo();
    const style = styleInfo.style;
    // Use visual angle for immediate feedback during dragging
    const visualAngle =
      this._draggingRotary && this._pendingAngle !== undefined
        ? this._pendingAngle
        : currentAngle;

    switch (style) {
      case "wheel": {
        // Wheel mode: gradient circle with optional arrow window mask
        const textColors = this._getCurrentTextColors();
        const wheelGradientStops = this._createWheelGradientStops(textColors);
        const selectorRadians = (visualAngle * Math.PI) / 180;
        const wheelSizePercent = this._getRotarySize();
        const wheelSize = Math.min(100, wheelSizePercent);
        const wheelRadius = (wheelSize * 45) / 100;
        const selectorX = 50 + wheelRadius * Math.cos(selectorRadians);
        const selectorY = 50 - wheelRadius * Math.sin(selectorRadians);
        const gradientAngle = -visualAngle;

        // Optional arrow window mask
        const showMask = this._getWheelShowMask();
        let wheelMaskDefs = nothing;
        let wheelMaskOverlay = nothing;
        if (showMask) {
          const al = wheelRadius * 2,
            abw = wheelRadius * 0.45;
          const ahw = wheelRadius * 0.85,
            ahl = wheelRadius * 0.55;
          const awTipX = 50 + al / 2;
          const awBl = 50 - al / 2;
          const awBt = 50 - abw / 2,
            awBb = 50 + abw / 2;
          const awHt = 50 - ahw / 2,
            awHb = 50 + ahw / 2;
          const awHs = awTipX - ahl;
          const arrowWindowPath = `M ${awBl} ${awBt} L ${awHs} ${awBt} L ${awHs} ${awHt} L ${awTipX} 50 L ${awHs} ${awHb} L ${awHs} ${awBb} L ${awBl} ${awBb} Z`;
          wheelMaskDefs = svg`
                <mask id="awDimMask">
                  <rect x="0" y="0" width="100" height="100" fill="white"/>
                  <g class="aw-rotate" transform="rotate(${gradientAngle} 50 50)">
                    <path d=${arrowWindowPath} fill="black"/>
                  </g>
                </mask>`;
          wheelMaskOverlay = svg`
              <circle cx="50" cy="50" r=${wheelRadius} fill="black" opacity="0.55" mask="url(#awDimMask)"/>
              <g class="aw-rotate" transform="rotate(${gradientAngle} 50 50)">
                <path d=${arrowWindowPath} fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.8"/>
              </g>`;
        }
        const svgSize = isHeaderMode ? "88px" : `${wheelSizePercent}%`;

        return html`
          <div class="wheel-container" style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <svg width=${svgSize} height=${svgSize} viewBox="0 0 100 100" id="angle-preview" class="color-wheel" style="max-width: 200px; max-height: 200px;">
              <defs>
                <linearGradient id="wheelGradient" x1="0%" y1="50%" x2="100%" y2="50%">
                  ${unsafeSVG(wheelGradientStops)}
                </linearGradient>
                <mask id="circleMask">
                  <circle cx="50" cy="50" r=${wheelRadius} fill="white"/>
                </mask>
                ${wheelMaskDefs}
              </defs>
              <g class=${showMask ? "aw-grad-group" : nothing} transform="rotate(${gradientAngle} 50 50)">
                <rect x=${50 - wheelRadius} y=${50 - wheelRadius} width=${wheelRadius * 2} height=${wheelRadius * 2} fill="url(#wheelGradient)" mask="url(#circleMask)"/>
              </g>
              ${wheelMaskOverlay}
              <circle cx="50" cy="50" r=${wheelRadius} fill="none" stroke="var(--divider-color, #ddd)" stroke-width="1"/>
              ${
                this.config.compass_snap_to_coordinates
                  ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
                      const rad = (a * Math.PI) / 180;
                      const inner = wheelRadius - 3;
                      const outer = wheelRadius + 1;
                      return svg`<line x1=${50 + inner * Math.cos(rad)} y1=${50 - inner * Math.sin(rad)} x2=${50 + outer * Math.cos(rad)} y2=${50 - outer * Math.sin(rad)} stroke="var(--secondary-text-color, #999)" stroke-width=${a % 90 === 0 ? 1.8 : 1} opacity="0.7"/>`;
                    })
                  : nothing
              }
              ${
                this.config.show_selector_dot !== false
                  ? svg`<circle cx=${selectorX} cy=${selectorY} r="4" class="wheel-selector" fill="#fff" stroke="#333" stroke-width="2"/>`
                  : nothing
              }
              <circle cx="50" cy="50" r=${wheelRadius} fill="transparent" style="cursor: pointer;"/>
              ${this._svgAngleValueTemplate(wheelRadius, visualAngle)}
            </svg>
          </div>
        `;
      }

      case "rect": {
        // Get the actual colors from the lamp
        const rectTextColors = this._getCurrentTextColors();

        // EXACT same logic as wheel for consistency
        const rectNormalizedAngle = ((visualAngle % 360) + 360) % 360;
        const { x: rectSelectorX, y: rectSelectorY } = this._perimeterPoint(
          rectNormalizedAngle,
          4,
          1,
        );

        // Gradient rotation EXACT same as wheel
        const rectGradientAngle = -rectNormalizedAngle;

        // Make rectangle use full width of container with 4:1 aspect ratio
        // In header mode, use rotary size directly (no minimum constraint)
        const rectSizePercent = this._getRotarySize();

        // Calculate header mode dimensions based on rotary size
        const headerWidth = isHeaderMode
          ? Math.round((rectSizePercent / 100) * 300)
          : 300;
        const headerHeight = isHeaderMode
          ? Math.round((rectSizePercent / 100) * 88)
          : 88;
        const sizeCss = isHeaderMode
          ? `width: ${headerWidth}px !important; height: ${headerHeight}px !important;`
          : `width: ${rectSizePercent}%; aspect-ratio: 4 / 1;`;
        const background = `linear-gradient(${90 + rectGradientAngle}deg, ${rectTextColors
          .map((color) => rgbToCss(color))
          .join(", ")})`;

        return html`
          <div class="rect-container" style="width: 100%; position: relative;">
            <div
              id="angle-preview"
              class="color-rect rect-gradient"
              style="
                ${sizeCss}
                background: ${background};
                box-shadow: inset 0 0 0 1px var(--divider-color, #ddd);
                border-radius: 6px;
                margin: 0 auto;
                position: relative;
                cursor: pointer;
              "
            >
              <!-- Selector dot positioned EXACTLY like the wheel -->
              ${
                this.config.show_selector_dot !== false
                  ? html`<div
                class="rect-selector"
                style="
                  position: absolute;
                  width: 12px;
                  height: 12px;
                  background: var(--card-background-color, #fff);
                  border: 2px solid var(--primary-text-color, #333);
                  border-radius: 50%;
                  transform: translate(-50%, -50%);
                  left: ${rectSelectorX}%;
                  top: ${rectSelectorY}%;
                  cursor: pointer;
                "
              ></div>`
                  : nothing
              }
              ${
                this.config.compass_snap_to_coordinates
                  ? this._perimeterSnapTicks(
                      [0, 45, 90, 135, 180, 225, 270, 315],
                      4,
                      1,
                    )
                  : nothing
              }
              ${this._htmlAngleValueTemplate("rotary-overlay-value", visualAngle)}
            </div>
          </div>
        `;
      }

      case "square": {
        // Get the actual colors from the lamp (EXACT same as rectangle)
        const squareTextColors = this._getCurrentTextColors();

        // Angle processing (EXACT same as rectangle)
        const squareNormalizedAngle = ((visualAngle % 360) + 360) % 360;
        const { x: squareSelectorX, y: squareSelectorY } =
          this._perimeterPoint(squareNormalizedAngle, 1, 1);

        // Gradient rotation EXACT same as rectangle
        const squareGradientAngle = -squareNormalizedAngle;

        // Make square match rectangle height (same h dimension)
        // Rectangle: width=size%, height=size%/4. Square: width=height=size%/4
        const baseSquareSizePercent = this._getRotarySize();
        const squareSidePercent = baseSquareSizePercent / 4;

        // Calculate header mode dimensions (same height as rectangle header)
        const squareHeaderSize = isHeaderMode
          ? Math.round((baseSquareSizePercent / 100) * 88)
          : 88;
        const sizeCss = isHeaderMode
          ? `width: ${squareHeaderSize}px !important; height: ${squareHeaderSize}px !important;`
          : `width: ${squareSidePercent}%; aspect-ratio: 1 / 1;`;
        const background = `linear-gradient(${90 + squareGradientAngle}deg, ${squareTextColors
          .map((color) => rgbToCss(color))
          .join(", ")})`;

        return html`
          <div class="square-container" style="width: 100%; position: relative;">
            <div
              id="angle-preview"
              class="color-square square-gradient"
              style="
                ${sizeCss}
                background: ${background};
                box-shadow: inset 0 0 0 1px var(--divider-color, #ddd);
                border-radius: 6px;
                margin: 0 auto;
                position: relative;
                cursor: pointer;
              "
            >
              <!-- Selector dot positioned EXACTLY like the rectangle -->
              ${
                this.config.show_selector_dot !== false
                  ? html`<div
                class="square-selector"
                style="
                  position: absolute;
                  width: 12px;
                  height: 12px;
                  background: var(--card-background-color, #fff);
                  border: 2px solid var(--primary-text-color, #333);
                  border-radius: 50%;
                  transform: translate(-50%, -50%);
                  left: ${squareSelectorX}%;
                  top: ${squareSelectorY}%;
                  cursor: pointer;
                "
              ></div>`
                  : nothing
              }
              ${
                this.config.compass_snap_to_coordinates
                  ? html`${
                      /* Cardinal angles (0/90/180/270) → edge half-circles */
                      this._perimeterSnapTicks([0, 90, 180, 270], 1, 1)
                    }<div class="snap-tick snap-tick-corner" style="top:-2px;right:-2px"></div><div class="snap-tick snap-tick-corner" style="top:-2px;left:-2px"></div><div class="snap-tick snap-tick-corner" style="bottom:-2px;left:-2px"></div><div class="snap-tick snap-tick-corner" style="bottom:-2px;right:-2px"></div>`
                  : nothing
              }
              ${this._htmlAngleValueTemplate("rotary-overlay-value", visualAngle)}
            </div>
          </div>
        `;
      }

      case "matrix_preview": {
        const mpColors = this._getCurrentTextColors();
        const baseMpSz = this._getRotarySize();
        const mpRows = 5;
        const mpCols = 20;

        // Read matrix rotary config (independent from gallery settings)
        const mpBgColor = this.config.matrix_rotary_bg_color || "black";
        const mpPixelStyle = this.config.matrix_rotary_pixel_style || "square";
        // Resolve pixel spacing mode (new tri-state) with backward compat
        const mpSpacingMode =
          this.config.matrix_rotary_spacing_mode ||
          (this.config.matrix_rotary_pixel_spacing === false
            ? "none"
            : "normal");
        const mpPixelGap = mpSpacingMode === "normal" ? 3 : 0;
        const mpIgnoreBlack = this.config.matrix_rotary_ignore_black === true;
        const mpMatrixBoxShadow = this.config.matrix_rotary_box_shadow === true;
        const mpPixelBoxShadow =
          mpSpacingMode === "subtle" || mpSpacingMode === "normal";
        const mpBorderRadius =
          mpPixelStyle === "circle"
            ? "50%"
            : mpPixelStyle === "rounded"
              ? "20%"
              : "0";
        const mpPixelShadowStyle = mpPixelBoxShadow
          ? `box-shadow: 0 0 ${previewLength(2)} #0008;`
          : "";
        const mpMatrixShadowStyle = mpMatrixBoxShadow
          ? `box-shadow: 0 ${previewLength(2)} ${previewLength(8)} rgba(0,0,0,0.5);`
          : "";

        // Text preview mode: use cached preview data from the backend
        // The backend already returns correct data (all LEDs lit when panel mode is on)
        const mpTextPreview = this.config.matrix_rotary_text_preview === true;
        let mpPixelDivs;

        if (mpTextPreview) {
          // Use backend preview for the current gradient mode
          mpPixelDivs = this._renderMatrixTextPreviewPixels(
            mpRows,
            mpCols,
            mpBgColor,
            mpIgnoreBlack,
            mpBorderRadius,
            mpPixelShadowStyle,
          );
        } else {
          // Pure angle gradient computation
          mpPixelDivs = this._angleGradientPixelColors(
            mpColors,
            visualAngle,
            mpRows,
            mpCols,
          ).map(
            ([r, g, b]) => {
              const isBlack = r <= 5 && g <= 5 && b <= 5;
              const shouldIgnore = mpIgnoreBlack && isBlack;
              return html`<div class="matrix-pixel" style="background:${shouldIgnore ? "transparent" : rgbToCss([r, g, b])};border-radius:${mpBorderRadius};aspect-ratio:1;${mpPixelShadowStyle}"></div>`;
            },
          );
        }

        // Calculate header mode dimensions to match rectangle sizing
        const mpHeaderWidth = isHeaderMode
          ? Math.round((baseMpSz / 100) * 300)
          : null;

        return html`
          <div class="matrix-preview-container" id="angle-preview" style="width:100%;display:flex;flex-direction:column;align-items:center;cursor:pointer;position:relative;">
            <div style="container-type:inline-size;max-width:100%;width:${isHeaderMode ? `${mpHeaderWidth}px` : `${baseMpSz}%`};">
            <div class="matrix-preview-grid" style="
              display:grid;
              grid-template-columns:repeat(${mpCols}, 1fr);
              gap:${previewLength(mpPixelGap)};
              background:${mpBgColor};
              padding:${previewLength(mpPixelGap * 2)};
              border-radius:${previewLength(6)};
              ${mpMatrixShadowStyle}
              width:100%;
              margin:0 auto;
              box-sizing:border-box;
            ">${mpPixelDivs}</div>
            </div>
            ${this._htmlAngleValueTemplate("matrix-angle-value", visualAngle)}
          </div>
        `;
      }

      case "compass": {
        // Compass mode: circular dial with configurable overlay shape + optional labels
        const compColors = this._getCurrentTextColors();
        const compGradientStops = this._createWheelGradientStops(compColors);
        const baseCmpSz = this._getRotarySize();
        const compRadius = (Math.min(100, baseCmpSz) * 45) / 100;
        const compGradAngle = -visualAngle;
        const compRad = (visualAngle * Math.PI) / 180;
        const compSX = 50 + compRadius * Math.cos(compRad);
        const compSY = 50 - compRadius * Math.sin(compRad);

        const compassShape = this._getCompassShape();
        const labelsMode = this._getCompassLabelsMode();

        // Tick marks and cardinal labels (conditional)
        let ticksAndLabels = nothing;
        if (labelsMode !== "none") {
          const ticks = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const rad = (a * Math.PI) / 180;
            const inner = compRadius - 4;
            const outer = compRadius - (a % 90 === 0 ? 1 : 2);
            return svg`<line x1=${50 + inner * Math.cos(rad)} y1=${50 - inner * Math.sin(rad)} x2=${50 + outer * Math.cos(rad)} y2=${50 - outer * Math.sin(rad)} stroke="var(--secondary-text-color, #999)" stroke-width=${a % 90 === 0 ? 1.5 : 0.8}/>`;
          });
          const cLabelR = compRadius - 10;
          ticksAndLabels = svg`
              ${ticks}
              <text x=${50 + cLabelR} y="52" text-anchor="middle" font-size="5.5" fill="var(--secondary-text-color, #999)" font-weight="600">E</text>
              <text x="50" y=${50 - cLabelR + 2} text-anchor="middle" font-size="5.5" fill="var(--secondary-text-color, #999)" font-weight="600">N</text>
              <text x=${50 - cLabelR} y="52" text-anchor="middle" font-size="5.5" fill="var(--secondary-text-color, #999)" font-weight="600">W</text>
              <text x="50" y=${50 + cLabelR + 2} text-anchor="middle" font-size="5.5" fill="var(--secondary-text-color, #999)" font-weight="600">S</text>`;
        }

        // Shape overlay (needle / beam / arrow)
        // Center dot hidden when angle value text/input is displayed
        const compAvd = this._getAngleValueDisplay();
        const compCenterDot =
          compAvd === "none"
            ? svg`<circle cx="50" cy="50" r="3" fill="var(--card-background-color, #fff)" stroke="var(--divider-color, #ddd)" stroke-width="1"/>`
            : nothing;
        const compCenterDotSmall =
          compAvd === "none"
            ? svg`<circle cx="50" cy="50" r="2.5" fill="var(--card-background-color, #fff)" stroke="var(--divider-color, #ddd)" stroke-width="0.8"/>`
            : nothing;
        let shapeOverlayDefs = nothing;
        let shapeOverlayContent = nothing;
        // Shared rendering for the rotating clip shapes (arrow/star/rect/needle)
        const rotatingShape = (shapePath) => {
          shapeOverlayDefs = svg`<clipPath id="compShapeClip"><path d=${shapePath}/></clipPath>`;
          shapeOverlayContent = svg`
              <g clip-path="url(#compCircleClip)">
                <g class="comp-rotate" transform="rotate(${compGradAngle} 50 50)">
                  <g clip-path="url(#compShapeClip)">
                    <rect x="0" y="0" width="100" height="100" fill="url(#compGrad)"/>
                  </g>
                </g>
              </g>
              <g class="comp-rotate" transform="rotate(${compGradAngle} 50 50)">
                <path d=${shapePath} fill="none" stroke="var(--divider-color, #ddd)" stroke-width="0.5"/>
              </g>
              ${compCenterDot}`;
        };

        if (compassShape === "none") {
          // No overlay — empty circle, just selector dot
        } else if (compassShape === "beam") {
          // Beam wedge — origin from opposite border so full gradient is visible
          const beamSpread = 30;
          const angleRad = (visualAngle * Math.PI) / 180;
          const originX = 50 - compRadius * Math.cos(angleRad);
          const originY = 50 + compRadius * Math.sin(angleRad);
          const bRad1 = ((visualAngle + beamSpread) * Math.PI) / 180;
          const bRad2 = ((visualAngle - beamSpread) * Math.PI) / 180;
          const bx1 = 50 + compRadius * Math.cos(bRad1);
          const by1 = 50 - compRadius * Math.sin(bRad1);
          const bx2 = 50 + compRadius * Math.cos(bRad2);
          const by2 = 50 - compRadius * Math.sin(bRad2);
          const beamPath = `M ${originX} ${originY} L ${bx1} ${by1} A ${compRadius} ${compRadius} 0 0 1 ${bx2} ${by2} Z`;
          shapeOverlayDefs = svg`<clipPath id="compShapeClip"><path class="beam-wedge-path" d=${beamPath}/></clipPath>`;
          shapeOverlayContent = svg`
              <g clip-path="url(#compCircleClip)">
                <g clip-path="url(#compShapeClip)">
                  <g class="beam-grad-group" transform="rotate(${compGradAngle} 50 50)">
                    <rect x="0" y="0" width="100" height="100" fill="url(#compGrad)"/>
                  </g>
                </g>
              </g>
              <path class="beam-outline" d=${beamPath} fill="none" stroke="var(--divider-color, #ddd)" stroke-width="0.8" opacity="0.6"/>
              ${compCenterDotSmall}`;
        } else if (compassShape === "arrow") {
          // Arrow shape overlay — border to border
          const arrowLen = compRadius;
          const arrowBodyW = arrowLen * 0.22;
          const arrowHeadW = arrowLen * 0.45;
          const arrowHeadLen = arrowLen * 0.3;
          const tipX = 50 + arrowLen;
          const bodyLeft = 50 - arrowLen;
          const bodyTop = 50 - arrowBodyW / 2;
          const bodyBottom = 50 + arrowBodyW / 2;
          const headTop = 50 - arrowHeadW / 2;
          const headBottom = 50 + arrowHeadW / 2;
          const headStart = tipX - arrowHeadLen;
          rotatingShape(
            `M ${bodyLeft} ${bodyTop} L ${headStart} ${bodyTop} L ${headStart} ${headTop} L ${tipX} 50 L ${headStart} ${headBottom} L ${headStart} ${bodyBottom} L ${bodyLeft} ${bodyBottom} Z`,
          );
        } else if (compassShape === "star") {
          // Star shape overlay — border to border
          const starOuterR = compRadius;
          const starInnerR = starOuterR * 0.4;
          const starPoints = [];
          for (let i = 0; i < 10; i++) {
            const a = (i * Math.PI) / 5;
            const r = i % 2 === 0 ? starOuterR : starInnerR;
            starPoints.push(`${50 + r * Math.cos(a)},${50 - r * Math.sin(a)}`);
          }
          rotatingShape(`M ${starPoints.join(" L ")} Z`);
        } else if (compassShape === "rectangle") {
          // Rectangle shape overlay — border to border, thinner aspect
          const trW = compRadius * 2;
          const trH = trW * 0.35;
          const trX = 50 - trW / 2;
          const trY = 50 - trH / 2;
          const trR = 4;
          rotatingShape(
            `M ${trX + trR} ${trY} L ${trX + trW - trR} ${trY} Q ${trX + trW} ${trY} ${trX + trW} ${trY + trR} L ${trX + trW} ${trY + trH - trR} Q ${trX + trW} ${trY + trH} ${trX + trW - trR} ${trY + trH} L ${trX + trR} ${trY + trH} Q ${trX} ${trY + trH} ${trX} ${trY + trH - trR} L ${trX} ${trY + trR} Q ${trX} ${trY} ${trX + trR} ${trY} Z`,
          );
        } else {
          // Needle (default) — border to border
          const nLen = compRadius;
          const nW = compRadius * 0.1;
          const nTip = 50 + nLen;
          const nTail = 50 - nLen;
          const nTop = 50 - nW;
          const nBot = 50 + nW;
          rotatingShape(
            `M ${nTip} 50 L ${50 + nW * 0.6} ${nTop} L ${nTail} 50 L ${50 + nW * 0.6} ${nBot} Z`,
          );
        }

        const svgSize = isHeaderMode ? "88px" : `${baseCmpSz}%`;
        return html`
          <div class="compass-container" style="width:100%;display:flex;flex-direction:column;align-items:center;">
            <svg width=${svgSize} height=${svgSize} viewBox="0 0 100 100" id="angle-preview" class="color-wheel" style="max-width:200px;max-height:200px;">
              <defs>
                <linearGradient id="compGrad" x1="0%" y1="50%" x2="100%" y2="50%">${unsafeSVG(compGradientStops)}</linearGradient>
                <clipPath id="compCircleClip"><circle cx="50" cy="50" r=${compRadius}/></clipPath>
                ${shapeOverlayDefs}
              </defs>
              <circle cx="50" cy="50" r=${compRadius} fill="var(--card-background-color, #fff)" stroke="var(--divider-color, #ddd)" stroke-width="1"/>
              ${labelsMode === "under" ? ticksAndLabels : nothing}
              ${shapeOverlayContent}
              ${labelsMode === "over" ? ticksAndLabels : nothing}
              ${
                this.config.show_selector_dot !== false
                  ? svg`<circle cx=${compSX} cy=${compSY} r="4" class="wheel-selector" fill="#fff" stroke="#333" stroke-width="2"/>`
                  : nothing
              }
              <circle cx="50" cy="50" r=${compRadius} fill="transparent" style="cursor:pointer;"/>
              ${this._svgAngleValueTemplate(compRadius, visualAngle)}
            </svg>
          </div>
        `;
      }

      case "capsule": {
        // Capsule/pill style — horizontal slider for angle.  The capsule
        // markup comes from the shared capsule-slider-utils renderer (HTML
        // string naming this card's handlers in data-on-* attributes),
        // inserted via unsafeHTML.
        const capsuleAngle = visualAngle;
        const capsuleTheme = resolveCapsuleTheme(
          this.config.capsule_theme,
          undefined,
        );
        const capsuleThickness = resolveCapsuleThickness(
          this.config.capsule_thickness,
          undefined,
          6,
        );
        // Angle value display: replace an icon with text/input
        const capsuleAvd = this._getAngleValueDisplay();
        const capsuleAvdSide = this.config.capsule_angle_value_side || "right";
        const capsuleAngleRounded = Math.round(capsuleAngle);

        let capsuleLeftSlot = null;
        let capsuleRightSlot = null;
        let capsuleIconLeft = null;
        let capsuleIconRight = null;
        let capsuleShowValue = false;
        let capsuleValueText = "";
        let capsuleUnderHtml = null;

        // Slot markup handed to the shared renderer (numbers only).
        if (capsuleAvd !== "none") {
          const isInput = capsuleAvd === "input";
          if (capsuleAvdSide === "under") {
            if (isInput) {
              capsuleUnderHtml = `<div class="capsule-angle-slot capsule-value-under"><input id="angleinput" class="capsule-angle-input" type="number" min="0" max="359" step="1" value="${capsuleAngleRounded}" /></div>`;
            } else {
              // text mode — use default capsule-value-text
              capsuleShowValue = true;
              capsuleValueText = `${capsuleAngleRounded}°`;
            }
          } else {
            // left or right side
            const slotHtml = isInput
              ? `<div class="capsule-angle-slot"><input id="angleinput" class="capsule-angle-input" type="number" min="0" max="359" step="1" value="${capsuleAngleRounded}" /></div>`
              : `<div class="capsule-angle-slot"><input id="angletext" class="capsule-angle-input" type="text" value="${capsuleAngleRounded}°" readonly tabindex="-1" /></div>`;
            if (capsuleAvdSide === "left") {
              capsuleLeftSlot = slotHtml;
              capsuleIconLeft = null; // slot replaces icon
            } else {
              capsuleRightSlot = slotHtml;
              capsuleIconRight = null; // slot replaces icon
            }
          }
        }

        const capsuleHTML = renderCapsuleHTML({
          theme: capsuleTheme,
          thickness: capsuleThickness,
          value: Math.round(capsuleAngle),
          min: 0,
          max: 359,
          iconLeft: capsuleIconLeft,
          iconRight: capsuleIconRight,
          leftSlotHtml: capsuleLeftSlot,
          rightSlotHtml: capsuleRightSlot,
          inputEvents: hostEventAttrs({
            mousedown: "_startCapsuleDrag",
            touchstart: "_startCapsuleDrag",
            mouseup: "_endCapsuleDrag",
            touchend: "_endCapsuleDrag",
            input: "_handleCapsuleAngleInput",
          }),
          label: null,
          showValue: capsuleShowValue,
          valueText: capsuleValueText,
          underHtml: capsuleUnderHtml,
          wheelEvents: hostEventAttrs({ wheel: "_handleCapsuleWheel" }),
          trackExtraHtml: this.config.compass_snap_to_coordinates
            ? `<div class="capsule-snap-ticks">${[45, 90, 135, 180, 225, 270, 315].map((a) => `<div class="capsule-snap-tick" style="left:${(a / 359) * 100}%"></div>`).join("")}</div>`
            : "",
        });

        return html`<div class="angle-capsule-host" style="width:${this._getRotarySize()}%;margin:0 auto;">${unsafeHTML(capsuleHTML)}</div>`;
      }

      default: {
        // Get the actual colors from the lamp (EXACT same as wheel)
        const defaultTextColors = this._getCurrentTextColors();
        const defaultGradientStops =
          this._createShapeGradientStops(defaultTextColors);

        const defaultSelectorRadians = (visualAngle * Math.PI) / 180;

        // Make size configurable (EXACT same as wheel)
        // In header mode, use rotary size directly (no minimum constraint)
        const defaultSizePercent = this._getRotarySize();
        const defaultSize = Math.min(100, defaultSizePercent);
        const defaultRadius = (defaultSize * 45) / 100;
        const defaultSelectorRadius = (defaultSize * 40) / 100;

        // Position selector (EXACT same as wheel)
        const defaultSelectorX =
          50 + defaultSelectorRadius * Math.cos(defaultSelectorRadians);
        const defaultSelectorY =
          50 - defaultSelectorRadius * Math.sin(defaultSelectorRadians);

        // Gradient rotation (EXACT same as wheel)
        const defaultGradientAngle = -visualAngle;

        // Get selected shape
        const defaultShape = styleInfo.shape || "rectangle";
        const shapeMask = this._generateShapeMask(
          defaultShape,
          defaultSelectorRadius,
        );

        // Calculate gradient area to exactly match the shape size for perfect color distribution
        const gradientSize = defaultSelectorRadius * 2.0; // Exact match to shape boundaries
        const gradientX = 50 - gradientSize / 2;
        const gradientY = 50 - gradientSize / 2;
        const svgSize = isHeaderMode ? "88px" : `${defaultSizePercent}%`;

        return html`
          <div class="default-container" style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <svg width=${svgSize} height=${svgSize} viewBox="0 0 100 100" id="angle-preview" class="color-wheel" style="max-width: 200px; max-height: 200px;">
              <defs>
                <linearGradient id="defaultGradient" x1="0%" y1="50%" x2="100%" y2="50%">
                  ${unsafeSVG(defaultGradientStops)}
                </linearGradient>
                <mask id="shapeMask">
                  ${unsafeSVG(shapeMask)}
                </mask>
              </defs>
              <g transform="rotate(${defaultGradientAngle} 50 50)">
                <rect x=${gradientX} y=${gradientY} width=${gradientSize} height=${gradientSize} fill="url(#defaultGradient)" mask="url(#shapeMask)"/>
              </g>
              <!-- NO static frame - removed the stroke rectangle -->
              ${
                this.config.show_selector_dot !== false
                  ? svg`<circle cx=${defaultSelectorX} cy=${defaultSelectorY} r="4" class="wheel-selector" fill="#fff" stroke="#333" stroke-width="2"/>`
                  : nothing
              }
              <!-- Invisible circle to make entire area draggable -->
              <circle cx="50" cy="50" r=${defaultRadius} fill="transparent" style="cursor: pointer;"/>
              ${this._svgAngleValueTemplate(defaultRadius, visualAngle)}
            </svg>
          </div>
        `;
      }
    }
  }

  /**
   * Selector position (percent of the box) on a w:h rectangle perimeter,
   * starting at the right-edge centre and going counter-clockwise with the
   * angle — shared by the rect/square rotary render and visual updates.
   */
  _perimeterPoint(normalizedAngle, w, h) {
    const perimeter = 2 * (w + h);
    const pos = (normalizedAngle / 360) * perimeter;
    if (pos <= h / 2) {
      // Right edge, top half
      return { x: 100, y: 50 - (pos / (h / 2)) * 50 };
    }
    if (pos <= h / 2 + w) {
      // Top edge (going from right to left)
      return { x: 100 - ((pos - h / 2) / w) * 100, y: 0 };
    }
    if (pos <= h / 2 + w + h) {
      // Left edge (going from top to bottom)
      return { x: 0, y: ((pos - h / 2 - w) / h) * 100 };
    }
    if (pos <= h / 2 + w + h + w) {
      // Bottom edge (going from left to right)
      return { x: ((pos - h / 2 - w - h) / w) * 100, y: 100 };
    }
    // Right edge, bottom half (back to start)
    return { x: 100, y: 100 - ((pos - h / 2 - w - h - w) / (h / 2)) * 50 };
  }

  /**
   * Per-pixel [r,g,b] colours of a pure angle gradient over a rows×cols
   * matrix (row-major, top row first) — matrix rotary render and updates.
   */
  _angleGradientPixelColors(colors, angle, rows, cols) {
    const angleRad = (angle * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = -Math.sin(angleRad);

    const centerCol = (cols - 1) / 2;
    const centerRow = (rows - 1) / 2;
    const corners = [
      [-centerCol, -centerRow],
      [centerCol, -centerRow],
      [-centerCol, centerRow],
      [centerCol, centerRow],
    ];
    const cornerProjs = corners.map(([c, r]) => c * dirX + r * dirY);
    const minProj = Math.min(...cornerProjs);
    const maxProj = Math.max(...cornerProjs);
    const projRange = maxProj - minProj || 1;

    const out = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const projection = (col - centerCol) * dirX + (row - centerRow) * dirY;
        const t = Math.max(0, Math.min(1, (projection - minProj) / projRange));
        const colorIdx = t * (colors.length - 1);
        const i1 = Math.max(
          0,
          Math.min(colors.length - 1, Math.floor(colorIdx)),
        );
        const i2 = Math.min(colors.length - 1, i1 + 1);
        const frac = colorIdx - i1;
        out.push([
          Math.round(colors[i1][0] * (1 - frac) + colors[i2][0] * frac),
          Math.round(colors[i1][1] * (1 - frac) + colors[i2][1] * frac),
          Math.round(colors[i1][2] * (1 - frac) + colors[i2][2] * frac),
        ]);
      }
    }
    return out;
  }

  _handleRotaryDrag(e) {
    // Prevent text selection during dragging.  Touch drags pass a Touch
    // point (no preventDefault) — the touch event itself is already
    // cancelled by the caller.
    e.preventDefault?.();

    const rotaryElement = this.shadowRoot.getElementById("angle-preview");
    if (!rotaryElement) return;

    const styleInfo = this._getRotaryStyleInfo();
    const style = styleInfo.style;
    let angle = 0;

    const rect = rotaryElement.getBoundingClientRect();

    switch (style) {
      case "wheel":
        const wheelCx = rect.left + rect.width / 2;
        const wheelCy = rect.top + rect.height / 2;
        const wheelX = e.clientX - wheelCx;
        const wheelY = -(e.clientY - wheelCy); // Invert Y to match SVG coordinate system
        // Fix: 0° should be at center-right (3 o'clock), remove the +90 offset
        angle = (Math.atan2(wheelY, wheelX) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        break;

      case "rect":
        const rectCx = rect.left + rect.width / 2;
        const rectCy = rect.top + rect.height / 2;
        const rectRelX = e.clientX - rect.left;
        const rectRelY = e.clientY - rect.top;

        // Convert click position to percentage within rectangle
        const rectClickX = (rectRelX / rect.width) * 100;
        const rectClickY = (rectRelY / rect.height) * 100;

        // Map rectangle position to angle using SAME perimeter logic as display
        // Rectangle has 4:1 aspect ratio
        const rectWidth = 4;
        const rectHeight = 1;
        const perimeter = 2 * (rectWidth + rectHeight); // Total perimeter = 10 units

        let perimeterPos = 0;

        // Determine which edge and position on that edge
        if (rectClickX >= 90 && rectClickY <= 60) {
          // Right edge region - map Y position to perimeter
          if (rectClickY <= 50) {
            // Top half of right edge (0° to ~18°)
            const progress = (50 - rectClickY) / 50;
            perimeterPos = progress * (rectHeight / 2);
          } else {
            // Bottom half of right edge (~342° to 360°)
            const progress = (rectClickY - 50) / 50;
            perimeterPos = perimeter - progress * (rectHeight / 2);
          }
        } else if (rectClickY <= 20) {
          // Top edge region - map X position to perimeter
          const progress = (100 - rectClickX) / 100;
          perimeterPos = rectHeight / 2 + progress * rectWidth;
        } else if (rectClickX <= 10) {
          // Left edge region - map Y position to perimeter
          const progress = rectClickY / 100;
          perimeterPos = rectHeight / 2 + rectWidth + progress * rectHeight;
        } else if (rectClickY >= 80) {
          // Bottom edge region - map X position to perimeter
          const progress = rectClickX / 100;
          perimeterPos =
            rectHeight / 2 + rectWidth + rectHeight + progress * rectWidth;
        } else {
          // Inside rectangle - use distance to nearest edge to determine angle
          const distToRight = 100 - rectClickX;
          const distToLeft = rectClickX;
          const distToTop = rectClickY;
          const distToBottom = 100 - rectClickY;
          const minDist = Math.min(
            distToRight,
            distToLeft,
            distToTop,
            distToBottom,
          );

          if (minDist === distToRight) {
            // Closest to right edge
            perimeterPos =
              rectClickY <= 50
                ? ((50 - rectClickY) / 50) * (rectHeight / 2)
                : perimeter - ((rectClickY - 50) / 50) * (rectHeight / 2);
          } else if (minDist === distToTop) {
            // Closest to top edge
            perimeterPos =
              rectHeight / 2 + ((100 - rectClickX) / 100) * rectWidth;
          } else if (minDist === distToLeft) {
            // Closest to left edge
            perimeterPos =
              rectHeight / 2 + rectWidth + (rectClickY / 100) * rectHeight;
          } else {
            // Closest to bottom edge
            perimeterPos =
              rectHeight / 2 +
              rectWidth +
              rectHeight +
              (rectClickX / 100) * rectWidth;
          }
        }

        // Convert perimeter position to angle
        angle = (perimeterPos / perimeter) * 360;
        angle = ((angle % 360) + 360) % 360;
        break;

      case "square":
        // Handle square dragging using SAME perimeter logic as display
        const squareRelX = e.clientX - rect.left;
        const squareRelY = e.clientY - rect.top;

        // Convert click position to percentage within square
        const squareClickX = (squareRelX / rect.width) * 100;
        const squareClickY = (squareRelY / rect.height) * 100;

        // Map square position to angle using SAME perimeter logic as display
        // Square has 1:1 aspect ratio
        const squareWidth = 1;
        const squareHeight = 1;
        const squarePerimeter = 2 * (squareWidth + squareHeight); // Total perimeter = 4 units

        let squarePerimeterPos = 0;

        // Determine which edge and position on that edge
        if (squareClickX >= 85 && squareClickY <= 65) {
          // Right edge region - map Y position to perimeter
          if (squareClickY <= 50) {
            // Top half of right edge (0° to 45°)
            const progress = (50 - squareClickY) / 50;
            squarePerimeterPos = progress * (squareHeight / 2);
          } else {
            // Bottom half of right edge (315° to 360°)
            const progress = (squareClickY - 50) / 50;
            squarePerimeterPos =
              squarePerimeter - progress * (squareHeight / 2);
          }
        } else if (squareClickY <= 15) {
          // Top edge region - map X position to perimeter
          const progress = (100 - squareClickX) / 100;
          squarePerimeterPos = squareHeight / 2 + progress * squareWidth;
        } else if (squareClickX <= 15) {
          // Left edge region - map Y position to perimeter
          const progress = squareClickY / 100;
          squarePerimeterPos =
            squareHeight / 2 + squareWidth + progress * squareHeight;
        } else if (squareClickY >= 85) {
          // Bottom edge region - map X position to perimeter
          const progress = squareClickX / 100;
          squarePerimeterPos =
            squareHeight / 2 +
            squareWidth +
            squareHeight +
            progress * squareWidth;
        } else {
          // Inside square - use distance to nearest edge to determine angle
          const distToRight = 100 - squareClickX;
          const distToLeft = squareClickX;
          const distToTop = squareClickY;
          const distToBottom = 100 - squareClickY;
          const minDist = Math.min(
            distToRight,
            distToLeft,
            distToTop,
            distToBottom,
          );

          if (minDist === distToRight) {
            // Closest to right edge
            squarePerimeterPos =
              squareClickY <= 50
                ? ((50 - squareClickY) / 50) * (squareHeight / 2)
                : squarePerimeter -
                  ((squareClickY - 50) / 50) * (squareHeight / 2);
          } else if (minDist === distToTop) {
            // Closest to top edge
            squarePerimeterPos =
              squareHeight / 2 + ((100 - squareClickX) / 100) * squareWidth;
          } else if (minDist === distToLeft) {
            // Closest to left edge
            squarePerimeterPos =
              squareHeight / 2 +
              squareWidth +
              (squareClickY / 100) * squareHeight;
          } else {
            // Closest to bottom edge
            squarePerimeterPos =
              squareHeight / 2 +
              squareWidth +
              squareHeight +
              (squareClickX / 100) * squareWidth;
          }
        }

        // Convert perimeter position to angle
        angle = (squarePerimeterPos / squarePerimeter) * 360;
        angle = ((angle % 360) + 360) % 360;
        break;

      default:
        const defaultCx = rect.left + rect.width / 2;
        const defaultCy = rect.top + rect.height / 2;
        const defaultX = e.clientX - defaultCx;
        const defaultY = defaultCy - e.clientY;
        angle = (Math.atan2(defaultY, defaultX) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        break;
    }

    // Validate the calculated angle
    if (isNaN(angle) || !isFinite(angle)) {
      console.warn("Invalid angle calculated:", angle);
      return;
    }

    // Snap to compass coordinates if enabled (N/NE/E/SE/S/SW/W/NW)
    if (this.config.compass_snap_to_coordinates) {
      const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315];
      const snapThreshold = 12; // degrees — how close you need to be to snap
      for (const sa of snapAngles) {
        let diff = Math.abs(angle - sa);
        if (diff > 180) diff = 360 - diff;
        if (diff <= snapThreshold) {
          angle = sa;
          break;
        }
      }
    }

    // Store the pending angle for immediate visual feedback
    this._isDragging = true;
    this._pendingAngle = angle;

    // Update both input and slider if they exist
    this._syncAngleValueDisplay(angle);
    const angleSlider = this.shadowRoot.getElementById("angleslider");
    if (angleSlider) angleSlider.value = Math.round(angle);

    // Update visual elements directly for better performance
    if (style === "wheel") {
      this._updateWheelVisual(angle);
    } else if (style === "rect") {
      this._updateRectVisual(angle);
    } else if (style === "square") {
      this._updateSquareVisual(angle);
    } else if (style === "compass") {
      this._updateCompassVisual(angle);
    } else if (style === "matrix_preview") {
      this._updateMatrixPreviewVisual(angle);
    } else if (style === "capsule") {
      const pct = (angle / 359) * 100;
      updateCapsuleVisuals(
        this.shadowRoot,
        pct,
        `${Math.round(angle)}°`,
        ".angle-capsule-host",
      );
    } else if (style === "default") {
      // Use EXACT same logic as wheel for default mode
      this._updateWheelVisual(angle);
    }

    // Update gradient buttons during dragging for immediate visual feedback
    this._updateGradientButtons(angle);

    this._debouncedApplyAngle(angle);
  }

  // ── Capsule angle slider handlers ──────────────────────────
  _startCapsuleDrag() {
    this._usingSlider = true;
    this._holdAngleControl(() => this._endCapsuleDrag());
  }

  _endCapsuleDrag() {
    // Cancel pending debounce and apply the final angle immediately
    // (mirrors handleMouseUp for rotary drag to guarantee _applyAngle fires)
    if (this._pendingAngle !== null && this._pendingAngle !== undefined) {
      this._applyAngle(this._pendingAngle);
      this._lastAngleSent = this._pendingAngle;
      this._pendingAngle = null;
    }
    setTimeout(() => {
      this._usingSlider = false;
      this._flushPendingRender();
    }, 100);
  }

  _handleCapsuleAngleInput(event) {
    this._usingSlider = true;
    let angle = parseInt(event.target.value);
    if (isNaN(angle)) return;

    // Snap to compass coordinates if enabled (linear distance for capsule)
    if (this.config.compass_snap_to_coordinates) {
      const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 359];
      const snapThreshold = 12;
      for (const sa of snapAngles) {
        const diff = Math.abs(angle - sa);
        if (diff <= snapThreshold) {
          angle = sa;
          break;
        }
      }
    }

    // Sync the separate angle input/text if visible
    this._syncAngleValueDisplay(angle);

    // Update capsule visuals immediately
    const percent = (angle / 359) * 100;
    updateCapsuleVisuals(
      this.shadowRoot,
      percent,
      `${angle}°`,
      ".angle-capsule-host",
    );

    // Update gradient buttons for immediate visual feedback
    this._updateGradientButtons(angle);

    this._debouncedApplyAngle(angle);
  }

  _handleCapsuleWheel(event) {
    event.preventDefault();
    const input = this.shadowRoot.querySelector(
      ".angle-capsule-host .capsule-input",
    );
    if (!input) return;
    const current = parseInt(input.value) || 0;
    const delta = event.deltaY < 0 ? 5 : -5;
    const newValue = (((current + delta) % 360) + 360) % 360;
    input.value = newValue;
    // Trigger the same handler as manual drag
    this._handleCapsuleAngleInput({ target: input });
    // Wheel events are instantaneous (no mouseup) — clear _usingSlider
    // immediately so render() is not permanently blocked.
    this._usingSlider = false;
  }
  // ────────────────────────────────────────────────────────────

  /** Sync the angle-value UI elements (input field and/or read-only text). */
  _syncAngleValueDisplay(angle) {
    const rounded = Math.round(angle);
    const angleInput = this.shadowRoot.getElementById("angleinput");
    const angleText = this.shadowRoot.getElementById("angletext");
    const valueText = this.shadowRoot.querySelector(
      ".angle-capsule-host .capsule-value-text",
    );
    if (angleInput) angleInput.value = rounded;
    if (angleText) angleText.value = `${rounded}°`;
    if (valueText) valueText.textContent = `${rounded}°`;
  }

  _updateRotaryDisplay(angle) {
    const rotaryContainer = this.shadowRoot.querySelector(
      ".wheel-container, .rect-container, .default-container, .matrix-preview-container, .compass-container, .angle-capsule-host",
    );
    if (!rotaryContainer) return;

    const styleInfo = this._getRotaryStyleInfo();
    const style = styleInfo.style;

    switch (style) {
      case "wheel":
        this._updateWheelVisual(angle);
        break;

      case "rect":
        this._updateRectVisual(angle);
        break;

      case "square":
        this._updateSquareVisual(angle);
        break;

      case "compass":
        this._updateCompassVisual(angle);
        break;

      case "matrix_preview":
        this._updateMatrixPreviewVisual(angle);
        break;

      case "capsule": {
        const percent = (angle / 359) * 100;
        updateCapsuleVisuals(
          this.shadowRoot,
          percent,
          `${Math.round(angle)}°`,
          ".angle-capsule-host",
        );
        // Also sync the hidden range input
        const capsuleInput = this.shadowRoot.querySelector(
          ".angle-capsule-host .capsule-input",
        );
        if (capsuleInput) capsuleInput.value = Math.round(angle);
        break;
      }

      case "default":
        // Use EXACT same logic as wheel
        const defaultSelectorRadians = (angle * Math.PI) / 180;
        const defaultSizePercent = this.config.default_size || 80;
        const defaultSize = Math.min(100, defaultSizePercent);
        const defaultSelectorRadius = (defaultSize * 40) / 100;

        const defaultSelectorX =
          50 + defaultSelectorRadius * Math.cos(defaultSelectorRadians);
        const defaultSelectorY =
          50 - defaultSelectorRadius * Math.sin(defaultSelectorRadians);
        const defaultGradientAngle = -angle;

        // Update selector dot position
        const defaultSelectorDot =
          this.shadowRoot.querySelector(".wheel-selector");
        if (defaultSelectorDot) {
          defaultSelectorDot.setAttribute("cx", defaultSelectorX);
          defaultSelectorDot.setAttribute("cy", defaultSelectorY);
        }

        // Update gradient rotation
        const defaultGradientGroup = this.shadowRoot.querySelector(
          "g[transform*='rotate']",
        );
        if (defaultGradientGroup) {
          defaultGradientGroup.setAttribute(
            "transform",
            `rotate(${defaultGradientAngle} 50 50)`,
          );
        }
        break;
    }
  }

  _updateWheelVisual(angle) {
    const selectorRadians = (angle * Math.PI) / 180;

    // Use unified sizing method
    const sizePercent = this._getRotarySize();
    const selectorRadius = (sizePercent * 45) / 100; // On circle border

    const selectorX = 50 + selectorRadius * Math.cos(selectorRadians);
    const selectorY = 50 - selectorRadius * Math.sin(selectorRadians);
    const gradientAngle = -angle;

    // Update selector dot position
    const selectorDot = this.shadowRoot.querySelector(".wheel-selector");
    if (selectorDot) {
      selectorDot.setAttribute("cx", selectorX);
      selectorDot.setAttribute("cy", selectorY);
    }

    // Update gradient rotation
    const gradientGroup = this.shadowRoot.querySelector(
      'g[transform*="rotate"]',
    );
    if (gradientGroup) {
      gradientGroup.setAttribute("transform", `rotate(${gradientAngle} 50 50)`);
    }

    // Handle arrow window mask groups if present (wheel + mask mode)
    const awRotateGroups = this.shadowRoot.querySelectorAll(".aw-rotate");
    awRotateGroups.forEach((g) =>
      g.setAttribute("transform", `rotate(${gradientAngle} 50 50)`),
    );
    const awGradGroup = this.shadowRoot.querySelector(".aw-grad-group");
    if (awGradGroup) {
      awGradGroup.setAttribute("transform", `rotate(${gradientAngle} 50 50)`);
    }
  }

  _updateRectVisual(angle) {
    // EXACT same logic as wheel for consistency
    const normalizedAngle = ((angle % 360) + 360) % 360;

    // Position on the 4:1 rectangle perimeter (same mapping as the render)
    const { x: rectSelectorX, y: rectSelectorY } = this._perimeterPoint(
      normalizedAngle,
      4,
      1,
    );

    // Gradient rotation EXACT same as wheel
    const gradientAngle = -normalizedAngle;

    // Update selector dot position using CSS positioning
    const rectSelectorDot = this.shadowRoot.querySelector(".rect-selector");
    if (rectSelectorDot) {
      rectSelectorDot.style.left = `${rectSelectorX}%`;
      rectSelectorDot.style.top = `${rectSelectorY}%`;
    }

    // Update gradient background using CSS - SAME rotation as wheel
    const rectElement = this.shadowRoot.querySelector(".rect-gradient");
    if (rectElement) {
      const rectTextColors = this._getCurrentTextColors();
      const colorStops = rectTextColors
        .map((color) => rgbToCss(color))
        .join(", ");
      rectElement.style.background = `linear-gradient(${
        90 + gradientAngle
      }deg, ${colorStops})`;
    }
  }

  _updateSquareVisual(angle) {
    // EXACT same logic as rectangle but for 1:1 square
    const normalizedAngle = ((angle % 360) + 360) % 360;

    // Position on the 1:1 square perimeter (same mapping as the render)
    const { x: squareSelectorX, y: squareSelectorY } = this._perimeterPoint(
      normalizedAngle,
      1,
      1,
    );

    // Gradient rotation EXACT same as rectangle
    const gradientAngle = -normalizedAngle;

    // Update selector dot position using CSS positioning
    const squareSelectorDot = this.shadowRoot.querySelector(".square-selector");
    if (squareSelectorDot) {
      squareSelectorDot.style.left = `${squareSelectorX}%`;
      squareSelectorDot.style.top = `${squareSelectorY}%`;
    }

    // Update gradient background using CSS - SAME rotation as rectangle
    const squareElement = this.shadowRoot.querySelector(".square-gradient");
    if (squareElement) {
      const squareTextColors = this._getCurrentTextColors();
      const colorStops = squareTextColors
        .map((color) => rgbToCss(color))
        .join(", ");
      squareElement.style.background = `linear-gradient(${
        90 + gradientAngle
      }deg, ${colorStops})`;
    }

    // Update angle display
    const squareAngleDisplay = this.shadowRoot.querySelector(".square-angle");
    if (squareAngleDisplay) {
      squareAngleDisplay.textContent = `${Math.round(angle)}°`;
    }
  }

  // Unified update for compass style (needle/beam/arrow shapes)
  _updateCompassVisual(angle) {
    const gradientAngle = -angle;
    const selectorRadians = (angle * Math.PI) / 180;
    const sizePercent = this._getRotarySize();
    const selectorRadius = (Math.min(100, sizePercent) * 45) / 100; // On circle border
    const selectorX = 50 + selectorRadius * Math.cos(selectorRadians);
    const selectorY = 50 - selectorRadius * Math.sin(selectorRadians);

    const dot = this.shadowRoot.querySelector(".wheel-selector");
    if (dot) {
      dot.setAttribute("cx", selectorX);
      dot.setAttribute("cy", selectorY);
    }

    const compassShape = this._getCompassShape();

    if (compassShape === "none") {
      // No overlay — nothing to update beyond selector dot
    } else if (compassShape === "beam") {
      // Recalculate beam wedge path — origin from opposite border
      const radius = (Math.min(100, sizePercent) * 45) / 100;
      const beamSpread = 30;
      const angleRad = (angle * Math.PI) / 180;
      const originX = 50 - radius * Math.cos(angleRad);
      const originY = 50 + radius * Math.sin(angleRad);
      const rad1 = ((angle + beamSpread) * Math.PI) / 180;
      const rad2 = ((angle - beamSpread) * Math.PI) / 180;
      const bx1 = 50 + radius * Math.cos(rad1);
      const by1 = 50 - radius * Math.sin(rad1);
      const bx2 = 50 + radius * Math.cos(rad2);
      const by2 = 50 - radius * Math.sin(rad2);
      const newPath = `M ${originX} ${originY} L ${bx1} ${by1} A ${radius} ${radius} 0 0 1 ${bx2} ${by2} Z`;

      const clipPath = this.shadowRoot.querySelector(".beam-wedge-path");
      if (clipPath) clipPath.setAttribute("d", newPath);

      const outline = this.shadowRoot.querySelector(".beam-outline");
      if (outline) outline.setAttribute("d", newPath);

      const gradGroup = this.shadowRoot.querySelector(".beam-grad-group");
      if (gradGroup)
        gradGroup.setAttribute("transform", `rotate(${gradientAngle} 50 50)`);
    } else {
      // Needle or Arrow — rotate all .comp-rotate groups
      const rotGroups = this.shadowRoot.querySelectorAll(".comp-rotate");
      rotGroups.forEach((g) => {
        g.setAttribute("transform", `rotate(${gradientAngle} 50 50)`);
      });
    }
  }

  /**
   * Get the 100-pixel color array for the matrix rotary text preview.
   * Uses the same data source as the lamp preview card: reads matrix_colors
   * directly from the HA entity state for instant updates.  Falls back to
   * the preview_gradient_modes cache only when entity state is unavailable.
   */
  _getMatrixPreviewColors(rows, cols) {
    // PRIMARY: read matrix_colors from entity state (same as lamp preview card)
    const entityId = this._getPrimaryEntity();
    const stateObj = entityId ? this._hass?.states?.[entityId] : null;
    const matrixColors = stateObj?.attributes?.matrix_colors;
    // While the lamp is off its matrix is black (and it is empty while the
    // firmware draws it): preview the text from the cache instead.
    if (
      stateObj?.state === "on" &&
      matrixColors &&
      matrixColors.length >= rows * cols
    ) {
      return matrixColors;
    }
    // FALLBACK: preview cache (lamp off, firmware-drawn mode, or no data yet)
    const cache = this._previewCache();
    const previewData = cache?.data;
    const currentMode = this._getCurrentMode();
    return previewData?.previews?.[currentMode] || null;
  }

  /**
   * Render pixel divs for the matrix rotary in "text preview" mode.
   * Reads matrix_colors directly from entity state (same approach as the
   * lamp preview card) for instant updates when panel mode changes.
   */
  _renderMatrixTextPreviewPixels(
    rows,
    cols,
    bgColor,
    ignoreBlack,
    borderRadius,
    pixelShadowStyle = "",
  ) {
    const previewColors = this._getMatrixPreviewColors(rows, cols);

    if (!previewColors || previewColors.length < rows * cols) {
      // Fallback: show empty grid if no preview data yet
      const emptyBg =
        bgColor === "transparent"
          ? "rgba(128,128,128,0.2)"
          : "rgba(255,255,255,0.08)";
      return Array.from(
        { length: rows * cols },
        () =>
          html`<div class="matrix-pixel" style="background:${emptyBg};border-radius:${borderRadius};aspect-ratio:1;${pixelShadowStyle}"></div>`,
      );
    }

    // Flip vertically (same convention as _renderPreviewGrid)
    const divs = [];
    for (let row = rows - 1; row >= 0; row--) {
      for (let col = 0; col < cols; col++) {
        const color = previewColors[row * cols + col];
        const [r, g, b] = color;
        const isBlack = r <= 5 && g <= 5 && b <= 5;
        const shouldIgnore = ignoreBlack && isBlack;
        divs.push(
          html`<div class="matrix-pixel" style="background:${shouldIgnore ? "transparent" : rgbToCss(color)};border-radius:${borderRadius};aspect-ratio:1;${pixelShadowStyle}"></div>`,
        );
      }
    }
    return divs;
  }

  _updateMatrixPreviewVisual(angle) {
    const mpRows = 5;
    const mpCols = 20;
    const mpIgnoreBlack = this.config.matrix_rotary_ignore_black === true;
    const pixels = this.shadowRoot.querySelectorAll(".matrix-pixel");
    if (!pixels.length) return;

    // Text preview mode: show entity state matrix_colors (same as lamp
    // preview card) for instant updates.  Falls back to preview cache.
    // During active drag, fall through to gradient computation for
    // immediate visual feedback of the angle change.
    if (
      this.config.matrix_rotary_text_preview === true &&
      !this._draggingRotary
    ) {
      const previewColors = this._getMatrixPreviewColors(mpRows, mpCols);
      if (previewColors && previewColors.length >= mpRows * mpCols) {
        let idx = 0;
        for (let row = mpRows - 1; row >= 0; row--) {
          for (let col = 0; col < mpCols; col++) {
            if (idx >= pixels.length) break;
            const color = previewColors[row * mpCols + col];
            const [r, g, b] = color;
            const isBlack = r <= 5 && g <= 5 && b <= 5;
            const shouldIgnore = mpIgnoreBlack && isBlack;
            pixels[idx].style.background = shouldIgnore
              ? "transparent"
              : rgbToCss(color);
            idx++;
          }
        }
        return;
      }
      // No preview data available yet — fall through to gradient visualization
    }

    // Pure angle gradient mode
    const colors = this._angleGradientPixelColors(
      this._getCurrentTextColors(),
      angle,
      mpRows,
      mpCols,
    );
    const count = Math.min(colors.length, pixels.length);
    for (let idx = 0; idx < count; idx++) {
      const [r, g, b] = colors[idx];
      const isBlack = r <= 5 && g <= 5 && b <= 5;
      const shouldIgnore = mpIgnoreBlack && isBlack;
      pixels[idx].style.background = shouldIgnore
        ? "transparent"
        : rgbToCss(colors[idx]);
    }
  }

  _updateGradientButtons(angle) {
    // Only the "chips" style renders angle-dependent gradient swatches that
    // need live updates during angle drags.  All other text styles use plain
    // labels, and preview styles update via the preview pipeline.
    if (this._getModeSelectorStyle() !== "chips") return;

    const textColors = this._getCurrentTextColors();

    // Chips style: live-update the two angle-dependent chip swatches
    ["Angle Gradient", "Letter Angle Gradient"].forEach((mode) => {
      this.shadowRoot
        .querySelectorAll(`.mode-chip[data-mode="${mode}"] .mode-chip-swatch`)
        .forEach((swatch) => {
          swatch.style.background = this.getModeGradientColors(
            mode,
            textColors,
            angle,
          );
        });
    });
  }

  getModeGradientColors(mode, textColors, currentAngle) {
    // Use default colors if none provided
    const colors =
      textColors && textColors.length > 0
        ? textColors
        : [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
          ];

    // Helper function to replicate Python's calculate_multi_gradient_color
    const calculateMultiGradientColor = (colors, position, totalPositions) => {
      if (!colors || colors.length === 0) return [255, 0, 0];
      if (colors.length === 1 || totalPositions <= 1) return colors[0];

      position = Math.max(0, Math.min(position, totalPositions - 1));
      const nSegments = colors.length - 1;
      const segmentLength =
        nSegments > 0 ? (totalPositions - 1) / nSegments : 1;
      const segment = Math.min(
        Math.floor(position / segmentLength),
        nSegments - 1,
      );

      const startColor = colors[segment];
      const endColor = colors[Math.min(segment + 1, colors.length - 1)];

      const localStart = segment * segmentLength;
      const localFactor =
        segmentLength > 0 ? (position - localStart) / segmentLength : 0;

      return [
        Math.round(startColor[0] + (endColor[0] - startColor[0]) * localFactor),
        Math.round(startColor[1] + (endColor[1] - startColor[1]) * localFactor),
        Math.round(startColor[2] + (endColor[2] - startColor[2]) * localFactor),
      ];
    };

    // RGB arrays are converted with the hardened shared rgbToCss
    // (./yeelight-cube-dotmatrix.js), which clamps every channel.

    // Create deterministic "random" based on colors array to avoid constant changes
    const colorHash = colors.map((c) => c.join(",")).join("|");
    let seed = 0;
    for (let i = 0; i < colorHash.length; i++) {
      seed = ((seed << 5) - seed + colorHash.charCodeAt(i)) & 0xffffffff;
    }

    // Simple deterministic random function
    const deterministicRandom = (index) => {
      const x = Math.sin(seed + index * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // Create mini-preview gradients that replicate the actual mode calculations
    switch (mode) {
      case "Solid Color":
        // Use first color only
        return rgbToCss(colors[0]);

      case "Letter Gradient":
        // Each letter gets a different color - show discrete steps, not smooth gradient
        if (colors.length === 1) return rgbToCss(colors[0]);
        const letterSteps = colors
          .map((color, i) => {
            const startPercent = (i / colors.length) * 100;
            const endPercent = ((i + 1) / colors.length) * 100;
            return `${rgbToCss(color)} ${startPercent}% ${endPercent}%`;
          })
          .join(", ");
        return `linear-gradient(90deg, ${letterSteps})`;

      case "Column Gradient":
        // Vertical columns get gradient - show vertical gradient
        const colGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 columns
          const color = calculateMultiGradientColor(colors, i, 10);
          colGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(90deg, ${colGradient.join(", ")})`;

      case "Row Gradient":
        // Horizontal rows get gradient - show horizontal gradient
        const rowGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 rows
          const color = calculateMultiGradientColor(colors, i, 10);
          rowGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(0deg, ${rowGradient.join(", ")})`;

      case "Angle Gradient":
        // Directional gradient based on current angle setting
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const angleDeg = -(currentAngle || 0) + 90;
        const angleGradient = [];
        for (let i = 0; i < colors.length; i++) {
          angleGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(${angleDeg}deg, ${angleGradient.join(", ")})`;

      case "Radial Gradient":
        // Radial from center outward
        const radialGradient = [];
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          const distance = i / (steps - 1);
          const color = calculateMultiGradientColor(
            colors,
            distance * (colors.length - 1),
            colors.length,
          );
          radialGradient.push(`${rgbToCss(color)} ${(i / (steps - 1)) * 100}%`);
        }
        return `radial-gradient(circle, ${radialGradient.join(", ")})`;

      case "Letter Vertical Gradient":
        // Vertical gradient within each letter - columns get different colors (left to right)
        const letterVertGradient = [];
        for (let i = 0; i < colors.length; i++) {
          letterVertGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(90deg, ${letterVertGradient.join(", ")})`;

      case "Letter Angle Gradient":
        // Angle gradient within each letter using current angle setting
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const letterAngleGrad = [];
        for (let i = 0; i < colors.length; i++) {
          letterAngleGrad.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        const letterAngle = -(currentAngle || 0) + 90;
        return `linear-gradient(${letterAngle}deg, ${letterAngleGrad.join(
          ", ",
        )})`;

      case "Text Color Sequence":
        // Random/shuffled colors - create discrete color blocks that fill the button
        if (colors.length === 1) return rgbToCss(colors[0]);

        // Create a checkerboard pattern of color squares using CSS patterns
        // Simple approach: create alternating color stripes in both directions

        // Pick 4 random colors for a 2x2 repeating pattern
        const patternColors = [];
        for (let i = 0; i < 4; i++) {
          const randomValue = deterministicRandom(i);
          const randomColorIndex = Math.floor(randomValue * colors.length);
          patternColors.push(colors[randomColorIndex]);
        }

        // Create horizontal stripes (rows)
        const verticalStripes = `repeating-linear-gradient(90deg, 
          ${rgbToCss(patternColors[2])} 0%, ${rgbToCss(patternColors[2])} 25%, 
          ${rgbToCss(patternColors[3])} 25%, ${rgbToCss(patternColors[3])} 50%,
          ${rgbToCss(patternColors[0])} 50%, ${rgbToCss(patternColors[0])} 75%,
          ${rgbToCss(patternColors[1])} 75%, ${rgbToCss(
            patternColors[1],
          )} 100%)`;

        // Combine both to create a grid effect
        return verticalStripes;

      default:
        return rgbToCss(colors[0]);
    }
  }

  generateColorModeSelector(colorMode, style, textColors, currentAngle) {
    // Shared appearance axes — identical semantics across every style
    const selShape = resolveSelectorShape(this.config);
    const selScale = resolveSelectorTextScale(this.config);
    const allModes = [
      { value: "Solid Color", label: "Solid" },
      { value: "Letter Gradient", label: "Letter Grad" },
      { value: "Column Gradient", label: "Column Grad" },
      { value: "Row Gradient", label: "Row Grad" },
      { value: "Angle Gradient", label: "Angle Grad" },
      { value: "Radial Gradient", label: "Radial Grad" },
      { value: "Letter Vertical Gradient", label: "Letter Vert" },
      { value: "Letter Angle Gradient", label: "Letter Angle" },
      { value: "Text Color Sequence", label: "Color Seq" },
    ];
    // Same visibility/order config as the preview styles.
    const byValue = new Map(allModes.map((m) => [m.value, m]));
    const modes = this._orderedModes()
      .map((name) => byValue.get(name))
      .filter(Boolean);

    switch (style) {
      case "chips":
        // Chip style: HA-chip-like pills with a live gradient swatch per mode
        return html`
          <div class="gc-selector color-mode-chips yc-row" data-shape=${selShape} style="--gc-sel-scale:${selScale};">
            ${modes.map((mode) => {
              let swatchBg;
              if (mode.value === "Text Color Sequence") {
                // Conic-gradient "pie" with up to 4 colors gives a
                // compact multi-color swatch that reflects the randomness
                // of the mode — much clearer than vertical stripes.
                const stops = textColors.slice(0, 4);
                while (stops.length < 4)
                  stops.push(stops[stops.length - 1] || [200, 200, 200]);
                const pct = 100 / stops.length;
                swatchBg = `conic-gradient(${stops
                  .map(
                    (c, i) =>
                      `${rgbToCss(c)} ${i * pct}% ${(i + 1) * pct}%`,
                  )
                  .join(", ")})`;
              } else {
                swatchBg = this.getModeGradientColors(
                  mode.value,
                  textColors,
                  currentAngle,
                );
              }
              return html`
              <button class="mode-chip ${
                colorMode === mode.value ? "active" : ""
              }" data-mode=${mode.value} title=${mode.value} @click=${this._onModeButtonClick}>
                <span class="mode-chip-swatch" style="background:${swatchBg}"></span>
                <span class="mode-chip-label">${mode.label}</span>
              </button>
            `;
            })}
          </div>`;

      case "dropdown":
        return html`
          <div class="gc-selector color-mode-dropdown" data-shape=${selShape} style="--gc-sel-scale:${selScale};">
            <select class="mode-select" data-mode-select="true"
              @focus=${this._onModeDropdownFocus}
              @blur=${this._onModeDropdownBlur}
              @change=${this._onModeDropdownChange}>
              ${modes.map(
                (mode) => html`
                <option value=${mode.value} ?selected=${colorMode === mode.value}>
                  ${mode.value}
                </option>
              `,
              )}
            </select>
          </div>`;

      case "compact":
      case "pills":
      case "buttons":
      case "filled":
      default:
        // Unified "Filled" text style (legacy buttons/pills/compact fall here).
        return html`
          <div class="gc-selector color-mode-filled yc-row" data-shape=${selShape} style="--gc-sel-scale:${selScale};">
            ${modes.map(
              (mode) => html`
              <button class="mode-btn-filled ${
                colorMode === mode.value ? "active" : ""
              }"
                      data-mode=${mode.value}
                      title=${mode.label}
                      @click=${this._onModeButtonClick}>
                ${mode.label}
              </button>
            `,
            )}
          </div>`;
    }
  }

  getCardSize() {
    // Estimate by selector presentation so masonry layout stacks sensibly
    const style = resolveModeSelectorStyle(this.config || {});
    if (style === "preview-list" || style === "preview-grid") return 8;
    if (style === "preview-wheel") return 5;
    if (style === "preview-carousel") return 4;
    return 4;
  }
}

defineOnce("yeelight-cube-gradient-card", YeelightCubeGradientCard);

if (typeof window !== "undefined") {
  registerCustomCard({
      type: "yeelight-cube-gradient-card",
      name: "Yeelight Gradient Card",
      description:
        "Control gradient settings for Yeelight Cube Lite matrix display",
      preview: true,
    });
}
