import test from "node:test";
import assert from "node:assert/strict";
import {
  cubeLampEntities,
  galleryCardSize,
  valueKey,
  YeelightCardMixin,
} from "../custom_components/yeelight_cube/www/card-base.js";
import {
  availableTargets,
  everyAvailable,
  getTargetEntities,
  lampAvailable,
  withTargetEntities,
} from "../custom_components/yeelight_cube/www/service-call-utils.js";
import { previewOnly } from "../custom_components/yeelight_cube/www/offline-preview-state.js";

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
  // The entity registry knows this integration's lamps even renamed and
  // unavailable (no attributes); another integration's "cube" light is not one.
  assert.deepEqual(
    cubeLampEntities({
      states: {
        "light.office": { state: "unavailable", attributes: {} },
        "light.ice_cube": { state: "on", attributes: {} },
      },
      entities: {
        "light.office": { platform: "yeelight_cube" },
        "light.ice_cube": { platform: "hue" },
      },
    }),
    ["light.office"],
  );
});

test("every card's main lamp: the first one Home Assistant knows", () => {
  const Card = YeelightCardMixin(class {});
  const card = Object.assign(new Card(), {
    config: { target_entities: ["light.gone", "light.b", "light.c"] },
    _hass: { states: { "light.b": {}, "light.c": {} } },
  });
  assert.equal(card._primaryEntity(), "light.b");
  // None known: the first configured (the card says it is missing).
  assert.equal(card._primaryEntity({ states: {} }), "light.gone");
  // An older config with only `entity`; no lamp at all.
  card.config = { entity: "light.c" };
  assert.equal(card._primaryEntity(), "light.c");
  card.config = {};
  assert.equal(card._primaryEntity(), "");
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
    // Without the former vertical switch: horizontal pixel arts first.
    pixel_art_orientation: "horizontal",
  });
  // An explicitly set shared name wins over a leftover older one.
  assert.deepEqual(
    normalizeCardOptions(
      {
        mode_selector_style: "filled",
        style_selector_style: "preview-grid",
        rotary_unified_style: "compass",
      },
      "gradient",
    ),
    {
      style_selector_style: "preview-grid",
      rotary_unified_style: "compass",
      preview_size: 50,
      show_search: false,
    },
  );
  const clean = { style_selector_style: "dropdown" };
  assert.equal(normalizeCardOptions(clean, "clock"), clean);
  const gradient = {
    ...clean,
    rotary_unified_style: "compass",
    preview_size: 64,
    show_search: true,
  };
  assert.equal(normalizeCardOptions(gradient, "gradient"), gradient);
});

test("the former vertical pixel-art switch becomes the gallery's orientation", async () => {
  const { normalizeCardOptions } = await import(
    "../custom_components/yeelight_cube/www/card-config.js"
  );
  const orientation = (config) => {
    const result = normalizeCardOptions(config, "draw");
    assert.equal("pixel_art_show_vertical" in result, false);
    return result.pixel_art_orientation;
  };
  assert.equal(orientation({ pixel_art_show_vertical: true }), "all");
  assert.equal(orientation({ pixel_art_show_vertical: false }), "horizontal");
  assert.equal(orientation({}), "horizontal");
  // A chosen orientation is kept.
  assert.equal(orientation({ pixel_art_orientation: "lamp", pixel_art_show_vertical: true }), "lamp");
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
    // The color section's corners: its own option now (colors_ prefix).
    colors_item_radius: 0,
    selector_button_shape: "round",
    gallery_wrap_navigation: true,
    allow_rename: true,
    gallery_background_color: "white",
    gallery_pixel_style: "circle",
    gallery_spacing_mode: "none",
    gallery_matrix_box_shadow: true,
    item_card_border: "none",
    show_search: false,
    pixel_art_orientation: "horizontal",
  });
  // The color section (palette cards): the gallery's names, colors_
  // prefixed; a legacy "round" corner keeps each mode's own default.
  assert.deepEqual(
    normalizeCardOptions(
      {
        palette_carousel_button_shape: "circle",
        palette_carousel_wrap_navigation: true,
        rounded_cards: 6,
        style_selector_style: "preview-grid",
        items_per_page: 12,
        preview_size: 100,
        selector_shape: "rounded",
        item_card_border: "auto",
        show_search: false,
      },
      "draw",
    ),
    {
      style_selector_style: "preview-grid",
      items_per_page: 12,
      preview_size: 100,
      selector_shape: "rounded",
      item_card_border: "auto",
      show_search: false,
      colors_button_shape: "round",
      colors_wrap_navigation: true,
      colors_item_radius: 6,
      pixel_art_orientation: "horizontal",
    },
  );
  assert.equal(
    "colors_item_radius" in normalizeCardOptions({ rounded_cards: "round" }, "draw"),
    false,
  );
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
  // The former floating colors mode: side by side.
  assert.equal(
    normalizeCardOptions({ palette_card_mode: "floating" }, "draw").palette_card_mode,
    "side",
  );
  // The canvas size as a word or text number becomes a percentage.
  for (const [size, percent] of [
    ["small", 70],
    ["medium", 85],
    ["60", 60],
    ["large", 100],
    [65, 65],
  ])
    assert.equal(
      normalizeCardOptions({ matrix_size: size }, "draw").matrix_size,
      percent,
    );
});

