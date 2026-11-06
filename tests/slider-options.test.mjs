import assert from "node:assert/strict";
import test from "node:test";

// The shared slider's options (slider-control-utils.js): today's Value, Ends,
// Step Size and Thickness, the older options they replace, and what a style
// makes of them. Every card with lamp sliders goes through these.
const {
  createSliderHandlers,
  lightSliderConfig,
  migrateSliderOptions,
  renderSliderControl,
  sliderConfigToGc,
  sliderKeys,
  sliderStyleFeatures,
  withSliderOptions,
} = await import("../custom_components/yeelight_cube/www/slider-control-utils.js");
const { normalizeCardOptions } = await import(
  "../custom_components/yeelight_cube/www/card-config.js"
);
const { RenderGate } = await import("../custom_components/yeelight_cube/www/render-gate.js");

const K = sliderKeys("slider");
const gc = (config, kind = "speed") => lightSliderConfig(config, kind);

test("older slider options are read as today's", () => {
  // A Capsule with its value field, raw units, icons and the thick track.
  assert.deepEqual(
    withSliderOptions({
      slider_style: "capsule",
      slider_value_display: "input",
      slider_value_side: "left",
      slider_show_raw_value: true,
      slider_capsule_variant: "thick",
      slider_thickness: 7,
      slider_show_icon_left: true,
    }),
    {
      slider_style: "capsule",
      slider_value: "raw",
      slider_ends: "icons",
      slider_thickness: "thick",
    },
  );
  // The Capsule's ➖ ➕ icons, hidden icons, and a hidden value.
  assert.equal(
    withSliderOptions({ slider_style: "capsule", slider_icons: "plus_minus" }).slider_ends,
    "plus_minus",
  );
  assert.deepEqual(
    withSliderOptions({
      slider_style: "capsule",
      slider_show_icon_left: false,
      slider_show_icon_right: false,
      slider_value_display: "none",
    }),
    { slider_style: "capsule", slider_ends: "none", slider_value: "none" },
  );
  // Step buttons are the ends of the other styles; explicitly off keeps none.
  assert.equal(withSliderOptions({ slider_step_buttons: true }).slider_ends, "plus_minus");
  assert.equal("slider_ends" in withSliderOptions({ slider_step_buttons: false }), false);
  assert.equal(withSliderOptions({ slider_show_value: false }).slider_value, "none");
  // The Wheel's step is the step size (at most 25).
  assert.equal(
    withSliderOptions({ slider_style: "wheel", slider_wheel_step: 20 }).slider_step_size,
    20,
  );
  assert.equal(
    withSliderOptions({ slider_style: "wheel", slider_wheel_step: 50 }).slider_step_size,
    25,
  );
  // Pixels are a level; a style with its own thick shape keeps it for Thick.
  assert.equal(withSliderOptions({ slider_thickness: 3 }).slider_thickness, "thin");
  assert.equal("slider_thickness" in withSliderOptions({ slider_thickness: 6 }), false);
  assert.equal(
    withSliderOptions({ slider_style: "bar", slider_thickness: 10 }).slider_thickness,
    "thick",
  );
  assert.equal(
    "slider_thickness" in withSliderOptions({ slider_style: "slider", slider_thickness: 10 }),
    false,
  );
  assert.equal(
    withSliderOptions({ slider_style: "slider", slider_variant: "thick" }).slider_thickness,
    "thick",
  );
  // The Lamp Preview's oldest names, and the oldest theme names.
  assert.deepEqual(
    withSliderOptions({ brightness_slider_appearance: "thick", capsule_theme: "transparent" }),
    { slider_thickness: "thick", slider_theme: "flat" },
  );
  assert.deepEqual(withSliderOptions({ slider_theme: "light" }), {});
});

