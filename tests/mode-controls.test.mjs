import test from "node:test";
import assert from "node:assert/strict";
import {
  ModeControlsController,
  modeCollectionKey,
  nextRotationMode,
  rotationIntervalMs,
} from "../custom_components/yeelight_cube/www/mode-controls-controller.js";

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
  controller.configure(
    { rotation_source: "custom", rotation_modes: ["A", "B"] },
    ["light.a"],
  );
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
  assert.equal(nextRotationMode(["A", "B"], "A", true), "B");
  assert.equal(rotationIntervalMs({ rotation_interval: 1 }), 10000);
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
