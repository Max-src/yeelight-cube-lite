// How the 20x5 matrix looks to someone facing the lamp: the one place every
// preview (lamp preview, galleries, drawing grid, clock and effect previews)
// turns a frame into what it shows. Mirrored by matrix_view.py (the cameras).
//
// Frames are `width` x 5 pixels, row-major (width 20: 100 pixels; a Cube
// Matrix of more than 4 modules: 5 columns a module, frameWidth), in one of
// two orders:
//   - lamp order: row 0 = the lamp's bottom row (matrix_colors, pixel-art
//     positions, renderClockFrame / renderNativeEffect);
//   - top-first: row 0 = the top row, as a screen draws (gallery colorData,
//     the drawing grid).
//
// The device orientation (right / down / left / up) is how the lamp is
// mounted: right lies flat (the default), left lies flat upside down, down
// stands on its left end and up on its right end. Plugin content is already
// turned a half turn for left / up before it is sent (light_render.py
// _flip_position) and the lamp's own content is not, so a frame of what the lamp
// shows is turned a half turn for those mounts to read as the viewer sees it.
//
// A view is landscape (width columns x 5 rows) or vertical (5 x width): the
// top-first frame turned a quarter turn clockwise, its left end on top
// (how the official app draws its vertical pixel arts).

export const MATRIX_COLS = 20;
export const MATRIX_ROWS = 5;
export const MATRIX_SIZE = MATRIX_COLS * MATRIX_ROWS;
// A vertical view at the same pixel size is this many times narrower.
export const VERTICAL_SCALE = MATRIX_COLS / MATRIX_ROWS;
// The widest frame: 8 modules of 5 columns (device_profile.MAX_COLS).
export const MAX_MATRIX_COLS = 40;

/** The width (columns) of a frame of `length` pixels (or of a frame): 20,
 * or a longer Cube Matrix's (width x 5 pixels, up to MAX_MATRIX_COLS). */
export function frameWidth(frame) {
  const length = typeof frame === "number" ? frame : frame?.length ?? 0;
  const width = length / MATRIX_ROWS;
  return Number.isInteger(width) && width > MATRIX_COLS && width <= MAX_MATRIX_COLS
    ? width
    : MATRIX_COLS;
}

/** The width of a lamp's frames from its attributes: max(20, matrix_columns)
 * (device_profile.width). */
export function lampWidth(attributes) {
  const columns = Number(attributes?.matrix_columns);
  return Number.isInteger(columns) && columns > MATRIX_COLS
    ? Math.min(MAX_MATRIX_COLS, columns)
    : MATRIX_COLS;
}

/** How many times narrower a vertical view of a frame `width` wide is at
 * the same pixel size. */
export const verticalScale = (width = MATRIX_COLS) => width / MATRIX_ROWS;

const DEFAULT_ORIENTATION = "right";
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

/** Whether the Lamp mounted setting reaches the lamp's own clock: it is
 * written to the lamp's mount profile, which takes a server that delivers the
 * Yeelight commands (the light's `matter.commands`). Without one the lamp's
 * clock stays as it is (light.set_device_orientation). */
export const lampTakesMount = (attributes) => Boolean(attributes?.matter?.commands);

/**
 * Whether the clock's digits are laid out a half turn round, as the light
 * says (`mount_profile.clock_turned`, light_mount_profile.lamp_turns_clock).
 * A Cube Lite does it on the mount profile it runs (0 or 1, the fallback for
 * a light that does not say); a Cube Matrix numbers its rotations otherwise
 * and its clock is streamed turned on the Device Orientations
 * CLOCK_TURNED_ORIENTATIONS. Only the digits turn: the background stays
 * where it is on the panel (renderClockFrame). Native effects never are
 * (the integration compensates their direction).
 */
export const lampTurnsClock = (attributes) => {
  const profile = attributes?.mount_profile;
  if (typeof profile?.clock_turned === "boolean") return profile.clock_turned;
  return [0, 1].includes(profile?.pending ?? profile?.in_use ?? profile?.profile);
};

