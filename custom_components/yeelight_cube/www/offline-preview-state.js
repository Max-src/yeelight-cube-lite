import { availableTargets, getTargetEntities } from "./service-call-utils.js";

// The card shows (and edits) a preview only while none of its lamps is
// available; while one is, it controls the lamps (availableTargets).
export function previewOnly(card) {
  return !availableTargets(card._hass, card.config || {}).length;
}

export function previewAttributes(card, defaults = {}) {
  // The lamp the card shows (card-base _primaryEntity).
  const entity = card._primaryEntity?.() ?? getTargetEntities(card.config || {})[0];
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
