// Card UI parity check (tests/card-ui-parity.cjs): favourite clicks, Live
// Preview pagination, one color command owner.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { browser, page, errors } = t;
  const favouriteResults = await page.evaluate(async () => {
    native.style.display = "";
    clock.style.width = "";
    const results = [];
    for (const card of [clock, native]) {
      for (const previews of [true, false]) {
        card.setConfig({
          ...baseConfig,
          show_favourites: true,
          favourites_show_previews: previews,
        });
        card.hass = hass;
        if (card.updateComplete) await card.updateComplete;
        const model = card._controls;
        const saved = [
          { key: "Rainbow", colorMode: "bw" },
          { key: "Rainbow", colorMode: "red_blue" },
          { key: "Rainbow", colorMode: "custom", color: [12, 34, 56] },
        ];
        model.save(saved);
        const view = [
          ...card.shadowRoot.querySelectorAll("yeelight-mode-controls"),
        ].find((item) => item.area === "collections");
        await view.updateComplete;
        calls.length = 0;
        const first = [...view.shadowRoot.querySelectorAll("button")].find(
          (button) => button.getAttribute("aria-label") === "Rainbow (B&W)",
        );
        if (!first) throw Error("Favourite button missing");
        first.click();
        await Promise.resolve();
        await card._queue;
        while (model.busy) await new Promise(requestAnimationFrame);
        await view.updateComplete;
        const remove = [...view.shadowRoot.querySelectorAll("button")].find(
          (button) =>
            button.getAttribute("aria-label") === "Remove favourite",
        );
        if (!remove)
          throw Error(
            "Selected saved favourite is not removable before state echo",
          );
        remove.click();
        results.push({
          kind: model.adapter.kind,
          previews,
          remaining: model.favourites,
          commands: [...calls],
        });
        await model.chooseFavourite(saved[2]);
        const customCommand = calls.at(-1);
        if (JSON.stringify(customCommand.data.color) !== "[12,34,56]")
          throw Error("Custom RGB lost");
        model.save([saved[2]]);
        if (card === clock) card._customDraft = [90, 80, 70];
        else card._customColorDraft = [90, 80, 70];
        model.update();
        view._manage = true;
        view.requestUpdate();
        await view.updateComplete;
        const add = view.shadowRoot.querySelector(
          ".orderable-add-row select",
        );
        const variant = [...add.options].find((option) =>
          option.textContent.includes("Rainbow"),
        );
        if (!variant) throw Error("Manage cannot add another RGB variant");
        add.value = variant.value;
        add.dispatchEvent(new Event("change"));
        await view.updateComplete;
        if (JSON.stringify(model.favourites[1].color) !== "[90,80,70]")
          throw Error("Manage lost RGB");
        model.shuffleFavourites(() => 0);
        await view.updateComplete;
        view.shadowRoot.querySelector(".orderable-list-row .remove").click();
        if (JSON.stringify(model.favourites) !== JSON.stringify([saved[2]]))
          throw Error("Manage removed wrong RGB variant");
        view._manage = false;
        const before = JSON.stringify(
          model.adapter.frame("Rainbow", 2, "normal"),
        );
        card.hass = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              ...hass.states["light.a"],
              attributes: {
                ...hass.states["light.a"].attributes,
                native_effect_color: [255, 0, 0],
                clock_color: 0x01ff0000,
              },
            },
          },
        };
        const after = JSON.stringify(
          model.adapter.frame("Rainbow", 2, "normal"),
        );
        if (before !== after)
          throw Error("Normal favourite inherited live RGB");
        model.save([]);
      }
    }
    return results;
  });
  for (const result of favouriteResults) {
    assert.deepEqual(result.remaining, [
      { key: "Rainbow", colorMode: "red_blue" },
      { key: "Rainbow", colorMode: "custom", color: [12, 34, 56] },
    ]);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].data.color_mode, "bw");
    assert.equal(result.commands[0].data.color, "clear");
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS real favourite clicks restore colors and Remove targets the saved variant before state echo",
  );
  const paginationResults = await page.evaluate(async () => {
    const results = [];
    for (const tag of [clock.localName, native.localName]) {
      const card = document.createElement(tag);
      card.setConfig({
        ...baseConfig,
        show_gallery: true,
        style_selector_style: "preview-list",
        items_per_page: 1,
      });
      card.hass = hass;
      document.querySelector("main").append(card);
      await card.updateComplete;
      const before = card.shadowRoot.querySelector(
        ".gc-preview-shell [data-mode]",
      )?.dataset.mode;
      card.shadowRoot
        .querySelector('[data-pagination-action="next"]')
        .click();
      await card.updateComplete;
      results.push({
        tag: card.localName,
        before,
        after: card.shadowRoot.querySelector(".gc-preview-shell [data-mode]")
          ?.dataset.mode,
      });
      card.remove();
    }
    return results;
  });
  for (const result of paginationResults) {
    assert.ok(result.before);
    assert.ok(result.after);
    assert.notEqual(
      result.after,
      result.before,
      `${result.tag}: Next must advance`,
    );
  }
  console.log("PASS both cards advance Live Preview pagination");
  const ownershipResults = await page.evaluate(async () => {
    const results = [];
    for (const tag of [clock.localName, native.localName]) {
      const card = document.createElement(tag);
      const config = {
        ...baseConfig,
        show_gallery: true,
        show_search: true,
        show_color_modes: true,
        style_selector_style: "preview-grid",
        items_per_page: 1,
      };
      card.setConfig(config);
      card.hass = hass;
      document.querySelector("main").append(card);
      await card.updateComplete;
      const browser = card.shadowRoot.querySelector("yc-collection-gallery");
      browser.querySelector('[data-pagination-action="next"]').click();
      await browser.updateComplete;
      const advanced = browser.page === 1;
      const input = browser.querySelector('input[type="search"]');
      input.value = "rainbow";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await browser.updateComplete;
      const reset =
        browser.page === 0 &&
        browser.visibleItems.every((item) =>
          item.name.toLowerCase().includes("rainbow"),
        );
      card.remove();
      document.querySelector("main").append(card);
      await card.updateComplete;
      await browser.updateComplete;
      card._controls.save([{ key: "Rainbow", colorMode: "normal" }]);
      await browser.updateComplete;
      const reconnected = !!browser.querySelector(
        '[data-mode="Rainbow"][data-favourite="true"]',
      );
      card.setConfig({ ...config, show_search: false });
      card.hass = hass;
      await card.updateComplete;
      const cleared =
        browser.query === "" &&
        !browser.querySelector('input[type="search"]');
      const before = calls.length;
      card.shadowRoot
        .querySelector('yeelight-color-mode [data-value="bw"]')
        .click();
      await card._commands.queue;
      await card.updateComplete;
      const sent = calls
        .slice(before)
        .filter((call) =>
          ["set_clock_style", "set_native_effect"].includes(call.service),
        );
      results.push({
        tag,
        advanced,
        reset,
        reconnected,
        cleared,
        commands: sent.length,
      });
      card._controls.save([]);
      card.remove();
    }
    return results;
  });
  for (const result of ownershipResults) {
    assert.equal(result.advanced, true, `${result.tag}: paging`);
    assert.equal(result.reset, true, `${result.tag}: search resets page`);
    assert.equal(
      result.reconnected,
      true,
      `${result.tag}: reconnect subscription`,
    );
    assert.equal(
      result.cleared,
      true,
      `${result.tag}: hiding search clears query`,
    );
    assert.equal(
      result.commands,
      1,
      `${result.tag}: one color selection, one command`,
    );
  }
  console.log(
    "PASS shared browser reset/reconnect and single color-command ownership on both cards",
  );
};
