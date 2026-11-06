// ============================================================================
//  Shared multi-style value slider (Slider / Bar / Wheel / Matrix / Rotary /
//  Capsule)
// ============================================================================
//
// The SAME control (all styles, CSS and interactions) is used by every card
// with a lamp slider: brightness, speed and intensity in the Clock, Native
// Effects and Lamp Preview cards. One source of truth: a fix here benefits
// every consumer.
//
// The control works in a 1-100 display space (values: slider-values.js).
// Consumers map that to their own device range in `onCommit(value1to100)`;
// `onLive(value1to100)` fires immediately for responsive feedback.
//
// This file holds what every style shares: the container, the ends (step
// buttons), the pointer / commit logic, the config keys and their
// migration from older options. Each style's markup, visual
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
  SLIDER_MAX,
  SLIDER_MIN,
  INTENSITY_RAW,
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
  INTENSITY_RAW,
  SPEED_RAW,
  brightnessPctToRaw,
  brightnessRawToPct,
  intensityPctToRaw,
  intensityRawToPct,
  speedPctToRaw,
  speedRawToPct,
  sliderRawValue,
  sanitizeSliderGc,
  formatSliderValue,
} from "./slider-values.js";

/**
 * The styles, by name. Each module gives:
 * - render(c) -> { html }: its markup inside the slider container (`c.ends`:
 *   the ends to draw, for a style that draws its own);
 * - ends: "sides" (drawn beside it) or "inside" (it draws them), when it
 *   has room for the ends; thickShape: its own Thick look; compact: a fixed
 *   size on the card's background (sliderStyleFeatures);
 * - update(view, value): its visuals for a value (drag, external updates);
 * - handlers(tools) (optional): its own interactions;
 * - css.
 * Any other style name renders the plain "slider".
 */
const SLIDER_STYLES = { slider: range, bar, wheel, matrix, rotary, capsule };
const styleOf = (name) => SLIDER_STYLES[name] || range;

/**
 * A slider's two ends: buttons that step the value down / up by the step
 * size, showing the slider's icons (➖ / ➕ when it has none). `html` is the
 * button; `events` its data-on-* attributes, for a style drawing its own.
 */
function sliderEnds(gc, on) {
  const step = Math.max(1, Math.min(25, parseInt(gc.stepSize) || 5));
  const end = (side, delta, content) => {
    const title = `${delta < 0 ? "Decrease" : "Increase"} by ${step}`;
    const events = `title="${title}" aria-label="${title}" ${on({ click: "Step" }, [delta])}`;
    return {
      content,
      events,
      html: `<button type="button" class="brightness-end brightness-end-${side}" ${events}>${content}</button>`,
    };
  };
  return {
    left: end("left", -step, gc.iconLeft || "➖"),
    right: end("right", step, gc.iconRight || "➕"),
  };
}

/**
 * Render the slider control for a generic config `gc` and current `value`
 * (0-100). Returns an HTML string.
 *
 * gc (sliderConfigToGc): {
 *   style, width, thickness, theme, color, showValue, valueMode, unit,
 *   variant, capsuleVariant, barFill,
 *   wheelStep, wheelStyle, wheelLabels,
 *   matrixCols, matrixRows, matrixDir, matrixPixelStyle,
 *   rotaryStyle,
 *   ends, stepSize, iconLeft, iconRight, snap,
 * }
 *
 * Ends ("icons" or "plus_minus") are buttons that step the value down / up by
 * stepSize: drawn beside the control for a style whose module says
 * `ends: "sides"`, by the style itself for `ends: "inside"` (the Capsule's
 * icons), absent otherwise.
 */