test("an option set the new way wins, and a config without older ones is kept", () => {
  assert.deepEqual(
    withSliderOptions({ slider_value: "none", slider_show_raw_value: true, slider_ends: "icons", slider_step_buttons: true }),
    { slider_value: "none", slider_ends: "icons" },
  );
  const today = { slider_style: "bar", slider_value: "raw", slider_ends: "none", slider_thickness: "thin" };
  assert.equal(withSliderOptions(today), today);
  assert.deepEqual(migrateSliderOptions({}), {});
});

test("cards read their older slider names through the same migration", () => {
  // The Lamp Preview's brightness_* names, the Clock's speed_* names.
  assert.deepEqual(
    normalizeCardOptions(
      { brightness_slider_style: "capsule", brightness_value_display: "none", show_capsule_moon_icon: false, show_capsule_sun_icon: false, brightness_step_buttons: true },
      "lamp-preview",
    ),
    { slider_style: "capsule", slider_value: "none", slider_ends: "plus_minus" },
  );
  assert.deepEqual(
    normalizeCardOptions({ speed_style: "bar", speed_step_buttons: true, speed_step_size: 10 }, "clock"),
    { slider_style: "bar", slider_ends: "plus_minus", slider_step_size: 10 },
  );
  assert.deepEqual(
    normalizeCardOptions({ slider_show_raw_value: true }, "native"),
    { slider_value: "raw" },
  );
  // Other cards' options are left alone.
  const palette = normalizeCardOptions({ slider_step_buttons: true }, "palette");
  assert.equal(palette.slider_step_buttons, true);
  assert.equal("slider_ends" in palette, false);
});

test("a style resolves the shared settings its own way", () => {
  // Rotary: fixed small width, on the card's background, no ends.
  assert.deepEqual(sliderStyleFeatures("rotary"), { ends: null, thickShape: false, compact: true });
  const rotary = gc({ slider_style: "rotary", slider_width: 100, slider_theme: "subtle" });
  assert.deepEqual([rotary.width, rotary.theme, rotary.ends], [30, "flat", "none"]);
  // Wheel and Matrix have no ends; the Wheel stops every step.
  assert.equal(gc({ slider_style: "wheel" }).ends, "none");
  assert.equal(gc({ slider_style: "wheel", slider_step_size: 20 }).wheelStep, 20);
  assert.equal(gc({ slider_style: "matrix", slider_ends: "plus_minus" }).ends, "none");
  // Thickness: pixels, or the Slider's and Capsule's own thick shape.
  assert.deepEqual(
    [gc({ slider_thickness: "thin" }).thickness, gc({}).thickness, gc({ slider_style: "bar", slider_thickness: "thick" }).thickness],
    [4, 6, 9],
  );
  const thickCapsule = gc({ slider_style: "capsule", slider_thickness: "thick" });
  assert.deepEqual([thickCapsule.capsuleVariant, thickCapsule.thickness], ["thick", 7]);
  assert.equal(gc({ slider_thickness: "thick" }).variant, "thick");
  // Value: none, a percentage (default) or the device value.
  assert.deepEqual([gc({}).showValue, gc({}).valueMode], [true, "percent"]);
  assert.deepEqual(
    [gc({ slider_value: "none" }).showValue, gc({ slider_value: "raw" }).valueMode],
    [false, "raw"],
  );
  // Unknown values fall back to the defaults.
  const odd = sliderConfigToGc({ slider_value: "x", slider_ends: "y", slider_step_size: 99, slider_thickness: "huge" }, K);
  assert.deepEqual([odd.valueMode, odd.ends, odd.stepSize, odd.thickness], ["percent", "none", 25, 6]);
  // Ends start as before: the Capsule's icons, none beside the others.
  assert.equal(gc({ slider_style: "capsule" }).ends, "icons");
  assert.equal(gc({ slider_style: "bar" }).ends, "none");
});

