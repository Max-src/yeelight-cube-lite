/**
 * The color swatches shared by every card (<yc-swatches>, yc-swatches.js):
 * their options, color parsing and naming, the blend and the geometry of
 * each layout. No Lit here, so the Node tests and the string renderers
 * (palette previews) use it too.
 */
import { hexToRgb, rgbToHex } from "./color-utils.js";

/**
 * The layouts, in the editor's groups:
 *   swatches   one swatch per color: row (wrapping), grid (two rows),
 *              expand (5, then +N), scroll (one row with arrows), fan, wave,
 *              spiral
 *   gradient   a bar blending the colors (pickable ticks when selectable)
 *   stripes    a bar of bands, sized by the weights when given
 *   fill       the whole area filled with the blend
 *   honeycomb, blinds, treemap (rectangles sized by the weights)
 */
export const SWATCH_LAYOUT_GROUPS = Object.freeze({
  swatches: ["row", "grid", "expand", "scroll", "fan", "wave", "spiral"],
  gradient: ["gradient"],
  stripes: ["stripes"],
  fill: ["fill"],
  honeycomb: ["honeycomb"],
  blinds: ["blinds"],
  treemap: ["treemap"],
});
export const SWATCH_LAYOUTS = Object.freeze(
  Object.values(SWATCH_LAYOUT_GROUPS).flat(),
);
export const SWATCH_SHAPES = Object.freeze(["square", "rounded", "round"]);
// The layouts drawn with one swatch per color in the chosen shape.
export const SHAPED_LAYOUTS = Object.freeze([
  ...SWATCH_LAYOUT_GROUPS.swatches,
  "gradient",
]);
export const BLINDS_DIRECTIONS = Object.freeze([
  "rows",
  "columns",
  "diagonal-right",
  "diagonal-left",
]);
export const EXPAND_STYLES = Object.freeze(["pill", "chevron", "dots"]);
// How many swatches the expand layout shows before its +N button.
export const EXPAND_COLLAPSED_COUNT = 5;

/** The group of a layout (the editor's first row). */
export function swatchLayoutGroup(layout) {
  return (
    Object.keys(SWATCH_LAYOUT_GROUPS).find((group) =>
      SWATCH_LAYOUT_GROUPS[group].includes(layout),
    ) || "swatches"
  );
}

/**
 * "#rrggbb" for a color given as [r, g, b], "#rgb" / "#rrggbb" or
 * "rgb(r, g, b)"; null for anything else. Every swatch color goes through
 * it, so the markup only ever holds hex values.
 */
export function toHex(color) {
  if (Array.isArray(color)) return color.length >= 3 ? rgbToHex(color) : null;
  if (typeof color !== "string") return null;
  const rgb = hexToRgb(color);
  if (rgb) return rgbToHex(rgb);
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
  return match ? rgbToHex(match.slice(1, 4).map(Number)) : null;
}

// CSS named colors, for the closest-name label.
const CSS_COLOR_NAMES = {
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
};

