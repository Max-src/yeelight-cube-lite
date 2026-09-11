// ============================================================================
//  Shared orderable item list (drag & drop / move / add / remove / reset)
// ============================================================================
//
// One editor control for "pick which items to show, in which order": used by
// the clock card's quick schemes + visible styles and the gradient card's
// visible modes. Plain editor UI — no overlays on the dashboard-rendered card.
//
// The control is stateless: drag state travels in the DataTransfer payload and
// row highlight classes are cleaned up via DOM traversal, so any number of
// lists can coexist in one editor.

import { html, css } from "./lib/lit-all.js";

export const orderableListStyles = css`
  .orderable-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 10px 0;
    max-height: 320px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 4px;
  }
  .orderable-list-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 8px;
    padding: 6px 8px;
  }
  .orderable-list-row.dragging {
    opacity: 0.5;
  }
  .orderable-list-row.drag-over {
    border-color: var(--primary-color, #03a9f4);
    box-shadow: inset 0 0 0 1px var(--primary-color, #03a9f4);
  }
  .orderable-drag-handle {
    cursor: grab;
    color: var(--secondary-text-color, #999);
    font-size: 1em;
    line-height: 1;
    user-select: none;
    padding: 0 2px;
  }
  .orderable-list-name {
    flex: 1;
    font-size: 0.92em;
    color: var(--primary-text-color, #333);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .orderable-list-row button {
    border: none;
    background: var(--secondary-background-color, #f0f0f0);
    color: var(--primary-text-color, #333);
    border-radius: 6px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 0.9em;
    line-height: 1;
  }
  .orderable-list-row button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .orderable-list-row button.remove {
    color: var(--error-color, #d32f2f);
  }
  .orderable-add-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .orderable-add-row select {
    flex: 1;
  }
  .orderable-reset-btn {
    background: none;
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 0.85em;
    color: var(--primary-text-color, #333);
    cursor: pointer;
  }
`;

/**
 * Render an orderable list editor (Lit template).
 *
 * @param {Object} opts
 * @param {string[]} opts.items       - current ordered item names
 * @param {string[]} opts.available   - names that can still be added
 * @param {Function} opts.onUpdate    - (newList) => void, fired on any change
 * @param {Function} [opts.onReset]   - () => void; shows a reset button when set
 * @param {string} [opts.addPlaceholder="Add an item…"]
 * @param {string} [opts.resetLabel="Reset to defaults"]
 */
export function renderOrderableList({
  items,
  available,
  onUpdate,
  onReset,
  addPlaceholder = "Add an item…",
  resetLabel = "Reset to defaults",
}) {
  const onDragStart = (e, idx) => {
    e.dataTransfer.effectAllowed = "move";
    // Firefox needs data set for the drag to start; the payload also carries
    // the source index so no host state is required.
    try {
      e.dataTransfer.setData("text/plain", String(idx));
    } catch (_) {}
    e.currentTarget.classList.add("dragging");
  };
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    e.currentTarget.classList.add("drag-over");
  };
  const onDragLeave = (e) => {
    e.currentTarget.classList.remove("drag-over");
  };
  const onDrop = (e, targetIdx) => {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(from) || from === targetIdx) return;
    const list = [...items];
    const [moved] = list.splice(from, 1);
    list.splice(targetIdx, 0, moved);
    onUpdate(list);
  };
  const onDragEnd = (e) => {
    e.currentTarget.parentElement
      ?.querySelectorAll(".orderable-list-row")
      .forEach((r) => r.classList.remove("dragging", "drag-over"));
  };
  const onMove = (idx, delta) => {
    const target = idx + delta;
    if (target < 0 || target >= items.length) return;
    const list = [...items];
    [list[idx], list[target]] = [list[target], list[idx]];
    onUpdate(list);
  };
  const onRemove = (idx) => {
    onUpdate(items.filter((_, i) => i !== idx));
  };
  const onAdd = (e) => {
    const value = e.target.value;
    if (!value) return;
    onUpdate([...items, value]);
    e.target.value = "";
  };

  const rows = items.map(
    (name, idx) => html`
      <div
        class="orderable-list-row"
        draggable="true"
        data-idx="${idx}"
        @dragstart="${(e) => onDragStart(e, idx)}"
        @dragover="${onDragOver}"
        @dragleave="${onDragLeave}"
        @drop="${(e) => onDrop(e, idx)}"
        @dragend="${onDragEnd}"
      >
        <span class="orderable-drag-handle" title="Drag to reorder">⋮⋮</span>
        <button
          title="Move up"
          ?disabled="${idx === 0}"
          @click="${() => onMove(idx, -1)}"
        >
          ▲
        </button>
        <button
          title="Move down"
          ?disabled="${idx === items.length - 1}"
          @click="${() => onMove(idx, 1)}"
        >
          ▼
        </button>
        <span class="orderable-list-name">${name}</span>
        <button class="remove" title="Remove" @click="${() => onRemove(idx)}">
          ✕
        </button>
      </div>
    `,
  );

  return html`
    <div class="orderable-list">${rows}</div>
    <div class="orderable-add-row">
      <select @change="${onAdd}">
        <option value="">${addPlaceholder}</option>
        ${available.map((n) => html`<option value="${n}">${n}</option>`)}
      </select>
      ${onReset
        ? html`
            <button class="orderable-reset-btn" @click="${onReset}">
              ${resetLabel}
            </button>
          `
        : ""}
    </div>
  `;
}
