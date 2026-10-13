// The "Wheel" (a scrolling row of ticks) style of the shared slider (slider-control-utils.js): its
// markup, its visual update for a value, its interactions (tick, mouse wheel, drag) and its CSS.
import { formatSliderValue, resolveWheelStyle } from "./slider-values.js";

// The values the wheel stops at (every `wheelStep`, and 100).
function wheelStops(gc) {
  const step = Math.max(1, Math.min(50, parseInt(gc.wheelStep) || 10));
  const stops = [];
  for (let s = step; s <= 100; s += step) stops.push(s);
  if (stops[stops.length - 1] !== 100) stops.push(100);
  return stops;
}

// The stop closest to a value.
function nearestStop(stops, value) {
  return stops.reduce(
    (best, sv, i) =>
      Math.abs(sv - value) < Math.abs(stops[best] - value) ? i : best,
    0,
  );
}

// Arrow / mouse wheel direction: whichever axis moved most (right/up = up).
const wheelGoesUp = (event) =>
  Math.abs(event.deltaY) >= Math.abs(event.deltaX)
    ? event.deltaY < 0
    : event.deltaX > 0;

export default {
  render({ gc, v, showValue, thickness, on }) {
    const stops = wheelStops(gc);
    const step = stops[0];
    const wheelStyle = resolveWheelStyle(gc.wheelStyle);
    const showWheelLabels = gc.wheelLabels !== false;
    const tickW = thickness * 5 + 20;
    const activeIndex = nearestStop(stops, v);
    const shift = -(activeIndex * tickW + tickW / 2);
    const ticks = stops
      .map(
        (sv, i) => `
          <button type="button" class="brightness-wheel-tick${
            i === activeIndex ? " active" : ""
          }" data-value="${sv}" data-index="${i}" style="width:${tickW}px;flex:0 0 ${tickW}px;"
            ${on({ click: "WheelTick" }, [sv])}>
            <span class="wheel-tick-mark"></span>
            ${showWheelLabels ? `<span class="wheel-tick-label">${sv}</span>` : ""}
          </button>`,
      )
      .join("");
    return {
      html: `
      <div class="brightness-wheel-wrapper">
        <div class="brightness-wheel-value">${showValue ? formatSliderValue(v, gc) : ""}</div>
        <div class="brightness-wheel-viewport wheel-style-${wheelStyle}"
          style="height:${thickness * 5 + 20}px;"
          ${on({ wheel: "WheelStep", mousedown: "WheelDragStart", touchstart: "WheelDragStart" })}>
          <div class="brightness-wheel-caret"></div>
          <div class="brightness-wheel-fade brightness-wheel-fade-left"></div>
          <div class="brightness-wheel-fade brightness-wheel-fade-right"></div>
          <div class="brightness-wheel-track" style="--wheel-shift: ${shift}px; --tick-w: ${tickW}px;">
            ${ticks}
          </div>
        </div>
        <input type="range" min="${step}" max="100" step="${step}" value="${stops[activeIndex]}"
          class="brightness-slider brightness-slider-wheel" style="display:none;"
          ${on({ input: "Change" })} />
      </div>`,
      mirror: {},
    };
  },

  update({ gc, scoped }, value) {
    const activeIndex = nearestStop(wheelStops(gc), value);
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
        gc.showValue !== false ? formatSliderValue(value, gc) : "";
  },

  handlers({ getConfig, scoped, applyValue, holdPointer, releasePointer, followDrag }) {
    return {
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
        const stops = wheelStops(getConfig());
        const cur = parseInt(input.value) || stops[0];
        let idx = nearestStop(stops, cur);
        idx = wheelGoesUp(event)
          ? Math.min(stops.length - 1, idx + 1)
          : Math.max(0, idx - 1);
        const value = stops[idx];
        input.value = value;
        applyValue(value);
      },

      WheelDragStart(event, element) {
        event.preventDefault();
        const viewport = element ?? event.currentTarget;
        const startX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
        const stops = wheelStops(getConfig());
        const input = viewport
          .closest(".brightness-wheel-wrapper")
          ?.querySelector(".brightness-slider-wheel");
        const startIdx = nearestStop(stops, parseInt(input?.value) || stops[0]);
        const tick = viewport.querySelector(".brightness-wheel-tick");
        const tickW = tick ? tick.offsetWidth || 52 : 52;
        holdPointer();
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
        followDrag(move, releasePointer);
      },
    };
  },

  css: `
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
    --wheel-mark-color: var(--secondary-text-color, #888);
    --wheel-active-color: linear-gradient(180deg, #ffcf7a, #ff8f00);
    --wheel-active-shadow: 0 0 8px rgba(255, 152, 0, 0.7);
    --wheel-active-height: calc(65% - 4px);
    --wheel-active-width: 3px;
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
  .brightness-wheel-viewport.wheel-style-mesh {
    --wheel-mark-color: color-mix(
      in srgb,
      var(--brightness-color, #ff9800) 55%,
      var(--secondary-text-color, #888)
    );
    --wheel-active-color: var(--brightness-color, #ff9800);
    --wheel-active-shadow: 0 0 8px
      color-mix(in srgb, var(--brightness-color, #ff9800) 80%, transparent);
    --wheel-active-height: 70%;
    --wheel-active-width: 4px;
    background-image:
      repeating-linear-gradient(
        45deg,
        rgba(0, 0, 0, 0.07) 0,
        rgba(0, 0, 0, 0.07) 1px,
        transparent 0,
        transparent 50%
      ),
      repeating-linear-gradient(
        -45deg,
        rgba(0, 0, 0, 0.07) 0,
        rgba(0, 0, 0, 0.07) 1px,
        transparent 0,
        transparent 50%
      );
    background-size: 7px 7px;
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
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }
  .brightness-wheel-tick .wheel-tick-mark {
    width: 3px;
    height: calc(50% - 6px);
    max-height: 22px;
    border-radius: 3px;
    background: var(--wheel-mark-color);
  }
  .brightness-wheel-tick .wheel-tick-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--secondary-text-color, #888);
  }
  .brightness-wheel-tick.active {
    opacity: 1;
    transform: scale(1.08);
  }
  .brightness-wheel-tick.active .wheel-tick-mark {
    width: var(--wheel-active-width);
    height: var(--wheel-active-height);
    max-height: 28px;
    background: var(--wheel-active-color);
    box-shadow: var(--wheel-active-shadow);
  }
  .brightness-wheel-tick.active .wheel-tick-label {
    color: var(--primary-text-color);
  }
  .brightness-wheel-caret {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    height: 100%;
    background: linear-gradient(
      180deg,
      transparent,
      rgba(255, 152, 0, 0.85),
      transparent
    );
    z-index: 3;
    pointer-events: none;
  }
  .brightness-wheel-fade {
    position: absolute;
    top: 0;
    width: 34px;
    height: 100%;
    z-index: 2;
    pointer-events: none;
  }
  .brightness-wheel-fade-left {
    left: 0;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--card-background-color, #fff) 84%, #000),
      transparent
    );
  }
  .brightness-wheel-fade-right {
    right: 0;
    background: linear-gradient(
      270deg,
      color-mix(in srgb, var(--card-background-color, #fff) 84%, #000),
      transparent
    );
  }
`,
};
