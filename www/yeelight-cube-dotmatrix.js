export function applyBrightness(rgb, brightness) {
  let factor = brightness > 1 ? brightness / 255 : brightness;
  if (brightness > 1 && brightness <= 100) factor = brightness / 100;
  return [
    Math.round(rgb[0] * factor),
    Math.round(rgb[1] * factor),
    Math.round(rgb[2] * factor),
  ];
}

export function rgbToCss(rgb) {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

export function renderDotMatrix({
  totalRows = 5,
  totalCols = 20,
  dotRadius = 7,
  dotSpacingX = 18,
  dotSpacingY = 18,
  gridColors = [],
  background = "black",
  className = "",
  paddingX = 10,
  paddingY = 10,
}) {
  // svgWidth and svgHeight must match the preview card's width/height
  // The first dot center is at (paddingX + dotRadius), last at (svgWidth - paddingX - dotRadius)
  // So svgWidth = (totalCols - 1) * dotSpacingX + 2 * paddingX + dotDiameter
  const svgWidth = (totalCols - 1) * dotSpacingX + 2 * paddingX + 2 * dotRadius;
  const svgHeight =
    (totalRows - 1) * dotSpacingY + 2 * paddingY + 2 * dotRadius;
  let dots = "";
  for (let row = 0; row < totalRows; row++) {
    for (let col = 0; col < totalCols; col++) {
      const idx = row * totalCols + col;
      const color = gridColors[idx] || "#222";
      // Y: row 0 is at the top
      const y = paddingY + dotRadius + row * dotSpacingY;
      const x = paddingX + dotRadius + col * dotSpacingX;
      dots += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${color}" stroke="black" stroke-width="2"/>`;
    }
  }
  const classAttr = className ? ` class="${className}"` : "";
  return `<svg width="${svgWidth}" height="${svgHeight}"${classAttr} style="background:${background};display:block;">${dots}</svg>`;
}

// Export default to ensure module loads properly
export default {
  applyBrightness,
  rgbToCss,
  renderDotMatrix,
};
