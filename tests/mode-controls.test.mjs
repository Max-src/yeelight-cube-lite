import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ModeControlsController,
  favouriteId,
  sanitizeFavourites,
  modeCollectionKey,
  nextRotationMode,
  rotationIntervalMs,
  rotationIntervalParts,
  formatRotationInterval,
  actionButtonOrder,
  ACTION_BUTTON_KEYS,
} from "../custom_components/yeelight_cube/www/mode-controls-controller.js";

test("favourites preview frames render at current time, not phase 0", () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/mode-controls-ui.js",
      import.meta.url,
    ),
    "utf8",
  );
  const match = source.match(/  _preview\(favourite\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "_preview method not found");
  const phases = [];
  const preview = new Function(
    "html",
    "unsafeHTML",
    "renderMatrixPreview",
    "performance",
    `return function(favourite) {${match[1]}}`,
  )(
    (strings, ...values) => ({ strings, values }),
    (value) => value,
    () => "",
    { now: () => 12345 },
  );
  const view = {
    model: {
      config: {},
      adapter: {
        frame: (key, phase, colorMode, color) => {
          phases.push([phase, colorMode, color]);
          return [[1, 2, 3]];
        },
      },
    },
  };
  preview.call(view, {
    key: "Rainbow",
    colorMode: "red_blue",
    color: [1, 2, 3],
  });
  // A phase of 0 here flashes the animation's first frame on every Lit
  // re-render (the favourites blink); the frame must match the RAF loop's
  // timebase (now / 1000) so re-renders are seamless. The recorded colour
  // mode/colour must ride along so a favourite keeps its own look.
  assert.deepEqual(phases, [[12.345, "red_blue", [1, 2, 3]]]);
});

function fixture(overrides = {}) {
  const calls = [];
  const controller = new ModeControlsController({
    kind: "clock",
    current: () => "A",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    apply: async (name) => {
      calls.push(name);
    },
    ...overrides,
  });
  controller.configure({}, ["light.a"]);
  // Rotation always follows the favourites list.
  controller.favourites = [
    { key: "A", colorMode: "normal" },
    { key: "B", colorMode: "normal" },
  ];
  return { controller, calls };
}

test("collection keys isolate domains and normalize targets", () => {
  assert.equal(
    modeCollectionKey("native", ["b", "a", "b"]),
    "yeelight-native-collections:a,b",
  );
  assert.notEqual(
    modeCollectionKey("native", ["a"]),
    modeCollectionKey("clock", ["a"]),
  );
});
test("rotation uses available unique modes and bounds intervals", () => {
  const { controller } = fixture({ available: (name) => name === "B" });
  assert.deepEqual(controller.names(), ["B"]);
  assert.equal(nextRotationMode(["A", "B"], "A"), "B");
  assert.equal(nextRotationMode(["A", "B"], "B"), "A");
  assert.equal(rotationIntervalMs({ rotation_interval: 1 }), 10000);
  assert.equal(rotationIntervalMs({ rotation_interval: 9999999 }), 604800000);
  assert.deepEqual(rotationIntervalParts(90), { value: 90, unit: "seconds" });
  assert.deepEqual(rotationIntervalParts(3600), { value: 1, unit: "hours" });
  assert.deepEqual(rotationIntervalParts(172800), { value: 2, unit: "days" });
  assert.equal(formatRotationInterval(600), "10min");
  assert.equal(formatRotationInterval(86400), "1d");
});
test("shuffle reorders and persists the favourites list itself", () => {
  const { controller } = fixture();
  controller.favourites = [
    { key: "A", colorMode: "normal" },
    { key: "B", colorMode: "normal" },
    { key: "C", colorMode: "normal" },
  ];
  let notified = 0;
  controller.listeners.add(() => notified++);
  controller.shuffleFavourites(() => 0);
  assert.deepEqual(controller.favourites, [
    { key: "B", colorMode: "normal" },
    { key: "C", colorMode: "normal" },
    { key: "A", colorMode: "normal" },
  ]);
  assert.ok(notified > 0);
  // A random source pinned at its maximum is the identity permutation.
  controller.shuffleFavourites(() => 0.999);
  assert.deepEqual(controller.favourites, [
    { key: "B", colorMode: "normal" },
    { key: "C", colorMode: "normal" },
    { key: "A", colorMode: "normal" },
  ]);
});

