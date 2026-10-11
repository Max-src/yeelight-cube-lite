// Stylesheet of the clock card.
import { cardLayoutStyles } from "./card-layout-utils.js";
import { actionButtonStyles } from "./action-button-utils.js";
import { colorPickerStyles } from "./color-picker-utils.js";
import { collectionGalleryStyles } from "./collection-gallery.js";
import { sliderControlStyles } from "./slider-control-utils.js";
import { colorModeSelectorStyles } from "./color-mode-selector-utils.js";

// Card styles (static Lit styles; unchanged from the former inline <style>).
export const CLOCK_CARD_CSS = `
      ${cardLayoutStyles}
      :host { display: block; --action-row-icon-align: flex-start; }
      /* The frame, its header and padding come from the shared card shell. */
      .active-label { font-size: 0.9em; color: var(--secondary-text-color, #9aa); }
      /* The Content and Format sections sit side by side when the card is
         wide enough, and wrap to their own rows otherwise. */
      .section-row > .section { flex: 1 1 auto; min-width: 0; }

      .current-preview { display: flex; justify-content: center; }
      .current-preview-inner { width: 100%; }
      .clock-preview { width: 100%; }

      ${actionButtonStyles}
      ${colorPickerStyles}
      .clock-color-control { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;     justify-content: space-between;}
      /* While the save form is open, it takes the full width so its fields
         are comfortable. */
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-save { flex: 1 1 100%; }
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-save yeelight-clock-preset-manager { width: 100%; }

      /* The shared gallery: selectors, previews, carousel, album, paging */
      ${collectionGalleryStyles}
      /* Shared multi-style value slider (same control as brightness) */
      ${sliderControlStyles}

      ${colorModeSelectorStyles}

    `;
