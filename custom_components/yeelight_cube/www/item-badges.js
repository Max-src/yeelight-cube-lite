// The small round icons an effect, a clock style or a favourite is described
// by, each named in its tooltip: its family (effect-families.js familyBadge),
// what it is (Official, Experimental, Custom, Directional) and, for a
// favourite, its color mode. One look for all of them (itemIconTemplate),
// colored like the card's buttons (their look: gallery-display-utils.js
// matrixPreviewStyles).
import { html, nothing } from "./lib/lit-all.js";
import { NATIVE_COLOR_MODES } from "./clock-preview-utils.js";

/** What an item is: { icon, title, emoji? }. The emoji (text-only places: a
 * dropdown, text buttons) only for what sets an item apart. */
export const ITEM_BADGES = Object.freeze({
  official: Object.freeze({
    icon: "mdi:check-decagram-outline",
    title: "Official: in the Yeelight app",
  }),
  experimental: Object.freeze({
    icon: "mdi:flask-outline",
    title: "Experimental: a lamp mode the Yeelight app does not offer",
    emoji: "🧪",
  }),
  custom: Object.freeze({
    icon: "mdi:pencil-outline",
    title: "Custom: a style you saved",
    emoji: "✏️",
  }),
  directional: Object.freeze({
    icon: "mdi:arrow-all",
    title: "Directional: its direction can be chosen",
  }),
});

/** A favourite's color mode as an icon ({ icon, title }), or its custom
 * color as a swatch ({ swatch, title }). */
export function colorModeBadge(colorMode, color) {
  if (Array.isArray(color) && color.length >= 3) {
    const hex = `#${color
      .slice(0, 3)
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("")}`;
    return { swatch: hex, title: `Custom color: ${hex.toUpperCase()}` };
  }
  const mode = NATIVE_COLOR_MODES.find((option) => option.value === (colorMode || "normal"));
  return mode ? { icon: mode.icon, title: `Color mode: ${mode.label}` } : null;
}

/** One icon ({ icon | swatch, title }), its title in the tooltip, colored
 * like the card's buttons (`buttonsStyle`: only their colors, never their
 * size). `kind` names it for styles and checks (family, badge, color-mode). */
export function itemIconTemplate(badge, buttonsStyle, kind = "badge") {
  if (!badge?.icon && !badge?.swatch) return nothing;
  return html`<span
    class="yc-item-icon yc-${kind}-icon"
    data-look=${buttonsStyle || "modern"}
    title=${badge.title}
    aria-label=${badge.title}
    role="img"
    >${badge.swatch
      ? html`<span class="yc-item-swatch" style=${`background:${badge.swatch};`}></span>`
      : html`<ha-icon icon=${badge.icon}></ha-icon>`}</span
  >`;
}

/** An item's icons in a row: what it is (`item.badges`, unless show_badges
 * is off), then its family (`item.badgeIcon`). */
export function itemIcons(item, config = {}) {
  return [
    ...(config.show_badges === false ? [] : (item.badges || []).map((badge) => [badge, "badge"])),
    ...(item.badgeIcon?.icon ? [[item.badgeIcon, "family"]] : []),
  ];
}

export function itemIconsTemplate(item, config = {}) {
  const icons = itemIcons(item, config);
  if (!icons.length) return nothing;
  return html`<span class="yc-item-icons"
    >${icons.map(([badge, kind]) => itemIconTemplate(badge, config.buttons_style, kind))}</span
  >`;
}

/** The emojis after an item's name where only text shows. */
export function itemEmojis(item, config = {}) {
  const emojis = itemIcons(item, config)
    .map(([badge]) => badge.emoji)
    .filter(Boolean);
  return emojis.length ? ` ${emojis.join(" ")}` : "";
}
