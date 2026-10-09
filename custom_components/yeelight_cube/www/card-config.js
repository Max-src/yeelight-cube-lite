/**
 * One option vocabulary for every card: the same feature has the same option
 * name on every card that offers it, so cards can later be combined without
 * translating their settings.
 *
 * Shared names (already used by every card that has the feature):
 *   show_card_background, title, entity / target_entities, buttons_style,
 *   buttons_content_mode, action_buttons (see lampActionConfig), orientation_*,
 *   remove_button_style / delete_button_*, preview_appearance /
 *   preview_overrides / appearance_presets (preview-appearance.js),
 *   show_gallery, style_selector_style, preview_show_titles,
 *   show_brightness and the slider_* appearance of the lamp sliders,
 *   show_lamp_status (the shared card header, card-shell.js),
 *   item_labels (display names of a gallery's items, see itemLabel).
 *
 * A card's older names are aliases: normalizeCardOptions() moves them to the
 * shared name (an explicitly set shared name wins), so existing dashboards keep
 * working, and an editor saves only shared names. Cards and their editors call
 * it first in setConfig(). An older option whose values also changed has a
 * migration (OPTION_MIGRATIONS) instead.
 */

export const OPTION_ALIASES = Object.freeze({
  draw: {
    show_pixelart_gallery: "show_gallery",
    pixel_art_show_titles: "preview_show_titles",
    pixel_art_remove_button_style: "remove_button_style",
    // The pixel-art gallery, before the shared gallery: its appearance is
    // the gallery_* appearance (the "Pixel Art" section of the editor).
    pixel_art_background_color: "gallery_background_color",
    pixel_art_pixel_style: "gallery_pixel_style",
    pixel_art_spacing_mode: "gallery_spacing_mode",
    pixel_art_matrix_box_shadow: "gallery_matrix_box_shadow",
    pixel_art_allow_rename: "allow_rename",
    carousel_wrap_navigation: "gallery_wrap_navigation",
    // The colour section (palette cards): the gallery's names, colors_ prefixed.
    palette_carousel_wrap_navigation: "colors_wrap_navigation",
  },
  gradient: {
    mode_selector_style: "style_selector_style",
  },
  // The palette card's own gallery settings, before the shared gallery.
  palette: {
    show_palette_title: "preview_show_titles",
    allow_title_edit: "allow_rename",
    palette_carousel_wrap_navigation: "gallery_wrap_navigation",
  },
  // The Lamp Preview's brightness slider: same slider_* appearance options as
  // the Clock and Native Effects sliders (sliderKeys("slider")).
  "lamp-preview": {
    card_title: "title",
    reconnect_button_style: "buttons_style",
    show_brightness_slider: "show_brightness",
    brightness_slider_style: "slider_style",
    brightness_slider_width: "slider_width",
    brightness_theme: "slider_theme",
    brightness_slider_thickness: "slider_thickness",
    brightness_matrix_color: "slider_color",
    show_brightness_percentage: "slider_show_value",
    brightness_slider_variant: "slider_variant",
    brightness_bar_fill: "slider_bar_fill",
    brightness_wheel_step: "slider_wheel_step",
    brightness_wheel_style: "slider_wheel_style",
    brightness_wheel_labels: "slider_wheel_labels",
    brightness_matrix_cols: "slider_matrix_cols",
    brightness_matrix_rows: "slider_matrix_rows",
    brightness_matrix_direction: "slider_matrix_dir",
    brightness_matrix_pixel_style: "slider_matrix_pixel_style",
    brightness_rotary_style: "slider_rotary_style",
    brightness_step_buttons: "slider_step_buttons",
    brightness_step_size: "slider_step_size",
    brightness_step_position: "slider_step_position",
    brightness_value_display: "slider_value_display",
    brightness_value_side: "slider_value_side",
    brightness_snap_to_positions: "slider_snap",
    brightness_capsule_variant: "slider_capsule_variant",
    show_capsule_moon_icon: "slider_show_icon_left",
    show_capsule_sun_icon: "slider_show_icon_right",
  },
});

/**
 * Older options whose values changed when they joined the shared vocabulary:
 * (config) => the options to set. Run by normalizeCardOptions; the older key
 * is dropped afterwards (RETIRED_OPTIONS).
 */
