// UI rendering helpers for Yeelight Cube Lite Draw Card
import { html } from "./lib/lit-all.js";
import { isBlackPixel } from "./draw_utils.js";

export function renderColorSwatch(color, onClick) {
  return html`<div
    class="color-swatch"
    style="background:${color}"
    @click="${onClick}"
  ></div>`;
}

export function renderPaletteList(palette, onClick) {
  return html`${palette.map((color) =>
    renderColorSwatch(color, () => onClick(color)),
  )}`;
}

export function renderMatrixPixel(
  idx,
  color,
  pixelStyle,
  previewStyle,
  handlers,
  ignoreBlackPixels = false,
) {
  // Check if pixel is black and should be ignored
  let displayColor = color || "#000000";
  if (ignoreBlackPixels && isBlackPixel(displayColor)) {
    displayColor = "transparent";
  }

  const styleClass =
    pixelStyle === "circle"
      ? "round"
      : pixelStyle === "rounded"
        ? "rounded"
        : "square";

  return html`
    <div
      class="pixel ${styleClass} ${color ? "active" : ""}"
      style="background:${displayColor};${previewStyle}"
      @mousedown=${handlers.onMouseDown}
      @contextmenu=${handlers.onContextMenu}
      @click=${handlers.onClick}
      @mouseover=${handlers.onMouseOver}
      @mouseleave=${handlers.onMouseLeave}
    ></div>
  `;
}
