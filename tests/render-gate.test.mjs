import assert from "node:assert/strict";
import test from "node:test";
import { RenderGate } from "../custom_components/yeelight_cube/www/render-gate.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a render asked for while held happens once, at the last release", () => {
  let renders = 0;
  const gate = new RenderGate(() => renders++);
  gate.request();
  assert.equal(renders, 1); // nothing holds it: at once
  gate.hold("drag");
  gate.hold("typing");
  gate.request();
  gate.request();
  assert.equal(renders, 1);
  assert.equal(gate.pending, true);
  gate.release("drag"); // typing still holds it
  assert.equal(renders, 1);
  gate.release("typing");
  assert.equal(renders, 2);
  assert.equal(gate.pending, false);
  gate.release("typing"); // not held: nothing happens
  assert.equal(renders, 2);
});

test("a timed hold releases itself; holding again restarts it", async () => {
  let renders = 0;
  const gate = new RenderGate(() => renders++);
  gate.hold("slider", 20);
  gate.request();
  await wait(10);
  gate.hold("slider", 20); // still in use
  await wait(15);
  assert.equal(renders, 0);
  assert.equal(gate.held("slider"), true);
  await wait(15);
  assert.equal(renders, 1);
  assert.equal(gate.held(), false);
});

test("clear drops every hold and the waiting render", async () => {
  let renders = 0;
  const gate = new RenderGate(() => renders++);
  gate.hold("picker");
  gate.hold("slider", 10);
  gate.request();
  gate.clear();
  await wait(20);
  assert.equal(renders, 0);
  assert.equal(gate.held(), false);
  assert.equal(gate.pending, false);
});
