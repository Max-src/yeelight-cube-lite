import assert from "node:assert/strict";
import test from "node:test";

const WWW = "../custom_components/yeelight_cube/www";
const { createRafLoop } = await import(`${WWW}/matrix-animator.js`);
const { AnimatedPreview, PreviewClock } = await import(`${WWW}/preview-animation.js`);
const { acquireStreamFrames } = await import(`${WWW}/stream-frames.js`);
const { nativeEffectCatalog, withNativeEffectCatalog, CATALOG_RETRY_MS } =
  await import(`${WWW}/native-effect-catalog.js`);
const { loadBuiltinPixelArts, BUILTIN_PIXEL_ARTS_RETRY_MS } = await import(
  `${WWW}/pixel-art-utils.js`
);
const { lookupNativeClockFont } = await import(`${WWW}/clock-preview-utils.js`);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// requestAnimationFrame by hand: `frame(t)` runs the callbacks waiting.
function fakeFrames() {
  const waiting = new Map();
  let next = 1;
  let requested = 0;
  globalThis.requestAnimationFrame = (callback) => {
    requested += 1;
    waiting.set(next, callback);
    return next++;
  };
  globalThis.cancelAnimationFrame = (id) => waiting.delete(id);
  return {
    frame(t) {
      const callbacks = [...waiting.values()];
      waiting.clear();
      callbacks.forEach((callback) => callback(t));
    },
    get requested() {
      return requested;
    },
    get pending() {
      return waiting.size;
    },
  };
}

// A clock run by hand (ms).
const manual = () => {
  let time = 0;
  return { now: () => time, go: (ms) => (time += ms) };
};

test("every preview loop of the page shares one animation frame", () => {
  const frames = fakeFrames();
  const calls = { a: 0, b: 0 };
  const a = createRafLoop(() => calls.a++, { minIntervalMs: 0 });
  const b = createRafLoop(() => calls.b++, { minIntervalMs: 0 });
  a.start();
  b.start();
  a.start();
  // One callback requested for both, once per refresh.
  assert.equal(frames.pending, 1);
  frames.frame(16);
  assert.deepEqual(calls, { a: 1, b: 1 });
  assert.equal(frames.pending, 1);
  a.stop();
  assert.equal(a.running, false);
  assert.equal(b.running, true);
  frames.frame(32);
  assert.deepEqual(calls, { a: 1, b: 2 });
  // The last one stopped: no frame is asked for any more.
  b.stop();
  assert.equal(frames.pending, 0);
});

test("a preview's clock holds while frozen and goes on from there", () => {
  const time = manual();
  const clock = new PreviewClock({ now: time.now });
  assert.equal(clock.advance(false), 0);
  time.go(1000);
  assert.equal(clock.advance(false), 1);
  time.go(1000);
  assert.equal(clock.advance(true), 1);
  time.go(5000);
  assert.equal(clock.advance(true), 1);
  // Resumed: from the held moment, not the time spent frozen.
  time.go(500);
  assert.equal(clock.advance(false), 1.5);
  clock.reset();
  assert.equal(clock.advance(false), 0);
  // maxStep: a long pause adds at most one step.
  const capped = new PreviewClock({ now: time.now, maxStep: 200 });
  capped.advance();
  time.go(10000);
  assert.equal(capped.advance(), 0.2);
});

test("a preview skips a paint that changes nothing", () => {
  const preview = new AnimatedPreview(null, { onFrame() {} });
  const frame = [[1, 2, 3]];
  const dots = {};
  assert.equal(preview.samePaint(frame, 1, dots), false);
  assert.equal(preview.samePaint(frame, 1, dots), true);
  // Another brightness, new dots: painted.
  assert.equal(preview.samePaint(frame, 0.5, dots), false);
  assert.equal(preview.samePaint(frame, 0.5, {}), false);
  preview.forgetPaint();
  assert.equal(preview.samePaint(frame, 0.5, dots), false);
  // The same render between due frames stays; a due frame paints.
  assert.equal(preview.sameRender(0.05, true), false);
  assert.equal(preview.sameRender(0.06, false), true);
  assert.equal(preview.sameRender(0.09, false), false);
  assert.equal(preview.sameRender(0.09, true), false);
});

