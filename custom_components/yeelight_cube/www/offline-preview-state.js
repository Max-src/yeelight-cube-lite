import { getTargetEntities } from "./service-call-utils.js";

export function previewOnly(card) {
  const targets = getTargetEntities(card.config || {});
  return (
    !targets.length ||
    targets.some((entity) => {
      const state = card._hass?.states?.[entity];
      return !state || ["unknown", "unavailable"].includes(state.state);
    })
  );
}

export function previewAttributes(card, defaults = {}) {
  const entity = getTargetEntities(card.config || {})[0];
  const state = card._hass?.states?.[entity];
  card._previewSnapshots ||= new Map();
  if (state && !["unknown", "unavailable"].includes(state.state))
    card._previewSnapshots.set(entity, state.attributes || {});
  if (!previewOnly(card)) return state?.attributes || {};
  return {
    ...defaults,
    ...card._previewSnapshots.get(entity),
    ...state?.attributes,
    ...card._offlinePreviewDraft,
  };
}

export function setPreviewAttributes(card, attributes) {
  card._offlinePreviewDraft = { ...card._offlinePreviewDraft, ...attributes };
}
