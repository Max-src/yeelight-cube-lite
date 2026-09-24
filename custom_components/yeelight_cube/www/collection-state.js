export class CollectionState {
  constructor(graceMs = 5000) {
    this.graceMs = graceMs;
    this.pending = null;
    this.context = 0;
    this.queue = Promise.resolve();
  }

  record(items, now = Date.now()) {
    this.pending = { items: structuredClone(items), timestamp: now };
    return this.pending;
  }

  observe(items, count = items.length, now = Date.now()) {
    if (
      this.pending &&
      (now - this.pending.timestamp > this.graceMs ||
        (items.length === count &&
          JSON.stringify(items) === JSON.stringify(this.pending.items)))
    )
      this.pending = null;
    return this.pending?.items ?? items;
  }

  rollback(operation) {
    if (!operation || this.pending !== operation) return false;
    this.pending = null;
    return true;
  }

  reset() {
    this.pending = null;
    this.context++;
  }

  execute(hass, service, data) {
    const context = this.context;
    const payload = structuredClone(data);
    const job = this.queue.then(async () => {
      if (context !== this.context) return false;
      try {
        await hass.callService("yeelight_cube", service, payload);
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
