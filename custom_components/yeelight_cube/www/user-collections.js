/**
 * The user's own collections: palettes and pixel arts. The backend stores
 * each one once, in one order shared by every card, every lamp and the
 * matrix select entities; cards and editors read and reorder them only
 * through these descriptors:
 *
 *   collectionItems(hass, config, kind)  the stored items (and count)
 *   singleMove(newOrder, items)          one move as a move_* payload
 *   collectionThumbnail(kind, item)      a small preview (Arrange rows)
 *
 * The editors' Arrange block (YeelightEditorMixin._arrangeSettings) uses
 * them for every kind, so a new user collection only needs a descriptor
 * here and a move_<kind> service in the backend.
 */
import { findCollectionSensor } from "./sensor-lookup.js";
import { paletteGradient } from "./palette-preview.js";
import { pixelArtColorData } from "./pixel-art-utils.js";
import { renderMatrixPreview } from "./gallery-display-utils.js";

export const USER_COLLECTIONS = Object.freeze({
  palettes: {
    noun: "palette",
    sensorOption: "palette_sensor",
    sensorFragment: "color_palettes",
    attributes: ["palettes_v2", "palettes"],
    moveService: "move_palette",
  },
  pixel_arts: {
    noun: "pixel art",
    sensorOption: "pixelart_sensor",
    sensorFragment: "pixel_art",
    attributes: ["pixel_arts"],
    moveService: "move_pixel_art",
  },
});

/** The sensor holding a collection: the config's, else the one found. */
export function collectionSensor(hass, config, kind) {
  const collection = USER_COLLECTIONS[kind];
  return (
    config?.[collection.sensorOption] ||
    findCollectionSensor(hass, collection.sensorFragment)
  );
}

/**
 * The stored items of a collection as the sensor shows them, and the
 * sensor's `count`. Large arrays can arrive a beat after the count (HA
 * sends scalar attributes first): CollectionState.observe(items, count)
 * only trusts the array once both agree.
 */
export function collectionItems(hass, config, kind) {
  const attributes =
    hass?.states?.[collectionSensor(hass, config, kind)]?.attributes;
  const items =
    USER_COLLECTIONS[kind].attributes
      .map((name) => attributes?.[name])
      .find(Array.isArray) || [];
  const count = Number.isInteger(attributes?.count)
    ? attributes.count
    : items.length;
  return { items, count };
}

/**
 * When `newOrder` (new position -> old index) is the identity with one item
 * moved, return that move as a move_palette / move_pixel_art payload (the
 * name expected at its index refuses a stale move); otherwise null.
 */
export function singleMove(newOrder, items) {
  let start = 0;
  let end = newOrder.length - 1;
  while (start <= end && newOrder[start] === start) start++;
  while (end >= start && newOrder[end] === end) end--;
  if (start >= end) return null;
  let from;
  let to;
  if (newOrder[start] === end) [from, to] = [end, start];
  else if (newOrder[end] === start) [from, to] = [start, end];
  else return null;
  const moved = items.slice();
  moved.splice(to, 0, moved.splice(from, 1)[0]);
  if (moved.some((item, index) => item !== items[newOrder[index]])) return null;
  return { from_idx: from, to_idx: to, expected_name: items[from]?.name };
}

/** A small preview of an item (HTML): a palette's blend, a pixel art's
 * picture. Colors come from rgbToCss / the matrix renderer (rgb() only). */
export function collectionThumbnail(kind, item) {
  if (kind === "palettes")
    return `<span class="collection-thumb" style="background:${paletteGradient(
      Array.isArray(item?.colors) ? item.colors : [],
    )};"></span>`;
  return `<span class="collection-thumb collection-thumb-matrix">${renderMatrixPreview(
    pixelArtColorData(item),
    {
      bgColor: "#000000",
      pixelGap: 0,
      previewSize: 44,
      proportionalSpacing: false,
    },
  )}</span>`;
}
