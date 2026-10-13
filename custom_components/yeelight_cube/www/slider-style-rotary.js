// The "Rotary" (a 270° dial: glow, gloss, thick, dial) style of the shared slider (slider-control-utils.js): its
// markup, its visual update for a value, its drag around the dial and its CSS.
import { formatSliderValue } from "./slider-values.js";

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_LENGTH = (CIRCUMFERENCE * 270) / 360;

// The dial's geometry for a 1-100 value: the arc drawn and the knob's angle.
function dial(value) {
  const angle = ((value - 1) / 99) * 270;
  const rad = (angle * Math.PI) / 180;
  return {
    angle,
    progress: (angle / 270) * ARC_LENGTH,
    knobX: (50 + RADIUS * Math.cos(rad)).toFixed(2),
    knobY: (50 + RADIUS * Math.sin(rad)).toFixed(2),
  };
}

export default {
  render({ gc, v, showValue, thickness, on }) {
    const rotaryStyle = gc.rotaryStyle || "glow";
    const { angle, progress, knobX, knobY } = dial(v);
    const dash = `stroke-dasharray: ${progress} ${CIRCUMFERENCE};`;
    return {
      html: `
      <div class="brightness-rotary-wrapper" ${on({ wheel: "Wheel" })}>
        <div class="brightness-rotary-container rotary-style-${rotaryStyle}"
             ${on({ mousedown: "RotaryStart", touchstart: "RotaryStart" })}
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
            <circle cx="50" cy="50" r="${RADIUS}" class="rotary-bg" style="stroke-dasharray: ${ARC_LENGTH} ${CIRCUMFERENCE};" />
            <circle cx="50" cy="50" r="${RADIUS}" class="rotary-progress rotary-progress-${rotaryStyle}" style="${dash}" />
            ${rotaryStyle === "gloss" ? `<circle cx="50" cy="50" r="${RADIUS}" class="rotary-gloss-overlay" style="${dash}" />` : ""}
            ${rotaryStyle === "dial" && progress > 0 ? `<circle class="rotary-dial-knob" cx="${knobX}" cy="${knobY}" r="${thickness + 2}" />` : ""}
          </svg>
          ${rotaryStyle === "thick" ? `<div class="rotary-knob-arm" style="--knob-angle:${225 + angle}deg;"><div class="rotary-knob"></div></div>` : ""}
          <div class="rotary-center-content">
            ${showValue ? `<div class="rotary-value">${formatSliderValue(v, gc)}</div>` : ""}
          </div>
          <input type="range" min="1" max="100" value="${v}" class="brightness-slider brightness-slider-rotary" style="display: none;" />
        </div>
      </div>`,
      mirror: {},
    };
  },

  update({ gc, showValue, scoped }, value) {
    const { angle, progress, knobX, knobY } = dial(value);
    const da = `${progress} ${CIRCUMFERENCE}`;
    scoped()
      ?.querySelectorAll(".rotary-progress, .rotary-gloss-overlay")
      .forEach((el) => (el.style.strokeDasharray = da));
    const knobArm = scoped()?.querySelector(".rotary-knob-arm");
    if (knobArm) knobArm.style.setProperty("--knob-angle", `${225 + angle}deg`);
    const dialKnob = scoped()?.querySelector(".rotary-dial-knob");
    if (dialKnob) {
      dialKnob.setAttribute("cx", knobX);
      dialKnob.setAttribute("cy", knobY);
    }
    if (showValue) {
      const rv = scoped()?.querySelector(".rotary-value");
      if (rv) rv.textContent = formatSliderValue(value, gc);
    }
  },

  handlers({ host, rotaryProp, applyValue, holdPointer, releasePointer, followDrag }) {
    return {
      RotaryStart(event, element) {
        host[rotaryProp] = true;
        holdPointer();
        const container = element ?? event.currentTarget;
        // The value at a point: its angle on the 270° arc that starts at 135°.
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
        followDrag(move, () => {
          host[rotaryProp] = false;
          releasePointer();
        });
      },
    };
  },

  css: `
  .brightness-rotary-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
  }
  .brightness-rotary-container {
    position: relative;
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    box-sizing: border-box;
    padding: 6.25%;
    cursor: pointer;
    user-select: none;
    container-type: inline-size;
  }
  .brightness-rotary-container::before {
    content: "";
    position: absolute;
    inset: 10%;
    border-radius: 50%;
    background: radial-gradient(
      circle at 50% 36%,
      color-mix(in srgb, var(--card-background-color, #fff) 86%, #000) 0%,
      var(--card-background-color, #fff) 72%
    );
    box-shadow:
      inset 0 2px 7px rgba(0, 0, 0, 0.3),
      inset 0 -1px 3px rgba(255, 255, 255, 0.06),
      0 6px 16px rgba(0, 0, 0, 0.18);
    pointer-events: none;
  }
  .brightness-rotary-svg {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    transform: rotate(135deg);
    pointer-events: none;
    overflow: visible;
  }
  .rotary-bg {
    fill: none;
    stroke: var(--divider-color, rgba(0, 0, 0, 0.14));
    stroke-width: var(--rotary-stroke, 12);
    stroke-linecap: round;
    opacity: 0.55;
  }
  .rotary-progress-glow {
    fill: none;
    stroke: url(#brightnessRotaryGrad);
    stroke-width: var(--rotary-stroke, 12);
    stroke-linecap: round;
    transition: stroke-dasharray 0.1s ease;
    filter: drop-shadow(0 0 3px rgba(255, 152, 0, 0.85))
      drop-shadow(0 0 8px rgba(255, 145, 0, 0.5));
  }
  .rotary-progress-gloss {
    fill: none;
    stroke: url(#brightnessRotaryGrad);
    stroke-width: var(--rotary-stroke, 12);
    stroke-linecap: round;
    transition: stroke-dasharray 0.1s ease;
  }
  .rotary-gloss-overlay {
    fill: none;
    stroke: url(#rotaryGlossGrad);
    stroke-width: var(--rotary-stroke, 12);
    stroke-linecap: round;
    transition: stroke-dasharray 0.1s ease;
    pointer-events: none;
  }
  .rotary-progress-thick {
    fill: none;
    stroke: #ff9800;
    stroke-width: calc(var(--rotary-stroke, 12) * 1.4);
    stroke-linecap: round;
    transition: stroke-dasharray 0.1s ease;
    opacity: 0.9;
  }
  .rotary-progress-dial {
    fill: none;
    stroke: var(--primary-color, #1976d2);
    stroke-width: var(--rotary-stroke, 12);
    stroke-linecap: round;
    transition: stroke-dasharray 0.1s ease;
  }
  .rotary-style-dial .rotary-bg {
    opacity: 0.15;
  }
  .rotary-style-dial .brightness-rotary-container::before {
    background: none;
    box-shadow: none;
  }
  .rotary-style-dial .rotary-label {
    font-size: 14px;
    color: var(--secondary-text-color);
  }
  .rotary-style-dial .rotary-value {
    font-size: clamp(16px, 18cqi, 28px);
    font-weight: 700;
    text-shadow: none;
  }
  .rotary-dial-knob {
    fill: var(--card-background-color, #fff);
    stroke: var(--primary-color, #1976d2);
    stroke-width: 3;
    filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.25));
    transition:
      cx 0.1s ease,
      cy 0.1s ease;
  }
  .rotary-style-thick .brightness-rotary-container::before {
    display: none;
  }
  .rotary-knob-arm {
    position: absolute;
    inset: 0;
    transform: rotate(var(--knob-angle, 225deg));
    transition: transform 0.1s ease;
    pointer-events: none;
    z-index: 6;
  }
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
  .rotary-center-content {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    pointer-events: none;
  }
  .rotary-label {
    font-size: 16px;
    font-weight: 500;
    color: var(--secondary-text-color);
    text-align: center;
  }
  .rotary-value {
    font-size: clamp(16px, 15cqi, 24px);
    font-weight: bold;
    color: var(--primary-text-color);
    text-shadow: 0 0 10px rgba(255, 152, 0, 0.35);
  }
  .brightness-slider-rotary {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
`,
};
