// Small shared helpers for user-facing error feedback.
//
// Home Assistant's frontend `hass.callService` already shows a toast when a
// service call fails and then rethrows the websocket error, which is a plain
// `{ code, message }` object rather than an `Error` instance. Errors raised
// locally by the cards (invalid import file, "collection changed" conflicts,
// runtime bugs) are `Error` instances and have not been shown to the user.

/** Show one Home Assistant toast, dispatched from `element` (bubbling, composed). */
export function notify(element, message) {
  const target =
    element && element.isConnected !== false && element.dispatchEvent
      ? element
      : document.querySelector("home-assistant");
  target?.dispatchEvent(
    new CustomEvent("hass-notification", {
      bubbles: true,
      composed: true,
      detail: { message },
    }),
  );
}

/** True when HA's callService has already reported this failure to the user. */
export function isReportedByHass(error) {
  return !!error && typeof error === "object" && !(error instanceof Error);
}

/**
 * Notify about `error` unless HA already did. Shows `message` when given,
 * otherwise the error's own message.
 */
export function notifyUnreported(element, error, message) {
  if (isReportedByHass(error)) return false;
  notify(element, message || error?.message || "Something went wrong.");
  return true;
}
