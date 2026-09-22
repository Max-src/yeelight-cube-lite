import assert from "node:assert/strict";
import test from "node:test";
import { modeActionOptions } from "../custom_components/yeelight_cube/www/action-button-utils.js";
import {
  ModeControlsController,
  actionButtonOrder,
  ACTION_BUTTON_KEYS,
  ACTION_BUTTON_LABELS,
  rotationIntervalParts,
  ROTATION_INTERVAL_UNITS,
} from "../custom_components/yeelight_cube/www/mode-controls-controller.js";
import { readFileSync } from "node:fs";
import {
  nativeEffectItems,
  nativeEffectDirection,
  nativeEffectFrame,
  nativeEffectAction,
  nativeEffectPreviewConfig,
  effectCollectionKey,
  readEffectCollections,
  sanitizeEffectCollections,
  nextRotationEffect,
  rotationIntervalMs,
} from "../custom_components/yeelight_cube/www/native-effect-card-utils.js";
import {
  renderNativeEffectOriented,
  effectSupportsColorMode,
  effectSupportsColorOverride,
} from "../custom_components/yeelight_cube/www/native-effect-preview.js";
import { CLOCK_COLOR_MODES } from "../custom_components/yeelight_cube/www/clock-preview-utils.js";
import {
  clockPresetLibrary,
  clockColorModeOptions,
  clockPresetsByKind,
} from "../custom_components/yeelight_cube/www/clock-preset-utils.js";
import { flipMatrixVertical } from "../custom_components/yeelight_cube/www/clock-preview-utils.js";
import {
  getTargetEntities,
  callServiceOnTargetEntities,
} from "../custom_components/yeelight_cube/www/service-call-utils.js";
import {
  orientationOptions,
  nextOrientation,
} from "../custom_components/yeelight_cube/www/orientation-control-utils.js";

const rainbow = {
  name: "Rainbow",
  speed: true,
  directions: ["Up", "Down", "Left", "Right"],
};

const sourceFor = (file) =>
  readFileSync(
    new URL(`../custom_components/yeelight_cube/www/${file}`, import.meta.url),
    "utf8",
  );
const template = (strings, ...values) => ({ strings, values });

test("experimental editor status distinguishes device gates, missing states and card filter", () => {
  const source = sourceFor("editor_ui_utils.js");
  const match = source.match(
    /export function renderExperimentalAvailability\(([\s\S]*?)\) \{([\s\S]*?)\n\}/,
  );
  const flatten = (value) =>
    Array.isArray(value) ? value.map(flatten).join("") : String(value ?? "");
  const html = (strings, ...values) =>
    strings.reduce(
      (text, part, index) => text + part + flatten(values[index]),
      "",
    );
  const render = new Function(
    "html",
    `return function(${match[1]}) {${match[2]}}`,
  )(html);
  const hass = {
    states: {
      "light.top": {
        state: "on",
        attributes: { friendly_name: "Top", extended_effects_enabled: true },
      },
      "light.bottom": {
        state: "off",
        attributes: {
          friendly_name: "Bottom",
          extended_effects_enabled: false,
        },
      },
    },
  };
  const mixed = render(
    hass,
    ["light.top", "light.bottom", "light.missing"],
    {},
    true,
  );
  assert.match(mixed, /Off: Bottom/);
  assert.match(mixed, /Status unavailable: light.missing/);
  assert.match(mixed, /Experimental Effects filter is Off/);
  assert.doesNotMatch(mixed, /On for all/);
  const enabled = render(
    hass,
    ["light.top"],
    { show_experimental: true },
    true,
  );
  assert.match(enabled, /On for all selected lamps/);
  assert.doesNotMatch(enabled, /filter is Off/);
  assert.doesNotMatch(
    render(hass, ["light.bottom"], {}, false),
    /filter is Off/,
  );
  assert.equal(render(hass, [], {}, false), "");
});

