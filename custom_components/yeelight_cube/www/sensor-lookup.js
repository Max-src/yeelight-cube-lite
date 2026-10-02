// Find the integration's collection sensors (pixel arts, colour palettes) for
// cards configured without an explicit sensor.

// After a failed lookup, the next scan of every entity waits this long, so a
// card without its sensor does not rescan all of hass.states on every Home
// Assistant update. A sensor added later is still found.
const RETRY_MS = 30000;

/**
 * The first `sensor.*` entity whose id contains `fragment`, or undefined.
 * With `card`, a miss is remembered on it (per fragment) and the next scan
 * waits RETRY_MS; without it, the lookup always scans.
 */
export function findCollectionSensor(hass, fragment, card = null) {
  const memo = card ? ((card._sensorLookups ||= {})[fragment] ||= {}) : null;
  const now = Date.now();
  if (memo?.missedAt && now - memo.missedAt < RETRY_MS) return undefined;
  const found = Object.keys(hass?.states || {}).find(
    (entityId) => entityId.startsWith("sensor.") && entityId.includes(fragment),
  );
  if (memo) memo.missedAt = found ? 0 : now;
  return found;
}
