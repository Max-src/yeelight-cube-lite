// A Cube Matrix of 5 to 8 modules (pictures wider than 20 columns): every
// preview, the drawing grid and the clock cover all its modules. Lamps of 20
// columns or fewer keep their 100-pixel frames (the other tests).
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const www = "../custom_components/yeelight_cube/www/";
const {
  flipIndexIn,
  frameWidth,
  fromDisplayOrder,
  lampWidth,
  matrixView,
  toDisplayOrder,
  viewerFrame,
} = await import(`${www}matrix-view.js`);
const {
  clockColumns,
  fitFrame,
  fitLampFrame,
  moduleGrid,
  shownColumns,
  shownMask,
  spotColours,
  spotPlaces,
  withSpotColours,
} = await import(`${www}matrix-modules.js`);
const { previewContext } = await import(`${www}preview-context.js`);
const { matrixPreviewLayout } = await import(`${www}gallery-display-utils.js`);
const { matrixFrame } = await import(`${www}matrix-frame.js`);
const { drawingPixels, drawingWidth, pixelArtCells, pixelArtColorData, pixelArtWidth } =
  await import(`${www}pixel-art-utils.js`);
const { isDrawing } = await import(`${www}draw_card_storage.js`);
const { createEmptyMatrix } = await import(`${www}draw_utils.js`);
const { renderClockFrame } = await import(`${www}clock-preview-utils.js`);

// A lamp of `types` (chain order from the base), as the light publishes it.
const lamp = (types, extra = {}) => ({
  matrix_columns: types.length * 5,
  matrix_modules: types.map((type, index) => ({ type, column: index * 5 })),
  ...extra,
});
// The owner's 5 modules (filmed 2026-11-21): the panel past the 20 columns.
const FIVE = lamp(["matrix", "matrix", "matrix", "spot", "panel"]);
const SIX = lamp(["matrix", "panel", "matrix", "matrix", "matrix", "matrix"]);
const EIGHT = lamp(["matrix", "spot", "matrix", "panel", "matrix", "matrix", "spot", "panel"]);

test("a frame's width follows its length; a lamp's its columns", () => {
  assert.deepEqual([100, 125, 150, 200].map(frameWidth), [20, 25, 30, 40]);
  // Not a wider frame: 20.
  assert.deepEqual([75, 99, 205, 0].map(frameWidth), [20, 20, 20, 20]);
  assert.equal(lampWidth({}), 20);
  assert.equal(lampWidth({ matrix_columns: 15 }), 20);
  assert.equal(lampWidth(FIVE), 25);
  assert.equal(lampWidth(EIGHT), 40);
  assert.equal(shownColumns(FIVE), 25);
  assert.equal(shownColumns(EIGHT), 40);
  assert.equal(shownColumns({ matrix_columns: 60 }), 40);
});

test("views of a 30-column frame: landscape, vertical, turned", () => {
  const frame = [...Array(150).keys()];
  const landscape = matrixView(false, 30);
  assert.equal(landscape.cols, 30);
  assert.equal(landscape.rows, 5);
  assert.equal(landscape.width, 30);
  const vertical = matrixView(true, 30);
  assert.equal(vertical.cols, 5);
  assert.equal(vertical.rows, 30);
  assert.equal(matrixView(true, 30), vertical); // cached per width
  assert.notEqual(matrixView(true), vertical);
  assert.deepEqual(vertical.source.slice(0, 5), [120, 90, 60, 30, 0]);
  assert.deepEqual(fromDisplayOrder(toDisplayOrder(frame, true), true), frame);
  // Top row first: the lamp's top row (120-149) on top.
  const upright = viewerFrame(frame, "right");
  assert.deepEqual(upright.slice(0, 30), frame.slice(120));
  assert.deepEqual(viewerFrame(frame, "left"), [...upright].reverse());
  assert.deepEqual([0, 29, 30, 149].map((index) => flipIndexIn(index, 30)), [120, 149, 90, 29]);
});

test("5 modules, a spot fourth: 25 columns, the spot one light for 15-19", () => {
  const mask = shownMask(FIVE);
  assert.equal(mask.length, 125);
  assert.equal(mask.filter(Boolean).length, 100);
  for (const column of [14, 20, 24]) assert.equal(mask[column], true, column);
  for (const column of [15, 19]) assert.equal(mask[2 * 25 + column], false, column);
  const colors = Array.from({ length: 125 }, (_, index) =>
    index % 25 === 17 ? "rgb(0, 200, 0)" : "#000000",
  );
  assert.deepEqual(spotColours(colors, FIVE), [[0, 200, 0]]);
  // Its colour in the middle of its area (row 2, column 17).
  const lit = withSpotColours(colors, FIVE, "lamp");
  assert.equal(lit[2 * 25 + 17], "rgb(0, 200, 0)");
  assert.equal(lit.length, 125);
  // A 100-pixel frame is not this lamp's: left as it is.
  const short = Array(100).fill("#000000");
  assert.equal(withSpotColours(short, FIVE, "lamp"), short);
  // Where a preview grid shows it: the centre of columns 15-19.
  const view = matrixView(false, 25);
  const places = spotPlaces(FIVE, (frame) => toDisplayOrder(viewerFrame(frame, "right"), false), view.cols, view.rows);
  assert.deepEqual(places, [{ x: 17.5 / 25, y: 0.5 }]);
});

