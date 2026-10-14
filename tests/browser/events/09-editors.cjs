// Card events check (tests/card-events-browser.cjs): the editors: Arrange,
// the album settings.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  // --- Arrange: the user collections' order, one block in every editor -----
  await page.evaluate(() => {
    window.savedCollections = [
      hass.states["sensor.pal"],
      hass.states["sensor.pixel"],
    ];
    hass.states = {
      ...hass.states,
      "sensor.pal": {
        state: "3",
        attributes: {
          count: 3,
          palettes_v2: [
            {
              name: "Warm",
              colors: [
                [255, 0, 0],
                [255, 160, 0],
              ],
            },
            { name: "Sea", colors: [[0, 0, 255]] },
            { name: "<b>Bold</b>", colors: [[0, 255, 0]] },
          ],
        },
      },
      "sensor.pixel": {
        state: "2",
        attributes: {
          count: 2,
          pixel_arts: [
            { name: "Heart", pixels: [{ position: 3, color: [255, 0, 0] }] },
            {
              name: "Star",
              pixels: [{ position: [7, 8], color: [255, 255, 0] }],
            },
          ],
        },
      },
    };
  });
  const arrange = (tag, config) =>
    page.evaluate(
      async ({ tag, config }) => {
        calls.length = 0;
        const editor = await customElements.get(tag).getConfigElement();
        editor.hass = hass;
        editor.setConfig({
          type: `custom:${tag}`,
          entity: "light.a",
          ...config,
        });
        document.querySelector("main").replaceChildren(editor);
        await editor.updateComplete;
        for (const section of editor.shadowRoot.querySelectorAll(
          ".editor-card-header",
        )) {
          section.click();
          await editor.updateComplete;
        }
        const rows = () =>
          [
            ...editor.shadowRoot.querySelectorAll(".orderable-list-row"),
          ].filter((row) => row.querySelector(".collection-thumb"));
        const names = () =>
          rows().map((row) =>
            row.querySelector(".orderable-list-name").textContent.trim(),
          );
        const before = names();
        const list = rows()[0].parentElement;
        const shape = {
          remove: rows().some((row) => row.querySelector("button.remove")),
          add:
            list.nextElementSibling?.classList.contains(
              "orderable-add-row",
            ) ?? false,
          matrix:
            rows()[0].querySelector(
              ".collection-thumb .gallery-matrix-preview",
            )?.children.length ?? 0,
          injected: !!editor.shadowRoot.querySelector(
            ".orderable-list-row b",
          ),
          // Every row shown (the editor scrolls, not the list).
          full: getComputedStyle(list).maxHeight === "none",
        };
        rows()[0]
          .querySelector(`button[title="${config.button || "Move down"}"]`)
          .click();
        await editor.updateComplete;
        return {
          before,
          after: names(),
          shape,
          calls: calls.map(({ service, data }) => ({ service, data })),
        };
      },
      { tag, config },
    );
  const paletteArrange = await arrange("yeelight-cube-palette-card", {
    palette_sensor: "sensor.pal",
  });
  assert.deepEqual(
    paletteArrange.before,
    ["Warm", "Sea", "<b>Bold</b>"],
    "palettes listed in stored order",
  );
  assert.deepEqual(
    paletteArrange.shape,
    { remove: false, add: false, matrix: 0, injected: false, full: true },
    "arrange: order only, names as text, every row shown",
  );
  assert.deepEqual(
    paletteArrange.after,
    ["Sea", "Warm", "<b>Bold</b>"],
    "the move shows at once",
  );
  assert.deepEqual(paletteArrange.calls, [
    // ▼ swaps two neighbours: one move (the same result either way).
    {
      service: "move_palette",
      data: { from_idx: 1, to_idx: 0, expected_name: "Sea" },
    },
  ]);
  // ⤓ moves an item to the bottom in one guarded move.
  const toBottom = await arrange("yeelight-cube-palette-card", {
    palette_sensor: "sensor.pal",
    button: "Move to the bottom",
  });
  assert.deepEqual(toBottom.after, ["Sea", "<b>Bold</b>", "Warm"]);
  assert.deepEqual(toBottom.calls, [
    {
      service: "move_palette",
      data: { from_idx: 0, to_idx: 2, expected_name: "Warm" },
    },
  ]);
  const pixelArrange = await arrange("yeelight-cube-draw-card", {
    pixelart_sensor: "sensor.pixel",
  });
  assert.deepEqual(
    pixelArrange.before,
    ["Heart", "Star"],
    "pixel arts listed in stored order",
  );
  assert.equal(
    pixelArrange.shape.matrix,
    100,
    "pixel-art rows show their picture",
  );
  assert.deepEqual(pixelArrange.after, ["Star", "Heart"]);
  assert.deepEqual(pixelArrange.calls, [
    {
      service: "move_pixel_art",
      data: { from_idx: 1, to_idx: 0, expected_name: "Star" },
    },
  ]);
  await page.evaluate(() => {
    const [pal, pixel] = window.savedCollections;
    hass.states = {
      ...hass.states,
      "sensor.pal": pal,
      "sensor.pixel": pixel,
    };
  });

  // --- Album settings reach the shared, static album CSS ------------------
  // (album-view-coverflow.js albumStyleVars: CSS variables on the album wrapper).
  const albumLook = (tag, config, prefix) =>
    page.evaluate(
      async ({ tag, config, prefix }) => {
        await mount(tag, config);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const root = card.shadowRoot;
        const item = getComputedStyle(
          root.querySelector(`.${prefix}-album-item`),
        );
        const box = getComputedStyle(
          root.querySelector(`.${prefix}-album-container`),
        );
        return {
          width: item.width,
          radius: item.borderTopLeftRadius,
          padding: box.padding,
          perspective: box.perspective,
        };
      },
      { tag, config, prefix },
    );
  const tuned = {
    rounded_cards: "square",
    delete_button_inside: true,
    album_3d_effect: false,
    remove_button_style: "red",
  };
  assert.deepEqual(
    await albumLook(
      "yeelight-cube-palette-card",
      {
        entity: "light.a",
        palette_sensor: "sensor.pal",
        display_mode: "album",
      },
      "collection",
    ),
    // The shared album at the palette's default Size (50%) and its former
    // 16 px card roundness (custom item radius).
    {
      width: "218px",
      radius: "16px",
      padding: "28px 14px",
      perspective: "1200px",
    },
    "palette album defaults",
  );
  assert.deepEqual(
    // Former palette options, migrated to the shared gallery's (the Size
    // stays within its 30-100% range; delete buttons sit on the items).
    await albumLook(
      "yeelight-cube-palette-card",
      {
        entity: "light.a",
        palette_sensor: "sensor.pal",
        display_mode: "album",
        card_size: 150,
        ...tuned,
      },
      "collection",
    ),
    {
      width: "437px",
      radius: "0px",
      padding: "28px 14px",
      perspective: "none",
    },
    "palette album settings",
  );
  assert.deepEqual(
    await albumLook(
      "yeelight-cube-draw-card",
      {
        entity: "light.a",
        pixelart_sensor: "sensor.pixel",
        pixel_art_gallery_mode: "album",
      },
      "collection",
    ),
    {
      width: "240px",
      radius: "16px",
      padding: "28px 14px",
      perspective: "1200px",
    },
    "pixel-art album defaults",
  );
  assert.deepEqual(
    // The former album size (240 px at 100%; 150 -> 82% of the shared
    // Size), delete buttons on the items.
    await albumLook(
      "yeelight-cube-draw-card",
      {
        entity: "light.a",
        pixelart_sensor: "sensor.pixel",
        pixel_art_gallery_mode: "album",
        pixel_art_preview_size: 150,
        ...tuned,
      },
      "collection",
    ),
    {
      width: "362px",
      radius: "0px",
      padding: "28px 14px",
      perspective: "none",
    },
    "pixel-art album settings",
  );
};
