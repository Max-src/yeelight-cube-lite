// ============================================================================
//  Shared multi-style value slider (Slider / Bar / Wheel / Matrix / Rotary /
//  Capsule)
// ============================================================================
//
// Extracted from the lamp-preview card's brightness slider so the SAME control
// (all styles, CSS and interactions) is reused by every card that needs a
// value slider — currently the brightness control (lamp-preview card) and the
// clock animation-speed control (clock card). One source of truth: a fix here
// benefits every consumer.
//
// The control works in a 1-100 display space. Consumers map that to their own
// device range in the `onCommit(value1to100)` callback (e.g. brightness 3-255,
// speed 1-255). `onLive(value1to100)` fires immediately for responsive
// feedback (optimistic UI / live preview).
//
// Rendering keeps the `brightness-*` class names + `--brightness-color` /
// `--slider-thickness` CSS vars so `sliderControlStyles` is the exact,
// battle-tested CSS. The interaction handlers are produced by
// `createSliderHandlers()` and assigned onto the host element (the render emits
// inline `this.getRootNode().host._sl*` handlers).

import {
  getCapsuleCSS,
  renderCapsuleHTML,
  updateCapsuleVisuals,
} from "./capsule-slider-utils.js";
import { html } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
} from "./button-group-utils.js";
import { createSliderRow, createToggleRow } from "./form-row-utils.js";
import { renderModeSettingsSection } from "./editor_ui_utils.js";

const H = "this.getRootNode().host";

/**
 * Render the slider control for a generic config `gc` and current `value`
 * (1-100). Returns an HTML string.
 *
 * gc: {
 *   style, width, thickness, theme, color, showValue, unit,
 *   variant, barFill,
 *   wheelStep, wheelStyle, wheelLabels,
 *   matrixCols, matrixRows, matrixDir, matrixPixelStyle,
 *   rotaryStyle,
 *   stepButtons, stepSize, stepPosition,
 *   valueDisplay, valueSide, iconLeft, iconRight, snap, capsuleVariant,
 * }
 */
