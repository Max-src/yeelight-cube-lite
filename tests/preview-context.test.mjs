// The one preview context every preview of a lamp draws for
// (www/preview-context.js): its mount, its modules and its effect settings.
import { test } from "node:test";
import assert from "node:assert/strict";

const www = "../custom_components/yeelight_cube/www/";
const { previewContext, contextGrid } = await import(`${www}preview-context.js`);
const { moduleGrid } = await import(`${www}matrix-modules.js`);
const { nativeEffectFrame, nativeEffectLampFrame } = await import(`${www}native-effect-card-utils.js`);
const { renderNativeEffect } = await import(`${www}native-effect-preview.js`);
const { effectDisplayFrame } = await import(`${www}lamp-renderers.js`);
const { viewerFrame } = await import(`${www}matrix-view.js`);

// A Cube Matrix of a block and a spot: 10 columns, one light for 5-9.
const MATRIX_SPOT = {
  matrix_columns: 10,
  matrix_modules: [{ type: "matrix", column: 0 }, { type: "spot", column: 5 }],
  device_orientation: "right",
  native_effect_speed: 0,
  native_effect_intensity: 300,
  native_effect_direction: "Left",
};

test("a Cube Lite (or no lamp): all 20 columns, no module grid, the defaults", () => {
  for (const attrs of [undefined, {}, { device_orientation: "right" }]) {
    const context = previewContext(attrs);
    assert.equal(context.columns, 20);
    assert.equal(context.length, 100);
    assert.equal(context.grid, null);
    assert.deepEqual(context.spots, []);
    assert.equal(context.modules, null);
    assert.equal(context.orientation, "right");
    assert.equal(context.vertical, false);
    assert.equal(context.upsideDown, false);
    assert.equal(context.colorMode, "normal");
    assert.equal(context.frame, "viewer");
    assert.equal(context.moduleKey, "");
  }
  assert.equal(previewContext().speed, previewContext({}).speed);
});

test("a Cube Matrix with a spot: 10 columns, its grid, the speed and intensity in the lamp's range", () => {
  const context = previewContext(MATRIX_SPOT);
  assert.equal(context.columns, 10);
  assert.equal(context.length, 50);
  assert.deepEqual(context.spots, [{ column: 5 }]);
  assert.equal(context.modules, MATRIX_SPOT.matrix_modules);
  assert.deepEqual(context.grid, moduleGrid(MATRIX_SPOT, false, "viewer"));
  assert.equal(context.grid.cols, 10);
  assert.equal(context.lamp, MATRIX_SPOT); // its own orientation: the attributes as they are
  // 0 is a speed (the lamp's range is 0-255), an intensity past it is clamped.
  assert.equal(context.speed, 0);
  assert.equal(context.intensity, 255);
  assert.equal(context.direction, "Left");
  // A preview drawn standing up reads the grid for that view.
  assert.deepEqual(contextGrid(context, true), moduleGrid(MATRIX_SPOT, true, "viewer"));
});

test("standing and upside down: the mount chosen wins over the reported one", () => {
  const standing = previewContext(MATRIX_SPOT, { pendingOrientation: "up" });
  assert.equal(standing.orientation, "up");
  assert.equal(standing.vertical, true);
  assert.equal(standing.lamp.device_orientation, "up");
  assert.equal(standing.grid.cols, 5);
  assert.equal(standing.grid.rows, 10);
  const upsideDown = previewContext({ ...MATRIX_SPOT, device_orientation: "left" });
  assert.equal(upsideDown.upsideDown, true);
  assert.equal(upsideDown.vertical, false);
  // Upside down, the viewer sees the lamp's first columns on the right.
  assert.deepEqual(upsideDown.grid, moduleGrid({ ...MATRIX_SPOT, device_orientation: "left" }));
  assert.equal(upsideDown.grid.place[0], null);
  assert.notEqual(upsideDown.grid.place[19], null);
  const drawing = previewContext(upsideDown.attrs, { frame: "drawing" });
  // A picture before the turn: the modules from its left edge, the spot
  // (the lamp's columns 5-9) first.
  assert.equal(drawing.frame, "drawing");
  assert.equal(drawing.grid.place[2 * 20 + 2].spot, true);
  assert.equal(drawing.grid.place[5].spot, false);
  assert.equal(drawing.grid.place[10], null);
});

test("the same inputs give the same context", () => {
  assert.equal(previewContext(MATRIX_SPOT), previewContext(MATRIX_SPOT));
  assert.equal(
    previewContext(MATRIX_SPOT, { pendingOrientation: "up" }),
    previewContext(MATRIX_SPOT, { pendingOrientation: "up" }),
  );
  assert.notEqual(previewContext(MATRIX_SPOT), previewContext({ ...MATRIX_SPOT }));
  assert.ok(Object.isFrozen(previewContext(MATRIX_SPOT)));
});

test("an effect frame from the context: the lamp's settings, on the columns it shows", () => {
  const attrs = { ...MATRIX_SPOT, native_effect_speed: 90, native_effect_direction: "Right" };
  const effect = { name: "Rainbow", directions: ["Up", "Down", "Left", "Right"] };
  const lamp = nativeEffectLampFrame(effect, previewContext(attrs), 1.5);
  const phase = 1.5 * (0.25 + 90 / 55);
  const expected = effectDisplayFrame(
    "Rainbow",
    renderNativeEffect("Rainbow", phase, "Right", null, "normal", 90, "right", null, undefined, undefined, undefined, null, 10),
  );
  assert.deepEqual(lamp, expected);
  // Columns 10-19 are past the lamp's modules: dark.
  for (let index = 0; index < 100; index++) if (index % 20 >= 10) assert.deepEqual(lamp[index].slice(0, 3), [0, 0, 0]);
  // The card's frame: the same, as the viewer sees it.
  const shown = nativeEffectFrame(effect, attrs, 1.5);
  const viewed = viewerFrame(lamp, "right");
  for (let index = 0; index < 100; index++)
    if (index % 20 < 5) assert.deepEqual(shown[index], viewed[index]);
});
