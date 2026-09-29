import test from "node:test";
import assert from "node:assert/strict";
import { ModeControlsController } from "../custom_components/yeelight_cube/www/mode-controls-controller.js";
import {
  favouriteToItem,
  sharedFavourites,
  sharedRotationInterval,
} from "../custom_components/yeelight_cube/www/shared-lamp-settings.js";

// A browser-storage stand-in (favourites used to live only there).
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const KEY = "yeelight-clock-collections:light.a";
const A = { key: "A", colorMode: "normal" };
const B = { key: "B", colorMode: "normal" };
const C = { key: "C", colorMode: "custom", color: [1, 2, 3] };

// `lamp.favourites` is what the lamp publishes (undefined: not supported).
function setup({ lamp = { favourites: [] }, stored } = {}) {
  globalThis.localStorage = memoryStorage(
    stored ? { [KEY]: JSON.stringify({ favourites: stored }) } : {},
  );
  const saves = [];
  let resolveSave;
  const adapter = {
    kind: "clock",
    current: () => "A",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    apply: async () => true,
    favourites: () => lamp.favourites,
    saveFavourites: (list) => {
      saves.push(list);
      return new Promise((resolve) => (resolveSave = resolve));
    },
    frozen: () => lamp.frozen,
    rotationInterval: () => lamp.interval,
    setRotationInterval: (seconds) => {
      saves.push({ interval: seconds });
      return new Promise((resolve) => (resolveSave = resolve));
    },
    startRotation: async (items, interval) => {
      saves.push({ start: interval });
      return true;
    },
  };
  const controller = new ModeControlsController(adapter);
  let notified = 0;
  controller.listeners.add(() => notified++);
  controller.configure({ rotation_interval: 30 }, ["light.a"]);
  return {
    controller,
    lamp,
    saves,
    finishSave: (value = true) => resolveSave(value),
    notified: () => notified,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("every dashboard shows the lamp's favourites, not its own browser list", () => {
  const { controller, lamp } = setup({
    lamp: { favourites: [A, B] },
    stored: [C], // an old list in this browser
  });
  assert.deepEqual(controller.favourites, [A, B]);
  // The obsolete browser copy is dropped once the lamp has its own list.
  assert.equal(localStorage.getItem(KEY), null);
  // Another dashboard edits them: this one follows.
  lamp.favourites = [B];
  controller.update();
  assert.deepEqual(controller.favourites, [B]);
});

test("an edit shows at once and never jumps back while the lamp catches up", async () => {
  const { controller, lamp, saves, finishSave } = setup({
    lamp: { favourites: [A] },
  });
  controller.save([A, B]);
  assert.deepEqual(controller.favourites, [A, B]);
  assert.deepEqual(saves, [[A, B]]);
  // A state push from before the save still lists [A]: keep showing [A, B].
  controller.update();
  assert.deepEqual(controller.favourites, [A, B]);
  finishSave(true);
  await flush();
  lamp.favourites = [A, B];
  controller.update();
  assert.deepEqual(controller.favourites, [A, B]);
  // Once confirmed, the lamp is the reference again.
  lamp.favourites = [B];
  controller.update();
  assert.deepEqual(controller.favourites, [B]);
});

test("unchanged state pushes do not re-render the favourites", () => {
  const { controller, lamp, notified } = setup({ lamp: { favourites: [A, B] } });
  const list = controller.favourites;
  const before = notified();
  // HA sends a new attribute object on every state push.
  lamp.favourites = [{ ...A }, { ...B }];
  controller.update();
  assert.equal(controller.favourites, list);
  assert.equal(notified(), before);
});

test("a failed save shows the lamp's list again with an error", async () => {
  const { controller, finishSave } = setup({ lamp: { favourites: [A] } });
  controller.save([A, B]);
  finishSave(false);
  await flush();
  assert.deepEqual(controller.favourites, [A]);
  assert.match(controller.error, /could not be saved/);
});

test("a browser-kept list moves to the lamp once, then is forgotten", async () => {
  const { controller, saves, finishSave } = setup({
    lamp: { favourites: null }, // supported, never saved for this kind
    stored: [A, C],
  });
  assert.deepEqual(saves, [[A, C]]);
  assert.deepEqual(controller.favourites, [A, C]);
  controller.update();
  assert.equal(saves.length, 1); // not sent again while in flight
  finishSave(true);
  await flush();
  assert.equal(localStorage.getItem(KEY), null);
});

test("an older backend keeps favourites in browser storage", () => {
  const { controller, saves } = setup({ lamp: { favourites: undefined } });
  controller.save([A, B]);
  assert.deepEqual(saves, []);
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY)).favourites, [A, B]);
});

