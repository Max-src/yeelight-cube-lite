import assert from "node:assert/strict";
import test from "node:test";
import {
  openColorPicker,
  closeColorPicker,
  bindColorPicker,
  bindColorPickerTrigger,
  renderColorPicker,
  resolveColorPickerStyle,
} from "../custom_components/yeelight_cube/www/color-picker-utils.js";

function fixture(context) {
  const inputs = [];
  const observers = [];
  const doc = new EventTarget();
  const view = new EventTarget();
  Object.assign(view, {
    scrollX: 10,
    scrollY: 20,
    Event,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  });
  doc.defaultView = view;
  doc.createElement = () => {
    const input = new EventTarget();
    Object.assign(input, {
      style: {},
      setAttribute() {},
      getBoundingClientRect() {
        this.measured = true;
        return {};
      },
      showPopover() {
        this.inTopLayer = true;
      },
      showPicker() {
        assert.equal(this.measured, true);
        this.opened = true;
        this.dispatchEvent(new Event("blur"));
      },
      click() {
        this.clicked = true;
      },
      remove() {
        this.isConnected = false;
      },
    });
    inputs.push(input);
    return input;
  };
  const owner = {
    ownerDocument: doc,
    isConnected: true,
    parentNode: {
      appendChild(input) {
        input.isConnected = true;
      },
    },
    getRootNode: () => doc,
  };
  doc.body = owner.parentNode;
  context.after(() => closeColorPicker(owner));
  return { owner, inputs, doc, view, observers };
}

test("swatch triggers ignore drags but accept clicks and keyboard activation", () => {
  const target = new EventTarget();
  let opens = 0;
  const send = (type, fields = {}) =>
    target.dispatchEvent(Object.assign(new Event(type), fields));
  bindColorPickerTrigger(target, () => {
    throw new Error("stale handler");
  });
  bindColorPickerTrigger(target, () => opens++);
  send("pointerdown", { clientX: 10, clientY: 10 });
  send("pointermove", { clientX: 40, clientY: 10 });
  send("click", { detail: 1 });
  assert.equal(opens, 0);
  send("pointerdown", { clientX: 10, clientY: 10 });
  send("click", { detail: 1 });
  send("click", { detail: 0 });
  assert.equal(opens, 2);
});

test("picker mounts in a rendered shadow root instead of an unslotted parent", (context) => {
  const { owner, inputs, doc } = fixture(context);
  const mounted = [];
  const shadow = {
    host: { getRootNode: () => doc },
    appendChild(input) {
      mounted.push(input);
      input.isConnected = true;
    },
  };
  owner.getRootNode = () => shadow;
  owner.parentNode = {
    appendChild() {
      throw new Error("Unslotted input has no anchor box");
    },
  };
  openColorPicker(owner);
  assert.equal(mounted[0], inputs[0]);
  assert.equal(inputs[0].inTopLayer, true);
});

test("presentations share accessible native inputs and sanitize values", () => {
  for (const style of ["swatch", "chip", "row"]) {
    const markup = renderColorPicker("#123456", style);
    assert.match(markup, new RegExp(`picker-style-${style}`));
    assert.match(markup, /aria-label="Choose colour"/);
    assert.match(markup, /value="#123456"/);
  }
  assert.equal(resolveColorPickerStyle("unknown"), "swatch");
  assert.match(renderColorPicker('" onmouseover="bad'), /value="#ffffff"/);
});

test("blur and change preserve the input for continued native picking", (context) => {
  const { owner, inputs } = fixture(context);
  const values = [];
  let closes = 0;
  openColorPicker(owner, {
    pageX: 70,
    pageY: 90,
    onInput: (value) => values.push(value),
    onClose: () => closes++,
  });
  const input = inputs[0];
  assert.equal(input.opened, true);
  assert.equal(input.inTopLayer, true);
  assert.equal(input.isConnected, true);
  assert.match(input.style.cssText, /left:60px;top:70px/);
  for (const value of ["#123456", "#abcdef"]) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    assert.equal(input.isConnected, true);
  }
  assert.deepEqual(values, ["#123456", "#abcdef"]);
  assert.equal(closes, 1);
});

test("dismissal cleans the input and notifies once", (context) => {
  const { owner, inputs, doc, view, observers } = fixture(context);
  let closes = 0;
  openColorPicker(owner, { onClose: () => closes++ });
  view.dispatchEvent(new Event("focus"));
  assert.equal(inputs[0].isConnected, true);
  doc.dispatchEvent(new Event("pointerdown"));
  closeColorPicker(owner);
  assert.equal(inputs[0].isConnected, false);
  assert.equal(observers[0].disconnected, true);
  assert.equal(closes, 1);
});

test("replacement and cleanup only affect the owning card", (context) => {
  const first = fixture(context);
  const second = fixture(context);
  openColorPicker(first.owner);
  openColorPicker(second.owner);
  openColorPicker(first.owner);
  assert.equal(first.inputs[0].isConnected, false);
  assert.equal(first.inputs[1].isConnected, true);
  closeColorPicker(first.owner);
  assert.equal(second.inputs[0].isConnected, true);
});

test("disconnect and cancellation clean up", (context) => {
  const { owner, inputs, observers } = fixture(context);
  openColorPicker(owner);
  owner.isConnected = false;
  observers[0].callback();
  assert.equal(inputs[0].isConnected, false);
  openColorPicker(owner);
  assert.equal(inputs.length, 1);
  owner.isConnected = true;
  openColorPicker(owner);
  inputs[1].dispatchEvent(new Event("cancel"));
  assert.equal(inputs[1].isConnected, false);
});

test("opening failure cleans up and browsers without showPicker use click", (context) => {
  const { owner, inputs, doc } = fixture(context);
  const createInput = doc.createElement;
  doc.createElement = () => {
    const input = createInput();
    input.showPicker = () => {
      throw new Error("blocked");
    };
    return input;
  };
  assert.throws(() => openColorPicker(owner), /blocked/);
  assert.equal(inputs[0].isConnected, false);
  doc.createElement = () => {
    const input = createInput();
    delete input.showPicker;
    return input;
  };
  openColorPicker(owner);
  assert.equal(inputs[1].clicked, true);
});

test("binding preserves existing input/change handlers and keyboard anchoring", (context) => {
  const { owner, inputs } = fixture(context);
  const source = new EventTarget();
  source.value = "#123456";
  source.getBoundingClientRect = () => ({ left: 40, bottom: 60 });
  const received = [];
  for (const type of ["input", "change"]) {
    source.addEventListener(type, () => received.push([type, source.value]));
  }
  bindColorPicker(source, owner);
  bindColorPicker(source, owner);
  const click = new Event("click", { cancelable: true });
  source.dispatchEvent(click);
  assert.equal(inputs.length, 1);
  assert.equal(click.defaultPrevented, true);
  assert.match(inputs[0].style.cssText, /left:40px;top:60px/);
  inputs[0].value = "#abcdef";
  inputs[0].dispatchEvent(new Event("input"));
  inputs[0].dispatchEvent(new Event("change"));
  assert.deepEqual(received, [
    ["input", "#abcdef"],
    ["change", "#abcdef"],
  ]);
});
