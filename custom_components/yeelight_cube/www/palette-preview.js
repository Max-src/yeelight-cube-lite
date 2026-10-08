/**
 * A palette as a gallery item preview (collection-gallery.js `previewHtml`)
 * and as a chip swatch (`swatch`). Palettes are lists of colors, not
 * matrices, so the card draws them itself in one of five swatch styles
 * (swatch_style):
 *   square, round  one swatch per color
 *   gradient       a bar blending the colors
 *   gradient-bg    the whole preview filled with that blend
 *   stripes        a bar of equal color bands
 * The markup sits in the gallery's inline-size container (renderItemPreview),
 * so every size is in cqw: the previews follow the gallery's Size in every
 * layout. Colors come from rgbToCss, which only emits rgb() values.
 * Cards showing these previews include palettePreviewStyles.
 */
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";

export const PALETTE_SWATCH_STYLES = [
  "square",
  "round",
  "gradient",
  "gradient-bg",
  "stripes",
];

/** The palette's colors blended left to right, as a CSS background. */
export function paletteGradient(colors = []) {
  const css = colors.map(rgbToCss);
  if (!css.length) return "transparent";
  return `linear-gradient(to right, ${(css.length === 1 ? [css[0], css[0]] : css).join(", ")})`;
}

// The colors as equal hard-edged bands.
function paletteStripes(colors) {
  const step = 100 / colors.length;
  return `linear-gradient(to right, ${colors
    .map(
      (color, index) =>
        `${rgbToCss(color)} ${index * step}% ${(index + 1) * step}%`,
    )
    .join(", ")})`;
}

/** The preview markup of a palette in a swatch style. */
export function palettePreviewHtml(colors = [], style = "square") {
  if (style === "gradient-bar") style = "gradient"; // older name
  if (style === "gradient-bg")
    return `<div class="yc-palette-preview yc-palette-fill" style="background:${paletteGradient(colors)};"></div>`;
  if (style === "gradient" || style === "stripes")
    return `<div class="yc-palette-preview"><div class="yc-palette-bar${
      style === "stripes" ? " yc-palette-stripes" : ""
    }" style="background:${
      style === "stripes" && colors.length ? paletteStripes(colors) : paletteGradient(colors)
    };"></div></div>`;
  return `<div class="yc-palette-preview"><div class="yc-palette-swatches">${colors
    .map(
      (color) =>
        `<span class="yc-palette-dot${style === "round" ? " yc-round" : ""}" style="background:${rgbToCss(color)};"></span>`,
    )
    .join("")}</div></div>`;
}

/** "1 color" / "n colors". */
export function colorCountLabel(colors = []) {
  return colors.length === 1 ? "1 color" : `${colors.length} colors`;
}

export const palettePreviewStyles = `
  /* A palette preview: the shape of a matrix preview (4:1), growing only
     when many swatches need more rows. */
  .yc-palette-preview {
    width: 100%;
    min-height: 25cqw;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }
  .yc-palette-fill {
    border-radius: max(4px, 2cqw);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  }
  .yc-palette-bar {
    width: 100%;
    height: 11cqw;
    border-radius: 5.5cqw;
    box-shadow: 0 0 0 1px var(--divider-color, #ddd);
  }
  .yc-palette-bar.yc-palette-stripes {
    height: 14cqw;
    border-radius: max(3px, 1.5cqw);
  }
  .yc-palette-swatches {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-content: center;
    gap: 1.6cqw;
    padding: 1cqw 0;
  }
  .yc-palette-dot {
    width: 9cqw;
    aspect-ratio: 1;
    border-radius: max(2px, 1.6cqw);
    box-shadow: 0 0 0 1px var(--divider-color, #ccc);
  }
  .yc-palette-dot.yc-round {
    border-radius: 50%;
  }
`;