/** The closest CSS color name of a color (any toHex format). */
export function closestColorName(color) {
  const rgb = hexToRgb(toHex(color) || "");
  if (!rgb) return "unknown";
  let best = "unknown";
  let bestDistance = Infinity;
  for (const [name, [r, g, b]] of Object.entries(CSS_COLOR_NAMES)) {
    const distance = (rgb[0] - r) ** 2 + (rgb[1] - g) ** 2 + (rgb[2] - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

/**
 * A color's label (color_info_display): "hex" its hex code, "name" its
 * closest CSS name ("css" is an older name), "none" (or nothing) no label.
 */
export function colorLabel(color, mode) {
  if (!mode || mode === "none" || mode === "hidden") return "";
  if (mode === "name" || mode === "css") return closestColorName(color);
  return toHex(color) || "";
}

function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/**
 * The positions of `hexes` in a smooth order: from the darkest color, each
 * next one the nearest in hue, saturation and lightness (the "smooth" order
 * of a blend). Returns indexes into `hexes`.
 */
export function smoothOrder(hexes) {
  const indexes = hexes.map((_, index) => index);
  if (hexes.length <= 2) return indexes;
  const hsl = hexes.map((hex) => rgbToHsl(hexToRgb(hex)));
  const remaining = new Set(indexes);
  let current = indexes.reduce((darkest, index) =>
    hsl[index][2] < hsl[darkest][2] ? index : darkest,
  );
  const order = [current];
  remaining.delete(current);
  while (remaining.size) {
    let next = -1;
    let bestDistance = Infinity;
    for (const index of remaining) {
      let dh = Math.abs(hsl[current][0] - hsl[index][0]);
      if (dh > 0.5) dh = 1 - dh;
      const distance =
        dh * dh * 4 +
        (hsl[current][1] - hsl[index][1]) ** 2 +
        (hsl[current][2] - hsl[index][2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        next = index;
      }
    }
    order.push(next);
    remaining.delete(next);
    current = next;
  }
  return order;
}

/** The blend of `hexes` left to right, as a CSS background. */
export function blendBackground(hexes) {
  if (!hexes.length) return "transparent";
  const stops = hexes.length === 1 ? [hexes[0], hexes[0]] : hexes;
  const last = stops.length - 1;
  return `linear-gradient(to right, ${stops
    .map((hex, index) => `${hex} ${((index / last) * 100).toFixed(1)}%`)
    .join(", ")})`;
}

/** The color of the blend of `hexes` at `t` (0 → 1), as hex. */
export function blendColorAt(hexes, t) {
  if (!hexes.length) return null;
  if (hexes.length === 1) return hexes[0];
  const scaled = Math.max(0, Math.min(1, t)) * (hexes.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(hexes.length - 1, low + 1);
  const fraction = scaled - low;
  if (!fraction) return hexes[low];
  const a = hexToRgb(hexes[low]);
  const b = hexToRgb(hexes[high]);
  return rgbToHex(a.map((channel, i) => channel + (b[i] - channel) * fraction));
}

// ---------------------------------------------------------------------------
// Geometry of the drawn layouts. Each returns the area's natural size in
// swatch units (1 = one swatch of the default 28 px look) and every item's
// box in % of that area, so a layout scales with the swatch size and never
// overflows its container.
// ---------------------------------------------------------------------------
const UNIT = 28;
const pct = (value, total) => `${((value / total) * 100).toFixed(2)}%`;

/** A semicircular arc of swatches. */
export function fanGeometry(count) {
  const [start, end, radius, size, pad] = [-70, 70, 90, 26, 12];
  const innerW = Math.ceil(2 * (Math.sin((end * Math.PI) / 180) * radius + size / 2));
  const innerH = Math.ceil(radius + size + 12);
  const width = innerW + pad * 2;
  const height = innerH + pad * 2;
  const items = Array.from({ length: count }, (_, i) => {
    const angle = count === 1 ? 0 : start + (end - start) * (i / (count - 1));
    const rad = (angle * Math.PI) / 180;
    const edge = 1 - Math.abs(angle) / 90;
    return {
      left: pct(pad + innerW / 2 + Math.sin(rad) * radius - size / 2, width),
      top: pct(pad + radius - Math.cos(rad) * radius, height),
      width: pct(size, width),
      height: pct(size, height),
      rotate: angle.toFixed(1),
      scale: (0.7 + 0.3 * edge).toFixed(2),
      opacity: (0.6 + 0.4 * edge).toFixed(2),
    };
  });
  return { width: width / UNIT, ratio: `${width}/${height}`, items };
}

/** A sine wave of swatches. */
export function waveGeometry(count) {
  const [amplitude, size] = [22, 26];
  const spacing = Math.max(size + 4, 32);
  const width = spacing * (count - 1) + size;
  const height = amplitude * 2 + size + 12;
  const items = Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const wave = Math.sin(t * Math.PI * 2.5);
    return {
      left: pct(t * (width - size), width),
      top: pct(amplitude + 4 + wave * amplitude, height),
      width: pct(size, width),
      height: pct(size, height),
      rotate: "0",
      scale: (0.8 + 0.25 * ((wave + 1) / 2)).toFixed(2),
    };
  });
  return { width: width / UNIT, ratio: `${width}/${height}`, items };
}

/** A spiral from the centre, wider and with more turns for more colors. */
export function spiralGeometry(count) {
  const size = 24;
  const step = [3, 8, 16, 30].findIndex((limit) => count <= limit);
  const turns = [0.5, 0.8, 1.2, 1.6, 2.2][step < 0 ? 4 : step];
  const maxR = [30, 50, 70, 85, 100][step < 0 ? 4 : step];
  const side = maxR * 2 + size + 16;
  const items = Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    const angle = t * turns * Math.PI * 2;
    const r = count === 1 ? 0 : 8 + t * (maxR - 8);
    return {
      left: pct(side / 2 + Math.cos(angle) * r - size / 2, side),
      top: pct(side / 2 + Math.sin(angle) * r - size / 2, side),
      width: pct(size, side),
      height: pct(size, side),
      rotate: ((angle * 180) / Math.PI).toFixed(0),
      scale: (0.7 + t * 0.35).toFixed(2),
    };
  });
  return { width: side / UNIT, ratio: "1", items };
}

/** A beehive of hexagons, smaller cells for more colors. */
export function honeycombGeometry(count) {
  const cellW = count <= 8 ? 40 : count <= 20 ? 34 : 28;
  const cellH = Math.round(cellW * 1.1547);
  const cols = Math.max(2, Math.ceil(Math.sqrt(count * 1.4)));
  const rowH = cellH * 0.75;
  const width = cols * cellW + cellW / 2 + 16;
  const height = Math.ceil(count / cols) * rowH + cellH * 0.25 + 16;
  const items = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols);
    return {
      left: pct((i % cols) * cellW + (row % 2 ? cellW / 2 : 0) + 8, width),
      top: pct(row * rowH + 8, height),
      width: pct(cellW, width),
      height: pct(cellH, height),
    };
  });
  return { width: width / UNIT, ratio: `${width}/${height}`, items };
}

