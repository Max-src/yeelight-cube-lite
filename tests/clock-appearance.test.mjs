import {
  APPEARANCE_PROFILES,
  normalizePreviewAppearance,
  resolvePreviewAppearance,
} from "../custom_components/yeelight_cube/www/preview-appearance.js";

test("all appearance profiles share migration, sparse overrides and independent sizes", () => {
  for (const profile of Object.keys(APPEARANCE_PROFILES)) {
    const legacy = { size_pct: 61, pixel_art_preview_size: 42 };
    for (const definition of Object.values(APPEARANCE_PROFILES[profile])) {
      legacy[definition.keys.background] = "white";
      legacy[definition.keys.pixels] = "circle";
    }
    const snapshot = structuredClone(legacy);
    const normalized = normalizePreviewAppearance(legacy, profile);
    assert.deepEqual(
      normalizePreviewAppearance(normalized, profile),
      normalized,
    );
    assert.deepEqual(legacy, snapshot);
    const resolved = resolvePreviewAppearance(normalized, profile);
    for (const definition of Object.values(APPEARANCE_PROFILES[profile])) {
      assert.equal(resolved[definition.keys.background], "white");
      assert.equal(resolved[definition.keys.pixels], "circle");
    }
    assert.equal(resolved.size_pct, 61);
    assert.equal(resolved.pixel_art_preview_size, 42);
    const inherited = resolvePreviewAppearance(
      {
        ...normalized,
        preview_appearance: APPEARANCE_PRESETS.square,
        preview_overrides: {},
      },
      profile,
    );
    for (const definition of Object.values(APPEARANCE_PROFILES[profile])) {
      assert.equal(inherited[definition.keys.background], "transparent");
      assert.equal(inherited[definition.keys.spacing], "none");
    }
  }
  assert.equal(
    resolvePreviewAppearance({ matrix_pixel_spacing: false }, "lamp")
      .matrix_spacing_mode,
    "none",
  );
  assert.equal(
    resolvePreviewAppearance({ pixel_spacing: false }, "draw")
      .pixel_spacing_mode,
    "none",
  );
  assert.equal(
    resolvePreviewAppearance({}, "draw").pixel_art_background_color,
    "transparent",
  );
});
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeClockAppearance,
  resolveClockAppearance,
  APPEARANCE_PRESETS,
  clockAppearancePresets,
} from "../custom_components/yeelight_cube/www/clock-preview-appearance.js";

test("legacy clock appearance preserves defaults and explicit values without mutating input", () => {
  const config = {
    lamp_matrix_background: "white",
    gallery_spacing_mode: "none",
    effect_pixel_style: "circle",
    effect_preview_size: 75,
  };
  const original = structuredClone(config);
  const resolved = resolveClockAppearance(config);
  assert.equal(resolved.lamp_pixel_style, "rounded");
  assert.equal(resolved.gallery_pixel_style, "square");
  assert.equal(resolved.effect_pixel_style, "circle");
  assert.equal(resolved.lamp_matrix_background, "white");
  assert.equal(resolved.gallery_spacing_mode, "none");
  assert.equal(resolved.effect_preview_size, 75);
  assert.deepEqual(config, original);
  const normalized = normalizeClockAppearance(config);
  assert.deepEqual(normalizeClockAppearance(normalized), normalized);
  assert.equal("lamp_matrix_background" in normalized, false);
});

test("shared appearance follows presets with independent sizes and sparse overrides", () => {
  const config = {
    clock_preview_appearance: APPEARANCE_PRESETS.square,
    clock_preview_overrides: { lamp: { shadow: true } },
    lamp_preview_size: 80,
    preview_size: 40,
    effect_preview_size: 65,
  };
  const resolved = resolveClockAppearance(config);
  for (const key of [
    "lamp_matrix_background",
    "gallery_background_color",
    "effect_matrix_background",
  ])
    assert.equal(resolved[key], "transparent");
  assert.equal(resolved.lamp_matrix_box_shadow, true);
  assert.equal(resolved.gallery_matrix_box_shadow, false);
  assert.equal(resolved.effect_matrix_box_shadow, false);
  assert.deepEqual(
    [
      resolved.lamp_preview_size,
      resolved.preview_size,
      resolved.effect_preview_size,
    ],
    [80, 40, 65],
  );
  const changed = resolveClockAppearance({
    ...config,
    clock_preview_appearance: APPEARANCE_PRESETS.light,
  });
  assert.equal(changed.lamp_pixel_style, "rounded");
  assert.equal(changed.lamp_matrix_box_shadow, true);
});

test("invalid appearance values cannot reach renderers", () => {
  const resolved = resolveClockAppearance({
    clock_preview_appearance: { pixels: "invalid", shadow: "false" },
    clock_preview_overrides: { lamp: { spacing: "bad" } },
  });
  assert.equal(resolved.lamp_pixel_style, "rounded");
  assert.equal(resolved.lamp_spacing_mode, "normal");
  assert.equal(resolved.lamp_matrix_box_shadow, false);
});

test("built-in appearance presets match the requested definitions", () => {
  assert.deepEqual(APPEARANCE_PRESETS, {
    classic: {
      background: "black",
      pixels: "circle",
      spacing: "normal",
      shadow: false,
      ignoreBlack: false,
    },
    light: {
      background: "white",
      pixels: "rounded",
      spacing: "subtle",
      shadow: true,
      ignoreBlack: true,
    },
    square: {
      background: "transparent",
      pixels: "square",
      spacing: "none",
      shadow: false,
      ignoreBlack: true,
    },
  });
});

test("saved presets redefine built-ins and append custom entries without mutating defaults", () => {
  const config = {
    clock_appearance_presets: [
      {
        id: "classic",
        name: "My Classic",
        appearance: APPEARANCE_PRESETS.light,
      },
      {
        id: "custom-one",
        name: "  Night  ",
        appearance: { pixels: "circle", shadow: true },
      },
      { id: "custom-one", name: "Duplicate", appearance: {} },
      { id: "broken", name: " " },
      null,
    ],
  };
  const snapshot = structuredClone(config);
  const presets = clockAppearancePresets(config);
  assert.equal(presets.length, 4);
  assert.equal(presets[0].name, "My Classic");
  assert.equal(presets[0].builtin, true);
  assert.deepEqual(presets[0].appearance, APPEARANCE_PRESETS.light);
  assert.equal(presets[3].name, "Night");
  assert.equal(presets[3].builtin, false);
  assert.equal(presets[3].appearance.shadow, true);
  assert.equal(clockAppearancePresets({})[0].appearance.pixels, "circle");
  assert.deepEqual(config, snapshot);
  assert.equal(
    clockAppearancePresets({ clock_appearance_presets: {} }).length,
    3,
  );
  assert.deepEqual(
    clockAppearancePresets(normalizeClockAppearance(config)),
    presets,
  );
});
