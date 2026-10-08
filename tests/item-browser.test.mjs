import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderPagination } from "../custom_components/yeelight_cube/www/pagination-utils.js";
import {
  renderItemIndicators,
} from "../custom_components/yeelight_cube/www/item-browser-utils.js";
import {
  getClockStyles,
  clockStyleColorModeState,
  clockStyleRespondsToCustomColor,
  clockStyleIndicators,
} from "../custom_components/yeelight_cube/www/clock-preview-utils.js";
import { clockStylesWithPresets } from "../custom_components/yeelight_cube/www/clock-preset-utils.js";
import { renderGalleryDisplay } from "../custom_components/yeelight_cube/www/gallery-display-utils.js";

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
  const method = source.match(/  _availableStyles\(\) \{([\s\S]*?)\n  \}/)[1];
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
  // Custom color behaves like a mode: only color-reacting styles remain.
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

test("custom color response covers solids and effects, excludes fixed presets", () => {
  assert.equal(clockStyleRespondsToCustomColor(style("Rainbow")), true);
  assert.equal(clockStyleRespondsToCustomColor(style("Ocean Waves")), true);
  assert.equal(clockStyleRespondsToCustomColor(style("White")), true);
  assert.equal(clockStyleRespondsToCustomColor(style("Sunset")), false);
  // Saved presets are fixed-color styles (Normal/B&W only), not custom mode.
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
    /Compatibility indicators|Show filter and sort controls|Inspect color mode|style_sort|style_filter/,
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

test("shared controls escape content and expose accessible labels", () => {
  const html = renderItemIndicators([
    { label: "<img src=x>", description: '" unsafe', state: "responds" },
  ]);
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes('aria-label="&quot; unsafe"'));
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
  for (const mode of ["list", "strip", "wheel"]) {
    const html = renderGalleryDisplay(items, mode, {
      showTitles: false,
      rows: 5,
      cols: 20,
    });
    assert.equal((html.match(/class="item-indicator"/g) || []).length, 5, mode);
  }
});