test("legacy string favourites migrate to normal colour mode", () => {
  const { controller } = fixture();
  controller.favourites = ["A", "B"];
  assert.deepEqual(controller.names(), ["A", "B"]);
  assert.deepEqual(controller.rotationItems(), [
    { name: "A", color_mode: "normal" },
    { name: "B", color_mode: "normal" },
  ]);
  assert.equal(controller.hasFavourite("A"), true);
});

test("favourites record their active colour mode", () => {
  const { controller } = fixture({
    current: () => "B",
    currentColorMode: () => "red_blue",
  });
  controller.favourites = [{ key: "A", colorMode: "normal" }];
  controller.toggleFavourite();
  assert.deepEqual(controller.favourites, [
    { key: "A", colorMode: "normal" },
    { key: "B", colorMode: "red_blue" },
  ]);
  assert.deepEqual(controller.rotationItems(), [
    { name: "A", color_mode: "normal" },
    { name: "B", color_mode: "red_blue" },
  ]);
  // Toggling again removes only the matching colour-mode entry.
  controller.toggleFavourite();
  assert.deepEqual(controller.favourites, [{ key: "A", colorMode: "normal" }]);
});

test("the same style can be favourited under multiple colour modes", () => {
  let mode = "normal";
  const { controller } = fixture({
    current: () => "A",
    currentColorMode: () => mode,
  });
  controller.favourites = [];
  controller.toggleFavourite();
  assert.deepEqual(controller.favourites, [{ key: "A", colorMode: "normal" }]);
  // Switching mode and toggling ADDS a second entry instead of removing the
  // existing Normal favourite.
  mode = "red_blue";
  controller.toggleFavourite();
  assert.deepEqual(controller.favourites, [
    { key: "A", colorMode: "normal" },
    { key: "A", colorMode: "red_blue" },
  ]);
  assert.equal(controller.hasFavourite("A", "normal"), true);
  assert.equal(controller.hasFavourite("A", "red_blue"), true);
  assert.equal(controller.hasFavourite("A", "bw"), false);
  // Rotation keeps both entries.
  assert.deepEqual(controller.rotationItems(), [
    { name: "A", color_mode: "normal" },
    { name: "A", color_mode: "red_blue" },
  ]);
  // Toggling in red_blue removes only the red_blue entry.
  controller.toggleFavourite();
  assert.deepEqual(controller.favourites, [{ key: "A", colorMode: "normal" }]);
});

test("selecting a saved favourite then removing it ignores stale live colour mode", async () => {
  let mode = "red_blue";
  const applied = [];
  const { controller } = fixture({
    currentColorMode: () => mode,
    applyFavourite: async (item) => applied.push(item),
  });
  const saved = { key: "A", colorMode: "bw" };
  controller.save([saved, { key: "A", colorMode: mode }]);
  assert.equal(await controller.chooseFavourite(saved), true);
  controller.update();
  assert.deepEqual(controller.currentFavourite(), saved);
  controller.toggleFavourite();
  assert.deepEqual(controller.favourites, [
    { key: "A", colorMode: "red_blue" },
  ]);
  assert.deepEqual(applied, [saved]);
  mode = "bw";
  controller.update();
  assert.equal(controller.selectedFavourite, null);
  mode = "red_blue";
  controller.update();
  assert.equal(controller.currentFavourite().colorMode, mode);
});

test("failed or obsolete favourite commands cannot change selected identity", async () => {
  const { controller } = fixture({ applyFavourite: async () => false });
  assert.equal(
    await controller.chooseFavourite({ key: "A", colorMode: "bw" }),
    false,
  );
  assert.equal(controller.currentFavourite().colorMode, "normal");
  let finish;
  controller.adapter.applyFavourite = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = controller.chooseFavourite({ key: "A", colorMode: "bw" });
  controller.toggleFavourite();
  assert.equal(controller.favourites.length, 2);
  controller.configure({}, ["light.other"]);
  finish(true);
  assert.equal(await pending, false);
  assert.equal(controller.selectedFavourite, null);
});

test("custom favourite identities preserve RGB snapshots through save, reload and reorder", () => {
  let rgb = [12, 34, 56];
  const { controller } = fixture({
    currentColorMode: () => "custom",
    currentColor: () => rgb,
  });
  controller.save([]);
  controller.toggleFavourite();
  rgb[0] = 99;
  controller.toggleFavourite();
  const saved = JSON.parse(JSON.stringify(controller.favourites));
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0].color, [12, 34, 56]);
  assert.notEqual(favouriteId(saved[0]), favouriteId(saved[1]));
  assert.deepEqual(sanitizeFavourites([...saved, saved[0]]), saved);
  controller.save([...saved].reverse());
  assert.deepEqual(controller.rotationItems()[0].color, [99, 34, 56]);
  controller.toggleFavourite();
  assert.deepEqual(controller.favourites, [saved[0]]);
});

