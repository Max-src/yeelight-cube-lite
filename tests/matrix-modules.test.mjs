// A Cube Matrix's modules in the lamp preview (www/matrix-modules.js): the
// columns it shows and its spots, from the light's matrix_modules /
// matrix_columns (device_profile.layout, columns).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cssRgb,
  shownColumns,
  shownMask,
  spotColours,
  spotPlaces,
  spotsOf,
} from "../custom_components/yeelight_cube/www/matrix-modules.js";
import { matrixView, toDisplayOrder, viewerFrame } from "../custom_components/yeelight_cube/www/matrix-view.js";

// The owner's lamp, 2026-11-14: Matrix, Matrix, Spot, Matrix (topology
// 2,2,3,2). The spot takes a block's place: one light for columns 10-14.
const SPOT_THIRD = {
  matrix_columns: 20,
  matrix_modules: [
    { type: "matrix", column: 0 },
    { type: "matrix", column: 5 },
    { type: "spot", column: 10 },
    { type: "matrix", column: 15 },
  ],
};
const display = (orientation) => {
  const view = matrixView(orientation === "up" || orientation === "down");
  return { view, display: (frame) => toDisplayOrder(viewerFrame(frame, orientation), view.vertical) };
};

test("a Cube Lite, or a Cube Matrix with 4 blocks, shows all 20 columns and no spot", () => {
  assert.equal(shownColumns({}), 20);
  assert.equal(shownColumns({ matrix_columns: 20 }), 20);
  assert.deepEqual(spotsOf({}), []);
  assert.ok(shownMask({}).every(Boolean));
});

test("three blocks and a spot: all 20 columns, the spot one light for columns 10-14", () => {
  assert.equal(shownColumns(SPOT_THIRD), 20);
  const mask = shownMask(SPOT_THIRD);
  assert.equal(mask.filter(Boolean).length, 75); // the spot's 25 are one light
  assert.equal(mask[9], true);
  assert.equal(mask[10], false);
  assert.equal(mask[14], false);
  assert.equal(mask[15], true);
  assert.deepEqual(spotsOf(SPOT_THIRD), [{ column: 10 }]);
  // Two blocks: 10 columns, the rest absent.
  const two = { matrix_columns: 10, matrix_modules: [{ type: "matrix", column: 0 }, { type: "matrix", column: 5 }] };
  assert.equal(shownMask(two).filter(Boolean).length, 50);
});

test("a spot shows its columns' colour as bright as their brightest, as the integration sends it", () => {
  const colors = Array.from({ length: 100 }, (_, index) => {
    const column = index % 20;
    return column === 11 ? "rgb(200, 0, 0)" : column === 13 ? "#0000c8" : "#000000";
  });
  assert.deepEqual(spotColours(colors, SPOT_THIRD), [[200, 0, 200]]);
  const one = Array.from({ length: 100 }, (_, index) => (index === 2 * 20 + 12 ? "rgb(255, 120, 0)" : "#000000"));
  assert.deepEqual(spotColours(one, SPOT_THIRD), [[255, 120, 0]]);
  assert.deepEqual(cssRgb("#0a0b0c"), [10, 11, 12]);
  assert.deepEqual(cssRgb("rgb(1, 2, 3)"), [1, 2, 3]);
});

test("the spot sits at the centre of its area whatever the orientation", () => {
  // Lying flat (right): column 12's centre, mid-height.
  const flat = display("right");
  const [place] = spotPlaces(SPOT_THIRD, flat.display, flat.view.cols, flat.view.rows);
  assert.equal(place.x, 12.5 / 20);
  assert.equal(place.y, 0.5);
  // Standing (up): the chain runs vertically, the spot mid-width.
  const standing = display("up");
  const [upright] = spotPlaces(SPOT_THIRD, standing.display, standing.view.cols, standing.view.rows);
  assert.equal(upright.x, 0.5);
  assert.ok(Math.abs(upright.y - 7.5 / 20) < 1e-9);
});


