// Find the integration's collection sensors (color palettes, pixel arts) for
// cards configured without one, or whose sensor no longer exists (renamed):
// by the attribute that holds the collection, like the clock presets
// (clock-preset-utils.js), never by entity id alone. The ids differ between
// installations (a fresh one gets sensor.color_palettes and
// sensor.saved_drawings, older ones sensor.yeelight_cube_color_palettes and
// sensor.yeelight_cube_saved_pixel_arts) and the user can rename them
// (docs/ENTITY_IDS.md).

/** The attributes holding each collection (the first present wins). */
export const COLLECTION_ATTRIBUTES = Object.freeze({
  palettes: ["palettes_v2", "palettes"],
  pixel_arts: ["pixel_arts"],
});

// Older installations' ids: a sensor still found while it has no attributes
// yet (unavailable while Home Assistant starts).
const LEGACY_FRAGMENTS = { palettes: "color_palettes", pixel_arts: "pixel_art" };

// After a failed lookup, the next scan of every entity waits this long, so a
// card without its sensor does not rescan all of hass.states on every Home
// Assistant update. A sensor added later is still found.
const RETRY_MS = 30000;

// The sensor found per collection, used while it exists (one Home Assistant
// per page): found again once it is gone (renamed or removed).
let found = {};

/** Forget the sensors found (tests). */
export function clearSensorLookups() {
  found = {};
}

// A sensor of this integration: the entity registry's platform when it
// lists the entity (another integration's sensor never matches).
const ours = (hass, id) => {
  const platform = hass.entities?.[id]?.platform;
  return platform === undefined || platform === "yeelight_cube";
};

/**
 * The sensor holding the `kind` collection ("palettes", "pixel_arts"), or
 * undefined. With `card`, a miss is remembered on it (per kind) and the next
 * scan waits RETRY_MS; without it, a miss always scans again.
 */
export function findCollectionSensor(hass, kind, card = null) {
  const states = hass?.states;
  const attributes = COLLECTION_ATTRIBUTES[kind];
  if (!states || !attributes) return undefined;
  if (found[kind] && states[found[kind]]) return found[kind];
  const memo = card ? ((card._sensorLookups ||= {})[kind] ||= {}) : null;
  const now = Date.now();
  if (memo?.missedAt && now - memo.missedAt < RETRY_MS) return undefined;
  const sensors = Object.keys(states).filter(
    (id) => id.startsWith("sensor.") && ours(hass, id),
  );
  const id =
    sensors.find((sensor) => {
      const attrs = states[sensor]?.attributes;
      return !!attrs && attributes.some((name) => name in attrs);
    }) ?? sensors.find((sensor) => sensor.includes(LEGACY_FRAGMENTS[kind]));
  found[kind] = id;
  if (memo) memo.missedAt = id ? 0 : now;
  return id;
}