test("the freeze indicator follows the lamp, holding its own change until confirmed", async () => {
  const { controller, lamp } = setup({
    lamp: { favourites: [A, B], frozen: false },
  });
  // Frozen from another dashboard (or an automation).
  lamp.frozen = true;
  controller.update();
  assert.equal(controller.frozen, true);
  lamp.frozen = false;
  controller.update();
  assert.equal(controller.frozen, false);
  // Frozen here: the lamp reports it a moment later (applied in background).
  controller.adapter.freeze = async () => true;
  await controller.freeze();
  assert.equal(controller.frozen, true);
  controller.update(); // still the older frozen: false
  assert.equal(controller.frozen, true);
  lamp.frozen = true;
  controller.update();
  assert.equal(controller.frozen, true);
});

test("stored items convert both ways", () => {
  assert.deepEqual(favouriteToItem(C), {
    name: "C",
    color_mode: "custom",
    color: [1, 2, 3],
  });
  assert.deepEqual(favouriteToItem(A), { name: "A", color_mode: "normal" });
  const hass = {
    states: {
      "light.a": {
        attributes: {
          favourites: {
            clock: [
              { name: "C", color_mode: "custom", color: [1, 2, 3] },
              { name: "A", color_mode: "normal", color: null },
            ],
          },
        },
      },
      "light.old": { attributes: {} },
    },
  };
  const config = { target_entities: ["light.a"] };
  assert.deepEqual(sharedFavourites(hass, config, "clock"), [C, A]);
  assert.equal(sharedFavourites(hass, config, "native"), null);
  assert.equal(
    sharedFavourites(hass, { target_entities: ["light.old"] }, "clock"),
    undefined,
  );
});

test("the rotation interval is the lamp's, with this card's value as default", async () => {
  // Lamp without one yet: the card's configured interval.
  const { controller, lamp, saves, finishSave } = setup({
    lamp: { favourites: [A, B], interval: null },
  });
  assert.equal(controller.interval, 30);
  // Set from another dashboard: every card follows.
  lamp.interval = 120;
  controller.update();
  assert.equal(controller.interval, 120);
  // Changed here: shown at once, kept until the lamp reports it.
  controller.setRotationInterval(300);
  assert.equal(controller.interval, 300);
  assert.deepEqual(saves.at(-1), { interval: 300 });
  controller.update(); // an older push still says 120
  assert.equal(controller.interval, 300);
  finishSave(true);
  await flush();
  lamp.interval = 300;
  controller.update();
  assert.equal(controller.interval, 300);
  // A Start uses it.
  await controller.start();
  assert.deepEqual(saves.at(-1), { start: 300 });
});

test("a failed interval change shows the lamp's interval again", async () => {
  const { controller, finishSave } = setup({
    lamp: { favourites: [A, B], interval: 120 },
  });
  const change = controller.setRotationInterval(600);
  finishSave(false);
  assert.equal(await change, false);
  assert.equal(controller.interval, 120);
  assert.match(controller.error, /interval could not be saved/);
});

test("an older backend keeps the card's configured interval", async () => {
  const { controller, saves } = setup({
    lamp: { favourites: undefined, interval: undefined },
  });
  assert.equal(controller.interval, 30);
  assert.equal(await controller.setRotationInterval(90), false);
  assert.equal(saves.length, 0);
});

test("stored intervals are read per kind", () => {
  const hass = {
    states: {
      "light.a": { attributes: { rotation_intervals: { clock: 90 } } },
      "light.old": { attributes: {} },
    },
  };
  const config = { target_entities: ["light.a"] };
  assert.equal(sharedRotationInterval(hass, config, "clock"), 90);
  assert.equal(sharedRotationInterval(hass, config, "native"), null);
  assert.equal(
    sharedRotationInterval(hass, { entity: "light.old" }, "clock"),
    undefined,
  );
});
