/**
 * Shared pagination utilities for Yeelight Cube cards.
 *
 * Provides:
 *  - paginationStyles  — CSS string to inject into any shadow DOM
 *  - paginate          — the items of a page, and the page count
 *  - requestedPage     — the page a button asks for ("prev", "next", n)
 * The page buttons are the shared gallery's (gallery-layouts.js).
 */

// ─── CSS ────────────────────────────────────────────────────────────────────
// The page buttons of the shared gallery (and any paged list): the
// `.pagination-container` / `.yc-page-btn` classes, the same on every card.

export const paginationStyles = `
  /* Pagination button base */
  .yc-page-btn {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
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
  .yc-page-btn:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }
  .yc-page-btn.save {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 15%, var(--card-background-color, #fff));
    color: var(--primary-color, #0077cc);
    box-shadow: none;
  }
  .yc-page-btn.save:hover {
    background: color-mix(in srgb, var(--primary-color, #1976d2) 30%, var(--card-background-color, #fff));
  }
  .yc-page-btn:disabled,
  .yc-page-btn.disabled {
    background: var(--disabled-text-color, #bdbdbd) !important;
    color: var(--text-primary-color, #fff) !important;
    cursor: not-allowed !important;
    opacity: 0.6;
  }
  .yc-page-btn:disabled:hover,
  .yc-page-btn.disabled:hover {
    background: var(--disabled-text-color, #bdbdbd) !important;
  }
  .yc-page-btn.active {
    background: var(--primary-color, #0077cc) !important;
    color: var(--text-primary-color, #fff) !important;
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
  .pagination-container .yc-page-btn {
    min-width: 40px;
    padding: 8px 12px;
    font-size: 0.9em;
  }
  .pagination-container .yc-page-btn.save {
    min-width: 40px;
    padding: 8px;
  }
  .pagination-container .yc-page-btn ha-icon {
    width: 18px;
    height: 18px;
  }

  /* Responsive */
  @media (max-width: 600px) {
    .pagination-container.pages {
      gap: 4px;
    }
    .pagination-container .yc-page-btn {
      padding: 6px 8px;
      font-size: 0.85em;
      min-width: 32px;
    }
    .pagination-container .yc-page-btn.save {
      padding: 6px;
    }
  }
`;

/**
 * The items of page `currentPage` (zero-based, clamped) and the page count.
 * itemsPerPage 0 (or missing): no paging.
 * @returns {{ items: Array, totalPages: number, currentPage: number }}
 */
export function paginate({ items, currentPage, itemsPerPage }) {
  if (!items || !items.length || !itemsPerPage || itemsPerPage <= 0)
    return { items: items || [], totalPages: 1, currentPage: 0 };
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const page = Math.max(0, Math.min(currentPage, totalPages - 1));
  return {
    items: items.slice(page * itemsPerPage, (page + 1) * itemsPerPage),
    totalPages,
    currentPage: page,
  };
}

export function requestedPage(value, currentPage, totalPages) {
  const current = Math.max(0, Math.min(currentPage || 0, totalPages - 1));
  const requested =
    value === "next"
      ? current + 1
      : value === "prev"
        ? current - 1
        : Number(value);
  return Math.max(
    0,
    Math.min(Number.isFinite(requested) ? requested : 0, totalPages - 1),
  );
}
