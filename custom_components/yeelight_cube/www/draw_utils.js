import { hexToRgb as parseHex } from "./color-utils.js";
import { BLACK_THRESHOLD, OFF_COLOR, MATRIX_SIZE } from "./draw_card_const.js";

// --- Create empty (all-black) matrix ---
export function createEmptyMatrix() {
  return Array(MATRIX_SIZE).fill(OFF_COLOR);
}

// --- Black pixel detection ---
// Returns true if the given hex color is at or below the black threshold.
export function isBlackPixel(hex) {
  const h = (hex || OFF_COLOR).replace(/^#/, "");
  if (h.length !== 6) return true; // treat invalid as black
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD;
}

// Normalize hex color to 6-digit lowercase (#abc -> #aabbcc)
export function normalizeHex(hex) {
  if (!hex) return null;
  hex = hex.toLowerCase();
  if (hex.length === 4 && hex[0] === "#") {
    hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex;
}

// Hex -> [r, g, b]; black for an invalid value (the drawing always needs a color).
export function hexToRgbOrBlack(hex) {
  return parseHex(hex) ?? [0, 0, 0];
}

/**
 * RGB to HSV conversion (shared helper).
 */
function rgbToHsv([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, v];
}

/**
 * K-means clustering on RGB data for color diversity.
 * Uses maximin initialization for deterministic, well-spread centroids.
 */
function kmeansRgb(data, k, maxIter = 20) {
  if (data.length <= k) return data.slice();
  // Maximin initialization: pick first centroid, then each subsequent one
  // is the point farthest from all existing centroids
  const centroids = [data[0]];
  for (let c = 1; c < k; c++) {
    let bestDist = -1,
      bestIdx = 0;
    for (let i = 0; i < data.length; i++) {
      let minDist = Infinity;
      for (const cen of centroids) {
        const d =
          (data[i][0] - cen[0]) ** 2 +
          (data[i][1] - cen[1]) ** 2 +
          (data[i][2] - cen[2]) ** 2;
        if (d < minDist) minDist = d;
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }
    centroids.push(data[bestIdx]);
  }
  // Iterate
  const assignments = new Array(data.length).fill(0);
  let counts = Array(k).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < data.length; i++) {
      let minDist = Infinity,
        best = 0;
      for (let j = 0; j < k; j++) {
        const d =
          (data[i][0] - centroids[j][0]) ** 2 +
          (data[i][1] - centroids[j][1]) ** 2 +
          (data[i][2] - centroids[j][2]) ** 2;
        if (d < minDist) {
          minDist = d;
          best = j;
        }
      }
      assignments[i] = best;
    }
    const sums = Array(k)
      .fill(0)
      .map(() => [0, 0, 0]);
    counts = Array(k).fill(0);
    for (let i = 0; i < data.length; i++) {
      const a = assignments[i];
      sums[a][0] += data[i][0];
      sums[a][1] += data[i][1];
      sums[a][2] += data[i][2];
      counts[a]++;
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        centroids[j] = [
          Math.round(sums[j][0] / counts[j]),
          Math.round(sums[j][1] / counts[j]),
          Math.round(sums[j][2] / counts[j]),
        ];
      }
    }
  }
  return { centroids, counts };
}

/**
 * A diverse color palette of an array of RGB tuples [[r,g,b], ...]: black
 * filtered out, K-means clustering when there are more than maxColors,
 * sorted by HSV hue. Returns {palette: hex strings, weights: Map<hex,
 * pixelCount>} (the treemap sizes its tiles by weight).
 */
export function extractDiversePaletteWithWeights(rgbPixels, maxColors = 15) {
  const filtered = rgbPixels.filter(
    (rgb) =>
      Array.isArray(rgb) &&
      rgb.length === 3 &&
      (rgb[0] > 5 || rgb[1] > 5 || rgb[2] > 5),
  );
  if (filtered.length === 0) return { palette: [], weights: new Map() };
  // If very few unique colors, count exact occurrences
  const uniqueMap = new Map(); // hex -> rgb
  const uniqueCounts = new Map(); // hex -> count
  for (const rgb of filtered) {
    const hex =
      "#" +
      rgb
        .map((x) =>
          Math.max(0, Math.min(255, Math.round(x)))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (!uniqueMap.has(hex)) uniqueMap.set(hex, rgb);
    uniqueCounts.set(hex, (uniqueCounts.get(hex) || 0) + 1);
  }
  if (uniqueMap.size <= maxColors) {
    const result = [...uniqueMap.keys()];
    result.sort((a, b) => {
      const ha = rgbToHsv(uniqueMap.get(a));
      const hb = rgbToHsv(uniqueMap.get(b));
      return ha[0] !== hb[0]
        ? ha[0] - hb[0]
        : ha[1] !== hb[1]
          ? ha[1] - hb[1]
          : hb[2] - ha[2];
    });
    const weights = new Map();
    result.forEach((hex) => weights.set(hex, uniqueCounts.get(hex) || 1));
    return { palette: result, weights };
  }
  // K-means for diversity — get centroids + cluster sizes
  const { centroids, counts } = kmeansRgb(filtered, maxColors);
  // Deduplicate and map counts
  const seen = new Set();
  const palette = [];
  const weights = new Map();
  for (let i = 0; i < centroids.length; i++) {
    const rgb = centroids[i];
    const hex =
      "#" +
      rgb
        .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0"))
        .join("");
    const lower = hex.toLowerCase();
    if (!seen.has(lower) && (rgb[0] > 5 || rgb[1] > 5 || rgb[2] > 5)) {
      seen.add(lower);
      palette.push({ hex: lower, rgb, count: counts[i] || 1 });
    } else if (seen.has(lower)) {
      // Merge count into existing entry
      const existing = palette.find((p) => p.hex === lower);
      if (existing) existing.count += counts[i] || 0;
    }
  }
  palette.sort((a, b) => {
    const ha = rgbToHsv(a.rgb);
    const hb = rgbToHsv(b.rgb);
    return ha[0] !== hb[0]
      ? ha[0] - hb[0]
      : ha[1] !== hb[1]
        ? ha[1] - hb[1]
        : hb[2] - ha[2];
  });
  const sortedPalette = palette.map((p) => p.hex);
  palette.forEach((p) => weights.set(p.hex, p.count));
  return { palette: sortedPalette, weights };
}