// 2026-11-15: the owner set Matrix + Spot on the lamp: every preview shows
// those two modules only (10 columns), the spot one round light.
const MATRIX_SPOT = {
  matrix_columns: 10,
  matrix_modules: [{ type: "matrix", column: 0 }, { type: "spot", column: 5 }],
  device_orientation: "right",
};

test("a preview grid is the lamp's modules: their columns, a spot one cell over its area", async () => {
  const { moduleGrid, placeStyle, moduleKey } = await import("../custom_components/yeelight_cube/www/matrix-modules.js");
  assert.equal(moduleGrid({}), null); // a Cube Lite: the whole frame
  assert.equal(moduleGrid({ matrix_columns: 20, matrix_modules: [] }), null);
  const flat = moduleGrid(MATRIX_SPOT, false);
  assert.deepEqual([flat.cols, flat.rows, flat.columns], [10, 5, 10]);
  assert.equal(flat.place.filter(Boolean).length, 26); // 25 pixels and the spot
  assert.deepEqual(flat.place[0], { column: 1, row: 1, span: 1, spot: false });
  assert.deepEqual(flat.place[2 * 20 + 7], { column: 6, row: 1, span: 5, spot: true });
  assert.equal(flat.place[10], null); // past the modules
  assert.equal(flat.place[5], null); // the spot's area, but its middle
  assert.equal(placeStyle(null), "display:none;");
  assert.match(placeStyle(flat.place[47]), /grid-column:6 \/ span 5;grid-row:1 \/ span 5;border-radius:50%/);
  assert.equal(placeStyle(undefined), "");
  // Standing: 5 wide, 10 tall, the base end on top.
  const standing = moduleGrid({ ...MATRIX_SPOT, device_orientation: "down" }, true);
  assert.deepEqual([standing.cols, standing.rows], [5, 10]);
  assert.deepEqual(standing.place[2 * 20 + 7], { column: 1, row: 6, span: 5, spot: true });
  // Upside down (left): the viewer sees the modules at the right end.
  const turned = moduleGrid({ ...MATRIX_SPOT, device_orientation: "left" }, false);
  assert.equal(turned.place[0], null);
  assert.deepEqual(turned.place[19], { column: 10, row: 1, span: 1, spot: false });
  assert.deepEqual(turned.place[2 * 20 + 12], { column: 1, row: 1, span: 5, spot: true });
  assert.notEqual(moduleKey(MATRIX_SPOT), moduleKey(SPOT_THIRD));
});

test("the spot's cell shows its area as one light, again and again the same", async () => {
  const { withSpotColours } = await import("../custom_components/yeelight_cube/www/matrix-modules.js");
  const frame = Array.from({ length: 100 }, (_, index) => (index === 3 * 20 + 6 ? [0, 200, 0] : [0, 0, 0]));
  const once = withSpotColours(frame, MATRIX_SPOT, "lamp");
  assert.deepEqual(once[2 * 20 + 7], [0, 200, 0]);
  assert.deepEqual(withSpotColours(once, MATRIX_SPOT, "lamp"), once);
  assert.equal(withSpotColours(frame, {}, "lamp"), frame); // no spot: as it is
  const css = frame.map((rgb) => `rgb(${rgb.join(", ")})`);
  assert.equal(withSpotColours(css, MATRIX_SPOT, "lamp")[47], "rgb(0, 200, 0)");
});

test("a shared preview is laid out as the lamp's modules", async () => {
  const { matrixPreviewLayout } = await import("../custom_components/yeelight_cube/www/gallery-display-utils.js");
  const { previewContext } = await import("../custom_components/yeelight_cube/www/preview-context.js");
  const frame = Array.from({ length: 100 }, () => [10, 20, 30]);
  const whole = matrixPreviewLayout(frame, { previewSize: 200 });
  assert.equal(whole.places.length, 0);
  const layout = matrixPreviewLayout(frame, { previewSize: 200, context: previewContext(MATRIX_SPOT) });
  assert.match(layout.gridStyle, /grid-template-columns:repeat\(10,1fr\)/);
  assert.match(layout.wrapperStyle, /width: 100px;/);
  assert.equal(layout.places.filter(Boolean).length, 26);
});
