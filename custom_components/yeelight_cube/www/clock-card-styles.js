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
      /* Saved colors + the trailing picker share one button group; the save
         buttons sit next to them when there's room and wrap below otherwise. */
      .clock-color-presets { flex: 0 1 auto; min-width: 0; }
      .clock-color-choices { flex-wrap: wrap; }
      /* Filled style: fixed square chips so empty (name-less) colors match the
         add/replace button beside them. max-width overrides the shared group's
         fit-content cap, which would otherwise collapse the empty chips. */
      .clock-color-choices.cc-filled .shared-action-button {
        flex: 0 0 auto; width: 44px; max-width: 44px; height: 44px; min-height: 0; padding: 0;
      }
      /* Swatch-only style: fixed-size color chips whose shape is configurable. */
      .clock-color-choices.cc-swatch .shared-action-button {
        flex: 0 0 44px; width: 44px; max-width: 44px; height: 44px; min-height: 0; padding: 0;
        overflow: visible; border-radius: 12px;
      }
      .clock-color-choices.cc-swatch.cc-shape-square .shared-action-button { border-radius: 4px; }
      .clock-color-choices.cc-swatch.cc-shape-circle .shared-action-button { border-radius: 50%; }
      /* The picker's dashed "add" border only suits the outline button style. */
      .clock-color-choices button[data-value="__pick__"].btn-style-outline {
        border-style: dashed;
      }
      /* Saving is a distinct action, so the save buttons take a different hue
         and sit together on their own row. */
      /* While the save form is open, hide the choice row and give the form the
         full width so its fields are comfortable. */
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-presets { display: none; }
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-save { flex: 1 1 100%; }
      .clock-color-control:has(yeelight-clock-preset-manager[editing]) .clock-color-save yeelight-clock-preset-manager { width: 100%; }

      /* The shared gallery: selectors, previews, carousel, album, paging */
      ${collectionGalleryStyles}
      /* Shared multi-style value slider (same control as brightness) */
      ${sliderControlStyles}

      ${colorModeSelectorStyles}

    `;
