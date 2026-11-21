// A Cube Matrix's modules in the lamp preview: the light's `matrix_modules`
// (device_profile.layout: each module in chain order with the frame's first
// column of the 5 it covers, a spot too: it takes a block's place and is one
// light, the colour of its 5 columns) and `matrix_columns` (how many columns
// the modules cover: 5 a module, up to 40). Its frames are max(20, columns)
// wide (matrix-view.js lampWidth): a lamp of up to 4 modules is drawn on a
// Cube Lite's 20 columns, those past its modules left out. A Cube Lite has
// neither: all 20 columns, no spot.
import {
  MATRIX_COLS,
  MATRIX_ROWS,
  MAX_MATRIX_COLS,
  deviceOrientation,
  frameWidth,
  isUpsideDownMount,
  lampWidth,
} from "./matrix-view.js";

const MODULE_SIZE = 5;

/** The columns of the frame the lamp covers (20 without matrix_columns, up
 * to 40 for 8 modules). */
export const shownColumns = (attributes) => {
  const columns = Number(attributes?.matrix_columns);
  return Number.isInteger(columns) && columns > 0 ? Math.min(columns, MAX_MATRIX_COLS) : MATRIX_COLS;
};

export { lampWidth };

/** The lamp's spots: [{column}] (the first of the 5 frame columns each covers). */
export const spotsOf = (attributes) =>
  (Array.isArray(attributes?.matrix_modules) ? attributes.matrix_modules : [])
    .filter((module) => module?.type === "spot" && Number.isInteger(module.column))
    .map(({ column }) => ({ column }));

/** A lamp-order frame telling, per pixel, whether the lamp shows it as a
 * pixel: in a block's columns (a spot's are one light, drawn over them). */
export function shownMask(attributes) {
  const columns = shownColumns(attributes);
  const width = lampWidth(attributes);
  const spot = new Set();
  for (const { column } of spotsOf(attributes))
    for (let at = column; at < column + MODULE_SIZE; at++) spot.add(at);
  return Array.from({ length: width * MATRIX_ROWS }, (_, index) => {
    const column = index % width;
    return column < columns && !spot.has(column);
  });
}

/** Parse a CSS colour of the preview ("#rrggbb" or "rgb(r, g, b)"). */
export function cssRgb(color) {
  if (typeof color !== "string") return [0, 0, 0];
  if (color.startsWith("#") && color.length >= 7)
    return [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) || 0);
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

/**
 * Each spot's colour, as the integration sends it (device_profile
 * _spot_colour): its 5 columns as one light, their average colour as bright
 * as their brightest pixel. `colors`: the lamp-order frame as CSS colours.
 */
export function spotColours(colors, attributes) {
  const width = lampWidth(attributes);
  return spotsOf(attributes).map(({ column }) => {
    const pixels = [];
    for (let side = column; side < Math.min(width, column + MODULE_SIZE); side++)
      for (let row = 0; row < MATRIX_ROWS; row++) pixels.push(cssRgb(colors[row * width + side]));
    const peak = Math.max(0, ...pixels.map((pixel) => Math.max(...pixel)));
    if (!peak) return [0, 0, 0];
    const total = [0, 1, 2].map((channel) => pixels.reduce((sum, pixel) => sum + pixel[channel], 0));
    const top = Math.max(...total);
    return total.map((value) => Math.min(255, Math.floor((value * peak + Math.floor(top / 2)) / top)));
  });
}

/**
 * Where each spot sits in a preview grid: the centre of the 5 x 5 area it
 * covers, as fractions of the grid's width and height (in the display order
 * `display` gives, whatever the orientation). `cols` x `rows`: the grid's.
 */
export function spotPlaces(attributes, display, cols, rows) {
  const width = lampWidth(attributes);
  const marker = Array.from({ length: width * MATRIX_ROWS }, (_, index) => index);
  const shown = display(marker);
  return spotsOf(attributes).map(({ column }) => {
    const at = shown.indexOf(2 * width + column + 2);
    if (at < 0) return null;
    return { x: ((at % cols) + 0.5) / cols, y: (Math.floor(at / cols) + 0.5) / rows };
  });
}

