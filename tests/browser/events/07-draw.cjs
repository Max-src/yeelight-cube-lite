// Card events check (tests/card-events-browser.cjs): the Draw card: Preview
// Hover, the tools shown and their order.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  // --- Draw "Preview Hover" (<yc-preview-hover>) ---------------------------
  const hoverDraw = (overlay) =>
    page.evaluate(
      (overlay) =>
        mount("yeelight-cube-draw-card", {
          entity: "light.a",
          show_pixelart_gallery: false,
          palette_card_mode: "preview-hover",
          colors_preview_overlay: overlay,
        }),
      overlay,
    );
  // Every frame while `act` runs and the motion settles: the room the
  // section takes (stack), the panel's box and whether its content fits.
  const sampleHover = (act) =>
    page.evaluate(async (act) => {
      const root =
        card.shadowRoot.querySelector("yc-preview-hover").shadowRoot;
      const frames = [];
      let sampling = true;
      const sample = () => {
        const panel = root.querySelector(".panel");
        // The content (the panel's title fades in above it).
        const box = panel
          ?.querySelector(".panel-content")
          .getBoundingClientRect();
        frames.push({
          stack: root.querySelector(".stack").getBoundingClientRect().height,
          panel: box && { left: box.left, top: box.top, width: box.width },
          fits: !panel || panel.scrollHeight <= panel.clientHeight + 1,
        });
        if (sampling) requestAnimationFrame(sample);
      };
      const target = root.querySelector(`.preview[data-key="${act.key}"]`);
      const preview = target.getBoundingClientRect();
      target.dispatchEvent(
        new PointerEvent(act.type, {
          pointerType: act.pointer || "mouse",
          bubbles: true,
          composed: true,
        }),
      );
      sample();
      await new Promise((resolve) => setTimeout(resolve, act.wait || 700));
      // A slow machine: the motion may still run; wait for its end.
      await Promise.all(
        root
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      sampling = false;
      return {
        frames,
        preview: {
          left: preview.left,
          top: preview.top,
          width: preview.width,
        },
      };
    }, act);
  // Wait for the component's motion to end.
  const settleHover = () =>
    page.evaluate(async () => {
      const root =
        card.shadowRoot.querySelector("yc-preview-hover").shadowRoot;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.all(
        root
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  const hoverState = () =>
    page.evaluate(() => {
      const root =
        card.shadowRoot.querySelector("yc-preview-hover").shadowRoot;
      return {
        open:
          root.querySelector('.preview[aria-expanded="true"]')?.dataset.key ||
          null,
        heights: [...root.querySelectorAll(".preview")].map((node) =>
          Math.round(node.getBoundingClientRect().height),
        ),
        keys: [...root.querySelectorAll(".preview")].map(
          (node) => node.dataset.key,
        ),
        empty: [...root.querySelectorAll(".preview.empty")].map(
          (node) => node.dataset.key,
        ),
        stack: Math.round(
          root.querySelector(".stack").getBoundingClientRect().height,
        ),
        panel:
          root
            .querySelector(".panel:not(.closing) .title")
            ?.textContent.trim() || null,
        below: Math.round(
          card.shadowRoot
            .querySelector(".palettes")
            .nextElementSibling?.getBoundingClientRect().top ?? 0,
        ),
      };
    });
  const steady = (values, rising) =>
    values.every(
      (value, i) =>
        i === 0 ||
        (rising
          ? value >= values[i - 1] - 0.5
          : value <= values[i - 1] + 0.5),
    );
  const moving = (values) =>
    values.filter((value, i) => i && Math.abs(value - values[i - 1]) > 0.1)
      .length;
  // In place: every closed preview the same height (empty ones too).
  await hoverDraw(false);
  const closed = await hoverState();
  assert.ok(
    closed.empty.length > 0,
    "preview hover: an empty section to check",
  );
  assert.ok(
    closed.heights.every((h) => h > 0 && h === closed.heights[0]),
    `preview hover: closed heights ${closed.heights}`,
  );
  // Each section (the last one too) opens from its own preview: the
  // panel's first frame lies on it (no jump), then the room opens steadily.
  for (const key of closed.keys.filter(
    (key) => !closed.empty.includes(key),
  )) {
    const { frames, preview } = await sampleHover({
      type: "pointerenter",
      key,
    });
    const first = frames.find((frame) => frame.panel)?.panel;
    assert.ok(
      Math.abs(first.left - preview.left) < 1 &&
        Math.abs(first.top - preview.top) < 1 &&
        Math.abs(first.width - preview.width) < 1.5,
      `preview hover ${key}: starts on its preview (${JSON.stringify([first, preview])})`,
    );
    const room = frames.map((frame) => frame.stack);
    assert.ok(
      room.at(-1) > closed.stack + 10 &&
        steady(room, true) &&
        moving(room) >= 5,
      `preview hover ${key}: opens steadily`,
    );
    const panelLefts = frames
      .filter((frame) => frame.panel)
      .map((frame) => frame.panel.left);
    assert.ok(
      steady(panelLefts, key !== closed.keys[0] ? false : true),
      `preview hover ${key}: one direction only`,
    );
    assert.equal((await hoverState()).open, key);
    const closing = (
      await sampleHover({ type: "pointerleave", key })
    ).frames.map((frame) => frame.stack);
    assert.ok(
      steady(closing, false) && moving(closing) >= 5,
      `preview hover ${key}: closes steadily`,
    );
    assert.equal(
      (await hoverState()).stack,
      closed.stack,
      `preview hover ${key}: closed again`,
    );
  }
  // The open section picks colors.
  await sampleHover({ type: "pointerenter", key: "lamp", wait: 450 });
  await page
    .locator(
      "yeelight-cube-draw-card yc-preview-hover .panel yc-swatches [data-index='1']",
    )
    .click();
  assert.equal(await page.evaluate(() => card.selectedColor), "#0000ff");
  await sampleHover({ type: "pointerleave", key: "lamp" });
  // An empty section opens and closes without ever going blank.
  const emptyKey = closed.empty[0];
  const emptyFrames = [
    ...(await sampleHover({ type: "pointerenter", key: emptyKey })).frames,
    ...(await sampleHover({ type: "pointerleave", key: emptyKey })).frames,
  ].map((frame) => frame.stack);
  assert.ok(
    Math.min(...emptyFrames) >= closed.stack - 0.5,
    `preview hover: empty section never blank (${Math.min(...emptyFrames)})`,
  );
  // The open section disappears (hidden on the card): nothing stays open.
  await sampleHover({
    type: "click",
    key: "lamp",
    pointer: "touch",
    wait: 450,
  });
  assert.deepEqual(
    await page.evaluate(async () => {
      const host = card.shadowRoot.querySelector("yc-preview-hover");
      host.sections = host.sections.filter(
        (section) => section.key !== "lamp",
      );
      await host.updateComplete;
      const root = host.shadowRoot;
      return [
        !!root.querySelector(".panel"),
        root.querySelector(".stack").classList.contains("covered"),
      ];
    }),
    [false, false],
    "preview hover: a removed open section closes",
  );
  await hoverDraw(false);
  // A finger (or a click) toggles; a tap outside closes; Enter / Escape.
  await sampleHover({
    type: "click",
    key: "lamp",
    pointer: "touch",
    wait: 450,
  });
  assert.equal((await hoverState()).open, "lamp", "preview hover: tap opens");
  await page.evaluate(() =>
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, composed: true }),
    ),
  );
  await settleHover();
  assert.equal(
    (await hoverState()).open,
    null,
    "preview hover: tap outside closes",
  );
  await page
    .locator(
      'yeelight-cube-draw-card yc-preview-hover .preview[data-key="lamp"]',
    )
    .focus();
  await page.keyboard.press("Enter");
  assert.equal(
    (await hoverState()).open,
    "lamp",
    "preview hover: Enter opens",
  );
  await page.keyboard.press("Escape");
  await settleHover();
  assert.equal(
    (await hoverState()).open,
    null,
    "preview hover: Escape closes",
  );
  // Overlay: nothing moves; switching previews never cuts the content.
  await hoverDraw(true);
  const still = await hoverState();
  await sampleHover({ type: "pointerenter", key: "lamp" });
  const over = await hoverState();
  assert.equal(
    over.panel,
    "Lamp Palette",
    "overlay: the panel shows the section",
  );
  assert.deepEqual(
    [over.stack, over.below],
    [still.stack, still.below],
    "overlay: nothing moves",
  );
  for (const key of [emptyKey, "lamp", "lampcolors"].filter((key) =>
    still.keys.includes(key),
  )) {
    const { frames } = await sampleHover({
      type: "pointerenter",
      key,
      wait: 400,
    });
    assert.ok(
      frames.every((frame) => frame.fits),
      `overlay ${key}: the content is never cut`,
    );
  }
  assert.notEqual(
    (await hoverState()).panel,
    null,
    "overlay: still open while switching",
  );
  await sampleHover({ type: "pointerleave", key: "lamp", wait: 650 });
  assert.equal(
    await page.evaluate(() =>
      card.shadowRoot
        .querySelector("yc-preview-hover")
        .shadowRoot.querySelector(".panel"),
    ),
    null,
    "overlay: closed (panel gone after its motion)",
  );

  // --- Draw: the tools / actions shown and their order (card config) -------
  const drawButtons = (config) =>
    page.evaluate(async (config) => {
      await mount("yeelight-cube-draw-card", { entity: "light.a", show_pixelart_gallery: false, ...config });
      const root = card.shadowRoot;
      return {
        tools: [...root.querySelectorAll(".tool-item")].map((node) => node.dataset.tool),
        actions: [...root.querySelectorAll(".action-item")].map((node) => node.dataset.action),
      };
    }, config);
  assert.deepEqual(
    await drawButtons({ hidden_tools: ["eraser", "undo"], tools_order: ["pencil", "colorPicker"], hidden_actions: ["upload"], actions_order: ["apply", null, "clear"] }),
    {
      tools: ["pencil", "colorPicker", "eyedropper", "areaFill", "fillAll"],
      actions: ["apply", "spacer", "clear", "save"],
    },
    "draw: hidden_tools / hidden_actions and their order",
  );
  // A config from before those options keeps what this browser hid (read
  // once per page: a fresh copy of the module reads it).
  assert.deepEqual(
    await page.evaluate(async () => {
      localStorage.setItem("yeelight-tool-visibility", JSON.stringify({ eraser: false, pencil: true }));
      const tools = await import("/custom_components/yeelight_cube/www/draw_card_tools.js?legacy");
      const result = [tools.hiddenTools({}), tools.hiddenTools({ hidden_tools: [] })];
      localStorage.removeItem("yeelight-tool-visibility");
      return result;
    }),
    [["eraser"], []],
    "draw: the former per-browser visibility, until the config has its own",
  );
  // The editor: the shared ordered list shows / hides and orders.
  assert.deepEqual(
    await page.evaluate(async () => {
      const editor = await customElements.get("yeelight-cube-draw-card").getConfigElement();
      editor.hass = hass;
      editor.setConfig({ type: "custom:yeelight-cube-draw-card", entity: "light.a" });
      document.querySelector("main").replaceChildren(editor);
      let saved = null;
      editor.addEventListener("config-changed", (event) => (saved = event.detail.config));
      editor._open = { tools: true };
      await editor.updateComplete;
      const list = [...editor.shadowRoot.querySelectorAll(".orderable-list")].find((node) =>
        node.textContent.includes("Pencil"),
      );
      // ✕ on "Pick" hides it.
      [...list.querySelectorAll(".orderable-list-row")]
        .find((row) => row.textContent.includes("Pick"))
        .querySelector("button.remove")
        .click();
      return [saved.hidden_tools, saved.tools_order.at(-1)];
    }),
    [["eyedropper"], "eyedropper"],
    "draw editor: a tool hidden from the list",
  );
};