export const OPTION_MIGRATIONS = Object.freeze({
  gradient: (config) => ({
    // The gallery's Size: gallery_preview_size (50%, or pixels when above
    // 100) becomes preview_size (% of 450 px, the same scale).
    ...(config.preview_size === undefined && {
      preview_size: gradientPreviewSize(config.gallery_preview_size),
    }),
    // The mode selector never had a search box: keep it off until chosen.
    ...(config.show_search === undefined && { show_search: false }),
  }),
  // The Draw pixel-art gallery before the shared gallery: its display
  // mode, page size (12), preview size (100%), card roundness (kept: the
  // Draw palette cards use it too), border (auto) and no search box.
  draw: (config) => ({
    ...(config.style_selector_style === undefined && {
      style_selector_style:
        DRAW_LAYOUTS[config.pixel_art_gallery_mode] || "preview-grid",
    }),
    ...(config.items_per_page === undefined && {
      items_per_page: Number(config.pixel_art_items_per_page) || 12,
    }),
    ...(config.preview_size === undefined && {
      preview_size: drawPreviewSize(config),
    }),
    ...(config.selector_shape === undefined && {
      selector_shape: "custom",
      item_radius: config.item_radius ?? roundedCardsRadius(config.rounded_cards),
    }),
    ...(config.selector_button_shape === undefined &&
      config.carousel_button_shape !== undefined && {
        selector_button_shape:
          { square: "square", rect: "rounded", rounded: "rounded" }[
            config.carousel_button_shape
          ] || "round",
      }),
    ...(config.item_card_border === undefined && { item_card_border: "auto" }),
    ...(config.show_search === undefined && { show_search: false }),
    // The colour section's arrows in the shared shape names, and its card
    // corners (formerly rounded_cards, shared with the side-by-side mode):
    // a legacy "round" / true keeps each mode's default (unset).
    ...(config.colors_button_shape === undefined &&
      config.palette_carousel_button_shape !== undefined && {
        colors_button_shape: normalizeButtonShape(config.palette_carousel_button_shape),
      }),
    ...(config.colors_item_radius === undefined &&
      config.rounded_cards !== undefined &&
      config.rounded_cards !== true &&
      config.rounded_cards !== "round" && {
        colors_item_radius: roundedCardsRadius(config.rounded_cards),
      }),
  }),
  // The palette card's look before the shared gallery: its display mode,
  // its card roundness (16 px by default), items on the card's own
  // background with a border, no search box.
  palette: (config) => ({
    ...(config.style_selector_style === undefined && {
      style_selector_style:
        PALETTE_LAYOUTS[config.display_mode] || "preview-list",
    }),
    // Display Card Size (50% by default) is the gallery's Size.
    ...(config.preview_size === undefined && {
      preview_size: Number(config.card_size) || 50,
    }),
    ...(config.selector_shape === undefined && {
      selector_shape: "custom",
      item_radius: config.item_radius ?? roundedCardsRadius(config.rounded_cards),
    }),
    ...(config.selector_button_shape === undefined &&
      config.palette_carousel_button_shape !== undefined && {
        selector_button_shape:
          { square: "square", rect: "rounded", rounded: "rounded" }[
            config.palette_carousel_button_shape
          ] || "round",
      }),
    ...(config.gallery_background_color === undefined && {
      gallery_background_color: "transparent",
    }),
    ...(config.item_card_border === undefined && { item_card_border: "always" }),
    ...(config.show_search === undefined && { show_search: false }),
  }),
});

// Draw's former preview size (50-100%, 100 by default) as the shared Size:
// the same in every layout but the album, whose cards were 240 px at 100%
// (the shared album's 55%).
function drawPreviewSize(config) {
  const size = Number(config.pixel_art_preview_size) || 100;
  return config.pixel_art_gallery_mode === "album"
    ? Math.max(30, Math.round(size * 0.55))
    : size;
}

const DRAW_LAYOUTS = {
  gallery: "preview-grid",
  list: "preview-list",
  carousel: "preview-carousel",
  album: "preview-album",
  // The former compact list (with drag reordering, now Arrange).
  compact: "preview-strip",
};

const PALETTE_LAYOUTS = {
  list: "preview-list",
  gallery: "preview-grid",
  carousel: "preview-carousel",
  album: "preview-album",
  timeline: "preview-album",
};

