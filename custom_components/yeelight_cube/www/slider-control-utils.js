// ============================================================================
//  Shared multi-style value slider (Slider / Bar / Wheel / Matrix / Rotary /
//  Capsule)
// ============================================================================
//
// The SAME control (all styles, CSS and interactions) is used by every card
// with a lamp slider: brightness and animation speed in the Clock, Native
// Effects and Lamp Preview cards. One source of truth: a fix here benefits
// every consumer.
//
// The control works in a 1-100 display space (values: slider-values.js).
// Consumers map that to their own device range in `onCommit(value1to100)`;
// `onLive(value1to100)` fires immediately for responsive feedback.
//
// This file holds what every style shares: the container, the step buttons,
// the pointer / commit logic and the config keys. Each style's markup, visual
// update, interactions and CSS live in its module (slider-style-*.js, see
// SLIDER_STYLES); the editor settings in slider-settings-ui.js.
//
// Rendering keeps the `brightness-*` class names + `--brightness-color` /
// `--slider-thickness` CSS vars. The interaction handlers are produced by
// `createSliderHandlers()` and assigned onto the host element; the markup
// names them in data-on-* attributes, dispatched by bindHostEvents
// (host-events.js) with no inline script.

import { cardSpacing } from "./card-layout-utils.js";
import { escapeHtml } from "./html-escape-utils.js";
import { hostEventAttrs } from "./host-events.js";
import {
  BRIGHTNESS_RAW,
  SPEED_RAW,
  TOKEN_PATTERN,
  formatSliderValue,
  resolveWheelStyle,
  sanitizeSliderGc,
} from "./slider-values.js";
import { createPendingValue } from "./pending-value.js";
import range from "./slider-style-range.js";
import bar from "./slider-style-bar.js";
import wheel from "./slider-style-wheel.js";
import matrix from "./slider-style-matrix.js";
import rotary from "./slider-style-rotary.js";
import capsule from "./slider-style-capsule.js";

export {
  isSliderHandler,
  sliderPctToRaw,
  sliderRawToPct,
  BRIGHTNESS_RAW,
  SPEED_RAW,
  brightnessPctToRaw,
  brightnessRawToPct,
  speedPctToRaw,
  speedRawToPct,
  sliderRawValue,
  sanitizeSliderGc,
  formatSliderValue,
} from "./slider-values.js";

/**
 * The styles, by name. Each module gives:
 * - render(c) -> { html, mirror }: its markup inside the slider container,
 *   and what sits beside its track (mirrored by the step-button row so the
 *   buttons line up under the track: gap, padX, left, right, trackMaxWidth);
 * - update(view, value): its visuals for a value (drag, external updates);
 * - handlers(tools) (optional): its own interactions;
 * - css.
 * Any other style name renders the plain "slider".
 */
