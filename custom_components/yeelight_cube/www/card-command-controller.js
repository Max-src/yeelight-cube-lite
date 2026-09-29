import {
  callServiceOnTargetEntities,
  getTargetEntities,
} from "./service-call-utils.js";

/** Serial service transport for both cards. Reset invalidates queued work and
 * results from the previous configuration; it cannot cancel an in-flight HA call.
 * Domain adapters build payloads. This class owns transport busy/error state.
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
    if (!hass || !getTargetEntities(config).length) return false;
    const context = this.context;
    this._latest ||= {};
    const generation = coalesce
      ? (this._latest[coalesce] = (this._latest[coalesce] || 0) + 1)
      : 0;
    const targets = { target_entities: [...getTargetEntities(config)] };
    const payload = structuredClone(data);
    this.error = "";
    this.pending++;
    this.notify();
    const job = this.queue.then(async () => {
      if (context !== this.context) return false;
      if (coalesce && this._latest[coalesce] !== generation) return SUPERSEDED;
      await this.send(hass, targets, service, payload, { domain });
      return context === this.context;
    });
    this.queue = job.catch(() => {});
    try {
      return await job;
    } catch (error) {
      if (context === this.context)
        this.error = error.message || "The lamp could not be updated.";
      return false;
    } finally {
      if (context === this.context) {
        this.pending--;
        this.notify();
      }
    }
  }
}
