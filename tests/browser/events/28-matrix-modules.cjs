// Card events check (tests/card-events-browser.cjs): the Cube Matrix Modules
// card shows a Cube Matrix's modules from its power supply and the side the
// supply is on; adding, removing and moving the supply make a draft, and Save
// sends set_matrix_modules then set_device_orientation. A Cube Lite is named
// as having no modules.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    hass.states["light.m"] = {
      state: "on",
      attributes: {
        friendly_name: "Cube Matrix",
        device_orientation: "right",
        matrix_module_list: ["matrix", "matrix", "spot", "matrix"],
        matrix_modules: [],
      },
    };
    await mount("yeelight-cube-matrix-modules-card", { target_entities: ["light.m", "light.a"] });
    const root = () => card.shadowRoot;
    const lamp = () => root().querySelector('.ycm-lamp[data-entity="light.m"]');
    const chain = () => [...lamp().querySelectorAll(".ycm-chain .ycm-module")].map((node) => node.dataset.type);
    const settle = async () => {
      await card.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const out = {
      initial: chain(),
      supply: lamp().querySelector('[role="radio"][aria-checked="true"]')?.textContent.trim(),
      from: lamp().querySelector(".ycm-chain").className,
      saveBefore: !!lamp().querySelector('[data-mode="save"]'),
      lite: root().querySelectorAll(".ycm-lamp")[1]?.textContent.includes("not a Cube Matrix"),
    };
    lamp().querySelector('[data-mode="add-panel"]').click();
    await settle();
    out.added = chain();
    lamp().querySelector('[aria-label="Remove module 3"]').click();
    await settle();
    out.removed = chain();
    lamp().querySelector('[role="radio"][data-value="down"]').click();
    await settle();
    out.vertical = lamp().querySelector(".ycm-chain").className;
    out.count = lamp().querySelector(".ycm-count").textContent.trim();
    lamp().querySelector('[data-mode="save"]').click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    out.calls = calls.map(({ service, data }) => ({ service, data }));
    delete hass.states["light.m"];
    return out;
  });
  assert.deepEqual(result.initial, ["matrix", "matrix", "spot", "matrix"], "the lamp's modules, from the base");
  assert.equal(result.supply, "Left", "mounted right: the power supply on the left");
  assert.match(result.from, /ycm-from-left ycm-row/);
  assert.equal(result.saveBefore, false, "nothing to save before an edit");
  assert.ok(result.lite, "a Cube Lite is named as having no modules");
  assert.deepEqual(result.added, ["matrix", "matrix", "spot", "matrix", "panel"], "added at the end");
  assert.deepEqual(result.removed, ["matrix", "matrix", "matrix", "panel"], "the third removed");
  assert.match(result.vertical, /ycm-from-down ycm-column/, "the supply below: the chain stands");
  assert.equal(result.count, "Added (4)");
  assert.deepEqual(result.calls, [
    { service: "set_matrix_modules", data: { entity_id: "light.m", modules: ["matrix", "matrix", "matrix", "panel"] } },
    { service: "set_device_orientation", data: { entity_id: "light.m", orientation: "up" } },
  ]);
  console.log("PASS the Cube Matrix Modules card edits a draft and saves the modules, then the supply side");
};
