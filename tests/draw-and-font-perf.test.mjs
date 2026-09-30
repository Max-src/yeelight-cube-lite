import assert from "node:assert/strict";
import test from "node:test";

// draw_card_storage writes to localStorage: count the writes.
const writes = [];
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => {
    writes.push(key);
    store.set(key, value);
  },
  removeItem: (key) => store.delete(key),
};
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

const { StorageUtils } = await import(
  "../custom_components/yeelight_cube/www/draw_card_storage.js"
);
const { MatrixOperations1D } = await import(
  "../custom_components/yeelight_cube/www/draw_card_matrix_1d.js"
);
const { lookupNativeClockFont } = await import(
  "../custom_components/yeelight_cube/www/clock-preview-utils.js"
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a drag over many cells writes the drawing once, after it pauses", async () => {
  writes.length = 0;
  const card = {
    matrix: Array(100).fill("#000000"),
    selectedColor: "#ff0000",
    recentColors: [],
    _drawingActive: true,
    requestUpdate() {},
  };
  const ops = new MatrixOperations1D(card);
  for (let idx = 0; idx < 20; idx++) ops.setPixel(idx);
  // Unchanged cells (dragging back over them) change nothing at all.
  const matrix = card.matrix;
  ops.setPixel(3);
  assert.equal(card.matrix, matrix);
  // Recent colours: written once for the stroke, not per cell.
  assert.equal(writes.filter((key) => key.includes("recent")).length, 1);
  // The grid itself: not yet, then once.
  assert.equal(writes.filter((key) => key.includes("matrix")).length, 0);
  assert.equal(StorageUtils.loadMatrix()[19], "#ff0000"); // pending counts
  await wait(400);
  assert.equal(writes.filter((key) => key.includes("matrix")).length, 1);
  assert.equal(JSON.parse(store.get([...store.keys()].find((k) => k.includes("matrix"))))[19], "#ff0000");
  // Erasing a black cell is also a no-op.
  const before = card.matrix;
  ops.erasePixel(null, 50);
  assert.equal(card.matrix, before);
});

test("a pending drawing is written at once when flushed (page hidden/closed)", () => {
  writes.length = 0;
  StorageUtils.saveMatrix(Array(100).fill("#00ff00"));
  assert.equal(writes.length, 0);
  StorageUtils.flushMatrix();
  assert.equal(writes.length, 1);
  StorageUtils.flushMatrix(); // nothing pending
  assert.equal(writes.length, 1);
});

test("the clock font sensor is found once, then read directly", () => {
  const font = { attributes: { font_maps: { native: { A: 1 } }, font_metrics: { native: { w: 3 } } } };
  let scans = 0;
  const statesWith = (extra) =>
    new Proxy(
      { "light.a": { attributes: {} }, "sensor.font": font, ...extra },
      {
        ownKeys(target) {
          scans++;
          return Reflect.ownKeys(target);
        },
      },
    );
  let cache = lookupNativeClockFont(statesWith(), null);
  assert.deepEqual(cache.font, { fontMap: { A: 1 }, metrics: { w: 3 } });
  assert.equal(scans, 1);
  // Every other state change: a new states object, no new scan.
  for (let i = 0; i < 5; i++) cache = lookupNativeClockFont(statesWith({ [`x.${i}`]: {} }), cache);
  assert.equal(scans, 1);
  assert.equal(cache.entityId, "sensor.font");
  // The sensor is gone: scan again, and report no font.
  cache = lookupNativeClockFont({ "light.a": { attributes: {} } }, cache);
  assert.deepEqual(cache.font, { fontMap: null, metrics: null });
});
