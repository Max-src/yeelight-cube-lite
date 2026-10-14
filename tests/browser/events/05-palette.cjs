// Card events check (tests/card-events-browser.cjs): the Palette card on the
// shared gallery.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, waitForCall, lamp } = t;
  // --- Palette card: the shared gallery with the card's own previews -------
  await page.evaluate(() => {
    window.savedPalettes = hass.states["sensor.pal"];
    hass.states = {
      ...hass.states,
      "sensor.pal": {
        state: "2",
        attributes: {
          palettes_v2: [
            {
              name: "Warm",
              colors: [
                [255, 0, 0],
                [255, 160, 0],
              ],
            },
            { name: "Sea", colors: [[0, 0, 255]] },
          ],
        },
      },
    };
    calls.length = 0;
  });
  const paletteCard = (extra) =>
    page.evaluate(
      (extra) =>
        mount("yeelight-cube-palette-card", {
          entity: "light.a",
          palette_sensor: "sensor.pal",
          ...extra,
        }),
      extra,
    );
  const paletteView = () =>
    page.evaluate(() => {
      const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
      return {
        previews: gallery.querySelectorAll(
          "[data-mode] yc-swatches.yc-palette-preview",
        ).length,
        dots: [...gallery.querySelectorAll("yc-swatches")].reduce(
          (sum, swatches) =>
            sum + swatches.shadowRoot.querySelectorAll(".sw").length,
          0,
        ),
        meta: [...gallery.querySelectorAll(".gallery-item-metadata")].map(
          (node) => node.textContent.trim(),
        ),
        grid: !!gallery.querySelector('.gc-preview-shell[data-columns="2"]'),
        border: gallery.dataset.itemBorder,
        radius: gallery.style.getPropertyValue("--yc-item-radius"),
        empty:
          gallery.querySelector(".yc-gallery-empty")?.textContent.trim() ||
          "",
      };
    });
  // Every preview layout shows the palettes' own swatches.
  for (const [style, shown] of [
    ["preview-list", 2],
    ["preview-grid", 2],
    ["preview-strip", 2],
    ["preview-carousel", 1],
    ["preview-wheel", 2],
    ["preview-album", 2],
  ]) {
    await paletteCard({
      style_selector_style: style,
      swatch_style: "square",
    });
    const look = await paletteView();
    assert.equal(look.previews, shown, `palette ${style}: previews`);
    assert.ok(look.dots >= shown, `palette ${style}: one swatch per color`);
  }
  // Former options: "gallery" display is the two-column grid; the color
  // count is the item's meta line; the former look (16 px cards with a
  // border) is kept.
  await paletteCard({ display_mode: "gallery", swatch_style: "gradient" });
  assert.deepEqual(await paletteView(), {
    previews: 2,
    dots: 0,
    meta: ["2 colors", "1 color"],
    grid: true,
    border: "true",
    radius: "16px",
    empty: "",
  });
  await paletteCard({
    show_color_count: false,
    item_card_border: "none",
    rounded_cards: 4,
  });
  const plain = await paletteView();
  assert.deepEqual(
    [plain.meta, plain.border, plain.radius],
    [[], "false", "4px"],
  );
  // Chips show each palette's blend.
  await paletteCard({ style_selector_style: "chips" });
  assert.match(
    await page.evaluate(
      () =>
        card.shadowRoot.querySelector(
          '.mode-chip[data-mode="palette:0"] .mode-chip-swatch',
        ).style.background,
    ),
    /linear-gradient/,
    "palette chips: the palette's colors",
  );
  // Items are keyboard buttons: Enter applies the palette.
  await paletteCard({ style_selector_style: "preview-list" });
  const sea =
    'yeelight-cube-palette-card yc-collection-gallery .gallery-item[data-mode="palette:1"]';
  assert.deepEqual(
    await page
      .locator(sea)
      .evaluate((node) => [
        node.getAttribute("role"),
        node.tabIndex,
        node.getAttribute("aria-label"),
      ]),
    ["button", 0, "Sea: Apply to the lamps"],
  );
  await page.locator(sea).focus();
  await page.keyboard.press("Enter");
  assert.deepEqual(await waitForCall("load_palette", "keyboard pick"), {
    entity_id: "light.a",
    idx: 1,
    expected_name: "Sea",
  });
  // Rename and delete through the shared bar (never by a single tap).
  await page.evaluate(() => (calls.length = 0));
  await paletteCard({
    style_selector_style: "preview-list",
    allow_rename: true,
  });
  const warm =
    'yeelight-cube-palette-card yc-collection-gallery .gallery-item[data-mode="palette:0"]';
  await page.locator(`${warm} .yc-item-rename`).click();
  const paletteField = page.locator(
    "yeelight-cube-palette-card .yc-item-manage input",
  );
  assert.equal(await paletteField.inputValue(), "Warm");
  await paletteField.fill("Hot");
  await paletteField.press("Enter");
  assert.deepEqual(await waitForCall("rename_palette", "palette rename"), {
    idx: 0,
    name: "Hot",
    expected_name: "Warm",
  });
  await page.locator(`${sea} .yc-item-delete`).click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() =>
      calls.some((call) => call.service === "remove_palette"),
    ),
    false,
    "palette delete: nothing before confirming",
  );
  await page
    .locator(
      'yeelight-cube-palette-card .yc-item-manage button:has-text("Delete")',
    )
    .click();
  assert.deepEqual(await waitForCall("remove_palette", "palette delete"), {
    idx: 1,
    expected_name: "Sea",
  });
  assert.equal(
    await page.evaluate(() =>
      calls.some((call) => call.service === "load_palette"),
    ),
    false,
    "managing a palette never applies it",
  );
  // The shared export / import row (Palette here, Draw below: the same).
  assert.deepEqual(
    await page.evaluate(() =>
      [
        ...card.shadowRoot.querySelectorAll(
          ".action-row button[data-action]",
        ),
      ].map((button) => [button.dataset.action, button.title]),
    ),
    [
      ["export", "Export palettes to a JSON file"],
      ["import", "Import palettes from a JSON file"],
    ],
  );
  // The palette the lamp shows is the active one (highlighted), following
  // the lamp; A → Z order (gallery_sort) sorts by the name shown.
  const paletteActive = await page.evaluate(async () => {
    await mount("yeelight-cube-palette-card", {
      entity: "light.a",
      palette_sensor: "sensor.pal",
      style_selector_style: "preview-list",
    });
    const shown = () =>
      [
        ...card.shadowRoot.querySelectorAll(
          'yc-collection-gallery [data-active-mode="true"]',
        ),
      ].map((node) => node.dataset.mode);
    const lamp = hass.states["light.a"];
    const showColors = async (text_colors) => {
      hass.states = {
        ...hass.states,
        "light.a": {
          ...lamp,
          attributes: { ...lamp.attributes, text_colors },
        },
      };
      card.hass = hass;
      await card.updateComplete;
      await card.shadowRoot.querySelector("yc-collection-gallery")
        .updateComplete;
    };
    await showColors([[0, 0, 255]]);
    const sea = shown();
    await showColors([
      [255, 0, 0],
      [255, 160, 0],
    ]);
    const warm = shown();
    await showColors([[1, 2, 3]]);
    const none = shown();
    hass.states = { ...hass.states, "light.a": lamp };
    card.setConfig({ ...card.config, gallery_sort: "name" });
    card.hass = hass;
    await card.updateComplete;
    await card.shadowRoot.querySelector("yc-collection-gallery")
      .updateComplete;
    const order = [
      ...card.shadowRoot.querySelectorAll(
        "yc-collection-gallery .gallery-item[data-mode]",
      ),
    ].map((node) => node.getAttribute("aria-label").split(":")[0]);
    return { sea, warm, none, order };
  });
  assert.deepEqual(paletteActive, {
    sea: ["palette:1"],
    warm: ["palette:0"],
    none: [],
    order: ["Sea", "Warm"],
  });
  // No palettes: the card says so.
  await page.evaluate(() => {
    hass.states = {
      ...hass.states,
      "sensor.pal": { state: "0", attributes: { palettes_v2: [] } },
    };
  });
  await paletteCard({});
  assert.match((await paletteView()).empty, /No palettes found/);
  await page.evaluate(() => {
    hass.states = { ...hass.states, "sensor.pal": window.savedPalettes };
  });
};
