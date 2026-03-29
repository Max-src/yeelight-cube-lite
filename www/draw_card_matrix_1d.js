// Matrix Operations Module for Yeelight Cube Draw Card (1D Array with Hex Colors)
import {
  normalizeHex,
  createEmptyMatrix as _createEmptyMatrix,
} from "./draw_utils.js";
import { MATRIX_SIZE } from "./draw_card_const.js";
import { updateRecentColors } from "./draw_card_state.js";

export class MatrixOperations1D {
  constructor(card) {
    this.card = card;
  }

  // Push matrix state to history for undo functionality
  pushMatrixHistory() {
    if (!this.card.matrix) return;

    if (!this.card._matrixHistory) {
      this.card._matrixHistory = [];
    }

    this.card._matrixHistory.push([...this.card.matrix]);

    // Limit history size to prevent memory issues
    if (this.card._matrixHistory.length > 20) {
      this.card._matrixHistory.shift();
    }
  }

  // Undo last matrix change
  undoMatrix() {
    if (!this.card._matrixHistory || this.card._matrixHistory.length === 0) {
      return;
    }

    const previousMatrix = this.card._matrixHistory.pop();
    if (previousMatrix) {
      this.card.matrix = previousMatrix;
      // Save to storage if available
      if (typeof StorageUtils !== "undefined" && StorageUtils.saveMatrix) {
        StorageUtils.saveMatrix(this.card.matrix);
      }
      this.card.requestUpdate();
    }
  }

  // Set pixel at index
  setPixel(idx) {
    if (!this.card.matrix || idx < 0 || idx >= this.card.matrix.length) return;

    this.card.matrix = [
      ...this.card.matrix.slice(0, idx),
      this.card.selectedColor,
      ...this.card.matrix.slice(idx + 1),
    ];

    // Save to storage if available
    if (typeof StorageUtils !== "undefined" && StorageUtils.saveMatrix) {
      StorageUtils.saveMatrix(this.card.matrix);
    }

    // Update recent colors
    this.updateRecentColors();

    // Batch updates during drawing to improve performance
    if (this.card._drawingActive) {
      // Clear any pending update
      if (this.card._pendingDrawUpdate) {
        cancelAnimationFrame(this.card._pendingDrawUpdate);
      }
      // Schedule update on next animation frame (batches multiple pixel changes)
      this.card._pendingDrawUpdate = requestAnimationFrame(() => {
        this.card.requestUpdate();
        this.card._pendingDrawUpdate = null;
      });
    } else {
      // Immediate update for single clicks
      this.card.requestUpdate();
    }
  }

  // Erase pixel (set to black)
  erasePixel(e, idx) {
    if (e) e.preventDefault();
    if (!this.card.matrix || idx < 0 || idx >= this.card.matrix.length) return;

    this.card.matrix = [
      ...this.card.matrix.slice(0, idx),
      "#000000",
      ...this.card.matrix.slice(idx + 1),
    ];

    // Save to storage if available
    if (typeof StorageUtils !== "undefined" && StorageUtils.saveMatrix) {
      StorageUtils.saveMatrix(this.card.matrix);
    }

    // Batch updates during drawing to improve performance
    if (this.card._drawingActive) {
      if (this.card._pendingDrawUpdate) {
        cancelAnimationFrame(this.card._pendingDrawUpdate);
      }
      this.card._pendingDrawUpdate = requestAnimationFrame(() => {
        this.card.requestUpdate();
        this.card._pendingDrawUpdate = null;
      });
    } else {
      this.card.requestUpdate();
    }
  }

  // Clear entire matrix
  clearMatrix() {
    this.pushMatrixHistory();
    this.card.matrix = _createEmptyMatrix();

    // Save to storage if available
    if (typeof StorageUtils !== "undefined" && StorageUtils.saveMatrix) {
      StorageUtils.saveMatrix(this.card.matrix);
    }

    this.card.requestUpdate();
  }

  // Fill all pixels with selected color
  fillAll() {
    if (this.card.selectedColor) {
      this.pushMatrixHistory();
      this.card.matrix = Array(MATRIX_SIZE).fill(this.card.selectedColor);

      // Save to storage if available
      if (typeof StorageUtils !== "undefined" && StorageUtils.saveMatrix) {
        StorageUtils.saveMatrix(this.card.matrix);
      }
    }
  }

  // Toggle fill all mode
  toggleFillAll() {
    this.card.fillAllMode = !this.card.fillAllMode;
    this.card.areaFillMode = false;
    this.card.eraserMode = false;
    this.card.previewFillArea = new Set();
    this.card.requestUpdate();
  }

