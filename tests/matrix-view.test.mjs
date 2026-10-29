// How every card preview shows the matrix for the lamp's orientation
// (matrix-view.js) and the shared preview markup built on it.
import test from "node:test";
import assert from "node:assert/strict";

const www = "../custom_components/yeelight_cube/www/";
const {
  MATRIX_SIZE,
  flipIndexVertical,
  fromDisplayOrder,
  isUpsideDownMount,
  isVerticalArt,
  isVerticalMount,
  matrixView,
  toDisplayOrder,
  viewerFrame,
  artOrientation,
  deviceOrientation,
} = await import(`${www}matrix-view.js`);
const { matrixPreviewCells, matrixPreviewLayout, renderMatrixPreview } =
  await import(`${www}gallery-display-utils.js`);
const { drawingPixels, pixelArtColorData } = await import(
  `${www}pixel-art-utils.js`
);
const { nativeEffectFrame } = await import(`${www}native-effect-card-utils.js`);
const { renderNativeEffectOriented } = await import(
  `${www}native-effect-preview.js`
);

const frame = [...Array(MATRIX_SIZE).keys()];

test("mounts: vertical and upside down", () => {
  assert.deepEqual(["right", "down", "left", "up"].map(isVerticalMount), [
    false,
    true,
    false,
    true,
  ]);
  assert.deepEqual(["right", "down", "left", "up"].map(isUpsideDownMount), [
    false,
    false,
    true,
    true,
  ]);
  assert.equal(deviceOrientation(undefined), "right");
  assert.equal(deviceOrientation({ device_orientation: "up" }), "up");
});

test("the viewer's frame is top-first, turned for upside-down mounts", () => {
  const upright = viewerFrame(frame, "right");
  assert.deepEqual(upright.slice(0, 20), frame.slice(80));
  assert.deepEqual(viewerFrame(frame, "down"), upright);
  assert.deepEqual(viewerFrame(frame, "left"), [...upright].reverse());
  assert.deepEqual(viewerFrame(frame, "up"), [...upright].reverse());
  assert.deepEqual([0, 19, 20, 99].map(flipIndexVertical), [80, 99, 60, 19]);
});

test("a vertical view stands the matrix on its left end", () => {
  const landscape = matrixView(false);
  const vertical = matrixView(true);
  assert.equal(landscape.cols, 20);
  assert.equal(vertical.cols, 5);
  assert.equal(vertical.rows, 20);
  assert.equal(matrixView(true), vertical); // cached
  // First display row: the left column, bottom row on the left.
  assert.deepEqual(vertical.source.slice(0, 5), [80, 60, 40, 20, 0]);
  assert.deepEqual(toDisplayOrder(frame, false), frame);
  assert.deepEqual(fromDisplayOrder(toDisplayOrder(frame, true), true), frame);
  vertical.source.forEach((index, display) =>
    assert.equal(vertical.target[index], display),
  );
});

test("pixel arts: orientation and the drawing's pixels", () => {
  assert.equal(isVerticalArt({ orientation: "vertical" }), true);
  assert.equal(isVerticalArt({}), false);
  assert.equal(artOrientation(true), "vertical");
  assert.equal(artOrientation(false), "horizontal");
  const matrix = Array(MATRIX_SIZE).fill("#000000");
  matrix[0] = "#ff0000"; // top-left
  const pixels = drawingPixels(matrix);
  assert.equal(pixels.length, MATRIX_SIZE);
  assert.deepEqual(pixels[0], { position: 80, color: [255, 0, 0] });
  // Saved and loaded back: the same place.
  const art = { pixels: pixels.filter((pixel) => pixel.color[0]) };
  assert.deepEqual(pixelArtColorData(art)[0], [255, 0, 0]);
});

test("a vertical preview keeps the landscape pixel size", () => {
  const landscape = matrixPreviewLayout(frame, { previewSize: 200 });
  const vertical = matrixPreviewLayout(frame, {
    previewSize: 200,
    vertical: true,
  });
  const fitted = matrixPreviewLayout(frame, {
    previewSize: 200,
    vertical: true,
    fitHeight: true,
  });
  assert.match(landscape.wrapperStyle, /width: 200px;/);
  assert.match(vertical.wrapperStyle, /width: 50px;margin-inline:auto;/);
  assert.match(fitted.wrapperStyle, /width: 12.5px;/);
  assert.match(landscape.gridStyle, /repeat\(20,1fr\)/);
  assert.match(vertical.gridStyle, /repeat\(5,1fr\)/);
  // Its lengths scale up as it is narrower: gap 1 -> 4.
  assert.match(vertical.gridStyle, /gap:calc\(100cqw \* 4 \/ 350\)/);
  assert.deepEqual(vertical.cells, toDisplayOrder(frame, true));
  const black = frame.map(() => [0, 0, 0]);
  assert.match(
    renderMatrixPreview(black, { vertical: true }),
    /data-vertical="true"/,
  );
  assert.doesNotMatch(renderMatrixPreview(black), /data-vertical/);
});

test("painters index a vertical preview's cells like a frame", () => {
  const cells = Array.from({ length: MATRIX_SIZE }, (_, display) => ({
    display,
  }));
  const grid = (vertical) => ({
    children: cells,
    dataset: vertical ? { vertical: "true" } : {},
  });
  assert.deepEqual(matrixPreviewCells(grid(false)), cells);
  const byPixel = matrixPreviewCells(grid(true));
  // Pixel 80 (bottom row, left end) is the first cell shown.
  assert.equal(byPixel[80].display, 0);
  assert.equal(byPixel[0].display, 4);
  assert.deepEqual(matrixPreviewCells(null), []);
});

