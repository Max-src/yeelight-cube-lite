// Generic palette rendering for Yeelight Cube Lite Draw Card
import { html } from "./lib/lit-all.js";
import { renderPaletteList } from "./draw_card_ui.js";

export function renderPaletteSection(
  palette,
  type,
  onSelect,
  mode = "row",
  swatchShape = "round",
  expandBtnMode = "label",
  buttonShape = "rect",
) {
  if (!palette || !palette.length) return "";
  const shapeClass = swatchShape === "square" ? "square" : "round";
  let hoveredColor = null;
  const handleMouseOver = (color) => {
    hoveredColor = color;
  };
  const handleMouseLeave = () => {
    hoveredColor = null;
  };
  const handleClick = (color, e) => {
    e.stopPropagation();
    if (hoveredColor === color) {
      onSelect(color);
    }
  };
  if (mode === "grid") {
    // 2-row grid
    const rowCount = 2;
    const colCount = Math.ceil(palette.length / rowCount);
    const rows = Array.from({ length: rowCount }, (_, r) =>
      palette.slice(r * colCount, (r + 1) * colCount),
    );
    return html`
      <div class="palette-grid">
        ${rows.map(
          (row) => html`
            <div class="palette-grid-row">
              ${row.map(
                (color) =>
                  html`<div
                    class="color-swatch ${shapeClass}"
                    style="background:${color}"
                    title="${color}"
                    @mouseover=${() => handleMouseOver(color)}
                    @mouseleave=${handleMouseLeave}
                    @click=${(e) => handleClick(color, e)}
                  ></div>`,
              )}
            </div>
          `,
        )}
      </div>
    `;
  } else if (mode === "expand") {
    return html`
      <palette-expandable
        .palette=${palette}
        .onSelect=${onSelect}
        .swatchShape=${swatchShape}
        .buttonMode=${expandBtnMode || "label"}
        .buttonShape=${buttonShape}
      ></palette-expandable>
    `;
  }
  // Default: horizontal row
  return html`
    <div class="palette-row-scroll">
      ${palette.map(
        (color) =>
          html`<div
            class="color-swatch ${shapeClass}"
            style="background:${color}"
            title="${color}"
            @mouseover=${() => handleMouseOver(color)}
            @mouseleave=${handleMouseLeave}
            @click=${(e) => {
              handleClick(color, e);
            }}
          ></div>`,
      )}
    </div>
  `;
}

// Expandable palette web component
class PaletteExpandable extends HTMLElement {
  connectedCallback() {
    this.render();
    // Add drag-to-scroll for palette-preview-content
    setTimeout(() => {
      const previewContent = this.querySelector(".palette-preview-content");
      if (previewContent) {
        let isDown = false;
        let startX;
        let scrollLeft;
        previewContent.addEventListener("mousedown", (e) => {
          isDown = true;
          previewContent.classList.add("dragging");
          startX = e.pageX - previewContent.offsetLeft;
          scrollLeft = previewContent.scrollLeft;
        });
        previewContent.addEventListener("mouseleave", () => {
          isDown = false;
          previewContent.classList.remove("dragging");
        });
        previewContent.addEventListener("mouseup", () => {
          isDown = false;
          previewContent.classList.remove("dragging");
        });
        previewContent.addEventListener("mousemove", (e) => {
          if (!isDown) return;
          e.preventDefault();
          const x = e.pageX - previewContent.offsetLeft;
          const walk = x - startX;
          previewContent.scrollLeft = scrollLeft - walk;
        });
        // Touch support
        previewContent.addEventListener("touchstart", (e) => {
          isDown = true;
          startX = e.touches[0].pageX - previewContent.offsetLeft;
          scrollLeft = previewContent.scrollLeft;
        });
        previewContent.addEventListener("touchend", () => {
          isDown = false;
        });
        previewContent.addEventListener("touchmove", (e) => {
          if (!isDown) return;
          const x = e.touches[0].pageX - previewContent.offsetLeft;
          const walk = x - startX;
          previewContent.scrollLeft = scrollLeft - walk;
        });
      }
    }, 0);
  }
  render() {
    const palette = this.palette || [];
    const onSelect = this.onSelect || (() => {});
    const expanded = this._expanded || false;
    // Use swatchShape from property, fallback to round
    const shapeClass = this.swatchShape === "square" ? "square" : "round";
    const buttonMode = this._buttonMode || "label"; // 'label' or 'icon'
    const buttonShape = this.buttonShape || "rect"; // Default to rect if not set

    const shown = expanded ? palette : palette.slice(0, 5);
    this.innerHTML = `
      <div class="palette-expandable">
        ${shown
          .map(
            (color) =>
              `<div class="color-swatch ${shapeClass}" style="background:${color}" data-color="${color}" title="${color}"></div>`,
          )
          .join("")}
        ${
          palette.length > 5
            ? buttonMode === "icon"
              ? `<button
                class="draw-btn expand-btn save icon-mode nav-btn-${buttonShape}"
                title="${expanded ? 'Show less colors' : 'Show more colors'}"
                style="   width: 29px !important;
                          height: 29px !important;
                          max-width: 29px !important;
                          min-width: 29px !important;">${
                            expanded
                              ? '<ha-icon icon="mdi:chevron-left"></ha-icon>'
                              : '<ha-icon icon="mdi:chevron-right"></ha-icon>'
                          }</button>`
              : `<button class="draw-btn expand-btn save nav-btn-${buttonShape}" title="${expanded ? 'Show less colors' : 'Show more colors'}">${
                  expanded ? "Less" : "More"
                }</button>`
            : ""
        }
      </div>
    `;
    this.querySelectorAll(".color-swatch").forEach((el) => {
      el.onclick = () => onSelect(el.getAttribute("data-color"));
    });
    const btn = this.querySelector(".expand-btn");
    if (btn) {
      btn.onclick = () => {
        this._expanded = !this._expanded;
        this.render();
      };
    }
  }
  set buttonMode(val) {
    this._buttonMode = val;
    this.render();
  }
  get buttonMode() {
    return this._buttonMode;
  }
  set palette(val) {
    this._palette = val;
    this.render();
  }
  get palette() {
    return this._palette;
  }
  set onSelect(fn) {
    this._onSelect = fn;
    this.render();
  }
  get onSelect() {
    return this._onSelect;
  }
  set buttonShape(val) {
    this._buttonShape = val;
    this.render();
  }
  get buttonShape() {
    return this._buttonShape || "rect";
  }
}
window.PaletteExpandable = PaletteExpandable;
customElements.define("palette-expandable", PaletteExpandable);
