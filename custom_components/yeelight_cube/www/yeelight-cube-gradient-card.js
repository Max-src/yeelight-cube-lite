import { LitElement, html, nothing, unsafeCSS } from "./lib/lit-all.js";

import { resolvePreviewAppearance } from "./preview-appearance.js";
import { VISIBILITY_KEYS, visibleItems } from "./visible-items.js";

import { SUPERSEDED } from "./card-command-controller.js";

import { AngleCommandController } from "./angle-wheel-utils.js";

import {
  TEXT_SELECTOR_STYLES,
  PREVIEW_SELECTOR_STYLES,
} from "./selector-shared-styles.js";

import { defineOnce, registerCustomCard } from "./card-registration.js";
import { createSliderDraft } from "./slider-control-utils.js";
import { createPendingValue } from "./pending-value.js";
import { tabBar } from "./tab-bar.js";
import { galleryCardSize, valueKey, YeelightCardMixin, cubeLampEntities } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampNotFoundNotice,
  lampUnavailableLine,
  NOTICE,
} from "./card-shell.js";
import { previewOnly } from "./offline-preview-state.js";
import { normalizeCardOptions, itemLabel } from "./card-config.js";
import { AngleControlMixin } from "./gradient-angle-control.js";
import { ModeSelectorMixin } from "./gradient-mode-selector.js";
import { GRADIENT_CARD_CSS } from "./gradient-card-styles.js";

// Host methods the angle capsule markup may call (see bindHostEvents).
const CAPSULE_HANDLERS = new Set([
  "_startCapsuleDrag",
  "_endCapsuleDrag",
  "_handleCapsuleAngleInput",
  "_handleCapsuleWheel",
]);

// The modes shown and their order: the shared visible-items rule
// (visible-items.js), set in the editor's ordered list.
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
  // The colors one module after another over the whole panel (text kept
  // for the other modes).
  "Panel Color Sequence",
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

