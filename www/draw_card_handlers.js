// Event and selection handlers for Yeelight Cube Lite Draw Card
import {
  setPixel,
  clearMatrix,
  fillAllMatrix,
  areaFillMatrix,
  previewArea,
  previewFillAll,
} from "./draw_card_matrix.js";
import { updateRecentColors } from "./draw_card_state.js";

export function handleToolSelect(card, tool) {
  card.pencilMode = tool === "pencil";
  card.eraserMode = tool === "eraser";
  card.areaFillMode = tool === "areaFill";
  card.fillAllMode = tool === "fillAll";
  card.previewFillArea = new Set();
  card.requestUpdate();
}

export function handleColorSelect(card, color) {
  card.selectedColor = color;
  card.requestUpdate();
}

export function handleMatrixClear(card) {
  card.matrix = clearMatrix();
}

export function handleMatrixFillAll(card) {
  card.matrix = fillAllMatrix(100, card.selectedColor);
}

export function handleMatrixAreaFill(card) {
  if (card.previewFillArea && card.previewFillArea.size > 0) {
    card.matrix = areaFillMatrix(
      card.matrix,
      card.previewFillArea,
      card.selectedColor
    );
    card.requestUpdate();
  }
}

export function handleMatrixPreviewArea(card, idx) {
  card.previewFillArea = previewArea(card.matrix, idx);
  card.lastHoveredIdx = idx;
  card.requestUpdate();
}

export function handleMatrixPreviewFillAll(card) {
  card.previewFillArea = previewFillAll(100);
  card.requestUpdate();
}
