/**
 * angle-wheel-utils.js
 * Shared utility functions for angle wheel / rotary controls.
 * Used by both yeelight-cube-gradient-card.js and yeelight-cube-color-list-editor-card.js
 */

// Debounce time for angle updates (ms)
export const ANGLE_UPDATE_DEBOUNCE_MS = 150;

/**
 * Convert an RGB array [r, g, b] to a hex color string "#rrggbb"
 */
export function rgbToHex(rgb) {
  return (
    "#" +
    rgb
      .map((x) => {
        const hex = x.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}

/**
 * Create SVG pie-slice segments for a color wheel.
 * @param {Array<Array<number>>} colors - Array of [r,g,b] arrays
 * @param {number} radius - Radius of the wheel
 * @returns {string} SVG markup string
 */
export function createColorWheelSegments(colors, radius) {
  if (!colors || colors.length === 0) {
    return `<circle cx="50" cy="50" r="${radius}" fill="#ff0000"/>`;
  }

  if (colors.length === 1) {
    const hex = rgbToHex(colors[0]);
    return `<circle cx="50" cy="50" r="${radius}" fill="${hex}"/>`;
  }

  const segments = [];
  const anglePerSegment = 360 / colors.length;

  for (let i = 0; i < colors.length; i++) {
    const startAngle = (i * anglePerSegment - 90) * (Math.PI / 180);
    const endAngle = ((i + 1) * anglePerSegment - 90) * (Math.PI / 180);

    const x1 = 50 + radius * Math.cos(startAngle);
    const y1 = 50 + radius * Math.sin(startAngle);
    const x2 = 50 + radius * Math.cos(endAngle);
    const y2 = 50 + radius * Math.sin(endAngle);

    const largeArcFlag = anglePerSegment > 180 ? 1 : 0;
    const hex = rgbToHex(colors[i]);

    const pathData = [
      `M 50 50`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      `Z`,
    ].join(" ");

    segments.push(`<path d="${pathData}" fill="${hex}"/>`);
  }

  return segments.join("\n                ");
}

/**
 * Create SVG linear gradient stops for a wheel-style display.
 * @param {Array<Array<number>>} colors - Array of [r,g,b] arrays
 * @returns {string} SVG stop elements markup
 */
export function createWheelGradientStops(colors) {
  if (!colors || colors.length === 0) {
    return '<stop offset="0%" style="stop-color:#ff0000"/><stop offset="100%" style="stop-color:#ff0000"/>';
  }

  if (colors.length === 1) {
    const hex = rgbToHex(colors[0]);
    return `<stop offset="0%" style="stop-color:${hex}"/><stop offset="100%" style="stop-color:${hex}"/>`;
  }

  const stops = [];

  for (let i = 0; i < colors.length; i++) {
    const offset = (i / (colors.length - 1)) * 100;
    const hex = rgbToHex(colors[i]);
    stops.push(`<stop offset="${offset}%" style="stop-color:${hex}"/>`);
  }

  return stops.join("\n                  ");
}

/**
 * Create symmetric SVG gradient stops for shape-based displays (rect, arrow, star).
 * Extends the first and last colors slightly at each end.
 * @param {Array<Array<number>>} colors - Array of [r,g,b] arrays
 * @returns {string} SVG stop elements markup
 */
export function createShapeGradientStops(colors) {
  if (!colors || colors.length === 0) {
    return '<stop offset="0%" style="stop-color:#ff0000"/><stop offset="100%" style="stop-color:#ff0000"/>';
  }

  if (colors.length === 1) {
    const hex = rgbToHex(colors[0]);
    return `<stop offset="0%" style="stop-color:${hex}"/><stop offset="100%" style="stop-color:${hex}"/>`;
  }

  const stops = [];
  const extension = 10;
  const startOffset = extension;
  const endOffset = 100 - extension;
  const gradientRange = endOffset - startOffset;

  const firstColor = rgbToHex(colors[0]);
  stops.push(`<stop offset="0%" style="stop-color:${firstColor}"/>`);

  for (let i = 0; i < colors.length; i++) {
    const offset = startOffset + (i / (colors.length - 1)) * gradientRange;
    const hex = rgbToHex(colors[i]);
    stops.push(`<stop offset="${offset}%" style="stop-color:${hex}"/>`);
  }

  const lastColor = rgbToHex(colors[colors.length - 1]);
  stops.push(`<stop offset="100%" style="stop-color:${lastColor}"/>`);

  return stops.join("\n                  ");
}

/**
 * Generate an SVG mask shape for the rotary control.
 * @param {string} shape - Shape type: "rectangle", "arrow_classic", "arrow", "star"
 * @param {number} selectorRadius - Radius used for sizing
 * @returns {string} SVG element markup for the mask
 */
export function generateShapeMask(shape, selectorRadius) {
  const size = selectorRadius * 1.8;
  const centerX = 50;
  const centerY = 50;

  switch (shape) {
    case "rectangle":
      const rectWidth = size;
      const rectHeight = size * 0.6;
      const rectX = centerX - rectWidth / 2;
      const rectY = centerY - rectHeight / 2;
      return `<rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" rx="6" fill="white"/>`;

    case "arrow_classic":
      const classicLength = size;
      const classicBodyWidth = size * 0.25;
      const classicHeadWidth = size * 0.5;
      const classicHeadLength = size * 0.3;

      const tipX = centerX + classicLength / 2;
      const bodyLeft = centerX - classicLength / 2;
      const bodyTop = centerY - classicBodyWidth / 2;
      const bodyBottom = centerY + classicBodyWidth / 2;
      const headTop = centerY - classicHeadWidth / 2;
      const headBottom = centerY + classicHeadWidth / 2;
      const headStart = tipX - classicHeadLength;

      return `<path d="
          M ${bodyLeft} ${bodyTop}
          L ${headStart} ${bodyTop}
          L ${headStart} ${headTop}
          L ${tipX} ${centerY}
          L ${headStart} ${headBottom}
          L ${headStart} ${bodyBottom}
          L ${bodyLeft} ${bodyBottom}
          Z" fill="white"/>`;

    case "arrow":
      return generateShapeMask("arrow_classic", selectorRadius);

    case "star":
      const starOuterRadius = selectorRadius;
      const starInnerRadius = starOuterRadius * 0.4;
      const starPoints = [];
      const startAngle = 0;

      for (let i = 0; i < 10; i++) {
        const angle = startAngle + (i * Math.PI) / 5;
        const radius = i % 2 === 0 ? starOuterRadius : starInnerRadius;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY - radius * Math.sin(angle);
        starPoints.push(`${x},${y}`);
      }
      return `<polygon points="${starPoints.join(" ")}" fill="white"/>`;

    default:
      return generateShapeMask("rectangle", selectorRadius);
  }
}