test("native effect previews show an upside-down lamp turned", () => {
  const effect = {
    name: "Rainbow",
    directions: ["Up", "Down", "Left", "Right"],
  };
  const attrs = { device_orientation: "left", native_effect_speed: 50 };
  assert.deepEqual(
    nativeEffectFrame(effect, attrs, 2),
    viewerFrame(
      renderNativeEffectOriented("Rainbow", 2 * (0.25 + 50 / 55), "Left"),
      "left",
    ),
  );
});

test("the pixel-art orientation filter: its default and what it shows", async () => {
  const {
    defaultPixelArtOrientation,
    matchesPixelArtOrientation,
    shownBuiltinPixelArts,
  } = await import(`${www}pixel-art-utils.js`);
  assert.equal(defaultPixelArtOrientation({}, false), "all");
  assert.equal(
    defaultPixelArtOrientation({ pixel_art_orientation: "vertical" }, false),
    "vertical",
  );
  assert.equal(
    defaultPixelArtOrientation({ pixel_art_orientation: "lamp" }, true),
    "vertical",
  );
  assert.equal(
    defaultPixelArtOrientation({ pixel_art_orientation: "lamp" }, false),
    "horizontal",
  );
  assert.equal(
    defaultPixelArtOrientation({ pixel_art_orientation: "bogus" }, false),
    "all",
  );
  const flat = { vertical: false };
  const standing = { vertical: true };
  assert.deepEqual(
    ["all", "horizontal", "vertical"].map((value) => [
      matchesPixelArtOrientation(flat, value),
      matchesPixelArtOrientation(standing, value),
    ]),
    [
      [true, true],
      [true, false],
      [false, true],
    ],
  );
  // The official ones: all of them (the filter picks), or the editor's list.
  const arts = [
    { name: "a", orientation: "horizontal" },
    { name: "b", orientation: "vertical" },
  ];
  assert.deepEqual(shownBuiltinPixelArts(arts, {}), arts);
});

test("every preview's frame: a vertical one keeps the landscape look", async () => {
  const { matrixFrame, frameLength } = await import(`${www}matrix-frame.js`);
  const landscape = matrixFrame({
    width: "80%",
    gap: 4,
    padding: 8,
    radius: 12,
    shadow: true,
  });
  const vertical = matrixFrame({
    width: "80%",
    vertical: true,
    gap: 4,
    padding: 8,
    radius: 12,
    shadow: true,
  });
  assert.match(landscape.wrapperStyle, /width: 80%;/);
  assert.match(vertical.wrapperStyle, /width: calc\(80% \/ 4\);/);
  assert.match(landscape.gridStyle, /repeat\(20,1fr\)/);
  assert.match(vertical.gridStyle, /repeat\(5,1fr\)/);
  // Its lengths follow its own (4 times narrower) width: 4 times the value.
  assert.match(vertical.gridStyle, /padding:calc\(100cqw \* 32 \/ 350\)/);
  assert.match(landscape.gridStyle, /padding:calc\(100cqw \* 8 \/ 350\)/);
  assert.match(vertical.gridStyle, /border-radius:calc\(100cqw \* 48 \/ 350\)/);
  assert.equal(
    matrixFrame({ width: 200, vertical: true, fitHeight: true }).width,
    "width: 12.5px;",
  );
  assert.equal(frameLength({ proportional: false })(3), "3px");
  // A crop (the Preview Appearance presets' "10" digits) keeps its columns.
  assert.match(matrixFrame({ cols: 8 }).gridStyle, /repeat\(8,1fr\)/);
  assert.match(
    matrixFrame({ cols: 8, vertical: true }).gridStyle,
    /repeat\(5,1fr\)/,
  );
});

test("the firmware clock as the lamp draws it: turned by its mount profile", () => {
  return import(`${www}matrix-view.js`).then(
    ({ firmwareClockFrame, lampTurnsClock }) => {
      assert.equal(lampTurnsClock({}), false); // unknown: the default 270°, upright
      assert.equal(lampTurnsClock({ mount_profile: { profile: null, in_use: 3 } }), false);
      assert.equal(lampTurnsClock({ mount_profile: { profile: 0, in_use: 0 } }), true);
      assert.equal(lampTurnsClock({ mount_profile: { profile: null } }), false);
      assert.equal(lampTurnsClock({ mount_profile: { profile: 0 } }), true); // 0°
      assert.equal(lampTurnsClock({ mount_profile: { profile: 1 } }), true); // 90°
      assert.equal(lampTurnsClock({ mount_profile: { profile: 2 } }), false); // 180°
      assert.equal(lampTurnsClock({ mount_profile: { profile: 3 } }), false); // 270°
      // The Matter value alone is not trusted (light_mount_profile).
      assert.equal(lampTurnsClock({ matter: { rotation: 0 } }), false);
      assert.deepEqual(
        firmwareClockFrame([1, 2, 3], { mount_profile: { profile: 0 } }),
        [3, 2, 1],
      );
      const frame = [1, 2, 3];
      assert.equal(
        firmwareClockFrame(frame, { mount_profile: { profile: 2 } }),
        frame,
      );
    },
  );
});

test("native effect previews do not turn with the lamp's profile (compensated)", async () => {
  const { nativeEffectFrame } = await import(
    `${www}native-effect-card-utils.js`
  );
  const effect = { name: "Waterfall" };
  const reference = nativeEffectFrame(effect, { mount_profile: { profile: 2 } }, 1.5);
  for (const profile of [0, 1, 3, null]) {
    assert.deepEqual(
      nativeEffectFrame(effect, { mount_profile: { profile } }, 1.5),
      reference,
    );
  }
});
