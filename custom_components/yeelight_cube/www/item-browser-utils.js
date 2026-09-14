import { escapeHtml } from "./html-escape-utils.js";

const browserBindings = new WeakMap();

export function browseItems(
  items,
  { filter, sort, filters = [], sorts = [] } = {},
) {
  const predicate = filters.find((option) => option.value === filter)?.test;
  const compare = sorts.find((option) => option.value === sort)?.compare;
  const result = predicate ? items.filter(predicate) : [...items];
  return compare ? result.sort(compare) : result;
}

export function renderItemIndicators(indicators = []) {
  return indicators.length
    ? `<span class="item-indicators">${indicators
        .map((indicator) => {
          const state = ["responds", "unchanged"].includes(indicator.state)
            ? indicator.state
            : "unknown";
          const icon =
            state === "responds"
              ? "mdi:check-circle-outline"
              : state === "unchanged"
                ? "mdi:minus-circle-outline"
                : "mdi:help-circle-outline";
          return `<span class="item-indicator" data-state="${state}" tabindex="0" role="img" aria-label="${escapeHtml(indicator.description)}"><ha-icon icon="${icon}"></ha-icon><span class="item-indicator-label">${escapeHtml(indicator.shortLabel || indicator.label)}</span></span>`;
        })
        .join("")}</span>`
    : "";
}

export function renderItemBrowserToolbar({
  filters = [],
  sorts = [],
  filter = "all",
  sort = "manual",
  count,
  total,
  filterDisabled = false,
  label = "Browse items",
}) {
  const select = (kind, label, icon, options, value, disabled = false) =>
    `<label class="item-browser-select" title="${label}"><ha-icon icon="${icon}"></ha-icon><select data-browser-${kind} aria-label="${label}" ${disabled ? "disabled" : ""}>${options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
  return `<div class="item-browser-toolbar" role="group" aria-label="${escapeHtml(label)}">
    ${select("filter", "Filter", filter !== "all" && !filterDisabled ? "mdi:filter-check" : "mdi:filter-variant", filters, filterDisabled ? "all" : filter, filterDisabled)}
    ${select("sort", "Sort", "mdi:sort", sorts, sort)}
    <span class="item-browser-count" role="status">${count} / ${total}</span>
    <button type="button" data-browser-reset title="Reset filters and sorting" aria-label="Reset filters and sorting"><ha-icon icon="mdi:restore"></ha-icon></button>
  </div>`;
}

export function bindItemBrowser(root, { onFilter, onSort, onReset } = {}) {
  browserBindings.get(root)?.();
  const controller = new AbortController();
  const listen = (element, type, callback) =>
    element.addEventListener(type, callback, { signal: controller.signal });
  root
    .querySelectorAll("[data-browser-filter]")
    .forEach((element) =>
      listen(element, "change", (event) => onFilter?.(event.target.value)),
    );
  root
    .querySelectorAll("[data-browser-sort]")
    .forEach((element) =>
      listen(element, "change", (event) => onSort?.(event.target.value)),
    );
  root
    .querySelectorAll("[data-browser-reset]")
    .forEach((element) => listen(element, "click", () => onReset?.()));
  let tooltip;
  const hideTooltip = () => tooltip?.remove();
  browserBindings.set(root, () => {
    controller.abort();
    hideTooltip();
  });
  root.querySelectorAll(".item-indicator").forEach((element) => {
    const showTooltip = () => {
      hideTooltip();
      tooltip = document.createElement("div");
      tooltip.className = "item-indicator-tooltip";
      tooltip.setAttribute("role", "tooltip");
      tooltip.textContent = element.getAttribute("aria-label");
      root.append(tooltip);
      const rect = element.getBoundingClientRect();
      const width = tooltip.getBoundingClientRect().width;
      tooltip.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))}px`;
      tooltip.style.top = `${Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - tooltip.offsetHeight - 4))}px`;
    };
    listen(element, "mouseenter", showTooltip);
    listen(element, "mouseleave", hideTooltip);
    listen(element, "focus", showTooltip);
    listen(element, "blur", hideTooltip);
    for (const type of ["pointerdown", "mousedown", "touchstart", "touchend"])
      listen(element, type, (event) => event.stopPropagation());
    listen(element, "click", (event) => {
      event.stopPropagation();
      element.focus();
      showTooltip();
    });
    listen(element, "keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") hideTooltip();
    });
  });
}

export const itemBrowserStyles = `
  .item-browser-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:8px 0; }
  .item-browser-select { display:flex; align-items:center; gap:4px; min-width:0; max-width:100%; flex:1 1 130px; }
  .item-browser-select select { min-width:0; width:100%; padding:8px 4px; border:1px solid var(--divider-color,#ccc); border-radius:6px; color:var(--primary-text-color); background:var(--card-background-color,#fff); font:inherit; }
  .item-browser-toolbar ha-icon { --mdc-icon-size:20px; flex-shrink:0; }
  .item-browser-toolbar button { display:grid; place-items:center; width:36px; height:36px; padding:0; border:1px solid var(--divider-color,#ccc); border-radius:6px; background:transparent; color:var(--primary-text-color); cursor:pointer; }
  .item-browser-count { font-size:12px; white-space:nowrap; color:var(--secondary-text-color); }
  .item-indicators { display:flex; flex-wrap:wrap; justify-content:center; gap:4px; margin-top:4px; max-width:100%; }
  .item-indicator { position:relative; display:inline-flex; align-items:center; gap:3px; max-width:100%; padding:2px 3px; border-radius:3px; background:var(--card-background-color,#fff); font-size:11px; line-height:1.3; font-weight:normal; color:var(--secondary-text-color,#62666c); cursor:help; }
  .item-indicator[data-state="responds"] { color:var(--primary-color,#0288d1); }
  .item-indicator ha-icon { --mdc-icon-size:14px; flex-shrink:0; }
  .item-indicator-label { overflow-wrap:anywhere; }
  .item-indicator-tooltip { position:fixed; z-index:1000; width:180px; max-width:calc(100vw - 20px); box-sizing:border-box; padding:8px; border:1px solid var(--divider-color,#ccc); border-radius:4px; background:var(--card-background-color,#fff); color:var(--primary-text-color,#222); font-size:12px; white-space:normal; text-align:left; box-shadow:0 2px 6px #0003; pointer-events:none; }
  .item-indicator:focus-visible { outline:2px solid var(--primary-color); outline-offset:2px; }
  .item-browser-empty { text-align:center; padding:16px 0; color:var(--secondary-text-color); }
`;
