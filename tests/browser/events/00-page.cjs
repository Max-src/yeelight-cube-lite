// Card events check (tests/card-events-browser.cjs): the page under a strict
// CSP, the mock Home Assistant and the call helpers.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { browser, server, errors } = t;
  const page = await browser.newPage({
    viewport: { width: 900, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  // CPU_THROTTLE=4 runs the page 4x slower, like a CI runner: timing bugs
  // that only show there reproduce locally.
  if (Number(process.env.CPU_THROTTLE) > 1)
    await (
      await page.context().newCDPSession(page)
    ).send("Emulation.setCPUThrottlingRate", {
      rate: Number(process.env.CPU_THROTTLE),
    });
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
    const { CARD_NAMES } = await import(`${base}card-list.js`);
    for (const name of CARD_NAMES)
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
            text_colors: [
              [255, 0, 0],
              [0, 0, 255],
            ],
          },
        },
        "sensor.pixel": {
          state: "1",
          attributes: {
            pixel_arts: [
              {
                name: "Heart",
                pixels: [{ position: 3, color: [255, 0, 0] }],
              },
              {
                name: "Star",
                pixels: [{ position: 7, color: [255, 255, 0] }],
              },
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
  Object.assign(t, { page, waitForCall, reset });
};
