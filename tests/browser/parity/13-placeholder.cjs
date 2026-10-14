// Card UI parity check (tests/card-ui-parity.cjs): a placeholder instead of a
// configuration error without an entity.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, errors } = t;
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
};
