// Storage utilities for Yeelight Cube Draw Card
// Centralized storage management with consistent error handling

import {
  MATRIX_SIZE,
  OFF_COLOR,
  LS_TOOL_VISIBILITY,
  LS_ACTION_VISIBILITY,
} from "./draw_card_const.js";

const STORAGE_KEYS = {
  MATRIX: "yeelight_cube_matrix",
  RECENT_COLORS: "yeelight_cube_recent_colors",
  IMAGE_PALETTE: "yeelight_cube_image_palette",
  TOOL_VISIBILITY: LS_TOOL_VISIBILITY,
  ACTION_VISIBILITY: LS_ACTION_VISIBILITY,
};

/**
 * Generic storage utility with automatic JSON handling and error recovery
 */
class StorageManager {
  static load(key, defaultValue, validator = null) {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return defaultValue;

      const parsed = JSON.parse(stored);

      // Optional validation
      if (validator && !validator(parsed)) {
        console.warn(`[Storage] Invalid data for key ${key}, using default`);
        return defaultValue;
      }

      return parsed;
    } catch (e) {
      console.warn(`[Storage] Failed to load ${key}:`, e);
      return defaultValue;
    }
  }

  static save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`[Storage] Failed to save ${key}:`, e);
      return false;
    }
  }
}

/**
 * Specific storage functions for different data types
 */
export const StorageUtils = {
  // Matrix storage (100-element array)
  loadMatrix() {
    return StorageManager.load(
      STORAGE_KEYS.MATRIX,
      Array(MATRIX_SIZE).fill(OFF_COLOR),
      (data) => Array.isArray(data) && data.length === MATRIX_SIZE,
    );
  },

  saveMatrix(matrix) {
    return StorageManager.save(STORAGE_KEYS.MATRIX, matrix);
  },

  // Recent colors storage (array of hex strings)
  loadRecentColors() {
    return StorageManager.load(STORAGE_KEYS.RECENT_COLORS, [], (data) =>
      Array.isArray(data),
    );
  },

  saveRecentColors(colors) {
    return StorageManager.save(STORAGE_KEYS.RECENT_COLORS, colors);
  },

  // Image palette storage (array of hex strings)
  loadImagePalette() {
    return StorageManager.load(STORAGE_KEYS.IMAGE_PALETTE, [], (data) =>
      Array.isArray(data),
    );
  },

  saveImagePalette(palette) {
    return StorageManager.save(STORAGE_KEYS.IMAGE_PALETTE, palette);
  },

  // Tool visibility storage (object mapping tool names to booleans)
  loadToolVisibility() {
    return StorageManager.load(STORAGE_KEYS.TOOL_VISIBILITY, {});
  },

  saveToolVisibility(visibility) {
    return StorageManager.save(STORAGE_KEYS.TOOL_VISIBILITY, visibility);
  },

  // Action visibility storage (object mapping action names to booleans)
  loadActionVisibility() {
    return StorageManager.load(STORAGE_KEYS.ACTION_VISIBILITY, {});
  },

  saveActionVisibility(visibility) {
    return StorageManager.save(STORAGE_KEYS.ACTION_VISIBILITY, visibility);
  },
};
