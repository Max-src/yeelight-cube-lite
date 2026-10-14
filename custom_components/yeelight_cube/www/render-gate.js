/**
 * A card's renders held while the user interacts: a slider or the angle
 * dragged, a value typed, a picker open. Each interaction holds the gate
 * under its own name, so overlapping ones end independently; a render
 * asked for meanwhile (request) happens once, when the last hold ends.
 * The lamp's updates never move a control under the user's hand, and
 * nothing polls for the end of an interaction.
 *
 *   gate.hold("drag");              // pointer down
 *   gate.request();                 // a lamp update: waits
 *   gate.release("drag");           // pointer up: the update renders now
 *   gate.hold("slider", 100);       // held 100 ms more, then released
 *
 * Every card has one (card-base.js `_gate`); it renders through the
 * card's `_renderHeld()`.
 */
export class RenderGate {
  constructor(render) {
    this._render = render;
    this._holds = new Map(); // name -> its release timer, or null
    this._pending = false;
  }

  /** Whether a render waits for the gate to be released. */
  get pending() {
    return this._pending;
  }

  /** Whether `name` holds the gate (without a name: whether anything does). */
  held(name) {
    return name === undefined ? this._holds.size > 0 : this._holds.has(name);
  }

  /** Hold under `name`; with `ms`, released by itself after that time. */
  hold(name, ms) {
    clearTimeout(this._holds.get(name));
    this._holds.set(
      name,
      ms === undefined ? null : setTimeout(() => this.release(name), ms),
    );
  }

  /** End the `name` hold: the waiting render happens if none is left. */
  release(name) {
    if (!this._holds.has(name)) return;
    clearTimeout(this._holds.get(name));
    this._holds.delete(name);
    if (!this._holds.size && this._pending) {
      this._pending = false;
      this._render();
    }
  }

  /** Render now, or once the gate is no longer held. */
  request() {
    if (this._holds.size) {
      this._pending = true;
      return;
    }
    this._pending = false;
    this._render();
  }

  /** Drop every hold and the waiting render (a new configuration, the
   * card removed). */
  clear() {
    for (const timer of this._holds.values()) clearTimeout(timer);
    this._holds.clear();
    this._pending = false;
  }
}
