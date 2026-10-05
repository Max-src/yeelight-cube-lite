import test from "node:test";
import assert from "node:assert/strict";
import { cubeLampEntities } from "../custom_components/yeelight_cube/www/card-base.js";
import {
  getTargetEntities,
  withTargetEntities,
} from "../custom_components/yeelight_cube/www/service-call-utils.js";

test("cube lamps are found by the integration's marker, renamed or not", () => {
  const hass = {
    states: {
      "light.kitchen": { attributes: {} },
      "light.desk_cube": { attributes: { _yeelight_cube_component: "v1" } },
      "light.cubelite_192_168_4_105": { attributes: {} }, // older state
      "sensor.yeelight_cube_saved_pixel_arts": {
        attributes: { _yeelight_cube_component: "v1" },
      },
    },
  };
  assert.deepEqual(cubeLampEntities(hass), [
    "light.desk_cube",
    "light.cubelite_192_168_4_105",
  ]);
  assert.deepEqual(cubeLampEntities(undefined), []);
});

test("choosing lamps keeps entity on the first and never leaves a stale one", () => {
  const config = { title: "Draw", entity: "light.old", target_entities: ["light.old"] };
  const two = withTargetEntities(config, ["light.a", "light.b"]);
  assert.deepEqual(two, {
    title: "Draw",
    entity: "light.a",
    target_entities: ["light.a", "light.b"],
  });
  assert.deepEqual(withTargetEntities(config, "light.single").target_entities, [
    "light.single",
  ]);
  // Clearing every lamp must not fall back to the old one.
  const none = withTargetEntities(config, []);
  assert.equal("entity" in none, false);
  assert.deepEqual(getTargetEntities(none), []);
  assert.deepEqual(config.target_entities, ["light.old"]); // input untouched
});

test("older option names move to the shared vocabulary", async () => {
  const { normalizeCardOptions } = await import(
    "../custom_components/yeelight_cube/www/card-config.js"
  );
  const draw = normalizeCardOptions(
    {
      show_pixelart_gallery: false,
      pixel_art_show_titles: false,
      pixel_art_remove_button_style: "black",
      pixel_art_delete_button_style: "text",
      title: "Draw",
    },
    "draw",
  );
  assert.deepEqual(draw, {
    show_gallery: false,
    preview_show_titles: false,
    remove_button_style: "black",
    title: "Draw",
  });
  // An explicitly set shared name wins over a leftover older one.
  assert.deepEqual(
    normalizeCardOptions(
      { mode_selector_style: "filled", style_selector_style: "preview-grid" },
      "gradient",
    ),
    { style_selector_style: "preview-grid" },
  );
  const clean = { style_selector_style: "dropdown" };
  assert.equal(normalizeCardOptions(clean, "gradient"), clean);
  assert.equal(normalizeCardOptions(clean, "clock"), clean);
});

test("an older clock config reads into the shared appearance names", async () => {
  const { normalizeClockAppearance } = await import(
    "../custom_components/yeelight_cube/www/preview-appearance.js"
  );
  const config = normalizeClockAppearance({
    clock_preview_appearance: { pixels: "square", background: "white" },
    clock_preview_overrides: { lamp: { pixels: "circle" } },
    clock_appearance_presets: [],
  });
  assert.equal(config.preview_appearance.pixels, "square");
  assert.equal(config.preview_appearance.background, "white");
  assert.deepEqual(config.preview_overrides.lamp, { pixels: "circle" });
  assert.deepEqual(config.appearance_presets, []);
  for (const key of ["clock_preview_appearance", "clock_preview_overrides", "clock_appearance_presets"])
    assert.equal(key in config, false, key);
});
