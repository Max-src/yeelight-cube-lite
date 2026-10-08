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
    // The former pixel-art gallery defaults, as shared gallery options.
    style_selector_style: "preview-grid",
    items_per_page: 12,
    preview_size: 100,
    selector_shape: "custom",
    item_radius: 16,
    item_card_border: "auto",
    show_search: false,
  });
  // An explicitly set shared name wins over a leftover older one.
  assert.deepEqual(
    normalizeCardOptions(
      { mode_selector_style: "filled", style_selector_style: "preview-grid" },
      "gradient",
    ),
    { style_selector_style: "preview-grid", preview_size: 50, show_search: false },
  );
  const clean = { style_selector_style: "dropdown" };
  assert.equal(normalizeCardOptions(clean, "clock"), clean);
  const gradient = { ...clean, preview_size: 64, show_search: true };
  assert.equal(normalizeCardOptions(gradient, "gradient"), gradient);
});

test("the Draw pixel-art gallery's options join the shared gallery's", async () => {
  const { normalizeCardOptions } = await import(
    "../custom_components/yeelight_cube/www/card-config.js"
  );
  const draw = normalizeCardOptions(
    {
      pixel_art_gallery_mode: "compact",
      pixel_art_items_per_page: 5,
      pixel_art_preview_size: 70,
      rounded_cards: "square",
      carousel_button_shape: "circle",
      carousel_wrap_navigation: true,
      pixel_art_allow_rename: true,
      pixel_art_background_color: "white",
      pixel_art_pixel_style: "circle",
      pixel_art_spacing_mode: "none",
      pixel_art_matrix_box_shadow: true,
      item_card_border: "none",
      compact_show_preview: false,
    },
    "draw",
  );
  assert.deepEqual(draw, {
    style_selector_style: "preview-strip",
    items_per_page: 5,
    preview_size: 70,
    selector_shape: "custom",
    item_radius: 0,
    // Kept: the Draw palette cards use it too.
    rounded_cards: "square",
    selector_button_shape: "round",
    gallery_wrap_navigation: true,
    allow_rename: true,
    gallery_background_color: "white",
    gallery_pixel_style: "circle",
    gallery_spacing_mode: "none",
    gallery_matrix_box_shadow: true,
    item_card_border: "none",
    show_search: false,
  });
  // The former album was 240 px at 100%: the shared album's 55%.
  assert.equal(
    normalizeCardOptions({ pixel_art_gallery_mode: "album" }, "draw").preview_size,
    55,
  );
  for (const [mode, style] of [
    ["gallery", "preview-grid"],
    ["list", "preview-list"],
    ["carousel", "preview-carousel"],
    ["album", "preview-album"],
  ])
    assert.equal(
      normalizeCardOptions({ pixel_art_gallery_mode: mode }, "draw")
        .style_selector_style,
      style,
    );
});

test("the gradient's older gallery size joins the shared Size option", async () => {
  const { normalizeCardOptions } = await import(
    "../custom_components/yeelight_cube/www/card-config.js"
  );
  const size = (gallery_preview_size) =>
    normalizeCardOptions({ gallery_preview_size }, "gradient");
  // The same % scale (of 450 px); pixel values above 100 from older configs.
  assert.deepEqual(size("64"), { preview_size: 64, show_search: false });
  assert.deepEqual(size(270), { preview_size: 60, show_search: false });
  assert.equal(size(undefined).preview_size, 50);
  // An explicit shared value wins and the older key is dropped.
  assert.deepEqual(
    normalizeCardOptions({ gallery_preview_size: 80, preview_size: 40 }, "gradient"),
    { preview_size: 40, show_search: false },
  );
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

test("item labels rename items on one card without changing their key", async () => {
  const { itemLabel, withItemLabel } = await import(
    "../custom_components/yeelight_cube/www/card-config.js"
  );
  const config = withItemLabel({ title: "Clock" }, "Rainbow", "  Arc-en-ciel ");
  assert.deepEqual(config, { title: "Clock", item_labels: { Rainbow: "Arc-en-ciel" } });
  assert.equal(itemLabel(config, "Rainbow", "Rainbow"), "Arc-en-ciel");
  assert.equal(itemLabel(config, "Mint", "Mint"), "Mint");
  assert.equal(itemLabel({ item_labels: { Mint: "   " } }, "Mint", "Mint"), "Mint");
  // Clearing the last label drops the option.
  assert.deepEqual(withItemLabel(config, "Rainbow", ""), { title: "Clock" });
});
