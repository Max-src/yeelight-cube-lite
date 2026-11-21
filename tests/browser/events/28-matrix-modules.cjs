// Card events check (tests/card-events-browser.cjs): a Cube Matrix's
// modules, set from the Lamp Preview card's Modules section
// (matrix-modules-editor.js). Its Modules button (a Cube Matrix only; an
// action of the card's list) opens the section just below the Actions row: the chain from the base, adding and removing make a draft,
// Save sends set_matrix_modules; the power supply's side is the card's
// Device Orientation row (sent at once), shown in the section when the card
// hides it. A refused save is shown. The older Cube Matrix Modules card
// draws the same section with its own arrows, saved with the modules, and is
// no longer in the card picker.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const matrix = (orientation = "right") => ({
      state: "on",
      attributes: {
        friendly_name: "Cube Matrix",
        device_orientation: orientation,
        content_mode: "Custom Draw",
        matrix_module_list: ["matrix", "matrix", "spot", "matrix"],
        matrix_modules: [],
        matrix_columns: 20,
        matrix_colors: new Array(100).fill([0, 0, 0]),
      },
    });
    hass.states["light.m"] = matrix();
    const settle = async () => {
      await card.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 30));
      await card.updateComplete;
    };
    const root = () => card.shadowRoot;
    const modulesButton = () =>
      root()
        .querySelector('yeelight-mode-controls[area="actions"]')
        ?.shadowRoot?.querySelector('[data-mode="modules"]');
    const section = () => root().querySelector(".ycm-editor");
    const chain = () => [...section().querySelectorAll(".ycm-chain .ycm-module")].map((node) => node.dataset.type);
    const out = {};

    // A Cube Lite: no Modules button.
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.a" });
    out.liteButton = !!modulesButton();

    await mount("yeelight-cube-lamp-preview-card", { entity: "light.m" });
    out.closed = !section();
    out.pressedBefore = modulesButton()?.getAttribute("aria-pressed");
    modulesButton().click();
    await settle();
    out.pressedAfter = modulesButton()?.getAttribute("aria-pressed");
    // Just below its button: the Actions row, then the section.
    out.afterActions =
      root().querySelector('yeelight-mode-controls[area="actions"]').nextElementSibling === section();
    out.initial = chain();
    out.from = section().querySelector(".ycm-chain").className;
    out.status = section().querySelector(".ycm-status").textContent.trim();
    out.saveDisabled = section().querySelector('[data-mode="save"]').disabled;
    out.ownArrows = !!section().querySelector(".orientation-controls");
    section().querySelector('[data-mode="add-panel"]').click();
    await settle();
    section().querySelector('[aria-label="Remove module 3"]').click();
    await settle();
    out.edited = chain();
    out.statusEdited = section().querySelector(".ycm-status").textContent.trim();
    // The lamp turned elsewhere: the chain follows, the draft stays.
    hass.states["light.m"] = matrix("up");
    card.hass = { ...hass };
    await settle();
    out.turned = section().querySelector(".ycm-chain").className;
    out.keptDraft = chain();
    section().querySelector('[data-mode="save"]').click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    out.calls = calls.map(({ service, data }) => ({ service, data }));
    // The lamp reports the saved list: the draft goes.
    hass.states["light.m"] = {
      ...matrix("up"),
      attributes: { ...matrix("up").attributes, matrix_module_list: ["matrix", "matrix", "matrix", "panel"] },
    };
    card.hass = { ...hass };
    await settle();
    out.statusSaved = section().querySelector(".ycm-status").textContent.trim();

    // A refused save is shown in the section.
    const callService = hass.callService;
    hass.callService = async () => {
      throw { code: "home_assistant_error", message: "refused" };
    };
    card.hass = { ...hass };
    section().querySelector('[data-mode="add-spot"]').click();
    await settle();
    section().querySelector('[data-mode="save"]').click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle();
    out.error = section().querySelector(".ycm-error")?.textContent.trim();
    hass.callService = callService;

    // The card's Device Orientation row hidden: the section shows it.
    hass.states["light.m"] = matrix();
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.m", show_device_orientation: false });
    out.cardArrowsHidden = !root().querySelector(".orientation-controls");
    modulesButton().click();
    await settle();
    out.sectionArrows = !!section().querySelector(".orientation-controls");
    section().querySelector('.orientation-controls button[data-value="up"]').click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    out.orientationCall = calls.map(({ service, data }) => ({ service, data }));
    // An action like the others: left out of the list, no button; first
    // in it, the first button.
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.m", action_buttons: ["refresh", "power"] });
    out.optionOff = !modulesButton();
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.m", action_buttons: ["modules", "refresh"] });
    out.order = [
      ...root().querySelector('yeelight-mode-controls[area="actions"]').shadowRoot.querySelectorAll("[data-mode]"),
    ].map((node) => node.dataset.mode);

    // The older card: the same section, its own arrows in the draft.
    hass.states["light.m"] = matrix();
    await mount("yeelight-cube-matrix-modules-card", { target_entities: ["light.m", "light.a"] });
    const lamp = () => root().querySelector('.ycm-editor[data-entity="light.m"]');
    const oldChain = () => [...lamp().querySelectorAll(".ycm-chain .ycm-module")].map((node) => node.dataset.type);
    out.oldInitial = oldChain();
    out.oldLite = root().querySelectorAll(".ycm-lamp")[1]?.textContent.includes("not a Cube Matrix");
    lamp().querySelector('[data-mode="add-panel"]').click();
    await settle();
    lamp().querySelector('[aria-label="Remove module 3"]').click();
    await settle();
    lamp().querySelector('.orientation-controls button[data-value="up"]').click();
    await settle();
    out.oldVertical = lamp().querySelector(".ycm-chain").className;
    out.oldNoCallYet = calls.length;
    lamp().querySelector('[data-mode="save"]').click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    out.oldCalls = calls.map(({ service, data }) => ({ service, data }));
    out.picker = (window.customCards || []).map((entry) => entry.type);
    delete hass.states["light.m"];
    return out;
  });
  assert.equal(result.liteButton, false, "a Cube Lite has no Modules button");
  assert.ok(result.closed, "the section starts closed");
  assert.equal(result.pressedBefore, "false");
  assert.equal(result.pressedAfter, "true", "the Modules button shows the section open");
  assert.deepEqual(result.initial, ["matrix", "matrix", "spot", "matrix"], "the lamp's modules, from the base");
  assert.match(result.from, /ycm-from-left ycm-row/, "mounted right: the base on the left");
  assert.equal(result.status, "Saved · 4/8");
  assert.equal(result.saveDisabled, true, "nothing to save before an edit");
  assert.equal(result.ownArrows, false, "the card's own Device Orientation row is the power supply's side");
  assert.deepEqual(result.edited, ["matrix", "matrix", "matrix", "panel"], "added at the end, the third removed");
  assert.equal(result.statusEdited, "Edited · 4/8");
  assert.match(result.turned, /ycm-from-down ycm-column/, "the lamp stood up: the chain stands");
  assert.deepEqual(result.keptDraft, ["matrix", "matrix", "matrix", "panel"], "the draft kept");
  assert.deepEqual(result.calls, [
    { service: "set_matrix_modules", data: { entity_id: "light.m", modules: ["matrix", "matrix", "matrix", "panel"] } },
  ], "the modules only: the orientation is the lamp's");
  assert.equal(result.statusSaved, "Saved · 4/8", "the lamp's list once it reports it");
  assert.match(result.error || "", /not saved/, "a refused save is shown");
  assert.ok(result.cardArrowsHidden);
  assert.ok(result.sectionArrows, "the hidden orientation row shows in the section");
  assert.deepEqual(result.orientationCall, [
    { service: "set_device_orientation", data: { entity_id: "light.m", orientation: "up" } },
  ], "sent at once, as the card's row does");
  assert.ok(result.optionOff, "left out of the action list: no Modules button");
  assert.equal(result.order[0], "modules", "the action list's order");
  assert.ok(result.afterActions, "the section opens just below the Actions row");
  assert.deepEqual(result.oldInitial, ["matrix", "matrix", "spot", "matrix"]);
  assert.ok(result.oldLite, "a Cube Lite is named as having no modules");
  assert.match(result.oldVertical, /ycm-from-down ycm-column/, "the supply below: the chain stands");
  assert.equal(result.oldNoCallYet, 0, "the older card's arrows are part of the draft");
  assert.deepEqual(result.oldCalls, [
    { service: "set_matrix_modules", data: { entity_id: "light.m", modules: ["matrix", "matrix", "matrix", "panel"] } },
    { service: "set_device_orientation", data: { entity_id: "light.m", orientation: "up" } },
  ]);
  assert.ok(!result.picker.includes("yeelight-cube-matrix-modules-card"), "the older card is not in the picker");
  assert.ok(result.picker.includes("yeelight-cube-lamp-preview-card"));
  console.log("PASS the Lamp Preview's Modules section edits a draft and saves the modules; the older card still works");
};
