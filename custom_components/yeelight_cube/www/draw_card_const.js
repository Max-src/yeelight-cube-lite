/**
 * Shared constants for the Yeelight Cube Lite Draw Card ecosystem.
 *
 * Centralizes grid dimensions, default orders, labels, localStorage keys
 * and color constants used across multiple files.
 */

// --- Grid / Matrix ---
export const GRID_COLS = 20;
export const GRID_ROWS = 5;
export const MATRIX_SIZE = GRID_COLS * GRID_ROWS; // 100
export const OFF_COLOR = "#000000";

// Preview constants shared with the other cards live in matrix-const.js;
// re-exported here so Draw card modules keep a single import.
export {
  BLACK_THRESHOLD,
  PREVIEW_BRIGHTNESS_FLOOR,
  PREVIEW_BRIGHTNESS_GAMMA,
  previewBrightnessScale,
} from "./matrix-const.js";

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

// The actions' names in the editor ("spacer": an empty slot, for alignment).
export const ACTION_LABELS = {
  clear: "Clear",
  upload: "Upload",
  save: "Save",
  apply: "Apply",
  spacer: "Spacer (empty slot)",
};

// --- localStorage keys ---
// Tools / actions hidden per browser by former versions: read only for
// configs without hidden_tools / hidden_actions (draw_card_tools.js).
export const LS_TOOL_VISIBILITY = "yeelight-tool-visibility";
export const LS_ACTION_VISIBILITY = "yeelight-action-visibility";

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