// ── Previews laid out as the lamp's modules ─────────────────────────────
// A Cube Matrix's previews show its modules only: the columns they cover,
// a Matrix module as its 25 dots, a spot or a panel as one face over its
// 5 x 5 area (a spot's lens in its colour as the integration sends it, a
// panel's 25 colours melted together: moduleLook). The frame's cells
// (width x 5) stay in the page (the cards' painters write whole frames),
// each placed on the grid or left out.

// Where lamp column `column` shows in a frame of the given kind (`viewer`: a
// top-first frame as the viewer sees it, turned for an upside-down mount;
// `drawing`: a picture before that turn, as the gradient previews come; else
// lamp order).
function columnPlace(column, attributes, kind, columns) {
  const upsideDown = isUpsideDownMount(deviceOrientation(attributes));
  if (kind === "viewer" && upsideDown) return lampWidth(attributes) - 1 - column;
  if (kind === "drawing" && upsideDown) return columns - 1 - column;
  return column;
}

// What a lamp's module layout depends on, as a key: its columns, its spots
// and panels (their JSON computed once per matrix_modules list), and whether
// it is mounted upside down. Previews ask for their layout on every frame.
const FACE_TYPES = new Set(["spot", "panel"]);
const FACE_KEYS = new WeakMap();

/** The lamp's spots and panels: [{type, column}], each shown as one face
 * over its 5 x 5 area rather than as dots. */
function facesOf(attributes) {
  return (Array.isArray(attributes?.matrix_modules) ? attributes.matrix_modules : [])
    .filter((module) => FACE_TYPES.has(module?.type) && Number.isInteger(module.column))
    .map(({ type, column }) => ({ type, column }));
}

function faceKey(attributes) {
  const modules = attributes?.matrix_modules;
  if (!Array.isArray(modules)) return "[]";
  let key = FACE_KEYS.get(modules);
  if (key === undefined) FACE_KEYS.set(modules, (key = JSON.stringify(facesOf(attributes))));
  return key;
}

function layoutKey(attributes) {
  const faces = faceKey(attributes);
  const upsideDown = isUpsideDownMount(deviceOrientation(attributes));
  return `${shownColumns(attributes)}:${faces}:${upsideDown ? 1 : 0}`;
}

// The layouts already worked out, by layoutKey and kind: a handful per lamp.
const FACE_AREAS = new Map();
const MODULE_GRIDS = new Map();
const NO_FACES = Object.freeze([]);

/** A frame's columns per spot or panel (kind: "lamp", "viewer" or
 * "drawing"), those the columns shown hold: [{type, area, anchor}], `anchor`
 * the middle pixel of the area (the cell that shows the module). */
function faceAreas(attributes, kind, key = layoutKey(attributes)) {
  if (!Array.isArray(attributes?.matrix_modules)) return NO_FACES;
  const cacheKey = `${key}|${kind}`;
  let areas = FACE_AREAS.get(cacheKey);
  if (areas) return areas;
  const columns = shownColumns(attributes);
  const width = lampWidth(attributes);
  areas = facesOf(attributes)
    .filter(({ column }) => column + MODULE_SIZE <= columns)
    .map(({ type, column }) => {
      const area = Array.from({ length: MODULE_SIZE }, (_, k) =>
        columnPlace(column + k, attributes, kind, columns),
      ).sort((a, b) => a - b);
      return { type, area, anchor: 2 * width + area[2] };
    });
  FACE_AREAS.set(cacheKey, areas);
  return areas;
}

const rgbOf = (color) =>
  Array.isArray(color) ? color.slice(0, 3).map((value) => Number(value) || 0) : cssRgb(color);

// Each frame's last spot-coloured copy (withSpotColours).
const SPOT_FRAMES = new WeakMap();

