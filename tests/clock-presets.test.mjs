import assert from "node:assert/strict";
import { renderColorModeSelector } from "../custom_components/yeelight_cube/www/color-mode-selector-utils.js";
import test from "node:test";
import { readFileSync } from "node:fs";
import { escapeHtml } from "../custom_components/yeelight_cube/www/html-escape-utils.js";
import {
  renderActionButtonHTML,
  renderActionButtonGroupHTML,
  actionButtonGroupModel,
} from "../custom_components/yeelight_cube/www/action-button-utils.js";
import {
  clockStylesWithPresets,
  clockPresetKey,
  matchingClockPreset,
  clockStyleAction,
  clockPresetLibrary,
  clockPresetsByKind,
  clockColorPresetAction,
  matchingClockColorPreset,
  visibleClockStyles,
  clockStyleVisibilityConfig,
  clockColorModeOptions,
  clockColorModeVisibilityConfig,
} from "../custom_components/yeelight_cube/www/clock-preset-utils.js";
import {
  clockStyleByName,
  getClockStyles,
  CLOCK_COLOR_MODES,
  CLOCK_MIXER_EFFECTS,
  flipMatrixVertical,
  renderClockFrame,
} from "../custom_components/yeelight_cube/www/clock-preview-utils.js";
import {
  renderNativeEffect,
  effectSupportsColorOverride,
} from "../custom_components/yeelight_cube/www/native-effect-preview.js";
import {
  clockEffectDirection,
  effectOrientation,
  orientFrame,
} from "../custom_components/yeelight_cube/www/effect-orientation.js";

test("all clock styles display calibrated backgrounds independently of native direction", (context) => {
  const RealDate = Date;
  context.mock.method(
    globalThis,
    "Date",
    class extends RealDate {
      constructor() {
        super("2026-09-17T21:53:00");
      }
    },
  );
  const mask = flipMatrixVertical(
    renderClockFrame({ clock_style_id: 6 }, null, null),
  );
  for (const style of getClockStyles(true)) {
    const effect = CLOCK_MIXER_EFFECTS[style.mixer];
    if (!effect) continue;
    const { source, flipH, flipV } = effectOrientation(
      effect,
      clockEffectDirection(effect),
    );
    for (const phase of [0, 0.75, 2.5]) {
      for (const [mode, override] of [
        ["normal", null],
        ["normal", [180, 20, 60]],
        ["bw", null],
        ["red_blue", null],
      ]) {
        const background = orientFrame(
          flipMatrixVertical(
            renderNativeEffect(
              effect,
              phase,
              source,
              effectSupportsColorOverride(effect) ? override : null,
              mode === "normal" ? null : mode,
            ),
          ),
          flipH,
          flipV,
        );
        const expected = mask.map((pixel, index) =>
          pixel.some((value) => value > 0) ? background[index] : [0, 0, 0],
        );
        for (const direction of [undefined, "Up", "Down", "Left", "Right"]) {
          const attrs = {
            clock_style_id: style.id,
            clock_color_mode: mode,
            clock_color_rgb: override,
            native_effect_direction: direction,
          };
          assert.deepEqual(
            flipMatrixVertical(renderClockFrame(attrs, null, null, phase)),
            expected,
            `${style.name}, ${mode}, ${override}, ${direction}, phase=${phase}`,
          );
        }
      }
    }
  }
});

test("Rainbow clock uses calibrated Left regardless of the lamp direction", (context) => {
  const RealDate = Date;
  context.mock.method(
    globalThis,
    "Date",
    class extends RealDate {
      constructor() {
        super("2026-09-17T21:53:00");
      }
    },
  );
  const mask = renderClockFrame({ clock_style_id: 6 }, null, null);
  for (const phase of [0, 0.75, 2.5]) {
    const background = renderNativeEffect("Rainbow", phase, "Down");
    const expected = mask.map((pixel, index) =>
      pixel.some((value) => value > 0) ? background[index] : [0, 0, 0],
    );
    for (const direction of [undefined, "Up", "Down", "Left", "Right"]) {
      assert.deepEqual(
        renderClockFrame(
          { clock_style_id: 1, native_effect_direction: direction },
          null,
          null,
          phase,
        ),
        expected,
        `direction=${direction}, phase=${phase}`,
      );
    }
  }
});

