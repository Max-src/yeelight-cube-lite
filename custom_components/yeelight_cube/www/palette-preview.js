/**
 * A palette as a gallery item preview (collection-gallery.js `previewHtml`)
 * and as a chip swatch (`swatch`). Palettes are lists of colors, not
 * matrices: the preview is the shared swatches (<yc-swatches>,
 * yc-swatches.js) in the card's swatch_layout / swatch_shape, sized in cqw
 * (the gallery's inline-size container, itemPreviewTemplate) so it follows
 * the gallery's Size in every layout. Cards showing these previews define
 * yc-swatches and include palettePreviewStyles.
 */
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { toHex } from "./swatch-utils.js";

/** The palette's colors blended left to right, as a CSS background. */
export function paletteGradient(colors = []) {
  const css = colors.map(rgbToCss);
  if (!css.length) return "transparent";
  return `linear-gradient(to right, ${(css.length === 1 ? [css[0], css[0]] : css).join(", ")})`;
}

/**
 * The preview markup of a palette: `look` is { layout, shape, direction }
 * (the card's swatch_* options). Attribute values are fixed words and hex
 * codes only (toHex).
 */
export function palettePreviewHtml(colors = [], look = {}) {
  const word = (value) => String(value || "").replace(/[^a-z-]/g, "");
  const hexes = colors.map(toHex).filter(Boolean).join(" ");
  return `<yc-swatches class="yc-palette-preview" layout="${word(look.layout) || "row"}" shape="${
    word(look.shape) || "rounded"
  }" direction="${word(look.direction) || "rows"}" colors="${hexes}"></yc-swatches>`;
}

/** "1 color" / "n colors". */
export function colorCountLabel(colors = []) {
  return colors.length === 1 ? "1 color" : `${colors.length} colors`;
}

export const palettePreviewStyles = `
  /* A palette preview: the shape of a matrix preview (4:1), growing only
     when many swatches need more rows; the swatches sized in cqw. */
  .yc-palette-preview {
    width: 100%;
    min-height: 25cqw;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    --yc-swatch-size: 9cqw;
    --yc-swatch-gap: 1.6cqw;
    --yc-swatch-radius: max(2px, 1.6cqw);
    --yc-swatch-ring: none;
    --yc-swatch-shadow: 0 0 0 1px var(--divider-color, #ccc);
    --yc-swatch-bar-height: 11cqw;
    --yc-swatch-bar-shadow: 0 0 0 1px var(--divider-color, #ddd);
  }
`;
