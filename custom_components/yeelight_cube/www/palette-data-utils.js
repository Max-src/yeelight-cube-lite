/**
 * Validation for palette data that comes from outside the integration
 * (imported JSON files). Everything is reduced to plain strings and integer
 * RGB triplets before it reaches rendering or a service call, so a crafted file
 * cannot inject markup and the backend schema never rejects the whole import
 * because of one malformed entry.
 */

export const MAX_PALETTE_IMPORT_BYTES = 1024 * 1024;
const MAX_PALETTES = 500;
const MAX_COLORS = 100;

const isByte = (value) => Number.isInteger(value) && value >= 0 && value <= 255;

/** `[r, g, b]` integers 0-255, or `"#rrggbb"` / `"#rgb"`; anything else is null. */
export function toRgbTriplet(color) {
  if (Array.isArray(color)) {
    return color.length === 3 && color.every(isByte) ? [...color] : null;
  }
  if (typeof color !== "string") return null;
  const hex = color.trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * Normalise an imported palette file: an array of `{name, colors}` objects or
 * bare color arrays. Returns the valid palettes and how many were skipped.
 */
export function normalizeImportedPalettes(data) {
  if (!Array.isArray(data)) return { palettes: [], skipped: 0 };
  const palettes = [];
  let skipped = 0;
  data.slice(0, MAX_PALETTES).forEach((entry, index) => {
    const source = Array.isArray(entry) ? { colors: entry } : entry;
    const colors = Array.isArray(source?.colors)
      ? source.colors.slice(0, MAX_COLORS).map(toRgbTriplet)
      : [];
    if (!colors.length || colors.some((color) => !color)) {
      skipped++;
      return;
    }
    const name =
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim()
        : `Palette ${index + 1}`;
    palettes.push({ name, colors });
  });
  skipped += Math.max(0, data.length - MAX_PALETTES);
  return { palettes, skipped };
}
