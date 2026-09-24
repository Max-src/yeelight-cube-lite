/** Canonical selections are {key, colorMode, color?}; RGB is copied and identity
 * includes it. Domain adapters resolve editing drafts and firmware encodings.
 * Observed state and a successfully dispatched pending selection stay separate.
 */
export class ModeSelectionState {
  constructor() {
    this.observed = null;
    this.pending = null;
    this.baseline = "";
  }

  record(selection, observed) {
    this.observed = normalizeFavourite(observed);
    this.baseline = favouriteId(this.observed);
    this.pending = normalizeFavourite(selection);
  }

  observe(selection) {
    this.observed = normalizeFavourite(selection);
    const identity = favouriteId(this.observed);
    if (
      this.pending &&
      (identity === favouriteId(this.pending) || identity !== this.baseline)
    )
      this.pending = null;
  }

  clear() {
    this.pending = null;
  }

  get current() {
    return this.pending || this.observed;
  }
}

export function normalizeFavourite(item) {
  if (typeof item === "string") {
    const key = item.trim();
    if (!key || /^\d+$/.test(key)) return null;
    return { key, colorMode: "normal" };
  }
  if (!item || typeof item !== "object" || typeof item.key !== "string")
    return null;
  const key = item.key.trim();
  if (!key || /^\d+$/.test(key)) return null;
  const colorMode =
    typeof item.colorMode === "string" && item.colorMode
      ? item.colorMode
      : "normal";
  const favourite = { key, colorMode };
  if (
    colorMode === "custom" &&
    Array.isArray(item.color) &&
    item.color.length === 3 &&
    item.color.every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    )
  )
    favourite.color = [...item.color];
  if (colorMode === "custom" && !favourite.color)
    favourite.colorMode = "normal";
  return favourite;
}

export function favouriteId(item) {
  const favourite = normalizeFavourite(item);
  return favourite
    ? JSON.stringify([
        favourite.key,
        favourite.colorMode,
        favourite.color || null,
      ])
    : "";
}

export function sanitizeFavourites(items, limit = 100) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const favourite = normalizeFavourite(item);
    if (!favourite) continue;
    // A favourite is unique per key AND colour mode, so the same style can be
    // saved once for Normal and once for Vivid, etc.
    const id = favouriteId(favourite);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(favourite);
  }
  return out.slice(0, limit);
}