const SLIDER_STYLES = { slider: range, bar, wheel, matrix, rotary, capsule };
const styleOf = (name) => SLIDER_STYLES[name] || range;

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
  gc = sanitizeSliderGc(gc);
  ns = TOKEN_PATTERN.test(String(ns)) ? ns : "";
  const v = Math.max(1, Math.min(100, Math.round(Number(value)) || 1));
  const style = SLIDER_STYLES[gc.style] ? gc.style : "slider";
  const width = Math.max(30, Math.min(100, Number(gc.width) || 100));
  const thickness = gc.thickness ?? 6;
  // Two theme states only: "flat" (plain) or "subtle" (card). Any legacy value
  // (e.g. the removed "filled") collapses to the card look.
  const theme = gc.theme === "flat" ? "flat" : "subtle";
  const color = gc.color || "#ff9800";

  // Namespacing lets several independent sliders live on one host: handler
  // method names are suffixed (e.g. _slSpeedChange) and DOM queries scope to
  // the container carrying data-sl-ns. Empty ns keeps the historical names.
  const nsCap = ns ? ns.charAt(0).toUpperCase() + ns.slice(1) : "";
  // data-on-* attributes naming this slider's host handlers (e.g.
  // { input: "Change" } -> data-on-input="_slSpeedChange").
  const on = (handlers, args) =>
    hostEventAttrs(
      Object.fromEntries(
        Object.entries(handlers).map(([type, name]) => [
          type,
          `_sl${nsCap}${name}`,
        ]),
      ),
      args,
    );
  const drag = on({
    mousedown: "StartDrag",
    touchstart: "StartDrag",
    mouseup: "EndDrag",
    touchend: "EndDrag",
    input: "Change",
  });
  const idOf = (b) => (ns ? `${b}-${ns}` : b);

  const { html: body, mirror = {} } = SLIDER_STYLES[style].render({
    gc,
    v,
    showValue: gc.showValue !== false,
    thickness,
    theme,
    on,
    drag,
    idOf,
  });
  let html = `<div class="brightness-slider-container brightness-style-${style} brightness-theme-${theme}" data-sl-ns="${ns}" style="--slider-thickness: ${thickness}px; --brightness-color: ${color};" ${on({ wheel: "Wheel" })}>${body}`;

  // Step buttons, below the track or on its sides.
  const step = gc.stepButtons
    ? Math.max(1, Math.min(25, parseInt(gc.stepSize) || 5))
    : 0;
  const position = gc.stepPosition || "below";
  const stepButton = (delta, side = "") =>
    `<button type="button" class="rotary-step-btn${side}" title="${delta < 0 ? "Decrease" : "Increase"} by ${Math.abs(delta)}%" ${on({ click: "RotaryStep" }, [delta])}>${delta < 0 ? "&#x2212;" : "&#x2b;"}</button>`;
  if (step && position === "below") {
    // Align the buttons under the TRACK, not the whole control, by mirroring
    // the style's side content with an invisible spacer that reuses the exact
    // same markup — so the button area always equals the track width
    // regardless of value text, icons or control width.
    const spacer = (inner) =>
      inner
        ? `<div class="brightness-step-spacer" aria-hidden="true">${inner}</div>`
        : "";
    const trackMax = mirror.trackMaxWidth ? `${mirror.trackMaxWidth}px` : "none";
    html += `
        <div class="brightness-step-buttons brightness-step-below"
             style="--slider-step-gap:${mirror.gap ?? 12}px;--slider-step-pad-x:${mirror.padX ?? 0}px;--slider-step-track-max:${trackMax};">
          ${spacer(mirror.left)}
          <div class="brightness-step-btn-area">
            ${stepButton(-step)}
            ${stepButton(step)}
          </div>
          ${spacer(mirror.right)}
        </div>`;
  }
  html += `</div>`;
  if (step && position === "sides")
    html = `<div class="brightness-sides-row">
      ${stepButton(-step, " rotary-step-side")}
      ${html}
      ${stepButton(step, " rotary-step-side")}
    </div>`;

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
      // Sanitised here only for the wrapper's own values; renderSliderControl
      // sanitises `gc` itself (doing both would escape text twice).
      const safe = sanitizeSliderGc(gc);
      const width = Math.max(30, Math.min(100, Number(safe.width) || 100));
      const style = safe.style || "slider";
      return `
        <div class="brightness-control-item brightness-control-item-${style}"
             style="--brightness-control-width:${width}%">
          ${label ? `<div class="brightness-control-label">${escapeHtml(label)}</div>` : ""}
          ${renderSliderControl({ ...gc, width: 100 }, value, ns)}
        </div>`;
    })
    .join("");
  return `<div class="brightness-control-group">${items}</div>`;
}

/**
 * The value a slider shows while (and just after) the user drags it, kept
 * until the lamp reports about that value. Without it the card falls back to
 * the lamp's last-known state between commits and the slider jumps back.
 *
 * - live(pct): value under the pointer during a drag
 * - commit(pct): value just sent to the lamp
 * - settle(statePct): call with the lamp's current value (in slider %) on each
 *   state update; drops the draft once it is within `tolerance`, or after
 *   `timeoutMs` if the lamp never confirms. Never drops it while dragging.
 */