export function renderSliderControl(gc, value, ns = "") {
  const style = gc.style || "slider";
  const width = Math.max(30, Math.min(100, Number(gc.width) || 100));
  const thickness = gc.thickness ?? 6;
  const theme = gc.theme || "subtle";
  const color = gc.color || "#ff9800";
  const unit = gc.unit ?? "%";
  const showValue = gc.showValue !== false;
  const v = value;
  // Capsule exposes its non-track pill content so the step-button row can
  // mirror it (see the shared mirror-spacer layout below).
  let capsuleLeftContent = "";
  let capsuleRightContent = "";
  // Matrix caps its grid width; the step-button area mirrors that same cap so
  // the buttons stay centred on the (left-aligned) grid rather than the row.
  let trackMaxWidth = 0;

  // Namespacing lets several independent sliders live on one host: handler
  // method names are suffixed (e.g. _slSpeedChange) and DOM queries scope to
  // the container carrying data-sl-ns. Empty ns keeps the historical names.
  const nsCap = ns ? ns.charAt(0).toUpperCase() + ns.slice(1) : "";
  const SL = `${H}._sl${nsCap}`;
  const idOf = (b) => (ns ? `${b}-${ns}` : b);

  let html = `<div class="brightness-slider-container brightness-style-${style} brightness-theme-${theme}" data-sl-ns="${ns}" style="--slider-thickness: ${thickness}px; --brightness-color: ${color};" onwheel="${SL}Wheel(event)">`;

  if (style === "bar") {
    const barFill = gc.barFill || "solid";
    const stripesClass = barFill === "stripes" ? " bar-stripes-idle" : "";
    html += `
      <div class="brightness-bar-wrapper brightness-bar-full">
        <div class="brightness-bar-track bar-fill-${barFill}${stripesClass}">
          <div class="brightness-bar-fill" style="width: ${v}%"></div>
          <div class="brightness-bar-seams"></div>
          <input type="range" min="1" max="100" value="${v}"
            class="brightness-slider brightness-slider-bar"
            onmousedown="${SL}StartDrag(); this.closest('.brightness-bar-track')?.classList.remove('bar-stripes-idle');"
            ontouchstart="${SL}StartDrag(); this.closest('.brightness-bar-track')?.classList.remove('bar-stripes-idle');"
            onmouseup="${SL}EndDrag(); this.closest('.brightness-bar-track')?.classList.add('bar-stripes-idle');"
            ontouchend="${SL}EndDrag(); this.closest('.brightness-bar-track')?.classList.add('bar-stripes-idle');"
            oninput="${SL}Change(event)" />
        </div>
        ${showValue ? `<div class="brightness-value-right">${v}${unit}</div>` : ""}
      </div>`;
  } else if (style === "wheel") {
    const step = Math.max(1, Math.min(50, parseInt(gc.wheelStep) || 10));
    const wheelStyle = gc.wheelStyle || "ticks";
    const showWheelLabels = gc.wheelLabels !== false;
    const stops = [];
    for (let s = step; s <= 100; s += step) stops.push(s);
    if (stops[stops.length - 1] !== 100) stops.push(100);
    const tickW = thickness * 5 + 20;
    const activeIndex = stops.reduce(
      (best, sv, i) =>
        Math.abs(sv - v) < Math.abs(stops[best] - v) ? i : best,
      0,
    );
    const shift = -(activeIndex * tickW + tickW / 2);
    const ticks = stops
      .map(
        (sv, i) => `
          <button type="button" class="brightness-wheel-tick wheel-style-${wheelStyle}${
            i === activeIndex ? " active" : ""
          }" data-value="${sv}" data-index="${i}" style="width:${tickW}px;flex:0 0 ${tickW}px;"
            onclick="${SL}WheelTick(${sv})">
            <span class="wheel-tick-mark"></span>
            ${showWheelLabels ? `<span class="wheel-tick-label">${sv}</span>` : ""}
          </button>`,
      )
      .join("");
    html += `
      <div class="brightness-wheel-wrapper">
        <div class="brightness-wheel-value">${showValue ? `${v}${unit}` : ""}</div>
        <div class="brightness-wheel-viewport wheel-style-${wheelStyle}"
          style="height:${thickness * 5 + 20}px;"
          onwheel="${SL}WheelStep(event)"
          onmousedown="${SL}WheelDragStart(event)"
          ontouchstart="${SL}WheelDragStart(event)">
          <div class="brightness-wheel-caret"></div>
          <div class="brightness-wheel-fade brightness-wheel-fade-left"></div>
          <div class="brightness-wheel-fade brightness-wheel-fade-right"></div>
          <div class="brightness-wheel-track" style="--wheel-shift: ${shift}px; --tick-w: ${tickW}px;">
            ${ticks}
          </div>
        </div>
        <input type="range" min="${step}" max="100" step="${step}" value="${stops[activeIndex]}"
          class="brightness-slider brightness-slider-wheel" style="display:none;"
          oninput="${SL}Change(event)" />
      </div>`;
  } else if (style === "matrix") {
    const cols = Math.max(3, Math.min(20, parseInt(gc.matrixCols) || 10));
    const rows = Math.max(1, Math.min(6, parseInt(gc.matrixRows) || 2));
    const matrixDir = gc.matrixDir || "row";
    const matrixPixelStyle = gc.matrixPixelStyle || "rounded";
    const cellPx = thickness * 3 + 4;
    const total = cols * rows;
    trackMaxWidth = cols * (cellPx + 3) + 16;
    const litCount = Math.max(1, Math.round((v / 100) * total));
    let cells = "";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let level;
        if (matrixDir === "col") level = c * rows + (rows - 1 - r) + 1;
        else level = (rows - 1 - r) * cols + c + 1;
        const lit = level <= litCount ? " lit" : "";
        cells += `<div class="brightness-matrix-cell${lit}" data-level="${level}"></div>`;
      }
    }
    html += `
      <div class="brightness-matrix-wrapper">
        <div class="brightness-matrix-grid pixel-shape-${matrixPixelStyle}" data-total="${total}"
             style="box-sizing:border-box;grid-template-columns:repeat(${cols},1fr);gap:3px;max-width:${cols * (cellPx + 3) + 16}px;"
             onmousedown="${SL}MatrixDown(event)"
             ontouchstart="${SL}MatrixDown(event)">
          ${cells}
        </div>
        ${showValue ? `<div class="brightness-matrix-value">${v}${unit}</div>` : ""}
        <input type="range" min="1" max="100" value="${v}"
          class="brightness-slider brightness-slider-matrix" style="display:none;"
          oninput="${SL}Change(event)" />
      </div>`;
  } else if (style === "rotary") {
    const rotaryStyle = gc.rotaryStyle || "glow";
    const angle = ((v - 1) / 99) * 270;
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const arcLength = (circumference * 270) / 360;
    const progressArcLength = (angle / 270) * arcLength;
    const knobAngle = 225 + angle;
    const dialKnobAngleRad = (angle * Math.PI) / 180;
    const dialKnobX = (50 + radius * Math.cos(dialKnobAngleRad)).toFixed(2);
    const dialKnobY = (50 + radius * Math.sin(dialKnobAngleRad)).toFixed(2);
    html += `
      <div class="brightness-rotary-wrapper" onwheel="${SL}Wheel(event)">
        <div class="brightness-rotary-container rotary-style-${rotaryStyle}"
             onmousedown="${SL}RotaryStart(event)"
             ontouchstart="${SL}RotaryStart(event)"
             style="position: relative; z-index: 10; --rotary-stroke: ${thickness * 2};">
          <svg class="brightness-rotary-svg" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="brightnessRotaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ffcf7a" />
                <stop offset="55%" stop-color="#ff9800" />
                <stop offset="100%" stop-color="#ff7043" />
              </linearGradient>
              <linearGradient id="rotaryGlossGrad" x1="50" y1="10" x2="50" y2="90" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="rgba(255,255,255,0.65)" />
                <stop offset="35%" stop-color="rgba(255,255,255,0.18)" />
                <stop offset="100%" stop-color="rgba(0,0,0,0)" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="${radius}" class="rotary-bg" style="stroke-dasharray: ${arcLength} ${circumference};" />
            <circle cx="50" cy="50" r="${radius}" class="rotary-progress rotary-progress-${rotaryStyle}" style="stroke-dasharray: ${progressArcLength} ${circumference};" />
            ${rotaryStyle === "gloss" ? `<circle cx="50" cy="50" r="${radius}" class="rotary-gloss-overlay" style="stroke-dasharray: ${progressArcLength} ${circumference};" />` : ""}
            ${rotaryStyle === "dial" && progressArcLength > 0 ? `<circle class="rotary-dial-knob" cx="${dialKnobX}" cy="${dialKnobY}" r="${thickness + 2}" />` : ""}
          </svg>
          ${rotaryStyle === "thick" ? `<div class="rotary-knob-arm" style="--knob-angle:${knobAngle}deg;"><div class="rotary-knob"></div></div>` : ""}
          <div class="rotary-center-content">
            ${showValue ? `<div class="rotary-value">${v}${unit}</div>` : ""}
          </div>
          <input type="range" min="1" max="100" value="${v}" class="brightness-slider brightness-slider-rotary" style="display: none;" />
        </div>
      </div>`;
  } else if (style === "capsule") {
    const bvd = gc.valueDisplay || (showValue ? "text" : "none");
    const bvs = gc.valueSide || "under";
    let bLeftSlot = null;
    let bRightSlot = null;
    let bIconLeft = gc.iconLeft || null;
    let bIconRight = gc.iconRight || null;
    let bShowValue = false;
    let bValueText = "";
    let bUnderHtml = null;

    const inputBase = `class="brightness-capsule-input" type="number" min="1" max="100" step="1" value="${v}" onfocus="${SL}Typing=true" onblur="${SL}ValueBlur(event)" onkeydown="if(event.key==='Enter')this.blur()" oninput="${SL}ValueInput(event)" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()"`;

    if (bvd !== "none") {
      const isInput = bvd === "input";
      if (bvs === "under") {
        if (isInput) {
          bUnderHtml = `<div class="brightness-capsule-slot capsule-value-under"><input id="${idOf("sl-value-input")}" ${inputBase} /></div>`;
        } else {
          bShowValue = true;
          bValueText = `${v}${unit}`;
        }
      } else {
        const inputHtml = isInput
          ? `<input id="${idOf("sl-value-input")}" ${inputBase} />`
          : `<input id="${idOf("sl-value-text")}" class="brightness-capsule-input" type="text" value="${v}${unit}" readonly tabindex="-1" />`;
        if (bvs === "left") {
          const iconHtml = bIconLeft
            ? `<div class="capsule-icon capsule-icon-left">${bIconLeft}</div>`
            : "";
          bLeftSlot = `<div class="brightness-capsule-slot">${inputHtml}${iconHtml}</div>`;
          bIconLeft = null;
        } else {
          const iconHtml = bIconRight
            ? `<div class="capsule-icon capsule-icon-right">${bIconRight}</div>`
            : "";
          bRightSlot = `<div class="brightness-capsule-slot">${iconHtml}${inputHtml}</div>`;
          bIconRight = null;
        }
      }
    }

    capsuleLeftContent = bLeftSlot
      ? bLeftSlot
      : bIconLeft
        ? `<div class="capsule-icon capsule-icon-left">${bIconLeft}</div>`
        : "";
    capsuleRightContent = bRightSlot
      ? bRightSlot
      : bIconRight
        ? `<div class="capsule-icon capsule-icon-right">${bIconRight}</div>`
        : "";

    html += `<div class="brightness-capsule-host${gc.capsuleVariant === "thick" ? " capsule-variant-thick" : ""}">`;
    html += renderCapsuleHTML({
      theme,
      thickness,
      value: v,
      min: 1,
      max: 100,
      iconLeft: bIconLeft,
      iconRight: bIconRight,
      leftSlotHtml: bLeftSlot,
      rightSlotHtml: bRightSlot,
      hostInputHandler: `${SL}Change(event)`,
      hostDragStart: `${SL}StartDrag()`,
      hostDragEnd: `${SL}EndDrag()`,
      showValue: bShowValue,
      valueText: bValueText,
      underHtml: bUnderHtml,
      trackExtraHtml: gc.snap
        ? `<div class="capsule-snap-ticks">${[20, 40, 60, 80].map((sv) => `<div class="capsule-snap-tick" style="left:${((sv - 1) / 99) * 100}%"></div>`).join("")}</div>`
        : "",
    });
    html += `</div>`;
  } else {
    // Default "slider" style with thin / thick / glow variants
    const variant = gc.variant || "thin";
    if (variant === "glow") {
      html += `
        <div class="brightness-bar-wrapper brightness-glow-wrapper">
          <div class="brightness-glow-track">
            <div class="brightness-glow-fill" style="width: ${v}%"></div>
            <div class="brightness-glow-thumb" style="left: ${v}%"></div>
            <input type="range" min="1" max="100" value="${v}"
              class="brightness-slider brightness-slider-glow"
              onmousedown="${SL}StartDrag()" ontouchstart="${SL}StartDrag()"
              onmouseup="${SL}EndDrag()" ontouchend="${SL}EndDrag()"
              oninput="${SL}Change(event)" />
          </div>
          ${showValue ? `<div class="brightness-value-right">${v}${unit}</div>` : ""}
        </div>`;
    } else {
      html += `
        <div class="brightness-slider-wrapper${showValue ? "" : " brightness-slider-full"}" style="--slider-pct:${v}%">
          <input type="range" min="1" max="100" value="${v}"
            class="brightness-slider brightness-slider-variable slider-variant-${variant}"
            style="--slider-pct:${v}%"
            onmousedown="${SL}StartDrag()" ontouchstart="${SL}StartDrag()"
            onmouseup="${SL}EndDrag()" ontouchend="${SL}EndDrag()"
            oninput="${SL}Change(event)" />
          ${showValue ? `<span class="brightness-value-slider">${v}${unit}</span>` : ""}
        </div>`;
    }
  }

  // Step buttons (below / sides)
  if (gc.stepButtons) {
    const globalStep = Math.max(1, Math.min(25, parseInt(gc.stepSize) || 5));
    const stepPos = gc.stepPosition || "below";
    if (stepPos === "below") {
      // Align the buttons under the TRACK, not the whole control, by mirroring
      // the value/side content next to the track with an invisible spacer that
      // reuses the exact same markup — so the button area always equals the
      // track width regardless of value text, icons or control width.
      let mGap = 12;
      let mPadX = 0;
      let mLeft = "";
      let mRight = "";
      if (style === "capsule") {
        mGap = 16;
        mPadX = 12;
        mLeft = capsuleLeftContent;
        mRight = capsuleRightContent;
      } else if (showValue && style === "bar") {
        mGap = 8;
        mRight = `<div class="brightness-value-right">${v}${unit}</div>`;
      } else if (showValue && style === "matrix") {
        mRight = `<div class="brightness-matrix-value">${v}${unit}</div>`;
      } else if (showValue && style === "slider") {
        mRight =
          (gc.variant || "thin") === "glow"
            ? `<div class="brightness-value-right">${v}${unit}</div>`
            : `<span class="brightness-value-slider">${v}${unit}</span>`;
      }
      const spacer = (inner) =>
        inner
          ? `<div class="brightness-step-spacer" aria-hidden="true">${inner}</div>`
          : "";
      html += `
        <div class="brightness-step-buttons brightness-step-below"
             style="--slider-step-gap:${mGap}px;--slider-step-pad-x:${mPadX}px;--slider-step-track-max:${trackMaxWidth ? `${trackMaxWidth}px` : "none"};">
          ${spacer(mLeft)}
          <div class="brightness-step-btn-area">
            <button class="rotary-step-btn" title="Decrease by ${globalStep}%" onclick="${SL}RotaryStep(-${globalStep})">&#x2212;</button>
            <button class="rotary-step-btn" title="Increase by ${globalStep}%" onclick="${SL}RotaryStep(${globalStep})">&#x2b;</button>
          </div>
          ${spacer(mRight)}
        </div>`;
    }
  }

  html += `</div>`;

  if (gc.stepButtons && (gc.stepPosition || "below") === "sides") {
    const globalStep = Math.max(1, Math.min(25, parseInt(gc.stepSize) || 5));
    const lastDiv = html.lastIndexOf('<div class="brightness-slider-container');
    const closingIdx = html.lastIndexOf("</div>");
    const inner = html.slice(lastDiv, closingIdx + 6);
    html = html.slice(0, lastDiv);
    html += `<div class="brightness-sides-row">
      <button class="rotary-step-btn rotary-step-side" title="Decrease by ${globalStep}%" onclick="${SL}RotaryStep(-${globalStep})">&#x2212;</button>
      ${inner}
      <button class="rotary-step-btn rotary-step-side" title="Increase by ${globalStep}%" onclick="${SL}RotaryStep(${globalStep})">&#x2b;</button>
    </div>`;
  }

  return `<div class="brightness-control-width" style="width:${width}%">${html}</div>`;
}

