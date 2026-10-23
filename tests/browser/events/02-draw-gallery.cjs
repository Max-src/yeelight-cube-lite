// Card events check (tests/card-events-browser.cjs): the Draw card's pixel-
// art gallery (the shared gallery).
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, lamp, draw } = t;
  // --- Draw pixel-art gallery: the shared gallery ---------------------------
  await page.evaluate(
    (tag) =>
      mount(tag, {
        entity: "light.a",
        pixelart_sensor: "sensor.pixel",
        pixel_art_gallery_mode: "gallery",
        pixel_art_allow_rename: true,
        pixel_art_auto_apply_to_lamp: true,
      }),
    draw,
  );
  const drawView = await page.evaluate(() => {
    window.drawSeen = [];
    card._handlePixelArtCanvasClick = async (idx, lamp) =>
      drawSeen.push(["load", idx, lamp]);
    card._renamePixelArt = async (idx, name) => (
      drawSeen.push(["rename", idx, name]),
      true
    );
    card._deletePixelArt = async (idx) => (
      drawSeen.push(["delete", idx]),
      true
    );
    const items = card.shadowRoot.querySelectorAll(
      'yc-collection-gallery .gallery-item[data-mode^="art:"]',
    );
    const cells =
      items[0]?.querySelector(".gallery-matrix-preview")?.children || [];
    return {
      items: items.length,
      grid: !!card.shadowRoot.querySelector(
        'yc-collection-gallery .gc-preview-shell[data-layout="preview-grid"]',
      ),
      // Heart's pixel 3 is on the lamp's bottom row: shown on the
      // preview's last row (cell 83), as in the drawing.
      bottom: cells[83]?.style.background,
      top: cells[3]?.style.background,
      label: items[1]?.getAttribute("aria-label"),
    };
  });
  assert.deepEqual(
    drawView,
    {
      items: 2,
      grid: true,
      bottom: "rgb(255, 0, 0)",
      top: "rgb(0, 0, 0)",
      label: "Star: Load into the drawing and the lamp",
    },
    "draw: the former gallery mode, previews as drawn, what a pick does",
  );
  const star = `${draw} yc-collection-gallery .gallery-item[data-mode="art:1"]`;
  await page.locator(star).click();
  await page.locator(`${star} .yc-item-rename`).click();
  const drawField = page.locator(`${draw} .yc-item-manage input`);
  assert.equal(await drawField.inputValue(), "Star");
  await drawField.fill("Moon");
  await drawField.press("Enter");
  await page.waitForTimeout(50);
  await page.locator(`${star} .yc-item-delete`).click();
  await page.waitForTimeout(50);
  assert.deepEqual(
    await page.evaluate(() => drawSeen.slice()),
    [
      ["load", 1, true],
      ["rename", 1, "Moon"],
    ],
    "draw: a delete waits for its confirmation",
  );
  await page
    .locator(`${draw} .yc-item-manage button:has-text("Delete")`)
    .click();
  await page.waitForTimeout(50);
  // Each action reaches its own handler once (managing never loads).
  assert.deepEqual(await page.evaluate(() => drawSeen), [
    ["load", 1, true],
    ["rename", 1, "Moon"],
    ["delete", 1],
  ]);
  assert.deepEqual(
    await page.evaluate(() =>
      [
        ...card.shadowRoot.querySelectorAll(
          ".action-row button[data-action]",
        ),
      ].map((button) => button.title),
    ),
    [
      "Export pixel arts to a JSON file",
      "Import pixel arts from a JSON file",
    ],
    "draw: the shared export / import row",
  );
  // The pixel art on the canvas is the active one (highlighted); drawing
  // over it makes the canvas its own again.
  assert.deepEqual(
    await page.evaluate(async () => {
      await mount("yeelight-cube-draw-card", {
        entity: "light.a",
        pixelart_sensor: "sensor.pixel",
        style_selector_style: "preview-grid",
      });
      const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
      const active = async () => {
        await card.updateComplete;
        await gallery.updateComplete;
        return [...gallery.querySelectorAll('[data-active-mode="true"]')].map(
          (node) => node.dataset.mode,
        );
      };
      await card._applyPixelArtToMatrix(1);
      const loaded = await active();
      card.matrix = card.matrix.map((color, index) =>
        index === 0 ? "#123456" : color,
      );
      card.requestUpdate();
      const drawn = await active();
      // The canvas is saved in the browser: leave it blank for later tests.
      card.matrix = card.matrix.map(() => "#000000");
      card.constructor.getStorageUtils().saveMatrix(card.matrix);
      return { loaded, drawn };
    }),
    { loaded: ["art:1"], drawn: [] },
    "draw: the pixel art on the canvas is active",
  );
  // A pixel art picked and sent is named (the lamp's Pixel Art select shows
  // it); the drawing sent as such is the user's own (no name).
  assert.deepEqual(
    await page.evaluate(async () => {
      await mount("yeelight-cube-draw-card", { entity: "light.a", pixelart_sensor: "sensor.pixel" });
      const sent = async (send) => {
        calls.length = 0;
        await send();
        for (let wait = 0; wait < 40 && !calls.some((c) => c.service === "apply_custom_pixels"); wait++)
          await new Promise((resolve) => setTimeout(resolve, 25));
        return calls.find((c) => c.service === "apply_custom_pixels")?.data.name ?? null;
      };
      const picked = await sent(() => card._handlePixelArtCanvasClick(1, true));
      const own = await sent(() => card._sendToLamp());
      card.matrix = card.matrix.map(() => "#000000");
      card.constructor.getStorageUtils().saveMatrix(card.matrix);
      return { picked, own };
    }),
    { picked: "Star", own: null },
    "draw: a picked pixel art is sent with its name",
  );
  // Browsing never replaces the drawing: carousel and wheel moves only
  // browse (navigateSelects false), a click on the item loads it.
  for (const style of ["preview-carousel", "preview-wheel"]) {
    const browsed = await page.evaluate(async (style) => {
      await mount("yeelight-cube-draw-card", {
        entity: "light.a",
        pixelart_sensor: "sensor.pixel",
        style_selector_style: style,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const seen = [];
      card._handlePixelArtCanvasClick = async (idx) => seen.push(idx);
      const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
      const next = gallery.querySelector(
        '[data-action="navigate"][data-direction="1"], .wheel-nav-buttons [data-wheel-nav="down"]',
      );
      next.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const afterMove = seen.length;
      // A re-render (a lamp state update) keeps the item browsed to.
      gallery.requestUpdate();
      await gallery.updateComplete;
      const shown =
        gallery.querySelector(".yc-carousel-item[data-mode]")?.dataset.mode ??
        gallery.querySelector('.wheel-item[data-wheel-centered="true"]')
          ?.dataset.mode;
      gallery.querySelector(`[data-mode="${shown}"]`).click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { afterMove, shown, seen };
    }, style);
    assert.deepEqual(
      browsed,
      { afterMove: 0, shown: "art:1", seen: [1] },
      `draw ${style}: moves browse, a click loads`,
    );
  }
  // Drawing re-renders the card, never the gallery (memoized items).
  assert.equal(
    await page.evaluate(async () => {
      const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
      const node = gallery.querySelector(".gallery-item");
      card.selectedColor = "#00ff00";
      card.requestUpdate();
      await card.updateComplete;
      return gallery.querySelector(".gallery-item") === node;
    }),
    true,
    "draw: a card update keeps the gallery's DOM",
  );
  // New callbacks (cards pass new arrow functions on every render) never
  // update the gallery, and the newest one is the one called.
  assert.deepEqual(
    await page.evaluate(async () => {
      const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
      let updates = 0;
      gallery.addEventListener("gallery-updated", () => updates++);
      card.selectedColor = "#0000ff";
      card.requestUpdate();
      await card.updateComplete;
      await gallery.updateComplete;
      const called = [];
      gallery.onSelect = (key) => called.push(key);
      await gallery.updateComplete;
      gallery.querySelector('[data-mode="art:0"]').click();
      return { updates, called };
    }),
    { updates: 0, called: ["art:0"] },
    "gallery callbacks: no re-render, the latest called",
  );

  // Official pixel arts: the groups (All, My drawings, each collection) in
  // the shared section layouts (tabs by default), a gallery each; the
  // horizontal ones by default, the vertical ones with their toggle; an
  // official one loads into the drawing like a saved one.
  const officialView = (config) =>
    page.evaluate(async (config) => {
      const official = (name, collection, orientation, position) => ({
        name, collection, orientation, pixels: [{ position, color: [255, 0, 0] }],
      });
      const previous = hass;
      hass = {
        ...hass,
        connection: {}, // a new connection: the official ones fetched again
        callWS: async ({ type }) =>
          type === "yeelight_cube/builtin_pixel_arts"
            ? {
                pixel_arts: [
                  official("Built-in: Horizontal 01", "Nature", "horizontal", 0),
                  official("Built-in: Horizontal 24", "Geometry", "horizontal", 21),
                  official("Built-in: Vertical 01", "Nature", "vertical", 5),
                ],
              }
            : {},
      };
      await mount("yeelight-cube-draw-card", {
        entity: "light.a",
        pixelart_sensor: "sensor.pixel",
        style_selector_style: "preview-grid",
        ...config,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const sections = [...card.shadowRoot.querySelectorAll("yc-sections")].find((node) =>
        node.querySelector("yc-collection-gallery"),
      );
      const modes = () =>
        [...sections.querySelectorAll("yc-collection-gallery .gallery-item[data-mode]")].map(
          (node) => node.dataset.mode,
        );
      const tabs = () => [...sections.querySelectorAll('[role="tab"]')];
      const labels = tabs().map((tab) => tab.textContent.trim());
      const all = modes();
      tabs()[2].click(); // Nature
      await sections.updateComplete;
      await sections.querySelector("yc-collection-gallery").updateComplete;
      const nature = modes();
      sections.querySelector('[data-mode="builtin:Built-in: Horizontal 01"]').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const drawn = card.matrix.filter((color) => color && color.toLowerCase() !== "#000000").length;
      // The canvas is saved in the browser: leave it blank for later tests.
      card.matrix = card.matrix.map(() => "#000000");
      card.constructor.getStorageUtils().saveMatrix(card.matrix);
      hass = previous;
      return { layout: sections.layout, labels, all, nature, drawn };
    }, config);
  assert.deepEqual(
    await officialView({}),
    {
      layout: "tabs",
      labels: ["All", "My drawings", "Nature", "Geometry"],
      all: [
        "art:0",
        "art:1",
        "builtin:Built-in: Horizontal 01",
        "builtin:Built-in: Horizontal 24",
      ],
      nature: ["builtin:Built-in: Horizontal 01"],
      drawn: 1,
    },
    "draw: official pixel arts in their sections, horizontal by default, loaded on a pick",
  );
  const vertical = await officialView({ pixel_art_show_vertical: true });
  assert.deepEqual(
    [vertical.all.includes("builtin:Built-in: Vertical 01"), vertical.nature],
    [true, ["builtin:Built-in: Horizontal 01", "builtin:Built-in: Vertical 01"]],
    "draw: the vertical official pixel arts with their toggle",
  );
};
