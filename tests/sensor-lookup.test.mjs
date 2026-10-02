import test from "node:test";
import assert from "node:assert/strict";
import { findCollectionSensor } from "../custom_components/yeelight_cube/www/sensor-lookup.js";

const hassWith = (...ids) => ({
  states: Object.fromEntries(ids.map((id) => [id, { entity_id: id }])),
});

test("finds the collection sensor by id fragment", () => {
  const hass = hassWith("light.a", "sensor.yeelight_cube_color_palettes", "sensor.pixel_art_x");
  assert.equal(findCollectionSensor(hass, "color_palettes"), "sensor.yeelight_cube_color_palettes");
  assert.equal(findCollectionSensor(hass, "pixel_art"), "sensor.pixel_art_x");
  assert.equal(findCollectionSensor(hassWith("light.color_palettes"), "color_palettes"), undefined);
});

test("a card does not rescan every entity right after a miss", (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const card = {};
  let scans = 0;
  const counting = (ids) => ({
    get states() {
      scans += 1;
      return hassWith(...ids).states;
    },
  });
  assert.equal(findCollectionSensor(counting(["light.a"]), "pixel_art", card), undefined);
  assert.equal(scans, 1);
  // The sensor appears, but within the retry delay the card does not look.
  now += 5_000;
  assert.equal(findCollectionSensor(counting(["sensor.pixel_art"]), "pixel_art", card), undefined);
  assert.equal(scans, 1);
  // After the delay it is found; other fragments are not throttled by it.
  now += 30_000;
  assert.equal(findCollectionSensor(counting(["sensor.pixel_art"]), "pixel_art", card), "sensor.pixel_art");
  assert.equal(findCollectionSensor(counting(["sensor.color_palettes"]), "color_palettes", card), "sensor.color_palettes");
  assert.equal(scans, 3);
  // Without a card the lookup always scans.
  findCollectionSensor(counting(["light.a"]), "pixel_art");
  findCollectionSensor(counting(["light.a"]), "pixel_art");
  assert.equal(scans, 5);
});
