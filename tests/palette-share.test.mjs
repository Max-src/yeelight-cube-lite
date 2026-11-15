// A card applying the Palette color mode to several lamps: they all show the
// palette the card shows (service-call-utils.js shareShownPalette).
import test from "node:test";
import assert from "node:assert/strict";
import { shareShownPalette } from "../custom_components/yeelight_cube/www/service-call-utils.js";

const GREEN = [[43, 147, 72], [255, 255, 63]];
const RED_BLUE = [[255, 0, 0], [0, 0, 255]];

function hassWith(states) {
  const calls = [];
  return {
    calls,
    states: Object.fromEntries(
      Object.entries(states).map(([entity, [state, colours]]) => [
        entity,
        { state, attributes: colours ? { text_colors: colours } : {} },
      ]),
    ),
    callService: async (domain, service, data) => calls.push({ domain, service, data }),
  };
}
const config = { target_entities: ["light.top", "light.bottom", "light.matrix"] };

test("a lamp with another palette is given the shown one, once", async () => {
  const hass = hassWith({
    "light.top": ["on", GREEN],
    "light.bottom": ["on", GREEN],
    "light.matrix": ["on", RED_BLUE],
  });
  assert.deepEqual(await shareShownPalette(hass, config, "light.top"), ["light.matrix"]);
  assert.deepEqual(hass.calls, [
    {
      domain: "yeelight_cube",
      service: "set_text_colors",
      data: { entity_id: "light.matrix", text_colors: GREEN },
    },
  ]);
});

test("several lamps in one call; none when they all have it", async () => {
  const hass = hassWith({
    "light.top": ["on", GREEN],
    "light.bottom": ["on", null],
    "light.matrix": ["on", RED_BLUE],
  });
  await shareShownPalette(hass, config, "light.top");
  assert.deepEqual(hass.calls[0].data.entity_id, ["light.bottom", "light.matrix"]);
  const same = hassWith({ "light.top": ["on", GREEN], "light.bottom": ["on", GREEN], "light.matrix": ["on", GREEN] });
  assert.deepEqual(await shareShownPalette(same, config, "light.top"), []);
  assert.equal(same.calls.length, 0);
});

test("an offline lamp, or a shown lamp without a palette, is left alone", async () => {
  const hass = hassWith({
    "light.top": ["on", GREEN],
    "light.bottom": ["unavailable", RED_BLUE],
    "light.matrix": ["on", GREEN],
  });
  assert.deepEqual(await shareShownPalette(hass, config, "light.top"), []);
  const none = hassWith({ "light.top": ["on", null], "light.bottom": ["on", RED_BLUE], "light.matrix": ["on", GREEN] });
  assert.deepEqual(await shareShownPalette(none, config, "light.top"), []);
  assert.equal(hass.calls.length + none.calls.length, 0);
});

import {
  CLOCK_CARD_COLORS,
  ColorModeController,
  NATIVE_CARD_COLORS,
} from "../custom_components/yeelight_cube/www/color-mode-controller.js";
import { readFileSync } from "node:fs";

for (const [kind, attribute] of [
  [NATIVE_CARD_COLORS, "native_effect_color_mode"],
  [CLOCK_CARD_COLORS, "clock_color_mode"],
]) {
  const service = kind.service;
  test(`${kind.label}: the Palette color mode shares the shown palette before it is sent`, async () => {
    const hass = hassWith({
      "light.top": ["on", GREEN],
      "light.bottom": ["on", RED_BLUE],
      "light.matrix": ["on", GREEN],
    });
    const order = [];
    let mode = "normal";
    const card = {
      config,
      _hass: hass,
      _primaryEntity: () => "light.top",
      _attrs: () => ({ [attribute]: mode }),
      _controls: { send: async (name) => order.push(["send", name, hass.calls.length]) },
    };
    const colors = new ColorModeController(card, kind);
    await colors.send(service, { color_mode: "palette" });
    // The palette was given (one call) before the command was sent.
    assert.deepEqual(order, [["send", service, 1]]);
    assert.equal(hass.calls[0].data.entity_id, "light.bottom");
    // Already in the Palette mode: picking an effect or style shares it too.
    mode = "palette";
    hass.states["light.bottom"].attributes.text_colors = RED_BLUE;
    await colors.send(service, { effect: "Knight Rider", style: "Rainbow" });
    assert.deepEqual(order.at(-1), ["send", service, 2]);
    mode = "normal";
    await colors.send(service, { color_mode: "bw" });
    assert.deepEqual(order.at(-1), ["send", service, 2]);
    // Another command (brightness): never shared.
    mode = "palette";
    await colors.send("turn_on", { brightness: 3 }, { domain: "light" });
    assert.deepEqual(order.at(-1), ["send", "turn_on", 2]);
  });
}

// The cards send their commands through it (the Native card's offline
// preview aside).
for (const file of ["yeelight-cube-native-effects-card.js", "yeelight-cube-clock-card.js"])
  test(`${file}: its commands go through the shared color modes`, () => {
    const source = readFileSync(
      new URL(`../custom_components/yeelight_cube/www/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /return this\._colors\.send\(service, data, \{ domain, managed, \.\.\.options \}\);/);
    assert.doesNotMatch(source, /shareShownPalette/);
  });
