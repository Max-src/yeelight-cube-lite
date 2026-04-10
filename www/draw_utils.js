import {
  BLACK_THRESHOLD,
  OFF_COLOR,
  MATRIX_SIZE,
  GRID_COLS,
  GRID_ROWS,
} from "./draw_card_const.js";

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

// --- Background color resolution ---
// Maps a config value ("transparent", "white", "black", "#111", …) to a CSS color.
// `fallback` controls the default value when no branch matches.
export function resolveBgColor(bg, fallback = "transparent") {
  const map = {
    transparent: "transparent",
    white: "#ffffff",
    black: "#000000",
    "#111": "#111",
  };
  return map[bg] ?? fallback;
}

// --- Stale array trimming ---
// Trims an array to `expectedCount` if it's longer (HA websocket staleness fix).
export function trimStaleArray(arr, expectedCount) {
  if (arr.length > expectedCount) {
    return arr.slice(0, expectedCount);
  }
  return arr;
}

export function updateRecentColors(recentColors, newColor) {
  const normColor =
    typeof newColor === "string" ? newColor.toLowerCase() : newColor;
  const updated = [
    normColor,
    ...recentColors.filter((c) => c.toLowerCase() !== normColor),
  ];
  return updated.slice(0, 10);
}

// Coordinate transformation utilities

export function lampToMatrixCoords(lampPos) {
  // Transform lamp coordinates (0=bottom-left) to matrix coordinates (0=top-left)
  const lampRow = Math.floor(lampPos / GRID_COLS);
  const lampCol = lampPos % GRID_COLS;
  const matrixRow = GRID_ROWS - 1 - lampRow; // Flip vertically
  return matrixRow * GRID_COLS + lampCol;
}

export function matrixToLampCoords(matrixPos) {
  // Transform matrix coordinates to lamp coordinates
  const matrixRow = Math.floor(matrixPos / GRID_COLS);
  const matrixCol = matrixPos % GRID_COLS;
  const lampRow = GRID_ROWS - 1 - matrixRow; // Flip vertically
  return lampRow * GRID_COLS + matrixCol;
}

// Color validation and conversion utilities
export function rgbArrayToHex(rgbArray) {
  if (!Array.isArray(rgbArray) || rgbArray.length < 3) return "#000000";
  const r = Math.max(0, Math.min(255, Math.round(rgbArray[0])));
  const g = Math.max(0, Math.min(255, Math.round(rgbArray[1])));
  const b = Math.max(0, Math.min(255, Math.round(rgbArray[2])));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Utility functions for Yeelight Cube Lite Draw Card

// Normalize hex color to 6-digit lowercase
export function normalizeHex(hex) {
  if (!hex) return null;
  hex = hex.toLowerCase();
  if (hex.length === 4 && hex[0] === "#") {
    hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  if (hex.length === 7 && hex[0] === "#") return hex;
  return hex;
}

// Convert RGB array to hex (delegates to rgbArrayToHex for clamping)
export function rgbToHex(rgb) {
  return rgbArrayToHex(rgb);
}

// Convert hex to RGB array
export function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((x) => x + x)
      .join("");
  }
  const num = parseInt(hex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Flood fill algorithm for area fill
export function floodFill(
  matrix,
  idx,
  targetColor,
  fillColor,
  cols = 20,
  rows = 5,
) {
  const normTarget = normalizeHex(targetColor);
  const normFill = normalizeHex(fillColor);
  const stack = [idx];
  const visited = new Set();
  while (stack.length) {
    const i = stack.pop();
    const cellColor = normalizeHex(matrix[i]);
    if (visited.has(i) || cellColor !== normTarget) continue;
    visited.add(i);
    const x = i % cols,
      y = Math.floor(i / cols);
    if (x > 0) stack.push(i - 1);
    if (x < cols - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - cols);
    if (y < rows - 1) stack.push(i + cols);
  }
  return visited;
}

// Extract palette from image data
export function extractPalette(imgData, maxColors = 12) {
  // Convert image data to array of [r,g,b]
  const pixels = [];
  for (let i = 0; i < imgData.length; i += 4) {
    pixels.push([imgData[i], imgData[i + 1], imgData[i + 2]]);
  }
  // K-means clustering for color diversity
  function kmeans(data, k, maxIter = 20) {
    // Randomly initialize centroids
    const centroids = [];
    for (let i = 0; i < k; i++) {
      centroids.push(data[Math.floor(Math.random() * data.length)]);
    }
    let assignments = new Array(data.length).fill(0);
    for (let iter = 0; iter < maxIter; iter++) {
      // Assign each pixel to nearest centroid
      for (let i = 0; i < data.length; i++) {
        let minDist = Infinity;
        let best = 0;
        for (let j = 0; j < k; j++) {
          const d =
            Math.pow(data[i][0] - centroids[j][0], 2) +
            Math.pow(data[i][1] - centroids[j][1], 2) +
            Math.pow(data[i][2] - centroids[j][2], 2);
          if (d < minDist) {
            minDist = d;
            best = j;
          }
        }
        assignments[i] = best;
      }
      // Update centroids
      const sums = Array(k)
        .fill(0)
        .map(() => [0, 0, 0]);
      const counts = Array(k).fill(0);
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
    return centroids;
  }
  const palette = kmeans(pixels, Math.min(maxColors, pixels.length));
  // Remove duplicate colors
  const uniquePalette = [];
  const seen = new Set();
  for (const rgb of palette) {
    const hex = "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
    if (!seen.has(hex)) {
      seen.add(hex);
      uniquePalette.push(rgb);
    }
  }
  // Sort by HSV
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
  uniquePalette.sort((a, b) => {
    const [ha, sa, va] = rgbToHsv(a);
    const [hb, sb, vb] = rgbToHsv(b);
    if (ha !== hb) return hb - ha; // reversed
    if (sa !== sb) return sa - sb; // reversed
    return va - vb; // reversed
  });
  // Convert to hex
  return uniquePalette.map(
    (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join(""),
  );
}
