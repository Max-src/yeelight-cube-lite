// Card UI parity check (tests/card-ui-parity.cjs): the slider wheel in both
// axes and directions.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, errors } = t;
  const sliderWheel = await page.evaluate(async () => {
    const clock = document.createElement("yeelight-cube-clock-card");
    clock.setConfig({
      ...window.baseConfig,
      show_animation_speed: true,
      slider_style: "slider",
    });
    clock.hass = window.hass;
    document.body.append(clock);
    await clock.updateComplete;
    const container = clock.shadowRoot.querySelector(
      ".brightness-slider-container",
    );
    const input = container.querySelector(".brightness-slider");
    const before = parseInt(input.value);
    const wheel = (deltaX, deltaY) =>
      container.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX,
          deltaY,
          bubbles: true,
          cancelable: true,
        }),
      );
    wheel(0, -120); // vertical up → increase
    const afterUp = parseInt(input.value);
    wheel(0, 120); // vertical down → decrease
    const afterDown = parseInt(input.value);
    wheel(120, 0); // horizontal right → increase
    const afterRight = parseInt(input.value);
    wheel(-120, 0); // horizontal left → decrease
    const afterLeft = parseInt(input.value);
    clock.remove();
    return { before, afterUp, afterDown, afterRight, afterLeft };
  });
  assert.ok(
    sliderWheel.afterUp > sliderWheel.before &&
      sliderWheel.afterDown < sliderWheel.afterUp &&
      sliderWheel.afterRight > sliderWheel.afterDown &&
      sliderWheel.afterLeft < sliderWheel.afterRight,
    `slider wheel should move up/down with vertical AND horizontal input: ${JSON.stringify(sliderWheel)}`,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS slider wheel supports vertical and horizontal input in both directions",
  );
};