test("backend rotation delegates start/stop/skip and survives disconnect", async () => {
  const calls = [];
  let remote = false;
  const adapter = {
    kind: "clock",
    current: () => "A",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    apply: async (name) => calls.push(["apply", name]),
    startRotation: async (names, interval) =>
      calls.push(["start", names, interval]),
    stopRotation: () => calls.push(["stop"]),
    skipRotation: () => calls.push(["skip"]),
    rotationActive: () => remote,
  };
  const controller = new ModeControlsController(adapter);
  controller.configure({ rotation_interval: 120 }, ["light.a"]);
  controller.favourites = ["A", "B"];
  await controller.start();
  assert.deepEqual(calls, [
    [
      "start",
      [
        { name: "A", color_mode: "normal" },
        { name: "B", color_mode: "normal" },
      ],
      120,
    ],
  ]);
  assert.equal(controller.active, true);
  controller.stop();
  assert.deepEqual(calls.at(-1), ["stop"]);
  // Remote state is mirrored without a timed optimistic grace window.
  calls.length = 0;
  controller.active = false;
  remote = true;
  controller.update();
  assert.equal(controller.active, true);
  controller.skip();
  assert.deepEqual(calls, [["skip"]]);
  // Disconnect (page refresh) must NOT stop the backend loop.
  calls.length = 0;
  controller.active = true;
  controller.disconnect();
  assert.deepEqual(calls, []);
  // Stopping while inactive must not send a backend stop.
  calls.length = 0;
  controller.active = false;
  controller.stop();
  assert.deepEqual(calls, []);
});

test("an observing card cannot stop backend rotation from local favourites or readiness", () => {
  const calls = [];
  const { controller } = fixture({
    startRotation: async () => true,
    stopRotation: () => calls.push("stop"),
    rotationActive: () => true,
    ready: () => false,
  });
  controller.favourites = [];
  controller.update();
  assert.deepEqual(calls, []);
  assert.equal(controller.active, true);
  controller.save([]);
  assert.deepEqual(calls, []);
  controller.disconnect();
  assert.deepEqual(calls, []);
});

test("backend rotation start failures roll back and surface an error", async () => {
  const returnsFalse = new ModeControlsController({
    kind: "clock",
    current: () => "A",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    apply: async () => true,
    startRotation: async () => false,
  });
  returnsFalse.configure({}, ["light.a"]);
  returnsFalse.favourites = ["A", "B"];
  await returnsFalse.start();
  assert.equal(returnsFalse.active, false);
  assert.match(returnsFalse.error, /could not be started/i);

  const throws = new ModeControlsController({
    kind: "clock",
    current: () => "A",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    apply: async () => true,
    startRotation: async () => {
      throw new Error("Service not found");
    },
  });
  throws.configure({}, ["light.a"]);
  throws.favourites = ["A", "B"];
  await throws.start();
  assert.equal(throws.active, false);
  assert.equal(throws.error, "Service not found");
});

test("rotation refuses to start when the backend lacks the capability", async () => {
  const calls = [];
  const controller = new ModeControlsController({
    kind: "native",
    current: () => "A",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    apply: async () => true,
    startRotation: async (...args) => calls.push(args),
    rotationSupported: () => false,
  });
  controller.configure({}, ["light.a"]);
  controller.favourites = ["A", "B"];
  await controller.start();
  assert.equal(controller.active, false);
  assert.deepEqual(calls, []);
  assert.match(controller.error, /restart Home Assistant/i);
});

