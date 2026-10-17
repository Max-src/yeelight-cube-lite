/**
 * Which of a card's items it shows, and in which order: one rule for every
 * card with a gallery (Clock styles and color modes, Gradient modes, Native
 * effects, official pixel arts), set in the editor's ordered list
 * (_galleryItemsSettings).
 *
 * Each kind of item keeps two lists in the card's config:
 *   visible_<items>  the items shown, in this order (none stored: all items)
 *   hidden_<items>   the items left out when the list was saved
 * An item in neither list was added since (a new custom preset): it shows
 * after the list when the kind lets new items appear (`newItemAppears`).
 */

/** The config keys of each kind of item. */
export const VISIBILITY_KEYS = Object.freeze({
  clockStyles: { visible: "visible_styles", hidden: "hidden_styles" },
  colorModes: { visible: "visible_color_modes", hidden: "hidden_color_modes" },
  gradientModes: { visible: "visible_modes", hidden: "hidden_modes" },
  effects: { visible: "visible_effects", hidden: "hidden_effects" },
  pixelArts: { visible: "visible_pixel_arts", hidden: "hidden_pixel_arts" },
});

/**
 * The items shown, in order.
 * @param {Array} items - every item the card could show
 * @param {Function} keyOf - (item) => its stored key
 * @param {Object} config - the card's config
 * @param {{visible: string, hidden: string}} keys - VISIBILITY_KEYS[kind]
 * @param {Function} [newItemAppears] - (item) => whether an item added since
 *   the list was saved shows (default: none does)
 */
export function visibleItems(items, keyOf, config, keys, newItemAppears = () => false) {
  const list = config?.[keys.visible];
  if (!Array.isArray(list)) return items;
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const listed = new Set(list);
  const hidden = new Set(config[keys.hidden] || []);
  return [
    ...[...listed].map((key) => byKey.get(key)).filter(Boolean),
    ...items.filter((item) => {
      const key = keyOf(item);
      return !listed.has(key) && !hidden.has(key) && newItemAppears(item);
    }),
  ];
}

/**
 * The config showing `visible` (keys, in order): every other known item is
 * hidden (`allKeys`; items hidden before stay hidden while unavailable).
 */
export function withVisibleItems(config, keys, allKeys, visible) {
  return {
    ...config,
    [keys.visible]: [...visible],
    [keys.hidden]: [
      ...new Set([...(config[keys.hidden] || []), ...allKeys]),
    ].filter((key) => !visible.includes(key)),
  };
}

/** The config showing every item again. */
export function withAllItems(config, keys) {
  const { [keys.visible]: visible, [keys.hidden]: hidden, ...rest } = config;
  return rest;
}
