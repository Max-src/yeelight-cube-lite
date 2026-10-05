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

    // --- Draw pixel-art gallery ------------------------------------------------
    const draw = "yeelight-cube-draw-card";
    await page.evaluate(
      (tag) =>
        mount(tag, {
          entity: "light.a",
          pixelart_sensor: "sensor.pixel",
          pixel_art_gallery_mode: "gallery",
          pixel_art_allow_rename: true,
          show_pixel_art_gallery: true,
        }),
      draw,
    );
    const drawCalls = await page.evaluate(() => {
      const seen = [];
      for (const name of ["handleGridItemClick", "handleGridTitleClick", "handleGridDelete"])
        card[name] = (event, idx) => seen.push([name, event.type, idx]);
      window.drawSeen = seen;
      return card.shadowRoot.querySelectorAll(".gallery-item").length;
    });
    assert.ok(drawCalls >= 2, "draw: gallery items rendered");
    await page.locator(`${draw} .gallery-item-image`).nth(1).click();
    await page.locator(`${draw} .gallery-item-title`).nth(1).click();
    await page.locator(`${draw} .gallery-item button`).nth(1).click();
    // Each click reaches exactly its own handler once (title and delete stop
    // the event, as their inline handlers did).
    assert.deepEqual(await page.evaluate(() => drawSeen), [
      ["handleGridItemClick", "click", 1],
      ["handleGridTitleClick", "click", 1],
      ["handleGridDelete", "click", 1],
    ]);

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
    const tunedLook = { width: "360px", radius: "0px", padding: "12px 0px", perspective: "none" };
    assert.deepEqual(
      await albumLook("yeelight-cube-palette-card", { entity: "light.a", palette_sensor: "sensor.pal", display_mode: "album" }, "palettes"),
      { width: "120px", radius: "16px", padding: "28px 14px", perspective: "1200px" },
      "palette album defaults",
    );
    assert.deepEqual(
      await albumLook("yeelight-cube-palette-card", { entity: "light.a", palette_sensor: "sensor.pal", display_mode: "album", card_size: 150, ...tuned }, "palettes"),
      tunedLook,
      "palette album settings",
    );
    assert.deepEqual(
      await albumLook("yeelight-cube-draw-card", { entity: "light.a", pixelart_sensor: "sensor.pixel", pixel_art_gallery_mode: "album" }, "pixelarts"),
      { width: "240px", radius: "16px", padding: "28px 14px", perspective: "1200px" },
      "pixel-art album defaults",
    );
    assert.deepEqual(
      await albumLook("yeelight-cube-draw-card", { entity: "light.a", pixelart_sensor: "sensor.pixel", pixel_art_gallery_mode: "album", pixel_art_preview_size: 150, ...tuned }, "pixelarts"),
      tunedLook,
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
      `PASS delegated events: ${SLIDER_STYLES.length} slider styles, orientation x2, clock/native sliders, draw gallery, gradient capsule (strict CSP, no inline handlers); hostile names inert in 4 palette + 4 pixel-art modes and clock presets`,
    );
    console.log(
      "PASS shared card frame on all 7 cards and editors: title, lamp status, plain background, no-lamp / not-found notices, same editor settings",
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
