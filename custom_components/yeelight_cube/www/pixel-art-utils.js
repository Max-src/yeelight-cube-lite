// Pixel-art helpers shared by the draw card and its gallery / actions mixins:
// expanding stored (grouped) pixel arts and their matrix colors, and the
// official app's pixel arts. (A single reorder move: singleMove in
// user-collections.js.)
import { VISIBILITY_KEYS, visibleItems } from "./visible-items.js";
import { flipIndexVertical } from "./matrix-view.js";
import { hexToRgbOrBlack } from "./draw_utils.js";

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
 * all of them (the gallery's orientation filter then picks the horizontal or
 * vertical ones, pixelArtOrientationFilter). */
export function shownBuiltinPixelArts(arts, config) {
  if (Array.isArray(config?.[VISIBILITY_KEYS.pixelArts.visible]))
    return visibleItems(arts, builtinArtKey, config, VISIBILITY_KEYS.pixelArts);
  return arts;
}

// The pixel-art gallery's orientation filter (the shared gallery's `filter`,
// collection-gallery.js): what its toggle offers, and the card's default
// (pixel_art_orientation), "lamp" following the lamp's orientation.
export const PIXEL_ART_ORIENTATIONS = [
  { value: "all", label: "All", icon: "mdi:image-multiple-outline", title: "All pixel arts" },
  { value: "horizontal", label: "Horizontal", icon: "mdi:crop-landscape", title: "Pixel arts for a lamp lying flat" },
  { value: "vertical", label: "Vertical", icon: "mdi:crop-portrait", title: "Pixel arts for a lamp standing on its end" },
];
export const PIXEL_ART_DEFAULT_ORIENTATIONS = [
  ...PIXEL_ART_ORIENTATIONS,
  { value: "lamp", label: "Follow the lamp", icon: "mdi:phone-rotate-portrait", title: "Vertical while the lamp stands on its end, else horizontal" },
];

/** The orientation a card's gallery opens on (its pixel_art_orientation,
 * "lamp" resolved with the lamp's device orientation). */
export function defaultPixelArtOrientation(config, lampVertical) {
  const value = config?.pixel_art_orientation;
  if (value === "lamp") return lampVertical ? "vertical" : "horizontal";
  return PIXEL_ART_ORIENTATIONS.some((choice) => choice.value === value) ? value : "all";
}

/** Whether a gallery item shows under an orientation filter value. */
export const matchesPixelArtOrientation = (item, value) =>
  value === "all" || (value === "vertical") === !!item?.vertical;

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
export const pixelArtDisplayIndex = flipIndexVertical;

/**
 * The drawing grid (100 hex colors, top row first) as pixel-art pixels: one
 * { position, color } per pixel, positions in lamp order (the inverse of
 * pixelArtDisplayIndex). What the Draw card saves and sends.
 */
export function drawingPixels(matrix) {
  return matrix.map((hex, index) => ({
    position: pixelArtDisplayIndex(index),
    color: hexToRgbOrBlack(hex),
  }));
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