/** The blinds' height (swatch units): thinner strips for more colors. */
export function blindsHeight(count, direction) {
  if (direction !== "rows") return 120 / UNIT;
  const strip = Math.max(4, Math.min(14, Math.floor(120 / count)));
  return Math.max(60, Math.min(130, count * strip + 10)) / UNIT;
}

/**
 * A squarified treemap of `weights` (one per color; at least 0.1 each):
 * rectangles in % of a 350 × 110 area, the largest first. Each item keeps
 * its color's `index`.
 */
export function treemapGeometry(weights) {
  const [width, height] = [350, 110];
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const sorted = weights
    .map((weight, index) => ({ index, area: (weight / total) * width * height }))
    .sort((a, b) => b.area - a.area);
  const rects = [];
  const squarify = (list, x, y, w, h) => {
    if (!list.length) return;
    if (list.length === 1) {
      rects.push({ index: list[0].index, x, y, w, h });
      return;
    }
    const wide = w >= h;
    const side = wide ? h : w;
    let split = 1;
    let bestWorst = Infinity;
    let area = 0;
    for (let i = 0; i < list.length; i++) {
      area += list[i].area;
      const thickness = area / side;
      let worst = 0;
      for (let j = 0; j <= i; j++) {
        const length = list[j].area / thickness;
        worst = Math.max(worst, thickness / length, length / thickness);
      }
      if (worst > bestWorst) break;
      bestWorst = worst;
      split = i + 1;
    }
    const row = list.slice(0, split);
    const rest = list.slice(split);
    const rowArea = row.reduce((sum, item) => sum + item.area, 0);
    // The last row fills what is left (no floating-point gaps).
    const thickness = rest.length ? rowArea / side : wide ? w : h;
    let position = 0;
    for (const item of row) {
      const length = rest.length
        ? item.area / thickness
        : (item.area / rowArea) * (wide ? h : w);
      rects.push(
        wide
          ? { index: item.index, x, y: y + position, w: thickness, h: length }
          : { index: item.index, x: x + position, y, w: length, h: thickness },
      );
      position += length;
    }
    if (wide) squarify(rest, x + thickness, y, w - thickness, h);
    else squarify(rest, x, y + thickness, w, h - thickness);
  };
  squarify(sorted, 0, 0, width, height);
  return {
    ratio: `${width}/${height}`,
    items: rects.map((rect) => ({
      index: rect.index,
      left: pct(rect.x, width),
      top: pct(rect.y, height),
      width: pct(rect.w, width),
      height: pct(rect.h, height),
    })),
  };
}