/**
 * A button shape in the shared vocabulary: square, rounded or round
 * (legacy: circle -> round, rect -> rounded; anything else -> rounded).
 * The carousels (carousel-utils.js) and the option migrations use it.
 */
export function normalizeButtonShape(shape) {
  if (shape === "circle") return "round";
  if (shape === "rect") return "rounded";
  return ["round", "rounded", "square"].includes(shape) ? shape : "rounded";
}

/** The px radius of a rounded_cards value ("Card Roundness" of the Draw,
 * Color List and former Palette cards; legacy true/false/"round"/"rounded"/
 * "square" values included). */
export function roundedCardsRadius(value) {
  if (value === undefined || value === true || value === "round") return 16;
  if (value === false || value === "square") return 0;
  if (value === "rounded") return 4;
  return typeof value === "number" ? value : parseInt(value, 10) || 16;
}

function gradientPreviewSize(value) {
  const size = Number(value) || 50;
  return size > 100 ? Math.round(size / 4.5) : size;
}

/** Options a card no longer uses: dropped from its config. */
export const RETIRED_OPTIONS = Object.freeze({
  // Written by older Draw stubs/editors; nothing ever read it.
  draw: [
    "pixel_art_delete_button_style",
    "pixel_art_gallery_mode",
    "pixel_art_items_per_page",
    "pixel_art_preview_size",
    "carousel_button_shape",
    "compact_show_preview",
    "palette_carousel_button_shape",
    "rounded_cards",
  ],
  gradient: ["gallery_preview_size"],
  palette: [
    "display_mode",
    "rounded_cards",
    "palette_carousel_button_shape",
    "card_size",
    // Swatch size of the former gallery mode: swatches follow Size now.
    "swatch_size",
  ],
});

export function normalizeCardOptions(config, card) {
  if (!config || typeof config !== "object") return config;
  const aliases = OPTION_ALIASES[card] || {};
  const retired = RETIRED_OPTIONS[card] || [];
  const migrated = OPTION_MIGRATIONS[card]?.(config) || {};
  if (
    !Object.keys(migrated).length &&
    !retired.some((key) => key in config) &&
    !Object.keys(aliases).some((key) => key in config)
  )
    return config;
  const result = { ...config, ...migrated };
  for (const [legacy, name] of Object.entries(aliases)) {
    if (!(legacy in result)) continue;
    if (result[name] === undefined) result[name] = result[legacy];
    delete result[legacy];
  }
  for (const key of retired) delete result[key];
  return result;
}

/**
 * The name a card shows for an item: the card's own label for it
 * (`item_labels: {key: "My name"}`), else its built-in name. A label only
 * changes what this card displays: the item keeps its key, so favourites,
 * rotations and the lamp commands are unaffected.
 */
export function itemLabel(config, key, name) {
  const label = config?.item_labels?.[key];
  return typeof label === "string" && label.trim() ? label.trim() : name;
}

/**
 * The order a gallery shows its items in (gallery_sort): the card's own
 * order (default), or "name": A → Z by the name shown (`nameOf(item)`: its
 * label on this card), numbers in order ("Art 2" before "Art 10"). Used by
 * the gallery and by the Previous / Next buttons, which step through the
 * items in the order shown. Keys are unchanged (favourites, rotations).
 */
export function sortGalleryItems(config, items, nameOf) {
  if (config?.gallery_sort !== "name") return items;
  return [...items].sort((first, second) =>
    String(nameOf(first) ?? "").localeCompare(String(nameOf(second) ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

/** Whether an item matches a gallery search: its label on this card or its
 * built-in name contains `query` (case-insensitive; empty matches all). */
export function itemMatchesQuery(config, key, name, query) {
  const text = (query || "").trim().toLowerCase();
  if (!text) return true;
  return [name, itemLabel(config, key, name)].some((value) =>
    String(value).toLowerCase().includes(text),
  );
}

/** `config` with the label of `key` set (an empty label removes it). */
export function withItemLabel(config, key, label) {
  const labels = { ...(config?.item_labels || {}) };
  const text = typeof label === "string" ? label.trim() : "";
  if (text) labels[key] = text;
  else delete labels[key];
  const result = { ...config, item_labels: labels };
  if (!Object.keys(labels).length) delete result.item_labels;
  return result;
}
