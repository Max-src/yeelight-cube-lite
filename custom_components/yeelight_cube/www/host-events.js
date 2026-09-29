/**
 * Delegated events for markup that shared renderers build as HTML strings.
 *
 * Inline handlers (onclick="this.getRootNode().host.x(event)") are script in
 * attributes: a strict Content Security Policy blocks them, and the markup can
 * name any method of the card. Instead an element names its handlers in data
 * attributes and one listener per event type, on the card's shadow root (so
 * event.target stays the real element), calls them:
 *
 *   <button data-on-click="handleGridDelete" data-args='["$event", 3]'
 *           data-stop="click">
 *
 * - The handler is looked up on the element's own shadow-root host (what
 *   `this.getRootNode().host` meant), and only if the host allows it.
 * - Without data-args the handler gets (event, element): `element` is the one
 *   carrying the attribute (inline handlers had it as event.currentTarget).
 *   In data-args, "$event" and "$element" stand for those two.
 * - Only the innermost element handling an event type runs, so nested
 *   controls never fire twice.
 * - The listeners run in the capture phase, so a handler runs before the
 *   card's own listeners on elements around it, as an inline handler on the
 *   element did. data-stop="click" then stops the event there (the inline
 *   `event.stopPropagation()`); on an element without a handler it only stops.
 */
const EVENTS = [
  ["click"],
  ["input"],
  ["change"],
  ["keydown"],
  ["focusin"],
  ["focusout"],
  ["mousedown"],
  ["mouseup"],
  // Handlers call preventDefault (drags, wheel steps): not passive.
  ["touchstart", { passive: false }],
  ["touchend"],
  ["wheel", { passive: false }],
];

/**
 * data-* attributes for `handlers` ({ click: "method" }), optional args and
 * the event types to stop after the handler ran (`stop`: "click", ...).
 */
export function hostEventAttrs(handlers, args, stop) {
  const attrs = Object.entries(handlers)
    .filter(([, method]) => method)
    .map(([type, method]) => `data-on-${type}="${method}"`);
  if (args) attrs.push(`data-args='${JSON.stringify(args)}'`);
  if (stop) attrs.push(`data-stop="${stop}"`);
  return attrs.join(" ");
}

const BOUND = new WeakSet();

/**
 * Listen on the host's shadow root for its delegated events. Call it from
 * connectedCallback (after super.connectedCallback(), which creates the root);
 * it binds once per root.
 * @param {HTMLElement} host
 * @param {(name: string) => boolean} allowed - which methods markup may call
 */
export function bindHostEvents(host, allowed) {
  const root = host.renderRoot || host.shadowRoot;
  if (!root || BOUND.has(root)) return;
  BOUND.add(root);
  for (const [type, options] of EVENTS)
    root.addEventListener(
      type,
      (event) => dispatch(host, root, allowed, event),
      { ...options, capture: true },
    );
  // Chromium only sends wheel and touch input to the page over areas with an
  // element listener for it (a shadow-root listener does not count), so
  // without these no-op listeners a real mouse wheel or finger never reaches
  // the ones above. Not passive: the handlers may call preventDefault.
  for (const type of ["wheel", "touchstart", "touchmove"])
    host.addEventListener(type, () => {}, { passive: false });
}

function dispatch(host, root, allowed, event) {
  const type = event.type;
  for (const node of event.composedPath()) {
    if (node === root) return;
    if (!(node instanceof Element)) continue;
    const method = node.getAttribute(`data-on-${type}`);
    const stops = node.getAttribute("data-stop")?.split(/\s+/).includes(type);
    if (!method && !stops) continue;
    // Markup of a nested component is that component's business.
    if (node.getRootNode() !== root) return;
    if (method && allowed(method) && typeof host[method] === "function") {
      const raw = node.getAttribute("data-args");
      const args = raw
        ? JSON.parse(raw).map((arg) =>
            arg === "$event" ? event : arg === "$element" ? node : arg,
          )
        : [event, node];
      host[method](...args);
    }
    if (stops) event.stopPropagation();
    return;
  }
}