function cardMethods(names, dependencies) {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-clock-card.js",
      import.meta.url,
    ),
    "utf8",
  );
  return Object.fromEntries(
    names.map((name) => {
      const method = source.match(
        new RegExp(`  ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`),
      );
      assert.ok(method, `${name} exists`);
      return [
        name,
        new Function(
          ...Object.keys(dependencies),
          `return function(${method[1]}) {${method[2]}}`,
        )(...Object.values(dependencies)),
      ];
    }),
  );
}

test("inline preset saves only request a name and do not generate a preview", () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/clock-preset-manager.js",
      import.meta.url,
    ),
    "utf8",
  );
  const method = source.match(/  render\(\) \{([\s\S]*?)\n  \}/);
  let frames = 0;
  const html = (strings, ...values) =>
    strings.reduce(
      (result, part, index) => result + part + (values[index] ?? ""),
      "",
    );
  const manager = {
    hass: { services: { yeelight_cube: { save_clock_preset: {} } } },
    editing: true,
    showLibrary: false,
    name: "Mega Yellow",
    color: "#ffee00",
    _rgb: () => [255, 238, 0],
    _actionRow: (content) => content,
    _button: (options) => options.label,
  };
  const invoke = new Function(
    "html",
    "clockPresetLibrary",
    "clockPresetsByKind",
    "flipMatrixVertical",
    "renderClockFrame",
    "SAVE_TRIGGERS",
    `return function() {${method[1]}}`,
  )(
    html,
    () => [],
    () => [],
    (frame) => frame,
    () => {
      frames++;
      return [];
    },
    {
      style: { label: "Save clock style" },
      color_mode: { label: "Save colour mode" },
    },
  );
  for (const kind of ["style", "color_mode"]) {
    manager.kind = kind;
    const markup = invoke.call(manager);
    assert.match(markup, /type="text"/);
    assert.match(markup, /Save/);
    assert.match(markup, /Cancel/);
    assert.doesNotMatch(markup, /type="color"|class="preview"/);
  }
  assert.equal(frames, 0);
  manager.showLibrary = true;
  const markup = invoke.call(manager);
  assert.match(markup, /type="color"/);
  assert.match(markup, /class="preview"/);
  assert.equal(frames, 1);
});

test("all colour modes share ordering and hiding without deleting defaults or losing new saves", () => {
  const builtins = [
    { value: "normal", label: "Normal" },
    { value: "bw", label: "Black & White" },
  ];
  const presets = [
    { id: "pink", name: "Pink", color: [255, 100, 180], kind: "color_mode" },
  ];
  const all = clockColorModeOptions(builtins, presets);
  const config = clockColorModeVisibilityConfig({}, all, [
    "custom:pink",
    "normal",
  ]);
  assert.deepEqual(
    clockColorModeOptions(builtins, presets, config).map((mode) => mode.value),
    ["custom:pink", "normal"],
  );
  presets[0].name = "Light Pink";
  presets.push({
    id: "blue",
    name: "Blue",
    color: [0, 100, 255],
    kind: "color_mode",
  });
  assert.deepEqual(
    clockColorModeOptions(
      builtins,
      presets,
      JSON.parse(JSON.stringify(config)),
    ).map((mode) => mode.value),
    ["custom:pink", "normal", "custom:blue"],
  );
  assert.equal(
    clockColorModeOptions(builtins, presets).some(
      (mode) => mode.value === "bw",
    ),
    true,
  );
  const moved = clockColorModeVisibilityConfig({}, all, ["__pick__", "normal"]);
  assert.deepEqual(
    clockColorModeOptions(builtins, presets.slice(0, 1), moved).map(
      (mode) => mode.value,
    ),
    ["__pick__", "normal"],
  );
  assert.ok(config.hidden_color_modes.includes("__pick__"));
});

