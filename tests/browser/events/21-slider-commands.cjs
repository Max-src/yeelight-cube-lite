// Card events check (tests/card-events-browser.cjs): a lamp slider (every
// card's, LampSliders) sends only its latest value while one is being sent.
// A drag commits every few hundred ms and each call waits for the lamp: the
// values in between are not played on the lamp one by one.
const assert = require("node:assert/strict");

const SLIDERS = [
  ["yeelight-cube-lamp-preview-card", "brightness", "turn_on", "brightness"],
  ["yeelight-cube-clock-card", "brightness", "turn_on", "brightness"],
  ["yeelight-cube-clock-card", "speed", "set_clock_style", "speed"],
  ["yeelight-cube-native-effects-card", "brightness", "turn_on", "brightness"],
  ["yeelight-cube-native-effects-card", "speed", "set_native_effect", "speed"],
];

module.exports = async (t) => {
  const { page } = t;
  for (const [tag, ns, service, key] of SLIDERS) {
    const label = `${tag} ${ns}`;
    await page.evaluate(
      (tag) =>
        mount(tag, {
          entity: "light.a",
          target_entities: ["light.a"],
          show_brightness: true,
          show_animation_speed: true,
          slider_style: "slider",
          show_device_orientation: false,
        }),
      tag,
    );
    // The lamp answers only when told to: the first value stays in flight.
    await page.evaluate(() => {
      window.held = [];
      window.slowHass = hass;
      hass = {
        ...hass,
        callService: (domain, service, data) => {
          calls.push({ domain, service, data });
          return new Promise((resolve) => held.push(resolve));
        },
      };
      card.hass = hass;
    });
    const input = page
      .locator(`${tag} [data-sl-ns="${ns}"] input.brightness-slider`)
      .first();
    assert.equal(await input.count(), 1, `${label}: slider shown`);
    const values = () =>
      page.evaluate(
        ({ service, key }) =>
          calls.filter((c) => c.service === service).map((c) => c.data[key]),
        { service, key },
      );
    // Four commits, each after the slider's own debounce (500 ms), as in a
    // slow drag: the first is sent, the next ones wait for it.
    for (const value of ["20", "40", "60", "80"]) {
      await input.fill(value);
      await page.waitForTimeout(650);
    }
    assert.equal((await values()).length, 1, `${label}: one value in flight`);
    // Answer every call as it comes: the one in flight, then the latest.
    await page.evaluate(async (service) => {
      for (let i = 0; i < 20; i++) {
        held.splice(0).forEach((resolve) => resolve());
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      hass = slowHass;
      card.hass = hass;
    }, service);
    const sent = await values();
    assert.equal(sent.length, 2, `${label}: first and latest only, got ${sent}`);
    assert.ok(sent[1] > sent[0], `${label}: the latest value last, got ${sent}`);
  }
};