test("backend rotation waits for start acknowledgement and mirrors failures without a grace delay", async () => {
  let remote = false;
  let finish;
  let error = "";
  const controller = new ModeControlsController({
    kind: "native",
    current: () => "A",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    apply: async () => true,
    startRotation: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    stopRotation: () => {},
    rotationActive: () => remote,
    rotationError: () => error,
  });
  controller.configure({}, ["light.a"]);
  controller.favourites = ["A", "B"];
  const starting = controller.start();
  assert.equal(controller.busy, true);
  assert.equal(controller.active, false);
  controller.update();
  assert.equal(controller.active, false);
  remote = true;
  finish(true);
  await starting;
  controller.update();
  assert.equal(controller.active, true);
  assert.equal(controller.busy, false);
  remote = false;
  error = "Device timeout";
  controller.update();
  assert.equal(controller.active, false);
  assert.equal(controller.error, error);
});
test("rotation waits for commands and cancellation prevents rescheduling", async () => {
  let finish;
  const { controller, calls } = fixture({
    apply: (name) => {
      calls.push(name);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  controller.start();
  assert.equal(controller.busy, true);
  controller.skip();
  assert.deepEqual(calls, ["B"]);
  controller.stop();
  finish(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.active, false);
  assert.equal(controller.timer, undefined);
});
test("off targets block rotation and failures stop it", async () => {
  const blocked = fixture({ ready: () => false });
  blocked.controller.start();
  assert.deepEqual(blocked.calls, []);
  const { controller } = fixture({
    apply: async () => {
      throw new Error("offline");
    },
  });
  controller.active = true;
  await controller.tick(controller.token);
  assert.equal(controller.active, false);
  assert.equal(controller.error, "offline");
});

test("rotation advances without waiting for a Home Assistant state echo", async () => {
  const { controller, calls } = fixture();
  controller.active = true;
  await controller.tick(controller.token);
  clearTimeout(controller.timer);
  await controller.tick(controller.token);
  controller.disconnect();
  assert.deepEqual(calls, ["B", "A"]);
});

test("reconfiguration invalidates in-flight commands and timers", async () => {
  let finish;
  const { controller } = fixture({
    apply: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const command = controller.select("B");
  controller.configure({}, ["light.other"]);
  finish(true);
  assert.equal(await command, false);
  assert.equal(controller.active, false);
  assert.equal(controller.busy, false);
});

test("action button order defaults to all keys, sanitizes and de-duplicates", () => {
  assert.deepEqual(actionButtonOrder({}), ACTION_BUTTON_KEYS);
  assert.deepEqual(
    actionButtonOrder({ action_buttons: ["power", "apply", "power", "bogus"] }),
    ["power", "apply"],
  );
  // An explicit empty list hides every action.
  assert.deepEqual(actionButtonOrder({ action_buttons: [] }), []);
});

test("freeze sends the freeze command, resumes by re-applying, and clears on any command", async () => {
  const calls = [];
  const { controller } = fixture({
    apply: async (name) => {
      calls.push(["apply", name]);
    },
    freeze: async () => {
      calls.push(["freeze"]);
    },
  });
  assert.equal(controller.frozen, false);
  await controller.freeze();
  assert.equal(controller.frozen, true);
  assert.deepEqual(calls, [["freeze"]]);
  // Toggling again resumes by re-applying the current mode (resending it).
  await controller.freeze();
  assert.equal(controller.frozen, false);
  assert.deepEqual(calls.at(-1), ["apply", "A"]);
  // A freeze followed by any other command clears the frozen mirror.
  await controller.freeze();
  assert.equal(controller.frozen, true);
  await controller.select("B");
  assert.equal(controller.frozen, false);
});

test("freeze failures leave the display unfrozen and surface the error", async () => {
  const { controller } = fixture({
    freeze: async () => {
      throw new Error("offline");
    },
  });
  await controller.freeze();
  assert.equal(controller.frozen, false);
  assert.equal(controller.error, "offline");
});

test("freeze is blocked for modes the adapter marks unfreezable", async () => {
  let compatible = false;
  const calls = [];
  const { controller } = fixture({
    freezable: () => compatible,
    freeze: async () => {
      calls.push("freeze");
    },
  });
  assert.equal(controller.freezable(), false);
  await controller.freeze();
  assert.equal(controller.frozen, false);
  assert.deepEqual(calls, []);
  compatible = true;
  await controller.freeze();
  assert.equal(controller.frozen, true);
  assert.deepEqual(calls, ["freeze"]);
});

test("frozen resets to idle when the displayed mode changes", async () => {
  let current = "A";
  const { controller } = fixture({
    current: () => current,
    freeze: async () => {},
  });
  await controller.freeze();
  assert.equal(controller.frozen, true);
  // A re-render with the same mode keeps it frozen.
  controller.update();
  assert.equal(controller.frozen, true);
  // Switching modes (e.g. selecting another effect from the grid) resumes.
  current = "B";
  controller.update();
  assert.equal(controller.frozen, false);
});
