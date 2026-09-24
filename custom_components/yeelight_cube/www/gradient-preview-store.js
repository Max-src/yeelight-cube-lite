export class GradientPreviewStore {
  constructor(connection) {
    this.connection = connection;
    this.caches = new Map();
    this.listeners = new Map();
    this.requests = new Map();
    this.subscription = null;
  }

  cache(entityId) {
    if (!this.caches.has(entityId)) {
      this.caches.set(entityId, {
        data: null,
        timestamp: 0,
        responseHash: null,
      });
    }
    return this.caches.get(entityId);
  }

  subscribe(entityId, notify) {
    const listeners = this.listeners.get(entityId) || new Set();
    this.listeners.set(entityId, listeners);
    listeners.add(notify);
    this.connect().catch(() => {});
    if (this.cache(entityId).data) {
      queueMicrotask(() => {
        if (listeners.has(notify)) notify();
      });
    }
    return () => {
      if (!listeners.delete(notify)) return;
      if (!listeners.size) this.listeners.delete(entityId);
      if (!this.listeners.size) {
        const subscription = this.subscription;
        this.subscription = null;
        subscription?.ready
          .then((unsubscribe) => unsubscribe())
          .catch(() => {});
      }
    };
  }

  connect() {
    if (this.subscription) return this.subscription.ready;
    const subscription = {};
    this.subscription = subscription;
    subscription.ready = Promise.resolve()
      .then(() =>
        this.connection.subscribeEvents((event) => {
          if (this.subscription !== subscription) return;
          const data = event.data;
          const entityId = data?.entity_id;
          if (!entityId) return;
          const cache = this.cache(entityId);
          const hash = JSON.stringify(data);
          if (cache.responseHash === hash) return;
          cache.data = data;
          cache.responseHash = hash;
          cache.timestamp = Date.now();
          for (const notify of this.listeners.get(entityId) || []) notify();
        }, "yeelight_cube_gradient_preview_response"),
      )
      .catch((error) => {
        if (this.subscription === subscription) this.subscription = null;
        throw error;
      });
    return subscription.ready;
  }

  request(hass, entityId) {
    if (this.requests.has(entityId)) return this.requests.get(entityId);
    const request = this.connect()
      .then(() => {
        if (!this.listeners.has(entityId)) return;
        this.cache(entityId).timestamp = Date.now();
        return hass.callService("yeelight_cube", "preview_gradient_modes", {
          entity_id: entityId,
        });
      })
      .finally(() => {
        if (this.requests.get(entityId) === request)
          this.requests.delete(entityId);
      });
    this.requests.set(entityId, request);
    return request;
  }
}

const stores = new WeakMap();

export function gradientPreviewStore(connection) {
  if (!stores.has(connection))
    stores.set(connection, new GradientPreviewStore(connection));
  return stores.get(connection);
}