// mount_profile.py CLOCK_TURNED_ORIENTATIONS: the Device Orientations whose
// clock is laid out a half turn round (a Cube Lite's profiles 0 and 1).
const CLOCK_TURNED_ORIENTATIONS = new Set(["left", "up"]);

// The lamp's mount profile for each Device Orientation (matter_link.py
// ROTATION_ORIENTATIONS).
const ORIENTATION_PROFILES = Object.freeze({ left: 0, up: 1, right: 2, down: 3 });

/** `attributes` with the mount profile a Device Orientation being set
 * (`pending`, a card's own pick) is about to give the lamp, when it reaches
 * the lamp (lampTakesMount): a preview turned for the new orientation then
 * shows the clock as the lamp will, never the old profile in the new
 * orientation (light_mount_profile.lamp_turns_clock does the same). */
export function withPendingMount(attributes, pending) {
  if (!pending || pending === deviceOrientation(attributes) || !lampTakesMount(attributes))
    return attributes;
  return {
    ...attributes,
    mount_profile: {
      ...attributes?.mount_profile,
      pending: ORIENTATION_PROFILES[pending],
      clock_turned: CLOCK_TURNED_ORIENTATIONS.has(pending),
    },
  };
}


/** Reverse the row order of a row-major frame (lamp order <-> top-first). */
export function flipMatrixVertical(pixels, cols = frameWidth(pixels), rows = MATRIX_ROWS) {
  const out = new Array(pixels.length);
  for (let r = 0; r < rows; r++) {
    const src = (rows - 1 - r) * cols;
    const dst = r * cols;
    for (let c = 0; c < cols; c++) out[dst + c] = pixels[src + c];
  }
  return out;
}

/** The top-first index of a lamp-order index (and back: the map is its own
 * inverse), in a frame 20 wide (flipIndexIn: another width). */
export const flipIndexVertical = (index) => flipIndexIn(index, MATRIX_COLS);

/** flipIndexVertical in a frame `width` wide. */
export function flipIndexIn(index, width) {
  const row = Math.floor(index / width);
  return (MATRIX_ROWS - 1 - row) * width + (index % width);
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
 * The geometry of a landscape or vertical view of a frame `width` columns
 * wide (20 by default): its columns and rows, its `width`, and for each
 * displayed cell (row-major) the top-first index it shows (`source`), and
 * the reverse (`target`).
 */
export function matrixView(vertical = false, width = MATRIX_COLS) {
  const tall = !!vertical;
  const panel = frameWidth(width * MATRIX_ROWS);
  const key = `${tall ? 1 : 0}:${panel}`;
  let view = views.get(key);
  if (!view) {
    const cols = tall ? MATRIX_ROWS : panel;
    const rows = tall ? panel : MATRIX_ROWS;
    const size = panel * MATRIX_ROWS;
    const source = new Array(size);
    const target = new Array(size);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const display = row * cols + col;
        // Vertical: display row r is matrix column r, display column c the
        // matrix row c counted from the bottom (the bottom edge on the left).
        const index = tall ? (MATRIX_ROWS - 1 - col) * panel + row : display;
        source[display] = index;
        target[index] = display;
      }
    }
    view = Object.freeze({ vertical: tall, cols, rows, width: panel, source, target });
    views.set(key, view);
  }
  return view;
}

/** A top-first frame in the display order of a view (as a grid lists its
 * cells; its width follows its length, frameWidth). Landscape returns the
 * frame itself. */
export function toDisplayOrder(frame, vertical = false) {
  if (!vertical) return frame;
  const { source } = matrixView(true, frameWidth(frame));
  return source.map((index) => frame[index]);
}

/** The top-first frame of cells listed in a view's display order. */
export function fromDisplayOrder(cells, vertical = false) {
  if (!vertical) return cells;
  const { target } = matrixView(true, frameWidth(cells));
  return target.map((display) => cells[display]);
}

/** Whether a pixel art is drawn for a lamp standing on its end. */
export const isVerticalArt = (art) => art?.orientation === "vertical";

/** A pixel art's orientation value for a view. */
export const artOrientation = (vertical) => (vertical ? "vertical" : "horizontal");
