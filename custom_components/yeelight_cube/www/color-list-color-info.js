// Color information helpers of the color list editor card: the color labels
// (the shared swatches' names) and contrasting text.
// Mixed into YeelightCubeColorListEditorCard.
import { contrastInk, rgbToCss } from "./color-utils.js";
import { colorLabel } from "./swatch-utils.js";

export const ColorInfoMixin = (Base) => class extends Base {
  // ----- Color helpers -----------------------------------------------

  // The shared color labels (swatch-utils.js).
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
