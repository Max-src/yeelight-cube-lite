export function modeCollectionKey(kind, targets) {
  return `yeelight-${kind}-collections:${[...new Set(targets)].sort().join(",")}`;
}

// Rotation interval: stored as whole seconds in `config.rotation_interval`,
// edited as a value + unit (seconds → days) in the card editors.
export const ROTATION_INTERVAL_UNITS = [
  { unit: "seconds", label: "Seconds", seconds: 1 },
  { unit: "minutes", label: "Minutes", seconds: 60 },
  { unit: "hours", label: "Hours", seconds: 3600 },
  { unit: "days", label: "Days", seconds: 86400 },
];

export function rotationIntervalSeconds(config) {
  return Math.max(10, Math.min(604800, Number(config.rotation_interval) || 60));
}

export function rotationIntervalMs(config) {
  return rotationIntervalSeconds(config) * 1000;
}

// Split whole seconds into the largest unit that represents them exactly.
export function rotationIntervalParts(seconds) {
  seconds = Math.max(1, Math.round(Number(seconds) || 60));
  for (const { unit, seconds: size } of [
    ...ROTATION_INTERVAL_UNITS,
  ].reverse()) {
    if (seconds >= size && seconds % size === 0)
      return { value: seconds / size, unit };
  }
  return { value: seconds, unit: "seconds" };
}

export function formatRotationInterval(seconds) {
  const { value, unit } = rotationIntervalParts(seconds);
  const short = { seconds: "s", minutes: "min", hours: "h", days: "d" };
  return `${value}${short[unit]}`;
}

// Actions shown in the shared Actions row, in their default order. Users can
// reorder and hide them per card via the `action_buttons` config array.
export const ACTION_BUTTON_KEYS = [
  "previous",
  "apply",
  "next",
  "pause_previews",
  "freeze",
  "power",
];

export const ACTION_BUTTON_LABELS = {
  previous: "Previous",
  apply: "Apply",
  next: "Next",
  pause_previews: "Pause previews",
  freeze: "Freeze display",
  power: "Power",
};

// The ordered, de-duplicated list of visible action keys. No `action_buttons`
// override means "show all in the default order".
export function actionButtonOrder(config = {}) {
  const configured = config.action_buttons;
  if (!Array.isArray(configured)) return [...ACTION_BUTTON_KEYS];
  const seen = new Set();
  return configured.filter(
    (key) =>
      ACTION_BUTTON_KEYS.includes(key) &&
      !seen.has(key) &&
      (seen.add(key), true),
  );
}

export function sanitizeModeNames(names, limit = 100) {
  return [
    ...new Set(
      (Array.isArray(names) ? names : [])
        .filter((name) => typeof name === "string")
        .map((name) => name.trim())
        .filter((name) => name && !/^\d+$/.test(name)),
    ),
  ].slice(0, limit);
}

// Advance to the next mode in list order (wrapping). Rotation is always
// in-order; randomness is a one-shot favourites-list shuffle instead.
export function nextRotationMode(names, current) {
  names = sanitizeModeNames(names);
  if (!names.length) return undefined;
  return names[(names.indexOf(current) + 1) % names.length];
}

export class ModeControlsController {
  constructor(adapter) {
    this.adapter = adapter;
    this.listeners = new Set();
    this.favourites = [];
    this.active = false;
    this.busy = false;
    this.paused = false;
    this.frozen = false;
    this.error = "";
    this.token = 0;
    this.context = 0;
  }

  configure(config, targets) {
    // Reset only client-side loop state.  A server-side rotation (if any)
    // belongs to the backend and must NOT be stopped here: this also runs when
    // the card is re-instantiated on a page refresh.
    clearTimeout(this.timer);
    this.token++;
    this.active = false;
    clearTimeout(this.orientationTimer);
    this.context++;
    this.busy = false;
    this.pendingOrientation = null;
    this._rotationPending = false;
    this.error = "";
    this.frozen = false;
    this.config = config;
    this.targets = targets;
    this.key = modeCollectionKey(this.adapter.kind, targets);
    try {
      this.favourites = this.sanitize(
        JSON.parse(globalThis.localStorage?.getItem(this.key) || "{}")
          .favourites,
      );
    } catch {
      this.favourites = [];
    }
    this.notify();
  }

