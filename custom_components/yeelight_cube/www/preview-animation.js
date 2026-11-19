// The animated previews' shared controller: the Lamp Preview card's matrix,
// the Clock card's previews and the Native Effects card's. What each of them
// needs, once:
//   • its loop (createRafLoop: one requestAnimationFrame for the whole page,
//     paused while the tab is hidden), running only while the card is on
//     screen: scrolled away, it stops, and starts again when back;
//   • its clock (PreviewClock): the seconds an animation has run, held while
//     the lamp's display is frozen and going on from there once it resumes;
//   • the frames the lamp's stream sends (stream-frames.js), subscribed only
//     while the card is on screen;
//   • the paint skipped when nothing changed: the same render of an effect,
//     the same streamed frame at the same brightness.
import { createRafLoop, createVisibilityTracker } from "./matrix-animator.js";
import { acquireStreamFrames } from "./stream-frames.js";
import { RENDER_SECONDS } from "./lamp-timing.js";

/** An animation's seconds, advanced by `advance(frozen)` each frame: held
 * while frozen, and going on from the held moment afterwards (the frozen
 * lamp holds its frame and resumes from it). `maxStep` caps the time one
 * frame adds (a card that stopped painting for a while goes on smoothly). */
export class PreviewClock {
  constructor({ maxStep = Infinity, now = () => performance.now() } = {}) {
    this.maxStep = maxStep;
    this.now = now;
    this.elapsed = 0;
    this.last = null;
    this.frozen = false;
  }

  /** Advance to now (not while frozen) and return the seconds. */
  advance(frozen = false, now = this.now()) {
    if (this.last != null && !frozen)
      this.elapsed += Math.min(this.maxStep, Math.max(0, now - this.last)) / 1000;
    this.last = now;
    this.frozen = frozen;
    return this.elapsed;
  }

  /** Start again from 0 (a new effect, direction, orientation...). */
  reset() {
    this.elapsed = 0;
    this.last = null;
    this.frozen = false;
  }
}

/**
 * A card's animated previews. `onFrame(due)` paints them: due = false on the
 * frames between the minimum interval's, while `smoothWhen()` says a preview
 * shows every render of the lamp (createRafLoop). `onShown()` is called when
 * the card comes back on screen (repaint what it shows now).
 */
export class AnimatedPreview {
  constructor(host, { onFrame, minIntervalMs = 100, smoothWhen, onShown } = {}) {
    this.host = host;
    this.onShown = onShown;
    this._loop = createRafLoop((now, due) => onFrame(due), {
      minIntervalMs,
      smoothWhen,
    });
    this._wanted = false;
    this._visibility = null;
    this._stream = null;
    this._painted = null;
    this._render = null;
  }

  /** Whether the card is on screen (always, before it is observed or
   * without IntersectionObserver). */
  get onScreen() {
    return this._visibility ? this._visibility.onScreen : true;
  }

  /** Whether the loop runs (the card on screen and animating). */
  get running() {
    return this._loop.running;
  }

  /** Whether the card wants its previews animated (start until stop). */
  get wanted() {
    return this._wanted;
  }

  /** Animate while the card is on screen. */
  start() {
    this._wanted = true;
    this._observe();
    if (this.onScreen) this._loop.start();
  }

  /** Stop animating; the streamed frames are released. */
  stop() {
    this._wanted = false;
    this._loop.stop();
    this.releaseStream();
    this._painted = null;
    this._render = null;
  }

  /** The card left the page: stop, and stop watching it. */
  disconnect() {
    this.stop();
    this._visibility?.disconnect();
    this._visibility = null;
  }

  _observe() {
    if (this._visibility || !this.host) return;
    this._visibility = createVisibilityTracker(this.host, {
      onChange: (onScreen) => {
        if (!onScreen) {
          // Off screen: no frame painted, none unpacked or even received.
          this._loop.stop();
          this.releaseStream();
          return;
        }
        if (!this._wanted) return;
        this._painted = null;
        this._render = null;
        this._loop.start();
        this.onShown?.();
      },
    });
    this._visibility.connect();
  }

  /** The frame the lamp `entityId`'s stream sent last while it streams (and
   * the card is on screen), else null: the preview draws the effect itself. */
  streamed(connection, entityId) {
    if (!connection || !entityId || !this.onScreen) return null;
    const current = this._stream;
    if (!current || current.entityId !== entityId || current.connection !== connection) {
      current?.release();
      this._stream = { entityId, connection, ...acquireStreamFrames(connection, entityId) };
    }
    return this._stream.latest();
  }

  /** The streamed frames are no longer shown. */
  releaseStream() {
    this._stream?.release();
    this._stream = null;
  }

  /** Whether `values` (a frame, its brightness...) are those painted last:
   * the paint is skipped. Else they are remembered as painted. */
  samePaint(...values) {
    const painted = this._painted;
    if (painted?.length === values.length && painted.every((value, index) => value === values[index]))
      return true;
    this._painted = values;
    return false;
  }

  /** The paint is to be done again whatever it shows (new dots...). */
  forgetPaint() {
    this._painted = null;
    this._render = null;
  }

  /** due = false (a frame between the interval's): whether the lamp's render
   * at `seconds` is the one painted last, so the display, refreshing faster
   * than the lamp renders, keeps it. */
  sameRender(seconds, due) {
    const render = Math.floor(seconds / RENDER_SECONDS);
    if (!due && render === this._render) return true;
    this._render = render;
    return false;
  }
}