/**
 * `frame` (width x 5 colours, [r, g, b] or CSS) with each spot's colour in the
 * middle pixel of its area (the one its preview cell shows): the area's
 * other pixels as one light, their average colour as bright as their
 * brightest (device_profile._spot_colour). Applying it again changes
 * nothing. `kind`: "lamp" (lamp order), "viewer" or "drawing" (columnPlace).
 */
export function withSpotColours(frame, attributes, kind = "lamp") {
  const width = lampWidth(attributes);
  if (!Array.isArray(frame) || frame.length !== width * MATRIX_ROWS) return frame;
  const key = layoutKey(attributes);
  const spots = faceAreas(attributes, kind, key).filter(({ type }) => type === "spot");
  if (!spots.length) return frame;
  // The same frame for the same layout gives the same array, so the
  // painters' caches by frame keep working.
  const cacheKey = `${key}|${kind}`;
  const cached = SPOT_FRAMES.get(frame);
  if (cached?.key === cacheKey) return cached.out;
  const out = frame.slice();
  const asArray = frame.some(Array.isArray);
  for (const { area, anchor } of spots) {
    const pixels = [];
    for (const column of area)
      for (let row = 0; row < MATRIX_ROWS; row++) {
        const index = row * width + column;
        if (index !== anchor) pixels.push(rgbOf(frame[index]));
      }
    const peak = Math.max(0, ...pixels.map((pixel) => Math.max(...pixel)));
    let rgb = [0, 0, 0];
    if (peak) {
      const total = [0, 1, 2].map((channel) => pixels.reduce((sum, pixel) => sum + pixel[channel], 0));
      const top = Math.max(...total);
      rgb = total.map((value) => Math.min(255, Math.floor((value * peak + Math.floor(top / 2)) / top)));
    }
    out[anchor] = asArray ? rgb : `rgb(${rgb.join(", ")})`;
  }
  SPOT_FRAMES.set(frame, { key: cacheKey, out });
  return out;
}

/**
 * How a preview grid shows the lamp's modules, or null when it shows the
 * whole frame (a Cube Lite, or 4 or more Matrix modules): `cols` x `rows` of
 * the grid (`vertical`: the view of a lamp standing on its end), the
 * `columns` covered, and `place`, per top-first pixel of a frame of `kind`
 * ("viewer" by default, or "drawing"): {column, row, span, spot} (1-based
 * grid lines) or null (left out). A spot or a panel is one cell over its
 * 5 x 5 area (span 5), its middle pixel's, with `module` ("spot" or
 * "panel") and `pixels`: the frame's pixels it shows (a spot: that middle
 * one, its colour; a panel: its 25, row by row as the grid shows them).
 */
export function moduleGrid(attributes, vertical = false, kind = "viewer") {
  const columns = shownColumns(attributes);
  const key = layoutKey(attributes);
  const faces = faceAreas(attributes, kind, key);
  if (columns >= lampWidth(attributes) && !faces.length) return null;
  // Worked out once per layout (shared: callers only read it).
  const cacheKey = `${key}|${kind}|${vertical ? 1 : 0}`;
  let grid = MODULE_GRIDS.get(cacheKey);
  if (!grid) MODULE_GRIDS.set(cacheKey, (grid = buildModuleGrid(attributes, vertical, kind, columns, faces)));
  return grid;
}

function buildModuleGrid(attributes, vertical, kind, columns, faces) {
  const width = lampWidth(attributes);
  const first = kind === "viewer" && isUpsideDownMount(deviceOrientation(attributes)) ? width - columns : 0;
  // A pixel's cell on the grid when it is a dot.
  const dot = (index) => {
    const row = Math.floor(index / width);
    const along = (index % width) - first + 1;
    return vertical
      ? { column: MATRIX_ROWS - row, row: along, span: 1, spot: false }
      : { column: along, row: row + 1, span: 1, spot: false };
  };
  const inFace = new Map();
  for (const face of faces) for (const column of face.area) inFace.set(column, face);
  const place = Array.from({ length: width * MATRIX_ROWS }, (_, index) => {
    const column = index % width;
    if (column < first || column >= first + columns) return null;
    const face = inFace.get(column);
    if (!face) return dot(index);
    if (index !== face.anchor) return null;
    const along = face.area[0] - first + 1;
    const at = vertical ? { column: 1, row: along } : { column: along, row: 1 };
    let pixels = [index];
    if (face.type === "panel") {
      pixels = new Array(MODULE_SIZE * MODULE_SIZE);
      for (const side of face.area)
        for (let row = 0; row < MATRIX_ROWS; row++) {
          const pixel = row * width + side;
          const cell = dot(pixel);
          pixels[(cell.row - at.row) * MODULE_SIZE + cell.column - at.column] = pixel;
        }
    }
    return { ...at, span: MODULE_SIZE, spot: face.type === "spot", module: face.type, pixels };
  });
  return {
    columns,
    width,
    cols: vertical ? MATRIX_ROWS : columns,
    rows: vertical ? columns : MATRIX_ROWS,
    place,
  };
}