test("native colour choices retain configured order while effects respond to the colour", async () => {
  const attrs = {
    native_effect_color_mode: "normal",
    native_effect_catalog: ["Starry sky", "Tide", "Rainbow"].map((name) => ({
      name,
    })),
  };
  const card = {
    config: {
      visible_color_modes: ["white_orange", "normal", "__pick__"],
      hidden_color_modes: ["bw", "red_blue", "blue_yellow", "purple_orange"],
    },
    _attrs: () => attrs,
    _effect: () => ({ name: "Starry sky" }),
    _supportsCustomColor: () => true,
    _effectAvailable: () => true,
    _command: async (service, data) => {
      card.command = { service, data };
      return true;
    },
    _context: 1,
    _page: 5,
  };
  card._respondsToColor = cardMethod("_respondsToColor", {
    effectSupportsColorMode,
    effectSupportsColorOverride,
  });
  card._effectForColor = cardMethod("_effectForColor", { nativeEffectItems });
  card._items = cardMethod("_items", { nativeEffectItems });
  const options = cardMethod("_colorOptions", {
    CLOCK_COLOR_MODES,
    clockColorModeOptions,
    clockPresetLibrary,
  });
  const selected = cardMethod("_currentColorSelection", {
    clockPresetsByKind,
    clockPresetLibrary,
  });
  const apply = cardMethod("_applyColorMode", {
    clockPresetsByKind,
    clockPresetLibrary,
  });
  assert.deepEqual(
    options.call(card).map((mode) => mode.value),
    ["white_orange", "normal", "__pick__"],
  );
  await apply.call(card, "white_orange");
  assert.equal(card.command.data.effect, "Tide");
  assert.equal(card._page, 0);
  attrs.native_effect_color_mode = "white_orange";
  assert.deepEqual(
    card._items().map((item) => item.name),
    ["Tide", "Rainbow"],
  );
  assert.equal(selected.call(card), "white_orange");
  assert.deepEqual(
    options.call(card).map((mode) => mode.value),
    ["white_orange", "normal", "__pick__"],
  );
  attrs.native_effect_color_mode = "normal";
  assert.equal(card._items().length, 3);
  attrs.native_effect_color = [0, 0, 0];
  assert.ok(
    card._items().every((item) => effectSupportsColorOverride(item.name)),
  );
  card._effectAvailable = () => false;
  card.command = null;
  await apply.call(card, "white_orange");
  assert.equal(card.command, null);
  assert.match(card._error, /No configured effect/);
});

function cardMethod(name, dependencies = {}) {
  const source = sourceFor("yeelight-cube-native-effects-card.js");
  const match = source.match(
    new RegExp(`  (async )?${name}\\(([^\\n]*)\\) \\{([\\s\\S]*?)\\n  \\}`),
  );
  assert.ok(match, name);
  return new Function(
    ...Object.keys(dependencies),
    `return ${match[1] || ""}function(${match[2]}) {${match[3]}}`,
  )(...Object.values(dependencies));
}

test("native unsaved colour survives stale state echoes and unrelated updates", () => {
  const source = sourceFor("yeelight-cube-native-effects-card.js");
  const body = source.match(/  set hass\(hass\) \{([\s\S]*?)\n  \}/)[1];
  const update = new Function(
    "getTargetEntities",
    `return function(hass) {${body}}`,
  )(getTargetEntities);
  const draft = [18, 52, 86];
  const card = {
    config: { entity: "light.a", show_color_modes: true },
    _customColorDraft: draft,
    _controls: { update() {} },
    requestUpdate() {},
    _state: {
      attributes: {
        native_effect_color: draft,
        native_effect_color_mode: "normal",
      },
    },
  };
  for (const color of [null, [1, 2, 3], draft]) {
    update.call(card, {
      states: {
        "light.a": {
          attributes: {
            native_effect_color: color,
            native_effect_color_mode: "normal",
          },
        },
      },
    });
    assert.equal(card._customColorDraft, draft);
  }
});

