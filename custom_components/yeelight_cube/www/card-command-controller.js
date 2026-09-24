import {
  callServiceOnTargetEntities,
  getTargetEntities,
} from "./service-call-utils.js";

/** Serial service transport for both cards. Reset invalidates queued work and
 * results from the previous configuration; it cannot cancel an in-flight HA call.
 * Domain adapters build payloads. This class owns transport busy/error state.
 */
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

  async execute(hass, config, service, data = {}, domain = "yeelight_cube") {
    if (!hass || !getTargetEntities(config).length) return false;
    const context = this.context;
    const targets = { target_entities: [...getTargetEntities(config)] };
    const payload = structuredClone(data);
    this.error = "";
    this.pending++;
    this.notify();
    const job = this.queue.then(async () => {
      if (context !== this.context) return false;
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
