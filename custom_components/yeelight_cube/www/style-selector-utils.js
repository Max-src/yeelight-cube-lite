import { galleryDisplayStyles } from "./gallery-display-utils.js";
import { carouselStyles } from "./carousel-utils.js";
import { paginate } from "./pagination-utils.js";
import { selectorSharedStyles } from "./selector-shared-styles.js";
// The look of the shared gallery's layouts (gallery-layouts.js).
export const styleSelectorStyles =
  selectorSharedStyles + galleryDisplayStyles + carouselStyles;
/** The gallery layout of a card config (older Original configs only set
 * effect_view). The gallery and its editor settings both read it. */
export function gallerySelectorStyle(config) {
  return (
    config?.style_selector_style ||
    (config?.effect_view ? "original" : "preview-grid")
  );
}

/** One page-size value for every selector. 0 and missing both mean no paging. */
export function selectorItemsPerPage(config) {
  const value = parseInt(config?.items_per_page, 10);
  return value > 0 ? value : 0;
}
// Items per page of a browser layout (0: the layout does not page).
export function selectorPageSize(config, style) {
  return ["original", "preview-list", "preview-grid"].includes(style)
    ? selectorItemsPerPage(config)
    : 0;
}

/** The page of `items` shown (pagination-utils.js paginate). */
export function selectorPagination(config, items, style, page = 0) {
  return paginate({
    items,
    currentPage: page,
    itemsPerPage: selectorPageSize(config, style),
  });
}
