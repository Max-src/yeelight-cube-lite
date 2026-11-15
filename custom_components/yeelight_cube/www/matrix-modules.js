// A Cube Matrix's modules in the lamp preview: the light's `matrix_modules`
// (device_profile.layout: each module in chain order with the frame's first
// column of the 5 it covers, a spot too: it takes a block's place and is one
// light, the colour of its 5 columns) and `matrix_columns` (how many of the
// frame's 20 columns the modules cover). A Cube Lite has neither: all 20
// columns, no spot.
import {
  MATRIX_COLS,
  MATRIX_ROWS,
  deviceOrientation,
  isUpsideDownMount,
} from "./matrix-view.js";

const MODULE_SIZE = 5;

/** The columns of the frame the lamp covers (20 without matrix_columns). */
export const shownColumns = (attributes) => {
  const columns = Number(attributes?.matrix_columns);
  return Number.isInteger(columns) && columns > 0 && columns < MATRIX_COLS ? columns : MATRIX_COLS;
};

/** The lamp's spots: [{column}] (the first of the 5 frame columns each covers). */
export const spotsOf = (attributes) =>
  (Array.isArray(attributes?.matrix_modules) ? attributes.matrix_modules : [])
    .filter((module) => module?.type === "spot" && Number.isInteger(module.column))
    .map(({ column }) => ({ column }));

/** A lamp-order frame telling, per pixel, whether the lamp shows it as a
 * pixel: in a block's columns (a spot's are one light, drawn over them). */