/** What a preview's module layout depends on, as a key ("" for a Cube Lite). */
export const moduleKey = (attributes) =>
  attributes?.matrix_modules ? `${shownColumns(attributes)}:${faceKey(attributes)}` : "";

/** A grid cell's inline style for its place (moduleGrid): "" with no grid.
 * A spot's or panel's face has the corners the grid's --yc-module-radius
 * gives (modulePreviewRadius); its picture is moduleLook's. */
export function placeStyle(place) {
  if (place === undefined) return "";
  if (place === null) return "display:none;";
  const span = place.span > 1 ? ` / span ${place.span}` : "";
  return (
    `grid-column:${place.column}${span};grid-row:${place.row}${span};` +
    (place.module
      ? "aspect-ratio:1/1;border-radius:var(--yc-module-radius,0);" +
        (place.module === "panel" ? "background-blend-mode:lighten;" : "")
      : "")
  );
}

/** A grid cell's data attributes for its place, in markup: a spot's or a
 * panel's module and the frame pixels it shows (moduleCells). */
export function placeAttributes(place) {
  return place?.module ? ` data-module="${place.module}" data-pixels="${place.pixels.join(",")}"` : "";
}

/** --yc-module-radius for a preview's pixel style: a spot's or a panel's
 * corners, square with square pixels, rounded with round ones. */
export const modulePreviewRadius = (pixelStyle) =>
  pixelStyle === "circle" ? "12%" : pixelStyle === "rounded" ? "6%" : "0";

// ── How a spot and a panel look ─────────────────────────────────────────
// As filmed on the owner's lamp (2026-11-21): a spot is a square face with a
// recessed round bezel (about 87% of its width) and in it a round lens (60%)
// glowing in its colour, nearly white at the centre when bright, its colour
// at the rim, a soft halo on the bezel; unlit, a dark disc in the ring. A
// panel is one diffusing face: its 25 colours melt into each other edge to
// edge, a few lit pixels a soft haze with brighter blotches; unlit, one dark
// face. Both drawn with gradients on their cell (background-blend-mode:
// lighten on a panel, placeStyle).

const FACE = [30, 30, 33];
const PANEL_FACE = [17, 17, 19];
const WHITE = [255, 255, 255];
const LIT = 8;
// A panel's haze: its pixels' average at this share (a few lit pixels
// hardly show it; all lit, it fills between their blotches).
const HAZE = 0.75;
const mix = (from, to, amount) => from.map((value, channel) => Math.round(value + (to[channel] - value) * amount));
const rgbCss = (rgb, alpha) => (alpha === undefined ? `rgb(${rgb.join(",")})` : `rgba(${rgb.join(",")},${alpha})`);
const SPOT_RING =
  "radial-gradient(circle closest-side,transparent 80%,#0d0d0f 81.5%,#4a4a50 85%,#26262a 88%,transparent 89.5%)";

