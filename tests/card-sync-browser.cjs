// Real-browser check that two dashboards on the same lamp stay in sync:
// favourites (stored on the lamp), rotation status and the freeze indicator.
// A fake backend applies the services and pushes the new lamp state to both
// cards after a delay, like Home Assistant does.
//
//   node tests/card-sync-browser.cjs
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

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/sync.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><main style='display:flex;gap:16px'></main>",
      }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/sync.html`);

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
      await import(
        "/custom_components/yeelight_cube/www/yeelight-cube-native-effects-card.js"
      );
      await import("/custom_components/yeelight_cube/www/yeelight-cube-clock-card.js");
      // One lamp, shared by both dashboards.
      window.lamp = {
        state: "on",
        attributes: {
          brightness: 255,
          content_mode: "Native Effect",
          device_orientation: "right",
          native_effect: "Rainbow",
          native_effect_color_mode: "normal",
          native_effect_color: null,
          native_effect_speed: 50,
          native_effect_catalog: ["Rainbow", "Tide", "Starry sky"].map((name) => ({
            name,
            speed: true,
            directions: ["Up", "Down", "Left", "Right"],
          })),
          display_frozen: false,
          favourites: {}, // backend with shared favourites, none saved yet
          effect_rotation: { active: false, kind: "native", items: [], interval: 60 },
          rotation_intervals: {}, // backend with shared intervals, none set yet
        },
      };
      window.cards = [];
      window.calls = [];
      // HA replaces the states object on every change, then pushes it.
      const push = () => {
        const hass = makeHass();
        for (const card of cards) card.hass = hass;
      };
      window.pushLater = (change, delay = 120) =>
        setTimeout(() => {
          change(lamp.attributes);
          lamp.attributes = { ...lamp.attributes };
          push();
        }, delay);
      window.makeHass = () => ({
        states: { "light.a": { ...lamp, attributes: lamp.attributes } },
        themes: {},
        callWS: async () => ({}),
        callService: async (domain, service, data) => {
          calls.push({ domain, service, data });
          if (service === "set_favourites")
            pushLater((a) => {
              a.favourites = {
                ...a.favourites,
                [data.kind]: data.favourites.map((item) => ({
                  color: null,
                  color_mode: "normal",
                  ...item,
                })),
              };
            });
          if (service === "start_effect_rotation")
            pushLater((a) => {
              a.effect_rotation = {
                active: true,
                kind: data.kind,
                items: data.items,
                interval: data.interval,
                index: 0,
              };
              a.rotation_intervals = {
                ...a.rotation_intervals,
                [data.kind]: data.interval,
              };
            });
          if (service === "set_rotation_interval")
            pushLater((a) => {
              a.rotation_intervals = {
                ...a.rotation_intervals,
                [data.kind]: data.interval,
              };
              if (a.effect_rotation.active && a.effect_rotation.kind === data.kind)
                a.effect_rotation = { ...a.effect_rotation, interval: data.interval };
            });
          if (service === "stop_effect_rotation")
            pushLater((a) => {
              a.effect_rotation = { ...a.effect_rotation, active: false };
            });
          // Applied in the background: the frozen state arrives later.
          if (service === "freeze_display")
            pushLater((a) => (a.display_frozen = true), 300);
          if (service === "set_native_effect")
            pushLater((a) => {
              a.native_effect = data.effect ?? a.native_effect;
              a.display_frozen = false;
            });
        },
      });
      window.pushNow = push;
      for (const id of ["one", "two"]) {
        const card = document.createElement("yeelight-cube-native-effects-card");
        card.id = id;
        card.setConfig({
          entity: "light.a",
          show_favourites: true,
          show_rotation: true,
          show_actions: true,
          rotation_interval: 45,
        });
        card.hass = makeHass();
        card.style.width = "600px";
        document.querySelector("main").append(card);
        cards.push(card);
        await card.updateComplete;
      }
      // Record every favourites count each dashboard ever renders.
      window.seen = { one: [], two: [] };
      const watch = () => {
        for (const card of cards) {
          if (!card._controls) continue; // the editor
          const list = (seen[card.id] ||= []);
          const count = card._controls.favourites.length;
          if (list.at(-1) !== count) list.push(count);
        }
        requestAnimationFrame(watch);
      };
      watch();
    });

    const one = "#one";
    const two = "#two";
    const favourites = (id) =>
      page.evaluate((id) => document.querySelector(id)._controls.favourites.map((f) => f.key), id);
    const waitFor = (fn, arg, label) =>
      page.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {
        throw new Error(`Timed out: ${label}`);
      });

    // Section headers keep their buttons right-aligned (like the rotation
    // summary row), on both cards.
    const headerAligned = (id) =>
      page.evaluate((id) => {
        const controls = [...document.querySelector(id).shadowRoot.querySelectorAll("yeelight-mode-controls")]
          .map((el) => el.shadowRoot)
          .find((root) => root?.querySelector("section header .tools, section header div"));
        const header = controls.querySelector("section header");
        const tools = header.lastElementChild;
        const gap = header.getBoundingClientRect().right - tools.getBoundingClientRect().right;
        return getComputedStyle(header).justifyContent === "space-between" && gap < 2;
      }, id);
    assert.ok(await headerAligned(one), "native favourites buttons on the right");

    // 1. Add a favourite on dashboard one: dashboard two shows it too.
    await page.locator(`${one} [aria-label="Add favourite"]`).first().click();
    assert.deepEqual(await favourites(one), ["Rainbow"]); // at once
    await waitFor(
      () => document.querySelector("#two")._controls.favourites.length === 1,
      null,
      "favourite reaches the second dashboard",
    );
    assert.deepEqual(await favourites(two), ["Rainbow"]);
    const saved = await page.evaluate(() =>
      calls.filter((call) => call.service === "set_favourites"),
    );
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].data, {
      kind: "native",
      favourites: [{ name: "Rainbow", color_mode: "normal" }],
      entity_id: "light.a",
    });

    // 2. The lamp shows another effect; add it from dashboard two.
    await page.evaluate(() =>
      pushLater((a) => (a.native_effect = "Tide"), 0),
    );
    await waitFor(
      () => document.querySelector("#two")._controls.adapter.current() === "Tide",
      null,
      "lamp effect change",
    );
    await page.locator(`${two} [aria-label="Add favourite"]`).first().click();
    await waitFor(
      () => document.querySelector("#one")._controls.favourites.length === 2,
      null,
      "second favourite reaches dashboard one",
    );
    assert.deepEqual(await favourites(one), ["Rainbow", "Tide"]);

    // No dashboard ever showed a list jumping back while the lamp caught up.
    const seen = await page.evaluate(() => seen);
    assert.deepEqual(seen.one, [0, 1, 2], "dashboard one never flickered");
    assert.deepEqual(seen.two, [0, 1, 2], "dashboard two never flickered");

    // 3. The rotation interval is the lamp's: set from a card editor (2 min,
    //    then + 10 s), every dashboard follows, and Start uses it.
    const sectionText = (id) =>
      page.evaluate(
        (id) =>
          [...document.querySelector(id).shadowRoot.querySelectorAll("yeelight-mode-controls")]
            .map((el) => el.shadowRoot?.textContent || "")
            .join(" ")
            .replace(/\s+/g, " "),
        id,
      );
    assert.match(await sectionText(one), /every 45s/); // card default so far
    // Set from a card editor (not on the card): rows add up, stored on the lamp.
    await page.evaluate(async () => {
      await import(
        "/custom_components/yeelight_cube/www/yeelight-cube-native-effects-card-editor.js"
      );
      const editor = document.createElement("yeelight-cube-native-effects-card-editor");
      editor.id = "editor";
      editor._open = { rotation: true };
      editor.setConfig({ ...document.querySelector("#two").config, show_rotation: true });
      editor.hass = makeHass();
      // Like Home Assistant: an edited config is handed back to the editor.
      editor.addEventListener("config-changed", (event) =>
        editor.setConfig(event.detail.config),
      );
      document.querySelector("main").append(editor);
      cards.push(editor); // receives every state update, like in Home Assistant
      await editor.updateComplete;
    });
    const editorSel = "#editor";
    await page.locator(`${editorSel} [aria-label="Rotation interval unit"]`).selectOption("minutes");
    await page.locator(`${editorSel} [aria-label="Rotation interval value"]`).fill("2");
    await page.locator(`${editorSel} [aria-label="Rotation interval value"]`).press("Enter");
    await waitFor(
      () => calls.some((c) => c.service === "set_rotation_interval" && c.data.interval === 120),
      null,
      "interval saved on the lamp",
    );
    await waitFor(
      () => document.querySelector("#one")._controls.interval === 120,
      null,
      "interval reaches dashboard one",
    );
    assert.match(await sectionText(one), /every 2min/);
    // Compose: + 10 seconds = 2 min 10 s. The new row takes an unused unit,
    // and no row offers a unit another row already uses.
    await page.locator(`${editorSel} button:has-text("+ Add interval")`).click();
    const unitOptions = (label) =>
      page.evaluate(
        ({ label }) =>
          [
            ...document
              .querySelector("#editor")
              .shadowRoot.querySelector(`select[aria-label="${label}"]`).options,
          ].map((option) => option.value),
        { label },
      );
    assert.deepEqual(await unitOptions("Rotation interval unit 2"), ["seconds", "hours", "days"]);
    assert.deepEqual(await unitOptions("Rotation interval unit"), ["minutes", "hours", "days"]);
    await page.locator(`${editorSel} [aria-label="Rotation interval value 2"]`).fill("10");
    await page.locator(`${editorSel} [aria-label="Rotation interval value 2"]`).press("Enter");
    await waitFor(
      () => calls.some((c) => c.service === "set_rotation_interval" && c.data.interval === 130),
      null,
      "composed interval saved",
    );
    await waitFor(
      () => document.querySelector("#two")._controls.interval === 130,
      null,
      "composed interval reaches dashboard two",
    );
    assert.match(await sectionText(two), /every 2min 10s/);
    await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      cards.splice(cards.indexOf(editor), 1);
      editor.remove();
    });

    // 4. Start rotation on dashboard one: dashboard two shows it running,
    //    with the lamp's list and interval, and can stop it.
    await page.locator(`${one} [aria-label="Start rotation"]`).first().click();
    await waitFor(
      () =>
        document
          .querySelector("#two")
          .shadowRoot.querySelector("yeelight-mode-controls")
          ?.shadowRoot?.textContent.includes("Running") ||
        [...document.querySelector("#two").shadowRoot.querySelectorAll("yeelight-mode-controls")].some(
          (el) => el.shadowRoot?.textContent.includes("Running"),
        ),
      null,
      "rotation status reaches dashboard two",
    );
    const rotationText = await page.evaluate(() =>
      [...document.querySelector("#two").shadowRoot.querySelectorAll("yeelight-mode-controls")]
        .map((el) => el.shadowRoot?.textContent || "")
        .join(" "),
    );
    assert.match(rotationText, /2 effects · every 2min 10s/);
    assert.equal(
      await page.evaluate(
        () => calls.find((c) => c.service === "start_effect_rotation").data.interval,
      ),
      130,
    );
    assert.ok(
      await page.locator(`${two} [aria-label="Stop rotation"]`).count(),
      "dashboard two can stop the rotation",
    );
    await page.locator(`${two} [aria-label="Stop rotation"]`).first().click();
    await waitFor(
      () => document.querySelector("#one")._controls.active === false &&
        document.querySelector("#one")._controls.adapter.rotationActive() === false,
      null,
      "stop reaches dashboard one",
    );

    // 5. Freeze on dashboard two: dashboard one shows it frozen as well, and
    //    the dashboard that froze never flips back while the lamp catches up.
    await page.locator(`${two} [aria-label="Freeze effect"]`).first().click();
    await page.waitForTimeout(100); // before the lamp reports the freeze
    assert.equal(
      await page.locator(`${two} [aria-label="Resume effect"]`).count() > 0,
      true,
      "dashboard two shows the freeze at once",
    );
    await waitFor(
      () => document.querySelector("#one")._controls.frozen === true,
      null,
      "frozen state reaches dashboard one",
    );
    assert.ok(await page.locator(`${one} [aria-label="Resume effect"]`).count());
    assert.equal(
      await page.evaluate(() => document.querySelector("#two")._controls.frozen),
      true,
    );
    // Resume from dashboard one: dashboard two follows.
    await page.locator(`${one} [aria-label="Resume effect"]`).first().click();
    await waitFor(
      () => document.querySelector("#two")._controls.frozen === false,
      null,
      "resume reaches dashboard two",
    );

    // 6. Rotation steps in the effect list: the list turns to the page of the
    //    playing effect; with "Highlight the playing effect" off it keeps the
    //    user's selection, page and colour mode. The interval is not edited on
    //    the card (editor only).
    assert.equal(
      await page.locator(`${one} [aria-label="Rotation interval value"]`).count(),
      0,
      "no interval control on the card",
    );
    await page.evaluate(async () => {
      for (const card of cards) {
        card.setConfig({
          ...card.config,
          show_gallery: true,
          show_color_modes: true,
          style_selector_style: "preview-grid",
          items_per_page: 1,
          rotation_follow_active: card.id === "one",
        });
        card.hass = makeHass();
        await card.updateComplete;
      }
      // The lamp shows Rainbow (page 1), in its normal colours.
      pushLater((a) => {
        a.native_effect = "Rainbow";
        a.native_effect_color_mode = "normal";
      }, 0);
    });
    const browserState = (id) =>
      page.evaluate((id) => {
        const card = document.querySelector(id);
        const browser = card.shadowRoot.querySelector("yeelight-style-browser");
        const colours = card.shadowRoot.querySelector("yeelight-color-mode");
        return {
          page: browser.page,
          active: browser.activeKey,
          colour: colours?.selected ?? null,
        };
      }, id);
    await page.waitForTimeout(250);
    assert.deepEqual((await browserState(one)).page, 0);
    // A rotation runs; its next step is Tide (page 2) in red/blue.
    await page.evaluate(() =>
      pushLater((a) => {
        a.effect_rotation = {
          active: true,
          kind: "native",
          items: [{ name: "Rainbow" }, { name: "Tide", color_mode: "red_blue" }],
          interval: 5,
          index: 0,
        };
      }, 0),
    );
    await page.waitForTimeout(250);
    await page.evaluate(() =>
      pushLater((a) => {
        a.native_effect = "Tide";
        a.native_effect_color_mode = "red_blue";
        a.effect_rotation = { ...a.effect_rotation, index: 1 };
      }, 0),
    );
    await waitFor(
      () =>
        document.querySelector("#one").shadowRoot.querySelector("yeelight-style-browser")
          .activeKey === "Tide",
      null,
      "rotation step highlighted",
    );
    const following = await browserState(one);
    assert.equal(following.page, 1, "list turned to the playing effect's page");
    assert.equal(following.colour, "red_blue");
    const holding = await browserState(two);
    assert.deepEqual(
      [holding.page, holding.active, holding.colour],
      [0, "Rainbow", "normal"],
      "following off: selection, page and colour mode kept",
    );
    // The favourites highlight has its own switch (on): it still follows.
    assert.equal(
      await page.evaluate(
        () => document.querySelector("#two")._controls.currentFavourite().key,
      ),
      "Tide",
    );
    // Stopped: every list follows the lamp again.
    await page.evaluate(() =>
      pushLater((a) => {
        a.effect_rotation = { ...a.effect_rotation, active: false };
      }, 0),
    );
    await waitFor(
      () =>
        document.querySelector("#two").shadowRoot.querySelector("yeelight-style-browser")
          .activeKey === "Tide",
      null,
      "after stop, dashboard two follows again",
    );

    // 7. Clock cards: favourites and the rotation list reach the other
    //    dashboard too, and stay listed when a second lamp is unavailable.
    await page.evaluate(async () => {
      document.querySelector("main").replaceChildren();
      cards.length = 0;
      lamp.attributes = {
        ...lamp.attributes,
        content_mode: "Clock",
        clock_style: "Rainbow",
        clock_style_id: 1,
        clock_color_mode: "normal",
      };
      for (const id of ["clockone", "clocktwo"]) {
        const card = document.createElement("yeelight-cube-clock-card");
        card.id = id;
        card.setConfig({
          entity: "light.a",
          show_favourites: true,
          show_rotation: true,
        });
        card.hass = makeHass();
        card.style.width = "600px";
        document.querySelector("main").append(card);
        cards.push(card);
        await card.updateComplete;
      }
    });
    assert.ok(await headerAligned("#clockone"), "clock favourites buttons on the right");
    await page.locator('#clockone [aria-label="Add favourite"]').first().click();
    await page.evaluate(() => pushLater((a) => (a.clock_style = "Ocean Waves", a.clock_style_id = 2), 0));
    await waitFor(
      () => document.querySelector("#clockone")._controls.adapter.current() === "Ocean Waves",
      null,
      "clock style change",
    );
    await page.locator('#clockone [aria-label="Add favourite"]').first().click();
    await waitFor(
      () => document.querySelector("#clocktwo")._controls.favourites.length === 2,
      null,
      "clock favourites reach the second dashboard",
    );
    assert.match(
      await sectionText("#clocktwo"),
      // Intervals are per kind: none set for Clock yet, so the card default.
      /Clock Mode Rotation.*2 clock modes · every 1min.*Rainbow \/ Ocean Waves/,
    );
    // A second target lamp unavailable: status unknown, favourites still listed.
    await page.evaluate(async () => {
      const card = document.querySelector("#clocktwo");
      card.setConfig({ ...card.config, entity: undefined, target_entities: ["light.a", "light.b"] });
      const hass = makeHass();
      hass.states["light.b"] = { state: "unavailable", attributes: {} };
      card.hass = hass;
      await card.updateComplete;
    });
    await page.waitForTimeout(200);
    assert.match(
      await sectionText("#clocktwo"),
      /Status unavailable.*2 clock modes.*Rainbow \/ Ocean Waves/,
    );

    assert.deepEqual(errors, []);
    console.log(
      "PASS two dashboards stay in sync: native + clock favourites (no flicker), shared rotation interval, rotation status/list/stop, freeze and resume; clock list shown with an unavailable lamp; rotation steps turn pages / hold with following off; no interval control on the card",
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
