// Card UI parity check (tests/card-ui-parity.cjs): rotation details on
// errors, retry and recovery (Clock / Native).
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, errors } = t;
  const rotationErrors = await page.evaluate(async () => {
    const results = [];
    for (const [tag, kind] of [
      ["clock", "clock"],
      ["native-effects", "native"],
    ]) {
      const card = document.createElement(`yeelight-cube-${tag}-card`);
      const sent = [];
      const items = [
        { name: "Rainbow", color_mode: "bw" },
        { name: "Tide", color_mode: "normal" },
      ];
      const rotation = {
        kind,
        items,
        interval: 45,
        active: true,
        error: null,
      };
      const state = (failed, otherState = "on") => ({
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            state: otherState,
            attributes: {
              ...hass.states["light.a"].attributes,
              friendly_name: "Top",
              effect_rotation: { ...rotation },
            },
          },
          "light.b": {
            state: "on",
            attributes: {
              ...hass.states["light.a"].attributes,
              friendly_name: "Bottom",
              effect_rotation: { ...rotation, ...failed },
            },
          },
        },
        callService: async (domain, service, data) =>
          sent.push({ domain, service, data }),
      });
      card.setConfig({
        ...baseConfig,
        target_entities: ["light.a", "light.b"],
        show_rotation: true,
      });
      card.hass = state({});
      document.querySelector("main").append(card);
      const settle = async () => {
        await card.updateComplete;
        await new Promise(requestAnimationFrame);
        await Promise.all(
          [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")].map(
            (view) => view.updateComplete,
          ),
        );
      };
      const view = () =>
        [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")].find(
          (view) => view.shadowRoot.textContent.includes("Rotation"),
        );
      const text = () => view().shadowRoot.textContent.replace(/\s+/g, " ");
      const retry = () =>
        view().shadowRoot.querySelector('button[title="Retry failed lamps"]');
      await settle();
      const healthy =
        !text().includes("Running: 2/2") &&
        !retry() &&
        !text().includes("Bottom:");
      card.hass = state({
        active: false,
        error: "Hard timeout: rotation:clock",
      });
      await settle();
      const partial =
        text().includes("Running: 1/2") &&
        text().includes("Bottom: Stopped") &&
        !!retry();
      card.style.width = "320px";
      card.hass = state(
        { active: false, error: "Hard timeout: rotation:clock" },
        "unavailable",
      );
      await settle();
      const retryAvailable = !!retry() && !retry().disabled;
      const errorElement = view().shadowRoot.querySelector(".error");
      const narrowFits =
        errorElement.scrollWidth <= errorElement.clientWidth + 1;
      retry()?.click();
      for (let tick = 0; tick < 10; tick++) await Promise.resolve();
      await settle();
      const retryCalls = sent.filter(
        (call) => call.service === "start_effect_rotation",
      );
      card.hass = state({
        active: true,
        error: "Hard timeout: rotation:clock",
        retry_attempt: 1,
        retry_at: Date.now() / 1000 + 5,
      });
      await settle();
      const retrying =
        text().includes("Retrying: 1") &&
        text().includes("Retrying (1/2)") &&
        !retry();
      view()
        .shadowRoot.querySelector('button[title="Stop rotation"]')
        .click();
      for (let tick = 0; tick < 10; tick++) await Promise.resolve();
      const partialStop =
        sent.filter((call) => call.service === "stop_effect_rotation")
          .length === 1;
      card.hass = state({});
      await settle();
      const recovered =
        !text().includes("Bottom:") &&
        !text().includes("Hard timeout") &&
        !retry() &&
        !text().includes("Running: 2/2");
      rotation.active = false;
      rotation.waiting_for_reconnect = true;
      rotation.error = "Hard timeout: rotation:clock";
      const offline = state({}, "unavailable");
      offline.states["light.b"].state = "unavailable";
      card.hass = offline;
      await settle();
      const stopWaiting = view().shadowRoot.querySelector(
        'button[title="Stop rotation"]',
      );
      const waiting =
        text().includes("Running: 0/2") &&
        text().includes("Waiting: 2") &&
        text().includes("Bottom: Waiting for lamp to reconnect") &&
        text().includes("Top: Waiting for lamp to reconnect") &&
        !text().includes("Hard timeout") &&
        !retry() &&
        !view().shadowRoot.querySelector(".error") &&
        !!stopWaiting &&
        !stopWaiting.disabled;
      const waitingFits = [
        ...view().shadowRoot.querySelectorAll('[role="status"]'),
      ].every((element) => element.scrollWidth <= element.clientWidth + 1);
      const stopsBefore = sent.filter(
        (call) => call.service === "stop_effect_rotation",
      ).length;
      stopWaiting?.click();
      for (let tick = 0; tick < 10; tick++) await Promise.resolve();
      const waitingStop =
        sent.filter((call) => call.service === "stop_effect_rotation")
          .length ===
        stopsBefore + 1;
      const favouritesBefore = JSON.stringify(card._controls.favourites);
      const callsBeforeMissing = sent.length;
      const missing = state({}, "unavailable");
      for (const entity of ["light.a", "light.b"])
        missing.states[entity] = { state: "unavailable", attributes: {} };
      card.hass = missing;
      await settle();
      const missingData =
        card.shadowRoot.textContent.includes("Lamp unavailable") &&
        !card.shadowRoot.textContent.includes("Reload the updated") &&
        !card.shadowRoot.querySelector(".sliders, .slider-group") &&
        text().includes("Status unavailable") &&
        !text().includes("Stopped") &&
        !text().includes("0 effects") &&
        !text().includes("No effects selected") &&
        !text().includes("No clock modes selected") &&
        JSON.stringify(card._controls.favourites) === favouritesBefore &&
        sent.length === callsBeforeMissing;
      rotation.active = true;
      rotation.waiting_for_reconnect = false;
      rotation.error = null;
      card.hass = state({});
      await settle();
      const missingRecovered =
        !card.shadowRoot.textContent.includes("Lamp unavailable") &&
        !text().includes("Status unavailable") &&
        text().includes("Running") &&
        sent.length === callsBeforeMissing;
      const cold = document.createElement(`yeelight-cube-${tag}-card`);
      cold.setConfig({
        ...baseConfig,
        style_selector_style: "original",
        effect_view: "grid",
        items_per_page: tag === "clock" ? 6 : 8,
        show_current_preview: true,
        show_gallery: true,
        show_preview: true,
        show_favourites: true,
        favourites_show_previews: true,
        target_entities: ["light.a", "light.b"],
        show_rotation: true,
      });
      cold.hass = missing;
      document.querySelector("main").append(cold);
      await cold.updateComplete;
      await new Promise(requestAnimationFrame);
      const coldView = [
        ...cold.shadowRoot.querySelectorAll("yeelight-mode-controls"),
      ].find(
        (element) =>
          element.area === "collections" ||
          element.getAttribute("area") === "collections",
      );
      await coldView.updateComplete;
      const coldStart = coldView.shadowRoot.querySelector(
        'button[title="Start rotation"]',
      );
      const coldOffline =
        cold.shadowRoot.textContent.includes("Lamp unavailable") &&
        !cold.shadowRoot.textContent.includes("Reload the updated") &&
        coldView.shadowRoot.textContent.includes("Status unavailable") &&
        !!coldStart &&
        coldStart.disabled &&
        sent.length === callsBeforeMissing;
      coldStart?.click();
      for (let tick = 0; tick < 10; tick++) await Promise.resolve();
      const unknownIdle = sent.length === callsBeforeMissing;
      const previewCalls = sent.length;
      const originalFavourites = [...cold._controls.favourites];
      const offlineSettle = async () => {
        await cold.updateComplete;
        await new Promise(requestAnimationFrame);
        await coldView.updateComplete;
      };
      const screenshotFavourites =
        tag === "clock"
          ? [
              { key: "Rainbow", colorMode: "normal" },
              { key: "Kaleidoscope", colorMode: "white_orange" },
              { key: "Color Trails", colorMode: "blue_yellow" },
              { key: "Rainbow Flow", colorMode: "purple_orange" },
              { key: "Tide", colorMode: "white_orange" },
              { key: "Rainbow Flow", colorMode: "white_orange" },
            ]
          : ["Ocean Waves", "Bonfire", "Aurora", "Rainbow", "Streamer"].map(
              (key) => ({ key, colorMode: "normal" }),
            );
      cold._controls.save(screenshotFavourites);
      await offlineSettle();
      const shown = (element) =>
        element && element.getBoundingClientRect().height > 0;
      if (!shown(cold.shadowRoot.querySelector("yeelight-color-mode")))
        throw Error(`${tag}: screenshot layout must show offline colors`);
      if (!shown(cold.shadowRoot.querySelector(".original-gallery")))
        throw Error(`${tag}: screenshot layout must show offline gallery`);
      const favouriteButtons = [
        ...coldView.shadowRoot.querySelectorAll(".favourites button"),
      ];
      if (
        favouriteButtons.length !== screenshotFavourites.length ||
        favouriteButtons.some(
          (button) =>
            button.disabled || button.textContent.includes("Unavailable"),
        )
      )
        throw Error(
          `${tag}: screenshot favourites must all remain usable offline`,
        );
      for (const favourite of screenshotFavourites) {
        const pixels = cold._controls.adapter.frame(
          favourite.key,
          4.75,
          favourite.colorMode,
        );
        if (!pixels?.some((pixel) => pixel.some((channel) => channel > 0)))
          throw Error(`${tag}: missing offline preview for ${favourite.key}`);
      }
      for (const entity of ["light.a", "light.b"])
        delete missing.states[entity];
      cold.hass = { ...missing };
      await offlineSettle();
      const catalogue = cold._controls.adapter.items();
      const check = (condition, message) => {
        if (!condition) throw Error(`${tag}: ${message}`);
      };
      check(
        catalogue.some((item) => item.title === "Kaleidoscope"),
        "complete offline catalogue",
      );
      check(
        cold.shadowRoot.querySelector("yc-collection-gallery"),
        "offline browser",
      );
      check(
        cold.shadowRoot.querySelector("yeelight-color-mode"),
        "offline colors",
      );
      check(
        await cold._controls.choose("Kaleidoscope"),
        "offline style choice",
      );
      await cold._applyColorMode("white_orange");
      await offlineSettle();
      check(
        cold._controls.adapter.current() === "Kaleidoscope",
        "selected offline style",
      );
      check(
        cold._controls.adapter.currentColorMode() === "white_orange",
        "selected offline color",
      );
      cold._controls.save([]);
      cold._controls.toggleFavourite();
      await offlineSettle();
      check(cold._controls.favourites.length === 1, "save offline favourite");
      check(
        cold._controls.favourites[0].colorMode === "white_orange",
        "saved favourite color",
      );
      const offlineFrame = cold._controls.adapter.frame(
        "Kaleidoscope",
        1.2,
        "white_orange",
      );
      check(
        offlineFrame.some((pixel) => pixel.some((channel) => channel > 0)),
        "nonblank offline frame",
      );
      check(
        coldView.shadowRoot.querySelector(
          ".favourites button:not(:disabled)",
        ),
        "usable offline favourite",
      );
      check(
        await cold._controls.chooseFavourite({
          key: "Rainbow",
          colorMode: "bw",
        }),
        "choose offline favourite",
      );
      await offlineSettle();
      check(
        cold._controls.adapter.currentColorMode() === "bw",
        "favourite restores color",
      );
      const customFavourite = {
        key: "Rainbow",
        colorMode: "custom",
        color: [18, 52, 86],
      };
      check(
        await cold._controls.chooseFavourite(customFavourite),
        "choose offline custom color",
      );
      await offlineSettle();
      cold._controls.toggleFavourite();
      await offlineSettle();
      check(
        cold._controls.favourites.length === 2,
        "save custom offline favourite",
      );
      check(
        JSON.stringify(cold._controls.favourites[1]) ===
          JSON.stringify(customFavourite),
        "preserve custom RGB in offline favourite",
      );
      cold._controls.toggleFavourite();
      await offlineSettle();
      check(
        cold._controls.favourites.length === 1,
        "remove custom offline favourite",
      );
      check(
        sent.length === previewCalls,
        "offline editing must not send hardware commands",
      );
      cold._controls.save(originalFavourites);
      cold.hass = state({});
      await offlineSettle();
      check(
        sent.length === previewCalls,
        "reconnect must not apply offline drafts",
      );
      check(cold._offlinePreviewDraft === null, "discard draft on reconnect");
      for (const runningKind of ["clock", "native"]) {
        const observed = state({});
        for (const entity of ["light.a", "light.b"])
          observed.states[entity].attributes.effect_rotation = {
            ...observed.states[entity].attributes.effect_rotation,
            kind: runningKind,
            active: true,
            waiting_for_reconnect: false,
            error: null,
          };
        cold.hass = observed;
        await offlineSettle();
        cold.hass = { ...missing };
        await offlineSettle();
        const ownsRotation =
          runningKind === (tag === "clock" ? "clock" : "native");
        const button = coldView.shadowRoot.querySelector(
          `button[title="${ownsRotation ? "Stop" : "Start"} rotation"]`,
        );
        check(
          button && button.disabled === !ownsRotation,
          `lost status retains ${runningKind} ownership`,
        );
        check(
          sent.length === previewCalls,
          "observing lost rotation status sends no commands",
        );
      }
      cold.remove();
      results.push({
        tag,
        healthy,
        partial,
        retrying,
        recovered,
        retryAvailable,
        narrowFits,
        partialStop,
        waiting,
        waitingFits,
        waitingStop,
        missingData,
        missingRecovered,
        coldOffline,
        unknownIdle,
        retryCalls,
      });
      card.remove();
    }
    return results;
  });
  for (const result of rotationErrors) {
    for (const key of [
      "healthy",
      "partial",
      "retrying",
      "recovered",
      "retryAvailable",
      "narrowFits",
      "partialStop",
      "waiting",
      "waitingFits",
      "waitingStop",
      "missingData",
      "missingRecovered",
      "coldOffline",
      "unknownIdle",
    ])
      assert.equal(
        result[key],
        true,
        `${result.tag}: error-only rotation ${key}`,
      );
    assert.equal(
      result.retryCalls.length,
      1,
      `${result.tag}: retry sent once`,
    );
    assert.equal(
      result.retryCalls[0].data.entity_id,
      "light.b",
      `${result.tag}: healthy target untouched`,
    );
    assert.equal(result.retryCalls[0].data.interval, 45);
    assert.equal(result.retryCalls[0].data.items[0].color_mode, "bw");
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS rotation details appear only on errors; retry isolates failed targets; recovery clears details on Clock/Native",
  );
};
