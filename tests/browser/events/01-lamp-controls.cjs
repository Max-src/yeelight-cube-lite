// Card events check (tests/card-events-browser.cjs): the Lamp Preview's
// sliders and orientation, the Native / Clock brightness.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, waitForCall, reset, lamp, SLIDER_STYLES } = t;
  // --- Every slider style on the Lamp Preview --------------------------------
  for (const style of SLIDER_STYLES) {
    await page.evaluate(
      ({ tag, style }) =>
        mount(tag, {
          entity: "light.a",
          show_brightness_slider: true,
          brightness_slider_style: style,
          brightness_step_buttons: true,
          brightness_value_display: "input",
          show_device_orientation: false,
        }),
      { tag: lamp, style },
    );
    // Step button (click, with a numeric argument).
    await page
      .locator(`${lamp} .rotary-step-btn[title^="Increase"]`)
      .first()
      .click();
    await waitForCall("turn_on", `${style} step button`);
    await reset();

    if (style === "slider" || style === "bar") {
      // Press, move and release on the range input: drag lifecycle + input.
      const input = page.locator(`${lamp} input.brightness-slider`).first();
      const box = await input.boundingBox();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, {
        steps: 5,
      });
      assert.equal(
        await page.evaluate(() => card._gate.held("slider")),
        true,
        `${style}: drag not held`,
      );
      await page.mouse.up();
      await waitForCall("turn_on", `${style} drag`);
      if (style === "bar")
        assert.ok(
          await page.evaluate(() =>
            card.shadowRoot
              .querySelector(".brightness-bar-track")
              .classList.contains("bar-stripes-idle"),
          ),
          "bar: idle stripes restored on release",
        );
    } else if (style === "wheel") {
      await page
        .locator(`${lamp} .brightness-wheel-tick[data-value="30"]`)
        .click();
      const data = await waitForCall("turn_on", "wheel tick");
      assert.equal(data.brightness, 77); // 30% on the 3-255 curve
      await reset();
      await page.locator(`${lamp} .brightness-wheel-viewport`).hover();
      // A real wheel (not a synthetic event): it must reach the card.
      await page.mouse.wheel(0, -100);
      await waitForCall("turn_on", "wheel scroll");
    } else if (style === "matrix") {
      await page.locator(`${lamp} .brightness-matrix-cell`).first().click();
      await waitForCall("turn_on", "matrix press");
    } else if (style === "rotary") {
      const before = await page.evaluate(
        () =>
          +card.shadowRoot.querySelector(".brightness-slider-rotary").value,
      );
      await page.locator(`${lamp} .brightness-rotary-wrapper`).hover();
      await page.mouse.wheel(0, -100);
      const after = await page.evaluate(
        () =>
          +card.shadowRoot.querySelector(".brightness-slider-rotary").value,
      );
      // One notch is one step (inline handlers stepped twice: dial + container).
      assert.equal(after - before, 5, "rotary: one wheel notch = +5");
      await waitForCall("turn_on", "rotary wheel");
      await reset();
      await page.locator(`${lamp} .brightness-rotary-container`).click();
      await waitForCall("turn_on", "rotary press");
    } else if (style === "capsule") {
      const value = page.locator(
        `${lamp} .brightness-capsule-input[type="number"]`,
      );
      await value.click();
      assert.equal(
        await page.evaluate(() => card._slBrightnessTyping),
        true,
        "capsule: typing flag on focus",
      );
      await value.fill("40");
      await value.press("Enter");
      const data = await waitForCall("turn_on", "capsule typed value");
      assert.equal(data.brightness, 102); // 40% on the 3-255 curve
      assert.equal(
        await page.evaluate(() => card._slBrightnessTyping),
        false,
      );
    }
  }

  // --- Lamp Preview: a dragged brightness holds until the lamp reports it ---
  await page.evaluate(
    (tag) =>
      mount(tag, {
        entity: "light.a",
        show_brightness: true,
        slider_style: "slider",
        show_device_orientation: false,
      }),
    lamp,
  );
  await page.locator(`${lamp} input.brightness-slider`).first().fill("40");
  assert.equal(
    (await waitForCall("turn_on", "preview drag")).brightness,
    102,
  );
  const shown = () =>
    page.evaluate(
      () => +card.shadowRoot.querySelector("input.brightness-slider").value,
    );
  const push = (brightness) =>
    page.evaluate(async (brightness) => {
      const light = hass.states["light.a"];
      hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            ...light,
            attributes: { ...light.attributes, brightness },
          },
        },
      };
      card.hass = hass;
      await new Promise((resolve) => setTimeout(resolve, 400)); // render debounce
    }, brightness);
  await push(128); // an older state arriving after the commit
  assert.equal(
    await shown(),
    40,
    "preview: older lamp state must not jump the slider back",
  );
  await push(102); // the lamp reports the new value: the draft is dropped
  assert.equal(
    await page.evaluate(() => card._lampSliders.value("brightness")),
    null,
  );
  assert.equal(await shown(), 40);
  await push(26); // later changes (another card, automation) show again
  assert.equal(await shown(), 10);
  // A fade from elsewhere (an automation): every step shows as it arrives.
  const fade = [];
  for (const brightness of [51, 77, 128, 179, 230]) {
    await push(brightness);
    fade.push(await shown());
  }
  assert.deepEqual(fade, [20, 30, 50, 70, 90], "preview: every step of a fade shows");

  // --- Orientation: Lamp Preview and Native (inside the mode controls) -----
  await page.evaluate(
    (tag) => mount(tag, { entity: "light.a", show_device_orientation: true }),
    lamp,
  );
  await page.locator(`${lamp} .orient-btn[data-value="down"]`).click();
  assert.equal(
    (await waitForCall("set_device_orientation", "lamp orientation"))
      .orientation,
    "down",
  );
  for (const tag of ["yeelight-cube-native-effects-card"]) {
    await page.evaluate(
      (tag) =>
        mount(tag, {
          entity: "light.a",
          show_device_orientation: true,
          show_actions: true,
        }),
      tag,
    );
    await page
      .locator(`${tag} .orient-btn[data-value="left"]`)
      .first()
      .click();
    assert.equal(
      (await waitForCall("set_device_orientation", `${tag} orientation`))
        .orientation,
      "left",
    );
  }

  // --- Native / Clock brightness sliders -------------------------------------
  for (const tag of [
    "yeelight-cube-clock-card",
    "yeelight-cube-native-effects-card",
  ]) {
    await page.evaluate(
      (tag) =>
        mount(tag, {
          entity: "light.a",
          show_brightness: true,
          show_brightness_slider: true,
          slider_step_buttons: true,
        }),
      tag,
    );
    const step = page
      .locator(`${tag} .rotary-step-btn[title^="Increase"]`)
      .first();
    await step.click();
    await waitForCall("turn_on", `${tag} brightness step`);
  }
};
