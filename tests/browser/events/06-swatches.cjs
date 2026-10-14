// Card events check (tests/card-events-browser.cjs): the shared swatches and
// the drag-to-reorder engine.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, waitForCall } = t;
  // --- Shared swatches (yc-swatches.js): one behaviour everywhere ----------
  const swatchesView = () =>
    page.evaluate(() => {
      const swatches = document.querySelector("main yc-swatches");
      const root = swatches.shadowRoot;
      return {
        count: root.querySelectorAll("[data-index]").length,
        pressed: [...root.querySelectorAll('[aria-pressed="true"]')].map(
          (node) => node.getAttribute("aria-label"),
        ),
        hint: root.querySelector(".hint")?.textContent.trim() ?? null,
      };
    });
  const mountSwatches = (props) =>
    page.evaluate(async (props) => {
      const main = document.querySelector("main");
      main.replaceChildren();
      const swatches = document.createElement("yc-swatches");
      window.picked = [];
      window.bubbled = 0;
      if (!window.countsClicks) {
        window.countsClicks = true;
        main.addEventListener("click", () => window.bubbled++);
      }
      swatches.addEventListener("yc-swatch-select", (event) =>
        picked.push(event.detail),
      );
      Object.assign(
        swatches,
        {
          onSelect: (hex, index) =>
            picked.push({ via: "onSelect", hex, index }),
        },
        props,
      );
      main.append(swatches);
      await swatches.updateComplete;
    }, props);
  const eight = [
    [255, 0, 0],
    "#00ff00",
    "rgb(0, 0, 255)",
    "#ffff00",
    "#ff00ff",
    "#00ffff",
    "#000000",
    "#ffffff",
  ];
  // A click and a key pick the same color (hex), once each way; the
  // picking click stays inside; the active color is marked.
  await mountSwatches({
    colors: eight,
    selectable: true,
    info: "name",
    active: "#ff0000",
  });
  assert.deepEqual(await swatchesView(), {
    count: 8,
    pressed: ["red"],
    hint: "",
  });
  await page.locator("main yc-swatches [data-index='2']").click();
  assert.deepEqual(await page.evaluate(() => [picked, bubbled]), [
    [
      { via: "onSelect", hex: "#0000ff", index: 2 },
      { color: "#0000ff", index: 2 },
    ],
    0,
  ]);
  assert.equal((await swatchesView()).hint, "blue");
  await page.locator("main yc-swatches [data-index='1']").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => picked.at(-1).color), "#00ff00");
  // One Tab stop: arrow keys, Home and End move it; Enter picks.
  const tabStops = () =>
    page.evaluate(() =>
      [
        ...document
          .querySelector("main yc-swatches")
          .shadowRoot.querySelectorAll('[tabindex="0"]'),
      ].map((node) => node.dataset.index),
    );
  assert.deepEqual(await tabStops(), ["1"]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => picked.at(-1).color), "#ffff00");
  await page.keyboard.press("End");
  assert.deepEqual(await tabStops(), ["7"]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Home");
  await page.keyboard.press(" ");
  assert.equal(await page.evaluate(() => picked.at(-1).color), "#ff0000");
  assert.deepEqual(await tabStops(), ["0"]);
  // Expand: five, then +3 shows the rest (and never picks).
  await mountSwatches({ colors: eight, selectable: true, layout: "expand" });
  assert.equal((await swatchesView()).count, 5);
  await page.locator('main yc-swatches [data-action="expand"]').click();
  assert.equal((await swatchesView()).count, 8);
  assert.equal(await page.evaluate(() => picked.length), 0);
  // Gradient: its ticks pick the stops; free pick anywhere on the bar.
  await mountSwatches({
    colors: ["#000000", "#ffffff"],
    selectable: true,
    layout: "gradient",
    freePick: true,
  });
  const blend = await page.locator("main yc-swatches .bar").boundingBox();
  await page.mouse.click(
    blend.x + blend.width / 2,
    blend.y + blend.height / 2,
  );
  assert.deepEqual(await page.evaluate(() => picked.at(-1)), {
    color: "#808080",
    index: -1,
  });
  // Every layout picks through its own areas (gradient and fill: ticks).
  for (const layout of [
    "grid",
    "scroll",
    "fan",
    "wave",
    "spiral",
    "gradient",
    "stripes",
    "fill",
    "honeycomb",
    "blinds",
    "treemap",
  ]) {
    await mountSwatches({ colors: eight, selectable: true, layout });
    assert.equal(
      (await swatchesView()).count,
      8,
      `${layout}: a button per color`,
    );
    await page.locator("main yc-swatches [data-index='3']").click();
    assert.equal(
      await page.evaluate(() => picked.at(-1)?.color),
      "#ffff00",
      `${layout}: pick`,
    );
  }
  // A preview (not selectable): no buttons, clicks reach the host.
  await mountSwatches({ colors: eight, layout: "row" });
  assert.equal((await swatchesView()).count, 0);
  await page.locator("main yc-swatches").click();
  assert.deepEqual(
    await page.evaluate(() => [picked.length, bubbled]),
    [0, 1],
  );
  // Draw's color sections: the shared swatches with the card's options
  // (former names included); a pick is the drawing color.
  await page.evaluate(() =>
    mount("yeelight-cube-draw-card", {
      entity: "light.a",
      show_pixelart_gallery: false,
      show_recent_colors: false,
      show_lamp_colors: false,
      show_image_palette: false,
      palette_card_mode: "side",
      palette_display_mode: "honeycomb",
      color_info_display: "hex",
    }),
  );
  const drawSwatches = "yeelight-cube-draw-card yc-swatches";
  assert.equal(
    await page.locator(drawSwatches).getAttribute("layout"),
    "honeycomb",
  );
  await page.locator(`${drawSwatches} [data-index='1']`).click();
  assert.equal(await page.evaluate(() => card.selectedColor), "#0000ff");
  await page.waitForFunction(
    (selector) =>
      document
        .querySelector("main")
        .firstElementChild.shadowRoot.querySelector("yc-swatches")
        .shadowRoot.querySelector('[aria-pressed="true"]')
        ?.getAttribute("aria-label") === "#0000ff",
    drawSwatches,
  );

  // --- Drag to reorder: one engine (reorder-drag.js), mouse and touch ------
  // Where a user grabs `item`: the point nearest its centre where a press
  // reaches the item itself, not a control inside it (a hex field, a
  // button), after hovering it (hover styles move things). Never the bare
  // centre: Linux's wider monospace font put the rows' hex field there and
  // the press started no drag (CI only).
  const grabPoint = async (item) => {
    const box = await item.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(50);
    const point = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const root = el.getRootNode();
      const controls =
        "input, button, select, textarea, [contenteditable], a";
      let best = null;
      for (let ix = 1; ix < 20; ix++)
        for (let iy = 1; iy < 8; iy++) {
          const x = r.left + (r.width * ix) / 20;
          const y = r.top + (r.height * iy) / 8;
          const hit = root.elementFromPoint(x, y);
          if (
            !hit ||
            !(hit === el || el.contains(hit)) ||
            hit.closest(controls)
          )
            continue;
          const d = Math.hypot(
            x - (r.left + r.width / 2),
            y - (r.top + r.height / 2),
          );
          if (!best || d < best.d) best = { x, y, d };
        }
      return best && { x: best.x, y: best.y };
    });
    assert.ok(point, "drag test: no grabbable point on the item");
    return point;
  };
  // A mouse drag of `from` (grabbed like a user would) to the far part of
  // `to` (after it).
  const mouseDrag = async (from, to, side = 0.8) => {
    const a = await grabPoint(from);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 8, a.y + 2, { steps: 2 });
    const b = await to.boundingBox();
    await page.mouse.move(b.x + b.width * side, b.y + b.height * side, {
      steps: 10,
    });
    await page.waitForTimeout(60);
    await page.mouse.up();
    return a;
  };
  // A finger drag (Pointer Events of type touch) on `selector` items, from
  // `from` (or its handle) to the far part of `to`.
  const touchDrag = (root, selector, from, to, handle = null) =>
    page.evaluate(
      async ({ root, selector, from, to, handle }) => {
        const host = document.querySelector("main").firstElementChild;
        const scope = root === "host" ? host.shadowRoot : document;
        const items = [...scope.querySelectorAll(selector)];
        const start = handle
          ? items[from].querySelector(handle)
          : items[from];
        const a = start.getBoundingClientRect();
        const b = items[to].getBoundingClientRect();
        const send = (type, x, y, target = window) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: "touch",
              isPrimary: true,
              button: 0,
              bubbles: true,
              composed: true,
              clientX: x,
              clientY: y,
            }),
          );
        const x0 = a.left + a.width / 2;
        const y0 = a.top + a.height / 2;
        send("pointerdown", x0, y0, start);
        for (let step = 1; step <= 10; step++) {
          send(
            "pointermove",
            x0,
            y0 + ((b.top + b.height * 0.8 - y0) * step) / 10,
          );
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        send("pointerup", x0, b.top + b.height * 0.8);
        await host.updateComplete;
      },
      { root, selector, from, to, handle },
    );
  // Color List: every layout, the first color dragged (from where a user
  // grabs it: the item, a label, a tile's handle) after the third.
  await page.evaluate(() => {
    window.savedTextColors = hass.states["light.a"].attributes.text_colors;
    hass.states["light.a"].attributes.text_colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ];
  });
  const colorList = "yeelight-cube-color-list-editor-card";
  for (const [layout, selector, grab, extra = {}] of [
    ["rows", ".row-item", ".row-item"],
    ["chips", ".chip-item", ".chip-content"],
    ["tiles", ".tile-item", ".tile-drag-area"],
    ["compact", ".compact-item", ".compact-color-name"],
    ["grid", ".color-grid-item", ".color-grid-info"],
    [
      "cards",
      ".card-wrapper .card-item",
      ".card-item",
      { card_arrangement: "spread" },
    ],
    [
      "cards",
      ".card-wrapper .card-item",
      ".card-item",
      { card_arrangement: "hand" },
    ],
  ]) {
    await page.evaluate(({ tag, config }) => mount(tag, config), {
      tag: colorList,
      config: { entity: "light.a", list_layout: layout, ...extra },
    });
    // The colors shown (the card keeps its last saved order until the
    // lamp echoes it).
    const [c0, c1, c2, c3] = await page.evaluate(() => card._renderedColors);
    const items = page.locator(`${colorList} ${selector}`);
    await mouseDrag(
      page.locator(`${colorList} ${grab}`).first(),
      items.nth(2),
    );
    const saved = await waitForCall(
      "set_text_colors",
      `color list ${layout} ${extra.card_arrangement || ""}`,
    );
    assert.deepEqual(
      saved.text_colors,
      [c1, c2, c0, c3],
      `color list ${layout} ${extra.card_arrangement || ""}: dragged order`,
    );
  }
  // Fan: the cards overlap; the card under the pointer is the one dragged
  // (and the only one that moves).
  await page.evaluate(
    ({ tag }) =>
      mount(tag, {
        entity: "light.a",
        list_layout: "cards",
        card_arrangement: "fan",
      }),
    { tag: colorList },
  );
  const fanCards = page.locator(`${colorList} .card-wrapper .card-item`);
  const fanShown = await page.evaluate(() => card._renderedColors);
  // The card the press actually lands on (hover re-stacks the fan).
  await page.evaluate(() => {
    window.pressedCard = null;
    window.addEventListener(
      "pointerdown",
      (event) => {
        const wrapper = event.composedPath()[0].closest?.(".card-wrapper");
        window.pressedCard = wrapper
          ? Number(wrapper.dataset.position)
          : null;
      },
      { capture: true, once: true },
    );
  });
  await mouseDrag(fanCards.nth(0), fanCards.nth(3));
  const grabbed = await page.evaluate(() => window.pressedCard);
  assert.ok(
    Number.isInteger(grabbed),
    "color list fan: the press landed on a card",
  );
  const fanSaved = (await waitForCall("set_text_colors", "color list fan"))
    .text_colors;
  const without = (list, color) =>
    list.filter((c) => c.join() !== color.join()).map((c) => c.join());
  assert.notDeepEqual(fanSaved, fanShown, "color list fan: reordered");
  assert.deepEqual(
    without(fanSaved, fanShown[grabbed]),
    without(fanShown, fanShown[grabbed]),
    "color list fan: only the grabbed card moved",
  );
  // A finger drags too (the first color before the third, rows).
  await page.evaluate(
    ({ tag }) => mount(tag, { entity: "light.a", list_layout: "rows" }),
    { tag: colorList },
  );
  const [t0, t1, t2, t3] = await page.evaluate(() => card._renderedColors);
  await touchDrag("host", ".row-item", 0, 2);
  assert.deepEqual(
    (await waitForCall("set_text_colors", "color list touch")).text_colors,
    [t1, t2, t0, t3],
  );
  // A press without a move is no drag: nothing saved.
  await page.evaluate(() => (calls.length = 0));
  await page
    .locator(`${colorList} .row-item`)
    .first()
    .dispatchEvent("pointerdown", {
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
    });
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(
      () => calls.filter((c) => c.service === "set_text_colors").length,
    ),
    0,
  );
  await page.evaluate(
    () => (hass.states["light.a"].attributes.text_colors = savedTextColors),
  );
  // Editors: the shared ordered list (here Draw's tools order) by mouse
  // anywhere on a row, by finger on its handle; buttons never drag.
  const drawEditor = () =>
    page.evaluate(async () => {
      const editor = await customElements
        .get("yeelight-cube-draw-card")
        .getConfigElement();
      editor.hass = hass;
      editor.setConfig({
        type: "custom:yeelight-cube-draw-card",
        entity: "light.a",
      });
      document.querySelector("main").replaceChildren(editor);
      window.editorConfig = null;
      editor.addEventListener(
        "config-changed",
        (event) => (editorConfig = event.detail.config),
      );
      await editor.updateComplete;
      editor._open = { tools: true };
      await editor.updateComplete;
    });
  await drawEditor();
  const toolRows = page
    .locator("yeelight-cube-draw-card-editor .orderable-list")
    .filter({
      has: page.locator(".orderable-list-name", { hasText: /^Pencil$/ }),
    })
    .locator(".orderable-list-row");
  assert.deepEqual(
    (await toolRows.allTextContents())
      .map((text) => text.replace(/[⋮⤒▲▼⤓✕\s]+/g, " ").trim())
      .slice(0, 3),
    ["Color", "Pick", "Pencil"],
  );
  await mouseDrag(toolRows.nth(0), toolRows.nth(2));
  assert.deepEqual(
    (await page.evaluate(() => editorConfig?.tools_order))?.slice(0, 3),
    ["eyedropper", "pencil", "colorPicker"],
    "draw editor: tools order by mouse",
  );
  await page.evaluate(() => (editorConfig = null));
  await page.evaluate(async () => {
    const editor = document.querySelector("main").firstElementChild;
    const rows = [
      ...editor.shadowRoot.querySelectorAll(".orderable-list-row"),
    ].filter(
      (row) =>
        /Pencil|Pick|Color|Eraser/.test(row.textContent) &&
        !row.querySelector(".collection-thumb"),
    );
    window.toolRowIndex = [
      ...editor.shadowRoot.querySelectorAll(".orderable-list-row"),
    ].indexOf(rows[0]);
  });
  const firstToolRow = await page.evaluate(() => toolRowIndex);
  await touchDrag(
    "host",
    ".orderable-list-row",
    firstToolRow,
    firstToolRow + 2,
    ".orderable-drag-handle",
  );
  assert.deepEqual(
    (await page.evaluate(() => editorConfig?.tools_order))?.slice(0, 3),
    ["pencil", "colorPicker", "eyedropper"],
    "draw editor: tools order by touch (handle)",
  );
};
