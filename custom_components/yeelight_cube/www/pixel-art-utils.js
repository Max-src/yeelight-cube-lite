// Pixel-art helpers shared by the draw card and its gallery / actions mixins:
// expanding stored (grouped) pixel arts and describing a single reorder move.

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
 * When `newOrder` (new position -> old index) is the identity with one item
 * moved, return that move as a `move_pixel_art` payload; otherwise null.
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
