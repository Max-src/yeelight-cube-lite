// Colour conversions shared by the cards.

/**
 * "#rrggbb" (lowercase) for an [r, g, b] colour. Channels are rounded and
 * clamped to 0-255; anything that is not such an array gives `fallback`.
 */
export function rgbToHex(rgb, fallback = "#000000") {
  if (!Array.isArray(rgb) || rgb.length < 3) return fallback;
  return (
    "#" +
    rgb
      .slice(0, 3)
      .map((value) =>
        Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** [r, g, b] for "#rgb" or "#rrggbb" (the "#" is optional), else null. */
export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!match) return null;
  const digits =
    match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const value = parseInt(digits, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
