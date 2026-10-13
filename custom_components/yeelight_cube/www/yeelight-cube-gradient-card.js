import { LitElement, html, unsafeCSS } from "./lib/lit-all.js";

import { resolvePreviewAppearance } from "./preview-appearance.js";

import { SUPERSEDED } from "./card-command-controller.js";

import { AngleCommandController } from "./angle-wheel-utils.js";

import {
  TEXT_SELECTOR_STYLES,
  PREVIEW_SELECTOR_STYLES,
} from "./selector-shared-styles.js";

import { defineOnce, registerCustomCard } from "./card-registration.js";
import { createSliderDraft } from "./slider-control-utils.js";
import { tabBar } from "./tab-bar.js";
import { galleryCardSize, valueKey, YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampNotFoundNotice,
  NOTICE,
} from "./card-shell.js";
import { normalizeCardOptions, itemLabel } from "./card-config.js";
import { AngleControlMixin } from "./gradient-angle-control.js";
import { ModeSelectorMixin } from "./gradient-mode-selector.js";
import { GRADIENT_CARD_CSS } from "./gradient-card-styles.js";
import { nothing } from "./lib/lit-all.js";

// Host methods the angle capsule markup may call (see bindHostEvents).
const CAPSULE_HANDLERS = new Set([
  "_startCapsuleDrag",
  "_endCapsuleDrag",
  "_handleCapsuleAngleInput",
  "_handleCapsuleWheel",
]);

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
// `style_selector_style` config key covering every presentation:
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
/**
 * The mode selector's layout: a known style, else the preview list (older
 * layouts are migrated by normalizeCardOptions).
 */
function resolveModeSelectorStyle(cfg) {
  const style = cfg?.style_selector_style;
  return TEXT_SELECTOR_STYLES.includes(style) ||
    PREVIEW_SELECTOR_STYLES.includes(style)
    ? style
    : "preview-list";
}

// The "Apply to Whole Panel" tabs: the text's pixels or the whole panel.
const PANEL_TABS = [
  {
    key: "pixels",
    label: "Pixels",
    icon: html`<svg width="12" height="9" viewBox="0 0 12 9" fill="currentColor" style="flex-shrink:0;opacity:0.75"><rect x="0" y="0" width="3" height="3" rx="0.5"/><rect x="4.5" y="0" width="3" height="3" rx="0.5"/><rect x="9" y="0" width="3" height="3" rx="0.5"/><rect x="0" y="5" width="3" height="3" rx="0.5"/><rect x="4.5" y="5" width="3" height="3" rx="0.5"/><rect x="9" y="5" width="3" height="3" rx="0.5"/></svg>`,
  },
  {
    key: "panel",
    label: "Panel",
    icon: html`<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="flex-shrink:0;opacity:0.85"><rect x="0" y="0" width="5" height="5" rx="1"/><rect x="7" y="0" width="5" height="5" rx="1"/><rect x="0" y="7" width="5" height="5" rx="1"/><rect x="7" y="7" width="5" height="5" rx="1"/></svg>`,
  },
];

