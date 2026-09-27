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
