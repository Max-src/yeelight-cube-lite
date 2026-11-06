import assert from "node:assert/strict";
import test from "node:test";

// The slider core loads without a browser (no Lit, no editor helpers: the
// editor settings live in slider-settings-ui.js), so the cards never load
// editor code through it. The tests below stub only what they use.
const {
  createSliderDraft,
  createSliderHandlers,
  stableSliderMarkup,
  renderSliderGroup,
  sanitizeSliderGc,
  brightnessPctToRaw,
  brightnessRawToPct,
  speedPctToRaw,
  speedRawToPct,
  lightSliderConfig,
  sliderWhenUsed,
  GREY_OUT_UNUSED_KEY,
  lampSliderIcons,
} =
  await import("../custom_components/yeelight_cube/www/slider-control-utils.js");
const { RenderGate } = await import("../custom_components/yeelight_cube/www/render-gate.js");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal document stub: records capture listeners so tests can "release".
function stubDocument() {
  const listeners = new Map();
  const previous = globalThis.document;
  globalThis.document = {
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  return {
    release: () => listeners.get("mouseup")?.(),
    held: () => listeners.has("mouseup"),
    restore: () => {
      globalThis.document = previous;
    },
  };
}

function slider({ commitDelay = 10, onDragEnd } = {}) {
  const host = { _gate: new RenderGate(() => {}) };
  const commits = [];
  const handlers = createSliderHandlers({
    host,
    getConfig: () => ({}),
    onCommit: (value) => commits.push(value),
    commitDelay,
    onDragEnd,
  });
  return { host, commits, handlers };
}

test("a slow drag stays a drag after the debounced commit fires", async () => {
  const doc = stubDocument();
  try {
    let ended = 0;
    const { host, commits, handlers } = slider({ onDragEnd: () => ended++ });
    handlers._slStartDrag();
    handlers._slChange({ target: { value: "40" } });
    await wait(30); // longer than the commit delay, button still held
    assert.deepEqual(commits, [40]);
    assert.equal(host._gate.held("slider"), true);
    assert.ok(doc.held());
    doc.release();
    await wait(70);
    assert.equal(host._gate.held("slider"), false);
    assert.equal(ended, 1);
    assert.deepEqual(commits, [40]); // nothing pending, nothing re-sent
  } finally {
    doc.restore();
  }
});

test("releasing sends the pending value immediately", () => {
  const doc = stubDocument();
  try {
    const { commits, handlers } = slider({ commitDelay: 5000 });
    handlers._slStartDrag();
    handlers._slChange({ target: { value: "70" } });
    assert.deepEqual(commits, []);
    doc.release();
    assert.deepEqual(commits, [70]);
    assert.equal(doc.held(), false);
  } finally {
    doc.restore();
  }
});

test("a wheel change without a held pointer ends with its commit", async () => {
  const doc = stubDocument();
  try {
    const { host, commits, handlers } = slider();
    handlers._slChange({ target: { value: "55" } });
    assert.equal(host._gate.held("slider"), true);
    await wait(30);
    assert.deepEqual(commits, [55]);
    assert.equal(host._gate.held("slider"), false);
  } finally {
    doc.restore();
  }
});

test("the draft survives stale state and clears once the lamp confirms", () => {
  let dragging = false;
  const draft = createSliderDraft({ isDragging: () => dragging });
  draft.live(30);
  draft.commit(60);
  // An echo of an older, in-between value must not replace the user's value.
  assert.equal(draft.settle(30), false);
  assert.equal(draft.value, 60);
  // Never dropped while the pointer is held, even when the lamp agrees.
  dragging = true;
  assert.equal(draft.settle(60), false);
  dragging = false;
  // Within tolerance of the committed value: back to the lamp's state.
  assert.equal(draft.settle(59), true);
  assert.equal(draft.value, null);
});

test("an unconfirmed draft expires after its timeout", async () => {
  let expired = 0;
  const draft = createSliderDraft({ timeoutMs: 20, onExpire: () => expired++ });
  draft.commit(80);
  await wait(50);
  assert.equal(draft.value, null);
  assert.equal(expired, 1);
});

test("a pending value (a picked mode, a switch) shows until the lamp confirms it", async () => {
  const { createPendingValue } = await import(
    "../custom_components/yeelight_cube/www/pending-value.js"
  );
  let expired = 0;
  const pending = createPendingValue({ timeoutMs: 20, onExpire: () => expired++ });
  // false is a value (a switch turned off), not "none".
  pending.set(false);
  assert.equal(pending.value, false);
  assert.equal(pending.settle(true), false); // an older update: kept
  assert.equal(pending.settle(false), true); // confirmed: dropped
  assert.equal(pending.value, null);
  // Held (not sent yet): no timeout until set().
  pending.hold("Rainbow");
  await wait(50);
  assert.equal(pending.value, "Rainbow");
  pending.set("Rainbow");
  await wait(50);
  assert.equal(pending.value, null);
  assert.equal(expired, 1);
  pending.set("Wave");
  pending.clear();
  await wait(50);
  assert.equal(expired, 1); // cleared: no expiry
});

test("a sent pick yields to a new lamp value (yieldToLamp), never to an older one", async () => {
  const { createPendingValue } = await import(
    "../custom_components/yeelight_cube/www/pending-value.js"
  );
  const pending = createPendingValue({ yieldToLamp: true });
  pending.settle("Rainbow"); // what the lamp shows
  pending.hold("Wave"); // picked, not sent yet
  assert.equal(pending.settle("Aurora"), false); // an earlier pick's echo: kept
  pending.set("Wave"); // sent
  assert.equal(pending.settle("Aurora"), false); // the same older value: kept
  assert.equal(pending.settle("White"), true); // a new value (a rotation step): it wins
  assert.equal(pending.value, null);
  // Without the option, only a match (or the timeout) drops it.
  const strict = createPendingValue();
  strict.settle("Rainbow");
  strict.set("Wave");
  assert.equal(strict.settle("White"), false);
  strict.clear();
});

test("a pending map keeps one pending value per key (the Lamp Preview's adjustments)", async () => {
  const { createPendingMap } = await import(
    "../custom_components/yeelight_cube/www/pending-value.js"
  );
  const expired = [];
  const pending = createPendingMap({
    timeoutMs: 20,
    yieldToLamp: true,
    matches: (actual, value) => Math.abs(actual - value) < 0.5,
    onExpire: (key) => expired.push(key),
  });
  pending.settle("contrast", 100); // nothing waits: nothing to drop
  pending.hold("contrast", 80);
  pending.hold("saturation", 40);
  assert.deepEqual(pending.keys(), ["contrast", "saturation"]);
  assert.equal(pending.size, 2);
  assert.equal(pending.settle("contrast", 80.2), true); // confirmed
  assert.equal(pending.value("contrast"), null);
  pending.settle("saturation", 100); // the lamp's value when sent
  pending.set("saturation", 40);
  assert.equal(pending.settle("saturation", 100), false); // older: kept
  assert.equal(pending.settle("saturation", 70), true); // another dashboard's: wins
  pending.set("tint", 50);
  await wait(50);
  assert.deepEqual(expired, ["tint"]);
  assert.equal(pending.size, 0);
  pending.hold("contrast", 1);
  pending.clear();
  assert.deepEqual(pending.keys(), []);
});

test("slider markup is kept unchanged while a drag is held", () => {
  const host = { _gate: new RenderGate(() => {}) };
  assert.equal(stableSliderMarkup(host, "s", "<a value=1>"), "<a value=1>");
  host._gate.hold("slider");
  assert.equal(stableSliderMarkup(host, "s", "<a value=9>"), "<a value=1>");
  host._gate.release("slider");
  assert.equal(stableSliderMarkup(host, "s", "<a value=9>"), "<a value=9>");
});

test("slider config cannot inject markup into the rendered HTML", () => {
  const payload = '"><img src=x onerror=alert(1)>';
  const gc = {
    style: `slider${payload}`,
    theme: payload,
    color: `red;${payload}`,
    thickness: `6${payload}`,
    width: payload,
    unit: payload,
    iconLeft: payload,
  };
  const safe = sanitizeSliderGc(gc);
  assert.equal(safe.style, undefined);
  assert.equal(safe.color, undefined);
  assert.equal(safe.thickness, undefined);
  const html = renderSliderGroup([
    { label: payload, gc: { ...gc, style: "capsule" }, value: 40 },
    { label: "Speed", gc, value: 40, ns: `x${payload}` },
  ]);
  assert.ok(!html.includes("<img"), html);
  assert.ok(!html.includes('onerror=alert(1)"'), html);
  // Valid values are kept.
  const valid = sanitizeSliderGc({ style: "bar", color: "#ff9800", thickness: "8", unit: "%" });
  assert.deepEqual(
    [valid.style, valid.color, valid.thickness, valid.unit],
    ["bar", "#ff9800", 8, "%"],
  );
});

test("an unused slider is hidden, or greyed out in place when the card asks", () => {
  const control = { label: "Intensity", gc: { style: "slider" }, value: 50, ns: "intensity" };
  assert.equal(GREY_OUT_UNUSED_KEY, "slider_grey_out_unused");
  assert.equal(sliderWhenUsed({}, true, control), control);
  assert.equal(sliderWhenUsed({}, false, control), null);
  assert.equal(sliderWhenUsed({ slider_grey_out_unused: false }, false, control), null);
  const greyed = sliderWhenUsed({ slider_grey_out_unused: true }, false, control);
  assert.equal(greyed.unused, true);
  assert.equal(sliderWhenUsed({ slider_grey_out_unused: true }, true, control).unused, undefined);
  const html = renderSliderGroup([{ ...control, ns: "speed" }, greyed]);
  // Only the unused one is greyed and inert; both keep their place.
  assert.equal(html.match(/brightness-control-unused/g)?.length, 1);
  assert.match(html, /brightness-control-unused"[^>]* inert [^>]*aria-disabled="true"/);
  assert.ok(html.indexOf('data-sl-ns="speed"') < html.indexOf('data-sl-ns="intensity"'));
});

test("a slider's icons follow its kind, the effect family and the card's ends", () => {
  assert.deepEqual(lampSliderIcons({}, "brightness"), ["🌙", "☀️"]);
  assert.deepEqual(lampSliderIcons({}, "speed", "music"), ["🐢", "⚡"]);
  assert.deepEqual(lampSliderIcons({}, "intensity", "sparkles"), ["💧", "🌊"]);
  assert.deepEqual(lampSliderIcons({}, "intensity", "music"), ["🔈", "🔊"]);
  assert.deepEqual(lampSliderIcons({}, "intensity"), ["💧", "🌊"]);
  // Ends: ➖ ➕ on every slider, whatever the family (also from the older
  // Capsule icon set).
  for (const kind of ["brightness", "speed", "intensity"])
    assert.deepEqual(lampSliderIcons({ slider_ends: "plus_minus" }, kind, "music"), ["➖", "➕"]);
  assert.deepEqual(
    lampSliderIcons({ slider_style: "capsule", slider_icons: "plus_minus" }, "speed"),
    ["➖", "➕"],
  );
  // Through the card's render config.
  const config = lightSliderConfig({}, "intensity", undefined, { family: "music" });
  assert.deepEqual([config.iconLeft, config.iconRight], ["🔈", "🔊"]);
  assert.equal(config.family, undefined);
});

test("slider text is escaped exactly once", () => {
  const html = renderSliderGroup([
    { gc: { style: "slider", unit: " & up" }, value: 40, ns: "a" },
  ]);
  assert.ok(html.includes("40 &amp; up"), html);
  assert.ok(!html.includes("&amp;amp;"), html);
});

test("valid CSS color syntaxes and empty numbers are handled sensibly", () => {
  for (const color of [
    "var(--primary-color, #fff)",
    "color-mix(in srgb, red 50%, blue)",
    "oklch(70% 0.1 200deg)",
    "rgb(1 2 3 / 50%)",
  ])
    assert.equal(sanitizeSliderGc({ color }).color, color);
  for (const color of ['red"><x>', "red;top:0", "url(x)", "a:b"])
    assert.equal(sanitizeSliderGc({ color }).color, undefined);
  assert.equal(sanitizeSliderGc({ thickness: "" }).thickness, undefined);
  assert.equal(sanitizeSliderGc({ thickness: " 8 " }).thickness, 8);
});

test("brightness and speed use one curve, exact at the ends and round-tripping", () => {
  // 0 % is 0 (brightness 0: off; speed 0), 1 % brightness the lamp's lowest.
  assert.deepEqual(
    [brightnessPctToRaw(0), brightnessPctToRaw(1), brightnessPctToRaw(100), brightnessRawToPct(3)],
    [0, 3, 255, 1],
  );
  assert.deepEqual(
    [speedPctToRaw(0), speedPctToRaw(100), speedRawToPct(0), speedRawToPct(50)],
    [0, 255, 0, 20],
  );
  for (let pct = 0; pct <= 100; pct++) {
    assert.equal(brightnessRawToPct(brightnessPctToRaw(pct)), pct);
    assert.equal(speedRawToPct(speedPctToRaw(pct)), pct);
  }
  // A device value above 0 never reads 0 %; out-of-range values clamp.
  assert.deepEqual([speedRawToPct(1), brightnessRawToPct(2)], [1, 1]);
  assert.deepEqual([brightnessRawToPct(-4), brightnessRawToPct(300)], [0, 100]);
  // The raw-value display uses the same ranges.
  assert.deepEqual(
    [lightSliderConfig({}, "brightness").rawMin, lightSliderConfig({}, "speed").rawMin],
    [0, 0],
  );
});