/**
 * Render one or more labelled controls in a responsive shared layout.
 * Control Width sets each item's preferred share of the available row; items
 * wrap only when their combined widths no longer fit.
 */
export function renderSliderGroup(controls) {
  const items = controls
    .filter(Boolean)
    .map(({ label = "", gc, value, ns = "" }) => {
      const width = Math.max(30, Math.min(100, Number(gc.width) || 100));
      const style = gc.style || "slider";
      return `
        <div class="brightness-control-item brightness-control-item-${style}"
             style="--brightness-control-width:${width}%">
          ${label ? `<div class="brightness-control-label">${label}</div>` : ""}
          ${renderSliderControl({ ...gc, width: 100 }, value, ns)}
        </div>`;
    })
    .join("");
  return `<div class="brightness-control-group">${items}</div>`;
}

/**
 * Create the interaction handlers for a host element. Assign the returned
 * object onto the host (e.g. `Object.assign(this, createSliderHandlers({...}))`)
 * so the inline `this.getRootNode().host._sl*` handlers resolve.
 *
 * Pass a unique `ns` to run several independent sliders on one host: the
 * returned method names are suffixed (e.g. `_slSpeedChange`) and DOM queries
 * scope to the container carrying `data-sl-ns="<ns>"`. Empty ns keeps the
 * historical `_sl*` names / whole-shadow-root queries.
 *
 * @param {Object} p
 * @param {HTMLElement} p.host       - the custom element (has .shadowRoot)
 * @param {Function} p.getConfig     - returns the current generic config (gc)
 * @param {Function} p.onCommit      - (value1to100) => void, debounced apply
 * @param {Function} [p.onLive]      - (value1to100) => void, immediate feedback
 * @param {number}  [p.commitDelay]  - debounce ms (default 500)
 * @param {string}  [p.ns]           - namespace (must match renderSliderControl)
 */
