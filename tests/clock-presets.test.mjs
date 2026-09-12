import assert from "node:assert/strict";
import test from "node:test";
import {
  clockStylesWithPresets,
  clockPresetKey,
  matchingClockPreset,
  clockStyleAction,
  clockPresetLibrary,
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
  assert.deepEqual(clockStyleAction(styles[0]), {
    style: "White",
    color: "clear",
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