test("light slider settings share icon toggles and non-capsule value visibility", () => {
  const body = sourceFor("slider-control-utils.js").match(
    /export function renderLightSliderSettings\(config, onChange\) \{([\s\S]*?)\n\}/,
  )[1];
  const render = new Function(
    "sliderKeys",
    "renderSliderSettings",
    `return function(config, onChange) {${body}}`,
  )(
    () => ({ showValue: "slider_show_value" }),
    (config, keys, change, options) => options,
  );
  const options = render({}, () => {});
  assert.ok(options.icons.leftLabel);
  assert.ok(options.icons.rightLabel);
  assert.equal(options.showValueToggle.key, "slider_show_value");
  assert.equal(options.rawValueToggle.key, "slider_show_raw_value");
  for (const file of [
    "yeelight-cube-clock-card-editor.js",
    "yeelight-cube-native-effects-card-editor.js",
  ])
    assert.match(sourceFor(file), /renderLightSliderSettings\(/);
});

test("shared slider conversions agree across cards and fix the speed 20/19 mismatch", () => {
  const src = sourceFor("slider-control-utils.js");
  const grabFn = (sig) => {
    const match = src.match(new RegExp(`function ${sig} \\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, sig);
    return match[0];
  };
  const api = new Function(
    `${grabFn("sliderPctToRaw\\(pct, min, max\\)")}
     ${grabFn("sliderRawToPct\\(raw, min, max\\)")}
     ${grabFn("sliderRawMode\\(gc\\)")}
     ${grabFn("sliderRawValue\\(pct, gc\\)")}
     ${grabFn("formatSliderValue\\(pct, gc\\)")}
     return { sliderPctToRaw, sliderRawToPct, formatSliderValue };`,
  )();
  // The reported bug: speed 50 rendered as 20% on one card and 19% on another.
  // Both now derive from the same helper, so both read 20%.
  assert.equal(api.sliderRawToPct(50, 1, 255), 20);
  // Endpoints are exact for speed (1-255) and brightness (3-255).
  assert.equal(api.sliderRawToPct(1, 1, 255), 1);
  assert.equal(api.sliderRawToPct(255, 1, 255), 100);
  assert.equal(api.sliderPctToRaw(1, 1, 255), 1);
  assert.equal(api.sliderPctToRaw(100, 1, 255), 255);
  assert.equal(api.sliderPctToRaw(1, 3, 255), 3);
  assert.equal(api.sliderPctToRaw(100, 3, 255), 255);
  // Percent → raw → percent is a stable round-trip across the whole range.
  for (let pct = 1; pct <= 100; pct++) {
    for (const [min, max] of [
      [1, 255],
      [3, 255],
    ]) {
      const raw = api.sliderPctToRaw(pct, min, max);
      assert.ok(raw >= min && raw <= max);
      assert.equal(api.sliderRawToPct(raw, min, max), pct);
    }
  }
  // Out-of-range inputs clamp instead of producing NaN or values past bounds.
  assert.equal(api.sliderRawToPct(9999, 1, 255), 100);
  assert.equal(api.sliderPctToRaw(0, 1, 255), 1);
  assert.equal(api.sliderPctToRaw(500, 1, 255), 255);
  // Percent vs raw display formatting.
  assert.equal(api.formatSliderValue(20, { unit: "%" }), "20%");
  assert.equal(
    api.formatSliderValue(20, {
      valueMode: "raw",
      rawMin: 1,
      rawMax: 255,
      rawUnit: "",
    }),
    "50",
  );
  assert.equal(
    api.formatSliderValue(100, { valueMode: "raw", rawMin: 3, rawMax: 255 }),
    "255",
  );
  // Exact device value wins over the mapping while the percent still represents
  // it (128 reads 128, not 129), but a dragged percent uses the mapping.
  const rawGc = { valueMode: "raw", rawMin: 1, rawMax: 255, rawValue: 128 };
  assert.equal(api.formatSliderValue(51, rawGc), "128");
  assert.equal(api.formatSliderValue(60, rawGc), "152");
  // Raw mode falls back to percent unless a full raw range is provided.
  assert.equal(
    api.formatSliderValue(42, { valueMode: "raw", unit: "%" }),
    "42%",
  );
  // Every card derives speed/brightness from the shared helpers, and the raw
  // toggle key is the one global config key.
  assert.match(
    sourceFor("yeelight-cube-clock-card.js"),
    /_rawToPct\(raw\) \{\s*return sliderRawToPct\(raw, 1, 255\)/,
  );
  assert.match(
    sourceFor("yeelight-cube-native-effects-card.js"),
    /sliderRawToPct\(attrs\.native_effect_speed/,
  );
  assert.match(
    src,
    /valueMode: config\.slider_show_raw_value \? "raw" : "percent"/,
  );
  for (const file of [
    "yeelight-cube-lamp-preview-card.js",
    "yeelight-cube-lamp-preview-card-editor.js",
  ])
    assert.match(sourceFor(file), /slider_show_raw_value/);
});

test("removed saved looks are ignored without losing favourites", () => {
  assert.deepEqual(
    sanitizeEffectCollections({
      favourites: ["Rainbow"],
      looks: [{ name: "Evening" }],
    }),
    { favourites: ["Rainbow"] },
  );
  for (const file of [
    "yeelight-cube-native-effects-card.js",
    "yeelight-cube-native-effects-card-editor.js",
  ])
    assert.doesNotMatch(
      sourceFor(file),
      /show_saved_looks|_looksSection|_saveLook|Saved Looks/,
    );
});

test("rotation retains only effects available on every target", () => {
  const card = {
    config: { target_entities: ["light.first", "light.second"] },
    _collections: { favourites: ["Rainbow", "Streamer"] },
    _hass: {
      states: {
        "light.first": {
          state: "on",
          attributes: {
            native_effect_catalog: [rainbow, { name: "Streamer" }],
          },
        },
        "light.second": {
          state: "on",
          attributes: { native_effect_catalog: [rainbow] },
        },
      },
    },
    _effectAvailable: cardMethod("_effectAvailable", {
      getTargetEntities,
      nativeEffectItems,
    }),
  };
  const controls = new ModeControlsController({
    kind: "native",
    available: (name) => card._effectAvailable(name),
  });
  controls.configure(card.config, getTargetEntities(card.config));
  controls.favourites = card._collections.favourites;
  assert.deepEqual(controls.names(), ["Rainbow"]);
  card._hass.states["light.second"].state = "unavailable";
  assert.deepEqual(controls.names(), []);
});

test("rotation order and interval are bounded", () => {
  assert.equal(
    nextRotationEffect(["Rainbow", "Streamer", "63", "Rainbow"], "Rainbow"),
    "Streamer",
  );
  assert.equal(
    nextRotationEffect(["Rainbow", "Streamer"], "Streamer"),
    "Rainbow",
  );
  assert.equal(nextRotationEffect([], "Rainbow"), undefined);
  assert.equal(rotationIntervalMs({ rotation_interval: 1 }), 10000);
  assert.equal(rotationIntervalMs({ rotation_interval: 9999999 }), 604800000);
  assert.equal(rotationIntervalMs({}), 60000);
});

test("rotation only schedules after success and stops for hidden, off or changed targets", async () => {
  const adapter = {
    kind: "native",
    available: () => true,
    ready: () => true,
    disabled: () => false,
    current: () => "Rainbow",
    apply: async () => true,
  };
  const controls = new ModeControlsController(adapter);
  controls.configure({}, ["light.a"]);
  controls.favourites = ["Rainbow", "Streamer"];
  controls.active = true;
  await controls.tick(controls.token);
  assert.ok(controls.timer);
  controls.stop();
  adapter.apply = async () => false;
  controls.active = true;
  await controls.tick(controls.token);
  assert.equal(controls.active, false);
  adapter.ready = () => false;
  controls.active = true;
  await controls.tick(controls.token);
  assert.equal(controls.active, false);
});

test("favourites allow direct removal without changing selection", () => {
  const controls = new ModeControlsController({ current: () => "Rainbow" });
  controls.save(["Rainbow", "Streamer"]);
  controls.save(controls.favourites.filter((name) => name !== "Streamer"));
  assert.deepEqual(controls.favourites, ["Rainbow"]);
  controls.toggleFavourite();
  assert.deepEqual(controls.favourites, []);
  controls.toggleFavourite();
  assert.deepEqual(controls.favourites, ["Rainbow"]);
});

test("shared selectors bind text, preview and carousel navigation without duplicate callbacks", () => {
  const body = sourceFor("style-selector-utils.js").match(
    /export function bindStyleSelectorEvents\(\s*root,\s*\{ select, navigate, setIndex, style \},?\s*\) \{([\s\S]*?)\n\}/,
  )[1];
  const bindStyleSelectorEvents = new Function(
    "root",
    "{ select, navigate, setIndex, style }",
    body,
  );
  const item = { dataset: { mode: "Rainbow" } };
  const arrow = { dataset: { direction: "-1" } };
  const dot = { dataset: { index: "2" } };
  const dropdown = {};
  const shell = {};
  const root = {
    querySelectorAll: (selector) =>
      selector.includes('data-action="navigate"')
        ? [arrow]
        : selector.includes('data-action="set-index"')
          ? [dot]
          : [item],
    querySelector: (selector) =>
      selector.includes("mode-select") ? dropdown : shell,
  };
  const calls = [];
  const options = {
    style: "preview-carousel",
    select: (name) => calls.push(name),
    navigate: (delta) => calls.push(delta),
    setIndex: (index) => calls.push(index),
  };
  bindStyleSelectorEvents(root, options);
  bindStyleSelectorEvents(root, options);
  item.onclick();
  dropdown.onchange({ target: { value: "Streamer" } });
  arrow.onclick({ stopPropagation() {} });
  dot.onclick({ stopPropagation() {} });
  shell.ontouchstart({ touches: [{ clientX: 100 }] });
  shell.ontouchend({ changedTouches: [{ clientX: 20 }] });
  shell.ontouchend({ changedTouches: [{ clientX: 200 }] });
  assert.deepEqual(calls, ["Rainbow", "Streamer", -1, 2, 1]);
  item.onclick = undefined;
  bindStyleSelectorEvents(root, { ...options, style: "preview-wheel" });
  assert.equal(item.onclick, undefined);
  for (const file of [
    "yeelight-cube-clock-card.js",
    "yeelight-cube-native-effects-card.js",
  ])
    assert.match(sourceFor(file), /bindStyleSelectorEvents\(/);
});

test("native wheel selection fulfills the shared controller's promise contract", async () => {
  const callback = sourceFor("yeelight-cube-native-effects-card.js").match(
    /onModeSelect: (async \(name\) => \{[\s\S]*?\n\s*\})/,
  )[1];
  const selected = [];
  const card = {
    _disabled: () => false,
    _select: (name) => selected.push(name),
  };
  const onSelect = new Function(`return (${callback})`).call(card);
  const pending = onSelect("Rainbow");
  assert.equal(typeof pending.catch, "function");
  await pending;
  card._busy = true;
  await onSelect("Streamer");
  assert.deepEqual(selected, ["Rainbow"]);
});

test("named effects exclude raw experimental mode numbers even when explicitly visible", () => {
  const attrs = {
    native_effect: "63",
    native_effect_catalog: [
      rainbow,
      { name: "63", extended: true },
      { name: " 64 " },
      { name: "", extended: true },
      { name: "Prism", extended: true },
    ],
  };
  assert.deepEqual(
    nativeEffectItems(attrs, { show_experimental: true }).map(
      (item) => item.name,
    ),
    ["Rainbow", "Prism"],
  );
  assert.deepEqual(
    nativeEffectItems(attrs, {
      show_experimental: true,
      visible_effects: ["63", "Prism"],
    }).map((item) => item.name),
    ["Prism"],
  );
});

test("native and clock sliders share capsule icon configuration", () => {
  const source = sourceFor("slider-control-utils.js");
  const body = source.match(
    /export function lightSliderConfig\(config, kind, keys = sliderKeys\("slider"\)\) \{([\s\S]*?)\n\}/,
  )[1];
  const keys = {
    iconLeftShow: "slider_show_icon_left",
    iconRightShow: "slider_show_icon_right",
  };
  const config = new Function(
    "sliderConfigToGc",
    `return function(config, kind, keys) {${body}}`,
  )((cfg, map, overrides) => overrides);
  assert.equal(config({}, "brightness", keys).iconLeft, "🌙");
  assert.equal(config({}, "speed", keys).iconRight, "⚡");
  assert.equal(
    config({ slider_show_icon_left: false }, "speed", keys).iconLeft,
    null,
  );
  for (const file of [
    "yeelight-cube-clock-card.js",
    "yeelight-cube-native-effects-card.js",
  ])
    assert.match(sourceFor(file), /return lightSliderConfig\(this.config,/);
});

test("native editor sections follow the card and use shared conditional controls", () => {
  const source = sourceFor("yeelight-cube-native-effects-card-editor.js");
  const body = source.match(/  render\(\) \{([\s\S]*?)\n  \}/)[1];
  const records = {};
  const dependencies = {
    modeActionOptions,
    actionButtonOrder,
    ACTION_BUTTON_KEYS,
    ACTION_BUTTON_LABELS,
    html: template,
    createToggleRow: () => "",
    createButtonGroup: () => "",
    getTargetEntities,
    nativeEffectItems,
    nativeEffectPreviewConfig,
    createYeelightCubeEntityPicker: (...args) => {
      records.picker = args;
    },
    renderMatrixAppearanceSettings: (...args) => {
      (records.matrices ||= []).push(args);
    },
    renderModeSettingsSection: (title, content) => {
      (records.settings ||= []).push(title);
      return { title, content };
    },
    createSliderRow: (...args) => {
      records.interval = args;
    },
    renderActionButtonSettings: () => {
      records.buttons = (records.buttons || 0) + 1;
    },
    renderLightSliderSettings: () => {
      records.sliders = (records.sliders || 0) + 1;
    },
    renderStyleSelectorSettings: (config) => {
      records.selector = true;
      records.selectorPageSize = config.items_per_page;
    },
    renderOrientationSettings: () => {
      records.orientation = true;
    },
    renderExperimentalAvailability: () => "",
    renderColorModeSettings: () => "",
    renderOrderableList: (options) => {
      records.list = options;
    },
    rotationIntervalParts,
    ROTATION_INTERVAL_UNITS,
    sliderKeys: (prefix) => prefix,
  };
  const sharedBody = sourceFor("mode-controls-ui.js").match(
    /export function renderModeControlSettings\([^)]*\) \{([\s\S]*?)\n\}/,
  )[1];
  dependencies.renderModeControlSettings = new Function(
    ...Object.keys(dependencies),
    `return function(area, config, change, items = [], noun = "effect") {${sharedBody}}`,
  )(...Object.values(dependencies));
  const render = new Function(
    ...Object.keys(dependencies),
    `return function() {${body}}`,
  )(...Object.values(dependencies));
  const editor = {
    _config: {
      entity: "light.legacy",
      target_entities: ["light.first", "light.second"],
      visible_effects: ["63", "Rainbow", "Rainbow", "64"],
    },
    hass: {
      states: {
        "light.first": { attributes: { native_effect_catalog: [rainbow] } },
      },
    },
    _section: (id) => {
      (records.sections ||= []).push(id);
    },
    _toggle() {},
    _choices() {},
    _change(key, value) {
      this._config = { ...this._config, [key]: value };
    },
  };
  render.call(editor);
  assert.deepEqual(records.sections, [
    "general",
    "preview",
    "actions",
    "sliders",
    "orientation",
    "colors",
    "presets",
    "effects",
    "favourites",
    "rotation",
  ]);
  assert.equal(records.picker[3], "multiple");
  assert.deepEqual(records.picker[1], ["light.first", "light.second"]);
  assert.deepEqual(records.list.items, ["Rainbow"]);
  assert.equal(records.sliders, 1);
  assert.equal(records.matrices.length, 1);
  assert.equal(records.selector, true);
  assert.equal(records.selectorPageSize, 8);
  assert.equal(records.orientation, true);
  records.picker[2]({ target: { value: ["light.second"] } });
  assert.deepEqual(editor._config.target_entities, ["light.second"]);
  Object.keys(records).forEach((key) => delete records[key]);
  editor._config = {
    ...editor._config,
    show_preview: false,
    show_actions: false,
    show_brightness: false,
    show_animation_speed: false,
    show_device_orientation: false,
    show_gallery: false,
  };
  render.call(editor);
  for (const key of ["matrices", "buttons", "sliders", "orientation", "list"])
    assert.equal(records[key], undefined);
  assert.doesNotMatch(source, /<details|<summary/);
  assert.match(
    sourceFor("yeelight-cube-clock-card-editor.js"),
    /renderEditorSection\(\s*id/,
  );
  assert.match(
    sourceFor("yeelight-cube-lamp-preview-card-editor.js"),
    /renderOrientationSettings\(\s*this\._config/,
  );
  editor._config = {
    ...editor._config,
    target_entities: ["light.first"],
    show_favourites: true,
    show_rotation: true,
  };
  render.call(editor);
  assert.equal(records.matrices.length, 1);
  // Favourites/rotation are simplified: no custom list, no shuffle toggle,
  // no interval slider — just the value+unit interval control.
  assert.ok(records.settings.includes("Favourite Controls"));
  assert.ok(records.settings.includes("Rotation Settings"));
  assert.equal(records.interval, undefined);
  assert.equal(records.list, undefined);
  Object.keys(records).forEach((key) => delete records[key]);
  editor._config.favourites_show_previews = false;
  editor._config.show_rotation = false;
  render.call(editor);
  assert.equal(records.matrices, undefined);
  assert.equal(records.buttons, 1);
  assert.equal(records.interval, undefined);
  assert.doesNotMatch(source, /show_recent|show_devices/);
});

test("shared foldable sections preserve content and support keyboard toggling", () => {
  const source = sourceFor("editor_ui_utils.js");
  const body = source.match(
    /export function renderEditorSection\(id, title, open, onToggle, content\) \{([\s\S]*?)\n\}/,
  )[1];
  const render = new Function(
    "html",
    `return function(id, title, open, onToggle, content) {${body}}`,
  )(template);
  const content = template`<input>`;
  let toggles = 0;
  const result = render(
    "preview",
    "Lamp Preview",
    false,
    () => toggles++,
    content,
  );
  assert.equal(result.values.at(-1), content);
  assert.match(result.strings.join(""), /aria-expanded=/);
  assert.match(result.strings.join(""), /\?inert=/);
  const keydown = result.values.filter(
    (value) => typeof value === "function",
  )[1];
  let prevented = 0;
  for (const key of ["Enter", " ", "ArrowDown"])
    keydown({ key, preventDefault: () => prevented++ });
  assert.equal(toggles, 2);
  assert.equal(prevented, 2);
});

test("multi-target configuration reads the first light and accepts legacy entity", () => {
  const source = sourceFor("yeelight-cube-native-effects-card.js");
  const body = source.match(/  setConfig\(config\) \{([\s\S]*?)\n  \}/)[1];
  const setConfig = new Function(
    "getTargetEntities",
    "effectCollectionKey",
    "readEffectCollections",
    "nativeEffectPreviewConfig",
    "window",
    "closeColorPicker",
    `return function(config) {${body}}`,
  )(
    getTargetEntities,
    effectCollectionKey,
    readEffectCollections,
    nativeEffectPreviewConfig,
    {
      localStorage: { getItem: () => null },
    },
    () => {},
  );
  const first = { attributes: { native_effect: "Rainbow" } };
  const second = { attributes: { native_effect: "Ocean Waves" } };
  const card = {
    _context: 0,
    _stopRotation() {},
    _controls: { configure() {} },
    _hass: { states: { "light.first": first, "light.second": second } },
  };
  setConfig.call(card, { target_entities: ["light.first", "light.second"] });
  assert.equal(card._state, first);
  setConfig.call(card, { entity: "light.second" });
  assert.equal(card._state, second);
  assert.throws(
    () => setConfig.call(card, { target_entities: [] }),
    /at least one/,
  );
});

test("preview and gallery appearance are independent with legacy pixel fallbacks", () => {
  const body = sourceFor("yeelight-cube-native-effects-card.js").match(
    /  _matrixAppearance\(current\) \{([\s\S]*?)\n  \}/,
  )[1];
  const appearance = new Function(
    "nativeEffectPreviewConfig",
    `return function(current) {${body}}`,
  )(nativeEffectPreviewConfig);
  const card = {
    config: {
      pixel_style: "circle",
      pixel_gap: 0,
      lamp_matrix_background: "white",
      lamp_ignore_black_pixels: true,
      lamp_preview_size: 60,
      effect_pixel_style: "rounded",
      effect_spacing_mode: "subtle",
    },
  };
  const current = appearance.call(card, true);
  const gallery = appearance.call(card, false);
  assert.equal(current.width, 60);
  assert.equal(current.pixelStyle, "circle");
  assert.equal(current.pixelGap, 0);
  assert.equal(current.ignoreBlackPixels, true);
  assert.equal(gallery.pixelStyle, "rounded");
  assert.equal(gallery.pixelBoxShadow, true);
  assert.equal(gallery.ignoreBlackPixels, false);
  card.config.lamp_matrix_background = "black";
  assert.equal(appearance.call(card, true).ignoreBlackPixels, false);
});
test("native commands send all targets through the shared service path", async () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-native-effects-card.js",
      import.meta.url,
    ),
    "utf8",
  );
  const body = source.match(
    /  async _command\(service, data, domain = "yeelight_cube", managed = false\) \{([\s\S]*?)\n  \}/,
  )[1];
  const command = new Function(
    "callServiceOnTargetEntities",
    `return async function(service, data, domain = "yeelight_cube", managed = false) {${body}}`,
  )(callServiceOnTargetEntities);
  const calls = [];
  const targets = ["light.first", "light.second"];
  const card = {
    config: { entity: "light.legacy", target_entities: targets },
    _stopRotation() {},
    _context: 0,
    _queue: Promise.resolve(),
    _disabled: () => false,
    _hass: {
      callService: async (domain, service, data) =>
        calls.push({ domain, service, data }),
    },
  };
  for (const [domain, service, data] of [
    [
      "yeelight_cube",
      "set_native_effect",
      { effect: "Rainbow", activate: true },
    ],
    ["yeelight_cube", "set_device_orientation", { orientation: "left" }],
    ["light", "turn_on", { brightness_pct: 60 }],
    ["light", "turn_off", {}],
  ]) {
    assert.equal(await command.call(card, service, data, domain), true);
    assert.deepEqual(calls.at(-1), {
      domain,
      service,
      data: { ...data, entity_id: targets },
    });
  }
  assert.equal(card._busy, false);
  assert.deepEqual(getTargetEntities({ entity: "light.legacy" }), [
    "light.legacy",
  ]);
  assert.deepEqual(
    getTargetEntities({ entity: "light.legacy", target_entities: [] }),
    [],
  );
  card.config = { entity: "light.legacy" };
  await command.call(card, "turn_on", {}, "light");
  assert.equal(calls.at(-1).data.entity_id, "light.legacy");
});

test("preview selection stays local and Apply includes a supported speed draft", async () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-native-effects-card.js",
      import.meta.url,
    ),
    "utf8",
  );
  const selectBody = source.match(/  _select\(name\) \{([\s\S]*?)\n  \}/)[1];
  const applyBody = source.match(
    /  async _apply\(name = this\._effect\(\)\?\.name, managed = false\) \{([\s\S]*?)\n  \}/,
  )[1];
  const calls = [];
  const card = {
    config: { auto_apply: false },
    _stopRotation() {},
    _speedDraft: 70,
    _collections: { favourites: [] },
    _saveCollections(value) {
      this._collections = value;
    },
    _effect: () => rainbow,
    _speedRaw: (value) => Math.round(1 + ((value - 1) * 254) / 99),
    _command: async (service, data) => {
      calls.push({ service, data });
      return true;
    },
  };
  card._apply = new Function(
    "nativeEffectAction",
    `return async function(name, managed = false) {${applyBody}}`,
  )(nativeEffectAction);
  new Function("name", selectBody).call(card, "Rainbow");
  assert.equal(card._selected, "Rainbow");
  assert.equal(calls.length, 0);
  await card._apply("Rainbow");
  assert.deepEqual(calls, [
    {
      service: "set_native_effect",
      data: { effect: "Rainbow", activate: true, speed: 178 },
    },
  ]);
  assert.equal(card._speedDraft, null);
  card._speedDraft = 45;
  card._command = async () => false;
  await card._apply("Streamer");
  assert.equal(card._speedDraft, 45);
  card._context = 1;
  let finish;
  card._command = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = card._apply("Streamer");
  card._context++;
  card._collections = { favourites: [] };
  card._speedDraft = 30;
  finish(true);
  await pending;
  assert.equal(card._speedDraft, 30);
});

test("collections sanitize favourites, discard legacy history and isolate target sets", () => {
  const names = [
    " Rainbow ",
    "Rainbow",
    "63",
    " 64 ",
    "",
    null,
    12,
    "Streamer",
  ];
  assert.deepEqual(
    sanitizeEffectCollections({ favourites: names, recent: names }),
    {
      favourites: ["Rainbow", "Streamer"],
    },
  );
  const many = Array.from({ length: 120 }, (_, index) => `Effect ${index}`);
  const cleaned = sanitizeEffectCollections({ favourites: many, recent: many });
  assert.equal(cleaned.favourites.length, 100);
  assert.equal(cleaned.recent, undefined);
  assert.equal(
    effectCollectionKey(["light.second", "light.first", "light.first"]),
    effectCollectionKey(["light.first", "light.second"]),
  );
  assert.notEqual(
    effectCollectionKey(["light.first"]),
    effectCollectionKey(["light.second"]),
  );
  const saved = new Map([
    [
      effectCollectionKey(["light.first"]),
      JSON.stringify({ favourites: names }),
    ],
  ]);
  const storage = { getItem: (key) => saved.get(key) };
  assert.deepEqual(
    readEffectCollections(storage, effectCollectionKey(["light.first"]))
      .favourites,
    ["Rainbow", "Streamer"],
  );
  assert.deepEqual(
    readEffectCollections(storage, effectCollectionKey(["light.second"]))
      .favourites,
    [],
  );
  for (const value of ["null", "broken json", "[]"])
    assert.deepEqual(readEffectCollections({ getItem: () => value }, "key"), {
      favourites: [],
    });
});

test("collection storage tolerates a blocked localStorage getter on reads and writes", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("denied");
    },
  });
  try {
    assert.deepEqual(readEffectCollections(undefined, "key"), {
      favourites: [],
    });
    const controls = new ModeControlsController({});
    controls.save(["Rainbow", "Rainbow"]);
    assert.deepEqual(controls.favourites, ["Rainbow"]);
    assert.match(controls.error, /session only/);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("numeric active effects cannot become the current named effect", () => {
  const body = sourceFor("yeelight-cube-native-effects-card.js").match(
    /  _effect\(\) \{([\s\S]*?)\n  \}/,
  )[1];
  const effect = new Function(
    "nativeEffectItems",
    `return function() {${body}}`,
  )(nativeEffectItems);
  const card = {
    _attrs: () => ({
      native_effect: "63",
      native_effect_catalog: [{ name: "63" }, rainbow],
    }),
    _items: () => [rainbow],
  };
  assert.equal(effect.call(card), rainbow);
  card._items = () => [];
  assert.equal(effect.call(card), undefined);
});

test("native effect pagination handles shared next/prev actions and clamps pages", () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-native-effects-card.js",
      import.meta.url,
    ),
    "utf8",
  );
  const match = source.match(/  _changePage\(page\) \{([\s\S]*?)\n  \}/);
  const change = new Function("page", match[1]);
  const card = { _page: 0, _totalPages: 3 };
  for (const [action, expected] of [
    ["next", 1],
    ["next", 2],
    ["next", 2],
    ["prev", 1],
    [0, 0],
    ["prev", 0],
  ]) {
    change.call(card, action);
    assert.equal(card._page, expected);
  }
  assert.equal((source.match(/attachPaginationListeners\(/g) || []).length, 1);
  assert.match(source, /firstUpdated\(\) \{\s*attachPaginationListeners/);
});

test("rotation keeps the latest pending direction until Home Assistant echoes it", async () => {
  const calls = [];
  let orientation = "right";
  const controls = new ModeControlsController({
    kind: "native",
    disabled: () => false,
    orientation: () => orientation,
    command: async (service, data) => {
      calls.push(data.orientation);
      return true;
    },
  });
  controls.configure({}, ["light.a"]);
  controls.active = true;
  try {
    await controls.orient(nextOrientation(orientation, 1));
    assert.equal(controls.active, false);
    assert.equal(controls.pendingOrientation, "down");
    await controls.orient(nextOrientation(controls.pendingOrientation, 1));
    assert.deepEqual(calls, ["down", "left"]);
    assert.equal(controls.pendingOrientation, "left");
    orientation = "left";
    controls.update();
    assert.equal(controls.pendingOrientation, null);
  } finally {
    controls.disconnect();
  }
});
test("native effect catalogue respects availability, visibility and order", () => {
  const attrs = {
    native_effect_catalog: [
      rainbow,
      { name: "Prism", extended: true },
      { name: "Streamer" },
    ],
  };
  assert.deepEqual(
    nativeEffectItems(attrs).map((item) => item.name),
    ["Rainbow", "Streamer"],
  );
  assert.deepEqual(
    nativeEffectItems(attrs, {
      visible_effects: ["Streamer", "missing", "Rainbow", "Streamer"],
    }).map((item) => item.name),
    ["Streamer", "Rainbow"],
  );
  assert.equal(nativeEffectItems(attrs, { show_experimental: true }).length, 3);
  assert.equal(
    nativeEffectItems({ ...attrs, native_effect: "Prism" }).length,
    3,
  );
  assert.deepEqual(nativeEffectItems(attrs, { visible_effects: [] }), []);
});

test("native effect previews match the calibrated renderer at the applied mount and speed", () => {
  const attrs = {
    device_orientation: "right",
    native_effect_direction: "Left",
    native_effect_speed: 50,
  };
  assert.equal(nativeEffectDirection(rainbow, attrs), "Right");
  assert.equal(
    nativeEffectDirection({ directions: ["Up", "Down"] }, attrs),
    "Up",
  );
  assert.deepEqual(
    nativeEffectFrame(rainbow, attrs, 2),
    flipMatrixVertical(
      renderNativeEffectOriented("Rainbow", 2 * (0.25 + 50 / 55), "Right"),
    ),
  );
  assert.deepEqual(nativeEffectAction("Rainbow"), {
    effect: "Rainbow",
    activate: true,
  });
  assert.throws(() => nativeEffectAction(""));
});
