// Card events check (tests/card-events-browser.cjs): the Gradient card: angle
// capsule and wheel, the shared tab bar, its modes in the gallery.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, waitForCall, gradient } = t;
  // --- Gradient angle capsule -------------------------------------------------
  await page.evaluate(
    (tag) =>
      mount(tag, {
        entity: "light.a",
        rotary_unified_style: "capsule",
        show_angle_control: true,
      }),
    gradient,
  );
  const capsule = page.locator(
    `${gradient} .angle-capsule-host input.capsule-input`,
  );
  if (await capsule.count()) {
    const box = await capsule.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    await waitForCall("set_angle", "gradient capsule drag");
  } else {
    throw new Error("gradient: angle capsule not rendered");
  }

  // --- Gradient angle wheel: a lamp update never moves the dragged angle;
  // the update it brought is shown once the drag ends ------------------------
  await page.evaluate(
    (tag) => {
      const light = hass.states["light.a"];
      hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": { ...light, attributes: { ...light.attributes, angle: 180 } },
        },
      };
      return mount(tag, {
        entity: "light.a",
        rotary_unified_style: "wheel",
        angle_value_display: "text",
      });
    },
    gradient,
  );
  const wheel = await page
    .locator(`${gradient} #angle-preview`)
    .boundingBox();
  const angleText = () =>
    page.evaluate(() => card.shadowRoot.getElementById("angletext").value);
  assert.equal(await angleText(), "180°", "gradient wheel: the lamp's angle");
  await page.mouse.move(wheel.x + wheel.width - 4, wheel.y + wheel.height / 2);
  await page.mouse.down();
  await page.mouse.move(wheel.x + wheel.width / 2, wheel.y + 4, { steps: 4 });
  const lampUpdate = (angle) =>
    page.evaluate(async (angle) => {
      const light = hass.states["light.a"];
      hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": { ...light, attributes: { ...light.attributes, angle } },
        },
      };
      card.hass = hass;
      await card.updateComplete;
      return card._gate.pending;
    }, angle);
  assert.equal(await lampUpdate(270), true, "gradient wheel: render waits for the drag");
  assert.equal(await angleText(), "90°", "gradient wheel: the dragged angle stays");
  await page.mouse.up();
  assert.equal(
    await page.evaluate(async () => {
      await card.updateComplete;
      return card._gate.pending;
    }),
    false,
    "gradient wheel: the waiting render runs when the drag ends",
  );
  // The release sends the dragged angle at once (no debounce wait) and
  // detaches the drag's document listeners: moving on does nothing.
  assert.equal(
    await page.evaluate(
      () => calls.filter((c) => c.service === "set_angle").at(-1)?.data.angle,
    ),
    90,
    "gradient wheel: the release sends the final angle",
  );
  assert.equal(
    await page.evaluate(() => card._rotaryDocListeners),
    null,
    "gradient wheel: the drag's listeners are removed",
  );
  await page.mouse.move(wheel.x + 4, wheel.y + wheel.height / 2, { steps: 2 });
  assert.equal(await angleText(), "90°", "gradient wheel: moving after the release does nothing");
  // The lamp reports the dragged angle, then another one (an automation):
  // plain updates show it.
  await lampUpdate(90);
  await lampUpdate(45);
  assert.equal(await angleText(), "45°", "gradient wheel: the lamp's new angle");

  // --- The shared tab bar (tab-bar.js), on the Gradient panel tabs: a click
  // and the arrow keys pick a tab; one tab stop, the picked one selected ---
  await page.evaluate(
    (tag) =>
      mount(tag, { entity: "light.a", panel_toggle_style: "tabs" }),
    gradient,
  );
  const tabs = page.locator(`${gradient} .yc-tabs [role="tab"]`);
  assert.equal(await tabs.count(), 2, "tab bar: Pixels and Panel");
  await tabs.nth(1).click();
  await waitForCall("set_full_panel", "tab bar: click");
  const sent = () =>
    page.evaluate(() =>
      calls.filter((c) => c.service === "set_full_panel").map((c) => c.data.full_panel),
    );
  assert.deepEqual(await sent(), [true], "tab bar: the clicked tab's value");
  const state = () =>
    page.evaluate(async () => {
      await card.updateComplete;
      return [...card.shadowRoot.querySelectorAll('.yc-tabs [role="tab"]')].map(
        (tab) => `${tab.getAttribute("aria-selected")}/${tab.tabIndex}`,
      );
    });
  assert.deepEqual(await state(), ["false/-1", "true/0"], "tab bar: the picked tab selected, one tab stop");
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    () => calls.filter((c) => c.service === "set_full_panel").length === 2,
  );
  assert.deepEqual(await sent(), [true, false], "tab bar: arrow keys pick the next tab");
  assert.equal(
    await page.evaluate(() => card.shadowRoot.activeElement?.dataset.tab),
    "pixels",
    "tab bar: focus follows the picked tab",
  );
  // Draw's colors in Tabs mode: the picked tab stays while drawing (a
  // click elsewhere in the card or the page never resets it).
  await page.evaluate(() =>
    mount("yeelight-cube-draw-card", {
      entity: "light.a",
      palette_card_mode: "tabs",
    }),
  );
  const drawTabs = page.locator('yeelight-cube-draw-card .yc-tabs [role="tab"]');
  await drawTabs.nth(1).click();
  const picked = () =>
    page.evaluate(async () => {
      await card.updateComplete;
      return card.shadowRoot.querySelector('.yc-tabs [aria-selected="true"]')?.dataset.tab;
    });
  const second = await picked();
  assert.ok(second && second !== "recent", "draw tabs: a tab picked");
  await page.locator("yeelight-cube-draw-card .tool-item").first().click();
  await page.mouse.click(2, 2);
  assert.equal(await picked(), second, "draw tabs: the picked tab stays");

  // --- Gradient modes through the shared gallery (text layouts) ------------
  for (const style of ["filled", "chips", "dropdown"]) {
    await page.evaluate(
      ({ tag, style }) =>
        mount(tag, { entity: "light.a", style_selector_style: style }),
      { tag: gradient, style },
    );
    await page.waitForTimeout(150);
    const gallery = page.locator(`${gradient} yc-collection-gallery`);
    assert.equal(
      await gallery.locator(".yc-gallery-search").count(),
      0,
      `gradient ${style}: no search box unless enabled`,
    );
    if (style === "dropdown")
      await gallery
        .locator("select.mode-select")
        .selectOption("Radial Gradient");
    else await gallery.locator('[data-mode="Radial Gradient"]').click();
    assert.equal(
      (await waitForCall("set_mode", `gradient ${style} pick`)).mode,
      "Radial Gradient",
    );
  }

  // Panel Color Sequence: offered like every mode, its chip swatch the
  // colors in order (stripes), and picked like the others.
  await page.evaluate(
    (tag) => mount(tag, { entity: "light.a", style_selector_style: "chips" }),
    gradient,
  );
  const panelChip = page.locator(
    `${gradient} yc-collection-gallery [data-mode="Panel Color Sequence"]`,
  );
  assert.equal(await panelChip.locator(".mode-chip-label").textContent(), "Panel Seq");
  assert.match(
    await panelChip.evaluate((chip) => chip.innerHTML),
    /repeating-linear-gradient\(90deg, rgb\(255,0,0\) 0px 6px, rgb\(0,0,255\) 6px 12px\)/,
    "gradient: Panel Color Sequence swatch",
  );
  await panelChip.click();
  assert.equal(
    (await waitForCall("set_mode", "gradient Panel Color Sequence pick")).mode,
    "Panel Color Sequence",
  );
};
