// Card UI parity check (tests/card-ui-parity.cjs): favourites previews and
// stars, rotation summary and observation.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, errors } = t;

  // Favourites previews: repeated Lit re-renders (as triggered by every
  // controller.notify() on Home Assistant state updates) must regenerate
  // the preview markup at the animation loop's current time — never phase 0,
  // which visibly flashed the animation's first frame.
  const previewPhases = await page.evaluate(async () => {
    const view = document.createElement("yeelight-mode-controls");
    view.area = "collections";
    const phases = [];
    view.model = {
      config: { show_favourites: true },
      favourites: [{ key: "Rainbow", colorMode: "normal" }],
      names: () => ["Rainbow"],
      hasFavourite: (key) => key === "Rainbow",
      currentFavourite: () => ({ key: "Rainbow", colorMode: "normal" }),
      captureFavourite: (key) => ({ key, colorMode: "normal" }),
      paused: false,
      busy: false,
      error: "",
      listeners: new Set(),
      adapter: {
        kind: "clock",
        items: () => [{ key: "Rainbow", title: "Rainbow" }],
        current: () => "Rainbow",
        available: () => true,
        disabled: () => false,
        frame: (key, phase) => {
          phases.push(phase);
          return new Array(100).fill([0, 0, 0]);
        },
      },
    };
    document.body.append(view);
    await view.updateComplete;
    view.requestUpdate();
    await view.updateComplete;
    view.requestUpdate();
    await view.updateComplete;
    view.remove();
    return phases;
  });
  assert.ok(
    previewPhases.length >= 3,
    "favourites previews render on every re-render",
  );
  assert.ok(
    previewPhases.every((phase) => phase > 1),
    `favourites previews never regenerate a phase-0 frame: ${previewPhases}`,
  );
  assert.deepEqual(errors, []);
  console.log("PASS favourites previews re-render at current animation time");

  // Favourites/rotation UX: star badges on grid items, no section
  // separators, and the value+unit rotation interval editor control.
  const ux = await page.evaluate(async () => {
    const results = {};
    const normalHass = {
      ...window.hass,
      states: {
        ...window.hass.states,
        "light.a": {
          ...window.hass.states["light.a"],
          attributes: {
            ...window.hass.states["light.a"].attributes,
            clock_color_mode: "normal",
            clock_color: null,
            native_effect_color_mode: "normal",
            native_effect_color: null,
          },
        },
      },
    };
    // No separator between Favourites and Rotation sections.
    const view = document.createElement("yeelight-mode-controls");
    view.area = "collections";
    view.model = {
      config: {
        show_favourites: true,
        show_rotation: true,
        rotation_interval: 3600,
      },
      favourites: [{ key: "Rainbow", colorMode: "normal" }],
      names: () => ["Rainbow"],
      hasFavourite: (key) => key === "Rainbow",
      currentFavourite: () => ({ key: "Rainbow", colorMode: "normal" }),
      captureFavourite: (key) => ({ key, colorMode: "normal" }),
      ready: () => true,
      active: false,
      frozen: false,
      freezable: () => true,
      paused: false,
      busy: false,
      error: "",
      listeners: new Set(),
      adapter: {
        kind: "clock",
        items: () => [{ key: "Rainbow", title: "Rainbow" }],
        current: () => "Rainbow",
        available: () => true,
        disabled: () => false,
        frame: () => new Array(100).fill([0, 0, 0]),
      },
    };
    document.body.append(view);
    await view.updateComplete;
    const section = view.shadowRoot.querySelector("section");
    results.noSeparator = getComputedStyle(section).borderTopWidth === "0px";
    results.rotationSummary = /1 clock mode · every\s+1h/.test(
      view.shadowRoot.textContent,
    );
    view.remove();

    // Star badge on grid items whose mode is in the favourites list.
    const clock = document.createElement("yeelight-cube-clock-card");
    clock.setConfig({
      ...window.baseConfig,
      show_gallery: true,
      style_selector_style: "preview-grid",
    });
    clock.hass = normalHass;
    document.body.append(clock);
    const clockKey = clock._controls.adapter.items()[0].key;
    clock._controls.save([clockKey]);
    clock.requestUpdate();
    await clock.updateComplete;
    results.clockStar = !!clock.shadowRoot.querySelector(
      `[data-mode="${CSS.escape(clockKey)}"][data-favourite="true"]`,
    );
    clock._controls.save([]);
    clock.requestUpdate();
    await clock.updateComplete;
    results.clockUnstar = !clock.shadowRoot.querySelector(
      '[data-favourite="true"]',
    );
    clock.remove();

    const native = document.createElement(
      "yeelight-cube-native-effects-card",
    );
    native.setConfig({ ...window.baseConfig, show_gallery: true });
    native.hass = normalHass;
    document.body.append(native);
    await native.updateComplete;
    native._controls.save(["Rainbow"]);
    await native.updateComplete;
    results.nativeStar = !!native.shadowRoot.querySelector(
      '[data-mode="Rainbow"][data-favourite="true"]',
    );
    native._controls.save([]);
    await native.updateComplete;
    results.nativeUnstar = !native.shadowRoot.querySelector(
      '[data-favourite="true"]',
    );
    native.remove();

    // Rotation interval editor: value + unit, no custom list / shuffle.
    const editor = document.createElement("yeelight-cube-clock-card-editor");
    editor.setConfig({
      ...window.baseConfig,
      show_rotation: true,
      rotation_interval: 7200,
    });
    editor.hass = window.hass;
    document.body.append(editor);
    await editor.updateComplete;
    const input = editor.shadowRoot.querySelector(
      'input[aria-label="Rotation interval value"]',
    );
    const unit = editor.shadowRoot.querySelector(
      'select[aria-label="Rotation interval unit"]',
    );
    const text = editor.shadowRoot.textContent;
    results.editorControl =
      text.includes("Rotate every") &&
      !text.includes("Custom List") &&
      !text.includes("No Immediate Repeats") &&
      input?.value === "2" &&
      unit?.value === "hours";
    unit.value = "days";
    unit.dispatchEvent(new Event("change"));
    results.editorSaves = editor.getConfig().rotation_interval === 172800;
    editor.remove();
    return results;
  });
  assert.deepEqual(ux, {
    noSeparator: true,
    rotationSummary: true,
    clockStar: true,
    clockUnstar: true,
    nativeStar: true,
    nativeUnstar: true,
    editorControl: true,
    editorSaves: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS favourite star badges, seamless sections, rotation summary and interval editor",
  );
  const stars = await page.evaluate(async () => {
    const results = {};
    const starHass = structuredClone({ states: window.hass.states });
    starHass.callService = window.hass.callService;
    Object.assign(starHass.states["light.a"].attributes, {
      clock_color_mode: "normal",
      clock_color: null,
      native_effect_color_mode: "normal",
      native_effect_color: null,
    });
    const clockWith = async (style) => {
      const clock = document.createElement("yeelight-cube-clock-card");
      clock.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        style_selector_style: style,
      });
      clock.hass = starHass;
      document.body.append(clock);
      const key = clock._controls.adapter.items()[0].key;
      clock._controls.save([key]);
      clock.requestUpdate();
      await clock.updateComplete;
      return { clock, key };
    };
    const inlineStar = (node) =>
      node && getComputedStyle(node, "::before").content.includes("★");
    // Text (filled) selector shows the star inline in the button.
    {
      const { clock, key } = await clockWith("filled");
      const item = clock.shadowRoot.querySelector(
        `[data-mode="${CSS.escape(key)}"][data-favourite="true"]`,
      );
      results.textStar = !!item;
      results.textBadge = inlineStar(item);
      clock.remove();
    }
    // Wheel selector shows the star inline in the item title.
    {
      const { clock, key } = await clockWith("preview-wheel");
      const item = clock.shadowRoot.querySelector(
        `[data-mode="${CSS.escape(key)}"][data-favourite="true"]`,
      );
      results.wheelStar =
        !!item &&
        inlineStar(
          item.querySelector(".wheel-item-title, .wheel-item-title-hover"),
        );
      clock.remove();
    }
    // Native "Original" effects browser shows the star in the item name.
    {
      const native = document.createElement(
        "yeelight-cube-native-effects-card",
      );
      native.setConfig({
        ...window.baseConfig,
        show_gallery: true,
        effect_view: "grid",
        style_selector_style: "original",
      });
      native.hass = starHass;
      document.body.append(native);
      await native.updateComplete;
      native._controls.save(["Rainbow"]);
      await native.updateComplete;
      const item = native.shadowRoot.querySelector(
        '.original-item[data-mode="Rainbow"][data-favourite="true"]',
      );
      results.originalStar =
        !!item && inlineStar(item.querySelector(".original-item-name"));
      native.remove();
    }
    // The editor toggle disables the badge (host gate).
    {
      const clock = document.createElement("yeelight-cube-clock-card");
      clock.setConfig({
        ...window.baseConfig,
        style_selector_style: "filled",
        show_gallery: true,
        favourites_show_stars: false,
      });
      clock.hass = starHass;
      document.body.append(clock);
      const key = clock._controls.adapter.items()[0].key;
      clock._controls.save([key]);
      clock.requestUpdate();
      await clock.updateComplete;
      const item = clock.shadowRoot.querySelector(
        `[data-mode="${CSS.escape(key)}"][data-favourite="true"]`,
      );
      results.hostAttr = clock.getAttribute("data-fav-stars") === "false";
      results.hidden = !inlineStar(item);
      clock.remove();
    }
    // The Favourites editor area exposes the toggle.
    {
      const editor = document.createElement(
        "yeelight-cube-clock-card-editor",
      );
      editor.setConfig({ ...window.baseConfig, show_favourites: true });
      editor.hass = window.hass;
      document.body.append(editor);
      await editor.updateComplete;
      results.editorToggle = editor.shadowRoot.textContent.includes(
        "Show favourite stars",
      );
      editor.remove();
    }
    return results;
  });
  assert.deepEqual(stars, {
    textStar: true,
    textBadge: true,
    wheelStar: true,
    originalStar: true,
    hostAttr: true,
    hidden: true,
    editorToggle: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS favourite stars across text/wheel/original selectors with editor toggle",
  );
  const rotation = await page.evaluate(async () => {
    calls.length = 0;
    for (const card of [clock, native]) {
      card.setConfig({ ...baseConfig, show_rotation: true });
      card._controls.favourites = [];
    }
    for (const kind of ["clock", "native"]) {
      const state = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            ...hass.states["light.a"],
            attributes: {
              ...hass.states["light.a"].attributes,
              effect_rotation: {
                active: true,
                kind,
                items: ["Rainbow", "White"],
              },
            },
          },
        },
      };
      for (const card of [clock, native]) {
        card.hass = state;
        if (card.updateComplete) await card.updateComplete;
        card._controls.update();
      }
      if (clock._controls.active !== (kind === "clock"))
        return "clock kind mismatch";
      if (native._controls.active !== (kind === "native"))
        return "native kind mismatch";
    }
    await native._queue;
    return calls.filter((call) => call.service === "stop_effect_rotation");
  });
  assert.deepEqual(
    rotation,
    [],
    "observing cards must not cancel server rotation",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS real Clock/Native cards observe backend rotation without unsolicited Stop calls",
  );
};
