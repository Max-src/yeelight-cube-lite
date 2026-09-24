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
      file.endsWith(".js") ? "text/javascript" : "text/plain",
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
      window.freshClock = card;
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
            freshClock._shellNodes.wrapper ===
            freshClock.shadowRoot.querySelector("ha-card"),
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
      if (clock.shadowRoot.querySelector("ha-card"))
        throw Error("no-bg shell still has ha-card");
      clock.setConfig({ ...baseConfig, show_card_background: true });
      clock.hass = hass;
      if (!clock.shadowRoot.querySelector("ha-card.clock-card"))
        throw Error("ha-card shell not restored");
    });
    for (const width of [390, 1400]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => {
        native.style.display = "none";
        clock.style.width = "100%";
        clock.setConfig({
          ...baseConfig,
          show_gallery: true,
          show_search: true,
        });
        clock.hass = hass;
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
                    ["Apply", "Refresh", "Pause previews", "Turn off"].includes(
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
        assert.ok(controls[0].length >= 3);
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
          { show_actions: true, action_buttons: ["power", "freeze", "apply"] },
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
      assert.deepEqual(custom, ["Turn off", "Freeze effect", "Apply"]);
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
      assert.match(
        await notices.nth(1).innerText(),
        /Experimental Effects filter is Off/,
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
        style_selector_style: "preview-grid",
      });
      clock.hass = window.hass;
      document.body.append(clock);
      const clockKey = clock._controls.adapter.items()[0].key;
      clock._controls.save([clockKey]);
      clock.render();
      results.clockStar = !!clock.shadowRoot.querySelector(
        `[data-mode="${CSS.escape(clockKey)}"][data-favourite="true"]`,
      );
      clock._controls.save([]);
      clock.render();
      results.clockUnstar = !clock.shadowRoot.querySelector(
        '[data-favourite="true"]',
      );
      clock.remove();

      const native = document.createElement(
        "yeelight-cube-native-effects-card",
      );
      native.setConfig({ ...window.baseConfig, show_gallery: true });
      native.hass = window.hass;
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
      const clockWith = (style) => {
        const clock = document.createElement("yeelight-cube-clock-card");
        clock.setConfig({ ...window.baseConfig, style_selector_style: style });
        clock.hass = window.hass;
        document.body.append(clock);
        const key = clock._controls.adapter.items()[0].key;
        clock._controls.save([key]);
        clock.render();
        return { clock, key };
      };
      const inlineStar = (node) =>
        node && getComputedStyle(node, "::before").content.includes("★");
      // Text (filled) selector shows the star inline in the button.
      {
        const { clock, key } = clockWith("filled");
        const item = clock.shadowRoot.querySelector(
          `[data-mode="${CSS.escape(key)}"][data-favourite="true"]`,
        );
        results.textStar = !!item;
        results.textBadge = inlineStar(item);
        clock.remove();
      }
      // Wheel selector shows the star inline in the item title.
      {
        const { clock, key } = clockWith("preview-wheel");
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
        });
        native.hass = window.hass;
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
          favourites_show_stars: false,
        });
        clock.hass = window.hass;
        document.body.append(clock);
        const key = clock._controls.adapter.items()[0].key;
        clock._controls.save([key]);
        clock.render();
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
