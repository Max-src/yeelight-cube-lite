// Card events check (tests/card-events-browser.cjs): the Clock card offers the
// Lamp mounted buttons only where they change the lamp's clock (a server that
// delivers the Yeelight commands writes the lamp's mount profile, which turns
// the digits), they send set_device_orientation like the Native Effects
// card's, and show_device_orientation: false hides them. One lamp of several
// reached is enough.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const original = hass.states["light.a"];
    const withMatter = (matter) => {
      hass.states["light.a"] = {
        ...original,
        attributes: { ...original.attributes, content_mode: "Clock", matter },
      };
    };
    const row = () =>
      [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")]
        .map((controls) => controls.shadowRoot?.querySelector(".device-orientation-row"))
        .find(Boolean);
    const out = {};
    withMatter(null);
    await mount("yeelight-cube-clock-card", { entity: "light.a" });
    out.without = !!row();
    withMatter({ node_id: 6, commands: "matter" });
    await mount("yeelight-cube-clock-card", { entity: "light.a" });
    out.with = !!row();
    row()?.querySelector(".orient-btn[aria-label]:not(.active)")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    out.sent = calls.find((call) => call.service === "set_device_orientation")?.data?.orientation ?? null;
    await mount("yeelight-cube-clock-card", { entity: "light.a", show_device_orientation: false });
    out.hidden = !row();
    // Two lamps, the first with no server for the Yeelight commands: the
    // second's clock follows, so the buttons show.
    hass.states["light.b"] = {
      ...hass.states["light.a"],
      entity_id: "light.b",
      attributes: { ...hass.states["light.a"].attributes, matter: { node_id: 7, commands: null } },
    };
    await mount("yeelight-cube-clock-card", { entity: "light.b", target_entities: ["light.b", "light.a"] });
    out.mixed = !!row();
    delete hass.states["light.b"];
    hass.states["light.a"] = original;
    return out;
  });
  assert.equal(result.without, false, "no server: no Lamp mounted buttons on the Clock card");
  assert.equal(result.with, true, "a server: the Clock card shows the Lamp mounted buttons");
  assert.ok(result.sent, "a button sends set_device_orientation");
  assert.equal(result.hidden, true, "show_device_orientation: false hides them");
  assert.equal(result.mixed, true, "two lamps, one reached: the buttons show");
  console.log("PASS the Clock card offers Lamp mounted only when it reaches the lamp's clock, and sends it");
};