export function createSliderDraft({
  isDragging = () => false,
  onExpire,
  tolerance = 2,
  timeoutMs = 5000,
} = {}) {
  // The shared pending value (pending-value.js), held while dragging.
  const draft = createPendingValue({
    matches: (statePct, pct) => Math.abs(Number(statePct) - pct) <= tolerance,
    timeoutMs,
    onExpire,
    isHeld: isDragging,
  });
  return {
    get value() {
      return draft.value;
    },
    live: draft.hold,
    commit: draft.set,
    settle: draft.settle,
    clear: draft.clear,
  };
}

/**
 * Keep a slider group's markup unchanged while one of the host's sliders is
 * held or its value typed. The markup bakes in the current value, so
 * re-rendering it then would make Lit replace the <input> under the pointer
 * or the cursor (the value is shown by the live visual updates instead).
 * Rebuilt normally once the drag or the typing ends.
 */
export function stableSliderMarkup(host, key, markup) {
  const cache = (host._stableSliderMarkup ||= {});
  if ((host._gate.held("slider") || host._sliderTyping) && cache[key] != null)
    return cache[key];
  cache[key] = markup;
  return markup;
}

/**
 * Create the interaction handlers for a host element. Assign the returned
 * object onto the host (e.g. `Object.assign(this, createSliderHandlers({...}))`)
 * so the data-on-* handler names in the slider markup resolve (the host binds
 * them with bindHostEvents(host, isSliderHandler)).
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
 * @param {Function} [p.onDragEnd]   - called once the pointer is released
 *
 * The host's render gate is held ("slider", card-base.js `_gate`) for as long
 * as a pointer is held on any
 * of the host's sliders (released anywhere on the page), so cards can keep
 * the lamp's older state from overwriting the value under the user's finger.
 */
