// Card events check (tests/card-events-browser.cjs): the Native Effects card
// of a lamp that sends only native_effect_catalog_key paints while its
// catalogue is still on its way over the websocket (no page error: 99-summary),
// then lists the effects once it arrives.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const original = hass.states["light.a"];
    const originalWS = hass.callWS;
    let answer;
    const asked = [];
    hass.callWS = (message) => {
      asked.push(message.type);
      return new Promise((resolve) => (answer = resolve));
    };
    const { native_effect_catalog: _catalog, ...attributes } = original.attributes;
    hass.states["light.a"] = {
      ...original,
      attributes: {
        ...attributes,
        content_mode: "Native Effect",
        native_effect: "Fire",
        native_effect_catalog_key: "late000000ab",
      },
    };
    const out = {};
    try {
      await mount("yeelight-cube-native-effects-card", {
        entity: "light.a",
        show_gallery: true,
        style_selector_style: "original",
      });
      // Several animation frames before the answer.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const tiles = () =>
        [...card.shadowRoot.querySelectorAll("yc-collection-gallery [data-mode]")].map(
          (node) => node.dataset.mode,
        );
      out.asked = asked;
      out.before = tiles();
      answer({
        key: "late000000ab",
        catalog: [
          { name: "Fire", family: "glow", speed: true, directions: [], preview: true },
          { name: "Starry Sky", family: "sparkles", speed: true, directions: [], preview: true },
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await card.updateComplete;
      out.after = tiles();
    } finally {
      hass.callWS = originalWS;
      hass.states["light.a"] = original;
    }
    return out;
  });
  assert.deepEqual(result.asked, ["yeelight_cube/native_effect_catalog"], "asked once over the websocket");
  assert.deepEqual(result.before, [], "nothing listed while the catalogue is on its way");
  assert.deepEqual(result.after, ["Fire", "Starry Sky"], "the effects once it arrives");
  console.log("PASS Native Effects card paints while its catalogue is on its way over the websocket, lists it once it arrives");
};
