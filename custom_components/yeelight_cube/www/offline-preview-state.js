import { availableTargets, getTargetEntities } from "./service-call-utils.js";

// The card shows (and edits) a preview only while none of its lamps is
// available; while one is, it controls the lamps (availableTargets).
export function previewOnly(card) {
  return !availableTargets(card._hass, card.config || {}).length;
}

const NO_DEFAULTS = Object.freeze({});

// The lamp the card shows (card-base _primaryEntity).
const shownEntity = (card) =>
  card._primaryEntity?.() ?? getTargetEntities(card.config || {})[0];

/** Remember what the card's lamp shows while it is available: the preview
 * starts from it once the lamp goes offline. Called from `set hass`. */
export function notePreviewSnapshot(card) {
  const entity = shownEntity(card);
  const state = card._hass?.states?.[entity];
  if (!state || ["unknown", "unavailable"].includes(state.state)) return;
  card._previewSnapshots ||= new Map();
  if (card._previewSnapshots.get(entity) === state.attributes) return;
  card._previewSnapshots.set(entity, state.attributes || {});
  card._previewSnapshotVersion = (card._previewSnapshotVersion || 0) + 1;
}

/** Follow the card's lamps on a hass push: note what its lamp shows
 * (notePreviewSnapshot) and tell whether its lamps just came back, when its
 * offline picks (setPreviewAttributes) go and the card drops its own. */
export function followPreviewState(card) {
  notePreviewSnapshot(card);
  const offline = previewOnly(card);
  const back = card._wasPreviewOnly === true && !offline;
  card._wasPreviewOnly = offline;
  if (back) card._offlinePreviewDraft = null;
  return back;
}

/**
 * The attributes the card shows: its lamp's, or while none is available
 * (previewOnly) `defaults`, the last ones seen (notePreviewSnapshot), what
 * the lamp still reports and the card's own offline picks, then `offline`.
 * Worked out once per hass push, config and offline pick (the lamp's state
 * noted first): the same object until one changes (never change it).
 */
export function previewAttributes(card, defaults = NO_DEFAULTS, offline = null) {
  const memo = card.__previewAttributes;
  if (
    memo &&
    memo.hass === card._hass &&
    memo.config === card.config &&
    memo.draft === card._offlinePreviewDraft &&
    memo.version === card._previewSnapshotVersion &&
    memo.defaults === defaults &&
    memo.offline === offline
  )
    return memo.value;
  notePreviewSnapshot(card);
  const entity = shownEntity(card);
  const state = card._hass?.states?.[entity];
  const value = !previewOnly(card)
    ? state?.attributes || {}
    : {
        ...defaults,
        ...card._previewSnapshots?.get(entity),
        ...state?.attributes,
        ...card._offlinePreviewDraft,
        ...offline,
      };
  card.__previewAttributes = {
    hass: card._hass,
    config: card.config,
    draft: card._offlinePreviewDraft,
    version: card._previewSnapshotVersion,
    defaults,
    offline,
    value,
  };
  return value;
}

export function setPreviewAttributes(card, attributes) {
  card._offlinePreviewDraft = { ...card._offlinePreviewDraft, ...attributes };
}
