import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderPagination } from "../custom_components/yeelight_cube/www/pagination-utils.js";
import {
  browseItems,
  renderItemIndicators,
  renderItemBrowserToolbar,
  bindItemBrowser,
} from "../custom_components/yeelight_cube/www/item-browser-utils.js";
import {
  getClockStyles,
  clockStyleColorModeState,
  clockStyleRespondsToCustomColor,
  clockStyleIndicators,
  clockStyleBrowserOptions,
} from "../custom_components/yeelight_cube/www/clock-preview-utils.js";
import { clockStylesWithPresets } from "../custom_components/yeelight_cube/www/clock-preset-utils.js";
import {
  renderGalleryDisplay,
  renderGridMode,
  renderInlineMode,
} from "../custom_components/yeelight_cube/www/gallery-display-utils.js";

const styles = clockStylesWithPresets(getClockStyles(true), [
  { id: "amber", name: "Amber", color: [255, 120, 0] },
]);
const style = (name) => styles.find((item) => item.name === name);

test("clock responding-only filtering is always on", () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-clock-card.js",
      import.meta.url,
    ),
    "utf8",
  );
  const method = source.match(/  _shownStyles\(\) \{([\s\S]*?)\n  \}/)[1];
  const shownStyles = new Function(
    "clockStyleColorModeState",
    "clockStyleRespondsToCustomColor",
    "clockColorToRgb",
    `return function () {${method}}`,
  )(
    clockStyleColorModeState,
    clockStyleRespondsToCustomColor,
    () => card._attrs().clock_color ?? null,
  );
  const items = Object.freeze([
    style("Red"),
    style("Spectrum"),
    style("Rainbow"),
    style("White"),
  ]);
  const card = {
    config: {
      style_filter: "all",
      style_sort: "name",
      style_indicators: "all",
      show_style_browser: true,
    },
    _styleList: () => items,
    _attrs: () => ({ clock_color_mode: "red_blue" }),
    _currentColorMode(a) {
      const mode = a.clock_color_mode || "normal";
      if (mode !== "normal") return mode;
      return a.clock_color ? "custom" : "normal";
    },
  };
  assert.deepEqual(
    shownStyles.call(card).map((item) => item.name),
    ["Spectrum", "Rainbow"],
  );
  // Always filters: a legacy show_only_responding_styles=false config is ignored.
  card.config.show_only_responding_styles = false;
  assert.deepEqual(
    shownStyles.call(card).map((item) => item.name),
    ["Spectrum", "Rainbow"],
  );
  card._attrs = () => ({ clock_color_mode: "normal" });
  assert.deepEqual(shownStyles.call(card), items);
  // Custom colour behaves like a mode: only colour-reacting styles remain.
  card._attrs = () => ({ clock_color_mode: "normal", clock_color: 0x01ffee00 });
  assert.deepEqual(
    shownStyles.call(card).map((item) => item.name),
    ["Red", "Spectrum", "Rainbow", "White"],
  );
  assert.doesNotMatch(
    source,
    /renderItemIndicators|renderItemBrowserToolbar|data-browser/,
  );
});

test("custom colour response covers solids and effects, excludes fixed presets", () => {
  assert.equal(clockStyleRespondsToCustomColor(style("Rainbow")), true);
  assert.equal(clockStyleRespondsToCustomColor(style("Ocean Waves")), true);
  assert.equal(clockStyleRespondsToCustomColor(style("White")), true);
  assert.equal(clockStyleRespondsToCustomColor(style("Sunset")), false);
  // Saved presets are fixed-colour styles (Normal/B&W only), not custom mode.
  assert.equal(clockStyleRespondsToCustomColor(style("Amber")), false);
  assert.equal(clockStyleRespondsToCustomColor({ name: "Unknown" }), false);
});

test("clock pagination supports 16 items per page and zero disables pagination", () => {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-clock-card-editor.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    readFileSync(
      new URL(
        "../custom_components/yeelight_cube/www/style-selector-ui.js",
        import.meta.url,
      ),
      "utf8",
    ),
    /\{ min: 0, max: 16, step: 1 \}/,
  );
  assert.doesNotMatch(source, /show_only_responding_styles/);
  assert.match(source, /allowOriginal: true/);
  assert.doesNotMatch(
    source,
    /Compatibility indicators|Show filter and sort controls|Inspect colour mode|style_sort|style_filter/,
  );
  const items = Array.from({ length: 35 }, (_, index) => index);
  assert.deepEqual(
    renderPagination({ items, currentPage: 0, itemsPerPage: 16 }).items,
    items.slice(0, 16),
  );
  assert.deepEqual(
    renderPagination({ items, currentPage: 1, itemsPerPage: 16 }).items,
    items.slice(16, 32),
  );
  assert.deepEqual(
    renderPagination({ items, currentPage: 2, itemsPerPage: 16 }).items,
    items.slice(32),
  );
  assert.deepEqual(
    renderPagination({ items, currentPage: 0, itemsPerPage: 0 }).items,
    items,
  );
});

