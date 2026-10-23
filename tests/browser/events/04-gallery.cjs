// Card events check (tests/card-events-browser.cjs): the shared gallery: chip
// swatches, item labels, hostile names, the album, rename / delete.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, waitForCall, reset } = t;
  // --- Chip swatches: a meaningful swatch for every kind of item ------------
  const chips = async (tag, config, paintedBy) => {
    await page.evaluate(
      ({ tag, config }) =>
        mount(tag, {
          entity: "light.a",
          style_selector_style: "chips",
          ...config,
        }),
      { tag, config },
    );
    await page.waitForTimeout(200);
    return page.evaluate((paintedBy) => {
      const chip = card.shadowRoot.querySelector(
        "yc-collection-gallery .mode-chip[data-mode]",
      );
      const matrix = chip?.querySelector(
        ".mode-chip-matrix .gallery-matrix-preview",
      );
      const animated =
        paintedBy === "clock"
          ? [...(card._visible || [])].includes(chip)
          : paintedBy === "native"
            ? (card._frames || []).some((frame) => frame.node === chip)
            : null;
      return {
        cells: matrix?.children.length ?? 0,
        swatch:
          chip?.querySelector(".mode-chip-swatch")?.style.background || "",
        animated,
      };
    }, paintedBy);
  };
  const clockChip = await chips(
    "yeelight-cube-clock-card",
    { show_gallery: true },
    "clock",
  );
  assert.equal(
    clockChip.cells,
    100,
    "clock chips: micro-matrix of the style",
  );
  assert.equal(clockChip.animated, true, "clock chips: animated by the card");
  const nativeChip = await chips(
    "yeelight-cube-native-effects-card",
    { show_gallery: true },
    "native",
  );
  assert.equal(
    nativeChip.cells,
    100,
    "native chips: micro-matrix of the effect",
  );
  assert.equal(
    nativeChip.animated,
    true,
    "native chips: animated by the card",
  );
  const gradientChip = await chips("yeelight-cube-gradient-card", {}, null);
  assert.equal(gradientChip.cells, 0, "gradient chips: no matrix");
  assert.ok(gradientChip.swatch, "gradient chips: the mode's own gradient");

  // --- Item labels: a card renames items for display only ------------------
  await page.evaluate(() =>
    mount("yeelight-cube-clock-card", {
      entity: "light.a",
      show_gallery: true,
      show_search: true,
      style_selector_style: "filled",
      item_labels: { Rainbow: "Arc-en-ciel" },
    }),
  );
  const clockLabels = () =>
    page.evaluate(() => ({
      button: card.shadowRoot
        .querySelector('yc-collection-gallery [data-mode="Rainbow"]')
        ?.textContent.trim(),
      active: card.shadowRoot
        .querySelector(".active-label")
        ?.textContent.trim(),
    }));
  assert.deepEqual(await clockLabels(), {
    button: "Arc-en-ciel",
    active: "Arc-en-ciel",
  });
  const search = page.locator("yeelight-cube-clock-card .yc-gallery-search");
  for (const query of ["arc-en", "rainbow"]) {
    await search.fill(query);
    assert.ok(
      await page
        .locator(
          'yeelight-cube-clock-card yc-collection-gallery [data-mode="Rainbow"]',
        )
        .count(),
      `clock search "${query}" finds the renamed style`,
    );
  }
  await page
    .locator(
      'yeelight-cube-clock-card yc-collection-gallery [data-mode="Rainbow"]',
    )
    .click();
  assert.match(
    JSON.stringify(
      await waitForCall("set_clock_style", "renamed style pick"),
    ),
    /Rainbow/,
    "a renamed style is still applied by its key",
  );
  await page.evaluate(() =>
    mount("yeelight-cube-native-effects-card", {
      entity: "light.a",
      show_preview: true,
      item_labels: { Rainbow: "Arc" },
    }),
  );
  assert.equal(
    await page.evaluate(() =>
      card.shadowRoot
        .querySelector(".current-heading h3")
        ?.textContent.trim(),
    ),
    "Arc",
    "native: current effect heading uses the label",
  );
  // Previous / Next step through what the gallery's search shows.
  assert.deepEqual(
    await page.evaluate(async () => {
      await card.updateComplete;
      const keys = () =>
        card._controls.adapter.navigationItems().map((item) => item.key);
      const search = card.shadowRoot.querySelector(".yc-gallery-search");
      const typed = async (text) => {
        search.value = text;
        search.dispatchEvent(new Event("input"));
        await card.updateComplete;
        return keys();
      };
      return {
        label: await typed("arc"),
        none: await typed("zzz"),
        all: await typed(""),
      };
    }),
    { label: ["Rainbow"], none: [], all: ["Rainbow"] },
    "native: Previous / Next follow the search (labels included)",
  );
  await page.evaluate(() =>
    mount("yeelight-cube-gradient-card", {
      entity: "light.a",
      show_active_mode_label: true,
      style_selector_style: "filled",
      item_labels: { "Angle Gradient": "Diagonal" },
    }),
  );
  await page.waitForTimeout(150);
  assert.deepEqual(
    await page.evaluate(() => ({
      chip: card.shadowRoot.querySelector(".gc-aml-text")?.textContent.trim(),
      button: card.shadowRoot
        .querySelector('yc-collection-gallery [data-mode="Angle Gradient"]')
        ?.textContent.trim(),
    })),
    { chip: "Diagonal", button: "Diagonal" },
    "gradient: label in the active-mode chip and the selector",
  );
  // The editor renames in its visible-modes list.
  const renamed = await page.evaluate(async () => {
    const editor = await customElements
      .get("yeelight-cube-gradient-card")
      .getConfigElement();
    editor.hass = hass;
    editor.setConfig({
      type: "custom:yeelight-cube-gradient-card",
      entity: "light.a",
    });
    document.querySelector("main").replaceChildren(editor);
    await editor.updateComplete;
    for (const section of editor.shadowRoot.querySelectorAll(
      ".editor-card-header",
    )) {
      section.click();
      await editor.updateComplete;
    }
    const changes = [];
    editor.addEventListener("config-changed", (event) =>
      changes.push(event.detail.config),
    );
    const field = editor.shadowRoot.querySelector(".orderable-list-rename");
    field.value = "Plain";
    field.dispatchEvent(new Event("change"));
    await editor.updateComplete;
    const set = changes.at(-1)?.item_labels;
    const input = editor.shadowRoot.querySelector(".orderable-list-rename");
    input.value = "";
    input.dispatchEvent(new Event("change"));
    const cleared = "item_labels" in (changes.at(-1) || {});
    // Every mode is listed (no toggle); moving one makes the list the
    // card's own, and "Show all modes" goes back (names are kept).
    const rows = editor.shadowRoot.querySelectorAll(
      ".orderable-list-rename",
    ).length;
    field.value = "Plain";
    field.dispatchEvent(new Event("change"));
    await editor.updateComplete;
    editor.shadowRoot
      .querySelector('.orderable-list-row button[title="Move down"]')
      .click();
    await editor.updateComplete;
    const custom = changes.at(-1);
    [...editor.shadowRoot.querySelectorAll(".orderable-reset-btn")]
      .find((button) => button.textContent.includes("Show all modes"))
      .click();
    await editor.updateComplete;
    const reset = changes.at(-1);
    return {
      placeholder: field.placeholder,
      set,
      cleared,
      rows,
      custom: [custom.visible_modes.slice(0, 2), custom.hidden_modes],
      reset: [reset.visible_modes, reset.hidden_modes, reset.item_labels],
    };
  });
  assert.deepEqual(renamed, {
    placeholder: "Solid Color",
    set: { "Solid Color": "Plain" },
    cleared: false,
    rows: 10,
    custom: [["Letter Gradient", "Solid Color"], []],
    reset: [undefined, undefined, { "Solid Color": "Plain" }],
  });

  // --- Hostile names: saved names are shown as text, never run as markup ----
  // Palettes, pixel arts and clock presets are shared data any HA user (or
  // an imported file) can name. Every display mode must keep them inert.
  const EVIL = `EVIL<img src=x onerror="window.__pwned=1"><b id="pwn">"'&`;
  await page.evaluate((EVIL) => {
    window.deepAll = (selector, root = document) => {
      const found = [...root.querySelectorAll(selector)];
      for (const el of root.querySelectorAll("*"))
        if (el.shadowRoot) found.push(...deepAll(selector, el.shadowRoot));
      return found;
    };
    window.deepText = (root = document) => {
      let text = root.textContent || "";
      for (const el of root.querySelectorAll("*"))
        if (el.shadowRoot) text += deepText(el.shadowRoot);
      return text;
    };
    hass.states["sensor.pal"] = {
      state: "2",
      attributes: {
        palettes_v2: [
          {
            name: EVIL,
            colors: [
              [255, 0, 0],
              [0, 0, 255],
            ],
          },
          { name: "Plain", colors: [[0, 255, 0]] },
        ],
      },
    };
    hass.states["sensor.pixel"].attributes.pixel_arts[0].name = EVIL;
    // Saved presets are offered only when the backend has the service.
    hass.services = { yeelight_cube: { save_clock_preset: {} } };
    hass.states["sensor.presets"] = {
      state: "1",
      attributes: {
        clock_presets: [
          { id: "evil", name: EVIL, kind: "color_mode", color: [255, 0, 0] },
        ],
      },
    };
    // HA replaces the states object on every change (cards cache by it).
    hass.states = { ...hass.states };
  }, EVIL);
  const checkInert = async (label) => {
    await page.waitForTimeout(150); // let a broken <img> fire onerror
    const result = await page.evaluate(() => ({
      pwned: window.__pwned === 1,
      injected: deepAll('img[src="x"], #pwn').length,
      shown: deepText().includes("EVIL"),
    }));
    assert.equal(result.pwned, false, `${label}: markup ran`);
    assert.equal(result.injected, 0, `${label}: markup became elements`);
    assert.ok(result.shown, `${label}: the name is not shown at all`);
  };
  for (const mode of ["list", "gallery", "carousel", "album"]) {
    await page.evaluate(
      (mode) =>
        mount("yeelight-cube-palette-card", {
          entity: "light.a",
          palette_sensor: "sensor.pal",
          display_mode: mode,
        }),
      mode,
    );
    await checkInert(`palette ${mode}`);
  }
  for (const mode of ["list", "gallery", "carousel", "album"]) {
    await page.evaluate(
      (mode) =>
        mount("yeelight-cube-draw-card", {
          entity: "light.a",
          pixelart_sensor: "sensor.pixel",
          pixel_art_gallery_mode: mode,
        }),
      mode,
    );
    await checkInert(`draw ${mode}`);
  }
  await page.evaluate(() =>
    mount("yeelight-cube-clock-card", {
      entity: "light.a",
      show_gallery: true,
      show_color_modes: true,
    }),
  );
  await checkInert("clock presets");

  // --- Mosaic in a card whose previews animate (Clock): every tile painted
  await page.evaluate(() =>
    mount("yeelight-cube-clock-card", {
      entity: "light.a",
      show_gallery: true,
      style_selector_style: "preview-mosaic",
    }),
  );
  await page.waitForTimeout(400);
  const mosaicTiles = await page.evaluate(() => {
    const tiles = [...card.shadowRoot.querySelectorAll(".gallery-display-mosaic > .gallery-item")];
    if (!tiles.length) return { count: 0, painted: 0 };
    return {
      count: tiles.length,
      painted: tiles.filter((tile) =>
        [...tile.querySelectorAll(".gallery-matrix-preview > div")].some(
          (cell) => !["", "rgb(0, 0, 0)", "#000", "transparent"].includes(cell.style.background),
        ),
      ).length,
    };
  });
  assert.ok(mosaicTiles.count > 0, "clock mosaic: tiles");
  assert.ok(mosaicTiles.painted > 0, "clock mosaic: tiles painted by the clock loop");

  // --- The shared gallery's album (Clock; Native uses the same element) ----
  await page.evaluate(() =>
    mount("yeelight-cube-clock-card", {
      entity: "light.a",
      show_gallery: true,
      style_selector_style: "preview-album",
    }),
  );
  const album = () =>
    page.evaluate(() => {
      const items = [
        ...card.shadowRoot.querySelectorAll(".collection-album-item"),
      ];
      const centre = items.find((item) => item.classList.contains("active"));
      return {
        count: items.length,
        centre: centre?.querySelector("[data-mode]")?.dataset.mode,
        painted: !!centre?.querySelector(".gallery-matrix-preview > div"),
      };
    });
  const start = await album();
  assert.ok(start.count > 2, "album: every clock style");
  assert.equal(start.centre, "Rainbow", "album: opens on the active style");
  assert.ok(start.painted, "album: live matrix preview");
  // The arrows only browse; clicking the centred card applies it.
  await page.locator("yeelight-cube-clock-card .album-nav-next").click();
  const next = await album();
  assert.notEqual(next.centre, "Rainbow");
  assert.equal(
    await page.evaluate(() => calls.length),
    0,
    "album: browsing applies nothing",
  );
  // New previews of the same items (a fresh items array) keep the card
  // being browsed.
  await page.evaluate(async () => {
    const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
    gallery.items = gallery.items.map((item) => ({ ...item }));
    await gallery.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.equal(
    (await album()).centre,
    next.centre,
    "album: refreshed previews keep the browsed card",
  );
  // The wheel's rule: fresh items with the same keys keep the browsed item;
  // a new list or a new active item centres the active one.
  assert.deepEqual(
    await page.evaluate(async () => {
      const wheel = document.createElement("yc-wheel");
      const items = (...keys) => keys.map((dataMode) => ({ dataMode }));
      wheel.items = items("a", "b", "c");
      wheel.active = "a";
      document.body.append(wheel);
      await wheel.updateComplete;
      const centres = [wheel.center];
      wheel.center = 2; // browsed
      await wheel.updateComplete;
      wheel.items = items("a", "b", "c");
      await wheel.updateComplete;
      centres.push(wheel.center);
      wheel.items = items("c", "a", "b");
      await wheel.updateComplete;
      centres.push(wheel.center);
      wheel.active = "b";
      await wheel.updateComplete;
      centres.push(wheel.center);
      wheel.remove();
      return centres;
    }),
    [0, 2, 1, 2],
    "wheel: refreshed items keep the browsed item",
  );
  await page
    .locator("yeelight-cube-clock-card .collection-album-item.active")
    .click();
  const applied = await waitForCall("set_clock_style", "album pick");
  assert.match(JSON.stringify(applied), new RegExp(next.centre));
  // A rotation step (the lamp reports another style) turns the album to it.
  await page.evaluate(async () => {
    const light = hass.states["light.a"];
    hass = {
      ...hass,
      states: {
        ...hass.states,
        "light.a": {
          ...light,
          attributes: {
            ...light.attributes,
            clock_style: "White",
            clock_style_id: 4,
          },
        },
      },
    };
    card.hass = hass;
    await card.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert.equal(
    (await album()).centre,
    "White",
    "album: follows the active style",
  );
  // Item shape, button shape and wrap navigation reach the album.
  await page.evaluate(() =>
    mount("yeelight-cube-clock-card", {
      entity: "light.a",
      show_gallery: true,
      style_selector_style: "preview-album",
      selector_shape: "square",
      selector_button_shape: "square",
      gallery_wrap_navigation: true,
    }),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      card: getComputedStyle(
        card.shadowRoot.querySelector(".collection-album-item"),
      ).borderTopLeftRadius,
      arrow: getComputedStyle(
        card.shadowRoot.querySelector(".album-nav-prev"),
      ).borderTopLeftRadius,
    })),
    { card: "0px", arrow: "0px" },
    "album: item and button shapes",
  );
  const firstIndex = await page.evaluate(() =>
    [...card.shadowRoot.querySelectorAll(".collection-album-item")].findIndex(
      (item) => item.classList.contains("active"),
    ),
  );
  for (let i = 0; i <= firstIndex; i++)
    await page.locator("yeelight-cube-clock-card .album-nav-prev").click();
  assert.equal(
    await page.evaluate(() => {
      const items = [
        ...card.shadowRoot.querySelectorAll(".collection-album-item"),
      ];
      return items.at(-1).classList.contains("active");
    }),
    true,
    "album: wrap navigation goes from the first item to the last",
  );

  // --- User-owned items: rename and delete in the gallery --------------------
  await page.evaluate(() => {
    window.savedPresets = hass.states["sensor.presets"];
    hass.states = {
      ...hass.states,
      "sensor.presets": {
        state: "1",
        attributes: {
          clock_presets: [
            { id: "mine", name: "Mine", kind: "style", color: [10, 200, 30] },
          ],
        },
      },
    };
  });
  const clockGrid = (extra) =>
    page.evaluate(
      (extra) =>
        mount("yeelight-cube-clock-card", {
          entity: "light.a",
          show_gallery: true,
          show_search: false,
          style_selector_style: "preview-grid",
          ...extra,
        }),
      extra,
    );
  await clockGrid({ allow_rename: true });
  const controls = await page.evaluate(() => {
    const of = (key) =>
      card.shadowRoot.querySelector(
        `yc-collection-gallery .gallery-item[data-mode="${key}"]`,
      );
    const count = (node) => ({
      remove: node?.querySelectorAll(".yc-item-delete").length,
      rename: node?.querySelectorAll(".yc-item-rename").length,
    });
    return { mine: count(of("custom:mine")), builtin: count(of("Rainbow")) };
  });
  assert.deepEqual(
    controls,
    {
      mine: { remove: 1, rename: 1 },
      builtin: { remove: 0, rename: 0 },
    },
    "only user-owned items get rename / delete",
  );
  const mine =
    'yeelight-cube-clock-card yc-collection-gallery .gallery-item[data-mode="custom:mine"]';
  // Home Assistant publishing the library (what the backend stores).
  const publish = (presets) =>
    page.evaluate(async (presets) => {
      hass.states = {
        ...hass.states,
        "sensor.presets": { state: String(presets.length), attributes: { clock_presets: presets } },
      };
      card.hass = { ...hass };
      await card.updateComplete;
    }, presets);
  const label = () =>
    page.evaluate(
      () =>
        card.shadowRoot
          .querySelector('yc-collection-gallery .gallery-item[data-mode="custom:mine"]')
          ?.textContent.replace(/\s+/g, " ")
          .trim() ?? null,
    );
  // Rename through the item's bar: the new name shows at once (shared clock
  // preset library, clock-preset-utils editClockPreset), before Home
  // Assistant publishes it.
  await page.locator(`${mine} .yc-item-rename`).click();
  const field = page.locator(
    "yeelight-cube-clock-card .yc-item-manage input",
  );
  assert.equal(await field.inputValue(), "Mine");
  await field.fill("Ours");
  await field.press("Enter");
  assert.deepEqual(await waitForCall("save_clock_preset", "rename"), {
    preset_id: "mine",
    name: "Ours",
    color: [10, 200, 30],
    kind: "style",
  });
  await page.waitForTimeout(50);
  assert.match(await label(), /Ours/, "rename: the new name shows at once");
  await publish([{ id: "mine", name: "Ours", color: [10, 200, 30], kind: "style" }]);
  assert.equal(
    await page.evaluate(() =>
      calls.some((call) => call.service === "set_clock_style"),
    ),
    false,
    "managing an item never applies it",
  );
  // Delete asks first and never selects the item; once confirmed the item
  // goes at once.
  await page.evaluate(() => (calls.length = 0));
  await page.locator(`${mine} .yc-item-delete`).click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => calls.length),
    0,
    "delete: nothing before confirming",
  );
  const bar = page.locator("yeelight-cube-clock-card .yc-item-manage");
  assert.match(await bar.innerText(), /Delete .Ours.\?/);
  await bar.locator('button:has-text("Delete")').click();
  assert.deepEqual(
    await waitForCall("delete_clock_preset", "confirmed delete"),
    { preset_id: "mine" },
  );
  await page.waitForTimeout(100);
  assert.equal(await bar.count(), 0, "the bar closes once deleted");
  assert.equal(await label(), null, "delete: the item goes at once");
  await publish([]);
  // The library back for the next checks.
  await publish([{ id: "mine", name: "Mine", kind: "style", color: [10, 200, 30] }]);
  // The shared delete-button settings: "none" hides it; rename stays off by default.
  await clockGrid({ remove_button_style: "none" });
  assert.deepEqual(
    await page.evaluate(() => {
      const node = card.shadowRoot.querySelector(
        'yc-collection-gallery .gallery-item[data-mode="custom:mine"]',
      );
      return [
        node.querySelectorAll(".yc-item-delete").length,
        node.querySelectorAll(".yc-item-rename").length,
      ];
    }),
    [0, 0],
  );
  await page.evaluate(() => {
    hass.states = { ...hass.states, "sensor.presets": window.savedPresets };
  });
};
