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
 *   show_lamp_status (the shared card header, card-shell.js).
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
  },
  gradient: {
    mode_selector_style: "style_selector_style",
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
});

function gradientPreviewSize(value) {
  const size = Number(value) || 50;
  return size > 100 ? Math.round(size / 4.5) : size;
}

/** Options a card no longer uses: dropped from its config. */
export const RETIRED_OPTIONS = Object.freeze({
  // Written by older Draw stubs/editors; nothing ever read it.
  draw: ["pixel_art_delete_button_style"],
  gradient: ["gallery_preview_size"],
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
