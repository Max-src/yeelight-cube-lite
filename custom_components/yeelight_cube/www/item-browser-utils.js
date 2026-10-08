// Item indicator badges (a capability per item: responds / unchanged /
// unknown) of the gallery renderers and the editors' orderable lists.
import { escapeHtml } from "./html-escape-utils.js";

// One indicator badge: its state (responds / unchanged / unknown), icon,
// short text and accessible description. Shared by the HTML-string renderer
// below (gallery browsers) and the Lit one in orderable-list-utils.js.
export function itemIndicatorModel(indicator) {
  const state = ["responds", "unchanged"].includes(indicator.state)
    ? indicator.state
    : "unknown";
  return {
    state,
    icon:
      state === "responds"
        ? "mdi:check-circle-outline"
        : state === "unchanged"
          ? "mdi:minus-circle-outline"
          : "mdi:help-circle-outline",
    label: indicator.shortLabel || indicator.label,
    description: indicator.description,
  };
}

export function renderItemIndicators(indicators = []) {
  return indicators.length
    ? `<span class="item-indicators">${indicators
        .map(itemIndicatorModel)
        .map(
          (badge) =>
            `<span class="item-indicator" data-state="${badge.state}" tabindex="0" role="img" aria-label="${escapeHtml(badge.description)}"><ha-icon icon="${badge.icon}"></ha-icon><span class="item-indicator-label">${escapeHtml(badge.label)}</span></span>`,
        )
        .join("")}</span>`
    : "";
}

export const itemBrowserStyles = `
  .item-indicators { display:flex; flex-wrap:wrap; justify-content:center; gap:4px; margin-top:4px; max-width:100%; }
  .item-indicator { position:relative; display:inline-flex; align-items:center; gap:3px; max-width:100%; padding:2px 3px; border-radius:3px; background:var(--card-background-color,#fff); font-size:11px; line-height:1.3; font-weight:normal; color:var(--secondary-text-color,#62666c); cursor:help; }
  .item-indicator[data-state="responds"] { color:var(--primary-color,#0288d1); }
  .item-indicator ha-icon { --mdc-icon-size:14px; flex-shrink:0; }
  .item-indicator-label { overflow-wrap:anywhere; }
  .item-indicator:focus-visible { outline:2px solid var(--primary-color); outline-offset:2px; }
`;
