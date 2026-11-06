// The "Capsule" (a pill with an icon at each end) style of the shared slider
// (slider-control-utils.js): its markup, its visual update for a value and its
// CSS. Its icons are the slider's ends: tapping one steps the value.
import {
  getCapsuleCSS,
  renderCapsuleHTML,
  updateCapsuleVisuals,
} from "./capsule-slider-utils.js";
import {
  SLIDER_MAX,
  SLIDER_MIN,
  capsulePercent,
  formatSliderValue,
} from "./slider-values.js";

export default {
  ends: "inside",
  thickShape: true,
  render({ gc, v, showValue, thickness, theme, drag, ends }) {
    const html =
      `<div class="brightness-capsule-host${gc.capsuleVariant === "thick" ? " capsule-variant-thick" : ""}">` +
      renderCapsuleHTML({
        theme,
        thickness,
        value: v,
        min: SLIDER_MIN,
        max: SLIDER_MAX,
        iconLeft: ends?.left.content ?? null,
        iconRight: ends?.right.content ?? null,
        iconLeftEvents: ends?.left.events ?? null,
        iconRightEvents: ends?.right.events ?? null,
        inputEvents: drag,
        showValue,
        valueText: formatSliderValue(v, gc),
        trackExtraHtml: gc.snap
          ? `<div class="capsule-snap-ticks">${[20, 40, 60, 80].map((sv) => `<div class="capsule-snap-tick" style="left:${capsulePercent(sv)}%"></div>`).join("")}</div>`
          : "",
      }) +
      `</div>`;
    return { html };
  },

  update({ gc, showValue, scoped }, value) {
    updateCapsuleVisuals(
      scoped(),
      capsulePercent(value),
      showValue ? formatSliderValue(value, gc) : null,
      ".brightness-capsule-host",
    );
  },

  css: `
  ${getCapsuleCSS()}
  .capsule-variant-thick .capsule-track {
    height: calc(var(--capsule-thickness, 6px) * 4);
    border-radius: 6px;
  }
  .capsule-variant-thick .capsule-thumb {
    width: calc(var(--capsule-thickness, 6px) * 3);
    height: calc(var(--capsule-thickness, 6px) * 6.5);
    border-radius: 5px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
  }
  .brightness-capsule-host {
    width: 100%;
  }
`,
};