test("clock responses distinguish palettes, B&W, solids, presets and unknowns", () => {
  for (const mode of [
    "bw",
    "red_blue",
    "white_orange",
    "blue_yellow",
    "purple_orange",
  ]) {
    assert.equal(clockStyleColorModeState(style("Rainbow"), mode), "responds");
  }
  assert.equal(
    clockStyleColorModeState(style("Ocean Waves"), "bw"),
    "responds",
  );
  assert.equal(
    clockStyleColorModeState(style("Ocean Waves"), "red_blue"),
    "unchanged",
  );
  assert.equal(clockStyleColorModeState(style("Red"), "bw"), "responds");
  assert.equal(clockStyleColorModeState(style("White"), "bw"), "unchanged");
  assert.equal(
    clockStyleColorModeState(style("White"), "bw", [255, 0, 0]),
    "responds",
  );
  assert.equal(clockStyleColorModeState(style("Amber"), "bw"), "responds");
  assert.equal(
    clockStyleColorModeState(style("Amber"), "red_blue"),
    "unchanged",
  );
  assert.equal(clockStyleColorModeState({ name: "Unknown" }, "bw"), "unknown");
  assert.equal(clockStyleColorModeState(style("Rainbow"), "future"), "unknown");
  assert.deepEqual(
    clockStyleIndicators(style("Rainbow"), "selected", "normal"),
    [],
  );
  assert.equal(
    clockStyleIndicators(style("Rainbow"), "all", "normal").length,
    5,
  );
});

test("browsing is stable, leaves saved order untouched and Normal never restricts", () => {
  const source = Object.freeze([
    style("Red"),
    style("Rainbow"),
    style("Spectrum"),
    style("White"),
  ]);
  const options = clockStyleBrowserOptions("red_blue");
  assert.deepEqual(
    browseItems(source, { ...options, filter: "responds" }).map(
      (item) => item.name,
    ),
    ["Rainbow", "Spectrum"],
  );
  assert.deepEqual(
    browseItems(source, { ...options, sort: "responds" }).map(
      (item) => item.name,
    ),
    ["Rainbow", "Spectrum", "Red", "White"],
  );
  assert.deepEqual(
    browseItems(source, {
      ...clockStyleBrowserOptions("normal"),
      filter: "responds",
    }),
    source,
  );
  assert.deepEqual(
    browseItems(source, { filter: "future", sort: "future" }),
    source,
  );
  assert.deepEqual(browseItems([], options), []);
});

test("shared controls escape content and expose accessible labels", () => {
  const html = renderItemIndicators([
    { label: "<img src=x>", description: '" unsafe', state: "responds" },
  ]);
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes('aria-label="&quot; unsafe"'));
  assert.ok(renderItemBrowserToolbar({ count: 0, total: 5 }).includes("0 / 5"));
});

test("all shared gallery layouts render structured indicators independently of titles", () => {
  const items = [
    {
      title: "Rainbow",
      dataMode: "Rainbow",
      colorData: Array.from({ length: 100 }, () => [255, 0, 0]),
      indicators: clockStyleIndicators(style("Rainbow"), "all", "normal"),
    },
  ];
  for (const mode of ["list", "grid", "strip", "compact", "wheel"]) {
    const html = renderGalleryDisplay(items, mode, {
      showTitles: false,
      rows: 5,
      cols: 20,
    });
    assert.equal((html.match(/class="item-indicator"/g) || []).length, 5, mode);
  }
  for (const render of [renderGridMode, renderInlineMode])
    assert.ok(render(items).includes('class="item-indicators"'));
});

test("rebinding shared controls replaces callbacks instead of duplicating actions", () => {
  const select = new EventTarget();
  select.value = "enabled";
  const root = {
    querySelectorAll: (selector) =>
      selector === "[data-browser-filter]" ? [select] : [],
  };
  const calls = [];
  bindItemBrowser(root, { onFilter: () => calls.push("stale") });
  bindItemBrowser(root, { onFilter: (value) => calls.push(value) });
  select.dispatchEvent(new Event("change"));
  assert.deepEqual(calls, ["enabled"]);
});

test("shared browsing accepts non-clock predicates and sort definitions", () => {
  const items = [
    { id: "first", brightness: 20 },
    { id: "second", brightness: 80 },
    { id: "third", brightness: 60 },
  ];
  const result = browseItems(items, {
    filter: "bright",
    sort: "brightness",
    filters: [{ value: "bright", test: (item) => item.brightness >= 50 }],
    sorts: [
      {
        value: "brightness",
        compare: (first, second) => first.brightness - second.brightness,
      },
    ],
  });
  assert.deepEqual(
    result.map((item) => item.id),
    ["third", "second"],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["first", "second", "third"],
  );
});
