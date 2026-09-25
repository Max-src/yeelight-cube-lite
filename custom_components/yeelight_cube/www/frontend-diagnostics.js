const STORAGE_KEY = "yeelight-cube:frontend-diagnostics";
const LIMIT = 40;
const names = [
  "lamp-preview",
  "gradient",
  "draw",
  "palette",
  "color-list-editor",
  "clock",
  "native-effects",
];
const base = new URL(".", import.meta.url).pathname;

function safeText(value) {
  return String(value ?? "")
    .replace(/(?:https?:\/\/[^\s/]+)?(\/[^\s?#]*)[?#][^\s)"']*/g, "$1")
    .slice(0, 2000);
}

function resourcePath(value) {
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin && url.pathname.startsWith(base)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

function install() {
  let previous = null;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored && stored.length < 100000) previous = JSON.parse(stored);
  } catch {}
  const current = {
    started: new Date().toISOString(),
    events: [],
  };
  let enabled = true;

  function cardErrors() {
    const errors = [];
    const roots = [document];
    let inspected = 0;
    while (roots.length && inspected < 10000 && errors.length < LIMIT) {
      const root = roots.pop();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let element;
      while ((element = walker.nextNode()) && inspected++ < 10000) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        if (element.localName === "hui-error-card") {
          const error = element.error;
          errors.push(
            safeText(
              typeof error === "string"
                ? error
                : error?.message ||
                    "Home Assistant error card (message unavailable)",
            ),
          );
          if (errors.length === LIMIT) break;
        }
      }
    }
    return errors;
  }

  function snapshot() {
    return {
      ...current,
      captured: new Date().toISOString(),
      online: navigator.onLine,
      visibility: document.visibilityState,
      navigation: performance.getEntriesByType("navigation")[0]?.type ?? null,
      cards: Object.fromEntries(
        names.map((name) => [
          name,
          !!customElements.get(`yeelight-cube-${name}-card`),
        ]),
      ),
      resources: performance
        .getEntriesByType("resource")
        .filter((entry) => resourcePath(entry.name))
        .slice(-120)
        .map((entry) => ({
          path: resourcePath(entry.name),
          startMs: Math.round(entry.startTime),
          durationMs: Math.round(entry.duration),
          status: entry.responseStatus || null,
          transferBytes: entry.transferSize,
        })),
    };
  }

  function persist() {
    if (!enabled) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    } catch {}
  }

  function record(kind, details = {}) {
    if (!enabled) return;
    current.events.push({ at: new Date().toISOString(), kind, ...details });
    if (current.events.length > LIMIT) current.events.shift();
    persist();
  }

  const onError = (event) => {
    const source = event.filename || event.target?.src || event.target?.href;
    record(event.message ? "javascript-error" : "resource-error", {
      message: safeText(event.message || "Resource could not be loaded"),
      source: resourcePath(source) || safeText(source),
      line: event.lineno || null,
      column: event.colno || null,
      stack: safeText(event.error?.stack),
    });
  };
  const onRejection = (event) =>
    record("unhandled-rejection", {
      message: safeText(event.reason?.message ?? event.reason),
      stack: safeText(event.reason?.stack),
    });
  const onOffline = () => record("offline");
  const onOnline = () => record("online");
  const onPageHide = () => record("pagehide");
  const onVisibility = () => persist();
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);
  record("diagnostics-started");
  for (const name of names) {
    customElements.whenDefined(`yeelight-cube-${name}-card`).then(() => {
      record("card-defined", { card: name });
    });
  }
  const timer = setTimeout(() => record("startup-snapshot"), 10000);

  return {
    report() {
      record("report-requested", { cardErrors: cardErrors() });
      persist();
      return JSON.parse(
        JSON.stringify({ schema: 1, current: snapshot(), previous }),
      );
    },
    clear() {
      current.events.length = 0;
      previous = null;
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
    },
    stop() {
      enabled = false;
      clearTimeout(timer);
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

window.yeelightCubeDiagnostics ||= install();
