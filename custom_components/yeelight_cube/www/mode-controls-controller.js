import {
  normalizeFavourite,
  favouriteId,
  sanitizeFavourites,
  ModeSelectionState,
} from "./mode-selection.js";
import {
  DEFAULT_ACTION_BUTTON_STYLE,
  DEFAULT_BUTTON_CONTENT_MODE,
} from "./action-button-utils.js";
import { SUPERSEDED } from "./card-command-controller.js";
export {
  normalizeFavourite,
  favouriteId,
  sanitizeFavourites,
} from "./mode-selection.js";

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
  "next",
  "random",
  "freeze",
  "refresh",
  "power",
];

export const ACTION_BUTTON_LABELS = {
  previous: "Previous",
  next: "Next",
  random: "Random",
  freeze: "Freeze display",
  refresh: "Refresh",
  power: "Power",
};

// The ordered, de-duplicated list of visible action keys. No `action_buttons`
// override means "show all in the default order".
export function actionButtonOrder(config = {}, keys = ACTION_BUTTON_KEYS) {
  const configured = config.action_buttons;
  if (!Array.isArray(configured)) return [...keys];
  const seen = new Set();
  return configured.filter(
    (key) => keys.includes(key) && !seen.has(key) && (seen.add(key), true),
  );
}

export function lampActionConfig(config = {}) {
  const result = {
    ...config,
    actions_buttons_style:
      config.actions_buttons_style ||
      config.buttons_style ||
      config.reconnect_button_style ||
      DEFAULT_ACTION_BUTTON_STYLE,
    actions_buttons_content_mode:
      config.actions_buttons_content_mode ||
      config.buttons_content_mode ||
      DEFAULT_BUTTON_CONTENT_MODE,
  };
  if (!Array.isArray(result.action_buttons)) {
    result.action_buttons = [
      ...(config.show_force_refresh_button !== false ? ["refresh"] : []),
      ...(config.show_power_toggle !== false ? ["power"] : []),
    ];
  }
  delete result.show_force_refresh_button;
  delete result.show_power_toggle;
  return result;
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
  /** Adapter contract: items/current/available describe the domain; apply and
   * applyFavourite return false on failure; frame returns top-origin RGB pixels.
   * Cards resolve colour drafts, mode-selection owns identity/pending echoes,
   * card-command-controller owns service transport, and UI modules own DOM.
   * Backend rotation remains entity-owned and is never stopped by observation.
   */
  constructor(adapter) {
    this.adapter = adapter;
    this.selection = new ModeSelectionState();
    this.listeners = new Set();
    this.favourites = [];
    this.active = false;
    this.busy = false;
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
    this.selectedFavourite = null;
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
    return sanitizeFavourites(names);
  }

  favouriteKeys() {
    return sanitizeFavourites(this.favourites).map(
      (favourite) => favourite.key,
    );
  }

  captureFavourite(key = this.adapter.current?.()) {
    return normalizeFavourite({
      key,
      colorMode: this.adapter.currentColorMode?.() || "normal",
      color: this.adapter.currentColor?.(),
    });
  }

  currentFavourite() {
    return this.selectedFavourite || this.captureFavourite();
  }

  get selectedFavourite() {
    return this.selection.pending;
  }

  set selectedFavourite(value) {
    this.selection.pending = normalizeFavourite(value);
  }

  hasFavourite(key, colorMode, color = this.adapter.currentColor?.()) {
    return sanitizeFavourites(this.favourites).some(
      (favourite) =>
        favourite.key === key &&
        (colorMode == null ||
          favouriteId(favourite) === favouriteId({ key, colorMode, color })),
    );
  }

  notify() {
    this._lastSnapshot = this.snapshot();
    this.listeners.forEach((listener) => listener());
  }

  // Flat list of everything the listeners (mode-controls-ui, style-browser-ui
  // and the cards' favourite-star markers) render from. `update()` runs on
  // every Home Assistant state push, so it compares this cheap snapshot and
  // only notifies when something visible actually changed. Returns null when
  // the adapter cannot answer yet, which always counts as a change.
  snapshot() {
    const adapter = this.adapter;
    try {
      const values = [
        this.config,
        this.busy,
        this.active,
        this.frozen,
        this.error,
        this.pendingOrientation,
        this._rotationPending,
        this.favourites,
        this.favourites.length,
        this.selectedFavourite ? favouriteId(this.selectedFavourite) : "",
        adapter.current?.(),
        adapter.currentColorMode?.(),
        String(adapter.currentColor?.() ?? ""),
        adapter.disabled?.(),
        adapter.on?.(),
        adapter.orientation?.(),
        this.ready(),
        adapter.previewOnly?.(),
        adapter.freezable?.(),
        this.favourites
          .map((favourite) => (adapter.available(favourite.key) ? 1 : 0))
          .join(""),
      ];
      const itemsKey = (items) =>
        (items || [])
          .map((item) => `${item.key}\u0000${item.title}`)
          .join("\u0001");
      values.push(itemsKey(adapter.items?.()));
      if (adapter.navigationItems)
        values.push(itemsKey(adapter.navigationItems()));
      for (const target of adapter.rotationTargets?.() || [])
        values.push(
          target.entity,
          target.name,
          target.active,
          target.statusUnavailable,
          target.waitingForReconnect,
          target.error,
          target.retryAttempt,
          target.canRetry,
        );
      return values;
    } catch {
      return null;
    }
  }

  // Notify only when the rendered snapshot differs from the last notification.
  notifyIfChanged() {
    const next = this.snapshot();
    const last = this._lastSnapshot;
    if (
      next &&
      last &&
      next.length === last.length &&
      next.every((value, index) => Object.is(value, last[index]))
    )
      return false;
    this.notify();
    return true;
  }

  update() {
    this.selection.observe(this.captureFavourite());
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
      if (!this._rotationPending && remote !== this.active)
        this.active = remote;
      const error = this.adapter.rotationError?.();
      if (
        !error &&
        this._observedRotationError &&
        this.error === this._observedRotationError
      )
        this.error = "";
      if (error) this.error = error;
      this._observedRotationError = error || "";
    }
    // Observers must not stop a backend-owned loop based on browser-local
    // favourites or transient state: another card may own a different list.
    if (
      !this.adapter.startRotation &&
      this.active &&
      (!this.ready() || this.names().length < 2)
    )
      this.stop();
    this.notifyIfChanged();
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
    if (this.busy) return;
    const current = this.currentFavourite();
    if (!current) return;
    // Toggle only the (key, colour mode) pair: a style favourited under one
    // mode can still be added under another, and removing removes just that
    // mode's entry.
    if (
      this.favourites.some((item) => favouriteId(item) === favouriteId(current))
    ) {
      this.save(
        this.favourites.filter(
          (favourite) => favouriteId(favourite) !== favouriteId(current),
        ),
      );
      return;
    }
    this.save([...this.favourites, current]);
  }

  ready() {
    return this.targets?.length > 0 && this.adapter.ready();
  }

  names() {
    // Rotation always follows the favourites list.
    return this.favouriteKeys().filter((name) => this.adapter.available(name));
  }

  rotationItems() {
    // Rotation always follows the favourites list, applying each item in the
    // colour mode that was recorded when it was saved.
    return this.sanitize(this.favourites)
      .filter((favourite) => this.adapter.available(favourite.key))
      .map((favourite) => ({
        name: favourite.key,
        color_mode: favourite.colorMode,
        ...(favourite.color ? { color: favourite.color } : {}),
      }));
  }

  async command(callback, rotating = false) {
    if (this.busy || this.adapter.disabled()) return false;
    if (!rotating) this.stop();
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
    if (this.adapter.previewOnly?.())
      return this.previewSelection(() =>
        this.adapter.select
          ? this.adapter.select(name)
          : this.adapter.apply(name),
      );
    const context = this.context;
    return this.selectQuietly(async () => {
      const success = await (this.adapter.select
        ? this.adapter.select(name)
        : this.adapter.apply(name));
      if (success === false || context !== this.context) return false;
      // Replaced by a newer pick before it was sent: that pick records itself.
      if (success === SUPERSEDED) return SUPERSEDED;
      this.selection.record(
        this.captureFavourite(name),
        this.captureFavourite(),
      );
      return true;
    });
  }

  // Picking a style/effect in the browser is a card-level selection, not a
  // control-row command: it must not mark the controller busy, or the actions,
  // favourites and colour rows would flash disabled until the lamp answers.
  // Service calls are already serialised by the card's command queue.
  // The in-flight rotation start, or null when none (callers only wait when
  // there is one, so ordinary commands keep running synchronously).
  whenIdle() {
    return this._startPending;
  }

  async selectQuietly(callback) {
    if (this.adapter.disabled()) return false;
    const pendingStart = this.whenIdle();
    if (pendingStart) await pendingStart;
    // One listener pass per pick: notifyIfChanged below covers the stop.
    this.stop({ silent: true });
    const context = this.context;
    this.error = "";
    if (!this._freezing) this.frozen = false;
    this.notifyIfChanged();
    try {
      return (await callback()) !== false && context === this.context;
    } catch (error) {
      if (context === this.context) {
        this.error = error.message || "The lamp could not be updated.";
        this.notify();
      }
      return false;
    }
  }

  chooseFavourite(item) {
    const favourite = normalizeFavourite(item);
    if (
      !favourite ||
      !this.adapter.available(favourite.key) ||
      !this.adapter.applyFavourite
    )
      return Promise.resolve(false);
    if (this.adapter.previewOnly?.())
      return this.previewSelection(
        () => this.adapter.applyFavourite(favourite),
        favourite,
      );
    const context = this.context;
    return this.command(async () => {
      const success = await this.adapter.applyFavourite(favourite);
      if (success === false || context !== this.context) return false;
      this.selection.record(favourite, this.captureFavourite());
      return true;
    });
  }

  async previewSelection(select, favourite) {
    const context = this.context;
    if ((await select()) === false || context !== this.context) return false;
    this.selection.record(
      favourite || this.captureFavourite(),
      this.captureFavourite(),
    );
    this.notify();
    return true;
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

  stop({ silent = false } = {}) {
    this.selectedFavourite = null;
    clearTimeout(this.timer);
    this.token++;
    const wasActive =
      this.active ||
      this.adapter
        .rotationTargets?.()
        .some(
          (target) =>
            target.active ||
            target.waitingForReconnect ||
            target.statusUnavailable,
        );
    this.active = false;
    if (wasActive && this.adapter.stopRotation) this.adapter.stopRotation();
    if (!silent) this.notify();
  }

  async refresh() {
    if (
      this.busy ||
      this.adapter.disabled() ||
      !this.adapter.refresh ||
      (this.adapter.on && !this.adapter.on())
    )
      return false;
    const context = this.context;
    this.busy = true;
    this.error = "";
    this.notify();
    try {
      const success = await this.adapter.refresh();
      if (context !== this.context) return false;
      if (success === false) this.error = "The lamp could not be refreshed.";
      else this.frozen = false;
      return success !== false;
    } catch (error) {
      if (context === this.context)
        this.error = error.message || "Refresh failed.";
      return false;
    } finally {
      if (context === this.context) {
        this.busy = false;
        this.notify();
      }
    }
  }

  async retryRotation() {
    if (this.busy || !this.adapter.retryRotation) return;
    const context = this.context;
    this.busy = true;
    this.notify();
    try {
      if (
        (await this.adapter.retryRotation()) === false &&
        context === this.context
      )
        this.error = "Failed lamps could not be restarted.";
    } catch (error) {
      if (context === this.context)
        this.error = error.message || "Retry failed.";
    } finally {
      if (context === this.context) {
        this.busy = false;
        this.notify();
      }
    }
  }

  async start() {
    const items = this.rotationItems();
    if (
      this.busy ||
      !this.ready() ||
      items.length < 2 ||
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
      const token = this.token;
      this.busy = true;
      this._rotationPending = true;
      this.error = "";
      // Commands that stop rotation wait for this start (see whenIdle), so
      // their stop is sent after it and cannot be overtaken by it.
      let finishStart;
      const pending = new Promise((resolve) => (finishStart = resolve));
      this._startPending = pending;
      this.notify();
      let started = true;
      try {
        started =
          (await this.adapter.startRotation(
            items,
            rotationIntervalSeconds(this.config),
          )) !== false;
      } catch (error) {
        started = false;
        this.error = error?.message || "Rotation could not be started.";
      }
      // A newer start (after a reconfigure) owns the marker from now on.
      if (this._startPending === pending) this._startPending = null;
      if (context !== this.context) {
        finishStart();
        return;
      }
      this.busy = false;
      this._rotationPending = false;
      // Stopped while the start was in flight (nothing was active yet, so that
      // stop sent nothing): cancel the rotation that has just started. This is
      // a deliberate cancel, not a failure, so no error is shown.
      if (token !== this.token) {
        if (started) this.adapter.stopRotation?.();
        this.active = false;
        finishStart();
        this.notify();
        return;
      }
      this.active = started;
      finishStart();
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
