import { getTargetEntities } from "./service-call-utils.js";
import { normalizeFavourite, sanitizeFavourites } from "./mode-selection.js";

/**
 * Settings stored on the lamp, so every dashboard and device shows the same:
 * - favourites (set_favourites service, `favourites` attribute); on the wire
 *   an entry is a rotation item: { name, color_mode, color };
 * - the rotation interval per kind (set_rotation_interval service, also set by
 *   a Start; `rotation_intervals` attribute).
 */

/** A card favourite ({ key, colorMode, color }) as a stored/rotation item. */
export function favouriteToItem(favourite) {
  const item = normalizeFavourite(favourite);
  if (!item) return null;
  return {
    name: item.key,
    color_mode: item.colorMode,
    ...(item.color ? { color: item.color } : {}),
  };
}

/**
 * The favourites of `kind` stored on the card's (first) lamp:
 * - undefined: the lamp publishes no favourites (older backend, or the lamp
 *   is unavailable), so the card keeps the list it has;
 * - null: supported but never saved for this kind (nothing to show yet; the
 *   card may move the list it kept in browser storage there);
 * - otherwise the list, in the cards' favourite format.
 */
export function sharedFavourites(hass, config, kind) {
  const entity = getTargetEntities(config || {})[0];
  const all = hass?.states?.[entity]?.attributes?.favourites;
  if (!all || typeof all !== "object") return undefined;
  const items = all[kind];
  if (!Array.isArray(items)) return null;
  return sanitizeFavourites(
    items.map((item) => ({
      key: item?.name,
      colorMode: item?.color_mode,
      color: item?.color ?? undefined,
    })),
  );
}

/** Save `favourites` (card format) on every lamp of the card. */
export function saveSharedFavourites(card, kind, favourites) {
  return card._commands.execute(
    card._hass,
    card.config,
    "set_favourites",
    { kind, favourites: favourites.map(favouriteToItem).filter(Boolean) },
    "yeelight_cube",
    // Quick edits send the full list each time: only the latest is needed.
    { coalesce: "favourites" },
  );
}

/**
 * The rotation interval (seconds) of `kind` stored on the card's (first) lamp:
 * undefined when the lamp publishes no intervals (older backend, or the lamp
 * is unavailable), null when none was set yet for this kind.
 */
export function sharedRotationInterval(hass, config, kind) {
  const entity = getTargetEntities(config || {})[0];
  const all = hass?.states?.[entity]?.attributes?.rotation_intervals;
  if (!all || typeof all !== "object") return undefined;
  const seconds = Number(all[kind]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Set the rotation interval of `kind` on every lamp of the card. */
export function saveSharedRotationInterval(card, kind, seconds) {
  return card._commands.execute(
    card._hass,
    card.config,
    "set_rotation_interval",
    { kind, interval: seconds },
    "yeelight_cube",
    { coalesce: "rotation-interval" },
  );
}
