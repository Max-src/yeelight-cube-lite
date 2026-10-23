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
import { sliderKeys } from "./slider-control-utils.js";

export const OPTION_ALIASES = Object.freeze({
  clock: {
    // The Clock's speed slider had its own speed_* appearance options; the
    // shared slider_* ones now drive both its sliders.
    ...Object.fromEntries(
      Object.entries(sliderKeys("speed")).map(([field, key]) => [
        key,
        sliderKeys("slider")[field],
      ]),
    ),
    // The shared visible-items vocabulary (visible-items.js).
    hidden_clock_styles: "hidden_styles",
  },
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
    // The color section (palette cards): the gallery's names, colors_ prefixed.
    palette_carousel_wrap_navigation: "colors_wrap_navigation",
    // Its swatches: the shared swatches' names (swatch-settings-ui.js).
    palette_display_mode: "swatch_layout",
    expand_btn_style: "swatch_expand_style",
    blinds_direction: "swatch_blinds_direction",
    gradient_free_pick: "swatch_free_pick",
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
  // The Color List's item size: the shared Size (%).
  "color-list-editor": {
    card_size: "preview_size",
  },
  // The Lamp Preview's brightness slider: same slider_* appearance options as
  // the Clock and Native Effects sliders (sliderKeys("slider")).
  "lamp-preview": {
    card_title: "title",
    // The adjustment categories' style (section-layouts.js).
    grouped_section_style: "section_style",
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
 * (config) => the options to set (undefined: removed). Run by
 * normalizeCardOptions; the older key is dropped afterwards
 * (RETIRED_OPTIONS).
 */
export const OPTION_MIGRATIONS = Object.freeze({
  // The visible styles applied only with custom_visible_styles on.
  clock: (config) =>
    config.custom_visible_styles !== true &&
    ("visible_styles" in config || "hidden_clock_styles" in config)
      ? { visible_styles: undefined, hidden_clock_styles: undefined }
      : {},
  gradient: (config) => ({
    // The visible modes applied only with custom_visible_modes on, and an
    // empty list showed every mode.
    ...("visible_modes" in config &&
      (config.custom_visible_modes !== true ||
        !Array.isArray(config.visible_modes) ||
        !config.visible_modes.length) && { visible_modes: undefined }),
    // The gallery's Size: gallery_preview_size (50%, or pixels when above
    // 100) becomes preview_size (% of 450 px, the same scale).
    ...(config.preview_size === undefined && {
      preview_size: gradientPreviewSize(config.gallery_preview_size),
    }),
    // The mode selector never had a search box: keep it off until chosen.
    ...(config.show_search === undefined && { show_search: false }),
    ...gradientLegacyOptions(config),
  }),
  // The Draw pixel-art gallery before the shared gallery: its display
  // mode, page size (12), preview size (100%), card roundness (kept: the
  // Draw palette cards use it too), border (auto) and no search box.
  draw: (config) => ({
    // The former "Include vertical official pixel arts" switch (retired):
    // the gallery's default orientation, horizontal without it.
    ...(config.pixel_art_orientation === undefined && {
      pixel_art_orientation:
        config.pixel_art_show_vertical === true ? "all" : "horizontal",
    }),
    // The former floating colors mode showed side by side.
    ...(config.palette_card_mode === "floating" && { palette_card_mode: "side" }),
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
    // The color section's arrows in the shared shape names, and its card
    // corners (formerly rounded_cards, shared with the side-by-side mode):
    // a legacy "round" / true keeps each mode's default (unset).
    ...(config.colors_button_shape === undefined &&
      config.palette_carousel_button_shape !== undefined && {
        colors_button_shape: normalizeButtonShape(config.palette_carousel_button_shape),
      }),
    // The tool buttons' shape (button_shape) in the shared shape names.
    ...(config.tool_buttons_shape === undefined &&
      config.button_shape !== undefined && {
        tool_buttons_shape: normalizeButtonShape(config.button_shape),
      }),
    ...(config.colors_item_radius === undefined &&
      config.rounded_cards !== undefined &&
      config.rounded_cards !== true &&
      config.rounded_cards !== "round" && {
        colors_item_radius: roundedCardsRadius(config.rounded_cards),
      }),
    // The canvas size was once a word or a text number: a percentage now.
    ...(typeof config.matrix_size === "string" && {
      matrix_size:
        DRAW_MATRIX_SIZES[config.matrix_size] ?? (Number(config.matrix_size) || 100),
    }),
  }),
  // The Lamp Preview's former "tabbed" adjustments layout: the shared tabs.
  "lamp-preview": (config) => ({
    ...(config.adjustments_layout === "tabbed" && { adjustments_layout: "tabs" }),
  }),
  // The Color List's card roundness is the shared item radius (a legacy
  // "round" / true is the default 16 px: left unset).
  "color-list-editor": (config) => ({
    ...(config.item_radius === undefined &&
      config.rounded_cards !== undefined &&
      config.rounded_cards !== true &&
      config.rounded_cards !== "round" && {
        item_radius: roundedCardsRadius(config.rounded_cards),
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
    // Its swatch style is the shared swatches' layout and shape: "square"
    // swatches had rounded corners.
    ...(config.swatch_layout === undefined &&
      config.swatch_style !== undefined &&
      PALETTE_SWATCH_STYLES[config.swatch_style] && {
        swatch_layout: PALETTE_SWATCH_STYLES[config.swatch_style][0],
        ...(config.swatch_shape === undefined &&
          PALETTE_SWATCH_STYLES[config.swatch_style][1] && {
            swatch_shape: PALETTE_SWATCH_STYLES[config.swatch_style][1],
          }),
      }),
  }),
});

// The palette card's swatch_style as [swatch_layout, swatch_shape].
const PALETTE_SWATCH_STYLES = {
  square: ["row", "rounded"],
  round: ["row", "round"],
  gradient: ["gradient"],
  "gradient-bar": ["gradient"],
  "gradient-bg": ["fill"],
  stripes: ["stripes"],
};

// Draw's former preview size (50-100%, 100 by default) as the shared Size:
// the same in every layout but the album, whose cards were 240 px at 100%
// (the shared album's 55%).
function drawPreviewSize(config) {
  const size = Number(config.pixel_art_preview_size) || 100;
  return config.pixel_art_gallery_mode === "album"
    ? Math.max(30, Math.round(size * 0.55))
    : size;
}

const DRAW_MATRIX_SIZES = { small: 70, medium: 85 };

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

// The Gradient angle styles merged into wheel / compass / rectangle: the
// style they became, and the shape option they set (when not chosen; the
// former square ignored rectangle_shape, so it always sets it).
const GRADIENT_ROTARY_STYLES = {
  arrow_window: ["wheel", "wheel_show_mask", true],
  beam: ["compass", "compass_shape", "beam"],
  arrow: ["compass", "compass_shape", "arrow"],
  star: ["compass", "compass_shape", "star"],
  turning_rectangle: ["compass", "compass_shape", "rectangle"],
  square: ["rectangle", "rectangle_shape", "square"],
};
// The mode selector's former layouts: preview_display_mode (the previews
// were always shown) and the text styles merged into "filled".
const GRADIENT_PREVIEW_LAYOUTS = {
  inline: "preview-list",
  grid: "preview-list",
  gallery: "preview-list",
  list: "preview-list",
  compact: "preview-list",
  wheel: "preview-wheel",
};
const GRADIENT_SELECTOR_STYLES = {
  buttons: "filled",
  pills: "filled",
  compact: "filled",
  colorized: "filled",
  "preview-row": "preview-list",
};

/** The Gradient options older versions saved, in today's names. */
function gradientLegacyOptions(config) {
  const options = {};
  // The oldest format (no rotary_unified_style): angle_rotary_style wheel,
  // rect, or "default" (a gradient shape turning in a dial, also shown
  // without any style) that became the compass with that shape.
  let unified = config.rotary_unified_style;
  if (!unified) {
    const old = config.angle_rotary_style;
    unified = old === "wheel" ? "wheel" : old === "rect" ? "rectangle" : "compass";
    options.rotary_unified_style = unified;
    if (unified === "compass" && !config.compass_shape)
      options.compass_shape =
        { arrow_classic: "arrow", star: "star" }[config.default_shape] || "rectangle";
  }
  // Each style had its own size before rotary_size.
  if (config.rotary_size === undefined || config.rotary_size === "") {
    const size = { wheel: config.wheel_size, rectangle: config.rect_size }[unified]
      ?? (unified === "wheel" || unified === "rectangle" ? undefined : config.default_size);
    if (size != null && size !== "") options.rotary_size = size;
  }
  const rotary = GRADIENT_ROTARY_STYLES[config.rotary_unified_style];
  if (rotary) {
    const [style, key, value] = rotary;
    options.rotary_unified_style = style;
    if (config[key] === undefined || config[key] === "" || key === "rectangle_shape")
      options[key] = value;
  }
  if (!config.compass_labels_mode && config.compass_show_labels !== undefined)
    options.compass_labels_mode = config.compass_show_labels ? "under" : "none";
  const style = config.style_selector_style;
  if (GRADIENT_SELECTOR_STYLES[style])
    options.style_selector_style = GRADIENT_SELECTOR_STYLES[style];
  else if (!style && GRADIENT_PREVIEW_LAYOUTS[config.preview_display_mode])
    options.style_selector_style =
      GRADIENT_PREVIEW_LAYOUTS[config.preview_display_mode];
  // The panel toggle lived in the former text selector: hidden with it.
  if (
    config.show_color_mode_selector === false &&
    config.show_panel_toggle === undefined
  )
    options.show_panel_toggle = false;
  const toggle = { default: "minimal", segmented: "tabs" }[
    config.panel_toggle_style
  ];
  if (toggle) options.panel_toggle_style = toggle;
  return options;
}

function gradientPreviewSize(value) {
  const size = Number(value) || 50;
  return size > 100 ? Math.round(size / 4.5) : size;
}

/** Options a card no longer uses: dropped from its config. */
export const RETIRED_OPTIONS = Object.freeze({
  // Written by older Draw stubs/editors; nothing ever read it.
  draw: [
    // Became pixel_art_orientation (OPTION_MIGRATIONS).
    "pixel_art_show_vertical",
    "pixel_art_delete_button_style",
    "pixel_art_gallery_mode",
    "pixel_art_items_per_page",
    "pixel_art_preview_size",
    "carousel_button_shape",
    "compact_show_preview",
    "palette_carousel_button_shape",
    "rounded_cards",
    "button_shape",
    // Never read.
    "paint_button_shape",
    "pixelart_buttons_content_mode",
    // The on-card visibility modes: tools / actions are shown and ordered
    // in the editor now (hidden_tools / hidden_actions).
    "edit_drawing_tools",
    "allow_visual_tool_reordering",
    "edit_action_buttons",
  ],
  // Never read.
  "lamp-preview": [
    "size",
    "brightness_label_mode",
    "brightness_max",
    "show_brightness_label",
  ],
  clock: ["custom_visible_styles"],
  gradient: [
    "gallery_preview_size",
    "custom_visible_modes",
    // In today's names (gradientLegacyOptions), or never read.
    "compass_show_labels",
    "show_color_mode_selector",
    "color_mode_style",
    "preview_display_mode",
    "button_text_color",
    "angle_rotary_style",
    "default_shape",
    "wheel_size",
    "rect_size",
    "default_size",
  ],
  "color-list-editor": ["rounded_cards"],
  palette: [
    "display_mode",
    "rounded_cards",
    "palette_carousel_button_shape",
    "card_size",
    // Swatch size of the former gallery mode: swatches follow Size now.
    "swatch_size",
    "swatch_style",
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
  for (const [key, value] of Object.entries(migrated))
    if (value === undefined) delete result[key];
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
