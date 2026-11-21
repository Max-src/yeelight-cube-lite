// What every preview of a lamp draws for: one object made from the light's
// attributes (previewContext), read by the renderers' callers
// (native-effect-card-utils.js nativeEffectLampFrame, the lamp preview card),
// the preview markup (gallery-display-utils.js matrixPreviewLayout and the
// gallery's matrixTemplate) and the lamp preview's dots.
//
// It holds the mount (orientation, standing or not, upside down), the
// modules (a Cube Matrix's columns and spots, its grid: matrix-modules.js)
// and the effect's settings as the lamp reports them (speed, intensity,
// palette, color mode...). A Cube Lite, or no lamp at all, is all 20 columns
// and no spot; a Cube Matrix of more than 4 modules is wider (5 columns a
// module, up to 40: its frames are `width` x 5).
import { chosenIntensity, chosenSpeed } from "./lamp-settings.js";
import { adjustmentsOf } from "./color-adjustments.js";
import { moduleGrid, moduleKey, shownColumns, spotsOf } from "./matrix-modules.js";
import {
  MATRIX_ROWS,
  deviceOrientation,
  isUpsideDownMount,
  isVerticalMount,
  lampWidth,
} from "./matrix-view.js";

// Contexts by attributes object, then by options: Home Assistant gives a
// new attributes object for each state, so the same one always means the
// same lamp state. Previews ask on every frame.
const CONTEXTS = new WeakMap();
const NO_ATTRIBUTES = Object.freeze({});

/**
 * The preview context of a lamp (`attrs`: its state attributes; none: a Cube
 * Lite with its defaults). Options: `pendingOrientation`, a mount chosen and
 * not yet reported, which the previews already show; `frame`, what the
 * frames shown are: "viewer" (top row first, turned for an upside-down
 * mount, the default) or "drawing" (a picture before that turn, as the
 * gradient previews come). The same inputs give the same object (frozen).
 *
 * Fields: attrs (as given), lamp (the attributes with the orientation shown:
 * what matrix-modules.js reads), orientation, vertical (standing on its
 * end), upsideDown, frame, columns (the columns the lamp shows, 1-40),
 * width (its frames' columns: max(20, columns)), length (the pixels its
 * effects are drawn on: columns x 5), modules (matrix_modules or null),
 * spots, grid (matrix-modules.js moduleGrid for `vertical`, null for the
 * whole frame), moduleKey, speed and intensity (as chosen,
 * 0-255), direction, color, colorMode, palette, stored, layout,
 * adjustments.
 */
export function previewContext(attrs, { pendingOrientation = null, frame = "viewer" } = {}) {
  const source = attrs && typeof attrs === "object" ? attrs : NO_ATTRIBUTES;
  let byOptions = CONTEXTS.get(source);
  if (!byOptions) CONTEXTS.set(source, (byOptions = new Map()));
  const key = `${pendingOrientation ?? ""}|${frame}`;
  let context = byOptions.get(key);
  if (!context) byOptions.set(key, (context = buildContext(source, pendingOrientation, frame)));
  return context;
}

function buildContext(attrs, pendingOrientation, frame) {
  const orientation = pendingOrientation || deviceOrientation(attrs);
  // What matrix-modules.js reads the mount from.
  const lamp =
    attrs.device_orientation === orientation || (!attrs.device_orientation && !pendingOrientation)
      ? attrs
      : { ...attrs, device_orientation: orientation };
  const vertical = isVerticalMount(orientation);
  const columns = shownColumns(attrs);
  return Object.freeze({
    attrs,
    lamp,
    orientation,
    vertical,
    upsideDown: isUpsideDownMount(orientation),
    frame,
    columns,
    width: lampWidth(attrs),
    length: columns * MATRIX_ROWS,
    modules: Array.isArray(attrs.matrix_modules) ? attrs.matrix_modules : null,
    spots: spotsOf(attrs),
    grid: moduleGrid(lamp, vertical, frame),
    moduleKey: moduleKey(attrs),
    speed: chosenSpeed(attrs),
    intensity: chosenIntensity(attrs),
    direction: attrs.native_effect_direction ?? null,
    color: attrs.native_effect_color || null,
    colorMode: attrs.native_effect_color_mode || "normal",
    palette: attrs.text_colors,
    stored: attrs.stored_gif,
    layout: attrs.animation_layout,
    adjustments: adjustmentsOf(attrs),
  });
}

/** The module grid of a preview drawn `vertical` (or not) for `context`:
 * its own when the preview stands as the lamp does. */
export const contextGrid = (context, vertical = context.vertical) =>
  vertical === context.vertical ? context.grid : moduleGrid(context.lamp, vertical, context.frame);
