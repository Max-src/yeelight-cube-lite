import test from "node:test";
import assert from "node:assert/strict";
import {
  contrastInk,
  hexToRgb,
  isDarkTheme,
  isLightColor,
  noteThemes,
  parseColor,
  relativeLuminance,
  rgbToHex,
} from "../custom_components/yeelight_cube/www/color-utils.js";

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

test("colors parse from hex, CSS rgb() and arrays", () => {
  assert.deepEqual(parseColor("#ff7800"), [255, 120, 0]);
  assert.deepEqual(parseColor("rgb(225, 225, 225)"), [225, 225, 225]);
  assert.deepEqual(parseColor("rgba(1, 2, 3, 0.5)"), [1, 2, 3]);
  assert.deepEqual(parseColor([4, 5, 6, 7]), [4, 5, 6]);
  assert.equal(parseColor("nope"), null);
  assert.equal(parseColor(null), null);
});

test("one contrast rule for every fill: the ink with the higher WCAG contrast", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  // Above 0.179 black contrasts more than white.
  for (const [color, ink] of [
    ["#ffffff", "#111"],
    ["#ffee00", "#111"],
    ["#ff7800", "#111"], // orange: white would be 2.9:1
    ["#ff0000", "#111"],
    ["#0000ff", "#fff"],
    ["#800080", "#fff"],
    ["#000000", "#fff"],
  ])
    assert.equal(contrastInk(color), ink, color);
  assert.equal(contrastInk([0, 0, 255], "#000000", "#ffffff"), "#ffffff");
  assert.equal(contrastInk("not a color"), "#111");
  assert.equal(isLightColor("rgb(225, 225, 225)"), true);
  assert.equal(isLightColor("rgb(33, 33, 33)"), false);
});

test("a dark theme is read from the host's text color, else HA's dark mode", () => {
  const saved = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (host) => ({ color: host.text });
  try {
    // A custom dark theme HA does not mark dark: its light text decides.
    assert.equal(isDarkTheme({ isConnected: true, text: "rgb(225, 225, 225)" }, { themes: { darkMode: false } }), true);
    assert.equal(isDarkTheme({ isConnected: true, text: "rgb(33, 33, 33)" }, { themes: { darkMode: true } }), false);
    // Not in the page yet: HA's dark mode.
    assert.equal(isDarkTheme({ isConnected: false }, { themes: { darkMode: true } }), true);
    assert.equal(isDarkTheme(null, { themes: { darkMode: false } }), false);
  } finally {
    globalThis.getComputedStyle = saved;
  }
});

test("the dark-theme check reads once per element, again after a theme change", async () => {
  const saved = globalThis.getComputedStyle;
  let reads = 0;
  let text = "rgb(33, 33, 33)";
  globalThis.getComputedStyle = () => (reads++, { color: text });
  try {
    let updates = 0;
    const host = { isConnected: true, requestUpdate: () => updates++ };
    noteThemes({ darkMode: false }); // the theme first seen
    assert.equal(isDarkTheme(host), false);
    assert.equal(isDarkTheme(host), false);
    assert.equal(reads, 1); // one style read, not one per render
    noteThemes({ darkMode: true }); // the user switches to dark
    text = "rgb(225, 225, 225)"; // its colors apply
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(updates, 1); // the element is asked to render again
    assert.equal(isDarkTheme(host), true);
    assert.equal(reads, 2);
  } finally {
    globalThis.getComputedStyle = saved;
  }
});