  // Handle matrix mouse over for area fill and fill all previews
  onMatrixMouseOver(idx) {
    if (this.card.fillAllMode) {
      this.card.previewFillArea = new Set(
        Array.from({ length: this.card.matrix.length }, (_, i) => i),
      );
      this.card.lastHoveredIdx = idx;
      this.card.requestUpdate();
    } else if (this.card.areaFillMode) {
      this.card.lastHoveredIdx = idx;
      const normTarget = this.card.matrix[idx];
      const cols = 20,
        rows = 5;
      const stack = [idx];
      const visited = new Set();

      while (stack.length) {
        const i = stack.pop();
        if (visited.has(i) || this.card.matrix[i] !== normTarget) continue;
        visited.add(i);
        const x = i % cols,
          y = Math.floor(i / cols);
        if (x > 0) stack.push(i - 1);
        if (x < cols - 1) stack.push(i + 1);
        if (y > 0) stack.push(i - cols);
        if (y < rows - 1) stack.push(i + cols);
      }

      this.card.previewFillArea = visited;
      this.card.requestUpdate();
    } else {
      this.card.previewFillArea = new Set();
      this.card.lastHoveredIdx = null;
      this.card.requestUpdate();
    }
  }

  // Handle matrix mouse leave
  onMatrixMouseLeave() {
    this.card.previewFillArea = new Set();
    this.card.lastHoveredIdx = null;
    this.card.requestUpdate();
  }

  // Handle matrix click
  onMatrixClick(idx) {
    if (this.card.colorPickerMode) {
      const pickedColor = this.card.matrix[idx] || "#000000";
      this.card.selectedColor = pickedColor;
      // Keep eyedropper selected until another tool is chosen
      this.card.requestUpdate();
      return;
    }

    if (this.card.fillAllMode) {
      this.pushMatrixHistory();
      this.card.matrix = Array(this.card.matrix.length).fill(
        normalizeHex(this.card.selectedColor),
      );
      // Save to storage if available
      if (typeof StorageUtils !== "undefined" && StorageUtils.saveMatrix) {
        StorageUtils.saveMatrix(this.card.matrix);
      }
      this.card.previewFillArea = new Set();
      this.card.requestUpdate();
      return;
    }

    if (this.card.areaFillMode) {
      if (this.card.previewFillArea && this.card.previewFillArea.size > 0) {
        this.pushMatrixHistory();
        const newMatrix = this.card.matrix.slice();
        this.card.previewFillArea.forEach((i) => {
          newMatrix[i] = normalizeHex(this.card.selectedColor);
        });
        this.card.matrix = newMatrix;
        // Save to storage if available
        if (typeof StorageUtils !== "undefined" && StorageUtils.saveMatrix) {
          StorageUtils.saveMatrix(this.card.matrix);
        }
        this.card.previewFillArea = new Set();
        this.card.requestUpdate();
      }
      return;
    }

    if (this.card.eraserMode) {
      // Eraser is handled in drawPixel, so do nothing here
      return;
    }

    this.setPixel(idx);
  }

  // Update recent colors when setting pixels
  updateRecentColors() {
    const colorLower = this.card.selectedColor.toLowerCase();
    const inRecent = this.card.recentColors.some(
      (c) => c.toLowerCase() === colorLower,
    );
    const inImage = this.card.imagePalette.some(
      (c) => c.toLowerCase() === colorLower,
    );
    const inLamp = this.card.lampPalette.some(
      (c) => c.toLowerCase() === colorLower,
    );

    if (
      typeof updateRecentColors === "function" &&
      !inRecent &&
      !inImage &&
      !inLamp
    ) {
      this.card.recentColors = updateRecentColors(
        this.card.recentColors,
        this.card.selectedColor,
      );
      // Save to storage if available
      if (
        typeof StorageUtils !== "undefined" &&
        StorageUtils.saveRecentColors
      ) {
        StorageUtils.saveRecentColors(this.card.recentColors);
      }
    }
  }

  // Get color count in matrix
  getColorCount() {
    if (!this.card.matrix) return 0;
    const uniqueColors = new Set(this.card.matrix);
    return uniqueColors.size;
  }

  // Check if matrix is valid
  isValidMatrix(matrix) {
    return Array.isArray(matrix) && matrix.length === MATRIX_SIZE;
  }

  // Initialize empty matrix
  createEmptyMatrix() {
    return _createEmptyMatrix();
  }

  // Get pixel color at index
  getPixelColor(idx) {
    if (!this.card.matrix || idx < 0 || idx >= this.card.matrix.length) {
      return "#000000";
    }
    return this.card.matrix[idx];
  }

  // Set pixel color at index without triggering updates (for bulk operations)
  setPixelQuiet(idx, color) {
    if (!this.card.matrix || idx < 0 || idx >= this.card.matrix.length) return;
    this.card.matrix[idx] = color;
  }

  // Convert matrix to different formats for export/import
  toRGBMatrix() {
    if (!this.card.matrix) return [];
    return this.card.matrix.map((hexColor) => {
      const rgb = this.hexToRgb(hexColor);
      return rgb ? [rgb.r, rgb.g, rgb.b] : [0, 0, 0];
    });
  }

  // Convert hex to RGB
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  }

  // Convert RGB to hex
  rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
}
