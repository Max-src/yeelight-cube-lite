import assert from "node:assert/strict";
import test from "node:test";

// Minimal DOM stand-ins: the dispatcher only needs Element, attributes,
// getRootNode() and event.composedPath().
class FakeElement {
  constructor(attrs = {}, root = null) {
    this.attrs = attrs;
    this.root = root;
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  getRootNode() {
    return this.root;
  }
}
globalThis.Element = FakeElement;
const { bindHostEvents, hostEventAttrs } = await import(
  "../custom_components/yeelight_cube/www/host-events.js"
);

function setup(allowed = () => true) {
  const listeners = {};
  const hostListeners = [];
  const root = {
    addEventListener(type, fn, options) {
      assert.equal(options.capture, true, type);
      listeners[type] = fn;
    },
  };
  const calls = [];
  const host = {
    renderRoot: root,
    _slChange: (...args) => calls.push(["_slChange", ...args]),
    _slWheel: (...args) => calls.push(["_slWheel", ...args]),
    handleGridDelete: (...args) => calls.push(["handleGridDelete", ...args]),
    secret: () => calls.push(["secret"]),
    addEventListener: (type, fn, options) => hostListeners.push([type, options]),
  };
  bindHostEvents(host, allowed);
  const fire = (type, path) => {
    const event = {
      type,
      stopped: false,
      composedPath: () => [...path, root],
      stopPropagation() {
        this.stopped = true;
      },
    };
    listeners[type](event);
    return event;
  };
  return { root, host, calls, fire, listeners, hostListeners };
}

test("attributes name handlers and arguments without any script", () => {
  assert.equal(
    hostEventAttrs({ click: "handleGridDelete", input: null }, ["$event", 3]),
    `data-on-click="handleGridDelete" data-args='["$event",3]'`,
  );
});

test("the innermost handler runs once, with the event and its element", () => {
  const { root, calls, fire } = setup();
  const container = new FakeElement({ "data-on-wheel": "_slWheel" }, root);
  const wrapper = new FakeElement({ "data-on-wheel": "_slWheel" }, root);
  const svg = new FakeElement({}, root);
  fire("wheel", [svg, wrapper, container]);
  assert.equal(calls.length, 1); // inline handlers fired twice here
  assert.equal(calls[0][2], wrapper);
});

test("data-args pass values, $event and $element", () => {
  const { root, calls, fire } = setup();
  const button = new FakeElement(
    { "data-on-click": "handleGridDelete", "data-args": '["$event",2,"$element"]' },
    root,
  );
  fire("click", [button]);
  assert.equal(calls[0][1].type, "click");
  assert.deepEqual(calls[0].slice(2), [2, button]);
});

test("data-stop ends the search and stops the event, like stopPropagation", () => {
  const { root, calls, fire } = setup();
  const item = new FakeElement({ "data-on-click": "handleGridDelete" }, root);
  const del = new FakeElement(
    { "data-on-click": "handleGridDelete", "data-args": "[5]", "data-stop": "click" },
    root,
  );
  const event = fire("click", [del, item]);
  assert.deepEqual(calls, [["handleGridDelete", 5]]);
  assert.equal(event.stopped, true);
  // Without data-stop the event goes on to the card's own listeners.
  assert.equal(fire("click", [item]).stopped, false);
});

test("foreign and unlisted methods never run", () => {
  const { root, calls, fire } = setup((name) => name.startsWith("_sl"));
  const track = new FakeElement({ "data-on-mousedown": "_slChange" }, root);
  const input = new FakeElement({ "data-stop": "mousedown touchstart" }, root);
  assert.equal(fire("mousedown", [input, track]).stopped, true);
  assert.equal(calls.length, 0);
  // Not allowed by this host.
  fire("click", [new FakeElement({ "data-on-click": "secret" }, root)]);
  assert.equal(calls.length, 0);
  // Markup of a nested component (another shadow root) is left alone.
  const nested = new FakeElement({ "data-on-input": "_slChange" }, {});
  fire("input", [nested, track]);
  assert.equal(calls.length, 0);
});

test("real wheel and touch input is routed to the card", () => {
  // Chromium needs element listeners to deliver wheel/touch input at all.
  const { hostListeners } = setup();
  for (const type of ["wheel", "touchstart", "touchmove"])
    assert.ok(
      hostListeners.some(([t, o]) => t === type && o.passive === false),
      type,
    );
});

test("a root is bound once, however often the card reconnects", () => {
  const { host, listeners } = setup();
  const first = listeners.click;
  bindHostEvents(host, () => true);
  assert.equal(listeners.click, first);
});
