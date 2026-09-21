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
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.close());