test("the gradient's older gallery size joins the shared Size option", async () => {
  const { normalizeCardOptions } = await import(
    "../custom_components/yeelight_cube/www/card-config.js"
  );
  // (Today's angle style: only the size migrates.)
  const size = (gallery_preview_size) =>
    normalizeCardOptions(
      { gallery_preview_size, rotary_unified_style: "wheel" },
      "gradient",
    );
  const sized = (preview_size) => ({
    preview_size,
    rotary_unified_style: "wheel",
    show_search: false,
  });
  // The same % scale (of 450 px); pixel values above 100 from older configs.
  assert.deepEqual(size("64"), sized(64));
  assert.deepEqual(size(270), sized(60));
  assert.equal(size(undefined).preview_size, 50);
  // An explicit shared value wins and the older key is dropped.
  assert.deepEqual(
    normalizeCardOptions(
      { gallery_preview_size: 80, preview_size: 40, rotary_unified_style: "wheel" },
      "gradient",
    ),
    sized(40),
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

test("a hass push counts only when something the card shows changed", () => {
  const Card = YeelightCardMixin(class {
    connectedCallback() {}
  });
  const card = new Card();
  card.config = { entity: "light.a" };
  const lamp = { state: "on", attributes: { content_mode: "Clock" } };
  const hass = (states) => ({ states: { "light.a": lamp, "sensor.other": {}, ...states } });
  assert.equal(card._hassChanged(hass()), true, "first push");
  // Another entity changed: nothing this card shows.
  assert.equal(card._hassChanged(hass({ "sensor.other": { state: "1" } })), false);
  // Its lamp changed.
  const next = { ...lamp, attributes: { content_mode: "Clock" } };
  assert.equal(card._hassChanged(hass({ "light.a": next })), true);
  // A card reading only some attributes: the header's status still counts.
  card._hassInputs = (h) => [card.config, h.states["light.a"].attributes.text_colors];
  card.config = { entity: "light.a", show_lamp_status: true };
  card._hassChanged(hass({ "light.a": next }));
  // Only an attribute it does not show changed (its brightness).
  assert.equal(
    card._hassChanged(hass({ "light.a": { ...next, attributes: { content_mode: "Clock", brightness: 3 } } })),
    false,
    "an attribute the card does not show",
  );
  assert.equal(
    card._hassChanged(hass({ "light.a": { state: "on", attributes: { content_mode: "Native Effect" } } })),
    true,
    "the header's lamp status",
  );
});

test("value keys compare lamp lists by content, each array stringified once", () => {
  const colors = [[255, 0, 0], [0, 0, 255]];
  assert.equal(valueKey(colors), valueKey(structuredClone(colors)));
  assert.notEqual(valueKey(colors), valueKey([[255, 0, 0]]));
  assert.equal(valueKey(undefined), undefined);
  assert.equal(valueKey(42), 42);
  const original = JSON.stringify;
  let calls = 0;
  JSON.stringify = (...args) => (calls++, original(...args));
  try {
    const list = [[1, 2, 3]];
    valueKey(list);
    valueKey(list);
    assert.equal(calls, 1);
  } finally {
    JSON.stringify = original;
  }
});

test("dashboard sizes come from the card base", () => {
  class Card extends YeelightCardMixin(class {}) {}
  class Small extends YeelightCardMixin(class {}) {
    static cardSize = 2;
    static minColumns = 3;
  }
  assert.equal(new Card().getCardSize(), 4);
  assert.deepEqual(new Card().getGridOptions(), { columns: 12, rows: "auto", min_columns: 6 });
  assert.equal(new Small().getCardSize(), 2);
  assert.equal(new Small().getGridOptions().min_columns, 3);
  assert.deepEqual(
    ["preview-list", "preview-grid", "preview-mosaic", "preview-wheel", "preview-carousel", "filled"].map(galleryCardSize),
    [8, 8, 8, 5, 4, 4],
  );
});

test("several lamps, one offline: the card works with the available ones", () => {
  const config = { target_entities: ["light.gone", "light.off", "light.a", "light.b"] };
  const hass = {
    states: {
      "light.off": { state: "unavailable", attributes: {} },
      "light.a": { state: "on", attributes: { effect_rotation: {} } },
      "light.b": { state: "off", attributes: { effect_rotation: {} } },
    },
  };
  assert.equal(lampAvailable(hass.states["light.a"]), true);
  assert.equal(lampAvailable({ state: "unknown" }), false);
  assert.equal(lampAvailable(undefined), false);
  assert.deepEqual(availableTargets(hass, config), ["light.a", "light.b"]);
  // About the available lamps only; never true with none.
  assert.equal(everyAvailable(hass, config, (id, state) => "effect_rotation" in state.attributes), true);
  assert.equal(everyAvailable(hass, config, (id, state) => state.state === "on"), false);
  assert.equal(everyAvailable({ states: {} }, config, () => true), false);
  // The offline preview only once none is available.
  assert.equal(previewOnly({ config, _hass: hass }), false);
  assert.equal(previewOnly({ config, _hass: { states: { "light.off": hass.states["light.off"] } } }), true);
  assert.equal(previewOnly({ config: {}, _hass: hass }), true);

  // The card shows the first available lamp, else the first one known; the
  // lamps key follows both (0 missing, 1 unavailable, 2 available).
  const Card = YeelightCardMixin(class { connectedCallback() {} });
  const card = Object.assign(new Card(), { config, _hass: hass });
  assert.equal(card._primaryEntity(), "light.a");
  assert.equal(card._lampsKey(), "0122");
  card._hass = { states: { "light.off": hass.states["light.off"] } };
  assert.equal(card._primaryEntity(), "light.off");
  assert.equal(card._lampsKey(), "0100");
});
