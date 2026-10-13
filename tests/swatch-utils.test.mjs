import test from "node:test";
import assert from "node:assert/strict";
import {
  SWATCH_LAYOUTS,
  blendBackground,
  blendColorAt,
  blindsHeight,
  closestColorName,
  colorLabel,
  fanGeometry,
  honeycombGeometry,
  smoothOrder,
  spiralGeometry,
  swatchLayoutGroup,
  toHex,
  treemapGeometry,
  waveGeometry,
} from "../custom_components/yeelight_cube/www/swatch-utils.js";
import { normalizeCardOptions } from "../custom_components/yeelight_cube/www/card-config.js";
import { palettePreviewHtml } from "../custom_components/yeelight_cube/www/palette-preview.js";

test("swatch colors: every format becomes lowercase hex, anything else is dropped", () => {
  assert.equal(toHex([255, 128, 0]), "#ff8000");
  assert.equal(toHex("#ABC"), "#aabbcc");
  assert.equal(toHex("ff8000"), "#ff8000");
  assert.equal(toHex("rgb(1, 2, 3)"), "#010203");
  assert.equal(toHex("rgba(1,2,3,0.5)"), "#010203");
  for (const bad of ["red", "#12", "url(x)", null, undefined, [1, 2], {}, '"><script>'])
    assert.equal(toHex(bad), null);
});

test("swatch labels: hex, the closest CSS name, or nothing", () => {
  assert.equal(closestColorName([250, 2, 3]), "red");
  assert.equal(closestColorName("#0000fe"), "blue");
  assert.equal(closestColorName("nope"), "unknown");
  assert.equal(colorLabel([0, 128, 0], "name"), "green");
  assert.equal(colorLabel([0, 128, 0], "css"), "green");
  assert.equal(colorLabel([0, 128, 0], "hex"), "#008000");
  for (const none of ["none", "hidden", undefined, ""]) assert.equal(colorLabel([0, 0, 0], none), "");
});

test("the smooth order starts from the darkest color and keeps every color once", () => {
  const hexes = ["#ffffff", "#000000", "#ff0000", "#800000"];
  const order = smoothOrder(hexes);
  assert.equal(hexes[order[0]], "#000000");
  assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
  assert.deepEqual(smoothOrder(["#ffffff", "#000000"]), [0, 1]);
});

test("the blend: a background with stops, and the color at any point", () => {
  assert.equal(blendBackground([]), "transparent");
  assert.equal(
    blendBackground(["#ff0000"]),
    "linear-gradient(to right, #ff0000 0.0%, #ff0000 100.0%)",
  );
  assert.equal(blendColorAt(["#000000", "#ffffff"], 0.5), "#808080");
  assert.equal(blendColorAt(["#000000", "#ffffff"], 2), "#ffffff");
  assert.equal(blendColorAt(["#123456"], 0.3), "#123456");
  assert.equal(blendColorAt([], 0.3), null);
});

test("every layout has a group, the drawn ones a box per color inside their area", () => {
  for (const layout of SWATCH_LAYOUTS) assert.ok(swatchLayoutGroup(layout));
  assert.equal(swatchLayoutGroup("fan"), "swatches");
  assert.equal(swatchLayoutGroup("unknown"), "swatches");
  for (const geometry of [fanGeometry, waveGeometry, spiralGeometry, honeycombGeometry])
    for (const count of [1, 3, 12, 40]) {
      const { width, items } = geometry(count);
      assert.ok(width > 0);
      assert.equal(items.length, count);
      for (const item of items)
        for (const key of ["left", "top", "width", "height"]) assert.match(item[key], /^-?\d+(\.\d+)?%$/);
    }
  assert.ok(blindsHeight(40, "rows") < blindsHeight(3, "rows") * 3);
  assert.equal(blindsHeight(5, "columns"), blindsHeight(50, "columns"));
});

test("the treemap fills its area, largest weight first, each color once", () => {
  const { items } = treemapGeometry([1, 5, 2, 0.1]);
  assert.deepEqual(items.map((item) => item.index).sort(), [0, 1, 2, 3]);
  assert.equal(items[0].index, 1);
  const area = items.reduce(
    (sum, item) => sum + (parseFloat(item.width) * parseFloat(item.height)) / 100,
    0,
  );
  assert.ok(Math.abs(area - 100) < 0.5, `area ${area}`);
});

test("palette previews: the shared swatches, attributes limited to words and hex codes", () => {
  const html = palettePreviewHtml([[255, 0, 0], "nope", [0, 0, 255]], {
    layout: 'fill"><img',
    shape: "round",
  });
  assert.equal(
    html,
    '<yc-swatches class="yc-palette-preview" layout="fillimg" shape="round" direction="rows" colors="#ff0000 #0000ff"></yc-swatches>',
  );
  assert.match(palettePreviewHtml([]), /layout="row" shape="rounded"/);
});

