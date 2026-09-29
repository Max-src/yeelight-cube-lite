import {
  callServiceOnTargetEntities,
  getTargetEntities,
} from "./service-call-utils.js";

/** Serial service transport shared by every card: one instance per card (or
 * per independent control group) keeps its calls in order. Reset invalidates
 * queued work and results from the previous configuration; it cannot cancel an
 * in-flight HA call. Domain adapters build payloads. This class owns transport
 * busy/error state.
 *
 * - execute: resolves true/false, for controls that show `busy`/`error`.
 * - request: rejects on failure, for multi-step flows in a try/catch.
 * - call: the same for calls that don't target the card's lamps.
 */
/** Result of a coalesced request that was skipped because a newer one with
 * the same key replaced it. Distinct from success: it was never sent, so
 * callers must not treat it as applied (nor as a failure to report). */
export const SUPERSEDED = "superseded";

export class CardCommandController {
  constructor(notify = () => {}, send = callServiceOnTargetEntities) {
    this.notify = notify;
    this.send = send;
    this.context = 0;
    this.pending = 0;
    this.error = "";
    this.queue = Promise.resolve();
  }

  get busy() {
    return this.pending > 0;
  }

  reset() {
    this.context++;
    this.pending = 0;
    this.error = "";
    this.notify();
  }

  /**
   * @param {Object} [options]
   * @param {string} [options.coalesce] - requests sharing this key replace each
   *   other while queued: when one reaches the front of the queue and a newer
   *   one with the same key is already waiting, it is skipped and resolves
   *   SUPERSEDED, so quick successive picks only send the latest.
   */
  async execute(
    hass,
    config,
    service,
    data = {},
    domain = "yeelight_cube",
    { coalesce } = {},
  ) {
    try {
      return await this.request(hass, config, service, data, {
        domain,
        coalesce,
      });
    } catch {
      return false;
    }
  }

  /**
   * Like execute, for flows that chain several steps in a try/catch: resolves
   * true (sent), false (dropped: no lamp, or the configuration changed) or
   * SUPERSEDED, and rejects with the service error when the call fails. The
   * error is still recorded in `error`. Home Assistant already shows a toast
   * for a failed service call, so callers only report errors of their own.
   * @param {Object} [options]
   * @param {string} [options.domain="yeelight_cube"]
   * @param {string} [options.coalesce] - see execute.
   */
  request(hass, config, service, data = {}, options = {}) {
    if (!hass || !getTargetEntities(config).length)
      return Promise.resolve(false);
    const targets = { target_entities: [...getTargetEntities(config)] };
    const { domain = "yeelight_cube" } = options;
    return this._enqueue(
      (payload) => this.send(hass, targets, service, payload, { domain }),
      data,
      options,
    );
  }

  /**
   * Queue a call that is not sent to the card's lamps: refreshing a sensor
   * (homeassistant.update_entity), a collection service that has no target,
   * or a call on one explicit entity_id given in `data`. Same results as
   * request, so it stays ordered after the lamp command it follows.
   */
  call(hass, domain, service, data = {}, options = {}) {
    if (!hass) return Promise.resolve(false);
    return this._enqueue(
      (payload) => hass.callService(domain, service, payload),
      data,
      options,
    );
  }

  async _enqueue(send, data, { coalesce } = {}) {
    const context = this.context;
    this._latest ||= {};
    const generation = coalesce
      ? (this._latest[coalesce] = (this._latest[coalesce] || 0) + 1)
      : 0;
    const payload = structuredClone(data);
    this.error = "";
    this.pending++;
    this.notify();
    const job = this.queue.then(async () => {
      if (context !== this.context) return false;
      if (coalesce && this._latest[coalesce] !== generation) return SUPERSEDED;
      await send(payload);
      return context === this.context;
    });
    this.queue = job.catch(() => {});
    try {
      return await job;
    } catch (error) {
      if (context !== this.context) return false;
      this.error = error?.message || "The lamp could not be updated.";
      throw error;
    } finally {
      if (context === this.context) {
        this.pending--;
        this.notify();
      }
    }
  }
}
