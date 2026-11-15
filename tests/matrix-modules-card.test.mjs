// The Cube Matrix Modules card's model (www/matrix-modules-card-utils.js):
// the modules and power supply side a lamp reports, the card's edits, and
// the calls a save sends.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MODULES,
  isCubeMatrix,
  orientationForSupply,
  saveCalls,
  sameLayout,
  savedLayout,
  supplyForOrientation,
  withModuleAdded,
  withModuleRemoved,
} from "../custom_components/yeelight_cube/www/matrix-modules-card-utils.js";

// The owner's lamp, 2026-11-14: Matrix, Matrix, Spot, Matrix, mounted "right"
// (the base on the left).
const LAMP = {
  device_orientation: "right",
  matrix_module_list: ["matrix", "matrix", "spot", "matrix"],
  matrix_modules: [
    { type: "matrix", column: 0 },
    { type: "matrix", column: 5 },
    { type: "spot", after: 9, before: 10 },
    { type: "matrix", column: 10 },
  ],
};

test("a lamp's modules and power supply side", () => {
  assert.deepEqual(savedLayout(LAMP), { modules: ["matrix", "matrix", "spot", "matrix"], supply: "left" });
  // An older backend: the layout's types.
  const { matrix_module_list: _, ...older } = LAMP;
  assert.deepEqual(savedLayout(older).modules, ["matrix", "matrix", "spot", "matrix"]);
  assert.ok(isCubeMatrix(LAMP));
  assert.ok(!isCubeMatrix({ device_orientation: "right" }));
});

test("the power supply side is the opposite of the Device Orientation", () => {
  for (const [side, orientation] of [["left", "right"], ["right", "left"], ["down", "up"], ["up", "down"]]) {
    assert.equal(orientationForSupply(side), orientation);
    assert.equal(supplyForOrientation(orientation), side);
  }
  assert.equal(supplyForOrientation(undefined), "left");
});

test("modules are added at the end, up to six, and removed anywhere", () => {
  let layout = savedLayout(LAMP);
  layout = withModuleAdded(layout, "panel");
  assert.deepEqual(layout.modules.at(-1), "panel");
  layout = withModuleAdded(withModuleAdded(layout, "matrix"), "matrix");
  assert.equal(layout.modules.length, MAX_MODULES);
  assert.equal(withModuleAdded(layout, "spot"), layout);
  assert.equal(withModuleAdded(savedLayout(LAMP), "lamp").modules.length, 4);
  assert.deepEqual(withModuleRemoved(savedLayout(LAMP), 2).modules, ["matrix", "matrix", "matrix"]);
});

test("a save sends what changed: the modules, then the power supply side", () => {
  const saved = savedLayout(LAMP);
  assert.deepEqual(saveCalls("light.m", saved, saved), []);
  assert.ok(sameLayout(saved, { ...saved, modules: [...saved.modules] }));
  const draft = { modules: ["matrix", "matrix", "matrix", "matrix"], supply: "down" };
  assert.deepEqual(saveCalls("light.m", saved, draft), [
    { service: "set_matrix_modules", data: { entity_id: "light.m", modules: ["matrix", "matrix", "matrix", "matrix"] } },
    { service: "set_device_orientation", data: { entity_id: "light.m", orientation: "up" } },
  ]);
  // No modules: never sent (a lamp has at least one).
  assert.deepEqual(saveCalls("light.m", saved, { modules: [], supply: "left" }), []);
});
