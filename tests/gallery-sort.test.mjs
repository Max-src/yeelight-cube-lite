// The effect and clock galleries' order: the same default on both cards,
// and the sort toggle beside the family filter (Default, A → Z, By family).
// tests/test_effect_names.py checks the default against the lamp's catalogue.
import assert from "node:assert/strict";
import test from "node:test";
import { sortGalleryItems } from "../custom_components/yeelight_cube/www/card-config.js";
import { GallerySort } from "../custom_components/yeelight_cube/www/effect-families.js";
import { clockStylesWithPresets } from "../custom_components/yeelight_cube/www/clock-preset-utils.js";
import { getClockStyles } from "../custom_components/yeelight_cube/www/clock-preview-utils.js";

const items = [
  { name: "Waves", family: "waves" },
  { name: "Fire", family: "glow" },
  { name: "Aurora", family: "glow" },
  { name: "Starry Sky", family: "sparkles" },
  { name: "Breathing", family: "waves" },
];
const names = (list) => list.map((item) => item.name);

test("a gallery sorts by name, by family in the card's order, or not at all", () => {
  const byName = (item) => item.name;
  assert.deepEqual(names(sortGalleryItems({}, items, byName)), names(items));
  assert.deepEqual(
    names(sortGalleryItems({}, items, byName, "name")),
    ["Aurora", "Breathing", "Fire", "Starry Sky", "Waves"],
  );
  // As the family filter lists them; within one, as the card does.
  assert.deepEqual(
    names(sortGalleryItems({}, items, byName, "family")),
    ["Waves", "Breathing", "Fire", "Aurora", "Starry Sky"],
  );
  // The card's Order, when none is picked on the card.
  assert.deepEqual(
    names(sortGalleryItems({ gallery_sort: "name" }, items, byName)),
    names(sortGalleryItems({}, items, byName, "name")),
  );
});

test("the sort toggle follows the card's Order until one is picked", () => {
  const host = { config: { gallery_sort: "name" }, requestUpdate() {} };
  const sort = new GallerySort(host, "yeelight_cube_test_sort");
  assert.equal(sort.value(), "name");
  host.config = { gallery_sort: "manual" };
  assert.equal(sort.value(), "manual");
  sort.gallery().onChange("family");
  assert.equal(sort.value(), "family");
  assert.equal(sort.gallery().value, "family");
  // Hidden: the card's Order again.
  host.config = { gallery_sort: "name", show_sort: false };
  assert.equal(sort.value(), "name");
  assert.equal(sort.gallery().hidden, true);
});

test("the clock card lists its effect styles first, then the colours and custom styles", () => {
  const styles = clockStylesWithPresets(getClockStyles(false), [
    { id: "p1", name: "My orange", color: [255, 120, 0] },
  ]);
  // The official clocks over an effect, as on the effect card.
  assert.deepEqual(
    styles.slice(0, 3).map((style) => style.name),
    ["Spectrum", "Waves", "Rainbow"],
  );
  const solid = styles.map((style) => style.solid);
  assert.deepEqual(solid, [...solid].sort((a, b) => a - b));
  assert.equal(styles.at(-1).name, "My orange");
});
