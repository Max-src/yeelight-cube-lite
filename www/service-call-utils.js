/**
 * Shared utility for calling Yeelight Cube Lite services on multiple target entities.
 *
 * Sends a SINGLE service call with entity_id as a list so the Python backend
 * can dispatch to all lamps in parallel via asyncio.gather.  This avoids the
 * Home Assistant WebSocket serialisation bottleneck where sequential
 * call_service messages would force the second lamp to wait for the first
 * to finish its transition.
 */

/**
 * Call a Yeelight Cube Lite service on every configured target entity.
 *
 * When multiple entities are targeted, they are sent as a list inside ONE
 * service call (`entity_id: ["light.a", "light.b"]`).  The Python handler
 * resolves all targets and runs them concurrently with `asyncio.gather`.
 *
 * @param {Object}   hass        - The Home Assistant `hass` object (provides callService).
 * @param {Object}   config      - Card configuration.  Reads `target_entities` (array)
 *                                  with a fallback to `entity` (single string).
 * @param {string}   serviceName - Service name under the `yeelight_cube` domain.
 * @param {Object}   [serviceData={}] - Extra data to pass alongside `entity_id`.
 * @param {Object}   [options={}]
 * @param {string}   [options.callerTag="ServiceCall"] - Tag for console error messages.
 * @returns {Promise<void>}
 */
export async function callServiceOnTargetEntities(
  hass,
  config,
  serviceName,
  serviceData = {},
  options = {},
) {
  const { callerTag = "ServiceCall" } = options;

  const targetEntities =
    config.target_entities || (config.entity ? [config.entity] : []);

  if (targetEntities.length === 0) {
    console.warn(
      `[${callerTag}] No target entities configured for ${serviceName}`,
    );
    return;
  }

  // Send ONE service call with all entity_ids as a list.
  // The Python backend resolves them all and runs asyncio.gather
  // so different lamps execute truly in parallel.
  const entityIdValue =
    targetEntities.length === 1 ? targetEntities[0] : targetEntities;

  const payload = {
    ...serviceData,
    entity_id: entityIdValue,
  };

  try {
    window.__YEELIGHT_DRAW_DEBUG_LAST_SERVICE_CALL = {
      domain: "yeelight_cube",
      service: serviceName,
      data: payload,
      callerTag,
      timestamp: new Date().toISOString(),
    };
    console.error(
      `[${callerTag}] Dispatching yeelight_cube.${serviceName}`,
      payload,
    );
    await hass.callService("yeelight_cube", serviceName, payload);
  } catch (error) {
    console.error(
      `[${callerTag}] Error calling ${serviceName} for ${JSON.stringify(entityIdValue)}:`,
      error,
    );
  }
}
