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
 * And a line naming the card's lamps Home Assistant no longer knows
 * (renamed or removed) while others still work; when none is left the card
 * shows lampNotFoundNotice instead.
 *
 * The body is padded by the frame (.yc-card-body, the same on every card)
 * and keeps its own layout. The CSS lives in cardLayoutStyles
 * (card-layout-utils.js), which every card includes.
 *
 * `card` is a YeelightCardMixin card (config, _hass, _primaryEntity,
 * _showCardBackground). This module needs Lit, so card-base.js (also loaded
 * by the Node tests) does not import it.
 */
import { html, nothing } from "./lib/lit-all.js";
import { lampAvailable } from "./service-call-utils.js";

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
  const lamp = card._primaryEntity?.();
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

// The card's lamps Home Assistant no longer knows (renamed or removed), or
// shows unavailable, named while the others still work: the card is not
// silently controlling fewer lamps than it shows.
function missingLampsLine(card) {
  const states = card._hass?.states;
  const targets = card._targets || [];
  if (!states || targets.length < 2) return nothing;
  const missing = targets.filter((id) => !states[id]);
  const offline = targets.filter((id) => states[id] && !lampAvailable(states[id]));
  const name = (id) => states[id].attributes?.friendly_name || id;
  // Each line only while some lamp is left (else the card's own notice or
  // its "Lamp unavailable" line says so).
  const missingLine =
    missing.length && missing.length < targets.length
      ? html`<div class="yc-card-muted yc-card-missing" role="status">
          ${missing.length > 1 ? "Lamps" : "Lamp"} not found: ${missing.join(", ")}.
          Renamed or removed? Update this card's lamps.
        </div>`
      : nothing;
  const offlineLine =
    offline.length && missing.length + offline.length < targets.length
      ? html`<div class="yc-card-muted yc-card-offline" role="status">
          ${offline.length > 1 ? "Lamps" : "Lamp"} unavailable: ${offline.map(name).join(", ")}.
          The other lamps are controlled.
        </div>`
      : nothing;
  return html`${missingLine}${offlineLine}`;
}

// A change a lamp of the card failed to apply (refused, or an error; a lamp
// not reached is "unavailable" instead), until a later change succeeds
// (last_command_error, published by the backend).
function failedChangeLine(card) {
  const states = card._hass?.states;
  const failed = (card._targets || [])
    .map((id) => [id, states?.[id]])
    .filter(([, state]) => lampAvailable(state) && state.attributes?.last_command_error);
  if (!failed.length) return nothing;
  return failed.map(([id, state]) => {
    const error = state.attributes.last_command_error;
    const name = failed.length > 1 || (card._targets || []).length > 1
      ? `${state.attributes.friendly_name || id}: `
      : "";
    return html`<div class="yc-card-muted yc-card-failed" role="status">
      ${name}the last change was not applied (${error.message}).
    </div>`;
  });
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
    >${cardHeader(card, onTitleClick)}<div class="yc-card-body">${missingLampsLine(card)}${failedChangeLine(card)}${body}</div></ha-card
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
