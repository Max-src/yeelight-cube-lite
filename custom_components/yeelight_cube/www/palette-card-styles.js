// Stylesheet of the palette card (static): the shared card frame and
// gallery, the palette previews and the export / import buttons.
import { cardLayoutStyles } from "./card-layout-utils.js";
import { collectionGalleryStyles } from "./collection-gallery.js";
import { palettePreviewStyles } from "./palette-preview.js";
import { exportImportButtonStyles } from "./action-button-utils.js";

export const PALETTE_CARD_CSS = `
  ${cardLayoutStyles}
  ${collectionGalleryStyles}
  ${palettePreviewStyles}
  ${exportImportButtonStyles}
  /* Delete buttons placed outside an item may overflow the card. */
  :host,
  ha-card {
    overflow: visible !important;
  }
`;