export function shownMask(attributes) {
  const columns = shownColumns(attributes);
  const spot = new Set();
  for (const { column } of spotsOf(attributes))
    for (let at = column; at < column + MODULE_SIZE; at++) spot.add(at);
  return Array.from({ length: MATRIX_COLS * MATRIX_ROWS }, (_, index) => {
    const column = index % MATRIX_COLS;
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
  return spotsOf(attributes).map(({ column }) => {
    const pixels = [];
    for (let side = column; side < Math.min(MATRIX_COLS, column + MODULE_SIZE); side++)
      for (let row = 0; row < MATRIX_ROWS; row++) pixels.push(cssRgb(colors[row * MATRIX_COLS + side]));
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
  const marker = Array.from({ length: MATRIX_COLS * MATRIX_ROWS }, (_, index) => index);
  const shown = display(marker);
  return spotsOf(attributes).map(({ column }) => {
    const at = shown.indexOf(2 * MATRIX_COLS + column + 2);
    if (at < 0) return null;
    return { x: ((at % cols) + 0.5) / cols, y: (Math.floor(at / cols) + 0.5) / rows };
  });
}

// ── Previews laid out as the lamp's modules ─────────────────────────────
// A Cube Matrix's previews show its modules only: the columns they cover,
// each spot one round light over its 5 x 5 area in its colour (as the
// integration sends it). The 100 cells stay in the page (the cards' painters
// write whole frames), each placed on the grid or left out.

// Where lamp column `column` shows in a frame of the given kind (`viewer`: a
// top-first frame as the viewer sees it, turned for an upside-down mount;
// `drawing`: a picture before that turn, as the gradient previews come; else
// lamp order).
function columnPlace(column, attributes, kind, columns) {
  const upsideDown = isUpsideDownMount(deviceOrientation(attributes));
  if (kind === "viewer" && upsideDown) return MATRIX_COLS - 1 - column;
  if (kind === "drawing" && upsideDown) return columns - 1 - column;
  return column;
}

// What a lamp's module layout depends on, as a key: its columns and spots
// (the spots' JSON computed once per matrix_modules list), and whether it is
// mounted upside down. Previews ask for their layout on every frame.
const SPOT_KEYS = new WeakMap();
function spotKey(attributes) {
  const modules = attributes?.matrix_modules;
  if (!Array.isArray(modules)) return "[]";
  let key = SPOT_KEYS.get(modules);
  if (key === undefined) SPOT_KEYS.set(modules, (key = JSON.stringify(spotsOf(attributes))));
  return key;
}

function layoutKey(attributes) {
  const spots = spotKey(attributes);
  const upsideDown = isUpsideDownMount(deviceOrientation(attributes));
  return `${shownColumns(attributes)}:${spots}:${upsideDown ? 1 : 0}`;
}

// The layouts already worked out, by layoutKey and kind: a handful per lamp.
const SPOT_AREAS = new Map();
const MODULE_GRIDS = new Map();
const NO_SPOTS = Object.freeze([]);

/** A frame's columns per spot (kind: "lamp", "viewer" or "drawing"), the
 * spots the columns shown hold. */
function spotAreas(attributes, kind, key = layoutKey(attributes)) {
  if (!Array.isArray(attributes?.matrix_modules)) return NO_SPOTS;
  const cacheKey = `${key}|${kind}`;
  let areas = SPOT_AREAS.get(cacheKey);
  if (areas) return areas;
  const columns = shownColumns(attributes);
  areas = spotsOf(attributes)
    .filter(({ column }) => column + MODULE_SIZE <= columns)
    .map(({ column }) => {
      const area = Array.from({ length: MODULE_SIZE }, (_, k) =>
        columnPlace(column + k, attributes, kind, columns),
      ).sort((a, b) => a - b);
      return { area, anchor: 2 * MATRIX_COLS + area[2] };
    });
  SPOT_AREAS.set(cacheKey, areas);
  return areas;
}

const rgbOf = (color) =>
  Array.isArray(color) ? color.slice(0, 3).map((value) => Number(value) || 0) : cssRgb(color);

// Each frame's last spot-coloured copy (withSpotColours).
const SPOT_FRAMES = new WeakMap();

/**
 * `frame` (100 colours, [r, g, b] or CSS) with each spot's colour in the
 * middle pixel of its area (the one its preview cell shows): the area's
 * other pixels as one light, their average colour as bright as their
 * brightest (device_profile._spot_colour). Applying it again changes
 * nothing. `kind`: "lamp" (lamp order), "viewer" or "drawing" (columnPlace).
 */
export function withSpotColours(frame, attributes, kind = "lamp") {
  if (!Array.isArray(frame) || frame.length !== MATRIX_COLS * MATRIX_ROWS) return frame;
  const key = layoutKey(attributes);
  const spots = spotAreas(attributes, kind, key);
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
        const index = row * MATRIX_COLS + column;
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
 * whole 20 x 5 frame (a Cube Lite, or 4 modules and no spot): `cols` x
 * `rows` of the grid (`vertical`: the view of a lamp standing on its end),
 * the `columns` covered, and `place`, per top-first pixel of a frame of
 * `kind` ("viewer" by default, or "drawing"): {column, row, span, spot}
 * (1-based grid lines; `span` 5 for a spot's light) or null (left out).
 */
export function moduleGrid(attributes, vertical = false, kind = "viewer") {
  const columns = shownColumns(attributes);
  const key = layoutKey(attributes);
  const spots = spotAreas(attributes, kind, key);
  if (columns >= MATRIX_COLS && !spots.length) return null;
  // Worked out once per layout (shared: callers only read it).
  const cacheKey = `${key}|${kind}|${vertical ? 1 : 0}`;
  let grid = MODULE_GRIDS.get(cacheKey);
  if (!grid) MODULE_GRIDS.set(cacheKey, (grid = buildModuleGrid(attributes, vertical, kind, columns, spots)));
  return grid;
}

function buildModuleGrid(attributes, vertical, kind, columns, spots) {
  const first = kind === "viewer" && isUpsideDownMount(deviceOrientation(attributes)) ? MATRIX_COLS - columns : 0;
  const inSpot = new Map();
  for (const spot of spots) for (const column of spot.area) inSpot.set(column, spot);
  const place = Array.from({ length: MATRIX_COLS * MATRIX_ROWS }, (_, index) => {
    const row = Math.floor(index / MATRIX_COLS);
    const column = index % MATRIX_COLS;
    if (column < first || column >= first + columns) return null;
    const spot = inSpot.get(column);
    if (spot && index !== spot.anchor) return null;
    const along = (spot ? spot.area[0] : column) - first + 1;
    const across = vertical ? (spot ? 1 : MATRIX_ROWS - row) : spot ? 1 : row + 1;
    return vertical
      ? { column: across, row: along, span: spot ? MODULE_SIZE : 1, spot: !!spot }
      : { column: along, row: across, span: spot ? MODULE_SIZE : 1, spot: !!spot };
  });
  return {
    columns,
    cols: vertical ? MATRIX_ROWS : columns,
    rows: vertical ? columns : MATRIX_ROWS,
    place,
  };
}

/** What a preview's module layout depends on, as a key ("" for a Cube Lite). */
export const moduleKey = (attributes) =>
  attributes?.matrix_modules ? `${shownColumns(attributes)}:${spotKey(attributes)}` : "";

/** A grid cell's inline style for its place (moduleGrid): "" with no grid. */
export function placeStyle(place) {
  if (place === undefined) return "";
  if (place === null) return "display:none;";
  const span = place.span > 1 ? ` / span ${place.span}` : "";
  return (
    `grid-column:${place.column}${span};grid-row:${place.row}${span};` +
    (place.spot ? "border-radius:50%;aspect-ratio:1/1;" : "")
  );
}
