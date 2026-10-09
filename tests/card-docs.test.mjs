import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { updateGalleries } = require("./card-docs-readme.cjs");
const catalogue = {
  clock: {
    title: "Clock",
    variations: { dark: { title: 'Dark & "round"' } },
    editors: {},
  },
};
const start = "<!-- card-docs:clock:variations:start -->";
const end = "<!-- card-docs:clock:variations:end -->";

test("editor entries accept a caption string or a { title, config } object", () => {
  const editors = {
    clock: {
      title: "Clock",
      variations: {},
      editors: {
        general: "Global Settings",
        orientation: {
          title: "Device Orientation",
          config: { show_device_orientation: true },
        },
      },
    },
  };
  const after = updateGalleries(
    "<!-- card-docs:clock:editors:start -->\n<!-- card-docs:clock:editors:end -->",
    editors,
    () => true,
  );
  assert.match(
    after,
    /clock-editor-general\.png" alt="Clock - Global Settings"/,
  );
  assert.match(
    after,
    /clock-editor-orientation\.png" alt="Clock - Device Orientation"/,
  );
  assert.ok(!after.includes("[object Object]"));
});

test("gallery generation preserves manual prose, YAML and line endings", () => {
  const before = `My edited feature table\r\n${start}\r\nold images\r\n${end}\r\n\`\`\`yaml\r\ntitle: Mine\r\n\`\`\`\r\n`;
  const after = updateGalleries(before, catalogue, () => true);
  assert.equal(
    after.slice(0, after.indexOf(start)),
    before.slice(0, before.indexOf(start)),
  );
  assert.equal(
    after.slice(after.indexOf(end)),
    before.slice(before.indexOf(end)),
  );
  assert.match(after, /Dark &amp; &quot;round&quot;/);
  assert.equal(
    updateGalleries(after, catalogue, () => true),
    after,
  );
  assert.ok(!after.replaceAll("\r\n", "").includes("\n"));
});

test("gallery generation rejects missing images and broken markers", () => {
  const source = `${start}\n${end}`;
  assert.throws(
    () => updateGalleries(source, catalogue, () => false),
    /Missing screenshot/,
  );
  assert.throws(
    () => updateGalleries(`${source}${start}`, catalogue, () => true),
    /duplicate/,
  );
  assert.throws(
    () => updateGalleries(`${end}\n${start}`, catalogue, () => true),
    /Reversed/,
  );
});

test("a check accepts new scenarios that are not captured yet", () => {
  const source = `${start}
${end}`;
  const pending = [];
  // Not captured yet: left out of the gallery and reported.
  assert.equal(
    updateGalleries(source, catalogue, () => false, { pending }),
    `${start}
<table>
</table>
${end}`,
  );
  assert.deepEqual(pending, ["images/Cards/generated/clock-dark.png"]);
  // A scenario already in the README whose image disappeared is stale.
  const captured = updateGalleries(source, catalogue, () => true);
  assert.notEqual(
    updateGalleries(captured, catalogue, () => false, { pending: [] }),
    captured,
  );
});

// Capture comparison (card-docs-compare.cjs). A 448x340 grey image with a
// "glyph" block, like the editor captures. Assertions compare booleans or
// identities only: printing two capture buffers exhausts the heap.
const {
  imagesMatch,
  matchingCapture,
  CHANNEL_TOLERANCE,
} = require("./card-docs-compare.cjs");
function capture(edit = () => {}) {
  const [width, height] = [448, 340];
  const data = Buffer.alloc(width * height * 4, 200);
  const png = { width, height, data };
  const set = (x, y, rgb) => data.set([...rgb, 255], (y * width + x) * 4);
  const shift = (x, y, delta) => {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) data[offset + c] += delta;
  };
  for (let y = 100; y < 180; y++)
    for (let x = 160; x < 230; x++) set(x, y, [60, 60, 60]);
  edit(set, png, shift);
  return png;
}

test("captures differing only by anti-aliasing noise match", () => {
  // The real CI failure: one glyph edge column moved by up to 8 levels.
  const noisy = capture((_, __, shift) => {
    for (let y = 100; y < 180; y += 3) shift(229, y, 8);
  });
  assert.equal(imagesMatch(capture(), noisy), true);
  assert.equal(imagesMatch(capture(), capture()), true);
});

test("real content changes do not match", () => {
  // An animation at another phase: a whole block in another colour.
  const recoloured = capture((set) => {
    for (let y = 100; y < 120; y++)
      for (let x = 160; x < 230; x++) set(x, y, [0, 180, 160]);
  });
  assert.equal(imagesMatch(capture(), recoloured), false);
  // One pixel past the tolerance (a missing icon dot) is enough.
  const dot = capture((_, __, shift) =>
    shift(10, 10, -(CHANNEL_TOLERANCE + 1)),
  );
  assert.equal(imagesMatch(capture(), dot), false);
  // A subtle change everywhere (a fade or colour tweak) is not noise.
  const faded = capture((_, png) => {
    for (let i = 0; i < png.data.length; i += 4) png.data[i] -= 4;
  });
  assert.equal(imagesMatch(capture(), faded), false);
  // A layout change.
  const shorter = { ...capture(), height: 339 };
  assert.equal(imagesMatch(capture(), shorter), false);
});

test("two of three captures decide; three different captures fail", () => {
  const odd = { png: capture((set) => set(20, 20, [0, 0, 0])) };
  const a = { png: capture() };
  const b = { png: capture((_, __, shift) => shift(229, 117, 5)) };
  assert.equal(matchingCapture([a, odd, b]) === a, true);
  const other = { png: capture((set) => set(30, 30, [0, 0, 0])) };
  const third = { png: capture((set) => set(40, 40, [0, 0, 0])) };
  assert.equal(matchingCapture([odd, other, third]), null);
});

// The runner (card-docs.cjs): only what can be tested without Home Assistant.
const { fitViewport, runOutcome } = require("./card-docs.cjs");

test("the viewport grows to fit a panel taller than it", async () => {
  // The CI failure: clock-editor-previews grew to 1912 px in a 2000 px viewport.
  let viewport = { width: 1280, height: 2000 };
  const box = { x: 0, y: 120, width: 432, height: 2400 };
  const page = {
    locator: () => ({ boundingBox: async () => box }),
    viewportSize: () => viewport,
    setViewportSize: async (size) => {
      viewport = size;
    },
    evaluate: async () => {},
  };
  await fitViewport(page, "#card-docs");
  assert.equal(viewport.width, 1280);
  assert.ok(viewport.height >= box.y + box.height);
  // A panel that fits leaves the viewport as it is.
  const before = viewport;
  await fitViewport(page, "#card-docs");
  assert.equal(viewport, before);
});

test("one image failing keeps the run green; nothing captured fails it", () => {
  const failures = [
    { file: "clock-editor-previews.png", reason: "Rendered | differently" },
  ];
  const partial = runOutcome(40, failures);
  assert.equal(partial.ok, true);
  assert.equal(partial.warnings.length, 1);
  assert.match(partial.warnings[0], /^::warning .*clock-editor-previews\.png/);
  assert.match(partial.summary, /40 verified, 1 kept from the last run/);
  assert.match(partial.summary, /Rendered \\\| differently/);
  assert.equal(runOutcome(0, failures).ok, false);
  assert.equal(runOutcome(40, []).ok, true);
  assert.equal(runOutcome(40, []).warnings.length, 0);
});
