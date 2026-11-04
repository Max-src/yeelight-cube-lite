// The cards read a former effect or clock style name as today's (card
// configs, browser-kept favourites), and list the slots once named by number.
// tests/test_effect_names.py checks these tables equal const.py's.
import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_EFFECT_ALIASES,
  canonicalClockStyleName,
  canonicalEffectName,
  withCanonicalNames,
} from "../custom_components/yeelight_cube/www/effect-names.js";
import { normalizeCardOptions } from "../custom_components/yeelight_cube/www/card-config.js";
import {
  canonicalFavourites,
  sanitizeModeNames,
} from "../custom_components/yeelight_cube/www/mode-controls-controller.js";
import { normalizeFavourite } from "../custom_components/yeelight_cube/www/mode-selection.js";
import { isEffectName } from "../custom_components/yeelight_cube/www/native-effect-card-utils.js";
import {
  clockStyleByName,
  clockStyleMixer,
} from "../custom_components/yeelight_cube/www/clock-preview-utils.js";
import { LAMP_EFFECTS } from "../custom_components/yeelight_cube/www/lamp-renderers.js";

test("every former name is today's, with no chain", () => {
  assert.equal(canonicalEffectName("Ocean Waves"), "Waves");
  assert.equal(canonicalEffectName("Color Snakes"), "Tide (slot 35)");
  assert.equal(canonicalEffectName("2"), "Breathing");
  assert.equal(canonicalEffectName("Waves"), "Waves");
  assert.equal(canonicalEffectName("unknown"), "unknown");
  assert.equal(canonicalEffectName("constructor"), "constructor");
  for (const name of Object.values(NATIVE_EFFECT_ALIASES))
    assert.ok(!(name in NATIVE_EFFECT_ALIASES), name);
  for (const [alias, name] of Object.entries(NATIVE_EFFECT_ALIASES)) {
    assert.ok(!(alias in LAMP_EFFECTS), alias);
    if (name !== "Stored GIF") assert.ok(name in LAMP_EFFECTS, name);
  }
  assert.equal(canonicalClockStyleName("Blue White"), "Night-sky waves");
  assert.equal(canonicalClockStyleName("custom:abc"), "custom:abc");
  // No clock style is named after Meteor (it cannot back the clock).
  assert.equal(canonicalClockStyleName("Shooting Star"), "Shooting Star");
});

test("a card config's effect names are read as today's", () => {
  const native = normalizeCardOptions(
    {
      visible_effects: ["Ocean Waves", "Waves", "Rainbow"],
      hidden_effects: ["Streamer"],
      item_labels: { Bonfire: "Camp fire", Fire: "Kept", Rainbow: "Arc" },
    },
    "native",
  );
  assert.deepEqual(native.visible_effects, ["Waves", "Rainbow"]);
  assert.deepEqual(native.hidden_effects, ["Ribbon"]);
  assert.deepEqual(native.item_labels, { Fire: "Kept", Rainbow: "Arc" });
  const clock = normalizeCardOptions(
    {
      custom_visible_styles: true,
      visible_styles: ["Blue White", "custom:abc", "Yellow"],
      hidden_clock_styles: ["Sunset"],
      item_labels: { Carousel: "Spin" },
    },
    "clock",
  );
  assert.deepEqual(clock.visible_styles, ["Night-sky waves", "custom:abc", "Yellow"]);
  assert.deepEqual(clock.hidden_styles, ["Rainbow noise"]);
  assert.deepEqual(clock.item_labels, { "Violet interference": "Spin" });
  // Today's names: the same config object.
  const today = { visible_effects: ["Waves"], item_labels: { Fire: "x" } };
  assert.equal(withCanonicalNames(today, "native"), today);
});

test("favourites kept by a browser under former names are today's", () => {
  assert.deepEqual(
    canonicalFavourites(
      ["Ocean Waves", { key: "Bonfire", colorMode: "bw" }, "7"],
      "native",
    ),
    // "7" was Dual scan's name until 1.4.0.
    ["Waves", { key: "Fire", colorMode: "bw" }, "Dual scan"],
  );
  assert.deepEqual(
    canonicalFavourites([{ key: "Blue White" }, { key: "custom:abc" }], "clock"),
    [{ key: "Night-sky waves" }, { key: "custom:abc" }],
  );
});

test("the slots once named by number are listed by name, never by number", () => {
  for (const name of ["Breathing", "Music Note", "Waves", "Ocean Waves", "Palette sparks", "Ember"])
    assert.equal(isEffectName(name), true, name);
  for (const name of ["2", "73"]) assert.equal(isEffectName(name), false, name);
  // A favourite saved under a slot's number reads as its name.
  assert.deepEqual(normalizeFavourite(canonicalEffectName("2")), { key: "Breathing", colorMode: "normal" });
  assert.deepEqual(
    sanitizeModeNames(["Waves", "Breathing", "7", "Fire"]),
    ["Waves", "Breathing", "Fire"],
  );
});

test("a clock style is found by a former name", () => {
  assert.equal(clockStyleByName("Ocean Waves")?.id, 2);
  assert.equal(clockStyleByName("Waves")?.id, 2);
  assert.equal(clockStyleByName("Carousel")?.id, 15);
  assert.equal(clockStyleMixer({ clock_style: "Blue White" }), 59);
  assert.equal(clockStyleMixer({ clock_style: "Night-sky waves" }), 59);
});