function spotBackground(rgb) {
  const peak = Math.max(...rgb) / 255;
  if (peak * 255 <= LIT)
    return (
      "radial-gradient(circle closest-side,#09090a 57%,#2e2e33 60%,transparent 62%)," +
      `${SPOT_RING},radial-gradient(circle closest-side,#111113 80%,transparent 81%),${rgbCss(FACE)}`
    );
  // Nearly white at the centre when bright, hardly whiter when dim.
  const hot = mix(rgb, WHITE, 0.85 * peak * peak);
  const warm = mix(rgb, WHITE, 0.4 * peak * peak);
  const lens = `radial-gradient(circle closest-side,${rgbCss(hot)} 0%,${rgbCss(warm)} 30%,${rgbCss(rgb)} 52%,${rgbCss(rgb)} 59%,${rgbCss(rgb, 0)} 61.5%)`;
  const halo = `radial-gradient(circle closest-side,${rgbCss(rgb, (0.75 * peak).toFixed(2))} 58%,${rgbCss(rgb, (0.3 * peak).toFixed(2))} 68%,${rgbCss(rgb, 0)} 84%)`;
  const recess = `radial-gradient(circle closest-side,${rgbCss(mix([17, 17, 19], rgb, 0.18 * peak))} 80%,transparent 81%)`;
  return `${lens},${halo},${SPOT_RING},${recess},${rgbCss(mix(FACE, rgb, 0.12 * peak))}`;
}

// A panel: each lit pixel a soft blotch at its place (lightened over the
// others, so their order does not matter), over a haze of their average.
function panelBackground(colours) {
  const lit = colours.filter((rgb) => Math.max(...rgb) > LIT);
  if (!lit.length) return rgbCss(PANEL_FACE);
  const average = [0, 1, 2].map((channel) => colours.reduce((sum, rgb) => sum + rgb[channel], 0) / colours.length);
  let haze = average.map((value) => Math.round(value * HAZE));
  if (Math.max(...haze) < Math.max(...PANEL_FACE)) haze = PANEL_FACE;
  const blobs = [];
  colours.forEach((rgb, at) => {
    if (Math.max(...rgb) <= LIT) return;
    const x = 10 + 20 * (at % MODULE_SIZE);
    const y = 10 + 20 * Math.floor(at / MODULE_SIZE);
    blobs.push(`radial-gradient(30% 30% at ${x}% ${y}%,${rgbCss(rgb)} 0%,${rgbCss(rgb)} 25%,${rgbCss(rgb, 0)} 100%)`);
  });
  return `${blobs.join(",")},${rgbCss(haze)}`;
}

// Looks already worked out, by colours: a still or slow picture repeats them.
const LOOKS = new Map();
const LOOKS_KEPT = 400;

/**
 * A spot's or a panel's look (`type`) for its colours ([r, g, b]: a spot's
 * one, a panel's 25 row by row as shown), `shadow` the preview's pixel
 * shadow ("" for none, as a cell's box-shadow): {background, boxShadow}
 * for its cell. A thin frame lines the face; the pixel shadow falls around
 * it as around a dot, and on a panel inside its edges too.
 */
export function moduleLook(type, colours, shadow = "") {
  const key = `${type}|${shadow}|${colours.map((rgb) => rgb.join(",")).join(";")}`;
  let look = LOOKS.get(key);
  if (look) return look;
  const panel = type === "panel";
  const frame = `inset 0 0 0 1px rgba(255,255,255,${panel ? 0.14 : 0.08})`;
  look = {
    background: panel ? panelBackground(colours) : spotBackground(colours[0] || [0, 0, 0]),
    boxShadow: shadow ? `${frame},${panel ? `inset ${shadow},` : ""}${shadow}` : frame,
  };
  if (LOOKS.size >= LOOKS_KEPT) LOOKS.delete(LOOKS.keys().next().value);
  LOOKS.set(key, look);
  return look;
}

const BLACK = [0, 0, 0];

function pixelsOf(pixels, frame, scale) {
  return pixels.map((index) => {
    const rgb = rgbOf(frame?.[index] ?? BLACK);
    return scale === 1 ? rgb : rgb.map((channel) => Math.min(255, Math.round(channel * scale)));
  });
}

/** The look of a module's place (moduleGrid) for a top-first frame of the
 * grid's kind (colours [r, g, b] or CSS), at `scale` brightness. */
