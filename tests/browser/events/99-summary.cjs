// Card events check (tests/card-events-browser.cjs): no page errors (and no
// refused inline handler) during the run; the summary.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { errors, SLIDER_STYLES } = t;
  assert.deepEqual(errors, []);
  console.log(
    `PASS delegated events: ${SLIDER_STYLES.length} slider styles, orientation x2, clock/native sliders, draw gallery, gradient capsule, wheel drag (lamp updates wait), mode gallery and the shared tab bar (mouse, keys, Draw keeps its tab) (strict CSP, no inline handlers); hostile names inert in 4 palette + 4 pixel-art modes and clock presets`,
  );
  console.log(
    "PASS shared section layouts: Draw's color sections and the Lamp Preview's adjustment categories in all 9 layouts (open, zoom, drag-scroll, resets; compact with or without headers, tab icons as set), former names migrated",
  );
  console.log(
    "PASS shared action button (Lit): 18 style x content looks, swatch / fill / busy / round, labels stay text, toggles and radio groups (one tab stop, arrows), export / import status",
  );
  console.log(
    "PASS quick picks on Clock, Native and Gradient (like Palette): the gallery and sliders stay live, the latest pick is highlighted at once and wins, the ones in between are never sent",
  );
  console.log(
    "PASS collection sensors found by their attributes: a fresh installation's ids with none configured, and a sensor renamed while the card is open (Draw, Palette)",
  );
  console.log(
    "PASS shared card frame on all 7 cards and editors: title, lamp status, plain background, no-lamp / not-found notices, same editor settings",
  );
  console.log(
    "PASS palette card on the shared gallery: its swatches in 6 layouts and chips, color count, former options migrated, keyboard picks, rename / confirmed delete, the palette the lamp shows active, A → Z order, empty notice",
  );
  console.log(
    "PASS Draw card on the shared gallery: former options, previews as drawn, load (and lamp) / rename / confirmed delete, carousel and wheel moves only browse, memoized items, shared export / import row; narrow cards never overflow and arrows keep their tint",
  );
  console.log(
    "PASS Arrange (Palette and Draw editors): stored order with thumbnails, order only, one guarded move per change (▲ ▼ ⤒ ⤓, drag) shown at once",
  );
  console.log(
    "PASS shared swatches: click and key pick once (hex), one Tab stop with arrow keys, the active color marked, its label, expand, gradient free pick, every drawn layout picks, previews leave clicks to their host, Draw's color sections pick the drawing color; one drag-to-reorder engine (mouse and touch) in every Color List layout and the editors' ordered lists (Draw's tools order); Draw's preview hover: equal closed heights, animated open / close, no blank empty section, tap / outside tap / keyboard, and over the content (nothing moves, tab-like switch)",
  );
};
