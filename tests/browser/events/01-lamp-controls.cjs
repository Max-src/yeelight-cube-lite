// Card events check (tests/card-events-browser.cjs): the Lamp Preview's
// sliders and orientation, the Native / Clock brightness.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, waitForCall, reset, lamp, SLIDER_STYLES } = t;
  // --- Every slider style on the Lamp Preview --------------------------------
  // The ends (tapped: one step) beside a Slider or Bar and inside the
  // Capsule; the other styles have none. Its older step-button option still
  // turns them on (slider-control-utils.js withSliderOptions).
  const END = `.brightness-end[title^="Increase"], .capsule-icon-button[title^="Increase"]`;
  for (const style of SLIDER_STYLES) {
    await page.evaluate(
      ({ tag, style }) =>
        mount(tag, {
          entity: "light.a",
          show_brightness_slider: true,
          brightness_slider_style: style,
          brightness_step_buttons: true,
          show_device_orientation: false,
        }),
      { tag: lamp, style },
    );
    const ends = page.locator(`${lamp} :is(${END})`);
    if (["slider", "bar", "capsule"].includes(style)) {
      await ends.first().click();
      await waitForCall("turn_on", `${style} end`);
      await reset();
    } else assert.equal(await ends.count(), 0, `${style}: no ends`);

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
      // Its icons are the ends: the left one steps down by the step size.
      await page.evaluate(
        (tag) =>
          mount(tag, {
            entity: "light.a",
            show_brightness_slider: true,
            slider_style: "capsule",
            slider_ends: "icons",
            slider_step_size: 10,
            show_device_orientation: false,
          }),
        lamp,
      );
      const before = await page.evaluate(
        () => +card.shadowRoot.querySelector(".capsule-input").value,
      );
      await page
        .locator(`${lamp} .capsule-icon-button[title^="Decrease"]`)
        .click();
      await waitForCall("turn_on", "capsule icon end");
      assert.equal(
        await page.evaluate(
          () => +card.shadowRoot.querySelector(".capsule-input").value,
        ),
        Math.max(1, before - 10),
        "capsule: an icon steps by the step size",
      );
    }
  }

  // --- A drag past the start reaches 0 on every style that is dragged --------
  for (const [style, target] of [
    ["slider", "input.brightness-slider"],
    ["bar", ".brightness-bar-track"],
    ["capsule", ".capsule-track"],
    ["matrix", ".brightness-matrix-grid"],
  ]) {
    await page.evaluate(
      ({ tag, style }) =>
        mount(tag, {
          entity: "light.a",
          show_brightness: true,
          slider_style: style,
          show_device_orientation: false,
        }),
      { tag: lamp, style },
    );
    const box = await page.locator(`${lamp} ${target}`).first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 40, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    // The drag sends several values; the last one is 0.
    const reached = await page
      .waitForFunction(
        () => calls.some((c) => c.service === "turn_on" && c.data.brightness === 0),
        null,
        { timeout: 3000 },
      )
      .then(() => true, () => false);
    assert.ok(reached, `${style}: a drag past the start sends 0`);
    await reset();
  }

  // --- An end tap: the thumb stays where it landed after the card redraws ----
  await page.evaluate(
    (tag) =>
      mount(tag, {
        entity: "light.a",
        show_brightness: true,
        slider_style: "capsule",
        slider_ends: "plus_minus",
        show_device_orientation: false,
      }),
    lamp,
  );
  await page.locator(`${lamp} .capsule-icon-button[title^="Increase"]`).click();
  await waitForCall("turn_on", "capsule + tap");
  const thumbAt = () =>
    page.evaluate(() => [
      +card.shadowRoot.querySelector(".capsule-input").value,
      parseFloat(
        card.shadowRoot
          .querySelector(".capsule-thumb")
          .style.getPropertyValue("--capsule-percent"),
      ),
    ]);
  const [tapped, drawn] = await thumbAt();
  // A redraw (as when the lamp state arrives) draws the same position.
  await page.evaluate(async () => {
    card._stableSliderMarkup = {};
    card.requestUpdate();
    await card.updateComplete;
  });
  const [, redrawn] = await thumbAt();
  assert.ok(
    Math.abs(drawn - tapped) < 1e-6 && Math.abs(redrawn - tapped) < 1e-6,
    `capsule: the thumb stays at ${tapped} (live ${drawn}, redrawn ${redrawn})`,
  );
  await reset();

  // --- Brightness 0 is sent as 0 (Home Assistant turns the light off) -------
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
  await page.locator(`${lamp} input.brightness-slider`).first().fill("0");
  assert.equal((await waitForCall("turn_on", "brightness 0")).brightness, 0);
  await reset();

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

  // --- Lamp Preview: the preview follows a held brightness drag ------------
  // The lamp dims as the drag goes (each commit is sent): the preview must
  // too, before the release and before the lamp reports anything.
  await page.evaluate(
    (tag) => {
      const light = hass.states["light.a"];
      hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            ...light,
            attributes: {
              ...light.attributes,
              brightness: 255,
              matrix_colors: new Array(100).fill([255, 255, 255]),
            },
          },
        },
      };
      mount(tag, {
        entity: "light.a",
        show_brightness: true,
        slider_style: "slider",
        show_device_orientation: false,
      });
    },
    lamp,
  );
  const dot = () =>
    page.evaluate(() => card._getLampDots()[0].style.backgroundColor);
  // The card's first paint (after its render).
  await page.waitForFunction(() => {
    const color = card._getLampDots?.()[0]?.style.backgroundColor;
    return !!color && color !== "rgb(0, 0, 0)";
  });
  const bright = await dot();
  const track = await page
    .locator(`${lamp} input.brightness-slider`)
    .first()
    .boundingBox();
  const y = track.y + track.height / 2;
  await page.mouse.move(track.x + track.width - 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.6, y, { steps: 4 });
  const middle = await dot();
  await page.mouse.move(track.x + track.width * 0.2, y, { steps: 4 });
  const dim = await dot();
  assert.equal(await page.evaluate(() => card._gate.held("slider")), true);
  assert.notEqual(middle, bright, "preview: dims while the slider is held");
  assert.notEqual(dim, middle, "preview: keeps following the drag");
  await page.mouse.up();
  await waitForCall("turn_on", "preview live drag");
  await reset();

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
          slider_ends: "plus_minus",
        }),
      tag,
    );
    const step = page.locator(`${tag} :is(${END})`).first();
    await step.click();
    await waitForCall("turn_on", `${tag} brightness step`);
    await reset();

    // Its current preview follows a held brightness drag, like the lamp.
    await page.evaluate(
      (tag) =>
        mount(tag, {
          entity: "light.a",
          show_brightness: true,
          slider_style: "slider",
          preview_brightness: true,
        }),
      tag,
    );
    const light = () =>
      page.evaluate(() => {
        const preview = card.shadowRoot.querySelector(
          '[data-clock-preview][data-current="1"], .current-matrix',
        );
        // An animated preview is on a canvas (matrixSurface).
        const canvas = preview?.querySelector("canvas");
        if (canvas) {
          const { width, height } = canvas;
          return canvas
            .getContext("2d")
            .getImageData(0, 0, width, height)
            .data.reduce((sum, value, at) => (at % 4 === 3 ? sum : sum + value), 0);
        }
        const cells = preview?._cells || Array.from(
          preview?.querySelectorAll("[style*='background']") || [],
        );
        // Total light of the preview: the sum of its cells' channels.
        return cells.reduce((sum, cell) => {
          const rgb = (cell.style.backgroundColor.match(/\d+/g) || []).slice(0, 3);
          return sum + rgb.reduce((a, v) => a + +v, 0);
        }, 0);
      });
    const track = await page
      .locator(`${tag} input.brightness-slider`)
      .first()
      .boundingBox();
    const y = track.y + track.height / 2;
    // The card's first paint (after its render).
    await page.waitForFunction(() => {
      const preview = card.shadowRoot.querySelector(
        '[data-clock-preview][data-current="1"], .current-matrix',
      );
      if (preview?.querySelector("canvas")) return true;
      const cells = preview?._cells || Array.from(
        preview?.querySelectorAll("[style*='background']") || [],
      );
      return cells.some((cell) => /[1-9]/.test(cell.style.backgroundColor));
    });
    const before = await light();
    await page.mouse.move(track.x + track.width - 2, y);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.1, y, { steps: 6 });
    const during = await light();
    assert.equal(await page.evaluate(() => card._gate.held("slider")), true);
    assert.ok(before > 0, `${tag}: preview painted`);
    assert.ok(during < before, `${tag}: preview dims while the slider is held`);
    await page.mouse.up();
    await waitForCall("turn_on", `${tag} live drag`);
  }
};
