import { getTargetEntities } from "./service-call-utils.js";

export function rotationTargets(hass, config, kind, snapshots) {
  return [...new Set(getTargetEntities(config))].map((entity) => {
    const state = hass?.states?.[entity];
    const observed = state?.attributes?.effect_rotation;
    const statusUnavailable =
      !observed && (!state || ["unavailable", "unknown"].includes(state.state));
    if (observed) snapshots?.set(entity, { ...observed });
    else if (!statusUnavailable) snapshots?.delete(entity);
    const rotation =
      observed || (statusUnavailable ? snapshots?.get(entity) : null);
    const matches = rotation?.kind === kind;
    return {
      entity,
      name: state?.attributes?.friendly_name || entity,
      active: matches && rotation.active === true,
      statusUnavailable,
      waitingForReconnect: matches && rotation.waiting_for_reconnect === true,
      error: matches ? rotation.error || "" : "",
      retryAttempt: matches ? rotation.retry_attempt || 0 : 0,
      retryAt: matches ? rotation.retry_at : null,
      canRetry:
        matches &&
        !!rotation.error &&
        !rotation.active &&
        !rotation.waiting_for_reconnect &&
        state?.state === "on" &&
        rotation.items?.length >= 2,
      items: matches ? rotation.items || [] : [],
      interval: matches ? rotation.interval : null,
    };
  });
}

export async function retryFailedRotations(card, kind) {
  const targets = rotationTargets(card._hass, card.config, kind).filter(
    (target) => target.canRetry,
  );
  if (!targets.length) return false;
  const results = await Promise.all(
    targets.map((target) =>
      card._commands.execute(
        card._hass,
        { entity: target.entity },
        "start_effect_rotation",
        { kind, items: rotationItems(target.items), interval: target.interval },
      ),
    ),
  );
  return results.every(Boolean);
}

function rotationItems(items) {
  // The exposed rotation attribute stores a null color for non-custom modes;
  // the service schema rejects a null color, so omit the key when empty.
  return items.map(({ color, ...rest }) =>
    Array.isArray(color) && color.length ? { ...rest, color } : rest,
  );
}