test("the ends are buttons that step the value, beside or inside the control", () => {
  const ends = (html) =>
    [...html.matchAll(/data-on-click="_slSpeedStep" data-args='(\[[^']*\])'/g)].map((m) => JSON.parse(m[1]));
  // Beside a Slider: its icons, stepping by the step size.
  const slider = renderSliderControl(gc({ slider_ends: "icons", slider_step_size: 10 }), 50, "speed");
  assert.equal(slider.match(/class="brightness-end /g)?.length, 2);
  assert.match(slider, /🐢<\/button>/);
  assert.deepEqual(ends(slider), [[-10], [10]]);
  // Inside the Capsule: its icons are the buttons; ➖ ➕ on request.
  const capsule = renderSliderControl(gc({ slider_style: "capsule", slider_ends: "plus_minus" }), 50, "speed");
  assert.equal(capsule.match(/capsule-icon-button/g)?.length, 2);
  assert.match(capsule, />➖<\/button>/);
  assert.doesNotMatch(capsule, /brightness-end /);
  // None, and a style without room for them.
  for (const config of [{}, { slider_style: "capsule", slider_ends: "none" }, { slider_style: "rotary", slider_ends: "icons" }, { slider_style: "wheel", slider_ends: "icons" }])
    assert.doesNotMatch(renderSliderControl(gc(config), 50, "speed"), /_slSpeedStep/);
});

test("an end tap and the mouse wheel move the value by the step size", async () => {
  const commits = [];
  const input = { value: "50" };
  const host = {
    _gate: new RenderGate(() => {}),
    shadowRoot: { querySelector: (selector) => (selector === ".brightness-slider" ? input : null) },
  };
  const handlers = createSliderHandlers({
    host,
    getConfig: () => gc({ slider_step_size: 10 }),
    onCommit: (value) => commits.push(value),
    commitDelay: 1,
  });
  handlers._slStep(10);
  assert.equal(input.value, 60);
  const container = { querySelector: (selector) => (selector === ".brightness-slider" ? input : null) };
  handlers._slWheel({ preventDefault() {}, deltaY: 1, deltaX: 0 }, container);
  assert.equal(input.value, 50);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(commits, [50]);
});

test("Snap to Positions still snaps on every style", async () => {
  const commits = [];
  const handlers = createSliderHandlers({
    host: { _gate: new RenderGate(() => {}) },
    getConfig: () => gc({ slider_style: "bar", slider_snap: true }),
    onCommit: (value) => commits.push(value),
    commitDelay: 1,
  });
  handlers._slChange({ target: { value: "57" } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(commits, [60]);
});

test("every style spans 0-100: its inputs, its drawing and its live update agree", () => {
  for (const style of ["slider", "bar", "wheel", "matrix", "rotary", "capsule"]) {
    const html = renderSliderControl(gc({ slider_style: style }), 55, "speed");
    // Every range input under the style covers 0-100 (a drag reaches 0).
    const ranges = [...html.matchAll(/<input\s+type="range"\s+min="(\d+)"\s+max="(\d+)"/g)];
    assert.ok(ranges.length, style);
    for (const [, min, max] of ranges) assert.deepEqual([min, max], ["0", "100"], style);
    assert.doesNotMatch(html, /step="0"/, style);
  }
  // The Capsule draws 55 where its live update puts 55 (capsulePercent).
  const capsule = renderSliderControl(gc({ slider_style: "capsule" }), 55, "speed");
  for (const [, at] of capsule.matchAll(/--capsule-percent: ([\d.]+);/g))
    assert.ok(Math.abs(Number(at) - 55) < 1e-9, at);
  // The Matrix lights nothing at 0 and every cell at 100.
  const lit = (value) =>
    renderSliderControl(gc({ slider_style: "matrix" }), value, "speed").match(/brightness-matrix-cell lit/g)?.length ?? 0;
  assert.deepEqual([lit(0), lit(100)], [0, 20]);
  // The Wheel stops at 0.
  assert.match(renderSliderControl(gc({ slider_style: "wheel" }), 0, "speed"), /data-value="0"/);
});
