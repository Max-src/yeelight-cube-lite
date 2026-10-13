// The "Capsule" (a pill with icons and an optional value field) style of the shared slider (slider-control-utils.js): its
// markup, its visual update for a value, its value field and its CSS.
import {
  getCapsuleCSS,
  renderCapsuleHTML,
  updateCapsuleVisuals,
} from "./capsule-slider-utils.js";
import {
  capsulePercent,
  formatSliderValue,
  sliderPctToRaw,
  sliderRawMode,
  sliderRawToPct,
  sliderRawValue,
} from "./slider-values.js";

const icon = (side, content) =>
  content ? `<div class="capsule-icon capsule-icon-${side}">${content}</div>` : "";

export default {
  render({ gc, v, showValue, thickness, theme, on, drag, idOf }) {
    const bvd = gc.valueDisplay || (showValue ? "text" : "none");
    const bvs = gc.valueSide || "under";
    // The editable value field works in the displayed units (raw when the
    // raw toggle is on); the value handlers convert back to 1-100.
    const capRaw = sliderRawMode(gc);
    const capMin = capRaw ? gc.rawMin : 1;
    const capMax = capRaw ? gc.rawMax : 100;
    const capVal = capRaw ? sliderRawValue(v, gc) : v;
    let leftSlot = null;
    let rightSlot = null;
    let iconLeft = gc.iconLeft || null;
    let iconRight = gc.iconRight || null;
    let showText = false;
    let valueText = "";
    let underHtml = null;

    const inputBase = `class="brightness-capsule-input" type="number" min="${capMin}" max="${capMax}" step="1" value="${capVal}" ${on({ focusin: "ValueFocus", focusout: "ValueBlur", keydown: "ValueKey", input: "ValueInput" })} data-stop="mousedown touchstart"`;

    if (bvd !== "none") {
      const isInput = bvd === "input";
      if (bvs === "under") {
        if (isInput) {
          underHtml = `<div class="brightness-capsule-slot capsule-value-under"><input id="${idOf("sl-value-input")}" ${inputBase} /></div>`;
        } else {
          showText = true;
          valueText = formatSliderValue(v, gc);
        }
      } else {
        const inputHtml = isInput
          ? `<input id="${idOf("sl-value-input")}" ${inputBase} />`
          : `<input id="${idOf("sl-value-text")}" class="brightness-capsule-input" type="text" value="${formatSliderValue(v, gc)}" readonly tabindex="-1" />`;
        // The value takes its side's place, next to that side's icon.
        if (bvs === "left") {
          leftSlot = `<div class="brightness-capsule-slot">${inputHtml}${icon("left", iconLeft)}</div>`;
          iconLeft = null;
        } else {
          rightSlot = `<div class="brightness-capsule-slot">${icon("right", iconRight)}${inputHtml}</div>`;
          iconRight = null;
        }
      }
    }

    const html =
      `<div class="brightness-capsule-host${gc.capsuleVariant === "thick" ? " capsule-variant-thick" : ""}">` +
      renderCapsuleHTML({
        theme,
        thickness,
        value: v,
        min: 1,
        max: 100,
        iconLeft,
        iconRight,
        leftSlotHtml: leftSlot,
        rightSlotHtml: rightSlot,
        inputEvents: drag,
        showValue: showText,
        valueText,
        underHtml,
        trackExtraHtml: gc.snap
          ? `<div class="capsule-snap-ticks">${[20, 40, 60, 80].map((sv) => `<div class="capsule-snap-tick" style="left:${capsulePercent(sv)}%"></div>`).join("")}</div>`
          : "",
      }) +
      `</div>`;
    // The step-button row mirrors the pill's side content.
    return {
      html,
      mirror: {
        gap: 16,
        padX: 12,
        left: leftSlot || icon("left", iconLeft),
        right: rightSlot || icon("right", iconRight),
      },
    };
  },

  update({ gc, showValue, scoped, host, root, idOf, typingProp }, value) {
    const bvd = gc.valueDisplay || (showValue ? "text" : "none");
    const bvs = gc.valueSide || "under";
    updateCapsuleVisuals(
      scoped(),
      capsulePercent(value),
      bvd !== "none" && bvs === "under" && bvd !== "input"
        ? formatSliderValue(value, gc)
        : null,
      ".brightness-capsule-host",
    );
    // The value field and texts (never the field the user is typing in).
    const r = root();
    if (!r) return;
    const input = r.getElementById(idOf("sl-value-input"));
    const text = r.getElementById(idOf("sl-value-text"));
    const valueText = scoped()?.querySelector(
      ".brightness-capsule-host .capsule-value-text",
    );
    if (input && !host[typingProp])
      input.value = sliderRawMode(gc) ? sliderRawValue(value, gc) : value;
    if (text) text.value = formatSliderValue(value, gc);
    if (valueText) valueText.textContent = formatSliderValue(value, gc);
  },

  handlers({ host, getConfig, scoped, typingProp, applyValue, clamp }) {
    // The typed value in 1-100 (converted from the device units in raw mode).
    const typed = (gc, raw) => {
      const val = parseInt(raw);
      if (isNaN(val)) return NaN;
      return clamp(sliderRawMode(gc) ? sliderRawToPct(val, gc.rawMin, gc.rawMax) : val);
    };
    return {
      ValueFocus() {
        host[typingProp] = true;
        host._sliderTyping = true;
      },

      ValueKey(event) {
        if (event.key === "Enter") event.target.blur();
      },

      // While typing: the pill follows; the value is sent on blur.
      ValueInput(event) {
        const val = typed(getConfig(), event.target.value);
        if (isNaN(val)) return;
        updateCapsuleVisuals(
          scoped(),
          capsulePercent(val),
          null,
          ".brightness-capsule-host",
        );
      },

      ValueBlur(event) {
        host[typingProp] = false;
        host._sliderTyping = false;
        const gc = getConfig();
        let val = typed(gc, event.target.value);
        if (isNaN(val)) val = clamp(sliderRawMode(gc) ? gc.rawMin : 1);
        event.target.value = sliderRawMode(gc)
          ? sliderPctToRaw(val, gc.rawMin, gc.rawMax)
          : val;
        applyValue(val);
      },
    };
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
  .capsule-snap-ticks {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }
  .capsule-snap-tick {
    position: absolute;
    top: 50%;
    width: 5px;
    height: 5px;
    transform: translate(-50%, -50%);
    background: var(--primary-text-color, #333);
    border-radius: 50%;
    opacity: 0.35;
  }
  .brightness-capsule-slot {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  .brightness-capsule-input {
    width: 52px;
    height: 26px;
    border: 1px solid var(--divider-color, rgba(128, 128, 128, 0.3));
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
  .brightness-capsule-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .brightness-capsule-input[readonly] {
    cursor: default;
  }
  .capsule-value-under {
    display: flex;
    justify-content: center;
    padding: 8px 0;
  }
`,
};
