// Card UI parity check (tests/card-ui-parity.cjs): the page, its Home
// Assistant stand-ins and the mock lamp.

module.exports = async (t) => {
  const { browser, server } = t;
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
      clock.requestUpdate();
      await clock.updateComplete;
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
  Object.assign(t, { page, errors });
};
