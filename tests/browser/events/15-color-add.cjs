// Card events check (tests/card-events-browser.cjs): "Add" in the shared
// color-mode row (color-mode-ui.js openAddPicker) on the Clock and Native
// Effects cards: the picker opens at the Add button, or at the dropdown put
// back on the mode shown, and the chosen color is applied.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const CARDS = [
    { tag: "yeelight-cube-clock-card", service: "set_clock_style" },
    { tag: "yeelight-cube-native-effects-card", service: "set_native_effect" },
  ];
  for (const { tag, service } of CARDS) {
    for (const selector of ["buttons", "dropdown"]) {
      const result = await page.evaluate(
        async ({ tag, service, selector }) => {
          const light = hass.states["light.a"];
          const saved = hass;
          // A lamp showing a color mode (the Native card lists them then).
          hass = {
            ...saved,
            states: {
              ...saved.states,
              "light.a": {
                ...light,
                attributes: {
                  ...light.attributes,
                  native_effect_color_mode: "normal",
                  // A lamp that takes a custom effect color publishes it.
                  native_effect_color: null,
                  clock_color_mode: "normal",
                },
              },
            },
          };
          try {
            await mount(tag, {
              entity: "light.a",
              target_entities: ["light.a"],
              show_color_modes: true,
              color_mode_selector: selector,
            });
            const row = card.shadowRoot.querySelector("yeelight-color-mode");
            if (!row) return { row: false };
            if (selector === "dropdown") {
              const select = row.querySelector(".colormode-select");
              select.value = "__pick__";
              select.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
              row.querySelector(".color-add button")?.click();
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
            const picker = document.querySelector('input[type="color"][aria-label="Choose color"]');
            const shownMode = row.querySelector(".colormode-select")?.value ?? null;
            if (!picker) return { row: true, picker: false, shownMode };
            calls.length = 0;
            picker.value = "#123456";
            picker.dispatchEvent(new Event("change"));
            await new Promise((resolve) => setTimeout(resolve, 100));
            const sent = calls.find((call) => call.service === service)?.data ?? null;
            picker.dispatchEvent(new Event("cancel"));
            return { row: true, picker: true, shownMode, color: sent?.color ?? null };
          } finally {
            hass = saved;
          }
        },
        { tag, service, selector },
      );
      const name = `${tag.replace("yeelight-cube-", "")} ${selector}`;
      assert.equal(result.row, true, `${name}: color modes shown`);
      assert.equal(result.picker, true, `${name}: Add opens the picker`);
      if (selector === "dropdown")
        assert.notEqual(result.shownMode, "__pick__", `${name}: the dropdown shows a mode again`);
      assert.deepEqual(result.color, [0x12, 0x34, 0x56], `${name}: the chosen color is sent`);
    }
  }
};
