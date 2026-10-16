import { resolvePreviewAppearance } from "./preview-appearance.js";

import { escapeHtml } from "./html-escape-utils.js";
import "./mode-controls-ui.js";
import {
  ModeControlsController,
  lampActionConfig,
} from "./mode-controls-controller.js";
import { CardCommandController } from "./card-command-controller.js";
import { orientationOptions, nextOrientation, orientationControlModel } from "./orientation-control-utils.js";
import { renderOrientationControls } from "./orientation-control-ui.js";

import {
  resolveCapsuleTheme,
  resolveCapsuleThickness,
} from "./capsule-slider-utils.js";
import {
  renderSliderGroup,
  stableSliderMarkup,
  lightSliderConfig,
  sliderKeys,
  brightnessPctToRaw,
  brightnessRawToPct,
  isSliderHandler,
} from "./slider-control-utils.js";
import { YeelightCardMixin, cubeLampEntities, valueKey } from "./card-base.js";
import {
  cardNotice,
  cardShell,
  lampNotFoundNotice,
  lampUnavailableLine,
  NOTICE,
} from "./card-shell.js";
import { previewOnly } from "./offline-preview-state.js";
import { normalizeCardOptions } from "./card-config.js";
import { LampSliders } from "./lamp-sliders.js";
import { defineOnce, registerCustomCard } from "./card-registration.js";
import {
  LitElement,
  html,
  unsafeHTML,
  unsafeCSS,
  nothing,
} from "./lib/lit-all.js";
import { LAMP_PREVIEW_CSS } from "./lamp-preview-styles.js";
import { AdjustmentControlsMixin } from "./lamp-preview-adjustments.js";
import { MatrixPreviewMixin } from "./lamp-preview-matrix.js";


// ================================================