export function createSliderHandlers({
  host,
  getConfig,
  onCommit,
  onLive,
  commitDelay = 500,
  ns = "",
}) {
  const nsCap = ns ? ns.charAt(0).toUpperCase() + ns.slice(1) : "";
  const typingProp = `_sl${nsCap}Typing`;
  const rotaryProp = `_sl${nsCap}RotaryDragging`;
  const idOf = (b) => (ns ? `${b}-${ns}` : b);
  const root = () => host.shadowRoot;
  // Scope internal queries to THIS slider's container so several sliders on one
  // host never clobber each other (falls back to whole root if not found).
  const scoped = () =>
    host.shadowRoot?.querySelector(
      `.brightness-slider-container[data-sl-ns="${ns}"]`,
    ) || host.shadowRoot;
  let commitTimer = null;
  let dragCleanup = null;

  const getWheelStops = () => {
    const gc = getConfig();
    const step = Math.max(1, Math.min(50, parseInt(gc.wheelStep) || 10));
    const stops = [];
    for (let v = step; v <= 100; v += step) stops.push(v);
    if (stops[stops.length - 1] !== 100) stops.push(100);
    return stops;
  };

  const updateWheelVisual = (value) => {
    const gc = getConfig();
    const stops = getWheelStops();
    const activeIndex = stops.reduce(
      (best, v, i) =>
        Math.abs(v - value) < Math.abs(stops[best] - value) ? i : best,
      0,
    );
    const tick = scoped()?.querySelector(".brightness-wheel-tick");
    const tickW = tick ? tick.offsetWidth || 52 : 52;
    const track = scoped()?.querySelector(".brightness-wheel-track");
    if (track)
      track.style.setProperty(
        "--wheel-shift",
        `${-(activeIndex * tickW + tickW / 2)}px`,
      );
    scoped()
      ?.querySelectorAll(".brightness-wheel-tick")
      .forEach((t, i) => t.classList.toggle("active", i === activeIndex));
    const val = scoped()?.querySelector(".brightness-wheel-value");
    if (val)
      val.textContent =
        gc.showValue !== false ? `${value}${gc.unit ?? "%"}` : "";
  };

  const updateMatrixVisual = (value) => {
    const gc = getConfig();
    const grid = scoped()?.querySelector(".brightness-matrix-grid");
    if (!grid) return;
    const total = parseInt(grid.dataset.total) || 1;
    const litCount = Math.max(1, Math.round((value / 100) * total));
    grid.querySelectorAll(".brightness-matrix-cell").forEach((cell) => {
      const level = parseInt(cell.dataset.level) || 0;
      cell.classList.toggle("lit", level <= litCount);
    });
    if (gc.showValue !== false) {
      const val = scoped()?.querySelector(".brightness-matrix-value");
      if (val) val.textContent = `${value}${gc.unit ?? "%"}`;
    }
  };

  const syncValueDisplay = (value) => {
    const r = root();
    if (!r) return;
    const input = r.getElementById(idOf("sl-value-input"));
    const text = r.getElementById(idOf("sl-value-text"));
    const gc = getConfig();
    const suffix = gc.unit ?? "%";
    const valueText = scoped()?.querySelector(
      ".brightness-capsule-host .capsule-value-text",
    );
    if (input && !host[typingProp]) input.value = value;
    if (text) text.value = `${value}${suffix}`;
    if (valueText) valueText.textContent = `${value}${suffix}`;
  };

  // Per-style DOM update for a value (1-100). Shared by live drag and external
  // updates.
  const updateVisuals = (value) => {
    const gc = getConfig();
    const style = gc.style || "slider";
    const showValue = gc.showValue !== false;
    const suffix = gc.unit ?? "%";
    if (style === "bar") {
      const barFill = scoped()?.querySelector(".brightness-bar-fill");
      if (barFill) barFill.style.width = `${value}%`;
      if (showValue) {
        const vr = scoped()?.querySelector(".brightness-value-right");
        if (vr) vr.textContent = `${value}${suffix}`;
      }
    } else if (style === "wheel") {
      updateWheelVisual(value);
    } else if (style === "matrix") {
      updateMatrixVisual(value);
    } else if (style === "rotary") {
      const angle = ((value - 1) / 99) * 270;
      const radius = 40;
      const circumference = 2 * Math.PI * radius;
      const arcLength = (circumference * 270) / 360;
      const progressArcLength = (angle / 270) * arcLength;
      const da = `${progressArcLength} ${circumference}`;
      scoped()
        ?.querySelectorAll(".rotary-progress, .rotary-gloss-overlay")
        .forEach((el) => (el.style.strokeDasharray = da));
      const knobArm = scoped()?.querySelector(".rotary-knob-arm");
      if (knobArm)
        knobArm.style.setProperty("--knob-angle", `${225 + angle}deg`);
      const dialKnob = scoped()?.querySelector(".rotary-dial-knob");
      if (dialKnob) {
        const rad = (angle * Math.PI) / 180;
        dialKnob.setAttribute("cx", (50 + 40 * Math.cos(rad)).toFixed(2));
        dialKnob.setAttribute("cy", (50 + 40 * Math.sin(rad)).toFixed(2));
      }
      if (showValue) {
        const rv = scoped()?.querySelector(".rotary-value");
        if (rv) rv.textContent = `${value}${suffix}`;
      }
    } else if (style === "capsule") {
      const bvd = gc.valueDisplay || (showValue ? "text" : "none");
      const bvs = gc.valueSide || "under";
      updateCapsuleVisuals(
        scoped(),
        value,
        bvd !== "none" && bvs === "under" && bvd !== "input"
          ? `${value}${suffix}`
          : null,
        ".brightness-capsule-host",
      );
      syncValueDisplay(value);
    } else {
      if ((gc.variant || "thin") === "glow") {
        const glowFill = scoped()?.querySelector(".brightness-glow-fill");
        if (glowFill) glowFill.style.width = `${value}%`;
        const glowThumb = scoped()?.querySelector(".brightness-glow-thumb");
        if (glowThumb) glowThumb.style.left = `${value}%`;
        if (showValue) {
          const vr = scoped()?.querySelector(".brightness-value-right");
          if (vr) vr.textContent = `${value}${suffix}`;
        }
      } else if (showValue) {
        const vs = scoped()?.querySelector(".brightness-value-slider");
        if (vs) vs.textContent = `${value}${suffix}`;
      }
      const thickSlider = scoped()?.querySelector(".slider-variant-thick");
      if (thickSlider)
        thickSlider.style.setProperty("--slider-pct", `${value}%`);
    }
  };

  const clamp = (n) => Math.max(1, Math.min(100, n));

  const commit = (value) => {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      host._anySliderDragging = false;
      onCommit(value);
    }, commitDelay);
  };

  const applyValue = (raw) => {
    let value = parseInt(raw);
    if (isNaN(value)) return;
    const gc = getConfig();
    if (gc.snap) {
      for (const sv of [20, 40, 60, 80]) {
        if (Math.abs(value - sv) <= 4) {
          value = sv;
          break;
        }
      }
    }
    value = clamp(value);
    host._anySliderDragging = true;
    updateVisuals(value);
    if (onLive) onLive(value);
    commit(value);
  };

  const base = {
    UpdateVisuals: updateVisuals,

    StartDrag() {
      host._anySliderDragging = true;
    },
    EndDrag() {
      setTimeout(() => {
        host._anySliderDragging = false;
      }, 50);
    },

    Change(event) {
      applyValue(event.target.value);
    },

    Wheel(event) {
      event.preventDefault();
      const container = event.currentTarget;
      const slider =
        container.querySelector(".brightness-slider-rotary") ||
        container.querySelector(".brightness-slider") ||
        container.querySelector(".capsule-input");
      if (slider) {
        const cur = parseInt(slider.value);
        const delta = event.deltaY < 0 ? 5 : -5;
        const nv = clamp(cur + delta);
        slider.value = nv;
        applyValue(nv);
      }
    },

    RotaryStep(delta) {
      const input =
        scoped()?.querySelector(".brightness-slider") ||
        scoped()?.querySelector(".capsule-input");
      if (!input) return;
      const cur = parseInt(input.value) || 1;
      const nv = clamp(cur + delta);
      input.value = nv;
      applyValue(nv);
    },

    WheelTick(value) {
      const input = scoped()?.querySelector(".brightness-slider-wheel");
      if (input) input.value = value;
      applyValue(value);
    },

    WheelStep(event) {
      event.preventDefault();
      event.stopPropagation();
      const input = scoped()?.querySelector(".brightness-slider-wheel");
      if (!input) return;
      const stops = getWheelStops();
      const cur = parseInt(input.value) || stops[0];
      let idx = stops.reduce(
        (best, v, i) =>
          Math.abs(v - cur) < Math.abs(stops[best] - cur) ? i : best,
        0,
      );
      const goUp =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY < 0
          : event.deltaX > 0;
      idx = goUp ? Math.min(stops.length - 1, idx + 1) : Math.max(0, idx - 1);
      const value = stops[idx];
      input.value = value;
      applyValue(value);
    },

    WheelDragStart(event) {
      event.preventDefault();
      const viewport = event.currentTarget;
      const startX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
      const stops = getWheelStops();
      const input = viewport
        .closest(".brightness-wheel-wrapper")
        ?.querySelector(".brightness-slider-wheel");
      const startValue = parseInt(input?.value) || stops[0];
      const startIdx = stops.reduce(
        (best, v, i) =>
          Math.abs(v - startValue) < Math.abs(stops[best] - startValue)
            ? i
            : best,
        0,
      );
      const tick = viewport.querySelector(".brightness-wheel-tick");
      const tickW = tick ? tick.offsetWidth || 52 : 52;
      host._anySliderDragging = true;
      const move = (e) => {
        const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
        const steps = Math.round(-(cx - startX) / tickW);
        const idx = Math.max(0, Math.min(stops.length - 1, startIdx + steps));
        const value = stops[idx];
        if (input && parseInt(input.value) !== value) {
          input.value = value;
          applyValue(value);
        }
      };
      const end = () => {
        setTimeout(() => (host._anySliderDragging = false), 50);
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", end);
        document.removeEventListener("touchmove", move);
        document.removeEventListener("touchend", end);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", end);
    },

    MatrixDown(event) {
      event.preventDefault();
      host._anySliderDragging = true;
      const grid = event.currentTarget;
      const total = parseInt(grid.dataset.total) || 1;
      const input = grid.parentElement?.querySelector(
        ".brightness-slider-matrix",
      );
      const applyAt = (cx, cy) => {
        if (cx === undefined || cy === undefined) return;
        const el = host.shadowRoot.elementFromPoint(cx, cy);
        if (el?.classList?.contains("brightness-matrix-cell")) {
          const level = parseInt(el.dataset.level) || 1;
          const val = clamp(Math.round((level / total) * 100));
          if (input) input.value = val;
          applyValue(val);
        }
      };
      applyAt(
        event.clientX ?? event.touches?.[0]?.clientX,
        event.clientY ?? event.touches?.[0]?.clientY,
      );
      let rafPending = false;
      const move = (e) => {
        const cx = e.clientX ?? e.touches?.[0]?.clientX;
        const cy = e.clientY ?? e.touches?.[0]?.clientY;
        if (cx !== undefined) {
          e.preventDefault();
          if (rafPending) return;
          rafPending = true;
          requestAnimationFrame(() => {
            rafPending = false;
            applyAt(cx, cy);
          });
        }
      };
      const end = () => {
        setTimeout(() => (host._anySliderDragging = false), 50);
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", end);
        document.removeEventListener("touchmove", move);
        document.removeEventListener("touchend", end);
        dragCleanup = null;
      };
      dragCleanup = { move, end };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", end);
    },

    RotaryStart(event) {
      host[rotaryProp] = true;
      host._anySliderDragging = true;
      const container = event.currentTarget;
      const rotaryClick = (e) => {
        const rect = container.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const mx = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
        const my = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
        if (isNaN(mx) || isNaN(my)) return;
        let angle = Math.atan2(my - cy, mx - cx) * (180 / Math.PI);
        angle = (angle + 360) % 360;
        let adj = angle - 135;
        if (adj < 0) adj += 360;
        if (adj > 270) adj = adj > 315 ? 0 : 270;
        const value = Math.round((adj / 270) * 99) + 1;
        const input = container.querySelector(".brightness-slider-rotary");
        if (input) input.value = value;
        applyValue(value);
      };
      rotaryClick(event);
      const move = (e) => {
        if (!host[rotaryProp]) return;
        e.preventDefault();
        rotaryClick(e);
      };
      const end = () => {
        host[rotaryProp] = false;
        setTimeout(() => (host._anySliderDragging = false), 50);
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", end);
        document.removeEventListener("touchmove", move);
        document.removeEventListener("touchend", end);
        dragCleanup = null;
      };
      dragCleanup = { move, end };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", end);
    },

    ValueInput(event) {
      let val = parseInt(event.target.value);
      if (isNaN(val)) return;
      val = clamp(val);
      updateCapsuleVisuals(scoped(), val, null, ".brightness-capsule-host");
    },

    ValueBlur(event) {
      host[typingProp] = false;
      let val = parseInt(event.target.value);
      if (isNaN(val)) val = 1;
      val = clamp(val);
      event.target.value = val;
      applyValue(val);
    },

    // Called from disconnectedCallback to clean up any in-flight drag listeners.
    Destroy() {
      if (commitTimer) clearTimeout(commitTimer);
      if (dragCleanup) {
        document.removeEventListener("mousemove", dragCleanup.move);
        document.removeEventListener("mouseup", dragCleanup.end);
        document.removeEventListener("touchmove", dragCleanup.move);
        document.removeEventListener("touchend", dragCleanup.end);
        dragCleanup = null;
      }
    },
  };

  // Namespace the handler keys (e.g. UpdateVisuals -> _slSpeedUpdateVisuals) so
  // the inline `${SL}...` calls emitted by renderSliderControl resolve.
  const handlers = {};
  for (const k in base) handlers[`_sl${nsCap}${k}`] = base[k];
  return handlers;
}

