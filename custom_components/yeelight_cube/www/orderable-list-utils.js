// ============================================================================
//  Shared orderable item list (drag & drop / move / add / remove / reset)
// ============================================================================
//
// One editor control for "pick which items to show, in which order" (drag,
// ▲ ▼ one step, ⤒ ⤓ to the top or the bottom): used by
// the clock card's quick schemes + visible styles and the gradient card's
// visible modes; and, order only (no add / remove), for the Arrange block of
// the user collections (palettes, pixel arts). Plain editor UI — no overlays
// on the dashboard-rendered card.
//
// The control is stateless: drag state travels in the DataTransfer payload and
// row highlight classes are cleaned up via DOM traversal, so any number of
// lists can coexist in one editor.

import { html, css, unsafeHTML } from "./lib/lit-all.js";
export const orderableListStyles = css`
  .orderable-list-content {
    flex: 1;
    min-width: 0;
  }
  .orderable-list-content .orderable-list-name {
    display: block;
  }
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
  /* fullHeight: every row shown (the editor scrolls, not the list). */
  .orderable-list.orderable-list-full {
    max-height: none;
    overflow-y: visible;
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
  /* Row thumbnail (thumbFor): a palette's blend, a pixel art's picture. */
  .collection-thumb {
    flex-shrink: 0;
    width: 44px;
    height: 14px;
    border-radius: 3px;
    overflow: hidden;
    display: inline-flex;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  .collection-thumb-matrix {
    height: auto;
    background: #000;
  }
  .orderable-drag-handle {
    cursor: grab;
    color: var(--secondary-text-color, #999);
    font-size: 1em;
    line-height: 1;
    user-select: none;
    padding: 0 2px;
  }
  /* Inline rename: a text field per row (the editor's input style); a
     renamed row also shows its built-in name. */
  .orderable-list-rename {
    width: 100%;
    box-sizing: border-box;
  }
  .orderable-list-builtin {
    display: block;
    margin-top: 2px;
    font-size: 0.8em;
    color: var(--secondary-text-color, #666);
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
    min-width: 0;
    max-width: 100%;
    padding: 8px;
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 6px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #333);
    font: inherit;
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
 * @param {Function} [opts.onRename] - (name, label) => void; each row's name
 *   becomes a field showing `labels[name]` (empty: the built-in name, shown
 *   as its placeholder). Used for the cards' item_labels.
 * @param {Object} [opts.labels] - the current labels, by item name
 * @param {boolean} [opts.addable=true] - show the "Add" picker
 * @param {boolean} [opts.removable=true] - show each row's remove button
 * @param {Function} [opts.thumbFor] - (name) => a small preview (trusted
 *   HTML) shown before the row's name
 * @param {boolean} [opts.fullHeight=false] - show every row instead of a
 *   scrolling box (lists whose whole order matters: Arrange)
 */
export function renderOrderableList({
  items,
  available,
  onUpdate,
  onReset,
  addPlaceholder = "Add an item…",
  resetLabel = "Reset to defaults",
  labelFor = (name) => name,
  optionLabelFor = labelFor,
  displayItems = items,
  canReorder = true,
  onRename,
  labels = {},
  addable = true,
  removable = true,
  thumbFor,
  fullHeight = false,
}) {
  canReorder =
    canReorder &&
    displayItems.length === items.length &&
    displayItems.every((name, index) => name === items[index]);
  const onDragStart = (e, idx) => {
    if (!canReorder) {
      e.preventDefault();
      return;
    }
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
    if (!canReorder) return;
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
    if (!canReorder) return;
    const target = idx + delta;
    if (target < 0 || target >= items.length) return;
    const list = [...items];
    [list[idx], list[target]] = [list[target], list[idx]];
    onUpdate(list);
  };
  // To the top or the bottom in one step (long lists: Arrange, Styles).
  const onMoveTo = (idx, target) => {
    if (!canReorder || idx === target) return;
    const list = [...items];
    list.splice(target, 0, list.splice(idx, 1)[0]);
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

  const rows = displayItems.map((name, displayIndex) => {
    const idx = displayItems === items ? displayIndex : items.indexOf(name);
    return html`
      <div
        class="orderable-list-row"
        draggable="${canReorder ? "true" : "false"}"
        data-idx="${idx}"
        @dragstart="${(e) => onDragStart(e, idx)}"
        @dragover="${onDragOver}"
        @dragleave="${onDragLeave}"
        @drop="${(e) => onDrop(e, idx)}"
        @dragend="${onDragEnd}"
      >
        ${canReorder
          ? html`<span class="orderable-drag-handle" title="Drag to reorder"
              >⋮⋮</span
            >`
          : ""}
        <button
          title="Move to the top"
          aria-label="Move to the top"
          ?disabled="${!canReorder || idx === 0}"
          @click="${() => onMoveTo(idx, 0)}"
        >
          ⤒
        </button>
        <button
          title="Move up"
          aria-label="Move up"
          ?disabled="${!canReorder || idx === 0}"
          @click="${() => onMove(idx, -1)}"
        >
          ▲
        </button>
        <button
          title="Move down"
          aria-label="Move down"
          ?disabled="${!canReorder || idx === items.length - 1}"
          @click="${() => onMove(idx, 1)}"
        >
          ▼
        </button>
        <button
          title="Move to the bottom"
          aria-label="Move to the bottom"
          ?disabled="${!canReorder || idx === items.length - 1}"
          @click="${() => onMoveTo(idx, items.length - 1)}"
        >
          ⤓
        </button>
        ${thumbFor ? unsafeHTML(thumbFor(name)) : ""}
        <div class="orderable-list-content">
          ${onRename
            ? html`<input
                class="orderable-list-rename"
                type="text"
                aria-label="Name of ${labelFor(name)} on this card"
                title="Built-in name: ${labelFor(name)}. Rename on this card (empty: built-in name)."
                placeholder=${labelFor(name)}
                .value=${labels[name] || ""}
                @change=${(event) => onRename(name, event.target.value)}
              />${labels[name]
                ? html`<span class="orderable-list-builtin"
                    >${labelFor(name)}</span
                  >`
                : ""}`
            : html`<span class="orderable-list-name">${labelFor(name)}</span>`}
        </div>
        ${removable
          ? html`<button
              class="remove"
              title="Remove"
              @click="${() => onRemove(idx)}"
            >
              ✕
            </button>`
          : ""}
      </div>
    `;
  });

  return html`
    <div class="orderable-list${fullHeight ? " orderable-list-full" : ""}">
      ${rows}
    </div>
    ${addable || onReset
      ? html`<div class="orderable-add-row">
          ${addable
            ? html`<select @change="${onAdd}">
                <option value="">${addPlaceholder}</option>
                ${available.map(
                  (n) => html`<option value="${n}">${optionLabelFor(n)}</option>`,
                )}
              </select>`
            : ""}
          ${onReset
            ? html`
                <button class="orderable-reset-btn" @click="${onReset}">
                  ${resetLabel}
                </button>
              `
            : ""}
        </div>`
      : ""}
  `;
}
