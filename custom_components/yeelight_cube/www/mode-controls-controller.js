export function modeCollectionKey(kind, targets) {
  return `yeelight-${kind}-collections:${[...new Set(targets)].sort().join(",")}`;
}

export function rotationIntervalMs(config) {
  return (
    Math.max(10, Math.min(3600, Number(config.rotation_interval) || 60)) * 1000
  );
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

export function nextRotationMode(
  names,
  current,
  shuffle = false,
  random = Math.random(),
) {
  names = sanitizeModeNames(names);
  if (!names.length) return undefined;
  if (shuffle) {
    const candidates = names.filter((name) => name !== current);
    return (
      candidates[
        Math.min(
          candidates.length - 1,
          Math.max(0, Math.floor(random * candidates.length)),
        )
      ] || names[0]
    );
  }
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
    this.stop();
    clearTimeout(this.orientationTimer);
    this.context++;
    this.busy = false;
    this.pendingOrientation = null;
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
    if (this.active && (!this.ready() || this.names().length < 2)) this.stop();
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
    const configured =
      this.config.rotation_modes ?? this.config.rotation_effects;
    return this.sanitize(
      this.config.rotation_source === "custom" ? configured : this.favourites,
    ).filter((name) => this.adapter.available(name));
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
    this.active = false;
    this.notify();
  }

  start() {
    if (
      this.busy ||
      !this.ready() ||
      this.names().length < 2 ||
      globalThis.document?.hidden
    )
      return;
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
      this.config.rotation_shuffle === true,
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
    clearTimeout(this.timer);
    this.tick(this.token);
  }

  disconnect() {
    this.stop();
    clearTimeout(this.orientationTimer);
    this.context++;
    this.busy = false;
  }
}
