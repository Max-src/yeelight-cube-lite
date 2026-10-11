// Color information helpers of the color list editor card: hex/RGB
// conversion, the color labels (the shared swatches' names), luminance and
// contrasting text.
// Mixed into YeelightCubeColorListEditorCard.
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { hexToRgb, rgbToHex } from "./color-utils.js";
import { closestColorName, colorLabel } from "./swatch-utils.js";

export const ColorInfoMixin = (Base) => class extends Base {
  // ----- Color helpers -----------------------------------------------

  rgbToHex(rgb) {
    return rgbToHex(rgb);
  }

  hexToRgb(hex) {
    return hexToRgb(hex);
  }

  // The shared color names and labels (swatch-utils.js).
  getClosestCssColorName(rgb) {
    return closestColorName(rgb);
  }

  formatColorInfo(color, displayMode) {
    return colorLabel(color, displayMode);
  }

  // Calculate relative luminance based on WCAG guidelines
  getRelativeLuminance(rgb) {
    const [r, g, b] = rgb.map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Determine if we should use light or dark text based on background color
  getContrastTextColor(backgroundColor) {
    const luminance = this.getRelativeLuminance(backgroundColor);
    // WCAG threshold - use dark text on light backgrounds, light text on dark backgrounds
    return luminance > 0.179 ? "#000000" : "#ffffff";
  }

  // Adjust color brightness for gradients
  adjustColorBrightness(rgb, amount) {
    return rgbToCss(rgb.map((channel) => channel + amount));
  }
};
