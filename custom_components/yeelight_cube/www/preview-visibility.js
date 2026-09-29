/**
 * Which preview tiles are on screen, kept across re-renders.
 *
 * A card re-renders often (new selection, state update). Rebuilding an
 * IntersectionObserver each time re-observed every tile and forgot what was
 * already known to be visible. One observer is kept instead: each render
 * passes the tiles now in the DOM, new ones are observed, removed ones are
 * released, and unchanged tiles keep their visibility.
 */
export class PreviewVisibility {
  /**
   * @param {Object} [options]
   * @param {string} [options.rootMargin="0px"]
   * @param {Function|null} [options.Observer] - IntersectionObserver class;
   *   without one (old browsers, tests) every tracked tile counts as visible.
   */
  constructor({ rootMargin = "0px", Observer = null } = {}) {
    this.rootMargin = rootMargin;
    this.Observer = Observer;
    this.visible = new Set();
    this._observed = new Set();
    this._observer = null;
  }

  /**
   * Track exactly `nodes`. The observer reports a new tile a frame later at
   * best, so `seed(node)` decides whether it counts as visible meanwhile
   * (default: yes), letting the caller paint it before the browser shows it.
   */
  track(nodes, seed = () => true) {
    const next = new Set(nodes);
    for (const node of this._observed) {
      if (next.has(node)) continue;
      this._observer?.unobserve(node);
      this.visible.delete(node);
    }
    if (!this.Observer) {
      next.forEach((node) => this.visible.add(node));
      this._observed = next;
      return;
    }
    this._observer ||= new this.Observer(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.visible.add(entry.target);
          else this.visible.delete(entry.target);
        }
      },
      { root: null, rootMargin: this.rootMargin, threshold: 0 },
    );
    for (const node of next) {
      if (this._observed.has(node)) continue;
      if (seed(node)) this.visible.add(node);
      this._observer.observe(node);
    }
    this._observed = next;
  }

  /** Stop observing everything (card left the page). */
  disconnect() {
    this._observer?.disconnect();
    this._observer = null;
    this._observed = new Set();
    this.visible = new Set();
  }
}
