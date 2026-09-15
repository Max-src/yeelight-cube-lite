import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  clockStylesWithPresets,
  clockPresetKey,
  matchingClockPreset,
  clockStyleAction,
  clockPresetLibrary,
  clockPresetsByKind,
  clockColorPresetAction,
  matchingClockColorPreset,
} from "../custom_components/yeelight_cube/www/clock-preset-utils.js";

test("custom clocks preserve builtins and have stable identity after rename", () => {
  const builtins = [{ id: 4, name: "White" }];
  const styles = clockStylesWithPresets(builtins, [
    { id: "abc", name: "Amber", color: [255, 120, 0] },
  ]);
  assert.equal(builtins.length, 1);
  assert.equal(clockPresetKey(styles[1]), "custom:abc");
  styles[1].name = "Sunlight";
  assert.equal(clockPresetKey(styles[1]), "custom:abc");
  assert.deepEqual(clockStyleAction(styles[1]), {
    style: "White",
    color: [255, 120, 0],
    activate: true,
  });
  // Non-preset styles omit `color` so an active custom override persists
  // across style switches instead of resetting.
  assert.deepEqual(clockStyleAction(styles[0]), {
    style: "White",
    activate: true,
  });
  assert.equal(
    matchingClockPreset(styles, { clock_style_id: 4, clock_color: 0x01ff7800 }),
    styles[1],
  );
  assert.equal(
    matchingClockPreset(styles, { clock_style_id: 1, clock_color: 0x01ff7800 }),
    null,
  );
  assert.equal(
    matchingClockPreset(styles, { clock_style_id: 4, clock_color: 0x01123456 }),
    null,
  );
  assert.deepEqual(
    clockPresetLibrary({
      states: { "sensor.renamed": { attributes: { clock_presets: [] } } },
    }),
    [],
  );
});

test("colour-mode presets stay out of styles and apply colour without changing the clock style", () => {
  const legacy = { id: "legacy", name: "Amber clock", color: [255, 120, 0] };
  const mode = {
    id: "mode",
    name: "Amber",
    color: [255, 120, 0],
    kind: "color_mode",
  };
  const presets = [legacy, mode];
  assert.deepEqual(clockPresetsByKind(presets), [legacy]);
  assert.deepEqual(clockPresetsByKind(presets, "color_mode"), [mode]);
  assert.equal(clockStylesWithPresets([], presets).length, 1);
  assert.deepEqual(clockColorPresetAction(mode), {
    color_mode: "normal",
    color: [255, 120, 0],
  });
  assert.equal(
    matchingClockColorPreset(presets, {
      clock_style_id: 1,
      clock_color: 0x01ff7800,
    }),
    mode,
  );
  assert.equal(
    matchingClockColorPreset(presets, {
      clock_color_mode: "bw",
      clock_color: 0x01ff7800,
    }),
    null,
  );
  assert.equal(
    matchingClockColorPreset(presets, { clock_color: 0x01000000 }),
    null,
  );
  assert.equal(matchingClockColorPreset([], { clock_color: 0x01ff7800 }), null);
});

test("card colour actions restore the last confirmed colour and ignore deleted presets", () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-clock-card.js",
      import.meta.url,
    ),
    "utf8",
  );
  const attrs = { clock_color: 0x0128dca0, clock_color_mode: "normal" };
  const calls = [];
  const presets = [{ id: "amber", kind: "color_mode", color: [255, 120, 0] }];
  const rgbToHex = (rgb) =>
    `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const hexToRgb = (hex) =>
    [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const clockColorToRgb = (packed) =>
    typeof packed === "number"
      ? [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
      : null;
  const card = {
    _hass: { states: { library: { attributes: { clock_presets: presets } } } },
    _attrs: () => attrs,
    _callSetClock: (data) => calls.push(data),
  };
  for (const name of ["_applyColorMode", "_applyColor", "_applyColorPreset"]) {
    const method = source.match(
      new RegExp(`  ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`),
    );
    assert.ok(method, `${name} exists`);
    card[name] = new Function(
      "clockColorToRgb",
      "hexToRgb",
      "rgbToHex",
      "clockPresetLibrary",
      "clockPresetsByKind",
      "clockColorPresetAction",
      `return function(${method[1]}) {${method[2]}}`,
    )(
      clockColorToRgb,
      hexToRgb,
      rgbToHex,
      clockPresetLibrary,
      clockPresetsByKind,
      clockColorPresetAction,
    );
  }
  card._applyColorMode("normal");
  assert.deepEqual(calls.at(-1), { color_mode: "normal", color: "clear" });
  attrs.clock_color = null;
  card._applyColorMode("custom");
  assert.deepEqual(calls.at(-1), {
    color_mode: "normal",
    color: [40, 220, 160],
  });
  card._applyColorPreset("amber");
  assert.deepEqual(calls.at(-1), {
    color_mode: "normal",
    color: [255, 120, 0],
  });
  const count = calls.length;
  card._applyColorPreset("deleted");
  assert.equal(calls.length, count);
  card._applyColor([1, 2, 3]);
  assert.deepEqual(calls.at(-1), { color_mode: "normal", color: [1, 2, 3] });
  assert.equal(card._lastCustomHex, "#010203");
});