// A connection whose stream_frames subscription is driven by hand.
function streamConnection() {
  const connection = { subscribed: 0, unsubscribed: 0, send: null };
  connection.subscribeMessage = (callback) => {
    connection.subscribed += 1;
    connection.send = callback;
    return Promise.resolve(() => {
      connection.unsubscribed += 1;
    });
  };
  return connection;
}

const base64 = (bytes) => Buffer.from(bytes).toString("base64");

test("streamed frames are unpacked when shown, once per frame", async () => {
  const connection = streamConnection();
  const stream = acquireStreamFrames(connection, "light.unpack");
  assert.equal(stream.latest(), null);
  const realAtob = globalThis.atob;
  let unpacked = 0;
  globalThis.atob = (text) => {
    unpacked += 1;
    return realAtob(text);
  };
  try {
    // 25 frames a second arrive; none unpacked until a preview asks.
    for (let index = 0; index < 5; index += 1)
      connection.send({ frame: base64([index, 0, 0]) });
    assert.equal(unpacked, 0);
    const first = stream.latest();
    assert.deepEqual(first, [[4, 0, 0]]);
    // Asked again without a new frame: the same array, not unpacked again.
    assert.equal(stream.latest(), first);
    assert.equal(unpacked, 1);
    connection.send({ frame: base64([9, 9, 9]) });
    assert.deepEqual(stream.latest(), [[9, 9, 9]]);
    assert.equal(unpacked, 2);
  } finally {
    globalThis.atob = realAtob;
    stream.release();
  }
  await settle();
  assert.equal(connection.unsubscribed, 1);
});

test("a preview off screen receives no streamed frames", async () => {
  // IntersectionObserver by hand: `show(false)` scrolls the card away.
  let report = null;
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      report = (isIntersecting) => callback([{ isIntersecting }]);
    }
    observe() {}
    disconnect() {}
  };
  fakeFrames();
  try {
    const connection = streamConnection();
    let shown = 0;
    const preview = new AnimatedPreview({}, { onFrame() {}, onShown: () => shown++ });
    preview.start();
    assert.equal(preview.running, true);
    connection.send?.({});
    assert.equal(preview.streamed(connection, "light.away"), null);
    assert.equal(connection.subscribed, 1);
    report(false);
    await settle();
    // Off screen: the loop stops and the subscription goes.
    assert.equal(preview.running, false);
    assert.equal(connection.unsubscribed, 1);
    assert.equal(preview.streamed(connection, "light.away"), null);
    assert.equal(connection.subscribed, 1);
    // Back: the loop again, painted at once, subscribed when asked.
    report(true);
    assert.equal(preview.running, true);
    assert.equal(shown, 1);
    preview.streamed(connection, "light.away");
    assert.equal(connection.subscribed, 2);
    preview.disconnect();
    assert.equal(preview.running, false);
  } finally {
    delete globalThis.IntersectionObserver;
  }
});

// A Home Assistant whose catalogue requests are answered by hand.
function catalogHass(key, entity = "light.catalog") {
  const requests = [];
  const hass = {
    connection: {},
    states: { [entity]: { attributes: { native_effect_catalog_key: key } } },
    callWS: (message) =>
      new Promise((resolve, reject) => requests.push({ message, resolve, reject })),
  };
  return { hass, requests };
}


