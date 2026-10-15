// Card events check (tests/card-events-browser.cjs): the Color List editor's
// colors just set (pending-value.js): shown at once by every Color List card
// on the lamp, kept through the echo of an earlier save (a picker drag), and
// dropped once the lamp reports them or after the grace period, which
// renders the lamp's colors again without waiting for a lamp update.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const tag = "yeelight-cube-color-list-editor-card";
    const saved = hass;
    const light = saved.states["light.a"];
    const lampWith = (colors) => ({
      ...saved,
      states: {
        ...saved.states,
        "light.a": { ...light, attributes: { ...light.attributes, text_colors: colors } },
      },
    });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      hass = lampWith([[255, 0, 0]]);
      await mount(tag, { entity: "light.a", list_layout: "rows" });
      // A second Color List card on the same lamp.
      const other = document.createElement(tag);
      other.setConfig({ entity: "light.a", list_layout: "rows" });
      other.hass = hass;
      document.querySelector("main").append(other);
      await other.updateComplete;
      const shown = (node) => JSON.stringify(node._renderedColors);

      await card.saveColors([[0, 0, 255]]);
      await card.updateComplete;
      other.requestUpdate();
      await other.updateComplete;
      const atOnce = [shown(card), shown(other)];

      card.hass = lampWith([[0, 255, 0]]); // an earlier save's echo
      await card.updateComplete;
      const throughEcho = shown(card);

      card.hass = lampWith([[0, 0, 255]]); // confirmed
      await card.updateComplete;
      const confirmed = shown(card);

      await card.saveColors([[9, 9, 9]]); // never confirmed
      await card.updateComplete;
      const unconfirmed = shown(card);
      await wait(2300); // the grace period, no lamp update meanwhile
      await card.updateComplete;
      const expired = shown(card);
      other.remove();
      return { atOnce, throughEcho, confirmed, unconfirmed, expired };
    } finally {
      hass = saved;
    }
  });
  const blue = JSON.stringify([[0, 0, 255]]);
  assert.deepEqual(
    result,
    {
      atOnce: [blue, blue],
      throughEcho: blue,
      confirmed: blue,
      unconfirmed: JSON.stringify([[9, 9, 9]]),
      expired: blue,
    },
    "color list: colors just set show at once on every card of the lamp, survive older echoes, expire",
  );
};