class YeelightCubeGradientCard extends ModeSelectorMixin(
  AngleControlMixin(YeelightCardMixin(LitElement)),
) {
  static editor = [
    "yeelight-cube-gradient-card-editor",
    "./yeelight-cube-gradient-card-editor.js",
  ];
  // The angle capsule names its handlers in data-on-* attributes.
  static hostEvents = (name) => CAPSULE_HANDLERS.has(name);

  // No reactive properties: _renderCard() requests a Lit update when what
  // the card shows changed (see set hass), except while an angle is dragged
  // or typed (_angleBusy: the render waits for the end of it).
  static styles = unsafeCSS(GRADIENT_CARD_CSS);

  constructor() {
    super();
    // Every service call of this card (except the debounced angle, see
    // _angleCommands) goes through the card's queue (this._commands).
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
    this._lastModeChangeTime = 0; // Track when mode was last changed
    this._optimisticMode = null; // Store the optimistic mode selection
    this._pendingHassRender = false; // Track if a render was blocked by interaction flags
    this._interactionSafetyTimer = null; // Safety timer to flush pending renders
    this._previewEventListenerRegistered = false; // Track event listener for global preview cache
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
  connectedCallback() {
    super.connectedCallback();
    // Re-establish the preview event subscription dropped on disconnect.
    if (!this._previewEventListenerRegistered && this._hass) {
      this._setupPreviewEventListener();
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
    this._isDragging = false;
  }

  setConfig(config) {
    config = resolvePreviewAppearance(normalizeCardOptions(config, "gradient"), "gradient");
    this._angleCommands.reset();
    this._commands?.reset();
    this._pendingAngle = null;
    this._removeRotaryDocListeners();
    this._draggingRotary = false;
    this._isDragging = false;
    clearTimeout(this._anglePreviewReloadTimer);
    clearTimeout(this._previewRetryTimer);
    clearTimeout(this._previewReloadTimer);
    this._unsubscribePreviewEvents?.();
    this._unsubscribePreviewEvents = null;
    this._previewEventListenerRegistered = false;
    this._previewContext = (this._previewContext || 0) + 1;
    // One resolved layout for the card, its gallery and its editor (older
    // configs used other keys, see resolveModeSelectorStyle).
    config = { ...config, style_selector_style: resolveModeSelectorStyle(config) };

    this.config = config;
    this._setupPreviewEventListener();
    this._renderCard();
  }

  static getStubConfig(hass) {
    const allEntities = cubeLampEntities(hass);
    const firstEntity = allEntities[0] || "";
    return {
      type: "custom:yeelight-cube-gradient-card",
      entity: firstEntity,
      target_entities: allEntities.length > 0 ? allEntities : [],
      style_selector_style: "preview-wheel",
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
      preview_size: 64,
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

    // Nothing the card shows changed (_hassInputs) and no optimistic value
    // waits for the lamp's echo: nothing to do.
    if (
      !this._hassChanged(hass) &&
      this._optimisticMode == null &&
      this._optimisticPanelMode === undefined &&
      this._optimisticFillCols === undefined
    )
      return;
    if (!this.config) return;
    const entity = hass?.states?.[this._getPrimaryEntity()];
    if (!entity) {
      // No lamp (or it was removed): render() shows the notice.
      this._renderCard();
      return;
    }
    const attrs = entity.attributes;

    // Optimistic values: dropped once the lamp reports them.
    if (
      this._optimisticPanelMode !== undefined &&
      (attrs.full_panel || false) === this._optimisticPanelMode
    )
      this._optimisticPanelMode = undefined;
    if (this._optimisticMode && attrs.mode === this._optimisticMode) {
      this._optimisticMode = null;
      clearTimeout(this._optimisticModeTimeout);
      this._optimisticModeTimeout = null;
    }
    if (
      this._optimisticFillCols !== undefined &&
      (FILL_PANEL_CHAR_TO_COLS[attrs.custom_text || ""] || 0) ===
        this._optimisticFillCols
    )
      this._optimisticFillCols = undefined;

    // The gallery's previews follow what the lamp shows (text, angle,
    // colors, its rendered matrix, panel mode): reloaded after 500 ms
    // without a change. Text selectors need no previews.
    if (this._isPreviewSelectorActive()) {
      const previewKey = [
        attrs.custom_text,
        attrs.angle,
        valueKey(attrs.text_colors),
        valueKey(attrs.matrix_colors),
        attrs.full_panel || false,
      ].join("\u0000");
      if (previewKey !== this._previewKey) {
        this._previewKey = previewKey;
        clearTimeout(this._previewReloadTimer);
        this._previewReloadTimer = setTimeout(() => {
          this._loadPreviews().catch((err) =>
            console.error("[Gradient Card] Error reloading previews:", err),
          );
        }, 500);
      }
    }

    // The gallery follows the lamp's mode at once (another dashboard, an
    // automation, the confirmed echo of a pick), even while a render waits.
    if (attrs.mode !== this._lastMode) {
      this._lastMode = attrs.mode;
      this._refreshGallery();
    }

    // Renders wait while an angle is dragged or typed, and for 2 s after a
    // mode pick (older lamp updates must not override the picked mode).
    if (!this._angleBusy() && Date.now() - this._lastModeChangeTime > 2000) {
      this._pendingHassRender = false;
      this._renderCard();
    } else {
      this._pendingHassRender = true;
      this._startInteractionSafety();
    }
  }

  // What the card shows from the lamp, compared value by value with the last
  // update: its state and the attributes the controls, gallery and matrix
  // preview read (color lists by content).
  _hassInputs(hass) {
    const entity = hass?.states?.[this._getPrimaryEntity()];
    const attrs = entity?.attributes || {};
    return [
      this.config,
      entity?.state,
      attrs.angle,
      attrs.mode,
      attrs.full_panel,
      attrs.custom_text,
      valueKey(attrs.text_colors),
      valueKey(attrs.matrix_colors),
    ];
  }

  // Flush any render that was blocked while interaction flags were set.
  // Called when an interaction flag is cleared to recover missed state updates.
  _flushPendingRender() {
    if (!this._pendingHassRender || this._angleBusy()) return;
    this._pendingHassRender = false;
    if (this._interactionSafetyTimer) {
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
    }
    this._renderCard();
  }

  // Safety timer: periodically check if all interaction flags have cleared
  // and flush the pending render. Covers edge cases where flag-clearing code
  // paths don't explicitly call _flushPendingRender().
  _startInteractionSafety() {
    if (this._interactionSafetyTimer) return; // Already running
    this._interactionSafetyTimer = setInterval(() => {
      if (this._angleBusy()) return;
      clearInterval(this._interactionSafetyTimer);
      this._interactionSafetyTimer = null;
      this._flushPendingRender();
    }, 1000);
  }

  /** An angle is being dragged or typed: the drag path moves the visuals. */
  _angleBusy() {
    return !!(
      this._draggingRotary ||
      this._isDragging ||
      this._usingSlider ||
      this._typingAngle
    );
  }

  /**
   * Show the current state: a Lit update, or, while an angle is dragged or
   * typed, one when it ends (_flushPendingRender).
   */
  _renderCard() {
    if (this._angleBusy()) {
      this._pendingHassRender = true;
      this._startInteractionSafety();
      return;
    }
    this.requestUpdate();
  }

  render() {
    const hass = this._hass;
    if (!hass || !this.config) return nothing;
    const primaryEntity = this._getPrimaryEntity();
    const stateObj = primaryEntity ? hass.states[primaryEntity] : null;
    if (!stateObj)
      return primaryEntity
        ? lampNotFoundNotice(this, primaryEntity)
        : cardNotice(this, NOTICE.noLamp);

    const currentAngle = this._displayAngle(stateObj);

    // The mode selector: the shared gallery (text or preview styles).
    const showModeSelector =
      this.config.show_mode_selector !== undefined
        ? this.config.show_mode_selector !== false
        : true;
    const showPanelToggle = this.config.show_panel_toggle !== false;
    const showAngleSection = this.config.show_angle_section !== false;
    const showAngleSlider = this.config.show_angle_slider !== false;

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
      <div class="yc-stack">
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
        <!-- Runtime Controls: the active-mode label -->
        <div class="runtime-controls" ?hidden=${!showActiveModeLabel}>
          <div class="control-section yc-stack yc-controls">
            ${
              showActiveModeLabel
                ? html`<div style="display:flex;justify-content:${_alignToJustify(labelAlign)};width:100%;">
                     <div class="gc-active-mode-label" id="gc-active-mode-label" title="Currently active mode" style="margin:0;">
                       <span class="gc-aml-dot"></span>
                       <span class="gc-aml-text">${itemLabel(this.config, colorMode, colorMode)}</span>
                     </div>
                   </div>`
                : nothing
            }
          </div>
        </div>
        ${showModeSelector ? this._galleryTemplate() : nothing}
        <div id="preview-anchor" style="display:none;"></div>
        ${
          showPanelToggle
            ? html`
        <div class="panel-section-wrapper yc-row" style=${panelToggleStyle !== "card" && panelToggleStyle !== "tabs" ? `justify-content:${_alignToJustify(panelToggleAlign)};` : ""}>
          ${this._renderPanelToggle(applyToWholePanel, panelToggleStyle, panelToggleShape)}
          <div class="panel-toggle default" style="margin-top: 4px; display: none; align-items: center; gap: 8px;">
            <label for="fill-panel-cols" style="white-space: nowrap;">Fill Panel Test:</label>
            <select id="fill-panel-cols" style="flex: 1; padding: 4px;" .value=${String(fillPanelCols)} @change=${this._onFillPanelChange}>
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

    return cardShell(this, html`<div class="card-content">${cardContent}</div>`);
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    const stateObj = this._hass?.states?.[this._getPrimaryEntity()];
    if (!stateObj) {
      this._previewsConfig = null;
      return;
    }
    // Preview styles need the backend previews (shared cache): on a new
    // configuration, or a lamp that is back.
    if (this._previewsConfig !== this.config) {
      this._previewsConfig = this.config;
      this._ensurePreviews();
    }
    // The drag path moves the angle visuals and sets the inputs' values
    // itself (and an input the user changed keeps its value over its
    // attribute): show the current angle in them after each render.
    if (this._angleBusy()) return;
    const angle = this._displayAngle(stateObj);
    this._updateRotaryDisplay(angle);
    this._syncAngleValueDisplay(angle);
    const slider = this.shadowRoot?.getElementById("angleslider");
    if (slider) slider.value = Math.round(angle);
  }

  // ── Declarative event handlers (bound in the Lit templates) ─────────────

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
    const allTargets = this._targets;

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

  // Tabs style: each tab sets an explicit value
  _selectPanelTab(targetValue) {
    const cb = this.shadowRoot?.getElementById("apply-to-panel");
    if (cb && cb.checked !== targetValue) {
      cb.checked = targetValue;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  _renderPanelToggle(applyToWholePanel, style, shape = "round") {
    // Use optimistic value if set
    if (this._optimisticPanelMode !== undefined) {
      applyToWholePanel = this._optimisticPanelMode;
    }

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
          <div class="panel-toggle-tabs">
            <input type="checkbox" id="apply-to-panel" style="display:none;" .checked=${applyToWholePanel} @change=${this._onPanelCheckboxChange}>
            ${tabBar({
              tabs: PANEL_TABS,
              active: applyToWholePanel ? "panel" : "pixels",
              shape,
              label: "Apply to",
              onSelect: (key) => this._selectPanelTab(key === "panel"),
            })}
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
    this.requestUpdate();

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
          if (this.isConnected) this._renderCard();
        }
      }, 5000);
      this._renderCard();
    } catch (error) {
      console.error("Error changing mode:", error);
      this._optimisticMode = null;
      if (this._optimisticModeTimeout) {
        clearTimeout(this._optimisticModeTimeout);
        this._optimisticModeTimeout = null;
      }
      this._renderCard();
    } finally {
      this._processingModeChange = false;
      this.requestUpdate();
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

  getCardSize() {
    return galleryCardSize(resolveModeSelectorStyle(this.config));
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