test("unified colour row has saved colours and Add without a Custom tab", () => {
  const presets = [
    {
      id: "pink",
      name: "<img src=x onerror=alert(1)>",
      color: [255, 100, 180],
      kind: "color_mode",
    },
  ];
  const card = {
    config: {},
    _hass: { states: { library: { attributes: { clock_presets: presets } } } },
    _currentColorMode: () => "normal",
    ...cardMethods(
      [
        "_renderColorMode",
        "_colorModeOptions",
        "_colorChoiceProps",
        "_colorPresetStyle",
        "_colorPresetShape",
        "_controlGroup",
        "_renderCustomColorControls",
        "_saveKinds",
      ],
      {
        clockColorModeOptions,
        CLOCK_COLOR_MODES,
        clockPresetLibrary,
        escapeHtml,
        renderActionButtonHTML,
        renderActionButtonGroupHTML,
        actionButtonGroupModel,
        renderColorModeSelector,
        rgbToHex: () => "#ff64b4",
      },
    ),
  };
  let markup = card._renderColorMode({});
  assert.ok(markup.includes('data-value="custom:pink"'));
  assert.ok(markup.includes('data-value="__pick__"'));
  assert.doesNotMatch(markup, /data-value="custom"|data-preset-save|<img/);
  presets.push({ ...presets[0], id: "duplicate", name: "Other Pink" });
  card._currentColorMode = () => "custom";
  card._customPresetColor = presets[0].color;
  card._selectedColorPresetId = "duplicate";
  markup = card._renderColorMode({});
  assert.match(markup, /aria-checked="true"[^>]*data-value="custom:duplicate"/);
  card._selectedColorPresetId = null;
  card._selectedColorPresetName = "Other Pink";
  assert.match(
    card._renderColorMode({}),
    /aria-checked="true"[^>]*data-value="custom:duplicate"/,
  );
  card._customMode = true;
  card._customDraft = [255, 100, 180];
  markup = card._renderColorMode({});
  assert.match(markup, /data-preset-save/);
  assert.match(markup, /Change unsaved colour/);
  card.config = clockColorModeVisibilityConfig(
    {},
    card._colorModeOptions(),
    [],
  );
  card._customDraft = null;
  markup = card._renderColorMode({});
  assert.ok(!markup.includes('data-value="__pick__"'));
  assert.doesNotMatch(markup, /role="radio"/);
  card.config = clockColorModeVisibilityConfig(
    {},
    clockColorModeOptions(CLOCK_COLOR_MODES, presets),
    ["__pick__", "normal"],
  );
  markup = card._renderColorMode({});
  assert.ok(
    markup.indexOf('data-value="__pick__"') <
      markup.indexOf('data-value="normal"'),
  );
});

test("custom mode styles support name-only and migrate legacy swatches to Filled", () => {
  const card = {
    config: {},
    ...cardMethods(["_colorPresetStyle", "_colorChoiceProps"], {}),
  };
  const props = card._colorChoiceProps("name", "rounded", {
    label: "Pink",
    color: "#ff99bb",
  });
  assert.equal(props.label, "Pink");
  assert.equal(props.contentMode, "text");
  assert.equal(props.fill, undefined);
  assert.equal(props.swatch, undefined);
  card.config.color_preset_style = "swatch";
  assert.equal(card._colorPresetStyle(), "filled");
  card.config.color_preset_style = "name";
  assert.equal(card._colorPresetStyle(), "name");
});

