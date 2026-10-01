import assert from "node:assert/strict";
import test from "node:test";

// slider-control-utils.js pulls in the bundled Lit (via the editor helpers),
// which touches a few browser globals while loading. A minimal shim is enough:
// the behaviour under test is plain JS and never renders.
globalThis.window ??= globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { define() {}, get() {} };
globalThis.document ??= {
  createComment: () => ({}),
  createTreeWalker: () => ({}),
  createElement: () => ({ setAttribute() {} }),
  addEventListener() {},
  removeEventListener() {},
};
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
} =
  await import("../custom_components/yeelight_cube/www/slider-control-utils.js");

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
  const host = {};
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
    assert.equal(host._anySliderDragging, true);
    assert.ok(doc.held());
    doc.release();
    await wait(70);
    assert.equal(host._anySliderDragging, false);
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
    assert.equal(host._anySliderDragging, true);
    await wait(30);
    assert.deepEqual(commits, [55]);
    assert.equal(host._anySliderDragging, false);
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

test("slider markup is kept unchanged while a drag is held", () => {
  const host = {};
  assert.equal(stableSliderMarkup(host, "s", "<a value=1>"), "<a value=1>");
  host._anySliderDragging = true;
  assert.equal(stableSliderMarkup(host, "s", "<a value=9>"), "<a value=1>");
  host._anySliderDragging = false;
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
  assert.deepEqual(
    [brightnessPctToRaw(1), brightnessPctToRaw(100), brightnessRawToPct(3)],
    [3, 255, 1],
  );
  assert.deepEqual([speedPctToRaw(1), speedPctToRaw(100), speedRawToPct(50)], [1, 255, 20]);
  for (let pct = 1; pct <= 100; pct++) {
    assert.equal(brightnessRawToPct(brightnessPctToRaw(pct)), pct);
    assert.equal(speedRawToPct(speedPctToRaw(pct)), pct);
  }
  // Out-of-range device values clamp (a lamp reporting 0 or 256).
  assert.deepEqual([brightnessRawToPct(0), brightnessRawToPct(300)], [1, 100]);
  // The raw-value display uses the same ranges.
  assert.deepEqual(
    [lightSliderConfig({}, "brightness").rawMin, lightSliderConfig({}, "speed").rawMin],
    [3, 1],
  );
});
