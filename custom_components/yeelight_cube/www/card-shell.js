/**
 * The frame every Yeelight Cube card renders: one <ha-card> with the shared
 * header (title + lamp status), then the card's own body. Every card uses it
 * the same way, so a combined card later inherits one look:
 *
 *   render() {
 *     if (!lamp) return cardNotice(this, NOTICE.noLamp);
 *     return cardShell(this, html`<div class="…">…</div>`);
 *   }
 *
 * Options it reads (shared vocabulary, see card-config.js):
 * - title: the header title (none when empty);
 * - show_card_background: off gives a transparent <ha-card> (no background,
 *   border or shadow) with the same header and body;
 * - show_lamp_status: the first lamp's state in the header (its mode while
 *   on: "Clock", "Native Effect", …), on cards that control lamps.
 *
 * The body is padded by the frame (.yc-card-body, the same on every card)
 * and keeps its own layout. The CSS lives in cardLayoutStyles
 * (card-layout-utils.js), which every card includes.
 *
 * `card` is a YeelightCardMixin card (config, _hass, _targets,
 * _showCardBackground). This module needs Lit, so card-base.js (also loaded
 * by the Node tests) does not import it.
 */
import { html, nothing } from "./lib/lit-all.js";

/** Enter / Space: the keys that activate an element exposed as a button. */
export const isActivationKey = (event) =>
  event.key === "Enter" || event.key === " " || event.key === "Spacebar";

/** Messages shown by every card for the same situation. */
export const NOTICE = Object.freeze({
  loading: "Loading…",
  noLamp: "Select a Yeelight Cube lamp in the card editor.",
  unavailable: "Lamp unavailable",
});

/** What a lamp is doing, for the header: its mode while on, else its state. */
export function lampStatusText(stateObj) {
  if (stateObj?.state === "on") return stateObj.attributes?.content_mode || "on";
  return stateObj?.state || "unavailable";
}

function cardHeader(card, onTitleClick) {
  const config = card.config || {};
  const title = typeof config.title === "string" ? config.title.trim() : "";
  const lamp = card._targets?.[0];
  const status =
    lamp && config.show_lamp_status === true
      ? lampStatusText(card._hass?.states?.[lamp])
      : "";
  if (!title && !status) return nothing;
  const titleButton = onTitleClick && title;
  return html`<div class="yc-card-header">
    <div
      class="yc-card-title"
      role=${titleButton ? "button" : nothing}
      tabindex=${titleButton ? "0" : nothing}
      @click=${titleButton
        ? (event) => onTitleClick(event.currentTarget)
        : nothing}
      @keydown=${titleButton
        ? (event) => {
            if (!isActivationKey(event)) return;
            event.preventDefault();
            onTitleClick(event.currentTarget);
          }
        : nothing}
    >${title}</div>
    ${status
      ? html`<div class="yc-card-status" role="status">${status}</div>`
      : nothing}
  </div>`;
}

/**
 * The card frame around `body`.
 * @param {HTMLElement} card - the rendering card
 * @param {TemplateResult} body - the card's content (the frame pads it)
 * @param {Object} [options]
 * @param {Function} [options.onTitleClick] - (titleElement) => void; makes the
 *   title a button (the Palette card's "allow title edit")
 */
export function cardShell(card, body, { onTitleClick } = {}) {
  return html`<ha-card
    class=${card._showCardBackground ? "yc-card" : "yc-card yc-card-plain"}
    >${cardHeader(card, onTitleClick)}<div class="yc-card-body">${body}</div></ha-card
  >`;
}

/**
 * The whole card as one message (no lamp chosen, lamp not found, …) in the
 * same frame, so the card keeps its title and background.
 */
export function cardNotice(card, message, detail = "") {
  return cardShell(
    card,
    html`<div class="yc-card-notice" role="status">
      ${message}${detail
        ? html`<div class="yc-card-notice-detail">${detail}</div>`
        : nothing}
    </div>`,
  );
}

/** cardNotice for a configured lamp Home Assistant does not know. */
export function lampNotFoundNotice(card, entityId) {
  return cardNotice(
    card,
    `Lamp not found: ${entityId}`,
    "Check the card configuration: the lamp may have been removed or renamed.",
  );
}

/** One line inside a card's body while its lamp is unavailable. */
export function lampUnavailableLine() {
  return html`<div class="yc-card-muted" role="status">
    ${NOTICE.unavailable}
  </div>`;
}