  sanitize(names) {
    return sanitizeModeNames(names);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }

  update() {
    if (this.pendingOrientation === this.adapter.orientation?.()) {
      this.pendingOrientation = null;
      clearTimeout(this.orientationTimer);
    }
    // Switching to a different mode resumes playback, so the freeze indicator
    // returns to its idle state.
    if (this.frozen && this.adapter.current() !== this._frozenKey)
      this.frozen = false;
    // Reflect server-side rotation state so a page reload (or an automation
    // that started/stops rotation) is mirrored in the UI.
    if (this.adapter.rotationActive) {
      const remote = !!this.adapter.rotationActive();
      if (!this._rotationPending && remote !== this.active) {
        this.active = remote;
        this.notify();
      }
      const error = this.adapter.rotationError?.();
      if (error) this.error = error;
    }
    // Observers must not stop a backend-owned loop based on browser-local
    // favourites or transient state: another card may own a different list.
    if (
      !this.adapter.startRotation &&
      this.active &&
      (!this.ready() || this.names().length < 2)
    )
      this.stop();
    this.notify();
  }

  save(names) {
    this.favourites = this.sanitize(names);
    try {
      globalThis.localStorage.setItem(
        this.key,
        JSON.stringify({ favourites: this.favourites }),
      );
    } catch {
      this.error =
        "Browser storage is unavailable; favourites are saved for this session only.";
    }
    this.update();
  }

  // Fisher–Yates shuffle of the favourites list itself, so the new order is
  // what the user sees in the Favourites section and what rotation follows.
  shuffleFavourites(random = Math.random) {
    const shuffled = [...this.favourites];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.min(
        index,
        Math.max(0, Math.floor(random() * (index + 1))),
      );
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    this.save(shuffled);
  }

  toggleFavourite() {
    const current = this.adapter.current();
    if (!current) return;
    this.save(
      this.favourites.includes(current)
        ? this.favourites.filter((name) => name !== current)
        : [...this.favourites, current],
    );
  }

  ready() {
    return this.targets?.length > 0 && this.adapter.ready();
  }

  names() {
    // Rotation always follows the favourites list.
    return this.sanitize(this.favourites).filter((name) =>
      this.adapter.available(name),
    );
  }

  async command(callback, rotating = false) {
    if (!rotating) this.stop();
    if (this.busy || this.adapter.disabled()) return false;
    const context = this.context;
    this.busy = true;
    this.error = "";
    // Any command other than the freeze toggle itself resumes the display, so
    // the frozen indicator mirrors the lamp.
    if (!this._freezing) this.frozen = false;
    this.notify();
    try {
      return (await callback()) !== false && context === this.context;
    } catch (error) {
      if (context === this.context)
        this.error = error.message || "The lamp could not be updated.";
      return false;
    } finally {
      if (context === this.context) {
        this.busy = false;
        this.notify();
      }
    }
  }

  // Freeze the panel on its current frame (renderer mode 64) or, when already
  // frozen, resume by re-applying the current mode (resending the last command).
  async freeze() {
    this._freezing = true;
    try {
      return await this.command(async () => {
        if (this.frozen) {
          const ok = await this.adapter.apply(this.adapter.current());
          if (ok !== false) this.frozen = false;
          return ok;
        }
        if (!this.adapter.freeze || !this.freezable()) return false;
        const ok = await this.adapter.freeze();
        if (ok !== false) {
          this.frozen = true;
          this._frozenKey = this.adapter.current();
        }
        return ok;
      });
    } finally {
      this._freezing = false;
    }
  }

  // Whether the current mode can be frozen (some native effects cannot).
  freezable() {
    return !this.adapter.freezable || this.adapter.freezable();
  }

