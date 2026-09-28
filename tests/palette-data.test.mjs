import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeImportedPalettes,
  toRgbTriplet,
} from "../custom_components/yeelight_cube/www/palette-data-utils.js";
import { rgbToCss } from "../custom_components/yeelight_cube/www/yeelight-cube-dotmatrix.js";

test("rgbToCss only ever emits numeric channels", () => {
  assert.equal(rgbToCss([255, 0, 128]), "rgb(255,0,128)");
  assert.equal(
    rgbToCss(['0)"><img src=x onerror=alert(1)>', 300, -5]),
    "rgb(0,255,0)",
  );
  assert.equal(rgbToCss(undefined), "rgb(0,0,0)");
});

test("toRgbTriplet accepts byte triplets and hex, rejects anything else", () => {
  assert.deepEqual(toRgbTriplet([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(toRgbTriplet("#ff8000"), [255, 128, 0]);
  assert.deepEqual(toRgbTriplet("#f80"), [255, 136, 0]);
  assert.equal(toRgbTriplet([1, 2, 256]), null);
  assert.equal(toRgbTriplet([1, 2, "3"]), null);
  assert.equal(toRgbTriplet("red;background:url(x)"), null);
});

test("normalizeImportedPalettes keeps valid palettes and counts skipped ones", () => {
  const { palettes, skipped } = normalizeImportedPalettes([
    { name: "Sunset", colors: [[255, 94, 77], "#ffc300"] },
    [[0, 0, 255]],
    { name: "Evil", colors: [['0)"><img src=x onerror=alert(1)>', 0, 0]] },
    { name: 42, colors: [[1, 1, 1]] },
    "nope",
  ]);
  assert.deepEqual(palettes, [
    { name: "Sunset", colors: [[255, 94, 77], [255, 195, 0]] },
    { name: "Palette 2", colors: [[0, 0, 255]] },
    { name: "Palette 4", colors: [[1, 1, 1]] },
  ]);
  assert.equal(skipped, 2);
  assert.deepEqual(normalizeImportedPalettes({}), { palettes: [], skipped: 0 });
});
