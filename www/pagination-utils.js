/**
 * Shared pagination utilities for Yeelight Cube cards.
 *
 * Provides:
 *  - paginationStyles  — CSS string to inject into any shadow DOM
 *  - renderPagination  — returns { items, html } given an items array + state
 *  - attachPaginationListeners — wires click → page change on a container
 */

// ─── CSS ────────────────────────────────────────────────────────────────────
// Matches the Draw Card's pagination appearance exactly (draw_card_styles.js).
// Uses the `.pagination-container` and `.draw-btn` class names so the look
// is 1‑for‑1 identical regardless of which card renders them.

export const paginationStyles = `
  /* Pagination button base */
  .draw-btn {
    background: #e6f7ff;
    color: #0077cc;
    border: none;
    border-radius: 8px;
    padding: 10px 0;
    cursor: pointer;
    font-size: 1em;
    font-weight: 500;
    min-width: 120px;
    transition: background 0.2s;
    box-shadow: 0 1px 4px #0003;
    text-align: center;
  }
  .draw-btn:hover {
    background: #b3e6ff;
  }
  .draw-btn.save {
    background: #e6f7ff;
    color: #0077cc;
    box-shadow: none;
  }
  .draw-btn.save:hover {
    background: #b3e6ff;
  }
  .draw-btn:disabled,
  .draw-btn.disabled {
    background: var(--disabled-text-color, #bdbdbd) !important;
    color: #ffffff !important;
    cursor: not-allowed !important;
    opacity: 0.6;
  }
  .draw-btn:disabled:hover,
  .draw-btn.disabled:hover {
    background: var(--disabled-text-color, #bdbdbd) !important;
  }
  .draw-btn.active {
    background: #0077cc !important;
    color: white !important;
  }

  /* Pagination container */
  .pagination-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
    border-radius: 8px;
  }
  .pagination-container.pages {
    gap: 8px;
  }

  /* Sizing overrides inside pagination */
  .pagination-container .draw-btn {
    min-width: 40px;
    padding: 8px 12px;
    font-size: 0.9em;
  }
  .pagination-container .draw-btn.save {
    min-width: 40px;
    padding: 8px;
  }
  .pagination-container .draw-btn ha-icon {
    width: 18px;
    height: 18px;
  }

  /* Responsive */
  @media (max-width: 600px) {
    .pagination-container.pages {
      gap: 4px;
    }
    .pagination-container .draw-btn {
      padding: 6px 8px;
      font-size: 0.85em;
      min-width: 32px;
    }
    .pagination-container .draw-btn.save {
      padding: 6px;
    }
  }
`;

// ─── HTML generation ────────────────────────────────────────────────────────

/**
 * Paginate an array of items and return the visible slice + HTML controls.
 *
 * @param {Object} opts
 * @param {Array}  opts.items         — full array of items
 * @param {number} opts.currentPage   — zero-based page index
 * @param {number} opts.itemsPerPage  — items per page (0 = no pagination)
 * @param {number} [opts.maxDisplayPages=5] — max page buttons to show
 * @returns {{ items: Array, html: string, totalPages: number, currentPage: number }}
 */
export function renderPagination({
  items,
  currentPage,
  itemsPerPage,
  maxDisplayPages = 5,
}) {
  if (!items || !items.length || !itemsPerPage || itemsPerPage <= 0) {
    return { items: items || [], html: "", totalPages: 1, currentPage: 0 };
  }

  const totalPages = Math.ceil(items.length / itemsPerPage);
  const safePage = Math.max(0, Math.min(currentPage, totalPages - 1));
  const startIdx = safePage * itemsPerPage;
  const paginatedItems = items.slice(startIdx, startIdx + itemsPerPage);

  let html = "";
  if (totalPages > 1) {
    const startPage = Math.max(
      0,
      safePage - Math.floor(maxDisplayPages / 2),
    );
    const endPage = Math.min(totalPages, startPage + maxDisplayPages);

    let pageButtons = "";
    for (let p = startPage; p < endPage; p++) {
      pageButtons += `<button class="draw-btn save${p === safePage ? " active" : ""}" data-pagination-page="${p}" title="Page ${p + 1}" style="min-width:29px;height:29px;">${p + 1}</button>`;
    }

    html = `
      <div class="pagination-container pages">
        <button class="draw-btn save${safePage === 0 ? " disabled" : ""}" data-pagination-action="prev" title="Previous page"${safePage === 0 ? " disabled" : ""}>
          <ha-icon icon="mdi:chevron-left"></ha-icon>
        </button>
        ${pageButtons}
        <button class="draw-btn save${safePage >= totalPages - 1 ? " disabled" : ""}" data-pagination-action="next" title="Next page"${safePage >= totalPages - 1 ? " disabled" : ""}>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>
    `;
  }

  return { items: paginatedItems, html, totalPages, currentPage: safePage };
}

// ─── Event wiring ───────────────────────────────────────────────────────────

/**
 * Attach click listeners for pagination inside a container element.
 *
 * Looks for `[data-pagination-page]` (direct page) and
 * `[data-pagination-action]` (prev / next) attributes.
 *
 * @param {HTMLElement} container — the element to listen on (use event delegation)
 * @param {Function}    onPageChange — callback(newPageIndex: number)
 *   The callback receives the requested page index. The caller is responsible
 *   for clamping and triggering a re-render.
 */
export function attachPaginationListeners(container, onPageChange) {
  if (!container) return;

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(
      "[data-pagination-page], [data-pagination-action]",
    );
    if (!btn) return;

    const directPage = btn.dataset.paginationPage;
    const action = btn.dataset.paginationAction;

    if (directPage !== undefined) {
      onPageChange(parseInt(directPage, 10));
    } else if (action === "prev") {
      onPageChange("prev");
    } else if (action === "next") {
      onPageChange("next");
    }
  });
}
