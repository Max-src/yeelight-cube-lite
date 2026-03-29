// Matrix logic helpers for Yeelight Cube Draw Card
import { normalizeHex, rgbToHex } from "./draw_utils.js";
import { updateRecentColors } from "./draw_card_state.js";

export function setPixel(matrix, idx, color) {
  const newMatrix = [...matrix];
  newMatrix[idx] = color;
  return newMatrix;
}

export function clearMatrix(size = 100) {
  return Array(size).fill(null);
}

export function fillAllMatrix(size = 100, color) {
  return Array(size).fill(color);
}

export function areaFillMatrix(matrix, previewFillArea, color) {
  const newMatrix = [...matrix];
  previewFillArea.forEach((i) => {
    newMatrix[i] = color;
  });
  return newMatrix;
}

export function previewArea(matrix, idx) {
  const normTarget = matrix[idx];
  const cols = 20,
    rows = 5;
  const stack = [idx];
  const visited = new Set();
  while (stack.length) {
    const i = stack.pop();
    if (visited.has(i) || matrix[i] !== normTarget) continue;
    visited.add(i);
    const x = i % cols,
      y = Math.floor(i / cols);
    if (x > 0) stack.push(i - 1);
    if (x < cols - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - cols);
    if (y < rows - 1) stack.push(i + cols);
  }
  return visited;
}

export function previewFillAll(size = 100) {
  return new Set(Array.from({ length: size }, (_, i) => i));
}
