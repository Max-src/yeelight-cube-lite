// Real-browser checks of the canvas of a gallery tile (matrix-animator.js
// matrixSurface) on the Native Effects and Clock cards: it follows every change
// of a reused grid at once, a frozen card included, and no tile starts blank.
//
//   node tests/matrix-surface-browser.cjs
const assert = require("node:assert/strict");
const { withBrowser } = require("./browser/harness.cjs");

// What a card's page needs; `window.show(tag, attributes, config)` puts a card up.
async function setUp(page) {
  await page.evaluate(async () => {
    const www = "/custom_components/yeelight_cube/www/";
    const { LitElement, html } = await import(`${www}lib/lit-all.js`);
    customElements.define(
      "ha-card",
      class extends LitElement {
        render() {
          return html`<slot></slot>`;
        }
      },
    );
    for (const tag of ["ha-icon", "ha-svg-icon"])
      customElements.define(tag, class extends HTMLElement {});
    await import(`${www}yeelight-cube-native-effects-card.js`);
    await import(`${www}yeelight-cube-clock-card.js`);
    const { nativePreviewCatalogue } = await import(`${www}native-effect-card-utils.js`);
    const hass = (attributes) => ({
      states: { "light.a": { entity_id: "light.a", state: "on", attributes } },
      themes: {},
      callWS: async () => ({}),
      callService: async () => {},
    });
    window.lampAttributes = (extra = {}) => ({
      brightness: 255,
      content_mode: "Native Effect",
      device_orientation: "right",
      native_effect: "Rainbow",
      native_effect_color_mode: "normal",
      native_effect_color: null,
      native_effect_speed: 50,
      native_effect_catalog: nativePreviewCatalogue,
      extended_effects_enabled: true,
      clock_style: "Rainbow",
      clock_style_id: 1,
      clock_color_mode: "normal",
      clock_content: "time",
      display_frozen: false,
      favourites: {},
      effect_rotation: { active: false, kind: "native", items: [], interval: 60 },
      rotation_intervals: {},
      ...extra,
    });
    window.show = (tag, attributes, config, host = document.body) => {
      host.replaceChildren();
      const card = document.createElement(tag);
      // As a dashboard holds it (setConfig maps former options).
      window.baseConfig = {
        entity: "light.a",
        show_gallery: true,
        gallery_layout: "grid",
        gallery_columns: 3,
        ...config,
      };
      card.setConfig(baseConfig);
      card.hass = hass(attributes);
      host.append(card);
      window.card = card;
    };
    window.update = (attributes, config) => {
      if (config) card.setConfig((baseConfig = { ...baseConfig, ...config }));
      if (attributes) card.hass = hass(attributes);
    };
    // A gallery tile's grid, and what its canvas covers.
    window.tile = (name) => {
      const tiles = [...card.shadowRoot.querySelectorAll("[data-mode]")].filter(
        (node) => node.dataset.mode === name || name === undefined,
      );
      return (
        tiles.find((node) => node.querySelector(".gallery-matrix-preview canvas")) ||
        // The Clock card's own preview, painted before the gallery's tiles.
        card.shadowRoot.querySelector("[data-clock-preview]")
      );
    };
    window.surface = (name) => {
      const node = tile(name);
      const grid = node?.querySelector(".gallery-matrix-preview");
      const canvas = grid?.querySelector("canvas");
      if (!canvas) return null;
      const box = canvas.getBoundingClientRect();
      const frame = grid.getBoundingClientRect();
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let at = 0; at < data.length; at += 4)
        if (data[at] || data[at + 1] || data[at + 2]) lit += 1;
      return {
        columns: canvas.width,
        rows: canvas.height,
        vertical: grid.dataset.vertical === "true",
        lit,
        canvasWidth: box.width,
        canvasHeight: box.height,
        gridWidth: frame.width,
        gridHeight: frame.height,
        mask: canvas.style.maskImage,
        filter: canvas.parentElement.style.filter,
        holes: grid.classList.contains("matrix-surface-holes"),
        cellShadow: getComputedStyle(grid.querySelector(":scope > div")).boxShadow,
      };
    };
    window.nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

const covers = (state, label) => {
  // A half-gap beyond the cells, inside the frame.
  assert.ok(state.canvasWidth <= state.gridWidth, `${label}: width ${JSON.stringify(state)}`);
  assert.ok(state.canvasWidth > state.gridWidth * 0.85, `${label}: width ${JSON.stringify(state)}`);
  assert.ok(state.canvasHeight <= state.gridHeight, `${label}: height ${JSON.stringify(state)}`);
  assert.ok(state.canvasHeight > state.gridHeight * 0.7, `${label}: height ${JSON.stringify(state)}`);
};

const rounded = (state) => decodeURIComponent(state.mask).match(/rx='([^']+)'/)?.[1];

withBrowser(async ({ browser, server }) => {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/surface.html", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/surface.html`);
  await setUp(page);
  const state = (name) => page.evaluate((key) => window.surface(key), name);
  const settled = () => page.evaluate(async () => {
    await card.updateComplete;
    await nextFrame();
    await nextFrame();
  });
  const painted = (name) =>
    page.waitForFunction((key) => window.surface(key)?.lit > 0, name);

  for (const [tag, name, attributes] of [
    ["yeelight-cube-native-effects-card", "Rainbow", {}],
    ["yeelight-cube-clock-card", undefined, { content_mode: "Clock" }],
  ]) {
    const frozen = { display_frozen: true };

    // 1. The mount stands up, then lies down again, frozen: no paint will come.
    await page.evaluate(
      ([cardTag, extra]) => show(cardTag, lampAttributes(extra), {}),
      [tag, attributes],
    );
    await painted(name);
    await page.evaluate(([extra]) => update(lampAttributes(extra)), [{ ...attributes, ...frozen }]);
    await settled();
    await page.evaluate(
      ([extra]) => update(lampAttributes({ ...extra, device_orientation: "down" })),
      [{ ...attributes, ...frozen }],
    );
    await settled();
    let tile = await state(name);
    assert.equal(tile.vertical, true, `${tag}: the grid stood up`);
    assert.deepEqual([tile.columns, tile.rows], [5, 20], `${tag}: the canvas follows`);
    covers(tile, `${tag} vertical`);
    assert.ok(tile.lit > 0, `${tag}: still a picture standing up`);
    await page.evaluate(
      ([extra]) => update(lampAttributes({ ...extra, device_orientation: "right" })),
      [{ ...attributes, ...frozen }],
    );
    await settled();
    tile = await state(name);
    assert.deepEqual([tile.columns, tile.rows], [20, 5], `${tag}: and lies down again`);
    covers(tile, `${tag} landscape`);

    // 2. The look changes on the same grid, frozen.
    const grid = await page.evaluateHandle(
      (key) => tile(key).querySelector(".gallery-matrix-preview"),
      name,
    );
    await page.evaluate(() => update(null, { gallery_pixel_style: "circle" }));
    await settled();
    const circle = rounded(await state(name));
    assert.ok(Number(circle) > 2, `${tag}: circles, rx ${circle}`);
    await page.evaluate(() => update(null, { gallery_pixel_style: "square" }));
    await settled();
    assert.equal(Number(rounded(await state(name)) ?? 0), 0, `${tag}: squares`);
    await page.evaluate(() => update(null, { gallery_spacing_mode: "none" }));
    await settled();
    assert.equal((await state(name)).mask, "none", `${tag}: no gaps, no mask`);
    await page.evaluate(() => update(null, { gallery_spacing_mode: "normal", gallery_pixel_style: "rounded" }));
    await settled();
    assert.ok(Number(rounded(await state(name))) > 0, `${tag}: rounded again`);
    assert.equal(
      await page.evaluate(
        ([node, key]) => node === tile(key).querySelector(".gallery-matrix-preview"),
        [grid, name],
      ),
      true,
      `${tag}: on the same grid, the case this checks`,
    );

    // 3. First painted hidden, then shown, frozen: right on the first frame.
    await page.evaluate(
      ([cardTag, extra]) => {
        const box = document.createElement("div");
        box.style.display = "none";
        document.body.replaceChildren(box);
        show(cardTag, lampAttributes(extra), {}, box);
        window.box = box;
      },
      [tag, { ...attributes, ...frozen }],
    );
    await page.waitForFunction(
      (key) => card.shadowRoot?.querySelector(".gallery-matrix-preview canvas") && (key || true),
      name,
    );
    const tall = await page.evaluate(async (key) => {
      box.style.display = "";
      // The next rendering step (a frame's callbacks run ahead of its layout).
      await nextFrame();
      await nextFrame();
      const node = tile(key);
      return { state: surface(key), height: node.getBoundingClientRect().height };
    }, name);
    covers(tall.state, `${tag} shown`);
    assert.equal(tall.state.columns, 20);
    assert.ok(tall.state.gridHeight < tall.state.gridWidth, `${tag}: a landscape tile`);
    assert.ok(tall.state.mask !== "", `${tag}: shaped when shown`);

    // 4. See-through black: lit pixels keep their shadow, from the canvas.
    await page.evaluate(
      ([cardTag, extra]) =>
        show(cardTag, lampAttributes(extra), {
          gallery_background_color: "white",
          gallery_ignore_black_pixels: true,
          gallery_spacing_mode: "normal",
        }),
      [tag, attributes],
    );
    await painted(name);
    await settled();
    tile = await state(name);
    assert.equal(tile.holes, true, `${tag}: black is see-through`);
    assert.equal(tile.cellShadow, "none", `${tag}: no shadow on a cell that may be off`);
    assert.match(tile.filter, /drop-shadow/, `${tag}: a lit pixel's shadow`);
    await page.evaluate(() => update(null, {
      gallery_ignore_black_pixels: false,
    }));
    await settled();
    await page.waitForFunction(
      (key) => window.surface(key)?.holes === false,
      name,
    );
    assert.equal((await state(name)).filter, "none", `${tag}: the cells' own shadows again`);
  }

  // 5. Frozen at load: no tile is empty for having started at render 0.
  await page.evaluate(() =>
    show("yeelight-cube-native-effects-card", lampAttributes({ display_frozen: true }), {}),
  );
  for (const name of ["Building Blocks", "Particle glows", "Mirrored comets", "Sunrise and sunset"]) {
    await page.evaluate((key) => {
      card._searchQuery = key;
      card._controls?.notify();
    }, name);
    await page.waitForFunction((key) => window.surface(key)?.lit > 20, name);
  }
  await page.evaluate(() =>
    show(
      "yeelight-cube-clock-card",
      lampAttributes({ display_frozen: true, content_mode: "Clock" }),
      {},
    ),
  );
  await page.waitForFunction(() => window.surface()?.lit > 0);
  for (const name of ["Particle glows", "Mirrored comets", "Sunrise and sunset"]) {
    const digits = await page.evaluate(async (style) => {
      const { renderClockFrame } = await import(
        "/custom_components/yeelight_cube/www/clock-preview-utils.js"
      );
      const frame = renderClockFrame({ clock_style: style }, null, null, 0);
      return frame.filter((pixel) => pixel.some(Boolean)).length;
    }, name);
    assert.ok(digits > 5, `clock on ${name}: its digits show at the start (${digits})`);
  }

  assert.deepEqual(errors, []);
  console.log(
    "PASS gallery canvas: follows a mount turned, pixel style and spacing on the same grid, shown after hidden, frozen; lit pixels keep their shadow; no tile starts blank",
  );
});