export function renderSliderControl(gc, value, ns = "") {
  gc = sanitizeSliderGc(gc);
  ns = TOKEN_PATTERN.test(String(ns)) ? ns : "";
  const n = Math.round(Number(value));
  const v = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Number.isFinite(n) ? n : SLIDER_MIN));
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

  const placement = SLIDER_STYLES[style].ends;
  const ends = placement && gc.ends && gc.ends !== "none" ? sliderEnds(gc, on) : null;
  const { html: body } = SLIDER_STYLES[style].render({
    gc,
    v,
    showValue: gc.showValue !== false,
    thickness,
    theme,
    on,
    drag,
    idOf,
    ends: placement === "inside" ? ends : null,
  });
  const content =
    ends && placement === "sides"
      ? `<div class="brightness-ends-row">${ends.left.html}<div class="brightness-ends-body">${body}</div>${ends.right.html}</div>`
      : body;
  const html = `<div class="brightness-slider-container brightness-style-${style} brightness-theme-${theme}" data-sl-ns="${ns}" style="--slider-thickness: ${thickness}px; --brightness-color: ${color};" ${on({ wheel: "Wheel" })}>${content}</div>`;

  return `<div class="brightness-control-width" style="width:${width}%">${html}</div>`;
}

// Sliders for a setting what the card shows may not use (an effect's speed
// or intensity): hidden while unused, or, with the card option
// "Grey out unused sliders", kept in place greyed out. Every card with such
// sliders decides through sliderWhenUsed, so they all behave the same.
export const GREY_OUT_UNUSED_KEY = "slider_grey_out_unused";
const UNUSED_SLIDER_HINT = "Not used by the current effect";

/**
 * The control to render for a slider whose setting is `used` or not: the
 * control itself, the control marked unused (greyed out by
 * renderSliderGroup) when the card greys out unused sliders, else null.
 */
export function sliderWhenUsed(config, used, control) {
  if (used) return control;
  return config?.[GREY_OUT_UNUSED_KEY] === true ? { ...control, unused: true } : null;
}

/**
 * Render one or more labelled controls in a responsive shared layout.
 * Control Width sets each item's preferred share of the available row; items
 * wrap only when their combined widths no longer fit.
 */
