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
  assert.deepEqual(flat.place[2 * 20 + 7], {
    column: 6, row: 1, span: 5, spot: true, module: "spot", pixels: [2 * 20 + 7],
  });
  assert.equal(flat.place[10], null); // past the modules
  assert.equal(flat.place[5], null); // the spot's area, but its middle
  assert.equal(placeStyle(null), "display:none;");
  assert.equal(
    placeStyle(flat.place[47]),
    "grid-column:6 / span 5;grid-row:1 / span 5;aspect-ratio:1/1;border-radius:var(--yc-module-radius,0);",
  );
  assert.equal(placeStyle(flat.place[0]), "grid-column:1;grid-row:1;");
  assert.equal(placeStyle(undefined), "");
  // Standing: 5 wide, 10 tall, the base end on top.
  const standing = moduleGrid({ ...MATRIX_SPOT, device_orientation: "down" }, true);
  assert.deepEqual([standing.cols, standing.rows], [5, 10]);
  assert.deepEqual(standing.place[2 * 20 + 7], {
    column: 1, row: 6, span: 5, spot: true, module: "spot", pixels: [2 * 20 + 7],
  });
  // Upside down (left): the viewer sees the modules at the right end.
  const turned = moduleGrid({ ...MATRIX_SPOT, device_orientation: "left" }, false);
  assert.equal(turned.place[0], null);
  assert.deepEqual(turned.place[19], { column: 10, row: 1, span: 1, spot: false });
  assert.deepEqual(turned.place[2 * 20 + 12], {
    column: 1, row: 1, span: 5, spot: true, module: "spot", pixels: [2 * 20 + 12],
  });
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

// The owner's lamp (filmed 2026-11-21): three Matrix modules, the spot, the
// panel at the end of the chain.
const OWNER = {
  matrix_columns: 25,
  matrix_modules: [
    { type: "matrix", column: 0 },
    { type: "matrix", column: 5 },
    { type: "matrix", column: 10 },
    { type: "spot", column: 15 },
    { type: "panel", column: 20 },
  ],
  device_orientation: "right",
};

test("a panel is one cell over its area, naming its 25 pixels as shown, whatever the mount", async () => {
  const { moduleGrid, placeAttributes, placeStyle } = await import("../custom_components/yeelight_cube/www/matrix-modules.js");
  const flat = moduleGrid(OWNER, false);
  const panel = flat.place[2 * 25 + 22];
  assert.deepEqual([panel.column, panel.row, panel.span, panel.module], [21, 1, 5, "panel"]);
  // Row by row: frame row r, columns 20-24.
  assert.deepEqual(panel.pixels, Array.from({ length: 25 }, (_, at) => Math.floor(at / 5) * 25 + 20 + (at % 5)));
  assert.equal(flat.place.filter(Boolean).length, 15 * 5 + 2);
  assert.match(placeStyle(panel), /span 5;.*background-blend-mode:lighten;/);
  assert.equal(placeAttributes(panel), ` data-module="panel" data-pixels="${panel.pixels.join(",")}"`);
  assert.equal(placeAttributes(flat.place[0]), "");
  // Standing (down): turned a quarter turn clockwise, the base end on top:
  // the panel the last 5 rows, the frame's bottom row its left column.
  const standing = moduleGrid({ ...OWNER, device_orientation: "down" }, true);
  const upright = standing.place[2 * 25 + 22];
  assert.deepEqual([upright.column, upright.row], [1, 21]);
  assert.equal(upright.pixels[0], 4 * 25 + 20); // top left: bottom row, column 20
  assert.equal(upright.pixels[4], 20); // top right: top row, column 20
  assert.equal(upright.pixels[20], 4 * 25 + 24);
  // Upside down (left): the viewer frame turned a half turn, the panel at
  // its start.
  const turned = moduleGrid({ ...OWNER, device_orientation: "left" }, false);
  const flipped = turned.place[2 * 25 + 2];
  assert.equal(flipped.module, "panel");
  assert.deepEqual([flipped.column, flipped.row], [1, 1]);
  assert.deepEqual(flipped.pixels.slice(0, 5), [0, 1, 2, 3, 4]);
  // Four Matrix modules: the whole frame, as a Cube Lite's (no grid).
  const four = { matrix_columns: 20, matrix_modules: [0, 5, 10, 15].map((column) => ({ type: "matrix", column })) };
  assert.equal(moduleGrid(four, false), null);
});

