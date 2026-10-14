// Card UI parity check (tests/card-ui-parity.cjs): the selector styles per
// family and the shared Original gallery.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, errors } = t;
  const modeCleanup = await page.evaluate(async () => {
    const results = {};
    // Clock editor: Text Style offers Filled, Dropdown and Chips (with a
    // micro-matrix swatch of each style).
    const clockEditor = document.createElement(
      "yeelight-cube-clock-card-editor",
    );
    clockEditor.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      style_selector_style: "filled",
    });
    clockEditor.hass = window.hass;
    document.body.append(clockEditor);
    await clockEditor.updateComplete;
    results.clockChips = !!clockEditor.shadowRoot.querySelector(
      '[data-value="chips"]',
    );
    results.clockHasOriginal = !!clockEditor.shadowRoot.querySelector(
      '[data-value="original"]',
    );
    clockEditor.remove();

    // Native editor: Original Display only offers Grid + List.
    const nativeEditor = document.createElement(
      "yeelight-cube-native-effects-card-editor",
    );
    nativeEditor.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      effect_view: "grid",
    });
    nativeEditor.hass = window.hass;
    document.body.append(nativeEditor);
    await nativeEditor.updateComplete;
    const displayGroup = nativeEditor.shadowRoot
      .querySelector('[data-value="grid"]')
      ?.closest(".button-group");
    results.nativeDisplay =
      !!displayGroup &&
      !displayGroup.querySelector('[data-value="buttons"]') &&
      !displayGroup.querySelector('[data-value="dropdown"]');
    nativeEditor.remove();
    return results;
  });
  assert.deepEqual(modeCleanup, {
    clockChips: true,
    clockHasOriginal: true,
    nativeDisplay: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS mode cleanup: Text = Filled/Dropdown/Chips, Original = Grid/List (shared, no Buttons/Dropdown)",
  );

  const originalGallery = await page.evaluate(async () => {
    const results = {};

    // Clock card renders the shared Original gallery with badges + active
    // state (grid by default, list via effect_view).
    const clock = document.createElement("yeelight-cube-clock-card");
    clock.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      style_selector_style: "original",
    });
    clock.hass = window.hass;
    document.body.append(clock);
    clock.requestUpdate();
    await clock.updateComplete;
    const gallery = clock.shadowRoot.querySelector(".original-gallery");
    const items = [...clock.shadowRoot.querySelectorAll(".original-item")];
    results.clockGallery =
      !!gallery && gallery.classList.contains("grid") && items.length > 0;
    results.clockBadges = items.every(
      (item) =>
        item.querySelector(".original-item-name") &&
        item.querySelector(".original-item-badge"),
    );
    results.clockActive =
      items.filter((item) => item.getAttribute("aria-pressed") === "true")
        .length === 1;
    clock.remove();

    const clockList = document.createElement("yeelight-cube-clock-card");
    clockList.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      style_selector_style: "original",
      effect_view: "list",
    });
    clockList.hass = window.hass;
    document.body.append(clockList);
    clockList.requestUpdate();
    await clockList.updateComplete;
    results.clockListView = !!clockList.shadowRoot.querySelector(
      ".original-gallery.list",
    );
    clockList.remove();

    // Native card uses the same shared classes.
    const native = document.createElement(
      "yeelight-cube-native-effects-card",
    );
    native.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      effect_view: "grid",
      style_selector_style: "original",
    });
    native.hass = window.hass;
    document.body.append(native);
    await native.updateComplete;
    results.nativeGallery = !!native.shadowRoot.querySelector(
      ".original-gallery .original-item .original-item-badge",
    );
    native.remove();

    // Clock editor: Show Effect Browser + Original sub-settings, no
    // Experimental Effects toggle.
    const editor = document.createElement("yeelight-cube-clock-card-editor");
    editor.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      style_selector_style: "original",
    });
    editor.hass = window.hass;
    document.body.append(editor);
    await editor.updateComplete;
    const text = editor.shadowRoot.textContent;
    results.editorShowBrowser = text.includes("Show Effect Browser");
    results.editorDisplay =
      !!editor.shadowRoot.querySelector('[data-value="grid"]') &&
      !!editor.shadowRoot.querySelector('[data-value="list"]');
    results.editorAppearance = text.includes("Gallery Appearance");
    results.editorBadges = text.includes("Capability Labels");
    results.editorHighlight = text.includes("Highlight Active Style");
    results.editorPerPage = text.includes("Items Per Page");
    results.editorNoExperimental = !text.includes("Experimental Effects");
    editor.remove();

    // Native editor: same structure, no Experimental Effects toggle.
    const nativeEditor = document.createElement(
      "yeelight-cube-native-effects-card-editor",
    );
    nativeEditor.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      effect_view: "grid",
    });
    nativeEditor.hass = window.hass;
    document.body.append(nativeEditor);
    await nativeEditor.updateComplete;
    results.nativeNoExperimental =
      !nativeEditor.shadowRoot.textContent.includes("Experimental Effects");
    nativeEditor.remove();

    return results;
  });
  assert.deepEqual(originalGallery, {
    clockGallery: true,
    clockBadges: true,
    clockActive: true,
    clockListView: true,
    nativeGallery: true,
    editorShowBrowser: true,
    editorDisplay: true,
    editorAppearance: true,
    editorBadges: true,
    editorHighlight: true,
    editorPerPage: true,
    editorNoExperimental: true,
    nativeNoExperimental: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS shared Original gallery (clock + native) with badges, active state and aligned editor settings",
  );
};