export function renderSliderGroup(controls) {
  const items = controls
    .filter(Boolean)
    .map(({ label = "", gc, value, ns = "", unused = false }) => {
      // Sanitised here only for the wrapper's own values; renderSliderControl
      // sanitises `gc` itself (doing both would escape text twice).
      const safe = sanitizeSliderGc(gc);
      const width = Math.max(30, Math.min(100, Number(safe.width) || 100));
      const style = safe.style || "slider";
      // An unused slider (sliderWhenUsed) stays in place, greyed out and
      // inert: no drag, wheel, step button or keyboard focus.
      const unusedAttrs = unused
        ? ` inert aria-disabled="true" title="${escapeHtml(UNUSED_SLIDER_HINT)}"`
        : "";
      return `
        <div class="brightness-control-item brightness-control-item-${style}${unused ? " brightness-control-unused" : ""}"
             style="--brightness-control-width:${width}%"${unusedAttrs}>
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

  const clamp = (n) => Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, n));

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

    // The mouse wheel over any style: one step (the step size).
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
        const step = Math.max(1, Math.min(25, parseInt(getConfig().stepSize) || 5));
        const nv = clamp(cur + (goUp ? step : -step));
        slider.value = nv;
        applyValue(nv);
      }
    },

    // The ends (sliderEnds): one step down or up.
    Step(delta) {
      const input =
        scoped()?.querySelector(".brightness-slider") ||
        scoped()?.querySelector(".capsule-input");
      if (!input) return;
      const cur = parseInt(input.value) || SLIDER_MIN;
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
  .brightness-control-unused {
    opacity: 0.4;
    filter: grayscale(1);
    cursor: not-allowed;
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

// The ends beside a Slider or Bar (the Capsule draws its own, the same way).
const sliderEndStyles = `
  .brightness-ends-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brightness-ends-body {
    flex: 1;
    min-width: 0;
  }
  .brightness-end,
  .capsule-icon-button {
    flex: 0 0 auto;
    width: 28px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 22px;
    line-height: 1;
    text-align: center;
    cursor: pointer;
    user-select: none;
    transition: transform 0.1s ease;
  }
  .brightness-end:hover,
  .capsule-icon-button:hover {
    transform: scale(1.12);
  }
  .brightness-end:active,
  .capsule-icon-button:active {
    transform: scale(0.92);
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
  sliderEndStyles,
  capsule.css,
  sliderThemeStyles,
].join("\n");

// ── Config key mapping ──────────────────────────────────────────────────────
// Consumers may use any config key names; a `keys` map (K) decouples the shared
// render/settings from specific names. `sliderKeys(prefix)` builds the uniform
// `${prefix}_*` scheme every lamp slider uses (slider_*). Its `retired` map
// names the options merged into today's (read only by migrateSliderOptions).
const SLIDER_FIELDS = {
  style: "style",
  width: "width",
  theme: "theme",
  thickness: "thickness", // thin | medium | thick
  color: "color",
  value: "value", // none | percent | raw
  ends: "ends", // none | icons | plus_minus
  stepSize: "step_size",
  snap: "snap",
  barFill: "bar_fill",
  wheelStyle: "wheel_style",
  wheelLabels: "wheel_labels",
  matrixCols: "matrix_cols",
  matrixRows: "matrix_rows",
  matrixDir: "matrix_dir",
  matrixPixelStyle: "matrix_pixel_style",
  matrixColor: "matrix_color",
  rotaryStyle: "rotary_style",
};
// Merged into the fields above: Value, Ends, Step Size and Thickness.
const RETIRED_SLIDER_FIELDS = {
  showValue: "show_value",
  valueDisplay: "value_display",
  valueSide: "value_side",
  stepButtons: "step_buttons",
  stepPosition: "step_position",
  iconLeftShow: "show_icon_left",
  iconRightShow: "show_icon_right",
  iconSet: "icons",
  wheelStep: "wheel_step",
  variant: "variant",
  capsuleVariant: "capsule_variant",
};
// Retired options without a prefix: the raw-value toggle (now Value: Device
// units) and the Lamp Preview's oldest theme / thickness names.
const RETIRED_SLIDER_OPTIONS = [
  "slider_show_raw_value",
  "capsule_theme",
  "brightness_slider_appearance",
];

const prefixed = (prefix, fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([field, name]) => [field, `${prefix}_${name}`]),
  );

export function sliderKeys(prefix) {
  return {
    ...prefixed(prefix, SLIDER_FIELDS),
    retired: prefixed(prefix, RETIRED_SLIDER_FIELDS),
  };
}

/** {older name: shared name} for every slider option, today's and retired
 * (a card's own slider prefix, e.g. the Clock's speed_*, to slider_*). */
export function sliderKeyAliases(fromPrefix, toPrefix = "slider") {
  const pairs = (fields) =>
    Object.values(fields).map((name) => [
      `${fromPrefix}_${name}`,
      `${toPrefix}_${name}`,
    ]);
  return Object.fromEntries([
    ...pairs(SLIDER_FIELDS),
    ...pairs(RETIRED_SLIDER_FIELDS),
  ]);
}

// The choices of the merged settings (the editor lists the same). Ends
// default per style (defaultSliderEnds).
export const SLIDER_VALUE_MODES = ["none", "percent", "raw"];
export const SLIDER_ENDS = ["none", "icons", "plus_minus"];
export const SLIDER_THICKNESS = Object.freeze({ thin: 4, medium: 6, thick: 9 });
// A style with its own thick shape (a fat track, a tall thumb) draws it at
// this size for Thickness: Thick.
const THICK_SHAPE_PX = 7;
const STEP_SIZE = Object.freeze({ min: 1, max: 25, fallback: 5 });
// Rotary dials sit side by side, on the card's own background.
const COMPACT_WIDTH = 30;
const PLUS_MINUS = ["➖", "➕"];

/**
 * What a style offers beyond the shared settings, from its module:
 * `ends` ("sides": drawn beside the control, "inside": the style draws them;
 * absent: none), `thickShape` (its own Thick look) and `compact` (a fixed
 * size on the card background: no width or background setting).
 */
export function sliderStyleFeatures(style) {
  const { ends = null, thickShape = false, compact = false } = styleOf(style);
  return { ends, thickShape, compact };
}

/** The Ends a style starts with: the Capsule's icons, none beside the
 * others (as before the ends could be chosen). */
export const defaultSliderEnds = (style) =>
  sliderStyleFeatures(style).ends === "inside" ? "icons" : "none";

const isSet = (value) => value !== undefined && value !== null && value !== "";
const pxLevel = (px, thickShape) =>
  px <= 4 ? "thin" : px <= 7 || thickShape ? "medium" : "thick";

/**
 * The changes that turn a config's retired slider options into today's
 * (Value, Ends, Step Size, Thickness): the new values, and `undefined` for
 * each retired option to drop. An option already set the new way wins. Used
 * by the cards' option normalisation (card-config.js) and, for configs that
 * never went through it, by sliderConfigToGc.
 */
export function migrateSliderOptions(config = {}, K = sliderKeys("slider")) {
  const R = K.retired || {};
  const old = (field) => config[R[field]];
  const changes = {};
  const style = config[K.style] || "slider";
  const { thickShape } = sliderStyleFeatures(style);

  // Value: hidden, a percentage or the device value.
  if (!isSet(config[K.value])) {
    const shown =
      style === "capsule" && isSet(old("valueDisplay"))
        ? old("valueDisplay") !== "none"
        : old("showValue") !== false;
    if (!shown) changes[K.value] = "none";
    else if (config.slider_show_raw_value === true) changes[K.value] = "raw";
  }

  // Ends: the Capsule's icons (now tapped to step), else the step buttons.
  if (!isSet(config[K.ends])) {
    const icons = old("iconLeftShow") !== false || old("iconRightShow") !== false;
    const buttons = old("stepButtons") === true;
    if (style === "capsule" && icons)
      changes[K.ends] = old("iconSet") === "plus_minus" ? "plus_minus" : "icons";
    else if (buttons) changes[K.ends] = "plus_minus";
    else if (style === "capsule") changes[K.ends] = "none";
  }

  // Step Size: the Wheel's own step.
  if (!isSet(config[K.stepSize]) && style === "wheel" && isSet(old("wheelStep")))
    changes[K.stepSize] = Math.max(
      STEP_SIZE.min,
      Math.min(STEP_SIZE.max, Number(old("wheelStep")) || STEP_SIZE.fallback),
    );

  // Thickness: a level, from the pixels or the style's thick shape.
  const thickness = config[K.thickness];
  if (!Object.hasOwn(SLIDER_THICKNESS, String(thickness))) {
    const shape = style === "capsule" ? old("capsuleVariant") : old("variant");
    const appearance = config.brightness_slider_appearance;
    const px = Number(thickness);
    const level =
      thickShape && shape === "thick"
        ? "thick"
        : isSet(thickness) && Number.isFinite(px)
          ? pxLevel(px, thickShape)
          : appearance === "thick" || appearance === "thin"
            ? appearance
            : undefined;
    if (level && level !== "medium") changes[K.thickness] = level;
    else if (thickness !== undefined) changes[K.thickness] = undefined;
  }

  // Card background: the oldest theme names ("transparent" was none).
  const theme = config[K.theme] ?? config.capsule_theme;
  if (theme === "flat" || theme === "transparent") {
    if (config[K.theme] !== "flat") changes[K.theme] = "flat";
  } else if (isSet(config[K.theme]) && config[K.theme] !== "subtle")
    changes[K.theme] = undefined;

  for (const key of [...Object.values(R), ...RETIRED_SLIDER_OPTIONS])
    if (key in config) changes[key] = undefined;
  return changes;
}

/** The config with its slider options in today's names (itself when none
 * needs changing). */
export function withSliderOptions(config, K = sliderKeys("slider")) {
  const changes = migrateSliderOptions(config, K);
  if (!Object.keys(changes).length) return config;
  const result = { ...config, ...changes };
  for (const [key, value] of Object.entries(changes))
    if (value === undefined) delete result[key];
  return result;
}

// The lamp's sliders, by kind: what tells them apart (color, end icons, the
// device range). Everything else is the card's shared slider appearance.
// `familyIcons` replaces the icons for an effect family (effect-families.js):
// a music effect's intensity is how strongly it follows the sound.
// A new lamp slider is one more row here, plus its draft in lamp-sliders.js.
export const LAMP_SLIDER_KINDS = Object.freeze({
  brightness: { color: "#ffb74d", icons: ["🌙", "☀️"], raw: BRIGHTNESS_RAW },
  speed: { color: "#5aa9ff", icons: ["🐢", "⚡"], raw: SPEED_RAW },
  intensity: {
    color: "#b388ff",
    icons: ["💧", "🌊"],
    familyIcons: { music: ["🔈", "🔊"] },
    raw: INTENSITY_RAW,
  },
});

/**
 * The end icons of a lamp slider `kind` for the effect family shown
 * (`family`, optional): ➖ / ➕ with Ends: ➖ ➕, else the kind's own.
 */
export function lampSliderIcons(config, kind, family, keys = sliderKeys("slider")) {
  if (withSliderOptions(config, keys)[keys.ends] === "plus_minus") return PLUS_MINUS;
  const spec = LAMP_SLIDER_KINDS[kind] ?? LAMP_SLIDER_KINDS.brightness;
  return spec.familyIcons?.[family] ?? spec.icons;
}

// Build the generic render config (gc) for a lamp slider (LAMP_SLIDER_KINDS)
// from a card config + key map. `overrides` holds a card's own additions (e.g.
// the Lamp Preview's configurable color, a live rawValue); its `family` is
// the effect family shown, for the icons (lampSliderIcons).
export function lightSliderConfig(
  config,
  kind,
  keys = sliderKeys("slider"),
  { family, ...overrides } = {},
) {
  const { color, raw } = LAMP_SLIDER_KINDS[kind] ?? LAMP_SLIDER_KINDS.brightness;
  const [iconLeft, iconRight] = lampSliderIcons(config, kind, family, keys);
  return sliderConfigToGc(config, keys, {
    color,
    unit: "%",
    iconLeft,
    iconRight,
    rawMin: raw.min,
    rawMax: raw.max,
    rawUnit: "",
    ...overrides,
  });
}

/**
 * The render config (gc) of a slider from a card config and key map: the
 * shared settings resolved for the style (renderSliderControl and the style
 * modules read it). Retired options are read as today's (withSliderOptions).
 */
export function sliderConfigToGc(config, K, overrides = {}) {
  config = withSliderOptions(config, K);
  const g = (k, d) => (config[k] !== undefined ? config[k] : d);
  const style = SLIDER_STYLES[g(K.style)] ? g(K.style) : "slider";
  const features = sliderStyleFeatures(style);
  const level = Object.hasOwn(SLIDER_THICKNESS, String(g(K.thickness)))
    ? g(K.thickness)
    : "medium";
  const thickShape = features.thickShape && level === "thick";
  const value = SLIDER_VALUE_MODES.includes(g(K.value)) ? g(K.value) : "percent";
  const ends = SLIDER_ENDS.includes(g(K.ends)) ? g(K.ends) : defaultSliderEnds(style);
  const stepSize = Math.max(
    STEP_SIZE.min,
    Math.min(STEP_SIZE.max, parseInt(g(K.stepSize)) || STEP_SIZE.fallback),
  );
  return {
    style,
    width: features.compact ? COMPACT_WIDTH : g(K.width, 100),
    theme: features.compact ? "flat" : g(K.theme, "subtle") === "flat" ? "flat" : "subtle",
    thickness: thickShape ? THICK_SHAPE_PX : SLIDER_THICKNESS[level],
    // The Slider and Capsule styles' own thick shape.
    variant: thickShape ? "thick" : "thin",
    capsuleVariant: thickShape ? "thick" : "thin",
    color: g(K.matrixColor, g(K.color, "#ff9800")),
    showValue: value !== "none",
    // The device value (speed and intensity 1-255, brightness 3-255) instead
    // of a percentage, for a slider that has a device range.
    valueMode: value === "raw" ? "raw" : "percent",
    ends: features.ends ? ends : "none",
    stepSize,
    // The Wheel stops every step.
    wheelStep: stepSize,
    snap: g(K.snap, false) === true,
    barFill: g(K.barFill, "solid"),
    wheelStyle: resolveWheelStyle(g(K.wheelStyle, "ticks")),
    wheelLabels: g(K.wheelLabels, true),
    matrixCols: g(K.matrixCols, 10),
    matrixRows: g(K.matrixRows, 2),
    matrixDir: g(K.matrixDir, "row"),
    matrixPixelStyle: g(K.matrixPixelStyle, "rounded"),
    rotaryStyle: g(K.rotaryStyle, "glow"),
    unit: "%",
    ...overrides,
  };
}