// Full CSS for the slider control (all styles). Include once in the shadow root.
export const sliderControlStyles = `
  .brightness-control-group {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: center;
    gap: 16px;
  }
  .brightness-control-item {
    flex: 0 1 calc(var(--brightness-control-width, 100%) - 8px);
    min-width: 0;
  }
  .brightness-control-label {
    font-size: 0.82em;
    color: var(--secondary-text-color, #9aa);
    margin-bottom: 2px;
  }
  .brightness-control-item-rotary .brightness-control-label {
    text-align: center;
  }
  .brightness-control-width {
    max-width: 100%;
    margin-inline: auto;
  }
        .brightness-slider-container {
          margin: 10px 0;
          padding: 10px 0;
          text-align: center;
        }
        .brightness-label {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--primary-text-color);
          text-align: left;
        }
        .brightness-slider-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .brightness-slider-full {
          gap: 0;
        }
        .brightness-value-slider {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          min-width: 40px;
          text-align: right;
          flex-shrink: 0;
        }
        .brightness-percentage-standalone {
          font-size: 16px;
          font-weight: 600;
          color: var(--primary-text-color);
          text-align: center;
          padding: 8px 0;
        }
        .brightness-slider-variable {
          width: 100%;
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .brightness-slider-variable.slider-variant-thin {
          height: var(--slider-thickness, 6px);
          border-radius: calc(var(--slider-thickness, 6px) / 2);
          background: linear-gradient(to right, #ff9800, var(--divider-color, #444));
        }
        .brightness-slider-variable.slider-variant-thin::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: calc(var(--slider-thickness, 6px) * 3.2);
          height: calc(var(--slider-thickness, 6px) * 3.2);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .brightness-slider-variable.slider-variant-thin::-moz-range-thumb {
          width: calc(var(--slider-thickness, 6px) * 3.2);
          height: calc(var(--slider-thickness, 6px) * 3.2);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          border: none;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .brightness-slider-variable.slider-variant-thick {
          height: calc(var(--slider-thickness, 6px) * 4);
          border-radius: 6px;
          background: linear-gradient(to right,
            #ff9800 0%,
            #ffc56b var(--slider-pct, 50%),
            var(--divider-color, rgba(0,0,0,0.14)) var(--slider-pct, 50%),
            var(--divider-color, rgba(0,0,0,0.14)) 100%);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .brightness-slider-variable.slider-variant-thick::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 7);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          border: 2px solid var(--divider-color, #ccc);
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        }
        .brightness-slider-variable.slider-variant-thick::-moz-range-thumb {
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 7);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          border: 2px solid var(--divider-color, #ccc);
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        }
        .brightness-slider-variable:not([class*="slider-variant-"]) {
          height: var(--slider-thickness, 6px);
          border-radius: calc(var(--slider-thickness, 6px) / 2);
          background: linear-gradient(to right, var(--disabled-text-color, #333), var(--card-background-color, #fff));
        }
        .brightness-slider-variable:not([class*="slider-variant-"])::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 3);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .brightness-slider-variable:not([class*="slider-variant-"])::-moz-range-thumb {
          width: calc(var(--slider-thickness, 6px) * 3);
          height: calc(var(--slider-thickness, 6px) * 3);
          border-radius: 50%;
          background: var(--accent-color, #ff9800);
          border: none;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .brightness-bar-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .brightness-bar-wrapper.brightness-bar-full {
          gap: 8px;
        }
        .brightness-bar-track {
          position: relative;
          flex: 1;
          height: calc(var(--slider-thickness, 6px) * 5.5);
          background: var(--disabled-color, rgba(255,255,255,0.1));
          border-radius: calc(var(--slider-thickness, 6px) * 2);
          overflow: hidden;
        }
        .brightness-bar-fill {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          background: linear-gradient(90deg, #ffa726 0%, #ffb74d 100%);
          border-radius: 12px;
          transition: width 0.1s ease;
          pointer-events: none;
        }
        .brightness-slider-bar {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          -webkit-appearance: none;
          cursor: pointer;
          outline: none;
        }
        .brightness-slider-bar::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 0;
          height: 0;
          opacity: 0;
        }
        .brightness-slider-bar::-moz-range-thumb {
          width: 0;
          height: 0;
          opacity: 0;
          border: none;
        }
        .brightness-bar-seams {
          position: absolute;
          inset: 0;
          pointer-events: none;
          display: none;
        }
        .bar-fill-pulse .brightness-bar-fill {
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%,
            var(--brightness-color, #ff9800) 60%,
            color-mix(in srgb, var(--brightness-color, #ff9800) 60%, #fff) 100%);
          animation: barPulseGlow 2s ease-in-out infinite;
        }
        @keyframes barPulseGlow {
          0%, 100% { box-shadow: 0 0 6px color-mix(in srgb, var(--brightness-color, #ff9800) 40%, transparent); opacity: 1; }
          50%       { box-shadow: 0 0 18px color-mix(in srgb, var(--brightness-color, #ff9800) 85%, transparent), 0 0 32px color-mix(in srgb, var(--brightness-color, #ff9800) 40%, transparent); opacity: 0.92; }
        }
        .bar-fill-stripes .brightness-bar-fill {
          background:
            repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.22) 0, rgba(255, 255, 255, 0.22) 8px, transparent 8px, transparent 16px),
            linear-gradient(90deg, color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%, var(--brightness-color, #ff9800) 100%);
          background-size: 22px 100%, 100% 100%;
          animation: barStripesShift 0.8s linear infinite;
        }
        .bar-fill-stripes.bar-stripes-idle .brightness-bar-fill {
          animation-play-state: paused;
        }
        @keyframes barStripesShift {
          from { background-position: 0 0, 0 0; }
          to { background-position: 22px 0, 0 0; }
        }
        .bar-fill-gloss .brightness-bar-fill {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0.08) 46%, rgba(0, 0, 0, 0.12) 54%, rgba(0, 0, 0, 0) 100%),
            linear-gradient(90deg, color-mix(in srgb, var(--brightness-color, #ff9800) 80%, #000) 0%, color-mix(in srgb, var(--brightness-color, #ff9800) 70%, #fff) 100%);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.5);
        }
        .brightness-glow-wrapper { gap: 12px; }
        .brightness-glow-track {
          position: relative;
          flex: 1;
          height: calc(var(--slider-thickness, 6px) * 3.5);
          background: var(--primary-background-color, rgba(0, 0, 0, 0.35));
          border-radius: 999px;
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
          overflow: visible;
        }
        .brightness-glow-fill {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          background: linear-gradient(90deg, color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%, var(--brightness-color, #ff9800) 55%, color-mix(in srgb, var(--brightness-color, #ff9800) 60%, #fff) 100%);
          border-radius: 999px;
          box-shadow: 0 0 8px color-mix(in srgb, var(--brightness-color, #ff9800) 75%, transparent), 0 0 16px color-mix(in srgb, var(--brightness-color, #ff9800) 45%, transparent);
          transition: width 0.1s ease;
          pointer-events: none;
        }
        .brightness-glow-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: calc(var(--slider-thickness, 6px) * 3.5 + 6px);
          height: calc(var(--slider-thickness, 6px) * 3.5 + 6px);
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #fff 0%, #ffd38a 45%, #ff9800 100%);
          box-shadow: 0 0 6px rgba(255, 200, 100, 0.9), 0 0 14px rgba(255, 150, 0, 0.6), 0 2px 4px rgba(0, 0, 0, 0.3);
          transition: left 0.1s ease;
          pointer-events: none;
          z-index: 3;
        }
        .brightness-slider-glow {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          -webkit-appearance: none;
          cursor: pointer;
          outline: none;
          z-index: 2;
        }
        .brightness-slider-glow::-webkit-slider-thumb { -webkit-appearance: none; width: 0; height: 0; opacity: 0; }
        .brightness-slider-glow::-moz-range-thumb { width: 0; height: 0; opacity: 0; border: none; }
        .brightness-wheel-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 100%;
        }
        .brightness-wheel-value {
          font-size: 22px;
          font-weight: 700;
          color: var(--primary-text-color);
          text-shadow: 0 0 10px rgba(255, 152, 0, 0.3);
        }
        .brightness-wheel-viewport {
          position: relative;
          width: 100%;
          min-height: 40px;
          overflow: hidden;
          border-radius: 12px;
          background: color-mix(in srgb, var(--card-background-color, #fff) 84%, #000);
          box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.28);
          cursor: ew-resize;
          touch-action: none;
          user-select: none;
        }
        .brightness-wheel-viewport.wheel-style-dots .brightness-wheel-track { align-items: center; }
        .wheel-style-dots .wheel-tick-mark {
          width: calc(var(--slider-thickness, 6px) * 1.5 + 4px) !important;
          height: calc(var(--slider-thickness, 6px) * 1.5 + 4px) !important;
          min-width: 8px;
          min-height: 8px;
          border-radius: 50% !important;
          background: var(--secondary-text-color, #aaa) !important;
          opacity: 0.7;
        }
        .wheel-style-dots .brightness-wheel-tick.active .wheel-tick-mark {
          background: var(--brightness-color, #ff9800) !important;
          box-shadow: 0 0 6px color-mix(in srgb, var(--brightness-color, #ff9800) 70%, transparent) !important;
          opacity: 1;
          width: calc(var(--slider-thickness, 6px) * 2 + 6px) !important;
          height: calc(var(--slider-thickness, 6px) * 2 + 6px) !important;
        }
        .brightness-wheel-viewport.wheel-style-mesh,
        .brightness-wheel-viewport.wheel-style-bars {
          background-image:
            repeating-linear-gradient(45deg, rgba(0,0,0,0.07) 0, rgba(0,0,0,0.07) 1px, transparent 0, transparent 50%),
            repeating-linear-gradient(-45deg, rgba(0,0,0,0.07) 0, rgba(0,0,0,0.07) 1px, transparent 0, transparent 50%);
          background-size: 7px 7px;
        }
        .wheel-style-mesh .wheel-tick-mark,
        .wheel-style-bars .wheel-tick-mark {
          background: color-mix(in srgb, var(--brightness-color, #ff9800) 55%, var(--secondary-text-color, #888)) !important;
        }
        .wheel-style-mesh .brightness-wheel-tick.active .wheel-tick-mark,
        .wheel-style-bars .brightness-wheel-tick.active .wheel-tick-mark {
          background: var(--brightness-color, #ff9800) !important;
          box-shadow: 0 0 8px color-mix(in srgb, var(--brightness-color, #ff9800) 80%, transparent) !important;
          height: 70% !important;
          width: 4px !important;
        }
        .brightness-wheel-track {
          position: absolute;
          left: 50%;
          top: 0;
          height: 100%;
          display: flex;
          align-items: center;
          transform: translateX(var(--wheel-shift, -26px));
          transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .brightness-wheel-tick {
          height: 100%;
          flex: 0 0 52px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          opacity: 0.45;
          transform: scale(0.82);
          transition: opacity 0.18s ease, transform 0.18s ease;
        }
        .brightness-wheel-tick .wheel-tick-mark {
          width: 3px;
          height: calc(50% - 6px);
          max-height: 22px;
          border-radius: 3px;
          background: var(--secondary-text-color, #888);
        }
        .brightness-wheel-tick .wheel-tick-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--secondary-text-color, #888);
        }
        .brightness-wheel-tick.active { opacity: 1; transform: scale(1.08); }
        .brightness-wheel-tick.active .wheel-tick-mark {
          height: calc(65% - 4px);
          max-height: 28px;
          background: linear-gradient(180deg, #ffcf7a, #ff8f00);
          box-shadow: 0 0 8px rgba(255, 152, 0, 0.7);
        }
        .brightness-wheel-tick.active .wheel-tick-label { color: var(--primary-text-color); }
        .brightness-wheel-caret {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 2px;
          height: 100%;
          background: linear-gradient(180deg, transparent, rgba(255, 152, 0, 0.85), transparent);
          z-index: 3;
          pointer-events: none;
        }
        .brightness-wheel-fade { position: absolute; top: 0; width: 34px; height: 100%; z-index: 2; pointer-events: none; }
        .brightness-wheel-fade-left { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--card-background-color, #fff) 84%, #000), transparent); }
        .brightness-wheel-fade-right { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--card-background-color, #fff) 84%, #000), transparent); }
        .brightness-matrix-wrapper { display: flex; align-items: center; gap: 12px; width: 100%; }
        .brightness-matrix-grid {
          flex: 1;
          display: grid;
          gap: 4px;
          padding: 8px;
          border-radius: 10px;
          background: #101012;
          box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.55);
          cursor: pointer;
          user-select: none;
          touch-action: none;
        }
        .brightness-matrix-cell {
          aspect-ratio: 1 / 1;
          border-radius: 3px;
          background: #2a2a2e;
          box-shadow: inset 0 0 2px rgba(0, 0, 0, 0.6);
          transition: background 0.12s ease, box-shadow 0.12s ease;
        }
        .brightness-matrix-cell.lit {
          background: radial-gradient(circle at 40% 35%, color-mix(in srgb, var(--brightness-color, #ff9800) 15%, #fff) 0%, var(--brightness-color, #ff9800) 55%, color-mix(in srgb, var(--brightness-color, #ff9800) 80%, #000) 100%);
          box-shadow: 0 0 6px color-mix(in srgb, var(--brightness-color, #ff9800) 75%, transparent), inset 0 0 2px rgba(255, 255, 255, 0.4);
        }
        .pixel-shape-square .brightness-matrix-cell { border-radius: 0; }
        .pixel-shape-rounded .brightness-matrix-cell { border-radius: 3px; }
        .pixel-shape-round .brightness-matrix-cell { border-radius: 50%; }
        .brightness-matrix-value { font-size: 13px; font-weight: 600; color: var(--primary-text-color); min-width: 40px; text-align: right; }
        .brightness-value-right { font-size: 13px; font-weight: 600; color: var(--primary-text-color); min-width: 40px; text-align: right; }
        .brightness-rotary-wrapper { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
        .brightness-rotary-container { position: relative; width: 100%; height: auto; aspect-ratio: 1; box-sizing: border-box; padding: 6.25%; cursor: pointer; user-select: none; container-type: inline-size; }
        .brightness-rotary-container::before {
          content: "";
          position: absolute;
          inset: 10%;
          border-radius: 50%;
          background: radial-gradient(circle at 50% 36%, color-mix(in srgb, var(--card-background-color, #fff) 86%, #000) 0%, var(--card-background-color, #fff) 72%);
          box-shadow: inset 0 2px 7px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(255, 255, 255, 0.06), 0 6px 16px rgba(0, 0, 0, 0.18);
          pointer-events: none;
        }
        .brightness-rotary-svg { display: block; position: relative; width: 100%; height: 100%; transform: rotate(135deg); pointer-events: none; overflow: visible; }
        .rotary-bg { fill: none; stroke: var(--divider-color, rgba(0, 0, 0, 0.14)); stroke-width: var(--rotary-stroke, 12); stroke-linecap: round; opacity: 0.55; }
        .rotary-progress-glow {
          fill: none; stroke: url(#brightnessRotaryGrad); stroke-width: var(--rotary-stroke, 12); stroke-linecap: round;
          transition: stroke-dasharray 0.1s ease;
          filter: drop-shadow(0 0 3px rgba(255, 152, 0, 0.85)) drop-shadow(0 0 8px rgba(255, 145, 0, 0.5));
        }
        .rotary-progress-gloss { fill: none; stroke: url(#brightnessRotaryGrad); stroke-width: var(--rotary-stroke, 12); stroke-linecap: round; transition: stroke-dasharray 0.1s ease; }
        .rotary-gloss-overlay { fill: none; stroke: url(#rotaryGlossGrad); stroke-width: var(--rotary-stroke, 12); stroke-linecap: round; transition: stroke-dasharray 0.1s ease; pointer-events: none; }
        .rotary-progress-thick { fill: none; stroke: #ff9800; stroke-width: calc(var(--rotary-stroke, 12) * 1.4); stroke-linecap: round; transition: stroke-dasharray 0.1s ease; opacity: 0.9; }
        .rotary-progress-dial { fill: none; stroke: var(--primary-color, #1976d2); stroke-width: var(--rotary-stroke, 12); stroke-linecap: round; transition: stroke-dasharray 0.1s ease; }
        .rotary-style-dial .rotary-bg { opacity: 0.15; }
        .rotary-style-dial .brightness-rotary-container::before { background: none; box-shadow: none; }
        .rotary-style-dial .rotary-label { font-size: 14px; color: var(--secondary-text-color); }
        .rotary-style-dial .rotary-value { font-size: clamp(16px, 18cqi, 28px); font-weight: 700; text-shadow: none; }
        .rotary-dial-knob { fill: var(--card-background-color, #fff); stroke: var(--primary-color, #1976d2); stroke-width: 3; filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.25)); transition: cx 0.1s ease, cy 0.1s ease; }
        .brightness-step-below {
          display: flex;
          align-items: center;
          gap: var(--slider-step-gap, 12px);
          width: 100%;
          margin-top: 6px;
          padding: 2px var(--slider-step-pad-x, 0px) 0;
          box-sizing: border-box;
        }
        .brightness-step-btn-area {
          flex: 1;
          max-width: var(--slider-step-track-max, none);
          display: flex;
          gap: 10px;
          justify-content: center;
          min-width: 0;
        }
        .brightness-step-spacer {
          visibility: hidden;
          pointer-events: none;
          display: flex;
          align-items: center;
        }
        .brightness-sides-row { display: flex; align-items: center; gap: 8px; }
        .brightness-sides-row .brightness-slider-container { flex: 1; min-width: 0; }
        .rotary-step-side { flex: 0 0 auto; }
        .rotary-step-btn {
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          box-sizing: border-box;
          border-radius: 50%;
          border: 2px solid var(--divider-color, rgba(0,0,0,0.15));
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.12);
          transition: box-shadow 0.15s ease, transform 0.1s ease;
          user-select: none;
        }
        .rotary-step-btn:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); transform: scale(1.05); }
        .rotary-step-btn:active { transform: scale(0.95); }
        .rotary-style-thick .brightness-rotary-container::before { display: none; }
        .rotary-knob-arm { position: absolute; inset: 0; transform: rotate(var(--knob-angle, 225deg)); transition: transform 0.1s ease; pointer-events: none; z-index: 6; }
        .rotary-knob {
          position: absolute;
          top: 15%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: calc(var(--rotary-stroke, 12) * 0.9px);
          height: calc(var(--rotary-stroke, 12) * 1.9px);
          min-width: 10px;
          min-height: 22px;
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          border: 2px solid var(--divider-color, #ccc);
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35);
        }
        .capsule-variant-thick .capsule-track { height: calc(var(--capsule-thickness, 6px) * 4) !important; border-radius: 6px !important; }
        .capsule-variant-thick .capsule-thumb {
          width: calc(var(--capsule-thickness, 6px) * 3) !important;
          height: calc(var(--capsule-thickness, 6px) * 6.5) !important;
          border-radius: 5px !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.28) !important;
        }
        .rotary-center-content { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; }
        .rotary-label { font-size: 16px; font-weight: 500; color: var(--secondary-text-color); text-align: center; }
        .rotary-value { font-size: clamp(16px, 15cqi, 24px); font-weight: bold; color: var(--primary-text-color); text-shadow: 0 0 10px rgba(255, 152, 0, 0.35); }
        .brightness-slider-rotary { position: absolute; opacity: 0; pointer-events: none; }
        ${getCapsuleCSS()}
        .brightness-capsule-host { width: 100%; }
        .capsule-snap-ticks { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
        .capsule-snap-tick { position: absolute; top: 50%; width: 5px; height: 5px; transform: translate(-50%, -50%); background: var(--primary-text-color, #333); border-radius: 50%; opacity: 0.35; }
        .brightness-capsule-slot { flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 2px; }
        .brightness-capsule-input {
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
        .brightness-capsule-input::-webkit-outer-spin-button,
        .brightness-capsule-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .brightness-capsule-input[readonly] { cursor: default; }
        .capsule-value-under { display: flex; justify-content: center; padding: 8px 0; }
        .brightness-slider-container.brightness-theme-flat,
        .brightness-slider-container.brightness-theme-subtle,
        .brightness-slider-container.brightness-theme-filled { background: transparent; padding: 10px 0; border: none; box-shadow: none; }
        .brightness-theme-flat .brightness-slider-variable { background: linear-gradient(to right, var(--brightness-color, #ff9800), var(--divider-color, #d0d0d0)); }
        .brightness-theme-subtle .brightness-label,
        .brightness-theme-subtle .brightness-value-slider,
        .brightness-theme-subtle .brightness-value-right,
        .brightness-theme-filled .brightness-label,
        .brightness-theme-filled .brightness-value-slider,
        .brightness-theme-filled .brightness-value-right,
        .brightness-theme-flat .brightness-label { color: var(--primary-text-color); }
        .brightness-theme-subtle .brightness-bar-track { background: var(--divider-color, rgba(0, 0, 0, 0.08)); }
        .brightness-theme-filled .brightness-bar-track { background: var(--primary-background-color, rgba(0, 0, 0, 0.3)); }
        .brightness-theme-flat .brightness-bar-track { background: var(--divider-color, rgba(0, 0, 0, 0.06)); }
        .brightness-theme-subtle .rotary-bg { stroke: var(--divider-color, rgba(0, 0, 0, 0.1)); }
        .brightness-theme-filled .rotary-bg { stroke: var(--primary-background-color, rgba(0, 0, 0, 0.3)); }
        .brightness-theme-flat .rotary-bg { stroke: var(--divider-color, rgba(0, 0, 0, 0.08)); }
        .brightness-theme-filled .rotary-label, .brightness-theme-subtle .rotary-label { color: var(--secondary-text-color); }
        .brightness-theme-filled .rotary-value, .brightness-theme-subtle .rotary-value { color: var(--primary-text-color); }
        .brightness-value { font-size: 12px; color: var(--secondary-text-color); margin-top: 4px; }
`;

