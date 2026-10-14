// Card UI parity check (tests/card-ui-parity.cjs): other-card state, the
// shared preview, failure recovery and reconnect.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

module.exports = async (t) => {
  const { page, errors } = t;
  await page.evaluate(async () => {
    const base = "/custom_components/yeelight_cube/www/";
    for (const name of [
      "gradient",
      "color-list-editor",
      "palette",
      "draw",
      "lamp-preview",
    ])
      await import(`${base}yeelight-cube-${name}-card.js`);
    const section = document.createElement("section");
    section.id = "other-card-regressions";
    section.style.cssText =
      "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px;align-items:start";
    document.body.append(section);
    const frames = async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    };
    const check = (condition, message) => {
      if (!condition) throw Error(message);
    };
    const matrix = Array.from({ length: 100 }, () => [255, 0, 0]);
    const listeners = new Set();
    const serviceCalls = [];
    let failColors = false,
      finishRename;
    const preview = (colors) => ({
      entity_id: "light.a",
      rows: 5,
      cols: 20,
      angle: 0,
      previews: { "Solid Color": colors },
    });
    const state = {
      states: {
        "light.a": {
          state: "on",
          attributes: {
            ...hass.states["light.a"].attributes,
            content_mode: "Solid Color",
            matrix_colors: matrix,
            text_colors: [[255, 0, 0]],
            angle: 0,
            text: "Test",
          },
        },
        "light.b": {
          state: "on",
          attributes: { matrix_colors: matrix, text_colors: [[0, 255, 0]] },
        },
        "sensor.palette": {
          attributes: {
            count: 2,
            content_hash: "palettes",
            palettes_v2: [
              { name: "A", colors: [[255, 0, 0]] },
              { name: "B", colors: [[0, 255, 0]] },
            ],
          },
        },
        "sensor.art": {
          attributes: {
            count: 2,
            content_hash: "arts",
            pixel_arts: [
              { name: "A", pixels: [] },
              { name: "B", pixels: [] },
            ],
          },
        },
      },
      connection: {
        subscribeEvents(callback) {
          listeners.add(callback);
          return Promise.resolve(() => listeners.delete(callback));
        },
      },
      callApi: async (method, path) =>
        state.states[path.slice("states/".length)],
      callService: async (domain, service, data) => {
        serviceCalls.push({ domain, service, data });
        if (service === "preview_gradient_modes")
          listeners.forEach((callback) =>
            callback({ data: preview(matrix) }),
          );
        if (service === "set_text_colors" && failColors)
          throw Error("Test offline");
        if (service === "rename_palette")
          await new Promise((resolve) => {
            finishRename = resolve;
          });
      },
    };
    const config = {
      entity: "light.a",
      target_entities: ["light.a"],
      palette_sensor: "sensor.palette",
      pixelart_sensor: "sensor.art",
    };
    const cards = [];
    const create = async (name, extra = {}) => {
      const card = document.createElement(`yeelight-cube-${name}-card`);
      card.style.cssText = "display:block;min-width:0;max-width:100%";
      card.setConfig({ ...config, ...extra });
      card.hass = state;
      section.append(card);
      cards.push(card);
      await card.updateComplete;
      await frames();
      return card;
    };
    const gradients = [
      await create("gradient", {
        mode_selector_style: "preview-grid",
        show_mode_selector: true,
      }),
      await create("gradient", {
        mode_selector_style: "preview-grid",
        show_mode_selector: true,
      }),
    ];
    gradients.forEach((card) => card._setupPreviewEventListener());
    await Promise.all(gradients.map((card) => card._loadPreviews()));
    check(
      listeners.size === 1,
      "Gradient must share its backend event subscription",
    );
    const updates = [0, 0];
    gradients.forEach((card, index) => {
      const update = card._refreshGallery.bind(card);
      card._refreshGallery = (...args) => {
        updates[index]++;
        update(...args);
      };
    });
    const itemNodes = (card) => [
      ...card.shadowRoot.querySelectorAll("yc-collection-gallery [data-mode]"),
    ];
    const before = gradients.map(itemNodes);
    const green = Array.from({ length: 100 }, () => [0, 255, 0]);
    listeners.forEach((callback) => callback({ data: preview(green) }));
    check(
      updates.every((count) => count === 1),
      "Every Gradient view must refresh",
    );
    await frames();
    check(
      gradients.every(
        (card, index) =>
          before[index].length > 0 &&
          itemNodes(card).every((node, i) => node === before[index][i]),
      ),
      "New Gradient previews repaint in place (no rebuilt items)",
    );
    check(
      gradients.every((card) =>
        itemNodes(card).every(
          (node) =>
            node.querySelector(".gallery-matrix-preview > div").style
              .background === "rgb(0, 255, 0)",
        ),
      ),
      "Repainted Gradient previews show the new colors",
    );
    check(
      gradients.every(
        (card) =>
          card._previewCache().data.previews["Solid Color"][0][1] === 255,
      ),
      "Gradient cache must contain updated colors",
    );
    const colors = await create("color-list-editor", { list_layout: "rows" });
    const notices = [];
    colors.addEventListener("hass-notification", (event) =>
      notices.push(event.detail.message),
    );
    failColors = true;
    check(
      (await colors.saveColors([[0, 0, 255]])) === false,
      "Color save must report failure",
    );
    check(
      notices.includes("Test offline"),
      "Color save failure must be visible",
    );
    check(
      JSON.stringify(colors._getCurrentColors()) ===
        JSON.stringify([[255, 0, 0]]),
      "Color save must roll back",
    );
    const palette = await create("palette", {
      display_mode: "list",
      allow_title_edit: true,
    });
    const rename = palette._renamePalette(0, "Renamed A");
    await Promise.resolve();
    const original = state.states["sensor.palette"].attributes.palettes_v2;
    state.states["sensor.palette"].attributes.palettes_v2 =
      original.toReversed();
    finishRename();
    await rename;
    check(
      state.states["sensor.palette"].attributes.palettes_v2[0].name === "B",
      "Rename must not mutate a new index occupant",
    );
    const draw = await create("draw");
    const hoverDraw = await create("draw", {
      palette_card_mode: "preview-hover",
      show_lamp_palette: true,
      show_lamp_colors: true,
      palette_display_mode: "row",
    });
    hoverDraw.id = "draw-hover-regression";
    for (let frame = 0; frame < 10; frame++) await frames();
    const hoverPreview = hoverDraw.shadowRoot.querySelector(
      "yc-preview-hover",
    );
    check(
      hoverPreview.getBoundingClientRect().width <=
        hoverDraw.getBoundingClientRect().width,
      `Draw hover preview exceeds card width: ${hoverPreview.getBoundingClientRect().width} > ${hoverDraw.getBoundingClientRect().width}`,
    );
    draw._pixelArtStore.pending.record(
      state.states["sensor.art"].attributes.pixel_arts.toReversed(),
    );
    draw.hass = {
      ...state,
      states: {
        ...state.states,
        "light.a": { ...state.states["light.a"], state: "off" },
      },
    };
    check(
      draw.hass.states["light.a"].state === "off",
      "Draw must accept unrelated HA state",
    );
    check(
      draw._pixelArts()[0].name === "B",
      "Draw must retain its pending order",
    );
    const lamp = await create("lamp-preview");
    await lamp.handleEffectChange("contrast", { target: { value: "75" } });
    lamp.setConfig({ entity: "light.b" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    check(
      !serviceCalls.some(
        (call) => call.service === "set_preview_adjustments",
      ),
      "Lamp adjustment must not cross reconfiguration",
    );
    // Slider namespaces are a contract (www/lamp-sliders.js): every card's
    // lamp sliders render with data-sl-ns="brightness", and Clock / Native
    // Effects add "speed"; Lamp Preview has brightness only. The screenshot
    // capture (tests/card-docs-browser.js) also queries sliders by these
    // names, but only runs with a real HA -- assert them here too so a
    // renamed/removed namespace fails `npm run check` (no HA) as well,
    // instead of only in the screenshot CI job. Mount in a throwaway
    // container so these probes stay out of the shared `cards` checks.
    const sliderNamespaces = {
      clock: ["brightness", "speed"],
      "native-effects": ["brightness", "speed"],
      "lamp-preview": ["brightness"],
    };
    const sliderProbe = document.createElement("div");
    section.append(sliderProbe);
    for (const [name, namespaces] of Object.entries(sliderNamespaces)) {
      const sliderCard = document.createElement(`yeelight-cube-${name}-card`);
      sliderCard.setConfig({
        ...config,
        show_brightness: true,
        show_brightness_slider: true,
      });
      sliderCard.hass = state;
      sliderProbe.append(sliderCard);
      await sliderCard.updateComplete;
      await frames();
      for (const ns of namespaces)
        check(
          sliderCard.shadowRoot.querySelector(`[data-sl-ns="${ns}"]`),
          `${name}: lamp slider must render with data-sl-ns="${ns}"`,
        );
    }
    sliderProbe.remove();
    gradients[0].remove();
    section.append(gradients[0]);
    await frames();
    check(
      listeners.size === 1,
      "Gradient reconnect must retain one subscription",
    );
    window.otherRegressionCards = cards;
    window.otherRegressionListeners = listeners;
    window.checkCardSpacing = (card) => {
      let checked = 0;
      const visit = (root) => {
        for (const stack of root.querySelectorAll(".yc-stack")) {
          if (!stack.getClientRects().length) continue;
          const children = [...(stack.shadowRoot || stack).children].filter(
            (child) =>
              child.getClientRects().length &&
              getComputedStyle(child).position !== "absolute" &&
              getComputedStyle(child).position !== "fixed",
          );
          const expected = parseFloat(getComputedStyle(stack).rowGap);
          for (const [index, child] of children.entries()) {
            const bounds = child.getBoundingClientRect();
            const css = getComputedStyle(child);
            check(
              parseFloat(css.marginTop) === 0 &&
                parseFloat(css.marginBottom) === 0,
              `${card.localName}: ${child.className} has external margins`,
            );
            if (index) {
              const previous = children[index - 1].getBoundingClientRect();
              const gap = bounds.top - previous.bottom;
              check(
                Math.abs(gap - expected) < 1,
                `${card.localName}: ${stack.className} -> ${child.className}: expected ${expected}px, got ${gap}px`,
              );
            }
            checked++;
          }
        }
        for (const child of root.querySelectorAll("*")) {
          if (child.shadowRoot) visit(child.shadowRoot);
        }
      };
      visit(card.shadowRoot);
      check(
        checked > 0,
        `${card.localName}: no visible stack children tested`,
      );
    };
  });
  for (const width of [1400, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      for (const card of otherRegressionCards) {
        for (const gap of [16, 24]) {
          card.style.setProperty("--yc-section-gap", `${gap}px`);
          await new Promise(requestAnimationFrame);
          checkCardSpacing(card);
        }
        card.style.removeProperty("--yc-section-gap");
      }
    });
    await page.locator("#other-card-regressions").screenshot({
      path: path.join(os.tmpdir(), `yeelight-other-cards-${width}.png`),
    });
    const hoverCard = page.locator("#draw-hover-regression");
    for (const expanded of [true, false, true, false]) {
      if (expanded) {
        // The opening panel covers its preview: move the mouse there
        // (a hover action would wait for the preview to stay on top).
        const preview = hoverCard
          .locator("yc-preview-hover .preview:not(.empty)")
          .first();
        await preview.scrollIntoViewIfNeeded();
        const box = await preview.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await page.mouse.move(0, 0);
      }
      await page.waitForFunction((expanded) => {
        const root = document.querySelector(
          "#draw-hover-regression",
        ).shadowRoot;
        // <yc-preview-hover>: its previews and the open one, in place.
        const preview = root.querySelector("yc-preview-hover").shadowRoot;
        const body = preview.querySelector(".preview:not(.empty) .preview-content");
        const scale = new DOMMatrixReadOnly(getComputedStyle(body).transform)
          .a;
        // The previews keep their scale; the open section is a panel.
        const expected = 1 / preview.querySelectorAll(".preview").length;
        return (
          preview.querySelector(".stack").classList.contains("covered") === expanded &&
          !!preview.querySelector(".panel") === expanded &&
          Math.abs(scale - expected) < 0.001 &&
          preview
            .getAnimations()
            .every((animation) => animation.playState !== "running")
        );
      }, expanded);
      const geometry = await hoverCard.evaluate((card) => {
        const preview = card.shadowRoot.querySelector(
          "yc-preview-hover",
        );
        return {
          width: preview.getBoundingClientRect().width,
          height: preview.getBoundingClientRect().height,
          available: card.getBoundingClientRect().width,
        };
      });
      assert.ok(
        geometry.width <= geometry.available && geometry.height < 300,
        `Draw hover ${expanded ? "expanded" : "collapsed"} at ${width}px: ${JSON.stringify(geometry)}`,
      );
      await hoverCard.screenshot({
        path: path.join(
          os.tmpdir(),
          `yeelight-draw-hover-${width}-${expanded ? "expanded" : "collapsed"}.png`,
        ),
      });
    }
  }
  await page.evaluate(async () => {
    const gradient = otherRegressionCards.find(
      (card) => card.localName === "yeelight-cube-gradient-card",
    );
    for (const selector of ["filled", "dropdown", "preview-grid"]) {
      gradient.setConfig({
        ...gradient.config,
        mode_selector_style: selector,
        show_active_mode_label: true,
      });
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      checkCardSpacing(gradient);
    }
    const draw = otherRegressionCards.find(
      (card) => card.localName === "yeelight-cube-draw-card",
    );
    // Every tool and action hidden (the card's config).
    const { toolsOrder, actionsOrder } = await import(
      "/custom_components/yeelight_cube/www/draw_card_tools.js"
    );
    draw.setConfig({
      ...draw.config,
      hidden_tools: toolsOrder(draw.config),
      hidden_actions: actionsOrder(draw.config),
    });
    await draw.updateComplete;
    if (
      draw.shadowRoot.querySelector(".action-row-slotted, .toolbar-container")
    ) {
      throw Error("Draw empty actions/tools still reserve a section");
    }
    const palette = otherRegressionCards.find(
      (card) => card.localName === "yeelight-cube-palette-card",
    );
    if (palette._renderPaletteExportImportButtons(false, false) !== "") {
      throw Error("Palette empty import/export still reserves a section");
    }
    otherRegressionCards.forEach((card) => card.remove());
    document.querySelector("#other-card-regressions").remove();
    await Promise.resolve();
    if (otherRegressionListeners.size)
      throw Error("Gradient subscription leaked after removal");
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS other-card state, shared preview, failure recovery and reconnect regressions (desktop/mobile screenshots)",
  );
};