  select(name, rotating = false) {
    if (!name || !this.adapter.available(name)) return Promise.resolve(false);
    return this.command(() => this.adapter.apply(name), rotating);
  }

  choose(name) {
    if (!name || !this.adapter.available(name)) return Promise.resolve(false);
    return this.command(() =>
      this.adapter.select
        ? this.adapter.select(name)
        : this.adapter.apply(name),
    );
  }

  async orient(target) {
    if (!target || this.busy) return;
    const context = this.context;
    this.pendingOrientation = target;
    const success = await this.command(() =>
      this.adapter.command("set_device_orientation", { orientation: target }),
    );
    if (context !== this.context) return;
    if (!success) this.pendingOrientation = null;
    clearTimeout(this.orientationTimer);
    this.orientationTimer = setTimeout(
      () => {
        if (context !== this.context) return;
        if (this.adapter.orientation() !== target)
          this.error = "Orientation was not confirmed. Try again.";
        this.pendingOrientation = null;
        this.notify();
      },
      success ? 8000 : 0,
    );
    this.notify();
  }

  stop() {
    clearTimeout(this.timer);
    this.token++;
    const wasActive = this.active;
    this.active = false;
    // Only notify the backend when a rotation was actually running; avoids
    // spamming stop_effect_rotation on every state update.
    if (wasActive && this.adapter.stopRotation) this.adapter.stopRotation();
    this.notify();
  }

  async start() {
    const names = this.names();
    if (
      this.busy ||
      !this.ready() ||
      names.length < 2 ||
      globalThis.document?.hidden
    )
      return;
    if (this.adapter.startRotation) {
      // Check the running backend's capability, not the files installed on disk.
      if (this.adapter.rotationSupported && !this.adapter.rotationSupported()) {
        this.error =
          "Effect rotation isn't available in the running backend. Restart Home Assistant after updating, then refresh this page.";
        this.notify();
        return;
      }
      // Server-side rotation: hand the list to the backend and let it drive
      // the lamp. No client timer is involved, so it survives a page refresh.
      const context = this.context;
      this.busy = true;
      this._rotationPending = true;
      this.error = "";
      this.notify();
      let started = true;
      try {
        started =
          (await this.adapter.startRotation(
            names,
            rotationIntervalSeconds(this.config),
          )) !== false;
      } catch (error) {
        started = false;
        this.error = error?.message || "Rotation could not be started.";
      }
      if (context !== this.context) return;
      this.busy = false;
      this._rotationPending = false;
      this.active = started;
      if (!started) {
        if (!this.error)
          this.error =
            this.adapter.rotationError?.() ||
            "Rotation could not be started. Check the lamp is on and the integration is fully loaded.";
      }
      this.notify();
      return;
    }
    this.stop();
    this.active = true;
    this.rotationCurrent = this.adapter.current();
    this.tick(this.token);
  }

  async tick(token) {
    if (!this.active || token !== this.token || this.busy) return;
    const names = this.names();
    if (!this.ready() || names.length < 2 || globalThis.document?.hidden) {
      this.stop();
      return;
    }
    const next = nextRotationMode(
      names,
      this.rotationCurrent ?? this.adapter.current(),
    );
    const success = await this.select(next, true);
    if (!this.active || token !== this.token) return;
    if (!success) this.stop();
    else {
      this.rotationCurrent = next;
      this.timer = setTimeout(
        () => this.tick(token),
        rotationIntervalMs(this.config),
      );
    }
  }

  skip() {
    if (!this.active || this.busy) return;
    if (this.adapter.skipRotation) {
      this.adapter.skipRotation();
      return;
    }
    clearTimeout(this.timer);
    this.tick(this.token);
  }

  disconnect() {
    // Tear down only the client-side loop.  A backend rotation must keep
    // running: disconnect() also fires during page teardown on refresh.
    clearTimeout(this.timer);
    this.token++;
    this.active = false;
    clearTimeout(this.orientationTimer);
    this.context++;
    this.busy = false;
  }
}
