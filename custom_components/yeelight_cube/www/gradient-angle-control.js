// Angle control of the gradient card: the rotary / compass / square / matrix
// preview / capsule templates (rendered by <yc-angle-view>), drag and keyboard
// handling. Mixed into YeelightCubeGradientCard.
import { ANGLE_NO_DRAG_SELECTOR } from "./gradient-card-utils.js";
import {
  createColorWheelSegments as _sharedCreateColorWheelSegments,
  createWheelGradientStops as _sharedCreateWheelGradientStops,
} from "./angle-wheel-utils.js";
import { LitElement, html, nothing, svg } from "./lib/lit-all.js";
import { defineOnce } from "./card-registration.js";
import { AngleStylesMixin } from "./gradient-angle-styles.js";
import { updateCapsuleVisuals } from "./capsule-slider-utils.js";
import { rgbToHex as _sharedRgbToHex } from "./color-utils.js";
import {
  MATRIX_SIZE,
  deviceOrientation,
  flipMatrixVertical,
  viewerFrame,
} from "./matrix-view.js";

// ── Where the pointer is, as an angle ──────────────────────────────────────

/** The angle of a point around the centre of `rect` (the circular styles:
 * 0° at the right, counter-clockwise). */
function circleAngleAt(point, rect) {
  const angle =
    (Math.atan2(
      rect.top + rect.height / 2 - point.clientY,
      point.clientX - (rect.left + rect.width / 2),
    ) *
      180) /
    Math.PI;
  return angle < 0 ? angle + 360 : angle;
}

// How far into the box (percent) a press still counts as on an edge.
const RECT_EDGES = { right: 90, rightMaxY: 60, top: 20, left: 10, bottom: 80 };
const SQUARE_EDGES = { right: 85, rightMaxY: 65, top: 15, left: 15, bottom: 85 };

/**
 * The angle of a point (x, y in percent of the box) on the perimeter of a
 * w:h rectangle: 0° at the right-edge centre, counter-clockwise, the same
 * walk as _perimeterPoint (the selector's place for an angle). A press near
 * an edge (`edges`) maps along that edge, one inside to the nearest edge.
 */
function perimeterAngleAt(x, y, w, h, edges) {
  const perimeter = 2 * (w + h);
  // The distance walked along each edge.
  const right = () =>
    y <= 50 ? ((50 - y) / 50) * (h / 2) : perimeter - ((y - 50) / 50) * (h / 2);
  const top = () => h / 2 + ((100 - x) / 100) * w;
  const left = () => h / 2 + w + (y / 100) * h;
  const bottom = () => h / 2 + w + h + (x / 100) * w;
  let walked;
  if (x >= edges.right && y <= edges.rightMaxY) walked = right();
  else if (y <= edges.top) walked = top();
  else if (x <= edges.left) walked = left();
  else if (y >= edges.bottom) walked = bottom();
  else {
    const nearest = Math.min(100 - x, x, y, 100 - y);
    walked =
      nearest === 100 - x ? right() : nearest === y ? top() : nearest === x ? left() : bottom();
  }
  const angle = (walked / perimeter) * 360;
  return ((angle % 360) + 360) % 360;
}

/**
 * <yc-angle-view>: the card's angle control. The card renders it with `draw`
 * (angle → the control's template, at the lamp's angle by default); while an
 * angle is dragged, slid or typed the card renders nothing and sets `angle`,
 * so only the control follows. Each card render (a new `draw`) shows the
 * card's angle again. Light DOM: the card's CSS and delegated handlers apply.
 */
class YcAngleView extends LitElement {
  static properties = {
    draw: { attribute: false },
    angle: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "contents";
  }

  willUpdate(changed) {
    if (changed.has("draw")) this.angle = undefined;
  }

  render() {
    return this.draw ? this.draw(this.angle) : nothing;
  }
}

defineOnce("yc-angle-view", YcAngleView);

