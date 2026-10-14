// Angle control of the gradient card: the rotary / compass / square / matrix
// preview / capsule templates (rendered by <yc-angle-view>), drag and keyboard
// handling. Mixed into YeelightCubeGradientCard.
import { ANGLE_NO_DRAG_SELECTOR } from "./gradient-card-utils.js";
import {
  createColorWheelSegments as _sharedCreateColorWheelSegments,
  createWheelGradientStops as _sharedCreateWheelGradientStops,
} from "./angle-wheel-utils.js";
import { LitElement, html, unsafeHTML, nothing, svg, unsafeSVG } from "./lib/lit-all.js";
import { defineOnce } from "./card-registration.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { previewLength } from "./preview-appearance.js";
import {
  resolveCapsuleTheme,
  resolveCapsuleThickness,
  renderCapsuleHTML,
  updateCapsuleVisuals,
} from "./capsule-slider-utils.js";
import { hostEventAttrs } from "./host-events.js";
import { rgbToHex as _sharedRgbToHex } from "./color-utils.js";

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

export const AngleControlMixin = (Base) => class extends Base {
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

  /** Angle rotary control as a Lit template (every rotary style). */
  _angleRotaryTemplate(visualAngle, isHeaderMode = false) {
    const style = this._getRotaryStyleInfo().style;

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
        // The resolved appearance (preview-appearance.js; older settings
        // included).
        const mpSpacingMode = this.config.matrix_rotary_spacing_mode;
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
        // (except while dragging: the angle's gradient follows the pointer;
        // and until that data arrives).
        let mpPixelDivs =
          this.config.matrix_rotary_text_preview === true && !this._gate.held("angle-drag")
            ? this._renderMatrixTextPreviewPixels(
                mpRows,
                mpCols,
                mpIgnoreBlack,
                mpBorderRadius,
                mpPixelShadowStyle,
              )
            : null;
        if (!mpPixelDivs) {
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
    // Cancel pending debounce and apply the final angle immediately
    // (mirrors handleMouseUp for rotary drag to guarantee _applyAngle fires)
    if (this._pendingAngle !== null && this._pendingAngle !== undefined) {
      this._applyAngle(this._pendingAngle);
      this._lastAngleSent = this._pendingAngle;
      this._pendingAngle = null;
    }
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
   * Get the 100-pixel color array for the matrix rotary text preview.
   * Uses the same data source as the lamp preview card: reads matrix_colors
   * directly from the HA entity state for instant updates.  Falls back to
   * the preview_gradient_modes cache only when entity state is unavailable.
   */
  _getMatrixPreviewColors(rows, cols) {
    // PRIMARY: read matrix_colors from entity state (same as lamp preview card)
    const entityId = this._primaryEntity();
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
   * Render pixel divs for the matrix rotary in "text preview" mode, or null
   * without preview data. Reads matrix_colors directly from entity state
   * (same approach as the lamp preview card) for instant updates when panel
   * mode changes.
   */
  _renderMatrixTextPreviewPixels(
    rows,
    cols,
    ignoreBlack,
    borderRadius,
    pixelShadowStyle = "",
  ) {
    const previewColors = this._getMatrixPreviewColors(rows, cols);
    if (!previewColors || previewColors.length < rows * cols) return null;

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
};
