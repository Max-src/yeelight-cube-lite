import test from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, rgbToHex } from "../custom_components/yeelight_cube/www/color-utils.js";

test("rgbToHex formats, rounds and clamps, with a fallback for invalid input", () => {
  assert.equal(rgbToHex([255, 120, 0]), "#ff7800");
  assert.equal(rgbToHex([0, 1, 15]), "#00010f");
  assert.equal(rgbToHex([300, -5, 127.6]), "#ff0080");
  assert.equal(rgbToHex([1, 2, 3, 4]), "#010203");
  assert.equal(rgbToHex(null), "#000000");
  assert.equal(rgbToHex([1, 2], "#ffee00"), "#ffee00");
});

test("hexToRgb accepts #rgb and #rrggbb, with or without #, else null", () => {
  assert.deepEqual(hexToRgb("#ff7800"), [255, 120, 0]);
  assert.deepEqual(hexToRgb("FF7800"), [255, 120, 0]);
  assert.deepEqual(hexToRgb("#abc"), [170, 187, 204]);
  assert.equal(hexToRgb("#ff78"), null);
  assert.equal(hexToRgb("zz"), null);
  assert.equal(hexToRgb(undefined), null);
  for (const rgb of [[0, 0, 0], [12, 200, 99], [255, 255, 255]])
    assert.deepEqual(hexToRgb(rgbToHex(rgb)), rgb);
});