// ── Config key mapping ──────────────────────────────────────────────────────
// Consumers may use any config key names; a `keys` map (K) decouples the shared
// render/settings from specific names. `sliderKeys(prefix)` builds a uniform
// `${prefix}_*` scheme (used by the clock speed slider); the brightness slider
// passes its own historical key names.
export function sliderKeys(prefix) {
  const p = (s) => `${prefix}_${s}`;
  return {
    style: p("style"),
    width: p("width"),
    theme: p("theme"),
    thickness: p("thickness"),
    color: p("color"),
    showValue: p("show_value"),
    variant: p("variant"),
    barFill: p("bar_fill"),
    wheelStep: p("wheel_step"),
    wheelStyle: p("wheel_style"),
    wheelLabels: p("wheel_labels"),
    matrixCols: p("matrix_cols"),
    matrixRows: p("matrix_rows"),
    matrixDir: p("matrix_dir"),
    matrixPixelStyle: p("matrix_pixel_style"),
    matrixColor: p("matrix_color"),
    rotaryStyle: p("rotary_style"),
    stepButtons: p("step_buttons"),
    stepSize: p("step_size"),
    stepPosition: p("step_position"),
    valueDisplay: p("value_display"),
    valueSide: p("value_side"),
    snap: p("snap"),
    capsuleVariant: p("capsule_variant"),
    iconLeftShow: p("show_icon_left"),
    iconRightShow: p("show_icon_right"),
  };
}

