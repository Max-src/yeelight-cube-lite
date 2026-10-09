import test from "node:test";
import assert from "node:assert/strict";

const {
  USER_COLLECTIONS,
  CollectionStore,
  collectionItems,
  collectionThumbnail,
  singleMove,
} = await import("../custom_components/yeelight_cube/www/user-collections.js");
const { pixelArtColorData, pixelArtDisplayIndex } = await import(
  "../custom_components/yeelight_cube/www/pixel-art-utils.js"
);

const items = ["A", "B", "C", "D"].map((name) => ({ name }));

test("one drag or arrow press becomes one guarded move", () => {
  // Drag D to the top, A to the end, and an arrow swap.
  assert.deepEqual(singleMove([3, 0, 1, 2], items), {
    from_idx: 3,
    to_idx: 0,
    expected_name: "D",
  });
  assert.deepEqual(singleMove([1, 2, 3, 0], items), {
    from_idx: 0,
    to_idx: 3,
    expected_name: "A",
  });
  assert.deepEqual(singleMove([0, 2, 1, 3], items), {
    from_idx: 2,
    to_idx: 1,
    expected_name: "C",
  });
  // No change, or more than one item moved: not a single move.
  assert.equal(singleMove([0, 1, 2, 3], items), null);
  assert.equal(singleMove([1, 0, 3, 2], items), null);
});

test("collections are read from their sensor, with its count", () => {
  const hass = {
    states: {
      "sensor.yeelight_cube_color_palettes": {
        attributes: { count: 1, palettes_v2: items.slice(0, 2) },
      },
      "sensor.art": { attributes: { pixel_arts: items } },
    },
  };
  // Found without a configured sensor; the array may be ahead of the count.
  assert.deepEqual(collectionItems(hass, {}, "palettes"), {
    items: items.slice(0, 2),
    count: 1,
  });
  assert.deepEqual(
    collectionItems(hass, { pixelart_sensor: "sensor.art" }, "pixel_arts"),
    { items, count: 4 },
  );
  assert.deepEqual(collectionItems({ states: {} }, {}, "pixel_arts"), {
    items: [],
    count: 0,
  });
  assert.deepEqual(
    Object.values(USER_COLLECTIONS).map((kind) => kind.moveService),
    ["move_palette", "move_pixel_art"],
  );
});

test("thumbnails: a palette's blend, a pixel art's picture", () => {
  assert.match(
    collectionThumbnail("palettes", { colors: [[255, 0, 0]] }),
    /background:linear-gradient\(to right, rgb\(255,0,0\), rgb\(255,0,0\)\)/,
  );
  const colors = pixelArtColorData({
    pixels: [
      { position: [1, 99], color: [1, 2, 3] },
      { position: 120, color: [9, 9, 9] },
    ],
  });
  assert.equal(colors.length, 100);
  // Stored rows count from the lamp's bottom row; previews draw top first:
  // position 1 (bottom row) is shown at 81, position 99 (top row) at 19.
  assert.deepEqual(
    [colors[1], colors[81], colors[19], colors[99]],
    [[0, 0, 0], [1, 2, 3], [1, 2, 3], [0, 0, 0]],
  );
});

test("pixel-art positions: lamp rows from the bottom, previews from the top", () => {
  assert.deepEqual([0, 19, 20, 99].map(pixelArtDisplayIndex), [80, 99, 60, 19]);
});

// A Home Assistant whose sensor state and REST answers the test controls.
function storeHass(attributes, rest = []) {
  return {
    states: { "sensor.pal": { state: "1", attributes } },
    callApi: async () => ({ attributes: rest.shift() ?? attributes }),
    callService: async () => {},
  };
}

test("the store fetches a new content's array before showing it", async () => {
  const config = { palette_sensor: "sensor.pal" };
  // The state announces new content but still carries the old array.
  const hass = storeHass(
    { count: 1, content_hash: "new", palettes_v2: [{ name: "Old" }] },
    [{ count: 1, content_hash: "new", palettes_v2: [{ name: "New" }] }],
  );
  const renders = [];
  const store = new CollectionStore("palettes", { onChange: () => renders.push(1) });
  assert.equal(store.update(hass, config), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(store.items(hass, config), [{ name: "New" }]);
  assert.equal(renders.length, 1);
  // The same content again: nothing to do.
  assert.equal(store.update(hass, config), false);
});

test("the store waits for the content it expects, then a sensor without hash", async () => {
  const config = { palette_sensor: "sensor.pal" };
  const hass = storeHass({ count: 1, content_hash: "a", palettes_v2: [{ name: "A" }] }, [
    { count: 1, content_hash: "a", palettes_v2: [{ name: "A" }] },
    { count: 1, content_hash: "b", palettes_v2: [{ name: "B" }] },
  ]);
  const store = new CollectionStore("palettes");
  store.update(hass, config);
  const fetched = await store.fetch(hass, "sensor.pal", (items) => items[0].name === "B");
  assert.equal(fetched, true);
  assert.deepEqual(store.items(hass, config), [{ name: "B" }]);
  // Without content_hash, contents are told apart by their count.
  const plain = storeHass({ count: 2, palettes_v2: [{ name: "X" }, { name: "Y" }] });
  const counted = new CollectionStore("palettes");
  counted.update(plain, config);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(counted.lastHash, "count:2");
  assert.deepEqual(counted.items(plain, config).map((item) => item.name), ["X", "Y"]);
});

test("the store shows an edit at once and rolls back a refused one", async () => {
  const config = { palette_sensor: "sensor.pal" };
  const hass = storeHass({ count: 2, content_hash: "h", palettes_v2: [{ name: "A" }, { name: "B" }] });
  const store = new CollectionStore("palettes");
  store.update(hass, config);
  let fail;
  hass.callService = () => new Promise((_, reject) => (fail = reject));
  const errors = [];
  const saving = store.edit(hass, [{ name: "B" }], "remove_palette", { idx: 0 }, {
    onError: (error) => errors.push(error.message),
  });
  assert.deepEqual(store.items(hass, config), [{ name: "B" }]);
  await Promise.resolve();
  fail(new Error("refused"));
  assert.equal(await saving, false);
  assert.deepEqual(store.items(hass, config).map((item) => item.name), ["A", "B"]);
  assert.deepEqual(errors, ["refused"]);
});
