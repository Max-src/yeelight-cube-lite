const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
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
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".html")
          ? "text/html"
          : "text/plain",
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
  try {
    const startup = await browser.newPage();
    const address = `http://127.0.0.1:${server.address().port}/README.md`;
    const dependency = "**/www/html-escape-utils.js";
    await startup.route(dependency, (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Injected startup failure",
      }),
    );
    await startup.goto(address);
    await startup.evaluate(
      () =>
        import("/custom_components/yeelight_cube/www/frontend-diagnostics.js"),
    );
    const loadCards = async () => {
      const base = "/custom_components/yeelight_cube/www/";
      const names = [
        "lamp-preview",
        "gradient",
        "draw",
        "palette",
        "color-list-editor",
        "clock",
        "native-effects",
      ];
      const results = await Promise.allSettled(
        names.map((name) => import(`${base}yeelight-cube-${name}-card.js`)),
      );
      await import(`${base}yeelight-cube-font-editor-card.js`);
      return {
        status: results.map((result) => result.status),
        registered: names.map(
          (name) => !!customElements.get(`yeelight-cube-${name}-card`),
        ),
        font: !!customElements.get("yeelight-cube-font-editor-card"),
      };
    };
    const failedStartup = await startup.evaluate(loadCards);
    assert.ok(failedStartup.status.every((status) => status === "rejected"));
    assert.ok(failedStartup.registered.every((registered) => !registered));
    assert.equal(failedStartup.font, true);
    const failedReport = await startup.evaluate(() =>
      window.yeelightCubeDiagnostics.report(),
    );
    assert.ok(
      Object.values(failedReport.current.cards).every(
        (registered) => !registered,
      ),
    );
    assert.ok(
      failedReport.current.resources.some((resource) =>
        resource.path.endsWith("html-escape-utils.js"),
      ),
    );
    await startup.evaluate(() => {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      const errorCard = document.createElement("hui-error-card");
      errorCard.error =
        "Custom element does not exist: yeelight-cube-gradient-card";
      root.append(errorCard);
      document.body.append(host);
      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "Module error at /yeelight_cube/example.js?token=secret",
          filename: `${location.origin}/yeelight_cube/example.js?token=secret`,
          lineno: 12,
        }),
      );
    });
    const errorReport = await startup.evaluate(() =>
      window.yeelightCubeDiagnostics.report(),
    );
    assert.ok(
      errorReport.current.events.some(
        (event) => event.kind === "javascript-error" && event.line === 12,
      ),
    );
    assert.ok(
      errorReport.current.events.some((event) =>
        event.cardErrors?.some((message) =>
          message.includes("yeelight-cube-gradient-card"),
        ),
      ),
    );
    assert.ok(!JSON.stringify(errorReport).includes("token=secret"));
    await startup.unroute(dependency);
    const sameDocument = await startup.evaluate(loadCards);
    assert.ok(sameDocument.registered.every((registered) => !registered));
    await startup.reload();
    await startup.evaluate(
      () =>
        import("/custom_components/yeelight_cube/www/frontend-diagnostics.js"),
    );
    const recoveredStartup = await startup.evaluate(loadCards);
    assert.ok(recoveredStartup.registered.every(Boolean));
    const recoveredReport = await startup.evaluate(() =>
      window.yeelightCubeDiagnostics.report(),
    );
    assert.ok(
      Object.values(recoveredReport.previous.cards).every(
        (registered) => !registered,
      ),
    );
    assert.ok(Object.values(recoveredReport.current.cards).every(Boolean));
    assert.ok(
      recoveredReport.previous.events.some(
        (event) => event.kind === "javascript-error",
      ),
    );
    await startup.evaluate(() => {
      for (let index = 0; index < 60; index++)
        window.dispatchEvent(new Event("offline"));
      if (window.yeelightCubeDiagnostics.report().current.events.length > 40)
        throw Error("Diagnostic buffer exceeded its limit");
      window.yeelightCubeDiagnostics.stop();
      window.yeelightCubeDiagnostics.clear();
    });
    await startup.close();
    console.log(
      "PASS injected shared-module failure blocks all seven main cards until reload; standalone Font Editor survives",
    );
    if (process.env.STARTUP_ONLY) return;
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/README.md`);
    await page.setContent(
      "<style>body{font:14px sans-serif;--primary-color:#529ac5;--primary-text-color:#222;--secondary-text-color:#666;--card-background-color:white;--divider-color:#ddd}main{display:flex;gap:16px;align-items:start}ha-card{display:block}</style><main></main>",
    );
    await page.evaluate(async () => {
      document.body.style.color = "var(--primary-text-color)";
      customElements.define(
        "ha-icon",
        class extends HTMLElement {
          constructor() {
            super();
            this.attachShadow({ mode: "open" }).innerHTML =
              "<style>:host{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center}</style><span>*</span>";
          }
        },
      );
      // Real Home Assistant <ha-card> is a LitElement whose <slot> only exists
      // after its first async update. Light-DOM children of a freshly created
      // <ha-card> are therefore NOT rendered (and not focusable) synchronously.
      // Mirror that here so focus/typing regressions match production.
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
      const base = "/custom_components/yeelight_cube/www/";
      for (const file of [
        "yeelight-cube-clock-card",
        "yeelight-cube-native-effects-card",
        "yeelight-cube-clock-card-editor",
        "yeelight-cube-native-effects-card-editor",
      ])
        await import(base + file + ".js");
      const attrs = {
        native_effect: "Rainbow",
        native_effect_color_mode: "normal",
        native_effect_color: null,
        native_effect_speed: 50,
        brightness: 255,
        content_mode: "Native Effect",
        device_orientation: "right",
        clock_style: "Rainbow",
        clock_style_id: 1,
        clock_color_mode: "normal",
        native_effect_catalog: ["Rainbow", "Tide", "Starry sky"].map(
          (name) => ({
            name,
            speed: true,
            directions: ["Up", "Down", "Left", "Right"],
          }),
        ),
      };
      window.calls = [];
      window.hass = {
        services: { yeelight_cube: { save_clock_preset: {} } },
        states: {
          "light.a": { state: "on", attributes: attrs },
          library: {
            attributes: {
              clock_presets: [
                {
                  id: "yellow",
                  name: "SUPER YELLOW",
                  kind: "color_mode",
                  color: [255, 255, 0],
                },
                {
                  id: "red",
                  name: "Dark Red",
                  kind: "color_mode",
                  color: [160, 40, 40],
                },
                {
                  id: "mysolid",
                  name: "My Solid",
                  kind: "style",
                  color: [12, 34, 56],
                },
              ],
            },
          },
        },
        callService: async (domain, service, data) => {
          calls.push({ domain, service, data });
        },
      };
      window.baseConfig = {
        entity: "light.a",
        show_color_modes: true,
        show_save_clock_style_button: false,
        show_preview: false,
        show_gallery: false,
        show_actions: false,
        show_device_orientation: false,
        show_brightness: false,
        show_animation_speed: false,
      };
      for (const [key, tag] of [
        ["clock", "clock"],
        ["native", "native-effects"],
      ]) {
        const card = (window[key] = document.createElement(
          `yeelight-cube-${tag}-card`,
        ));
        card.setConfig(baseConfig);
        card.hass = hass;
        document.querySelector("main").append(card);
        if (card.updateComplete) await card.updateComplete;
      }
      window.configure = async (config, width, draft) => {
        for (const card of [clock, native]) {
          card.setConfig({ ...baseConfig, ...config });
          card.hass = hass;
          card.style.width = `${width + 28}px`;
          card.style.flexShrink = "0";
        }
        clock._customMode = !!draft;
        clock._customDraft = draft;
        clock.render();
        native._customColorDraft = draft;
        await native.updateComplete;
        for (const card of [clock, native]) {
          const actualWidth = card.shadowRoot
            .querySelector(".unified-color-modes")
            .getBoundingClientRect().width;
          card.style.width = `${width + 28 + width - actualWidth}px`;
        }
        for (const card of [clock, native])
          await card.shadowRoot.querySelector("yeelight-clock-preset-manager")
            ?.updateComplete;
        const buttons = [clock, native].flatMap((card) => [
          ...card.shadowRoot.querySelectorAll(".unified-color-modes button"),
          ...(card.shadowRoot
            .querySelector("yeelight-clock-preset-manager")
            ?.shadowRoot.querySelectorAll("button") || []),
        ]);
        await Promise.all(
          buttons.flatMap((button) =>
            button.getAnimations().map((animation) => animation.finished),
          ),
        );
      };
      window.snapshot = (card) => {
        const row = card.shadowRoot.querySelector(".unified-color-modes");
        const origin = row.getBoundingClientRect();
        const properties = [
          "padding",
          "borderRadius",
          "borderWidth",
          "borderStyle",
          "backgroundColor",
          "backgroundImage",
          "color",
          "fontSize",
          "fontWeight",
          "lineHeight",
          "gap",
          "flexDirection",
          "boxShadow",
        ];
        const describe = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            text: node.textContent.trim(),
            title: node.title,
            icon: node.querySelector("ha-icon")?.getAttribute("icon"),
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            styles: Object.fromEntries(
              properties.map((name) => [name, style[name]]),
            ),
          };
        };
        window.describeControl = describe;
        return {
          heading: describe(
            card.shadowRoot.querySelector(".color-mode-heading"),
          ),
          buttons: [...row.querySelectorAll("button")].map((button) => ({
            ...describe(button),
            left:
              Math.round(
                (button.getBoundingClientRect().left - origin.left) * 100,
              ) / 100,
            top:
              Math.round(
                (button.getBoundingClientRect().top - origin.top) * 100,
              ) / 100,
          })),
          dropdown: row.querySelector("select")
            ? describe(row.querySelector("select"))
            : null,
          save: [
            ...(card.shadowRoot
              .querySelector("yeelight-clock-preset-manager")
              ?.shadowRoot.querySelectorAll("button") || []),
          ].map(describe),
        };
      };
    });
    // A brand-new card: its <ha-card> shell has never rendered a <slot>. The
    // FIRST keystroke must not blur (this is exactly what the user hit).
    const freshCard = await page.evaluate(async () => {
      const card = document.createElement("yeelight-cube-clock-card");
      card.setConfig({ ...baseConfig, show_gallery: true, show_search: true });
      card.hass = hass;
      document.body.append(card);
      await card.updateComplete;
      window.freshClock = card;
      window.freshShell = card.shadowRoot.querySelector("ha-card");
      const leaked = [];
      const listener = (event) => leaked.push(event.key);
      document.addEventListener("keydown", listener);
      window.freshCleanup = () =>
        document.removeEventListener("keydown", listener);
      window.freshLeaked = leaked;
      // Focus immediately, before ha-card's async first update resolves.
      const input = card.shadowRoot.querySelector(".clock-search");
      input.focus();
      return { focusedBeforeSlot: card.shadowRoot.activeElement === input };
    });
    const fresh = page.locator(
      "yeelight-cube-clock-card:last-of-type input.clock-search",
    );
    await fresh.click();
    await fresh.pressSequentially("tide", { delay: 25 });
    assert.deepEqual(
      await page.evaluate(() => {
        const input = freshClock.shadowRoot.querySelector(".clock-search");
        const result = {
          value: input.value,
          focused: freshClock.shadowRoot.activeElement === input,
          leaked: freshLeaked,
          shellReused:
            freshShell === freshClock.shadowRoot.querySelector("ha-card"),
        };
        freshCleanup();
        freshClock.remove();
        return result;
      }),
      { value: "tide", focused: true, leaked: [], shellReused: true },
      "first keystrokes on a freshly created card keep focus",
    );
    // Toggling the card background swaps the wrapper element type; that is
    // the ONLY case the shell may be recreated, and it must not throw.
    await page.evaluate(() => {
      clock.setConfig({ ...baseConfig, show_card_background: false });
      clock.hass = hass;
      if (!clock.shadowRoot.querySelector("ha-card.no-bg"))
        throw Error("no-bg shell appearance not applied");
      clock.setConfig({ ...baseConfig, show_card_background: true });
      clock.hass = hass;
      if (!clock.shadowRoot.querySelector("ha-card.clock-card"))
        throw Error("ha-card shell not restored");
    });
    for (const width of [390, 1400]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => {
        native.style.display = "none";
        clock.style.width = "100%";
        clock.setConfig({
          ...baseConfig,
          show_gallery: true,
          show_search: true,
        });
        clock.hass = hass;
        await clock.updateComplete;
        window.searchNode = clock.shadowRoot.querySelector(".clock-search");
        window.escapedSearchKeys = [];
        window.searchListener = (event) => escapedSearchKeys.push(event.key);
        document.addEventListener("keydown", searchListener);
      });
      const search = page.locator(
        "yeelight-cube-clock-card input.clock-search",
      );
      await search.click();
      await search.fill("");
      await search.pressSequentially("Rainbow", { delay: 25 });
      assert.deepEqual(
        await page.evaluate(() => ({
          value: searchNode.value,
          same: searchNode === clock.shadowRoot.querySelector(".clock-search"),
          focused: clock.shadowRoot.activeElement === searchNode,
          names: clock._shownStyles().map((style) => style.name),
          escaped: escapedSearchKeys,
        })),
        {
          value: "Rainbow",
          same: true,
          focused: true,
          names: ["Rainbow"],
          escaped: [],
        },
      );
      await search.press("Home");
      await page.evaluate(() => {
        clock.hass = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              ...hass.states["light.a"],
              attributes: {
                ...hass.states["light.a"].attributes,
                clock_colon_blink: true,
              },
            },
          },
        };
      });
      await search.pressSequentially("e");
      assert.equal(await search.inputValue(), "eRainbow");
      await search.press("Backspace");
      await page.evaluate(() => {
        if (clock.shadowRoot.activeElement !== searchNode)
          throw Error("Search lost focus");
        if (escapedSearchKeys.length)
          throw Error("Search leaked keyboard events");
        document.removeEventListener("keydown", searchListener);
      });
      // User's exact setup: the Original selector with 10 items per page.
      // Typing must not render a stray "10" and a saved-preset reveal during
      // typing (the reveal branch runs inside render) must not throw and blur.
      const originalState = await page.evaluate(async () => {
        clock.setConfig({
          ...baseConfig,
          show_gallery: true,
          show_search: true,
          style_selector_style: "original",
          items_per_page: 10,
        });
        clock.hass = hass;
        await clock.updateComplete;
        const input = clock.shadowRoot.querySelector(".clock-search");
        input.focus();
        input.value = "rain";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        clock._revealSavedStyle = "Rainbow";
        clock.render();
        // The reveal branch that previously crashed render (mangled
        // `_revealSavedStyle = null`) only runs for a SAVED style preset.
        input.value = "my sol";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        clock._revealSavedStyle = "My Solid";
        clock.render();
        await clock.updateComplete;
        const browser = clock.shadowRoot.querySelector(".original-browser");
        return {
          focused: clock.shadowRoot.activeElement === input,
          value: input.value,
          browserText: browser?.textContent.replace(/\s+/g, " ").trim(),
          names: clock._shownStyles().map((style) => style.name),
          revealCleared: clock._revealSavedStyle === null,
        };
      });
      assert.equal(
        originalState.focused,
        true,
        "Original selector: search kept focus",
      );
      assert.equal(originalState.value, "my sol");
      assert.deepEqual(originalState.names, ["My Solid"]);
      assert.equal(
        originalState.revealCleared,
        true,
        "reveal flag reset after render",
      );
      assert.doesNotMatch(
        originalState.browserText,
        /(^|\s)10(\s|$)/,
        `stray page-size number rendered: ${originalState.browserText}`,
      );
      await page.screenshot({
        path: path.join(os.tmpdir(), `yeelight-clock-search-${width}.png`),
      });
    }
    console.log(
      "PASS clock typing, caret and focus survive rerenders without global shortcuts (desktop/mobile)",
    );
    const favouriteResults = await page.evaluate(async () => {
      native.style.display = "";
      clock.style.width = "";
      const results = [];
      for (const card of [clock, native]) {
        for (const previews of [true, false]) {
          card.setConfig({
            ...baseConfig,
            show_favourites: true,
            favourites_show_previews: previews,
          });
          card.hass = hass;
          if (card.updateComplete) await card.updateComplete;
          const model = card._controls;
          const saved = [
            { key: "Rainbow", colorMode: "bw" },
            { key: "Rainbow", colorMode: "red_blue" },
            { key: "Rainbow", colorMode: "custom", color: [12, 34, 56] },
          ];
          model.save(saved);
          const view = [
            ...card.shadowRoot.querySelectorAll("yeelight-mode-controls"),
          ].find((item) => item.area === "collections");
          await view.updateComplete;
          calls.length = 0;
          const first = [...view.shadowRoot.querySelectorAll("button")].find(
            (button) => button.getAttribute("aria-label") === "Rainbow (B&W)",
          );
          if (!first) throw Error("Favourite button missing");
          first.click();
          await Promise.resolve();
          await card._queue;
          while (model.busy) await new Promise(requestAnimationFrame);
          await view.updateComplete;
          const remove = [...view.shadowRoot.querySelectorAll("button")].find(
            (button) =>
              button.getAttribute("aria-label") === "Remove favourite",
          );
          if (!remove)
            throw Error(
              "Selected saved favourite is not removable before state echo",
            );
          remove.click();
          results.push({
            kind: model.adapter.kind,
            previews,
            remaining: model.favourites,
            commands: [...calls],
          });
          await model.chooseFavourite(saved[2]);
          const customCommand = calls.at(-1);
          if (JSON.stringify(customCommand.data.color) !== "[12,34,56]")
            throw Error("Custom RGB lost");
          model.save([saved[2]]);
          if (card === clock) card._customDraft = [90, 80, 70];
          else card._customColorDraft = [90, 80, 70];
          model.update();
          view._manage = true;
          view.requestUpdate();
          await view.updateComplete;
          const add = view.shadowRoot.querySelector(
            ".orderable-add-row select",
          );
          const variant = [...add.options].find((option) =>
            option.textContent.includes("Rainbow"),
          );
          if (!variant) throw Error("Manage cannot add another RGB variant");
          add.value = variant.value;
          add.dispatchEvent(new Event("change"));
          await view.updateComplete;
          if (JSON.stringify(model.favourites[1].color) !== "[90,80,70]")
            throw Error("Manage lost RGB");
          model.shuffleFavourites(() => 0);
          await view.updateComplete;
          view.shadowRoot.querySelector(".orderable-list-row .remove").click();
          if (JSON.stringify(model.favourites) !== JSON.stringify([saved[2]]))
            throw Error("Manage removed wrong RGB variant");
          view._manage = false;
          const before = JSON.stringify(
            model.adapter.frame("Rainbow", 2, "normal"),
          );
          card.hass = {
            ...hass,
            states: {
              ...hass.states,
              "light.a": {
                ...hass.states["light.a"],
                attributes: {
                  ...hass.states["light.a"].attributes,
                  native_effect_color: [255, 0, 0],
                  clock_color: 0x01ff0000,
                },
              },
            },
          };
          const after = JSON.stringify(
            model.adapter.frame("Rainbow", 2, "normal"),
          );
          if (before !== after)
            throw Error("Normal favourite inherited live RGB");
          model.save([]);
        }
      }
      return results;
    });
    for (const result of favouriteResults) {
      assert.deepEqual(result.remaining, [
        { key: "Rainbow", colorMode: "red_blue" },
        { key: "Rainbow", colorMode: "custom", color: [12, 34, 56] },
      ]);
      assert.equal(result.commands.length, 1);
      assert.equal(result.commands[0].data.color_mode, "bw");
      assert.equal(result.commands[0].data.color, "clear");
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS real favourite clicks restore colours and Remove targets the saved variant before state echo",
    );
    const paginationResults = await page.evaluate(async () => {
      const results = [];
      for (const tag of [clock.localName, native.localName]) {
        const card = document.createElement(tag);
        card.setConfig({
          ...baseConfig,
          show_gallery: true,
          style_selector_style: "preview-list",
          items_per_page: 1,
        });
        card.hass = hass;
        document.querySelector("main").append(card);
        await card.updateComplete;
        const before = card.shadowRoot.querySelector(
          ".gc-preview-shell [data-mode]",
        )?.dataset.mode;
        card.shadowRoot
          .querySelector('[data-pagination-action="next"]')
          .click();
        await card.updateComplete;
        results.push({
          tag: card.localName,
          before,
          after: card.shadowRoot.querySelector(".gc-preview-shell [data-mode]")
            ?.dataset.mode,
        });
        card.remove();
      }
      return results;
    });
    for (const result of paginationResults) {
      assert.ok(result.before);
      assert.ok(result.after);
      assert.notEqual(
        result.after,
        result.before,
        `${result.tag}: Next must advance`,
      );
    }
    console.log("PASS both cards advance Live Preview pagination");
    const ownershipResults = await page.evaluate(async () => {
      const results = [];
      for (const tag of [clock.localName, native.localName]) {
        const card = document.createElement(tag);
        const config = {
          ...baseConfig,
          show_gallery: true,
          show_search: true,
          show_color_modes: true,
          style_selector_style: "preview-grid",
          items_per_page: 1,
        };
        card.setConfig(config);
        card.hass = hass;
        document.querySelector("main").append(card);
        await card.updateComplete;
        const browser = card.shadowRoot.querySelector("yeelight-style-browser");
        browser.querySelector('[data-pagination-action="next"]').click();
        await browser.updateComplete;
        const advanced = browser.page === 1;
        const input = browser.querySelector('input[type="search"]');
        input.value = "rainbow";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await browser.updateComplete;
        const reset =
          browser.page === 0 &&
          browser.visibleItems.every((item) =>
            item.name.toLowerCase().includes("rainbow"),
          );
        card.remove();
        document.querySelector("main").append(card);
        await card.updateComplete;
        await browser.updateComplete;
        card._controls.save([{ key: "Rainbow", colorMode: "normal" }]);
        await browser.updateComplete;
        const reconnected = !!browser.querySelector(
          '[data-mode="Rainbow"][data-favourite="true"]',
        );
        card.setConfig({ ...config, show_search: false });
        card.hass = hass;
        await card.updateComplete;
        const cleared =
          browser.query === "" &&
          !browser.querySelector('input[type="search"]');
        const before = calls.length;
        card.shadowRoot
          .querySelector('yeelight-color-mode [data-value="bw"]')
          .click();
        await card._commands.queue;
        await card.updateComplete;
        const sent = calls
          .slice(before)
          .filter((call) =>
            ["set_clock_style", "set_native_effect"].includes(call.service),
          );
        results.push({
          tag,
          advanced,
          reset,
          reconnected,
          cleared,
          commands: sent.length,
        });
        card._controls.save([]);
        card.remove();
      }
      return results;
    });
    for (const result of ownershipResults) {
      assert.equal(result.advanced, true, `${result.tag}: paging`);
      assert.equal(result.reset, true, `${result.tag}: search resets page`);
      assert.equal(
        result.reconnected,
        true,
        `${result.tag}: reconnect subscription`,
      );
      assert.equal(
        result.cleared,
        true,
        `${result.tag}: hiding search clears query`,
      );
      assert.equal(
        result.commands,
        1,
        `${result.tag}: one colour selection, one command`,
      );
    }
    console.log(
      "PASS shared browser reset/reconnect and single colour-command ownership on both cards",
    );
    const rotationErrors = await page.evaluate(async () => {
      const results = [];
      for (const [tag, kind] of [
        ["clock", "clock"],
        ["native-effects", "native"],
      ]) {
        const card = document.createElement(`yeelight-cube-${tag}-card`);
        const sent = [];
        const items = [
          { name: "Rainbow", color_mode: "bw" },
          { name: "Tide", color_mode: "normal" },
        ];
        const rotation = {
          kind,
          items,
          interval: 45,
          active: true,
          error: null,
        };
        const state = (failed, otherState = "on") => ({
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              state: otherState,
              attributes: {
                ...hass.states["light.a"].attributes,
                friendly_name: "Top",
                effect_rotation: { ...rotation },
              },
            },
            "light.b": {
              state: "on",
              attributes: {
                ...hass.states["light.a"].attributes,
                friendly_name: "Bottom",
                effect_rotation: { ...rotation, ...failed },
              },
            },
          },
          callService: async (domain, service, data) =>
            sent.push({ domain, service, data }),
        });
        card.setConfig({
          ...baseConfig,
          target_entities: ["light.a", "light.b"],
          show_rotation: true,
        });
        card.hass = state({});
        document.querySelector("main").append(card);
        const settle = async () => {
          await card.updateComplete;
          await new Promise(requestAnimationFrame);
          await Promise.all(
            [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")].map(
              (view) => view.updateComplete,
            ),
          );
        };
        const view = () =>
          [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")].find(
            (view) => view.shadowRoot.textContent.includes("Rotation"),
          );
        const text = () => view().shadowRoot.textContent.replace(/\s+/g, " ");
        const retry = () =>
          view().shadowRoot.querySelector('button[title="Retry failed lamps"]');
        await settle();
        const healthy =
          !text().includes("Running: 2/2") &&
          !retry() &&
          !text().includes("Bottom:");
        card.hass = state({
          active: false,
          error: "Hard timeout: rotation:clock",
        });
        await settle();
        const partial =
          text().includes("Running: 1/2") &&
          text().includes("Bottom: Stopped") &&
          !!retry();
        card.style.width = "320px";
        card.hass = state(
          { active: false, error: "Hard timeout: rotation:clock" },
          "unavailable",
        );
        await settle();
        const retryAvailable = !!retry() && !retry().disabled;
        const errorElement = view().shadowRoot.querySelector(".error");
        const narrowFits =
          errorElement.scrollWidth <= errorElement.clientWidth + 1;
        retry()?.click();
        for (let tick = 0; tick < 10; tick++) await Promise.resolve();
        await settle();
        const retryCalls = sent.filter(
          (call) => call.service === "start_effect_rotation",
        );
        card.hass = state({
          active: true,
          error: "Hard timeout: rotation:clock",
          retry_attempt: 1,
          retry_at: Date.now() / 1000 + 5,
        });
        await settle();
        const retrying =
          text().includes("Retrying: 1") &&
          text().includes("Retrying (1/2)") &&
          !retry();
        view()
          .shadowRoot.querySelector('button[title="Stop rotation"]')
          .click();
        for (let tick = 0; tick < 10; tick++) await Promise.resolve();
        const partialStop =
          sent.filter((call) => call.service === "stop_effect_rotation")
            .length === 1;
        card.hass = state({});
        await settle();
        const recovered =
          !text().includes("Bottom:") &&
          !text().includes("Hard timeout") &&
          !retry() &&
          !text().includes("Running: 2/2");
        results.push({
          tag,
          healthy,
          partial,
          retrying,
          recovered,
          retryAvailable,
          narrowFits,
          partialStop,
          retryCalls,
        });
        card.remove();
      }
      return results;
    });
    for (const result of rotationErrors) {
      for (const key of [
        "healthy",
        "partial",
        "retrying",
        "recovered",
        "retryAvailable",
        "narrowFits",
        "partialStop",
      ])
        assert.equal(
          result[key],
          true,
          `${result.tag}: error-only rotation ${key}`,
        );
      assert.equal(
        result.retryCalls.length,
        1,
        `${result.tag}: retry sent once`,
      );
      assert.equal(
        result.retryCalls[0].data.entity_id,
        "light.b",
        `${result.tag}: healthy target untouched`,
      );
      assert.equal(result.retryCalls[0].data.interval, 45);
      assert.equal(result.retryCalls[0].data.items[0].color_mode, "bw");
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS rotation details appear only on errors; retry isolates failed targets; recovery clears details on Clock/Native",
    );
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
        const update = card._updatePreviewSection.bind(card);
        card._updatePreviewSection = () => {
          updates[index]++;
          update();
        };
      });
      const green = Array.from({ length: 100 }, () => [0, 255, 0]);
      listeners.forEach((callback) => callback({ data: preview(green) }));
      check(
        updates.every((count) => count === 1),
        "Every Gradient view must refresh",
      );
      check(
        gradients.every(
          (card) =>
            card._previewCache().data.previews["Solid Color"][0][1] === 255,
        ),
        "Gradient cache must contain updated colours",
      );
      const colors = await create("color-list-editor", { list_layout: "rows" });
      const notices = [];
      colors.addEventListener("hass-notification", (event) =>
        notices.push(event.detail.message),
      );
      failColors = true;
      check(
        (await colors.saveColors([[0, 0, 255]])) === false,
        "Colour save must report failure",
      );
      check(
        notices.includes("Test offline"),
        "Colour save failure must be visible",
      );
      check(
        JSON.stringify(colors._getCurrentColors()) ===
          JSON.stringify([[255, 0, 0]]),
        "Colour save must roll back",
      );
      const palette = await create("palette", {
        display_mode: "list",
        allow_title_edit: true,
      });
      const savedPrompt = window.prompt;
      window.prompt = () => "Renamed A";
      const rename = palette._renamePalette(0, "A", null);
      window.prompt = savedPrompt;
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
      draw._pendingReorderedPixelArts =
        state.states["sensor.art"].attributes.pixel_arts.toReversed();
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
        draw.hass.states["sensor.art"].attributes.pixel_arts[0].name === "B",
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
      gradients[0].remove();
      section.append(gradients[0]);
      await frames();
      check(
        listeners.size === 1,
        "Gradient reconnect must retain one subscription",
      );
      window.otherRegressionCards = cards;
      window.otherRegressionListeners = listeners;
    });
    for (const width of [1400, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#other-card-regressions").screenshot({
        path: path.join(os.tmpdir(), `yeelight-other-cards-${width}.png`),
      });
    }
    await page.evaluate(async () => {
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
    await page.evaluate(async () => {
      await import("/custom_components/yeelight_cube/www/yeelight-cube-lamp-preview-card-editor.js");
      const { renderActionButtonHTML } =
        await import("/custom_components/yeelight_cube/www/action-button-utils.js");
      const check = (condition, message) => {
        if (!condition) throw Error(message);
      };
      const settle = async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      };
      const section = document.createElement("section");
      section.id = "shared-action-regressions";
      section.style.cssText = "display:grid;gap:16px;max-width:420px";
      document.body.append(section);
      for (const kind of ["lamp-preview", "clock", "native-effects"]) {
        const serviceCalls = [];
        let finish;
        let fail;
        const state = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              state: "on",
              attributes: {
                ...hass.states["light.a"].attributes,
                content_mode: kind === "clock" ? "Clock" : "Native Effect",
                matrix_colors: Array.from({ length: 100 }, () => [20, 80, 160]),
              },
            },
          },
          callService: (domain, service, data) => {
            serviceCalls.push({ domain, service, data });
            return new Promise((resolve, reject) => {
              finish = resolve;
              fail = reject;
            });
          },
        };
        const card = document.createElement(`yeelight-cube-${kind}-card`);
        const config = {
          ...baseConfig,
          show_actions: true,
          show_lamp_preview: false,
          show_brightness_slider: false,
          action_buttons: ["refresh", "power"],
          actions_buttons_style: "outline",
          actions_buttons_content_mode: "icon_text",
        };
        card.setConfig(config);
        card.hass = state;
        section.append(card);
        await settle();
        const view = card.shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        check(view, `${kind}: shared Actions missing`);
        await view.updateComplete;
        const buttons = () => [...view.shadowRoot.querySelectorAll("button")];
        check(
          buttons()
            .map((button) => button.title)
            .join() === "Refresh,Turn off",
          `${kind}: action labels/order`,
        );
        buttons()[0].click();
        await settle();
        check(
          serviceCalls.length === 1 &&
            serviceCalls[0].service === "force_refresh",
          `${kind}: refresh service only`,
        );
        check(
          serviceCalls[0].domain === "yeelight_cube" &&
            [serviceCalls[0].data.entity_id].flat().includes("light.a"),
          `${kind}: refresh target`,
        );
        check(
          buttons()[0].getAttribute("aria-busy") === "true" &&
            buttons().every((button) => button.disabled),
          `${kind}: pending refresh`,
        );
        card.hass = { ...state };
        await settle();
        check(
          buttons()[0].getAttribute("aria-busy") === "true",
          `${kind}: pending survives state update`,
        );
        fail(Error("Test offline"));
        await settle();
        check(
          view.shadowRoot.querySelector('[role="alert"]'),
          `${kind}: refresh error visible`,
        );
        buttons()[0].click();
        await settle();
        finish();
        await settle();
        check(
          !view.shadowRoot.querySelector('[role="alert"]'),
          `${kind}: successful retry clears error`,
        );
        buttons()[1].click();
        await settle();
        check(
          serviceCalls.at(-1).service === "turn_off" &&
            serviceCalls.at(-1).domain === "light",
          `${kind}: explicit power off`,
        );
        check(
          buttons()[1].getAttribute("aria-busy") === "true",
          `${kind}: power spinner`,
        );
        finish();
        await settle();
        const off = {
          ...state,
          states: {
            ...state.states,
            "light.a": { ...state.states["light.a"], state: "off" },
          },
        };
        card.hass = off;
        await settle();
        check(
          buttons()[0].disabled && !buttons()[1].disabled,
          `${kind}: off state actions`,
        );
        buttons()[1].click();
        await settle();
        check(
          serviceCalls.at(-1).service === "turn_on",
          `${kind}: explicit power on`,
        );
        finish();
        await settle();
        card.hass = state;
        await settle();
        if (kind === "lamp-preview") {
          for (const content_mode of [
            "Clock",
            "Native Effect",
            "Text",
            "Solid Color",
          ]) {
            card.hass = {
              ...state,
              states: {
                ...state.states,
                "light.a": {
                  ...state.states["light.a"],
                  attributes: {
                    ...state.states["light.a"].attributes,
                    content_mode,
                  },
                },
              },
            };
            await settle();
            check(
              buttons().length === 2 &&
                buttons().every((button) => !button.disabled),
              `Lamp ${content_mode}: relevant actions`,
            );
          }
          card.setConfig({
            ...config,
            action_buttons: ["power", "freeze", "random", "refresh"],
          });
          await settle();
          const remounted = card.shadowRoot.querySelector(
            'yeelight-mode-controls[area="actions"]',
          );
          await remounted.updateComplete;
          check(
            [...remounted.shadowRoot.querySelectorAll("button")]
              .map((button) => button.title)
              .join() === "Turn off,Refresh",
            "Lamp filters unsupported actions",
          );
          card.setConfig({
            ...config,
            actions_buttons_style: "gradient",
            action_buttons: ["refresh", "power"],
          });
          await settle();
          const gradient = card.shadowRoot.querySelector(
            'yeelight-mode-controls[area="actions"]',
          );
          await gradient.updateComplete;
          const row = gradient.shadowRoot.querySelector(".action-row");
          check(
            getComputedStyle(row).justifyContent === "center",
            "Lamp actions row is centred",
          );
          const [refreshBtn, powerBtn] = [
            ...gradient.shadowRoot.querySelectorAll("button"),
          ];
          check(
            refreshBtn.classList.contains("force-refresh-btn") &&
              powerBtn.classList.contains("power-btn"),
            "Actions reuse existing semantic button styles",
          );
          const accentOf = (button) => getComputedStyle(button).backgroundImage;
          check(
            accentOf(refreshBtn) !== accentOf(powerBtn) &&
              accentOf(refreshBtn).includes("gradient"),
            "Refresh and Power use distinct accent colours",
          );
          card.setConfig({
            ...config,
            actions_buttons_style: "outline",
            action_buttons: ["refresh", "power"],
          });
          await settle();
          const outline = card.shadowRoot.querySelector(
            'yeelight-mode-controls[area="actions"]',
          );
          await outline.updateComplete;
          check(
            [...outline.shadowRoot.querySelectorAll("button")].every(
              (button) =>
                !getComputedStyle(button).backgroundImage.includes("gradient"),
            ),
            "Outline style keeps its neutral look",
          );
        }
        for (const theme of ["light", "dark"]) {
          card.style.setProperty(
            "--card-background-color",
            theme === "light" ? "#ffffff" : "#202020",
          );
          card.style.setProperty(
            "--primary-text-color",
            theme === "light" ? "#333333" : "#eeeeee",
          );
          card.style.setProperty(
            "--primary-color",
            theme === "light" ? "#2984ae" : "#78bce0",
          );
          for (const buttonStyle of [
            "modern",
            "classic",
            "outline",
            "gradient",
            "icon",
            "pill",
          ]) {
            for (const contentMode of ["icon", "text", "icon_text"]) {
              card.setConfig({
                ...config,
                action_buttons:
                  kind === "lamp-preview"
                    ? ["refresh", "power"]
                    : [
                        "previous",
                        "next",
                        "random",
                        "freeze",
                        "refresh",
                        "power",
                      ],
                actions_buttons_style: buttonStyle,
                actions_buttons_content_mode: contentMode,
              });
              await settle();
              const controls = card.shadowRoot.querySelector(
                'yeelight-mode-controls[area="actions"]',
              );
              await controls.updateComplete;
              const row = controls.shadowRoot.querySelector(".action-row");
              check(
                getComputedStyle(row).justifyContent === "center" &&
                  parseFloat(getComputedStyle(row).marginBottom) >= 16,
                `${kind}/${buttonStyle}/${contentMode}: centered with spacing`,
              );
              const actual = [...row.querySelectorAll("button")];
              const actions =
                kind === "lamp-preview"
                  ? ["force-refresh", "power"]
                  : [
                      "tool",
                      "tool",
                      "randomize",
                      "tool",
                      "force-refresh",
                      "power",
                    ];
              const reference = document.createElement("div");
              reference.style.cssText =
                "position:absolute;visibility:hidden;pointer-events:none";
              reference.innerHTML = actions
                .map((action) =>
                  renderActionButtonHTML({ action, buttonStyle, contentMode }),
                )
                .join("");
              controls.shadowRoot.append(reference);
              for (const [index, button] of actual.entries()) {
                button.style.transition = "none";
                const expected = getComputedStyle(reference.children[index]);
                const current = getComputedStyle(button);
                for (const property of [
                  "backgroundColor",
                  "backgroundImage",
                  "color",
                ]) {
                  check(
                    current[property] === expected[property],
                    `${kind}/${theme}/${buttonStyle}/${contentMode}/${actions[index]}: shared ${property}`,
                  );
                }
              }
              if (buttonStyle === "icon") {
                const widths = actual.map(
                  (button) => button.getBoundingClientRect().width,
                );
                check(
                  widths.every((width) => Math.abs(width - widths[0]) < 0.5),
                  `${kind}/${theme}/${contentMode}: Icon style buttons are a uniform size (got ${widths.join(",")})`,
                );
              }
              reference.remove();
            }
          }
        }
        card.style.removeProperty("--card-background-color");
        card.style.removeProperty("--primary-text-color");
        card.style.removeProperty("--primary-color");
      }
      const editor = document.createElement(
        "yeelight-cube-lamp-preview-card-editor",
      );
      editor.setConfig({
        entity: "light.a",
        show_power_toggle: false,
        buttons_content_mode: "text",
      });
      editor.hass = hass;
      section.append(editor);
      editor._lampControlOpen = true;
      await editor.updateComplete;
      check(
        editor.getConfig().action_buttons.join() === "refresh",
        "Lamp editor migrates visibility",
      );
      const actionSection = [
        ...editor.shadowRoot.querySelectorAll(".editor-card"),
      ].find(
        (node) =>
          node.querySelector(".editor-card-header")?.textContent.trim() ===
          "Actions",
      );
      check(
        actionSection?.textContent.includes("Actions & Order") &&
          actionSection.textContent.includes("Button Settings"),
        "Lamp shared action settings",
      );
      check(
        !actionSection.textContent.includes("Freeze display") &&
          !actionSection.textContent.includes("Previous"),
        "Lamp editor excludes catalogue actions",
      );
      window.sharedActionCards = [...section.children];
    });
    for (const width of [1400, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#shared-action-regressions").screenshot({
        path: path.join(os.tmpdir(), `yeelight-shared-actions-${width}.png`),
      });
    }
    await page.evaluate(() => {
      sharedActionCards.forEach((card) => card.remove());
      document.querySelector("#shared-action-regressions").remove();
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS shared Refresh/Power dispatch, pending/error/off states and Lamp configuration across all three cards (desktop/mobile)",
    );
    const appearancePage = await browser.newPage();
    const appearanceErrors = [];
    appearancePage.on("pageerror", (error) =>
      appearanceErrors.push(error.message),
    );
    await appearancePage.goto(
      `http://127.0.0.1:${server.address().port}/tests/clock-appearance-preview.html`,
    );
    await appearancePage.waitForFunction(() => !!window.appearancePreview);
    await appearancePage.evaluate(async () => {
      const earlyEditor = document.createElement(
        "yeelight-cube-clock-card-editor",
      );
      earlyEditor.hass = appearancePreview.hass;
      document.body.append(earlyEditor);
      try {
        await earlyEditor.updateComplete;
        earlyEditor.setConfig({ entity: "light.preview" });
        await earlyEditor.updateComplete;
      } finally {
        earlyEditor.remove();
      }
    });
    const appearanceEditor = appearancePage.locator(
      "yeelight-cube-clock-card-editor",
    );
    const lampAppearance = appearanceEditor.locator('[data-appearance="lamp"]');
    const sharedAppearance = appearanceEditor.locator(
      '[data-appearance="shared"]',
    );
    assert.equal(
      await sharedAppearance
        .getByRole("button", { name: "Classic preset", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await lampAppearance.locator(".appearance-fields").count(), 0);
    await lampAppearance
      .getByRole("button", { name: "Custom", exact: true })
      .click();
    await lampAppearance
      .getByRole("switch", { name: "Shadow", exact: true })
      .press("Space");
    await sharedAppearance
      .getByRole("button", { name: "Square preset", exact: true })
      .click();
    const inherited = await appearancePage.evaluate(() => {
      const { card } = appearancePreview;
      return {
        overrides: lastAppearanceConfig.clock_preview_overrides,
        backgrounds: [
          card.config.lamp_matrix_background,
          card.config.gallery_background_color,
          card.config.effect_matrix_background,
        ],
        shadow: card.config.lamp_matrix_box_shadow,
      };
    });
    assert.deepEqual(inherited.overrides, { lamp: { shadow: true } });
    assert.deepEqual(inherited.backgrounds, [
      "transparent",
      "transparent",
      "transparent",
    ]);
    assert.equal(inherited.shadow, true);
    await lampAppearance
      .getByRole("button", {
        name: "Reset shadow to card default",
        exact: true,
      })
      .click();
    assert.equal(
      await lampAppearance
        .getByRole("switch", { name: "Shadow", exact: true })
        .isChecked(),
      false,
    );
    await lampAppearance
      .getByRole("button", { name: "Card default", exact: true })
      .click();
    assert.equal(await lampAppearance.locator(".appearance-fields").count(), 0);
    await sharedAppearance
      .getByRole("button", { name: "Light preset", exact: true })
      .click();
    await appearancePage.evaluate(async () => {
      const { editor } = appearancePreview;
      editor._open = {
        preview_appearance: true,
        lamp_preview: true,
        previews: true,
        favourites: true,
      };
      editor.requestUpdate();
      await editor.updateComplete;
    });
    for (const section of ["lamp", "gallery", "favourites"]) {
      const area = appearanceEditor.locator(`[data-appearance="${section}"]`);
      assert.equal(await area.locator(".appearance-fields").count(), 0);
      assert.equal(
        await area
          .getByRole("button", { name: "Card default", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
    }
    await appearancePage.evaluate(async () => {
      const { editor } = appearancePreview;
      const slider = editor.shadowRoot.querySelector(
        '[data-appearance="lamp"] input[type="range"]',
      );
      slider.value = "80";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      await editor.updateComplete;
    });
    assert.equal(
      await appearancePage.evaluate(
        () => appearancePreview.card.config.lamp_preview_size,
      ),
      80,
    );
    assert.equal(
      await appearancePage.evaluate(
        () => appearancePreview.card.config.preview_size,
      ),
      55,
    );
    await sharedAppearance
      .getByText("Fine-tune appearance", { exact: true })
      .click();
    await sharedAppearance
      .getByRole("button", { name: "Circle", exact: true })
      .click();
    assert.equal(
      await appearancePage.evaluate(
        () => appearancePreview.card.config.effect_pixel_style,
      ),
      "circle",
    );
    await appearancePage.waitForFunction(() => {
      const tile = appearancePreview.card.shadowRoot.querySelector(
        "[data-clock-preview]",
      );
      return tile?._cells?.[0]?.style.borderRadius === "50%";
    });
    const renderedShapes = await appearancePage.evaluate(() => {
      const card = appearancePreview.card;
      const favouriteView = [
        ...card.shadowRoot.querySelectorAll("yeelight-mode-controls"),
      ].find((view) => view.shadowRoot.querySelector("[data-preview]"));
      return [
        card.shadowRoot.querySelector(
          ".gc-preview-shell .gallery-matrix-preview > div",
        )?.style.borderRadius,
        favouriteView.shadowRoot.querySelector(
          "[data-preview] .gallery-matrix-preview > div",
        )?.style.borderRadius,
      ];
    });
    assert.deepEqual(renderedShapes, ["50%", "50%"]);
    assert.equal(
      await sharedAppearance
        .getByRole("button", { name: "Light preset", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    for (const width of [1280, 390]) {
      await appearancePage.setViewportSize({ width, height: 1000 });
      await appearancePage.screenshot({
        path: path.join(os.tmpdir(), `yeelight-clock-appearance-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await appearancePage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        `Appearance editor fits ${width}px`,
      );
    }
    await appearancePage.evaluate(async () => {
      const { editor } = appearancePreview;
      editor.setConfig({
        ...appearancePreview.config,
        clock_preview_appearance: undefined,
        lamp_pixel_style: "circle",
        gallery_background_color: "white",
        effect_spacing_mode: "none",
      });
      await editor.updateComplete;
    });
    await sharedAppearance
      .getByRole("button", { name: "Use card default everywhere", exact: true })
      .click();
    assert.deepEqual(
      await appearancePage.evaluate(
        () => lastAppearanceConfig.clock_preview_overrides,
      ),
      {},
    );
    await appearancePage.evaluate(async () => {
      const { editor, config, updateCard } = appearancePreview;
      const custom = {
        ...config,
        lamp_preview_size: 80,
        clock_preview_appearance: {
          ...config.clock_preview_appearance,
          pixels: "square",
        },
        clock_preview_overrides: {
          lamp: { pixels: "circle", shadow: true },
          gallery: { pixels: "circle", background: "white" },
          favourites: { pixels: "rounded" },
        },
      };
      editor.setConfig(custom);
      await updateCard(custom);
      await editor.updateComplete;
    });
    await appearancePage.waitForFunction(
      () =>
        appearancePreview.card.shadowRoot.querySelector("[data-clock-preview]")
          ?._cells?.[0]?.style.borderRadius === "50%",
    );
    const shapeNotice = sharedAppearance.locator(
      '[data-field="pixels"] .appearance-inheritance',
    );
    assert.match(
      await shapeNotice.innerText(),
      /Custom pixel shape: Lamp Preview, Previews, Favourites/,
    );
    await sharedAppearance
      .getByRole("button", {
        name: "Use card pixel shape for all previews",
        exact: true,
      })
      .click();
    await appearancePage.waitForFunction(
      () =>
        appearancePreview.card.shadowRoot.querySelector("[data-clock-preview]")
          ?._cells?.[0]?.style.borderRadius === "0px",
    );
    assert.deepEqual(
      await appearancePage.evaluate(
        () => lastAppearanceConfig.clock_preview_overrides,
      ),
      {
        lamp: { shadow: true },
        gallery: { background: "white" },
        favourites: {},
      },
    );
    assert.equal(
      await appearancePage.evaluate(
        () => appearancePreview.card.config.lamp_preview_size,
      ),
      80,
    );
    assert.equal(await shapeNotice.count(), 0);
    await sharedAppearance
      .getByRole("button", { name: "Light preset", exact: true })
      .click();
    assert.equal(
      await sharedAppearance
        .getByRole("switch", { name: "Shadow", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await sharedAppearance
        .getByRole("switch", { name: "Hide black pixels", exact: true })
        .isChecked(),
      true,
    );
    await sharedAppearance
      .getByRole("switch", { name: "Shadow", exact: true })
      .press("Space");
    assert.equal(
      await sharedAppearance
        .getByRole("switch", { name: "Shadow", exact: true })
        .isChecked(),
      false,
    );
    await sharedAppearance.getByText("Manage presets", { exact: true }).click();
    const manager = sharedAppearance.locator("[data-preset-manager]");
    const presetTarget = manager.getByLabel("Save current appearance to", {
      exact: true,
    });
    const presetName = manager.getByLabel("Preset name", { exact: true });
    await presetTarget.selectOption("classic");
    await manager
      .getByRole("button", { name: "Update preset", exact: true })
      .click();
    await sharedAppearance
      .getByRole("button", { name: "Square preset", exact: true })
      .click();
    await sharedAppearance
      .getByRole("button", { name: "Classic preset", exact: true })
      .click();
    assert.deepEqual(
      await appearancePage.evaluate(
        () => appearancePreview.editor.config.clock_preview_appearance,
      ),
      {
        background: "white",
        pixels: "rounded",
        spacing: "subtle",
        shadow: false,
        ignoreBlack: true,
      },
    );
    await presetTarget.selectOption("");
    await presetName.fill("Light");
    assert.equal(
      await manager
        .getByRole("button", { name: "Save new preset", exact: true })
        .isDisabled(),
      true,
    );
    await presetName.fill("Night display");
    await manager
      .getByRole("button", { name: "Save new preset", exact: true })
      .click();
    const customId = await appearancePage.evaluate(
      () =>
        appearancePreview.editor.config.clock_appearance_presets.find(
          (preset) => preset.name === "Night display",
        ).id,
    );
    await presetName.fill("Evening clock");
    await manager
      .getByRole("button", { name: "Update preset", exact: true })
      .click();
    await sharedAppearance
      .getByRole("button", { name: "Evening clock preset", exact: true })
      .click();
    assert.equal(
      await sharedAppearance
        .getByRole("button", { name: "Evening clock preset", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const serializedPresets = await appearancePage.evaluate(() =>
      JSON.stringify(lastAppearanceConfig),
    );
    await appearancePage.evaluate(async (serialized) => {
      const { editor, updateCard } = appearancePreview;
      editor.setConfig(JSON.parse(serialized));
      await updateCard(JSON.parse(serialized));
      await editor.updateComplete;
    }, serializedPresets);
    assert.equal(
      await sharedAppearance.locator(".appearance-preset").count(),
      4,
    );
    for (const width of [1280, 390]) {
      await appearancePage.setViewportSize({ width, height: 1000 });
      await sharedAppearance.screenshot({
        path: path.join(os.tmpdir(), `yeelight-clock-presets-${width}.png`),
      });
      assert.equal(
        await appearancePage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
    }
    await presetTarget.selectOption("classic");
    await manager
      .getByRole("button", { name: "Restore original preset", exact: true })
      .click();
    await sharedAppearance
      .getByRole("button", { name: "Classic preset", exact: true })
      .click();
    assert.deepEqual(
      await appearancePage.evaluate(
        () => appearancePreview.editor.config.clock_preview_appearance,
      ),
      {
        background: "black",
        pixels: "circle",
        spacing: "normal",
        shadow: false,
        ignoreBlack: false,
      },
    );
    await presetTarget.selectOption(customId);
    await manager
      .getByRole("button", { name: "Delete preset", exact: true })
      .click();
    await manager.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await sharedAppearance.locator(".appearance-preset").count(),
      4,
    );
    await manager
      .getByRole("button", { name: "Delete preset", exact: true })
      .click();
    await manager.getByRole("button", { name: "Delete", exact: true }).click();
    assert.equal(
      await sharedAppearance.locator(".appearance-preset").count(),
      3,
    );
    assert.deepEqual(
      await appearancePage.evaluate(
        () => lastAppearanceConfig.clock_appearance_presets,
      ),
      [],
    );
    const scaling = await appearancePage.evaluate(async () => {
      const { card, config, updateCard } = appearancePreview;
      const results = [];
      const measure = (grid, name) => {
        if (!grid) throw Error(`Missing ${name} matrix`);
        const cell = grid.firstElementChild.getBoundingClientRect();
        const style = getComputedStyle(grid);
        const bounds = grid.getBoundingClientRect();
        return {
          name,
          cellWidth: cell.width,
          cellHeight: cell.height,
          ratio: parseFloat(style.columnGap) / cell.width,
          paddingRatio: parseFloat(style.paddingLeft) / cell.width,
          aspect: bounds.width / bounds.height,
        };
      };
      for (const layout of [
        "preview-grid",
        "preview-list",
        "preview-strip",
        "preview-carousel",
        "preview-wheel",
        "original",
      ]) {
        for (const size of [100, 55, 30]) {
          await updateCard({
            ...config,
            lamp_preview_size: size,
            preview_size: size,
            effect_preview_size: size,
            style_selector_style: layout,
          });
          for (const width of [350, 280]) {
            card.style.width = `${width}px`;
            await new Promise(requestAnimationFrame);
            const tile = card.shadowRoot.querySelector("[data-clock-preview]");
            card._ensureGrid(tile);
            const favourites = [
              ...card.shadowRoot.querySelectorAll("yeelight-mode-controls"),
            ].find((view) => view.shadowRoot.querySelector("[data-preview]"));
            results.push({
              layout,
              size,
              width,
              matrices: [
                measure(tile.firstElementChild, "lamp"),
                measure(
                  card.shadowRoot.querySelector(
                    ".gc-preview-shell .gallery-matrix-preview, .original-gallery .gallery-matrix-preview",
                  ),
                  "browser",
                ),
                measure(
                  favourites.shadowRoot.querySelector(
                    ".gallery-matrix-preview",
                  ),
                  "favourites",
                ),
              ],
            });
          }
        }
      }
      return results;
    });
    for (const result of scaling) {
      for (const matrix of result.matrices) {
        const label = `${result.layout}/${result.size}/${result.width}/${matrix.name}`;
        assert.ok(matrix.cellWidth > 0, `${label}: visible pixels`);
        assert.ok(
          Math.abs(matrix.cellWidth - matrix.cellHeight) < 0.05,
          `${label}: square pixels`,
        );
        assert.ok(
          Math.abs(matrix.ratio - 60 / 281) < 0.008,
          `${label}: proportional gaps (${matrix.ratio})`,
        );
        assert.ok(
          Math.abs(matrix.paddingRatio - 120 / 281) < 0.016,
          `${label}: proportional padding`,
        );
      }
    }
    for (const size of [100, 30]) {
      await appearancePage.evaluate(async (size) => {
        const { card, config, updateCard } = appearancePreview;
        card.style.width = "350px";
        await updateCard({
          ...config,
          lamp_preview_size: size,
          preview_size: size,
          effect_preview_size: size,
        });
        card.scrollIntoView();
        await new Promise(requestAnimationFrame);
      }, size);
      await appearancePage.locator("yeelight-cube-clock-card").screenshot({
        path: path.join(os.tmpdir(), `yeelight-clock-scaling-${size}.png`),
      });
    }
    await appearancePage.evaluate(async () => {
      const base = "/custom_components/yeelight_cube/www/";
      const { APPEARANCE_PRESETS, APPEARANCE_PROFILES } = await import(
        `${base}preview-appearance.js`
      );
      const { LitElement, html, unsafeHTML } = await import(
        `${base}lib/lit-all.js`
      );
      customElements.define(
        "appearance-render-fixture",
        class extends LitElement {
          render() {
            return html`<style>
                ${this.cardStyles || ""}</style
              >${this.content || html``}`;
          }
        },
      );
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      const frame = () => new Promise(requestAnimationFrame);
      const area = document.createElement("section");
      area.id = "shared-appearance-regressions";
      document.body.append(area);
      const pixels = Array.from({ length: 100 }, (_, index) =>
        index ? "#ef6572" : "#000000",
      );
      for (const [profile, name] of Object.entries({
        native: "native-effects",
        gradient: "gradient",
        lamp: "lamp-preview",
        draw: "draw",
      })) {
        await import(`${base}yeelight-cube-${name}-card.js`);
        await import(`${base}yeelight-cube-${name}-card-editor.js`);
        const editor = document.createElement(
          `yeelight-cube-${name}-card-editor`,
        );
        editor.hass = appearancePreview.hass;
        area.append(editor);
        await editor.updateComplete;
        editor.setConfig({
          entity: "light.preview",
          target_entities: ["light.preview"],
          preview_appearance: APPEARANCE_PRESETS.classic,
          preview_overrides: {},
          size_pct: 65,
          matrix_size: 65,
          lamp_preview_size: 65,
          pixel_art_preview_size: 65,
          rotary_size: 65,
          rotary_unified_style: "matrix_preview",
          show_favourites: true,
          style_selector_style: "original",
        });
        await editor.updateComplete;
        const shared = editor.shadowRoot.querySelector(
          'yeelight-preview-appearance-editor[section="shared"]',
        );
        check(shared, `${profile}: shared editor missing`);
        const presetSection = shared.closest(
          '[data-section="preview_appearance"]',
        );
        check(
          presetSection?.classList.contains("editor-card"),
          `${profile}: styled preset section`,
        );
        const presetHeader = presetSection.querySelector(".editor-card-header");
        check(
          presetHeader.getAttribute("aria-expanded") === "false",
          `${profile}: presets initially folded`,
        );
        presetHeader.click();
        await editor.updateComplete;
        check(
          presetHeader.getAttribute("aria-expanded") === "true",
          `${profile}: presets expand`,
        );
        presetHeader.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        await editor.updateComplete;
        check(
          presetHeader.getAttribute("aria-expanded") === "false",
          `${profile}: presets collapse with keyboard`,
        );
        check(
          presetSection.querySelector(".editor-card-content").inert,
          `${profile}: folded presets not focusable`,
        );
        presetHeader.click();
        await editor.updateComplete;
        await shared.updateComplete;
        check(
          !shared.shadowRoot.querySelector('[aria-label="Appearance source"]'),
          `${profile}: no local overrides inside presets`,
        );
        let saved;
        editor.addEventListener("config-changed", (event) => {
          saved = event.detail.config;
        });
        const localSections = {
          native: {
            lamp: "Lamp Preview",
            gallery: "Previews",
            favourites: "Favourites",
          },
          lamp: { lamp: "Lamp Preview" },
          draw: { canvas: "Drawing Matrix Section", art: "Pixel Art Section" },
          gradient: { gallery: "Mode", rotary: "Angle" },
        }[profile];
        for (const [section, title] of Object.entries(localSections)) {
          const local = editor.shadowRoot.querySelector(
            `yeelight-preview-appearance-editor[section="${section}"]`,
          );
          check(local, `${profile}: ${section} local appearance control`);
          const container = local.closest(".editor-card");
          const header = container?.querySelector(".editor-card-header");
          check(
            header?.textContent.includes(title),
            `${profile}: ${section} beside its own settings`,
          );
          check(
            container !== presetSection &&
              container.querySelector('input[type="range"]'),
            `${profile}: ${section} with local size`,
          );
          if (container.classList.contains("editor-card-collapsed"))
            header.click();
          await editor.updateComplete;
          await local.updateComplete;
          const sourceButtons = () =>
            local.shadowRoot.querySelectorAll(
              '[aria-label="Appearance source"] button',
            );
          check(
            sourceButtons()[0].getAttribute("aria-pressed") === "true",
            `${profile}: ${section} inherits presets`,
          );
          sourceButtons()[1].click();
          await local.updateComplete;
          local.shadowRoot
            .querySelector('[data-field="pixels"] button[aria-label="Square"]')
            .click();
          await editor.updateComplete;
          await local.updateComplete;
          check(
            saved.preview_overrides[section].pixels === "square",
            `${profile}: ${section} saves custom pixels`,
          );
          check(
            saved.preview_appearance.pixels === "circle",
            `${profile}: ${section} leaves shared preset intact`,
          );
          editor.setConfig(JSON.parse(JSON.stringify(saved)));
          await editor.updateComplete;
          await local.updateComplete;
          check(
            sourceButtons()[1].getAttribute("aria-pressed") === "true",
            `${profile}: ${section} reloads custom choice`,
          );
          sourceButtons()[0].click();
          await editor.updateComplete;
          await local.updateComplete;
          check(
            !Object.keys(saved.preview_overrides[section] || {}).length,
            `${profile}: ${section} returns to preset`,
          );
          check(
            !local.shadowRoot.querySelector(".appearance-fields"),
            `${profile}: ${section} hides custom controls`,
          );
          check(
            saved.size_pct === 65 && saved.matrix_size === 65,
            `${profile}: ${section} keeps local sizes`,
          );
          sourceButtons()[1].click();
          await local.updateComplete;
          local.shadowRoot
            .querySelector('[data-field="pixels"] button[aria-label="Square"]')
            .click();
          await editor.updateComplete;
          await shared.updateComplete;
          [
            ...shared.shadowRoot.querySelectorAll(
              ".appearance-inheritance > button",
            ),
          ]
            .find(
              (button) =>
                button.textContent.trim() === "Use card default everywhere",
            )
            .click();
          await editor.updateComplete;
          await local.updateComplete;
          check(
            sourceButtons()[0].getAttribute("aria-pressed") === "true",
            `${profile}: global reset restores ${section} source control`,
          );
          check(
            !local.shadowRoot.querySelector(".appearance-fields"),
            `${profile}: global reset closes ${section} custom fields`,
          );
        }
        const card = document.createElement(`yeelight-cube-${name}-card`);
        for (const [preset, appearance] of Object.entries(APPEARANCE_PRESETS)) {
          await shared.updateComplete;
          shared.shadowRoot
            .querySelector(
              `[aria-label="${preset[0].toUpperCase() + preset.slice(1)} preset"]`,
            )
            .click();
          await editor.updateComplete;
          check(
            saved?.preview_appearance.background === appearance.background,
            `${profile}: ${preset} emitted`,
          );
          check(
            saved.size_pct === 65 && saved.matrix_size === 65,
            `${profile}: sizes preserved`,
          );
          editor.setConfig(JSON.parse(JSON.stringify(saved)));
          await editor.updateComplete;
          card.setConfig(saved);
          for (const definition of Object.values(
            APPEARANCE_PROFILES[profile],
          )) {
            check(
              card.config[definition.keys.pixels] === appearance.pixels,
              `${profile}: ${preset} pixels`,
            );
            check(
              card.config[definition.keys.shadow] === appearance.shadow,
              `${profile}: ${preset} shadow`,
            );
          }
          const host = document.createElement("appearance-render-fixture");
          host.cardStyles =
            profile === "draw" ? card.constructor.styles.cssText : "";
          host.style.display = "block";
          area.append(host);
          await host.updateComplete;
          const root = host.shadowRoot;
          const measure = async (width) => {
            host.style.width = `${width}px`;
            let content;
            if (profile === "native")
              content = card._matrix({ name: "Rainbow" }, true);
            if (profile === "lamp")
              content = html`${unsafeHTML(
                card._getStyles() +
                  card._generateMatrixHtml(pixels, {
                    attributes: { device_orientation: "right" },
                  }),
              )}`;
            if (profile === "gradient")
              content = html`${unsafeHTML(card._renderAngleRotary(45))}`;
            if (profile === "draw")
              content = card._renderMatrixSection(
                card.config,
                appearance.spacing === "normal" ? 3 : 0,
                appearance.background,
                "",
                "65%",
                appearance.pixels,
              );
            host.content = content;
            host.requestUpdate();
            await host.updateComplete;
            await frame();
            const grid = root.querySelector(
              ".gallery-matrix-preview, .lamp-preview-css, .matrix-preview-grid, .matrix",
            );
            const cell = grid?.children[1];
            check(cell, `${profile}: matrix cells`);
            const rect = cell.getBoundingClientRect();
            check(
              rect.width > 0 && Math.abs(rect.width - rect.height) < 1,
              `${profile}: square cells ${rect.width}x${rect.height}`,
            );
            const styles = getComputedStyle(grid);
            check(
              getComputedStyle(cell).borderRadius ===
                (appearance.pixels === "circle"
                  ? "50%"
                  : appearance.pixels === "rounded"
                    ? "20%"
                    : "0px"),
              `${profile}: rendered ${preset} shape`,
            );
            return {
              gap: parseFloat(styles.columnGap) / rect.width,
              padding: parseFloat(styles.paddingLeft) / rect.width,
            };
          };
          const large = await measure(350);
          const small = await measure(230);
          check(
            Math.abs(large.gap - small.gap) < 0.01 &&
              Math.abs(large.padding - small.padding) < 0.02,
            `${profile}: proportional ${preset} geometry`,
          );
          if (profile === "draw") {
            for (const mode of ["gallery", "list", "carousel", "album"]) {
              host.content = card._renderPixelArtByMode(
                [{ name: "Sample", pixels }],
                mode,
                false,
                appearance.background,
                false,
              );
              host.requestUpdate();
              await host.updateComplete;
              await frame();
              check(
                root.querySelector(".gallery-matrix-preview")?.children
                  .length === 100,
                `Draw ${mode}: shared matrix`,
              );
            }
          }
          host.remove();
        }
        if (profile === "gradient") {
          let renders = 0;
          card._previewCache = () => ({ data: { text: "Test", angle: 0 } });
          card._renderPreviewGrid = () => `render-${++renders}`;
          card._getCachedPreviewGrid();
          const before = renders;
          card.config.gallery_matrix_box_shadow =
            !card.config.gallery_matrix_box_shadow;
          card._getCachedPreviewGrid();
          check(
            renders === before + 1,
            "Gradient shadow-only update invalidates preview cache",
          );
        }
        editor.style.cssText =
          "display:block;width:400px;max-width:100%;margin:16px auto;";
        card.disconnectedCallback?.();
      }
    });
    for (const width of [1280, 390]) {
      await appearancePage.setViewportSize({ width, height: 1000 });
      for (const name of [
        "native-effects",
        "gradient",
        "lamp-preview",
        "draw",
      ]) {
        await appearancePage
          .locator(
            `#shared-appearance-regressions yeelight-cube-${name}-card-editor`,
          )
          .screenshot({
            path: path.join(
              os.tmpdir(),
              `yeelight-${name}-appearance-${width}.png`,
            ),
          });
      }
    }
    assert.deepEqual(appearanceErrors, []);
    await appearancePage.close();
    console.log(
      "PASS shared presets, config reload and proportional geometry on Native, Gradient, Lamp and Draw; all Draw gallery layouts",
    );
    console.log(
      "PASS Clock appearance presets, sparse overrides, reset, local sizes, legacy adoption and desktop/mobile editor",
    );
    console.log(
      "PASS proportional Clock gaps and padding across six browser layouts, three sizes and two card widths",
    );
    if (process.env.FOCUSED_CONTROLS) return;
    await page.mouse.move(0, 0);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.evaluate(() => {
      for (const card of [clock, native]) {
        card.setConfig(baseConfig);
        card.hass = hass;
      }
    });
    let comparisons = 0;
    for (const width of [288, 358, 560]) {
      for (const style of [
        "modern",
        "classic",
        "outline",
        "gradient",
        "icon",
        "pill",
      ]) {
        for (const content of ["icon", "text", "icon_text"]) {
          for (const preset of ["label", "filled", "name"]) {
            const result = await page.evaluate(
              async ({ width, style, content, preset }) => {
                await configure(
                  {
                    buttons_style: style,
                    buttons_content_mode: content,
                    color_preset_style: preset,
                  },
                  width,
                  [18, 52, 86],
                );
                return { clock: snapshot(clock), native: snapshot(native) };
              },
              { width, style, content, preset },
            );
            assert.deepEqual(
              result.native,
              result.clock,
              `${width}/${style}/${content}/${preset}`,
            );
            if (style === "icon")
              for (const button of [
                ...result.native.buttons,
                ...result.native.save,
              ])
                assert.equal(
                  button.width,
                  button.height,
                  `Square icon: ${button.title}`,
                );
            comparisons++;
          }
        }
      }
      for (const shape of ["square", "rounded", "round"]) {
        const result = await page.evaluate(
          async ({ width, shape }) => {
            await configure(
              { color_mode_selector: "dropdown", color_mode_shape: shape },
              width,
              null,
            );
            return { clock: snapshot(clock), native: snapshot(native) };
          },
          { width, shape },
        );
        assert.deepEqual(
          result.native,
          result.clock,
          `dropdown ${width}/${shape}`,
        );
        comparisons++;
      }
    }
    for (const mode of ["normal", "bw", "custom:red"]) {
      for (const shape of ["square", "rounded", "circle"]) {
        const result = await page.evaluate(
          async ({ mode, shape }) => {
            const color = mode.startsWith("custom:") ? [160, 40, 40] : null;
            const palette = color ? "normal" : mode;
            hass = {
              ...hass,
              states: {
                ...hass.states,
                "light.a": {
                  ...hass.states["light.a"],
                  attributes: {
                    ...hass.states["light.a"].attributes,
                    native_effect_color_mode: palette,
                    clock_color_mode: palette,
                    native_effect_color: color,
                    clock_color: color ? 0x01a02828 : null,
                  },
                },
              },
            };
            await configure(
              {
                buttons_style: "pill",
                buttons_content_mode: "icon_text",
                color_preset_shape: shape,
              },
              358,
              null,
            );
            clock._customPresetColor = color;
            clock.render();
            await clock.updateComplete;
            return { clock: snapshot(clock), native: snapshot(native) };
          },
          { mode, shape },
        );
        assert.deepEqual(result.native, result.clock, `${mode}/${shape}`);
        comparisons++;
      }
    }
    for (const style of ["pill", "icon", "gradient"]) {
      await page.evaluate(
        async (style) =>
          configure(
            { buttons_style: style, buttons_content_mode: "icon_text" },
            358,
            [18, 52, 86],
          ),
        style,
      );
      await page.locator("main").screenshot({
        path: path.join(os.tmpdir(), `card-colour-parity-${style}.png`),
      });
    }
    let commonComparisons = 0;
    for (const width of [288, 358, 560]) {
      for (const style of [
        "modern",
        "classic",
        "outline",
        "gradient",
        "icon",
        "pill",
      ]) {
        const controls = await page.evaluate(
          async ({ width, style }) => {
            await configure(
              {
                show_actions: true,
                actions_buttons_style: style,
                actions_buttons_content_mode: "icon_text",
              },
              width,
              null,
            );
            const result = [];
            for (const card of [clock, native]) {
              const view = card.shadowRoot.querySelector(
                'yeelight-mode-controls[area="actions"]',
              );
              await view.updateComplete;
              await Promise.all(
                [...view.shadowRoot.querySelectorAll("button")].flatMap(
                  (button) =>
                    button
                      .getAnimations()
                      .map((animation) => animation.finished),
                ),
              );
              result.push(
                [...view.shadowRoot.querySelectorAll("button")]
                  .filter((button) =>
                    ["Random", "Freeze effect", "Turn off"].includes(
                      button.title,
                    ),
                  )
                  .map(describeControl),
              );
            }
            return result;
          },
          { width, style },
        );
        assert.ok(controls[0].length >= 2);
        assert.deepEqual(controls[1], controls[0], `Actions ${width}/${style}`);
        commonComparisons++;
      }
      for (const style of [
        "slider",
        "bar",
        "wheel",
        "matrix",
        "rotary",
        "capsule",
      ]) {
        const controls = await page.evaluate(
          async ({ width, style }) => {
            await configure(
              {
                show_brightness: true,
                show_animation_speed: true,
                slider_style: style,
              },
              width,
              null,
            );
            return [clock, native].map((card) =>
              [
                ...card.shadowRoot
                  .querySelector(".brightness-control-group")
                  .querySelectorAll("*"),
              ].map((node) => ({
                tag: node.tagName,
                classes: node.className,
                ...describeControl(node),
              })),
            );
          },
          { width, style },
        );
        assert.deepEqual(controls[1], controls[0], `Sliders ${width}/${style}`);
        commonComparisons++;
      }
    }
    // Freeze action + configurable order/visibility, identical on both cards.
    for (const card of ["clock", "native"]) {
      const order = await page.evaluate(async (card) => {
        window[card].calls = calls;
        await configure({ show_actions: true }, 358, null);
        const view = window[card].shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        await view.updateComplete;
        return [...view.shadowRoot.querySelectorAll("button")].map(
          (button) => button.title,
        );
      }, card);
      assert.ok(
        order.includes("Freeze effect"),
        `${card} shows Freeze by default`,
      );
      const before = await page.evaluate(() => calls.length);
      await page
        .locator(
          `yeelight-cube-${card === "clock" ? "clock" : "native-effects"}-card yeelight-mode-controls[area="actions"]`,
        )
        .getByRole("button", { name: "Freeze effect", exact: true })
        .click();
      await page.waitForFunction(
        (card) => window[card]._controls.frozen === true,
        card,
      );
      assert.equal(
        await page.evaluate(() => calls.at(-1).service),
        "freeze_display",
      );
      // Resume re-applies the current mode (resends the last command).
      await page
        .locator(
          `yeelight-cube-${card === "clock" ? "clock" : "native-effects"}-card yeelight-mode-controls[area="actions"]`,
        )
        .getByRole("button", { name: "Resume effect", exact: true })
        .click();
      await page.waitForFunction(
        (card) => window[card]._controls.frozen === false,
        card,
      );
      assert.ok((await page.evaluate(() => calls.length)) > before + 1);
      // Custom order/visibility drives the rendered row.
      const custom = await page.evaluate(async (card) => {
        await configure(
          { show_actions: true, action_buttons: ["power", "freeze", "random"] },
          358,
          null,
        );
        const view = window[card].shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        await view.updateComplete;
        return [...view.shadowRoot.querySelectorAll("button")].map(
          (button) => button.title,
        );
      }, card);
      assert.deepEqual(custom, ["Turn off", "Freeze effect", "Random"]);
      commonComparisons++;
    }
    // Native Freeze is greyed out for effects the firmware can't freeze, and
    // freezing then switching effects resets the button to its idle state.
    const freezeGating = await page.evaluate(async () => {
      const setEffect = async (name) => {
        hass = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              ...hass.states["light.a"],
              attributes: {
                ...hass.states["light.a"].attributes,
                native_effect: name,
              },
            },
          },
        };
        native._selected = null;
        native.hass = hass;
        await native.updateComplete;
        const view = native.shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        await view.updateComplete;
        return view.shadowRoot.querySelector(
          'button[title="Freeze effect"], button[title="Resume effect"]',
        );
      };
      await configure({ show_actions: true }, 358, null);
      // "Starry sky" is not freeze-compatible -> disabled.
      const incompatible = (await setEffect("Starry sky")).disabled;
      // "Rainbow" is compatible -> enabled and freezable.
      const compatible = (await setEffect("Rainbow")).disabled;
      await native._controls.freeze();
      const frozen = native._controls.frozen;
      // Selecting another (compatible) effect from the grid resumes.
      native._selected = "Tide";
      native._controls.update();
      const afterSwitch = native._controls.frozen;
      return { incompatible, compatible, frozen, afterSwitch };
    });
    assert.equal(
      freezeGating.incompatible,
      true,
      "incompatible freeze disabled",
    );
    assert.equal(freezeGating.compatible, false, "compatible freeze enabled");
    assert.equal(freezeGating.frozen, true, "freeze engaged for Rainbow");
    assert.equal(
      freezeGating.afterSwitch,
      false,
      "switching effects resets freeze",
    );
    commonComparisons++;
    // The clock card applies the same gating by its current style's name.
    const clockGating = await page.evaluate(async () => {
      const setStyle = async (name, id) => {
        hass = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              ...hass.states["light.a"],
              attributes: {
                ...hass.states["light.a"].attributes,
                clock_style: name,
                clock_style_id: id,
              },
            },
          },
        };
        clock.setConfig({ ...baseConfig, show_actions: true });
        clock.hass = hass;
        clock.render();
        const view = clock.shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        await view.updateComplete;
        return view.shadowRoot.querySelector(
          'button[title="Freeze effect"], button[title="Resume effect"]',
        );
      };
      // "Yellow" (solid style) is not freeze-compatible -> disabled.
      const solid = (await setStyle("Yellow", 6)).disabled;
      // "Rainbow" clock style is freeze-compatible -> enabled.
      const animated = (await setStyle("Rainbow", 1)).disabled;
      return { solid, animated };
    });
    assert.equal(clockGating.solid, true, "solid clock style freeze disabled");
    assert.equal(
      clockGating.animated,
      false,
      "animated clock style freeze enabled",
    );
    commonComparisons++;
    // Previews mirror the frozen lamp: the clock holds its background phase but
    // keeps repainting (time stays live); the native effect holds its frame.
    const previewFreeze = await page.evaluate(async () => {
      await configure({ show_actions: true }, 358, null);
      // Clock: frozen holds the animation phase across repaints, then resumes.
      clock._controls.frozen = true;
      const phase0 = clock._phaseAccum;
      let paints = 0;
      const originalPaint = clock._paintPreview.bind(clock);
      clock._visible = new Set(["a", "b"]);
      clock._paintPreview = () => {
        paints++;
      };
      clock._paintVisible();
      clock._paintVisible();
      const frozenHeld = clock._phaseAccum === phase0 && paints > 0;
      clock._paintPreview = originalPaint;
      clock._visible = new Set();
      clock._controls.frozen = false;
      clock._lastPhaseTs = Date.now() - 1000;
      clock._advancePhase();
      const clockResumes = clock._phaseAccum > phase0;

      // Native: elapsed holds while frozen, advances once resumed.
      const wait = () => new Promise((r) => setTimeout(r, 160));
      if (native._visibility) native._visibility.onScreen = true;
      native._paused = false;
      native._controls.frozen = false;
      const e0 = native._elapsed;
      await wait();
      const nativeAdvances = native._elapsed > e0;
      native._controls.frozen = true;
      const e1 = native._elapsed;
      await wait();
      const nativeHeld = native._elapsed === e1;
      native._controls.frozen = false;
      return {
        frozenHeld,
        clockResumes,
        nativeAdvances,
        nativeHeld,
      };
    });
    assert.ok(
      previewFreeze.frozenHeld,
      "clock holds its phase yet keeps repainting when frozen",
    );
    assert.ok(previewFreeze.clockResumes, "clock phase resumes after unfreeze");
    assert.ok(
      previewFreeze.nativeAdvances,
      "native preview animates when not frozen",
    );
    assert.ok(previewFreeze.nativeHeld, "native preview holds when frozen");
    commonComparisons++;
    await page.evaluate(async () =>
      configure({ buttons_style: "icon" }, 358, [18, 52, 86]),
    );
    assert.ok(
      await page.evaluate(async () => {
        const manager = native.shadowRoot.querySelector(
          "yeelight-clock-preset-manager",
        );
        const button = manager.shadowRoot.querySelector("button");
        for (const color of [null, [1, 2, 3], [18, 52, 86]]) {
          hass = {
            ...hass,
            states: {
              ...hass.states,
              "light.a": {
                ...hass.states["light.a"],
                attributes: {
                  ...hass.states["light.a"].attributes,
                  native_effect_color: color,
                },
              },
            },
          };
          native.hass = hass;
          await native.updateComplete;
          await manager.updateComplete;
          if (
            !button.isConnected ||
            native.shadowRoot.querySelector("yeelight-clock-preset-manager") !==
              manager ||
            manager.shadowRoot.querySelector("button") !== button
          )
            return false;
        }
        return true;
      }),
      "Icon save trigger must retain its DOM identity across state echoes",
    );
    const nativeManager = page.locator(
      "yeelight-cube-native-effects-card yeelight-clock-preset-manager",
    );
    await nativeManager
      .getByRole("button", { name: "Save colour mode", exact: true })
      .click();
    await nativeManager.locator('input[type="text"]').fill("Keep my draft");
    const stable = await page.evaluate(async () => {
      const manager = native.shadowRoot.querySelector(
        "yeelight-clock-preset-manager",
      );
      const input = manager.shadowRoot.querySelector('input[type="text"]');
      for (const color of [null, [1, 2, 3], [18, 52, 86], [4, 5, 6]]) {
        hass = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              ...hass.states["light.a"],
              attributes: {
                ...hass.states["light.a"].attributes,
                native_effect_color: color,
              },
            },
          },
        };
        native.hass = hass;
        await native.updateComplete;
        if (
          native.shadowRoot.querySelector("yeelight-clock-preset-manager") !==
            manager ||
          !manager.editing ||
          manager.shadowRoot.querySelector('input[type="text"]') !== input ||
          input.value !== "Keep my draft"
        )
          return false;
      }
      return true;
    });
    assert.ok(
      stable,
      "State echoes must not remove or reset the open save form",
    );
    await nativeManager
      .getByRole("button", { name: "Save", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => calls.at(-1).data.name),
      "Keep my draft",
    );
    assert.equal(
      await page.evaluate(() => calls.at(-1).data.kind),
      "color_mode",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${comparisons} colour/save and ${commonComparisons} Actions/slider comparisons; stable Icon save trigger and form across delayed state echoes; successful save.`,
    );

    // The live lamp-preview card's own clock/native loops hold the background
    // animation while frozen and resume seamlessly (mirrors the frozen lamp).
    const lampResult = await page.evaluate(async () => {
      const module =
        await import("/custom_components/yeelight_cube/www/yeelight-cube-lamp-preview-card.js");
      const proto = customElements.get(
        "yeelight-cube-lamp-preview-card",
      ).prototype;
      const makeCard = (content_mode) => ({
        _onScreen: true,
        config: { entity: "light.a" },
        _hass: {
          states: {
            "light.a": {
              state: "on",
              attributes: { content_mode, display_frozen: false },
            },
          },
        },
        _getLampDots: () => new Array(100).fill({}),
        _updateMatrixColors() {},
        _matrixColorsToGridColors: (x) => x,
        _getNativeClockFont: () => ({ fontMap: null, metrics: null }),
        _clockAnimStartedAt: null,
        _frozenBackgroundPhase: null,
        _nativeAnimKey: null,
        _nativeAnimStartedAt: null,
        _nativeFrozenPhase: null,
      });

      // Native effect loop: phase advances, then holds once frozen.
      const card = makeCard("Native Effect");
      card._hass.states["light.a"].attributes.native_effect = "Rainbow";
      card._hass.states["light.a"].attributes.native_effect_direction = "Up";
      card._hass.states["light.a"].attributes.native_effect_speed = 50;
      let performanceNow = 1000;
      const realNow = performance.now.bind(performance);
      performance.now = () => performanceNow;
      proto._nativeAnimFrame.call(card);
      performanceNow += 1000;
      proto._nativeAnimFrame.call(card);
      const animatedPhase = card._nativeFrozenPhase;
      card._hass.states["light.a"].attributes.display_frozen = true;
      performanceNow += 1000;
      proto._nativeAnimFrame.call(card);
      const frozenPhase = card._nativeFrozenPhase;
      performanceNow += 1000;
      proto._nativeAnimFrame.call(card);
      const heldPhase = card._nativeFrozenPhase;
      card._hass.states["light.a"].attributes.display_frozen = false;
      performanceNow += 1000;
      proto._nativeAnimFrame.call(card);
      performanceNow += 1000;
      proto._nativeAnimFrame.call(card);
      performance.now = realNow;
      return {
        animated: animatedPhase === null, // not frozen yet -> no held phase
        frozen: typeof frozenPhase === "number",
        held: heldPhase === frozenPhase,
        resumed: card._nativeFrozenPhase === null,
      };
    });
    assert.ok(lampResult.animated, "lamp native loop animates when not frozen");
    assert.ok(lampResult.frozen, "lamp native loop holds a phase when frozen");
    assert.ok(
      lampResult.held,
      "lamp native loop holds that frame while frozen",
    );
    assert.ok(lampResult.resumed, "lamp native loop resumes after unfreeze");
    console.log(
      "PASS lamp-preview loops hold the frozen background and resume seamlessly",
    );
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.evaluate(async () => {
        const main = document.querySelector("main");
        main.replaceChildren();
        main.style.display = "block";
        window.editors = [];
        const editorHass = {
          ...window.hass,
          states: {
            ...window.hass.states,
            "light.a": {
              state: "on",
              attributes: {
                ...window.hass.states["light.a"].attributes,
                friendly_name: "CubeLite Top",
                extended_effects_enabled: true,
              },
            },
            "light.b": {
              state: "on",
              attributes: {
                friendly_name: "CubeLite Bottom",
                extended_effects_enabled: false,
              },
            },
          },
        };
        for (const tag of [
          "yeelight-cube-clock-card-editor",
          "yeelight-cube-native-effects-card-editor",
        ]) {
          const editor = document.createElement(tag);
          editor.style.cssText =
            "display:block;max-width:650px;margin:0 auto 16px;";
          editor.setConfig({
            target_entities: ["light.a", "light.b"],
            visible_effects: ["Twinkle", "Rainbow"],
            show_experimental: false,
          });
          editor.hass = editorHass;
          main.append(editor);
          await editor.updateComplete;
          window.editors.push(editor);
        }
      });
      const notices = page.locator(".experimental-availability");
      assert.equal(await notices.count(), 2);
      for (const notice of await notices.all()) {
        assert.match(await notice.innerText(), /Off: CubeLite Bottom/);
        assert.doesNotMatch(await notice.innerText(), /Off: CubeLite Top/);
        assert.ok(
          await notice.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        );
      }
      assert.doesNotMatch(
        await notices.nth(1).innerText(),
        /Experimental Effects filter/,
      );
      await page.screenshot({
        path: path.join(
          os.tmpdir(),
          `yeelight-experimental-editors-${width}.png`,
        ),
        fullPage: true,
      });
      const restored = await page.evaluate(async () => {
        const editor = window.editors[1];
        editor._open = { effects: true };
        editor.requestUpdate();
        await editor.updateComplete;
        const unavailable = editor.shadowRoot.textContent.includes(
          "Twinkle (currently unavailable)",
        );
        editor._change("show_experimental", true);
        editor.hass = {
          ...editor.hass,
          states: {
            ...editor.hass.states,
            "light.b": {
              state: "on",
              attributes: {
                friendly_name: "CubeLite Bottom",
                extended_effects_enabled: true,
              },
            },
          },
        };
        await editor.updateComplete;
        return {
          unavailable,
          config: editor._config.visible_effects,
          notice: editor.shadowRoot.querySelector(".experimental-availability")
            .textContent,
        };
      });
      assert.equal(restored.unavailable, true);
      assert.deepEqual(restored.config, ["Twinkle", "Rainbow"]);
      assert.match(restored.notice, /On for all selected lamps/);
      assert.doesNotMatch(restored.notice, /filter is Off/);
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS experimental editor notices on desktop/mobile, live updates and retained hidden selections",
    );

    // Favourites previews: repeated Lit re-renders (as triggered by every
    // controller.notify() on Home Assistant state updates) must regenerate
    // the preview markup at the animation loop's current time — never phase 0,
    // which visibly flashed the animation's first frame.
    const previewPhases = await page.evaluate(async () => {
      const view = document.createElement("yeelight-mode-controls");
      view.area = "collections";
      const phases = [];
      view.model = {
        config: { show_favourites: true },
        favourites: [{ key: "Rainbow", colorMode: "normal" }],
        names: () => ["Rainbow"],
        hasFavourite: (key) => key === "Rainbow",
        currentFavourite: () => ({ key: "Rainbow", colorMode: "normal" }),
        captureFavourite: (key) => ({ key, colorMode: "normal" }),
        paused: false,
        busy: false,
        error: "",
        listeners: new Set(),
        adapter: {
          kind: "clock",
          items: () => [{ key: "Rainbow", title: "Rainbow" }],
          current: () => "Rainbow",
          available: () => true,
          disabled: () => false,
          frame: (key, phase) => {
            phases.push(phase);
            return new Array(100).fill([0, 0, 0]);
          },
        },
      };
      document.body.append(view);
      await view.updateComplete;
      view.requestUpdate();
      await view.updateComplete;
      view.requestUpdate();
      await view.updateComplete;
      view.remove();
      return phases;
    });
    assert.ok(
      previewPhases.length >= 3,
      "favourites previews render on every re-render",
    );
    assert.ok(
      previewPhases.every((phase) => phase > 1),
      `favourites previews never regenerate a phase-0 frame: ${previewPhases}`,
    );
    assert.deepEqual(errors, []);
    console.log("PASS favourites previews re-render at current animation time");

    // Favourites/rotation UX: star badges on grid items, no section
    // separators, and the value+unit rotation interval editor control.
    const ux = await page.evaluate(async () => {
      const results = {};
      const normalHass = {
        ...window.hass,
        states: {
          ...window.hass.states,
          "light.a": {
            ...window.hass.states["light.a"],
            attributes: {
              ...window.hass.states["light.a"].attributes,
              clock_color_mode: "normal",
              clock_color: null,
              native_effect_color_mode: "normal",
              native_effect_color: null,
            },
          },
        },
      };
      // No separator between Favourites and Rotation sections.
      const view = document.createElement("yeelight-mode-controls");
      view.area = "collections";
      view.model = {
        config: {
          show_favourites: true,
          show_rotation: true,
          rotation_interval: 3600,
        },
        favourites: [{ key: "Rainbow", colorMode: "normal" }],
        names: () => ["Rainbow"],
        hasFavourite: (key) => key === "Rainbow",
        currentFavourite: () => ({ key: "Rainbow", colorMode: "normal" }),
        captureFavourite: (key) => ({ key, colorMode: "normal" }),
        ready: () => true,
        active: false,
        frozen: false,
        freezable: () => true,
        paused: false,
        busy: false,
        error: "",
        listeners: new Set(),
        adapter: {
          kind: "clock",
          items: () => [{ key: "Rainbow", title: "Rainbow" }],
          current: () => "Rainbow",
          available: () => true,
          disabled: () => false,
          frame: () => new Array(100).fill([0, 0, 0]),
        },
      };
      document.body.append(view);
      await view.updateComplete;
      const section = view.shadowRoot.querySelector("section");
      results.noSeparator = getComputedStyle(section).borderTopWidth === "0px";
      results.rotationSummary = /1 clock mode · every\s+1h/.test(
        view.shadowRoot.textContent,
      );
      view.remove();

      // Star badge on grid items whose mode is in the favourites list.
      const clock = document.createElement("yeelight-cube-clock-card");
      clock.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        style_selector_style: "preview-grid",
      });
      clock.hass = normalHass;
      document.body.append(clock);
      const clockKey = clock._controls.adapter.items()[0].key;
      clock._controls.save([clockKey]);
      clock.render();
      await clock.updateComplete;
      results.clockStar = !!clock.shadowRoot.querySelector(
        `[data-mode="${CSS.escape(clockKey)}"][data-favourite="true"]`,
      );
      clock._controls.save([]);
      clock.render();
      await clock.updateComplete;
      results.clockUnstar = !clock.shadowRoot.querySelector(
        '[data-favourite="true"]',
      );
      clock.remove();

      const native = document.createElement(
        "yeelight-cube-native-effects-card",
      );
      native.setConfig({ ...window.baseConfig, show_gallery: true });
      native.hass = normalHass;
      document.body.append(native);
      await native.updateComplete;
      native._controls.save(["Rainbow"]);
      await native.updateComplete;
      results.nativeStar = !!native.shadowRoot.querySelector(
        '[data-mode="Rainbow"][data-favourite="true"]',
      );
      native._controls.save([]);
      await native.updateComplete;
      results.nativeUnstar = !native.shadowRoot.querySelector(
        '[data-favourite="true"]',
      );
      native.remove();

      // Rotation interval editor: value + unit, no custom list / shuffle.
      const editor = document.createElement("yeelight-cube-clock-card-editor");
      editor.setConfig({
        ...window.baseConfig,
        show_rotation: true,
        rotation_interval: 7200,
      });
      editor.hass = window.hass;
      document.body.append(editor);
      await editor.updateComplete;
      const input = editor.shadowRoot.querySelector(
        'input[aria-label="Rotation interval value"]',
      );
      const unit = editor.shadowRoot.querySelector(
        'select[aria-label="Rotation interval unit"]',
      );
      const text = editor.shadowRoot.textContent;
      results.editorControl =
        text.includes("Rotate every") &&
        !text.includes("Custom List") &&
        !text.includes("No Immediate Repeats") &&
        input?.value === "2" &&
        unit?.value === "hours";
      unit.value = "days";
      unit.dispatchEvent(new Event("change"));
      results.editorSaves = editor.config.rotation_interval === 172800;
      editor.remove();
      return results;
    });
    assert.deepEqual(ux, {
      noSeparator: true,
      rotationSummary: true,
      clockStar: true,
      clockUnstar: true,
      nativeStar: true,
      nativeUnstar: true,
      editorControl: true,
      editorSaves: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS favourite star badges, seamless sections, rotation summary and interval editor",
    );
    const stars = await page.evaluate(async () => {
      const results = {};
      const starHass = structuredClone({ states: window.hass.states });
      starHass.callService = window.hass.callService;
      Object.assign(starHass.states["light.a"].attributes, {
        clock_color_mode: "normal",
        clock_color: null,
        native_effect_color_mode: "normal",
        native_effect_color: null,
      });
      const clockWith = async (style) => {
        const clock = document.createElement("yeelight-cube-clock-card");
        clock.setConfig({
          ...window.baseConfig,
          show_gallery: true,
          style_selector_style: style,
        });
        clock.hass = starHass;
        document.body.append(clock);
        const key = clock._controls.adapter.items()[0].key;
        clock._controls.save([key]);
        clock.render();
        await clock.updateComplete;
        return { clock, key };
      };
      const inlineStar = (node) =>
        node && getComputedStyle(node, "::before").content.includes("★");
      // Text (filled) selector shows the star inline in the button.
      {
        const { clock, key } = await clockWith("filled");
        const item = clock.shadowRoot.querySelector(
          `[data-mode="${CSS.escape(key)}"][data-favourite="true"]`,
        );
        results.textStar = !!item;
        results.textBadge = inlineStar(item);
        clock.remove();
      }
      // Wheel selector shows the star inline in the item title.
      {
        const { clock, key } = await clockWith("preview-wheel");
        const item = clock.shadowRoot.querySelector(
          `[data-mode="${CSS.escape(key)}"][data-favourite="true"]`,
        );
        results.wheelStar =
          !!item &&
          inlineStar(
            item.querySelector(".wheel-item-title, .wheel-item-title-hover"),
          );
        clock.remove();
      }
      // Native "Original" effects browser shows the star in the item name.
      {
        const native = document.createElement(
          "yeelight-cube-native-effects-card",
        );
        native.setConfig({
          ...window.baseConfig,
          show_gallery: true,
          effect_view: "grid",
          style_selector_style: "original",
        });
        native.hass = starHass;
        document.body.append(native);
        await native.updateComplete;
        native._controls.save(["Rainbow"]);
        await native.updateComplete;
        const item = native.shadowRoot.querySelector(
          '.original-item[data-mode="Rainbow"][data-favourite="true"]',
        );
        results.originalStar =
          !!item && inlineStar(item.querySelector(".original-item-name"));
        native.remove();
      }
      // The editor toggle disables the badge (host gate).
      {
        const clock = document.createElement("yeelight-cube-clock-card");
        clock.setConfig({
          ...window.baseConfig,
          style_selector_style: "filled",
          show_gallery: true,
          favourites_show_stars: false,
        });
        clock.hass = starHass;
        document.body.append(clock);
        const key = clock._controls.adapter.items()[0].key;
        clock._controls.save([key]);
        clock.render();
        await clock.updateComplete;
        const item = clock.shadowRoot.querySelector(
          `[data-mode="${CSS.escape(key)}"][data-favourite="true"]`,
        );
        results.hostAttr = clock.getAttribute("data-fav-stars") === "false";
        results.hidden = !inlineStar(item);
        clock.remove();
      }
      // The Favourites editor area exposes the toggle.
      {
        const editor = document.createElement(
          "yeelight-cube-clock-card-editor",
        );
        editor.setConfig({ ...window.baseConfig, show_favourites: true });
        editor.hass = window.hass;
        document.body.append(editor);
        await editor.updateComplete;
        results.editorToggle = editor.shadowRoot.textContent.includes(
          "Show favourite stars",
        );
        editor.remove();
      }
      return results;
    });
    assert.deepEqual(stars, {
      textStar: true,
      textBadge: true,
      wheelStar: true,
      originalStar: true,
      hostAttr: true,
      hidden: true,
      editorToggle: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS favourite stars across text/wheel/original selectors with editor toggle",
    );
    const rotation = await page.evaluate(async () => {
      calls.length = 0;
      for (const card of [clock, native]) {
        card.setConfig({ ...baseConfig, show_rotation: true });
        card._controls.favourites = [];
      }
      for (const kind of ["clock", "native"]) {
        const state = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              ...hass.states["light.a"],
              attributes: {
                ...hass.states["light.a"].attributes,
                effect_rotation: {
                  active: true,
                  kind,
                  items: ["Rainbow", "White"],
                },
              },
            },
          },
        };
        for (const card of [clock, native]) {
          card.hass = state;
          if (card.updateComplete) await card.updateComplete;
          card._controls.update();
        }
        if (clock._controls.active !== (kind === "clock"))
          return "clock kind mismatch";
        if (native._controls.active !== (kind === "native"))
          return "native kind mismatch";
      }
      await native._queue;
      return calls.filter((call) => call.service === "stop_effect_rotation");
    });
    assert.deepEqual(
      rotation,
      [],
      "observing cards must not cancel server rotation",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS real Clock/Native cards observe backend rotation without unsolicited Stop calls",
    );
    const sliderWheel = await page.evaluate(async () => {
      const clock = document.createElement("yeelight-cube-clock-card");
      clock.setConfig({
        ...window.baseConfig,
        show_animation_speed: true,
        slider_style: "slider",
      });
      clock.hass = window.hass;
      document.body.append(clock);
      const container = clock.shadowRoot.querySelector(
        ".brightness-slider-container",
      );
      const input = container.querySelector(".brightness-slider");
      const before = parseInt(input.value);
      const wheel = (deltaX, deltaY) =>
        container.dispatchEvent(
          new WheelEvent("wheel", {
            deltaX,
            deltaY,
            bubbles: true,
            cancelable: true,
          }),
        );
      wheel(0, -120); // vertical up → increase
      const afterUp = parseInt(input.value);
      wheel(0, 120); // vertical down → decrease
      const afterDown = parseInt(input.value);
      wheel(120, 0); // horizontal right → increase
      const afterRight = parseInt(input.value);
      wheel(-120, 0); // horizontal left → decrease
      const afterLeft = parseInt(input.value);
      clock.remove();
      return { before, afterUp, afterDown, afterRight, afterLeft };
    });
    assert.ok(
      sliderWheel.afterUp > sliderWheel.before &&
        sliderWheel.afterDown < sliderWheel.afterUp &&
        sliderWheel.afterRight > sliderWheel.afterDown &&
        sliderWheel.afterLeft < sliderWheel.afterRight,
      `slider wheel should move up/down with vertical AND horizontal input: ${JSON.stringify(sliderWheel)}`,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS slider wheel supports vertical and horizontal input in both directions",
    );
    const emptyConfig = await page.evaluate(() => {
      const results = {};
      const attempt = (label, factory) => {
        try {
          const card = factory();
          card.setConfig({});
          document.body.append(card);
          if (card.updateComplete) card.requestUpdate();
          results[label] = "ok";
          card.remove();
        } catch (error) {
          results[label] = error.message;
        }
      };
      attempt("native", () =>
        document.createElement("yeelight-cube-native-effects-card"),
      );
      attempt("clock", () =>
        document.createElement("yeelight-cube-clock-card"),
      );
      return results;
    });
    assert.deepEqual(
      emptyConfig,
      { native: "ok", clock: "ok" },
      "setConfig must not throw when no entity is configured yet (cache wipe + SPA navigation)",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS cards render a graceful placeholder instead of Configuration error without an entity",
    );
    const modeCleanup = await page.evaluate(async () => {
      const results = {};
      // Clock editor: Text Style only offers Filled + Dropdown (no Chips).
      const clockEditor = document.createElement(
        "yeelight-cube-clock-card-editor",
      );
      clockEditor.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        style_selector_style: "filled",
      });
      clockEditor.hass = window.hass;
      document.body.append(clockEditor);
      await clockEditor.updateComplete;
      results.clockNoChips = !clockEditor.shadowRoot.querySelector(
        '[data-value="chips"]',
      );
      results.clockHasOriginal = !!clockEditor.shadowRoot.querySelector(
        '[data-value="original"]',
      );
      clockEditor.remove();

      // Native editor: Original Display only offers Grid + List.
      const nativeEditor = document.createElement(
        "yeelight-cube-native-effects-card-editor",
      );
      nativeEditor.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        effect_view: "grid",
      });
      nativeEditor.hass = window.hass;
      document.body.append(nativeEditor);
      await nativeEditor.updateComplete;
      const displayGroup = nativeEditor.shadowRoot
        .querySelector('[data-value="grid"]')
        ?.closest(".button-group");
      results.nativeDisplay =
        !!displayGroup &&
        !displayGroup.querySelector('[data-value="buttons"]') &&
        !displayGroup.querySelector('[data-value="dropdown"]');
      nativeEditor.remove();
      return results;
    });
    assert.deepEqual(modeCleanup, {
      clockNoChips: true,
      clockHasOriginal: true,
      nativeDisplay: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS mode cleanup: Text = Filled/Dropdown, Original = Grid/List (shared, no Chips/Buttons/Dropdown)",
    );

    const originalGallery = await page.evaluate(async () => {
      const results = {};

      // Clock card renders the shared Original gallery with badges + active
      // state (grid by default, list via effect_view).
      const clock = document.createElement("yeelight-cube-clock-card");
      clock.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        style_selector_style: "original",
      });
      clock.hass = window.hass;
      document.body.append(clock);
      clock.render();
      await clock.updateComplete;
      const gallery = clock.shadowRoot.querySelector(".original-gallery");
      const items = [...clock.shadowRoot.querySelectorAll(".original-item")];
      results.clockGallery =
        !!gallery && gallery.classList.contains("grid") && items.length > 0;
      results.clockBadges = items.every(
        (item) =>
          item.querySelector(".original-item-name") &&
          item.querySelector(".original-item-badge"),
      );
      results.clockActive =
        items.filter((item) => item.getAttribute("aria-pressed") === "true")
          .length === 1;
      clock.remove();

      const clockList = document.createElement("yeelight-cube-clock-card");
      clockList.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        style_selector_style: "original",
        effect_view: "list",
      });
      clockList.hass = window.hass;
      document.body.append(clockList);
      clockList.render();
      await clockList.updateComplete;
      results.clockListView = !!clockList.shadowRoot.querySelector(
        ".original-gallery.list",
      );
      clockList.remove();

      // Native card uses the same shared classes.
      const native = document.createElement(
        "yeelight-cube-native-effects-card",
      );
      native.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        effect_view: "grid",
        style_selector_style: "original",
      });
      native.hass = window.hass;
      document.body.append(native);
      await native.updateComplete;
      results.nativeGallery = !!native.shadowRoot.querySelector(
        ".original-gallery .original-item .original-item-badge",
      );
      native.remove();

      // Clock editor: Show Effect Browser + Original sub-settings, no
      // Experimental Effects toggle.
      const editor = document.createElement("yeelight-cube-clock-card-editor");
      editor.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        style_selector_style: "original",
      });
      editor.hass = window.hass;
      document.body.append(editor);
      await editor.updateComplete;
      const text = editor.shadowRoot.textContent;
      results.editorShowBrowser = text.includes("Show Effect Browser");
      results.editorDisplay =
        !!editor.shadowRoot.querySelector('[data-value="grid"]') &&
        !!editor.shadowRoot.querySelector('[data-value="list"]');
      results.editorAppearance = text.includes("Gallery Appearance");
      results.editorBadges = text.includes("Capability Labels");
      results.editorHighlight = text.includes("Highlight Active Style");
      results.editorPerPage = text.includes("Items Per Page");
      results.editorNoExperimental = !text.includes("Experimental Effects");
      editor.remove();

      // Native editor: same structure, no Experimental Effects toggle.
      const nativeEditor = document.createElement(
        "yeelight-cube-native-effects-card-editor",
      );
      nativeEditor.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        effect_view: "grid",
      });
      nativeEditor.hass = window.hass;
      document.body.append(nativeEditor);
      await nativeEditor.updateComplete;
      results.nativeNoExperimental =
        !nativeEditor.shadowRoot.textContent.includes("Experimental Effects");
      nativeEditor.remove();

      return results;
    });
    assert.deepEqual(originalGallery, {
      clockGallery: true,
      clockBadges: true,
      clockActive: true,
      clockListView: true,
      nativeGallery: true,
      editorShowBrowser: true,
      editorDisplay: true,
      editorAppearance: true,
      editorBadges: true,
      editorHighlight: true,
      editorPerPage: true,
      editorNoExperimental: true,
      nativeNoExperimental: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS shared Original gallery (clock + native) with badges, active state and aligned editor settings",
    );
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.close());
