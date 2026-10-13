// The shared tab bar (a segmented control with a sliding thumb), used by the
// Draw colors in "Tabs" mode, the Gradient "Apply to Whole Panel" tabs and
// the Lamp Preview tabbed adjustments. Its markup lives in the card's shadow
// root: include tabBarStyles in the card's stylesheet.
import { html, nothing } from "./lib/lit-all.js";

/**
 * A row of tabs, one selected.
 * @param {Object} p
 * @param {Array<{key: string, label: string, icon?: *, title?: string, extra?: *}>} p.tabs
 *   `icon` before the label, `extra` after it (e.g. a change indicator)
 * @param {string} p.active - the selected tab's key
 * @param {Function} p.onSelect - (key) when a tab is picked (click or keys)
 * @param {string} [p.shape] - "rounded" (default), "round" or "square"
 * @param {string} [p.label] - what the tabs choose, for assistive technology
 * @param {string} [p.className] - extra classes on the bar
 */
export function tabBar({ tabs, active, onSelect, shape = "rounded", label, className = "" }) {
  const index = Math.max(0, tabs.findIndex((tab) => tab.key === active));
  // Arrow keys, Home and End move between the tabs (and select them).
  const onKeyDown = (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : step
            ? (index + step + tabs.length) % tabs.length
            : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(tabs[next].key);
    event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return html`<div
    class="yc-tabs ${className}"
    role="tablist"
    aria-label=${label || nothing}
    data-shape=${shape}
    style="--yc-tab-count:${tabs.length};--yc-tab-index:${index}"
    @keydown=${onKeyDown}
  >
    <div class="yc-tabs-thumb"></div>
    ${tabs.map(
      (tab, i) => html`<button
        type="button"
        role="tab"
        class="yc-tab${i === index ? " active" : ""}"
        aria-selected=${i === index ? "true" : "false"}
        tabindex=${i === index ? "0" : "-1"}
        title=${tab.title ?? tab.label}
        data-tab=${tab.key}
        @click=${() => onSelect(tab.key)}
      >
        ${tab.icon ? html`<span class="yc-tab-icon">${tab.icon}</span>` : nothing}
        <span class="yc-tab-label">${tab.label}</span>${tab.extra ?? nothing}
      </button>`,
    )}
  </div>`;
}

export const tabBarStyles = `
  .yc-tabs {
    position: relative;
    display: flex;
    width: 100%;
    box-sizing: border-box;
    padding: 3px;
    border-radius: 10px;
    background: color-mix(
      in srgb,
      var(--primary-color, #1976d2) 8%,
      var(--card-background-color, #fff)
    );
  }
  .yc-tabs-thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px) / var(--yc-tab-count, 1));
    border-radius: 8px;
    background: var(--card-background-color, #fff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    transform: translateX(calc(var(--yc-tab-index, 0) * 100%));
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
  }
  .yc-tab {
    position: relative;
    z-index: 1;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    font: inherit;
    font-size: 0.88em;
    font-weight: 500;
    color: var(--secondary-text-color, #666);
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    transition: color 0.2s ease;
  }
  .yc-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .yc-tab:hover:not(.active) {
    color: var(--primary-text-color, #444);
  }
  .yc-tab.active {
    color: var(--primary-color, #03a9f4);
    font-weight: 600;
  }
  .yc-tab:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: -2px;
  }
  .yc-tabs[data-shape="round"],
  .yc-tabs[data-shape="round"] .yc-tabs-thumb,
  .yc-tabs[data-shape="round"] .yc-tab {
    border-radius: 999px;
  }
  .yc-tabs[data-shape="square"],
  .yc-tabs[data-shape="square"] .yc-tabs-thumb,
  .yc-tabs[data-shape="square"] .yc-tab {
    border-radius: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .yc-tabs-thumb {
      transition: none;
    }
  }
`;