test("the module grid of a long chain: every column, spots and panels placed, mounts turned", () => {
  const grid = moduleGrid(FIVE, false, "viewer");
  assert.equal(grid.columns, 25);
  assert.equal(grid.cols, 25);
  assert.equal(grid.rows, 5);
  assert.equal(grid.place.length, 125);
  // The spot and the panel (columns 15-19 and 20-24) one cell of 5 each.
  assert.deepEqual(grid.place[14], { column: 15, row: 1, span: 1, spot: false });
  assert.deepEqual(grid.place[2 * 25 + 17], {
    column: 16, row: 1, span: 5, spot: true, module: "spot", pixels: [2 * 25 + 17],
  });
  assert.equal(grid.place[16], null);
  assert.equal(grid.place[24], null);
  const panel = grid.place[2 * 25 + 22];
  assert.deepEqual([panel.column, panel.row, panel.span, panel.spot, panel.module], [21, 1, 5, false, "panel"]);
  // Its 25 pixels row by row as shown: the frame's columns 20-24.
  assert.deepEqual(panel.pixels.slice(0, 5), [20, 21, 22, 23, 24]);
  assert.equal(panel.pixels[24], 4 * 25 + 24);
  // Upside down: the spot's area mirrored (columns 5-9 of the viewer frame).
  const turned = moduleGrid({ ...FIVE, device_orientation: "left" }, false, "viewer");
  assert.equal(turned.place[2 * 25 + 7]?.spot, true);
  assert.equal(turned.place[2 * 25 + 17].spot, false);
  // Standing: 5 columns, 25 rows.
  const standing = moduleGrid({ ...FIVE, device_orientation: "up" }, true, "viewer");
  assert.equal(standing.cols, 5);
  assert.equal(standing.rows, 25);
  // Six Matrix modules: the whole 30-column frame (no grid needed); one a
  // panel: its face on a grid.
  assert.equal(moduleGrid(lamp(["matrix", "matrix", "matrix", "matrix", "matrix", "matrix"]), false), null);
  assert.equal(moduleGrid(SIX, false).place[2 * 30 + 7].module, "panel");
  // Eight modules with two spots (columns 5 and 30) and two panels (15 and
  // 35): 40 columns.
  const eight = moduleGrid(EIGHT, false, "lamp");
  assert.equal(eight.place.length, 200);
  assert.equal(eight.place[2 * 40 + 7].spot, true);
  assert.equal(eight.place[2 * 40 + 32].spot, true);
  assert.equal(eight.place[2 * 40 + 37].module, "panel");
  assert.equal(eight.place[39], null);
  assert.equal(eight.place[29].spot, false);
});

test("frames of another width: 20-column content placed from the base, wider cropped", () => {
  const twenty = Array.from({ length: 100 }, (_, index) => index);
  const fitted = fitFrame(twenty, 30, { blank: -1 });
  assert.equal(fitted.length, 150);
  assert.deepEqual(fitted.slice(0, 20), twenty.slice(0, 20));
  assert.deepEqual(fitted.slice(20, 30), Array(10).fill(-1));
  assert.deepEqual(fitted.slice(30, 50), twenty.slice(20, 40));
  // A viewer frame of an upside-down mount: the base side is its end.
  const turned = fitLampFrame(twenty, lamp(["matrix", "matrix", "matrix", "matrix", "matrix", "matrix"], {
    device_orientation: "left",
  }), "viewer", -1);
  assert.deepEqual(turned.slice(0, 10), Array(10).fill(-1));
  assert.deepEqual(turned.slice(10, 30), twenty.slice(0, 20));
  // 40 columns on a 25-column lamp: cropped.
  const forty = Array.from({ length: 200 }, (_, index) => index);
  const cropped = fitFrame(forty, 25);
  assert.deepEqual(cropped.slice(25, 50), forty.slice(40, 65));
  // Already fitting: the same frame.
  assert.equal(fitFrame(forty, 40), forty);
});

test("preview contexts and frames of a long chain", () => {
  const context = previewContext(EIGHT);
  assert.equal(context.columns, 40);
  assert.equal(context.width, 40);
  assert.equal(context.length, 200);
  assert.equal(previewContext({}).width, 20);
  // A 20-column picture on it: fitted, 200 cells.
  const layout = matrixPreviewLayout(Array(100).fill([10, 10, 10]), { context: previewContext(SIX) });
  assert.equal(layout.cells.length, 150);
  assert.ok(layout.gridStyle.includes("repeat(30,1fr)"));
  // As wide as a 20-column frame (not 150%): smaller pixels, lengths with them.
  assert.ok(layout.wrapperStyle.includes("width: 200px"), layout.wrapperStyle);
  const frame = matrixFrame({ width: 400, panel: 40 });
  assert.ok(frame.gridStyle.includes("repeat(40,1fr)"));
  assert.ok(frame.width.includes("400px"));
  // Vertical: 40 rows of 5, 8 times narrower at the same pixel size.
  const standing = matrixFrame({ width: 400, panel: 40, vertical: true });
  assert.ok(standing.width.includes("50px"), standing.width);
  assert.ok(standing.gridStyle.includes("repeat(5,1fr)"));
});

