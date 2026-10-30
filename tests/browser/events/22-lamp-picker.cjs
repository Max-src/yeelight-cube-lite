// Card events check (tests/card-events-browser.cjs): the editors' lamp picker
// (entity-selector-utils.js). A click anywhere on a row toggles its lamp
// once, the box itself included (its click reached the row too: toggled
// twice, nothing changed).
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const { LitElement } = await import("/custom_components/yeelight_cube/www/lib/lit-all.js");
    const { createYeelightCubeEntityPicker } = await import(
      "/custom_components/yeelight_cube/www/entity-selector-utils.js"
    );
    const hass = {
      states: {
        "light.cubelite_top": { state: "on", attributes: { friendly_name: "Top" } },
        "light.cubelite_bottom": { state: "on", attributes: { friendly_name: "Bottom" } },
      },
    };
    // An editor's use of it: the value it reports is set back.
    customElements.define(
      "yc-lamp-picker-check",
      class extends LitElement {
        static properties = { selected: { attribute: false } };
        constructor() {
          super();
          this.mode = "multiple";
          this.selected = ["light.cubelite_bottom"];
          this.picks = [];
        }
        render() {
          return createYeelightCubeEntityPicker(hass, this.selected, (event) => {
            this.picks.push(event.target.value);
            this.selected = this.mode === "single" ? [event.target.value] : event.target.value;
          }, this.mode);
        }
      },
    );
    const picker = document.createElement("yc-lamp-picker-check");
    document.querySelector("main").replaceChildren(picker);
    await picker.updateComplete;
    const row = (name) =>
      [...picker.shadowRoot.querySelectorAll(".yc-lamp-row")].find((item) =>
        item.textContent.includes(name),
      );
    const click = async (element) => {
      element.click();
      await picker.updateComplete;
    };

    await click(row("Top").querySelector("input")); // inside the box
    const afterBox = [...picker.picks];
    const boxChecked = row("Top").querySelector("input").checked;
    await click(row("Top").querySelector(".yc-lamp-name")); // its name
    const afterName = [...picker.picks];

    picker.mode = "single";
    picker.picks = [];
    picker.selected = ["light.cubelite_bottom"];
    await picker.updateComplete;
    await click(row("Top").querySelector("input"));
    return {
      afterBox, boxChecked, afterName, single: picker.picks,
      singleChecked: row("Top").querySelector("input").checked,
    };
  });
  assert.deepEqual(result.afterBox, [["light.cubelite_bottom", "light.cubelite_top"]]);
  assert.equal(result.boxChecked, true);
  assert.deepEqual(result.afterName, [
    ["light.cubelite_bottom", "light.cubelite_top"],
    ["light.cubelite_bottom"],
  ]);
  assert.deepEqual(result.single, ["light.cubelite_top"]);
  assert.equal(result.singleChecked, true);
  console.log("PASS the editors' lamp picker: a click on the box, or on the row, toggles a lamp once (checkboxes and radios)");
};
