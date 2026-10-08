// Pixel-art helpers shared by the draw card and its gallery / actions mixins:
// expanding stored (grouped) pixel arts and their matrix colors. (A single
// reorder move: singleMove in user-collections.js.)

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
