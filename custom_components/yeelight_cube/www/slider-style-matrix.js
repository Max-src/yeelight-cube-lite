// The "Matrix" (a grid of cells that light up) style of the shared slider (slider-control-utils.js): its
// markup, its visual update for a value, its drag over the cells and its CSS.
import { formatSliderValue } from "./slider-values.js";

export default {
  render({ gc, v, showValue, thickness, on }) {
    const cols = Math.max(3, Math.min(20, parseInt(gc.matrixCols) || 10));
    const rows = Math.max(1, Math.min(6, parseInt(gc.matrixRows) || 2));
    const matrixDir = gc.matrixDir || "row";
    const matrixPixelStyle = gc.matrixPixelStyle || "rounded";
    const cellPx = thickness * 3 + 4;
    const total = cols * rows;
    const maxWidth = cols * (cellPx + 3) + 16;
    const litCount = Math.max(1, Math.round((v / 100) * total));
    let cells = "";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const level =
          matrixDir === "col"
            ? c * rows + (rows - 1 - r) + 1
            : (rows - 1 - r) * cols + c + 1;
        const lit = level <= litCount ? " lit" : "";
        cells += `<div class="brightness-matrix-cell${lit}" data-level="${level}"></div>`;
      }
    }
    const value = showValue
      ? `<div class="brightness-matrix-value">${formatSliderValue(v, gc)}</div>`
      : "";
    return {
      html: `
      <div class="brightness-matrix-wrapper">
        <div class="brightness-matrix-grid pixel-shape-${matrixPixelStyle}" data-total="${total}"
             style="box-sizing:border-box;grid-template-columns:repeat(${cols},1fr);gap:3px;max-width:${maxWidth}px;"
             ${on({ mousedown: "MatrixDown", touchstart: "MatrixDown" })}>
          ${cells}
        </div>
        ${value}
        <input type="range" min="1" max="100" value="${v}"
          class="brightness-slider brightness-slider-matrix" style="display:none;"
          ${on({ input: "Change" })} />
      </div>`,
      // The grid's width is capped: the step buttons stay centred under it.
      mirror: { right: value, trackMaxWidth: maxWidth },
    };
  },

  update({ gc, scoped }, value) {
    const grid = scoped()?.querySelector(".brightness-matrix-grid");
    if (!grid) return;
    const total = parseInt(grid.dataset.total) || 1;
    const litCount = Math.max(1, Math.round((value / 100) * total));
    grid.querySelectorAll(".brightness-matrix-cell").forEach((cell) => {
      const level = parseInt(cell.dataset.level) || 0;
      cell.classList.toggle("lit", level <= litCount);
    });
    if (gc.showValue !== false) {
      const val = scoped()?.querySelector(".brightness-matrix-value");
      if (val) val.textContent = formatSliderValue(value, gc);
    }
  },

  handlers({ host, applyValue, holdPointer, releasePointer, followDrag, clamp }) {
    return {
      MatrixDown(event, element) {
        event.preventDefault();
        holdPointer();
        const grid = element ?? event.currentTarget;
        const total = parseInt(grid.dataset.total) || 1;
        const input = grid.parentElement?.querySelector(
          ".brightness-slider-matrix",
        );
        const applyAt = (cx, cy) => {
          if (cx === undefined || cy === undefined) return;
          const el = host.shadowRoot.elementFromPoint(cx, cy);
          if (el?.classList?.contains("brightness-matrix-cell")) {
            const level = parseInt(el.dataset.level) || 1;
            const val = clamp(Math.round((level / total) * 100));
            if (input) input.value = val;
            applyValue(val);
          }
        };
        applyAt(
          event.clientX ?? event.touches?.[0]?.clientX,
          event.clientY ?? event.touches?.[0]?.clientY,
        );
        // One cell lookup per frame while dragging.
        let rafPending = false;
        const move = (e) => {
          const cx = e.clientX ?? e.touches?.[0]?.clientX;
          const cy = e.clientY ?? e.touches?.[0]?.clientY;
          if (cx === undefined) return;
          e.preventDefault();
          if (rafPending) return;
          rafPending = true;
          requestAnimationFrame(() => {
            rafPending = false;
            applyAt(cx, cy);
          });
        };
        followDrag(move, releasePointer);
      },
    };
  },

  css: `
  .brightness-matrix-grid {
    flex: 1;
    display: grid;
    gap: 4px;
    padding: 8px;
    border-radius: 10px;
    background: #101012;
    box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.55);
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }
  .brightness-matrix-cell {
    aspect-ratio: 1 / 1;
    border-radius: 3px;
    background: #2a2a2e;
    box-shadow: inset 0 0 2px rgba(0, 0, 0, 0.6);
    transition:
      background 0.12s ease,
      box-shadow 0.12s ease;
  }
  .brightness-matrix-cell.lit {
    background: radial-gradient(
      circle at 40% 35%,
      color-mix(in srgb, var(--brightness-color, #ff9800) 15%, #fff) 0%,
      var(--brightness-color, #ff9800) 55%,
      color-mix(in srgb, var(--brightness-color, #ff9800) 80%, #000) 100%
    );
    box-shadow:
      0 0 6px
        color-mix(in srgb, var(--brightness-color, #ff9800) 75%, transparent),
      inset 0 0 2px rgba(255, 255, 255, 0.4);
  }
  .pixel-shape-square .brightness-matrix-cell {
    border-radius: 0;
  }
  .pixel-shape-rounded .brightness-matrix-cell {
    border-radius: 3px;
  }
  .pixel-shape-round .brightness-matrix-cell {
    border-radius: 50%;
  }
`,
};