// Rendering model (LitElement):
// - render() is a pure Lit template over the card's state; every control binds
//   its events declaratively (no inline handler strings). The brightness
//   slider is the shared markup, held while it is dragged or typed in
//   (stableSliderMarkup, like the Clock and Native Effects cards).
// - _refresh() requests the update, except while a slider is dragged (the
//   card's render gate: the update is made at the release) or a value typed,
//   or while HA sends alternating brightness values (made when that ends).
// - The 20x5 .lamp-dot nodes carry no reactive bindings: their colors are only
//   ever painted directly (change-only) by _paintDots, after each update
//   (updated) and from the native-effect / clock animation loops.
class YeelightCubeLampPreviewCard extends MatrixPreviewMixin(
  AdjustmentControlsMixin(YeelightCardMixin(LitElement)),
) {
  // Dashboard size (card-base): the matrix scales down to a quarter width.
  static cardSize = 2;
  static minColumns = 3;
  // Static: the config-dependent values are CSS variables (_matrixGeometry).
  static styles = unsafeCSS(LAMP_PREVIEW_CSS);
  static editor = [
    "yeelight-cube-lamp-preview-card-editor",
    "./yeelight-cube-lamp-preview-card-editor.js",
  ];
  // Slider markup names its handlers in data-on-* attributes.
  static hostEvents = isSliderHandler;

  static getStubConfig(hass) {
    const firstEntity = cubeLampEntities(hass)[0] || "";
    return {
      type: "custom:yeelight-cube-lamp-preview-card",
      entity: firstEntity,
      show_card_background: true,
      size_pct: 100,
      align: "center",
      matrix_spacing_mode: "normal",
      matrix_background: "black",
      matrix_box_shadow: true,
      matrix_pixel_style: "circle",
      show_force_refresh_button: false,
      buttons_style: "gradient",
      show_brightness: true,
      slider_style: "capsule",
      slider_thickness: 6,
      slider_theme: "subtle",
      slider_value_display: "none",
      show_power_toggle: false,
      slider_show_icon_left: true,
      show_adjustment_controls: true,
      adjustments_layout: "categories",
      reset_button_mode: "changed",
    };
  }

  constructor() {
    super();
    this.config = {};
    this._hass = null;
    // Lamp calls (brightness, adjustments, resets, orientation) share the
    // card's queue (this._commands). The action row has its own, so a slider
    // commit never shows the actions as busy.
    this._actionCommands = new CardCommandController(() => {
      if (!this._actions) return;
      this._actions.error = this._actionCommands.error;
      this._actions.notify();
    });
    const command = (service, data = {}, domain = "yeelight_cube") =>
      this._actionCommands.execute(
        this._hass,
        this.config,
        service,
        data,
        domain,
      );
    this._actions = new ModeControlsController({
      kind: "lamp",
      actionKeys: ["refresh", "power"],
      items: () => [],
      current: () => null,
      on: () => this._hass?.states?.[this._primaryEntity()]?.state === "on",
      disabled: () =>
        this._actionCommands.busy ||
        !["on", "off"].includes(
          this._hass?.states?.[this._primaryEntity()]?.state,
        ),
      command,
      refresh: () => command("force_refresh"),
    });
    this._effectDebounceTimer = null;
    this._nativeAnimKey = null;
    this._nativeAnimStartedAt = null;
    // Animation loops + visibility (shared matrix-animator): pause when the tab
    // is hidden or the card is scrolled off screen, and reuse the dot NodeList.
    this._nativeLoop = null;
    this._clockLoop = null;
    this._visTracker = null;
    this._onScreen = true;
    this._lampDots = null;

    // What the last lamp update showed (see set hass).
    this._seen = {};

    // The matrix dots are recreated when the generation changes (a new
    // configuration: their look changes, see _matrixTemplate).
    this._dotGeneration = 0;

    // The brightness slider, through the shared lamp-slider controller like
    // the Clock and Native Effects sliders (lamp-sliders.js); its updates go
    // through _refresh() and its guards.
    this._lampSliders = new LampSliders(
      this,
      {
        brightness: {
          config: () => this._brightnessGc(),
          // Every movement repaints the preview at once: the card's render
          // waits for the drag to end, the dots do not (the animation loops
          // read the dragged value themselves).
          live: () => this._paintStaticPreview(),
          commit: (pct) => this._sendBrightness(pct),
        },
      },
      { refresh: () => this._refresh() },
    );
  }

  // Send a brightness (slider %) to the lamp on the shared 3-255 curve.
  _sendBrightness(pct) {
    if (!this._hass || !this.config || !this._primaryEntity()) return;
    this._commands
      .call(
        this._hass,
        "light",
        "turn_on",
        { entity_id: this._primaryEntity(), brightness: brightnessPctToRaw(pct) },
        // A drag commits every few hundred ms and each call waits for the
        // lamp: while one is sent, only the latest value waits.
        { coalesce: "brightness" },
      )
      .catch((error) => {
        // Show the lamp's real value again.
        this._lampSliders.setDraft("brightness", null);
        this._refresh();
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("NoneType") || errorMsg.includes("close")) {
          console.warn("Lamp connection temporarily unavailable");
        } else if (errorMsg.includes("quota exceeded")) {
          console.warn("Device rate limit - brightness update queued");
        } else {
          console.error("Error setting brightness:", error);
        }
      });
  }

  // Build the generic slider render config from the brightness config, applying
  // the same legacy theme/thickness migrations the card used before.
  _brightnessGc() {
    // The shared lamp-slider config (units, raw range, icons: same as the
    // Clock and Native Effects cards), with this card's own additions.
    // The slider_* options are the shared ones (older brightness_* names are
    // aliases, see card-config.js).
    return lightSliderConfig(this.config, "brightness", sliderKeys("slider"), {
      // Older theme names and the old "thick"/"thin" appearance still work.
      theme: resolveCapsuleTheme(
        this.config.slider_theme,
        this.config.capsule_theme,
      ),
      thickness: resolveCapsuleThickness(
        this.config.slider_thickness,
        this.config.brightness_slider_appearance,
        6,
      ),
      // Only this card lets the user pick the slider color.
      color: this.config.slider_color || "#ff9800",
      rawValue:
        this._hass?.states?.[this._primaryEntity()]?.attributes?.brightness,
    });
  }

  setConfig(config) {
    this._commands?.reset();
    this._effectContext = (this._effectContext || 0) + 1;
    clearTimeout(this._effectDebounceTimer);
    this._effectDebounceTimer = null;
    this._pendingEffects.clear();
    this._orientationContext = (this._orientationContext || 0) + 1;
    this._orientationPending = null;
    this._orientationError = null;
    clearTimeout(this._orientationTimer);
    // Unset options keep their defaults where they are read (the shared
    // slider config, the matrix geometry, the appearance resolver).
    this.config = resolvePreviewAppearance(
      lampActionConfig(normalizeCardOptions(config, "lamp-preview")),
      "lamp",
    );
    this._actionCommands.reset();
    this._actions.configure(
      this.config,
      [this._primaryEntity()].filter(Boolean),
    );
    // Fresh dots for the new look.
    this._dotGeneration++;
    this._refresh();
  }

  set hass(hass) {
    const prevHass = this._hass;
    this._hass = hass;
    // Nothing the card shows changed (card-base _hassChanged) and no update
    // waits (a slider drag): nothing to do.
    const changed = this._hassChanged(hass);
    if (prevHass && !this._renderIncomplete && !changed) return;
    if (
      this._orientationSettled &&
      this._orientationPending ===
        hass.states[this._primaryEntity(hass)]?.attributes?.device_orientation
    ) {
      this._orientationPending = null;
      clearTimeout(this._orientationTimer);
    }
    this._refreshOrientationControls();

    const entity = hass.states[this._primaryEntity(hass)];
    const attrs = entity?.attributes;
    const seen = this._seen;
    this._seen = {
      state: entity?.state,
      // The last known brightness (a lamp that is off reports none).
      brightness: attrs?.brightness ?? seen.brightness,
      matrix: valueKey(attrs?.matrix_colors),
      // Matrix, Clock and Native Effect are drawn by different loops: a
      // switch must update the preview even when nothing else changed.
      contentMode: attrs?.content_mode ?? seen.contentMode,
    };
    // Adjustments the lamp now reports (or replaced: another dashboard) are
    // no longer shown locally. While others wait for the lamp's echo, only
    // the lamp's own changes (power, matrix, content mode) and a settled
    // adjustment update the card.
    const waiting = this._pendingEffects.size;
    this._settleEffects(entity);
    if (
      !this._pendingEffects.size ||
      this._pendingEffects.size !== waiting ||
      this._seen.state !== seen.state ||
      this._seen.brightness !== seen.brightness ||
      this._seen.matrix !== seen.matrix ||
      this._seen.contentMode !== seen.contentMode
    )
      this._refresh();
  }

  // The brightness slider's handlers come from the shared lamp-slider
  // controller (constructor). _startDrag / _endDrag serve the effect sliders.

  // An effect slider held: the lamp's updates wait until 50 ms after its
  // release (its last value is sent first), then show at once.
  _startDrag() {
    this._gate.hold("effect-slider");
  }

  _endDrag() {
    this._gate.hold("effect-slider", 50);
  }

  // A render the gate held (a slider released): the lamp's current state.
  _renderHeld() {
    this._refresh();
  }

  // Show the lamp's current state (a Lit update, the dots painted in
  // updated()). Waits while a slider is dragged or a value typed:
  // _renderIncomplete stays set so the next hass update (or the end of the
  // drag) makes the update. A brightness the lamp hasn't confirmed yet stays
  // on the slider (the shared slider draft, lamp-sliders.js).
  _refresh() {
    this._renderIncomplete = true;
    if (this._slBrightnessTyping) return;
    if (this._gate.held()) {
      this._gate.request();
      return;
    }
    const stateObj = this._hass?.states?.[this._primaryEntity()];
    if (stateObj) {
      this._settleEffects(stateObj);
      // Drop the dragged brightness once the lamp reports it.
      this._lampSliders.settle(stateObj.attributes);
    }
    this._renderIncomplete = false;
    this.requestUpdate();
  }

  // Hand the shared Actions view its model and let it re-evaluate.
  _syncActions() {
    const actions = this.shadowRoot?.querySelector(
      'yeelight-mode-controls[area="actions"]',
    );
    if (actions) {
      actions.model = this._actions;
      this._actions.notify();
    }
  }

  // Start/stop the client-side animations to match the current mode. When the
  // dots are new (a new configuration), a loop that was already running paints
  // them right away instead of waiting for its next tick.
  _syncAnimations(isNativeAnimating, isClockAnimating, repaint) {
    if (isNativeAnimating) {
      const running = this._nativeLoop?.running;
      this._startNativeAnimation();
      if (running && repaint) this._nativeAnimFrame();
    } else this._stopNativeAnimation();
    if (isClockAnimating) {
      const running = this._clockLoop?.running;
      this._startClockAnimation();
      if (running && repaint) this._clockAnimFrame();
    } else this._stopClockAnimation();
  }

  // After each update: paint the dots (change-only) unless an animation owns
  // them, wire the Actions view and start/stop the animation loops.
  updated(changedProperties) {
    super.updated?.(changedProperties);
    const stateObj = this._hass?.states?.[this._primaryEntity()];
    if (!stateObj) return;
    const freshDots = this._paintedGeneration !== this._dotGeneration;
    this._paintedGeneration = this._dotGeneration;
    // Firmware Native Effect and Clock modes run animations the plugin can't
    // read back (their matrix_colors are stale): client-side loops draw them.
    const preview = this.config.show_lamp_preview !== false;
    const on = stateObj.state === "on";
    const mode = stateObj.attributes.content_mode;
    const isNativeAnimating = preview && on && mode === "Native Effect";
    const isClockAnimating = preview && on && mode === "Clock";
    this._lastPreviewOrientation =
      stateObj.attributes.device_orientation || "right";
    if (preview && !isNativeAnimating && !isClockAnimating)
      this._paintStaticPreview(stateObj);
    this._syncActions();
    this._syncAnimations(isNativeAnimating, isClockAnimating, freshDots);
  }

  // Paint the lamp's matrix_colors on the dots (change-only), at the dragged
  // brightness while a slider is held. Clock and Native Effect previews are
  // painted by their animation loops instead.
  _paintStaticPreview(stateObj = this._hass?.states?.[this._primaryEntity()]) {
    if (!stateObj || this.config?.show_lamp_preview === false) return;
    const mode = stateObj.attributes.content_mode;
    if (stateObj.state === "on" && (mode === "Native Effect" || mode === "Clock"))
      return;
    // Blank matrix: no data yet, or the firmware draws the matrix (Music
    // Flow), whose frames the backend can't read back.
    const matrixColors = stateObj.attributes.matrix_colors?.length
      ? stateObj.attributes.matrix_colors
      : Array(100).fill(null);
    const gridColors = this._matrixColorsToGridColors(matrixColors, stateObj);
    const dots = this._getLampDots();
    if (dots.length === gridColors.length)
      this._paintDots(
        gridColors,
        this._lastPreviewOrientation ||
          stateObj.attributes.device_orientation ||
          "right",
        dots,
      );
  }

  // HTML-string rendering of the same preview with its colors inline, for
  // callers that embed a static snapshot (e.g. the appearance regression tests).
  _generateMatrixHtml(gridColors, stateObj) {
    const { layout, alignClass, outerStyle, gridStyle } =
      this._matrixGeometry(stateObj);
    const pixels = Array.from({ length: layout.rows * layout.cols })
      .map((_, idx) => {
        const row = Math.floor(idx / layout.cols);
        const col = idx % layout.cols;
        const color = gridColors[layout.indexFn(row, col)] || "#000000";
        const { isEmpty, displayColor } = this._dotAppearance(color);
        return `<div class="lamp-dot${
          isEmpty ? " lamp-dot-empty" : ""
        }" style="background: ${escapeHtml(displayColor)};"></div>`;
      })
      .join("");
    return `<div class="${alignClass}" style="${escapeHtml(outerStyle)}"><div class="lamp-preview-css" style="${escapeHtml(gridStyle)}">${pixels}</div></div>`;
  }

  // The shared 4-way device orientation control (right / down / left / up):
  // its current orientation and whether the lamp can take a command.
  _orientationState(stateObj) {
    return [
      this._orientationPending ||
        stateObj?.attributes?.device_orientation ||
        "right",
      !stateObj || ["unavailable", "unknown"].includes(stateObj.state),
    ];
  }

  // What the row shows, as a comparable key (re-render only on change).
  _orientationKey(stateObj) {
    const [current, unavailable] = this._orientationState(stateObj);
    return `${JSON.stringify(
      orientationControlModel(this.config, current, unavailable),
    )}\u0000${this._orientationError || ""}`;
  }

  _orientationTemplate(stateObj) {
    const [current, unavailable] = this._orientationState(stateObj);
    this._renderedOrientationKey = this._orientationKey(stateObj);
    const error = this._orientationError
      ? html`<div class="orientation-error" role="alert">${this._orientationError}</div>`
      : nothing;
    return html`<div class="orientation-controls">
      ${renderOrientationControls(this.config, current, unavailable, (event) =>
        this.handleOrientationControl(event),
      )}${error}
    </div>`;
  }

  // Re-render the orientation control when its markup or error changed, and
  // keep keyboard focus on the same button across the markup swap.
  _refreshOrientationControls() {
    const container = this.shadowRoot?.querySelector(".orientation-controls");
    if (!container) return;
    if (
      this._orientationKey(this._hass?.states[this._primaryEntity()]) ===
      this._renderedOrientationKey
    )
      return;
    const focused = container.contains(this.shadowRoot.activeElement)
      ? this.shadowRoot.activeElement?.dataset.value
      : null;
    this.requestUpdate();
    if (focused) {
      this.updateComplete.then(() =>
        Array.from(
          this.shadowRoot.querySelectorAll(".orientation-controls button"),
        )
          .find((button) => button.dataset.value === focused)
          ?.focus({ preventScroll: true }),
      );
    }
  }

  handleOrientationControl(event) {
    const button = event.target.closest("button[data-value]");
    if (!button || button.disabled) return;
    const value = button.dataset.value;
    const options = orientationOptions(this.config);
    const current =
      this._orientationPending ||
      this._hass?.states[this._primaryEntity()]?.attributes?.device_orientation ||
      "right";
    const step = { clockwise: 1, counterclockwise: -1, "half-turn": 2 }[value];
    const target = step
      ? nextOrientation(current, step, options.directions)
      : value;
    if (target && target !== current) this.handleOrientationSelect(target);
  }

  async handleOrientationSelect(orientation) {
    const hass = this._hass;
    const entity = this._primaryEntity();
    const state = hass?.states[entity];
    if (
      !state ||
      ["unavailable", "unknown"].includes(state.state) ||
      !orientationOptions(this.config).directions.includes(orientation)
    )
      return;
    const context = this._orientationContext;
    const sequence = (this._orientationSequence =
      (this._orientationSequence || 0) + 1);
    clearTimeout(this._orientationTimer);
    this._orientationPending = orientation;
    this._orientationSettled = false;
    this._orientationError = null;
    this._refreshOrientationControls();
    try {
      // Queued behind earlier clicks; dropped (resolves false) if the card is
      // reconfigured before it is sent.
      await this._commands.call(hass, "yeelight_cube", "set_device_orientation", {
        entity_id: entity,
        orientation,
      });
      if (
        context !== this._orientationContext ||
        sequence !== this._orientationSequence
      )
        return;
      this._orientationSettled = true;
      if (
        this._hass?.states[entity]?.attributes?.device_orientation ===
        orientation
      ) {
        this._orientationPending = null;
      } else {
        this._orientationTimer = setTimeout(() => {
          this._orientationPending = null;
          this._orientationError = "Orientation was not confirmed. Try again.";
          this._refreshOrientationControls();
        }, 8000);
      }
    } catch (error) {
      if (
        context !== this._orientationContext ||
        sequence !== this._orientationSequence
      )
        return;
      this._orientationPending = null;
      this._orientationError = "Could not change orientation. Try again.";
      console.error("[device-orientation] service call failed:", error);
    }
    this._refreshOrientationControls();
  }

  // Actions, device orientation and the brightness slider. The slider is the
  // shared multi-style control (./slider-control-utils.js, same as the Clock
  // and Native Effects cards), held while it is dragged or typed in.
  _lampControlsTemplate(stateObj) {
    const slider =
      this.config.show_brightness !== false
        ? stableSliderMarkup(
            this,
            "brightness",
            renderSliderGroup([
              {
                gc: this._brightnessGc(),
                // The dragged value until the lamp reports it, else the lamp's.
                value:
                  this._lampSliders.value("brightness") ??
                  brightnessRawToPct(stateObj.attributes.brightness ?? 255),
                ns: "brightness",
              },
            ]),
          )
        : "";
    return html`<yeelight-mode-controls
        area="actions"
        .model=${this._actions}
      ></yeelight-mode-controls
      >${this.config.show_device_orientation !== false
        ? this._orientationTemplate(stateObj)
        : nothing}${slider ? unsafeHTML(slider) : nothing}`;
  }

  render() {
    const entityId = this._primaryEntity();
    const hass = this._hass;
    if (!entityId) return cardNotice(this, NOTICE.noLamp);
    // No hass yet (or a moment without it): keep what was rendered last.
    if (!hass) return this._lastTemplate ?? nothing;
    const stateObj = hass.states[entityId];
    if (!stateObj) return lampNotFoundNotice(this, entityId);

    const content = html`${previewOnly(this) ? lampUnavailableLine() : nothing}${this.config.show_lamp_preview !== false
      ? this._matrixTemplate(stateObj)
      : nothing}${this.config.show_lamp_control !== false
      ? this._lampControlsTemplate(stateObj)
      : nothing}${this.config.show_adjustment_controls === true
      ? this._adjustmentControlsTemplate(this._currentEffects(stateObj))
      : nothing}`;

    this._lastTemplate = html`${cardShell(
        this,
        html`<div style="display: flex; width: 100%;">
          <div class="yeelight-cube-lamp-preview-container yc-stack">
            ${content}
          </div>
        </div>`,
      )}`;
    return this._lastTemplate;
  }

  // The card stylesheet wrapped in a <style> element, as an HTML string (for
  // callers that embed a static snapshot next to _generateMatrixHtml).
  _getStyles() {
    return `<style>${LAMP_PREVIEW_CSS}</style>`;
  }

  connectedCallback() {
    super.connectedCallback();
    // Reattached after a disconnect (dashboard edit mode, view switch): the
    // animation loops were stopped: an update restarts them (updated()).
    if (this._wasDisconnected) {
      this._wasDisconnected = false;
      this._refresh();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._wasDisconnected = true;
    this._actionCommands.reset();
    this._commands.reset();
    this._actions.configure(
      this.config,
      [this._primaryEntity()].filter(Boolean),
    );
    this._effectContext = (this._effectContext || 0) + 1;
    this._pendingEffects.clear();
    this._orientationContext = (this._orientationContext || 0) + 1;
    this._orientationPending = null;
    clearTimeout(this._orientationTimer);
    // Clear all stored debounce/timeout timers
    clearTimeout(this._effectDebounceTimer);

    // Stop the client-side animation loops if running.
    this._stopNativeAnimation();
    this._stopClockAnimation();
    // Disconnect the off-screen visibility observer.
    if (this._visTracker) {
      this._visTracker.disconnect();
      this._visTracker = null;
    }
    this._lampDots = null;

    this._effectDebounceTimer = null;

    // Detach a slider drag still in progress (and its timers).
    this._lampSliders.destroy();

    // Reset drag/interaction state
    this._gate.clear();
    this._sliderTyping = false;
    this._slBrightnessTyping = false;
  }
}

defineOnce("yeelight-cube-lamp-preview-card", YeelightCubeLampPreviewCard);

// Register for Lovelace "Add Card" UI
registerCustomCard({
    type: "yeelight-cube-lamp-preview-card",
    name: "Yeelight Preview Card",
    description: "Preview the Yeelight Cube Lite lamp matrix and settings.",
    preview: true,
  });
