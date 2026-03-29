/**
 * Shared constants for the Yeelight Cube Draw Card ecosystem.
 *
 * Centralizes grid dimensions, default orders, localStorage keys,
 * event names, and color constants used across multiple files.
 */

// --- Grid / Matrix ---
export const GRID_COLS = 20;
export const GRID_ROWS = 5;
export const MATRIX_SIZE = GRID_COLS * GRID_ROWS; // 100
export const OFF_COLOR = "#000000";

// --- Black pixel detection threshold ---
// RGB components all <= this value are considered "black/off"
export const BLACK_THRESHOLD = 10;

// --- Preview brightness boost constants ---
// On LCD screens, low-brightness LED colors appear too dim.
// The perceptual boost makes preview pixels brighter to compensate.
//
// Formula:
//   effective = FLOOR + (1 - FLOOR) * (brightness/255)^GAMMA
//   boost     = effective / darkenFactor
//
// where FLOOR = PREVIEW_MIN_BRIGHTNESS_BOOST * (1 - PREVIEW_MAX_DARKEN_PERCENT/100).
//
// PREVIEW_MIN_BRIGHTNESS_BOOST  – boost multiplier at 0% brightness.
//   Higher = brighter previews at very low brightness.  Default 8.0.
//
// PREVIEW_MAX_DARKEN_PERCENT    – must match Python MAX_DARKEN_PERCENT.
//
// PREVIEW_BRIGHTNESS_GAMMA      – curve shape of the brightness-to-effective
//   mapping.  Controls how quickly the preview dims as lamp brightness drops.
//     < 1.0 : more boost at mid-brightness (looks brighter overall)
//     = 1.0 : linear
//     > 1.0 : less boost at mid-brightness (dims more naturally)
//   Default 1.35 gives a smooth perceptual curve that never overshoots or dips.
export const PREVIEW_MIN_BRIGHTNESS_BOOST = 8.0;
export const PREVIEW_MAX_DARKEN_PERCENT = 94;
export const PREVIEW_BRIGHTNESS_GAMMA = 1.35;

// --- Recent colors ---
export const MAX_RECENT_COLORS = 10;

// --- Default tool & action orders ---
export const DEFAULT_TOOL_ORDER = [
  "colorPicker",
  "eyedropper",
  "pencil",
  "eraser",
  "areaFill",
  "fillAll",
  "undo",
];

export const DEFAULT_ACTION_ORDER = ["clear", "upload", "save", "apply"];

// --- localStorage keys ---
export const LS_TOOL_VISIBILITY = "yeelight-tool-visibility";
export const LS_ACTION_VISIBILITY = "yeelight-action-visibility";
export const LS_ACTION_ORDER = "yeelight-action-order";

// --- Custom event names ---
export const EVT_TOOL_VISIBILITY_RESET = "yeelight-tool-visibility-reset";
export const EVT_ACTION_ORDER_RESET = "yeelight-action-order-reset";
export const EVT_ACTION_VISIBILITY_RESET = "yeelight-action-visibility-reset";

// --- Gallery / Pixel Art ---
export const MAX_PIXEL_ARTS = 50;
export const DEFAULT_ITEMS_PER_PAGE = 5;

// --- Tool config map (icon, label, title) ---
export const TOOL_CONFIG = {
  colorPicker: {
    icon: "mdi:palette",
    label: "Color",
    title: "Pick Color",
  },
  pencil: {
    icon: "mdi:pencil",
    label: "Pencil",
    title: "Pencil (draw pixels)",
  },
  eyedropper: {
    icon: "mdi:eyedropper",
    label: "Pick",
    title: "Eyedropper (pick color from pixel)",
  },
  eraser: {
    icon: "mdi:eraser",
    label: "Eraser",
    title: "Eraser",
  },
  areaFill: {
    icon: "mdi:format-color-fill",
    label: "Fill",
    title: "Area Fill (flood fill)",
  },
  fillAll: {
    icon: "mdi:overscan",
    label: "All",
    title: "Fill All (set all pixels)",
  },
  undo: {
    icon: "mdi:undo",
    label: "Undo",
    title: "Undo",
  },
};