export function createSliderHandlers({
  host,
  getConfig,
  onCommit,
  onLive,
  commitDelay = 500,
  ns = "",
  onDragEnd,
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
  let pendingCommit = null;
  // Detaches the drag in progress (see followDrag), or null.
  let dragCleanup = null;
  let pointerHeld = false;

  // A pointer press on the slider: mark the host as dragging until the button
  // is released *anywhere* (the input's own mouseup only fires over it). The
  // debounced commit must not end the drag while the button is still down,
  // otherwise a slow drag lets the lamp's older state jump the slider back.
  const releasePointer = () => {
    if (!pointerHeld) return;
    pointerHeld = false;
    for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
      document.removeEventListener(type, releasePointer, true);
    // Send the final value now instead of waiting out the debounce.
    if (commitTimer) {
      clearTimeout(commitTimer);
      commitTimer = null;
      const value = pendingCommit;
      pendingCommit = null;
      onCommit(value);
    }
    setTimeout(() => {
      if (pointerHeld) return;
      host._gate.release("slider");
      onDragEnd?.();
    }, 50);
  };
  const holdPointer = () => {
    host._gate.hold("slider");
    if (pointerHeld) return;
    pointerHeld = true;
    for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
      document.addEventListener(type, releasePointer, true);
  };
  // Follow a mouse / touch drag on the document: `move` for each movement,
  // `onEnd` on release. Destroy() also detaches a drag still in progress.
  const followDrag = (move, onEnd) => {
    dragCleanup?.();
    const detach = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      if (dragCleanup === detach) dragCleanup = null;
    };
    const end = () => {
      onEnd();
      detach();
    };
    dragCleanup = detach;
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
  };

  // The style's visuals for a value (1-100): live drag and external updates.
  const updateVisuals = (value) => {
    const gc = getConfig();
    styleOf(gc.style || "slider").update(
      { gc, showValue: gc.showValue !== false, scoped, root, idOf, host, typingProp },
      value,
    );
  };

  const clamp = (n) => Math.max(1, Math.min(100, n));

  const commit = (value) => {
    if (commitTimer) clearTimeout(commitTimer);
    pendingCommit = value;
    commitTimer = setTimeout(() => {
      commitTimer = null;
      pendingCommit = null;
      // Wheel/keyboard changes end here; a held pointer ends on release.
      if (!pointerHeld) host._gate.release("slider");
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
    host._gate.hold("slider");
    updateVisuals(value);
    if (onLive) onLive(value);
    commit(value);
  };

  // What the style modules' own handlers use.
  const tools = {
    host,
    getConfig,
    scoped,
    root,
    idOf,
    typingProp,
    rotaryProp,
    applyValue,
    holdPointer,
    releasePointer,
    followDrag,
    clamp,
  };

  const base = {
    UpdateVisuals: updateVisuals,

    // `element` is the control the event was bound on (see host-events.js).
    StartDrag(event, element) {
      // Bar style: the idle stripes animation pauses while dragging.
      element
        ?.closest?.(".brightness-bar-track")
        ?.classList.remove("bar-stripes-idle");
      holdPointer();
    },
    EndDrag(event, element) {
      element
        ?.closest?.(".brightness-bar-track")
        ?.classList.add("bar-stripes-idle");
      releasePointer();
    },

    Change(event) {
      applyValue(event.target.value);
    },

    // The mouse wheel over any style: ±5.
    Wheel(event, element) {
      event.preventDefault();
      const container = element ?? event.currentTarget;
      const slider =
        container.querySelector(".brightness-slider-rotary") ||
        container.querySelector(".brightness-slider") ||
        container.querySelector(".capsule-input");
      if (slider) {
        const cur = parseInt(slider.value);
        // Support both vertical and horizontal wheel/tilt input: use whichever
        // axis moved most, so a horizontal wheel can raise/lower the value
        // exactly like the vertical wheel (right/up = increase).
        const goUp =
          Math.abs(event.deltaY) >= Math.abs(event.deltaX)
            ? event.deltaY < 0
            : event.deltaX > 0;
        const nv = clamp(cur + (goUp ? 5 : -5));
        slider.value = nv;
        applyValue(nv);
      }
    },

    // The step buttons.
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

    // Every style's own interactions (the config may switch styles later).
    ...Object.values(SLIDER_STYLES).reduce(
      (all, style) => ({ ...all, ...style.handlers?.(tools) }),
      {},
    ),

    // Called from disconnectedCallback to clean up any in-flight drag listeners.
    Destroy() {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = null;
      pendingCommit = null;
      if (pointerHeld) {
        pointerHeld = false;
        for (const type of ["mouseup", "pointerup", "touchend", "touchcancel"])
          document.removeEventListener(type, releasePointer, true);
      }
      dragCleanup?.();
    },
  };

  // Namespace the handler keys (e.g. UpdateVisuals -> _slSpeedUpdateVisuals) so
  // the data-on-* handler names emitted by renderSliderControl resolve.
  const handlers = {};
  for (const k in base) handlers[`_sl${nsCap}${k}`] = base[k];
  return handlers;
}

// What every style shares: the layout of labelled sliders, the step buttons
// and the two themes. Each style's own CSS is in its module.
const sliderLayoutStyles = `
  .brightness-control-group {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: center;
    gap: ${cardSpacing.control};
  }
  .brightness-control-item {
    flex: 0 1 calc(var(--brightness-control-width, 100%) - ${cardSpacing.control} / 2);
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
    text-align: center;
  }
  .brightness-label {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--primary-text-color);
    text-align: left;
  }
  .brightness-slider-wrapper,
  .brightness-bar-wrapper,
  .brightness-matrix-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  .brightness-slider-full {
    gap: 0;
  }
  .brightness-value-slider,
  .brightness-matrix-value,
  .brightness-value-right {
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
    min-width: 40px;
    text-align: right;
  }
  .brightness-value-slider {
    flex-shrink: 0;
  }
  .brightness-percentage-standalone {
    font-size: 16px;
    font-weight: 600;
    color: var(--primary-text-color);
    text-align: center;
    padding: 8px 0;
  }
  .brightness-value {
    font-size: 12px;
    color: var(--secondary-text-color);
    margin-top: 4px;
  }
`;

const sliderStepButtonStyles = `
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
  .brightness-sides-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brightness-sides-row .brightness-slider-container {
    flex: 1;
    min-width: 0;
  }
  .rotary-step-side {
    flex: 0 0 auto;
  }
  .rotary-step-btn {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--divider-color, rgba(0, 0, 0, 0.15));
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #333);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.12);
    transition:
      box-shadow 0.15s ease,
      transform 0.1s ease;
    user-select: none;
  }
  .rotary-step-btn:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transform: scale(1.05);
  }
  .rotary-step-btn:active {
    transform: scale(0.95);
  }
`;

const sliderThemeStyles = `
  .brightness-slider-container.brightness-theme-flat,
  .brightness-slider-container.brightness-style-capsule {
    background: transparent;
    border: none;
    box-shadow: none;
  }
  .brightness-slider-container:not(
      .brightness-style-capsule
    ).brightness-theme-subtle {
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow:
      0 3px 12px rgba(0, 0, 0, 0.22),
      0 1px 4px rgba(0, 0, 0, 0.14);
    background: var(--card-background-color, #fff);
  }
  .brightness-theme-flat .brightness-slider-variable {
    background: linear-gradient(
      to right,
      var(--brightness-color, #ff9800),
      var(--divider-color, #d0d0d0)
    );
  }
  .brightness-theme-subtle .brightness-bar-track {
    background: var(--divider-color, rgba(0, 0, 0, 0.08));
  }
  .brightness-theme-flat .brightness-bar-track {
    background: var(--divider-color, rgba(0, 0, 0, 0.06));
  }
  .brightness-theme-subtle .rotary-bg {
    stroke: var(--divider-color, rgba(0, 0, 0, 0.1));
  }
  .brightness-theme-flat .rotary-bg {
    stroke: var(--divider-color, rgba(0, 0, 0, 0.08));
  }
`;

export const sliderControlStyles = [
  sliderLayoutStyles,
  range.css,
  bar.css,
  wheel.css,
  matrix.css,
  rotary.css,
  sliderStepButtonStyles,
  capsule.css,
  sliderThemeStyles,
].join("\n");

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

// Build the generic render config (gc) for a lamp brightness/speed slider from a
// card config + key map. `overrides` holds a card's own additions (e.g. the
// Lamp Preview's configurable color and legacy values, a live rawValue).
export function lightSliderConfig(
  config,
  kind,
  keys = sliderKeys("slider"),
  overrides = {},
) {
  const speed = kind === "speed";
  return sliderConfigToGc(config, keys, {
    color: speed ? "#5aa9ff" : "#ffb74d",
    unit: "%",
    iconLeft:
      config[keys.iconLeftShow] !== false ? (speed ? "🐢" : "🌙") : null,
    iconRight:
      config[keys.iconRightShow] !== false ? (speed ? "⚡" : "☀️") : null,
    // Global "Show Raw Value" toggle: display the device value (speed 1-255,
    // brightness 3-255) instead of a percentage.
    valueMode: config.slider_show_raw_value ? "raw" : "percent",
    rawMin: (speed ? SPEED_RAW : BRIGHTNESS_RAW).min,
    rawMax: (speed ? SPEED_RAW : BRIGHTNESS_RAW).max,
    rawUnit: "",
    ...overrides,
  });
}

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
    wheelStyle: resolveWheelStyle(g(K.wheelStyle, "ticks")),
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
