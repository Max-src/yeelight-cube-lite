// Pixel-art helpers shared by the draw card and its gallery / actions mixins:
// expanding stored (grouped) pixel arts and their matrix colors, and the
// official app's pixel arts. (A single reorder move: singleMove in
// user-collections.js.)
import { VISIBILITY_KEYS, visibleItems } from "./visible-items.js";

// The official app's pixel arts (yeelight_cube/builtin_pixel_arts: name,
// collection, orientation, pixels), read-only: fetched once per connection
// to Home Assistant (one per page), shared by every card and editor on it.
const builtinPixelArts = new WeakMap();

/** The official pixel arts (a promise; [] when the backend has none). */
export function loadBuiltinPixelArts(hass) {
  if (!hass?.callWS) return Promise.resolve([]);
  const connection = hass.connection || hass;
  let request = builtinPixelArts.get(connection);
  if (!request) {
    request = hass
      .callWS({ type: "yeelight_cube/builtin_pixel_arts" })
      .then((result) => result?.pixel_arts || [])
      .catch((error) => {
        builtinPixelArts.delete(connection); // tried again next time
        throw error;
      });
    builtinPixelArts.set(connection, request);
  }
  return request;
}

/** An official pixel art's key: in the gallery, item_labels and the
 * editor's list (visible_pixel_arts). */
export const builtinArtKey = (art) => `builtin:${art.name}`;

/** The official pixel arts a card shows, in order: its editor's list, else
 * the horizontal ones, and the vertical ones too with
 * `pixel_art_show_vertical` (they are drawn for a lamp stood on its end, and
 * show sideways on a lamp lying flat). */
export function shownBuiltinPixelArts(arts, config) {
  if (Array.isArray(config?.[VISIBILITY_KEYS.pixelArts.visible]))
    return visibleItems(arts, builtinArtKey, config, VISIBILITY_KEYS.pixelArts);
  return config?.pixel_art_show_vertical === true
    ? arts
    : arts.filter((art) => art.orientation === "horizontal");
}

// The sections of a pixel-art gallery: the user's own, then each official
// collection (in the backend's order), with their icons.
export const MY_DRAWINGS = "My drawings";
const GROUP_ICONS = { [MY_DRAWINGS]: "✏️", Nature: "🌿", Geometry: "🔷" };

/**
 * The gallery items in sections (each item's `group`): "All" first, then
 * each group, in the items' order. One section or none: no sections (the
 * gallery alone).
 * @returns {Array<{key, title, icon, items}>}
 */
export function pixelArtSections(items) {
  const groups = [...new Set(items.map((item) => item.group).filter(Boolean))];
  if (groups.length < 2) return [];
  return [
    { key: "all", title: "All", icon: "🖼️", items },
    ...groups.map((group) => ({
      key: group,
      title: group,
      icon: GROUP_ICONS[group] || "🗂️",
      items: items.filter((item) => item.group === group),
    })),
  ];
}

/**
 * Expand a pixel art's pixels array to flat [{position, color}] format.
 *
 * Internal storage uses the compact grouped format:
 *   [{color: [R,G,B], position: [int, ...]}, ...]
 * This helper converts it back to the flat format that the draw card uses,
 * while also accepting the legacy flat format for backward compatibility
 * (e.g. pixel arts imported from JSON files saved with older versions).
 * Also accepts legacy "positions" (plural) key from older stored data.
 *
 * @param {object} art - Pixel art object with a `pixels` array.
 * @returns {Array<{position: number, color: number[]}>} Flat pixels array.
 */
export function expandPixelArt(art) {
  if (!art || !Array.isArray(art.pixels)) return [];
  const expanded = [];
  for (const entry of art.pixels) {
    if (Array.isArray(entry.position)) {
      // Grouped format: {color: [R,G,B], position: [int, ...]}
      for (const pos of entry.position) {
        expanded.push({ position: pos, color: entry.color });
      }
    } else if (Array.isArray(entry.positions)) {
      // Backward-compat: legacy stored data used "positions" (plural)
      for (const pos of entry.positions) {
        expanded.push({ position: pos, color: entry.color });
      }
    } else if (entry.position !== undefined) {
      // Legacy flat format: {position: int, color: [R,G,B]}
      expanded.push(entry);
    }
  }
  return expanded;
}

/**
 * Where a stored pixel lands on screen: positions count rows from the
 * lamp's bottom row (0-19 is the bottom), the matrix previews and the
 * drawing grid from the top. The one conversion of every pixel-art view.
 */
export function pixelArtDisplayIndex(position) {
  const row = Math.floor(position / 20);
  return (4 - row) * 20 + (position % 20);
}

/**
 * A pixel art as the 100 colors of the 20x5 matrix, top row first (unset
 * pixels black): the colorData of matrix previews (gallery, Arrange).
 */
export function pixelArtColorData(art) {
  const colors = Array.from({ length: 100 }, () => [0, 0, 0]);
  for (const { position, color } of expandPixelArt(art)) {
    if (Number.isInteger(position) && position >= 0 && position < 100 && Array.isArray(color))
      colors[pixelArtDisplayIndex(position)] = color;
  }
  return colors;
}