// Build the generic render config (gc) from a card config + key map + overrides.
export function sliderConfigToGc(config, K, overrides = {}) {
  const g = (k, d) => (config[k] !== undefined ? config[k] : d);
  return {
    style: g(K.style, "slider"),
    width: g(K.width, 100),
    theme: g(K.theme, "subtle"),
    thickness: g(K.thickness, 6),
    color: g(K.matrixColor, g(K.color, "#ff9800")),
    showValue: g(K.showValue, true) !== false,
    variant: g(K.variant, "thin"),
    barFill: g(K.barFill, "solid"),
    wheelStep: g(K.wheelStep, 10),
    wheelStyle: g(K.wheelStyle, "ticks"),
    wheelLabels: g(K.wheelLabels, true),
    matrixCols: g(K.matrixCols, 10),
    matrixRows: g(K.matrixRows, 2),
    matrixDir: g(K.matrixDir, "row"),
    matrixPixelStyle: g(K.matrixPixelStyle, "rounded"),
    rotaryStyle: g(K.rotaryStyle, "glow"),
    stepButtons: g(K.stepButtons, false) === true,
    stepSize: g(K.stepSize, 5),
    stepPosition: g(K.stepPosition, "below"),
    valueDisplay: g(K.valueDisplay, undefined),
    valueSide: g(K.valueSide, "under"),
    snap: g(K.snap, false) === true,
    capsuleVariant: g(K.capsuleVariant, "thin"),
    unit: "%",
    ...overrides,
  };
}

const STYLE_CHOICES = [
  { value: "slider", label: "Slider" },
  { value: "bar", label: "Bar" },
  { value: "wheel", label: "Wheel" },
  { value: "matrix", label: "Matrix" },
  { value: "rotary", label: "Rotary" },
  { value: "capsule", label: "Capsule" },
];

