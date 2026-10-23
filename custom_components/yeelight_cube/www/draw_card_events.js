// Event handler functions for Yeelight Cube Lite Draw Card
// Each function should be exported and receive the card instance as first argument if needed

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
    card.matrixOperations.erasePixel(null, idx);
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
  // The cell under the pointer in the area's view, and the pixel it shows.
  const view = card._drawingView();
  const x = Math.floor((clientX - rect.left) / (rect.width / view.cols));
  const y = Math.floor((clientY - rect.top) / (rect.height / view.rows));
  if (x >= 0 && x < view.cols && y >= 0 && y < view.rows) {
    const idx = view.source[y * view.cols + x];
    if (card.pencilMode) {
      card._setPixel(idx);
    } else if (card.eraserMode) {
      card.matrixOperations.erasePixel(null, idx);
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
  card.matrixOperations.erasePixel(null, idx);
}

export function onMatrixMouseOver(card, idx) {
  card._onMatrixMouseOver(idx);
}

export function onMatrixMouseLeave(card) {
  card._onMatrixMouseLeave();
}
