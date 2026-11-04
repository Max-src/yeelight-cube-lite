// Real-browser measure of the Native Effects gallery: 38 animated tiles on screen,
// the lamp's renderers behind each. Main-thread time (scripts, style, layout
// and paint, Chromium's TaskDuration) per display frame.
//
//   node tests/gallery-perf-browser.cjs
//
// GALLERY_LOOK adds card options, as JSON. A check's limit, GALLERY_MS, leaves room for a loaded machine: about 2 ms is
// usual on the development PC, and a gallery painting its 100 cells each, the way
// it would without matrixSurface, takes over 30.
const assert = require("node:assert/strict");
const { withBrowser } = require("./browser/harness.cjs");

const SECONDS = 6;
const LIMIT_MS = Number(process.env.GALLERY_MS || 5);

withBrowser(async ({ browser, server }) => {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 4000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/perf.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><main style='width:1560px'></main>",
    }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/perf.html`);
  await page.evaluate(async (look) => {
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
    const { nativePreviewCatalogue } = await import(`${www}native-effect-card-utils.js`);
    const attributes = {
      brightness: 255,
      content_mode: "Native Effect",
      device_orientation: "right",
      native_effect: "Rainbow",
      native_effect_color_mode: "normal",
      native_effect_color: null,
      native_effect_speed: 50,
      native_effect_catalog: nativePreviewCatalogue,
      extended_effects_enabled: true,
      display_frozen: false,
      favourites: {},
      effect_rotation: { active: false, kind: "native", items: [], interval: 60 },
      rotation_intervals: {},
    };
    const card = document.createElement("yeelight-cube-native-effects-card");
    card.setConfig({
      entity: "light.a",
      gallery_layout: "grid",
      gallery_columns: 6,
      ...look,
    });
    card.hass = {
      states: { "light.a": { entity_id: "light.a", state: "on", attributes } },
      themes: {},
      callWS: async () => ({}),
      callService: async () => {},
    };
    document.querySelector("main").append(card);
    window.card = card;
  }, JSON.parse(process.env.GALLERY_LOOK || "{}"));
  await page.waitForFunction(() => {
    const root = window.card.shadowRoot;
    const gallery = root?.querySelector("yc-collection-gallery")?.shadowRoot ?? root;
    return window.card._frames?.length >= 38 && !!gallery;
  });
  // Warmed up, as a gallery open for a moment is.
  await page.waitForTimeout(1500);
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
    );
  const countFrames = (seconds) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          let frames = 0;
          const started = performance.now();
          const tick = (t) => {
            frames += 1;
            if (t - started < ms) requestAnimationFrame(tick);
            else resolve(frames);
          };
          requestAnimationFrame(tick);
        }),
      seconds * 1000,
    );
  const before = await metrics();
  const frames = await countFrames(SECONDS);
  const after = await metrics();
  // A second's main-thread work over a 60 Hz display's frames: headless Chromium's
  // display rate follows the load, so "per frame" alone would flatter a slow run.
  const perFrame = (key) => (((after[key] - before[key]) * 1000) / (SECONDS * 60)).toFixed(2);
  const tiles = await page.evaluate(
    () => window.card._frames.filter((f) => window.card._previewVisibility.visible.has(f.node)).length,
  );
  const lit = await page.evaluate(() =>
    window.card._frames.filter((f) => {
      const canvas = f.grid.querySelector("canvas");
      return canvas?.getContext("2d").getImageData(0, 0, 20, 5).data.some((value, at) => at % 4 !== 3 && value);
    }).length,
  );
  assert.deepEqual(errors, []);
  assert.ok(tiles >= 38, `${tiles} tiles on screen`);
  assert.ok(lit >= 30, `${lit} tiles lit`);
  const total = Number(perFrame("TaskDuration"));
  console.log(
    `${tiles} tiles, ${frames} frames in ${SECONDS} s: ${total} ms of main thread per 60 Hz frame`,
    `(script ${perFrame("ScriptDuration")}, style ${perFrame("RecalcStyleDuration")}, layout ${perFrame("LayoutDuration")})`,
  );
  assert.ok(total <= LIMIT_MS, `${total} ms per frame, limit ${LIMIT_MS}`);
});