test("the native effect catalogue is fetched once per key and shared", async () => {
  const { hass, requests } = catalogHass("k1");
  const card = { updates: 0, requestUpdate() {
    this.updates += 1;
  } };
  assert.equal(nativeEffectCatalog(hass, "light.catalog", card), null);
  assert.equal(nativeEffectCatalog(hass, "light.catalog", card), null);
  // One request in flight, whoever asks.
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].message, {
    type: "yeelight_cube/native_effect_catalog",
    entity_id: "light.catalog",
  });
  const catalog = [{ name: "Rainbow", directions: [] }];
  requests[0].resolve({ key: "k1", catalog });
  await settle();
  // The card waiting is told once.
  assert.equal(card.updates, 1);
  assert.equal(nativeEffectCatalog(hass, "light.catalog", card), catalog);
  assert.equal(requests.length, 1);
  // A new key: fetched again, the previous one shown meanwhile.
  hass.states["light.catalog"].attributes.native_effect_catalog_key = "k2";
  assert.equal(nativeEffectCatalog(hass, "light.catalog"), catalog);
  assert.equal(requests.length, 2);
  // The attributes with it, the same object while nothing changes.
  const attrs = hass.states["light.catalog"].attributes;
  const shown = withNativeEffectCatalog(attrs, catalog);
  assert.equal(shown.native_effect_catalog, catalog);
  assert.equal(withNativeEffectCatalog(attrs, catalog), shown);
  // An integration sending it as an attribute: read as it is.
  const older = { native_effect_catalog: [{ name: "Tide" }] };
  const olderHass = { states: { "light.old": { attributes: older } }, callWS: () => assert.fail() };
  assert.equal(nativeEffectCatalog(olderHass, "light.old"), older.native_effect_catalog);
  assert.equal(withNativeEffectCatalog(older, catalog), older);
});

test("a failed catalogue request is tried again after a delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { hass, requests } = catalogHass("k1", "light.failing");
  const card = { updates: 0, requestUpdate() {
    this.updates += 1;
  } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    nativeEffectCatalog(hass, "light.failing", card);
    requests[0].reject(new Error("unknown command"));
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    // Every update meanwhile: no new request.
    nativeEffectCatalog(hass, "light.failing", card);
    assert.equal(requests.length, 1);
    t.mock.timers.tick(CATALOG_RETRY_MS);
    // The card is told, renders and asks again.
    assert.equal(card.updates, 1);
    nativeEffectCatalog(hass, "light.failing", card);
    assert.equal(requests.length, 2);
  } finally {
    console.warn = warn;
  }
});

test("a failed official pixel arts request waits before the next", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  let calls = 0;
  const hass = {
    connection: {},
    callWS: () => {
      calls += 1;
      return Promise.reject(new Error("down"));
    },
  };
  const first = loadBuiltinPixelArts(hass);
  await assert.rejects(first);
  // Every Home Assistant update meanwhile: the same failure, no new call.
  assert.equal(loadBuiltinPixelArts(hass), first);
  assert.equal(calls, 1);
  t.mock.timers.tick(BUILTIN_PIXEL_ARTS_RETRY_MS);
  await assert.rejects(loadBuiltinPixelArts(hass));
  assert.equal(calls, 2);
});

test("a missing clock font sensor is not looked for on every update", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  let reads = 0;
  const states = () =>
    new Proxy(
      { "light.a": { attributes: {} } },
      {
        ownKeys(target) {
          reads += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
  const registry = {};
  let cache = lookupNativeClockFont(states(), null, registry);
  assert.equal(reads, 1);
  // New states (another entity changed): not scanned again yet.
  cache = lookupNativeClockFont(states(), cache, registry);
  assert.equal(reads, 1);
  // A new entity (the registry changes): scanned again at once.
  cache = lookupNativeClockFont(states(), cache, {});
  assert.equal(reads, 2);
  // Without a registry (an older Home Assistant): every new states object.
  lookupNativeClockFont(states(), lookupNativeClockFont(states(), null));
  assert.equal(reads, 4);
  // Its attributes may come later: scanned again after a while.
  t.mock.timers.tick(10000);
  const sensor = { attributes: { font_maps: { native: { 1: [] } } } };
  cache = lookupNativeClockFont({ "sensor.font": sensor }, cache, registry);
  assert.equal(cache.entityId, "sensor.font");
});
