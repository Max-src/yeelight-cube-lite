// The browser checks: the real cards in a browser against a fake Home
// Assistant backend. The one list of them, run by the Tests workflow
// (.github/workflows/tests.yaml), `npm run check` (scripts/check.mjs) and the
// Linux checks (scripts/linux-browser-checks.sh), so they cannot drift apart.
//
//   node scripts/browser-checks.mjs
//
// BROWSER_CHANNEL picks the browser (msedge, chromium); GALLERY_MS the
// gallery performance limit (tests/gallery-perf-browser.cjs).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUITES = [
  ["card events", "tests/card-events-browser.cjs"],
  ["card sync", "tests/card-sync-browser.cjs"],
  ["card UI parity", "tests/card-ui-parity.cjs"],
  ["gallery canvas", "tests/matrix-surface-browser.cjs"],
  // Not on Linux yet: there its page is lost as the gallery is added
  // (Playwright's Chromium, no crash reported). GALLERY_PERF=1 runs it anyway.
  ["gallery performance", "tests/gallery-perf-browser.cjs", { linux: false }],
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linux = process.platform === "linux" && process.env.GALLERY_PERF !== "1";
const results = [];
for (const [name, file, options = {}] of SUITES) {
  if (linux && options.linux === false) {
    console.log(`\n--- Browser: ${name}: skipped on Linux`);
    results.push([name, null, "0"]);
    continue;
  }
  console.log(`\n--- Browser: ${name}`);
  const started = Date.now();
  const ok =
    spawnSync(process.execPath, [file], { cwd: root, stdio: "inherit" })
      .status === 0;
  results.push([name, ok, ((Date.now() - started) / 1000).toFixed(0)]);
}
console.log("");
const label = (ok) => (ok === null ? "SKIP" : ok ? "PASS" : "FAIL");
for (const [name, ok, seconds] of results)
  console.log(`${label(ok)}  browser: ${name} (${seconds}s)`);
process.exitCode = results.some(([, ok]) => ok === false) ? 1 : 0;
