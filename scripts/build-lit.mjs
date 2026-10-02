// Build custom_components/yeelight_cube/www/lib/lit-all.js, the single Lit
// bundle every card imports (Home Assistant serves the cards as plain ES
// modules, so they cannot import "lit" by package name).
//
//   npm run build:lit
//
// Lit's version is pinned in package.json (lit 2.8.0). Add an export here
// when a card needs another part of Lit, then rebuild.
import { build } from "esbuild";

const entry = `
export { LitElement, css, html, svg, nothing, unsafeCSS } from "lit";
export { repeat } from "lit/directives/repeat.js";
export { unsafeHTML } from "lit/directives/unsafe-html.js";
export { unsafeSVG } from "lit/directives/unsafe-svg.js";
`;

await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "js" },
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2019",
  legalComments: "eof",
  outfile: "custom_components/yeelight_cube/www/lib/lit-all.js",
});
console.log("Built custom_components/yeelight_cube/www/lib/lit-all.js");