test("Add opens the picker without sending a colour-mode command", () => {
  const anchor = { tagName: "BUTTON" };
  const opened = [];
  const card = {
    shadowRoot: { querySelector: () => anchor },
    _openCustomPicker: (element) => opened.push(element),
    _callSetClock: () => assert.fail("Add must not apply a mode"),
    ...cardMethods(["_applyColorMode"], {}),
  };
  card._applyColorMode("__pick__");
  assert.deepEqual(opened, [anchor]);
  anchor.tagName = "SELECT";
  anchor.value = "__pick__";
  anchor.options = [
    { value: "normal", defaultSelected: true },
    { value: "__pick__" },
  ];
  card._applyColorMode("__pick__");
  assert.equal(anchor.value, "normal");
  assert.equal(opened.length, 2);
});

test("wheel template dimensions avoid forced layout and legacy markup still measures", () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/wheel-navigation-utils.js",
      import.meta.url,
    ),
    "utf8",
  );
  const body = source.match(
    /const getWheelConfig = \(\) => \{([\s\S]*?)\n  \};/,
  )[1];
  const measure = new Function(
    "config",
    "wheelContainer",
    "wheelItems",
    "window",
    "WHEEL_CONSTANTS",
    body,
  );
  const container = {
    dataset: {
      wheelItemHeight: "65",
      wheelItemStep: "50",
      wheelContainerHeight: "300",
      wheelPaddingTop: "100",
    },
  };
  const constants = { DEFAULT_CONTAINER_HEIGHT: 300, HALF_VISIBLE_ITEMS: 2 };
  const unreadable = [
    {
      get offsetParent() {
        throw new Error("Forced layout");
      },
    },
  ];
  assert.deepEqual(measure({}, container, unreadable, {}, constants), {
    isCompact: false,
    itemHeight: 65,
    itemStep: 50,
    containerHeight: 300,
    baseOffset: -17.5,
  });
  const fallback = measure(
    {},
    { dataset: {} },
    [{ offsetParent: {}, offsetHeight: 65 }],
    {},
    constants,
  );
  assert.equal(fallback.itemStep, 65);
  assert.equal(fallback.baseOffset, 12.5);
});

test("preview style lists reuse snapshots and invalidate on library/config changes", () => {
  let scans = 0;
  const card = {
    config: {},
    _hass: { states: {} },
    _attrs: () => ({}),
    ...cardMethods(["_styleList"], {
      clockPresetLibrary: () => {
        scans++;
        return [];
      },
      getClockStyles,
      clockStylesWithPresets,
      visibleClockStyles,
    }),
  };
  const first = card._styleList();
  for (let index = 0; index < 1000; index++)
    assert.equal(card._styleList(), first);
  assert.equal(scans, 1);
  card._hass = { states: {} };
  assert.notEqual(card._styleList(), first);
  card.config = { custom_visible_styles: true, visible_styles: ["White"] };
  assert.deepEqual(card._styleList().map(clockPresetKey), ["White"]);
  assert.equal(scans, 3);
});

test("gallery reload disconnects its observer and paints only current previews before visibility arrives", () => {
  const current = { hasAttribute: () => true };
  const gallery = Array.from({ length: 100 }, () => ({
    hasAttribute: () => false,
  }));
  const observed = [];
  let disconnects = 0;
  let callback;
  const card = {
    shadowRoot: {
      querySelectorAll: (selector) =>
        selector === "[data-clock-preview]" ? [current] : gallery,
    },
    _io: { disconnect: () => disconnects++ },
    ...cardMethods(["_setupObserver"], {
      IntersectionObserver: class {
        constructor(handler) {
          callback = handler;
        }
        observe(element) {
          observed.push(element);
        }
        disconnect() {
          disconnects++;
        }
      },
    }),
  };
  card._setupObserver();
  assert.deepEqual([...card._visible], [current]);
  assert.equal(observed.length, 101);
  callback([{ target: gallery[0], isIntersecting: true }]);
  assert.equal(card._visible.size, 2);
  card._setupObserver();
  assert.equal(disconnects, 2);
  assert.deepEqual([...card._visible], [current]);
});

