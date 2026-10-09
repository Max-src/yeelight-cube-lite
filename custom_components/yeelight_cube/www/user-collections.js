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
 * and the cards hold one CollectionStore per collection they show (its
 * items kept fresh, their own edits shown at once).
 *
 * The editors' Arrange block (YeelightEditorMixin._arrangeSettings) uses
 * them for every kind, so a new user collection only needs a descriptor
 * here and a move_<kind> service in the backend.
 */
import { findCollectionSensor } from "./sensor-lookup.js";
import { CollectionState } from "./collection-state.js";
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

/**
 * One user collection as a card shows it (Palettes, Draw): the sensor's
 * items, kept fresh, with the card's own edit shown until the backend
 * confirms it.
 *
 *   update(hass, config)  from the card's hass setter: true when what the
 *                         card shows changed (re-render)
 *   items(hass, config)   what to show: the pending edit, else the freshest
 *                         array, else the sensor's
 *   edit(hass, items, service, data)  shows `items` at once, then calls the
 *                         service; refused or failed: rolled back, false
 *   run(hass, service, data)  an edit whose result is not known beforehand
 *                         (an import appends on the server), in the same
 *                         queue as the edits
 *   fetch(hass, sensor, until?)  the sensor's array from the REST API
 *   reset()               on a new config or disconnect: late results of the
 *                         previous context are dropped
 *
 * Why the fetch: Home Assistant can push a large collection's new
 * content_hash a moment before its full array (state updates may carry only
 * the scalar attributes), so on every new content the store fetches the
 * array (retried until its hash matches) instead of showing a stale one.
 * `onChange()` asks the card to re-render when a fetch lands.
 */
export class CollectionStore {
  constructor(kind, { onChange } = {}) {
    this.kind = kind;
    this.onChange = onChange;
    this.pending = new CollectionState();
    this.context = 0;
    this.fresh = null;
    this.lastHash = undefined;
    this.lastCount = undefined;
    this._fetching = false;
  }

  reset() {
    this.pending.reset();
    this.context++;
    this.fresh = null;
    this.lastHash = undefined;
    this.lastCount = undefined;
    this._fetching = false;
  }

  update(hass, config) {
    const sensor = collectionSensor(hass, config, this.kind);
    const state = sensor ? hass?.states?.[sensor] : undefined;
    if (!state) return false;
    const { items, count } = collectionItems(hass, config, this.kind);
    const hadPending = !!this.pending.pending;
    this.pending.observe(items, count);
    let changed = hadPending && !this.pending.pending;
    const hash = state.attributes?.content_hash ?? `count:${count}`;
    if (hash !== this.lastHash || count !== this.lastCount) {
      this.lastHash = hash;
      this.lastCount = count;
      changed = true;
      this.fetch(hass, sensor);
    }
    return changed;
  }

  items(hass, config) {
    if (this.pending.pending) return this.pending.pending.items;
    const sensor = collectionSensor(hass, config, this.kind);
    if (
      this.fresh &&
      this.fresh.sensor === sensor &&
      this.fresh.hash === this.lastHash
    )
      return this.fresh.items;
    return collectionItems(hass, config, this.kind).items;
  }

  async edit(hass, items, service, data, { onError } = {}) {
    const operation = this.pending.record(items);
    this.onChange?.();
    try {
      if (!(await this.pending.execute(hass, service, data)))
        throw new Error(`The ${USER_COLLECTIONS[this.kind].noun} list changed. Please retry.`);
      return true;
    } catch (error) {
      if (this.pending.rollback(operation)) {
        this.onChange?.();
        onError?.(error);
      }
      return false;
    }
  }

  run(hass, service, data) {
    return this.pending.execute(hass, service, data);
  }

  /**
   * The sensor's array from the REST API: retried (6 times, 200 ms apart)
   * until `until(items)` holds, or else until its hash matches the one the
   * last state announced (the last try is then taken as it is). True when
   * a fresh array was taken.
   */
  async fetch(hass, sensor, until = null) {
    if (!sensor || typeof hass?.callApi !== "function") return false;
    if (!until && this._fetching) return false;
    const context = this.context;
    if (!until) this._fetching = true;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const state = await hass.callApi("GET", `states/${sensor}`);
        if (context !== this.context) return false;
        const attributes = state?.attributes;
        const items = USER_COLLECTIONS[this.kind].attributes
          .map((name) => attributes?.[name])
          .find(Array.isArray);
        if (!items) return false;
        const count = Number.isInteger(attributes.count) ? attributes.count : items.length;
        // Sensors without a content_hash are told apart by their count.
        const hash = attributes.content_hash ?? `count:${count}`;
        const ready = until
          ? until(items)
          : this.lastHash == null || hash === this.lastHash;
        if (!ready && attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (context !== this.context) return false;
          continue;
        }
        if (!ready && until) return false;
        this.fresh = { sensor, items, hash };
        this.lastHash = hash;
        this.lastCount = count;
        this.pending.observe(items, count);
        this.onChange?.();
        return true;
      }
      return false;
    } catch (error) {
      console.warn(`[${this.kind}] Could not fetch the collection:`, error);
      return false;
    } finally {
      if (!until && context === this.context) this._fetching = false;
    }
  }
}
