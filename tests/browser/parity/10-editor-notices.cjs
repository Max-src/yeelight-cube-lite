// Card UI parity check (tests/card-ui-parity.cjs): experimental editor
// notices, live updates, hidden selections.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

module.exports = async (t) => {
  const { page, errors } = t;
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
    assert.doesNotMatch(
      await notices.nth(1).innerText(),
      /Experimental Effects filter/,
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
      // Rows are rename fields: the built-in label is their placeholder.
      const unavailable = [
        ...editor.shadowRoot.querySelectorAll(".orderable-list-rename"),
      ].some((field) => field.placeholder === "Twinkle (currently unavailable)");
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
};
