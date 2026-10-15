import { createPendingValue } from "./pending-value.js";
import { withCallTimeout } from "./card-command-controller.js";

/**
 * A user collection (palettes, pixel arts, favourites) changed here: the list
 * shown until the backend publishes it (pending-value.js), and the queue of
 * the collection's service calls.
 * - record(items): the list just changed, shown at once; returns the
 *   operation (rollback takes it back only if nothing newer replaced it)
 * - observe(items, count): the published list arrived: the list to show.
 *   Confirmed only by the complete list (`count` items) with that content;
 *   an older list never takes it back
 * - after `graceMs` unconfirmed (a failed or mismatched echo) it is dropped
 *   and `onExpire()` asks the owner to show the published list again
 */
export class CollectionState {
  constructor(graceMs = 5000, { onExpire } = {}) {
    this.graceMs = graceMs;
    this.context = 0;
    this.queue = Promise.resolve();
    this._pending = createPendingValue({
      timeoutMs: graceMs,
      matches: ({ items, count }, operation) =>
        items.length === count &&
        JSON.stringify(items) === JSON.stringify(operation.items),
      onExpire: () => onExpire?.(),
    });
  }

  /** The operation shown ({ items }), or null when none waits. */
  get pending() {
    return this._pending.value;
  }

  record(items) {
    const operation = { items: structuredClone(items) };
    this._pending.set(operation);
    return operation;
  }

  observe(items, count = items.length) {
    this._pending.settle({ items, count });
    return this.pending?.items ?? items;
  }

  rollback(operation) {
    if (!operation || this.pending !== operation) return false;
    this._pending.clear();
    return true;
  }

  reset() {
    this._pending.clear();
    this.context++;
  }

  execute(hass, service, data) {
    const context = this.context;
    const payload = structuredClone(data);
    const job = this.queue.then(async () => {
      if (context !== this.context) return false;
      try {
        // Like the cards' command queue: a call never answered fails after
        // CALL_TIMEOUT_MS, so it cannot hold up the next ones.
        await withCallTimeout(
          hass.callService("yeelight_cube", service, payload),
          `yeelight_cube.${service}`,
        );
      } catch (error) {
        if (context === this.context) this.context++;
        throw error;
      }
      return context === this.context;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
