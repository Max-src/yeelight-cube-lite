import test from "node:test";
import assert from "node:assert/strict";
import {
  clearSensorLookups,
  findCollectionSensor,
} from "../custom_components/yeelight_cube/www/sensor-lookup.js";
import { collectionSensor } from "../custom_components/yeelight_cube/www/user-collections.js";

// Sensors with their attributes: { "sensor.x": { pixel_arts: [] } }.
const hassWith = (sensors, entities = undefined) => ({
  states: Object.fromEntries(
    Object.entries(sensors).map(([id, attributes]) => [id, { entity_id: id, attributes }]),
  ),
  entities,
});

test("finds the collection sensors by their attributes, whatever their ids", () => {
  clearSensorLookups();
  // A fresh installation's ids (from the names) and renamed ones.
  const hass = hassWith({
    "light.a": { palettes_v2: [] },
    "sensor.saved_drawings": { pixel_arts: [], count: 0 },
    "sensor.my_colors": { palettes_v2: [], count: 0 },
  });
  assert.equal(findCollectionSensor(hass, "pixel_arts"), "sensor.saved_drawings");
  assert.equal(findCollectionSensor(hass, "palettes"), "sensor.my_colors");
  assert.equal(findCollectionSensor(hass, "unknown"), undefined);
});

test("another integration's sensor with the same attribute never matches", () => {
  clearSensorLookups();
  const hass = hassWith(
    {
      "sensor.other_palettes": { palettes: [] },
      "sensor.color_palettes": { palettes_v2: [] },
    },
    {
      "sensor.other_palettes": { platform: "other" },
      "sensor.color_palettes": { platform: "yeelight_cube" },
    },
  );
  assert.equal(findCollectionSensor(hass, "palettes"), "sensor.color_palettes");
});

test("a sensor without its attributes yet (starting) is found by its older id", () => {
  clearSensorLookups();
  const hass = hassWith({ "sensor.yeelight_cube_saved_pixel_arts": {} });
  assert.equal(findCollectionSensor(hass, "pixel_arts"), "sensor.yeelight_cube_saved_pixel_arts");
});

test("the sensor found is kept while it exists and found again once renamed", () => {
  clearSensorLookups();
  let scans = 0;
  const counting = (sensors) => {
    const hass = hassWith(sensors);
    const states = hass.states;
    const keys = Object.keys;
    return {
      get states() {
        return new Proxy(states, {
          ownKeys(target) {
            scans += 1;
            return keys(target);
          },
        });
      },
    };
  };
  const before = { "sensor.color_palettes": { palettes_v2: [] } };
  assert.equal(findCollectionSensor(counting(before), "palettes"), "sensor.color_palettes");
  assert.equal(findCollectionSensor(counting(before), "palettes"), "sensor.color_palettes");
  assert.equal(scans, 1); // remembered: no second scan
  const renamed = { "sensor.desk_palettes": { palettes_v2: [] } };
  assert.equal(findCollectionSensor(counting(renamed), "palettes"), "sensor.desk_palettes");
  assert.equal(scans, 2);
});

test("a configured sensor is used while it exists, the one found once it is gone", () => {
  clearSensorLookups();
  const hass = hassWith({ "sensor.saved_drawings": { pixel_arts: [] } });
  const config = (id) => ({ pixelart_sensor: id });
  assert.equal(collectionSensor(hass, config("sensor.saved_drawings"), "pixel_arts"), "sensor.saved_drawings");
  // Renamed since the card was configured: found again.
  assert.equal(collectionSensor(hass, config("sensor.old_id"), "pixel_arts"), "sensor.saved_drawings");
  assert.equal(collectionSensor(hass, {}, "pixel_arts"), "sensor.saved_drawings");
  // Nothing found: the configured one stays.
  clearSensorLookups();
  assert.equal(collectionSensor(hassWith({}), config("sensor.old_id"), "pixel_arts"), "sensor.old_id");
});

test("a card does not rescan every entity right after a miss", (t) => {
  clearSensorLookups();
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const card = {};
  let scans = 0;
  const counting = (sensors) => ({
    get states() {
      scans += 1;
      return hassWith(sensors).states;
    },
  });
  assert.equal(findCollectionSensor(counting({ "light.a": {} }), "pixel_arts", card), undefined);
  assert.equal(scans, 1);
  // The sensor appears, but within the retry delay the card does not look.
  now += 5_000;
  const art = { "sensor.saved_drawings": { pixel_arts: [] } };
  assert.equal(findCollectionSensor(counting(art), "pixel_arts", card), undefined);
  assert.equal(scans, 2); // read, no scan
  // After the delay it is found; other kinds are not throttled by it.
  now += 30_000;
  assert.equal(findCollectionSensor(counting(art), "pixel_arts", card), "sensor.saved_drawings");
  assert.equal(
    findCollectionSensor(counting({ "sensor.color_palettes": { palettes_v2: [] } }), "palettes", card),
    "sensor.color_palettes",
  );
  // Without a card a miss always scans again.
  clearSensorLookups();
  assert.equal(findCollectionSensor(counting({ "light.a": {} }), "pixel_arts"), undefined);
  assert.equal(findCollectionSensor(counting({ "sensor.saved_drawings": { pixel_arts: [] } }), "pixel_arts"), "sensor.saved_drawings");
});
