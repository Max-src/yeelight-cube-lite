/**
 * Idempotent registration for custom elements and the Lovelace card picker.
 *
 * A module can be evaluated twice (e.g. the integration's resource plus a
 * leftover manual Lovelace resource, or the add_extra_js_url fallback), and
 * customElements.define throws on a second call, which breaks the card. Every
 * element and card registers through these helpers instead.
 */

export function defineOnce(tag, elementClass) {
  if (!customElements.get(tag)) customElements.define(tag, elementClass);
}

export function registerCustomCard(card) {
  window.customCards = window.customCards || [];
  if (!window.customCards.some((entry) => entry.type === card.type))
    window.customCards.push(card);
}
