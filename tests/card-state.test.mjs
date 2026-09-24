import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GradientPreviewStore } from "../custom_components/yeelight_cube/www/gradient-preview-store.js";
import { CardCommandController } from "../custom_components/yeelight_cube/www/card-command-controller.js";
import { CollectionState } from "../custom_components/yeelight_cube/www/collection-state.js";
import { AngleCommandController } from "../custom_components/yeelight_cube/www/angle-wheel-utils.js";

test("angle commands coalesce unsent values and preserve target snapshots", async () => {
  const calls = [],
    applied = [];
  let finish;
  const hass = {
    callService(domain, service, data) {
      calls.push(data);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const angles = new AngleCommandController((angle) => applied.push(angle));
  const config = { target_entities: ["light.a"] };
  angles.schedule(hass, config, -10);
  config.target_entities[0] = "light.b";
  const running = angles.flush();
  assert.deepEqual(calls[0], { entity_id: "light.a", angle: 350 });
  angles.schedule(hass, config, 20, true);
  angles.schedule(hass, config, 30, true);
  finish();
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
  assert.deepEqual(calls[1], { entity_id: "light.b", angle: 30 });
  assert.equal(calls.length, 2);
  angles.reset();
  finish();
  await running;
  assert.deepEqual(applied, [350]);
  angles.schedule(hass, config, 40);
  angles.reset();
  await angles.flush();
  assert.equal(calls.length, 2);
  assert.equal(angles.schedule(hass, config, Infinity), false);
});

test("collection reconciliation requires content confirmation and isolates rollbacks", () => {
  const collection = new CollectionState();
  const original = [{ name: "A" }, { name: "B" }];
  const first = collection.record(original.toReversed(), 100);
  assert.deepEqual(collection.observe(original, 2, 200), original.toReversed());
  const second = collection.record([{ name: "B" }], 300);
  assert.equal(collection.rollback(first), false);
  assert.deepEqual(collection.observe([{ name: "A" }], 1, 400), [
    { name: "B" },
  ]);
  collection.observe([{ name: "B" }], 1, 500);
  assert.equal(collection.pending, null);
  assert.equal(collection.rollback(second), false);
  collection.record(original, 600);
  assert.deepEqual(collection.observe([], 0, 6000), []);
});

test("Palette rename completion never mutates an HA item at a stale index", async () => {
  let finish;
  const palettes = [
    { name: "A", colors: [[1, 2, 3]] },
    { name: "B", colors: [[4, 5, 6]] },
  ];
  const card = {
    config: { palette_sensor: "sensor.palette" },
    _hass: {
      states: { "sensor.palette": { attributes: { palettes_v2: palettes } } },
      callService: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    render() {},
    _paletteItems: cardMethod("yeelight-cube-palette-card", "_paletteItems"),
    _mutatePalettes: cardMethod(
      "yeelight-cube-palette-card",
      "_mutatePalettes",
      { CollectionState },
    ),
  };
  const rename = cardMethod("yeelight-cube-palette-card", "_renamePalette", {
    prompt: () => "Renamed A",
  });
  const result = rename.call(card, 0, "A", null);
  await Promise.resolve();
  palettes.reverse();
  finish();
  assert.equal(await result, true);
  assert.deepEqual(
    palettes.map((item) => item.name),
    ["B", "A"],
  );
  assert.deepEqual(
    card._collection.pending.items.map((item) => item.name),
    ["Renamed A", "B"],
  );
});

test("colour-save failures roll back only their own pending edit", async (context) => {
  context.mock.method(console, "error", () => {});
  const pending = {};
  const commit = cardMethod(
    "yeelight-cube-color-list-editor-card",
    "_commitColors",
    {
      PENDING_COLORS_STORE: pending,
      CardCommandController,
      CustomEvent: class {
        constructor(type, options) {
          Object.assign(this, { type }, options);
        }
      },
    },
  );
  let fail;
  const notices = [];
  const card = {
    _hass: {
      callService: () =>
        new Promise((resolve, reject) => {
          fail = reject;
        }),
    },
    render() {},
    dispatchEvent(event) {
      notices.push(event);
    },
  };
  const older = { colors: [[1, 2, 3]] };
  const newer = { colors: [[4, 5, 6]] };
  pending["light.a"] = older;
  const first = commit.call(card, "light.a", older, { entity: "light.a" });
  await Promise.resolve();
  pending["light.a"] = newer;
  fail(Error("offline"));
  assert.equal(await first, false);
  assert.equal(pending["light.a"], newer);
  assert.equal(notices.length, 0);
  const second = commit.call(card, "light.a", newer, { entity: "light.a" });
  await Promise.resolve();
  fail(Error("offline again"));
  assert.equal(await second, false);
  assert.equal(pending["light.a"], undefined);
  assert.equal(notices[0].detail.message, "offline again");
});

test("Gradient shares requests and notifies every subscriber, isolating entities", async () => {
  let callback,
    subscriptions = 0,
    unsubscriptions = 0,
    requests = 0,
    finish;
  const store = new GradientPreviewStore({
    subscribeEvents(notify) {
      subscriptions++;
      callback = notify;
      return () => unsubscriptions++;
    },
  });
  const updates = [0, 0, 0];
  const remove = updates.map((_, index) =>
    store.subscribe(
      index === 2 ? "light.b" : "light.a",
      () => updates[index]++,
    ),
  );
  const hass = {
    callService: () => {
      requests++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const first = store.request(hass, "light.a");
  const second = store.request(hass, "light.a");
  assert.equal(first, second);
  await store.connect();
  await Promise.resolve();
  assert.equal(subscriptions, 1);
  assert.equal(requests, 1);
  const data = { entity_id: "light.a", previews: { normal: [[255, 0, 0]] } };
  callback({ data });
  callback({ data });
  assert.deepEqual(updates, [1, 1, 0]);
  callback({ data: { ...data, previews: { normal: [[0, 255, 0]] } } });
  assert.deepEqual(updates, [2, 2, 0]);
  finish();
  await first;
  remove.forEach((unsubscribe) => unsubscribe());
  await Promise.resolve();
  assert.equal(unsubscriptions, 1);
});

test("Gradient releases subscriptions that resolve after the last view disconnects", async () => {
  let resolve,
    released = 0;
  const store = new GradientPreviewStore({
    subscribeEvents: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const remove = store.subscribe("light.a", () =>
    assert.fail("disconnected view"),
  );
  const ready = store.connect();
  await Promise.resolve();
  remove();
  resolve(() => released++);
  await ready;
  await Promise.resolve();
  assert.equal(released, 1);
});

function cardMethod(file, name, scope = {}, setter = false) {
  const source = readFileSync(
    new URL(
      `../custom_components/yeelight_cube/www/${file}.js`,
      import.meta.url,
    ),
    "utf8",
  );
  const match = source.match(
    new RegExp(
      `  ${setter ? "set " : "(async )?"}${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`,
    ),
  );
  assert.ok(match, `${file}.${name} exists`);
  const object = new Function(...Object.keys(scope), `return ({${match[0]}})`)(
    ...Object.values(scope),
  );
  return setter
    ? Object.getOwnPropertyDescriptor(object, name).set
    : object[name];
}

test("Draw overlays only its pending collection and accepts unrelated HA updates", () => {
  const setter = cardMethod("yeelight-cube-draw-card", "hass", {}, true);
  const original = [{ name: "A" }, { name: "B" }];
  const pending = original.toReversed();
  const makeHass = (arts, state) => ({
    states: {
      "sensor.art": {
        attributes: { pixel_arts: arts, count: 2, content_hash: "old" },
      },
      "light.a": { state, attributes: {} },
    },
  });
  const card = {
    config: { pixelart_sensor: "sensor.art", palette_sensor: "sensor.palette" },
    entity: "light.a",
    _hass: makeHass(original, "off"),
    _pixelArtCollection: new CollectionState(),
    get _pendingReorderedPixelArts() {
      return this._pixelArtCollection.pending?.items ?? null;
    },
    _lastPixelArtCount: 2,
    _lastPixelArtHash: "old",
  };
  card._pixelArtCollection.record(pending);
  const incoming = makeHass(original, "on");
  setter.call(card, incoming);
  assert.equal(card._hass.states["light.a"].state, "on");
  assert.deepEqual(
    card._hass.states["sensor.art"].attributes.pixel_arts,
    pending,
  );
  assert.deepEqual(
    incoming.states["sensor.art"].attributes.pixel_arts,
    original,
  );
  setter.call(card, makeHass(pending, "off"));
  assert.equal(card._pendingReorderedPixelArts, null);
  assert.equal(card._hass.states["light.a"].state, "off");
});

test("lamp adjustment timers and stale failures cannot cross configuration contexts", async () => {
  const timers = new Map();
  let serial = 0;
  const scope = {
    setTimeout(callback) {
      timers.set(++serial, callback);
      return serial;
    },
    clearTimeout(timer) {
      timers.delete(timer);
    },
    requestAnimationFrame() {},
    EFFECT_NAMES: ["contrast"],
    EFFECT_ATTR_MAP: { contrast: "preview_contrast" },
    EFFECT_DEFAULTS: { contrast: 100 },
  };
  const change = cardMethod(
    "yeelight-cube-lamp-preview-card",
    "handleEffectChange",
    scope,
  );
  const configure = cardMethod(
    "yeelight-cube-lamp-preview-card",
    "setConfig",
    scope,
  );
  const calls = [];
  let reject;
  const card = {
    shadowRoot: {},
    _hass: {
      states: { "light.a": { attributes: {} }, "light.b": { attributes: {} } },
      callService(...args) {
        calls.push(args);
        return new Promise((resolve, fail) => {
          reject = fail;
        });
      },
    },
    _updateEffectLabel() {},
    _updateChangeIndicators() {},
    _updateCompactResetButtons() {},
    _updateSectionResetButtons() {},
    render() {
      assert.fail("stale failure must not render");
    },
  };
  configure.call(card, { entity: "light.a" });
  await change.call(card, "contrast", { target: { value: "75" } });
  const obsolete = timers.get(card._effectDebounceTimer);
  configure.call(card, { entity: "light.b" });
  assert.equal(timers.size, 0);
  await obsolete();
  assert.equal(calls.length, 0);
  assert.deepEqual(card._localEffects, {});
  await change.call(card, "contrast", { target: { value: "80" } });
  const running = timers.get(card._effectDebounceTimer)();
  assert.equal(calls[0][2].entity_id, "light.b");
  configure.call(card, { entity: "light.a" });
  card._localEffects.contrast = 90;
  reject(Error("offline"));
  await running;
  assert.equal(card._localEffects.contrast, 90);
});

test("collection commands serialize snapshots and cancel dependent work after failure", async () => {
  const collection = new CollectionState();
  const calls = [];
  let fail;
  const hass = {
    callService(domain, service, data) {
      calls.push({ service, data });
      return new Promise((resolve, reject) => {
        fail = reject;
      });
    },
  };
  const data = { idx: 1 };
  const first = collection.execute(hass, "remove_palette", data);
  const second = collection.execute(hass, "rename_palette", {
    idx: 1,
    name: "B",
  });
  data.idx = 3;
  await Promise.resolve();
  assert.equal(calls[0].data.idx, 1);
  fail(Error("offline"));
  await assert.rejects(first, /offline/);
  assert.equal(await second, false);
  assert.equal(calls.length, 1);
  const third = collection.execute(
    { callService: async () => {} },
    "remove_palette",
    { idx: 0 },
  );
  assert.equal(await third, true);
});

test("Draw ignores a collection fetch completed after reconfiguration", async () => {
  let finish;
  const hass = {
    callApi: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  const card = {
    _hass: hass,
    _collectionContext: 1,
    requestUpdate() {
      assert.fail("stale fetch rendered");
    },
  };
  const fetch = cardMethod("yeelight-cube-draw-card", "_fetchFreshPixelArts");
  const result = fetch.call(card, "sensor.old");
  card._collectionContext++;
  finish({ attributes: { pixel_arts: [{ name: "Old" }] } });
  await result;
  assert.equal(card._hass, hass);
  assert.equal(card._freshPixelArts, undefined);
});
