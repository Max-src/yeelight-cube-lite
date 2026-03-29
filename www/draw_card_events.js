// Event handler functions for Yeelight Cube Draw Card
// Each function should be exported and receive the card instance as first argument if needed

import { StorageUtils } from "./draw_card_storage.js";
import { GRID_COLS, GRID_ROWS } from "./draw_card_const.js";

export function drawPixel(card, e, idx) {
  e.preventDefault();
  if (card.pencilMode) {
    card.isDrawing = true;
    // For single pixel click (not drag), push history here
    if (!card._drawingActive) card._pushMatrixHistory();
    card._setPixel(idx);
  } else if (card.eraserMode) {
    card.isDrawing = true;
    if (!card._drawingActive) card._pushMatrixHistory();
    card.matrix = [
      ...card.matrix.slice(0, idx),
      "#000000",
      ...card.matrix.slice(idx + 1),
    ];
    StorageUtils.saveMatrix(card.matrix);
    // requestUpdate now handled in matrixOperations.erasePixel
  }
}

export function startDraw(card, e) {
  card.isDrawing = true;
  // Only push history at the start of a drag session
  if (!card._drawingActive) card._pushMatrixHistory();
  card._drawingActive = true;
}

export function endDraw(card, e) {
  card.isDrawing = false;
  card._drawingActive = false;
}

export function drawMove(card, e) {
  if (!card._drawingActive) return;
  let clientX, clientY;
  if (e.touches && e.touches.length) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  const container = card.shadowRoot.querySelector(".matrix");
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left) / (rect.width / GRID_COLS));
  const y = Math.floor((clientY - rect.top) / (rect.height / GRID_ROWS));
  if (x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS) {
    const idx = y * GRID_COLS + x;
    if (card.pencilMode) {
      card._setPixel(idx);
    } else if (card.eraserMode) {
      card.matrix = [
        ...card.matrix.slice(0, idx),
        "#000000",
        ...card.matrix.slice(idx + 1),
      ];
      StorageUtils.saveMatrix(card.matrix);
      // requestUpdate now batched in matrix operations
    }
  }
}

export function onMatrixClick(card, idx) {
  // ...existing logic, call card._onMatrixClick(idx) or refactor logic here...
  card._onMatrixClick(idx);
}

export function erasePixel(card, e, idx) {
  e.preventDefault();
  // For single pixel erase (not drag), push history here
  if (!card._drawingActive) card._pushMatrixHistory();
  card.matrix = [
    ...card.matrix.slice(0, idx),
    "#000000",
    ...card.matrix.slice(idx + 1),
  ];
  StorageUtils.saveMatrix(card.matrix);
  // requestUpdate now handled in matrix operations
}

export function onMatrixMouseOver(card, idx) {
  card._onMatrixMouseOver(idx);
}

export function onMatrixMouseLeave(card) {
  card._onMatrixMouseLeave();
}