test("pixel arts keep their width; older 20-column ones are placed from column 0", () => {
  const red = [255, 0, 0];
  const wide = { width: 30, pixels: [{ color: red, position: [29, 4 * 30] }] };
  assert.equal(pixelArtWidth(wide), 30);
  assert.equal(pixelArtWidth({ pixels: [] }), 20);
  assert.equal(pixelArtWidth({ width: 50 }), 20);
  const colors = pixelArtColorData(wide);
  assert.equal(colors.length, 150);
  // Position 29: the bottom row's last column, shown on the last row.
  assert.deepEqual(colors[4 * 30 + 29], red);
  assert.deepEqual(colors[0], red);
  // An older art on a 30-column grid: from column 0, the rest black.
  const old = { pixels: [{ color: red, position: [19, 80] }] };
  assert.deepEqual(pixelArtCells(old, 30).map(({ index }) => index), [4 * 30 + 19, 0]);
  // On a 25-column grid the wide one is cropped (its column 29 dropped).
  assert.deepEqual(pixelArtCells(wide, 25).map(({ index }) => index), [0]);
  // Positions out of the art's frame are left out.
  assert.deepEqual(pixelArtCells({ width: 25, pixels: [{ color: red, position: [125, -1] }] }), []);
  // The drawing sent back: row * width + column, with its width.
  const drawing = createEmptyMatrix(30);
  drawing[4 * 30 + 29] = "#ff0000";
  const pixels = drawingPixels(drawing);
  assert.equal(pixels.length, 150);
  assert.deepEqual(pixels.find(({ color }) => color[0] === 255).position, 29);
  assert.deepEqual(drawingWidth(drawing), { width: 30 });
  assert.deepEqual(drawingWidth(createEmptyMatrix()), {});
});

test("a stored drawing of another size never breaks the card", () => {
  assert.ok(isDrawing(Array(100).fill("#000000")));
  assert.ok(isDrawing(Array(150).fill("#000000")));
  assert.ok(isDrawing(Array(200).fill("#000000")));
  for (const data of [Array(99).fill("#000000"), Array(205).fill("#000000"), Array(75).fill("#000000"),
    Array(100).fill(0), { length: 100 }, null])
    assert.ok(!isDrawing(data));
});

test("the clock's digits go on the blocks only, never a spot", () => {
  const time = new Date(2026, 10, 21, 12, 34, 56);
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [time.getTime()]));
    }
  };
  try {
    const attrs = { clock_style_id: 6, clock_content: "time" };
    const columnsLit = (frame, width) =>
      new Set(frame.flatMap((pixel, index) => (pixel.some(Boolean) ? [index % width] : [])));
    // A spot fourth: the digits across columns 0-14 and 20-24.
    assert.deepEqual(clockColumns(FIVE), [...Array(15).keys(), 20, 21, 22, 23, 24]);
    const five = renderClockFrame({ ...attrs, ...FIVE }, null, null);
    assert.equal(five.length, 125);
    const lit = columnsLit(five, 25);
    for (const column of [15, 16, 17, 18, 19]) assert.ok(!lit.has(column), column);
    assert.ok([...lit].some((column) => column >= 20));
    // Six blocks: centred in 30 columns, on the frame's stride.
    const six = renderClockFrame({ ...attrs, ...SIX }, null, null);
    assert.equal(six.length, 150);
    const sixLit = [...columnsLit(six, 30)];
    assert.ok(Math.min(...sixLit) >= 5 && Math.max(...sixLit) <= 24, sixLit.join());
    // Eight with two spots: never on columns 5-9 or 30-34.
    const eight = renderClockFrame({ ...attrs, ...EIGHT }, null, null);
    assert.equal(eight.length, 200);
    const eightLit = columnsLit(eight, 40);
    for (const column of [5, 9, 30, 34]) assert.ok(!eightLit.has(column), column);
    // Four blocks, no spot: the Cube Lite's clock, exactly.
    const four = renderClockFrame({ ...attrs, ...lamp(["matrix", "panel", "matrix", "matrix"]) }, null, null);
    assert.deepEqual(four, renderClockFrame(attrs, null, null));
    // Turned: a half turn across the blocks' columns, still none on the spot.
    const turned = renderClockFrame(
      { ...attrs, ...FIVE, mount_profile: { clock_turned: true } }, null, null,
    );
    const turnedLit = columnsLit(turned, 25);
    for (const column of [15, 16, 17, 18, 19]) assert.ok(!turnedLit.has(column), column);
  } finally {
    globalThis.Date = RealDate;
  }
});