export const AngleControlMixin = (Base) => class extends AngleStylesMixin(Base) {
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
    // Made once per card, so the same functions are always removed.
    const on = (this.__rotaryDocHandlers ||= {
      mouseMove: (e) => this._onRotaryDocMove(e, e),
      touchMove: (e) => this._onRotaryDocMove(e, e.touches[0]),
      end: (e) => this._endRotaryDrag(e),
    });
    this._rotaryDocListeners = touch
      ? [
          ["touchmove", on.touchMove],
          ["touchend", on.end],
          ["touchcancel", on.end],
        ]
      : [
          ["mousemove", on.mouseMove],
          ["mouseup", on.end],
        ];
    this._rotaryDocListeners.forEach(([type, fn]) =>
      document.addEventListener(type, fn),
    );
  }

  _onRotaryDocMove(e, point) {
    if (!this._gate.held("angle-drag")) return;
    e.preventDefault(); // Prevent text selection during drag
    this._handleRotaryDrag(point);
  }

  _endRotaryDrag(e) {
    // Always detach the document listeners, even if the drag was ended
    // elsewhere (e.g. setConfig mid-drag) — otherwise they leak.
    this._removeRotaryDocListeners();
    if (!this._gate.held("angle-drag")) return;
    e.preventDefault(); // Prevent text selection
    this._flushAngle();
    this._gate.release("angle-drag");
  }

  // A drag or slide ended: the angle waiting for the debounce is sent now.
  _flushAngle() {
    const angle = this._pendingAngle;
    this._pendingAngle = null;
    if (angle == null) return;
    this._applyAngle(angle);
    this._lastAngleSent = angle;
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
    this._gate.hold("angle-drag");
    this._handleRotaryDrag(touch ? e.touches[0] : e);
    this._startRotaryDocDrag(touch);
  }

  _onAngleAreaMouseDown(e) {
    this._angleDragStart(e, false);
  }

  _onAngleAreaTouchStart(e) {
    this._angleDragStart(e, true);
  }

  // Renders wait while the user types an angle (the "angle-typing" hold) so
  // they never fight the typing.
  _onAngleAreaFocusIn(e) {
    if (e.target?.id === "angleinput") this._gate.hold("angle-typing");
  }

  _onAngleAreaFocusOut(e) {
    const angleInput = e.target;
    if (angleInput?.id !== "angleinput") return;
    // Apply the final value on blur (covers Tab-out, click-away)
    let angle = parseFloat(angleInput.value);
    if (!isNaN(angle)) {
      angle = Math.max(0, Math.min(359, angle));
      const angleSlider = this.shadowRoot?.getElementById("angleslider");
      if (angleSlider) angleSlider.value = angle;
      this._updateRotaryDisplay(angle);
      this._debouncedApplyAngle(angle);
    }
    this._gate.release("angle-typing");
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
    if (this._gate.held("angle-pointer")) return;
    if (this._gate.held("angle-slider")) this._gate.hold("angle-slider", 200);
  }

  // Standalone angle slider
  _onAngleSliderInput(e) {
    this._gate.hold("angle-slider");
    let angle = parseFloat(e.currentTarget.value);
    if (isNaN(angle)) angle = 0;
    this._syncAngleValueDisplay(angle);
    this._updateRotaryDisplay(angle);
    this._debouncedApplyAngle(angle);
  }

  // Clear the slider flag when slider interaction ends
  _onAngleSliderRelease() {
    this._gate.hold("angle-slider", 100);
  }

  // Safety timeout to ensure flag gets cleared
  _onAngleSliderLeave() {
    if (this._gate.held("angle-pointer")) return;
    if (this._gate.held("angle-slider")) this._gate.hold("angle-slider", 200);
  }

  // The angle control's drawing (older formats arrive in today's names,
  // normalizeCardOptions): the rectangle style draws a square when asked.
  _getRotaryStyleInfo() {
    const style = this.config.rotary_unified_style;
    if (style === "rectangle")
      return { style: this.config.rectangle_shape === "square" ? "square" : "rect" };
    return {
      style: ["wheel", "matrix_preview", "compass", "capsule"].includes(style)
        ? style
        : "compass",
    };
  }

  // Older angle styles arrive in today's names (normalizeCardOptions).
  _getWheelShowMask() {
    return this.config.wheel_show_mask === true;
  }

  _getCompassShape() {
    return this.config.compass_shape || "none";
  }

  _getCompassLabelsMode() {
    return this.config.compass_labels_mode || "under";
  }

  _getRotarySize() {
    return this.config.rotary_size || 80;
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
    this._gate.hold("angle-pointer");
    if (this._angleRelease) return;
    this._angleRelease = () => {
      for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
        document.removeEventListener(type, this._angleRelease, true);
      this._angleRelease = null;
      this._gate.release("angle-pointer");
      onRelease();
    };
    for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
      document.addEventListener(type, this._angleRelease, true);
  }

  _onAngleSliderPress() {
    this._gate.hold("angle-slider");
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

  /** Angle rotary control as a Lit template (every rotary style:
   * gradient-angle-styles.js). */
  _angleRotaryTemplate(visualAngle, isHeaderMode = false) {
    return this._angleStyleTemplate(
      this._getRotaryStyleInfo().style,
      visualAngle,
      isHeaderMode,
    );
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
   * Per-pixel [r,g,b] colors of a pure angle gradient over a rows×cols
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
    const rect = rotaryElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    let angle =
      style === "rect"
        ? perimeterAngleAt(x, y, 4, 1, RECT_EDGES)
        : style === "square"
          ? perimeterAngleAt(x, y, 1, 1, SQUARE_EDGES)
          : circleAngleAt(e, rect);

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
    this._pendingAngle = angle;

    // Update both input and slider if they exist
    this._syncAngleValueDisplay(angle);
    const angleSlider = this.shadowRoot.getElementById("angleslider");
    if (angleSlider) angleSlider.value = Math.round(angle);

    // The visuals follow at once (no render while dragging).
    this._updateRotaryDisplay(angle);

    // Update gradient buttons during dragging for immediate visual feedback
    this._refreshGallery(angle);

    this._debouncedApplyAngle(angle);
  }

  // ── Capsule angle slider handlers ──────────────────────────
  _startCapsuleDrag() {
    this._gate.hold("angle-slider");
    this._holdAngleControl(() => this._endCapsuleDrag());
  }

  _endCapsuleDrag() {
    this._flushAngle(); // like the rotary's drag end
    this._gate.hold("angle-slider", 100);
  }

  _handleCapsuleAngleInput(event) {
    this._gate.hold("angle-slider");
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
    this._refreshGallery(angle);

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
    // Wheel events are instantaneous (no mouseup): the hold ends at once.
    this._gate.release("angle-slider");
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

  // The control shows `angle` at once (a drag, the slider, typing) without
  // a card render: <yc-angle-view> re-renders alone. The capsule (the shared
  // string markup) moves in place: re-rendering it would replace the range
  // input being dragged.
  _updateRotaryDisplay(angle) {
    if (this._getRotaryStyleInfo().style === "capsule") {
      updateCapsuleVisuals(
        this.shadowRoot,
        (angle / 359) * 100,
        `${Math.round(angle)}°`,
        ".angle-capsule-host",
      );
      const capsuleInput = this.shadowRoot.querySelector(
        ".angle-capsule-host .capsule-input",
      );
      if (capsuleInput) capsuleInput.value = Math.round(angle);
      return;
    }
    for (const view of this.shadowRoot.querySelectorAll("yc-angle-view"))
      view.angle = angle;
  }

  /**
   * The matrix rotary's text preview: its 100 colors as the viewer sees the
   * lamp, top row first (matrix-view.js), or null without data. The lamp's
   * own matrix_colors while it shows them (the same source as the Lamp
   * Preview card: instant updates), turned for its mount; else (off, a
   * firmware mode, no data yet) the current mode's preview_gradient_modes
   * preview, upright already.
   */
  _matrixTextPreviewColors() {
    const entityId = this._primaryEntity();
    const stateObj = entityId ? this._hass?.states?.[entityId] : null;
    const matrixColors = stateObj?.attributes?.matrix_colors;
    if (stateObj?.state === "on" && matrixColors?.length >= MATRIX_SIZE)
      return viewerFrame(matrixColors, deviceOrientation(stateObj.attributes));
    const preview = this._previewCache()?.data?.previews?.[this._getCurrentMode()];
    return preview?.length >= MATRIX_SIZE ? flipMatrixVertical(preview) : null;
  }
};