/**
 * Render the full slider settings block (all style options + per-style
 * sub-settings) for a card editor, as a Lit template. Every conditional group
 * (per-style options, step-button options) is wrapped in the shared blue
 * "mode settings" block so conditional settings are visually grouped.
 *
 * @param {Object} config  - the editor config object
 * @param {Object} K       - key map (from sliderKeys(prefix) or custom)
 * @param {Function} onChange - (key, value) => void
 * @param {Object} [opts]   - extra, consumer-specific controls:
 *   - showValueToggle: { label, key }  top-level toggle (non-capsule styles)
 *   - matrixColorKey: string           color picker inside the Matrix block
 *   - icons: { leftLabel, rightLabel } capsule icon show/hide toggles
 *                                      (uses K.iconLeftShow / K.iconRightShow)
 *   - thickness: number                override the displayed track thickness
 */
export function renderSliderSettings(config, K, onChange, opts = {}) {
  const g = (k, d) => (config[k] !== undefined ? config[k] : d);
  const bg = (key, choices, current, extra = "") =>
    html`<div class="form-row">
      <label>${extra}</label>
      ${createButtonGroup(
        choices,
        current,
        createButtonGroupChangeHandler(key, (v) => onChange(key, v)),
      )}
    </div>`;
  const colorRow = (label, key, fallback) => html`
    <div class="form-row">
      <label>${label}</label>
      <input
        type="color"
        .value="${g(key, fallback)}"
        @input="${(e) => onChange(key, e.target.value)}"
        style="width:60px;height:32px;border:none;cursor:pointer;border-radius:6px;"
      />
    </div>
  `;

  const style = g(K.style, "slider");
  const thickness = opts.thickness ?? g(K.thickness, 6);

  // Per-style conditional options — each grouped in the shared blue block.
  let modeSection = "";
  if (style === "slider") {
    modeSection = renderModeSettingsSection(
      "Slider Settings",
      bg(
        K.variant,
        [
          { value: "thin", label: "Thin" },
          { value: "thick", label: "Thick" },
          { value: "glow", label: "Glow" },
        ],
        g(K.variant, "thin"),
        html`<span>Slider Variant</span>`,
      ),
    );
  } else if (style === "bar") {
    modeSection = renderModeSettingsSection(
      "Bar Settings",
      bg(
        K.barFill,
        [
          { value: "solid", label: "Solid" },
          { value: "pulse", label: "Pulse" },
          { value: "stripes", label: "Stripes" },
          { value: "gloss", label: "Gloss" },
        ],
        g(K.barFill, "solid"),
        html`<span>Bar Fill</span>`,
      ),
    );
  } else if (style === "wheel") {
    modeSection = renderModeSettingsSection(
      "Wheel Settings",
      html`
        ${bg(
          K.wheelStyle,
          [
            { value: "ticks", label: "Ticks" },
            { value: "dots", label: "Dots" },
            { value: "bars", label: "Bars" },
            { value: "mesh", label: "Mesh" },
          ],
          g(K.wheelStyle, "ticks"),
          html`<span>Wheel Style</span>`,
        )}
        ${createToggleRow(
          "Show Wheel Labels",
          K.wheelLabels,
          g(K.wheelLabels, true) !== false,
          (e) => onChange(K.wheelLabels, e.target.checked),
        )}
        ${createSliderRow(
          "Wheel Step",
          g(K.wheelStep, 10),
          { min: 5, max: 50, step: 5 },
          (e) => onChange(K.wheelStep, parseInt(e.target.value, 10)),
          "%",
        )}
      `,
    );
  } else if (style === "matrix") {
    modeSection = renderModeSettingsSection(
      "Matrix Settings",
      html`
        ${createSliderRow(
          "Matrix Columns",
          g(K.matrixCols, 10),
          { min: 3, max: 20, step: 1 },
          (e) => onChange(K.matrixCols, parseInt(e.target.value, 10)),
          "",
        )}
        ${createSliderRow(
          "Matrix Rows",
          g(K.matrixRows, 2),
          { min: 1, max: 6, step: 1 },
          (e) => onChange(K.matrixRows, parseInt(e.target.value, 10)),
          "",
        )}
        ${bg(
          K.matrixDir,
          [
            { value: "row", label: "Row" },
            { value: "col", label: "Column" },
          ],
          g(K.matrixDir, "row"),
          html`<span>Fill Direction</span>`,
        )}
        ${bg(
          K.matrixPixelStyle,
          [
            { value: "square", label: "Square" },
            { value: "rounded", label: "Rounded" },
            { value: "round", label: "Round" },
          ],
          g(K.matrixPixelStyle, "rounded"),
          html`<span>Pixel Shape</span>`,
        )}
        ${opts.matrixColorKey
          ? colorRow("Matrix Color", opts.matrixColorKey, "#ff9800")
          : ""}
      `,
    );
  } else if (style === "rotary") {
    modeSection = renderModeSettingsSection(
      "Rotary Settings",
      bg(
        K.rotaryStyle,
        [
          { value: "glow", label: "Glow" },
          { value: "gloss", label: "Gloss" },
          { value: "thick", label: "Thick" },
          { value: "dial", label: "Dial" },
        ],
        g(K.rotaryStyle, "glow"),
        html`<span>Rotary Style</span>`,
      ),
    );
  } else if (style === "capsule") {
    const valueDisplay = g(K.valueDisplay, "text");
    modeSection = renderModeSettingsSection(
      "Capsule Settings",
      html`
        ${bg(
          K.valueDisplay,
          [
            { value: "none", label: "None" },
            { value: "text", label: "Text" },
            { value: "input", label: "Input" },
          ],
          valueDisplay,
          html`<span>Value Display</span>`,
        )}
        ${valueDisplay !== "none"
          ? bg(
              K.valueSide,
              [
                { value: "under", label: "Under" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ],
              g(K.valueSide, "under"),
              html`<span>Value Side</span>`,
            )
          : ""}
        ${opts.icons && K.iconLeftShow
          ? createToggleRow(
              opts.icons.leftLabel,
              K.iconLeftShow,
              g(K.iconLeftShow, true) !== false,
              (e) => onChange(K.iconLeftShow, e.target.checked),
            )
          : ""}
        ${opts.icons && K.iconRightShow
          ? createToggleRow(
              opts.icons.rightLabel,
              K.iconRightShow,
              g(K.iconRightShow, true) !== false,
              (e) => onChange(K.iconRightShow, e.target.checked),
            )
          : ""}
        ${createToggleRow(
          "Snap to Positions",
          K.snap,
          g(K.snap, false) === true,
          (e) => onChange(K.snap, e.target.checked),
        )}
        ${bg(
          K.capsuleVariant,
          [
            { value: "thin", label: "Thin" },
            { value: "thick", label: "Thick" },
          ],
          g(K.capsuleVariant, "thin"),
          html`<span>Track Style</span>`,
        )}
      `,
    );
  }

  const stepButtonsOn = g(K.stepButtons, false) === true;

  return html`
    ${opts.showValueToggle && style !== "capsule"
      ? createToggleRow(
          opts.showValueToggle.label,
          opts.showValueToggle.key,
          g(opts.showValueToggle.key, true) !== false,
          (e) => onChange(opts.showValueToggle.key, e.target.checked),
        )
      : ""}
    ${bg(K.style, STYLE_CHOICES, style, html`<span>Slider Style</span>`)}
    ${createSliderRow(
      "Control Width",
      g(K.width, 100),
      { min: 30, max: 100, step: 5 },
      (e) => onChange(K.width, parseInt(e.target.value, 10)),
      "%",
    )}
    ${bg(
      K.theme,
      [
        { value: "flat", label: "Flat" },
        { value: "subtle", label: "Subtle" },
        { value: "filled", label: "Filled" },
      ],
      g(K.theme, "subtle"),
      html`<span>Theme</span>`,
    )}
    ${modeSection}
    ${createToggleRow("Step Buttons", K.stepButtons, stepButtonsOn, (e) =>
      onChange(K.stepButtons, e.target.checked),
    )}
    ${stepButtonsOn
      ? renderModeSettingsSection(
          "Step Button Settings",
          html`
            ${createSliderRow(
              "Step Size",
              g(K.stepSize, 5),
              { min: 1, max: 25, step: 1 },
              (e) => onChange(K.stepSize, parseInt(e.target.value, 10)),
              "%",
            )}
            ${bg(
              K.stepPosition,
              [
                { value: "below", label: "Below" },
                { value: "sides", label: "Sides" },
              ],
              g(K.stepPosition, "below"),
              html`<span>Step Position</span>`,
            )}
          `,
        )
      : ""}
    ${createSliderRow(
      "Track Thickness",
      thickness,
      { min: 2, max: 10, step: 1 },
      (e) => onChange(K.thickness, parseInt(e.target.value, 10)),
      "px",
    )}
  `;
}
