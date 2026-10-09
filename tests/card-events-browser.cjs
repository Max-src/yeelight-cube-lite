// Real-browser checks under a strict Content Security Policy:
// - delegated card events (host-events.js): every control that used to carry
//   an inline on* handler is clicked, dragged, typed into or scrolled, and
//   must still reach the card (and the lamp);
// - saved names containing markup stay text in every display mode.
//
//   node tests/card-events-browser.cjs
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const root = path.resolve(__dirname, "..");
const server = http.createServer(async (request, response) => {
  const file = path.resolve(
    root,
    `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`,
  );
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(file);
    response.setHeader(
      "Content-Type",
      file.endsWith(".js") ? "text/javascript" : "text/html",
    );
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});

const SLIDER_STYLES = ["slider", "bar", "wheel", "matrix", "rotary", "capsule"];

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    // A strict CSP: inline handlers would be refused (and reported).
    await page.route("**/events.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        headers: {
          "Content-Security-Policy":
            "script-src 'self' 'unsafe-eval'; script-src-attr 'none'",
        },
        body: "<!doctype html><main></main>",
      }),
    );
    page.on("console", (message) => {
      if (/Content Security Policy|script-src-attr/i.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/events.html`);

    await page.evaluate(async () => {
      const { LitElement, html } =
        await import("/custom_components/yeelight_cube/www/lib/lit-all.js");
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
      const base = "/custom_components/yeelight_cube/www/";
      for (const name of [
        "lamp-preview",
        "clock",
        "native-effects",
        "draw",
        "gradient",
        "palette",
        "color-list-editor",
      ])
        await import(`${base}yeelight-cube-${name}-card.js`);
      window.calls = [];
      window.hass = {
        states: {
          "light.a": {
            state: "on",
            attributes: {
              brightness: 128,
              device_orientation: "right",
              content_mode: "Custom Draw",
              matrix_colors: new Array(100).fill([0, 0, 0]),
              native_effect: "Rainbow",
              native_effect_speed: 50,
              native_effect_catalog: [
                { name: "Rainbow", speed: true, directions: ["Up", "Down"] },
              ],
              clock_style: "Rainbow",
              clock_color_mode: "normal",
              gradient_angle: 90,
              mode: "Angle Gradient",
              text_colors: [[255, 0, 0], [0, 0, 255]],
            },
          },
          "sensor.pixel": {
            state: "1",
            attributes: {
              pixel_arts: [
                { name: "Heart", pixels: [{ position: 3, color: [255, 0, 0] }] },
                { name: "Star", pixels: [{ position: 7, color: [255, 255, 0] }] },
              ],
            },
          },
        },
        themes: {},
        callService: async (domain, service, data) => {
          calls.push({ domain, service, data });
        },
        callWS: async () => ({}),
      };
      window.mount = async (tag, config) => {
        document.querySelector("main").replaceChildren();
        const card = document.createElement(tag);
        card.setConfig(config);
        card.hass = hass;
        document.querySelector("main").append(card);
        await card.updateComplete;
        await new Promise((resolve) => setTimeout(resolve, 50));
        await card.updateComplete;
        window.card = card;
        calls.length = 0;
      };
    });

    const waitForCall = async (service, label) => {
      await page
        .waitForFunction((s) => calls.some((c) => c.service === s), service, {
          timeout: 3000,
        })
        .catch(() => {});
      const found = await page.evaluate(
        (s) => calls.find((c) => c.service === s)?.data ?? null,
        service,
      );
      assert.ok(found, `${label}: no ${service} call`);
      return found;
    };
    const reset = () => page.evaluate(() => (calls.length = 0));
    const lamp = "yeelight-cube-lamp-preview-card";

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
      await page.locator(`${lamp} .rotary-step-btn[title^="Increase"]`).first().click();
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
          await page.evaluate(() => card._anySliderDragging),
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
        await page.locator(`${lamp} .brightness-wheel-tick[data-value="30"]`).click();
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
          () => +card.shadowRoot.querySelector(".brightness-slider-rotary").value,
        );
        await page.locator(`${lamp} .brightness-rotary-wrapper`).hover();
        await page.mouse.wheel(0, -100);
        const after = await page.evaluate(
          () => +card.shadowRoot.querySelector(".brightness-slider-rotary").value,
        );
        // One notch is one step (inline handlers stepped twice: dial + container).
        assert.equal(after - before, 5, "rotary: one wheel notch = +5");
        await waitForCall("turn_on", "rotary wheel");
        await reset();
        await page.locator(`${lamp} .brightness-rotary-container`).click();
        await waitForCall("turn_on", "rotary press");
      } else if (style === "capsule") {
        const value = page.locator(`${lamp} .brightness-capsule-input[type="number"]`);
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
        assert.equal(await page.evaluate(() => card._slBrightnessTyping), false);
      }
    }

    // --- Lamp Preview: a dragged brightness holds until the lamp reports it ---
    await page.evaluate((tag) =>
      mount(tag, {
        entity: "light.a",
        show_brightness: true,
        slider_style: "slider",
        show_device_orientation: false,
      }), lamp);
    await page.locator(`${lamp} input.brightness-slider`).first().fill("40");
    assert.equal((await waitForCall("turn_on", "preview drag")).brightness, 102);
    const shown = () =>
      page.evaluate(() => +card.shadowRoot.querySelector("input.brightness-slider").value);
    const push = (brightness) =>
      page.evaluate(async (brightness) => {
        const light = hass.states["light.a"];
        hass = { ...hass, states: { ...hass.states, "light.a": { ...light, attributes: { ...light.attributes, brightness } } } };
        card.hass = hass;
        await new Promise((resolve) => setTimeout(resolve, 400)); // render debounce
      }, brightness);
    await push(128); // an older state arriving after the commit
    assert.equal(await shown(), 40, "preview: older lamp state must not jump the slider back");
    await push(102); // the lamp reports the new value: the draft is dropped
    assert.equal(await page.evaluate(() => card._lampSliders.value("brightness")), null);
    assert.equal(await shown(), 40);
    await push(26); // later changes (another card, automation) show again
    assert.equal(await shown(), 10);

    // --- Orientation: Lamp Preview and Native (inside the mode controls) -----
    await page.evaluate((tag) =>
      mount(tag, { entity: "light.a", show_device_orientation: true }), lamp);
    await page.locator(`${lamp} .orient-btn[data-value="down"]`).click();
    assert.equal(
      (await waitForCall("set_device_orientation", "lamp orientation")).orientation,
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
      await page.locator(`${tag} .orient-btn[data-value="left"]`).first().click();
      assert.equal(
        (await waitForCall("set_device_orientation", `${tag} orientation`))
          .orientation,
        "left",
      );
    }

    // --- Native / Clock brightness sliders -------------------------------------
    for (const tag of ["yeelight-cube-clock-card", "yeelight-cube-native-effects-card"]) {
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
      const step = page.locator(`${tag} .rotary-step-btn[title^="Increase"]`).first();
      await step.click();
      await waitForCall("turn_on", `${tag} brightness step`);
    }

    // --- Draw pixel-art gallery: the shared gallery ---------------------------
    const draw = "yeelight-cube-draw-card";
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
      card._handlePixelArtCanvasClick = async (idx, lamp) => drawSeen.push(["load", idx, lamp]);
      card._renamePixelArt = async (idx, name) => (drawSeen.push(["rename", idx, name]), true);
      card._deletePixelArt = async (idx) => (drawSeen.push(["delete", idx]), true);
      const items = card.shadowRoot.querySelectorAll('yc-collection-gallery .gallery-item[data-mode^="art:"]');
      const cells = items[0]?.querySelector(".gallery-matrix-preview")?.children || [];
      return {
        items: items.length,
        grid: !!card.shadowRoot.querySelector('yc-collection-gallery .gc-preview-shell[data-columns="2"]'),
        // Heart's pixel 3 is on the lamp's bottom row: shown on the
        // preview's last row (cell 83), as in the drawing.
        bottom: cells[83]?.style.background,
        top: cells[3]?.style.background,
        label: items[1]?.getAttribute("aria-label"),
      };
    });
    assert.deepEqual(drawView, {
      items: 2,
      grid: true,
      bottom: "rgb(255, 0, 0)",
      top: "rgb(0, 0, 0)",
      label: "Star: Load into the drawing and the lamp",
    }, "draw: the former gallery mode, previews as drawn, what a pick does");
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
    assert.deepEqual(await page.evaluate(() => drawSeen.slice()), [["load", 1, true], ["rename", 1, "Moon"]],
      "draw: a delete waits for its confirmation");
    await page.locator(`${draw} .yc-item-manage button:has-text("Delete")`).click();
    await page.waitForTimeout(50);
    // Each action reaches its own handler once (managing never loads).
    assert.deepEqual(await page.evaluate(() => drawSeen), [
      ["load", 1, true],
      ["rename", 1, "Moon"],
      ["delete", 1],
    ]);
    assert.deepEqual(
      await page.evaluate(() =>
        [...card.shadowRoot.querySelectorAll(".action-row button[data-action]")].map(
          (button) => button.title,
        ),
      ),
      ["Export pixel arts to a JSON file", "Import pixel arts from a JSON file"],
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
          return [...gallery.querySelectorAll('[data-active-mode="true"]')].map((node) => node.dataset.mode);
        };
        await card._applyPixelArtToMatrix(1);
        const loaded = await active();
        card.matrix = card.matrix.map((color, index) => (index === 0 ? "#123456" : color));
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
        const shown =
          gallery.querySelector(".yc-carousel-item[data-mode]")?.dataset.mode ??
          gallery.querySelector('.wheel-item[data-wheel-centered="true"]')?.dataset.mode;
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

    // --- Gradient angle capsule -------------------------------------------------
    const gradient = "yeelight-cube-gradient-card";
    await page.evaluate(
      (tag) =>
        mount(tag, {
          entity: "light.a",
          rotary_unified_style: "capsule",
          show_angle_control: true,
        }),
      gradient,
    );
    const capsule = page.locator(`${gradient} .angle-capsule-host input.capsule-input`);
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

    // --- Gradient modes through the shared gallery (text layouts) ------------
    for (const style of ["filled", "chips", "dropdown"]) {
      await page.evaluate(
        ({ tag, style }) => mount(tag, { entity: "light.a", style_selector_style: style }),
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
        await gallery.locator("select.mode-select").selectOption("Radial Gradient");
      else await gallery.locator('[data-mode="Radial Gradient"]').click();
      assert.equal(
        (await waitForCall("set_mode", `gradient ${style} pick`)).mode,
        "Radial Gradient",
      );
    }

    // --- Chip swatches: a meaningful swatch for every kind of item ------------
    const chips = async (tag, config, paintedBy) => {
      await page.evaluate(
        ({ tag, config }) => mount(tag, { entity: "light.a", style_selector_style: "chips", ...config }),
        { tag, config },
      );
      await page.waitForTimeout(200);
      return page.evaluate((paintedBy) => {
        const chip = card.shadowRoot.querySelector("yc-collection-gallery .mode-chip[data-mode]");
        const matrix = chip?.querySelector(".mode-chip-matrix .gallery-matrix-preview");
        const animated =
          paintedBy === "clock"
            ? [...(card._visible || [])].includes(chip)
            : paintedBy === "native"
              ? (card._frames || []).some((frame) => frame.node === chip)
              : null;
        return {
          cells: matrix?.children.length ?? 0,
          swatch: chip?.querySelector(".mode-chip-swatch")?.style.background || "",
          animated,
        };
      }, paintedBy);
    };
    const clockChip = await chips("yeelight-cube-clock-card", { show_gallery: true }, "clock");
    assert.equal(clockChip.cells, 100, "clock chips: micro-matrix of the style");
    assert.equal(clockChip.animated, true, "clock chips: animated by the card");
    const nativeChip = await chips("yeelight-cube-native-effects-card", { show_gallery: true }, "native");
    assert.equal(nativeChip.cells, 100, "native chips: micro-matrix of the effect");
    assert.equal(nativeChip.animated, true, "native chips: animated by the card");
    const gradientChip = await chips("yeelight-cube-gradient-card", {}, null);
    assert.equal(gradientChip.cells, 0, "gradient chips: no matrix");
    assert.ok(gradientChip.swatch, "gradient chips: the mode's own gradient");

    // --- Item labels: a card renames items for display only ------------------
    await page.evaluate(() =>
      mount("yeelight-cube-clock-card", {
        entity: "light.a",
        show_gallery: true,
        show_search: true,
        style_selector_style: "filled",
        item_labels: { Rainbow: "Arc-en-ciel" },
      }),
    );
    const clockLabels = () =>
      page.evaluate(() => ({
        button: card.shadowRoot.querySelector('yc-collection-gallery [data-mode="Rainbow"]')?.textContent.trim(),
        active: card.shadowRoot.querySelector(".active-label")?.textContent.trim(),
      }));
    assert.deepEqual(await clockLabels(), { button: "Arc-en-ciel", active: "Arc-en-ciel" });
    const search = page.locator("yeelight-cube-clock-card .yc-gallery-search");
    for (const query of ["arc-en", "rainbow"]) {
      await search.fill(query);
      assert.ok(
        await page.locator('yeelight-cube-clock-card yc-collection-gallery [data-mode="Rainbow"]').count(),
        `clock search "${query}" finds the renamed style`,
      );
    }
    await page.locator('yeelight-cube-clock-card yc-collection-gallery [data-mode="Rainbow"]').click();
    assert.match(
      JSON.stringify(await waitForCall("set_clock_style", "renamed style pick")),
      /Rainbow/,
      "a renamed style is still applied by its key",
    );
    await page.evaluate(() =>
      mount("yeelight-cube-native-effects-card", {
        entity: "light.a",
        show_preview: true,
        item_labels: { Rainbow: "Arc" },
      }),
    );
    assert.equal(
      await page.evaluate(() => card.shadowRoot.querySelector(".current-heading h3")?.textContent.trim()),
      "Arc",
      "native: current effect heading uses the label",
    );
    // Previous / Next step through what the gallery's search shows.
    assert.deepEqual(
      await page.evaluate(async () => {
        await card.updateComplete;
        const keys = () => card._controls.adapter.navigationItems().map((item) => item.key);
        const search = card.shadowRoot.querySelector(".yc-gallery-search");
        const typed = async (text) => {
          search.value = text;
          search.dispatchEvent(new Event("input"));
          await card.updateComplete;
          return keys();
        };
        return { label: await typed("arc"), none: await typed("zzz"), all: await typed("") };
      }),
      { label: ["Rainbow"], none: [], all: ["Rainbow"] },
      "native: Previous / Next follow the search (labels included)",
    );
    await page.evaluate(() =>
      mount("yeelight-cube-gradient-card", {
        entity: "light.a",
        show_active_mode_label: true,
        style_selector_style: "filled",
        item_labels: { "Angle Gradient": "Diagonal" },
      }),
    );
    await page.waitForTimeout(150);
    assert.deepEqual(
      await page.evaluate(() => ({
        chip: card.shadowRoot.querySelector(".gc-aml-text")?.textContent.trim(),
        button: card.shadowRoot.querySelector('yc-collection-gallery [data-mode="Angle Gradient"]')?.textContent.trim(),
      })),
      { chip: "Diagonal", button: "Diagonal" },
      "gradient: label in the active-mode chip and the selector",
    );
    // The editor renames in its visible-modes list.
    const renamed = await page.evaluate(async () => {
      const editor = await customElements.get("yeelight-cube-gradient-card").getConfigElement();
      editor.hass = hass;
      editor.setConfig({ type: "custom:yeelight-cube-gradient-card", entity: "light.a" });
      document.querySelector("main").replaceChildren(editor);
      await editor.updateComplete;
      for (const section of editor.shadowRoot.querySelectorAll(".editor-card-header")) {
        section.click();
        await editor.updateComplete;
      }
      const changes = [];
      editor.addEventListener("config-changed", (event) => changes.push(event.detail.config));
      const field = editor.shadowRoot.querySelector(".orderable-list-rename");
      field.value = "Plain";
      field.dispatchEvent(new Event("change"));
      await editor.updateComplete;
      const set = changes.at(-1)?.item_labels;
      const input = editor.shadowRoot.querySelector(".orderable-list-rename");
      input.value = "";
      input.dispatchEvent(new Event("change"));
      const cleared = "item_labels" in (changes.at(-1) || {});
      // Every mode is listed (no toggle); moving one makes the list the
      // card's own, and "Show all modes" goes back (names are kept).
      const rows = editor.shadowRoot.querySelectorAll(".orderable-list-rename").length;
      field.value = "Plain";
      field.dispatchEvent(new Event("change"));
      await editor.updateComplete;
      editor.shadowRoot.querySelector('.orderable-list-row button[title="Move down"]').click();
      await editor.updateComplete;
      const custom = changes.at(-1);
      [...editor.shadowRoot.querySelectorAll(".orderable-reset-btn")]
        .find((button) => button.textContent.includes("Show all modes"))
        .click();
      await editor.updateComplete;
      const reset = changes.at(-1);
      return {
        placeholder: field.placeholder,
        set,
        cleared,
        rows,
        custom: [custom.custom_visible_modes, custom.visible_modes.slice(0, 2)],
        reset: [reset.custom_visible_modes, reset.visible_modes, reset.item_labels],
      };
    });
    assert.deepEqual(renamed, {
      placeholder: "Solid Color",
      set: { "Solid Color": "Plain" },
      cleared: false,
      rows: 9,
      custom: [true, ["Letter Gradient", "Solid Color"]],
      reset: [undefined, undefined, { "Solid Color": "Plain" }],
    });

    // --- Hostile names: saved names are shown as text, never run as markup ----
    // Palettes, pixel arts and clock presets are shared data any HA user (or
    // an imported file) can name. Every display mode must keep them inert.
    const EVIL = `EVIL<img src=x onerror="window.__pwned=1"><b id="pwn">"'&`;
    await page.evaluate((EVIL) => {
      window.deepAll = (selector, root = document) => {
        const found = [...root.querySelectorAll(selector)];
        for (const el of root.querySelectorAll("*"))
          if (el.shadowRoot) found.push(...deepAll(selector, el.shadowRoot));
        return found;
      };
      window.deepText = (root = document) => {
        let text = root.textContent || "";
        for (const el of root.querySelectorAll("*"))
          if (el.shadowRoot) text += deepText(el.shadowRoot);
        return text;
      };
      hass.states["sensor.pal"] = {
        state: "2",
        attributes: {
          palettes_v2: [
            { name: EVIL, colors: [[255, 0, 0], [0, 0, 255]] },
            { name: "Plain", colors: [[0, 255, 0]] },
          ],
        },
      };
      hass.states["sensor.pixel"].attributes.pixel_arts[0].name = EVIL;
      // Saved presets are offered only when the backend has the service.
      hass.services = { yeelight_cube: { save_clock_preset: {} } };
      hass.states["sensor.presets"] = {
        state: "1",
        attributes: {
          clock_presets: [
            { id: "evil", name: EVIL, kind: "color_mode", color: [255, 0, 0] },
          ],
        },
      };
      // HA replaces the states object on every change (cards cache by it).
      hass.states = { ...hass.states };
    }, EVIL);
    const checkInert = async (label) => {
      await page.waitForTimeout(150); // let a broken <img> fire onerror
      const result = await page.evaluate(() => ({
        pwned: window.__pwned === 1,
        injected: deepAll('img[src="x"], #pwn').length,
        shown: deepText().includes("EVIL"),
      }));
      assert.equal(result.pwned, false, `${label}: markup ran`);
      assert.equal(result.injected, 0, `${label}: markup became elements`);
      assert.ok(result.shown, `${label}: the name is not shown at all`);
    };
    for (const mode of ["list", "gallery", "carousel", "album"]) {
      await page.evaluate(
        (mode) =>
          mount("yeelight-cube-palette-card", {
            entity: "light.a",
            palette_sensor: "sensor.pal",
            display_mode: mode,
          }),
        mode,
      );
      await checkInert(`palette ${mode}`);
    }
    for (const mode of ["list", "gallery", "carousel", "album"]) {
      await page.evaluate(
        (mode) =>
          mount("yeelight-cube-draw-card", {
            entity: "light.a",
            pixelart_sensor: "sensor.pixel",
            pixel_art_gallery_mode: mode,
          }),
        mode,
      );
      await checkInert(`draw ${mode}`);
    }
    await page.evaluate(() =>
      mount("yeelight-cube-clock-card", {
        entity: "light.a",
        show_gallery: true,
        show_color_modes: true,
      }),
    );
    await checkInert("clock presets");

    // --- The shared gallery's album (Clock; Native uses the same element) ----
    await page.evaluate(() =>
      mount("yeelight-cube-clock-card", {
        entity: "light.a",
        show_gallery: true,
        style_selector_style: "preview-album",
      }),
    );
    const album = () =>
      page.evaluate(() => {
        const items = [...card.shadowRoot.querySelectorAll(".collection-album-item")];
        const centre = items.find((item) => item.classList.contains("active"));
        return {
          count: items.length,
          centre: centre?.querySelector("[data-mode]")?.dataset.mode,
          painted: !!centre?.querySelector(".gallery-matrix-preview > div"),
        };
      });
    const start = await album();
    assert.ok(start.count > 2, "album: every clock style");
    assert.equal(start.centre, "Rainbow", "album: opens on the active style");
    assert.ok(start.painted, "album: live matrix preview");
    // The arrows only browse; clicking the centred card applies it.
    await page.locator("yeelight-cube-clock-card .album-nav-next").click();
    const next = await album();
    assert.notEqual(next.centre, "Rainbow");
    assert.equal(await page.evaluate(() => calls.length), 0, "album: browsing applies nothing");
    await page.locator("yeelight-cube-clock-card .collection-album-item.active").click();
    const applied = await waitForCall("set_clock_style", "album pick");
    assert.match(JSON.stringify(applied), new RegExp(next.centre));
    // A rotation step (the lamp reports another style) turns the album to it.
    await page.evaluate(async () => {
      const light = hass.states["light.a"];
      hass = { ...hass, states: { ...hass.states, "light.a": { ...light, attributes: { ...light.attributes, clock_style: "White", clock_style_id: 4 } } } };
      card.hass = hass;
      await card.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    assert.equal((await album()).centre, "White", "album: follows the active style");
    // Item shape, button shape and wrap navigation reach the album.
    await page.evaluate(() =>
      mount("yeelight-cube-clock-card", {
        entity: "light.a",
        show_gallery: true,
        style_selector_style: "preview-album",
        selector_shape: "square",
        selector_button_shape: "square",
        gallery_wrap_navigation: true,
      }),
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        card: getComputedStyle(card.shadowRoot.querySelector(".collection-album-item")).borderTopLeftRadius,
        arrow: getComputedStyle(card.shadowRoot.querySelector(".album-nav-prev")).borderTopLeftRadius,
      })),
      { card: "0px", arrow: "0px" },
      "album: item and button shapes",
    );
    const firstIndex = await page.evaluate(() =>
      [...card.shadowRoot.querySelectorAll(".collection-album-item")].findIndex((item) => item.classList.contains("active")),
    );
    for (let i = 0; i <= firstIndex; i++)
      await page.locator("yeelight-cube-clock-card .album-nav-prev").click();
    assert.equal(
      await page.evaluate(() => {
        const items = [...card.shadowRoot.querySelectorAll(".collection-album-item")];
        return items.at(-1).classList.contains("active");
      }),
      true,
      "album: wrap navigation goes from the first item to the last",
    );

    // --- User-owned items: rename and delete in the gallery --------------------
    await page.evaluate(() => {
      window.savedPresets = hass.states["sensor.presets"];
      hass.states = {
        ...hass.states,
        "sensor.presets": {
          state: "1",
          attributes: {
            clock_presets: [{ id: "mine", name: "Mine", kind: "style", color: [10, 200, 30] }],
          },
        },
      };
    });
    const clockGrid = (extra) =>
      page.evaluate(
        (extra) =>
          mount("yeelight-cube-clock-card", {
            entity: "light.a",
            show_gallery: true,
            show_search: false,
            style_selector_style: "preview-grid",
            ...extra,
          }),
        extra,
      );
    await clockGrid({ allow_rename: true });
    const controls = await page.evaluate(() => {
      const of = (key) =>
        card.shadowRoot.querySelector(`yc-collection-gallery .gallery-item[data-mode="${key}"]`);
      const count = (node) => ({
        remove: node?.querySelectorAll(".yc-item-delete").length,
        rename: node?.querySelectorAll(".yc-item-rename").length,
      });
      return { mine: count(of("custom:mine")), builtin: count(of("Rainbow")) };
    });
    assert.deepEqual(controls, {
      mine: { remove: 1, rename: 1 },
      builtin: { remove: 0, rename: 0 },
    }, "only user-owned items get rename / delete");
    const mine = 'yeelight-cube-clock-card yc-collection-gallery .gallery-item[data-mode="custom:mine"]';
    // Delete asks first and never selects the item.
    await page.locator(`${mine} .yc-item-delete`).click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => calls.length), 0, "delete: nothing before confirming");
    const bar = page.locator("yeelight-cube-clock-card .yc-item-manage");
    assert.match(await bar.innerText(), /Delete .Mine.\?/);
    await bar.locator('button:has-text("Delete")').click();
    assert.deepEqual(
      await waitForCall("delete_clock_preset", "confirmed delete"),
      { preset_id: "mine" },
    );
    await page.waitForTimeout(100);
    assert.equal(await bar.count(), 0, "the bar closes once deleted");
    // Rename through the same bar.
    await page.evaluate(() => (calls.length = 0));
    await page.locator(`${mine} .yc-item-rename`).click();
    const field = page.locator("yeelight-cube-clock-card .yc-item-manage input");
    assert.equal(await field.inputValue(), "Mine");
    await field.fill("Ours");
    await field.press("Enter");
    assert.deepEqual(
      await waitForCall("save_clock_preset", "rename"),
      { preset_id: "mine", name: "Ours", color: [10, 200, 30], kind: "style" },
    );
    assert.equal(
      await page.evaluate(() => calls.some((call) => call.service === "set_clock_style")),
      false,
      "managing an item never applies it",
    );
    // The shared delete-button settings: "none" hides it; rename stays off by default.
    await clockGrid({ remove_button_style: "none" });
    assert.deepEqual(
      await page.evaluate(() => {
        const node = card.shadowRoot.querySelector(
          'yc-collection-gallery .gallery-item[data-mode="custom:mine"]',
        );
        return [node.querySelectorAll(".yc-item-delete").length, node.querySelectorAll(".yc-item-rename").length];
      }),
      [0, 0],
    );
    await page.evaluate(() => {
      hass.states = { ...hass.states, "sensor.presets": window.savedPresets };
    });

    // --- Palette card: the shared gallery with the card's own previews -------
    await page.evaluate(() => {
      window.savedPalettes = hass.states["sensor.pal"];
      hass.states = {
        ...hass.states,
        "sensor.pal": {
          state: "2",
          attributes: {
            palettes_v2: [
              { name: "Warm", colors: [[255, 0, 0], [255, 160, 0]] },
              { name: "Sea", colors: [[0, 0, 255]] },
            ],
          },
        },
      };
      calls.length = 0;
    });
    const paletteCard = (extra) =>
      page.evaluate(
        (extra) =>
          mount("yeelight-cube-palette-card", {
            entity: "light.a",
            palette_sensor: "sensor.pal",
            ...extra,
          }),
        extra,
      );
    const paletteView = () =>
      page.evaluate(() => {
        const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
        return {
          previews: gallery.querySelectorAll("[data-mode] .yc-palette-preview").length,
          dots: gallery.querySelectorAll(".yc-palette-dot").length,
          meta: [...gallery.querySelectorAll(".gallery-item-metadata")].map((node) =>
            node.textContent.trim(),
          ),
          grid: !!gallery.querySelector('.gc-preview-shell[data-columns="2"]'),
          border: gallery.dataset.itemBorder,
          radius: gallery.style.getPropertyValue("--yc-item-radius"),
          empty: gallery.querySelector(".yc-gallery-empty")?.textContent.trim() || "",
        };
      });
    // Every preview layout shows the palettes' own swatches.
    for (const [style, shown] of [
      ["preview-list", 2],
      ["preview-grid", 2],
      ["preview-strip", 2],
      ["preview-carousel", 1],
      ["preview-wheel", 2],
      ["preview-album", 2],
    ]) {
      await paletteCard({ style_selector_style: style, swatch_style: "square" });
      const look = await paletteView();
      assert.equal(look.previews, shown, `palette ${style}: previews`);
      assert.ok(look.dots >= shown, `palette ${style}: one swatch per color`);
    }
    // Former options: "gallery" display is the two-column grid; the color
    // count is the item's meta line; the former look (16 px cards with a
    // border) is kept.
    await paletteCard({ display_mode: "gallery", swatch_style: "gradient" });
    assert.deepEqual(await paletteView(), {
      previews: 2,
      dots: 0,
      meta: ["2 colors", "1 color"],
      grid: true,
      border: "true",
      radius: "16px",
      empty: "",
    });
    await paletteCard({ show_color_count: false, item_card_border: "none", rounded_cards: 4 });
    const plain = await paletteView();
    assert.deepEqual([plain.meta, plain.border, plain.radius], [[], "false", "4px"]);
    // Chips show each palette's blend.
    await paletteCard({ style_selector_style: "chips" });
    assert.match(
      await page.evaluate(() =>
        card.shadowRoot.querySelector('.mode-chip[data-mode="palette:0"] .mode-chip-swatch').style.background,
      ),
      /linear-gradient/,
      "palette chips: the palette's colors",
    );
    // Items are keyboard buttons: Enter applies the palette.
    await paletteCard({ style_selector_style: "preview-list" });
    const sea = 'yeelight-cube-palette-card yc-collection-gallery .gallery-item[data-mode="palette:1"]';
    assert.deepEqual(
      await page.locator(sea).evaluate((node) => [node.getAttribute("role"), node.tabIndex, node.getAttribute("aria-label")]),
      ["button", 0, "Sea: Apply to the lamps"],
    );
    await page.locator(sea).focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await waitForCall("load_palette", "keyboard pick"), { entity_id: "light.a", idx: 1, expected_name: "Sea" });
    // Rename and delete through the shared bar (never by a single tap).
    await page.evaluate(() => (calls.length = 0));
    await paletteCard({ style_selector_style: "preview-list", allow_rename: true });
    const warm = 'yeelight-cube-palette-card yc-collection-gallery .gallery-item[data-mode="palette:0"]';
    await page.locator(`${warm} .yc-item-rename`).click();
    const paletteField = page.locator("yeelight-cube-palette-card .yc-item-manage input");
    assert.equal(await paletteField.inputValue(), "Warm");
    await paletteField.fill("Hot");
    await paletteField.press("Enter");
    assert.deepEqual(
      await waitForCall("rename_palette", "palette rename"),
      { idx: 0, name: "Hot", expected_name: "Warm" },
    );
    await page.locator(`${sea} .yc-item-delete`).click();
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() => calls.some((call) => call.service === "remove_palette")),
      false,
      "palette delete: nothing before confirming",
    );
    await page.locator('yeelight-cube-palette-card .yc-item-manage button:has-text("Delete")').click();
    assert.deepEqual(
      await waitForCall("remove_palette", "palette delete"),
      { idx: 1, expected_name: "Sea" },
    );
    assert.equal(
      await page.evaluate(() => calls.some((call) => call.service === "load_palette")),
      false,
      "managing a palette never applies it",
    );
    // The shared export / import row (Palette here, Draw below: the same).
    assert.deepEqual(
      await page.evaluate(() =>
        [...card.shadowRoot.querySelectorAll(".action-row button[data-action]")].map(
          (button) => [button.dataset.action, button.title],
        ),
      ),
      [
        ["export", "Export palettes to a JSON file"],
        ["import", "Import palettes from a JSON file"],
      ],
    );
    // The palette the lamp shows is the active one (highlighted), following
    // the lamp; A → Z order (gallery_sort) sorts by the name shown.
    const paletteActive = await page.evaluate(async () => {
      await mount("yeelight-cube-palette-card", {
        entity: "light.a",
        palette_sensor: "sensor.pal",
        style_selector_style: "preview-list",
      });
      const shown = () =>
        [...card.shadowRoot.querySelectorAll('yc-collection-gallery [data-active-mode="true"]')].map(
          (node) => node.dataset.mode,
        );
      const lamp = hass.states["light.a"];
      const showColors = async (text_colors) => {
        hass.states = { ...hass.states, "light.a": { ...lamp, attributes: { ...lamp.attributes, text_colors } } };
        card.hass = hass;
        await card.updateComplete;
        await card.shadowRoot.querySelector("yc-collection-gallery").updateComplete;
      };
      await showColors([[0, 0, 255]]);
      const sea = shown();
      await showColors([[255, 0, 0], [255, 160, 0]]);
      const warm = shown();
      await showColors([[1, 2, 3]]);
      const none = shown();
      hass.states = { ...hass.states, "light.a": lamp };
      card.setConfig({ ...card.config, gallery_sort: "name" });
      card.hass = hass;
      await card.updateComplete;
      await card.shadowRoot.querySelector("yc-collection-gallery").updateComplete;
      const order = [...card.shadowRoot.querySelectorAll("yc-collection-gallery .gallery-item[data-mode]")].map(
        (node) => node.getAttribute("aria-label").split(":")[0],
      );
      return { sea, warm, none, order };
    });
    assert.deepEqual(paletteActive, {
      sea: ["palette:1"],
      warm: ["palette:0"],
      none: [],
      order: ["Sea", "Warm"],
    });
    // No palettes: the card says so.
    await page.evaluate(() => {
      hass.states = { ...hass.states, "sensor.pal": { state: "0", attributes: { palettes_v2: [] } } };
    });
    await paletteCard({});
    assert.match((await paletteView()).empty, /No palettes found/);
    await page.evaluate(() => {
      hass.states = { ...hass.states, "sensor.pal": window.savedPalettes };
    });

    // --- Narrow cards: nothing wider than the card; arrows keep their tint ---
    // (a theme's --card-background-color can differ from the card's own).
    const narrow = await page.evaluate(async () => {
      const main = document.querySelector("main");
      const saved = main.style.cssText;
      main.style.cssText = "width:320px;--card-background-color:#1b2a4e";
      const results = {};
      for (const [tag, extra] of [
        ["yeelight-cube-palette-card", { palette_sensor: "sensor.pal" }],
        ["yeelight-cube-draw-card", { pixelart_sensor: "sensor.pixel" }],
      ])
        for (const style of ["preview-grid", "preview-album", "preview-carousel", "preview-wheel", "dropdown"]) {
          await mount(tag, { entity: "light.a", ...extra, style_selector_style: style, preview_size: 100 });
          await new Promise((resolve) => setTimeout(resolve, 100));
          const width = card.getBoundingClientRect().width;
          const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
          const arrow = gallery.querySelector(".carousel-nav-btn, .album-nav-btn, .wheel-nav-buttons button");
          results[`${tag.split("-")[2]} ${style}`] = {
            wide: [...gallery.querySelectorAll(".gallery-item, .collection-album-item, .wheel-item")]
              .filter((node) => node.getBoundingClientRect().width > width + 1).length,
            arrow: arrow ? getComputedStyle(arrow).backgroundColor : "",
            prompt: gallery.querySelector(".mode-select option[disabled]")?.textContent || "",
            selected: gallery.querySelector(".mode-select")?.value || "",
          };
        }
      main.style.cssText = saved;
      return results;
    });
    for (const [view, look] of Object.entries(narrow)) {
      assert.equal(look.wide, 0, `${view}: an item wider than the card`);
      if (/carousel|album|wheel/.test(view)) {
        assert.ok(look.arrow, `${view}: arrows`);
        assert.notEqual(look.arrow, "rgb(27, 42, 78)", `${view}: arrows take the theme's card color`);
      }
      // Palette: the lamp shows the first palette's colors (the active one,
      // selected); Draw: the canvas holds no pixel art (a prompt).
      if (view === "palette dropdown")
        assert.deepEqual([look.prompt, look.selected], ["", "palette:0"], view);
      if (view === "draw dropdown")
        assert.deepEqual([look.prompt, look.selected], ["Choose…", ""], view);
    }

    // --- Arrange: the user collections' order, one block in every editor -----
    await page.evaluate(() => {
      window.savedCollections = [hass.states["sensor.pal"], hass.states["sensor.pixel"]];
      hass.states = {
        ...hass.states,
        "sensor.pal": {
          state: "3",
          attributes: {
            count: 3,
            palettes_v2: [
              { name: "Warm", colors: [[255, 0, 0], [255, 160, 0]] },
              { name: "Sea", colors: [[0, 0, 255]] },
              { name: "<b>Bold</b>", colors: [[0, 255, 0]] },
            ],
          },
        },
        "sensor.pixel": {
          state: "2",
          attributes: {
            count: 2,
            pixel_arts: [
              { name: "Heart", pixels: [{ position: 3, color: [255, 0, 0] }] },
              { name: "Star", pixels: [{ position: [7, 8], color: [255, 255, 0] }] },
            ],
          },
        },
      };
    });
    const arrange = (tag, config) =>
      page.evaluate(
        async ({ tag, config }) => {
          calls.length = 0;
          const editor = await customElements.get(tag).getConfigElement();
          editor.hass = hass;
          editor.setConfig({ type: `custom:${tag}`, entity: "light.a", ...config });
          document.querySelector("main").replaceChildren(editor);
          await editor.updateComplete;
          for (const section of editor.shadowRoot.querySelectorAll(".editor-card-header")) {
            section.click();
            await editor.updateComplete;
          }
          const rows = () =>
            [...editor.shadowRoot.querySelectorAll(".orderable-list-row")].filter((row) =>
              row.querySelector(".collection-thumb"),
            );
          const names = () => rows().map((row) => row.querySelector(".orderable-list-name").textContent.trim());
          const before = names();
          const list = rows()[0].parentElement;
          const shape = {
            remove: rows().some((row) => row.querySelector("button.remove")),
            add: list.nextElementSibling?.classList.contains("orderable-add-row") ?? false,
            matrix: rows()[0].querySelector(".collection-thumb .gallery-matrix-preview")?.children.length ?? 0,
            injected: !!editor.shadowRoot.querySelector(".orderable-list-row b"),
            // Every row shown (the editor scrolls, not the list).
            full: getComputedStyle(list).maxHeight === "none",
          };
          rows()[0].querySelector(`button[title="${config.button || "Move down"}"]`).click();
          await editor.updateComplete;
          return { before, after: names(), shape, calls: calls.map(({ service, data }) => ({ service, data })) };
        },
        { tag, config },
      );
    const paletteArrange = await arrange("yeelight-cube-palette-card", { palette_sensor: "sensor.pal" });
    assert.deepEqual(paletteArrange.before, ["Warm", "Sea", "<b>Bold</b>"], "palettes listed in stored order");
    assert.deepEqual(paletteArrange.shape, { remove: false, add: false, matrix: 0, injected: false, full: true }, "arrange: order only, names as text, every row shown");
    assert.deepEqual(paletteArrange.after, ["Sea", "Warm", "<b>Bold</b>"], "the move shows at once");
    assert.deepEqual(paletteArrange.calls, [
      // ▼ swaps two neighbours: one move (the same result either way).
      { service: "move_palette", data: { from_idx: 1, to_idx: 0, expected_name: "Sea" } },
    ]);
    // ⤓ moves an item to the bottom in one guarded move.
    const toBottom = await arrange("yeelight-cube-palette-card", {
      palette_sensor: "sensor.pal",
      button: "Move to the bottom",
    });
    assert.deepEqual(toBottom.after, ["Sea", "<b>Bold</b>", "Warm"]);
    assert.deepEqual(toBottom.calls, [
      { service: "move_palette", data: { from_idx: 0, to_idx: 2, expected_name: "Warm" } },
    ]);
    const pixelArrange = await arrange("yeelight-cube-draw-card", { pixelart_sensor: "sensor.pixel" });
    assert.deepEqual(pixelArrange.before, ["Heart", "Star"], "pixel arts listed in stored order");
    assert.equal(pixelArrange.shape.matrix, 100, "pixel-art rows show their picture");
    assert.deepEqual(pixelArrange.after, ["Star", "Heart"]);
    assert.deepEqual(pixelArrange.calls, [
      { service: "move_pixel_art", data: { from_idx: 1, to_idx: 0, expected_name: "Star" } },
    ]);
    await page.evaluate(() => {
      const [pal, pixel] = window.savedCollections;
      hass.states = { ...hass.states, "sensor.pal": pal, "sensor.pixel": pixel };
    });

    // --- Album settings reach the shared, static album CSS ------------------
    // (album-view-coverflow.js: CSS variables set by renderAlbumView).
    const albumLook = (tag, config, prefix) =>
      page.evaluate(
        async ({ tag, config, prefix }) => {
          await mount(tag, config);
          await new Promise((resolve) => setTimeout(resolve, 100));
          const root = card.shadowRoot;
          const item = getComputedStyle(root.querySelector(`.${prefix}-album-item`));
          const box = getComputedStyle(root.querySelector(`.${prefix}-album-container`));
          return {
            width: item.width,
            radius: item.borderTopLeftRadius,
            padding: box.padding,
            perspective: box.perspective,
          };
        },
        { tag, config, prefix },
      );
    const tuned = {
      rounded_cards: "square",
      delete_button_inside: true,
      album_3d_effect: false,
      remove_button_style: "red",
    };
    assert.deepEqual(
      await albumLook("yeelight-cube-palette-card", { entity: "light.a", palette_sensor: "sensor.pal", display_mode: "album" }, "collection"),
      // The shared album at the palette's default Size (50%) and its former
      // 16 px card roundness (custom item radius).
      { width: "218px", radius: "16px", padding: "28px 14px", perspective: "1200px" },
      "palette album defaults",
    );
    assert.deepEqual(
      // Former palette options, migrated to the shared gallery's (the Size
      // stays within its 30-100% range; delete buttons sit on the items).
      await albumLook("yeelight-cube-palette-card", { entity: "light.a", palette_sensor: "sensor.pal", display_mode: "album", card_size: 150, ...tuned }, "collection"),
      { width: "437px", radius: "0px", padding: "28px 14px", perspective: "none" },
      "palette album settings",
    );
    assert.deepEqual(
      await albumLook("yeelight-cube-draw-card", { entity: "light.a", pixelart_sensor: "sensor.pixel", pixel_art_gallery_mode: "album" }, "collection"),
      { width: "240px", radius: "16px", padding: "28px 14px", perspective: "1200px" },
      "pixel-art album defaults",
    );
    assert.deepEqual(
      // The former album size (240 px at 100%; 150 -> 82% of the shared
      // Size), delete buttons on the items.
      await albumLook("yeelight-cube-draw-card", { entity: "light.a", pixelart_sensor: "sensor.pixel", pixel_art_gallery_mode: "album", pixel_art_preview_size: 150, ...tuned }, "collection"),
      { width: "362px", radius: "0px", padding: "28px 14px", perspective: "none" },
      "pixel-art album settings",
    );

    // --- The shared card frame (card-shell.js) on every card and editor ----
    const CARDS = {
      clock: {},
      "native-effects": {},
      "lamp-preview": {},
      draw: { pixelart_sensor: "sensor.pixel" },
      gradient: {},
      palette: { palette_sensor: "sensor.pixel" },
      "color-list-editor": {},
    };
    for (const [name, extra] of Object.entries(CARDS)) {
      const tag = `yeelight-cube-${name}-card`;
      const frame = (config) =>
        page.evaluate(
          async ({ tag, config }) => {
            await mount(tag, config);
            await new Promise((resolve) => setTimeout(resolve, 100));
            await card.updateComplete;
            const root = card.shadowRoot;
            return {
              cards: root.querySelectorAll("ha-card").length,
              plain: !!root.querySelector("ha-card.yc-card.yc-card-plain"),
              title: root.querySelector(".yc-card-title")?.textContent.trim() ?? null,
              status: root.querySelector(".yc-card-status")?.textContent.trim() ?? null,
              notice: root.querySelector(".yc-card-notice")?.textContent.trim() ?? null,
              muted: root.querySelector(".yc-card-muted")?.textContent.trim() ?? null,
            };
          },
          { tag, config },
        );
      const lamp = { entity: "light.a", target_entities: ["light.a"], ...extra };
      assert.deepEqual(
        await frame({ ...lamp, title: "Desk", show_lamp_status: true }),
        { cards: 1, plain: false, title: "Desk", status: "Custom Draw", notice: null, muted: null },
        `${name}: shared header`,
      );
      assert.deepEqual(
        await frame({ ...lamp, show_card_background: false }),
        { cards: 1, plain: true, title: null, status: null, notice: null, muted: null },
        `${name}: no header without title/status, plain frame`,
      );
      if (name !== "draw" && name !== "palette")
        assert.equal(
          (await frame({ ...extra })).notice,
          "Select a Yeelight Cube lamp in the card editor.",
          `${name}: shared no-lamp notice`,
        );
      const gone = { ...extra, entity: "light.gone", target_entities: ["light.gone"] };
      if (name === "clock" || name === "native-effects")
        // These stay usable (browse and preview) with the shared line.
        assert.equal((await frame(gone)).muted, "Lamp unavailable", `${name}: unavailable line`);
      else if (name !== "draw" && name !== "palette")
        assert.match(
          (await frame(gone)).notice ?? "",
          /Lamp not found: light\.gone/,
          `${name}: shared lamp-not-found notice`,
        );

      // Its editor: the same settings, in the same order, reporting the
      // same option names.
      const editor = await page.evaluate(
        async ({ tag, lamp }) => {
          // The way Home Assistant opens it (loads the editor module).
          const editor = await customElements.get(tag).getConfigElement();
          editor.hass = hass;
          editor.setConfig({ type: `custom:${tag}`, ...lamp });
          document.querySelector("main").replaceChildren(editor);
          await editor.updateComplete;
          const root = editor.shadowRoot;
          const ids = [...root.querySelectorAll("#title, #show_card_background, #show_lamp_status")]
            .map((el) => el.id);
          const changes = [];
          editor.addEventListener("config-changed", (event) =>
            changes.push(event.detail.config),
          );
          const title = root.querySelector("#title");
          title.value = "Kitchen";
          title.dispatchEvent(new Event("input"));
          await editor.updateComplete;
          const status = root.querySelector("#show_lamp_status");
          status.checked = true;
          status.dispatchEvent(new Event("change"));
          await editor.updateComplete;
          const last = changes.at(-1) || {};
          return {
            ids,
            title: last.title,
            status: last.show_lamp_status,
            lamps: last.target_entities,
          };
        },
        { tag, lamp },
      );
      assert.deepEqual(
        editor,
        {
          ids: ["title", "show_card_background", "show_lamp_status"],
          title: "Kitchen",
          status: true,
          lamps: ["light.a"],
        },
        `${name}: shared card-frame settings in the editor`,
      );
    }

    assert.deepEqual(errors, []);
    console.log(
      `PASS delegated events: ${SLIDER_STYLES.length} slider styles, orientation x2, clock/native sliders, draw gallery, gradient capsule and mode gallery (strict CSP, no inline handlers); hostile names inert in 4 palette + 4 pixel-art modes and clock presets`,
    );
    console.log(
      "PASS shared card frame on all 7 cards and editors: title, lamp status, plain background, no-lamp / not-found notices, same editor settings",
    );
    console.log(
      "PASS palette card on the shared gallery: its swatches in 6 layouts and chips, color count, former options migrated, keyboard picks, rename / confirmed delete, the palette the lamp shows active, A → Z order, empty notice",
    );
    console.log(
      "PASS Draw card on the shared gallery: former options, previews as drawn, load (and lamp) / rename / confirmed delete, carousel and wheel moves only browse, memoized items, shared export / import row; narrow cards never overflow and arrows keep their tint",
    );
    console.log(
      "PASS Arrange (Palette and Draw editors): stored order with thumbnails, order only, one guarded move per change (▲ ▼ ⤒ ⤓, drag) shown at once",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
