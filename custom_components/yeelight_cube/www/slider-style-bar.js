// The "Bar" style of the shared slider (slider-control-utils.js): its
// markup, its visual update for a value, and its CSS.
import { formatSliderValue } from "./slider-values.js";

export default {
  render({ gc, v, showValue, drag }) {
    const barFill = gc.barFill || "solid";
    const stripesClass = barFill === "stripes" ? " bar-stripes-idle" : "";
    const value = showValue
      ? `<div class="brightness-value-right">${formatSliderValue(v, gc)}</div>`
      : "";
    return {
      html: `
      <div class="brightness-bar-wrapper brightness-bar-full">
        <div class="brightness-bar-track bar-fill-${barFill}${stripesClass}">
          <div class="brightness-bar-fill" style="width: ${v}%"></div>
          <div class="brightness-bar-seams"></div>
          <input type="range" min="1" max="100" value="${v}"
            class="brightness-slider brightness-slider-bar"
            ${drag} />
        </div>
        ${value}
      </div>`,
      mirror: value ? { gap: 8, right: value } : {},
    };
  },

  update({ gc, showValue, scoped }, value) {
    const barFill = scoped()?.querySelector(".brightness-bar-fill");
    if (barFill) barFill.style.width = `${value}%`;
    if (showValue) {
      const vr = scoped()?.querySelector(".brightness-value-right");
      if (vr) vr.textContent = formatSliderValue(value, gc);
    }
  },

  css: `
  .brightness-bar-wrapper.brightness-bar-full {
    gap: 8px;
  }
  .brightness-bar-track {
    position: relative;
    flex: 1;
    height: calc(var(--slider-thickness, 6px) * 5.5);
    background: var(--disabled-color, rgba(255, 255, 255, 0.1));
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
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%,
      var(--brightness-color, #ff9800) 60%,
      color-mix(in srgb, var(--brightness-color, #ff9800) 60%, #fff) 100%
    );
    animation: barPulseGlow 2s ease-in-out infinite;
  }
  @keyframes barPulseGlow {
    0%,
    100% {
      box-shadow: 0 0 6px
        color-mix(in srgb, var(--brightness-color, #ff9800) 40%, transparent);
      opacity: 1;
    }
    50% {
      box-shadow:
        0 0 18px
          color-mix(in srgb, var(--brightness-color, #ff9800) 85%, transparent),
        0 0 32px
          color-mix(in srgb, var(--brightness-color, #ff9800) 40%, transparent);
      opacity: 0.92;
    }
  }
  .bar-fill-stripes .brightness-bar-fill {
    background:
      repeating-linear-gradient(
        -45deg,
        rgba(255, 255, 255, 0.22) 0,
        rgba(255, 255, 255, 0.22) 8px,
        transparent 8px,
        transparent 16px
      ),
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--brightness-color, #ff9800) 90%, #000) 0%,
        var(--brightness-color, #ff9800) 100%
      );
    background-size:
      22px 100%,
      100% 100%;
    animation: barStripesShift 0.8s linear infinite;
  }
  .bar-fill-stripes.bar-stripes-idle .brightness-bar-fill {
    animation-play-state: paused;
  }
  @keyframes barStripesShift {
    from {
      background-position:
        0 0,
        0 0;
    }
    to {
      background-position:
        22px 0,
        0 0;
    }
  }
  .bar-fill-gloss .brightness-bar-fill {
    background:
      linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.55) 0%,
        rgba(255, 255, 255, 0.08) 46%,
        rgba(0, 0, 0, 0.12) 54%,
        rgba(0, 0, 0, 0) 100%
      ),
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--brightness-color, #ff9800) 80%, #000) 0%,
        color-mix(in srgb, var(--brightness-color, #ff9800) 70%, #fff) 100%
      );
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.5);
  }
`,
};
