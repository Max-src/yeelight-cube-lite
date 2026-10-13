// The "Slider" (thin / thick range input) style of the shared slider (slider-control-utils.js): its
// markup, its visual update for a value, and its CSS.
import { formatSliderValue } from "./slider-values.js";

export default {
  render({ gc, v, showValue, drag }) {
    const variant = gc.variant === "thick" ? "thick" : "thin";
    const value = showValue
      ? `<span class="brightness-value-slider">${formatSliderValue(v, gc)}</span>`
      : "";
    return {
      html: `
      <div class="brightness-slider-wrapper${showValue ? "" : " brightness-slider-full"}" style="--slider-pct:${v}%">
        <input type="range" min="1" max="100" value="${v}"
          class="brightness-slider brightness-slider-variable slider-variant-${variant}"
          style="--slider-pct:${v}%"
          ${drag} />
        ${value}
      </div>`,
      mirror: { right: value },
    };
  },

  update({ gc, showValue, scoped }, value) {
    if (showValue) {
      const vs = scoped()?.querySelector(".brightness-value-slider");
      if (vs) vs.textContent = formatSliderValue(value, gc);
    }
    const thickSlider = scoped()?.querySelector(".slider-variant-thick");
    if (thickSlider) thickSlider.style.setProperty("--slider-pct", `${value}%`);
  },

  css: `
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
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  .brightness-slider-variable.slider-variant-thin::-moz-range-thumb {
    width: calc(var(--slider-thickness, 6px) * 3.2);
    height: calc(var(--slider-thickness, 6px) * 3.2);
    border-radius: 50%;
    background: var(--accent-color, #ff9800);
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  .brightness-slider-variable.slider-variant-thick {
    height: calc(var(--slider-thickness, 6px) * 4);
    border-radius: 6px;
    background: linear-gradient(
      to right,
      #ff9800 0%,
      #ffc56b var(--slider-pct, 50%),
      var(--divider-color, rgba(0, 0, 0, 0.14)) var(--slider-pct, 50%),
      var(--divider-color, rgba(0, 0, 0, 0.14)) 100%
    );
  }
  .brightness-slider-variable.slider-variant-thick::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: calc(var(--slider-thickness, 6px) * 3);
    height: calc(var(--slider-thickness, 6px) * 7);
    border-radius: 5px;
    background: var(--card-background-color, #fff);
    border: 2px solid var(--divider-color, #ccc);
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .brightness-slider-variable.slider-variant-thick::-moz-range-thumb {
    width: calc(var(--slider-thickness, 6px) * 3);
    height: calc(var(--slider-thickness, 6px) * 7);
    border-radius: 5px;
    background: var(--card-background-color, #fff);
    border: 2px solid var(--divider-color, #ccc);
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .brightness-slider-variable:not([class*="slider-variant-"]) {
    height: var(--slider-thickness, 6px);
    border-radius: calc(var(--slider-thickness, 6px) / 2);
    background: linear-gradient(
      to right,
      var(--disabled-text-color, #333),
      var(--card-background-color, #fff)
    );
  }
  .brightness-slider-variable:not(
      [class*="slider-variant-"]
    )::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: calc(var(--slider-thickness, 6px) * 3);
    height: calc(var(--slider-thickness, 6px) * 3);
    border-radius: 50%;
    background: var(--accent-color, #ff9800);
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  .brightness-slider-variable:not([class*="slider-variant-"])::-moz-range-thumb {
    width: calc(var(--slider-thickness, 6px) * 3);
    height: calc(var(--slider-thickness, 6px) * 3);
    border-radius: 50%;
    background: var(--accent-color, #ff9800);
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
`,
};
