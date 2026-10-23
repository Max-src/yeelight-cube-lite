// Color information helpers of the color list editor card: hex/RGB
// conversion, the color labels (the shared swatches' names) and contrasting
// text.
// Mixed into YeelightCubeColorListEditorCard.
import { contrastInk, hexToRgb, rgbToCss, rgbToHex } from "./color-utils.js";
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

  // Black or white text on `backgroundColor`, whichever contrasts more
  // (color-utils.js, like the action buttons' ink).
  getContrastTextColor(backgroundColor) {
    return contrastInk(backgroundColor, "#000000", "#ffffff");
  }

  // Adjust color brightness for gradients
  adjustColorBrightness(rgb, amount) {
    return rgbToCss(rgb.map((channel) => channel + amount));
  }
};
