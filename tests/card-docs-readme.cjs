const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalogue = require("./card-docs-catalogue.json");

const root = path.resolve(__dirname, "..");
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

// `pending` (an array) accepts catalogue entries whose screenshot does not
// exist yet: they are left out of the gallery and listed there instead of
// failing. The Documentation Screenshots workflow captures them and then
// refreshes the galleries strictly.
function updateGalleries(
  source,
  definitions = catalogue,
  exists = (file) => fs.existsSync(path.join(root, file)),
  { pending } = {},
) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  for (const [kind, definition] of Object.entries(definitions)) {
    for (const group of ["variations", "editors"]) {
      const entries = Object.entries(definition[group]);
      if (!entries.length) continue;
      const start = `<!-- card-docs:${kind}:${group}:start -->`;
      const end = `<!-- card-docs:${kind}:${group}:end -->`;
      assert.equal(
        source.split(start).length,
        2,
        `Missing or duplicate gallery start: ${kind}/${group}`,
      );
      assert.equal(
        source.split(end).length,
        2,
        `Missing or duplicate gallery end: ${kind}/${group}`,
      );
      const begin = source.indexOf(start) + start.length;
      const finish = source.indexOf(end);
      assert.ok(finish > begin, `Reversed gallery markers: ${kind}/${group}`);
      const cells = entries.flatMap(([name, options]) => {
        const file = `images/Cards/generated/${kind}-${group === "editors" ? "editor-" : ""}${name}.png`;
        if (pending && !exists(file)) {
          pending.push(file);
          return [];
        }
        assert.ok(exists(file), `Missing screenshot: ${file}`);
        const title = typeof options === "string" ? options : options.title;
        return `    <td valign="top"><img src="${file}" alt="${escape(definition.title)} - ${escape(title)}" width="${group === "editors" ? 220 : 280}"><br>${escape(title)}</td>`;
      });
      const rows = [];
      for (let index = 0; index < cells.length; index += 3)
        rows.push("  <tr>", ...cells.slice(index, index + 3), "  </tr>");
      const content = ["", "<table>", ...rows, "</table>", ""].join(newline);
      source = source.slice(0, begin) + content + source.slice(finish);
    }
  }
  return source;
}

if (require.main === module) {
  const file = path.join(root, "README.md");
  const before = fs.readFileSync(file, "utf8");
  const check = process.argv.includes("--check");
  // A check accepts new scenarios not captured yet (see updateGalleries).
  const pending = check ? [] : undefined;
  const after = updateGalleries(before, catalogue, undefined, { pending });
  if (check) {
    assert.equal(
      after,
      before,
      "README galleries are stale; run npm run docs:readme",
    );
    for (const file of pending)
      console.log(`pending capture (Documentation Screenshots workflow): ${file}`);
  } else if (after !== before) fs.writeFileSync(file, after);
}

module.exports = { updateGalleries };
