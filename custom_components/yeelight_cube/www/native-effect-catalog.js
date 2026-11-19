// A lamp's native effect catalogue (the effects the cards list: name, speed,
// intensity, directions, extended, family, animation, preview), fetched
// over the websocket (yeelight_cube/native_effect_catalog) instead of riding
// on every state update of the light. The light's native_effect_catalog_key
// attribute changes whenever the catalogue does: the catalogue is fetched
// once per key, by one request at a time, shared by every card on the page.
// An integration that still sends the catalogue as the light's
// native_effect_catalog attribute is read as before.

/** After a failed request, the next one waits this long (ms). */
export const CATALOG_RETRY_MS = 10000;

// Per connection to Home Assistant (one per page), per lamp:
// { key, catalog, loading, failedKey, failedAt, waiting: Set of cards }.
const catalogs = new WeakMap();
const NO_CONNECTION = {};

function entryFor(hass, entityId) {
  const connection = hass.connection || NO_CONNECTION;
  let lamps = catalogs.get(connection);
  if (!lamps) catalogs.set(connection, (lamps = new Map()));
  let entry = lamps.get(entityId);
  if (!entry) {
    entry = { key: undefined, catalog: null, loading: false, failedKey: undefined, failedAt: 0, waiting: new Set() };
    lamps.set(entityId, entry);
  }
  return entry;
}

// Tell the cards waiting for the catalogue: they render again (and ask
// again, loading the newest key if it changed meanwhile).
function notify(entry) {
  const waiting = [...entry.waiting];
  entry.waiting.clear();
  for (const card of waiting) {
    try {
      if (typeof card === "function") card();
      else card.requestUpdate?.();
    } catch (error) {
      console.error("[Yeelight Cube] Native effect catalogue listener:", error);
    }
  }
}

function load(hass, entityId, entry, key) {
  entry.loading = true;
  hass
    .callWS({ type: "yeelight_cube/native_effect_catalog", entity_id: entityId })
    .then((result) => {
      entry.loading = false;
      if (!Array.isArray(result?.catalog)) throw new Error("no catalogue");
      entry.key = result.key ?? key;
      entry.catalog = result.catalog;
      entry.failedKey = undefined;
      notify(entry);
    })
    .catch((error) => {
      entry.loading = false;
      entry.failedKey = key;
      entry.failedAt = Date.now();
      console.warn("[Yeelight Cube] Native effect catalogue unavailable:", error);
      // Asked again once the delay is over.
      setTimeout(() => notify(entry), CATALOG_RETRY_MS);
    });
}

/**
 * The native effect catalogue of the lamp `entityId` (an array, the same one
 * while its key is the same), or null while it is not known yet. Then `card`
 * (an element: requestUpdate(), or a function) is called once it arrives.
 * While a changed catalogue loads, the previous one is given.
 */
export function nativeEffectCatalog(hass, entityId, card = null) {
  const attrs = hass?.states?.[entityId]?.attributes;
  if (!attrs) return null;
  // An integration sending the catalogue in the light's attributes.
  if (Array.isArray(attrs.native_effect_catalog)) return attrs.native_effect_catalog;
  const key = attrs.native_effect_catalog_key;
  if (key == null || typeof hass.callWS !== "function") return null;
  const entry = entryFor(hass, entityId);
  if (entry.key === key && entry.catalog) return entry.catalog;
  if (card) entry.waiting.add(card);
  const failedLately =
    entry.failedKey === key && Date.now() - entry.failedAt < CATALOG_RETRY_MS;
  if (!entry.loading && !failedLately) load(hass, entityId, entry, key);
  return entry.catalog;
}

const withCatalogs = new WeakMap();

/**
 * `attrs` (a lamp's attributes) with its catalogue as native_effect_catalog,
 * the way the cards' helpers read it (nativeEffectItems...): `attrs` itself
 * when it has one already (an offline preview's) or none is known, else the same object while neither
 * changes (the previews compare it by identity).
 */
export function withNativeEffectCatalog(attrs, catalog) {
  if (!attrs || !catalog || Array.isArray(attrs.native_effect_catalog)) return attrs;
  const memo = withCatalogs.get(attrs);
  if (memo?.catalog === catalog) return memo.value;
  const value = { ...attrs, native_effect_catalog: catalog };
  withCatalogs.set(attrs, { catalog, value });
  return value;
}

/** Forget every catalogue fetched (tests). */
export function clearNativeEffectCatalogs() {
  catalogs.delete(NO_CONNECTION);
}
