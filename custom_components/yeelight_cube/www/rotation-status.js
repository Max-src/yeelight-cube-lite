import { getTargetEntities } from "./service-call-utils.js";

export function rotationTargets(hass, config, kind) {
  return [...new Set(getTargetEntities(config))].map((entity) => {
    const state = hass?.states?.[entity];
    const rotation = state?.attributes?.effect_rotation;
    const matches = rotation?.kind === kind;
    return {
      entity,
      name: state?.attributes?.friendly_name || entity,
      active: matches && rotation.active === true,
      error: matches ? rotation.error || "" : "",
      retryAttempt: matches ? rotation.retry_attempt || 0 : 0,
      retryAt: matches ? rotation.retry_at : null,
      canRetry:
        matches &&
        !!rotation.error &&
        !rotation.active &&
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
        { kind, items: target.items, interval: target.interval },
      ),
    ),
  );
  return results.every(Boolean);
}
