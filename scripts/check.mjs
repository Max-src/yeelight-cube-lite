// Run the CI checks locally before pushing:
//
//   npm run check
//
// The same steps as the Tests workflow (.github/workflows/tests.yaml): Python
// tests, JS tests, the Lit bundle check and the browser checks, then a
// summary. Set DOCS_HA_URL (and DOCS_HA_STORAGE_STATE, or DOCS_HA_ONBOARD=1
// for a disposable local HA) to also run the documentation screenshot
// capture; see docs/DOCUMENTATION_SCREENSHOTS.md.
import { spawnSync } from "node:child_process";

const windows = process.platform === "win32";
const python = process.env.PYTHON || (windows ? "python" : "python3");
const npm = windows ? "npm.cmd" : "npm";
// Edge is preinstalled on Windows; CI uses Playwright's Chromium.
const browserEnv = { BROWSER_CHANNEL: process.env.BROWSER_CHANNEL || (windows ? "msedge" : "chromium") };

const steps = [
  ["Python tests", python, ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"]],
  ["JS tests", process.execPath, ["--test", "tests/*.test.mjs"]],
  ["Lit bundle is up to date", npm, ["run", "build:lit"], {
    after: ["git", ["diff", "--exit-code", "--", "custom_components/yeelight_cube/www/lib/lit-all.js"]],
  }],
  ["Browser: card events", process.execPath, ["tests/card-events-browser.cjs"], { env: browserEnv }],
  ["Browser: card sync", process.execPath, ["tests/card-sync-browser.cjs"], { env: browserEnv }],
  ["Browser: card UI parity", process.execPath, ["tests/card-ui-parity.cjs"], { env: browserEnv }],
  ["Documentation galleries", process.execPath, ["tests/card-docs-readme.cjs", "--check"]],
];
if (process.env.DOCS_HA_URL || process.env.DOCS_HA_ONBOARD === "1")
  steps.push(["Documentation screenshots", npm, ["run", "docs:screenshots"]]);

const run = (command, args, env) =>
  spawnSync(command, args, {
    stdio: "inherit",
    shell: windows && command.endsWith(".cmd"),
    env: { ...process.env, ...env },
  }).status === 0;

const results = [];
for (const [name, command, args, options = {}] of steps) {
  console.log(`\n=== ${name}`);
  const started = Date.now();
  let ok = run(command, args, options.env);
  if (ok && options.after) ok = run(...options.after);
  results.push([name, ok, ((Date.now() - started) / 1000).toFixed(0)]);
}

console.log("\n=== Summary");
for (const [name, ok, seconds] of results)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (${seconds}s)`);
if (!process.env.DOCS_HA_URL && process.env.DOCS_HA_ONBOARD !== "1")
  console.log("SKIP  Documentation screenshots (needs a Home Assistant: set DOCS_HA_URL)");
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