test("a spot and a panel look like the real ones", async () => {
  const { moduleLook } = await import("../custom_components/yeelight_cube/www/matrix-modules.js");
  // Unlit spot: a dark lens in its bezel ring on the face.
  const off = moduleLook("spot", [[0, 0, 0]]);
  assert.match(off.background, /^radial-gradient\(circle closest-side,#09090a 57%/);
  assert.match(off.background, /#4a4a50 85%/); // the ring
  // Lit: nearly white at the centre, its colour at the lens's rim (60% of
  // the module), a halo onto the bezel.
  const lit = moduleLook("spot", [[255, 0, 255]]);
  assert.match(lit.background, /^radial-gradient\(circle closest-side,rgb\(255,217,255\) 0%/);
  assert.match(lit.background, /rgb\(255,0,255\) 59%,rgba\(255,0,255,0\) 61.5%/);
  assert.match(lit.background, /rgba\(255,0,255,0.75\) 58%/);
  // A dim one: its colour, hardly whiter.
  assert.match(moduleLook("spot", [[40, 0, 0]]).background, /^radial-gradient\(circle closest-side,rgb\(44,5,5\) 0%/);
  // Panel: unlit, one dark face; lit, a blotch per lit pixel over a haze.
  const black = Array.from({ length: 25 }, () => [0, 0, 0]);
  assert.equal(moduleLook("panel", black).background, "rgb(17,17,19)");
  const one = black.slice();
  one[12] = [200, 100, 0];
  const twinkle = moduleLook("panel", one).background;
  assert.equal((twinkle.match(/radial-gradient/g) || []).length, 1);
  assert.match(twinkle, /^radial-gradient\(30% 30% at 50% 50%,rgb\(200,100,0\) 0%/);
  assert.match(twinkle, /,rgb\(17,17,19\)$/); // a haze too faint to show: the face
  const full = moduleLook("panel", Array.from({ length: 25 }, () => [0, 200, 200])).background;
  assert.equal((full.match(/radial-gradient/g) || []).length, 25);
  assert.match(full, /,rgb\(0,150,150\)$/);
  // The frame line; the pixel shadow around the face (and inside a panel).
  assert.equal(moduleLook("spot", [[0, 0, 0]]).boxShadow, "inset 0 0 0 1px rgba(255,255,255,0.08)");
  assert.equal(
    moduleLook("panel", black, "0 0 2px #0008").boxShadow,
    "inset 0 0 0 1px rgba(255,255,255,0.14),inset 0 0 2px #0008,0 0 2px #0008",
  );
});

test("shared previews and painters draw the spot and panel faces", async () => {
  const { matrixPreviewLayout, matrixCellStyle, renderMatrixPreview } =
    await import("../custom_components/yeelight_cube/www/gallery-display-utils.js");
  const { previewContext } = await import("../custom_components/yeelight_cube/www/preview-context.js");
  const { moduleCells, paintModuleCells } = await import("../custom_components/yeelight_cube/www/matrix-modules.js");
  const frame = Array.from({ length: 125 }, (_, index) => ((index % 25) >= 15 ? [0, 0, 255] : [255, 0, 0]));
  const options = { previewSize: 250, pixelStyle: "circle", pixelBoxShadow: true, context: previewContext(OWNER) };
  const layout = matrixPreviewLayout(frame, options);
  assert.match(layout.gridStyle, /--yc-module-radius:12%;/);
  assert.match(matrixPreviewLayout(frame, { ...options, pixelStyle: "square" }).gridStyle, /--yc-module-radius:0;/);
  // A Cube Lite: no module radius, its cells as before.
  const lite = matrixPreviewLayout(Array(100).fill([255, 0, 0]), { previewSize: 200 });
  assert.doesNotMatch(lite.gridStyle, /--yc-module-radius/);
  assert.equal(matrixCellStyle(lite, 0), "background:rgb(255, 0, 0);");
  const spot = matrixCellStyle(layout, 2 * 25 + 17);
  assert.match(spot, /^background:radial-gradient\(circle closest-side,rgb\(217,217,255\) 0%/);
  assert.match(spot, /box-shadow:inset 0 0 0 1px [^;]*,0 0 [^;]+ #0008;/);
  const panel = matrixCellStyle(layout, 2 * 25 + 22);
  assert.equal((panel.match(/radial-gradient\(30% 30%/g) || []).length, 25);
  assert.match(panel, /background-blend-mode:lighten;/);
  // Ignored black pixels: the faces still show (the modules are there).
  const dark = matrixPreviewLayout(Array(125).fill([0, 0, 0]), { ...options, ignoreBlackPixels: true });
  assert.match(matrixCellStyle(dark, 2 * 25 + 22), /^background:rgb\(17,17,19\);/);
  assert.match(matrixCellStyle(dark, 0), /^background:transparent;/);
  const markup = renderMatrixPreview(frame, options);
  assert.equal((markup.match(/data-module="spot" data-pixels="67"/g) || []).length, 1);
  assert.equal((markup.match(/data-module="panel"/g) || []).length, 1);
  // A painter's cells: the faces painted from the frame's pixels they name,
  // change-only.
  const cell = (dataset) => {
    const writes = [];
    return {
      dataset,
      writes,
      style: {
        set background(value) { writes.push(value); },
        set boxShadow(value) { writes.push(value); },
      },
    };
  };
  const cells = [cell({}), cell({ module: "spot", pixels: "67" }), cell({ module: "panel", pixels: "70,71" })];
  const faces = moduleCells(cells);
  assert.deepEqual(faces, cells.slice(1));
  assert.equal(cells[0]._module, undefined);
  paintModuleCells(faces, frame, { shadow: "" });
  assert.match(cells[1].writes[0], /rgb\(217,217,255\) 0%/);
  assert.equal(cells[1].writes.length, 2);
  paintModuleCells(faces, frame, { shadow: "" });
  assert.equal(cells[1].writes.length, 2); // the same picture: no write
  paintModuleCells(faces, frame, { scale: 0.5 }); // shadow left as it is
  assert.equal(cells[1].writes.length, 3);
  assert.match(cells[1].writes[2], /rgb\(0,0,128\) 59%/);
});
