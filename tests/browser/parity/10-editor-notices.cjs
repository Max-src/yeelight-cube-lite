// Card UI parity check (tests/card-ui-parity.cjs): no Experimental Features
// notice in the editors (every effect and clock style is offered), and an
// effect a lamp does not offer now stays in the saved list.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, errors } = t;
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(async () => {
      const main = document.querySelector("main");
      main.replaceChildren();
      main.style.display = "block";
      window.editors = [];
      for (const tag of [
        "yeelight-cube-clock-card-editor",
        "yeelight-cube-native-effects-card-editor",
      ]) {
        const editor = document.createElement(tag);
        editor.style.cssText =
          "display:block;max-width:650px;margin:0 auto 16px;";
        // Snowfall is uploaded over Matter: this lamp does not offer it.
        editor.setConfig({
          target_entities: ["light.a"],
          visible_effects: ["Snowfall", "Rainbow"],
        });
        editor.hass = window.hass;
        main.append(editor);
        await editor.updateComplete;
        window.editors.push(editor);
      }
    });
    const result = await page.evaluate(async () => {
      const texts = window.editors.map((editor) => editor.shadowRoot.textContent);
      const editor = window.editors[1];
      editor._open = { effects: true };
      editor.requestUpdate();
      await editor.updateComplete;
      // The list opens with Customize (folded to one line).
      editor.shadowRoot.querySelector(".yc-item-list-summary button")?.click();
      await editor.updateComplete;
      // Rows are rename fields: the built-in label is their placeholder.
      const placeholders = [
        ...editor.shadowRoot.querySelectorAll(".orderable-list-rename"),
      ].map((field) => field.placeholder);
      return {
        notices: window.editors.map(
          (item) => item.shadowRoot.querySelectorAll(".experimental-availability").length,
        ),
        mentions: texts.some((text) => text.includes("Experimental Features")),
        placeholders,
        config: editor._config.visible_effects,
      };
    });
    assert.deepEqual(result.notices, [0, 0]);
    assert.equal(result.mentions, false);
    assert.ok(result.placeholders.includes("Snowfall (currently unavailable)"), result.placeholders.join());
    assert.ok(result.placeholders.includes("Rainbow"), result.placeholders.join());
    assert.deepEqual(result.config, ["Snowfall", "Rainbow"]);
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS editors show no Experimental Features notice; an effect a lamp does not offer stays in the saved list",
  );
};
