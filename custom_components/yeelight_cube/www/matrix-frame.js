// The frame of every matrix preview: the shared gallery's previews
// (gallery-display-utils.js matrixPreviewLayout), the Lamp Preview's dots,
// the drawing grid, the gradient angle preview. One place decides its width
// (landscape or vertical, matrix-view.js), the container its lengths follow
// and its gap, padding, corners, background and shadow, so every preview
// keeps the same look whatever the lamp's orientation.
import { previewLength } from "./preview-appearance.js";
import { matrixView, VERTICAL_SCALE } from "./matrix-view.js";

/**
 * A preview's CSS length for a design value (px at the 350px reference
 * width): proportional to the preview's width (previewLength), or plain
 * pixels. A vertical preview is VERTICAL_SCALE times narrower, so its
 * values scale up to keep the landscape look.
 */
export function frameLength({ vertical = false, proportional = true } = {}) {
  const scale = vertical ? VERTICAL_SCALE : 1;
  return (value) =>
    proportional ? previewLength(value * scale) : `${value}px`;
}

// A width divided for a vertical frame: numbers stay pixels.
const narrowed = (width, by) =>
  by === 1
    ? typeof width === "number"
      ? `${width}px`
      : width
    : typeof width === "number"
      ? `${width / by}px`
      : `calc(${width} / ${by})`;

/**
 * The frame of a matrix preview.
 * @param {Object} options
 *   width        the landscape preview's width: px (number) or a CSS length
 *                ("100%"); a vertical one is VERTICAL_SCALE times narrower
 *                at the same pixel size (VERTICAL_SCALE² with fitHeight: as
 *                tall as the landscape one, for fixed-height places)
 *   vertical, fitHeight
 *   cols         landscape columns (default 20; fewer for a crop of the frame)
 *   gap, padding (default gap x 2), radius (corners, default 4): design px
 *   background, shadow (the frame's drop shadow)
 *   proportional lengths follow the preview's width (default), else px
 * @returns {{view, length, width, wrapperStyle, gridStyle}} `wrapperStyle`
 *   sizes the container the lengths follow (proportional), `gridStyle` the
 *   grid of cells (columns, gap, padding, corners, background, shadow);
 *   margins (alignment) are the caller's.
 */
export function matrixFrame({
  width = "100%",
  vertical = false,
  fitHeight = false,
  cols,
  gap = 1,
  padding = gap * 2,
  radius = 4,
  background = "#000000",
  shadow = false,
  proportional = true,
} = {}) {
  const view = matrixView(vertical);
  const length = frameLength({ vertical: view.vertical, proportional });
  const narrow = view.vertical
    ? fitHeight
      ? VERTICAL_SCALE ** 2
      : VERTICAL_SCALE
    : 1;
  const size = `width: ${narrowed(width, narrow)};`;
  return {
    view,
    length,
    width: size,
    wrapperStyle: `container-type:inline-size;max-width:100%;${size}`,
    gridStyle:
      `grid-template-columns:repeat(${(!view.vertical && cols) || view.cols},1fr);gap:${length(gap)};` +
      `background:${background};padding:${length(padding)};border-radius:${length(radius)};` +
      `${proportional ? "width:100%;" : size}box-sizing:border-box;` +
      (shadow
        ? `box-shadow: 0 ${length(2)} ${length(8)} rgba(0,0,0,0.5);`
        : ""),
  };
}