test("former swatch options join the shared swatch_* names", () => {
  // Palette: swatch_style is a layout and a shape ("square" had rounded corners).
  for (const [style, expected] of [
    ["square", { swatch_layout: "row", swatch_shape: "rounded" }],
    ["round", { swatch_layout: "row", swatch_shape: "round" }],
    ["gradient", { swatch_layout: "gradient" }],
    ["gradient-bar", { swatch_layout: "gradient" }],
    ["gradient-bg", { swatch_layout: "fill" }],
    ["stripes", { swatch_layout: "stripes" }],
  ]) {
    const config = normalizeCardOptions({ swatch_style: style }, "palette");
    assert.equal("swatch_style" in config, false);
    for (const [key, value] of Object.entries(expected)) assert.equal(config[key], value, style);
    if (!expected.swatch_shape) assert.equal("swatch_shape" in config, false, style);
  }
  // A shared name already set wins.
  assert.equal(
    normalizeCardOptions({ swatch_style: "round", swatch_layout: "blinds" }, "palette").swatch_layout,
    "blinds",
  );
  // Draw: the color section's names.
  const draw = normalizeCardOptions(
    {
      palette_display_mode: "expand",
      expand_btn_style: "dots",
      blinds_direction: "columns",
      gradient_free_pick: true,
    },
    "draw",
  );
  for (const [key, value] of Object.entries({
    swatch_layout: "expand",
    swatch_expand_style: "dots",
    swatch_blinds_direction: "columns",
    swatch_free_pick: true,
  }))
    assert.equal(draw[key], value);
  for (const old of ["palette_display_mode", "expand_btn_style", "blinds_direction", "gradient_free_pick"])
    assert.equal(old in draw, false);
});

test("the Color List joins the shared item radius and Size", () => {
  const config = normalizeCardOptions({ rounded_cards: "rounded", card_size: 80 }, "color-list-editor");
  assert.equal(config.item_radius, 4);
  assert.equal(config.preview_size, 80);
  assert.equal("rounded_cards" in config, false);
  assert.equal("card_size" in config, false);
  // Unset: the default look (16 px corners) stays unset.
  assert.equal("item_radius" in normalizeCardOptions({ rounded_cards: true }, "color-list-editor"), false);
  assert.equal(normalizeCardOptions({ rounded_cards: 0, item_radius: 9 }, "color-list-editor").item_radius, 9);
});

test("Draw's tool buttons join the shared shape names", () => {
  for (const [old, shape] of [["circle", "round"], ["rect", "rounded"], ["square", "square"]]) {
    const config = normalizeCardOptions({ button_shape: old, paint_button_shape: "rect" }, "draw");
    assert.equal(config.tool_buttons_shape, shape, old);
    assert.equal("button_shape" in config || "paint_button_shape" in config, false);
  }
  assert.equal(normalizeCardOptions({ button_shape: "circle", tool_buttons_shape: "square" }, "draw").tool_buttons_shape, "square");
});

test("older Gradient options arrive in today's names, for the card and its editor", () => {
  const config = normalizeCardOptions({
    rotary_unified_style: "square",
    rectangle_shape: "rectangle",
    compass_show_labels: false,
    preview_display_mode: "wheel",
    show_color_mode_selector: false,
    panel_toggle_style: "segmented",
  }, "gradient");
  assert.equal(config.rotary_unified_style, "rectangle");
  assert.equal(config.rectangle_shape, "square");
  assert.equal(config.compass_labels_mode, "none");
  assert.equal(config.style_selector_style, "preview-wheel");
  assert.equal(config.show_panel_toggle, false);
  assert.equal(config.panel_toggle_style, "tabs");
  for (const old of ["compass_show_labels", "preview_display_mode", "show_color_mode_selector"])
    assert.equal(old in config, false);
  // A shape chosen since is kept; merged text styles become "filled".
  const beam = normalizeCardOptions({ rotary_unified_style: "beam", compass_shape: "star", style_selector_style: "pills" }, "gradient");
  assert.deepEqual([beam.rotary_unified_style, beam.compass_shape, beam.style_selector_style], ["compass", "star", "filled"]);
  assert.equal(normalizeCardOptions({ rotary_unified_style: "arrow_window" }, "gradient").wheel_show_mask, true);
  // Today's options are left as they are.
  const current = normalizeCardOptions({ rotary_unified_style: "compass", style_selector_style: "preview-grid" }, "gradient");
  assert.deepEqual([current.rotary_unified_style, current.style_selector_style, "compass_shape" in current], ["compass", "preview-grid", false]);
});