export const placeLook = (place, frame, shadow = "", scale = 1) =>
  moduleLook(place.module, pixelsOf(place.pixels, frame, scale), shadow);

/** The cells of a preview grid that show a spot or a panel (placeAttributes;
 * `cells`: its cells, any order), each marked (`cell._module`) so a painter
 * looping over every cell leaves them to paintModuleCells. */
export function moduleCells(cells) {
  const out = [];
  for (const cell of cells) {
    const module = cell?.dataset?.module;
    if (!module) {
      if (cell) cell._module = undefined;
      continue;
    }
    const source = cell.dataset.pixels || "";
    if (cell._module?.source !== source)
      cell._module = { type: module, source, pixels: source.split(",").map(Number) };
    out.push(cell);
  }
  return out;
}

/** Paint the spots and panels (`cells`: moduleCells) of a top-first frame
 * at `scale` brightness, `shadow` the pixel shadow (undefined: their
 * box-shadow left as it is). Change-only writes, the same tracking as
 * matrix-animator.js paintCellBackground. */
export function paintModuleCells(cells, frame, { scale = 1, shadow } = {}) {
  for (const cell of cells) {
    const { type, pixels } = cell._module;
    const look = moduleLook(type, pixelsOf(pixels, frame, scale), shadow ?? "");
    if (cell._bg !== look.background) {
      cell._bg = look.background;
      cell.style.background = look.background;
    }
    if (shadow !== undefined && cell._sh !== look.boxShadow) {
      cell._sh = look.boxShadow;
      cell.style.boxShadow = look.boxShadow;
    }
  }
}

/**
 * A frame (lamp order or top-first: rows of its width, matrix-view.js
 * frameWidth) on a panel `width` columns wide: content 20 wide on a longer
 * Cube Matrix is placed from the base side (column 0), the rest `blank`;
 * content wider than the panel is cropped to it. `fromEnd`: the base side is
 * the frame's last column (a viewer frame of an upside-down mount, where lamp
 * column c shows at width - 1 - c). The frame itself when it already fits.
 */
export function fitFrame(frame, width, { fromEnd = false, blank = [0, 0, 0] } = {}) {
  if (!Array.isArray(frame)) return frame;
  const from = frameWidth(frame);
  if (from === width) return frame;
  const shift = fromEnd ? width - from : 0;
  const out = new Array(width * MATRIX_ROWS);
  for (let row = 0; row < MATRIX_ROWS; row++)
    for (let column = 0; column < width; column++) {
      const source = column - shift;
      out[row * width + column] =
        source >= 0 && source < from ? frame[row * from + source] ?? blank : blank;
    }
  return out;
}

/** fitFrame for a lamp's frames (`attributes`: lampWidth), a frame of
 * `kind` (columnPlace: "lamp", "viewer" or "drawing"). */
export function fitLampFrame(frame, attributes, kind = "lamp", blank) {
  const fromEnd =
    kind === "viewer" && isUpsideDownMount(deviceOrientation(attributes));
  return fitFrame(frame, lampWidth(attributes), { fromEnd, blank });
}

/**
 * The frame columns a streamed clock's digits go on, in chain order: the
 * 5 x 5 blocks' (matrix and panel), never a spot's (its 5 columns show the
 * background only). The digits are centred across them as one strip, a
 * spot between blocks skipped (clock_face.py). Without spots: the columns
 * shown, 0 to columns - 1 (a Cube Lite: all 20).
 */
export function clockColumns(attributes) {
  const columns = shownColumns(attributes);
  const modules = Array.isArray(attributes?.matrix_modules) ? attributes.matrix_modules : [];
  if (!spotsOf(attributes).length) return Array.from({ length: columns }, (_, column) => column);
  const out = [];
  for (const module of modules) {
    if (module?.type === "spot" || !Number.isInteger(module?.column)) continue;
    if (module.column + MODULE_SIZE > columns) continue;
    for (let k = 0; k < MODULE_SIZE; k++) out.push(module.column + k);
  }
  return out;
}