test("hostile saved names remain escaped in all text selectors", () => {
  const selectorSource = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/style-selector-utils.js",
      import.meta.url,
    ),
    "utf8",
  );
  const body = selectorSource.match(
    /export function renderTextStyleSelector\(config, items, sel, active\) \{([\s\S]*?)\n\}/,
  )[1];
  const renderTextStyleSelector = new Function(
    "escapeHtml",
    "resolveSelectorShape",
    `return function(config, items, sel, active) {${body}}`,
  )(escapeHtml, () => "rounded");
  const style = {
    name: '\"><img src=x onerror=alert(1)>',
    presetId: "hostile",
  };
  const card = {
    config: {},
    _shownStyles: () => [style],
    _selectorTextScale: () => 1,
    ...cardMethods(["_renderTextSelector"], {
      renderTextStyleSelector,
      escapeHtml,
      clockPresetKey,
      resolveSelectorShape: () => "rounded",
      styleSwatchBackground: () => "#ff99bb",
    }),
  };
  for (const selector of ["dropdown", "chips", "filled"]) {
    const markup = card._renderTextSelector(selector, style);
    assert.doesNotMatch(markup, /<img|<script/);
    assert.ok(markup.includes(escapeHtml(style.name)));
  }
});

test("Custom stays selectable and built-in selections respect the active colour mode", () => {
  const attrs = {
    clock_style: "White",
    clock_style_id: 4,
    clock_color_mode: "normal",
    clock_color: 0x01ff7800,
  };
  const presets = [
    { id: "first", name: "Amber", color: [255, 120, 0] },
    { id: "second", name: "Gold", color: [255, 120, 0] },
  ];
  const styles = clockStylesWithPresets(getClockStyles(false), presets);
  const calls = [];
  let renders = 0;
  const card = {
    _hass: { states: { library: { attributes: { clock_presets: presets } } } },
    _attrs: () => attrs,
    _styleList: () => styles,
    _controlStyles: () => styles,
    _callSetClock: (data) => calls.push(data),
    render: () => renders++,
    ...cardMethods(
      [
        "_applyStyle",
        "_applyColorMode",
        "_currentColorMode",
        "_activeStylePreset",
        "_currentStyle",
        "_onPresetSaved",
        "_previewAttrs",
      ],
      {
        clockPresetKey,
        clockPresetLibrary,
        clockStylesWithPresets,
        matchingClockPreset,
        clockStyleAction,
        clockStyleByName,
        getClockStyles,
        clockColorToRgb: (packed) =>
          typeof packed === "number"
            ? [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
            : null,
        rgbToHex: () => "#ff7800",
        hexToRgb: () => [255, 120, 0],
      },
    ),
  };
  assert.equal(card._currentColorMode(attrs), "normal");
  card._applyColorMode("custom");
  assert.equal(card._currentColorMode(attrs), "custom");
  assert.equal(renders, 1);
  assert.equal(card._currentStyle().name, "White");
  card._customDraft = [255, 120, 0];
  card._applyStyle("White");
  assert.equal(card._currentColorMode(attrs), "custom");
  assert.equal("color" in calls.at(-1), false);
  card._applyStyle("custom:second");
  assert.equal(card._currentColorMode(attrs), "normal");
  assert.equal(card._currentStyle().presetId, "second");
  card._applyColorMode("bw");
  attrs.clock_color_mode = "bw";
  assert.equal(card._currentStyle().presetId, "second");
  card._applyColorMode("normal");
  assert.deepEqual(calls.at(-1), { color_mode: "normal" });
  attrs.clock_color_mode = "normal";
  assert.equal(card._currentStyle().presetId, "second");
  assert.equal("clock_color_rgb" in card._previewAttrs(styles[0]), false);
  card._applyStyle("Rainbow");
  assert.equal(calls.at(-1).color, "clear");
  card._applyColorMode("bw");
  assert.equal(card._customMode, false);
  card._onPresetSaved({
    kind: "style",
    name: "New Amber",
    color: [255, 120, 0],
  });
  assert.equal(card._revealSavedStyle, "New Amber");
  assert.deepEqual(calls.at(-1), {
    style: "White",
    color_mode: "normal",
    color: [255, 120, 0],
    activate: true,
  });
  assert.equal(renders, 8);
  card._selectedStylePresetId = null;
  card._styleList = () => styles.filter((style) => style.presetId !== "first");
  assert.equal(card._currentStyle().presetId, "second");
});

test("save controls require a draft, including when its RGB already exists", () => {
  const presets = [
    { id: "style", name: "Amber clock", color: [255, 120, 0] },
    {
      id: "mode",
      name: "Amber mode",
      color: [255, 120, 0],
      kind: "color_mode",
    },
  ];
  const card = {
    config: {},
    _hass: { states: { library: { attributes: { clock_presets: presets } } } },
    _renderColorChoices: () => "",
    ...cardMethods(["_renderCustomColorControls", "_saveKinds"], {
      clockPresetLibrary,
      clockPresetsByKind,
      matchingClockColorPreset,
    }),
  };
  const attrs = { clock_style_id: 4, clock_color: 0x01ff7800 };
  assert.doesNotMatch(
    card._renderCustomColorControls(attrs),
    /data-preset-save/,
  );
  card._customDraft = [255, 120, 0];
  assert.match(card._renderCustomColorControls(attrs), /data-preset-save/);
  card.config.show_save_color_mode_button = false;
  assert.match(card._renderCustomColorControls(attrs), /data-preset-save/);
  card.config.show_save_clock_style_button = false;
  assert.doesNotMatch(
    card._renderCustomColorControls(attrs),
    /data-preset-save/,
  );
});

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

test("same-colour styles retain the explicitly selected identity", () => {
  const styles = clockStylesWithPresets(
    [],
    [
      { id: "first", name: "Amber", color: [255, 120, 0] },
      { id: "second", name: "Gold", color: [255, 120, 0] },
    ],
  );
  const attrs = { clock_style_id: 4, clock_color: 0x01ff7800 };
  assert.equal(matchingClockPreset(styles, attrs, "second"), styles[1]);
  assert.equal(matchingClockPreset(styles, attrs, "deleted"), styles[0]);
  assert.equal(
    matchingClockPreset(
      styles,
      { ...attrs, clock_color: 0x01010203 },
      "second",
    ),
    null,
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

test("new styles survive reload and explicit hide/reorder survives later saves", () => {
  const builtins = [
    { id: 4, name: "White" },
    { id: 1, name: "Rainbow" },
  ];
  const presets = [{ id: "first", name: "Amber", color: [255, 120, 0] }];
  let config = { custom_visible_styles: true, visible_styles: ["Rainbow"] };
  const styles = clockStylesWithPresets(builtins, presets);
  const keys = (items) => items.map(clockPresetKey);
  const reload = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(keys(visibleClockStyles(styles, reload(config))), [
    "Rainbow",
    "custom:first",
  ]);
  assert.deepEqual(config.visible_styles, ["Rainbow"]);
  config = clockStyleVisibilityConfig(config, styles, [
    "custom:first",
    "Rainbow",
  ]);
  assert.deepEqual(keys(visibleClockStyles(styles, reload(config))), [
    "custom:first",
    "Rainbow",
  ]);
  config = clockStyleVisibilityConfig(config, styles, ["Rainbow"]);
  const updated = clockStylesWithPresets(builtins, [
    ...presets,
    { id: "second", name: "Gold", color: [255, 120, 0] },
  ]);
  assert.deepEqual(keys(visibleClockStyles(updated, reload(config))), [
    "Rainbow",
    "custom:second",
  ]);
  config = clockStyleVisibilityConfig(config, updated, [
    "custom:second",
    "custom:first",
    "Rainbow",
  ]);
  assert.deepEqual(keys(visibleClockStyles(updated, reload(config))), [
    "custom:second",
    "custom:first",
    "Rainbow",
  ]);
  assert.deepEqual(
    keys(
      visibleClockStyles(updated, { ...config, custom_visible_styles: false }),
    ),
    keys(updated),
  );
});

test("card colour actions leave Custom empty until a pick and ignore deleted presets", () => {
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
    _styleList: () => [],
    _callSetClock: (data) => calls.push(data),
    render() {},
  };
  for (const name of [
    "_applyColorMode",
    "_applyColor",
    "_applyColorPreset",
    "_currentColorMode",
    "_activeStylePreset",
  ]) {
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
      "matchingClockPreset",
      "clockStylesWithPresets",
      `return function(${method[1]}) {${method[2]}}`,
    )(
      clockColorToRgb,
      hexToRgb,
      rgbToHex,
      clockPresetLibrary,
      clockPresetsByKind,
      clockColorPresetAction,
      matchingClockPreset,
      clockStylesWithPresets,
    );
  }
  card._applyColorMode("normal");
  assert.deepEqual(calls.at(-1), { color_mode: "normal", color: "clear" });
  attrs.clock_color = null;
  const beforeCustom = calls.length;
  card._applyColorMode("custom");
  assert.equal(calls.length, beforeCustom);
  assert.equal(card._customDraft, null);
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
  attrs.clock_color = 0x01010203;
  card._applyColorMode("bw");
  attrs.clock_color_mode = "bw";
  card._applyColorMode("normal");
  assert.deepEqual(calls.at(-1), { color_mode: "normal", color: "clear" });
});

test("saving a custom colour as a clock style forgets it as the Custom colour", () => {
  const attrs = {
    clock_style: "White",
    clock_style_id: 4,
    clock_color_mode: "normal",
    clock_color: null,
  };
  const presets = [];
  const styles = clockStylesWithPresets(getClockStyles(false), presets);
  const calls = [];
  const card = {
    _hass: { states: { library: { attributes: { clock_presets: presets } } } },
    _attrs: () => attrs,
    _styleList: () => styles,
    _callSetClock: (data) => calls.push(data),
    render() {},
    ...cardMethods(
      [
        "_applyColorMode",
        "_applyColor",
        "_currentColorMode",
        "_activeStylePreset",
        "_onPresetSaved",
      ],
      {
        clockPresetKey,
        clockPresetLibrary,
        clockStylesWithPresets,
        matchingClockPreset,
        clockColorToRgb: (packed) =>
          typeof packed === "number"
            ? [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
            : null,
        rgbToHex: (rgb) =>
          `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
        hexToRgb: (hex) =>
          [1, 3, 5].map((offset) =>
            parseInt(hex.slice(offset, offset + 2), 16),
          ),
      },
    ),
  };
  // Enter Custom and pick blue: a genuine free-colour choice.
  card._applyColorMode("custom");
  card._applyColor([40, 100, 220]);
  assert.equal(card._lastCustomHex, "#2864dc");
  // Save it as a new clock style; the card applies it as White + that colour.
  card._onPresetSaved({
    kind: "style",
    name: "Super Blue",
    color: [40, 100, 220],
  });
  presets.push({ id: "sb", name: "Super Blue", color: [40, 100, 220] });
  attrs.clock_style = "White";
  attrs.clock_style_id = 4;
  attrs.clock_color = 0x01000000 + (40 << 16) + (100 << 8) + 220;
  attrs.clock_color_mode = "normal";
  card._styleList = () =>
    clockStylesWithPresets(getClockStyles(false), presets);
  // Now the lamp echoes the saved style; entering Custom must NOT reuse blue.
  assert.equal(card._currentColorMode(attrs), "normal");
  assert.equal(card._lastCustomHex, null);
  const beforeCustom = calls.length;
  card._applyColorMode("custom");
  assert.equal(calls.length, beforeCustom);
  assert.equal(card._customDraft, null);
  assert.equal(card._currentColorMode(attrs), "custom");
});

test("a just-saved style reads as Normal before the library echoes it back", () => {
  // The HA library update lags the state echo; during that window the saved
  // White+colour must NOT be mistaken for a free Custom override.
  const attrs = {
    clock_style: "Rainbow",
    clock_style_id: 1,
    clock_color_mode: "normal",
    clock_color: null,
  };
  const presets = [];
  const calls = [];
  const card = {
    _hass: { states: { library: { attributes: { clock_presets: presets } } } },
    _attrs: () => attrs,
    _styleList: () => clockStylesWithPresets(getClockStyles(false), presets),
    _controlStyles: () =>
      clockStylesWithPresets(getClockStyles(false), presets),
    _callSetClock: (data) => calls.push(data),
    render() {},
    ...cardMethods(
      [
        "_applyStyle",
        "_applyColorMode",
        "_currentColorMode",
        "_activeStylePreset",
        "_onPresetSaved",
      ],
      {
        clockPresetKey,
        clockPresetLibrary,
        clockStylesWithPresets,
        matchingClockPreset,
        clockStyleAction,
        clockColorToRgb: (packed) =>
          typeof packed === "number"
            ? [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
            : null,
        rgbToHex: (rgb) =>
          `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
        hexToRgb: (hex) =>
          [1, 3, 5].map((offset) =>
            parseInt(hex.slice(offset, offset + 2), 16),
          ),
      },
    ),
  };
  // Save purple as a style; the state echoes White+purple, but the library has
  // NOT added the preset yet (presets stays empty).
  card._onPresetSaved({
    kind: "style",
    name: "Super Purple",
    color: [150, 40, 220],
  });
  attrs.clock_style = "White";
  attrs.clock_style_id = 4;
  attrs.clock_color = 0x01000000 + (150 << 16) + (40 << 8) + 220;
  // No preset match is possible yet, but the pending flag keeps it Normal.
  assert.equal(card._activeStylePreset(attrs), null);
  assert.equal(card._currentColorMode(attrs), "normal");
  // Selecting another built-in style during this window drops the colour.
  card._applyStyle("Rainbow");
  assert.equal(calls.at(-1).color, "clear");
  assert.equal(card._customMode, false);
});

test("renderClockFrame decodes the lamp's clock_color so every card shares one override", () => {
  // The lamp state exposes the custom colour as a firmware ARGB integer
  // (clock_color); cards that forward raw attributes (lamp-preview card) must
  // render the same override as those that pass a decoded clock_color_rgb.
  const base = {
    clock_style: "White",
    clock_style_id: 4,
    clock_content: "time",
    clock_color_mode: "normal",
  };
  const yellow = [255, 238, 0];
  const fromInt = renderClockFrame(
    { ...base, clock_color: 0x01000000 + (255 << 16) + (238 << 8) + 0 },
    null,
    null,
  );
  const fromRgb = renderClockFrame(
    { ...base, clock_color_rgb: yellow },
    null,
    null,
  );
  const litInt = fromInt.filter((p) => p[0] | p[1] | p[2]);
  assert.ok(litInt.length > 0, "clock renders lit pixels");
  assert.deepEqual(fromInt, fromRgb);
  assert.ok(litInt.every((p) => p[0] === 255 && p[1] === 238 && p[2] === 0));
  // A palette colour mode still overrides the custom colour (not flat-filled).
  const bw = renderClockFrame(
    {
      ...base,
      clock_color_mode: "bw",
      clock_color: 0x01000000 + (255 << 16) + (238 << 8) + 0,
    },
    null,
    null,
  );
  const litBw = bw.filter((p) => p[0] | p[1] | p[2]);
  assert.ok(litBw.every((p) => p[0] === 255 && p[1] === 255 && p[2] === 255));
});
