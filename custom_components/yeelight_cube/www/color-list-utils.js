// Small helpers shared by the colour list editor card and its mixins.

// Item selectors of the list layouts that reorder by moving their own items.
export const ITEM_DRAG_SELECTORS = {
  compact: ".compact-item",
  chips: ".chip-item",
  tiles: ".tile-item",
  rows: ".row-item",
};

export const isRgb = (color) =>
  Array.isArray(color) &&
  color.length === 3 &&
  color.every((v) => typeof v === "number");