// The render gate's holds while the angle is set: the pointer held on its
// slider or capsule, the slider or capsule in use, the rotary dragged, a
// value typed (gradient-angle-control.js).
const ANGLE_HOLDS = ["angle-pointer", "angle-slider", "angle-drag", "angle-typing"];

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
  // the card shows changed (see set hass) through the card's render gate:
  // held while an angle is dragged, slid or typed (ANGLE_HOLDS), the render
  // is made when that ends.
  static styles = unsafeCSS(GRADIENT_CARD_CSS);

  constructor() {
    super();
    // Every service call of this card (except the debounced angle, see
    // _angleCommands) goes through the card's queue (this._commands).
    // The angle the user is setting, kept until the lamp reports it back so
    // re-renders during/after a drag never snap the controls to the old angle.
    this._angleDraft = createSliderDraft({
      tolerance: 1,
      isDragging: () => this._angleBusy(),
      onExpire: () => this._renderCard(),
    });
    // Document-level drag handlers (attached only for an active rotary drag,
    // tracked in _rotaryDocListeners so they can never leak or stack).
    this._onDocMouseMove = (e) => {
      if (this._gate.held("angle-drag")) {
        e.preventDefault(); // Prevent text selection during drag
        this._handleRotaryDrag(e);
      }
    };
    this._onDocTouchMove = (e) => {
      if (this._gate.held("angle-drag")) {
        e.preventDefault(); // Prevent text selection
        this._handleRotaryDrag(e.touches[0]);
      }
    };
    this._onDocDragEnd = (e) => {
      // Always detach the document listeners, even if the drag was ended
      // elsewhere (e.g. setConfig mid-drag) — otherwise they leak.
      this._removeRotaryDocListeners();
      if (this._gate.held("angle-drag")) {
        e.preventDefault(); // Prevent text selection

        // Cancel pending debounce and apply the final angle immediately
        if (this._pendingAngle !== null && this._pendingAngle !== undefined) {
          this._applyAngle(this._pendingAngle);
          this._lastAngleSent = this._pendingAngle;
        }

        this._pendingAngle = null;
        this._gate.release("angle-drag");
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
    // A picked mode and the full-panel switch show until the lamp confirms
    // them (or for 5 s), so an older update never takes them back; a new
    // value from the lamp (another dashboard) wins.
    const rerender = () => this.isConnected && this._renderCard();
    this._pendingMode = createPendingValue({ onExpire: rerender, yieldToLamp: true });
    this._pendingPanel = createPendingValue({ onExpire: rerender, yieldToLamp: true });
    this._previewEventListenerRegistered = false; // Track event listener for global preview cache
  }

  /** Gradient mode names in display order (the visible-modes config). */
  _orderedModes() {
    return visibleItems(
      GRADIENT_MODES,
      (mode) => mode,
      this.config,
      VISIBILITY_KEYS.gradientModes,
    );
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
    this._pendingMode.clear();
    this._pendingPanel.clear();
    if (this._anglePreviewReloadTimer) {
      clearTimeout(this._anglePreviewReloadTimer);
      this._anglePreviewReloadTimer = null;
    }
    if (this._previewRetryTimer) {
      clearTimeout(this._previewRetryTimer);
      this._previewRetryTimer = null;
    }
    // Detach any document-level rotary drag listeners left from an
    // in-progress drag, and end every hold.
    this._removeRotaryDocListeners();
    this._gate.clear();
  }

  setConfig(config) {
    config = resolvePreviewAppearance(normalizeCardOptions(config, "gradient"), "gradient");
    this._angleCommands.reset();
    this._commands?.reset();
    this._pendingAngle = null;
    this._removeRotaryDocListeners();
    this._gate.release("angle-drag");
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

    // Nothing the card shows changed (_hassInputs) and no pending value
    // waits for the lamp's echo: nothing to do.
    if (
      !this._hassChanged(hass) &&
      this._pendingMode.value == null &&
      this._pendingPanel.value == null
    )
      return;
    if (!this.config) return;
    const entity = hass?.states?.[this._primaryEntity()];
    if (!entity) {
      // No lamp (or it was removed): render() shows the notice.
      this._renderCard();
      return;
    }
    const attrs = entity.attributes;

    // Pending values: dropped once the lamp reports them.
    this._pendingPanel.settle(attrs.full_panel || false);
    this._pendingMode.settle(attrs.mode);

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

    // A picked mode shows until the lamp confirms it (_pendingMode), so
    // an older update never takes it back.
    this._renderCard();
  }

  // What the card shows from the lamp, compared value by value with the last
  // update: its state and the attributes the controls, gallery and matrix
  // preview read (color lists by content).
  _hassInputs(hass) {
    const entity = hass?.states?.[this._primaryEntity()];
    const attrs = entity?.attributes || {};
    return [
      this.config,
      entity?.state,
      previewOnly({ config: this.config, _hass: hass }),
      attrs.angle,
      attrs.mode,
      attrs.full_panel,
      attrs.custom_text,
      valueKey(attrs.text_colors),
      valueKey(attrs.matrix_colors),
    ];
  }

  /** An angle is being dragged, slid or typed: the drag path moves the
   * visuals. */
  _angleBusy() {
    return ANGLE_HOLDS.some((name) => this._gate.held(name));
  }

  /** Show the current state: a Lit update, or, while the gate is held, one
   * when the interaction ends. */
  _renderCard() {
    this._gate.request();
  }

  render() {
    const hass = this._hass;
    if (!hass || !this.config) return nothing;
    const primaryEntity = this._primaryEntity();
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
    // The switched value until the lamp confirms it, else the lamp's.
    const applyToWholePanel =
      this._pendingPanel.value ?? (stateObj.attributes.full_panel || false);

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
        ${previewOnly(this) ? lampUnavailableLine() : nothing}
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
            ><yc-angle-view
              .draw=${(angle = currentAngle) => this._angleRotaryTemplate(angle, true)}
            ></yc-angle-view></div>
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
            ${
              !rotaryInHeader
                ? html`<yc-angle-view
                    .draw=${(angle = currentAngle) => this._angleRotaryTemplate(angle)}
                  ></yc-angle-view>`
                : nothing
            }
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
    const stateObj = this._hass?.states?.[this._primaryEntity()];
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
    // An input the user changed keeps its value over its attribute: show
    // the current angle in them after each render (the drag path sets them
    // itself).
    if (this._angleBusy()) return;
    const angle = this._displayAngle(stateObj);
    this._syncAngleValueDisplay(angle);
    const slider = this.shadowRoot?.getElementById("angleslider");
    if (slider) slider.value = Math.round(angle);
  }

  // ── Declarative event handlers (bound in the Lit templates) ─────────────

  /** "Apply to Whole Panel" checkbox change (every toggle style). */
  _onPanelCheckboxChange(e) {
    const panelCheckbox = e.currentTarget;
    if (!this._hass || !this._primaryEntity()) return;
    const applyToPanel = panelCheckbox.checked;

    // Shown at once, until the lamp confirms it (or for 5 s).
    this._pendingPanel.set(applyToPanel);
    this._renderCard();

    // Disable checkbox while updating
    panelCheckbox.disabled = true;

    this.callServiceOnTargetEntities("set_full_panel", {
      full_panel: applyToPanel,
    })
      .then(() => {
        // Re-enable the checkbox; the value stays until the lamp confirms it
        panelCheckbox.disabled = false;
        // Matrix preview updates instantly via matrix_colors entity state
        // (same as lamp preview card).  Gallery thumbnails still need
        // preview cache, so trigger a reload for those.
        this._loadPreviews().catch(() => {});
      })
      .catch((err) => {
        // On error, show the lamp's value again
        this._pendingPanel.clear();
        panelCheckbox.disabled = false;
        this._renderCard();
      });
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
   * Return the current gradient mode, preferring the pending (picked) mode.
   * Falls back to the entity's reported mode, or null.
   */
  _getCurrentMode() {
    if (this._pendingMode.value) return this._pendingMode.value;
    const primaryEntity = this._primaryEntity();
    const entityState = primaryEntity && this._hass?.states[primaryEntity];
    return entityState?.attributes?.mode || null;
  }

  /**
   * A mode picked in the gallery: shown at once and sent. The gallery stays
   * live while it is sent (like the Palette card's): quick successive picks
   * only send the latest one, and an older pick finishing never takes the
   * newer one back.
   */
  async _selectMode(mode) {
    // Shown at once; its timeout starts once it is sent.
    this._pendingMode.hold(mode);
    this.requestUpdate();

    // Read the panel setting from the checkbox when rendered; when the panel
    // toggle is hidden (show_panel_toggle=false) fall back to the entity's
    // actual full_panel state so selecting a mode never silently disables
    // panel mode.
    const panelCheckbox = this.shadowRoot?.getElementById("apply-to-panel");
    const applyToPanel = panelCheckbox
      ? panelCheckbox.checked
      : (this._pendingPanel.value ??
        (this._hass?.states[this._primaryEntity()]?.attributes?.full_panel ||
          false));

    try {
      const result = await this.callServiceOnTargetEntities(
        "set_mode",
        { mode, full_panel: applyToPanel },
        // Quick successive picks only send the latest one.
        { coalesce: "select" },
      );
      // Never sent: the newer pick owns the highlight and the wheel.
      if (result === SUPERSEDED) return;
      // Keep the pick until the backend echoes the new mode back through
      // entity state (settled in `set hass`). The service resolves before
      // the hardware command completes (fire-and-forget backend), so
      // clearing after a blind delay made the highlight snap back to the OLD
      // mode until the echo arrived — a visible blink on every selection.
      // Safety timeout: dropped if no echo arrives (e.g. lamp offline) so
      // the UI resyncs with reality.
      // A newer pick (still being sent) keeps its own.
      if (this._pendingMode.value === mode) this._pendingMode.set(mode);
      this._renderCard();
    } catch (error) {
      console.error("Error changing mode:", error);
      if (this._pendingMode.value === mode) this._pendingMode.clear();
      this._renderCard();
    }
  }

  // Angle-related methods (from angle gradient card)
  // Angle control events are bound declaratively on the Lit-rendered
  // .angle-row / .header-rotary containers (see _onAngleArea* handlers and
  // _startRotaryDocDrag for the document-level drag listeners).

  // Always get the current textColors from the entity state
  _getCurrentTextColors() {
    const entityId = this._primaryEntity();
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
