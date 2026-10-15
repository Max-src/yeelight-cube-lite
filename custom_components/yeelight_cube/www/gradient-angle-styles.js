// The angle control's styles (gradient-angle-control.js), one renderer each:
// wheel, rectangle and square (one perimeter renderer), matrix preview,
// compass and capsule. Mixed into AngleControlMixin, so each reads the card
// (config, colors, size) and the control's shared helpers (_perimeterPoint,
// value templates, snap ticks).
import { html, unsafeHTML, nothing, svg, unsafeSVG } from "./lib/lit-all.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { previewLength } from "./preview-appearance.js";
import {
  resolveCapsuleTheme,
  resolveCapsuleThickness,
  renderCapsuleHTML,
} from "./capsule-slider-utils.js";
import { hostEventAttrs } from "./host-events.js";

export const AngleStylesMixin = (Base) => class extends Base {
  /** The angle control in `style` as a Lit template. */
  _angleStyleTemplate(style, visualAngle, isHeaderMode = false) {
    switch (style) {
      case "wheel":
        return this._angleWheel(visualAngle, isHeaderMode);
      case "rect":
      case "square":
        return this._anglePerimeter(visualAngle, isHeaderMode, style);
      case "matrix_preview":
        return this._angleMatrix(visualAngle, isHeaderMode);
      case "compass":
        return this._angleCompass(visualAngle, isHeaderMode);
      case "capsule":
        return this._angleCapsule(visualAngle);
      default:
        return nothing;
    }
  }

  /** A gradient circle, with an optional arrow-window mask. */
  _angleWheel(visualAngle, isHeaderMode) {
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
      <div class="wheel-container">
        <svg width=${svgSize} height=${svgSize} viewBox="0 0 100 100" id="angle-preview" class="color-wheel">
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
          <circle cx="50" cy="50" r=${wheelRadius} fill="transparent" class="angle-hit"/>
          ${this._svgAngleValueTemplate(wheelRadius, visualAngle)}
        </svg>
      </div>
    `;
  }

  /** A rectangle (4:1) or a square: the gradient box, its selector on the
   * perimeter. */
  _anglePerimeter(visualAngle, isHeaderMode, shape) {
    // The selector on the box's perimeter and the gradient turned with it,
    // exactly like the wheel. A rectangle (4:1) or a square as high as it
    // (same height in the header: 300 x 88 px or 88 px at 100%).
    const square = shape === "square";
    const textColors = this._getCurrentTextColors();
    const normalizedAngle = ((visualAngle % 360) + 360) % 360;
    const { x: selectorX, y: selectorY } = this._perimeterPoint(
      normalizedAngle,
      square ? 1 : 4,
      1,
    );
    const size = this._getRotarySize();
    const height = Math.round((size / 100) * 88);
    const sizeCss = isHeaderMode
      ? `width: ${square ? height : Math.round((size / 100) * 300)}px !important; height: ${height}px !important;`
      : square
        ? `width: ${size / 4}%; aspect-ratio: 1 / 1;`
        : `width: ${size}%; aspect-ratio: 4 / 1;`;
    const background = `linear-gradient(${90 - normalizedAngle}deg, ${textColors
      .map((color) => rgbToCss(color))
      .join(", ")})`;
    // Snap marks: every 45 degrees on the rectangle; on the square the
    // cardinal angles (edge half-circles) and its corners.
    const snapTicks = !this.config.compass_snap_to_coordinates
      ? nothing
      : square
        ? html`${this._perimeterSnapTicks([0, 90, 180, 270], 1, 1)}<div class="snap-tick snap-tick-corner" style="top:-2px;right:-2px"></div><div class="snap-tick snap-tick-corner" style="top:-2px;left:-2px"></div><div class="snap-tick snap-tick-corner" style="bottom:-2px;left:-2px"></div><div class="snap-tick snap-tick-corner" style="bottom:-2px;right:-2px"></div>`
        : this._perimeterSnapTicks([0, 45, 90, 135, 180, 225, 270, 315], 4, 1);
    const kind = square ? "square" : "rect";
    return html`
      <div class="${kind}-container">
        <div
          id="angle-preview"
          class="color-perimeter color-${kind} ${kind}-gradient"
          style="${sizeCss} background: ${background};"
        >
          ${this.config.show_selector_dot !== false
            ? html`<div
                class="perimeter-selector ${kind}-selector"
                style="left: ${selectorX}%; top: ${selectorY}%;"
              ></div>`
            : nothing}
          ${snapTicks}
          ${this._htmlAngleValueTemplate("rotary-overlay-value", visualAngle)}
        </div>
      </div>
    `;
  }

  /** The panel's 20 x 5 pixels showing the gradient at the angle (or the
   * lamp's text preview). */
  _angleMatrix(visualAngle, isHeaderMode) {
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
      <div class="matrix-preview-container" id="angle-preview">
        <div class="matrix-preview-frame" style="width:${isHeaderMode ? `${mpHeaderWidth}px` : `${baseMpSz}%`};">
        <div class="matrix-preview-grid" style="
          grid-template-columns:repeat(${mpCols}, 1fr);
          gap:${previewLength(mpPixelGap)};
          background:${mpBgColor};
          padding:${previewLength(mpPixelGap * 2)};
          border-radius:${previewLength(6)};
          ${mpMatrixShadowStyle}
        ">${mpPixelDivs}</div>
        </div>
        ${this._htmlAngleValueTemplate("matrix-angle-value", visualAngle)}
      </div>
    `;
  }

  /** A dial with an overlay shape (needle, beam, arrow, star, rectangle)
   * and optional ticks and labels. */
  _angleCompass(visualAngle, isHeaderMode) {
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
      <div class="compass-container">
        <svg width=${svgSize} height=${svgSize} viewBox="0 0 100 100" id="angle-preview" class="color-wheel">
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
          <circle cx="50" cy="50" r=${compRadius} fill="transparent" class="angle-hit"/>
          ${this._svgAngleValueTemplate(compRadius, visualAngle)}
        </svg>
      </div>
    `;
  }

  /** A horizontal capsule slider (the shared capsule renderer). */
  _angleCapsule(visualAngle) {
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

    return html`<div class="angle-capsule-host" style="width:${this._getRotarySize()}%">${unsafeHTML(capsuleHTML)}</div>`;
  }
};
