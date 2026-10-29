// How the 20x5 matrix looks to someone facing the lamp: the one place every
// preview (lamp preview, galleries, drawing grid, clock and effect previews)
// turns a frame into what it shows. Mirrored by matrix_view.py (the cameras).
//
// Frames are 100 pixels, row-major, in one of two orders:
//   - lamp order: row 0 = the lamp's bottom row (matrix_colors, pixel-art
//     positions, renderClockFrame / renderNativeEffect);
//   - top-first: row 0 = the top row, as a screen draws (gallery colorData,
//     the drawing grid).
//
// The device orientation (right / down / left / up) is how the lamp is
// mounted: right lies flat (the default), left lies flat upside down, down
// stands on its left end and up on its right end. Plugin content is already
// turned a half turn for left / up before it is sent (light_render.py
// _flip_position) and firmware content is not, so a frame of what the lamp
// shows is turned a half turn for those mounts to read as the viewer sees it.
//
// A view is landscape (20 columns x 5 rows) or vertical (5 x 20): the
// top-first frame turned a quarter turn clockwise, its left end on top
// (how the official app draws its vertical pixel arts).

export const MATRIX_COLS = 20;
export const MATRIX_ROWS = 5;
export const MATRIX_SIZE = MATRIX_COLS * MATRIX_ROWS;
// A vertical view at the same pixel size is this many times narrower.
export const VERTICAL_SCALE = MATRIX_COLS / MATRIX_ROWS;

export const DEFAULT_ORIENTATION = "right";
const VERTICAL_MOUNTS = new Set(["down", "up"]);
const UPSIDE_DOWN_MOUNTS = new Set(["left", "up"]);

/** Whether the lamp stands on one end (down / up). */
export const isVerticalMount = (orientation) => VERTICAL_MOUNTS.has(orientation);

/** Whether the lamp is turned a half turn from its default (left / up). */
export const isUpsideDownMount = (orientation) =>
  UPSIDE_DOWN_MOUNTS.has(orientation);

/** The lamp's device orientation from its state attributes ("right" when
 * unknown). */
export const deviceOrientation = (attributes) =>
  attributes?.device_orientation || DEFAULT_ORIENTATION;

/**
 * Whether the lamp's firmware draws its clock turned a half turn: the mount
 * profile it runs (the Yeelight app's orientation, the light's
 * `mount_profile.in_use`; the firmware default 3 when none is known) is 0
 * or 1. Native effects never are (the integration compensates their
 * direction). Mirrors light_mount_profile.lamp_turns_clock.
 */
export const lampTurnsClock = (attributes) => {
  const profile = attributes?.mount_profile;
  return [0, 1].includes(profile?.in_use ?? profile?.profile);
};

/** A frame of the firmware clock (renderClockFrame: lamp order) as the lamp
 * draws it, turned with its mount profile (lampTurnsClock). */
export const firmwareClockFrame = (frame, attributes) =>
  lampTurnsClock(attributes) ? [...frame].reverse() : frame;

/** Reverse the row order of a row-major frame (lamp order <-> top-first). */
export function flipMatrixVertical(pixels, cols = MATRIX_COLS, rows = MATRIX_ROWS) {
  const out = new Array(pixels.length);
  for (let r = 0; r < rows; r++) {
    const src = (rows - 1 - r) * cols;
    const dst = r * cols;
    for (let c = 0; c < cols; c++) out[dst + c] = pixels[src + c];
  }
  return out;
}

/** The top-first index of a lamp-order index (and back: the map is its own
 * inverse). */
export function flipIndexVertical(index) {
  const row = Math.floor(index / MATRIX_COLS);
  return (MATRIX_ROWS - 1 - row) * MATRIX_COLS + (index % MATRIX_COLS);
}

/**
 * A frame of what the lamp shows (lamp order) as the viewer sees it,
 * top-first and landscape: turned a half turn for upside-down mounts.
 */
export function viewerFrame(lampOrderFrame, orientation) {
  const frame = flipMatrixVertical(lampOrderFrame);
  return isUpsideDownMount(orientation) ? frame.reverse() : frame;
}

const views = new Map();

/**
 * The geometry of a landscape or vertical view: its columns and rows, and
 * for each displayed cell (row-major) the top-first index it shows
 * (`source`), and the reverse (`target`).
 */
export function matrixView(vertical = false) {
  const key = !!vertical;
  let view = views.get(key);
  if (!view) {
    const cols = key ? MATRIX_ROWS : MATRIX_COLS;
    const rows = key ? MATRIX_COLS : MATRIX_ROWS;
    const source = new Array(MATRIX_SIZE);
    const target = new Array(MATRIX_SIZE);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const display = row * cols + col;
        // Vertical: display row r is matrix column r, display column c the
        // matrix row c counted from the bottom (the bottom edge on the left).
        const index = key ? (MATRIX_ROWS - 1 - col) * MATRIX_COLS + row : display;
        source[display] = index;
        target[index] = display;
      }
    }
    view = Object.freeze({ vertical: key, cols, rows, source, target });
    views.set(key, view);
  }
  return view;
}

/** A top-first frame in the display order of a view (as a grid lists its
 * cells). Landscape returns the frame itself. */
export function toDisplayOrder(frame, vertical = false) {
  if (!vertical) return frame;
  const { source } = matrixView(true);
  return source.map((index) => frame[index]);
}

/** The top-first frame of cells listed in a view's display order. */
export function fromDisplayOrder(cells, vertical = false) {
  if (!vertical) return cells;
  const { target } = matrixView(true);
  return target.map((display) => cells[display]);
}

/** Whether a pixel art is drawn for a lamp standing on its end. */
export const isVerticalArt = (art) => art?.orientation === "vertical";

/** A pixel art's orientation value for a view. */
export const artOrientation = (vertical) => (vertical ? "vertical" : "horizontal");
