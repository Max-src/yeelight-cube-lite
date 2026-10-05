/**
 * A card's lamp sliders (brightness, animation speed) in one place: the shared
 * slider interactions (createSliderHandlers) plus, per slider, a draft that
 * keeps the dragged value until the lamp reports it back, so a slow drag or an
 * in-between state update never jumps the slider back.
 *
 *   this._sliders = new LampSliders(this, {
 *     brightness: { config: () => gc, commit: (pct) => send(pct) },
 *     speed: { config: () => gc, commit: ..., live: (pct) => repaint() },
 *   });
 *
 * Each slider is a namespace of the slider markup (renderSliderGroup's /
 * renderSliderControl's `ns`); its handlers are assigned onto the card as
 * _sl<Ns>* and named by the markup's data-on-* attributes. The card reads
 * value(ns) for the value to show, calls settle(attributes) when the lamp
 * state arrives and destroy() on disconnect.
 *
 * Used the same way by every card with lamp sliders (Clock, Native Effects,
 * Lamp Preview); store it as `this._lampSliders`.
 *
 * The namespace names "brightness" and "speed" are a stable contract: they are
 * the `data-sl-ns` values in the rendered markup, and tests query sliders by
 * them (tests/card-docs-browser.js, tests/card-ui-parity.cjs). Lamp Preview
 * has "brightness" only. Renaming one, or adding/removing a card's slider,
 * means updating those tests too -- otherwise the screenshot CI breaks with
 * "Missing slider: <card>/<ns>".
 */
import {
  brightnessRawToPct,
  createSliderDraft,
  createSliderHandlers,
  speedRawToPct,
} from "./slider-control-utils.js";

// The lamp attribute each slider follows, in slider % (the device's
// brightness 3-255 and native effect speed 1-255, with their defaults).
const STATE_PERCENT = {
  brightness: (attrs) => brightnessRawToPct(Number(attrs.brightness) || 3),
  speed: (attrs) => speedRawToPct(Number(attrs.native_effect_speed) || 50),
};

export class LampSliders {
  /**
   * @param {HTMLElement} host - the card (requestUpdate(), _anySliderDragging)
   * @param {Object} sliders - per namespace: config() -> slider render config,
   *   commit(pct) sends the value, optional live(pct) on every movement and
   *   beforeCommit() run before the draft records the value
   * @param {Object} [options]
   * @param {Function} [options.refresh] - shows the sliders' current values
   *   again after a drag ends or a draft expires; defaults to a Lit update
   *   (cards that patch their slider markup in place pass their own)
   */
  constructor(host, sliders, { refresh = () => host.requestUpdate() } = {}) {
    this.host = host;
    this.drafts = {};
    for (const [ns, slider] of Object.entries(sliders)) {
      const draft = createSliderDraft({
        isDragging: () => host._anySliderDragging,
        onExpire: refresh,
      });
      this.drafts[ns] = draft;
      Object.assign(
        host,
        createSliderHandlers({
          host,
          ns,
          getConfig: slider.config,
          onLive: (pct) => {
            draft.live(pct);
            slider.live?.(pct);
          },
          onCommit: (pct) => {
            slider.beforeCommit?.();
            draft.commit(pct);
            slider.commit(pct);
          },
          onDragEnd: refresh,
        }),
      );
    }
  }

  /** The dragged value of a slider in slider %, or null when none. */
  value(ns) {
    return this.drafts[ns]?.value ?? null;
  }

  /** Set (pct) or drop (null) a slider's draft value. */
  setDraft(ns, pct) {
    if (pct == null) this.drafts[ns]?.clear();
    else this.drafts[ns]?.live(pct);
  }

  /** The lamp reported its state: drop drafts it now (about) matches. */
  settle(attrs = {}) {
    for (const [ns, draft] of Object.entries(this.drafts))
      if (STATE_PERCENT[ns]) draft.settle(STATE_PERCENT[ns](attrs));
  }

  /** Detach drags and timers still in progress (disconnectedCallback). */
  destroy() {
    for (const ns of Object.keys(this.drafts)) {
      const cap = ns.charAt(0).toUpperCase() + ns.slice(1);
      this.host[`_sl${cap}Destroy`]?.();
    }
  }
}
